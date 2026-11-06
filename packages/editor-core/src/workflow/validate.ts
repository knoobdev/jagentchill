import { WORKFLOW_LIMITS, WORKFLOW_NODE_TYPES, workflowDocumentSchema, type WorkflowDocument, type WorkflowEdge, type WorkflowNode, type WorkflowProblem } from "@jagentchill/protocol";
import { z } from "zod";
import { conditionProblems, parseTemplate } from "./expr.ts";
import { analyse, type GraphInfo } from "./graph.ts";
import { NODE_TYPES, WorkflowError, controlPorts, dataPort, typesCompatible } from "./nodes.ts";

const condition = z.unknown().superRefine((value, ctx) => { for (const message of conditionProblems(value)) ctx.addIssue({ code: "custom", message }); });
const prompt = z.string().min(1, "Prompt is required").max(WORKFLOW_LIMITS.promptChars, "Prompt must be 8,000 characters or fewer");
const fieldSchema = z.object({
  id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/), label: z.string().min(1).max(60), type: z.enum(["text", "long_text", "number", "boolean", "select", "multi_select", "date"]),
  required: z.boolean().default(false), options: z.array(z.string().min(1).max(60)).min(2).max(20).optional(), default: z.unknown().optional(), min: z.number().optional(), max: z.number().optional(), maxLength: z.number().int().min(1).max(8000).optional(),
}).strict();
/** The configuration of each node type this build can execute. */
export const CONFIG_SCHEMAS: Partial<Record<WorkflowNode["type"], z.ZodTypeAny>> = {
  trigger: z.object({ sources: z.array(z.object({ kind: z.enum(["manual", "schedule", "webhook", "project_event", "watch_folder", "agent", "subworkflow"]), enabled: z.boolean(), automationId: z.string().optional(), paramBindings: z.record(z.unknown()).optional() }).strict()).min(1) }).strict(),
  agent: z.object({
    promptTemplate: prompt, instructions: z.string().max(4000).default(""),
    runtime: z.union([z.object({ mode: z.literal("orc"), role: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/).default("director") }).strict(), z.object({ mode: z.literal("override"), runtime: z.string().min(1), provider: z.string().min(1), model: z.string().min(1) }).strict()]),
    session: z.literal("fresh").default("fresh"), maxTurns: z.number().int().min(1).max(20).default(4),
  }).strict(),
  approval: z.object({
    policy: z.object({ mode: z.enum(["human", "auto"]) }).strict(), title: z.string().min(1).max(80), instructions: z.string().max(1000).default(""), allowEdit: z.boolean().default(true),
    overridable: z.boolean().default(true), assignee: z.enum(["run_starter", "any_editor", "admins"]).default("any_editor"),
  }).strict(),
  branch: z.object({ cases: z.array(z.object({ id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/), label: z.string().min(1).max(24), condition }).strict()).min(1).max(8), mode: z.enum(["first_match", "all_matches"]).default("first_match") }).strict(),
  loop: z.object({ maxIterations: z.number().int().min(1).max(50), continueWhile: condition, totalTimeout_s: z.number().int().min(60).max(86_400).optional() }).strict(),
  parallel: z.object({ concurrency: z.number().int().min(1).max(16).default(4), failurePolicy: z.union([z.enum(["fail_fast", "continue"]), z.object({ minSuccessRatio: z.number().min(0).max(1) }).strict()]).default("fail_fast"), maxItems: z.number().int().min(1).max(1000).default(200), joinId: z.string().default("") }).strict(),
  join: z.object({ parallelId: z.string().default("") }).strict(),
  subworkflow: z.object({ workflowId: z.string().min(1, "Choose a workflow"), revision: z.union([z.literal("latest"), z.object({ pinned: z.number().int().min(1) }).strict()]).default("latest"), paramBindings: z.record(z.unknown()).default({}) }).strict(),
  wait: z.union([z.object({ mode: z.literal("duration"), seconds: z.number().int().min(1).max(2_592_000) }).strict(), z.object({ mode: z.literal("until"), until: z.string().min(1).max(200) }).strict()]),
  human_input: z.object({ title: z.string().min(1).max(80), instructions: z.string().max(1000).default(""), fields: z.array(fieldSchema).min(1).max(20), assignee: z.enum(["run_starter", "any_editor", "admins"]).default("any_editor"), submitLabel: z.string().min(1).max(24).default("Continue") }).strict(),
  notify: z.object({ title: z.string().min(1).max(80), body: z.string().max(500).default(""), level: z.enum(["info", "attention"]).default("info"), target: z.enum(["run_starter", "admins", "all_paired"]).default("run_starter"), link: z.enum(["run", "project", "none"]).default("run") }).strict(),
};
/** The time limits a node's `timeout_s` may take, by type. */
export const TIMEOUT_RANGE: Partial<Record<WorkflowNode["type"], [number, number]>> = { agent: [30, 7200], human_input: [60, 2_592_000], subworkflow: [60, 2_592_000] };

