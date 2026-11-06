import { TICKS_PER_SECOND, type ProjectDocument } from "@jagentchill/protocol";
import { isObject, type Json } from "../model.ts";
import { activeSceneId, endOf, sceneById, tracksOfScene, type El } from "./model.ts";
import { BASE_PIXELS_PER_SECOND } from "./view.ts";

export type SnapPointType = "element-start" | "element-end" | "playhead" | "marker" | "keyframe" | "in-point" | "out-point" | "zero";
export type SnapPoint = { time: number; type: SnapPointType; elementId?: string; markerId?: string };
export type SnapGesture = "element-move" | "element-trim" | "playhead-scrub" | "marker-drag" | "blade" | "range-drag";
export const SNAP_THRESHOLD_PX = 10;
export const SNAP_THRESHOLD_MOBILE_PT = 12;

/** The snap threshold in ticks: 10 px (12 pt on mobile) at the current zoom. */
export function snapThresholdTicks(zoomLevel: number, platform: "desktop" | "web" | "mobile" = "desktop"): number {
  const px = platform === "mobile" ? SNAP_THRESHOLD_MOBILE_PT : SNAP_THRESHOLD_PX;
  return Math.round((px / (BASE_PIXELS_PER_SECOND * zoomLevel)) * TICKS_PER_SECOND);
}

const SOURCES: Record<SnapGesture, SnapPointType[]> = {
  "element-move": ["element-start", "element-end", "playhead", "marker", "keyframe", "in-point", "out-point", "zero"],
  "element-trim": ["element-start", "element-end", "playhead", "marker", "keyframe", "in-point", "out-point", "zero"],
  "playhead-scrub": ["element-start", "element-end", "marker", "keyframe", "in-point", "out-point"],
  "marker-drag": ["element-start", "element-end", "playhead", "marker", "keyframe"],
  blade: ["element-start", "element-end", "playhead", "marker"],
  "range-drag": ["element-start", "element-end", "playhead", "marker", "keyframe", "zero"],
};

const keyframeTimes = (element: El): number[] => {
  const times = new Set<number>();
  if (isObject(element.animations)) for (const channel of Object.values(element.animations) as Json[]) {
    const keys = ("r" in channel ? (channel.r as Json).keys : channel.keys) as { time: number }[] | undefined;
    for (const key of keys ?? []) times.add(element.startTime + key.time);
  }
  return [...times];
};

/**
 * The snap points a gesture may land on. Members of the dragged set and elements on hidden tracks are never sources;
 * the dragged marker is not its own source.
 */
export function snapPoints(doc: ProjectDocument, gesture: SnapGesture, options: { sceneId?: string; playhead?: number; excludeElementIds?: Iterable<string>; excludeMarkerId?: string } = {}): SnapPoint[] {
  const scene = sceneById(doc, options.sceneId ?? activeSceneId(doc)), wanted = new Set(SOURCES[gesture]), excluded = new Set(options.excludeElementIds ?? []);
  const points: SnapPoint[] = [];
  for (const track of tracksOfScene(scene)) {
    if (track.hidden === true) continue;
    for (const element of track.elements) {
      if (excluded.has(element.id)) continue;
      if (wanted.has("element-start")) points.push({ time: element.startTime, type: "element-start", elementId: element.id });
      if (wanted.has("element-end")) points.push({ time: endOf(element), type: "element-end", elementId: element.id });
      if (wanted.has("keyframe")) for (const time of keyframeTimes(element)) points.push({ time, type: "keyframe", elementId: element.id });
    }
  }
  if (wanted.has("playhead") && options.playhead !== undefined) points.push({ time: options.playhead, type: "playhead" });
  if (wanted.has("marker")) for (const marker of scene.markers as { id: string; time: number }[]) if (marker.id !== options.excludeMarkerId) points.push({ time: marker.time, type: "marker", markerId: marker.id });
  if (wanted.has("in-point") && scene.inPoint !== undefined) points.push({ time: scene.inPoint, type: "in-point" });
  if (wanted.has("out-point") && scene.outPoint !== undefined) points.push({ time: scene.outPoint, type: "out-point" });
  if (wanted.has("zero")) points.push({ time: 0, type: "zero" });
  return points;
}

export type SnapResult = { time: number; snapped: boolean; point?: SnapPoint; delta: number };
/**
 * Resolves snapping for the edges of what is being dragged (`candidates`, in ticks): the closest snap point within
 * the threshold wins; ties resolve to the earliest time. `delta` is what to add to the dragged thing.
 * `enabled` is the Auto snapping toggle; Shift during a pointer gesture passes `false` for that gesture.
 */
export function resolveSnap(candidates: number[], points: SnapPoint[], thresholdTicks: number, enabled = true): SnapResult {
  const none: SnapResult = { time: candidates[0] ?? 0, snapped: false, delta: 0 };
  if (!enabled) return none;
  let best: { distance: number; point: SnapPoint; edge: number } | undefined;
  for (const edge of candidates) for (const point of points) {
    const distance = Math.abs(point.time - edge);
    if (distance > thresholdTicks) continue;
    if (!best || distance < best.distance || (distance === best.distance && point.time < best.point.time)) best = { distance, point, edge };
  }
  if (!best) return none;
  return { time: best.point.time, snapped: true, point: best.point, delta: best.point.time - best.edge };
}

/** Snapping of a gesture in one call: sources for the gesture, threshold at the zoom, toggle and Shift honoured. */
export function snapGesture(doc: ProjectDocument, gesture: SnapGesture, candidates: number[], options: { zoomLevel: number; platform?: "desktop" | "web" | "mobile"; enabled: boolean; shift?: boolean; sceneId?: string; playhead?: number; excludeElementIds?: Iterable<string>; excludeMarkerId?: string }): SnapResult {
  return resolveSnap(candidates, snapPoints(doc, gesture, options), snapThresholdTicks(options.zoomLevel, options.platform), options.enabled && !options.shift);
}
