import { WORKFLOW_LIMITS, type WorkflowCondition, type WorkflowDocument, type WorkflowEdge, type WorkflowEdgeState, type WorkflowExecution, type WorkflowNode, type WorkflowRunChange, type WorkflowRunError, type WorkflowRunStatus } from "@jagentchill/protocol";
import { evaluateCondition, renderTemplate, resolveValue, type Scope } from "./expr.ts";
import { analyse, parsePath, pathText, type Frame, type GraphInfo } from "./graph.ts";
import { WorkflowError, dataPort } from "./nodes.ts";

/** Everything a run is: the snapshot it executes and the state of every execution. Plain JSON, stored as the run's checkpoint. */
export type RunState = {
  runId: string; number: number; origin: string; doc: WorkflowDocument; params: Record<string, unknown>;
  trigger: { source: string; payload: unknown; fired_ms: number };
  status: WorkflowRunStatus; pauseReason?: string; cancelReason?: string; error?: WorkflowRunError; failedNodeId?: string;
  executions: Record<string, WorkflowExecution>; vars: Record<string, unknown>; edges: Record<string, WorkflowEdgeState>;
  started_ms?: number; finished_ms?: number; reopenedCount: number; notifyCount: number; outputs?: Record<string, unknown>;
  /** A failure with `onError: "fail"` whose run has not ended yet (steps still running, or the run paused): part of the checkpoint, so a restart of the host does not forget it. */
  pendingFailure?: { nodeId: string; error: WorkflowRunError };
  /** Per loop or parallel execution: the value of each iteration, or the bookkeeping of the fan-out. */
  frames: Record<string, { values?: Record<number, unknown>; nextItem?: number }>;
};
export type ExecutorContext = {
  runId: string; node: WorkflowNode; path: string; attempt: number; inputs: Record<string, unknown>; scope: Scope; signal: AbortSignal;
  render(template: string): string; log(level: "info" | "warn" | "error", message: string): void; setSession(sessionKey: string): void;
};
export type ExecutorResult = { outputs?: Record<string, unknown>; fired?: string[] };
/** What executes a node the engine does not execute itself: an agent turn, a child run, a notification. */
export type NodeExecutor = (context: ExecutorContext) => Promise<ExecutorResult>;
export type EngineHooks = {
  now(): number;
  executors: Partial<Record<WorkflowNode["type"], NodeExecutor>>;
  /** Called after every state change, before anything is announced: the checkpoint. */
  commit(state: RunState, changes: WorkflowRunChange[]): void;
  log?(entry: { nodeId: string; path: string; level: "info" | "warn" | "error"; source: "engine" | "executor"; message: string }): void;
  /** Whether a node that needs the agent engine can start now. */
  gatewayReady?(): boolean;
  /** Whether a person follows this run (false or absent: nobody is there to answer, so a budget stop fails the step). */
  attended?(): boolean;
};
const TERMINAL = new Set(["succeeded", "failed", "skipped", "cancelled"]);
const RUN_TERMINAL = new Set(["succeeded", "failed", "cancelled"]);
const RETRY_DELAYS_MS = [5000, 30_000];
const DEFAULT_TIMEOUT_S: Partial<Record<WorkflowNode["type"], number>> = { agent: 600 };
/** Nodes whose execution is a call outside the engine and holds a running-node slot. */
const EXTERNAL: ReadonlySet<string> = new Set(["agent", "subworkflow", "notify", "tool"]);
const BUDGET_HOLD = "budget_exceeded";
/**
 * The refusal of a step by a budget: a hard-stop budget of any scope (global, provider, project, session, automation —
 * `details.scope`), or the confirmed-estimate guard (120 % of the estimate the starter confirmed, scope `confirmed_estimate`).
 */
const isBudgetStop = (error: WorkflowRunError): boolean => error.code === "BUDGET_EXCEEDED";
export const execKey = (nodeId: string, path: string): string => `${nodeId}@${path}`;
export const toRunError = (error: unknown): WorkflowRunError => {
  const record = error as { code?: unknown; message?: unknown; retryable?: unknown; details?: unknown } | undefined;
  return { code: typeof record?.code === "string" ? record.code : "INTERNAL", class: "engine", message: typeof record?.message === "string" ? record.message : String(error), ...(record?.retryable === true ? { retryable: true } : {}), ...(record?.details && typeof record.details === "object" ? { details: record.details as Record<string, unknown> } : {}) };
};

/** Checks run parameters against the workflow's declarations and fills the defaults. */
export function resolveParams(doc: Pick<WorkflowDocument, "parameters">, supplied: Record<string, unknown>): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const param of doc.parameters) {
    const value = supplied[param.name] ?? param.default;
    if (value === undefined || value === null || value === "") {
      if (param.required) throw new WorkflowError("WORKFLOW_INPUT_INVALID", `${param.label} is required.`, { param: param.name });
      continue;
    }
    if (param.enum && !param.enum.includes(value as string)) throw new WorkflowError("WORKFLOW_INPUT_INVALID", `${param.label} must be one of: ${param.enum.join(", ")}.`, { param: param.name, allowed: param.enum });
    if ((param.type === "number" || param.type === "integer") && (typeof value !== "number" || (param.type === "integer" && !Number.isInteger(value)) || (param.min !== undefined && value < param.min) || (param.max !== undefined && value > param.max))) {
      throw new WorkflowError("WORKFLOW_INPUT_INVALID", `${param.label} must be a number${param.min !== undefined || param.max !== undefined ? ` between ${param.min ?? "−∞"} and ${param.max ?? "∞"}` : ""}.`, { param: param.name });
    }
    if ((param.type === "string" || param.type === "text") && (typeof value !== "string" || (param.maxLength !== undefined && value.length > param.maxLength))) throw new WorkflowError("WORKFLOW_INPUT_INVALID", `${param.label} must be text${param.maxLength ? ` of at most ${param.maxLength} characters` : ""}.`, { param: param.name });
    if (param.type === "boolean" && typeof value !== "boolean") throw new WorkflowError("WORKFLOW_INPUT_INVALID", `${param.label} must be on or off.`, { param: param.name });
    params[param.name] = value;
  }
  return params;
}

export function newRunState(input: { runId: string; number: number; origin: string; doc: WorkflowDocument; params: Record<string, unknown>; trigger?: { source: string; payload: unknown }; now: number }): RunState {
  const vars: Record<string, unknown> = {};
  for (const variable of input.doc.variables) vars[variable.name] = variable.initial ?? (variable.mode === "append" ? [] : null);
  return {
    runId: input.runId, number: input.number, origin: input.origin, doc: input.doc, params: input.params, trigger: { source: input.trigger?.source ?? "manual", payload: input.trigger?.payload ?? null, fired_ms: input.now },
    status: "draft", executions: {}, vars, edges: {}, reopenedCount: 0, notifyCount: 0, frames: {},
  };
}

