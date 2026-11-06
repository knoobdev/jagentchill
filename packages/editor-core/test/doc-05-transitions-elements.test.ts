import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addAsset, addCrossfade, addEffectLayer, addTransition, extractAudio, freezeFrame, insertElement, moveElement, replaceMedia, revertProcessedSource,
  setProcessedSource,
} from "../src/index.ts";
import { asset, assertFails, assertValid, audio, context, element, HASH, image, put, rejected, SECOND, sticker, studio, text, track, tweak, video } from "./support/fixtures.ts";

const pair = () => put(studio(), "main", video("a", 0, 2), video("b", 2, 2));

// Requirement: Track transition records
test("Track transition records — Scenario: Add a transition", () => {
  const commit = addTransition(pair(), context({ newId: () => "t1" }), "a", "b", "dissolve");
  assert.deepEqual(track(commit.document, "t-main").transitions, [
    { id: "t1", kind: "transition", fromElementId: "a", toElementId: "b", duration: 60_000, type: "dissolve", params: {}, easing: "ease-in-out", audioCrossfade: true, shape: "equal-power" },
  ]);
  assert.equal(element(commit.document, "a").transitionOut, "t1");
  assert.equal(element(commit.document, "b").transitionIn, "t1");
  assertValid(commit.document);
  assertFails(tweak(commit.document, (draft) => { draft.scenes[0].tracks.main.transitions[0].duration = 4000; }), "document/out-of-range", "/transitions/@t1/duration");
  assertFails(tweak(commit.document, (draft) => { draft.scenes[0].tracks.main.transitions[0].type = "page-curl"; }), "document/unknown-definition");
});

test("Track transition records — Scenario: Audio crossfade record", () => {
  const before = put(studio(), "t-audio", audio("a", 0, 2), audio("b", 2, 2));
  const commit = addCrossfade(before, context({ newId: () => "x1" }), "a", "b");
  assert.deepEqual(track(commit.document, "t-audio").transitions, [{ id: "x1", kind: "crossfade", fromElementId: "a", toElementId: "b", duration: 60_000, shape: "equal-power" }]);
  assertValid(commit.document);
  // A crossfade carries duration and shape only, and lives on audio tracks only.
  assertFails(tweak(commit.document, (draft) => { draft.scenes[0].tracks.audio[0].transitions[0].easing = "linear"; }), "document/field-not-allowed", "/easing");
  assertFails(tweak(addTransition(pair(), context({ newId: () => "t1" }), "a", "b", "dissolve").document, (draft) => {
    draft.scenes[0].tracks.main.transitions[0] = { id: "t1", kind: "crossfade", fromElementId: "a", toElementId: "b", duration: 60_000, shape: "equal-power" };
  }), "document/field-not-allowed", "/transitions/@t1/kind");
  assertFails(tweak(studio(), (draft) => { draft.scenes[0].tracks.audio[0].crossfades = []; }), "document/field-not-allowed", "/crossfades");
});

test("Track transition records — Scenario: Orphan reference", () => {
  const error = assertFails(tweak(pair(), (draft) => { draft.scenes[0].tracks.main.elements[0].transitionOut = "t9"; }), "document/transition-ref-mismatch");
  assert.equal(error.path, "/scenes/@s1/tracks/main/elements/@a/transitionOut");
  const joined = addTransition(pair(), context({ newId: () => "t1" }), "a", "b", "dissolve").document;
  assertFails(tweak(joined, (draft) => { draft.scenes[0].tracks.main.elements[1].transitionIn = null; }), "document/transition-ref-mismatch", "/transitions/@t1");
  assertFails(tweak(joined, (draft) => { draft.scenes[0].tracks.main.elements[1].startTime = 3 * SECOND; }), "document/transition-not-adjacent");
});

