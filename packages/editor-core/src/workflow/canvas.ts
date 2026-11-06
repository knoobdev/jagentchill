import type { WorkflowDocument, WorkflowEdge, WorkflowGroup, WorkflowNode, WorkflowNodeType, WorkflowNote, WorkflowOp } from "@jagentchill/protocol";
import { z } from "zod";
import { workflowEdgeSchema, workflowGroupSchema, workflowNodeSchema, workflowNoteSchema } from "@jagentchill/protocol";
import { analyse } from "./graph.ts";
import { WorkflowError, dataPort, inferEdgeKind, makeNode, nextEdgeId, nextNodeId, sizeOf, snap, typesCompatible } from "./nodes.ts";
import { frameOf } from "./ops.ts";
import { connectionProblem } from "./validate.ts";

/** What each gesture on the canvas means as a batch of graph operations. Every function is pure: it reads the head and returns operations. */
export type Selection = { nodeIds: string[]; edgeIds?: string[]; noteIds?: string[]; groupIds?: string[] };
export type Fragment = { format: "jagentchill.workflow.fragment"; nodes: WorkflowNode[]; edges: WorkflowEdge[]; groups: WorkflowGroup[]; notes: WorkflowNote[] };
const fragmentSchema = z.object({ format: z.literal("jagentchill.workflow.fragment"), nodes: z.array(workflowNodeSchema).max(200), edges: z.array(workflowEdgeSchema).max(400), groups: z.array(workflowGroupSchema).max(50).default([]), notes: z.array(workflowNoteSchema).max(100).default([]) }).strict();

/** Drop a node type on empty canvas. */
export function addNodeOps(doc: WorkflowDocument, type: WorkflowNodeType, position: { x: number; y: number }): { ops: WorkflowOp[]; nodeId: string } {
  const node = makeNode(doc, type, position);
  return { ops: [{ op: "node.add", node }], nodeId: node.id };
}

/** Drop a node type on an edge: the edge is replaced by two edges through the node's first compatible input and output. */
export function insertOnEdgeOps(doc: WorkflowDocument, type: WorkflowNodeType, edgeId: string, position: { x: number; y: number }): { ops: WorkflowOp[]; nodeId: string } {
  const edge = doc.edges.find((entry) => entry.id === edgeId);
  if (!edge) throw new WorkflowError("NOT_FOUND", "There is no such connection.", { edgeId });
  const node = makeNode(doc, type, position);
  const source = doc.nodes.find((entry) => entry.id === edge.from.node)!, target = doc.nodes.find((entry) => entry.id === edge.to.node)!;
  let into = "start", outOf = "done";
  if (edge.kind === "data") {
    const out = dataPort(source, "out", edge.from.port)!, input = dataPort(target, "in", edge.to.port)!;
    const first = node.inputs.find((entry) => typesCompatible(out.type, entry.type)), last = node.outputs.find((entry) => typesCompatible(entry.type, input.type));
    if (!first || !last) throw new WorkflowError("WORKFLOW_TYPE_MISMATCH", `${node.name} has no input and output that fit this connection.`, { expected: input.type, actual: out.type });
    into = first.id; outOf = last.id;
  } else if (edge.kind !== "control") throw new WorkflowError("WORKFLOW_TYPE_MISMATCH", "A step can be inserted on a data or control connection only.", { edgeId });
  const first = nextEdgeId(doc), second = nextEdgeId(doc, new Set([first]));
  return {
    nodeId: node.id,
    ops: [{ op: "edge.remove", id: edge.id }, { op: "node.add", node }, { op: "edge.add", edge: { id: first, kind: edge.kind, from: edge.from, to: { node: node.id, port: into } } }, { op: "edge.add", edge: { id: second, kind: edge.kind, from: { node: node.id, port: outOf }, to: edge.to } }],
  };
}

