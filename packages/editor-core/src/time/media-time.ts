import { TICKS_PER_SECOND, type Rational } from "@jagentchill/protocol";

/**
 * The time API of the engine in exact integer arithmetic. The Rust `time` crate of `packages/render-wasm` is the
 * same code compiled into wasm; `fixtures/time-vectors.json` holds the two together. This directory is the one place
 * where a tick value may be divided.
 */

/** A media time in ticks (120 000 per second). Always an integer. */
export type MediaTime = number & { readonly __mediaTime: true };

export const TIME_ERROR_CODES = ["time/non-integer-ticks", "time/invalid-frame-rate", "time/out-of-range"] as const;
export type TimeErrorCode = (typeof TIME_ERROR_CODES)[number];
export class TimeError extends Error {
  readonly code: TimeErrorCode;
  constructor(code: TimeErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "TimeError";
    this.code = code;
  }
}

const MAX = BigInt(Number.MAX_SAFE_INTEGER);
const TICKS = BigInt(TICKS_PER_SECOND);
const MAX_RATE_PART = 1_000_000;

/** Rounds half away from zero. */
export const roundHalfAwayFromZero = (value: number): number => (value < 0 ? -Math.round(-value) : Math.round(value));

/** Builds a media time from a number; a fractional value is not a tick. */
export function mediaTime(value: number): MediaTime {
  if (!Number.isInteger(value)) throw new TimeError("time/non-integer-ticks", `${value} is not an integer number of ticks`);
  if (!Number.isSafeInteger(value)) throw new TimeError("time/out-of-range", `${value} is outside ±(2^53 − 1)`);
  return value as MediaTime;
}

function inRange(ticks: bigint): MediaTime {
  if (ticks > MAX || ticks < -MAX) throw new TimeError("time/out-of-range", "the result is outside ±(2^53 − 1)");
  return Number(ticks) as MediaTime;
}

const gcdOf = (a: number, b: number): number => { while (b !== 0) [a, b] = [b, a % b]; return a; };

/** The rate reduced by its greatest common divisor, each part within 1…1 000 000 once reduced. */
export function checkedFrameRate(rate: Rational): Rational {
  const { numerator, denominator } = rate;
  const part = (value: number) => Number.isInteger(value) && value >= 1 && value <= 0xffff_ffff;
  if (!part(numerator) || !part(denominator)) throw new TimeError("time/invalid-frame-rate", "a frame rate is a rational of positive integers");
  const divisor = gcdOf(numerator, denominator);
  const reduced = { numerator: numerator / divisor, denominator: denominator / divisor };
  if (reduced.numerator > MAX_RATE_PART || reduced.denominator > MAX_RATE_PART) {
    throw new TimeError("time/invalid-frame-rate", "numerator and denominator are at most 1 000 000");
  }
  return reduced;
}

type Checked = { numerator: bigint; perNumerator: bigint };
// Every frame of a render asks for the same rate, so the checked form is kept per rate object.
const CHECKED = new WeakMap<Rational, Checked>();
function checked(rate: Rational): Checked {
  let known = CHECKED.get(rate);
  if (!known) {
    const reduced = checkedFrameRate(rate);
    known = { numerator: BigInt(reduced.numerator), perNumerator: TICKS * BigInt(reduced.denominator) };
    CHECKED.set(rate, known);
  }
  return known;
}

/**
 * Start of frame `frame`: `q × (120000 × den) + roundHalfAway(r × 120000 × den / num)`. The products pass 2^53, so
 * they are `BigInt`; a negative frame is the mirror image of the positive one.
 */
function frameTicks(frame: bigint, rate: Checked): bigint {
  const magnitude = frame < 0n ? -frame : frame;
  const whole = magnitude / rate.numerator, rest = magnitude % rate.numerator;
  const ticks = whole * rate.perNumerator + (2n * rest * rate.perNumerator + rate.numerator) / (2n * rate.numerator);
  return frame < 0n ? -ticks : ticks;
}

