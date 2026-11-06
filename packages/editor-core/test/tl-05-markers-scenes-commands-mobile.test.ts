import assert from "node:assert/strict";
import { test } from "node:test";
import { applyPatch, clone, timeline as tl, upsertKeyframe, validateProjectDocument } from "../src/index.ts";
import { audio, context, put, text, tweak, video } from "./support/fixtures.ts";
import { audioTracks, canonical, el, main, OFF, ON, open, overlay, project, S, spans, trackOf, withTracks } from "./support/timeline.ts";

const clip = (id: string, start: number, seconds: number, extra: Record<string, unknown> = {}) => video(id, start, seconds, { sourceDuration: 60 * S, trimEnd: (60 - seconds) * S, ...extra });
const mainOf = (...clips: [string, number, number][]) => clips.reduce((doc, [id, start, seconds]) => put(doc, "t-main", clip(id, start, seconds)), project());
const MOBILE = tl.editContextFor("mobile", tl.DEFAULT_TIMELINE_PREFERENCES);
const markers = (session: { document: any }, scene = 0) => session.document.scenes[scene].markers as { id: string; time: number; note?: string; color: number | string; duration?: number }[];
const volumes = () => tl.createParamRegistry({ audio: [{ key: "volume", type: "number", default: 0, min: -60, max: 20, step: 0.1, unit: "dB" }], visual: tl.CORE_VISUAL_PARAMS });

// — Audio clip rendering and volume line —
test("Audio clip rendering and volume line: Waveform strip on a video clip", () => {
  const doc = put(put(project(), "t-main", clip("c", 0, 4)), "t-main", clip("silent", 4, 4, { isSourceAudioEnabled: false }));
  assert.deepEqual([tl.clipPresentation(doc, el(doc, "c"), 300).waveformStrip, tl.clipPresentation(doc, el(doc, "silent"), 300).waveformStrip, tl.TIMELINE_GEOMETRY.waveformStripHeight, tl.rowHeight({ type: "video" }, "main")], [true, false, 16, 65]);
});
test("Audio clip rendering and volume line: Volume drag is one undo step", () => {
  const session = open(put(withTracks(project(), ["t-a", "audio"]), "t-a", audio("u", 0, 4)));
  session.select(tl.clickElement(session.document, session.selection, "u"));
  session.beginGesture();
  for (const value of [-1, -2.5, -4.04, -6]) session.preview(tl.setParams({ registry: volumes(), writes: [{ elementId: "u", key: "volume", value }], label: "Volume" }), OFF);
  assert.deepEqual([el(session.document, "u").volume, el(session.displayDocument, "u").volume], [0, -6]);
  session.commitPreview();
  assert.deepEqual([session.selection.selectedElements, el(session.document, "u").volume, session.historyLength], [["u"], -6, 1]);
  session.undo();
  assert.equal(el(session.document, "u").volume, 0);
});
test("Audio clip rendering and volume line: Locked track", () => {
  const session = open(put(withTracks(project(), ["t-a", "audio", { locked: true }]), "t-a", audio("u", 0, 4)));
  const result = session.preview(tl.setParams({ registry: volumes(), writes: [{ elementId: "u", key: "volume", value: -6 }] }), OFF);
  session.commitPreview();
  assert.deepEqual([result.ok, el(session.document, "u").volume, session.historyLength], [false, 0, 0]);
});

// — Markers —
test("Markers: Toggle", () => {
  const session = open(mainOf(["c", 0, 10]));
  session.execute(tl.toggleMarker({ sceneId: "s1", time: 3 * S }), OFF);
  assert.deepEqual(markers(session).map((marker) => [marker.time, marker.color]), [[3 * S, 1]]);
  assert.equal(tl.toolStates(session.document, { selectedIds: [], playhead: 3 * S }).marker.pressed, true);
  session.execute(tl.toggleMarker({ sceneId: "s1", time: 3 * S }), OFF);
  assert.deepEqual(markers(session), []);
});
test("Markers: Stable id", () => {
  const session = open(mainOf(["c", 0, 10]));
  session.execute(tl.toggleMarker({ sceneId: "s1", time: 3 * S }), OFF);
  const id = markers(session)[0].id;
  session.execute(tl.moveMarker({ sceneId: "s1", markerId: id, time: 5 * S }), OFF);
  assert.deepEqual(markers(session).map((marker) => [marker.id, marker.time]), [[id, 5 * S]]);
});
test("Markers: Colour cycle", () => {
  const session = open(mainOf(["c", 0, 20]));
  for (let index = 0; index < 9; index++) session.execute(tl.addMarkerNextColor({ sceneId: "s1", time: index * S }), OFF);
  assert.deepEqual(markers(session).map((marker) => marker.color), [1, 2, 3, 4, 5, 6, 7, 8, 1]);
  // The limit of 1 000 markers per scene.
  const full = open(tweak(mainOf(["c", 0, 60]), (draft) => { draft.scenes[0].markers = Array.from({ length: 1000 }, (_, index) => ({ id: `m${index}`, time: index * 4000, color: 1 })); }));
  const refused = full.execute(tl.toggleMarker({ sceneId: "s1", time: 50 * S }), OFF);
  assert.deepEqual([refused.ok, !refused.ok && refused.message], [false, "Marker limit reached (1000)"]);
});
test("Markers: Markers are per scene", () => {
  const session = open(mainOf(["c", 0, 10]));
  session.execute(tl.toggleMarker({ sceneId: "s1", time: 3 * S }), OFF);
  session.execute(tl.createScene(), OFF);
  assert.deepEqual([session.sceneId !== "s1", markers(session, 1), markers(session, 0).length], [true, [], 1]);
});
test("Markers: Collision", () => {
  const session = open(mainOf(["c", 0, 10]));
  session.execute(tl.toggleMarker({ sceneId: "s1", time: 3 * S }), OFF);
  session.execute(tl.toggleMarker({ sceneId: "s1", time: 5 * S }), OFF);
  const steps = session.historyLength, result = session.execute(tl.moveMarker({ sceneId: "s1", markerId: markers(session)[0].id, time: 5 * S + 100 }), OFF);
  assert.deepEqual([result.ok, !result.ok && result.message, markers(session).map((marker) => marker.time), session.historyLength], [false, "A marker already exists at this time", [3 * S, 5 * S], steps]);
});

