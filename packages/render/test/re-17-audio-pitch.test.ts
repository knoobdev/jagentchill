// Stage 4 of the audio signal chain measured on the rendered mix: pitch-preserving retime (WSOLA, wasm) and pitch shift, in the export mixdown and in live-sized blocks.
import assert from "node:assert/strict";
import { before, test } from "node:test";
import { createElement, createProjectDocument, createTrack } from "@jagentchill/protocol";
import { collectMixClips, mixBlock, mixdown, MixState, pitchPreservation, provideWasm, type SourceReader } from "../src/index.ts";
import { loadWasm } from "./support/wasm.ts";

const RATE = 48_000, SECOND = 120_000;
before(async () => { provideWasm(await loadWasm()); });

type Signal = (frame: number) => number;
const sine = (frequency: number, amplitude = 0.5): Signal => (frame) => amplitude * Math.sin((2 * Math.PI * frequency * frame) / RATE);
const reader = (source: Signal): SourceReader => (_assetId, first, count) => {
  const data = new Float32Array(count);
  for (let index = 0; index < count; index++) data[index] = first + index >= 0 ? source(first + index) : 0;
  return [data, data.slice()];
};
const assetOf = (id: string) => ({ id, name: id, type: "audio", kind: null, size: 1, contentHash: null, rotation: 0, folderId: null, tags: [], ephemeral: false, provenance: { source: "imported" }, motionTracks: [], faces: [], created_ms: 0, hasAudio: true });
function documentWith(element: Record<string, unknown>) {
  const doc = JSON.parse(JSON.stringify(createProjectDocument({ id: "p", mainSceneId: "s", mainTrackId: "main", now_ms: 0 })));
  doc.media.assets.push(assetOf("a"));
  doc.scenes[0].tracks.audio = [{ ...JSON.parse(JSON.stringify(createTrack("audio", { id: "t", name: "t" } as never))), elements: [JSON.parse(JSON.stringify(createElement("audio", { id: "e", name: "x", sourceType: "upload", mediaId: "a", startTime: 0, duration: 2 * SECOND, sourceDuration: 60 * SECOND, ...element } as never)))] }];
  return doc;
}
const render = async (element: Record<string, unknown>, source: Signal, seconds: number) => (await mixdown({ clips: collectMixClips(documentWith(element) as never, "s"), read: reader(source), start: 0, end: seconds * SECOND }))[0];

/** Dominant frequency between two times: the peak of a Hann-windowed spectrum, refined by parabolic interpolation. */
function dominant(channel: Float32Array, from: number, to: number, low = 60, high = 6000): number {
  // At most 0.4 s about the middle of the range: enough for 1 Hz after refinement.
  const span = Math.min(to - from, 0.4), first = Math.round(((from + to - span) / 2) * RATE), count = Math.round(span * RATE);
  const power = (frequency: number) => {
    let re = 0, im = 0;
    for (let index = 0; index < count; index++) { const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / count), phase = (2 * Math.PI * frequency * index) / RATE; re += channel[first + index] * window * Math.cos(phase); im -= channel[first + index] * window * Math.sin(phase); }
    return re * re + im * im;
  };
  const step = RATE / count;
  let best = low, bestPower = -1;
  for (let frequency = low; frequency <= high; frequency += step) { const value = power(frequency); if (value > bestPower) { bestPower = value; best = frequency; } }
  const a = Math.log(power(best - step) + 1e-30), b = Math.log(bestPower + 1e-30), c = Math.log(power(best + step) + 1e-30);
  return best + (step * 0.5 * (a - c)) / (a - 2 * b + c);
}
const rmsDb = (channel: Float32Array, from: number, to: number) => { let sum = 0; const first = Math.round(from * RATE), last = Math.round(to * RATE); for (let index = first; index < last; index++) sum += channel[index] ** 2; return 10 * Math.log10(sum / (last - first) + 1e-20); };
/** Time in seconds of the last frame louder than −60 dBFS. */
const soundEnd = (channel: Float32Array) => { let last = channel.length - 1; while (last > 0 && Math.abs(channel[last]) < 1e-3) last--; return (last + 1) / RATE; };
const within = (actual: number, expected: number, share: number, label: string) => assert.ok(Math.abs(actual / expected - 1) <= share, `${label}: measured ${actual.toFixed(2)}, expected ${expected} ±${share * 100} %`);
/**
 * How far from the time map an event of the source may land, in output seconds: a 32 ms segment plays at the source's
 * own speed about the map and is sought within 7.5 ms of it, and the source advances `rate` times as fast as the output.
 */
