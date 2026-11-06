import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ScriptDocument } from "@jagentchill/protocol";
import { script as s } from "@jagentchill/editor-core";
import { createScriptAutosave, trashDocument, type SaveStatus, type StoragePort } from "@jagentchill/storage";
import { useDevice } from "../state";

/**
 * Scripts on this device (`script-studio.Local-first storage, sync and offline use`): the head of a script is one
 * document of kind `script`, and what it keeps beside it — versions, reviews, comments, the audit trail — is a second
 * record `<scriptId>.h`, so that an autosave of the head never rewrites the history.
 */
const HISTORY_SUFFIX = ".h";
const FORMATS_KEY = "script.formats";
const historyKey = (scriptId: string): string => `${scriptId}${HISTORY_SUFFIX}`;
export const ids = s.createScriptIds();
/** A local-only script has no role check: the device's user is the one actor. */
export const ACTOR: s.ScriptActor = { kind: "device", id: "this-device", name: "This device" };
export const AUTHOR = { kind: "user" as const, deviceId: ACTOR.id, deviceName: ACTOR.name };

export type ScriptSummary = {
  id: string; title: string; status: ScriptDocument["status"]; language: string; scenes: number; shots: number; words: number; estimate_ticks: number;
  target: s.TargetState; projectIds: string[]; updated_ms: number; approved: boolean; search: string;
};
function summarize(document: ScriptDocument): ScriptSummary {
  const stats = s.estimateStats(document);
  return {
    id: document.id, title: document.title, status: document.status, language: document.meta.language, scenes: stats.scenes, shots: stats.shots, words: stats.words, estimate_ticks: stats.estimatedDuration_ticks,
    target: s.targetState(document), projectIds: document.links.projectIds, updated_ms: document.updated_ms, approved: !!document.approvedVersionId,
    search: [document.title, document.meta.logline, ...document.meta.tags, ...document.scenes.flatMap((scene) => s.sceneLines(scene).map((line) => line.text))].join("\n").toLowerCase(),
  };
}
type Stored = ScriptDocument & { trash?: unknown | null };
const strip = (record: Stored): ScriptDocument => { const { trash: _trash, ...document } = record; return document; };

