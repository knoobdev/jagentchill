import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync, statSync, type WriteStream } from "node:fs";
import { readdir, rename, rm, stat, statfs } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { expandDrop, fileKind } from "@jagentchill/desktop-core";
import { readFileRange } from "@jagentchill/storage/desktop";
import { BridgeError } from "./library.ts";
import type { Settings } from "./settings.ts";

export const EXPORT_HEADROOM_BYTES = 500 * 1024 * 1024;
export type FileHandle = { token: string; name: string; path: string; size: number; directory: boolean; kind: string | null };

/**
 * File access through the bridge is limited to what the user chose: a path selected in a native dialog, dropped on a
 * window or opened through a file association gets a random token, and every later operation names the token. A path
 * the user did not choose has no token and cannot be read.
 */
export function createFileAccess(deps: { settings: Settings }) {
  const granted = new Map<string, string>();
  const exports = new Map<string, { stream: WriteStream; part: string; final: string; failed: Error | null }>();
  const register = (path: string): FileHandle => {
    const absolute = resolve(path);
    let token = [...granted].find(([, known]) => known === absolute)?.[0];
    if (!token) { token = randomBytes(16).toString("hex"); granted.set(token, absolute); }
    let size = 0, directory = false;
    try { const info = statSync(absolute); size = info.size; directory = info.isDirectory(); } catch { /* a save target does not exist yet */ }
    return { token, name: basename(absolute), path: absolute, size, directory, kind: directory ? null : fileKind(absolute) };
  };
  const pathOf = (token: string): string => {
    const path = granted.get(token);
    if (!path) throw new BridgeError("PERMISSION_DENIED", "This file was not selected by the user");
    return path;
  };
  return {
    register, pathOf,
    /** The directory a dialog of one purpose opens in: where it was last used. */
    lastDirectory: (purpose: string): string | undefined => deps.settings.get<Record<string, string>>("dialogDirectories")?.[purpose],
    remember(purpose: string, path: string): void {
      deps.settings.set("dialogDirectories", { ...(deps.settings.get<Record<string, string>>("dialogDirectories") ?? {}), [purpose]: existsSync(path) && statSync(path).isDirectory() ? path : dirname(path) });
    },
    stat(token: string): FileHandle { return register(pathOf(token)); },
    async read(token: string, range: { start: number; end: number }): Promise<Uint8Array> {
      if (range.end < range.start || range.end - range.start > 4 * 1024 * 1024) throw new BridgeError("INVALID_PARAMS", "a read is at most 4 MiB");
      const parts: Buffer[] = [];
      try { for await (const part of readFileRange(pathOf(token), range)) parts.push(Buffer.from(part.buffer, part.byteOffset, part.byteLength)); } catch (error) {
        throw new BridgeError((error as NodeJS.ErrnoException).code === "ENOENT" ? "NOT_FOUND" : "UNAVAILABLE", `"${basename(pathOf(token))}" cannot be read: ${(error as NodeJS.ErrnoException).code ?? "error"}`);
      }
      return new Uint8Array(Buffer.concat(parts));
    },
    /** Folders are expanded to five levels and 2,000 files; hidden files and other types are skipped and counted. */
    async expand(tokens: string[]): Promise<{ files: FileHandle[]; skipped: number }> {
      const result = await expandDrop(tokens.map(pathOf), {
        isDirectory: async (path) => (await stat(path).catch(() => null))?.isDirectory() ?? false,
        list: async (directory) => (await readdir(directory, { withFileTypes: true }).catch(() => [])).map((entry) => ({ path: join(directory, entry.name), directory: entry.isDirectory() })),
      });
      return { files: result.files.map(register), skipped: result.skipped };
    },
    async freeSpace(path: string): Promise<number | null> {
      let current = resolve(path);
      while (!existsSync(current) && dirname(current) !== current) current = dirname(current);
      try { const info = await statfs(current); return Number(info.bavail) * Number(info.bsize); } catch { return null; }
    },
    /** An export is written to `<name>.part` beside its destination and renamed on success. */
    async exportOpen(token: string, estimatedBytes?: number): Promise<{ lowSpace: boolean; free: number | null }> {
      const final = pathOf(token), part = `${final}.part`;
      const free = await this.freeSpace(dirname(final));
      const stream = createWriteStream(part, { flags: "w" });
      const entry = { stream, part, final, failed: null as Error | null };
      stream.on("error", (error) => { entry.failed = error; });
      exports.set(token, entry);
      return { lowSpace: free !== null && estimatedBytes !== undefined && free < estimatedBytes + EXPORT_HEADROOM_BYTES, free };
    },
    async exportWrite(token: string, bytes: Uint8Array): Promise<void> {
      const entry = exports.get(token);
      if (!entry) throw new BridgeError("NOT_FOUND", "No export is open for this file");
      const fail = async (error: Error) => {
        exports.delete(token);
        entry.stream.destroy();
        await rm(entry.part, { force: true });
        const full = (error as NodeJS.ErrnoException).code === "ENOSPC" || (error as NodeJS.ErrnoException).code === "EDQUOT";
        throw new BridgeError(full ? "QUOTA_EXCEEDED" : "UNAVAILABLE", full ? "Not enough disk space" : `The export could not be written: ${error.message}`);
      };
      if (entry.failed) return fail(entry.failed);
      await new Promise<void>((done, reject) => entry.stream.write(bytes, (error) => (error ? reject(error) : done()))).catch(fail);
    },
    async exportFinish(token: string): Promise<FileHandle> {
      const entry = exports.get(token);
      if (!entry) throw new BridgeError("NOT_FOUND", "No export is open for this file");
      exports.delete(token);
      await new Promise<void>((done, reject) => entry.stream.end((error?: Error | null) => (error ? reject(error) : done())));
      if (entry.failed) { await rm(entry.part, { force: true }); throw new BridgeError("UNAVAILABLE", `The export could not be written: ${entry.failed.message}`); }
      await rename(entry.part, entry.final);
      return register(entry.final);
    },
    /** Cancel or failure: the partial file goes and the destination is never created. */
    async exportAbort(token: string): Promise<void> {
      const entry = exports.get(token);
      if (!entry) return;
      exports.delete(token);
      await new Promise<void>((done) => { entry.stream.once("close", () => done()); entry.stream.destroy(); });
      await rm(entry.part, { force: true });
    },
    async abortAll(): Promise<void> { for (const token of [...exports.keys()]) await this.exportAbort(token); },
  };
}
export type FileAccess = ReturnType<typeof createFileAccess>;
