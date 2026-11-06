import { canonicalize, renameProject, setProjectPinned, type CommitContext } from "@jagentchill/editor-core";
import { createProjectDocument, localDefaults, type Background, type CanvasSize, type ProjectDocument, type Rational } from "@jagentchill/protocol";
import { capacityMessage, evaluateStorageCapacity, isStorageError, loadProject, NEEDS_NEWER_APP, openability, saveProject, type LoadedProject, type StoragePort } from "@jagentchill/storage";
import { canCreateFolderIn, effectiveFolder, folderMoveRefusal, folderSubtree, isExpired, validateFolderName, type MoveRefusal, type ProjectFolder, type TrashEntry } from "./folders.ts";
import { duplicateName, normalizeName } from "./logic.ts";

type Json = Record<string, unknown>;
export type TrashState = { kind: "project" | "template"; deleted_ms: number; originalFolderId?: string };
/** What the Projects screens know about a project without opening it. Read once per app session, then kept current. */
export type ProjectSummary = {
  id: string; name: string; duration: number; created_ms: number; updated_ms: number; folderId: string | null; trash: TrashState | null;
  /** When the project was pinned (`metadata.pinned_ms` of its document), `null` while it is not. */
  pinned_ms: number | null;
  /** The stored record fails validation: listed with the "Unreadable" badge, never opened. */
  unreadable: boolean; needsNewerApp: boolean;
  /** `template.locked`: "Template draft", opened in the template editor. */
  templateDraft: boolean; imported: boolean;
  canvasSize: CanvasSize | null; fps: Rational | null; background: Background | null;
  scenes: number; assets: number; externalFiles: number; schemaVersion: number | null;
  cover: { sha256: string; mime: string } | null;
  /** First asset ID: its synced host thumbnail can stand in for a project cover on compact Home. */
  thumbnailAssetId?: string | null;
  links: { film: boolean; workflow: boolean; scripts: number };
};
export type LibraryState = { status: "loading" | "ready" | "error"; error: unknown; projects: ProjectSummary[]; folders: ProjectFolder[] };
/** The three "New project" preferences. `"match"` is "Match first clip", the factory value: adoption stays armed. */
export type NewProjectPreferences = { canvas?: "match" | CanvasSize; frameRate?: "match" | Rational; background?: Background };
export type BulkResult = { done: string[]; created: string[]; failed: { id: string; name: string; message: string }[] };
export type BulkProgress = (index: number, total: number) => void;
export type OpenResult = { state: "ok"; loaded: LoadedProject } | { state: "not-found" } | { state: "error"; error: unknown; hasSnapshot: boolean };
export type ProjectInfo = { summary: ProjectSummary; mediaAssets: number; storageBytes: number; location: string | null };

