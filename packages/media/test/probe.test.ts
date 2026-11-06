import assert from "node:assert/strict";
import { test } from "node:test";
import { PROBE_TIMEOUT_MS, ProbeError, assetHasAudio, bytesSource, codecLabel, detectMediaType, fpsToRational, message, probeImageBytes, probeMedia, probeRecordFields } from "../src/index.ts";
import { fixture } from "./support/fixtures.ts";

// Container and header probing run for real on generated files. `canDecode` is `null` here because a Node process has
// no WebCodecs; the decoder answers are asserted in a real browser by browser-engine.test.ts.
const probe = (name: string, mimeType = "") => {
  const bytes = fixture(name), detected = detectMediaType({ name, mimeType, head: bytes.subarray(0, 4096) })!;
  return probeMedia({ name, type: detected.type, format: detected.format, source: bytesSource(bytes) });
};

test("Probe a phone video: 1080 × 1920 (rotated 90°) 29.97 fps HEVC with AAC reports width 1080, height 1920, fps 30000/1001, hasAudio, HEVC", async () => {
  const result = await probe("phone-hevc.mp4");
  assert.equal(result.type, "video");
  assert.deepEqual([result.width, result.height], [1080, 1920]);
  assert.ok(result.rotation === 90 || result.rotation === 270, `rotation ${result.rotation}`);
  assert.deepEqual(result.fps, { numerator: 30000, denominator: 1001 });
  assert.equal(result.hasAudio, true);
  assert.equal(result.videoCodec, "hevc");
  assert.equal(codecLabel(result.videoCodec), "HEVC");
  assert.equal(result.audioCodec, "aac");
  assert.equal(result.duration, 120_000);
  assert.equal(result.container, "mp4");
});

test("Corrupt file: a truncated MP4 without an index is rejected with \"Unable to read {name}\"", async () => {
  await assert.rejects(probe("truncated.mp4"), (error: unknown) => error instanceof ProbeError && error.message === "Unable to read truncated.mp4" && error.code === "media/unreadable");
  await assert.rejects(probeMedia({ name: "noise.mp4", type: "video", source: bytesSource(new Uint8Array(5000).fill(7)) }), ProbeError);
  await assert.rejects(probeMedia({ name: "broken.png", type: "image", source: bytesSource(new Uint8Array(64)) }), /Unable to read broken.png/);
  assert.equal(message("media.unreadable", { name: "a.mp4" }).text, "Unable to read a.mp4");
});

test("Non-standard frame rate: 57.3334 packets per second is stored as {numerator: 57333, denominator: 1000}", () => {
  assert.deepEqual(fpsToRational(57.3334), { numerator: 57333, denominator: 1000 });
  // Standard rates are matched within 0.01 fps; anything else keeps three decimals, reduced.
  assert.deepEqual(fpsToRational(29.97002997), { numerator: 30000, denominator: 1001 });
  assert.deepEqual(fpsToRational(23.976), { numerator: 24000, denominator: 1001 });
  assert.deepEqual(fpsToRational(59.94), { numerator: 60000, denominator: 1001 });
  assert.deepEqual(fpsToRational(12.5), { numerator: 25, denominator: 2 });
  assert.deepEqual(fpsToRational(120), { numerator: 120, denominator: 1 });
});

test("video probing reads duration in ticks, display size, frame rate, codecs, container and audio facts from the container", async () => {
  const mp4 = await probe("h264-aac.mp4");
  assert.deepEqual({ ...mp4, canDecode: undefined }, {
    type: "video", container: "mp4", duration: 240_000, width: 640, height: 360, rotation: 0, fps: { numerator: 30, denominator: 1 }, hasAudio: true,
    videoCodec: "h264", hasAlpha: false, canDecode: undefined, audioCodec: "aac", sampleRate: 48000, channels: 2, canDecodeSound: null,
  });
  assert.equal(mp4.canDecode, null);
  const webm = await probe("vp9-opus.webm");
  assert.deepEqual([webm.container, webm.videoCodec, webm.audioCodec, webm.width, webm.height, webm.fps, webm.channels, webm.sampleRate], ["webm", "vp9", "opus", 320, 240, { numerator: 25, denominator: 1 }, 1, 48000]);
  assert.ok(Math.abs(webm.duration! - 240_000) <= 240, `duration ${webm.duration}`);
  const silent = await probe("silent.webm");
  assert.equal(silent.hasAudio, false);
  assert.deepEqual(silent.fps, { numerator: 24, denominator: 1 });
  const sixty = await probe("sixty.mp4");
  assert.deepEqual(sixty.fps, { numerator: 60, denominator: 1 });
  // The record gets exactly the catalogue §12.2 fields; sample rate, channels and alpha are not record fields.
  assert.deepEqual(Object.keys(probeRecordFields(mp4)).sort(), ["audioCodec", "container", "duration", "fps", "hasAudio", "height", "rotation", "type", "videoCodec", "width"]);
});

test("audio probing reads duration, sample rate, channel count and codec from the container", async () => {
  const wav = await probe("sine-10s.wav");
  assert.deepEqual(wav, { type: "audio", container: "wav", duration: 1_200_000, rotation: 0, canDecode: null, audioCodec: "pcm", sampleRate: 44100, channels: 1 });
  const mp3 = await probe("tone.mp3", "audio/mpeg");
  assert.deepEqual([mp3.type, mp3.container, mp3.audioCodec, mp3.sampleRate, mp3.channels], ["audio", "mp3", "mp3", 44100, 2]);
  assert.ok(Math.abs(mp3.duration! / 120_000 - 3) < 0.06, `duration ${mp3.duration}`);
});

