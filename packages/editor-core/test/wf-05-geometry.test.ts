import assert from "node:assert/strict";
import { test } from "node:test";
import { workflow as wf } from "../src/index.ts";
import { Draft } from "./support/workflows.ts";

test("Canvas geometry: a node's box grows with its ports; inputs sit on the start edge and outputs on the end edge, `start` and `done` level with each other", () => {
  const draft = new Draft();
  const branch = draft.add("branch");
  const node = draft.doc.nodes.find((entry) => entry.id === branch)!;
  const ports = wf.canvasPorts(node);
  assert.deepEqual(ports.inputs.map((port) => port.id), ["start", "value"]);
  assert.deepEqual(ports.outputs.map((port) => port.id), ["done", "value", "error", "case_1", "else"]);
  const box = wf.nodeBox(node);
  assert.equal(box.width, wf.NODE_SIZE.width);
  // The outputs a step fires by name are rows at the bottom of its card; the others are handles around the middle of its sides.
  assert.deepEqual(ports.outputs.map((port) => port.row), [undefined, undefined, undefined, 0, 1]);
  const body = wf.bodyHeight(node);
  assert.equal(box.height, body + 2 * wf.OUTCOME_ROW + wf.OUTCOME_PAD);
  assert.deepEqual(wf.portPoint(node, "in", "start"), { x: box.x, y: box.y + body / 2 });
  assert.deepEqual(wf.portPoint(node, "in", "value"), { x: box.x, y: box.y + body / 2 + wf.PORT_PITCH });
  assert.deepEqual(wf.portPoint(node, "out", "else"), { x: box.x + box.width, y: box.y + body + 1.5 * wf.OUTCOME_ROW });
  assert.equal(wf.portPoint(node, "out", "nothing"), undefined);
  // The order of a chain leaves and enters at the same height.
  assert.equal(wf.portPoint(node, "out", "done")!.y - box.y, wf.portPoint(node, "in", "start")!.y - box.y);
  // The trigger has no input and keeps the default height.
  assert.equal(wf.nodeBox(draft.doc.nodes[0]).height >= wf.NODE_SIZE.height, true);
  assert.deepEqual(wf.canvasPorts(draft.doc.nodes[0]).inputs, []);
});

test("Canvas geometry: hit-testing finds the port, the node, the edge and the marquee's nodes from a world point", () => {
  const draft = new Draft();
  const wait = draft.add("wait", undefined, {}, { x: 500, y: 200 });
  draft.link("start", wait);
  const doc = draft.doc, target = doc.nodes.find((entry) => entry.id === wait)!, start = doc.nodes[0];
  const into = wf.portPoint(target, "in", "start")!, out = wf.portPoint(start, "out", "done")!;
  assert.deepEqual(wf.portAt(doc, { x: into.x + 5, y: into.y - 4 }, "in"), { node: wait, port: "start" });
  assert.equal(wf.portAt(doc, { x: into.x + 40, y: into.y }, "in"), undefined);
  assert.deepEqual(wf.portAt(doc, out, "out"), { node: "start", port: "done" });
  assert.equal(wf.nodeAt(doc, { x: target.position.x + 20, y: target.position.y + 10 })?.id, wait);
  assert.equal(wf.nodeAt(doc, { x: 5000, y: 5000 }), undefined);
  const ends = wf.edgeEnds(doc, doc.edges[0])!;
  assert.deepEqual(ends, { from: out, to: into });
  const middle = wf.edgeMidpoint(ends.from, ends.to, "control");
  assert.equal(wf.edgeAt(doc, middle)?.id, doc.edges[0].id);
  assert.equal(wf.edgeAt(doc, { x: middle.x, y: middle.y + 60 }), undefined);
  assert.deepEqual(wf.nodesIn(doc, { x: 0, y: 0 }, { x: 400, y: 400 }), ["start"]);
  assert.deepEqual(wf.nodesIn(doc, { x: 900, y: 900 }, { x: 0, y: 0 }).sort(), ["start", wait].sort());
  // An edge is one smooth curve.
  assert.match(wf.edgePath(ends.from, ends.to), /^M [\d.]+ [\d.]+ C [\d. ]+$/);
});