// — Marker interaction —
test("Marker interaction: Edit a note", () => {
  const session = open(mainOf(["c", 0, 10]));
  session.execute(tl.toggleMarker({ sceneId: "s1", time: 3 * S }), OFF);
  const id = markers(session)[0].id;
  for (const note of ["C", "Cut", "Cut here"]) { session.clock.now += 2000; session.execute(tl.editMarker({ sceneId: "s1", markerId: id, note, editSession: "popover-1" }), OFF); }
  assert.deepEqual([markers(session)[0].note, session.historyLength], ["Cut here", 2]);
  session.undo();
  assert.equal(markers(session)[0].note, undefined);
});
test("Marker interaction: Note length", () => {
  const session = open(mainOf(["c", 0, 10]));
  session.execute(tl.toggleMarker({ sceneId: "s1", time: 3 * S }), OFF);
  session.execute(tl.editMarker({ sceneId: "s1", markerId: markers(session)[0].id, note: "n".repeat(600), color: "#FF8800" }), OFF);
  assert.deepEqual([markers(session)[0].note!.length, markers(session)[0].color], [500, "#ff8800"]);
});
test("Marker interaction: Next marker", () => {
  const session = open(mainOf(["c", 0, 10]));
  for (const time of [2, 8]) session.execute(tl.toggleMarker({ sceneId: "s1", time: time * S }), OFF);
  const next = tl.markerSeek(session.document, "s1", 5 * S, "next");
  assert.deepEqual([next, tl.markerSeek(session.document, "s1", next, "next"), tl.markerSeek(session.document, "s1", 5 * S, "previous"), tl.markerSeek(session.document, "s1", 2 * S, "previous")], [8 * S, 8 * S, 2 * S, 2 * S]);
  assert.equal(tl.deleteAllMarkersNeedsConfirmation(session.document, "s1"), true);
  session.execute(tl.deleteAllMarkers({ sceneId: "s1" }), OFF);
  session.undo();
  assert.equal(markers(session).length, 2);
});
test("Marker interaction: Duration bound", () => {
  const session = open(mainOf(["c", 0, 60]));
  session.execute(tl.toggleMarker({ sceneId: "s1", time: 50 * S }), OFF);
  session.execute(tl.editMarker({ sceneId: "s1", markerId: markers(session)[0].id, durationSeconds: 25 }), OFF);
  assert.equal(markers(session)[0].duration, 10 * S);
  assert.equal(tl.clampMarkerDuration(1.26, 0, 60 * S), 1.3 * S);
});

// — Marker notes overlay —
const noted = () => tweak(mainOf(["c", 0, 10]), (draft) => { draft.scenes[0].markers = [{ id: "m1", time: 4 * S, color: 1, note: "B-roll", duration: 2 * S }, { id: "m2", time: 8 * S, color: 1, note: "Frame" }]; });
test("Marker notes overlay: Note visible inside the range", () => {
  assert.deepEqual([tl.activeMarkerNotes(noted(), "s1", 5 * S), tl.activeMarkerNotes(noted(), "s1", 7 * S), tl.activeMarkerNotes(noted(), "s1", 8 * S), tl.activeMarkerNotes(noted(), "s1", 8 * S + 4000)], [["B-roll"], [], ["Frame"], []]);
});
test("Marker notes overlay: Overlay off", () => {
  assert.deepEqual(tl.activeMarkerNotes(noted(), "s1", 5 * S, false), []);
});

// — Scenes model and switching —
test("Scenes model and switching: Switch scene", () => {
  const session = open(mainOf(["c", 0, 10]));
  session.execute(tl.createScene({ id: "s2" }), OFF);
  session.switchScene("s1");
  session.seek(4 * S);
  session.select(tl.selectElements(["c"]));
  const steps = session.historyLength, patches = session.patches.length;
  session.switchScene("s2");
  assert.deepEqual([session.sceneId, tl.sceneList(session.document).map((row) => [row.name, row.active]), session.selection.selectedElements, session.historyLength, session.patches.length], ["s2", [["Main scene", false], ["Scene 2", true]], [], steps, patches]);
  session.switchScene("s1");
  assert.equal(session.playhead, 4 * S, "the scene's playhead is restored");
});
test("Scenes model and switching: Missing main scene is repaired", () => {
  const broken = tweak(project(), (draft) => { draft.scenes[0].isMain = false; });
  const loaded = validateProjectDocument(broken, { mode: "load" }).document!;
  assert.ok(loaded.scenes.some((scene) => scene.isMain && scene.name === "Main scene"));
});
test("Scenes model and switching: Scenes on a phone", () => {
  const session = open(project());
  session.execute(tl.createScene({ id: "s2" }), MOBILE);
  session.switchScene("s1");
  assert.equal(tl.MOBILE_TIMELINE_ACTIONS["timeline.scenes.open"], "More sheet");
  assert.equal(tl.sceneList(session.document).length, 2);
  session.switchScene(tl.sceneList(session.document)[1].id);
  assert.equal(session.sceneId, "s2");
});

