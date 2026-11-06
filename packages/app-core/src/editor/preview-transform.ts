import { timeline } from "@jagentchill/editor-core";
import type { ProjectDocument } from "@jagentchill/protocol";
import { gridLines, safeAreaRect, type GuideSettings, type Point, type Size } from "./preview-view.ts";

/** An element's rotated rectangle on the canvas: centre from the canvas centre, size before rotation, degrees clockwise. */
export type Box = { id: string; cx: number; cy: number; width: number; height: number; rotation: number };
const rad = (degrees: number): number => (degrees * Math.PI) / 180;
const rotate = (point: Point, degrees: number): Point => { const c = Math.cos(rad(degrees)), s = Math.sin(rad(degrees)); return { x: point.x * c - point.y * s, y: point.x * s + point.y * c }; };

/**
 * The rotated rectangle behind the axis-aligned bounds the engine reports (`layout.query`: top-left origin). The two
 * are the same without rotation; with it the sides are solved from the bounds, and at the one angle where they
 * cannot be (45° and its quarter turns) the aspect ratio given decides.
 */
export function boxFromBounds(id: string, bounds: { x: number; y: number; width: number; height: number }, rotation: number, canvas: Size, aspect?: number): Box {
  const c = Math.abs(Math.cos(rad(rotation))), s = Math.abs(Math.sin(rad(rotation))), determinant = c * c - s * s;
  let width = bounds.width, height = bounds.height;
  if (s > 1e-9) {
    if (Math.abs(determinant) > 1e-3) { width = (bounds.width * c - bounds.height * s) / determinant; height = (bounds.height * c - bounds.width * s) / determinant; }
    else { const ratio = aspect && aspect > 0 ? aspect : 1; height = bounds.width / ((ratio + 1) * Math.SQRT1_2); width = height * ratio; }
  }
  return { id, cx: bounds.x + bounds.width / 2 - canvas.width / 2, cy: bounds.y + bounds.height / 2 - canvas.height / 2, width: Math.max(0, width), height: Math.max(0, height), rotation };
}
/** The axis-aligned bounds of a box (rotation-aware), in canvas coordinates from the centre. */
export function boundsOf(box: Box): { left: number; top: number; right: number; bottom: number } {
  const c = Math.abs(Math.cos(rad(box.rotation))), s = Math.abs(Math.sin(rad(box.rotation)));
  const halfWidth = (box.width * c + box.height * s) / 2, halfHeight = (box.width * s + box.height * c) / 2;
  return { left: box.cx - halfWidth, top: box.cy - halfHeight, right: box.cx + halfWidth, bottom: box.cy + halfHeight };
}

const NON_VISUAL = new Set(["audio", "effect", "adjustment"]);
/**
 * The elements a pointer on the preview can hit, topmost first: live at the playhead, not hidden, not on a hidden
 * or locked track, never audio, effect or adjustment. Overlay track 0 is on top, the main track at the bottom; within
 * a track the later start wins, ties by id.
 */
export function hitCandidates(doc: ProjectDocument, sceneId: string, playhead: number): string[] {
  const scene = timeline.sceneById(doc, sceneId);
  return [...scene.tracks.overlay, scene.tracks.main].flatMap((track) => (track.hidden === true || track.locked ? [] : [...track.elements]
    .filter((element) => !NON_VISUAL.has(element.type) && element.hidden !== true && element.startTime <= playhead && playhead < timeline.endOf(element))
    .sort((a, b) => b.startTime - a.startTime || (a.id < b.id ? 1 : -1)).map((element) => element.id)));
}
export const pointInBox = (point: Point, box: Box): boolean => { const local = rotate({ x: point.x - box.cx, y: point.y - box.cy }, -box.rotation); return Math.abs(local.x) <= box.width / 2 && Math.abs(local.y) <= box.height / 2; };
/** The boxes under a canvas point, topmost first. `boxes` is in candidate order. */
export const hitTest = (boxes: readonly Box[], point: Point): string[] => boxes.filter((box) => pointInBox(point, box)).map((box) => box.id);

/**
 * A click on the canvas. Plain: the topmost hit alone, or nothing on empty canvas. Shift: toggles the hit. Alt: the
 * element underneath the selected one at that point, cycling back to the topmost.
 */
