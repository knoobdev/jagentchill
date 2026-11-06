import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addColorCurvePoint, addLut, addMaskOfType, addPathPoint, adjustmentValue, applyLookToAll, applyLut, autoAdjustValues, averageColor, blendModeOf, BLEND_MODE_NAMES, clampPuck, colorCurveAt, copyLook, dragMaskHandle, duplicateMask,
  featherFromDrag, isMaskable, lutIdOf, LutRejected, MASK_LIMIT_MESSAGE, MASK_MENU, maskDisplay, maskFrame, maskHandles, maskStored, moveColorCurvePoint, parseLut, pasteLook, pictureStats, removeColorCurvePoint, removeMask, removePathPoints,
  reorderMask, resetAdjustments, resetChromaKey, resetMask, rotationFromDrag, sectionModified, setAdjustment, setChromaKey, setColorCurve, setKeyframe, setMaskField, setMaskParams, setPathClosed, setSectionEnabled, setWheel,
} from "../src/index.ts";
import { context, ids, image, put, text, video } from "./support/fixtures.ts";
import { el, open, project, S, withTracks } from "./support/timeline.ts";

const CTX = context({ newId: ids("c") });
const clip = (id = "v", start = 0, seconds = 10, extra: Record<string, unknown> = {}) => video(id, start, seconds, { sourceDuration: 60 * S, trimEnd: (60 - seconds) * S, ...extra });
const doc0 = () => put(project(), "t-main", clip("v"), clip("w", 10));
const refused = (run: () => unknown): any => { try { run(); } catch (error: any) { return error; } throw new Error("the command was not refused"); };

test("Adjustment data model, Basic adjustment sliders, Reset adjustments, Keyframing adjustments: a slider writes its section with defaults; several clips in one step; a keyed slider writes a key; reset removes the section and its keys", () => {
  const session = open(doc0()), steps = session.historyLength;
  session.adoptCommit(setAdjustment(session.document, CTX, ["v", "w"], "adjustments.basic.exposure", 24, 0), session.document);
  const basic = el(session.document, "v").adjustments.basic;
  assert.deepEqual([basic.exposure, basic.enabled, basic.contrast, Object.keys(el(session.document, "v").adjustments), el(session.document, "w").adjustments.basic.exposure, session.historyLength - steps], [24, true, 0, ["basic"], 24, 1]);
  assert.deepEqual([sectionModified(el(session.document, "v"), "basic"), sectionModified(el(session.document, "v"), "hsl"), adjustmentValue(el(session.document, "v"), "adjustments.basic.contrast", 0), adjustmentValue(clip() as never, "adjustments.basic.hue", 0)], [true, false, 0, 0]);
  let doc = setKeyframe(session.document, CTX, "v", "adjustments.basic.exposure", { time: 0, value: 0 }).document;
  doc = setAdjustment(doc, CTX, ["v"], "adjustments.basic.exposure", 60, 2 * S);
  assert.deepEqual([el(doc.document, "v").animations["adjustments.basic.exposure"].keys.map((key: any) => [key.time, key.value]), el(doc.document, "v").adjustments.basic.exposure, adjustmentValue(el(doc.document, "v"), "adjustments.basic.exposure", S)], [[[0, 0], [2 * S, 60]], 24, 30]);
  const off = setSectionEnabled(doc.document, CTX, ["v"], "basic", false).document;
  assert.equal(el(off, "v").adjustments.basic.enabled, false);
  const reset = resetAdjustments(off, CTX, ["v"], "basic").document;
  assert.deepEqual([el(reset, "v").adjustments, el(reset, "v").animations, el(reset, "w").adjustments.basic.exposure], [undefined, undefined, 24]);
  assert.equal(el(resetAdjustments(off, CTX, ["v", "w"]).document, "w").adjustments, undefined);
});

