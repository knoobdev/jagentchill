import { randomBytes } from "node:crypto";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { STREAM_CHUNK_BYTES, type ByteSource } from "./hash.ts";

/** The default library folder of each desktop platform. */
export function defaultLibraryFolder(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  if (platform === "darwin") return join(home, "Movies", "JAgentChill");
  if (platform === "win32") return join(env.USERPROFILE ?? home, "Videos", "JAgentChill");
  return join(env.XDG_VIDEOS_DIR || join(home, "Videos"), "JAgentChill");
}

/** Writes a file to a temporary name in the same directory, flushes it to disk and renames it: no reader sees a partial file. */
export async function writeFileAtomic(path: string, data: Uint8Array | string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  const handle = await open(temporary, "w");
  try {
    await handle.writeFile(data);
    await handle.sync();
  } catch (error) {
    await handle.close();
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  await handle.close();
  await rename(temporary, path);
}

/** `writeFileAtomic` from pieces: the file is streamed to the temporary name, flushed and renamed. */
export async function writeStreamAtomic(path: string, source: ByteSource): Promise<number> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  const handle = await open(temporary, "w");
  let written = 0;
  try {
    for await (const chunk of source) { await handle.write(chunk); written += chunk.length; }
    await handle.sync();
  } catch (error) {
    await handle.close();
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  await handle.close();
  await rename(temporary, path);
  return written;
}
/** The bytes `[start, end)` of a file, in pieces. */
export async function* readFileRange(path: string, range: { start?: number; end?: number } = {}): AsyncGenerator<Uint8Array> {
  const handle = await open(path, "r");
  try {
    const end = Math.min(range.end ?? Infinity, (await handle.stat()).size);
    for (let offset = range.start ?? 0; offset < end;) {
      const buffer = new Uint8Array(Math.min(STREAM_CHUNK_BYTES, end - offset));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
      yield bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead);
    }
  } finally { await handle.close(); }
}

/** A file as the source of a ZIP reader: read by ranges, never whole. */
export async function fileZipSource(path: string): Promise<{ size: number; read(offset: number, length: number): Promise<Uint8Array>; close(): Promise<void> }> {
  const handle = await open(path, "r"), size = (await handle.stat()).size;
  return {
    size,
    async read(offset, length) { const buffer = new Uint8Array(Math.max(0, Math.min(length, size - offset))); let done = 0; while (done < buffer.length) { const { bytesRead } = await handle.read(buffer, done, buffer.length - done, offset + done); if (bytesRead === 0) break; done += bytesRead; } return buffer.subarray(0, done); },
    close: () => handle.close(),
  };
}
/** A file as the sink of a package writer: streamed to a temporary name, renamed on close, deleted on abort. */
export async function filePackageSink(path: string): Promise<{ write(chunk: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> }> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomBytes(6).toString("hex")}.tmp`, handle = await open(temporary, "w");
  let ended = false;
  return {
    write: async (chunk) => { await handle.write(chunk); },
    async close() { if (ended) return; ended = true; await handle.sync(); await handle.close(); await rename(temporary, path); },
    async abort() { if (ended) return; ended = true; await handle.close().catch(() => undefined); await unlink(temporary).catch(() => undefined); },
  };
}
