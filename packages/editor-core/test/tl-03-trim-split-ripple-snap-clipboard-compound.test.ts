import assert from "node:assert/strict";
import { test } from "node:test";
import { timeline as tl, upsertKeyframe } from "../src/index.ts";
import { audio, context, put, sticker, text, tweak, video } from "./support/fixtures.ts";
import { audioTracks, el, main, OFF, ON, open, overlay, project, RIPPLE, S, spans, trackIdOf, trackOf, withTracks } from "./support/timeline.ts";

const clip = (id: string, start: number, seconds: number, extra: Record<string, unknown> = {}) => video(id, start, seconds, { sourceDuration: 60 * S, trimEnd: (60 - seconds) * S, ...extra });
const mainOf = (...clips: [string, number, number][]) => clips.reduce((doc, [id, start, seconds]) => put(doc, "t-main", clip(id, start, seconds)), project());
const onTrack = (...clips: unknown[]) => put(withTracks(project(), ["t-v", "video"]), "t-v", ...clips);
const MOBILE = tl.editContextFor("mobile", tl.DEFAULT_TIMELINE_PREFERENCES);

test("Edge auto-scroll: Horizontal auto-scroll", () => {
  const { dx, dy } = tl.edgeAutoScroll({ x: 990, y: 200 }, { width: 1000, height: 400 });
  assert.ok(Math.abs(dx - 13.5) <= 1);
  assert.equal(dy, 0);
  assert.deepEqual(tl.edgeAutoScroll({ x: 500, y: 200 }, { width: 1000, height: 400 }), { dx: 0, dy: 0 });
  assert.equal(tl.edgeAutoScroll({ x: 500, y: 400 }, { width: 1000, height: 400 }).dy, 10);
});

// — Trimming elements —
test("Trimming elements: Source bound", () => {
  const session = open(onTrack(clip("c", 5, 4)));
  const result = session.execute(tl.trim({ sceneId: "s1", elementId: "c", side: "start", delta: -2 * S }), OFF);
  assert.ok(result.ok && !result.changed);
  assert.deepEqual([spans(session.document, "t-v"), session.historyLength], [[[5, 9]], 0]);
});
test("Trimming elements: One-frame minimum", () => {
  const session = open(onTrack(clip("c", 5, 4)));
  session.execute(tl.trim({ sceneId: "s1", elementId: "c", side: "end", delta: -30 * S }), OFF);
  assert.equal(el(session.document, "c").duration, 4000);
});
test("Trimming elements: Free extension of text", () => {
  const session = open(put(withTracks(project(), ["t-text", "text"]), "t-text", text("x", 0, 5)));
  session.execute(tl.trim({ sceneId: "s1", elementId: "x", side: "end", delta: 10 * S }), OFF);
  assert.equal(el(session.document, "x").duration, 15 * S);
});
test("Trimming elements: Left trim keeps keyframe content position", () => {
  const keyed = upsertKeyframe(upsertKeyframe(onTrack(clip("c", 5, 4, { trimStart: 5 * S, trimEnd: 51 * S })), context(), "c", "opacity", { time: 0, value: 0 }).document, context({ newId: () => "k2" }), "c", "opacity", { time: 2 * S, value: 1 }).document;
  const session = open(keyed);
  session.execute(tl.trim({ sceneId: "s1", elementId: "c", side: "start", delta: 1 * S }), OFF);
  const element = el(session.document, "c"), keys = element.animations.opacity.keys;
  assert.deepEqual([element.startTime, element.trimStart, keys.map((key: { time: number }) => key.time)], [6 * S, 6 * S, [0, 1 * S]]);
  // The boundary key holds the interpolated value, so every remaining source frame has the opacity it had.
  assert.deepEqual(keys.map((key: { value: number }) => key.value), [0.5, 1]);
});
test("Trimming elements: Group trim with one member at its bound", () => {
  const session = open(put(onTrack(clip("p", 0, 4, { trimEnd: 0.5 * S, sourceDuration: 4.5 * S })), "t-main", clip("q", 0, 4)));
  session.execute(tl.trim({ sceneId: "s1", elementId: "q", side: "end", delta: 3 * S, selectedIds: ["p", "q"] }), OFF);
  assert.deepEqual([el(session.document, "p").duration, el(session.document, "q").duration, session.historyLength], [4.5 * S, 4.5 * S, 1]);
});
test("Trimming elements: Left neighbour bound with ripple off", () => {
  for (const edit of [ON, OFF]) {
    const session = open(onTrack(clip("n", 0, 4), clip("c", 5, 3, { trimStart: 3 * S, trimEnd: 54 * S })));
    session.execute(tl.trim({ sceneId: "s1", elementId: "c", side: "start", delta: -2 * S }), edit);
    assert.deepEqual(spans(session.document, "t-v"), [[0, 4], [4, 8]]);
  }
});
test("Trimming elements: Trimming one member of a selected group", () => {
  const doc = put(put(withTracks(project(), ["t-text", "text"], ["t-g", "graphic"]), "t-text", text("x", 0, 4, { groupId: "G" })), "t-g", sticker("k", 0, 4, { groupId: "G" }));
  const session = open(doc);
  session.select(tl.clickElement(session.document, session.selection, "x"));
  assert.deepEqual(session.selection.selectedElements.sort(), ["k", "x"]);
  session.execute(tl.trim({ sceneId: "s1", elementId: "k", side: "end", delta: -1 * S, selectedIds: session.selection.selectedElements }), OFF);
  assert.deepEqual([el(session.document, "k").duration, el(session.document, "x").duration], [3 * S, 4 * S]);
});
test("Trimming elements: Explicit multi-selection trims together", () => {
  const session = open(put(onTrack(clip("p", 0, 4)), "t-main", clip("q", 0, 4)));
  session.execute(tl.trim({ sceneId: "s1", elementId: "p", side: "end", delta: -1 * S, selectedIds: ["p", "q"] }), OFF);
  assert.deepEqual([el(session.document, "p").duration, el(session.document, "q").duration, session.historyLength], [3 * S, 3 * S, 1]);
});
test("Trimming elements: Main-track trim with the magnet on has no neighbour bound", () => {
  const session = open(put(put(project(), "t-main", clip("a", 0, 4, { trimEnd: 3 * S, sourceDuration: 7 * S })), "t-main", clip("b", 4, 4)));
  session.execute(tl.trim({ sceneId: "s1", elementId: "a", side: "end", delta: 2 * S }), ON);
  assert.deepEqual(spans(session.document, "t-main"), [[0, 6], [6, 10]]);
});

