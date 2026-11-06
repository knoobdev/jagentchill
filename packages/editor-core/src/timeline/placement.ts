import { createElement, GRAPHIC_DEFINITIONS, type ProjectDocument, type Rational, type TrackType } from "@jagentchill/protocol";
import { findAsset } from "../model.ts";
import { frameTicks, snapToFrame } from "../time.ts";
import type { CommandEnv, TimelineCommand } from "./command.ts";
import {
  canHold, createTrackAt, endOf, fpsOf, isFree, newTrackIndex, refuse, rejectDoc, sceneById, TIMELINE_MESSAGES, trackById, tracksOfScene, TRACK_FOR_ELEMENT, zoneOfTrack,
  type EditContext, type El, type Sc, type Tr,
} from "./model.ts";

export type PlacementRequest =
  | { strategy: "explicit"; trackId: string }
  | { strategy: "firstAvailable" }
  /** The hovered track; `half` of its row, or the vertical drag direction over an incompatible row. No track: outside all tracks. */
  | { strategy: "preferIndex"; hoveredTrackId?: string; half?: "upper" | "lower"; dragDirection?: "up" | "down"; outside?: "above" | "below" }
  | { strategy: "aboveSource"; sourceTrackId: string }
  | { strategy: "alwaysNew"; index?: number }
  | { strategy: "mainFirst" }
  | { strategy: "mainInsert" };
export type Placed = { track: Tr; created: boolean };

const span = (elements: El[]) => ({ start: Math.min(...elements.map((element) => element.startTime)), end: Math.max(...elements.map(endOf)) });
const fits = (track: Tr, elements: El[], ignore?: ReadonlySet<string>) => elements.every((element) => isFree(track, element.startTime, endOf(element), ignore));
const shift = (elements: El[], delta: number) => { for (const element of elements) element.startTime += delta; };

/**
 * The cut of the main track an insert goes to: the end of the clip under `time` when `time` is at or past its
 * midpoint, otherwise its start; tick 0 on an empty track or before the first clip; the track end beyond the last
 * clip; in a gap, the nearer of its two edges (the earlier on a tie).
 */
export function mainInsertCut(main: Tr, time: number, ignore?: ReadonlySet<string>): number {
  const clips = main.elements.filter((clip) => !ignore?.has(clip.id));
  if (clips.length === 0) return 0;
  const under = clips.find((clip) => clip.startTime <= time && time < endOf(clip));
  if (under) return time >= under.startTime + under.duration / 2 ? endOf(under) : under.startTime;
  const next = clips.find((clip) => clip.startTime > time), previous = [...clips].reverse().find((clip) => endOf(clip) <= time);
  if (!previous) return 0;
  if (!next) return endOf(previous);
  return time - endOf(previous) <= next.startTime - time ? endOf(previous) : next.startTime;
}

/** Inserts the items back to back at a cut of the main track; every clip from that cut onward shifts right. */
export function insertIntoMain(scene: Sc, elements: El[], time: number): void {
  const main = scene.tracks.main;
  if (main.locked) refuse(TIMELINE_MESSAGES.mainLocked, "main-locked");
  const cut = mainInsertCut(main, time);
  const total = elements.reduce((sum, element) => sum + element.duration, 0);
  for (const clip of main.elements) if (clip.startTime >= cut) clip.startTime += total;
  let at = cut;
  for (const element of elements) { element.startTime = at; at += element.duration; }
  main.elements.push(...elements);
}

/** Puts elements on the main track by the rule of the edit context; `false` when the main track does not take them. */
function tryMain(scene: Sc, elements: El[], edit: EditContext): boolean {
  const main = scene.tracks.main;
  if (main.locked) return false;
  const { start } = span(elements);
  // Under the magnet the main track takes content only at a cut, so the command creates neither a gap nor an overlap.
  if (edit.magnet && !edit.freeLayer) { insertIntoMain(scene, elements, start); return true; }
  if (!edit.freeLayer && !edit.magnet) {
    // The classic start rule: alone on the track, or at or before the earliest other element, the start is forced to 0.
    const earliest = Math.min(...main.elements.map((element) => element.startTime));
    if (main.elements.length === 0 || start <= earliest) shift(elements, -start);
  }
  // Overlap is judged on the adjusted position, never on the requested one.
  if (!fits(main, elements)) { if (span(elements).start !== start) shift(elements, start - span(elements).start); return false; }
  main.elements.push(...elements);
  return true;
}

