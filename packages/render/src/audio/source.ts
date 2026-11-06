import { ALL_FORMATS, AudioSampleSink, Input, UrlSource } from "mediabunny";
import { INTERNAL_SAMPLE_RATE } from "./gain.ts";
import { sampleAt } from "./resample.ts";
import type { SourceReader } from "./mixdown.ts";

type Region = { rate: number; first: number; left: Float32Array; right: Float32Array };
type Opened = { input: Input; sink: AudioSampleSink | null; region?: Region };

const MARGIN_SECONDS = 0.05;

/**
 * A sound that cannot be put into the mix: its file is not on this device (`missing`), or the file is here and its
 * audio track cannot be decoded by this device (`undecodable`). It names the asset, so that what a person is told
 * names the clip — an export never goes on without the sound.
 */
export class AudioSourceError extends Error {
  readonly assetId: string;
  readonly reason: "missing" | "undecodable";
  constructor(assetId: string, reason: "missing" | "undecodable", message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AudioSourceError"; this.assetId = assetId; this.reason = reason;
  }
}

/**
 * Stereo samples of media assets at the internal rate, decoded through mediabunny on demand. One contiguous
 * region per asset is kept, sized by what the mix asks for, so memory does not grow with the length of a file.
 */
export class AudioSources {
  private readonly urlOf: (assetId: string) => string | undefined;
  private readonly opened = new Map<string, Promise<Opened>>();
  private readonly missing: "silence" | "fail";
  private readonly onUnplayable?: (assetId: string, reason: "undecodable") => void;
  private readonly told = new Set<string>();
  private readonly waived?: (assetId: string) => boolean;
  /**
   * `missing`: what a sound that cannot be had is — its file is not on this device, or its audio track cannot be
   * decoded here. The preview (`silence`) plays it as silence — a file that is not there yet may still be coming from
   * the host, and is played once it is — and says ONCE per sound that it cannot be decoded (`onUnplayable`), never on
   * every block. An export (`fail`, the default) fails by the asset's id with an `AudioSourceError` — a film is never
   * written with a sound silently left out. `waived`: the sounds a person was shown by name and chose to export
   * without ("Export anyway") — in `fail` mode those, and ONLY those, are silence; every other sound still fails.
   */
  constructor(urlOf: (assetId: string) => string | undefined, options: { missing?: "silence" | "fail"; waived?(assetId: string): boolean; onUnplayable?(assetId: string, reason: "undecodable"): void } = {}) {
    this.urlOf = urlOf; this.missing = options.missing ?? "fail"; this.onUnplayable = options.onUnplayable; this.waived = options.waived;
  }

  /** Whether this sound, when it cannot be had, stops whoever asked (an export) instead of being silence. */
  private fails(assetId: string): boolean {
    return this.missing === "fail" && this.waived?.(assetId) !== true;
  }

  /** The preview goes on without this sound; whoever listens is told once. */
  private unplayable(assetId: string): void {
    if (this.told.has(assetId)) return;
    this.told.add(assetId);
    this.onUnplayable?.(assetId, "undecodable");
  }

  private open(assetId: string): Promise<Opened> {
    let opened = this.opened.get(assetId);
    if (!opened) {
      const url = this.urlOf(assetId);
      opened = (async () => {
        if (!url) throw new AudioSourceError(assetId, "missing", `asset ${assetId} has no source`);
        const input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
        let track: Awaited<ReturnType<Input["getPrimaryAudioTrack"]>>, decodable: boolean;
        try {
          track = await input.getPrimaryAudioTrack();
          decodable = track ? await track.canDecode() : false;
        } catch (error) {
          // The file is here and is not something sound can be read from (a codec the reader does not know, a broken file).
          input.dispose?.();
          throw new AudioSourceError(assetId, "undecodable", `the file of asset ${assetId} cannot be read as sound`, { cause: error });
        }
        // A file without any audio track has no sound to lose; a track that is there and cannot be decoded has.
        if (track && !decodable) {
          if (this.fails(assetId)) { input.dispose?.(); throw new AudioSourceError(assetId, "undecodable", `the sound of asset ${assetId} cannot be decoded on this device`); }
          this.unplayable(assetId);
          return { input, sink: null };
        }
        return { input, sink: track ? new AudioSampleSink(track) : null };
      })();
      this.opened.set(assetId, opened);
      // A source that is not there is asked for again the next time: its file may arrive later. A file that IS there
      // and cannot be read stays what it is until the asset is given another file (`forget`).
      opened.catch((error) => { if (this.opened.get(assetId) === opened && !(!this.fails(assetId) && error instanceof AudioSourceError && error.reason === "undecodable")) this.opened.delete(assetId); });
    }
    return opened;
  }

