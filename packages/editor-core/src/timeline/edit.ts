import { MAX_ELEMENT_DURATION, type ProjectDocument, type Rational } from "@jagentchill/protocol";
import { isObject, type Json } from "../model.ts";
import { copyElement, followDuration, isUnknownElement } from "../ops/shared.ts";
import { frameTicks, roundHalfAway, snapToFrame } from "../time.ts";
import { rippleTrack, type CommandEnv, type TimelineCommand } from "./command.ts";
import { shiftAnimations, windowAnimations } from "./keyframes.ts";
import {
  canHold, createTrackAt, endOf, fpsOf, hasSourceBounds, isFree, refuse, rejectDoc, sceneById, settleTrack, trackById, tracksOfScene, TRACK_FOR_ELEMENT, withPartners, zoneOfTrack,
  type El, type Sc, type Tr,
} from "./model.ts";
import { insertIntoMain, nearestOverlayVideo, placeElements } from "./placement.ts";
import { edgeRate, recutSource, sourceOffsetAt, sourceSpanOf, speedCurveOf } from "./retime.ts";

type Hit = { track: Tr; element: El };
const hitsOf = (scene: Sc, ids: Iterable<string>): Hit[] => {
  const wanted = new Set(ids);
  return tracksOfScene(scene).flatMap((track) => track.elements.filter((element) => wanted.has(element.id)).map((element) => ({ track, element })));
};
/**
 * The elements an edit applies to: the given ones with their link partners (and group members, for the actions a
 * group shares). A locked track rejects every mutation: a linked partner there blocks the edit as a whole
 * (`strict`: so does any member), other members on locked tracks are skipped.
 */
function targetsOf(scene: Sc, ids: string[], options: { groups: boolean; strict?: boolean }): Hit[] {
  const direct = new Set(ids), hits = hitsOf(scene, withPartners(scene, ids, { groups: options.groups, links: true }));
  const linked = new Set(hitsOf(scene, ids).map((hit) => hit.element.linkId).filter((id): id is string => id !== null));
  for (const hit of hits) if (hit.track.locked && (options.strict || (hit.element.linkId !== null && linked.has(hit.element.linkId) && !direct.has(hit.element.id)))) refuse("A linked or grouped clip is on a locked track", "track-locked");
  return hits.filter((hit) => !hit.track.locked);
}
/** The constant rate of an element; a curved one is read through the time map (`retime.ts`), never by an average. */
const rateOf = (element: El): number => {
  const retime = element.retime as { rate?: number } | undefined;
  if (!hasSourceBounds(element)) return 1;
  return typeof retime?.rate === "number" && retime.rate > 0 ? retime.rate : 1;
};
const reversed = (element: El): boolean => (element.retime as { reverse?: boolean } | undefined)?.reverse === true;

// — Delete —
/** Removes elements with the transitions, tracking bindings and template bindings that named them. */
export function removeElements(draft: ProjectDocument, scene: Sc, ids: ReadonlySet<string>): void {
  for (const track of tracksOfScene(scene)) {
    track.elements = track.elements.filter((element) => !ids.has(element.id));
    track.transitions = track.transitions.filter((record) => !ids.has(String(record.fromElementId)) && !ids.has(String(record.toElementId)));
    for (const element of track.elements) if (isObject(element.tracking) && ids.has(String(element.tracking.targetElementId))) delete element.tracking;
  }
  const template = draft.template as unknown as Json | undefined;
  if (template && Array.isArray(template.colorBindings)) template.colorBindings = (template.colorBindings as Json[]).filter((entry) => !ids.has(String(entry.elementId)));
}

/**
 * "Delete" (elements) and "Ripple delete". Whether followers close the gap of a plain delete is decided by the edit
 * context — the magnet on the main track, ripple on every track; ripple delete always closes it on each affected track.
 * Deleting a compound element leaves its source scene.
 */
