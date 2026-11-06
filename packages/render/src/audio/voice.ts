import { Biquad, highPass } from "./dsp.ts";
import { INTERNAL_SAMPLE_RATE } from "./gain.ts";

/**
 * Stage 5 of the signal chain: the 14 bundled voice effects of `audio-editing.Voice changer`, each the fixed DSP
 * chain of that requirement's table at intensity 100, mixed with the unprocessed sound by `intensity`. The four
 * pitch effects are a pitch shift of stage 4 (`VOICE_PITCH`); Deep and High restore the spectral envelope after it
 * here. Everything is a function of the clip's own samples, its frame index and the element's seed: two renders are
 * sample-identical.
 */

const RATE = INTERNAL_SAMPLE_RATE;
export type VoiceEffect = { type: string; /** Wet share, 0…1. */ intensity: number; /** FNV-1a hash of the element id. */ seed: number };
/** Semitones of the pitch effects; the shift itself is done by the stretch of stage 4, so the duration is kept. */
export const VOICE_PITCH: Readonly<Record<string, number>> = { deep: -4, high: 4, chipmunk: 8, giant: -8 };
export const VOICE_EFFECT_IDS = ["deep", "high", "chipmunk", "giant", "robot", "echo", "hall", "telephone", "megaphone", "vinyl", "synth", "electronic", "tremble", "underwater"] as const;
/** FNV-1a 32-bit hash of an element id: the seed of its Vinyl crackle. */
export function voiceSeed(elementId: string): number { let hash = 0x811c9dc5; for (let index = 0; index < elementId.length; index++) { hash ^= elementId.charCodeAt(index); hash = Math.imul(hash, 0x01000193) >>> 0; } return hash >>> 0; }
/** The voice effect an element asks for; `undefined` for `none` and at intensity 0, where the sound is the unprocessed one. */
export function voiceEffectOf(element: { id: string; voiceEffect?: { type?: string; intensity?: number } }): VoiceEffect | undefined {
  const type = element.voiceEffect?.type, intensity = Math.min(Math.max(element.voiceEffect?.intensity ?? 100, 0), 100) / 100;
  return type && (VOICE_EFFECT_IDS as readonly string[]).includes(type) && intensity > 0 ? { type, intensity, seed: voiceSeed(element.id) } : undefined;
}
const FFT_SIZE = 2048, FFT_HOP = 512, WOW_DELAY = 64;
/** Frames by which an effect's output trails its input; the mix reads the clip that much ahead. */
export const voiceLatency = (type: string): number => (type === "deep" || type === "high" ? FFT_SIZE : type === "vinyl" ? WOW_DELAY : 0);
/** Whether the effect needs the unshifted sound next to the shifted one (the envelope it restores). */
export const restoresFormants = (type: string): boolean => type === "deep" || type === "high";

