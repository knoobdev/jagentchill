import { LOCAL_IMAGE_FEATURE, LOCAL_IMAGE_PROVIDER_ID } from "@jagentchill/protocol";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { GenerationCapability, GenerationJob, GenerationParams } from "@jagentchill/protocol";
import { ToolFailure, defineTool, type ToolContext, type ToolDefinition, type ToolHost } from "../tools/kit.ts";
import type { GenerationService } from "./service.ts";
import { isSpendStop, usdText } from "./spend-gate.ts";

/**
 * The `jc_generate_*` tools: an agent's way to the same provider jobs, budgets and approval thresholds a person's
 * Generate button uses. A tool is served only while a connected provider has an enabled model of its capability.
 * The result is stored on the host and imported into the project's media library with its provenance.
 */
const usd = (amount: number | null) => (amount === null ? "an unknown cost" : `about ${usdText(amount)}`);

/** Keep an agent's requested label while making its extension match the generated file. */
export function generatedAssetName(requested: string | undefined, generated: string): string {
  const extension = /\.([a-z0-9]{1,10})$/i.exec(generated)?.[1]?.toLowerCase();
  if (!requested || !extension) return requested ?? generated;
  const label = requested.replace(/\.[a-z0-9]{1,10}$/i, "").replace(/[. ]+$/, "");
  return `${label || requested}.${extension}`;
}

