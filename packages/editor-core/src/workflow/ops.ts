import {
  WORKFLOW_LIMITS, workflowDocumentSchema, workflowEdgeSchema, workflowGroupSchema, workflowNodeSchema, workflowNoteSchema, workflowParameterSchema,
  type WorkflowDocument, type WorkflowEdge, type WorkflowNode, type WorkflowOp,
} from "@jagentchill/protocol";
import { z } from "zod";
import { nodeBox } from "./geometry.ts";
import { NODE_TYPES, WorkflowError, canonical, cardWidth, controlPorts, dataPort, derivedOutputs, graphHash, inferEdgeKind, snap, typesCompatible } from "./nodes.ts";

export type ObjectRef = { kind: "node" | "edge" | "section"; id: string };
export type BatchResult = {
  doc: WorkflowDocument;
  /** The batch that restores the document as it was: one undo step. */
  inverse: WorkflowOp[];
  /** The non-geometry objects the batch read or wrote, for the per-object rebase rule. */
  touched: ObjectRef[];
};
const GEOMETRY_OPS = new Set(["node.move", "node.resize", "group.add", "group.update", "group.remove", "note.add", "note.update", "note.remove", "viewport.set", "layout.apply"]);
export const isGeometryOp = (op: WorkflowOp): boolean => GEOMETRY_OPS.has(op.op) || (op.op === "edge.update" && Object.keys(op.patch).every((key) => key === "route"));
const SECRET_NAME = /(secret|token|password|api[_-]?key)/i;

function schemaError(error: z.ZodError, prefix: string): WorkflowError {
  const issue = error.issues[0];
  const path = [prefix, ...issue.path.map(String)].filter(Boolean).join(".");
  const allowed = issue.code === "invalid_enum_value" ? ` Allowed: ${issue.options.join(", ")}.` : "";
  return new WorkflowError("WORKFLOW_SCHEMA_INVALID", `${path}: ${issue.message}.${allowed}`, { path, ...(issue.code === "invalid_enum_value" ? { allowed: issue.options } : {}) });
}
function parse<T extends z.ZodTypeAny>(schema: T, value: unknown, prefix: string): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw schemaError(parsed.error, prefix);
  return parsed.data;
}
function checkPosition(position: { x: number; y: number }): void {
  for (const value of [position.x, position.y]) {
    if (!Number.isFinite(value) || Math.abs(value) > WORKFLOW_LIMITS.positionMax) throw new WorkflowError("WORKFLOW_GEOMETRY_INVALID", `A position must be between −1,000,000 and 1,000,000; got ${value}.`, { value });
  }
}
const limit = (name: string, max: number, actual: number) => { if (actual > max) throw new WorkflowError("WORKFLOW_LIMIT_EXCEEDED", `A workflow holds at most ${max} ${name}.`, { limit: name, max, actual }); };

