import type { AssetRecord, ProjectDocument } from "@jagentchill/protocol";
import { clone, isObject, type Json } from "../model.ts";
import { snapToFrame } from "../time.ts";
import type { CommandEnv, TimelineCommand } from "./command.ts";
import { assertCompoundGraph } from "./compound.ts";
import { copySet } from "./copies.ts";
import { deleteElements } from "./edit.ts";
import {
  canHold, createTrackAt, endOf, fpsOf, isFree, refuse, sceneById, trackById, tracksOfScene, TRACK_FOR_ELEMENT, withPartners, zoneOfTrack, type El, type Sc, type Tr,
} from "./model.ts";
import { insertIntoMain, placeElements } from "./placement.ts";
import { copyTransitions } from "./transitions.ts";

export type ClipboardElements = {
  kind: "elements";
  projectId: string; sceneId: string;
  items: { trackId: string; element: El }[];
  /** The media records the copied elements reference, for a paste into another project. */
  assets: AssetRecord[];
  /** The picture transitions whose two clips are both among the items. */
  transitions?: Json[];
};
/** Keyframe entries are produced and consumed by `keyframe-animation`; the store only carries them. */
export type ClipboardKeyframes = { kind: "keyframes"; payload: unknown };
export type ClipboardEntry = ClipboardElements | ClipboardKeyframes;
/** The one-entry, app-level clipboard: it survives scene and project switches for the lifetime of the app session. */
export function createClipboard(initial: ClipboardEntry | null = null) {
  let entry = initial;
  return {
    get entry(): ClipboardEntry | null { return entry; },
    get isEmpty(): boolean { return entry === null; },
    set(next: ClipboardEntry | null): void { entry = next; },
  };
}
export type Clipboard = ReturnType<typeof createClipboard>;

const mediaIdsOf = (element: El): string[] => [element.mediaId, (element.freeze as Json | undefined)?.mediaId].filter((id): id is string => typeof id === "string");
/** Copies elements (with their group and link partners) into a clipboard entry; the document is not changed. */
export function copyElements(doc: ProjectDocument, sceneId: string, elementIds: string[]): ClipboardElements | null {
  const scene = sceneById(doc, sceneId), wanted = new Set(withPartners(scene, elementIds));
  const items = tracksOfScene(scene).flatMap((track) => track.elements.filter((element) => wanted.has(element.id)).map((element) => ({ trackId: track.id, element: clone(element) })));
  if (items.length === 0) return null;
  const used = new Set(items.flatMap((item) => mediaIdsOf(item.element)));
  const transitions = tracksOfScene(scene).flatMap((track) => track.transitions.filter((record) => wanted.has(String(record.fromElementId)) && wanted.has(String(record.toElementId))));
  return { kind: "elements", projectId: doc.metadata.id, sceneId, items, assets: clone(doc.media.assets.filter((asset) => used.has(asset.id))), transitions: clone(transitions) };
}
/** Cut: the elements go to the clipboard and are deleted as one undo step that honours ripple and the magnet. */
export function cutElements(doc: ProjectDocument, clipboard: Clipboard, sceneId: string, elementIds: string[]): TimelineCommand<{ removed: string[] }> {
  const entry = copyElements(doc, sceneId, elementIds);
  if (entry) clipboard.set(entry);
  return { ...deleteElements({ sceneId, elementIds, label: "Cut" }), type: "timeline.cut" };
}
/** What Paste does: the editor entry when there is one, else an import of system-clipboard media, else nothing. */
export const pasteDecision = (entry: ClipboardEntry | null, systemClipboardHasMedia: boolean): "elements" | "keyframes" | "import-media" | "none" =>
  entry ? entry.kind : systemClipboardHasMedia ? "import-media" : "none";

export type PasteOptions = {
  sceneId: string; entry: ClipboardEntry | null; time: number;
  /** Track context menu "Paste": onto this track when compatible, unlocked and free. */
  targetTrackId?: string;
  /** Cross-project paste copies missing media; the import quota check of the device decides whether there is room. */
  availableBytes?: number; quotaMessage?: string;
};
/**
 * Pastes elements at a time (the playhead, or the click time of the track menu), preserving their offsets from the
 * earliest copied element; grouped by source track and placed with `aboveSource`. A paste into another project also
 * copies every referenced asset the target lacks (matched by content hash), or aborts as a whole without room.
 */