test("Curves and Colour wheels: add, move within neighbours, remove; the 17th point is refused; the puck stays inside the unit disc and its values are keyframable", () => {
  const start = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  const added = addColorCurvePoint(start, 0.25, 0.4)!;
  assert.deepEqual([added.points, added.index], [[{ x: 0, y: 0 }, { x: 0.25, y: 0.4 }, { x: 1, y: 1 }], 1]);
  assert.deepEqual(moveColorCurvePoint(added.points, 1, { x: 2, y: -1 })[1], { x: 0.99, y: 0 });
  assert.deepEqual([moveColorCurvePoint(added.points, 0, { x: 0.9, y: 0.1 })[0], moveColorCurvePoint(added.points, 2, { x: 0.1, y: 0.9 })[2]], [{ x: 0.24, y: 0.1 }, { x: 0.5, y: 0.9 }]);
  assert.deepEqual([removeColorCurvePoint(added.points, 0).length, removeColorCurvePoint(added.points, 1).length], [3, 2]);
  const full = Array.from({ length: 16 }, (_, index) => ({ x: index / 15, y: index / 15 }));
  assert.equal(addColorCurvePoint(full, 0.03), null);
  assert.equal(refused(() => setColorCurve(doc0(), CTX, ["v"], "master", [...full, { x: 1, y: 1 }])).message, "Maximum of 16 points");
  // The monotone curve passes through its points and never overshoots between them.
  const curve = [{ x: 0, y: 0 }, { x: 0.3, y: 0.2 }, { x: 0.62, y: 0.7 }, { x: 1, y: 1 }];
  assert.ok(Math.abs(colorCurveAt(curve, 0.62) - 0.7) < 1e-9 && colorCurveAt(curve, 0.45) > 0.2 && colorCurveAt(curve, 0.45) < 0.7);
  const stored = setColorCurve(doc0(), CTX, ["v"], "red", curve).document;
  assert.deepEqual([el(stored, "v").adjustments.curves.red, el(stored, "v").adjustments.curves.master], [curve, start]);
  assert.deepEqual(clampPuck(3, 4), { x: 0.6, y: 0.8 });
  const wheel = setWheel(doc0(), CTX, ["v"], "highlights", { x: 3, y: 4, luminance: 12 }, 0).document;
  assert.deepEqual(el(wheel, "v").adjustments.wheels.highlights, { x: 0.6, y: 0.8, luminance: 12 });
  assert.ok(setKeyframe(wheel, CTX, "v", "adjustments.wheels.highlights.x", { time: S, value: 0.2 }).document);
});

test("LUT import: a 3D cube, a 1D cube, a 3dl file; the stated parsing errors; the same file imports once; LUT applied and removed", () => {
  const cube = ["TITLE \"Warm\"", "LUT_3D_SIZE 2", ...Array.from({ length: 8 }, (_, index) => `${index & 1} ${(index >> 1) & 1} ${(index >> 2) & 1}`)].join("\n");
  const parsed = parseLut("warm.cube", cube);
  assert.deepEqual([parsed.format, parsed.kind, parsed.size, parsed.title, parsed.cube.split("\n")[0], parsed.cube.split("\n")[2]], ["cube", "3d", 2, "Warm", "LUT_3D_SIZE 2", "1 0 0"]);
  // A 1D table that inverts each channel is baked into a 33-point cube.
  const inverse = parseLut("invert.cube", "LUT_1D_SIZE 2\n1 1 1\n0 0 0\n");
  assert.deepEqual([inverse.kind, inverse.cube.split("\n")[0], inverse.cube.split("\n")[1]], ["1d", "LUT_3D_SIZE 33", "1 1 1"]);
  const threeDl = ["0 64 128 192 256 320 384 448 512 576 640 704 768 832 896 960 1023", ...Array.from({ length: 17 ** 3 }, (_, index) => `${Math.floor(index / 289) * 64} ${(Math.floor(index / 17) % 17) * 64} ${(index % 17) * 64}`)].join("\n");
  assert.deepEqual([parseLut("grade.3dl", threeDl).size, parseLut("grade.3dl", threeDl).format], [17, "3dl"]);
  const reason = (name: string, body: string, bytes?: number) => { try { parseLut(name, body, bytes); } catch (error) { assert.ok(error instanceof LutRejected); return error.reason; } return "accepted"; };
  assert.deepEqual([reason("a.cube", "LUT_3D_SIZE 70\n0 0 0"), reason("a.cube", "LUT_3D_SIZE 2\n0 0 0\n0 zero 0"), reason("a.cube", cube, 33 * 1024 * 1024 + 1), reason("a.png", cube), reason("a.cube", "LUT_3D_SIZE 2\n0 0 0")],
    ["Unsupported LUT size", "Malformed line 3", "File is larger than 32 MiB", "Not a .cube or .3dl file", "Unsupported LUT size"]);
  const sha = "ab".repeat(32), first = addLut(doc0(), CTX, { sha256: sha, name: "warm.cube", format: "cube", size: cube.length })!;
  assert.deepEqual([(first.document.media as any).luts.map((lut: any) => lut.id), addLut(first.document, CTX, { sha256: sha, name: "again.cube", format: "cube", size: 1 })], [[lutIdOf(sha)], null]);
  const applied = applyLut(first.document, CTX, ["v"], lutIdOf(sha)).document;
  assert.deepEqual(el(applied, "v").adjustments.lut, { enabled: true, lutId: lutIdOf(sha), intensity: 100 });
  assert.equal(el(applyLut(applied, CTX, ["v"], null).document, "v").adjustments.lut.lutId, undefined);
});

