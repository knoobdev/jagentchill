import { TICKS_PER_SECOND, type Rational } from "@jagentchill/protocol";
import { frameToTicks } from "@jagentchill/editor-core";
import type { CacheStore } from "./cache.ts";

/**
 * Filmstrip cache of a video asset: frames 90 px high sampled every second, sparser levels derived from that base
 * level, and denser frames made on demand for the visible range.
 */
export const FILMSTRIP_HEIGHT = 90;
const S = TICKS_PER_SECOND;
/** Base interval and the sparser levels derived from it, in ticks. */
export const FILMSTRIP_BASE_INTERVAL = S;
export const FILMSTRIP_DERIVED_INTERVALS = [2 * S, 5 * S, 10 * S, 30 * S, 60 * S] as const;
/** On-demand dense level; below it frames are made at single-frame intervals. */
export const FILMSTRIP_DENSE_INTERVAL = S / 2;
export const FILMSTRIP_MAX_CONCURRENT_DECODES = 2;

export const filmstripFrameSize = ({ width, height }: { width: number; height: number }): { width: number; height: number } =>
  ({ width: Math.max(1, Math.round((FILMSTRIP_HEIGHT * width) / height)), height: FILMSTRIP_HEIGHT });

/** Every interval a video offers: single frame, 0.5 s, 1 s and the derived levels. */
export const filmstripIntervals = (fps: Rational): number[] => [frameToTicks(1, fps), FILMSTRIP_DENSE_INTERVAL, FILMSTRIP_BASE_INTERVAL, ...FILMSTRIP_DERIVED_INTERVALS].sort((a, b) => a - b).filter((value, index, all) => index === 0 || value !== all[index - 1]);

/**
 * The interval whose frames a tile wants: the densest level whose interval is ≥ the tile's time width. Denser than
 * 1 s only when the zoom makes a tile narrower than 0.5 s.
 */
export function wantedFilmstripInterval(tileTicks: number, fps: Rational): number {
  const frame = frameToTicks(1, fps);
  if (tileTicks < FILMSTRIP_DENSE_INTERVAL) return tileTicks <= frame ? frame : FILMSTRIP_DENSE_INTERVAL;
  return [FILMSTRIP_BASE_INTERVAL, ...FILMSTRIP_DERIVED_INTERVALS].find((interval) => interval >= tileTicks) ?? FILMSTRIP_DERIVED_INTERVALS[FILMSTRIP_DERIVED_INTERVALS.length - 1];
}
/** Among the intervals that have frames, the densest one whose interval is ≥ the tile's time width (the sparsest when the tile is wider than all). */
export function chooseFilmstripInterval(tileTicks: number, available: number[]): number | null {
  if (available.length === 0) return null;
  const sorted = [...available].sort((a, b) => a - b);
  return sorted.find((interval) => interval >= tileTicks) ?? sorted[sorted.length - 1];
}

/**
 * Where a frame is stored. Derived levels hold no frames of their own: the frame of a 5 s level at index i is the
 * base-level frame at 5 i seconds, so every multiple of 1 s is stored once under the base interval. Dense and
 * single-frame samples that do not fall on a whole second are stored under their own time.
 */
export const filmstripKey = (contentHash: string, timeTicks: number): string => `filmstrip/${contentHash}/${timeTicks}`;
/** The source time a tile shows at a level: the level's sample at or before the tile start. */
export const filmstripSampleTime = (tileStartTicks: number, interval: number): number => Math.max(0, Math.floor(tileStartTicks / interval) * interval);
/** Sample times of one level over a source range. */
export function filmstripTimes(interval: number, range: { start: number; end: number }, durationTicks: number): number[] {
  const times: number[] = [], last = Math.max(0, durationTicks - 1);
  for (let time = filmstripSampleTime(range.start, interval); time < range.end && time <= last; time += interval) times.push(time);
  return times;
}
/** The base-level sample times of a whole asset: what background generation fills. */
export const filmstripBaseTimes = (durationTicks: number): number[] => filmstripTimes(FILMSTRIP_BASE_INTERVAL, { start: 0, end: durationTicks }, durationTicks);

export type FilmstripRequest = { contentHash: string; time: number };
/** Decodes one frame at `time` (ticks) scaled to 90 px high and returns it encoded. Supplied by the platform. */
export type FilmstripDecode = (request: FilmstripRequest) => Promise<Uint8Array>;
export type FilmstripOptions = { cache: CacheStore; decode: FilmstripDecode; concurrency?: number; onFrame?: (request: FilmstripRequest, bytes: Uint8Array) => void };
type Job = FilmstripRequest & { key: string; priority: number; order: number; waiters: { resolve: (bytes: Uint8Array) => void; reject: (error: unknown) => void }[] };

