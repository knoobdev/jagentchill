import { StorageError, toStorageError } from "./errors.ts";
import { chunksOf, type ByteSource } from "./hash.ts";
import type { FileStore, RecordStore } from "./primitives.ts";

/** Every kind of derived data. All of it is reproducible from originals; none of it is project data. */
export const CACHE_KINDS = ["proxy", "filmstrip", "thumbnail", "waveform", "render", "font-atlas", "stock-preview", "ai-result", "slow-motion", "reverse", "derived-audio"] as const;
export type CacheKind = (typeof CACHE_KINDS)[number];
/** The cache rows of the storage page. Kinds without a row of their own are render-side caches. */
export const CACHE_CATEGORIES = ["Proxies", "Thumbnails and filmstrips", "Waveforms", "Render cache", "AI results"] as const;
export type CacheCategory = (typeof CACHE_CATEGORIES)[number];
export const CACHE_CATEGORY_OF: Record<CacheKind, CacheCategory> = {
  proxy: "Proxies", filmstrip: "Thumbnails and filmstrips", thumbnail: "Thumbnails and filmstrips", waveform: "Waveforms",
  render: "Render cache", "font-atlas": "Render cache", "stock-preview": "Render cache", "slow-motion": "Render cache", reverse: "Render cache", "derived-audio": "Render cache",
  "ai-result": "AI results",
};

const MiB = 1024 * 1024, GiB = 1024 * MiB;
/** One budget for the whole cache; no other capability defines one. */
export const DEFAULT_CACHE_BUDGET: Record<"web" | "desktop" | "mobile", number> = { desktop: 10 * GiB, web: 2 * GiB, mobile: 1 * GiB };
export const CACHE_BUDGET_MIN = 256 * MiB, CACHE_BUDGET_MAX = 100 * GiB;
export const clampCacheBudget = (bytes: number): number => Math.min(CACHE_BUDGET_MAX, Math.max(CACHE_BUDGET_MIN, Math.round(bytes)));

export type CacheKey = { kind: CacheKind; contentHash: string; variant?: string };
type CacheIndexEntry = { size: number; used_ms: number; projects: string[] };
export type CacheUsage = { total: number; byKind: Record<CacheKind, number>; byCategory: Record<CacheCategory, number>; byProject: Record<string, number> };

export interface CacheStore {
  /** Stores a derived entry. Least recently used entries go when the budget is exceeded; the new entry is never the one evicted. */
  put(key: CacheKey, data: Uint8Array | ByteSource, options?: { projectId?: string }): Promise<number>;
  /** The entry's bytes, or `undefined` when it is not cached (never written, evicted, or purged by the operating system). */
  get(key: CacheKey): Promise<Uint8Array | undefined>;
  stream(key: CacheKey, range?: { start?: number; end?: number }): AsyncIterable<Uint8Array>;
  has(key: CacheKey): Promise<boolean>;
  /** Marks entries as in use (the open project's visible range, a running job): they are not evicted until released. */
  hold(keys: CacheKey[]): () => void;
  /** Releases at least `bytes` of evictable cache, least recently used first; resolves to the bytes freed. */
  evict(bytes: number): Promise<number>;
  enforceBudget(): Promise<number>;
  /** "Clear" of one category, or "Clear all caches". Originals, records, snapshots and backups are never touched. */
  clear(category?: CacheCategory): Promise<number>;
  /** Drops what only this project used (a trashed or deleted project releases its caches immediately). */
  releaseProject(projectId: string): Promise<number>;
  usage(): Promise<CacheUsage>;
  budget(): Promise<number>;
  setBudget(bytes: number): Promise<number>;
  /** Bytes the next eviction could free. */
  evictable(): Promise<number>;
  /** Recreates the index from the cache files (the index was lost, or the operating system purged the directory). */
  rebuild(): Promise<void>;
}

const INDEX = "index:cache", BUDGET_KEY = "cache-budget";
const idOf = (key: CacheKey) => `${key.kind}/${key.contentHash}/${key.variant ?? "default"}`;
const pathOf = (id: string) => `cache/${id}`;
const isSource = (data: Uint8Array | ByteSource): data is ByteSource => !(data instanceof Uint8Array);