type Coefficients = ConstructorParameters<typeof Biquad>[0];
const lowPass = (frequency: number, q = Math.SQRT1_2): Coefficients => {
  const w = (2 * Math.PI * frequency) / RATE, alpha = Math.sin(w) / (2 * q), cos = Math.cos(w), a0 = 1 + alpha;
  return { b0: (1 - cos) / 2 / a0, b1: (1 - cos) / a0, b2: (1 - cos) / 2 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
};
const bandPass = (frequency: number, q: number): Coefficients => {
  const w = (2 * Math.PI * frequency) / RATE, alpha = Math.sin(w) / (2 * q), a0 = 1 + alpha;
  return { b0: alpha / a0, b1: 0, b2: -alpha / a0, a1: (-2 * Math.cos(w)) / a0, a2: (1 - alpha) / a0 };
};
/** The two sections of a 4th-order Butterworth filter (24 dB per octave). */
const BUTTERWORTH_4 = [0.5411961, 1.3065630];
export const butterworth4 = (kind: "high" | "low", frequency: number): Biquad[] => BUTTERWORTH_4.map((q) => new Biquad(kind === "high" ? highPass(frequency, q) : lowPass(frequency, q)));
const through = (sections: Biquad[], x: number): number => { let y = x; for (const section of sections) y = section.step(y); return y; };

/** The engine's integer hash to 0…1 (the PCG of the shader library). */
function unit(seed: number, a: number, b = 0): number {
  let x = (seed ^ Math.imul(a + 1, 2654435761) ^ Math.imul(b + 1, 2246822519)) >>> 0;
  x = Math.imul(x, 747796405) + 2891336453 >>> 0;
  x = Math.imul(((x >>> ((x >>> 28) + 4)) ^ x) >>> 0, 277803737) >>> 0;
  return (((x >>> 22) ^ x) >>> 0) / 4294967296;
}

class Delay {
  private readonly data: Float32Array;
  private at = 0;
  constructor(frames: number) { this.data = new Float32Array(Math.max(1, Math.round(frames))); }
  /** The sample written `length` frames ago. */
  get out(): number { return this.data[this.at]; }
  push(x: number): void { this.data[this.at] = x; this.at = (this.at + 1) % this.data.length; }
  /** The sample `frames` (fractional, at most the length) ago, read linearly. */
  tap(frames: number): number {
    const length = this.data.length, position = this.at - 1 - frames, base = Math.floor(position), mix = position - base;
    const a = this.data[((base % length) + length) % length], b = this.data[(((base + 1) % length) + length) % length];
    return a + (b - a) * mix;
  }
}

const COSINES = Float64Array.from({ length: FFT_SIZE / 2 }, (_, k) => Math.cos((2 * Math.PI * k) / FFT_SIZE)), SINES = Float64Array.from({ length: FFT_SIZE / 2 }, (_, k) => Math.sin((2 * Math.PI * k) / FFT_SIZE));
/** In-place radix-2 FFT of `FFT_SIZE` complex values. */
function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const size = re.length;
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let length = 2; length <= size; length <<= 1) {
    // Twiddles from the table of the full size: e^(∓2πi k / length).
    const stride = size / length, half = length / 2;
    for (let start = 0; start < size; start += length) {
      for (let k = 0; k < half; k++) {
        const a = start + k, b = a + half, cr = COSINES[k * stride], ci = inverse ? SINES[k * stride] : -SINES[k * stride];
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
  if (inverse) for (let i = 0; i < size; i++) { re[i] /= size; im[i] /= size; }
}
const WINDOW = Float64Array.from({ length: FFT_SIZE }, (_, index) => Math.sin((Math.PI * (index + 0.5)) / FFT_SIZE));
/** Quefrencies kept by the envelope lifter: periods above 1.25 ms (pitches below 800 Hz) are fine structure, not envelope. */
const LIFTER = 110;

/**
 * The spectral envelope (natural log) of a windowed frame: cepstral liftering iterated on the maximum of the
 * spectrum and the last estimate (the "true envelope"), so that it rides on the harmonic peaks instead of
 * averaging them with the gaps between.
 */
function envelope(re: Float64Array, im: Float64Array): Float64Array {
  const log = ENVELOPE_LOG, cr = new Float64Array(FFT_SIZE), ci = ENVELOPE_IMAGINARY;
  for (let bin = 0; bin < FFT_SIZE; bin++) log[bin] = Math.log(Math.hypot(re[bin], im[bin]) + 1e-9);
  cr.set(log);
  for (let pass = 0; pass < ENVELOPE_PASSES; pass++) {
    if (pass > 0) for (let bin = 0; bin < FFT_SIZE; bin++) cr[bin] = Math.max(log[bin], cr[bin]);
    ci.fill(0);
    fft(cr, ci, true);
    for (let q = LIFTER; q <= FFT_SIZE - LIFTER; q++) { cr[q] = 0; ci[q] = 0; }
    fft(cr, ci);
  }
  return cr;
}
const ENVELOPE_PASSES = 4;
const ENVELOPE_LOG = new Float64Array(FFT_SIZE), ENVELOPE_IMAGINARY = new Float64Array(FFT_SIZE);

/**
 * Restores the spectral envelope of the unshifted sound on the pitch-shifted one (one channel): a short-time
 * Fourier transform of both, the shifted spectrum multiplied by the ratio of the two cepstral envelopes. The
 * output trails the input by `FFT_SIZE` frames.
 */
class FormantRestore {
  private readonly wet = new Float32Array(FFT_SIZE);
  private readonly dry = new Float32Array(FFT_SIZE);
  private filled = FFT_SIZE - FFT_HOP;
  private readonly sum = new Float64Array(FFT_SIZE);
  private readonly ready = new Float32Array(FFT_HOP);
  private readonly wr = new Float64Array(FFT_SIZE); private readonly wi = new Float64Array(FFT_SIZE);
  private readonly dr = new Float64Array(FFT_SIZE); private readonly di = new Float64Array(FFT_SIZE);
  step(wet: number, dry: number): number {
    // The hop made by the last frame is handed out one sample per sample while the next hop of input arrives.
    const out = this.ready[this.filled - (FFT_SIZE - FFT_HOP)];
    this.wet[this.filled] = wet; this.dry[this.filled] = dry;
    if (++this.filled === FFT_SIZE) {
      const { wr, wi, dr, di } = this;
      for (let index = 0; index < FFT_SIZE; index++) { wr[index] = this.wet[index] * WINDOW[index]; dr[index] = this.dry[index] * WINDOW[index]; }
      wi.fill(0); di.fill(0);
      fft(wr, wi); fft(dr, di);
      const shifted = envelope(wr, wi), wanted = envelope(dr, di);
      for (let bin = 0; bin < FFT_SIZE; bin++) { const gain = Math.exp(Math.min(Math.max(wanted[bin] - shifted[bin], -3), 3)); wr[bin] *= gain; wi[bin] *= gain; }
      fft(wr, wi, true);
      // Sine windows at both ends overlap to 2 at a quarter-size hop.
      for (let index = 0; index < FFT_SIZE; index++) this.sum[index] += (wr[index] * WINDOW[index]) / 2;
      for (let index = 0; index < FFT_HOP; index++) this.ready[index] = this.sum[index];
      this.sum.copyWithin(0, FFT_HOP); this.sum.fill(0, FFT_SIZE - FFT_HOP);
      this.wet.copyWithin(0, FFT_HOP); this.dry.copyWithin(0, FFT_HOP);
      this.filled = FFT_SIZE - FFT_HOP;
    }
    return out;
  }
}

/** Fundamental frequency by autocorrelation on the signal at half rate: 60–500 Hz, `null` when unvoiced. */
export class PitchTracker {
  private readonly window = new Float32Array(1024);
  private filled = 0;
  private carry = 0;
  private odd = false;
  private sinceEstimate = 0;
  hertz: number | null = null;
  step(x: number): void {
    // Two frames become one: the average halves the rate.
    if (!this.odd) { this.carry = x; this.odd = true; return; }
    this.odd = false;
    this.window.copyWithin(0, 1); this.window[1023] = (this.carry + x) / 2;
    this.filled = Math.min(this.filled + 1, 1024);
    if (++this.sinceEstimate >= 128 && this.filled === 1024) { this.sinceEstimate = 0; this.hertz = this.estimate(); }
  }
  private estimate(): number | null {
    const data = this.window, half = RATE / 2, span = 600, low = Math.floor(half / 500), high = Math.ceil(half / 60);
    let energy = 0;
    for (let index = 0; index < span; index++) energy += data[index] * data[index];
    if (energy < 1e-7 * span) return null;
    const scores = new Float64Array(high + 2);
    let best = -1, bestScore = 0;
    for (let lag = low - 1; lag <= high + 1; lag++) {
      let cross = 0, other = 0;
      for (let index = 0; index < span; index++) { cross += data[index] * data[index + lag]; other += data[index + lag] * data[index + lag]; }
      scores[lag] = cross / Math.sqrt(energy * other + 1e-20);
    }
    // The first peak that is nearly as good as the best one: the fundamental, not one of its multiples.
    for (let lag = low; lag <= high; lag++) if (scores[lag] > bestScore) bestScore = scores[lag];
    if (bestScore < 0.5) return null;
    for (let lag = low; lag <= high; lag++) if (scores[lag] >= 0.93 * bestScore && scores[lag] >= scores[lag - 1] && scores[lag] >= scores[lag + 1]) { best = lag; break; }
    if (best < 0) return null;
    const a = scores[best - 1], b = scores[best], c = scores[best + 1], denominator = a - 2 * b + c;
    return half / (best + (denominator === 0 ? 0 : (0.5 * (a - c)) / denominator));
  }
}

const VOCODER_BANDS = 16, BAND_RATIO = 80 ** (1 / 15), BAND_Q = 1 / (Math.sqrt(BAND_RATIO) - 1 / Math.sqrt(BAND_RATIO));
const SHIFT_WINDOW = Math.round(0.03 * RATE);

/** One channel of one effect. */
class Channel {
  private readonly type: string;
  private readonly seed: number;
  private readonly filters: Biquad[] = [];
  private readonly more: Biquad[] = [];
  private readonly delays: Delay[] = [];
  private readonly gains: number[] = [];
  private readonly restore: FormantRestore | undefined;
  private readonly bands: { analysis: Biquad; synthesis: Biquad; level: number }[] = [];
  private phase = 0;
  constructor(type: string, seed: number) {
    this.type = type; this.seed = seed;
    if (restoresFormants(type)) this.restore = new FormantRestore();
    if (type === "robot") this.delays.push(new Delay(0.008 * RATE));
    if (type === "echo") this.delays.push(new Delay(0.25 * RATE));
    if (type === "hall") {
      for (const ms of [29.7, 37.1, 41.1, 43.7]) { this.delays.push(new Delay((ms / 1000) * RATE)); this.gains.push(10 ** ((-3 * ms) / 1000 / 2.5)); }
      for (const ms of [5.0, 1.7]) this.delays.push(new Delay((ms / 1000) * RATE));
    }
    if (type === "telephone") { this.filters.push(...butterworth4("high", 300)); this.more.push(...butterworth4("low", 3400)); }
    if (type === "megaphone") { this.filters.push(...butterworth4("high", 500)); this.more.push(...butterworth4("low", 4000)); this.delays.push(new Delay(0.06 * RATE)); }
    if (type === "vinyl") { this.filters.push(new Biquad(highPass(100)), new Biquad(lowPass(7000))); this.delays.push(new Delay(WOW_DELAY * 2 + 4)); }
    if (type === "underwater") { this.filters.push(new Biquad(lowPass(500))); this.delays.push(new Delay(0.02 * RATE)); }
    if (type === "electronic") this.delays.push(new Delay(SHIFT_WINDOW + 4));
    if (type === "synth") for (let band = 0; band < VOCODER_BANDS; band++) { const centre = 100 * BAND_RATIO ** band; this.bands.push({ analysis: new Biquad(bandPass(centre, BAND_Q)), synthesis: new Biquad(bandPass(centre, BAND_Q)), level: 0 }); }
  }

  /** The effect at intensity 100 for one sample. `frame` is the clip frame of the OUTPUT sample; `pitch` the tracked fundamental. */
  step(x: number, dry: number, frame: number, pitch: number | null): number {
    const t = frame / RATE;
    switch (this.type) {
      case "deep": case "high": return this.restore!.step(x, dry);
      case "robot": {
        // Ring modulation with a 50 Hz sine, then a feed-forward comb of 8 ms and gain 0.7.
        const ring = x * Math.sin(2 * Math.PI * 50 * t), delay = this.delays[0], out = ring + 0.7 * delay.out;
        delay.push(ring);
        return out;
      }
      case "echo": {
        // A feedback delay of 250 ms with feedback 0.4; the echoes are added at 0.5.
        const delay = this.delays[0], echoed = delay.out;
        delay.push(x + 0.4 * echoed);
        return x + 0.5 * echoed;
      }
      case "hall": {
        // Schroeder: four parallel feedback combs into two series all-pass filters; the reverberation is added at 0.35.
        let sum = 0;
        for (let comb = 0; comb < 4; comb++) { const delay = this.delays[comb], out = delay.out; delay.push(x + this.gains[comb] * out); sum += out; }
        let y = sum / 4;
        for (let pass = 4; pass < 6; pass++) { const delay = this.delays[pass], held = delay.out, input = y + 0.7 * held; delay.push(input); y = held - 0.7 * input; }
        return x + 0.35 * y;
      }
      case "telephone": return Math.tanh(2 * through(this.more, through(this.filters, x)));
      case "megaphone": {
        const clipped = Math.min(Math.max(through(this.more, through(this.filters, x)), -0.5011872), 0.5011872), delay = this.delays[0], out = clipped + 0.3548134 * delay.out;
        delay.push(clipped);
        return out;
      }
      case "vinyl": {
        // Wow: the speed deviates ±0.3 % at 0.5 Hz, which is a read position swinging about a fixed delay.
        const delay = this.delays[0];
        delay.push(through(this.filters, x));
        const swing = ((0.003 * RATE) / (2 * Math.PI * 0.5)) * Math.cos(2 * Math.PI * 0.5 * t);
        // Crackle at −30 dBFS: seeded noise in 1 ms bursts a tenth of the time, far quieter between them.
        const burst = unit(this.seed, Math.floor(frame / 48), 7) < 0.1 ? 1 : 0.05;
        return delay.tap(WOW_DELAY - 1 + Math.max(Math.min(swing, WOW_DELAY - 2), -(WOW_DELAY - 2))) + 0.1712 * burst * (2 * unit(this.seed, frame, 11) - 1);
      }
      case "tremble": return x * (1 - 0.6 * (0.5 - 0.5 * Math.sin(2 * Math.PI * 6 * t)));
      case "underwater": {
        // A second-order low-pass at 500 Hz, and a chorus voice whose delay swings 4 ms at 0.8 Hz, added at 0.5.
        const low = through(this.filters, x), delay = this.delays[0];
        delay.push(low);
        return low + 0.5 * delay.tap(0.006 * RATE + 0.004 * RATE * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.8 * t)));
      }
      case "electronic": {
        // The pitch snaps to the nearest equal-tempered semitone at once: two read taps cross-fade through a 30 ms window.
        const delay = this.delays[0];
        delay.push(x);
        const ratio = pitch ? (440 * 2 ** (Math.round(12 * Math.log2(pitch / 440)) / 12)) / pitch : 1;
        this.phase = (((this.phase + (1 - ratio) / SHIFT_WINDOW) % 1) + 1) % 1;
        const other = (this.phase + 0.5) % 1, weight = Math.sin(Math.PI * this.phase) ** 2;
        return ratio === 1 && this.phase === 0 ? x : weight * delay.tap(this.phase * SHIFT_WINDOW) + (1 - weight) * delay.tap(other * SHIFT_WINDOW);
      }
      case "synth": {
        // A sawtooth at the tracked pitch (110 Hz when unvoiced), shaped by the 16 band envelopes of the voice.
        this.phase = (this.phase + (pitch ?? 110) / RATE) % 1;
        const carrier = 2 * this.phase - 1;
        let out = 0;
        for (const band of this.bands) {
          const level = Math.abs(band.analysis.step(x));
          // The envelope follows in 5 ms and lets go in 20 ms.
          band.level += (level - band.level) * (level > band.level ? 0.0042 : 0.00104);
          out += band.synthesis.step(carrier) * band.level;
        }
        return out * 6;
      }
      default: return x;
    }
  }
}