test("Copy and paste attributes, Apply adjustments to all clips, Auto adjust, Colour match between clips: a look with its keyframes moves to other clips as one step; the analysis gives slider values", () => {
  let doc = setAdjustment(doc0(), CTX, ["v"], "adjustments.basic.contrast", 16, 0).document;
  doc = setKeyframe(doc, CTX, "v", "adjustments.basic.fade", { time: S, value: 10 }).document;
  const look = copyLook(el(doc, "v"));
  const pasted = pasteLook(doc, CTX, ["w"], look).document;
  assert.deepEqual([el(pasted, "w").adjustments.basic.contrast, el(pasted, "w").animations["adjustments.basic.fade"].keys[0].value, el(pasted, "w").animations["adjustments.basic.fade"].keys[0].id === el(doc, "v").animations["adjustments.basic.fade"].keys[0].id], [16, 10, false]);
  const all = applyLookToAll(put(doc, "t-main", clip("x", 20)), CTX, "v");
  assert.deepEqual([all.count, el(all.commit.document, "x").adjustments.basic.contrast, el(all.commit.document, "w").adjustments.basic.contrast], [2, 16, 16]);
  // A dark, flat, blue-tinted picture is lifted, stretched and warmed.
  const dark = new Uint8Array(400 * 4).map((_, index) => (index % 4 === 3 ? 255 : index % 4 === 2 ? 70 + (index % 40) : 30 + (index % 40)));
  const stats = pictureStats(dark), values = autoAdjustValues(stats);
  assert.ok(stats.mid < 0.3 && values.exposure > 10 && values.contrast > 10 && values.temperature > 0, JSON.stringify(values));
  assert.equal(autoAdjustValues(stats, 0).exposure, 0);
});

test("Mask data model: Limit of eight; Stored and displayed units; Maskable element types: Text element; Sticker element; Base mask parameters: Feather display mapping; Defaults; Box-like masks: Default rectangle; Minimum size", () => {
  let doc = doc0();
  doc = addMaskOfType(doc, CTX, "v", "rectangle", "m1").document;
  const mask = el(doc, "v").masks[0];
  assert.deepEqual([mask.type, mask.enabled, mask.combine, mask.params.feather, mask.params.strokeWidth, mask.params.strokeColor, mask.params.inverted, mask.params.opacity, mask.params.width, mask.params.height, mask.params.centerX, mask.params.cornerRadius], ["rectangle", true, "add", 0, 0, "#ffffff", false, 100, 0.6, 0.6, 0, 0]);
  assert.deepEqual([maskStored("feather", 35), maskDisplay("feather", 350), maskDisplay("centerX", -0.4), maskDisplay("scale", 1.5)], [350, 35, -40, 150]);
  doc = setMaskParams(doc, CTX, "v", "m1", { feather: maskStored("feather", 35), width: 0.0001, cornerRadius: 30 }).document;
  assert.deepEqual([el(doc, "v").masks[0].params.feather, el(doc, "v").masks[0].params.width, el(doc, "v").masks[0].params.cornerRadius], [350, 0.01, 30]);
  for (let index = 2; index <= 8; index++) doc = addMaskOfType(doc, CTX, "v", "ellipse", `m${index}`).document;
  const ninth = refused(() => addMaskOfType(doc, CTX, "v", "star"));
  assert.deepEqual([ninth.message, ninth.reason, el(doc, "v").masks.length], [MASK_LIMIT_MESSAGE, "OUT_OF_RANGE", 8]);
  assert.deepEqual([isMaskable(text("t") as never), isMaskable(image("i") as never), isMaskable({ type: "sticker" }), isMaskable({ type: "audio" }), MASK_MENU.map((entry) => entry.name)], [false, true, true, false, ["Split", "Mirror", "Filmstrip", "Rectangle", "Ellipse", "Heart", "Diamond", "Star", "Text", "Pen tool"]]);
  assert.equal(refused(() => setMaskParams(doc, CTX, "v", "m2", { cornerRadius: 10 })).reason, "INVALID_PARAMS");
});

