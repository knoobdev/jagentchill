/**
 * `captions-subtitles` / `ai-editing-tools`: where the speech is in a recording, found from its loudness alone.
 *
 * A transcription provider that answers with text only (no word or segment times) cannot say WHEN something was
 * said. So a recording is cut at its pauses, each piece is transcribed on its own, and the piece's own start and end
 * are the caption's. The same level detector finds the silences of "Remove silences", which needs no model at all.
 * Pure functions over 16-bit mono samples: no provider, no DOM.
 */
import { clipTimeAt, retimeClipOf } from "../time/retime.ts";
import type { Cue } from "./subtitles.ts";

export type SampleRange = { /** First sample. */ from: number; /** One past the last sample. */ to: number };
/** The length of a level window: 20 ms, as `ai-editing-tools.Auto cut` measures silence. */
const WINDOW_SECONDS = 0.02;

/** A level in dBFS as a 16-bit amplitude (−40 dBFS → 328). */
export const amplitudeOfDb = (db: number): number => 32768 * 10 ** (db / 20);

/** The RMS level of every 20 ms window of the recording, as a 16-bit amplitude. */
export function windowLevels(samples: Int16Array, rate: number): { levels: Float64Array; window: number } {
  const window = Math.max(1, Math.round(rate * WINDOW_SECONDS)), count = Math.floor(samples.length / window), levels = new Float64Array(count);
  for (let index = 0; index < count; index++) {
    let sum = 0;
    for (let at = index * window, end = at + window; at < end; at++) sum += samples[at] * samples[at];
    levels[index] = Math.sqrt(sum / window);
  }
  return { levels, window };
}

/** Runs of windows under the threshold that last at least `minSeconds`, as window indices. */
function quietRuns(levels: Float64Array, floor: number, minWindows: number): SampleRange[] {
  const runs: SampleRange[] = [];
  let start = -1;
  for (let index = 0; index <= levels.length; index++) {
    const quiet = index < levels.length && levels[index] < floor;
    if (quiet && start < 0) start = index;
    if (!quiet && start >= 0) { if (index - start >= minWindows) runs.push({ from: start, to: index }); start = -1; }
  }
  return runs;
}

export const SILENCE_DEFAULTS = { thresholdDb: -40, minSeconds: 0.5, paddingSeconds: 0.1 } as const;
export const SILENCE_LIMITS = { thresholdDb: [-60, -20], minSeconds: [0.2, 5], paddingSeconds: [0, 1] } as const;

/**
 * The silences of a recording: spans whose 20 ms RMS level stays under the threshold for at least the minimum
 * silence, each shortened by the padding kept on both sides. A span the padding uses up is not a cut.
 */
export function findSilences(samples: Int16Array, rate: number, options: { thresholdDb?: number; minSeconds?: number; paddingSeconds?: number } = {}): SampleRange[] {
  const clamp = (value: number | undefined, [low, high]: readonly [number, number] | readonly number[], fallback: number) => Math.min(high, Math.max(low, Number.isFinite(value) ? (value as number) : fallback));
  const threshold = clamp(options.thresholdDb, SILENCE_LIMITS.thresholdDb, SILENCE_DEFAULTS.thresholdDb), least = clamp(options.minSeconds, SILENCE_LIMITS.minSeconds, SILENCE_DEFAULTS.minSeconds), padding = clamp(options.paddingSeconds, SILENCE_LIMITS.paddingSeconds, SILENCE_DEFAULTS.paddingSeconds);
  const { levels, window } = windowLevels(samples, rate), pad = Math.round(padding * rate);
  return quietRuns(levels, amplitudeOfDb(threshold), Math.max(1, Math.round(least / WINDOW_SECONDS)))
    .map((run) => ({ from: run.from * window + pad, to: (run.to === levels.length ? samples.length : run.to * window) - pad }))
    .filter((range) => range.to > range.from);
}

export const SPEECH_PIECE_DEFAULTS = { thresholdDb: -40, pauseSeconds: 0.4, maxSeconds: 20, minSeconds: 0.15 } as const;

/**
 * The stretches of speech between pauses, in order. A pause is `pauseSeconds` under the threshold; a stretch shorter
 * than `minSeconds` is a click, not speech; one longer than `maxSeconds` (nobody paused) is cut at its quietest
 * window so every piece fits one request. Each piece keeps a little air around it so a cut never clips a consonant.
 */
