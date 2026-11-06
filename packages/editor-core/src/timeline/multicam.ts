import { createElement, createTrack, TICKS_PER_SECOND, type ProjectDocument, type Rational } from "@jagentchill/protocol";
import { findAsset, type Json } from "../model.ts";
import { copyElement } from "../ops/shared.ts";
import { frameTicks, roundHalfAway, snapToFrame } from "../time.ts";
import type { TimelineCommand } from "./command.ts";
import { newScene, nextSceneName, placeReplacement, referencingScenes, SCENE_LIMIT } from "./compound.ts";
import { committedName } from "./track-commands.ts";
import { endOf, fpsOf, isFreeze, refuse, rejectDoc, sceneById, sceneDurationOf, TIMELINE_MESSAGES, tracksOfScene, type El, type Sc, type Tr } from "./model.ts";

type Angle = { id: string; name: string; trackId: string; syncOffset: number; syncConfidence?: number };
type Definition = { syncMethod: "audio" | "start" | "playhead"; angles: Angle[]; audioAngleId?: string; audioFollowsVideo: boolean };
const definitionOf = (scene: Sc): Definition => (scene.multicam as unknown as Definition | undefined) ?? rejectDoc("document/multicam-invalid", "", "the scene is not a multi-camera source");
const partsOf = (doc: ProjectDocument, sceneId: string): { scene: Sc; track: Tr; element: El }[] =>
  (doc.scenes as unknown as Sc[]).flatMap((scene) => tracksOfScene(scene).flatMap((track) => track.elements.filter((element) => element.type === "compound" && element.sceneId === sceneId).map((element) => ({ scene, track, element }))));
const angleOf = (part: El): string => String((part.multicam as Json | undefined)?.angleId);

/** The selection in angle order: track order from top to bottom, then start time. */
function orderedSelection(scene: Sc, elementIds: string[]): { track: Tr; element: El }[] {
  return tracksOfScene(scene).flatMap((track) => track.elements.filter((element) => elementIds.includes(element.id)).map((element) => ({ track, element })));
}
/** "Create multi-camera clip" is offered for 2–8 selected video elements of one scene, none a freeze, none linked. */
export function multicamAvailability(doc: ProjectDocument, sceneId: string, elementIds: string[]): { enabled: boolean; reason?: string; audioDefault: boolean } {
  const picked = orderedSelection(sceneById(doc, sceneId), elementIds).map((entry) => entry.element);
  const audioDefault = picked.every((element) => typeof element.mediaId === "string" && findAsset(doc, element.mediaId)?.hasAudio === true);
  if (picked.length < 2 || picked.length > 8 || picked.length !== elementIds.length || picked.some((element) => element.type !== "video" || isFreeze(element))) return { enabled: false, reason: TIMELINE_MESSAGES.multicamSelection, audioDefault };
  if (picked.some((element) => element.linkId !== null)) return { enabled: false, reason: TIMELINE_MESSAGES.multicamLinked, audioDefault };
  if (doc.scenes.length >= SCENE_LIMIT) return { enabled: false, reason: TIMELINE_MESSAGES.sceneLimit, audioDefault };
  return { enabled: true, audioDefault };
}

/**
 * The peak of the normalised cross-correlation (0–1) of two amplitude envelopes over offsets of ±`maxOffsetSeconds`,
 * and where the `candidate` clip sits against `reference` at that peak, in seconds (positive: the candidate clip is
 * placed later; a candidate whose recording holds the same event later in its file started earlier, so it is negative).
 * The envelopes are 8 kHz mono in the product; the analysis itself is the caller's (it decodes audio).
 */
