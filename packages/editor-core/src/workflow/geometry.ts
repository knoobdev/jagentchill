import type { WorkflowDocument, WorkflowEdge, WorkflowNode } from "@jagentchill/protocol";
import { analyse } from "./graph.ts";
import { NODE_SIZE, cardWidth, controlPorts, snap } from "./nodes.ts";
import { roundedPath, routeClear, routeLabelPoint } from "./routing.ts";

/** Where the canvas draws a node, its ports and its edges, in world units. Pure: the canvas and its tests share it. */
/** The handles of a card's sides are this far apart; the first one sits at the middle of the side. */
export const PORT_PITCH = 22;
/** An output a step fires by name is a labelled row at the bottom of its card, this tall. */
export const OUTCOME_ROW = 28;
/** The room under the last row of outcomes. */
export const OUTCOME_PAD = 8;
export const PORT_HIT = 14;
export const ZOOM = { min: 0.25, max: 2, step: 1.2 } as const;
/** A graph too large to fit at this zoom opens at it, on its first step, instead of shrinking into unreadable cards. */
export const READABLE_ZOOM = 0.75;
export type Point = { x: number; y: number };
export type Box = { x: number; y: number; width: number; height: number };
export type Viewport = { x: number; y: number; zoom: number };
/** `row` is set for an output drawn as a labelled row inside the card: the outcomes a step fires by name. */
export type CanvasPort = { id: string; label: string; type: string; control: boolean; row?: number };

/**
 * The ports of a node in drawing order. `start` leads the inputs and `done` leads the outputs, so the order of a plain
 * chain runs level from card to card; the data ports follow, then the outputs a type fires by name.
 */
export function canvasPorts(node: Pick<WorkflowNode, "type" | "config" | "inputs" | "outputs">): { inputs: CanvasPort[]; outputs: CanvasPort[] } {
  const control = controlPorts(node), named = (id: string): CanvasPort => ({ id, label: id, type: "control", control: true });
  const side = control.outputs.filter((id) => id === "done" || id === "error"), outcomes = control.outputs.filter((id) => id !== "done" && id !== "error");
  return {
    inputs: [...control.inputs.map(named), ...node.inputs.map((port) => ({ id: port.id, label: port.label || port.id, type: port.type, control: false }))],
    outputs: [...side.filter((id) => id === "done").map(named), ...node.outputs.map((port) => ({ id: port.id, label: port.label || port.id, type: port.type, control: false })), ...side.filter((id) => id === "error").map(named),
      ...outcomes.map((id, row) => ({ ...named(id), row }))],
  };
}
/** How far the handle at an index sits from the middle of its side: the first at the middle, the rest alternately under and over it. */
const sideOffset = (index: number): number => (index === 0 ? 0 : (index % 2 ? 1 : -1) * Math.ceil(index / 2) * PORT_PITCH);
/** The height of a card above its rows of outcomes: the header and the summary, grown when a side carries many handles. */
export function bodyHeight(node: Pick<WorkflowNode, "type" | "config" | "inputs" | "outputs">): number {
  const ports = canvasPorts(node), most = Math.max(ports.inputs.length, ports.outputs.filter((port) => port.row === undefined).length, 1);
  return Math.max(NODE_SIZE.height, 2 * (Math.ceil((most - 1) / 2) * PORT_PITCH + 16));
}
/** The box of a node: as wide as its name asks, as tall as its body and its rows of outcomes. */
export function nodeBox(node: Pick<WorkflowNode, "type" | "config" | "inputs" | "outputs" | "position" | "size"> & { name?: string }): Box {
  const rows = canvasPorts(node).outputs.filter((port) => port.row !== undefined).length;
  return { x: node.position.x, y: node.position.y, width: cardWidth(node), height: bodyHeight(node) + (rows ? rows * OUTCOME_ROW + OUTCOME_PAD : 0) };
}
/** How far under the top of its card a port sits. */
export function portOffset(node: Pick<WorkflowNode, "type" | "config" | "inputs" | "outputs">, side: "in" | "out", portId: string): number | undefined {
  const ports = canvasPorts(node), body = bodyHeight(node);
  if (side === "in") { const index = ports.inputs.findIndex((port) => port.id === portId); return index < 0 ? undefined : body / 2 + sideOffset(index); }
  const port = ports.outputs.find((entry) => entry.id === portId);
  if (!port) return undefined;
  return port.row !== undefined ? body + (port.row + 0.5) * OUTCOME_ROW : body / 2 + sideOffset(ports.outputs.filter((entry) => entry.row === undefined).indexOf(port));
}
/** The centre of a port's handle: inputs on the inline-start edge, outputs on the inline-end edge. */
export function portPoint(node: WorkflowNode, side: "in" | "out", portId: string): Point | undefined {
  const offset = portOffset(node, side, portId);
  return offset === undefined ? undefined : { x: side === "in" ? node.position.x : node.position.x + cardWidth(node), y: node.position.y + offset };
}
/** Where a card's first handle sits under its top: what places a card by the port a connection was dropped for. */
export const NODE_HEAD = NODE_SIZE.height / 2;

