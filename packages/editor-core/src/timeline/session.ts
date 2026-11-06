import type { Background, ProjectDocument } from "@jagentchill/protocol";
import { acceptPatch, setLocal, type Commit, type CommitContext, type Writer } from "../commit.ts";
import { DocumentRejected, type DocumentError } from "../errors.ts";
import { createHistory } from "../history.ts";
import { applyPatch, type StatePatch } from "../patch.ts";
import type { Registries } from "../registries.ts";
import { executeCommand, type Executed, type TimelineCommand } from "./command.ts";
import { enterCompound, exitCompound, type SceneFrame } from "./compound.ts";
import {
  activeSceneId, CommandRefused, editContextFor, endOf, sceneById, sceneDurationOf, TIMELINE_MESSAGES, tracksOfScene, type EditContext, type El, type Sc, type TimelinePreferences,
} from "./model.ts";
import { ParamRejected } from "./params.ts";
import { cancelSelectionLevel, EMPTY_SELECTION, selectableIds, selectElements, type SelectionState } from "./selection.ts";
import { playheadOf, readViewState, setPlayhead, writeViewState } from "./view.ts";
import { switchScene } from "./scenes.ts";

export type CursorMode = "select" | "blade" | "select-left" | "select-right";
export type CommandResult<I = unknown> =
  | { ok: true; changed: boolean; info?: I; patch: StatePatch; nearSizeLimit: boolean }
  | { ok: false; message: string; code?: string; errors?: DocumentError[] };

/** The text shown for a failed command: the refusal's own message, or the owner's wording for a document finding. */
export function messageFor(error: unknown): { message: string; code?: string; errors?: DocumentError[]; details?: Record<string, unknown> } {
  if (error instanceof CommandRefused) return { message: error.message, code: error.reason, ...(error.details ? { details: error.details } : {}) };
  if (error instanceof ParamRejected) return { message: error.message, code: "param-rejected" };
  if (error instanceof DocumentRejected) {
    const code = error.errors[0].code;
    const message = error.errors.some((entry) => entry.code === "document/template-locked") ? TIMELINE_MESSAGES.templateLocked
      : code === "document/compound-cycle" ? TIMELINE_MESSAGES.compoundCycle : code === "document/compound-depth" ? TIMELINE_MESSAGES.compoundDepth
        : code === "document/multicam-invalid" ? TIMELINE_MESSAGES.multicamSource : error.errors[0].message;
    return { message, code: error.errors.some((entry) => entry.code === "document/template-locked") ? "document/template-locked" : code, errors: error.errors };
  }
  throw error;
}

/** "Close gaps": every main-track element of the scene moves left so the track is edge to edge from tick 0; attached elements follow by linkage. */
export const closeGaps = (options: { sceneId: string }): TimelineCommand<{ moved: number }> => ({
  type: "timeline.close-gaps", label: "Close gaps", sceneId: options.sceneId,
  run(draft) {
    const main = sceneById(draft, options.sceneId).tracks.main;
    // A locked main track is never compacted.
    if (main.locked) return { info: { moved: 0 }, noMagnet: true };
    let at = 0, moved = 0;
    for (const clip of [...main.elements].sort((a, b) => a.startTime - b.startTime)) { if (clip.startTime !== at) { clip.startTime = at; moved++; } at = endOf(clip); }
    return { info: { moved }, noMagnet: true, noRipple: true };
  },
});
/** Does the main track of the scene have a gap, or start after tick 0? */
export function mainTrackHasGaps(doc: ProjectDocument, sceneId: string): boolean {
  let at = 0;
  for (const clip of [...sceneById(doc, sceneId).tracks.main.elements].sort((a, b) => a.startTime - b.startTime)) { if (clip.startTime !== at) return true; at = endOf(clip); }
  return false;
}
/** The magnet button: disabled under Free layer; its tooltip tells how to close gaps a project arrived with. */
export function magnetButtonState(doc: ProjectDocument, prefs: Pick<TimelinePreferences, "magnet" | "freeLayer">, sceneId = activeSceneId(doc)): { pressed: boolean; disabled: boolean; tooltip: string } {
  if (prefs.freeLayer) return { pressed: false, disabled: true, tooltip: TIMELINE_MESSAGES.magnetFreeLayer };
  const scene = sceneById(doc, sceneId), gaps = mainTrackHasGaps(doc, sceneId);
  if (gaps && scene.tracks.main.locked) return { pressed: prefs.magnet, disabled: false, tooltip: TIMELINE_MESSAGES.magnetLocked };
  return { pressed: prefs.magnet, disabled: false, tooltip: prefs.magnet && gaps ? TIMELINE_MESSAGES.magnetHasGaps : `Main track magnet — ${prefs.magnet ? "on" : "off"}` };
}