test("Track transition records — Scenario: Moving a clip removes its transition", () => {
  const joined = addTransition(pair(), context({ newId: () => "t1" }), "a", "b", "dissolve").document;
  const commit = moveElement(joined, context(), "b", 3 * SECOND);
  assert.deepEqual(track(commit.document, "t-main").transitions, []);
  assert.equal(element(commit.document, "a").transitionOut, null);
  assert.equal(element(commit.document, "b").transitionIn, null);
  assert.equal(commit.history, true, "one undo step");
  assert.ok(commit.patch.some((entry) => entry.op === "remove" && entry.path === "/scenes/@s1/tracks/main/transitions/@t1"));
});

// Requirement: Track and element ordering
test("Track and element ordering — Scenario: Insert keeps the sort", () => {
  const before = put(studio(), "main", video("first", 0, 2), video("last", 5, 2));
  const after = insertElement(before, context(), "t-main", { type: "video", id: "mid", name: "mid", startTime: 2 * SECOND, duration: 2 * SECOND, mediaId: "a1", sourceDuration: 2 * SECOND }).document;
  assert.deepEqual(track(after, "t-main").elements.map((entry: any) => entry.id), ["first", "mid", "last"]);
  assertFails(tweak(before, (draft) => { draft.scenes[0].tracks.main.elements.reverse(); }), "document/elements-unsorted", "/tracks/main/elements");
});

test("Track and element ordering — Scenario: Overlap rejected", () => {
  const error = assertFails(put(studio(), "main", video("a", 0, 3), video("b", 2, 3)), "document/elements-overlap");
  assert.equal(error.path, "/scenes/@s1/tracks/main/elements/@b");
  rejected(() => moveElement(pair(), context(), "b", 1 * SECOND), "document/elements-overlap");
});

test("Track and element ordering — Scenario: Touching is valid", () => {
  assertValid(put(studio(), "main", video("a", 0, 3), video("b", 3, 2)));
  assert.equal(element(put(studio(), "main", video("a", 0, 3), video("b", 3, 2)), "b").startTime, 360_000);
});

// Requirement: Element common fields
test("Element common fields — Scenario: Group of one", () => {
  assertFails(put(studio(), "main", video("a", 0, 2, { groupId: "g1" })), "document/group-invalid", "/elements/@a/groupId");
  assertValid(put(studio(), "main", video("a", 0, 2, { groupId: "g1" }), video("b", 2, 2, { groupId: "g1" })));
});

test("Element common fields — Scenario: Link of three", () => {
  const linked = put(put(studio(), "main", video("v", 0, 2, { linkId: "L1" }), video("w", 2, 2, { linkId: "L1" })), "t-audio", audio("s", 0, 2, { linkId: "L1" }));
  assertFails(linked, "document/link-invalid");
  // Exactly one sound and one picture: two video elements do not form a link.
  assertFails(put(studio(), "main", video("v", 0, 2, { linkId: "L2" }), video("w", 2, 2, { linkId: "L2" })), "document/link-invalid");
  assertValid(put(put(studio(), "main", video("v", 0, 2, { linkId: "L3" })), "t-audio", audio("s", 0, 2, { linkId: "L3" })));
});

test("Element common fields — Scenario: Trim beyond the source", () => {
  assertFails(put(studio(), "main", video("a", 0, 2, { sourceDuration: 600_000, trimStart: 400_000, trimEnd: 300_000 })), "document/time-out-of-bounds", "/elements/@a");
  assertFails(put(studio(), "t-text", text("x", 0, 2, { trimStart: 4000 })), "document/out-of-range", "/trimStart");
  assertFails(put(studio(), "main", { ...video("late"), startTime: 10_368_000_000 - SECOND, duration: 2 * SECOND }), "document/time-out-of-bounds");
});