/** Connect two ports. An occupied single input is refused unless `replace` is set, which removes the old edge in the same batch. */
export function connectOps(doc: WorkflowDocument, from: WorkflowEdge["from"], to: WorkflowEdge["to"], options: { replace?: boolean } = {}): { ops: WorkflowOp[]; edgeId: string } {
  let problem = connectionProblem(doc, analyse(doc), from, to);
  const ops: WorkflowOp[] = [];
  if (problem === "WORKFLOW_PORT_OCCUPIED" && options.replace) {
    for (const edge of doc.edges) if (edge.to.node === to.node && edge.to.port === to.port && (edge.kind === "data" || edge.kind === "loop_back")) ops.push({ op: "edge.remove", id: edge.id });
    problem = undefined;
  }
  if (problem) throw new WorkflowError(problem, CONNECTION_MESSAGES[problem] ?? "These two ports cannot be connected.", { from, to });
  const kind = inferEdgeKind(doc, from, to);
  if (!kind) throw new WorkflowError("WORKFLOW_TYPE_MISMATCH", CONNECTION_MESSAGES.WORKFLOW_TYPE_MISMATCH, { from, to });
  const edgeId = nextEdgeId(doc);
  return { ops: [...ops, { op: "edge.add", edge: { id: edgeId, kind, from, to } }], edgeId };
}
export const CONNECTION_MESSAGES: Record<string, string> = {
  WORKFLOW_TYPE_MISMATCH: "These two ports carry different kinds of data", WORKFLOW_PORT_OCCUPIED: "This input already has a connection",
  WORKFLOW_CYCLE: "This connection would create a loop — use a Loop node", WORKFLOW_BODY_NOT_CLOSED: "This connection would leave a loop or parallel body",
  WORKFLOW_EDGE_SELF: "A step cannot be connected to itself", WORKFLOW_EDGE_DUPLICATE: "These two ports are already connected", WORKFLOW_LIMIT_EXCEEDED: "This workflow has as many connections as it can hold",
};
/** Drop a connection on a node body: its first compatible free input. */
export function firstCompatibleInput(doc: WorkflowDocument, from: WorkflowEdge["from"], targetId: string): string | undefined {
  const target = doc.nodes.find((node) => node.id === targetId);
  if (!target) return undefined;
  const graph = analyse(doc);
  return [...target.inputs.map((input) => input.id), "start"].find((port) => !connectionProblem(doc, graph, from, { node: targetId, port }));
}

/** Delete a selection: the nodes with their edges, the selected edges and notes. The trigger is never removed. */
export function deleteOps(doc: WorkflowDocument, selection: Selection): WorkflowOp[] {
  const nodes = selection.nodeIds.filter((id) => doc.nodes.find((node) => node.id === id)?.type !== "trigger");
  const gone = new Set(nodes);
  return [
    ...(selection.edgeIds ?? []).filter((id) => { const edge = doc.edges.find((entry) => entry.id === id); return edge && !gone.has(edge.from.node) && !gone.has(edge.to.node); }).map((id) => ({ op: "edge.remove" as const, id })),
    ...nodes.map((id) => ({ op: "node.remove" as const, id })),
    ...(selection.noteIds ?? []).filter((id) => doc.notes.some((note) => note.id === id)).map((id) => ({ op: "note.remove" as const, id })),
    ...(selection.groupIds ?? []).filter((id) => doc.groups.some((group) => group.id === id)).map((id) => ({ op: "group.remove" as const, id })),
  ];
}

/** Copy: the selected nodes, the edges between them, their groups and the selected notes. Never a trigger, never run data. */
export function copyFragment(doc: WorkflowDocument, selection: Selection): Fragment {
  const nodes = doc.nodes.filter((node) => selection.nodeIds.includes(node.id) && node.type !== "trigger");
  const ids = new Set(nodes.map((node) => node.id));
  return {
    format: "jagentchill.workflow.fragment", nodes, edges: doc.edges.filter((edge) => ids.has(edge.from.node) && ids.has(edge.to.node)),
    groups: doc.groups.filter((group) => group.nodeIds.length > 0 && group.nodeIds.every((id) => ids.has(id))), notes: doc.notes.filter((note) => selection.noteIds?.includes(note.id)),
  };
}
export function parseFragment(text: string): Fragment | undefined {
  try { const parsed = fragmentSchema.safeParse(JSON.parse(text)); return parsed.success ? (parsed.data as Fragment) : undefined; } catch { return undefined; }
}

