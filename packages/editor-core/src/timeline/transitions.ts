import type { ProjectDocument, Rational } from "@jagentchill/protocol";
import { paramDefaults } from "../catalogue/params.ts";
import { transitionDefinition, TRANSITION_EASINGS } from "../catalogue/transitions.ts";
import { clone, type Json } from "../model.ts";
import { floorToFrame, frameDuration } from "../time/index.ts";
import type { TimelineCommand } from "./command.ts";
import { endOf, refuse, rejectDoc, sceneById, tracksOfScene, type El, type Sc, type Tr } from "./model.ts";
import { coerceParam, ParamRejected } from "./params.ts";

/**
 * Picture transitions on the timeline (`transitions`): where one may sit, how long it may be, what it needs from the
 * clips' source handles, and the commands that add, replace, edit, remove and copy it. The stored record is
 * `project-document.Track transition records`; this module owns the behaviour on it.
 */

const TICKS_PER_SECOND = 120_000;
export const TRANSITION_ELEMENT_TYPES = ["video", "image", "compound"] as const;
export const TRANSITION_MIN_SECONDS = 0.1, TRANSITION_MAX_SECONDS = 5, DEFAULT_TRANSITION_SECONDS = 0.5;
export const TRANSITION_MESSAGES = {
  noCut: "Place two clips next to each other to add a transition",
  limited: (seconds: number) => `Limited to ${seconds.toFixed(1)}s by clip length`,
  held: (outgoing: number, incoming: number) => `Not enough extra footage: ${outgoing.toFixed(1)}s of the outgoing clip and ${incoming.toFixed(1)}s of the incoming clip are held frames.`,
  applied: (cuts: number, shortened: number) => `Applied to ${cuts} cuts${shortened > 0 ? ` (${shortened} shortened to fit)` : ""}`,
  extracted: "Audio was extracted. Add a crossfade on the audio track.",
  fadeReplaced: "Replaced by the transition's audio crossfade",
  unavailable: "Unavailable transition",
  presetLimit: "Preset limit reached (200)",
} as const;

export type PictureTransition = { id: string; kind: "transition"; fromElementId: string; toElementId: string; duration: number; type: string; params: Record<string, number | boolean | string>; easing: string; audioCrossfade: boolean; shape: string };
export type TransitionDefaults = { type: string; duration: number };
/** The user's default transition until "Set as default" changes it: a Cross Dissolve of 0.5 s. */
export const INITIAL_TRANSITION_DEFAULTS: TransitionDefaults = { type: "cross-dissolve", duration: DEFAULT_TRANSITION_SECONDS * TICKS_PER_SECOND };

const pictureRecords = (track: Tr): PictureTransition[] => track.transitions.filter((record) => record.kind === "transition") as unknown as PictureTransition[];

/** Whether a transition may join two elements: same video track, each a video, image or compound, exactly adjacent. */
export function isEligibleCut(track: Tr, from: El | undefined, to: El | undefined): boolean {
  if (!from || !to || track.type !== "video") return false;
  const types: readonly string[] = TRANSITION_ELEMENT_TYPES;
  return types.includes(from.type) && types.includes(to.type) && endOf(from) === to.startTime;
}
export type Cut = { trackId: string; fromId: string; toId: string; time: number; transitionId: string | null };
/** Every eligible cut of a scene, the main track and overlay video tracks alike, in time order per track. */
export function eligibleCuts(scene: Sc): Cut[] {
  const cuts: Cut[] = [];
  for (const track of tracksOfScene(scene)) {
    if (track.type !== "video") continue;
    const ordered = [...track.elements].sort((a, b) => a.startTime - b.startTime);
    for (let index = 0; index + 1 < ordered.length; index++) {
      if (!isEligibleCut(track, ordered[index], ordered[index + 1])) continue;
      const record = pictureRecords(track).find((entry) => entry.fromElementId === ordered[index].id && entry.toElementId === ordered[index + 1].id);
      cuts.push({ trackId: track.id, fromId: ordered[index].id, toId: ordered[index + 1].id, time: ordered[index + 1].startTime, transitionId: record?.id ?? null });
    }
  }
  return cuts;
}
/** The eligible cut nearest a time on the main track (the target of "+" and of the default-transition action with nothing selected). */
export function nearestCut(scene: Sc, time: number, trackId = scene.tracks.main.id): Cut | null {
  const cuts = eligibleCuts(scene).filter((cut) => cut.trackId === trackId);
  return cuts.reduce<Cut | null>((best, cut) => (!best || Math.abs(cut.time - time) < Math.abs(best.time - time) ? cut : best), null);
}

