import type { AssetRecord, LocalAsset } from "@jagentchill/protocol";
import { formatBytes, message, STORAGE_RESERVE_BYTES, type MediaMessage } from "./messages.ts";

/** External file references (desktop): linked assets, and the one-press "Copy media into library". */
export type ImportMode = "link" | "copy";
/** The mode the desktop picker preselects follows the preference "Reference files in place" (factory value on). Web and mobile always copy. */
export const preselectedImportMode = (platform: "web" | "desktop" | "mobile", referenceInPlace = true): ImportMode => (platform === "desktop" && referenceInPlace ? "link" : "copy");
export const externalAssets = (assets: AssetRecord[], locals: Record<string, LocalAsset | undefined>): AssetRecord[] => assets.filter((asset) => locals[asset.id]?.storage === "external");
/** The action exists on desktop for every project that has at least one external asset. */
export const offersCopyIntoLibrary = (platform: "web" | "desktop" | "mobile", assets: AssetRecord[], locals: Record<string, LocalAsset | undefined>): boolean => platform === "desktop" && externalAssets(assets, locals).length > 0;

export type CopyPlan = { files: number; totalBytes: number; requiredBytes: number; summary: MediaMessage; ok: boolean; /** Names the required and the available space. */ refusal: MediaMessage | null };
/** Number of files, their total size, and the free-space check (total size plus 50 MiB) made before anything is copied. */
export function planCopyIntoLibrary(assets: AssetRecord[], locals: Record<string, LocalAsset | undefined>, freeBytes: number | null): CopyPlan {
  const linked = externalAssets(assets, locals), totalBytes = linked.reduce((sum, asset) => sum + (locals[asset.id]?.externalSize ?? asset.size), 0);
  const requiredBytes = totalBytes + STORAGE_RESERVE_BYTES, ok = freeBytes === null || freeBytes >= requiredBytes;
  return {
    files: linked.length, totalBytes, requiredBytes, ok,
    summary: message("media.copy-into-library.summary", { n: linked.length, size: formatBytes(totalBytes) }),
    refusal: ok ? null : message("media.copy-into-library.space", { required: formatBytes(requiredBytes), available: formatBytes(freeBytes ?? 0) }),
  };
}
export type CopyResult = { converted: string[]; /** Offline files, listed at the end with "Relink…". */ offline: { assetId: string; name: string }[]; failed: { assetId: string; name: string }[]; cancelled: boolean };
/**
 * Copies every external asset into the project's `media/` folder. Each copy is verified by SHA-256 and only then is
 * the asset switched to `storage: "managed"`. Cancelling keeps what was converted and leaves the rest linked. Clips
 * are never changed and the conversion is not an undo step (it only touches the device-local entry).
 */
export async function copyIntoLibrary(options: {
  assets: AssetRecord[];
  locals: Record<string, LocalAsset | undefined>;
  files: {
    exists(path: string): Promise<boolean>;
    /** Copies the file into the library and returns the SHA-256 of what was written. */
    copy(assetId: string, path: string, onBytes: (bytes: number) => void): Promise<string>;
    removeCopy(assetId: string): Promise<void>;
  };
  switchToManaged(assetId: string): void;
  onProgress?(state: { copiedBytes: number; totalBytes: number; fraction: number; file: string }): void;
  signal?: AbortSignal;
}): Promise<CopyResult> {
  const linked = externalAssets(options.assets, options.locals), result: CopyResult = { converted: [], offline: [], failed: [], cancelled: false };
  const totalBytes = linked.reduce((sum, asset) => sum + (options.locals[asset.id]?.externalSize ?? asset.size), 0);
  let done = 0;
  for (const asset of linked) {
    if (options.signal?.aborted) { result.cancelled = true; break; }
    const local = options.locals[asset.id]!, path = local.externalPath ?? "", size = local.externalSize ?? asset.size;
    if (!path || !(await options.files.exists(path).catch(() => false))) { result.offline.push({ assetId: asset.id, name: asset.name }); continue; }
    const report = (bytes: number) => options.onProgress?.({ copiedBytes: done + bytes, totalBytes, fraction: totalBytes > 0 ? Math.min(1, (done + bytes) / totalBytes) : 1, file: asset.name });
    try {
      const written = await options.files.copy(asset.id, path, report);
      if (written !== asset.contentHash) throw new Error("copy does not match the source");
      options.switchToManaged(asset.id);
      result.converted.push(asset.id);
    } catch {
      await options.files.removeCopy(asset.id).catch(() => undefined);
      result.failed.push({ assetId: asset.id, name: asset.name });
    }
    done += size;
    report(0);
  }
  return result;
}
/** The device-local change that turns a linked asset into a managed one. */
export const managedLocal = (local: LocalAsset): LocalAsset => {
  const { externalPath: _path, externalGrantId: _grant, externalSize: _size, externalMtime_ms: _mtime, ...rest } = local;
  return { ...rest, storage: "managed", present: { ...local.present, original: true } };
};
