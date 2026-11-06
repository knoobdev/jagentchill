import type { ProjectDocument } from "@jagentchill/protocol";
import { commitChange, type Commit, type CommitContext } from "../commit.ts";
import { fitTransitions } from "./transitions.ts";
import {
  canHold, createTrackAt, dissolveOrphans, endOf, isFree, newTrackIndex, pruneEmptyTracks, settleTrack, trackById, tracksOfScene, TRACK_FOR_ELEMENT, type EditContext, type El, type Sc, type Tr,
} from "./model.ts";

/** What a command hands back besides its document change. */
export type CommandOutcome<I = unknown> = {
  /** The element selection after the command (a selection patch); undo restores the one before it. */
  selection?: string[];
  info?: I;
  /** The command placed main-track content itself (a reorder), so the generic closing passes leave it alone. */
  noRipple?: boolean; noMagnet?: boolean; noLinkage?: boolean;
};
export type CommandEnv = { ctx: CommitContext; edit: EditContext; before: ProjectDocument; newId: () => string };
/**
 * One change to project data. `run` edits a draft of the document; the pipeline then applies ripple, the magnet rule,
 * linkage and track pruning, validates, and produces the one state patch and the one undo step of the command.
 */
export type TimelineCommand<I = unknown> = {
  type: string;
  label: string;
  /** `false`: a non-history update (solo, the result of an asynchronous job). */
  history?: boolean;
  /** The scene the step belongs to; undo switches to it first. */
  sceneId?: string;
  /** Consecutive executions with the same key within 1 000 ms merge into one undo step. */
  coalesce?: string;
  /** The merge window in ms (default 1 000); `Infinity` for the edits of one editing session, focus to blur. */
  coalesceWindow_ms?: number;
  run(draft: ProjectDocument, env: CommandEnv): CommandOutcome<I> | void;
};
export type Executed<I = unknown> = { commit: Commit; selection?: string[]; info?: I; command: { type: string; label: string; sceneId?: string; coalesce?: string; coalesceWindow_ms?: number } };

type Interval = { start: number; end: number };
const normalise = (intervals: Interval[]): Interval[] => {
  const sorted = intervals.filter((interval) => interval.end > interval.start).sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged;
};
const subtract = (source: Interval[], covered: Interval[]): Interval[] => {
  let left = source;
  for (const cover of covered) {
    left = left.flatMap((interval) => (cover.end <= interval.start || cover.start >= interval.end ? [interval] : [{ start: interval.start, end: cover.start }, { start: cover.end, end: interval.end }].filter((part) => part.end > part.start)));
  }
  return left;
};

/**
 * The vacated intervals of one track between two states (ported from OpenCut classic `ripple/diff.ts`): an element
 * that left the track, or whose end moved earlier; minus what elements with new ids now cover.
 * `movedAwayCounts`: an element that went to another track vacates too (the magnet rule; classic ripple skips it).
 */
export function vacatedIntervals(before: El[], after: El[], idsAfter: ReadonlySet<string>, movedAwayCounts: boolean): Interval[] {
  const now = new Map(after.map((element) => [element.id, element])), was = new Set(before.map((element) => element.id));
  const vacated: Interval[] = [];
  for (const element of before) {
    const current = now.get(element.id);
    if (!current) { if (movedAwayCounts || !idsAfter.has(element.id)) vacated.push({ start: element.startTime, end: endOf(element) }); continue; }
    if (endOf(element) > endOf(current)) vacated.push({ start: endOf(current), end: endOf(element) });
  }
  const joined = after.filter((element) => !was.has(element.id)).map((element) => ({ start: element.startTime, end: endOf(element) }));
  return subtract(normalise(vacated), normalise(joined));
}

/** Closes the vacated intervals of a track, right to left: every element starting at or after an interval's end moves left by its length. */
export function rippleTrack(before: Tr, track: Tr, idsAfter: ReadonlySet<string>, movedAwayCounts = false): void {
  const freed = vacatedIntervals(before.elements, track.elements, idsAfter, movedAwayCounts);
  for (const interval of freed.reverse()) {
    for (const element of track.elements) if (element.startTime >= interval.end) element.startTime -= interval.end - interval.start;
  }
}

/** Linkage: each element on an unlocked non-main track is attached to the main-track clip whose interval contains its start. Never stored. */
export function attachmentsOf(scene: Sc): Map<string, string> {
  const attached = new Map<string, string>();
  for (const track of tracksOfScene(scene)) {
    if (track === scene.tracks.main || track.locked) continue;
    for (const element of track.elements) {
      const host = scene.tracks.main.elements.find((clip) => clip.startTime <= element.startTime && element.startTime < endOf(clip));
      if (host) attached.set(element.id, host.id);
    }
  }
  return attached;
}