export const deleteElements = (options: { sceneId: string; elementIds: string[]; ripple?: boolean; label?: string }): TimelineCommand<{ removed: string[] }> => ({
  type: options.ripple ? "timeline.ripple-delete" : "timeline.delete", label: options.label ?? (options.ripple ? "Ripple delete" : "Delete"), sceneId: options.sceneId,
  run(draft, env) {
    const scene = sceneById(draft, options.sceneId), before = sceneById(env.before, options.sceneId);
    const gone = new Set(targetsOf(scene, options.elementIds, { groups: false }).map((hit) => hit.element.id));
    removeElements(draft, scene, gone);
    if (!options.ripple) return { selection: [], info: { removed: [...gone] } };
    const idsAfter = new Set(tracksOfScene(scene).flatMap((track) => track.elements.map((element) => element.id)));
    for (const track of tracksOfScene(scene)) { const prior = trackById(before, track.id); if (prior && !track.locked) rippleTrack(prior, track, idsAfter); }
    return { selection: [], info: { removed: [...gone] }, noRipple: true, noMagnet: true };
  },
});

// — Split —
const SUFFIX = / \((?:left|right)\)$/;
const halfName = (name: string, side: "left" | "right") => `${name.replace(SUFFIX, "")} (${side})`.slice(0, 200);
/** Splits one element at a scene time; the left half keeps its id, the right half is a copy with new ids. */
export function splitOne(track: Tr, left: El, time: number, newId: () => string): El {
  const offset = time - left.startTime, duration = left.duration;
  const { element: copy } = copyElement(left as never, newId);
  const right = copy as unknown as El;
  right.startTime = time; right.duration = duration - offset; left.duration = offset;
  if (hasSourceBounds(left)) {
    // The source split point is read once, through the time map, and the two halves share it exactly.
    const visible = sourceSpanOf({ ...left, duration } as El), flat = Math.min(visible, Math.max(0, roundHalfAway(offset * rateOf(left))));
    const cut = speedCurveOf(left) ? Math.min(visible, Math.max(0, sourceOffsetAt({ ...left, duration } as El, offset))) : reversed(left) ? visible - flat : flat;
    // A reversed clip plays the end of its source first: its left half shows the later part.
    if (reversed(left)) { recutSource(right, 0, cut); recutSource(left, cut, visible); }
    else { recutSource(right, cut, visible); recutSource(left, 0, cut); }
  }
  windowAnimations(left, 0, offset, newId);
  windowAnimations(right, offset, duration, newId);
  // Transitions and fades stay on the outer edges; the cut between the halves has none.
  if ("transitionOut" in left) {
    const record = track.transitions.find((entry) => entry.id === left.transitionOut);
    if (record) record.fromElementId = right.id;
    right.transitionOut = left.transitionOut; right.transitionIn = null; left.transitionOut = null;
  }
  if (isObject(left.fadeOut) && isObject(right.fadeIn)) { left.fadeOut = { ...left.fadeOut, duration: 0 }; right.fadeIn = { ...right.fadeIn, duration: 0 }; }
  left.name = halfName(left.name, "left"); right.name = halfName(right.name, "right");
  right.linkId = null;
  followDuration(left); followDuration(right);
  track.elements.push(right);
  return right;
}

export type SplitMode = "split" | "delete-left" | "delete-right" | "split-all";
/** Which elements a split action divides: the selection, or with none (and for "Split all") every element strictly under the time on unlocked tracks. */
export function splitTargets(scene: Sc, time: number, elementIds: string[], mode: SplitMode): Hit[] {
  const under = (element: El) => element.startTime < time && time < endOf(element) && !isUnknownElement(element);
  if (mode === "split-all" || elementIds.length === 0) return tracksOfScene(scene).filter((track) => !track.locked).flatMap((track) => track.elements.filter(under).map((element) => ({ track, element })));
  return targetsOf(scene, elementIds, { groups: false }).filter((hit) => under(hit.element));
}
/**
 * "Split", "Delete left", "Delete right" and "Split all" at a time (the playhead, or the blade's click time). An
 * element whose edges are at or outside the time is left alone; with nothing to split nothing changes.
 */
