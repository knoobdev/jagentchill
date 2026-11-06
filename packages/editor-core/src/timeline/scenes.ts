import { TICKS_PER_SECOND, type ProjectDocument } from "@jagentchill/protocol";
import { setLocal } from "../commit.ts";
import { clone, type Json } from "../model.ts";
import { snapToFrame } from "../time.ts";
import type { TimelineCommand } from "./command.ts";
import { newScene, nextSceneName, referencingScenes, SCENE_LIMIT } from "./compound.ts";
import { copySet } from "./copies.ts";
import { activeSceneId, endOf, fpsOf, refuse, rejectDoc, sceneById, sceneDurationOf, TIMELINE_MESSAGES, tracksOfScene, type Sc } from "./model.ts";
import { committedName } from "./track-commands.ts";
import { readViewState, writeViewState } from "./view.ts";

type Marker = { id: string; time: number; note?: string; color: number | string; duration?: number };
const scenesOf = (doc: ProjectDocument): Sc[] => doc.scenes as unknown as Sc[];

// — Scenes —
/** The rows of the Scenes sheet, in project order. */
export const sceneList = (doc: ProjectDocument): { id: string; name: string; duration: number; kind: Sc["kind"]; isMain: boolean; active: boolean }[] =>
  scenesOf(doc).map((scene) => ({ id: scene.id, name: scene.name, duration: sceneDurationOf(scene), kind: scene.kind, isMain: scene.isMain, active: scene.id === activeSceneId(doc) }));
/**
 * Switches the active scene of this device: `local.currentSceneId` changes, the scene's playhead is restored, the
 * playhead of the scene left is remembered. No undo step, no patch; the caller clears the selection.
 */
export function switchScene(doc: ProjectDocument, sceneId: string, playhead?: number): ProjectDocument {
  sceneById(doc, sceneId);
  const view = readViewState(doc), leaving = activeSceneId(doc);
  const scenePlayheads = { ...view.scenePlayheads, [leaving]: view.playheadTime };
  const next = setLocal(doc, (local) => { local.currentSceneId = sceneId; });
  return writeViewState(next, { scenePlayheads: playhead === undefined ? scenePlayheads : { ...scenePlayheads, [sceneId]: playhead }, playheadTime: playhead ?? scenePlayheads[sceneId] ?? 0 });
}
/** The state of "New scene", "Duplicate" and "Create compound clip" at the scene limit. */
export const sceneLimitState = (doc: ProjectDocument): { enabled: boolean; reason?: string } => (doc.scenes.length >= SCENE_LIMIT ? { enabled: false, reason: TIMELINE_MESSAGES.sceneLimit } : { enabled: true });