test("Canvas geometry: zoom keeps the point under the pointer, stays inside 25 %–200 %, and fit shows the whole graph", () => {
  const view = { x: 40, y: 20, zoom: 1 }, anchor = { x: 300, y: 200 };
  const before = wf.toWorld(view, anchor);
  const zoomed = wf.zoomAbout(view, anchor, 1.5);
  assert.equal(zoomed.zoom, 1.5);
  assert.deepEqual(wf.toWorld(zoomed, anchor), before);
  assert.deepEqual(wf.toScreen(zoomed, before), anchor);
  assert.equal(wf.zoomAbout(view, anchor, 9).zoom, wf.ZOOM.max);
  assert.equal(wf.zoomAbout(view, anchor, 0.01).zoom, wf.ZOOM.min);
  const draft = new Draft();
  draft.add("wait", undefined, {}, { x: 2000, y: 1400 });
  const size = { width: 800, height: 600 };
  const fit = wf.fitView(draft.doc, size);
  const bounds = wf.boundsOf(draft.doc)!;
  const topLeft = wf.toScreen(fit, { x: bounds.x, y: bounds.y }), bottomRight = wf.toScreen(fit, { x: bounds.x + bounds.width, y: bounds.y + bounds.height });
  assert.equal(topLeft.x >= 47 && topLeft.y >= 47 && bottomRight.x <= size.width - 47 && bottomRight.y <= size.height - 47, true, JSON.stringify({ topLeft, bottomRight }));
  assert.equal(fit.zoom < 1, true);
  // A small graph is centred at 100 %, never enlarged.
  assert.equal(wf.fitView(new Draft().doc, size).zoom, 1);
  assert.deepEqual(wf.fitView({ nodes: [] }, size), { x: 0, y: 0, zoom: 1 });
});

test("Canvas geometry: the minimap holds the graph and the viewport; port colours follow the data type", () => {
  const draft = new Draft();
  draft.add("wait", undefined, {}, { x: 1200, y: 800 });
  const map = wf.minimap(draft.doc, { x: -200, y: -100, zoom: 0.5 }, { width: 800, height: 600 }, { width: 132, height: 84 });
  assert.equal(map.viewRect.x >= 0 && map.viewRect.y >= 0 && map.viewRect.x + map.viewRect.width <= 132.001 && map.viewRect.y + map.viewRect.height <= 84.001, true, JSON.stringify(map));
  assert.equal(map.scale > 0 && map.scale < 1, true);
  assert.equal(wf.portToken("control"), "wf/port/control");
  assert.equal(wf.portToken("list<text>"), "wf/port/text");
  assert.equal(wf.portToken("integer"), "wf/port/scalar");
  assert.equal(wf.portToken("Decision"), "wf/port/json");
  assert.equal(wf.portToken("any"), "wf/port/any");
});

const turns = (points: wf.Point[]) => points.every((point, index) => index === 0 || point.x === points[index - 1].x || point.y === points[index - 1].y);
const clear = (points: wf.Point[], box: wf.Box) => points.every((point, index) => {
  if (index === 0) return true;
  const a = points[index - 1], left = Math.min(a.x, point.x), right = Math.max(a.x, point.x), top = Math.min(a.y, point.y), bottom = Math.max(a.y, point.y);
  return right <= box.x || left >= box.x + box.width || bottom <= box.y || top >= box.y + box.height;
});

test("Edge routing: a route turns only at right angles, leaves to the end and enters from the start, and goes around a card in its way", () => {
  const from = { x: 200, y: 100 }, to = { x: 700, y: 100 }, wall = { x: 400, y: 40, width: 120, height: 120 };
  assert.deepEqual(wf.routeEdge(from, to), [from, to]);
  const around = wf.routeEdge(from, to, [wall]);
  assert.equal(turns(around), true);
  assert.equal(clear(around, wall), true, JSON.stringify(around));
  assert.equal(around[1].x > from.x && around[1].y === from.y, true);
  assert.equal(around[around.length - 2].x < to.x && around[around.length - 2].y === to.y, true);
  // A step down between two columns is one vertical run between them.
  const step = wf.routeEdge(from, { x: 500, y: 300 });
  assert.equal(step.length, 4);
  assert.equal(turns(step), true);
  // A route that runs backwards still leaves to the end and enters from the start.
  const back = wf.routeEdge({ x: 700, y: 100 }, { x: 200, y: 100 }, [{ x: 200, y: 60, width: 500, height: 80 }]);
  assert.equal(turns(back), true);
  assert.equal(back[1].x > 700 && back[back.length - 2].x < 200, true);
  assert.equal(clear(back.slice(1, -1), { x: 200, y: 60, width: 500, height: 80 }), true, JSON.stringify(back));
});