/**
 * The run engine of one run: a state machine over node executions. It is driven by state changes (`pump`) and by the
 * clock (`tick`); it calls executors for the work that is not its own and never blocks on them.
 */
export class RunEngine {
  readonly state: RunState;
  private readonly hooks: EngineHooks;
  private readonly graph: GraphInfo;
  private readonly nodes: Map<string, WorkflowNode>;
  private readonly aborts = new Map<string, AbortController>();
  private changes: WorkflowRunChange[] = [];
  private pumping = false;
  private again = false;
  /** Set while a failure with `onError: "fail"` lets running nodes finish. Kept in the state: it survives a restart. */
  private get failing(): { nodeId: string; error: WorkflowRunError } | undefined { return this.state.pendingFailure; }
  private set failing(value: { nodeId: string; error: WorkflowRunError } | undefined) { if (value) this.state.pendingFailure = value; else delete this.state.pendingFailure; }

  constructor(state: RunState, hooks: EngineHooks) {
    this.state = state;
    this.hooks = hooks;
    this.graph = analyse(state.doc);
    this.nodes = new Map(state.doc.nodes.map((node) => [node.id, node]));
  }

  // — queries —
  exec(nodeId: string, path: string): WorkflowExecution | undefined { return this.state.executions[execKey(nodeId, path)]; }
  private all(): WorkflowExecution[] { return Object.values(this.state.executions); }
  private under(prefix: string): WorkflowExecution[] { return this.all().filter((exec) => exec.path === prefix || exec.path.startsWith(`${prefix}/`)); }
  private chainOf(nodeId: string) { return this.graph.chain.get(nodeId) ?? []; }

  // — mutation helpers —
  private set(exec: WorkflowExecution, patch: Partial<WorkflowExecution>): void {
    const from = exec.status;
    Object.assign(exec, patch);
    for (const key of Object.keys(patch) as Array<keyof WorkflowExecution>) if (patch[key] === undefined) delete exec[key];
    if (patch.status && TERMINAL.has(patch.status)) exec.finished_ms = this.hooks.now();
    this.changes.push({
      kind: "node.status", nodeId: exec.nodeId, path: exec.path, status: exec.status, attempt: exec.attempt, blockedBy: exec.blockedBy, retryPending: exec.retryPending, waitingReason: exec.waitingReason,
      waitingUntil_ms: exec.waitingUntil_ms, reason: exec.reason, error: exec.error, counts: exec.counts, started_ms: exec.started_ms, finished_ms: exec.finished_ms, handled: exec.handled,
    });
    if (patch.status && patch.status !== from) this.edgesOf(exec);
  }
  private edge(edgeId: string, state: WorkflowEdgeState): void {
    if (this.state.edges[edgeId] === state) return;
    this.state.edges[edgeId] = state;
    this.changes.push({ kind: "edge.state", edgeId, state });
  }
  private edgesOf(exec: WorkflowExecution): void {
    for (const edge of this.state.doc.edges) {
      if (edge.from.node === exec.nodeId && exec.status === "succeeded" && (edge.kind !== "control" || (exec.fired ?? ["done"]).includes(edge.from.port)) && edge.kind !== "error") this.edge(edge.id, "flowing");
      if (edge.from.node === exec.nodeId && exec.status === "failed" && edge.kind === "error" && exec.handled) this.edge(edge.id, "error");
      if (edge.from.node === exec.nodeId && exec.status === "skipped") this.edge(edge.id, "skipped");
      if (edge.to.node !== exec.nodeId || edge.kind === "error") continue;
      if (exec.status === "succeeded" && this.state.edges[edge.id] === "flowing") this.edge(edge.id, "delivered");
      if (exec.status === "failed" && this.state.edges[edge.id] === "flowing") this.edge(edge.id, "error");
      if (exec.status === "skipped") this.edge(edge.id, "skipped");
    }
  }
  private log(exec: Pick<WorkflowExecution, "nodeId" | "path">, level: "info" | "warn" | "error", message: string, source: "engine" | "executor" = "engine"): void {
    this.hooks.log?.({ nodeId: exec.nodeId, path: exec.path, level, source, message });
    if (level !== "info") this.changes.push({ kind: "log.marker", nodeId: exec.nodeId, path: exec.path, level, message });
  }
  private runStatus(status: WorkflowRunStatus, extra: Partial<Pick<RunState, "pauseReason" | "cancelReason" | "error" | "failedNodeId">> = {}): void {
    if (this.state.status === status && !Object.keys(extra).length) return;
    this.state.status = status;
    delete this.state.pauseReason;
    Object.assign(this.state, extra);
    if (RUN_TERMINAL.has(status)) { this.state.finished_ms = this.hooks.now(); delete this.state.pendingFailure; } else delete this.state.finished_ms;
    this.changes.push({ kind: "run.status", status, ...(this.state.pauseReason ? { pauseReason: this.state.pauseReason } : {}), ...(this.state.cancelReason && status === "cancelled" ? { cancelReason: this.state.cancelReason } : {}), ...(status === "failed" && this.state.error ? { error: this.state.error, failedNodeId: this.state.failedNodeId } : {}) });
  }
  private flush(): void {
    if (!this.changes.length) return;
    const changes = this.changes;
    this.changes = [];
    this.hooks.commit(this.state, changes);
  }
  private create(node: WorkflowNode, path: string): void {
    const key = execKey(node.id, path);
    if (this.state.executions[key]) return;
    if (Object.keys(this.state.executions).length >= WORKFLOW_LIMITS.nodeExecutions) throw new WorkflowError("WORKFLOW_LIMIT_EXCEEDED", "A run executes at most 20,000 steps.", { limit: "nodeExecutions", max: WORKFLOW_LIMITS.nodeExecutions });
    const exec: WorkflowExecution = { nodeId: node.id, path, status: "pending", attempt: 1, attempts: [] };
    this.state.executions[key] = exec;
    if (node.disabled) this.set(exec, { status: "skipped", reason: "disabled" });
  }
  /** Creates the executions of the direct members of a body for one frame. */
  private instantiate(ownerId: string, path: string): void {
    const depth = this.chainOf(ownerId).length + 1;
    for (const node of this.state.doc.nodes) {
      const chain = this.chainOf(node.id);
      if (chain.length === depth && chain[depth - 1].id === ownerId) this.create(node, path);
    }
  }

