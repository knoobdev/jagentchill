// Review A4: a button of the export failure view either starts a real retry or is not there. `shownFailureActions` is
// what the view draws (apps/app/src/editor/export/JobViews.tsx `JobFailure`), `failureRetrySettings` is what the codec /
// resolution retries export with — in the editor's dialog AND in the Exports screen's job dialog, which had no handler.
// That the retry really produces a job is seen in the browser run (apps/app/e2e/agent-import.mjs).
import assert from "node:assert/strict";
import { test } from "node:test";
import { exporting as x } from "../src/index.ts";

const settings = { ...x.DEFAULT_EXPORT_SETTINGS };
const ids = (code: string, context: Parameters<typeof x.failureActions>[1]) => x.shownFailureActions(x.failureActions({ code } as never, context)).map((action) => action.id);

test("review A4: \"Retry on host\" is not drawn — no build of this product can hand an export to a host yet, whatever the host advertises", () => {
  assert.ok(x.failureActions({ code: "export/no-gpu" }, { hostCanExport: true }).some((action) => action.id === "retry-on-host"), "the spec's table still lists it");
  assert.deepEqual(ids("export/no-gpu", { hostCanExport: true }), ["retry", "retry-same-snapshot", "copy-details"]);
  assert.deepEqual(ids("media/unavailable", { hostCanExport: true }), ["retry", "retry-same-snapshot", "copy-details"]);
  // A host job's failure offered "Open host diagnostics", which only closed the dialog.
  assert.deepEqual(ids("FFMPEG_UNAVAILABLE", { hostCanExport: true }), ["retry", "retry-same-snapshot", "copy-details"]);
});

test("export finalising timeout — the failure explains the 60-second stall and offers Retry", () => {
  assert.deepEqual(x.failureSentence({ code: "export/finalising-timeout" }), {
    message: "Export finalising did not make progress for 60 seconds. Retry the export.",
  });
  assert.deepEqual(ids("export/finalising-timeout", { hostCanExport: false }), ["retry", "retry-same-snapshot", "copy-details"]);
});

test("review A4: the codec and the resolution retries are drawn and change exactly what their label says", () => {
  assert.deepEqual(ids("export/encoder-error", { hostCanExport: false, otherCodec: "H.264" }), ["retry", "retry-same-snapshot", "try-h264", "copy-details"]);
  assert.deepEqual(ids("export/out-of-memory", { hostCanExport: false, lowerResolution: "1080p" }), ["retry", "retry-same-snapshot", "lower-resolution", "copy-details"]);
  const vp9 = { ...settings, videoCodec: "vp9" as const, container: "webm" as const };
  const h264 = x.failureRetrySettings(vp9, "try-h264");
  assert.deepEqual([h264.videoCodec, h264.container], ["h264", "mp4"], "H.264 does not go into WebM");
  assert.deepEqual({ ...h264, videoCodec: vp9.videoCodec, container: vp9.container }, vp9, "nothing else changes");
  const hevc = x.failureRetrySettings({ ...settings, videoCodec: "hevc" as const, container: "mov" as const }, "try-h264");
  assert.deepEqual([hevc.videoCodec, hevc.container], ["h264", "mov"]);
  const big = { ...settings, resolution: { ...settings.resolution, mode: "2160p" as const } };
  const lower = x.failureRetrySettings(big, "lower-resolution");
  assert.equal(lower.resolution.mode, "1440p");
  assert.deepEqual({ ...lower, resolution: big.resolution }, big);
  // The label the button carries is the size the retry uses.
  assert.equal(x.RESOLUTION_LABELS[x.lowerResolutionOf(big)!], x.RESOLUTION_LABELS["1440p"]);
  assert.equal(x.lowerResolutionOf({ ...settings, resolution: { ...settings.resolution, mode: "480p" as const } }), null, "nothing below the smallest size: no button");
  assert.equal(x.lowerResolutionOf({ ...settings, resolution: { ...settings.resolution, mode: "project" as const } }), "480p", "from the project's own size the retry goes to the smallest named size, as before");
});

test("w7 item 8: a failure the engine names only by id (\"asset a1 has no source on this device\") tells the person WHICH clip or file — the names come from the exported document", () => {
  const document = {
    media: { assets: [{ id: "a1", name: "beach-drone.mp4" }, { id: "a2", name: "song.wav" }, { id: "a3", name: "unused.png" }] },
    scenes: [{ tracks: { overlay: [{ elements: [] }], main: { elements: [{ id: "e1", name: "Beach", mediaId: "a1" }, { id: "e2", name: "Title" }] }, audio: [{ elements: [{ id: "e3", name: "Song", mediaId: "a2" }] }] } }],
  };
  // By asset id (the engine: `asset <id> has no source on this device`).
  const byAsset = x.namedFailure({ code: "media/unavailable", message: "asset a1 has no source on this device", details: { assetId: "a1" } }, document);
  assert.deepEqual(x.failedClips(byAsset), [{ elementId: "e1", assetId: "a1", elementName: "Beach", assetName: "beach-drone.mp4" }]);
  const said = x.failureSentence(byAsset);
  assert.match(said.message.replace(/\{(\w+)\}/g, (_all, key: string) => String(said.values?.[key])), /^The clip “beach-drone\.mp4” could not be drawn/);
  // By element id (`the source frame of the element is unavailable`).
  assert.equal(x.failedClips(x.namedFailure({ code: "media/unavailable", message: "x", details: { elementId: "e3" } }, document))[0]?.assetName, "song.wav");
  // A file no clip uses: the file is named.
  const file = x.failureSentence(x.namedFailure({ code: "media/unavailable", message: "x", details: { assetId: "a3" } }, document));
  assert.deepEqual([/^The file “\{file\}” could not be exported/.test(file.message), file.values], [true, { file: "unused.png" }]);
  // Old behaviour, kept only when nothing can be named: the general sentence — and never the engine's words or a code.
  assert.deepEqual(x.failureSentence({ code: "media/unavailable", details: { assetId: "a1" } }), { message: "A media file is missing" });
  // A failure that already names its clips is not touched.
  const named = { code: "media/unavailable" as const, message: "x", details: { clips: [{ elementId: "e9", assetName: "kept.mp4" }] } };
  assert.equal(x.namedFailure(named, document), named);
});
