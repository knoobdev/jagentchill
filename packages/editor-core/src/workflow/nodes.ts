import { WORKFLOW_LIMITS, type WorkflowDocument, type WorkflowEdge, type WorkflowNode, type WorkflowNodeType, type WorkflowPort } from "@jagentchill/protocol";
import { sha256, toHex, utf8 } from "../sha256.ts";

/** A failure of a workflow operation or of validation, with the domain code and what it concerns. */
export class WorkflowError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "WorkflowError";
    this.code = code;
    this.details = details;
  }
}

/** JSON with keys sorted at every level and no insignificant whitespace. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}
export const hashOf = (value: unknown): string => toHex(sha256(utf8(canonical(value))));

/** The hash of the graph without its presentation: moving a node never changes it. */
export function graphHash(doc: Pick<WorkflowDocument, "parameters" | "variables" | "outputs" | "settings" | "nodes" | "edges">): string {
  return hashOf({
    parameters: doc.parameters, variables: doc.variables, outputs: doc.outputs, settings: doc.settings,
    nodes: doc.nodes.map(({ position: _position, size: _size, ...node }) => node), edges: doc.edges.map(({ route: _route, ...edge }) => edge),
  });
}

export type NodeFamily = "trigger" | "agent" | "generate" | "script" | "editor" | "tool" | "gate" | "flow" | "output";
export type NodeTypeInfo = {
  type: WorkflowNodeType; label: string; family: NodeFamily; icon: string;
  /** Whether this build can execute the type. A type that cannot run is not offered in the palette. */
  offered: boolean; unavailableReason?: string;
  /** A type that runs but is authored only by the built-in templates: valid in a document, absent from the palette. */
  templateOnly?: boolean;
  /** Whether the user declares the node's data inputs. */
  userInputs: boolean; defaults(): { config: Record<string, unknown>; inputs: WorkflowPort[]; outputs: WorkflowPort[] };
};
const port = (id: string, type: string, extra: Partial<WorkflowPort> = {}): WorkflowPort => ({ id, label: id, type, ...extra });
const none = () => ({ config: {}, inputs: [], outputs: [] });
const NO_PROVIDER = "No generation provider is connected to workflows in this build";

