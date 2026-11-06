import { createElement, createTrack, type ProjectDocument } from "@jagentchill/protocol";
import { frameTicks } from "../time.ts";
import type { CommandEnv, TimelineCommand } from "./command.ts";
import {
  canHold, createTrackAt, endOf, fpsOf, isFree, isVisual, MAIN_TRACK_NAME, overlaps, refuse, rejectDoc, sceneById, sceneDurationOf, TIMELINE_MESSAGES, tracksOfScene, withPartners, zoneOfTrack,
  type El, type Sc, type Tr,
} from "./model.ts";
import { copySet } from "./copies.ts";
import { placeElements } from "./placement.ts";

export const SCENE_LIMIT = 200;
export const COMPOUND_DEPTH_LIMIT = 8;
const scenesOf = (doc: ProjectDocument): Sc[] => doc.scenes as unknown as Sc[];
/** "Compound N", "Scene N", "Multicam N": N is the next unused integer of that name. */
export function nextSceneName(doc: ProjectDocument, prefix: string): string {
  const used = new Set(scenesOf(doc).map((scene) => new RegExp(`^${prefix} (\\d+)$`).exec(scene.name)?.[1]).filter((n): n is string => n !== undefined).map(Number));
  // "Scene N" counts the scenes that exist: with "Main scene" and "Scene 2" the next one is "Scene 3".
  let n = prefix === "Scene" ? scenesOf(doc).length + 1 : 1;
  while (used.has(n)) n++;
  return `${prefix} ${n}`;
}
export function newScene(draft: ProjectDocument, env: Pick<CommandEnv, "newId" | "ctx">, fields: { name: string; kind: "timeline" | "compound" | "multicam"; id?: string }): Sc {
  if (draft.scenes.length >= SCENE_LIMIT) rejectDoc("document/limit-exceeded", "/scenes", TIMELINE_MESSAGES.sceneLimit, { limit: "scenesPerProject", value: SCENE_LIMIT });
  return {
    id: fields.id ?? env.newId(), name: fields.name, isMain: false, kind: fields.kind, compoundBackground: "none",
    tracks: { overlay: [], main: createTrack("video", { id: env.newId(), name: MAIN_TRACK_NAME }) as unknown as Tr, audio: [] }, markers: [], created_ms: env.ctx.now_ms, updated_ms: env.ctx.now_ms,
  } as Sc;
}

/** The scenes a scene reaches through compound elements, and how deep the nesting goes below it. */
function compoundEdges(doc: ProjectDocument): Map<string, Set<string>> {
  const edges = new Map<string, Set<string>>();
  for (const scene of scenesOf(doc)) for (const track of tracksOfScene(scene)) for (const element of track.elements) {
    if (element.type === "compound") edges.set(scene.id, (edges.get(scene.id) ?? new Set()).add(String(element.sceneId)));
  }
  return edges;
}
/** Refuses a document in which a compound clip reaches its own scene, or nesting exceeds 8 levels — with the user's message. */
export function assertCompoundGraph(doc: ProjectDocument): void {
  const edges = compoundEdges(doc), depth = new Map<string, number>(), walking = new Set<string>();
  const main = scenesOf(doc).find((scene) => scene.isMain)?.id;
  const visit = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (walking.has(id)) refuse(TIMELINE_MESSAGES.compoundCycle, "compound-cycle");
    walking.add(id);
    let deepest = 0;
    for (const next of edges.get(id) ?? []) { if (next === main) refuse(TIMELINE_MESSAGES.compoundCycle, "compound-cycle"); deepest = Math.max(deepest, 1 + visit(next)); }
    walking.delete(id);
    depth.set(id, deepest);
    return deepest;
  };
  for (const scene of scenesOf(doc)) if (visit(scene.id) > COMPOUND_DEPTH_LIMIT) refuse(TIMELINE_MESSAGES.compoundDepth, "compound-depth");
}
/** The scenes that hold a compound element referencing `sceneId`. */
export const referencingScenes = (doc: ProjectDocument, sceneId: string): Sc[] =>
  scenesOf(doc).filter((scene) => tracksOfScene(scene).some((track) => track.elements.some((element) => element.type === "compound" && element.sceneId === sceneId)));

type Picked = { track: Tr; element: El };
const pick = (scene: Sc, ids: string[]): Picked[] => {
  const wanted = new Set(withPartners(scene, ids));
  return tracksOfScene(scene).flatMap((track) => track.elements.filter((element) => wanted.has(element.id)).map((element) => ({ track, element })));
};
/** Whether "Create compound clip" is offered, and the tooltip when it is not. */
export function compoundAvailability(doc: ProjectDocument, sceneId: string, elementIds: string[]): { enabled: boolean; reason?: string } {
  const scene = sceneById(doc, sceneId), picked = pick(scene, elementIds);
  if (picked.length === 0) return { enabled: false };
  if (doc.scenes.length >= SCENE_LIMIT) return { enabled: false, reason: TIMELINE_MESSAGES.sceneLimit };
  if (scene.kind === "multicam") return { enabled: false, reason: TIMELINE_MESSAGES.multicamSource };
  if (picked.some((entry) => entry.track.locked)) return { enabled: false };
  const onMain = picked.filter((entry) => entry.track === scene.tracks.main).map((entry) => entry.element.id);
  if (onMain.length > 0) {
    const order = scene.tracks.main.elements.map((element) => element.id), first = order.indexOf(onMain[0]), last = order.indexOf(onMain[onMain.length - 1]);
    if (order.slice(first, last + 1).some((id) => !onMain.includes(id))) return { enabled: false, reason: TIMELINE_MESSAGES.compoundAdjacent };
  }
  return { enabled: true };
}