export const split = (options: { sceneId: string; time: number; elementIds?: string[]; mode?: SplitMode }): TimelineCommand<{ rightIds: string[]; playhead?: number }> => {
  const mode = options.mode ?? "split";
  return {
    type: `timeline.${mode}`, label: { split: "Split", "delete-left": "Delete left", "delete-right": "Delete right", "split-all": "Split all" }[mode], sceneId: options.sceneId,
    run(draft, env) {
      const scene = sceneById(draft, options.sceneId), time = snapToFrame(options.time, fpsOf(draft));
      const hits = splitTargets(scene, time, options.elementIds ?? [], mode);
      const pairs = hits.map((hit) => ({ ...hit, link: hit.element.linkId, right: splitOne(hit.track, hit.element, time, env.newId) }));
      // The right halves of a linked pair share a new link; a half whose partner was not cut has none.
      const byLink = new Map<string, El[]>();
      for (const pair of pairs) if (pair.link) byLink.set(pair.link, [...(byLink.get(pair.link) ?? []), pair.right]);
      for (const rights of byLink.values()) if (rights.length === 2) { const linkId = env.newId(); for (const right of rights) right.linkId = linkId; }
      if (mode === "split" || mode === "split-all") return { selection: pairs.map((pair) => pair.right.id), info: { rightIds: pairs.map((pair) => pair.right.id) } };
      const closes = (track: Tr) => env.edit.ripple || (track === scene.tracks.main && env.edit.magnet && !env.edit.freeLayer);
      const starts = pairs.filter((pair) => closes(pair.track)).map((pair) => pair.element.startTime);
      removeElements(draft, scene, new Set(pairs.map((pair) => (mode === "delete-left" ? pair.element.id : pair.right.id))));
      const kept = pairs.map((pair) => (mode === "delete-left" ? pair.right.id : pair.element.id));
      // Delete left with ripple or magnet: the playhead follows the first remaining element to its new start.
      return { selection: kept, info: { rightIds: pairs.map((pair) => pair.right.id), ...(mode === "delete-left" && starts.length > 0 ? { playhead: Math.min(...starts) } : {}) } };
    },
  };
};

