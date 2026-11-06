import type { ProjectDocument, TrackType } from "@jagentchill/protocol";
import { findAsset, type Json } from "../model.ts";
import { isUnknownElement } from "../ops/shared.ts";
import type { TimelineCommand } from "./command.ts";
import {
  createTrackAt, endOf, isHideable, newTrackIndex, overlaps, refuse, rejectDoc, sceneById, trackSupports, tracksOfScene, zoneOfTrack, type El, type Sc, type Tr,
} from "./model.ts";

const trackIn = (draft: ProjectDocument, trackId: string): { scene: Sc; track: Tr } => {
  for (const scene of draft.scenes as unknown as Sc[]) { const track = tracksOfScene(scene).find((entry) => entry.id === trackId); if (track) return { scene, track }; }
  return rejectDoc("document/unknown-reference", "", `track "${trackId}" does not exist`);
};

/** "Add track": an empty track of the chosen type at the default index, pinned so it persists while empty. */
export const addTrack = (options: { sceneId: string; type: TrackType; id?: string; index?: number; name?: string }): TimelineCommand<{ trackId: string }> => ({
  type: "timeline.track.add", label: "Add track", sceneId: options.sceneId,
  run(draft, env) {
    const scene = sceneById(draft, options.sceneId);
    const track = createTrackAt(scene, options.type, options.index ?? newTrackIndex(scene, options.type), options.id ? () => options.id! : env.newId, { pinned: true, name: options.name });
    return { info: { trackId: track.id } };
  },
});

/** The name a rename field commits: trimmed, cut to 64 characters; an empty result keeps the previous name (`null`). */
export const committedName = (input: string, max = 64): string | null => { const name = input.trim().slice(0, max).trim(); return name.length > 0 ? name : null; };
/** Renames a track and pins it. An empty name changes nothing and records no step. */
export const renameTrack = (options: { trackId: string; name: string }): TimelineCommand => ({
  type: "timeline.track.rename", label: "Rename track",
  run(draft) {
    const name = committedName(options.name);
    if (name === null) return;
    const { track } = trackIn(draft, options.trackId);
    if (track.name === name) return;
    track.name = name; track.pinned = true;
  },
});

/** Lock, hide and mute are undoable; a flag the track type does not carry is refused (its control does not exist). */
export const toggleTrackFlag = (options: { trackId: string; flag: "locked" | "hidden" | "muted"; value?: boolean }): TimelineCommand => ({
  type: options.flag === "locked" ? "timeline.track-lock.toggle" : `timeline.track.${options.flag === "hidden" ? "hide" : "mute"}.toggle`,
  label: { locked: "Lock track", hidden: "Hide track", muted: "Mute track" }[options.flag],
  run(draft) {
    const { track } = trackIn(draft, options.trackId);
    if (!trackSupports(track, options.flag)) refuse(`A ${track.type} track has no ${options.flag} flag`, "unsupported-flag");
    track[options.flag] = options.value ?? !track[options.flag];
  },
});
/** Solo is stored and synced; toggling it emits a state patch and creates no undo step. */
export const toggleTrackSolo = (options: { trackId: string }): TimelineCommand => ({
  type: "timeline.track.solo.toggle", label: "Solo track", history: false,
  run(draft) {
    const { track } = trackIn(draft, options.trackId);
    if (!trackSupports(track, "solo")) refuse(`A ${track.type} track has no solo flag`, "unsupported-flag");
    track.solo = !track.solo;
  },
});

