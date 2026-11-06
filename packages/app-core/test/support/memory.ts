// The real storage port over in-memory record and file primitives: IndexedDB, OPFS and SQLite do not run in a test process.
import { createStoragePort, StorageError, type FileStore, type RecordStore, type StoragePort } from "@jagentchill/storage";

export type MemoryStorage = StoragePort & { failWrites: (kind: "QuotaExceeded" | "Unavailable" | null, match?: (store: string, key: string) => boolean) => void; free: { bytes: number | null }; files: Map<string, Uint8Array>; raw: RecordStore };
export function memoryStorage(now: () => number = Date.now): MemoryStorage {
  const stores = new Map<string, Map<string, unknown>>();
  const files = new Map<string, Uint8Array>();
  const free = { bytes: null as number | null };
  let failing: { kind: "QuotaExceeded" | "Unavailable"; match: (store: string, key: string) => boolean } | null = null;
  const of = (store: string) => { let map = stores.get(store); if (!map) { map = new Map(); stores.set(store, map); } return map; };
  const records: RecordStore = {
    get: async (store, key) => structuredClone(of(store).get(key)),
    put: async (store, key, value) => { if (failing?.match(store, key)) throw new StorageError(failing.kind, "write refused"); of(store).set(key, structuredClone(value)); },
    delete: async (store, key) => { of(store).delete(key); },
    keys: async (store, prefix = "") => [...of(store).keys()].filter((key) => key.startsWith(prefix)),
  };
  const fileStore: FileStore = {
    write: async (path, bytes) => { files.set(path, bytes.slice()); },
    read: async (path) => { const bytes = files.get(path); if (!bytes) throw new StorageError("NotFound", `no file at ${path}`); return bytes.slice(); },
    remove: async (path) => { files.delete(path); },
    removeTree: async (prefix) => { for (const path of [...files.keys()]) if (path === prefix || path.startsWith(`${prefix}/`)) files.delete(path); },
    move: async (from, to) => { const bytes = files.get(from); if (!bytes) throw new StorageError("NotFound", `no file at ${from}`); files.set(to, bytes); files.delete(from); },
    list: async (prefix) => [...files.entries()].filter(([path]) => path.startsWith(`${prefix}/`)).map(([path, bytes]) => ({ path, size: bytes.length, modified_ms: 0 })),
    available: async () => free.bytes,
  };
  return Object.assign(createStoragePort("web", records, fileStore, { now }), {
    failWrites: (kind: "QuotaExceeded" | "Unavailable" | null, match: (store: string, key: string) => boolean = () => true) => { failing = kind ? { kind, match } : null; },
    free, files, raw: records,
  });
}
/** Deterministic lowercase UUID v4 values. */
export function idSource(): () => string {
  let next = 0;
  return () => { const hex = (++next).toString(16).padStart(12, "0"); return `00000000-0000-4000-8000-${hex}`; };
}
