import { timeline } from "@jagentchill/editor-core";
import { TICKS_PER_SECOND, type ProjectDocument } from "@jagentchill/protocol";

/**
 * Geometry of the desktop and web timeline as the design frame draws it. The engine owns order, zones and lanes
 * (`timeline.trackRows`); these are the pixel sizes the rows, the header column and the ruler are drawn at.
 */
export const TIMELINE_FRAME = {
  headerWidth: 112, rulerHeight: 24, rowGap: 4, toolbarHeight: 36, clipHeader: 16, laneHeight: 20,
  rows: { video: 56, audio: 40, bar: 28 }, trimHandle: 8, playheadFlag: { width: 11, height: 14 }, markerFlag: 10, transitionHandle: 20,
  /** Elements this far outside the viewport are still drawn, so a scroll never shows an empty edge. */
  overscan: 400,
} as const;

export type TimelineRow = { trackId: string; zone: "overlay" | "main" | "audio"; type: string; name: string; top: number; height: number; baseHeight: number; lanes: number; alt: boolean; locked: boolean };
const baseHeightOf = (type: string): number => (type === "video" ? TIMELINE_FRAME.rows.video : type === "audio" ? TIMELINE_FRAME.rows.audio : TIMELINE_FRAME.rows.bar);

/** The rows of the active scene, top to bottom, at the frame's sizes; a row grows by its expanded keyframe lanes. */
export function layoutRows(doc: ProjectDocument, options: { sceneId?: string; expandedElementIds?: string[] } = {}): TimelineRow[] {
  const sceneId = options.sceneId ?? timeline.activeSceneId(doc), scene = timeline.sceneById(doc, sceneId);
  const tracks = new Map(timeline.tracksOfScene(scene).map((track) => [track.id, track]));
  let top: number = TIMELINE_FRAME.rowGap;
  return timeline.trackRows(doc, { sceneId, expandedElementIds: options.expandedElementIds }).map((row, index) => {
    const track = tracks.get(row.trackId)!, lanes = Math.round((row.height - row.baseHeight) / timeline.TIMELINE_GEOMETRY.keyframeLaneHeight);
    const baseHeight = baseHeightOf(track.type), height = baseHeight + lanes * TIMELINE_FRAME.laneHeight;
    const placed: TimelineRow = { trackId: row.trackId, zone: row.zone, type: track.type, name: track.name, top, height, baseHeight, lanes, alt: index % 2 === 1, locked: track.locked };
    top += height + TIMELINE_FRAME.rowGap;
    return placed;
  });
}
export const rowsHeight = (rows: readonly TimelineRow[]): number => (rows.length === 0 ? 0 : rows[rows.length - 1].top + rows[rows.length - 1].height + TIMELINE_FRAME.rowGap);

export type TimelineViewport = { zoomLevel: number; scrollLeft: number; width: number };
/** The time under a viewport x (px from the left edge of the tracks viewport). */
export const timeAtX = (x: number, view: Pick<TimelineViewport, "zoomLevel" | "scrollLeft">): number => Math.max(0, timeline.pixelsToTicks(x + view.scrollLeft, view.zoomLevel));
/** The viewport x of a time, rounded to the device-pixel grid. */
export const xOfTime = (time: number, view: Pick<TimelineViewport, "zoomLevel" | "scrollLeft">, devicePixelRatio = 1): number => timeline.toDevicePixel(timeline.ticksToPixels(time, view.zoomLevel) - view.scrollLeft, devicePixelRatio);

/** Where a content y falls: on a row (and in which half of it), in the gap after a row, or outside all rows. */
export function rowAtY(rows: readonly TimelineRow[], y: number): { row?: TimelineRow; half?: "upper" | "lower"; outside?: "above" | "below"; index: number } {
  if (rows.length === 0 || y < rows[0].top) return { outside: "above", index: 0 };
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index], bottom = row.top + row.height;
    if (y < bottom) return { row, half: y < row.top + row.height / 2 ? "upper" : "lower", index };
    // A gap belongs to the lower half of the row above it.
    if (y < bottom + TIMELINE_FRAME.rowGap && index < rows.length - 1) return { row, half: "lower", index };
  }
  return { outside: "below", index: rows.length - 1 };
}
/** The drop target the engine's placement reads, from the pointer's content y and its vertical direction of travel. */
export function dropTargetAt(rows: readonly TimelineRow[], y: number, dragDirection?: "up" | "down"): timeline.DropTarget {
  const hit = rowAtY(rows, y);
  if (!hit.row) return { outside: hit.outside };
  return { hoveredTrackId: hit.row.trackId, half: hit.half, ...(dragDirection ? { dragDirection } : {}) };
}