  /** Decodes the source seconds `[from, to)` into a region at the source rate, downmixed to stereo. */
  private async decode(opened: Opened, from: number, to: number): Promise<Region | undefined> {
    if (!opened.sink) return undefined;
    let region: Region | undefined;
    // Samples, not `AudioBuffer`s: the same decoder path serves the window and the export worker, which has no Web Audio.
    for await (const sample of opened.sink.samples(Math.max(0, from), to)) {
      try {
        const rate = sample.sampleRate, frames = sample.numberOfFrames;
        if (!region) {
          const first = Math.round(Math.max(0, from) * rate);
          const length = Math.ceil((to - Math.max(0, from)) * rate) + 1;
          region = { rate, first, left: new Float32Array(length), right: new Float32Array(length) };
        }
        const offset = Math.round(sample.timestamp * rate) - region.first;
        const left = new Float32Array(frames), right = sample.numberOfChannels > 1 ? new Float32Array(frames) : left;
        sample.copyTo(left, { planeIndex: 0, format: "f32-planar" });
        if (right !== left) sample.copyTo(right, { planeIndex: 1, format: "f32-planar" });
        for (let index = Math.max(0, -offset); index < frames && index + offset < region.left.length; index++) {
          region.left[index + offset] = left[index];
          region.right[index + offset] = right[index];
        }
      } finally {
        sample.close();
      }
    }
    return region;
  }

  readonly read: SourceReader = async (assetId, firstFrame, count) => {
    const out: [Float32Array, Float32Array] = [new Float32Array(count), new Float32Array(count)];
    if (!this.fails(assetId) && !this.opened.has(assetId) && !this.urlOf(assetId)) return out;
    let opened: Opened;
    try { opened = await this.open(assetId); } catch (error) {
      if (this.fails(assetId)) throw error;
      if (error instanceof AudioSourceError && error.reason === "undecodable") this.unplayable(assetId);
      return out;
    }
    const from = firstFrame / INTERNAL_SAMPLE_RATE - MARGIN_SECONDS, to = (firstFrame + count) / INTERNAL_SAMPLE_RATE + MARGIN_SECONDS;
    if (to <= 0) return out;
    let region = opened.region;
    if (!region || from * region.rate < region.first - 1 && from > 0 || to * region.rate > region.first + region.left.length) {
      try {
        region = opened.region = await this.decode(opened, from, to);
      } catch (error) {
        // A track that announced itself as decodable and then breaks while decoding: the same two answers.
        if (this.fails(assetId)) throw new AudioSourceError(assetId, "undecodable", `the sound of asset ${assetId} cannot be decoded on this device`, { cause: error });
        opened.sink = null; opened.region = undefined;
        this.unplayable(assetId);
        return out;
      }
    }
    if (!region) return out;
    const ratio = region.rate / INTERNAL_SAMPLE_RATE;
    const cutoff = Math.min(1, 1 / ratio);
    const { left, right, first } = region;
    for (let index = 0; index < count; index++) {
      const position = (firstFrame + index) * ratio - first;
      out[0][index] = sampleAt((at) => (at >= 0 && at < left.length ? left[at] : 0), position, cutoff);
      out[1][index] = sampleAt((at) => (at >= 0 && at < right.length ? right[at] : 0), position, cutoff);
    }
    return out;
  };

  /** The asset was given another file (its original arrived, it was relinked): what was opened and said of the old one is dropped. */
  forget(assetId: string): void {
    const opened = this.opened.get(assetId);
    if (opened) void opened.then(({ input }) => input.dispose?.()).catch(() => undefined);
    this.opened.delete(assetId);
    this.told.delete(assetId);
  }

  dispose(): void {
    for (const opened of this.opened.values()) void opened.then(({ input }) => input.dispose?.()).catch(() => undefined);
    this.opened.clear();
  }
}