export type Curve = [Point, Point, Point, Point];
/**
 * The curve of an edge: a cubic that leaves its output towards the inline end and enters its input from the inline
 * start. An edge that runs backwards swings wide, and under the cards when both ends are nearly level.
 */
export function curveOf(from: Point, to: Point): Curve {
  const dx = to.x - from.x, dy = to.y - from.y;
  if (dx >= 0) { const reach = Math.max(dx / 2, Math.min(72, 24 + Math.abs(dy) / 2)); return [from, { x: from.x + reach, y: from.y }, { x: to.x - reach, y: to.y }, to]; }
  const reach = Math.min(240, 96 - dx / 4), dip = Math.abs(dy) < 140 ? 150 : 0;
  return [from, { x: from.x + reach, y: from.y + dip }, { x: to.x - reach, y: to.y + dip }, to];
}
const n = (value: number): number => Math.round(value * 100) / 100;
export const curvePath = (curve: Curve): string => `M ${n(curve[0].x)} ${n(curve[0].y)} C ${n(curve[1].x)} ${n(curve[1].y)} ${n(curve[2].x)} ${n(curve[2].y)} ${n(curve[3].x)} ${n(curve[3].y)}`;
export function curvePoint(curve: Curve, t: number): Point {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return { x: a * curve[0].x + b * curve[1].x + c * curve[2].x + d * curve[3].x, y: a * curve[0].y + b * curve[1].y + c * curve[2].y + d * curve[3].y };
}
const SAMPLES = 24;
/** A curve as the points along it: what the hit-testing and the bounds measure. */
export const curvePoints = (curve: Curve): Point[] => Array.from({ length: SAMPLES + 1 }, (_unused, index) => curvePoint(curve, index / SAMPLES));
/** The path of an edge between two points: also what a connection being dragged draws. */
export function edgePath(from: Point, to: Point, _kind: WorkflowEdge["kind"] = "data"): string {
  return curvePath(curveOf(from, to));
}
/** The two ends of an edge on the canvas, or undefined when one of its ports is gone. */
export function edgeEnds(doc: Pick<WorkflowDocument, "nodes">, edge: Pick<WorkflowEdge, "from" | "to">): { from: Point; to: Point } | undefined {
  const source = doc.nodes.find((node) => node.id === edge.from.node), target = doc.nodes.find((node) => node.id === edge.to.node);
  const from = source && portPoint(source, "out", edge.from.port), to = target && portPoint(target, "in", edge.to.port);
  return from && to ? { from, to } : undefined;
}
export const edgeMidpoint = (from: Point, to: Point, _kind: WorkflowEdge["kind"] = "data"): Point => curvePoint(curveOf(from, to), 0.5);

/**
 * The curve of an edge in a graph: the plain curve between its ports, or — when that would run behind a card that
 * lies between them — the same curve swung under those cards (over them when that is the shorter way), so a line that
 * skips a step is never taken for one that enters it.
 */