export const NODE_TYPES: Record<WorkflowNodeType, NodeTypeInfo> = {
  trigger: { type: "trigger", label: "Trigger", family: "trigger", icon: "play", offered: false, userInputs: false, defaults: () => ({ config: { sources: [{ kind: "manual", enabled: true }] }, inputs: [], outputs: [port("params", "json"), port("trigger", "json")] }) },
  agent: {
    type: "agent", label: "Agent", family: "agent", icon: "bot", offered: true, userInputs: true,
    defaults: () => ({ config: { promptTemplate: "{{inputs.input}}", instructions: "", runtime: { mode: "orc", role: "director" }, session: "fresh", maxTurns: 4 }, inputs: [port("input", "text"), port("handoff", "Handoff", { mode: "collect" })], outputs: [port("text", "text"), port("session", "json"), port("handoff", "Handoff")] }),
  },
  team: { type: "team", label: "Team", family: "agent", icon: "users", offered: false, unavailableReason: "Agent teams are not built yet", userInputs: true, defaults: none },
  // A step tool of the host (`config.tool` names it): the deterministic and generation steps of the built-in templates.
  tool: { type: "tool", label: "Tool", family: "tool", icon: "spark", offered: true, templateOnly: true, userInputs: true, defaults: () => ({ config: { tool: "", args: {} }, inputs: [], outputs: [port("result", "json")] }) },
  generate: { type: "generate", label: "Generate", family: "generate", icon: "spark", offered: false, unavailableReason: NO_PROVIDER, userInputs: false, defaults: none },
  script: { type: "script", label: "Script", family: "script", icon: "doc", offered: false, unavailableReason: "Script studio has no host service a run can call yet", userInputs: false, defaults: none },
  editor: { type: "editor", label: "Editor", family: "editor", icon: "scissors", offered: false, unavailableReason: "A run cannot stage project edits yet: the editing tools need an agent session", userInputs: true, defaults: none },
  approval: {
    type: "approval", label: "Approval", family: "gate", icon: "check-c", offered: true, userInputs: false,
    defaults: () => ({ config: { policy: { mode: "human" }, title: "Approve", instructions: "", allowEdit: true, overridable: true, assignee: "any_editor" }, inputs: [port("subject", "any", { required: true })], outputs: [port("subject", "any"), port("decision", "Decision")] }),
  },
  branch: {
    type: "branch", label: "Branch", family: "flow", icon: "flow", offered: true, userInputs: true,
    defaults: () => ({ config: { cases: [{ id: "case_1", label: "Case 1", condition: { all: [] } }], mode: "first_match" }, inputs: [port("value", "any")], outputs: [port("value", "any")] }),
  },
  loop: {
    type: "loop", label: "Loop", family: "flow", icon: "refresh", offered: true, userInputs: false,
    defaults: () => ({ config: { maxIterations: 3, continueWhile: { all: [{ left: "loop.iteration", op: "lt", right: 3 }] } }, inputs: [port("initial", "any"), port("next", "any")], outputs: [port("body", "any"), port("result", "any")] }),
  },
  parallel: {
    type: "parallel", label: "Parallel", family: "flow", icon: "layers", offered: true, userInputs: false,
    defaults: () => ({ config: { concurrency: 4, failurePolicy: "fail_fast", maxItems: 200, joinId: "" }, inputs: [port("items", "list<any>", { required: true })], outputs: [port("item", "any"), port("index", "integer")] }),
  },
  join: {
    type: "join", label: "Join", family: "flow", icon: "layers", offered: true, userInputs: false,
    defaults: () => ({ config: { parallelId: "" }, inputs: [port("result", "any")], outputs: [port("results", "list<any>"), port("errors", "list<json>"), port("succeededCount", "integer"), port("failedCount", "integer")] }),
  },
  subworkflow: {
    type: "subworkflow", label: "Subworkflow", family: "flow", icon: "flow", offered: true, userInputs: true,
    defaults: () => ({ config: { workflowId: "", revision: "latest", paramBindings: {} }, inputs: [], outputs: [port("run", "RunRef")] }),
  },
  export: { type: "export", label: "Export", family: "output", icon: "export", offered: false, unavailableReason: "The host cannot render: export runs on the device only", userInputs: false, defaults: none },
  wait: {
    type: "wait", label: "Wait", family: "flow", icon: "clock", offered: true, userInputs: true,
    defaults: () => ({ config: { mode: "duration", seconds: 5 }, inputs: [port("value", "any")], outputs: [port("value", "any")] }),
  },
  human_input: {
    type: "human_input", label: "Human input", family: "gate", icon: "edit", offered: true, userInputs: false,
    defaults: () => ({ config: { title: "Your input", instructions: "", fields: [{ id: "answer", label: "Answer", type: "text", required: true }], assignee: "any_editor", submitLabel: "Continue" }, inputs: [], outputs: [port("response", "FormResponse"), port("answer", "text")] }),
  },
  notify: {
    type: "notify", label: "Notify", family: "output", icon: "bell", offered: true, userInputs: true,
    defaults: () => ({ config: { title: "Workflow update", body: "", level: "info", target: "run_starter", link: "run" }, inputs: [port("value", "any")], outputs: [] }),
  },
};
export const OFFERED_NODE_TYPES = (Object.values(NODE_TYPES) as NodeTypeInfo[]).filter((info) => info.offered && !info.templateOnly);
/** Node types whose execution needs the agent engine. */
export const NEEDS_GATEWAY: readonly WorkflowNodeType[] = ["agent", "team"];

