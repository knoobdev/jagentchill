// The decoders here are stand-ins (a Node process has no WebCodecs): the scheduler, cache and summary code under test
// is real. The real decoders are exercised in a browser by browser-engine.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FILMSTRIP_BASE_INTERVAL, FILMSTRIP_DENSE_INTERVAL, FILMSTRIP_DERIVED_INTERVALS, FILMSTRIP_HEIGHT, FilmstripScheduler, WAVEFORM_LEVEL_FACTORS, WaveformBuilder, WaveformService,
  buildWaveformSummary, chooseFilmstripInterval, decodeWaveform, encodeWaveform, filmstripBaseTimes, filmstripFrameSize, filmstripIntervals, filmstripKey, filmstripSampleTime, filmstripTimes,
  memoryCache, purgeDerivedCaches, sampleWaveform, sha256OfText, thumbnailEncoding, thumbnailFallback, thumbnailName, thumbnailSize, thumbnailTimeTicks, wantedFilmstripInterval, waveformKey,
  type FilmstripRequest,
} from "../src/index.ts";
import { HASH, SECOND } from "./support/project.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("Large image: a 6000 × 4000 image gets a 1080 × 720 thumbnail", () => {
  assert.deepEqual(thumbnailSize({ width: 6000, height: 4000 }), { width: 1080, height: 720 });
  assert.deepEqual(thumbnailSize({ width: 3840, height: 2160 }), { width: 1280, height: 720 });
  assert.deepEqual(thumbnailSize({ width: 1080, height: 1920 }), { width: 405, height: 720 });
  // Smaller pictures are not enlarged.
  assert.deepEqual(thumbnailSize({ width: 640, height: 360 }), { width: 640, height: 360 });
});

test("Short video: a 0.6 s video takes its thumbnail from the frame at 0.3 s", () => {
  assert.equal(thumbnailTimeTicks(0.6 * SECOND), 0.3 * SECOND);
  assert.equal(thumbnailTimeTicks(10 * SECOND), SECOND);
  assert.equal(thumbnailTimeTicks(2 * SECOND), SECOND);
});

test("thumbnails are JPEG quality 0.8, PNG when the picture has alpha; audio and undecodable video fall back", () => {
  assert.deepEqual(thumbnailEncoding(false), { mimeType: "image/jpeg", quality: 0.8, extension: "jpg" });
  assert.deepEqual(thumbnailEncoding(true), { mimeType: "image/png", extension: "png" });
  assert.equal(thumbnailName("a1", true), "a1.png");
  assert.equal(thumbnailFallback({ type: "audio" }, false), "waveform-glyph");
  assert.equal(thumbnailFallback({ type: "video" }, false), "type-icon");
  assert.equal(thumbnailFallback({ type: "video" }, true), "none");
});

test("filmstrip frames are 90 px high, sampled every second, with sparser levels at 2, 5, 10, 30 and 60 s derived from the base level", () => {
  assert.deepEqual(filmstripFrameSize({ width: 1920, height: 1080 }), { width: 160, height: FILMSTRIP_HEIGHT });
  assert.deepEqual(filmstripFrameSize({ width: 1080, height: 1920 }), { width: 51, height: 90 });
  assert.equal(FILMSTRIP_BASE_INTERVAL, SECOND);
  assert.deepEqual([...FILMSTRIP_DERIVED_INTERVALS], [2, 5, 10, 30, 60].map((seconds) => seconds * SECOND));
  assert.deepEqual(filmstripBaseTimes(3.5 * SECOND), [0, SECOND, 2 * SECOND, 3 * SECOND]);
  // A derived level stores nothing of its own: its frames are base-level frames, under the same keys.
  const fiveSecond = filmstripTimes(5 * SECOND, { start: 0, end: 20 * SECOND }, 20 * SECOND);
  assert.deepEqual(fiveSecond, [0, 5 * SECOND, 10 * SECOND, 15 * SECOND]);
  for (const time of fiveSecond) assert.ok(filmstripBaseTimes(20 * SECOND).includes(time));
  assert.equal(filmstripSampleTime(7.4 * SECOND, 5 * SECOND), 5 * SECOND);
  assert.equal(filmstripKey(HASH("a"), SECOND), `filmstrip/${HASH("a")}/120000`);
});

