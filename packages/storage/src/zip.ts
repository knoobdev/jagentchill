import { utf8 } from "@jagentchill/editor-core";
import { crc32, STREAM_CHUNK_BYTES, type ByteSource } from "./hash.ts";

/**
 * The ZIP container of the product's package formats. Written and read in pieces — an entry is never held in memory —
 * with ZIP64 records where a size, an offset or the entry count needs them. Entries are stored, not compressed:
 * media is already compressed, and the reader inflates what other tools wrote.
 */
export type ZipSink = { write(chunk: Uint8Array): Promise<void> };
export type ZipSource = { size: number; read(offset: number, length: number): Promise<Uint8Array> };
export type ZipEntry = { name: string; size: number; compressedSize: number; crc: number; method: number; offset: number; isDirectory: boolean; isSymlink: boolean };
export class ZipError extends Error { constructor(message: string) { super(message); this.name = "ZipError"; } }

const U32 = 0xffffffff, U16 = 0xffff;
const SIG_LOCAL = 0x04034b50, SIG_DESCRIPTOR = 0x08074b50, SIG_CENTRAL = 0x02014b50, SIG_END = 0x06054b50, SIG_END64 = 0x06064b50, SIG_LOCATOR64 = 0x07064b50;
/** Bit 3: sizes and CRC follow the data; bit 11: the name is UTF-8. */
const FLAGS = 0x0808;
// 1980-01-01 00:00: package entries carry no modification time of their own.
const DOS_TIME = 0, DOS_DATE = 0x0021;

class Writer {
  readonly bytes: Uint8Array; private readonly view: DataView; private at = 0;
  constructor(length: number) { this.bytes = new Uint8Array(length); this.view = new DataView(this.bytes.buffer); }
  u16(value: number): this { this.view.setUint16(this.at, value, true); this.at += 2; return this; }
  u32(value: number): this { this.view.setUint32(this.at, value >>> 0, true); this.at += 4; return this; }
  u64(value: number): this { this.view.setUint32(this.at, value % 2 ** 32, true); this.view.setUint32(this.at + 4, Math.floor(value / 2 ** 32), true); this.at += 8; return this; }
  raw(bytes: Uint8Array): this { this.bytes.set(bytes, this.at); this.at += bytes.length; return this; }
}

/** A name is safe when it is a relative path without `..`, without an absolute root and without a drive letter. */
export function isSafeEntryName(name: string): boolean {
  if (name === "" || name.includes("\0") || name.includes("\\") || name.startsWith("/") || /^[A-Za-z]:/.test(name)) return false;
  const parts = (name.endsWith("/") ? name.slice(0, -1) : name).split("/");
  return parts.every((part) => part !== "" && part !== "." && part !== "..");
}

