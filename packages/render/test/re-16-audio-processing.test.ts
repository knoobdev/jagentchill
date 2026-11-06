// Stages 2 and 6–8 and 13 of the audio signal chain, measured on the rendered mix: equaliser, compressor, normalisation gain, ducking, stems.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, createProjectDocument, createTrack } from "@jagentchill/protocol";
import { collectMixClips, Compressor, EQ_PRESET_BANDS, measureLoudness, mixBlock, mixdown, MixState, normalizeGainDb, type SourceReader } from "../src/index.ts";

const RATE = 48_000, SECOND = 120_000;
const sine = (frequency: number, amplitude = 1) => (frame: number) => amplitude * Math.sin((2 * Math.PI * frequency * frame) / RATE);
const reader = (sources: Record<string, (frame: number) => number>): SourceReader => (assetId, first, count) => {
  const data = new Float32Array(count);
  for (let index = 0; index < count; index++) data[index] = first + index >= 0 ? sources[assetId](first + index) : 0;
  return [data, data.slice()];
};
/** RMS level in dBFS of a channel between two times in seconds. */
const level = (channel: Float32Array, from: number, to: number): number => {
  let sum = 0;
  const first = Math.round(from * RATE), last = Math.round(to * RATE);
  for (let index = first; index < last; index++) sum += channel[index] * channel[index];
  return 10 * Math.log10(sum / (last - first) + 1e-20);
};
const assetOf = (id: string) => ({ id, name: id, type: "audio", kind: null, size: 1, contentHash: null, rotation: 0, folderId: null, tags: [], ephemeral: false, provenance: { source: "imported" }, motionTracks: [], faces: [], created_ms: 0, hasAudio: true });
function documentWith(tracks: { id: string; ducking?: Record<string, unknown>; elements: Record<string, unknown>[] }[], assets = ["a", "voice"]) {
  const doc = JSON.parse(JSON.stringify(createProjectDocument({ id: "p", mainSceneId: "s", mainTrackId: "main", now_ms: 0 })));
  doc.media.assets.push(...assets.map(assetOf));
  doc.scenes[0].tracks.audio = tracks.map((track) => ({
    ...JSON.parse(JSON.stringify(createTrack("audio", { id: track.id, name: track.id, ...(track.ducking ? { ducking: track.ducking } : {}) } as never))),
    elements: track.elements.map((element) => JSON.parse(JSON.stringify(createElement("audio", { name: "x", sourceType: "upload", mediaId: "a", startTime: 0, duration: 4 * SECOND, sourceDuration: 60 * SECOND, ...element } as never)))),
  }));
  return doc;
}
const render = async (doc: unknown, sources: Record<string, (frame: number) => number>, seconds: number) => mixdown({ clips: collectMixClips(doc as never, "s"), read: reader(sources), start: 0, end: seconds * SECOND });

test("Equaliser, compressor and ducking — EQ band: with the 1 kHz band at +6 dB a 1 kHz tone is 6 dB louder and a 100 Hz tone changes by less than 1 dB; the settings are read from the document; a disabled or flat equaliser changes nothing", async () => {
  const bands = (mid: number) => ({ eq: { enabled: true, preset: "custom", bands: { low: 0, lowMid: 0, mid, highMid: 0, high: 0 } } });
  const at = async (frequency: number, element: Record<string, unknown>) => level((await render(documentWith([{ id: "t", elements: [{ id: "e", ...element }] }]), { a: sine(frequency, 0.1) }, 2))[0], 1, 2);
  const flat = await at(1000, {});
  assert.ok(Math.abs((await at(1000, bands(6))) - flat - 6) <= 0.5, "1 kHz is 6 dB louder");
  assert.ok(Math.abs((await at(100, bands(6))) - (await at(100, {}))) < 1, "100 Hz changes by less than 1 dB");
  assert.ok(Math.abs((await at(1000, bands(-12))) - flat + 12) <= 0.5, "a cut of 12 dB");
  assert.equal(await at(1000, { eq: { enabled: false, preset: "custom", bands: { low: 0, lowMid: 0, mid: 6, highMid: 0, high: 0 } } }), flat, "a disabled equaliser is not run");
  assert.equal(await at(1000, bands(0)), flat, "a flat equaliser is not run");
  // The shelves: +6 dB at 100 Hz lifts 50 Hz by about 6 dB and leaves 3 kHz alone; the presets are the table's.
  const lowShelf = { eq: { enabled: true, preset: "custom", bands: { low: 6, lowMid: 0, mid: 0, highMid: 0, high: 0 } } };
  assert.ok(Math.abs((await at(30, lowShelf)) - (await at(30, {})) - 6) <= 0.7 && Math.abs((await at(3000, lowShelf)) - (await at(3000, {}))) < 0.3);
  assert.deepEqual(EQ_PRESET_BANDS.radio, { low: -12, lowMid: -3, mid: 3, highMid: 5, high: -9 });
  assert.deepEqual(Object.keys(EQ_PRESET_BANDS), ["flat", "voice-clarity", "bass-boost", "treble-boost", "warm", "radio"]);
  const radio = { eq: { enabled: true, preset: "radio", bands: EQ_PRESET_BANDS.radio } };
  // A shelf has half its gain at its corner: the −12 dB shelf is about −6 dB at 100 Hz and nearly all there at 30 Hz.
  assert.ok((await at(100, radio)) - (await at(100, {})) < -5.5 && (await at(30, radio)) - (await at(30, {})) < -10 && (await at(3000, radio)) - (await at(3000, {})) > 3);
});

