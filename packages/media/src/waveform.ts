import { sha256OfText } from "./hash.ts";
import type { CacheStore } from "./cache.ts";

/**
 * The stored waveform summary: min/max peak pairs of the mono mix at 100 pairs per second, 8-bit, with levels
 * downsampled by 4, 16 and 64. One summary per content hash, shared by every clip of the asset.
 * [PORT: `media/waveform-summary.ts` and `services/waveform-cache/service.ts` of OpenCut classic — the single-flight
 * cache and the bucket sampling are kept; the summary format is the one this product defines.]
 */
export const WAVEFORM_PAIRS_PER_SECOND = 100;
export const WAVEFORM_LEVEL_FACTORS = [1, 4, 16, 64] as const;
export type WaveformLevel = { factor: number; /** Interleaved min, max — signed 8-bit, −127 … 127 for −1 … 1. */ pairs: Int8Array };
export type WaveformSummary = { sampleRate: number; totalSamples: number; levels: WaveformLevel[] };

const toInt8 = (value: number): number => Math.max(-127, Math.min(127, Math.round(value * 127)));

/** Builds a summary from decoded audio delivered in chunks of any size. */
export class WaveformBuilder {
  private pairs = new Int8Array(2048);
  private count = 0;
  private samples = 0;
  private min = Infinity;
  private max = -Infinity;
  readonly sampleRate: number;
  constructor(sampleRate: number) {
    if (!(sampleRate > 0)) throw new RangeError("sample rate must be positive");
    this.sampleRate = sampleRate;
  }

  /** `channels`: one Float32Array per channel, all of the same length; they are mixed to mono by averaging. */
  push(channels: Float32Array[]): void {
    const frames = channels[0]?.length ?? 0, n = channels.length;
    for (let i = 0; i < frames; i++) {
      let value = 0;
      for (let c = 0; c < n; c++) value += channels[c][i];
      value /= n;
      // Pair k covers the samples whose time lies in [k / 100 s, (k + 1) / 100 s), also at rates not divisible by 100.
      const pair = Math.floor((this.samples * WAVEFORM_PAIRS_PER_SECOND) / this.sampleRate);
      while (pair > this.count) this.flush();
      if (value < this.min) this.min = value;
      if (value > this.max) this.max = value;
      this.samples++;
    }
  }
  private flush(): void {
    if (this.count * 2 + 2 > this.pairs.length) {
      const grown = new Int8Array(this.pairs.length * 2);
      grown.set(this.pairs);
      this.pairs = grown;
    }
    this.pairs[this.count * 2] = this.min === Infinity ? 0 : toInt8(this.min);
    this.pairs[this.count * 2 + 1] = this.max === -Infinity ? 0 : toInt8(this.max);
    this.count++;
    this.min = Infinity; this.max = -Infinity;
  }
  finish(): WaveformSummary {
    if (this.min !== Infinity) this.flush();
    const base = this.pairs.slice(0, this.count * 2);
    return { sampleRate: this.sampleRate, totalSamples: this.samples, levels: WAVEFORM_LEVEL_FACTORS.map((factor) => ({ factor, pairs: factor === 1 ? base : downsamplePairs(base, factor) })) };
  }
}
/** Min of the mins and max of the maxes over groups of `factor` pairs. */
export function downsamplePairs(pairs: Int8Array, factor: number): Int8Array {
  const count = Math.ceil(pairs.length / 2 / factor), out = new Int8Array(count * 2);
  for (let i = 0; i < count; i++) {
    let min = 127, max = -127;
    for (let j = i * factor, end = Math.min(pairs.length / 2, j + factor); j < end; j++) {
      if (pairs[j * 2] < min) min = pairs[j * 2];
      if (pairs[j * 2 + 1] > max) max = pairs[j * 2 + 1];
    }
    out[i * 2] = min; out[i * 2 + 1] = max;
  }
  return out;
}
export const buildWaveformSummary = (sampleRate: number, channels: Float32Array[]): WaveformSummary => {
  const builder = new WaveformBuilder(sampleRate);
  builder.push(channels);
  return builder.finish();
};

const MAGIC = 0x4a435746; // "JCWF"
/** Cache-store encoding: a 24-byte header, then per level `{factor, pairCount}` and the pairs. */
export function encodeWaveform(summary: WaveformSummary): Uint8Array {
  const size = 24 + summary.levels.reduce((sum, level) => sum + 8 + level.pairs.length, 0);
  const bytes = new Uint8Array(size), view = new DataView(bytes.buffer);
  view.setUint32(0, MAGIC); view.setUint32(4, 1); view.setUint32(8, summary.sampleRate); view.setFloat64(12, summary.totalSamples); view.setUint32(20, summary.levels.length);
  let offset = 24;
  for (const level of summary.levels) {
    view.setUint32(offset, level.factor); view.setUint32(offset + 4, level.pairs.length / 2);
    bytes.set(new Uint8Array(level.pairs.buffer, level.pairs.byteOffset, level.pairs.length), offset + 8);
    offset += 8 + level.pairs.length;
  }
  return bytes;
}
export function decodeWaveform(bytes: Uint8Array): WaveformSummary | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 24 || view.getUint32(0) !== MAGIC || view.getUint32(4) !== 1) return null;
  const levels: WaveformLevel[] = [];
  let offset = 24;
  for (let i = 0, count = view.getUint32(20); i < count; i++) {
    if (offset + 8 > bytes.length) return null;
    const factor = view.getUint32(offset), length = view.getUint32(offset + 4) * 2;
    if (offset + 8 + length > bytes.length) return null;
    levels.push({ factor, pairs: new Int8Array(bytes.slice(offset + 8, offset + 8 + length).buffer) });
    offset += 8 + length;
  }
  return { sampleRate: view.getUint32(8), totalSamples: view.getFloat64(12), levels };
}

