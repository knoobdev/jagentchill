import { createElement, type ProjectDocument } from "@jagentchill/protocol";
import { isObject, type Json } from "../model.ts";
import { followDuration } from "../ops/shared.ts";
import { frameTicks, roundHalfAway, snapToFrame } from "../time.ts";
import type { CommandEnv, TimelineCommand } from "./command.ts";
import { copySet } from "./copies.ts";
import { removeElements, splitOne } from "./edit.ts";
import {
  canHold, endOf, fpsOf, hasSourceBounds, isFree, isFreeze, isHideable, overlaps, refuse, rejectDoc, sceneById, trackById, tracksOfScene, trackSupports, TRACK_FOR_ELEMENT, type El, type Sc, type Tr,
} from "./model.ts";
import { buildElement, placeElements, type LibraryItem, type PlacementRequest } from "./placement.ts";
import { speedCurveOf } from "./retime.ts";

/**
 * Commands whose parameters are explicit values rather than a gesture — a time range, a source range, a track
 * setting, a list of fields. They are what an agent tool calls, and equally what a numeric control of the editor
 * calls: each is one step of the single commit pipeline, and none of them clamps a value it is given.
 */

const trackOf = (draft: ProjectDocument, trackId: string): { scene: Sc; track: Tr } => {
  for (const scene of draft.scenes as unknown as Sc[]) { const track = trackById(scene, trackId); if (track) return { scene, track }; }
  return rejectDoc("document/unknown-reference", "", `track "${trackId}" does not exist`);
};
const elementOf = (draft: ProjectDocument, elementId: string): { scene: Sc; track: Tr; element: El } => {
  for (const scene of draft.scenes as unknown as Sc[]) for (const track of tracksOfScene(scene)) { const element = track.elements.find((entry) => entry.id === elementId); if (element) return { scene, track, element }; }
  return rejectDoc("document/unknown-reference", "", `element "${elementId}" does not exist`);
};
const locked = (track: Tr): never => refuse(`The track "${track.name}" is locked`, "track-locked", { trackId: track.id, trackName: track.name });

/** "Use proxies" of the project settings. */
export const setUseProxies = (options: { value: boolean }): TimelineCommand => ({
  type: "project.proxies", label: "Use proxies",
  run(draft) { draft.settings.useProxies = options.value; return { noRipple: true, noMagnet: true, noLinkage: true }; },
});

/** Sets or clears (`null`) the in and out points of a scene at explicit times; each is aligned to a frame. */
export const setSceneRange = (options: { sceneId: string; inPoint: number | null; outPoint: number | null }): TimelineCommand => ({
  type: "range.set", label: "Set range", sceneId: options.sceneId,
  run(draft) {
    const scene = sceneById(draft, options.sceneId), fps = fpsOf(draft);
    if (options.inPoint === null) delete scene.inPoint; else scene.inPoint = snapToFrame(options.inPoint, fps);
    if (options.outPoint === null) delete scene.outPoint; else scene.outPoint = snapToFrame(options.outPoint, fps);
    if (scene.inPoint !== undefined && scene.outPoint !== undefined && scene.outPoint <= scene.inPoint) rejectDoc("document/out-of-range", `/scenes/@${scene.id}/outPoint`, "inPoint lies before outPoint");
    return { noRipple: true, noMagnet: true, noLinkage: true };
  },
});

export type TrackState = { locked?: boolean; pinned?: boolean; hidden?: boolean; muted?: boolean; solo?: boolean; volume?: number; pan?: number };
/**
 * Writes explicit values of a track's state fields. A field the track type does not carry is refused (`unsupported-flag`),
 * and a volume or pan outside its range is rejected by the validator — nothing is clamped.
 */
