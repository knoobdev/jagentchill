// Stage 5 of the audio signal chain measured on the rendered mix: the 14 voice effects of `audio-editing.Voice changer` as the DSP chains of its table.
import assert from "node:assert/strict";
import { before, test } from "node:test";
import { createElement, createProjectDocument, createTrack, VOICE_EFFECTS } from "@jagentchill/protocol";
import { butterworth4, collectMixClips, mixBlock, mixdown, MixState, PitchTracker, provideWasm, VOICE_EFFECT_IDS, type SourceReader } from "../src/index.ts";
import { loadWasm } from "./support/wasm.ts";

const RATE = 48_000, SECOND = 120_000;
before(async () => { provideWasm(await loadWasm()); });
type Signal = (frame: number) => number;
const sine = (frequency: number, amplitude = 0.5): Signal => (frame) => amplitude * Math.sin((2 * Math.PI * frequency * frame) / RATE);
const burst = (signal: Signal, seconds: number): Signal => (frame) => (frame < seconds * RATE ? signal(frame) : 0);
const reader = (source: Signal): SourceReader => (_assetId, first, count) => { const data = new Float32Array(count); for (let index = 0; index < count; index++) data[index] = first + index >= 0 ? source(first + index) : 0; return [data, data.slice()]; };
const assetOf = (id: string) => ({ id, name: id, type: "audio", kind: null, size: 1, contentHash: null, rotation: 0, folderId: null, tags: [], ephemeral: false, provenance: { source: "imported" }, motionTracks: [], faces: [], created_ms: 0, hasAudio: true });
function documentWith(element: Record<string, unknown>) {
  const doc = JSON.parse(JSON.stringify(createProjectDocument({ id: "p", mainSceneId: "s", mainTrackId: "main", now_ms: 0 })));
  doc.media.assets.push(assetOf("a"));
  doc.scenes[0].tracks.audio = [{ ...JSON.parse(JSON.stringify(createTrack("audio", { id: "t", name: "t" } as never))), elements: [JSON.parse(JSON.stringify(createElement("audio", { id: "e", name: "x", sourceType: "upload", mediaId: "a", startTime: 0, duration: 2 * SECOND, sourceDuration: 60 * SECOND, ...element } as never)))] }];
  return doc;
}
const render = async (element: Record<string, unknown>, source: Signal, seconds = 2) => (await mixdown({ clips: collectMixClips(documentWith(element) as never, "s"), read: reader(source), start: 0, end: seconds * SECOND }))[0];
const effect = (type: string, intensity = 100) => ({ voiceEffect: { type, intensity } });

/** Power of a channel at a frequency over a span, by a Hann-windowed DFT bin. */
function power(channel: Float32Array, frequency: number, from: number, to: number): number {
  const first = Math.round(from * RATE), count = Math.round((to - from) * RATE);
  let re = 0, im = 0;
  for (let index = 0; index < count; index++) { const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / count), phase = (2 * Math.PI * frequency * index) / RATE; re += channel[first + index] * window * Math.cos(phase); im -= channel[first + index] * window * Math.sin(phase); }
  return (re * re + im * im) / (count * count);
}
const db = (value: number) => 10 * Math.log10(value + 1e-30);
/** The strongest frequency in a range, on a grid of `step` Hz refined by a parabola. */
function dominant(channel: Float32Array, from: number, to: number, low: number, high: number, step = 2.5): number {
  let best = low, bestPower = -1;
  for (let frequency = low; frequency <= high; frequency += step) { const value = power(channel, frequency, from, to); if (value > bestPower) { bestPower = value; best = frequency; } }
  const a = Math.log(power(channel, best - step, from, to) + 1e-30), b = Math.log(bestPower + 1e-30), c = Math.log(power(channel, best + step, from, to) + 1e-30);
  return best + (step * 0.5 * (a - c)) / (a - 2 * b + c);
}
const rmsDb = (channel: Float32Array, from: number, to: number) => { let sum = 0; const first = Math.round(from * RATE), last = Math.round(to * RATE); for (let index = first; index < last; index++) sum += channel[index] ** 2; return 10 * Math.log10(sum / (last - first) + 1e-20); };
const within = (actual: number, expected: number, share: number, label: string) => assert.ok(Math.abs(actual / expected - 1) <= share, `${label}: measured ${actual.toFixed(2)}, expected ${expected.toFixed(2)} ±${share * 100} %`);
const soundEnd = (channel: Float32Array) => { let last = channel.length - 1; while (last > 0 && Math.abs(channel[last]) < 1e-3) last--; return (last + 1) / RATE; };

