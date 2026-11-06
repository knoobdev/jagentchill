import { z } from "zod";

/** The workflow document, its graph operations, runs and automations: the wire and stored shapes of the `workflow` and `automation` domains. */
export const WORKFLOW_NODE_TYPES = [
  "trigger", "agent", "team", "tool", "generate", "script", "editor", "approval", "branch", "loop", "parallel", "join",
  "subworkflow", "export", "wait", "human_input", "notify",
] as const;
export type WorkflowNodeType = (typeof WORKFLOW_NODE_TYPES)[number];

export const WORKFLOW_LIMITS = {
  nodes: 200, edges: 400, groups: 50, notes: 100, ports: 32, parameters: 50, variables: 100, outputs: 20, documentBytes: 786_432,
  promptChars: 8000, textChars: 4000, loopDepth: 3, parallelDepth: 2, workflows: 500, nodeExecutions: 20_000, fanoutItems: 1000,
  revisions: 50, undoSteps: 100, batchOps: 200, grid: 20, positionMax: 1_000_000,
} as const;

export const WORKFLOW_SCALAR_TYPES = ["string", "text", "number", "integer", "boolean", "json", "any"] as const;
export const WORKFLOW_REF_TYPES = ["ProjectRef", "ScriptRef", "ImageRef", "VideoRef", "AudioRef", "MediaRef", "FileRef", "RunRef", "EntityRef"] as const;
export const WORKFLOW_STRUCT_TYPES = ["Brief", "ShotList", "Shot", "AssetPlan", "VoiceTrack", "CaptionSet", "MusicTrack", "SfxSet", "ReviewReport", "Handoff", "Decision", "FormResponse"] as const;
const BASE_TYPES: readonly string[] = [...WORKFLOW_SCALAR_TYPES, ...WORKFLOW_REF_TYPES, ...WORKFLOW_STRUCT_TYPES];
/** A port type: a base type, `list<T>` of a base type, or `control` for the ordering ports every node has. */
export const isWorkflowPortType = (type: string): boolean => type === "control" || BASE_TYPES.includes(type) || (/^list<([A-Za-z]+)>$/.test(type) && BASE_TYPES.includes(type.slice(5, -1)));

export const workflowNodeId = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/);
const portType = z.string().refine(isWorkflowPortType, "unknown port type");
export const workflowPortSchema = z.object({
  id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/), label: z.string().max(60), type: portType, required: z.boolean().optional(),
  mode: z.enum(["single", "collect", "first"]).optional(), default: z.unknown().optional(), schema: z.unknown().optional(),
  select: z.array(z.string().min(1).max(120)).min(1).max(16).optional(),
}).strict();
export type WorkflowPort = z.infer<typeof workflowPortSchema>;

const point = z.object({ x: z.number().int(), y: z.number().int() }).strict();
export const workflowNodeSchema = z.object({
  id: workflowNodeId, type: z.enum(WORKFLOW_NODE_TYPES), name: z.string().min(1).max(60), description: z.string().max(500).default(""),
  config: z.record(z.unknown()).default({}), inputs: z.array(workflowPortSchema).max(32).default([]), outputs: z.array(workflowPortSchema).max(32).default([]),
  position: point, size: z.object({ width: z.number().int().min(160).max(480), height: z.number().int().min(64).max(320) }).strict().optional(),
  timeout_s: z.number().int().min(1).max(2_592_000).optional(), onError: z.enum(["fail", "route", "skip", "continue"]).default("fail"), cache: z.enum(["auto", "off"]).default("auto"),
  assign: z.array(z.object({ var: z.string().min(1).max(40), from: z.string().min(1).max(120) }).strict()).max(20).default([]),
  roleRequirement: z.enum(["required", "optional"]).optional(), protected: z.boolean().default(false), disabled: z.boolean().default(false),
}).strict();
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;

export const WORKFLOW_EDGE_KINDS = ["data", "control", "error", "loop_back"] as const;
const endpoint = z.object({ node: workflowNodeId, port: z.string().min(1).max(48) }).strict();
const routeSchema = z.object({ style: z.enum(["bezier", "orthogonal", "straight"]).default("bezier"), waypoints: z.array(point).max(8).default([]), labelT: z.number().min(0).max(1).default(0.5) }).strict();
export const workflowEdgeSchema = z.object({
  id: z.string().min(1).max(64), kind: z.enum(WORKFLOW_EDGE_KINDS), from: endpoint, to: endpoint, label: z.string().max(40).default(""),
  route: routeSchema.default({ style: "bezier", waypoints: [], labelT: 0.5 }),
}).strict();
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;

