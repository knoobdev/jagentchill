import { clipProcessing, retimeClipOf, sourceTimeAt, timeline, type RetimeClip } from "@jagentchill/editor-core";
import type { ProjectDocument, TimelineElement } from "@jagentchill/protocol";
import { TICKS_PER_SECOND } from "@jagentchill/protocol";
import { evaluateScalar } from "../resolve/animation.ts";
import { dbToGain, FADE_GAINS, fadeGain, INTERNAL_SAMPLE_RATE, panGains, type Fade } from "./gain.ts";
import { ClipChain, Ducker, VoiceDetector, type ClipProcessing, type DuckingSettings } from "./dsp.ts";
import { Limiter } from "./limiter.ts";
import { Resampler, sampleAt } from "./resample.ts";
import { ClipStretcher, pitchPreservation, type ClipStretch } from "./stretch.ts";
import { restoresFormants, VOICE_PITCH, VoiceChain, voiceEffectOf, voiceLatency, type VoiceEffect } from "./voice.ts";

/**
 * The offline mixdown: `audio-editing.Audio signal chain` executed in blocks of at most 10 s at the 48 000 Hz
 * internal rate, with the mastering limiter as the last stage and one conversion to the export rate after it.
 */

export const MAX_BLOCK_SECONDS = 10;

/** One audible clip of the mix, with everything the chain needs at stages 9–15. */
export type MixClip = {
  elementId: string; assetId: string;
  /** Timeline start and duration in ticks. */
  startTime: number; duration: number;
  retime: RetimeClip;
  /** Clip volume in dB, or its keyframe channel. */
  volume: number; volumeChannel?: Parameters<typeof evaluateScalar>[0];
  fadeIn?: Fade; fadeOut?: Fade; pan: number;
  trackGain: number; trackPan: number;
  /** Gain of the compound clips this clip is inside. */
  outerGain: number;
  /**
   * The paired audio crossfade of a picture transition (`transitions.Audio crossfade pairing`). The incoming clip
   * sounds `lead` ticks before its start and fades in over the window; the outgoing clip sounds `tail` ticks past
   * its end and fades out over it. Each side reads its source handle; where there is none the reader is silent.
   * The crossfade replaces the clip's own fade at that end.
   */
  lead?: number; tail?: number;
  crossIn?: { duration: number; shape: string };
  /** `start` is the element-local time the window begins at. */
  crossOut?: { start: number; duration: number; shape: string };
  /** Stage 4 beyond resampling: the retime stretched with its pitch kept, and the pitch shift. */
  stretch?: ClipStretch;
  /** Stage 5: the voice effect. A pitch effect is part of `stretch`; `plainStretch` is stage 4 without it (the dry sound). */
  voice?: VoiceEffect; plainStretch?: ClipStretch;
  /** Stages 6–8: equaliser, compressor and normalisation gain, when any of them is on. */
  processing?: ClipProcessing;
  /** The element is flagged Voice: tracks with ducking on duck under it. */
  isVoice?: boolean;
  /** The track of the clip (unique across compound scenes), and its ducking when that is on. */
  trackKey?: string;
  ducking?: DuckingSettings;
};

type Transition = { kind?: string; fromElementId: string; toElementId: string; duration: number; audioCrossfade?: boolean; shape?: string };
type Sound = {
  maintainPitch?: boolean; pitch?: { semitones?: number; cents?: number }; voiceEffect?: { type?: string; intensity?: number };
  volume?: number; muted?: boolean; pan?: number; fadeIn?: Fade; fadeOut?: Fade; isSourceAudioEnabled?: boolean; mediaId?: string; animations?: Record<string, unknown>; isVoice?: boolean;
  eq?: { enabled?: boolean; bands?: ClipProcessing["eq"] }; compressor?: { enabled?: boolean } & ClipProcessing["compressor"]; normalize?: { enabled?: boolean; gainDb?: number };
  vocalIsolation?: { mode?: string; vocalsAssetId?: string; accompanimentAssetId?: string };
};

export { clipProcessing };

/**
 * The asset an element's sound is read from (stage 2): its vocal or accompaniment stem when vocal isolation is on
 * and the separation has delivered that stem, the element's own media otherwise. A stem has the time base of its source.
 */