/** Reorders a track inside its zone; an index outside the zone is clamped, so a track never crosses the main track. */
export const reorderTrack = (options: { trackId: string; toIndex: number }): TimelineCommand => ({
  type: "timeline.track.reorder", label: "Reorder tracks",
  run(draft) {
    const { scene, track } = trackIn(draft, options.trackId), zone = zoneOfTrack(scene, track);
    if (zone === "main") return;
    const list = scene.tracks[zone], from = list.indexOf(track), to = Math.max(0, Math.min(list.length - 1, options.toIndex));
    if (from === to) return;
    list.splice(from, 1); list.splice(to, 0, track);
  },
});
/** `timeline.track.move-up` / `timeline.track.move-down`; at the zone limit nothing changes. */
export const moveTrack = (doc: ProjectDocument, options: { trackId: string; direction: "up" | "down" }): TimelineCommand => {
  const { scene, track } = trackIn(doc, options.trackId), zone = zoneOfTrack(scene, track);
  const index = zone === "main" ? 0 : scene.tracks[zone].indexOf(track);
  return { ...reorderTrack({ trackId: options.trackId, toIndex: index + (options.direction === "up" ? -1 : 1) }), type: `timeline.track.move-${options.direction}` };
};
/** A header dragged to a row of the display order lands at the nearest valid index of its own zone. */
export function trackDropIndex(scene: Sc, trackId: string, displayIndex: number): number {
  const track = tracksOfScene(scene).find((entry) => entry.id === trackId)!;
  const zone = zoneOfTrack(scene, track), offset = zone === "audio" ? scene.tracks.overlay.length + 1 : 0;
  return zone === "main" ? 0 : Math.max(0, Math.min(scene.tracks[zone].length - 1, displayIndex - offset));
}

/** "Delete track": the track and all its elements go in one step. The main track is never removed: the command changes nothing. */
export const deleteTrack = (options: { trackId: string }): TimelineCommand<{ removedElements: number }> => ({
  type: "timeline.track.delete", label: "Delete track",
  run(draft) {
    const { scene, track } = trackIn(draft, options.trackId), zone = zoneOfTrack(scene, track);
    if (zone === "main") return { info: { removedElements: 0 } };
    const gone = new Set(track.elements.map((element) => element.id));
    scene.tracks[zone] = scene.tracks[zone].filter((entry) => entry !== track);
    for (const other of tracksOfScene(scene)) for (const element of other.elements) if ((element.tracking as Json | undefined)?.targetElementId && gone.has(String((element.tracking as Json).targetElementId))) delete element.tracking;
    return { selection: [], info: { removedElements: gone.size } };
  },
});
/** The confirmation shown before deleting a track that holds elements; `null` when none is needed. */
export const deleteTrackConfirmation = (track: { elements: unknown[] }): string | null => (track.elements.length > 0 ? `Delete track and its ${track.elements.length} elements?` : null);

// — Element flags —
const elementsIn = (scene: Sc, ids: string[]): { track: Tr; element: El }[] => {
  const wanted = new Set(ids);
  return tracksOfScene(scene).filter((track) => !track.locked).flatMap((track) => track.elements.filter((element) => wanted.has(element.id) && !isUnknownElement(element)).map((element) => ({ track, element })));
};
/** Audio-capable: audio, and video or compound whose source has sound. */
export function isAudioCapable(doc: ProjectDocument, element: El): boolean {
  if (element.type === "audio" || element.type === "compound") return true;
  if (element.type !== "video" || element.freeze) return false;
  const asset = typeof element.mediaId === "string" ? findAsset(doc, element.mediaId) : undefined;
  return asset?.hasAudio !== false;
}
/** "Hide/Show", "Mute/Unmute", "Deactivate/Activate": when any target is on, all are switched off; otherwise all on. Elements the action does not apply to are skipped. */
export const toggleElementFlag = (options: { sceneId: string; elementIds: string[]; flag: "hidden" | "muted" | "active" }): TimelineCommand<{ applied: string[] }> => ({
  type: { hidden: "timeline.toggle-hidden", muted: "audio.mute.toggle", active: "timeline.activate.toggle" }[options.flag],
  label: { hidden: "Hide", muted: "Mute", active: "Deactivate" }[options.flag], sceneId: options.sceneId,
  run(draft) {
    const hits = elementsIn(sceneById(draft, options.sceneId), options.elementIds).map((hit) => hit.element);
    const hideable = options.flag !== "muted" ? hits.filter(isHideable) : [], mutable = options.flag !== "hidden" ? hits.filter((element) => isAudioCapable(draft, element)) : [];
    const anyOn = hideable.some((element) => element.hidden !== true) || mutable.some((element) => element.muted !== true);
    for (const element of hideable) element.hidden = anyOn;
    for (const element of mutable) element.muted = anyOn;
    return { info: { applied: [...new Set([...hideable, ...mutable].map((element) => element.id))] } };
  },
});
/** "Rename" of an element: 1–128 characters, trimmed; an empty name keeps the previous one. */
export const renameElement = (options: { sceneId: string; elementId: string; name: string }): TimelineCommand => ({
  type: "timeline.element.rename", label: "Rename", sceneId: options.sceneId,
  run(draft) {
    const name = committedName(options.name, 128), hit = elementsIn(sceneById(draft, options.sceneId), [options.elementId]).find((entry) => entry.element.id === options.elementId);
    if (name !== null && hit) hit.element.name = name;
  },
});