test("Element common fields — Scenario: Params map on a video element", () => {
  const error = assertFails(put(studio(), "main", { ...video("a"), params: { opacity: 0.5 } }), "document/field-not-allowed");
  assert.equal(error.path, "/scenes/@s1/tracks/main/elements/@a/params");
  for (const key of ["zone", "trackId", "order"]) assertFails(put(studio(), "main", { ...video("a"), [key]: "x" }), "document/field-not-allowed", `/${key}`);
  assertFails(put(studio(), "main", { ...video("a"), name: "" }), "document/out-of-range", "/name");
});

// Requirement: Element types and field applicability
test("Element types and field applicability — Scenario: Mask on a text element", () => {
  assertFails(put(studio(), "t-text", { ...text("x"), masks: [] }), "document/field-not-allowed", "/elements/@x/masks");
  for (const [make, key] of [[() => text("x"), "crop"], [() => text("x"), "clipAnimation"], [() => audio("x"), "hidden"], [() => audio("x"), "transform"], [() => image("x"), "retime"], [() => image("x"), "volume"]] as const) {
    const trackId = make().type === "text" ? "t-text" : make().type === "audio" ? "t-audio" : "main";
    assertFails(put(studio(), trackId, { ...make(), [key]: key === "hidden" ? false : {} }), "document/field-not-allowed", `/${key}`);
  }
  for (const type of ["filter", "slate", "multicam", "freeze", "drawing"]) assertFails(put(studio(), "main", { ...video("a"), type }), "document/wrong-type", "/type");
});

test("Element types and field applicability — Scenario: Standalone filter", () => {
  const ctx = context();
  const after = addEffectLayer(studio(), ctx, "t-effect", { type: "warm-film", kind: "filter" }, { startTime: 0, duration: 3 * SECOND }).document;
  const layer = track(after, "t-effect").elements[0];
  assert.equal(layer.type, "effect");
  assert.deepEqual(layer.effects.map(({ id: _id, ...rest }: any) => rest), [{ type: "warm-film", kind: "filter", enabled: true, params: { intensity: 100 } }]);
  assert.equal(typeof layer.effects[0].id, "string");
  assertValid(after);
});

test("Element types and field applicability — Scenario: Chroma key on a sticker", () => {
  assertFails(put(studio(), "t-graphic", { ...sticker("k"), chromaKey: { enabled: true } }), "document/field-not-allowed", "/elements/@k/chromaKey");
  assertValid(put(studio(), "main", video("v", 0, 2, { chromaKey: { enabled: true } })));
});

// Requirement: Video element
test("Video element — Scenario: Freeze element shape", () => {
  const before = put(studio(), "main", video("src", 0, 4, { sourceDuration: 4 * SECOND }));
  const after = freezeFrame(before, context({ newId: () => "fz" }), "src", 300_000, { trackId: "t-main", startTime: 4 * SECOND }).document;
  const frozen = element(after, "fz");
  assert.deepEqual([frozen.type, frozen.mediaId, frozen.freeze, frozen.duration], ["video", "a1", { mediaId: "a1", sourceTime: 300_000 }, 360_000]);
  assert.equal("retime" in frozen, false);
  assert.equal("sourceDuration" in frozen, false);
  assert.deepEqual([frozen.trimStart, frozen.trimEnd], [0, 0]);
  assertValid(after);
});

test("Video element — Scenario: Freeze with retime", () => {
  const frozen = video("fz", 0, 3, { sourceDuration: undefined, freeze: { mediaId: "a1", sourceTime: 300_000 } });
  assertValid(put(studio(), "main", frozen));
  assertFails(put(studio(), "main", { ...frozen, retime: { rate: 2 } }), "document/field-not-allowed", "/elements/@fz/retime");
  assertFails(put(studio(), "main", { ...frozen, freeze: { sourceTime: 300_000 } }), "document/missing-field", "/freeze/mediaId");
});