// — Scene create, rename, reorder and duplicate —
test("Scene create, rename, reorder and duplicate: Create a scene", () => {
  const session = open(project());
  session.execute(tl.createScene(), OFF);
  session.switchScene("s1");
  session.execute(tl.createScene(), OFF);
  const third = session.document.scenes[2];
  assert.deepEqual([session.document.scenes.map((scene) => scene.name), session.sceneId, third.tracks.main.elements.length], [["Main scene", "Scene 2", "Scene 3"], third.id, 0]);
  session.undo();
  assert.deepEqual([session.document.scenes.length, session.sceneId], [2, "s1"]);
});
test("Scene create, rename, reorder and duplicate: Duplicate a scene", () => {
  let doc = withTracks(project(), ["t-v", "video"], ["t-text", "text"]);
  doc = put(put(put(doc, "t-main", clip("a", 0, 2), clip("b", 2, 2)), "t-v", clip("c", 0, 2), clip("d", 2, 2)), "t-text", text("e", 0, 2));
  const session = open(tweak(doc, (draft) => { draft.scenes[0].markers = [{ id: "m1", time: 0, color: 1 }]; }));
  session.execute(tl.createScene({ id: "s3" }), OFF);
  session.execute(tl.duplicateScene({ sceneId: "s1" }), OFF);
  const copy = session.document.scenes[1] as any, ids = tl.elementsOfScene(copy).map((element) => element.id);
  assert.deepEqual([session.document.scenes.map((scene) => scene.name), copy.isMain, ids.length, ids.some((id) => ["a", "b", "c", "d", "e"].includes(id)), copy.markers[0].id !== "m1"], [["Main scene", "Main scene (copy)", "Scene 2"], false, 5, false, true]);
  session.execute(tl.deleteElements({ sceneId: copy.id, elementIds: [ids[0]] }), OFF);
  assert.equal(tl.elementsOfScene(session.document.scenes[0] as any).length, 5, "editing the copy does not change the source");
  // Reorder: the main scene can be moved and stays main.
  session.execute(tl.reorderScene({ sceneId: "s1", toIndex: 2 }), OFF);
  assert.deepEqual([session.document.scenes[2].id, session.document.scenes[2].isMain], ["s1", true]);
});
test("Scene create, rename, reorder and duplicate: Rename to empty", () => {
  const session = open(project());
  const result = session.execute(tl.renameScene({ sceneId: "s1", name: "  " }), OFF);
  assert.deepEqual([result.ok && result.changed, session.document.scenes[0].name], [false, "Main scene"]);
});
test("Scene create, rename, reorder and duplicate: Scene limit boundary", () => {
  const many = tweak(project(), (draft) => { for (let index = 2; index <= 199; index++) draft.scenes.push({ ...clone(draft.scenes[0]), id: `sc${index}`, name: `Scene ${index}`, isMain: false, tracks: { overlay: [], audio: [], main: { ...clone(draft.scenes[0].tracks.main), id: `mt${index}` } } }); });
  const session = open(many);
  assert.deepEqual(tl.sceneLimitState(session.document), { enabled: true });
  assert.ok(session.execute(tl.createScene(), OFF).ok);
  assert.deepEqual([session.document.scenes.length, tl.sceneLimitState(session.document)], [200, { enabled: false, reason: "Scene limit reached (200)" }]);
  const refused = session.execute(tl.createScene(), OFF);
  assert.deepEqual([refused.ok, !refused.ok && refused.message, tl.compoundAvailability(put(session.document, "t-main", clip("c", 0, 2)), "s1", ["c"]).reason], [false, "Scene limit reached (200)", "Scene limit reached (200)"]);
});

// — Scene deletion —
test("Scene deletion: Delete the active scene", () => {
  const session = open(project());
  session.execute(tl.createScene({ id: "s2" }), OFF);
  session.execute(tl.createScene({ id: "s3" }), OFF);
  session.switchScene("s2");
  assert.equal(tl.sceneDeletionState(session.document, ["s2"]).confirmation, "Delete 1 scenes?");
  session.execute(tl.deleteScenes({ sceneIds: ["s2"] }), OFF);
  assert.deepEqual([session.sceneId, session.document.scenes.map((scene) => scene.id)], ["s1", ["s1", "s3"]]);
  session.undo();
  assert.deepEqual(session.document.scenes.map((scene) => scene.id), ["s1", "s2", "s3"]);
});
test("Scene deletion: Main scene protected", () => {
  const session = open(project());
  session.execute(tl.createScene({ id: "s2" }), OFF);
  assert.equal(tl.sceneDeletionState(session.document, ["s1", "s2"]).enabled, false);
  assert.equal(session.execute(tl.deleteScenes({ sceneIds: ["s1", "s2"] }), OFF).ok, false);
});
test("Scene deletion: Referenced scene", () => {
  const session = open(mainOf(["c", 0, 4]));
  session.execute(tl.createCompound({ sceneId: "s1", elementIds: ["c"] }), OFF);
  const inner = session.document.scenes[1].id, state = tl.sceneDeletionState(session.document, [inner]);
  assert.deepEqual([state.enabled, state.confirmation, state.usedBy], [false, undefined, [{ sceneId: inner, name: "Compound 1", usedBy: ["Main scene"] }]]);
  const result = session.execute(tl.deleteScenes({ sceneIds: [inner] }), OFF);
  assert.deepEqual([result.ok, !result.ok && result.message.includes("\"Main scene\""), session.document.scenes.length], [false, true, 2]);
});

// — Command system —
test("Command system: Batch undo order", () => {
  const session = open(mainOf(["c", 0, 4])), before = JSON.stringify(session.document.scenes);
  const command = tl.batch("Add text", [tl.addTrack({ sceneId: "s1", type: "text", id: "t-new" }), tl.addToTimeline({ sceneId: "s1", items: [{ kind: "text" }], time: 0, request: { strategy: "explicit", trackId: "t-new" } })]);
  session.execute(command, ON);
  assert.deepEqual([trackOf(session.document, "t-new").elements.length, session.historyLength], [1, 1]);
  const undoPatch = (session.undo(), session.patches[session.patches.length - 1].patch);
  assert.equal(JSON.stringify(session.document.scenes), before);
  const removals = undoPatch.filter((entry) => entry.op === "remove").map((entry) => entry.path);
  assert.ok(removals.some((path) => path.endsWith("/overlay/@t-new")), "the track, with the element inside it, is taken out");
});
test("Command system: Failed command leaves no trace", () => {
  const session = open(put(withTracks(mainOf(["c", 0, 4]), ["t-text", "text"]), "t-text", text("x", 0, 2))), before = session.document;
  const result = session.execute(tl.move({ sceneId: "s1", elementIds: ["c"], time: 0, target: { kind: "track", trackId: "t-text" } }), OFF);
  assert.deepEqual([result.ok, !result.ok && result.code, session.document === before, session.historyLength, session.patches.length], [false, "document/element-track-mismatch", true, 0, 0]);
});
test("Command system: Same action from two triggers", () => {
  const toolbar = open(mainOf(["c", 0, 4])), shortcut = open(mainOf(["c", 0, 4]));
  toolbar.execute(tl.split({ sceneId: "s1", time: 2 * S }), ON);
  shortcut.execute(tl.split({ sceneId: "s1", time: 2 * S }), ON);
  assert.equal(canonical(toolbar.document), canonical(shortcut.document));
});
test("Command system: One patch per step", () => {
  const base = mainOf(["c", 0, 4]), session = open(base), start = session.document;
  session.execute(tl.split({ sceneId: "s1", time: 2 * S }), ON);
  session.undo();
  assert.deepEqual(session.patches.map((entry) => entry.kind), ["execute", "undo"]);
  const replayed = session.patches.reduce((doc, entry) => applyPatch(doc, entry.patch), start);
  assert.deepEqual(main(replayed).elements, main(start).elements);
});
test("Command system: Read-only project", () => {
  const session = open(mainOf(["c", 0, 4]), { readOnly: "This project is being edited on another device" }), before = session.document;
  const result = session.execute(tl.split({ sceneId: "s1", time: 2 * S }), ON);
  assert.deepEqual([result.ok, !result.ok && result.message, session.document === before, session.historyLength], [false, "This project is being edited on another device", true, 0]);
});
const hostCase = () => put(withTracks(mainOf(["a", 0, 4], ["b", 4, 4], ["c", 8, 4]), ["t-text", "text"]), "t-text", text("title", 5, 2));
test("Command system: Agent tool on the host uses the default context", () => {
  // The phone has Linkage off and the desktop has the magnet off; the host knows neither.
  assert.deepEqual(tl.hostEditContext(), { magnet: true, ripple: false, linkage: true, freeLayer: false });
  const host = open(hostCase());
  host.execute(tl.deleteElements({ sceneId: "s1", elementIds: ["a"] }), tl.hostEditContext());
  assert.deepEqual([spans(host.document, "t-main"), el(host.document, "title").startTime], [[[0, 4], [4, 8]], 1 * S]);
});
test("Command system: Same command, same context, same result on every platform", () => {
  const results = ["web", "desktop", "mobile"].map(() => { const session = open(hostCase()); session.execute(tl.deleteElements({ sceneId: "s1", elementIds: ["a"] }), ON); return canonical(session.document); });
  assert.ok(results[0] === results[1] && results[1] === results[2]);
  assert.deepEqual(tl.editContextFor("mobile", { magnet: false, ripple: true, linkage: false, freeLayer: false }), { magnet: true, ripple: false, linkage: false, freeLayer: false });
  assert.deepEqual(tl.editContextFor("desktop", { magnet: true, ripple: true, linkage: true, freeLayer: true }), { magnet: false, ripple: true, linkage: true, freeLayer: true });
});
test("Command system: Tool call overrides the context", () => {
  const host = open(hostCase());
  host.execute(tl.deleteElements({ sceneId: "s1", elementIds: ["a"] }), tl.hostEditContext({ magnet: false }));
  assert.deepEqual([spans(host.document, "t-main"), el(host.document, "title").startTime], [[[4, 8], [8, 12]], 5 * S]);
});

