import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { TextInput, View } from "react-native";
import {
  areaAllowed, bindingKeys, CANVAS_PRESETS, clampInput, commitTitle, createEditorController, dimensionMessage, documentTitle, EDITOR_BINDINGS, EDITOR_PREFS, frameRateOptions, GRADIENT_PRESETS, NAME_MAX, parseDimension, PATTERN_PRESETS, presetOf, rateKey,
  PREFS, RESOLUTIONS, scaleToShortSide, SOLID_SWATCHES, THUMBNAIL_NAME, type BackgroundPreset, type EditorController,
} from "@jagentchill/app-core";
import { acceptPatch, renameProject, setCanvasSize, setFrameRate, setProjectBackground, timeline, uuidV4, type Commit, type CommitContext, type StatePatch } from "@jagentchill/editor-core";
import type { SyncSession } from "@jagentchill/client";
import { MEDIA_MESSAGES, settleArrivedMedia } from "@jagentchill/media";
import type { Background, ProjectDocument, SyncComment } from "@jagentchill/protocol";
import {
  createProjectAutosave, createSnapshotManager, markImportedOpened, markProjectOpened, markSessionClean, openProjectLock, PREFERENCES, recordSaveState, storageString, trashBytes,
  type ProjectAutosave, type ProjectLock, type ProjectLockView, type SaveDialog, type SaveStatus, type SnapshotManager, type StorageLocale,
} from "@jagentchill/storage";
import {
  Banner, Button, ColorPicker, ConfirmDialog, FieldError, FormField, Icon, IconButton, Input, languageOf, Logo, Menu, Modal, PanelGroup, Select, ShortcutText, Tabs, Tap, Text, Tooltip, control, radius, space, useTheme, useToast, type MenuItem,
} from "@jagentchill/ui";
import { useHost } from "../host";
import { loadSigner } from "../identity";
import { useT } from "../locale";
import { MediaSheet } from "../media/MediaSheet";
import { createMediaSession, type MediaSession } from "../media/session";
import { fetchHostMediaPicture, importRemoteMedia } from "../media/remote-media";
import { ensureRemoteProject } from "../media/remote-project";
import { editorInstanceId, lockSignal, onWindowFocus } from "../platform/media";
import { guardUnload, onWindowKey, renderBackgroundFrame, setDocumentTitle } from "../platform/store";
import { takePendingImport, useProjectActions } from "../projects/actions";
import { StarterMusic } from "../music/StarterMusic";
import { SaveTemplateDialog } from "../templates/SaveTemplateDialog";
import { TemplateEditor } from "../templates/TemplateEditor";
import { Screen } from "../shell/Shell";
import { PresenceStrip, SyncBanner, SyncChip, SyncDialogs, continueAt } from "../sync/EditorSync";
import { EditorProposals } from "../agents/proposals/EditorProposals";
import { CommentsPanel, ComparePlayers, HostVersions } from "../sync/SyncPanels";
import { LookOnHost } from "../sync/ProjectsSync";
import { arrivedProbe, useSyncEngine } from "../sync/SyncProvider";
import { getPref, setPref, storagePrefs, useDevice, usePref } from "../state";
import { AssetPanel } from "./AssetPanel";
import { EditorContext } from "./context";
import { CoverEditor } from "./CoverEditor";
import { bindKeys, isMac, trackDrags } from "./dom";
import { ExportDialog } from "./ExportDialog";
import { AgentPanelDock, AgentPanelToggle, useAgentPanel } from "./AgentPanel";
import { DesktopMenuBridge } from "./DesktopMenuBridge";
import { ExportIndicator } from "./export/Indicators";
import { peekExportAgain } from "./export/hooks";
import { exportService } from "./export/service";
import { EditorSkeleton } from "./EditorSkeleton";
import { Inspector } from "./Inspector";
import { Player } from "./Player";
import { createLutStore } from "./inspector/luts";
import { createEditorRuntime, type EditorRuntime } from "./runtime";
import { Timeline } from "./Timeline";
import { CompactEditor, CompactTopBar } from "./compact/CompactEditor";
import { isPhoneEditor } from "./compact/layout";
import { VersionHistory } from "./VersionHistory";

type Load = { state: "loading" } | { state: "not-found" } | { state: "error"; error: unknown; hasSnapshot: boolean } | { state: "ok" };
const sameBackground = (a: Background, b: Background) => JSON.stringify(a) === JSON.stringify(b);
/** How a background is drawn on a surface of the app: a fill, a CSS gradient, or the 16 px checkerboard of the transparent one. */
export function backgroundStyle(background: Background, checker: [string, string]): object {
  if (background.kind === "color") return { backgroundColor: background.color };
  if (background.kind === "gradient") return { backgroundImage: background.css };
  if (background.kind === "transparent") return { backgroundImage: `repeating-conic-gradient(${checker[0]} 0% 25%, ${checker[1]} 0% 50%)`, backgroundSize: "32px 32px" };
  // Blur and image backgrounds need the clip or the asset: with neither on the frame they render black.
  return { backgroundColor: "black" }; // content-colour
}
const PREF_STORE = { get: getPref, set: setPref } as never;
/**
 * The save status as its own small store. Every edit — and every scroll or zoom of the timeline, whose view is saved
 * with the project — moves it "saving" → "saved"; held as state of the screen, that rendered the whole screen (its bar,
 * and through the document it hands down, the media panel) twice per change. Only the words "Saving… / Saved" follow
 * it now (`SaveState`); the screen itself renders for what IT shows of a save: a banner, a dialog, a failure.
 */
type SaveStore = { get(): SaveStatus | null; set(next: SaveStatus | null): void; subscribe(listener: () => void): () => void };
function createSaveStore(): SaveStore {
  let current: SaveStatus | null = null;
  const listeners = new Set<() => void>();
  return { get: () => current, set(next) { current = next; for (const listener of [...listeners]) listener(); }, subscribe(listener) { listeners.add(listener); return () => void listeners.delete(listener); } };
}
const saveProblem = (status: SaveStatus | null): boolean => status?.state === "failed" || status?.state === "storage-full";
/** Whether two statuses are the same to the screen around the regions: its banner, its dialog and whether the save failed. */
const sameForScreen = (a: SaveStatus | null, b: SaveStatus | null): boolean => a === b || (!!a && !!b && saveProblem(a) === saveProblem(b) && (!saveProblem(a) || a.state === b.state) && JSON.stringify([a.banner ?? null, a.dialog ?? null]) === JSON.stringify([b.banner ?? null, b.dialog ?? null]));
const SAVE_WORDS: Record<string, string> = { saved: "Saved", "storage-full": "Storage full — not saved", failed: "Save failed — Retry", saving: "Saving…" };
const saveWords = (status: SaveStatus | null): string => SAVE_WORDS[status?.state ?? "saved"] ?? SAVE_WORDS.saving;
/** The save state in the editor's bar: "Saved", "Saving…", or the failure with its retry. */
function SaveState(props: { store: SaveStore; readOnly: boolean; exiting: boolean; onRetry(): void }) {
  const t = useT();
  const status = useSyncExternalStore(props.store.subscribe, props.store.get, props.store.get), indicator = t(saveWords(status));
  if (props.readOnly) return <Text variant="meta" color="text/secondary" testID="save-state">{t("Read-only")}</Text>;
  if (saveProblem(status)) return <Button kind="ghost" size="xs" tone="danger" icon="warn" label={indicator} onPress={props.onRetry} testID="save-state" />;
  return <Text variant="meta" color="text/secondary" live="polite" testID="save-state">{props.exiting ? t("Exiting project…") : indicator}</Text>;
}
/** The same for a bar that draws the words itself (the phone's): it is given the words and whether the save failed. */
function WithSaveState(props: { store: SaveStore; children(indicator: string, failed: boolean): ReactNode }) {
  const t = useT();
  const status = useSyncExternalStore(props.store.subscribe, props.store.get, props.store.get);
  return <>{props.children(t(saveWords(status)), saveProblem(status))}</>;
}
/** How long the view state (playhead, zoom, scroll) may wait before it is written. */
const LOCAL_SAVE_MS = 300;

/**
 * The editor route: the loading, not-found and load-error states of a project, and for an open one the top bar and
 * the four regions — asset panel, player, inspector and timeline — over one editing session.
 */
