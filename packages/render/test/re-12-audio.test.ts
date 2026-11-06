import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, createProjectDocument, createTrack } from "@jagentchill/protocol";
import {
  clipGainAt, collectMixClips, dbToGain, fadeGain, Limiter, LIMITER_CEILING, LIMITER_LOOKAHEAD, mixdown, mixdownBlocks, panGains, Resampler, truePeak,
  type MixClip, type SourceReader,
} from "../src/index.ts";

const RATE = 48_000;
/** A reader over synthetic sources: `assetId → (frame) => sample`, the same on both channels. */
const reader = (sources: Record<string, (frame: number) => number>): SourceReader => (assetId, first, count) => {
  const data = new Float32Array(count);
  for (let index = 0; index < count; index++) data[index] = first + index >= 0 ? sources[assetId](first + index) : 0;
  return [data, data.slice()];
};
const sine = (frequency: number, amplitude = 1) => (frame: number) => amplitude * Math.sin((2 * Math.PI * frequency * frame) / RATE);
const clip = (fields: Partial<MixClip> = {}): MixClip => {
  const duration = fields.duration ?? 240_000;
  return { elementId: "e", assetId: "a", startTime: 0, duration, retime: { sourceStart: 0, sourceSpan: duration, duration }, volume: 0, pan: 0, trackGain: 1, trackPan: 0, outerGain: 1, ...fields };
};

function documentWith(tracks: { id: string; muted?: boolean; solo?: boolean; volume?: number; elements: Record<string, unknown>[] }[]) {
  const doc = JSON.parse(JSON.stringify(createProjectDocument({ id: "p", mainSceneId: "s", mainTrackId: "main", now_ms: 0 })));
  doc.media.assets.push({ id: "a", name: "a", type: "audio", kind: null, size: 1, contentHash: null, rotation: 0, folderId: null, tags: [], ephemeral: false, provenance: { source: "imported" }, motionTracks: [], faces: [], created_ms: 0, hasAudio: true });
  doc.scenes[0].tracks.audio = tracks.map((track) => ({
    ...JSON.parse(JSON.stringify(createTrack("audio", { id: track.id, name: track.id, muted: track.muted ?? false, solo: track.solo ?? false, volume: track.volume ?? 0 }))),
    elements: track.elements.map((element) => JSON.parse(JSON.stringify(createElement("audio", { name: "x", sourceType: "upload", mediaId: "a", ...element } as never)))),
  }));
  return doc;
}

test("Audio gain maths — decibels, equal-power pan and the five fade shapes", () => {
  assert.equal(dbToGain(0), 1);
  assert.ok(Math.abs(dbToGain(-6) - 0.5012) < 1e-4);
  assert.equal(dbToGain(-60), 0, "−60 dB is silence");
  assert.deepEqual(panGains(0), [1, 1], "pan 0 leaves a stereo signal unchanged");
  const [left, right] = panGains(-100);
  assert.ok(Math.abs(left - Math.SQRT2) < 1e-9 && Math.abs(right) < 1e-9);
  const [l50, r50] = panGains(50);
  assert.ok(Math.abs(l50 * l50 + r50 * r50 - 2) < 1e-9, "equal power at every position");
  const at = (shape: string) => fadeGain(30_000, 240_000, { duration: 60_000, shape });
  assert.equal(at("linear"), 0.5);
  assert.ok(Math.abs(at("equal-power") - Math.sin(Math.PI / 4)) < 1e-12);
  assert.equal(at("s-curve"), 0.5);
  assert.ok(Math.abs(at("logarithmic") - Math.log10(5.5)) < 1e-12);
  assert.equal(at("exponential"), 0.25);
  // A fade out uses the fade-in gain for 1 − p.
  assert.equal(fadeGain(225_000, 240_000, undefined, { duration: 60_000, shape: "linear" }), 0.25);
  assert.equal(fadeGain(120_000, 240_000, { duration: 60_000, shape: "linear" }, { duration: 60_000, shape: "linear" }), 1);
});

