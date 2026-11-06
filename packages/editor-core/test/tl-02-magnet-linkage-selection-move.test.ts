import assert from "node:assert/strict";
import { test } from "node:test";
import { timeline as tl } from "../src/index.ts";
import { audio, put, sticker, text, tweak, video } from "./support/fixtures.ts";
import { el, FREE, main, OFF, ON, open, overlay, project, RIPPLE, S, spans, trackIdOf, withTracks } from "./support/timeline.ts";

const clip = (id: string, start: number, seconds: number, extra: Record<string, unknown> = {}) => video(id, start, seconds, { sourceDuration: 60 * S, trimEnd: (60 - seconds) * S, ...extra });
const media = (assetId: string): tl.LibraryItem => ({ kind: "media", assetId });
/** Main-track clips `[id, start, seconds]`. */
const mainOf = (...clips: [string, number, number][]) => clips.reduce((doc, [id, start, seconds]) => put(doc, "t-main", clip(id, start, seconds)), project());
const PREFS = tl.DEFAULT_TIMELINE_PREFERENCES;

// — Frame-accurate positions and scene duration —
test("Frame-accurate positions and scene duration: Drop is frame-rounded", () => {
  const session = open(withTracks(project(), ["t-v", "video", { pinned: true }]));
  const time = tl.dropTime(session.document, 1.017);
  assert.equal(time, 124000);
  session.execute(tl.dropLibraryItem({ sceneId: "s1", items: [media("a2")], time: 1.017 * S, target: { hoveredTrackId: "t-v" } }), OFF);
  assert.equal(el(session.document, session.selection.selectedElements[0]).startTime, 124000);
});
test("Frame-accurate positions and scene duration: Duration follows the last end", () => {
  const session = open(mainOf(["a", 0, 4], ["b", 4, 6]));
  session.seek(10 * S);
  const before = tl.sceneDurationOf(tl.sceneById(session.document, "s1"));
  session.execute(tl.trim({ sceneId: "s1", elementId: "b", side: "end", delta: -2 * S }), ON);
  const after = tl.sceneDurationOf(tl.sceneById(session.document, "s1"));
  assert.deepEqual([before - after, session.document.metadata.duration, session.playhead], [240000, 8 * S, 8 * S]);
});