export function correlateEnvelopes(reference: ArrayLike<number>, candidate: ArrayLike<number>, sampleRate = 8000, maxOffsetSeconds = 30, step = 1): { offsetSeconds: number; peak: number } {
  const maxLag = Math.round(maxOffsetSeconds * sampleRate);
  const energy = (data: ArrayLike<number>) => { let sum = 0; for (let index = 0; index < data.length; index += step) sum += data[index] * data[index]; return sum; };
  const norm = Math.sqrt(energy(reference) * energy(candidate));
  if (norm === 0) return { offsetSeconds: 0, peak: 0 };
  let best = { lag: 0, value: -Infinity };
  for (let lag = -maxLag; lag <= maxLag; lag += step) {
    let sum = 0;
    // The candidate clip placed `lag` samples after the reference.
    for (let index = Math.max(0, lag); index < reference.length && index - lag < candidate.length; index += step) sum += reference[index] * candidate[index - lag];
    if (sum > best.value || (sum === best.value && Math.abs(lag) < Math.abs(best.lag))) best = { lag, value: sum };
  }
  return { offsetSeconds: best.lag / sampleRate, peak: Math.max(0, Math.min(1, best.value / norm)) };
}
export const SYNC_CONFIDENCE_MIN = 0.6;
export type AngleSync = { elementId: string; offset: number; confidence?: number };
/**
 * The offsets of each clip relative to angle 1 for a sync method. `audio`: the correlation result per clip, rounded to
 * the frame grid; a clip whose peak is below 0.6 uses offset 0, records the peak, and is named in the warnings.
 */
export function syncOffsets(doc: ProjectDocument, sceneId: string, elementIds: string[], method: "audio" | "start" | "playhead", correlations: Record<string, { offsetSeconds: number; peak: number }> = {}): { angles: AngleSync[]; warnings: string[] } {
  const picked = orderedSelection(sceneById(doc, sceneId), elementIds).map((entry) => entry.element), fps = fpsOf(doc), warnings: string[] = [];
  const angles = picked.map((element, index): AngleSync => {
    if (method === "start") return { elementId: element.id, offset: 0 };
    if (method === "playhead") return { elementId: element.id, offset: element.startTime - picked[0].startTime };
    if (index === 0) return { elementId: element.id, offset: 0, confidence: 1 };
    const result = correlations[element.id] ?? { offsetSeconds: 0, peak: 0 }, confidence = Math.round(result.peak * 1000) / 1000;
    if (result.peak < SYNC_CONFIDENCE_MIN) { warnings.push(element.name); return { elementId: element.id, offset: 0, confidence }; }
    const ticks = roundHalfAway(result.offsetSeconds * TICKS_PER_SECOND);
    return { elementId: element.id, offset: snapToFrame(Math.abs(ticks), fps) * Math.sign(ticks), confidence };
  });
  return { angles, warnings };
}

/**
 * "Create multi-camera clip": a scene "Multicam N" with one overlay video track per angle holding that clip at scene
 * time `offset − min(offsets)`, an empty main track and no audio track; the selected clips are replaced by one
 * compound element on angle 1 spanning the scene.
 */
