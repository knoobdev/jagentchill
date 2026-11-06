import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addAsset, addBeat, fpsToRational, hexToLinear, libraryAssets, removeAssets, removeKeyframe, secondsToTicks, segmentType, setElementFields, setEqBand, setEqPreset,
  setTransform, upsertKeyframe, insertElement,
} from "../src/index.ts";
import { asset, assertFails, assertValid, audio, context, element, image, put, rejected, SECOND, studio, text, tweak, video } from "./support/fixtures.ts";

const sound = () => put(studio(), "t-audio", audio("s", 0, 4, { sourceDuration: 4 * SECOND }));
const clip = () => put(studio(), "main", video("v", 0, 2));
const key = (id: string, time: number, value: number) => ({ id, time, value, segmentToNext: "linear", tangentMode: "auto" });
const scalar = (...keys: object[]) => ({ keys, extrapolation: { before: "hold", after: "hold" } });

// Requirement: Audio processing fields
test("Audio processing fields — Scenario: Pitch with cents", () => {
  const after = setElementFields(sound(), context(), "s", { pitch: { semitones: 3, cents: -20 } }).document;
  assert.deepEqual(element(after, "s").pitch, { semitones: 3, cents: -20 });
  assertFails(tweak(sound(), (draft) => { draft.scenes[0].tracks.audio[0].elements[0].pitch = { semitones: 13, cents: 0 }; }), "document/out-of-range");
  assertFails(tweak(sound(), (draft) => { draft.scenes[0].tracks.audio[0].elements[0].compressor = { ratio: 21 }; }), "document/out-of-range");
});

test("Audio processing fields — Scenario: Preset bands", () => {
  const after = setEqPreset(sound(), context(), "s", "bass-boost").document;
  assert.deepEqual(element(after, "s").eq, { enabled: true, preset: "bass-boost", bands: { low: 6, lowMid: 2, mid: 0, highMid: 0, high: 0 } });
  assertValid(after);
});

test("Audio processing fields — Scenario: Edited preset becomes custom", () => {
  const preset = setEqPreset(sound(), context(), "s", "bass-boost").document;
  const edited = setEqBand(preset, context(), "s", "highMid", 1).document;
  assert.deepEqual(element(edited, "s").eq, { enabled: true, preset: "custom", bands: { low: 6, lowMid: 2, mid: 0, highMid: 1, high: 0 } });
  // A write that keeps the preset name with a changed band is refused.
  const kept = { enabled: true, preset: "bass-boost", bands: { low: 6, lowMid: 2, mid: 0, highMid: 1, high: 0 } };
  const errors = rejected(() => setElementFields(preset, context(), "s", { eq: kept }), "document/out-of-range");
  assert.ok(errors[0].path.endsWith("/elements/@s/eq/bands"));
});

test("Audio processing fields — Scenario: Unknown voice effect", () => {
  const errors = rejected(() => setElementFields(sound(), context(), "s", { voiceEffect: { type: "alien", intensity: 100 } }), "document/wrong-type");
  assert.ok(errors[0].path.endsWith("/voiceEffect/type"));
  assertValid(setElementFields(sound(), context(), "s", { voiceEffect: { type: "robot", intensity: 60 }, normalize: { enabled: true, target: -14, gainDb: 2.5 }, noiseReduction: { enabled: true, strength: 40 } }).document);
  rejected(() => upsertKeyframe(sound(), context(), "s", "pitch.semitones", { time: 0, value: 2 }), "document/animation-path-invalid");
});

// Requirement: Beat markers field
test("Beat markers field — Scenario: Tap a beat", () => {
  const before = tweak(sound(), (draft) => { draft.scenes[0].tracks.audio[0].elements[0].beats = [120_000, 240_000]; });
  const commit = addBeat(before, context(), "s", 180_000);
  assert.deepEqual(element(commit.document, "s").beats, [120_000, 180_000, 240_000]);
  // Beats are source times: they need not be on the frame grid.
  assertValid(addBeat(commit.document, context(), "s", 200_001).document);
});