export function clickSelection(selected: readonly string[], hits: readonly string[], modifiers: { shift?: boolean; alt?: boolean } = {}): string[] {
  if (hits.length === 0) return modifiers.shift ? [...selected] : [];
  if (modifiers.shift) return selected.includes(hits[0]) ? selected.filter((id) => id !== hits[0]) : [...selected, hits[0]];
  if (modifiers.alt) { const at = hits.findIndex((id) => selected.includes(id)); return [hits[(at + 1) % hits.length]]; }
  return [hits[0]];
}
/** A marquee selects every candidate whose bounds intersect it; Shift adds to the selection. */
export function marqueeSelection(boxes: readonly Box[], a: Point, b: Point, selected: readonly string[] = [], additive = false): string[] {
  const left = Math.min(a.x, b.x), right = Math.max(a.x, b.x), top = Math.min(a.y, b.y), bottom = Math.max(a.y, b.y);
  const inside = boxes.filter((box) => { const bounds = boundsOf(box); return bounds.left <= right && bounds.right >= left && bounds.top <= bottom && bounds.bottom >= top; }).map((box) => box.id);
  return additive ? [...new Set([...selected, ...inside])] : inside;
}
/** What a drag moves: the selected element under the pointer when there is one, otherwise the topmost hit, which becomes the selection. */
export function dragTarget(selected: readonly string[], hits: readonly string[]): { ids: string[]; selection: string[] } | null {
  if (hits.length === 0) return null;
  const held = hits.find((id) => selected.includes(id));
  return held ? { ids: [...selected], selection: [...selected] } : { ids: [hits[0]], selection: [hits[0]] };
}
export const MOVE_THRESHOLD = 0.5;
/** The movement of a drag in canvas units: nothing below 0.5; Shift keeps the axis with the larger delta. */
export function moveDelta(start: Point, current: Point, shift = false): Point | null {
  const delta = { x: current.x - start.x, y: current.y - start.y };
  if (Math.hypot(delta.x, delta.y) < MOVE_THRESHOLD) return null;
  return shift ? (Math.abs(delta.x) >= Math.abs(delta.y) ? { x: delta.x, y: 0 } : { x: 0, y: delta.y }) : delta;
}
const NUDGES: Record<string, Point> = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, up: { x: 0, y: -1 }, down: { x: 0, y: 1 } };
/** `preview.nudge-*` moves 1 canvas px, `preview.nudge-far-*` 10. */
export function nudgeDelta(actionId: string): Point | null {
  const match = /^preview\.nudge-(far-)?(left|right|up|down)$/.exec(actionId);
  return match ? { x: NUDGES[match[2]].x * (match[1] ? 10 : 1), y: NUDGES[match[2]].y * (match[1] ? 10 : 1) } : null;
}

// — Handles —
export type HandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "rotate";
export const HANDLE = { corner: 10, cornerHit: 18, edge: { short: 6, long: 14 }, rotateRadius: 10, rotateOffset: 24, touchHit: 44 } as const;
const UNIT: Record<Exclude<HandleId, "rotate">, Point> = { nw: { x: -1, y: -1 }, n: { x: 0, y: -1 }, ne: { x: 1, y: -1 }, e: { x: 1, y: 0 }, se: { x: 1, y: 1 }, s: { x: 0, y: 1 }, sw: { x: -1, y: 1 }, w: { x: -1, y: 0 } };
/** Handles are shown for exactly one selected visual element that is live at the playhead on an unlocked, visible track. */
export const handlesFor = (selected: readonly string[], candidates: readonly string[]): string | null => (selected.length === 1 && candidates.includes(selected[0]) ? selected[0] : null);
/**
 * The handle positions in screen px. `scale` is screen px per canvas px; the rotate handle sits 24 screen px outside
 * the top-centre whatever the zoom, so handle sizes never change with it.
 */