function curveAround(from: Point, to: Point, boxes: readonly Box[]): Curve {
  const plain = curveOf(from, to);
  if (to.x <= from.x || !boxes.length) return plain;
  const between = boxes.filter((box) => box.x < to.x - 1 && box.x + box.width > from.x + 1);
  const hits = (curve: Curve): boolean => curvePoints(curve).some((point) => between.some((box) => point.x > box.x - 6 && point.x < box.x + box.width + 6 && point.y > box.y - 6 && point.y < box.y + box.height + 6));
  if (!between.length || !hits(plain)) return plain;
  const level = (from.y + to.y) / 2, reach = Math.max(48, Math.min(160, (to.x - from.x) / 4));
  const under = Math.max(...between.map((box) => box.y + box.height)) + 28, over = Math.min(...between.map((box) => box.y)) - 28;
  // A curve reaches three quarters of the way to the height of its control points.
  for (const clear of under - level <= level - over ? [under, over] : [over, under]) {
    for (let push = 0; push <= 120; push += 40) {
      const y = level + (clear - level + Math.sign(clear - level) * push) / 0.75;
      const curve: Curve = [from, { x: from.x + reach, y }, { x: to.x - reach, y }, to];
      if (!hits(curve)) return curve;
    }
  }
  return plain;
}
const curveCache = new WeakMap<object, { edges: unknown; curves: Map<string, Curve> }>();
/**
 * The curve of every edge of a graph. Documents are immutable, so the curves of one node list are computed once and
 * shared by the drawing, the labels and the hit-testing.
 */
export function curvesOf(doc: Pick<WorkflowDocument, "nodes" | "edges">): Map<string, Curve> {
  const cached = curveCache.get(doc.nodes);
  if (cached && cached.edges === doc.edges) return cached.curves;
  const byId = new Map(doc.nodes.map((node) => [node.id, node])), boxes = new Map(doc.nodes.map((node) => [node.id, nodeBox(node)]));
  const curves = new Map<string, Curve>();
  for (const edge of doc.edges) {
    const source = byId.get(edge.from.node), target = byId.get(edge.to.node);
    const from = source && portPoint(source, "out", edge.from.port), to = target && portPoint(target, "in", edge.to.port);
    if (from && to) curves.set(edge.id, curveAround(from, to, [...boxes].filter(([id]) => id !== edge.from.node && id !== edge.to.node).map(([, box]) => box)));
  }
  curveCache.set(doc.nodes, { edges: doc.edges, curves });
  return curves;
}
/** How close to a card a line may come before it counts as running over it. */
const CARD_MARGIN = 6;
/** Whether a line of points runs over a card. The first and the last stretch of a line touch the two cards it joins: `own` cards are tested only away from the ends. */
function overCards(points: readonly Point[], boxes: readonly Box[], own: readonly Box[]): boolean {
  const within = (point: Point, box: Box, margin: number) => point.x > box.x - margin && point.x < box.x + box.width + margin && point.y > box.y - margin && point.y < box.y + box.height + margin;
  const last = points.length - 1, skip = Math.max(1, Math.round(last / 8));
  return points.some((point, index) => boxes.some((box) => within(point, box, CARD_MARGIN)) || (index >= skip && index <= last - skip && own.some((box) => within(point, box, 0))));
}
/**
 * An edge as it is drawn. A smooth curve between its two ports where that runs over no card; where it would — a line
 * that skips a step, a branch that comes back, a join far below — the edge takes a route of straight runs and rounded
 * corners along the free lanes between the cards (`routeClear`), so it is never drawn under a card or through one.
 */