// — Magnetic main track —
test("Magnetic main track: Delete closes the gap", () => {
  const session = open(mainOf(["a", 0, 4], ["b", 4, 3], ["c", 7, 5]));
  session.execute(tl.deleteElements({ sceneId: "s1", elementIds: ["b"] }), ON);
  assert.deepEqual(spans(session.document, "t-main"), [[0, 4], [4, 9]]);
  session.undo();
  assert.deepEqual(spans(session.document, "t-main"), [[0, 4], [4, 7], [7, 12]]);
});
test("Magnetic main track: Reorder by drag", () => {
  const session = open(mainOf(["a", 0, 4], ["b", 4, 3], ["c", 7, 5]));
  // Dragged past the midpoint of the third clip (9.5 s).
  assert.ok(session.execute(tl.move({ sceneId: "s1", elementIds: ["a"], time: 8 * S, pointerTime: 10 * S }), ON).ok);
  assert.deepEqual(main(session.document).elements.map((element: { id: string }) => element.id), ["b", "c", "a"]);
  assert.deepEqual(spans(session.document, "t-main"), [[0, 3], [3, 8], [8, 12]]);
  assert.equal(session.historyLength, 1);
});
test("Magnetic main track: Magnet off keeps gaps", () => {
  const session = open(mainOf(["a", 0, 4], ["b", 4, 3], ["c", 7, 5]));
  session.execute(tl.deleteElements({ sceneId: "s1", elementIds: ["b"] }), OFF);
  assert.deepEqual(spans(session.document, "t-main"), [[0, 4], [7, 12]]);
});
test("Magnetic main track: First clip snaps to zero with magnet off", () => {
  const session = open(project());
  session.execute(tl.dropLibraryItem({ sceneId: "s1", items: [media("a2")], time: 3 * S, target: { hoveredTrackId: "t-main" } }), OFF);
  assert.equal(main(session.document).elements[0].startTime, 0);
});
test("Magnetic main track: Turning the magnet on closes the gaps", () => {
  const session = open(mainOf(["a", 0, 4], ["b", 6, 3]));
  const { prefs, closed } = session.setMagnet({ ...PREFS, magnet: false }, true);
  assert.deepEqual([closed, prefs.magnet, spans(session.document, "t-main"), session.historyLength, session.undoLabel], [true, true, [[0, 4], [4, 7]], 1, "Close gaps"]);
  session.undo();
  assert.deepEqual(spans(session.document, "t-main"), [[0, 4], [6, 9]]);
  assert.equal(prefs.magnet, true, "the magnet stays on after the undo");
  // The toggle is the only control: no action id exists for closing gaps.
  assert.ok(!tl.TIMELINE_ACTIONS.some((id) => id.includes("close-gaps")));
});
test("Magnetic main track: Turning the magnet on with nothing to close", () => {
  const session = open(mainOf(["a", 0, 4], ["b", 4, 3]));
  const before = session.document;
  assert.equal(session.setMagnet({ ...PREFS, magnet: false }, true).closed, false);
  assert.deepEqual([session.document === before, session.historyLength], [true, 0]);
  // Turning it off never changes data.
  session.setMagnet(PREFS, false);
  assert.equal(session.historyLength, 0);
});
test("Magnetic main track: Locked main track is not compacted", () => {
  const session = open(tweak(mainOf(["a", 0, 4], ["b", 6, 3]), (draft) => { draft.scenes[0].tracks.main.locked = true; }));
  assert.equal(session.setMagnet({ ...PREFS, magnet: false }, true).closed, false);
  assert.deepEqual(spans(session.document, "t-main"), [[0, 4], [6, 9]]);
  assert.equal(tl.magnetButtonState(session.document, PREFS).tooltip, "Unlock the main track to close its gaps");
});
test("Magnetic main track: An old gap survives an unrelated edit", () => {
  const session = open(mainOf(["a", 0, 4], ["b", 6, 3], ["c", 9, 3]));
  session.execute(tl.trim({ sceneId: "s1", elementId: "c", side: "end", delta: -1 * S }), ON);
  assert.deepEqual(spans(session.document, "t-main"), [[0, 4], [6, 9], [9, 11]]);
});
test("Magnetic main track: Delete before an old gap", () => {
  const session = open(mainOf(["a", 0, 4], ["b", 4, 2], ["c", 8, 2]));
  session.execute(tl.deleteElements({ sceneId: "s1", elementIds: ["b"] }), ON);
  assert.deepEqual(spans(session.document, "t-main"), [[0, 4], [6, 8]]);
});
test("Magnetic main track: Opening a project with gaps", () => {
  const gapped = mainOf(["a", 0, 4], ["b", 6, 3]);
  const session = open(gapped);
  // Opening compacts nothing and writes nothing, also with the stored preference on.
  assert.deepEqual([spans(session.document, "t-main"), session.historyLength, session.patches.length], [[[0, 4], [6, 9]], 0, 0]);
  assert.equal(tl.magnetButtonState(session.document, PREFS).tooltip, "Main track magnet — on. Turn off and on to close the gaps on this track");
  const off = session.setMagnet(PREFS, false).prefs;
  assert.equal(session.setMagnet(off, true).closed, true);
  assert.deepEqual([spans(session.document, "t-main"), session.historyLength], [[[0, 4], [4, 7]], 1]);
});