test("Audio mixdown for export — Muted track", async () => {
  const element = { id: "e1", startTime: 0, duration: 120_000 };
  const doc = documentWith([{ id: "t1", muted: true, elements: [element] }, { id: "t2", elements: [{ ...element, id: "e2", muted: true }] }]);
  assert.deepEqual(collectMixClips(doc, "s"), [], "a muted track and a muted element contribute nothing");
  const out = await mixdown({ clips: collectMixClips(doc, "s"), read: reader({ a: sine(440) }), start: 0, end: 120_000 });
  assert.equal(out[0].length, RATE, "an empty mix is silence of the range duration");
  assert.ok(out[0].every((sample) => sample === 0) && out[1].every((sample) => sample === 0));
  // Solo is ignored by the export collection and honoured by playback.
  const solo = documentWith([{ id: "t1", solo: true, elements: [element] }, { id: "t2", elements: [{ ...element, id: "e2" }] }]);
  assert.equal(collectMixClips(solo, "s").length, 2);
  assert.equal(collectMixClips(solo, "s", { honourSolo: true }).length, 1);
});

test("Audio mixdown for export — Gain keyframes", async () => {
  const key = (id: string, time: number, value: number) => ({ id, time, value, segmentToNext: "linear" as const, tangentMode: "auto" as const });
  const keyed = clip({ volumeChannel: { keys: [key("k0", 0, -60), key("k1", 240_000, 0)], extrapolation: { before: "hold", after: "hold" } } });
  assert.ok(Math.abs(clipGainAt(keyed, 120_000) / Math.pow(10, -30 / 20) - 1) < 0.01);
  // The gain of the mixed samples themselves, on a constant source.
  const out = await mixdown({ clips: [keyed], read: reader({ a: () => 0.5 }), start: 0, end: 240_000 });
  assert.ok(Math.abs(out[0][RATE] / 0.5 / Math.pow(10, -30 / 20) - 1) < 0.01, `sample gain at 1 s: ${out[0][RATE] / 0.5}`);
});

test("Audio mixdown for export — Deterministic repeat", async () => {
  const clips = [clip({ volume: -3, pan: 30, fadeIn: { duration: 24_000, shape: "equal-power" } }), clip({ elementId: "f", assetId: "b", startTime: 60_000, duration: 120_000, retime: { sourceStart: 0, sourceSpan: 240_000, duration: 120_000, retime: { rate: 2 } } })];
  const options = { clips, read: reader({ a: sine(440, 0.4), b: sine(1000, 0.3) }), start: 0, end: 240_000, sampleRate: 48_000 as const, channels: 2 as const };
  const first = await mixdown(options), second = await mixdown(options);
  assert.equal(first[0].length, 2 * RATE);
  assert.deepEqual(first[0], second[0]);
  assert.deepEqual(first[1], second[1]);
  assert.ok(first[1].some((sample, index) => sample !== first[0][index]), "panned");
});

test("Audio mixdown for export — Block boundary is inaudible", async () => {
  // A 440 Hz tone across the 10 s block boundary of a 12 s range.
  const out = await mixdown({ clips: [clip({ duration: 1_440_000 })], read: reader({ a: sine(440, 0.5) }), start: 0, end: 1_440_000 });
  assert.equal(out[0].length, 12 * RATE);
  let largest = 0;
  for (let index = 1; index < 9 * RATE; index++) largest = Math.max(largest, Math.abs(out[0][index] - out[0][index - 1]));
  for (let index = 10 * RATE - 4; index < 10 * RATE + 4; index++) assert.ok(Math.abs(out[0][index] - out[0][index - 1]) <= largest + 1e-7, `step at ${index}`);
  // The blocks are at most 10 s long.
  let blocks = 0;
  for await (const block of mixdownBlocks({ clips: [], read: reader({}), start: 0, end: 3_000_000 })) { blocks++; assert.ok(block[0].length <= 10 * RATE); }
  assert.equal(blocks, 3);
});

