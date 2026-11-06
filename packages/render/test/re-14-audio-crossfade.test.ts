import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, createProjectDocument, createTrack } from "@jagentchill/protocol";
import { clipGainAt, collectMixClips, mixdown, type SourceReader } from "../src/index.ts";

/** The paired audio crossfade of a picture transition (`transitions.Audio crossfade pairing`), on the offline mixdown the export and the live output share. */

const RATE = 48_000, S = 120_000;
const reader = (sources: Record<string, (frame: number) => number>): SourceReader => (assetId, first, count) => {
  const data = new Float32Array(count);
  // Silent outside the source: before its first frame and after its last (4 s).
  for (let index = 0; index < count; index++) { const frame = first + index; data[index] = frame >= 0 && frame < 4 * RATE ? sources[assetId](frame) : 0; }
  return [data, data.slice()];
};
const sine = (frequency: number, amplitude: number) => (frame: number) => amplitude * Math.sin((2 * Math.PI * frequency * frame) / RATE);
const rms = (samples: Float32Array, fromSeconds: number, toSeconds: number): number => {
  let sum = 0;
  const from = Math.round(fromSeconds * RATE), to = Math.round(toSeconds * RATE);
  for (let index = from; index < to; index++) sum += samples[index] * samples[index];
  return Math.sqrt(sum / (to - from));
};
const decibels = (ratio: number): number => 20 * Math.log10(ratio);

type Options = { audioCrossfade?: boolean; shape?: string; seconds?: number; transition?: boolean; outgoing?: Record<string, unknown>; incoming?: Record<string, unknown>; trim?: number; linkedAudio?: boolean };
/** Two 2 s video clips edge to edge on the main track, each the middle of a 4 s source (1 s of handle on both sides), with a transition on the cut at 2 s. */
function project(options: Options = {}) {
  const doc = JSON.parse(JSON.stringify(createProjectDocument({ id: "p", mainSceneId: "s", mainTrackId: "main", now_ms: 0 })));
  for (const id of ["a", "b"]) doc.media.assets.push({ id, name: id, type: "video", hasAudio: true, width: 640, height: 360, duration: 4 * S });
  const trim = options.trim ?? S;
  const video = (id: string, mediaId: string, startTime: number, extra: Record<string, unknown> = {}) => JSON.parse(JSON.stringify(createElement("video", { id, name: id, startTime, duration: 2 * S, mediaId, sourceDuration: 4 * S, trimStart: trim, trimEnd: 4 * S - trim - 2 * S, ...extra } as never)));
  const from = video("from", "a", 0, options.outgoing), to = video("to", "b", 2 * S, options.incoming);
  const main = doc.scenes[0].tracks.main;
  main.elements = [from, to];
  if (options.transition !== false) {
    main.transitions = [{ id: "t", kind: "transition", fromElementId: "from", toElementId: "to", duration: (options.seconds ?? 1) * S, type: "cross-dissolve", params: {}, easing: "ease-in-out", audioCrossfade: options.audioCrossfade ?? true, shape: options.shape ?? "equal-power" }];
    from.transitionOut = "t"; to.transitionIn = "t";
  }
  if (options.linkedAudio) {
    from.linkId = "link";
    doc.media.assets.push({ id: "x", name: "x", type: "audio", hasAudio: true, duration: 4 * S });
    doc.scenes[0].tracks.audio = [{ ...JSON.parse(JSON.stringify(createTrack("audio", { id: "audio", name: "audio" }))), elements: [JSON.parse(JSON.stringify(createElement("audio", { id: "extracted", name: "x", startTime: 0, duration: 2 * S, mediaId: "x", sourceType: "upload", linkId: "link", muted: true } as never)))] }];
  }
  return doc;
}
const tones = { a: sine(440, 0.25), b: sine(880, 0.25), x: () => 0 };
const levels = { a: () => 0.25, b: () => -0.125, x: () => 0 };
const mix = async (doc: unknown, sources: Record<string, (frame: number) => number>) => (await mixdown({ clips: collectMixClips(doc as never, "s"), read: reader(sources), start: 0, end: 4 * S }))[0];

test("Audio crossfade pairing — Equal-power crossfade", async () => {
  const clips = collectMixClips(project() as never, "s");
  const [from, to] = clips;
  // The 1 s window is centred on the cut: each side sounds 0.5 s into its source handle.
  assert.deepEqual([from.tail, from.crossOut, to.lead, to.crossIn], [S / 2, { start: 1.5 * S, duration: S, shape: "equal-power" }, S / 2, { duration: S, shape: "equal-power" }]);
  const out = await mix(project(), tones);
  const outside = rms(out, 0.5, 0.7), midpoint = rms(out, 1.95, 2.05);
  assert.ok(Math.abs(decibels(outside / (0.25 / Math.SQRT2))) < 0.1, `one tone at its own level outside the window (${outside})`);
  assert.ok(Math.abs(decibels(midpoint / outside)) < 0.5, `the level at the midpoint is within 0.5 dB of the level outside: ${decibels(midpoint / outside).toFixed(2)} dB`);
  // Both clips sound through the whole window, out of their handles.
  const levelled = await mix(project({ shape: "linear" }), levels);
  const at = (seconds: number) => levelled[Math.round(seconds * RATE)];
  assert.ok(Math.abs(at(1.75) - (0.25 * 0.75 - 0.125 * 0.25)) < 1e-3, `a quarter in, a linear crossfade is 75 % outgoing and 25 % incoming: ${at(1.75)}`);
  assert.ok(Math.abs(at(2.25) - (0.25 * 0.25 - 0.125 * 0.75)) < 1e-3, `three quarters in, the outgoing clip still sounds past the cut: ${at(2.25)}`);
  assert.ok(Math.abs(at(1.4) - 0.25) < 1e-3 && Math.abs(at(2.6) + 0.125) < 1e-3, "outside the window each clip sounds alone");
});