// — Free layer mode —
test("Free layer mode: Overlap creates an overlay", () => {
  const session = open(tweak(mainOf(["a", 0, 10]), (draft) => { draft.media.assets[3].duration = 4 * S; }));
  session.execute(tl.dropLibraryItem({ sceneId: "s1", items: [media("a4")], time: 3 * S, target: { hoveredTrackId: "t-main" } }), FREE);
  assert.deepEqual([overlay(session.document).length, overlay(session.document)[0].type, spans(session.document, overlay(session.document)[0].id), spans(session.document, "t-main")], [1, "video", [[3, 7]], [[0, 10]]]);
  session.undo();
  assert.equal(overlay(session.document).length, 0);
});
test("Free layer mode: Gap shows the background", () => {
  // The frame colour is the render engine's; here: the gap stays and an unrelated delete closes nothing.
  const session = open(put(withTracks(mainOf(["a", 0, 4], ["b", 6, 3]), ["t-text", "text"]), "t-text", text("x", 0, 2), text("y", 2, 2)));
  session.execute(tl.deleteElements({ sceneId: "s1", elementIds: ["x"] }), FREE);
  assert.deepEqual(spans(session.document, "t-main"), [[0, 4], [6, 9]]);
  session.execute(tl.deleteElements({ sceneId: "s1", elementIds: ["a"] }), FREE);
  assert.deepEqual(spans(session.document, "t-main"), [[6, 9]]);
});
test("Free layer mode: Magnet button", () => {
  const session = open(mainOf(["a", 0, 4], ["b", 4, 3], ["c", 7, 2]));
  const prefs = session.setFreeLayer(PREFS, true).prefs;
  assert.deepEqual(tl.magnetButtonState(session.document, prefs), { pressed: false, disabled: true, tooltip: "Off while Free layer is on" });
  assert.deepEqual([prefs.magnet, tl.editContextFor("desktop", prefs).magnet, session.historyLength], [true, false, 0]);
  session.execute(tl.deleteElements({ sceneId: "s1", elementIds: ["b"] }), tl.editContextFor("desktop", prefs));
  assert.deepEqual(spans(session.document, "t-main"), [[0, 4], [7, 9]]);
});
test("Free layer mode: Turning Free layer off", () => {
  const session = open(mainOf(["a", 0, 4], ["b", 6, 3]));
  const { prefs, closed } = session.setFreeLayer({ ...PREFS, freeLayer: true }, false);
  assert.deepEqual([closed, tl.magnetButtonState(session.document, prefs).disabled, tl.magnetButtonState(session.document, prefs).pressed, session.undoLabel], [true, false, true, "Close gaps"]);
  assert.deepEqual(spans(session.document, "t-main"), [[0, 4], [4, 7]]);
  session.undo();
  assert.deepEqual(spans(session.document, "t-main"), [[0, 4], [6, 9]]);
  // With the stored magnet off nothing changes.
  assert.equal(open(mainOf(["a", 0, 4], ["b", 6, 3])).setFreeLayer({ ...PREFS, magnet: false, freeLayer: true }, false).closed, false);
});
test("Free layer mode: Free main-track start", () => {
  const session = open(project());
  session.execute(tl.dropLibraryItem({ sceneId: "s1", items: [media("a2")], time: 3 * S, target: { hoveredTrackId: "t-main" } }), FREE);
  assert.equal(main(session.document).elements[0].startTime, 3 * S);
});

