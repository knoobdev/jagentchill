import type { Rational } from "@jagentchill/protocol";
import { mediaTimeFromFrame, roundHalfAwayFromZero as round, roundToFrame, type MediaTime } from "./media-time.ts";

/**
 * Retime maths: the map between element-local time and source time for constant rates, speed curves, reverse and
 * freeze. `packages/render-wasm/crates/time/src/retime.rs` is the same code in Rust; every floating-point
 * expression here keeps the operand order of its twin so that the two agree to the tick.
 */

export type CurvePoint = { u: number; rate: number };
export type RetimeSpec = { rate?: number; reverse?: boolean; curve?: CurvePoint[] };
/** What the time map needs to know about an element: `S0`, the visible source span and the element duration. */
export type RetimeClip = { sourceStart: number; sourceSpan: number; duration: number; retime?: RetimeSpec; freezeSourceTime?: number };

const TABLE_INTERVALS = 1024;
const MIN_CURVE_RATE = 0.1, MAX_CURVE_RATE = 10;

const constantRate = (retime?: RetimeSpec): number => {
  const rate = retime?.rate;
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0 ? rate : 1;
};

/** The points when they form a curve (2–32 points, `u` from 0 to 1 strictly increasing); otherwise the curve is ignored. */
export function validCurve(retime?: RetimeSpec): CurvePoint[] | null {
  const points = retime?.curve;
  if (!Array.isArray(points) || points.length < 2 || points.length > 32) return null;
  if (points[0].u !== 0 || points[points.length - 1].u !== 1) return null;
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    if (!Number.isFinite(point.u) || !Number.isFinite(point.rate) || point.rate <= 0) return null;
    if (index > 0 && point.u <= points[index - 1].u) return null;
  }
  return points;
}

/** Fritsch–Carlson tangents of the monotone cubic through the points. */
function tangents(points: CurvePoint[]): number[] {
  const count = points.length;
  const secants: number[] = [];
  for (let index = 0; index < count - 1; index++) secants.push((points[index + 1].rate - points[index].rate) / (points[index + 1].u - points[index].u));
  const slopes = new Array<number>(count).fill(0);
  slopes[0] = secants[0];
  slopes[count - 1] = secants[count - 2];
  for (let index = 1; index < count - 1; index++) {
    const before = secants[index - 1], after = secants[index];
    slopes[index] = before === 0 || after === 0 || (before < 0) !== (after < 0) ? 0 : (before + after) / 2;
  }
  for (let index = 0; index < count - 1; index++) {
    const secant = secants[index];
    if (secant === 0) { slopes[index] = 0; slopes[index + 1] = 0; continue; }
    const alpha = slopes[index] / secant, beta = slopes[index + 1] / secant;
    const length = alpha * alpha + beta * beta;
    if (length > 9) {
      const scale = 3 / Math.sqrt(length);
      slopes[index] = scale * alpha * secant;
      slopes[index + 1] = scale * beta * secant;
    }
  }
  return slopes;
}

function rateAt(points: CurvePoint[], slopes: number[], u: number): number {
  let index = 0;
  while (index < points.length - 2 && u > points[index + 1].u) index++;
  const from = points[index], to = points[index + 1];
  const width = to.u - from.u;
  const t = (u - from.u) / width;
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = 3 * t2 - 2 * t3;
  const h11 = t3 - t2;
  const rate = h00 * from.rate + h10 * width * slopes[index] + h01 * to.rate + h11 * width * slopes[index + 1];
  return Math.min(Math.max(rate, MIN_CURVE_RATE), MAX_CURVE_RATE);
}

/** The speed `r(u)` of a curve at a position of the source span. */
export function curveRateAt(points: CurvePoint[], u: number): number {
  return rateAt(points, tangents(points), Math.min(Math.max(u, 0), 1));
}

