import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PROXY_H264_CODEC_STRINGS, automaticProxyReason, decodeTestRange, exportSource, localExportBlockers, message, mezzanineSpec, previewSource, proxyCacheKey, proxyDecimation, proxyFrameForSourceFrame,
  proxyFrameForSourceTime, proxyFrameRate, proxyJob, proxySpec, proxyTargetSize, proxyTransition, proxyVideoBitrate, resolveUndecodableProxy, selectProxyProducer, sha256Hex, stillMezzanineSpec, verifyProxyBytes,
  type AssetPlayback, type ProxyState,
} from "../src/index.ts";
import { HASH, SECOND } from "./support/project.ts";

const fps = (numerator: number, denominator = 1) => ({ numerator, denominator });
const ALL = { h264: true, aac: true, vp9: true, opus: true };
const local = (over: Partial<AssetPlayback> = {}): AssetPlayback => ({ canDecode: true, proxy: { state: "none" }, present: { original: true, proxy: false, mezzanine: false }, ...over });

test("Automatic proxy for 4K: a 3840 × 2160, 30 fps video gets a 1280 × 720, 30 fps proxy, H.264 + AAC in MP4 where the device has both encoders", () => {
  const video = { width: 3840, height: 2160, fps: fps(30), canDecode: true };
  assert.equal(automaticProxyReason(video), "resolution");
  const producer = selectProxyProducer({ encoders: ALL, sourceDecodes: true, hostConnected: false });
  assert.deepEqual(producer, { producer: "device", form: "mp4" });
  const spec = proxySpec({ ...video, hasAudio: true }, "mp4");
  assert.deepEqual([spec.width, spec.height, spec.fps, spec.container, spec.videoCodec, spec.audioCodec], [1280, 720, fps(30), "mp4", "h264", "aac"]);
  assert.deepEqual([spec.videoBitrate, spec.keyFrameIntervalSeconds, spec.pixelFormat, spec.bitDepth], [4_000_000, 1, "yuv420p", 8]);
  assert.deepEqual(spec.audio, { bitrate: 128_000, channels: 2, sampleRate: "source" });
  // High, then Main, then Constrained Baseline.
  assert.deepEqual(spec.videoCodecStrings.map((codec) => codec.slice(5, 7)), ["64", "4d", "42"]);
  assert.equal(PROXY_H264_CODEC_STRINGS.length, 3);
  // The card shows progress, then the "Proxy" badge; the chosen form is recorded in the device-local entry.
  let state: ProxyState = { state: "none" };
  state = proxyTransition(state, { type: "queue" }); assert.equal(state.state, "queued");
  state = proxyTransition(state, { type: "progress", fraction: 0.4 }); assert.equal(state.state, "running");
  state = proxyTransition(state, { type: "succeed", form: "mp4", size: 1234, sha256: HASH("a") });
  assert.deepEqual(state, { state: "succeeded", size: 1234, sha256: HASH("a"), container: "mp4", videoCodec: "h264", audioCodec: "aac" });
  assert.equal(message("media.proxy.badge").text, "Proxy");
});

test("Portrait source: a 2160 × 3840 portrait video is proxied at 720 × 1280", () => {
  assert.deepEqual(proxyTargetSize({ width: 2160, height: 3840 }), { width: 720, height: 1280 });
  assert.deepEqual(proxyTargetSize({ width: 3840, height: 2160 }), { width: 1280, height: 720 });
  assert.deepEqual(proxyTargetSize({ width: 2000, height: 2000 }), { width: 720, height: 720 });
  // Even dimensions, never upscaled.
  assert.deepEqual(proxyTargetSize({ width: 641, height: 361 }), { width: 640, height: 360 });
  assert.deepEqual(proxyTargetSize({ width: 2048, height: 858 }), { width: 1280, height: 536 });
});