const newTrack = (scene: Sc, type: TrackType, index: number, elements: El[], env: Pick<CommandEnv, "newId">): Placed => {
  const track = createTrackAt(scene, type, index, env.newId);
  track.elements.push(...elements);
  return { track, created: true };
};
/** Rule (c) of Free layer mode and the fallback of `mainFirst`: the overlay video track nearest the main track that is free, else a new one directly above main. */
export function nearestOverlayVideo(scene: Sc, elements: El[], env: Pick<CommandEnv, "newId">): Placed {
  for (let index = scene.tracks.overlay.length - 1; index >= 0; index--) {
    const track = scene.tracks.overlay[index];
    if (track.type === "video" && !track.locked && fits(track, elements)) { track.elements.push(...elements); return { track, created: false }; }
  }
  return newTrack(scene, "video", scene.tracks.overlay.length, elements, env);
}

/**
 * Places a chain of elements of one track type on one track by a placement strategy, creating the track when the
 * strategy says so. The elements carry their requested start times and leave with their final ones.
 */
export function placeElements(scene: Sc, elements: El[], request: PlacementRequest, env: CommandEnv): Placed {
  const type = TRACK_FOR_ELEMENT[elements[0].type] ?? rejectDoc("document/element-track-mismatch", "", `no track type holds "${elements[0].type}" elements`);
  const main = scene.tracks.main, mainable = type === "video";
  const usable = (track: Tr) => canHold(track, elements[0].type) && !track.locked;
  const take = (track: Tr): boolean => {
    if (!usable(track)) return false;
    if (track === main) return tryMain(scene, elements, env.edit);
    if (!fits(track, elements)) return false;
    track.elements.push(...elements);
    return true;
  };
  const firstAvailable = (): Placed => {
    for (const track of tracksOfScene(scene)) if (take(track)) return { track, created: false };
    return newTrack(scene, type, newTrackIndex(scene, type, "highest"), elements, env);
  };
  switch (request.strategy) {
    case "explicit": {
      const track = trackById(scene, request.trackId) ?? rejectDoc("document/unknown-reference", "", `track "${request.trackId}" does not exist`);
      if (!canHold(track, elements[0].type)) rejectDoc("document/element-track-mismatch", "", `a ${track.type} track does not hold ${elements[0].type} elements`);
      if (track.locked) refuse(track === main ? TIMELINE_MESSAGES.mainLocked : "The track is locked", "track-locked");
      if (take(track)) return { track, created: false };
      if (track === main && env.edit.freeLayer) return nearestOverlayVideo(scene, elements, env);
      return rejectDoc("document/elements-overlap", "", "the target range of the track is occupied");
    }
    case "firstAvailable": return firstAvailable();
    case "mainFirst": {
      if (!mainable) return firstAvailable();
      if (take(main)) return { track: main, created: false };
      return nearestOverlayVideo(scene, elements, env);
    }
    case "mainInsert": {
      if (!mainable) return firstAvailable();
      insertIntoMain(scene, elements, span(elements).start);
      return { track: main, created: false };
    }
    case "alwaysNew": return newTrack(scene, type, request.index ?? newTrackIndex(scene, type), elements, env);
    case "aboveSource": {
      const order = tracksOfScene(scene), source = order.findIndex((track) => track.id === request.sourceTrackId);
      const above = source > 0 ? order[source - 1] : undefined;
      if (above && take(above)) return { track: above, created: false };
      return firstAvailable();
    }
    case "preferIndex": {
      const hovered = request.hoveredTrackId ? trackById(scene, request.hoveredTrackId) : undefined;
      if (!hovered) {
        const below = request.outside === "below";
        return newTrack(scene, type, type === "audio" ? (below ? scene.tracks.audio.length : 0) : below ? scene.tracks.overlay.length : 0, elements, env);
      }
      if (take(hovered)) return { track: hovered, created: false };
      if (hovered === main && mainable && env.edit.freeLayer && !main.locked) return nearestOverlayVideo(scene, elements, env);
      // Above or below the hovered row: by its hovered half, or by the drag direction over a row of another type.
      const above = canHold(hovered, elements[0].type) ? request.half !== "lower" : (request.dragDirection ?? (request.half === "lower" ? "down" : "up")) === "up";
      const zone = zoneOfTrack(scene, hovered);
      let index: number;
      if (type === "audio") index = zone === "audio" ? scene.tracks.audio.indexOf(hovered) + (above ? 0 : 1) : 0;
      else index = zone === "overlay" ? scene.tracks.overlay.indexOf(hovered) + (above ? 0 : 1) : scene.tracks.overlay.length;
      return newTrack(scene, type, index, elements, env);
    }
  }
}