export const THUMBNAIL_NAME = { jpeg: "frame0.jpg", png: "frame0.png" } as const;
const isObject = (value: unknown): value is Json => value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** The summary of a stored record. A record without readable metadata is listed as unreadable, never dropped. */
export function summarize(id: string, record: Json | null): ProjectSummary {
  const blank: ProjectSummary = {
    id, name: "", duration: 0, created_ms: 0, updated_ms: 0, pinned_ms: null, folderId: null, trash: null, unreadable: true, needsNewerApp: false, templateDraft: false, imported: false,
    canvasSize: null, fps: null, background: null, scenes: 0, assets: 0, externalFiles: 0, schemaVersion: null, cover: null, thumbnailAssetId: null, links: { film: false, workflow: false, scripts: 0 },
  };
  const local = isObject(record?.local) ? record.local : {};
  const trash = isObject(local.trash) && finite(local.trash.deleted_ms) !== null
    ? { kind: local.trash.kind === "template" ? "template" as const : "project" as const, deleted_ms: local.trash.deleted_ms as number, originalFolderId: typeof local.trash.originalFolderId === "string" ? local.trash.originalFolderId : undefined } : null;
  const placement = { folderId: typeof local.folderId === "string" ? local.folderId : null, trash };
  const metadata = record?.metadata;
  if (!record || !isObject(metadata) || typeof metadata.name !== "string" || metadata.name.trim() === "") return { ...blank, ...placement };
  const settings = isObject(record.settings) ? record.settings : {}, media = isObject(record.media) ? record.media : {};
  const size = isObject(settings.canvasSize) && finite(settings.canvasSize.width) && finite(settings.canvasSize.height) ? { width: settings.canvasSize.width as number, height: settings.canvasSize.height as number } : null;
  const fps = isObject(settings.fps) && finite(settings.fps.numerator) && finite(settings.fps.denominator) ? { numerator: settings.fps.numerator as number, denominator: settings.fps.denominator as number } : null;
  const cover = isObject(record.cover) && isObject(record.cover.image) && typeof record.cover.image.sha256 === "string" ? { sha256: record.cover.image.sha256, mime: String(record.cover.image.mime ?? "image/jpeg") } : null;
  const localMedia = isObject(local.media) ? Object.values(local.media) : [];
  return {
    ...blank, ...placement, unreadable: false, name: metadata.name, duration: finite(metadata.duration) ?? 0, created_ms: finite(metadata.created_ms) ?? 0, updated_ms: finite(metadata.updated_ms) ?? 0, pinned_ms: finite(metadata.pinned_ms),
    needsNewerApp: openability(record) === "needs-newer-app", templateDraft: isObject(record.template) && record.template.locked === true, imported: isObject(metadata.importedFrom),
    canvasSize: size, fps, background: isObject(settings.background) ? settings.background as Background : null,
    scenes: Array.isArray(record.scenes) ? record.scenes.length : 0, assets: Array.isArray(media.assets) ? media.assets.length : 0,
    externalFiles: localMedia.filter((entry) => isObject(entry) && entry.storage === "external").length,
    schemaVersion: finite(record.schemaVersion), cover,
    thumbnailAssetId: Array.isArray(media.assets) && isObject(media.assets[0]) && typeof media.assets[0].id === "string" ? media.assets[0].id : null,
    links: { film: isObject(record.filmLink), workflow: isObject(record.workflowLink), scripts: Array.isArray(record.scriptLinks) ? record.scriptLinks.length : 0 },
  };
}

/** The text of a record: the canonical document, then its device-local section — the layout the storage package writes. */
function recordText(record: Json): string {
  const { local, ...canonical } = record;
  let text: string;
  try { text = canonicalize(canonical); } catch { text = JSON.stringify(canonical); }
  return local === undefined ? text : `${text.slice(0, -1)}${text.length > 2 ? "," : ""}"local":${JSON.stringify(local)}}`;
}
const failureMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export type ProjectLibraryOptions = {
  storage: StoragePort; now?: () => number; newId: () => string;
  /** Phones start a project in portrait. */
  phone?: boolean;
  /** The desktop project library folder, shown as the storage location. */
  libraryPath?: string | null;
};

/**
 * The projects of this device: the index of the Projects screens and every action on it. All of it goes through the
 * storage port, so it works with no host and no network. Listeners are told after every change.
 */