function applyLinkage(scene: Sc, was: Sc, newId: () => string): void {
  const attached = attachmentsOf(was);
  if (attached.size === 0) return;
  const hostBefore = new Map(was.tracks.main.elements.map((clip) => [clip.id, clip.startTime]));
  const hostNow = new Map(scene.tracks.main.elements.map((clip) => [clip.id, clip.startTime]));
  const startBefore = new Map(tracksOfScene(was).flatMap((track) => track.elements.map((element) => [element.id, element.startTime] as const)));
  const moved: { track: Tr; element: El }[] = [];
  for (const track of tracksOfScene(scene)) {
    if (track === scene.tracks.main || track.locked) continue;
    for (const element of track.elements) {
      const host = attached.get(element.id);
      // A clip that was deleted, cut or sent to an overlay leaves its attached elements where they are.
      if (host === undefined || !hostNow.has(host)) continue;
      const delta = hostNow.get(host)! - hostBefore.get(host)!;
      // An element the command itself moved is not moved a second time.
      if (delta === 0 || element.startTime !== startBefore.get(element.id)) continue;
      element.startTime = Math.max(0, element.startTime + delta);
      moved.push({ track, element });
    }
  }
  for (const { track, element } of moved) {
    const ignore = new Set([element.id]);
    if (isFree(track, element.startTime, endOf(element), ignore)) continue;
    track.elements.splice(track.elements.indexOf(element), 1);
    const target = tracksOfScene(scene).find((candidate) => candidate !== scene.tracks.main && !candidate.locked && canHold(candidate, element.type) && isFree(candidate, element.startTime, endOf(element)))
      ?? createTrackAt(scene, TRACK_FOR_ELEMENT[element.type], newTrackIndex(scene, TRACK_FOR_ELEMENT[element.type], "highest"), newId);
    target.elements.push(element);
  }
}

/** The passes that follow every execute, in order: ripple, the magnet rule, linkage shift, empty-track pruning. */
function settleTimeline(before: ProjectDocument, draft: ProjectDocument, env: CommandEnv, outcome: CommandOutcome): void {
  const previous = new Map((before.scenes as unknown as Sc[]).map((scene) => [scene.id, scene]));
  for (const scene of draft.scenes as unknown as Sc[]) {
    const was = previous.get(scene.id);
    if (was) {
      const idsAfter = new Set(tracksOfScene(scene).flatMap((track) => track.elements.map((element) => element.id)));
      for (const track of tracksOfScene(scene)) {
        const prior = trackById(was, track.id);
        if (!prior || track.locked) continue;
        const main = track === scene.tracks.main;
        if (main && env.edit.magnet && !env.edit.freeLayer && !outcome.noMagnet) rippleTrack(prior, track, idsAfter, true);
        else if (env.edit.ripple && !outcome.noRipple) rippleTrack(prior, track, idsAfter);
      }
      if (env.edit.linkage && !outcome.noLinkage) applyLinkage(scene, was, env.newId);
    }
    dissolveOrphans(scene);
    pruneEmptyTracks(scene);
    for (const track of tracksOfScene(scene)) {
      settleTrack(track);
      // A clip that was trimmed, split or re-timed may no longer hold its transitions at their length.
      if (track.transitions.length > 0) fitTransitions(track, draft.settings.fps);
    }
  }
}

/**
 * Executes one command through the single commit pipeline. A command that fails — a refusal, a validation finding,
 * a parameter that does not coerce — throws, and the document it was given is untouched.
 */
export function executeCommand<I = unknown>(doc: ProjectDocument, ctx: CommitContext, edit: EditContext, command: TimelineCommand<I>): Executed<I> {
  let outcome: CommandOutcome<I> = {};
  const env: CommandEnv = { ctx, edit, before: doc, newId: ctx.newId };
  const commit = commitChange(doc, ctx, { commandType: command.type, label: command.label, history: command.history }, (draft) => {
    outcome = command.run(draft, env) ?? {};
    settleTimeline(doc, draft, env, outcome);
  });
  return { commit, selection: outcome.selection, info: outcome.info, command: { type: command.type, label: command.label, sceneId: command.sceneId, coalesce: command.coalesce, coalesceWindow_ms: command.coalesceWindow_ms } };
}

/** Executes its children in order as one step; the last selection result wins. Undo reverts the whole step, so in reverse. */
export function batch(label: string, commands: TimelineCommand[], type = "batch"): TimelineCommand<unknown[]> {
  return {
    type, label, sceneId: commands.find((command) => command.sceneId)?.sceneId,
    run(draft, env) {
      const merged: CommandOutcome<unknown[]> = { info: [] };
      for (const command of commands) {
        const outcome = command.run(draft, env) ?? {};
        if (outcome.selection) merged.selection = outcome.selection;
        merged.info!.push(outcome.info);
        merged.noRipple ||= outcome.noRipple; merged.noMagnet ||= outcome.noMagnet; merged.noLinkage ||= outcome.noLinkage;
      }
      return merged;
    },
  };
}