// — Per-clip canvas background —
const WHITE = { kind: "color", color: "#ffffff" } as const, BLUR = { kind: "blur", blurIntensity: 200 } as const;
test("Per-clip canvas background: Two clips, two backgrounds", () => {
  const session = open(mainOf(["a", 0, 4], ["b", 4, 4]));
  session.execute(tl.setBackground({ sceneId: "s1", selectedIds: ["a"], background: BLUR }), ON);
  session.execute(tl.setBackground({ sceneId: "s1", selectedIds: ["b"], background: WHITE }), ON);
  assert.deepEqual([el(session.document, "a").background, el(session.document, "b").background], [BLUR, WHITE]);
  // "Use project background" removes the override.
  session.execute(tl.setBackground({ sceneId: "s1", selectedIds: ["a"], background: undefined }), ON);
  assert.ok(!("background" in el(session.document, "a")));
});
test("Per-clip canvas background: Apply to all", () => {
  const session = open(put(put(project(), "t-main", clip("a", 0, 4, { background: BLUR })), "t-main", clip("b", 4, 4, { background: WHITE })));
  const previous = session.document.settings.background;
  session.execute(tl.applyBackgroundToAll({ background: WHITE }), ON);
  assert.deepEqual([session.document.settings.background, "background" in el(session.document, "a"), "background" in el(session.document, "b"), session.historyLength], [WHITE, false, false, 1]);
  session.undo();
  assert.deepEqual([session.document.settings.background, el(session.document, "a").background, el(session.document, "b").background], [previous, BLUR, WHITE]);
});
test("Per-clip canvas background: No clip selected", () => {
  const session = open(mainOf(["a", 0, 4], ["b", 6, 3]));
  assert.deepEqual(tl.backgroundTarget(session.document, { selectedIds: [], playhead: 5 * S }), { kind: "project" });
  session.execute(tl.setBackground({ sceneId: "s1", selectedIds: [], playhead: 5 * S, background: BLUR }), OFF);
  assert.equal(session.document.settings.background.kind, "blur");
  assert.ok(main(session.document).elements.every((element: object) => !("background" in element)));
  // On mobile the editor targets the main-track clip under the playhead.
  assert.deepEqual(tl.backgroundTarget(session.document, { selectedIds: [], playhead: 1 * S }), { kind: "element", elementId: "a" });
});
test("Per-clip canvas background: Split keeps the override", () => {
  const session = open(put(project(), "t-main", clip("a", 0, 4, { background: WHITE })));
  session.execute(tl.split({ sceneId: "s1", time: 2 * S, elementIds: ["a"] }), ON);
  assert.deepEqual(main(session.document).elements.map((element: { background: unknown }) => element.background), [WHITE, WHITE]);
});
test("Per-clip canvas background: Moved to an overlay", () => {
  const session = open(put(put(project(), "t-main", clip("a", 0, 4, { background: BLUR })), "t-main", clip("b", 4, 4)));
  session.execute(tl.toOverlay({ sceneId: "s1", elementIds: ["a"] }), ON);
  assert.notEqual(trackIdOf(session.document, "a"), "t-main");
  assert.deepEqual(el(session.document, "a").background, BLUR, "kept in the data");
  assert.deepEqual(tl.backgroundTarget(session.document, { selectedIds: ["a"] }), { kind: "project" }, "the editor is not offered for an overlay clip");
  session.execute(tl.toMain({ sceneId: "s1", elementIds: ["a"] }), ON);
  assert.deepEqual([trackIdOf(session.document, "a"), el(session.document, "a").background, tl.backgroundTarget(session.document, { selectedIds: ["a"] }).kind], ["t-main", BLUR, "element"]);
});
test("Per-clip canvas background: Background inside a compound is ignored", () => {
  const doc = put(put(withTracks(project(), ["t-text", "text"]), "t-main", clip("a", 0, 4, { background: WHITE })), "t-text", text("x", 0, 4));
  const session = open(doc);
  assert.ok(session.execute(tl.createCompound({ sceneId: "s1", elementIds: ["a", "x"] }), ON).ok);
  const compound = main(session.document).elements[0], scene = session.document.scenes[1];
  assert.deepEqual([compound.type, "background" in compound, scene.compoundBackground, el(session.document, "a").background], ["compound", false, "none", WHITE]);
  // "Keep this clip's background" is one undo step on the scene.
  session.execute(tl.setCompoundBackground({ sceneId: scene.id, value: "own" }), ON);
  assert.equal(session.document.scenes[1].compoundBackground, "own");
});

