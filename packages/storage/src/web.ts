import { StorageError, toStorageError } from "./errors.ts";
import { createStoragePort, type StoragePort } from "./port.ts";
import { STREAM_CHUNK_BYTES, type ByteSource } from "./hash.ts";
import { DURABLE_STORES, INDEX_STORES, type FileEntry, type FileStore, type RecordStore } from "./primitives.ts";

/** The parts of the browser the web store uses; injected so that the store is testable outside a browser. */
export type WebEnvironment = {
  indexedDB?: IDBFactory;
  storage?: { getDirectory?: () => Promise<FileSystemDirectoryHandle>; estimate?: () => Promise<{ quota?: number; usage?: number }> };
};
const DATABASE = "jagentchill";
/** Raised whenever a record store is added; the upgrade only ever creates the stores that are missing. */
const DATABASE_VERSION = 2;
const request = <T>(run: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => { run.onsuccess = () => resolve(run.result); run.onerror = () => reject(run.error); });

/** Records in IndexedDB: one object store per record store, string keys. */
export async function openIndexedDbRecords(factory: IDBFactory, name = DATABASE): Promise<RecordStore & { close(): void }> {
  const opening = factory.open(name, DATABASE_VERSION);
  opening.onupgradeneeded = () => { for (const store of [...DURABLE_STORES, ...INDEX_STORES]) if (!opening.result.objectStoreNames.contains(store)) opening.result.createObjectStore(store); };
  const db = await request(opening);
  const run = async <T>(store: string, mode: IDBTransactionMode, work: (objects: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    try {
      const transaction = db.transaction(store, mode);
      const done = new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error); transaction.onerror = () => reject(transaction.error); });
      const result = await request(work(transaction.objectStore(store)));
      // A write is acknowledged only when its transaction has committed.
      await done;
      return result;
    } catch (error) { throw toStorageError(error); }
  };
  return {
    get: (store, key) => run(store, "readonly", (objects) => objects.get(key)),
    put: async (store, key, value) => { await run(store, "readwrite", (objects) => objects.put(value, key)); },
    delete: async (store, key) => { await run(store, "readwrite", (objects) => objects.delete(key)); },
    keys: async (store, prefix = "") => ((await run(store, "readonly", (objects) => objects.getAllKeys())) as string[]).filter((key) => key.startsWith(prefix)),
    close: () => db.close(),
  };
}

