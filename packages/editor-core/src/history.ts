import type { ProjectDocument } from "@jagentchill/protocol";
import type { Commit } from "./commit.ts";
import { diffDocuments, type StatePatch } from "./patch.ts";

/** What the editor keeps beside the documents of a step: the selection on both sides, the scene, the coalescing key. */
export type StepExtra<S = unknown> = { selectionBefore?: S; selectionAfter?: S; sceneId?: string; coalesce?: string; at_ms?: number; /** The merge window of this key; an editing session (focus to blur) has none. */ window_ms?: number };
/** One undo step: the document on both sides of a committed change. */
type Step<S> = { before: ProjectDocument; after: ProjectDocument; label: string; commandType: string } & StepExtra<S>;
export type HistoryMove<S = unknown> = { document: ProjectDocument; patch: StatePatch; label: string; selection?: S; sceneId?: string } | null;

export const HISTORY_LIMIT = 200;
export const COALESCE_WINDOW_MS = 1000;

/**
 * The undo history of an editing session, in memory, at most `limit` steps (the oldest is discarded). A commit with
 * `history: false` (solo, a matte that arrived, probe results) emits its patch and adds no step. Undo and redo move
 * between stored documents, so redo of a creating command restores the entity with the same id; each of them
 * produces a patch of its own.
 */
export function createHistory<S = unknown>(options: { limit?: number } = {}) {
  const limit = options.limit ?? HISTORY_LIMIT;
  const undoStack: Step<S>[] = [], redoStack: Step<S>[] = [];
  // The redo steps the last new step displaced, and how long the history was then: a cancelled tool sheet gives them back.
  let displaced: { at: number; steps: Step<S>[] } | null = null;
  return {
    get length(): number { return undoStack.length; },
    get canUndo(): boolean { return undoStack.length > 0; },
    get canRedo(): boolean { return redoStack.length > 0; },
    /** The name of the step undo would revert ("Undo Split" in the button tooltip). */
    get undoLabel(): string | undefined { return undoStack[undoStack.length - 1]?.label; },
    get redoLabel(): string | undefined { return redoStack[redoStack.length - 1]?.label; },
    /** Records a committed change and returns the document to continue from. A rejected command never reaches here. */
    record(before: ProjectDocument, commit: Commit, extra: StepExtra<S> = {}): ProjectDocument {
      if (commit.history && commit.patch.length > 0) {
        const last = undoStack[undoStack.length - 1];
        // The same discrete action on the same selection and property within the window is one step: holding a key.
        const merges = last !== undefined && extra.coalesce !== undefined && last.coalesce === extra.coalesce
          && extra.at_ms !== undefined && last.at_ms !== undefined && extra.at_ms - last.at_ms <= (extra.window_ms ?? COALESCE_WINDOW_MS);
        if (merges) Object.assign(last, { after: commit.document, selectionAfter: extra.selectionAfter, at_ms: extra.at_ms });
        else {
          if (redoStack.length > 0) displaced = { at: undoStack.length, steps: redoStack.slice() };
          undoStack.push({ before, after: commit.document, label: commit.label, commandType: commit.commandType, ...extra });
        }
        if (undoStack.length > limit) { undoStack.splice(0, undoStack.length - limit); displaced = null; }
        redoStack.length = 0;
      }
      return commit.document;
    },
    /** Any other action or a selection change starts a new entry: the last step no longer accepts merges. */
    seal(): void { const last = undoStack[undoStack.length - 1]; if (last) last.coalesce = undefined; },
    /**
     * Undoes the last step on top of `current`. Changes made since by non-history updates (which add no step) are
     * kept: the step's inverse patch is what gets applied, not a stored snapshot.
     */
    undo(current: ProjectDocument, apply: (document: ProjectDocument, patch: StatePatch) => ProjectDocument): HistoryMove<S> {
      const step = undoStack.pop();
      if (!step) return null;
      step.coalesce = undefined;
      if (displaced && undoStack.length < displaced.at) displaced = null;
      redoStack.push(step);
      const patch = diffDocuments(step.after, step.before).filter((entry) => entry.path !== "/metadata/updated_ms");
      return { document: apply(current, patch), patch, label: step.label, selection: step.selectionBefore, sceneId: step.sceneId };
    },
    redo(current: ProjectDocument, apply: (document: ProjectDocument, patch: StatePatch) => ProjectDocument): HistoryMove<S> {
      const step = redoStack.pop();
      if (!step) return null;
      undoStack.push(step);
      const patch = diffDocuments(step.before, step.after).filter((entry) => entry.path !== "/metadata/updated_ms");
      return { document: apply(current, patch), patch, label: step.label, selection: step.selectionAfter, sceneId: step.sceneId };
    },
    /**
     * Makes one step of every step recorded after the history was `mark` steps long — what a tool sheet does on confirm,
     * so one undo returns to where the sheet was opened. Nothing happens with fewer than two such steps.
     */
    squashSince(mark: number, label?: string): void {
      if (mark < 0 || undoStack.length - mark < 2) return;
      const merged = undoStack.splice(mark), first = merged[0], last = merged[merged.length - 1];
      undoStack.push({ ...last, before: first.before, selectionBefore: first.selectionBefore, label: label ?? last.label, coalesce: undefined });
    },
    /**
     * After the steps made since `mark` were taken back and forgotten (a cancelled tool sheet): the redo steps the first
     * of them displaced are available again, so the history is what it was when the sheet opened.
     */
    restoreRedo(mark: number): void {
      if (displaced && displaced.at === mark && undoStack.length === mark && redoStack.length === 0) redoStack.push(...displaced.steps);
      displaced = null;
    },
    /** Forgets the step undo just reverted: a change whose media could not be stored is neither undoable nor redoable. */
    forgetUndone(): void { redoStack.pop(); },
    /** A restored snapshot or a reloaded project starts with an empty history. */
    clear(): void { undoStack.length = 0; redoStack.length = 0; displaced = null; },
  };
}
export type History<S = unknown> = ReturnType<typeof createHistory<S>>;