// — Trim —
export type TrimSide = "start" | "end";
const closesGaps = (scene: Sc, track: Tr, env: Pick<CommandEnv, "edit">): boolean => env.edit.ripple || (track === scene.tracks.main && env.edit.magnet && !env.edit.freeLayer);
/** The range of deltas (ticks, positive to the right) one element accepts on one handle. */
export function trimBounds(scene: Sc, hit: Hit, side: TrimSide, env: Pick<CommandEnv, "edit">, fps: Rational, moving: ReadonlySet<string> = new Set()): { min: number; max: number } {
  const { track, element } = hit, frame = frameTicks(fps), rate = rateOf(element), flowing = closesGaps(scene, track, env);
  const others = track.elements.filter((other) => other.id !== element.id && !moving.has(other.id));
  const sourceField = (side === "end") !== reversed(element) ? "trimEnd" : "trimStart";
  const room = hasSourceBounds(element) ? Math.floor((element[sourceField] as number) / (speedCurveOf(element) ? edgeRate(element, sourceField === "trimEnd" ? "sourceEnd" : "sourceStart") : rate)) : MAX_ELEMENT_DURATION - element.duration;
  if (side === "end") {
    const next = Math.min(Infinity, ...others.filter((other) => other.startTime >= endOf(element)).map((other) => other.startTime));
    return { min: frame - element.duration, max: Math.min(room, flowing ? Infinity : next - endOf(element)) };
  }
  const previous = Math.max(0, ...others.filter((other) => endOf(other) <= element.startTime).map(endOf));
  // With ripple (or the magnet on the main track) the start stays put: neither time 0 nor the left neighbour bounds the handle.
  return { min: Math.max(-room, flowing ? -Infinity : previous - element.startTime), max: element.duration - frame };
}
/** Applies a trim delta to one element (bounds already respected) and returns how much the element grew. */
function trimOne(scene: Sc, hit: Hit, side: TrimSide, delta: number, env: CommandEnv): number {
  const { track, element } = hit;
  if (delta === 0) return 0;
  if (isUnknownElement(element)) rejectDoc("document/wrong-type", "", "Needs newer app: this content is kept unchanged and is not edited by this version");
  const flowing = closesGaps(scene, track, env), curved = hasSourceBounds(element) && speedCurveOf(element) !== null;
  const source = hasSourceBounds(element) && !curved ? roundHalfAway(Math.abs(delta) * rateOf(element)) * Math.sign(delta) : 0;
  const sourceField = (side === "end") !== reversed(element) ? "trimEnd" : "trimStart";
  const oldEnd = endOf(element), growth = side === "end" ? delta : -delta;
  // A curved clip keeps its speed at every remaining source position: the new source span is read through the time map.
  let recut: [number, number] | null = null;
  if (curved) {
    const span = sourceSpanOf(element);
    if (growth > 0) { const extra = Math.min(element[sourceField] as number, roundHalfAway(growth * edgeRate(element, sourceField === "trimEnd" ? "sourceEnd" : "sourceStart"))); recut = sourceField === "trimEnd" ? [0, span + extra] : [-extra, span]; }
    else { const cut = sourceOffsetAt(element, side === "end" ? element.duration + delta : delta); recut = sourceField === "trimEnd" ? [0, cut] : [cut, span]; }
  }
  if (side === "end") {
    element.duration += delta;
    if (source !== 0) element[sourceField] = Math.max(0, (element[sourceField] as number) - source);
    if (delta < 0) windowAnimations(element, 0, element.duration, env.newId);
  } else {
    if (!flowing) element.startTime += delta;
    element.duration -= delta;
    if (source !== 0) element[sourceField] = Math.max(0, (element[sourceField] as number) + source);
    // Keys keep their position relative to the source content.
    if (delta > 0) windowAnimations(element, delta, delta + element.duration, env.newId); else shiftAnimations(element, -delta);
  }
  if (recut) recutSource(element, recut[0], recut[1]);
  // A growing clip pushes its followers right when gaps are closed on its track; a shrinking one is closed by the pipeline.
  if (flowing && growth > 0) for (const other of track.elements) if (other !== element && other.startTime >= oldEnd) other.startTime += growth;
  followDuration(element);
  return growth;
}

/**
 * Trims by a handle drag: the same delta for the dragged element and every explicitly selected element — not for
 * elements that are selected only because they share the dragged element's group — and always for link partners.
 * The delta is snapped to a frame once and then clamped by the tightest bound among the trimmed elements.
 */
