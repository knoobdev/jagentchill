import { createElement, createTrack, tracksOf, type ProjectDocument, type Scene, type TimelineElement, type Track, type TrackType } from "@jagentchill/protocol";
import { setLocal } from "../commit.ts";
import { findScene, isObject, sceneDuration, type Json } from "../model.ts";
import { snapToFrame } from "../time.ts";
import { copyElement, edit, editable, elementIn, reject, sortElements, trackIn, type Commit, type CommitContext } from "./shared.ts";

const sceneIn = (draft: ProjectDocument, id: string): Scene => findScene(draft, id) ?? reject("document/unknown-scene", "", `scene "${id}" does not exist`);

/** Adds a track with every field of its type written out. `before` names the track it goes above (absent: the end). */
export function addTrack(doc: ProjectDocument, ctx: CommitContext, sceneId: string, type: TrackType, options: { name?: string; before?: string } = {}): Commit & { trackId: string } {
  const trackId = ctx.newId();
  const commit = edit(doc, ctx, { commandType: "track.add", label: "Add track" }, (draft) => {
    const scene = sceneIn(draft, sceneId);
    const zone = (type === "audio" ? scene.tracks.audio : scene.tracks.overlay) as Track[];
    // Rejected as a whole, with the owner's message, before anything changes.
    if (zone.length >= 99) reject("document/limit-exceeded", `/scenes/@${sceneId}/tracks/${type === "audio" ? "audio" : "overlay"}`, "Track limit reached (99)", { limit: type === "audio" ? "audioTracksPerScene" : "overlayTracksPerScene", value: 99 });
    const track = createTrack(type, { id: trackId, name: options.name ?? `${type[0].toUpperCase()}${type.slice(1)} track`, ...(type === "caption" ? { caption: { style: {} } } : {}) });
    const index = options.before ? zone.findIndex((entry) => entry.id === options.before) : -1;
    if (index >= 0) zone.splice(index, 0, track); else zone.push(track);
  });
  return { ...commit, trackId };
}

/** Reorders a track inside its zone: above `before`, or to the end. */
export function moveTrack(doc: ProjectDocument, ctx: CommitContext, trackId: string, before?: string): Commit {
  return edit(doc, ctx, { commandType: "track.reorder", label: "Reorder tracks" }, (draft) => {
    const ref = trackIn(draft, trackId);
    const zone = ref.scene.tracks[ref.zone as "overlay" | "audio"] as Track[];
    zone.splice(zone.indexOf(ref.track), 1);
    const index = before ? zone.findIndex((entry) => entry.id === before) : -1;
    if (index >= 0) zone.splice(index, 0, ref.track); else zone.push(ref.track);
  });
}

/** Solo is stored and synced; toggling it emits a state patch and creates no undo step. */
export const toggleSolo = (doc: ProjectDocument, ctx: CommitContext, trackId: string): Commit =>
  edit(doc, ctx, { commandType: "track.solo", label: "Solo", history: false }, (draft) => {
    const track = trackIn(draft, trackId).track as unknown as Json;
    track.solo = !track.solo;
  });

/** Scene order is the order of `scenes[]`; there is no `order` field. */
export function moveScene(doc: ProjectDocument, ctx: CommitContext, sceneId: string, toIndex: number): Commit {
  return edit(doc, ctx, { commandType: "scene.reorder", label: "Reorder scenes" }, (draft) => {
    const from = draft.scenes.findIndex((scene) => scene.id === sceneId);
    const [scene] = draft.scenes.splice(from, 1);
    draft.scenes.splice(toIndex, 0, scene);
  });
}
/** Switching scene is per device: only `local.currentSceneId` changes and no patch is emitted. */
export const switchScene = (doc: ProjectDocument, sceneId: string): ProjectDocument => setLocal(doc, (local) => { local.currentSceneId = sceneId; });