test("timeline clips choose the densest available level whose interval is ≥ the tile's time width", () => {
  const fps = { numerator: 30, denominator: 1 }, frame = 4000;
  assert.deepEqual(filmstripIntervals(fps), [frame, FILMSTRIP_DENSE_INTERVAL, SECOND, 2 * SECOND, 5 * SECOND, 10 * SECOND, 30 * SECOND, 60 * SECOND]);
  assert.equal(wantedFilmstripInterval(3 * SECOND, fps), 5 * SECOND);
  assert.equal(wantedFilmstripInterval(SECOND, fps), SECOND);
  assert.equal(wantedFilmstripInterval(0.7 * SECOND, fps), SECOND);
  // Denser frames only when the zoom makes a tile narrower than 0.5 s; single frames when a tile is one frame wide.
  assert.equal(wantedFilmstripInterval(0.2 * SECOND, fps), FILMSTRIP_DENSE_INTERVAL);
  assert.equal(wantedFilmstripInterval(frame, fps), frame);
  assert.equal(wantedFilmstripInterval(600 * SECOND, fps), 60 * SECOND);
  assert.equal(chooseFilmstripInterval(3 * SECOND, [SECOND, 2 * SECOND, 5 * SECOND, 10 * SECOND]), 5 * SECOND);
  assert.equal(chooseFilmstripInterval(0.2 * SECOND, [SECOND, 2 * SECOND]), SECOND);
  assert.equal(chooseFilmstripInterval(0.2 * SECOND, [FILMSTRIP_DENSE_INTERVAL, SECOND]), FILMSTRIP_DENSE_INTERVAL);
  assert.equal(chooseFilmstripInterval(90 * SECOND, [SECOND, 60 * SECOND]), 60 * SECOND);
  assert.equal(chooseFilmstripInterval(SECOND, []), null);
});

test("Visible range first: with a 2-hour video and the viewport on minutes 60–62, frames of that range appear before any other", async () => {
  const order: number[] = [], cache = memoryCache();
  const scheduler = new FilmstripScheduler({ cache, decode: async (request) => { order.push(request.time); await Promise.resolve(); return new Uint8Array([1]); } });
  scheduler.pause();
  const duration = 2 * 3600 * SECOND, visible = { start: 60 * 60 * SECOND, end: 62 * 60 * SECOND };
  const all = scheduler.schedule({ contentHash: HASH("a"), duration }, visible);
  assert.equal(all.length, 7200);
  scheduler.resume();
  await Promise.all(all);
  const inView = (time: number) => time >= visible.start && time < visible.end;
  assert.equal(order.length, 7200);
  assert.ok(order.slice(0, 120).every(inView), "the first 120 decodes are the visible two minutes");
  assert.ok(order.slice(120).every((time) => !inView(time)));
  // The viewport moves: the new range jumps the queue.
  const second = new FilmstripScheduler({ cache: memoryCache(), decode: async (request) => { order.push(request.time); return new Uint8Array([1]); } });
  order.length = 0;
  second.pause();
  const rest = second.schedule({ contentHash: HASH("b"), duration: 600 * SECOND });
  second.prioritise(HASH("b"), { start: 300 * SECOND, end: 310 * SECOND });
  second.resume();
  await Promise.all(rest);
  assert.deepEqual(order.slice(0, 10), Array.from({ length: 10 }, (_, index) => (300 + index) * SECOND));
});