test("60 fps source keeps every frame: the proxy has the source's frame count and source frame 37 shows proxy frame 37", () => {
  assert.equal(proxyDecimation(fps(60)), 1);
  assert.deepEqual(proxyFrameRate(fps(60)), fps(60));
  assert.equal(proxyFrameForSourceFrame(37, 1), 37);
  assert.equal(proxyFrameForSourceTime(37 * (SECOND / 60), fps(60)), 37);
  assert.equal(proxyFrameForSourceTime(37 * (SECOND / 60) + 1999, fps(60)), 37);
  assert.equal(proxyDecimation(fps(60000, 1001)), 1);
  // Bitrate: 4 Mbit/s at 30 fps or below, linear to 8 Mbit/s at 60; the webm form uses 80 %.
  assert.equal(proxyVideoBitrate(fps(24), "mp4"), 4_000_000);
  assert.equal(proxyVideoBitrate(fps(45), "mp4"), 6_000_000);
  assert.equal(proxyVideoBitrate(fps(60), "mp4"), 8_000_000);
  assert.equal(proxyVideoBitrate(fps(60), "webm"), 6_400_000);
  assert.equal(proxyVideoBitrate(fps(30), "webm"), 3_200_000);
});

test("120 fps source: the proxy is 60 fps holding every second source frame; an odd source frame shows the proxy frame with the greatest timestamp not after it", () => {
  assert.equal(automaticProxyReason({ width: 1920, height: 1080, fps: fps(120), canDecode: true }), "frame-rate");
  assert.equal(proxyDecimation(fps(120)), 2);
  assert.deepEqual(proxyFrameRate(fps(120)), fps(60));
  assert.deepEqual([0, 1, 2, 3, 74, 75].map((frame) => proxyFrameForSourceFrame(frame, 2)), [0, 0, 1, 1, 37, 37]);
  // Source time on odd frame 75 (0.625 s): proxy frame 37, whose timestamp 74 / 120 s is the greatest one not after it.
  assert.equal(proxyFrameForSourceTime(75 * (SECOND / 120), fps(120)), 37);
  assert.equal(proxyDecimation(fps(240)), 4);
  assert.equal(proxyDecimation(fps(100)), 2);
  assert.deepEqual(proxyFrameRate(fps(100)), fps(50));
  assert.equal(proxySpec({ width: 1920, height: 1080, fps: fps(120) }, "mp4").videoBitrate, 8_000_000);
});

test("Slow decode test: a 1920 × 1080, 30 fps AV1 file that decodes its 60 test frames at 21 fps gets a proxy automatically", () => {
  assert.equal(automaticProxyReason({ width: 1920, height: 1080, fps: fps(30), canDecode: true, decodeTestFps: 21 }), "slow-decode");
  assert.equal(automaticProxyReason({ width: 1920, height: 1080, fps: fps(30), canDecode: true, decodeTestFps: 95 }), null);
  // 60 frames starting at 1 s, or the whole file when it is shorter.
  assert.deepEqual(decodeTestRange(10 * SECOND, fps(30)), { start: SECOND, frames: 60 });
  assert.deepEqual(decodeTestRange(2 * SECOND, fps(30)), { start: 0, frames: 60 });
  assert.deepEqual(decodeTestRange(1 * SECOND, fps(25)), { start: 0, frames: 25 });
});

test("Export uses the original: export reads the original of a proxied clip; preview reads the proxy", () => {
  const proxied = local({ proxy: { state: "succeeded", size: 1, sha256: HASH("a"), container: "mp4", videoCodec: "h264", audioCodec: "aac" }, present: { original: true, proxy: true, mezzanine: false } });
  assert.equal(previewSource(proxied, true), "proxy");
  assert.equal(exportSource(proxied), "original");
  // "Use proxies for preview" off: the player reads the original.
  assert.equal(previewSource(proxied, false), "original");
  // Undecodable original: the mezzanine is used for export, and the Gateway when there is none.
  assert.equal(exportSource(local({ canDecode: false, present: { original: true, proxy: false, mezzanine: true } })), "mezzanine");
  assert.equal(exportSource(local({ canDecode: false })), "host");
  assert.equal(previewSource(local({ canDecode: false }), true), "placeholder");
});

