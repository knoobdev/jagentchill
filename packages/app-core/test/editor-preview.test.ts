import assert from "node:assert/strict";
import { test } from "node:test";
import { timeline, upsertKeyframe } from "@jagentchill/editor-core";
import { TICKS_PER_SECOND as S } from "@jagentchill/protocol";
import { ids, NOW, REGISTRIES } from "../../editor-core/test/support/fixtures.ts";
import { el, project, withTracks } from "../../editor-core/test/support/timeline.ts";
import {
  actionForKey, anyGuideOn, audibleAtRate, boundsOf, boxFromBounds, canvasRect, clampAfterEdit, clampCropTo, clampGrid, clampPan, clickSelection, commitTimeEntry, commitTransform, createEditorController, cropForRatio, cropWithHandle, displayScale, dragPan,
  dragTarget, engineVolume, FIT_VIEW, GUIDE_DEFAULTS, gridLines, HANDLE, handlePositions, handlesFor, hitCandidates, hitHandle, hitTest, isVerticalCanvas, loopRegion, marqueeSelection, moveDelta, moveElements, nudgeDelta, parseTimeEntry, playStart, presetZoom,
  resetTransforms, rotateQuarterTurn, rotateWithHandle, runEditorAction, safeAreaAvailable, safeAreaRect, SAFE_AREA_PRESETS, scaleWithHandle, setVolume, shuttle, SHUTTLE_IDLE, snapBox, snapTargets, snapThreshold, timecode, toCanvas, toggleMute, toScreen,
  transformOf, VOLUME_DEFAULT, wheelPan, wheelZoomView, zoomInView, zoomLabel, zoomOptions, zoomTo, type ActionHost, type Box,
} from "../src/index.ts";