test("Video element — Scenario: Upscale and revert", () => {
  const before = tweak(put(studio(), "main", video("v", 0, 2)), (draft) => { draft.media.assets.push(asset("a9", "video", { width: 3840, height: 2160 })); });
  const upscaled = setProcessedSource(before, context(), "v", "upscale", "a9", { sourceStart: 0, sourceEnd: 2 * SECOND }).document;
  assert.equal(element(upscaled, "v").mediaId, "a9");
  assert.deepEqual(element(upscaled, "v").processedSource, { originalMediaId: "a1", tool: "upscale", sourceStart: 0, sourceEnd: 2 * SECOND });
  assertValid(upscaled);
  const reverted = revertProcessedSource(upscaled, context(), "v").document;
  assert.equal(element(reverted, "v").mediaId, "a1");
  assert.equal("processedSource" in element(reverted, "v"), false);
});

// Requirement: Image element and slate clips
const scriptLink = { scriptId: "sc1", sceneId: "scene-1", shotId: "shot-1", versionId: "ver-1", syncedHash: HASH("b") };
const slateProject = () => {
  const withSlate = addAsset(studio(), context({ newId: () => "folder-slates" }), { id: "sl1", name: "Shot 1", type: "image", kind: "slate", size: 0, width: 1920, height: 1080, provenance: { source: "slate", scriptId: "sc1", sceneId: "scene-1", shotId: "shot-1", versionId: "ver-1" } }).document;
  return insertElement(withSlate, context(), "t-main", { type: "image", id: "shot", name: "Shot 1", startTime: 0, duration: 3 * SECOND, mediaId: "sl1", scriptLink }).document;
};

test("Image element and slate clips — Scenario: Slate clip", () => {
  const doc = slateProject();
  const clip = element(doc, "shot");
  assert.equal(clip.type, "image");
  assert.equal(doc.media.assets.find((entry) => entry.id === clip.mediaId)!.kind, "slate");
  assert.deepEqual(clip.scriptLink, scriptLink);
  assert.equal("sourceDuration" in clip, false);
  assertValid(doc);
});

test("Image element and slate clips — Scenario: Slate replaced by video", () => {
  const before = tweak(slateProject(), (draft) => { draft.media.assets.push(asset("clip4", "video", { duration: 4 * SECOND })); draft.media.assets.sort((a: any, b: any) => (a.id < b.id ? -1 : 1)); });
  const after = replaceMedia(before, context(), "shot", "clip4").document;
  const clip = element(after, "shot");
  assert.equal(clip.id, "shot");
  assert.deepEqual(clip.scriptLink, scriptLink);
  assert.equal(clip.type, "video");
  assert.deepEqual([clip.sourceDuration, clip.volume, clip.muted, clip.pan, clip.isSourceAudioEnabled], [4 * SECOND, 0, false, 0, true]);
  assert.deepEqual([clip.startTime, clip.duration, clip.trimEnd], [0, 3 * SECOND, SECOND]);
  assertValid(after);
});

test("Image element and slate clips — Scenario: Audio asset on an image element", () => {
  assertFails(put(studio(), "main", image("i", 0, 2, { mediaId: "a3" })), "document/asset-type-mismatch", "/elements/@i/mediaId");
  assertFails(put(studio(), "main", image("i", 0, 2, { mediaId: "missing" })), "document/unknown-asset");
  assertFails(put(studio(), "main", { ...image("i"), sourceDuration: 4000 }), "document/field-not-allowed", "/sourceDuration");
});

// Requirement: Audio element (extraction shares this file's fixtures)
test("Audio element — Scenario: Extracted audio", () => {
  const before = tweak(put(studio(), "main", video("v", 0, 2)), (draft) => { draft.media.assets.push(asset("v1", "video")); draft.scenes[0].tracks.main.elements[0].mediaId = "v1"; });
  const after = extractAudio(before, context(), "v").document;
  const sound = track(after, "t-audio").elements[0];
  assert.deepEqual([sound.type, sound.sourceType, sound.mediaId], ["audio", "upload", "v1"]);
  assert.equal(typeof sound.linkId, "string");
  assert.equal(sound.linkId, element(after, "v").linkId);
  assertValid(after);
});
