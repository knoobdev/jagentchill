import {
  addAsset, allElements, createFolder, deleteFolder, edit, followDuration, reject, removeAssets, setLocal, updateAsset,
  type Commit, type CommitContext,
} from "@jagentchill/editor-core";
import { localAssetSchema, type AssetRecord, type LocalAsset, type ProjectDocument } from "@jagentchill/protocol";
import { canCreateFolderIn, canMoveFolder, checkAssetName, checkFolderName, findFolder, usageCounts, MAX_TAGS, TAG_MAX } from "./library.ts";

/**
 * Library commands. Asset records are document data, so every one of these is an undoable command that emits a
 * state patch; changes to the device-local entry (`setLocalAsset`) create no undo step and no patch.
 */
type Json = Record<string, unknown>;
const assetIn = (draft: ProjectDocument, assetId: string): AssetRecord =>
  draft.media.assets.find((asset) => asset.id === assetId) ?? reject("document/unknown-asset", "/media/assets", `asset "${assetId}" does not exist`);

/** Adds an imported asset to the library (the automatic "AI generated" and "Slates" folders are maintained by `addAsset`). */
export const importAssetCommand = (doc: ProjectDocument, ctx: CommitContext, fields: Parameters<typeof addAsset>[2]): Commit & { assetId: string } => addAsset(doc, ctx, fields);

/**
 * Rename: the display name only. Elements that still carry the asset's previous name as their own name are renamed
 * with it; an element the user renamed keeps its name. Empty input reverts (`null`).
 */
export function renameAssetCommand(doc: ProjectDocument, ctx: CommitContext, assetId: string, rawName: string): Commit | null {
  const name = checkAssetName(rawName);
  if (name === null) return null;
  return edit(doc, ctx, { commandType: "media.rename", label: "Rename media" }, (draft) => {
    const asset = assetIn(draft, assetId), previous = asset.name;
    asset.name = name;
    for (const ref of allElements(draft)) {
      const element = ref.element as unknown as Json;
      if (element.mediaId === assetId && element.name === previous) element.name = name;
    }
  });
}

/** Tags: up to 20, each 1–32 characters, unique; stored trimmed. */
export function setAssetTagsCommand(doc: ProjectDocument, ctx: CommitContext, assetId: string, tags: string[]): Commit {
  const cleaned = tags.map((tag) => tag.trim().normalize("NFC")).filter((tag, index, all) => tag.length > 0 && all.findIndex((other) => other.toLowerCase() === tag.toLowerCase()) === index);
  if (cleaned.length > MAX_TAGS) reject("document/limit-exceeded", "/media/assets", "Up to 20 tags", { limit: "tagsPerAsset", value: MAX_TAGS });
  if (cleaned.some((tag) => [...tag].length > TAG_MAX)) reject("document/out-of-range", "/media/assets", `a tag has at most ${TAG_MAX} characters`);
  return edit(doc, ctx, { commandType: "media.tags", label: "Edit tags" }, (draft) => { assetIn(draft, assetId).tags = cleaned; });
}

/** New folder: the name is trimmed, 1–80 characters, unique among its siblings; nesting stops at 4 levels. */
export function createFolderCommand(doc: ProjectDocument, ctx: CommitContext, rawName: string, parentId: string | null = null): Commit & { folderId: string } {
  if (parentId !== null && !findFolder(doc, parentId)) reject("document/unknown-reference", "/media/folders", `folder "${parentId}" does not exist`);
  if (!canCreateFolderIn(doc, parentId)) reject("document/limit-exceeded", "/media/folders", "Folders can be nested up to 4 levels", { limit: "folderDepth", value: 4 });
  const check = checkFolderName(doc, parentId, rawName);
  if (!check.ok) reject("document/invalid-folder-name", "/media/folders", `folder name is ${check.reason}`, { reason: check.reason });
  return createFolder(doc, ctx, (check as { name: string }).name, parentId);
}
export function renameFolderCommand(doc: ProjectDocument, ctx: CommitContext, folderId: string, rawName: string): Commit {
  const folder = findFolder(doc, folderId) ?? reject("document/unknown-reference", "/media/folders", `folder "${folderId}" does not exist`);
  const check = checkFolderName(doc, folder.parentId, rawName, folderId);
  if (!check.ok) reject("document/invalid-folder-name", "/media/folders", `folder name is ${check.reason}`, { reason: check.reason });
  return edit(doc, ctx, { commandType: "media.folder.rename", label: "Rename folder" }, (draft) => { draft.media.folders.find((entry) => entry.id === folderId)!.name = (check as { name: string }).name; });
}
/**
 * Moves assets and folders into a folder (or to the root with `null`): drag onto a folder or breadcrumb, and the
 * "Move to…" dialog. Timeline clips are unaffected. A folder that cannot move there rejects the whole command.
 */
