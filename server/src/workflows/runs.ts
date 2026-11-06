import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { workflow as wf } from "@jagentchill/editor-core";
import {
  ROLE_SCOPES, type Role, type Scope, type WorkflowDocument, type WorkflowExecution, type WorkflowLogEntry, type WorkflowNodeAggregate, type WorkflowNodeStatus, type WorkflowRunChange,
  type WorkflowRunRecord, type WorkflowRunStatus, type WorkflowTimelineEntry,
} from "@jagentchill/protocol";
import type { Connection, RpcMethod } from "../channel/ws-channel.ts";
import type { DeviceRegistry } from "../devices/registry.ts";
import { ProtocolError } from "../errors.ts";
import { transaction } from "../store/database.ts";
import { isSpendStop, type SpendGate } from "../generation/spend-gate.ts";
import { wireError, type WorkflowDocuments } from "./documents.ts";

/** At most this many runs are running at once; further ones wait in start order. */
export const MAX_RUNNING_RUNS = 3;
const TERMINAL: ReadonlySet<string> = new Set(["succeeded", "failed", "cancelled"]);
const ACTIVE: ReadonlySet<string> = new Set(["running", "waiting_approval"]);
const LOG_LIMIT = 10_000;
/** Of the steps that ended, this many of the latest have their session named in the run's snapshot (the steps at work always do, and so does every session that still waits for an answer). */
const ENDED_SESSIONS = 20;
const UNATTENDED_WORKFLOW_LINE = "This is an unattended workflow run. Do not ask the user or call a question tool; decide from the available information and state your assumption in this step's output.";
const RANK: Record<WorkflowNodeStatus, number> = { waiting_approval: 9, running: 8, ready: 7, pending: 6, failed: 5, cancelled: 4, stale: 3, skipped: 2, succeeded: 1 };

export type RunStart = {
  workflowId: string; params?: Record<string, unknown>; origin: WorkflowRunRecord["origin"]; originRef?: WorkflowRunRecord["originRef"]; startedByDeviceId: string; attended: boolean;
  revision?: number; idempotencyKey?: string; trigger?: { source: string; payload: unknown };
  /** Who answers the overridable checkpoints of this run, in place of what the document says. */
  approvalOverride?: "auto" | "human";
};
/** A step tool of the host: what a `tool` node names in `config.tool`. It gets the step's inputs and returns its outputs. */
export type StepTool = (context: wf.ExecutorContext, run: { runId: string; number: number; workflowName: string; deviceId: string }) => Promise<wf.ExecutorResult>;
/**
 * `notify` / `attention`: a step of the run says something, or waits for a person. `ended`: the run itself came to a stop
 * a person should know of when they are elsewhere — it finished, it failed, or it is paused (`status`, `pauseReason`).
 */
export type RunNotice = { runId: string; workflowId: string; workflowName: string; kind: "notify" | "attention" | "ended"; title: string; body: string; level: "info" | "attention"; link: "run" | "project" | "none"; nodeId: string; path: string; status?: string; pauseReason?: string };
export type RunDeps = {
  db: DatabaseSync; now: () => number; docs: WorkflowDocuments; devices: DeviceRegistry;
  /** Whether the server's link to the agent engine is up. */
  agentsReady: () => boolean;
  /** The session service: an agent step is a real session of the device that started the run. */
  sessions: () => { methods: Map<string, RpcMethod> };
  /** The step tools `tool` nodes can name (the built-in templates register theirs). */
  stepTools?: () => ReadonlyMap<string, StepTool> | undefined;
  /** The sessions that hold a permission request nobody answered yet. */
  pendingSessions?: () => ReadonlySet<string>;
  /** Close questions left in this run's step sessions when the run reaches a terminal state. */
  closePendingQuestions?: (sessionKey: string) => void;
  /** Marks a session as tainted: it was given content from outside the user and the system (the tools service enforces what follows from it). */
  taint?: (sessionKey: string, source: string, texts?: readonly string[]) => void;
  /** Called before an agent step's turn is sent: the run's money keeper holds the most the turn can cost against the run's limit, or throws (nothing is sent then). */
  reserveTurn?: (runId: string, turn: TurnAsk) => void | Promise<void>;
  emit: {
    run(record: WorkflowRunRecord, changes: WorkflowRunChange[]): void;
    /** A notification of a run, to the devices its target names. */
    notice(notice: RunNotice, to: (deviceId: string, role: Role) => boolean): void;
  };
};
/** A turn as the services that hold money are asked about it before it is sent. */
export type TurnAsk = { ref?: { runtimeId: string; providerId: string; modelId: string }; role?: string; message: string; /** The turn also reads text whose length is not known yet (an estimate made before the run: another step's output). Ruling R10: the bound then counts the message as far as it is written; the turn is reserved with its whole message when it is sent. */ more?: boolean };
/**
 * What paid turns need from the services that hold money, bound once the host has them (`bindSpend`): the paid-call
 * gate, what a session's turns have cost so far (Usage), and the most one turn can cost before it is sent.
 */
export type TurnMoney = {
  gate?: () => SpendGate | undefined;
  turnCost?: (sessionKey: string) => Promise<number | null>;
  turnBound?: (turn: TurnAsk) => { model: string; usd: number | null; routed?: false; /** Ruling R10: `usd` is worked out from a measured prompt size — shown with "about". */ measured?: true; /** The model runs on the person's own signed-in account (ruling R9): not billed by this app. */ ownAccount?: true; /** That account's runtime, as a person knows it ("Claude Code"). */ account?: string } | undefined;
  reserveTurn?: (runId: string, turn: TurnAsk) => void | Promise<void>;
  /** Told before a turn of a run is reserved: how many items each fan-out of the run has got so far (by fan-out step) — what the run was confirmed for "per item" is allowed for them. */
  fanned?: (runId: string, counts: Record<string, number>) => void;
};
type RunRow = { run_id: string; number: number; workflow_id: string; workflow_name: string; status: string; origin: string; record: string; state: string; created_ms: number; started_ms: number | null; finished_ms: number | null; deleted_ms: number | null };
type Stored = Pick<WorkflowRunRecord, "workflowId" | "workflowName" | "revision" | "graphHash" | "origin" | "originRef" | "startedByDeviceId" | "attended" | "created_ms"> & { parentPath?: string };

const textOf = (content: unknown): string =>
  typeof content === "string" ? content : Array.isArray(content) ? (content as Array<{ type?: string; text?: string }>).filter((part) => part.type === "text" && typeof part.text === "string").map((part) => part.text).join("") : "";