export const createMulticam = (options: { sceneId: string; angles: AngleSync[]; syncMethod: "audio" | "start" | "playhead"; name?: string }): TimelineCommand<{ sceneId: string; elementId: string }> => ({
  type: "timeline.multicam.create", label: "Create multi-camera clip", sceneId: options.sceneId,
  run(draft, env) {
    const ids = options.angles.map((angle) => angle.elementId), availability = multicamAvailability(draft, options.sceneId, ids);
    if (!availability.enabled) refuse(availability.reason!, "disabled");
    const parent = sceneById(draft, options.sceneId), picked = orderedSelection(parent, ids);
    if (picked.some((entry) => entry.track.locked)) refuse("The track is locked", "track-locked");
    const sync = new Map(options.angles.map((angle) => [angle.elementId, angle])), earliest = Math.min(...options.angles.map((angle) => angle.offset));
    const scene = newScene(draft, env, { name: options.name ?? nextSceneName(draft, "Multicam"), kind: "multicam" });
    const start = Math.min(...picked.map((entry) => entry.element.startTime)), moved = new Set(ids);
    const angles: Angle[] = picked.map(({ element }, index) => {
      const name = `Angle ${index + 1}`, track = createTrack("video", { id: env.newId(), name }) as unknown as Tr, entry = sync.get(element.id)!;
      Object.assign(element, { startTime: entry.offset - earliest, groupId: null, transitionIn: null, transitionOut: null });
      track.elements.push(element);
      scene.tracks.overlay.push(track);
      return { id: env.newId(), name, trackId: track.id, syncOffset: entry.offset, ...(entry.confidence !== undefined ? { syncConfidence: entry.confidence } : {}) };
    });
    for (const track of tracksOfScene(parent)) {
      track.elements = track.elements.filter((element) => !moved.has(element.id));
      track.transitions = track.transitions.filter((record) => !moved.has(String(record.fromElementId)) && !moved.has(String(record.toElementId)));
    }
    scene.multicam = { syncMethod: options.syncMethod, angles, audioAngleId: angles[0].id, audioFollowsVideo: false } as unknown as Json;
    (draft.scenes as unknown as Sc[]).push(scene);
    const duration = sceneDurationOf(scene);
    const element = createElement("compound", { id: env.newId(), name: scene.name, startTime: start, duration, sourceDuration: duration, sceneId: scene.id, multicam: { angleId: angles[0].id } }) as unknown as El;
    placeReplacement(parent, element, picked, env);
    return { selection: [element.id], info: { sceneId: scene.id, elementId: element.id } };
  },
});

/** The multi-camera part under a time on an unlocked track, preferring a selected one. */
export function multicamPartAt(doc: ProjectDocument, sceneId: string, time: number, selectedIds: string[] = []): { track: Tr; element: El } | undefined {
  const hits = tracksOfScene(sceneById(doc, sceneId)).filter((track) => !track.locked).flatMap((track) => track.elements.filter((element) => element.type === "compound" && element.multicam && element.startTime <= time && time < endOf(element)).map((element) => ({ track, element })));
  return hits.find((hit) => selectedIds.includes(hit.element.id)) ?? hits[0];
}
/** The angles a part offers (the mobile "Angle" strip, the context submenu, the keys 1–8) and its clip label "A{index} {name}". */
export function angleList(doc: ProjectDocument, part: { sceneId?: unknown; multicam?: unknown }): { id: string; index: number; name: string; active: boolean; label: string }[] {
  const scene = sceneById(doc, String(part.sceneId)), active = String((part.multicam as Json | undefined)?.angleId);
  return definitionOf(scene).angles.map((angle, at) => ({ id: angle.id, index: at + 1, name: angle.name, active: angle.id === active, label: `A${at + 1} ${angle.name}` }));
}
/**
 * Switches the angle of the part under the playhead: on the part's first frame its `angleId` is rewritten; anywhere
 * else the part is split there and the right-hand part takes the angle; the angle it already shows does nothing.
 * Adjacent parts on one angle with continuous source time are merged in the same step.
 */
