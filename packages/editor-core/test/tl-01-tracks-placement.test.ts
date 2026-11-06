import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, createProjectDocument, createTrack, projectDocumentSchema } from "@jagentchill/protocol";
import { addCaptions, addCaptionTrack, clone, deleteElements as rawDelete, timeline as tl } from "../src/index.ts";
import { audio, context, image, NOW, put, sticker, text, tweak, video } from "./support/fixtures.ts";
import { templateDraft } from "./support/template.ts";
import { audioTracks, el, FREE, main, OFF, ON, open, overlay, project, S, spans, trackIdOf, trackOf, withTracks } from "./support/timeline.ts";

const media = (assetId: string): tl.LibraryItem => ({ kind: "media", assetId });
const add = (session: ReturnType<typeof open>, item: tl.LibraryItem, time: number, edit = ON, request?: tl.PlacementRequest) => session.execute(tl.addToTimeline({ sceneId: "s1", items: [item], time, request }), edit);
/** A 4 s clip of the 60 s video asset. */
const clip = (id: string, start: number, seconds: number, extra: Record<string, unknown> = {}) => video(id, start, seconds, { sourceDuration: 60 * S, trimEnd: (60 - seconds) * S, ...extra });

// — Scene track layout —
test("Scene track layout: New scene has only the main track", () => {
  const doc = createProjectDocument({ id: "p1", mainSceneId: "s1", mainTrackId: "t-main", now_ms: NOW });
  assert.deepEqual([doc.scenes[0].tracks.overlay.length, doc.scenes[0].tracks.main.elements.length, doc.scenes[0].tracks.audio.length], [0, 0, 0]);
  const session = open(doc);
  const made = session.execute(tl.createScene(), ON);
  assert.ok(made.ok);
  const scene = session.document.scenes[1];
  assert.deepEqual([scene.tracks.overlay.length, scene.tracks.main.name, scene.tracks.main.type, scene.tracks.main.elements.length, scene.tracks.audio.length], [0, "Main Track", "video", 0, 0]);
});
test("Scene track layout: Main track cannot be removed", () => {
  const session = open(put(project(), "t-main", clip("c1", 0, 4)));
  assert.ok(!tl.trackContextMenu(session.document, "t-main").some((item) => "id" in item && item.id === "delete-track"));
  const before = session.document;
  const result = session.execute(tl.deleteTrack({ trackId: "t-main" }), ON);
  assert.ok(result.ok && !result.changed);
  assert.equal(session.document, before);
  assert.equal(session.historyLength, 0);
});
test("Scene track layout: Picture-in-picture stacking", () => {
  // The compositing itself is the render engine's; the document order it reads is top to bottom [...overlay, main, ...audio].
  const session = open(put(withTracks(project(), ["t-top", "video"], ["t-near", "video"]), "t-main", clip("m", 0, 10)));
  assert.ok(session.execute(tl.addToTimeline({ sceneId: "s1", items: [media("a1")], time: 0, request: { strategy: "explicit", trackId: "t-near" } }), ON).ok);
  const order = tl.tracksOfScene(tl.sceneById(session.document, "s1")).map((track) => track.id);
  assert.deepEqual(order.slice(-2), ["t-near", "t-main"]);
  assert.ok(order.indexOf("t-near") < order.indexOf("t-main"), "an overlay track is above the main track");
});
test("Scene track layout: Track limit boundary", () => {
  const full = (count: number) => tweak(project(), (draft) => {
    for (let index = 0; index < count; index++) draft.scenes[0].tracks.overlay.push({ ...createTrack("video", { id: `o${index}`, name: "Video track" }), elements: [createElement("image", { id: `i${index}`, name: "i", startTime: 5 * S, duration: S, mediaId: "a2" })] });
  });
  const session = open(full(99));
  const before = session.document;
  const refused = session.execute(tl.dropLibraryItem({ sceneId: "s1", items: [media("a2")], time: 5 * S, target: { hoveredTrackId: "o3", half: "upper" } }), OFF);
  assert.deepEqual([refused.ok, !refused.ok && refused.message, session.historyLength], [false, "Track limit reached (99)", 0]);
  assert.equal(session.document, before);
  const roomy = open(full(98));
  assert.ok(roomy.execute(tl.dropLibraryItem({ sceneId: "s1", items: [media("a2")], time: 5 * S, target: { hoveredTrackId: "o3", half: "upper" } }), OFF).ok);
  assert.equal(overlay(roomy.document).length, 99);
});