// — Group and link —
export const group = (options: { sceneId: string; elementIds: string[] }): TimelineCommand<{ groupId: string }> => ({
  type: "timeline.group", label: "Group", sceneId: options.sceneId,
  run(draft, env) {
    const hits = elementsIn(sceneById(draft, options.sceneId), options.elementIds);
    if (hits.length < 2) refuse("Select two or more clips to group", "disabled");
    const groupId = env.newId();
    for (const hit of hits) hit.element.groupId = groupId;
    return { selection: hits.map((hit) => hit.element.id), info: { groupId } };
  },
});
export const ungroup = (options: { sceneId: string; elementIds: string[] }): TimelineCommand => ({
  type: "timeline.ungroup", label: "Ungroup", sceneId: options.sceneId,
  run(draft) { for (const hit of elementsIn(sceneById(draft, options.sceneId), options.elementIds)) hit.element.groupId = null; },
});

/** "Link" is offered for exactly one unlinked audio element and one unlinked video of the same media, or one unlinked text element, that overlap in time. */
export function linkAvailability(doc: ProjectDocument, sceneId: string, elementIds: string[]): boolean {
  const scene = sceneById(doc, sceneId), picked = tracksOfScene(scene).flatMap((track) => track.elements).filter((element) => elementIds.includes(element.id));
  if (picked.length !== 2 || picked.some((element) => element.linkId !== null)) return false;
  const audio = picked.find((element) => element.type === "audio"), other = picked.find((element) => element.type !== "audio");
  if (!audio || !other || !overlaps(audio.startTime, endOf(audio), other.startTime, endOf(other))) return false;
  return other.type === "text" || (other.type === "video" && other.mediaId === audio.mediaId);
}
export const link = (options: { sceneId: string; elementIds: string[] }): TimelineCommand => ({
  type: "timeline.link", label: "Link", sceneId: options.sceneId,
  run(draft, env) {
    if (!linkAvailability(draft, options.sceneId, options.elementIds)) refuse("Link needs one video or text clip and one audio clip that overlap", "disabled");
    const linkId = env.newId();
    for (const element of tracksOfScene(sceneById(draft, options.sceneId)).flatMap((track) => track.elements)) if (options.elementIds.includes(element.id)) element.linkId = linkId;
  },
});
/** "Unlink": clears the `linkId` on both members so they edit independently. */
export const unlink = (options: { sceneId: string; elementIds: string[] }): TimelineCommand => ({
  type: "timeline.unlink", label: "Unlink", sceneId: options.sceneId,
  run(draft) {
    const scene = sceneById(draft, options.sceneId), all = tracksOfScene(scene).flatMap((track) => track.elements);
    const links = new Set(all.filter((element) => options.elementIds.includes(element.id) && element.linkId).map((element) => element.linkId));
    for (const element of all) if (links.has(element.linkId)) element.linkId = null;
  },
});

/** "Mirror" (horizontal) and "Flip vertical" from the timeline: every selected visual element toggles the flag, in one step; mirroring never touches the scale. */
export const flipElements = (options: { sceneId: string; elementIds: string[]; axis: "horizontal" | "vertical" }): TimelineCommand<{ applied: string[] }> => ({
  type: options.axis === "horizontal" ? "preview.mirror" : "preview.flip-vertical", label: options.axis === "horizontal" ? "Mirror" : "Flip vertical", sceneId: options.sceneId,
  run(draft) {
    const hits = elementsIn(sceneById(draft, options.sceneId), options.elementIds).filter((hit) => "flip" in hit.element);
    if (hits.length === 0) refuse("Select a visual clip", "disabled");
    for (const { element } of hits) { const flip = element.flip as { horizontal: boolean; vertical: boolean }; flip[options.axis] = !flip[options.axis]; }
    return { info: { applied: hits.map((hit) => hit.element.id) } };
  },
});