export type ValidateContext = {
  /** Another workflow, for sub-workflow references; undefined when it does not exist. */
  workflow?(id: string): Pick<WorkflowDocument, "id" | "nodes" | "parameters"> | undefined;
};
export type Validation = { valid: boolean; errors: WorkflowProblem[]; warnings: WorkflowProblem[] };

function templatesOf(value: unknown, path: string, out: Array<{ path: string; text: string }>): void {
  if (typeof value === "string") { if (value.includes("{{")) out.push({ path, text: value }); return; }
  if (Array.isArray(value)) return value.forEach((entry, index) => templatesOf(entry, `${path}[${index}]`, out));
  if (value && typeof value === "object") for (const [key, entry] of Object.entries(value)) templatesOf(entry, `${path}.${key}`, out);
}

/** Parses a document: the shape, then unique ids. Throws the first problem as a `WorkflowError`. */
export function parseDocument(value: unknown): WorkflowDocument {
  const parsed = workflowDocumentSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue.path.map((part, index) => (typeof part === "number" ? `[${part}]` : `${index ? "." : ""}${part}`)).join("");
    const typeIssue = issue.path.at(-1) === "type" && issue.path[0] === "nodes";
    throw new WorkflowError("WORKFLOW_SCHEMA_INVALID", `${path}: ${issue.message}${typeIssue ? `. Allowed: ${WORKFLOW_NODE_TYPES.join(", ")}` : ""}`, { path, ...(typeIssue ? { allowed: [...WORKFLOW_NODE_TYPES] } : {}) });
  }
  const doc = parsed.data;
  for (const list of [doc.nodes, doc.edges, doc.groups, doc.notes] as Array<Array<{ id: string }>>) {
    const seen = new Set<string>();
    for (const entry of list) {
      if (seen.has(entry.id)) throw new WorkflowError("WORKFLOW_ID_DUPLICATE", `Two entries carry the id ${entry.id}.`, { id: entry.id });
      seen.add(entry.id);
    }
  }
  return doc;
}