/** Checks an edge against the head: its ends, its kind, the types of its ports and the edges that already exist. */
export function checkEdge(doc: WorkflowDocument, edge: WorkflowEdge, ignoreEdgeId?: string): void {
  if (edge.from.node === edge.to.node) throw new WorkflowError("WORKFLOW_EDGE_SELF", "A step cannot be connected to itself.", { nodeId: edge.from.node });
  const source = doc.nodes.find((node) => node.id === edge.from.node), target = doc.nodes.find((node) => node.id === edge.to.node);
  if (!source || !target) throw new WorkflowError("WORKFLOW_SCHEMA_INVALID", `An edge names the step ${!source ? edge.from.node : edge.to.node}, which does not exist.`, { path: "edge" });
  const others = doc.edges.filter((other) => other.id !== ignoreEdgeId);
  if (others.some((other) => other.kind === edge.kind && other.from.node === edge.from.node && other.from.port === edge.from.port && other.to.node === edge.to.node && other.to.port === edge.to.port)) {
    throw new WorkflowError("WORKFLOW_EDGE_DUPLICATE", "These two ports are already connected.", { from: edge.from, to: edge.to });
  }
  if (edge.kind === "data" || edge.kind === "loop_back") {
    const out = dataPort(source, "out", edge.from.port), input = dataPort(target, "in", edge.to.port);
    if (!out || !input) {
      throw new WorkflowError("WORKFLOW_SCHEMA_INVALID", `The port ${!out ? `${source.id}.${edge.from.port}` : `${target.id}.${edge.to.port}`} does not exist.`, { path: "edge", allowedPorts: (!out ? source.outputs : target.inputs).map((entry) => entry.id) });
    }
    if (edge.kind === "loop_back" && !(target.type === "loop" && edge.to.port === "next")) throw new WorkflowError("WORKFLOW_LOOP_INVALID", "A loop-back edge ends at the next input of a Loop step.", { edgeId: edge.id });
    if (edge.kind === "data" && target.type === "loop" && edge.to.port === "next") throw new WorkflowError("WORKFLOW_LOOP_INVALID", "The next input of a Loop step takes a loop-back edge only.", { edgeId: edge.id });
    if (!typesCompatible(out.type, input.type)) {
      throw new WorkflowError("WORKFLOW_TYPE_MISMATCH", `${target.name} needs ${input.type}; ${source.name} produces ${out.type}`, { from: edge.from, to: edge.to, expected: input.type, actual: out.type });
    }
    const incoming = others.filter((other) => (other.kind === "data" || other.kind === "loop_back") && other.to.node === target.id && other.to.port === input.id).length;
    const mode = input.mode ?? "single";
    if (mode === "single" && incoming >= 1) throw new WorkflowError("WORKFLOW_PORT_OCCUPIED", `${target.name}.${input.label} already has a connection.`, { to: edge.to });
    if (mode !== "single" && incoming >= 16) throw new WorkflowError("WORKFLOW_LIMIT_EXCEEDED", "An input accepts at most 16 connections.", { limit: "portEdges", max: 16, actual: incoming + 1 });
  } else {
    const kind = inferEdgeKind(doc, edge.from, edge.to);
    if (kind !== edge.kind) throw new WorkflowError("WORKFLOW_SCHEMA_INVALID", `A ${edge.kind} edge runs from a ${edge.kind === "error" ? "step's error output" : "control output"} to a step's start.`, { path: "edge", allowedPorts: controlPorts(source).outputs });
  }
}

function finish(doc: WorkflowDocument): WorkflowDocument {
  limit("nodes", WORKFLOW_LIMITS.nodes, doc.nodes.length);
  limit("edges", WORKFLOW_LIMITS.edges, doc.edges.length);
  limit("groups", WORKFLOW_LIMITS.groups, doc.groups.length);
  limit("notes", WORKFLOW_LIMITS.notes, doc.notes.length);
  // The trigger's outputs follow the parameters, so a parameter is connectable as soon as it exists.
  const nodes = doc.nodes.map((node) => (node.type === "trigger" ? { ...node, outputs: derivedOutputs("trigger", node.config, doc)! } : node));
  const next = { ...doc, nodes };
  if (canonical(next).length > WORKFLOW_LIMITS.documentBytes) throw new WorkflowError("PAYLOAD_TOO_LARGE", "The workflow document would be larger than 768 KiB.", { limit: "documentBytes", max: WORKFLOW_LIMITS.documentBytes });
  return { ...next, graphHash: graphHash(next) };
}

/**
 * Applies a batch of graph operations atomically: every operation is validated structurally against the document as the
 * operations before it left it, and either all apply or the error of the first refused one is thrown with its index.
 * The result is not committed anywhere: the revision is the caller's.
 */
