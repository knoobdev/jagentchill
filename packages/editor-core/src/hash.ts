/**
 * The engine's one integer hash (render-engine "Deterministic hash"): the 32-bit PCG output function with wrapping
 * arithmetic. The Rust twin is `effects::pcg`, the shader twin is in `library/common.wgsl`; the three agree on
 * `fixtures/hash-vectors.json`.
 */
export function pcg(x: number): number {
  const s = (Math.imul(x >>> 0, 747796405) + 2891336453) >>> 0;
  const w = Math.imul(((s >>> ((s >>> 28) + 4)) ^ s) >>> 0, 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
}
/** `hash(seed, i)` = `pcg(pcg(seed) + i)`; `hash(seed, i, j)` = `pcg(hash(seed, i) + j)`. Unsigned 32-bit. */
export function hash(seed: number, i: number, j?: number): number {
  const first = pcg((pcg(seed) + (i >>> 0)) >>> 0);
  return j === undefined ? first : pcg((first + (j >>> 0)) >>> 0);
}
/** A hash mapped to 0…1: `hash / 4294967296`. */
export const hashUnit = (seed: number, i: number, j?: number): number => hash(seed, i, j) / 4294967296;
/** The seed of a string (an element id, an effect instance id): FNV-1a 32-bit over its UTF-8 bytes. */
export function stringSeed(text: string): number {
  let value = 2166136261;
  for (const byte of new TextEncoder().encode(text)) value = Math.imul(value ^ byte, 16777619) >>> 0;
  return value >>> 0;
}