export function EditorScreen(props: { projectId: string }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const router = useRouter();
  const actions = useProjectActions();
  const hostState = useHost();
  const liveHostState = useRef(hostState);
  liveHostState.current = hostState;
  const { status: hostStatus } = hostState;
  const { library, storage } = useDevice();
  const syncEngine = useSyncEngine();
  const syncRef = useRef<SyncSession | null>(null);
  const [syncSession, setSyncSession] = useState<SyncSession | null>(null);
  // Another device (or an agent on the host) holds the edit lease: this one follows, view-only.
  const [syncReadOnly, setSyncReadOnly] = useState<string | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const agentPanel = useAgentPanel();
  const [projectComments, setProjectComments] = useState<SyncComment[]>([]);
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null);
  const linkedCommentHandled = useRef<string | null>(null);
  // The time "Follow" last moved this editor to: a move that is not the user's does not turn Follow off.
  const followed = useRef<number | null>(null);
  const locale = languageOf(theme.locale) as StorageLocale;
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [runtime, setRuntime] = useState<EditorRuntime | null>(null);
  // What the screen shows of a save (see `SaveStore`): this state changes only when that does.
  const [status, setStatus] = useState<SaveStatus | null>(null);
  const [saveStore] = useState(createSaveStore);
  const [exiting, setExiting] = useState(false);
  const [menu, setMenu] = useState(false);
  const [settings, setSettings] = useState<"info" | "background" | null>(null);
  // One function for the regions that open the project settings: a new one on every render would render them all again.
  const openSettings = useCallback(() => setSettings("info"), []);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [, setTick] = useState(0);
  const [media, setMedia] = useState<MediaSession | null>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [lock, setLock] = useState<ProjectLockView | null>(null);
  const [leave, setLeave] = useState<SaveDialog | null>(null);
  const [versions, setVersions] = useState(false);
  const [preview, setPreview] = useState<{ document: ProjectDocument; label: string; id: string } | null>(null);
  const [previewRuntime, setPreviewRuntime] = useState<EditorRuntime | null>(null);
  const [panels, setPanels] = usePref(PREFS.editorPanels);
  const [regions, setRegions] = usePref(EDITOR_PREFS.regions);
  const [sheet, setSheet] = useState(false);
  const menuRef = useRef<View>(null);
  const controllerRef = useRef<EditorController | null>(null);
  const runtimeRef = useRef<EditorRuntime | null>(null);
  const autosave = useRef<ProjectAutosave | null>(null);
  const snapshots = useRef<SnapshotManager | null>(null);
  const lockRef = useRef<ProjectLock | null>(null);
  const lockRole = useRef<boolean | null>(null);
  const mediaRef = useRef<MediaSession | null>(null);
  const localTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readOnly = useRef(false);
  const phoneRef = useRef(false);
  const hostConnected = useRef(false);
  const translate = useRef(t);
  translate.current = t;
  hostConnected.current = hostStatus === "connected";
  readOnly.current = Boolean(lock?.readOnly) || preview !== null || syncReadOnly !== null;
  // One id per tab, kept across a reload of the tab, so a reloaded editor still owns the project it had open.
  const [instanceId] = useState(() => editorInstanceId(() => uuidV4()));

  const context = useCallback((): CommitContext => ({ now_ms: Date.now(), newId: () => uuidV4() }), []);
  const flushLocal = useCallback(() => {
    if (localTimer.current) { clearTimeout(localTimer.current); localTimer.current = null; }
    const controller = controllerRef.current;
    if (controller && autosave.current && !readOnly.current) autosave.current.changeLocal(controller.stored);
  }, []);
  const closeSession = useCallback(async () => {
    flushLocal();
    runtimeRef.current?.close(); runtimeRef.current = null;
    controllerRef.current?.close(); controllerRef.current = null;
    const session = mediaRef.current;
    mediaRef.current = null;
    await session?.close().catch(() => undefined);
    snapshots.current?.stop(); snapshots.current = null;
    // Pending operations are pushed and the edit lease is released before the save manager stops.
    const synced = syncRef.current;
    syncRef.current = null;
    await synced?.close().catch(() => undefined);
    autosave.current?.stop();
    const held = lockRef.current;
    lockRef.current = null;
    await held?.release().catch(() => undefined);
  }, [flushLocal]);

  const openNow = useCallback(async (isCurrent: () => boolean) => {
    if (!library || !storage) return;
    setLoad({ state: "loading" });
    setRuntime(null);
    await closeSession();
    if (!isCurrent()) return;
    await library.load();
    if (!isCurrent()) return;
    const result = await library.open(props.projectId);
    if (!isCurrent()) return;
    if (result.state !== "ok") { setLoad(result); return; }
    const loaded = result.loaded.document;
    const engine = syncEngine, synced = engine ? await engine.startRevision(props.projectId) : { synced: false, revision: 0 };
    if (!isCurrent()) return;
    const save = createProjectAutosave({
      port: storage, document: loaded, locale, trashBytes: () => trashBytes(storage),
      // A synced project journals one state patch per committed command; sync pushes the journal.
      synced: () => engine?.isSynced(props.projectId) === true, revision: synced.revision,
      onStatus: (next) => { saveStore.set(next); setStatus((shown) => (sameForScreen(shown, next) ? shown : next)); void recordSaveState(storage, next); if (next.state === "saved" && autosave.current === save) library.noteSaved(save.document); },
    });
    autosave.current = save;
    saveStore.set(save.status); setStatus(save.status);
    // Every change of the project goes through the controller: one history, one save, one notification.
    const controller = createEditorController({
      document: loaded, newId: () => uuidV4(), platform: () => (phoneRef.current ? "mobile" : "web"), prefs: () => getPref(EDITOR_PREFS.timeline),
      onCommit: (commit) => { if (autosave.current !== save) return undefined; const settled = save.commit(commit); if (settled.patch.length > 0) syncRef.current?.noteCommit(); return settled.document; },
      onLocal: () => { localTimer.current ??= setTimeout(() => { localTimer.current = null; if (autosave.current === save && controllerRef.current === controller && !readOnly.current) save.changeLocal(controller.stored); }, LOCAL_SAVE_MS); },
      onMessage: (message) => toast.show({ kind: "error", message: translate.current(message) }),
    });
    controllerRef.current = controller;
    // Only one editor instance writes a project on this device: a second window opens it read-only.
    const projectLock = openProjectLock({ port: storage, projectId: props.projectId, instanceId, locale, signal: lockSignal(), onRelinquish: () => save.flush(),
      // Only a window that was read-only and became the writer reloads; acquiring and releasing the lock are not such a change.
      onChange: (view) => { if (lockRef.current !== projectLock) return; setLock(view); const was = lockRole.current; lockRole.current = view.readOnly; if (was === true && !view.readOnly) void open(); },
    });
    lockRef.current = projectLock;
    lockRole.current = null;
    const view = await projectLock.acquire().catch(() => null);
    if (!isCurrent()) { await closeSession(); return; }
    lockRole.current = view ? view.readOnly : null;
    setLock(view);
    if (view?.readOnly) controller.setReadOnly(translate.current("Read-only"));
    setSyncReadOnly(null);
    setSyncSession(null);
    if (view && !view.readOnly && engine) {
      // The sync session of the project: it pushes what the save manager journals and shows what other writers push.
      const session = engine.open(props.projectId, {
        flush: () => save.flush(),
        document: () => controller.stored,
        replace: (next) => { const local = (controller.stored as { local?: unknown }).local, document = (local === undefined ? next : { ...next, local }) as ProjectDocument; controller.replace(document); save.replace(document); },
        rebase: (revision) => save.rebase(revision),
        setReadOnly: (reason) => { if (syncRef.current === session || syncRef.current === null) setSyncReadOnly(reason); },
        busy: () => controller.session.gestureActive,
        applyStep: (patches, label) => { try { return controller.external((document) => ({ document: acceptPatch(document, patches as StatePatch), patch: patches as StatePatch, commandType: "sync.applyRemote", label, history: true, nearSizeLimit: false })); } catch { return false; } },
        follow: (position) => { if (position.playhead_ticks !== undefined && position.playhead_ticks !== controller.session.playhead) { followed.current = position.playhead_ticks; controller.seek(position.playhead_ticks); } },
      });
      syncRef.current = session;
      setSyncSession(session);
    }
    if (view && !view.readOnly) {
      await markProjectOpened(storage, props.projectId, Date.now()).catch(() => undefined);
      if (!isCurrent()) { await closeSession(); return; }
      await markImportedOpened(storage, props.projectId).catch(() => undefined);
      if (!isCurrent()) { await closeSession(); return; }
      const manager = createSnapshotManager({ port: storage, projectId: props.projectId, newId: () => uuidV4(), locale, autosave: save, settings: () => ({ interval: storagePrefs.get(PREFERENCES.snapshotInterval), keepAutomatic: storagePrefs.get(PREFERENCES.snapshotsToKeep) }) });
      snapshots.current = manager;
      void manager.open().catch(() => undefined);
    }
    const session = createMediaSession({
      storage, projectId: props.projectId, document: () => controller.stored, context,
      commit: (made) => { if (!readOnly.current) controller.external(() => made); },
      rollback: (made) => { controller.rollback(made); },
      setDocument: (next) => { if (readOnly.current) return; controller.replace(next); save.changeLocal(next); },
      flush: () => save.flush(),
      hostConnected: () => hostConnected.current,
      remoteImport: (file, signal, onProgress) => {
        const current = liveHostState.current;
        if (!current.host || !current.connection || !current.can("jagentchill.media.write") || !current.can("jagentchill.projects.write")) throw new Error("Connect to a host with media import and project write access.");
        return ensureRemoteProject(props.projectId, current.host.gatewayId, syncEngine).then(() => loadSigner()).then((signer) => importRemoteMedia({ host: current.host!, connection: current.connection!, signer, projectId: props.projectId, file, signal, onProgress }));
      },
      remotePicture: async (sha256, variant, signal) => {
        const current = liveHostState.current;
        if (!current.host || !current.connection) return null;
        return fetchHostMediaPicture({ host: current.host, connection: current.connection, signer: await loadSigner(), sha256, variant, signal });
      },
    });
    mediaRef.current = session;
    setMedia(session);
    const made = createEditorRuntime({ controller, media: session, luts: createLutStore(storage, props.projectId), prefs: PREF_STORE, toast: (message, kind) => toast.show({ kind: kind ?? "info", message }), t: (text, values) => translate.current(text, values) });
    runtimeRef.current = made;
    // The screen renders for the project, its history and its dialogs — not for a selection, a scroll or a seek (`documentVersion`).
    { let seen = made.documentVersion; made.subscribe(() => { if (made.documentVersion === seen) return; seen = made.documentVersion; setTick((value) => value + 1); }); }
    setRuntime(made);
    setLoad({ state: "ok" });
    if (result.loaded.notice) toast.show({ kind: "info", message: result.loaded.notice });
  }, [library, storage, props.projectId, toast, locale, context, closeSession, instanceId, syncEngine]);
  // Opening takes several awaits. Opens therefore run one after another, never two at once, and one that was overtaken
  // — by a newer open, or by the screen being left while it was still opening — closes what it made. Without this an
  // open that finished after the screen was gone, or beside another open, left its media worker, engine, autosave and
  // lock alive with nothing to close them: one more of each for every visit to the editor.
  const openSeq = useRef(0);
  const openChain = useRef<Promise<void>>(Promise.resolve());
  const leavingRef = useRef(false);
  const open = useCallback(() => {
    if (leavingRef.current) return Promise.resolve();
    const seq = ++openSeq.current;
    const run = openChain.current.then(async () => {
      if (seq !== openSeq.current) return;
      await openNow(() => seq === openSeq.current);
      if (seq !== openSeq.current) await closeSession();
    }).catch(() => undefined);
    openChain.current = run;
    return run;
  }, [openNow, closeSession]);
  useEffect(() => { void open(); }, [open]);
  useEffect(() => () => { openSeq.current += 1; void closeSession(); }, [closeSession]);
  useEffect(() => onWindowFocus(() => void lockRef.current?.check().catch(() => undefined)), []);
  useEffect(() => onWindowKey((event) => {
    if (!event.inField && !event.meta && !event.ctrl && !event.alt && !event.shift && event.key.toLowerCase() === "c" && syncSession && syncSession.state.status.kind !== "local") {
      event.preventDefault(); setCommentsOpen(true);
    }
  }), [syncSession]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const commentId = new URLSearchParams(window.location.search).get("comment");
    if (!commentId || commentId === linkedCommentHandled.current) return;
    const comment = projectComments.find((entry) => entry.commentId === commentId);
    if (!comment) return;
    linkedCommentHandled.current = commentId;
    setSelectedCommentId(commentId);
    setCommentsOpen(true);
    if (comment.time_ticks !== undefined) controllerRef.current?.seek(comment.time_ticks);
  }, [projectComments]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => trackDrags(), []);
  // Files picked on Home for this new project are imported as soon as its library is ready.
  useEffect(() => {
    if (!media || load.state !== "ok" || lock?.readOnly) return;
    const files = takePendingImport(props.projectId);
    if (files.length > 0) void media.importFiles(files.map((file) => ({ file }))).then((result) => { const [head] = result.summary; if (head) toast.show({ kind: result.imported.length ? "success" : "warning", message: t(MEDIA_MESSAGES[head.code], head.params) }); });
  }, [media, load.state, lock?.readOnly, props.projectId, toast, t]);
  // A previewed version is shown by the same regions over a read-only session of its own.
  useEffect(() => {
    if (!preview || !media) { setPreviewRuntime(null); return; }
    const controller = createEditorController({ document: preview.document, newId: () => uuidV4(), platform: "web", prefs: () => getPref(EDITOR_PREFS.timeline), readOnly: translate.current("Read-only") });
    const made = createEditorRuntime({ controller, media, prefs: PREF_STORE, toast: () => undefined, t: (text, values) => translate.current(text, values) });
    // The screen renders for the project, its history and its dialogs — not for a selection, a scroll or a seek (`documentVersion`).
    { let seen = made.documentVersion; made.subscribe(() => { if (made.documentVersion === seen) return; seen = made.documentVersion; setTick((value) => value + 1); }); }
    setPreviewRuntime(made);
    return () => { made.close(); controller.close(); };
  }, [preview, media]);
  useEffect(() => { controllerRef.current?.setReadOnly(lock?.readOnly ? t("Read-only") : syncReadOnly !== null ? t("View only") : false); }, [lock?.readOnly, syncReadOnly, t]);
  // Media that sync downloaded while the project is open becomes present without reopening it.
  useEffect(() => syncEngine?.onMediaArrived((projectId, assetId) => {
    const controller = controllerRef.current;
    if (projectId !== props.projectId || !controller) return;
    void assetId;
    // The original, or the 720p proxy the host made: either makes the clip playable.
    // The store is read first; the marks then go into the document as it is at that later moment, so that an edit or
    // an import made during the reads is kept (`settleArrivedMedia`).
    if (storage) void settleArrivedMedia(arrivedProbe(storage, props.projectId), () => (controllerRef.current === controller ? controller.stored : null), (next) => { controller.replace(next); autosave.current?.changeLocal(next); }).then(() => media?.mediaArrived());
  }), [syncEngine, props.projectId, storage, media]);
  // Media that arrived before the project was opened is in the store already: the open document learns it.
  useEffect(() => {
    const controller = controllerRef.current;
    if (!storage || !controller || load.state !== "ok") return;
    void settleArrivedMedia(arrivedProbe(storage, props.projectId), () => (controllerRef.current === controller ? controller.stored : null), (next) => { controller.replace(next); autosave.current?.changeLocal(next); });
  }, [storage, load.state, props.projectId, syncSession]);
  // Where this device is in the project travels with presence: other devices follow it, and "Continue where you left off" reads it.
  useEffect(() => {
    if (!runtime || !syncSession) return;
    let last = -1;
    const note = () => {
      const playhead = runtime.controller.session.playhead;
      if (playhead === last) return;
      last = playhead;
      const scene = runtime.controller.stored.scenes.find((entry) => entry.isMain) ?? runtime.controller.stored.scenes[0];
      syncSession.notePosition({ sceneId: scene?.id, playhead_ticks: playhead }, followed.current !== playhead);
      followed.current = null;
    };
    note();
    return runtime.subscribe(note);
  }, [runtime, syncSession]);
  useEffect(() => { continueAt.current = (_sceneId, ticks) => controllerRef.current?.seek(ticks); return () => { continueAt.current = null; }; }, []);

  const document = runtime?.controller.document ?? null;
  /** Frame 0 of the main scene, when it holds only the background. A scene with elements is rendered by the render engine. */
  const writeThumbnail = useCallback(async (doc: ProjectDocument, onlyIfAbsent: boolean) => {
    if (!storage) return;
    const id = doc.metadata.id;
    const main = doc.scenes.find((scene) => scene.isMain) ?? doc.scenes[0];
    const empty = main && [...main.tracks.overlay, main.tracks.main, ...main.tracks.audio].every((track) => track.elements.length === 0);
    if (onlyIfAbsent && ((await storage.getBlob("thumbnail", id, THUMBNAIL_NAME.jpeg)) || (await storage.getBlob("thumbnail", id, THUMBNAIL_NAME.png)))) return;
    // A scene with clips takes its first frame from the engine; an empty one is its background.
    const still = empty ? null : await runtimeRef.current?.engine?.still(0, "jpeg").catch(() => null);
    const frame = still ? { bytes: still, mime: "image/jpeg" as const } : empty ? await renderBackgroundFrame(doc.settings.background as Background, doc.settings.canvasSize, 640) : null;
    if (!frame) return;
    const [name, other] = frame.mime === "image/png" ? [THUMBNAIL_NAME.png, THUMBNAIL_NAME.jpeg] : [THUMBNAIL_NAME.jpeg, THUMBNAIL_NAME.png];
    await storage.putBlob("thumbnail", id, name, frame.bytes);
    await storage.deleteBlob("thumbnail", id, other).catch(() => undefined);
    actions.touchImages();
  }, [storage, actions]);
  useEffect(() => { const doc = controllerRef.current?.stored; if (load.state === "ok" && doc) void writeThumbnail(doc, true).catch(() => undefined); }, [load.state, writeThumbnail]);

  // Read from the store (not from what the screen last rendered): the screen no longer renders for "saving" ↔ "saved".
  const unsaved = { get current(): boolean { const now = saveStore.get(); return Boolean(now && (now.dirty || now.state !== "saved")); } };
  // The browser asks before leaving while a save is pending, in flight or failed.
  useEffect(() => guardUnload(() => { flushLocal(); return unsaved.current && !readOnly.current; }, {
    // "Reload" into a new build of the web app: the last change is written once, then the save manager is only read.
    settle: async () => { flushLocal(); if (!readOnly.current) await autosave.current?.flush(); },
    pending: () => { const now = autosave.current?.status; return Boolean(now && (now.dirty || now.state !== "saved")) && !readOnly.current; },
  }), [flushLocal]);

  /** A change of the project settings or the media library: one undo step of the same history as the timeline's. */
  const commit = useCallback((change: (doc: ProjectDocument, ctx: CommitContext) => Commit | null, live = false): boolean => {
    const controller = controllerRef.current;
    if (!controller || readOnly.current) return false;
    return controller.external(change, live);
  }, []);

  const name = document?.metadata.name ?? "";
  useEffect(() => {
    if (load.state === "not-found") setDocumentTitle(documentTitle(t("Project not found")));
    else if (load.state === "ok" && name) setDocumentTitle(documentTitle(name));
  }, [load.state, name, t]);

  const [exporting, setExporting] = useState(false);
  const [cheatSheet, setCheatSheet] = useState(false);
  // The phone editor edits by the phone's rules (the main track is magnetic unless Free layer is on).
  const phone = isPhoneEditor(theme);
  phoneRef.current = phone;
  const commentPlayhead = useCallback(() => controllerRef.current?.session.playhead ?? 0, []);
  const seekComment = useCallback((ticks: number) => controllerRef.current?.seek(ticks), []);
  const closeCommentsPanel = useCallback(() => { setCommentsOpen(false); agentPanel.close(); }, [agentPanel.close]);
  const switchToComments = useCallback(() => { agentPanel.openPanel(); setCommentsOpen(true); }, [agentPanel.openPanel]);
  const switchToAgent = useCallback(() => { setCommentsOpen(false); agentPanel.openPanel(); }, [agentPanel.openPanel]);
  const commentsEnabled = Boolean(syncSession && syncSession.state.status.kind !== "local" && !phone && document);
  const commentFps = document?.settings.fps;
  const commentsPane = useMemo(() => commentsEnabled && commentFps ? (
    <CommentsPanel embedded open={commentsOpen} onClose={closeCommentsPanel} projectId={props.projectId} playhead={commentPlayhead} fps={commentFps} seek={seekComment} selectedId={selectedCommentId} onSelect={setSelectedCommentId} onComments={setProjectComments} />
  ) : null, [commentsEnabled, commentFps, commentsOpen, closeCommentsPanel, props.projectId, commentPlayhead, seekComment, selectedCommentId]);
  const [editorWidth, setEditorWidth] = useState(0);
  // The open editor lends its engine to the export jobs of its project; "Export again" from the Exports screen opens the dialog.
  useEffect(() => (runtime ? exportService.attachEditor({ projectId: props.projectId, engine: () => runtime.engine }) : undefined), [runtime, props.projectId]);
  useEffect(() => { if (runtime && load.state === "ok" && peekExportAgain(props.projectId)) setExporting(true); }, [runtime, load.state, props.projectId]);
  // Keys of the editor: one lookup for the timeline, the transport and the player.
  const shown = previewRuntime ?? runtime;
  useEffect(() => {
    if (!shown) return;
    return bindKeys((key) => { shown.key(key, () => false); });
  }, [shown]);

  // "Crop" from the toolbar or a menu is edited in the inspector: it opens when it is closed.
  const cropping = shown?.dialog?.kind === "crop";
  useEffect(() => { if (cropping && !regions.inspector) setRegions({ ...regions, inspector: true }); }, [cropping]); // eslint-disable-line react-hooks/exhaustive-deps

  const leaveNow = async () => {
    if (!leavingRef.current) { leavingRef.current = true; openSeq.current += 1; }
    setExiting(true);
    runtimeRef.current?.pause();
    const doc = controllerRef.current?.stored;
    if (doc && !readOnly.current) await writeThumbnail(doc, false).catch(() => undefined);
    if (!lock?.readOnly) { await snapshots.current?.exit().catch(() => undefined); if (storage) await markSessionClean(storage).catch(() => undefined); }
    await closeSession();
    router.dismissTo("/projects");
  };
  const exit = async () => {
    if (exiting) return;
    if (lock?.readOnly) { await leaveNow(); return; }
    leavingRef.current = true;
    openSeq.current += 1;
    setExiting(true);
    flushLocal();
    try { await autosave.current?.flush(); } catch { /* the leave prompt says what is not saved */ }
    const prompt = autosave.current?.leavePrompt("exit") ?? null;
    if (prompt) { leavingRef.current = false; setExiting(false); setLeave(prompt); void open(); return; }
    await leaveNow();
  };
  const finishRename = (text: string) => {
    setRenaming(false);
    const result = commitTitle(name, text);
    if ("save" in result) commit((doc, ctx) => renameProject(doc, ctx, result.save));
  };

  const restoreVersion = async (snapshotId: string) => {
    try {
      await snapshots.current?.restore(snapshotId);
      // The stored record is now the restored version: the save manager of the replaced document writes nothing more.
      autosave.current?.stop();
      setPreview(null); await open(); toast.show({ kind: "success", message: t("Version restored") });
    } catch (error) { toast.show({ kind: "error", message: error instanceof Error ? error.message : String(error) }); }
  };

  if (load.state === "loading" || (load.state === "ok" && (!document || !runtime))) {
    return (
      <Screen title={t("Loading project…")} documentTitle={t("Loading project…")}>
        <EditorSkeleton />
      </Screen>
    );
  }
  if (load.state === "not-found") {
    return (
      <Screen title={t("Project not found")}>
        <Centered icon="folder" title={t("Project not found")} body={t("This project does not exist on this device")}>
          <Button kind="strong" size="sm" label={t("Back to projects")} onPress={() => router.replace("/projects")} />
          <LookOnHost projectId={props.projectId} onFound={() => void open()} />
          <Button size="sm" label={t("Create new project")} onPress={async () => { const id = await library?.create({ name: "Untitled Project" }).catch(() => null); if (id) router.replace(`/editor/${id}` as never); else toast.show({ kind: "error", message: t("Failed to create project") }); }} />
        </Centered>
      </Screen>
    );
  }
  if (load.state === "error") {
    const message = load.error instanceof Error ? load.error.message : String(load.error);
    const details = JSON.stringify({ project: props.projectId, error: message, kind: (load.error as { kind?: string } | null)?.kind, details: (load.error as { details?: unknown } | null)?.details, at_ms: Date.now() }, null, 2);
    return (
      <Screen title={t("Project could not be opened")}>
        <Centered icon="warn" title={t("Project could not be opened")} body={message}>
          <Button kind="strong" size="sm" label={t("Retry")} onPress={() => void open()} />
          <Button size="sm" label={t("Back to projects")} onPress={() => router.replace("/projects")} />
          <Button size="sm" kind="ghost" label={t("Copy details")} onPress={() => void import("expo-clipboard").then((clipboard) => clipboard.setStringAsync(details)).then(() => toast.show({ kind: "info", message: t("Copied") }))} />
          {load.hasSnapshot ? <Button size="sm" kind="ghost" label={t("Restore latest snapshot")} onPress={() => void library?.restoreLatestSnapshot(props.projectId).then(() => open())} /> : null}
        </Centered>
      </Screen>
    );
  }
  const doc = document!, live = shown!, session = runtime!.controller.session;
  const shownDocument = live.controller.document;
  const notice = status?.banner ?? null;
  const saveAction = (id: SaveDialog["actions"][number]["id"]) => {
    if (id === "keep-editing") autosave.current?.keepEditing();
    else if (id === "free-up-space") { autosave.current?.keepEditing(); router.push("/settings/storage" as never); }
    else if (id === "empty-trash") { autosave.current?.keepEditing(); void library?.emptyTrash().then(() => autosave.current?.storageFreed()); }
    else if (id === "export-package") { autosave.current?.keepEditing(); void actions.exportPackages([doc.metadata.id]); }
  };
  const selectComment = (commentId: string) => {
    setSelectedCommentId(commentId); setCommentsOpen(true);
    const comment = projectComments.find((entry) => entry.commentId === commentId);
    if (comment?.time_ticks !== undefined) controllerRef.current?.seek(comment.time_ticks);
  };
  const items: MenuItem[] = [
    { id: "back", label: t("Back to projects"), icon: "arrow-l", disabled: exiting, onSelect: () => void exit() },
    { id: "rename", label: t("Rename project…"), icon: "pencil", onSelect: () => { setDraft(name); setRenaming(true); } },
    { id: "duplicate", label: t("Duplicate project"), icon: "copy", onSelect: () => void autosave.current?.flush().then(() => actions.duplicate([doc.metadata.id])) },
    { id: "settings", label: t("Project settings…"), icon: "gear", onSelect: () => setSettings("info") },
    { id: "cover", label: t("Edit cover…"), icon: "image", disabled: readOnly.current, onSelect: () => runtime?.setDialog({ kind: "cover" }) },
    ...(syncSession && syncSession.state.status.kind !== "local" ? [{ id: "comments", label: t("Comments"), icon: "chat" as const, onSelect: () => setCommentsOpen(true) }] : []),
    { id: "versions", label: t("Version history"), icon: "clock", disabled: Boolean(lock?.readOnly), onSelect: () => setVersions(true) },
    { id: "save-version", label: t("Save now"), icon: "check", disabled: Boolean(lock?.readOnly), onSelect: () => void snapshots.current?.saveNow().then(() => toast.show({ kind: "success", message: t("Version saved") }), (error) => toast.show({ kind: "error", message: error instanceof Error ? error.message : String(error) })) },
    { id: "export-package", label: t("Export package"), icon: "export", onSelect: () => void autosave.current?.flush().catch(() => undefined).then(() => actions.exportPackages([doc.metadata.id])) },
    // A template draft is saved as a template only after it was opened in the full editor.
    ...(doc.template?.locked ? [] : [{ id: "save-template", label: t("Save as template…"), icon: "template" as const, disabled: live !== runtime, onSelect: () => setSavingTemplate(true) }]),
    { type: "separator" },
    { id: "theme", label: t("Theme"), icon: "sun", submenu: (["system", "light", "dark"] as const).map((value) => ({ id: value, label: t(value === "system" ? "System" : value === "light" ? "Light" : "Dark"), checked: theme.preference === value, onSelect: () => theme.setPreference(value) })) },
    { type: "separator" },
    { id: "trash", label: t("Move to trash…"), icon: "trash", danger: true, onSelect: () => { const summary = library?.find(doc.metadata.id); if (summary) actions.trash([summary]); } },
  ];
  const wide = theme.formFactor === "wide";
  const mac = isMac();
  const selectedComment = projectComments.find((comment) => comment.commentId === selectedCommentId);
  const player = <Player onOpenCanvasSettings={openSettings} commentPin={selectedComment?.point ?? null} />;
  const commentsTimeline = syncSession && syncSession.state.status.kind !== "local" ? projectComments : [];
  const timelineView = <Timeline comments={commentsTimeline} focusedCommentId={selectedCommentId} onCommentPress={(comment) => selectComment(comment.commentId)} />;
  const assets = media ? <AssetPanel document={shownDocument} commit={commit} readOnly={readOnly.current} /> : null;
  const collapsed = [...(regions.assets ? [] : ["assets"]), ...(regions.inspector ? [] : ["inspector"])];
  // A closed region is hidden by its own toggle, in the render of the press; the panel group gives its space away a moment later.
  const region = (_open: boolean, content: ReactNode) => <View style={{ flex: 1, minWidth: 0, minHeight: 0 }}>{content}</View>;
  return (
    <Screen title={name} bare documentTitle={name}>
      <EditorContext.Provider value={live}>
        <DesktopMenuBridge items={items} media={media} readOnly={Boolean(lock?.readOnly) || live !== runtime} screen={{ "export.open": () => { runtime!.pause(); setExporting(true); }, "view.inspector.toggle": () => setRegions({ ...regions, inspector: !regions.inspector }), "view.agent-panel.toggle": () => { if (commentsOpen) { setCommentsOpen(false); agentPanel.openPanel(); } else agentPanel.toggle(); }, "help.shortcuts": () => setCheatSheet(true) }} />
        {phone ? <WithSaveState store={saveStore}>{(indicator, failed) => <CompactTopBar projectId={props.projectId} exiting={exiting} indicator={indicator} failed={failed} readOnly={Boolean(lock?.readOnly)} items={items} exportDisabled={runtime!.duration() <= 0 || (shownDocument.template?.locked === true && shownDocument.template.slots.some((slot) => slot.required && !slot.filled))}
          onClose={() => void exit()} onRetry={() => void autosave.current?.retryNow().catch(() => undefined)} onExport={() => { runtime!.pause(); setExporting(true); }} onRename={() => setSettings("info")} extra={<View style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}><SyncChip compact session={syncSession} projectId={props.projectId} onConflict={() => setConflictOpen(true)} />{syncSession && syncSession.state.status.kind !== "local" ? <IconButton icon="chat" size="sm" label={t("Comments")} badge={projectComments.filter((comment) => !comment.resolved && !comment.parentId).length} showZeroBadge on={commentsOpen} toggle testID="open-comments" onPress={() => setCommentsOpen((open) => !open)} /> : null}</View>} />}</WithSaveState> : (
        <View testID="editor-bar" style={{ height: theme.compact ? control["editor-bar-compact"] : 48, flexDirection: "row", alignItems: "center", gap: space[2], paddingStart: space[2], paddingEnd: space[3], borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline"), backgroundColor: theme.color("bg/app") }}>
          <Tap ref={menuRef} role="button" label={t("Editor menu")} expanded={menu} onPress={() => setMenu(true)} tooltip={{ label: t("Editor menu") }}
            style={(state) => ({ height: control.sm, flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 6, borderRadius: radius.sm, backgroundColor: state.hovered || state.pressed || menu ? theme.color("bg/hover") : "transparent" })}>
            <Logo size={20} /><Icon name="chev-d" size={12} color="text/secondary" />
          </Tap>
          <Menu open={menu} anchor={menuRef} items={items} label={t("Editor menu")} onClose={() => setMenu(false)} />
          {renaming ? (
            <TextInput autoFocus selectTextOnFocus accessibilityLabel={t("Project name")} aria-label={t("Project name")} value={draft} onChangeText={(text) => setDraft(clampInput(text, NAME_MAX))}
              onBlur={() => finishRename(draft)}
              {...({ onKeyPress: (event: { nativeEvent: { key: string }; preventDefault(): void; target: { blur(): void } }) => { if (event.nativeEvent.key === "Enter") { event.preventDefault(); event.target.blur(); } if (event.nativeEvent.key === "Escape") { event.preventDefault(); setDraft(name); setRenaming(false); } } } as object)}
              style={[theme.type("body-medium"), { height: control.sm, minWidth: 160, maxWidth: 360, paddingHorizontal: space[1.5], borderRadius: radius.sm, borderWidth: 2, borderColor: theme.color("accent"), color: theme.color("text/primary"), backgroundColor: theme.color("bg/app"), outlineWidth: 0 }]} />
          ) : (
            <Tap role="button" label={t("Rename: {name}", { name })} tooltip={{ label: t("Rename") }} onPress={() => { setDraft(name); setRenaming(true); }}
              style={(state) => ({ height: control.sm, justifyContent: "center", paddingHorizontal: space[1.5], borderRadius: radius.sm, flexShrink: 1, minWidth: 0, backgroundColor: state.hovered ? theme.color("bg/hover") : "transparent" })}>
              <Text variant="body-medium" numberOfLines={1} testID="project-name">{name}</Text>
            </Tap>
          )}
          <SaveState store={saveStore} readOnly={Boolean(lock?.readOnly)} exiting={exiting} onRetry={() => void autosave.current?.retryNow().catch(() => undefined)} />
          <View style={{ width: 1, alignSelf: "stretch", marginVertical: 14, marginHorizontal: space[1], backgroundColor: theme.color("border/hairline") }} />
          <IconButton icon="undo" size="sm" testID="bar-undo" label={session.undoLabel ? t("Undo {label}", { label: t(session.undoLabel) }) : t("Undo")} keys={bindingKeys("edit.undo", mac) ?? undefined} disabled={!session.canUndo || readOnly.current} onPress={() => runtime!.act("edit.undo")} />
          <IconButton icon="redo" size="sm" testID="bar-redo" label={session.redoLabel ? t("Redo {label}", { label: t(session.redoLabel) }) : t("Redo")} keys={bindingKeys("edit.redo", mac) ?? undefined} disabled={!session.canRedo || readOnly.current} onPress={() => runtime!.act("edit.redo")} />
          <View style={{ flex: 1 }} />
          {theme.compact ? <IconButton icon="image" size="sm" label={t("Media")} testID="open-media" onPress={() => setSheet(true)} /> : (
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}>
              {wide ? <IconButton icon="panel" size="sm" label={t("Asset panel")} on={regions.assets} toggle testID="toggle-assets" onPress={() => setRegions({ ...regions, assets: !regions.assets })} /> : null}
              {wide ? <IconButton icon="panel-r" size="sm" label={t("Inspector")} on={regions.inspector} toggle testID="toggle-inspector" onPress={() => setRegions({ ...regions, inspector: !regions.inspector })} /> : null}
              <IconButton icon="layers" size="sm" label={t("Timeline")} on={regions.timeline} toggle testID="toggle-timeline" onPress={() => setRegions({ ...regions, timeline: !regions.timeline })} />
              <AgentPanelToggle open={agentPanel.open && !commentsOpen} onToggle={() => { if (commentsOpen) { setCommentsOpen(false); agentPanel.openPanel(); } else agentPanel.toggle(); }} />
              <View style={{ width: 1, alignSelf: "stretch", marginVertical: 14, marginHorizontal: space[1], backgroundColor: theme.color("border/hairline") }} />
              <Button kind="ghost" size="sm" icon="kbd" label={t("Shortcuts")} testID="open-shortcuts" onPress={() => setCheatSheet(true)} />
            </View>
          )}
          {syncSession && syncSession.state.status.kind !== "local" ? <IconButton icon="chat" size="sm" label={t("Comments")} badge={projectComments.filter((comment) => !comment.resolved && !comment.parentId).length} showZeroBadge on={commentsOpen} toggle testID="open-comments" onPress={() => { if (commentsOpen) { setCommentsOpen(false); agentPanel.close(); } else { agentPanel.openPanel(); setCommentsOpen(true); } }} /> : null}
          <PresenceStrip session={syncSession} />
          <SyncChip session={syncSession} projectId={props.projectId} onConflict={() => setConflictOpen(true)} />
          <ExportIndicator projectId={props.projectId} />
          <Button kind="primary" size={theme.compact ? "sm" : "md"} icon="export" label={t("Export")} testID="open-export" disabled={runtime!.duration() <= 0 || (shownDocument.template?.locked === true && shownDocument.template.slots.some((slot) => slot.required && !slot.filled))} onPress={() => { runtime!.pause(); setExporting(true); }} />
        </View>
        )}
        <SyncBanner session={syncSession} onConflict={() => setConflictOpen(true)} onRestore={() => { const connection = hostState.connection; if (connection) void connection.call("jagentchill.trash.restore", { kind: "project", id: props.projectId }).then(() => syncEngine?.enable(props.projectId)).then(() => void open(), () => toast.show({ kind: "error", message: t("Sync error") })); }} />
        <EditorProposals projectId={props.projectId} session={syncSession} />
        <ComparePlayers open={comparing} onClose={() => setComparing(false)} session={syncSession} document={document} media={media} />
        <SyncDialogs session={syncSession} conflictOpen={conflictOpen && !comparing} onCompare={() => setComparing(true)} onConflictClose={() => setConflictOpen(false)} projectName={name} duration={document ? `${Math.round(document.metadata.duration / 120000)} s` : ""} />
        {lock?.banner ? <View testID="lock-banner"><Banner id="project-lock" tone="warning" actions={[{ label: lock.banner.action.label, onPress: () => void lockRef.current?.takeOver().then((view) => { setLock(view); if (!view.readOnly) void open(); }) }]}>{lock.banner.text}</Banner></View> : null}
        {notice ? <View testID="storage-full-banner"><Banner id="storage-full" tone="danger" actions={[{ label: notice.actions[0].label, onPress: () => saveAction(notice.actions[0].id) }, { label: notice.actions.find((action) => action.id === "export-package")!.label, onPress: () => saveAction("export-package") }]}>{notice.detail ? `${notice.text} · ${notice.detail}` : notice.text}</Banner></View> : null}
        {preview ? <View testID="preview-banner"><Banner id="version-preview" tone="info" actions={[{ label: storageString("restore", {}, locale), onPress: () => void restoreVersion(preview.id) }, { label: t("Close preview"), onPress: () => setPreview(null) }]}>{t("Previewing the version from {time} — read-only", { time: preview.label })}</Banner></View> : null}
        <View key={live === runtime ? "live" : "preview"} testID="editor-regions" style={{ flex: 1, minHeight: 0, flexDirection: "row" }} onLayout={(event) => setEditorWidth(event.nativeEvent.layout.width)}>
          <View style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          {live === runtime ? <StarterMusic projectId={props.projectId} media={media} readOnly={readOnly.current} /> : null}
          {shownDocument.template?.locked ? (
            // A locked template draft is never shown in the standard editor: its slots, texts and audio only.
            <TemplateEditor player={player} media={media} readOnly={readOnly.current} />
          ) : wide ? (
            <PanelGroup direction="vertical" label={t("Editor layout")} sizes={[panels.top, 100 - panels.top]} collapsed={regions.timeline ? [] : ["timeline"]} onLayout={(sizes) => { if (sizes[0] >= 30 && sizes[0] <= 85) setPanels({ ...panels, top: sizes[0] }); }}
              panels={[
                { id: "top", default: 50, min: 30, max: 85, content: (
                  <PanelGroup direction="horizontal" label={t("Editor panels")} sizes={[panels.assets, 100 - panels.assets - panels.inspector, panels.inspector]} collapsed={collapsed}
                    onLayout={(sizes) => { if (sizes[0] >= 15 && sizes[0] <= 40 && sizes[2] >= 15 && sizes[2] <= 40) setPanels({ ...panels, assets: sizes[0], inspector: sizes[2] }); }}
                    panels={[
                      { id: "assets", default: 25, min: 15, max: 40, minPx: 280, collapsible: true, content: region(regions.assets, assets) },
                      { id: "player", default: 50, min: 30, max: 100, content: player },
                      { id: "inspector", default: 25, min: 15, max: 40, minPx: 280, collapsible: true, content: region(regions.inspector, <Inspector onModify={openSettings} />) },
                    ]} />
                ) },
                { id: "timeline", default: 50, min: 15, max: 70, collapsible: true, content: region(regions.timeline, timelineView) },
              ]} />
          ) : phone ? (
            // Compact: the phone layout over the same session.
            <CompactEditor document={shownDocument} media={media} commit={commit} readOnly={readOnly.current} onOpenSettings={setSettings} />
          ) : (
            // Medium and compact: the player above the timeline; the asset panel opens as a sheet.
            <View style={{ flex: 1, minHeight: 0 }}>
              <View style={{ flex: regions.timeline ? 55 : 100, minHeight: 0 }}>{player}</View>
              {regions.timeline ? <View style={{ flex: 45, minHeight: 0 }}>{timelineView}</View> : null}
            </View>
          )}
          </View>
          <AgentPanelDock projectId={props.projectId} projectName={name} editorWidth={editorWidth} hidden={phone} commentsOpen={commentsOpen && !phone} commentCount={projectComments.filter((comment) => !comment.resolved && !comment.parentId).length}
            onCommentsTab={switchToComments} onAgentTab={switchToAgent} comments={commentsPane} />
          {phone && syncSession && syncSession.state.status.kind !== "local" ? <CommentsPanel open={commentsOpen} onClose={() => setCommentsOpen(false)} projectId={props.projectId} playhead={() => controllerRef.current?.session.playhead ?? 0} fps={doc.settings.fps} seek={(ticks) => controllerRef.current?.seek(ticks)} selectedId={selectedCommentId} onSelect={setSelectedCommentId} onComments={setProjectComments} /> : null}
        </View>
        {!wide && media ? <MediaSheet open={sheet} onClose={() => setSheet(false)} session={media} document={shownDocument} commit={commit} readOnly={readOnly.current} /> : null}
        {exporting ? <ExportDialog onClose={() => setExporting(false)} /> : null}
        {savingTemplate ? <SaveTemplateDialog onClose={() => setSavingTemplate(false)} /> : null}
        {live.dialog?.kind === "cover" ? <CoverEditor onClose={() => live.setDialog(null)} /> : null}
        {cheatSheet ? <ShortcutSheet onClose={() => setCheatSheet(false)} /> : null}
      </EditorContext.Provider>
      {versions && snapshots.current ? <VersionHistory manager={snapshots.current} projectName={name} onClose={() => setVersions(false)} onPreview={(entry) => { setVersions(false); setPreview(entry); }} onRestore={(id) => { setVersions(false); void restoreVersion(id); }} extra={<HostVersions projectId={props.projectId} session={syncSession} />} onDuplicated={(id) => void library?.refresh(id)} /> : null}
      {status?.dialog ? (
        <Modal title={status.dialog.text} description={status.dialog.detail} width={480} blocking hideClose onClose={() => autosave.current?.keepEditing()}
          footer={<View testID="storage-full-dialog" style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: space[2] }}>{status.dialog.actions.map((action) => <Button key={action.id} kind={action.id === "keep-editing" ? "primary" : "secondary"} size="sm" label={action.label} onPress={() => saveAction(action.id)} />)}</View>} />
      ) : null}
      {leave ? <ConfirmDialog open title={leave.text} description={leave.detail || undefined} confirmLabel={leave.actions[1].label} onClose={() => { setLeave(null); leavingRef.current = false; void open(); }} onConfirm={() => { setLeave(null); void leaveNow(); }} /> : null}
      {settings ? <ProjectSettings document={doc} tab={settings} onTab={setSettings} onClose={() => setSettings(null)} commit={commit} /> : null}
      {exiting ? <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", backgroundColor: theme.color("bg/scrim") }}><View style={{ padding: space[4], borderRadius: radius.md, backgroundColor: theme.color("bg/elevated") }}><Text variant="body-medium">{t("Exiting project…")}</Text></View></View> : null}
    </Screen>
  );
}