// — Split —
test("Split: Split a retimed clip", () => {
  const session = open(onTrack(clip("c", 0, 10, { retime: { rate: 2, maintainPitch: false, reverse: false, smooth: "none" }, trimStart: 0, trimEnd: 40 * S })));
  session.execute(tl.split({ sceneId: "s1", time: 4 * S, elementIds: ["c"] }), OFF);
  const [left, right] = trackOf(session.document, "t-v").elements;
  assert.deepEqual([left.duration, right.startTime, right.trimStart, right.duration, left.name, right.name], [4 * S, 4 * S, 8 * S, 6 * S, "c (left)", "c (right)"]);
  // No suffix stacking on repeated splits.
  session.execute(tl.split({ sceneId: "s1", time: 2 * S, elementIds: ["c"] }), OFF);
  assert.deepEqual(trackOf(session.document, "t-v").elements.map((element: { name: string }) => element.name), ["c (left)", "c (right)", "c (right)"]);
});
test("Split: Split with no selection", () => {
  let doc = withTracks(project(), ["t-1", "video"], ["t-2", "video"]);
  doc = put(put(put(doc, "t-1", clip("a", 0, 4)), "t-2", clip("b", 0, 4)), "t-main", clip("c", 0, 4));
  const session = open(doc);
  session.execute(tl.split({ sceneId: "s1", time: 2 * S }), OFF);
  assert.deepEqual([spans(session.document, "t-1"), spans(session.document, "t-2"), spans(session.document, "t-main")], [[[0, 2], [2, 4]], [[0, 2], [2, 4]], [[0, 2], [2, 4]]]);
  assert.equal(session.selection.selectedElements.length, 3);
  assert.ok(session.selection.selectedElements.every((id) => el(session.document, id).startTime === 2 * S));
});
test("Split: Split at an edge", () => {
  const session = open(onTrack(clip("c", 2, 4)));
  const result = session.execute(tl.split({ sceneId: "s1", time: 2 * S, elementIds: ["c"] }), OFF);
  assert.ok(result.ok && !result.changed);
  assert.equal(session.historyLength, 0);
});
test("Split: Delete right", () => {
  const session = open(onTrack(clip("c", 0, 10)));
  session.execute(tl.split({ sceneId: "s1", time: 6 * S, elementIds: ["c"], mode: "delete-right" }), OFF);
  assert.deepEqual([spans(session.document, "t-v"), el(session.document, "c").trimEnd], [[[0, 6]], 54 * S]);
  session.execute(tl.trim({ sceneId: "s1", elementId: "c", side: "end", delta: 4 * S }), OFF);
  assert.equal(el(session.document, "c").duration, 10 * S, "the source after 6 s is still there");
  // Delete left under the magnet moves the playhead to the remaining element's new start.
  const left = open(mainOf(["a", 0, 4], ["b", 4, 6]));
  const result = left.execute(tl.split({ sceneId: "s1", time: 6 * S, elementIds: ["b"], mode: "delete-left" }), ON);
  assert.deepEqual([spans(left.document, "t-main"), result.ok && result.info?.playhead], [[[0, 4], [4, 8]], 4 * S]);
});

// — Delete and ripple delete —
test("Delete and ripple delete: Plain delete on an overlay track", () => {
  const session = open(onTrack(clip("a", 0, 3), clip("b", 3, 3)));
  session.select(tl.selectElements(["a"]));
  session.execute(tl.deleteElements({ sceneId: "s1", elementIds: ["a"] }), OFF);
  assert.deepEqual([spans(session.document, "t-v"), session.selection.selectedElements], [[[3, 6]], []]);
});
test("Delete and ripple delete: Ripple delete", () => {
  const session = open(onTrack(clip("a", 0, 3), clip("b", 3, 3)));
  session.execute(tl.deleteElements({ sceneId: "s1", elementIds: ["a"], ripple: true }), OFF);
  assert.deepEqual(spans(session.document, "t-v"), [[0, 3]]);
  session.undo();
  assert.deepEqual(spans(session.document, "t-v"), [[0, 3], [3, 6]]);
  // Deleting a compound element does not delete its source scene.
  const compound = open(onTrack(clip("x", 0, 3)));
  compound.execute(tl.createCompound({ sceneId: "s1", elementIds: ["x"] }), OFF);
  compound.execute(tl.deleteElements({ sceneId: "s1", elementIds: compound.selection.selectedElements }), OFF);
  assert.equal(compound.document.scenes.length, 2);
});
test("Delete and ripple delete: Delete with keyframes selected", () => {
  const ctx = context({ newId: (() => { let n = 0; return () => `k${++n}`; })() });
  let doc = onTrack(clip("c", 0, 4));
  for (const time of [0, S, 2 * S]) doc = upsertKeyframe(doc, ctx, "c", "opacity", { time, value: time / (2 * S) }).document;
  const session = open(doc), keys = el(doc, "c").animations.opacity.keys;
  session.select(tl.selectKeyframes(tl.selectElements(["c"]), [{ elementId: "c", path: "opacity", keyId: keys[0].id }, { elementId: "c", path: "opacity", keyId: keys[1].id }]));
  const action = tl.deleteSelection(session.selection, "s1");
  assert.equal(action.kind, "keyframes");
  if (action.kind === "keyframes") session.execute(action.command, OFF);
  assert.deepEqual([el(session.document, "c").animations.opacity.keys.length, spans(session.document, "t-v")], [1, [[0, 4]]]);
});