test("Beat markers field — Scenario: Duplicate beat", () => {
  const error = assertFails(tweak(sound(), (draft) => { draft.scenes[0].tracks.audio[0].elements[0].beats = [120_000, 120_000]; }), "document/elements-unsorted");
  assert.equal(error.path, "/scenes/@s1/tracks/audio/@t-audio/elements/@s/beats");
  assert.equal(assertFails(tweak(sound(), (draft) => { draft.scenes[0].tracks.audio[0].elements[0].beats = Array.from({ length: 2001 }, (_, index) => index); }), "document/limit-exceeded").details!.limit, "beatsPerElement");
});

// Requirement: Animation store
test("Animation store — Scenario: Path equals the stored location", () => {
  const after = upsertKeyframe(clip(), context(), "v", "transform.position.x", { time: 0, value: 40 }).document;
  assert.deepEqual(Object.keys(element(after, "v").animations), ["transform.position.x"]);
  assert.equal(element(after, "v").transform.position.x, 0, "the static field keeps a value while the channel exists");
  rejected(() => upsertKeyframe(clip(), context(), "v", "transform.positionX", { time: 0, value: 40 }), "document/animation-path-invalid");
  assertFails(put(studio(), "main", { ...video("w"), keyframes: {} }), "document/field-not-allowed", "/keyframes");
});

test("Animation store — Scenario: Path to a missing effect", () => {
  const error = assertFails(tweak(clip(), (draft) => { draft.scenes[0].tracks.main.elements[0].animations = { "effects.e9.params.intensity": scalar(key("k1", 0, 10)) }; }), "document/animation-path-invalid");
  assert.equal(error.path, "/scenes/@s1/tracks/main/elements/@v/animations/effects.e9.params.intensity");
  const many = Object.fromEntries(Array.from({ length: 257 }, (_, index) => [`effects.e${index}.params.x`, scalar(key(`k${index}`, 0, 0))]));
  assert.equal(assertFails(tweak(clip(), (draft) => { draft.scenes[0].tracks.main.elements[0].animations = many; }), "document/limit-exceeded").details!.limit, "animatedPathsPerElement");
});

test("Animation store — Scenario: Last key removed", () => {
  const keyed = upsertKeyframe(clip(), context({ newId: () => "k1" }), "v", "opacity", { time: 0, value: 0.5 }).document;
  const commit = removeKeyframe(keyed, context(), "v", "opacity", "k1");
  assert.equal("animations" in element(commit.document, "v"), false);
  assert.deepEqual(commit.patch.filter((entry) => entry.op === "remove").map((entry) => entry.path), ["/scenes/@s1/tracks/main/elements/@v/animations"]);
  // With a second path only the emptied path goes.
  const two = upsertKeyframe(keyed, context({ newId: () => "k2" }), "v", "transform.rotation", { time: 0, value: 10 }).document;
  assert.deepEqual(Object.keys(element(removeKeyframe(two, context(), "v", "opacity", "k1").document, "v").animations), ["transform.rotation"]);
});

// Requirement: Channel and keyframe shapes
test("Channel and keyframe shapes — Scenario: Scalar key", () => {
  const after = upsertKeyframe(clip(), context({ newId: () => "k1" }), "v", "opacity", { time: SECOND, value: 0.5 }).document;
  assert.deepEqual(element(after, "v").animations.opacity.keys, [{ id: "k1", time: 120_000, value: 0.5, segmentToNext: "linear", tangentMode: "auto" }]);
  assert.deepEqual(element(after, "v").animations.opacity.extrapolation, { before: "hold", after: "hold" });
  assertValid(after);
  const twoOnOneTick = tweak(after, (draft) => { draft.scenes[0].tracks.main.elements[0].animations.opacity.keys.push(key("k2", 120_000, 1)); });
  assertFails(twoOnOneTick, "document/animation-channel-invalid", "/keys/@k2");
  const handle = tweak(after, (draft) => { draft.scenes[0].tracks.main.elements[0].animations.opacity.keys = [{ ...key("k1", 0, 0), rightHandle: { dt: 200_000, dv: 0 } }, key("k2", 120_000, 1)]; });
  assertFails(handle, "document/animation-channel-invalid", "/rightHandle");
});