export type ScriptLibrary = ReturnType<typeof createScriptLibrary>;
export function createScriptLibrary(port: StoragePort) {
  const listeners = new Set<() => void>();
  let scripts: ScriptSummary[] | null = null, formats: s.ScriptFormat[] = [];
  const emit = () => { for (const listener of listeners) listener(); };
  async function refresh(): Promise<void> {
    const names = await port.listDocuments("script"), heads = new Set(names.filter((name) => !name.endsWith(HISTORY_SUFFIX)));
    const next: ScriptSummary[] = [];
    for (const name of names) {
      // The history of a script that was deleted for good goes with it.
      if (name.endsWith(HISTORY_SUFFIX)) { if (!heads.has(name.slice(0, -HISTORY_SUFFIX.length))) await port.deleteDocument("script", name); continue; }
      const record = await port.peekDocument<Stored>("script", name);
      if (!record || record.trash || !s.validateScript(strip(record)).ok) continue;
      next.push(summarize(strip(record)));
    }
    scripts = next.sort((a, b) => b.updated_ms - a.updated_ms);
    formats = (await port.getSession<s.ScriptFormat[]>(FORMATS_KEY)) ?? [];
    emit();
  }
  /** A new script is stored with its first version, authored as given. */
  async function store(document: ScriptDocument, author: s.ScriptVersionAuthor, summary: string, action: string): Promise<string> {
    const saved = s.saveVersion(document, s.emptyHistory(), { ids, now_ms: document.created_ms, author, summary, force: true });
    const history = s.withAudit(saved.history, s.auditEntry(ids, document.created_ms, ACTOR, action, { versionId: saved.version.versionId, ...(author.fileName ? { details: { fileName: author.fileName } } : {}) }));
    await port.putDocument("script", saved.document.id, saved.document);
    await port.putDocument("script", historyKey(saved.document.id), history);
    await refresh();
    return saved.document.id;
  }
  return {
    subscribe(listener: () => void): () => void { listeners.add(listener); return () => void listeners.delete(listener); },
    get scripts(): ScriptSummary[] | null { return scripts; },
    get formats(): readonly s.ScriptFormat[] { return formats; },
    refresh,
    create: (format: s.ScriptFormat, locale: string): Promise<string> => store(s.createFromFormat(format, { ids, now_ms: Date.now(), locale, title: "Untitled script" }), AUTHOR, "Created", "script.created"),
    /** A script from an imported file: the version is authored `import` with the file name. */
    async createFromContent(content: s.ScriptContent, fileName: string, locale: string): Promise<string> {
      const blank = s.createScript({ ids, now_ms: Date.now(), locale });
      const document: ScriptDocument = { ...blank, title: content.title.slice(0, 120) || blank.title, meta: content.meta, acts: content.acts, scenes: content.scenes, entities: content.entities, ...(content.constraints ? { constraints: content.constraints } : {}) };
      const result = s.validateScript(document);
      if (!result.ok) throw new s.ScriptError("SCRIPT_IMPORT_INVALID", "This file cannot be read", { path: result.errors[0].path });
      return store(document, { kind: "import", fileName: fileName.slice(0, 255) }, `Imported from ${fileName}`.slice(0, 300), "script.imported");
    },
    /** A copy with its own id and history; the ids inside it are kept, as in the native file. */
    async duplicate(scriptId: string, content?: s.ScriptContent): Promise<string | null> {
      const record = await port.getDocument<Stored>("script", scriptId);
      if (!record) return null;
      const source = strip(record), now = Date.now();
      const copy: ScriptDocument = { ...s.clone(source), ...(content ? s.clone(content) : {}), id: ids(), title: `${(content?.title ?? source.title).slice(0, 113)} (copy)`, status: "draft", links: { projectIds: [] }, headVersionId: ids(), revision: 0, created_ms: now, updated_ms: now };
      delete copy.approvedVersionId;
      if (!content?.constraints && content) delete copy.constraints;
      return store(copy, AUTHOR, `Duplicated from ${source.title}`.slice(0, 300), "script.created");
    },
    async rename(scriptId: string, title: string): Promise<void> {
      const record = await port.getDocument<Stored>("script", scriptId);
      if (!record) return;
      const result = s.executeScript(strip(record), s.setTitle(title.trim()), { ids, now_ms: Date.now() }, { confirmApprovedEdit: true });
      await port.putDocument("script", scriptId, { ...result.document, ...(record.trash ? { trash: record.trash } : {}) });
      await refresh();
    },
    /** Deleted scripts go to the trash for 30 days. */
    async trash(scriptId: string): Promise<void> { await trashDocument(port, "script", scriptId, Date.now()); await refresh(); },
    async saveFormat(format: s.ScriptFormat): Promise<void> { formats = [...formats.filter((entry) => entry.id !== format.id), format]; await port.putSession(FORMATS_KEY, formats); emit(); },
    /** Records that a project was made from a script, on the script's side of the link. */
    async linkProject(scriptId: string, projectId: string): Promise<void> {
      const record = await port.getDocument<Stored>("script", scriptId);
      if (!record || record.links.projectIds.includes(projectId)) return;
      await port.putDocument("script", scriptId, { ...record, links: { ...record.links, projectIds: [...record.links.projectIds, projectId].slice(-20) } });
      await refresh();
    },
  };
}
const libraries = new WeakMap<StoragePort, ScriptLibrary>();
export function useScriptLibrary(): { library: ScriptLibrary | null; scripts: ScriptSummary[] | null; formats: readonly s.ScriptFormat[] } {
  const { storage } = useDevice();
  const library = useMemo(() => { if (!storage) return null; let made = libraries.get(storage); if (!made) { made = createScriptLibrary(storage); libraries.set(storage, made); } return made; }, [storage]);
  const [, setTick] = useState(0);
  useEffect(() => { if (!library) return; const stop = library.subscribe(() => setTick((value) => value + 1)); void library.refresh(); return stop; }, [library]);
  return { library, scripts: library?.scripts ?? null, formats: library?.formats ?? [] };
}

export type SessionEvents = { onRefused?(error: s.ScriptError): void };
/**
 * One open script: the head, its history, the undo steps of this device and the save manager. Every edit goes through
 * `execute`; status changes, versions and comments have their own entry points and are never undo steps.
 */
