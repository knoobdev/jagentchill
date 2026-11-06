import { useRouter } from "expo-router";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { View } from "react-native";
import {
  binarySize, canCreateFolderIn, clampInput, countProjectsIn, duplicateName, durationInfo, FOLDER_NAME_MAX, folderMoveRefusal, folderPath, formatDateTime, frameRateLabel, NAME_MAX, normalizeName,
  pinTarget, PREFS, TRASH_RETENTION_DAYS, type BulkResult, type ProjectFolder, type ProjectInfo, type ProjectSummary, type TrashEntry,
} from "@jagentchill/app-core";
import {
  Button, ConfirmDialog, CopyValue, DestructiveConfirmDialog, FieldError, FormDialog, FormField, Input, Modal, Text, Tooltip, Tree, space, useTheme, useToast, type TreeItem,
} from "@jagentchill/ui";
import { carryThroughPortals, languageOf, ProgressDialog } from "@jagentchill/ui";
import { setCover, sha256, toHex, uuidV4 } from "@jagentchill/editor-core";
import {
  blobZipSource, classicOriginSource, exportProjectPackage, FILE_FORMATS, importProjectPackage, ingestClassic, loadProject, markSessionClean, openClassicBundle, packageFileName, PackageError, saveProject, trashBytes,
  type ClassicSource, type StorageLocale,
} from "@jagentchill/storage";
import { useT } from "../locale";
import { notifications } from "../notifications";
import { classicOrigin, createFileSink, scaleImage } from "../platform/media";
import { pickFiles } from "../platform/store";
import { storagePrefs, useDevice, useLibraryState, usePref } from "../state";
import { useProjectSync } from "../sync/ProjectsSync";

/** Files picked on Home or dropped on Projects, waiting for the editor of the project that was created for them. */
const pendingImports = new Map<string, File[]>();
export const takePendingImport = (projectId: string): File[] => { const files = pendingImports.get(projectId) ?? []; pendingImports.delete(projectId); return files; };
import { APP_VERSION } from "../platform/build.ts";

type Dialog =
  | { kind: "rename"; project: ProjectSummary } | { kind: "info"; info: ProjectInfo } | { kind: "trash"; projects: ProjectSummary[] }
  | { kind: "delete"; entries: TrashEntry[] } | { kind: "move"; ids: string[]; folderId?: string } | { kind: "folder"; parentId: string | null; folder?: ProjectFolder }
  | { kind: "delete-folder"; folder: ProjectFolder } | { kind: "empty-trash"; count: number };

export type ProjectActions = {
  /** "New project": creates it in the folder being viewed and opens the editor; a failed save shows "Failed to create project". */
  create(folderId?: string | null, name?: string): Promise<string | null>;
  open(project: ProjectSummary): void;
  rename(project: ProjectSummary): void;
  duplicate(ids: readonly string[]): Promise<void>;
  /** Pins the given projects when one of them is not pinned yet, unpins them when all are. The pin is part of the project and follows it to other devices. */
  togglePin(projects: readonly ProjectSummary[]): Promise<void>;
  move(ids: readonly string[]): void;
  /** A drop on a folder or a breadcrumb segment. */
  moveInto(ids: readonly string[], folderId: string | null): Promise<void>;
  moveFolderInto(id: string, folderId: string | null): Promise<void>;
  info(project: ProjectSummary): void;
  trash(projects: readonly ProjectSummary[]): void;
  restore(entries: readonly TrashEntry[]): Promise<void>;
  deleteForever(entries: readonly TrashEntry[]): void;
  emptyTrash(count: number): void;
  newFolder(parentId: string | null): void;
  renameFolder(folder: ProjectFolder): void;
  moveFolder(folder: ProjectFolder): void;
  deleteFolder(folder: ProjectFolder): void;
  /** "Export package" / "Export packages": one `.jagentchill` file per project, saved through the browser, with progress and Cancel. */
  exportPackages(ids: readonly string[]): Promise<void>;
  /** "Import project": `.jagentchill` packages, and OpenCut classic data bundles (`.zip`). */
  /** With `given`, imports those files (opened from the file manager) instead of asking for some. */
  importPackage(given?: File[]): Promise<void>;
  /** Imports the OpenCut classic data this very origin holds. */
  importClassicOrigin(): Promise<void>;
  /** "Edit cover": a picked image becomes the project's cover. */
  editCover(project: ProjectSummary): Promise<void>;
  /** "Import media" of Home: a new project that receives the picked files when its editor opens. */
  createWithMedia(files: File[], folderId?: string | null): Promise<string | null>;
  /** Bumped after every change of a thumbnail or cover, so cards re-read their image. */
  imageVersion: number; touchImages(): void;
  /** Called when a bulk action finishes, so the screen that started it clears its selection. */
  onSettled(listener: () => void): () => void;
};
const ActionsContext = createContext<ProjectActions | null>(null);
// Drawers, sheets and dialogs are drawn in the overlay stack: the context travels with them.
carryThroughPortals(ActionsContext);
export function useProjectActions(): ProjectActions {
  const actions = useContext(ActionsContext);
  if (!actions) throw new Error("useProjectActions needs a ProjectActionsProvider");
  return actions;
}