export const switchAngle = (options: { sceneId: string; time: number; angle: number | string; selectedIds?: string[] }): TimelineCommand<{ elementId?: string }> => ({
  type: typeof options.angle === "number" ? `timeline.multicam.switch-angle-${options.angle}` : "timeline.multicam.switch-angle", label: "Switch angle", sceneId: options.sceneId,
  run(draft, env) {
    const time = snapToFrame(options.time, fpsOf(draft)), hit = multicamPartAt(draft, options.sceneId, time, options.selectedIds);
    if (!hit) return { info: {} };
    const { track, element: part } = hit, angles = definitionOf(sceneById(draft, String(part.sceneId))).angles;
    const angle = typeof options.angle === "number" ? angles[options.angle - 1] : angles.find((entry) => entry.id === options.angle);
    if (!angle || angle.id === angleOf(part)) return { info: {} };
    let shown = part;
    if (time <= part.startTime) part.multicam = { angleId: angle.id };
    else {
      const offset = time - part.startTime, rest = part.duration - offset;
      const right = copyElement(part as never, env.newId).element as unknown as El;
      Object.assign(right, { startTime: time, duration: rest, trimStart: part.trimStart + offset, multicam: { angleId: angle.id }, transitionIn: null, linkId: null });
      const record = track.transitions.find((entry) => entry.id === part.transitionOut);
      if (record) record.fromElementId = right.id;
      Object.assign(part, { duration: offset, trimEnd: part.trimEnd + rest, transitionOut: null });
      track.elements.push(right);
      shown = right;
    }
    track.elements.sort((a, b) => a.startTime - b.startTime);
    for (let index = track.elements.length - 1; index > 0; index--) {
      const a = track.elements[index - 1], b = track.elements[index];
      const same = a.type === "compound" && b.type === "compound" && a.multicam && b.multicam && a.sceneId === b.sceneId && angleOf(a) === angleOf(b);
      if (!same || endOf(a) !== b.startTime || a.trimStart + a.duration !== b.trimStart) continue;
      const record = track.transitions.find((entry) => entry.id === b.transitionOut);
      if (record) record.fromElementId = a.id;
      Object.assign(a, { duration: a.duration + b.duration, trimEnd: b.trimEnd, transitionOut: b.transitionOut ?? null });
      track.elements.splice(index, 1);
      if (shown === b) shown = a;
    }
    return { selection: [shown.id], info: { elementId: shown.id } };
  },
});

/** "Audio source" and "Audio follows video" are settings of the source: one change applies to every part that references it. */
export const setMulticamAudio = (options: { sceneId: string; audioAngleId?: string; audioFollowsVideo?: boolean }): TimelineCommand => ({
  type: "timeline.multicam.audio", label: "Multi-camera audio",
  run(draft) {
    const definition = definitionOf(sceneById(draft, options.sceneId));
    if (options.audioAngleId !== undefined) definition.audioAngleId = options.audioAngleId;
    if (options.audioFollowsVideo !== undefined) definition.audioFollowsVideo = options.audioFollowsVideo;
  },
});
/** The angle each part is heard from: its own with "Audio follows video", the audio angle otherwise. */
export function heardAngles(doc: ProjectDocument, sceneId: string): { elementId: string; angleId: string }[] {
  const definition = definitionOf(sceneById(doc, sceneId));
  return partsOf(doc, sceneId).sort((a, b) => a.element.startTime - b.element.startTime).map(({ element }) => ({ elementId: element.id, angleId: definition.audioFollowsVideo ? angleOf(element) : definition.audioAngleId ?? definition.angles[0].id }));
}