// — Ripple mode —
test("Ripple mode: End trim ripples", () => {
  const session = open(onTrack(clip("a", 0, 4), clip("b", 4, 2), clip("c", 7, 2)));
  session.execute(tl.trim({ sceneId: "s1", elementId: "a", side: "end", delta: -2 * S }), RIPPLE);
  assert.deepEqual(spans(session.document, "t-v"), [[0, 2], [2, 4], [5, 7]]);
  session.undo();
  assert.deepEqual(spans(session.document, "t-v"), [[0, 4], [4, 6], [7, 9]]);
});
test("Ripple mode: Left trim ripples", () => {
  const session = open(onTrack(clip("a", 5, 4), clip("b", 9, 2)));
  session.execute(tl.trim({ sceneId: "s1", elementId: "a", side: "start", delta: 1 * S }), RIPPLE);
  assert.deepEqual([spans(session.document, "t-v"), el(session.document, "a").trimStart], [[[5, 8], [8, 10]], 1 * S]);
});
test("Ripple mode: Left outward extension", () => {
  const session = open(onTrack(clip("n", 1, 4), clip("a", 5, 4, { trimStart: 2 * S, trimEnd: 54 * S }), clip("b", 9, 2)));
  session.execute(tl.trim({ sceneId: "s1", elementId: "a", side: "start", delta: -1 * S }), RIPPLE);
  assert.deepEqual([spans(session.document, "t-v"), el(session.document, "a").trimStart], [[[1, 5], [5, 10], [10, 12]], 1 * S]);
});
test("Ripple mode: Other tracks are untouched", () => {
  const doc = put(put(withTracks(project(), ["t-1", "video"], ["t-2", "video"]), "t-1", clip("a", 0, 3), clip("b", 3, 3)), "t-2", clip("c", 4, 3));
  const session = open(put(doc, "t-main", clip("m", 5, 3)));
  session.execute(tl.deleteElements({ sceneId: "s1", elementIds: ["a"] }), RIPPLE);
  assert.deepEqual([spans(session.document, "t-1"), spans(session.document, "t-2"), spans(session.document, "t-main")], [[[0, 3]], [[4, 7]], [[5, 8]]]);
  // Mobile never ripples: overlay tracks keep their gaps.
  assert.equal(MOBILE.ripple, false);
});

// — Snapping —
const snapDoc = () => onTrack(clip("fixed", 0, 4), clip("drag", 8, 2));
test("Snapping: Snap to a neighbour edge", () => {
  const doc = snapDoc(), wanted = 4 * S + tl.pixelsToTicks(9, 1);
  const snap = tl.snapGesture(doc, "element-move", [wanted, wanted + 2 * S], { zoomLevel: 1, enabled: true, excludeElementIds: ["drag"], playhead: 30 * S });
  assert.deepEqual([snap.snapped, wanted + snap.delta, snap.time, snap.point?.type], [true, 4 * S, 4 * S, "element-end"]);
});
test("Snapping: Shift disables snapping", () => {
  const doc = snapDoc(), wanted = 4 * S + tl.pixelsToTicks(9, 1);
  const snap = tl.snapGesture(doc, "element-move", [wanted], { zoomLevel: 1, enabled: true, shift: true, excludeElementIds: ["drag"] });
  assert.deepEqual([snap.snapped, snap.delta], [false, 0]);
  assert.equal(tl.dragTargetTime(doc, wanted, 0) % 4000, 0);
});
test("Snapping: Threshold scales with zoom", () => {
  assert.equal(tl.snapThresholdTicks(1), 24000);
  assert.equal(tl.snapThresholdTicks(2), 12000);
  assert.equal(tl.snapThresholdTicks(1, "mobile"), 28800);
});
test("Snapping: Toggle off applies to scrubbing", () => {
  const doc = snapDoc(), near = 4 * S + 4000;
  assert.equal(tl.snapGesture(doc, "playhead-scrub", [near], { zoomLevel: 1, enabled: false }).snapped, false);
  assert.equal(tl.snapGesture(doc, "playhead-scrub", [near], { zoomLevel: 1, enabled: true }).time, 4 * S);
  // The playhead is not a snap source of its own scrub; time 0 and the playhead are for moves.
  assert.ok(!tl.snapPoints(doc, "playhead-scrub", { playhead: 9 * S }).some((point) => point.type === "playhead" || point.type === "zero"));
});
test("Snapping: Just outside the threshold", () => {
  const doc = snapDoc(), wanted = 4 * S + tl.pixelsToTicks(11, 1);
  assert.equal(tl.snapGesture(doc, "element-move", [wanted], { zoomLevel: 1, enabled: true, excludeElementIds: ["drag"] }).snapped, false);
  // Ties resolve to the earliest time; hidden tracks are no sources.
  assert.equal(tl.resolveSnap([100], [{ time: 110, type: "marker" }, { time: 90, type: "marker" }], 20).time, 90);
  assert.equal(tl.snapPoints(tweak(doc, (draft) => { draft.scenes[0].tracks.overlay[0].hidden = true; }), "element-move").filter((point) => point.elementId).length, 0);
});