export function soundAssetId(element: Sound, hasAsset: (assetId: string) => boolean): string | undefined {
  const isolation = element.vocalIsolation;
  const stem = isolation?.mode === "keep-vocals" ? isolation.vocalsAssetId : isolation?.mode === "remove-vocals" ? isolation.accompanimentAssetId : undefined;
  return stem && hasAsset(stem) ? stem : element.mediaId;
}

/**
 * The clips that sound in a scene, in collection order: overlay tracks, main track, audio tracks, including the
 * audio of compound scenes. Muted tracks and elements and videos with source audio disabled are skipped; solo is
 * ignored (it affects playback only, when `honourSolo` is set).
 */
export function collectMixClips(document: ProjectDocument, sceneId: string, options: { honourSolo?: boolean } = {}, outer = { offset: 0, gain: 1, depth: 0, end: Number.MAX_SAFE_INTEGER }): MixClip[] {
  const scene = document.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene || outer.depth > 8) return [];
  const tracks = [...scene.tracks.overlay, scene.tracks.main, ...scene.tracks.audio];
  const anySolo = options.honourSolo === true && tracks.some((track) => (track as { solo?: boolean }).solo);
  const clips: MixClip[] = [];
  for (const track of tracks) {
  const sounding = track as { id: string; muted?: boolean; solo?: boolean; volume?: number; pan?: number; ducking?: { enabled?: boolean; amount?: number; attack?: number; release?: number; mode?: "full" | "voice-band" } };
    const trackKey = `${sceneId}/${sounding.id}@${outer.offset}`;
    const ducking: DuckingSettings | undefined = track.type === "audio" && sounding.ducking?.enabled && (sounding.ducking.amount ?? 12) > 0
      ? { amount: sounding.ducking.amount ?? 12, attack: sounding.ducking.attack ?? 200, release: sounding.ducking.release ?? 500, mode: sounding.ducking.mode ?? "full" } : undefined;
    if (track.type !== "audio" && track.type !== "video") continue;
    if (sounding.muted || (anySolo && !sounding.solo)) continue;
    const ofTrack = new Map<string, MixClip>();
    for (const element of track.elements as (TimelineElement & Sound & { type: string; sceneId?: string })[]) {
      if (element.muted) continue;
      const startTime = outer.offset + element.startTime;
      if (startTime >= outer.end) continue;
      const duration = Math.min(element.duration, outer.end - startTime);
      if (element.type === "compound") {
        if (element.isSourceAudioEnabled === false || !element.sceneId) continue;
        clips.push(...collectMixClips(document, element.sceneId, {}, {
          offset: startTime - (element.trimStart ?? 0), gain: outer.gain * dbToGain(element.volume ?? 0) * dbToGain(sounding.volume ?? 0), depth: outer.depth + 1, end: startTime + duration,
        }));
        continue;
      }
      if (element.type !== "audio" && element.type !== "video") continue;
      if (!element.mediaId || (element.type === "video" && element.isSourceAudioEnabled === false)) continue;
      const asset = document.media.assets.find((candidate) => candidate.id === element.mediaId);
      if (!asset || (asset.type === "video" && asset.hasAudio === false) || asset.type === "image") continue;
      const processing = clipProcessing(element), retime = retimeClipOf(element as never), voice = voiceEffectOf(element);
      const voicePitch = voice ? VOICE_PITCH[voice.type] ?? 0 : 0, { stretch } = pitchPreservation(element, retime, voicePitch);
      const plainStretch = voicePitch !== 0 ? pitchPreservation(element, retime).stretch : stretch;
      const clip: MixClip = {
        elementId: element.id, assetId: soundAssetId(element, (id) => document.media.assets.some((candidate) => candidate.id === id)) ?? element.mediaId, startTime, duration, retime,
        trackKey, ...(stretch ? { stretch } : {}), ...(voice ? { voice, ...(plainStretch ? { plainStretch } : {}) } : {}), ...(processing ? { processing } : {}), ...(element.isVoice ? { isVoice: true } : {}), ...(ducking ? { ducking } : {}),
        volume: element.volume ?? 0, volumeChannel: element.animations?.volume as MixClip["volumeChannel"],
        fadeIn: element.fadeIn, fadeOut: element.fadeOut, pan: element.pan ?? 0,
        trackGain: dbToGain(sounding.volume ?? 0), trackPan: sounding.pan ?? 0, outerGain: outer.gain,
      };
      clips.push(clip);
      // Only a clip that sounds for its whole length takes part in a paired crossfade.
      if (duration === element.duration) ofTrack.set(element.id, clip);
    }
    if (track.type !== "video") continue;
    // A picture transition with `audioCrossfade` crossfades the source audio of its two clips over its window, when
    // both sound and neither had its audio extracted; otherwise the audio cuts hard and each clip keeps its own fade.
    for (const record of ((track as { transitions?: Transition[] }).transitions ?? [])) {
      if (record.kind !== "transition" || record.audioCrossfade === false) continue;
      const from = ofTrack.get(record.fromElementId), to = ofTrack.get(record.toElementId);
      if (!from || !to || !timeline.audioCrossfadeState(scene as never, record as never).active) continue;
      const window = timeline.transitionWindow(to.startTime, record.duration, document.settings.fps), shape = record.shape ?? "equal-power";
      from.tail = window.after; from.crossOut = { start: from.duration - window.before, duration: record.duration, shape };
      to.lead = window.before; to.crossIn = { duration: record.duration, shape };
    }
  }
  return clips;
}