const eventSlack = (rate: number) => (0.016 + 0.0075) / rate + 0.001;
/** A source that is a tone for `seconds` and silent after: the place its end lands at tells how long the audio lasts. */
const burst = (frequency: number, seconds: number): Signal => (frame) => (frame < seconds * RATE ? sine(frequency)(frame) : 0);

test("Pitch preservation — Keep pitch at 2×: a 440 Hz tone still measures 440 Hz and lasts half as long; Pitch follows speed: 880 Hz with Keep pitch off", async () => {
  // 4 s of tone in the source, played at 2× inside a clip of 2.5 s: the sound ends at 2 s.
  const kept = await render({ duration: 2.5 * SECOND, retime: { rate: 2 }, maintainPitch: true }, burst(440, 4), 3);
  within(dominant(kept, 0.25, 1.75), 440, 0.02, "keep pitch at 2×");
  assert.ok(Math.abs(soundEnd(kept) - 2) <= eventSlack(2), `the 4 s tone lasts 2 s: ${soundEnd(kept)}`);
  assert.ok(Math.abs(rmsDb(kept, 0.25, 1.75) - rmsDb(Float32Array.from({ length: RATE }, (_, frame) => sine(440)(frame)), 0, 1)) < 0.5, "the level is kept");
  const whole = await render({ duration: 2 * SECOND, retime: { rate: 2 }, maintainPitch: true }, sine(440), 3);
  assert.ok(Math.abs(soundEnd(whole) - 2) <= 0.001, `a 2 s clip sounds for 2 s ±1 ms: ${soundEnd(whole)}`);
  const followed = await render({ duration: 2 * SECOND, retime: { rate: 2 }, maintainPitch: false }, sine(440), 3);
  within(dominant(followed, 0.25, 1.75), 880, 0.02, "pitch follows speed");
});

test("Pitch preservation — Stretch at the range boundary: 0.25× keeps 440 Hz and lasts four times as long; Outside the stretch range: 8× is resampled; Curve crossing the range; Speed and pitch shift together", async () => {
  const slow = await render({ duration: 4.5 * SECOND, retime: { rate: 0.25 }, maintainPitch: true }, burst(440, 1), 5);
  within(dominant(slow, 0.5, 3.5), 440, 0.02, "keep pitch at 0.25×");
  assert.ok(Math.abs(soundEnd(slow) - 4) <= eventSlack(0.25), `1 s of tone lasts 4 s: ${soundEnd(slow)}`);
  const fast = await render({ duration: 1 * SECOND, retime: { rate: 8 }, maintainPitch: true }, sine(440), 1);
  within(dominant(fast, 0.2, 0.8), 3520, 0.02, "8× is resampled");
  const retimeOf = (retime: Record<string, unknown>, duration = 2 * SECOND) => ({ sourceStart: 0, sourceSpan: 60 * SECOND, duration, retime });
  assert.deepEqual(pitchPreservation({ maintainPitch: true }, retimeOf({ rate: 8 })), { kept: false, dropped: true });
  assert.deepEqual(pitchPreservation({ maintainPitch: true }, retimeOf({ rate: 4 })), { stretch: { keepPitch: true, pitchFactor: 1 }, kept: true, dropped: false });
  assert.deepEqual(pitchPreservation({ maintainPitch: true }, retimeOf({ rate: 1 })), { kept: false, dropped: false });
  // A curve from 0.5× to 5.5×: the whole clip is resampled, no part is stretched.
  const bullet = pitchPreservation({ maintainPitch: true }, { sourceStart: 0, sourceSpan: 6 * SECOND, duration: 2 * SECOND, retime: { curve: [{ u: 0, rate: 5.5 }, { u: 0.5, rate: 0.5 }, { u: 1, rate: 5.5 }] as never } });
  assert.deepEqual([bullet.kept, bullet.dropped, bullet.stretch], [false, true, undefined]);
  // 4× with +12 semitones is a combined factor of 8: the retime is resampled and the shift alone is stretched by 2.
  const both = pitchPreservation({ maintainPitch: true, pitch: { semitones: 12, cents: 0 } }, retimeOf({ rate: 4 }));
  assert.deepEqual(both, { stretch: { keepPitch: false, pitchFactor: 2 }, kept: false, dropped: true });
  const combined = await render({ duration: 1 * SECOND, retime: { rate: 4 }, maintainPitch: true, pitch: { semitones: 12, cents: 0 } }, sine(220), 1);
  within(dominant(combined, 0.2, 0.8), 220 * 4 * 2, 0.02, "4× resampled and one octave up");
});

