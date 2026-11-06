import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addAsset, addCaptions, addCaptionTrack, addMask, addSticker, addText, attachMaskTracking, attachTracking, captionTrackHasEdits, deleteElements, editCaption,
  insertElement, overrideCaptionStyle, setElementValue,
} from "../src/index.ts";
import { assertFails, assertValid, audio, context, element, HASH, put, SECOND, sticker, studio, text, track, tweak, validate, video } from "./support/fixtures.ts";

// Requirement: Audio element
test("Audio element — Scenario: Library sound", () => {
  const ctx = context();
  const provenance = { source: "url", url: "https://sounds.example/rain.mp3", author: "Lena", licence: "CC-BY 4.0", sourceUrl: "https://sounds.example/rain", attributionRequired: true };
  const withSound = addAsset(studio(), ctx, { id: "snd1", name: "Rain", type: "audio", size: 2048, duration: 5 * SECOND, provenance });
  const after = insertElement(withSound.document, ctx, "t-audio", { type: "audio", id: "rain", name: "Rain", startTime: 0, duration: 5 * SECOND, sourceDuration: 5 * SECOND, sourceType: "library", mediaId: "snd1" }).document;
  const clip = element(after, "rain");
  assert.deepEqual([clip.type, clip.sourceType, clip.mediaId], ["audio", "library", "snd1"]);
  const stored = after.media.assets.find((entry) => entry.id === "snd1")!.provenance;
  assert.deepEqual([stored.author, stored.licence, stored.sourceUrl], ["Lena", "CC-BY 4.0", "https://sounds.example/rain"]);
  assertValid(after);
});

test("Audio element — Scenario: Audio element without a media id", () => {
  const { mediaId: _mediaId, ...bundled } = audio("s", 0, 2, { sourceType: "bundled" }) as any;
  const error = assertFails(put(studio(), "t-audio", bundled), "document/missing-field");
  assert.equal(error.path, "/scenes/@s1/tracks/audio/@t-audio/elements/@s/mediaId");
  assertFails(put(studio(), "t-audio", audio("s", 0, 2, { mediaId: "a2" })), "document/asset-type-mismatch");
  assertValid(put(studio(), "t-audio", audio("s", 0, 2, { mediaId: "a1" })), {});
});

// Requirement: Text element
test("Text element — Scenario: New text element", () => {
  const after = addText(studio(), context({ newId: () => "x1" }), "t-text", { startTime: 0, duration: 3 * SECOND }).document;
  const stored = element(after, "x1");
  for (const [key, value] of Object.entries({ content: "Default text", fontFamily: "Arial", fontSize: 15, fontWeight: 400, color: "#ffffff", textAlign: "center", lineHeight: 1.2 })) assert.equal(stored[key], value, key);
  assert.deepEqual(stored.box, { mode: "auto", width: 80 });
  assert.deepEqual([stored.background.enabled, stored.stroke.enabled, stored.shadow.enabled, stored.glow.enabled], [false, false, false, false]);
  for (const key of ["bubble", "textAnimation", "tracking", "mediaId", "crop", "masks", "adjustments", "clipAnimation", "volume"]) assert.equal(key in stored, false, key);
  assertValid(after);
});

test("Text element — Scenario: String weight rejected", () => {
  assertFails(put(studio(), "t-text", { ...text("x"), fontWeight: "bold" }), "document/wrong-type", "/elements/@x/fontWeight");
  assertFails(put(studio(), "t-text", { ...text("x"), fontWeight: 450 }), "document/wrong-type");
  assertFails(put(studio(), "t-text", { ...text("x"), textDecoration: "underline" }), "document/field-not-allowed", "/textDecoration");
});

test("Text element — Scenario: Bubble and background together", () => {
  const bubble = { id: "speech-round", color: "#ffffff", strokeColor: "#000000", strokeWidth: 2, flipHorizontal: false };
  const both = { ...text("x", 0, 2, { bubble }), background: { ...text("x").background, enabled: true } };
  const error = assertFails(put(studio(), "t-text", both), "document/field-not-allowed");
  assert.equal(error.path, "/scenes/@s1/tracks/overlay/@t-text/elements/@x/background/enabled");
  assertValid(put(studio(), "t-text", text("x", 0, 2, { bubble })));
  assertFails(put(studio(), "t-text", { ...text("x"), bubble: { ...bubble, id: "thought-cloud" } }), "document/unknown-definition", "/bubble/id");
});

// Requirement: Text style fields
test("Text style fields — Scenario: Shadow defaults", () => {
  const before = put(studio(), "t-text", text("x"));
  const after = setElementValue(before, context(), "x", "shadow.enabled", true).document;
  assert.deepEqual(element(after, "x").shadow, { enabled: true, color: "#000000", opacity: 80, blur: 10, distance: 5, angle: -45 });
});