const ANCHOR = 64;

/** Stereo source samples at the internal rate: `read(assetId, firstFrame, count)` returns `[left, right]`, silent outside the source. */
export type SourceReader = (assetId: string, firstFrame: number, count: number) => Promise<[Float32Array, Float32Array]> | [Float32Array, Float32Array];

/** Clip gain (stages 9 and 10) at an element-local time in ticks. */
export function clipGainAt(clip: MixClip, clipTime: number): number {
  const inside = Math.min(Math.max(clipTime, 0), clip.duration);
  const db = clip.volumeChannel?.keys?.length ? evaluateScalar(clip.volumeChannel, inside) : clip.volume;
  // A paired crossfade replaces the clip's own fade at its end of the cut; the two are never multiplied.
  let gain = dbToGain(db) * fadeGain(inside, clip.duration, clip.crossIn ? undefined : clip.fadeIn, clip.crossOut ? undefined : clip.fadeOut);
  if (clip.crossIn) {
    const progress = (clipTime + (clip.lead ?? 0)) / clip.crossIn.duration;
    if (progress < 1) gain *= (FADE_GAINS[clip.crossIn.shape] ?? FADE_GAINS["equal-power"])(Math.max(progress, 0));
  }
  if (clip.crossOut) {
    const progress = (clipTime - clip.crossOut.start) / clip.crossOut.duration;
    if (progress > 0) gain *= (FADE_GAINS[clip.crossOut.shape] ?? FADE_GAINS["equal-power"])(Math.max(1 - progress, 0));
  }
  return gain;
}

/**
 * Stages 9–15 of the signal chain for one block: every clip that sounds inside `[blockStart, blockStart + length)`
 * (frames at the internal rate), summed to stereo. The live output and the export mixdown both call this.
 */
export async function mixBlock(clips: MixClip[], read: SourceReader, blockStart: number, length: number, rangeEnd = Number.MAX_SAFE_INTEGER, state?: MixState): Promise<[Float32Array, Float32Array]> {
  // Filters, envelopes and ducking carry state from sample to sample: such a mix goes through the stateful path.
  const ducked = clips.some((clip) => clip.ducking) && clips.some((clip) => clip.isVoice);
  if (ducked || clips.some((clip) => clip.processing || clip.voice)) {
    const carried = state ?? new MixState();
    try {
    if (carried.next !== blockStart) {
      // A block that does not continue the last one starts from rest, run in over the second before it.
      carried.reset();
      await mixStateful(clips, read, blockStart - PREROLL_FRAMES, PREROLL_FRAMES, rangeEnd, carried, ducked);
    }
    const out = await mixStateful(clips, read, blockStart, length, rangeEnd, carried, ducked);
    carried.next = blockStart + length;
    return out;
    } finally {
      if (!state) carried.reset();
    }
  }
  // A stretch continues from block to block; without a state to carry it, one is made for this block alone.
  const stretching = clips.some((clip) => clip.stretch);
  const carried = state ?? (stretching ? new MixState() : undefined);
  if (carried && stretching && carried.next !== blockStart) carried.resetStretchers();
  if (carried) carried.next = blockStart + length;
  try {
    return await mixPlain(clips, read, blockStart, length, rangeEnd, undefined, carried);
  } finally {
    if (!state) carried?.reset();
  }
}