// — Timeline document model —
test("Timeline document model: New element is written with canonical fields", () => {
  const session = open(project());
  assert.ok(add(session, media("a1"), 0).ok);
  const stored = main(session.document).elements[0];
  const expected = createElement("video", { id: stored.id, name: "a1.mp4", startTime: 0, duration: 60 * S, sourceDuration: 60 * S, mediaId: "a1" });
  assert.deepEqual(stored, expected);
  for (const key of ["params", "keyframes", "zone"]) assert.ok(!(key in stored));
});
test("Timeline document model: Standalone filter", () => {
  const session = open(project());
  const result = session.execute(tl.dropEffect({ sceneId: "s1", item: { kind: "filter", effectType: "warm-film" }, time: 0 }), ON);
  assert.ok(result.ok);
  const track = overlay(session.document)[0], element = track.elements[0];
  assert.deepEqual([track.type, element.type, element.effects.length, element.effects[0].kind], ["effect", "effect", 1, "filter"]);
});
test("Timeline document model: Unknown field moves with its element", () => {
  const doc = put(withTracks(project(), ["t-a", "text"], ["t-b", "text"]), "t-a", { ...text("x1", 0, 2), futureKey: { keep: [1, 2] } });
  const session = open(doc);
  assert.ok(session.execute(tl.move({ sceneId: "s1", elementIds: ["x1"], time: 0, target: { kind: "track", trackId: "t-b" } }), ON).ok);
  assert.equal(trackIdOf(session.document, "x1"), "t-b");
  const saved = projectDocumentSchema.parse(JSON.parse(JSON.stringify(session.document)));
  assert.deepEqual(el(saved, "x1").futureKey, { keep: [1, 2] });
});
test("Timeline document model: Command that would break the document is refused", () => {
  const session = open(put(withTracks(project(), ["t-v", "video"]), "t-v", clip("c1", 0, 4)));
  const before = session.document;
  const result = session.execute(tl.addToTimeline({ sceneId: "s1", items: [media("a2")], time: 2 * S, request: { strategy: "explicit", trackId: "t-v" } }), ON);
  assert.deepEqual([result.ok, !result.ok && result.code, session.historyLength], [false, "document/elements-overlap", 0]);
  assert.equal(session.document, before);
});
test("Timeline document model: Template draft refuses a split", () => {
  const draft = templateDraft(true), session = open(draft);
  const first = [...tl.elementsOfScene(tl.sceneById(draft, draft.scenes[0].id))][0];
  const result = session.execute(tl.split({ sceneId: draft.scenes[0].id, time: first.startTime + first.duration / 2, elementIds: [first.id] }), ON);
  assert.deepEqual([result.ok, !result.ok && result.code], [false, "document/template-locked"]);
  assert.equal(!result.ok && result.message, "This project is a template draft. Choose 'Edit in full editor' to change its structure.");
  assert.equal(session.document, draft);
});

// — Track types and element compatibility —
test("Track types and element compatibility: Image goes to a video track", () => {
  const session = open(project());
  assert.ok(add(session, media("a2"), 0, OFF, { strategy: "firstAvailable" }).ok);
  const id = session.selection.selectedElements[0];
  assert.equal(trackOf(session.document, trackIdOf(session.document, id)!).type, "video");
});
test("Track types and element compatibility: Incompatible drop is refused", () => {
  const session = open(put(withTracks(project(), ["t-text", "text"]), "t-text", text("x1", 0, 2)));
  assert.ok(session.execute(tl.dropLibraryItem({ sceneId: "s1", items: [media("a3")], time: S, target: { hoveredTrackId: "t-text", half: "lower", dragDirection: "down" } }), ON).ok);
  assert.equal(trackOf(session.document, "t-text").elements.length, 1);
  assert.equal(audioTracks(session.document).length, 1);
  assert.equal(audioTracks(session.document)[0].elements[0].type, "audio");
  // The mapping is strict for an explicit target too.
  const refused = session.execute(tl.addToTimeline({ sceneId: "s1", items: [media("a3")], time: 9 * S, request: { strategy: "explicit", trackId: "t-text" } }), ON);
  assert.deepEqual([refused.ok, !refused.ok && refused.code], [false, "document/element-track-mismatch"]);
});
test("Track types and element compatibility: Caption track is separate from text track", () => {
  const doc = put(withTracks(project(), ["t-text", "text"]), "t-text", text("x1", 0, 2));
  const ctx = context(), track = addCaptionTrack(doc, ctx, "s1", { language: "en" });
  const captioned = addCaptions(track.document, ctx, track.trackId, [{ startTime: 0, duration: S, text: "Hello" }]).document;
  assert.equal(trackOf(captioned, track.trackId).type, "caption");
  assert.ok(trackOf(captioned, "t-text").elements.every((element: { type: string }) => element.type !== "caption"));
  assert.equal(tl.TRACK_FOR_ELEMENT.caption, "caption");
  assert.ok(!tl.canHold({ type: "text" }, "caption"));
});
test("Track types and element compatibility: Sticker is maskable", () => {
  assert.ok(tl.isMaskable(sticker("k1")));
  assert.ok(!tl.isMaskable(text("x1")) && !tl.isMaskable(audio("u1")));
  assert.ok(tl.isHideable(text("x1")) && !tl.isHideable(audio("u1")) && tl.isRetimable(audio("u1")) && !tl.isRetimable(image("i1")));
});