/** Every action on projects and folders, with the dialogs they open. Mounted once, so the sidebar and the screens share it. */
export function ProjectActionsProvider(props: { children: ReactNode }) {
  const t = useT();
  const syncActions = useProjectSync();
  const toast = useToast();
  const router = useRouter();
  const { library } = useDevice();
  const state = useLibraryState();
  const { storage } = useDevice();
  const theme = useTheme();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [imageVersion, setImageVersion] = useState(0);
  const [transfer, setTransfer] = useState<{ title: string; step: string; value: number | null; signal: { aborted: boolean } } | null>(null);
  const locale = languageOf(theme.locale) as StorageLocale;
  const ingest = useCallback(async (source: ClassicSource & { mediaBytes?: number }, signal: { aborted: boolean }) => {
    const summary = await ingestClassic(storage!, source, { now: Date.now, newId: () => uuidV4(), signal, locale, preferences: storagePrefs, mediaBytes: source.mediaBytes, onProgress: (progress) => setTransfer((current) => current && { ...current, step: `${progress.name} · ${t("{n} of {m}", { n: progress.index, m: progress.total })}`, value: (progress.index - 1) / Math.max(1, progress.total) }) });
    await library?.load(true);
    for (const skipped of summary.skipped) toast.show({ kind: "error", message: t("'{name}' was not imported: {reason}", { name: skipped.name, reason: `${skipped.step}: ${skipped.error}` }), sticky: true });
    if (summary.imported.length > 0) { const message = summary.imported.length === 1 ? t("'{name}' imported", { name: summary.imported[0].name }) : t("{n} projects imported", { n: summary.imported.length }); toast.show({ kind: "success", message }); notifications.add({ kind: "success", message, route: "/projects" }); }
    else if (summary.skipped.length === 0) toast.show({ kind: "info", message: t("No projects were found to import") });
  }, [storage, library, toast, t, locale]);
  // Pins used to be a list kept on this device for the sidebar only. They are moved once into the projects' own records.
  const [oldPins, setOldPins] = usePref(PREFS.projectsPinned);
  useEffect(() => {
    if (!library || state.status !== "ready" || oldPins.length === 0) return;
    const ids = oldPins.filter((id) => state.projects.some((project) => project.id === id && project.trash === null && !project.unreadable && !project.needsNewerApp));
    setOldPins([]);
    if (ids.length) void library.setPinned(ids, true);
  }, [library, state.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const [settled] = useState(() => new Set<() => void>());
  const close = useCallback(() => setDialog(null), []);

  /** Runs a bulk action with the progress toast "Processing N of M", then reports per-item failures by name. */
  const bulk = useCallback(async (count: number, run: (progress: (index: number, total: number) => void) => Promise<BulkResult>, done?: (result: BulkResult) => string | null) => {
    const id = count > 1 ? toast.show({ kind: "progress", message: t("Processing {n} of {m}", { n: 1, m: count }), progress: 0 }) : null;
    let result: BulkResult;
    try {
      result = await run((index, total) => { if (id !== null) toast.update(id, { message: t("Processing {n} of {m}", { n: index, m: total }), progress: (index - 1) / total }); });
    } catch (error) {
      if (id !== null) toast.dismiss(id);
      toast.show({ kind: "error", message: error instanceof Error ? error.message : String(error) });
      return null;
    }
    if (id !== null) toast.dismiss(id);
    for (const failure of result.failed) toast.show({ kind: "error", message: failure.name ? `${failure.name}: ${failure.message}` : failure.message, sticky: true });
    const message = done?.(result);
    if (message && result.done.length > 0) toast.show({ kind: "success", message });
    for (const listener of settled) listener();
    return result;
  }, [toast, t, settled]);

  const actions = useMemo<ProjectActions>(() => ({
    imageVersion, touchImages: () => setImageVersion((version) => version + 1),
    async exportPackages(ids) {
      if (!storage || ids.length === 0) return;
      const signal = { aborted: false }, failed: string[] = [], offline: string[] = [];
      let done = 0;
      for (const [index, id] of ids.entries()) {
        if (signal.aborted) break;
        const name = library?.find(id)?.name ?? "";
        const step = ids.length > 1 ? t("Processing {n} of {m} — exporting packages", { n: index + 1, m: ids.length }) : name;
        setTransfer({ title: ids.length > 1 ? t("Export packages") : t("Export package"), step, value: 0, signal });
        try {
          const sink = await createFileSink(packageFileName(name, "project"), FILE_FORMATS.project.mime);
          const summary = await exportProjectPackage(storage, id, sink, { appVersion: APP_VERSION, now_ms: Date.now(), signal, locale, onProgress: (progress) => setTransfer((current) => current && { ...current, value: progress.percent / 100 }) });
          offline.push(...summary.offline.map((entry) => `${name}: ${entry.name}`));
          done++;
        } catch (error) { if (!(error instanceof PackageError && error.code === "cancelled")) failed.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
      }
      setTransfer(null);
      for (const message of failed) toast.show({ kind: "error", message, sticky: true });
      if (offline.length > 0) toast.show({ kind: "warning", message: t("Skipped offline media: {names}", { names: offline.join(", ") }), sticky: true });
      if (done > 0) { const message = done === 1 ? t("Package exported") : t("{n} packages exported", { n: done }); toast.show({ kind: "success", message }); notifications.add({ kind: "success", message }); }
      for (const listener of settled) listener();
    },
    async importPackage(given?: File[]) {
      if (!storage) return;
      const files = given ?? await pickFiles(".jagentchill,.zip,application/zip,application/vnd.jagentchill.project+zip", true);
      const signal = { aborted: false };
      for (const file of files) {
        if (signal.aborted) break;
        setTransfer({ title: t("Import project"), step: file.name, value: 0, signal });
        try {
          const source = blobZipSource(file);
          // A classic data bundle is recognised by its manifest; everything else is read as a project package.
          const classic = /\.zip$/i.test(file.name) ? await openClassicBundle(source, locale).then(async (bundle) => ((await bundle.projects().catch(() => [])).length > 0 ? bundle : null), () => null) : null;
          if (classic) { await ingest(classic, signal); continue; }
          // A project with the packaged name exists: the import is named by the duplicate rule, and nothing is replaced.
          const taken = (library?.getState().projects ?? []).map((project) => project.name);
          const summary = await importProjectPackage(storage, source, { now_ms: Date.now(), newId: () => uuidV4(), signal, locale, rename: (name) => (taken.includes(name) ? duplicateName(name, taken) : name), trashBytes: await trashBytes(storage).catch(() => 0), onProgress: (progress) => setTransfer((current) => current && { ...current, value: progress.percent / 100 }) });
          await library?.refresh(summary.projectId);
          const message = t("'{name}' imported", { name: summary.name });
          toast.show({ kind: "success", message, action: { label: t("Open"), onPress: () => router.push(`/editor/${summary.projectId}` as never) } });
          notifications.add({ kind: "success", message, route: `/editor/${summary.projectId}` });
          if (summary.offline.length > 0) toast.show({ kind: "warning", message: summary.offline.length === 1 ? t("1 media file is offline") : t("{n} media files are offline", { n: summary.offline.length }), sticky: true });
        } catch (error) {
          if (error instanceof PackageError && error.code === "cancelled") break;
          const message = `${file.name}: ${error instanceof Error ? error.message : String(error)}`;
          toast.show({ kind: "error", message, sticky: true });
          notifications.add({ kind: "error", message });
        }
      }
      setTransfer(null);
    },
    async importClassicOrigin() {
      const origin = classicOrigin();
      if (!storage || !origin) return;
      const signal = { aborted: false };
      setTransfer({ title: t("Import from OpenCut"), step: "", value: null, signal });
      try { await ingest(classicOriginSource(origin), signal); } catch (error) { toast.show({ kind: "error", message: error instanceof Error ? error.message : String(error), sticky: true }); }
      setTransfer(null);
    },
    async editCover(project) {
      if (!storage) return;
      const [file] = await pickFiles("image/png,image/jpeg", false);
      if (!file) return;
      try {
        // A cover is at most 1920 px on its long side, JPEG, or PNG when the picture has transparency.
        const scaled = await scaleImage(file, 1920);
        if (!scaled) { toast.show({ kind: "error", message: t("Unable to read {name}", { name: file.name }) }); return; }
        const { bytes, mime } = scaled;
        const { document } = await loadProject(storage, project.id);
        const commit = setCover(document, { now_ms: Date.now(), newId: () => uuidV4() }, { source: "image", image: { sha256: toHex(sha256(bytes)), mime, width: scaled.width, height: scaled.height } });
        await storage.putBlob("cover", project.id, mime === "image/png" ? "cover.png" : "cover.jpg", bytes);
        await storage.deleteBlob("cover", project.id, mime === "image/png" ? "cover.jpg" : "cover.png").catch(() => undefined);
        await saveProject(storage, commit.document);
        await library?.refresh(project.id);
        setImageVersion((version) => version + 1);
        toast.show({ kind: "success", message: t("Cover updated") });
      } catch (error) { toast.show({ kind: "error", message: error instanceof Error ? error.message : String(error) }); }
    },
    async createWithMedia(files, folderId = null) {
      if (!library || files.length === 0) return null;
      try {
        const id = await library.create({ folderId, name: t("New project") });
        pendingImports.set(id, files);
        router.push(`/editor/${id}` as never);
        return id;
      } catch { toast.show({ kind: "error", message: t("Failed to create project") }); return null; }
    },
    onSettled(listener) { settled.add(listener); return () => void settled.delete(listener); },
    async create(folderId = null, name) {
      if (!library) return null;
      try {
        // The default name is given in the UI language; it is the user's own text from then on.
        const id = await library.create({ folderId, name: name ?? t("New project") });
        router.push(`/editor/${id}` as never);
        return id;
      } catch {
        toast.show({ kind: "error", message: t("Failed to create project") });
        return null;
      }
    },
    open(project) { if (!project.unreadable && !project.needsNewerApp && project.trash === null) router.push(`/editor/${project.id}` as never); },
    rename: (project) => setDialog({ kind: "rename", project }),
    async duplicate(ids) {
      if (!library) return;
      await bulk(ids.length, (progress) => library.duplicate(ids, progress), (result) => (result.created.length === 1 ? t("Project duplicated") : t("{n} projects duplicated", { n: result.created.length })));
    },
    async togglePin(projects) {
      const able = projects.filter((project) => !project.unreadable && !project.needsNewerApp);
      if (!library || able.length === 0) return;
      const pin = pinTarget(able);
      await bulk(able.length, (progress) => library.setPinned(able.map((project) => project.id), pin, progress));
    },
    move: (ids) => setDialog({ kind: "move", ids: [...ids] }),
    async moveInto(ids, folderId) {
      if (!library || ids.length === 0) return;
      const name = folderId === null ? t("All projects") : state.folders.find((folder) => folder.id === folderId)?.name ?? "";
      await bulk(ids.length, (progress) => library.moveProjects(ids, folderId, progress), (result) => (result.done.length === 1 ? t("Moved to {name}", { name }) : t("{n} projects moved to {name}", { n: result.done.length, name })));
    },
    async moveFolderInto(id, folderId) {
      if (!library) return;
      const refusal = await library.moveFolder(id, folderId);
      if (refusal === "descendant" || refusal === "self") toast.show({ kind: "warning", message: t("A folder cannot be moved into itself or its subfolders") });
      else if (refusal === "depth") toast.show({ kind: "warning", message: t("Folders can be nested up to 4 levels") });
      else if (refusal === "duplicate") toast.show({ kind: "warning", message: t("A folder with this name already exists") });
    },
    async info(project) { const info = await library?.info(project.id); if (info) setDialog({ kind: "info", info }); },
    trash: (projects) => { if (projects.length) setDialog({ kind: "trash", projects: [...projects] }); },
    async restore(entries) {
      if (!library) return;
      await bulk(entries.length, async (progress) => {
        const projects = await library.restore(entries.filter((entry) => entry.kind !== "script").map((entry) => entry.id), progress);
        for (const entry of entries.filter((item) => item.kind === "script")) await library.restoreScript(entry.id);
        return projects;
      }, (result) => (entries.length === 1 ? t("'{name}' restored", { name: entries[0].name }) : t("{n} items restored", { n: result.done.length })));
    },
    deleteForever: (entries) => { if (entries.length) setDialog({ kind: "delete", entries: [...entries] }); },
    emptyTrash: (count) => setDialog({ kind: "empty-trash", count }),
    newFolder: (parentId) => setDialog({ kind: "folder", parentId }),
    renameFolder: (folder) => setDialog({ kind: "folder", parentId: folder.parentId, folder }),
    moveFolder: (folder) => setDialog({ kind: "move", ids: [], folderId: folder.id }),
    deleteFolder: (folder) => setDialog({ kind: "delete-folder", folder }),
  }), [library, storage, router, toast, t, bulk, state.folders, imageVersion, settled, ingest, locale]);

  const projectsIn = dialog?.kind === "delete-folder" ? countProjectsIn(state.folders, state.projects, dialog.folder.id) : 0;
  return (
    <ActionsContext.Provider value={actions}>
      {props.children}
      {transfer ? <ProgressDialog open title={transfer.title} step={transfer.step} value={transfer.value} onCancel={() => { transfer.signal.aborted = true; }} onClose={() => { transfer.signal.aborted = true; }} /> : null}
      {dialog?.kind === "rename" ? <RenameDialog project={dialog.project} onClose={close} onRename={async (name) => {
        try { await library?.rename(dialog.project.id, name); } catch { toast.show({ kind: "error", message: t("Failed to rename '{name}'", { name: dialog.project.name }) }); }
        close();
      }} /> : null}
      {dialog?.kind === "info" ? <InfoDialog info={dialog.info} onClose={close} /> : null}
      {dialog?.kind === "trash" ? (
        <ConfirmDialog open title={dialog.projects.length === 1 ? t("Move '{name}' to trash?", { name: dialog.projects[0].name || t("Unreadable project") }) : t("Move {n} projects to trash?", { n: dialog.projects.length })}
          description={t("Items in the trash are kept for {n} days, then deleted permanently.", { n: TRASH_RETENTION_DAYS })} confirmLabel={t("Move to trash")} onClose={close}
          onConfirm={() => { const projects = dialog.projects, ids = projects.map((project) => project.id); close(); void syncActions.beforeTrash(projects).then((allowed) => { if (allowed) void bulk(ids.length, (progress) => library!.moveToTrash(ids, progress), (result) => (result.done.length === 1 ? t("Moved to trash") : t("{n} projects moved to trash", { n: result.done.length }))); }); }} />
      ) : null}
      {dialog?.kind === "delete" ? (
        <DestructiveConfirmDialog open irreversible confirmWord="DELETE" count={dialog.entries.length}
          title={dialog.entries.length === 1 ? t("Delete '{name}' permanently?", { name: dialog.entries[0].name || t("Unreadable project") }) : t("Delete {n} projects permanently?", { n: dialog.entries.length })}
          description={t("This removes the project, its media, thumbnails, caches and version history from this device. It cannot be undone.")} confirmLabel={t("Delete permanently")} onClose={close}
          onConfirm={() => {
            const entries = dialog.entries; close();
            void bulk(entries.length, async (progress) => {
              const result = await library!.deletePermanently(entries.filter((entry) => entry.kind !== "script").map((entry) => entry.id), progress);
              for (const entry of entries.filter((item) => item.kind === "script")) await library!.deleteScript(entry.id);
              return result;
            }, () => t("Deleted permanently"));
          }} />
      ) : null}
      {dialog?.kind === "empty-trash" ? (
        <DestructiveConfirmDialog open irreversible confirmWord="DELETE" count={dialog.count} title={t("Delete {n} projects permanently?", { n: dialog.count })}
          description={t("This removes the project, its media, thumbnails, caches and version history from this device. It cannot be undone.")} confirmLabel={t("Delete permanently")} onClose={close}
          onConfirm={() => { close(); void bulk(dialog.count, (progress) => library!.emptyTrash(progress), () => t("Trash emptied")); }} />
      ) : null}
      {dialog?.kind === "folder" ? <FolderDialog folders={state.folders} parentId={dialog.parentId} folder={dialog.folder} onClose={close}
        onSubmit={async (name) => {
          const result = dialog.folder ? await library!.renameFolder(dialog.folder.id, name) : await library!.createFolder(name, dialog.parentId);
          if (result.ok) close();
          return result.ok ? null : result.reason;
        }} /> : null}
      {dialog?.kind === "move" ? <MoveDialog folders={state.folders} movingFolder={dialog.folderId} count={dialog.ids.length} onClose={close}
        onNewFolder={(parentId) => library!.createFolder(t("New folder"), parentId).then((made) => (made.ok ? made.id : null))}
        onMove={(target) => { const moving = dialog; close(); if (moving.folderId) void actions.moveFolderInto(moving.folderId, target); else void actions.moveInto(moving.ids, target); }} /> : null}
      {dialog?.kind === "delete-folder" ? (
        <ConfirmDialog open title={t("Delete folder '{name}' and move {n} projects to trash?", { name: dialog.folder.name, n: projectsIn })}
          description={t("Items in the trash are kept for {n} days, then deleted permanently.", { n: TRASH_RETENTION_DAYS })} confirmLabel={t("Delete folder")} onClose={close}
          onConfirm={() => {
            const folder = dialog.folder; close();
            void library!.deleteFolder(folder.id).then((result) => {
              for (const failure of result.failed) toast.show({ kind: "error", message: `${failure.name}: ${failure.message}`, sticky: true });
              if (result.failed.length === 0) toast.show({ kind: "success", message: t("Folder deleted") });
            });
          }} />
      ) : null}
    </ActionsContext.Provider>
  );
}

function RenameDialog(props: { project: ProjectSummary; onClose(): void; onRename(name: string): void }) {
  const t = useT();
  const [name, setName] = useState(props.project.name);
  const valid = normalizeName(name) !== null;
  return (
    <FormDialog open title={t("Rename project")} submitLabel={t("Rename")} dirty={name !== props.project.name} canSubmit={valid} onClose={props.onClose} onSubmit={() => props.onRename(name)}>
      <FormField label={t("New name")}>
        <Input accessibilityLabel={t("New name")} autoFocus selectTextOnFocus value={name} onChangeText={(text) => setName(clampInput(text, NAME_MAX))} onSubmitEditing={(event) => { const text = clampInput(event.nativeEvent.text, NAME_MAX); if (normalizeName(text) !== null) props.onRename(text); }} />
      </FormField>
    </FormDialog>
  );
}

function FolderDialog(props: { folders: readonly ProjectFolder[]; parentId: string | null; folder?: ProjectFolder; onClose(): void; onSubmit(name: string): Promise<"empty" | "duplicate" | "depth" | null> }) {
  const t = useT();
  const [name, setName] = useState(props.folder?.name ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async (text: string = name) => {
    const reason = await props.onSubmit(text);
    setProblem(reason === "duplicate" ? t("A folder with this name already exists") : reason === "depth" ? t("Folders can be nested up to 4 levels") : null);
  };
  const valid = normalizeName(name, FOLDER_NAME_MAX) !== null;
  return (
    <FormDialog open title={props.folder ? t("Rename folder") : t("New folder")} submitLabel={props.folder ? t("Rename") : t("Create")} dirty={name !== (props.folder?.name ?? "")} canSubmit={valid} onClose={props.onClose} onSubmit={() => void submit()}>
      <FormField label={t("Folder name")}>
        <Input accessibilityLabel={t("Folder name")} autoFocus selectTextOnFocus value={name} invalid={Boolean(problem)} onChangeText={(text) => { setName(clampInput(text, FOLDER_NAME_MAX)); setProblem(null); }} onSubmitEditing={(event) => { const text = clampInput(event.nativeEvent.text, FOLDER_NAME_MAX); if (normalizeName(text, FOLDER_NAME_MAX) !== null) void submit(text); }} />
        {problem ? <FieldError message={problem} /> : null}
      </FormField>
    </FormDialog>
  );
}

const ROOT = "__root__";
/** "Move to folder": the folder tree with the root "All projects", and "New folder" inside the selected one. */
function MoveDialog(props: { folders: readonly ProjectFolder[]; movingFolder?: string; count: number; onClose(): void; onMove(folderId: string | null): void; onNewFolder(parentId: string | null): Promise<string | null> }) {
  const t = useT();
  const [selected, setSelected] = useState<string>(ROOT);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([ROOT]));
  const build = (parentId: string | null): TreeItem[] => props.folders.filter((folder) => folder.parentId === parentId && folder.id !== props.movingFolder)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }))
    .map((folder) => ({ id: folder.id, label: folder.name, icon: "folder" as const, children: build(folder.id) }));
  const target = selected === ROOT ? null : selected;
  const refusal = props.movingFolder ? folderMoveRefusal(props.folders, props.movingFolder, target) : null;
  const canNest = canCreateFolderIn(props.folders, target);
  const newFolder = <Button kind="ghost" icon="plus" label={t("New folder")} disabled={!canNest} onPress={() => void props.onNewFolder(target).then((id) => { if (id) { setExpanded((open) => new Set([...open, selected])); setSelected(id); } })} />;
  return (
    <Modal title={t("Move to folder")} description={props.movingFolder ? undefined : props.count === 1 ? t("Choose where to move the project.") : t("Choose where to move {n} projects.", { n: props.count })} width={480} onClose={props.onClose}
      footer={<>{canNest ? newFolder : <Tooltip label={t("Folders can be nested up to 4 levels")}>{newFolder}</Tooltip>}<View style={{ flex: 1 }} /><Button kind="ghost" label={t("Cancel")} onPress={props.onClose} /><Button kind="primary" label={t("Move")} disabled={refusal !== null} onPress={() => props.onMove(target)} /></>}>
      <Tree label={t("Folders")} nodes={[{ id: ROOT, label: t("All projects"), icon: "folder", children: build(null) }]} expanded={expanded} onExpandedChange={setExpanded}
        selected={new Set([selected])} onSelectedChange={(next) => { const [id] = [...next]; if (id) setSelected(id); }} height={280} />
      {refusal === "depth" ? <FieldError message={t("Folders can be nested up to 4 levels")} /> : refusal === "duplicate" ? <FieldError message={t("A folder with this name already exists")} /> : null}
    </Modal>
  );
}