/** "New scene": an empty scene "Scene N"; the session switches to it. */
export const createScene = (options: { id?: string; name?: string } = {}): TimelineCommand<{ sceneId: string }> => ({
  type: "timeline.scene.create", label: "New scene",
  run(draft, env) {
    const scene = newScene(draft, env, { name: options.name ?? nextSceneName(draft, "Scene"), kind: "timeline", id: options.id });
    scenesOf(draft).push(scene);
    return { selection: [], info: { sceneId: scene.id } };
  },
});
/** Rename: trimmed, 1–64 characters; an empty name keeps the previous one and records nothing. */
export const renameScene = (options: { sceneId: string; name: string }): TimelineCommand => ({
  type: "timeline.scene.rename", label: "Rename scene",
  run(draft) { const name = committedName(options.name); if (name !== null) sceneById(draft, options.sceneId).name = name; },
});
/** Reorder by index; the main scene can be reordered and stays main. */
export const reorderScene = (options: { sceneId: string; toIndex: number }): TimelineCommand => ({
  type: "timeline.scene.reorder", label: "Reorder scenes",
  run(draft) {
    const from = draft.scenes.findIndex((scene) => scene.id === options.sceneId);
    if (from < 0) rejectDoc("document/unknown-scene", "", `scene "${options.sceneId}" does not exist`);
    const [scene] = draft.scenes.splice(from, 1);
    draft.scenes.splice(Math.max(0, Math.min(draft.scenes.length, options.toIndex)), 0, scene);
  },
});
/** "Duplicate": a deep copy with new scene, track, element, keyframe and marker ids, named "<name> (copy)", inserted after the source, never main. */
export const duplicateScene = (options: { sceneId: string }): TimelineCommand<{ sceneId: string }> => ({
  type: "timeline.scene.duplicate", label: "Duplicate scene",
  run(draft, env) {
    const source = sceneById(draft, options.sceneId);
    if (draft.scenes.length >= SCENE_LIMIT) rejectDoc("document/limit-exceeded", "/scenes", TIMELINE_MESSAGES.sceneLimit, { limit: "scenesPerProject", value: SCENE_LIMIT });
    const copy = clone(source), trackIds = new Map<string, string>();
    const copies = copySet(tracksOfScene(source).flatMap((track) => track.elements), env.newId);
    const elementIds = new Map([...copies].map(([from, element]) => [from, element.id]));
    copy.id = env.newId(); copy.isMain = false; copy.name = `${source.name} (copy)`.slice(0, 80);
    copy.created_ms = env.ctx.now_ms; copy.updated_ms = env.ctx.now_ms;
    for (const [index, track] of tracksOfScene(copy).entries()) {
      const original = tracksOfScene(source)[index];
      trackIds.set(original.id, (track.id = env.newId()));
      track.elements = original.elements.map((element) => {
        const element2 = copies.get(element.id)!;
        // A copied scene keeps its transitions: the references of each clip follow the records' new ids below.
        return Object.assign(element2, "transitionIn" in element ? { transitionIn: element.transitionIn, transitionOut: element.transitionOut } : {});
      });
      const records = new Map<unknown, string>();
      track.transitions = original.transitions.map((record) => { const id = env.newId(); records.set(record.id, id); return { ...clone(record), id, fromElementId: elementIds.get(String(record.fromElementId)), toElementId: elementIds.get(String(record.toElementId)) }; });
      for (const element of track.elements) for (const key of ["transitionIn", "transitionOut"]) if (typeof element[key] === "string") element[key] = records.get(element[key]) ?? null;
    }
    copy.markers = (copy.markers as Json[]).map((marker) => ({ ...marker, id: env.newId() }));
    if (copy.multicam) {
      const angles = new Map<unknown, string>();
      copy.multicam = { ...copy.multicam, angles: (copy.multicam.angles as Json[]).map((angle) => { const id = env.newId(); angles.set(angle.id, id); return { ...angle, id, trackId: trackIds.get(String(angle.trackId)) }; }) };
      if (copy.multicam.audioAngleId !== undefined) copy.multicam.audioAngleId = angles.get(copy.multicam.audioAngleId);
    }
    scenesOf(draft).splice(draft.scenes.findIndex((scene) => scene.id === source.id) + 1, 0, copy);
    return { selection: [], info: { sceneId: copy.id } };
  },
});

/** What the delete dialog of the Scenes sheet shows for a multi-selection of scenes. */
export function sceneDeletionState(doc: ProjectDocument, sceneIds: string[]): { enabled: boolean; confirmation?: string; usedBy: { sceneId: string; name: string; usedBy: string[] }[] } {
  const picked = scenesOf(doc).filter((scene) => sceneIds.includes(scene.id));
  if (picked.length === 0 || picked.some((scene) => scene.isMain)) return { enabled: false, usedBy: [] };
  const usedBy = picked.map((scene) => ({ sceneId: scene.id, name: scene.name, usedBy: referencingScenes(doc, scene.id).filter((other) => !sceneIds.includes(other.id)).map((other) => other.name) })).filter((entry) => entry.usedBy.length > 0);
  // A scene used by a compound element is listed with the scenes that use it; the dialog then has no confirm button.
  return usedBy.length > 0 ? { enabled: false, usedBy } : { enabled: true, confirmation: `Delete ${picked.length} scenes?`, usedBy: [] };
}
/** Deletes scenes in one step; undo restores them at their original positions. The session switches to the main scene when the active one went. */
export const deleteScenes = (options: { sceneIds: string[] }): TimelineCommand<{ removed: string[] }> => ({
  type: "timeline.scene.delete", label: "Delete scenes",
  run(draft) {
    const state = sceneDeletionState(draft, options.sceneIds);
    if (!state.enabled) refuse(state.usedBy.length > 0 ? `This scene is used by ${state.usedBy.map((entry) => entry.usedBy.map((name) => `"${name}"`).join(", ")).join(", ")}` : "The main scene cannot be deleted", "disabled");
    draft.scenes = draft.scenes.filter((scene) => !options.sceneIds.includes(scene.id));
    return { selection: [], info: { removed: options.sceneIds } };
  },
});