/** Summaries are keyed by content hash; a library sound that is not a project asset is keyed by the SHA-256 of its URL. */
export const waveformKey = (source: { contentHash: string } | { url: string }): string => `waveform/${"contentHash" in source ? source.contentHash : sha256OfText(source.url)}`;

/**
 * Peaks for drawing `bars` columns over a source range, read from the coarsest level that still gives at least one
 * pair per column. Returns interleaved min, max in −1 … 1. [PORT: `sampleSourceWaveformSummary`]
 */
export function sampleWaveform(summary: WaveformSummary, range: { startSeconds: number; endSeconds: number; bars: number }): Float32Array {
  const out = new Float32Array(Math.max(0, range.bars) * 2);
  if (range.bars <= 0 || range.endSeconds <= range.startSeconds) return out;
  const pairsPerBar = ((range.endSeconds - range.startSeconds) * WAVEFORM_PAIRS_PER_SECOND) / range.bars;
  const level = [...summary.levels].sort((a, b) => b.factor - a.factor).find((candidate) => candidate.factor <= pairsPerBar) ?? summary.levels.find((candidate) => candidate.factor === 1) ?? summary.levels[0];
  if (!level) return out;
  const perSecond = WAVEFORM_PAIRS_PER_SECOND / level.factor, count = level.pairs.length / 2;
  for (let bar = 0; bar < range.bars; bar++) {
    const from = range.startSeconds + ((range.endSeconds - range.startSeconds) * bar) / range.bars, to = range.startSeconds + ((range.endSeconds - range.startSeconds) * (bar + 1)) / range.bars;
    const startIndex = Math.max(0, Math.floor(from * perSecond)), endIndex = Math.min(count, Math.max(startIndex + 1, Math.ceil(to * perSecond)));
    let min = 0, max = 0, any = false;
    for (let i = startIndex; i < endIndex; i++) {
      const lo = level.pairs[i * 2], hi = level.pairs[i * 2 + 1];
      if (!any || lo < min) min = lo;
      if (!any || hi > max) max = hi;
      any = true;
    }
    out[bar * 2] = min / 127; out[bar * 2 + 1] = max / 127;
  }
  return out;
}

export type WaveformState = { state: "computing"; progress: number } | { state: "ready"; summary: WaveformSummary } | { state: "failed"; reason: string };
/** Decodes the audio of one source and feeds the builder; reports progress 0–1. Supplied by the platform (WebCodecs in a worker, FFmpeg on the host). */
export type WaveformCompute = (key: string, onProgress: (fraction: number) => void) => Promise<WaveformSummary>;
type Entry = { state: WaveformState; promise: Promise<WaveformSummary>; listeners: Set<(state: WaveformState) => void> };

/**
 * One summary per key however many clips ask for it: the first request reads the cache store or starts the
 * computation, later requests join it. A failure is logged, reported as `failed` and forgotten so a retry can run.
 */
export class WaveformService {
  private readonly entries = new Map<string, Entry>();
  private readonly options: { cache: CacheStore; log?: (message: string, detail: unknown) => void };
  constructor(options: { cache: CacheStore; log?: (message: string, detail: unknown) => void }) { this.options = options; }

  get(key: string, compute: WaveformCompute, onState?: (state: WaveformState) => void): Promise<WaveformSummary> {
    let entry = this.entries.get(key);
    if (!entry) {
      const created: Entry = { state: { state: "computing", progress: 0 }, listeners: new Set(), promise: undefined as unknown as Promise<WaveformSummary> };
      const publish = (state: WaveformState) => { created.state = state; for (const listener of created.listeners) listener(state); };
      created.promise = (async () => {
        const cached = await this.options.cache.get(key).catch(() => undefined);
        const stored = cached ? decodeWaveform(cached) : null;
        if (stored) return stored;
        const summary = await compute(key, (fraction) => publish({ state: "computing", progress: Math.max(0, Math.min(1, fraction)) }));
        await this.options.cache.put(key, encodeWaveform(summary)).catch((error) => this.options.log?.(`waveform ${key}: cache write failed`, error));
        return summary;
      })().then((summary) => { publish({ state: "ready", summary }); return summary; }, (error) => {
        // Never blocks playback: the renderer draws its failure presentation and the next request may retry.
        this.options.log?.(`waveform ${key}: computation failed`, error);
        publish({ state: "failed", reason: error instanceof Error ? error.message : String(error) });
        this.entries.delete(key);
        throw error;
      });
      created.promise.catch(() => undefined);
      this.entries.set(key, created);
      entry = created;
    }
    if (onState) { entry.listeners.add(onState); onState(entry.state); }
    return entry.promise;
  }
  state(key: string): WaveformState | undefined {
    return this.entries.get(key)?.state;
  }
  unsubscribe(key: string, onState: (state: WaveformState) => void): void {
    this.entries.get(key)?.listeners.delete(onState);
  }
  /** Removing an asset removes its summary from memory and from the cache store. */
  async remove(key: string): Promise<void> {
    this.entries.delete(key);
    await this.options.cache.delete(key);
  }
  clear(): void {
    this.entries.clear();
  }
}