test("Equaliser, compressor and ducking — the compressor reduces the level above its threshold by (level − threshold) × (1 − 1 / ratio), follows its attack and release, and adds its make-up gain", async () => {
  const compressor = (fields: Record<string, unknown> = {}) => ({ compressor: { enabled: true, threshold: -18, ratio: 3, attack: 10, release: 120, makeup: 0, ...fields } });
  // A tone with a peak of −6 dBFS: 12 dB above the threshold, reduced by 8 dB.
  const peak = Math.pow(10, -6 / 20);
  const run = async (element: Record<string, unknown>, amplitude = peak) => (await render(documentWith([{ id: "t", elements: [{ id: "e", ...element }] }]), { a: sine(1000, amplitude) }, 2))[0];
  const dry = level(await run({}), 1, 2), wet = await run(compressor());
  // The static curve, on a level held at −6 dBFS: (−18 − −6) × (1 − 1/3) = −8 dB.
  const held = new Compressor({ threshold: -18, ratio: 3, attack: 10, release: 120, makeup: 0 });
  let gain = 1;
  for (let index = 0; index < RATE; index++) gain = held.gain(peak, -peak);
  assert.ok(Math.abs(20 * Math.log10(gain) + 8) < 0.001, `static reduction of 8 dB (${20 * Math.log10(gain)})`);
  // On a tone the peak detector follows the wave, so the smoothed reduction settles a little under the static 8 dB.
  const reduction = level(wet, 1, 2) - dry;
  assert.ok(reduction < -6.5 && reduction > -8.05, `reduction on a tone (${reduction.toFixed(2)} dB)`);
  // Attack: in the first millisecond the reduction has barely begun; after five attack times it is there.
  assert.ok(level(wet, 0, 0.001) - level(await run({}), 0, 0.001) > -1.5);
  assert.ok(Math.abs(level(wet, 0.06, 0.1) - level(wet, 1, 2)) <= 0.3, "settled after a few attack times");
  assert.ok(Math.abs(level(await run(compressor({ makeup: 6 })), 1, 2) - level(wet, 1, 2) - 6) <= 0.01, "make-up gain of 6 dB");
  // Below the threshold nothing changes; ratio 1 is unity.
  const quiet = Math.pow(10, -30 / 20);
  assert.ok(Math.abs(level(await run(compressor(), quiet), 1, 2) - level(await run({}, quiet), 1, 2)) < 0.01);
  assert.ok(Math.abs(level(await run(compressor({ ratio: 1 })), 1, 2) - dry) < 0.01);
  // Release: a loud second followed by a quiet one — the quiet part recovers within a few release times.
  const stepped = (frame: number) => (frame < RATE ? peak : quiet) * Math.sin((2 * Math.PI * 1000 * frame) / RATE);
  const out = (await mixdown({ clips: collectMixClips(documentWith([{ id: "t", elements: [{ id: "e", ...compressor() }] }]) as never, "s"), read: reader({ a: stepped }), start: 0, end: 2 * SECOND }))[0];
  assert.ok(level(out, 1.001, 1.01) < -30 - 3.01 - 5, "just after the drop the gain is still reduced");
  assert.ok(Math.abs(level(out, 1.8, 2) - (-30 - 3.01)) < 0.3, "after the release the quiet part is at its own level");
});