/** Click-to-add: `mainInsert` for main-track items while the magnet is on, `mainFirst` otherwise; everything else `firstAvailable`. */
export function clickToAddRequest(elementType: string, edit: EditContext): PlacementRequest {
  if (TRACK_FOR_ELEMENT[elementType] !== "video") return { strategy: "firstAvailable" };
  return edit.magnet && !edit.freeLayer ? { strategy: "mainInsert" } : { strategy: "mainFirst" };
}

// — What gets created —
export type InsertDefaults = { imageDuration: number; textDuration: number; stickerDuration: number; effectDuration: number };
/** Factory values of the "Editing default" preferences; the caller passes the user's. */
export const FACTORY_INSERT_DEFAULTS: InsertDefaults = { imageDuration: 600_000, textDuration: 360_000, stickerDuration: 600_000, effectDuration: 600_000 };
export type LibraryItem =
  | { kind: "media"; assetId: string; name?: string }
  | { kind: "text"; fields?: Record<string, unknown> }
  | { kind: "sticker"; stickerId: string; name?: string; width?: number; height?: number }
  | { kind: "graphic"; definitionId: string; params?: Record<string, unknown>; name?: string }
  | { kind: "effect" | "filter"; effectType: string; params?: Record<string, number | boolean | string>; name?: string }
  | { kind: "adjustment"; name?: string }
  | { kind: "compound"; sceneId: string; name?: string };
/** The element type an item becomes; the placement and the drop targets are decided on it. */
export function elementTypeOfItem(doc: ProjectDocument, item: LibraryItem): string {
  if (item.kind === "media") return findAsset(doc, item.assetId)?.type ?? rejectDoc("document/unknown-asset", "", `asset "${item.assetId}" does not exist`);
  return item.kind === "filter" ? "effect" : item.kind;
}
const wholeFrames = (duration: number, fps: Rational, sourceLimit?: number): number => {
  const frame = frameTicks(fps);
  let snapped = Math.max(frame, snapToFrame(duration, fps));
  // Source bounds take precedence over frame alignment: never past the source.
  while (sourceLimit !== undefined && snapped > sourceLimit && snapped > frame) snapped -= frame;
  return snapped;
};

/**
 * A new element for a library item with every default of its type written out. The references of the item (asset,
 * sticker id, graphic definition, registered effect) are checked here; an invalid one rejects the command.
 */