test("Voice changer — Fifteen tiles: None plus exactly 14 effects; Deep voice: a 220 Hz tone becomes 174.6 Hz and the duration is unchanged; High, Chipmunk and Giant shift by +4, +8 and −8 semitones", async () => {
  assert.deepEqual(["none", ...VOICE_EFFECT_IDS], [...VOICE_EFFECTS]);
  for (const [type, semitones] of [["deep", -4], ["high", 4], ["chipmunk", 8], ["giant", -8]] as const) {
    const out = await render(effect(type), sine(220), 3);
    within(dominant(out, 0.8, 1.2, 100, 500), 220 * 2 ** (semitones / 12), 0.02, type);
    assert.ok(Math.abs(soundEnd(out) - 2) <= 0.001, `${type} keeps the duration: ${soundEnd(out)}`);
    // Deep and High restore the envelope of the source, which for a bare tone is the tone's own peak: the shifted tone sits on its slope.
    assert.ok(Math.abs(rmsDb(out, 0.5, 1.5) - rmsDb(Float32Array.from({ length: RATE }, (_, frame) => sine(220)(frame)), 0, 1)) < (type === "deep" || type === "high" ? 6 : 1), `${type} keeps the level: ${rmsDb(out, 0.5, 1.5)}`);
  }
});

test("Voice changer — Deep and High preserve formants (the spectral envelope is restored after the shift); Chipmunk and Giant move them with the pitch", async () => {
  // A voice-like source: a 150 Hz pulse train through a resonance at 1 200 Hz.
  const samples = new Float32Array(4 * RATE);
  { const w = (2 * Math.PI * 1200) / RATE, r = 0.985; let y1 = 0, y2 = 0; for (let frame = 0; frame < samples.length; frame++) { const x = frame % 320 === 0 ? 1 : 0, y = x + 2 * r * Math.cos(w) * y1 - r * r * y2; y2 = y1; y1 = y; samples[frame] = 0.08 * y; } }
  const voice: Signal = (frame) => (frame >= 0 && frame < samples.length ? samples[frame] : 0);
  /** The centre of the strongest 100 Hz band between 300 Hz and 3 kHz: the formant. */
  const formant = (channel: Float32Array) => { let best = 0, bestPower = -1; for (let centre = 300; centre <= 3000; centre += 25) { let sum = 0; for (let f = centre - 50; f <= centre + 50; f += 10) sum += power(channel, f, 0.8, 1.0); if (sum > bestPower) { bestPower = sum; best = centre; } } return best; };
  assert.ok(Math.abs(formant(await render({}, voice)) - 1200) <= 50, "the source has its formant at 1 200 Hz");
  const deep = await render(effect("deep"), voice), high = await render(effect("high"), voice), giant = await render(effect("giant"), voice), chipmunk = await render(effect("chipmunk"), voice);
  // The fundamental is weak under a 1 200 Hz formant: it is read from the period, as the engine's own tracker does.
  const fundamental = (channel: Float32Array) => { const tracker = new PitchTracker(); for (let frame = RATE / 2; frame < RATE; frame++) tracker.step(channel[frame]); return tracker.hertz!; };
  within(fundamental(deep), 150 * 2 ** (-4 / 12), 0.02, "deep fundamental");
  within(fundamental(high), 150 * 2 ** (4 / 12), 0.02, "high fundamental");
  within(formant(deep), 1200, 0.08, "deep keeps the formant");
  within(formant(high), 1200, 0.08, "high keeps the formant");
  within(formant(giant), 1200 * 2 ** (-8 / 12), 0.08, "giant moves the formant down");
  within(formant(chipmunk), 1200 * 2 ** (8 / 12), 0.08, "chipmunk moves the formant up");
});