// — Track state flags —
test("Track state flags: Mute a video track", () => {
  const session = open(put(withTracks(project(), ["t-v", "video"]), "t-v", clip("c1", 0, 4)));
  assert.ok(session.execute(tl.toggleTrackFlag({ trackId: "t-v", flag: "muted" }), ON).ok);
  assert.equal(trackOf(session.document, "t-v").muted, true);
  assert.equal(session.historyLength, 1);
});
test("Track state flags: Audio track has no hide control", () => {
  const doc = put(withTracks(project(), ["t-a", "audio"]), "t-a", audio("u1"));
  const scene = tl.sceneById(doc, "s1");
  const controls = tl.trackHeaderControls(scene, scene.tracks.audio[0]);
  assert.ok(controls.includes("mute") && controls.includes("lock") && !controls.includes("visibility"));
  const session = open(doc);
  assert.equal(session.execute(tl.toggleTrackFlag({ trackId: "t-a", flag: "hidden" }), ON).ok, false);
  assert.ok(!tl.trackContextMenu(doc, "t-a").some((item) => "id" in item && item.id === "hide-track"));
});
test("Track state flags: Undo track hide", () => {
  const session = open(put(withTracks(project(), ["t-text", "text"]), "t-text", text("x1")));
  session.execute(tl.toggleTrackFlag({ trackId: "t-text", flag: "hidden" }), ON);
  assert.equal(trackOf(session.document, "t-text").hidden, true);
  session.undo();
  assert.equal(trackOf(session.document, "t-text").hidden, false);
});
test("Track state flags: Solo control on audio-capable tracks only", () => {
  const doc = withTracks(project(), ["t-v", "video", { pinned: true }], ["t-text", "text", { pinned: true }], ["t-a", "audio", { pinned: true }]);
  const scene = tl.sceneById(doc, "s1");
  const solo = (id: string) => tl.trackHeaderControls(scene, tl.trackById(scene, id)!).includes("solo");
  assert.deepEqual([solo("t-v"), solo("t-a"), solo("t-text")], [true, true, false]);
  // Solo emits a patch and creates no undo step.
  const session = open(doc);
  assert.ok(session.execute(tl.toggleTrackSolo({ trackId: "t-a" }), ON).ok);
  assert.deepEqual([trackOf(session.document, "t-a").solo, session.historyLength, session.patches.length], [true, 0, 1]);
});

// — Track rename —
test("Track rename: Rename and undo", () => {
  const session = open(put(withTracks(project(), ["t-v", "video"]), "t-v", clip("c1", 0, 4)));
  assert.equal(trackOf(session.document, "t-v").name, "Video track");
  session.execute(tl.renameTrack({ trackId: "t-v", name: "B-roll" }), ON);
  assert.deepEqual([trackOf(session.document, "t-v").name, trackOf(session.document, "t-v").pinned], ["B-roll", true]);
  assert.equal(tl.describeTrack(trackOf(session.document, "t-v")).name, "B-roll");
  session.undo();
  assert.equal(trackOf(session.document, "t-v").name, "Video track");
});
test("Track rename: Empty name is rejected", () => {
  const session = open(put(withTracks(project(), ["t-v", "video"]), "t-v", clip("c1", 0, 4)));
  const result = session.execute(tl.renameTrack({ trackId: "t-v", name: "   " }), ON);
  assert.ok(result.ok && !result.changed);
  assert.deepEqual([trackOf(session.document, "t-v").name, session.historyLength], ["Video track", 0]);
});
test("Track rename: Length bound", () => {
  assert.equal(tl.committedName("n".repeat(70))!.length, 64);
  assert.equal(tl.committedName("  B-roll  "), "B-roll");
});