const paramType = z.string().refine((type) => isWorkflowPortType(type) && type !== "control", "unknown parameter type");
export const workflowParameterSchema = z.object({
  name: z.string().regex(/^[a-z][a-zA-Z0-9_]{0,39}$/), label: z.string().min(1).max(60), type: paramType, required: z.boolean().default(false), default: z.unknown().optional(),
  enum: z.array(z.union([z.string(), z.number()])).min(2).max(50).optional(), min: z.number().optional(), max: z.number().optional(), maxLength: z.number().int().positive().optional(),
  multiline: z.boolean().optional(), help: z.string().max(200).default(""), group: z.string().max(60).optional(), secret: z.literal(false).default(false),
}).strict();
export type WorkflowParameter = z.infer<typeof workflowParameterSchema>;
export const workflowVariableSchema = z.object({ name: z.string().regex(/^[a-z][a-zA-Z0-9_]{0,39}$/), type: paramType, initial: z.unknown().optional(), mode: z.enum(["replace", "append"]).default("replace") }).strict();
export const workflowGroupSchema = z.object({
  id: z.string().min(1).max(48), label: z.string().max(60).default(""), colorIndex: z.number().int().min(1).max(8).default(1), nodeIds: z.array(workflowNodeId).default([]),
  frame: z.object({ x: z.number().int(), y: z.number().int(), width: z.number().int().min(1), height: z.number().int().min(1) }).strict(), collapsed: z.boolean().default(false),
}).strict();
export const workflowNoteSchema = z.object({ id: z.string().min(1).max(48), text: z.string().max(2000).default(""), x: z.number().int(), y: z.number().int(), width: z.number().int().min(120).max(800), height: z.number().int().min(60).max(800) }).strict();
export const workflowSettingsSchema = z.object({
  maxParallel: z.number().int().min(1).max(16).default(4), runTimeout_s: z.number().int().min(3600).max(2_592_000).default(86_400), defaultBudgetUsd: z.number().min(0.01).max(100_000).optional(),
  approvalOverride: z.object({ mode: z.enum(["auto", "agent", "human"]) }).strict().optional(), stepMode: z.boolean().default(false), reportBack: z.enum(["all", "final", "none"]).default("final"),
}).strict();
export const workflowMetaSchema = z.object({
  origin: z.enum(["user", "agent", "template", "import"]).default("user"), protected: z.boolean().default(false), createdByDeviceId: z.string().optional(), authorSessionKey: z.string().optional(),
  templateId: z.string().optional(), plan: z.unknown().optional(), pendingPlan: z.boolean().default(false), created_ms: z.number().int().nonnegative(), updated_ms: z.number().int().nonnegative(),
}).strict();

export const workflowDocumentSchema = z.object({
  format: z.literal("jagentchill.workflow"), schemaVersion: z.literal(1), id: z.string().min(1).max(64), name: z.string().min(1).max(80), description: z.string().max(1000).default(""),
  revision: z.number().int().min(1), graphHash: z.string(),
  parameters: z.array(workflowParameterSchema).max(50).default([]), variables: z.array(workflowVariableSchema).max(100).default([]),
  outputs: z.array(z.object({ name: z.string().regex(/^[a-z][a-zA-Z0-9_]{0,39}$/), type: paramType, from: endpoint }).strict()).max(20).default([]),
  nodes: z.array(workflowNodeSchema), edges: z.array(workflowEdgeSchema), groups: z.array(workflowGroupSchema).default([]), notes: z.array(workflowNoteSchema).default([]),
  viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number().min(0.1).max(4) }).strict().default({ x: 0, y: 0, zoom: 1 }),
  settings: workflowSettingsSchema.default({}), meta: workflowMetaSchema,
}).strict();
export type WorkflowDocument = z.infer<typeof workflowDocumentSchema>;
export type WorkflowGroup = z.infer<typeof workflowGroupSchema>;
export type WorkflowNote = z.infer<typeof workflowNoteSchema>;