const FIELD_TYPE: Record<string, string> = { text: "text", long_text: "text", number: "number", boolean: "boolean", select: "string", multi_select: "list<string>", media: "MediaRef", script: "ScriptRef", date: "string" };
/** The outputs a node's configuration implies: one per form field of a human input, one per parameter on the trigger. */
export function derivedOutputs(type: WorkflowNodeType, config: Record<string, unknown>, doc?: Pick<WorkflowDocument, "parameters">): WorkflowPort[] | undefined {
  if (type === "human_input") {
    const fields = Array.isArray(config.fields) ? (config.fields as Array<{ id: string; label?: string; type: string }>) : [];
    return [port("response", "FormResponse"), ...fields.filter((field) => /^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/.test(field.id ?? "") && field.id !== "response").map((field) => port(field.id, FIELD_TYPE[field.type] ?? "text", { label: field.label ?? field.id }))];
  }
  if (type === "trigger" && doc) return [port("params", "json"), port("trigger", "json"), ...doc.parameters.filter((param) => param.name !== "params" && param.name !== "trigger").map((param) => port(param.name, param.type, { label: param.label }))];
  return undefined;
}

export type ControlPorts = { inputs: string[]; outputs: string[] };
/** The ordering ports of a node: `start`, `done`, `error` and the named outputs its type fires. */
export function controlPorts(node: Pick<WorkflowNode, "type" | "config">): ControlPorts {
  const outputs = ["done", "error"];
  if (node.type === "branch") outputs.push(...((node.config.cases as Array<{ id: string }> | undefined) ?? []).map((entry) => entry.id), "else");
  if (node.type === "approval") outputs.push("approved", "rejected", "changes_requested");
  if (node.type === "loop") outputs.push("exhausted");
  if (node.type === "human_input" || node.type === "wait") outputs.push("timed_out");
  return { inputs: node.type === "trigger" ? [] : ["start"], outputs: node.type === "trigger" ? ["done"] : outputs };
}
export const isControlPort = (node: Pick<WorkflowNode, "type" | "config">, side: "in" | "out", portId: string): boolean =>
  (side === "in" ? controlPorts(node).inputs : controlPorts(node).outputs).includes(portId);
/** The data port of a node, or undefined when the id names a control port or nothing. */
export const dataPort = (node: WorkflowNode, side: "in" | "out", portId: string): WorkflowPort | undefined => (side === "in" ? node.inputs : node.outputs).find((entry) => entry.id === portId);

const widening: Record<string, string[]> = { integer: ["number"], string: ["text"], text: ["string"], ImageRef: ["MediaRef"], VideoRef: ["MediaRef"], AudioRef: ["MediaRef"] };
const STRUCTS = ["Brief", "ShotList", "Shot", "AssetPlan", "VoiceTrack", "CaptionSet", "MusicTrack", "SfxSet", "ReviewReport", "Handoff", "Decision", "FormResponse"];
const listOf = (type: string): string | undefined => /^list<(.+)>$/.exec(type)?.[1];
/** Whether an output of type `from` may feed an input of type `to`. `any` on either side is accepted: an untyped value is checked when it arrives. */
export function typesCompatible(from: string, to: string): boolean {
  if (from === to || to === "any" || from === "any") return true;
  if (widening[from]?.includes(to)) return true;
  if (STRUCTS.includes(from) && to === "json") return true;
  const a = listOf(from), b = listOf(to);
  if (a && b) return typesCompatible(a, b);
  if (a && to === "json") return true;
  return false;
}

/** The kind an edge between two ports has. */
export function inferEdgeKind(doc: WorkflowDocument, from: WorkflowEdge["from"], to: WorkflowEdge["to"]): WorkflowEdge["kind"] | undefined {
  const source = doc.nodes.find((node) => node.id === from.node), target = doc.nodes.find((node) => node.id === to.node);
  if (!source || !target) return undefined;
  if (dataPort(source, "out", from.port)) {
    if (target.type === "loop" && to.port === "next") return "loop_back";
    return dataPort(target, "in", to.port) ? "data" : undefined;
  }
  if (!controlPorts(source).outputs.includes(from.port) || to.port !== "start" || target.type === "trigger") return undefined;
  return from.port === "error" ? "error" : "control";
}