/** Writes a ZIP to a sink, entry by entry. `finish` writes the central directory. */
export function createZipWriter(sink: ZipSink) {
  type Written = { name: Uint8Array; crc: number; size: number; offset: number; zip64: boolean };
  const entries: Written[] = [];
  const names = new Set<string>();
  let offset = 0, finished = false;
  const put = async (bytes: Uint8Array) => { await sink.write(bytes); offset += bytes.length; };

  return {
    get bytesWritten(): number { return offset; },
    /** Adds one stored entry. `size` — when known — decides whether the entry needs ZIP64 records. */
    async add(name: string, data: Uint8Array | ByteSource, options: { size?: number } = {}): Promise<{ size: number; crc: number }> {
      if (finished) throw new ZipError("the archive is already finished");
      if (!isSafeEntryName(name) || name.endsWith("/")) throw new ZipError(`"${name}" is not a valid entry name`);
      if (names.has(name)) throw new ZipError(`the archive already has an entry "${name}"`);
      names.add(name);
      const encoded = utf8(name), declared = data instanceof Uint8Array ? data.length : options.size;
      // Without a known size the entry is written in ZIP64 form, which holds any size.
      const zip64 = declared === undefined || declared >= U32, start = offset;
      const header = new Writer(30 + encoded.length + (zip64 ? 20 : 0));
      header.u32(SIG_LOCAL).u16(zip64 ? 45 : 20).u16(FLAGS).u16(0).u16(DOS_TIME).u16(DOS_DATE).u32(0).u32(zip64 ? U32 : 0).u32(zip64 ? U32 : 0).u16(encoded.length).u16(zip64 ? 20 : 0).raw(encoded);
      if (zip64) header.u16(1).u16(16).u64(0).u64(0);
      await put(header.bytes);
      let crc = 0, size = 0;
      const chunks: ByteSource = data instanceof Uint8Array ? [data] : data;
      for await (const chunk of chunks) {
        for (let at = 0; at < chunk.length; at += STREAM_CHUNK_BYTES) {
          const piece = chunk.subarray(at, Math.min(chunk.length, at + STREAM_CHUNK_BYTES));
          crc = crc32(piece, crc); size += piece.length;
          await put(piece);
        }
      }
      if (!zip64 && size >= U32) throw new ZipError(`"${name}" is larger than its declared size allows`);
      const descriptor = new Writer(zip64 ? 24 : 16);
      descriptor.u32(SIG_DESCRIPTOR).u32(crc);
      if (zip64) descriptor.u64(size).u64(size); else descriptor.u32(size).u32(size);
      await put(descriptor.bytes);
      entries.push({ name: encoded, crc, size, offset: start, zip64 });
      return { size, crc };
    },
    /** Writes the central directory and the end records; resolves to the size of the archive. */
    async finish(): Promise<number> {
      if (finished) return offset;
      finished = true;
      const directoryStart = offset;
      for (const entry of entries) {
        const bigOffset = entry.offset >= U32, extra = (entry.zip64 ? 16 : 0) + (bigOffset ? 8 : 0);
        const record = new Writer(46 + entry.name.length + (extra ? extra + 4 : 0));
        record.u32(SIG_CENTRAL).u16(entry.zip64 || bigOffset ? 45 : 20).u16(entry.zip64 || bigOffset ? 45 : 20).u16(FLAGS).u16(0).u16(DOS_TIME).u16(DOS_DATE).u32(entry.crc)
          .u32(entry.zip64 ? U32 : entry.size).u32(entry.zip64 ? U32 : entry.size).u16(entry.name.length).u16(extra ? extra + 4 : 0).u16(0).u16(0).u16(0).u32(0).u32(bigOffset ? U32 : entry.offset).raw(entry.name);
        if (extra) { record.u16(1).u16(extra); if (entry.zip64) record.u64(entry.size).u64(entry.size); if (bigOffset) record.u64(entry.offset); }
        await put(record.bytes);
      }
      const directorySize = offset - directoryStart;
      if (entries.length >= U16 || directorySize >= U32 || directoryStart >= U32 || entries.some((entry) => entry.zip64 || entry.offset >= U32)) {
        const end64 = offset, record = new Writer(56 + 20);
        record.u32(SIG_END64).u64(44).u16(45).u16(45).u32(0).u32(0).u64(entries.length).u64(entries.length).u64(directorySize).u64(directoryStart);
        record.u32(SIG_LOCATOR64).u32(0).u64(end64).u32(1);
        await put(record.bytes);
      }
      const end = new Writer(22);
      end.u32(SIG_END).u16(0).u16(0).u16(Math.min(U16, entries.length)).u16(Math.min(U16, entries.length)).u32(Math.min(U32, directorySize)).u32(Math.min(U32, directoryStart)).u16(0);
      await put(end.bytes);
      return offset;
    },
  };
}