test("Edge routing: corners are rounded, and the label point, the midpoint and the distance follow the route", () => {
  const route = wf.routeEdge({ x: 0, y: 0 }, { x: 300, y: 200 });
  const path = wf.roundedPath(route);
  assert.equal((path.match(/Q/g) ?? []).length, route.length - 2);
  assert.deepEqual(wf.routePoint(route, 0), { x: 0, y: 0 });
  assert.deepEqual(wf.routePoint(route, 1), { x: 300, y: 200 });
  assert.equal(wf.routeDistance(route, wf.routePoint(route, 0.4)), 0);
  assert.equal(wf.routeDistance(route, { x: 150, y: 100 }) < 1, true);
  assert.equal(wf.routeDistance(route, { x: 20, y: 150 }) > 100, true);
  const label = wf.routeLabelPoint(route);
  assert.equal(wf.routeDistance(route, label), 0);
});

test("Edge curves: the line of an edge is a smooth curve between its two ports; a large graph opens readable on its first step", () => {
  const draft = new Draft();
  const a = draft.add("wait", undefined, {}, { x: 420, y: 200 }), b = draft.add("wait", undefined, {}, { x: 720, y: 200 });
  draft.link("start", b);
  const doc = draft.doc, routes = wf.routesOf(doc);
  assert.equal(routes, wf.routesOf(doc));
  const route = routes.get(doc.edges[0].id)!;
  // The line of an edge is a curve from its output to its input that leaves and enters level.
  const ends = wf.edgeEnds(doc, doc.edges[0])!, plain = wf.curveOf(ends.from, ends.to), curve = wf.curvesOf(doc).get(doc.edges[0].id)!;
  assert.deepEqual([route[0], route[route.length - 1]], [ends.from, ends.to]);
  assert.equal(plain[1].y === ends.from.y && plain[1].x > ends.from.x && plain[2].y === ends.to.y && plain[2].x < ends.to.x, true);
  assert.equal(wf.edgeAt(doc, wf.curvePoint(curve, 0.5))?.id, doc.edges[0].id);
  // A line that would run behind the card between its two steps swings clear of it.
  const blocked = wf.nodeBox(doc.nodes.find((node) => node.id === a)!);
  assert.equal(route.every((point) => !(point.x > blocked.x && point.x < blocked.x + blocked.width && point.y > blocked.y && point.y < blocked.y + blocked.height)), true, JSON.stringify(route));
  for (let index = 0; index < 8; index++) draft.add("wait", undefined, {}, { x: 1020 + index * 300, y: 200 });
  const size = { width: 700, height: 500 }, open = wf.openView(draft.doc, size);
  assert.equal(wf.fitView(draft.doc, size).zoom < wf.READABLE_ZOOM, true);
  assert.equal(open.zoom, wf.READABLE_ZOOM);
  const first = wf.toScreen(open, draft.doc.nodes[0].position);
  assert.equal(first.x >= 0 && first.x < 100 && first.y > 0 && first.y < size.height, true, JSON.stringify(first));
  assert.deepEqual(wf.openView(new Draft().doc, size), wf.fitView(new Draft().doc, size, 32));
});