// — Undo and redo —
test("Undo and redo: Undo restores selection", () => {
  const session = open(mainOf(["c", 0, 4]));
  session.select(tl.selectElements(["c"]));
  session.execute(tl.split({ sceneId: "s1", time: 2 * S, elementIds: ["c"] }), ON);
  assert.notDeepEqual(session.selection.selectedElements, ["c"]);
  session.undo();
  assert.deepEqual([spans(session.document, "t-main"), session.selection.selectedElements], [[[0, 4]], ["c"]]);
  session.redo();
  assert.equal(el(session.document, session.selection.selectedElements[0]).startTime, 2 * S);
});
test("Undo and redo: Redo cleared by a new command", () => {
  const session = open(put(withTracks(project(), ["t-v", "video"]), "t-v", clip("a", 0, 2), clip("b", 4, 2)));
  session.execute(tl.deleteElements({ sceneId: "s1", elementIds: ["a"] }), OFF);
  session.undo();
  assert.equal(session.canRedo, true);
  session.execute(tl.move({ sceneId: "s1", elementIds: ["b"], time: 8 * S }), OFF);
  assert.equal(session.canRedo, false);
});
test("Undo and redo: History limit", () => {
  const session = open(mainOf(["c", 0, 60]));
  for (let index = 0; index < 201; index++) { session.clock.now += 1500; session.execute(tl.toggleMarker({ sceneId: "s1", time: index * 4000 }), OFF); }
  let undone = 0;
  while (session.undo()) undone++;
  assert.deepEqual([undone, markers(session).map((marker) => marker.time)], [200, [0]]);
});
test("Undo and redo: Held nudge is one step", () => {
  const session = open(put(withTracks(project(), ["t-v", "video"]), "t-v", clip("a", 0, 2)));
  session.select(tl.selectElements(["a"]));
  for (let press = 0; press < 30; press++) { session.clock.now += 50; session.execute(tl.nudge(session.document, { sceneId: "s1", elementIds: ["a"], frames: 1 }), OFF); }
  assert.deepEqual([el(session.document, "a").startTime, session.historyLength], [30 * 4000, 1]);
  session.undo();
  assert.equal(el(session.document, "a").startTime, 0);
});
test("Undo and redo: Coalescing window expires", () => {
  const session = open(put(withTracks(project(), ["t-v", "video"]), "t-v", clip("a", 0, 2)));
  session.execute(tl.nudge(session.document, { sceneId: "s1", elementIds: ["a"], frames: 1 }), OFF);
  session.clock.now += 1500;
  session.execute(tl.nudge(session.document, { sceneId: "s1", elementIds: ["a"], frames: 1 }), OFF);
  assert.equal(session.historyLength, 2);
  // A selection change also starts a new entry.
  session.clock.now += 50;
  session.select(tl.selectElements(["a"]));
  session.execute(tl.nudge(session.document, { sceneId: "s1", elementIds: ["a"], frames: 1 }), OFF);
  assert.equal(session.historyLength, 3);
});
test("Undo and redo: Asynchronous result", () => {
  const session = open(put(withTracks(mainOf(["c", 0, 4]), ["t-text", "text"]), "t-text", text("x", 0, 2)));
  session.execute(tl.renameElement({ sceneId: "s1", elementId: "c", name: "Cutout on" }), OFF);
  session.execute(tl.renameTrack({ trackId: "t-text", name: "Titles" }), OFF);
  session.undo();
  const steps = session.historyLength;
  // The job's result arrives 20 s later: a derived-asset reference, written as a non-history update.
  session.clock.now += 20_000;
  const result = session.update({ type: "cutout.matte", label: "Matte", run(draft) { tl.located(draft, "c").element.name = "Cutout ready"; } }, OFF);
  assert.deepEqual([result.ok, el(session.document, "c").name, session.historyLength, session.canRedo], [true, "Cutout ready", steps, true]);
  // A result for an element that no longer exists is discarded.
  assert.equal(session.update({ type: "cutout.matte", label: "Matte", run(draft) { tl.located(draft, "gone"); } }, OFF).ok, false);
});
test("Undo and redo: Agent change in local history", () => {
  const session = open(mainOf(["a", 0, 4], ["b", 4, 4]));
  const host = open(session.document);
  host.execute(tl.deleteElements({ sceneId: "s1", elementIds: ["a"] }), tl.hostEditContext());
  assert.ok(session.applyHostChange(host.patches[0].patch, "Tighten intro").ok);
  assert.deepEqual([spans(session.document, "t-main"), tl.toolStates(session.document, { selectedIds: [], playhead: 0, canUndo: session.canUndo, undoLabel: session.undoLabel }).undo.tooltip], [[[0, 4]], "Undo Agent: Tighten intro"]);
  session.undo();
  assert.deepEqual(spans(session.document, "t-main"), [[0, 4], [4, 8]]);
});
test("Undo and redo: History does not leak between projects", () => {
  const a = open(mainOf(["c", 0, 4]));
  a.execute(tl.split({ sceneId: "s1", time: 2 * S }), ON);
  a.close();
  assert.equal(a.canUndo, false);
  assert.equal(open(project()).canUndo, false);
  // Undo and redo are unavailable while a gesture is in flight.
  const busy = open(mainOf(["c", 0, 4]));
  busy.execute(tl.split({ sceneId: "s1", time: 2 * S }), ON);
  busy.beginGesture();
  assert.deepEqual([busy.canUndo, busy.undo()], [false, null]);
});