/** The run-in of a stateful mix that starts at an arbitrary time: longer than every filter, the compressor release and the ducking release matter. */
const PREROLL_FRAMES = INTERNAL_SAMPLE_RATE;

/** What the stateful stages remember between consecutive blocks of one mix. */
export class MixState {
  /** The frame the next block is expected to start at; another start resets the state. */
  next = Number.NaN;
  readonly chains = new Map<string, { key: string; chain: ClipChain }>();
  readonly duckers = new Map<string, { key: string; ducker: Ducker; detector: VoiceDetector }>();
  /** The stretch in progress of every clip that has one (`stretch.ts`). */
  readonly stretchers = new Map<string, { key: string; stretcher: ClipStretcher }>();
  resetStretchers(): void { for (const entry of this.stretchers.values()) entry.stretcher.dispose(); this.stretchers.clear(); }
  readonly voices = new Map<string, { key: string; chain: VoiceChain }>();
  reset(): void { this.chains.clear(); this.voices.clear(); this.duckers.clear(); this.resetStretchers(); this.next = Number.NaN; }
  /** Gain reduction of a ducked track in dB after the last mixed block. */
  duckingDb(trackKey: string): number { return this.duckers.get(trackKey)?.ducker.reductionDb ?? 0; }
}

type Stereo = [Float32Array, Float32Array];
async function mixStateful(clips: MixClip[], read: SourceReader, blockStart: number, length: number, rangeEnd: number, state: MixState, ducked: boolean): Promise<Stereo> {
  const block: Stereo = [new Float32Array(length), new Float32Array(length)];
  // Per-track sums (after stage 12) and the voice elements of each track, so that a track ducks under the voice of the others.
  const tracks = new Map<string, { sum: Stereo; voice: Stereo | null; ducking?: DuckingSettings }>();
  const voiceTotal: Stereo | null = ducked ? [new Float32Array(length), new Float32Array(length)] : null;
  for (const clip of clips) {
    const raw: Stereo = [new Float32Array(length), new Float32Array(length)];
    // The clip alone, before its gain: one clip mixed at unit gain and centre pan.
    const alone: MixClip = { ...clip, volume: 0, volumeChannel: undefined, fadeIn: undefined, fadeOut: undefined, crossIn: undefined, crossOut: undefined, pan: 0, trackGain: 1, trackPan: 0, outerGain: 1 };
    const span = clip.voice ? clipSpan(clip, blockStart, length, rangeEnd) : await mixPlain([alone], read, blockStart, length, rangeEnd, raw, state);
    if (!span) continue;
    const [from, to] = span;
    if (clip.voice) {
      // Stage 5. An effect that trails its input is fed the clip's sound that much ahead, so its output is on time.
      const voice = clip.voice, latency = voiceLatency(voice.type), shifted = clip.stretch !== clip.plainStretch;
      const part = async (suffix: string, stretch: ClipStretch | undefined, ahead: number, into: Stereo): Promise<Stereo> => { await mixPlain([{ ...alone, elementId: `${clip.elementId}\u0000${suffix}`, stretch }], read, blockStart + ahead, length, rangeEnd === Number.MAX_SAFE_INTEGER ? rangeEnd : rangeEnd + ahead, into, state); return into; };
      await part("wet", clip.stretch, latency, raw);
      const dry = restoresFormants(voice.type) ? await part("dry", clip.plainStretch, latency, [new Float32Array(length), new Float32Array(length)]) : undefined;
      const plain = voice.intensity < 1 && (shifted || latency > 0) ? await part("mix", clip.plainStretch, 0, [new Float32Array(length), new Float32Array(length)]) : undefined;
      const key = JSON.stringify(voice);
      let entry = state.voices.get(clip.elementId);
      if (!entry || entry.key !== key) state.voices.set(clip.elementId, entry = { key, chain: new VoiceChain(voice) });
      entry.chain.process(raw[0], raw[1], from - blockStart, to - from, from - Math.round((clip.startTime * INTERNAL_SAMPLE_RATE) / TICKS_PER_SECOND), dry, plain);
      // What the effect was fed beyond the clip's own span is not part of the mix.
      raw[0].fill(0, 0, from - blockStart); raw[0].fill(0, to - blockStart); raw[1].fill(0, 0, from - blockStart); raw[1].fill(0, to - blockStart);
    }
    if (clip.processing) {
      const key = JSON.stringify(clip.processing);
      let entry = state.chains.get(clip.elementId);
      if (!entry || entry.key !== key) state.chains.set(clip.elementId, entry = { key, chain: new ClipChain(clip.processing) });
      entry.chain.process(raw[0], raw[1], from - blockStart, to - from);
    }
    const trackKey = clip.trackKey ?? "";
    let track = tracks.get(trackKey);
    if (!track) tracks.set(trackKey, track = { sum: ducked ? [new Float32Array(length), new Float32Array(length)] : block, voice: null, ducking: clip.ducking });
    const rate = INTERNAL_SAMPLE_RATE, clipFirst = Math.round((clip.startTime * rate) / TICKS_PER_SECOND);
    const [panLeft, panRight] = panGains(clip.pan), [trackLeft, trackRight] = panGains(clip.trackPan), fixed = clip.trackGain * clip.outerGain;
    if (clip.isVoice && voiceTotal && !track.voice) track.voice = [new Float32Array(length), new Float32Array(length)];
    for (let frame = from; frame < to; frame++) {
      const index = frame - blockStart;
      const gain = clipGainAt(clip, ((frame - clipFirst) * TICKS_PER_SECOND) / rate) * fixed;
      if (gain === 0) continue;
      const l = raw[0][index] * gain * panLeft * trackLeft, r = raw[1][index] * gain * panRight * trackRight;
      track.sum[0][index] += l; track.sum[1][index] += r;
      if (clip.isVoice && voiceTotal) { voiceTotal[0][index] += l; voiceTotal[1][index] += r; track.voice![0][index] += l; track.voice![1][index] += r; }
    }
  }
  if (!ducked || !voiceTotal) return block;
  for (const [trackKey, track] of tracks) {
    if (!track.ducking) { for (let index = 0; index < length; index++) { block[0][index] += track.sum[0][index]; block[1][index] += track.sum[1][index]; } continue; }
    const key = JSON.stringify(track.ducking);
    let entry = state.duckers.get(trackKey);
    if (!entry || entry.key !== key) state.duckers.set(trackKey, entry = { key, ducker: new Ducker(track.ducking), detector: new VoiceDetector() });
    for (let index = 0; index < length; index++) {
      // The voice of the other tracks: the track's own voice elements do not duck it.
      const voice = entry.detector.step(voiceTotal[0][index] - (track.voice?.[0][index] ?? 0), voiceTotal[1][index] - (track.voice?.[1][index] ?? 0));
      const gain = entry.ducker.step(voice);
      const duckedSample = entry.ducker.apply(track.sum[0][index], track.sum[1][index], gain);
      block[0][index] += duckedSample[0]; block[1][index] += duckedSample[1];
    }
  }
  // A ducked track with nothing sounding in this block still follows the voice, so that its envelope is right when it sounds again.
  for (const clip of clips) {
    if (!clip.ducking || tracks.has(clip.trackKey ?? "")) continue;
    const key = JSON.stringify(clip.ducking), trackKey = clip.trackKey ?? "";
    let entry = state.duckers.get(trackKey);
    if (!entry || entry.key !== key) state.duckers.set(trackKey, entry = { key, ducker: new Ducker(clip.ducking), detector: new VoiceDetector() });
    for (let index = 0; index < length; index++) entry.ducker.step(entry.detector.step(voiceTotal[0][index], voiceTotal[1][index]));
    tracks.set(trackKey, { sum: block, voice: null });
  }
  return block;
}

