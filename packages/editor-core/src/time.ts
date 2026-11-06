import { TICKS_PER_SECOND, gcd, type Rational } from "@jagentchill/protocol";

import { floorToFrame, mediaTimeFromFrame, roundHalfAwayFromZero, roundToFrame, TimeError } from "./time/index.ts";

// The engine time API (exact integer maths, mirrored by the Rust `time` crate) lives in `./time/`.
export * from "./time/index.ts";

/** Rounds half away from zero, the one rounding rule of stored times and numbers. */
export const roundHalfAway = roundHalfAwayFromZero;

// The helpers below serve the document layer, which also meets rates the time API rejects (a document under
// validation, a classic project): for those the frame grid is the plain quotient, and the validator reports the rate.
const lenient = <T>(exact: () => T, loose: () => T): T => {
  try { return exact(); } catch (error) { if (error instanceof TimeError) return loose(); throw error; }
};
const looseFrameToTicks = (frame: number, fps: Rational): number => roundHalfAway((frame * TICKS_PER_SECOND * fps.denominator) / fps.numerator);

/** Tick of the start of frame `n` (design D5). */
export function frameToTicks(frame: number, fps: Rational): number {
  return lenient(() => mediaTimeFromFrame(frame, fps), () => looseFrameToTicks(frame, fps));
}
/** The frame whose start is nearest to `ticks`; never negative. */
export function ticksToNearestFrame(ticks: number, fps: Rational): number {
  const loose = () => Math.max(0, Math.round((ticks * fps.numerator) / (TICKS_PER_SECOND * fps.denominator)));
  if (!Number.isInteger(ticks)) return loose();
  return lenient(() => {
    const snapped = roundToFrame(Math.max(0, ticks), fps);
    // The index of a frame start is the estimate or one of its neighbours.
    const estimate = Math.round((snapped * fps.numerator) / (TICKS_PER_SECOND * fps.denominator));
    for (const frame of [estimate, estimate - 1, estimate + 1]) if (frame >= 0 && mediaTimeFromFrame(frame, fps) === snapped) return frame;
    return Math.max(0, estimate);
  }, loose);
}
export const snapToFrame = (ticks: number, fps: Rational): number => frameToTicks(ticksToNearestFrame(ticks, fps), fps);
export const isFrameAligned = (ticks: number, fps: Rational): boolean =>
  Number.isInteger(ticks) && ticks >= 0 && lenient(() => floorToFrame(ticks, fps) === ticks, () => snapToFrame(ticks, fps) === ticks);
/** Length of the first frame; the minimum duration of an element. */
export const frameTicks = (fps: Rational): number => frameToTicks(1, fps);

const STANDARD_RATES: Rational[] = [[24000, 1001], [24, 1], [25, 1], [30000, 1001], [30, 1], [48, 1], [50, 1], [60000, 1001], [60, 1], [120, 1]].map(([numerator, denominator]) => ({ numerator, denominator }));
export function reduceRational(value: Rational): Rational {
  const divisor = gcd(value.numerator, value.denominator) || 1;
  return { numerator: value.numerator / divisor, denominator: value.denominator / divisor };
}
/** The single rule that turns a frame-rate number into a rational: a standard rate within 0.01 fps, otherwise three decimals reduced. */
export function fpsToRational(fps: number): Rational {
  for (const rate of STANDARD_RATES) if (Math.abs(rate.numerator / rate.denominator - fps) <= 0.01) return rate;
  return reduceRational({ numerator: Math.max(1, Math.round(fps * 1000)), denominator: 1000 });
}
export const secondsToTicks = (seconds: number): number => roundHalfAway(seconds * TICKS_PER_SECOND);