test("Notes take part in layout: auto-layout puts a note above the step it annotates, clear of cards and frames; a note dropped on a card is pushed to the nearest free place", () => {
  const draft = new Draft();
  const a = draft.add("agent", "a"), b = draft.add("approval", "b"), c = draft.add("notify", "c");
  draft.chain("start", a, b, c);
  draft.apply(wf.layoutBatch(draft.doc));
  const cardB = wf.nodeBox(draft.node(b));
  // Dropped across the gap between two cards, over both.
  draft.apply([{ op: "note.add", note: { id: "note", text: "Signs off", x: cardB.x - 100, y: cardB.y, width: 200, height: 100 } }, ...wf.groupOps(draft.doc, [a, b])]);
  const over = (doc: typeof draft.doc) => doc.notes.some((note) => doc.nodes.some((node) => { const box = wf.nodeBox(node); return note.x < box.x + box.width && note.x + note.width > box.x && note.y < box.y + box.height && note.y + note.height > box.y; }));
  assert.equal(over(draft.doc), true);
  const settled = wf.settleNotes(draft.doc);
  assert.equal(settled.length, 1);
  assert.equal(over({ ...draft.doc, notes: draft.doc.notes.map((note) => ({ ...note, ...settled[0] })) }), false);
  const ops = wf.layoutBatch(draft.doc);
  assert.equal(ops.some((op) => op.op === "note.update"), true);
  draft.apply(ops);
  assert.equal(over(draft.doc), false);
  const note = draft.doc.notes[0], frame = draft.doc.groups[0].frame;
  assert.equal(note.y + note.height <= frame.y, true, JSON.stringify({ note, frame }));
  assert.deepEqual(wf.layoutBatch(draft.doc), []);
  // A long name widens its card and the next layer moves away from it.
  draft.apply([{ op: "node.update", id: a, patch: { name: "Write the tagline in three languages" } }]);
  assert.equal(wf.nodeBox(draft.node(a)).width > wf.NODE_SIZE.width && wf.nodeBox(draft.node(a)).width <= wf.NODE_MAX_WIDTH, true);
  draft.apply(wf.layoutBatch(draft.doc));
  assert.equal(draft.node(b).position.x - (draft.node(a).position.x + wf.nodeBox(draft.node(a)).width) >= 80, true);
  // A small graph is never fitted under 90 %; a large one is fitted whole.
  const size = { width: 660, height: 600 };
  assert.equal(wf.fitReadable(draft.doc, size).zoom, wf.SMALL_GRAPH_ZOOM);
  assert.equal(wf.beyond(draft.doc, wf.fitReadable(draft.doc, size), size).end >= 1, true);
  for (let index = 0; index < 8; index++) draft.add("wait", undefined, {}, { x: 2000 + index * 300, y: 200 });
  assert.deepEqual(wf.fitReadable(draft.doc, size), wf.fitView(draft.doc, size));
});

/** Every point of a line of points, with the straight stretches between them filled in every 4 units. */
const dense = (points: wf.Point[]): wf.Point[] => points.flatMap((point, index) => {
  if (index === 0) return [point];
  const a = points[index - 1], steps = Math.max(1, Math.ceil(Math.hypot(point.x - a.x, point.y - a.y) / 4));
  return Array.from({ length: steps }, (_unused, step) => ({ x: a.x + ((point.x - a.x) * (step + 1)) / steps, y: a.y + ((point.y - a.y) * (step + 1)) / steps }));
});
const insideBox = (point: wf.Point, box: wf.Box) => point.x > box.x && point.x < box.x + box.width && point.y > box.y && point.y < box.y + box.height;