export const trim = (options: { sceneId: string; elementId: string; side: TrimSide; delta: number; selectedIds?: string[]; label?: string }): TimelineCommand<{ delta: number; elementIds: string[] }> => ({
  type: "timeline.trim", label: options.label ?? "Trim", sceneId: options.sceneId,
  run(draft, env) {
    const scene = sceneById(draft, options.sceneId), fps = fpsOf(draft);
    const dragged = hitsOf(scene, [options.elementId])[0] ?? rejectDoc("document/unknown-reference", "", `element "${options.elementId}" does not exist`);
    const selected = options.selectedIds?.includes(options.elementId) ? options.selectedIds : [];
    const ids = [options.elementId, ...hitsOf(scene, selected).filter((hit) => hit.element.id !== options.elementId && (dragged.element.groupId === null || hit.element.groupId !== dragged.element.groupId)).map((hit) => hit.element.id)];
    if (dragged.track.locked) refuse("The track is locked", "track-locked");
    const hits = targetsOf(scene, ids, { groups: false });
    let delta = snapToFrame(Math.abs(options.delta), fps) * Math.sign(options.delta);
    for (const hit of hits) { const bounds = trimBounds(scene, hit, options.side, env, fps); delta = Math.min(bounds.max, Math.max(bounds.min, delta)); }
    for (const hit of hits) trimOne(scene, hit, options.side, delta, env);
    return { info: { delta, elementIds: hits.map((hit) => hit.element.id) } };
  },
});
/** `timeline.trim-start-to-playhead` / `timeline.trim-end-to-playhead`: each selected element under the playhead is trimmed to it, within its bounds, without snapping. */
export const trimToPlayhead = (options: { sceneId: string; elementIds: string[]; side: TrimSide; playhead: number }): TimelineCommand => ({
  type: `timeline.trim-${options.side}-to-playhead`, label: options.side === "start" ? "Trim start to playhead" : "Trim end to playhead", sceneId: options.sceneId,
  run(draft, env) {
    const scene = sceneById(draft, options.sceneId), fps = fpsOf(draft), time = snapToFrame(options.playhead, fps);
    for (const hit of targetsOf(scene, options.elementIds, { groups: false })) {
      if (time <= hit.element.startTime || time >= endOf(hit.element)) continue;
      const bounds = trimBounds(scene, hit, options.side, env, fps), wanted = time - (options.side === "start" ? hit.element.startTime : endOf(hit.element));
      trimOne(scene, hit, options.side, Math.min(bounds.max, Math.max(bounds.min, wanted)), env);
    }
  },
});

// — Move —
export type MoveTarget =
  /** Every member stays on its own track (a horizontal drag, a nudge). */
  | { kind: "same" }
  /** The anchor goes to this track; the other members keep their vertical distance from it. */
  | { kind: "track"; trackId: string }
  /** One new track per member, as a contiguous block at this index of the zone. */
  | { kind: "new-tracks"; index: number };
export type MoveOptions = { sceneId: string; elementIds: string[]; anchorId?: string; time: number; target?: MoveTarget; pointerTime?: number; label?: string; coalesce?: string; type?: string };

/** Reorders main-track clips under the magnet: the moved clips leave, their gaps close, and they re-enter at the cut the pointer chose. */
function reorderMain(scene: Sc, moving: El[], pointer: number): void {
  const main = scene.tracks.main, ids = new Set(moving.map((clip) => clip.id));
  const staying = main.elements.filter((clip) => !ids.has(clip.id));
  const index = staying.filter((clip) => clip.startTime + clip.duration / 2 < pointer).length;
  for (const clip of [...moving].sort((a, b) => b.startTime - a.startTime)) for (const other of staying) if (other.startTime >= endOf(clip)) other.startTime -= clip.duration;
  main.elements = staying;
  const at = index < staying.length ? staying[index].startTime : staying.length > 0 ? endOf(staying[staying.length - 1]) : 0;
  const ordered = [...moving].sort((a, b) => a.startTime - b.startTime);
  for (const clip of ordered) clip.startTime = at;
  insertIntoMain(scene, ordered, at);
}

/**
 * Moves the selection as one set, each member keeping its time offset from the anchor. The target time is the
 * anchor's new start (pointer time minus grab offset, already snapped by the gesture); it is clamped so that no
 * member starts before 0 and rounded to a frame. A member on a locked track rejects the move as a whole.
 */