test("image probing reads width, height, EXIF rotation and whether an alpha channel is present", async () => {
  assert.deepEqual(await probe("alpha.png"), { type: "image", container: "png", width: 64, height: 48, rotation: 0, hasAlpha: true, canDecode: null });
  assert.equal((await probe("opaque.png")).hasAlpha, false);
  assert.deepEqual(await probe("plain.jpg"), { type: "image", container: "jpeg", width: 80, height: 40, rotation: 0, hasAlpha: false, canDecode: null });
  // Stored 80 × 40 with EXIF orientation 6: displayed 40 × 80.
  assert.deepEqual(await probe("exif-rotated.jpg"), { type: "image", container: "jpeg", width: 40, height: 80, rotation: 90, hasAlpha: false, canDecode: null });
  assert.deepEqual([(await probe("large.jpg")).width, (await probe("large.jpg")).height], [6000, 4000]);
  assert.deepEqual(probeImageBytes(fixture("picture.webp")), { format: "webp", width: 48, height: 24, rotation: 0, hasAlpha: false });
  assert.deepEqual(probeImageBytes(fixture("picture.bmp")), { format: "bmp", width: 20, height: 10, rotation: 0, hasAlpha: false });
  assert.deepEqual(probeImageBytes(fixture("scripted.svg")), { format: "svg", width: 120, height: 60, rotation: 0, hasAlpha: true });
  assert.deepEqual(probeImageBytes(new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 30"/>`)), { format: "svg", width: 40, height: 30, rotation: 0, hasAlpha: true });
});

test("an animated GIF is imported as video; a single-frame GIF stays an image", async () => {
  const animated = await probe("anim.gif", "image/gif");
  assert.deepEqual([animated.type, animated.container, animated.width, animated.height, animated.duration, animated.fps, animated.hasAudio], ["video", "gif", 32, 32, 120_000, { numerator: 5, denominator: 1 }, false]);
  const still = await probe("still.gif", "image/gif");
  assert.deepEqual([still.type, still.width, still.height], ["image", 16, 16]);
});

test("HEIC/AVIF headers: size from the picture's ispe box, rotation from irot, alpha from an auxiliary item", () => {
  const box = (type: string, ...body: number[][]) => { const payload = body.flat(), size = payload.length + 8; return [size >>> 24, (size >>> 16) & 255, (size >>> 8) & 255, size & 255, ...Buffer.from(type), ...payload]; };
  const u32 = (value: number) => [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
  const ispe = (w: number, h: number) => box("ispe", u32(0), u32(w), u32(h));
  const file = Uint8Array.from([
    ...box("ftyp", [...Buffer.from("heic")], u32(0), [...Buffer.from("mif1heic")]),
    ...box("meta", u32(0), box("iprp", box("ipco", ispe(160, 120), ispe(4032, 3024), box("irot", [1]), box("auxC", u32(0), [...Buffer.from("urn:mpeg:hevc:2015:auxid:1\0")])))),
  ]);
  assert.deepEqual(probeImageBytes(file), { format: "heic", width: 3024, height: 4032, rotation: 270, hasAlpha: true });
});

test("a probe that does not finish within 5 s is rejected with the same message", async () => {
  assert.equal(PROBE_TIMEOUT_MS, 5000);
  const bytes = fixture("h264-aac.mp4");
  const slow = { size: bytes.length, read: (start: number, end: number) => new Promise<Uint8Array>((resolve) => setTimeout(() => resolve(bytes.subarray(start, end)), 400)) };
  const started = Date.now();
  await assert.rejects(probeMedia({ name: "slow.mp4", type: "video", source: slow, timeoutMs: 150 }), /Unable to read slow.mp4/);
  assert.ok(Date.now() - started < 1500);
});

test("probing reads only headers and index data, whatever the file size", async () => {
  const bytes = fixture("h264-aac.mp4");
  const padded = { size: bytes.length, reads: 0, read(start: number, end: number) { this.reads += end - start; return Promise.resolve(bytes.subarray(start, end)); } };
  const result = await probeMedia({ name: "h264-aac.mp4", type: "video", source: padded });
  assert.equal(result.width, 640);
  const wav = fixture("sine-10s.wav"), counted = { size: wav.length, reads: 0, read(start: number, end: number) { this.reads += end - start; return Promise.resolve(wav.subarray(start, end)); } };
  await probeMedia({ name: "sine-10s.wav", type: "audio", source: counted });
  assert.ok(counted.reads < wav.length / 2, `read ${counted.reads} of ${wav.length} bytes`);
});

test("Classic asset before its probe completes: with hasAudio undefined the clip is treated as having audio; the stored value replaces the assumption", () => {
  assert.equal(assetHasAudio({ type: "video" }), true);
  assert.equal(assetHasAudio({ type: "video", hasAudio: false }), false);
  assert.equal(assetHasAudio({ type: "video", hasAudio: true }), true);
  assert.equal(assetHasAudio({ type: "image" }), false);
});