test("Channel and keyframe shapes — Scenario: Colour channel components stay aligned", () => {
  const before = put(studio(), "t-text", text("x"));
  const after = upsertKeyframe(before, context({ newId: () => "c1" }), "x", "color", { time: 2 * SECOND, value: "#ff8000" }).document;
  const channel = element(after, "x").animations.color;
  assert.deepEqual(["r", "g", "b", "a"].map((part) => channel[part].keys.map((entry: any) => [entry.id, entry.time])), Array(4).fill([["c1", 240_000]]));
  const linear = hexToLinear("#ff8000");
  assert.deepEqual([channel.r.keys[0].value, channel.b.keys[0].value, channel.a.keys[0].value], [1, 0, 1]);
  assert.ok(Math.abs(channel.g.keys[0].value - linear.g) < 1e-6 && linear.g > 0.21 && linear.g < 0.22, "components are linear light");
  assertValid(after);
});

test("Channel and keyframe shapes — Scenario: Misaligned colour components", () => {
  const three = scalar(key("k1", 0, 1), key("k2", SECOND, 1), key("k3", 2 * SECOND, 1)), two = scalar(key("k1", 0, 1), key("k2", SECOND, 1));
  const doc = put(studio(), "t-text", text("x", 0, 4, { animations: { color: { r: three, g: two, b: three, a: three } } }));
  assertFails(doc, "document/animation-channel-invalid", "/animations/color");
  // A scalar channel on a colour path is the wrong shape.
  assertFails(put(studio(), "t-text", { ...text("y"), animations: { color: three } }), "document/animation-channel-invalid");
});

test("Channel and keyframe shapes — Scenario: Key after the element end", () => {
  const error = assertFails(tweak(clip(), (draft) => { draft.scenes[0].tracks.main.elements[0].animations = { opacity: scalar(key("k1", 300_000, 0.5)) }; }), "document/animation-channel-invalid");
  assert.equal(error.path, "/scenes/@s1/tracks/main/elements/@v/animations/opacity/keys/@k1");
  assertFails(tweak(clip(), (draft) => { draft.scenes[0].tracks.main.elements[0].animations = { opacity: scalar(key("k1", 4001, 0.5)) }; }), "document/not-frame-aligned");
});

test("Channel and keyframe shapes — Scenario: Tool input alias", () => {
  const after = upsertKeyframe(clip(), context({ newId: () => "k1" }), "v", "opacity", { time: 0, value: 1, segmentToNext: "hold" }).document;
  assert.equal(element(after, "v").animations.opacity.keys[0].segmentToNext, "step");
  assert.deepEqual([segmentType("hold"), segmentType("bezier"), segmentType(undefined)], ["step", "bezier", "linear"]);
  assertFails(tweak(after, (draft) => { draft.scenes[0].tracks.main.elements[0].animations.opacity.keys[0].segmentToNext = "hold"; }), "document/wrong-type");
});

// Requirement: Animatable property paths
test("Animatable property paths — Scenario: Grouped scale", () => {
  const scaled = setTransform(clip(), context(), "v", { position: { x: 0, y: 0 }, scale: { x: 1.5, y: 1.5 }, rotation: 0 }).document;
  const after = upsertKeyframe(scaled, context(), "v", "transform.scale", { time: SECOND, value: 1.5 }).document;
  const { animations } = element(after, "v");
  assert.deepEqual(Object.keys(animations).sort(), ["transform.scale.x", "transform.scale.y"]);
  for (const path of ["transform.scale.x", "transform.scale.y"]) assert.deepEqual(animations[path].keys.map((entry: any) => [entry.time, entry.value, entry.segmentToNext]), [[120_000, 1.5, "linear"]]);
  assertValid(after);
});