test("Voice changer — Intensity mix: Echo at intensity 0 equals the unprocessed audio; Echo is a 250 ms feedback delay (0.4) at 0.5; Hall decays with an RT60 of 2.5 s; Megaphone clips at −6 dBFS and slaps back after 60 ms at −9 dB", async () => {
  const tone = burst(sine(1000), 0.1);
  const plain = await render({}, tone, 3), zero = await render(effect("echo", 0), tone, 3);
  assert.deepEqual(zero, plain);
  const echo = await render({ duration: 3 * SECOND, ...effect("echo") }, tone, 3);
  const level = (channel: Float32Array, at: number) => rmsDb(channel, at + 0.02, at + 0.08);
  assert.ok(Math.abs(level(echo, 0) - level(plain, 0)) < 0.2, "the direct sound is unchanged");
  assert.ok(Math.abs(level(echo, 0.25) - level(plain, 0) + 6.02) < 0.3, `first echo at −6 dB: ${level(echo, 0.25) - level(plain, 0)}`);
  assert.ok(Math.abs(level(echo, 0.5) - level(echo, 0.25) + 7.96) < 0.3, `feedback 0.4: ${level(echo, 0.5) - level(echo, 0.25)}`);
  assert.ok(level(echo, 0.15) < -80, "silence between the echoes");
  // Half intensity: the echoes are 6 dB lower, the direct sound the same.
  const halfEcho = await render({ duration: 3 * SECOND, ...effect("echo", 50) }, tone, 3);
  assert.ok(Math.abs(level(halfEcho, 0.25) - level(echo, 0.25) + 6.02) < 0.3 && Math.abs(level(halfEcho, 0) - level(plain, 0)) < 0.2);
  // Hall: 60 dB in 2.5 s is 24 dB per second of tail.
  // Measured on a noise burst: on a single tone the four combs beat against each other.
  let state = 7;
  const noiseSamples = Float32Array.from({ length: 4800 }, () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return (state / 2147483648 - 1) * 0.5; });
  const hall = await render({ duration: 3 * SECOND, ...effect("hall") }, (frame) => (frame >= 0 && frame < 4800 ? noiseSamples[frame] : 0), 3);
  const decay = rmsDb(hall, 0.4, 0.7) - rmsDb(hall, 1.4, 1.7);
  assert.ok(Math.abs(decay - 24) < 2, `hall decays ${decay.toFixed(1)} dB in a second`);
  assert.ok(rmsDb(hall, 0.3, 0.5) - rmsDb(hall, 0, 0.1) < -8, "the tail is below the direct sound (wet 0.35)");
  // Megaphone: a loud tone inside the band is clipped at 0.501, and a burst comes back once, 60 ms later, 9 dB down.
  const loud = await render(effect("megaphone"), sine(1500, 0.9), 1);
  let peak = 0;
  for (let index = RATE / 4; index < RATE / 2; index++) peak = Math.max(peak, Math.abs(loud[index]));
  assert.ok(peak <= 0.5012 * 1.3549 + 1e-3 && peak > 0.5, `clipped at −6 dBFS plus its slap: ${peak}`);
  const short = burst(sine(1500, 0.2), 0.03), slap = await render(effect("megaphone"), short, 1);
  assert.ok(Math.abs(rmsDb(slap, 0.065, 0.085) - rmsDb(slap, 0.005, 0.025) + 9) < 1, `slap at −9 dB: ${rmsDb(slap, 0.065, 0.085) - rmsDb(slap, 0.005, 0.025)}`);
  assert.ok(rmsDb(slap, 0.13, 0.15) < rmsDb(slap, 0.065, 0.085) - 30, "a single slap");
});