export function moveToFolderCommand(doc: ProjectDocument, ctx: CommitContext, items: { assetIds?: string[]; folderIds?: string[] }, targetFolderId: string | null): Commit {
  if (targetFolderId !== null && !findFolder(doc, targetFolderId)) reject("document/unknown-reference", "/media/folders", `folder "${targetFolderId}" does not exist`);
  for (const folderId of items.folderIds ?? []) {
    const folder = findFolder(doc, folderId) ?? reject("document/unknown-reference", "/media/folders", `folder "${folderId}" does not exist`);
    if (folder.parentId === targetFolderId) continue;
    if (!canMoveFolder(doc, folderId, targetFolderId)) reject("document/limit-exceeded", "/media/folders", "Folders can be nested up to 4 levels", { limit: "folderDepth", value: 4 });
    if (!checkFolderName(doc, targetFolderId, folder.name, folderId).ok) reject("document/invalid-folder-name", "/media/folders", "a folder of that name already exists there", { reason: "duplicate" });
  }
  return edit(doc, ctx, { commandType: "media.move", label: "Move to folder" }, (draft) => {
    for (const assetId of items.assetIds ?? []) assetIn(draft, assetId).folderId = targetFolderId;
    for (const folderId of items.folderIds ?? []) draft.media.folders.find((entry) => entry.id === folderId)!.parentId = targetFolderId;
  });
}
/** Delete folder: its assets and sub-folders move to the parent; it never deletes assets. */
export const deleteFolderCommand = (doc: ProjectDocument, ctx: CommitContext, folderId: string): Commit => deleteFolder(doc, ctx, folderId);

export type RemovalImpact = { assets: number; clips: number; /** Shown only when a targeted asset is in use. */ confirmation: string | null };
/** What deleting assets takes with it. Unused assets are deleted without confirmation. */
export function removalImpact(doc: ProjectDocument, assetIds: string[]): RemovalImpact {
  const used = usageCounts(doc), clips = assetIds.reduce((sum, id) => sum + (used.get(id) ?? 0), 0);
  return { assets: assetIds.length, clips, confirmation: clips > 0 ? `${assetIds.length} ${assetIds.length === 1 ? "asset is" : "assets are"} used by ${clips} ${clips === 1 ? "clip" : "clips"}. Deleting them also removes those clips.` : null };
}
/** Removes assets and every element and background that references them, as one undoable command. [PORT M-019, M-020] */
export const removeAssetsCommand = (doc: ProjectDocument, ctx: CommitContext, assetIds: string[]): Commit => removeAssets(doc, ctx, assetIds);

/** The facts of a replacement file that relink writes to the asset record. */
export type RelinkFields = { contentHash: string; size: number; lastModified_ms?: number; duration?: number; width?: number; height?: number; fps?: AssetRecord["fps"]; hasAudio?: boolean; videoCodec?: string; audioCodec?: string; container?: string; rotation?: AssetRecord["rotation"] };
/**
 * Relinks an asset to a replacement file. Clips keep their timings; a clip that shows more source than the new file
 * holds is trimmed to it. Undoable.
 */
export function relinkAssetCommand(doc: ProjectDocument, ctx: CommitContext, assetId: string, fields: RelinkFields): Commit {
  return edit(doc, ctx, { commandType: "media.relink", label: "Relink media" }, (draft) => {
    const asset = assetIn(draft, assetId), previous = asset.duration;
    Object.assign(asset, fields);
    const total = fields.duration;
    // The same file found again (or one of the same length) changes no clip.
    if (total === undefined || total <= 0 || total === previous) return;
    for (const ref of allElements(draft)) {
      const element = ref.element as unknown as Json & { duration: number; trimStart: number; trimEnd: number; sourceDuration?: number };
      if (element.mediaId !== assetId || typeof element.sourceDuration !== "number") continue;
      const shown = Math.max(1, element.sourceDuration - element.trimStart - element.trimEnd);
      const trimStart = element.trimStart < total ? element.trimStart : 0, available = total - trimStart;
      element.sourceDuration = total;
      element.trimStart = trimStart;
      if (shown <= available) element.trimEnd = available - shown;
      else {
        // The clip showed more than the new file has: it ends where the file ends, at the same playback rate.
        element.trimEnd = 0;
        element.duration = Math.max(1, Math.round((element.duration * available) / shown));
        followDuration(element);
      }
    }
  });
}

/** Probe results and the content hash are written by non-history updates: a patch, no undo step. */
export const recordProbeCommand = (doc: ProjectDocument, ctx: CommitContext, assetId: string, fields: Record<string, unknown>): Commit => updateAsset(doc, ctx, assetId, fields, false);

const LOCAL_DEFAULT: LocalAsset = localAssetSchema.parse({});
export const localAssetOf = (doc: ProjectDocument, assetId: string): LocalAsset => ((doc as unknown as { local?: { media?: Record<string, LocalAsset> } }).local?.media?.[assetId]) ?? LOCAL_DEFAULT;
/** Changes the device-local entry of an asset: decode flags, proxy state, external path, presence. No undo step, no patch. */
export function setLocalAsset(doc: ProjectDocument, assetId: string, change: Partial<LocalAsset>): ProjectDocument {
  return setLocal(doc, (local) => {
    const media = (local.media ??= {}) as Record<string, LocalAsset>;
    media[assetId] = { ...LOCAL_DEFAULT, ...media[assetId], ...change };
  });
}
/** Replaces the whole device-local entry, dropping fields the new one does not carry (a linked asset that became managed). */
export function replaceLocalAsset(doc: ProjectDocument, assetId: string, entry: LocalAsset): ProjectDocument {
  return setLocal(doc, (local) => { ((local.media ??= {}) as Record<string, LocalAsset>)[assetId] = entry; });
}
export function dropLocalAsset(doc: ProjectDocument, assetId: string): ProjectDocument {
  return setLocal(doc, (local) => { delete (local.media as Record<string, unknown> | undefined)?.[assetId]; });
}
