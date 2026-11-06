/**
 * SHA-256 content hashing. Files are hashed in chunks so a multi-gigabyte original never has to be held in memory;
 * the Web Crypto digest has no streaming form, hence the incremental implementation in plain TypeScript.
 */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export class Sha256 {
  private readonly h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  private readonly block = new Uint8Array(64);
  private readonly w = new Int32Array(64);
  private filled = 0;
  private length = 0;

  update(bytes: Uint8Array): this {
    this.length += bytes.length;
    let offset = 0;
    if (this.filled > 0) {
      const take = Math.min(64 - this.filled, bytes.length);
      this.block.set(bytes.subarray(0, take), this.filled);
      this.filled += take; offset = take;
      if (this.filled < 64) return this;
      this.compress(this.block, 0);
      this.filled = 0;
    }
    for (; offset + 64 <= bytes.length; offset += 64) this.compress(bytes, offset);
    if (offset < bytes.length) { this.block.set(bytes.subarray(offset), 0); this.filled = bytes.length - offset; }
    return this;
  }
  /** The digest as 64 lowercase hexadecimal characters. The instance is finished afterwards. */
  digest(): string {
    const bits = this.length * 8, tail = new Uint8Array(this.filled < 56 ? 64 - this.filled : 128 - this.filled);
    tail[0] = 0x80;
    const view = new DataView(tail.buffer);
    view.setUint32(tail.length - 8, Math.floor(bits / 2 ** 32));
    view.setUint32(tail.length - 4, bits >>> 0);
    this.update(tail);
    let hex = "";
    for (const word of this.h) hex += word.toString(16).padStart(8, "0");
    return hex;
  }
  private compress(bytes: Uint8Array, offset: number): void {
    const w = this.w, h = this.h;
    for (let i = 0; i < 16; i++) w[i] = (bytes[offset + i * 4] << 24) | (bytes[offset + i * 4 + 1] << 16) | (bytes[offset + i * 4 + 2] << 8) | bytes[offset + i * 4 + 3];
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      w[i] = (w[i - 16] + (((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3)) + w[i - 7] + (((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10))) | 0;
    }
    let a = h[0] | 0, b = h[1] | 0, c = h[2] | 0, d = h[3] | 0, e = h[4] | 0, f = h[5] | 0, g = h[6] | 0, hh = h[7] | 0;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
}

/** A readable range of bytes: a `Blob`, a file on disk behind a bridge, or bytes in memory. */
export interface ByteSource {
  readonly size: number;
  read(start: number, end: number): Promise<Uint8Array>;
}
export const bytesSource = (bytes: Uint8Array): ByteSource => ({ size: bytes.length, read: async (start, end) => bytes.subarray(start, end) });
export const blobSource = (blob: Blob): ByteSource => ({ size: blob.size, read: async (start, end) => new Uint8Array(await blob.slice(start, end).arrayBuffer()) });
export const readAll = (source: ByteSource): Promise<Uint8Array> => source.read(0, source.size);

export const sha256Hex = (bytes: Uint8Array): string => new Sha256().update(bytes).digest();
/** Key of a library sound that is not a project asset: the SHA-256 of its URL. */
export const sha256OfText = (text: string): string => sha256Hex(new TextEncoder().encode(text));

export const HASH_CHUNK_BYTES = 4 * 1024 * 1024;
export class AbortedError extends Error {
  constructor() { super("aborted"); this.name = "AbortError"; }
}
/** Hashes a source chunk by chunk, yielding to the event loop between chunks. */
export async function hashSource(source: ByteSource, options: { chunkBytes?: number; onProgress?: (fraction: number) => void; signal?: AbortSignal } = {}): Promise<string> {
  const chunk = options.chunkBytes ?? HASH_CHUNK_BYTES, hash = new Sha256();
  for (let offset = 0; offset < source.size; offset += chunk) {
    if (options.signal?.aborted) throw new AbortedError();
    hash.update(await source.read(offset, Math.min(source.size, offset + chunk)));
    options.onProgress?.(Math.min(1, (offset + chunk) / source.size));
  }
  return hash.digest();
}