  // — lifecycle —
  start(): void {
    if (this.state.status !== "draft" && this.state.status !== "queued") return;
    this.state.started_ms ??= this.hooks.now();
    for (const node of this.state.doc.nodes) if (!this.chainOf(node.id).length) this.create(node, "");
    this.runStatus("running");
    this.pump();
  }
  /** After a restart: an execution that was running is interrupted and dispatched once more; a second interruption fails it. */
  recover(): void {
    for (const exec of this.all()) {
      const node = this.nodes.get(exec.nodeId);
      if (exec.status !== "running" || !node || !EXTERNAL.has(node.type)) continue;
      const interrupted = exec.attempts.filter((attempt) => attempt.outcome === "interrupted").length;
      exec.attempts.push({ attempt: exec.attempt, outcome: "interrupted", started_ms: exec.started_ms ?? this.hooks.now(), ended_ms: this.hooks.now() });
      if (interrupted >= 1) this.failExec(exec, { code: "UNAVAILABLE", class: "engine", message: "The step was interrupted twice by a restart of the host." });
      else { this.set(exec, { status: "ready", attempt: exec.attempt + 1, started_ms: undefined }); this.log(exec, "warn", "Interrupted by a restart of the host; starting again."); }
    }
    this.pump();
  }
  pause(): void { if (this.state.status === "running") { this.runStatus("paused", { pauseReason: "user" }); this.flush(); } }
  resume(): void {
    if (this.state.status !== "paused") return;
    // A step held for money is dispatched again: the amount was confirmed or raised, or it is held once more.
    for (const exec of this.all()) if (exec.status === "ready" && exec.blockedBy === BUDGET_HOLD) this.set(exec, { blockedBy: undefined, error: undefined });
    this.runStatus("running");
    this.pump();
  }
  /**
   * A budget reached by a run a person follows (a hard-stop budget, or the confirmed-estimate guard): the step is not
   * failed, it goes back to `ready` (`blockedBy: "budget_exceeded"`, with the refusal and its figures), running steps
   * finish, and the run is paused until the person raised the budget or accepted the new estimate (`resume`), or cancels.
   */
  private holdForBudget(exec: WorkflowExecution, error: WorkflowRunError): void {
    this.log(exec, "warn", `${error.code}: ${error.message}`);
    this.set(exec, { status: "ready", blockedBy: BUDGET_HOLD, error, started_ms: undefined, retryPending: undefined, notBefore_ms: undefined });
    if (this.state.status === "running" || this.state.status === "waiting_approval") this.runStatus("paused", { pauseReason: BUDGET_HOLD });
  }
  cancel(reason: string): void {
    if (RUN_TERMINAL.has(this.state.status)) return;
    for (const controller of this.aborts.values()) controller.abort();
    for (const exec of this.all()) if (!TERMINAL.has(exec.status)) { if (exec.status === "running" || exec.status === "waiting_approval") exec.attempts.push({ attempt: exec.attempt, outcome: "cancelled", started_ms: exec.started_ms ?? this.hooks.now(), ended_ms: this.hooks.now() }); this.set(exec, { status: "cancelled", blockedBy: undefined, retryPending: undefined, waitingReason: undefined, waitingUntil_ms: undefined, request: undefined }); }
    this.runStatus("cancelled", { cancelReason: reason });
    this.flush();
  }
  /** "Resume from here": only cancelled executions run again. */
  resumeCancelled(): void {
    if (this.state.status !== "cancelled") return;
    for (const exec of this.all()) if (exec.status === "cancelled") this.set(exec, { status: "pending", finished_ms: undefined });
    this.reopen();
  }
  private reopen(): void {
    this.failing = undefined;
    delete this.state.error; delete this.state.failedNodeId; delete this.state.cancelReason;
    if (RUN_TERMINAL.has(this.state.status)) this.state.reopenedCount += 1;
    this.runStatus("running");
    this.pump();
  }
  /** Cancels one step: its `onError` decides what the cancellation means. */
  cancelNode(nodeId: string, path: string): void {
    const exec = this.exec(nodeId, path), node = this.nodes.get(nodeId);
    if (!exec || !node || !["running", "ready", "waiting_approval"].includes(exec.status)) throw new WorkflowError("WORKFLOW_NODE_NOT_ACTIVE", "This step is not running.", { nodeId, path });
    this.aborts.get(execKey(nodeId, path))?.abort();
    this.aborts.delete(execKey(nodeId, path));
    this.failExec(exec, { code: "CANCELLED", class: "engine", message: "The step was cancelled." }, true);
    this.pump();
  }
  /** Manual "Retry": a failed step becomes ready again with a new attempt chain. */
  retry(nodeId: string, path: string): void {
    const exec = this.exec(nodeId, path);
    if (!exec || exec.status !== "failed") throw new WorkflowError("WORKFLOW_NODE_NOT_ACTIVE", "Only a failed step can be retried.", { nodeId, path });
    this.set(exec, { status: "ready", attempt: exec.attempt + 1, error: undefined, handled: undefined, finished_ms: undefined, started_ms: undefined });
    // Steps the failure skipped or left behind are evaluated again.
    this.reviveAfter(exec);
    this.reopen();
  }
  /** Manual "Skip": a failed or waiting step is skipped and its dependants follow by propagation. */
  skip(nodeId: string, path: string): void {
    const exec = this.exec(nodeId, path);
    if (!exec || !["failed", "waiting_approval", "ready"].includes(exec.status)) throw new WorkflowError("WORKFLOW_NODE_NOT_ACTIVE", "This step cannot be skipped now.", { nodeId, path });
    this.set(exec, { status: "skipped", reason: "user_skipped", error: undefined, waitingReason: undefined, request: undefined });
    this.reviveAfter(exec);
    if (this.state.status === "failed" || this.state.status === "waiting_approval") this.reopen(); else this.pump();
  }
  /**
   * "Run again from here": a top-level step that ended runs again (with `notes` for it under `vars.__notes[nodeId]`), or
   * takes `outputs` a person edited as its result without running. Everything downstream of it is evaluated again.
   */
  rerun(nodeId: string, edit: { outputs?: Record<string, unknown>; notes?: unknown } = {}): void {
    const exec = this.exec(nodeId, ""), node = this.nodes.get(nodeId);
    if (!exec || !node || node.type === "trigger" || this.chainOf(nodeId).length || !TERMINAL.has(exec.status)) throw new WorkflowError("WORKFLOW_NODE_NOT_ACTIVE", "Only a step that has ended can run again.", { nodeId });
    const cleared = { error: undefined, handled: undefined, reason: undefined, finished_ms: undefined, waitingReason: undefined, waitingUntil_ms: undefined, request: undefined, blockedBy: undefined, retryPending: undefined, notBefore_ms: undefined };
    const seen = new Set<string>(), queue = [nodeId];
    while (queue.length) for (const edge of this.graph.out.get(queue.pop()!) ?? []) if (!seen.has(edge.to.node)) { seen.add(edge.to.node); queue.push(edge.to.node); }
    for (const other of this.all()) {
      if (!seen.has(other.nodeId) || other.reason === "disabled") continue;
      const key = execKey(other.nodeId, other.path);
      this.aborts.get(key)?.abort();
      this.aborts.delete(key);
      // The instances of a body are made again by their owner.
      if (other.path) { delete this.state.executions[key]; delete this.state.frames[key]; continue; }
      delete other.outputs; delete other.inputs; delete other.fired;
      delete this.state.frames[key];
      this.set(other, { ...cleared, status: "pending", attempt: other.attempt + (other.status === "pending" ? 0 : 1), started_ms: undefined });
    }
    if (edit.outputs) {
      exec.outputs = { ...exec.outputs, ...edit.outputs };
      exec.fired = ["done"];
      this.log(exec, "info", "Edited by a person.");
      this.set(exec, { ...cleared, status: "succeeded" });
    } else {
      this.state.vars.__notes = { ...(this.state.vars.__notes as Record<string, unknown> | undefined), [nodeId]: edit.notes ?? null };
      delete exec.outputs; delete exec.fired;
      this.set(exec, { ...cleared, status: "pending", attempt: exec.attempt + 1, started_ms: undefined });
    }
    if (this.state.status === "paused") this.flush(); else this.reopen();
  }
  private reviveAfter(exec: WorkflowExecution): void {
    const seen = new Set<string>(), queue = [exec.nodeId];
    while (queue.length) for (const edge of this.graph.out.get(queue.pop()!) ?? []) if (!seen.has(edge.to.node)) { seen.add(edge.to.node); queue.push(edge.to.node); }
    for (const other of this.all()) if (seen.has(other.nodeId) && (other.status === "skipped" || other.status === "cancelled") && other.reason !== "disabled" && other.reason !== "user_skipped") this.set(other, { status: "pending", reason: undefined, finished_ms: undefined });
  }
  /** A person's answer to a waiting step: an approval decision or a submitted form. */
  resolve(nodeId: string, path: string, answer: { outcome?: "approved" | "rejected" | "changes_requested"; subject?: unknown; notes?: string; values?: Record<string, unknown>; by: { deviceId: string; deviceName?: string } }): void {
    const exec = this.exec(nodeId, path), node = this.nodes.get(nodeId);
    if (!exec || !node) throw new WorkflowError("NOT_FOUND", "There is no such step in this run.", { nodeId, path });
    if (exec.status !== "waiting_approval") throw new WorkflowError("CONFLICT", "This step was already answered.", { nodeId, path, status: exec.status });
    const now = this.hooks.now();
    if (node.type === "approval") {
      const outcome = answer.outcome ?? "approved";
      const connected = (port: string) => this.state.doc.edges.some((edge) => edge.from.node === nodeId && edge.from.port === port);
      if (outcome === "changes_requested" && !answer.notes?.trim()) throw new WorkflowError("INVALID_PARAMS", "Say what should change.", { field: "notes" });
      const decision = { outcome, by: { kind: "device", deviceId: answer.by.deviceId }, notes: answer.notes ?? "", round: 1, decided_ms: now };
      const subject = node.config.allowEdit !== false && answer.subject !== undefined ? answer.subject : exec.inputs?.subject;
      if (outcome === "rejected" && !connected("rejected")) {
        exec.outputs = { subject, decision };
        this.set(exec, { waitingReason: undefined, request: undefined });
        this.failExec(exec, { code: "WORKFLOW_REJECTED", class: "engine", message: `${node.name} was rejected${answer.notes ? `: ${answer.notes}` : "."}` });
      } else this.succeed(exec, { outputs: { subject, decision }, fired: ["done", outcome] });
    } else if (node.type === "human_input") {
      const fields = (node.config.fields as Array<{ id: string; label: string; type: string; required?: boolean; options?: string[]; min?: number; max?: number; maxLength?: number }>) ?? [];
      const values: Record<string, unknown> = {}, problems: Record<string, string> = {};
      for (const field of fields) {
        const value = answer.values?.[field.id];
        const empty = value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length);
        if (empty) { if (field.required) problems[field.id] = `${field.label} is required`; continue; }
        if (field.type === "number" && (typeof value !== "number" || (field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max))) problems[field.id] = `${field.label} must be a number${field.min !== undefined || field.max !== undefined ? ` between ${field.min ?? "−∞"} and ${field.max ?? "∞"}` : ""}`;
        else if (field.type === "boolean" && typeof value !== "boolean") problems[field.id] = `${field.label} must be on or off`;
        else if ((field.type === "text" || field.type === "long_text" || field.type === "date") && (typeof value !== "string" || value.length > (field.maxLength ?? 8000))) problems[field.id] = `${field.label} is too long`;
        else if (field.type === "select" && !(field.options ?? []).includes(value as string)) problems[field.id] = `${field.label} must be one of the options`;
        else if (field.type === "multi_select" && !(Array.isArray(value) && value.every((entry) => (field.options ?? []).includes(entry)))) problems[field.id] = `${field.label} must be chosen from the options`;
        else values[field.id] = value;
      }
      if (Object.keys(problems).length) throw new WorkflowError("INVALID_PARAMS", Object.values(problems)[0], { fields: problems });
      this.succeed(exec, { outputs: { response: { values, by: { deviceId: answer.by.deviceId, deviceName: answer.by.deviceName ?? "" }, submitted_ms: now }, ...values } });
    } else throw new WorkflowError("CONFLICT", "This step does not wait for an answer.", { nodeId });
    if (this.state.status === "waiting_approval") this.runStatus("running");
    this.pump();
  }

  /** The clock: timed waits, retry delays and time limits. */
  tick(): void {
    if (this.state.status !== "running" && this.state.status !== "waiting_approval") return;
    const now = this.hooks.now();
    let due = false;
    for (const exec of this.all()) {
      const node = this.nodes.get(exec.nodeId)!;
      if (exec.status === "running" && exec.waitingUntil_ms !== undefined && exec.waitingUntil_ms <= now) { this.succeed(exec, { outputs: { ...exec.inputs } }); due = true; }
      else if (exec.status === "ready" && exec.notBefore_ms !== undefined && exec.notBefore_ms <= now) due = true;
      else if (exec.status === "ready" && exec.blockedBy === "waiting_gateway") due = true;
      else if (exec.status === "running" && EXTERNAL.has(node.type) && exec.started_ms !== undefined) {
        const limit = node.timeout_s ?? DEFAULT_TIMEOUT_S[node.type];
        if (limit !== undefined && now - exec.started_ms >= limit * 1000) {
          this.aborts.get(execKey(exec.nodeId, exec.path))?.abort();
          this.aborts.delete(execKey(exec.nodeId, exec.path));
          this.failExec(exec, { code: node.type === "agent" ? "WORKFLOW_AGENT_TIMEOUT" : "TIMEOUT", class: "timeout", message: `${node.name} did not finish within ${limit} s.` });
          due = true;
        }
      } else if (exec.status === "waiting_approval" && node.type === "human_input" && node.timeout_s !== undefined && exec.started_ms !== undefined && now - exec.started_ms >= node.timeout_s * 1000) {
        const defaults: Record<string, unknown> = {};
        for (const field of (node.config.fields as Array<{ id: string; default?: unknown }>) ?? []) if (field.default !== undefined) defaults[field.id] = field.default;
        this.succeed(exec, { outputs: defaults, fired: ["timed_out"] });
        due = true;
      }
    }
    if (due) this.pump(); else this.flush();
  }

  // — the scheduler —
  pump(): void {
    if (this.pumping) { this.again = true; return; }
    this.pumping = true;
    try {
      do {
        this.again = false;
        let progressed = true;
        while (progressed && (this.state.status === "running" || this.state.status === "waiting_approval")) {
          progressed = false;
          for (const exec of this.all()) if (exec.status === "pending" && this.evaluate(exec)) progressed = true;
          for (const exec of this.all()) if (exec.status === "running" && this.advanceOwner(exec)) progressed = true;
          if (this.dispatch()) progressed = true;
        }
        this.settleRun();
        this.flush();
      } while (this.again);
    } catch (error) {
      // A limit of the run itself (20,000 executions) ends it.
      for (const controller of this.aborts.values()) controller.abort();
      this.runStatus("failed", { error: toRunError(error) });
      this.flush();
    } finally { this.pumping = false; }
  }

  /** The execution of the node an edge comes from, seen from a consumer at `path`. */
  private source(edge: WorkflowEdge, path: string): { exec?: WorkflowExecution; available: boolean; value?: unknown } {
    const frames = parsePath(path), chain = this.chainOf(edge.from.node);
    const sourcePath = pathText(frames.slice(0, chain.length));
    const exec = this.exec(edge.from.node, sourcePath);
    const node = this.nodes.get(edge.from.node);
    const frame = frames[chain.length];
    // A body reads its owner while the owner is still running: the iteration's value, or the item of the fan-out.
    if (exec && node && frame && ("loop" in frame ? frame.loop : frame.parallel) === node.id && exec.status === "running") {
      if ("loop" in frame) return { exec, available: true, value: edge.from.port === "body" ? this.state.frames[execKey(node.id, sourcePath)]?.values?.[frame.iteration] : undefined };
      const items = (exec.inputs?.items as unknown[]) ?? [];
      return { exec, available: true, value: edge.from.port === "item" ? items[frame.item] : edge.from.port === "index" ? frame.item : undefined };
    }
    return { exec, available: false };
  }

  /** Decides whether a pending execution is ready, skipped or still waiting for its sources. Returns true when it changed. */
  private evaluate(exec: WorkflowExecution): boolean {
    const node = this.nodes.get(exec.nodeId)!;
    if (node.type === "join") return this.evaluateJoin(exec, node);
    const edges = this.graph.in.get(node.id) ?? [];
    let controls = 0, fired = 0, live = 0;
    const byPort = new Map<string, Array<{ ok: boolean; value: unknown }>>();
    for (const edge of edges) {
      const source = this.source(edge, exec.path);
      const from = source.exec;
      if (!from) return false;
      if (!source.available && !TERMINAL.has(from.status)) return false;
      const ok = source.available || from.status === "succeeded";
      const onError = this.nodes.get(from.nodeId)?.onError;
      // A source that was skipped, or failed without `continue`, gives its dependants nothing to run on; a routed failure feeds its error edge only.
      if (edge.kind === "error" ? from.status === "failed" && !!from.handled && onError === "route" : source.available || (from.status !== "skipped" && !(from.status === "failed" && onError !== "continue"))) live += 1;
      if (edge.kind === "control") { controls += 1; if (ok && (source.available || (from.fired ?? ["done"]).includes(edge.from.port))) fired += 1; }
      else if (edge.kind === "error") { controls += 1; if (from.status === "failed" && from.handled && onError === "route") fired += 1; }
      else {
        const list = byPort.get(edge.to.port) ?? [];
        const value = source.available ? source.value : from.outputs?.[edge.from.port];
        // A port the source did not fill (a form that timed out without a default) is a source without a value.
        list.push({ ok: ok && (source.available || value !== undefined), value });
        byPort.set(edge.to.port, list);
      }
    }
    if (edges.length && !live) { this.set(exec, { status: "skipped", reason: "upstream_skipped" }); return true; }
    if (controls && !fired) { this.set(exec, { status: "skipped", reason: "branch_not_taken" }); return true; }
    const inputs: Record<string, unknown> = {};
    for (const input of node.inputs) {
      if (node.type === "loop" && input.id === "next") continue;
      const sources = (byPort.get(input.id) ?? []).filter((entry) => entry.ok);
      const mode = input.mode ?? "single";
      if (sources.length) inputs[input.id] = mode === "collect" ? sources.map((entry) => entry.value ?? null) : sources[0].value ?? null;
      else if (input.default !== undefined) inputs[input.id] = input.default;
      else if (input.required) { this.set(exec, { status: "skipped", reason: "upstream_skipped" }); return true; }
    }
    if (node.type === "trigger") {
      exec.inputs = {};
      this.succeed(exec, { outputs: { params: this.state.params, trigger: this.state.trigger, ...this.state.params } });
      return true;
    }
    exec.inputs = inputs;
    this.set(exec, { status: "ready" });
    return true;
  }

  private evaluateJoin(exec: WorkflowExecution, node: WorkflowNode): boolean {
    const parallelId = [...this.graph.joinOf.entries()].find(([, join]) => join === node.id)?.[0];
    const owner = parallelId ? this.exec(parallelId, exec.path) : undefined;
    if (!parallelId || !owner) { this.set(exec, { status: "skipped", reason: "upstream_skipped" }); return true; }
    if (!TERMINAL.has(owner.status)) return false;
    if (owner.status !== "succeeded") { this.set(exec, { status: "skipped", reason: "upstream_skipped" }); return true; }
    const parallel = this.nodes.get(parallelId)!;
    const items = (owner.inputs?.items as unknown[]) ?? [];
    const edge = this.state.doc.edges.find((entry) => entry.kind === "data" && entry.to.node === node.id && entry.to.port === "result");
    const results: unknown[] = [], errors: Array<Record<string, unknown>> = [];
    items.forEach((_item, index) => {
      const framePath = pathText([...parsePath(exec.path), { parallel: parallelId, item: index }]);
      const failed = this.under(framePath).find((entry) => entry.status === "failed" && !entry.handled);
      const from = edge ? this.exec(edge.from.node, framePath) : undefined;
      const ok = !failed && (!edge || from?.status === "succeeded");
      results.push(ok && edge ? from?.outputs?.[edge.from.port] ?? null : null);
      if (!ok) errors.push({ index, nodeId: failed?.nodeId ?? edge?.from.node ?? parallelId, code: failed?.error?.code ?? "WORKFLOW_FANOUT_FAILED", message: failed?.error?.message ?? "The item produced no result." });
    });
    const succeeded = items.length - errors.length;
    const policy = (parallel.config.failurePolicy ?? "fail_fast") as "fail_fast" | "continue" | { minSuccessRatio: number };
    const required = typeof policy === "object" ? policy.minSuccessRatio : undefined;
    const passes = !items.length || (policy === "fail_fast" ? errors.length === 0 : policy === "continue" ? succeeded >= 1 : succeeded / items.length >= (required ?? 0));
    exec.inputs = {};
    exec.started_ms = this.hooks.now();
    exec.outputs = { results, errors, succeededCount: succeeded, failedCount: errors.length };
    if (passes) this.succeed(exec, { outputs: exec.outputs });
    else this.failExec(exec, { code: "WORKFLOW_FANOUT_FAILED", class: "engine", message: `${succeeded} of ${items.length} items succeeded.`, details: { succeeded, total: items.length, ...(required !== undefined ? { required } : {}) } });
    return true;
  }

  /** Moves a running loop or fan-out on when its current frames are finished. Returns true when it changed. */
  private advanceOwner(exec: WorkflowExecution): boolean {
    const node = this.nodes.get(exec.nodeId)!;
    const key = execKey(exec.nodeId, exec.path), frames = parsePath(exec.path);
    if (node.type === "loop") {
      const iteration = exec.iteration ?? 1;
      const framePath = pathText([...frames, { loop: node.id, iteration }]);
      const members = this.under(framePath);
      if (!members.length || members.some((entry) => !TERMINAL.has(entry.status))) return false;
      const failed = members.find((entry) => entry.status === "failed" && !entry.handled);
      if (failed) { this.failExec(exec, { ...failed.error!, details: { ...failed.error?.details, nodeId: failed.nodeId, path: failed.path } }); return true; }
      const back = this.state.doc.edges.find((edge) => edge.kind === "loop_back" && edge.to.node === node.id);
      const from = back ? this.exec(back.from.node, framePath) : undefined;
      const values = this.state.frames[key]?.values ?? {};
      const next = from?.status === "succeeded" ? from.outputs?.[back!.from.port] ?? null : values[iteration];
      const max = Number(node.config.maxIterations ?? 3);
      const again = from?.status === "succeeded" && evaluateCondition(node.config.continueWhile as WorkflowCondition, { ...this.scopeOf(exec), next, loop: { iteration } }, (message) => this.log(exec, "warn", message));
      if (again && iteration < max) {
        this.state.frames[key] = { values: { ...values, [iteration + 1]: next } };
        exec.iteration = iteration + 1;
        this.set(exec, { counts: { total: max, succeeded: iteration, failed: 0, running: 1, waiting: 0 } });
        this.instantiate(node.id, pathText([...frames, { loop: node.id, iteration: iteration + 1 }]));
        return true;
      }
      if (again) this.log(exec, "warn", `Stopped after ${max} iterations with the condition still true.`);
      exec.counts = { total: max, succeeded: iteration, failed: 0, running: 0, waiting: 0 };
      this.succeed(exec, { outputs: { result: next }, fired: again ? ["done", "exhausted"] : ["done"] });
      return true;
    }
    if (node.type === "parallel") {
      const items = (exec.inputs?.items as unknown[]) ?? [];
      const book = (this.state.frames[key] ??= { nextItem: 0 });
      const policy = node.config.failurePolicy ?? "fail_fast";
      let running = 0, succeeded = 0, failed = 0, waiting = 0, changed = false;
      for (let index = 0; index < (book.nextItem ?? 0); index++) {
        const members = this.under(pathText([...frames, { parallel: node.id, item: index }]));
        if (members.some((entry) => entry.status === "failed" && !entry.handled)) failed += 1;
        else if (members.every((entry) => TERMINAL.has(entry.status))) succeeded += 1;
        else if (members.some((entry) => entry.status === "waiting_approval") && !members.some((entry) => entry.status === "running" || entry.status === "ready")) { waiting += 1; running += 1; }
        else running += 1;
      }
      if (failed && policy === "fail_fast") {
        // The first failed item cancels the items that are running and the ones not started.
        for (const entry of this.all()) if (!TERMINAL.has(entry.status) && entry.path.startsWith(`${exec.path ? `${exec.path}/` : ""}P:${node.id}#`)) { this.aborts.get(execKey(entry.nodeId, entry.path))?.abort(); this.set(entry, { status: "cancelled" }); changed = true; }
        book.nextItem = items.length;
        running = 0;
      }
      const concurrency = Math.min(Number(node.config.concurrency ?? 4), 16);
      while (running < concurrency && (book.nextItem ?? 0) < items.length) {
        this.instantiate(node.id, pathText([...frames, { parallel: node.id, item: book.nextItem! }]));
        book.nextItem = book.nextItem! + 1;
        running += 1;
        changed = true;
      }
      const counts = { total: items.length, succeeded, failed, running: running - waiting, waiting };
      if (JSON.stringify(counts) !== JSON.stringify(exec.counts)) { this.set(exec, { counts }); changed = true; }
      if (running === 0 && (book.nextItem ?? 0) >= items.length) { this.succeed(exec, { outputs: {} }); return true; }
      return changed;
    }
    return false;
  }

  private scopeOf(exec: WorkflowExecution): Scope {
    const frames = parsePath(exec.path);
    const scope: Scope = {
      params: this.state.params, vars: this.state.vars, inputs: exec.inputs ?? {}, trigger: this.state.trigger as unknown as Record<string, unknown>, path: exec.path,
      run: { id: this.state.runId, number: this.state.number, started_ms: this.state.started_ms, date: new Date(this.state.started_ms ?? 0).toISOString().slice(0, 10), time: new Date(this.state.started_ms ?? 0).toISOString().slice(11, 16), origin: this.state.origin },
    };
    frames.forEach((frame, index) => {
      if ("loop" in frame) scope.loop = { iteration: frame.iteration };
      else {
        const owner = this.exec(frame.parallel, pathText(frames.slice(0, index)));
        scope.item = (owner?.inputs?.items as unknown[] | undefined)?.[frame.item];
        scope.index = frame.item;
      }
    });
    return scope;
  }

  /** Starts ready executions while a running-node slot is free, in order of depth, node id and address. */
  private dispatch(): boolean {
    if (this.failing) return false;
    const now = this.hooks.now();
    const ready = this.all().filter((exec) => exec.status === "ready").sort((a, b) => (this.graph.depth.get(a.nodeId) ?? 0) - (this.graph.depth.get(b.nodeId) ?? 0) || (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0) || a.path.localeCompare(b.path, "en", { numeric: true }));
    let slots = this.state.doc.settings.maxParallel - this.all().filter((exec) => exec.status === "running" && EXTERNAL.has(this.nodes.get(exec.nodeId)!.type)).length;
    let changed = false;
    for (const exec of ready) {
      const node = this.nodes.get(exec.nodeId)!;
      if (exec.notBefore_ms !== undefined && exec.notBefore_ms > now) continue;
      if (EXTERNAL.has(node.type)) {
        if (node.type === "agent" && this.hooks.gatewayReady && !this.hooks.gatewayReady()) { if (exec.blockedBy !== "waiting_gateway") { this.set(exec, { blockedBy: "waiting_gateway" }); changed = true; } continue; }
        if (slots <= 0) { if (exec.blockedBy !== "slot") { this.set(exec, { blockedBy: "slot" }); changed = true; } continue; }
        slots -= 1;
      }
      this.run(exec, node);
      changed = true;
    }
    return changed;
  }

  private run(exec: WorkflowExecution, node: WorkflowNode): void {
    const now = this.hooks.now();
    this.set(exec, { status: "running", started_ms: now, blockedBy: undefined, retryPending: undefined, notBefore_ms: undefined });
    const scope = this.scopeOf(exec);
    const warn = (message: string) => this.log(exec, "warn", message);
    try {
      switch (node.type) {
        case "branch": {
          const cases = (node.config.cases as Array<{ id: string; condition: WorkflowCondition }>) ?? [];
          const matched: string[] = [];
          for (const entry of cases) {
            if (!evaluateCondition(entry.condition, scope, warn)) continue;
            matched.push(entry.id);
            if ((node.config.mode ?? "first_match") === "first_match") break;
          }
          this.log(exec, "info", matched.length ? `Took ${matched.join(", ")}.` : "No case matched; took else.");
          return this.succeed(exec, { outputs: { ...exec.inputs }, fired: ["done", ...(matched.length ? matched : ["else"])] });
        }
        case "loop": {
          this.state.frames[execKey(node.id, exec.path)] = { values: { 1: exec.inputs?.initial ?? null } };
          exec.iteration = 1;
          this.instantiate(node.id, pathText([...parsePath(exec.path), { loop: node.id, iteration: 1 }]));
          return;
        }
        case "parallel": {
          const items = exec.inputs?.items;
          if (!Array.isArray(items)) throw new WorkflowError("WORKFLOW_CONDITION_ERROR", `${node.name} needs a list of items.`, { nodeId: node.id });
          if (items.length > WORKFLOW_LIMITS.fanoutItems) throw new WorkflowError("WORKFLOW_LIMIT_EXCEEDED", "A fan-out takes at most 1,000 items.", { limit: "fanoutItems", max: WORKFLOW_LIMITS.fanoutItems, actual: items.length });
          const max = Number(node.config.maxItems ?? 200);
          if (items.length > max) throw new WorkflowError("WORKFLOW_LIMIT_EXCEEDED", `${node.name} takes at most ${max} items; got ${items.length}.`, { limit: "maxItems", max, actual: items.length });
          this.state.frames[execKey(node.id, exec.path)] = { nextItem: 0 };
          if (!items.length) { this.log(exec, "info", "The list is empty: the body is skipped."); exec.reason = "empty_list"; }
          return;
        }
        case "wait": {
          const until = node.config.mode === "until" ? Date.parse(String(resolveValue(node.config.until, scope, warn))) : now + Number(node.config.seconds ?? 0) * 1000;
          if (!Number.isFinite(until)) throw new WorkflowError("WORKFLOW_CONDITION_ERROR", `${node.name}: the time to wait until is not a date.`, { nodeId: node.id });
          this.set(exec, { waitingUntil_ms: until });
          return;
        }
        case "approval": {
          const own = (node.config.policy as { mode?: string } | undefined)?.mode ?? "human";
          // A run-level override replaces the policy of overridable nodes only; a reviewer agent is not available here.
          const override = node.config.overridable !== false ? this.state.doc.settings.approvalOverride?.mode : undefined;
          const mode = override === "auto" || override === "human" ? override : own;
          if (mode === "auto") return this.succeed(exec, { outputs: { subject: exec.inputs?.subject, decision: { outcome: "approved", by: { kind: "auto" }, notes: "", round: 1, decided_ms: now } }, fired: ["done", "approved"] });
          const connected = (port: string) => this.state.doc.edges.some((edge) => edge.from.node === node.id && edge.from.port === port);
          this.set(exec, { status: "waiting_approval", waitingReason: "approval", request: { kind: "approval", title: renderTemplate(String(node.config.title ?? node.name), scope), instructions: renderTemplate(String(node.config.instructions ?? ""), scope), subject: exec.inputs?.subject ?? null, allowEdit: node.config.allowEdit !== false, canRequestChanges: connected("changes_requested"), assignee: node.config.assignee ?? "any_editor" } });
          return;
        }
        case "human_input":
          this.set(exec, { status: "waiting_approval", waitingReason: "input", request: { kind: "input", title: renderTemplate(String(node.config.title ?? node.name), scope), instructions: renderTemplate(String(node.config.instructions ?? ""), scope), fields: node.config.fields ?? [], submitLabel: node.config.submitLabel ?? "Continue", assignee: node.config.assignee ?? "any_editor" } });
          return;
        default: break;
      }
    } catch (error) { return this.failExec(exec, toRunError(error)); }
    const executor = this.hooks.executors[node.type];
    if (!executor) return this.failExec(exec, { code: "UNAVAILABLE", class: "engine", message: `${node.name}: this step type cannot run on this host.` });
    if (node.type === "notify" && this.state.notifyCount >= 20) { this.log(exec, "warn", "notify_limit"); return this.succeed(exec, { outputs: {} }); }
    if (node.type === "notify") this.state.notifyCount += 1;
    const key = execKey(exec.nodeId, exec.path), attempt = exec.attempt, controller = new AbortController();
    this.aborts.set(key, controller);
    const context: ExecutorContext = {
      runId: this.state.runId, node, path: exec.path, attempt, inputs: exec.inputs ?? {}, scope, signal: controller.signal,
      render: (template) => renderTemplate(template, scope, warn), log: (level, message) => this.log(exec, level, message, "executor"), // Announced at once: who follows the run answers what the step's session asks (a tool permission) while the step is still running.
      setSession: (sessionKey) => { if (exec.sessionKey === sessionKey) return; exec.sessionKey = sessionKey; if (exec.status === "running" && exec.attempt === attempt) { this.set(exec, {}); if (!this.pumping) this.flush(); } },
    };
    executor(context).then(
      (result) => this.settle(key, attempt, controller, () => this.succeed(exec, result)),
      (error) => this.settle(key, attempt, controller, () => {
        const failure = toRunError(error);
        // A notification that could not be delivered never fails the run.
        if (node.type === "notify") { this.log(exec, "warn", `The notification was not delivered: ${failure.message}`); return this.succeed(exec, { outputs: {} }); }
        if (isBudgetStop(failure) && this.hooks.attended?.() && !this.failing) return this.holdForBudget(exec, failure);
        if (failure.retryable && exec.attempts.filter((entry) => entry.outcome === "failed").length < RETRY_DELAYS_MS.length) {
          const delay = RETRY_DELAYS_MS[exec.attempts.filter((entry) => entry.outcome === "failed").length];
          exec.attempts.push({ attempt, outcome: "failed", started_ms: exec.started_ms ?? now, ended_ms: this.hooks.now(), error: failure });
          this.log(exec, "warn", `${failure.code}: ${failure.message} — trying again in ${delay / 1000} s.`);
          return this.set(exec, { status: "ready", attempt: attempt + 1, retryPending: true, notBefore_ms: this.hooks.now() + delay });
        }
        this.failExec(exec, failure);
      }),
    );
  }
  /** A result that arrives for an execution that moved on is discarded. */
  private settle(key: string, attempt: number, controller: AbortController, apply: () => void): void {
    const exec = this.state.executions[key];
    if (this.aborts.get(key) === controller) this.aborts.delete(key);
    if (!exec || exec.status !== "running" || exec.attempt !== attempt) { if (exec) this.log(exec, "info", "late_result_discarded"); this.flush(); return; }
    apply();
    this.pump();
  }

  private succeed(exec: WorkflowExecution, result: ExecutorResult): void {
    const node = this.nodes.get(exec.nodeId)!, now = this.hooks.now();
    exec.outputs = result.outputs ?? {};
    exec.fired = result.fired ?? ["done"];
    exec.attempts.push({ attempt: exec.attempt, outcome: "succeeded", started_ms: exec.started_ms ?? now, ended_ms: now });
    // Variables are written atomically with the success.
    for (const assignment of node.assign) {
      const variable = this.state.doc.variables.find((entry) => entry.name === assignment.var);
      if (!variable) continue;
      const value = resolveValue(`{{inputs.${assignment.from}}}`, { inputs: exec.outputs });
      this.state.vars[variable.name] = variable.mode === "append" ? [...((this.state.vars[variable.name] as unknown[]) ?? []), value] : value;
    }
    this.set(exec, { status: "succeeded", started_ms: exec.started_ms ?? now, waitingReason: undefined, waitingUntil_ms: undefined, request: undefined, blockedBy: undefined, error: undefined });
  }

  /** A final failure: the node's `onError` decides what it means for the run. */
  private failExec(exec: WorkflowExecution, error: WorkflowRunError, cancelled = false): void {
    const node = this.nodes.get(exec.nodeId)!, now = this.hooks.now();
    exec.attempts.push({ attempt: exec.attempt, outcome: cancelled ? "cancelled" : "failed", started_ms: exec.started_ms ?? now, ended_ms: now, error });
    this.log(exec, "error", `${error.code}: ${error.message}`);
    const clear = { waitingReason: undefined, waitingUntil_ms: undefined, request: undefined, blockedBy: undefined, retryPending: undefined, notBefore_ms: undefined };
    if (node.onError === "skip") return this.set(exec, { ...clear, status: "skipped", reason: "error_skipped", error });
    if (node.onError === "route" || node.onError === "continue") {
      exec.outputs = { ...exec.outputs, error: { ...error, nodeId: node.id, path: exec.path, attempt: exec.attempt } };
      return this.set(exec, { ...clear, status: "failed", error, handled: true });
    }
    this.set(exec, { ...clear, status: "failed", error });
    // Inside a body the owner decides: a loop fails with its body, a fan-out applies its failure policy at the join.
    if (!this.chainOf(node.id).length) this.failing ??= { nodeId: node.id, error };
  }

  /** The run's own status follows from its executions once nothing more can be done now. */
  private settleRun(): void {
    if (this.state.status !== "running" && this.state.status !== "waiting_approval") return;
    const all = this.all();
    const active = all.some((exec) => (exec.status === "running" && (EXTERNAL.has(this.nodes.get(exec.nodeId)!.type) || exec.waitingUntil_ms !== undefined)) || (exec.status === "ready" && !this.failing));
    if (this.failing) {
      if (all.some((exec) => exec.status === "running" && EXTERNAL.has(this.nodes.get(exec.nodeId)!.type))) return;
      return this.runStatus("failed", { error: this.failing.error, failedNodeId: this.failing.nodeId });
    }
    if (active) { if (this.state.status === "waiting_approval") this.runStatus("running"); return; }
    if (all.some((exec) => exec.status === "waiting_approval")) return this.runStatus("waiting_approval");
    if (all.every((exec) => TERMINAL.has(exec.status))) {
      const outputs: Record<string, unknown> = {};
      for (const output of this.state.doc.outputs) {
        const from = this.exec(output.from.node, "");
        if (from?.status === "succeeded" && dataPort(this.nodes.get(output.from.node)!, "out", output.from.port)) outputs[output.name] = from.outputs?.[output.from.port] ?? null;
      }
      this.state.outputs = outputs;
      return this.runStatus("succeeded");
    }
    // Owners that wait on their bodies are running without being active; anything else here cannot progress.
    if (!all.some((exec) => exec.status === "running")) this.runStatus("failed", { error: { code: "INTERNAL", class: "engine", message: "The run cannot progress: a step waits for a source that will never finish." } });
  }
}