test("Export blocked: a clip of an undecodable asset without proxy blocks local export with a message naming the asset", () => {
  const assets = [{ id: "a1", name: "drone.mov" }, { id: "a2", name: "ok.mp4" }, { id: "a3", name: "gone.mp4" }, { id: "a4", name: "unused-hevc.mov" }];
  const locals = { a1: local({ canDecode: false }), a2: local(), a3: local({ present: { original: false, proxy: false, mezzanine: false } }), a4: local({ canDecode: false }) };
  const blockers = localExportBlockers(assets, locals, ["a1", "a2", "a3"]);
  assert.deepEqual(blockers, { undecodable: ["drone.mov"], offline: ["gone.mp4"] });
  assert.match(message("media.export-blocked.undecodable", { names: blockers.undecodable.join(", ") }).text, /drone\.mov/);
  assert.match(message("media.export-blocked.offline", { names: blockers.offline.join(", ") }).text, /gone\.mp4/);
});

test("Corrupted proxy from another device: a proxy that does not match its recorded SHA-256 is never used", () => {
  const bytes = Uint8Array.from([1, 2, 3, 4]);
  assert.equal(verifyProxyBytes(bytes, { size: 4, sha256: sha256Hex(bytes) }), true);
  assert.equal(verifyProxyBytes(Uint8Array.from([1, 2, 3, 5]), { size: 4, sha256: sha256Hex(bytes) }), false);
  assert.equal(verifyProxyBytes(bytes, { size: 5, sha256: sha256Hex(bytes) }), false);
  assert.equal(verifyProxyBytes(bytes, {}), false);
  assert.equal(proxyCacheKey(HASH("a"), "webm"), `proxy/${HASH("a")}.webm`);
});

test("Proxy job failure: the card shows \"Proxy failed\" with Retry and the asset keeps previewing from the original", () => {
  let state: ProxyState = proxyTransition({ state: "running" }, { type: "fail" });
  assert.deepEqual(state, { state: "failed" });
  assert.equal(message("media.proxy.failed").text, "Proxy failed");
  assert.equal(message("media.proxy.retry").text, "Retry");
  assert.equal(previewSource(local({ proxy: state }), true), "original");
  state = proxyTransition(state, { type: "retry" });
  assert.equal(state.state, "queued");
  assert.equal(proxyTransition({ state: "running" }, { type: "cancel" }).state, "cancelled");
  // A late progress report does not revive a cancelled job; "Delete proxy" returns to none.
  assert.equal(proxyTransition({ state: "cancelled" }, { type: "progress", fraction: 0.9 }).state, "cancelled");
  assert.deepEqual(proxyTransition({ state: "succeeded", size: 1, sha256: HASH("a") }, { type: "delete" }), { state: "none" });
});

test("Portrait 1080p phone clip gets no automatic proxy: 1080 × 1920 at 30 fps that passes the decode test plays the original", () => {
  assert.equal(automaticProxyReason({ width: 1080, height: 1920, fps: fps(30), canDecode: true, decodeTestFps: 120 }), null);
  assert.equal(automaticProxyReason({ width: 1920, height: 1080, fps: fps(30), canDecode: true, decodeTestFps: 120 }), null);
  assert.equal(automaticProxyReason({ width: 1920, height: 1080, fps: fps(60), canDecode: true }), null);
});

test("Portrait 4K clip is proxied: a 2160 × 3840 clip gets a 720 × 1280 proxy automatically", () => {
  assert.equal(automaticProxyReason({ width: 2160, height: 3840, fps: fps(30), canDecode: true }), "resolution");
  const spec = proxySpec({ width: 2160, height: 3840, fps: fps(30) }, "mp4");
  assert.deepEqual([spec.width, spec.height], [720, 1280]);
  // 2560 × 1440 has a short side above 1080 as well.
  assert.equal(automaticProxyReason({ width: 2560, height: 1440, fps: fps(30), canDecode: true }), "resolution");
});