export const paste = (options: PasteOptions): TimelineCommand<{ elementIds: string[]; addedAssetIds: string[] }> => ({
  type: "timeline.paste", label: "Paste", sceneId: options.sceneId,
  run(draft, env) {
    const entry = options.entry;
    if (!entry || entry.kind !== "elements" || entry.items.length === 0) return { info: { elementIds: [], addedAssetIds: [] } };
    const scene = sceneById(draft, options.sceneId), start = snapToFrame(Math.max(0, options.time), fpsOf(draft));
    const copies = copySet(entry.items.map((item) => item.element), env.newId);
    const origin = Math.min(...entry.items.map((item) => item.element.startTime));
    for (const copy of copies.values()) copy.startTime = start + (copy.startTime - origin);
    const added = entry.projectId === draft.metadata.id ? [] : importAssets(draft, entry, [...copies.values()], env, options);
    const bySource = new Map<string, El[]>();
    for (const item of entry.items) bySource.set(item.trackId, [...(bySource.get(item.trackId) ?? []), copies.get(item.element.id)!]);
    for (const [sourceTrackId, chain] of bySource) {
      // One source track may hold several element types only on a graphic track, which is still one track type.
      const target = options.targetTrackId ? trackById(scene, options.targetTrackId) : undefined;
      const onTarget = target && canHold(target, chain[0].type) && !target.locked && chain.every((copy) => isFree(target, copy.startTime, endOf(copy)));
      const known = trackById(scene, sourceTrackId);
      placeElements(scene, chain, onTarget ? { strategy: "explicit", trackId: target.id } : known ? { strategy: "aboveSource", sourceTrackId } : { strategy: "firstAvailable" }, env);
    }
    // A pair copied together keeps the transition between its two clips, under a new id.
    copyTransitions(scene, entry.transitions ?? [], copies, env.newId);
    assertCompoundGraph(draft);
    const ids = [...copies.values()].map((copy) => copy.id);
    return { selection: ids, info: { elementIds: ids, addedAssetIds: added } };
  },
});

function importAssets(draft: ProjectDocument, entry: ClipboardElements, copies: El[], env: CommandEnv, options: PasteOptions): string[] {
  const assets = draft.media.assets as AssetRecord[], remap = new Map<string, string>(), missing: AssetRecord[] = [];
  for (const asset of entry.assets) {
    const same = assets.find((own) => (asset.contentHash !== null && own.contentHash === asset.contentHash) || own.id === asset.id && own.contentHash === asset.contentHash);
    if (same) { remap.set(asset.id, same.id); continue; }
    const id = assets.some((own) => own.id === asset.id) ? env.newId() : asset.id;
    remap.set(asset.id, id);
    missing.push({ ...clone(asset), id, folderId: null });
  }
  const needed = missing.reduce((sum, asset) => sum + asset.size, 0);
  if (options.availableBytes !== undefined && needed > options.availableBytes) refuse(options.quotaMessage ?? "Not enough storage space to paste this media", "quota");
  assets.push(...missing);
  for (const copy of copies) {
    if (typeof copy.mediaId === "string" && remap.has(copy.mediaId)) copy.mediaId = remap.get(copy.mediaId);
    if (isObject(copy.freeze) && typeof copy.freeze.mediaId === "string" && remap.has(copy.freeze.mediaId)) copy.freeze.mediaId = remap.get(copy.freeze.mediaId);
    // Bindings to data of the source project's assets do not exist here.
    delete copy.tracking;
  }
  return missing.map((asset) => asset.id);
}

/**
 * "Duplicate". Per source track, for its selected elements taken together: on the magnetic main track the copies are
 * inserted directly after the last selected element; elsewhere they start at the end of the span when the track is
 * free for the whole copied span there, otherwise they sit at the originals' start times on one new track directly
 * above the source track (audio: directly below).
 */
export const duplicate = (options: { sceneId: string; elementIds: string[] }): TimelineCommand<{ elementIds: string[] }> => ({
  type: "timeline.duplicate", label: "Duplicate", sceneId: options.sceneId,
  run(draft, env) {
    const scene = sceneById(draft, options.sceneId), wanted = new Set(withPartners(scene, options.elementIds));
    const sources = tracksOfScene(scene).map((track) => ({ track, picked: track.elements.filter((element) => wanted.has(element.id)) })).filter((entry) => entry.picked.length > 0 && !entry.track.locked);
    const copies = copySet(sources.flatMap((entry) => entry.picked), env.newId, { suffix: " (copy)" });
    for (const { track, picked } of sources) {
      const chain = picked.map((element) => copies.get(element.id)!), from = Math.min(...picked.map((element) => element.startTime)), to = Math.max(...picked.map(endOf));
      const main = track === scene.tracks.main;
      if (main && env.edit.magnet && !env.edit.freeLayer) { insertIntoMain(scene, chain, to); continue; }
      if (isFree(track, to, to + (to - from))) { for (const copy of chain) copy.startTime += to - from; track.elements.push(...chain); continue; }
      placeDuplicateTrack(scene, track, chain, env);
    }
    copyTransitions(scene, sources.flatMap((entry) => entry.track.transitions), copies, env.newId);
    const ids = [...copies.values()].map((copy) => copy.id);
    return { selection: ids, info: { elementIds: ids } };
  },
});
function placeDuplicateTrack(scene: Sc, source: Tr, chain: El[], env: CommandEnv): void {
  const zone = zoneOfTrack(scene, source);
  const index = zone === "audio" ? scene.tracks.audio.indexOf(source) + 1 : zone === "overlay" ? scene.tracks.overlay.indexOf(source) : scene.tracks.overlay.length;
  createTrackAt(scene, TRACK_FOR_ELEMENT[chain[0].type], index, env.newId).elements.push(...chain);
}