// — Markers —
const markersOf = (scene: Sc): Marker[] => scene.markers as unknown as Marker[];
const sortMarkers = (scene: Sc) => { markersOf(scene).sort((a, b) => a.time - b.time); };
export const MARKER_LIMIT = 1000;
export const MARKER_NOTE_MAX = 500;
/** The marker on the frame of `time`, if any (the toolbar button shows the active state on it). */
export const markerAt = (doc: ProjectDocument, sceneId: string, time: number): Marker | undefined => markersOf(sceneById(doc, sceneId)).find((marker) => marker.time === snapToFrame(time, fpsOf(doc)));
function addMarkerTo(draft: ProjectDocument, scene: Sc, time: number, color: number | string, newId: () => string): Marker {
  if (markersOf(scene).length >= MARKER_LIMIT) rejectDoc("document/limit-exceeded", `/scenes/@${scene.id}/markers`, TIMELINE_MESSAGES.markerLimit, { limit: "markersPerScene", value: MARKER_LIMIT });
  if (markersOf(scene).some((marker) => marker.time === time)) refuse(TIMELINE_MESSAGES.markerExists, "marker-exists");
  const marker: Marker = { id: newId(), time, color };
  markersOf(scene).push(marker); sortMarkers(scene);
  void draft;
  return marker;
}
/** `marker.toggle`: adds a marker on the playhead frame, or removes the one that is there. */
export const toggleMarker = (options: { sceneId: string; time: number }): TimelineCommand<{ markerId?: string }> => ({
  type: "marker.toggle", label: "Marker", sceneId: options.sceneId,
  run(draft, env) {
    const scene = sceneById(draft, options.sceneId), time = snapToFrame(Math.max(0, options.time), fpsOf(draft));
    const index = markersOf(scene).findIndex((marker) => marker.time === time);
    if (index >= 0) { markersOf(scene).splice(index, 1); return { info: {} }; }
    return { info: { markerId: addMarkerTo(draft, scene, time, 1, env.newId).id } };
  },
});
/** `marker.add-next-color`: a new marker in the next colour of the eight-colour palette after the last marker added with it. */
export const addMarkerNextColor = (options: { sceneId: string; time: number }): TimelineCommand<{ markerId: string; color: number }> => ({
  type: "marker.add-next-color", label: "Add marker", sceneId: options.sceneId,
  run(draft, env) {
    const scene = sceneById(draft, options.sceneId), color = (markersOf(scene).filter((marker) => typeof marker.color === "number").length % 8) + 1;
    const marker = addMarkerTo(draft, scene, snapToFrame(Math.max(0, options.time), fpsOf(draft)), color, env.newId);
    return { info: { markerId: marker.id, color } };
  },
});
const markerIn = (scene: Sc, markerId: string): Marker => markersOf(scene).find((marker) => marker.id === markerId) ?? rejectDoc("document/unknown-reference", "", `marker "${markerId}" does not exist`);
/** Moves a marker: frame-rounded, clamped to `[0, duration]`; a time that already holds a marker is refused and the marker stays. */
export const moveMarker = (options: { sceneId: string; markerId: string; time: number }): TimelineCommand => ({
  type: "timeline.marker.move", label: "Move marker", sceneId: options.sceneId,
  run(draft) {
    const scene = sceneById(draft, options.sceneId), marker = markerIn(scene, options.markerId);
    const time = snapToFrame(Math.max(0, Math.min(sceneDurationOf(scene), options.time)), fpsOf(draft));
    if (markersOf(scene).some((other) => other !== marker && other.time === time)) refuse(TIMELINE_MESSAGES.markerExists, "marker-exists");
    marker.time = time; sortMarkers(scene);
  },
});
/** The duration a marker accepts: seconds in steps of 0.1, from 0 to the scene duration minus the marker's time. */
export const clampMarkerDuration = (seconds: number, markerTime: number, sceneDuration: number): number =>
  Math.max(0, Math.min(Math.round(Math.round(seconds * 10) / 10 * TICKS_PER_SECOND), sceneDuration - markerTime));
/**
 * Edits note (0–500 characters), colour (palette index 1–8, custom `#rrggbb`, or `null` for the default) and duration.
 * Note edits of one editing session (focus to blur) share `editSession` and coalesce into one undo step.
 */