/** The actions of the editor with their keys, for reading. */
const SHEET_TITLES: Record<string, string> = {
  "playback.toggle": "Play / pause", "playback.shuttle-reverse": "Shuttle reverse", "playback.shuttle-stop": "Shuttle stop", "playback.shuttle-forward": "Shuttle forward", "playback.frame-previous": "Previous frame", "playback.frame-next": "Next frame",
  "playback.cut-previous": "Previous cut point", "playback.cut-next": "Next cut point", "playback.go-start": "Go to start", "playback.go-end": "Go to end", "playback.loop.toggle": "Loop",
  "timeline.split": "Split", "timeline.delete-left": "Delete left", "timeline.delete-right": "Delete right", "timeline.delete": "Delete", "timeline.ripple-delete": "Ripple delete", "timeline.copy": "Copy", "timeline.cut": "Cut", "timeline.paste": "Paste",
  "timeline.duplicate": "Duplicate", "edit.undo": "Undo", "edit.redo": "Redo", "timeline.group": "Group", "timeline.ungroup": "Ungroup", "selection.all": "Select all", "selection.none": "Deselect all", "tools.select": "Select", "tools.blade": "Split tool",
  "timeline.magnet.toggle": "Main track magnet", "timeline.snapping.toggle": "Auto snapping", "timeline.linkage.toggle": "Linkage", "timeline.preview-axis.toggle": "Preview axis", "marker.toggle": "Add marker", "range.set-in": "Set in point", "range.set-out": "Set out point",
  "timeline.nudge-left": "Nudge left", "timeline.nudge-right": "Nudge right", "timeline.zoom-in": "Zoom in", "timeline.zoom-out": "Zoom out", "timeline.zoom-fit": "Zoom to fit", "player.fullscreen": "Fullscreen",
};
function ShortcutSheet(props: { onClose(): void }) {
  const t = useT();
  const mac = isMac();
  const rows = EDITOR_BINDINGS.filter((binding) => SHEET_TITLES[binding.action]);
  return (
    <Modal title={t("Shortcuts")} width={480} onClose={props.onClose} footer={<><View style={{ flex: 1 }} /><Button label={t("Close")} onPress={props.onClose} /></>}>
      <View testID="shortcut-sheet" role="list" style={{ gap: 2 }}>
        {rows.map((binding) => (
          <View key={binding.action} role="listitem" style={{ flexDirection: "row", alignItems: "center", height: 28 }}>
            <Text style={{ flex: 1 }}>{t(SHEET_TITLES[binding.action])}</Text>
            <ShortcutText keys={bindingKeys(binding.action, mac) ?? []} />
          </View>
        ))}
      </View>
    </Modal>
  );
}