export type EdgeLine = { /** The SVG path, stopping just short of the card it enters (its arrowhead closes it). */ d: string; /** The points along it, for hit-testing and bounds: the first and the last are its two ports. */ points: Point[]; /** Where its arrowhead points. */ tip: Point; /** Where its label sits. */ mid: Point; /** True when it is a route of straight runs, not the plain curve. */ routed: boolean };
const lineCache = new WeakMap<object, { edges: unknown; lines: Map<string, EdgeLine> }>();
/** The line of every edge of a graph (see `EdgeLine`); computed once per node list, like the curves. */
export function edgeLines(doc: Pick<WorkflowDocument, "nodes" | "edges">): Map<string, EdgeLine> {
  const cached = lineCache.get(doc.nodes);
  if (cached && cached.edges === doc.edges) return cached.lines;
  const curves = curvesOf(doc), boxes = new Map(doc.nodes.map((node) => [node.id, nodeBox(node)])), all = [...boxes.values()];
  const lines = new Map<string, EdgeLine>();
  for (const edge of doc.edges) {
    const curve = curves.get(edge.id);
    if (!curve) continue;
    const own = [boxes.get(edge.from.node), boxes.get(edge.to.node)].filter((box): box is Box => !!box), others = all.filter((box) => !own.includes(box));
    const sampled = curvePoints(curve), route = overCards(sampled, others, own) ? routeClear(curve[0], curve[3], all) : undefined;
    if (route) {
      const end = route[route.length - 1], short = [...route.slice(0, -1), { x: end.x - 2, y: end.y }];
      // Sampled along its runs, so that hit-testing and bounds follow the route.
      lines.set(edge.id, { d: roundedPath(short), points: route, tip: end, mid: routeLabelPoint(route), routed: true });
    } else lines.set(edge.id, { d: curvePath(curveShort(curve)), points: sampled, tip: curve[3], mid: curvePoint(curve, 0.5), routed: false });
  }
  lineCache.set(doc.nodes, { edges: doc.edges, lines });
  return lines;
}
const routeCache = new WeakMap<object, Map<string, Point[]>>();
/** The line of every edge of a graph, as the points along it (the first and the last are its two ports): what the hit-testing measures. */
export function routesOf(doc: Pick<WorkflowDocument, "nodes" | "edges">): Map<string, Point[]> {
  const lines = edgeLines(doc), cached = routeCache.get(lines);
  if (cached) return cached;
  const routes = new Map([...lines].map(([id, line]) => [id, line.points] as [string, Point[]]));
  routeCache.set(lines, routes);
  return routes;
}
/** A curve as it is drawn: it stops just short of the card it enters, where its arrowhead closes it. */
export const curveShort = (curve: Curve, by = 2): Curve => [curve[0], curve[1], { x: curve[2].x - by, y: curve[2].y }, { x: curve[3].x - by, y: curve[3].y }];
/** The distance from a point to a line of points. */
export function lineDistance(points: readonly Point[], point: Point): number {
  let best = Infinity;
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1], b = points[index], dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    const t = length ? Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0;
    best = Math.min(best, Math.hypot(point.x - a.x - dx * t, point.y - a.y - dy * t));
  }
  return best;
}
const bodyCache = new WeakMap<object, { edges: unknown; bodies: Array<{ owner: string; kind: "loop" | "parallel"; members: string[] }> }>();
/**
 * The frame around the steps a loop repeats or a fan-out runs per item, by the id of the loop or parallel node. `drawn`
 * is the same graph with the positions on screen, while steps are being dragged.
 */
export function bodyFrames(doc: Pick<WorkflowDocument, "nodes" | "edges">, drawn: Pick<WorkflowDocument, "nodes"> = doc): Array<{ owner: string; kind: "loop" | "parallel"; frame: Box }> {
  let cached = bodyCache.get(doc.nodes);
  if (!cached || cached.edges !== doc.edges) {
    const owners = doc.nodes.filter((node) => node.type === "loop" || node.type === "parallel");
    const body = owners.length ? analyse(doc).body : new Map<string, Set<string>>();
    cached = { edges: doc.edges, bodies: owners.filter((node) => body.get(node.id)?.size).map((node) => ({ owner: node.id, kind: node.type as "loop" | "parallel", members: [...body.get(node.id)!] })) };
    bodyCache.set(doc.nodes, cached);
  }
  return cached.bodies.flatMap((entry) => {
    const bounds = boundsOf(drawn, entry.members);
    return bounds ? [{ owner: entry.owner, kind: entry.kind, frame: { x: bounds.x - 24, y: bounds.y - 48, width: bounds.width + 48, height: bounds.height + 72 } }] : [];
  });
}