export const editMarker = (options: { sceneId: string; markerId: string; note?: string; color?: number | string | null; durationSeconds?: number; editSession?: string }): TimelineCommand => ({
  type: "timeline.marker.edit", label: "Edit marker", sceneId: options.sceneId, coalesce: options.editSession ? `marker-note:${options.markerId}:${options.editSession}` : undefined, coalesceWindow_ms: Infinity,
  run(draft) {
    const scene = sceneById(draft, options.sceneId), marker = markerIn(scene, options.markerId);
    if (options.note !== undefined) { const note = options.note.slice(0, MARKER_NOTE_MAX); if (note.length > 0) marker.note = note; else delete marker.note; }
    if (options.color !== undefined) marker.color = options.color === null ? 1 : typeof options.color === "string" ? options.color.toLowerCase() : options.color;
    if (options.durationSeconds !== undefined) {
      const duration = snapToFrame(clampMarkerDuration(options.durationSeconds, marker.time, sceneDurationOf(scene)), fpsOf(draft));
      if (duration > 0) marker.duration = duration; else delete marker.duration;
    }
  },
});
export const deleteMarker = (options: { sceneId: string; markerId: string }): TimelineCommand => ({
  type: "timeline.marker.delete", label: "Delete marker", sceneId: options.sceneId,
  run(draft) { const scene = sceneById(draft, options.sceneId); scene.markers = scene.markers.filter((marker) => marker.id !== options.markerId); },
});
/** "Delete all markers": one step; a scene with more than one marker asks first. */
export const deleteAllMarkers = (options: { sceneId: string }): TimelineCommand => ({
  type: "timeline.marker.delete-all", label: "Delete all markers", sceneId: options.sceneId,
  run(draft) { sceneById(draft, options.sceneId).markers = []; },
});
export const deleteAllMarkersNeedsConfirmation = (doc: ProjectDocument, sceneId: string): boolean => sceneById(doc, sceneId).markers.length > 1;
/** `marker.next` / `marker.previous`: the nearest marker strictly after or before the playhead; the playhead stays when there is none. */
export function markerSeek(doc: ProjectDocument, sceneId: string, playhead: number, direction: "next" | "previous"): number {
  const times = markersOf(sceneById(doc, sceneId)).map((marker) => marker.time);
  return (direction === "next" ? times.find((time) => time > playhead) : [...times].reverse().find((time) => time < playhead)) ?? playhead;
}
/** "Show marker notes": the notes of every marker whose range `[time, time + duration]` contains the current time (its own frame without a duration). */
export function activeMarkerNotes(doc: ProjectDocument, sceneId: string, time: number, enabled = true): string[] {
  if (!enabled) return [];
  const frame = snapToFrame(time, fpsOf(doc));
  return markersOf(sceneById(doc, sceneId)).filter((marker) => marker.note && (marker.duration ? marker.time <= time && time <= marker.time + marker.duration : marker.time === frame)).map((marker) => marker.note!);
}

// — In/out range —
/** `range.set-in` / `range.set-out` at the playhead: an in point at or after the out point clears the out point, and the reverse. */
export const setRangePoint = (options: { sceneId: string; point: "in" | "out"; time: number }): TimelineCommand => ({
  type: `range.set-${options.point}`, label: options.point === "in" ? "Set in point" : "Set out point", sceneId: options.sceneId,
  run(draft) {
    const scene = sceneById(draft, options.sceneId), time = snapToFrame(Math.max(0, options.time), fpsOf(draft));
    if (options.point === "in") { scene.inPoint = time; if (scene.outPoint !== undefined && time >= scene.outPoint) delete scene.outPoint; }
    else { scene.outPoint = time; if (scene.inPoint !== undefined && time <= scene.inPoint) delete scene.inPoint; }
  },
});
/** `range.set-to-selection`: in = the earliest start, out = the latest end of the selected elements. */
export const setRangeToSelection = (options: { sceneId: string; elementIds: string[] }): TimelineCommand => ({
  type: "range.set-to-selection", label: "Set range to selection", sceneId: options.sceneId,
  run(draft) {
    const scene = sceneById(draft, options.sceneId), picked = tracksOfScene(scene).flatMap((track) => track.elements).filter((element) => options.elementIds.includes(element.id));
    if (picked.length === 0) refuse(TIMELINE_MESSAGES.rangeNeedsSelection, "disabled");
    scene.inPoint = Math.min(...picked.map((element) => element.startTime)); scene.outPoint = Math.max(...picked.map(endOf));
  },
});
export const clearRange = (options: { sceneId: string }): TimelineCommand => ({
  type: "range.clear", label: "Clear range", sceneId: options.sceneId,
  run(draft) { const scene = sceneById(draft, options.sceneId); delete scene.inPoint; delete scene.outPoint; },
});