test("Linux desktop without an AAC encoder: the proxy is produced in form webm (VP9 + Opus) on the device, otherwise by the host's media.proxy job", () => {
  assert.deepEqual(selectProxyProducer({ encoders: { h264: true, aac: false, vp9: true, opus: true }, sourceDecodes: true, hostConnected: true }), { producer: "device", form: "webm" });
  const spec = proxySpec({ width: 3840, height: 2160, fps: fps(30), hasAudio: true }, "webm");
  assert.deepEqual([spec.container, spec.videoCodec, spec.audioCodec, spec.videoBitrate, spec.audio], ["webm", "vp9", "opus", 3_200_000, { bitrate: 96_000, channels: 2, sampleRate: 48_000 }]);
  // No VP9 encoder either: the built-in host makes it, with the same order of forms.
  assert.deepEqual(selectProxyProducer({ encoders: { h264: true, aac: false, vp9: false, opus: true }, sourceDecodes: true, hostConnected: true }), { producer: "host", forms: ["webm"] });
  assert.deepEqual(selectProxyProducer({ encoders: { h264: false, aac: false, vp9: false, opus: false }, sourceDecodes: true, hostConnected: true, hostEncoders: { h264: true, aac: true } }), { producer: "host", forms: ["mp4", "webm"] });
  const job = proxyJob({ id: "a1", contentHash: HASH("a"), width: 3840, height: 2160, fps: fps(30) }, ["webm"]);
  assert.deepEqual([job.kind, job.scope, job.variant, job.spec?.container], ["media.proxy", "jagentchill.media.write", "proxy", "webm"]);
  assert.equal(proxyTransition({ state: "running" }, { type: "succeed", form: "webm", size: 9, sha256: HASH("b") }).container, "webm");
  // An undecodable source is always the host's, whatever the device can encode.
  assert.deepEqual(selectProxyProducer({ encoders: ALL, sourceDecodes: false, hostConnected: true }), { producer: "host", forms: ["webm"] });
  assert.equal(automaticProxyReason({ width: 1920, height: 1080, fps: fps(30), canDecode: false }), "undecodable");
});

test("No encoder and no host: the asset has proxy.state \"unavailable\", plays from the original and shows \"Proxy unavailable on this device\"", () => {
  assert.deepEqual(selectProxyProducer({ encoders: null, sourceDecodes: true, hostConnected: false }), { producer: "none" });
  assert.deepEqual(selectProxyProducer({ encoders: { h264: false, aac: false, vp9: false, opus: false }, sourceDecodes: true, hostConnected: false }), { producer: "none" });
  const state = proxyTransition({ state: "none" }, { type: "unavailable" });
  assert.deepEqual(state, { state: "unavailable" });
  assert.equal(previewSource(local({ proxy: state }), true), "original");
  assert.equal(message("media.proxy.unavailable").text, "Proxy unavailable on this device");
});

test("a received proxy the device cannot decode is requested in the other form when the host can make it", () => {
  assert.deepEqual(resolveUndecodableProxy("webm", ["mp4", "webm"]), { action: "request", form: "mp4" });
  assert.deepEqual(resolveUndecodableProxy("webm", ["webm"]), { action: "no-proxy" });
});

test("the mezzanine keeps the source resolution capped at 3840 × 2160; a HEIC still becomes PNG with alpha, otherwise JPEG at quality 0.95", () => {
  assert.deepEqual(mezzanineSpec({ width: 7680, height: 4320 }, true), { variant: "mezzanine", width: 3840, height: 2160, videoCodec: "h264", profile: "high", videoBitrate: 40_000_000, container: "mp4" });
  assert.deepEqual(mezzanineSpec({ width: 1920, height: 1080 }, false), { variant: "mezzanine", width: 1920, height: 1080, videoCodec: "vp9", profile: "0", videoBitrate: 30_000_000, container: "webm" });
  assert.deepEqual(stillMezzanineSpec(true), { mimeType: "image/png", extension: "png" });
  assert.deepEqual(stillMezzanineSpec(false), { mimeType: "image/jpeg", quality: 0.95, extension: "jpg" });
});