export function speechPieces(samples: Int16Array, rate: number, options: { thresholdDb?: number; pauseSeconds?: number; maxSeconds?: number; minSeconds?: number } = {}): SampleRange[] {
  const { thresholdDb, pauseSeconds, maxSeconds, minSeconds } = { ...SPEECH_PIECE_DEFAULTS, ...options };
  const { levels, window } = windowLevels(samples, rate), floor = amplitudeOfDb(thresholdDb);
  const pauses = quietRuns(levels, floor, Math.max(1, Math.round(pauseSeconds / WINDOW_SECONDS)));
  const spoken: SampleRange[] = [];
  let at = 0;
  // A recording's trailing windows that are quiet but shorter than a pause still end the last piece.
  let last = levels.length;
  while (last > 0 && levels[last - 1] < floor) last--;
  for (const pause of [...pauses, { from: last, to: last }]) {
    let from = at;
    while (from < pause.from && levels[from] < floor) from++;
    if (pause.from > from) spoken.push({ from, to: Math.min(pause.from, last) });
    at = pause.to;
  }
  const most = Math.max(1, Math.round(maxSeconds / WINDOW_SECONDS)), least = Math.max(1, Math.round(minSeconds / WINDOW_SECONDS)), cut: SampleRange[] = [];
  for (const piece of spoken.filter((entry) => entry.to - entry.from >= least)) {
    let from = piece.from;
    while (piece.to - from > most) {
      // The quietest window of the second half of what one request may carry.
      let quietest = from + most - 1;
      for (let index = from + Math.ceil(most / 2); index < from + most; index++) if (levels[index] < levels[quietest]) quietest = index;
      cut.push({ from, to: quietest + 1 });
      from = quietest + 1;
    }
    cut.push({ from, to: piece.to });
  }
  const lead = Math.round(rate * 0.04), trail = Math.round(rate * 0.08);
  return cut.map((piece, index) => ({
    from: Math.max(index ? cut[index - 1].to * window : 0, piece.from * window - lead),
    to: Math.min(index + 1 < cut.length ? cut[index + 1].from * window : samples.length, piece.to * window + trail),
  }));
}

/** Float samples (−1…1) as 16-bit, clipped. */
export function pcm16OfFloat(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index++) out[index] = Math.max(-32768, Math.min(32767, Math.round(samples[index] * 32768)));
  return out;
}

/** A 16-bit mono WAV file of the samples. */
export function wavOfPcm16(samples: Int16Array, rate: number): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2), view = new DataView(out.buffer), tag = (at: number, text: string) => { for (let index = 0; index < 4; index++) out[at + index] = text.charCodeAt(index); };
  tag(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); tag(8, "WAVE"); tag(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); tag(36, "data"); view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index++) view.setInt16(44 + index * 2, samples[index], true);
  return out;
}

const SPACELESS = /[぀-ヿ㐀-鿿฀-๿]/u;
/**
 * What was heard in one piece of speech, as captions. A piece that fits two lines is ONE caption with the piece's
 * own start and end (measured). A longer one is divided at sentence ends, then at word boundaries, and its time is
 * shared out by character count — those inner boundaries are an estimate, the piece's outer ones are not.
 */
export function cuesOfSpeech(text: string, start_ms: number, end_ms: number, maxCharsPerLine = 42): Cue[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean || end_ms <= start_ms) return [];
  const most = Math.max(10, maxCharsPerLine) * 2, length = (value: string) => Array.from(value).length;
  if (length(clean) <= most) return [{ start_ms: Math.round(start_ms), end_ms: Math.round(end_ms), text: clean }];
  const units = SPACELESS.test(clean) && !clean.includes(" ") ? Array.from(clean) : clean.split(" "), joiner = units.length === Array.from(clean).length ? "" : " ";
  const parts: string[] = [];
  let line = "";
  for (const unit of units) {
    const next = line ? `${line}${joiner}${unit}` : unit;
    if (line && length(next) > most) { parts.push(line); line = unit; } else line = next;
    // A sentence end closes the caption once it has filled at least one line.
    if (/[.!?。！？]$/u.test(line) && length(line) >= most / 2) { parts.push(line); line = ""; }
  }
  if (line) parts.push(line);
  const total = parts.reduce((sum, part) => sum + length(part), 0);
  let spent = 0;
  return parts.map((part) => { const from = start_ms + ((end_ms - start_ms) * spent) / total; spent += length(part); return { start_ms: Math.round(from), end_ms: Math.round(start_ms + ((end_ms - start_ms) * spent) / total), text: part }; });
}

/** A clip as the time map reads it: where it is, how long, and how it plays its source (trim, speed, curve, reverse, freeze). */
export type SpeechElement = Parameters<typeof retimeClipOf>[0] & { startTime: number };

/** The stretch of its file a clip plays, in source ticks — whatever order or speed it plays it in. */
export function sourceRangeOf(element: SpeechElement): { start: number; end: number } {
  const clip = retimeClipOf(element);
  return { start: clip.sourceStart, end: clip.sourceStart + Math.max(0, clip.sourceSpan) };
}