export function createProjectLibrary(options: ProjectLibraryOptions) {
  const { storage, newId } = options;
  const now = options.now ?? Date.now;
  let state: LibraryState = { status: "loading", error: null, projects: [], folders: [] };
  let loading: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const set = (next: Partial<LibraryState>) => { state = { ...state, ...next }; for (const listener of listeners) listener(); };
  const find = (id: string) => state.projects.find((project) => project.id === id);
  // A summary that says what the list already says changes nothing: a save of the timeline's view (a scroll, a zoom)
  // must not render every screen that lists projects.
  const put = (summary: ProjectSummary) => { const known = state.projects.find((project) => project.id === summary.id); if (known && JSON.stringify(known) === JSON.stringify(summary)) return; set({ projects: [...state.projects.filter((project) => project.id !== summary.id), summary] }); };
  const drop = (ids: readonly string[]) => set({ projects: state.projects.filter((project) => !ids.includes(project.id)) });

  async function readSummary(id: string): Promise<ProjectSummary> {
    let record: Json | null = null;
    try { record = await storage.readProject(id); } catch (error) { if (isStorageError(error, "NotFound")) throw error; }
    return summarize(id, record);
  }
  async function refresh(id: string): Promise<ProjectSummary | null> {
    if (!(await storage.hasProject(id))) { drop([id]); return null; }
    const summary = await readSummary(id);
    put(summary);
    return summary;
  }
  /** Rewrites only the device-local section of a record: the canonical document keeps its bytes. */
  async function writeLocal(id: string, change: (local: Json) => void): Promise<void> {
    const record = await storage.readProject(id);
    const local: Json = isObject(record.local) ? { ...record.local } : {};
    change(local);
    await storage.writeProjectText(id, recordText({ ...record, local }));
  }
  const saveFolders = async (folders: ProjectFolder[]) => { await storage.writeLibrary("folders", { folders }); set({ folders }); };
  async function each(ids: readonly string[], progress: BulkProgress | undefined, work: (id: string, name: string) => Promise<string | void>): Promise<BulkResult> {
    const result: BulkResult = { done: [], created: [], failed: [] };
    for (const [index, id] of ids.entries()) {
      progress?.(index + 1, ids.length);
      const name = find(id)?.name ?? "";
      try { const created = await work(id, name); result.done.push(id); if (created) result.created.push(created); } catch (error) { result.failed.push({ id, name, message: failureMessage(error) }); }
    }
    return result;
  }

  async function duplicateOne(id: string, taken: string[]): Promise<string> {
    const source = find(id);
    let record: Json;
    try { record = await storage.readProject(id); } catch (error) { if (isStorageError(error, "NotFound")) throw new Error("Project(s) not found"); throw error; }
    if (!source || source.unreadable || !isObject(record.metadata)) throw new Error("Project(s) not found");
    const media = await storage.listMedia(id);
    const text = JSON.stringify(record);
    const capacity = await evaluateStorageCapacity(storage, text.length, { kind: "record" });
    if (!capacity.allowed) throw new Error(capacityMessage(source.name, capacity).text);
    const copyId = newId(), name = duplicateName(source.name, taken), stamp = now();
    const local: Json = { ...(isObject(record.local) ? record.local : {}), trash: null };
    // A copy starts unpinned: the pin belongs to the project it was given to.
    const { pinned_ms: _pinned, ...metadata } = record.metadata;
    const copy: Json = { ...(JSON.parse(text) as Json), metadata: { ...metadata, id: copyId, name, created_ms: stamp, updated_ms: stamp }, local };
    try {
      // The same content hash: the bytes are referenced, not copied.
      for (const entry of media) await storage.writeMedia(copyId, entry.assetId, await storage.readMedia(id, entry.assetId), { contentHash: entry.contentHash, extension: entry.extension });
      for (const blob of [THUMBNAIL_NAME.jpeg, THUMBNAIL_NAME.png]) { const bytes = await storage.getBlob("thumbnail", id, blob); if (bytes) await storage.putBlob("thumbnail", copyId, blob, bytes); }
      if (source.cover) { const bytes = await storage.getBlob("cover", id, coverBlobName(source.cover.mime)); if (bytes) await storage.putBlob("cover", copyId, coverBlobName(source.cover.mime), bytes); }
      await storage.writeProjectText(copyId, recordText(copy));
    } catch (error) {
      await storage.deleteProject(copyId).catch(() => undefined);
      if (isStorageError(error, "QuotaExceeded")) throw new Error(capacityMessage(source.name, { allowed: false, required: text.length, available: (await storage.available().catch(() => 0)) ?? 0 }).text);
      throw error;
    }
    taken.push(name);
    put(summarize(copyId, copy));
    return copyId;
  }

  const library = {
    getState: (): LibraryState => state,
    subscribe(listener: () => void): () => void { listeners.add(listener); return () => void listeners.delete(listener); },
    find,
    /** Loads the index once per app session; later calls return the same load. `reload` reads it again (Retry). */
    load(reload = false): Promise<void> {
      if (loading && !reload) return loading;
      if (reload) set({ status: "loading", error: null });
      loading = (async () => {
        try {
          const entries = await storage.listProjects();
          const projects = await Promise.all(entries.map((entry) => readSummary(entry.id).catch(() => summarize(entry.id, null))));
          const folders = (await storage.readLibrary<{ folders: ProjectFolder[] }>("folders"))?.folders ?? [];
          set({ status: "ready", error: null, projects, folders: Array.isArray(folders) ? folders : [] });
        } catch (error) { set({ status: "error", error }); }
      })();
      return loading;
    },
    refresh,
    /** Tells the index that the editor saved this document. */
    noteSaved(document: ProjectDocument): void { put(summarize(document.metadata.id, document as unknown as Json)); },

    /**
     * "New project": saved at once, in the folder being viewed. Nothing remains when the save fails — the caller shows
     * "Failed to create project".
     */
    async create(input: { folderId?: string | null; name?: string; preferences?: NewProjectPreferences } = {}): Promise<string> {
      const id = newId(), preferences = input.preferences ?? {};
      const document = createProjectDocument({
        id, mainSceneId: newId(), mainTrackId: newId(), now_ms: now(), name: input.name, phone: options.phone,
        canvasSize: preferences.canvas && preferences.canvas !== "match" ? preferences.canvas : undefined,
        fps: preferences.frameRate && preferences.frameRate !== "match" ? preferences.frameRate : undefined,
        background: preferences.background,
      });
      document.local = { ...localDefaults(document), folderId: effectiveFolder(state.folders, input.folderId ?? null) };
      try { await saveProject(storage, document); } catch (error) { await storage.deleteProject(id).catch(() => undefined); throw error; }
      put(summarize(id, document as unknown as Json));
      return id;
    },
    /** Opens a project for the editor: the stored record validated and repaired in memory, or why it cannot be opened. */
    async open(id: string): Promise<OpenResult> {
      try {
        if (!(await storage.hasProject(id))) return { state: "not-found" };
        return { state: "ok", loaded: await loadProject(storage, id) };
      } catch (error) {
        if (isStorageError(error, "NotFound")) return { state: "not-found" };
        const hasSnapshot = await storage.listSnapshots(id).then((list) => list.length > 0).catch(() => false);
        return { state: "error", error, hasSnapshot };
      }
    },
    /** "Restore latest snapshot" of the load-error screen. */
    async restoreLatestSnapshot(id: string): Promise<boolean> {
      const [latest] = await storage.listSnapshots(id);
      if (!latest) return false;
      await storage.writeProjectText(id, (await storage.readSnapshot(id, latest.id)).record);
      await refresh(id);
      return true;
    },
    /** Rename from the dialog: trimmed, 1–120 characters; an empty result keeps the previous name and returns `false`. */
    async rename(id: string, text: string): Promise<boolean> {
      const name = normalizeName(text);
      if (name === null || name === find(id)?.name) return false;
      const { document } = await loadProject(storage, id);
      const context: CommitContext = { now_ms: now(), newId };
      const commit = renameProject(document, context, name);
      commit.document.metadata.updated_ms = Math.max(commit.document.metadata.updated_ms, context.now_ms);
      await saveProject(storage, commit.document);
      put(summarize(id, commit.document as unknown as Json));
      return true;
    },
    /**
     * Pins or unpins projects. The pin is written into each project's document (`metadata.pinned_ms`), so it reaches
     * the other devices with the project; it is not an edit of the film, so "Modified" keeps its time.
     */
    setPinned(ids: readonly string[], pinned: boolean, progress?: BulkProgress): Promise<BulkResult> {
      return each(ids, progress, async (id) => {
        const known = find(id);
        if (known && (known.pinned_ms !== null) === pinned) return;
        const { document } = await loadProject(storage, id);
        const modified = document.metadata.updated_ms;
        const commit = setProjectPinned(document, { now_ms: now(), newId }, pinned);
        commit.document.metadata.updated_ms = modified;
        await saveProject(storage, commit.document);
        put(summarize(id, commit.document as unknown as Json));
      });
    },
    /** Duplicate: full copies with new ids, in the same folder; `(N) name`, N incrementing within the batch. */
    duplicate(ids: readonly string[], progress?: BulkProgress): Promise<BulkResult> {
      const taken = state.projects.map((project) => project.name);
      return each(ids, progress, (id) => duplicateOne(id, taken));
    },
    /** Moves projects to the trash. The record, its media and its snapshots stay; only `local.trash` is written. */
    moveToTrash(ids: readonly string[], progress?: BulkProgress): Promise<BulkResult> {
      return each(ids, progress, async (id) => {
        const project = find(id);
        const trash: TrashState = { kind: project?.templateDraft ? "template" : "project", deleted_ms: now(), ...(project?.folderId ? { originalFolderId: project.folderId } : null) };
        await writeLocal(id, (local) => { local.trash = trash; });
        if (project) put({ ...project, trash });
      });
    },
    /** Restore: back to the original folder, or the root when that folder no longer exists. */
    restore(ids: readonly string[], progress?: BulkProgress): Promise<BulkResult> {
      return each(ids, progress, async (id) => {
        const project = find(id);
        const folderId = effectiveFolder(state.folders, project?.trash?.originalFolderId ?? project?.folderId ?? null);
        await writeLocal(id, (local) => { local.trash = null; local.folderId = folderId; });
        if (project) put({ ...project, trash: null, folderId });
      });
    },
    /** Permanent deletion: the record, its media (shared bytes by reference count), thumbnails, cover, caches and snapshots. */
    deletePermanently(ids: readonly string[], progress?: BulkProgress): Promise<BulkResult> {
      return each(ids, progress, async (id) => { await storage.deleteProject(id); drop([id]); });
    },
    emptyTrash(progress?: BulkProgress): Promise<BulkResult> {
      return library.deletePermanently(state.projects.filter((project) => project.trash !== null).map((project) => project.id), progress);
    },
    /** Removes what has been in the trash for 30 days. Run at app start and every 6 hours; asks nothing. */
    async expireTrash(): Promise<string[]> {
      const expired = state.projects.filter((project) => project.trash !== null && isExpired(project.trash.deleted_ms, now())).map((project) => project.id);
      return (await library.deletePermanently(expired)).done;
    },
    /** The client-side entries of the one trash: projects, template drafts, and scripts whose record carries `trash`. */
    async trashEntries(): Promise<TrashEntry[]> {
      const entries: TrashEntry[] = state.projects.filter((project) => project.trash !== null)
        .map((project) => ({ kind: project.trash!.kind, id: project.id, name: project.name, deleted_ms: project.trash!.deleted_ms, originalLocation: project.trash!.originalFolderId ?? null }));
      for (const id of await storage.listDocuments("script").catch(() => [] as string[])) {
        const script = await storage.getDocument<Json>("script", id);
        if (isObject(script?.trash) && finite(script.trash.deleted_ms) !== null) entries.push({ kind: "script", id, name: String(script.title ?? script.name ?? ""), deleted_ms: script.trash.deleted_ms as number, originalLocation: null });
      }
      return entries.sort((a, b) => b.deleted_ms - a.deleted_ms);
    },
    async restoreScript(id: string): Promise<void> {
      const script = await storage.getDocument<Json>("script", id);
      if (script) { const { trash: _trash, ...rest } = script; await storage.putDocument("script", id, rest); }
    },
    deleteScript: (id: string): Promise<void> => storage.deleteDocument("script", id),
    /** Bytes the trashed projects hold: their records and media. They still count toward storage usage. */
    async trashBytes(): Promise<number> {
      let bytes = 0;
      for (const project of state.projects.filter((entry) => entry.trash !== null)) bytes += await library.storageBytes(project.id);
      return bytes;
    },
    async storageBytes(id: string): Promise<number> {
      const media = await storage.listMedia(id).catch(() => []);
      const record = await storage.readProjectText(id).then((text) => new TextEncoder().encode(text).byteLength).catch(() => 0);
      return record + media.reduce((sum, entry) => sum + entry.size, 0);
    },
    async info(id: string): Promise<ProjectInfo | null> {
      const summary = find(id);
      if (!summary) return null;
      const media = await storage.listMedia(id).catch(() => []);
      return { summary, mediaAssets: summary.unreadable ? media.length : summary.assets, storageBytes: media.reduce((sum, entry) => sum + entry.size, 0), location: storage.platform === "desktop" && options.libraryPath ? `${options.libraryPath}/${id}` : null };
    },

    // ── Folders ────────────────────────────────────────────────────────────────────────────────────────────────────
    async createFolder(text: string, parentId: string | null): Promise<{ ok: true; id: string } | { ok: false; reason: "empty" | "duplicate" | "depth" }> {
      parentId = effectiveFolder(state.folders, parentId);
      if (!canCreateFolderIn(state.folders, parentId)) return { ok: false, reason: "depth" };
      const name = validateFolderName(state.folders, parentId, text);
      if (!name.ok) return name;
      const folder: ProjectFolder = { id: newId(), name: name.name, parentId, created_ms: now() };
      await saveFolders([...state.folders, folder]);
      return { ok: true, id: folder.id };
    },
    async renameFolder(id: string, text: string): Promise<{ ok: true } | { ok: false; reason: "empty" | "duplicate" }> {
      const folder = state.folders.find((entry) => entry.id === id);
      const name = validateFolderName(state.folders, folder?.parentId ?? null, text, id);
      if (!name.ok || !folder) return name.ok ? { ok: false, reason: "empty" } : name;
      await saveFolders(state.folders.map((entry) => (entry.id === id ? { ...entry, name: name.name } : entry)));
      return { ok: true };
    },
    /** Moves a folder; refused into itself, into its own subtree, or past the fourth level. */
    async moveFolder(id: string, targetId: string | null): Promise<MoveRefusal> {
      const refusal = folderMoveRefusal(state.folders, id, targetId);
      if (refusal) return refusal;
      await saveFolders(state.folders.map((entry) => (entry.id === id ? { ...entry, parentId: targetId } : entry)));
      return null;
    },
    moveProjects(ids: readonly string[], folderId: string | null, progress?: BulkProgress): Promise<BulkResult> {
      const target = effectiveFolder(state.folders, folderId);
      return each(ids, progress, async (id) => {
        await writeLocal(id, (local) => { local.folderId = target; });
        const project = find(id);
        if (project) put({ ...project, folderId: target });
      });
    },
    /** Deletes a folder: every project in it, recursively, goes to the trash and the folder structure is removed. */
    async deleteFolder(id: string): Promise<BulkResult> {
      const subtree = folderSubtree(state.folders, id);
      const inside = state.projects.filter((project) => project.trash === null && project.folderId !== null && subtree.includes(project.folderId)).map((project) => project.id);
      const result = await library.moveToTrash(inside);
      if (result.failed.length === 0) await saveFolders(state.folders.filter((folder) => !subtree.includes(folder.id)));
      return result;
    },
  };
  return library;
}
export type ProjectLibrary = ReturnType<typeof createProjectLibrary>;
export const coverBlobName = (mime: string): string => (mime === "image/png" ? "cover.png" : "cover.jpg");
export { NEEDS_NEWER_APP };