export type ClipZone = "trim-start" | "trim-end" | "body";
/**
 * Which part of a clip a pointer is on. The trim handles are the 8 px at each edge of a selected clip; an
 * unselected clip offers them too, so one press-drag on an edge trims. A clip too narrow for two handles and a body
 * keeps its body in the middle third.
 */
export function clipZone(localX: number, width: number, handle: number = TIMELINE_FRAME.trimHandle): ClipZone {
  const edge = width >= handle * 3 ? handle : width / 3;
  if (localX <= edge) return "trim-start";
  if (localX >= width - edge) return "trim-end";
  return "body";
}

type Spanned = { id: string; startTime: number; duration: number };
/** The elements of a track that intersect the viewport plus the overscan: the only ones mounted. */
export function visibleElements<E extends Spanned>(elements: readonly E[], view: TimelineViewport, overscan: number = TIMELINE_FRAME.overscan, keep: ReadonlySet<string> = new Set()): E[] {
  const from = timeline.pixelsToTicks(Math.max(0, view.scrollLeft - overscan), view.zoomLevel), to = timeline.pixelsToTicks(view.scrollLeft + view.width + overscan, view.zoomLevel);
  // An element being dragged or holding focus stays mounted when it leaves the window.
  return elements.filter((element) => keep.has(element.id) || (element.startTime < to && element.startTime + element.duration > from));
}

/** The marquee the engine's box selection reads, from two corners in content pixels (x from time 0, y from the first row's top edge). */
export function marqueeOf(a: { x: number; y: number }, b: { x: number; y: number }, zoomLevel: number): timeline.Marquee {
  return { startTime: timeline.pixelsToTicks(Math.max(0, Math.min(a.x, b.x)), zoomLevel), endTime: timeline.pixelsToTicks(Math.max(0, Math.max(a.x, b.x)), zoomLevel), top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y) };
}

/**
 * The tiles of a filmstrip: each as wide as the strip is high times the asset's aspect ratio, each showing the
 * source frame at its own left edge. Only the tiles inside `[visibleFrom, visibleTo]` (clip-local px) are listed.
 */
export function filmstripTiles(input: { clipWidth: number; stripHeight: number; aspect: number; trimStart: number; zoomLevel: number; rate?: number; visibleFrom?: number; visibleTo?: number }): { x: number; width: number; sourceTime: number }[] {
  const width = Math.max(1, Math.round(input.stripHeight * (input.aspect > 0 ? input.aspect : 16 / 9)));
  const first = Math.max(0, Math.floor((input.visibleFrom ?? 0) / width)), last = Math.min(Math.ceil(input.clipWidth / width), Math.ceil((input.visibleTo ?? input.clipWidth) / width));
  const tiles: { x: number; width: number; sourceTime: number }[] = [];
  for (let index = first; index < last; index++) tiles.push({ x: index * width, width, sourceTime: Math.round(input.trimStart + timeline.pixelsToTicks(index * width, input.zoomLevel) * (input.rate ?? 1)) });
  return tiles;
}
/** The frame of a prepared filmstrip (one every `intervalTicks` of source) nearest a source time. */
export const filmstripFrameIndex = (sourceTime: number, intervalTicks: number, frames: number): number => Math.max(0, Math.min(frames - 1, Math.round(sourceTime / Math.max(1, intervalTicks))));

/**
 * The bars of a clip's waveform: `bars` peaks (0–1) taken from the asset's summary over the clip's source window.
 * A window past the summary reads as silence.
 */
export function waveformBars(peaks: ArrayLike<number>, assetDuration: number, window: { trimStart: number; sourceSpan: number }, bars: number): number[] {
  const out: number[] = [];
  if (bars <= 0 || assetDuration <= 0 || peaks.length === 0) return out;
  for (let bar = 0; bar < bars; bar++) {
    const from = ((window.trimStart + (window.sourceSpan * bar) / bars) / assetDuration) * peaks.length, to = ((window.trimStart + (window.sourceSpan * (bar + 1)) / bars) / assetDuration) * peaks.length;
    let peak = 0;
    for (let index = Math.floor(from); index < Math.max(Math.floor(from) + 1, Math.ceil(to)); index++) if (index >= 0 && index < peaks.length) peak = Math.max(peak, Math.abs(peaks[index]));
    out.push(peak);
  }
  return out;
}

/** "+00:12" / "−01:03" and the resulting duration, for the tooltip that follows a trim. */
export function trimTooltip(durationTicks: number, deltaTicks: number): string {
  const clock = (ticks: number) => { const tenths = Math.round((Math.abs(ticks) / TICKS_PER_SECOND) * 10); return `${String(Math.floor(tenths / 600)).padStart(2, "0")}:${String(Math.floor(tenths / 10) % 60).padStart(2, "0")}.${tenths % 10}`; };
  return `${clock(durationTicks)} (${deltaTicks < 0 ? "−" : "+"}${clock(deltaTicks)})`;
}