/** The window of a transition of duration D on a cut: `[cut − floorToFrame(D / 2), cut − floorToFrame(D / 2) + D)`. */
export function transitionWindow(cut: number, duration: number, fps: Rational): { start: number; end: number; before: number; after: number } {
  const before = floorToFrame(Math.floor(duration / 2), fps);
  return { start: cut - before, end: cut - before + duration, before, after: duration - before };
}

/** A duration in seconds on the 0.1 s grid as whole frames, at least 2 frames. */
export function durationToTicks(seconds: number, fps: Rational): number {
  // Tenths of a second to whole frames by the rate itself, so that no tick value is divided.
  const count = Math.round((Math.round(seconds * 10) * fps.numerator) / (10 * fps.denominator));
  return Math.max(2, count) * frameDuration(fps);
}
/**
 * The limits of a transition between two clips, in seconds on the 0.1 s grid: 0.1 … 5.0, and no more than what both
 * clips can hold — for each clip, the part of its in-transition window and the part of its out-transition window that
 * lie inside it together do not exceed its duration. `max` is below `min` when not even the shortest fits.
 */
export function durationLimits(track: Tr, fromId: string, toId: string, fps: Rational, ownId?: string): { min: number; max: number } {
  const from = track.elements.find((element) => element.id === fromId)!, to = track.elements.find((element) => element.id === toId)!;
  const records = pictureRecords(track).filter((record) => record.id !== ownId);
  const incoming = records.find((record) => record.toElementId === fromId), outgoing = records.find((record) => record.fromElementId === toId);
  // What the neighbours already take: the part after the cut of `from`'s in-transition, the part before the cut of `to`'s out-transition.
  const roomFrom = from.duration - (incoming ? transitionWindow(from.startTime, incoming.duration, fps).after : 0);
  const roomTo = to.duration - (outgoing ? transitionWindow(endOf(to), outgoing.duration, fps).before : 0);
  let max = 0;
  for (let tenths = TRANSITION_MAX_SECONDS * 10; tenths >= 1; tenths--) {
    const window = transitionWindow(0, durationToTicks(tenths / 10, fps), fps);
    if (window.before <= roomFrom && window.after <= roomTo) { max = tenths / 10; break; }
  }
  return { min: TRANSITION_MIN_SECONDS, max };
}
/** A duration a person entered, brought into the limits of its cut; `clamped` when the clip length was the reason. */
export function clampDuration(seconds: number, limits: { min: number; max: number }, fps: Rational): { duration: number; seconds: number; clamped: boolean; message?: string } {
  const asked = Math.round(Math.min(Math.max(Number.isFinite(seconds) ? seconds : limits.min, TRANSITION_MIN_SECONDS), TRANSITION_MAX_SECONDS) * 10) / 10;
  const fitted = Math.min(asked, limits.max);
  const clamped = fitted < asked;
  return { duration: durationToTicks(fitted, fps), seconds: fitted, clamped, ...(clamped ? { message: TRANSITION_MESSAGES.limited(fitted) } : {}) };
}
/** The check of an agent tool call: a duration outside the limits of its cut is refused, never clamped. */
export function checkToolDuration(seconds: number, limits: { min: number; max: number }): { ok: true } | { ok: false; code: "OUT_OF_RANGE"; details: { field: "duration"; min: number; max: number; value: number } } {
  return seconds >= limits.min && seconds <= limits.max ? { ok: true } : { ok: false, code: "OUT_OF_RANGE", details: { field: "duration", min: limits.min, max: limits.max, value: seconds } };
}

/**
 * Held frames of a transition, in ticks of timeline time per side. A clip continues into its source handle through the
 * window; where the handle is shorter, its boundary frame is held. Images, freeze elements and compounds have
 * unlimited handles. Handles are measured in source time: a clip at 2× needs twice the media, and a reversed clip
 * takes its outgoing handle from the media before its source in-point.
 */