test("Loudness normalisation — Quiet clip raised: the measured loudness and the gain to the target; the stored gain is applied before the clip volume; a silent range gets 0 dB; the true peak limits the gain", async () => {
  // A 1 kHz tone of amplitude 0.1 on both channels reads −20 LUFS; a full-scale one 0 LUFS (BS.1770 reference behaviour).
  const tone = (amplitude: number, seconds = 3) => { const data = new Float32Array(seconds * RATE); for (let index = 0; index < data.length; index++) data[index] = sine(997, amplitude)(index); return data; };
  const quiet = measureLoudness(tone(0.1), tone(0.1));
  assert.ok(Math.abs(quiet.lufs + 20) <= 0.2, `−20 LUFS (${quiet.lufs.toFixed(2)})`);
  assert.ok(Math.abs(quiet.truePeakDb + 20) <= 0.2, `true peak −20 dBTP (${quiet.truePeakDb.toFixed(2)})`);
  assert.ok(Math.abs(measureLoudness(tone(0.1), new Float32Array(3 * RATE)).lufs + 23.01) <= 0.2, "one channel alone is 3 dB lower");
  assert.deepEqual(normalizeGainDb(-14, { lufs: -22.4, truePeakDb: -12 }), { gainDb: 8.4, silent: false });
  assert.deepEqual(normalizeGainDb(-14, { lufs: -50, truePeakDb: -40 }), { gainDb: 24, silent: false }, "at most +24 dB");
  assert.deepEqual(normalizeGainDb(-14, { lufs: -22.4, truePeakDb: -5 }), { gainDb: 4, silent: false }, "the true peak stays at or below −1 dBTP");
  assert.deepEqual(normalizeGainDb(-14, measureLoudness(new Float32Array(RATE), new Float32Array(RATE))), { gainDb: 0, silent: true });
  // The gate: a loud second followed by two seconds 40 dB lower measures as the loud part.
  const gated = new Float32Array(3 * RATE);
  for (let index = 0; index < gated.length; index++) gated[index] = sine(997, index < RATE ? 0.1 : 0.001)(index);
  assert.ok(Math.abs(measureLoudness(gated, gated).lufs + 20) <= 0.8);
  // In the mix: `normalize.gainDb` raises the element by that gain, on top of its volume.
  const run = async (element: Record<string, unknown>) => level((await render(documentWith([{ id: "t", elements: [{ id: "e", ...element }] }]), { a: sine(1000, 0.05) }, 2))[0], 1, 2);
  const plain = await run({});
  assert.ok(Math.abs((await run({ normalize: { enabled: true, target: -14, gainDb: 8.4, measuredLufs: -22.4 } })) - plain - 8.4) < 0.05);
  assert.ok(Math.abs((await run({ volume: -3, normalize: { enabled: true, target: -14, gainDb: 8.4 } })) - plain - 5.4) < 0.05);
  assert.equal(await run({ normalize: { enabled: false, target: -14, gainDb: 8.4 } }), plain, "a disabled normalisation applies nothing");
});

