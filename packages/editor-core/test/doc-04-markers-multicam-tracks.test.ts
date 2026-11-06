import assert from "node:assert/strict";
import { test } from "node:test";
import { createTrack } from "@jagentchill/protocol";
import {
  addCaptions, addCaptionTrack, addTrack, audioAngleOf, commitChange, createCompound, createMulticam, toggleMarker, toggleSolo, translateCaptions, canonicalize,
} from "../src/index.ts";
import { assertFails, assertValid, context, element, image, put, rejected, SECOND, sticker, studio, text, track, tweak, video } from "./support/fixtures.ts";

// Requirement: Compound background rule
test("Compound background rule — Scenario: Compound of overlay elements stays transparent", () => {
  const before = put(put(put(studio(), "main", video("base", 0, 4)), "t-text", text("title", 0, 4)), "t-graphic", sticker("badge", 0, 4));
  const after = createCompound(before, context(), ["title", "badge"]).document;
  const scene = after.scenes.find((candidate) => candidate.kind === "compound")!;
  assert.equal(scene.compoundBackground, "none", "\"Create compound clip\" always writes none");
  assert.equal(scene.tracks.main.elements.length, 0, "no main-track content, so nothing would emit a background");
  assertValid(after);
});

test("Compound background rule — Scenario: Own background only under main-track content", () => {
  // The stored shape the render engine reads: `own`, one main-track clip 0–2 s with a red override, a 4 s compound element.
  const before = put(studio(), "main", video("clip", 0, 2, { background: { kind: "color", color: "#ff0000" } }), video("tail", 2, 2));
  const made = createCompound(before, context(), ["clip"]).document;
  const scene = made.scenes.find((candidate) => candidate.kind === "compound")!;
  const own = commitChange(made, context(), { commandType: "compound.background", label: "Keep this clip's background" }, (draft) => {
    draft.scenes.find((candidate) => candidate.id === scene.id)!.compoundBackground = "own";
  }).document;
  const stored = own.scenes.find((candidate) => candidate.id === scene.id)!;
  assert.equal(stored.compoundBackground, "own");
  assert.deepEqual((stored.tracks.main.elements[0] as any).background, { kind: "color", color: "#ff0000" }, "the override is kept in the data");
  assert.deepEqual([stored.tracks.main.elements[0].startTime, stored.tracks.main.elements[0].duration], [0, 2 * SECOND]);
  assertValid(own);
});

test("Compound background rule — Scenario: Root scene ignores the field", () => {
  // `none` on the main scene is a valid document; the field is read only for a scene rendered as a compound source.
  const doc = studio();
  assert.equal(doc.scenes[0].compoundBackground, "none");
  assert.deepEqual(doc.settings.background, { kind: "color", color: "#000000" });
  assertValid(tweak(doc, (draft) => { draft.scenes[0].compoundBackground = "own"; }));
  assertFails(tweak(doc, (draft) => { draft.scenes[0].compoundBackground = "inherit"; }), "document/wrong-type");
});

// Requirement: Markers
test("Markers — Scenario: Marker added", () => {
  const first = toggleMarker(studio(), context(), "s1", 5 * SECOND).document;
  const commit = toggleMarker(first, context({ newId: () => "mk-new" }), "s1", 3 * SECOND);
  assert.deepEqual(commit.document.scenes[0].markers[0], { id: "mk-new", time: 360_000, color: 1 });
  assert.deepEqual(commit.document.scenes[0].markers.map((marker) => marker.time), [360_000, 600_000], "at its sorted position");
  assert.deepEqual(commit.patch.find((entry) => entry.path === "/scenes/@s1/markers/@mk-new"), { op: "add", path: "/scenes/@s1/markers/@mk-new", value: { id: "mk-new", time: 360_000, color: 1 } });
  // Toggling on the same frame removes it.
  assert.equal(toggleMarker(commit.document, context(), "s1", 3 * SECOND + 1000).document.scenes[0].markers.length, 1);
});

