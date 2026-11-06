import { timeline, type Commit, type CommitContext, type Registries, type StatePatch } from "@jagentchill/editor-core";
import type { ProjectDocument } from "@jagentchill/protocol";

export type EditorPlatform = "desktop" | "web" | "mobile";
export type SavedCommit = { document: ProjectDocument; patch: StatePatch; commandType: string; label: string };
export type EditorControllerOptions = {
  document: ProjectDocument; newId: () => string; now?: () => number; readOnly?: string | false; registries?: Registries;
  /** The editing rules in force: fixed, or read at every command where one window shows the wide editor or the phone editor by its width. */
  platform: EditorPlatform | (() => EditorPlatform);
  /** The timeline preferences of the device at the moment of a command. */
  prefs: () => timeline.TimelinePreferences;
  /** Hands a committed change to the save manager; the copy it settled comes back and replaces the stored one. */
  onCommit?: (commit: SavedCommit) => ProjectDocument | void;
  /** A device-local change (playhead, zoom, scroll, scene, lanes): saved without a patch. */
  onLocal?: (document: ProjectDocument) => void;
  /** A refused command says why. */
  onMessage?: (message: string, code?: string) => void;
};
export type ExternalChange = (document: ProjectDocument, context: CommitContext) => Commit | null;

/**
 * The one writer of an open project in the editor screen: the engine session, with the save manager behind it and a
 * change notification in front. Timeline commands, the commands of other families (project settings, the media
 * library) and gesture previews all pass through here, so undo, redo and autosave see every step exactly once.
 */
export function createEditorController(options: EditorControllerOptions) {
  const queue: { patch: StatePatch; label: string; commandType: string }[] = [];
  const session = timeline.createEditorSession({
    document: options.document, newId: options.newId, now: options.now, readOnly: options.readOnly, registries: options.registries,
    onPatch: (patch, step) => queue.push({ patch, label: step.label, commandType: step.commandType ?? `history.${step.kind}` }),
  });
  const clipboard = timeline.createClipboard();
  const listeners = new Set<() => void>();
  let version = 0, live: ProjectDocument | null = null, lastLocal = session.document;
  const context = (): CommitContext => ({ now_ms: (options.now ?? Date.now)(), newId: options.newId, registries: options.registries });
  const platform = (): EditorPlatform => (typeof options.platform === "function" ? options.platform() : options.platform);
  const edit = (): timeline.EditContext => timeline.editContextFor(platform(), options.prefs());
  /** Saves what the session produced, adopts the settled copies and tells the screen. */
  function settle(): void {
    for (const entry of queue.splice(0)) {
      const settled = options.onCommit?.({ document: session.document, ...entry });
      if (settled && settled !== session.document) session.replaceDocument(settled);
    }
    if (session.document !== lastLocal) { lastLocal = session.document; options.onLocal?.(session.document); }
    version++;
    for (const listener of [...listeners]) listener();
  }
  function report<I>(result: timeline.CommandResult<I>): timeline.CommandResult<I> {
    if (!result.ok) options.onMessage?.(result.message, result.code);
    settle();
    return result;
  }

  return {
    session, clipboard, context, edit, platform,
    get version(): number { return version; },
    /** What the screen draws: a live draft of another family's control, else the gesture preview, else the stored data. */
    get document(): ProjectDocument { return live ?? session.displayDocument; },
    get stored(): ProjectDocument { return session.document; },
    subscribe(listener: () => void): () => void { listeners.add(listener); return () => void listeners.delete(listener); },

    /** Executes a timeline command as one undo step. */
    run: <I>(command: timeline.TimelineCommand<I>): timeline.CommandResult<I> => { live = null; return report(session.execute(command, edit())); },
    /** The result of an asynchronous job: a patch without a step. */
    update: <I>(command: timeline.TimelineCommand<I>): timeline.CommandResult<I> => report(session.update(command, edit())),
    /** A gesture's candidate result on the render-only layer. A refusal is not reported: the gesture shows it as "no change". */
    preview<I>(command: timeline.TimelineCommand<I>): timeline.CommandResult<I> { const result = session.preview(command, edit()); settle(); return result; },
    commitPreview: (): timeline.CommandResult => report(session.commitPreview()),
    discardPreview(): void { session.discardPreview(); live = null; settle(); },
    /**
     * A change of another command family. `live` draws it without recording (a drag in a colour picker); the call
     * without `live` records one step from the stored document, whatever was drawn in between.
     */
    external(change: ExternalChange, isLive = false): boolean {
      try {
        if (isLive) {
          const made = change(live ?? session.document, context());
          if (!made) return false;
          live = made.document; settle();
          return true;
        }
        live = null;
        const base = session.document, made = change(base, context());
        if (!made) { settle(); return false; }
        return report(session.adoptCommit(made, base)).ok;
      } catch (error) {
        live = null;
        options.onMessage?.(timeline.messageFor(error).message, timeline.messageFor(error).code);
        settle();
        return false;
      }
    },
    /** Takes back a commit whose media could not be stored; it never comes back by redo. */
    rollback(commit: Commit): boolean { const done = session.rollback(commit); settle(); return done; },
    /** A device-local change made outside the pipeline (a proxy state of the media library). */
    replace(document: ProjectDocument): void { session.replaceDocument(document); settle(); },
    undo(): string | null { live = null; const moved = session.undo(); settle(); return moved?.label ?? null; },
    redo(): string | null { live = null; const moved = session.redo(); settle(); return moved?.label ?? null; },

    /** The length of the undo history now: what a tool sheet remembers when it opens. */
    historyMark(): number { return session.historyLength; },
    /** Confirm of a tool sheet: every step since the mark is one undo step. */
    squashSince(mark: number, label?: string): void { session.squashHistory(mark, label); settle(); },
    /** Cancel of a tool sheet: every step since the mark is taken back, with no step left behind. */
    revertSince(mark: number): number { live = null; const reverted = session.revertHistory(mark); settle(); return reverted; },
    select(selection: timeline.SelectionState): void { session.select(selection); settle(); },
    seek(time: number): void { session.seek(time); settle(); },
    setView(change: Parameters<typeof session.setView>[0]): void { session.setView(change); settle(); },
    setCursorMode(mode: timeline.CursorMode): void { session.setCursorMode(mode); settle(); },
    switchScene(sceneId: string): void { session.switchScene(sceneId); settle(); },
    enterCompound(elementId: string): void { session.enterCompound(elementId); settle(); },
    exitCompound(): void { session.exitCompound(); settle(); },
    cancel(): "gesture" | "selection" { live = null; const level = session.cancel(); settle(); return level; },
    setMagnet(on: boolean): timeline.TimelinePreferences { const next = session.setMagnet(options.prefs(), on, platform()).prefs; settle(); return next; },
    setFreeLayer(on: boolean): timeline.TimelinePreferences { const next = session.setFreeLayer(options.prefs(), on, platform()).prefs; settle(); return next; },
    setReadOnly(reason: string | false): void { session.setReadOnly(reason); settle(); },
    close(): void { session.close(); listeners.clear(); },
  };
}
export type EditorController = ReturnType<typeof createEditorController>;