test("w7 item 7 — a workflow with a branch, a fan-out, a join, a line that skips two steps and a line that comes back: NO edge is drawn under or through a card", () => {
  const draft = new Draft();
  const at = (x: number, y: number) => ({ x, y });
  const branch = draft.add("branch", "branch", {}, at(440, 200));
  const a = draft.add("wait", "a", {}, at(760, 60)), b = draft.add("wait", "b", {}, at(760, 380));
  const fan = draft.add("parallel", "fan", {}, at(1080, 60)), worker = draft.add("wait", "worker", {}, at(1400, 60));
  const c = draft.add("wait", "c", {}, at(1080, 380)), d = draft.add("wait", "d", {}, at(1400, 380));
  const join = draft.add("join", "join", {}, at(1720, 220)), end = draft.add("wait", "end", {}, at(2040, 220));
  draft.link("start", branch);
  draft.link(`${branch}.case_1`, a); draft.link(`${branch}.else`, b);
  draft.chain(a, fan, worker, join, end);
  draft.chain(b, c, d);
  // The line that skips: from the first card of the lower row straight to the join, with two cards of its row between them.
  const skipping = draft.link(`${b}.error`, join);
  // The line that comes back: a step someone dragged to the far end feeds a step at the near end, with a card between them.
  const far = draft.add("wait", "far", {}, at(2040, 600)), near = draft.add("wait", "near", {}, at(1080, 640));
  draft.add("wait", "between", {}, at(1540, 640));
  const back = draft.link(far, near);
  const doc = draft.doc, boxes = new Map(doc.nodes.map((node) => [node.id, wf.nodeBox(node)]));
  // What was drawn before: the plain curve, which ran through cards for these two.
  const curves = wf.curvesOf(doc);
  const throughCards = (edgeId: string, points: wf.Point[]) => { const edge = doc.edges.find((entry) => entry.id === edgeId)!; return [...boxes].filter(([id, box]) => id !== edge.from.node && id !== edge.to.node && points.some((point) => insideBox(point, box))).map(([id]) => id); };
  const before = Object.fromEntries([skipping, back].map((id) => [id, throughCards(id, dense(wf.curvePoints(curves.get(id)!)))]));
  assert.ok(before[skipping].length > 0 || before[back].length > 0, `the plain curves of this graph do run through cards (the defect): ${JSON.stringify(before)}`);
  // What is drawn now.
  const lines = wf.edgeLines(doc);
  assert.equal(lines.size, doc.edges.length);
  const crossing = doc.edges.flatMap((edge) => { const hit = throughCards(edge.id, dense(lines.get(edge.id)!.points)); return hit.length ? [`${edge.from.node}.${edge.from.port} → ${edge.to.node}.${edge.to.port} runs through ${hit.join(", ")}`] : []; });
  assert.deepEqual(crossing, []);
  // An edge does not run through its own two cards either (it only touches them at its ports).
  for (const edge of doc.edges) {
    const points = dense(lines.get(edge.id)!.points).slice(6, -6);
    for (const id of [edge.from.node, edge.to.node]) assert.equal(points.some((point) => insideBox(point, boxes.get(id)!)), false, `${edge.id} runs through its own card ${id}`);
  }
  // The edges that had a clear curve keep it; the two that did not are routes of straight runs with rounded corners, from port to port.
  assert.equal(lines.get(skipping)!.routed || lines.get(back)!.routed, true);
  for (const id of [skipping, back].filter((entry) => lines.get(entry)!.routed)) {
    const line = lines.get(id)!, ends = wf.edgeEnds(doc, doc.edges.find((edge) => edge.id === id)!)!;
    assert.deepEqual([line.points[0], line.points.at(-1), line.tip], [ends.from, ends.to, ends.to]);
    assert.equal(turns(line.points), true);
    assert.match(line.d, /^M [\d.-]+ [\d.-]+ L .* Q /);
    // It leaves its output to the end and enters its input from the start.
    assert.equal(line.points[1].x > ends.from.x && line.points.at(-2)!.x < ends.to.x, true);
    // Its label and its hit-testing follow the route.
    assert.equal(wf.routeDistance(line.points, line.mid), 0);
    assert.equal(wf.edgeAt(doc, line.mid)?.id !== undefined, true);
  }
  assert.equal(doc.edges.filter((edge) => !lines.get(edge.id)!.routed).length >= 6, true, "the plain chain keeps its curves");
});

test("w7 item 7 — the searching router finds the way through a field of cards, and says so when there is none", () => {
  // Three cards in the way, staggered: no single lane above or below clears them, the way through is a zig-zag.
  const from = { x: 100, y: 300 }, to = { x: 1000, y: 300 };
  const field = [{ x: 250, y: 0, width: 120, height: 420 }, { x: 480, y: 180, width: 120, height: 600 }, { x: 710, y: 0, width: 120, height: 420 }];
  const route = wf.routeClear(from, to, field)!;
  assert.ok(route, "a route exists");
  assert.equal(turns(route), true);
  for (const box of field) assert.equal(dense(route).some((point) => point.x > box.x - 9 && point.x < box.x + box.width + 9 && point.y > box.y - 9 && point.y < box.y + box.height + 9), false, `clear of ${JSON.stringify(box)}: ${JSON.stringify(route)}`);
  assert.deepEqual([route[0], route.at(-1)], [from, to]);
  // A port walled in on every side has no clear route.
  assert.equal(wf.routeClear({ x: 100, y: 300 }, { x: 1000, y: 300 }, [{ x: 105, y: 0, width: 40, height: 800 }]), undefined);
});