/** The greatest `n` with `frameTicks(n) ≤ ticks`. */
function frameFloor(ticks: bigint, rate: Checked): bigint {
  const product = ticks * rate.numerator;
  // BigInt division truncates toward zero; the two loops settle the estimate either way.
  let frame = product / rate.perNumerator;
  while (frameTicks(frame, rate) > ticks) frame -= 1n;
  while (frameTicks(frame + 1n, rate) <= ticks) frame += 1n;
  return frame;
}

const big = (value: number, what: string): bigint => {
  if (!Number.isInteger(value)) throw new TimeError("time/non-integer-ticks", `${what} ${value} is not an integer`);
  return BigInt(value);
};

export function mediaTimeFromSeconds(seconds: number): MediaTime {
  if (!Number.isFinite(seconds)) throw new TimeError("time/out-of-range", "seconds is not a finite number");
  const ticks = roundHalfAwayFromZero(seconds * TICKS_PER_SECOND);
  if (Math.abs(ticks) > Number.MAX_SAFE_INTEGER) throw new TimeError("time/out-of-range", "the result is outside ±(2^53 − 1)");
  return ticks as MediaTime;
}
/** Seconds for WebCodecs, Web Audio and muxers. Derive it at the point of use; never accumulate it. */
export const mediaTimeToSeconds = (time: number): number => time / TICKS_PER_SECOND;

export function mediaTimeFromFrame(frame: number, rate: Rational): MediaTime {
  if (!Number.isSafeInteger(frame)) throw new TimeError("time/out-of-range", `frame ${frame} is not a safe integer`);
  return inRange(frameTicks(BigInt(frame), checked(rate)));
}
/** Index of the frame whose interval contains `time`. */
export function mediaTimeToFrame(time: number, rate: Rational): number {
  return inRange(frameFloor(big(time, "time"), checked(rate)));
}
/** Nearest frame boundary; a tie goes away from zero. */
export function roundToFrame(time: number, rate: Rational): MediaTime {
  const known = checked(rate), ticks = big(time, "time");
  const frame = frameFloor(ticks, known);
  const below = frameTicks(frame, known), above = frameTicks(frame + 1n, known);
  const down = ticks - below, up = above - ticks;
  return inRange(down < up || (down === up && ticks < 0n) ? below : above);
}
export function floorToFrame(time: number, rate: Rational): MediaTime {
  const known = checked(rate);
  return inRange(frameTicks(frameFloor(big(time, "time"), known), known));
}
/** Start of the final frame fully contained in `duration`; 0 when the duration is shorter than one frame. */
export function lastFrameTime(duration: number, rate: Rational): MediaTime {
  const known = checked(rate), ticks = big(duration, "duration");
  if (ticks <= 0n) return 0 as MediaTime;
  const frame = frameFloor(ticks, known);
  return frame < 1n ? 0 as MediaTime : inRange(frameTicks(frame - 1n, known));
}
/** Clamps to `[0, lastFrameTime(duration)]`, then floors to a frame. */
export function snappedSeekTime(time: number, duration: number, rate: Rational): MediaTime {
  return floorToFrame(mediaTimeClamp(time, 0, lastFrameTime(duration, rate)), rate);
}

export const mediaTimeAdd = (lhs: number, rhs: number): MediaTime => inRange(big(lhs, "lhs") + big(rhs, "rhs"));
export const mediaTimeSub = (lhs: number, rhs: number): MediaTime => inRange(big(lhs, "lhs") - big(rhs, "rhs"));
export const mediaTimeMin = (lhs: number, rhs: number): MediaTime => mediaTime(Math.min(lhs, rhs));
export const mediaTimeMax = (lhs: number, rhs: number): MediaTime => mediaTime(Math.max(lhs, rhs));
export const mediaTimeClamp = (time: number, min: number, max: number): MediaTime => mediaTime(Math.min(Math.max(time, min), max));

/** Duration of the first frame. Exact for the preset rates; for an uneven rational frames differ by a tick. */
export const frameDuration = (rate: Rational): MediaTime => mediaTimeFromFrame(1, rate);
/** The frame rate rounded to whole frames per second, half away from zero. */
export function roundedFrameRate(rate: Rational): number {
  const { numerator, denominator } = checkedFrameRate(rate);
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}