export function buildElement(doc: ProjectDocument, item: LibraryItem, startTime: number, env: CommandEnv, defaults: InsertDefaults = FACTORY_INSERT_DEFAULTS, options: { agent?: boolean } = {}): El {
  const fps = fpsOf(doc), id = env.newId();
  const base = (name: string, duration: number) => ({ id, name, startTime, duration: wholeFrames(duration, fps) });
  switch (item.kind) {
    case "media": {
      const asset = findAsset(doc, item.assetId) ?? rejectDoc("document/unknown-asset", "", `asset "${item.assetId}" does not exist`);
      const name = item.name ?? asset.name;
      if (asset.type === "image") return createElement("image", { ...base(name, defaults.imageDuration), mediaId: asset.id }) as unknown as El;
      const source = asset.duration ?? rejectDoc("document/asset-type-mismatch", "", `asset "${asset.id}" has no duration`);
      const duration = wholeFrames(source, fps, source);
      const timing = { id, name, startTime, duration, sourceDuration: source, trimStart: 0, trimEnd: Math.max(0, source - duration), mediaId: asset.id };
      // A sound of the app's own bundled set (its record says so) is placed as that: the licence check then names it as bundled CC0, not as a file whose licence is not known.
      return (asset.type === "audio" ? createElement("audio", { ...timing, sourceType: ((source) => (source === "bundled" ? "bundled" : source === "stock" ? "library" : "upload"))((asset as { provenance?: { source?: string } }).provenance?.source) }) : createElement("video", timing)) as unknown as El;
    }
    case "text": {
      const fields = item.fields ?? {};
      if (options.agent && String(fields.content ?? "").length === 0) rejectDoc("document/missing-field", "", "text inserted by a tool has content");
      return createElement("text", { ...base(String(fields.name ?? "Text"), defaults.textDuration), ...fields }) as unknown as El;
    }
    case "sticker": {
      if (!/^[^:]+:.+$/.test(item.stickerId)) rejectDoc("document/unknown-reference", "", `"${item.stickerId}" is not a sticker id`);
      return createElement("sticker", { ...base(item.name ?? "Sticker", defaults.stickerDuration), stickerId: item.stickerId, ...(item.width ? { intrinsicWidth: item.width, intrinsicHeight: item.height ?? item.width } : {}) }) as unknown as El;
    }
    case "graphic": {
      if (!(GRAPHIC_DEFINITIONS as readonly string[]).includes(item.definitionId) || item.definitionId === "drawing") rejectDoc("document/unknown-definition", "", `"${item.definitionId}" is not a registered graphic definition`);
      return createElement("graphic", { ...base(item.name ?? "Shape", defaults.stickerDuration), definitionId: item.definitionId, params: item.params ?? {} }) as unknown as El;
    }
    case "effect": case "filter": {
      const registry = env.ctx.registries?.effects;
      if (registry && registry[item.effectType]?.kind !== item.kind) rejectDoc("document/unknown-definition", "", `"${item.effectType}" is not a registered ${item.kind}`);
      const params = { ...Object.fromEntries(Object.entries(registry?.[item.effectType]?.params ?? {}).map(([key, definition]) => [key, definition.default])), ...item.params };
      return createElement("effect", { ...base(item.name ?? item.effectType, defaults.effectDuration), effects: [{ id: env.newId(), type: item.effectType, kind: item.kind, enabled: true, params }] }) as unknown as El;
    }
    case "adjustment": return createElement("adjustment", base(item.name ?? "Adjustment", defaults.effectDuration)) as unknown as El;
    case "compound": {
      const scene = sceneById(doc, item.sceneId), duration = Math.max(frameTicks(fps), tracksOfScene(scene).flatMap((track) => track.elements).reduce((latest, element) => Math.max(latest, endOf(element)), 0));
      return createElement("compound", { id, name: item.name ?? scene.name, startTime, duration, sourceDuration: duration, sceneId: scene.id }) as unknown as El;
    }
  }
}

export type InsertOptions = { sceneId: string; items: LibraryItem[]; time: number; request?: PlacementRequest; defaults?: InsertDefaults; agent?: boolean; label?: string };
/** Builds the items, chains those of one track type end to end from `time`, and places each chain on one track. */
export function insertChains(draft: ProjectDocument, env: CommandEnv, options: InsertOptions, requestFor: (elementType: string, chain: El[]) => PlacementRequest): { ids: string[]; placed: Placed[] } {
  const scene = sceneById(draft, options.sceneId), start = snapToFrame(Math.max(0, options.time), fpsOf(draft));
  const chains = new Map<TrackType, El[]>();
  for (const item of options.items) {
    const trackType = TRACK_FOR_ELEMENT[elementTypeOfItem(draft, item)];
    const chain = chains.get(trackType) ?? [];
    const element = buildElement(draft, item, chain.length > 0 ? endOf(chain[chain.length - 1]) : start, env, options.defaults, { agent: options.agent });
    chains.set(trackType, [...chain, element]);
  }
  const placed = [...chains.values()].map((chain) => placeElements(scene, chain, requestFor(chain[0].type, chain), env));
  return { ids: [...chains.values()].flat().map((element) => element.id), placed };
}

/**
 * Adds library items without a drag — "+", double-click, tap-to-add, paste of system-clipboard media: the
 * click-to-add rule unless a strategy is named (an Overlay action passes `alwaysNew` or `firstAvailable`).
 */
export function addToTimeline(options: InsertOptions): TimelineCommand<{ elementIds: string[] }> {
  return {
    type: "timeline.add", label: options.label ?? "Add to timeline", sceneId: options.sceneId,
    run(draft, env) {
      const { ids } = insertChains(draft, env, options, (type) => options.request ?? clickToAddRequest(type, env.edit));
      return { selection: ids, info: { elementIds: ids } };
    },
  };
}

export type DropTarget = { hoveredTrackId?: string; half?: "upper" | "lower"; dragDirection?: "up" | "down"; outside?: "above" | "below" };
/** A drag of a library item released over the timeline: `preferIndex` on the hovered track; the insert and any new track are one step. */
export const dropLibraryItem = (options: Omit<InsertOptions, "request"> & { target: DropTarget }): TimelineCommand<{ elementIds: string[] }> => ({
  type: "timeline.drop", label: options.label ?? "Add to timeline", sceneId: options.sceneId,
  run(draft, env) {
    const { ids } = insertChains(draft, env, options, () => ({ strategy: "preferIndex", ...options.target }));
    return { selection: ids, info: { elementIds: ids } };
  },
});