/** The node under a point; the one drawn last wins. */
export function nodeAt(doc: Pick<WorkflowDocument, "nodes">, point: Point): WorkflowNode | undefined {
  for (let index = doc.nodes.length - 1; index >= 0; index--) {
    const box = nodeBox(doc.nodes[index]);
    if (point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height) return doc.nodes[index];
  }
  return undefined;
}
/** The port of a side nearest to a point, within the hit radius. */
export function portAt(doc: Pick<WorkflowDocument, "nodes">, point: Point, side: "in" | "out", radius = PORT_HIT): { node: string; port: string } | undefined {
  let best: { node: string; port: string; distance: number } | undefined;
  for (const node of doc.nodes) {
    const ports = canvasPorts(node);
    for (const port of side === "in" ? ports.inputs : ports.outputs) {
      const at = portPoint(node, side, port.id)!;
      const distance = Math.hypot(at.x - point.x, at.y - point.y);
      if (distance <= radius && (!best || distance < best.distance)) best = { node: node.id, port: port.id, distance };
    }
  }
  return best && { node: best.node, port: best.port };
}
/** The edge whose route passes within `tolerance` of a point; the one drawn last wins. */
export function edgeAt(doc: Pick<WorkflowDocument, "nodes" | "edges">, point: Point, tolerance = 8): WorkflowEdge | undefined {
  const routes = routesOf(doc);
  for (let index = doc.edges.length - 1; index >= 0; index--) {
    const route = routes.get(doc.edges[index].id);
    if (route && lineDistance(route, point) <= tolerance) return doc.edges[index];
  }
  return undefined;
}
/** The nodes whose box meets a rectangle: the marquee. */
export function nodesIn(doc: Pick<WorkflowDocument, "nodes">, a: Point, b: Point): string[] {
  const left = Math.min(a.x, b.x), right = Math.max(a.x, b.x), top = Math.min(a.y, b.y), bottom = Math.max(a.y, b.y);
  return doc.nodes.filter((node) => { const box = nodeBox(node); return box.x < right && box.x + box.width > left && box.y < bottom && box.y + box.height > top; }).map((node) => node.id);
}
/** The box around every node, or undefined for an empty graph. */
export function boundsOf(doc: Pick<WorkflowDocument, "nodes">, nodeIds?: readonly string[]): Box | undefined {
  const boxes = doc.nodes.filter((node) => !nodeIds || nodeIds.includes(node.id)).map(nodeBox);
  if (!boxes.length) return undefined;
  const x = Math.min(...boxes.map((box) => box.x)), y = Math.min(...boxes.map((box) => box.y));
  return { x, y, width: Math.max(...boxes.map((box) => box.x + box.width)) - x, height: Math.max(...boxes.map((box) => box.y + box.height)) - y };
}

export const clampZoom = (zoom: number): number => Math.min(ZOOM.max, Math.max(ZOOM.min, Math.round(zoom * 100) / 100));
export const toWorld = (view: Viewport, screen: Point): Point => ({ x: (screen.x - view.x) / view.zoom, y: (screen.y - view.y) / view.zoom });
export const toScreen = (view: Viewport, world: Point): Point => ({ x: world.x * view.zoom + view.x, y: world.y * view.zoom + view.y });
/** Zoom about a point of the screen: the world point under it stays where it is. */
export function zoomAbout(view: Viewport, anchor: Point, zoom: number): Viewport {
  const next = clampZoom(zoom), world = toWorld(view, anchor);
  return { zoom: next, x: anchor.x - world.x * next, y: anchor.y - world.y * next };
}
type Sheet = Pick<WorkflowDocument, "nodes"> & { notes?: readonly Box[] };
/** The box around everything drawn: the steps and, when the document carries them, its notes. */
export function contentBounds(doc: Sheet, nodeIds?: readonly string[]): Box | undefined {
  const boxes = [...doc.nodes.filter((node) => !nodeIds || nodeIds.includes(node.id)).map(nodeBox), ...(nodeIds ? [] : (doc.notes ?? []).map((note) => ({ x: note.x, y: note.y, width: note.width, height: note.height })))];
  if (!boxes.length) return undefined;
  const x = Math.min(...boxes.map((box) => box.x)), y = Math.min(...boxes.map((box) => box.y));
  return { x, y, width: Math.max(...boxes.map((box) => box.x + box.width)) - x, height: Math.max(...boxes.map((box) => box.y + box.height)) - y };
}
/** The viewport that shows the whole graph (or a selection) centred with a margin, never above 100 %. */
export function fitView(doc: Sheet, size: { width: number; height: number }, margin = 48, nodeIds?: readonly string[]): Viewport {
  const bounds = contentBounds(doc, nodeIds);
  if (!bounds || size.width <= 0 || size.height <= 0) return { x: 0, y: 0, zoom: 1 };
  // Rounded down, so the margin is never eaten by the rounding.
  const zoom = clampZoom(Math.floor(Math.min(1, (size.width - margin * 2) / bounds.width, (size.height - margin * 2) / bounds.height) * 100) / 100);
  return { zoom, x: (size.width - bounds.width * zoom) / 2 - bounds.x * zoom, y: (size.height - bounds.height * zoom) / 2 - bounds.y * zoom };
}
/** A graph of at most this many steps is small: it is never shown smaller than `SMALL_GRAPH_ZOOM`. */
export const SMALL_GRAPH = 6;
export const SMALL_GRAPH_ZOOM = 0.9;
/** The graph at a zoom with its first steps at the inline start: what is shown when the whole graph would be too small to read. */
function startView(bounds: Box, size: { width: number; height: number }, zoom: number, margin: number): Viewport {
  const tall = bounds.height * zoom > size.height - margin * 2;
  return { zoom, x: margin - bounds.x * zoom, y: tall ? margin - bounds.y * zoom : (size.height - bounds.height * zoom) / 2 - bounds.y * zoom };
}
/**
 * What "Fit to screen" shows: the whole graph — except that a small graph is never shrunk under a readable zoom; when
 * it is wider than the canvas at that zoom it is shown from its first step and the canvas says that it continues.
 * `floor` is the readable zoom of the window: a narrow one reads a card at less.
 */
