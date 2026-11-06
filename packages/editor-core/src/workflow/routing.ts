/**
 * Orthogonal edge routing for the workflow canvas: an edge leaves its output port to the inline end, enters its input
 * port from the inline start, turns only at right angles and keeps clear of the node cards. The corners are rounded
 * when the route is drawn. Pure and deterministic, so the canvas, the hit-testing and the exported picture agree.
 */
export type RoutePoint = { x: number; y: number };
export type RouteBox = { x: number; y: number; width: number; height: number };

/** How far an edge runs straight out of a port before it may turn. */
export const ROUTE_STUB = 18;
/** The clearance a route keeps from a card. Smaller than the stub, so a turn right after a port is never "inside" its own card. */
export const ROUTE_CLEARANCE = 10;
export const ROUTE_RADIUS = 10;
const LANES_TRIED = 16;

const crossesH = (y: number, x1: number, x2: number, box: RouteBox): boolean =>
  y > box.y - ROUTE_CLEARANCE && y < box.y + box.height + ROUTE_CLEARANCE && Math.max(x1, x2) > box.x - ROUTE_CLEARANCE && Math.min(x1, x2) < box.x + box.width + ROUTE_CLEARANCE;
const crossesV = (x: number, y1: number, y2: number, box: RouteBox): boolean =>
  x > box.x - ROUTE_CLEARANCE && x < box.x + box.width + ROUTE_CLEARANCE && Math.max(y1, y2) > box.y - ROUTE_CLEARANCE && Math.min(y1, y2) < box.y + box.height + ROUTE_CLEARANCE;

/** How many cards the segments of a polyline cross. */
function blocked(points: RoutePoint[], boxes: readonly RouteBox[]): number {
  let count = 0;
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1], b = points[index];
    if (a.x === b.x && a.y === b.y) continue;
    for (const box of boxes) if (a.y === b.y ? crossesH(a.y, a.x, b.x, box) : crossesV(a.x, a.y, b.y, box)) count++;
  }
  return count;
}
const lengthOf = (points: RoutePoint[]): number => { let total = 0; for (let index = 1; index < points.length; index++) total += Math.abs(points[index].x - points[index - 1].x) + Math.abs(points[index].y - points[index - 1].y); return total; };
/** Drops repeated points and the middle point of three in a line. */
function tidy(points: RoutePoint[]): RoutePoint[] {
  const out: RoutePoint[] = [];
  for (const point of points) {
    const last = out[out.length - 1], before = out[out.length - 2];
    if (last && last.x === point.x && last.y === point.y) continue;
    if (before && ((before.x === last.x && last.x === point.x) || (before.y === last.y && last.y === point.y))) out[out.length - 1] = point;
    else out.push(point);
  }
  return out;
}

/**
 * The route between an output port and an input port. `slot` spreads the edges that leave one node so their vertical
 * runs do not lie on each other. The shortest candidate that crosses no card wins; when every candidate crosses one,
 * the one crossing the fewest does.
 */
export function routeEdge(from: RoutePoint, to: RoutePoint, obstacles: readonly RouteBox[] = [], slot = 0): RoutePoint[] {
  const a = { x: from.x + ROUTE_STUB, y: from.y }, b = { x: to.x - ROUTE_STUB, y: to.y };
  const left = Math.min(a.x, b.x) - ROUTE_CLEARANCE, right = Math.max(a.x, b.x) + ROUTE_CLEARANCE;
  const near = obstacles.filter((box) => box.x < right && box.x + box.width > left);
  const finish = (middle: RoutePoint[]): RoutePoint[] => tidy([from, a, ...middle, b, to]);
  let best: { points: RoutePoint[]; hits: number; cost: number } | undefined;
  const offer = (middle: RoutePoint[]): boolean => {
    const points = [a, ...middle, b], hits = blocked(points, near), cost = lengthOf(points) + middle.length * 12;
    if (!best || hits < best.hits || (hits === best.hits && cost < best.cost)) best = { points: middle, hits, cost };
    return hits === 0;
  };
  if (b.x >= a.x) {
    if (a.y === b.y && offer([])) return finish([]);
    // One vertical run between the two cards: in the middle first, then hard against either card.
    const span = b.x - a.x, middle = a.x + span / 2 + Math.max(-span / 2, Math.min(span / 2, slot * 10));
    for (const x of [middle, a.x, b.x]) if (offer([{ x, y: a.y }, { x, y: b.y }])) return finish(best!.points);
  }
  // A lane above or below what is in the way: out, along the lane, in.
  const lanes = new Set<number>();
  for (const box of near) { lanes.add(box.y - ROUTE_CLEARANCE - 6 - Math.abs(slot) * 6); lanes.add(box.y + box.height + ROUTE_CLEARANCE + 6 + Math.abs(slot) * 6); }
  if (!near.length) lanes.add(Math.max(a.y, b.y) + 60);
  const ordered = [...lanes].sort((p, q) => Math.abs(a.y - p) + Math.abs(b.y - p) - (Math.abs(a.y - q) + Math.abs(b.y - q)) || p - q).slice(0, LANES_TRIED);
  for (const y of ordered) if (offer([{ x: a.x, y }, { x: b.x, y }])) break;
  return finish(best!.points);
}

