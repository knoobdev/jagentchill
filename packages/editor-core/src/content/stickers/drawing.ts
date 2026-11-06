import { createElement, type ProjectDocument, type Stroke } from "@jagentchill/protocol";
import { roundStored } from "../../canonical.ts";
import { snapToFrame } from "../../time.ts";
import type { TimelineCommand } from "../../timeline/command.ts";
import { fpsOf, sceneById, type El } from "../../timeline/model.ts";
import { FACTORY_INSERT_DEFAULTS, placeElements } from "../../timeline/placement.ts";

/** `stickers-shapes.Freehand drawing`: strokes drawn on the canvas, in canvas pixels from the canvas centre. */
export type DrawnStroke = { points: [number, number][]; width: number; color: string; brush: "pen" | "marker" };
export const DRAW_DEFAULTS = { width: 12, color: "#ffffff", brush: "pen" as const, tolerance: 1 };

/** Ramer–Douglas–Peucker: the sampled points of a stroke without those that lie within `tolerance` px of the line through their neighbours. */
export function simplifyStroke(points: [number, number][], tolerance = DRAW_DEFAULTS.tolerance): [number, number][] {
  if (points.length <= 2) return points.slice();
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!, [ax, ay] = points[first], [bx, by] = points[last], dx = bx - ax, dy = by - ay, length = Math.hypot(dx, dy);
    let worst = -1, distance = tolerance;
    for (let index = first + 1; index < last; index++) {
      const [px, py] = points[index];
      const off = length === 0 ? Math.hypot(px - ax, py - ay) : Math.abs(dy * px - dx * py + bx * ay - by * ax) / length;
      if (off > distance) { distance = off; worst = index; }
    }
    if (worst >= 0) { keep[worst] = true; stack.push([first, worst], [worst, last]); }
  }
  return points.filter((_, index) => keep[index]);
}

/** A point is on a stroke when it lies within half the stroke width (plus `reach`) of one of its segments: what the eraser touches. */
export function strokeHit(stroke: DrawnStroke, point: [number, number], reach = 0): boolean {
  const limit = stroke.width / 2 + reach;
  for (let index = 0; index < stroke.points.length - 1; index++) {
    const [ax, ay] = stroke.points[index], [bx, by] = stroke.points[index + 1], dx = bx - ax, dy = by - ay, square = dx * dx + dy * dy;
    const t = square === 0 ? 0 : Math.min(1, Math.max(0, ((point[0] - ax) * dx + (point[1] - ay) * dy) / square));
    if (Math.hypot(point[0] - (ax + t * dx), point[1] - (ay + t * dy)) <= limit) return true;
  }
  return false;
}

/** The stored geometry of strokes: their bounding box expanded by half the largest width, its centre, and the strokes relative to that centre. */
export function drawingGeometry(strokes: DrawnStroke[], newId: () => string): { intrinsicWidth: number; intrinsicHeight: number; position: { x: number; y: number }; strokes: Stroke[] } {
  const xs = strokes.flatMap((stroke) => stroke.points.map((point) => point[0])), ys = strokes.flatMap((stroke) => stroke.points.map((point) => point[1]));
  const pad = Math.max(...strokes.map((stroke) => stroke.width)) / 2;
  const left = Math.min(...xs) - pad, right = Math.max(...xs) + pad, top = Math.min(...ys) - pad, bottom = Math.max(...ys) + pad, position = { x: (left + right) / 2, y: (top + bottom) / 2 };
  return {
    intrinsicWidth: right - left, intrinsicHeight: bottom - top, position,
    strokes: strokes.map((stroke) => ({ id: newId(), width: stroke.width, color: stroke.color, brush: stroke.brush, points: stroke.points.map(([x, y]) => [roundStored(x - position.x, 2), roundStored(y - position.y, 2)] as [number, number]) }) as Stroke),
  };
}

/** "Done" of the Draw tool: one drawing element with all the strokes, at the playhead on the first free graphic track, selected, one step. */
export function addDrawingAt(options: { sceneId: string; strokes: DrawnStroke[]; time: number; duration?: number }): TimelineCommand<{ elementId: string }> {
  return {
    type: "drawing.add", label: "Draw", sceneId: options.sceneId,
    run(draft: ProjectDocument, env) {
      const fps = fpsOf(draft), geometry = drawingGeometry(options.strokes.map((stroke) => ({ ...stroke, points: simplifyStroke(stroke.points) })).filter((stroke) => stroke.points.length >= 2), env.newId);
      const element = createElement("graphic", {
        id: env.newId(), name: "Drawing", startTime: snapToFrame(Math.max(0, options.time), fps), duration: snapToFrame(options.duration ?? FACTORY_INSERT_DEFAULTS.stickerDuration, fps), definitionId: "drawing", params: { colorOverride: "" },
        intrinsicWidth: geometry.intrinsicWidth, intrinsicHeight: geometry.intrinsicHeight, transform: { position: geometry.position, scale: { x: 1, y: 1 }, rotation: 0 }, strokes: geometry.strokes,
      }) as unknown as El;
      placeElements(sceneById(draft, options.sceneId), [element], { strategy: "firstAvailable" }, env);
      return { selection: [element.id], info: { elementId: element.id } };
    },
  };
}