// — Preview axis —
test("Preview axis: Hover scrub", () => {
  const state = tl.previewAxisState({ enabled: true, touch: false, gestureActive: false, playing: false, engine: "ready", hoverTime: 8 * S, playhead: 2 * S });
  assert.deepEqual(state, { available: true, hoverLineTime: 8 * S, frameTime: 8 * S });
  assert.equal(tl.previewAxisState({ enabled: true, touch: false, gestureActive: false, playing: false, engine: "ready", playhead: 2 * S }).frameTime, 2 * S, "leaving the timeline restores the playhead frame");
  assert.deepEqual(tl.previewAxisState({ enabled: true, touch: false, gestureActive: false, playing: false, engine: "no-gpu", hoverTime: 8 * S, playhead: 2 * S }), { available: false, tooltip: "Preview is unavailable", frameTime: 2 * S });
  assert.equal(tl.previewAxisState({ enabled: true, touch: true, gestureActive: false, playing: false, engine: "ready", hoverTime: 8 * S, playhead: 2 * S }).available, false);
});
test("Preview axis: Disabled during playback", () => {
  const state = tl.previewAxisState({ enabled: true, touch: false, gestureActive: false, playing: true, engine: "ready", hoverTime: 8 * S, playhead: 2 * S });
  assert.deepEqual([state.hoverLineTime, state.frameTime], [undefined, 2 * S]);
});

// — Clipboard —
test("Clipboard: Paste preserves offsets", () => {
  const session = open(onTrack(clip("p", 2, 2), clip("q", 5, 2))), clipboard = tl.createClipboard();
  clipboard.set(tl.copyElements(session.document, "s1", ["p", "q"]));
  session.execute(tl.paste({ sceneId: "s1", entry: clipboard.entry, time: 10 * S }), OFF);
  const pasted = session.selection.selectedElements.map((id) => el(session.document, id).startTime / S).sort((a, b) => a - b);
  assert.deepEqual([pasted, el(session.document, "p").startTime, el(session.document, "q").startTime, session.historyLength], [[10, 13], 2 * S, 5 * S, 1]);
  assert.ok(session.selection.selectedElements.every((id) => id !== "p" && id !== "q"));
});
test("Clipboard: Cut", () => {
  const session = open(onTrack(clip("p", 2, 2), clip("q", 5, 2))), clipboard = tl.createClipboard();
  session.execute(tl.cutElements(session.document, clipboard, "s1", ["p"]), OFF);
  assert.deepEqual([spans(session.document, "t-v"), clipboard.entry?.kind, session.historyLength], [[[5, 7]], "elements", 1]);
  session.undo();
  assert.deepEqual([spans(session.document, "t-v"), clipboard.isEmpty], [[[2, 4], [5, 7]], false]);
});
const projectB = () => tweak(project(), (draft) => { draft.metadata.id = "p2"; draft.media.assets = draft.media.assets.filter((asset: { id: string }) => asset.id !== "a4"); });
test("Clipboard: Cross-project paste copies media", () => {
  const a = onTrack(video("c", 0, 4, { mediaId: "a4", sourceDuration: 20 * S, trimEnd: 16 * S, workflowLink: { runId: "r1", stepId: "st1", artifactVersionId: "v1" } }));
  const entry = tl.copyElements(a, "s1", ["c"]);
  const session = open(projectB());
  const result = session.execute(tl.paste({ sceneId: "s1", entry, time: 0, availableBytes: 10_000 }), OFF);
  assert.ok(result.ok);
  const pasted = el(session.document, session.selection.selectedElements[0]);
  assert.ok(session.document.media.assets.some((asset) => asset.id === pasted.mediaId && asset.contentHash === "b".repeat(64)));
  assert.equal(session.document.media.assets.length, 4);
});
test("Clipboard: Cross-project paste without space", () => {
  const a = tweak(onTrack(video("c", 0, 4, { mediaId: "a4", sourceDuration: 20 * S, trimEnd: 16 * S })), (draft) => { draft.media.assets[3].size = 2 * 1024 ** 3; });
  const session = open(projectB()), before = session.document;
  const result = session.execute(tl.paste({ sceneId: "s1", entry: tl.copyElements(a, "s1", ["c"]), time: 0, availableBytes: 1024 ** 3, quotaMessage: "Not enough storage" }), OFF);
  assert.deepEqual([result.ok, !result.ok && result.message, session.document === before], [false, "Not enough storage", true]);
});
test("Clipboard: Empty clipboard", () => {
  const session = open(onTrack(clip("p", 2, 2))), clipboard = tl.createClipboard();
  assert.equal(tl.pasteDecision(clipboard.entry, false), "none");
  assert.equal(tl.pasteDecision(clipboard.entry, true), "import-media");
  const result = session.execute(tl.paste({ sceneId: "s1", entry: clipboard.entry, time: 0 }), OFF);
  assert.ok(result.ok && !result.changed);
  assert.equal(session.historyLength, 0);
});