test("Equaliser, compressor and ducking — Music ducks under voice: 12 dB lower from the end of the attack to the end of the voice, back at full level after the release; No voice clips; the track's own voice does not duck it; preview chunks and the export give the same samples", async () => {
  // Music on the right channel only, the voice on the left only, so that each is measured alone.
  const doc = (voice: Record<string, unknown> | null, ducking: Record<string, unknown> = { enabled: true, amount: 12, attack: 200, release: 500 }) => documentWith([
    { id: "music", ducking, elements: [{ id: "m", pan: 100, duration: 10 * SECOND }] },
    { id: "speech", elements: voice ? [{ id: "v", mediaId: "voice", pan: -100, startTime: 5 * SECOND, duration: 3 * SECOND, ...voice }] : [] },
  ]);
  const sources = { a: sine(440, 0.2), voice: sine(220, 0.3) };
  const ducked = (await render(doc({ isVoice: true }), sources, 10))[1];
  const full = level(ducked, 1, 4);
  assert.ok(Math.abs(level(ducked, 5.3, 8) - full + 12) <= 0.3, `12 dB lower from 5.2 s to 8 s (${(level(ducked, 5.3, 8) - full).toFixed(2)} dB)`);
  assert.ok(Math.abs(level(ducked, 5.21, 5.25) - full + 12) <= 0.6, "fully ducked once the 200 ms attack is over");
  assert.ok(level(ducked, 5.05, 5.1) - full < -1 && level(ducked, 5.05, 5.1) - full > -8, "on its way down during the attack");
  assert.ok(Math.abs(level(ducked, 4.5, 4.99) - full) < 0.05, "at full level before the voice");
  // The 50 ms RMS window keeps the voice "present" for a moment after its last sample; the release follows.
  assert.ok(Math.abs(level(ducked, 8.56, 9.5) - full) < 0.05, "back at full level after the release");
  assert.ok(level(ducked, 8.2, 8.3) - full < -3, "still rising during the release");
  // No element flagged Voice: full level throughout.
  const unflagged = (await render(doc({ isVoice: false }), sources, 10))[1];
  assert.ok(Math.abs(level(unflagged, 5.3, 8) - full) < 0.01);
  // Ducking off, or amount 0: untouched.
  assert.ok(Math.abs(level((await render(doc({ isVoice: true }), sources, 10))[0], 5.3, 8) - level((await render(doc({ isVoice: true }, { enabled: false }), sources, 10))[0], 5.3, 8)) < 0.01, "the voice itself is not changed");
  assert.ok(Math.abs(level((await render(doc({ isVoice: true }, { enabled: false }), sources, 10))[1], 5.3, 8) - full) < 0.01);
  // A voice element on the ducked track itself does not duck its own track.
  const own = documentWith([{ id: "music", ducking: { enabled: true, amount: 12, attack: 200, release: 500 }, elements: [{ id: "m", pan: 100, duration: 10 * SECOND, isVoice: true }] }]);
  assert.ok(Math.abs(level((await render(own, sources, 10))[1], 5.3, 8) - full) < 0.01);
  // The live output mixes 0.25 s chunks with one carried state; the export mixes 10 s blocks: the same samples.
  const clips = collectMixClips(doc({ isVoice: true, eq: { enabled: true, preset: "custom", bands: { low: 0, lowMid: 0, mid: 6, highMid: 0, high: 0 } }, compressor: { enabled: true, threshold: -30, ratio: 4, attack: 10, release: 120, makeup: 0 } }) as never, "s");
  const read = reader(sources), state = new MixState(), chunk = RATE / 4;
  const whole = await mixBlock(clips, read, 0, 10 * RATE, Number.MAX_SAFE_INTEGER, new MixState());
  let worst = 0;
  for (let start = 0; start < 10 * RATE; start += chunk) {
    const part = await mixBlock(clips, read, start, chunk, Number.MAX_SAFE_INTEGER, state);
    for (let index = 0; index < chunk; index++) worst = Math.max(worst, Math.abs(part[0][index] - whole[0][start + index]), Math.abs(part[1][index] - whole[1][start + index]));
  }
  assert.equal(worst, 0, "chunked and whole mixes are identical");
  // A mix that starts in the middle (a seek) runs in over the second before it: within a hair of the continuous one.
  const seek = await mixBlock(clips, read, 6 * RATE, RATE, Number.MAX_SAFE_INTEGER, new MixState());
  let apart = 0;
  for (let index = 0; index < RATE; index++) apart = Math.max(apart, Math.abs(seek[1][index] - whole[1][6 * RATE + index]));
  assert.ok(apart < 2e-3, `a seek into the ducked range matches the continuous mix (${apart})`);
  assert.ok(Math.abs(state.duckingDb(clips[0].trackKey!)) < 1e-9 && clips[0].ducking?.amount === 12);
});