export const setTrackState = (options: { trackId: string; state: TrackState; label?: string }): TimelineCommand => ({
  type: "timeline.track.state", label: options.label ?? "Track",
  run(draft) {
    const { track } = trackOf(draft, options.trackId);
    for (const [key, value] of Object.entries(options.state) as [keyof TrackState, boolean | number][]) {
      if (value === undefined) continue;
      if (!trackSupports(track, key)) refuse(`A ${track.type} track has no ${key}`, "unsupported-flag", { trackId: track.id, trackType: track.type, field: key });
      (track as Record<string, unknown>)[key] = value;
    }
    return { noRipple: true, noMagnet: true, noLinkage: true };
  },
});

export type ClipSpec = { assetId: string; name?: string; sourceIn?: number; sourceOut?: number; duration?: number; fields?: Record<string, unknown> };
/**
 * Adds media clips back to back from `time` by a placement strategy. `sourceIn` / `sourceOut` choose the part of the
 * source a video or audio clip shows (they lie inside the asset; nothing is clamped), `duration` its length on the
 * timeline (an image's length, or the length taken from `sourceIn`). `fields` are stored fields written on the new
 * element (transform, volume); the validator judges them.
 */
export const addClips = (options: { sceneId: string; clips: ClipSpec[]; time: number; request: PlacementRequest; label?: string }): TimelineCommand<{ elementIds: string[]; trackId: string; createdTrack: boolean }> => ({
  type: "timeline.add-clips", label: options.label ?? "Add to timeline", sceneId: options.sceneId,
  run(draft, env) {
    const scene = sceneById(draft, options.sceneId), fps = fpsOf(draft), frame = frameTicks(fps);
    let at = snapToFrame(Math.max(0, options.time), fps);
    const built: El[] = [];
    for (const clip of options.clips) {
      const element = buildElement(draft, { kind: "media", assetId: clip.assetId, ...(clip.name ? { name: clip.name } : {}) } as LibraryItem, at, env, undefined, { agent: true });
      if (hasSourceBounds(element)) {
        const source = element.sourceDuration as number, from = clip.sourceIn ?? 0, to = clip.sourceOut ?? (clip.duration !== undefined ? from + clip.duration : source);
        if (from < 0 || to > source || to - from < frame) rejectDoc("document/out-of-range", "", `the source range ${from}–${to} lies outside the asset (0–${source}) or is shorter than one frame`, { min: 0, max: source });
        // Whole frames, never past the chosen source part.
        let duration = Math.max(frame, snapToFrame(to - from, fps));
        while (duration > to - from && duration > frame) duration -= frame;
        element.trimStart = from; element.duration = duration; element.trimEnd = source - from - duration;
      } else if (clip.duration !== undefined) element.duration = Math.max(frame, snapToFrame(clip.duration, fps));
      Object.assign(element, clip.fields ?? {});
      followDuration(element);
      built.push(element);
      at = endOf(element);
    }
    if (built.length === 0) return refuse("Nothing to add", "disabled");
    if (new Set(built.map((element) => TRACK_FOR_ELEMENT[element.type])).size > 1) rejectDoc("document/element-track-mismatch", "", "video or image clips and audio clips cannot be added to one track in one call");
    const placed = placeElements(scene, built, options.request, env);
    return { selection: built.map((element) => element.id), info: { elementIds: built.map((element) => element.id), trackId: placed.track.id, createdTrack: placed.created } };
  },
});

/** Splits what crosses the boundaries of `[start, end)` on a track and removes what lies inside; returns the removed ids. */
function clearRange(draft: ProjectDocument, scene: Sc, track: Tr, start: number, end: number, env: Pick<CommandEnv, "newId">, keep: ReadonlySet<string> = new Set()): string[] {
  const inside: string[] = [];
  for (const element of [...track.elements]) {
    if (keep.has(element.id) || !overlaps(element.startTime, endOf(element), start, end)) continue;
    let piece = element;
    if (end < endOf(piece)) splitOne(track, piece, end, env.newId);
    if (start > piece.startTime) piece = splitOne(track, piece, start, env.newId);
    inside.push(piece.id);
  }
  removeElements(draft, scene, new Set(inside));
  return inside;
}