/** Conditions are data: a tree of `all` / `any` / `not` over comparison leaves. */
export const WORKFLOW_CONDITION_OPS = ["eq", "ne", "gt", "gte", "lt", "lte", "contains", "not_contains", "in", "starts_with", "ends_with", "exists", "is_empty"] as const;
export type WorkflowCondition = { all: WorkflowCondition[] } | { any: WorkflowCondition[] } | { not: WorkflowCondition } | { left: string; op: (typeof WORKFLOW_CONDITION_OPS)[number]; right?: unknown };

/** The closed set of graph operations. */
export type WorkflowOp =
  | { op: "node.add"; node: Partial<WorkflowNode> & Pick<WorkflowNode, "id" | "type">; /** Where in the list the node goes; an undo puts a removed node back where it was. */ at?: number }
  | { op: "node.update"; id: string; patch: Partial<Pick<WorkflowNode, "name" | "description" | "config" | "inputs" | "outputs" | "timeout_s" | "onError" | "cache" | "assign" | "roleRequirement" | "disabled" | "protected">> }
  | { op: "node.move"; id: string; position: { x: number; y: number } }
  | { op: "node.resize"; id: string; /** `null` returns the node to its default size. */ size: { width: number; height: number } | null }
  | { op: "node.remove"; id: string }
  | { op: "edge.add"; edge: Partial<WorkflowEdge> & Pick<WorkflowEdge, "id" | "from" | "to">; at?: number }
  | { op: "edge.update"; id: string; patch: Partial<Pick<WorkflowEdge, "label" | "route">> }
  | { op: "edge.remove"; id: string }
  | { op: "group.add"; group: WorkflowGroup; at?: number } | { op: "group.update"; id: string; patch: Partial<Omit<WorkflowGroup, "id">> } | { op: "group.remove"; id: string }
  | { op: "note.add"; note: WorkflowNote; at?: number } | { op: "note.update"; id: string; patch: Partial<Omit<WorkflowNote, "id">> } | { op: "note.remove"; id: string }
  | { op: "param.set"; parameters: WorkflowParameter[] }
  | { op: "var.set"; variables: WorkflowDocument["variables"] }
  | { op: "output.set"; outputs: WorkflowDocument["outputs"] }
  | { op: "settings.update"; patch: Partial<WorkflowDocument["settings"]> }
  | { op: "meta.update"; patch: { name?: string; description?: string } }
  | { op: "viewport.set"; viewport: WorkflowDocument["viewport"] }
  | { op: "layout.apply"; positions: Record<string, { x: number; y: number }>; routes?: Record<string, WorkflowEdge["route"]> };
export const WORKFLOW_OP_NAMES = [
  "node.add", "node.update", "node.move", "node.resize", "node.remove", "edge.add", "edge.update", "edge.remove", "group.add", "group.update", "group.remove",
  "note.add", "note.update", "note.remove", "param.set", "var.set", "output.set", "settings.update", "meta.update", "viewport.set", "layout.apply",
] as const;
export const workflowOpSchema = z.object({ op: z.enum(WORKFLOW_OP_NAMES) }).passthrough();