/** Paste: new ids, positions offset by (40, 40) from the source or centred on a point, edges only between pasted nodes. */
export function pasteOps(doc: WorkflowDocument, fragment: Fragment, at?: { x: number; y: number }): { ops: WorkflowOp[]; nodeIds: string[] } {
  const nodes = fragment.nodes.filter((node) => node.type !== "trigger");
  if (!nodes.length && !fragment.notes.length) return { ops: [], nodeIds: [] };
  const frame = frameOf({ nodes }, nodes.map((node) => node.id));
  const delta = at && frame ? { x: snap(at.x - (frame.x + frame.width / 2)), y: snap(at.y - (frame.y + frame.height / 2)) } : { x: 40, y: 40 };
  const taken = new Set<string>(), ids = new Map<string, string>();
  for (const node of nodes) { const id = nextNodeId(doc, node.id.replace(/_\d+$/, ""), taken); taken.add(id); ids.set(node.id, id); }
  const ops: WorkflowOp[] = nodes.map((node) => ({
    op: "node.add" as const,
    node: { ...node, id: ids.get(node.id)!, protected: false, position: { x: node.position.x + delta.x, y: node.position.y + delta.y }, config: node.type === "parallel" ? { ...node.config, joinId: ids.get(String(node.config.joinId)) ?? "" } : node.type === "join" ? { ...node.config, parallelId: ids.get(String(node.config.parallelId)) ?? "" } : node.config },
  }));
  const edgeIds = new Set<string>();
  for (const edge of fragment.edges) {
    if (!ids.has(edge.from.node) || !ids.has(edge.to.node)) continue;
    const id = nextEdgeId(doc, edgeIds);
    edgeIds.add(id);
    ops.push({ op: "edge.add", edge: { ...edge, id, from: { ...edge.from, node: ids.get(edge.from.node)! }, to: { ...edge.to, node: ids.get(edge.to.node)! }, route: { style: edge.route.style, waypoints: [], labelT: edge.route.labelT } } });
  }
  const groupIds = new Set(doc.groups.map((group) => group.id));
  for (const group of fragment.groups) {
    let id = group.id;
    for (let index = 2; groupIds.has(id); index++) id = `${group.id}_${index}`;
    groupIds.add(id);
    ops.push({ op: "group.add", group: { ...group, id, nodeIds: group.nodeIds.map((entry) => ids.get(entry)!).filter(Boolean), frame: { ...group.frame, x: group.frame.x + delta.x, y: group.frame.y + delta.y } } });
  }
  const noteIds = new Set(doc.notes.map((note) => note.id));
  for (const note of fragment.notes) {
    let id = note.id;
    for (let index = 2; noteIds.has(id); index++) id = `${note.id}_${index}`;
    noteIds.add(id);
    ops.push({ op: "note.add", note: { ...note, id, x: note.x + delta.x, y: note.y + delta.y } });
  }
  return { ops, nodeIds: [...ids.values()] };
}
export const duplicateOps = (doc: WorkflowDocument, selection: Selection) => pasteOps(doc, copyFragment(doc, selection));