/** How far outside a card's clearance a route's lanes lie. */
const LANE_GAP = 8;
const TURN_COST = 28;
/**
 * The route between an output port and an input port that crosses NO card whenever such a route exists: the shortest
 * path, with the fewest turns, over the lanes that run just outside every card (above, below, before and after each).
 * `routeEdge` tries a handful of shapes and gives up with the least bad one; this one searches. Undefined when the
 * cards leave no way through (a port walled in): the caller then draws what it has.
 */
export function routeClear(from: RoutePoint, to: RoutePoint, obstacles: readonly RouteBox[] = []): RoutePoint[] | undefined {
  const a = { x: from.x + ROUTE_STUB, y: from.y }, b = { x: to.x - ROUTE_STUB, y: to.y }, out = ROUTE_CLEARANCE + LANE_GAP;
  const xs = [...new Set([a.x, b.x, ...obstacles.flatMap((box) => [box.x - out, box.x + box.width + out])])].sort((p, q) => p - q);
  const ys = [...new Set([a.y, b.y, ...obstacles.flatMap((box) => [box.y - out, box.y + box.height + out])])].sort((p, q) => p - q);
  const nx = xs.length, ny = ys.length, at = (i: number, j: number) => j * nx + i;
  // A lane point inside a card's clearance is no place to stand (the two stubs' ends are, by construction, outside their own card's).
  const inside = (x: number, y: number) => obstacles.some((box) => x > box.x - ROUTE_CLEARANCE && x < box.x + box.width + ROUTE_CLEARANCE && y > box.y - ROUTE_CLEARANCE && y < box.y + box.height + ROUTE_CLEARANCE);
  const free = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) free[at(i, j)] = inside(xs[i], ys[j]) ? 0 : 1;
  const si = xs.indexOf(a.x), sj = ys.indexOf(a.y), ei = xs.indexOf(b.x), ej = ys.indexOf(b.y);
  if (!free[at(si, sj)] || !free[at(ei, ej)]) return undefined;
  const openH = (i: number, j: number) => !obstacles.some((box) => crossesH(ys[j], xs[i], xs[i + 1], box)), openV = (i: number, j: number) => !obstacles.some((box) => crossesV(xs[i], ys[j], ys[j + 1], box));
  // Dijkstra over (lane point, direction of arrival): 0 → right, 1 ← left, 2 ↓ down, 3 ↑ up. It starts moving right (out of the port) and must end moving right (into the port).
  const states = nx * ny * 4, cost = new Float64Array(states).fill(Infinity), prev = new Int32Array(states).fill(-1), done = new Uint8Array(states);
  const heap: number[] = [];
  const push = (state: number) => { heap.push(state); let k = heap.length - 1; while (k > 0) { const parent = (k - 1) >> 1; if (cost[heap[parent]] <= cost[heap[k]]) break; [heap[parent], heap[k]] = [heap[k], heap[parent]]; k = parent; } };
  const pop = (): number => { const top = heap[0], last = heap.pop()!; if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && cost[heap[l]] < cost[heap[m]]) m = l; if (r < heap.length && cost[heap[r]] < cost[heap[m]]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  const start = at(si, sj) * 4, goal = at(ei, ej) * 4;
  cost[start] = 0; push(start);
  const STEP: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (heap.length) {
    const state = pop();
    if (done[state]) continue;
    done[state] = 1;
    if (state === goal) break;
    const cell = state >> 2, dir = state & 3, i = cell % nx, j = (cell - i) / nx;
    for (let next = 0; next < 4; next++) {
      // No turning back on itself.
      if ((dir ^ 1) === next) continue;
      const [di, dj] = STEP[next], ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= nx || nj >= ny || !free[at(ni, nj)]) continue;
      if (di !== 0 ? !openH(Math.min(i, ni), j) : !openV(i, Math.min(j, nj))) continue;
      const target = at(ni, nj) * 4 + next, length = Math.abs(xs[ni] - xs[i]) + Math.abs(ys[nj] - ys[j]);
      const total = cost[state] + length + (next === dir ? 0 : TURN_COST);
      if (total < cost[target]) { cost[target] = total; prev[target] = state; push(target); }
    }
  }
  if (!Number.isFinite(cost[goal])) return undefined;
  const middle: RoutePoint[] = [];
  for (let state = goal; state !== -1; state = prev[state]) { const cell = state >> 2, i = cell % nx; middle.unshift({ x: xs[i], y: ys[(cell - i) / nx] }); }
  return tidy([from, ...middle, to]);
}