/** A voice effect on a stereo clip, with its state from sample to sample. */
export class VoiceChain {
  readonly effect: VoiceEffect;
  private readonly channels: [Channel, Channel];
  private readonly tracker: PitchTracker | undefined;
  constructor(effect: VoiceEffect) {
    this.effect = effect;
    this.channels = [new Channel(effect.type, effect.seed), new Channel(effect.type, effect.seed ^ 0x9e3779b9)];
    if (effect.type === "synth" || effect.type === "electronic") this.tracker = new PitchTracker();
  }
  /**
   * Processes `count` frames in place from `offset`. `clipFrame` is the clip frame of the first OUTPUT sample; with
   * a latency the input is the clip's sound that many frames ahead. `dry` is the sound without the effect's pitch
   * shift, as far ahead as the input (the envelope Deep and High restore); `mix` is the same sound on time (what
   * an intensity below 100 mixes in), the input itself when the effect has neither a pitch shift nor a latency.
   */
  process(left: Float32Array, right: Float32Array, offset: number, count: number, clipFrame: number, dry?: [Float32Array, Float32Array], mix?: [Float32Array, Float32Array]): void {
    const { intensity } = this.effect;
    for (let index = 0; index < count; index++) {
      const at = offset + index, l = left[at], r = right[at];
      this.tracker?.step((l + r) / 2);
      const pitch = this.tracker?.hertz ?? null;
      const wetLeft = this.channels[0].step(l, dry ? dry[0][at] : l, clipFrame + index, pitch), wetRight = this.channels[1].step(r, dry ? dry[1][at] : r, clipFrame + index, pitch);
      const plainLeft = mix ? mix[0][at] : l, plainRight = mix ? mix[1][at] : r;
      left[at] = plainLeft + (wetLeft - plainLeft) * intensity;
      right[at] = plainRight + (wetRight - plainRight) * intensity;
    }
  }
}