export function applyBatch(input: WorkflowDocument, ops: WorkflowOp[], options: { actor?: "device" | "agent" } = {}): BatchResult {
  if (ops.length < 1 || ops.length > WORKFLOW_LIMITS.batchOps) throw new WorkflowError("WORKFLOW_LIMIT_EXCEEDED", "A batch holds 1 to 200 operations.", { limit: "batchOps", max: WORKFLOW_LIMITS.batchOps, actual: ops.length });
  let doc = input;
  const inverse: WorkflowOp[] = [];
  const touched: ObjectRef[] = [];
  const undo = (...steps: WorkflowOp[]) => inverse.unshift(...steps);
  const nodeOf = (id: string): WorkflowNode => {
    const found = doc.nodes.find((node) => node.id === id);
    if (!found) throw new WorkflowError("NOT_FOUND", `There is no step ${id}.`, { nodeId: id });
    return found;
  };
  const replaceNode = (node: WorkflowNode) => { doc = { ...doc, nodes: doc.nodes.map((entry) => (entry.id === node.id ? node : entry)) }; };
  /** A list with an entry added at its place: the end, or the index an undo names. */
  const put = <T,>(list: T[], entry: T, at?: number): T[] => (at === undefined || at < 0 || at >= list.length ? [...list, entry] : [...list.slice(0, at), entry, ...list.slice(at)]);
  ops.forEach((op, opIndex) => {
    try {
      switch (op.op) {
        case "node.add": {
          const info = NODE_TYPES[op.node.type as keyof typeof NODE_TYPES];
          if (!info) parse(workflowNodeSchema, { ...op.node, name: "x", position: { x: 0, y: 0 } }, `nodes[${doc.nodes.length}]`);
          const defaults = info.defaults();
          const position = op.node.position ?? placeAlone(doc);
          checkPosition(position);
          const config = op.node.config ?? defaults.config;
          const node = parse(workflowNodeSchema, {
            name: info.label, description: "", inputs: defaults.inputs, ...op.node, config, outputs: derivedOutputs(op.node.type, config, doc) ?? op.node.outputs ?? defaults.outputs,
            position: { x: snap(position.x), y: snap(position.y) },
          }, `nodes[${doc.nodes.length}]`);
          if (doc.nodes.some((entry) => entry.id === node.id)) throw new WorkflowError("WORKFLOW_ID_DUPLICATE", `Two steps carry the id ${node.id}.`, { id: node.id });
          if (node.type === "trigger" && doc.nodes.some((entry) => entry.type === "trigger")) throw new WorkflowError("WORKFLOW_SCHEMA_INVALID", "A workflow has exactly one trigger.", { path: "nodes" });
          if (options.actor === "agent") node.protected = false;
          doc = { ...doc, nodes: put(doc.nodes, node, op.at) };
          touched.push({ kind: "node", id: node.id });
          undo({ op: "node.remove", id: node.id });
          break;
        }
        case "node.update": {
          const before = nodeOf(op.id);
          const patch = { ...op.patch };
          if (options.actor === "agent") delete patch.protected;
          const allowed = ["name", "description", "config", "inputs", "outputs", "timeout_s", "onError", "cache", "assign", "roleRequirement", "disabled", "protected"];
          const unknown = Object.keys(patch).find((key) => !allowed.includes(key));
          if (unknown) throw new WorkflowError("WORKFLOW_SCHEMA_INVALID", `A step's ${unknown} cannot be changed by an update.`, { path: `patch.${unknown}` });
          const merged = { ...before, ...patch };
          const derived = derivedOutputs(merged.type, merged.config, doc);
          const node = parse(workflowNodeSchema, derived ? { ...merged, outputs: derived } : merged, `nodes.${op.id}`);
          for (const side of ["inputs", "outputs"] as const) {
            const ids = node[side].map((entry) => entry.id);
            const twice = ids.find((id, index) => ids.indexOf(id) !== index);
            if (twice) throw new WorkflowError("WORKFLOW_ID_DUPLICATE", `Two ports of ${node.name} carry the id ${twice}.`, { id: twice, nodeId: node.id });
          }
          if (node.inputs.length + node.outputs.length > WORKFLOW_LIMITS.ports) throw new WorkflowError("WORKFLOW_LIMIT_EXCEEDED", "A step has at most 32 ports.", { limit: "ports", max: 32, actual: node.inputs.length + node.outputs.length });
          replaceNode(node);
          const edgesBefore = doc.edges;
          // Edges of a removed port, or of a branch case that no longer exists, go with it; the inverse puts them back.
          const control = controlPorts(node);
          const gone = doc.edges.filter((edge) =>
            (edge.from.node === node.id && !(dataPort(node, "out", edge.from.port) || control.outputs.includes(edge.from.port))) ||
            (edge.to.node === node.id && !(dataPort(node, "in", edge.to.port) || control.inputs.includes(edge.to.port))));
          if (gone.length) doc = { ...doc, edges: doc.edges.filter((edge) => !gone.includes(edge)) };
          touched.push({ kind: "node", id: node.id }, ...gone.map((edge) => ({ kind: "edge" as const, id: edge.id })));
          const restore: Record<string, unknown> = {};
          for (const key of Object.keys(patch)) restore[key] = (before as Record<string, unknown>)[key];
          if (derived) restore.outputs = before.outputs;
          undo({ op: "node.update", id: op.id, patch: restore as never }, ...gone.map((edge) => ({ op: "edge.add" as const, edge, at: edgesBefore.indexOf(edge) })));
          break;
        }
        case "node.move": {
          const before = nodeOf(op.id);
          checkPosition(op.position);
          replaceNode({ ...before, position: { x: snap(op.position.x), y: snap(op.position.y) } });
          undo({ op: "node.move", id: op.id, position: before.position });
          break;
        }
        case "node.resize": {
          const before = nodeOf(op.id);
          const { size: _size, ...bare } = before;
          const node = parse(workflowNodeSchema, op.size ? { ...before, size: { width: Math.round(op.size.width), height: Math.round(op.size.height) } } : bare, `nodes.${op.id}`);
          replaceNode(node);
          undo({ op: "node.resize", id: op.id, size: before.size ?? null });
          break;
        }
        case "node.remove": {
          const before = nodeOf(op.id);
          if (before.type === "trigger") throw new WorkflowError("WORKFLOW_TRIGGER_REQUIRED", "A workflow keeps its trigger.", { nodeId: op.id });
          const edges = doc.edges.filter((edge) => edge.from.node === op.id || edge.to.node === op.id);
          const groups = doc.groups.filter((group) => group.nodeIds.includes(op.id));
          const at = doc.nodes.indexOf(before), edgesBefore = doc.edges, groupsBefore = doc.groups, outputsBefore = doc.outputs;
          doc = {
            ...doc, nodes: doc.nodes.filter((node) => node.id !== op.id), edges: doc.edges.filter((edge) => !edges.includes(edge)),
            groups: doc.groups.map((group) => (group.nodeIds.includes(op.id) ? { ...group, nodeIds: group.nodeIds.filter((id) => id !== op.id) } : group)).filter((group) => group.nodeIds.length > 0),
            outputs: doc.outputs.filter((output) => output.from.node !== op.id),
          };
          touched.push({ kind: "node", id: op.id }, ...edges.map((edge) => ({ kind: "edge" as const, id: edge.id })));
          undo({ op: "node.add", node: before, at }, ...edges.map((edge) => ({ op: "edge.add" as const, edge, at: edgesBefore.indexOf(edge) })),
            ...groups.map((group) => (doc.groups.some((entry) => entry.id === group.id) ? { op: "group.update" as const, id: group.id, patch: { nodeIds: group.nodeIds } } : { op: "group.add" as const, group, at: groupsBefore.indexOf(group) })),
            ...(outputsBefore.some((output) => output.from.node === op.id) ? [{ op: "output.set" as const, outputs: outputsBefore }] : []));
          break;
        }
        case "edge.add": {
          const kind = op.edge.kind ?? inferEdgeKind(doc, op.edge.from, op.edge.to);
          if (!kind) {
            const source = doc.nodes.find((node) => node.id === op.edge.from.node), target = doc.nodes.find((node) => node.id === op.edge.to.node);
            if (source && target && op.edge.from.node === op.edge.to.node) throw new WorkflowError("WORKFLOW_EDGE_SELF", "A step cannot be connected to itself.", { nodeId: source.id });
            throw new WorkflowError("WORKFLOW_SCHEMA_INVALID", "These two ports cannot be connected: one of them does not exist.", {
              path: "edge", ...(source ? { allowedPorts: [...source.outputs.map((entry) => entry.id), ...controlPorts(source).outputs] } : {}),
            });
          }
          const edge = parse(workflowEdgeSchema, { ...op.edge, kind }, `edges[${doc.edges.length}]`);
          if (doc.edges.some((entry) => entry.id === edge.id)) throw new WorkflowError("WORKFLOW_ID_DUPLICATE", `Two edges carry the id ${edge.id}.`, { id: edge.id });
          checkEdge(doc, edge);
          doc = { ...doc, edges: put(doc.edges, edge, op.at) };
          touched.push({ kind: "edge", id: edge.id }, { kind: "node", id: edge.from.node }, { kind: "node", id: edge.to.node });
          undo({ op: "edge.remove", id: edge.id });
          break;
        }
        case "edge.update": {
          const before = doc.edges.find((edge) => edge.id === op.id);
          if (!before) throw new WorkflowError("NOT_FOUND", `There is no edge ${op.id}.`, { edgeId: op.id });
          const edge = parse(workflowEdgeSchema, { ...before, ...(op.patch.label !== undefined ? { label: op.patch.label } : {}), ...(op.patch.route ? { route: op.patch.route } : {}) }, `edges.${op.id}`);
          doc = { ...doc, edges: doc.edges.map((entry) => (entry.id === op.id ? edge : entry)) };
          if (op.patch.label !== undefined) touched.push({ kind: "edge", id: op.id });
          undo({ op: "edge.update", id: op.id, patch: { label: before.label, route: before.route } });
          break;
        }
        case "edge.remove": {
          const before = doc.edges.find((edge) => edge.id === op.id);
          if (!before) throw new WorkflowError("NOT_FOUND", `There is no edge ${op.id}.`, { edgeId: op.id });
          undo({ op: "edge.add", edge: before, at: doc.edges.indexOf(before) });
          doc = { ...doc, edges: doc.edges.filter((edge) => edge.id !== op.id) };
          touched.push({ kind: "edge", id: op.id });
          break;
        }
        case "group.add": {
          const group = parse(workflowGroupSchema, op.group, "groups");
          if (doc.groups.some((entry) => entry.id === group.id)) throw new WorkflowError("WORKFLOW_ID_DUPLICATE", `Two groups carry the id ${group.id}.`, { id: group.id });
          const before = doc.groups;
          // A step belongs to at most one group: it leaves the group it was in.
          doc = { ...doc, groups: put(doc.groups.map((entry) => ({ ...entry, nodeIds: entry.nodeIds.filter((id) => !group.nodeIds.includes(id)) })), group, op.at) };
          undo({ op: "group.remove", id: group.id }, ...before.filter((entry) => entry.nodeIds.some((id) => group.nodeIds.includes(id))).map((entry) => ({ op: "group.update" as const, id: entry.id, patch: { nodeIds: entry.nodeIds } })));
          break;
        }
        case "group.update": {
          const before = doc.groups.find((group) => group.id === op.id);
          if (!before) throw new WorkflowError("NOT_FOUND", `There is no group ${op.id}.`, { id: op.id });
          const group = parse(workflowGroupSchema, { ...before, ...op.patch }, `groups.${op.id}`);
          const others = doc.groups.filter((entry) => entry.id !== op.id);
          doc = { ...doc, groups: doc.groups.map((entry) => (entry.id === op.id ? group : { ...entry, nodeIds: entry.nodeIds.filter((id) => !group.nodeIds.includes(id)) })) };
          undo({ op: "group.update", id: op.id, patch: before }, ...others.filter((entry) => entry.nodeIds.some((id) => group.nodeIds.includes(id))).map((entry) => ({ op: "group.update" as const, id: entry.id, patch: { nodeIds: entry.nodeIds } })));
          break;
        }
        case "group.remove": {
          const before = doc.groups.find((group) => group.id === op.id);
          if (!before) throw new WorkflowError("NOT_FOUND", `There is no group ${op.id}.`, { id: op.id });
          undo({ op: "group.add", group: before, at: doc.groups.indexOf(before) });
          doc = { ...doc, groups: doc.groups.filter((group) => group.id !== op.id) };
          break;
        }
        case "note.add": {
          const note = parse(workflowNoteSchema, op.note, "notes");
          if (doc.notes.some((entry) => entry.id === note.id)) throw new WorkflowError("WORKFLOW_ID_DUPLICATE", `Two notes carry the id ${note.id}.`, { id: note.id });
          checkPosition(note);
          doc = { ...doc, notes: put(doc.notes, note, op.at) };
          undo({ op: "note.remove", id: note.id });
          break;
        }
        case "note.update": {
          const before = doc.notes.find((note) => note.id === op.id);
          if (!before) throw new WorkflowError("NOT_FOUND", `There is no note ${op.id}.`, { id: op.id });
          const note = parse(workflowNoteSchema, { ...before, ...op.patch }, `notes.${op.id}`);
          checkPosition(note);
          doc = { ...doc, notes: doc.notes.map((entry) => (entry.id === op.id ? note : entry)) };
          undo({ op: "note.update", id: op.id, patch: before });
          break;
        }
        case "note.remove": {
          const before = doc.notes.find((note) => note.id === op.id);
          if (!before) throw new WorkflowError("NOT_FOUND", `There is no note ${op.id}.`, { id: op.id });
          undo({ op: "note.add", note: before, at: doc.notes.indexOf(before) });
          doc = { ...doc, notes: doc.notes.filter((note) => note.id !== op.id) };
          break;
        }
        case "param.set": {
          const parameters = parse(z.array(workflowParameterSchema).max(WORKFLOW_LIMITS.parameters), op.parameters, "parameters");
          const secret = parameters.find((param) => SECRET_NAME.test(param.name));
          if (secret) throw new WorkflowError("WORKFLOW_PARAM_SECRET", "Secrets are configured in host settings, not in workflows", { param: secret.name });
          const names = parameters.map((param) => param.name);
          const twice = names.find((name, index) => names.indexOf(name) !== index);
          if (twice) throw new WorkflowError("WORKFLOW_ID_DUPLICATE", `Two parameters carry the name ${twice}.`, { id: twice });
          const before = doc.parameters, edgesBefore = doc.edges;
          const trigger = doc.nodes.find((node) => node.type === "trigger");
          // The trigger's outputs follow the parameters at once, so a later operation of the batch can connect one.
          doc = { ...doc, parameters, nodes: doc.nodes.map((node) => (node.type === "trigger" ? { ...node, outputs: derivedOutputs("trigger", node.config, { parameters })! } : node)) };
          // Edges from the output of a parameter that no longer exists go with it.
          const kept = new Set(["params", "trigger", ...names]);
          if (trigger) doc = { ...doc, edges: doc.edges.filter((edge) => edge.from.node !== trigger.id || edge.kind !== "data" || kept.has(edge.from.port)) };
          touched.push({ kind: "section", id: "parameters" });
          undo({ op: "param.set", parameters: before }, ...edgesBefore.filter((edge) => !doc.edges.includes(edge)).map((edge) => ({ op: "edge.add" as const, edge, at: edgesBefore.indexOf(edge) })));
          break;
        }
        case "var.set": {
          const variables = parse(workflowDocumentSchema.shape.variables, op.variables, "variables");
          touched.push({ kind: "section", id: "variables" });
          undo({ op: "var.set", variables: doc.variables });
          doc = { ...doc, variables };
          break;
        }
        case "output.set": {
          const outputs = parse(workflowDocumentSchema.shape.outputs, op.outputs, "outputs");
          for (const output of outputs) if (!dataPort(nodeOf(output.from.node), "out", output.from.port)) throw new WorkflowError("WORKFLOW_SCHEMA_INVALID", `The output ${output.name} names a port that does not exist.`, { path: `outputs.${output.name}` });
          touched.push({ kind: "section", id: "outputs" });
          undo({ op: "output.set", outputs: doc.outputs });
          doc = { ...doc, outputs };
          break;
        }
        case "settings.update": {
          const settings = parse(workflowDocumentSchema.shape.settings, { ...doc.settings, ...op.patch }, "settings");
          touched.push({ kind: "section", id: "settings" });
          undo({ op: "settings.update", patch: doc.settings });
          doc = { ...doc, settings };
          break;
        }
        case "meta.update": {
          const name = op.patch.name === undefined ? doc.name : parse(z.string().trim().min(1).max(80), op.patch.name, "name");
          const description = op.patch.description === undefined ? doc.description : parse(z.string().max(1000), op.patch.description, "description");
          undo({ op: "meta.update", patch: { name: doc.name, description: doc.description } });
          doc = { ...doc, name, description };
          break;
        }
        case "viewport.set": {
          const viewport = parse(workflowDocumentSchema.shape.viewport, op.viewport, "viewport");
          undo({ op: "viewport.set", viewport: doc.viewport });
          doc = { ...doc, viewport };
          break;
        }
        case "layout.apply": {
          const before: Record<string, { x: number; y: number }> = {};
          const routes: Record<string, WorkflowEdge["route"]> = {};
          for (const [id, position] of Object.entries(op.positions)) {
            const node = doc.nodes.find((entry) => entry.id === id);
            if (!node) continue;
            checkPosition(position);
            before[id] = node.position;
            replaceNode({ ...node, position: { x: snap(position.x), y: snap(position.y) } });
          }
          for (const [id, route] of Object.entries(op.routes ?? {})) {
            const edge = doc.edges.find((entry) => entry.id === id);
            if (!edge) continue;
            routes[id] = edge.route;
            doc = { ...doc, edges: doc.edges.map((entry) => (entry.id === id ? { ...entry, route } : entry)) };
          }
          // Group frames follow their members: the bounding box plus 24 units of padding.
          const groupsBefore = doc.groups;
          doc = { ...doc, groups: doc.groups.map((group) => ({ ...group, frame: frameOf(doc, group.nodeIds) ?? group.frame })) };
          undo({ op: "layout.apply", positions: before, routes }, ...groupsBefore.filter((group, index) => canonical(group.frame) !== canonical(doc.groups[index].frame)).map((group) => ({ op: "group.update" as const, id: group.id, patch: { frame: group.frame } })));
          break;
        }
        default:
          throw new WorkflowError("WORKFLOW_SCHEMA_INVALID", `Unknown operation ${(op as { op: string }).op}.`, { path: "op" });
      }
    } catch (error) {
      if (error instanceof WorkflowError) throw new WorkflowError(error.code, error.message, { ...error.details, opIndex });
      throw error;
    }
  });
  return { doc: finish(doc), inverse, touched };
}

