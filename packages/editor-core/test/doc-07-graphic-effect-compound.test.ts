import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "@jagentchill/protocol";
import {
  addDrawing, addEffectLayer, addShape, addStroke, createCompound, createMulticam, freezeFrame, sceneDuration, setAudioFollowsVideo, setElementFields, switchAngle,
  upsertKeyframe, audioAngleOf,
} from "../src/index.ts";
import { assertFails, assertValid, context, element, put, rejected, SECOND, shape, studio, track, tweak, video } from "./support/fixtures.ts";

// Requirement: Graphic element
test("Graphic element — Scenario: Star", () => {
  const after = addShape(studio(), context({ newId: () => "star1" }), "t-graphic", "star", { startTime: 0, duration: 3 * SECOND }).document;
  const stored = element(after, "star1");
  assert.equal(stored.definitionId, "star");
  assert.deepEqual(stored.params, { fill: "#ffffff", stroke: "#000000", strokeWidth: 0, strokeAlign: "center", points: 5, depth: 45 });
  assert.deepEqual(shape("l", "line").params, { stroke: "#ffffff", strokeWidth: 8, lineCap: "round", dash: 0 }, "a line has its own stroke defaults");
  assertValid(after);
  assertFails(put(studio(), "t-graphic", { ...shape("g", "star"), definitionId: "blob" }), "document/unknown-definition", "/definitionId");
});

test("Graphic element — Scenario: Foreign key in params", () => {
  const rectangle = shape("r", "rectangle") as any;
  const error = assertFails(put(studio(), "t-graphic", { ...rectangle, params: { ...rectangle.params, sides: 6 } }), "document/field-not-allowed");
  assert.equal(error.path, "/scenes/@s1/tracks/overlay/@t-graphic/elements/@r/params/sides");
  assertFails(put(studio(), "t-graphic", { ...rectangle, params: { ...rectangle.params, opacity: 0.5 } }), "document/field-not-allowed", "/params/opacity");
  assertFails(put(studio(), "t-graphic", { ...rectangle, strokes: [] }), "document/field-not-allowed", "/strokes");
});

test("Graphic element — Scenario: Animated shape parameter", () => {
  const before = put(studio(), "t-graphic", shape("star1", "star"));
  const after = upsertKeyframe(before, context(), "star1", "params.depth", { time: SECOND, value: 60 }).document;
  assert.deepEqual(Object.keys(element(after, "star1").animations), ["params.depth"]);
  assertValid(after);
  rejected(() => upsertKeyframe(before, context(), "star1", "params.sides", { time: 0, value: 6 }), "document/animation-path-invalid");
  rejected(() => upsertKeyframe(before, context(), "star1", "params.strokeAlign", { time: 0, value: "inside" }), "document/animation-path-invalid");
});

// Requirement: Freehand drawing geometry
const line = { points: [[-50, -50], [250, -50]] as [number, number][], width: 12 };

test("Freehand drawing geometry — Scenario: One stroke", () => {
  const after = addDrawing(studio(), context({ newId: (() => { let n = 0; return () => `d${++n}`; })() }), "t-graphic", [line], { startTime: 0, duration: 3 * SECOND }).document;
  const drawing = track(after, "t-graphic").elements[0];
  assert.deepEqual([drawing.intrinsicWidth, drawing.intrinsicHeight], [312, 12]);
  assert.deepEqual(drawing.transform.position, { x: 100, y: -50 });
  assert.equal(drawing.strokes.length, 1);
  assert.deepEqual([drawing.strokes[0].points[0], drawing.strokes[0].points.at(-1)], [[-150, 0], [150, 0]]);
  assert.deepEqual([drawing.strokes[0].width, drawing.strokes[0].color, drawing.strokes[0].brush, drawing.params], [12, "#ffffff", "pen", { colorOverride: "" }]);
  assertValid(after);
});

test("Freehand drawing geometry — Scenario: Empty drawing", () => {
  const drawing = createElement("graphic", { id: "d", name: "Drawing", startTime: 0, duration: SECOND, definitionId: "drawing", intrinsicWidth: 10, intrinsicHeight: 10, strokes: [{ id: "st", points: [[0, 0], [1, 1]] }] });
  assertValid(put(studio(), "t-graphic", drawing));
  assertFails(put(studio(), "t-graphic", { ...drawing, strokes: [] }), "document/out-of-range", "/elements/@d/strokes");
  assertFails(put(studio(), "t-graphic", { ...drawing, strokes: [{ id: "st", points: [[0, 0]], width: 12, color: "#ffffff", brush: "pen" }] }), "document/out-of-range", "/points");
  assertFails(put(studio(), "t-graphic", { ...drawing, strokes: [{ id: "st", points: [[0, 0], [1, 1]] }, { id: "st", points: [[0, 0], [2, 2]] }] }), "document/duplicate-id");
});

