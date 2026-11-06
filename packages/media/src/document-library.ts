import type { Commit, CommitContext } from "@jagentchill/editor-core";
import type { ProjectDocument } from "@jagentchill/protocol";
import { createFolderCommand, importAssetCommand, setLocalAsset } from "./commands.ts";
import type { ImportLibrary } from "./import-pipeline.ts";
import { folderLevel, MAX_FOLDER_DEPTH, FOLDER_NAME_MAX } from "./library.ts";

/**
 * The editing session as the import pipeline sees it. `commit` records an undoable change (history, autosave, sync);
 * `rollback` takes back a commit whose media could not be persisted, leaving no undo step for it; `setDocument`
 * replaces the document after a device-local change, which is neither a patch nor an undo step.
 */
export interface DocumentSession {
  readonly document: ProjectDocument;
  context(): CommitContext;
  commit(commit: Commit): void;
  rollback(commit: Commit): void;
  setDocument(document: ProjectDocument): void;
}
/** Binds the import pipeline to a project document: reuse by content hash, optimistic add, rollback, dropped folders. */
export function documentLibrary(session: DocumentSession): ImportLibrary {
  const pending = new Map<string, Commit>();
  return {
    findByHash(contentHash) {
      const asset = session.document.media.assets.find((entry) => entry.contentHash === contentHash && !entry.ephemeral && entry.kind !== "derived");
      return asset ? { id: asset.id, name: asset.name } : undefined;
    },
    add(fields, local) {
      const commit = importAssetCommand(session.document, session.context(), fields);
      session.commit(commit);
      session.setDocument(setLocalAsset(session.document, commit.assetId, local));
      pending.set(commit.assetId, commit);
      return commit.assetId;
    },
    rollback(assetId) {
      const commit = pending.get(assetId);
      if (commit) session.rollback(commit);
      pending.delete(assetId);
    },
    setLocal(assetId, change) {
      session.setDocument(setLocalAsset(session.document, assetId, change));
    },
    ensureFolders(chain, baseFolderId) {
      let parentId = baseFolderId;
      for (const raw of chain) {
        const name = [...raw.trim().normalize("NFC")].slice(0, FOLDER_NAME_MAX).join("") || "Folder";
        // Depth is capped at 4: deeper files are placed in the level-4 folder.
        if (folderLevel(session.document, parentId) >= MAX_FOLDER_DEPTH) break;
        const sibling = session.document.media.folders.find((folder) => folder.parentId === parentId && folder.name.toLowerCase() === name.toLowerCase());
        if (sibling) { parentId = sibling.id; continue; }
        const commit = createFolderCommand(session.document, session.context(), name, parentId);
        session.commit(commit);
        parentId = commit.folderId;
      }
      return parentId;
    },
  };
}