// One table per curve and span: a render asks for the same clip on every frame.
const TABLES = new WeakMap<CurvePoint[], Map<number, number[]>>();
/** `T[k]`: the element-local tick at which the source position `k / 1024` of the span is reached. */
function timeTable(points: CurvePoint[], sourceSpan: number): number[] {
  let bySpan = TABLES.get(points);
  if (!bySpan) TABLES.set(points, bySpan = new Map());
  let table = bySpan.get(sourceSpan);
  if (table) return table;
  const slopes = tangents(points);
  table = [0];
  let sum = 0;
  let previous = 1 / rateAt(points, slopes, 0);
  for (let node = 1; node <= TABLE_INTERVALS; node++) {
    const next = 1 / rateAt(points, slopes, node / TABLE_INTERVALS);
    sum += (previous + next) / 2048;
    previous = next;
    table.push(round(sourceSpan * sum));
  }
  bySpan.set(sourceSpan, table);
  return table;
}

/** `U(τ)`: the fraction of the source span reached at element-local tick `tau`. */
function spanFraction(table: number[], tau: number): number {
  if (tau <= 0) return 0;
  if (tau >= table[TABLE_INTERVALS]) return 1;
  let low = 0, high = TABLE_INTERVALS - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (table[middle] <= tau) low = middle; else high = middle - 1;
  }
  const width = table[low + 1] - table[low];
  if (width === 0) return low / TABLE_INTERVALS;
  return (low + (tau - table[low]) / width) / TABLE_INTERVALS;
}

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

/** Element duration for a visible source span, snapped to the nearest project frame with a minimum of one frame. */
export function retimedDuration(sourceSpan: number, retime: RetimeSpec | undefined, frameRate: Rational): MediaTime {
  const span = Math.max(sourceSpan, 0);
  const curve = validCurve(retime);
  const raw = curve ? timeTable(curve, span)[TABLE_INTERVALS] : round(span / constantRate(retime));
  const oneFrame = mediaTimeFromFrame(1, frameRate);
  const snapped = roundToFrame(raw, frameRate);
  return snapped > oneFrame ? snapped : oneFrame;
}

/** Source tick shown at an element-local time. */
export function sourceTimeAt(clip: RetimeClip, clipTime: number): MediaTime {
  if (clip.freezeSourceTime !== undefined) return clip.freezeSourceTime as MediaTime;
  const span = Math.max(clip.sourceSpan, 0);
  const local = clamp(clipTime, 0, clip.duration);
  const tau = clip.retime?.reverse ? clip.duration - local : local;
  const curve = validCurve(clip.retime);
  const offset = curve ? round(span * spanFraction(timeTable(curve, span), tau)) : round(tau * constantRate(clip.retime));
  return (clip.sourceStart + clamp(offset, 0, span)) as MediaTime;
}

/** The inverse of `sourceTimeAt`, clamped to the element. */
export function clipTimeAt(clip: RetimeClip, sourceTime: number): MediaTime {
  if (clip.freezeSourceTime !== undefined) return 0 as MediaTime;
  const span = Math.max(clip.sourceSpan, 0);
  const offset = clamp(sourceTime - clip.sourceStart, 0, span);
  const curve = validCurve(clip.retime);
  let tau: number;
  if (curve && span > 0) {
    const table = timeTable(curve, span);
    const position = offset / span * TABLE_INTERVALS;
    const node = Math.min(Math.floor(position), TABLE_INTERVALS - 1);
    const within = position - node;
    tau = round(table[node] + (table[node + 1] - table[node]) * within);
  } else if (curve) tau = 0;
  else tau = round(offset / constantRate(clip.retime));
  tau = clamp(tau, 0, clip.duration);
  return (clip.retime?.reverse ? clip.duration - tau : tau) as MediaTime;
}

