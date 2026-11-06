/** The rate the whole audio chain runs at. */
const INTERNAL_SAMPLE_RATE = 48_000;

/**
 * Stages 6–8 and 13 of `audio-editing.Audio signal chain` as sample processors with explicit state: the five-band
 * equaliser, the compressor, the normalisation gain and track ducking, plus the loudness measurement the
 * normalisation gain is derived from. Everything runs at the 48 000 Hz internal rate and is deterministic.
 */

type Coefficients = { b0: number; b1: number; b2: number; a1: number; a2: number };
/** One second-order section, transposed direct form II. */
export class Biquad {
  private z1 = 0;
  private z2 = 0;
  private readonly c: Coefficients;
  constructor(coefficients: Coefficients) { this.c = coefficients; }
  step(x: number): number {
    const y = this.c.b0 * x + this.z1;
    this.z1 = this.c.b1 * x - this.c.a1 * y + this.z2;
    this.z2 = this.c.b2 * x - this.c.a2 * y;
    return y;
  }
  reset(): void { this.z1 = 0; this.z2 = 0; }
}

const normalised = (b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): Coefficients => ({ b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 });
/** Audio EQ Cookbook: peaking filter of `gainDb` at `frequency` with quality `q`. */
export function peaking(frequency: number, gainDb: number, q = 1, rate = INTERNAL_SAMPLE_RATE): Coefficients {
  const a = Math.pow(10, gainDb / 40), w = (2 * Math.PI * frequency) / rate, alpha = Math.sin(w) / (2 * q), cos = Math.cos(w);
  return normalised(1 + alpha * a, -2 * cos, 1 - alpha * a, 1 + alpha / a, -2 * cos, 1 - alpha / a);
}
/** Audio EQ Cookbook: low or high shelf of `gainDb` at `frequency` with shelf slope `slope`. */
export function shelf(kind: "low" | "high", frequency: number, gainDb: number, slope = 1, rate = INTERNAL_SAMPLE_RATE): Coefficients {
  const a = Math.pow(10, gainDb / 40), w = (2 * Math.PI * frequency) / rate, cos = Math.cos(w), sin = Math.sin(w);
  const alpha = (sin / 2) * Math.sqrt((a + 1 / a) * (1 / slope - 1) + 2), root = 2 * Math.sqrt(a) * alpha;
  if (kind === "low") return normalised(a * (a + 1 - (a - 1) * cos + root), 2 * a * (a - 1 - (a + 1) * cos), a * (a + 1 - (a - 1) * cos - root), a + 1 + (a - 1) * cos + root, -2 * (a - 1 + (a + 1) * cos), a + 1 + (a - 1) * cos - root);
  return normalised(a * (a + 1 + (a - 1) * cos + root), -2 * a * (a - 1 + (a + 1) * cos), a * (a + 1 + (a - 1) * cos - root), a + 1 - (a - 1) * cos + root, 2 * (a - 1 - (a + 1) * cos), a + 1 - (a - 1) * cos - root);
}
/** Audio EQ Cookbook: second-order high-pass and low-pass (Butterworth at `q` = 1/√2). */
export function highPass(frequency: number, q = Math.SQRT1_2, rate = INTERNAL_SAMPLE_RATE): Coefficients {
  const w = (2 * Math.PI * frequency) / rate, alpha = Math.sin(w) / (2 * q), cos = Math.cos(w);
  return normalised((1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha);
}

export type EqBands = { low?: number; lowMid?: number; mid?: number; highMid?: number; high?: number };
const clampDb = (value: unknown, limit: number): number => (typeof value === "number" && Number.isFinite(value) ? Math.min(Math.max(value, -limit), limit) : 0);

/** The five-band equaliser: shelves at 100 Hz and 10 kHz (slope 1), peaking bands at 300 Hz, 1 kHz and 3 kHz (Q 1). A band at 0 dB is not run. */
export function eqSections(bands: EqBands): Coefficients[] {
  const sections: Coefficients[] = [];
  const low = clampDb(bands.low, 12), lowMid = clampDb(bands.lowMid, 12), mid = clampDb(bands.mid, 12), highMid = clampDb(bands.highMid, 12), high = clampDb(bands.high, 12);
  if (low !== 0) sections.push(shelf("low", 100, low));
  if (lowMid !== 0) sections.push(peaking(300, lowMid));
  if (mid !== 0) sections.push(peaking(1000, mid));
  if (highMid !== 0) sections.push(peaking(3000, highMid));
  if (high !== 0) sections.push(shelf("high", 10_000, high));
  return sections;
}

export type CompressorSettings = { threshold: number; ratio: number; attack: number; release: number; makeup: number };
/**
 * A feed-forward compressor: a peak detector on the linked channels, a hard knee, the gain computed in dB as
 * `(threshold − level) × (1 − 1 / ratio)` above the threshold and smoothed with the attack and release time
 * constants, then the make-up gain.
 */
export class Compressor {
  private reduction = 0;   // dB, ≤ 0
  private readonly threshold: number;
  private readonly slope: number;
  private readonly attack: number;
  private readonly release: number;
  private readonly makeup: number;
  constructor(settings: Partial<CompressorSettings>, rate = INTERNAL_SAMPLE_RATE) {
    this.threshold = Math.min(Math.max(settings.threshold ?? -18, -60), 0);
    this.slope = 1 - 1 / Math.min(Math.max(settings.ratio ?? 3, 1), 20);
    this.attack = Math.exp(-1 / ((Math.min(Math.max(settings.attack ?? 10, 1), 200) / 1000) * rate));
    this.release = Math.exp(-1 / ((Math.min(Math.max(settings.release ?? 120, 10), 1000) / 1000) * rate));
    this.makeup = Math.pow(10, Math.min(Math.max(settings.makeup ?? 0, 0), 24) / 20);
  }
  /** The gain for one stereo sample. */
  gain(left: number, right: number): number {
    const peak = Math.max(Math.abs(left), Math.abs(right));
    const level = peak > 1e-9 ? 20 * Math.log10(peak) : -180;
    const wanted = level > this.threshold ? (this.threshold - level) * this.slope : 0;
    // More reduction is approached with the attack constant, less with the release constant.
    const k = wanted < this.reduction ? this.attack : this.release;
    this.reduction = wanted + (this.reduction - wanted) * k;
    return Math.pow(10, this.reduction / 20) * this.makeup;
  }
  reset(): void { this.reduction = 0; }
}

/** What stages 6–8 of one element need from the document. */
export type ClipProcessing = { eq?: EqBands; compressor?: Partial<CompressorSettings>; /** Normalisation gain in dB. */ normalizeDb?: number };

/** Stages 6–8 for one element, with the filter and envelope state that carries from block to block. */
export class ClipChain {
  private readonly left: Biquad[];
  private readonly right: Biquad[];
  private readonly compressor: Compressor | undefined;
  private readonly normalize: number;
  constructor(processing: ClipProcessing) {
    const sections = processing.eq ? eqSections(processing.eq) : [];
    this.left = sections.map((section) => new Biquad(section));
    this.right = sections.map((section) => new Biquad(section));
    this.compressor = processing.compressor ? new Compressor(processing.compressor) : undefined;
    this.normalize = Math.pow(10, Math.min(Math.max(processing.normalizeDb ?? 0, -60), 24) / 20);
  }
  /** Processes `count` frames in place, from `offset`. */
  process(left: Float32Array, right: Float32Array, offset: number, count: number): void {
    for (let index = offset; index < offset + count; index++) {
      let l = left[index], r = right[index];
      for (let section = 0; section < this.left.length; section++) { l = this.left[section].step(l); r = this.right[section].step(r); }
      const gain = (this.compressor ? this.compressor.gain(l, r) : 1) * this.normalize;
      left[index] = l * gain;
      right[index] = r * gain;
    }
  }
}

export type DuckingSettings = { amount: number; attack: number; release: number; mode?: "full" | "voice-band" };
const VOICE_WINDOW = Math.round(0.05 * INTERNAL_SAMPLE_RATE);
/** −40 dBFS as a mean square. */
const VOICE_GATE = Math.pow(10, -40 / 10);

/** Whether voice is present: the RMS of the voice elements over the last 50 ms is above −40 dBFS. */
export class VoiceDetector {
  private readonly window = new Float32Array(VOICE_WINDOW);
  private at = 0;
  private sum = 0;
  step(left: number, right: number): boolean {
    const square = (left * left + right * right) / 2;
    this.sum += square - this.window[this.at];
    this.window[this.at] = square;
    this.at = (this.at + 1) % VOICE_WINDOW;
    return this.sum / VOICE_WINDOW > VOICE_GATE;
  }
}

/** The gain of a ducked track: down by `amount` dB over `attack` ms while voice is present, back over `release` ms. */
export class Ducker {
  private reduction = 0;   // dB, 0 … amount
  private readonly amount: number;
  private readonly down: number;
  private readonly up: number;
  private readonly mode: "full" | "voice-band";
  private readonly bandL: Biquad[];
  private readonly bandR: Biquad[];
  constructor(settings: Partial<DuckingSettings>, rate = INTERNAL_SAMPLE_RATE) {
    this.amount = Math.min(Math.max(settings.amount ?? 12, 0), 30);
    this.down = this.amount / ((Math.min(Math.max(settings.attack ?? 200, 10), 1000) / 1000) * rate);
    this.up = this.amount / ((Math.min(Math.max(settings.release ?? 500, 50), 3000) / 1000) * rate);
    this.mode = settings.mode === "voice-band" ? "voice-band" : "full";
    const band = this.mode === "voice-band" ? [highPass(300, Math.SQRT1_2, rate), lowPass(4000, Math.SQRT1_2, rate)] : [];
    this.bandL = band.map((coefficients) => new Biquad(coefficients));
    this.bandR = band.map((coefficients) => new Biquad(coefficients));
  }
  step(voice: boolean): number {
    this.reduction = voice ? Math.min(this.amount, this.reduction + this.down) : Math.max(0, this.reduction - this.up);
    return this.reduction === 0 ? 1 : Math.pow(10, -this.reduction / 20);
  }
  /** Applies the envelope to the full signal or to its 300 Hz–4 kHz voice band. */
  apply(left: number, right: number, gain: number): [number, number] {
    if (this.mode === "full") return [left * gain, right * gain];
    let bandL = left, bandR = right;
    for (let index = 0; index < this.bandL.length; index++) { bandL = this.bandL[index].step(bandL); bandR = this.bandR[index].step(bandR); }
    return [left + (gain - 1) * bandL, right + (gain - 1) * bandR];
  }
  /** The reduction in dB after the last step, for the shaded envelope on the clips. */
  get reductionDb(): number { return this.reduction; }
}

/** Audio EQ Cookbook low-pass section (Butterworth at q = 1/√2). */
function lowPass(frequency: number, q: number, rate: number): Coefficients {
  const w = (2 * Math.PI * frequency) / rate, alpha = Math.sin(w) / (2 * q), cos = Math.cos(w);
  return normalised((1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alpha, -2 * cos, 1 - alpha);
}

// ---- loudness (ITU-R BS.1770-4) --------------------------------------------------------------------------------------

/** The K-weighting pre-filter and RLB high-pass at 48 000 Hz, as the recommendation tabulates them. */
const K_SHELF: Coefficients = { b0: 1.53512485958697, b1: -2.69169618940638, b2: 1.19839281085285, a1: -1.69065929318241, a2: 0.73248077421585 };
const K_HIGH_PASS: Coefficients = { b0: 1, b1: -2, b2: 1, a1: -1.99004745483398, a2: 0.99007225036621 };

export type Loudness = { /** Integrated loudness in LUFS; `-Infinity` for silence. */ lufs: number; /** True peak in dBTP. */ truePeakDb: number };

/**
 * Integrated loudness with the two gates of BS.1770-4 (400 ms blocks overlapping by 75 %, absolute gate −70 LUFS,
 * relative gate −10 LU) and the true peak from 4× oversampling, of a stereo signal at 48 000 Hz.
 */
export function measureLoudness(left: Float32Array, right: Float32Array, rate = INTERNAL_SAMPLE_RATE): Loudness {
  const filters = [[new Biquad(K_SHELF), new Biquad(K_HIGH_PASS)], [new Biquad(K_SHELF), new Biquad(K_HIGH_PASS)]];
  const block = Math.round(0.4 * rate), hop = Math.round(0.1 * rate), length = Math.min(left.length, right.length);
  // Mean squares per 100 ms hop, summed over the two channels (both weigh 1).
  const hops: number[] = [];
  let sum = 0;
  for (let index = 0; index < length; index++) {
    const l = filters[0][1].step(filters[0][0].step(left[index])), r = filters[1][1].step(filters[1][0].step(right[index]));
    sum += l * l + r * r;
    if ((index + 1) % hop === 0) { hops.push(sum / hop); sum = 0; }
  }
  const powers: number[] = [];
  const per = block / hop;
  for (let index = 0; index + per <= hops.length; index++) { let total = 0; for (let part = 0; part < per; part++) total += hops[index + part]; powers.push(total / per); }
  // A signal shorter than one block is measured as one block of its whole length.
  if (powers.length === 0 && length > 0) { let total = sum; for (const value of hops) total += value * hop; powers.push(total / length); }
  const loudness = (power: number) => -0.691 + 10 * Math.log10(power);
  const mean = (values: number[]) => values.reduce((total, value) => total + value, 0) / values.length;
  const above = powers.filter((power) => power > 0 && loudness(power) > -70);
  let lufs = -Infinity;
  if (above.length > 0) {
    const relative = loudness(mean(above)) - 10;
    const gated = above.filter((power) => loudness(power) > relative);
    if (gated.length > 0) lufs = loudness(mean(gated));
  }
  return { lufs, truePeakDb: truePeakDb(left, right) };
}

/** Taps of the 4× oversampling interpolator: a 48-tap windowed sinc, 12 taps per phase. */
const PHASES = (() => {
  const taps = 12, phases: Float64Array[] = [];
  for (let phase = 0; phase < 4; phase++) {
    const row = new Float64Array(taps);
    for (let tap = 0; tap < taps; tap++) {
      const x = tap - taps / 2 + 1 - phase / 4;
      const window = 0.5 + 0.5 * Math.cos((Math.PI * x) / (taps / 2));
      row[tap] = (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)) * (Math.abs(x) < taps / 2 ? window : 0);
    }
    phases.push(row);
  }
  return phases;
})();

/** The largest inter-sample peak of a stereo signal, in dBTP (4× oversampling). */
export function truePeakDb(left: Float32Array, right: Float32Array): number {
  let peak = 0;
  for (const channel of [left, right]) {
    for (let index = 0; index < channel.length; index++) {
      for (const taps of PHASES) {
        let value = 0;
        for (let tap = 0; tap < taps.length; tap++) { const at = index + tap - taps.length / 2 + 1; if (at >= 0 && at < channel.length) value += channel[at] * taps[tap]; }
        if (Math.abs(value) > peak) peak = Math.abs(value);
      }
    }
  }
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}

/**
 * The static gain of loudness normalisation: `target − measured`, at most +24 dB, and limited so that the true
 * peak after the gain does not pass −1 dBTP. A silent range gets 0 dB.
 */
export function normalizeGainDb(target: number, measured: Loudness): { gainDb: number; silent: boolean } {
  if (!Number.isFinite(measured.lufs)) return { gainDb: 0, silent: true };
  const headroom = Number.isFinite(measured.truePeakDb) ? -1 - measured.truePeakDb : 24;
  return { gainDb: Math.round(Math.min(target - measured.lufs, 24, headroom) * 100) / 100, silent: false };
}

/** The processing fields of an element, as `setEq`, `setCompressor` and `setNormalize` store them. */
export type ProcessedElement = { eq?: { enabled?: boolean; bands?: EqBands }; compressor?: { enabled?: boolean } & Partial<CompressorSettings>; normalize?: { enabled?: boolean; gainDb?: number } };

/** Stages 6–8 of an element as stored by `setEq`, `setCompressor` and `setNormalize`; `undefined` when all are off or neutral. */
export function clipProcessing(element: ProcessedElement): ClipProcessing | undefined {
  const out: ClipProcessing = {};
  if (element.eq?.enabled && element.eq.bands && Object.values(element.eq.bands).some((gain) => typeof gain === "number" && gain !== 0)) out.eq = element.eq.bands;
  if (element.compressor?.enabled) { const { enabled: _enabled, ...settings } = element.compressor; out.compressor = settings; }
  if (element.normalize?.enabled && typeof element.normalize.gainDb === "number" && element.normalize.gainDb !== 0) out.normalizeDb = element.normalize.gainDb;
  return out.eq || out.compressor || out.normalizeDb !== undefined ? out : undefined;
}

// ---- fades (`audio-editing.Fades`): the gain curve of each shape, shared by the mix and by the fade drawn on a clip ----

export const FADE_GAINS: Record<string, (p: number) => number> = {
  linear: (p) => p,
  "equal-power": (p) => Math.sin((p * Math.PI) / 2),
  "s-curve": (p) => p * p * (3 - 2 * p),
  logarithmic: (p) => Math.log10(1 + 9 * p),
  exponential: (p) => p * p,
};

export type Fade = { duration: number; shape: string };
/**
 * Fade gain at an element-local time in ticks. A fade out uses the fade-in gain for `1 − p`; the two durations are
 * clamped so that together they do not exceed the element.
 */
export function fadeGain(clipTime: number, duration: number, fadeIn?: Fade, fadeOut?: Fade): number {
  let inTicks = Math.min(Math.max(fadeIn?.duration ?? 0, 0), duration);
  let outTicks = Math.min(Math.max(fadeOut?.duration ?? 0, 0), duration);
  if (inTicks + outTicks > duration) outTicks = duration - inTicks;
  let gain = 1;
  if (inTicks > 0 && clipTime < inTicks) gain *= (FADE_GAINS[fadeIn!.shape] ?? FADE_GAINS["equal-power"])(Math.max(clipTime, 0) / inTicks);
  if (outTicks > 0 && clipTime > duration - outTicks) gain *= (FADE_GAINS[fadeOut!.shape] ?? FADE_GAINS["equal-power"])(Math.max(duration - clipTime, 0) / outTicks);
  return gain;
}