/**
 * Generates frames in priority order: the visible timeline range first, then the rest; at most two decodes at a
 * time; nothing is decoded while playback or an export runs. A cached frame is returned without decoding.
 */
export class FilmstripScheduler {
  private readonly queue = new Map<string, Job>();
  private readonly inFlight = new Map<string, Job>();
  private running = 0;
  private paused = false;
  private order = 0;
  private readonly options: FilmstripOptions;
  constructor(options: FilmstripOptions) { this.options = options; }

  /** A cached frame, or `undefined` — a missing filmstrip never blocks editing. */
  cached(request: FilmstripRequest): Promise<Uint8Array | undefined> {
    return this.options.cache.get(filmstripKey(request.contentHash, request.time));
  }
  /** Requests one frame. `visible` requests run before background ones; among equals, first asked first served. */
  request(request: FilmstripRequest, options: { visible?: boolean } = {}): Promise<Uint8Array> {
    const key = filmstripKey(request.contentHash, request.time), priority = options.visible ? 1 : 0;
    return new Promise<Uint8Array>((resolve, reject) => {
      // A frame that is queued or being decoded is never decoded twice: later requests join it.
      const job = this.queue.get(key) ?? this.inFlight.get(key);
      if (job) {
        job.priority = Math.max(job.priority, priority);
        job.waiters.push({ resolve, reject });
      } else this.queue.set(key, { ...request, key, priority, order: this.order++, waiters: [{ resolve, reject }] });
      this.pump();
    });
  }
  /** Schedules the base level of an asset, the visible range first. */
  schedule(asset: { contentHash: string; duration: number }, visible?: { start: number; end: number }): Promise<unknown>[] {
    const inView = new Set(visible ? filmstripTimes(FILMSTRIP_BASE_INTERVAL, visible, asset.duration) : []);
    const times = filmstripBaseTimes(asset.duration);
    return [...times.filter((time) => inView.has(time)), ...times.filter((time) => !inView.has(time))]
      .map((time) => this.request({ contentHash: asset.contentHash, time }, { visible: inView.has(time) }).catch(() => undefined));
  }
  /** The viewport moved: frames in the new range jump the queue and everything else falls back to background. */
  prioritise(contentHash: string, visible: { start: number; end: number }): void {
    for (const job of this.queue.values()) if (job.contentHash === contentHash) job.priority = job.time >= filmstripSampleTime(visible.start, FILMSTRIP_BASE_INTERVAL) && job.time < visible.end ? 1 : 0;
  }
  /** Playback or an export started. Decodes already running finish; no new one starts. */
  pause(): void { this.paused = true; }
  resume(): void { this.paused = false; this.pump(); }
  /** Drops the queued work of an asset (it was removed or went offline). */
  cancel(contentHash: string): void {
    for (const [key, job] of this.queue) if (job.contentHash === contentHash) { this.queue.delete(key); for (const waiter of job.waiters) waiter.reject(new Error("cancelled")); }
  }
  get pending(): number { return this.queue.size; }
  get active(): number { return this.running; }

  private pump(): void {
    const limit = this.options.concurrency ?? FILMSTRIP_MAX_CONCURRENT_DECODES;
    while (!this.paused && this.running < limit && this.queue.size > 0) {
      let next: Job | undefined;
      for (const job of this.queue.values()) if (!next || job.priority > next.priority || (job.priority === next.priority && job.order < next.order)) next = job;
      if (!next) return;
      this.queue.delete(next.key);
      this.inFlight.set(next.key, next);
      this.running++;
      void this.run(next);
    }
  }
  private async run(job: Job): Promise<void> {
    try {
      let bytes = await this.options.cache.get(job.key).catch(() => undefined);
      if (!bytes) {
        bytes = await this.options.decode({ contentHash: job.contentHash, time: job.time });
        await this.options.cache.put(job.key, bytes).catch(() => undefined);
      }
      this.options.onFrame?.({ contentHash: job.contentHash, time: job.time }, bytes);
      for (const waiter of job.waiters) waiter.resolve(bytes);
    } catch (error) {
      for (const waiter of job.waiters) waiter.reject(error);
    } finally {
      this.inFlight.delete(job.key);
      this.running--;
      this.pump();
    }
  }
}