// — Track lock —
test("Track lock: Locked clip cannot be moved", () => {
  const session = open(put(withTracks(project(), ["t-v", "video", { locked: true }]), "t-v", clip("c1", 0, 4)));
  assert.deepEqual(tl.pressOnClip(session.document, "c1"), { allowed: false, cursor: "not-allowed" });
  session.select(tl.clickElement(session.document, session.selection, "c1"));
  assert.deepEqual(session.selection.selectedElements, []);
  const result = session.execute(tl.move({ sceneId: "s1", elementIds: ["c1"], time: 5 * S }), ON);
  assert.equal(result.ok, false);
  assert.deepEqual(spans(session.document, "t-v"), [[0, 4]]);
  assert.deepEqual(tl.selectAll(session.document).selectedElements, []);
});
test("Track lock: Split all skips locked tracks", () => {
  let doc = withTracks(project(), ["t-1", "video"], ["t-2", "video", { locked: true }]);
  doc = put(put(put(doc, "t-1", clip("a", 0, 4)), "t-2", clip("b", 0, 4)), "t-main", clip("c", 0, 4));
  const session = open(doc);
  assert.ok(session.execute(tl.split({ sceneId: "s1", time: 2 * S, mode: "split-all" }), OFF).ok);
  assert.deepEqual([spans(session.document, "t-1"), spans(session.document, "t-2"), spans(session.document, "t-main")], [[[0, 2], [2, 4]], [[0, 4]], [[0, 2], [2, 4]]]);
});
test("Track lock: Drop on locked track", () => {
  const doc = put(withTracks(project(), ["t-top", "video", { pinned: true }], ["t-lock", "video", { locked: true }]), "t-main", clip("m", 0, 4));
  const upper = tl.previewDrop(doc, "s1", "image", 0, 5 * S, { hoveredTrackId: "t-lock", half: "upper" }, OFF);
  const lower = tl.previewDrop(doc, "s1", "image", 0, 5 * S, { hoveredTrackId: "t-lock", half: "lower" }, OFF);
  assert.deepEqual([upper.kind, upper.kind === "new-track" && upper.index, lower.kind === "new-track" && lower.index], ["new-track", 1, 2]);
  const session = open(doc);
  assert.ok(session.execute(tl.dropLibraryItem({ sceneId: "s1", items: [media("a2")], time: 0, target: { hoveredTrackId: "t-lock", half: "lower" } }), OFF).ok);
  assert.deepEqual(overlay(session.document).map((track) => [track.id === "t-lock" || track.id === "t-top" ? track.id : "new", track.elements.length]), [["t-top", 0], ["t-lock", 0], ["new", 1]]);
});

// — Track reorder within a zone —
const three = () => { let doc = withTracks(project(), ["o0", "video"], ["o1", "text"], ["o2", "graphic"]); doc = put(put(put(doc, "o0", clip("a", 0, 2)), "o1", text("b")), "o2", sticker("c")); return doc; };
test("Track reorder within a zone: Reorder overlay tracks", () => {
  const session = open(three());
  assert.ok(session.execute(tl.reorderTrack({ trackId: "o2", toIndex: 0 }), ON).ok);
  assert.deepEqual(overlay(session.document).map((track) => track.id), ["o2", "o0", "o1"]);
  session.undo();
  assert.deepEqual(overlay(session.document).map((track) => track.id), ["o0", "o1", "o2"]);
});
test("Track reorder within a zone: Clamp at the main track", () => {
  const session = open(three());
  // Dropped below the main track: display index 4 of [o0, o1, o2, main].
  const index = tl.trackDropIndex(tl.sceneById(session.document, "s1"), "o0", 4);
  assert.equal(index, 2);
  session.execute(tl.reorderTrack({ trackId: "o0", toIndex: 99 }), ON);
  assert.deepEqual(overlay(session.document).map((track) => track.id), ["o1", "o2", "o0"]);
});
test("Track reorder within a zone: Move up at the zone limit", () => {
  const session = open(three());
  const result = session.execute(tl.moveTrack(session.document, { trackId: "o0", direction: "up" }), ON);
  assert.ok(result.ok && !result.changed);
  assert.equal(session.historyLength, 0);
});