test("Audio pitch shift — Up an octave: 880 Hz and the duration unchanged; Fine control: 50 cents; Combined with speed: 2× with Keep pitch and −2 semitones", async () => {
  const octave = await render({ duration: 2.5 * SECOND, pitch: { semitones: 12, cents: 0 } }, burst(440, 2), 3);
  within(dominant(octave, 0.25, 1.75), 880, 0.02, "+12 semitones");
  assert.ok(Math.abs(soundEnd(octave) - 2) <= eventSlack(1), `the duration is unchanged: ${soundEnd(octave)}`);
  const clipEnd = await render({ duration: 2 * SECOND, pitch: { semitones: 12, cents: 0 } }, sine(440), 3);
  assert.ok(Math.abs(soundEnd(clipEnd) - 2) <= 0.001, `the clip sounds for its 2 s ±1 ms: ${soundEnd(clipEnd)}`);
  const down = await render({ duration: 2 * SECOND, pitch: { semitones: -12, cents: 0 } }, sine(440), 2);
  within(dominant(down, 0.25, 1.75), 220, 0.02, "−12 semitones");
  const cents = await render({ duration: 2 * SECOND, pitch: { semitones: 0, cents: 50 } }, sine(440), 2);
  within(dominant(cents, 0.25, 1.75), 452.9, 0.01, "+50 cents");
  const both = await render({ duration: 2.5 * SECOND, retime: { rate: 2 }, maintainPitch: true, pitch: { semitones: -2, cents: 0 } }, burst(440, 4), 3);
  within(dominant(both, 0.25, 1.75), 440 * 2 ** (-2 / 12), 0.02, "2× keep pitch, −2 semitones");
  assert.ok(Math.abs(soundEnd(both) - 2) <= eventSlack(2), `it lasts half as long: ${soundEnd(both)}`);
  // No shift and no speed change: the samples of the source, untouched.
  const plain = await render({ duration: 1 * SECOND, pitch: { semitones: 0, cents: 0 }, maintainPitch: true }, sine(440), 1);
  assert.ok(plain.subarray(0, RATE).every((value, frame) => Math.abs(value - sine(440)(frame)) < 1e-6), "a neutral pitch is not processed");
});