export function handlePositions(box: Box, toScreenPoint: (point: Point) => Point, scale: number): Record<HandleId, Point> {
  const at = (unit: Point, outward = 0) => toScreenPoint({ ...((rotated) => ({ x: box.cx + rotated.x, y: box.cy + rotated.y }))(rotate({ x: (unit.x * box.width) / 2, y: (unit.y * box.height) / 2 - outward / scale }, box.rotation)) });
  return { ...(Object.fromEntries((Object.keys(UNIT) as Exclude<HandleId, "rotate">[]).map((id) => [id, at(UNIT[id])])) as Record<Exclude<HandleId, "rotate">, Point>), rotate: at(UNIT.n, HANDLE.rotateOffset) };
}
/** The handle under a screen point: corners first, then edges, then rotate. Touch widens every hit area to 44 pt. */
export function hitHandle(positions: Record<HandleId, Point>, point: Point, touch = false): HandleId | null {
  const within = (id: HandleId, half: number) => Math.abs(point.x - positions[id].x) <= half && Math.abs(point.y - positions[id].y) <= half;
  const corner = touch ? HANDLE.touchHit / 2 : HANDLE.cornerHit / 2, edge = touch ? HANDLE.touchHit / 2 : HANDLE.edge.long / 2 + 2;
  for (const id of ["nw", "ne", "se", "sw"] as const) if (within(id, corner)) return id;
  for (const id of ["n", "e", "s", "w"] as const) if (within(id, edge)) return id;
  return Math.hypot(point.x - positions.rotate.x, point.y - positions.rotate.y) <= (touch ? HANDLE.touchHit / 2 : HANDLE.rotateRadius + 2) ? "rotate" : null;
}
const CURSORS = ["ns-resize", "nesw-resize", "ew-resize", "nwse-resize"] as const;
/** The resize cursor of a handle follows its angle in 45° buckets. */
export function handleCursor(handle: HandleId, rotation: number): string {
  if (handle === "rotate") return "grab";
  const base = { n: 0, ne: 45, e: 90, se: 135, s: 180, sw: 225, w: 270, nw: 315 }[handle];
  return CURSORS[((Math.round((base + rotation) / 45) % 4) + 4) % 4];
}

export const SCALE_LIMITS = { min: 0.01, max: 100 } as const;
const clampScale = (value: number): number => Math.min(SCALE_LIMITS.max, Math.max(SCALE_LIMITS.min, Math.abs(value)));
export type ScaleResult = { scale: Point; position: Point; flip: { horizontal: boolean; vertical: boolean } };
/**
 * A drag of a corner or edge handle. Corner: uniform about the centre by the ratio of pointer distances; Shift
 * releases the aspect lock. Edge: that axis only, symmetric about the centre. Alt anchors the opposite corner or
 * edge instead. Dragging through the centre mirrors: the scale stays positive and the flip flag of the axis toggles.
 */
export function scaleWithHandle(input: { box: Box; scale: Point; position: Point; handle: Exclude<HandleId, "rotate">; start: Point; current: Point; shift?: boolean; alt?: boolean }): ScaleResult {
  const { box, handle } = input, unit = UNIT[handle];
  // With Alt the fixed point is the opposite corner or edge; otherwise the centre.
  const anchorLocal = input.alt ? { x: (-unit.x * box.width) / 2, y: (-unit.y * box.height) / 2 } : { x: 0, y: 0 };
  const anchor = ((rotated) => ({ x: box.cx + rotated.x, y: box.cy + rotated.y }))(rotate(anchorLocal, box.rotation));
  const local = (point: Point) => rotate({ x: point.x - anchor.x, y: point.y - anchor.y }, -box.rotation);
  const from = local(input.start), to = local(input.current);
  const ratio = (a: number, b: number) => (Math.abs(a) < 1e-6 ? 1 : b / a);
  let fx = 1, fy = 1;
  if (unit.x !== 0 && unit.y !== 0 && !input.shift) {
    const signed = ratio(Math.hypot(from.x, from.y), Math.hypot(to.x, to.y)) * (from.x * to.x + from.y * to.y < 0 ? -1 : 1);
    fx = signed; fy = signed;
  } else { if (unit.x !== 0) fx = ratio(from.x, to.x); if (unit.y !== 0) fy = ratio(from.y, to.y); }
  const scale = { x: clampScale(input.scale.x * fx), y: clampScale(input.scale.y * fy) };
  // What was really applied after clamping moves the centre when the anchor is not the centre.
  const applied = { x: scale.x / Math.abs(input.scale.x) * Math.sign(fx || 1), y: scale.y / Math.abs(input.scale.y) * Math.sign(fy || 1) };
  const centre = rotate({ x: -anchorLocal.x * applied.x, y: -anchorLocal.y * applied.y }, box.rotation);
  const position = input.alt ? { x: input.position.x + (anchor.x + centre.x - box.cx), y: input.position.y + (anchor.y + centre.y - box.cy) } : input.position;
  // A uniform drag through the centre is a half turn, which is both flips.
  return { scale, position, flip: { horizontal: fx < 0, vertical: fy < 0 } };
}

export const ROTATION_LIMITS = { min: -3600, max: 3600 } as const;
/**
 * A drag of the rotate handle: the angle swept about the centre. It snaps to multiples of 90° within ±5°; Shift
 * constrains to multiples of 15° instead; `Mod` disables snapping.
 */