/** The frames of a block in which a clip sounds, or `null`. */
function clipSpan(clip: MixClip, blockStart: number, length: number, rangeEnd: number): [number, number] | null {
  const rate = INTERNAL_SAMPLE_RATE;
  const from = Math.max(blockStart, Math.round(((clip.startTime - (clip.lead ?? 0)) * rate) / TICKS_PER_SECOND)), to = Math.min(blockStart + length, Math.round(((clip.startTime + clip.duration + (clip.tail ?? 0)) * rate) / TICKS_PER_SECOND), rangeEnd);
  return to > from ? [from, to] : null;
}

/** The memoryless mix. With `into`, the one clip is written there and its sounding frame range is returned. */
async function mixPlain(clips: MixClip[], read: SourceReader, blockStart: number, length: number, rangeEnd: number, into: Stereo, state?: MixState): Promise<[number, number] | null>;
async function mixPlain(clips: MixClip[], read: SourceReader, blockStart: number, length: number, rangeEnd: number, into?: undefined, state?: MixState): Promise<Stereo>;
async function mixPlain(clips: MixClip[], read: SourceReader, blockStart: number, length: number, rangeEnd: number, into?: Stereo, state?: MixState): Promise<Stereo | [number, number] | null> {
  const rate = INTERNAL_SAMPLE_RATE;
  const block: [Float32Array, Float32Array] = into ?? [new Float32Array(length), new Float32Array(length)];
  let sounded: [number, number] | null = null;
  for (const clip of clips) {
    const clipFirst = Math.round((clip.startTime * rate) / TICKS_PER_SECOND);
    // With a paired crossfade the clip sounds before its start and past its end, out of its source handles.
    const soundFirst = Math.round(((clip.startTime - (clip.lead ?? 0)) * rate) / TICKS_PER_SECOND);
    const clipEnd = Math.round(((clip.startTime + clip.duration + (clip.tail ?? 0)) * rate) / TICKS_PER_SECOND);
    const from = Math.max(blockStart, soundFirst), to = Math.min(blockStart + length, clipEnd, rangeEnd);
    if (to <= from) continue;
    sounded = [from, to];
    // The retime map continued past both ends of the clip at the rate it has there.
    const mapped = (time: number): number => (time < 0 ? sourceTimeAt(clip.retime, 0) + time * (sourceTimeAt(clip.retime, 1) - sourceTimeAt(clip.retime, 0))
      : time > clip.duration ? sourceTimeAt(clip.retime, clip.duration) + (time - clip.duration) * (sourceTimeAt(clip.retime, clip.duration) - sourceTimeAt(clip.retime, clip.duration - 1))
      : sourceTimeAt(clip.retime, time));
    // Source position (in internal-rate frames) of a timeline frame, through the one retime map.
    const sourcePosition = (frame: number): number => {
      const clipTime = ((frame - clipFirst) * TICKS_PER_SECOND) / rate;
      const whole = Math.floor(clipTime);
      const a = mapped(whole), b = mapped(clip.tail ? whole + 1 : Math.min(whole + 1, clip.duration));
      return ((a + (b - a) * (clipTime - whole)) * rate) / TICKS_PER_SECOND;
    };
    const [panLeft, panRight] = panGains(clip.pan);
    const [trackLeft, trackRight] = panGains(clip.trackPan);
    const fixed = clip.trackGain * clip.outerGain;
    if (clip.stretch && state) {
      // The stretch works in playback order: a clip that plays its source backwards hands it over mirrored.
      const backwards = sourcePosition(clipEnd) < sourcePosition(clipFirst), sign = backwards ? -1 : 1;
      const key = JSON.stringify([clip.assetId, clip.stretch, clip.retime, clip.startTime, clip.duration]);
      let entry = state.stretchers.get(clip.elementId);
      if (!entry || entry.key !== key) { entry?.stretcher.dispose(); state.stretchers.set(clip.elementId, entry = { key, stretcher: new ClipStretcher() }); }
      const [left, right] = await entry.stretcher.render(clip.stretch, from - clipFirst, to - clipFirst, (clipFrame) => sign * sourcePosition(clipFirst + clipFrame), async (low, high) => {
        if (!backwards) return read(clip.assetId, low, high - low);
        const [l, r] = await read(clip.assetId, 1 - high, high - low);
        return [l.slice().reverse(), r.slice().reverse()];
      });
      for (let frame = from; frame < to; frame++) {
        const gain = clipGainAt(clip, ((frame - clipFirst) * TICKS_PER_SECOND) / rate) * fixed;
        if (gain === 0) continue;
        block[0][frame - blockStart] += left[frame - from] * gain * panLeft * trackLeft;
        block[1][frame - blockStart] += right[frame - from] * gain * panRight * trackRight;
      }
      continue;
    }
    const startPosition = sourcePosition(from), endPosition = sourcePosition(to - 1);
    const low = Math.floor(Math.min(startPosition, endPosition)) - 32, high = Math.ceil(Math.max(startPosition, endPosition)) + 33;
    const [left, right] = await read(clip.assetId, low, high - low);
    const unretimed = endPosition - startPosition === to - 1 - from && Number.isInteger(startPosition);
    for (let anchor = from; anchor < to; anchor += ANCHOR) {
      const stop = Math.min(anchor + ANCHOR, to);
      // The map is evaluated at anchors and read linearly between them (exact for a constant rate).
      const a = sourcePosition(anchor), b = stop - 1 > anchor ? sourcePosition(stop - 1) : a;
      const step = stop - 1 > anchor ? (b - a) / (stop - 1 - anchor) : 0;
      for (let frame = anchor; frame < stop; frame++) {
        const clipTime = ((frame - clipFirst) * TICKS_PER_SECOND) / rate;
        const gain = clipGainAt(clip, clipTime) * fixed;
        if (gain === 0) continue;
        const position = (unretimed ? startPosition + (frame - from) : a + step * (frame - anchor)) - low;
        const index = frame - blockStart;
        const l = sampleAt((at) => (at >= 0 && at < left.length ? left[at] : 0), position);
        const r = sampleAt((at) => (at >= 0 && at < right.length ? right[at] : 0), position);
        block[0][index] += l * gain * panLeft * trackLeft;
        block[1][index] += r * gain * panRight * trackRight;
      }
    }
  }
  return into ? sounded : block;
}