// — Linkage —
const linked = () => put(withTracks(mainOf(["a", 0, 4], ["b", 4, 4], ["c", 8, 4]), ["t-text", "text"]), "t-text", text("title", 9, 2));
test("Linkage: Attached title follows its clip", () => {
  const session = open(linked());
  session.execute(tl.deleteElements({ sceneId: "s1", elementIds: ["a"] }), ON);
  assert.deepEqual([el(session.document, "title").startTime, el(session.document, "c").startTime, session.historyLength], [5 * S, 4 * S, 1]);
});
test("Linkage: Linkage off", () => {
  const session = open(linked());
  session.execute(tl.deleteElements({ sceneId: "s1", elementIds: ["a"] }), { ...ON, linkage: false });
  assert.equal(el(session.document, "title").startTime, 9 * S);
});
test("Linkage: Deleting the clip leaves its attached title in place", () => {
  const session = open(put(withTracks(mainOf(["a", 0, 4], ["b", 4, 4], ["c", 8, 4]), ["t-text", "text"]), "t-text", text("title", 5, 2)));
  session.execute(tl.deleteElements({ sceneId: "s1", elementIds: ["b"] }), ON);
  assert.equal(el(session.document, "title").startTime, 5 * S);
  assert.equal(tl.attachmentsOf(tl.sceneById(session.document, "s1")).get("title"), "c");
  // A shifted element that would overlap on its own track goes to another track.
  const crowded = open(put(withTracks(mainOf(["a", 0, 4], ["b", 4, 4]), ["t-text", "text", { locked: false }]), "t-text", text("early", 1, 3), text("late", 4, 2)));
  crowded.execute(tl.move({ sceneId: "s1", elementIds: ["b"], time: 0, pointerTime: 1 * S }), ON);
  assert.deepEqual([el(crowded.document, "late").startTime, el(crowded.document, "early").startTime], [0, 5 * S]);
});

// — Video and audio linking —
const pair = () => put(put(withTracks(project(), ["t-a", "audio"]), "t-main", clip("v", 0, 10, { linkId: "L1", isSourceAudioEnabled: false })), "t-a", audio("u", 0, 10, { mediaId: "a1", sourceDuration: 60 * S, trimEnd: 50 * S, linkId: "L1" }));
test("Video and audio linking: Linked move", () => {
  const session = open(pair());
  session.execute(tl.move({ sceneId: "s1", elementIds: ["v"], time: 1 * S }), OFF);
  assert.deepEqual([el(session.document, "u").startTime, session.historyLength], [1 * S, 1]);
});
test("Video and audio linking: Single member selection", () => {
  const doc = pair();
  assert.deepEqual(tl.clickElement(doc, tl.EMPTY_SELECTION, "v").selectedElements.sort(), ["u", "v"]);
  assert.deepEqual(tl.clickElement(doc, tl.EMPTY_SELECTION, "u", { single: true }).selectedElements, ["u"]);
});
test("Video and audio linking: Linked split", () => {
  const session = open(pair());
  session.execute(tl.split({ sceneId: "s1", time: 4 * S, elementIds: ["v"] }), OFF);
  const video2 = main(session.document).elements, audio2 = session.document.scenes[0].tracks.audio[0].elements as any[];
  assert.deepEqual([spans(session.document, "t-main"), spans(session.document, "t-a")], [[[0, 4], [4, 10]], [[0, 4], [4, 10]]]);
  assert.equal(video2[0].linkId, audio2[0].linkId);
  assert.equal(video2[1].linkId, audio2[1].linkId);
  assert.ok(video2[1].linkId && video2[1].linkId !== video2[0].linkId);
});
test("Video and audio linking: Unlinked edit", () => {
  const session = open(pair());
  session.execute(tl.unlink({ sceneId: "s1", elementIds: ["v"] }), OFF);
  assert.deepEqual([el(session.document, "v").linkId, el(session.document, "u").linkId], [null, null]);
  session.execute(tl.deleteElements({ sceneId: "s1", elementIds: ["u"] }), OFF);
  assert.deepEqual(spans(session.document, "t-main"), [[0, 10]]);
  // A linked member on a locked track blocks the linked edit as a whole.
  const locked = open(tweak(pair(), (draft) => { draft.scenes[0].tracks.audio[0].locked = true; }));
  assert.equal(locked.execute(tl.move({ sceneId: "s1", elementIds: ["v"], time: 1 * S }), OFF).ok, false);
});
test("Video and audio linking: Link needs the same media and an overlap", () => {
  const free = (audioExtra: Record<string, unknown>, start = 0) => put(put(withTracks(project(), ["t-a", "audio"]), "t-main", clip("v", 0, 4)), "t-a", audio("u", start, 4, { sourceDuration: 60 * S, trimEnd: 56 * S, ...audioExtra }));
  assert.equal(tl.linkAvailability(free({ mediaId: "a3" }), "s1", ["v", "u"]), false, "different media");
  assert.equal(tl.linkAvailability(free({ mediaId: "a1" }, 6), "s1", ["v", "u"]), false, "no overlap");
  const ok = free({ mediaId: "a1" }, 2);
  assert.equal(tl.linkAvailability(ok, "s1", ["v", "u"]), true);
  const session = open(ok);
  session.execute(tl.link({ sceneId: "s1", elementIds: ["v", "u"] }), OFF);
  assert.ok(el(session.document, "v").linkId && el(session.document, "v").linkId === el(session.document, "u").linkId);
  assert.deepEqual([el(session.document, "v").startTime, el(session.document, "u").startTime, session.historyLength], [0, 2 * S, 1]);
});
test("Video and audio linking: Text and its generated speech move together", () => {
  const doc = put(put(withTracks(project(), ["t-text", "text"], ["t-a", "audio"]), "t-text", text("t", 0, 4, { linkId: "L2" })), "t-a", audio("speech", 0, 4, { linkId: "L2" }));
  const session = open(doc);
  session.execute(tl.move({ sceneId: "s1", elementIds: ["t"], time: 2 * S }), OFF);
  assert.deepEqual([el(session.document, "speech").startTime, session.historyLength], [2 * S, 1]);
  session.execute(tl.deleteElements({ sceneId: "s1", elementIds: ["t"] }), OFF);
  assert.equal(el(session.document, "speech"), undefined);
});