export function heldFrames(track: Tr, record: Pick<PictureTransition, "fromElementId" | "toElementId" | "duration">, fps: Rational): { outgoing: number; incoming: number; warning: boolean; message?: string } {
  const from = track.elements.find((element) => element.id === record.fromElementId), to = track.elements.find((element) => element.id === record.toElementId);
  if (!from || !to) return { outgoing: 0, incoming: 0, warning: false };
  const window = transitionWindow(to.startTime, record.duration, fps);
  const unlimited = (element: El) => element.type !== "video" || element.freeze !== undefined && element.freeze !== null;
  const side = (element: El, needed: number, leaving: boolean): number => {
    if (unlimited(element) || needed <= 0) return 0;
    const retime = (element.retime ?? {}) as { rate?: number; reverse?: boolean };
    // Source ticks shown per timeline tick, averaged over the clip (a speed curve included).
    const sourceSpan = typeof element.sourceDuration === "number" ? element.sourceDuration - element.trimStart - element.trimEnd : element.duration * (retime.rate ?? 1);
    const rate = element.duration > 0 && sourceSpan > 0 ? sourceSpan / element.duration : retime.rate ?? 1;
    // Leaving forward, or arriving reversed, reads the media after the out-point; the other two read what precedes the in-point.
    const handle = leaving !== (retime.reverse === true) ? element.trimEnd : element.trimStart;
    const held = needed - Math.floor(handle / rate);
    // Rounded up to whole frames.
    return held <= 0 ? 0 : floorToFrame(held + frameDuration(fps) - 1, fps);
  };
  const outgoing = side(from, window.after, true), incoming = side(to, window.before, false);
  const warning = outgoing > 0 || incoming > 0;
  return { outgoing, incoming, warning, ...(warning ? { message: TRANSITION_MESSAGES.held(outgoing / TICKS_PER_SECOND, incoming / TICKS_PER_SECOND) } : {}) };
}

/**
 * Re-runs the duration limits on every picture transition of a track after a command changed its clips (a trim, a
 * split, a speed change): a transition that no longer fits is shortened to its new maximum, and removed when that
 * falls below the minimum. Part of the same undo step as the command.
 */
export function fitTransitions(track: Tr, fps: Rational): { shortened: string[]; removed: string[] } {
  const shortened: string[] = [], removed: string[] = [];
  for (const record of pictureRecords(track)) {
    if (!track.elements.some((element) => element.id === record.fromElementId) || !track.elements.some((element) => element.id === record.toElementId)) continue;
    const limits = durationLimits(track, record.fromElementId, record.toElementId, fps, record.id);
    const window = transitionWindow(0, record.duration, fps);
    const from = track.elements.find((element) => element.id === record.fromElementId)!, to = track.elements.find((element) => element.id === record.toElementId)!;
    const others = pictureRecords(track).filter((entry) => entry.id !== record.id);
    const before = others.find((entry) => entry.toElementId === from.id), after = others.find((entry) => entry.fromElementId === to.id);
    const fits = window.before <= from.duration - (before ? transitionWindow(0, before.duration, fps).after : 0) && window.after <= to.duration - (after ? transitionWindow(0, after.duration, fps).before : 0);
    if (fits) continue;
    if (limits.max < limits.min) {
      track.transitions = track.transitions.filter((entry) => entry.id !== record.id);
      for (const element of track.elements) { if (element.transitionOut === record.id) element.transitionOut = null; if (element.transitionIn === record.id) element.transitionIn = null; }
      removed.push(record.id);
    } else {
      (record as { duration: number }).duration = durationToTicks(limits.max, fps);
      shortened.push(record.id);
    }
  }
  return { shortened, removed };
}