/** The bounding box of some steps plus 24 units of padding. */
export function frameOf(doc: Pick<WorkflowDocument, "nodes">, nodeIds: string[]): { x: number; y: number; width: number; height: number } | undefined {
  const members = doc.nodes.filter((node) => nodeIds.includes(node.id));
  if (!members.length) return undefined;
  const left = Math.min(...members.map((node) => node.position.x)), top = Math.min(...members.map((node) => node.position.y));
  const right = Math.max(...members.map((node) => node.position.x + cardWidth(node))), bottom = Math.max(...members.map((node) => node.position.y + nodeBox(node).height));
  // Room on every side, and more above for the title of the container.
  return { x: left - 24, y: top - 48, width: right - left + 48, height: bottom - top + 72 };
}

/** Where a step added without a position goes: 320 units right of the right-most step (a card and 80 of room), in the first free row. */
export function placeAlone(doc: Pick<WorkflowDocument, "nodes">, after?: string): { x: number; y: number } {
  const anchor = doc.nodes.find((node) => node.id === after);
  const x = anchor ? anchor.position.x + 320 : doc.nodes.length ? Math.max(...doc.nodes.map((node) => node.position.x)) + 320 : 120;
  let y = anchor ? anchor.position.y : 200;
  while (doc.nodes.some((node) => Math.abs(node.position.x - x) < 300 && y < node.position.y + nodeBox(node).height + 56 && y + 104 + 56 > node.position.y)) y += 20;
  return { x: snap(x), y: snap(y) };
}

