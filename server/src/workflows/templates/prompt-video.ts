import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { gzipSync } from "node:zlib";
import { z } from "zod";
import { canonicalJson, film as fm, promptVideo as pv, validatorEffectRegistry, validatorTransitionRegistry, workflow as wf, type Registries } from "@jagentchill/editor-core";
import type { GenerationCapability, GenerationJob, GenerationParams, ProjectDocument, Scope, WorkflowRunRecord } from "@jagentchill/protocol";
import type { Connection, RpcMethod } from "../../channel/ws-channel.ts";
import { ProtocolError } from "../../errors.ts";
import { createFilmService, type FilmDeps } from "../../film/service.ts";
import type { GenerationService } from "../../generation/service.ts";
import type { SyncService } from "../../sync/service.ts";
import type { AgentActor, StartInput, TemplateStarter } from "../agent-runs.ts";
import type { AutomationMoney } from "../automations.ts";
import type { StepTool, WorkflowRuns } from "../runs.ts";
import type { WorkflowService } from "../service.ts";
import { CONFIRMED_SHARE, createRunMoney, dollars, money4, type TurnBound } from "./prompt-video-money.ts";

/**
 * The host side of "One prompt → video": the template document, the step tools its `tool` nodes name, and the channel
 * methods of its screens. It has no engine, queue or budget of its own: writing is a real session turn of the device
 * that started the run, music is a job of the generation service, and the result is a real project in the host's
 * document store.
 *
 * The PICTURES and the VOICE are made by the film engine, not here: every run has a working film (its shots as panels,
 * its spoken segments as lines — `pv.workingFilm`) in a film service of its own store, and the Pictures and Voice
 * steps call that service's own storyboard and voice stages (`jc_film_panels`, `jc_film_voice`). So a video gets what
 * the film learned, by the same code: frames drawn with the frame before them as a reference (five references at
 * most), every picture shown to the Vision role, every speaker recorded once and cut into lines, every take listened
 * to and compared with its words, and a frame
 * the provider refuses kept for a person instead of dropped.
 */
export type PromptVideoDeps = {
  now: () => number;
  /** `automations`: where an unattended run's cost limit is read. `methods`: the generic start of a run, which this template takes over for its own id. */
  workflows: () => Pick<WorkflowService, "docs" | "runs"> & Partial<Pick<WorkflowService, "automations" | "methods">>;
  generation: () => GenerationService | undefined;
  sync: Pick<SyncService, "blobs" | "documents">;
  /** Where the working films are kept (never the Film Studio's own table: they are not films a person made). In memory when absent. */
  filmDb?: DatabaseSync;
  /** Model routing, as the film service takes it: the Vision role looks at the pictures. */
  roleModel?: FilmDeps["roleModel"];
  /** The Translation role (the captions service's own function): captions in a second language. */
  translate?: (input: { texts: string[]; source?: string; target: string; targetName: string }, deviceId: string, /** The run that pays: its translation is charged to the run, not to the device. */ runId: string, /** The run's account, asked before every call the translation makes (first, repair, fallback); its `turn` carries a translation by a runtime's model. */ payer: { reserve(estimateUsd: number | null): () => void; turn: WorkflowRuns["turn"] }) => Promise<{ translations: string[] }>;
  /** What the Translation role would charge for this many characters, and who translates; null when nobody can. */
  translateQuote?: (characters: number) => { usd: number | null; label: string; /** The translator runs on the person's own signed-in account (ruling R9): no part of the quote. */ ownAccount?: boolean } | null;
  /** What the turns of a session have cost so far (Usage); null when not known. Default: asked of this host's `jagentchill.usage.session.get`. */
  turnCost?: (sessionKey: string) => Promise<number | null>;
  /**
   * What the host knows of the model a session turn runs on, for what one request to it costs (ruling R10): whether a
   * turn is billed by the call at all (a runtime's own sign-in is a plan: not billed), its price by the token, the
   * limit of its answer and what a first request to it was measured to carry. Undefined: the host does not know the
   * model. Absent: nothing is known of any model — every turn's price is "not known".
   */
  turnModel?: (ref: { runtimeId: string; providerId: string; modelId: string }) => {
    billedByCall: boolean; /** The runtime's name as a person knows it ("Claude Code"): whose account a turn that is not billed by the call runs on. */ account?: string; price?: { inputPerMillionUsd: number; outputPerMillionUsd: number };
    /** The limit the provider enforces on the answer: the `max_tokens` the host sends when it knows it (a custom endpoint's model), else the model's documented maximum output. Absent: neither is known. */
    maxOutputTokens?: number;
    /** MEASURED: the prompt of a FIRST request of a session to this model on this host, as the provider counted it (the runtime's system prompt and tools with it). Absent: the model has not run here yet. */
    overheadTokens?: number;
    /** Not read for a price since ruling R10 (the whole window is not the size of a request). */
    contextWindow?: number;
  } | undefined;
  /** MEASURED: what the next request of a session carries of its history (its last prompt and that turn's answer, as the provider counted them). Undefined: the session has no measured turn — its next request is priced like a first one of its model. */
  turnContext?: (sessionKey: string) => number | undefined;
  /** Another channel method of this host, called for the same connection (the run's budget is a budget of the usage service). */
  rpc?: (method: string, params: unknown, connection: Connection) => Promise<unknown>;
  /** The same, answered in the call itself (not later): what the method returns as it returns it. A limit that must stand BEFORE something is sent is set through this. */
  call?: (method: string, params: unknown, connection: Connection) => unknown;
};
const VIDEO_FILMS = "CREATE TABLE IF NOT EXISTS video_films (run_id TEXT PRIMARY KEY, film_id TEXT NOT NULL, hash TEXT NOT NULL, created_ms INTEGER NOT NULL) STRICT;";

const READ: Scope = "jagentchill.projects.read", RUN: Scope = "jagentchill.generation.run";
const failure = (code: string, message: string, extra: { retryable?: boolean; details?: Record<string, unknown> } = {}) => Object.assign(new Error(message), { code, ...extra });
/** A video is many pictures: like a film's, they are made at the low quality tier (about a tenth of the default price on the bundled image model). */
const IMAGE_QUALITY = "low" as const;
const paramsSchema = z.object({
  prompt: z.string().max(20_000), targetDuration_s: z.number().int(), aspectRatio: z.enum(pv.ASPECT_RATIOS), resolution: z.enum(pv.RESOLUTIONS), frameRate: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(60)]),
  language: z.string().min(2).max(16), style: z.string().max(500), voice: z.string().min(1).max(80), musicMood: z.enum(pv.MUSIC_MOODS), captions: z.boolean(), mode: z.enum(pv.RUN_MODES),
  model: z.object({ runtimeId: z.string().min(1).max(120), providerId: z.string().min(1).max(120), modelId: z.string().min(1).max(200) }).strict().nullable().optional(),
  script: z.string().max(pv.SCRIPT_MAX).optional(), secondCaptionLanguage: z.string().min(2).max(16).nullable().optional(), budgetUsd: z.number().min(0.01).max(100_000).nullable().optional(),
}).strict();
const id = z.string().min(1).max(64);
const shotSchema = z.object({ runId: id, shotId: id, action: z.enum(["delete", "restore", "replace"]), blobId: z.string().regex(/^[0-9a-f]{64}$/).optional(), name: z.string().max(200).optional(), width: z.number().int().min(1).max(20_000).optional(), height: z.number().int().min(1).max(20_000).optional() }).strict();
const budgetSchema = z.object({ runId: id, budgetUsd: z.number().min(0.01).max(100_000) }).strict();
const LANGUAGE_NAMES: Record<string, string> = { en: "English", vi: "Vietnamese", ja: "Japanese", es: "Spanish", fr: "French", de: "German", pt: "Portuguese", ko: "Korean", zh: "Chinese" };
const modelNames = z.array(z.string().min(1).max(200)).max(20);
const formSchema = z.object({ params: paramsSchema, counts: z.object({ shots: z.number().int().min(1).max(200), spoken: z.number().int().min(0).max(500) }).strict().optional(), /** The amount a person confirmed for the whole run (the high estimate they were shown, or more). */ confirmedUsd: z.number().min(0).max(100_000).optional(), /** The models whose price is not known that the person was told of BY NAME on that question: their start allows the run to use them. */ allowUnpriced: modelNames.optional() }).strict();
const confirmSchema = z.object({ runId: id, confirmedUsd: z.number().min(0.0001).max(100_000).optional(), allowUnpriced: modelNames.optional() }).strict().refine((value) => value.confirmedUsd !== undefined || !!value.allowUnpriced?.length);
export { CONFIRMED_SHARE };

const json = (value: unknown): string => JSON.stringify(value, null, 1);
const rules = "Answer with ONE JSON object and nothing else: no prose, no code fence.";
/** The words each writing step sends. The marker in the first line names the step. */
export const PROMPTS = {
  brief: (p: pv.VideoParams) => [
    "[[jc-video:brief]] You plan a short video. Write its brief.", rules,
    p.prompt?.trim() ? `Request: """${p.prompt.trim()}"""` : "The person wrote the script themselves; plan the video that script is.",
    ...(p.script?.trim() ? [`The person's own script — it is spoken exactly as written, so the brief follows it: """${p.script.trim().slice(0, 6000)}"""`] : []),
    `Settings: ${p.targetDuration_s} s long, aspect ratio ${p.aspectRatio}, language ${p.language}, ${pv.narrated(p) ? "with a narrator's voice" : "with NO spoken voice (words appear on screen)"}, music mood ${p.musicMood}.`,
    pv.styleDescriptor(p.style) ? `Requested look: ${pv.styleDescriptor(p.style)}` : `Choose the look yourself; you may name one of these presets in visualStyle.presetId: ${pv.STYLE_PRESETS.map((preset) => preset.id).join(", ")}.`,
    `Fields: title (1-80 chars); intent (one of ${pv.INTENTS.join(", ")}); audience; tone; keyMessages (1-7 of {text, evidence} — evidence quotes the request or is "assumption"); structure (2-12 beats of {label, targetDuration_s} summing to ${p.targetDuration_s}); visualStyle {presetId?, text (the look, 1-500 chars), palette (3-6 hex colours)}; narrationPolicy ("voiceover", "dialogue" or "none"); musicDirection (0-300 chars); constraints {mustInclude[], mustAvoid[]}; assumptions (0-10 of {text}); openQuestions (0-5 of {id, question, suggestedAnswers (2-4)}) — only what you truly cannot decide.`,
  ].join("\n"),
  script: (p: pv.VideoParams, brief: pv.Brief) => [
    "[[jc-video:script]] You write the script of a short video from its brief.", rules,
    `Language: ${p.language}. ${pv.narrated(p)
      ? `The spoken text of all segments together must take ${pv.speechTarget_s(p).toFixed(1)} s to read aloud (±10 %) at a natural pace (about 2.5 English words a second).`
      : `There is NO voice: use kind "on-screen-text" (short lines shown on screen) or "silent", and give each segment estimatedDuration_s; together they must last ${p.targetDuration_s} s (±10 %).`}`,
    "Fields: title; segments — an ordered list of {beatLabel, kind (\"narration\", \"dialogue\", \"on-screen-text\" or \"silent\"), speaker (for dialogue), text (0-400 chars), estimatedDuration_s}. One segment is one or two sentences.",
    `Brief: ${json(brief)}`,
  ].join("\n"),
  shots: (p: pv.VideoParams, brief: pv.Brief, script: pv.Script) => [
    "[[jc-video:shots]] You turn a script into a shot list. One picture is made for every shot, so describe what is SEEN.", rules,
    "Fields: shots — an ordered list of {segmentIds (ids of the script segments heard or shown during the shot, at least one), duration_s (1-15), description (what the picture shows, 1-800 chars, no spoken words), " +
      `shotSize (one of ${pv.SHOT_SIZES.join(", ")}), cameraMotion (one of ${pv.CAMERA_MOTIONS.join(", ")}), subjects (0-6 names), setting, onScreenText (0-120 chars, usually empty), transitionOut ("cut")}.`,
    `Every segment id must appear in at least one shot, in script order. Aim for one shot every 3-5 s (about ${pv.assumedShots(p.targetDuration_s)} shots).`,
    `Look: ${brief.visualStyle.text}`,
    `Script segments: ${json(script.segments.map(({ id, kind, text, estimatedDuration_s }) => ({ id, kind, text, estimatedDuration_s })))}`,
  ].join("\n"),
};