export const WORKFLOW_ERROR_CODES = [
  "WORKFLOW_SCHEMA_INVALID", "WORKFLOW_ID_DUPLICATE", "WORKFLOW_GEOMETRY_INVALID", "WORKFLOW_TYPE_MISMATCH", "WORKFLOW_PORT_OCCUPIED", "WORKFLOW_EDGE_DUPLICATE",
  "WORKFLOW_EDGE_SELF", "WORKFLOW_PARAM_SECRET", "WORKFLOW_TEMPLATE_INVALID", "WORKFLOW_VAR_WRITE_IN_PARALLEL", "WORKFLOW_NODE_UNREACHABLE", "WORKFLOW_NO_END",
  "WORKFLOW_CYCLE", "WORKFLOW_LOOP_INVALID", "WORKFLOW_BODY_NOT_CLOSED", "WORKFLOW_INPUT_MISSING", "WORKFLOW_REF_UNRESOLVED", "WORKFLOW_SUBWORKFLOW_CYCLE",
  "WORKFLOW_SESSION_SHARED_CONCURRENT", "WORKFLOW_TRIGGER_REQUIRED", "WORKFLOW_LIMIT_EXCEEDED", "WORKFLOW_REVISION_CONFLICT", "WORKFLOW_UNDO_CONFLICT",
  "WORKFLOW_READ_ONLY", "WORKFLOW_TOOL_NOT_ALLOWED", "WORKFLOW_POLICY_LOCKED",
  "WORKFLOW_INVALID", "WORKFLOW_INPUT_INVALID", "WORKFLOW_TRIGGER_DISABLED", "WORKFLOW_PARAM_UNSUPPORTED", "WORKFLOW_AMEND_FORBIDDEN", "WORKFLOW_HUMAN_REQUIRED",
  "WORKFLOW_NODE_NOT_ACTIVE", "WORKFLOW_RUN_TIMEOUT", "WORKFLOW_REJECTED",
  "WORKFLOW_AGENT_TIMEOUT", "WORKFLOW_AGENT_OUTPUT_INVALID", "WORKFLOW_AGENT_REFUSED", "WORKFLOW_RUNTIME_UNAVAILABLE", "WORKFLOW_TEAM_NO_RESULT",
  "WORKFLOW_GENERATION_REFUSED", "WORKFLOW_EDITOR_VALIDATION_FAILED", "WORKFLOW_LEASE_UNAVAILABLE", "WORKFLOW_CONDITION_ERROR", "WORKFLOW_FANOUT_FAILED",
  "WORKFLOW_HANDOFF_LIMIT", "WORKFLOW_UNTRUSTED_ARGUMENT",
] as const;
export type WorkflowErrorCode = (typeof WORKFLOW_ERROR_CODES)[number];
export type WorkflowProblem = { code: string; message: string; nodeId?: string; edgeId?: string; port?: string; path?: string };

// — Runs —
export const WORKFLOW_RUN_STATUSES = ["draft", "queued", "running", "paused", "waiting_approval", "succeeded", "failed", "cancelled"] as const;
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];
export const WORKFLOW_NODE_STATUSES = ["pending", "ready", "running", "waiting_approval", "succeeded", "failed", "skipped", "cancelled", "stale"] as const;
export type WorkflowNodeStatus = (typeof WORKFLOW_NODE_STATUSES)[number];
export type WorkflowEdgeState = "idle" | "flowing" | "delivered" | "skipped" | "error";
export type WorkflowRunError = { code: string; class?: string; message: string; retryable?: boolean; details?: Record<string, unknown> };
export type WorkflowAttempt = { attempt: number; outcome: "succeeded" | "failed" | "interrupted" | "cancelled"; started_ms: number; ended_ms: number; error?: WorkflowRunError };
/** One execution of a node, addressed by `(nodeId, path)`; `path` is the canonical string of its body frames. */
export type WorkflowExecution = {
  nodeId: string; path: string; status: WorkflowNodeStatus; attempt: number; attempts: WorkflowAttempt[];
  blockedBy?: string; retryPending?: boolean; notBefore_ms?: number; waitingReason?: string; waitingUntil_ms?: number; reason?: string;
  started_ms?: number; finished_ms?: number; progress?: number | null; error?: WorkflowRunError; handled?: boolean; sessionKey?: string;
  inputs?: Record<string, unknown>; outputs?: Record<string, unknown>; fired?: string[]; counts?: { total: number; succeeded: number; failed: number; running: number; waiting: number };
  /** What a waiting execution asks a person: the approval subject or the form. */
  request?: Record<string, unknown>; iteration?: number;
};
export type WorkflowRunChange =
  | { kind: "run.status"; status: WorkflowRunStatus; pauseReason?: string; cancelReason?: string; error?: WorkflowRunError; failedNodeId?: string }
  | ({ kind: "node.status" } & Pick<WorkflowExecution, "nodeId" | "path" | "status" | "attempt" | "blockedBy" | "retryPending" | "waitingReason" | "waitingUntil_ms" | "reason" | "error" | "counts" | "started_ms" | "finished_ms" | "handled">)
  | { kind: "edge.state"; edgeId: string; state: WorkflowEdgeState }
  | { kind: "log.marker"; nodeId: string; path: string; level: "info" | "warn" | "error"; message: string };