/**
 * The per-object rebase rule: which operations of a batch based on an older revision conflict with what changed since.
 * `changed` maps an object to the revision that last changed it after the batch's base.
 */
export function conflictsOf(ops: WorkflowOp[], changed: (ref: ObjectRef) => number | undefined): Array<{ opIndex: number; kind: ObjectRef["kind"]; id: string; changedInRevision: number }> {
  const conflicts: Array<{ opIndex: number; kind: ObjectRef["kind"]; id: string; changedInRevision: number }> = [];
  ops.forEach((op, opIndex) => {
    if (isGeometryOp(op)) return;
    const refs: ObjectRef[] =
      op.op === "node.update" || op.op === "node.remove" ? [{ kind: "node", id: op.id }]
      : op.op === "edge.update" || op.op === "edge.remove" ? [{ kind: "edge", id: op.id }]
      : op.op === "param.set" ? [{ kind: "section", id: "parameters" }] : op.op === "var.set" ? [{ kind: "section", id: "variables" }]
      : op.op === "output.set" ? [{ kind: "section", id: "outputs" }] : op.op === "settings.update" ? [{ kind: "section", id: "settings" }] : [];
    for (const ref of refs) {
      const revision = changed(ref);
      if (revision !== undefined) conflicts.push({ opIndex, kind: ref.kind, id: ref.id, changedInRevision: revision });
    }
  });
  return conflicts;
}
