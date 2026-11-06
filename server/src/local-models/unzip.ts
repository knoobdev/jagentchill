import { chmodSync, closeSync, createReadStream, createWriteStream, fstatSync, mkdirSync, openSync, readSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { createInflateRaw } from "node:zlib";

/**
 * Unpacks a ZIP archive (the engine's release archives: Info-ZIP on macOS and Linux, 7-Zip on Windows) into a folder,
 * entry by entry, streaming — an archive is never read into memory whole. Stored and deflated entries, ZIP64 sizes;
 * a name that would land outside the folder is refused. Unix permissions of an entry are kept (the engine's program
 * stays executable). Returns the paths written, relative to the folder.
 */
export async function unzip(archive: string, into: string): Promise<string[]> {
  const fd = openSync(archive, "r");
  const entries: { name: string; method: number; compressed: number; offset: number; mode: number }[] = [];
  try {
    const size = fstatSync(fd).size, tail = Buffer.alloc(Math.min(size, 65_557));
    readSync(fd, tail, 0, tail.length, size - tail.length);
    let end = -1;
    for (let at = tail.length - 22; at >= 0; at--) if (tail.readUInt32LE(at) === 0x06054b50) { end = at; break; }
    if (end < 0) throw new Error("This archive is not a ZIP file.");
    let count = tail.readUInt16LE(end + 10), cdSize = tail.readUInt32LE(end + 12), cdOffset = tail.readUInt32LE(end + 16);
    if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
      // ZIP64: the locator right before the end record points at the ZIP64 end record with the real numbers.
      const locator = end - 20;
      if (locator < 0 || tail.readUInt32LE(locator) !== 0x07064b50) throw new Error("This ZIP archive's directory cannot be read.");
      const record = Buffer.alloc(56);
      readSync(fd, record, 0, 56, Number(tail.readBigUInt64LE(locator + 8)));
      if (record.readUInt32LE(0) !== 0x06064b50) throw new Error("This ZIP archive's directory cannot be read.");
      count = Number(record.readBigUInt64LE(32)); cdSize = Number(record.readBigUInt64LE(40)); cdOffset = Number(record.readBigUInt64LE(48));
    }
    const directory = Buffer.alloc(cdSize);
    readSync(fd, directory, 0, cdSize, cdOffset);
    for (let at = 0, n = 0; n < count; n++) {
      if (directory.readUInt32LE(at) !== 0x02014b50) throw new Error("This ZIP archive's directory is damaged.");
      const method = directory.readUInt16LE(at + 10), nameLength = directory.readUInt16LE(at + 28), extraLength = directory.readUInt16LE(at + 30), commentLength = directory.readUInt16LE(at + 32);
      let compressed = directory.readUInt32LE(at + 20), uncompressed = directory.readUInt32LE(at + 24), offset = directory.readUInt32LE(at + 42);
      const mode = (directory.readUInt32LE(at + 38) >>> 16) & 0o777, name = directory.toString("utf8", at + 46, at + 46 + nameLength);
      // ZIP64 extra field: the 64-bit values, in order, of the fields that are 0xFFFFFFFF.
      for (let extra = at + 46 + nameLength; extra < at + 46 + nameLength + extraLength;) {
        const id = directory.readUInt16LE(extra), length = directory.readUInt16LE(extra + 2);
        if (id === 0x0001) { let field = extra + 4; if (uncompressed === 0xffffffff) { uncompressed = Number(directory.readBigUInt64LE(field)); field += 8; } if (compressed === 0xffffffff) { compressed = Number(directory.readBigUInt64LE(field)); field += 8; } if (offset === 0xffffffff) offset = Number(directory.readBigUInt64LE(field)); }
        extra += 4 + length;
      }
      entries.push({ name, method, compressed, offset, mode });
      at += 46 + nameLength + extraLength + commentLength;
    }
    for (const entry of entries) {
      const local = Buffer.alloc(30);
      readSync(fd, local, 0, 30, entry.offset);
      if (local.readUInt32LE(0) !== 0x04034b50) throw new Error("This ZIP archive is damaged.");
      (entry as { start?: number }).start = entry.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
    }
  } finally { closeSync(fd); }
  const written: string[] = [];
  for (const entry of entries) {
    const name = normalize(entry.name.replace(/\\/g, "/"));
    if (isAbsolute(name) || name.split(/[\\/]/).includes("..") || name.startsWith(sep)) throw new Error(`The archive names a file outside its folder: ${entry.name}`);
    const target = join(into, name);
    if (entry.name.endsWith("/")) { mkdirSync(target, { recursive: true }); continue; }
    if (entry.method !== 0 && entry.method !== 8) throw new Error(`The archive uses a compression this host cannot unpack (${entry.method}).`);
    mkdirSync(dirname(target), { recursive: true });
    const start = (entry as { start?: number }).start!;
    const source = entry.compressed > 0 ? createReadStream(archive, { start, end: start + entry.compressed - 1 }) : null;
    if (!source) { writeFileSync(target, ""); written.push(name); continue; }
    await (entry.method === 8 ? pipeline(source, createInflateRaw(), createWriteStream(target)) : pipeline(source, createWriteStream(target)));
    if (entry.mode & 0o111) chmodSync(target, 0o755);
    written.push(name);
  }
  return written;
}