export const move = (options: MoveOptions): TimelineCommand<{ delta: number; createdTrackIds: string[] }> => ({
  type: options.type ?? "timeline.move", label: options.label ?? "Move", sceneId: options.sceneId, coalesce: options.coalesce,
  run(draft, env) {
    const scene = sceneById(draft, options.sceneId), fps = fpsOf(draft), order = tracksOfScene(scene);
    const hits = targetsOf(scene, options.elementIds, { groups: false, strict: true });
    // A group move that includes a member on a locked track is rejected as a whole.
    const groups = new Set(hits.map((hit) => hit.element.groupId).filter((id): id is string => id !== null));
    if (order.some((track) => track.locked && track.elements.some((element) => element.groupId !== null && groups.has(element.groupId)))) refuse("A grouped clip is on a locked track", "track-locked");
    if (hits.length === 0) return { info: { delta: 0, createdTrackIds: [] } };
    const anchor = hits.find((hit) => hit.element.id === (options.anchorId ?? options.elementIds[0])) ?? hits[0];
    const earliest = Math.min(...hits.map((hit) => hit.element.startTime));
    const delta = Math.max(-earliest, snapToFrame(Math.max(0, options.time), fps) - anchor.element.startTime);
    const target = options.target ?? { kind: "same" }, magnetic = env.edit.magnet && !env.edit.freeLayer;
    const members = hits.map((hit) => ({ ...hit, from: order.indexOf(hit.track) })).sort((a, b) => a.from - b.from || a.element.startTime - b.element.startTime);
    const ids = new Set(members.map((member) => member.element.id));
    const lift = () => { for (const track of order) { track.elements = track.elements.filter((element) => !ids.has(element.id)); track.transitions = track.transitions.filter((record) => !(ids.has(String(record.fromElementId)) !== ids.has(String(record.toElementId)))); } };
    const created: string[] = [];
    const toNewTracks = (index: number) => {
      if (members.some((member) => member.element.type === "audio") && members.some((member) => member.element.type !== "audio")) rejectDoc("document/track-zone-mismatch", "", "a group mixing audio and non-audio members cannot move to new tracks");
      lift();
      const audio = members[0].element.type === "audio";
      const zone = audio ? scene.tracks.audio : scene.tracks.overlay, at = Math.max(0, Math.min(zone.length, index));
      members.forEach((member, offset) => {
        const track = createTrackAt(scene, TRACK_FOR_ELEMENT[member.element.type], at + offset, env.newId);
        member.element.startTime += delta;
        track.elements.push(member.element);
        created.push(track.id);
      });
      return { selection: [...ids], info: { delta, createdTrackIds: created } };
    };
    if (target.kind === "new-tracks") return toNewTracks(target.index);

    // Where each member lands on existing tracks.
    const shiftRows = target.kind === "track" ? order.findIndex((track) => track.id === target.trackId) - order.indexOf(anchor.track) : 0;
    if (target.kind === "track" && !trackById(scene, target.trackId)) rejectDoc("document/unknown-reference", "", `track "${target.trackId}" does not exist`);
    const destinations = members.map((member) => {
      const wanted = order[member.from + shiftRows];
      if (member.element.id === anchor.element.id || (wanted && canHold(wanted, member.element.type) && !wanted.locked)) return wanted;
      // The nearest compatible unlocked row above or below the wanted one.
      return order.map((track, index) => ({ track, distance: Math.abs(index - (member.from + shiftRows)) })).filter(({ track }) => canHold(track, member.element.type) && !track.locked).sort((a, b) => a.distance - b.distance)[0]?.track;
    });
    const anchorTrack = destinations[members.findIndex((member) => member.element.id === anchor.element.id)];
    if (!anchorTrack || !canHold(anchorTrack, anchor.element.type)) rejectDoc("document/element-track-mismatch", "", "the target track does not hold this element type");
    if (anchorTrack.locked) refuse("The track is locked", "track-locked");
    if (destinations.some((track) => !track)) rejectDoc("document/element-track-mismatch", "", "no compatible track for a member of the move");

    const main = scene.tracks.main;
    const mainMovers = members.filter((member, index) => destinations[index] === main);
    const reorder = magnetic && mainMovers.length > 0 && mainMovers.every((member) => member.track === main);
    lift();
    for (const member of members) member.element.startTime += delta;
    const fallback = (): never | ReturnType<typeof toNewTracks> => {
      // Back where they were, then one new track per member at the hovered row.
      for (const member of members) { member.element.startTime -= delta; member.track.elements.push(member.element); }
      if (target.kind !== "track") return rejectDoc("document/elements-overlap", "", "the moved elements would overlap");
      const zone = zoneOfTrack(scene, anchorTrack);
      return toNewTracks(zone === "audio" ? scene.tracks.audio.indexOf(anchorTrack) : zone === "overlay" ? scene.tracks.overlay.indexOf(anchorTrack) : scene.tracks.overlay.length);
    };
    let noMagnet = false;
    for (const [index, member] of members.entries()) {
      const track = destinations[index]!;
      if (track === main) continue;
      if (!isFree(track, member.element.startTime, endOf(member.element))) return fallback();
      track.elements.push(member.element);
    }
    if (mainMovers.length > 0) {
      const clips = mainMovers.map((member) => member.element);
      if (reorder) {
        // Dragging within the magnetic main track reorders: the gaps close and the clips enter at the pointed cut.
        main.elements.push(...clips.map((clip) => ({ ...clip, startTime: clip.startTime - delta })));
        const originals = main.elements.filter((clip) => ids.has(clip.id));
        reorderMain(scene, originals, options.pointerTime ?? anchor.element.startTime + anchor.element.duration / 2);
        noMagnet = true;
      } else if (magnetic) {
        insertIntoMain(scene, clips, Math.min(...clips.map((clip) => clip.startTime)));
      } else if (env.edit.freeLayer && !clips.every((clip) => isFree(main, clip.startTime, endOf(clip)))) {
        const placed = placeElements(scene, clips, { strategy: "mainFirst" }, env);
        if (placed.created) created.push(placed.track.id);
      } else {
        // Magnet off: alone on the track, or at or before the earliest other clip, the start is forced to 0.
        const first = Math.min(...clips.map((clip) => clip.startTime)), others = Math.min(Infinity, ...main.elements.map((clip) => clip.startTime));
        if (!env.edit.freeLayer && first <= others) for (const clip of clips) clip.startTime -= first;
        if (!clips.every((clip) => isFree(main, clip.startTime, endOf(clip)))) { for (const clip of clips) if (!env.edit.freeLayer && first <= others) clip.startTime += first; return fallback(); }
        main.elements.push(...clips);
      }
    }
    for (const track of tracksOfScene(scene)) settleTrack(track);
    return { selection: [...ids], info: { delta, createdTrackIds: created }, noMagnet };
  },
});