/** The graph-level rules. Pure and without side effect: a document with errors can be saved as a draft but not started. */
export function validate(doc: WorkflowDocument, context: ValidateContext = {}): Validation {
  const errors: WorkflowProblem[] = [], warnings: WorkflowProblem[] = [];
  const error = (code: string, message: string, at: Partial<WorkflowProblem> = {}) => errors.push({ code, message, ...at });
  const graph = analyse(doc);
  const byId = new Map(doc.nodes.map((node) => [node.id, node]));
  const live = doc.nodes.filter((node) => !node.disabled);

  // (11) limits
  for (const [name, max, actual] of [["nodes", WORKFLOW_LIMITS.nodes, doc.nodes.length], ["edges", WORKFLOW_LIMITS.edges, doc.edges.length], ["parameters", WORKFLOW_LIMITS.parameters, doc.parameters.length]] as const) {
    if (actual > max) error("WORKFLOW_LIMIT_EXCEEDED", `A workflow holds at most ${max} ${name}.`, { path: name });
  }
  // (1) exactly one trigger, with no incoming edge
  const triggers = doc.nodes.filter((node) => node.type === "trigger");
  if (triggers.length !== 1) error("WORKFLOW_TRIGGER_REQUIRED", "A workflow has exactly one trigger.");
  const trigger = triggers[0];
  if (trigger && doc.edges.some((edge) => edge.to.node === trigger.id)) error("WORKFLOW_SCHEMA_INVALID", "The trigger takes no incoming connection.", { nodeId: trigger.id });
  // (4) acyclic without loop-back edges
  if (graph.cycle) error("WORKFLOW_CYCLE", `These steps form a loop: ${graph.cycle.join(", ")}. Use a Loop step.`, { nodeId: graph.cycle[0], path: graph.cycle.join(",") });
  // (2) reachability from the trigger over every edge kind
  if (trigger) {
    const seen = new Set<string>();
    reachableFrom(trigger.id, doc.edges, seen);
    for (const node of live) if (!seen.has(node.id)) error("WORKFLOW_NODE_UNREACHABLE", `${node.name} is not connected to the trigger.`, { nodeId: node.id });
  }
  // (7) edges: ends, kinds and types
  for (const edge of doc.edges) {
    const source = byId.get(edge.from.node), target = byId.get(edge.to.node);
    if (!source || !target) { error("WORKFLOW_SCHEMA_INVALID", "An edge names a step that does not exist.", { edgeId: edge.id }); continue; }
    if (edge.kind === "data" || edge.kind === "loop_back") {
      const out = dataPort(source, "out", edge.from.port), input = dataPort(target, "in", edge.to.port);
      if (!out || !input) error("WORKFLOW_SCHEMA_INVALID", `The connection ${source.name} → ${target.name} names a port that does not exist.`, { edgeId: edge.id });
      else if (!typesCompatible(out.type, input.type)) error("WORKFLOW_TYPE_MISMATCH", `${target.name} needs ${input.type}; ${source.name} produces ${out.type}`, { edgeId: edge.id, nodeId: target.id, port: input.id });
    } else if (!controlPorts(source).outputs.includes(edge.from.port) || edge.to.port !== "start") error("WORKFLOW_SCHEMA_INVALID", `The connection ${source.name} → ${target.name} names a port that does not exist.`, { edgeId: edge.id });
    // (5) a loop-back edge comes from inside the body of the loop it feeds
    if (edge.kind === "loop_back" && !(target.type === "loop" && edge.to.port === "next" && graph.body.get(target.id)?.has(source.id))) {
      error("WORKFLOW_LOOP_INVALID", `The loop-back from ${source.name} must come from a step that the Loop's body output reaches.`, { edgeId: edge.id, nodeId: target.id });
    }
  }
  // (6) bodies are closed; (14) nesting
  for (const node of live) {
    const chain = graph.chain.get(node.id) ?? [];
    if (chain.filter((owner) => owner.kind === "loop").length > WORKFLOW_LIMITS.loopDepth) error("WORKFLOW_LIMIT_EXCEEDED", "Loops nest at most 3 deep.", { nodeId: node.id });
    if (chain.filter((owner) => owner.kind === "parallel").length > WORKFLOW_LIMITS.parallelDepth) error("WORKFLOW_LIMIT_EXCEEDED", "Parallel bodies nest at most 2 deep.", { nodeId: node.id });
    if (node.type === "parallel" && !graph.joinOf.get(node.id)) error("WORKFLOW_BODY_NOT_CLOSED", `${node.name} needs a Join step downstream.`, { nodeId: node.id });
    if (node.type === "join" && ![...graph.joinOf.values()].includes(node.id)) error("WORKFLOW_BODY_NOT_CLOSED", `${node.name} has no Parallel step upstream.`, { nodeId: node.id });
    if (node.type === "loop" && !doc.edges.some((edge) => edge.kind === "loop_back" && edge.to.node === node.id)) error("WORKFLOW_LOOP_INVALID", `${node.name} needs a loop-back connection into its next input.`, { nodeId: node.id, port: "next" });
  }
  for (const edge of doc.edges) {
    if (edge.kind === "loop_back") continue;
    const from = graph.chain.get(edge.from.node) ?? [], to = graph.chain.get(edge.to.node) ?? [];
    const target = byId.get(edge.to.node);
    // An edge may enter a body from upstream, and leave one only into the owner's join.
    const leaving = from.filter((owner) => !to.some((other) => other.id === owner.id));
    for (const owner of leaving) {
      if (owner.kind === "parallel" && target?.id === graph.joinOf.get(owner.id)) continue;
      error("WORKFLOW_BODY_NOT_CLOSED", `The connection into ${target?.name ?? edge.to.node} leaves the body of ${byId.get(owner.id)?.name ?? owner.id}.`, { edgeId: edge.id, nodeId: owner.id });
    }
  }
  // (3) an end node exists
  if (trigger && !live.some((node) => !doc.edges.some((edge) => edge.from.node === node.id && (edge.kind === "data" || edge.kind === "control")))) error("WORKFLOW_NO_END", "No step ends the workflow.");

  for (const node of live) {
    const info = NODE_TYPES[node.type];
    // (9) configuration and references
    const schema = CONFIG_SCHEMAS[node.type];
    if (!info.offered && node.type !== "trigger") {
      error("WORKFLOW_REF_UNRESOLVED", `${node.name}: ${info.unavailableReason ?? "this step type cannot run on this host"}.`, { nodeId: node.id });
      continue;
    }
    const parsed = schema?.safeParse(node.config);
    if (parsed && !parsed.success) {
      const issue = parsed.error.issues[0];
      error("WORKFLOW_SCHEMA_INVALID", `${node.name}: ${issue.path.length ? `${issue.path.join(".")} — ` : ""}${issue.message}`, { nodeId: node.id, path: `config.${issue.path.join(".")}` });
    }
    const range = TIMEOUT_RANGE[node.type];
    if (node.timeout_s !== undefined && range && (node.timeout_s < range[0] || node.timeout_s > range[1])) error("WORKFLOW_SCHEMA_INVALID", `${node.name}: the time limit must be between ${range[0]} and ${range[1]} seconds.`, { nodeId: node.id, path: "timeout_s" });
    if (node.type === "subworkflow" && typeof node.config.workflowId === "string" && node.config.workflowId) {
      const child = context.workflow?.(node.config.workflowId);
      if (context.workflow && !child) error("WORKFLOW_REF_UNRESOLVED", `${node.name}: the workflow it runs no longer exists.`, { nodeId: node.id });
      else if (child) {
        if (subworkflowCycle(doc.id, child, context, 1)) error("WORKFLOW_SUBWORKFLOW_CYCLE", `${node.name}: ${doc.name} and the workflow it runs call each other.`, { nodeId: node.id, path: `${doc.id},${child.id}` });
        const source = (child.nodes.find((entry) => entry.type === "trigger")?.config.sources as Array<{ kind: string; enabled: boolean }> | undefined)?.find((entry) => entry.kind === "subworkflow");
        if (!source?.enabled) error("WORKFLOW_REF_UNRESOLVED", `${node.name}: the workflow it runs does not allow use as a sub-workflow.`, { nodeId: node.id });
      }
    }
    // (8) required inputs
    for (const input of node.inputs) {
      if (!input.required || input.default !== undefined) continue;
      if (!doc.edges.some((edge) => edge.to.node === node.id && edge.to.port === input.id)) error("WORKFLOW_INPUT_MISSING", `${node.name} needs a connection into ${input.label || input.id}.`, { nodeId: node.id, port: input.id });
    }
    // `route` needs an error edge
    if (node.onError === "route" && !doc.edges.some((edge) => edge.kind === "error" && edge.from.node === node.id)) error("WORKFLOW_SCHEMA_INVALID", `${node.name} routes its failure, but its error output is not connected.`, { nodeId: node.id, port: "error" });
    // (10) templates
    const templates: Array<{ path: string; text: string }> = [];
    templatesOf(node.config, "config", templates);
    for (const template of templates) {
      for (const problem of parseTemplate(template.text).problems) error("WORKFLOW_TEMPLATE_INVALID", `${node.name}: ${problem.message}${problem.hint ? `. ${problem.hint}` : ""}`, { nodeId: node.id, path: template.path });
      for (const part of parseTemplate(template.text).parts) {
        if (!("path" in part)) continue;
        const [namespace, name] = part.path;
        if (namespace === "inputs" && name && !node.inputs.some((input) => input.id === name)) error("WORKFLOW_TEMPLATE_INVALID", `${node.name}: ${part.source} names an input this step does not have.`, { nodeId: node.id, path: template.path });
        else if (namespace === "inputs" && name) {
          const input = node.inputs.find((entry) => entry.id === name)!;
          const connected = doc.edges.some((edge) => (edge.kind === "data" || edge.kind === "loop_back") && edge.to.node === node.id && edge.to.port === name);
          if (input.default === undefined && !connected) error("WORKFLOW_INPUT_MISSING", `${node.name} reads its ${name}, but nothing is connected to it`, { nodeId: node.id, port: name, path: template.path });
        }
        if (namespace === "params" && name && !doc.parameters.some((param) => param.name === name)) error("WORKFLOW_TEMPLATE_INVALID", `${node.name}: ${part.source} names a parameter this workflow does not have.`, { nodeId: node.id, path: template.path });
        if (namespace === "vars" && name && !doc.variables.some((variable) => variable.name === name)) error("WORKFLOW_TEMPLATE_INVALID", `${node.name}: ${part.source} names a variable this workflow does not have.`, { nodeId: node.id, path: template.path });
      }
    }
    // Variables: only declared ones, and no `replace` variable is written inside a fan-out body.
    for (const assignment of node.assign) {
      const variable = doc.variables.find((entry) => entry.name === assignment.var);
      if (!variable) error("WORKFLOW_TEMPLATE_INVALID", `${node.name} assigns the unknown variable ${assignment.var}.`, { nodeId: node.id });
      else if (variable.mode === "replace" && (graph.chain.get(node.id) ?? []).some((owner) => owner.kind === "parallel")) error("WORKFLOW_VAR_WRITE_IN_PARALLEL", `${node.name} writes ${assignment.var} inside a parallel body; make the variable append.`, { nodeId: node.id, path: assignment.var });
    }
    // Warnings
    if (node.type !== "trigger" && node.outputs.length && !node.outputs.some((output) => doc.edges.some((edge) => edge.from.node === node.id && edge.from.port === output.id) || doc.outputs.some((entry) => entry.from.node === node.id && entry.from.port === output.id)) && doc.edges.some((edge) => edge.from.node === node.id)) {
      warnings.push({ code: "output_unused", message: `Nothing uses what ${node.name} produces.`, nodeId: node.id });
    }
  }
  for (const output of doc.outputs) if (!byId.get(output.from.node) || !dataPort(byId.get(output.from.node)!, "out", output.from.port)) error("WORKFLOW_SCHEMA_INVALID", `The output ${output.name} names a port that does not exist.`, { path: `outputs.${output.name}` });
  return { valid: errors.length === 0, errors, warnings };
}

