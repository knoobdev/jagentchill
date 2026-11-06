import { assetRecordSchema, tracksOf, type AssetRecord, type ProjectDocument } from "@jagentchill/protocol";
import { isObject, type Json } from "../model.ts";
import { compareIds } from "../patch.ts";
import { edit, reject, type Commit, type CommitContext } from "./shared.ts";

const AUTOMATIC = { ai: { kind: "ai-generated", name: "AI generated" }, slate: { kind: "slates", name: "Slates" } } as const;

/**
 * Adds an asset record with every defaulted field written out. The first AI-generated or slate asset creates its
 * automatic folder and is filed in it.
 */
export function addAsset(doc: ProjectDocument, ctx: CommitContext, fields: Record<string, unknown> & { name: string; type: "image" | "video" | "audio"; size: number; id?: string }): Commit & { assetId: string } {
  const assetId = fields.id ?? ctx.newId();
  const commit = edit(doc, ctx, { commandType: "media.add", label: "Import" }, (draft) => {
    const parsed = assetRecordSchema.safeParse({ created_ms: ctx.now_ms, ...fields, id: assetId });
    const asset = (parsed.success ? parsed.data : { created_ms: ctx.now_ms, ...fields, id: assetId }) as AssetRecord;
    const automatic = AUTOMATIC[(asset.provenance?.source ?? "") as keyof typeof AUTOMATIC];
    if (automatic && asset.folderId == null) {
      let folder = draft.media.folders.find((entry) => entry.kind === automatic.kind);
      if (!folder) { folder = { id: ctx.newId(), name: automatic.name, parentId: null, kind: automatic.kind }; draft.media.folders.push(folder); }
      asset.folderId = folder.id;
    }
    draft.media.assets.push(asset);
    draft.media.assets.sort((a, b) => compareIds(a.id, b.id));
  });
  return { ...commit, assetId };
}
/** Probe results, the content hash and motion tracks are written by non-history updates. */
export const updateAsset = (doc: ProjectDocument, ctx: CommitContext, assetId: string, fields: Record<string, unknown>, history = false): Commit =>
  edit(doc, ctx, { commandType: "media.update", label: "Media", history }, (draft) => {
    Object.assign(draft.media.assets.find((asset) => asset.id === assetId) ?? reject("document/unknown-asset", "/media/assets", `asset "${assetId}" does not exist`), fields);
  });
export const renameAsset = (doc: ProjectDocument, ctx: CommitContext, assetId: string, name: string): Commit => updateAsset(doc, ctx, assetId, { name }, true);

/** Removes assets and, in the same undo step, every element and reference that used them. */
export function removeAssets(doc: ProjectDocument, ctx: CommitContext, assetIds: string[]): Commit {
  return edit(doc, ctx, { commandType: "media.remove", label: "Remove media" }, (draft) => {
    const gone = new Set(assetIds);
    draft.media.assets = draft.media.assets.filter((asset) => !gone.has(asset.id) && !(asset.derived && gone.has(asset.derived.sourceAssetId)));
    const left = new Set(draft.media.assets.map((asset) => asset.id));
    for (const scene of draft.scenes) for (const track of tracksOf(scene)) {
      const removed = new Set<string>();
      (track as { elements: unknown[] }).elements = (track.elements as unknown as Json[]).filter((element) => {
        const keep = element.mediaId === undefined || left.has(String(element.mediaId));
        if (!keep) removed.add(String(element.id));
        return keep;
      });
      (track as unknown as Json).transitions = (track.transitions as unknown as Json[]).filter((record) => !removed.has(String(record.fromElementId)) && !removed.has(String(record.toElementId)));
      for (const element of track.elements as unknown as Json[]) {
        if (removed.has(String(element.transitionIn))) element.transitionIn = null;
        if (isObject(element.cutout) && !left.has(String(element.cutout.matteAssetId))) delete element.cutout.matteAssetId;
        if (isObject(element.background) && element.background.kind === "image" && !left.has(String(element.background.mediaId))) delete element.background;
      }
    }
    if (draft.cover?.mediaId && !left.has(draft.cover.mediaId)) draft.cover = null;
  });
}

/** Creates a library folder; nesting stops at 4 levels. */
export function createFolder(doc: ProjectDocument, ctx: CommitContext, name: string, parentId: string | null = null): Commit & { folderId: string } {
  const folderId = ctx.newId();
  const commit = edit(doc, ctx, { commandType: "media.folder.add", label: "New folder" }, (draft) => {
    let level = 1;
    for (let parent = parentId; parent !== null; parent = draft.media.folders.find((folder) => folder.id === parent)?.parentId ?? null) level++;
    if (level > 4) reject("document/limit-exceeded", "/media/folders", "folders nest at most 4 levels", { limit: "folderDepth", value: 4 });
    draft.media.folders.push({ id: folderId, name, parentId, kind: "user" });
  });
  return { ...commit, folderId };
}
/** Deletes a folder: its assets and sub-folders move to its parent in the same command. */
export function deleteFolder(doc: ProjectDocument, ctx: CommitContext, folderId: string): Commit {
  return edit(doc, ctx, { commandType: "media.folder.remove", label: "Delete folder" }, (draft) => {
    const folder = draft.media.folders.find((entry) => entry.id === folderId) ?? reject("document/unknown-reference", "/media/folders", `folder "${folderId}" does not exist`);
    draft.media.folders = draft.media.folders.filter((entry) => entry.id !== folderId);
    for (const entry of draft.media.folders) if (entry.parentId === folderId) entry.parentId = folder.parentId;
    for (const asset of draft.media.assets) if (asset.folderId === folderId) asset.folderId = folder.parentId;
  });
}

/** What the media library lists: derived tool outputs and temporary tool assets are resolvable but hidden. */
export const libraryAssets = (doc: ProjectDocument): AssetRecord[] => doc.media.assets.filter((asset) => asset.kind !== "derived" && !asset.ephemeral);