export function rotateWithHandle(input: { centre: Point; start: Point; current: Point; rotation: number; shift?: boolean; mod?: boolean }): { rotation: number; snapped: boolean; label: string } {
  const angle = (point: Point) => (Math.atan2(point.y - input.centre.y, point.x - input.centre.x) * 180) / Math.PI;
  let swept = angle(input.current) - angle(input.start);
  swept = ((swept + 540) % 360) - 180;
  let rotation = input.rotation + swept, snapped = false;
  if (input.shift) { rotation = Math.round(rotation / 15) * 15; snapped = true; }
  else if (!input.mod) { const quarter = Math.round(rotation / 90) * 90; if (Math.abs(rotation - quarter) <= 5) { rotation = quarter; snapped = true; } }
  rotation = Math.min(ROTATION_LIMITS.max, Math.max(ROTATION_LIMITS.min, Math.round(rotation * 10) / 10));
  return { rotation, snapped, label: `${rotation.toFixed(1)}°` };
}
/** A rotation as the one representative in (−180, 180]. */
export const normaliseRotation = (degrees: number): number => { const turned = (((degrees % 360) + 360) % 360); return turned > 180 ? turned - 360 : turned; };
/** "Rotate 90°": clockwise; normalised without keyframes, and with keyframes the plain sum clamped to ±3600 (written as a key at the playhead). */
export const rotateQuarter = (current: number, hasKeyframes: boolean): number => (hasKeyframes ? Math.min(ROTATION_LIMITS.max, Math.max(ROTATION_LIMITS.min, current + 90)) : normaliseRotation(current + 90));
/** "Reset transform": position, scale, rotation and both flips; crop, opacity and the rest stay. */
export const RESET_TRANSFORM = { transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0 }, flip: { horizontal: false, vertical: false } } as const;
export const RESET_KEYFRAME_PATHS = ["transform.position.x", "transform.position.y", "transform.scale.x", "transform.scale.y", "transform.rotation"] as const;

// — Snapping —
export const PREVIEW_SNAP_PX = 8;
export type SnapLines = { x: number[]; y: number[] };
/** Everything a moving element can snap to, in canvas coordinates from the centre: canvas centre and edges, the active guides, and the centres and edges of the other elements. */
export function snapTargets(canvas: Size, guides: GuideSettings | null, others: readonly Box[]): SnapLines {
  const halfWidth = canvas.width / 2, halfHeight = canvas.height / 2;
  const lines: SnapLines = { x: [0, -halfWidth, halfWidth], y: [0, -halfHeight, halfHeight] };
  if (guides?.visible) {
    if (guides.grid.on) { const grid = gridLines(guides.grid.rows, guides.grid.columns, canvas); lines.x.push(...grid.vertical.map((x) => x - halfWidth)); lines.y.push(...grid.horizontal.map((y) => y - halfHeight)); }
    const safe = guides.safeArea.on ? safeAreaRect(guides.safeArea.preset, canvas) : null;
    if (safe) { lines.x.push(safe.x - halfWidth, safe.x + safe.width - halfWidth); lines.y.push(safe.y - halfHeight, safe.y + safe.height - halfHeight); }
    if (guides.custom.on) { lines.x.push(...guides.custom.vertical.map((x) => x - halfWidth)); lines.y.push(...guides.custom.horizontal.map((y) => y - halfHeight)); }
  }
  for (const box of others) { const bounds = boundsOf(box); lines.x.push(box.cx, bounds.left, bounds.right); lines.y.push(box.cy, bounds.top, bounds.bottom); }
  return lines;
}
/**
 * Snaps a box: its centre and its bounding edges against the targets, per axis the closest candidate within 8
 * screen px (`threshold` is that distance in canvas units). `Mod` or the "Snap in preview" toggle turn it off.
 */
export function snapBox(box: Box, targets: SnapLines, threshold: number, enabled = true): { dx: number; dy: number; lines: { x?: number; y?: number } } {
  if (!enabled) return { dx: 0, dy: 0, lines: {} };
  const bounds = boundsOf(box);
  const axis = (own: number[], lines: number[]) => {
    let best: { delta: number; line: number } | undefined;
    for (const edge of own) for (const line of lines) { const delta = line - edge; if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, line }; }
    return best;
  };
  const x = axis([box.cx, bounds.left, bounds.right], targets.x), y = axis([box.cy, bounds.top, bounds.bottom], targets.y);
  return { dx: x?.delta ?? 0, dy: y?.delta ?? 0, lines: { ...(x ? { x: x.line } : {}), ...(y ? { y: y.line } : {}) } };
}
export const snapThreshold = (screenScale: number): number => PREVIEW_SNAP_PX / screenScale;