test("Voice-band ducking — 1 kHz music is reduced 12 dB while 100 Hz bass and 8 kHz air stay within 1 dB; preview chunks and export samples match", async () => {
  const doc = (frequency: number, mode: "full" | "voice-band" | null) => documentWith([
    { id: "music", ducking: mode ? { enabled: true, amount: 12, attack: 200, release: 500, mode } : undefined, elements: [{ id: "m", pan: 100, duration: 10 * SECOND }] },
    { id: "speech", elements: [{ id: "v", mediaId: "voice", pan: -100, startTime: 5 * SECOND, duration: 3 * SECOND, isVoice: true }] },
  ]);
  const sourcesFor = (frequency: number) => ({ a: sine(frequency, 0.08), voice: sine(220, 0.2) });
  const difference = async (frequency: number) => {
    const sources = sourcesFor(frequency), plain = (await render(doc(frequency, null), sources, 10))[1], carved = (await render(doc(frequency, "voice-band"), sources, 10))[1];
    return level(carved, 5.3, 8) - level(plain, 5.3, 8);
  };
  const bassDb = await difference(100), voiceDb = await difference(1000), airDb = await difference(8000);
  console.log(`voice-band mix: 100 Hz ${bassDb.toFixed(2)} dB, 1 kHz ${voiceDb.toFixed(2)} dB, 8 kHz ${airDb.toFixed(2)} dB`);
  assert.ok(Math.abs(voiceDb + 12) < 0.6, `1 kHz voice band reduction = ${voiceDb.toFixed(2)} dB`);
  assert.ok(Math.abs(bassDb) < 1, `100 Hz bass change = ${bassDb.toFixed(2)} dB`);
  assert.ok(Math.abs(airDb) < 1, `8 kHz air change = ${airDb.toFixed(2)} dB`);

  const chosen = doc(1000, "voice-band"), clips = collectMixClips(chosen as never, "s"), read = reader(sourcesFor(1000));
  const exported = await mixdown({ clips, read, start: 0, end: 10 * SECOND });
  const preview: [Float32Array, Float32Array] = [new Float32Array(exported[0].length), new Float32Array(exported[1].length)], state = new MixState(), block = RATE / 4;
  for (let start = 0; start < preview[0].length; start += block) {
    const part = await mixBlock(clips, read, start, Math.min(block, preview[0].length - start), preview[0].length, state);
    preview[0].set(part[0], start); preview[1].set(part[1], start);
  }
  let peakDelta = 0;
  for (let channel = 0; channel < 2; channel++) for (let index = 0; index < exported[channel].length; index++) peakDelta = Math.max(peakDelta, Math.abs(exported[channel][index] - preview[channel][index]));
  assert.ok(peakDelta <= 1e-6, `preview/export peak sample delta = ${peakDelta}`);
});

test("Vocal isolation — Keep vocals: the element is read from the stem the separation delivered, on the time base of its source; without a stem, or with mode off, from its own media", async () => {
  const isolated = (vocalIsolation: Record<string, unknown>) => documentWith([{ id: "t", elements: [{ id: "e", trimStart: SECOND, vocalIsolation }] }], ["a", "voice", "stem-v", "stem-a"]);
  const sources = { a: sine(1000, 0.5), "stem-v": sine(300, 0.2), "stem-a": sine(2000, 0.1), voice: sine(1, 0) };
  const assetOfClip = (doc: unknown) => collectMixClips(doc as never, "s")[0].assetId;
  assert.equal(assetOfClip(isolated({ mode: "keep-vocals", vocalsAssetId: "stem-v", accompanimentAssetId: "stem-a" })), "stem-v");
  assert.equal(assetOfClip(isolated({ mode: "remove-vocals", vocalsAssetId: "stem-v", accompanimentAssetId: "stem-a" })), "stem-a");
  assert.equal(assetOfClip(isolated({ mode: "off", vocalsAssetId: "stem-v", accompanimentAssetId: "stem-a" })), "a");
  assert.equal(assetOfClip(isolated({ mode: "keep-vocals" })), "a", "while the job runs the clip plays its original audio");
  assert.equal(assetOfClip(isolated({ mode: "keep-vocals", vocalsAssetId: "gone" })), "a", "a stem that is not in the project is not read");
  const vocals = (await render(isolated({ mode: "keep-vocals", vocalsAssetId: "stem-v", accompanimentAssetId: "stem-a" }), sources, 2))[0];
  assert.ok(Math.abs(level(vocals, 0.5, 1.5) - (20 * Math.log10(0.2) - 3.01)) < 0.05, "the vocal stem sounds, at its own level");
  // The stem is read at the source time of the element (trim 1 s): the sample at timeline 0 is the stem's sample at 1 s.
  assert.ok(Math.abs(vocals[100] - sine(300, 0.2)(RATE + 100)) < 1e-3);
});