export function fitReadable(doc: Sheet, size: { width: number; height: number }, margin = 48, floor = SMALL_GRAPH_ZOOM): Viewport {
  const fit = fitView(doc, size, margin), bounds = contentBounds(doc);
  if (!bounds || size.width <= 0 || fit.zoom >= floor || doc.nodes.length > SMALL_GRAPH) return fit;
  return startView(bounds, size, floor, Math.min(margin, 32));
}
/**
 * The viewport a workflow opens in: the whole graph when that leaves the cards readable, otherwise a readable zoom
 * with the first steps at the inline start — a long pipeline is read from its trigger, not from far away.
 */
export function openView(doc: Sheet, size: { width: number; height: number }, margin = 32, floor = SMALL_GRAPH_ZOOM): Viewport {
  const fit = fitView(doc, size, margin), bounds = contentBounds(doc);
  const readable = doc.nodes.length > SMALL_GRAPH ? Math.min(floor, READABLE_ZOOM) : floor;
  if (!bounds || fit.zoom >= readable || size.width <= 0) return fit;
  return startView(bounds, size, readable, margin);
}
/** How many steps lie wholly outside the viewport on each side: what the canvas says so that a cut graph is not taken for the whole. */
export function beyond(doc: Pick<WorkflowDocument, "nodes">, view: Viewport, size: { width: number; height: number }): { start: number; end: number; above: number; below: number } {
  const left = -view.x / view.zoom, top = -view.y / view.zoom, right = left + size.width / view.zoom, bottom = top + size.height / view.zoom;
  const count = { start: 0, end: 0, above: 0, below: 0 };
  if (size.width <= 0 || size.height <= 0) return count;
  for (const node of doc.nodes) {
    const box = nodeBox(node), half = box.width / 2;
    // A card counts as out of sight once more than half of it is cut.
    if (box.x + half >= right) count.end++; else if (box.x + half <= left) count.start++; else if (box.y + box.height / 2 >= bottom) count.below++; else if (box.y + box.height / 2 <= top) count.above++;
  }
  return count;
}

type Placed = { id: string; x: number; y: number; width: number; height: number };
const meets = (a: Box, b: Box, gap: number): boolean => a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
/**
 * The free place nearest to where a box wants to be: on the grid, clear of every obstacle by `gap`. Rings of grid
 * steps are searched outwards; within a ring the nearest place wins, and above wins a tie (a note reads as a caption).
 */
export function freeSpot(want: Box, obstacles: readonly Box[], gap = 16, grid = 20): Point {
  const origin = { x: snap(want.x), y: snap(want.y) };
  const free = (x: number, y: number) => !obstacles.some((box) => meets({ x, y, width: want.width, height: want.height }, box, gap));
  if (free(origin.x, origin.y)) return origin;
  for (let ring = 1; ring <= 120; ring++) {
    let best: Point | undefined, cost = Infinity;
    for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
      const x = origin.x + dx * grid, y = origin.y + dy * grid, price = Math.hypot(dx, dy) + (dy > 0 ? 0.01 : 0);
      if (price < cost && free(x, y)) { best = { x, y }; cost = price; }
    }
    if (best) return best;
  }
  return origin;
}
/**
 * Notes never lie under or over a card: every note that meets a card is moved to the nearest free place — clear of the
 * cards and of the other notes. Returns the new place of the notes that had to move.
 */