/**
 * Removes everything inside each time range, splitting elements at the boundaries. Ranges are processed from the latest
 * to the earliest so that earlier ranges stay valid. With `ripple` the gap of each range closes on every affected
 * track. Elements on locked tracks are never altered; `strictLocks` refuses instead when a locked track holds content
 * that the ripple would have to move.
 */
export const deleteRanges = (options: { sceneId: string; ranges: { start: number; end: number }[]; trackIds?: string[]; ripple?: boolean; strictLocks?: boolean; keepIds?: string[] }): TimelineCommand<{ removed: string[]; removedDuration: number }> => ({
  type: options.ripple ? "timeline.range.ripple-delete" : "timeline.range.delete", label: options.ripple ? "Ripple delete range" : "Delete range", sceneId: options.sceneId,
  run(draft, env) {
    const scene = sceneById(draft, options.sceneId), fps = fpsOf(draft), keep = new Set(options.keepIds ?? []);
    const merged: { start: number; end: number }[] = [];
    for (const range of options.ranges.map((entry) => ({ start: snapToFrame(entry.start, fps), end: snapToFrame(entry.end, fps) })).filter((entry) => entry.end > entry.start).sort((a, b) => a.start - b.start)) {
      const last = merged[merged.length - 1];
      if (last && range.start <= last.end) last.end = Math.max(last.end, range.end); else merged.push(range);
    }
    const wanted = options.trackIds ? new Set(options.trackIds) : null;
    for (const trackId of options.trackIds ?? []) if (!trackById(scene, trackId)) rejectDoc("document/unknown-reference", "", `track "${trackId}" does not exist`);
    const tracks = tracksOfScene(scene).filter((track) => !wanted || wanted.has(track.id));
    const removed: string[] = [];
    for (const range of [...merged].reverse()) {
      for (const track of tracks) {
        if (track.locked) {
          if ((options.strictLocks || wanted) && track.elements.some((element) => (options.ripple ? endOf(element) > range.start : overlaps(element.startTime, endOf(element), range.start, range.end)))) locked(track);
          continue;
        }
        removed.push(...clearRange(draft, scene, track, range.start, range.end, env, keep));
        if (options.ripple) for (const element of track.elements) if (element.startTime >= range.end) element.startTime -= range.end - range.start;
      }
    }
    return { selection: [], info: { removed, removedDuration: merged.reduce((sum, range) => sum + range.end - range.start, 0) }, noRipple: true, noMagnet: true, noLinkage: options.ripple === true };
  },
});

/** The gaps of a track inside a range that are at least `minGap` long, in time order; the stretch before the first element counts. */
export function trackGaps(track: Tr, range?: { start: number; end: number }, minGap = 1): { start: number; duration: number }[] {
  const gaps: { start: number; duration: number }[] = [];
  let at = 0;
  for (const element of [...track.elements].sort((a, b) => a.startTime - b.startTime)) {
    const from = Math.max(at, range?.start ?? 0), to = Math.min(element.startTime, range?.end ?? Infinity);
    if (to - from >= minGap && to > from) gaps.push({ start: from, duration: to - from });
    at = Math.max(at, endOf(element));
  }
  return gaps;
}
/** Closes the gaps of one track (inside a range, at least `minGap` long): every element after a gap moves left by its length. */
export const closeTrackGaps = (options: { sceneId: string; trackId: string; range?: { start: number; end: number }; minGap?: number }): TimelineCommand<{ closed: number; closedDuration: number }> => ({
  type: "timeline.close-track-gaps", label: "Close gaps", sceneId: options.sceneId,
  run(draft) {
    const scene = sceneById(draft, options.sceneId), track = trackById(scene, options.trackId) ?? rejectDoc("document/unknown-reference", "", `track "${options.trackId}" does not exist`);
    if (track.locked) locked(track);
    const gaps = trackGaps(track, options.range, options.minGap);
    for (const gap of [...gaps].reverse()) for (const element of track.elements) if (element.startTime >= gap.start + gap.duration) element.startTime -= gap.duration;
    return { info: { closed: gaps.length, closedDuration: gaps.reduce((sum, gap) => sum + gap.duration, 0) }, noRipple: true, noMagnet: true };
  },
});

