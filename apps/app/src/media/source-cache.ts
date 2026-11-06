/**
 * The bytes of each asset as this device reads them for the panel, the preview and an export, and the URL the engine
 * is given for them. An asset whose original is not on the device is read from its 720p proxy; when the ORIGINAL then
 * arrives (sync, "Download original") the proxy must not stay in use: `arrived` drops what was read from a proxy, so
 * that the next question is answered from the original, and moves `version` on — whoever handed a URL to an engine
 * sees by it that the URLs have to be asked for again. Pure: no React, no platform; tested with real blobs and URLs.
 */
export type SourceStore = {
  hasOriginal(assetId: string): Promise<boolean>;
  /** The original's bytes; asked only after `hasOriginal` said yes. */
  original(assetId: string): Promise<Blob>;
  /** The proxy's bytes, or null when the device has none. */
  proxy(assetId: string): Promise<Blob | null>;
};
export type SourceCache = ReturnType<typeof createSourceCache>;

export function createSourceCache(store: SourceStore, urlOf: (blob: Blob) => string, release: (url: string) => void) {
  const blobs = new Map<string, { blob: Blob; from: "handed" | "original" | "proxy" }>(), urls = new Map<string, string>();
  // A URL that was replaced may still be read by an engine for a moment: it is let go at the next replacement, or at the end.
  let retired: string[] = [], version = 0;
  // Counts the arrivals: a read that was on its way while one happened may hold a proxy whose original has just come.
  let arrivals = 0;
  const dropUrl = (assetId: string, later: boolean) => {
    const known = urls.get(assetId);
    if (known === undefined) return;
    urls.delete(assetId);
    if (later) retired.push(known); else release(known);
  };
  const cache = {
    /** A file handed over in this session (an import, a relink) is read from where it came. */
    hold(assetId: string, blob: Blob): void { blobs.set(assetId, { blob, from: "handed" }); dropUrl(assetId, false); },
    forget(assetId: string): void { blobs.delete(assetId); dropUrl(assetId, false); },
    async blob(assetId: string): Promise<Blob | null> {
      const held = blobs.get(assetId);
      if (held) return held.blob;
      let original: boolean, blob: Blob | null, seen: number;
      // A proxy (or nothing) read across an arrival is not kept: `arrived` could not drop what was not cached yet, so
      // the read asks for the original again. An arrival that comes after this point finds the entry and drops it.
      do {
        seen = arrivals;
        original = await store.hasOriginal(assetId).catch(() => false);
        blob = original ? await store.original(assetId) : await store.proxy(assetId).catch(() => null);
      } while (!original && seen !== arrivals && !blobs.has(assetId));
      if (!blob) return null;
      // Another reader may have answered meanwhile: one blob per asset, the original before a proxy.
      const now = blobs.get(assetId);
      if (now && (now.from !== "proxy" || !original)) return now.blob;
      blobs.set(assetId, { blob, from: original ? "original" : "proxy" });
      return blob;
    },
    async url(assetId: string): Promise<string | null> {
      const known = urls.get(assetId);
      if (known !== undefined) return known;
      const seen = version, blob = await cache.blob(assetId);
      if (!blob) return null;
      const again = urls.get(assetId);
      if (again !== undefined && seen === version) return again;
      const made = urlOf(blob);
      dropUrl(assetId, true);
      urls.set(assetId, made);
      return made;
    },
    /** Which file the asset is read from at the moment, when it was read at all. */
    readFrom: (assetId: string): "handed" | "original" | "proxy" | null => blobs.get(assetId)?.from ?? null,
    /**
     * Media arrived on the device: every asset that was read from its proxy and now has its original is read anew.
     * Answers the assets that changed; `version` has moved when there are any.
     */
    async arrived(): Promise<string[]> {
      const changed: string[] = [];
      arrivals += 1;
      for (const [assetId, held] of [...blobs]) {
        if (held.from !== "proxy" || !(await store.hasOriginal(assetId).catch(() => false))) continue;
        if (blobs.get(assetId) !== held) continue;
        if (changed.length === 0) { for (const url of retired) release(url); retired = []; }
        blobs.delete(assetId);
        dropUrl(assetId, true);
        changed.push(assetId);
      }
      if (changed.length > 0) version += 1;
      return changed;
    },
    /** Moves on whenever URLs that were handed out are no longer the ones to use. */
    version: (): number => version,
    clear(): void {
      for (const url of [...urls.values(), ...retired]) release(url);
      urls.clear(); blobs.clear(); retired = [];
    },
  };
  return cache;
}