// — Non-undoable state —
test("Non-undoable state: Toggling snapping", () => {
  const session = open(mainOf(["c", 0, 4]));
  session.execute(tl.split({ sceneId: "s1", time: 2 * S }), ON);
  let prefs = { ...tl.DEFAULT_TIMELINE_PREFERENCES, snapping: false };
  session.setCursorMode("blade"); session.seek(S); session.setView({ zoomLevel: 2 }); session.select(tl.selectAll(session.document));
  assert.equal(session.historyLength, 1);
  session.undo();
  assert.deepEqual([prefs.snapping, spans(session.document, "t-main"), session.cursorMode], [false, [[0, 4]], "blade"]);
  prefs = session.setMagnet({ ...prefs, magnet: false }, true).prefs;
  assert.equal(session.historyLength, 0, "the setting change itself is never a step");
});

// — Preview and commit —
test("Preview and commit: One step per gesture", () => {
  const session = open(put(withTracks(project(), ["t-v", "video"]), "t-v", clip("a", 0, 10)));
  session.beginGesture();
  for (let step = 1; step <= 40; step++) session.preview(tl.trim({ sceneId: "s1", elementId: "a", side: "end", delta: -step * 4000 }), OFF);
  assert.deepEqual([el(session.document, "a").duration, el(session.displayDocument, "a").duration, [...session.previewElements().keys()], session.historyLength, session.patches.length], [10 * S, 10 * S - 160000, ["a"], 0, 0]);
  session.commitPreview();
  assert.deepEqual([el(session.document, "a").duration, session.historyLength, session.gestureActive], [10 * S - 160000, 1, false]);
});
test("Preview and commit: Discard on cancel", () => {
  const session = open(put(withTracks(project(), ["t-v", "video"]), "t-v", clip("a", 0, 10)));
  session.preview(tl.trim({ sceneId: "s1", elementId: "a", side: "end", delta: -2 * S }), OFF);
  session.discardPreview();
  assert.deepEqual([el(session.displayDocument, "a").duration, session.historyLength], [10 * S, 0]);
  // Any direct update clears the layer.
  session.preview(tl.trim({ sceneId: "s1", elementId: "a", side: "end", delta: -2 * S }), OFF);
  session.execute(tl.renameElement({ sceneId: "s1", elementId: "a", name: "Take" }), OFF);
  assert.deepEqual([session.previewElements().size, el(session.document, "a").duration], [0, 10 * S]);
});
test("Preview and commit: Unchanged gesture", () => {
  const session = open(put(withTracks(project(), ["t-v", "video"]), "t-v", clip("a", 0, 10)));
  session.preview(tl.trim({ sceneId: "s1", elementId: "a", side: "end", delta: -2 * S }), OFF);
  session.preview(tl.trim({ sceneId: "s1", elementId: "a", side: "end", delta: 0 }), OFF);
  const result = session.commitPreview();
  assert.deepEqual([result.ok && result.changed, session.historyLength], [false, 0]);
});

// — Multi-element editing —
test("Multi-element editing: Mute a mixed selection", () => {
  const doc = put(put(withTracks(project(), ["t-text", "text"], ["t-a", "audio"]), "t-text", text("x", 0, 2)), "t-a", audio("u1", 0, 2), audio("u2", 2, 2));
  const session = open(doc), before = clone(el(doc, "x"));
  const result = session.execute(tl.toggleElementFlag({ sceneId: "s1", elementIds: ["x", "u1", "u2"], flag: "muted" }), OFF);
  assert.deepEqual([el(session.document, "u1").muted, el(session.document, "u2").muted, el(session.document, "x"), session.historyLength, result.ok && result.info?.applied], [true, true, before, 1, ["u1", "u2"]]);
  assert.deepEqual(tl.applicableIds(session.document, "s1", ["x"], (element) => element.type === "audio"), [], "it applies to none: the control is disabled");
});
test("Multi-element editing: Mixed value", () => {
  const session = open(put(mainOf(["a", 0, 2]), "t-main", clip("b", 2, 2, { opacity: 0.5 })));
  const registry = tl.createParamRegistry({ visual: tl.CORE_VISUAL_PARAMS }), opacity = registry.get("visual", "opacity")!;
  assert.deepEqual(tl.sharedValue(session.document, ["a", "b"], "opacity"), { mixed: true, elementIds: ["a", "b"] });
  session.execute(tl.setParams({ registry, writes: ["a", "b"].map((elementId) => ({ elementId, key: "opacity", value: tl.displayToStored(opacity, 80) })) }), OFF);
  assert.deepEqual([tl.sharedValue(session.document, ["a", "b"], "opacity"), session.historyLength], [{ mixed: false, value: 0.8, elementIds: ["a", "b"] }, 1]);
});

