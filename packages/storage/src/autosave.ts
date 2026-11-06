import { applyPatch, canonicalize, canonicalJson, diffDocuments, type Commit, type StatePatch } from "@jagentchill/editor-core";
import { projectDuration, type ProjectDocument } from "@jagentchill/protocol";
import { StorageError, toStorageError } from "./errors.ts";
import { isMigrating } from "./migrate.ts";
import type { JournalEntry, StoragePort } from "./port.ts";
import { evaluateStorageCapacity, formatBytes } from "./quota.ts";
import { serializeProjectRecord } from "./records.ts";
import { storageString, type StorageLocale } from "./strings.ts";

/** A dirty document is saved this long after the last change. */
export const AUTOSAVE_DEBOUNCE_MS = 800;
/** View-state-only changes (zoom, scroll, playhead, expanded keyframe lanes) have their own, shorter debounce. */
export const VIEW_STATE_DEBOUNCE_MS = 300;
/** A save that fails for a reason other than a full store is retried after these delays. */
export const SAVE_RETRY_DELAYS_MS = [2000, 4000, 8000] as const;
/** While storage is full the save is retried at this interval. */
export const STORAGE_FULL_RETRY_MS = 30_000;

export type SaveState = "saved" | "dirty" | "saving" | "retrying" | "failed" | "storage-full";
/** What the changes come from; every one of them marks the document dirty in the same way. */
export type ChangeSource = "scenes" | "timeline" | "markers" | "settings" | "cover" | "media" | "folders";
export type Clock = { now(): number; setTimeout(run: () => void, ms: number): unknown; clearTimeout(handle: unknown): void };
export const systemClock: Clock = { now: () => Date.now(), setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) };

export type SaveAction = { id: "free-up-space" | "empty-trash" | "export-package" | "keep-editing" | "stay" | "leave"; label: string; default?: boolean };
export type SaveDialog = { text: string; detail: string; lastSaved_ms: number | null; actions: SaveAction[] };
export type SaveStatus = {
  state: SaveState;
  dirty: boolean;
  lastSaved_ms: number | null;
  /** The blocking dialog "Storage is full — your recent changes are not saved"; `null` once "Keep editing" was chosen. */
  dialog: SaveDialog | null;
  /** The non-dismissable banner that stays until a save succeeds. */
  banner: SaveDialog | null;
  /** Automatic snapshots are suspended while storage is full. */
  snapshotsSuspended: boolean;
  error: StorageError | null;
};