test("Freehand drawing geometry — Scenario: Adding a stroke keeps the old ones in place", () => {
  const ctx = context();
  const first = addDrawing(studio(), ctx, "t-graphic", [line], { startTime: 0, duration: 3 * SECOND }).document;
  const id = track(first, "t-graphic").elements[0].id;
  const before = element(first, id);
  // A second stroke 200 px to the right of the first one's right end.
  const after = element(addStroke(first, ctx, id, { points: [[450, -50], [450, 10]], width: 12 }).document, id);
  assert.ok(after.intrinsicWidth > before.intrinsicWidth, "the bounding box grows");
  assert.equal(after.transform.position.x - before.transform.position.x, (after.intrinsicWidth - before.intrinsicWidth) / 2, "the position shifts by half the growth");
  const onCanvas = (drawing: any) => drawing.strokes[0].points.map(([x, y]: number[]) => [x + drawing.transform.position.x, y + drawing.transform.position.y]);
  assert.deepEqual(onCanvas(after), onCanvas(before), "the first stroke renders at the same canvas pixels");
  assert.equal(after.strokes.length, 2);
});

// Requirement: Effect element
test("Effect element — Scenario: Blur layer", () => {
  const after = addEffectLayer(studio(), context(), "t-effect", { type: "blur", kind: "effect" }, { startTime: 0, duration: 3 * SECOND }).document;
  const layer = track(after, "t-effect").elements[0];
  assert.deepEqual([layer.type, layer.target, layer.hidden], ["effect", "beneath", false]);
  assert.deepEqual(layer.effects.map(({ id: _id, ...rest }: any) => rest), [{ type: "blur", kind: "effect", enabled: true, params: { intensity: 15 } }]);
  for (const key of ["transform", "opacity", "masks", "adjustments", "retime", "clipAnimation", "transitionIn", "volume", "effectType", "params"]) assert.equal(key in layer, false, key);
  assertValid(after);
  assertFails(put(studio(), "t-effect", { ...layer, id: "old", effectType: "blur" }), "document/field-not-allowed", "/effectType");
});

test("Effect element — Scenario: Two entries", () => {
  const layer = track(addEffectLayer(studio(), context(), "t-effect", { type: "blur", kind: "effect" }, { startTime: 0, duration: 3 * SECOND }).document, "t-effect").elements[0];
  const two = { ...layer, effects: [layer.effects[0], { ...layer.effects[0], id: "second" }] };
  assertFails(put(studio(), "t-effect", two), "document/effects-limit", "/effects");
  assertFails(put(studio(), "t-effect", { ...layer, effects: [] }), "document/effects-limit");
});

test("Effect element — Scenario: Keyframing a layer parameter", () => {
  const ctx = context();
  const made = addEffectLayer(studio(), ctx, "t-effect", { type: "blur", kind: "effect" }, { startTime: 0, duration: 3 * SECOND }).document;
  const layer = track(made, "t-effect").elements[0];
  const after = upsertKeyframe(made, ctx, layer.id, `effects.${layer.effects[0].id}.params.intensity`, { time: SECOND, value: 40 }).document;
  assert.deepEqual(Object.keys(element(after, layer.id).animations), [`effects.${layer.effects[0].id}.params.intensity`]);
  assertValid(after);
  // The classic path `params.<key>` does not exist on an effect element.
  rejected(() => upsertKeyframe(made, ctx, layer.id, "params.intensity", { time: SECOND, value: 40 }), "document/animation-path-invalid");
});

// Requirement: Adjustment element
const adjustment = (extra = {}) => createElement("adjustment", { id: "adj", name: "Adjustment", startTime: 0, duration: 3 * SECOND, ...extra });