// — Automatic scene-cut detection —
const histogram = (bin: number) => { const data = new Float64Array(64); data[bin] = 1; return data; };
/** A source whose shots change at the given source times (ticks), 30 frames per second. */
const footage = (cuts: number[]) => {
  const shot = (time: number) => histogram(cuts.filter((cut) => time >= cut).length * 7);
  return {
    histogramAt: async (time: number) => shot(time),
    framesBetween: async (from: number, to: number) => Array.from({ length: Math.round((to - from) / 4000) + 1 }, (_, index) => ({ time: from + index * 4000, histogram: shot(from + index * 4000) })),
  };
};
test("Automatic scene-cut detection: Two shots", async () => {
  const session = open(mainOf(["c", 0, 20]));
  const cuts = await tl.analyseSceneCuts(footage([8 * S + 4000]), { sourceStart: 0, sourceEnd: 20 * S });
  assert.deepEqual(cuts, [8 * S + 4000]);
  session.execute(tl.splitAtSourceTimes({ sceneId: "s1", elementId: "c", sourceTimes: cuts! }), OFF);
  assert.deepEqual([spans(session.document, "t-main").map(([from, to]) => [from * S, to * S]), session.historyLength], [[[0, 8 * S + 4000], [8 * S + 4000, 20 * S]], 1]);
  session.undo();
  assert.deepEqual(spans(session.document, "t-main"), [[0, 20]]);
  // No cut: the message, and no undo step.
  const none = session.execute(tl.splitAtSourceTimes({ sceneId: "s1", elementId: "c", sourceTimes: (await tl.analyseSceneCuts(footage([]), { sourceStart: 0, sourceEnd: 20 * S }))! }), OFF);
  assert.deepEqual([none.ok, !none.ok && none.message, session.historyLength], [false, "No scene changes detected", 0]);
});
test("Automatic scene-cut detection: Sensitivity bounds", () => {
  assert.deepEqual([tl.sceneCutThreshold(1), tl.sceneCutThreshold(100), tl.sceneCutThreshold()], [0.794, 0.2, 0.5]);
  const luma = new Uint8Array(64 * 36).fill(200), dark = new Uint8Array(64 * 36).fill(10);
  assert.deepEqual([tl.histogramDifference(tl.lumaHistogram(luma), tl.lumaHistogram(dark)), tl.histogramDifference(tl.lumaHistogram(luma), tl.lumaHistogram(luma)), tl.lumaHistogram(luma).reduce((sum, value) => sum + value, 0)], [1, 0, 1]);
  assert.equal(tl.sceneCutSampleTimes(0, 2 * S, 30).length, 20, "at most 10 samples per second");
});
test("Automatic scene-cut detection: Near cuts", async () => {
  assert.deepEqual(await tl.analyseSceneCuts(footage([5 * S, 5.3 * S, 9 * S]), { sourceStart: 0, sourceEnd: 20 * S }), [5 * S, 9 * S]);
});
test("Automatic scene-cut detection: Cancel", async () => {
  const session = open(mainOf(["c", 0, 20])), before = session.document;
  let calls = 0; const progress: number[] = [];
  const cuts = await tl.analyseSceneCuts(footage([8 * S]), { sourceStart: 0, sourceEnd: 20 * S }, { isCancelled: () => ++calls > 50, onProgress: (value) => progress.push(value) });
  assert.deepEqual([cuts, session.document === before, session.historyLength, progress.length > 0 && progress.every((value) => value < 1)], [null, true, 0, true]);
});

// — Transcript-driven cuts —
test("Transcript-driven cuts: Delete a sentence", () => {
  const session = open(put(withTracks(project(), ["t-v", "video"]), "t-v", clip("c", 0, 10), clip("after", 12, 2)));
  const result = session.execute(tl.removeSourceRanges({ sceneId: "s1", elementId: "c", ranges: [{ sourceStart: 4 * S, sourceEnd: 6.5 * S }] }), OFF);
  assert.deepEqual([spans(session.document, "t-v"), result.ok && result.info], [[[0, 4], [4, 7.5], [9.5, 11.5]], { removedCount: 1, removedDuration: 2.5 * S }]);
  assert.deepEqual(trackOf(session.document, "t-v").elements.slice(0, 2).map((element: any) => [element.trimStart / S, element.trimEnd / S]), [[0, 56], [6.5, 50]]);
  session.undo();
  assert.deepEqual(spans(session.document, "t-v"), [[0, 10], [12, 14]]);
});
test("Transcript-driven cuts: Several ranges in one step", () => {
  const session = open(mainOf(["c", 0, 10]));
  const result = session.execute(tl.removeSourceRanges({ sceneId: "s1", elementId: "c", ranges: [{ sourceStart: 7 * S, sourceEnd: 8.2 * S }, { sourceStart: 1 * S, sourceEnd: 2 * S }, { sourceStart: 4 * S, sourceEnd: 4.5 * S }, { sourceStart: 4.4 * S, sourceEnd: 5 * S }, { sourceStart: 30 * S, sourceEnd: 40 * S }] }), ON);
  assert.deepEqual([spans(session.document, "t-main"), result.ok && result.info, session.historyLength], [[[0, 1], [1, 3], [3, 5], [5, 6.8]], { removedCount: 3, removedDuration: 3.2 * S }, 1]);
  session.undo();
  assert.deepEqual(spans(session.document, "t-main"), [[0, 10]]);
});
test("Transcript-driven cuts: Linked audio follows", () => {
  const doc = put(put(withTracks(project(), ["t-a", "audio"]), "t-main", clip("v", 0, 10, { linkId: "L1", isSourceAudioEnabled: false })), "t-a", audio("u", 0, 10, { mediaId: "a1", sourceDuration: 60 * S, trimEnd: 50 * S, linkId: "L1" }));
  const session = open(doc);
  session.execute(tl.removeSourceRanges({ sceneId: "s1", elementId: "v", ranges: [{ sourceStart: 4 * S, sourceEnd: 6 * S }] }), ON);
  const v = main(session.document).elements, u = audioTracks(session.document)[0].elements;
  assert.deepEqual([spans(session.document, "t-main"), spans(session.document, "t-a"), v[0].linkId === u[0].linkId, v[1].linkId === u[1].linkId && v[1].linkId !== v[0].linkId, session.historyLength], [[[0, 4], [4, 8]], [[0, 4], [4, 8]], true, true, 1]);
});
test("Transcript-driven cuts: Whole element", () => {
  const session = open(mainOf(["c", 0, 10])), before = session.document;
  const result = session.execute(tl.removeSourceRanges({ sceneId: "s1", elementId: "c", ranges: [{ sourceStart: 0, sourceEnd: 10 * S }] }), ON);
  assert.deepEqual([result.ok, session.document === before], [false, true]);
});