// — Click selection —
const abc = () => put(withTracks(project(), ["t-v", "video"]), "t-v", clip("A", 0, 2), clip("B", 3, 2), clip("C", 6, 2));
test("Click selection: Toggle with a modifier", () => {
  const doc = abc();
  let state = tl.clickElement(doc, tl.EMPTY_SELECTION, "A");
  state = tl.clickElement(doc, state, "B", { toggle: true });
  state = tl.clickElement(doc, state, "A", { toggle: true });
  assert.deepEqual(state.selectedElements, ["B"]);
});
test("Click selection: Context click keeps the multi-selection", () => {
  const doc = abc();
  const state = tl.clickElement(doc, tl.selectElements(["A", "B", "C"]), "B", { secondary: true });
  assert.deepEqual(state.selectedElements, ["A", "B", "C"]);
  const menu = tl.elementContextMenu(doc, "s1", state.selectedElements);
  assert.ok(menu.some((item) => "label" in item && item.label === "Delete 3 elements"));
  assert.deepEqual(tl.clickElement(doc, tl.selectElements(["A"]), "C", { secondary: true }).selectedElements, ["C"]);
});
test("Click selection: Scope change", () => {
  const session = open(abc());
  session.select(tl.selectInScope("library", ["a1", "a2"]));
  session.select(tl.clickElement(session.document, session.selection, "A"));
  assert.deepEqual([session.selection.scope, session.selection.selectedItems, session.selection.selectedElements], ["timeline", [], ["A"]]);
  session.execute(tl.deleteElements({ sceneId: "s1", elementIds: session.selection.selectedElements }), OFF);
  assert.deepEqual([spans(session.document, "t-v").length, session.document.media.assets.length], [2, 4]);
  // Selecting elements clears keyframe selections; a plain click on the sole selected element only clears keyframes.
  const keyed = tl.selectKeyframes(tl.selectElements(["B"]), [{ elementId: "B", path: "opacity", keyId: "k1" }]);
  assert.equal(tl.activeSelectionKind(keyed), "keyframes");
  assert.deepEqual([tl.clickElement(session.document, keyed, "B").selectedKeyframes, tl.clickElement(session.document, keyed, "B").selectedElements], [[], ["B"]]);
});