/** The drawn path of a route: straight runs joined by quarter turns of at most `radius`. */
export function roundedPath(points: readonly RoutePoint[], radius = ROUTE_RADIUS): string {
  if (points.length < 2) return "";
  const n = (value: number) => Math.round(value * 100) / 100;
  let path = `M ${n(points[0].x)} ${n(points[0].y)}`;
  for (let index = 1; index < points.length - 1; index++) {
    const before = points[index - 1], corner = points[index], after = points[index + 1];
    const into = Math.abs(corner.x - before.x) + Math.abs(corner.y - before.y), out = Math.abs(after.x - corner.x) + Math.abs(after.y - corner.y);
    const r = Math.min(radius, into / 2, out / 2);
    const start = { x: corner.x - Math.sign(corner.x - before.x) * r, y: corner.y - Math.sign(corner.y - before.y) * r };
    const end = { x: corner.x + Math.sign(after.x - corner.x) * r, y: corner.y + Math.sign(after.y - corner.y) * r };
    path += ` L ${n(start.x)} ${n(start.y)} Q ${n(corner.x)} ${n(corner.y)} ${n(end.x)} ${n(end.y)}`;
  }
  const last = points[points.length - 1];
  return `${path} L ${n(last.x)} ${n(last.y)}`;
}

/** The point at a fraction of a route's length. */
export function routePoint(points: readonly RoutePoint[], t: number): RoutePoint {
  const total = lengthOf(points as RoutePoint[]);
  let left = total * Math.min(1, Math.max(0, t));
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1], b = points[index], length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    if (left <= length && length > 0) return { x: a.x + ((b.x - a.x) * left) / length, y: a.y + ((b.y - a.y) * left) / length };
    left -= length;
  }
  return points[points.length - 1] ?? { x: 0, y: 0 };
}
/** Where a route carries its label: the middle of its longest run, which is the place least likely to sit on a corner. */
export function routeLabelPoint(points: readonly RoutePoint[]): RoutePoint {
  let best = { length: -1, x: 0, y: 0 };
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1], b = points[index], length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    // Horizontal runs are preferred: a label reads along them.
    const weight = a.y === b.y ? length * 1.5 : length;
    if (weight > best.length) best = { length: weight, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  return { x: best.x, y: best.y };
}
/** The distance from a point to a route. */
export function routeDistance(points: readonly RoutePoint[], point: RoutePoint): number {
  let best = Infinity;
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1], b = points[index];
    const x = Math.min(Math.max(point.x, Math.min(a.x, b.x)), Math.max(a.x, b.x)), y = Math.min(Math.max(point.y, Math.min(a.y, b.y)), Math.max(a.y, b.y));
    best = Math.min(best, Math.hypot(point.x - x, point.y - y));
  }
  return best;
}
