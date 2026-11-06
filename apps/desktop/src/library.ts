import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, watch, type FSWatcher } from "node:fs";
import { appendFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { LIBRARY_METHODS, LIBRARY_RANGE_METHODS, checkLibraryCall, type LibraryStatus } from "@jagentchill/desktop-core";
import { StorageError, storageString, toStorageError } from "@jagentchill/storage";
import { canCreateLibraryAt, inspectLibraryLocation, openDesktopStorage, readFileRange, type DesktopStorage, type MoveResult } from "@jagentchill/storage/desktop";
import type { Settings } from "./settings.ts";

export class BridgeError extends Error {
  readonly code: string;
  readonly kind?: string;
  readonly details?: Record<string, unknown>;
  constructor(code: string, message: string, extra: { kind?: string; details?: Record<string, unknown> } = {}) {
    super(message);
    this.code = code;
    this.kind = extra.kind;
    this.details = extra.details;
  }
}
/** A storage error crosses the bridge with its kind, so that the renderer raises the same error the web store would. */
const storageFailure = (error: unknown): BridgeError => {
  const mapped = toStorageError(error);
  return new BridgeError("STORAGE", mapped.message, { kind: mapped.kind, details: mapped.details });
};

/**
 * The project library on desktop: a folder the user sees and may move. The store, its SQLite index and every file
 * handle live here in the main process; the renderer names projects and assets by id and never a path.
 */
export function createLibraryService(deps: {
  settings: Settings; defaultLibrary: string; cache: string;
  onStatus(status: LibraryStatus): void; onMoveProgress(progress: unknown): void; onChanged(): void;
}) {
  let storage: DesktopStorage | null = null;
  let status: LibraryStatus = { state: "opening" };
  let rebuilding: string | null = null;
  let watcher: FSWatcher | null = null;
  let moveSignal: { aborted: boolean } | null = null;
  const uploads = new Map<string, string>();
  const holds = new Map<string, () => void>();
  let ownWrites = 0;
  const path = () => deps.settings.get<string>("libraryPath") ?? deps.defaultLibrary;

  const publish = (next: LibraryStatus) => { status = next; deps.onStatus(next); };
  const ready = () => {
    if (storage) publish({ state: "ready", path: storage.library, readOnly: storage.readOnly, banner: storage.banner, rebuilding, indexRebuilt: storage.indexRebuilt });
  };
  /** Files changed by another process (a project copied in with the file manager) are announced to the windows. */
  function watchLibrary(folder: string): void {
    watcher?.close();
    watcher = null;
    let timer: NodeJS.Timeout | null = null;
    try {
      watcher = watch(folder, { recursive: process.platform !== "linux" }, (_event, file) => {
        const name = String(file ?? "");
        if (ownWrites > 0 || name.startsWith("library.") || name.endsWith(".tmp") || name.includes(".tmp")) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => deps.onChanged(), 500);
      });
      watcher.on("error", () => undefined);
    } catch { /* a volume without change notification: the library still works */ }
  }
  async function openAt(folder: string): Promise<void> {
    storage?.close();
    storage = null;
    publish({ state: "opening" });
    mkdirSync(deps.cache, { recursive: true });
    storage = await openDesktopStorage({
      library: folder, cache: deps.cache,
      onStatus: (message) => { rebuilding = message; if (storage) ready(); else publish({ state: "ready", path: folder, readOnly: false, banner: null, rebuilding, indexRebuilt: true }); },
    });
    rebuilding = null;
    deps.settings.set("libraryPath", folder);
    deps.settings.set("libraryUsed", true);
    watchLibrary(folder);
    ready();
  }
  /** At start: a library that was used before and is not there blocks with a choice; nothing is created or shown as deleted. */
  async function open(): Promise<void> {
    const folder = path();
    const location = inspectLibraryLocation(folder, { usedBefore: deps.settings.get<boolean>("libraryUsed") === true });
    if (location.status === "missing") return publish({ state: "blocked", path: folder, message: location.message, reason: "missing", actions: location.actions });
    if (location.status === "new" && !canCreateLibraryAt(folder)) {
      return publish({
        state: "blocked", path: folder, message: storageString("libraryNotFound", { path: folder }), reason: "not-writable",
        actions: [{ id: "retry", label: storageString("retry"), enabled: true }, { id: "locate", label: storageString("locateLibrary"), enabled: true }, { id: "create", label: storageString("createLibraryHere"), enabled: false }, { id: "quit", label: storageString("quit"), enabled: true }],
      });
    }
    try { await openAt(folder); } catch (error) {
      publish({ state: "blocked", path: folder, message: storageString("libraryNotFound", { path: folder }), reason: (error as Error).message, actions: [
        { id: "retry", label: storageString("retry"), enabled: true }, { id: "locate", label: storageString("locateLibrary"), enabled: true },
        { id: "create", label: storageString("createLibraryHere"), enabled: canCreateLibraryAt(folder) }, { id: "quit", label: storageString("quit"), enabled: true },
      ] });
    }
  }
  const need = (): DesktopStorage => {
    if (!storage) throw new BridgeError("STORAGE", "The project library is not open", { kind: "Unavailable", details: { reason: "library-not-open" } });
    return storage;
  };
  const target = (method: string): { owner: any; name: string } => (method.startsWith("cache.") ? { owner: need().cache, name: method.slice(6) } : { owner: need(), name: method });
  async function* uploaded(id: string): AsyncGenerator<Uint8Array> {
    const file = uploads.get(id);
    if (!file) throw new BridgeError("STORAGE", "The upload does not exist", { kind: "NotFound" });
    try { if (existsSync(file)) yield* readFileRange(file); } finally { uploads.delete(id); await rm(file, { force: true }); }
  }

  return {
    status: () => status,
    storage: () => storage,
    open,
    /** One operation of the storage port, by name. The method table and the kinds of its arguments are checked first. */
    async call(method: string, args: unknown[]): Promise<unknown> {
      const checked = checkLibraryCall(method, args);
      if (!checked.ok) throw new BridgeError(checked.code, checked.message);
      const { owner, name } = target(method);
      const kinds = LIBRARY_METHODS[method];
      const values = args.map((value, index) => (kinds[index] === "upload" ? uploaded((value as { upload: string }).upload) : value));
      ownWrites++;
      try {
        if (method === "cache.hold") {
          const id = randomBytes(16).toString("hex");
          holds.set(id, owner.hold(values[0]));
          return id;
        }
        return await owner[name === "putStream" ? "put" : name](...values);
      } catch (error) { throw storageFailure(error); } finally { setTimeout(() => { ownWrites--; }, 800); }
    },
    /** A piece of a streamed read: at most 4 MiB a call, so that nothing large is ever held whole. */
    async readRange(method: string, args: unknown[], range: { start: number; end: number }): Promise<Uint8Array> {
      const checked = checkLibraryCall(method, args, LIBRARY_RANGE_METHODS);
      if (!checked.ok) throw new BridgeError(checked.code, checked.message);
      if (range.end < range.start || range.end - range.start > 4 * 1024 * 1024) throw new BridgeError("LIBRARY_ARGUMENT_REJECTED", "a read is at most 4 MiB");
      const { owner, name } = target(method === "readMediaStream" ? method : "cache.stream");
      const parts: Buffer[] = [];
      try { for await (const part of owner[name](...args, range) as AsyncIterable<Uint8Array>) parts.push(Buffer.from(part.buffer, part.byteOffset, part.byteLength)); } catch (error) { throw storageFailure(error); }
      return new Uint8Array(Buffer.concat(parts));
    },
    release(id: string): void { holds.get(id)?.(); holds.delete(id); },
    /** A streamed write arrives in pieces and waits in a temporary file of the cache directory, never in memory. */
    uploadOpen(): string {
      const id = randomBytes(16).toString("hex");
      mkdirSync(join(deps.cache, "uploads"), { recursive: true });
      uploads.set(id, join(deps.cache, "uploads", `${id}.part`));
      return id;
    },
    async uploadWrite(id: string, bytes: Uint8Array): Promise<void> {
      const file = uploads.get(id);
      if (!file) throw new BridgeError("STORAGE", "The upload does not exist", { kind: "NotFound" });
      try { await appendFile(file, bytes); } catch (error) { throw storageFailure(error); }
    },
    async uploadAbort(id: string): Promise<void> { const file = uploads.get(id); uploads.delete(id); if (file) await rm(file, { force: true }); },
    /** "Locate library…": the store is opened on the folder the user chose. */
    async useFolder(folder: string): Promise<void> { try { await openAt(folder); } catch (error) { await open(); throw storageFailure(error); } },
    /** "Create a new library here": an empty library at the configured path. */
    async createHere(): Promise<void> {
      const folder = path();
      if (!canCreateLibraryAt(folder)) throw new BridgeError("STORAGE", storageString("libraryNotFound", { path: folder }), { kind: "Unavailable" });
      await openAt(folder);
    },
    /** Copy, verify, switch, delete. Failure or cancellation leaves the old library in use: "The library was not moved". */
    async move(destination: string): Promise<MoveResult> {
      const current = need();
      moveSignal = { aborted: false };
      watcher?.close();
      watcher = null;
      try {
        const result = await current.moveTo(destination, {
          signal: moveSignal, onProgress: (progress) => deps.onMoveProgress(progress),
          persist: async (library) => { deps.settings.set("libraryPath", library); },
        });
        if (result.moved && result.storage) { storage = result.storage; watchLibrary(storage.library); ready(); }
        else { watchLibrary(current.library); ready(); }
        const { storage: _next, ...plain } = result as MoveResult & { storage?: DesktopStorage };
        return plain as MoveResult;
      } finally { moveSignal = null; }
    },
    cancelMove(): void { if (moveSignal) moveSignal.aborted = true; },
    async rebuildIndex(): Promise<void> { try { await need().dropAndRebuildIndex(); } catch (error) { throw storageFailure(error); } ready(); },
    close(): void { watcher?.close(); for (const release of holds.values()) release(); storage?.close(); storage = null; },
  };
}
export type LibraryService = ReturnType<typeof createLibraryService>;
export { StorageError };