/** Toggles a marker on the frame at `time`: adds one at its sorted position, or removes the one that is there. */
export function toggleMarker(doc: ProjectDocument, ctx: CommitContext, sceneId: string, time: number, fields: { note?: string; color?: number | string } = {}): Commit {
  return edit(doc, ctx, { commandType: "marker.toggle", label: "Marker" }, (draft) => {
    const scene = sceneIn(draft, sceneId);
    const at = snapToFrame(time, draft.settings.fps);
    const existing = scene.markers.findIndex((marker) => marker.time === at);
    if (existing >= 0) { scene.markers.splice(existing, 1); return; }
    if (scene.markers.length >= 1000) reject("document/limit-exceeded", `/scenes/@${sceneId}/markers`, "a scene holds at most 1 000 markers", { limit: "markersPerScene", value: 1000 });
    scene.markers.push({ id: ctx.newId(), time: at, color: 1, ...fields } as never);
    scene.markers.sort((a, b) => a.time - b.time);
  });
}

function join(draft: ProjectDocument, fromId: string, toId: string) {
  const from = elementIn(draft, fromId), to = elementIn(draft, toId);
  if (from.track !== to.track) reject("document/transition-not-adjacent", from.elementPath, "the two elements are on one track");
  return { track: from.track, from: editable(from), to: editable(to) };
}
/** Applies a picture transition to the cut between two adjacent clips of a video track. */
export function addTransition(doc: ProjectDocument, ctx: CommitContext, fromId: string, toId: string, type: string, options: { duration?: number; params?: Record<string, number | boolean | string> } = {}): Commit & { transitionId: string } {
  const transitionId = ctx.newId();
  const commit = edit(doc, ctx, { commandType: "transition.add", label: "Add transition" }, (draft) => {
    const { track, from, to } = join(draft, fromId, toId);
    (track.transitions as unknown[]).push({ id: transitionId, kind: "transition", fromElementId: fromId, toElementId: toId, duration: options.duration ?? 60_000, type, params: options.params ?? {}, easing: "ease-in-out", audioCrossfade: true, shape: "equal-power" });
    from.transitionOut = transitionId;
    to.transitionIn = transitionId;
  });
  return { ...commit, transitionId };
}
/** Adds an audio crossfade between two adjacent audio clips: a record with a duration and a shape only. */
export function addCrossfade(doc: ProjectDocument, ctx: CommitContext, fromId: string, toId: string, options: { duration?: number; shape?: string } = {}): Commit & { transitionId: string } {
  const transitionId = ctx.newId();
  const commit = edit(doc, ctx, { commandType: "crossfade.add", label: "Add crossfade" }, (draft) => {
    const { track, from, to } = join(draft, fromId, toId);
    (track.transitions as unknown[]).push({ id: transitionId, kind: "crossfade", fromElementId: fromId, toElementId: toId, duration: options.duration ?? 60_000, shape: options.shape ?? "equal-power" });
    from.transitionOut = transitionId;
    to.transitionIn = transitionId;
    // The ends under the crossfade carry no fade of their own.
    if (isObject(from.fadeOut)) from.fadeOut.duration = 0;
    if (isObject(to.fadeIn)) to.fadeIn.duration = 0;
  });
  return { ...commit, transitionId };
}

export type AngleSource = { elementId: string; syncOffset: number; syncConfidence?: number; name?: string };
/**
 * "Create multi-camera clip": the clips become the angle tracks of a new `multicam` scene, each shifted by the offset
 * its sync method found, and one compound element on angle 1 takes their place.
 */