/** Where the element that replaces a selection goes: the main track, the topmost visual element's track when it can take it, or a new overlay video track. */
export function placeReplacement(scene: Sc, replacement: El, picked: Picked[], env: CommandEnv): void {
  const main = scene.tracks.main;
  if (picked.some((entry) => entry.track === main)) {
    // The replacement never overlaps an unselected clip: what follows makes room.
    const push = Math.max(0, ...main.elements.filter((clip) => clip.startTime >= replacement.startTime).map((clip) => endOf(replacement) - clip.startTime));
    if (main.elements.some((clip) => clip.startTime < replacement.startTime && endOf(clip) > replacement.startTime)) rejectDoc("document/elements-overlap", "", "the compound element would overlap a main-track clip");
    for (const clip of main.elements) if (clip.startTime >= replacement.startTime) clip.startTime += push;
    main.elements.push(replacement);
    return;
  }
  const top = picked.find((entry) => isVisual(entry.element));
  if (!top) { createTrackAt(scene, "video", scene.tracks.overlay.length, env.newId).elements.push(replacement); return; }
  const free = top.track.type === "video" && top.track.elements.every((other) => !overlaps(replacement.startTime, endOf(replacement), other.startTime, endOf(other)));
  if (free) { top.track.elements.push(replacement); return; }
  const index = scene.tracks.overlay.indexOf(top.track);
  createTrackAt(scene, "video", index < 0 ? scene.tracks.overlay.length : index, env.newId).elements.push(replacement);
}

/**
 * "Create compound clip": the selected elements move into a new scene "Compound N" with their relative times (the
 * earliest start becomes tick 0) and one compound element spanning their range takes their place.
 */
export const createCompound = (options: { sceneId: string; elementIds: string[]; name?: string }): TimelineCommand<{ sceneId: string; elementId: string }> => ({
  type: "timeline.compound.create", label: "Create compound clip", sceneId: options.sceneId,
  run(draft, env) {
    const availability = compoundAvailability(draft, options.sceneId, options.elementIds);
    if (!availability.enabled) refuse(availability.reason ?? "Select clips to combine", "disabled");
    const parent = sceneById(draft, options.sceneId), picked = pick(parent, options.elementIds), moved = new Set(picked.map((entry) => entry.element.id));
    const start = Math.min(...picked.map((entry) => entry.element.startTime)), end = Math.max(...picked.map((entry) => endOf(entry.element)));
    const scene = newScene(draft, env, { name: options.name ?? nextSceneName(draft, "Compound"), kind: "compound" });
    // Zone by zone, in the same relative order; a transition whose two clips both moved goes with them.
    for (const track of tracksOfScene(parent)) {
      const taken = track.elements.filter((element) => moved.has(element.id));
      if (taken.length === 0) continue;
      const records = track.transitions.filter((record) => moved.has(String(record.fromElementId)) && moved.has(String(record.toElementId)));
      track.transitions = track.transitions.filter((record) => !moved.has(String(record.fromElementId)) && !moved.has(String(record.toElementId)));
      track.elements = track.elements.filter((element) => !moved.has(element.id));
      const kept = new Set(records.map((record) => record.id));
      for (const element of taken) {
        element.startTime -= start;
        if ("transitionIn" in element && !kept.has(element.transitionIn)) element.transitionIn = null;
        if ("transitionOut" in element && !kept.has(element.transitionOut)) element.transitionOut = null;
      }
      const zone = zoneOfTrack(parent, track);
      const target = zone === "main" ? scene.tracks.main : (() => {
        const created = createTrack(track.type, { id: env.newId(), name: track.name, ...(track.type === "caption" ? { caption: track.caption } : {}) }) as unknown as Tr;
        scene.tracks[zone].push(created);
        return created;
      })();
      target.elements.push(...taken); target.transitions.push(...records);
    }
    (draft.scenes as unknown as Sc[]).push(scene);
    const duration = Math.max(end - start, frameTicks(fpsOf(draft)));
    const element = createElement("compound", { id: env.newId(), name: scene.name, startTime: start, duration, sourceDuration: sceneDurationOf(scene), sceneId: scene.id }) as unknown as El;
    placeReplacement(parent, element, picked, env);
    assertCompoundGraph(draft);
    return { selection: [element.id], info: { sceneId: scene.id, elementId: element.id } };
  },
});