function Centered(props: { icon: "folder" | "warn"; title: string; body: string; children: ReactNode }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space[1], padding: space[4] }}>
      <Icon name={props.icon} size={32} color="text/secondary" />
      <Text variant="title-sm" level={2} align="center">{props.title}</Text>
      <Text color="text/secondary" align="center" selectable style={{ maxWidth: 420 }}>{props.body}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: space[2], marginTop: space[2] }}>{props.children}</View>
    </View>
  );
}

type CommitFn = (change: (doc: ProjectDocument, ctx: CommitContext) => Commit | null, live?: boolean) => boolean;
/** Project settings: "Project info" and "Background". Every change is one undoable command. */
function ProjectSettings(props: { document: ProjectDocument; tab: "info" | "background"; onTab(tab: "info" | "background"): void; onClose(): void; commit: CommitFn }) {
  const t = useT();
  const theme = useTheme();
  const { settings, metadata } = props.document;
  const size = settings.canvasSize;
  const [name, setName] = useState(metadata.name);
  const [custom, setCustom] = useState({ width: String(size.width), height: String(size.height) });
  const [problem, setProblem] = useState<string | null>(null);
  const [live, setLive] = useState<string | null>(null);
  useEffect(() => { setCustom({ width: String(size.width), height: String(size.height) }); setProblem(null); }, [size.width, size.height]);
  useEffect(() => setName(metadata.name), [metadata.name]);
  const preset = settings.canvasSizeMode === "custom" ? null : presetOf(size);
  const original = settings.originalCanvasSize;
  const isOriginal = original !== null && settings.canvasSizeMode !== "custom" && original.width === size.width && original.height === size.height && !preset;
  const applyCustom = (next: { width: string; height: string }) => {
    const width = parseDimension(next.width, "Width"), height = parseDimension(next.height, "Height");
    if (!width.ok) return setProblem(t(dimensionMessage("Width")));
    if (!height.ok) return setProblem(t(dimensionMessage("Height")));
    if (!areaAllowed({ width: width.value, height: height.value })) return setProblem(t("Width × height can be at most 33,177,600 pixels (7680 × 4320)"));
    setProblem(null);
    if (width.value !== size.width || height.value !== size.height || settings.canvasSizeMode !== "custom") props.commit((doc, ctx) => setCanvasSize(doc, ctx, { width: width.value, height: height.value }, "custom"));
  };
  const rates = frameRateOptions(settings.fps);
  const shortSide = Math.min(size.width, size.height);
  const background = settings.background as Background;
  const pick = (value: Background) => { if (!sameBackground(value, background)) props.commit((doc, ctx) => setProjectBackground(doc, ctx, value)); };
  const swatch = (entry: BackgroundPreset, value: Background) => (
    <Tooltip key={entry.id} label={t(entry.name)}>
      <Tap role="radio" label={t(entry.name)} checked={sameBackground(value, background)} testID={`bg-${entry.id}`} onPress={() => pick(value)}
        style={[{ width: 40, height: 28, borderRadius: radius.sm, borderWidth: sameBackground(value, background) ? 2 : 1, borderColor: theme.color(sameBackground(value, background) ? "accent" : "border/control") }, backgroundStyle(value, [theme.color("bg/subtle"), theme.color("bg/app")])]} />
    </Tooltip>
  );
  const group = (title: string, children: ReactNode) => (
    <View style={{ gap: space[2] }}>
      <Text variant="body-medium" level={3}>{title}</Text>
      <View role="radiogroup" aria-label={title} style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>{children}</View>
    </View>
  );
  const ratioButton = (key: string, label: string, selected: boolean, onPress: () => void) => (
    <Button key={key} size="sm" kind={selected ? "secondary" : "outline"} pressed={selected} label={label} onPress={onPress} testID={`ratio-${key}`} />
  );
  return (
    <Modal title={t("Project settings")} width={640} onClose={props.onClose} footer={<><View style={{ flex: 1 }} /><Button label={t("Close")} onPress={props.onClose} /></>}>
      <Tabs id="project-settings" label={t("Project settings")} items={[{ id: "info", label: t("Project info") }, { id: "background", label: t("Background") }]} value={props.tab} onChange={(id) => props.onTab(id as "info" | "background")} />
      {props.tab === "info" ? (
        <View style={{ gap: space[4] }}>
          <FormField label={t("Name")}>
            <Input accessibilityLabel={t("Name")} value={name} onChangeText={(text) => setName(clampInput(text, NAME_MAX))}
              onBlur={() => { const result = commitTitle(metadata.name, name); if ("save" in result) props.commit((doc, ctx) => renameProject(doc, ctx, result.save)); else setName(metadata.name); }} />
          </FormField>
          <FormField label={t("Storage location")}><Text color="text/secondary">{t("App storage")}</Text></FormField>
          <FormField label={t("Aspect ratio")}>
            <View role="group" aria-label={t("Aspect ratio")} style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1.5] }}>
              {CANVAS_PRESETS.map((entry) => ratioButton(entry.ratio, entry.ratio, preset?.ratio === entry.ratio, () => props.commit((doc, ctx) => setCanvasSize(doc, ctx, { width: entry.width, height: entry.height }, "preset"))))}
              {original ? ratioButton("original", t("Original"), isOriginal, () => props.commit((doc, ctx) => setCanvasSize(doc, ctx, original, "preset"))) : null}
              {ratioButton("custom", t("Custom"), settings.canvasSizeMode === "custom" || (!preset && !isOriginal), () => props.commit((doc, ctx) => setCanvasSize(doc, ctx, doc.settings.lastCustomCanvasSize ?? doc.settings.canvasSize, "custom")))}
            </View>
          </FormField>
          <View style={{ flexDirection: "row", gap: space[3], alignItems: "flex-start" }}>
            <View style={{ flex: 1 }}><FormField label={t("Width")}><Input accessibilityLabel={t("Width")} keyboardType="number-pad" suffix="px" value={custom.width} invalid={Boolean(problem && problem.startsWith(t("Width")))} onChangeText={(text) => setCustom({ ...custom, width: text.replace(/[^\d]/g, "") })} onBlur={() => applyCustom(custom)} onSubmitEditing={() => applyCustom(custom)} /></FormField></View>
            <View style={{ flex: 1 }}><FormField label={t("Height")}><Input accessibilityLabel={t("Height")} keyboardType="number-pad" suffix="px" value={custom.height} invalid={Boolean(problem && problem.startsWith(t("Height")))} onChangeText={(text) => setCustom({ ...custom, height: text.replace(/[^\d]/g, "") })} onBlur={() => applyCustom(custom)} onSubmitEditing={() => applyCustom(custom)} /></FormField></View>
            <View style={{ flex: 1 }}>
              <FormField label={t("Resolution")}>
                <Select label={t("Resolution")} placeholder={t("{n}p", { n: shortSide })} options={RESOLUTIONS.map((value) => ({ value: String(value), label: t("{n}p", { n: value }) }))} value={(RESOLUTIONS as readonly number[]).includes(shortSide) ? String(shortSide) : null}
                  onChange={(value) => props.commit((doc, ctx) => setCanvasSize(doc, ctx, scaleToShortSide(doc.settings.canvasSize, Number(value)), doc.settings.canvasSizeMode))} />
              </FormField>
            </View>
          </View>
          {problem ? <FieldError message={problem} /> : null}
          <FormField label={t("Frame rate")}>
            <Select label={t("Frame rate")} width={160} options={rates.map((rate) => ({ value: rateKey(rate), label: t("{fps} fps", { fps: rate.label }) }))} value={rateKey(rates.find((rate) => rate.numerator * settings.fps.denominator === settings.fps.numerator * rate.denominator) ?? settings.fps)}
              onChange={(value) => { const rate = rates.find((entry) => rateKey(entry) === value); if (rate) props.commit((doc, ctx) => setFrameRate(doc, ctx, { numerator: rate.numerator, denominator: rate.denominator })); }} />
          </FormField>
        </View>
      ) : (
        <View style={{ gap: space[4] }}>
          {group(t("Colors"), <>
            {swatch({ id: "none", name: "None" }, { kind: "transparent" })}
            {SOLID_SWATCHES.map((entry) => swatch(entry, { kind: "color", color: entry.color! }))}
          </>)}
          <FormField label={t("Custom color")}>
            <ColorPicker label={t("Custom color")} value={(live ?? (background.kind === "color" ? background.color : SOLID_SWATCHES[0].color!)).toUpperCase()}
              // Dragging previews without history; releasing commits one undo step.
              onChange={(value) => { const color = value.slice(0, 7).toLowerCase(); setLive(color); props.commit((doc, ctx) => setProjectBackground(doc, ctx, { kind: "color", color }), true); }}
              onCommit={(value) => { setLive(null); props.commit((doc, ctx) => setProjectBackground(doc, ctx, { kind: "color", color: value.slice(0, 7).toLowerCase() })); }} />
          </FormField>
          {group(t("Gradients"), GRADIENT_PRESETS.map((entry) => swatch(entry, { kind: "gradient", css: entry.css! })))}
          {group(t("Patterns"), PATTERN_PRESETS.map((entry) => swatch(entry, { kind: "gradient", css: entry.css! })))}
        </View>
      )}
    </Modal>
  );
}