/** Move a selection by a distance; positions land on the 20-unit grid. */
export function moveOps(doc: WorkflowDocument, nodeIds: string[], dx: number, dy: number): WorkflowOp[] {
  return doc.nodes.filter((node) => nodeIds.includes(node.id)).map((node) => ({ op: "node.move" as const, id: node.id, position: { x: snap(node.position.x + dx), y: snap(node.position.y + dy) } }))
    .filter((op) => { const node = doc.nodes.find((entry) => entry.id === op.id)!; return node.position.x !== op.position.x || node.position.y !== op.position.y; });
}
export type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom" | "distribute-h" | "distribute-v";
export function alignOps(doc: WorkflowDocument, nodeIds: string[], mode: AlignMode): WorkflowOp[] {
  const nodes = doc.nodes.filter((node) => nodeIds.includes(node.id));
  if (nodes.length < 2) return [];
  const box = (node: WorkflowNode) => ({ x: node.position.x, y: node.position.y, ...sizeOf(node) });
  const left = Math.min(...nodes.map((node) => node.position.x)), top = Math.min(...nodes.map((node) => node.position.y));
  const right = Math.max(...nodes.map((node) => box(node).x + box(node).width)), bottom = Math.max(...nodes.map((node) => box(node).y + box(node).height));
  const target = new Map<string, { x: number; y: number }>();
  if (mode === "distribute-h" || mode === "distribute-v") {
    const axis = mode === "distribute-h" ? "x" : "y";
    const sorted = [...nodes].sort((a, b) => a.position[axis] - b.position[axis] || (a.id < b.id ? -1 : 1));
    const first = sorted[0].position[axis], last = sorted.at(-1)!.position[axis];
    sorted.forEach((node, index) => target.set(node.id, { ...node.position, [axis]: first + ((last - first) * index) / (sorted.length - 1) }));
  } else for (const node of nodes) {
    const size = sizeOf(node);
    target.set(node.id, mode === "left" ? { x: left, y: node.position.y } : mode === "right" ? { x: right - size.width, y: node.position.y } : mode === "center" ? { x: (left + right) / 2 - size.width / 2, y: node.position.y }
      : mode === "top" ? { x: node.position.x, y: top } : mode === "bottom" ? { x: node.position.x, y: bottom - size.height } : { x: node.position.x, y: (top + bottom) / 2 - size.height / 2 });
  }
  return nodes.map((node) => ({ op: "node.move" as const, id: node.id, position: { x: snap(target.get(node.id)!.x), y: snap(target.get(node.id)!.y) } })).filter((op) => { const node = nodes.find((entry) => entry.id === op.id)!; return node.position.x !== op.position.x || node.position.y !== op.position.y; });
}
/** Group a selection: one frame around its members. */
export function groupOps(doc: WorkflowDocument, nodeIds: string[], label = "Group"): WorkflowOp[] {
  const frame = frameOf(doc, nodeIds);
  if (!frame) return [];
  let id = "group";
  for (let index = 2; doc.groups.some((group) => group.id === id); index++) id = `group_${index}`;
  return [{ op: "group.add", group: { id, label, colorIndex: (doc.groups.length % 8) + 1, nodeIds: doc.nodes.filter((node) => nodeIds.includes(node.id)).map((node) => node.id), frame, collapsed: false } }];
}
export function noteOps(doc: WorkflowDocument, at: { x: number; y: number }): { ops: WorkflowOp[]; noteId: string } {
  let id = "note";
  for (let index = 2; doc.notes.some((note) => note.id === id); index++) id = `note_${index}`;
  return { noteId: id, ops: [{ op: "note.add", note: { id, text: "", x: snap(at.x), y: snap(at.y), width: 200, height: 100 } }] };
}

/** Undo and redo of one device for one workflow: inverse batches against the head, 100 steps. */
export class UndoStack {
  private done: Array<{ label: string; inverse: WorkflowOp[]; forward: WorkflowOp[] }> = [];
  private undone: Array<{ label: string; inverse: WorkflowOp[]; forward: WorkflowOp[] }> = [];
  push(entry: { label: string; inverse: WorkflowOp[]; forward: WorkflowOp[] }): void {
    this.done.push(entry);
    if (this.done.length > 100) this.done.shift();
    this.undone = [];
  }
  get canUndo(): boolean { return this.done.length > 0; }
  get canRedo(): boolean { return this.undone.length > 0; }
  /** The batch that undoes the last step. The caller reports whether it applied: a refused inverse leaves the stack. */
  takeUndo() { return this.done.pop(); }
  takeRedo() { return this.undone.pop(); }
  /** After an undo applied: the step can be redone with the inverse of what the undo did. */
  undoApplied(entry: { label: string; forward: WorkflowOp[] }, inverseOfUndo: WorkflowOp[]): void { this.undone.push({ label: entry.label, forward: entry.forward, inverse: inverseOfUndo }); }
  redoApplied(entry: { label: string; forward: WorkflowOp[] }, inverse: WorkflowOp[]): void { this.done.push({ label: entry.label, forward: entry.forward, inverse }); }
}