/** What the tool service gives the tools of generation: the service, behind the two things they need from it. */
export function createGenerationToolPort(generation: () => GenerationService, extra: Pick<NonNullable<ToolHost["generation"]>, "userWords"> = {}): NonNullable<ToolHost["generation"]> {
  return {
    ...extra,
    available: (capability) => generation().available(capability as GenerationCapability),
    settled: async (jobId) => (await generation().settled(jobId)) as unknown as Record<string, unknown>,
    job: (jobId) => { try { return generation().job(jobId) as unknown as Record<string, unknown>; } catch { return undefined; } },
    sessionJobs: (sessionKey) => generation().liveJobs().filter((job) => job.sessionId === sessionKey) as unknown as Record<string, unknown>[],
    tell: (sessionKey, message) => generation().tell(sessionKey, message),
    cancel: (jobId) => generation().cancel(jobId) as unknown as Record<string, unknown>,
    async run(session, projectId, request, permit) {
      const service = generation(), capability = request.capability as GenerationCapability, params = request.params as GenerationParams;
      const base = { capability, params, projectId, sessionId: session.sessionKey };
      // A model named without its provider is looked up among the connected providers.
      const provider = request.model ? request.provider ?? service.providers().find((entry) => service.models(entry.id).some((model) => model.id === request.model && model.capability === capability))?.id : undefined;
      if (request.model && !provider) throw new ToolFailure("NOT_FOUND", `No connected provider has the model "${request.model}" for ${capability}.`, { model: request.model });
      let prepared;
      try { prepared = service.prepare({ ...base, ...(provider && request.model ? { provider, model: request.model } : {}) }); } catch (error) { throw toolFailure(error); }
      // The agent has NO authority of its own to spend: a call runs unasked only INSIDE an allowance a person set
      // (spec `generation-providers`, "Approval thresholds and spending caps", rules 2 and 3 — the host's values need
      // `config.write`). That allowance IS the approval; the host's "ask before spending more than" (rule 6) is about
      // actions a person starts directly and decides nothing here.
      //  - an `auto` session (rule 3): approved automatically while what the session's agent tree has spent, with this
      //    call, stays within the Auto-mode session budget;
      //  - any other mode that may spend (rule 2, `edit`): while the costed calls of ONE assistant message, with this
      //    call, stay within the per-call approval amount (0 = always ask).
      // Past it — or at an unknown cost, or for a prompt the person must see (`permit.always`) — the person's card is
      // asked first, and what they allow is THIS call: this amount, this model (`cover`), nothing else.
      // Inside it the call is a request of the allowance's own action in the spend gate, which holds the allowance to
      // its amount on what is really BILLED (the rules above count estimates): a provider that bills more than it
      // quoted cannot take an agent past what the person set.
      const name = `${prepared.model.provider}/${prepared.model.id}`, amount = prepared.estimate.amountUsd;
      /** What the card says beside the call itself: where the allowance stands (the message's — or the session tree's — spending so far, with this call, against what a person set). */
      let standing = "";
      /** The same, as facts: the card's title and money line are worded by the screen in the person's language (`money`); the sentences above stay as the English fallback. */
      let standingFacts: NonNullable<import("@jagentchill/protocol").PermissionMoney["standing"]> | undefined;
      const card = (): string => {
        const words = String(params.prompt ?? params.text ?? "").slice(0, 300);
        permit({ toolLabel: `Generate ${capability === "tts" ? "speech" : capability}`, detail: `${prepared.model.label} (${prepared.model.provider}) — ${usd(amount)}.${standing} "${words}"`, projectId, money: { capability, modelLabel: prepared.model.label, amountUsd: amount, words, ...(standingFacts ? { standing: standingFacts } : {}) } });
        return service.gate.cover({ fixedId: `tool:${session.sessionKey}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`, kind: "agent.tool", owner: session.sessionKey, amountUsd: amount ?? 0, models: [name], unpriced: amount === null ? [name] : [] }).id;
      };
      let action: string | undefined, carded = false;
      const ask = (): void => { action = card(); carded = true; };
      /** The item of a message card this call ran as (ruling R8): marked "made" when its job was created. */
      let listed: { cardId: string; itemId: string } | undefined;
      // A picture made on this computer costs nothing: no allowance, no card.
      const free = prepared.model.provider === LOCAL_IMAGE_PROVIDER_ID;
      if (!prepared.hit && !free) {
        const auto = session.modeId === "auto";
        // What a call that ran was estimated at (what the rules count); for one that failed, what it was billed all the same.
        const counted = (row: Record<string, unknown>): number => (row.outcome === "succeeded" ? Number(row.estimate_usd ?? row.actual_usd) || 0 : Number(row.actual_usd) || 0);
        let spent = 0, allowance: { id: string; usd: number }, /** Auto: part of what the tree has spent has no amount yet — the allowance cannot be said to cover this call. */ cannotBound = false;
        if (auto) {
          // ALL the spending of the session's agent tree (rule 3, review 14 #1): the generation calls that ran (the ledger),
          // the calls an allowance has let out that have not ended yet (their estimates), AND the turns of the runtime's
          // model the tree's sessions took — what Usage's record of each turn says it cost.
          const tree = (await service.gate.usage.tree(session.sessionKey)) ?? [session.sessionKey], members = new Set([...tree, session.sessionKey]);
          // (Review 15 #2) A turn whose usage is NOT settled yet is not zero: it stands at what the gate holds for it — its
          // provisional charge (the bound it was reserved at) or its reservation while it is still in flight. Usage's
          // record of such a turn says nothing final, so it is not counted a second time from there.
          const open = service.gate.unsettledOf(members), unsettled = service.gate.unsettledTurns(members);
          // (Review 16 #5) What CANNOT be bounded is not zero either: a request the gate holds at "price not known" (a
          // provisional charge or a reservation with no amount), and a turn of the tree that is billed per call and of
          // which Usage has a record with no cost. With any of it outstanding nobody can say the tree is inside its
          // allowance: the person is asked. (The one record that is never "outstanding" is the newest turn of the calling
          // session — the message that is being written and makes this call: its bill does not exist yet.)
          let turns = 0, unbounded = open.unknown;
          for (const member of members) {
            const records = (await service.gate.usage.turns(member)) ?? [];
            records.forEach((turn, index) => {
              if (unsettled.has(turn.runId)) return;
              if (typeof turn.costUsd === "number") turns += Math.max(0, turn.costUsd);
              else if (turn.billedByCall === true && !(member === session.sessionKey && index === records.length - 1)) unbounded++;
            });
          }
          cannotBound = unbounded > 0;
          spent = service.ledgerRows().filter((row) => members.has(String(row.session_id))).reduce((sum, row) => sum + counted(row), 0) + service.pendingUsd(members) + turns + open.usd;
          // The allowance is the ROOT session's: its own where a person set one for that session, else the host's.
          allowance = { id: `allowance:auto:${tree[0]}`, usd: service.sessionThresholds(tree[0]).autoSessionBudgetUsd };
          standing = cannotBound ? ` What this session and its agents have spent so far is not all known yet (${unbounded === 1 ? "one request has" : `${unbounded} requests have`} no bill so far), so it cannot be counted against the ${usdText(allowance.usd)} it may spend unasked.` : ` This session and its agents have spent ${usdText(spent)} of the ${usdText(allowance.usd)} it may spend unasked.`;
          standingFacts = cannotBound ? { kind: "session_unknown", allowanceUsd: allowance.usd } : { kind: "session", spentUsd: Math.round(spent * 1e6) / 1e6, allowanceUsd: allowance.usd };
        } else {
          // The assistant message that is being written is the session's turn that is running (Usage's newest record of it). A host whose Usage knows no turn of the session: the call stands alone.
          const message = (await service.gate.usage.turns(session.sessionKey))?.at(-1);
          if (message) spent = service.ledgerRows({ from_ms: message.started_ms }).filter((row) => row.session_id === session.sessionKey).reduce((sum, row) => sum + counted(row), 0) + service.pendingUsd(new Set([session.sessionKey]), message.started_ms);
          allowance = { id: message ? `allowance:message:${session.sessionKey}:${message.runId}` : `allowance:call:${session.sessionKey}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`, usd: service.sessionThresholds(session.sessionKey).perCallApprovalUsd };
          // The card of a message is about the MESSAGE (rule 2: "costed calls of one assistant message whose total estimate exceeds it"): it says the total, not only this call.
          if (amount !== null) { standing = ` The costed calls of this message come to ${usdText(spent + amount)} with this one (asked above ${usdText(allowance.usd)}).`; standingFacts = { kind: "message", totalUsd: Math.round((spent + amount) * 1e6) / 1e6, allowanceUsd: allowance.usd }; }
          // ONE decision a message (spec `agent-editing-tools`, "Cost guard", rule 4; ruling R8; review 16 #2): "when the
          // total estimate of all costed calls issued in the same assistant message exceeds the per-call approval
          // threshold, or any of them has an unknown estimate, one approval card lists each item and the total, and
          // nothing is queued until Allow". The host learns of a message's calls ONE BY ONE (the engine reports a call
          // when it starts to run it, and runs the next only after this one was answered), so no call can wait here for
          // the others: every costed call of the message is COLLECTED — answered at once as held, nothing dispatched —
          // and the message is decided as a whole when it has ended (`messageCards.settle`): inside the amount its
          // calls are let out with no card, else the ONE card lists them all. Either way the agent then makes them
          // again, and THAT call (found here by what it asks) runs.
          // (An agent with NO message known to the host — no turn of the session in Usage — has nothing to collect by: its call is asked by itself, on the permission card.)
          if (permit.always !== true && message) {
            // A cost that a hard-stop budget forbids is said as that, at once: it is not collected to be asked about.
            try { service.refuseOverBudget(prepared.model.provider, { projectId, sessionId: session.sessionKey }, amount); } catch (error) { throw toolFailure(error); }
            const cards = service.messageCards, hash = createHash("sha256").update(JSON.stringify([capability, prepared.model.provider, prepared.model.id, params])).digest("hex").slice(0, 32);
            // The collections of this session's EARLIER messages are decided first: this call proves a newer message is being written.
            await cards.settle(session.sessionKey);
            const mine = cards.of(session.sessionKey);
            const item = () => ({ itemId: hash, tool: `jc_generate_${capability === "tts" ? "speech" : capability}`, capability, provider: prepared.model.provider, model: prepared.model.id, modelLabel: prepared.model.label, amountUsd: amount, words: String(params.prompt ?? params.text ?? "").slice(0, 300), state: "waiting" as const });
            // A decision that lists THIS call as waiting (a card a person answered, or a message that ended inside its amount): it is used, once.
            const answered = mine.find((entry) => !entry.collecting && entry.state !== "pending" && entry.items.some((entry_) => entry_.itemId === hash && entry_.state === "waiting"));
            if (answered?.state === "denied") { cards.put({ ...answered, items: answered.items.filter((entry) => entry.itemId !== hash) }); throw new ToolFailure("PERMISSION_DENIED", "The user did not allow the costed calls of that message. Do not try this again unless the user asks.", { requestId: answered.cardId }); }
            if (answered) {
              // What was let out: the calls listed as waiting — these models, this total — and nothing else.
              const waiting = answered.items.filter((entry) => entry.state === "waiting" || entry.itemId === hash), named = waiting.map((entry) => `${entry.provider}/${entry.model}`);
              const whole = service.gate.action(`card:${answered.cardId}`) ?? service.gate.cover({ fixedId: `card:${answered.cardId}`, kind: "agent.card", owner: session.sessionKey, amountUsd: waiting.reduce((sum, entry) => sum + (entry.amountUsd ?? 0), 0), models: [...new Set(named)], unpriced: [...new Set(waiting.filter((entry) => entry.amountUsd === null).map((entry) => `${entry.provider}/${entry.model}`))] });
              action = whole.id; listed = { cardId: answered.cardId, itemId: hash };
            } else {
              // Asked about already (the card of an earlier message is still unanswered): the same card, nothing new.
              const asked = mine.find((entry) => !entry.collecting && entry.state === "pending" && entry.items.some((entry_) => entry_.itemId === hash && entry_.state === "waiting"));
              if (asked) throw new ToolFailure("APPROVAL_PENDING", `APPROVAL_PENDING:${asked.cardId} — the user was asked to allow the costed calls of that message on ONE card and has not answered yet. End your turn; when the decision arrives, make the calls again with exactly the same parameters.`, { requestId: asked.cardId, card: "message" });
              const collecting = mine.find((entry) => entry.collecting && entry.messageId === message.runId) ?? cards.put({ cardId: randomUUID(), sessionKey: session.sessionKey, messageId: message.runId, state: "pending", collecting: true, items: [], totalUsd: 0, unpricedModels: [], allowanceUsd: allowance.usd, created_ms: Date.now() });
              if (!collecting.items.some((entry) => entry.itemId === hash)) cards.put({ ...collecting, items: [...collecting.items, item()] });
              throw new ToolFailure("APPROVAL_PENDING", `APPROVAL_PENDING:${collecting.cardId} — nothing was started yet: the costed calls of ONE message are decided together when the message has ended. Make the other generation calls of this message now, if there are any, then end your turn. You will be told right after whether to make them again (with exactly the same parameters) — at once when their total is inside the amount the user allows a message, else after the user answered ONE card that lists them all.`, { requestId: collecting.cardId, card: "message", collecting: true });
            }
          }
        }
        if (action) { /* a card's answer covers this call */ }
        else if (permit.always === true || amount === null || cannotBound || spent + amount > allowance.usd + 1e-9) ask();
        else action = service.gate.cover({ fixedId: allowance.id, kind: "agent.allowance", owner: session.sessionKey, amountUsd: allowance.usd }).id;
      }
      let job: GenerationJob;
      const start = (): GenerationJob => service.create({ ...base, provider: prepared.model.provider, model: prepared.model.id, ...(request.reuse ? { reuse: true } : {}) }, { deviceId: session.ownerDeviceId, by: "agent", sessionId: session.sessionKey, ...(action ? { action } : {}) });
      try {
        let made: GenerationJob;
        // A call the gate does not let out under the allowance — or under what a message's decision let out — (what was BILLED under it has used it up) is refused before anything is sent: then the permission card of THIS call is the way.
        try { made = start(); } catch (error) { if (carded || !(isSpendStop(error) || (error as { details?: { reason?: unknown } })?.details?.reason === "confirmation_required")) throw error; ask(); made = start(); }
        // The call the card listed is made: one answer, each listed call, once.
        if (listed) { const of = listed, card = service.messageCards.of(session.sessionKey).find((entry) => entry.cardId === of.cardId); if (card) { const items = card.items.map((entry) => (entry.itemId === of.itemId ? { ...entry, state: "made" as const } : entry)); const done = !items.some((entry) => entry.state === "waiting"); service.messageCards.put({ ...card, items, ...(done && card.state === "pending" ? { state: "allowed" as const, decided_ms: Date.now() } : {}) }); if (done) service.gate.close(`card:${card.cardId}`); } }
        // A picture made on this computer is answered with its job at once when the caller can follow it up.
        if (request.background && free) return made as unknown as Record<string, unknown>;
        job = await service.settled(made.jobId);
      } catch (error) { throw toolFailure(error); } finally { if (action && carded) service.gate.close(action); }
      if (job.state === "cancelled") throw new ToolFailure("CANCELLED", "The generation was cancelled.", { jobId: job.jobId });
      if (job.state !== "succeeded") {
        const error = job.error!, code = error.class === "content_blocked" ? "CONTENT_BLOCKED" : error.class === "budget_exceeded" ? "BUDGET_EXCEEDED" : "PROVIDER_ERROR";
        throw new ToolFailure(code, `${error.message}. Suggested: ${error.action}.`, { class: error.class, jobId: job.jobId, retryable: error.retryable, ...(error.details?.providerMessage ? { providerMessage: error.details.providerMessage } : {}) });
      }
      return job as unknown as Record<string, unknown>;
    },
  };
}
function toolFailure(error: unknown): unknown {
  const known = error as { code?: string; message?: string; details?: Record<string, unknown> };
  if (known?.code === "BUDGET_EXCEEDED" || known?.code === "NO_ROUTE" || known?.code === "INVALID_PARAMS" || known?.code === "NOT_FOUND") return new ToolFailure(known.code as "NO_ROUTE", known.message ?? "", known.details ?? {});
  return error;
}