test("Multiple masks and combine modes, Remove and reset masks: Remove; Remove with keyframes; Mask keyframing: Animated position; Mask invert: Invert an ellipse", () => {
  let doc = addMaskOfType(doc0(), CTX, "v", "ellipse", "m1").document;
  doc = addMaskOfType(doc, CTX, "v", "rectangle", "m2").document;
  doc = setMaskField(doc, CTX, "v", "m2", { combine: "subtract" }).document;
  doc = setMaskParams(doc, CTX, "v", "m1", { inverted: true }).document;
  assert.deepEqual(el(doc, "v").masks.map((mask: any) => [mask.id, mask.combine, mask.params.inverted]), [["m1", "add", true], ["m2", "subtract", false]]);
  doc = setKeyframe(doc, CTX, "v", "masks.m1.params.centerX", { time: 0, value: -0.5 }).document;
  // A keyed parameter takes an edit as a key at the playhead.
  doc = setMaskParams(doc, CTX, "v", "m1", { centerX: 0.5 }, 2 * S).document;
  assert.deepEqual([el(doc, "v").animations["masks.m1.params.centerX"].keys.map((key: any) => [key.time, key.value]), el(doc, "v").masks[0].params.centerX], [[[0, -0.5], [2 * S, 0.5]], 0]);
  const copy = duplicateMask(doc, CTX, "v", "m1", "m3").document;
  assert.deepEqual([el(copy, "v").masks.map((mask: any) => mask.id), el(copy, "v").animations["masks.m3.params.centerX"].keys.length], [["m1", "m3", "m2"], 2]);
  assert.deepEqual(el(reorderMask(copy, CTX, "v", "m2", 0).document, "v").masks.map((mask: any) => mask.id), ["m2", "m1", "m3"]);
  const reset = resetMask(doc, CTX, "v", "m1").document;
  assert.deepEqual([el(reset, "v").masks[0].params.inverted, el(reset, "v").animations], [false, undefined]);
  const session = open(doc), steps = session.historyLength;
  session.adoptCommit(removeMask(session.document, CTX, "v", "m1"), session.document);
  assert.deepEqual([el(session.document, "v").masks.map((mask: any) => mask.id), el(session.document, "v").animations, session.historyLength - steps], [["m2"], undefined, 1]);
  session.undo();
  assert.equal(el(session.document, "v").masks.length, 2);
  assert.equal(el(setMaskField(doc, CTX, "v", "m1", { enabled: false }).document, "v").masks[0].enabled, false);
});

test("Mask handles on canvas: Rotate about the pivot; Feather handle; Split mask: Position clamp; Cinematic bars mask: Only height handles; Mask snapping: Snap to element centre; Shift constrains", () => {
  const box = { cx: 960, cy: 540, width: 1920, height: 1080, rotation: 0 };
  const rectangle = { id: "m", type: "rectangle" as const, enabled: true, combine: "add" as const, params: { centerX: 0, centerY: 0, width: 0.6, height: 0.6, scale: 1, rotation: 0 } };
  assert.deepEqual(maskFrame(box, rectangle), { cx: 960, cy: 540, rotation: 0, width: 648, height: 648, shape: "box" });
  // The pointer goes from straight up to 45° clockwise of it about the centre.
  assert.equal(rotationFromDrag(0, { x: 960, y: 540 }, { x: 960, y: 200 }, { x: 1200, y: 300 }), 45);
  assert.equal(featherFromDrag(0, 55), 500);
  assert.equal(featherFromDrag(900, 500), 1000);
  const start = { centerX: 0, centerY: 0, width: 0.6, height: 0.6, scale: 1, rotation: 0 };
  assert.deepEqual(dragMaskHandle(rectangle, box, start, "move", { x: 5000, y: -5000 }), { centerX: 1, centerY: -1 });
  assert.deepEqual(dragMaskHandle(rectangle, box, { ...start, centerX: 0.2 }, "move", { x: -180, y: 300 }, { snap: true }), { centerX: 0, centerY: 0.555556 });
  assert.deepEqual(dragMaskHandle(rectangle, box, start, "move", { x: 96, y: 20 }, { shift: true }), { centerX: 0.1, centerY: 0 });
  // The east edge 108 px out: the width grows by twice that over the short side.
  assert.deepEqual(dragMaskHandle(rectangle, box, start, "e", { x: 108, y: 0 }), { width: 0.8 });
  assert.deepEqual(dragMaskHandle(rectangle, box, start, "se", { x: 108, y: 54 }), { height: 0.8, width: 0.8 });
  assert.equal(dragMaskHandle(rectangle, box, start, "w", { x: 5000, y: 0 }).width, 0.01);
  assert.deepEqual([maskHandles("cinematic-bars"), maskHandles("split"), maskHandles("rectangle").includes("radius"), maskHandles("text")], [["move", "n", "s", "rotate", "feather"], ["move", "rotate", "feather"], true, ["move", "se", "rotate", "feather"]]);
  // A 1920×1080 element: default bars keep a 648 px band; a default mirror band is 432 px.
  const bars = maskFrame(box, { ...rectangle, type: "cinematic-bars", params: { ...start } }), mirror = maskFrame(box, { ...rectangle, type: "mirror", params: { ...start, size: 0.4 } });
  assert.deepEqual([bars.height, mirror.height, bars.shape], [648, 432, "band"]);
});

