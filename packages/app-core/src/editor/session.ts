import { applyPatch, createHistory, type Commit } from "@jagentchill/editor-core";
import { TICKS_PER_SECOND, type ProjectDocument } from "@jagentchill/protocol";

/**
 * The undo history of an editing session, with the one thing the media library adds to it: taking back a commit
 * whose media could not be stored. A rolled-back step never comes back — it is neither undoable nor redoable.
 */
export function createSessionHistory() {
  const history = createHistory();
  // Steps at the bottom of the redo stack that were rolled back: redo must never reach them.
  let redoDepth = 0, dead = 0;
  return {
    get canUndo(): boolean { return history.canUndo; },
    get canRedo(): boolean { return redoDepth > dead; },
    get undoLabel(): string | undefined { return history.undoLabel; },
    get redoLabel(): string | undefined { return redoDepth > dead ? history.redoLabel : undefined; },
    record(before: ProjectDocument, commit: Commit): ProjectDocument {
      // A recorded step clears the redo stack, the rolled-back steps with it.
      if (commit.history && commit.patch.length > 0) { redoDepth = 0; dead = 0; }
      return history.record(before, commit);
    },
    undo(current: ProjectDocument): ProjectDocument | null {
      const move = history.undo(current, applyPatch);
      if (!move) return null;
      redoDepth++;
      return move.document;
    },
    redo(current: ProjectDocument): ProjectDocument | null {
      if (redoDepth <= dead) return null;
      const move = history.redo(current, applyPatch);
      if (!move) return null;
      redoDepth--;
      return move.document;
    },
    /**
     * Takes back the most recent step when it is this commit. Steps recorded after it (the import of the next file
     * never is: files are processed one after another) keep the commit in the history, and `null` is returned.
     */
    rollback(current: ProjectDocument, commit: Commit): ProjectDocument | null {
      if (!commit.history || commit.patch.length === 0 || history.undoLabel !== commit.label || redoDepth !== dead) return null;
      const move = history.undo(current, applyPatch);
      if (!move) return null;
      redoDepth++; dead = redoDepth;
      return move.document;
    },
    clear(): void { history.clear(); redoDepth = 0; dead = 0; },
  };
}
export type SessionHistory = ReturnType<typeof createSessionHistory>;

import { durationBadge } from "../projects/logic.ts";

/** Elapsed recording time: "00:07", with tenths never shown. */
export const elapsedLabel = (ms: number): string => durationBadge(Math.floor(Math.max(0, ms) / 1000) * TICKS_PER_SECOND);
/** "48 kHz", "44.1 kHz". */
export const sampleRateLabel = (hertz: number): string => `${Number((hertz / 1000).toFixed(1))} kHz`;
/** "Mono", "Stereo", else the channel count. */
export const channelsLabel = (channels: number): string => (channels === 1 ? "Mono" : channels === 2 ? "Stereo" : `${channels} channels`);
/** The usage badge of a card: "Used" for one reference, "Used ×N" for more; `null` when the asset is unused. */
export const usageBadge = (count: number): string | null => (count <= 0 ? null : count === 1 ? "Used" : `Used ×${count}`);
/** Columns of the media grid: auto-fill with a minimum column width, never fewer than one. */
export function mediaGridColumns(width: number, minColumn: number, gap: number): number {
  return Math.max(1, Math.floor((width + gap) / (minColumn + gap)));
}