test("Audio mixdown for export — the mix converts once to the export rate and channel count", async () => {
  const out = await mixdown({ clips: [clip()], read: reader({ a: sine(440, 0.5) }), start: 0, end: 240_000, sampleRate: 44_100, channels: 1 });
  assert.equal(out.length, 1);
  assert.ok(Math.abs(out[0].length - 88_200) <= 1, `${out[0].length} frames at 44 100 Hz`);
  // The tone is still 440 Hz: zero crossings per second.
  let crossings = 0;
  for (let index = 44_100; index < 88_200 - 100; index++) if (out[0][index - 1] < 0 && out[0][index] >= 0) crossings++;
  assert.ok(Math.abs(crossings - 440) <= 2, `${crossings} cycles in one second`);
  const resampler = new Resampler(48_000, 44_100, 1);
  const pieces = [resampler.process([new Float32Array(48_000).map((_, index) => sine(440)(index))]), resampler.process([new Float32Array(0)], true)];
  assert.equal(pieces[0][0].length + pieces[1][0].length, 44_100);
});

test("Mastering limiter — Quiet mix has the same level live and in export", async () => {
  // A mix peaking at 0.5 leaves the limiter at unity gain, sample for sample, after the look-ahead delay.
  const source = sine(440, 0.5);
  const out = await mixdown({ clips: [clip()], read: reader({ a: source }), start: 0, end: 240_000 });
  for (let index = 0; index < out[0].length; index++) if (out[0][index] !== Math.fround(source(index))) assert.fail(`sample ${index}: ${out[0][index]} instead of ${Math.fround(source(index))}`);
  // The class used by the live worklet is the same one, fed in render quanta of 128 frames.
  const live = new Limiter(2, RATE);
  const produced: number[] = [];
  for (let start = 0; start < 4800; start += 128) {
    const block = [new Float32Array(128).map((_, index) => source(start + index)), new Float32Array(128).map((_, index) => source(start + index))];
    live.process(block);
    produced.push(...block[0]);
  }
  for (let index = LIMITER_LOOKAHEAD; index < produced.length; index++) assert.equal(produced[index], out[0][index - LIMITER_LOOKAHEAD]);
});

test("Mastering limiter — Hot mix is limited", async () => {
  // Two full-scale sines overlap across a 10 s block boundary.
  const clips = [clip({ duration: 1_320_000 }), clip({ elementId: "f", assetId: "b", duration: 1_320_000 })];
  const out = await mixdown({ clips, read: reader({ a: sine(440), b: sine(660) }), start: 0, end: 1_320_000 });
  let peak = 0;
  for (const sample of out[0]) peak = Math.max(peak, Math.abs(sample));
  assert.ok(peak <= LIMITER_CEILING, `no output sample exceeds ±0.98 (peak ${peak})`);
  const limit = LIMITER_CEILING * Math.pow(10, 0.1 / 20);
  assert.ok(truePeak(out[0].subarray(0, 2 * RATE)) <= limit, `true peak ${truePeak(out[0].subarray(0, 2 * RATE))} ≤ ${limit}`);
  assert.ok(peak > 0.9, "the mix is limited, not attenuated by a fixed gain");
  // No discontinuity at the block boundary: the step there is no larger than elsewhere.
  let largest = 0;
  for (let index = 1; index < 9 * RATE; index++) largest = Math.max(largest, Math.abs(out[0][index] - out[0][index - 1]));
  for (let index = 10 * RATE - 60; index < 10 * RATE + 60; index++) assert.ok(Math.abs(out[0][index] - out[0][index - 1]) <= largest * 1.01, `step at ${index}`);
});

test("Mastering limiter — Single pass", () => {
  // Each block passes through the limiter once; its state carries across blocks, and reset clears it.
  const whole = new Limiter(1, RATE), split = new Limiter(1, RATE);
  const signal = new Float32Array(4000).map((_, index) => 1.6 * Math.sin(index / 9));
  const a = [signal.slice()];
  whole.process(a);
  const b1 = [signal.slice(0, 1777)], b2 = [signal.slice(1777)];
  split.process(b1);
  split.process(b2);
  assert.deepEqual([...b1[0], ...b2[0]], [...a[0]]);
  split.reset();
  const again = [signal.slice()];
  split.process(again);
  assert.deepEqual(again[0], a[0]);
});