export type WorkflowRunRecord = {
  id: string; number: number; workflowId: string; workflowName: string; revision: number; graphHash: string; params: Record<string, unknown>;
  status: WorkflowRunStatus; pauseReason?: string; cancelReason?: string; origin: "user" | "agent" | "automation" | "subworkflow";
  originRef: { deviceId?: string; sessionKey?: string; automationId?: string; parentRunId?: string; parentNodeId?: string };
  startedByDeviceId: string; attended: boolean; created_ms: number; started_ms?: number; finished_ms?: number; reopenedCount: number;
  failedNodeId?: string; error?: WorkflowRunError; outputs?: Record<string, unknown>;
};
export type WorkflowNodeAggregate = { nodeId: string; status: WorkflowNodeStatus; counts?: WorkflowExecution["counts"]; latest: WorkflowExecution };
export type WorkflowLogEntry = { seq: number; ts_ms: number; nodeId: string; path: string; level: "debug" | "info" | "warn" | "error"; source: "engine" | "executor" | "agent"; message: string };
export type WorkflowTimelineEntry = { seq: number; ts_ms: number; change: WorkflowRunChange | { kind: "user.action"; action: string; deviceId: string; nodeId?: string } };
export type WorkflowListItem = {
  id: string; name: string; description: string; origin: string; revision: number; nodeCount: number; problemCount: number; updated_ms: number; created_ms: number;
  lastRun?: { id: string; status: WorkflowRunStatus; started_ms?: number; created_ms: number };
};