test("Adjustment element — Scenario: Half-strength adjustment layer", () => {
  const before = put(studio(), "t-adjust", adjustment());
  const after = setElementFields(before, context(), "adj", { opacity: 0.5 }).document;
  assert.equal(element(after, "adj").opacity, 0.5);
  for (const key of ["transform", "blendMode", "crop", "retime", "clipAnimation", "volume"]) assert.equal(key in element(after, "adj"), false, key);
  assertValid(upsertKeyframe(after, context(), "adj", "opacity", { time: 0, value: 0.2 }).document);
});

test("Adjustment element — Scenario: Effect entry on an adjustment layer", () => {
  const entry = (kind: string, id: string) => ({ id, type: kind === "filter" ? "warm-film" : "blur", kind, enabled: true, params: { intensity: 50 } });
  assertValid(put(studio(), "t-adjust", adjustment({ effects: [entry("filter", "f1")] })));
  assertFails(put(studio(), "t-adjust", { ...adjustment(), effects: [entry("effect", "f1")] }), "document/effects-limit");
  assertFails(put(studio(), "t-adjust", { ...adjustment(), effects: [entry("filter", "f1"), entry("filter", "f2")] }), "document/effects-limit");
});

test("Adjustment element — Scenario: Opacity out of range", () => {
  const before = put(studio(), "t-adjust", adjustment());
  const errors = rejected(() => setElementFields(before, context(), "adj", { opacity: 50 }), "document/out-of-range");
  assert.ok(errors[0].path.endsWith("/elements/@adj/opacity"));
});

// Requirement: Compound element
const three = () => put(studio(), "main", video("c1", 0, 2), video("c2", 2, 2), video("c3", 4, 2), video("rest", 6, 2));

test("Compound element — Scenario: Compound references a compound scene", () => {
  const after = createCompound(three(), context(), ["c1", "c2", "c3"]).document;
  const clip = track(after, "t-main").elements[0];
  const scene = after.scenes.find((candidate) => candidate.id === clip.sceneId)!;
  assert.deepEqual([clip.type, scene.kind, scene.isMain], ["compound", "compound", false]);
  assert.equal(clip.sourceDuration, sceneDuration(scene));
  assert.deepEqual([clip.startTime, clip.duration], [0, 6 * SECOND]);
  assert.deepEqual(scene.tracks.main.elements.map((entry) => entry.id), ["c1", "c2", "c3"]);
  for (const key of ["chromaKey", "cutout", "stabilization", "mediaId"]) assert.equal(key in clip, false, key);
  assertValid(after);
  assertFails(tweak(after, (draft) => { draft.scenes[0].tracks.main.elements[0].sceneId = "nowhere"; }), "document/unknown-scene", "/sceneId");
});

test("Compound element — Scenario: Self-reference", () => {
  const made = createCompound(three(), context(), ["c1", "c2", "c3"]).document;
  const clip = track(made, "t-main").elements[0];
  const index = made.scenes.findIndex((candidate) => candidate.id === clip.sceneId);
  const patched = tweak(made, (draft) => { draft.scenes[index].tracks.main.elements = [{ ...clip, id: "inner" }]; });
  assertFails(patched, "document/compound-cycle");
  // A chain nine scenes deep exceeds the nesting limit.
  const deep = tweak(made, (draft) => {
    let previous = clip.sceneId;
    for (let level = 0; level < 9; level++) {
      const id = `deep${level}`;
      draft.scenes.push({ ...draft.scenes[index], id, name: id, tracks: { overlay: [], main: { ...draft.scenes[index].tracks.main, id: `main-${id}`, elements: [] }, audio: [] } });
      draft.scenes.find((scene: any) => scene.id === previous).tracks.main.elements = [{ ...clip, id: `link${level}`, sceneId: id, startTime: 0 }];
      previous = id;
    }
  });
  assertFails(deep, "document/compound-depth");
});

test("Compound element — Scenario: Curve on a compound", () => {
  const made = createCompound(three(), context(), ["c1", "c2", "c3"]).document;
  const curve = { preset: "custom", points: [{ u: 0, rate: 1 }, { u: 1, rate: 2 }] };
  const errors = rejected(() => setElementFields(made, context(), track(made, "t-main").elements[0].id, { retime: { rate: 1.5, maintainPitch: false, reverse: false, smooth: "none", curve } }), "document/field-not-allowed");
  assert.ok(errors[0].path.endsWith("/retime/curve"));
  assertValid(setElementFields(made, context(), track(made, "t-main").elements[0].id, { retime: { rate: 2, maintainPitch: true, reverse: true, smooth: "none" } }).document, {});
});