function located(draft: ProjectDocument, transitionId: string): { scene: Sc; track: Tr; record: PictureTransition } {
  for (const scene of draft.scenes as unknown as Sc[]) for (const track of tracksOfScene(scene)) {
    const record = pictureRecords(track).find((entry) => entry.id === transitionId);
    if (record) return { scene, track, record };
  }
  return rejectDoc("document/unknown-reference", "", `transition "${transitionId}" does not exist`);
}
/** The transition of a document by id, with its track; `null` when there is none. */
export function findTransition(doc: ProjectDocument, transitionId: string): { sceneId: string; trackId: string; record: PictureTransition } | null {
  for (const scene of doc.scenes as unknown as Sc[]) for (const track of tracksOfScene(scene)) {
    const record = pictureRecords(track).find((entry) => entry.id === transitionId);
    if (record) return { sceneId: scene.id, trackId: track.id, record };
  }
  return null;
}
const cutTrack = (scene: Sc, fromId: string, toId: string): Tr => {
  const track = tracksOfScene(scene).find((candidate) => candidate.elements.some((element) => element.id === fromId));
  const from = track?.elements.find((element) => element.id === fromId), to = track?.elements.find((element) => element.id === toId);
  if (!track || !isEligibleCut(track, from, to)) refuse(TRANSITION_MESSAGES.noCut, "no-eligible-cut");
  if (track!.locked) refuse("The track is locked", "track-locked");
  return track!;
};
/** Parameter values of a type: its defaults with the given values coerced on top; an unknown key or a bad value fails. */
export function coerceTransitionParams(type: string, values: Record<string, unknown> = {}): Record<string, number | boolean | string> {
  const definition = transitionDefinition(type);
  if (!definition) return { ...(values as Record<string, number | boolean | string>) };
  const out = paramDefaults(definition.params);
  for (const [key, value] of Object.entries(values)) {
    const param = definition.params.find((entry) => entry.key === key);
    if (!param) throw new ParamRejected(key, `"${key}" is not a parameter of the ${definition.name} transition`);
    out[key] = coerceParam(param, value);
  }
  return out;
}

export type ApplyInfo = { transitionId: string; replaced: boolean; clamped: boolean; message?: string };
function applyOnCut(track: Tr, fromId: string, toId: string, fps: Rational, values: { type: string; seconds: number; params?: Record<string, unknown>; easing?: string; audioCrossfade?: boolean; shape?: string }, newId: () => string, forcedId?: string): ApplyInfo {
  const existing = pictureRecords(track).find((entry) => entry.fromElementId === fromId && entry.toElementId === toId);
  if (existing) {
    // Replacing keeps the id, duration, easing, audio crossfade and shape, and resets the params to the new type's defaults.
    existing.type = values.type;
    existing.params = coerceTransitionParams(values.type, values.params);
    return { transitionId: existing.id, replaced: true, clamped: false };
  }
  const fitted = clampDuration(values.seconds, durationLimits(track, fromId, toId, fps), fps);
  if (fitted.seconds < TRANSITION_MIN_SECONDS) refuse(TRANSITION_MESSAGES.limited(0), "no-room");
  const id = forcedId ?? newId();
  track.transitions.push({ id, kind: "transition", fromElementId: fromId, toElementId: toId, duration: fitted.duration, type: values.type, params: coerceTransitionParams(values.type, values.params), easing: values.easing ?? "ease-in-out", audioCrossfade: values.audioCrossfade ?? true, shape: values.shape ?? "equal-power" });
  track.elements.find((element) => element.id === fromId)!.transitionOut = id;
  track.elements.find((element) => element.id === toId)!.transitionIn = id;
  return { transitionId: id, replaced: false, clamped: fitted.clamped, message: fitted.message };
}

/**
 * Adds a transition on the cut between two adjacent clips, or replaces the one already there. One undo step; the new
 * transition is the selection. `id` fixes the record id (redo restores the exact transition).
 */