// — Automations —
export const AUTOMATION_LIMITS = { automations: 100, workflowTriggers: 200, triggers: 10, instructions: 10, minIntervalMinutes: 5, runningRuns: 4, activePerAutomation: 3, queued: 10, promptChars: 8000, runsKept: 1000, failuresBeforePause: 5 } as const;
export const automationScheduleSchema = z.object({ rrule: z.string().min(6).max(400), tzid: z.string().min(1).max(64), dtstart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict();
export type AutomationSchedule = z.infer<typeof automationScheduleSchema>;
/**
 * The host-observed events a trigger can wait for, with the fields a condition can test and `{{trigger.event.<field>}}`
 * can read. An event is listed here only when the host really observes it: `export.*` is reported by the device that
 * exported, `project.created` and `workflow.*` are seen by the host itself. `exportId` names one export of one device:
 * a device that could not tell the host at once tells it again later, and the host starts nothing twice for the same id.
 */
export const AUTOMATION_EVENTS = {
  "project.created": { projectId: "string", name: "string", origin: "string" },
  "export.finished": { exportId: "string", projectId: "string", presetId: "string", container: "string", durationSeconds: "number", width: "number", height: "number", fileName: "string", sizeBytes: "number" },
  "export.failed": { exportId: "string", projectId: "string", presetId: "string", errorCode: "string" },
  "workflow.finished": { workflowId: "string", runId: "string", templateId: "string", projectId: "string", costUsd: "number", durationSeconds: "number" },
  "workflow.failed": { workflowId: "string", runId: "string", templateId: "string", errorCode: "string", failedNodeId: "string" },
} as const satisfies Record<string, Record<string, "string" | "number">>;
export type AutomationEventName = keyof typeof AUTOMATION_EVENTS;
export const AUTOMATION_EVENT_NAMES = Object.keys(AUTOMATION_EVENTS) as [AutomationEventName, ...AutomationEventName[]];
export const AUTOMATION_OPERATORS = ["equals", "not_equals", "contains", "greater_than", "less_than"] as const;
export const automationConditionSchema = z.object({ field: z.string().min(1).max(40), operator: z.enum(AUTOMATION_OPERATORS), value: z.union([z.string().max(200), z.number()]) }).strict();
export type AutomationCondition = z.infer<typeof automationConditionSchema>;
export const automationScheduleTriggerSchema = z.object({ id: z.string().min(1).max(48), type: z.literal("schedule"), schedule: automationScheduleSchema }).strict();
/** A project event trigger: one event, any project or one, and up to five conditions that must all hold. */
export const automationEventTriggerSchema = z.object({
  id: z.string().min(1).max(48), type: z.literal("event"), event: z.enum(AUTOMATION_EVENT_NAMES), projectId: z.string().min(1).max(64).optional(), conditions: z.array(automationConditionSchema).max(5).default([]),
}).strict();
/** What is wrong with the conditions and the project of an event trigger, as sentences for the person who saves it. */
export function automationEventProblems(trigger: { event: AutomationEventName; projectId?: string; conditions: readonly AutomationCondition[] }): { path: (string | number)[]; message: string }[] {
  const fields = AUTOMATION_EVENTS[trigger.event] as Record<string, "string" | "number">, problems: { path: (string | number)[]; message: string }[] = [];
  trigger.conditions.forEach((condition, index) => {
    const type = fields[condition.field];
    if (!type) problems.push({ path: ["conditions", index, "field"], message: `Unknown field ${condition.field} for ${trigger.event}` });
    else if (condition.operator === "contains" && type !== "string") problems.push({ path: ["conditions", index, "operator"], message: `${condition.field} is a number: use equals, greater_than or less_than` });
    else if ((condition.operator === "greater_than" || condition.operator === "less_than") && (type !== "number" || typeof condition.value !== "number")) problems.push({ path: ["conditions", index, "operator"], message: `${condition.operator} compares numbers` });
  });
  if (trigger.projectId && !("projectId" in fields)) problems.push({ path: ["projectId"], message: `${trigger.event} is not an event of a project` });
  return problems;
}
export const automationTriggerSchema = z.discriminatedUnion("type", [automationScheduleTriggerSchema, automationEventTriggerSchema]).superRefine((trigger, ctx) => {
  if (trigger.type === "event") for (const problem of automationEventProblems(trigger)) ctx.addIssue({ code: "custom", path: problem.path, message: problem.message });
});
export type AutomationTrigger = z.infer<typeof automationTriggerSchema>;
export type AutomationScheduleTrigger = z.infer<typeof automationScheduleTriggerSchema>;
export type AutomationEventTrigger = z.infer<typeof automationEventTriggerSchema>;
/** Whether an event satisfies a trigger: its name, its project and every condition. A field the event lacks satisfies no condition. */
export function automationEventMatches(trigger: AutomationEventTrigger, event: AutomationEventName, fields: Record<string, unknown>): boolean {
  if (trigger.event !== event) return false;
  if (trigger.projectId && fields.projectId !== trigger.projectId) return false;
  return trigger.conditions.every((condition) => {
    const value = fields[condition.field];
    if (value === undefined || value === null) return false;
    switch (condition.operator) {
      case "equals": return typeof value === "number" ? value === Number(condition.value) : String(value) === String(condition.value);
      case "not_equals": return typeof value === "number" ? value !== Number(condition.value) : String(value) !== String(condition.value);
      case "contains": return String(value).toLowerCase().includes(String(condition.value).toLowerCase());
      case "greater_than": return typeof value === "number" && value > Number(condition.value);
      default: return typeof value === "number" && value < Number(condition.value);
    }
  });
}
export const automationInstructionSchema = z.discriminatedUnion("kind", [
  // `maxCostUsd`: the most one run started by this instruction may cost. Nobody is there to confirm an estimate when an
  // automation runs, so this limit — set by the person who made the automation — is the confirmation: a run estimated
  // above it is not started, and a started run is stopped at it. The host refuses to save an automation without it
  // (`AUTOMATION_COST_LIMITS`); it is optional here only so that records stored before it existed still load.
  z.object({ kind: z.literal("run_workflow"), workflowId: z.string().min(1).max(64), params: z.record(z.unknown()).default({}), maxCostUsd: z.number().min(0.01).max(1000).optional(), continueOnFailure: z.boolean().default(false) }).strict(),
  z.object({
    kind: z.literal("start_session"), prompt: z.string().min(1).max(8000), role: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/).default("director"),
    ref: z.object({ runtimeId: z.string(), providerId: z.string(), modelId: z.string() }).strict().optional(), reuse: z.enum(["new", "continue"]).default("new"), continueOnFailure: z.boolean().default(false),
  }).strict(),
]);
export type AutomationInstruction = z.infer<typeof automationInstructionSchema>;
/** The ranges of the two cost limits of an automation (`automations` spec: "Run-workflow instruction", "Unattended run safety"). Neither has a default: the person sets them. */
export const AUTOMATION_COST_LIMITS = { maxCostUsd: { min: 0.01, max: 1000 }, budgetUsd: { min: 0.01, max: 100_000 } } as const;
/**
 * The cost limits an automation must carry before it can be saved, as `{path, message}` (the host and the form use the
 * same rule): every "Run workflow" instruction needs its `maxCostUsd`, and an automation with a "Start session"
 * instruction — which has no limit of its own — needs the monthly `advanced.budgetUsd`.
 */
export function automationCostProblems(draft: { instructions: readonly { kind: string; maxCostUsd?: number }[]; advanced?: { budgetUsd?: number } }): { path: string; message: string }[] {
  const problems: { path: string; message: string }[] = [];
  draft.instructions.forEach((instruction, index) => { if (instruction.kind === "run_workflow" && instruction.maxCostUsd === undefined) problems.push({ path: `instructions.${index}.maxCostUsd`, message: "Set the most one run may cost" }); });
  if (draft.advanced?.budgetUsd === undefined && draft.instructions.some((instruction) => instruction.kind === "start_session")) problems.push({ path: "advanced.budgetUsd", message: "Set a monthly budget" });
  return problems;
}
export const automationAdvancedSchema = z.object({
  concurrency: z.enum(["skip", "queue", "parallel"]).default("skip"), catchUp: z.enum(["skip", "run_once"]).default("skip"), maxRuns: z.number().int().min(1).max(100_000).optional(),
  expires_ms: z.number().int().positive().optional(), timeoutMinutes: z.number().int().min(1).max(1440).default(120), parkedTimeoutHours: z.number().int().min(1).max(720).default(72),
  notify: z.enum(["always", "on_failure", "never"]).default("on_failure"),
  /** The most this automation may spend in a calendar month, over all its runs. */
  budgetUsd: z.number().min(0.01).max(100_000).optional(),
  /**
   * A person's explicit leave, given on the automation, to use models whose price is not known (a local model, a
   * custom endpoint without a price): nobody is there to be asked when it runs. Off unless turned on — without it a
   * request to such a model is refused with `BUDGET_EXCEEDED`, reason `unpriced_model`, before it is sent.
   */
  allowUnpricedModels: z.boolean().optional(),
}).strict();
export const automationDraftSchema = z.object({
  name: z.string().trim().min(1).max(80), description: z.string().max(300).optional(), triggers: z.array(automationTriggerSchema).min(1).max(10),
  instructions: z.array(automationInstructionSchema).min(1).max(10), advanced: automationAdvancedSchema.default({}),
}).strict();
export type AutomationDraft = z.infer<typeof automationDraftSchema>;
export type AutomationRecord = AutomationDraft & {
  id: string; kind: "automation" | "workflow-trigger"; enabled: boolean; ownerDeviceId: string;
  origin: { kind: "device"; deviceId: string } | { kind: "agent"; sessionId: string; agentId: string } | { kind: "workflow"; workflowId: string };
  enabledBy?: { deviceId: string; enabled_ms: number }; created_ms: number; updated_ms: number; revision: number;
  stats: { runCount: number; successCount: number; lastRun_ms?: number; lastStatus?: AutomationRunStatus; nextRun_ms?: number; consecutiveFailures: number };
  pausedReason?: "completed" | "repeated_failures" | "device_revoked"; createdOn?: string;
  /** Runs per day of the last 14 days, oldest first: `[succeeded, failed]`. */
  spark?: Array<[number, number]>;
  /** Current problems found by estimating the automation's workflow instructions. */
  warnings?: string[];
};
export const AUTOMATION_RUN_STATUSES = ["queued", "running", "waiting", "succeeded", "failed", "cancelled", "skipped", "missed"] as const;
export type AutomationRunStatus = (typeof AUTOMATION_RUN_STATUSES)[number];
export type AutomationRun = {
  id: string; automationId: string; automationName: string; number: number; trigger: { type: "schedule" | "manual" | "event"; triggerId?: string; detail?: Record<string, unknown> };
  status: AutomationRunStatus; reason?: string; started_ms: number; finished_ms?: number;
  steps: Array<{ index: number; kind: string; status: "pending" | "running" | "waiting" | "succeeded" | "failed" | "skipped"; started_ms?: number; finished_ms?: number; error?: { code: string; message: string }; sessionId?: string; runId?: string; output?: Record<string, unknown>; /** The most the step's workflow run may cost (the instruction's limit, or what the monthly budget still leaves). */ capUsd?: number; /** What the step has cost so far. */ costUsd?: number }>;
  warnings: string[];
};