export function createScriptSession(port: StoragePort, document: ScriptDocument, loaded: s.ScriptHistoryStore) {
  const listeners = new Set<() => void>(), undo = s.createScriptHistory();
  let history = loaded, status: SaveStatus | null = null, tick = 0, editingSince: number | null = null;
  const emit = () => { tick++; for (const listener of listeners) listener(); };
  const autosave = createScriptAutosave<ScriptDocument>({ port, scriptId: document.id, document, synced: false, onStatus: (next) => { status = next; emit(); } });
  const env = (): s.ScriptEnv => ({ ids, now_ms: Date.now() });
  const putHistory = (next: s.ScriptHistoryStore) => { history = next; void port.putDocument("script", historyKey(document.id), next); };
  const commit = (next: ScriptDocument, type: string, label: string) => { autosave.edit(next, { commandType: type, label }); emit(); };
  const snapshot = (summary: string, options: { label?: string; force?: boolean; author?: s.ScriptVersionAuthor } = {}): s.SavedVersion => {
    const saved = s.saveVersion(autosave.document, history, { ids, now_ms: Date.now(), author: options.author ?? AUTHOR, summary, ...(options.label ? { label: options.label } : {}), force: options.force });
    if (saved.created) { putHistory(saved.history); commit(saved.document, "script.version", "Save version"); editingSince = null; }
    return saved;
  };
  return {
    id: document.id,
    subscribe(listener: () => void): () => void { listeners.add(listener); return () => void listeners.delete(listener); },
    get tick(): number { return tick; },
    get document(): ScriptDocument { return autosave.document; },
    get history(): s.ScriptHistoryStore { return history; },
    get saveStatus(): SaveStatus | null { return status; },
    get canUndo(): boolean { return undo.canUndo; },
    get canRedo(): boolean { return undo.canRedo; },
    /** Runs a command as one undo step. A refusal (limit, schema, read-only) is thrown as a `ScriptError`. */
    execute<I>(command: s.ScriptCommand<I>, options: s.ExecuteOptions = {}): I {
      const before = autosave.document, now = Date.now();
      const result = s.executeScript(before, command, { ids, now_ms: now }, options);
      if (!result.changed) return result.info;
      undo.record(before, result, now);
      commit(result.document, result.type, result.label);
      // A version is recorded automatically after 10 minutes of editing activity.
      editingSince ??= now;
      if (now - editingSince >= s.AUTO_VERSION_INTERVAL_MS) snapshot("Autosaved");
      return result.info;
    },
    seal(): void { undo.seal(); },
    undo(): string | null { const move = undo.undo(autosave.document, Date.now()); if (!move) return null; commit(move.document, "script.undo", "Undo"); return move.label; },
    redo(): string | null { const move = undo.redo(autosave.document, Date.now()); if (!move) return null; commit(move.document, "script.redo", "Redo"); return move.label; },
    /** A status change, a decision or a policy change: audited, versioned where the lifecycle says so, never undoable. */
    review(action: s.ReviewAction): void {
      const next = s.review({ document: autosave.document, history }, action, { ...env(), actor: ACTOR });
      putHistory(next.history);
      commit(next.document, `script.review.${action.type}`, "Review");
    },
    saveVersion(label?: string): s.SavedVersion { return snapshot(label ? "Saved by the user" : "Saved", { label, force: !!label }); },
    /** A version at an export or a hand-off, when the head changed since the last one. */
    checkpoint(summary: string, action: string, details: Record<string, unknown> = {}): s.ScriptVersion {
      const saved = snapshot(summary);
      putHistory(s.withAudit(history, s.auditEntry(ids, Date.now(), ACTOR, action, { versionId: saved.version.versionId, details })));
      emit();
      return saved.version;
    },
    restore(versionId: string): void {
      const saved = s.restoreVersion(autosave.document, history, versionId, env(), AUTHOR);
      putHistory(s.withAudit(saved.history, s.auditEntry(ids, Date.now(), ACTOR, "version.restored", { versionId: saved.version.versionId, details: { from: versionId } })));
      undo.clear();
      commit(saved.document, "script.version.restore", "Restore version");
    },
    /** Import into the open script: the content is replaced as a new version authored `import`; the old content stays in history. */
    replaceWithImport(content: s.ScriptContent, fileName: string): void {
      snapshot("Before import");
      const result = s.executeScript(autosave.document, s.replaceContent({ ...content, constraints: content.constraints }, "Import"), env(), { confirmApprovedEdit: true });
      undo.record(autosave.document, result, Date.now());
      commit({ ...result.document, status: "draft" }, "script.import", "Import");
      const saved = snapshot(`Imported from ${fileName}`.slice(0, 300), { force: true, author: { kind: "import", fileName: fileName.slice(0, 255) } });
      putHistory(s.withAudit(history, s.auditEntry(ids, Date.now(), ACTOR, "script.imported", { versionId: saved.version.versionId, details: { fileName } })));
      emit();
    },
    setVersion(versionId: string, patch: { label?: string; pinned?: boolean }): void { putHistory(s.setVersion(history, versionId, patch)); emit(); },
    addComment(anchor: s.CommentInput["anchor"], body: string): void { putHistory(s.addComment(autosave.document, history, { ids, now_ms: Date.now(), author: { kind: "device", id: ACTOR.id, name: ACTOR.name }, anchor, body }).history); emit(); },
    updateComment(commentId: string, patch: { resolved?: boolean }): void { putHistory(s.updateComment(history, commentId, patch)); emit(); },
    deleteComment(commentId: string): void { putHistory(s.deleteComment(history, commentId)); emit(); },
    /** A project was made from a version: the version is pinned by that link and the script names the project. */
    linkProject(projectId: string, versionId: string): void {
      const current = autosave.document;
      if (!current.links.projectIds.includes(projectId)) commit({ ...current, links: { ...current.links, projectIds: [...current.links.projectIds, projectId].slice(-20) }, updated_ms: Date.now(), revision: current.revision + 1 }, "script.link", "Link project");
      putHistory(s.withAudit({ ...history, linked: [...new Set([...history.linked, versionId])] }, s.auditEntry(ids, Date.now(), ACTOR, "timeline.created", { versionId, details: { projectId } })));
      emit();
    },
    flush: (): Promise<void> => autosave.flush().then(() => undefined),
    retry: (): void => { void autosave.retryNow(); },
    stop(): void { void autosave.flush().finally(() => autosave.stop()); },
  };
}
export type ScriptSession = ReturnType<typeof createScriptSession>;