// — Editing the source —
/** Slides an angle's clip to correct sync; the same command adds the delta to that angle's `syncOffset`. */
export const slideAngle = (options: { sceneId: string; angleId: string; delta: number }): TimelineCommand => ({
  type: "timeline.multicam.slide-angle", label: "Sync angle", sceneId: options.sceneId,
  run(draft) {
    const scene = sceneById(draft, options.sceneId), definition = definitionOf(scene), angle = definition.angles.find((entry) => entry.id === options.angleId) ?? rejectDoc("document/unknown-reference", "", "the angle does not exist");
    const track = scene.tracks.overlay.find((entry) => entry.id === angle.trackId)!, fps = fpsOf(draft);
    const delta = Math.max(-Math.min(...track.elements.map((element) => element.startTime)), snapToFrame(Math.abs(options.delta), fps) * Math.sign(options.delta));
    for (const element of track.elements) element.startTime += delta;
    angle.syncOffset += delta;
  },
});
export const renameAngle = (options: { sceneId: string; angleId: string; name: string }): TimelineCommand => ({
  type: "timeline.multicam.rename-angle", label: "Rename angle", sceneId: options.sceneId,
  run(draft) {
    const scene = sceneById(draft, options.sceneId), name = committedName(options.name, 80), angle = definitionOf(scene).angles.find((entry) => entry.id === options.angleId);
    if (name === null || !angle) return;
    angle.name = name;
    const track = scene.tracks.overlay.find((entry) => entry.id === angle.trackId);
    if (track) track.name = name;
  },
});
/** Angle order is array order. */
export const reorderAngle = (options: { sceneId: string; angleId: string; toIndex: number }): TimelineCommand => ({
  type: "timeline.multicam.reorder-angle", label: "Reorder angles", sceneId: options.sceneId,
  run(draft) {
    const angles = definitionOf(sceneById(draft, options.sceneId)).angles, from = angles.findIndex((entry) => entry.id === options.angleId);
    if (from < 0) return;
    const [angle] = angles.splice(from, 1);
    angles.splice(Math.max(0, Math.min(angles.length, options.toIndex)), 0, angle);
  },
});
/** "Add angle" from the media library while fewer than 8 exist: a new video track and angle, placed by the scene's sync method. */
export const addAngle = (options: { sceneId: string; assetId: string; offset?: number; confidence?: number }): TimelineCommand<{ angleId: string }> => ({
  type: "timeline.multicam.add-angle", label: "Add angle", sceneId: options.sceneId,
  run(draft, env) {
    const scene = sceneById(draft, options.sceneId), definition = definitionOf(scene), fps = fpsOf(draft);
    if (definition.angles.length >= 8) refuse("A multi-camera source holds at most 8 angles", "disabled");
    const asset = findAsset(draft, options.assetId);
    if (!asset || asset.type !== "video") return rejectDoc("document/unknown-asset", "", `asset "${options.assetId}" is not a video`);
    const source = asset.duration ?? frameTicks(fps), duration = Math.max(frameTicks(fps), snapToFrame(source, fps) > source ? snapToFrame(source, fps) - frameTicks(fps) : snapToFrame(source, fps));
    const name = `Angle ${definition.angles.length + 1}`, track = createTrack("video", { id: env.newId(), name }) as unknown as Tr;
    // Angle 1 sits at `−min(offsets)`, so a new angle's scene time is its offset from there.
    const base = Math.min(...(tracksOfScene(scene).find((entry) => entry.id === definition.angles[0].trackId)?.elements.map((element) => element.startTime) ?? [0])) - definition.angles[0].syncOffset;
    const offset = definition.syncMethod === "start" ? 0 : options.offset ?? 0, startTime = Math.max(0, snapToFrame(Math.max(0, base + offset), fps));
    track.elements.push(createElement("video", { id: env.newId(), name: asset.name, startTime, duration, sourceDuration: source, trimEnd: Math.max(0, source - duration), mediaId: asset.id }) as unknown as El);
    scene.tracks.overlay.push(track);
    const angle: Angle = { id: env.newId(), name, trackId: track.id, syncOffset: offset, ...(options.confidence !== undefined ? { syncConfidence: options.confidence } : {}) };
    definition.angles.push(angle);
    refreshParts(draft, scene);
    return { info: { angleId: angle.id } };
  },
});
/** "Remove angle": refused while any part shows it or it is the audio angle. */
export const removeAngle = (options: { sceneId: string; angleId: string }): TimelineCommand => ({
  type: "timeline.multicam.remove-angle", label: "Remove angle", sceneId: options.sceneId,
  run(draft) {
    const scene = sceneById(draft, options.sceneId), definition = definitionOf(scene), angle = definition.angles.find((entry) => entry.id === options.angleId);
    if (!angle) return;
    const users = partsOf(draft, scene.id).filter((part) => angleOf(part.element) === angle.id).length;
    if (users > 0 || definition.audioAngleId === angle.id) refuse(`This angle is used by ${users} clips`, "angle-in-use");
    if (definition.angles.length <= 2) refuse("A multi-camera source keeps at least 2 angles", "disabled");
    definition.angles = definition.angles.filter((entry) => entry !== angle);
    scene.tracks.overlay = scene.tracks.overlay.filter((track) => track.id !== angle.trackId);
  },
});
/** A compound element's `sourceDuration` follows its scene's duration. */
function refreshParts(draft: ProjectDocument, scene: Sc): void {
  const duration = sceneDurationOf(scene);
  for (const { element } of partsOf(draft, scene.id)) if (typeof element.sourceDuration === "number" && element.sourceDuration < duration) { element.trimEnd += duration - element.sourceDuration; element.sourceDuration = duration; }
}

