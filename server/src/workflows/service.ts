import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { workflow as wf } from "@jagentchill/editor-core";
import { AUTOMATION_EVENTS, WORKFLOW_LIMITS, automationDraftSchema, automationScheduleSchema, workflowOpSchema, type Role, type Scope, type WorkflowDocument, type WorkflowOp } from "@jagentchill/protocol";
import type { Connection, RpcMethod } from "../channel/ws-channel.ts";
import type { DeviceRegistry } from "../devices/registry.ts";
import { ProtocolError } from "../errors.ts";
import { audit } from "../store/database.ts";
import { createAutomations } from "./automations.ts";
import { createWorkflowDocuments, wireError } from "./documents.ts";
import { createRunMoney } from "./run-money.ts";
import { createWorkflowRuns, type StepTool, type TurnAsk, type TurnMoney } from "./runs.ts";
import { WORKFLOW_MIGRATION } from "./schema.ts";

export type WorkflowServiceDeps = {
  db: DatabaseSync; now: () => number; devices: DeviceRegistry;
  broadcast: (scope: Scope, event: string, stream: string, payload: unknown, filter?: (connection: Connection) => boolean) => void;
  /** Whether the server's link to the agent engine is up. */
  agentsReady: () => boolean;
  /** The session service, by its channel methods. */
  sessions: () => { methods: Map<string, RpcMethod>; canRead(sessionKey: string, connection: Connection): boolean };
  /** The step tools `tool` nodes can name. */
  stepTools?: () => ReadonlyMap<string, StepTool> | undefined;
  /** The sessions that hold a permission request nobody answered yet (the tools service knows them). */
  pendingSessions?: () => ReadonlySet<string>;
  /** Close questions in a run's step sessions after that run ends. */
  closePendingQuestions?: (sessionKey: string) => void;
  /** Marks a session as tainted (the tools service keeps and enforces it). */
  taint?: (sessionKey: string, source: string, texts?: readonly string[]) => void;
  /** Called before an agent step's turn is sent (the run's money keeper reserves it, or throws). */
  reserveTurn?: (runId: string, turn: TurnAsk) => void | Promise<void>;
  /** The interval of the safety sweep; 0 leaves the clock to the caller. */
  sweepMs?: number;
};