// — Box selection —
const rows = (doc: ReturnType<typeof abc>) => tl.trackRows(doc).map((row) => ({ trackId: row.trackId, top: row.top, height: row.baseHeight }));
test("Box selection: Replace by marquee", () => {
  const doc = abc();
  const state = tl.boxSelect(doc, tl.selectElements(["A"]), { startTime: 2.5 * S, endTime: 9 * S, top: 0, bottom: 40 }, rows(doc));
  assert.deepEqual(state.selectedElements, ["B", "C"]);
});
test("Box selection: Additive marquee", () => {
  const doc = abc();
  const state = tl.boxSelect(doc, tl.selectElements(["A"]), { startTime: 2.5 * S, endTime: 9 * S, top: 0, bottom: 40 }, rows(doc), true);
  assert.deepEqual(state.selectedElements, ["A", "B", "C"]);
});
test("Box selection: Below threshold is a click", () => {
  assert.equal(tl.emptyAreaGesture(4, 300), "click");
  assert.equal(tl.emptyAreaGesture(6, 300), "marquee");
  const result = tl.clickEmptyArea(tl.selectElements(["A"]), "tracks", 5 * S);
  assert.deepEqual([result.selection.selectedElements, result.seekTo], [[], 5 * S]);
});

// — Selection commands —
test("Selection commands: Select all after playhead", () => {
  const doc = put(withTracks(project(), ["t-v", "video"]), "t-v", clip("x", 0, 5), clip("y", 8, 4), clip("z", 15, 5));
  assert.deepEqual(tl.selectAllAfter(doc, 10 * S).selectedElements, ["y", "z"]);
  assert.deepEqual(tl.selectAllBefore(doc, 10 * S).selectedElements, ["x", "y"]);
  assert.deepEqual([tl.selectLeftward(doc, 12 * S).selectedElements, tl.selectRightward(doc, 8 * S).selectedElements], [["x", "y"], ["y", "z"]]);
  assert.deepEqual([tl.selectNeighbour(doc, tl.selectElements(["y"]), "next", 0).selectedElements, tl.selectNeighbour(doc, tl.selectElements(["y"]), "previous", 0).selectedElements], [["z"], ["x"]]);
});
test("Selection commands: Select all with an empty scene", () => {
  assert.deepEqual(tl.selectAll(project()).selectedElements, []);
  assert.deepEqual(tl.deselectAll().selectedElements, []);
});

// — Layered cancel and empty-area click —
test("Layered cancel and empty-area click: Cancel during a drag", () => {
  const session = open(abc());
  session.beginGesture();
  session.preview(tl.move({ sceneId: "s1", elementIds: ["A"], time: 10 * S }), OFF);
  assert.equal(el(session.displayDocument, "A").startTime, 10 * S);
  assert.equal(session.cancel(), "gesture");
  assert.deepEqual([el(session.displayDocument, "A").startTime, trackIdOf(session.document, "A"), session.historyLength], [0, "t-v", 0]);
});
test("Layered cancel and empty-area click: Cancel peels one level", () => {
  const session = open(abc());
  session.select(tl.selectKeyframes(tl.selectElements(["A"]), [{ elementId: "A", path: "opacity", keyId: "k1" }, { elementId: "A", path: "opacity", keyId: "k2" }]));
  session.cancel();
  assert.deepEqual([session.selection.selectedKeyframes.length, session.selection.selectedElements], [0, ["A"]]);
  session.cancel();
  assert.deepEqual(session.selection.selectedElements, []);
  // A click on the header column clears the selection without seeking.
  assert.equal(tl.clickEmptyArea(tl.selectElements(["A"]), "header", 3 * S).seekTo, undefined);
});