// — Track creation and insert index —
test("Track creation and insert index: First audio insert", () => {
  const session = open(project());
  assert.ok(add(session, media("a3"), 0).ok);
  assert.deepEqual([audioTracks(session.document).length, audioTracks(session.document)[0].elements.length, session.historyLength], [1, 1, 1]);
  session.undo();
  assert.equal(audioTracks(session.document).length, 0);
});
test("Track creation and insert index: Effect track goes to the top", () => {
  const session = open(three());
  session.execute(tl.dropEffect({ sceneId: "s1", item: { kind: "effect", effectType: "blur" }, time: 0 }), ON);
  assert.equal(overlay(session.document)[0].type, "effect");
  assert.equal(tl.newTrackIndex(tl.sceneById(three(), "s1"), "adjustment"), 0);
});
test("Track creation and insert index: Text track default index", () => {
  const session = open(three());
  session.execute(tl.addToTimeline({ sceneId: "s1", items: [{ kind: "text" }], time: 0, request: { strategy: "alwaysNew" } }), ON);
  const tracks = overlay(session.document);
  assert.equal(tracks[tracks.length - 1].type, "text");
  assert.equal(tracks[tracks.length - 1].elements[0].type, "text");
});

// — Empty track pruning and persistent tracks —
test("Empty track pruning and persistent tracks: Auto-created track disappears with its last clip", () => {
  const session = open(put(withTracks(project(), ["t-v", "video"]), "t-v", clip("c1", 0, 4)));
  session.execute(tl.deleteElements({ sceneId: "s1", elementIds: ["c1"] }), ON);
  assert.equal(overlay(session.document).length, 0);
  assert.equal(session.historyLength, 1);
  session.undo();
  assert.deepEqual(spans(session.document, "t-v"), [[0, 4]]);
});
test("Empty track pruning and persistent tracks: Explicitly added track persists", () => {
  const session = open(put(project(), "t-main", clip("m", 0, 4)));
  const made = session.execute(tl.addTrack({ sceneId: "s1", type: "text" }), ON);
  assert.ok(made.ok);
  const track = overlay(session.document)[overlay(session.document).length - 1];
  assert.deepEqual([track.type, track.pinned, track.elements.length], ["text", true, 0]);
  session.execute(tl.split({ sceneId: "s1", time: 2 * S, elementIds: ["m"] }), ON);
  assert.equal(overlay(session.document).length, 1);
});
test("Empty track pruning and persistent tracks: Pinned survives a reload", () => {
  const session = open(put(withTracks(project(), ["t-v", "video"]), "t-v", clip("c1", 0, 4)));
  session.execute(tl.renameTrack({ trackId: "t-v", name: "B-roll" }), ON);
  session.execute(tl.deleteElements({ sceneId: "s1", elementIds: ["c1"] }), ON);
  const reopened = open(projectDocumentSchema.parse(JSON.parse(JSON.stringify(session.document))));
  reopened.execute(tl.addTrack({ sceneId: "s1", type: "audio" }), ON);
  assert.deepEqual(overlay(reopened.document).map((track) => [track.name, track.elements.length]), [["B-roll", 0]]);
});
test("Empty track pruning and persistent tracks: Unlocking an empty auto-created track prunes it", () => {
  const session = open(put(withTracks(project(), ["t-v", "video"]), "t-v", clip("c1", 0, 4)));
  session.execute(tl.toggleTrackFlag({ trackId: "t-v", flag: "locked" }), ON);
  // A scene-level command (not a timeline gesture) removes the clip; the locked track stays.
  const emptied = open(rawDelete(session.document, context(), ["c1"]).document);
  emptied.execute(tl.toggleTrackFlag({ trackId: "t-main", flag: "muted" }), ON);
  assert.deepEqual(overlay(emptied.document).map((track) => [track.locked, track.elements.length]), [[true, 0]]);
  emptied.execute(tl.toggleTrackFlag({ trackId: "t-v", flag: "locked" }), ON);
  assert.equal(overlay(emptied.document).length, 0);
  emptied.undo();
  assert.deepEqual(overlay(emptied.document).map((track) => [track.locked, track.elements.length]), [[true, 0]]);
});