export function createMulticam(doc: ProjectDocument, ctx: CommitContext, sources: AngleSource[], syncMethod: "audio" | "start" | "playhead", name = "Multi-camera clip"): Commit & { sceneId: string } {
  const sceneId = ctx.newId();
  const commit = edit(doc, ctx, { commandType: "multicam.create", label: "Create multi-camera clip" }, (draft) => {
    const refs = sources.map((source) => elementIn(draft, source.elementId));
    const parent = refs[0].scene, start = Math.min(...refs.map((ref) => ref.element.startTime));
    const earliest = Math.min(...sources.map((source) => source.syncOffset));
    const angles = sources.map((source, index) => {
      const ref = refs[index], track = createTrack("video", { id: ctx.newId(), name: source.name ?? `Angle ${index + 1}` });
      (ref.track.elements as unknown[]).splice((ref.track.elements as unknown[]).indexOf(ref.element), 1);
      const element = ref.element as unknown as Json;
      // The offset is recorded exactly; the clip itself sits on the frame grid.
      Object.assign(element, { startTime: snapToFrame(source.syncOffset - earliest, draft.settings.fps), transitionIn: null, transitionOut: null, groupId: null, linkId: null });
      (track.elements as unknown[]).push(element);
      return { track, angle: { id: ctx.newId(), name: source.name ?? `Angle ${index + 1}`, trackId: track.id, syncOffset: source.syncOffset, ...(source.syncConfidence !== undefined ? { syncConfidence: source.syncConfidence } : {}) } };
    });
    for (const track of tracksOf(parent)) (track as unknown as Json).transitions = (track.transitions as unknown as Json[]).filter((record) => !sources.some((source) => source.elementId === record.fromElementId || source.elementId === record.toElementId));
    const scene = {
      id: sceneId, name, isMain: false, kind: "multicam", compoundBackground: "none",
      tracks: { overlay: angles.map((entry) => entry.track), main: createTrack("video", { id: ctx.newId(), name: "Main" }), audio: [] },
      markers: [], multicam: { syncMethod, angles: angles.map((entry) => entry.angle), audioAngleId: angles[0].angle.id, audioFollowsVideo: false },
      created_ms: ctx.now_ms, updated_ms: ctx.now_ms,
    } as unknown as Scene;
    draft.scenes.push(scene);
    const duration = sceneDuration(scene);
    const host = refs[0].track;
    (host.elements as unknown[]).push(createElement("compound", { id: ctx.newId(), name, startTime: start, duration, sourceDuration: duration, sceneId, multicam: { angleId: angles[0].angle.id } }));
    sortElements(host);
  });
  return { ...commit, sceneId };
}

/**
 * Switches the angle at a scene time: on a part's first frame the part's angle is rewritten; elsewhere the part is
 * split there and the right-hand part takes the angle. Adjacent parts on one angle with continuous source are merged.
 */
export function switchAngle(doc: ProjectDocument, ctx: CommitContext, elementId: string, time: number, angleId: string): Commit {
  return edit(doc, ctx, { commandType: "multicam.switch", label: "Switch angle" }, (draft) => {
    const ref = elementIn(draft, elementId);
    const part = editable(ref), start = part.startTime as number, duration = part.duration as number;
    if (time <= start) (part.multicam as Json).angleId = angleId;
    else if (time < start + duration) {
      const { element: right } = copyElement(ref.element, ctx.newId);
      const offset = time - start;
      Object.assign(right, { startTime: time, duration: duration - offset, trimStart: (part.trimStart as number) + offset, multicam: { angleId }, transitionIn: null });
      Object.assign(part, { duration: offset, trimEnd: (part.trimEnd as number) + (duration - offset), transitionOut: null });
      (ref.track.elements as unknown[]).push(right);
      sortElements(ref.track);
    }
    const parts = (ref.track.elements as TimelineElement[]) as unknown as Json[];
    for (let index = parts.length - 1; index > 0; index--) {
      const a = parts[index - 1], b = parts[index];
      const same = a.type === "compound" && b.type === "compound" && a.sceneId === b.sceneId && (a.multicam as Json | undefined)?.angleId === (b.multicam as Json | undefined)?.angleId && isObject(a.multicam);
      if (!same || (a.startTime as number) + (a.duration as number) !== b.startTime || (a.trimStart as number) + (a.duration as number) !== b.trimStart) continue;
      Object.assign(a, { duration: (a.duration as number) + (b.duration as number), trimEnd: b.trimEnd, transitionOut: b.transitionOut ?? null });
      parts.splice(index, 1);
    }
  });
}
/** The audio rule is one setting of the multi-camera source: one patch on the scene, none on the parts. */
export const setAudioFollowsVideo = (doc: ProjectDocument, ctx: CommitContext, sceneId: string, value: boolean): Commit =>
  edit(doc, ctx, { commandType: "multicam.audio", label: "Multi-camera audio" }, (draft) => {
    ((sceneIn(draft, sceneId) as unknown as Json).multicam as Json).audioFollowsVideo = value;
  });
/** Which angle a multi-camera part is heard from. */
export function audioAngleOf(scene: Scene, part: { multicam?: { angleId: string } }): string | undefined {
  const multicam = scene.multicam;
  if (!multicam) return undefined;
  return multicam.audioFollowsVideo ? part.multicam?.angleId : multicam.audioAngleId ?? multicam.angles[0]?.id;
}