test("Pitch preservation — a speech-like signal (gliding harmonics in syllables) keeps its pitch contour, level and envelope, with no click at a join; a reversed clip and a speed curve stretch as well", async () => {
  // A voiced sound: 12 harmonics of a fundamental gliding 110 → 180 Hz, in 4 Hz syllables.
  const phase = (frame: number) => { const t = frame / RATE; return 2 * Math.PI * (110 * t + (70 * t * t) / (2 * 4)); };
  const voice: Signal = (frame) => { const envelope = 0.55 + 0.45 * Math.sin((2 * Math.PI * 4 * frame) / RATE); let sum = 0; for (let harmonic = 1; harmonic <= 12; harmonic++) sum += Math.sin(harmonic * phase(frame)) / harmonic; return 0.2 * envelope * sum; };
  const source = Float32Array.from({ length: 4 * RATE }, (_, frame) => voice(frame));
  for (const rate of [0.5, 1.5, 2]) {
    const seconds = 3 / rate > 2 ? 2 : 3 / rate;
    const out = await render({ duration: seconds * SECOND, retime: { rate }, maintainPitch: true }, voice, seconds);
    // The fundamental at output time t is the source's at t × rate.
    for (const at of [0.4, 0.9]) within(dominant(out, at - 0.1, at + 0.1, 80, 260), 110 + (70 * at * rate) / 4, 0.04, `fundamental at ${at} s, ${rate}×`);
    assert.ok(Math.abs(rmsDb(out, 0.25, seconds - 0.25) - rmsDb(source, 0.25 * rate, (seconds - 0.25) * rate)) < 1, `level at ${rate}×`);
    // A click is a jump between neighbouring samples far beyond anything the source has.
    let jump = 0, sourceJump = 0;
    for (let index = 1; index < Math.round(seconds * RATE) - 1; index++) jump = Math.max(jump, Math.abs(out[index] - out[index - 1]));
    for (let index = 1; index < source.length; index++) sourceJump = Math.max(sourceJump, Math.abs(source[index] - source[index - 1]));
    assert.ok(jump <= sourceJump * 1.5, `no click at ${rate}×: largest step ${jump.toFixed(4)} against ${sourceJump.toFixed(4)} in the source`);
    // The syllable rate follows the speed: the envelope has its 4 Hz × rate rhythm.
    const envelope = Float32Array.from({ length: Math.floor(seconds * 200) }, (_, index) => 10 ** (rmsDb(out, index / 200, (index + 1) / 200) / 20));
    const mean = envelope.reduce((sum, value) => sum + value, 0) / envelope.length;
    const strength = (frequency: number) => { let re = 0, im = 0; envelope.forEach((value, index) => { re += (value - mean) * Math.cos((2 * Math.PI * frequency * index) / 200); im += (value - mean) * Math.sin((2 * Math.PI * frequency * index) / 200); }); return Math.hypot(re, im); };
    assert.ok(strength(4 * rate) > 3 * strength(4 * rate * 1.5), `syllables at ${4 * rate} Hz, ${rate}×`);
  }
  // Reversed at 2× with the pitch kept: a steady tone stays at its pitch.
  const reversed = await render({ duration: 1 * SECOND, trimStart: 0, sourceDuration: 2 * SECOND, retime: { rate: 2, reverse: true }, maintainPitch: true }, sine(440), 1);
  within(dominant(reversed, 0.2, 0.8), 440, 0.02, "reversed, keep pitch");
  // A curve inside the range (1× → 3× → 1×): the pitch is kept all along.
  const curved = await render({ duration: 1 * SECOND, sourceDuration: 2 * SECOND, retime: { rate: 1, curve: { preset: "custom", points: [{ u: 0, rate: 1 }, { u: 0.5, rate: 3 }, { u: 1, rate: 1 }] } }, maintainPitch: true }, sine(440), 1);
  for (const at of [0.2, 0.5, 0.8]) within(dominant(curved, at - 0.1, at + 0.1), 440, 0.02, `speed curve at ${at} s`);
});

test("Pitch preservation — the setting applies identically in preview and export: live-sized blocks carried by one state equal the export mix sample for sample; a block mixed on its own (a scrub) is the same sound", async () => {
  const clips = collectMixClips(documentWith({ duration: 2 * SECOND, retime: { rate: 1.5 }, maintainPitch: true, pitch: { semitones: 3, cents: 0 } }) as never, "s");
  const read = reader(sine(330));
  const whole = await mixBlock(clips, read, 0, 2 * RATE, 2 * RATE, new MixState());
  // The live output mixes 0.25 s chunks.
  const state = new MixState(), live = new Float32Array(2 * RATE);
  for (let start = 0; start < 2 * RATE; start += 12_000) live.set((await mixBlock(clips, read, start, 12_000, 2 * RATE, state))[0], start);
  assert.deepEqual(live, whole[0], "chunked and whole mixes are identical");
  assert.deepEqual((await mixBlock(clips, read, 0, 2 * RATE, 2 * RATE, new MixState()))[0], whole[0], "a repeat run is sample-identical");
  // Playback started in the middle of the clip: the same pitch from its first block.
  const seeked = await mixBlock(clips, read, RATE, RATE / 2, 2 * RATE, new MixState());
  within(dominant(seeked[0], 0.05, 0.45), 330 * 2 ** (3 / 12), 0.02, "after a seek");
  const snippet = await mixBlock(clips, read, RATE, 3840);
  assert.ok(rmsDb(snippet[0], 0, 0.08) > -12, "a scrub snippet sounds");
});