/**
 * Sets both source bounds of a video or audio element at once and keeps its timeline start. The new length follows
 * the element's constant rate. Where gaps are closed on its track (ripple, or the main-track magnet) the followers
 * move with its end; otherwise a result that would run into the next element is rejected.
 */
export const setSourceRange = (options: { sceneId: string; elementId: string; sourceIn: number; sourceOut: number }): TimelineCommand<{ duration: number }> => ({
  type: "timeline.source-range", label: "Set source range", sceneId: options.sceneId,
  run(draft, env) {
    const { scene, track, element } = elementOf(draft, options.elementId), fps = fpsOf(draft), frame = frameTicks(fps);
    if (track.locked) locked(track);
    if (!hasSourceBounds(element)) refuse("This element has no source range", "no-source");
    if (speedCurveOf(element)) refuse("Remove the speed curve before setting the source range", "curved");
    const source = element.sourceDuration as number, rate = Math.max(1e-6, Number((element.retime as { rate?: number } | undefined)?.rate ?? 1));
    if (options.sourceIn < 0 || options.sourceOut > source || options.sourceOut <= options.sourceIn) rejectDoc("document/out-of-range", "", `the source range lies inside 0–${source} with sourceIn before sourceOut`, { min: 0, max: source });
    const span = options.sourceOut - options.sourceIn;
    let duration = Math.max(frame, snapToFrame(roundHalfAway(span / rate), fps));
    while (roundHalfAway(duration * rate) > span && duration > frame) duration -= frame;
    const oldEnd = endOf(element), growth = duration - element.duration;
    const flowing = env.edit.ripple || (track === scene.tracks.main && env.edit.magnet && !env.edit.freeLayer);
    if (growth > 0 && !flowing && !isFree(track, oldEnd, oldEnd + growth, new Set([element.id]))) rejectDoc("document/elements-overlap", "", "the longer clip would overlap the next element; turn on ripple or move the next element");
    element.trimStart = options.sourceIn; element.duration = duration;
    element.trimEnd = Math.max(0, source - options.sourceIn - roundHalfAway(duration * rate));
    if (flowing && growth > 0) for (const other of track.elements) if (other !== element && other.startTime >= oldEnd) other.startTime += growth;
    for (const name of ["fadeIn", "fadeOut"]) { const fade = element[name] as Json | undefined; if (isObject(fade) && typeof fade.duration === "number") fade.duration = Math.min(fade.duration, duration); }
    followDuration(element);
    return { info: { duration } };
  },
});

/**
 * Moves elements between overlay tracks in the stacking order: one track up or down, or to the top or the bottom of
 * the overlay zone. An element whose target track cannot hold it or is occupied gets a new track at that position.
 * `info.moved` is empty when every element already is where the action puts it.
 */