/** "Flatten" keeps the sound only when "Audio follows video" is on or every selected part shows the audio angle. */
export function flattenAvailability(doc: ProjectDocument, sceneId: string, elementIds: string[]): { enabled: boolean; reason?: string } {
  const parts = tracksOfScene(sceneById(doc, sceneId)).flatMap((track) => track.elements).filter((element) => elementIds.includes(element.id) && element.type === "compound" && element.multicam);
  if (parts.length === 0) return { enabled: false };
  const sameSound = parts.every((part) => { const definition = definitionOf(sceneById(doc, String(part.sceneId))); return definition.audioFollowsVideo || angleOf(part) === (definition.audioAngleId ?? definition.angles[0].id); });
  return sameSound ? { enabled: true } : { enabled: false, reason: TIMELINE_MESSAGES.multicamFlatten };
}
const PART_FIELDS = ["transform", "opacity", "blendMode", "flip", "effects", "masks", "volume", "muted", "pan", "fadeIn", "fadeOut", "hidden"];
/**
 * "Flatten multi-camera clip": each selected part becomes copies of its active angle's clips restricted to the part's
 * range, at the same times on the same track, with the part's transform, opacity, effects, masks and audio fields.
 * A source no part references any more is deleted.
 */
export const flattenMulticam = (options: { sceneId: string; elementIds: string[] }): TimelineCommand<{ elementIds: string[] }> => ({
  type: "timeline.multicam.flatten", label: "Flatten multi-camera clip", sceneId: options.sceneId,
  run(draft, env) {
    const availability = flattenAvailability(draft, options.sceneId, options.elementIds);
    if (!availability.enabled) refuse(availability.reason ?? "Select a multi-camera clip", "disabled");
    const parent = sceneById(draft, options.sceneId), fps: Rational = fpsOf(draft), made: string[] = [], sources = new Set<string>();
    for (const track of tracksOfScene(parent)) {
      for (const part of track.elements.filter((element) => options.elementIds.includes(element.id) && element.type === "compound" && element.multicam)) {
        if (track.locked) refuse("The track is locked", "track-locked");
        const source = sceneById(draft, String(part.sceneId)), angle = definitionOf(source).angles.find((entry) => entry.id === angleOf(part))!;
        const from = part.trimStart, to = part.trimStart + part.duration;
        track.elements = track.elements.filter((element) => element !== part);
        track.transitions = track.transitions.filter((record) => record.fromElementId !== part.id && record.toElementId !== part.id);
        for (const clip of source.tracks.overlay.find((entry) => entry.id === angle.trackId)?.elements ?? []) {
          const a = Math.max(from, clip.startTime), b = Math.min(to, endOf(clip));
          if (b - a < frameTicks(fps)) continue;
          const piece = copyElement(clip as never, env.newId).element as unknown as El;
          Object.assign(piece, { startTime: part.startTime + (a - from), duration: b - a, trimStart: clip.trimStart + (a - clip.startTime), trimEnd: clip.trimEnd + (endOf(clip) - b), groupId: part.groupId, linkId: null, transitionIn: null, transitionOut: null });
          for (const field of PART_FIELDS) if (field in part && field in piece) piece[field] = JSON.parse(JSON.stringify(part[field]));
          // One part may become several pieces, so the copied effect and mask entries get ids of their own.
          for (const key of ["effects", "masks"]) for (const entry of (piece[key] as Json[] | undefined) ?? []) entry.id = env.newId();
          if (part.background !== undefined) piece.background = part.background;
          track.elements.push(piece);
          made.push(piece.id);
        }
        sources.add(source.id);
      }
    }
    for (const id of sources) if (referencingScenes(draft, id).length === 0) draft.scenes = draft.scenes.filter((scene) => scene.id !== id);
    return { selection: made, info: { elementIds: made } };
  },
});