test("Markers — Scenario: Two markers on one frame", () => {
  assertFails(tweak(studio(), (draft) => { draft.scenes[0].markers = [{ id: "m1", time: 360_000, color: 1 }, { id: "m2", time: 360_000, color: 2 }]; }), "document/elements-unsorted");
  assertFails(tweak(studio(), (draft) => { draft.scenes[0].markers = [{ id: "m1", time: 480_000, color: 1 }, { id: "m2", time: 360_000, color: 2 }]; }), "document/elements-unsorted");
  assertFails(tweak(studio(), (draft) => { draft.scenes[0].bookmarks = []; }), "document/field-not-allowed", "/bookmarks");
});

test("Markers — Scenario: Colour token or custom", () => {
  const marked = (color: unknown) => tweak(studio(), (draft) => { draft.scenes[0].markers = [{ id: "m1", time: 0, color }]; });
  assertFails(marked(9), "document/out-of-range", "/markers/@m1/color");
  assertValid(marked(3));
  assertValid(marked("#12ab34"));
  assertFails(tweak(studio(), (draft) => { draft.scenes[0].markers = [{ id: "m1", time: 0, color: 1, duration: 0 }]; }), "document/out-of-range");
});

// Requirement: Multi-camera definition
const threeClips = () => put(studio(), "t-video", video("cam1", 0, 4), video("cam2", 4, 4), video("cam3", 8, 4));

test("Multi-camera definition — Scenario: Created by audio sync", () => {
  const commit = createMulticam(threeClips(), context(), [
    { elementId: "cam1", syncOffset: 0 }, { elementId: "cam2", syncOffset: 150_000, syncConfidence: 0.82 }, { elementId: "cam3", syncOffset: 60_000, syncConfidence: 0.7 },
  ], "audio");
  const scene = commit.document.scenes.find((candidate) => candidate.id === commit.sceneId)!;
  assert.equal(scene.kind, "multicam");
  const multicam = scene.multicam!;
  assert.equal(multicam.angles.length, 3);
  assert.deepEqual(multicam.angles.map((angle) => scene.tracks.overlay.find((candidate) => candidate.id === angle.trackId)!.type), ["video", "video", "video"]);
  assert.equal(multicam.angles[1].syncOffset, 150_000);
  assert.ok(multicam.angles[1].syncConfidence! >= 0.6);
  assert.equal(multicam.audioAngleId, multicam.angles[0].id);
  assert.equal(multicam.audioFollowsVideo, false);
  assert.deepEqual(multicam.angles.map((angle) => angle.name), ["Angle 1", "Angle 2", "Angle 3"]);
  const clip = commit.document.scenes[0].tracks.overlay[0].elements[0] as any;
  assert.deepEqual([clip.type, clip.sceneId, clip.multicam.angleId], ["compound", scene.id, multicam.angles[0].id]);
  assert.equal(audioAngleOf(scene, clip), multicam.angles[0].id);
  assertValid(commit.document);
});

test("Multi-camera definition — Scenario: Angle track missing", () => {
  const made = createMulticam(threeClips(), context(), [{ elementId: "cam1", syncOffset: 0 }, { elementId: "cam2", syncOffset: 0 }, { elementId: "cam3", syncOffset: 0 }], "start");
  const index = made.document.scenes.findIndex((candidate) => candidate.id === made.sceneId);
  assertFails(tweak(made.document, (draft) => { draft.scenes[index].multicam.angles[2].trackId = "nowhere"; }), "document/multicam-invalid");
  assertFails(tweak(made.document, (draft) => { delete draft.scenes[index].multicam; }), "document/multicam-invalid");
  assertFails(tweak(made.document, (draft) => { draft.scenes[0].multicam = draft.scenes[index].multicam; }), "document/multicam-invalid");
  assertFails(tweak(made.document, (draft) => { draft.scenes[index].multicam.audioAngleId = "zz"; }), "document/multicam-invalid");
});

