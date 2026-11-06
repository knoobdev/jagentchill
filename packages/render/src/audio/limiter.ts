/**
 * The mastering limiter: a deterministic true-peak limiter with ceiling 0.98, unity gain below the ceiling, a
 * 48-sample look-ahead and a 120 ms release (`audio-editing.Mastering limiter`). The same class runs in every block
 * of the export mixdown and inside the live output worklet; its state carries across calls.
 */

export const LIMITER_CEILING = 0.98;
export const LIMITER_LOOKAHEAD = 48;
const RELEASE_SECONDS = 0.12;

/** The 4× oversampling true-peak filter of ITU-R BS.1770-4: 48 taps as four phases of twelve. */
const PHASE_0 = [0.0017089843750, 0.0109863281250, -0.0196533203125, 0.0332031250000, -0.0594482421875, 0.1373291015625, 0.9721679687500, -0.1022949218750, 0.0476074218750, -0.0266113281250, 0.0148925781250, -0.0083007812500];
const PHASE_1 = [-0.0291748046875, 0.0292968750000, -0.0517578125000, 0.0891113281250, -0.1665039062500, 0.4650878906250, 0.7797851562500, -0.2003173828125, 0.1015625000000, -0.0582275390625, 0.0330810546875, -0.0189208984375];
export const TRUE_PEAK_PHASES: readonly (readonly number[])[] = [PHASE_0, PHASE_1, [...PHASE_1].reverse(), [...PHASE_0].reverse()];
const TAPS = 12;

/** The inter-sample peak of a signal measured with the 4× oversampling filter. */
export function truePeak(samples: Float32Array | number[]): number {
  let peak = 0;
  for (let index = 0; index < samples.length; index++) {
    for (const phase of TRUE_PEAK_PHASES) {
      let sum = 0;
      for (let tap = 0; tap < TAPS; tap++) {
        const at = index - tap;
        if (at >= 0) sum += phase[tap] * samples[at];
      }
      if (Math.abs(sum) > peak) peak = Math.abs(sum);
    }
    if (Math.abs(samples[index]) > peak) peak = Math.abs(samples[index]);
  }
  return peak;
}

export class Limiter {
  readonly channels: number;
  readonly lookahead: number;
  private readonly release: number;
  private readonly history: Float32Array[];   // last TAPS input samples per channel, for the true-peak filter
  private readonly delay: Float32Array[];     // look-ahead delay line per channel
  private readonly targets: Float64Array;     // g over the look-ahead window
  private readonly smoothed: Float64Array;    // released envelope over the averaging window
  private position = 0;
  private envelope = 1;

  /** `sampleRate` other than 48 000 scales the look-ahead to 1 ms of samples at that rate. */
  constructor(channels = 2, sampleRate = 48_000) {
    this.channels = channels;
    this.lookahead = sampleRate === 48_000 ? LIMITER_LOOKAHEAD : Math.max(1, Math.round(sampleRate / 1000));
    this.release = Math.exp(-1 / (RELEASE_SECONDS * sampleRate));
    this.history = Array.from({ length: channels }, () => new Float32Array(TAPS));
    this.delay = Array.from({ length: channels }, () => new Float32Array(this.lookahead));
    this.targets = new Float64Array(this.lookahead + 1).fill(1);
    this.smoothed = new Float64Array(this.lookahead).fill(1);
  }

  /** Clears the oversampling history, the look-ahead buffer and the envelope: at every export start, live seek and transport start. */
  reset(): void {
    for (const buffer of [...this.history, ...this.delay]) buffer.fill(0);
    this.targets.fill(1);
    this.smoothed.fill(1);
    this.position = 0;
    this.envelope = 1;
  }

  /**
   * Limits a block in place. The output is the input delayed by `lookahead` samples; the caller compensates
   * (the mixdown drops the first `lookahead` output samples and flushes as many after the last block).
   */
  process(block: Float32Array[], length = block[0].length): void {
    const { lookahead, channels } = this;
    for (let index = 0; index < length; index++) {
      // True peak of the linked channels at the newest sample.
      let peak = 0;
      for (let channel = 0; channel < channels; channel++) {
        const history = this.history[channel];
        history.copyWithin(1, 0, TAPS - 1);
        history[0] = block[channel][index];
        for (const phase of TRUE_PEAK_PHASES) {
          let sum = 0;
          for (let tap = 0; tap < TAPS; tap++) sum += phase[tap] * history[tap];
          if (sum < 0) sum = -sum;
          if (sum > peak) peak = sum;
        }
        const direct = Math.abs(history[0]);
        if (direct > peak) peak = direct;
      }
      const slot = this.position % (lookahead + 1);
      this.targets[slot] = peak > LIMITER_CEILING ? LIMITER_CEILING / peak : 1;
      // The lowest target inside the look-ahead window: the gain the delayed sample must not exceed.
      let lowest = 1;
      for (let at = 0; at <= lookahead; at++) if (this.targets[at] < lowest) lowest = this.targets[at];
      this.envelope = lowest < this.envelope ? lowest : lowest + (this.envelope - lowest) * this.release;
      if (this.envelope > 0.999999) this.envelope = lowest === 1 ? 1 : this.envelope;
      this.smoothed[this.position % lookahead] = this.envelope;
      // The attack: an average over the look-ahead reaches the lowest target exactly when its peak leaves the delay.
      let unity = true, sum = 0;
      for (let at = 0; at < lookahead; at++) { sum += this.smoothed[at]; if (this.smoothed[at] !== 1) unity = false; }
      const gain = unity ? 1 : sum / lookahead;
      const read = this.position % lookahead;
      for (let channel = 0; channel < channels; channel++) {
        const delayed = this.delay[channel][read];
        this.delay[channel][read] = block[channel][index];
        let out = gain === 1 ? delayed : delayed * gain;
        // Safety clamp; conforming input never reaches it.
        if (out > LIMITER_CEILING) out = LIMITER_CEILING; else if (out < -LIMITER_CEILING) out = -LIMITER_CEILING;
        block[channel][index] = out;
      }
      this.position++;
    }
  }
}