const u16 = (bytes: Uint8Array, at: number) => bytes[at] | (bytes[at + 1] << 8);
const u32 = (bytes: Uint8Array, at: number) => (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
const u64 = (bytes: Uint8Array, at: number) => u32(bytes, at) + u32(bytes, at + 4) * 2 ** 32;
export function decodeUtf8(bytes: Uint8Array): string {
  let out = "";
  for (let at = 0; at < bytes.length;) {
    const a = bytes[at++];
    if (a < 0x80) out += String.fromCharCode(a);
    else if (a < 0xe0) out += String.fromCharCode(((a & 31) << 6) | (bytes[at++] & 63));
    else if (a < 0xf0) { out += String.fromCharCode(((a & 15) << 12) | ((bytes[at] & 63) << 6) | (bytes[at + 1] & 63)); at += 2; }
    else { out += String.fromCodePoint(((a & 7) << 18) | ((bytes[at] & 63) << 12) | ((bytes[at + 1] & 63) << 6) | (bytes[at + 2] & 63)); at += 3; }
  }
  return out;
}

/** The entries of a ZIP, read from its central directory. Only the directory is read here; no entry data. */
export async function readZipDirectory(source: ZipSource): Promise<ZipEntry[]> {
  if (source.size < 22) throw new ZipError("the file is not a ZIP archive");
  const tailLength = Math.min(source.size, 22 + U16 + 20), tailStart = source.size - tailLength, tail = await source.read(tailStart, tailLength);
  let end = -1;
  for (let at = tail.length - 22; at >= 0; at--) if (u32(tail, at) === SIG_END && at + 22 + u16(tail, at + 20) === tail.length) { end = at; break; }
  if (end < 0) throw new ZipError("the file is not a ZIP archive");
  let count = u16(tail, end + 10), directorySize = u32(tail, end + 12), directoryStart = u32(tail, end + 16);
  if (end >= 20 && u32(tail, end - 20) === SIG_LOCATOR64) {
    const record = await source.read(u64(tail, end - 20 + 8), 56);
    if (u32(record, 0) !== SIG_END64) throw new ZipError("the ZIP64 end record is damaged");
    count = u64(record, 32); directorySize = u64(record, 40); directoryStart = u64(record, 48);
  }
  if (directoryStart + directorySize > source.size) throw new ZipError("the central directory lies outside the file");
  const directory = await source.read(directoryStart, directorySize), entries: ZipEntry[] = [];
  for (let at = 0, index = 0; index < count; index++) {
    if (at + 46 > directory.length || u32(directory, at) !== SIG_CENTRAL) throw new ZipError("the central directory is damaged");
    const madeBy = u16(directory, at + 4), flags = u16(directory, at + 8), method = u16(directory, at + 10), crc = u32(directory, at + 16);
    let compressedSize = u32(directory, at + 20), size = u32(directory, at + 24), offset = u32(directory, at + 42);
    const nameLength = u16(directory, at + 28), extraLength = u16(directory, at + 30), commentLength = u16(directory, at + 32), attributes = u32(directory, at + 38);
    const name = decodeUtf8(directory.subarray(at + 46, at + 46 + nameLength));
    for (let extra = at + 46 + nameLength, stop = extra + extraLength; extra + 4 <= stop;) {
      const id = u16(directory, extra), length = u16(directory, extra + 2);
      if (id === 1) {
        let field = extra + 4;
        if (size === U32) { size = u64(directory, field); field += 8; }
        if (compressedSize === U32) { compressedSize = u64(directory, field); field += 8; }
        if (offset === U32) offset = u64(directory, field);
      }
      extra += 4 + length;
    }
    if (flags & 1) throw new ZipError(`"${name}" is encrypted`);
    // A symbolic link is a Unix entry whose mode has the link type.
    const isSymlink = (madeBy >> 8) === 3 && ((attributes >>> 16) & 0xf000) === 0xa000;
    entries.push({ name, size, compressedSize, crc, method, offset, isDirectory: name.endsWith("/"), isSymlink });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** The uncompressed bytes of one entry, in pieces; the CRC is checked when the last piece has been read. */
export async function* readZipEntry(source: ZipSource, entry: ZipEntry): AsyncGenerator<Uint8Array> {
  const header = await source.read(entry.offset, 30);
  if (header.length < 30 || u32(header, 0) !== SIG_LOCAL) throw new ZipError(`the entry "${entry.name}" is damaged`);
  const start = entry.offset + 30 + u16(header, 26) + u16(header, 28);
  if (start + entry.compressedSize > source.size) throw new ZipError(`the entry "${entry.name}" lies outside the file`);
  const compressed = async function* (): AsyncGenerator<Uint8Array> {
    for (let at = 0; at < entry.compressedSize; at += STREAM_CHUNK_BYTES) yield await source.read(start + at, Math.min(STREAM_CHUNK_BYTES, entry.compressedSize - at));
  };
  let crc = 0, size = 0;
  const data = entry.method === 0 ? compressed() : entry.method === 8 ? inflateStream(compressed()) : null;
  if (!data) throw new ZipError(`the entry "${entry.name}" uses an unsupported compression method`);
  for await (const chunk of data) {
    crc = crc32(chunk, crc); size += chunk.length;
    if (size > entry.size) throw new ZipError(`the entry "${entry.name}" is larger than the archive declares`);
    yield chunk;
  }
  if (size !== entry.size || crc !== entry.crc) throw new ZipError(`the entry "${entry.name}" is damaged`);
}

type Decompressor = new (format: "deflate-raw") => { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> };
/** Raw DEFLATE, streamed through the platform where it has `DecompressionStream`, otherwise by the portable inflater. */
async function* inflateStream(source: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
  const Platform = (globalThis as { DecompressionStream?: Decompressor }).DecompressionStream;
  if (!Platform) {
    const parts: Uint8Array[] = [];
    let length = 0;
    for await (const part of source) { parts.push(part); length += part.length; }
    const all = new Uint8Array(length);
    let at = 0;
    for (const part of parts) { all.set(part, at); at += part.length; }
    const out = inflateRaw(all);
    for (let offset = 0; offset < out.length; offset += STREAM_CHUNK_BYTES) yield out.subarray(offset, Math.min(out.length, offset + STREAM_CHUNK_BYTES));
    return;
  }
  const stream = new Platform("deflate-raw"), writer = stream.writable.getWriter(), reader = stream.readable.getReader();
  const feeding = (async () => { try { for await (const part of source) await writer.write(part); await writer.close(); } catch (error) { await writer.abort(error).catch(() => undefined); throw error; } })();
  feeding.catch(() => undefined);
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; yield value; }
    await feeding;
  } catch (error) { throw new ZipError(`the compressed data is damaged: ${error instanceof Error ? error.message : String(error)}`); }
}

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DISTANCE_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DISTANCE_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CODE_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
type Huffman = { counts: Uint16Array; symbols: Uint16Array };
function huffman(lengths: ArrayLike<number>): Huffman {
  const counts = new Uint16Array(16), offsets = new Uint16Array(16), symbols = new Uint16Array(lengths.length);
  for (let index = 0; index < lengths.length; index++) counts[lengths[index]]++;
  counts[0] = 0;
  for (let bits = 1; bits < 16; bits++) offsets[bits] = offsets[bits - 1] + counts[bits - 1];
  for (let index = 0; index < lengths.length; index++) if (lengths[index] !== 0) symbols[offsets[lengths[index]]++] = index;
  return { counts, symbols };
}
/** Raw DEFLATE (RFC 1951) in plain TypeScript, for a runtime without `DecompressionStream`. */
export function inflateRaw(input: Uint8Array): Uint8Array {
  let position = 0, bitBuffer = 0, bitCount = 0, out = new Uint8Array(Math.max(1024, input.length * 4)), length = 0;
  const damaged = () => new ZipError("the compressed data is damaged");
  const bits = (count: number): number => {
    while (bitCount < count) { if (position >= input.length) throw damaged(); bitBuffer |= input[position++] << bitCount; bitCount += 8; }
    const value = bitBuffer & ((1 << count) - 1);
    bitBuffer >>>= count; bitCount -= count;
    return value;
  };
  const decode = (table: Huffman): number => {
    let code = 0, first = 0, index = 0;
    for (let size = 1; size < 16; size++) {
      code |= bits(1);
      const count = table.counts[size];
      if (code - count < first) return table.symbols[index + (code - first)];
      index += count; first = (first + count) << 1; code <<= 1;
    }
    throw damaged();
  };
  const push = (byte: number) => { if (length === out.length) { const grown = new Uint8Array(out.length * 2); grown.set(out); out = grown; } out[length++] = byte; };
  const fixedLengths = new Uint8Array(288);
  fixedLengths.fill(8, 0, 144); fixedLengths.fill(9, 144, 256); fixedLengths.fill(7, 256, 280); fixedLengths.fill(8, 280, 288);
  const fixedLiterals = huffman(fixedLengths), fixedDistances = huffman(new Uint8Array(30).fill(5));
  for (let last = 0; !last;) {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitBuffer = 0; bitCount = 0;
      if (position + 4 > input.length) throw damaged();
      const stored = input[position] | (input[position + 1] << 8);
      position += 4;
      if (position + stored > input.length) throw damaged();
      for (let index = 0; index < stored; index++) push(input[position++]);
      continue;
    }
    if (type === 3) throw damaged();
    let literals = fixedLiterals, distances = fixedDistances;
    if (type === 2) {
      const literalCount = bits(5) + 257, distanceCount = bits(5) + 1, codeCount = bits(4) + 4, codeLengths = new Uint8Array(19);
      for (let index = 0; index < codeCount; index++) codeLengths[CODE_ORDER[index]] = bits(3);
      const codes = huffman(codeLengths), lengths = new Uint8Array(literalCount + distanceCount);
      for (let index = 0; index < lengths.length;) {
        const symbol = decode(codes);
        if (symbol < 16) { lengths[index++] = symbol; continue; }
        const repeat = symbol === 16 ? 3 + bits(2) : symbol === 17 ? 3 + bits(3) : 11 + bits(7);
        const value = symbol === 16 ? (index === 0 ? -1 : lengths[index - 1]) : 0;
        if (value < 0 || index + repeat > lengths.length) throw damaged();
        lengths.fill(value, index, index + repeat);
        index += repeat;
      }
      literals = huffman(lengths.subarray(0, literalCount)); distances = huffman(lengths.subarray(literalCount));
    }
    for (;;) {
      const symbol = decode(literals);
      if (symbol < 256) { push(symbol); continue; }
      if (symbol === 256) break;
      if (symbol > 285) throw damaged();
      const run = LENGTH_BASE[symbol - 257] + bits(LENGTH_EXTRA[symbol - 257]), code = decode(distances);
      if (code > 29) throw damaged();
      const distance = DISTANCE_BASE[code] + bits(DISTANCE_EXTRA[code]);
      if (distance > length) throw damaged();
      for (let index = 0; index < run; index++) push(out[length - distance]);
    }
  }
  return out.subarray(0, length);
}

/** A ZIP held in memory, as a source. */
export const bytesZipSource = (bytes: Uint8Array): ZipSource => ({ size: bytes.length, read: async (offset, length) => bytes.subarray(offset, offset + length) });
/** A `Blob` or `File` (a picked file on web and mobile), read by slices. */
export const blobZipSource = (blob: { size: number; slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> } }): ZipSource => ({ size: blob.size, read: async (offset, length) => new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer()) });
/** A sink that collects the archive in memory (small archives, tests). */
export function memorySink(): ZipSink & { bytes(): Uint8Array } {
  const parts: Uint8Array[] = [];
  return {
    write: async (chunk) => { parts.push(chunk.slice()); },
    bytes() { const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let at = 0; for (const part of parts) { out.set(part, at); at += part.length; } return out; },
  };
}