type Retimable = {
  duration: number; trimStart?: number; trimEnd?: number; sourceDuration?: number;
  retime?: { rate?: number; reverse?: boolean; curve?: { points: CurvePoint[] } };
  freeze?: { sourceTime: number };
};
/** The time-map view of a stored element: `S0` is its `trimStart`, the span is what the trims leave of the source. */
export function retimeClipOf(element: Retimable): RetimeClip {
  const sourceStart = element.trimStart ?? 0;
  const retime = element.retime ? { rate: element.retime.rate, reverse: element.retime.reverse, curve: element.retime.curve?.points } : undefined;
  const sourceSpan = element.sourceDuration !== undefined
    ? Math.max(0, element.sourceDuration - sourceStart - (element.trimEnd ?? 0))
    : round(element.duration * constantRate(retime));
  return { sourceStart, sourceSpan, duration: element.duration, retime, freezeSourceTime: element.freeze?.sourceTime };
}

// ---- pitch preservation (`speed-retime.Pitch preservation`, `audio-editing.Audio pitch shift`) -----------------------
// The decision is the editor's as much as the engine's: the Speed panel shows its note from it, the mix renders by it.

/** The stretch engine's factor (retime rate × pitch factor) stays inside this range. */
export const STRETCH_RANGE = { min: 0.25, max: 4 } as const;

export type ClipStretch = {
  /** The retime is stretched (pitch kept); otherwise it is resampled and pitch follows speed. */
  keepPitch: boolean;
  /** `2^(n / 12)` of the pitch shift, 1 when there is none. */
  pitchFactor: number;
};

/** The lowest and highest playback rate of a clip over its length. */
export function rateRange(retime: RetimeClip): { min: number; max: number } {
  if (retime.freezeSourceTime !== undefined || !(retime.duration > 0)) return { min: 0, max: 0 };
  if (!retime.retime?.curve) { const rate = typeof retime.retime?.rate === "number" && retime.retime.rate > 0 ? retime.retime.rate : 1; return { min: rate, max: rate }; }
  let min = Infinity, max = 0;
  const steps = 256;
  for (let step = 0; step < steps; step++) {
    const a = (retime.duration * step) / steps, b = (retime.duration * (step + 1)) / steps;
    const rate = Math.abs(sourceTimeAt(retime, b) - sourceTimeAt(retime, a)) / (b - a);
    min = Math.min(min, rate); max = Math.max(max, rate);
  }
  return { min, max };
}

// Keep pitch is stored with the retime (`retime.maintainPitch`); a caller that has resolved it passes it at the top.
type Pitched = { maintainPitch?: boolean; retime?: { maintainPitch?: boolean }; pitch?: { semitones?: number; cents?: number } };

/**
 * How an element's speed and pitch are rendered, decided once for the whole element. `dropped` says Keep pitch is
 * on but cannot be honoured (the rate, or the rate combined with the pitch shift, leaves 0.25–4): the Speed panel
 * shows its note then. `stretch` is absent when plain resampling is the whole of stage 4.
 */
export function pitchPreservation(element: Pitched, retime: RetimeClip, extraSemitones = 0): { stretch?: ClipStretch; kept: boolean; dropped: boolean } {
  // `extraSemitones`: the shift of a pitch-based voice effect, on top of the element's own.
  const semitones = (element.pitch?.semitones ?? 0) + (element.pitch?.cents ?? 0) / 100 + extraSemitones;
  const pitchFactor = semitones === 0 ? 1 : 2 ** (semitones / 12);
  const { min, max } = rateRange(retime);
  if (max === 0) return { kept: false, dropped: false };
  const retimed = min !== 1 || max !== 1, slack = 1e-6;
  const inRange = min >= STRETCH_RANGE.min - slack && max <= STRETCH_RANGE.max + slack;
  // The engine's own factor is the product of the retime factor and the pitch factor (4× with +12 semitones is 8).
  const combined = pitchFactor * min >= STRETCH_RANGE.min - slack && pitchFactor * max <= STRETCH_RANGE.max + slack;
  const wanted = (element.maintainPitch === true || element.retime?.maintainPitch === true) && retimed;
  const kept = wanted && inRange && combined;
  if (!kept && pitchFactor === 1) return { kept: false, dropped: wanted };
  return { stretch: { keepPitch: kept, pitchFactor }, kept, dropped: wanted && !kept };
}
