import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { ProtocolError } from "../errors.ts";
import type { AdapterRequest, AdapterResult, JcProviderAdapter, SubmitContext } from "./adapter.ts";

/**
 * THE SPEND GATE — the one place the owner's money rule lives (2026-10-08): a person approves an ACTION by a quote
 * they were shown, and from then on nothing is charged that the approval does not cover.
 *
 *  (a) No provider request is sent unless the action's approved quote covers it — cumulatively: every earlier charge
 *      of the action counts, whatever it was for (a first call, a retry, a repair, a fallback, a read-back, a turn).
 *  (b) An approval is the EXACT answer (`confirmed: true` + the action's id + the question's id) to the question that is ON RECORD, and only while the quote the caller
 *      computes now is still the one that was shown. `confirmed: true` to nothing, or to a quote whose amount or
 *      models changed since, approves nothing: the question is asked again with the quote of now.
 *  (c) "Price not known" is never zero: a call whose price is unknown is sent only to a model the person approved BY
 *      NAME (it was listed as unpriced in the quote they approved).
 *  (d) A charge is recorded the moment the provider answers — here, in `guard`, before the caller sees the answer, so
 *      before it is validated or stored — in the host's store, under the action. It survives retries, restarts, route
 *      changes and re-quotes.
 *  (e) A request that would pass the approved amount (times the action's share: 1 for a direct action, the spec's
 *      120 % for a film run) is not sent: the action stops with ONE question on record — spent so far, what remains.
 *  (f) Two answers to one question spend once: approving clears the question, and `once` joins a second identical
 *      request to the one already running.
 *
 *  (g) A request whose price is not known is COUNTED while it is in flight: the next request of unknown price of the
 *      same action is decided only when that one's bill is on record (it waits for it), so several made together
 *      cannot each pass as "the first". A turn inside which other requests of the action are made (an agent's step) is
 *      never waited for — a request made inside it would wait for itself; at exhaustion it is refused instead.
 *
 *  (h) An approval BY NAME of a model whose price is not known is for the ACTION, not for one request (the owner's
 *      rule: money is asked once per action — final run, 2026-10-08). Where the approved quote held NO amount (its
 *      whole content was the name: "price not known"), every request of the action to that model goes out on the one
 *      answer — there is no amount to hold it to; what still stops it is the person's own spending limit (the
 *      hard-stop budgets of the generation service, which count every reported bill). Where the quote DID hold an
 *      amount, what the named model reports counts against it, and passing it stops the action ONCE, with a
 *      question that says so (its amount is "not known", its model is named): the answer to THAT question frees
 *      that model for the rest of the action (`free`) — never another model, and the answer to a stop about a
 *      PRICED request frees nothing. The same for a model that steps in later and is asked about by name
 *      ("unpriced_model" — a fallback): the yes to THAT question is for that model in this action.
 *
 *  (i) Coverage outlives its host: what a process that died had in flight stays against the approval as an unresolved
 *      charge until the provider's usage of that request, or the person, resolves it (`recover`).
 *
 *  (k) HOW a model is billed decides whether it is money of this app at all (coordinator's ruling R9): a turn on a
 *      runtime that POSITIVELY REPORTS a personal subscription sign-in (Claude Code on a claude.ai plan, Codex on
 *      ChatGPT — `billing.ts`; every other runtime, and one whose sign-in cannot be told, is per call) is NOT paid work of an action: it is in no quote, needs no approval, is never
 *      "price not known", is charged nothing and stands against no amount, budget or guard. Only what is billed per
 *      call through a key this host holds is under the rules above (`bindBilling`, `billingOf`).
 *
 *  (j) A turn of a runtime's model is owned by the id its DISPATCH was given (`onTurn` / `turnSent`): Usage's record
 *      with that id settles it. Which records are new, or when they began, says nothing about whose they are.
 *
 * Bypassing is not possible by accident: the generation service holds its adapters only as `guard`ed ones, whose paid
 * methods refuse any call that does not carry a live token — and a token exists only inside `spend`.
 */
export const SPEND_GATE_MIGRATION = `
  CREATE TABLE IF NOT EXISTS gen_standing (key TEXT PRIMARY KEY, json TEXT NOT NULL, updated_ms INTEGER NOT NULL) STRICT;
  CREATE TABLE IF NOT EXISTS gen_charges (id INTEGER PRIMARY KEY AUTOINCREMENT, action_id TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, kind TEXT NOT NULL, usd REAL, ts_ms INTEGER NOT NULL) STRICT;
  CREATE INDEX IF NOT EXISTS gen_charges_action ON gen_charges (action_id);
  CREATE TABLE IF NOT EXISTS gen_reservations (id INTEGER PRIMARY KEY AUTOINCREMENT, action_id TEXT NOT NULL, usd REAL NOT NULL, ts_ms INTEGER NOT NULL) STRICT;
  -- (gen_reservations also has: unknown — a request of unknown price in flight, usd 0; leaf — nothing else of the action is requested inside it.)
  CREATE TABLE IF NOT EXISTS gen_claims (key TEXT PRIMARY KEY, ts_ms INTEGER NOT NULL) STRICT;
`;
/**
 * In the `unpriced` names of a run that covers itself (`cover`): the run's person set, in so many words, that ANY model
 * of unknown price may be used (an automation's own setting). A covered run may also name a model by its bare id.
 */
export const ANY_UNPRICED = "*";
/**
 * Who holds a reservation or a claim: the host PROCESS that made it. It is held until its request settles — however
 * long that takes; no clock ends it. It is given back unsettled by ONE explicit rule: its holder is a process that no
 * longer exists (the host died in the middle of the request). (A row with no holder was made by an earlier version of
 * this host, which is not running any more: the same.)
 */
const HOLDER = String(process.pid);
const holderLives = (holder: string | null): boolean => {
  if (holder === HOLDER) return true;
  const pid = Number(holder);
  if (!holder || !Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return (error as { code?: string }).code === "EPERM"; }
};
/** How often a request that waits for another one's bill looks at the store again (the other one may belong to another host process, which cannot wake it). */
const LOOK_AGAIN_MS = 200;

const money = (value: number): number => Math.round(value * 1e6) / 1e6;
/**
 * An amount as a sentence of the server says it (a question, a refusal, an agent's card) — the one formatter of the
 * money path: cents; four decimals below one cent (as the screens' own formatter); and the full precision amounts are
 * kept at (a millionth of a dollar) below that — so an amount that is not zero never reads "$0.00".
 */