// Requirement: Multi-camera clip
const multicam = () => {
  const ctx = context();
  const doc = put(studio(), "t-video", video("camA", 0, 10, { sourceDuration: 10 * SECOND }), video("camB", 10, 10, { sourceDuration: 10 * SECOND }));
  const made = createMulticam(doc, ctx, [{ elementId: "camA", syncOffset: 0, name: "A" }, { elementId: "camB", syncOffset: 0, name: "B" }], "start");
  const scene = made.document.scenes.find((candidate) => candidate.id === made.sceneId)!;
  return { ctx, doc: made.document, sceneId: made.sceneId, clipId: track(made.document, "t-video").elements[0].id as string, angles: scene.multicam!.angles.map((angle) => angle.id) };
};

test("Multi-camera clip — Scenario: Switch angle at the playhead", () => {
  const { ctx, doc, clipId, angles: [a, b] } = multicam();
  const commit = switchAngle(doc, ctx, clipId, 4 * SECOND, b);
  const parts = track(commit.document, "t-video").elements;
  assert.deepEqual(parts.map((part: any) => [part.type, part.startTime, part.duration, part.multicam.angleId]), [["compound", 0, 4 * SECOND, a], ["compound", 4 * SECOND, 6 * SECOND, b]]);
  assert.equal(commit.history, true, "one undo step");
  assertValid(commit.document);
  // On a part's first frame the angle is rewritten without a split.
  const rewritten = switchAngle(commit.document, ctx, parts[1].id, 4 * SECOND, a).document;
  assert.equal(track(rewritten, "t-video").elements.length, 1, "two adjacent parts on one angle with continuous source are merged");
});

test("Multi-camera clip — Scenario: Audio follows video", () => {
  const { ctx, doc, sceneId, clipId, angles: [a, b] } = multicam();
  const split = switchAngle(doc, ctx, clipId, 4 * SECOND, b).document;
  const commit = setAudioFollowsVideo(split, ctx, sceneId, true);
  assert.deepEqual(commit.patch.filter((entry) => entry.path !== "/metadata/updated_ms"), [{ op: "replace", path: `/scenes/@${sceneId}/multicam/audioFollowsVideo`, value: true }], "one patch on the scene, none on the parts");
  const scene = commit.document.scenes.find((candidate) => candidate.id === sceneId)!;
  assert.deepEqual(track(commit.document, "t-video").elements.map((part: any) => audioAngleOf(scene, part)), [a, b], "each part is heard from its own active angle");
  assert.deepEqual(track(split, "t-video").elements.map((part: any) => audioAngleOf(split.scenes.find((candidate) => candidate.id === sceneId)!, part)), [a, a]);
});

test("Multi-camera clip — Scenario: Unknown angle", () => {
  const { doc } = multicam();
  assertFails(tweak(doc, (draft) => { draft.scenes[0].tracks.overlay[0].elements[0].multicam.angleId = "zz"; }), "document/multicam-invalid", "/multicam");
  assertFails(tweak(doc, (draft) => { delete draft.scenes[0].tracks.overlay[0].elements[0].multicam; }), "document/multicam-invalid");
  const plain = createCompound(three(), context(), ["c1"]).document;
  assertFails(tweak(plain, (draft) => { draft.scenes[0].tracks.main.elements[0].multicam = { angleId: "a" }; }), "document/multicam-invalid");
});

// Requirement: Freeze field (the compound case uses the fixtures of this file)
test("Freeze field — Scenario: Compound freeze", () => {
  const made = createCompound(three(), context(), ["c1", "c2", "c3"]).document;
  const clip = track(made, "t-main").elements[0];
  const after = freezeFrame(made, context({ newId: () => "fz" }), clip.id, 120_000, { trackId: "t-video", startTime: 0 }).document;
  const frozen = element(after, "fz");
  assert.deepEqual([frozen.type, frozen.sceneId, frozen.freeze], ["compound", clip.sceneId, { sourceTime: 120_000 }]);
  assert.equal("sourceDuration" in frozen, false);
  assertValid(after);
  assertFails(tweak(after, (draft) => { draft.scenes[0].tracks.overlay[0].elements[0].freeze.mediaId = "a1"; }), "document/field-not-allowed", "/freeze/mediaId");
});