/** Which background the Background editor edits: the selected main-track clip, on mobile the main-track clip under the playhead, otherwise the project default. */
export function backgroundTarget(doc: ProjectDocument, input: { sceneId?: string; selectedIds: string[]; playhead?: number }): { kind: "element"; elementId: string } | { kind: "project" } {
  const main = sceneById(doc, input.sceneId ?? activeSceneId(doc)).tracks.main;
  const clip = main.elements.find((element) => input.selectedIds.includes(element.id)) ?? (input.selectedIds.length === 0 && input.playhead !== undefined ? main.elements.find((element) => element.startTime <= input.playhead! && input.playhead! < endOf(element)) : undefined);
  return clip ? { kind: "element", elementId: clip.id } : { kind: "project" };
}
/** Sets the canvas background of the target; `undefined` on a clip is "Use project background". */
export const setBackground = (options: { sceneId: string; selectedIds: string[]; playhead?: number; background: Background | undefined }): TimelineCommand => ({
  type: "timeline.background.edit", label: "Background", sceneId: options.sceneId,
  run(draft) {
    const target = backgroundTarget(draft, options);
    if (target.kind === "project") { if (options.background !== undefined) draft.settings.background = options.background as never; return; }
    const clip = sceneById(draft, options.sceneId).tracks.main.elements.find((element) => element.id === target.elementId)!;
    if (options.background === undefined) delete clip.background; else clip.background = options.background;
  },
});
/** "Apply to all": the value becomes the project default and every main-track override of every scene is removed, as one step. */
export const applyBackgroundToAll = (options: { background: Background }): TimelineCommand => ({
  type: "timeline.background.apply-all", label: "Apply background to all",
  run(draft) {
    draft.settings.background = options.background as never;
    for (const scene of draft.scenes as unknown as Sc[]) for (const clip of scene.tracks.main.elements) delete clip.background;
  },
});

export type SessionOptions = {
  document: ProjectDocument;
  newId: () => string;
  /** Wall clock in ms; injected so coalescing is testable. */
  now?: () => number;
  /** A reason makes the project read-only (the edit lease is held elsewhere, or the role is viewer): every command is rejected with it. */
  readOnly?: string | false;
  writer?: Writer; registries?: Registries;
  /** Receives the one state patch of every executed, undone and redone step. */
  onPatch?: (patch: StatePatch, step: { label: string; kind: "execute" | "undo" | "redo" | "update"; commandType?: string }) => void;
};

/**
 * One open project in the editor: the document, its undo history (in memory, 200 steps, cleared on close), the
 * selection, the render-only preview layer of a gesture, and the device-local view state. Every change goes through
 * `execute`, so validation, state patches and history have one source.
 */
