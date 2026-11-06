// Review A3, the part before the engine: the pre-flight names a VIDEO whose sound this device cannot decode (it used to
// check a video's picture only), and "Export anyway" waives exactly the media the person was shown by name — the asset
// ids that go to the engine as `waivedAssetIds`. Pure functions over a small document; the engine's side is
// packages/render/test/re-20-export-waived-media.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { exporting as x } from "../src/index.ts";

const T = 120_000;
const el = (id: string, patch: Record<string, unknown> = {}) => ({ id, name: id, type: "video", startTime: 0, duration: T, mediaId: `asset-${id}`, ...patch });
const docOf = (elements: ReturnType<typeof el>[]): x.PreflightDocument => ({
  scenes: [{ id: "s", tracks: { overlay: [], main: { id: "m", type: "video", elements }, audio: [] } }],
  media: { assets: elements.map((element) => ({ id: String(element.mediaId), name: element.id, type: element.type === "audio" ? "audio" : element.type === "image" ? "image" : "video" })) },
});
const flight = (document: x.PreflightDocument, patch: Partial<x.PreflightInput> = {}) => x.runPreflight({ document, sceneId: "s", range: { start: 0, end: T }, frameTicks: 4000, target: "device", platform: "web", ...patch });

test("a video's sound is looked at too: what the device learnt of it decides", () => {
  assert.equal(x.deviceSoundState({ type: "video", hasAudio: true }, { canDecodeSound: false }), "undecodable");
  assert.equal(x.deviceSoundState({ type: "video" }, { canDecodeSound: false }), "undecodable");
  for (const local of [undefined, {}, { canDecodeSound: null }, { canDecodeSound: true }]) assert.equal(x.deviceSoundState({ type: "video", hasAudio: true }, local), "ok");
  assert.equal(x.deviceSoundState({ type: "video", hasAudio: false }, { canDecodeSound: false }), "ok", "a video without a sound track has no sound to lose");
  assert.equal(x.deviceSoundState({ type: "image" }, { canDecodeSound: false }), "ok");
});

test("review A3: one missing picture + a video whose sound cannot be decoded — the pre-flight names BOTH, each in its own words", () => {
  const document = docOf([el("harbour.jpg", { type: "image" }), el("talk.mp4"), el("fine.mp4")]);
  const result = flight(document, { mediaState: (assetId) => (assetId === "asset-harbour.jpg" ? "missing" : "ready"), soundState: (assetId) => (assetId === "asset-talk.mp4" ? "undecodable" : "ok") });
  const sound = result.blocking.find((item) => item.id === "media-undecodable-sound")!, missing = result.blocking.find((item) => item.id === "media-missing")!;
  assert.deepEqual([sound.message, sound.names, sound.elementIds, sound.code, sound.waiver], ["1 sound cannot be decoded on this device", ["talk.mp4"], ["talk.mp4"], "media/unavailable", "allowMissingMedia"]);
  assert.deepEqual([missing.message, missing.names], ["1 clip uses a missing media file", ["harbour.jpg"]]);
  assert.equal(result.blocking.length, 2);
  // What "Export anyway" then waives: these two assets by id, and nothing else of the project.
  assert.deepEqual(x.waivedMediaAssets(result, document).sort(), ["asset-harbour.jpg", "asset-talk.mp4"]);
});

test("a video whose sound is switched off or muted loses nothing: it is not named", () => {
  const document = docOf([el("silent.mp4", { isSourceAudioEnabled: false }), el("muted.mp4", { muted: true })]);
  assert.equal(flight(document, { soundState: () => "undecodable" }).ok, true);
});

test("review A3: Export anyway waives ONLY what was shown — before the device knew of the sound, the waiver names the picture alone", () => {
  // The dialog as the person saw it: only the missing picture was listed (the sound of talk.mp4 was not known to be undecodable).
  const document = docOf([el("harbour.jpg", { type: "image" }), el("talk.mp4"), el("song.mp3", { type: "audio" })]);
  const shown = flight(document, { mediaState: (assetId) => (assetId === "asset-harbour.jpg" ? "missing" : "ready") });
  assert.deepEqual(shown.blocking.map((item) => item.names), [["harbour.jpg"]]);
  assert.deepEqual(x.exportAnyway(shown), { allowMissingMedia: true });
  assert.deepEqual(x.waivedMediaAssets(shown, document), ["asset-harbour.jpg"], "talk.mp4 and song.mp3 are not waived: the engine fails by their name if their sound cannot be had");
  // Items of other rows (a font, a slate) name no media.
  const fonts = flight(docOf([el("title", { type: "text", fontFamily: "Nope", mediaId: undefined })]), { fontState: () => "unavailable" });
  assert.deepEqual(x.waivedMediaAssets(fonts, docOf([])), []);
  assert.deepEqual(x.waivedMediaAssets(null, document), []);
});