// — Track header column and row dimensions —
test("Track header column and row dimensions: Row heights", () => {
  const doc = put(put(put(withTracks(project(), ["t-text", "text"], ["t-a", "audio"]), "t-text", text("x")), "t-main", clip("m", 0, 2)), "t-a", audio("u"));
  const rows = tl.trackRows(doc);
  assert.deepEqual(rows.map((row) => row.height), [25, 65, 50]);
  assert.deepEqual([rows[1].top - (rows[0].top + rows[0].height), rows[2].top - (rows[1].top + rows[1].height)], [6, 6]);
  assert.deepEqual([tl.TIMELINE_GEOMETRY.headerColumnWidth, tl.TIMELINE_GEOMETRY.rulerHeight, tl.TIMELINE_GEOMETRY.markerRowHeight, tl.TIMELINE_GEOMETRY.trimHandleWidth], [136, 22, 16, 8]);
});
test("Track header column and row dimensions: Selected-track highlight", () => {
  const doc = put(put(withTracks(project(), ["t-text", "text"]), "t-text", text("x")), "t-main", clip("m", 0, 2));
  assert.deepEqual(tl.highlightedTrackIds(doc, tl.selectElements(["x"])), ["t-text"]);
});
test("Track header column and row dimensions: Mobile rows", () => {
  let doc = withTracks(project(), ["t-text", "text"], ["t-v", "video"], ["t-a", "audio"]);
  doc = put(put(put(put(doc, "t-text", text("x")), "t-v", clip("v", 0, 2)), "t-main", clip("m", 0, 2)), "t-a", audio("u"));
  const heights = Object.fromEntries(tl.trackRows(doc, { platform: "mobile" }).map((row) => [row.trackId, row.height]));
  assert.deepEqual([heights["t-main"], heights["t-v"], heights["t-a"], heights["t-text"]], [56, 40, 32, 24]);
});
test("Track header column and row dimensions: Header controls of an audio track", () => {
  const scene = tl.sceneById(withTracks(project(), ["t-a", "audio"]), "s1");
  assert.deepEqual(tl.trackHeaderControls(scene, scene.tracks.audio[0]), ["type-icon", "name", "mute", "solo", "lock", "volume-pan"]);
  assert.ok(tl.trackHeaderControls(scene, scene.tracks.main).includes("cover"));
});

// — Overlap rule —
test("Overlap rule: Touching edges are legal", () => {
  const session = open(put(withTracks(project(), ["t-v", "video"]), "t-v", clip("c1", 0, 5)));
  assert.equal(el(session.document, "c1").startTime + el(session.document, "c1").duration, 600000);
  assert.ok(session.execute(tl.dropLibraryItem({ sceneId: "s1", items: [media("a2")], time: 600000, target: { hoveredTrackId: "t-v", half: "upper" } }), OFF).ok);
  assert.deepEqual(spans(session.document, "t-v"), [[0, 5], [5, 10]]);
});
test("Overlap rule: Overlap after adjustment is re-checked", () => {
  // Magnet off: a 4 s clip requested at 1 s before the only main clip (2–6 s) is adjusted to 0 and then intersects it.
  const session = open(put(project(), "t-main", clip("c1", 2, 4)));
  assert.ok(session.execute(tl.dropLibraryItem({ sceneId: "s1", items: [media("a2")], time: 1 * S, target: { hoveredTrackId: "t-main", half: "upper" } }), OFF).ok);
  assert.deepEqual(spans(session.document, "t-main"), [[2, 6]]);
  assert.deepEqual(overlay(session.document).map((track) => [track.type, track.elements[0].startTime / S]), [["video", 1]]);
});

