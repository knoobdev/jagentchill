import assert from "node:assert/strict";
import { test } from "node:test";
import { addStickerItem, parseStickerId, pushRecentSticker, addDrawingAt, simplifyStroke, strokeHit, type DrawnStroke, addShapeItem, coerceShapeParam, initialStickerScale, resolveShapeId, searchShapes, setShapeParams, SHAPE_ITEMS, shapeOutline, timeline, upsertKeyframe } from "../src/index.ts";
import { context, element, put, rejected, shape, studio } from "./support/fixtures.ts";
import { el, isValid, ON, open, project, S } from "./support/timeline.ts";

// Requirement: Shape items
test("Shape items — Scenario: Add a shape", () => {
  assert.deepEqual(SHAPE_ITEMS.map((item) => item.name), ["Rectangle", "Ellipse", "Polygon", "Star", "Line", "Arrow"]);
  const session = open(project());
  assert.ok(session.execute(addShapeItem({ sceneId: "s1", shapeId: "star", time: 2 * S }), ON).ok);
  const added = el(session.document, session.selection.selectedElements[0]);
  assert.deepEqual([added.type, added.definitionId, added.startTime, added.params.points], ["graphic", "star", 2 * S, 5]);
  assert.ok(isValid(session.document));
  assert.deepEqual(searchShapes("circle").map((item) => item.id), ["ellipse"]);
});
test("Shape items — Scenario: Legacy id", () => {
  assert.deepEqual(resolveShapeId("shapes:hexagon"), { definitionId: "polygon", params: { sides: 6 } });
  assert.deepEqual([resolveShapeId("square")?.definitionId, resolveShapeId("circle")?.definitionId, resolveShapeId("triangle")?.params.sides, resolveShapeId("diamond")?.params.sides, resolveShapeId("drawing")], ["rectangle", "ellipse", 3, 4, null]);
  const session = open(project());
  session.execute(addShapeItem({ sceneId: "s1", shapeId: "shapes:hexagon", time: 0 }), ON);
  assert.deepEqual([el(session.document, session.selection.selectedElements[0]).definitionId, el(session.document, session.selection.selectedElements[0]).params.sides], ["polygon", 6]);
});

// Requirement: Sticker intrinsic size and initial scale
test("Sticker intrinsic size and initial scale — Scenario: Initial size", () => {
  assert.equal(initialStickerScale({ width: 512, height: 256 }, { width: 1080, height: 1920 }), 0.527);
  const session = open(project());
  session.execute(addShapeItem({ sceneId: "s1", shapeId: "rectangle", time: 0, position: { x: 100, y: -50 } }), ON);
  const added = el(session.document, session.selection.selectedElements[0]);
  // A shape is 200 px at scale 1: 25 % of 1080 is 270 px.
  assert.deepEqual([added.transform.scale, added.transform.position], [{ x: 1.35, y: 1.35 }, { x: 100, y: -50 }]);
});

// Requirement: Shape parameter table
test("Shape parameter table — Scenario: Rounded rectangle", () => {
  const doc = put(studio(), "t-graphic", shape("r", "rectangle"));
  const after = element(setShapeParams(doc, context(), ["r"], { cornerRadius: 80, fill: "#ff0000" }).document, "r");
  assert.deepEqual([after.params.cornerRadius, after.params.fill], [50, "#ff0000"]);
  assert.match(shapeOutline("rectangle", { cornerRadius: 50 }), /A46 46/);
});
test("Shape parameter table — Scenario: Polygon limits", () => {
  assert.deepEqual([coerceShapeParam("polygon", "sides", 2), coerceShapeParam("polygon", "sides", 20), coerceShapeParam("star", "depth", 0), coerceShapeParam("line", "strokeWidth", 0)], [3, 12, 1, 1]);
  assert.equal(rejected(() => coerceShapeParam("ellipse", "sides", 4)).length, 1);
  assert.equal(shapeOutline("polygon", { sides: 3 }).split("L").length, 3);
});

// Requirement: Shape stroke
test("Shape stroke — a stroke is a colour, a width of 0–64 and an alignment", () => {
  const doc = put(studio(), "t-graphic", shape("e", "ellipse"));
  const after = element(setShapeParams(doc, context(), ["e"], { stroke: "#00ff00", strokeWidth: 99, strokeAlign: "outside" }).document, "e");
  assert.deepEqual([after.params.stroke, after.params.strokeWidth, after.params.strokeAlign], ["#00ff00", 64, "outside"]);
});

// Requirement: Shape parameters are keyframable
test("Shape parameters are keyframable — a numeric parameter takes keyframes on `params.<key>`", () => {
  const doc = put(studio(), "t-graphic", shape("s", "star"));
  const ctx = context();
  const keyed = upsertKeyframe(upsertKeyframe(doc, ctx, "s", "params.depth", { time: 0, value: 20 }).document, ctx, "s", "params.depth", { time: 2 * S, value: 80 }).document;
  assert.equal(element(keyed, "s").animations["params.depth"].keys.length, 2);
  assert.equal(rejected(() => upsertKeyframe(doc, context(), "s", "params.strokeAlign", { time: 0, value: "inside" })).length, 1);
});