export const applyTransition = (options: { sceneId: string; fromId: string; toId: string; type: string; seconds?: number; params?: Record<string, unknown>; id?: string }): TimelineCommand<ApplyInfo> => ({
  type: "transition.apply", label: "Add transition", sceneId: options.sceneId,
  run(draft, env) {
    const scene = sceneById(draft, options.sceneId), track = cutTrack(scene, options.fromId, options.toId);
    return { info: applyOnCut(track, options.fromId, options.toId, draft.settings.fps, { type: options.type, seconds: options.seconds ?? DEFAULT_TRANSITION_SECONDS, params: options.params }, env.newId, options.id), selection: [] };
  },
});
/** "+" on a tile: the selected cut, else the eligible cut nearest the playhead on the main track. */
export function applyTransitionAtPlayhead(doc: ProjectDocument, options: { sceneId: string; playhead: number; type: string; seconds?: number; selectedTransitionId?: string }): TimelineCommand<ApplyInfo> {
  const scene = sceneById(doc, options.sceneId);
  const selected = options.selectedTransitionId ? eligibleCuts(scene).find((cut) => cut.transitionId === options.selectedTransitionId) : undefined;
  const cut = selected ?? nearestCut(scene, options.playhead);
  if (!cut) return { type: "transition.apply", label: "Add transition", sceneId: options.sceneId, run: () => refuse(TRANSITION_MESSAGES.noCut, "no-eligible-cut") };
  return applyTransition({ sceneId: options.sceneId, fromId: cut.fromId, toId: cut.toId, type: options.type, seconds: options.seconds });
}
/** `transition.add-default`: the default type and duration on every eligible cut touching the selection, or on the cut nearest the playhead. */
export const addDefaultTransitions = (options: { sceneId: string; elementIds: string[]; playhead: number; defaults?: TransitionDefaults }): TimelineCommand<{ transitionIds: string[] }> => ({
  type: "transition.add-default", label: "Add default transition", sceneId: options.sceneId,
  run(draft, env) {
    const scene = sceneById(draft, options.sceneId), defaults = options.defaults ?? INITIAL_TRANSITION_DEFAULTS, wanted = new Set(options.elementIds);
    const all = eligibleCuts(scene);
    // A cut touches the selection when both of its clips are selected; a single selected clip gives its two cuts.
    let cuts = wanted.size > 1 ? all.filter((cut) => wanted.has(cut.fromId) && wanted.has(cut.toId)) : all.filter((cut) => wanted.has(cut.fromId) || wanted.has(cut.toId));
    if (wanted.size === 0) { const nearest = nearestCut(scene, options.playhead); cuts = nearest ? [nearest] : []; }
    cuts = cuts.filter((cut) => cut.transitionId === null && !tracksOfScene(scene).find((track) => track.id === cut.trackId)!.locked);
    if (cuts.length === 0) refuse(TRANSITION_MESSAGES.noCut, "no-eligible-cut");
    const ids = cuts.map((cut) => applyOnCut(tracksOfScene(scene).find((track) => track.id === cut.trackId)!, cut.fromId, cut.toId, draft.settings.fps, { type: defaults.type, seconds: defaults.duration / TICKS_PER_SECOND }, env.newId).transitionId);
    return { info: { transitionIds: ids } };
  },
});

/** Changes a transition's type: params reset to the new type's defaults; id, duration, easing, audio crossfade and shape stay. */
export const replaceTransition = (transitionId: string, type: string): TimelineCommand<{ transitionId: string }> => ({
  type: "transition.replace", label: "Replace transition",
  run(draft) {
    const { track, record } = located(draft, transitionId);
    if (track.locked) refuse("The track is locked", "track-locked");
    record.type = type;
    record.params = coerceTransitionParams(type);
    return { info: { transitionId } };
  },
});

export type TransitionEdit = { seconds?: number; params?: Record<string, unknown>; easing?: string; audioCrossfade?: boolean; shape?: string };
/**
 * Edits a transition. A person's duration is clamped to the limits of its cut (`info.message` is the "Limited to …"
 * text); `strict` is the agent path, where a duration outside the limits rejects the whole call with `OUT_OF_RANGE`.
 */
