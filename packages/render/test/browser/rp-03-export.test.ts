// Exports a short project to MP4 in headless Chromium and probes the file with ffprobe.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { exportFrameCount, exportFrameTime } from "../../src/index.ts";
import { ffmpeg, ffprobe, hasFfmpeg, startHarness, type Harness } from "./harness.ts";

let harness: Harness;
const skip = hasFfmpeg() ? false : "ffmpeg is not installed";
before(async () => {
  if (skip) return;
  harness = await startHarness();
  ffmpeg(["-f", "lavfi", "-i", "color=c=0x2040c0:s=320x180:r=30:d=2", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2",
    "-c:v", "libx264", "-g", "15", "-bf", "0", "-pix_fmt", "yuv420p", "-color_range", "tv", "-colorspace", "bt709", "-c:a", "aac", "-ac", "2", "-shortest", join(harness.media, "clip.mp4")]);
});
after(async () => { await harness?.close(); });

test("Export render session — Frame count for a 10 s range at 29.97 fps", () => {
  const rate = { numerator: 30000, denominator: 1001 };
  assert.equal(exportFrameCount(1_200_000, rate), 299);
  for (const index of [0, 1, 150, 298]) assert.equal(exportFrameTime(0, index, rate), index * 4004);
  assert.equal(exportFrameTime(240_000, 10, rate), 240_000 + 40_040);
});