test("Pen tool path creation: Close a triangle; Open path does not mask; Pen tool point editing: Delete to below three points; Move several points; Mask keyframing: Insert a point on an animated path", () => {
  let doc = addMaskOfType(doc0(), CTX, "v", "freeform", "pen").document;
  for (const [x, y] of [[-0.5, -0.5], [0.5, -0.5]]) doc = addPathPoint(doc, CTX, "v", "pen", { x, y }).document;
  assert.equal(el(setPathClosed(doc, CTX, "v", "pen", true).document, "v").masks[0].params.closed, false);
  doc = addPathPoint(doc, CTX, "v", "pen", { x: 0, y: 0.5 }).document;
  doc = setPathClosed(doc, CTX, "v", "pen", true).document;
  const points = el(doc, "v").masks[0].params.path;
  assert.deepEqual([points.length, el(doc, "v").masks[0].params.closed, points[0].inX], [3, true, 0]);
  // A path key holds the whole list: a point inserted later appears in every key.
  const keyed = structuredClone(doc) as any;
  keyed.scenes[0].tracks.main.elements[0].animations = { "masks.pen.params.path": { keys: [{ id: "pk1", time: 0, value: { points }, segmentToNext: "linear", easing: [0.25, 0.1, 0.25, 1] }] } };
  const inserted = addPathPoint(keyed, CTX, "v", "pen", { x: 0.5, y: 0 }, points[1].id).document;
  assert.deepEqual([el(inserted, "v").masks[0].params.path.length, el(inserted, "v").animations["masks.pen.params.path"].keys[0].value.points.length, el(inserted, "v").masks[0].params.path[2].x], [4, 4, 0.5]);
  const fewer = removePathPoints(doc, CTX, "v", "pen", [points[0].id]).document;
  assert.deepEqual([el(fewer, "v").masks[0].params.path.length, el(fewer, "v").masks[0].params.closed], [2, false]);
});

test("Chroma key: Stored names and agent range; Strength zero; Eyedropper; Blend modes: Seventeen options; Unknown stored mode; Opacity: Range clamp", () => {
  const session = open(doc0()), steps = session.historyLength;
  session.adoptCommit(setChromaKey(session.document, CTX, "v", { enabled: true }), session.document);
  assert.deepEqual([el(session.document, "v").chromaKey, session.historyLength - steps], [{ enabled: true, color: "#00ff00", strength: 40, edge: 10, shadow: 0, spill: 50 }, 1]);
  let doc = setChromaKey(session.document, CTX, "v", { strength: 250, color: "#12AB34" }).document;
  assert.deepEqual([el(doc, "v").chromaKey.strength, el(doc, "v").chromaKey.color], [100, "#12ab34"]);
  doc = setChromaKey(doc, CTX, "v", { strength: 0 }).document;
  assert.equal(el(doc, "v").chromaKey.strength, 0);
  assert.equal(el(resetChromaKey(doc, CTX, "v").document, "v").chromaKey, undefined);
  // 5 × 5 sampled pixels of one colour.
  assert.equal(averageColor(Array.from({ length: 25 }, () => [18, 200, 40, 255]).flat()), "#12c828");
  assert.equal(refused(() => setChromaKey(put(withTracks(project(), ["t-text", "text"]), "t-text", text("t")), CTX, "t", { enabled: true })).reason, "not-keyable");
  assert.deepEqual([Object.keys(BLEND_MODE_NAMES).length, BLEND_MODE_NAMES["color-burn"], BLEND_MODE_NAMES.normal, blendModeOf({ blendMode: "linear-light" }), blendModeOf({ blendMode: "screen" })], [17, "Color burn", "Normal", "normal", "screen"]);
});