/** Keyboard nudge by frames: the same rules as a pointer move, without snapping; a held key is one undo step. */
export const nudge = (doc: ProjectDocument, options: { sceneId: string; elementIds: string[]; frames: number }): TimelineCommand<{ delta: number; createdTrackIds: string[] }> => {
  const scene = sceneById(doc, options.sceneId), first = hitsOf(scene, options.elementIds)[0];
  const action = `timeline.nudge-${options.frames < 0 ? "left" : "right"}${Math.abs(options.frames) === 10 ? "-10" : ""}`;
  return move({
    sceneId: options.sceneId, elementIds: options.elementIds, anchorId: first?.element.id, time: (first?.element.startTime ?? 0) + options.frames * frameTicks(fpsOf(doc)),
    label: "Nudge", type: action, coalesce: `${action}:${[...options.elementIds].sort().join(",")}:startTime`,
    pointerTime: first ? (options.frames > 0 ? endOf(first.element) + 1 : first.element.startTime - 1) + options.frames * frameTicks(fpsOf(doc)) : undefined,
  });
};

/** `timeline.move-track-up` / `timeline.move-track-down`: the selection goes to the next compatible unlocked track in that direction, at the same times. */
export const moveToAdjacentTrack = (doc: ProjectDocument, options: { sceneId: string; elementIds: string[]; direction: "up" | "down" }): TimelineCommand<{ delta: number; createdTrackIds: string[] }> => {
  const scene = sceneById(doc, options.sceneId), order = tracksOfScene(scene), first = hitsOf(scene, options.elementIds)[0];
  const from = first ? order.indexOf(first.track) : -1, step = options.direction === "up" ? -1 : 1;
  let index = from + step;
  while (first && order[index] && (!canHold(order[index], first.element.type) || order[index].locked)) index += step;
  if (!first || !order[index]) return { type: `timeline.move-track-${options.direction}`, label: "Move to track", sceneId: options.sceneId, run: () => ({}) };
  return move({ sceneId: options.sceneId, elementIds: options.elementIds, anchorId: first.element.id, time: first.element.startTime, target: { kind: "track", trackId: order[index].id }, label: "Move to track", type: `timeline.move-track-${options.direction}` });
};