test("Multi-camera definition — Scenario: Nine angles", () => {
  const made = createMulticam(threeClips(), context(), [{ elementId: "cam1", syncOffset: 0 }, { elementId: "cam2", syncOffset: 0 }], "start");
  const index = made.document.scenes.findIndex((candidate) => candidate.id === made.sceneId);
  const nine = tweak(made.document, (draft) => {
    const scene = draft.scenes[index];
    for (let n = 3; n <= 9; n++) {
      scene.tracks.overlay.push(createTrack("video", { id: `angle-track-${n}`, name: `Angle ${n}` }));
      scene.multicam.angles.push({ id: `angle-${n}`, name: `Angle ${n}`, trackId: `angle-track-${n}`, syncOffset: 0 });
    }
  });
  assert.equal(assertFails(nine, "document/limit-exceeded").details!.limit, "multicamAngles");
});

// Requirement: Track zones and types
test("Track zones and types — Scenario: Audio track in the overlay zone", () => {
  const patched = tweak(studio(), (draft) => { draft.scenes[0].tracks.overlay.push(createTrack("audio", { id: "t-stray", name: "Audio" })); });
  assertFails(patched, "document/track-zone-mismatch");
  assertFails(tweak(studio(), (draft) => { draft.scenes[0].tracks.audio.push(createTrack("text", { id: "t-stray", name: "Text" })); }), "document/track-zone-mismatch");
  assertFails(tweak(studio(), (draft) => { draft.scenes[0].tracks.main = createTrack("audio", { id: "t-main", name: "Main" }); }), "document/main-track-invalid");
  assertFails(tweak(studio(), (draft) => { draft.scenes[0].tracks.overlay[0].zone = "overlay"; }), "document/field-not-allowed", "/zone");
});

test("Track zones and types — Scenario: Image on the main track", () => {
  assertValid(put(studio(), "main", image("i1")));
});

test("Track zones and types — Scenario: Text on a video track", () => {
  const error = assertFails(put(studio(), "t-video", text("x1")), "document/element-track-mismatch");
  assert.equal(error.path, "/scenes/@s1/tracks/overlay/@t-video/elements/@x1");
  assertFails(put(studio(), "t-text", sticker("k1")), "document/element-track-mismatch");
  assertValid(put(studio(), "t-graphic", sticker("k1")));
});

// Requirement: Track fields
test("Track fields — Scenario: Video track carries audio controls", () => {
  const commit = addTrack(studio(), context(), "s1", "video", { name: "B-roll" });
  const stored = track(commit.document, commit.trackId);
  assert.deepEqual(stored, { id: commit.trackId, name: "B-roll", type: "video", muted: false, solo: false, volume: 0, pan: 0, hidden: false, locked: false, pinned: false, transitions: [], elements: [] });
  assert.equal("ducking" in stored, false);
  const audio = addTrack(studio(), context(), "s1", "audio");
  assert.deepEqual(track(audio.document, audio.trackId).ducking, { enabled: false, amount: 12, attack: 200, release: 500, mode: "full" });
  assert.equal("hidden" in track(audio.document, audio.trackId), false);
});

test("Track fields — Scenario: Ducking on a text track", () => {
  const error = assertFails(tweak(studio(), (draft) => { draft.scenes[0].tracks.overlay[1].ducking = { enabled: true }; }), "document/field-not-allowed");
  assert.equal(error.path, "/scenes/@s1/tracks/overlay/@t-text/ducking");
  assertFails(tweak(studio(), (draft) => { draft.scenes[0].tracks.audio[0].hidden = true; }), "document/field-not-allowed", "/hidden");
  assertFails(tweak(studio(), (draft) => { draft.scenes[0].tracks.overlay[1].volume = 0; }), "document/field-not-allowed", "/volume");
  assertFails(tweak(studio(), (draft) => { draft.scenes[0].tracks.audio[0].volume = 13; }), "document/out-of-range");
});