const READ: Scope = "jagentchill.projects.read", WRITE: Scope = "jagentchill.projects.write", RUN: Scope = "jagentchill.generation.run";
const id = z.string().min(1).max(64);
const pathText = z.string().max(400).default("");
const schemas = {
  workflow: z.object({ workflowId: id }).strict(),
  create: z.object({ name: z.string().max(80).optional() }).strict(),
  apply: z.object({ workflowId: id, baseRevision: z.number().int().min(1).optional(), ops: z.array(workflowOpSchema).min(1).max(WORKFLOW_LIMITS.batchOps), label: z.string().max(80).optional(), idempotencyKey: z.string().max(64).optional() }).strict(),
  validate: z.object({ workflowId: id.optional(), document: z.unknown().optional() }).strict(),
  layout: z.object({ workflowId: id, scope: z.union([z.literal("all"), z.array(z.string()).max(200)]).default("all") }).strict(),
  restore: z.object({ workflowId: id, revision: z.number().int().min(1) }).strict(),
  importFile: z.object({ text: z.string().max(6_000_000) }).strict(),
  subscribe: z.object({ stream: z.enum(["index", "doc", "run"]), id: id.optional() }).strict(),
  // `maxCostUsd`: the most one scheduled run may cost. Nobody is there to confirm a cost when a schedule fires, so a workflow with a step that can pay does not start without it.
  trigger: z.object({ workflowId: id, schedule: automationScheduleSchema.nullable(), enabled: z.boolean().default(false), params: z.record(z.unknown()).optional(), maxCostUsd: z.number().min(0.01).max(1000).optional() }).strict(),
  sessionBind: z.object({ workflowId: id, sessionKey: z.string().min(1).max(200) }).strict(),
  // `confirmedUsd`, `allowUnpriced`: the person's answer to the run's one money question (`confirmed` is what the answer of a cost dialog carries beside them).
  runCreate: z.object({ workflowId: id, params: z.record(z.unknown()).default({}), idempotencyKey: z.string().min(8).max(64).optional(), confirmedUsd: z.number().min(0).max(100_000).optional(), allowUnpriced: z.array(z.string().min(1).max(200)).max(50).optional(), confirmed: z.boolean().optional(), confirmedPerItemUsd: z.number().min(0).max(100_000).optional() }).strict(),
  runEstimate: z.object({ workflowId: id, params: z.record(z.unknown()).default({}) }).strict(),
  runConfirm: z.object({ runId: id, confirmedUsd: z.number().min(0).max(100_000).optional(), allowUnpriced: z.array(z.string().min(1).max(200)).max(50).optional() }).strict().refine((value) => value.confirmedUsd !== undefined || !!value.allowUnpriced?.length),
  run: z.object({ runId: id }).strict(),
  runList: z.object({ workflowId: id.optional(), status: z.string().max(24).optional(), query: z.string().max(200).optional(), limit: z.number().int().min(1).max(200).optional() }).strict(),
  executions: z.object({ runId: id, nodeId: z.string().max(48).optional(), limit: z.number().int().min(1).max(500).optional() }).strict(),
  timeline: z.object({ runId: id, afterSeq: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(2000).optional() }).strict(),
  node: z.object({ runId: id, nodeId: z.string().min(1).max(48), path: pathText }).strict(),
  rerun: z.object({ runId: id, nodeId: z.string().min(1).max(48), outputs: z.record(z.unknown()).optional(), notes: z.unknown().optional() }).strict(),
  logs: z.object({ runId: id, nodeId: z.string().max(48).optional(), path: z.string().max(400).optional(), afterSeq: z.number().int().min(0).optional(), level: z.enum(["debug", "info", "warn", "error"]).optional() }).strict(),
  resolve: z.object({ runId: id, nodeId: z.string().min(1).max(48), path: pathText, outcome: z.enum(["approved", "rejected", "changes_requested"]).optional(), subject: z.unknown().optional(), notes: z.string().max(4000).optional(), values: z.record(z.unknown()).optional() }).strict(),
  automation: z.object({ automationId: id }).strict(),
  automationCreate: z.object({ automation: automationDraftSchema }).strict(),
  automationUpdate: z.object({ automationId: id, automation: automationDraftSchema, expectedRevision: z.number().int().min(1) }).strict(),
  automationRemove: z.object({ automationId: id, cancelRuns: z.boolean().default(true) }).strict(),
  automationEnable: z.object({ automationId: id, enabled: z.boolean(), cancelRuns: z.boolean().default(false) }).strict(),
  automationEvent: z.object({ event: z.enum(["export.finished", "export.failed"]), fields: z.record(z.union([z.string().max(2000), z.number()])) }).strict(),
  automationRuns: z.object({ automationId: id.optional(), status: z.string().max(24).optional(), limit: z.number().int().min(1).max(200).optional() }).strict(),
};
function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value ?? {});
  // A rule a schema states in words (the fields of an event trigger) is said as it is; anything else is a shape error.
  if (!parsed.success) { const issue = parsed.error.issues[0]; throw new ProtocolError("INVALID_PARAMS", issue?.code === "custom" ? issue.message : "The parameters do not match the expected shape.", { details: { path: issue?.path.join(".") ?? "" } }); }
  return parsed.data;
}

