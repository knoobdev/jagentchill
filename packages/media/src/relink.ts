import type { AssetRecord, LocalAsset, Rational } from "@jagentchill/protocol";
import { message, type MediaMessage } from "./messages.ts";

/** Offline detection, relink matching and "Locate folder…". The file system is reached through small ports. */
export type FileStat = { size: number; mtime_ms: number };
/**
 * An external file is offline when it is missing, or when its size and modified time both differ from the recorded
 * ones and its content hash differs too. `hash` is called only in that last case.
 */
export async function externalFileStatus(recorded: { size?: number; mtime_ms?: number; contentHash: string | null }, found: FileStat | null, hash: () => Promise<string>): Promise<{ online: boolean; refreshed?: FileStat }> {
  if (!found) return { online: false };
  if (found.size === recorded.size || found.mtime_ms === recorded.mtime_ms) return { online: true };
  return (await hash()) === recorded.contentHash ? { online: true, refreshed: found } : { online: false };
}
export type ExternalCheck = { assetId: string; online: boolean; refreshed?: FileStat };
/** Run at project load and when the app window regains focus, for every asset with `storage: "external"`. */
export async function checkExternalAssets(assets: AssetRecord[], locals: Record<string, LocalAsset | undefined>, files: { stat(path: string): Promise<FileStat | null>; hash(path: string): Promise<string> }): Promise<ExternalCheck[]> {
  const checks: ExternalCheck[] = [];
  for (const asset of assets) {
    const local = locals[asset.id];
    if (local?.storage !== "external" || !local.externalPath) continue;
    const path = local.externalPath;
    const found = await files.stat(path).catch(() => null);
    checks.push({ assetId: asset.id, ...(await externalFileStatus({ size: local.externalSize, mtime_ms: local.externalMtime_ms, contentHash: asset.contentHash }, found, () => files.hash(path))) });
  }
  return checks;
}
/** The banner shown at project open with the count of offline assets; `null` when none is offline. */
export const offlineBanner = (count: number): MediaMessage | null => (count <= 0 ? null : count === 1 ? message("media.offline.banner.one") : message("media.offline.banner", { n: count }));

export type ReplacementFacts = { contentHash: string; duration?: number; width?: number; height?: number; fps?: Rational };
export type RelinkDecision =
  | { kind: "exact" }
  | {
    kind: "different";
    /** The dialog compares duration, resolution and frame rate and requires confirmation. */
    comparison: { duration: { from?: number; to?: number }; resolution: { from?: [number, number]; to?: [number, number] }; fps: { from?: Rational; to?: Rational } };
    /** Clips longer than the new duration will be trimmed to it. */
    shorter: boolean;
  };
/** Equal content hash relinks silently; a different file needs the comparison dialog. */
export function relinkDecision(asset: AssetRecord, replacement: ReplacementFacts): RelinkDecision {
  if (asset.contentHash !== null && asset.contentHash === replacement.contentHash) return { kind: "exact" };
  const size = (value: { width?: number; height?: number }): [number, number] | undefined => (value.width && value.height ? [value.width, value.height] : undefined);
  return {
    kind: "different",
    comparison: { duration: { from: asset.duration, to: replacement.duration }, resolution: { from: size(asset), to: size(replacement) }, fps: { from: asset.fps, to: replacement.fps } },
    shorter: asset.duration !== undefined && replacement.duration !== undefined && replacement.duration < asset.duration,
  };
}

/** "Locate folder…" looks at no more than this many files. */
export const LOCATE_MAX_FILES = 50_000;
export type FoundFile = { path: string; name: string; size: number };
const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path;
/** The file name an offline asset is searched by: the name of its linked file, else its original file name, else its display name. */
export const relinkFileName = (asset: AssetRecord, local?: LocalAsset): string => (local?.externalPath ? baseName(local.externalPath) : asset.provenance?.originalFileName ?? asset.name);
export type LocateResult = { matches: { assetId: string; file: FoundFile }[]; stillOffline: string[]; scanned: number; truncated: boolean };
/**
 * Searches a folder tree for the offline assets: candidates match by name and size, are verified by content hash,
 * and all verified matches are returned to be relinked at once.
 */
export async function locateInFolder(options: { offline: AssetRecord[]; locals?: Record<string, LocalAsset | undefined>; walk: AsyncIterable<FoundFile> | Iterable<FoundFile>; hash(path: string): Promise<string>; signal?: AbortSignal }): Promise<LocateResult> {
  const wanted = new Map<string, AssetRecord[]>();
  for (const asset of options.offline) {
    const key = `${relinkFileName(asset, options.locals?.[asset.id]).toLowerCase()}\n${options.locals?.[asset.id]?.externalSize ?? asset.size}`;
    wanted.set(key, [...(wanted.get(key) ?? []), asset]);
  }
  const matches: LocateResult["matches"] = [], found = new Set<string>();
  let scanned = 0, truncated = false;
  for await (const file of options.walk) {
    if (options.signal?.aborted) break;
    if (scanned >= LOCATE_MAX_FILES) { truncated = true; break; }
    scanned++;
    const candidates = wanted.get(`${file.name.toLowerCase()}\n${file.size}`)?.filter((asset) => !found.has(asset.id));
    if (!candidates || candidates.length === 0) continue;
    const hash = await options.hash(file.path).catch(() => null);
    const asset = candidates.find((candidate) => candidate.contentHash === hash);
    if (asset) { found.add(asset.id); matches.push({ assetId: asset.id, file }); }
    if (found.size === options.offline.length) break;
  }
  return { matches, stillOffline: options.offline.filter((asset) => !found.has(asset.id)).map((asset) => asset.id), scanned, truncated };
}