export function createPromptVideo(deps: PromptVideoDeps) {
  const { now } = deps;
  const service = (): GenerationService => { const found = deps.generation(); if (!found) throw failure("UNAVAILABLE", "This host has no generation service."); return found; };
  const available = (capability: GenerationCapability): boolean => deps.generation()?.available(capability) === true;
  const notesOf = (context: wf.ExecutorContext): unknown => (context.scope.vars?.__notes as Record<string, unknown> | undefined)?.[context.node.id] ?? null;
  const input = <T,>(context: wf.ExecutorContext, name: string): T => context.inputs[name] as T;

  // — writing: a session turn, its answer checked against the contract, with the problems sent back twice at most —
  async function write<T>(context: wf.ExecutorContext, run: Parameters<StepTool>[1], what: string, prompt: string, check: (raw: unknown) => T): Promise<T> {
    const notes = notesOf(context), model = input<pv.VideoParams>(context, "params").model;
    let message = typeof notes === "string" && notes.trim() ? `${prompt}\nThe person asked for these changes to the previous ${what}: """${notes.trim().slice(0, 2000)}"""` : prompt, last: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      const turn = await workflowsOfRun().runs.turn(run.deviceId, { ...(model ? { ref: model } : { role: "director" }), title: `${run.workflowName} #${run.number} · ${context.node.name}`, message, signal: context.signal, onSession: context.setSession });
      try {
        const raw = pv.extractJson(turn.text);
        if (raw === undefined) throw new pv.ContractError(`The ${what} is not valid`, ["the answer is not a JSON object"]);
        return check(raw);
      } catch (error) {
        if (!(error instanceof pv.ContractError)) throw error;
        last = error;
        context.log("warn", `${error.message} — asking for a correction (${attempt + 1} of 2).`);
        message = `${prompt}\nYour previous answer was not accepted:\n${error.problems.map((problem) => `- ${problem}`).join("\n")}\nPrevious answer: ${turn.text.slice(0, 6000)}\nAnswer again with the complete corrected JSON object.`;
      }
    }
    throw failure((last as pv.ContractError).code, (last as Error).message, { details: { problems: (last as pv.ContractError).problems } });
  }

  // — generation: one job of the generation service per file —
  type Made = { file: pv.MediaFile; costUsd: number };
  async function generate(context: wf.ExecutorContext, run: Parameters<StepTool>[1], capability: GenerationCapability, params: GenerationParams, name: string, fresh = false): Promise<Made> {
    // The guarded service: the job's estimate is reserved against what was confirmed for the run before the job exists.
    const generation = money.generation() ?? service(), base = { capability, sessionId: `run:${run.runId}`, reuse: true, confirmed: true, ...(fresh ? { cache: "bypass" as const } : {}) };
    let job: GenerationJob;
    try {
      let accepted = params;
      // A model that does not offer the wanted shape still makes the picture, in its own.
      try { generation.prepare({ ...base, params }); } catch (error) { if ((error as { code?: string }).code !== "INVALID_PARAMS" || !params.aspectRatio) throw error; const { aspectRatio: _aspect, ...rest } = params; accepted = rest; }
      job = await generation.settled(generation.create({ ...base, params: accepted }, { deviceId: run.deviceId, by: "agent", sessionId: `run:${run.runId}`, priority: "batch" }).jobId);
    } catch (error) {
      const known = error as { code?: string; message?: string; details?: Record<string, unknown> };
      if (known.code === "BUDGET_EXCEEDED") throw failure("BUDGET_EXCEEDED", known.message ?? "A spending limit of this host was reached.", { details: known.details });
      throw error;
    }
    if (context.signal.aborted) throw failure("CANCELLED", "The step was cancelled.");
    if (job.state !== "succeeded" || !job.results[0]) {
      const error = job.error ?? { class: "unknown", message: "The provider returned nothing", action: "", retryable: false };
      throw failure(error.class === "budget_exceeded" ? "BUDGET_EXCEEDED" : error.class === "content_blocked" ? "CONTENT_BLOCKED" : "PROVIDER_ERROR", error.message, { details: { class: error.class, jobId: job.jobId } });
    }
    const asset = job.results[0];
    return {
      file: { blobId: asset.blobId, name: `${name}.${asset.name.split(".").pop() ?? "bin"}`, kind: asset.kind === "image" ? "image" : "audio", bytes: asset.size, ...(asset.width ? { width: asset.width, height: asset.height } : {}), ...(asset.durationSeconds ? { duration_ticks: Math.round(asset.durationSeconds * pv.TICKS) } : {}), provenance: { ...asset.provenance } },
      costUsd: job.actualUsd ?? 0,
    };
  }
  const stops = (error: unknown): boolean => ["BUDGET_EXCEEDED", "CANCELLED", "UNAVAILABLE"].includes(String((error as { code?: string }).code));
  /** What a run has paid for one capability so far, from the generation ledger: a stage that ran again adds to it, a cache hit adds nothing. */
  const spent = (run: Parameters<StepTool>[1], capability: GenerationCapability): number =>
    Math.round(service().ledgerRows().filter((row) => row.session_id === `run:${run.runId}` && row.capability === capability).reduce((sum, row) => sum + (Number(row.actual_usd) || 0), 0) * 10_000) / 10_000;

  // — the working film of a run: the film engine's own service over a store of its own —
  const filmDb = deps.filmDb ?? new DatabaseSync(":memory:");
  filmDb.exec(VIDEO_FILMS);
  // — the money of a run: one confirmation, and a guard in front of every paid request (see `prompt-video-money.ts`) —
  const turnCost = deps.turnCost ?? (deps.rpc ? async (sessionKey: string): Promise<number | null> => {
    try { return Number(((await deps.rpc!("jagentchill.usage.session.get", { sessionId: sessionKey }, { deviceId: "", role: () => "admin", scopes: () => [READ] } as unknown as Connection)) as { session?: { agentCostUsd?: number } }).session?.agentCostUsd ?? 0); } catch { return null; }
  } : undefined);
  type ModelRef = { runtimeId: string; providerId: string; modelId: string };
  const refOfRole = (role: string): ModelRef | null => { try { const routed = deps.roleModel?.(role); return routed ? { runtimeId: routed.runtimeId, providerId: routed.providerId, modelId: routed.modelId } : null; } catch { return null; } };
  /** Ruling R9, the gate's one classification: the model runs on the person's own signed-in account (Claude Code, Codex) — not billed by this app. */
  const ownAccount = (ref: ModelRef, known: ReturnType<NonNullable<PromptVideoDeps["turnModel"]>>): boolean => { try { if ((deps.generation()?.gate as GenerationService["gate"] | undefined)?.billingOf?.({ ref }) === "own_account") return true; } catch { /* the gate cannot say: what the host knows of the model decides */ } return !!known && !known.billedByCall; };
  /**
   * What one request of a turn on this model costs — coordinator's ruling R10 (2026-10-08). NOT the model's whole
   * context window (that asked a person to approve over $20 for one short turn on a 200k model):
   *  - what goes IN: the prompt as it was MEASURED for this model on this host — for a turn that continues a session,
   *    that session's last prompt and its answer as the provider counted them (`turnContext`); for a first turn, what a
   *    first request to this model carried here (`overheadTokens`: the runtime's system prompt and tools are in it) —
   *    plus the message being sent, counted by its BYTES (a token is at least one byte, so that part is a ceiling and
   *    no characters-per-token constant is used) — at the input price;
   *  - what comes OUT: the limit the provider enforces (`maxOutputTokens`: the `max_tokens` the host sends, else the
   *    model's documented maximum output — the model cannot write more) — at the output price. Never rounded down.
   * The input side is a measurement, so the amount is marked `measured` and a screen says "about".
   * null ("price not known") when: the model has no price; it has not run on this host yet (nothing measured); or no
   * maximum output is known for it. No number is put in place of any of those. A model on the person's own account (ruling R9) is not billed by this app: 0, marked, no part of any quote.
   * (Before a run the message of a step is known only as far as it is written: `message` is then that part, and the
   * turn is reserved with its whole message when it is sent — the run's 120 % guard holds the difference. Pictures
   * sent with a message are counted only as far as the measurement has them.)
   */
  function boundOf(ref: ModelRef, turn: { message?: string; sessionKey?: string } = {}): TurnBound {
    const known = deps.turnModel?.(ref), base = { model: ref.modelId, provider: ref.providerId };
    if (ownAccount(ref, known)) return { ...base, usd: 0, ownAccount: true, ...(known?.account ? { account: known.account } : {}) };
    if (!known?.price) return { ...base, usd: null };
    const { inputPerMillionUsd, outputPerMillionUsd } = known.price;
    if (inputPerMillionUsd === 0 && outputPerMillionUsd === 0) return { ...base, usd: 0 };
    let carried: number | undefined;
    try { carried = turn.sessionKey ? deps.turnContext?.(turn.sessionKey) : undefined; } catch { carried = undefined; }
    carried ??= known.overheadTokens;
    const inputTokens = carried === undefined ? undefined : carried + Buffer.byteLength(turn.message ?? "", "utf8"), outputTokens = known.maxOutputTokens;
    if ((inputPerMillionUsd > 0 && inputTokens === undefined) || (outputPerMillionUsd > 0 && outputTokens === undefined)) return { ...base, usd: null };
    return { ...base, usd: Math.ceil((inputTokens ?? 0) * inputPerMillionUsd + (outputTokens ?? 0) * outputPerMillionUsd - 1e-9) / 1e6, measured: true };
  }
  /** The bound of a turn as it is about to be sent: on the model it names, or the one its role is routed to; with its message, and the session it continues when it continues one. */
  const turnBound = (input: Parameters<WorkflowRuns["turn"]>[1]): TurnBound => {
    const ref = input.ref ?? refOfRole(input.role ?? "director");
    return ref ? boundOf(ref, { ...(typeof input.message === "string" ? { message: input.message } : {}), ...(input.sessionKey ? { sessionKey: input.sessionKey } : {}) }) : { model: input.role ?? "director", usd: null, routed: false };
  };
  const money = createRunMoney({ db: filmDb, now, generation: deps.generation, turnBound, ...(turnCost ? { turnCost } : {}), restOf: (runId) => restOf(runId), askOf: (runId) => askOf(runId), runBudget: (runId) => runBudgetOf(runId) });
  /** The run's own hard budget ("Budget for this run": a budget of the host whose scope is the run), read as the host holds it now; null: none. */
  const runBudgetOf = (runId: string): number | null => {
    if (!deps.call) return null;
    try {
      const answer = deps.call("jagentchill.provider.budget.list", {}, { deviceId: "" } as Connection);
      if (answer instanceof Promise) { answer.catch(() => undefined); return null; }
      const found = ((answer as { budgets?: { scope: string; scopeId?: string; limitUsd: number; hardStop?: boolean }[] }).budgets ?? []).find((entry) => entry.scope === "session" && entry.scopeId === `run:${runId}` && entry.hardStop === true);
      return found ? found.limitUsd : null;
    } catch { return null; }
  };
  const guardedRuns = new WeakMap<object, WorkflowRuns>();
  /** The workflow service as the run's makers get it: a session turn asked from inside a step is the run's (guarded, and its cost counted). */
  const workflowsOfRun = (): ReturnType<PromptVideoDeps["workflows"]> => {
    const real = deps.workflows();
    let runs = guardedRuns.get(real.runs);
    if (!runs) {
      runs = new Proxy(real.runs, { get(target, name) { if (name === "turn") return money.turn(target.turn.bind(target)); const value = Reflect.get(target, name, target) as unknown; return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value; } });
      guardedRuns.set(real.runs, runs);
    }
    return { ...real, runs };
  };
  const films = createFilmService({ db: filmDb, now, broadcast: () => undefined, workflows: workflowsOfRun, turnsGuarded: true, generation: () => money.generation(), sync: deps.sync, ...(deps.roleModel ? { roleModel: deps.roleModel } : {}) });
  type Artifacts = { params: pv.VideoParams; brief: pv.Brief; script: pv.Script; shotList: pv.ShotList };
  const madeOf = (context: wf.ExecutorContext): Artifacts => ({ params: input(context, "params"), brief: input(context, "brief"), script: input(context, "script"), shotList: input(context, "shotList") });
  const filmIdOf = (runId: string): string | undefined => (filmDb.prepare("SELECT film_id FROM video_films WHERE run_id = ?").get(runId) as { film_id: string } | undefined)?.film_id;
  /**
   * The working film of a run, brought to what the run now says (synchronous: two steps never make two films). A shot
   * or a line whose words a person changed is outdated alone, so only it is made again.
   */
  function filmOf(run: Parameters<StepTool>[1], made: Artifacts): fm.Film {
    const wanted = pv.workingFilm(made.params, made.brief, made.script, made.shotList), hash = wf.hashOf(wanted);
    const row = filmDb.prepare("SELECT film_id, hash FROM video_films WHERE run_id = ?").get(run.runId) as { film_id: string; hash: string } | undefined;
    try {
      if (!row) {
        const film = films.create({ title: `Video ${run.number} ${run.runId.slice(0, 8)}`, aspectRatio: made.params.aspectRatio, language: made.params.language });
        filmDb.prepare("INSERT INTO video_films (run_id, film_id, hash, created_ms) VALUES (?, ?, ?, ?)").run(run.runId, film.id, hash, now());
        return films.mutate(film.id, [{ op: "film.set", fields: { ...wanted.fields, musicMood: "none" } }, { op: "breakdown.set", breakdown: wanted.breakdown }]);
      }
      if (row.hash === hash) return films.read(row.film_id);
      const ops = pv.filmSyncOps(films.read(row.film_id), wanted), film = ops.length ? films.mutate(row.film_id, ops) : films.read(row.film_id);
      filmDb.prepare("UPDATE video_films SET hash = ? WHERE run_id = ?").run(hash, run.runId);
      return film;
    } catch (error) {
      if (error instanceof fm.FilmError) throw failure(error.code, error.message, { details: error.details });
      throw error;
    }
  }
  /** A film stage, run for the working film of this step's run: the same context, with the film named as its parameter. */
  const filmStage = (name: "jc_film_panels" | "jc_film_voice", context: wf.ExecutorContext, run: Parameters<StepTool>[1], filmId: string): Promise<wf.ExecutorResult> =>
    films.tools.get(name)!({ ...context, inputs: { params: { filmId }, before: context.inputs.before, decision: context.inputs.decision } }, run);
  /** What a run has paid so far for everything (pictures, speech, listening, music), from the generation ledger. */
  const spentAll = (run: { runId: string }): number => money.spentOf(run.runId);
  /** Notes of a "run again" are acted on once per attempt of the step: a retry after a failure does not repeat them. */
  const acted = new Set<string>();
  const once = (context: wf.ExecutorContext): boolean => { const key = `${context.runId}:${context.node.id}:${context.attempt}`; if (acted.has(key)) return false; acted.add(key); return true; };
  // A picture a person put in place of a generated one is marked, so nobody reads it as "not checked".
  filmDb.exec("CREATE TABLE IF NOT EXISTS video_replaced (film_id TEXT NOT NULL, shot_id TEXT NOT NULL, blob_id TEXT NOT NULL, PRIMARY KEY (film_id, shot_id)) STRICT;");
  const replaced = (filmId: string, shotId: string, on: boolean): void => { const blobId = films.read(filmId).panels.find((panel) => panel.id === shotId)?.picture.current?.media.blobId; if (on && blobId) filmDb.prepare("INSERT INTO video_replaced (film_id, shot_id, blob_id) VALUES (?, ?, ?) ON CONFLICT(film_id, shot_id) DO UPDATE SET blob_id = excluded.blob_id").run(filmId, shotId, blobId); };
  /** The pictures of a working film by shot, in the film's own order of panels (ids are the shots'). */
  const mediaOf = (filmId: string, film: fm.Film, shotList?: pv.ShotList): pv.ShotMedia[] => {
    const own = new Map((filmDb.prepare("SELECT shot_id, blob_id FROM video_replaced WHERE film_id = ?").all(filmId) as { shot_id: string; blob_id: string }[]).map((row) => [row.shot_id, row.blob_id]));
    const list = shotList ?? { shots: film.panels.map((panel, index) => ({ id: panel.id, index, segmentIds: [], duration_ticks: panel.duration_ticks, description: panel.action, shotSize: "medium" as const, cameraMotion: "static" as const, subjects: [], setting: "", onScreenText: "", transitionOut: "cut" })) };
    return pv.shotMediaOfFilm(film, list).map((entry) => (entry.media && own.get(entry.shotId) === entry.media.blobId ? { ...entry, replaced: true } : entry));
  };
  const numbers = (shotList: pv.ShotList, ids: readonly string[]): string => ids.map((shotId) => `Shot ${(shotList.shots.find((shot) => shot.id === shotId)?.index ?? 0) + 1}`).join(", ");

  // — the one money question of a run: what its starter confirmed, and the guard that stops a run about to pass it —
  const confirmedOf = money.confirmedOf, confirm = money.confirm;
  const priceOf = (capability: GenerationCapability, params: GenerationParams): number => { try { return available(capability) ? service().prepare({ capability, params }).estimate.amountUsd ?? 0 : 0; } catch { return 0; } };
  const PRICED = { image: () => priceOf("image", { prompt: "a picture", quality: IMAGE_QUALITY }), speech: () => priceOf("tts", { text: "One spoken line of the script, of ordinary length." }), music: () => priceOf("music", { prompt: "music", instrumental: true }) };
  /** What the run would still make from here, at list prices: the pictures and the lines its working film lacks. */
  function restOf(runId: string): number {
    const filmId = filmIdOf(runId);
    if (!filmId || !deps.generation()) return 0;
    const film = films.read(filmId);
    const lines = film.lines.filter((line) => !fm.activeTake(line)).length;
    return money4(film.panels.filter((panel) => !panel.leftOut && !panel.picture.current).length * PRICED.image() + lines * (PRICED.speech() + (deps.generation()?.listener(4)?.estimateUsd ?? 0)));
  }
  /** The estimate of a run nobody confirmed an amount for, as its question shows it. */
  function askOf(runId: string): Record<string, unknown> & { amountUsd: number } {
    try { const made = estimate((deps.workflows().runs.get(runId) as { run: { params: Record<string, unknown> } }).run.params as unknown as pv.VideoParams).estimate; return estimateDetails(made); } catch { return { amountUsd: 0 }; }
  }
  /**
   * Before anything a step pays for: the run's money question has an answer. A run a person follows that was started
   * past the one door (`startRun`) is asked here — it stops like a run that reached a budget, with the whole estimate,
   * until a person confirms (`…video.confirm`). A run nobody follows has the cost limit its automation was given, and
   * without one it pays for nothing.
   */
  function covered(run: Parameters<StepTool>[1], p: pv.VideoParams): void {
    if (money.limitOf(run.runId) || !deps.generation()) return;
    if (deps.workflows().runs.record(run.runId).attended !== true) {
      const limit = deps.workflows().automations?.limitOf(run.runId);
      if (!limit) throw failure("BUDGET_EXCEEDED", "This run was started with nobody present and has no cost limit: it pays for nothing. Give the automation's instruction the most a run may cost.", { details: { reason: "cost_limit_required", scope: "run_cost_limit", runId: run.runId } });
      // Its automation's limit, and its automation's own word on models whose price is not known (off unless a person turned it on).
      money.cap(run.runId, limit.capUsd, limit.allowUnpriced === true);
      return;
    }
    const made = estimate(p).estimate;
    // Under the host's amount nobody has to be asked: the estimate is what the run is held to.
    if (!confirmationOf(made).needed) { confirm(run.runId, made.highUsd); return; }
    money.reserve(run.runId, 0);
  }
  /**
   * Before a stage that pays: a stage that as a whole would take the run past its stop is not begun (the person is
   * asked before the first picture, not after the third). Each request of the stage is then reserved one by one.
   */
  function guard(run: Parameters<StepTool>[1], nextUsd: number): void {
    if (nextUsd <= 0 || !deps.generation()) return;
    money.reserve(run.runId, nextUsd)();
  }

  const tools = new Map<string, StepTool>();
  tools.set("jc_video_write", async (context, run) => {
    const p = input<pv.VideoParams>(context, "params"), kind = String((context.node.config.args as { kind?: string } | undefined)?.kind);
    // The writing is paid work of the run like its pictures: it does not begin before the run's money question has an answer.
    covered(run, p);
    if (kind === "brief") return { outputs: { brief: pv.applyBriefDefaults(await write(context, run, "brief", PROMPTS.brief(p), (raw) => pv.normaliseBrief(raw, p))) } };
    const brief = input<pv.Brief>(context, "brief");
    if (kind === "script") {
      const notes = notesOf(context), own = p.script?.trim();
      // A person's own script is the script: nothing writes it again (unless they then ask for changes to it).
      if (own && !(typeof notes === "string" && notes.trim())) { context.log("info", "The script is the person's own: it is used as written."); return { outputs: { script: pv.scriptFromText(own, p, brief.title) } }; }
      const prompt = own ? `${PROMPTS.script(p, brief)}\nStart from the person's own script and keep its words wherever the changes allow: """${own.slice(0, 12_000)}"""` : PROMPTS.script(p, brief);
      // Narration carries the script: a narrated video whose script speaks almost nothing goes back to the writer.
      return { outputs: { script: await write(context, run, "script", prompt, (raw) => { const script = pv.normaliseScript(raw, p); pv.assertNarration("script", p, script); return script; }) } };
    }
    const script = input<pv.Script>(context, "script");
    return { outputs: { shotList: await write(context, run, "shot list", PROMPTS.shots(p, brief, script), (raw) => { const shotList = pv.normaliseShotList(raw, script, p); pv.assertNarration("shot list", p, script, shotList); return shotList; }) } };
  });
  /**
   * Pictures: the film engine's storyboard stage on the working film. Its summary says whether a person is needed (a
   * leave to send the run's pictures or recordings to a provider, or shots that could not be had); the questions are
   * worded for a video here.
   */
  tools.set("jc_video_assets", async (context, run) => {
    const made = madeOf(context), shots = made.shotList.shots;
    if (!available("image")) throw failure("NO_ROUTE", "No way to obtain pictures: connect an image provider under Settings, Providers, Generation.", { details: { capability: "image" } });
    covered(run, made.params);
    let film = filmOf(run, made), redrawn = 0;
    // "Make this shot again" / "Run again": the named shot, or every shot, is outdated — the stage then draws exactly those.
    const notes = notesOf(context) as { shotId?: string; all?: boolean } | null;
    if (notes && typeof notes === "object" && (context.node.config.args as { round?: string } | undefined)?.round !== "again" && once(context)) {
      const again = film.panels.filter((panel) => !!panel.picture.current && (notes.all === true || panel.id === notes.shotId));
      if (again.length) { film = films.mutate(film.id, again.flatMap((panel) => pv.redrawOps(panel))); redrawn = again.filter((panel) => !panel.leftOut).length; }
    }
    // A shot that is drawn again keeps its picture until the new one is there: it is paid work all the same.
    guard(run, (film.panels.filter((panel) => !panel.leftOut && !panel.picture.current).length + redrawn) * PRICED.image());
    const result = await filmStage("jc_film_panels", context, run, film.id);
    film = films.read(film.id);
    const told = (result.outputs?.summary ?? {}) as { made?: number; needs?: number; refusedIds?: string[]; leftOut?: number };
    const shotMedia = mediaOf(film.id, film, made.shotList), waiting = shotMedia.filter((entry) => entry.refused && !entry.media);
    let ask: { askTitle: string; ask: string } | undefined;
    if (waiting.length) {
      const policy = waiting.filter((entry) => entry.refused!.reason !== "picture").map((entry) => entry.shotId), wrong = waiting.filter((entry) => entry.refused!.reason === "picture").map((entry) => entry.shotId);
      ask = {
        askTitle: waiting.length === 1 ? "A shot could not be had" : "Some shots could not be had",
        ask: [
          policy.length ? `The image provider refused to draw ${policy.length === 1 ? "this shot" : "these shots"} under its content policy, also when asked in plainer words: ${numbers(made.shotList, policy)}.` : "",
          wrong.length ? `${wrong.length === 1 ? "This shot was" : "These shots were"} drawn ${fm.PICTURE_ATTEMPTS} times and the picture still is not the shot (it does not show it, or it carries lettering): ${numbers(made.shotList, wrong)}.` : "",
          "On the Shots tab, replace a shot with your own picture or delete it; or change its words in the shot list. Then approve: the shots you left as they are stay out of the video.",
        ].filter(Boolean).join(" "),
      };
    }
    if (ask) context.log("warn", `The pictures wait for a person: ${ask.askTitle}`);
    return { outputs: { summary: { shots: shots.length, made: told.made ?? 0, needs: ask ? Math.max(1, told.needs ?? 0) : 0, refusedIds: waiting.map((entry) => entry.shotId), leftOut: told.leftOut ?? 0, ...ask }, shotMedia, costUsd: spent(run, "image") } };
  });
  /** What the Pictures stage hands on: the picture of every shot that is in the video, and the shot list without the shots a person left out. */
  tools.set("jc_video_pictures", async (context, run) => {
    const made = madeOf(context), film = filmOf(run, made), all = mediaOf(film.id, film, made.shotList), leftOut = all.filter((entry) => entry.leftOut).map((entry) => entry.shotId);
    const shotList = pv.withoutLeftOut(made.shotList, leftOut), gone = new Set(leftOut), kept = all.filter((entry) => !gone.has(entry.shotId)), without = kept.filter((entry) => !entry.media);
    if (!shotList.shots.length) throw failure("INVALID_PARAMS", "Every shot was left out: the video has no picture. Bring a shot back on the Shots tab, or write the shot list again.", { details: { shotIds: leftOut } });
    if (without.length) throw failure("PROVIDER_ERROR", `${numbers(made.shotList, without.map((entry) => entry.shotId))} ${without.length === 1 ? "has" : "have"} no picture. Run Pictures again, replace the shot with your own picture, or delete it.`, { details: { shotIds: without.map((entry) => entry.shotId) } });
    if (leftOut.length) context.log("info", `${numbers(made.shotList, leftOut)} ${leftOut.length === 1 ? "was" : "were"} left out by a person: what ${leftOut.length === 1 ? "it" : "they"} showed is told over the shot before.`);
    const unchecked = kept.filter((entry) => !entry.check && !entry.replaced).length;
    if (unchecked) context.log("warn", `${unchecked} of ${kept.length} pictures were NOT checked against their shot (no Vision model is routed, or it could not be asked).`);
    return { outputs: { shotMedia: kept, shotList, leftOut: leftOut.length, costUsd: 0 } };
  });
  /**
   * Voice: the film engine's voice stage on the working film — every speaker recorded once and cut into lines, every
   * line listened to and compared with its words, a line that is not its words recorded again. The takes keep their
   * verdict, and the run names the lines that still do not match or that nobody could listen to.
   */
  tools.set("jc_video_voice", async (context, run) => {
    const made = madeOf(context), p = made.params, spoken = made.script.segments.filter(pv.isSpoken);
    if (!pv.narrated(p) || !spoken.length) return { outputs: { takes: [], costUsd: 0 } };
    if (!available("tts")) { context.log("warn", "VOICE_UNAVAILABLE: no speech provider is connected — the video has no narration."); return { outputs: { takes: [], costUsd: 0, skipped: "No speech provider is connected" } }; }
    covered(run, p);
    let film = filmOf(run, made), rerecorded = 0;
    const notes = notesOf(context) as { all?: boolean } | null;
    if (notes && typeof notes === "object" && notes.all === true && once(context)) { const again = film.lines.filter((line) => !!fm.activeTake(line)); if (again.length) { film = films.mutate(film.id, again.flatMap((line) => pv.rerecordOps(line))); rerecorded = again.length; } }
    guard(run, (film.lines.filter((line) => !fm.activeTake(line)).length + rerecorded) * PRICED.speech());
    const result = await filmStage("jc_film_voice", context, run, film.id);
    const takes = pv.takesOfFilm(films.read(film.id), made.script), missing = spoken.filter((segment) => !takes.some((take) => take.segmentId === segment.id));
    // A narration with a hole is not a narration.
    if (missing.length) throw failure("PROVIDER_ERROR", `${missing.length} of ${spoken.length} spoken lines have no recording. Retry makes only the missing ones.`, { details: { segmentIds: missing.map((segment) => segment.id) } });
    // What the voice has cost so far: the speech and the listening to it.
    return { outputs: { takes, summary: result.outputs?.summary ?? {}, costUsd: Math.round((spentAll(run) - spent(run, "image") - spent(run, "music")) * 10_000) / 10_000 } };
  });
  tools.set("jc_video_music", async (context, run) => {
    const p = input<pv.VideoParams>(context, "params"), brief = input<pv.Brief>(context, "brief");
    if (p.musicMood === "none") return { outputs: { music: null, costUsd: 0 } };
    if (!available("music")) { context.log("warn", "MUSIC_UNAVAILABLE: no music provider is connected — the video has no music."); return { outputs: { music: null, costUsd: 0, skipped: "No music provider is connected" } }; }
    const mood = p.musicMood === "auto" ? brief.tone : p.musicMood;
    covered(run, p);
    try {
      const made = await generate(context, run, "music", { prompt: `Instrumental background music, ${mood}. ${brief.musicDirection}`.trim().slice(0, 2000), instrumental: true }, "Music");
      return { outputs: { music: { media: made.file, mood } satisfies NonNullable<pv.MusicTrack>, costUsd: spent(run, "music") } };
    } catch (error) {
      // A video without music is still a video; a spending limit still stops the run.
      if (stops(error)) throw error;
      context.log("warn", `MUSIC_UNAVAILABLE: ${(error as Error).message}`);
      return { outputs: { music: null, costUsd: 0, skipped: (error as Error).message } };
    }
  });
  tools.set("jc_video_timing", async (context) => ({ outputs: pv.retime(input(context, "shotList"), input(context, "script"), input<pv.Take[]>(context, "takes") ?? [], input(context, "params")) }));
  tools.set("jc_video_captions", async (context, run) => {
    const p = input<pv.VideoParams>(context, "params"), voiceTrack = input<pv.VoiceTrack>(context, "voiceTrack");
    const captions: pv.CaptionSet = p.captions ? pv.buildCaptions(input(context, "script"), input(context, "shotList"), voiceTrack.takes.length ? voiceTrack : null, p) : { language: p.language, cues: [], warnings: [] };
    const second = p.secondCaptionLanguage;
    if (!second || !captions.cues.length) return { outputs: { captions } };
    // The second language is the Translation role's work, one caption for one; when it cannot be had the video keeps its own captions and says so.
    try {
      if (!deps.translate) throw failure("NO_ROUTE", "This host cannot translate.");
      covered(run, p);
      const translated: string[] = [];
      for (let at = 0; at < captions.cues.length; at += 40) {
        // Paid work of the run: EVERY call of it (the first, a repair, a fallback) is reserved at its estimate before it is
        // sent — one that would take the run past what was confirmed is not sent — and charged to the run.
        const payer = { reserve: (estimateUsd: number | null) => money.reserveFor(run.runId, estimateUsd, deps.translateQuote?.(40)?.label ?? "the translation model"), turn: workflowsOfRun().runs.turn };
        translated.push(...(await deps.translate({ texts: captions.cues.slice(at, at + 40).map((cue) => cue.text.replace(/\n/g, " ").slice(0, 500)), source: p.language, target: second, targetName: LANGUAGE_NAMES[second] ?? second }, run.deviceId, run.runId, payer)).translations);
      }
      context.log("info", `${translated.length} captions translated to ${LANGUAGE_NAMES[second] ?? second}.`);
      return { outputs: { captions: { ...captions, translationLanguage: second, cues: captions.cues.map((cue, index) => ({ ...cue, ...(translated[index] ? { translation: translated[index].slice(0, 500) } : {}) })) } satisfies pv.CaptionSet } };
    } catch (error) {
      if (["CANCELLED", "BUDGET_EXCEEDED"].includes(String((error as { code?: string }).code))) throw error;
      context.log("warn", `SECOND_CAPTIONS_UNAVAILABLE: ${(error as Error).message}`);
      return { outputs: { captions: { ...captions, warnings: [...captions.warnings, `SECOND_CAPTIONS_UNAVAILABLE: the captions were not translated to ${LANGUAGE_NAMES[second] ?? second} (${(error as Error).message.slice(0, 200)})`] } } };
    }
  });
  tools.set("jc_video_assemble", async (context, run) => {
    const { params: p, ...artifacts } = context.inputs as { params: pv.VideoParams; brief: pv.Brief; script: pv.Script; shotList: pv.ShotList; shotMedia: pv.ShotMedia[]; voiceTrack: pv.VoiceTrack; captions: pv.CaptionSet; music: pv.MusicTrack };
    // The same artifacts are the same project: a step started again after a restart finds the one it made.
    const version = wf.hashOf(artifacts), hex = createHash("sha256").update(`${run.runId}:${version}`).digest("hex");
    const projectId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    const built = pv.assembleProject(
      { runId: run.runId, runNumber: run.number, projectId, artifactVersionId: version.slice(0, 32), params: p, brief: artifacts.brief, script: artifacts.script, shotList: artifacts.shotList, shotMedia: artifacts.shotMedia, voiceTrack: artifacts.voiceTrack.takes.length ? artifacts.voiceTrack : null, captions: artifacts.captions.cues.length ? artifacts.captions : null, music: artifacts.music },
      { now_ms: now(), newId: randomUUID, writer: { id: `run:${run.runId}` }, registries: { effects: validatorEffectRegistry() as Registries["effects"], transitions: validatorTransitionRegistry() } },
    );
    const ref = { kind: "project" as const, id: projectId }, existing = deps.sync.documents.row(ref);
    if (!existing || existing.state === "purged") {
      const stored = deps.sync.blobs.put(gzipSync(Buffer.from(canonicalJson(built.document), "utf8")), { mime: "application/gzip", name: `project-${projectId}-r1.json.gz`, purpose: "snapshot" });
      deps.sync.documents.enable(ref, stored.sha256, built.document.schemaVersion, { kind: "host", principal: `run:${run.runId}` });
    }
    context.log("info", `Project "${built.document.metadata.name}": ${built.report.clips} clips, ${built.report.voiceElements} voice clips, ${built.report.captionCues} captions, ${built.report.musicElements} music clips.`);
    return { outputs: { project: { projectId, revision: 1, name: built.document.metadata.name }, report: built.report } };
  });
  tools.set("jc_video_checks", async (context) => {
    const inputs = context.inputs as { params: pv.VideoParams; project: { projectId: string }; brief: pv.Brief; script: pv.Script; shotList: pv.ShotList; shotMedia: pv.ShotMedia[]; voiceTrack: pv.VoiceTrack; captions: pv.CaptionSet; takes?: pv.Take[] };
    const row = deps.sync.documents.row({ kind: "project", id: inputs.project.projectId });
    if (!row || row.state !== "active") throw failure("NOT_FOUND", "The project of this run is no longer on the host. Run Assemble again.", { details: { projectId: inputs.project.projectId } });
    const document = deps.sync.documents.head(row) as unknown as ProjectDocument;
    const report = pv.reviewChecks(document, { ...inputs, voiceTrack: inputs.voiceTrack.takes.length ? inputs.voiceTrack : null, captions: inputs.captions.cues.length ? inputs.captions : null, stepWarnings: [...inputs.voiceTrack.warnings, ...inputs.captions.warnings] });
    return { outputs: { report: { ...report, project: inputs.project } } };
  });
  // Every step runs as its run: a session turn or a request made anywhere below it — also by the film engine — is the run's.
  for (const [name, tool] of [...tools]) tools.set(name, (context, run) => money.inRun(run.runId, () => tool(context, run)));

  // — the setup form —
  /** The price of one job of a capability on the model the host would use now, or null when no provider serves it. */
  function unit(capability: GenerationCapability, params: GenerationParams): pv.UnitPrice {
    if (!available(capability)) return null;
    try { const prepared = service().prepare({ capability, params }); return { usd: prepared.estimate.amountUsd, label: prepared.model.label }; } catch { return null; }
  }
  function estimate(given: pv.VideoParams, counts?: { shots: number; spoken: number }) {
    // A person's own script decides how long the video is — for the form's estimate exactly as for the start, so the amount the form shows is the amount the start asks for.
    let p = given;
    const own = given.script?.trim();
    if (own) { try { p = { ...given, targetDuration_s: pv.scriptDuration_s(pv.scriptFromText(own, given)) }; } catch { /* not a script yet: the start says what is wrong with it */ } }
    const prices = { image: unit("image", { prompt: "a picture", aspectRatio: pv.imageAspect(p.aspectRatio), quality: IMAGE_QUALITY }) ?? unit("image", { prompt: "a picture", quality: IMAGE_QUALITY }), speech: unit("tts", { text: "One spoken line of the script, of ordinary length." }), music: unit("music", { prompt: "music", instrumental: true }) };
    const made = withOtherPaidWork(pv.estimateRun(p, prices, counts), p);
    // What the host's spending limits leave, against the low figure.
    let blocked: { scope?: string; remainingUsd?: number } | undefined;
    if (prices.image && made.lowUsd > 0) { try { const found = service().prepare({ capability: "image", params: { prompt: "a picture", quality: IMAGE_QUALITY } }).estimate.blocked; if (found?.reason === "budget_exceeded") blocked = { scope: found.scope, remainingUsd: found.remainingUsd }; } catch { /* no route: listed below */ } }
    const generation = deps.generation();
    const voices = (generation ? generation.providers().flatMap((provider) => generation.models(provider.id)) : []).filter((model) => model.capability === "tts" && model.enabled).flatMap((model) => (model.metadata.voices ?? []).map((voice) => ({ voiceId: voice.voiceId, name: voice.name })));
    return { estimate: made, capabilities: { image: !!prices.image, speech: !!prices.speech, music: !!prices.music }, voices: available("tts") ? voices.slice(0, 200) : [], ...(blocked ? { blocked } : {}), confirmation: confirmationOf(made) };
  }
  /**
   * The rest of what a run pays for, so that the amount a person confirms covers it: the listening to every recorded
   * line (the read-back), the translation of the captions, and the session turns that write the brief, the script and
   * the shot list and look at the pictures. A turn is in the estimate at the most its request can cost (`boundOf`) —
   * the same figure it is reserved at before it is sent. A model whose price is not known has no amount: its row says
   * so, the totals leave it out (`unknown`), and it is named to the person, who alone can allow it.
   */
  function withOtherPaidWork(made: pv.RunEstimate, p: pv.VideoParams): pv.RunEstimate {
    const generation = deps.generation(), stages = made.stages.map((stage) => ({ ...stage })), spoken = stages.find((stage) => stage.stage === "voiceover")?.count ?? 0, shots = stages.find((stage) => stage.stage === "assets")?.count ?? 0;
    const round6 = (usd: number): number => Math.round(usd * 1e6) / 1e6, at = (stage: string) => stages.findIndex((entry) => entry.stage === stage);
    // A session turn is priced as `boundOf` prices a first request to its model (ruling R10): what such a request was
    // measured to carry on this host and the limit of the answer. (The step's own message does not exist before the run:
    // it is in the figure the turn is reserved at when it is sent.) A model whose price is not known has NO amount
    // (`null`): it is named, and left out of the totals.
    const ownAccounts: NonNullable<pv.RunEstimate["ownAccount"]> = [];
    const turnOn = (role: string, own: pv.VideoParams["model"] | undefined, message?: string): { label: string; usd: number | null; own?: true; account?: string; measured?: true } | null => {
      const ref = own ?? refOfRole(role);
      if (!ref) return null;
      const bound = boundOf(ref, message === undefined ? {} : { message });
      return { label: ref.modelId, usd: bound.usd, ...(bound.ownAccount ? { own: true as const } : {}), ...(bound.account ? { account: bound.account } : {}), ...(bound.measured ? { measured: true as const } : {}) };
    };
    /** Work on the person's own account: said in one quiet line, and in no amount, no row of the question and no list of unpriced models. */
    const onOwn = (label: string, turn: { label: string; account?: string }): void => { ownAccounts.push({ label, model: turn.label, ...(turn.account ? { account: turn.account } : {}) }); };
    const priced = (count: number, turn: { label: string; usd: number | null; measured?: true }) => ({ source: turn.label, ...(turn.usd === null ? { unitUsd: null, lowUsd: null, highUsd: null, note: "The price of this model is not known" } : turn.usd > 0 ? { unitUsd: turn.usd, lowUsd: round6(turn.usd * count), highUsd: round6(turn.usd * count), note: "About: what a request to this model was measured to carry on this host, and its longest answer", ...(turn.measured ? { measured: true as const } : {}) } : {}) });
    const writer = turnOn("director", p.model);
    for (const stage of stages) if (writer && ["brief", "script_draft", "shot_list"].includes(stage.stage) && !(stage.stage === "script_draft" && p.script?.trim())) { if (writer.own) { onOwn(stage.label, writer); Object.assign(stage, { source: writer.label, ownAccount: true as const }); } else Object.assign(stage, priced(Math.max(1, stage.count), stage.stage === "brief" ? turnOn("director", p.model, PROMPTS.brief(p))! : writer)); }
    const vision = turnOn("vision", undefined);
    if (vision?.own && shots) onOwn("Picture check", vision);
    else if (vision && shots) stages.splice(at("assets") + 1, 0, { stage: "picture_check", label: "Picture check", count: shots, unitUsd: 0, lowUsd: 0, highUsd: 0, ...priced(shots, vision) });
    const listener = spoken ? generation?.listener(Math.max(1, p.targetDuration_s / spoken)) : undefined;
    if (listener) { const unit = listener.estimateUsd; stages.splice(at("voiceover") + 1, 0, { stage: "voice_check", label: "Voice check", count: spoken, unitUsd: unit, lowUsd: unit === null ? null : round6(unit * spoken), highUsd: unit === null ? null : round6(unit * spoken * 2), source: listener.modelLabel }); }
    // Before the script exists nobody can count the captions: the row has no amount ("price not known", approved by the
    // model's name — or nothing to approve when the translator runs on the person's own account); each request is priced
    // from its real text when it is sent (`captions.translate`). No translator: the run says so and goes on without (no row).
    const quote = p.captions && p.secondCaptionLanguage ? deps.translateQuote?.(1) ?? null : null;
    if (quote?.ownAccount) onOwn("Caption translation", quote);
    else if (quote) stages.splice(at("assemble"), 0, { stage: "captions", label: "Caption translation", count: 1, unitUsd: quote.usd, lowUsd: quote.usd, highUsd: quote.usd, source: quote.label });
    const sum = (key: "lowUsd" | "highUsd") => money4(stages.reduce((total, stage) => total + (stage[key] ?? 0), 0));
    return { ...made, stages, lowUsd: sum("lowUsd"), highUsd: sum("highUsd"), unknown: stages.some((stage) => stage.count > 0 && stage.lowUsd === null), ...(ownAccounts.length ? { ownAccount: ownAccounts } : {}) };
  }
  /** The work of an estimate that runs on the person's own account, one line an account (ruling R9). */
  const ownLines = (made: pv.RunEstimate): { account: string; parts: string[] }[] => { const by = new Map<string, string[]>(); for (const entry of made.ownAccount ?? []) { const account = entry.account ?? entry.model; by.set(account, [...new Set([...(by.get(account) ?? []), entry.label])]); } return [...by].map(([account, parts]) => ({ account, parts })); };
  /** The models of an estimate whose price is not known, by the name a person is told (and allows them by). */
  const unpricedOf = (made: pv.RunEstimate): string[] => [...new Set(made.stages.filter((stage) => stage.count > 0 && stage.lowUsd === null && stage.source).map((stage) => String(stage.source)))].sort();
  /** An estimate as a refusal or a question carries it: the total, and every part that costs with its model. */
  const estimateDetails = (made: pv.RunEstimate) => ({ amountUsd: made.highUsd, lowUsd: made.lowUsd, highUsd: made.highUsd, unknown: made.unknown, unpricedModels: unpricedOf(made), ...(made.ownAccount?.length ? { ownAccount: made.ownAccount } : {}), stages: made.stages.filter((stage) => stage.count > 0 && stage.unitUsd !== 0).map((stage) => ({ stage: stage.stage, label: stage.label, count: stage.count, lowUsd: stage.lowUsd, highUsd: stage.highUsd, model: stage.source })) });
  /** The one money question of a run ("Ask before spending more than", 0 = always ask): whether this estimate needs it, and where the run would stop afterwards. */
  function confirmationOf(made: pv.RunEstimate): { needed: boolean; aboveUsd: number; amountUsd: number; stopsAtUsd: number; /** Models whose price is not known: named on the question, allowed by the person's start — never by anything else. */ unpricedModels: string[] } {
    const aboveUsd = deps.generation()?.thresholds().confirmAboveUsd ?? 0;
    return { needed: made.unknown || made.highUsd > aboveUsd, aboveUsd, amountUsd: made.highUsd, stopsAtUsd: money4(made.highUsd * CONFIRMED_SHARE), unpricedModels: unpricedOf(made) };
  }
  function parse(raw: unknown) {
    const parsed = formSchema.safeParse(raw ?? {});
    if (!parsed.success) throw new ProtocolError("WORKFLOW_INPUT_INVALID", "The settings of this video are not valid.", { details: { parameter: String(parsed.error.issues[0]?.path.slice(1).join(".") ?? "") } });
    const problem = pv.checkInput(parsed.data.params)[0];
    if (problem) throw new ProtocolError("WORKFLOW_INPUT_INVALID", problem.message, { details: { parameter: problem.field } });
    return parsed.data;
  }
  const methods = new Map<string, RpcMethod>();
  /** What the host's own budgets leave (the tightest one), for the confirmation: null when the host has no budget. */
  const budgetLeft = async (connection: Connection): Promise<{ scope: string; label?: string; remainingUsd: number } | null> => {
    if (!deps.rpc) return null;
    try {
      const listed = ((await deps.rpc("jagentchill.provider.budget.list", {}, connection)) as { budgets?: { scope: string; label?: string; remainingUsd?: number }[] }).budgets ?? [];
      const tight = listed.filter((entry) => entry.scope !== "session" && typeof entry.remainingUsd === "number").sort((a, b) => a.remainingUsd! - b.remainingUsd!)[0];
      return tight ? { scope: tight.scope, ...(tight.label ? { label: tight.label } : {}), remainingUsd: tight.remainingUsd! } : null;
    } catch { return null; }
  };
  methods.set("jagentchill.workflow.video.estimate", { scope: READ, handle: async (raw, connection) => { const form = parse(raw); return { ...estimate(form.params, form.counts), budget: await budgetLeft(connection) }; } });
  /** The budget of a run is a budget of the host like any other (scope: the run's generation session), so the generation service enforces it job by job. */
  /**
   * A model whose price is not known and that the PERSON allowed for this run by name (their Start, or their answer to
   * the run's question) is not then refused by the run's own budget for having no price: the budget would stop the run
   * at a model the person was told of and allowed, with nothing they could raise (the reader and the listener of a
   * video have no price that can be known before the sound exists). What such a model is billed still counts against
   * the budget, and a model nobody allowed is stopped by the run's own guard before the budget is asked.
   */
  const setBudget = async (runId: string, budgetUsd: number, connection: Connection): Promise<void> => {
    if (!deps.rpc) throw new ProtocolError("UNAVAILABLE", "This host has no budgets.");
    await deps.rpc("jagentchill.provider.budget.set", { budget: { scope: "session", scopeId: `run:${runId}`, limitUsd: budgetUsd, period: "total", hardStop: true, allowUnknownCost: money.unpricedOf(runId).length > 0 } }, connection);
  };
  /**
   * Starts a run: the one way in, for the setup form, for the generic start of a run and for an agent
   * (`jc_workflow_start`). `askInRun`: the amount the caller brings does not cover the estimate and no person is at
   * this door to be asked (an agent's start) — the run is created WITHOUT a confirmed amount, so its first step stops
   * and the person is asked in the run view; nothing is paid before they answer.
   */
  async function startRun(raw: unknown, actor: { deviceId: string; sessionKey?: string }, approvalOverride?: "auto" | "human", askInRun = false): Promise<WorkflowRunRecord> {
    const { params, confirmedUsd, allowUnpriced = [] } = parse(raw), own = params.script?.trim();
    if (!available("image")) throw new ProtocolError("NO_ROUTE", "No way to obtain pictures: connect an image provider under Settings, Providers, Generation.", { details: { capability: "image" } });
    // A person's own script decides how long the video is: it lasts as long as the script reads.
    let duration = params.targetDuration_s;
    if (own) { try { duration = pv.scriptDuration_s(pv.scriptFromText(own, params)); } catch (error) { throw new ProtocolError("WORKFLOW_INPUT_INVALID", (error as pv.ContractError).problems?.[0] ?? (error as Error).message, { details: { parameter: "script" } }); } }
    // Money is the person's decision, asked ONCE for the whole run: nothing starts until the amount they saw covers the estimate.
    const made = estimate({ ...(params as pv.VideoParams), targetDuration_s: duration }).estimate, asked = confirmationOf(made);
    // … and a model whose price is not known is used only when the person was told its name and started all the same.
    const uncovered = asked.needed && (confirmedUsd === undefined || confirmedUsd + 1e-9 < made.highUsd || asked.unpricedModels.some((model) => !allowUnpriced.includes(model)));
    if (uncovered && !askInRun) throw new ProtocolError("PERMISSION_DENIED", "Confirm the cost of this video first.", { details: { reason: "confirmation_required", estimate: estimateDetails(made), confirmAboveUsd: asked.aboveUsd, stopsAtUsd: asked.stopsAtUsd } });
    const override = approvalOverride ?? (params.mode === "auto" ? "auto" as const : undefined);
    const run = deps.workflows().runs.start({
      workflowId: pv.TEMPLATE_ID, params: { ...params, prompt: params.prompt.trim(), targetDuration_s: duration, ...(own ? { script: own } : { script: undefined }), ...(params.model ? {} : { model: undefined }), ...(params.secondCaptionLanguage ? {} : { secondCaptionLanguage: undefined }), ...(params.budgetUsd ? {} : { budgetUsd: undefined }) },
      ...(actor.sessionKey ? { origin: "agent" as const, originRef: { sessionKey: actor.sessionKey, deviceId: actor.deviceId } } : { origin: "user" as const, originRef: { deviceId: actor.deviceId } }), startedByDeviceId: actor.deviceId, attended: true,
      ...(override ? { approvalOverride: override } : {}),
    });
    // What the run is held to: the amount the person confirmed, or — when nobody had to be asked — the estimate.
    if (!uncovered) confirm(run.id, Math.max(confirmedUsd ?? 0, made.highUsd), asked.unpricedModels);
    if (params.budgetUsd) await setBudget(run.id, params.budgetUsd, { deviceId: actor.deviceId } as Connection);
    return run;
  }
  methods.set("jagentchill.workflow.video.start", { scope: RUN, handle: async (raw, connection) => ({ run: await startRun(raw, { deviceId: connection.deviceId }) }) });
  /**
   * The generic start of a run (`…workflow.run.create`) is no way around the money question: for this template it IS
   * the start above — same rules, same refusal (`confirmation_required` with the estimate), the confirmed amount in
   * `confirmedUsd`. Every other workflow goes to the workflow service untouched.
   */
  methods.set("jagentchill.workflow.run.create", {
    scope: RUN,
    handle: async (raw, connection) => {
      const asked = (raw ?? {}) as { workflowId?: unknown; params?: unknown; confirmedUsd?: unknown };
      if (asked.workflowId !== pv.TEMPLATE_ID) {
        const generic = deps.workflows().methods?.get("jagentchill.workflow.run.create");
        if (!generic) throw new ProtocolError("UNAVAILABLE", "This host cannot start runs.");
        return generic.handle(raw, connection);
      }
      const given = asked.params && typeof asked.params === "object" ? asked.params as Record<string, unknown> : {};
      return { run: await startRun({ params: { ...pv.DEFAULT_PARAMS, ...given }, ...(typeof asked.confirmedUsd === "number" ? { confirmedUsd: asked.confirmedUsd } : {}), ...(Array.isArray((asked as { allowUnpriced?: unknown }).allowUnpriced) ? { allowUnpriced: (asked as { allowUnpriced: string[] }).allowUnpriced } : {}) }, { deviceId: connection.deviceId }) };
    },
  });
  /** The same start as an agent asks for it: `prompt` and loose `params` over the defaults, checked by the same rules. */
  const agentForm = (input: StartInput, actor?: AgentActor): { params: Record<string, unknown> } => {
    const given = { ...(input.params ?? {}) };
    delete given.model;
    // The brief, the script and the shot list are written by the model the agent's own session runs on.
    return { params: { ...pv.DEFAULT_PARAMS, ...given, ...(actor?.model ? { model: actor.model } : {}), prompt: String(input.prompt ?? given.prompt ?? ""), ...(input.approvalOverride === "auto" ? { mode: "auto" } : input.approvalOverride === "human" ? { mode: "checkpoints" } : {}), ...(input.budgetUsd !== undefined ? { budgetUsd: input.budgetUsd } : {}) } };
  };
  // What an agent's session was told a start would cost. A permission card is made from ONE preview — the tool shows
  // that preview's words as the card's detail, right after it was computed — and is answered later. The amount the
  // person allowed is the amount of THAT preview: every preview is kept as it was said (never merged with another in
  // the same words), and every permission request of the host is bound, by its id, to the preview it was made from —
  // the newest one in its words at the moment the request is first seen, which is before any later preview is
  // recorded. A bound request starts one run. Never the estimate computed when the run starts, and never another
  // preview's (a dry run's, an earlier one's that reads the same to the cent). Kept in the store: an answer given
  // after a restart stands.
  filmDb.exec(`
    CREATE TABLE IF NOT EXISTS video_offer_previews (seq INTEGER PRIMARY KEY AUTOINCREMENT, session_key TEXT NOT NULL, form TEXT NOT NULL, detail TEXT NOT NULL, usd REAL NOT NULL, unpriced TEXT NOT NULL, shown_ms INTEGER NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS video_offer_bound (request_id TEXT PRIMARY KEY, session_key TEXT NOT NULL, form TEXT NOT NULL, usd REAL NOT NULL, unpriced TEXT NOT NULL, run_id TEXT, used_ms INTEGER) STRICT;
  `);
  /** The words of a preview as a permission card carries them (`jc_workflow_start` cuts the detail at 900 characters). */
  const cardWords = (detail: string): string => (detail.length > 900 ? `${detail.slice(0, 899)}…` : detail);
  type Card = { requestId: string; state?: string };
  /** The host's own permission requests of this session for a start, oldest first. Each was bound to the preview that made it when it was made (`starter.bind`): by identity, never by its words. */
  async function cards(actor: AgentActor): Promise<Card[]> {
    if (!deps.rpc) return [];
    let requests: { requestId: string; tool?: string; state?: string; detail?: string }[] = [];
    try { requests = ((await deps.rpc("jagentchill.chat.approval.list", { sessionKey: actor.sessionKey }, { deviceId: actor.deviceId, role: () => "admin", scopes: () => [READ] } as unknown as Connection)) as { requests?: typeof requests }).requests ?? []; } catch { return []; }
    const mine = requests.filter((request) => request.tool === "jc_workflow_start" && typeof request.requestId === "string");
    return mine.map((request) => ({ requestId: request.requestId, ...(request.state ? { state: request.state } : {}) }));
  }
  /** The permission request this start was allowed by, with exactly what its card showed; undefined when no card of this request was allowed (or it has started its run already). */
  async function approvedCard(input: StartInput, actor: AgentActor): Promise<{ requestId: string; usd: number; unpriced: string[] } | undefined> {
    // The newest allowed card of this very request that no start has used yet.
    for (const card of (await cards(actor)).reverse()) {
      if (card.state !== "allowed") continue;
      const bound = filmDb.prepare("SELECT usd, unpriced FROM video_offer_bound WHERE request_id = ? AND session_key = ? AND form = ? AND run_id IS NULL").get(card.requestId, actor.sessionKey, offerKey(input)) as { usd: number; unpriced: string } | undefined;
      if (bound) return { requestId: card.requestId, usd: bound.usd, unpriced: JSON.parse(bound.unpriced) as string[] };
    }
    return undefined;
  }
  const offerKey = (input: StartInput): string => wf.hashOf({ templateId: input.templateId, prompt: input.prompt ?? null, params: input.params ?? null, budgetUsd: input.budgetUsd ?? null, approvalOverride: input.approvalOverride ?? null });
  const agentEstimate = (input: StartInput, actor?: AgentActor) => { const form = agentForm(input, actor), p = parse(form).params as pv.VideoParams, own = p.script?.trim(), seconds = own ? pv.scriptDuration_s(pv.scriptFromText(own, p)) : p.targetDuration_s; return { form, p, own, seconds, made: estimate({ ...p, targetDuration_s: seconds }).estimate }; };
  const starter: TemplateStarter = {
    name: "One prompt → video",
    async preview(input, actor) {
      // The estimate of the run as it would start: written by the model the agent's own session runs on.
      const { p, own, seconds, made } = agentEstimate(input, actor), unpriced = unpricedOf(made);
      if (!available("image")) throw new ProtocolError("NO_ROUTE", "No way to obtain pictures: connect an image provider under Settings, Providers, Generation.", { details: { capability: "image" } });
      const detail = [
        own ? `A video from your own script (${own.length} characters), spoken as written.` : `A video about: “${p.prompt.trim().slice(0, 300)}”`,
        `${seconds} s, ${p.aspectRatio}, ${LANGUAGE_NAMES[p.language] ?? p.language}, ${pv.narrated(p) ? "with a voice" : "no voice"}, music: ${p.musicMood}, captions ${p.captions ? "on" : "off"}.`,
        // (Ruling R10: with a writing or looking turn priced from a measured request, the amount is said with "about".)
        `Estimated cost ${made.stages.some((stage) => stage.measured && (stage.highUsd ?? 0) > 0) ? "about " : ""}${made.lowUsd === made.highUsd ? dollars(made.lowUsd) : `${dollars(made.lowUsd)} – ${dollars(made.highUsd)}`}: ${made.assumptions.slice(0, 2).join(", ")}.${p.budgetUsd ? ` Budget ${dollars(p.budgetUsd)}.` : ""}`,
        // Said plainly, by name: allowing this card is the person's leave to use these models.
        ...unpriced.map((model) => `The price of ${model} is not known: what it costs is not in this amount. Allowing this lets the run use it.`),
        // Ruling R9: one quiet line, no amount and nothing to allow.
        ...ownLines(made).map((line) => `${line.parts.join(", ")}: on your own ${line.account} account — not billed by this app.`),
        p.mode === "auto" ? "Runs to the end without the checkpoints; a refused picture still waits for you." : "Stops for you at the brief, the script, the shot list and the review.",
        ...made.willRunWithout.map((line) => `Without ${line}.`),
      ].join("\n");
      // Every preview is kept as it was said, under an identity of its own: the card made from it is bound to THAT (`bind`).
      const offerId = actor?.sessionKey ? String(filmDb.prepare("INSERT INTO video_offer_previews (session_key, form, detail, usd, unpriced, shown_ms) VALUES (?, ?, ?, ?, ?, ?)").run(actor.sessionKey, offerKey(input), cardWords(detail), made.highUsd, JSON.stringify(unpriced), now()).lastInsertRowid) : undefined;
      return { name: "One prompt → video", estimate: { lowUsd: made.lowUsd, highUsd: made.highUsd, unknown: made.unknown }, detail, ...(offerId ? { offerId } : {}) };
    },
    /** The permission request that was just made, bound to the preview it was made from — by the preview's identity, in the call that made both. The first binding of a request stands. */
    bind(offerId, requestId, actor) {
      const made = filmDb.prepare("SELECT form, usd, unpriced FROM video_offer_previews WHERE seq = ? AND session_key = ?").get(Number(offerId), actor.sessionKey) as { form: string; usd: number; unpriced: string } | undefined;
      if (made) filmDb.prepare("INSERT OR IGNORE INTO video_offer_bound (request_id, session_key, form, usd, unpriced) VALUES (?, ?, ?, ?, ?)").run(requestId, actor.sessionKey, made.form, made.usd, made.unpriced);
    },
    /**
     * The permission card the person allowed is the run's one money question — for the amount, and the models of
     * unknown price, THAT CARD showed. A price or a route that changed since makes the run cost more than they allowed
     * (or use a model they were not told of): the run is then created without a confirmed amount and asks the person
     * again, in its own view, before it pays for anything. So does a start no card was ever shown for (a standing
     * permission for the tool is not an answer about this amount).
     */
    async start(input, actor) {
      const card = await approvedCard(input, actor);
      // The allowed card starts ONE run: it is spent before the run exists, so a second start beside this one finds nothing.
      if (card && Number(filmDb.prepare("UPDATE video_offer_bound SET run_id = '', used_ms = ? WHERE request_id = ? AND run_id IS NULL").run(now(), card.requestId).changes) !== 1) return starter.start(input, actor);
      let run: WorkflowRunRecord;
      try { run = await startRun({ ...agentForm(input, actor), ...(card ? { confirmedUsd: card.usd, allowUnpriced: card.unpriced } : {}) }, actor, undefined, true); }
      catch (error) { if (card) filmDb.prepare("UPDATE video_offer_bound SET run_id = NULL, used_ms = NULL WHERE request_id = ?").run(card.requestId); throw error; }
      if (card) filmDb.prepare("UPDATE video_offer_bound SET run_id = ? WHERE request_id = ?").run(run.id, card.requestId);
      // What was said for this request is forgotten: a later start of it is asked about afresh.
      filmDb.prepare("DELETE FROM video_offer_previews WHERE session_key = ? AND form = ?").run(actor.sessionKey, offerKey(input));
      return run;
    },
  };
  const runOf = (runId: string) => {
    const found = deps.workflows().runs.get(runId) as { run: { id: string; workflowId: string; params: Record<string, unknown> } };
    if (found.run.workflowId !== pv.TEMPLATE_ID) throw new ProtocolError("NOT_FOUND", "This run is not a video.", { details: { runId } });
    return found.run;
  };
  /** What a run has spent and what its budget leaves (no budget: `budgetUsd` null). */
  methods.set("jagentchill.workflow.video.spend", {
    scope: READ,
    handle: async (raw, connection) => {
      const parsed = z.object({ runId: id }).strict().safeParse(raw ?? {});
      if (!parsed.success) throw new ProtocolError("INVALID_PARAMS", "The request is not valid.", { details: { field: "runId" } });
      const runId = parsed.data.runId, spentUsd = (runOf(runId), deps.generation() ? spentAll({ runId }) : 0);
      const listed = deps.rpc ? ((await deps.rpc("jagentchill.provider.budget.list", {}, connection)) as { budgets?: { scope: string; scopeId?: string; limitUsd: number }[] }).budgets ?? [] : [];
      const budget = listed.find((entry) => entry.scope === "session" && entry.scopeId === `run:${runId}`);
      return { spentUsd, turnsUsd: money4(money.turnsOf(runId)), turnCount: money.turnCount(runId), budgetUsd: budget?.limitUsd ?? null, remainingUsd: budget ? Math.max(0, Math.round((budget.limitUsd - spentUsd) * 10_000) / 10_000) : null, confirmedUsd: confirmedOf(runId), ...(money.limitOf(runId)?.hard ? { maxCostUsd: money.limitOf(runId)!.confirmedUsd } : {}) };
    },
  });
  /** A person raises (or sets) the budget of a run that is under way; a step the old budget stopped can then be retried. */
  methods.set("jagentchill.workflow.video.budget", {
    scope: RUN,
    handle: async (raw, connection) => {
      const parsed = budgetSchema.safeParse(raw ?? {});
      if (!parsed.success) throw new ProtocolError("INVALID_PARAMS", "Budget must be between $0.01 and $100,000.", { details: { field: "budgetUsd" } });
      runOf(parsed.data.runId);
      await setBudget(parsed.data.runId, parsed.data.budgetUsd, connection);
      // A person who raises the budget of a run under way has answered the money question for it: they are not asked again below that amount.
      const before = confirmedOf(parsed.data.runId);
      if (before !== null && parsed.data.budgetUsd > before) confirm(parsed.data.runId, parsed.data.budgetUsd);
      return { runId: parsed.data.runId, budgetUsd: parsed.data.budgetUsd };
    },
  });
  /** A person confirms a new amount for a run that stopped because it would pass what was confirmed at its start: a run paused there goes on (a run that failed there — nobody followed it — has its step retried). */
  methods.set("jagentchill.workflow.video.confirm", {
    scope: RUN,
    handle: (raw, connection) => {
      const parsed = confirmSchema.safeParse(raw ?? {});
      if (!parsed.success) throw new ProtocolError("INVALID_PARAMS", "The request is not valid.", { details: { field: String(parsed.error.issues[0]?.path.join(".") ?? "") } });
      runOf(parsed.data.runId);
      const before = confirmedOf(parsed.data.runId), amount = parsed.data.confirmedUsd ?? before;
      // A model's name alone answers "its price is not known" for a run whose amount stands; it is no answer about an amount nobody confirmed.
      if (amount === null) throw new ProtocolError("INVALID_PARAMS", "Confirm the cost of this video.", { details: { field: "confirmedUsd" } });
      if (amount < (before ?? 0)) throw new ProtocolError("INVALID_PARAMS", "The new amount is lower than what was confirmed before.", { details: { field: "confirmedUsd", confirmedUsd: before } });
      confirm(parsed.data.runId, amount, parsed.data.allowUnpriced ?? []);
      // The run's own budget follows the person's leave (see `setBudget`): it is put in place again, at the same limit, before the run goes on.
      const budget = parsed.data.allowUnpriced?.length ? runBudgetOf(parsed.data.runId) : null;
      if (budget !== null) { try { installBudget(`run:${parsed.data.runId}`, budget, true, connection.deviceId); } catch { /* the budget stands as it was: the step says what stops it */ } }
      const held = (deps.workflows().runs.get(parsed.data.runId) as { run: { status: string; pauseReason?: string } }).run;
      if (held.status === "paused" && held.pauseReason === "budget_exceeded") deps.workflows().runs.resume(parsed.data.runId, connection.deviceId);
      return { runId: parsed.data.runId, confirmedUsd: amount, allowUnpriced: money.unpricedOf(parsed.data.runId) };
    },
  });
  /**
   * A person's decision about one shot of a run, made on the Shots tab: leave it out of the video ("Delete"), bring it
   * back, or put their own picture in its place. It changes the working film, then the run hands the pictures on
   * again, so the timeline that follows is the one the person decided.
   */
  methods.set("jagentchill.workflow.video.shot", {
    scope: RUN,
    handle: (raw, connection) => {
      const parsed = shotSchema.safeParse(raw ?? {});
      if (!parsed.success) throw new ProtocolError("INVALID_PARAMS", "The request is not valid.", { details: { field: String(parsed.error.issues[0]?.path.join(".") ?? "") } });
      const input = parsed.data, filmId = (runOf(input.runId), filmIdOf(input.runId));
      if (!filmId) throw new ProtocolError("CONFLICT", "The pictures of this run have not been started yet.", { details: { runId: input.runId } });
      const film = films.read(filmId), panel = film.panels.find((entry) => entry.id === input.shotId);
      if (!panel) throw new ProtocolError("NOT_FOUND", "This shot is no longer in the run.", { details: { shotId: input.shotId } });
      if (input.action === "delete") {
        if (film.panels.filter((entry) => !entry.leftOut).length <= 1 && !panel.leftOut) throw new ProtocolError("CONFLICT", "A video needs at least one shot.", { details: { shotId: input.shotId } });
        films.mutate(filmId, [{ op: "panel.leave", id: panel.id, leftOut: true }]);
      } else if (input.action === "restore") films.mutate(filmId, [{ op: "panel.leave", id: panel.id, leftOut: false }]);
      else {
        if (!input.blobId) throw new ProtocolError("INVALID_PARAMS", "Choose a picture.", { details: { field: "blobId" } });
        const status = deps.sync.blobs.status(input.blobId);
        if (status.state !== "complete") throw new ProtocolError("NOT_FOUND", "This picture is not on the host yet: upload it first.", { details: { blobId: input.blobId } });
        const media: pv.MediaFile = { blobId: input.blobId, name: (input.name ?? "My picture").slice(0, 200), kind: "image", bytes: status.size ?? 0, ...(input.width && input.height ? { width: input.width, height: input.height } : {}), provenance: { source: "imported" } };
        // A picture offered beside one in use is a candidate until it is chosen: the person's own picture is chosen at once.
        const versionId = randomUUID().slice(0, 12);
        films.mutate(filmId, [{ op: "panel.picture", id: panel.id, version: { id: versionId, media, costUsd: 0, prompt: "", created_ms: now() } }, ...(panel.picture.current ? [{ op: "panel.use" as const, id: panel.id, versionId }] : [])]);
        replaced(filmId, panel.id, true);
      }
      // The run follows the decision: a shot brought back is drawn (Pictures runs again), the others only change what is handed on.
      // While a person is still being asked about the pictures neither step has ended: their approval then does it.
      const nodeId = input.action === "restore" && !panel.picture.current ? "assets" : "pictures";
      let rerun: string | null = null;
      try { deps.workflows().runs.rerun(input.runId, nodeId, {}, connection.deviceId); rerun = nodeId; } catch { /* not ended yet: the run reaches it by itself */ }
      return { runId: input.runId, shotId: input.shotId, action: input.action, rerun, shotMedia: mediaOf(filmId, films.read(filmId)) };
    },
  });
  /** The pictures of a run as they stand now (the Shots tab reads this while a person is asked about them). */
  methods.set("jagentchill.workflow.video.shots", {
    scope: READ,
    handle: (raw) => {
      const parsed = z.object({ runId: id }).strict().safeParse(raw ?? {});
      if (!parsed.success) throw new ProtocolError("INVALID_PARAMS", "The request is not valid.", { details: { field: "runId" } });
      const filmId = (runOf(parsed.data.runId), filmIdOf(parsed.data.runId));
      return { shotMedia: filmId ? mediaOf(filmId, films.read(filmId)) : [] };
    },
  });

  /**
   * A hard-stop budget of the host, put in place and READ BACK in this very call (the host's budget methods answer
   * at once): when this returns the limit stands exactly as asked; otherwise it throws and the caller sends nothing.
   */
  function installBudget(scopeId: string, limitUsd: number, allowUnknownCost: boolean, deviceId: string): void {
    if (!deps.call) throw failure("UNAVAILABLE", "This host has no budgets.");
    const connection = { deviceId } as Connection;
    const answer = deps.call("jagentchill.provider.budget.set", { budget: { scope: "session", scopeId, limitUsd, period: "total", hardStop: true, allowUnknownCost } }, connection);
    if (answer instanceof Promise) { answer.catch(() => undefined); throw failure("UNAVAILABLE", "The budget was not in place when it was needed."); }
    const listed = (deps.call("jagentchill.provider.budget.list", {}, connection) as { budgets?: { scope: string; scopeId?: string; limitUsd: number; hardStop?: boolean; allowUnknownCost?: boolean }[] }).budgets ?? [];
    const found = listed.find((entry) => entry.scope === "session" && entry.scopeId === scopeId);
    if (!found || found.hardStop !== true || found.limitUsd > limitUsd + 1e-12 || (found.allowUnknownCost === true) !== allowUnknownCost) throw failure("UNAVAILABLE", "The budget the host holds is not the one that was set.");
  }
  /** What the automations ask about money: this template's estimate, what a run has paid, and the run's own budget. */
  const automationMoney: AutomationMoney = {
    estimate(workflowId, params) {
      if (workflowId !== pv.TEMPLATE_ID) return null;
      // The automation's parameters over the template's defaults, as the run will have them; values that are not valid are the start's to refuse.
      try { const p = parse({ params: { ...pv.DEFAULT_PARAMS, ...params } }).params as pv.VideoParams, own = p.script?.trim(), made = estimate({ ...p, targetDuration_s: own ? pv.scriptDuration_s(pv.scriptFromText(own, p)) : p.targetDuration_s }).estimate; return { highUsd: made.highUsd, unknown: made.unknown, unpricedModels: unpricedOf(made) }; } catch { return null; }
    },
    spentOfRun: (runId) => (deps.generation() ? money.spentOf(runId) : 0),
    spentOfSession: async (sessionKey) => (turnCost ? turnCost(sessionKey) : null),
    // The limit as it is: a cap is never made larger than what is available — not rounded up, not lifted to a minimum.
    setRunBudget: (runId, usd, deviceId) => installBudget(`run:${runId}`, usd, false, deviceId),
    // The session's own budget: Usage refuses its turns and tools past it, and — unless the automation's explicit
    // setting allows it — a model that has no price.
    setSessionBudget: (sessionKey, usd, deviceId, allowUnpriced) => installBudget(sessionKey, usd, allowUnpriced, deviceId),
    // `turn.more` has no new message yet, so it is bounded by the measured context and provider output limit.
    turnBound: (turn) => { const bound = turnBound({ ...turn, title: "" }); return { model: bound.model, usd: bound.usd, ...(bound.routed === false ? { routed: false as const } : {}), ...(bound.ownAccount ? { ownAccount: true as const } : {}), ...(bound.measured ? { measured: true as const } : {}) }; },
  };
  return {
    tools, methods, starter, automationMoney,
    /** The working film of a run (tests and the run's own screens read what the film engine made). */
    filmOfRun: (runId: string): fm.Film | undefined => { const filmId = filmIdOf(runId); return filmId ? films.read(filmId) : undefined; },
    /** Stores the template document under its fixed id (and replaces an older graph). */
    install(): void { deps.workflows().docs.install(pv.buildTemplate(now())); },
  };
}
export type PromptVideo = ReturnType<typeof createPromptVideo>;
