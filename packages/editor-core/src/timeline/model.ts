import { createTrack, type ProjectDocument, type Rational, type TrackType } from "@jagentchill/protocol";
import { documentError, DocumentRejected } from "../errors.ts";
import { compareIds } from "../patch.ts";
import type { Json, Zone } from "../model.ts";
import { dropBrokenTransitions } from "../ops/shared.ts";

/** The parts of an element, a track and a scene the timeline engine reads; every other stored key travels untouched. */
export type El = { id: string; type: string; name: string; startTime: number; duration: number; trimStart: number; trimEnd: number; groupId: string | null; linkId: string | null; [key: string]: unknown };
export type Tr = { id: string; name: string; type: TrackType; locked: boolean; pinned: boolean; elements: El[]; transitions: Json[]; [key: string]: unknown };
export type Sc = { id: string; name: string; isMain: boolean; kind: "timeline" | "compound" | "multicam"; tracks: { overlay: Tr[]; main: Tr; audio: Tr[] }; markers: Json[]; inPoint?: number; outPoint?: number; multicam?: Json; [key: string]: unknown };
export type Located = { scene: Sc; track: Tr; zone: Zone; element: El };

/** The four settings that change what a command writes; inputs of the command, never ambient state. */
export type EditContext = { magnet: boolean; ripple: boolean; linkage: boolean; freeLayer: boolean };
export type TimelinePreferences = { magnet: boolean; ripple: boolean; linkage: boolean; freeLayer: boolean; snapping: boolean; previewAxis: boolean; autoFollow: "page" | "smooth" | "off" };
export const DEFAULT_TIMELINE_PREFERENCES: TimelinePreferences = { magnet: true, ripple: false, linkage: true, freeLayer: false, snapping: true, previewAxis: false, autoFollow: "page" };
/** Host principals (agent tools, workflow, film and automation writers) unless the call states other values. */
export const HOST_EDIT_CONTEXT: EditContext = { magnet: true, ripple: false, linkage: true, freeLayer: false };
export const hostEditContext = (override: Partial<EditContext> = {}): EditContext => ({ ...HOST_EDIT_CONTEXT, ...override });
/** Desktop and web pass the device preferences; mobile has no magnet switch and never ripples. */
export function editContextFor(platform: "desktop" | "web" | "mobile", prefs: Pick<TimelinePreferences, "magnet" | "ripple" | "linkage" | "freeLayer">): EditContext {
  if (platform === "mobile") return { magnet: !prefs.freeLayer, ripple: false, linkage: prefs.linkage, freeLayer: prefs.freeLayer };
  return { magnet: prefs.magnet && !prefs.freeLayer, ripple: prefs.ripple, linkage: prefs.linkage, freeLayer: prefs.freeLayer };
}

/** User-facing texts the engine returns with a refusal, exactly as the spec words them. */
export const TIMELINE_MESSAGES = {
  trackLimit: "Track limit reached (99)",
  sceneLimit: "Scene limit reached (200)",
  templateLocked: "This project is a template draft. Choose 'Edit in full editor' to change its structure.",
  mainLocked: "The main track is locked",
  compoundCycle: "A compound clip cannot contain itself",
  compoundDepth: "Compound clips can be nested up to 8 levels",
  compoundAdjacent: "Select adjacent main-track clips",
  markerExists: "A marker already exists at this time",
  markerLimit: "Marker limit reached (1000)",
  multicamSelection: "Select 2 to 8 video clips",
  multicamLinked: "Recover audio into the clips first",
  multicamSource: "A multi-camera source holds only its angles",
  multicamFlatten: "Turn on 'Audio follows video' to flatten",
  splitDisabled: "Select a clip or move the playhead onto one",
  rangeNeedsSelection: "Select a clip first",
  noSceneChanges: "No scene changes detected",
  magnetHasGaps: "Main track magnet — on. Turn off and on to close the gaps on this track",
  magnetLocked: "Unlock the main track to close its gaps",
  magnetFreeLayer: "Off while Free layer is on",
  readOnly: "This project is open read-only",
} as const;

/** A command refused for a reason that is not a document finding (a locked main track, a disabled action). Nothing changed. */
export class CommandRefused extends Error {
  readonly reason: string;
  /** What a caller needs to act on the refusal (the limits of an out-of-range value). */
  readonly details?: Record<string, unknown>;
  constructor(message: string, reason = "refused", details?: Record<string, unknown>) { super(message); this.name = "CommandRefused"; this.reason = reason; this.details = details; }
}
export const refuse = (message: string, reason?: string, details?: Record<string, unknown>): never => { throw new CommandRefused(message, reason, details); };
export const rejectDoc = (code: string, path: string, message: string, details?: Record<string, unknown>): never => {
  throw new DocumentRejected([documentError(code, path, message, details)]);
};