/** The one cache store of a device: files outside project data, an index that is derived from them, one budget. */
export function createCacheStore(platform: "web" | "desktop" | "mobile", records: RecordStore, files: FileStore, now: () => number = Date.now): CacheStore {
  const held = new Map<string, number>();
  const guard = async <T>(run: () => Promise<T>): Promise<T> => { try { return await run(); } catch (error) { throw toStorageError(error); } };
  const entries = async (): Promise<[string, CacheIndexEntry][]> => Promise.all((await records.keys(INDEX)).map(async (id) => [id, (await records.get(INDEX, id)) as CacheIndexEntry] as [string, CacheIndexEntry]));
  const drop = async (id: string): Promise<void> => { await files.remove(pathOf(id)).catch(() => undefined); await records.delete(INDEX, id); };
  const budget = async () => { const stored = await records.get("session", BUDGET_KEY); return typeof stored === "number" ? clampCacheBudget(stored) : DEFAULT_CACHE_BUDGET[platform]; };

  async function evict(bytes: number, keep?: string): Promise<number> {
    if (bytes <= 0) return 0;
    const candidates = (await entries()).filter(([id]) => id !== keep && !held.has(id)).sort((a, b) => a[1].used_ms - b[1].used_ms || (a[0] < b[0] ? -1 : 1));
    let freed = 0;
    for (const [id, entry] of candidates) { if (freed >= bytes) break; await drop(id); freed += entry.size; }
    return freed;
  }
  const enforce = async (keep?: string) => { const total = (await entries()).reduce((sum, [, entry]) => sum + entry.size, 0); return evict(total - (await budget()), keep); };

  const store: CacheStore = {
    put: (key, data, options = {}) => guard(async () => {
      const id = idOf(key), previous = (await records.get(INDEX, id)) as CacheIndexEntry | undefined;
      const size = await files.writeStream(pathOf(id), isSource(data) ? data : chunksOf(data));
      const projects = [...new Set([...(previous?.projects ?? []), ...(options.projectId ? [options.projectId] : [])])];
      await records.put(INDEX, id, { size, used_ms: now(), projects });
      await enforce(id);
      return size;
    }),
    get: (key) => guard(async () => {
      const id = idOf(key), entry = (await records.get(INDEX, id)) as CacheIndexEntry | undefined;
      if (!entry) return undefined;
      try {
        const bytes = await files.read(pathOf(id));
        await records.put(INDEX, id, { ...entry, used_ms: now() });
        return bytes;
      } catch (error) {
        // The file is gone (the operating system purged the cache directory): the entry is regenerated on demand.
        if (toStorageError(error).kind !== "NotFound") throw error;
        await records.delete(INDEX, id);
        return undefined;
      }
    }),
    stream: async function* (key, range) {
      const id = idOf(key), entry = (await records.get(INDEX, id)) as CacheIndexEntry | undefined;
      if (!entry) throw new StorageError("NotFound", `cache entry "${id}" does not exist`);
      await records.put(INDEX, id, { ...entry, used_ms: now() });
      yield* files.readStream(pathOf(id), range);
    },
    has: (key) => guard(async () => (await records.get(INDEX, idOf(key))) !== undefined),
    hold(keys) {
      const ids = keys.map(idOf);
      for (const id of ids) held.set(id, (held.get(id) ?? 0) + 1);
      let released = false;
      return () => { if (released) return; released = true; for (const id of ids) { const count = (held.get(id) ?? 1) - 1; if (count <= 0) held.delete(id); else held.set(id, count); } };
    },
    evict: (bytes) => guard(() => evict(bytes)),
    enforceBudget: () => guard(() => enforce()),
    clear: (category) => guard(async () => {
      let freed = 0;
      for (const [id, entry] of await entries()) if (!category || CACHE_CATEGORY_OF[id.slice(0, id.indexOf("/")) as CacheKind] === category) { await drop(id); freed += entry.size; }
      return freed;
    }),
    releaseProject: (projectId) => guard(async () => {
      let freed = 0;
      for (const [id, entry] of await entries()) {
        if (!entry.projects.includes(projectId)) continue;
        const projects = entry.projects.filter((owner) => owner !== projectId);
        if (projects.length === 0) { await drop(id); freed += entry.size; } else await records.put(INDEX, id, { ...entry, projects });
      }
      return freed;
    }),
    usage: () => guard(async () => {
      const usage: CacheUsage = { total: 0, byKind: Object.fromEntries(CACHE_KINDS.map((kind) => [kind, 0])) as Record<CacheKind, number>, byCategory: Object.fromEntries(CACHE_CATEGORIES.map((category) => [category, 0])) as Record<CacheCategory, number>, byProject: {} };
      for (const [id, entry] of await entries()) {
        const kind = id.slice(0, id.indexOf("/")) as CacheKind;
        usage.total += entry.size;
        usage.byKind[kind] = (usage.byKind[kind] ?? 0) + entry.size;
        usage.byCategory[CACHE_CATEGORY_OF[kind]] += entry.size;
        for (const projectId of entry.projects) usage.byProject[projectId] = (usage.byProject[projectId] ?? 0) + entry.size;
      }
      return usage;
    }),
    budget: () => guard(budget),
    setBudget: (bytes) => guard(async () => { const value = clampCacheBudget(bytes); await records.put("session", BUDGET_KEY, value); await enforce(); return value; }),
    evictable: () => guard(async () => (await entries()).filter(([id]) => !held.has(id)).reduce((sum, [, entry]) => sum + entry.size, 0)),
    rebuild: () => guard(async () => {
      const known = new Map(await entries());
      const present = new Set<string>();
      for (const file of await files.list("cache")) {
        const id = file.path.slice("cache/".length);
        if (!(CACHE_KINDS as readonly string[]).includes(id.slice(0, id.indexOf("/")))) continue;
        present.add(id);
        await records.put(INDEX, id, { size: file.size, used_ms: known.get(id)?.used_ms ?? file.modified_ms, projects: known.get(id)?.projects ?? [] });
      }
      for (const id of known.keys()) if (!present.has(id)) await records.delete(INDEX, id);
    }),
  };
  return store;
}
