import type { ProjectDocument } from "@jagentchill/protocol";
import { snapToFrame } from "../time.ts";
import type { TimelineCommand } from "./command.ts";
import { split } from "./edit.ts";
import { activeSceneId, endOf, fpsOf, sceneById, tracksOfScene, TIMELINE_GEOMETRY_DRAG_PX } from "./model.ts";

/** A press on an element becomes a move after 5 px of pointer travel; released within the threshold nothing moves. */
export const dragStarted = (travelPx: number, thresholdPx: number = TIMELINE_GEOMETRY_DRAG_PX): boolean => travelPx >= thresholdPx;
/** Target time of a dragged element: pointer time minus grab offset, never before 0, on the frame grid (snapping follows). */
export const dragTargetTime = (doc: ProjectDocument, pointerTime: number, grabOffset: number): number => snapToFrame(Math.max(0, pointerTime - grabOffset), fpsOf(doc));
/** A pointer time on the frame grid: where a dropped item starts. */
export const dropTime = (doc: ProjectDocument, pointerSeconds: number): number => snapToFrame(Math.max(0, Math.round(pointerSeconds * 120_000)), fpsOf(doc));
/** What a press on a clip of a track does: nothing on a locked track (not-allowed cursor), otherwise select and possibly drag. */
export function pressOnClip(doc: ProjectDocument, elementId: string, sceneId = activeSceneId(doc)): { allowed: boolean; cursor: "default" | "not-allowed" } {
  const track = tracksOfScene(sceneById(doc, sceneId)).find((entry) => entry.elements.some((element) => element.id === elementId));
  return track && !track.locked ? { allowed: true, cursor: "default" } : { allowed: false, cursor: "not-allowed" };
}
/**
 * A click in Split (blade) mode at a time: on a clip it splits that clip — with Shift every clip on unlocked tracks —
 * at the frame nearest the time; on empty area nothing is split and the playhead seeks there. The mode stays Split.
 */
export function bladeClick(doc: ProjectDocument, input: { time: number; elementId?: string; shift?: boolean; sceneId?: string }): { kind: "split"; command: TimelineCommand } | { kind: "seek"; time: number } {
  const sceneId = input.sceneId ?? activeSceneId(doc), time = snapToFrame(Math.max(0, input.time), fpsOf(doc));
  const element = input.elementId ? tracksOfScene(sceneById(doc, sceneId)).flatMap((track) => (track.locked ? [] : track.elements)).find((entry) => entry.id === input.elementId) : undefined;
  if (!element || time <= element.startTime || time >= endOf(element)) return { kind: "seek", time };
  return { kind: "split", command: input.shift ? split({ sceneId, time, mode: "split-all" }) : split({ sceneId, time, elementIds: [element.id] }) };
}