export const editTransition = (transitionId: string, edit: TransitionEdit, options: { strict?: boolean; coalesce?: string } = {}): TimelineCommand<{ seconds: number; clamped: boolean; message?: string }> => ({
  type: "transition.edit", label: "Edit transition", coalesce: options.coalesce,
  run(draft) {
    const { track, record } = located(draft, transitionId), fps = draft.settings.fps;
    if (track.locked) refuse("The track is locked", "track-locked");
    let info = { seconds: record.duration / TICKS_PER_SECOND, clamped: false } as { seconds: number; clamped: boolean; message?: string };
    if (edit.seconds !== undefined) {
      const limits = durationLimits(track, record.fromElementId, record.toElementId, fps, record.id);
      if (options.strict) {
        const check = checkToolDuration(edit.seconds, limits);
        if (!check.ok) refuse(`duration ${edit.seconds} s is outside ${limits.min}–${limits.max} s for this cut`, check.code, check.details);
      }
      const fitted = clampDuration(edit.seconds, limits, fps);
      record.duration = fitted.duration;
      info = { seconds: fitted.seconds, clamped: fitted.clamped, message: fitted.message };
    }
    if (edit.params) record.params = { ...record.params, ...Object.fromEntries(Object.entries(coerceTransitionParams(record.type, edit.params)).filter(([key]) => key in edit.params!)) };
    if (edit.easing !== undefined) {
      if (!(TRANSITION_EASINGS as readonly string[]).includes(edit.easing)) throw new ParamRejected("easing", `"${edit.easing}" is not an easing`);
      record.easing = edit.easing;
    }
    if (edit.audioCrossfade !== undefined) record.audioCrossfade = edit.audioCrossfade;
    if (edit.shape !== undefined) record.shape = edit.shape;
    return { info };
  },
});
/** Dragging an edge of the bar: both edges move, so the duration changes by twice the drag, frame-snapped and clamped. */
export const resizeTransition = (transitionId: string, edgeDelta: number): TimelineCommand<{ seconds: number; clamped: boolean; message?: string; tooltip: string }> => ({
  type: "transition.edit", label: "Resize transition",
  run(draft, env) {
    const { record } = located(draft, transitionId);
    const outcome = editTransition(transitionId, { seconds: (record.duration + 2 * edgeDelta) / TICKS_PER_SECOND }).run(draft, env)!;
    return { info: { ...outcome.info!, tooltip: `${outcome.info!.seconds.toFixed(1)}s` } };
  },
});

function drop(track: Tr, ids: ReadonlySet<string>): void {
  track.transitions = track.transitions.filter((record) => !ids.has(String(record.id)));
  for (const element of track.elements) {
    if (typeof element.transitionOut === "string" && ids.has(element.transitionOut)) element.transitionOut = null;
    if (typeof element.transitionIn === "string" && ids.has(element.transitionIn)) element.transitionIn = null;
  }
}
/** Removes a transition: the record and both references, in one step; neither clip moves or is trimmed. */
export const removeTransition = (transitionId: string): TimelineCommand<{ removed: number }> => ({
  type: "transition.remove", label: "Remove transition",
  run(draft) {
    const { track } = located(draft, transitionId);
    if (track.locked) refuse("The track is locked", "track-locked");
    drop(track, new Set([transitionId]));
    return { info: { removed: 1 }, noRipple: true, noMagnet: true };
  },
});
/** The number "Remove all transitions" states in its confirm dialog. */
export const countTransitions = (doc: ProjectDocument, sceneId: string): number => tracksOfScene(sceneById(doc, sceneId)).reduce((sum, track) => sum + pictureRecords(track).length, 0);
export const removeAllTransitions = (sceneId: string): TimelineCommand<{ removed: number }> => ({
  type: "transition.remove-all", label: "Remove all transitions", sceneId,
  run(draft) {
    let removed = 0;
    for (const track of tracksOfScene(sceneById(draft, sceneId))) {
      if (track.locked) continue;
      const ids = new Set(pictureRecords(track).map((record) => record.id));
      removed += ids.size;
      drop(track, ids);
    }
    return { info: { removed }, noRipple: true, noMagnet: true };
  },
});

/**
 * "Apply to all": the transition's type, params, easing, duration, audio-crossfade setting and shape on every eligible
 * cut of its track, replacing what is there; each copy is clamped on its own cut. A locked track is skipped.
 */