export type SessionState = { state: "loading" } | { state: "missing" } | { state: "error" } | { state: "ready"; session: ScriptSession };
/** Opens a script for editing. `attempt` is bumped by "Retry". */
export function useScriptSession(scriptId: string, attempt: number): SessionState {
  const { storage } = useDevice();
  const [state, setState] = useState<SessionState>({ state: "loading" });
  useEffect(() => {
    if (!storage) return;
    let cancelled = false, opened: ScriptSession | null = null;
    setState({ state: "loading" });
    (async () => {
      try {
        const record = await storage.getDocument<Stored>("script", scriptId);
        if (cancelled) return;
        if (!record || record.trash) { setState({ state: "missing" }); return; }
        const document = strip(record);
        if (!s.validateScript(document).ok) { setState({ state: "error" }); return; }
        const history = (await storage.getDocument<s.ScriptHistoryStore>("script", historyKey(scriptId))) ?? s.emptyHistory();
        if (cancelled) return;
        opened = createScriptSession(storage, document, { ...s.emptyHistory(), ...history });
        setState({ state: "ready", session: opened });
      } catch { if (!cancelled) setState({ state: "error" }); }
    })();
    return () => { cancelled = true; opened?.stop(); };
  }, [storage, scriptId, attempt]);
  return state;
}
/** Re-renders on every change of the session. */
export function useSessionTick(session: ScriptSession): number {
  return useSyncExternalStore(session.subscribe, () => session.tick, () => 0);
}
/** A script waiting for something the list started: an import or an export that continues once its editor is open. */
const pendingActions = new Map<string, "export" | "timeline">();
export const setPendingAction = (scriptId: string, action: "export" | "timeline"): void => void pendingActions.set(scriptId, action);
export const takePendingAction = (scriptId: string): "export" | "timeline" | undefined => { const action = pendingActions.get(scriptId); pendingActions.delete(scriptId); return action; };