/**
 * Files dropped from the operating system, after import: the visual files chained on one track by `preferIndex`
 * from the hovered track, the audio files chained on one audio track by `firstAvailable`, both from the drop time.
 * On a completely empty timeline the visual chain goes onto the main track at tick 0.
 */
export const dropFiles = (options: { sceneId: string; assetIds: string[]; time: number; target: DropTarget; defaults?: InsertDefaults }): TimelineCommand<{ elementIds: string[] }> => ({
  type: "timeline.drop-files", label: "Add to timeline", sceneId: options.sceneId,
  run(draft, env) {
    const scene = sceneById(draft, options.sceneId);
    const empty = tracksOfScene(scene).every((track) => track.elements.length === 0);
    const items = options.assetIds.map((assetId): LibraryItem => ({ kind: "media", assetId }));
    const { ids } = insertChains(draft, env, { ...options, items }, (type, chain) => {
      if (type === "audio") return { strategy: "firstAvailable" };
      if (empty) { shift(chain, -chain[0].startTime); return { strategy: "explicit", trackId: scene.tracks.main.id }; }
      return { strategy: "preferIndex", ...options.target };
    });
    return { selection: ids, info: { elementIds: ids } };
  },
});

/** Where a dragged effect or filter lands: on a visual element as a clip effect, or as an effect element on an effect track. */
export const dropEffect = (options: { sceneId: string; item: Extract<LibraryItem, { kind: "effect" | "filter" }>; time: number; targetElementId?: string; hoveredTrackId?: string; defaults?: InsertDefaults }): TimelineCommand<{ elementIds: string[]; onElement: boolean }> => ({
  type: "timeline.drop-effect", label: "Add effect", sceneId: options.sceneId,
  run(draft, env) {
    const scene = sceneById(draft, options.sceneId);
    const target = options.targetElementId ? tracksOfScene(scene).flatMap((track) => track.elements).find((element) => element.id === options.targetElementId) : undefined;
    const built = buildElement(draft, options.item, snapToFrame(Math.max(0, options.time), fpsOf(draft)), env, options.defaults);
    if (target && ["video", "image", "text", "sticker", "graphic", "compound"].includes(target.type)) {
      const host = tracksOfScene(scene).find((track) => track.elements.includes(target))!;
      if (host.locked) refuse("The track is locked", "track-locked");
      (target.effects as unknown[]).push((built.effects as unknown[])[0]);
      return { selection: [target.id], info: { elementIds: [target.id], onElement: true } };
    }
    const hovered = options.hoveredTrackId ? trackById(scene, options.hoveredTrackId) : undefined;
    const request: PlacementRequest = hovered?.type === "effect" && !hovered.locked && isFree(hovered, built.startTime, endOf(built)) ? { strategy: "explicit", trackId: hovered.id } : { strategy: "alwaysNew" };
    placeElements(scene, [built], request, env);
    return { selection: [built.id], info: { elementIds: [built.id], onElement: false } };
  },
});

/** The drop decision shown while dragging (ghost, drop line): which track takes the item, or where a new track would appear. */
export function previewDrop(doc: ProjectDocument, sceneId: string, elementType: string, start: number, duration: number, target: DropTarget, edit: EditContext): { kind: "track"; trackId: string; startTime: number } | { kind: "new-track"; zone: "overlay" | "audio"; index: number; startTime: number } {
  const copy = JSON.parse(JSON.stringify({ scenes: [sceneById(doc, sceneId)] })) as ProjectDocument;
  const scene = copy.scenes[0] as unknown as Sc, ids = new Set(tracksOfScene(scene).map((track) => track.id));
  let count = 0;
  const probe = { id: "__probe", type: elementType, name: "", startTime: start, duration, trimStart: 0, trimEnd: 0, groupId: null, linkId: null } as El;
  const placed = placeElements(scene, [probe], { strategy: "preferIndex", ...target }, { edit, newId: () => `__new${++count}`, before: doc, ctx: { now_ms: 0, newId: () => "" } });
  if (ids.has(placed.track.id)) return { kind: "track", trackId: placed.track.id, startTime: probe.startTime };
  const zone = placed.track.type === "audio" ? "audio" : "overlay";
  return { kind: "new-track", zone, index: scene.tracks[zone].indexOf(placed.track), startTime: probe.startTime };
}