export const applyTransitionToAll = (transitionId: string): TimelineCommand<{ applied: number; shortened: number; message: string }> => ({
  type: "transition.apply-to-all", label: "Apply to all",
  run(draft, env) {
    const { scene, track, record } = located(draft, transitionId), fps = draft.settings.fps;
    if (track.locked) return { info: { applied: 0, shortened: 0, message: TRANSITION_MESSAGES.applied(0, 0) } };
    const source = clone(record) as PictureTransition, wanted = durationToTicks(source.duration / TICKS_PER_SECOND, fps);
    const cuts = eligibleCuts(scene).filter((cut) => cut.trackId === track.id);
    // Every cut starts from nothing, so that each copy is limited by its neighbours' copies and not by what was there.
    drop(track, new Set(pictureRecords(track).filter((entry) => entry.id !== source.id).map((entry) => entry.id)));
    let shortened = 0;
    for (const cut of cuts) {
      const existing = pictureRecords(track).find((entry) => entry.fromElementId === cut.fromId && entry.toElementId === cut.toId);
      const limits = durationLimits(track, cut.fromId, cut.toId, fps, existing?.id);
      const fitted = clampDuration(source.duration / TICKS_PER_SECOND, limits, fps);
      if (fitted.seconds < TRANSITION_MIN_SECONDS) { if (existing) drop(track, new Set([existing.id])); continue; }
      if (fitted.duration < wanted) shortened++;
      if (existing) Object.assign(existing, { duration: fitted.duration });
      else applyOnCut(track, cut.fromId, cut.toId, fps, { type: source.type, seconds: fitted.seconds, params: source.params, easing: source.easing, audioCrossfade: source.audioCrossfade, shape: source.shape }, env.newId);
    }
    // Two transitions on one short clip share its length: a later copy may have to give way to an earlier one.
    const fit = fitTransitions(track, fps);
    shortened += fit.shortened.length;
    const applied = pictureRecords(track).length;
    return { info: { applied, shortened, message: TRANSITION_MESSAGES.applied(applied, shortened) } };
  },
});

/** Copies of the transitions whose two clips were both copied, on the track where the two copies landed side by side. */
export function copyTransitions(scene: Sc, records: readonly Json[], copies: ReadonlyMap<string, El>, newId: () => string): void {
  for (const record of records) {
    if (record.kind !== "transition") continue;
    const from = copies.get(String(record.fromElementId)), to = copies.get(String(record.toElementId));
    if (!from || !to) continue;
    const track = tracksOfScene(scene).find((candidate) => candidate.elements.includes(from) && candidate.elements.includes(to));
    if (!track || !isEligibleCut(track, from, to)) continue;
    const id = newId();
    track.transitions.push({ ...clone(record), id, fromElementId: from.id, toElementId: to.id });
    from.transitionOut = id;
    to.transitionIn = id;
  }
}

/** Whether the paired audio crossfade applies: off when either clip's source audio was extracted to a linked audio element. */
export function audioCrossfadeState(scene: Sc, record: Pick<PictureTransition, "fromElementId" | "toElementId" | "audioCrossfade">): { available: boolean; active: boolean; tooltip?: string } {
  const elements = tracksOfScene(scene).flatMap((track) => track.elements);
  const extracted = [record.fromElementId, record.toElementId].some((id) => {
    const element = elements.find((candidate) => candidate.id === id);
    return element !== undefined && (element.audioExtracted === true || (typeof element.linkId === "string" && elements.some((other) => other.id !== id && other.type === "audio" && other.linkId === element.linkId)));
  });
  return extracted ? { available: false, active: false, tooltip: TRANSITION_MESSAGES.extracted } : { available: true, active: record.audioCrossfade };
}

