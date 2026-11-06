import type { WorkflowDocument, WorkflowEdge, WorkflowOp } from "@jagentchill/protocol";
import { analyse } from "./graph.ts";
import { bodyFrames, bodyHeight, nodeBox, placeNotes, settleNotes } from "./geometry.ts";
import { cardWidth, snap } from "./nodes.ts";
import { frameOf } from "./ops.ts";

export const LAYER_PITCH = 320;
/** The least room between the cards of two layers: a layer of wide cards pushes the next one further. */
export const LAYER_GAP = 80;
/** The least room between two cards of a layer. */
export const ROW_GAP = 56;
/** The rows of a layer of plain cards are this far apart. */
export const ROW_PITCH = 160;
const ORIGIN = { x: 120, y: 120 };

/**
 * Deterministic auto-layout: layers left to right by longest-path depth, rows ordered by the median row of the
 * predecessors (ties by id) and centred on one lane, targets of error routes below every other row of their layer, everything on the 20-unit
 * grid, every route reset. Layers are 320 apart and the cards of a layer 56 apart, and further where a layer holds cards grown wide by a long name, so no two cards touch. A pure function of the graph, so it is idempotent and equal on every platform.
 */
export function layout(doc: Pick<WorkflowDocument, "nodes" | "edges">, scope: "all" | string[] = "all"): { positions: Record<string, { x: number; y: number }>; routes: Record<string, WorkflowEdge["route"]> } {
  const graph = analyse(doc);
  const layers = new Map<number, string[]>();
  for (const node of doc.nodes) {
    const depth = graph.depth.get(node.id) ?? 0;
    layers.set(depth, [...(layers.get(depth) ?? []), node.id]);
  }
  const errorTargets = new Set(doc.edges.filter((edge) => edge.kind === "error").map((edge) => edge.to.node));
  const row = new Map<string, number>();
  const positions: Record<string, { x: number; y: number }> = {};
  // Every layer is centred on one lane, so a plain chain runs level and branches fan out around it. A layer of one
  // card puts the middle of that card's body on the lane: its edges run straight whatever rows the card carries.
  const heightOf = new Map(doc.nodes.map((node) => [node.id, { box: nodeBox(node).height, body: bodyHeight(node) }]));
  const span = (ids: string[]): number => ids.reduce((sum, id) => sum + (heightOf.get(id)?.box ?? 0), 0) + (ids.length - 1) * ROW_GAP;
  const lane = ORIGIN.y + Math.max(...[...layers.values()].map((ids) => (ids.length > 1 ? span(ids) : (heightOf.get(ids[0])?.body ?? 0))), 0) / 2;
  const widthOf = new Map(doc.nodes.map((node) => [node.id, cardWidth(node)]));
  let x = ORIGIN.x, previous = -1;
  for (const depth of [...layers.keys()].sort((a, b) => a - b)) {
    if (previous >= 0) x += Math.max(LAYER_PITCH, snap(Math.max(...layers.get(previous)!.map((id) => widthOf.get(id) ?? 0)) + LAYER_GAP)) + (depth - previous - 1) * LAYER_PITCH;
    previous = depth;
    const column = x;
    const median = (id: string): number => {
      const rows = (graph.in.get(id) ?? []).map((edge) => row.get(edge.from.node)).filter((value): value is number => value !== undefined).sort((a, b) => a - b);
      return rows.length ? rows[Math.floor((rows.length - 1) / 2)] : 0;
    };
    const ordered = layers.get(depth)!.sort((a, b) => Number(errorTargets.has(a)) - Number(errorTargets.has(b)) || median(a) - median(b) || (a < b ? -1 : a > b ? 1 : 0));
    let y = ordered.length > 1 ? lane - span(ordered) / 2 : lane - (heightOf.get(ordered[0])?.body ?? 0) / 2;
    ordered.forEach((id, index) => {
      row.set(id, index);
      // The first card of a layer lands on the nearest grid line, the others on the next one down: never closer than the gap.
      positions[id] = { x: snap(column), y: index ? Math.ceil(y / 20) * 20 : snap(y) };
      y = positions[id].y + (heightOf.get(id)?.box ?? 0) + ROW_GAP;
    });
  }
  const chosen = scope === "all" ? undefined : new Set(scope);
  const routes: Record<string, WorkflowEdge["route"]> = {};
  for (const edge of doc.edges) if (!chosen || chosen.has(edge.from.node) || chosen.has(edge.to.node)) routes[edge.id] = { style: "bezier", waypoints: [], labelT: 0.5 };
  if (chosen) for (const id of Object.keys(positions)) if (!chosen.has(id)) delete positions[id];
  return { positions, routes };
}

/**
 * The batch that lays the graph out, or nothing when it is laid out already. Notes take part: laying out the whole
 * graph puts each note above the step it annotates, and no layout leaves a note under or over a card.
 */
export function layoutBatch(doc: WorkflowDocument, scope: "all" | string[] = "all"): WorkflowOp[] {
  const result = layout(doc, scope);
  const moved = Object.entries(result.positions).filter(([id, position]) => { const node = doc.nodes.find((entry) => entry.id === id); return node && (node.position.x !== position.x || node.position.y !== position.y); });
  const rerouted = Object.entries(result.routes).filter(([id]) => { const edge = doc.edges.find((entry) => entry.id === id); return edge && (edge.route.style !== "bezier" || edge.route.waypoints.length > 0); });
  const ops: WorkflowOp[] = moved.length || rerouted.length ? [{ op: "layout.apply", positions: Object.fromEntries(moved), routes: Object.fromEntries(rerouted) }] : [];
  if (doc.notes.length) {
    const after = { nodes: doc.nodes.map((node) => (result.positions[node.id] ? { ...node, position: result.positions[node.id] } : node)), edges: doc.edges, notes: doc.notes };
    const frames = [...doc.groups.flatMap((group) => frameOf(after, group.nodeIds) ?? []), ...bodyFrames(after).map((entry) => entry.frame)];
    for (const note of scope === "all" ? placeNotes(doc, after, frames) : settleNotes(after)) {
      const now = doc.notes.find((entry) => entry.id === note.id);
      if (now && (now.x !== note.x || now.y !== note.y)) ops.push({ op: "note.update", id: note.id, patch: { x: note.x, y: note.y } });
    }
  }
  return ops;
}