async function generate(ctx: ToolContext, capability: GenerationCapability, params: GenerationParams, args: { model?: string; provider?: string; name?: string; folderId?: string; reuse?: boolean; dryRun?: boolean; quiet?: boolean }) {
  const port = ctx.host.generation;
  if (!port?.available(capability)) throw new ToolFailure("NO_ROUTE", `No provider is configured for ${capability}. Ask the user to connect one under Settings, Providers, Generation.`, { capability });
  if (ctx.dryRun) return { data: { state: "would_generate", provisional: true }, summary: `Would generate ${capability === "tts" ? "speech" : `one ${capability} result`}.` };
  // The composer's "make pictures on this computer" switch sends this session's pictures to the local image model.
  const switched = capability === "image" && !args.provider && ctx.session.featureValues?.[LOCAL_IMAGE_FEATURE] === true;
  if (switched) args = { ...args, provider: LOCAL_IMAGE_PROVIDER_ID };
  // The agent decides THAT a picture is made; the person's own words decide WHAT it shows (an agent's model may tone down
  // what was asked for; the model on this computer is the person's choice).
  // The host is already making the picture the person asked for (their words, their model): the agent gets that one.
  const making = switched ? (port.sessionJobs?.(ctx.session.sessionKey) as unknown as GenerationJob[] | undefined)?.find((job) => job.provider === LOCAL_IMAGE_PROVIDER_ID && job.capability === "image") : undefined;
  if (making) return { data: { jobId: making.jobId, state: "making", provider: making.provider, model: making.model, costUsd: 0, next: "This picture is the one the user asked for; it is already being made. Do not call again; you are told when it is in the media library." }, summary: "The picture is being made on this computer (a few minutes)." };
  const words = switched ? port.userWords?.(ctx.session.sessionKey, params.seed !== undefined) : undefined;
  if (words) params = { ...params, prompt: words };
  // A picture made on this computer takes minutes: the call answers at once, the picture is added to the media library
  // when it is ready, and the session is told then (no runtime's tool-call limit can cut it, and nobody waits on it).
  const job = (await port.run(ctx.session, ctx.projectId, { capability, params, ...(port.settled && port.tell ? { background: true } : {}), ...(args.model ? { model: args.model } : {}), ...(args.provider ? { provider: args.provider } : {}), ...(args.reuse ? { reuse: true } : {}) }, ctx.permit)) as unknown as GenerationJob;
  // Made on this computer (named, switched on in the composer, or where the Image role leads): it is still being made.
  if (job.provider === LOCAL_IMAGE_PROVIDER_ID && job.state !== "succeeded") return followLocal(ctx, port, job, params, args);
  const assets = [];
  let revision = ctx.revision;
  for (const asset of job.results) {
    const imported = await ctx.host.importMedia(ctx.session, ctx.projectId, { kind: "upload", blobId: asset.blobId }, { name: generatedAssetName(args.name && job.results.length === 1 ? args.name : undefined, asset.name), ...(args.folderId ? { folderId: args.folderId } : {}), provenance: { ...asset.provenance } }, () => undefined);
    revision = Number(imported.revision);
    assets.push({ assetId: imported.assetId, name: imported.name, type: asset.kind, ...(asset.width ? { width: asset.width, height: asset.height } : {}), ...(asset.durationSeconds ? { durationSeconds: asset.durationSeconds } : {}) });
  }
  return {
    data: { jobId: job.jobId, provider: job.provider, model: job.model, assets, costUsd: job.actualUsd, cacheHit: job.cacheHit, ...(job.warnings.length ? { warnings: job.warnings } : {}) }, revision,
    summary: `Generated ${assets.length} ${capability === "tts" ? "speech clip" : capability}${assets.length === 1 ? "" : "s"} into the media library${job.actualUsd ? ` ($${job.actualUsd.toFixed(4)})` : ""}.`,
  };
}