test("Cache reuse: previously generated filmstrip frames are returned without decoding the video", async () => {
  const cache = memoryCache();
  let decodes = 0;
  const decode = async (request: FilmstripRequest) => { decodes++; return new Uint8Array([request.time / SECOND]); };
  const first = new FilmstripScheduler({ cache, decode });
  await Promise.all(first.schedule({ contentHash: HASH("a"), duration: 5 * SECOND }));
  assert.equal(decodes, 5);
  // The project is reopened: a new scheduler over the same cache store.
  const reopened = new FilmstripScheduler({ cache, decode });
  const frames = await Promise.all(filmstripBaseTimes(5 * SECOND).map((time) => reopened.request({ contentHash: HASH("a"), time })));
  assert.equal(decodes, 5);
  assert.deepEqual(frames.map((frame) => frame[0]), [0, 1, 2, 3, 4]);
  assert.deepEqual([...(await reopened.cached({ contentHash: HASH("a"), time: 2 * SECOND }))!], [2]);
  // A missing filmstrip never blocks editing: an uncached frame is simply absent.
  assert.equal(await reopened.cached({ contentHash: HASH("z"), time: 0 }), undefined);
});

test("filmstrip generation runs at most 2 decodes at a time and is paused during playback and export", async () => {
  let active = 0, peak = 0, done = 0;
  const scheduler = new FilmstripScheduler({ cache: memoryCache(), decode: async () => { active++; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 3)); active--; done++; return new Uint8Array(1); } });
  const jobs = scheduler.schedule({ contentHash: HASH("a"), duration: 12 * SECOND });
  await new Promise((resolve) => setTimeout(resolve, 5));
  scheduler.pause();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const whilePaused = done;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(done, whilePaused, "nothing new is decoded while paused");
  assert.ok(scheduler.pending > 0);
  scheduler.resume();
  await Promise.all(jobs);
  assert.equal(done, 12);
  assert.equal(peak, 2);
  // Two clips asking for the same frame share one decode.
  let shared = 0;
  const dedupe = new FilmstripScheduler({ cache: memoryCache(), decode: async () => { shared++; await tick(); return new Uint8Array(1); } });
  await Promise.all([dedupe.request({ contentHash: HASH("a"), time: 0 }), dedupe.request({ contentHash: HASH("a"), time: 0 })]);
  assert.equal(shared, 1);
});

const sine = (seconds: number, sampleRate: number, amplitude = 1) => Float32Array.from({ length: seconds * sampleRate }, (_, index) => amplitude * Math.sin((2 * Math.PI * 440 * index) / sampleRate));

test("Summary format: a 10 s mono sine at full scale gives 1 000 min/max pairs at the base level and 250 at factor 4", () => {
  const summary = buildWaveformSummary(44100, [sine(10, 44100)]);
  assert.deepEqual(summary.levels.map((level) => [level.factor, level.pairs.length / 2]), [[1, 1000], [4, 250], [16, 63], [64, 16]]);
  assert.deepEqual([...WAVEFORM_LEVEL_FACTORS], [1, 4, 16, 64]);
  assert.ok(summary.levels[0].pairs instanceof Int8Array, "8-bit");
  // Full scale: every 10 ms window of a 440 Hz sine reaches both peaks.
  for (let pair = 0; pair < 1000; pair++) { assert.ok(summary.levels[0].pairs[pair * 2] <= -126); assert.ok(summary.levels[0].pairs[pair * 2 + 1] >= 126); }
  assert.equal(summary.totalSamples, 441_000);
  // A rate that 100 does not divide still gives 100 pairs per second.
  assert.equal(buildWaveformSummary(22050, [sine(3, 22050)]).levels[0].pairs.length / 2, 300);
  assert.equal(buildWaveformSummary(48000, [sine(2, 48000), sine(2, 48000)]).levels[0].pairs.length / 2, 200);
});