function InfoDialog(props: { info: ProjectInfo; onClose(): void }) {
  const t = useT();
  const theme = useTheme();
  const { summary, mediaAssets, storageBytes, location } = props.info;
  const { folders } = useLibraryState();
  const path = folderPath(folders, summary.folderId).map((folder) => folder.name).join(" / ");
  const rows: Array<[string, ReactNode]> = [
    [t("Name"), summary.name || t("Unreadable project")],
    [t("Duration"), durationInfo(summary.duration)],
    [t("Canvas"), summary.canvasSize ? `${summary.canvasSize.width} × ${summary.canvasSize.height}` : "—"],
    [t("Frame rate"), summary.fps ? t("{fps} fps", { fps: frameRateLabel(summary.fps) }) : "—"],
    [t("Created"), summary.created_ms ? formatDateTime(summary.created_ms, theme.locale) : "—"],
    [t("Modified"), summary.updated_ms ? formatDateTime(summary.updated_ms, theme.locale) : "—"],
    [t("Scenes"), summary.scenes === 1 ? t("1 scene") : t("{n} scenes", { n: summary.scenes })],
    [t("Media"), mediaAssets === 1 ? t("1 media asset") : t("{n} media assets", { n: mediaAssets })],
    [t("Storage used"), binarySize(storageBytes)],
    [t("Storage location"), location ?? t("App storage")],
    [t("Folder"), path || t("All projects")],
    [t("Schema version"), summary.schemaVersion === null ? "—" : String(summary.schemaVersion)],
    [t("Sync"), t("On this device only")],
  ];
  const links = [summary.links.film ? t("From film") : null, summary.links.workflow ? t("From workflow") : null, summary.links.scripts ? t("From script") : null].filter(Boolean).join(" · ");
  if (links) rows.push([t("Origin"), links]);
  return (
    <Modal title={t("Project info")} width={480} onClose={props.onClose} footer={<><View style={{ flex: 1 }} /><Button kind="secondary" label={t("Close")} onPress={props.onClose} /></>}>
      <View role="table">
        {rows.map(([key, value]) => (
          <View key={key} role="row" style={{ flexDirection: "row", gap: space[3], paddingVertical: space[1.5], borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }}>
            <Text color="text/secondary" style={{ width: 140 }}>{key}</Text>
            <View style={{ flex: 1, minWidth: 0 }}>{typeof value === "string" ? <Text selectable>{value}</Text> : value}</View>
          </View>
        ))}
      </View>
      <CopyValue label={t("Project ID")} value={summary.id} />
    </Modal>
  );
}