// — Keyframe display in the timeline —
const keyedClip = () => { const ctx = context(); let doc = put(project(), "t-main", clip("c", 0, 4)); for (const path of ["transform.position.x", "opacity", "transform.rotation"]) doc = upsertKeyframe(doc, ctx, "c", path, { time: S, value: 0.5 }).document; return upsertKeyframe(doc, ctx, "c", "opacity", { time: 3 * S, value: 1 }).document; };
test("Keyframe display in the timeline: Merged diamond", () => {
  assert.deepEqual(tl.inlineKeyframeTimes(el(keyedClip(), "c"), 200), [S, 3 * S]);
});
test("Keyframe display in the timeline: Narrow clip", () => {
  const doc = keyedClip();
  assert.deepEqual([tl.inlineKeyframeTimes(el(doc, "c"), 30), tl.clipPresentation(doc, el(doc, "c"), 30, { selected: true }).inlineDiamonds, tl.clipPresentation(doc, el(doc, "c"), 40, { selected: true }).inlineDiamonds], [[], false, true]);
});
test("Keyframe display in the timeline: Row grows with lanes", () => {
  const doc = keyedClip();
  assert.deepEqual([tl.trackRows(doc)[0].height, tl.trackRows(doc, { expandedElementIds: ["c"] })[0].height, tl.trackRows(doc, { expandedElementIds: ["c"] })[0].baseHeight], [65, 125, 65]);
});

// — Mobile timeline gestures —
test("Mobile timeline gestures: Reorder on mobile", () => {
  const session = open(mainOf(["a", 0, 4], ["b", 4, 3]));
  assert.deepEqual(tl.mobileGestureIntent(session.document, { kind: "long-press", elementId: "a" }), { intent: "reorder-main", command: "move" });
  session.execute(tl.move({ sceneId: "s1", elementIds: ["a"], time: 5 * S, pointerTime: 6.5 * S }), MOBILE);
  assert.deepEqual([main(session.document).elements.map((element: { id: string }) => element.id), spans(session.document, "t-main"), session.historyLength], [["b", "a"], [[0, 3], [3, 7]], 1]);
});
test("Mobile timeline gestures: Pinch zoom keeps the playhead time", () => {
  const min = tl.zoomMin(60 * S, 390), before = { zoomLevel: 1, scrollLeft: tl.mobileTimeToScroll(12 * S, 1) };
  const after = tl.zoomScroll(before, 2.4, { kind: "playhead", playheadTime: 12 * S }, min, { mobile: true });
  assert.deepEqual([after.zoomLevel, tl.mobileScrollToTime(after.scrollLeft, after.zoomLevel, 60 * S, { numerator: 30, denominator: 1 })], [2.4, 12 * S]);
  assert.equal(tl.mobileGestureIntent(project(), { kind: "pinch" }).intent, "zoom-at-playhead");
});
test("Mobile timeline gestures: Trim preview", () => {
  const session = open(mainOf(["a", 0, 10]));
  session.seek(2 * S);
  assert.deepEqual(tl.mobileGestureIntent(session.document, { kind: "trim-handle", elementId: "a", side: "end" }), { intent: "trim", command: "trim", previewFrame: "trimmed-edge" });
  session.preview(tl.trim({ sceneId: "s1", elementId: "a", side: "end", delta: -3 * S }), MOBILE);
  const shown = el(session.displayDocument, "a");
  // While dragging the player shows the clip's new last frame; on release the playhead frame again.
  assert.deepEqual([shown.startTime + shown.duration - 4000, session.playhead], [7 * S - 4000, 2 * S]);
  session.commitPreview();
  assert.equal(session.playhead, 2 * S);
});
test("Mobile timeline gestures: Same result as desktop", () => {
  const phone = open(put(withTracks(project(), ["t-v", "video"]), "t-v", clip("a", 0, 10))), desktop = open(put(withTracks(project(), ["t-v", "video"]), "t-v", clip("a", 0, 10)));
  phone.preview(tl.trim({ sceneId: "s1", elementId: "a", side: "end", delta: -3 * S }), MOBILE); phone.commitPreview();
  desktop.preview(tl.trim({ sceneId: "s1", elementId: "a", side: "end", delta: -3 * S }), tl.editContextFor("desktop", { ...tl.DEFAULT_TIMELINE_PREFERENCES })); desktop.commitPreview();
  assert.deepEqual([canonical(phone.document) === canonical(desktop.document), phone.historyLength, desktop.historyLength], [true, 1, 1]);
  assert.deepEqual([tl.mobileGestureIntent(phone.document, { kind: "tap", target: "empty" }).intent, tl.mobileGestureIntent(phone.document, { kind: "drag", axis: "horizontal" }).intent, tl.mobileGestureIntent(phone.document, { kind: "long-press", elementId: "a" }).intent], ["deselect", "scroll-seek", "move"]);
});