test("Export — a short project is exported to MP4 (H.264 + AAC) and the file probes with the right duration, size, frame count and audio", { skip }, async () => {
  const result = await harness.page.evaluate(async (origin) => {
    const { jc } = window;
    const red = await jc.imageUrl(32, 32, (context) => { context.fillStyle = "#ff0000"; context.fillRect(0, 0, 32, 32); });
    const doc = jc.project({ width: 320, height: 180 });
    doc.media.assets.push(jc.asset("v", "video", { width: 320, height: 180, duration: 240000, hasAudio: true }), jc.asset("red", "image", { width: 32, height: 32 }));
    doc.scenes[0].tracks.main.elements.push(jc.element("video", { id: "e1", startTime: 0, duration: 240000, mediaId: "v", sourceDuration: 240000 }));
    // A red square in the top-left quarter from 1 s on.
    doc.scenes[0].tracks.overlay = [jc.track("video", "o0", [jc.element("image", { id: "e2", startTime: 120000, duration: 120000, mediaId: "red", transform: { position: { x: -80, y: -45 }, scale: { x: 0.4, y: 0.4 }, rotation: 0 } })])];
    const opened = await jc.open(doc, { width: 320, height: 180 }, [{ assetId: "v", original: `${origin}/media/clip.mp4` }, { assetId: "red", original: red }]);
    const ready = opened.ready();
    let file = new Uint8Array(0);
    const chunks: { seq: number; bytes: number; position: number }[] = [];
    opened.port.on("export.chunk", (payload, transfer) => {
      chunks.push({ seq: payload.seq, bytes: payload.bytes, position: payload.position! });
      const data = new Uint8Array(transfer![0]);
      if (payload.position! + data.length > file.length) { const grown = new Uint8Array(payload.position! + data.length); grown.set(file); file = grown; }
      file.set(data, payload.position!);
    });
    const mark = opened.events.length;
    const started = performance.now();
    const reply = await opened.port.command("export.start", {
      exportId: "x1", width: 320, height: 180, frameRate: { numerator: 30, denominator: 1 }, container: "mp4",
      video: { codec: "avc", bitrate: 1_000_000 }, audio: { codec: "aac", sampleRate: 48000, channels: 2 },
    });
    const done = await Promise.race([opened.waitFor("export.done", mark, 60_000), opened.waitFor("export.failed", mark, 60_000).then((failure) => { throw new Error(JSON.stringify(failure)); })]);
    const elapsed = performance.now() - started;
    const progress = opened.events.slice(mark).filter((event) => event.type === "export.progress").map((event) => event.payload);
    // An encoder the runtime does not have is refused at start.
    const refused = await opened.port.command("export.start", { exportId: "x2", width: 320, height: 180, frameRate: { numerator: 30, denominator: 1 }, container: "mp4", video: { codec: "hevc" } }).then(() => null, (error) => ({ code: error.code, details: error.details }));
    const tooLarge = await opened.port.command("export.start", { exportId: "x3", width: 7680, height: 4320, frameRate: { numerator: 30, denominator: 1 }, container: "mp4", video: { codec: "avc" } }).then(() => null, (error) => ({ code: error.code, details: error.details }));
    let binary = "";
    for (let index = 0; index < file.length; index += 0x8000) binary += String.fromCharCode(...file.subarray(index, index + 0x8000));
    return { reply, done, elapsed, chunks, progress, refused, tooLarge, ready, base64: btoa(binary), hevc: ready.encoders.hevc.supported, maxTexture: ready.maxTextureSize };
  }, harness.origin);

  const file = join(harness.media, "out.mp4");
  writeFileSync(file, Buffer.from(result.base64, "base64"));
  const probe = ffprobe(file);
  const video = probe.streams.find((stream: any) => stream.codec_type === "video"), audio = probe.streams.find((stream: any) => stream.codec_type === "audio");
  console.log(`export: ${result.done.frameCount} frames, ${result.done.bytes} bytes in ${Math.round(result.elapsed)} ms (${(2000 / result.elapsed).toFixed(2)}× real time at 320×180); ffprobe duration ${probe.format.duration} s`);
  assert.deepEqual(result.reply, { exportId: "x1" });
  assert.equal(result.done.frameCount, 60);
  assert.equal(result.done.duration, 240_000);
  assert.equal(result.done.bytes, Buffer.from(result.base64, "base64").length);
  assert.equal(video.codec_name, "h264");
  assert.deepEqual([video.width, video.height], [320, 180]);
  assert.equal(Number(video.nb_read_frames), 60, "frame count");
  assert.equal(video.r_frame_rate, "30/1");
  assert.ok(Math.abs(Number(video.duration) - 2) < 0.01, `video duration ${video.duration}`);
  // The container lasts as long as its longest track: AAC adds its encoder delay and the padding of its last frame.
  assert.ok(Number(probe.format.duration) >= 2 && Number(probe.format.duration) < 2.1, `duration ${probe.format.duration}`);
  assert.ok(audio, "the file has an audio stream");
  assert.equal(audio.codec_name, "aac");
  assert.deepEqual([Number(audio.sample_rate), audio.channels], [48000, 2]);
  assert.ok(Math.abs(Number(audio.duration) - 2) < 0.1, `audio duration ${audio.duration}`);
  assert.ok(Number(probe.format.size) > 5000);
  // The chunks are numbered from 0 and no chunk is larger than 4 MiB.
  assert.deepEqual(result.chunks.map((chunk) => chunk.seq), result.chunks.map((_, index) => index));
  assert.ok(result.chunks.every((chunk) => chunk.bytes <= 4 * 1024 * 1024));
  assert.ok(result.progress.some((entry) => entry.stage === "rendering" && entry.frameCount === 60));
  // Pixels of the exported picture: frame 15 has no overlay, frame 45 shows the red square over the blue clip.
  const pixel = (frame: number, x: number, y: number) => {
    const run = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", file, "-vf", `select=eq(n\\,${frame}),crop=1:1:${x}:${y}`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
    return [...run.stdout.subarray(0, 3)];
  };
  const close = (actual: number[], expected: number[]) => actual.every((channel, index) => Math.abs(channel - expected[index]) <= 12);
  assert.ok(close(pixel(15, 80, 45), [0x20, 0x40, 0xc0]), `frame 15: ${pixel(15, 80, 45)}`);
  assert.ok(close(pixel(45, 80, 45), [255, 0, 0]), `frame 45 overlay: ${pixel(45, 80, 45)}`);
  assert.ok(close(pixel(45, 240, 135), [0x20, 0x40, 0xc0]), `frame 45 clip: ${pixel(45, 240, 135)}`);
  // The audio of the clip is in the mix: a 440 Hz tone with a level well above silence.
  const pcm = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", file, "-f", "f32le", "-ac", "1", "-ar", "48000", "-"], { maxBuffer: 1 << 26 }).stdout;
  const samples = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 4));
  let crossings = 0, peak = 0;
  for (let index = 24_001; index < 72_000; index++) { if (samples[index - 1] < 0 && samples[index] >= 0) crossings++; peak = Math.max(peak, Math.abs(samples[index])); }
  assert.ok(Math.abs(crossings - 440) <= 3, `${crossings} cycles in one second`);
  assert.ok(peak > 0.05 && peak <= 1, `peak ${peak}`);
  if (!result.hevc) {
    assert.equal(result.refused?.code, "engine/encoder-unavailable", "Encoder unavailable: HEVC is refused when the probe reports no HEVC encoder");
    assert.ok(result.refused?.details.alternatives.includes("avc"));
  }
  if (result.maxTexture < 7680) assert.deepEqual([result.tooLarge?.code, result.tooLarge?.details.detail], ["engine/encoder-unavailable", "texture-limit"]);
  assert.deepEqual(harness.errors, []);
});