test("Audio crossfade pairing — a side without a source handle contributes silence beyond its boundary", async () => {
  // The incoming clip starts at the very first frame of its source: there is nothing before it to fade in from.
  const levelled = await mix(project({ shape: "linear", incoming: { trimStart: 0, trimEnd: 2 * S } }), levels);
  const at = (seconds: number) => levelled[Math.round(seconds * RATE)];
  assert.ok(Math.abs(at(1.75) - 0.25 * 0.75) < 1e-3, `before the cut only the outgoing side sounds: ${at(1.75)}`);
  assert.ok(Math.abs(at(2.25) - (0.25 * 0.25 - 0.125 * 0.75)) < 1e-3, "after it both do");
});

test("Audio crossfade pairing — Switch off", async () => {
  const doc = project({ audioCrossfade: false });
  const [from, to] = collectMixClips(doc as never, "s");
  assert.deepEqual([from.tail, from.crossOut, to.lead, to.crossIn], [undefined, undefined, undefined, undefined]);
  const levelled = await mix(doc, levels);
  const at = (seconds: number) => levelled[Math.round(seconds * RATE)];
  // The audio cuts hard at the cut tick: the outgoing clip is silent from it onward, the incoming one before it.
  assert.ok(Math.abs(at(1.9) - 0.25) < 1e-3 && Math.abs(at(2.1) + 0.125) < 1e-3, `${at(1.9)} then ${at(2.1)}`);
});

test("Audio crossfade pairing — Extracted audio", async () => {
  // The outgoing clip's audio lives on a linked audio element: the pairing does not apply and the clips are not faded by the transition.
  const clips = collectMixClips(project({ linkedAudio: true }) as never, "s");
  for (const clip of clips) assert.deepEqual([clip.lead, clip.tail, clip.crossIn, clip.crossOut], [undefined, undefined, undefined, undefined], clip.elementId);
  // And a clip whose source audio is off leaves its partner to cut hard too.
  const silent = collectMixClips(project({ outgoing: { isSourceAudioEnabled: false } }) as never, "s");
  assert.deepEqual(silent.map((clip) => [clip.elementId, clip.lead]), [["to", undefined]]);
});

test("Audio crossfade pairing — Clip fade is replaced, not lost", async () => {
  const fade = { duration: S, shape: "linear" };
  const doc = project({ seconds: 0.5, outgoing: { fadeOut: fade }, incoming: { fadeIn: fade } });
  const [from, to] = collectMixClips(doc as never, "s");
  // The stored fade is unchanged in the document and in the clip of the mix.
  assert.deepEqual(doc.scenes[0].tracks.main.elements[0].fadeOut, fade);
  assert.deepEqual(from.fadeOut, fade);
  // 0.5 s before the end the clip's own 1 s fade would be at half; under the transition it is not applied at all.
  assert.equal(clipGainAt(from, 1.5 * S), 1);
  // Inside the window the outgoing audio follows only the 0.5 s equal-power crossfade. Its 15 frames at 30 fps put 7 before the cut,
  // so the cut is 7/15 of the way through.
  const atCut = 7 / 15;
  assert.ok(Math.abs(clipGainAt(from, 2 * S) - Math.sin(((1 - atCut) * Math.PI) / 2)) < 1e-9, `${clipGainAt(from, 2 * S)}`);
  assert.ok(Math.abs(clipGainAt(to, 0) - Math.sin((atCut * Math.PI) / 2)) < 1e-9 && clipGainAt(to, 0.5 * S) === 1, "and the incoming clip's fade-in is replaced the same way");
  // The other ends keep their own fades.
  assert.equal(clipGainAt(collectMixClips(project({ seconds: 0.5, outgoing: { fadeIn: fade } }) as never, "s")[0], 0.5 * S), 0.5);
  // Removing the transition (or turning its switch off) makes the 1 s fade audible again.
  for (const without of [project({ transition: false, outgoing: { fadeOut: fade } }), project({ audioCrossfade: false, seconds: 0.5, outgoing: { fadeOut: fade } })]) {
    assert.equal(clipGainAt(collectMixClips(without as never, "s")[0], 1.5 * S), 0.5);
  }
});