// ---- presets ---------------------------------------------------------------------------------------------------------
export type TransitionPreset = { name: string; type: string; params: Record<string, number | boolean | string>; easing: string; duration: number; audioCrossfade: boolean; shape: string };
export const TRANSITION_PRESET_LIMIT = 200;
/** A name made unique in a list by the suffix " (2)", " (3)" …; 1–60 characters. */
export function uniquePresetName(name: string, taken: readonly string[]): string {
  const base = name.trim().slice(0, 60);
  if (base.length === 0) throw new ParamRejected("name", "a preset name has 1 to 60 characters");
  if (!taken.includes(base)) return base;
  for (let index = 2; ; index++) {
    const suffix = ` (${index})`, candidate = `${base.slice(0, 60 - suffix.length)}${suffix}`;
    if (!taken.includes(candidate)) return candidate;
  }
}
/** "Save as preset": parameter values only. Refused beyond 200 with the stated message; the list is not changed. */
export function saveTransitionPreset(presets: readonly TransitionPreset[], name: string, record: PictureTransition): { ok: true; presets: TransitionPreset[]; preset: TransitionPreset } | { ok: false; message: string } {
  if (presets.length >= TRANSITION_PRESET_LIMIT) return { ok: false, message: TRANSITION_MESSAGES.presetLimit };
  const preset: TransitionPreset = { name: uniquePresetName(name, presets.map((entry) => entry.name)), type: record.type, params: { ...record.params }, easing: record.easing, duration: record.duration, audioCrossfade: record.audioCrossfade, shape: record.shape };
  return { ok: true, presets: [...presets, preset], preset };
}
export const renameTransitionPreset = (presets: readonly TransitionPreset[], from: string, to: string): TransitionPreset[] =>
  presets.map((entry) => (entry.name === from ? { ...entry, name: uniquePresetName(to, presets.filter((other) => other.name !== from).map((other) => other.name)) } : entry));
export const deleteTransitionPreset = (presets: readonly TransitionPreset[], name: string): TransitionPreset[] => presets.filter((entry) => entry.name !== name);
/** A preset whose type is not registered is listed disabled with "Unavailable transition". */
export const transitionPresetState = (preset: TransitionPreset): { available: boolean; label?: string } => (transitionDefinition(preset.type) ? { available: true } : { available: false, label: TRANSITION_MESSAGES.unavailable });
/** Applying a preset: its base tile on the cut, then its params, easing and duration (clamped), as one undo step. */
export const applyTransitionPreset = (options: { sceneId: string; fromId: string; toId: string; preset: TransitionPreset }): TimelineCommand<ApplyInfo> => ({
  type: "transition.apply-preset", label: "Apply preset", sceneId: options.sceneId,
  run(draft, env) {
    const { preset } = options;
    if (!transitionDefinition(preset.type)) refuse(TRANSITION_MESSAGES.unavailable, "unavailable");
    const scene = sceneById(draft, options.sceneId), track = cutTrack(scene, options.fromId, options.toId), fps = draft.settings.fps;
    const info = applyOnCut(track, options.fromId, options.toId, fps, { type: preset.type, seconds: preset.duration / TICKS_PER_SECOND, params: preset.params, easing: preset.easing, audioCrossfade: preset.audioCrossfade, shape: preset.shape }, env.newId);
    const record = pictureRecords(track).find((entry) => entry.id === info.transitionId)!;
    const fitted = clampDuration(preset.duration / TICKS_PER_SECOND, durationLimits(track, options.fromId, options.toId, fps, record.id), fps);
    Object.assign(record, { duration: fitted.duration, easing: preset.easing, audioCrossfade: preset.audioCrossfade, shape: preset.shape });
    return { info: { ...info, clamped: fitted.clamped, message: fitted.message } };
  },
});

/** What the inspector shows for a transition: its name, or "Unavailable transition" with Replace and Remove only. */
export function transitionInspectorState(record: PictureTransition): { name: string; available: boolean; actions: string[] } {
  const definition = transitionDefinition(record.type);
  return definition
    ? { name: definition.name, available: true, actions: ["Replace", "Apply to all", "Set as default", "Save as preset", "Remove"] }
    : { name: TRANSITION_MESSAGES.unavailable, available: false, actions: ["Replace", "Remove"] };
}
/** "Set as default": the type and duration the next `transition.add-default` uses. */
export const defaultsFrom = (record: Pick<PictureTransition, "type" | "duration">): TransitionDefaults => ({ type: record.type, duration: record.duration });
/** The drop zones of a dragged tile: every eligible cut within 24 px of the pointer, each 16 px wide. */
export function transitionDropZones(scene: Sc, pointerX: number, timeToX: (time: number) => number): { cut: Cut; x: number; width: number }[] {
  return eligibleCuts(scene).map((cut) => ({ cut, x: timeToX(cut.time) - 8, width: 16 })).filter((zone) => Math.abs(zone.x + 8 - pointerX) <= 24);
}