/** The status message format the screens hide (`apps/app/src/agents/proposals/notes.ts`). */
const note = (head: string, data: unknown) => `[JAgentChill] ${head}\nThis is a status message of the editor, not a request of the user.\n${JSON.stringify(data)}`;

async function followLocal(ctx: ToolContext, port: NonNullable<ToolHost["generation"]>, made: GenerationJob, params: GenerationParams, args: { name?: string; folderId?: string; quiet?: boolean }) {
  const { session, projectId, host } = ctx, sessionKey = session.sessionKey;
  void (async () => {
    const job = (await port.settled!(made.jobId)) as unknown as GenerationJob;
    // Stopped by the person (the card's Stop, or "stop" to the agent): nothing to tell, the agent does not start again.
    if (job.state === "cancelled") return;
    if (job.state !== "succeeded") { port.tell!(sessionKey, note("The picture being made on this computer did not finish.", { jobId: job.jobId, state: job.state, error: job.error?.message, suggested: job.error?.action })); return; }
    const assets: { assetId: string; name: string }[] = [];
    for (const asset of job.results) {
      const imported = await host.importMedia(session, projectId, { kind: "upload", blobId: asset.blobId }, { name: generatedAssetName(args.name && job.results.length === 1 ? args.name : undefined, asset.name), ...(args.folderId ? { folderId: args.folderId } : {}), provenance: { ...asset.provenance } }, () => undefined);
      assets.push({ assetId: String(imported.assetId), name: String(imported.name) });
    }
    // A picture the person made with their own words (not through the agent) is only added to the media library.
    if (!args.quiet) port.tell!(sessionKey, note("The picture made on this computer is in the media library. Place it on the timeline if the user asked for that.", { jobId: job.jobId, assets }));
  })().catch((error) => port.tell!(sessionKey, note("The picture being made on this computer could not be added to the media library.", { jobId: made.jobId, error: error instanceof Error ? error.message : String(error) })));
  return {
    // The step line shows the summary; what the agent must do next is in the data it reads.
    data: { jobId: made.jobId, state: "making", provider: made.provider, model: made.model, costUsd: 0, next: "It is added to the media library by itself and you are told when it is there — do not call again. If the user asks how it is going, call jc_generation_status with this jobId." },
    summary: "The picture is being made on this computer (a few minutes).",
  };
}

