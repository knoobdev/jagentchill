import { COVERS_VERSION } from "./covers.gen.ts";

const PREFIX = "jagentchill-templates-", CACHE = `${PREFIX}${COVERS_VERSION}`;
let opened: Promise<Cache> | null = null;
/** The cache of this version of the files; the caches of earlier versions are dropped when it is first opened. */
function openCache(): Promise<Cache> {
  opened ??= (async () => {
    for (const name of await caches.keys()) if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name);
    return caches.open(CACHE);
  })();
  return opened;
}
/**
 * The bytes of a static file of the app (a starter template's cover or preview), cache first: the first time it is
 * fetched and kept in Cache Storage; from then on it is read from there and no request is made for it, so the gallery
 * shows its covers, plays its previews and copies a starter with the network off. The cache is named by the hash of
 * the shipped files (`covers.gen.ts`), so a new version of the app fetches its own. `null` when the browser has no
 * Cache Storage or the file cannot be had.
 */
export async function keptBytes(path: string): Promise<ArrayBuffer | null> {
  if (typeof caches === "undefined") return null;
  const cache = await openCache();
  let response = await cache.match(path);
  if (!response) {
    const fetched = await fetch(path);
    // A host that answers an unknown path with its page is not answering with the file.
    if (!fetched.ok || (fetched.headers.get("content-type") ?? "").includes("text/html")) return null;
    await cache.put(path, fetched.clone());
    response = fetched;
  }
  return response.arrayBuffer();
}