test("Text style fields — Scenario: In plus out longer than the element", () => {
  const animated = text("x", 0, 1, { textAnimation: { in: { id: "fade", duration: 96_000, strength: 100 }, out: { id: "fade", duration: 96_000, strength: 100 } } });
  assertFails(put(studio(), "t-text", animated), "document/out-of-range", "/textAnimation/out/duration");
  assertValid(put(studio(), "t-text", text("y", 0, 2, { textAnimation: { in: { id: "fade", duration: 96_000, strength: 100 }, out: { id: "fade", duration: 96_000, strength: 100 }, loop: { id: "wave", period: 120_000, strength: 50 } } })));
  assertFails(put(studio(), "t-text", text("z", 0, 2, { textAnimation: { in: { id: "sparkle", duration: 60_000, strength: 100 } } })), "document/unknown-definition");
  assertFails(put(studio(), "t-text", { ...text("w"), textAnimation: { loop: { id: "wave", period: 12_000, strength: 50 } } }), "document/out-of-range", "/loop/period");
});

test("Text style fields — Scenario: Fractional font size", () => {
  const made = addCaptionTrack(studio(), context(), "s1", { language: "en" });
  const imported = tweak(made.document, (draft) => { draft.scenes[0].tracks.overlay[0].caption.style.fontSize = 4.4; });
  assertValid(imported);
  assert.equal(track(imported, made.trackId).caption.style.fontSize, 4.4);
  assertValid(put(studio(), "t-text", text("x", 0, 2, { fontSize: 4.4 })));
  assertFails(put(studio(), "t-text", { ...text("x"), fontSize: 0.5 }), "document/out-of-range");
});

// Requirement: Tracking binding
const scene = () => put(put(put(studio(), "main", video("v1", 0, 4)), "t-text", text("label", 0, 4)), "t-graphic", sticker("badge", 0, 4));

test("Tracking binding — Scenario: Text follows a subject", () => {
  const after = attachTracking(scene(), context(), "label", "v1", "m1", { x: 12, y: -40 }).document;
  assert.deepEqual(element(after, "label").tracking, { targetElementId: "v1", trackId: "m1", followPosition: true, followScale: false, followRotation: false, offset: { x: 12, y: -40 } });
  assert.equal("animations" in element(after, "label"), false, "no position keyframes are created");
  const badge = attachTracking(after, context(), "badge", "v1", "m1").document;
  assert.deepEqual([element(badge, "badge").tracking.followScale, element(badge, "badge").tracking.followRotation], [true, true]);
  assertValid(badge);
  assertFails(tweak(badge, (draft) => { draft.scenes[0].tracks.overlay[1].elements[0].tracking.trackId = "m9"; }), "document/unknown-reference", "/tracking/trackId");
  assertFails(tweak(badge, (draft) => { draft.scenes[0].tracks.overlay[1].elements[0].tracking.targetElementId = "badge"; }), "document/unknown-reference", "/tracking/targetElementId");
});

test("Tracking binding — Scenario: Mask binding instead of baked keys", () => {
  const key = { id: "k1", time: 0, value: 0.2, segmentToNext: "linear", tangentMode: "auto" };
  const ctx = context({ newId: () => "mask1" });
  const masked = addMask(scene(), ctx, "v1", "rectangle").document;
  const keyed = tweak(masked, (draft) => { draft.scenes[0].tracks.main.elements[0].animations = { "masks.mask1.params.centerX": { keys: [key] }, "masks.mask1.params.centerY": { keys: [{ ...key, id: "k2" }] } }; });
  const after = attachMaskTracking(keyed, context(), "v1", "mask1", "m1").document;
  assert.deepEqual(element(after, "v1").masks[0].tracking, { trackId: "m1", followPosition: true, followScale: true, followRotation: true, offset: { x: 0, y: 0 } });
  assert.deepEqual(element(after, "v1").animations, element(keyed, "v1").animations, "the centre channels are unchanged");
  assertValid(after);
  assertFails(tweak(after, (draft) => { draft.scenes[0].tracks.main.elements[0].masks[0].tracking.trackId = "m9"; }), "document/unknown-reference");
});

test("Tracking binding — Scenario: Target deleted", () => {
  const ctx = context();
  const tracked = attachTracking(attachTracking(scene(), ctx, "label", "v1", "m1").document, ctx, "badge", "v1", "m1").document;
  const commit = deleteElements(tracked, ctx, ["v1"]);
  assert.equal("tracking" in element(commit.document, "label"), false);
  assert.equal("tracking" in element(commit.document, "badge"), false);
  assert.equal(commit.history, true);
  assert.equal(commit.patch.filter((entry) => entry.op === "remove" && entry.path.endsWith("/tracking")).length, 2, "the same patch, so the same undo step");
});