test("the summary is the mono mix, is built from chunks of any size, and survives the cache encoding", () => {
  const left = sine(1, 8000), right = left.map((value) => -value);
  // Opposite channels cancel in the mono mix.
  assert.ok(buildWaveformSummary(8000, [left, right]).levels[0].pairs.every((value) => value === 0));
  const whole = buildWaveformSummary(8000, [sine(2, 8000, 0.5)]), builder = new WaveformBuilder(8000), samples = sine(2, 8000, 0.5);
  for (let offset = 0; offset < samples.length; offset += 777) builder.push([samples.subarray(offset, offset + 777)]);
  const chunked = builder.finish();
  assert.deepEqual(chunked.levels.map((level) => [...level.pairs]), whole.levels.map((level) => [...level.pairs]));
  const restored = decodeWaveform(encodeWaveform(whole))!;
  assert.deepEqual({ sampleRate: restored.sampleRate, totalSamples: restored.totalSamples }, { sampleRate: 8000, totalSamples: 16000 });
  assert.deepEqual(restored.levels.map((level) => [level.factor, ...level.pairs]), whole.levels.map((level) => [level.factor, ...level.pairs]));
  assert.equal(decodeWaveform(new Uint8Array(10)), null);
  const bars = sampleWaveform(whole, { startSeconds: 0, endSeconds: 2, bars: 20 });
  assert.equal(bars.length, 40);
  assert.ok(Math.abs(bars[0] + 0.5) < 0.02 && Math.abs(bars[1] - 0.5) < 0.02, `peaks ${bars[0]} ${bars[1]}`);
});

test("Summary shared by clips: an audio asset used by three clips is summarised exactly once", async () => {
  const cache = memoryCache(), service = new WaveformService({ cache });
  let computations = 0;
  const compute = async (_key: string, onProgress: (fraction: number) => void) => { computations++; onProgress(0.5); await tick(); return buildWaveformSummary(8000, [sine(1, 8000)]); };
  const key = waveformKey({ contentHash: HASH("a") }), states: string[][] = [[], [], []];
  const [a, b, c] = await Promise.all([0, 1, 2].map((clip) => service.get(key, compute, (state) => states[clip].push(state.state === "computing" ? `computing ${state.progress}` : state.state))));
  assert.equal(computations, 1);
  assert.ok(a === b && b === c, "all three clips draw from the same summary");
  for (const seen of states) assert.deepEqual([seen[0], seen.at(-1)], ["computing 0", "ready"]);
  assert.ok(states[0].includes("computing 0.5"));
  // After a reload the summary comes from the cache store, still without computing.
  const reopened = new WaveformService({ cache });
  assert.equal((await reopened.get(key, compute)).levels[0].pairs.length, 200);
  assert.equal(computations, 1);
  // Removing the asset removes its summary.
  await reopened.remove(key);
  assert.equal(await cache.get(key), undefined);
});

test("a waveform failure is reported as failed, logged, never thrown at playback, and can be retried", async () => {
  const logged: string[] = [], service = new WaveformService({ cache: memoryCache(), log: (text) => logged.push(text) });
  const states: string[] = [];
  await assert.rejects(service.get("waveform/x", async () => { throw new Error("no audio decoder"); }, (state) => states.push(state.state)));
  assert.deepEqual(states, ["computing", "failed"]);
  assert.equal(logged.length, 1);
  assert.equal((await service.get("waveform/x", async () => buildWaveformSummary(8000, [sine(1, 8000)]))).sampleRate, 8000);
});

test("summaries are keyed by content hash; a library sound that is not a project asset by the SHA-256 of its URL", async () => {
  assert.equal(waveformKey({ contentHash: HASH("c") }), `waveform/${HASH("c")}`);
  assert.equal(waveformKey({ url: "https://cdn.example/s.mp3" }), `waveform/${sha256OfText("https://cdn.example/s.mp3")}`);
  const cache = memoryCache();
  for (const key of [`waveform/${HASH("c")}`, `filmstrip/${HASH("c")}/0`, `filmstrip/${HASH("c")}/120000`, `proxy/${HASH("c")}.mp4`, `waveform/${HASH("d")}`]) await cache.put(key, new Uint8Array(1));
  await purgeDerivedCaches(cache, HASH("c"));
  assert.deepEqual(await cache.list(""), [`waveform/${HASH("d")}`]);
});
