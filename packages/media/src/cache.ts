/**
 * The cache store of `project-storage.Cache management` as this package needs it: filmstrip frames, waveform
 * summaries and proxies live here, keyed by content hash, evictable and rebuildable. The platform supplies it.
 */
export interface CacheStore {
  get(key: string): Promise<Uint8Array | undefined>;
  put(key: string, bytes: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
  /** Keys that start with `prefix`. */
  list(prefix: string): Promise<string[]>;
}
/** A cache held in memory, for surfaces that have no persistent cache store and for the engine's first run. */
export function memoryCache(): CacheStore & { readonly size: number } {
  const entries = new Map<string, Uint8Array>();
  return {
    get size() { return entries.size; },
    get: async (key) => entries.get(key),
    put: async (key, bytes) => { entries.set(key, bytes); },
    delete: async (key) => { entries.delete(key); },
    list: async (prefix) => [...entries.keys()].filter((key) => key.startsWith(prefix)),
  };
}
/** Drops every cache entry derived from one content hash: waveform, filmstrip frames, proxy and mezzanine. */
export async function purgeDerivedCaches(cache: CacheStore, contentHash: string): Promise<void> {
  for (const prefix of [`waveform/${contentHash}`, `filmstrip/${contentHash}/`, `proxy/${contentHash}`, `mezzanine/${contentHash}`]) {
    for (const key of await cache.list(prefix)) await cache.delete(key);
  }
}