export const endOf = (element: { startTime: number; duration: number }): number => element.startTime + element.duration;
/** Half-open intervals: touching edges do not overlap. */
export const overlaps = (startA: number, endA: number, startB: number, endB: number): boolean => startA < endB && endA > startB;
export const sceneById = (doc: ProjectDocument, sceneId: string): Sc =>
  (doc.scenes.find((scene) => scene.id === sceneId) as unknown as Sc | undefined) ?? rejectDoc("document/unknown-scene", "", `scene "${sceneId}" does not exist`);
/** Display order top to bottom: overlay, main, audio. */
export const tracksOfScene = (scene: Sc): Tr[] => [...scene.tracks.overlay, scene.tracks.main, ...scene.tracks.audio];
export const zoneOfTrack = (scene: Sc, track: Tr): Zone => (track === scene.tracks.main || track.id === scene.tracks.main.id ? "main" : track.type === "audio" ? "audio" : "overlay");
export const trackById = (scene: Sc, trackId: string): Tr | undefined => tracksOfScene(scene).find((track) => track.id === trackId);
export const elementsOfScene = (scene: Sc): El[] => tracksOfScene(scene).flatMap((track) => track.elements);
export const fpsOf = (doc: ProjectDocument): Rational => doc.settings.fps as Rational;
/** The scene this device shows: `local.currentSceneId`, else the main scene. */
export function activeSceneId(doc: ProjectDocument): string {
  const current = (doc as { local?: { currentSceneId?: string } }).local?.currentSceneId;
  return current && doc.scenes.some((scene) => scene.id === current) ? current : (doc.scenes.find((scene) => scene.isMain) ?? doc.scenes[0]).id;
}
export function locate(doc: ProjectDocument, elementId: string): Located | undefined {
  for (const scene of doc.scenes as unknown as Sc[]) for (const track of tracksOfScene(scene)) {
    const element = track.elements.find((entry) => entry.id === elementId);
    if (element) return { scene, track, zone: zoneOfTrack(scene, track), element };
  }
  return undefined;
}
export const located = (doc: ProjectDocument, elementId: string): Located => locate(doc, elementId) ?? rejectDoc("document/unknown-reference", "", `element "${elementId}" does not exist`);
export const sceneDurationOf = (scene: Sc): number => elementsOfScene(scene).reduce((latest, element) => Math.max(latest, endOf(element)), 0);

// — Types and compatibility —
export const TRACK_FOR_ELEMENT: Record<string, TrackType> = {
  video: "video", image: "video", compound: "video", audio: "audio", text: "text", sticker: "graphic", graphic: "graphic", effect: "effect", adjustment: "adjustment", caption: "caption",
};
export const canHold = (track: { type: string }, elementType: string): boolean => TRACK_FOR_ELEMENT[elementType] === track.type;
export const MASKABLE_TYPES = ["video", "image", "graphic", "sticker", "compound", "adjustment"] as const;
export const HIDEABLE_TYPES = ["video", "image", "text", "caption", "sticker", "graphic", "effect", "adjustment", "compound"] as const;
export const EFFECT_CAPABLE_TYPES = ["video", "image", "text", "sticker", "graphic", "compound"] as const;
export const VISUAL_TYPES = ["video", "image", "text", "sticker", "graphic", "compound"] as const;
const has = (list: readonly string[], type: string) => list.includes(type);
export const isMaskable = (element: { type: string }): boolean => has(MASKABLE_TYPES, element.type);
export const isHideable = (element: { type: string }): boolean => has(HIDEABLE_TYPES, element.type);
export const isEffectCapable = (element: { type: string }): boolean => has(EFFECT_CAPABLE_TYPES, element.type);
export const isVisual = (element: { type: string }): boolean => has(VISUAL_TYPES, element.type);
export const isFreeze = (element: object): boolean => { const freeze = (element as { freeze?: unknown }).freeze; return freeze !== undefined && freeze !== null; };
/** Retimable: video, audio and compound, except freeze elements. */
export const isRetimable = (element: { type: string }): boolean => has(["video", "audio", "compound"], element.type) && !isFreeze(element);
/** Elements with a source span cannot extend past it; the others extend freely. */
export const hasSourceBounds = (element: El): boolean => typeof element.sourceDuration === "number" && !isFreeze(element);

export const DEFAULT_TRACK_NAMES: Record<TrackType, string> = {
  video: "Video track", text: "Text track", audio: "Audio track", graphic: "Graphic track", effect: "Effect track", adjustment: "Adjustment track", caption: "Caption track",
};
export const MAIN_TRACK_NAME = "Main Track";
export type TrackFlag = "locked" | "pinned" | "hidden" | "muted" | "solo" | "volume" | "pan";
/** Which flags a track type carries; a control or menu item for an unsupported flag does not exist. */
export function trackSupports(track: { type: string }, flag: TrackFlag): boolean {
  if (flag === "locked" || flag === "pinned") return true;
  if (flag === "hidden") return track.type !== "audio";
  return track.type === "video" || track.type === "audio";
}
export const TRACK_LIMIT = 99;
export const TIMELINE_GEOMETRY_DRAG_PX = 5;