export const restackElements = (options: { sceneId: string; elementIds: string[]; action: "bring_forward" | "send_backward" | "to_front" | "to_back" }): TimelineCommand<{ moved: string[]; createdTrackIds: string[] }> => ({
  type: `timeline.restack.${options.action}`, label: { bring_forward: "Bring forward", send_backward: "Send backward", to_front: "Bring to front", to_back: "Send to back" }[options.action], sceneId: options.sceneId,
  run(draft, env) {
    const scene = sceneById(draft, options.sceneId), moved: string[] = [], created: string[] = [];
    for (const elementId of options.elementIds) {
      const from = scene.tracks.overlay.find((track) => track.elements.some((element) => element.id === elementId));
      if (!from) { if (!tracksOfScene(scene).some((track) => track.elements.some((element) => element.id === elementId))) rejectDoc("document/unknown-reference", "", `element "${elementId}" does not exist`); refuse("Only elements on overlay tracks have a stacking order", "not-overlay"); }
      if (from!.locked) locked(from!);
      const element = from!.elements.find((entry) => entry.id === elementId)!, overlay = scene.tracks.overlay, index = overlay.indexOf(from!);
      const target = options.action === "bring_forward" ? index - 1 : options.action === "send_backward" ? index + 1 : options.action === "to_front" ? 0 : overlay.length - 1;
      if (target < 0 || target >= overlay.length || target === index) continue;
      from!.elements = from!.elements.filter((entry) => entry !== element);
      from!.transitions = from!.transitions.filter((record) => record.fromElementId !== element.id && record.toElementId !== element.id);
      if ("transitionIn" in element) { element.transitionIn = null; element.transitionOut = null; }
      const candidate = overlay[target];
      if (canHold(candidate, element.type) && !candidate.locked && isFree(candidate, element.startTime, endOf(element))) candidate.elements.push(element);
      else {
        const placed = placeElements(scene, [element], { strategy: "alwaysNew", index: options.action === "send_backward" || options.action === "to_back" ? target + 1 : target }, env);
        created.push(placed.track.id);
      }
      moved.push(element.id);
    }
    return { selection: moved, info: { moved, createdTrackIds: created }, noRipple: true, noMagnet: true, noLinkage: true };
  },
});

/** Makes room on a track for an insert: every element from `time` onward moves right by `duration`. A point inside an element is refused. */
export const makeRoom = (options: { sceneId: string; trackId: string; time: number; duration: number }): TimelineCommand => ({
  type: "timeline.make-room", label: "Insert", sceneId: options.sceneId,
  run(draft) {
    const scene = sceneById(draft, options.sceneId), track = trackById(scene, options.trackId) ?? rejectDoc("document/unknown-reference", "", `track "${options.trackId}" does not exist`), fps = fpsOf(draft);
    if (track.locked) locked(track);
    const time = snapToFrame(options.time, fps), room = snapToFrame(options.duration, fps);
    if (track.elements.some((element) => element.startTime < time && endOf(element) > time)) rejectDoc("document/elements-overlap", "", "the insert point lies inside an element; insert at one of its edges or split it first");
    for (const element of track.elements) if (element.startTime >= time) element.startTime += room;
    return { noRipple: true, noMagnet: true };
  },
});

/**
 * Duplicates elements `offset` ticks later (default: right after the latest of them), on their own tracks or on
 * `toTrackId`. Grouping and linking among the copies are kept under new ids. A copy that would overlap is rejected:
 * nothing is moved out of the way.
 */
export const duplicateElements = (options: { sceneId: string; elementIds: string[]; offset?: number; toTrackId?: string }): TimelineCommand<{ elementIds: string[]; copies: Record<string, string> }> => ({
  type: "timeline.duplicate", label: "Duplicate", sceneId: options.sceneId,
  run(draft, env) {
    const scene = sceneById(draft, options.sceneId), fps = fpsOf(draft), wanted = new Set(options.elementIds);
    const picked = tracksOfScene(scene).flatMap((track) => track.elements.filter((element) => wanted.has(element.id)).map((element) => ({ track, element })));
    for (const elementId of options.elementIds) if (!picked.some((hit) => hit.element.id === elementId)) rejectDoc("document/unknown-reference", "", `element "${elementId}" does not exist`);
    const start = Math.min(...picked.map((hit) => hit.element.startTime)), finish = Math.max(...picked.map((hit) => endOf(hit.element)));
    const offset = snapToFrame(options.offset ?? finish - start, fps);
    const copies = copySet(picked.map((hit) => hit.element), env.newId);
    const target = options.toTrackId ? trackById(scene, options.toTrackId) ?? rejectDoc("document/unknown-reference", "", `track "${options.toTrackId}" does not exist`) : undefined;
    for (const hit of picked) {
      const copy = copies.get(hit.element.id)!, track = target ?? hit.track;
      copy.startTime = hit.element.startTime + offset;
      // The exact place asked for, on every track: a duplicate never reorders the main track.
      placeElements(scene, [copy], { strategy: "explicit", trackId: track.id }, { ...env, edit: { ...env.edit, magnet: false } });
    }
    const ids = picked.map((hit) => copies.get(hit.element.id)!.id);
    return { selection: ids, info: { elementIds: ids, copies: Object.fromEntries(picked.map((hit) => [hit.element.id, copies.get(hit.element.id)!.id])) }, noMagnet: true };
  },
});