const common = {
  model: z.string().min(1).max(200).optional(), provider: z.string().min(1).max(120).optional(), name: z.string().trim().min(1).max(255).optional(), folderId: z.string().min(1).max(64).optional(),
  reuse: z.boolean().optional(), projectId: z.string().min(1).max(64).optional(), idempotencyKey: z.string().min(8).max(64).optional(), dryRun: z.boolean().optional(),
};
const tail = " The file is added to the project's media library and its assetId is returned; put it on the timeline with jc_clip_add. It costs money: on APPROVAL_PENDING nothing was started — finish this message's generation calls, end your turn, and repeat them unchanged when told. provider and model are optional; without them the host's default model is used.";
/** What a person is told about a job, for the agent to repeat: state, progress, time so far and an estimate of what is left. */
export function jobProgress(job: GenerationJob, now = Date.now()) {
  const progress = Math.max(0, Math.min(1, job.progress ?? 0));
  const elapsedSeconds = job.started_ms ? Math.round((now - job.started_ms) / 1000) : 0;
  // Left: the time so far stretched over what is done; said only once enough is done to mean something.
  const leftSeconds = job.state === "running" && progress > 0.1 && elapsedSeconds > 0 ? Math.round((elapsedSeconds / progress) * (1 - progress)) : undefined;
  return {
    jobId: job.jobId, capability: job.capability, provider: job.provider, model: job.model, state: job.state, percent: Math.round(progress * 100),
    ...(job.status ? { status: job.status } : {}), ...(job.queuePosition !== undefined ? { queuePosition: job.queuePosition } : {}),
    elapsedSeconds, ...(leftSeconds !== undefined ? { estimatedSecondsLeft: leftSeconds } : {}),
    ...(job.results?.length ? { results: job.results.length } : {}), ...(job.error ? { error: job.error.message } : {}),
  };
}