test("Track fields — Scenario: Solo is not undoable but is saved", () => {
  const before = studio();
  const commit = toggleSolo(before, context(), "t-audio");
  assert.equal(commit.history, false, "no undo step is created, so Undo leaves the track soloed");
  assert.deepEqual(commit.patch.find((entry) => entry.path.endsWith("/solo")), { op: "replace", path: "/scenes/@s1/tracks/audio/@t-audio/solo", value: true });
  // It is part of the canonical document, so it is saved and is still there after a reopen.
  const reopened = JSON.parse(canonicalize(commit.document));
  assert.equal(reopened.scenes[0].tracks.audio[0].solo, true);
});

test("Track fields: a 100th overlay track is refused with the owner's message and no change", () => {
  const full = tweak(studio(), (draft) => { for (let index = draft.scenes[0].tracks.overlay.length; index < 99; index++) draft.scenes[0].tracks.overlay.push(createTrack("text", { id: `ot${index}`, name: "Text" })); });
  const errors = rejected(() => addTrack(full, context(), "s1", "text"), "document/limit-exceeded");
  assert.equal(errors[0].message, "Track limit reached (99)");
  assert.equal(full.scenes[0].tracks.overlay.length, 99);
});

// Requirement: Caption track fields
test("Caption track fields — Scenario: Generated caption track", () => {
  const commit = addCaptionTrack(studio(), context(), "s1", { language: "en" });
  const stored = track(commit.document, commit.trackId);
  assert.equal(stored.type, "caption");
  assert.deepEqual([stored.caption.language, stored.caption.mode, stored.caption.burnIn, stored.caption.showSpeakerLabels], ["en", "speech", true, false]);
  const style = stored.caption.style;
  assert.deepEqual([style.fontFamily, style.fontWeight, style.fontSize, style.color, style.textAlign, style.background.enabled], ["Arial", 700, 5, "#ffffff", "center", false]);
  assert.deepEqual(style.stroke, { enabled: true, color: "#000000", width: 6, position: "outside" });
  assert.deepEqual(stored.caption.layout, { anchor: "bottom", marginY: 5, maxWidth: 80, offset: { x: 0, y: 0 }, scale: 1 });
  assert.equal(stored.caption.highlight.style, "none");
  assertValid(commit.document);
});

test("Caption track fields — Scenario: Bilingual track", () => {
  const ctx = context();
  const made = addCaptionTrack(studio(), ctx, "s1", { language: "en" });
  const withCaptions = addCaptions(made.document, ctx, made.trackId, [{ startTime: 0, duration: SECOND, text: "hello" }, { startTime: SECOND, duration: SECOND, text: "goodbye" }]).document;
  const ids = track(withCaptions, made.trackId).elements.map((entry: any) => entry.id);
  const after = translateCaptions(withCaptions, ctx, made.trackId, "vi", { [ids[0]]: "xin chào", [ids[1]]: "tạm biệt" }).document;
  assert.equal(track(after, made.trackId).caption.translationLanguage, "vi");
  assert.deepEqual(track(after, made.trackId).elements.map((entry: any) => typeof entry.translation), ["string", "string"]);
  assert.equal(element(after, ids[1]).translation, "tạm biệt");
  assertValid(after);
});

test("Caption track fields — Scenario: Caption object on a text track", () => {
  const made = addCaptionTrack(studio(), context(), "s1", { language: "en" });
  const caption = track(made.document, made.trackId).caption;
  const error = assertFails(tweak(studio(), (draft) => { draft.scenes[0].tracks.overlay[1].caption = caption; }), "document/field-not-allowed");
  assert.equal(error.path, "/scenes/@s1/tracks/overlay/@t-text/caption");
  assertFails(tweak(made.document, (draft) => { delete draft.scenes[0].tracks.overlay[0].caption; }), "document/missing-field", "/caption");
});
