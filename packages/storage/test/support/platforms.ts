import { mkdtempSync, rmSync } from "node:fs";
import { appendFile, mkdir, open, readdir, readFile, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { IDBFactory } from "fake-indexeddb";
import { openDesktopStorage } from "../../src/desktop.ts";
import { openMobileStorage, openWebStorage, type FileDriver, type FileEntry, type SqlDriver, type StoragePort, type WebEnvironment } from "../../src/index.ts";

/** An in-memory Origin Private File System: the handle methods the web store calls, nothing else. */
type Node = { kind: "directory"; children: Map<string, Node> } | { kind: "file"; bytes: Uint8Array; modified: number };
const notFound = () => Object.assign(new Error("A requested file or directory could not be found"), { name: "NotFoundError" });
function directoryHandle(node: Extract<Node, { kind: "directory" }>, name = ""): any {
  return {
    kind: "directory", name,
    async getDirectoryHandle(child: string, options: { create?: boolean } = {}) {
      let found = node.children.get(child);
      if (!found) { if (!options.create) throw notFound(); found = { kind: "directory", children: new Map() }; node.children.set(child, found); }
      if (found.kind !== "directory") throw Object.assign(new Error("type mismatch"), { name: "TypeMismatchError" });
      return directoryHandle(found, child);
    },
    async getFileHandle(child: string, options: { create?: boolean } = {}) {
      let found = node.children.get(child);
      if (!found) { if (!options.create) throw notFound(); found = { kind: "file", bytes: new Uint8Array(), modified: Date.now() }; node.children.set(child, found); }
      const file = found as Extract<Node, { kind: "file" }>;
      return {
        kind: "file", name: child,
        async getFile() {
          const view = (bytes: Uint8Array): any => ({ size: bytes.length, lastModified: file.modified, arrayBuffer: async () => bytes.slice().buffer, slice: (start = 0, end = bytes.length) => view(bytes.subarray(start, end)) });
          return view(file.bytes);
        },
        async createWritable() {
          // Like the real one, nothing is visible until close().
          let pending = new Uint8Array();
          return { async write(bytes: Uint8Array) { const next = new Uint8Array(pending.length + bytes.length); next.set(pending); next.set(bytes, pending.length); pending = next; }, async close() { file.bytes = pending; file.modified = Date.now(); }, async abort() { /* nothing was committed */ } };
        },
      };
    },
    async removeEntry(child: string, options: { recursive?: boolean } = {}) {
      const found = node.children.get(child);
      if (!found) throw notFound();
      if (found.kind === "directory" && found.children.size > 0 && !options.recursive) throw Object.assign(new Error("not empty"), { name: "InvalidModificationError" });
      node.children.delete(child);
    },
    async *entries() { for (const [child, found] of node.children) yield [child, found.kind === "directory" ? directoryHandle(found, child) : await this.getFileHandle(child)]; },
  };
}
export function fakeBrowser(estimate: { quota: number; usage: number } | null = { quota: 10 * 2 ** 30, usage: 0 }): WebEnvironment & { opfs: Extract<Node, { kind: "directory" }>; indexedDB: IDBFactory } {
  const opfs: Extract<Node, { kind: "directory" }> = { kind: "directory", children: new Map() };
  return { opfs, indexedDB: new IDBFactory(), storage: { getDirectory: async () => directoryHandle(opfs), ...(estimate ? { estimate: async () => estimate } : {}) } };
}

/** The mobile store's two drivers on Node: the same SQL through `node:sqlite`, the same file calls through `node:fs`. */
export function nodeSqlDriver(path = ":memory:"): SqlDriver {
  const database = new DatabaseSync(path);
  return {
    run: async (sql, params = []) => { database.prepare(sql).run(...params); },
    all: async <Row>(sql: string, params: (string | number | null)[] = []) => database.prepare(sql).all(...params) as Row[],
  };
}
export function nodeFileDriver(root: string): FileDriver {
  const at = (path: string) => join(root, path);
  async function walk(directory: string, logical: string, out: FileEntry[]): Promise<void> {
    let names: string[];
    try { names = await readdir(directory); } catch { return; }
    for (const name of names) {
      const info = await stat(join(directory, name));
      if (info.isDirectory()) await walk(join(directory, name), `${logical}/${name}`, out); else out.push({ path: `${logical}/${name}`, size: info.size, modified_ms: Math.round(info.mtimeMs) });
    }
  }
  return {
    write: async (path, bytes) => { await mkdir(dirname(at(path)), { recursive: true }); await writeFile(at(path), bytes); },
    read: async (path) => new Uint8Array(await readFile(at(path))),
    remove: (path, recursive) => rm(at(path), { recursive, force: true }),
    move: async (from, to) => { await mkdir(dirname(at(to)), { recursive: true }); await rename(at(from), at(to)); },
    list: async (prefix) => { const out: FileEntry[] = []; await walk(at(prefix), prefix, out); return out; },
    freeBytes: async () => { const info = await statfs(root); return Number(info.bavail) * Number(info.bsize); },
    append: (path, bytes) => appendFile(at(path), bytes),
    readRange: async (path, position, length) => { const handle = await open(at(path), "r"); try { const buffer = new Uint8Array(length); const { bytesRead } = await handle.read(buffer, 0, length, position); return buffer.subarray(0, bytesRead); } finally { await handle.close(); } },
    info: async (path) => { try { const info = await stat(at(path)); return { path, size: info.size, modified_ms: Math.round(info.mtimeMs) }; } catch { return undefined; } },
  };
}

/** The directories this test file created, removed when the process ends — not earlier: a caller may make one inside a
 * `before()` hook and use it in every test of the file (an `after` registered there would run when the hook ends). */
const temporaryDirectories = new Set<string>();
const removeTemporaryDirectories = (): void => { for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true }); };
let exitHookRegistered = false;
export const temporaryDirectory = (label: string): string => {
  const directory = mkdtempSync(join(tmpdir(), `jc-${label}-`));
  temporaryDirectories.add(directory);
  if (!exitHookRegistered) { exitHookRegistered = true; process.on("exit", removeTemporaryDirectories); }
  return directory;
};
export type Platform = { name: string; open(): Promise<StoragePort>; reopen?: () => Promise<StoragePort> };
/** The three implementations of the storage port, each as it runs in a Node test process. */
export function platforms(): Platform[] {
  const browser = fakeBrowser();
  const library = temporaryDirectory("library"), cache = temporaryDirectory("cache");
  const documents = temporaryDirectory("mobile");
  return [
    { name: "web (IndexedDB + OPFS)", open: () => openWebStorage(browser) },
    { name: "desktop (library folder)", open: () => openDesktopStorage({ library, cache }) },
    { name: "mobile (SQLite + file system)", open: () => openMobileStorage(nodeSqlDriver(join(documents, "records.db")), nodeFileDriver(join(documents, "files"))) },
  ];
}
