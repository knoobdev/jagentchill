import type { ClipStretch } from "@jagentchill/editor-core";
import { loadWasm } from "../engine/wasm.ts";
import { sampleAt } from "./resample.ts";

/**
 * Stage 4 of the signal chain where it is more than a resampling: a clip whose speed changes with its pitch kept
 * (`speed-retime.Pitch preservation`) and a clip whose pitch is shifted (`audio-editing.Audio pitch shift`). Both
 * are the WSOLA stretch of the wasm audio crate followed by a band-limited read: the stretch makes a signal of the
 * pitch of the source and of `pitchFactor` times the wanted length, and the read plays it `pitchFactor` times as
 * fast. The live output and the export mixdown run this same code.
 */

export { pitchPreservation, rateRange, STRETCH_RANGE, type ClipStretch } from "@jagentchill/editor-core";
type Stereo = [Float32Array, Float32Array];
type Engine = { wsolaHop(): number; wsolaNeeded(nominal: Float64Array, previous: number): Float64Array; wsolaProcess(left: Float32Array, right: Float32Array, base: number, nominal: Float64Array, previous: number): Float32Array };
/** Hops rendered before the first one that is heard when a stretch starts in the middle of a clip. */
const RUN_IN_HOPS = 2;
/** Hops per call into the engine: bounds the input window held at once (about 3 s of output). */
const BATCH_HOPS = 96;
const TAPS = 16;

/**
 * The stretched signal of one clip, produced hop by hop as the mix asks for it. Consecutive blocks continue the
 * same stretch; a block that starts elsewhere starts a new one two hops early.
 */
export class ClipStretcher {
  private engine: Engine | undefined;
  private hop = 0;
  /** Where the previous segment was taken from: the whole state of the stretch (`NaN` before the first segment). */
  private previous = Number.NaN;
  /** Stretched frames of hops `[firstHop, nextHop)`. */
  private buffer: Stereo = [new Float32Array(0), new Float32Array(0)];
  private firstHop = 0;
  private nextHop = Number.NaN;

  /**
   * The clip's sound over the clip frames `[from, to)` (frames at the internal rate, 0 at the clip's start).
   * `position(t)` is the source position of clip frame `t` in "playback order" (increasing while the clip plays,
   * so a reversed clip passes the negated source position), and `fetch(low, high)` reads that order.
   */
  async render(stretch: ClipStretch, from: number, to: number, position: (clipFrame: number) => number, fetch: (low: number, high: number) => Promise<Stereo> | Stereo): Promise<Stereo> {
    if (!this.engine) {
      this.engine = await loadWasm() as unknown as Engine;
      this.hop = this.engine.wsolaHop();
    }
    const { keepPitch, pitchFactor } = stretch, origin = position(0), hop = this.hop;
    // Clip frame → stretched frame, and stretched frame → source position.
    const stretched = keepPitch ? (t: number) => pitchFactor * t : (t: number) => pitchFactor * (position(t) - origin);
    const nominalAt = keepPitch ? (v: number) => position(v / pitchFactor) : (v: number) => origin + v / pitchFactor;
    const first = stretched(from), last = stretched(to - 1);
    const lowHop = Math.floor((Math.floor(Math.min(first, last)) - TAPS) / hop), highHop = Math.floor((Math.ceil(Math.max(first, last)) + TAPS) / hop);
    if (!(lowHop >= this.firstHop && lowHop <= this.nextHop)) {
      this.previous = Number.NaN;
      this.firstHop = this.nextHop = lowHop - RUN_IN_HOPS;
      this.buffer = [new Float32Array(0), new Float32Array(0)];
    } else if (lowHop > this.firstHop) {
      const drop = (lowHop - this.firstHop) * hop;
      this.buffer = [this.buffer[0].slice(drop), this.buffer[1].slice(drop)];
      this.firstHop = lowHop;
    }
    while (this.nextHop <= highHop) {
      const count = Math.min(BATCH_HOPS, highHop - this.nextHop + 1);
      const nominal = new Float64Array(count);
      // A segment plays its hop of input at the input's own speed: it is placed so that its middle is on the time map.
      for (let index = 0; index < count; index++) nominal[index] = nominalAt((this.nextHop + index + 0.5) * hop) - hop / 2;
      const [low, high] = this.engine.wsolaNeeded(nominal, this.previous);
      const input = await fetch(low, high);
      const made = this.engine.wsolaProcess(input[0], input[1], low, nominal, this.previous);
      const frames = count * hop, held = this.buffer[0].length;
      this.previous = made[frames * 2] * 16777216 + made[frames * 2 + 1];
      const grown: Stereo = [new Float32Array(held + frames), new Float32Array(held + frames)];
      grown[0].set(this.buffer[0]); grown[0].set(made.subarray(0, frames), held);
      grown[1].set(this.buffer[1]); grown[1].set(made.subarray(frames, frames * 2), held);
      this.buffer = grown;
      this.nextHop += count;
    }
    const base = this.firstHop * hop, [left, right] = this.buffer, out: Stereo = [new Float32Array(to - from), new Float32Array(to - from)];
    const readLeft = (index: number) => (index >= 0 && index < left.length ? left[index] : 0), readRight = (index: number) => (index >= 0 && index < right.length ? right[index] : 0);
    // The stretched signal is read `pitchFactor` (times the rate, when pitch follows speed) frames per frame: above
    // one frame per frame the read is band-limited below the new Nyquist frequency.
    const ANCHOR = 64;
    for (let anchor = from; anchor < to; anchor += ANCHOR) {
      const stop = Math.min(anchor + ANCHOR, to);
      const a = stretched(anchor), step = keepPitch ? pitchFactor : stop - 1 > anchor ? (stretched(stop - 1) - a) / (stop - 1 - anchor) : pitchFactor;
      const cutoff = Math.abs(step) > 1 ? 1 / Math.abs(step) : 1;
      for (let frame = anchor; frame < stop; frame++) {
        const at = a + step * (frame - anchor) - base;
        out[0][frame - from] = sampleAt(readLeft, at, cutoff);
        out[1][frame - from] = sampleAt(readRight, at, cutoff);
      }
    }
    return out;
  }

  dispose(): void { this.engine = undefined; this.nextHop = Number.NaN; }
}