/**
 * Where a stretch of a clip's source is heard on the timeline (ticks), through the clip's own time map — the same map
 * the engine plays it by, so a speed curve and a reversed clip put their words where they sound. In a reversed clip
 * the end of the stretch is heard first: the result is ordered in timeline time.
 */
export function timelineRangeOfSource(element: SpeechElement, sourceFrom: number, sourceTo: number): { start: number; end: number } {
  const clip = retimeClipOf(element), a = element.startTime + clipTimeAt(clip, sourceFrom), b = element.startTime + clipTimeAt(clip, sourceTo);
  return { start: Math.round(Math.min(a, b)), end: Math.round(Math.max(a, b)) };
}

export class SpeechCancelled extends Error {}
/** A clip to listen to: its element (for the time map) and the file its sound is in. */
export type SpeechClip = { id: string; assetId: string; element: SpeechElement };
const TICKS = 120_000;

/**
 * Captions from the speech of clips. Each file is decoded once, the stretch every clip plays is cut at its pauses,
 * each piece is heard on its own (two at a time), and its cue is put where the clip's time map says the piece sounds.
 * The same stretch of the same file under two clips is heard once. Cancelling is honoured after EVERY wait: a
 * cancelled run throws `SpeechCancelled` and returns no cue, whatever was already heard.
 */
export async function captionsFromSpeech(input: {
  clips: SpeechClip[]; /** The rate of the decoded samples. */ rate: number;
  decode(assetId: string): Promise<Int16Array | null>;
  hear(wav: Uint8Array, seconds: number): Promise<{ text: string; model?: string; costUsd?: number }>;
  cancelled(): boolean; onProgress?(done: number, total: number): void;
}): Promise<{ cues: Cue[]; pieces: number; undecoded: number; model?: string; costUsd: number }> {
  const stop = () => { if (input.cancelled()) throw new SpeechCancelled(); };
  const sounds = new Map<string, Int16Array | null>(), work: { clip: SpeechClip; samples: Int16Array; first: number; from: number; to: number; key: string }[] = [];
  let undecoded = 0;
  for (const clip of input.clips) {
    stop();
    if (!sounds.has(clip.assetId)) { const sound = await input.decode(clip.assetId).catch(() => null); stop(); sounds.set(clip.assetId, sound); }
    const sound = sounds.get(clip.assetId);
    if (!sound) { undecoded++; continue; }
    const range = sourceRangeOf(clip.element), first = Math.max(0, Math.min(sound.length, Math.round((range.start / TICKS) * input.rate))), last = Math.max(first, Math.min(sound.length, Math.round((range.end / TICKS) * input.rate)));
    const samples = sound.subarray(first, last);
    for (const piece of speechPieces(samples, input.rate)) work.push({ clip, samples, first, from: piece.from, to: piece.to, key: `${clip.assetId}:${first + piece.from}:${first + piece.to}` });
  }
  const heard = new Map<string, Promise<{ text: string; model?: string; costUsd?: number }>>(), cues: Cue[] = [];
  let done = 0, next = 0, model: string | undefined, costUsd = 0;
  input.onProgress?.(0, work.length);
  const worker = async () => {
    while (next < work.length) {
      const item = work[next++];
      stop();
      if (!heard.has(item.key)) heard.set(item.key, input.hear(wavOfPcm16(item.samples.subarray(item.from, item.to), input.rate), (item.to - item.from) / input.rate).then((result) => { costUsd += result.costUsd ?? 0; return result; }));
      const result = await heard.get(item.key)!;
      stop();
      if (result.model) model = result.model;
      const sourceOf = (sample: number) => (item.first + sample) / input.rate * TICKS, at = timelineRangeOfSource(item.clip.element, sourceOf(item.from), sourceOf(item.to));
      cues.push(...cuesOfSpeech(result.text, at.start / (TICKS / 1000), at.end / (TICKS / 1000)));
      input.onProgress?.(++done, work.length);
    }
  };
  // A worker that stops must not leave the other's failure unhandled.
  const settled = await Promise.allSettled([worker(), worker()]);
  stop();
  const failed = settled.find((entry): entry is PromiseRejectedResult => entry.status === "rejected");
  if (failed) throw failed.reason;
  return { cues: cues.sort((a, b) => a.start_ms - b.start_ms), pieces: work.length, undecoded, ...(model ? { model } : {}), costUsd };
}

/**
 * The captions of a translated track, cue for cue with the source track: every source caption keeps its place and its
 * times, and one whose translation failed is there with no text — so a later retry fills the same track.
 */
export function translatedCues(captions: readonly { id: string; startTime: number; duration: number }[], translations: ReadonlyMap<string, string>): Cue[] {
  return captions.map((caption) => ({ start_ms: caption.startTime / (TICKS / 1000), end_ms: (caption.startTime + caption.duration) / (TICKS / 1000), text: translations.get(caption.id) ?? "" }));
}
