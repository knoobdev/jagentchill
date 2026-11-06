import type { AssetRecord, ProjectDocument, Scene, TimelineElement, Track } from "@jagentchill/protocol";
import { pointer } from "./patch.ts";

export type Json = Record<string, unknown>;
export const isObject = (value: unknown): value is Json => value !== null && typeof value === "object" && !Array.isArray(value);
export const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
/** A structured copy of plain JSON data. */
export const clone = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)) as T);

export type Zone = "overlay" | "main" | "audio";
export type TrackRef = { scene: Scene; track: Track; zone: Zone; path: string };
export type ElementRef = TrackRef & { element: TimelineElement; index: number; elementPath: string };

/** Every track of a scene with its zone and id path. Malformed parts are skipped: the schema pass reports them. */
export function* tracksIn(scene: Scene, scenePath: string): Generator<TrackRef> {
  const tracks = (scene as { tracks?: Json }).tracks;
  if (!isObject(tracks)) return;
  for (const track of asArray(tracks.overlay)) if (isObject(track)) yield { scene, track: track as Track, zone: "overlay", path: `${scenePath}/tracks/overlay${pointer(`@${String(track.id)}`)}` };
  if (isObject(tracks.main)) yield { scene, track: tracks.main as Track, zone: "main", path: `${scenePath}/tracks/main` };
  for (const track of asArray(tracks.audio)) if (isObject(track)) yield { scene, track: track as Track, zone: "audio", path: `${scenePath}/tracks/audio${pointer(`@${String(track.id)}`)}` };
}
export const scenePathOf = (scene: { id?: unknown }): string => `/scenes${pointer(`@${String(scene.id)}`)}`;
export function* allTracks(document: ProjectDocument): Generator<TrackRef> {
  for (const scene of asArray((document as { scenes?: unknown }).scenes)) if (isObject(scene)) yield* tracksIn(scene as Scene, scenePathOf(scene));
}
export function* allElements(document: ProjectDocument): Generator<ElementRef> {
  for (const ref of allTracks(document)) {
    const elements = asArray((ref.track as { elements?: unknown }).elements);
    for (let index = 0; index < elements.length; index++) {
      const element = elements[index];
      if (isObject(element)) yield { scene: ref.scene, track: ref.track, zone: ref.zone, path: ref.path, element: element as TimelineElement, index, get elementPath() { return `${ref.path}/elements${pointer(`@${String(element.id)}`)}`; } };
    }
  }
}
export function findElement(document: ProjectDocument, id: string): ElementRef | undefined {
  for (const ref of allElements(document)) if (ref.element.id === id) return ref;
  return undefined;
}
export function findTrack(document: ProjectDocument, id: string): TrackRef | undefined {
  for (const ref of allTracks(document)) if (ref.track.id === id) return ref;
  return undefined;
}
export const findScene = (document: ProjectDocument, id: string): Scene | undefined => document.scenes.find((scene) => scene.id === id);
export const mainScene = (document: ProjectDocument): Scene => document.scenes.find((scene) => scene.isMain)!;
export const findAsset = (document: ProjectDocument, id: string): AssetRecord | undefined => document.media.assets.find((asset) => asset.id === id);
export const elementEnd = (element: { startTime: number; duration: number }): number => element.startTime + element.duration;

/** End of the last element of a scene. */
export function sceneDuration(scene: Scene): number {
  let end = 0;
  for (const { track } of tracksIn(scene, "")) for (const element of asArray(track.elements) as TimelineElement[]) end = Math.max(end, elementEnd(element));
  return end;
}