test("Voice changer — Telephone band: the filter stage at 100 Hz and at 8 kHz is at least 24 dB below 1 kHz; the Telephone and Megaphone bands in the rendered effect; Robot is a 50 Hz ring modulation into an 8 ms comb; Tremble is a 6 Hz tremolo of depth 0.6; Underwater is a 500 Hz low-pass with a chorus", async () => {
  // The filter stage alone, before the soft clip, fed sines at −20 dBFS.
  const stage = (frequency: number) => { const filters = [...butterworth4("high", 300), ...butterworth4("low", 3400)]; let sum = 0; for (let frame = 0; frame < RATE; frame++) { let y = 0.1 * Math.sin((2 * Math.PI * frequency * frame) / RATE); for (const filter of filters) y = filter.step(y); if (frame >= RATE / 2) sum += y * y; } return 10 * Math.log10(sum / (RATE / 2)); };
  assert.ok(stage(1000) - stage(100) >= 24 && stage(1000) - stage(8000) >= 24, `telephone band: ${[stage(100), stage(1000), stage(8000)].map((value) => value.toFixed(1))}`);
  assert.ok(Math.abs(stage(1000) + 23.01) < 0.5, "1 kHz passes at its level");
  const through = async (type: string, frequency: number) => rmsDb(await render(effect(type), sine(frequency, 0.05), 1), 0.5, 1);
  assert.ok((await through("telephone", 1000)) - (await through("telephone", 100)) > 24 && (await through("telephone", 1000)) - (await through("telephone", 8000)) > 24);
  assert.ok((await through("megaphone", 1500)) - (await through("megaphone", 150)) > 24 && (await through("megaphone", 1500)) - (await through("megaphone", 12000)) > 24);
  // tanh(2x): a quiet tone gains 6 dB, a loud one is held below full scale.
  assert.ok(Math.abs((await through("telephone", 1000)) - rmsDb(Float32Array.from({ length: RATE }, (_, frame) => sine(1000, 0.05)(frame)), 0, 1) - 6) < 0.5);
  // Robot: a 1 kHz tone becomes the two sidebands at 950 and 1 050 Hz; the carrier is gone.
  const robot = await render(effect("robot"), sine(1000), 1);
  const side = db(power(robot, 950, 0.5, 0.9)), other = db(power(robot, 1050, 0.5, 0.9)), carrier = db(power(robot, 1000, 0.5, 0.9));
  assert.ok(side - carrier > 30 && other - carrier > 30, `ring modulation: ${[side, carrier, other].map((value) => value.toFixed(1))}`);
  // The comb of 8 ms and gain 0.7: 937.5 Hz sits on a peak (1.7) and 1 000 Hz in a trough (0.3) of 125 Hz teeth.
  const comb = async (frequency: number) => db(power(await render(effect("robot"), sine(frequency + 50), 1), frequency, 0.5, 0.9));
  assert.ok(Math.abs((await comb(1000)) - (await comb(937.5)) - 20 * Math.log10(1.7 / 0.3)) < 1.5, `comb: ${(await comb(1000)) - (await comb(937.5))}`);
  // Tremble: the envelope swings between 1 and 0.4 six times a second.
  const tremble = await render(effect("tremble"), sine(1000), 2);
  const envelope = Float32Array.from({ length: 400 }, (_, index) => 10 ** (rmsDb(tremble, 0.5 + index / 400, 0.5 + (index + 1) / 400) / 20));
  const max = Math.max(...envelope), min = Math.min(...envelope);
  assert.ok(Math.abs(min / max - 0.4) < 0.03, `depth 0.6: ${min / max}`);
  const mean = envelope.reduce((sum, value) => sum + value, 0) / envelope.length;
  const rhythm = (hertz: number) => { let re = 0, im = 0; envelope.forEach((value, index) => { re += (value - mean) * Math.cos((2 * Math.PI * hertz * index) / 400); im += (value - mean) * Math.sin((2 * Math.PI * hertz * index) / 400); }); return Math.hypot(re, im); };
  assert.ok(rhythm(6) > 10 * Math.max(rhythm(5), rhythm(7), rhythm(12)), "6 Hz sine");
  // Underwater: two octaves above 500 Hz is 24 dB down; 100 Hz passes (the chorus adds up to 3.5 dB).
  assert.ok((await through("underwater", 100)) - (await through("underwater", 2000)) > 18);
  const under = await render(effect("underwater"), sine(100, 0.05), 1);
  assert.ok(Math.abs(rmsDb(under, 0.3, 1) - rmsDb(Float32Array.from({ length: RATE }, (_, frame) => sine(100, 0.05)(frame)), 0, 1)) < 4);
});

test("Voice changer — Deterministic vinyl noise: two renders are sample-identical and another element has other crackle; crackle at −30 dBFS; band-limit 100 Hz – 7 kHz; wow of ±0.3 % at 0.5 Hz", async () => {
  const silence: Signal = () => 0;
  const one = await render(effect("vinyl"), silence), again = await render(effect("vinyl"), silence), other = await render({ id: "other", ...effect("vinyl") }, silence);
  assert.deepEqual(one, again);
  assert.notDeepEqual(one.subarray(0, 4800), other.subarray(0, 4800));
  assert.ok(Math.abs(rmsDb(one, 0.1, 1.9) + 30) < 1, `crackle at −30 dBFS: ${rmsDb(one, 0.1, 1.9)}`);
  const tone = async (frequency: number) => db(power(await render(effect("vinyl"), sine(frequency, 0.5)), frequency, 0.5, 1.5));
  assert.ok((await tone(1000)) - (await tone(40)) > 12 && (await tone(1000)) - (await tone(14000)) > 10, "band-limited");
  // The pitch swings ±0.3 %: at the fastest and the slowest moment of the 2 s cycle a 2 kHz tone measures 2 006 and 1 994 Hz.
  const wow = await render({ duration: 4 * SECOND, ...effect("vinyl") }, sine(2000, 0.5), 4);
  const fast = dominant(wow, 0.4, 0.6, 1980, 2020, 1), slow = dominant(wow, 1.4, 1.6, 1980, 2020, 1);
  assert.ok(Math.abs(Math.abs(fast - slow) - 12) < 3 && Math.abs((fast + slow) / 2 - 2000) < 2, `wow: ${fast.toFixed(1)} and ${slow.toFixed(1)}`);
});