// Requirement: Freehand drawing — the Draw tool's own pieces (the stored geometry is covered with the drawing operations above)
test("Freehand drawing — Scenario: Smoothing (the Draw tool)", () => {
  const line = Array.from({ length: 200 }, (_, index) => [200 + index * 4.5, 300] as [number, number]);
  assert.deepEqual(simplifyStroke(line), [[200, 300], [200 + 199 * 4.5, 300]]);
  // A corner survives, a wobble of under a pixel does not.
  assert.deepEqual(simplifyStroke([[0, 0], [50, 0.4], [100, 0], [100, 50], [100, 100]]), [[0, 0], [100, 0], [100, 100]]);
});
test("Freehand drawing — Scenario: Draw and commit, Drawing appears where it was drawn (the Draw tool)", () => {
  const session = open(project());
  // Canvas points (200, 300) → (1100, 300) of a 1920 × 1080 canvas, given from the canvas centre.
  const stroke = (y: number): DrawnStroke => ({ points: Array.from({ length: 50 }, (_, index) => [200 - 960 + (index * 900) / 49, y - 540] as [number, number]), width: 12, color: "#ffffff", brush: "pen" });
  const result = session.execute(addDrawingAt({ sceneId: "s1", strokes: [stroke(300)], time: 2 * S }), ON);
  assert.ok(result.ok);
  const drawing = el(session.document, session.selection.selectedElements[0]);
  assert.deepEqual([drawing.definitionId, drawing.startTime, drawing.intrinsicWidth, drawing.intrinsicHeight, drawing.transform.position], ["drawing", 2 * S, 912, 12, { x: 650 - 960, y: 300 - 540 }]);
  assert.deepEqual(drawing.strokes[0].points, [[-450, 0], [450, 0]]);
  assert.ok(isValid(session.document));
  // Three strokes are one element, and one undo removes it.
  const three = open(project());
  three.execute(addDrawingAt({ sceneId: "s1", strokes: [stroke(300), stroke(400), stroke(500)], time: 0 }), ON);
  assert.equal(el(three.document, three.selection.selectedElements[0]).strokes.length, 3);
  three.undo();
  assert.equal(timeline.elementsOfScene(timeline.sceneById(three.document, "s1")).filter((element) => element.type === "graphic").length, 0);
});
test("Freehand drawing — Scenario: Erase (the Draw tool)", () => {
  const strokes: DrawnStroke[] = [0, 100, 200].map((y) => ({ points: [[0, y], [300, y]], width: 12, color: "#ffffff", brush: "pen" }));
  assert.deepEqual(strokes.map((stroke) => strokeHit(stroke, [150, 103], 4)), [false, true, false]);
});

// Requirement: Sticker identifiers, Emoji stickers, Sticker settings persistence
test("Sticker identifiers — Scenario: Valid id, Invalid id", () => {
  assert.deepEqual(parseStickerId("flags:JP"), { provider: "flags", value: "JP" });
  assert.deepEqual(parseStickerId("user:ab:cd"), { provider: "user", value: "ab:cd" });
  assert.deepEqual([parseStickerId("flags:"), parseStickerId(":x"), parseStickerId("nocolon")], [null, null, null]);
  const session = open(project());
  assert.equal(session.execute(addStickerItem({ sceneId: "s1", stickerId: "flags:", width: 512, height: 512, time: 0 }), ON).ok, false);
  assert.equal(timeline.elementsOfScene(timeline.sceneById(session.document, "s1")).filter((element) => element.type === "sticker").length, 0);
});
test("Emoji stickers — Scenario: Add an emoji", () => {
  const session = open(project());
  assert.ok(session.execute(addStickerItem({ sceneId: "s1", stickerId: "emoji:1f600", name: "grinning face", width: 512, height: 512, time: 3 * S }), ON).ok);
  const added = el(session.document, session.selection.selectedElements[0]);
  // 25 % of the shorter canvas side (1080) over 512 px.
  assert.deepEqual([added.type, added.stickerId, added.intrinsicWidth, added.intrinsicHeight, added.startTime, added.transform.scale.x], ["sticker", "emoji:1f600", 512, 512, 3 * S, 0.527]);
  assert.ok(isValid(session.document));
});
test("Sticker settings persistence — the recents are sanitised against known providers and de-duplicated", () => {
  assert.deepEqual(pushRecentSticker(["emoji:1f600", "logos:acme", "shapes:star", "emoji:1f600"], "shapes:star"), ["shapes:star", "emoji:1f600"]);
});