// — Placement strategies —
const two = () => put(put(project(), "t-main", clip("c1", 0, 6)), "t-main", clip("c2", 6, 4));
const four = (): tl.LibraryItem => ({ kind: "media", assetId: "a4" });
const fourSeconds = (doc = two()) => tweak(doc, (draft) => { draft.media.assets[3].duration = 4 * S; });
test("Placement strategies: preferIndex falls to a new track", () => {
  const session = open(put(withTracks(project(), ["t-v", "video"]), "t-v", clip("c1", 0, 10)));
  session.execute(tl.dropLibraryItem({ sceneId: "s1", items: [media("a2")], time: 2 * S, target: { hoveredTrackId: "t-v", half: "upper" } }), OFF);
  assert.deepEqual(overlay(session.document).map((track) => track.id === "t-v" ? "t-v" : track.elements[0].type), ["image", "t-v"]);
});
test("Placement strategies: mainInsert before the midpoint", () => {
  const session = open(fourSeconds());
  assert.ok(add(session, four(), 2 * S).ok);
  assert.deepEqual(spans(session.document, "t-main"), [[0, 4], [4, 10], [10, 14]]);
  session.undo();
  assert.deepEqual(spans(session.document, "t-main"), [[0, 6], [6, 10]]);
});
test("Placement strategies: mainInsert past the midpoint", () => {
  const session = open(fourSeconds());
  add(session, four(), 4 * S);
  assert.deepEqual(spans(session.document, "t-main"), [[0, 6], [6, 10], [10, 14]]);
});
test("Placement strategies: mainInsert beyond the end", () => {
  const session = open(fourSeconds());
  add(session, four(), 30 * S);
  assert.deepEqual(spans(session.document, "t-main")[2], [10, 14]);
});
test("Placement strategies: Click-to-add never creates an overlay with the magnet on", () => {
  const session = open(fourSeconds());
  add(session, four(), 3 * S);
  assert.equal(overlay(session.document).length, 0);
});
test("Placement strategies: Default durations", () => {
  const session = open(project());
  session.execute(tl.addToTimeline({ sceneId: "s1", items: [{ kind: "text" }], time: 0 }), ON);
  const textId = session.selection.selectedElements[0];
  assert.equal(el(session.document, textId).duration, 360000);
  session.execute(tl.addToTimeline({ sceneId: "s1", items: [{ kind: "sticker", stickerId: "emoji:1f600" }], time: 0 }), ON);
  assert.equal(el(session.document, session.selection.selectedElements[0]).duration, 600000);
  assert.equal(session.selection.selectedElements.length, 1);
  // An invalid reference fails with no change; a tool must give text content.
  assert.equal(session.execute(tl.addToTimeline({ sceneId: "s1", items: [{ kind: "sticker", stickerId: "nope" }], time: 0 }), ON).ok, false);
  assert.equal(session.execute(tl.addToTimeline({ sceneId: "s1", items: [{ kind: "text", fields: { content: "" } }], time: 0, agent: true }), ON).ok, false);
});
test("Placement strategies: Locked main track", () => {
  const session = open(tweak(fourSeconds(), (draft) => { draft.scenes[0].tracks.main.locked = true; }));
  const result = add(session, four(), 2 * S);
  assert.deepEqual([result.ok, !result.ok && result.message], [false, "The main track is locked"]);
  assert.deepEqual(spans(session.document, "t-main"), [[0, 6], [6, 10]]);
});
test("Placement strategies: mainFirst uses the main track when it is free", () => {
  const session = open(fourSeconds());
  add(session, four(), 12 * S, OFF);
  assert.deepEqual(spans(session.document, "t-main")[2], [12, 16]);
  assert.equal(overlay(session.document).length, 0);
});
test("Placement strategies: mainFirst creates an overlay directly above the main track", () => {
  const doc = put(put(withTracks(fourSeconds(project()), ["t-text", "text"]), "t-text", text("x", 0, 2)), "t-main", clip("c1", 0, 10));
  const session = open(doc);
  add(session, four(), 3 * S, OFF);
  const tracks = overlay(session.document);
  assert.deepEqual([tracks.length, tracks[0].id, tracks[1].type], [2, "t-text", "video"]);
  assert.deepEqual(spans(session.document, tracks[1].id), [[3, 7]]);
});
test("Placement strategies: firstAvailable for a non-main item", () => {
  const doc = put(put(withTracks(project(), ["t-v", "video"], ["t-text", "text"]), "t-v", clip("v", 0, 2)), "t-text", text("x", 0, 5));
  const session = open(doc);
  session.execute(tl.addToTimeline({ sceneId: "s1", items: [{ kind: "text" }], time: S }), ON);
  assert.equal(overlay(session.document)[0].type, "text");
  assert.deepEqual(spans(session.document, overlay(session.document)[0].id), [[1, 4]]);
  assert.equal(clone(overlay(session.document)).length, 3);
});
void FREE;