/** Shows or hides elements at an explicit value (the element field `hidden`); an element that cannot be hidden is refused. */
export const setElementsHidden = (options: { sceneId: string; elementIds: string[]; hidden: boolean }): TimelineCommand<{ applied: string[] }> => ({
  type: "timeline.set-hidden", label: options.hidden ? "Hide" : "Show", sceneId: options.sceneId,
  run(draft) {
    const scene = sceneById(draft, options.sceneId), wanted = new Set(options.elementIds), applied: string[] = [];
    for (const track of tracksOfScene(scene)) for (const element of track.elements) {
      if (!wanted.has(element.id)) continue;
      if (track.locked) locked(track);
      if (!isHideable(element)) refuse(`A ${element.type} element cannot be hidden`, "not-hideable", { elementId: element.id });
      element.hidden = options.hidden;
      applied.push(element.id);
    }
    return { info: { applied }, noRipple: true, noMagnet: true, noLinkage: true };
  },
});

/** The fields a freeze element copies from its clip, as the static values the clip has. Keyframes are not copied. */
const FREEZE_COPIED = ["transform", "crop", "flip", "opacity", "blendMode", "effects", "masks", "adjustments", "chromaKey", "cutout", "background"] as const;
/**
 * "Freeze frame" at an explicit time: the clip is split there and a freeze element holding the source frame under
 * that time goes between the two parts; the second part and everything after it on the track moves right by the
 * freeze duration, on every track type and whatever the ripple setting is. One undo step.
 */
export const insertFreezeFrame = (options: { sceneId: string; elementId: string; time: number; duration?: number }): TimelineCommand<{ elementId: string; rightId: string }> => ({
  type: "timeline.freeze", label: "Freeze frame", sceneId: options.sceneId,
  run(draft, env) {
    const scene = sceneById(draft, options.sceneId), fps = fpsOf(draft), frame = frameTicks(fps);
    const track = tracksOfScene(scene).find((entry) => entry.elements.some((element) => element.id === options.elementId)) ?? rejectDoc("document/unknown-reference", "", `element "${options.elementId}" does not exist`);
    const source = track.elements.find((element) => element.id === options.elementId)!;
    const time = snapToFrame(options.time, fps), duration = Math.max(frame, snapToFrame(options.duration ?? 360_000, fps));
    if ((source.type !== "video" && source.type !== "compound") || isFreeze(source)) refuse("A freeze frame is made from a video or compound clip", "freeze-target");
    if (!(source.startTime < time && time < endOf(source))) refuse("The freeze time lies strictly inside the clip", "freeze-time", { min: source.startTime + frame, max: endOf(source) - frame });
    if (track.locked) locked(track);
    const rate = Number((source.retime as { rate?: number } | undefined)?.rate ?? 1), sourceTime = Math.round(source.trimStart + (time - source.startTime) * rate);
    const copied = Object.fromEntries(FREEZE_COPIED.filter((field) => source[field] !== undefined).map((field) => [field, JSON.parse(JSON.stringify(source[field]))]));
    const right = splitOne(track, source, time, env.newId);
    for (const element of track.elements) if (element.startTime >= time) element.startTime += duration;
    const base = { id: env.newId(), name: `${source.name} (freeze)`.slice(0, 200), startTime: time, duration, ...copied };
    const frozen = (source.type === "compound"
      ? createElement("compound", { ...base, sceneId: source.sceneId, freeze: { sourceTime } } as never)
      : createElement("video", { ...base, mediaId: source.mediaId, freeze: { mediaId: source.mediaId, sourceTime }, isSourceAudioEnabled: false } as never)) as unknown as El;
    track.elements.push(frozen);
    track.elements.sort((a, b) => a.startTime - b.startTime);
    // The command placed everything itself: the closing passes must not pull the shifted clips back.
    return { selection: [frozen.id], info: { elementId: frozen.id, rightId: right.id }, noRipple: true, noMagnet: true };
  },
});