// — Cursor modes —
test("Cursor modes: Blade click", () => {
  const session = open(abc());
  session.setCursorMode("blade");
  const click = tl.bladeClick(session.document, { time: 3.51 * S, elementId: "B" });
  assert.equal(click.kind, "split");
  if (click.kind === "split") session.execute(click.command, OFF);
  assert.deepEqual([spans(session.document, "t-v")[1], spans(session.document, "t-v")[2], session.cursorMode, session.historyLength], [[3, 3.5], [3.5, 5], "blade", 1]);
  // With Shift the click splits every clip on unlocked tracks at that time.
  const all = tl.bladeClick(put(session.document, "t-main", clip("m", 0, 9)), { time: 7 * S, elementId: "C", shift: true });
  assert.equal(all.kind === "split" && all.command.type, "timeline.split-all");
  session.close();
  assert.equal(session.cursorMode, "select");
});
test("Cursor modes: Blade outside a clip", () => {
  const doc = abc();
  assert.deepEqual(tl.bladeClick(doc, { time: 2.5 * S }), { kind: "seek", time: 2.5 * S });
});

// — Moving elements —
test("Moving elements: Sub-threshold drag", () => {
  const session = open(abc());
  assert.equal(tl.dragStarted(3), false);
  assert.equal(tl.dragStarted(5), true);
  assert.deepEqual([spans(session.document, "t-v")[0], session.historyLength], [[0, 2], 0]);
});
test("Moving elements: Group move keeps offsets", () => {
  const session = open(put(withTracks(project(), ["t-v", "video"]), "t-v", clip("p", 2, 2), clip("q", 5, 2)));
  session.select(tl.selectElements(["p", "q"]));
  session.execute(tl.move({ sceneId: "s1", elementIds: ["p", "q"], anchorId: "p", time: 4 * S }), OFF);
  assert.deepEqual([spans(session.document, "t-v"), session.selection.selectedElements.sort()], [[[4, 6], [7, 9]], ["p", "q"]]);
});
test("Moving elements: Clamp at zero", () => {
  const session = open(put(withTracks(project(), ["t-v", "video"]), "t-v", clip("p", 1, 1), clip("q", 3, 1)));
  session.execute(tl.move({ sceneId: "s1", elementIds: ["p", "q"], anchorId: "p", time: tl.dragTargetTime(session.document, -50 * S, 0) }), OFF);
  assert.deepEqual(spans(session.document, "t-v"), [[0, 1], [2, 3]]);
});
test("Moving elements: Main track to overlay", () => {
  const session = open(mainOf(["a", 0, 4], ["b", 4, 3], ["c", 7, 5]));
  session.execute(tl.move({ sceneId: "s1", elementIds: ["b"], time: 5 * S, target: { kind: "new-tracks", index: 0 } }), ON);
  assert.deepEqual([overlay(session.document).length, spans(session.document, overlay(session.document)[0].id), spans(session.document, "t-main"), session.historyLength], [1, [[5, 8]], [[0, 4], [4, 9]], 1]);
  // A group mixing audio and non-audio members cannot move to new tracks.
  const mixed = open(put(put(withTracks(project(), ["t-v", "video"], ["t-a", "audio"]), "t-v", clip("v", 0, 2)), "t-a", audio("u", 0, 2)));
  assert.equal(mixed.execute(tl.move({ sceneId: "s1", elementIds: ["v", "u"], time: S, target: { kind: "new-tracks", index: 0 } }), OFF).ok, false);
});
test("Moving elements: To overlay action", () => {
  const session = open(mainOf(["a", 0, 4], ["b", 4, 3], ["c", 7, 5]));
  session.execute(tl.toOverlay({ sceneId: "s1", elementIds: ["b"] }), ON);
  assert.deepEqual([el(session.document, "b").startTime, trackIdOf(session.document, "b") !== "t-main", spans(session.document, "t-main"), session.historyLength], [4 * S, true, [[0, 4], [4, 9]], 1]);
});
void sticker; void RIPPLE;