const FPS = { numerator: 30, denominator: 1 };
const CANVAS = { width: 1920, height: 1080 };
const prefs = { ...timeline.DEFAULT_TIMELINE_PREFERENCES };
/** A controller over the fixture project with a 4 s video on the main track and, when asked, an image on an overlay track above it. */
function open(options: { overlay?: boolean } = {}) {
  const messages: string[] = [];
  const controller = createEditorController({ document: project(), newId: ids("gen"), now: () => NOW + 1, registries: REGISTRIES, platform: "web", prefs: () => prefs, onMessage: (message) => messages.push(message) });
  const sceneId = controller.session.sceneId;
  const video = controller.run(timeline.addToTimeline({ sceneId, items: [{ kind: "media", assetId: "a4" }], time: 0 })).info!.elementIds[0];
  const image = options.overlay ? controller.run(timeline.addToTimeline({ sceneId, items: [{ kind: "media", assetId: "a2" }], time: 0, request: { strategy: "alwaysNew" } })).info!.elementIds[0] : "";
  const host: ActionHost = { controller, prefs: () => prefs, setPrefs: () => undefined, viewportWidth: () => 1000, message: (text) => messages.push(text) };
  return { controller, sceneId, video, image, host, messages, act: (id: string) => runEditorAction(host, id) };
}
const box = (id: string, cx: number, cy: number, width: number, height: number, rotation = 0): Box => ({ id, cx, cy, width, height, rotation });
const closeTo = (actual: number, expected: number, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected}`);

// — Play, pause and stop —
test("Toggle playback: play starts from the playhead of a 20 s scene", () => {
  assert.equal(playStart({ playhead: 4 * S, duration: 20 * S, loop: false, region: { start: 0, end: 20 * S } }), 4 * S);
});
test("Empty scene: play does not start when the duration is 0", () => {
  assert.equal(playStart({ playhead: 0, duration: 0, loop: false, region: { start: 0, end: 0 } }), null);
});
test("Stop: the stop action pauses and puts the playhead at 0", () => {
  const { controller, host } = open();
  let paused = false;
  controller.seek(2 * S);
  runEditorAction({ ...host, pause: () => { paused = true; } }, "playback.stop");
  assert.equal(controller.session.playhead, 0);
  assert.ok(paused);
});

// — Seek, jump and frame step —
test("Frame step at 30 fps: frame 100 steps to frame 101 (404 000 ticks)", () => {
  const { controller, act } = open();
  controller.seek(400_000);
  act("playback.frame-next");
  assert.equal(controller.session.playhead, 404_000);
});
test("Clamp at start: a 5 s jump back from 2 s lands on 0", () => {
  const { controller, act } = open();
  controller.seek(2 * S);
  act("playback.jump-back");
  assert.equal(controller.session.playhead, 0);
});
test("Multi-frame step: ten frames back from frame 5 lands on frame 0", () => {
  const { controller, act } = open();
  controller.seek(5 * 4000);
  act("playback.frames-back-10");
  assert.equal(controller.session.playhead, 0);
});

// — End-of-timeline behaviour —
test("Auto-pause at end: the timecode at the end of a 10 s scene reads 00:00:10:00", () => {
  assert.equal(timecode(10 * S, FPS), "00:00:10:00");
});
test("Play from end restarts: play at the duration starts from 0", () => {
  assert.equal(playStart({ playhead: 10 * S, duration: 10 * S, loop: false, region: { start: 0, end: 10 * S } }), 0);
});
test("Scene shortened during playback: the playhead is clamped to the new duration and playback pauses", () => {
  assert.deepEqual(clampAfterEdit(9 * S, 6 * S, true), { playhead: 6 * S, pause: true });
  assert.deepEqual(clampAfterEdit(3 * S, 6 * S, true), { playhead: 3 * S, pause: false });
});

// — Loop playback —
test("Loop whole scene: without a range the loop region is the whole scene", () => {
  const { controller, sceneId } = open();
  assert.deepEqual(loopRegion(controller.stored, sceneId), { start: 0, end: 20 * S });
});
test("Loop a range: the in/out range is the loop region and play inside it starts where it is", () => {
  const { controller, sceneId } = open();
  controller.run(timeline.setRangePoint({ sceneId, point: "in", time: 2 * S }));
  controller.run(timeline.setRangePoint({ sceneId, point: "out", time: 5 * S }));
  const region = loopRegion(controller.stored, sceneId);
  assert.deepEqual(region, { start: 2 * S, end: 5 * S });
  assert.equal(playStart({ playhead: 3 * S, duration: 20 * S, loop: true, region }), 3 * S);
});
test("Playhead outside the range: play with loop on starts from the range start", () => {
  assert.equal(playStart({ playhead: 7 * S, duration: 20 * S, loop: true, region: { start: 2 * S, end: 5 * S } }), 2 * S);
});

// — Playback rate and JKL shuttle —
test("Shuttle forward: three presses run forward at 4× with the sound muted", () => {
  let state = SHUTTLE_IDLE, effect;
  for (let press = 0; press < 3; press++) ({ state, effect } = shuttle(state, "forward"));
  assert.deepEqual(effect, { kind: "play", rate: 4 });
  assert.equal(audibleAtRate(4), false);
});
test("Audible at 2×: two presses run forward at 2× with sound", () => {
  let state = SHUTTLE_IDLE, effect;
  for (let press = 0; press < 2; press++) ({ state, effect } = shuttle(state, "forward"));
  assert.deepEqual(effect, { kind: "play", rate: 2 });
  assert.equal(audibleAtRate(2), true);
});
test("Reverse shuttle: one press plays backward at 1×, muted, and it does not start at 0", () => {
  assert.deepEqual(shuttle(SHUTTLE_IDLE, "reverse").effect, { kind: "play", rate: -1 });
  assert.equal(audibleAtRate(-1), false);
  assert.equal(playStart({ playhead: 0, duration: 6 * S, loop: false, region: { start: 0, end: 6 * S }, rate: -1 }), null);
  assert.equal(playStart({ playhead: 6 * S, duration: 6 * S, loop: false, region: { start: 0, end: 6 * S }, rate: -1 }), 6 * S);
});
test("Stop resets: after 8×, stop pauses and the next forward press runs at 1×", () => {
  let state = SHUTTLE_IDLE;
  for (let press = 0; press < 5; press++) state = shuttle(state, "forward").state;
  assert.equal(state.rate, 8);
  const stopped = shuttle(state, "stop");
  assert.deepEqual(stopped.effect, { kind: "pause" });
  assert.deepEqual(shuttle(shuttle(stopped.state, "stop-release").state, "forward").effect, { kind: "play", rate: 1 });
});
test("Frame step while stop is held: forward steps one frame and stays paused", () => {
  const held = shuttle(SHUTTLE_IDLE, "stop").state;
  assert.deepEqual(shuttle(held, "forward").effect, { kind: "step", frames: 1 });
  assert.deepEqual(shuttle(held, "reverse").effect, { kind: "step", frames: -1 });
});

// — Master volume and mute —
test("Mute and restore: the speaker button silences 60 % and brings it back", () => {
  const sixty = setVolume(VOLUME_DEFAULT, 60), muted = toggleMute(sixty);
  assert.deepEqual(engineVolume(muted), { volume: 0.6, muted: true });
  assert.deepEqual(engineVolume(toggleMute(muted)), { volume: 0.6, muted: false });
  // The slider at 0 mutes; unmuting from there returns to the volume before, or to 100 %.
  assert.equal(toggleMute(setVolume(sixty, 0)).volume, 60);
  assert.equal(toggleMute(setVolume(setVolume(VOLUME_DEFAULT, 0), 0)).volume, 100);
});

// — Timecode and duration display —
test("Seek by typing: 00:00:07:15 at 30 fps is 7.5 s", () => {
  assert.equal(commitTimeEntry("00:00:07:15", 20 * S, FPS), 7.5 * S);
  assert.equal(commitTimeEntry("7", 20 * S, FPS), 7 * S);
  assert.equal(commitTimeEntry("00:07", 20 * S, FPS), 7 * S);
  assert.equal(commitTimeEntry("00:07:15", 20 * S, FPS), 7.5 * S);
});
test("Out-of-range value: a time past the end seeks to the end of a 20 s scene", () => {
  const target = commitTimeEntry("00:10:00:00", 20 * S, FPS)!;
  assert.equal(target, 20 * S);
  assert.equal(timecode(target, FPS), "00:00:20:00");
});
test("Invalid value and Enter: text that is not a time gives no seek target", () => {
  assert.equal(commitTimeEntry("abc", 20 * S, FPS), null);
  assert.equal(parseTimeEntry("", FPS), null);
  assert.equal(parseTimeEntry("1:2:3:4:5", FPS), null);
});

// — Preview zoom model —
test("100 % preset: a 1920×1080 canvas in a 960×540 viewport gets zoom 2", () => {
  const viewport = { width: 960, height: 540 }, zoom = presetZoom(100, viewport, CANVAS);
  assert.equal(zoom, 2);
  assert.equal(displayScale({ zoom, pan: { x: 0, y: 0 } }, viewport, CANVAS), 1);
  assert.equal(zoomLabel({ zoom, pan: { x: 0, y: 0 } }, viewport, CANVAS), "100%");
});
test("Clamp at maximum: zoom 14 zooms in to 16 and stays there", () => {
  const viewport = { width: 960, height: 540 }, once = zoomInView({ zoom: 14, pan: { x: 0, y: 0 } }, viewport, CANVAS);
  assert.equal(once.zoom, 16);
  assert.equal(zoomInView(once, viewport, CANVAS).zoom, 16);
});
test("Fit to screen: zoom 1, centred, and the label reads Fit", () => {
  const viewport = { width: 960, height: 540 };
  assert.equal(zoomLabel(FIT_VIEW, viewport, CANVAS), "Fit");
  assert.deepEqual(canvasRect(FIT_VIEW, viewport, CANVAS), { left: 0, top: 0, width: 960, height: 540, scale: 0.5 });
  assert.deepEqual(zoomOptions().map((option) => ("separator" in option ? "|" : option.label)), ["Fit", "|", "25%", "50%", "75%", "100%", "150%", "200%"]);
});

// — Zoom by wheel, pinch and commands —
test("Cursor-anchored zoom: the canvas corner under the cursor stays under it", () => {
  const viewport = { width: 960, height: 540 }, start = { zoom: 2, pan: { x: 100, y: 50 } };
  const corner = toScreen({ x: -960, y: -540 }, start, viewport, CANVAS);
  const zoomed = wheelZoomView(start, -30, viewport, CANVAS, corner);
  const after = toScreen({ x: -960, y: -540 }, zoomed, viewport, CANVAS);
  closeTo(after.x, corner.x, 1e-6); closeTo(after.y, corner.y, 1e-6);
  // A command keeps the view centre fixed instead.
  const centred = zoomTo({ zoom: 2, pan: { x: 0, y: 0 } }, 4, viewport, CANVAS);
  assert.deepEqual(centred.pan, { x: 0, y: 0 });
});
test("Wheel burst is capped: deltas summing to −600 in one frame zoom by exp(30/300)", () => {
  const viewport = { width: 960, height: 540 };
  closeTo(wheelZoomView({ zoom: 2, pan: { x: 0, y: 0 } }, -600, viewport, CANVAS, { x: 480, y: 270 }).zoom, 2 * Math.exp(30 / 300), 1e-9);
});

// — Preview pan —
test("Pan clamps at the canvas edge: at zoom 2 the left canvas edge stops at the left viewport edge", () => {
  const viewport = { width: 960, height: 540 }, dragged = dragPan({ zoom: 2, pan: { x: 0, y: 0 } }, { x: 5000, y: 0 }, viewport, CANVAS);
  assert.equal(canvasRect(dragged, viewport, CANVAS).left, 0);
  assert.deepEqual(clampPan({ zoom: 2, pan: { x: -9999, y: 0 } }, viewport, CANVAS).pan, { x: -480, y: 0 });
});
test("No pan at fit: the wheel does not move the view at zoom 1", () => {
  const viewport = { width: 960, height: 540 };
  assert.deepEqual(wheelPan(FIT_VIEW, { deltaX: 40, deltaY: 40 }, viewport, CANVAS), FIT_VIEW);
  assert.deepEqual(dragPan(FIT_VIEW, { x: 40, y: 40 }, viewport, CANVAS), FIT_VIEW);
  // Line-mode deltas count 16 px each.
  assert.equal(wheelPan({ zoom: 2, pan: { x: 0, y: 0 } }, { deltaX: 0, deltaY: 3, deltaMode: 1 }, viewport, CANVAS).pan.y, -48);
});

// — Hit-testing candidates and order —
test("Topmost wins: an element on overlay track 0 is hit before the main-track video", () => {
  const { controller, sceneId, video, image } = open({ overlay: true });
  const order = hitCandidates(controller.stored, sceneId, S);
  assert.deepEqual(order, [image, video]);
  const boxes = [box(image, 0, 0, 400, 400), box(video, 0, 0, 1920, 1080)];
  assert.equal(hitTest(boxes, { x: 10, y: 10 })[0], image);
  assert.equal(hitTest(boxes, { x: 800, y: 10 })[0], video);
});
test("Drawing bounds: a 900×300 drawing is hit 400 px right of its centre", () => {
  assert.deepEqual(hitTest([box("drawing", 0, 0, 900, 300)], { x: 400, y: 0 }), ["drawing"]);
  assert.deepEqual(hitTest([box("square", 0, 0, 512, 512)], { x: 400, y: 0 }), []);
  // The hit shape is the rotated rectangle.
  assert.deepEqual(hitTest([box("turned", 0, 0, 900, 100, 90)], { x: 0, y: 400 }), ["turned"]);
});
test("Locked track is skipped: its elements are not candidates", () => {
  const { controller, sceneId, video, image } = open({ overlay: true });
  const track = timeline.locate(controller.stored, image)!.track.id;
  controller.run(timeline.toggleTrackFlag({ trackId: track, flag: "locked" }));
  assert.deepEqual(hitCandidates(controller.stored, sceneId, S), [video]);
  assert.deepEqual(clickSelection([], hitTest([box(video, 0, 0, 1920, 1080)], { x: 0, y: 0 })), [video]);
  assert.deepEqual(clickSelection([video], []), []);
});
test("Element not at the playhead: an element whose range excludes the playhead is no candidate", () => {
  const { controller, sceneId } = open();
  assert.deepEqual(hitCandidates(controller.stored, sceneId, 30 * S), []);
  // Hidden elements and audio are never candidates.
  const { controller: other, sceneId: scene, video } = open();
  other.run(timeline.toggleElementFlag({ sceneId: scene, elementIds: [video], flag: "hidden" }));
  assert.deepEqual(hitCandidates(other.stored, scene, S), []);
});

// — Preview selection —
test("Shift-click adds: A selected, Shift-click on B selects both", () => {
  assert.deepEqual(clickSelection(["a"], ["b"], { shift: true }), ["a", "b"]);
  assert.deepEqual(clickSelection(["a", "b"], ["b"], { shift: true }), ["a"]);
});
test("Select underneath: Alt-click walks down the stack and cycles", () => {
  const hits = ["top", "middle", "bottom"];
  const second = clickSelection(["top"], hits, { alt: true }), third = clickSelection(second, hits, { alt: true });
  assert.deepEqual([second, third, clickSelection(third, hits, { alt: true })], [["middle"], ["bottom"], ["top"]]);
});
test("Marquee: every candidate whose bounds meet the rectangle is selected", () => {
  const stickers = [box("s1", -300, 0, 100, 100), box("s2", 300, 0, 100, 100), box("far", 0, 900, 50, 50)];
  assert.deepEqual(marqueeSelection(stickers, { x: -400, y: -100 }, { x: 400, y: 100 }), ["s1", "s2"]);
  assert.deepEqual(marqueeSelection(stickers, { x: 250, y: -10 }, { x: 260, y: 10 }, ["s1"], true), ["s1", "s2"]);
});

// — Move elements on the canvas —
test("Move a group: both selected elements move by (+100, +20) and one undo restores both", () => {
  const { controller, video, image } = open({ overlay: true });
  assert.deepEqual(dragTarget([video, image], [image, video]), { ids: [video, image], selection: [video, image] });
  assert.deepEqual(dragTarget([], [image, video]), { ids: [image], selection: [image] });
  const steps = controller.session.historyLength;
  controller.external((doc, ctx) => moveElements(doc, ctx, [video, image], 0, { x: 100, y: 20 }));
  assert.deepEqual([transformOf(el(controller.stored, video)).position, transformOf(el(controller.stored, image)).position], [{ x: 100, y: 20 }, { x: 100, y: 20 }]);
  assert.equal(controller.session.historyLength, steps + 1);
  controller.undo();
  assert.deepEqual([transformOf(el(controller.stored, video)).position, transformOf(el(controller.stored, image)).position], [{ x: 0, y: 0 }, { x: 0, y: 0 }]);
});
test("Axis lock: Shift keeps the axis with the larger delta", () => {
  assert.deepEqual(moveDelta({ x: 0, y: 0 }, { x: 80, y: 12 }, true), { x: 80, y: 0 });
  assert.deepEqual(moveDelta({ x: 0, y: 0 }, { x: 5, y: -30 }, true), { x: 0, y: -30 });
  // Nothing moves below half a canvas unit.
  assert.equal(moveDelta({ x: 0, y: 0 }, { x: 0.3, y: 0.2 }), null);
});
test("Cancel: a drag shown through the preview layer leaves nothing behind when it is discarded", () => {
  const { controller, video } = open();
  const steps = controller.session.historyLength;
  controller.external((doc, ctx) => moveElements(doc, ctx, [video], 0, { x: 300, y: 0 }), true);
  assert.equal(transformOf(el(controller.document, video)).position.x, 300);
  controller.discardPreview();
  assert.equal(transformOf(el(controller.document, video)).position.x, 0);
  assert.equal(controller.session.historyLength, steps);
});
test("Nudge only in the preview scope: the arrow keys nudge with the preview focused and step frames otherwise", () => {
  assert.equal(actionForKey({ key: "ArrowRight", code: "ArrowRight" }, { mac: true, context: "preview" }), "preview.nudge-right");
  assert.equal(actionForKey({ key: "ArrowRight", code: "ArrowRight" }, { mac: true, context: "editor" }), "playback.frame-next");
  assert.deepEqual([nudgeDelta("preview.nudge-right"), nudgeDelta("preview.nudge-far-up"), nudgeDelta("playback.frame-next")], [{ x: 1, y: 0 }, { x: 0, y: -10 }, null]);
});

// — Transform handles —
test("Handles for a single selection: four corners, four edges and the rotate handle", () => {
  const { controller, sceneId, video } = open();
  assert.equal(handlesFor([video], hitCandidates(controller.stored, sceneId, S)), video);
  const positions = handlePositions(box(video, 0, 0, 400, 200), (point) => point, 1);
  assert.deepEqual(Object.keys(positions).sort(), ["e", "n", "ne", "nw", "rotate", "s", "se", "sw", "w"]);
  assert.deepEqual([positions.nw, positions.se, positions.e, positions.rotate], [{ x: -200, y: -100 }, { x: 200, y: 100 }, { x: 200, y: 0 }, { x: 0, y: -100 - HANDLE.rotateOffset }]);
  assert.equal(hitHandle(positions, { x: 204, y: 104 }), "se");
  assert.equal(hitHandle(positions, { x: 0, y: -124 }), "rotate");
  assert.equal(hitHandle(positions, { x: 0, y: 0 }), null);
});
test("No handles for multi-selection: two selected elements get outlines only", () => {
  assert.equal(handlesFor(["a", "b"], ["a", "b"]), null);
  assert.equal(handlesFor(["gone"], ["a"]), null);
});
test("Handles keep size when zoomed: the rotate handle stays 24 screen px outside at zoom 4", () => {
  const viewport = { width: 960, height: 540 };
  for (const zoom of [1, 4]) {
    const view = { zoom, pan: { x: 0, y: 0 } }, scale = displayScale(view, viewport, CANVAS);
    const positions = handlePositions(box("a", 0, 0, 400, 200), (point) => toScreen(point, view, viewport, CANVAS), scale);
    closeTo(positions.n.y - positions.rotate.y, HANDLE.rotateOffset, 1e-9);
  }
  assert.equal(HANDLE.corner, 10);
});

// — Scale with handles —
test("Uniform corner scale: a corner dragged to twice its distance doubles both axes about the centre", () => {
  const result = scaleWithHandle({ box: box("a", 100, 50, 400, 200), scale: { x: 1, y: 1 }, position: { x: 100, y: 50 }, handle: "se", start: { x: 300, y: 150 }, current: { x: 500, y: 250 } });
  assert.deepEqual(result.scale, { x: 2, y: 2 });
  assert.deepEqual(result.position, { x: 100, y: 50 });
  // An edge handle scales its own axis only; Shift on a corner releases the aspect lock.
  assert.deepEqual(scaleWithHandle({ box: box("a", 0, 0, 400, 200), scale: { x: 1, y: 1 }, position: { x: 0, y: 0 }, handle: "e", start: { x: 200, y: 0 }, current: { x: 300, y: 40 } }).scale, { x: 1.5, y: 1 });
  assert.deepEqual(scaleWithHandle({ box: box("a", 0, 0, 400, 200), scale: { x: 1, y: 1 }, position: { x: 0, y: 0 }, handle: "se", start: { x: 200, y: 100 }, current: { x: 400, y: 100 }, shift: true }).scale, { x: 2, y: 1 });
  assert.equal(scaleWithHandle({ box: box("a", 0, 0, 400, 200), scale: { x: 60, y: 60 }, position: { x: 0, y: 0 }, handle: "se", start: { x: 200, y: 100 }, current: { x: 800, y: 400 } }).scale.x, 100);
});
test("Anchored scale: with Alt the opposite corner stays where it is", () => {
  const start = box("a", 0, 0, 400, 200);
  const result = scaleWithHandle({ box: start, scale: { x: 1, y: 1 }, position: { x: 0, y: 0 }, handle: "se", start: { x: 200, y: 100 }, current: { x: 600, y: 300 }, alt: true });
  assert.deepEqual(result.scale, { x: 2, y: 2 });
  // The new box is twice the size around the new centre: its top-left corner is still (−200, −100).
  assert.deepEqual({ x: result.position.x - 400, y: result.position.y - 200 }, { x: -200, y: -100 });
});
test("Keyframes preserved: scaling with keys at 1 s and 3 s writes a key at 2 s and leaves the others", () => {
  const { controller, video } = open();
  for (const [time, value] of [[S, 1], [3 * S, 2]] as const) for (const path of ["transform.scale.x", "transform.scale.y"]) controller.external((doc, ctx) => upsertKeyframe(doc, ctx, video, path, { time, value }));
  controller.external((doc, ctx) => commitTransform(doc, ctx, video, 2 * S, { scale: { x: 3, y: 3 } }, "Scale"));
  const keys = (el(controller.stored, video).animations["transform.scale.x"].keys as { time: number; value: number }[]).map((key) => [key.time, key.value]);
  assert.deepEqual(keys, [[S, 1], [2 * S, 3], [3 * S, 2]]);
  assert.equal(transformOf(el(controller.stored, video)).scale.x, 1);
});

// — Flip by dragging through the centre —
test("Drag through the centre: the right edge dragged past the left edge mirrors, with a positive scale", () => {
  const { controller, video } = open();
  const result = scaleWithHandle({ box: box(video, 0, 0, 400, 200), scale: { x: 1, y: 1 }, position: { x: 0, y: 0 }, handle: "e", start: { x: 200, y: 0 }, current: { x: -200, y: 0 } });
  assert.deepEqual(result.scale, { x: 1, y: 1 });
  assert.deepEqual(result.flip, { horizontal: true, vertical: false });
  controller.external((doc, ctx) => commitTransform(doc, ctx, video, 0, { scale: result.scale, flip: result.flip }, "Scale"));
  assert.deepEqual(transformOf(el(controller.stored, video)), { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, flip: { horizontal: true, vertical: false } });
  // A stored negative scale is written back positive the next time the transform is committed.
  controller.external((doc, ctx) => commitTransform(doc, ctx, video, 0, { scale: { x: -2, y: 1 } }, "Scale"));
  assert.equal(transformOf(el(controller.stored, video)).scale.x, 2);
});

// — Rotate with the handle —
const sweep = (degrees: number) => ({ x: Math.cos(((degrees - 90) * Math.PI) / 180) * 100, y: Math.sin(((degrees - 90) * Math.PI) / 180) * 100 });
test("Snap to 90°: a rotation to 87° commits 90°", () => {
  const result = rotateWithHandle({ centre: { x: 0, y: 0 }, start: sweep(0), current: sweep(87), rotation: 0 });
  assert.deepEqual([result.rotation, result.label], [90, "90.0°"]);
  assert.equal(rotateWithHandle({ centre: { x: 0, y: 0 }, start: sweep(0), current: sweep(80), rotation: 0 }).rotation, 80);
});
test("15° steps: Shift constrains about 40° to 45°", () => {
  assert.equal(rotateWithHandle({ centre: { x: 0, y: 0 }, start: sweep(0), current: sweep(40), rotation: 0, shift: true }).rotation, 45);
});
test("Free rotation: Mod keeps 88° at 88°", () => {
  assert.equal(rotateWithHandle({ centre: { x: 0, y: 0 }, start: sweep(0), current: sweep(88), rotation: 0, mod: true }).rotation, 88);
});

// — Preview snapping —
test("Snap to canvas centre: a centre within 5 screen px of the centre line lands on it, with a guide", () => {
  const scale = 0.5, moving = box("a", 8, 300, 200, 100);
  const snapped = snapBox(moving, snapTargets(CANVAS, GUIDE_DEFAULTS, []), snapThreshold(scale));
  assert.deepEqual([moving.cx + snapped.dx, snapped.lines.x], [0, 0]);
});
test("Snap to another element: left edges within 6 screen px become equal", () => {
  const other = box("b", -400, -300, 200, 100), moving = box("a", -340, 200, 300, 100);
  const snapped = snapBox(moving, snapTargets(CANVAS, GUIDE_DEFAULTS, [other]), snapThreshold(0.5));
  assert.equal(boundsOf({ ...moving, cx: moving.cx + snapped.dx }).left, boundsOf(other).left);
  assert.equal(snapped.lines.x, boundsOf(other).left);
});
test("Modifier disables snapping: no snap and no guide with Mod held", () => {
  assert.deepEqual(snapBox(box("a", 8, 300, 200, 100), snapTargets(CANVAS, GUIDE_DEFAULTS, []), snapThreshold(0.5), false), { dx: 0, dy: 0, lines: {} });
});
test("Outside the threshold: 9 screen px from the centre line stays where it is", () => {
  const snapped = snapBox(box("a", 9, 300, 200, 100), snapTargets(CANVAS, GUIDE_DEFAULTS, []), snapThreshold(1));
  assert.equal(snapped.dx, 0);
  // Rotation-aware bounds: a box turned a quarter swaps its extents.
  assert.deepEqual(boundsOf(box("r", 0, 0, 200, 100, 90)), { left: -50.00000000000001, top: -100, right: 50.00000000000001, bottom: 100 });
});

// — Crop mode —
test("Crop to square: 1:1 on a 1920×1080 clip is left and right 0.21875", () => {
  assert.deepEqual(cropForRatio(1, CANVAS), { left: 0.21875, top: 0, right: 0.21875, bottom: 0 });
});
test("Minimum size: with left at 0.5 the right side stops at 0.49", () => {
  const dragged = cropWithHandle({ left: 0.5, top: 0, right: 0, bottom: 0 }, "e", { x: -0.9, y: 0 }, CANVAS, null);
  closeTo(dragged.right, 0.49, 0.002);
  assert.ok(dragged.left + dragged.right <= 0.99 + 1e-9);
});
test("Typed value is clamped by the opposite side: top 0.6 limits bottom to 0.39", () => {
  closeTo(clampCropTo({ left: 0, right: 0, top: 0.6, bottom: 0.7 }, { width: 100_000, height: 100_000 }).bottom, 0.39, 0.001);
});

// — Flip, mirror and quarter-turn rotation —
test("Mirror: Flip horizontal sets the flag and leaves position and scale; undo restores it", () => {
  const { controller, video, act } = open();
  controller.select(timeline.selectElements([video]));
  act("preview.mirror");
  assert.deepEqual(transformOf(el(controller.stored, video)), { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, flip: { horizontal: true, vertical: false } });
  controller.undo();
  assert.equal(transformOf(el(controller.stored, video)).flip.horizontal, false);
});
test("Rotate 90° four times: 90, 180, −90 and 0 in turn", () => {
  const { controller, video, act } = open();
  controller.select(timeline.selectElements([video]));
  const seen: number[] = [];
  for (let turn = 0; turn < 4; turn++) { act("preview.rotate-90"); seen.push(transformOf(el(controller.stored, video)).rotation); }
  assert.deepEqual(seen, [90, 180, -90, 0]);
});
test("Keyframed rotation: a value of 350 at the playhead gets a key of 440 there", () => {
  const { controller, video } = open();
  controller.external((doc, ctx) => upsertKeyframe(doc, ctx, video, "transform.rotation", { time: 0, value: 350 }));
  controller.external((doc, ctx) => rotateQuarterTurn(doc, ctx, [video], S, () => 350));
  const keys = (el(controller.stored, video).animations["transform.rotation"].keys as { time: number; value: number }[]).map((key) => [key.time, key.value]);
  assert.deepEqual(keys, [[0, 350], [S, 440]]);
});
test("Clamp with keyframes: 3580 + 90 is written as 3600", () => {
  const { controller, video } = open();
  controller.external((doc, ctx) => upsertKeyframe(doc, ctx, video, "transform.rotation", { time: 0, value: 3580 }));
  controller.external((doc, ctx) => rotateQuarterTurn(doc, ctx, [video], S, () => 3580));
  assert.equal((el(controller.stored, video).animations["transform.rotation"].keys as { time: number; value: number }[]).find((key) => key.time === S)!.value, 3600);
});

// — Reset transform —
test("Reset transform: position, scale, rotation and flips return, and one undo restores them", () => {
  const { controller, video, act } = open();
  controller.select(timeline.selectElements([video]));
  controller.external((doc, ctx) => commitTransform(doc, ctx, video, 0, { position: { x: 200, y: 50 }, scale: { x: 2, y: 2 }, rotation: 30, flip: { horizontal: true, vertical: false } }));
  act("preview.reset-transform");
  assert.deepEqual(transformOf(el(controller.stored, video)), { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0, flip: { horizontal: false, vertical: false } });
  controller.undo();
  assert.deepEqual(transformOf(el(controller.stored, video)), { position: { x: 200, y: 50 }, scale: { x: 2, y: 2 }, rotation: 30, flip: { horizontal: true, vertical: false } });
});
test("Keyframes are removed: position keys at 1 s and 3 s are gone after the reset and back after one undo", () => {
  const { controller, video } = open();
  for (const time of [S, 3 * S]) controller.external((doc, ctx) => upsertKeyframe(doc, ctx, video, "transform.position.x", { time, value: 100 }));
  controller.external((doc, ctx) => resetTransforms(doc, ctx, [video]));
  assert.equal((el(controller.stored, video).animations ?? {})["transform.position.x"], undefined);
  controller.undo();
  assert.equal(el(controller.stored, video).animations["transform.position.x"].keys.length, 2);
});
test("Crop is kept: Reset transform leaves crop.left at 0.2", () => {
  const { controller, video } = open();
  controller.external((doc, ctx) => commitTransform(doc, ctx, video, 0, { rotation: 10 }));
  controller.run({ type: "test.crop", label: "Crop", run(draft) { (timeline.locate(draft, video)!.element as { crop: { left: number } }).crop.left = 0.2; } });
  controller.external((doc, ctx) => resetTransforms(doc, ctx, [video]));
  assert.equal(el(controller.stored, video).crop.left, 0.2);
});

// — Safe-area guides, grid, guides popover —
test("Vertical preset: side buttons on 1080×1920 span x 60–940 and y 130–1550", () => {
  assert.deepEqual(safeAreaRect("vertical-rail-right", { width: 1080, height: 1920 }), { x: 60, y: 130, width: 880, height: 1420 });
});
test("Scaled preset: on 720×1280 the margins are 86.7, 246.7, 40 and 93.3", () => {
  const margins = SAFE_AREA_PRESETS.find((preset) => preset.id === "vertical-rail-right")!.margins({ width: 720, height: 1280 });
  assert.deepEqual([margins.top, margins.bottom, margins.left, margins.right].map((value) => Math.round(value * 10) / 10), [86.7, 246.7, 40, 93.3]);
});
test("Wrong ratio: on 16:9 the four vertical presets are disabled and the two general ones apply", () => {
  assert.deepEqual(SAFE_AREA_PRESETS.filter((preset) => safeAreaAvailable(preset, CANVAS)).map((preset) => preset.id), ["title-safe", "action-safe"]);
  assert.equal(safeAreaRect("vertical-compact", CANVAS), null);
  assert.ok(isVerticalCanvas({ width: 1080, height: 1920 }));
  const title = safeAreaRect("title-safe", CANVAS)!;
  assert.deepEqual([title.x, title.y, title.width, title.height].map(Math.round), [96, 54, 1728, 972]);
});
test("Neutral labels: exactly six presets and no third-party name in any label", () => {
  assert.equal(SAFE_AREA_PRESETS.length, 6);
  assert.ok(SAFE_AREA_PRESETS.every((preset) => /^(Title safe|Action safe|Vertical feed — [a-z ]+)$/.test(preset.label)));
});
test("Default grid: two vertical and two horizontal lines make nine equal cells", () => {
  assert.deepEqual(gridLines(3, 3, CANVAS), { vertical: [640, 1280], horizontal: [360, 720] });
});
test("Limits: 40 rows becomes 24", () => {
  assert.equal(clampGrid(40), 24);
  assert.equal(clampGrid(0), 1);
});
test("Combined guides: Grid and a Safe area preset are on together and both are snap targets", () => {
  const guides = { ...GUIDE_DEFAULTS, grid: { on: true, rows: 3, columns: 3 }, safeArea: { on: true, preset: "title-safe" } };
  assert.ok(anyGuideOn(guides));
  assert.equal(anyGuideOn(GUIDE_DEFAULTS), false);
  const targets = snapTargets(CANVAS, guides, []);
  assert.ok(targets.x.includes(640 - 960) && targets.x.includes(96 - 960));
  // Hiding the guides keeps their configuration and takes them out of snapping.
  assert.equal(snapTargets(CANVAS, { ...guides, visible: false }, []).x.length, 3);
});

// — Geometry the engine's layout is read through —
test("the rotated rectangle is recovered from the bounds the engine reports", () => {
  const rotated = boxFromBounds("a", { x: 860, y: 340, width: 200, height: 400 }, 90, CANVAS);
  closeTo(rotated.width, 400, 1e-6); closeTo(rotated.height, 200, 1e-6);
  assert.deepEqual([rotated.cx, rotated.cy], [0, 0]);
  const plain = boxFromBounds("b", { x: 0, y: 0, width: 1920, height: 1080 }, 0, CANVAS);
  assert.deepEqual([plain.cx, plain.cy, plain.width, plain.height], [0, 0, 1920, 1080]);
  const point = toCanvas({ x: 480, y: 270 }, FIT_VIEW, { width: 960, height: 540 }, CANVAS);
  assert.deepEqual(point, { x: 0, y: 0 });
  void withTracks;
});