type Directory = FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> };
/** Files in the Origin Private File System. `createWritable` commits on close, so a reader never sees a partial file. */
export function opfsFiles(root: FileSystemDirectoryHandle, estimate?: () => Promise<{ quota?: number; usage?: number }>): FileStore {
  const segments = (path: string) => path.split("/").filter(Boolean);
  const directory = async (parts: string[], create: boolean): Promise<FileSystemDirectoryHandle> => {
    let current = root;
    for (const part of parts) current = await current.getDirectoryHandle(part, { create });
    return current;
  };
  const guard = async <T>(run: () => Promise<T>): Promise<T> => { try { return await run(); } catch (error) { throw toStorageError(error); } };
  const write = async (path: string, bytes: Uint8Array) => {
    const parts = segments(path), name = parts.pop()!;
    const handle = await (await directory(parts, true)).getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    try { await writable.write(bytes as unknown as BufferSource); await writable.close(); } catch (error) { await writable.abort?.().catch(() => undefined); throw error; }
  };
  const handleOf = async (path: string) => { const parts = segments(path), name = parts.pop()!; return (await directory(parts, false)).getFileHandle(name); };
  const writeStream = async (path: string, source: ByteSource) => {
    const parts = segments(path), name = parts.pop()!;
    const handle = await (await directory(parts, true)).getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    let written = 0;
    // Nothing is visible under the name until close(): a failed stream leaves the previous file, or none.
    try { for await (const chunk of source) { await writable.write(chunk as unknown as BufferSource); written += chunk.length; } await writable.close(); } catch (error) { await writable.abort?.().catch(() => undefined); throw error; }
    return written;
  };
  async function* readStream(path: string, range: { start?: number; end?: number } = {}): AsyncGenerator<Uint8Array> {
    let file: File;
    try { file = await (await handleOf(path)).getFile(); } catch (error) { throw toStorageError(error); }
    const end = Math.min(range.end ?? file.size, file.size);
    for (let offset = range.start ?? 0; offset < end; offset += STREAM_CHUNK_BYTES) yield new Uint8Array(await file.slice(offset, Math.min(end, offset + STREAM_CHUNK_BYTES)).arrayBuffer());
  }
  const read = async (path: string) => {
    const parts = segments(path), name = parts.pop()!;
    const file = await (await (await directory(parts, false)).getFileHandle(name)).getFile();
    return new Uint8Array(await file.arrayBuffer());
  };
  const remove = async (path: string, recursive = false) => {
    const parts = segments(path), name = parts.pop()!;
    try { await (await directory(parts, false)).removeEntry(name, { recursive }); } catch (error) { if (toStorageError(error).kind !== "NotFound") throw error; }
  };
  async function walk(handle: FileSystemDirectoryHandle, prefix: string, out: FileEntry[]): Promise<void> {
    for await (const [name, entry] of (handle as Directory).entries()) {
      if (entry.kind === "directory") await walk(entry as FileSystemDirectoryHandle, `${prefix}/${name}`, out);
      else { const file = await (entry as FileSystemFileHandle).getFile(); out.push({ path: `${prefix}/${name}`, size: file.size, modified_ms: file.lastModified }); }
    }
  }
  return {
    write: (path, bytes) => guard(() => write(path, bytes)),
    read: (path) => guard(() => read(path)),
    writeStream: (path, source) => guard(() => writeStream(path, source)),
    readStream,
    stat: (path) => guard(async () => { try { const file = await (await handleOf(path)).getFile(); return { path, size: file.size, modified_ms: file.lastModified }; } catch (error) { if (toStorageError(error).kind === "NotFound") return undefined; throw error; } }),
    remove: (path) => guard(() => remove(path)),
    removeTree: (prefix) => guard(() => remove(prefix, true)),
    // The private file system has no portable rename: the bytes are written at the new path, then the old entry goes.
    move: (from, to) => guard(async () => { await writeStream(to, readStream(from)); await remove(from); }),
    list: (prefix) => guard(async () => {
      const out: FileEntry[] = [];
      try { await walk(await directory(segments(prefix), false), segments(prefix).join("/"), out); } catch (error) { if (toStorageError(error).kind !== "NotFound") throw error; }
      return out;
    }),
    available: async () => {
      const result = await estimate?.().catch(() => undefined);
      return result && typeof result.quota === "number" && typeof result.usage === "number" ? Math.max(0, result.quota - result.usage) : null;
    },
  };
}

/** The message of the blocking screen shown when the browser provides no IndexedDB or no private file system. */
export const WEB_STORAGE_UNAVAILABLE = "Storage is not available in this browser mode";

/**
 * The web store: records in IndexedDB, media files, thumbnails and covers in the Origin Private File System.
 * Throws `Unavailable` — and creates nothing — when the browser provides no IndexedDB or no OPFS (a private mode).
 */
export async function openWebStorage(environment: WebEnvironment = { indexedDB: globalThis.indexedDB, storage: globalThis.navigator?.storage }): Promise<StoragePort & { close(): void }> {
  if (!environment.indexedDB || !environment.storage?.getDirectory) throw new StorageError("Unavailable", WEB_STORAGE_UNAVAILABLE);
  let root: FileSystemDirectoryHandle;
  try { root = await environment.storage.getDirectory(); } catch { throw new StorageError("Unavailable", WEB_STORAGE_UNAVAILABLE); }
  let records: Awaited<ReturnType<typeof openIndexedDbRecords>>;
  try { records = await openIndexedDbRecords(environment.indexedDB); } catch { throw new StorageError("Unavailable", WEB_STORAGE_UNAVAILABLE); }
  const estimate = environment.storage.estimate?.bind(environment.storage);
  return Object.assign(createStoragePort("web", records, opfsFiles(root, estimate)), { close: () => records.close() });
}