// — Duplicate —
test("Duplicate: Duplicate on the magnetic main track", () => {
  const session = open(mainOf(["a", 0, 4], ["b", 4, 3]));
  session.execute(tl.duplicate({ sceneId: "s1", elementIds: ["a"] }), ON);
  assert.deepEqual(spans(session.document, "t-main"), [[0, 4], [4, 8], [8, 11]]);
  assert.equal(main(session.document).elements[1].id, session.selection.selectedElements[0]);
});
test("Duplicate: Duplicate an overlay clip with free space after it", () => {
  const session = open(put(withTracks(project(), ["t-text", "text"]), "t-text", text("title", 2, 3)));
  session.execute(tl.duplicate({ sceneId: "s1", elementIds: ["title"] }), ON);
  const copy = el(session.document, session.selection.selectedElements[0]);
  assert.deepEqual([spans(session.document, "t-text"), copy.name, overlay(session.document).length], [[[2, 5], [5, 8]], "title (copy)", 1]);
});
test("Duplicate: Duplicate when the space after is occupied", () => {
  const session = open(put(withTracks(project(), ["t-top", "video", { pinned: true }], ["t-text", "text"]), "t-text", text("title", 2, 3), text("next", 6, 3)));
  session.execute(tl.duplicate({ sceneId: "s1", elementIds: ["title"] }), ON);
  const tracks = overlay(session.document);
  assert.deepEqual([tracks.map((track) => track.type), spans(session.document, tracks[1].id), tracks[2].id], [["video", "text", "text"], [[2, 5]], "t-text"]);
  // Copies of a linked pair keep the pair under a new link.
  const pair = open(put(put(withTracks(project(), ["t-a", "audio"]), "t-main", clip("v", 0, 4, { linkId: "L" })), "t-a", audio("u", 0, 4, { mediaId: "a1", sourceDuration: 60 * S, trimEnd: 56 * S, linkId: "L" })));
  pair.execute(tl.duplicate({ sceneId: "s1", elementIds: ["v"] }), OFF);
  const copies = pair.selection.selectedElements.map((id) => el(pair.document, id));
  assert.deepEqual([copies.length, copies[0].linkId === copies[1].linkId, copies[0].linkId !== "L"], [2, true, true]);
});

// — Group and ungroup —
const groupable = () => put(put(withTracks(project(), ["t-text", "text"], ["t-g", "graphic"]), "t-text", text("x", 0, 4)), "t-g", sticker("k", 0, 4));
test("Group and ungroup: Group then move", () => {
  const session = open(groupable());
  session.execute(tl.group({ sceneId: "s1", elementIds: ["x", "k"] }), OFF);
  assert.ok(el(session.document, "x").groupId && el(session.document, "x").groupId === el(session.document, "k").groupId);
  // Pressing any member selects the whole group, and the drag moves the selection.
  session.select(tl.clickElement(session.document, session.selection, "x"));
  session.execute(tl.move({ sceneId: "s1", elementIds: session.selection.selectedElements, anchorId: "x", time: 2 * S }), OFF);
  assert.deepEqual([el(session.document, "x").startTime, el(session.document, "k").startTime, session.historyLength], [2 * S, 2 * S, 2]);
  // A member on a locked track rejects the group move as a whole.
  session.execute(tl.toggleTrackFlag({ trackId: "t-g", flag: "locked" }), OFF);
  assert.equal(session.execute(tl.move({ sceneId: "s1", elementIds: ["x"], time: 5 * S }), OFF).ok, false);
});
test("Group and ungroup: Ungroup", () => {
  const session = open(groupable());
  session.execute(tl.group({ sceneId: "s1", elementIds: ["x", "k"] }), OFF);
  assert.deepEqual(tl.clickElement(session.document, tl.EMPTY_SELECTION, "k").selectedElements.sort(), ["k", "x"]);
  assert.deepEqual(tl.clickElement(session.document, tl.EMPTY_SELECTION, "k", { single: true }).selectedElements, ["k"]);
  session.execute(tl.ungroup({ sceneId: "s1", elementIds: ["x", "k"] }), OFF);
  assert.deepEqual(tl.clickElement(session.document, tl.EMPTY_SELECTION, "k").selectedElements, ["k"]);
});
test("Group and ungroup: Group dissolves at one member", () => {
  const session = open(groupable());
  session.execute(tl.group({ sceneId: "s1", elementIds: ["x", "k"] }), OFF);
  const groupId = el(session.document, "x").groupId;
  // Alt/Option-click selects the single member; deleting it leaves one, so the group no longer exists.
  session.select(tl.clickElement(session.document, session.selection, "k", { single: true }));
  session.execute(tl.deleteElements({ sceneId: "s1", elementIds: session.selection.selectedElements }), OFF);
  assert.deepEqual([el(session.document, "k"), el(session.document, "x").groupId], [undefined, null]);
  session.undo();
  assert.deepEqual([el(session.document, "x").groupId, el(session.document, "k").groupId], [groupId, groupId]);
});