export function settleNotes(doc: Pick<WorkflowDocument, "nodes" | "notes">): Placed[] {
  const cards = doc.nodes.map(nodeBox), moved: Placed[] = [], placed: Box[] = [];
  doc.notes.forEach((note, index) => {
    let at: Box = note;
    if (cards.some((card) => meets(note, card, 0))) {
      // Clear of the cards, of the notes settled before it and of the notes after it where they lie.
      const spot = freeSpot(note, [...cards, ...placed, ...doc.notes.slice(index + 1)]);
      at = { x: spot.x, y: spot.y, width: note.width, height: note.height };
      moved.push({ id: note.id, ...at });
    }
    placed.push(at);
  });
  return moved;
}
/**
 * Where auto-layout puts the notes: each one above the step it was nearest to before the layout — beside it when there
 * is no room above — clear of every card, of the frames around groups and bodies, and of the other notes.
 * `before` is the graph as it was, `after` the same graph laid out; `frames` are the frames drawn around the laid-out steps.
 */
export function placeNotes(before: Pick<WorkflowDocument, "nodes" | "notes">, after: Pick<WorkflowDocument, "nodes">, frames: readonly Box[] = []): Placed[] {
  const cards = after.nodes.map(nodeBox), placed: Box[] = [], out: Placed[] = [];
  const centre = (box: Box): Point => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  for (const note of before.notes) {
    const at = centre(note);
    let anchor: Box | undefined, nearest = Infinity;
    for (const node of before.nodes) { const mid = centre(nodeBox(node)), distance = Math.hypot(mid.x - at.x, mid.y - at.y); if (distance < nearest) { nearest = distance; anchor = cards[after.nodes.findIndex((entry) => entry.id === node.id)] ?? anchor; } }
    // Above the anchor, and above the frame the anchor sits in, so the note never straddles a frame's border.
    const around = anchor ? frames.filter((frame) => meets(anchor!, frame, 0)) : [];
    const top = Math.min(anchor?.y ?? note.y, ...around.map((frame) => frame.y));
    const spot = anchor ? freeSpot({ x: anchor.x, y: top - note.height - 40, width: note.width, height: note.height }, [...cards, ...frames, ...placed]) : { x: note.x, y: note.y };
    placed.push({ ...spot, width: note.width, height: note.height });
    out.push({ id: note.id, x: spot.x, y: spot.y, width: note.width, height: note.height });
  }
  return out;
}
/** The minimap: the scale that fits the graph and the viewport into a box, and the viewport's rectangle in it. */
export function minimap(doc: Pick<WorkflowDocument, "nodes">, view: Viewport, size: { width: number; height: number }, box: { width: number; height: number }): { scale: number; origin: Point; viewRect: Box } {
  const shown = { x: -view.x / view.zoom, y: -view.y / view.zoom, width: size.width / view.zoom, height: size.height / view.zoom };
  const graph = boundsOf(doc) ?? shown;
  const x = Math.min(graph.x, shown.x), y = Math.min(graph.y, shown.y);
  const width = Math.max(graph.x + graph.width, shown.x + shown.width) - x, height = Math.max(graph.y + graph.height, shown.y + shown.height) - y;
  const scale = Math.min(box.width / Math.max(width, 1), box.height / Math.max(height, 1));
  return { scale, origin: { x, y }, viewRect: { x: (shown.x - x) * scale, y: (shown.y - y) * scale, width: shown.width * scale, height: shown.height * scale } };
}

/** The colour token of a port by the data it carries. */
export function portToken(type: string): string {
  const base = /^list<(.+)>$/.exec(type)?.[1] ?? type;
  if (base === "control") return "wf/port/control";
  if (base === "text" || base === "string" || base === "ScriptRef") return "wf/port/text";
  if (base === "ImageRef") return "wf/port/image";
  if (base === "VideoRef" || base === "MediaRef") return "wf/port/video";
  if (base === "AudioRef") return "wf/port/audio";
  if (base === "ProjectRef") return "wf/port/project";
  if (base === "FileRef") return "wf/port/file";
  if (base === "number" || base === "integer" || base === "boolean") return "wf/port/scalar";
  if (base === "any") return "wf/port/any";
  return "wf/port/json";
}
