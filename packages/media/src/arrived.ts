import type { ProjectDocument } from "@jagentchill/protocol";
import { localAssetOf, setLocalAsset } from "./commands.ts";

/** A file of an asset that is in this device's store although the document's device-local section still says it is absent. */
export type ArrivedMedia = { assetId: string; kind: "original" | "proxy" };
/** Where this device keeps media: the originals of a project and the proxies of the cache. */
export type ArrivedProbe = { hasOriginal(assetId: string): Promise<boolean>; hasProxy(contentHash: string): Promise<boolean> };

/**
 * Looks in the store for media the document does not know it has (downloaded by sync while the project was closed, or
 * a moment ago). This READS STORAGE and takes time: its answer is a list of facts about files, never a document — the
 * document may have been edited meanwhile, and only `markArrivedMedia` on the document of that later moment applies it.
 */
export async function findArrivedMedia(probe: ArrivedProbe, document: ProjectDocument): Promise<ArrivedMedia[]> {
  const arrived: ArrivedMedia[] = [];
  for (const asset of document.media.assets) {
    const local = localAssetOf(document, asset.id);
    if (local.present?.original) continue;
    if (await probe.hasOriginal(asset.id).catch(() => false)) arrived.push({ assetId: asset.id, kind: "original" });
    // A proxy that sync downloaded lies in the cache like one this device made.
    else if (!local.present?.proxy && asset.contentHash && (await probe.hasProxy(asset.contentHash).catch(() => false))) arrived.push({ assetId: asset.id, kind: "proxy" });
  }
  return arrived;
}

/**
 * The document with those files marked present, or null when nothing changes. Only the device-local presence fields of
 * assets that are still in THIS document are touched: every edit, import or removal made since the store was read stays.
 */
export function markArrivedMedia(document: ProjectDocument, arrived: readonly ArrivedMedia[]): ProjectDocument | null {
  let next = document;
  for (const file of arrived) {
    if (!next.media.assets.some((asset) => asset.id === file.assetId)) continue;
    const local = localAssetOf(next, file.assetId);
    if (file.kind === "original") { if (!local.present?.original) next = setLocalAsset(next, file.assetId, { present: { ...local.present, original: true } }); }
    else if (!local.present?.original && !local.present?.proxy) next = setLocalAsset(next, file.assetId, { proxy: { state: "succeeded", videoCodec: "h264", audioCodec: "aac", container: "mp4" }, present: { ...local.present, proxy: true } });
  }
  return next === document ? null : next;
}

/**
 * Makes an open document learn the media that arrived: the store is read against the document as it is now, and what was
 * found is merged into the document as it is THEN (`current()` is asked a second time, after the reads). `current`
 * answers null when the document is no longer the open one. Resolves to whether anything was marked.
 */
export async function settleArrivedMedia(probe: ArrivedProbe, current: () => ProjectDocument | null, apply: (next: ProjectDocument) => void): Promise<boolean> {
  const seen = current();
  if (!seen) return false;
  const arrived = await findArrivedMedia(probe, seen);
  const latest = current(), next = latest && markArrivedMedia(latest, arrived);
  if (!next) return false;
  apply(next);
  return true;
}