export const snap = (value: number): number => Math.round(value / WORKFLOW_LIMITS.grid) * WORKFLOW_LIMITS.grid;
/** A step is a card: 240 wide, and tall enough for its header and two lines saying what it does. */
export const NODE_SIZE = { width: 240, height: 104 } as const;
export const sizeOf = (node: Pick<WorkflowNode, "size">) => node.size ?? NODE_SIZE;
/** The widest a card grows for a long name; past it the name is cut with an ellipsis. */
export const NODE_MAX_WIDTH = 280;
/**
 * The width a card is drawn at: never under the width of a card, grown so its name fits on one line. Text is not measured — the
 * estimate is the same on every platform and on the server: a wide glyph (CJK, kana, hangul) counts double.
 */
export function cardWidth(node: Pick<WorkflowNode, "size"> & { name?: string }): number {
  const base = Math.max(sizeOf(node).width, NODE_SIZE.width);
  let units = 0;
  for (const char of node.name ?? "") units += /[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uff60]/.test(char) ? 14 : 7.8;
  // 14 padding + 28 icon tile + 10 gap on the start side, 14 padding on the end side.
  return Math.max(base, Math.min(NODE_MAX_WIDTH, Math.ceil((66 + units) / 20) * 20));
}

/** A unique node id derived from the type: `agent`, `agent_2`… */
export function nextNodeId(doc: Pick<WorkflowDocument, "nodes">, base: string, taken: ReadonlySet<string> = new Set()): string {
  const used = new Set([...doc.nodes.map((node) => node.id), ...taken]);
  if (!used.has(base)) return base;
  for (let index = 2; ; index++) if (!used.has(`${base}_${index}`)) return `${base}_${index}`;
}
export function nextEdgeId(doc: Pick<WorkflowDocument, "edges">, taken: ReadonlySet<string> = new Set()): string {
  const used = new Set([...doc.edges.map((edge) => edge.id), ...taken]);
  for (let index = doc.edges.length + 1; ; index++) if (!used.has(`e${index}`)) return `e${index}`;
}

/** A node of a type with its default ports and configuration. */
export function makeNode(doc: Pick<WorkflowDocument, "nodes" | "parameters">, type: WorkflowNodeType, position: { x: number; y: number }, id?: string): WorkflowNode {
  const info = NODE_TYPES[type], defaults = info.defaults();
  const nodeId = id ?? nextNodeId(doc, type);
  return {
    id: nodeId, type, name: nodeId === type ? info.label : `${info.label} ${nodeId.split("_").pop()}`, description: "", config: defaults.config, inputs: defaults.inputs,
    outputs: derivedOutputs(type, defaults.config, doc) ?? defaults.outputs, position: { x: snap(position.x), y: snap(position.y) }, onError: "fail", cache: "auto", assign: [], protected: false, disabled: false,
  };
}

/** A new workflow: one trigger node with its manual source. */
export function createDocument(input: { id: string; name: string; now: number; deviceId?: string; origin?: WorkflowDocument["meta"]["origin"] }): WorkflowDocument {
  const base = { nodes: [], parameters: [] };
  const trigger = { ...makeNode(base, "trigger", { x: 120, y: 200 }, "start"), name: "Start" };
  const doc: WorkflowDocument = {
    format: "jagentchill.workflow", schemaVersion: 1, id: input.id, name: input.name, description: "", revision: 1, graphHash: "", parameters: [], variables: [], outputs: [],
    nodes: [trigger], edges: [], groups: [], notes: [], viewport: { x: 0, y: 0, zoom: 1 },
    settings: { maxParallel: 4, runTimeout_s: 86_400, stepMode: false, reportBack: "final" },
    meta: { origin: input.origin ?? "user", protected: false, pendingPlan: false, created_ms: input.now, updated_ms: input.now, ...(input.deviceId ? { createdByDeviceId: input.deviceId } : {}) },
  };
  return { ...doc, graphHash: graphHash(doc) };
}