/** Workflows and automations of the host: documents, runs, the scheduler, and their channel methods and streams. */
export function createWorkflowService(deps: WorkflowServiceDeps) {
  const { db, now } = deps;
  db.exec(WORKFLOW_MIGRATION);
  type Subscription = { index: boolean; automation: boolean; docs: Set<string>; runs: Set<string> };
  // A connection that is gone is simply never delivered to again.
  const subscriptions = new WeakMap<Connection, Subscription>();
  const subscriptionOf = (connection: Connection): Subscription => {
    let found = subscriptions.get(connection);
    if (!found) subscriptions.set(connection, (found = { index: false, automation: false, docs: new Set(), runs: new Set() }));
    return found;
  };
  const toIndex = (event: string, payload: unknown) => deps.broadcast(READ, event, "workflow.index", payload, (connection) => subscriptions.get(connection)?.index === true);
  const toDevices = (event: string, payload: unknown, to: (deviceId: string, role: Role) => boolean) =>
    deps.broadcast(READ, event, "workflow.notice", payload, (connection) => { const role = connection.role(); return !!role && to(connection.deviceId, role); });

  const docs = createWorkflowDocuments({
    db, now,
    events: {
      ops: (batch) => deps.broadcast(READ, "jagentchill.workflow.ops", `workflow.doc:${batch.workflowId}`, batch, (connection) => subscriptions.get(connection)?.docs.has(batch.workflowId) === true),
      changed: (workflowId, what) => toIndex("jagentchill.workflow.changed", { workflowId, what, ...(what === "deleted" ? {} : { workflow: docs.item(workflowId) }) }),
    },
  });
  // The services that hold money, as they are bound (`bindSpend`): the run's money question is made from them.
  let spendPort: TurnMoney = {};
  const runMoney = createRunMoney({ docs, port: () => spendPort, db });
  const runs = createWorkflowRuns({
    db, now, docs, devices: deps.devices, agentsReady: deps.agentsReady, sessions: deps.sessions, ...(deps.stepTools ? { stepTools: deps.stepTools } : {}), ...(deps.pendingSessions ? { pendingSessions: deps.pendingSessions } : {}), ...(deps.closePendingQuestions ? { closePendingQuestions: deps.closePendingQuestions } : {}), ...(deps.taint ? { taint: deps.taint } : {}), ...(deps.reserveTurn ? { reserveTurn: deps.reserveTurn } : {}),
    emit: {
      run(record, changes) {
        deps.broadcast(READ, "jagentchill.workflow.updated", `workflow.run:${record.id}`, { runId: record.id, graphHash: record.graphHash, run: record, changes }, (connection) => subscriptions.get(connection)?.runs.has(record.id) === true);
        if (changes.some((change) => change.kind === "run.status") || changes.some((change) => change.kind === "node.status" && change.status === "waiting_approval")) toIndex("jagentchill.workflow.run.changed", { run: record, attention: runs.attention() });
        // A run that finished, failed or paused is said to every device that may read it, wherever it is in the app:
        // the two events above reach only a device that is looking at the run or at the list of workflows. A run
        // inside another run is the business of that run; a run a person cancelled needs no telling.
        const ended = changes.find((change) => change.kind === "run.status" && (change.status === "succeeded" || change.status === "failed" || change.status === "paused" || change.status === "running" || change.status === "cancelled"));
        if (ended && ended.kind === "run.status" && record.origin !== "subworkflow") {
          toDevices("jagentchill.workflow.notice", {
            runId: record.id, workflowId: record.workflowId, workflowName: record.workflowName, kind: "ended", status: ended.status, ...(ended.pauseReason ? { pauseReason: ended.pauseReason } : {}),
            title: record.workflowName, body: ended.status === "failed" ? (ended.error?.message ?? "").slice(0, 240) : "", level: ended.status === "succeeded" ? "info" : "attention", link: "run", nodeId: ended.failedNodeId ?? "", path: "",
          }, () => true);
        }
      },
      notice: (notice, to) => toDevices("jagentchill.workflow.notice", notice, to),
    },
  });
  const automations = createAutomations({
    db, now, docs, runs, devices: deps.devices,
    emit: {
      changed: (automationId) => deps.broadcast(READ, "jagentchill.automation.changed", "automation", { automationId }, (connection) => subscriptions.get(connection)?.automation === true),
      notice: (notice, to) => toDevices("jagentchill.automation.notice", notice, to),
    },
  });

  const methods = new Map<string, RpcMethod>();
  const define = (name: string, scope: Scope, handle: RpcMethod["handle"]) => methods.set(name, { scope, handle });
  const actor = (connection: Connection) => ({ kind: "device" as const, deviceId: connection.deviceId });
  const withValidation = (document: WorkflowDocument) => ({ document, validation: docs.validate(document) });

  // — documents —
  define("jagentchill.workflow.list", READ, () => ({ workflows: docs.list(), attention: runs.attention(), offered: wf.OFFERED_NODE_TYPES.map((info) => info.type) }));
  define("jagentchill.workflow.get", READ, (raw) => { const { workflowId } = parse(schemas.workflow, raw); return { ...withValidation(docs.get(workflowId)), trigger: automations.workflowTrigger(workflowId) }; });
  define("jagentchill.workflow.create", WRITE, (raw, connection) => withValidation(docs.create(parse(schemas.create, raw), actor(connection))));
  define("jagentchill.workflow.apply", WRITE, (raw, connection) => {
    const params = parse(schemas.apply, raw);
    if (params.idempotencyKey) {
      const before = db.prepare("SELECT result FROM workflow_idempotency WHERE key = ?").get(`apply:${params.workflowId}:${params.idempotencyKey}`) as { result: string } | undefined;
      if (before) return JSON.parse(before.result);
    }
    const applied = docs.apply({ workflowId: params.workflowId, ops: params.ops as unknown as WorkflowOp[], ...(params.baseRevision ? { baseRevision: params.baseRevision } : {}), ...(params.label ? { label: params.label } : {}) }, actor(connection));
    const result = { revision: applied.revision, rebased: applied.rebased, droppedOps: applied.droppedOps, graphHash: applied.document.graphHash, validation: docs.validate(applied.document) };
    if (params.idempotencyKey) {
      db.prepare("INSERT OR REPLACE INTO workflow_idempotency (key, result, ts_ms) VALUES (?, ?, ?)").run(`apply:${params.workflowId}:${params.idempotencyKey}`, JSON.stringify(result), now());
      db.prepare("DELETE FROM workflow_idempotency WHERE ts_ms < ?").run(now() - 86_400_000);
    }
    return result;
  });
  define("jagentchill.workflow.validate", READ, (raw) => {
    const params = parse(schemas.validate, raw);
    if (params.workflowId) return docs.validate(docs.get(params.workflowId));
    try { return docs.validate(wf.parseDocument(params.document)); } catch (error) { return wireError(error); }
  });
  define("jagentchill.workflow.layout", READ, (raw) => { const params = parse(schemas.layout, raw); return wf.layout(docs.get(params.workflowId), params.scope); });
  define("jagentchill.workflow.duplicate", WRITE, (raw, connection) => withValidation(docs.duplicate(parse(schemas.workflow, raw).workflowId, actor(connection))));
  define("jagentchill.workflow.delete", WRITE, (raw, connection) => {
    const { workflowId } = parse(schemas.workflow, raw);
    // A deleted workflow fires no more: its trigger records go with it. Its runs stay listed.
    automations.workflowRemoved(workflowId);
    docs.remove(workflowId);
    audit(db, now(), `device:${connection.deviceId}`, "workflow.delete", { workflowId });
    return { workflowId };
  });
  define("jagentchill.workflow.history", READ, (raw) => ({ revisions: docs.history(parse(schemas.workflow, raw).workflowId) }));
  define("jagentchill.workflow.restore", WRITE, (raw, connection) => { const params = parse(schemas.restore, raw); return withValidation(docs.restore(params.workflowId, params.revision, actor(connection))); });
  define("jagentchill.workflow.import", WRITE, (raw, connection) => withValidation(docs.importFile(parse(schemas.importFile, raw).text, actor(connection))));
  define("jagentchill.workflow.export", READ, (raw) => {
    const { workflowId } = parse(schemas.workflow, raw);
    const file = docs.exportFile(workflowId);
    return { fileName: `${docs.get(workflowId).name.replace(/[^\p{L}\p{N} _-]+/gu, "-").trim() || "workflow"}.jcworkflow`, mimeType: "application/vnd.jagentchill.workflow+json", text: JSON.stringify(file) };
  });
  define("jagentchill.workflow.subscribe", READ, (raw, connection) => {
    const params = parse(schemas.subscribe, raw), mine = subscriptionOf(connection);
    if (params.stream === "index") mine.index = true; else if (params.id) (params.stream === "doc" ? mine.docs : mine.runs).add(params.id);
    return { stream: params.stream === "index" ? "workflow.index" : `workflow.${params.stream}:${params.id}` };
  });
  define("jagentchill.workflow.unsubscribe", READ, (raw, connection) => {
    const params = parse(schemas.subscribe, raw), mine = subscriptionOf(connection);
    if (params.stream === "index") mine.index = false; else if (params.id) (params.stream === "doc" ? mine.docs : mine.runs).delete(params.id);
  });
  // The schedule source of the trigger node is an automation record; only a device enables it.
  define("jagentchill.workflow.trigger.set", WRITE, (raw, connection) => {
    const params = parse(schemas.trigger, raw);
    const trigger = automations.workflowSchedule(params.workflowId, { schedule: params.schedule, enabled: params.enabled, ...(params.params ? { params: params.params } : {}), ...(params.maxCostUsd !== undefined ? { maxCostUsd: params.maxCostUsd } : {}) }, connection.deviceId);
    return { trigger, ...withValidation(docs.get(params.workflowId)) };
  });
  // Sessions opened from a workflow's agent panel: the panel shows the ones bound to its workflow.
  define("jagentchill.workflow.session.bind", "jagentchill.agent.use", (raw, connection) => {
    const params = parse(schemas.sessionBind, raw);
    docs.get(params.workflowId);
    if (!deps.sessions().canRead(params.sessionKey, connection)) throw new ProtocolError("NOT_FOUND", "This session no longer exists.", { details: { sessionKey: params.sessionKey } });
    db.prepare("INSERT OR REPLACE INTO workflow_sessions (session_key, workflow_id, created_ms) VALUES (?, ?, ?)").run(params.sessionKey, params.workflowId, now());
    return { workflowId: params.workflowId, sessionKey: params.sessionKey };
  });
  define("jagentchill.workflow.session.list", READ, (raw, connection) => {
    const { workflowId } = parse(schemas.workflow, raw);
    const keys = (db.prepare("SELECT session_key FROM workflow_sessions WHERE workflow_id = ? ORDER BY created_ms DESC").all(workflowId) as Array<{ session_key: string }>).map((row) => row.session_key);
    return { sessionKeys: keys.filter((key) => deps.sessions().canRead(key, connection)) };
  });

  // — runs —
  // What a run of this workflow can cost at most, and whether the person is asked before it starts (never for a workflow no step of which can spend).
  define("jagentchill.workflow.run.estimate", READ, (raw) => {
    const params = parse(schemas.runEstimate, raw), estimate = runMoney.estimate(params.workflowId, params.params);
    return { estimate, confirmation: runMoney.confirmation(estimate) };
  });
  define("jagentchill.workflow.run.create", RUN, (raw, connection) => {
    const params = parse(schemas.runCreate, raw);
    // Money is the person's decision, asked ONCE for the whole run: nothing starts until the amount they saw covers the
    // estimate, and a model whose price is not known is used only when they were told its name and started all the same.
    const made = runMoney.estimate(params.workflowId, params.params), asked = runMoney.confirmation(made), allowed = params.allowUnpriced ?? [];
    if (asked.needed && (params.confirmedUsd === undefined || params.confirmedUsd + 1e-9 < made.highUsd || (params.confirmedPerItemUsd ?? 0) + 1e-9 < made.perItemUsd || asked.unpricedModels.some((model) => !allowed.includes(model)))) {
      throw new ProtocolError("PERMISSION_DENIED", "Confirm the cost of this run first.", { details: { reason: "confirmation_required", estimate: made, confirmation: asked, confirmWith: { confirmedUsd: made.highUsd, ...(made.perItemUsd > 0 ? { confirmedPerItemUsd: made.perItemUsd } : {}), ...(asked.unpricedModels.length ? { allowUnpriced: asked.unpricedModels } : {}) } } });
    }
    const run = runs.start({ workflowId: params.workflowId, params: params.params, origin: "user", originRef: { deviceId: connection.deviceId }, startedByDeviceId: connection.deviceId, attended: true, ...(params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : {}) });
    // What the run is held to, on record before its first step is sent: the amount the person confirmed, or — when
    // nobody had to be asked — the estimate. A run that cannot spend has nothing on record and nothing to pay with.
    if (made.canSpend && !runMoney.coverage(run.id)) {
      const fixedUsd = asked.needed ? Math.max(params.confirmedUsd ?? 0, made.highUsd) : made.highUsd;
      runMoney.cover(run.id, `device:${connection.deviceId}`, fixedUsd, asked.unpricedModels.filter((model) => allowed.includes(model)));
      // A list of unknown length: what was confirmed for each of its items is kept with the run and allowed when the list is there.
      runMoney.keepItemRates(run.id, `device:${connection.deviceId}`, fixedUsd, made.itemRates);
    }
    audit(db, now(), `device:${connection.deviceId}`, "workflow.run.start", { runId: run.id, workflowId: run.workflowId, ...(made.canSpend ? { confirmedUsd: asked.needed ? Math.max(params.confirmedUsd ?? 0, made.highUsd) : made.highUsd, asked: asked.needed } : {}) });
    return { run };
  });
  /** A person confirms a new amount (or allows a model by name) for a run that stopped because it would pass what was confirmed at its start: the run goes on. */
  define("jagentchill.workflow.run.confirm", RUN, (raw, connection) => {
    const params = parse(schemas.runConfirm, raw), record = runs.record(params.runId), before = runMoney.coverage(params.runId);
    const amount = params.confirmedUsd ?? before?.confirmedUsd;
    // A model's name alone answers "its price is not known" for a run whose amount stands; it is no answer about an amount nobody confirmed.
    if (amount === undefined) throw new ProtocolError("INVALID_PARAMS", "Confirm the cost of this run.", { details: { field: "confirmedUsd" } });
    if (before && amount < before.confirmedUsd) throw new ProtocolError("INVALID_PARAMS", "The new amount is lower than what was confirmed before.", { details: { field: "confirmedUsd", confirmedUsd: before.confirmedUsd } });
    if (!runMoney.cover(params.runId, `device:${connection.deviceId}`, amount, params.allowUnpriced ?? [])) throw new ProtocolError("UNAVAILABLE", "This host cannot record a confirmation.");
    audit(db, now(), `device:${connection.deviceId}`, "workflow.run.confirm", { runId: params.runId, confirmedUsd: amount, ...(params.allowUnpriced?.length ? { allowUnpriced: params.allowUnpriced } : {}) });
    if (record.status === "paused" && record.pauseReason === "budget_exceeded") runs.resume(params.runId, connection.deviceId);
    return { runId: params.runId, confirmedUsd: amount, allowUnpriced: runMoney.coverage(params.runId)?.unpriced ?? [] };
  });
  define("jagentchill.workflow.run.get", READ, (raw) => runs.get(parse(schemas.run, raw).runId));
  define("jagentchill.workflow.run.list", READ, (raw) => ({ runs: runs.list(parse(schemas.runList, raw)) }));
  define("jagentchill.workflow.run.executions", READ, (raw) => { const params = parse(schemas.executions, raw); return { executions: runs.executions(params.runId, params) }; });
  define("jagentchill.workflow.run.timeline", READ, (raw) => { const params = parse(schemas.timeline, raw); return runs.timeline(params.runId, params.afterSeq, params.limit); });
  define("jagentchill.workflow.run.pause", RUN, (raw, connection) => ({ run: runs.pause(parse(schemas.run, raw).runId, connection.deviceId) }));
  define("jagentchill.workflow.run.resume", RUN, (raw, connection) => ({ run: runs.resume(parse(schemas.run, raw).runId, connection.deviceId) }));
  define("jagentchill.workflow.run.cancel", RUN, (raw, connection) => {
    const { runId } = parse(schemas.run, raw);
    audit(db, now(), `device:${connection.deviceId}`, "workflow.run.cancel", { runId });
    return { run: runs.cancel(runId, "user", connection.deviceId) };
  });
  define("jagentchill.workflow.run.delete", RUN, (raw) => { const { runId } = parse(schemas.run, raw); runs.remove(runId); return { runId }; });
  for (const action of ["retry", "skip", "cancel"] as const) {
    define(`jagentchill.workflow.node.${action}`, RUN, (raw, connection) => { const params = parse(schemas.node, raw); return { run: runs.node(params.runId, action, params.nodeId, params.path, connection.deviceId) }; });
  }
  define("jagentchill.workflow.node.rerun", RUN, (raw, connection) => { const { runId, nodeId, ...edit } = parse(schemas.rerun, raw); return { run: runs.rerun(runId, nodeId, edit, connection.deviceId) }; });
  define("jagentchill.workflow.node.logs", READ, (raw) => { const params = parse(schemas.logs, raw); return { entries: runs.logs(params.runId, params) }; });
  define("jagentchill.workflow.node.resolve", RUN, (raw, connection) => { const { runId, ...answer } = parse(schemas.resolve, raw); return { run: runs.resolve(runId, answer, connection) }; });

  // — automations —
  define("jagentchill.automation.list", READ, () => ({ automations: automations.list() }));
  define("jagentchill.automation.get", READ, (raw) => ({ automation: automations.get(parse(schemas.automation, raw).automationId) }));
  define("jagentchill.automation.create", WRITE, (raw, connection) => ({ automation: automations.create(parse(schemas.automationCreate, raw).automation, connection.deviceId) }));
  define("jagentchill.automation.update", WRITE, (raw, connection) => { const params = parse(schemas.automationUpdate, raw); return { automation: automations.update(params.automationId, params.automation, params.expectedRevision, connection.deviceId) }; });
  define("jagentchill.automation.delete", WRITE, (raw, connection) => {
    const params = parse(schemas.automationRemove, raw);
    automations.remove(params.automationId, params.cancelRuns);
    audit(db, now(), `device:${connection.deviceId}`, "automation.delete", { automationId: params.automationId });
    return { automationId: params.automationId };
  });
  define("jagentchill.automation.duplicate", WRITE, (raw, connection) => ({ automation: automations.duplicate(parse(schemas.automation, raw).automationId, connection.deviceId) }));
  // Only a device turns a trigger on: no tool of an agent reaches this method.
  define("jagentchill.automation.setEnabled", WRITE, (raw, connection) => {
    const params = parse(schemas.automationEnable, raw);
    audit(db, now(), `device:${connection.deviceId}`, "automation.setEnabled", { automationId: params.automationId, enabled: params.enabled });
    return { automation: automations.setEnabled(params.automationId, params.enabled, connection.deviceId, params.cancelRuns) };
  });
  define("jagentchill.automation.run", WRITE, (raw, connection) => {
    if (!connection.scopes().includes(RUN)) throw new ProtocolError("SCOPE_DENIED", "Your role on this host does not allow this", { details: { requiredScope: RUN } });
    return { run: automations.run(parse(schemas.automation, raw).automationId) };
  });
  define("jagentchill.automation.run.list", READ, (raw) => ({ runs: automations.runs(parse(schemas.automationRuns, raw)) }));
  define("jagentchill.automation.run.get", READ, (raw) => ({ run: automations.runOf(parse(schemas.run, raw).runId) }));
  // A device says what only it can see: an export it made has finished or failed. The host checks the fields and lets the automations that wait for it start.
  define("jagentchill.automation.event.report", WRITE, (raw) => {
    const params = parse(schemas.automationEvent, raw), known = AUTOMATION_EVENTS[params.event] as Record<string, "string" | "number">, fields: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(params.fields)) {
      if (!(name in known)) throw new ProtocolError("INVALID_PARAMS", `Unknown field ${name} for ${params.event}`, { details: { field: name } });
      if (typeof value !== known[name]) throw new ProtocolError("INVALID_PARAMS", `${name} of ${params.event} is a ${known[name]}.`, { details: { field: name } });
      fields[name] = typeof value === "string" ? value.slice(0, 300) : value;
    }
    return { runs: automations.event(params.event, fields).map((run) => ({ id: run.id, automationId: run.automationId, status: run.status })) };
  });
  define("jagentchill.automation.run.cancel", WRITE, (raw) => ({ run: automations.cancelRun(parse(schemas.run, raw).runId) }));
  define("jagentchill.automation.subscribe", READ, (_raw, connection) => { subscriptionOf(connection).automation = true; return { stream: "automation" }; });
  define("jagentchill.automation.unsubscribe", READ, (_raw, connection) => { subscriptionOf(connection).automation = false; });

  const tick = (): void => {
    try { runs.tick(); automations.tick(); } catch (error) { console.error(`[workflows] sweep failed: ${error instanceof Error ? error.message : error}`); }
  };
  // Runs and schedules are restored once the host is up; the sweep is the clock of waits, retries and schedules.
  runs.recover();
  automations.recover();
  // A workflow run that ends is an event automations can wait for (`workflow.finished`, `workflow.failed`).
  const unobserve = runs.listen((record) => automations.observeRun(record));
  const sweep = deps.sweepMs === 0 ? undefined : setInterval(tick, deps.sweepMs ?? 1000);
  sweep?.unref();

  return {
    methods, docs, runs, automations, tick,
    /** Estimate a workflow with the same money model used by its Run dialog. */
    estimate: (workflowId: string, params: Record<string, unknown>) => runMoney.estimate(workflowId, params),
    /** The services that hold money, once the host has them: the paid-call gate, what a session cost, the most a turn can cost. */
    bindSpend(port: TurnMoney): void { spendPort = { ...spendPort, ...port }; runs.bindSpend({ ...port, fanned: (runId, counts) => runMoney.fanned(runId, counts) }); if (port.gate) automations.bindGate(port.gate); },
    close(): void { if (sweep) clearInterval(sweep); unobserve(); runs.close(); automations.close(); },
  };
}
export type WorkflowService = ReturnType<typeof createWorkflowService>;