/** What the engine persists: the document's record, and — for a synced document — its pending patches. */
export type SaveTarget<T> = {
  /** Bytes the record takes, for the quota evaluation. */
  serialize(document: T): string;
  write(text: string, document: T): Promise<void>;
  /** Writes the device-local part of the document over the last saved record (view state); absent: nothing is device-local. */
  writeLocal?(document: T, lastSavedText: string): Promise<void>;
  appendJournal?(entries: JournalEntry[]): Promise<void>;
};
export type AutosaveOptions<T> = {
  port: StoragePort;
  target: SaveTarget<T>;
  document: T;
  clock?: Clock;
  locale?: StorageLocale;
  /** A synced document keeps a pending-patch journal; a local-only one does not. A function is asked at every commit, so that sync can be turned on while the document is open. */
  synced?: boolean | (() => boolean);
  /** The revision the loaded record is at. */
  revision?: number;
  /** Saving is skipped while this is true (the project is loading or migrating). */
  paused?: () => boolean;
  /** Bytes in the trash, for "Empty trash ({size})". */
  trashBytes?: () => Promise<number>;
  formatTime?: (time_ms: number) => string;
  onStatus?: (status: SaveStatus) => void;
};
const clockTime = (time_ms: number): string => { const date = new Date(time_ms); return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`; };

/**
 * The save manager. It starts when a document finishes loading, marks it dirty on every change notification, saves
 * 800 ms after the last change, coalesces changes that arrive during a save into exactly one follow-up save, retries
 * a failed save, and takes the storage-full path when the store has no room. A save that cannot be completed never
 * overwrites the last good copy and never discards the in-memory document.
 */
export function createAutosave<T>(options: AutosaveOptions<T>) {
  const { port, target } = options, clock = options.clock ?? systemClock, locale = options.locale, time = options.formatTime ?? clockTime;
  let document = options.document, savedText = target.serialize(document);
  let state: SaveState = "saved", dirty = false, localDirty = false, keptEditing = false, error: StorageError | null = null;
  let lastSaved_ms: number | null = null, trash = 0, revision = options.revision ?? 0;
  let debounce: unknown = null, localDebounce: unknown = null, retry: unknown = null, retries = 0;
  let inFlight: Promise<void> | null = null, again = false, stopped = false;
  let pending: JournalEntry[] = [];

  const text = (key: Parameters<typeof storageString>[0], values: Record<string, string | number> = {}) => storageString(key, values, locale);
  const fullDialog = (): SaveDialog => ({
    text: text("storageFull"), detail: lastSaved_ms === null ? "" : text("lastSaved", { time: time(lastSaved_ms) }), lastSaved_ms,
    actions: [
      { id: "free-up-space", label: text("freeUpSpace") },
      ...(trash > 0 ? [{ id: "empty-trash" as const, label: text("emptyTrash", { size: formatBytes(trash) }) }] : []),
      { id: "export-package", label: text("exportPackage") }, { id: "keep-editing", label: text("keepEditing") },
    ],
  });
  const status = (): SaveStatus => ({
    state, dirty: dirty || localDirty, lastSaved_ms, error, snapshotsSuspended: state === "storage-full",
    dialog: state === "storage-full" && !keptEditing ? fullDialog() : null, banner: state === "storage-full" && keptEditing ? fullDialog() : null,
  });
  const publish = () => options.onStatus?.(status());
  const cancel = (handle: unknown) => { if (handle !== null) clock.clearTimeout(handle); };
  const paused = () => stopped || options.paused?.() === true;

  /** One attempt to write the record: quota evaluation first, then the atomic write. Throws the storage error. */
  async function attempt(): Promise<void> {
    const snapshot = document, record = target.serialize(snapshot), entries = pending;
    const evict = (needed: number) => port.cache.evict(needed);
    // Caches are evicted once before a record save is refused by the floor …
    const space = await evaluateStorageCapacity(port, record.length, { kind: "record", evictCache: evict });
    if (!space.allowed) throw new StorageError("QuotaExceeded", "the record save would leave less than the floor", { required: space.required, available: space.available });
    try { await target.write(record, snapshot); } catch (failure) {
      if (toStorageError(failure).kind !== "QuotaExceeded") throw toStorageError(failure);
      // … and once, followed by one retry, when the store itself reports that it is full.
      await evict(record.length);
      await target.write(record, snapshot);
    }
    savedText = record;
    if (entries.length > 0 && target.appendJournal) { await target.appendJournal(entries); pending = pending.slice(entries.length); }
    if (snapshot !== document) again = true; else { dirty = false; localDirty = false; }
  }

  function save(): Promise<void> {
    if (inFlight) { again = true; return inFlight; }
    cancel(debounce); cancel(localDebounce); cancel(retry);
    debounce = localDebounce = retry = null;
    state = "saving"; publish();
    inFlight = (async () => {
      try {
        if (options.trashBytes) trash = await options.trashBytes().catch(() => 0);
        await attempt();
        lastSaved_ms = clock.now(); retries = 0; error = null; keptEditing = false;
        state = dirty ? "dirty" : "saved";
      } catch (failure) {
        error = toStorageError(failure);
        if (error.kind === "QuotaExceeded") {
          state = "storage-full";
          retry = clock.setTimeout(() => { retry = null; if (!paused()) void save().catch(() => undefined); }, STORAGE_FULL_RETRY_MS);
        } else if (retries < SAVE_RETRY_DELAYS_MS.length) {
          state = "retrying";
          retry = clock.setTimeout(() => { retry = null; if (!paused()) void save().catch(() => undefined); }, SAVE_RETRY_DELAYS_MS[retries++]);
        } else state = "failed";
        throw error;
      } finally {
        inFlight = null;
        publish();
      }
    })();
    const done = inFlight;
    // Changes that arrived during the save: exactly one follow-up save, started when this one has completed.
    void done.then(() => { if (again && !paused()) { again = false; void save().catch(() => undefined); } }, () => { again = false; });
    return done;
  }

  function schedule(): void {
    if (paused()) return;
    if (inFlight) { again = true; return; }
    cancel(debounce);
    // A new change after a failure starts over: the retry schedule is for the save that failed.
    if (state === "failed" || state === "retrying") { cancel(retry); retry = null; retries = 0; }
    // While storage is full the save is retried on its own schedule and after space was freed, not on every edit.
    if (state === "storage-full") { publish(); return; }
    state = "dirty";
    debounce = clock.setTimeout(() => { debounce = null; if (!paused()) void save().catch(() => undefined); }, AUTOSAVE_DEBOUNCE_MS);
    publish();
  }

  const manager = {
    get document(): T { return document; },
    get revision(): number { return revision; },
    get status(): SaveStatus { return status(); },
    /** A change notification from scenes, timeline, markers, project settings, cover, media library or folders. */
    change(next: T, _source: ChangeSource = "timeline"): void {
      if (next === document) return;
      document = next; dirty = true;
      schedule();
    },
    /**
     * A committed change with its state patch. The patch — one per undo step — joins the pending-patch journal of a
     * synced document when the record is saved; for a document that is not synced no journal is kept.
     */
    commit(next: T, patch: StatePatch, meta: { commandType: string; label: string }): void {
      if (patch.length === 0) { if (next !== document) { document = next; localDirty = true; manager.changeLocal(next); } return; }
      if ((typeof options.synced === "function" ? options.synced() : options.synced) && target.appendJournal) { pending = [...pending, { baseRevision: revision, revision: revision + 1, commandType: meta.commandType, label: meta.label, patch }]; }
      revision += 1;
      manager.change(next);
    },
    /** A view-state-only change: written with its own debounce, without touching the modified timestamp, and never patched. */
    changeLocal(next: T): void {
      // The same document again is no change: the editor writes its view state on every "may I leave?" of the page, and
      // marking that dirty made every close and reload of the window refuse — the X button did nothing.
      if (next === document) return;
      document = next; localDirty = true;
      if (paused() || !target.writeLocal || debounce !== null || inFlight) { if (inFlight) again = true; publish(); return; }
      cancel(localDebounce);
      localDebounce = clock.setTimeout(() => {
        localDebounce = null;
        if (paused() || dirty || inFlight) return;
        const snapshot = document;
        void target.writeLocal!(snapshot, savedText).then(() => { if (snapshot === document && !dirty) { localDirty = false; publish(); } }, () => undefined);
      }, VIEW_STATE_DEBOUNCE_MS);
      publish();
    },
    /**
     * Saves immediately and resolves when storage has acknowledged. Called on exit, on app background, before a
     * snapshot, before package export and before sync upload. While storage is full it rejects with `QuotaExceeded`
     * after one attempt instead of waiting.
     */
    async flush(): Promise<void> {
      if (paused()) return;
      if (inFlight) { try { await inFlight; } catch { /* the outcome is judged below */ } }
      // The follow-up save of changes that arrived meanwhile is this flush.
      again = false;
      if (!dirty && !localDirty && state === "saved") return;
      if (!dirty && localDirty && target.writeLocal && state === "saved") { cancel(localDebounce); localDebounce = null; await target.writeLocal(document, savedText); localDirty = false; publish(); return; }
      await save();
    },
    /** A deletion, an emptied trash or a cleared cache may have made room: the save is retried at once. */
    async storageFreed(): Promise<boolean> {
      if (state !== "storage-full" && state !== "failed") return true;
      try { await save(); return true; } catch { return false; }
    },
    /** "Save failed — Retry". */
    retryNow: (): Promise<void> => { retries = 0; return save(); },
    /** "Keep editing": the dialog closes and the banner stays until a save succeeds. */
    keepEditing(): void { if (state === "storage-full") { keptEditing = true; publish(); } },
    /**
     * What Exit project, window close, app quit and switching project ask while changes are not saved. `null`: leave
     * freely. On mobile, moving to the background posts no dialog: the in-memory document lives as long as the process.
     */
    leavePrompt(reason: "exit" | "close" | "quit" | "switch" | "background" = "exit"): SaveDialog | null {
      if (state !== "storage-full" && state !== "failed") return null;
      if (reason === "background" && port.platform === "mobile") return null;
      const since = lastSaved_ms === null ? "" : time(lastSaved_ms);
      return {
        text: state === "storage-full" ? text("leaveWithoutSaving", { time: since }) : text("changesNotSaved"),
        detail: state === "storage-full" ? "" : text("leaveWithoutSaving", { time: since }), lastSaved_ms,
        actions: [{ id: "stay", label: text("stay"), default: true }, { id: "leave", label: text("leave") }],
      };
    },
    /**
     * The revision the next commit builds on. Sync calls it when the host acknowledged operations under other numbers,
     * when another writer's operations were applied, and when a snapshot replaced the document.
     */
    rebase(next: number): void { revision = next; },
    /** A document that came from the host replaces the working copy: saved like any change, never journalled. */
    replace(next: T): void { document = next; dirty = true; schedule(); },
    /** Stops the timers. The in-memory document is kept; nothing more is written. */
    stop(): void { stopped = true; cancel(debounce); cancel(localDebounce); cancel(retry); debounce = localDebounce = retry = null; },
    /** Loading or migration has ended: a change that arrived meanwhile is saved now. */
    resume(): void { if ((dirty || localDirty) && !paused() && !inFlight && debounce === null) schedule(); },
  };
  return manager;
}
export type Autosave<T> = ReturnType<typeof createAutosave<T>>;

/** The stored record without its device-local section, and that section, as they lie in the record text. */
export function splitRecord(recordText: string): { canonical: string; local: unknown } {
  const record = JSON.parse(recordText) as Record<string, unknown>;
  const { local, ...canonical } = record;
  return { canonical: typeof canonical.schemaVersion === "number" ? canonicalize(canonical) : JSON.stringify(canonical), local };
}
/** A record text with another device-local section; the canonical bytes are kept as they are. */
export function withLocalSection(recordText: string, local: unknown): string {
  const { canonical } = splitRecord(recordText);
  return local === undefined ? canonical : `${canonical.slice(0, -1)},"local":${JSON.stringify(local)}}`;
}

export type ProjectSaveOptions = Omit<AutosaveOptions<ProjectDocument>, "target" | "paused" | "trashBytes"> & { loading?: () => boolean; trashBytes?: () => Promise<number> };
/**
 * The save manager of a project. Each save recomputes `metadata.duration` and the modified timestamp, never includes
 * preview-layer data, and replaces the last good record only once the new one is completely written.
 */
export function createProjectAutosave(options: ProjectSaveOptions) {
  const { port } = options, clock = options.clock ?? systemClock, projectId = options.document.metadata.id;
  const engine = createAutosave<ProjectDocument>({
    ...options,
    paused: () => options.loading?.() === true || isMigrating(port, projectId),
    target: {
      serialize: serializeProjectRecord,
      write: (text) => port.writeProjectText(projectId, text),
      writeLocal: (document, lastSavedText) => port.writeProjectText(projectId, withLocalSection(lastSavedText, (document as { local?: unknown }).local)),
      appendJournal: async (entries) => { for (const entry of entries) await port.appendJournal(projectId, entry); },
    },
  });
  /** The duration and the modified timestamp are the document's own fields, so they are settled before it is saved or patched. */
  const settled = (next: ProjectDocument, previous: ProjectDocument, patch?: StatePatch): { document: ProjectDocument; patch: StatePatch } => {
    const duration = projectDuration(next), now = clock.now();
    const changed = patch ? patch.length > 0 : canonicalize(next) !== canonicalize(previous);
    if (!changed) return { document: next, patch: patch ?? [] };
    const updated_ms = next.metadata.updated_ms > previous.metadata.updated_ms ? next.metadata.updated_ms : Math.max(now, previous.metadata.updated_ms + 1);
    if (duration === next.metadata.duration && updated_ms === next.metadata.updated_ms) return { document: next, patch: patch ?? [] };
    const document = { ...next, metadata: { ...next.metadata, duration, updated_ms } };
    // The correction is part of the same step: one undo step still produces exactly one patch.
    return { document, patch: patch ? [...patch.filter((entry) => entry.path !== "/metadata/duration" && entry.path !== "/metadata/updated_ms"), ...diffDocuments(previous, document).filter((entry) => entry.path === "/metadata/duration" || entry.path === "/metadata/updated_ms")] : [] };
  };
  return {
    get document(): ProjectDocument { return engine.document; },
    get revision(): number { return engine.revision; },
    get status(): SaveStatus { return engine.status; },
    /** A change that did not come through a commit (a notification from scenes, timeline, markers, settings, cover, media, folders). */
    change(next: ProjectDocument, source: ChangeSource = "timeline"): ProjectDocument {
      const result = settled(next, engine.document);
      engine.change(result.document, source);
      return result.document;
    },
    /** A committed change of `editor-core`: saved per autosave, and emitted as one state patch. */
    commit(commit: Pick<Commit, "document" | "patch" | "commandType" | "label">): { document: ProjectDocument; patch: StatePatch } {
      const result = settled(commit.document, engine.document, commit.patch);
      engine.commit(result.document, result.patch, commit);
      return result;
    },
    /** Zoom, scroll, playhead, expanded keyframe lanes: device-local, no patch, no modified timestamp. */
    changeLocal: (next: ProjectDocument): void => engine.changeLocal(next),
    flush: engine.flush, storageFreed: engine.storageFreed, retryNow: engine.retryNow, keepEditing: engine.keepEditing, leavePrompt: engine.leavePrompt, stop: engine.stop, resume: engine.resume,
    rebase: engine.rebase, replace: engine.replace,
  };
}
export type ProjectAutosave = ReturnType<typeof createProjectAutosave>;

/** The save manager of a script document: the same timings, failure handling and patch emission as a project. */
export function createScriptAutosave<T extends object>(options: Omit<AutosaveOptions<T>, "target"> & { scriptId: string }) {
  const { port, scriptId } = options;
  const engine = createAutosave<T>({
    ...options,
    target: {
      serialize: (document) => canonicalJson(document),
      write: (_text, document) => port.putDocument("script", scriptId, document),
      appendJournal: async (entries) => { for (const entry of entries) await port.appendJournal(scriptJournalKey(scriptId), entry); },
    },
  });
  return {
    get document(): T { return engine.document; },
    get status(): SaveStatus { return engine.status; },
    /** An edit of the script: saved per autosave and emitted as the state patch between the two documents. */
    edit(next: T, meta: { commandType: string; label: string }): StatePatch {
      const patch = diffDocuments(engine.document, next);
      engine.commit(next, patch, meta);
      return patch;
    },
    flush: engine.flush, storageFreed: engine.storageFreed, retryNow: engine.retryNow, keepEditing: engine.keepEditing, leavePrompt: engine.leavePrompt, stop: engine.stop,
  };
}
/** The journal of a script lives beside the scripts, not among the projects. */
export const scriptJournalKey = (scriptId: string): string => `script.${scriptId}`;

export type JournalCheck = { ok: true; patches: number; revision: number } | { ok: false; fallback: "snapshot"; reason: string };
/**
 * The journal's invariant: applying its patches in order to the base revision yields a document byte-identical in
 * canonical form to the saved record. When it does not hold the journal is discarded and the caller falls back to a
 * full snapshot (`cross-device-sync.Revisions and snapshots`).
 */
export async function verifyJournal(port: StoragePort, projectId: string, base: ProjectDocument): Promise<JournalCheck> {
  const journal = await port.readJournal(projectId);
  const discard = async (reason: string): Promise<JournalCheck> => { await port.clearJournal(projectId); return { ok: false, fallback: "snapshot", reason }; };
  let document: object = base, revision = journal[0]?.baseRevision ?? 0;
  try {
    for (const entry of journal) {
      if (entry.baseRevision !== revision) return await discard(`the journal skips from revision ${revision} to ${entry.baseRevision}`);
      document = applyPatch(document, entry.patch as StatePatch);
      revision = entry.revision;
    }
  } catch (failure) { return discard(failure instanceof Error ? failure.message : String(failure)); }
  const saved = splitRecord(await port.readProjectText(projectId)).canonical;
  if (canonicalize(document) !== saved) return discard("replaying the journal does not give the saved record");
  return { ok: true, patches: journal.length, revision };
}