type MarkerFields = { note?: string | null; color?: number | string; duration?: number | null };
const markerList = (scene: Sc): Json[] => scene.markers as Json[];
function writeMarker(marker: Json, fields: MarkerFields, fps: Parameters<typeof snapToFrame>[1]): void {
  if (fields.note !== undefined) { if (fields.note === null || fields.note === "") delete marker.note; else marker.note = fields.note; }
  if (fields.color !== undefined) marker.color = typeof fields.color === "string" ? fields.color.toLowerCase() : fields.color;
  if (fields.duration !== undefined) { if (fields.duration === null || fields.duration === 0) delete marker.duration; else marker.duration = snapToFrame(fields.duration, fps); }
}
/** Adds a marker at an explicit time with its note, colour and duration. Two markers never share a frame; a scene holds at most 1 000. */
export const addMarkerAt = (options: { sceneId: string; time: number } & MarkerFields): TimelineCommand<{ markerId: string; time: number }> => ({
  type: "marker.add", label: "Add marker", sceneId: options.sceneId,
  run(draft, env) {
    const scene = sceneById(draft, options.sceneId), fps = fpsOf(draft), time = snapToFrame(Math.max(0, options.time), fps), markers = markerList(scene);
    if (markers.length >= 1000) rejectDoc("document/limit-exceeded", `/scenes/@${scene.id}/markers`, "Marker limit reached (1000)", { limit: "markersPerScene", value: 1000 });
    if (markers.some((marker) => marker.time === time)) refuse("A marker already exists at this time", "marker-exists", { time });
    const marker: Json = { id: env.newId(), time, color: 1 };
    writeMarker(marker, options, fps);
    markers.push(marker); markers.sort((a, b) => Number(a.time) - Number(b.time));
    return { info: { markerId: String(marker.id), time }, noRipple: true, noMagnet: true, noLinkage: true };
  },
});
/** Changes a marker addressed by its id: its time (frame-aligned; a frame that holds another marker is refused), note, colour and duration. */
export const updateMarker = (options: { sceneId: string; markerId: string; time?: number } & MarkerFields): TimelineCommand<{ time: number }> => ({
  type: "marker.update", label: "Edit marker", sceneId: options.sceneId,
  run(draft) {
    const scene = sceneById(draft, options.sceneId), fps = fpsOf(draft), markers = markerList(scene);
    const marker = markers.find((entry) => entry.id === options.markerId) ?? rejectDoc("document/unknown-reference", "", `marker "${options.markerId}" does not exist`);
    if (options.time !== undefined) {
      const time = snapToFrame(Math.max(0, options.time), fps);
      if (markers.some((other) => other !== marker && other.time === time)) refuse("A marker already exists at this time", "marker-exists", { time });
      marker.time = time;
    }
    writeMarker(marker, options, fps);
    markers.sort((a, b) => Number(a.time) - Number(b.time));
    return { info: { time: Number(marker.time) }, noRipple: true, noMagnet: true, noLinkage: true };
  },
});