export function createEditorSession(options: SessionOptions) {
  const now = options.now ?? (() => Date.now());
  const history = createHistory<SelectionState>();
  let doc = options.document, selection: SelectionState = { ...EMPTY_SELECTION }, cursorMode: CursorMode = "select";
  let pending: { executed: Executed; base: ProjectDocument } | null = null, gesture = false, readOnly = options.readOnly ?? false;
  const stack: SceneFrame[] = [], trimAdjusted = new Set<string>();
  const ctx = (): CommitContext => ({ now_ms: now(), newId: options.newId, writer: options.writer, registries: options.registries });
  const pruneSelection = () => {
    const kept = selectableIds(doc, selection.selectedElements);
    if (kept.length !== selection.selectedElements.length) selection = { ...selection, selectedElements: kept, selectedKeyframes: selection.selectedKeyframes.filter((key) => kept.includes(key.elementId)) };
  };
  const clampPlayhead = () => { const duration = sceneDurationOf(sceneById(doc, activeSceneId(doc))); if (playheadOf(doc) > duration) doc = setPlayhead(doc, duration); };

  function adopt<I>(executed: Executed<I>, sceneBefore: string): CommandResult<I> {
    const { commit } = executed, before = selection;
    if (executed.selection) selection = selectElements(executed.selection);
    doc = history.record(doc, commit, { selectionBefore: before, selectionAfter: selection, sceneId: executed.command.sceneId ?? sceneBefore, coalesce: executed.command.coalesce, window_ms: executed.command.coalesceWindow_ms, at_ms: now() });
    // The active scene was deleted: this device shows the main scene.
    const current = (doc as { local?: { currentSceneId?: string } }).local?.currentSceneId;
    if (current !== undefined && !doc.scenes.some((scene) => scene.id === current)) doc = setLocal(doc, (local) => { local.currentSceneId = activeSceneId(doc); });
    pruneSelection(); clampPlayhead();
    // "Trim adjusted" is shown until the element is next edited.
    for (const entry of commit.patch) { const id = /\/elements\/@([^/]+)/.exec(entry.path)?.[1]; if (id) trimAdjusted.delete(id); }
    const info = executed.info as { trimAdjusted?: boolean } | undefined;
    if (info?.trimAdjusted) for (const entry of commit.patch) { const id = /\/elements\/@([^/]+)/.exec(entry.path)?.[1]; if (id) trimAdjusted.add(id); }
    if (commit.patch.length > 0) options.onPatch?.(commit.patch, { label: commit.label, kind: commit.history ? "execute" : "update", commandType: commit.commandType });
    return { ok: true, changed: commit.patch.length > 0, info: executed.info, patch: commit.patch, nearSizeLimit: commit.nearSizeLimit };
  }
  function attempt<I>(command: TimelineCommand<I>, edit: EditContext): Executed<I> | { ok: false; message: string; code?: string; errors?: DocumentError[] } {
    if (readOnly) return { ok: false, message: readOnly, code: "read-only" };
    try { return executeCommand(doc, ctx(), edit, command); } catch (error) { return { ok: false, ...messageFor(error) }; }
  }
  function move(kind: "undo" | "redo"): { label: string } | null {
    if (gesture || pending || readOnly) return null;
    const moved = kind === "undo" ? history.undo(doc, applyPatch) : history.redo(doc, applyPatch);
    if (!moved) return null;
    doc = moved.document;
    // A step of another scene is shown in that scene.
    if (moved.sceneId && doc.scenes.some((scene) => scene.id === moved.sceneId) && moved.sceneId !== activeSceneId(doc)) doc = switchScene(doc, moved.sceneId);
    if (moved.selection) selection = moved.selection;
    pruneSelection(); clampPlayhead();
    options.onPatch?.(moved.patch, { label: moved.label, kind });
    return { label: moved.label };
  }

  return {
    get document(): ProjectDocument { return doc; },
    /** What the timeline and the player display: the preview layer over the stored data while a gesture previews. */
    get displayDocument(): ProjectDocument { return pending?.executed.commit.document ?? doc; },
    get selection(): SelectionState { return selection; },
    get sceneId(): string { return activeSceneId(doc); },
    get playhead(): number { return playheadOf(doc); },
    get cursorMode(): CursorMode { return cursorMode; },
    get canUndo(): boolean { return history.canUndo && !gesture; },
    get canRedo(): boolean { return history.canRedo && !gesture; },
    get undoLabel(): string | undefined { return history.undoLabel; },
    get redoLabel(): string | undefined { return history.redoLabel; },
    get historyLength(): number { return history.length; },
    get gestureActive(): boolean { return gesture; },
    get sceneStack(): readonly SceneFrame[] { return stack; },
    isTrimAdjusted: (elementId: string): boolean => trimAdjusted.has(elementId),

    /** Executes a command as one undo step (or none when nothing changed, or when it is a non-history update). Any direct update clears the preview layer. */
    execute<I>(command: TimelineCommand<I>, edit: EditContext): CommandResult<I> {
      pending = null;
      const sceneBefore = activeSceneId(doc), result = attempt(command, edit);
      if ("ok" in result) return result;
      const adopted = adopt(result, sceneBefore);
      const made = (result.info as { sceneId?: string } | undefined)?.sceneId;
      if (command.type === "timeline.scene.create" && made) { doc = switchScene(doc, made); selection = { ...EMPTY_SELECTION }; }
      return adopted;
    },
    /** The result of an asynchronous job, or solo: a patch, no undo step, the redo stack untouched. A result for an element that is gone is discarded. */
    update<I>(command: TimelineCommand<I>, edit: EditContext): CommandResult<I> {
      const result = attempt({ ...command, history: false }, edit);
      return "ok" in result ? result : adopt(result, activeSceneId(doc));
    },
    undo: (): { label: string } | null => move("undo"),
    redo: (): { label: string } | null => move("redo"),
    /** A change accepted from the host while this device holds the edit lease: one local step "Agent: {title}". */
    applyHostChange(patch: StatePatch, title: string): CommandResult {
      try {
        const after = acceptPatch(doc, patch, { writer: options.writer, registries: options.registries });
        const commit: Commit = { document: after, patch, commandType: "host.change", label: `Agent: ${title}`, history: true, nearSizeLimit: false };
        doc = history.record(doc, commit, { selectionBefore: selection, selectionAfter: selection, sceneId: activeSceneId(doc) });
        pruneSelection();
        return { ok: true, changed: patch.length > 0, patch, nearSizeLimit: false };
      } catch (error) { return { ok: false, ...messageFor(error) }; }
    },

    /**
     * A commit another command family (project settings, the media library) produced over this session's document:
     * one step of this history, with the selection kept. A commit based on any other document is refused.
     */
    adoptCommit(commit: Commit, base: ProjectDocument): CommandResult {
      if (readOnly) return { ok: false, message: readOnly, code: "read-only" };
      if (base !== doc) return { ok: false, message: "The project changed meanwhile", code: "stale-commit" };
      pending = null;
      return adopt({ commit, command: { type: commit.commandType, label: commit.label } }, activeSceneId(doc));
    },
    /** Takes back the most recent step when it is this commit and forgets it — media that could not be stored. `false` when later steps cover it. */
    rollback(commit: Commit): boolean {
      if (gesture || pending || !commit.history || commit.patch.length === 0 || history.undoLabel !== commit.label || history.canRedo) return false;
      const moved = move("undo");
      if (moved) history.forgetUndone();
      return moved !== null;
    },
    /** A tool sheet was confirmed: the steps made since the history was `mark` long become one step. */
    squashHistory(mark: number, label?: string): void { if (!gesture && !pending) history.squashSince(mark, label); },
    /** A tool sheet was cancelled: the steps made since `mark` are taken back and forgotten — no step is left, nothing to redo. */
    revertHistory(mark: number): number {
      let reverted = 0;
      while (!gesture && !pending && history.length > mark && history.length > 0) { if (!move("undo")) break; history.forgetUndone(); reverted++; }
      // What could be redone when the sheet opened can be redone again.
      if (reverted > 0) history.restoreRedo(mark);
      return reverted;
    },
    /** The copy the save manager settled, or a device-local change made outside the pipeline (a proxy state): no step, no patch. */
    replaceDocument(next: ProjectDocument): void { doc = next; pruneSelection(); clampPlayhead(); },

    // — Selection, cursor mode: never undo steps —
    select(next: SelectionState): void { selection = next.scope === "timeline" ? { ...next, selectedElements: selectableIds(doc, next.selectedElements) } : next; history.seal(); },
    setCursorMode(mode: CursorMode): void { cursorMode = mode; },
    /** `editor.cancel`: an in-flight gesture first (its preview is dropped, nothing recorded); otherwise one selection level. */
    cancel(): "gesture" | "selection" {
      if (gesture || pending) { pending = null; gesture = false; return "gesture"; }
      selection = cancelSelectionLevel(selection);
      return "selection";
    },

    // — Preview and commit —
    beginGesture(): void { gesture = true; },
    /** Writes the candidate result of a gesture to the render-only preview layer; project data and history are untouched. */
    preview<I>(command: TimelineCommand<I>, edit: EditContext): CommandResult<I> {
      gesture = true;
      const result = attempt(command, edit);
      if ("ok" in result) return result;
      pending = { executed: result, base: doc };
      return { ok: true, changed: result.commit.patch.length > 0, info: result.info, patch: result.commit.patch, nearSizeLimit: result.commit.nearSizeLimit };
    },
    /** The per-element patches of the preview layer: the elements whose displayed state differs from the stored one. */
    previewElements(): Map<string, El> {
      const shown = new Map<string, El>();
      if (!pending) return shown;
      const stored = new Map((doc.scenes as unknown as Sc[]).flatMap((scene) => tracksOfScene(scene)).flatMap((track) => track.elements.map((element) => [element.id, JSON.stringify(element)] as const)));
      for (const scene of pending.executed.commit.document.scenes as unknown as Sc[]) for (const track of tracksOfScene(scene)) for (const element of track.elements) if (stored.get(element.id) !== JSON.stringify(element)) shown.set(element.id, element);
      return shown;
    },
    /** Converts the preview layer into exactly one undo step when the result differs from the stored data. */
    commitPreview(): CommandResult {
      const held = pending;
      pending = null; gesture = false;
      if (!held || held.base !== doc) return { ok: true, changed: false, patch: [], nearSizeLimit: false };
      return adopt(held.executed, activeSceneId(doc));
    },
    /** Escape, pointer cancel, loss of window focus, closing the originating control. */
    discardPreview(): void { pending = null; gesture = false; },

    // — Device-local view state: no undo step, no patch, no revision —
    seek(time: number): void { doc = setPlayhead(doc, Math.max(0, Math.min(sceneDurationOf(sceneById(doc, activeSceneId(doc))), time))); },
    setView(change: { zoomLevel?: number; scrollLeft?: number; expandedKeyframeElementIds?: string[] }): void { doc = writeViewState(doc, change); },
    get view() { return readViewState(doc); },
    /** Switching scene clears the selection and is per device. */
    switchScene(sceneId: string): void { doc = switchScene(doc, sceneId); selection = { ...EMPTY_SELECTION }; stack.length = 0; history.seal(); },
    /** Double-click on a compound element / "Edit compound" / "Edit multi-camera source". */
    enterCompound(elementId: string): void {
      const entered = enterCompound(doc, activeSceneId(doc), elementId, playheadOf(doc));
      stack.push(entered.frame);
      doc = switchScene(doc, entered.sceneId, entered.playhead); selection = { ...EMPTY_SELECTION };
    },
    /** The exit action or a breadcrumb segment: back to the parent with the playhead at the corresponding parent time. */
    exitCompound(): void {
      const frame = stack.pop();
      if (!frame) return;
      const left = exitCompound(doc, frame, playheadOf(doc));
      doc = switchScene(doc, left.sceneId, left.playhead); selection = { ...EMPTY_SELECTION };
    },

    // — Settings that execute a command as a side effect —
    /**
     * The Main track magnet toggle. Turning it on closes the gaps of the active scene's unlocked main track at once
     * as the one undoable step "Close gaps"; with nothing to close, and when turning it off, no data changes.
     */
    setMagnet(prefs: TimelinePreferences, on: boolean, platform: "desktop" | "web" | "mobile" = "desktop"): { prefs: TimelinePreferences; closed: boolean } {
      const next = { ...prefs, magnet: on };
      if (!on || prefs.magnet || next.freeLayer) return { prefs: next, closed: false };
      const result = this.execute(closeGaps({ sceneId: activeSceneId(doc) }), editContextFor(platform, next));
      return { prefs: next, closed: result.ok && result.changed };
    },
    /** Free layer mode. Turning it off with the stored magnet on turns the magnet on again, which closes the gaps. */
    setFreeLayer(prefs: TimelinePreferences, on: boolean, platform: "desktop" | "web" | "mobile" = "desktop"): { prefs: TimelinePreferences; closed: boolean } {
      const next = { ...prefs, freeLayer: on }, magnetBack = !on && prefs.freeLayer && (platform === "mobile" || prefs.magnet);
      if (!magnetBack) return { prefs: next, closed: false };
      const result = this.execute(closeGaps({ sceneId: activeSceneId(doc) }), editContextFor(platform, next));
      return { prefs: next, closed: result.ok && result.changed };
    },
    setReadOnly(reason: string | false): void { readOnly = reason; },
    /** Closing the project: the history is not persisted and never reaches another project. */
    close(): void { history.clear(); pending = null; gesture = false; selection = { ...EMPTY_SELECTION }; cursorMode = "select"; stack.length = 0; },
  };
}
export type EditorSession = ReturnType<typeof createEditorSession>;