test("Animatable property paths — Scenario: Static field", () => {
  const before = clip();
  rejected(() => upsertKeyframe(before, context(), "v", "blendMode", { time: 0, value: "screen" }), "document/animation-path-invalid");
  assert.equal("animations" in element(before, "v"), false, "nothing changes");
});

test("Animatable property paths — Scenario: Path not carried by the type", () => {
  const before = put(studio(), "main", image("i"));
  rejected(() => upsertKeyframe(before, context(), "i", "volume", { time: 0, value: -6 }), "document/animation-path-invalid");
  rejected(() => upsertKeyframe(before, context(), "i", "fontSize", { time: 0, value: 20 }), "document/animation-path-invalid");
  assertValid(upsertKeyframe(before, context(), "i", "crop.left", { time: 0, value: 0.2 }).document);
});

// Requirement: Media asset records
test("Media asset records — Scenario: Imported video", () => {
  const commit = addAsset(studio(), context(), {
    id: "imp1", name: "holiday.mov", type: "video", size: 48_000_000, width: 1920, height: 1080, fps: fpsToRational(29.97), duration: secondsToTicks(10),
    provenance: { source: "imported", originalFileName: "holiday.mov" },
  });
  const record = commit.document.media.assets.find((entry) => entry.id === "imp1")!;
  assert.deepEqual([record.type, record.kind, record.width, record.height, record.fps, record.duration], ["video", null, 1920, 1080, { numerator: 30000, denominator: 1001 }, 1_200_000]);
  assert.deepEqual(record.provenance, { source: "imported", originalFileName: "holiday.mov", attributionRequired: false, referenceAssetIds: [] });
  assert.deepEqual([record.tags, record.motionTracks, record.faces, record.contentHash, record.folderId, record.rotation], [[], [], [], null, null, 0]);
  assert.deepEqual(commit.document.media.assets.map((entry) => entry.id), ["a1", "a2", "a3", "imp1"], "sorted by id");
  assert.deepEqual([fpsToRational(23.976), fpsToRational(25), fpsToRational(18.5)], [{ numerator: 24000, denominator: 1001 }, { numerator: 25, denominator: 1 }, { numerator: 37, denominator: 2 }]);
});

test("Media asset records — Scenario: Dangling media reference", () => {
  const errors = rejected(() => insertElement(studio(), context(), "t-main", { type: "video", id: "v", name: "clip", startTime: 0, duration: SECOND, mediaId: "nowhere" }), "document/unknown-asset");
  assert.ok(errors[0].path.endsWith("/elements/@v/mediaId"));
  // Removing an asset removes or rewrites every reference in the same step.
  const used = put(studio(), "main", video("v", 0, 2), image("i", 2, 2));
  const commit = removeAssets(used, context(), ["a1"]);
  assert.deepEqual(commit.document.scenes[0].tracks.main.elements.map((entry) => entry.id), ["i"]);
  assertValid(commit.document);
  assertFails(tweak(studio(), (draft) => { draft.media.assets.reverse(); }), "document/elements-unsorted", "/media/assets");
});

test("Media asset records — Scenario: Derived asset is hidden but resolvable", () => {
  const matte = asset("matte1", "video", { kind: "derived", derived: { role: "matte", sourceAssetId: "a1" }, provenance: { source: "derived", tool: "cutout" } });
  const doc = tweak(put(studio(), "main", video("v", 0, 2, { cutout: { mode: "auto", matteAssetId: "matte1" } })), (draft) => { draft.media.assets.push(matte); });
  assert.deepEqual(libraryAssets(doc).map((entry) => entry.id), ["a1", "a2", "a3"], "the library does not list it");
  assertValid(doc);
  assert.ok(JSON.stringify(doc.media.assets).includes("matte1"), "it is part of the document, so packages and sync carry it");
  assertFails(tweak(doc, (draft) => { delete draft.media.assets[3].derived; }), "document/missing-field", "/derived");
  assertFails(tweak(doc, (draft) => { draft.media.assets[3].derived.sourceAssetId = "gone"; }), "document/unknown-asset");
});