/** Is `[start, end)` free on the track, ignoring the elements in `ignore`? */
export function isFree(track: Tr, start: number, end: number, ignore?: ReadonlySet<string>): boolean {
  return track.elements.every((element) => ignore?.has(element.id) || !overlaps(start, end, element.startTime, endOf(element)));
}

/** Index of a new track in its zone. `default`: audio last, effect/adjustment on top (below captions), caption on top, others directly above main. */
export function newTrackIndex(scene: Sc, type: TrackType, rule: "default" | "highest" = "default"): number {
  if (type === "audio") return rule === "highest" ? 0 : scene.tracks.audio.length;
  if (rule === "highest" || type === "caption") return 0;
  if (type === "effect" || type === "adjustment") { let index = 0; while (scene.tracks.overlay[index]?.type === "caption") index++; return index; }
  return scene.tracks.overlay.length;
}

/** Creates a track in its zone at the clamped index. Track number 100 of a zone rejects the whole command. */
export function createTrackAt(scene: Sc, type: TrackType, index: number, newId: () => string, options: { pinned?: boolean; name?: string } = {}): Tr {
  const zone = type === "audio" ? scene.tracks.audio : scene.tracks.overlay;
  if (zone.length >= TRACK_LIMIT) rejectDoc("document/limit-exceeded", `/scenes/@${scene.id}/tracks/${type === "audio" ? "audio" : "overlay"}`, TIMELINE_MESSAGES.trackLimit, { limit: type === "audio" ? "audioTracksPerScene" : "overlayTracksPerScene", value: TRACK_LIMIT });
  const track = createTrack(type, { id: newId(), name: options.name ?? DEFAULT_TRACK_NAMES[type], pinned: options.pinned === true, ...(type === "caption" ? { caption: { style: {} } } : {}) }) as unknown as Tr;
  zone.splice(Math.max(0, Math.min(zone.length, index)), 0, track);
  return track;
}

/** Canonical order of a track and the transitions that still join two adjacent clips. */
export function settleTrack(track: Tr): void {
  track.elements.sort((a, b) => a.startTime - b.startTime || compareIds(a.id, b.id));
  dropBrokenTransitions(track as never);
}

/** Removes every empty overlay and audio track that is neither pinned nor locked. Angle tracks of a multi-camera source stay. */
export function pruneEmptyTracks(scene: Sc): void {
  if (scene.kind === "multicam") return;
  const keep = (track: Tr) => track.elements.length > 0 || track.pinned || track.locked;
  scene.tracks.overlay = scene.tracks.overlay.filter(keep);
  scene.tracks.audio = scene.tracks.audio.filter(keep);
}

/** A group or a link that lost its partner no longer exists. */
export function dissolveOrphans(scene: Sc): void {
  const elements = elementsOfScene(scene);
  for (const key of ["groupId", "linkId"] as const) {
    const counts = new Map<string, number>();
    for (const element of elements) if (typeof element[key] === "string") counts.set(element[key] as string, (counts.get(element[key] as string) ?? 0) + 1);
    for (const element of elements) if (typeof element[key] === "string" && counts.get(element[key] as string)! < 2) element[key] = null;
  }
}

/**
 * Ids widened by link membership, and by group membership when asked. A linked pair always edits together, so commands
 * widen by links; a group edits together through the selection (a click selects every member, Alt/Option-click one).
 */
export function withPartners(scene: Sc, ids: Iterable<string>, options: { groups?: boolean; links?: boolean } = { groups: false, links: true }): string[] {
  const all = elementsOfScene(scene), wanted = new Set(ids);
  const groups = new Set<string>(), links = new Set<string>();
  for (const element of all) if (wanted.has(element.id)) {
    if (options.groups === true && element.groupId) groups.add(element.groupId);
    if (options.links !== false && element.linkId) links.add(element.linkId);
  }
  // A group member's link partner comes along too, so the pass runs until nothing is added.
  let grew = true;
  while (grew) {
    grew = false;
    for (const element of all) {
      if (wanted.has(element.id)) continue;
      if ((element.groupId && groups.has(element.groupId)) || (element.linkId && links.has(element.linkId))) {
        wanted.add(element.id); grew = true;
        if (options.groups === true && element.groupId) groups.add(element.groupId);
        if (options.links !== false && element.linkId) links.add(element.linkId);
      }
    }
  }
  return all.filter((element) => wanted.has(element.id)).map((element) => element.id);
}