// — Timeline actions for mobile toolbars —
test("Timeline actions for mobile toolbars: Add a marker on a phone", () => {
  const session = open(mainOf(["c", 0, 10]));
  assert.equal(tl.MOBILE_TIMELINE_ACTIONS["marker.toggle"], "Markers on mobile");
  session.execute(tl.toggleMarker({ sceneId: "s1", time: 3 * S }), MOBILE);
  assert.equal(markers(session)[0].time, 3 * S);
  session.undo();
  assert.equal(markers(session).length, 0);
});
test("Timeline actions for mobile toolbars: Paste on a phone", () => {
  const session = open(put(withTracks(project(), ["t-text", "text"]), "t-text", text("x", 0, 2))), clipboard = tl.createClipboard();
  clipboard.set(tl.copyElements(session.document, "s1", ["x"]));
  assert.equal(clipboard.isEmpty, false, "Paste is shown first in the root toolbar");
  session.execute(tl.paste({ sceneId: "s1", entry: clipboard.entry, time: 10 * S }), MOBILE);
  const pasted = session.selection.selectedElements;
  assert.deepEqual([pasted.length, el(session.document, pasted[0]).startTime], [1, 10 * S]);
  session.undo();
  assert.equal(el(session.document, pasted[0]), undefined);
});
test("Timeline actions for mobile toolbars: Create a compound clip on a phone", () => {
  const session = open(mainOf(["a", 0, 4], ["b", 4, 3]));
  session.execute(tl.createCompound({ sceneId: "s1", elementIds: ["a", "b"] }), MOBILE);
  const compound = main(session.document).elements;
  assert.deepEqual([compound.length, compound[0].type], [1, "compound"]);
  const menu = tl.elementContextMenu(session.document, "s1", session.selection.selectedElements).flatMap((item) => ("id" in item ? [item.id] : []));
  assert.ok(menu.includes("compound-dissolve"));
  for (const action of ["timeline.compound.edit", "timeline.compound.dissolve"]) assert.equal(tl.MOBILE_TIMELINE_ACTIONS[action], "Compound clip tool strip");
});
test("Timeline actions for mobile toolbars: Linkage switch is the same preference", () => {
  const prefs = { ...tl.DEFAULT_TIMELINE_PREFERENCES, linkage: false };
  const session = open(put(withTracks(mainOf(["a", 0, 4], ["b", 4, 4]), ["t-text", "text"]), "t-text", text("title", 5, 2)));
  session.execute(tl.deleteElements({ sceneId: "s1", elementIds: ["a"] }), tl.editContextFor("mobile", prefs));
  assert.deepEqual([el(session.document, "title").startTime, spans(session.document, "t-main"), prefs.linkage], [5 * S, [[0, 4]], false]);
});
test("Timeline actions for mobile toolbars: Every registered timeline action is accounted for", () => {
  const owned = tl.TIMELINE_ACTIONS.filter((id) => id.startsWith("timeline.") || id.startsWith("marker.") || id.startsWith("range.") || id.startsWith("tools."));
  assert.ok(owned.length > 60);
  for (const id of owned) assert.ok(tl.mobileAvailability(id), `${id} has neither a mobile entry nor a declared-unavailable row`);
  assert.equal(tl.mobileAvailability("timeline.not-registered"), undefined);
  assert.deepEqual(tl.mobileAvailability("timeline.ripple.toggle"), { unavailable: true });
  for (let angle = 1; angle <= 8; angle++) assert.deepEqual(tl.mobileAvailability(`timeline.multicam.switch-angle-${angle}`), { entry: "Compound clip tool strip" });
});
test("Timeline actions for mobile toolbars: Track controls on a phone", () => {
  const doc = put(put(put(withTracks(project(), ["t-text", "text"], ["t-a", "audio"]), "t-text", text("x", 0, 2)), "t-main", clip("m", 0, 2)), "t-a", audio("u", 0, 2));
  const rows = tl.mobileTrackRows(doc);
  assert.deepEqual([rows.map((row) => row.trackId), rows[2].controls], [["t-text", "t-main", "t-a"], ["rename", "lock", "mute", "solo", "volume", "pan", "reorder"]]);
  const session = open(doc);
  session.execute(tl.toggleTrackFlag({ trackId: "t-text", flag: "locked" }), MOBILE);
  assert.equal(session.execute(tl.move({ sceneId: "s1", elementIds: ["x"], time: 4 * S }), MOBILE).ok, false);
  assert.equal(session.execute(tl.trim({ sceneId: "s1", elementId: "x", side: "end", delta: -S }), MOBILE).ok, false);
});

// — Timeline accessibility and keyboard operation —
const nudgeable = () => open(put(withTracks(project(), ["t-v", "video"]), "t-v", clip("a", 1, 2), clip("b", 3, 2)));
test("Timeline accessibility and keyboard operation: Nudge", () => {
  const session = open(put(withTracks(project(), ["t-v", "video"]), "t-v", clip("a", 1, 2)));
  assert.equal(el(session.document, "a").startTime, 30 * 4000);
  session.execute(tl.nudge(session.document, { sceneId: "s1", elementIds: ["a"], frames: 1 }), OFF);
  assert.deepEqual([el(session.document, "a").startTime, session.historyLength], [31 * 4000, 1]);
  session.execute(tl.nudge(session.document, { sceneId: "s1", elementIds: ["a"], frames: -10 }), OFF);
  assert.equal(el(session.document, "a").startTime, 21 * 4000);
});
test("Timeline accessibility and keyboard operation: Nudge blocked by a neighbour", () => {
  const session = nudgeable();
  const result = session.execute(tl.nudge(session.document, { sceneId: "s1", elementIds: ["a"], frames: 1 }), OFF);
  assert.deepEqual([result.ok, el(session.document, "a").startTime, session.historyLength], [false, 1 * S, 0]);
});
test("Timeline accessibility and keyboard operation: Trim end to playhead", () => {
  const session = open(put(withTracks(project(), ["t-v", "video"]), "t-v", clip("a", 0, 10)));
  session.execute(tl.trimToPlayhead({ sceneId: "s1", elementIds: ["a"], side: "end", playhead: 6 * S }), OFF);
  assert.deepEqual([el(session.document, "a").duration, session.historyLength], [6 * S, 1]);
  session.execute(tl.trimToPlayhead({ sceneId: "s1", elementIds: ["a"], side: "start", playhead: 2 * S }), OFF);
  assert.deepEqual([el(session.document, "a").startTime, el(session.document, "a").duration], [2 * S, 4 * S]);
  // Moving the selection to the track above or below obeys the same overlap and lock rules.
  const rows = open(put(put(withTracks(project(), ["t-1", "video"], ["t-2", "video"]), "t-1", clip("x", 0, 2)), "t-2", clip("y", 4, 2)));
  rows.execute(tl.moveToAdjacentTrack(rows.document, { sceneId: "s1", elementIds: ["y"], direction: "up" }), OFF);
  assert.deepEqual(spans(rows.document, "t-1"), [[0, 2], [4, 6]]);
});
test("Timeline accessibility and keyboard operation: Screen-reader description", () => {
  const doc = put(put(withTracks(project(), ["t-a", "audio"]), "t-a", audio("u", 4, 6.5, { muted: true })), "t-main", clip("c", 4, 6.5));
  assert.equal(tl.describeElement(doc, el(doc, "c"), { locked: false }), "Video clip, a1.mp4, starts 00:00:04:00, duration 00:00:06:15");
  const description = tl.describeElement(doc, el(doc, "u"), { locked: false }, true);
  assert.ok(description.includes("a3.wav") && description.includes("starts 00:00:04:00") && description.includes("duration 00:00:06:15") && description.endsWith("selected, muted"));
  assert.deepEqual(tl.describeTrack(trackOf(doc, "t-a")), { role: "list", name: "Audio track", itemIds: ["u"] });
  assert.deepEqual([tl.focusNeighbour(doc, "s1", "c", "down"), tl.focusNeighbour(doc, "s1", "u", "up"), tl.focusNeighbour(doc, "s1", "c", "right")], ["u", "c", undefined]);
});
void overlay;