// — Crop —
export type Crop = { left: number; top: number; right: number; bottom: number };
export const CROP_RATIOS: readonly { id: string; label: string; ratio: number | "free" | "original" }[] = [
  { id: "free", label: "Free", ratio: "free" }, { id: "original", label: "Original", ratio: "original" }, { id: "16:9", label: "16:9", ratio: 16 / 9 }, { id: "9:16", label: "9:16", ratio: 9 / 16 },
  { id: "1:1", label: "1:1", ratio: 1 }, { id: "4:3", label: "4:3", ratio: 4 / 3 }, { id: "3:4", label: "3:4", ratio: 3 / 4 }, { id: "4:5", label: "4:5", ratio: 4 / 5 }, { id: "2.35:1", label: "2.35:1", ratio: 2.35 },
];
export const CROP_NONE: Crop = { left: 0, top: 0, right: 0, bottom: 0 };
/** A crop kept legal: each side 0–0.99, opposite sides at most 0.99 together, and at least 16 source px left per side when the source allows it. */
export function clampCropTo(crop: Crop, source: Size): Crop {
  const side = (value: number) => Math.min(0.99, Math.max(0, value));
  const pair = (a: number, b: number, length: number): [number, number] => {
    const most = Math.min(0.99, length >= 32 ? 1 - 16 / length : 0.99);
    let first = side(a), second = side(b);
    if (first + second > most) second = Math.max(0, most - first);
    if (first + second > most) first = most - second;
    return [first, second];
  };
  const [left, right] = pair(crop.left, crop.right, source.width), [top, bottom] = pair(crop.top, crop.bottom, source.height);
  return { left, top, right, bottom };
}
/** The crop after dragging one of its 8 handles by a delta given in fractions of the source; a fixed ratio is kept by adjusting the other axis about the rectangle's centre. */
export function cropWithHandle(crop: Crop, handle: Exclude<HandleId, "rotate">, delta: Point, source: Size, ratio: number | null): Crop {
  const unit = UNIT[handle], next = { ...crop };
  if (unit.x < 0) next.left += delta.x; if (unit.x > 0) next.right -= delta.x;
  if (unit.y < 0) next.top += delta.y; if (unit.y > 0) next.bottom -= delta.y;
  let legal = clampCropTo(next, source);
  if (ratio) {
    const width = (1 - legal.left - legal.right) * source.width, height = (1 - legal.top - legal.bottom) * source.height;
    if (unit.x !== 0) { const wanted = Math.min(source.height, width / ratio) / source.height, spare = 1 - wanted, centre = (legal.top + (1 - legal.bottom)) / 2; const top = Math.min(spare, Math.max(0, centre - wanted / 2)); legal = { ...legal, top, bottom: spare - top }; }
    else { const wanted = Math.min(source.width, height * ratio) / source.width, spare = 1 - wanted, centre = (legal.left + (1 - legal.right)) / 2; const left = Math.min(spare, Math.max(0, centre - wanted / 2)); legal = { ...legal, left, right: spare - left }; }
    legal = clampCropTo(legal, source);
  }
  return legal;
}
/** Dragging inside the crop rectangle moves it within the source without changing its size. */
export function moveCrop(crop: Crop, delta: Point): Crop {
  const dx = Math.min(crop.right, Math.max(-crop.left, delta.x)), dy = Math.min(crop.bottom, Math.max(-crop.top, delta.y));
  return { left: crop.left + dx, right: crop.right - dx, top: crop.top + dy, bottom: crop.bottom - dy };
}
/** The crop of a ratio chosen from the menu: the largest rectangle of that ratio centred in the source ("Original" and "Free" clear nothing by themselves). */
export function cropForRatio(ratio: number, source: Size): Crop {
  const sourceRatio = source.width / source.height;
  if (ratio >= sourceRatio) { const keep = sourceRatio / ratio; return clampCropTo({ left: 0, right: 0, top: (1 - keep) / 2, bottom: (1 - keep) / 2 }, source); }
  const keep = ratio / sourceRatio;
  return clampCropTo({ left: (1 - keep) / 2, right: (1 - keep) / 2, top: 0, bottom: 0 }, source);
}