export type MixdownOptions = {
  clips: MixClip[]; read: SourceReader;
  /** Range of the timeline in ticks. */
  start: number; end: number;
  sampleRate?: 44_100 | 48_000; channels?: 1 | 2;
  onProgress?: (framesDone: number, frameCount: number) => void;
  isCancelled?: () => boolean;
};

/**
 * Renders the mix block by block. Each yielded block is at the export rate and channel count; resampler and
 * limiter state carry across blocks, and the limiter's look-ahead delay is removed.
 */
export async function* mixdownBlocks(options: MixdownOptions): AsyncGenerator<Float32Array[], void, unknown> {
  const rate = INTERNAL_SAMPLE_RATE;
  const outRate = options.sampleRate ?? 48_000, outChannels = options.channels ?? 2;
  const firstFrame = Math.round((options.start * rate) / TICKS_PER_SECOND);
  const frameCount = Math.max(0, Math.round(((options.end - options.start) * rate) / TICKS_PER_SECOND));
  const limiter = new Limiter(2, rate);
  const resampler = new Resampler(rate, outRate, 2);
  const blockFrames = MAX_BLOCK_SECONDS * rate;
  let toDrop = limiter.lookahead;
  const state = new MixState();
  const finish = (block: Float32Array[], last: boolean): Float32Array[] => {
    const converted = resampler.process(block, last);
    if (outChannels === 2) return converted;
    const mono = new Float32Array(converted[0].length);
    for (let index = 0; index < mono.length; index++) mono[index] = (converted[0][index] + converted[1][index]) / 2;
    return [mono];
  };

  for (let done = 0; done < frameCount + limiter.lookahead; done += blockFrames) {
    if (options.isCancelled?.()) return;
    // The last block is followed by `lookahead` frames of silence that flush the limiter.
    const length = Math.min(blockFrames, frameCount + limiter.lookahead - done);
    const blockStart = firstFrame + done;
    const block = await mixBlock(options.clips, options.read, blockStart, length, firstFrame + frameCount, state);
    limiter.process(block, length);
    // Remove the look-ahead delay: the first `lookahead` output frames are the limiter's initial silence.
    const skip = Math.min(toDrop, length);
    toDrop -= skip;
    const last = done + blockFrames >= frameCount + limiter.lookahead;
    const out = finish(skip > 0 ? block.map((channel) => channel.subarray(skip)) : block, last);
    options.onProgress?.(Math.min(done + length, frameCount), frameCount);
    if (out[0].length > 0) yield out;
  }
}

/** The whole mix in one buffer per channel: for tests and short ranges. */
export async function mixdown(options: MixdownOptions): Promise<Float32Array[]> {
  const parts: Float32Array[][] = [];
  for await (const block of mixdownBlocks(options)) parts.push(block.map((channel) => channel.slice()));
  const channels = options.channels ?? 2;
  const total = parts.reduce((sum, part) => sum + part[0].length, 0);
  const out = Array.from({ length: channels }, () => new Float32Array(total));
  let offset = 0;
  for (const part of parts) { part.forEach((channel, index) => out[index].set(channel, offset)); offset += part[0].length; }
  return out;
}