/** "To overlay": a main-track clip goes to the nearest free overlay video track at the same time (a new one directly above main otherwise). */
export const toOverlay = (options: { sceneId: string; elementIds: string[] }): TimelineCommand => ({
  type: "timeline.to-overlay", label: "To overlay", sceneId: options.sceneId,
  run(draft, env) {
    const scene = sceneById(draft, options.sceneId), main = scene.tracks.main;
    if (main.locked) refuse("The main track is locked", "main-locked");
    const clips = main.elements.filter((clip) => options.elementIds.includes(clip.id));
    main.elements = main.elements.filter((clip) => !clips.includes(clip));
    for (const clip of clips) nearestOverlayVideo(scene, [clip], env);
    return { selection: clips.map((clip) => clip.id) };
  },
});
/** "To main track": an overlay video, image or compound clip is inserted into the main track with `mainInsert`. */
export const toMain = (options: { sceneId: string; elementIds: string[] }): TimelineCommand => ({
  type: "timeline.to-main", label: "To main track", sceneId: options.sceneId,
  run(draft, env) {
    const scene = sceneById(draft, options.sceneId);
    const hits = hitsOf(scene, options.elementIds).filter((hit) => hit.track !== scene.tracks.main && TRACK_FOR_ELEMENT[hit.element.type] === "video");
    if (hits.some((hit) => hit.track.locked)) refuse("The track is locked", "track-locked");
    for (const hit of hits) hit.track.elements.splice(hit.track.elements.indexOf(hit.element), 1);
    if (hits.length > 0) insertIntoMain(scene, hits.map((hit) => hit.element).sort((a, b) => a.startTime - b.startTime), Math.min(...hits.map((hit) => hit.element.startTime)));
    return { selection: hits.map((hit) => hit.element.id) };
  },
});

/** Removes keyframes by id; a channel left without keys is removed with them. */
export const removeKeyframes = (options: { sceneId: string; keys: { elementId: string; path: string; keyId: string }[] }): TimelineCommand => ({
  type: "timeline.keyframes.delete", label: "Delete keyframes", sceneId: options.sceneId,
  run(draft) {
    const scene = sceneById(draft, options.sceneId);
    for (const { track, element } of hitsOf(scene, options.keys.map((key) => key.elementId))) {
      if (track.locked) refuse("The track is locked", "track-locked");
      if (!isObject(element.animations)) continue;
      for (const key of options.keys.filter((entry) => entry.elementId === element.id)) {
        const channel = element.animations[key.path] as Json | undefined;
        if (!channel) continue;
        for (const part of "r" in channel ? ["r", "g", "b", "a"].map((name) => channel[name] as Json) : [channel]) part.keys = (part.keys as Json[]).filter((entry) => entry.id !== key.keyId);
      }
    }
  },
});
/**
 * "Delete" dispatches by the active selection kind: mask points (their owner's command), then keyframes, then
 * elements. Deleting elements clears the selection.
 */
export function deleteSelection(selection: { selectedElements: string[]; selectedKeyframes: { elementId: string; path: string; keyId: string }[]; selectedMaskPoints: unknown[] }, sceneId: string): { kind: "maskPoints" } | { kind: "keyframes" | "elements"; command: TimelineCommand } | { kind: "none" } {
  if (selection.selectedMaskPoints.length > 0) return { kind: "maskPoints" };
  if (selection.selectedKeyframes.length > 0) return { kind: "keyframes", command: removeKeyframes({ sceneId, keys: selection.selectedKeyframes }) };
  if (selection.selectedElements.length > 0) return { kind: "elements", command: deleteElements({ sceneId, elementIds: selection.selectedElements }) };
  return { kind: "none" };
}
