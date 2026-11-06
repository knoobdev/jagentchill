// "Export anyway" for ONE missing picture must not silence a sound nobody mentioned (review A3). The sound here is a
// REAL file: an MP4 with an H.264 picture and an AC-3 sound track made by ffmpeg — the reviewer's file; no runtime this
// engine runs in decodes AC-3. It is read through the real reader (mediabunny's URL source) by the same `AudioSources`
// the engine builds for an export, with the same waiver rule (`engine/waiver.ts`). The engine's frame loop itself needs a
// GPU and is exercised in the browser run (`apps/app/e2e/agent-import.mjs`).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { INTERNAL_SAMPLE_RATE } from "../src/audio/gain.ts";
import { AudioSourceError, AudioSources } from "../src/audio/source.ts";
import { mediaWaived, type MediaWaiver } from "../src/engine/waiver.ts";

let work: string, talk: string;
before(() => {
  work = mkdtempSync(join(tmpdir(), "jc-waived-"));
  const file = join(work, "talk.mp4");
  execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=10", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "ac3", file]);
  assert.match(execFileSync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name", "-of", "csv=p=0", file]).toString(), /ac3/);
  talk = `data:video/mp4;base64,${readFileSync(file).toString("base64")}`;
});
after(() => rmSync(work, { recursive: true, force: true }));

const BLOCK = INTERNAL_SAMPLE_RATE / 10;
const peak = (block: [Float32Array, Float32Array]) => Math.max(...block[0].map(Math.abs), ...block[1].map(Math.abs));
/** The sounds of an export, built the way `engine.ts runExport` builds them. `harbour` is the missing picture's asset; `talk` the AC-3 video. */
const exportSounds = (request: MediaWaiver) => new AudioSources((assetId) => (assetId === "talk" ? talk : undefined), { missing: "fail", waived: (assetId) => mediaWaived(request, assetId) });

test("review A3: Export anyway for one missing picture (waived by name) + a video whose AC-3 sound cannot be decoded — the export FAILS by the sound's asset, it is not written silent", async () => {
  const sources = exportSounds({ allowMissingMedia: true, waivedAssetIds: ["harbour"] });
  try {
    await assert.rejects(async () => sources.read("talk", 0, BLOCK), (error: unknown) => error instanceof AudioSourceError && error.assetId === "talk" && error.reason === "undecodable");
    // Asked again (the next block, a retry): the same answer — never zeros.
    await assert.rejects(async () => sources.read("talk", BLOCK, BLOCK), AudioSourceError);
    // A sound nobody waived whose file is not here at all fails by its name too.
    await assert.rejects(async () => sources.read("song", 0, BLOCK), (error: unknown) => error instanceof AudioSourceError && error.assetId === "song" && error.reason === "missing");
  } finally { sources.dispose(); }
});

test("review A3: the media the person was shown by name and waived IS left out — a waived missing sound and the waived AC-3 sound are silence, and only they", async () => {
  const sources = exportSounds({ allowMissingMedia: true, waivedAssetIds: ["harbour", "talk", "gone"] });
  try {
    assert.equal(peak(await sources.read("talk", 0, BLOCK)), 0);
    assert.equal(peak(await sources.read("gone", 0, BLOCK)), 0);
    await assert.rejects(async () => sources.read("song", 0, BLOCK), AudioSourceError);
  } finally { sources.dispose(); }
});

test("the waiver rule: nothing is left out without Export anyway; with it only the named assets; a request that names none (no pre-flight) leaves out whatever is missing", () => {
  assert.equal(mediaWaived({}, "a"), false);
  assert.equal(mediaWaived({ waivedAssetIds: ["a"] }, "a"), false, "a list without the waiver waives nothing");
  assert.deepEqual(["a", "b", undefined].map((assetId) => mediaWaived({ allowMissingMedia: true, waivedAssetIds: ["a"] }, assetId)), [true, false, false]);
  assert.equal(mediaWaived({ allowMissingMedia: true, waivedAssetIds: [] }, "a"), false);
  assert.deepEqual(["a", undefined].map((assetId) => mediaWaived({ allowMissingMedia: true }, assetId)), [true, true]);
});

test("what the engine did before (silence for every sound once anything was waived): the AC-3 sound came back as zeros — kept here as the contrast", async () => {
  const before = new AudioSources((assetId) => (assetId === "talk" ? talk : undefined), { missing: "silence" });
  try { assert.equal(peak(await before.read("talk", 0, BLOCK)), 0); } finally { before.dispose(); }
});