test("Export file — Light Leak transition is visible at its midpoint and voice-band ducking cuts 1 kHz by 12 dB while 100 Hz and 8 kHz stay within 2 dB", { skip }, async () => {
  const music = join(harness.media, "carve-music.wav"), voice = join(harness.media, "carve-voice.wav");
  ffmpeg(["-f", "lavfi", "-i", "sine=frequency=100:sample_rate=48000:duration=4", "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000:duration=4", "-f", "lavfi", "-i", "sine=frequency=8000:sample_rate=48000:duration=4",
    "-filter_complex", "[0:a]volume=0.04[a0];[1:a]volume=0.04[a1];[2:a]volume=0.04[a2];[a0][a1][a2]amix=inputs=3:normalize=0[m]", "-map", "[m]", "-ac", "2", "-c:a", "pcm_s16le", music]);
  ffmpeg(["-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000:duration=2", "-af", "volume=0.2", "-ac", "2", "-c:a", "pcm_s16le", voice]);
  const result = await harness.page.evaluate(async (origin) => {
    const { jc } = window;
    const a = await jc.imageUrl(320, 180, (context) => { context.fillStyle = "#c02020"; context.fillRect(0, 0, 320, 180); });
    const b = await jc.imageUrl(320, 180, (context) => { context.fillStyle = "#2040c0"; context.fillRect(0, 0, 320, 180); });
    const doc = jc.project({ width: 320, height: 180 });
    doc.media.assets.push(jc.asset("a", "image", { width: 320, height: 180 }), jc.asset("b", "image", { width: 320, height: 180 }),
      jc.asset("music", "audio", { duration: 480000, hasAudio: true }), jc.asset("voice", "audio", { duration: 240000, hasAudio: true }));
    doc.scenes[0].tracks.main.elements.push(
      jc.element("image", { id: "A", startTime: 0, duration: 240000, mediaId: "a", transitionOut: "tx" }),
      jc.element("image", { id: "B", startTime: 240000, duration: 240000, mediaId: "b", transitionIn: "tx" }),
    );
    doc.scenes[0].tracks.main.transitions = [{ id: "tx", kind: "transition", fromElementId: "A", toElementId: "B", duration: 120000, type: "light-leak-transition", params: { color: "#ff8a3d", intensity: 100, position: 0 }, easing: "linear", audioCrossfade: true, shape: "equal-power" }];
    doc.scenes[0].tracks.audio = [
      jc.track("audio", "music-track", [jc.element("audio", { id: "music-clip", sourceType: "upload", startTime: 0, duration: 480000, mediaId: "music" })], { ducking: { enabled: true, amount: 12, attack: 200, release: 500, mode: "voice-band" } }),
      jc.track("audio", "voice-track", [jc.element("audio", { id: "voice-clip", sourceType: "upload", startTime: 120000, duration: 240000, mediaId: "voice", isVoice: true })]),
    ];
    const opened = await jc.open(doc, { width: 320, height: 180 }, [
      { assetId: "a", original: a }, { assetId: "b", original: b },
      { assetId: "music", original: `${origin}/media/carve-music.wav` }, { assetId: "voice", original: `${origin}/media/carve-voice.wav` },
    ]);
    let file = new Uint8Array(0);
    opened.port.on("export.chunk", (payload, transfer) => {
      const data = new Uint8Array(transfer![0]);
      if (payload.position! + data.length > file.length) { const grown = new Uint8Array(payload.position! + data.length); grown.set(file); file = grown; }
      file.set(data, payload.position!);
    });
    const mark = opened.events.length;
    await opened.port.command("export.start", { exportId: "voice-band", width: 320, height: 180, frameRate: { numerator: 30, denominator: 1 }, container: "mp4", video: { codec: "avc", bitrate: 1_000_000 }, audio: { codec: "aac", sampleRate: 48000, channels: 2 } });
    const done = await Promise.race([opened.waitFor("export.done", mark, 60_000), opened.waitFor("export.failed", mark, 60_000).then((failure) => { throw new Error(JSON.stringify(failure)); })]);
    let binary = "";
    for (let index = 0; index < file.length; index += 0x8000) binary += String.fromCharCode(...file.subarray(index, index + 0x8000));
    return { done, base64: btoa(binary), errors: opened.events.filter((event) => event.type === "render.diagnostic").map((event) => event.payload) };
  }, harness.origin);

  const output = join(harness.media, "transition-voice-band.mp4"), bytes = Buffer.from(result.base64, "base64");
  writeFileSync(output, bytes);
  const probe = ffprobe(output), audio = probe.streams.find((stream: any) => stream.codec_type === "audio");
  assert.equal(result.done.frameCount, 120);
  assert.equal(result.done.duration, 480000);
  assert.ok(audio && Number(audio.sample_rate) === 48000 && audio.channels === 2, "the MP4 includes the mixed AAC track");
  assert.deepEqual(result.errors, []);
  const frame = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", output, "-vf", "select=eq(n\\,60)", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 20 }).stdout;
  const pixel = (x: number, y: number) => [...frame.subarray((y * 320 + x) * 3, (y * 320 + x) * 3 + 3)];
  const centre = pixel(160, 90), corner = pixel(20, 20);
  assert.ok(centre[0] > corner[0] + 30 && centre[1] > corner[1] + 20, `the exported midpoint contains the Light Leak band: centre ${centre}, corner ${corner}`);
  const pcm = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", output, "-f", "f32le", "-ac", "1", "-ar", "48000", "-"], { maxBuffer: 1 << 26 }).stdout;
  const samples = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 4));
  const amplitude = (frequency: number, start: number) => {
    const count = 24000, at = Math.round(start * 48000);
    let re = 0, im = 0;
    for (let index = 0; index < count; index++) { const angle = (2 * Math.PI * frequency * index) / 48000, value = samples[at + index]; re += value * Math.cos(angle); im -= value * Math.sin(angle); }
    return 2 * Math.hypot(re, im) / count;
  };
  const deltaDb = (frequency: number) => 20 * Math.log10(amplitude(frequency, 1.5) / amplitude(frequency, 0.25));
  const speechBandDb = deltaDb(1000), bassDb = deltaDb(100), airDb = deltaDb(8000);
  console.log(`voice-band MP4: 100 Hz ${bassDb.toFixed(2)} dB, 1 kHz ${speechBandDb.toFixed(2)} dB, 8 kHz ${airDb.toFixed(2)} dB; Light Leak pixel centre ${centre}, corner ${corner}`);
  assert.ok(Math.abs(speechBandDb + 12) <= 1.5, `exported 1 kHz reduction = ${speechBandDb.toFixed(2)} dB`);
  assert.ok(Math.abs(bassDb) <= 2, `exported 100 Hz change = ${bassDb.toFixed(2)} dB`);
  assert.ok(Math.abs(airDb) <= 2, `exported 8 kHz change = ${airDb.toFixed(2)} dB`);
});