export const usdText = (amount: number): string => `$${amount.toFixed(amount > 0 && amount < 0.0001 ? 6 : amount > 0 && amount < 0.01 ? 4 : 2)}`;
const canonical = (value: unknown): string => (Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}` : JSON.stringify(value ?? null));
const KEY = "gate:";

/** How a model is named in a quote, an approval and a charge. */
export const modelName = (provider: string, model: string, via: "generation" | "runtime" = "generation"): string => `${via === "runtime" ? "runtime:" : ""}${provider}/${model}`;

/**
 * What a person is shown and approves. `amountUsd` is the sum of the parts whose price is known; the models whose
 * price is NOT known are named in `unpriced` (never counted as zero: each needs the approval of its name). `plan` says
 * what will be made. `id` is the hash of all of that: another amount, model or plan is another quote.
 */
export type Quote = { id: string; amountUsd: number; models: string[]; unpriced: string[]; plan: string; /** What the screens are shown for it (their own estimate shape); not part of the id. */ display?: Record<string, unknown> };
export type StopReason = "not_approved" | "outdated_quote" | "over_amount" | "unpriced_model";
type Question = Quote & { at: "start" | "stop"; reason: StopReason; spentUsd: number; remainsUsd: number | null; asked_ms: number; /** The request that was not sent has no known price: the answer to this question is the leave for THAT request, and no other (see `Approved.passes`). */ unknownStep?: Step };
/** One request, as a leave names it: the model it goes to, what it is for, and which request it is (`SpendCall.request` — the logical request, the same across its attempts; else the job it belongs to). */
type Step = { model: string; kind: string; ref?: string };
const sameStep = (a: Step, b: Step): boolean => a.model === b.model && a.kind === b.kind && (a.ref ?? null) === (b.ref ?? null);
/** What was approved, WHOLE: the amount, every model the quote named (those of unknown price apart), and the plan. A request outside any of it is not covered. */
type Approved = { quoteId: string; amountUsd: number; models: string[]; unpriced: string[]; plan: string; by: "person" | "threshold"; at_ms: number; /** A run that confirmed its cost on its own card without naming its models (`cover`): any model with a known price, inside the amount. */ anyPriced?: boolean; /** The requests of unknown price that may still go out although the amount is used up: the very request (its model, what it is for, its job) that a stop question was about, when a person answered THAT question — one request an answer. No other model, no other step and no priced stop's answer is a leave. Without it the action could only ask the same question again: the answer adds no room to an amount that the unknown price is not part of. */ passes?: Step[]; /** Rule (h): the models of unknown price whose requests go out for the WHOLE action, whatever they report — named in a quote that held no amount, or freed by the person's answer to the stop about them. */ free?: string[] };
type ActionRecord = {
  id: string; kind: string; owner: string; authority: "person" | "host"; share: number;
  approved?: Approved; question?: Question; checkpoints: Record<string, unknown>; created_ms: number;
};
/** What a person sent with their request: `confirmed: true`, and what the question named to be sent back (`confirmWith`). */
export type SpendAnswer = { confirmed?: boolean; actionId?: string; quoteId?: string };
export type SpendCall = { provider: string; model: string; via?: "generation" | "runtime"; /** What this one request is estimated to cost; null: not known. */ estimateUsd: number | null; kind: string; /** What the request belongs to beside its action (a job's id): its charges are found by it, also after the action ended. */ ref?: string; /** The LOGICAL request this call is an attempt of — the same whenever the same work is asked again (after a stop, a restart, as a new job): a person's leave for a stopped request of unknown price is bound to IT (review 16 #4), not to the job of one attempt. Without it: `ref`. */ request?: string; /** A turn of a runtime's model: the session it ran in, and what Usage said that session had cost BEFORE the turn — what the turn cost is settled by them when Usage learns it late (`settleSession`). */ session?: { key: string; baseUsd: number | null; /** The runtime's own ids of the turn (Usage's record of it), when they are known at the answer: the charge is settled by THAT record. */ turnIds?: string[]; /** When the message was sent: a turn whose record was not there yet at the answer is found by it. */ sentMs?: number }; /** Nothing else of the action is requested while this request runs (a provider call; a turn with no tools that spend): other requests of unknown price wait for its bill. Default: true for a provider call, false for a turn of a runtime's model. */ leaf?: boolean; /** The amount charged is not what the provider said (it said nothing yet): the estimate, or "not known" — to be replaced when Usage settles. */ provisional?: boolean };
export type ActionView = {
  id: string; kind: string; authority: "person" | "host"; approved?: { amountUsd: number; models: string[]; unpriced: string[]; plan: string; by: "person" | "threshold" }; question?: Question;
  /** Every charge of the action so far. */ spentUsd: number; /** Where the next request stops; null: the action is not held to an amount (a run of the host). */ limitUsd: number | null; checkpoints: Record<string, unknown>;
};

/** The action stopped to ask: nothing was sent. `details` is the body of the question, in the shape the screens know. */
export class SpendStop extends Error {
  readonly code = "PERMISSION_DENIED";
  readonly reason: StopReason;
  readonly actionId: string;
  readonly question: Question;
  readonly approvedUsd: number | null;
  readonly limitUsd: number | null;
  constructor(reason: StopReason, actionId: string, question: Question, approvedUsd: number | null, limitUsd: number | null) {
    super(question.at === "start" ? "Confirm the cost of this request first." : question.unpriced.length ? "The price of the next step is not known. Confirm it to go on." : "This would cost more than was confirmed. Confirm the new amount to go on.");
    this.reason = reason; this.actionId = actionId; this.question = question; this.approvedUsd = approvedUsd; this.limitUsd = limitUsd;
  }
  /** `confirmWith` is what the answer sends back unchanged, with `confirmed: true`. */
  get confirmWith(): { actionId: string; quoteId: string } { return { actionId: this.actionId, quoteId: this.question.id }; }
  /** The body of a `confirmation_required` refusal; a family adds its own fields to `estimate` (provider, breakdown…). */
  details(estimate: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Record<string, unknown> {
    const q = this.question, unknown = q.unpriced.length > 0;
    return {
      reason: "confirmation_required", gate: this.reason,
      estimate: { amountUsd: unknown ? null : q.amountUsd, ...(q.at === "stop" || q.spentUsd > 0 ? { spentUsd: q.spentUsd, remainsUsd: q.remainsUsd } : {}), ...(unknown ? { unpriced: true, unpricedModels: q.unpriced } : {}), models: q.models, ...q.display, ...estimate },
      ...(q.at === "stop" || q.spentUsd > 0 ? { spentUsd: q.spentUsd } : {}), ...(this.approvedUsd !== null ? { confirmedUsd: this.approvedUsd } : {}), ...(unknown ? { unpriced: true } : {}),
      confirmWith: this.confirmWith, ...extra,
    };
  }
}
/** How a model is billed (ruling R9): per call through a key this host holds — or on the person's own signed-in account of a CLI runtime, which is not money of this app. */
export type Billing = "per_call" | "own_account";
export const isSpendStop = (error: unknown): error is SpendStop => error instanceof SpendStop;

/** Charged as "not known" (NULL), whatever the request's estimate was. */
const UNKNOWN = Number.NaN;
const tokens = new WeakMap<SpendToken, { state: "live" | "sent" | "done"; charge(usd: number | null | undefined): void; /** What is known of the request by now (a turn's session, its id) goes on its reservation: should this host die, what it leaves names its request. */ track?(): void }>();
/** Known to this module only: what `spend` shows the token's constructor, so that nothing else can make one. */
const MINT = Symbol("spend-gate");
/** The leave to send ONE provider request. Made only by `spend`; a guarded adapter takes nothing else. */
export class SpendToken {
  readonly actionId: string;
  readonly call: SpendCall;
  #chargedUsd: number | null | undefined;
  constructor(mint: symbol, actionId: string, call: SpendCall, onCharge: (usd: number | null) => void) {
    if (mint !== MINT) throw new ProtocolError("INTERNAL", "Only the spend gate gives a token.", { details: { reason: "spend_gate_bypassed" } });
    this.actionId = actionId; this.call = call;
    tokens.set(this, { state: "live", charge: (usd) => { if (this.#chargedUsd !== undefined) return; this.#chargedUsd = typeof usd === "number" && Number.isNaN(usd) ? null : typeof usd === "number" && Number.isFinite(usd) ? money(Math.max(0, usd)) : call.estimateUsd; onCharge(this.#chargedUsd); } });
  }
  /** What this request was charged: undefined until the provider answered; null when it answered and the price is not known. */
  get chargedUsd(): number | null | undefined { return this.#chargedUsd; }
  /** For a request that is not an adapter's (a turn of a runtime's model): the provider answered, and this is what it says it cost. */
  charge(usd?: number | null): void { tokens.get(this)!.charge(usd); }
  /** The request went out and nothing is known of its cost — not even that it was answered (a turn that failed): a charge row of "not known", never the estimate and never a zero. */
  unknown(): void { tokens.get(this)!.charge(UNKNOWN); }
}

/** An adapter whose paid methods are reachable only with a token of the gate. */
export type GatedAdapter = Omit<JcProviderAdapter, "submit" | "transcribe" | "translate"> & {
  submit(request: AdapterRequest, ctx: SubmitContext, token: SpendToken): Promise<{ result: AdapterResult }>;
  transcribe?(input: Parameters<NonNullable<JcProviderAdapter["transcribe"]>>[0], ctx: Parameters<NonNullable<JcProviderAdapter["transcribe"]>>[1], token: SpendToken): Promise<{ text: string; costUsd?: number }>;
  translate?(input: Parameters<NonNullable<JcProviderAdapter["translate"]>>[0], ctx: Parameters<NonNullable<JcProviderAdapter["translate"]>>[1], token: SpendToken): Promise<{ text: string; costUsd?: number; cutOff?: true }>;
};

/** One turn of a session, as the host's Usage has it. */
export type TurnRecord = { runId: string; costUsd?: number | null; started_ms: number; /** The turn ran on a model that is billed per call through a key this host holds (`billing.ts`); false: on the person's own signed-in account — its missing cost is no money of this app. Not said: not known. */ billedByCall?: boolean; /** How the turn ended, when Usage says: a turn that was stopped or failed is not answered for. */ outcome?: string };
export type SpendGateDeps = { db: DatabaseSync; now: () => number; /** The host's "Ask before spending more than". */ thresholdUsd: () => number };

export function createSpendGate(deps: SpendGateDeps) {
  const { db, now } = deps;
  db.exec(SPEND_GATE_MIGRATION);
  for (const [table, column, type] of [["gen_charges", "ref", "TEXT"], ["gen_charges", "session_key", "TEXT"], ["gen_charges", "base_usd", "REAL"], ["gen_charges", "provisional", "INTEGER"], ["gen_charges", "turn_ids", "TEXT"], ["gen_charges", "sent_ms", "INTEGER"], ["gen_reservations", "unknown", "INTEGER"], ["gen_reservations", "leaf", "INTEGER"], ["gen_reservations", "holder", "TEXT"], ["gen_claims", "holder", "TEXT"], ["gen_reservations", "provider", "TEXT"], ["gen_reservations", "model", "TEXT"], ["gen_reservations", "kind", "TEXT"], ["gen_reservations", "ref", "TEXT"], ["gen_reservations", "session_key", "TEXT"], ["gen_reservations", "turn_ids", "TEXT"], ["gen_reservations", "sent_ms", "INTEGER"], ["gen_charges", "abandoned", "INTEGER"], ["gen_reservations", "request", "TEXT"], ["gen_charges", "request", "TEXT"]] as const) if (!(db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((entry) => entry.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  db.exec("CREATE INDEX IF NOT EXISTS gen_charges_session ON gen_charges (session_key)");
  // ONE charge a request (review 16 #6): a reservation and the charge it becomes carry the request's own identity, and the store refuses a second charge of it.
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS gen_charges_request ON gen_charges (request) WHERE request IS NOT NULL");
  /** What a session's turns have cost so far, as the host's Usage has it (bound by the host: `bindUsage`). */
  let usageOf: ((sessionKey: string) => Promise<number | null>) | undefined;
  /** The turns of a session as Usage has them, one record a turn (the runtime's id of the turn, what it cost when that is known, when it began): a turn's charge is settled by ITS record. */
  let turnsOf: ((sessionKey: string) => Promise<TurnRecord[] | null>) | undefined;
  /** The sessions of the agent tree a session belongs to (its root first), as the host's Usage has them: a tree spends as one spender. */
  let treeOf: ((sessionKey: string) => Promise<string[] | null>) | undefined;
  /** How the model a turn goes to is billed, as the host's runtimes say (bound by the host: `bindBilling`). Not bound, or it cannot say: per call — the rules of the gate hold. */
  let billing: ((who: { ref?: { runtimeId?: string; providerId: string; modelId: string }; role?: string }) => Billing | undefined) | undefined;
  const billingOf = (who: { ref?: { runtimeId?: string; providerId: string; modelId: string }; role?: string }): Billing => { try { return billing?.(who) === "own_account" ? "own_account" : "per_call"; } catch { return "per_call"; } };
  /** The same question asked where the answer can be waited for (a turn's DISPATCH): the host reads the runtime's sign-in again when what it knows is old. Not bound: what `billingOf` says. It cannot say, or fails: per call. */
  /** What a person calls a runtime ("Claude Code"): for the one quiet line about work on their own account — never the runtime's id. */
  let accountName: ((runtimeId: string) => string | undefined) | undefined;
  let billingNow: ((who: { ref?: { runtimeId?: string; providerId: string; modelId: string }; role?: string }) => Promise<Billing | undefined>) | undefined;
  const billingAtDispatch = async (who: { ref?: { runtimeId?: string; providerId: string; modelId: string }; role?: string }): Promise<Billing> => { if (billingOf(who) !== "own_account") return "per_call"; if (!billingNow) return "own_account"; try { return (await billingNow(who)) === "own_account" ? "own_account" : "per_call"; } catch { return "per_call"; } };
  const stats = { tokens: 0, sent: 0, refused: 0, spending: 0 };
  /**
   * What requests in flight will cost, per action: reserved between the check and the charge, so requests made
   * together cannot pass the amount between them. In the host's STORE (`gen_reservations`), so that it holds for every
   * gate on this database, and the check and the reservation are one transaction.
   */
  const flyingOf = (actionId: string): number => money((db.prepare("SELECT COALESCE(SUM(usd), 0) AS usd FROM gen_reservations WHERE action_id = ?").get(actionId) as { usd: number }).usd);
  /**
   * The explicit rule for what a dead host left behind. A CLAIM (who works on one logical request) of a process that no
   * longer exists is given back: the work can be taken up again. A RESERVATION is money: the request it stood for may
   * have reached the provider, and be billed after the host died — so it is never given back by the host's death. It
   * becomes an UNRESOLVED charge of its action (`abandoned`, provisional): the amount it had reserved (its bound), or
   * "not known". It is resolved only by the provider's usage of that very request (a turn: Usage's record of its id —
   * `settleTurns`; else `reconcile`), or by the person: the action stops at its amount with what is spent, and their
   * answer to that question is the decision to go on beside it.
   */
  const recover = (table: "gen_reservations" | "gen_claims", column: "action_id" | "key", value: string): void => {
    for (const row of db.prepare(`SELECT DISTINCT holder FROM ${table} WHERE ${column} = ?`).all(value) as { holder: string | null }[]) {
      if (holderLives(row.holder)) continue;
      if (table === "gen_reservations") for (const left of db.prepare("SELECT * FROM gen_reservations WHERE action_id = ? AND holder IS ?").all(value, row.holder) as { usd: number; unknown: number | null; provider: string | null; model: string | null; kind: string | null; ref: string | null; session_key: string | null; turn_ids: string | null; sent_ms: number | null; request: string | null }[])
        // A request whose bill is already on record (its identity is on a charge) is not charged a second time: OR IGNORE on the unique identity.
        db.prepare("INSERT OR IGNORE INTO gen_charges (action_id, provider, model, kind, usd, ts_ms, ref, session_key, provisional, turn_ids, sent_ms, abandoned, request) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 1, ?)").run(value, left.provider ?? "", left.model ?? "", left.kind ?? "request", left.unknown ? null : left.usd, now(), left.ref, left.session_key, left.turn_ids, left.sent_ms, left.request);
      db.prepare(`DELETE FROM ${table} WHERE ${column} = ? AND holder IS ?`).run(value, row.holder);
    }
  };
  /** The requests of unknown price a dead host left in flight and nobody resolved yet: at the action's amount they stand in the way like one still in flight. */
  const unresolvedUnknown = (actionId: string): number => Number((db.prepare("SELECT COUNT(*) AS n FROM gen_charges WHERE action_id = ? AND abandoned = 1 AND provisional = 1 AND usd IS NULL").get(actionId) as { n: number }).n);
  /** The requests of unknown price of an action that are in flight: all of them, and those inside which other requests may be made (never waited for). */
  const unknownFlying = (actionId: string): { all: number; nesting: number } => { const row = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN leaf = 1 THEN 0 ELSE 1 END), 0) AS nesting FROM gen_reservations WHERE action_id = ? AND unknown = 1").get(actionId) as { n: number; nesting: number }; return { all: Number(row.n), nesting: Number(row.nesting) }; };
  /** Requests that wait for a bill of their action, woken when one of its requests has ended (and looking again by themselves: the other request may be another host's). */
  const waiting = new Map<string, Set<() => void>>();
  const billOf = (actionId: string): Promise<void> => new Promise((resolve) => { const set = waiting.get(actionId) ?? waiting.set(actionId, new Set()).get(actionId)!; const done = (): void => { clearTimeout(timer); set.delete(done); if (!set.size) waiting.delete(actionId); resolve(); }; const timer = setTimeout(done, LOOK_AGAIN_MS); set.add(done); });
  const wake = (actionId: string): void => { for (const go of [...(waiting.get(actionId) ?? [])]) go(); };
  /**
   * One write transaction of the store around `work` (what it wrote before it threw is kept: a question that was put on
   * record is still asked). Another host on this database cannot read-then-write in between: it waits its turn, or is
   * refused. Work that is already inside one runs in it.
   */
  let inside = 0;
  const atomically = <T>(work: () => T): T => {
    if (inside) return work();
    db.exec("BEGIN IMMEDIATE");
    inside++;
    try { return work(); } finally { inside--; db.exec("COMMIT"); }
  };
  const running = new Map<string, Promise<unknown>>();
  /** A turn that is passed on to a turn that is itself a request of the gate (`guardTurn`, `relay`): whether that request was made is noted here. */
  const relayed = new AsyncLocalStorage<{ actionId: string; requests: number }>();
  /** The turn that is being dispatched in this chain of calls (`guardTurn`): the id the runtime gives the message it was sent as is told to IT (`turnSent`) — whoever else sends a message in that session meanwhile is another chain. */
  const dispatching = new AsyncLocalStorage<{ session(): string | undefined; onTurn(runId: string): void }>();

  const load = (actionId: string): ActionRecord | undefined => {
    const row = db.prepare("SELECT json FROM gen_standing WHERE key = ?").get(KEY + actionId) as { json: string } | undefined;
    try { const found = row ? (JSON.parse(row.json) as ActionRecord) : undefined; return found && typeof found.id === "string" && typeof found.kind === "string" ? found : undefined; } catch { return undefined; }
  };
  const save = (record: ActionRecord): void => { db.prepare("INSERT INTO gen_standing (key, json, updated_ms) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json, updated_ms = excluded.updated_ms").run(KEY + record.id, JSON.stringify(record), now()); };
  const spentOf = (actionId: string): number => money((db.prepare("SELECT COALESCE(SUM(usd), 0) AS spent FROM gen_charges WHERE action_id = ?").get(actionId) as { spent: number }).spent);
  /**
   * Where an action stops. What a PERSON approved is capped at that amount (times the action's share) — the host's
   * "ask before spending more than" never adds to an explicit approval. Only an action nobody was asked about (approved
   * by that amount of the host, because its quote was within it) may spend up to it.
   */
  const limitOf = (record: ActionRecord): number | null => (!record.approved ? 0 : money(record.approved.by === "person" ? record.approved.amountUsd * record.share : Math.max(record.approved.amountUsd * record.share, deps.thresholdUsd())));
  /** What the action was charged for the models it was approved to use at a price that is not known (what they reported). */
  const unknownSpentOf = (record: ActionRecord): number => {
    const named = record.approved?.unpriced ?? [];
    if (!named.length) return 0;
    const rows = db.prepare("SELECT provider, model, COALESCE(SUM(usd), 0) AS usd FROM gen_charges WHERE action_id = ? GROUP BY provider, model").all(record.id) as { provider: string; model: string; usd: number }[];
    return money(rows.filter((row) => named.includes(modelName(row.provider, row.model)) || named.includes(modelName(row.provider, row.model, "runtime")) || (record.approved?.anyPriced === true && (named.includes(row.model) || named.includes(ANY_UNPRICED)))).reduce((sum, row) => sum + row.usd, 0));
  };
  const view = (record: ActionRecord): ActionView => ({
    id: record.id, kind: record.kind, authority: record.authority, ...(record.approved ? { approved: { amountUsd: record.approved.amountUsd, models: record.approved.models ?? [], unpriced: record.approved.unpriced, plan: record.approved.plan ?? "", by: record.approved.by } } : {}),
    ...(record.question ? { question: record.question } : {}), spentUsd: spentOf(record.id), limitUsd: limitOf(record), checkpoints: record.checkpoints,
  });
  const stopOf = (record: ActionRecord, reason: StopReason): SpendStop => { stats.refused++; return new SpendStop(reason, record.id, record.question!, record.approved?.amountUsd ?? null, limitOf(record)); };

  /** A quote: its id is the hash of the amount, the models (priced and not) and the plan. */
  function quote(input: { amountUsd: number; models: readonly string[]; unpriced?: readonly string[]; plan?: string; display?: Record<string, unknown> }): Quote {
    const amountUsd = money(input.amountUsd), models = [...new Set(input.models)].sort(), unpriced = [...new Set(input.unpriced ?? [])].sort(), plan = input.plan ?? "";
    return { id: createHash("sha256").update(canonical({ amountUsd, models, unpriced, plan })).digest("hex").slice(0, 20), amountUsd, models, unpriced, plan, ...(input.display ? { display: input.display } : {}) };
  }
  /** Whether a person must be asked: a model's price is not known, or the amount is above the host's "ask before spending more than". */
  const needsAsking = (q: Quote): boolean => q.unpriced.length > 0 || q.amountUsd > deps.thresholdUsd() + 1e-12;
  function approve(record: ActionRecord, question: Question): void {
    const before = record.approved;
    const passes = [...(before?.passes ?? [])];
    // Rule (h): the names of a start quote with no amount, and the model a stop about a request of unknown price was answered for.
    const free = [...new Set([...(before?.free ?? []), ...(question.at === "start" && question.amountUsd <= 0 ? question.unpriced : []), ...(question.at === "stop" && question.reason === "over_amount" && question.unknownStep ? [question.unknownStep.model] : []), ...(question.at === "stop" && question.reason === "unpriced_model" ? question.unpriced : [])])];
    record.approved = { ...(before?.anyPriced ? { anyPriced: true } : {}), ...(passes.length ? { passes } : {}), ...(free.length ? { free } : {}), quoteId: question.id, amountUsd: money(Math.max(question.amountUsd, question.at === "stop" ? before?.amountUsd ?? 0 : 0)), models: [...new Set([...(before?.models ?? []), ...question.models])], unpriced: [...new Set([...(before?.unpriced ?? []), ...question.unpriced])], plan: question.at === "start" ? question.plan : before?.plan ?? question.plan, by: "person", at_ms: now() };
    delete record.question;
  }

  /**
   * A person's request begins — or goes on with — an action. THE approval rule:
   *  - a question is on record: the answer approves it only if it is an answer to THAT question (`quoteId`, when sent,
   *    is its id) and — for the question an action starts with — the quote of now is still the one shown; otherwise
   *    the question (of now) is asked, and nothing is approved;
   *  - nothing was asked yet: a quote that needs no asking is approved by the host's amount; any other is put on
   *    record and asked — `confirmed: true` to a question nobody was shown approves nothing;
   *  - the action is approved and has no open question: it goes on; `spend` holds each request to the approval.
   * `actionId` is the one a question named (`confirmWith.actionId`); one that is not on record, or is another kind's
   * or another owner's, is not used — and it is used only by a request with no id of its own. `fixedId`: the id the request itself has (the hash of what it asks, a run's id):
   * the same request made again finds its action — and its question, and what it has spent — as it stands.
   */
  function open(input: { actionId?: string; fixedId?: string; kind: string; owner: string; quote: Quote; answer?: SpendAnswer; /** The share of the approved amount at which the action stops and asks (1; a film run: the spec's 1.2). */ share?: number; /** The action knows more now of what it will do (a film whose script was just written): the quote of now takes the place of the one it was approved by — by the host's amount when it needs no asking and nothing unpriced is new, else by a question. */ requote?: boolean }): ActionView {
    const mine = (id: string | undefined): ActionRecord | undefined => { const found = id ? load(id) : undefined; return found && found.kind === input.kind && found.owner === input.owner && found.authority === "person" ? found : undefined; };
    // The action the answer names (an approval that covers several requests), else the request's own.
    // A request that has an id of its own (`fixedId`) IS that action: an answer that names another action is an answer
    // to another request's question and selects nothing here (an approval is not transferable between requests).
    const record: ActionRecord = (input.fixedId ? mine(input.fixedId) : mine(input.actionId ?? input.answer?.actionId))
      ?? { id: input.fixedId ?? `${input.kind}:${randomUUID()}`, kind: input.kind, owner: input.owner, authority: "person", share: input.share ?? 1, checkpoints: {}, created_ms: now() };
    if (input.share !== undefined) record.share = input.share;
    const confirmed = input.answer?.confirmed === true, q = input.quote, spentUsd = spentOf(record.id);
    const ask = (reason: StopReason): never => { record.question = { ...q, at: "start", reason, spentUsd, remainsUsd: q.amountUsd, asked_ms: now() }; save(record); throw stopOf(record, reason); };
    // A question the action STARTED with and nobody answered (the person closed it) is not kept against a later press of
    // the same thing: when the quote of now needs no asking any more (the host's amount was raised, the price is known
    // now) the action starts as one nobody was asked about — approved by the host's amount, like any first press.
    if (record.question?.at === "start" && !record.approved && !confirmed && !needsAsking(q)) delete record.question;
    if (record.question) {
      // The question an action starts with is about the quote: one that is no longer the quote of now was answered (or not) in vain.
      if (record.question.at === "start" && record.question.id !== q.id) ask("outdated_quote");
      // NOTHING but the exact answer approves: `confirmed: true` with the id of THIS action and the id of THIS question.
      if (!confirmed || input.answer?.quoteId !== record.question.id || (input.answer?.actionId ?? input.actionId) !== record.id) throw stopOf(record, record.question.reason);
      approve(record, record.question);
    } else if (!record.approved) {
      if (needsAsking(q)) ask("not_approved");
      record.approved = { quoteId: q.id, amountUsd: q.amountUsd, models: q.models, unpriced: [], plan: q.plan, by: "threshold", at_ms: now() };
    } else {
      // The action is approved. The quote of now is covered by that approval only as a whole: the same plan, no model
      // it did not name — and, when the action says it knows more now (`requote`), no more than its amount. Anything
      // else is another quote: approved by the host's amount when that needs no asking, else asked.
      const was = record.approved, models = was.models ?? [], inside = q.plan === (was.plan ?? "") && (was.anyPriced || q.models.every((name) => models.includes(name) || was.unpriced.includes(name))) && q.unpriced.every((name) => was.unpriced.includes(name)) && (!input.requote || q.amountUsd <= limitOf(record)! + 1e-9);
      if (!inside) {
        if (needsAsking({ ...q, unpriced: q.unpriced.filter((name) => !was.unpriced.includes(name)) })) ask("outdated_quote");
        record.approved = { ...was, quoteId: q.id, amountUsd: Math.max(q.amountUsd, was.amountUsd), models: [...new Set([...models, ...q.models])], plan: q.plan, at_ms: now() };
      }
    }
    save(record);
    return view(record);
  }
  /**
   * A run that asks its person itself (one-prompt video's card, an automation's approval) puts what they confirmed on
   * record HERE, so that its paid requests are covered by an approval the gate knows — not refused, and not waved
   * through: they are held to that amount (times `share`), every charge counted. `fixedId` is the run's session
   * (`run:<id>`): the services find the action by it. A higher amount confirmed later replaces the earlier one.
   * A model whose price is not known is covered only when it is NAMED (`unpriced`) — there is no blanket leave.
   */
  function cover(input: { fixedId: string; kind: string; owner: string; amountUsd: number; share?: number; /** The models the run's card named (with a price); without them: any priced model, inside the amount. */ models?: readonly string[]; /** The models of unknown price the person approved BY NAME (a bare model id; `ANY_UNPRICED` only when the run's own person set "any model", in so many words). Nothing else of unknown price is covered — there is no leave the CALLER can give itself. */ unpriced?: readonly string[] }): ActionView {
    const found = load(input.fixedId), record: ActionRecord = found?.authority === "person" ? found : { id: input.fixedId, kind: input.kind, owner: input.owner, authority: "person", share: input.share ?? 1, checkpoints: {}, created_ms: now() };
    if (input.share !== undefined) record.share = input.share;
    const unpriced = [...new Set([...(record.approved?.unpriced ?? []), ...(Array.isArray(input.unpriced) ? input.unpriced.filter((name): name is string => typeof name === "string") : [])])];
    // Rule (h): a run confirmed with NO amount — only the names of models whose price is not known — has no amount to hold those models to.
    const free = [...new Set([...(record.approved?.free ?? []), ...(input.amountUsd <= 0 ? unpriced : [])])];
    record.approved = { quoteId: record.approved?.quoteId ?? "", amountUsd: money(input.amountUsd), models: [...new Set([...(record.approved?.models ?? []), ...(input.models ?? [])])], unpriced, plan: input.kind, by: "person", at_ms: now(), ...(input.models ? {} : { anyPriced: true }), ...(free.length ? { free } : {}) };
    // The amount answers a question about an amount; one about a model the approval does not name stands until it is named.
    if (record.question && record.question.unpriced.every((name) => unpriced.includes(name)) && input.amountUsd * record.share + 1e-9 >= record.question.amountUsd) delete record.question;
    save(record);
    return view(record);
  }
  /**
   * Work nobody approved by a quote — an agent's call or a run that put no confirmation on record: it has NO authority
   * of its own beyond the host's "ask before spending more than". One request of it is let out when its estimate is
   * within that amount and its price is known; anything else is refused with the money question (a `SpendStop`).
   * `fixedId`: the session the work belongs to, so that everything it spends counts together against that amount.
   */
  function unattended(kind: string, owner: string, call: SpendCall, fixedId?: string): string {
    const name = modelName(call.provider, call.model, call.via), id = fixedId ?? `${kind}:${randomUUID()}`, found = load(id);
    if (found?.authority === "person") return id;
    return open({ fixedId: id, kind, owner, quote: quote({ amountUsd: 0, models: [name], plan: kind }) }).id;
  }
  /** The same rule as `spend`, with nothing reserved or sent: for refusing a request before it is queued. Throws the stop. */
  function check(actionId: string, call: SpendCall): void { admit(actionId, call, false); }
  function admit(actionId: string, call: SpendCall, reserve: boolean): { record: ActionRecord; reservation?: number; /** The identity of the request the reservation stands for: its charge carries it. */ request?: string; /** Not decided yet: a request of unknown price of this action is in flight, and this one is decided when its bill is on record. */ wait?: true } {
    return atomically(() => {
      const record = load(actionId);
      if (!record) throw new ProtocolError("INTERNAL", "A paid request was made for an action the spend gate does not know.", { details: { actionId } });
      // (A record of the kind "nobody is asked about" — made by an earlier version of this host — has no approval, so nothing of it is sent.)
      if (record.question) throw stopOf(record, record.question.reason);
      recover("gen_reservations", "action_id", actionId);
      const name = modelName(call.provider, call.model, call.via), spentUsd = spentOf(actionId), flying = flyingOf(actionId), limit = limitOf(record)!, next = call.estimateUsd, was = record.approved;
      // The approval is enforced WHOLE. A known price: only a model the quote named, and only while spent + in the air
      // + this request fits the amount. A price that is not known: only a model approved by name — and it is still
      // under the amount: nothing of it goes out once the action has PASSED its limit, nor once it has REACHED it with
      // anything charged for a model of unknown price (what such a model reports is spending the quote did not hold:
      // at the limit there is no room for more of it). The one case that goes out AT the limit: the priced parts cost
      // exactly what was quoted and nothing of unknown price was charged yet — that is the quote as it was approved
      // ("$x, and <model> at a price that is not known"), not an excess of it.
      // And a request of unknown price is decided with every other one's bill ON RECORD: while one is in flight the next
      // WAITS for it (three made together are decided one after the other, each seeing what the one before was billed).
      // The one that cannot be waited for is a turn inside which this very request may have been made (an agent's
      // step): with the action at its limit and such a turn's bill still out, the request is refused.
      // Rule (h): a model of unknown price that is FREE for this action (named in a quote with no amount, or freed by the answer to its stop) is held to no amount and waits for no bill.
      const freed = next === null && !!was && ((was.free ?? []).includes(name) || (was.anyPriced === true && ((was.free ?? []).includes(call.model) || (was.free ?? []).includes(ANY_UNPRICED))));
      const pending = next === null && !freed ? unknownFlying(actionId) : { all: 0, nesting: 0 }, leaf = call.leaf ?? call.via !== "runtime";
      const reason: StopReason | undefined = !was ? "not_approved"
        : next === null ? (!(was.unpriced.includes(name) || (was.anyPriced && (was.unpriced.includes(call.model) || was.unpriced.includes(ANY_UNPRICED)))) ? "unpriced_model" : freed ? undefined : spentUsd + flying > limit + 1e-9 || (spentUsd + flying >= limit - 1e-9 && (unknownSpentOf(record) > 0 || pending.nesting > 0 || unresolvedUnknown(actionId) > 0)) ? "over_amount" : undefined)
          : next > 0 && was.by === "person" && !(was.anyPriced || (was.models ?? []).includes(name)) ? "outdated_quote"
            : next > 0 && spentUsd + flying + next > limit + 1e-9 ? "over_amount" : undefined;
      // The person answered a stop about THIS request of unknown price (the same model, kind of work and job): that answer lets it — once — out past the used-up amount.
      const logical = call.request ?? call.ref, step: Step = { model: name, kind: call.kind, ...(logical ? { ref: logical } : {}) }, pass = reason === "over_amount" && next === null ? (was?.passes ?? []).findIndex((entry) => sameStep(entry, step)) : -1, passing = pass >= 0;
      if (passing && reserve && pending.all > pending.nesting) return { record, wait: true as const };
      if (passing) { if (reserve) { was!.passes!.splice(pass, 1); if (!was!.passes!.length) delete was!.passes; save(record); } }
      else if (reason) {
        // A request of unknown price is asked about AS one: its model is named as unpriced and the question's amount is "not known" — never the amount spent so far dressed up as its price.
        const rest = next === null ? null : money(flying + next);
        const content = { amountUsd: rest === null ? spentUsd : money(spentUsd + rest), models: [name], unpriced: next === null ? [name] : [], plan: `${record.kind}: ${call.kind}${logical ? ` ${logical}` : ""}` };
        record.question = { ...quote(content), at: "stop", reason, spentUsd, remainsUsd: rest, asked_ms: now(), ...(next === null ? { unknownStep: step } : {}) };
        save(record);
        throw stopOf(record, reason);
      }
      if (reserve && next === null && pending.all > pending.nesting) return { record, wait: true };
      if (!reserve || next === 0) return { record };
      const request = randomUUID();
      return { record, request, reservation: Number(db.prepare("INSERT INTO gen_reservations (action_id, usd, ts_ms, unknown, leaf, holder, provider, model, kind, ref, session_key, request) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(actionId, next ?? 0, now(), next === null ? 1 : 0, leaf ? 1 : 0, HOLDER, call.provider, call.model, call.kind, call.ref ?? null, call.session?.key ?? null, request).lastInsertRowid) };
    });
  }
  /**
   * reserve → send → charge, around ONE provider request. Refused (a `SpendStop`, with the question put on record)
   * when the action's approval does not cover it. `send` gets the token a guarded adapter asks for; the charge is
   * recorded when the provider answers — whatever `send` does with the answer afterwards.
   */
  async function spend<T>(actionId: string, call: SpendCall, send: (token: SpendToken) => Promise<T>): Promise<T> {
    const passedOn = relayed.getStore();
    if (passedOn?.actionId === actionId) passedOn.requests++;
    let admitted = admit(actionId, call, true);
    while (admitted.wait) { await billOf(actionId); admitted = admit(actionId, call, true); }
    const { reservation, request } = admitted;
    let charged = false;
    const token = new SpendToken(MINT, actionId, call, (usd) => {
      charged = true;
      // The reservation BECOMES the charge (review 16 #6): the bill is put on record and what was held for it is given
      // up in one transaction of the store, under the request's own identity — a host that dies at any moment leaves
      // the one or the other, never both (which the host that takes over would count twice).
      const convert = (): void => {
        db.prepare("INSERT INTO gen_charges (action_id, provider, model, kind, usd, ts_ms, ref, session_key, base_usd, provisional, turn_ids, sent_ms, request) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(actionId, call.provider, call.model, call.kind, usd, now(), call.ref ?? null, call.session?.key ?? null, call.session?.baseUsd ?? null, call.provisional ? 1 : 0, call.session?.turnIds?.length ? JSON.stringify(call.session.turnIds) : null, call.session?.sentMs ?? null, request ?? null);
        if (reservation !== undefined) db.prepare("DELETE FROM gen_reservations WHERE id = ?").run(reservation);
      };
      // (Inside a transaction somebody else opened on this store the two writes are already one step of it.)
      if (reservation === undefined || db.isTransaction) convert(); else atomically(convert);
    });
    if (reservation !== undefined) tokens.get(token)!.track = (): void => { db.prepare("UPDATE gen_reservations SET session_key = ?, turn_ids = ?, sent_ms = ? WHERE id = ?").run(call.session?.key ?? null, call.session?.turnIds?.length ? JSON.stringify(call.session.turnIds) : null, call.session?.sentMs ?? null, reservation); };
    stats.tokens++; stats.spending++;
    try {
      const value = await send(token);
      // A request that is not an adapter's (a turn of a runtime's model) and said nothing of its cost: it was answered, so it is charged its estimate.
      if (!charged && call.via === "runtime") token.charge();
      return value;
    } finally {
      stats.spending--;
      tokens.get(token)!.state = "done";
      if (reservation !== undefined) db.prepare("DELETE FROM gen_reservations WHERE id = ?").run(reservation);
      wake(actionId);
    }
  }
  /** Takes the token of a paid adapter call: the call is refused without a live one for this very provider and model. */
  function take(token: unknown, provider: string, model: string): { charge(usd: number | null | undefined): void } {
    const held = token instanceof SpendToken ? tokens.get(token) : undefined;
    if (!held || held.state !== "live" || (token as SpendToken).call.provider !== provider || (token as SpendToken).call.model !== model) {
      stats.refused++;
      throw new ProtocolError("INTERNAL", "A paid provider request was made outside the spend gate. Every paid call goes through `spend`.", { details: { provider, model, reason: "spend_gate_bypassed" } });
    }
    held.state = "sent"; stats.sent++;
    return held;
  }
  /** What Usage's records of ONE turn say it cost: their sum when every one of them carries a cost (zero is a cost: the turn is settled and was free), undefined while any does not say yet — "settled at zero" and "not known yet" are two states. */
  const settledOf = (own: readonly TurnRecord[]): number | undefined => (own.length && own.every((entry) => typeof entry.costUsd === "number" && Number.isFinite(entry.costUsd)) ? money(own.reduce((sum, entry) => sum + Math.max(0, entry.costUsd as number), 0)) : undefined);
  /**
   * A TURN of a runtime's model (a chat model, through the session service) as paid work: the one way film, captions and
   * generation run one. `turn` is the workflow service's (`runs.turn`); what comes back takes the action it is charged
   * to and the model it goes to, and is ONE request of that action: checked like any other (the host knows no price
   * for a runtime's model unless the caller gives an estimate, so it goes only to a model approved by name), and
   * charged the moment the turn has answered — BEFORE the caller reads or validates the answer — with what the turn
   * OWN record in Usage says it cost (the record of this very turn — never what the session's total grew by: that may be
   * another turn's usage arriving late), else PROVISIONALLY: the request's estimate, or "not known" (NULL — never a
   * zero nobody settled). The charge carries its session and its turn's ids, and Usage's own "updated" event settles
   * it (`usageUpdated`). (`usage`, a reader of session totals, is accepted for its callers and no longer read.)
   * A turn that failed has its charge row all the same, settled the same way.
   */
  function guardTurn<I extends { sessionKey?: string; discard?: boolean; /** The model the turn runs on, or the role that names it: how it is billed is read from it (ruling R9). */ ref?: { runtimeId?: string; providerId: string; modelId: string }; role?: string; onSession?(sessionKey: string): void; /** The runtime's id of the turn, told the moment the message was dispatched (the caller's `turn` calls it with what `chat.send` answered). */ onTurn?(runId: string): void }, T extends { text: string; sessionKey?: string; costUsd?: number }>(turn: (deviceId: string, input: I) => Promise<T>, _usage?: (sessionKey: string) => Promise<number | null>) {
    return async (actionId: string, ref: { providerId: string; modelId: string }, deviceId: string, input: I, estimateUsd: number | null = null, options: { /** Nothing else of the action is requested inside this turn (a film's writing or looking turn, a translation): see `SpendCall.leaf`. */ leaf?: boolean; /** `turn` is itself a request of this action behind this gate (it calls `spend` for it): it is passed on as it is. */ relay?: boolean } = {}): Promise<T> => {
      // Ruling R9: a turn on the person's own signed-in runtime is not a request of the action — it is sent as it is, with no approval asked and nothing charged.
      // Asked AT the dispatch (review 16 #1): a sign-in that is no longer a subscription by now makes the turn a paid request like any other.
      if ((await billingAtDispatch({ ref: input.ref ?? ((ref as { runtimeId?: string }).runtimeId ? ref : undefined), ...(input.role ? { role: input.role } : {}) })) === "own_account") return turn(deviceId, input);
      const call: SpendCall = { provider: ref.providerId, model: ref.modelId, via: "runtime", estimateUsd, kind: "turn", ...(options.leaf ? { leaf: true } : {}) };
      // The turn handed in is ITSELF a request of this action (a run's own guarded turn): one turn is one request — it is
      // passed on, not wrapped in a second one (which would be charged twice and, at an unknown price, wait for itself).
      // Should it come back without having been a request after all, it is put on record here: "not known", never nothing.
      if (options.relay) return relayed.run({ actionId, requests: 0 }, async () => { try { return await turn(deviceId, input); } finally { if (!relayed.getStore()!.requests && load(actionId)) db.prepare("INSERT INTO gen_charges (action_id, provider, model, kind, usd, ts_ms, provisional) VALUES (?, ?, ?, ?, NULL, ?, 1)").run(actionId, call.provider, call.model, call.kind, now()); } });
      return spend(actionId, call, async (token) => {
        // The session is captured the moment the turn has it — BEFORE the message is sent: a turn that then fails still names its session on its charge.
        let captured = input.sessionKey;
        const sentMs = now(), ids: string[] = [];
        /** What is known of the turn so far goes on the request (its charge will carry it) and on its reservation (should the host die now). */
        const note = (): void => { if (!captured) return; call.session = { key: captured, baseUsd: null, sentMs, ...(ids.length ? { turnIds: [...ids] } : {}) }; tokens.get(token)!.track?.(); };
        /** The runtime's own id of this turn, as its dispatch was given it: the ONLY thing that says which record in Usage is this turn's. */
        const onTurn = (runId: string): void => { if (typeof runId !== "string" || !runId || ids.includes(runId)) return; ids.push(runId); note(); };
        note();
        const sending = { ...input, onSession: (sessionKey: string): void => { captured = sessionKey; note(); input.onSession?.(sessionKey); }, onTurn: (runId: string): void => { onTurn(runId); input.onTurn?.(runId); } };
        /**
         * What the turn's OWN records say it cost — the records with the ids its dispatch was given, and only when every
         * one of them is there and says (a zero that Usage has settled is a cost: zero). Undefined while any does not say
         * yet — and always for a turn whose dispatch gave no id: no record is taken for its own because it is new.
         */
        const own = async (): Promise<number | undefined> => {
          if (!captured || !ids.length || !turnsOf) return undefined;
          let records: TurnRecord[] | null = null;
          try { records = await turnsOf(captured); } catch { /* Usage cannot say now: the charge stays provisional and its event settles it */ }
          const mine = (records ?? []).filter((entry) => ids.includes(entry.runId));
          return mine.length === ids.length ? settledOf(mine) : undefined;
        };
        let answer: T;
        try { answer = await dispatching.run({ session: () => captured, onTurn }, () => turn(deviceId, sending)); } catch (error) {
          // A turn that failed may have run, and been billed: it has its charge row — what its own record in Usage says
          // now, else PROVISIONALLY what it was estimated at (its bound; "not known" when it has none), until that
          // record says. The estimate is not given back with the reservation: three failed $1 turns are $3 that may still arrive.
          captured ??= typeof (error as { details?: { sessionKey?: unknown } } | null)?.details?.sessionKey === "string" ? (error as { details: { sessionKey: string } }).details.sessionKey : undefined;
          note();
          const cost = await own();
          if (cost !== undefined) token.charge(cost); else { call.provisional = true; token.charge(); }
          throw error;
        }
        captured = answer.sessionKey ?? captured;
        note();
        // What the turn cost: ITS OWN record in Usage, when that says. What the session cost in all is never used: a
        // session's growth during a turn may be another turn's usage arriving late (two actions in one session). Only a
        // host whose Usage keeps no record per turn takes what the turn itself states.
        let cost = await own();
        if (cost === undefined && !turnsOf && typeof answer.costUsd === "number" && answer.costUsd > 0) cost = answer.costUsd;
        // Not known at the answer: the charge is the request's estimate (its bound) when it has one, else "not known"
        // — PROVISIONAL, and never a zero nobody settled.
        if (cost !== undefined) token.charge(cost); else { call.provisional = true; token.charge(); }
        return answer;
      });
    };
  }
  /**
   * The runtime answered a dispatch with its id of the turn (the host's session service: what `chat.send` returned). It
   * is the id of the turn that is being dispatched in THIS chain of calls, in that session — and of nothing else.
   */
  function turnSent(sessionKey: string, runId: string): void {
    const going = dispatching.getStore();
    if (going && typeof runId === "string" && (going.session() === undefined || going.session() === sessionKey)) going.onTurn(runId);
  }
  /**
   * Usage's records of a session's turns    };
  }
  /**
   * Usage's records of a session's turns (`records`): every charge of a turn in that session is settled by ITS OWN
   * record — the one whose id the charge carries (given at its dispatch) — and by no other: a charge without an id
   * stays what it is (its bound, or "not known"); no record is taken for it because of when it appeared or began. So
   * two actions that take turns in one session are each charged their own turn, in whatever order the usage arrives. A
   * charge that was provisional (an estimate, or "not known") takes the record's amount; one that was stated only grows.
   */
  function settleTurns(sessionKey: string, records: readonly TurnRecord[]): number {
    const rows = db.prepare("SELECT id, usd, provisional, turn_ids FROM gen_charges WHERE session_key = ? AND turn_ids IS NOT NULL ORDER BY id").all(sessionKey) as { id: number; usd: number | null; provisional: number | null; turn_ids: string | null }[];
    const idsOf = (row: { turn_ids: string | null }): string[] => { try { const found = row.turn_ids ? (JSON.parse(row.turn_ids) as unknown) : []; return Array.isArray(found) ? found.filter((id): id is string => typeof id === "string") : []; } catch { return []; } };
    let settled = 0;
    for (const row of rows) {
      const ids = idsOf(row);
      if (!ids.length) continue;
      const own = records.filter((entry) => ids.includes(entry.runId)), cost = own.length === ids.length ? settledOf(own) : undefined;
      // Not every record of the turn says yet: nothing is settled. A provisional charge takes what they say — zero too.
      if (cost === undefined || (row.provisional ? false : (row.usd ?? 0) >= cost)) continue;
      db.prepare("UPDATE gen_charges SET usd = ?, provisional = 0 WHERE id = ?").run(cost, row.id);
      settled++;
    }
    return settled;
  }
  /** The Usage service announced a change (its own "updated" event; of one session, or of some it does not name): the charges still waiting for their amount are settled with what Usage's record of each turn says now. A session's total settles nothing: it cannot say whose turn an amount is. */
  async function usageUpdated(sessionKey?: string): Promise<void> {
    if (!turnsOf) return;
    const keys = sessionKey ? [sessionKey] : (db.prepare("SELECT DISTINCT session_key FROM gen_charges WHERE session_key IS NOT NULL AND provisional = 1").all() as { session_key: string }[]).map((row) => row.session_key);
    for (const key of keys) {
      if (!db.prepare("SELECT 1 FROM gen_charges WHERE session_key = ? LIMIT 1").get(key)) continue;
      if (turnsOf) {
        let records: TurnRecord[] | null = null;
        try { records = await turnsOf(key); } catch { /* Usage cannot say now: the next event settles it */ }
        if (records) settleTurns(key, records);
      }
    }
  }
  /** Usage that became known late (a turn whose cost Usage settled after it answered): the newest charge of that model on the action that is still "not known" gets its amount — in the store, so it counts from now on. */
  function reconcile(actionId: string, ref: { providerId: string; modelId: string }, usd: number): boolean {
    const row = db.prepare("SELECT id FROM gen_charges WHERE action_id = ? AND provider = ? AND model = ? AND (usd IS NULL OR (abandoned = 1 AND provisional = 1)) ORDER BY id DESC LIMIT 1").get(actionId, ref.providerId, ref.modelId) as { id: number } | undefined;
    if (row) db.prepare("UPDATE gen_charges SET usd = ?, provisional = 0 WHERE id = ?").run(money(Math.max(0, usd)), row.id);
    return !!row;
  }
  /** A request the provider billed and the adapter could not use (it says so on its failure, `billedUsd`): the bill is the request's charge, recorded before the failure goes on. */
  const billedFailure = (held: { charge(usd: number | null | undefined): void }) => (error: unknown): never => { const billed = (error as { billedUsd?: unknown } | null)?.billedUsd; if (typeof billed === "number" && Number.isFinite(billed) && billed > 0) held.charge(billed); throw error; };
  /** The adapter as the rest of the host may hold it: what costs nothing as it is, what costs money only with a token — and charged the moment it answers. */
  function guard(adapter: JcProviderAdapter): GatedAdapter {
    const id = adapter.describe().id;
    const gated: GatedAdapter = {
      describe: () => adapter.describe(), validateConnection: (secret) => adapter.validateConnection(secret), listModels: (secret) => adapter.listModels(secret),
      ...(adapter.sends ? { sends: (capability, model) => adapter.sends!(capability, model) } : {}), ...(adapter.textBytes ? { textBytes: (request) => adapter.textBytes!(request) } : {}),
      ...(adapter.ready ? { ready: (modelId) => adapter.ready!(modelId) } : {}),
      async submit(request, ctx, token) { const held = take(token, id, request.model), answer = await adapter.submit(request, ctx).catch(billedFailure(held)); held.charge(answer.result.costUsd); return answer; },
      ...(adapter.transcribe ? { async transcribe(input, ctx, token) { const held = take(token, id, input.model), answer = await adapter.transcribe!(input, ctx).catch(billedFailure(held)); held.charge(answer.costUsd); return answer; } } : {}),
      ...(adapter.translate ? { async translate(input, ctx, token) { const held = take(token, id, input.model), answer = await adapter.translate!(input, ctx).catch(billedFailure(held)); held.charge(answer.costUsd); return answer; } } : {}),
    };
    return Object.freeze(gated);
  }
  /** A person names an amount for an action that stopped (a film run's "confirm the new amount"): it answers the open question when it covers it — never a model whose price is not known. */
  function raise(actionId: string, amountUsd: number, answer: SpendAnswer = {}): ActionView {
    const record = load(actionId);
    if (!record || record.authority !== "person") throw new ProtocolError("NOT_FOUND", "There is nothing to confirm for this action.", { details: { actionId } });
    const question = record.question;
    // An amount is an answer only to the question it names (its action and its id), and only when it covers it.
    if (question) { if (answer.quoteId === question.id && (answer.actionId ?? actionId) === record.id && !question.unpriced.length && amountUsd + 1e-9 >= question.amountUsd) approve(record, { ...question, amountUsd: money(amountUsd) }); }
    else if (record.approved) record.approved = { ...record.approved, amountUsd: money(Math.max(amountUsd, record.approved.amountUsd)), by: "person", at_ms: now() };
    save(record);
    return view(record);
  }

  return {
    quote, needsAsking, open, unattended, atomically, settleTurns, usageUpdated, turnSent, billingOf,
    /** The host's runtimes, as the gate reads how a model is billed (ruling R9): "own_account" for a runtime the person signed in to themselves and that holds no key of this host. */
    bindBilling(classify: (who: { ref?: { runtimeId?: string; providerId: string; modelId: string }; role?: string }) => Billing | undefined, atDispatch?: (who: { ref?: { runtimeId?: string; providerId: string; modelId: string }; role?: string }) => Promise<Billing | undefined>, /** The runtime's name as a person knows it (its label). */ nameOf?: (runtimeId: string) => string | undefined): void { billing = classify; billingNow = atDispatch; accountName = nameOf; },
    /** The name a person knows a runtime by ("Claude Code"); undefined when the host has none for it — a screen then says "your own account", never an id. */
    accountOf(runtimeId: string | undefined): string | undefined { try { const name = runtimeId ? accountName?.(runtimeId) : undefined; return typeof name === "string" && name.trim() && name !== runtimeId ? name.trim() : undefined; } catch { return undefined; } },
    /** The host's Usage, as the gate reads it: the default reader of `guardTurn`, and what late usage is settled from. */
    bindUsage(reader: (sessionKey: string) => Promise<number | null>, turns?: (sessionKey: string) => Promise<TurnRecord[] | null>, tree?: (sessionKey: string) => Promise<string[] | null>): void { usageOf = reader; if (turns) turnsOf = turns; if (tree) treeOf = tree; },
    /** What the host's Usage says of a session, for the callers that hold an agent to a person-set allowance: its turns (the last one is the assistant message that is being written), and the sessions of its tree. Null: Usage cannot say. */
    usage: {
      turns: async (sessionKey: string): Promise<TurnRecord[] | null> => { try { return (await turnsOf?.(sessionKey)) ?? null; } catch { return null; } },
      tree: async (sessionKey: string): Promise<string[] | null> => { try { return (await treeOf?.(sessionKey)) ?? null; } catch { return null; } },
    },
    cover, check, spend, guard, guardTurn, reconcile, raise,
    /**
     * What the turns of these sessions may still cost beyond what Usage has settled: the charges that are provisional
     * (a turn that answered before Usage knew its cost: its reserved bound) and the requests still in flight (their
     * reservation). `unknown`: how many of them have no bound at all. For who holds a session tree to an allowance.
     */
    unsettledOf(sessionKeys: ReadonlySet<string>): { usd: number; unknown: number } {
      let usd = 0, unknown = 0;
      for (const row of db.prepare("SELECT session_key, usd FROM gen_charges WHERE provisional = 1 AND session_key IS NOT NULL").all() as { session_key: string; usd: number | null }[]) if (sessionKeys.has(row.session_key)) { if (row.usd === null) unknown++; else usd += row.usd; }
      for (const row of db.prepare("SELECT session_key, usd, unknown FROM gen_reservations WHERE session_key IS NOT NULL").all() as { session_key: string; usd: number; unknown: number | null }[]) if (sessionKeys.has(row.session_key)) { if (row.unknown) unknown++; else usd += row.usd; }
      return { usd: money(usd), unknown };
    },
    /** The ids of the turns whose charge is still provisional, of these sessions: Usage's record of such a turn says nothing final yet. */
    unsettledTurns(sessionKeys: ReadonlySet<string>): Set<string> {
      const ids = new Set<string>();
      for (const row of db.prepare("SELECT session_key, turn_ids FROM gen_charges WHERE provisional = 1 AND session_key IS NOT NULL AND turn_ids IS NOT NULL").all() as { session_key: string; turn_ids: string }[]) if (sessionKeys.has(row.session_key)) { try { for (const id of JSON.parse(row.turn_ids) as string[]) ids.add(id); } catch { /* not a list: names no turn */ } }
      return ids;
    },
    /** The action a run's own confirmation put on record (`cover`), by the run's session; undefined: the run is the host's own work. */
    covered: (sessionId: string | undefined): string | undefined => (sessionId && load(sessionId)?.authority === "person" ? sessionId : undefined),
    /** The question that is on record for an action, as the stop that asked it; undefined when nothing is open. */
    pending: (actionId: string): SpendStop | undefined => { const record = load(actionId); return record?.question ? new SpendStop(record.question.reason, record.id, record.question, record.approved?.amountUsd ?? null, limitOf(record)) : undefined; },
    /**
     * What the REST of the action is estimated at, for the figure of the question it stopped with: the gate asks about
     * the one request it did not send; the action knows what else it still has to do (a second recording is listened
     * to as well; a film has more frames to draw). So one answer covers what remains, not one request of it.
     */
    rest(actionId: string, restUsd: number | null): void {
      const record = load(actionId), question = record?.question;
      if (!record || !question || question.at !== "stop" || question.unpriced.length || restUsd === null || restUsd <= (question.remainsUsd ?? 0)) return;
      const remainsUsd = money(restUsd), amountUsd = money(question.spentUsd + remainsUsd);
      record.question = { ...question, ...quote({ amountUsd, models: question.models, unpriced: question.unpriced, plan: question.plan }), remainsUsd };
      save(record);
    },
    /** The action gave up the one request its open question was about (an optional step it does without — an automatic second recording): the question is nobody's to answer any more. The approval and every charge stay as they are. */
    forget(actionId: string): void { const record = load(actionId); if (record?.question?.at === "stop") { delete record.question; save(record); } },
    /** The action as it stands; undefined when the gate does not know it. */
    action: (actionId: string): ActionView | undefined => { const record = load(actionId); return record && view(record); },
    spentOf,
    /** Where an action stands inside its own work (a translation: which candidate, repair or not), kept with it. */
    checkpoint(actionId: string, key: string, value: unknown): void { const record = load(actionId); if (!record) return; if (value === undefined) delete record.checkpoints[key]; else record.checkpoints[key] = value; save(record); },
    /** A server-given id for an action a question had minted (a film's start question becomes its run's action). */
    rename(actionId: string, fixedId: string): void {
      const record = load(actionId);
      if (!record || actionId === fixedId) return;
      db.prepare("DELETE FROM gen_standing WHERE key IN (?, ?)").run(KEY + actionId, KEY + fixedId);
      db.prepare("UPDATE gen_charges SET action_id = ? WHERE action_id = ?").run(fixedId, actionId);
      save({ ...record, id: fixedId });
    },
    /** The action ended: its approval ends with it (the same answer sent again approves nothing). Its charges stay in the ledger. */
    close(actionId: string): void {
      db.prepare("DELETE FROM gen_standing WHERE key = ?").run(KEY + actionId);
      // Charges are NEVER deleted. They are filed under the ended action's own name, so that a new action of the same request starts at nothing spent.
      db.prepare("UPDATE gen_charges SET action_id = ? WHERE action_id = ?").run(`${actionId}#${randomUUID()}`, actionId);
      db.prepare("DELETE FROM gen_reservations WHERE action_id = ?").run(actionId);
      wake(actionId);
    },
    /** What the requests of one job (`call.ref`) were charged, from the store: also after its action ended, also after a restart. */
    chargedFor: (ref: string): number => money((db.prepare("SELECT COALESCE(SUM(usd), 0) AS usd FROM gen_charges WHERE ref = ?").get(ref) as { usd: number }).usd),
    /**
     * One logical request is claimed ONCE, in the store (a unique key): true for the one that got it, false for every
     * other — from this gate or another on the same database — until it is given back (`unclaim`) or its holder — a host process — no longer exists.
     */
    claim(key: string): boolean { return atomically(() => { recover("gen_claims", "key", key); return Number(db.prepare("INSERT OR IGNORE INTO gen_claims (key, ts_ms, holder) VALUES (?, ?, ?)").run(key, now(), HOLDER).changes) === 1; }); },
    unclaim(key: string): void { db.prepare("DELETE FROM gen_claims WHERE key = ?").run(key); },
    /** Two identical requests made together are one piece of work: the second gets the answer of the first. (The work is started here and now; what it throws before its first wait is the caller's to handle.) */
    once<T>(key: string, work: () => Promise<T>): Promise<T> {
      const going = running.get(key) as Promise<T> | undefined;
      if (going) return going;
      // Not running here: it is claimed in the store, so that another gate on this database does not start it too.
      if (!this.claim(`once:${key}`)) return Promise.reject(new ProtocolError("CONFLICT", "This request is already being worked on.", { retryable: true, details: { reason: "already_running" } }));
      let started: Promise<T>;
      try { started = work().finally(() => { this.unclaim(`once:${key}`); if (running.get(key) === started) running.delete(key); }); } catch (error) { this.unclaim(`once:${key}`); throw error; }
      running.set(key, started);
      return started;
    },
    /** For the test that nothing bypasses the gate: tokens given, paid adapter requests sent with one, requests refused. */
    stats: (): { tokens: number; sent: number; refused: number; /** Requests the gate has let out and that have not ended yet. */ spending: number } => ({ ...stats }),
  };
}
export type SpendGate = ReturnType<typeof createSpendGate>;