// — Compound clips —
const compoundDoc = () => put(put(withTracks(project(), ["t-v", "video"]), "t-v", clip("o", 4, 4)), "t-main", clip("m1", 4, 4), clip("m2", 8, 4));
test("Compound clips: Create a compound clip", () => {
  const session = open(compoundDoc());
  const result = session.execute(tl.createCompound({ sceneId: "s1", elementIds: ["o", "m1", "m2"] }), OFF);
  assert.ok(result.ok);
  const compound = main(session.document).elements[0], scene = session.document.scenes[1];
  assert.deepEqual([spans(session.document, "t-main"), compound.type, compound.sceneId, scene.name, scene.kind, overlay(session.document).length], [[[4, 12]], "compound", scene.id, "Compound 1", "compound", 0]);
  assert.deepEqual([spans(session.document, scene.tracks.main.id), spans(session.document, (scene.tracks.overlay[0] as any).id)], [[[0, 4], [4, 8]], [[0, 4]]]);
  assert.equal(session.historyLength, 1);
});
test("Compound clips: Enter and exit", () => {
  const session = open(compoundDoc());
  session.execute(tl.createCompound({ sceneId: "s1", elementIds: ["o", "m1", "m2"] }), OFF);
  session.seek(6 * S);
  const steps = session.historyLength;
  session.enterCompound(session.selection.selectedElements[0]);
  assert.deepEqual([session.sceneId, session.playhead], [session.document.scenes[1].id, 2 * S]);
  assert.deepEqual(tl.breadcrumb(session.document, "s1", [...session.sceneStack]).map((crumb) => crumb.name), ["Main scene", "Compound 1"]);
  session.exitCompound();
  assert.deepEqual([session.sceneId, session.playhead, session.historyLength], ["s1", 6 * S, steps]);
});
test("Compound clips: Cycle is refused", () => {
  const session = open(compoundDoc());
  session.execute(tl.createCompound({ sceneId: "s1", elementIds: ["o", "m1", "m2"] }), OFF);
  const inner = session.document.scenes[1].id, entry = tl.copyElements(session.document, "s1", session.selection.selectedElements), before = session.document;
  const result = session.execute(tl.paste({ sceneId: inner, entry, time: 20 * S }), OFF);
  assert.deepEqual([result.ok, !result.ok && result.message, session.document === before], [false, "A compound clip cannot contain itself", true]);
});
test("Compound clips: Depth limit", () => {
  const session = open(put(project(), "t-main", clip("c", 0, 4)));
  let sceneId = "s1", target = "c";
  for (let level = 1; level <= 8; level++) {
    const made = session.execute(tl.createCompound({ sceneId, elementIds: [target] }), OFF);
    assert.ok(made.ok, `level ${level}`);
    sceneId = (made.ok && made.info!.sceneId) as string;
  }
  const before = session.document;
  const refused = session.execute(tl.createCompound({ sceneId, elementIds: ["c"] }), OFF);
  assert.deepEqual([refused.ok, !refused.ok && refused.message, session.document === before], [false, "Compound clips can be nested up to 8 levels", true]);
});
test("Compound clips: Dissolve", () => {
  const session = open(compoundDoc());
  session.execute(tl.createCompound({ sceneId: "s1", elementIds: ["o", "m1", "m2"] }), OFF);
  session.execute(tl.dissolveCompound({ sceneId: "s1", elementId: session.selection.selectedElements[0] }), OFF);
  assert.deepEqual([spans(session.document, "t-main"), el(session.document, "o").startTime, trackOf(session.document, trackIdOf(session.document, "o")!).type, session.document.scenes.length], [[[4, 8], [8, 12]], 4 * S, "video", 1]);
});
test("Compound clips: Audio-only selection", () => {
  const doc = put(put(withTracks(project(), ["t-text", "text"], ["t-a1", "audio"], ["t-a2", "audio"]), "t-a1", audio("u1", 2, 4)), "t-a2", audio("u2", 2, 4));
  const session = open(put(put(doc, "t-text", text("x", 0, 2)), "t-main", clip("m", 0, 9)));
  session.execute(tl.createCompound({ sceneId: "s1", elementIds: ["u1", "u2"] }), OFF);
  const tracks = overlay(session.document), scene = session.document.scenes[1];
  assert.deepEqual([tracks.map((track) => track.type), spans(session.document, tracks[1].id), audioTracks(session.document).length], [["text", "video"], [[2, 6]], 0]);
  assert.deepEqual([scene.tracks.audio.length, scene.tracks.main.elements.length, scene.tracks.overlay.length], [2, 0, 0]);
});
test("Compound clips: Unselected clip inside the range", () => {
  const session = open(put(onTrack(clip("c1", 0, 2), clip("c2", 3, 2), clip("c3", 6, 2)), "t-main", clip("m", 0, 9)));
  session.execute(tl.createCompound({ sceneId: "s1", elementIds: ["c1", "c3"] }), OFF);
  const tracks = overlay(session.document);
  assert.deepEqual([tracks.length, tracks[1].id, spans(session.document, tracks[0].id), spans(session.document, "t-v")], [2, "t-v", [[0, 8]], [[3, 5]]]);
});
test("Compound clips: Non-adjacent main-track selection", () => {
  const doc = mainOf(["a", 0, 4], ["b", 4, 3], ["c", 7, 5]);
  assert.deepEqual(tl.compoundAvailability(doc, "s1", ["a", "c"]), { enabled: false, reason: "Select adjacent main-track clips" });
  assert.equal(open(doc).execute(tl.createCompound({ sceneId: "s1", elementIds: ["a", "c"] }), OFF).ok, false);
  assert.deepEqual(tl.compoundAvailability(doc, "s1", ["a", "b"]), { enabled: true });
});
test("Compound clips: Overlay-only compound keeps the picture beneath", () => {
  const doc = put(put(put(withTracks(project(), ["t-text", "text"], ["t-g", "graphic"]), "t-text", text("x", 1, 3)), "t-g", sticker("k", 1, 3)), "t-main", clip("m", 0, 9));
  const session = open(doc);
  session.execute(tl.createCompound({ sceneId: "s1", elementIds: ["x", "k"] }), OFF);
  assert.deepEqual([spans(session.document, "t-main"), overlay(session.document).map((track) => track.type), spans(session.document, overlay(session.document)[0].id)], [[[0, 9]], ["video"], [[1, 4]]]);
});