// Requirement: Caption element
const captions = () => {
  const ctx = context();
  const made = addCaptionTrack(studio(), ctx, "s1", { language: "en" });
  const doc = addCaptions(made.document, ctx, made.trackId, [
    { startTime: 0, duration: 96_000, text: "hello world", words: [{ text: "hello", start: 0, end: 48_000 }, { text: "world", start: 48_000, end: 96_000 }] },
    { startTime: 120_000, duration: 120_000, text: "second line" },
  ]).document;
  return { doc, trackId: made.trackId, ids: track(doc, made.trackId).elements.map((entry: any) => entry.id) as string[], ctx };
};

test("Caption element — Scenario: Generated caption with word timings", () => {
  const { doc, ids } = captions();
  const stored = element(doc, ids[0]);
  assert.deepEqual([stored.type, stored.text, stored.duration, stored.edited], ["caption", "hello world", 96_000, false]);
  assert.deepEqual(stored.words, [{ text: "hello", start: 0, end: 48_000 }, { text: "world", start: 48_000, end: 96_000 }]);
  for (const key of ["opacity", "blendMode", "effects", "masks"]) assert.equal(key in stored, false, key);
  assertValid(doc);
  assertFails(tweak(doc, (draft) => { draft.scenes[0].tracks.overlay[0].elements[1].startTime = 48_000; }), "document/caption-overlap");
});

test("Caption element — Scenario: Partial style override", () => {
  const { doc, ids, ctx } = captions();
  const after = overrideCaptionStyle(doc, ctx, ids[0], { color: "#ffd400" }).document;
  assert.deepEqual(element(after, ids[0]).style, { color: "#ffd400" }, "every other style value is inherited from the track");
  assert.equal("style" in element(after, ids[1]), false);
  const merged = overrideCaptionStyle(after, ctx, ids[0], { stroke: { width: 3 } }).document;
  assert.deepEqual(element(merged, ids[0]).style, { color: "#ffd400", stroke: { width: 3 } });
  assertValid(merged);
});

test("Caption element — Scenario: Word outside the caption", () => {
  const { doc } = captions();
  assertFails(tweak(doc, (draft) => { draft.scenes[0].tracks.overlay[0].elements[0].words[1].end = 120_000; }), "document/caption-overlap", "/words");
  assertFails(tweak(doc, (draft) => { draft.scenes[0].tracks.overlay[0].elements[0].words.reverse(); }), "document/caption-overlap");
});

test("Caption element — Scenario: Manual edit is recorded", () => {
  const { doc, trackId, ids, ctx } = captions();
  assert.equal(captionTrackHasEdits(track(doc, trackId)), false, "Regroup runs without asking");
  const after = editCaption(doc, ctx, ids[0], { text: "hello word", words: [{ text: "hello", start: 0, end: 48_000 }, { text: "word", start: 48_000, end: 96_000 }] }).document;
  assert.equal(element(after, ids[0]).edited, true);
  assert.equal(element(after, ids[1]).edited, false);
  assert.equal(captionTrackHasEdits(track(after, trackId)), true, "a Regroup would discard a manual edit, so it asks first");
});

// Requirement: Sticker element
test("Sticker element — Scenario: Flag sticker", () => {
  const after = addSticker(studio(), context({ newId: () => "jp" }), "t-graphic", "flags:JP", { startTime: 0, duration: 3 * SECOND }, { width: 640, height: 480 }).document;
  const stored = element(after, "jp");
  assert.deepEqual([stored.stickerId, stored.intrinsicWidth, stored.intrinsicHeight, stored.loop, stored.playbackSpeed], ["flags:JP", 640, 480, true, 1]);
  assert.equal("mediaId" in stored, false);
  assertValid(after);
});

test("Sticker element — Scenario: Malformed id", () => {
  assertFails(put(studio(), "t-graphic", { ...sticker("k"), stickerId: "flags:" }), "document/wrong-type", "/elements/@k/stickerId");
  assertFails(put(studio(), "t-graphic", { ...sticker("k"), stickerId: ":JP" }), "document/wrong-type");
  assertFails(put(studio(), "t-graphic", { ...sticker("k"), playbackSpeed: 5 }), "document/out-of-range");
});

test("Sticker element — Scenario: Imported sticker resolves to an asset", () => {
  const missing = validate(put(studio(), "t-graphic", sticker("k", 0, 2, { stickerId: `user:${HASH("e")}` })));
  assert.equal(missing.ok, true);
  assert.deepEqual(missing.warnings.map((warning) => [warning.code, warning.path]), [["document/unknown-asset", "/scenes/@s1/tracks/overlay/@t-graphic/elements/@k/stickerId"]]);
  const present = tweak(put(studio(), "t-graphic", sticker("k", 0, 2, { stickerId: `user:${HASH("e")}` })), (draft) => { draft.media.assets[1].contentHash = HASH("e"); });
  assert.deepEqual(validate(present).warnings, []);
});