/** "Keep this clip's background": the compound scene presents its own canvas background. One undo step. */
export const setCompoundBackground = (options: { sceneId: string; value: "none" | "own" }): TimelineCommand => ({
  type: "timeline.compound.background", label: "Compound background",
  run(draft) { sceneById(draft, options.sceneId).compoundBackground = options.value; },
});

/**
 * "Undo compound" (dissolve): the compound element is replaced by copies of the scene's elements at their mapped
 * times, each on a compatible free track; the scene is deleted when no other compound element references it.
 */
export const dissolveCompound = (options: { sceneId: string; elementId: string }): TimelineCommand<{ elementIds: string[] }> => ({
  type: "timeline.compound.dissolve", label: "Undo compound", sceneId: options.sceneId,
  run(draft, env) {
    const parent = sceneById(draft, options.sceneId);
    const host = tracksOfScene(parent).find((track) => track.elements.some((element) => element.id === options.elementId)) ?? rejectDoc("document/unknown-reference", "", `element "${options.elementId}" does not exist`);
    const compound = host.elements.find((element) => element.id === options.elementId)!;
    if (compound.type !== "compound" || compound.multicam) refuse("Select a compound clip", "disabled");
    if (host.locked) refuse("The track is locked", "track-locked");
    const source = sceneById(draft, String(compound.sceneId)), offset = compound.startTime - compound.trimStart;
    host.elements = host.elements.filter((element) => element !== compound);
    host.transitions = host.transitions.filter((record) => record.fromElementId !== compound.id && record.toElementId !== compound.id);
    // The last reference takes the scene's own elements; another reference still needs them, so it gets copies.
    const last = referencingScenes(draft, source.id).length === 0;
    const copies = last ? null : copySet(tracksOfScene(source).flatMap((track) => track.elements), env.newId);
    const free = { ...env, edit: { ...env.edit, magnet: false, freeLayer: true } };
    const restored: string[] = [];
    // The main-track row first: it returns to the compound's own track before any other row can take its place.
    for (const track of [source.tracks.main, ...source.tracks.overlay, ...source.tracks.audio]) {
      if (track.elements.length === 0) continue;
      const elements = track.elements.map((element) => copies?.get(element.id) ?? element);
      for (const element of elements) element.startTime += offset;
      // What came from the main track returns to the compound's own track when it fits; other rows find a free compatible track.
      const fitsHost = zoneOfTrack(source, track) === "main" && canHold(host, elements[0].type) && elements.every((element) => isFree(host, element.startTime, endOf(element)));
      const target = fitsHost ? host : undefined;
      if (target) target.elements.push(...elements);
      const placed = target ?? placeElements(parent, elements, { strategy: "firstAvailable" }, free).track;
      if (last) placed.transitions.push(...track.transitions);
      restored.push(...elements.map((element) => element.id));
    }
    if (last) draft.scenes = draft.scenes.filter((scene) => scene.id !== source.id);
    return { selection: restored, info: { elementIds: restored } };
  },
});

// — Entering and leaving a compound or multi-camera scene: device-local navigation, never an undo step —
export type SceneFrame = { sceneId: string; elementId: string };
/** The breadcrumb "Main scene › Compound N": the scenes entered, outermost first. */
export function breadcrumb(doc: ProjectDocument, rootSceneId: string, stack: SceneFrame[]): { sceneId: string; name: string }[] {
  const name = (id: string) => scenesOf(doc).find((scene) => scene.id === id)?.name ?? "";
  const crumbs = [{ sceneId: rootSceneId, name: name(rootSceneId) }];
  for (const frame of stack) { const element = scenesOf(doc).flatMap((scene) => tracksOfScene(scene)).flatMap((track) => track.elements).find((entry) => entry.id === frame.elementId); crumbs.push({ sceneId: String(element?.sceneId), name: name(String(element?.sceneId)) }); }
  return crumbs;
}
/** Entering: the scene to show and its playhead — the parent playhead mapped through the compound element. */
export function enterCompound(doc: ProjectDocument, parentSceneId: string, elementId: string, parentPlayhead: number): { sceneId: string; playhead: number; frame: SceneFrame } {
  const element = tracksOfScene(sceneById(doc, parentSceneId)).flatMap((track) => track.elements).find((entry) => entry.id === elementId);
  if (!element || element.type !== "compound") return refuse("Select a compound clip", "disabled");
  const inner = sceneById(doc, String(element.sceneId));
  const playhead = Math.max(0, Math.min(sceneDurationOf(inner), parentPlayhead - element.startTime + element.trimStart));
  return { sceneId: inner.id, playhead, frame: { sceneId: parentSceneId, elementId } };
}
/** Leaving: back in the parent with the playhead at the corresponding parent time. */
export function exitCompound(doc: ProjectDocument, frame: SceneFrame, innerPlayhead: number): { sceneId: string; playhead: number } {
  const parent = sceneById(doc, frame.sceneId), element = tracksOfScene(parent).flatMap((track) => track.elements).find((entry) => entry.id === frame.elementId);
  if (!element) return { sceneId: parent.id, playhead: 0 };
  return { sceneId: parent.id, playhead: Math.max(element.startTime, Math.min(endOf(element), element.startTime + innerPlayhead - element.trimStart)) };
}
