import { AsyncLocalStorage } from "node:async_hooks";
import type { DatabaseSync } from "node:sqlite";
import type { GenerationService } from "../../generation/service.ts";
import { isSpendStop, modelName, usdText } from "../../generation/spend-gate.ts";
import type { WorkflowRuns } from "../runs.ts";

/**
 * The money of one video run, in one place: what was confirmed for it, what it has paid, and the guard that is asked
 * before EVERY paid request the run makes — not before a stage. The pictures and the voice are made by the film
 * engine, which knows nothing of a video's confirmation, so the guard sits where every request passes whoever makes
 * it: in front of the generation service (`generation()`) and of a session turn (`turn()`) as they are handed to the
 * film engine and to the video's own steps. A request is reserved before it is sent (several run at once), and what
 * it really cost is read from the ledger once it has ended.
 */
/** A started run asks no money question again until it would pass this share of what its starter confirmed (`agent-workflows`, "Budgets during a run"). */
export const CONFIRMED_SHARE = 1.2;
export const money4 = (usd: number): number => Math.round(usd * 10_000) / 10_000;
/** An amount as a person reads it: the spend gate's own wording of money, so that every question of a run reads the same. */
export const dollars = usdText;
const failure = (code: string, message: string, details: Record<string, unknown>) => Object.assign(new Error(message), { code, details });

/**
 * What ONE request of a session turn costs, worked out before it is sent (ruling R10): the prompt as it was measured
 * for the model on this host plus the bytes of the message, and the limit of the answer, at the model's price. `usd`
 * null: that is not known (the model has no price, has not run here yet, or has no known maximum output) — never read
 * as zero.
 */
export type TurnBound = { /** The model the turn runs on, as a person is told its name. */ model: string; provider?: string; usd: number | null; /** false: the turn's role has no model at all — nothing can be sent anywhere, and the turn fails by itself saying so. */ routed?: false; /** Ruling R9: the model runs on the person's own signed-in account (Claude Code, Codex): not billed by this app — no part of a quote, never "price not known", held by no budget. */ ownAccount?: true; /** That account, as a person knows it ("Claude Code"). */ account?: string; /** Ruling R10: `usd` is worked out from a MEASURED prompt size — a screen says "about". */ measured?: true };
/** In `video_unpriced`: the automation's own setting — every model whose price is not known may be used. */
export const ANY_MODEL = "*";

export type RunMoneyDeps = {
  db: DatabaseSync; now: () => number; generation: () => GenerationService | undefined;
  /** The bound of a turn that is about to be sent (see `TurnBound`). Absent: nothing is known of any turn's price. */
  turnBound?: (input: Parameters<WorkflowRuns["turn"]>[1]) => TurnBound;
  /** What the turns of a session have cost so far (Usage), or null when that is not known. */
  turnCost?: (sessionKey: string) => Promise<number | null>;
  /** What the run would still make from here, priced (for the figure a person is shown at a stop). */
  restOf?: (runId: string) => number;
  /** The estimate nobody has confirmed yet, for the question a run without a confirmation asks. */
  askOf?: (runId: string) => Record<string, unknown> & { amountUsd: number };
  /** The run's OWN hard budget (the person's "Budget for this run"), or null when it has none. */
  runBudget?: (runId: string) => number | null;
};
export type RunLimit = { limitUsd: number; confirmedUsd: number; /** A cost limit set where nobody is there to ask (an automation's): it is the limit itself, with no margin. */ hard: boolean };