export const GENERATE_TOOLS: ToolDefinition[] = [
  defineTool({
    name: "jc_generation_status", family: "generate", readOnly: true, needsProject: false, kind: "direct", available: (host) => !!host.generation?.sessionJobs,
    description: "How a generation of this session is going now: state (queued, running, succeeded, failed, cancelled), percent done, seconds so far, estimated seconds left, queue position. Without jobId: every unfinished job of this session. Call it whenever the user asks how a picture is going — never guess.",
    shape: { jobId: z.string().min(1).max(80).optional() },
    handle: (ctx, args) => {
      const port = ctx.host.generation!;
      if (args.jobId) {
        const job = port.job?.(args.jobId) as unknown as GenerationJob | undefined;
        if (!job || job.sessionId !== ctx.session.sessionKey) throw new ToolFailure("NOT_FOUND", "This session has no generation with that jobId.", { jobId: args.jobId });
        const now = jobProgress(job);
        return { data: now, summary: `${now.state === "running" ? `Running, ${now.percent}% done` : now.state}${now.estimatedSecondsLeft !== undefined ? `, about ${Math.ceil(now.estimatedSecondsLeft / 60)} min left` : ""}.` };
      }
      const jobs = (port.sessionJobs?.(ctx.session.sessionKey) ?? []).map((job) => jobProgress(job as unknown as GenerationJob));
      return { data: { jobs }, summary: jobs.length ? jobs.map((job) => `${job.capability} ${job.state} ${job.percent}%`).join("; ") : "No generation of this session is running." };
    },
  }),
  defineTool({
    name: "jc_generation_cancel", family: "generate", readOnly: false, needsProject: false, kind: "direct", available: (host) => !!host.generation?.cancel && !!host.generation.sessionJobs,
    description: "Stop generations of this session that have not ended (a picture being made or waiting). Without jobId: every one of them. Call it when the user says stop or cancel.",
    shape: { jobId: z.string().min(1).max(80).optional() },
    handle: (ctx, args) => {
      const port = ctx.host.generation!;
      const open = (port.sessionJobs!(ctx.session.sessionKey) as unknown as GenerationJob[]).filter((job) => !args.jobId || job.jobId === args.jobId);
      if (args.jobId && !open.length) throw new ToolFailure("NOT_FOUND", "This session has no unfinished generation with that jobId.", { jobId: args.jobId });
      for (const job of open) port.cancel!(job.jobId);
      return { data: { cancelled: open.map((job) => job.jobId) }, summary: open.length ? `Stopped ${open.length} generation${open.length === 1 ? "" : "s"}.` : "No generation of this session was running." };
    },
  }),
  defineTool({
    name: "jc_generate_image", family: "generate", readOnly: false, needsProject: true, kind: "direct", available: (host) => host.generation?.available("image") === true,
    description: `The only way to make or change a picture (never an image tool of your own). To change one made before: its generation.prompt from jc_media_get, changed, with the same seed and aspectRatio.${tail}`,
    shape: { prompt: z.string().trim().min(1).max(8000), aspectRatio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"]).optional(), count: z.number().int().min(1).max(4).optional(), seed: z.number().int().min(0).max(2_147_483_647).optional(), quiet: z.boolean().optional(), ...common },
    handle: (ctx, args) => generate(ctx, "image", { prompt: args.prompt, ...(args.aspectRatio ? { aspectRatio: args.aspectRatio } : {}), ...(args.count ? { count: args.count } : {}), ...(args.seed !== undefined ? { seed: args.seed } : {}) }, args),
  }),
  defineTool({
    name: "jc_generate_speech", family: "generate", readOnly: false, needsProject: true, kind: "direct", available: (host) => host.generation?.available("tts") === true,
    description: `Turn text into spoken audio (a voiceover line) with the connected speech provider. voice is a voice id of the model; without it the model's first voice is used.${tail}`,
    shape: { text: z.string().trim().min(1).max(4000), voice: z.string().min(1).max(80).optional(), ...common },
    handle: (ctx, args) => generate(ctx, "tts", { text: args.text, ...(args.voice ? { voice: args.voice } : {}) }, args),
  }),
  defineTool({
    name: "jc_generate_music", family: "generate", readOnly: false, needsProject: true, kind: "direct", available: (host) => host.generation?.available("music") === true,
    description: `Generate a short music clip from a description of mood, genre and instruments with the connected music provider.${tail}`,
    shape: { prompt: z.string().trim().min(1).max(2000), instrumental: z.boolean().optional(), ...common },
    handle: (ctx, args) => generate(ctx, "music", { prompt: args.prompt, ...(args.instrumental !== undefined ? { instrumental: args.instrumental } : {}) }, args),
  }),
];
