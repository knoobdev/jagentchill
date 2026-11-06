/** Gain, pan and fade maths of the audio signal chain. Pure functions; the live graph and the mixdown share them. */

export const INTERNAL_SAMPLE_RATE = 48_000;
export const SILENCE_DB = -60;

/** `10^(dB/20)`; −60 dB and below is silence. */
export const dbToGain = (db: number): number => (db <= SILENCE_DB ? 0 : Math.pow(10, db / 20));

/**
 * Equal-power pan: left `cos θ`, right `sin θ` with `θ = (pan + 100) / 200 × π/2`, normalised so that pan 0 leaves
 * a stereo signal unchanged.
 */
export function panGains(pan: number): [number, number] {
  const clamped = Math.min(Math.max(pan, -100), 100);
  if (clamped === 0) return [1, 1];
  const theta = ((clamped + 100) / 200) * (Math.PI / 2);
  return [Math.cos(theta) * Math.SQRT2, Math.sin(theta) * Math.SQRT2];
}

// The fade curves are the editor's as well (the fade drawn on a clip follows them): they live in `editor-core`.
export { FADE_GAINS, fadeGain, type Fade } from "@jagentchill/editor-core";