export function createRunMoney(deps: RunMoneyDeps) {
  const { db, now } = deps;
  db.exec(`
    CREATE TABLE IF NOT EXISTS video_confirmed (run_id TEXT PRIMARY KEY, usd REAL NOT NULL, updated_ms INTEGER NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS video_caps (run_id TEXT PRIMARY KEY, usd REAL NOT NULL, updated_ms INTEGER NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS video_turns (run_id TEXT NOT NULL, session_key TEXT NOT NULL, usd REAL NOT NULL, updated_ms INTEGER NOT NULL, PRIMARY KEY (run_id, session_key)) STRICT;
    CREATE TABLE IF NOT EXISTS video_unpriced (run_id TEXT NOT NULL, model TEXT NOT NULL, updated_ms INTEGER NOT NULL, PRIMARY KEY (run_id, model)) STRICT;
  `);
  const usdOf = (table: "video_confirmed" | "video_caps", runId: string): number | null => (db.prepare(`SELECT usd FROM ${table} WHERE run_id = ?`).get(runId) as { usd: number } | undefined)?.usd ?? null;
  const put = (table: "video_confirmed" | "video_caps", runId: string, usd: number): void => { db.prepare(`INSERT INTO ${table} (run_id, usd, updated_ms) VALUES (?, ?, ?) ON CONFLICT(run_id) DO UPDATE SET usd = excluded.usd, updated_ms = excluded.updated_ms`).run(runId, usd, now()); };
  const confirmedOf = (runId: string): number | null => usdOf("video_confirmed", runId);
  /** Where the run stops: a cost limit set for an unattended run as it is; else 120 % of what a person confirmed. Null: nobody has answered the money question. */
  function limitOf(runId: string): RunLimit | null {
    const cap = usdOf("video_caps", runId), confirmed = confirmedOf(runId);
    if (cap !== null) return { limitUsd: money4(cap), confirmedUsd: cap, hard: true };
    return confirmed === null ? null : { limitUsd: money4(confirmed * CONFIRMED_SHARE), confirmedUsd: confirmed, hard: false };
  }
  /**
   * The models whose price is not known that a PERSON allowed this run to use — by name, on the run's one money
   * question (attended), or by the explicit setting of the automation that started it (`ANY_MODEL`). Nothing else
   * lets a request of unknown price out: it is refused with `unpriced_model` before it is sent.
   */
  const allowUnpriced = (runId: string, models: readonly string[]): void => { for (const model of new Set(models)) if (model) db.prepare("INSERT INTO video_unpriced (run_id, model, updated_ms) VALUES (?, ?, ?) ON CONFLICT(run_id, model) DO UPDATE SET updated_ms = excluded.updated_ms").run(runId, model, now()); };
  const unpricedOf = (runId: string): string[] => (db.prepare("SELECT model FROM video_unpriced WHERE run_id = ? ORDER BY model").all(runId) as { model: string }[]).map((row) => row.model);
  const allows = (runId: string, model: string): boolean => { const allowed = unpricedOf(runId); return allowed.includes(ANY_MODEL) || allowed.includes(model); };
  /** What the turns of the run's sessions (writing, the look at a picture) have cost. */
  const turnsOf = (runId: string): number => (db.prepare("SELECT COALESCE(SUM(usd), 0) AS usd FROM video_turns WHERE run_id = ?").get(runId) as { usd: number }).usd;
  /** Everything the run has paid: its jobs of the generation service (pictures, speech, listening, music, translation) and its session turns. */
  function spentOf(runId: string): number {
    const generation = deps.generation();
    const jobs = generation ? generation.ledgerRows().filter((row) => row.session_id === `run:${runId}`).reduce((sum, row) => sum + (Number(row.actual_usd) || 0), 0) : 0;
    return money4(jobs + turnsOf(runId));
  }

  /**
   * How much more than its estimate this run's work has really been charged (1 when nothing was charged yet, never
   * under 1): the provider's bill, not the price list, is what the run will go on paying. Used for what a request is
   * reserved at and for the figure a person is asked to confirm — so that ONE confirmation carries the run to its end.
   */
  function rateOf(runId: string): number {
    const generation = deps.generation();
    if (!generation) return 1;
    let estimated = 0, charged = 0;
    for (const row of generation.ledgerRows()) { const estimate = Number((row as { estimate_usd?: unknown }).estimate_usd) || 0, actual = Number(row.actual_usd) || 0; if (row.session_id === `run:${runId}` && estimate > 0 && actual > 0) { estimated += estimate; charged += actual; } }
    return estimated > 0 ? Math.max(1, charged / estimated) : 1;
  }
  const inFlight = new Map<string, number>();
  /** The stop of a run whose next request does not fit: like a step that reached a budget, with the new figure (an automation's limit: with whose it is). */
  function over(runId: string, limit: RunLimit, spentUsd: number, pendingUsd: number): Error {
    // The real projection: what was charged so far, and everything still to be made at the rate that is being charged.
    const total = money4(spentUsd + Math.max(pendingUsd, (deps.restOf?.(runId) ?? 0) * rateOf(runId)));
    return limit.hard
      ? failure("BUDGET_EXCEEDED", `This video has cost ${dollars(spentUsd)} so far and would pass the ${dollars(limit.confirmedUsd)} its automation allows for a run: it now comes to about ${dollars(total)}.`, { reason: "cost_limit", scope: "run_cost_limit", runId, maxCostUsd: limit.confirmedUsd, limitUsd: limit.limitUsd, spentUsd, estimate: { amountUsd: total } })
      : failure("BUDGET_EXCEEDED", `This video has cost ${dollars(spentUsd)} so far and would pass the ${dollars(limit.confirmedUsd)} you confirmed: it now comes to about ${dollars(total)}. Confirm the new amount to go on.`, { reason: "confirmation_required", scope: "confirmed_estimate", runId, confirmedUsd: limit.confirmedUsd, limitUsd: limit.limitUsd, spentUsd, estimate: { amountUsd: total } });
  }
  /** Nobody has answered the run's money question: nothing paid starts, whatever started the run. */
  function unasked(runId: string, nextUsd: number): Error {
    const ask = deps.askOf?.(runId) ?? { amountUsd: money4(nextUsd + (deps.restOf?.(runId) ?? 0) * rateOf(runId)) };
    return failure("BUDGET_EXCEEDED", `The cost of this video (about ${dollars(ask.amountUsd)}) was not confirmed yet. Confirm it to go on.`, { reason: "confirmation_required", scope: "confirmed_estimate", runId, confirmedUsd: null, limitUsd: 0, spentUsd: spentOf(runId), estimate: ask });
  }
  /**
   * Asked before a paid request of the run. One that would take the run past its stop — with what is already under
   * way — is not sent: the step stops like one that reached a budget, with the new figure. `strict`: a request that
   * reserves nothing (it is free, or a person allowed its unknown price) is still not sent by a run that is already
   * past its stop. Returns what gives the request's share back once it has ended (its real cost is in the ledger then).
   */
  function reserve(runId: string, listUsd: number, strict = false, /** false: `listUsd` is already the most this request can cost (a turn's bound), not a list price that the provider's bills are known to pass. */ scaled = true): () => void {
    const limit = limitOf(runId), spentUsd = spentOf(runId), flying = inFlight.get(runId) ?? 0, nextUsd = scaled ? listUsd * rateOf(runId) : listUsd;
    if (!limit) throw unasked(runId, nextUsd);
    if (nextUsd > 0 ? spentUsd + flying + nextUsd > limit.limitUsd + 1e-9 : strict && spentUsd + flying > limit.limitUsd + 1e-9) throw over(runId, limit, spentUsd, flying + nextUsd);
    if (nextUsd <= 0) return () => undefined;
    inFlight.set(runId, flying + nextUsd);
    let given = false;
    return () => { if (given) return; given = true; const left = (inFlight.get(runId) ?? 0) - nextUsd; if (left > 1e-9) inFlight.set(runId, left); else inFlight.delete(runId); };
  }
  /**
   * The same question for a request whose price may not be known (`usd` null). "Not known" is not zero: such a request
   * goes out only to a model a person allowed for this run by name (or by the automation's own setting); otherwise the
   * step stops with `BUDGET_EXCEEDED`, reason `unpriced_model`, naming the model — before anything is sent.
   */
  function reserveFor(runId: string, usd: number | null, model: string, scaled = true): () => void {
    if (usd !== null) return reserve(runId, usd, true, scaled);
    const limit = limitOf(runId);
    if (!limit) throw unasked(runId, 0);
    if (!allows(runId, model)) {
      const spentUsd = spentOf(runId), details = { reason: "unpriced_model", runId, modelId: model, unpricedModels: [model], spentUsd };
      throw limit.hard
        ? failure("BUDGET_EXCEEDED", `The price of ${model} is not known, and the automation that started this video does not allow models without a known price: nothing was sent to it.`, { ...details, scope: "run_cost_limit", maxCostUsd: limit.confirmedUsd })
        : failure("BUDGET_EXCEEDED", `The price of ${model} is not known. Nothing was sent to it: say that it may be used to go on.`, { ...details, scope: "confirmed_estimate", confirmedUsd: limit.confirmedUsd });
    }
    return reserve(runId, 0, true);
  }

  const runOfSession = (sessionId: unknown): string | undefined => (typeof sessionId === "string" && sessionId.startsWith("run:") ? sessionId.slice(4) : undefined);
  const guardedBy = new WeakMap<GenerationService, GenerationService>();
  /**
   * The generation service as the run's makers get it: `create` reserves the job's estimate before the job exists (a
   * cache hit costs nothing and is never stopped), `settled` gives the share back, and `transcribe` — the read-back of
   * a recording — is reserved the same way. Everything else is the service itself.
   */
  function generation(): GenerationService | undefined {
    const real = deps.generation();
    if (!real) return undefined;
    const known = guardedBy.get(real);
    if (known) return known;
    const held = new Map<string, () => void>();
    const guarded = new Proxy(real, {
      get(target, name) {
        if (name === "create") return (input: Parameters<GenerationService["create"]>[0], actor: Parameters<GenerationService["create"]>[1]) => {
          const runId = runOfSession((input as { sessionId?: unknown }).sessionId ?? actor?.sessionId);
          if (!runId) return target.create(input, actor);
          let nextUsd: number | null = 0, model = "";
          // A request the service would refuse anyway is refused by the service, in its own words.
          try { const prepared = target.prepare(input) as { estimate: { amountUsd: number | null }; hit?: unknown; model?: { label?: string; id?: string } }; nextUsd = prepared.hit ? 0 : prepared.estimate.amountUsd; model = prepared.model?.label ?? prepared.model?.id ?? String((input as { capability?: unknown }).capability ?? "model"); } catch { return target.create(input, actor); }
          const release = reserveFor(runId, nextUsd, model);
          try { const made = target.create(input, actor); held.set(made.jobId, release); return made; } catch (error) { release(); throw error; }
        };
        if (name === "settled") return async (jobId: string) => { try { return await target.settled(jobId); } finally { held.get(jobId)?.(); held.delete(jobId); } };
        if (name === "transcribe") return async (input: Parameters<GenerationService["transcribe"]>[0], signal?: AbortSignal, scope?: { sessionId?: string; projectId?: string }) => {
          const runId = runOfSession(scope?.sessionId);
          if (!runId) return target.transcribe(input, signal, scope);
          const listener = target.listener(input.seconds) as { estimateUsd: number | null; modelLabel?: string } | undefined;
          const release = listener ? reserveFor(runId, listener.estimateUsd, listener.modelLabel ?? "the listening model") : reserve(runId, 0, true);
          try { return await target.transcribe(input, signal, scope); } finally { release(); }
        };
        const value = Reflect.get(target, name, target) as unknown;
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
    guardedBy.set(real, guarded);
    return guarded;
  }

  // — session turns: which run a turn belongs to is known from where it was asked (the step that runs), not from the turn —
  const scope = new AsyncLocalStorage<{ runId: string }>();
  const inRun = <T,>(runId: string, work: () => T): T => scope.run({ runId }, work);
  const turnUsd = (runId: string, sessionKey: string): number | null => (db.prepare("SELECT usd FROM video_turns WHERE run_id = ? AND session_key = ?").get(runId, sessionKey) as { usd: number } | undefined)?.usd ?? null;
  async function noteTurn(runId: string, sessionKey: string): Promise<void> {
    if (!deps.turnCost || !sessionKey) return;
    const read = async (): Promise<void> => {
      try { const usd = await deps.turnCost!(sessionKey); if (usd !== null) db.prepare("INSERT INTO video_turns (run_id, session_key, usd, updated_ms) VALUES (?, ?, ?, ?) ON CONFLICT(run_id, session_key) DO UPDATE SET usd = excluded.usd, updated_ms = excluded.updated_ms").run(runId, sessionKey, usd, now()); } catch { /* the store is closed, or Usage does not know the session: its cost stays what was read before */ }
    };
    await read();
    // A turn's record is closed a moment after the turn ends: what it cost is read once more then.
    for (const wait of [250, 1500]) setTimeout(() => void read(), wait).unref();
  }
  /**
   * A session turn as the run's steps and the film engine ask for it. BEFORE it is sent, the most this very request
   * can cost (`TurnBound`: its own tokens and the model's longest answer, at the model's price) is reserved against
   * what was confirmed for the run — the run's first turn like any other: one that does not fit is not sent, and one
   * whose price is not known goes only to a model a person allowed. The reservation is held in the spend gate too
   * (the run's action, `run:<id>`), beside the run's pictures and recordings, and what the turn really cost is charged
   * there when it ends — so the gate's own count of the run has its turns.
   */
  /**
   * The HARD budgets a turn is held to besides the run's confirmation, asked BEFORE it is sent: the run's own budget
   * (what the run has paid, what its requests under way hold, and this turn at the most it can cost), and the host's
   * and the provider's (the generation service's own check — the same one a picture passes). A turn that does not fit
   * is not sent: the step stops like a picture that reached that budget.
   */
  function withinBudgets(runId: string, bound: TurnBound): void {
    if (bound.usd === null || bound.usd <= 0) return;
    (deps.generation() as { refuseOverBudget?: GenerationService["refuseOverBudget"] } | undefined)?.refuseOverBudget?.(bound.provider ?? "runtime", {}, bound.usd);
    const budget = deps.runBudget?.(runId) ?? null;
    if (budget === null) return;
    const remainingUsd = money4(Math.max(0, budget - spentOf(runId) - (inFlight.get(runId) ?? 0)));
    if (bound.usd > remainingUsd + 1e-9) throw failure("BUDGET_EXCEEDED", "Budget reached — session", { scope: "session", scopeId: `run:${runId}`, remainingUsd, class: "budget_exceeded" });
  }
  /**
   * A turn that was SENT keeps its reservation until the accounting has settled: Usage says what a turn cost a moment
   * — or much later — after it ended, and until then the run has paid "nothing" for it. Its share is given back only
   * when the session's cost has grown past what it was before the turn (the bill is on the run's account then); the
   * oldest turn of a session first. A turn that FAILED may never get a record: its share is given back when the last
   * reading still knows nothing of it.
   */
  const SETTLE_WAITS = [250, 1500, 5000, 15_000, 60_000];
  type Unsettled = { runId: string; baseUsd: number; release: () => void; failed: boolean };
  const unsettled = new Map<string, Unsettled[]>();
  async function settle(sessionKey: string, last = false): Promise<void> {
    const waiting = unsettled.get(sessionKey);
    if (!waiting?.length || !deps.turnCost) return;
    let usd: number | null = null;
    try { usd = await deps.turnCost(sessionKey); } catch { /* not known now */ }
    const first = waiting[0];
    if (!first) return;
    if (usd !== null && usd > first.baseUsd + 1e-12) {
      db.prepare("INSERT INTO video_turns (run_id, session_key, usd, updated_ms) VALUES (?, ?, ?, ?) ON CONFLICT(run_id, session_key) DO UPDATE SET usd = excluded.usd, updated_ms = excluded.updated_ms").run(first.runId, sessionKey, usd, now());
      waiting.shift(); first.release();
      // The next turn of the session is settled by what comes on top of this.
      for (const next of waiting) next.baseUsd = Math.max(next.baseUsd, usd);
    } else if (last && first.failed) { waiting.shift(); first.release(); }
    if (!waiting.length) unsettled.delete(sessionKey);
  }
  function hold(runId: string, sessionKey: string, baseUsd: number, release: () => void, failed: boolean): void {
    if (!deps.turnCost || !sessionKey) { release(); return; }
    unsettled.set(sessionKey, [...(unsettled.get(sessionKey) ?? []), { runId, baseUsd, release, failed }]);
    void settle(sessionKey);
    SETTLE_WAITS.forEach((wait, index) => setTimeout(() => void settle(sessionKey, index === SETTLE_WAITS.length - 1), wait).unref());
  }
  /**
   * A session turn as the run's steps and the film engine ask for it. BEFORE it is sent, the most this very request
   * can cost (`TurnBound`) is reserved against what was confirmed for the run AND checked against every hard budget
   * in scope — the run's first turn like any other: one that does not fit is not sent, and one whose price is not
   * known goes only to a model a person allowed. The reservation is held in the spend gate too (the run's action,
   * `run:<id>`), beside the run's pictures and recordings, and what the turn really cost is charged there when Usage
   * says. A turn on the person's own signed-in account (ruling R9) is none of this: it is sent as it is.
   */
  const turn = (real: WorkflowRuns["turn"]): WorkflowRuns["turn"] => async (deviceId, input) => {
    const runId = scope.getStore()?.runId;
    if (!runId) return real(deviceId, input);
    const bound: TurnBound = deps.turnBound?.(input) ?? { model: input.ref?.modelId ?? input.role ?? "the writing model", usd: null };
    const gate = deps.generation()?.gate as GenerationService["gate"] | undefined, action = gate?.covered(`run:${runId}`);
    // Ruling R9: not billed by this app — no reservation, no budget, no question. (With the gate, the sign-in is read once more as the turn is dispatched: an account that is no subscription any more is then a paid request like any other.)
    if (bound.ownAccount && !(gate && action)) return real(deviceId, input);
    // Turns whose bills have not arrived yet are asked about once more now.
    for (const key of [...unsettled.keys()]) void settle(key);
    if (bound.routed !== false && !bound.ownAccount) withinBudgets(runId, bound);
    // A role nobody routed to a model: there is nowhere to send to — the turn's own refusal says so (it is still not asked of a run past its stop).
    const release = bound.ownAccount ? () => undefined : bound.routed === false ? reserve(runId, 0, true) : reserveFor(runId, bound.usd, bound.model, false);
    let sessionKey = input.sessionKey ?? "", sent = false, failed = false, baseUsd = 0;
    if (input.sessionKey && deps.turnCost && (bound.usd ?? 0) > 0) { try { baseUsd = (await deps.turnCost(input.sessionKey)) ?? 0; } catch { /* a session Usage does not know yet has cost nothing */ } }
    const sending = async (device: string, asked: Parameters<WorkflowRuns["turn"]>[1]) => { sent = true; try { const result = await real(device, asked); sessionKey = result.sessionKey; return result; } catch (error) { failed = true; throw error; } finally { await noteTurn(runId, sessionKey); } };
    const asked = { ...input, onSession: (key: string) => { sessionKey = key; input.onSession?.(key); } };
    try {
      if (!gate || !action) return await sending(deviceId, asked);
      // The gate's own guarded turn (review 14 #3): the charge carries the turn's session and Usage's ids of the turn, and
      // stays the turn's bound — provisionally — until Usage's record of THIS turn says what it cost (never a session total, never $0 unsettled).
      return await gate.guardTurn(sending)(action, { providerId: bound.provider ?? input.ref?.providerId ?? "runtime", modelId: bound.model }, deviceId, asked, bound.ownAccount ? null : bound.usd);
    } catch (error) {
      // The gate's own stop (its count of the run passed what was confirmed): the same stop as the run's, in the run's words.
      if (!isSpendStop(error)) throw error;
      const limit = limitOf(runId);
      // The figure asked covers the gate's own question, so that one answer clears both.
      const spentUsd = spentOf(runId);
      throw limit ? over(runId, limit, spentUsd, Math.max(inFlight.get(runId) ?? 0, error.question.amountUsd - spentUsd)) : unasked(runId, bound.usd ?? 0);
    } finally {
      // Never sent: nothing can arrive for it. Sent: held until its bill is on the run's account.
      if (!sent || (bound.usd ?? 0) <= 0) release(); else hold(runId, sessionKey, baseUsd, release, failed);
    }
  };

  /** What the run is held to in the spend gate: the same amount and the same margin, so the services that spend for the run count against it there. Unknown prices are this guard's to decide (`reserveFor`). */
  /**
   * A person is told a model by its NAME and allows it by that name; the gate knows a generation model by its provider
   * and id. Both are given to the gate, so the one Start that named the reader, the listener or the translator also
   * covers them where the film engine and the generation service ask (else the run stopped again for each of them).
   */
  const gateNames = (names: readonly string[]): string[] => {
    const generation = deps.generation(), all = new Set(names);
    try { if (generation) for (const provider of generation.providers()) for (const model of generation.models(provider.id)) if (names.includes(model.label) || names.includes(model.id)) all.add(modelName(provider.id, model.id)); } catch { /* the names as they are */ }
    return [...all];
  };
  const cover = (runId: string, usd: number, share: number): void => { (deps.generation()?.gate as GenerationService["gate"] | undefined)?.cover({ fixedId: `run:${runId}`, kind: "workflow.run", owner: `run:${runId}`, amountUsd: usd, share, unpriced: gateNames(unpricedOf(runId)) }); };
  return {
    confirmedOf,
    /** A person's answer to the run's money question: the amount, and the models of unknown price they were told of by name. */
    confirm: (runId: string, usd: number, unpriced: readonly string[] = []) => { put("video_confirmed", runId, usd); allowUnpriced(runId, unpriced); cover(runId, usd, CONFIRMED_SHARE); },
    /** The limit an automation gave a run nobody follows; `anyUnpriced`: its explicit setting that models without a known price may be used. */
    cap: (runId: string, usd: number, anyUnpriced = false) => { put("video_caps", runId, usd); if (anyUnpriced) allowUnpriced(runId, [ANY_MODEL]); cover(runId, usd, 1); },
    allowUnpriced, unpricedOf, limitOf, spentOf, turnsOf, reserve, reserveFor,
    /** How many sessions' turns are on the run's account. */
    turnCount: (runId: string): number => (db.prepare("SELECT COUNT(*) AS count FROM video_turns WHERE run_id = ?").get(runId) as { count: number }).count, generation, inRun, turn, noteTurn,
  };
}
export type RunMoney = ReturnType<typeof createRunMoney>;
