import { toHex } from "@jagentchill/editor-core";

/** A running hash: bytes go in as they are read or written, so no file is ever held in memory to be hashed. */
export interface Hasher { update(bytes: Uint8Array): void; digestHex(): string }
export type HasherFactory = () => Hasher;

const K = new Uint32Array(64);
{
  let count = 0;
  for (let candidate = 2; count < 64; candidate++) {
    let prime = true;
    for (let divisor = 2; divisor * divisor <= candidate; divisor++) if (candidate % divisor === 0) { prime = false; break; }
    if (prime) K[count++] = Math.floor((Math.cbrt(candidate) % 1) * 2 ** 32);
  }
}

/** Incremental SHA-256 in plain TypeScript, for the runtimes that have no streaming digest (browser, Hermes). */
export function createSha256(): Hasher {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const block = new Uint8Array(64), w = new Uint32Array(64);
  let filled = 0, total = 0;
  const compress = (data: Uint8Array, offset: number) => {
    for (let i = 0; i < 16; i++) { const at = offset + i * 4; w[i] = ((data[at] << 24) | (data[at + 1] << 16) | (data[at + 2] << 8) | data[at + 3]) >>> 0; }
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3), s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  };
  const update = (bytes: Uint8Array) => {
    let at = 0;
    total += bytes.length;
    if (filled > 0) {
      const take = Math.min(64 - filled, bytes.length);
      block.set(bytes.subarray(0, take), filled);
      filled += take; at = take;
      if (filled < 64) return;
      compress(block, 0); filled = 0;
    }
    for (; at + 64 <= bytes.length; at += 64) compress(bytes, at);
    if (at < bytes.length) { block.set(bytes.subarray(at), 0); filled = bytes.length - at; }
  };
  return {
    update,
    digestHex() {
      const bits = total * 8, padding = new Uint8Array(((filled + 9 + 63) >> 6 << 6) - filled);
      padding[0] = 0x80;
      const view = new DataView(padding.buffer);
      view.setUint32(padding.length - 8, Math.floor(bits / 2 ** 32));
      view.setUint32(padding.length - 4, bits >>> 0);
      update(padding);
      const out = new Uint8Array(32), outView = new DataView(out.buffer);
      h.forEach((word, index) => outView.setUint32(index * 4, word));
      return toHex(out);
    },
  };
}

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index++) {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  CRC_TABLE[index] = value >>> 0;
}
/** CRC-32 (ZIP), continued from a previous value. */
export function crc32(bytes: Uint8Array, previous = 0): number {
  let crc = ~previous >>> 0;
  for (let index = 0; index < bytes.length; index++) crc = CRC_TABLE[(crc ^ bytes[index]) & 255] ^ (crc >>> 8);
  return ~crc >>> 0;
}

/** Bytes in pieces: what a streamed read yields and a streamed write consumes. */
export type ByteSource = AsyncIterable<Uint8Array> | Iterable<Uint8Array>;
export const STREAM_CHUNK_BYTES = 1024 * 1024;
export async function* chunksOf(bytes: Uint8Array, size = STREAM_CHUNK_BYTES): AsyncGenerator<Uint8Array> {
  for (let offset = 0; offset < bytes.length; offset += size) yield bytes.subarray(offset, Math.min(bytes.length, offset + size));
}
export async function collect(source: ByteSource): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let length = 0;
  for await (const part of source) { parts.push(part); length += part.length; }
  if (parts.length === 1) return parts[0];
  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}
