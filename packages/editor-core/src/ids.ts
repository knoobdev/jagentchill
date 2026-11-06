/** Fills a byte array with random values; `crypto.getRandomValues` in every runtime the editor runs in. */
export type RandomSource = (bytes: Uint8Array) => Uint8Array;
const platformRandom: RandomSource = (bytes) => {
  const source = (globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }).crypto;
  if (!source?.getRandomValues) throw new Error("no cryptographic random source: pass one to uuidV4");
  return source.getRandomValues(bytes);
};
/** A lowercase UUID v4: the form of every id JAgentChill creates. */
export function uuidV4(random: RandomSource = platformRandom): string {
  const bytes = random(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export const isUuidV4 = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);

/**
 * The id source of an editing session. Ids are never reused within the session, not even after their entity is
 * deleted: one is drawn again in the (astronomically unlikely) case that it was issued before.
 */
export function createIdSource(random: RandomSource = platformRandom): () => string {
  const issued = new Set<string>();
  return () => {
    let id = uuidV4(random);
    while (issued.has(id)) id = uuidV4(random);
    issued.add(id);
    return id;
  };
}