/** How data from outside is delimited in a prompt (`automations.ts` writes these blocks): a turn whose message carries one taints its session. */
const UNTRUSTED_BLOCK = "<<<untrusted-data ";
const usdOf = (amount: number): string => `$${amount.toFixed(amount < 0.1 ? 3 : 2)}`;
const failure = (code: string, message: string, extra: { retryable?: boolean; details?: Record<string, unknown> } = {}) => Object.assign(new Error(message), { code, ...extra });

/** Runs of workflows: one engine per live run, its checkpoint in the store, and the executors that do the work outside the engine. */
export function createWorkflowRuns(deps: RunDeps) {
  const { db, now, docs } = deps;
  const engines = new Map<string, wf.RunEngine>();
  let spendPort: TurnMoney = {};
  const stored = new Map<string, Stored>();
  const logSeq = new Map<string, number>(), timelineSeq = new Map<string, number>();
  const settled = new Map<string, Array<(record: WorkflowRunRecord) => void>>();
  const listeners = new Set<(record: WorkflowRunRecord) => void>();
  /** Waiting steps whose devices were told, so that a step is announced once. */
  const announced = new Set<string>();

  const rowOf = (runId: string): RunRow | undefined => db.prepare("SELECT * FROM workflow_runs WHERE run_id = ?").get(runId) as RunRow | undefined;
  function recordOf(row: Pick<RunRow, "run_id" | "number" | "record">, state: wf.RunState): WorkflowRunRecord {
    const base = JSON.parse(row.record) as Stored;
    return {
      id: row.run_id, number: row.number, workflowId: base.workflowId, workflowName: base.workflowName, revision: base.revision, graphHash: base.graphHash, params: state.params,
      status: state.status, origin: base.origin, originRef: base.originRef, startedByDeviceId: base.startedByDeviceId, attended: base.attended, created_ms: base.created_ms, reopenedCount: state.reopenedCount,
      ...(state.pauseReason ? { pauseReason: state.pauseReason } : {}), ...(state.cancelReason ? { cancelReason: state.cancelReason } : {}), ...(state.started_ms ? { started_ms: state.started_ms } : {}),
      ...(state.finished_ms ? { finished_ms: state.finished_ms } : {}), ...(state.failedNodeId ? { failedNodeId: state.failedNodeId } : {}), ...(state.error ? { error: state.error } : {}), ...(state.outputs ? { outputs: state.outputs } : {}),
    };
  }
  const record = (runId: string): WorkflowRunRecord => { const row = live(runId); return recordOf(row, engines.get(runId)?.state ?? (JSON.parse(row.state) as wf.RunState)); };
  function live(runId: string): RunRow {
    const row = rowOf(runId);
    if (!row || row.deleted_ms !== null) throw new ProtocolError("NOT_FOUND", "This run no longer exists.", { details: { runId } });
    return row;
  }
  const nextSeq = (counter: Map<string, number>, table: string, runId: string): number => {
    let seq = counter.get(runId);
    if (seq === undefined) seq = (db.prepare(`SELECT COALESCE(MAX(seq), 0) AS seq FROM ${table} WHERE run_id = ?`).get(runId) as { seq: number }).seq;
    counter.set(runId, seq + 1);
    return seq + 1;
  };
  function timeline(runId: string, change: WorkflowTimelineEntry["change"]): void {
    db.prepare("INSERT INTO workflow_run_timeline (run_id, seq, ts_ms, json) VALUES (?, ?, ?, ?)").run(runId, nextSeq(timelineSeq, "workflow_run_timeline", runId), now(), JSON.stringify(change));
  }
  function log(runId: string, entry: { nodeId: string; path: string; level: WorkflowLogEntry["level"]; source: WorkflowLogEntry["source"]; message: string }): void {
    const seq = nextSeq(logSeq, "workflow_run_logs", runId);
    db.prepare("INSERT INTO workflow_run_logs (run_id, seq, ts_ms, node_id, path, level, source, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(runId, seq, now(), entry.nodeId, entry.path, entry.level, entry.source, entry.message.slice(0, 4000));
    // A log holds 10,000 entries: the oldest go first.
    if (seq > LOG_LIMIT && seq % 500 === 0) db.prepare("DELETE FROM workflow_run_logs WHERE run_id = ? AND seq <= ?").run(runId, seq - LOG_LIMIT);
  }
  const userAction = (runId: string, action: string, deviceId: string, nodeId?: string): void => timeline(runId, { kind: "user.action", action, deviceId, ...(nodeId ? { nodeId } : {}) });

  /** The checkpoint: the state and what changed are in the store before anyone hears of it. */
  function commit(runId: string, state: wf.RunState, changes: WorkflowRunChange[]): void {
    transaction(db, () => {
      db.prepare("UPDATE workflow_runs SET status = ?, state = ?, started_ms = ?, finished_ms = ? WHERE run_id = ?").run(state.status, JSON.stringify(state), state.started_ms ?? null, state.finished_ms ?? null, runId);
      for (const change of changes) timeline(runId, change);
    });
    const row = rowOf(runId)!;
    const current = recordOf(row, state);
    deps.emit.run(current, changes);
    for (const change of changes) {
      if (change.kind !== "node.status" || change.status !== "waiting_approval") continue;
      const exec = state.executions[wf.execKey(change.nodeId, change.path)];
      const request = exec?.request as { title?: string; assignee?: string } | undefined;
      // A person is needed: the devices that may answer hear of it once.
      const key = `${runId}:${change.nodeId}@${change.path}:${exec?.started_ms ?? 0}`;
      if (!request || announced.has(key)) continue;
      announced.add(key);
      deps.emit.notice({ runId, workflowId: current.workflowId, workflowName: current.workflowName, kind: "attention", title: request.title ?? "A workflow needs you", body: current.workflowName, level: "attention", link: "run", nodeId: change.nodeId, path: change.path },
        (deviceId, role) => mayAnswer(String(request.assignee ?? "any_editor"), current, deviceId, role));
    }
    for (const listener of listeners) listener(current);
    if (changes.some((change) => change.kind === "run.status")) {
      if (TERMINAL.has(state.status)) {
        engines.delete(runId);
        for (const exec of Object.values(state.executions)) if (exec.sessionKey) deps.closePendingQuestions?.(exec.sessionKey);
        const waiting = settled.get(runId) ?? [];
        settled.delete(runId);
        queueMicrotask(() => { for (const resolve of waiting) resolve(current); });
      }
      // A run that stopped running frees its slot.
      if (state.status !== "running") queueMicrotask(startQueued);
    }
  }
  const mayAnswer = (assignee: string, run: WorkflowRunRecord, deviceId: string, role: Role): boolean =>
    ROLE_SCOPES[role].includes("jagentchill.generation.run") && (assignee === "run_starter" ? deviceId === run.startedByDeviceId : assignee === "admins" ? role === "admin" : true);

  function engineFor(runId: string, state: wf.RunState): wf.RunEngine {
    const engine = new wf.RunEngine(state, {
      now, gatewayReady: deps.agentsReady, attended: () => stored.get(runId)?.attended === true, commit: (next, changes) => commit(runId, next, changes), log: (entry) => log(runId, entry),
      executors: { agent: (context) => runAgent(runId, context), subworkflow: (context) => runChild(runId, context), notify: (context) => raise(runId, context), tool: (context) => runTool(runId, context) },
    });
    engines.set(runId, engine);
    return engine;
  }
  /** The engine of a run, also of a finished one that an action is about to reopen. */
  function engineOf(runId: string): wf.RunEngine {
    const found = engines.get(runId);
    if (found) return found;
    const row = live(runId);
    stored.set(runId, JSON.parse(row.record) as Stored);
    return engineFor(runId, JSON.parse(row.state) as wf.RunState);
  }
  /** After an action on a finished run: an engine that did not reopen it is let go. */
  const release = (runId: string): void => { const engine = engines.get(runId); if (engine && TERMINAL.has(engine.state.status)) engines.delete(runId); };
  const runningCount = (): number => [...engines.entries()].filter(([runId, engine]) => engine.state.status === "running" && stored.get(runId)?.origin !== "subworkflow").length;
  function startQueued(): void {
    const queued = [...engines.entries()].filter(([, engine]) => engine.state.status === "queued").sort(([, a], [, b]) => a.state.number - b.state.number);
    for (const [, engine] of queued) { if (runningCount() >= MAX_RUNNING_RUNS) return; engine.start(); }
  }

  // — executors —

  /** The source of a run that the data of an event started (its trigger carries the mark `untrusted: true`), else undefined: every session of such a run is tainted. */
  const fromOutside = (runId: string): string | undefined => {
    const trigger = engines.get(runId)?.state.trigger;
    return (trigger?.payload as { untrusted?: unknown } | null | undefined)?.untrusted === true ? `trigger:${trigger!.source}` : undefined;
  };

  /** A connection of the device that started the run, as the session service sees one: it acts with that device's current role. */
  function actingAs(deviceId: string, onEvent: (event: string, payload: unknown) => void): Connection {
    const device = () => { const found = deps.devices.get(deviceId); return found?.state === "active" ? found : undefined; };
    return {
      connId: `workflow:${randomUUID()}`, deviceId, clientInstanceId: "workflow-engine", transport: "loopback", role: () => device()?.role, scopes: (): readonly Scope[] => deps.devices.scopesOf(deviceId),
      send: (event, _stream, payload) => onEvent(event, payload), close: () => undefined,
    };
  }
  async function relay<T>(connection: Connection, method: string, params: unknown): Promise<T> {
    const found = deps.sessions().methods.get(method);
    if (!found) throw failure("UNAVAILABLE", "The session service is not available.");
    if (!connection.scopes().includes(found.scope)) throw failure("SCOPE_DENIED", "The device that started this run can no longer run workflows.");
    return (await found.handle(params, connection)) as T;
  }
  /** One turn of a session: the prompt goes in, the final assistant text comes out. Given `sessionKey` it continues that session instead of starting a new one (and moves it to `ref` when the caller selected another model). */
  async function turn(deviceId: string, input: { ref?: { runtimeId: string; providerId: string; modelId: string }; /** With `ref`: the thinking option and the mode of the profile that named the model (Model routing), so they hold for this turn too. `null` = the profile sets no thinking option: the model's own default, also on a session that another profile left on something else. */ thinkingOptionId?: string | null; modeId?: string; role?: string; title: string; message: string; /** The end of `message` that is hand-off packages of other steps of this run, as the engine rendered them (untrusted-data blocks). */ handed?: string; signal?: AbortSignal; /** Continue this session (e.g. a film's writing turns share one). */ sessionKey?: string; /** The access a session created here is given: `host` makes it usable by every device that may read the session, like the document it belongs to. */ access?: "host"; onSession?(sessionKey: string): void; /** Pictures the model is shown with the message (the turn's attachments). */ images?: { mime: "image/jpeg" | "image/png" | "image/webp"; name: string; bytes: Uint8Array }[]; /** The session exists for this one question: it is deleted when the answer is read, so it never shows in the Sessions list and its pictures are never sent again. */ discard?: boolean; /** The session is tainted whatever its message says (the source of the outside data): every session of a run that an event's data started. */ tainted?: string; }): Promise<{ sessionKey: string; text: string; /** What THIS turn cost, as Usage has it when the turn ended (read before a discarded session is deleted); absent when Usage is not known. */ costUsd?: number }> {
    // `code`: the runtime's own error code of a failed turn, so that a caller tells failures apart by it, not by a sentence.
    let finish: (outcome: { state: string; message?: string; code?: string }) => void = () => undefined;
    const ended = new Promise<{ state: string; message?: string; code?: string }>((resolve) => { finish = resolve; });
    let sessionKey = input.sessionKey ?? "";
    // The answer as it was streamed: the transcript can hold the turn's last message with no text yet (or at all, with
    // some model APIs) at the moment the turn ends, and an empty answer would be read as "the model wrote nothing".
    let streamed = "";
    const connection = actingAs(deviceId, (event, payload) => {
      const body = payload as { sessionKey?: string; state?: string; errorMessage?: string; error?: { message?: string; code?: string }; seq?: number; deltaText?: string; replace?: boolean } | undefined;
      if (!body || body.sessionKey !== sessionKey) return;
      if (event === "jagentchill.chat.stream" && body.state === "delta" && typeof body.deltaText === "string") streamed = body.replace === true || body.seq === 1 ? body.deltaText : streamed + body.deltaText;
      if (event === "jagentchill.chat.error") finish({ state: "error", message: body.error?.message, ...(typeof body.error?.code === "string" ? { code: body.error.code } : {}) });
      // A failed turn is told twice in one moment: its end (no code), then the session's error event with the runtime's
      // normalized code. The end waits a microtask so that the error event, which carries the code, decides.
      else if (event === "jagentchill.chat.stream" && body.state === "error") { const ended = { state: body.state, message: body.errorMessage }; queueMicrotask(() => finish(ended)); }
      else if (event === "jagentchill.chat.stream" && typeof body.state === "string" && ["final", "aborted"].includes(body.state)) finish({ state: body.state, message: body.errorMessage });
    });
    if (!sessionKey) {
      const created = await relay<{ session: { sessionKey: string } }>(connection, "jagentchill.session.create", { ...(input.ref ? { ref: input.ref, ...(input.thinkingOptionId ? { thinkingOptionId: input.thinkingOptionId } : {}), ...(input.modeId ? { modeId: input.modeId } : {}) } : { role: input.role ?? "director" }), title: input.title.slice(0, 120), toolSurface: "workflow-run", origin: "workflow" });
      sessionKey = created.session.sessionKey;
      // A shared session (a film's writing session) is host access: every device that may read the film may continue it.
      if (input.access === "host") await relay(connection, "jagentchill.session.access.set", { sessionKey, access: "host" });
    } else if (input.ref) {
      // A reused session keeps its transcript but must run on the model this call asked for: apply the change, then send.
      const found = await relay<{ session?: { ref?: { runtimeId: string; providerId: string; modelId: string }; thinkingOptionId?: string | null; modeId?: string } }>(connection, "jagentchill.session.get", { sessionKey });
      const current = found.session?.ref;
      const same = current?.runtimeId === input.ref.runtimeId && current?.providerId === input.ref.providerId && current?.modelId === input.ref.modelId;
      if (!same) await relay(connection, "jagentchill.session.runtime.switch", { sessionKey, ref: input.ref, idempotencyKey: randomUUID() });
      // … and with the options of the profile that named it: a session last used by another role keeps that role's options otherwise.
      const now = (await relay<{ session?: { thinkingOptionId?: string | null; modeId?: string } }>(connection, "jagentchill.session.get", { sessionKey })).session;
      const options = { ...(input.thinkingOptionId !== undefined && (now?.thinkingOptionId ?? null) !== input.thinkingOptionId ? { thinkingOptionId: input.thinkingOptionId } : {}), ...(input.modeId && now?.modeId !== input.modeId ? { modeId: input.modeId } : {}) };
      if (Object.keys(options).length) await relay(connection, "jagentchill.session.control.set", { sessionKey, ...options });
    }
    // From its first turn: a session that is handed data from outside is tainted before the model reads a word of it.
    // The data itself is remembered with the mark (the tools service keeps what a session was given from outside).
    // (The packages other steps of the SAME run hand this one are in the same kind of block; they are not "from
    // outside" by themselves — whether a run is, is decided by what started it, `tainted`.)
    const own = input.handed && input.message.endsWith(input.handed) ? input.message.slice(0, -input.handed.length) : input.message;
    if (input.tainted || own.includes(UNTRUSTED_BLOCK)) deps.taint?.(sessionKey, input.tainted ?? "trigger", own.includes(UNTRUSTED_BLOCK) || (input.tainted && input.message.includes(UNTRUSTED_BLOCK)) ? [input.message] : []);
    input.onSession?.(sessionKey);
    await relay(connection, "jagentchill.chat.subscribe", { sessionKey });
    const abort = () => { void relay(connection, "jagentchill.chat.abort", { sessionKey }).catch(() => undefined); finish({ state: "aborted" }); };
    input.signal?.addEventListener("abort", abort, { once: true });
    // What the transcript ends with BEFORE this turn: the answer of this turn is a message that was not there yet.
    type Listed = { role?: string; content?: unknown; id?: unknown; timestamp?: unknown; ts?: unknown };
    const mark = (messages: Listed[]): string => { const last = messages.at(-1); return `${messages.length}|${last?.role ?? ""}|${String(last?.id ?? last?.timestamp ?? last?.ts ?? "")}|${last ? textOf(last.content) : ""}`; };
    const read = () => relay<{ messages: Listed[] }>(connection, "jagentchill.chat.history", { sessionKey, limit: 20, maxChars: 500_000 });
    // What the session had cost before this turn, and what the turn added: the caller (the paid-call gate) charges it.
    let costBefore: number | null = 0;
    const costNow = async (): Promise<number | null> => { if (!spendPort.turnCost) return null; try { return await spendPort.turnCost(sessionKey); } catch { return null; } };
    const cost = async (): Promise<{ costUsd?: number }> => { const after = costBefore === null ? null : await costNow(); return typeof after === "number" ? { costUsd: Math.max(0, Math.round((after - (costBefore ?? 0)) * 1e6) / 1e6) } : {}; };
    try {
      if (input.signal?.aborted) throw failure("CANCELLED", "The step was cancelled.");
      const before = input.sessionKey ? mark((await read()).messages) : "";
      costBefore = input.sessionKey ? await costNow() : 0;
      // No output limit goes with the message: no agent CLI takes one with a turn. What bounds the answer is the
      // model's own longest answer, and that is what a turn is reserved and quoted with (`turnBound`).
      await relay(connection, "jagentchill.chat.send", { sessionKey, message: input.message, ...(input.images?.length ? { attachments: input.images.map((image) => ({ type: "image" as const, mimeType: image.mime, fileName: image.name, content: Buffer.from(image.bytes).toString("base64") })) } : {}) });
      const outcome = await ended;
      if (outcome.state === "aborted") throw failure("CANCELLED", "The turn was stopped.");
      if (outcome.state === "error") throw failure("WORKFLOW_RUNTIME_UNAVAILABLE", outcome.message?.slice(0, 500) || "The agent's turn failed.", outcome.code ? { details: { turnCode: outcome.code } } : {});
      // The answer of THIS turn: the last message of the transcript when it is the assistant's, has text, and was not
      // already there before the turn (a transcript read a moment too early still ends with the PREVIOUS answer). The
      // transcript is asked a few times (it is written just after the turn ends); then the text as it was streamed
      // stands in — never an older message.
      for (let attempt = 0; attempt < 6; attempt++) {
        const history = await read();
        const final = history.messages.at(-1);
        const text = final?.role === "assistant" ? textOf(final.content) : "";
        if (text && mark(history.messages) !== before) return { sessionKey, text, ...(await cost()) };
        // The same words as the answer before are this turn's answer when that is what was streamed.
        if (text && streamed && text === streamed) return { sessionKey, text, ...(await cost()) };
        if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 300));
      }
      return { sessionKey, text: streamed, ...(await cost()) };
    } finally {
      input.signal?.removeEventListener("abort", abort);
      await relay(connection, "jagentchill.chat.unsubscribe", { sessionKey }).catch(() => undefined);
      if (input.discard && !input.sessionKey) await relay(connection, "jagentchill.session.delete", { sessionKey }).catch(() => undefined);
    }
  }

  async function runAgent(runId: string, context: wf.ExecutorContext): Promise<wf.ExecutorResult> {
    const base = stored.get(runId)!;
    const config = context.node.config as { promptTemplate?: string; instructions?: string; runtime?: { mode: string; role?: string; runtime?: string; provider?: string; model?: string } };
    const prompt = context.render(String(config.promptTemplate ?? "")), instructions = context.render(String(config.instructions ?? ""));
    if (!prompt.trim()) throw failure("WORKFLOW_INPUT_INVALID", `${context.node.name}: the prompt is empty for this run.`);
    const runtime = config.runtime;
    // Started on the next turn of the loop: whoever started the run has put its limit on record by then.
    await new Promise((resolve) => setImmediate(resolve));
    // What other agent steps hand this one (`Hand-off package between agents`): their packages, rendered into the
    // prompt as untrusted-data blocks (another model's text is data, never instructions) that name the step each comes
    // from — never their conversation.
    const received = wf.handoffsOf(context.inputs.handoff), state = engines.get(runId)?.state;
    const handed = received.length ? `\n\n${wf.renderHandoffs(received, (nodeId) => state?.doc.nodes.find((node) => node.id === nodeId)?.name ?? nodeId)}` : "";
    const who: TurnAsk = { ...(runtime?.mode === "override" ? { ref: { runtimeId: String(runtime.runtime), providerId: String(runtime.provider), modelId: String(runtime.model) } } : { role: runtime?.role ?? "director" }), message: `${UNATTENDED_WORKFLOW_LINE}\n\n${instructions.trim() ? `${instructions.trim()}\n\n${prompt}` : prompt}${handed}` };
    // The run's money keeper holds the most this turn can cost against the run's limit BEFORE anything is sent.
    await (deps.reserveTurn ?? spendPort.reserveTurn)?.(runId, who);
    const input = { ...who, ...(handed ? { handed } : {}), title: `${base.workflowName} · ${context.node.name}`, signal: context.signal, onSession: context.setSession, ...(fromOutside(runId) ? { tainted: fromOutside(runId) } : {}) };
    // Every turn of every run goes out through the paid-call gate: reserved with the most it can cost BEFORE it is
    // sent, charged what it cost, and not sent when it does not fit. Under the run's own limit when one is on record
    // (its starter's confirmation, or the limit of the automation that started it — of the outermost run when this is
    // a child). A run with nothing on record has no leave of its own: its turn is let out only within the host's "Ask
    // before spending more than" and only at a known price, and otherwise waits for a person's confirmation.
    const gate = spendPort.gate?.();
    if (gate && spendPort.fanned && state && rootOf(runId) === runId) {
      const counts: Record<string, number> = {};
      for (const exec of Object.values(state.executions)) { const items = (exec.inputs as { items?: unknown } | undefined)?.items; if (Array.isArray(items) && state.doc.nodes.find((node) => node.id === exec.nodeId)?.type === "parallel") counts[exec.nodeId] = (counts[exec.nodeId] ?? 0) + items.length; }
      try { spendPort.fanned(runId, counts); } catch { /* the turn is held to what is on record */ }
    }
    const bound = gate ? spendPort.turnBound?.(who) : undefined;
    const paidBy = { providerId: who.ref?.providerId ?? "runtime", modelId: who.ref?.modelId ?? bound?.model ?? `role:${who.role}` };
    // (A role nobody set a model for is sent nothing: the turn itself refuses it, with what is missing.)
    const action = gate && bound?.routed !== false && (actionOf(runId, gate) ?? gate.unattended("workflow.run", `run:${rootOf(runId)}`, { provider: paidBy.providerId, model: paidBy.modelId, via: "runtime", estimateUsd: bound?.usd ?? null, kind: "turn" }, `run:${rootOf(runId)}`));
    let result: Awaited<ReturnType<typeof turn>>;
    if (gate && action) {
      try { result = await gate.guardTurn(turn, spendPort.turnCost)(action, paidBy, base.startedByDeviceId, input, bound?.usd ?? null); }
      catch (error) {
        if (!isSpendStop(error)) throw error;
        const view = gate.action(action), unknown = error.question.unpriced.length > 0;
        throw failure("BUDGET_EXCEEDED", unknown
          ? `${context.node.name} was not started: the price of ${error.question.unpriced.join(", ")} is not known, and the spending limit of this run does not allow models without a known price.`
          : `${context.node.name} was not started: with it this run could cost ${usdOf(error.question.amountUsd)}, more than its spending limit of ${usdOf(view?.limitUsd ?? error.limitUsd ?? 0)}. ${usdOf(view?.spentUsd ?? 0)} is spent so far.`,
        { details: { ...error.details(), scope: "confirmed_estimate", actionId: action, limitUsd: view?.limitUsd ?? error.limitUsd, spentUsd: view?.spentUsd ?? 0 } });
      }
    } else result = await turn(base.startedByDeviceId, input);
    context.log("info", result.text ? `Answer: ${result.text}` : "The turn ended without text.");
    // What this step hands on: the agent supplied no package of its own, so the minimal one is built from the step's
    // typed outputs and final text, and marked as such. It is one of the step's outputs — stored with them, shown
    // under "Hand-off" in the step's panel, and what a connected step receives.
    const handoff = wf.synthesiseHandoff({ runId, nodeId: context.node.id, path: context.path, text: result.text, outputs: { text: { type: "text", value: result.text } }, from: { nodeId: context.node.id, agentId: result.sessionKey, role: who.role ?? "", provider: who.ref?.providerId ?? "", model: who.ref?.modelId ?? (bound?.routed !== false ? bound?.model : undefined) ?? "" }, now: now() });
    return { outputs: { text: result.text, session: { sessionKey: result.sessionKey }, handoff } };
  }

  /** The outermost run a run belongs to (itself when it is no child). */
  function rootOf(runId: string): string {
    let id = runId;
    for (let depth = 0; depth < 12; depth++) { const parent = stored.get(id)?.originRef?.parentRunId; if (!parent) break; id = parent; }
    return id;
  }
  /** The gate's action a run spends under: its own (`run:<id>`), else that of the run it is a child of, however deep. */
  function actionOf(runId: string, gate: SpendGate): string | undefined {
    for (let id: string | undefined = runId, depth = 0; id && depth < 12; id = stored.get(id)?.originRef?.parentRunId, depth++) { const found = gate.covered(`run:${id}`); if (found) return found; }
    return undefined;
  }

  /** A sub-workflow step is a child run; a re-dispatch after a restart attaches to the child that is already there. */
  async function runChild(runId: string, context: wf.ExecutorContext): Promise<wf.ExecutorResult> {
    const base = stored.get(runId)!;
    const config = context.node.config as { workflowId?: string; revision?: "latest" | { pinned: number }; paramBindings?: Record<string, unknown> };
    const params: Record<string, unknown> = {};
    for (const [name, binding] of Object.entries(config.paramBindings ?? {})) {
      const value = binding && typeof binding === "object" && "input" in binding ? context.inputs[String((binding as { input: unknown }).input)] : wf.resolveValue(binding, context.scope);
      if (value !== undefined && value !== "") params[name] = value;
    }
    const open = (db.prepare("SELECT run_id, record, status FROM workflow_runs WHERE origin = 'subworkflow' AND deleted_ms IS NULL AND status NOT IN ('succeeded', 'failed', 'cancelled')").all() as Array<{ run_id: string; record: string }>)
      .find((row) => { const ref = JSON.parse(row.record) as Stored; return ref.originRef.parentRunId === runId && ref.originRef.parentNodeId === context.node.id && (ref.parentPath ?? "") === context.path; });
    const childId = open?.run_id ?? start({
      workflowId: String(config.workflowId ?? ""), params, origin: "subworkflow", originRef: { parentRunId: runId, parentNodeId: context.node.id }, startedByDeviceId: base.startedByDeviceId, attended: base.attended,
      // A child of a run that outside data started is such a run too: the mark goes down with it, however deep.
      ...(fromOutside(runId) ? { trigger: { source: engines.get(runId)!.state.trigger.source, payload: { untrusted: true } } } : {}),
      ...(config.revision && config.revision !== "latest" ? { revision: config.revision.pinned } : {}),
    }, context.path).id;
    context.log("info", `Child run ${childId}.`);
    const cancelChild = () => { try { cancel(childId, "parent"); } catch { /* it ended already */ } };
    context.signal.addEventListener("abort", cancelChild, { once: true });
    try {
      const child = await whenSettled(childId);
      if (child.status === "succeeded") return { outputs: { ...child.outputs, run: { runId: childId } } };
      throw failure(child.error?.code ?? "CANCELLED", child.error?.message ?? "The child run was cancelled.", { details: { runId: childId, ...(child.failedNodeId ? { failedNodeId: child.failedNodeId } : {}) } });
    } finally { context.signal.removeEventListener("abort", cancelChild); }
  }

  async function raise(runId: string, context: wf.ExecutorContext): Promise<wf.ExecutorResult> {
    const base = stored.get(runId)!;
    const config = context.node.config as { title?: string; body?: string; level?: "info" | "attention"; target?: string; link?: "run" | "project" | "none" };
    const target = config.target ?? "run_starter";
    deps.emit.notice(
      { runId, workflowId: base.workflowId, workflowName: base.workflowName, kind: "notify", title: context.render(String(config.title ?? "")).slice(0, 80) || base.workflowName, body: context.render(String(config.body ?? "")).slice(0, 500), level: config.level ?? "info", link: config.link ?? "run", nodeId: context.node.id, path: context.path },
      (deviceId, role) => (target === "run_starter" ? deviceId === base.startedByDeviceId : target === "admins" ? role === "admin" : true),
    );
    return { outputs: {} };
  }

  /** A `tool` step: the named step tool of the host does the work. Started on the next turn of the loop, so a run restored while the host starts finds every service in place. */
  async function runTool(runId: string, context: wf.ExecutorContext): Promise<wf.ExecutorResult> {
    await new Promise((resolve) => setImmediate(resolve));
    const base = stored.get(runId)!, name = String(context.node.config.tool ?? ""), tool = deps.stepTools?.()?.get(name);
    if (!tool) throw failure("UNAVAILABLE", `${context.node.name}: this host has no step tool "${name}".`);
    // A step tool makes its own turns: every session it names for a run that outside data started is tainted too.
    const source = fromOutside(runId);
    const marked = source ? { ...context, setSession: (sessionKey: string) => { deps.taint?.(sessionKey, source); context.setSession(sessionKey); } } : context;
    return tool(marked, { runId, number: engines.get(runId)?.state.number ?? 0, workflowName: base.workflowName, deviceId: base.startedByDeviceId });
  }

  // — lifecycle —

  function start(input: RunStart, parentPath?: string): WorkflowRunRecord {
    if (input.idempotencyKey) {
      const before = db.prepare("SELECT run_id FROM workflow_runs WHERE idempotency_key = ?").get(input.idempotencyKey) as { run_id: string } | undefined;
      if (before) return record(before.run_id);
    }
    const head = docs.get(input.workflowId);
    const found: WorkflowDocument | undefined = input.revision && input.revision !== head.revision ? docs.revision(input.workflowId, input.revision) : head;
    const doc = found && input.approvalOverride ? { ...found, settings: { ...found.settings, approvalOverride: { mode: input.approvalOverride } } } : found;
    if (!doc) throw new ProtocolError("NOT_FOUND", "That revision of the workflow is no longer kept.", { details: { workflowId: input.workflowId, revision: input.revision } });
    const validation = docs.validate(doc);
    if (!validation.valid || doc.meta.pendingPlan) {
      throw new ProtocolError("WORKFLOW_INVALID", validation.errors.length === 1 ? "Fix 1 problem to run" : `Fix ${validation.errors.length} problems to run`, { details: { problemCount: validation.errors.length, errors: validation.errors.slice(0, 5) } });
    }
    const sources = (doc.nodes.find((node) => node.type === "trigger")?.config.sources as Array<{ kind: string; enabled: boolean }> | undefined) ?? [];
    if (input.origin === "subworkflow" && !sources.some((source) => source.kind === "subworkflow" && source.enabled)) throw new ProtocolError("WORKFLOW_TRIGGER_DISABLED", `${doc.name} does not allow use as a sub-workflow.`, { details: { workflowId: doc.id, source: "subworkflow" } });
    let params: Record<string, unknown>;
    try { params = wf.resolveParams(doc, input.params ?? {}); } catch (error) { return wireError(error); }
    const runId = `run_${randomUUID().replaceAll("-", "").slice(0, 16)}`, created = now();
    const { number } = db.prepare("SELECT COALESCE(MAX(number), 0) + 1 AS number FROM workflow_runs").get() as { number: number };
    const base: Stored = { workflowId: doc.id, workflowName: doc.name, revision: doc.revision, graphHash: doc.graphHash, origin: input.origin, originRef: input.originRef ?? {}, startedByDeviceId: input.startedByDeviceId, attended: input.attended, created_ms: created, ...(parentPath !== undefined ? { parentPath } : {}) };
    const state = wf.newRunState({ runId, number, origin: input.origin, doc, params, ...(input.trigger ? { trigger: input.trigger } : {}), now: created });
    // A run beyond the running-run limit waits in start order; a child run shares its parent's slot.
    const queued = input.origin !== "subworkflow" && runningCount() >= MAX_RUNNING_RUNS;
    state.status = "queued";
    db.prepare("INSERT INTO workflow_runs (run_id, number, workflow_id, workflow_name, status, origin, record, state, created_ms, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(runId, number, doc.id, doc.name, "queued", input.origin, JSON.stringify(base), JSON.stringify(state), created, input.idempotencyKey ?? null);
    stored.set(runId, base);
    const engine = engineFor(runId, state);
    if (queued) commit(runId, state, [{ kind: "run.status", status: "queued" }]); else engine.start();
    return record(runId);
  }

  function whenSettled(runId: string): Promise<WorkflowRunRecord> {
    const current = record(runId);
    if (TERMINAL.has(current.status)) return Promise.resolve(current);
    return new Promise((resolve) => settled.set(runId, [...(settled.get(runId) ?? []), resolve]));
  }
  const children = (runId: string): string[] => [...stored.entries()].filter(([childId, ref]) => ref.originRef.parentRunId === runId && engines.has(childId)).map(([childId]) => childId);

  function cancel(runId: string, reason: string): WorkflowRunRecord {
    const engine = engineOf(runId);
    if (TERMINAL.has(engine.state.status)) { release(runId); throw new ProtocolError("CONFLICT", "This run has already ended.", { details: { runId, status: engine.state.status } }); }
    engine.cancel(reason);
    return record(runId);
  }

  function aggregates(state: wf.RunState): WorkflowNodeAggregate[] {
    const byNode = new Map<string, WorkflowExecution[]>();
    for (const exec of Object.values(state.executions)) byNode.set(exec.nodeId, [...(byNode.get(exec.nodeId) ?? []), exec]);
    return state.doc.nodes.map((node) => {
      const list = byNode.get(node.id) ?? [];
      // The worst status that is still open, otherwise the worst that ended; the latest execution stands for the node.
      const worst = list.reduce<WorkflowExecution | undefined>((found, exec) => (!found || RANK[exec.status] > RANK[found.status] ? exec : found), undefined);
      const latest = list.at(-1) ?? { nodeId: node.id, path: "", status: "pending" as const, attempt: 1, attempts: [] };
      const { inputs: _inputs, outputs: _outputs, request: _request, ...slim } = worst ?? latest;
      return { nodeId: node.id, status: worst?.status ?? "pending", ...(list.length === 1 && list[0].counts ? { counts: list[0].counts } : {}), latest: slim };
    });
  }

  return {
    start: (input: RunStart) => start(input),
    record, whenSettled,
    /** Every change of every run, for what follows runs from outside (automations). */
    listen(listener: (record: WorkflowRunRecord) => void): () => void { listeners.add(listener); return () => void listeners.delete(listener); },

    get(runId: string) {
      const row = live(runId);
      const state = engines.get(runId)?.state ?? (JSON.parse(row.state) as wf.RunState);
      const waiting = Object.values(state.executions).filter((exec) => exec.status === "waiting_approval");
      // What else needs a person: the steps a budget holds (with the refusal and its figures), and the sessions of the
      // steps — a tool permission one of them asks for is answered from the run view. A step that asked and ended its turn
      // (as an agent is told to) still has its question open, so the sessions of the steps that ended last are named too.
      const slim = ({ inputs: _inputs, outputs: _outputs, request: _request, ...rest }: WorkflowExecution) => rest;
      const held = Object.values(state.executions).filter((exec) => exec.status === "ready" && exec.blockedBy === "budget_exceeded").map(slim);
      const atWork = (exec: WorkflowExecution) => exec.status === "running" || exec.status === "waiting_approval";
      const withSession = Object.values(state.executions).filter((exec) => exec.sessionKey);
      // The history limit never hides a question: a session that still waits for an answer is named however long ago its step ended.
      const ended = withSession.filter((exec) => !atWork(exec)).sort((a, b) => (b.finished_ms ?? 0) - (a.finished_ms ?? 0));
      const asking = ended.length > ENDED_SESSIONS ? deps.pendingSessions?.() : undefined;
      const sessions = [...withSession.filter(atWork), ...ended.filter((exec, index) => index < ENDED_SESSIONS || asking?.has(exec.sessionKey!))]
        .map((exec) => ({ nodeId: exec.nodeId, path: exec.path, sessionKey: exec.sessionKey!, active: atWork(exec) }));
      return { run: recordOf(row, state), document: state.doc, nodes: aggregates(state), edges: state.edges, waiting, held, sessions, workflowExists: !!docs.find(row.workflow_id) };
    },
    list(filter: { workflowId?: string; status?: string; query?: string; limit?: number; includeChildren?: boolean } = {}): WorkflowRunRecord[] {
      const rows = db.prepare(`SELECT * FROM workflow_runs WHERE deleted_ms IS NULL ${filter.workflowId ? "AND workflow_id = ?" : ""} ORDER BY created_ms DESC, number DESC LIMIT 500`).all(...(filter.workflowId ? [filter.workflowId] : [])) as RunRow[];
      const needle = filter.query?.trim().toLowerCase();
      return rows.map((row) => recordOf(row, engines.get(row.run_id)?.state ?? (JSON.parse(row.state) as wf.RunState)))
        .filter((run) => (filter.includeChildren || run.origin !== "subworkflow") && (!filter.status || run.status === filter.status) && (!needle || `${run.workflowName} #${run.number} ${JSON.stringify(run.params)}`.toLowerCase().includes(needle)))
        .slice(0, Math.min(filter.limit ?? 50, 200));
    },
    executions(runId: string, filter: { nodeId?: string; limit?: number } = {}): WorkflowExecution[] {
      const row = live(runId);
      const state = engines.get(runId)?.state ?? (JSON.parse(row.state) as wf.RunState);
      return Object.values(state.executions).filter((exec) => !filter.nodeId || exec.nodeId === filter.nodeId).slice(0, Math.min(filter.limit ?? 100, 500));
    },
    timeline(runId: string, afterSeq = 0, limit = 500): { entries: WorkflowTimelineEntry[]; nextSeq?: number } {
      live(runId);
      const rows = db.prepare("SELECT seq, ts_ms, json FROM workflow_run_timeline WHERE run_id = ? AND seq > ? ORDER BY seq LIMIT ?").all(runId, afterSeq, Math.min(Math.max(limit, 1), 2000) + 1) as Array<{ seq: number; ts_ms: number; json: string }>;
      const page = rows.slice(0, Math.min(Math.max(limit, 1), 2000));
      return { entries: page.map((row) => ({ seq: row.seq, ts_ms: row.ts_ms, change: JSON.parse(row.json) })), ...(rows.length > page.length ? { nextSeq: page.at(-1)!.seq } : {}) };
    },
    logs(runId: string, filter: { nodeId?: string; path?: string; afterSeq?: number; level?: string } = {}): WorkflowLogEntry[] {
      live(runId);
      const rows = db.prepare("SELECT seq, ts_ms, node_id, path, level, source, message FROM workflow_run_logs WHERE run_id = ? AND seq > ? ORDER BY seq LIMIT 2000").all(runId, filter.afterSeq ?? 0) as Array<{ seq: number; ts_ms: number; node_id: string; path: string; level: string; source: string; message: string }>;
      return rows.filter((row) => (!filter.nodeId || row.node_id === filter.nodeId) && (filter.path === undefined || row.path === filter.path) && (!filter.level || row.level === filter.level))
        .map((row) => ({ seq: row.seq, ts_ms: row.ts_ms, nodeId: row.node_id, path: row.path, level: row.level as WorkflowLogEntry["level"], source: row.source as WorkflowLogEntry["source"], message: row.message }));
    },

    pause(runId: string, deviceId: string): WorkflowRunRecord {
      const engine = engineOf(runId);
      if (engine.state.status !== "running") { release(runId); throw new ProtocolError("CONFLICT", "Only a running run can be paused.", { details: { runId, status: engine.state.status } }); }
      engine.pause();
      userAction(runId, "pause", deviceId);
      for (const childId of children(runId)) engines.get(childId)?.pause();
      return record(runId);
    },
    resume(runId: string, deviceId: string): WorkflowRunRecord {
      const engine = engineOf(runId);
      if (engine.state.status !== "paused" && engine.state.status !== "cancelled") { release(runId); throw new ProtocolError("CONFLICT", "This run is not paused.", { details: { runId, status: engine.state.status } }); }
      userAction(runId, "resume", deviceId);
      if (engine.state.status === "paused") { engine.resume(); for (const childId of children(runId)) engines.get(childId)?.resume(); } else engine.resumeCancelled();
      return record(runId);
    },
    cancel(runId: string, reason: string, deviceId?: string): WorkflowRunRecord {
      const cancelled = cancel(runId, reason);
      if (deviceId) userAction(runId, "cancel", deviceId);
      return cancelled;
    },
    remove(runId: string): void {
      const row = live(runId);
      if (!TERMINAL.has(engines.get(runId)?.state.status ?? row.status)) throw new ProtocolError("CONFLICT", "Cancel the run before deleting it.", { details: { runId, status: row.status } });
      engines.delete(runId);
      db.prepare("UPDATE workflow_runs SET deleted_ms = ? WHERE run_id = ?").run(now(), runId);
    },
    /** A step action of a person: retry, skip or cancel one execution. */
    node(runId: string, action: "retry" | "skip" | "cancel", nodeId: string, path: string, deviceId: string): WorkflowRunRecord {
      const engine = engineOf(runId);
      try {
        if (action === "retry") engine.retry(nodeId, path); else if (action === "skip") engine.skip(nodeId, path); else engine.cancelNode(nodeId, path);
        userAction(runId, action === "cancel" ? "cancel step" : action, deviceId, nodeId);
      } catch (error) { release(runId); return wireError(error); }
      release(runId);
      return record(runId);
    },
    /** "Run again": a step that ended runs again with the person's notes, or takes the result they edited; what follows it is done again. */
    rerun(runId: string, nodeId: string, edit: { outputs?: Record<string, unknown>; notes?: unknown }, deviceId: string): WorkflowRunRecord {
      const engine = engineOf(runId);
      try { engine.rerun(nodeId, edit); userAction(runId, edit.outputs ? "edit result" : "run again", deviceId, nodeId); } catch (error) { release(runId); return wireError(error); }
      return record(runId);
    },
    /** A person's answer to an approval or a form. The first answer wins; the device must be one the step is assigned to. */
    resolve(runId: string, input: { nodeId: string; path: string; outcome?: "approved" | "rejected" | "changes_requested"; subject?: unknown; notes?: string; values?: Record<string, unknown> }, connection: Pick<Connection, "deviceId" | "role">): WorkflowRunRecord {
      const engine = engineOf(runId);
      const exec = engine.exec(input.nodeId, input.path), role = connection.role();
      const assignee = String((exec?.request as { assignee?: string } | undefined)?.assignee ?? "any_editor");
      if (exec?.status === "waiting_approval" && (!role || !mayAnswer(assignee, record(runId), connection.deviceId, role))) {
        throw new ProtocolError("SCOPE_DENIED", assignee === "admins" ? "Only an admin device can answer this step." : assignee === "run_starter" ? "Only the device that started the run can answer this step." : "Your role on this host does not allow this", { details: { assignee } });
      }
      try { engine.resolve(input.nodeId, input.path, { ...input, by: { deviceId: connection.deviceId, deviceName: deps.devices.get(connection.deviceId)?.name ?? "" } }); } catch (error) { release(runId); return wireError(error); }
      userAction(runId, input.values ? "submit form" : input.outcome ?? "approved", connection.deviceId, input.nodeId);
      return record(runId);
    },

    /** The clock: timed waits, retries, time limits, and runs whose device was revoked. */
    tick(): void {
      for (const [runId, engine] of [...engines.entries()]) {
        const base = stored.get(runId);
        if (!base || TERMINAL.has(engine.state.status)) continue;
        if (deps.devices.get(base.startedByDeviceId)?.state === "revoked") { engine.cancel("device_revoked"); continue; }
        if (ACTIVE.has(engine.state.status) && engine.state.started_ms && now() - engine.state.started_ms > engine.state.doc.settings.runTimeout_s * 1000) { engine.cancel("timeout"); continue; }
        engine.tick();
      }
      startQueued();
    },
    /** After a start of the host: every run that had not ended is restored from its checkpoint. */
    recover(): number {
      const rows = db.prepare("SELECT * FROM workflow_runs WHERE deleted_ms IS NULL AND status IN ('queued', 'running', 'paused', 'waiting_approval') ORDER BY number").all() as RunRow[];
      for (const row of rows) { stored.set(row.run_id, JSON.parse(row.record) as Stored); engineFor(row.run_id, JSON.parse(row.state) as wf.RunState); }
      // Parents after their children are in place: a re-dispatched sub-workflow step attaches to its child.
      for (const row of rows) engines.get(row.run_id)?.recover();
      startQueued();
      return rows.length;
    },
    /** Runs that need a person, for the navigation badge. */
    attention(): number {
      return [...engines.values()].filter((engine) => Object.values(engine.state.executions).some((exec) => exec.status === "waiting_approval")).length;
    },
    turn,
    /** The services that hold money, once the host has them (later calls add to or replace what was bound). */
    bindSpend(port: TurnMoney): void { spendPort = { ...spendPort, ...port }; },
    close(): void { engines.clear(); },
  };
}
export type WorkflowRuns = ReturnType<typeof createWorkflowRuns>;