test("Voice changer — Electronic quantises the pitch to the nearest equal-tempered semitone (A4 = 440 Hz); Synth is a 16-band vocoder with a sawtooth carrier at the detected pitch, 110 Hz when unvoiced", async () => {
  // The tracker: 60–500 Hz by autocorrelation, nothing for noise.
  const track = (signal: Signal) => { const tracker = new PitchTracker(); for (let frame = 0; frame < RATE / 2; frame++) tracker.step(signal(frame)); return tracker.hertz; };
  for (const hertz of [70, 150, 233, 450]) within(track(sine(hertz))!, hertz, 0.005, `tracked ${hertz} Hz`);
  let seed = 1;
  const noise: Signal = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed / 2147483648 - 1) * 0.3; };
  assert.equal(track(noise), null);
  // 450 Hz is nearest to A4; 500 Hz is nearest to B4 (493.88 Hz); a tone on a semitone stays.
  within(dominant(await render(effect("electronic"), sine(450)), 1, 1.4, 400, 520, 1), 440, 0.01, "450 Hz snaps to 440");
  within(dominant(await render(effect("electronic"), sine(500)), 1, 1.4, 400, 560, 1), 493.88, 0.01, "500 Hz snaps to 493.88");
  within(dominant(await render(effect("electronic"), sine(440)), 1, 1.4, 400, 520, 1), 440, 0.003, "440 Hz stays");
  // Synth on a voiced sound: harmonics of the tracked 200 Hz, a sawtooth (every harmonic present), shaped by the input's bands.
  const voiced: Signal = (frame) => { let sum = 0; for (let harmonic = 1; harmonic <= 10; harmonic += 2) sum += Math.sin((2 * Math.PI * 200 * harmonic * frame) / RATE) / harmonic; return 0.3 * sum; };
  const synth = await render(effect("synth"), voiced);
  within(dominant(synth, 1, 1.4, 150, 260, 1), 200, 0.01, "carrier at the detected pitch");
  // The source has odd harmonics only; the carrier's 2nd harmonic at 400 Hz is there because the carrier is a sawtooth.
  assert.ok(db(power(synth, 400, 1, 1.4)) > db(power(synth, 200, 1, 1.4)) - 25 && db(power(await render({}, voiced), 400, 1, 1.4)) < db(power(synth, 400, 1, 1.4)) - 30, "sawtooth carrier");
  assert.ok(Math.abs(rmsDb(synth, 1, 1.5) - rmsDb(await render({}, voiced), 1, 1.5)) < 9, `level in the range of the source: ${rmsDb(synth, 1, 1.5)}`);
  // Unvoiced: the carrier is at 110 Hz, and the noise's wide spectrum opens all bands.
  const hiss = await render(effect("synth"), noise);
  const comb = [110, 220, 330, 440].map((hertz) => db(power(hiss, hertz, 1, 1.5))), between = [165, 275, 385].map((hertz) => db(power(hiss, hertz, 1, 1.5)));
  assert.ok(Math.min(...comb) > Math.max(...between) + 15, `110 Hz carrier: ${comb.map((value) => value.toFixed(0))} against ${between.map((value) => value.toFixed(0))}`);
});

test("Voice changer — playback and export use the same chain: live-sized blocks carried by one state equal the whole mix sample for sample, for an effect with memory (Echo), one with latency (Deep) and one with a pitch tracker (Electronic)", async () => {
  for (const type of ["echo", "deep", "electronic", "vinyl"]) {
    const clips = collectMixClips(documentWith(effect(type, 80)) as never, "s"), read = reader(sine(330));
    const whole = await mixBlock(clips, read, 0, RATE, 2 * RATE, new MixState());
    const state = new MixState(), live = new Float32Array(RATE);
    for (let start = 0; start < RATE; start += 12_000) live.set((await mixBlock(clips, read, start, 12_000, 2 * RATE, state))[0], start);
    assert.deepEqual(live, whole[0], type);
  }
});