// — Multi-camera clip —
const cams = (count = 2) => { let doc = project(); for (let index = 0; index < count; index++) doc = put(withTracks(doc, [`cam${index}`, "video"]), `cam${index}`, clip(`k${index}`, index, 10)); return doc; };
const pulses = (shift: number) => Float32Array.from({ length: 400 }, (_, index) => (((index - shift) % 97) === 0 || ((index - shift) % 41) === 3 ? 1 : 0));
const makeMulticam = (session: ReturnType<typeof open>, method: "audio" | "start" | "playhead" = "playhead", count = 2) => {
  const ids = Array.from({ length: count }, (_, index) => `k${index}`);
  return session.execute(tl.createMulticam({ sceneId: "s1", syncMethod: method, angles: tl.syncOffsets(session.document, "s1", ids, method).angles }), OFF);
};
test("Multi-camera clip: Create by audio sync", () => {
  const session = open(cams());
  const correlation = tl.correlateEnvelopes(pulses(0), pulses(20), 100, 1);
  assert.ok(Math.abs(correlation.offsetSeconds + 0.2) < 1e-9 && correlation.peak > 0.9);
  const sync = tl.syncOffsets(session.document, "s1", ["k0", "k1"], "audio", { k1: correlation });
  assert.deepEqual([sync.angles.map((angle) => angle.offset), sync.warnings], [[0, -24000], []]);
  assert.ok(session.execute(tl.createMulticam({ sceneId: "s1", syncMethod: "audio", angles: sync.angles }), OFF).ok);
  const scene = session.document.scenes[1] as any, part = el(session.document, session.selection.selectedElements[0]);
  assert.deepEqual([scene.kind, scene.name, scene.tracks.overlay.length, scene.tracks.main.elements.length, scene.tracks.audio.length, scene.multicam.angles.map((angle: { name: string }) => angle.name)], ["multicam", "Multicam 1", 2, 0, 0, ["Angle 1", "Angle 2"]]);
  assert.deepEqual([scene.tracks.overlay[0].elements[0].startTime, scene.tracks.overlay[1].elements[0].startTime, part.multicam.angleId, part.startTime, part.duration], [24000, 0, scene.multicam.angles[0].id, 0, 10 * S + 24000]);
  assert.equal(session.historyLength, 1);
});
test("Multi-camera clip: Unrelated audio", () => {
  const doc = cams(3);
  const sync = tl.syncOffsets(doc, "s1", ["k0", "k1", "k2"], "audio", { k1: { offsetSeconds: 0.5, peak: 0.9 }, k2: { offsetSeconds: 3, peak: 0.31 } });
  assert.deepEqual([sync.angles.map((angle) => [angle.offset, angle.confidence]), sync.warnings], [[[0, 1], [60000, 0.9], [0, 0.31]], ["k2"]]);
  const session = open(doc);
  session.execute(tl.createMulticam({ sceneId: "s1", syncMethod: "audio", angles: sync.angles }), OFF);
  assert.equal((session.document.scenes[1] as any).multicam.angles[2].syncConfidence, 0.31);
});
test("Multi-camera clip: Switch angle at the playhead", () => {
  const session = open(cams());
  makeMulticam(session, "start");
  const scene = session.document.scenes[1] as any, steps = session.historyLength;
  session.execute(tl.switchAngle({ sceneId: "s1", time: 5 * S, angle: 2 }), OFF);
  const parts = tl.tracksOfScene(tl.sceneById(session.document, "s1")).flatMap((track) => track.elements);
  assert.deepEqual([parts.map((part) => [part.startTime / S, (part.multicam as any).angleId]), parts[1].trimStart], [[[0, scene.multicam.angles[0].id], [5, scene.multicam.angles[1].id]], 5 * S]);
  assert.deepEqual(tl.heardAngles(session.document, scene.id).map((entry) => entry.angleId), [scene.multicam.angles[0].id, scene.multicam.angles[0].id], "the sound continues from angle 1");
  assert.equal(session.historyLength, steps + 1);
  session.undo();
  assert.equal(tl.tracksOfScene(tl.sceneById(session.document, "s1")).flatMap((track) => track.elements).length, 1);
  // The angle the part already shows does nothing.
  const same = session.execute(tl.switchAngle({ sceneId: "s1", time: 5 * S, angle: 1 }), OFF);
  assert.ok(same.ok && !same.changed);
});
test("Multi-camera clip: Live cutting during playback", () => {
  const session = open(cams());
  makeMulticam(session, "start");
  const steps = session.historyLength;
  session.execute(tl.switchAngle({ sceneId: "s1", time: 3 * S, angle: 2 }), OFF);
  session.execute(tl.switchAngle({ sceneId: "s1", time: 6 * S, angle: 1 }), OFF);
  const scene = session.document.scenes[1] as any, parts = tl.tracksOfScene(tl.sceneById(session.document, "s1")).flatMap((track) => track.elements);
  assert.deepEqual(parts.map((part) => [part.startTime / S, scene.multicam.angles.findIndex((angle: { id: string }) => angle.id === (part.multicam as any).angleId) + 1]), [[0, 1], [3, 2], [6, 1]]);
  assert.equal(session.historyLength, steps + 2);
});
test("Multi-camera clip: Switching back merges", () => {
  const session = open(cams());
  makeMulticam(session, "start");
  session.execute(tl.switchAngle({ sceneId: "s1", time: 5 * S, angle: 2 }), OFF);
  session.execute(tl.switchAngle({ sceneId: "s1", time: 5 * S, angle: 1 }), OFF);
  const parts = tl.tracksOfScene(tl.sceneById(session.document, "s1")).flatMap((track) => track.elements);
  assert.deepEqual(parts.map((part) => [part.startTime, part.duration, part.trimEnd]), [[0, 10 * S, 0]]);
});
test("Multi-camera clip: Audio follows video", () => {
  const session = open(cams());
  makeMulticam(session, "start");
  session.execute(tl.switchAngle({ sceneId: "s1", time: 3 * S, angle: 2 }), OFF);
  session.execute(tl.switchAngle({ sceneId: "s1", time: 6 * S, angle: 1 }), OFF);
  const scene = session.document.scenes[1] as any, [a1, a2] = scene.multicam.angles.map((angle: { id: string }) => angle.id), steps = session.historyLength;
  session.execute(tl.setMulticamAudio({ sceneId: scene.id, audioFollowsVideo: true }), OFF);
  assert.deepEqual([tl.heardAngles(session.document, scene.id).map((entry) => entry.angleId), session.historyLength], [[a1, a2, a1], steps + 1]);
});
test("Multi-camera clip: Angle in use cannot be removed", () => {
  const session = open(cams(3));
  makeMulticam(session, "start", 3);
  session.execute(tl.switchAngle({ sceneId: "s1", time: 3 * S, angle: 2 }), OFF);
  session.execute(tl.switchAngle({ sceneId: "s1", time: 5 * S, angle: 3 }), OFF);
  session.execute(tl.switchAngle({ sceneId: "s1", time: 7 * S, angle: 2 }), OFF);
  const scene = session.document.scenes[1] as any, before = session.document;
  const result = session.execute(tl.removeAngle({ sceneId: scene.id, angleId: scene.multicam.angles[1].id }), OFF);
  assert.deepEqual([result.ok, !result.ok && result.message, session.document === before], [false, "This angle is used by 2 clips", true]);
  // Source editing: rename, reorder, slide (the delta is added to the angle's syncOffset), and the definition is protected.
  session.execute(tl.renameAngle({ sceneId: scene.id, angleId: scene.multicam.angles[2].id, name: "Wide" }), OFF);
  session.execute(tl.slideAngle({ sceneId: scene.id, angleId: scene.multicam.angles[2].id, delta: S }), OFF);
  const after = session.document.scenes[1] as any;
  assert.deepEqual([after.multicam.angles[2].name, after.multicam.angles[2].syncOffset, after.tracks.overlay[2].elements[0].startTime], ["Wide", S, S]);
  const broken = session.execute(tl.addToTimeline({ sceneId: scene.id, items: [{ kind: "text" }], time: 0 }), OFF);
  assert.deepEqual([broken.ok, !broken.ok && broken.message], [false, "A multi-camera source holds only its angles"]);
});
test("Multi-camera clip: Selection size bounds", () => {
  const doc = cams(2);
  assert.deepEqual(tl.multicamAvailability(doc, "s1", ["k0"]).reason, "Select 2 to 8 video clips");
  const nine = cams(9);
  assert.deepEqual([tl.multicamAvailability(nine, "s1", Array.from({ length: 9 }, (_, index) => `k${index}`)).reason, tl.multicamAvailability(nine, "s1", ["k0", "k1"]).enabled], ["Select 2 to 8 video clips", true]);
  assert.equal(tl.multicamAvailability(tweak(doc, (draft) => { draft.scenes[0].tracks.overlay[0].elements[0].linkId = "L"; }), "s1", ["k0", "k1"]).reason, "Recover audio into the clips first");
});
test("Multi-camera clip: Flatten is refused when the sound would change", () => {
  const session = open(cams());
  makeMulticam(session, "start");
  session.execute(tl.switchAngle({ sceneId: "s1", time: 4 * S, angle: 2 }), OFF);
  const part = session.selection.selectedElements, scene = session.document.scenes[1] as any;
  assert.deepEqual(tl.flattenAvailability(session.document, "s1", part), { enabled: false, reason: "Turn on 'Audio follows video' to flatten" });
  assert.equal(session.execute(tl.flattenMulticam({ sceneId: "s1", elementIds: part }), OFF).ok, false);
  session.execute(tl.setMulticamAudio({ sceneId: scene.id, audioFollowsVideo: true }), OFF);
  const all = tl.tracksOfScene(tl.sceneById(session.document, "s1")).flatMap((track) => track.elements).map((element) => element.id);
  assert.ok(session.execute(tl.flattenMulticam({ sceneId: "s1", elementIds: all }), OFF).ok);
  const flat = tl.tracksOfScene(tl.sceneById(session.document, "s1")).flatMap((track) => track.elements);
  assert.deepEqual([flat.map((element) => [element.type, element.startTime / S, element.duration / S, element.trimStart / S]), session.document.scenes.length], [[["video", 0, 4, 0], ["video", 4, 6, 4]], 1]);
});
test("Multi-camera clip: Opened on a phone", () => {
  const session = open(cams());
  makeMulticam(session, "start");
  const part = el(session.document, session.selection.selectedElements[0]);
  assert.deepEqual(tl.angleList(session.document, part).map((angle) => [angle.label, angle.active]), [["A1 Angle 1", true], ["A2 Angle 2", false]]);
  session.execute(tl.switchAngle({ sceneId: "s1", time: 5 * S, angle: 2 }), MOBILE);
  assert.equal(tl.tracksOfScene(tl.sceneById(session.document, "s1")).flatMap((track) => track.elements).length, 2);
  const menu = tl.elementContextMenu(session.document, "s1", session.selection.selectedElements).flatMap((item) => ("id" in item ? [item.id] : []));
  assert.ok(menu.includes("multicam-switch") && menu.includes("multicam-flatten"));
  for (const action of ["timeline.multicam.switch-angle-2", "timeline.multicam.create", "timeline.multicam.flatten"]) assert.ok(tl.MOBILE_TIMELINE_ACTIONS[action]);
});
test("Multi-camera clip: Created on a phone", () => {
  const session = open(cams(3));
  const sync = tl.syncOffsets(session.document, "s1", ["k0", "k1", "k2"], "audio", { k1: { offsetSeconds: 1, peak: 0.8 }, k2: { offsetSeconds: -1, peak: 0.7 } });
  assert.ok(session.execute(tl.createMulticam({ sceneId: "s1", syncMethod: "audio", angles: sync.angles }), MOBILE).ok);
  const scene = session.document.scenes[1] as any;
  assert.deepEqual([scene.multicam.angles.length, scene.tracks.overlay.map((track: any) => track.elements[0].startTime / S), session.historyLength], [3, [1, 2, 0], 1]);
});