function reachableFrom(start: string, edges: WorkflowEdge[], seen: Set<string>): void {
  const queue = [start];
  seen.add(start);
  while (queue.length) {
    const id = queue.shift()!;
    for (const edge of edges) if (edge.from.node === id && !seen.has(edge.to.node)) { seen.add(edge.to.node); queue.push(edge.to.node); }
  }
}
function subworkflowCycle(rootId: string, child: Pick<WorkflowDocument, "id" | "nodes">, context: ValidateContext, level: number): boolean {
  if (child.id === rootId || level > 4) return true;
  return child.nodes.some((node) => {
    if (node.type !== "subworkflow" || typeof node.config.workflowId !== "string") return false;
    const next = context.workflow?.(node.config.workflowId);
    return !!next && subworkflowCycle(rootId, next, context, level + 1);
  });
}

/** While a connection is dragged: whether dropping it on a port would be accepted, and why not. */
export function connectionProblem(doc: WorkflowDocument, graph: GraphInfo, from: WorkflowEdge["from"], to: WorkflowEdge["to"]): string | undefined {
  if (from.node === to.node) return "WORKFLOW_EDGE_SELF";
  const source = doc.nodes.find((node) => node.id === from.node), target = doc.nodes.find((node) => node.id === to.node);
  if (!source || !target) return "WORKFLOW_SCHEMA_INVALID";
  if (doc.edges.length >= WORKFLOW_LIMITS.edges) return "WORKFLOW_LIMIT_EXCEEDED";
  const out = dataPort(source, "out", from.port), input = dataPort(target, "in", to.port);
  const loopBack = !!out && target.type === "loop" && to.port === "next";
  if (out) {
    if (!input || !typesCompatible(out.type, input.type)) return "WORKFLOW_TYPE_MISMATCH";
    if (doc.edges.some((edge) => edge.from.node === from.node && edge.from.port === from.port && edge.to.node === to.node && edge.to.port === to.port)) return "WORKFLOW_EDGE_DUPLICATE";
    if ((input.mode ?? "single") === "single" && doc.edges.some((edge) => edge.to.node === to.node && edge.to.port === to.port && edge.kind !== "control" && edge.kind !== "error")) return "WORKFLOW_PORT_OCCUPIED";
  } else {
    if (!controlPorts(source).outputs.includes(from.port) || to.port !== "start" || target.type === "trigger") return "WORKFLOW_TYPE_MISMATCH";
    if (doc.edges.some((edge) => edge.from.node === from.node && edge.from.port === from.port && edge.to.node === to.node && edge.to.port === to.port)) return "WORKFLOW_EDGE_DUPLICATE";
  }
  if (!loopBack) {
    // The new edge closes a cycle when its source is already reachable from its target.
    const seen = new Set<string>();
    reachableFrom(to.node, [...graph.out.values()].flat(), seen);
    if (seen.has(from.node)) return "WORKFLOW_CYCLE";
  }
  return undefined;
}
