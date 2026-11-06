import type { AssetRecord, LocalAsset } from "@jagentchill/protocol";
import { baseNameOf, extensionOf } from "./detect.ts";
import { message, type MediaMessage } from "./messages.ts";

/** "Export original files": original bytes under their original names. Proxies are never exported by this action. [PORT M-028] */
const safeFileName = (name: string): string => name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/^\.+$/, "_") || "file";
/** Names for a set of files written into one folder: " (n)" before the extension on a collision (case-insensitive). */
export function uniqueFileNames(names: string[], existing: Iterable<string> = []): string[] {
  const taken = new Set([...existing].map((name) => name.toLowerCase()));
  return names.map((raw) => {
    const name = safeFileName(raw), extension = extensionOf(name), base = extension ? baseNameOf(name) : name;
    let candidate = name;
    for (let n = 1; taken.has(candidate.toLowerCase()); n++) candidate = `${base} (${n})${extension ? `.${extension}` : ""}`;
    taken.add(candidate.toLowerCase());
    return candidate;
  });
}
export type ExportPlan = { files: { assetId: string; fileName: string }[]; skipped: { assetId: string; name: string }[]; notice: MediaMessage | null };
/** The original file name of an asset: the name it was imported under, with the extension of its container when the display name has none. */
export function originalFileName(asset: AssetRecord): string {
  const name = asset.provenance?.originalFileName ?? asset.name;
  return extensionOf(name) || !asset.container ? name : `${name}.${asset.container === "jpeg" ? "jpg" : asset.container}`;
}
/** Offline assets are skipped and reported; the others are exported. */
export function planExportOriginals(assets: AssetRecord[], locals: Record<string, LocalAsset | undefined>, existingNames: Iterable<string> = []): ExportPlan {
  const online = assets.filter((asset) => locals[asset.id]?.present?.original), skipped = assets.filter((asset) => !locals[asset.id]?.present?.original).map((asset) => ({ assetId: asset.id, name: asset.name }));
  const names = uniqueFileNames(online.map(originalFileName), existingNames);
  return { files: online.map((asset, index) => ({ assetId: asset.id, fileName: names[index] })), skipped, notice: skipped.length > 0 ? message("media.export-originals.skipped", { names: skipped.map((entry) => entry.name).join(", ") }) : null };
}
/** How each platform delivers the files. */
export const exportDelivery = (platform: "web" | "desktop" | "mobile"): "folder" | "save-dialog" | "share-sheet" => (platform === "desktop" ? "folder" : platform === "web" ? "save-dialog" : "share-sheet");
/** Writes the planned files: bytes are read from the original and written unchanged. */
export async function exportOriginals(plan: ExportPlan, io: { read(assetId: string): Promise<Uint8Array>; write(fileName: string, bytes: Uint8Array): Promise<void> }): Promise<{ written: string[]; failed: string[] }> {
  const written: string[] = [], failed: string[] = [];
  for (const file of plan.files) {
    try { await io.write(file.fileName, await io.read(file.assetId)); written.push(file.fileName); }
    catch { failed.push(file.fileName); }
  }
  return { written, failed };
}
