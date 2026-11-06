/** Band-limited sample-rate conversion and fractional-position reads, by a Blackman-windowed sinc. */

const HALF_TAPS = 16;

function kernel(distance: number, cutoff: number): number {
  const x = Math.abs(distance);
  if (x >= HALF_TAPS) return 0;
  const sinc = x < 1e-9 ? cutoff : Math.sin(Math.PI * cutoff * x) / (Math.PI * x);
  const phase = (Math.PI * x) / HALF_TAPS;
  return sinc * (0.42 + 0.5 * Math.cos(phase) + 0.08 * Math.cos(2 * phase));
}

/**
 * The value of a sampled signal at a fractional position. At an integer position with `cutoff` 1 the result is
 * the stored sample itself, so an unretimed clip passes through unchanged.
 */
export function sampleAt(read: (index: number) => number, position: number, cutoff = 1): number {
  const base = Math.floor(position);
  if (cutoff === 1 && position === base) return read(base);
  let sum = 0;
  for (let index = base - HALF_TAPS + 1; index <= base + HALF_TAPS; index++) {
    const weight = kernel(position - index, cutoff);
    if (weight !== 0) sum += weight * read(index);
  }
  return sum;
}

/** A streaming resampler: feed blocks at `inRate`, receive blocks at `outRate`; state carries across calls. */
export class Resampler {
  readonly inRate: number;
  readonly outRate: number;
  private readonly cutoff: number;
  private readonly tail: Float32Array[];
  private consumed = 0;   // input frames consumed before the start of `tail`
  private produced = 0;   // output frames produced so far

  constructor(inRate: number, outRate: number, channels: number) {
    this.inRate = inRate;
    this.outRate = outRate;
    this.cutoff = Math.min(1, outRate / inRate);
    this.tail = Array.from({ length: channels }, () => new Float32Array(0));
  }

  /** Converts a block. With `flush` the remaining tail is drained as if followed by silence. */
  process(input: Float32Array[], flush = false): Float32Array[] {
    if (this.inRate === this.outRate) return input;
    const joined = this.tail.map((tail, channel) => {
      const out = new Float32Array(tail.length + input[channel].length);
      out.set(tail);
      out.set(input[channel], tail.length);
      return out;
    });
    const available = this.consumed + joined[0].length;
    // An output frame needs HALF_TAPS input frames after its position, unless the stream is ending.
    const lastUsable = flush ? available : available - HALF_TAPS;
    const count = Math.max(0, Math.ceil((lastUsable * this.outRate) / this.inRate) - this.produced);
    const out = joined.map(() => new Float32Array(count));
    for (let frame = 0; frame < count; frame++) {
      const position = ((this.produced + frame) * this.inRate) / this.outRate - this.consumed;
      for (let channel = 0; channel < joined.length; channel++) {
        const data = joined[channel];
        out[channel][frame] = sampleAt((index) => (index >= 0 && index < data.length ? data[index] : 0), position, this.cutoff);
      }
    }
    this.produced += count;
    // Keep what later output frames still read.
    const nextPosition = (this.produced * this.inRate) / this.outRate - this.consumed;
    const drop = Math.max(0, Math.min(joined[0].length, Math.floor(nextPosition) - HALF_TAPS));
    this.tail.forEach((_, channel) => { this.tail[channel] = joined[channel].slice(drop); });
    this.consumed += drop;
    return out;
  }
}
