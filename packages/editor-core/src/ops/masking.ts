import { BLEND_MODES, chromaKeySchema, MASK_PARAM_KEYS, MASK_PARAM_SHAPE, MASK_VARIANTS, numberRange, type MaskParamKey, type MaskType, type PathPoint, type ProjectDocument, type Rational } from "@jagentchill/protocol";
import type { z } from "zod";
import { clone, isObject, type Json } from "../model.ts";
import { refuse } from "../timeline/model.ts";
import { writeKey } from "./animation.ts";
import { keyTime, resolvedValue } from "./keyframes.ts";
import { edit, editable, elementIn, type Commit, type CommitContext } from "./shared.ts";

/**
 * Mask, blend and chroma-key commands (`masks-blending-keying`): the mask list of an element and each mask's
 * parameters, the geometry the canvas handles work in, pen-path points, and the keying values. How a mask or a key
 * looks is the renderer's; these commands only write the stored data, one undo step each.
 */

export const MASKABLE_TYPES = ["video", "image", "graphic", "sticker", "compound", "adjustment"] as const;
export const isMaskable = (element: { type: string }): boolean => (MASKABLE_TYPES as readonly string[]).includes(element.type);
export const MASK_LIMIT = 8;
export const MASK_LIMIT_MESSAGE = "Maximum of 8 masks per clip";
/** The "Add mask" menu, in order, with the names users see. */
export const MASK_MENU: readonly { type: MaskType; name: string }[] = [
  { type: "split", name: "Split" }, { type: "mirror", name: "Mirror" }, { type: "cinematic-bars", name: "Filmstrip" }, { type: "rectangle", name: "Rectangle" }, { type: "ellipse", name: "Ellipse" },
  { type: "heart", name: "Heart" }, { type: "diamond", name: "Diamond" }, { type: "star", name: "Star" }, { type: "text", name: "Text" }, { type: "freeform", name: "Pen tool" },
];
export const MASK_COMBINE = ["add", "subtract", "intersect", "exclude"] as const;
export const maskTypeName = (type: string): string => MASK_MENU.find((entry) => entry.type === type)?.name.replace("Pen tool", "Pen") ?? type;
export type MaskEntry = { id: string; type: MaskType; enabled: boolean; combine: (typeof MASK_COMBINE)[number]; params: Record<string, unknown> };
export const masksOf = (element: Json): MaskEntry[] => (Array.isArray(element.masks) ? (element.masks as MaskEntry[]) : []);
/** A mask of a type with that type's defaults (a box-like one is a square of 60 % of the short side, centred). */
export const defaultMask = (type: MaskType, id: string): MaskEntry => (MASK_VARIANTS[type] as z.ZodTypeAny).parse({ id, type }) as MaskEntry;
/** "Ellipse 1", "Rectangle 2": the type's name and its number among the element's masks. */
export const maskName = (masks: MaskEntry[], mask: MaskEntry): string => `${maskTypeName(mask.type)} ${masks.indexOf(mask) + 1}`;
export const maskHas = (type: MaskType, key: string): boolean => MASK_PARAM_KEYS[type]?.includes(key as MaskParamKey) === true;
export const maskParamRange = (key: string): { min: number; max: number } | undefined => numberRange(MASK_PARAM_SHAPE[key as MaskParamKey]);
/** Displayed ↔ stored units: centre −100…100 % ↔ −1…1, scale 1–500 % ↔ 0.01–5, feather 0–100 % ↔ 0–1000, sizes as percent of the short side. */
const DISPLAY_FACTOR: Record<string, number> = { centerX: 100, centerY: 100, scale: 100, feather: 0.1, width: 100, height: 100, size: 100, innerRatio: 100 };
export const maskDisplay = (key: string, stored: number): number => Math.round(stored * (DISPLAY_FACTOR[key] ?? 1) * 100) / 100;
export const maskStored = (key: string, shown: number): number => shown / (DISPLAY_FACTOR[key] ?? 1);

const maskIn = (element: Json, maskId: string): MaskEntry => masksOf(element).find((mask) => mask.id === maskId) ?? refuse("This mask no longer exists", "unknown-mask");
const dropChannels = (element: Json, maskId: string): void => {
  if (!isObject(element.animations)) return;
  for (const path of Object.keys(element.animations)) if (path.startsWith(`masks.${maskId}.`)) delete element.animations[path];
  if (Object.keys(element.animations).length === 0) delete element.animations;
};
/** Adds a mask with the defaults of its type; the ninth is refused. Returns the new id through `info`. */
export function addMaskOfType(doc: ProjectDocument, ctx: CommitContext, elementId: string, type: MaskType, maskId = ctx.newId()): Commit {
  return edit(doc, ctx, { commandType: "mask.add", label: "Add mask" }, (draft) => {
    const element = editable(elementIn(draft, elementId));
    if (!isMaskable(element as never)) refuse("Select a clip that can be masked", "not-maskable");
    const masks = (Array.isArray(element.masks) ? element.masks : (element.masks = [])) as MaskEntry[];
    if (masks.length >= MASK_LIMIT) refuse(MASK_LIMIT_MESSAGE, "OUT_OF_RANGE");
    masks.push(defaultMask(type, maskId));
  });
}
/** Removes a mask and its keyframe channels. */
export function removeMask(doc: ProjectDocument, ctx: CommitContext, elementId: string, maskId: string): Commit {
  return edit(doc, ctx, { commandType: "mask.remove", label: "Remove mask" }, (draft) => {
    const element = editable(elementIn(draft, elementId));
    element.masks = masksOf(element).filter((mask) => mask.id !== maskId);
    dropChannels(element, maskId);
  });
}
/** "Reset": the type's default params, keyframes removed; the mask keeps its id, place in the list, combine mode and enabled state. */
export function resetMask(doc: ProjectDocument, ctx: CommitContext, elementId: string, maskId: string): Commit {
  return edit(doc, ctx, { commandType: "mask.reset", label: "Reset mask" }, (draft) => {
    const element = editable(elementIn(draft, elementId)), mask = maskIn(element, maskId);
    mask.params = defaultMask(mask.type, maskId).params;
    dropChannels(element, maskId);
  });
}
/** A copy of a mask right after it, with its keyframes under new ids; pen point ids are kept. */
export function duplicateMask(doc: ProjectDocument, ctx: CommitContext, elementId: string, maskId: string, copyId = ctx.newId()): Commit {
  return edit(doc, ctx, { commandType: "mask.duplicate", label: "Duplicate mask" }, (draft) => {
    const element = editable(elementIn(draft, elementId)), masks = masksOf(element), mask = maskIn(element, maskId);
    if (masks.length >= MASK_LIMIT) refuse(MASK_LIMIT_MESSAGE, "OUT_OF_RANGE");
    masks.splice(masks.indexOf(mask) + 1, 0, { ...clone(mask), id: copyId });
    if (!isObject(element.animations)) return;
    for (const [path, channel] of Object.entries(element.animations)) {
      if (!path.startsWith(`masks.${maskId}.`)) continue;
      const copy = clone(channel) as Json, fresh = new Map<string, string>();
      for (const part of "r" in copy ? ["r", "g", "b", "a"].map((name) => copy[name] as Json) : [copy]) for (const key of part.keys as Json[]) { if (!fresh.has(String(key.id))) fresh.set(String(key.id), ctx.newId()); key.id = fresh.get(String(key.id)); }
      element.animations[path.replace(`masks.${maskId}.`, `masks.${copyId}.`)] = copy;
    }
  });
}
/** Moves a mask to another place of the list (drag, Alt+Up, Alt+Down). */
export function reorderMask(doc: ProjectDocument, ctx: CommitContext, elementId: string, maskId: string, toIndex: number): Commit {
  return edit(doc, ctx, { commandType: "mask.reorder", label: "Reorder masks" }, (draft) => {
    const element = editable(elementIn(draft, elementId)), masks = masksOf(element), from = masks.findIndex((mask) => mask.id === maskId);
    if (from < 0) return;
    const [mask] = masks.splice(from, 1);
    masks.splice(Math.min(masks.length, Math.max(0, toIndex)), 0, mask);
  });
}
/** Enable, combine mode — the fields of the mask entry itself. */
export function setMaskField(doc: ProjectDocument, ctx: CommitContext, elementId: string, maskId: string, change: { enabled?: boolean; combine?: (typeof MASK_COMBINE)[number] }): Commit {
  return edit(doc, ctx, { commandType: "mask.set", label: change.combine ? "Combine mode" : "Mask" }, (draft) => { Object.assign(maskIn(editable(elementIn(draft, elementId)), maskId), change); });
}
/** A mask parameter in stored units, clamped to its range (a size never goes under 0.01). */
export function clampMaskParam(key: string, value: number): number {
  const range = maskParamRange(key);
  const clamped = range ? Math.min(range.max, Math.max(range.min, value)) : value;
  if (key === "rotation") return ((Math.round(value * 100) / 100) % 360 + 360) % 360;
  return key === "feather" || key === "strokeWidth" || key === "opacity" || key === "points" || key === "cornerRadius" ? Math.round(clamped) : Math.round(clamped * 1e6) / 1e6;
}
/**
 * Writes parameters of one mask as one step. A numeric parameter that has keyframes gets a key at the playhead; the
 * others (and `inverted`, colours, text) are stored. A key the type does not declare is refused.
 */
export function setMaskParams(doc: ProjectDocument, ctx: CommitContext, elementId: string, maskId: string, params: Record<string, number | boolean | string>, playhead?: number, label = "Mask"): Commit {
  return edit(doc, ctx, { commandType: "mask.params", label }, (draft) => {
    const ref = elementIn(draft, elementId), element = editable(ref), mask = maskIn(element, maskId);
    for (const [key, raw] of Object.entries(params)) {
      if (!maskHas(mask.type, key)) refuse(`A ${maskTypeName(mask.type)} mask has no "${key}"`, "INVALID_PARAMS");
      const value = typeof raw === "number" ? clampMaskParam(key, raw) : typeof raw === "string" && key === "strokeColor" ? raw.toLowerCase() : raw;
      const path = `masks.${maskId}.params.${key}`;
      if (playhead !== undefined && isObject(element.animations) && element.animations[path] && typeof value !== "boolean") writeKey(element, ref.elementPath, path, { time: keyTime(element, playhead - Number(element.startTime), draft.settings.fps as Rational), value }, ctx.newId);
      else mask.params[key] = value;
    }
  });
}
/** The value a mask parameter shows at an element-local time. */
export const maskParamAt = (element: Json, mask: MaskEntry, key: string, local: number): unknown => resolvedValue(element, `masks.${mask.id}.params.${key}`, local, mask.params[key]);

// — Canvas geometry —
export type MaskFrame = { /** Centre in canvas px. */ cx: number; cy: number; /** Size in canvas px (0 for a line). */ width: number; height: number; /** Degrees: the element's rotation plus the mask's. */ rotation: number; shape: "line" | "band" | "box" | "point" };
export type ElementBox = { cx: number; cy: number; width: number; height: number; rotation: number };
const rad = (degrees: number): number => (degrees * Math.PI) / 180;
const turn = (x: number, y: number, degrees: number): { x: number; y: number } => ({ x: x * Math.cos(rad(degrees)) - y * Math.sin(rad(degrees)), y: x * Math.sin(rad(degrees)) + y * Math.cos(rad(degrees)) });
/**
 * Where a mask sits on the canvas, from the box of its element: the centre is a fraction of the element's half size,
 * sizes are fractions of its short side, and everything turns with the element.
 */
export function maskFrame(box: ElementBox, mask: MaskEntry, at: (key: string) => number = (key) => Number(mask.params[key] ?? 0)): MaskFrame {
  const short = Math.min(box.width, box.height), offset = turn((at("centerX") * box.width) / 2, (at("centerY") * box.height) / 2, box.rotation);
  const scale = maskHas(mask.type, "scale") ? at("scale") || 1 : 1, base = { cx: box.cx + offset.x, cy: box.cy + offset.y, rotation: box.rotation + at("rotation") };
  if (mask.type === "split") return { ...base, width: Math.hypot(box.width, box.height), height: 0, shape: "line" };
  if (mask.type === "mirror") return { ...base, width: Math.hypot(box.width, box.height), height: at("size") * short, shape: "band" };
  if (mask.type === "cinematic-bars") return { ...base, width: Math.hypot(box.width, box.height), height: at("height") * short * scale, shape: "band" };
  if (mask.type === "text" || mask.type === "freeform") return { ...base, width: short * 0.5 * scale, height: short * 0.25 * scale, shape: "point" };
  return { ...base, width: at("width") * short * scale, height: at("height") * short * scale, shape: "box" };
}
export type MaskHandle = "move" | "rotate" | "feather" | "nw" | "ne" | "se" | "sw" | "n" | "s" | "e" | "w" | "radius";
/** The handles a mask type shows: corners and edges for box-like ones, top and bottom for height-only ones, one corner for text and pen. */
export function maskHandles(type: MaskType): MaskHandle[] {
  if (type === "split") return ["move", "rotate", "feather"];
  if (type === "cinematic-bars" || type === "mirror") return ["move", "n", "s", "rotate", "feather"];
  if (type === "text" || type === "freeform") return ["move", "se", "rotate", "feather"];
  return ["move", "nw", "ne", "se", "sw", "n", "s", "e", "w", "rotate", "feather", ...(type === "rectangle" ? (["radius"] as MaskHandle[]) : [])];
}
/** Canvas positions of a mask's handles; rotate and feather sit `offset` canvas px (20 screen px) off the shape. */
export function maskHandlePoints(frame: MaskFrame, type: MaskType, offset: number): Partial<Record<MaskHandle, { x: number; y: number }>> {
  const w = frame.shape === "box" || frame.shape === "point" ? frame.width / 2 : 0, h = frame.height / 2;
  const local: Partial<Record<MaskHandle, [number, number]>> = { nw: [-w, -h], ne: [w, -h], se: [w, h], sw: [-w, h], n: [0, -h], s: [0, h], e: [w, 0], w: [-w, 0], rotate: [0, -h - offset], feather: [0, h + offset], radius: [-w + Math.min(w, h) * 0.3, -h + Math.min(w, h) * 0.3], move: [0, 0] };
  return Object.fromEntries(maskHandles(type).map((handle) => { const [x, y] = local[handle]!, placed = turn(x, y, frame.rotation); return [handle, { x: frame.cx + placed.x, y: frame.cy + placed.y }]; }));
}
/** The feather a drag of the feather handle gives: the projected distance ÷ 0.11, clamped 0–1000. */
export const featherFromDrag = (start: number, projectedScreenPx: number): number => Math.round(Math.min(1000, Math.max(0, start + projectedScreenPx / 0.11)));
/** The rotation a drag of the rotate handle gives: the angle of the pointer about the mask's pivot, relative to where the drag began. */
export function rotationFromDrag(startRotation: number, pivot: { x: number; y: number }, from: { x: number; y: number }, to: { x: number; y: number }, snap = false): number {
  const angle = (point: { x: number; y: number }) => (Math.atan2(point.y - pivot.y, point.x - pivot.x) * 180) / Math.PI;
  const next = startRotation + angle(to) - angle(from), snapped = snap ? Math.round(next / 15) * 15 : next;
  return ((Math.round(snapped * 100) / 100) % 360 + 360) % 360;
}
/**
 * The params a drag of one handle gives, in stored units. `delta`: pointer movement in canvas px; the frame and the
 * element box are those at the start of the drag.
 */
export function dragMaskHandle(mask: MaskEntry, box: ElementBox, start: Record<string, number>, handle: MaskHandle, delta: { x: number; y: number }, options: { snap?: boolean; shift?: boolean } = {}): Record<string, number> {
  const short = Math.max(1, Math.min(box.width, box.height));
  if (handle === "move") {
    // The pointer moves in canvas space; the centre is stored in the element's own.
    const own = turn(delta.x, delta.y, -box.rotation), constrained = options.shift ? (Math.abs(own.x) >= Math.abs(own.y) ? { x: own.x, y: 0 } : { x: 0, y: own.y }) : own;
    let x = start.centerX + constrained.x / (box.width / 2), y = start.centerY + constrained.y / (box.height / 2);
    if (options.snap) { if (Math.abs(x) < 0.03) x = 0; if (Math.abs(y) < 0.03) y = 0; }
    return { centerX: clampMaskParam("centerX", x), centerY: clampMaskParam("centerY", y) };
  }
  const local = turn(delta.x, delta.y, -(box.rotation + (start.rotation ?? 0))), scale = maskHas(mask.type, "scale") ? start.scale || 1 : 1;
  if (mask.type === "text" || mask.type === "freeform") return { scale: clampMaskParam("scale", scale * (1 + (local.x + local.y) / short)) };
  const out: Record<string, number> = {};
  // A handle moves one edge: the size grows by twice the movement, about the centre.
  const grow = (key: string, amount: number) => { out[key] = Math.max(0.01, clampMaskParam(key, (start[key] ?? 0.6) + (2 * amount) / (short * scale))); };
  const key = mask.type === "mirror" ? "size" : "height";
  if (handle.includes("n")) grow(key, -local.y); else if (handle.includes("s")) grow(key, local.y);
  if (maskHas(mask.type, "width") && mask.type !== "cinematic-bars") { if (handle.includes("w")) grow("width", -local.x); else if (handle.includes("e")) grow("width", local.x); }
  // Corners resize uniformly: both sides by the factor of the larger change.
  if (handle.length === 2 && out.width !== undefined && out.height !== undefined) { const factor = Math.max(out.width / start.width, out.height / start.height); out.width = Math.max(0.01, clampMaskParam("width", start.width * factor)); out.height = Math.max(0.01, clampMaskParam("height", start.height * factor)); }
  if (handle === "radius") return { cornerRadius: clampMaskParam("cornerRadius", (start.cornerRadius ?? 0) + ((local.x + local.y) / (Math.min(start.width, start.height) * short * scale)) * 100) };
  return out;
}

// — Pen path —
const pathOf = (mask: MaskEntry): PathPoint[] => (Array.isArray(mask.params.path) ? (mask.params.path as PathPoint[]) : []);
/** Every key of the mask's path channel holds the whole point list: a change of the list is made in each of them. */
function eachPathKey(element: Json, maskId: string, change: (points: PathPoint[]) => PathPoint[]): void {
  const channel = isObject(element.animations) ? (element.animations[`masks.${maskId}.params.path`] as Json | undefined) : undefined;
  for (const key of ((channel?.keys ?? []) as Json[])) (key.value as Json).points = change(((key.value as Json).points ?? []) as PathPoint[]);
}
/** Appends a pen point, or inserts one after `afterId`; closing needs three points. */
export function addPathPoint(doc: ProjectDocument, ctx: CommitContext, elementId: string, maskId: string, point: { x: number; y: number }, afterId?: string): Commit {
  return edit(doc, ctx, { commandType: "mask.path", label: "Add point" }, (draft) => {
    const element = editable(elementIn(draft, elementId)), mask = maskIn(element, maskId);
    if (pathOf(mask).length >= 256) refuse("Maximum of 256 points per path", "OUT_OF_RANGE");
    const made: PathPoint = { id: ctx.newId(), x: Math.round(point.x * 1e5) / 1e5, y: Math.round(point.y * 1e5) / 1e5, inX: 0, inY: 0, outX: 0, outY: 0 };
    const place = (points: PathPoint[]) => { const at = afterId ? points.findIndex((entry) => entry.id === afterId) : points.length - 1; const next = [...points]; next.splice(at + 1, 0, { ...made }); return next; };
    mask.params.path = place(pathOf(mask));
    eachPathKey(element, maskId, place);
  });
}
/** Closes (or opens) a path; a path of fewer than three points stays open and masks nothing. */
export function setPathClosed(doc: ProjectDocument, ctx: CommitContext, elementId: string, maskId: string, closed: boolean): Commit {
  return edit(doc, ctx, { commandType: "mask.path", label: closed ? "Close path" : "Open path" }, (draft) => { const mask = maskIn(editable(elementIn(draft, elementId)), maskId); mask.params.closed = closed && pathOf(mask).length >= 3; });
}
/** Moves points by a delta (element space), or sets the tangents of one. */
export function editPathPoints(doc: ProjectDocument, ctx: CommitContext, elementId: string, maskId: string, pointIds: string[], change: { dx?: number; dy?: number; tangents?: Partial<Pick<PathPoint, "inX" | "inY" | "outX" | "outY">> }): Commit {
  return edit(doc, ctx, { commandType: "mask.path", label: "Edit path" }, (draft) => {
    const mask = maskIn(editable(elementIn(draft, elementId)), maskId), ids = new Set(pointIds), round = (value: number) => Math.round(value * 1e5) / 1e5 || 0;
    mask.params.path = pathOf(mask).map((point) => (ids.has(point.id) ? { ...point, x: round(point.x + (change.dx ?? 0)), y: round(point.y + (change.dy ?? 0)), ...Object.fromEntries(Object.entries(change.tangents ?? {}).map(([key, value]) => [key, round(value as number)])) } : point));
  });
}
/** Deletes pen points; a closed path left with fewer than three opens. */
export function removePathPoints(doc: ProjectDocument, ctx: CommitContext, elementId: string, maskId: string, pointIds: string[]): Commit {
  return edit(doc, ctx, { commandType: "mask.path", label: "Delete points" }, (draft) => {
    const element = editable(elementIn(draft, elementId)), mask = maskIn(element, maskId), ids = new Set(pointIds), keep = (points: PathPoint[]) => points.filter((point) => !ids.has(point.id));
    mask.params.path = keep(pathOf(mask));
    if (pathOf(mask).length < 3) mask.params.closed = false;
    eachPathKey(element, maskId, keep);
  });
}

// — Blend and chroma key —
export const BLEND_MODE_NAMES: Record<string, string> = Object.fromEntries(BLEND_MODES.map((mode) => [mode, mode.replace(/(^|-)([a-z])/g, (_, dash: string, letter: string) => (dash ? ` ${letter}` : letter.toUpperCase()))]));
/** A stored blend mode this build does not know renders, and is shown, as Normal. */
export const blendModeOf = (element: Json): string => ((BLEND_MODES as readonly string[]).includes(String(element.blendMode)) ? String(element.blendMode) : "normal");
export const CHROMA_DEFAULTS = chromaKeySchema.parse({}) as { enabled: boolean; color: string; strength: number; edge: number; shadow: number; spill: number };
export const isKeyable = (element: { type: string }): boolean => element.type === "video" || element.type === "image";
export const chromaOf = (element: Json): typeof CHROMA_DEFAULTS => ({ ...CHROMA_DEFAULTS, ...(isObject(element.chromaKey) ? (element.chromaKey as object) : {}) });
/**
 * Writes chroma key values as one step. The object appears with its defaults the first time; a numeric value that has
 * keyframes gets a key at the playhead.
 */
export function setChromaKey(doc: ProjectDocument, ctx: CommitContext, elementId: string, change: Partial<typeof CHROMA_DEFAULTS>, playhead?: number): Commit {
  return edit(doc, ctx, { commandType: "chroma.set", label: "Chroma key" }, (draft) => {
    const ref = elementIn(draft, elementId), element = editable(ref);
    if (!isKeyable(element as never)) refuse("Select a video or image clip", "not-keyable");
    const chroma = (isObject(element.chromaKey) ? element.chromaKey : (element.chromaKey = { ...CHROMA_DEFAULTS })) as Json;
    for (const [key, raw] of Object.entries(change)) {
      const value = typeof raw === "number" ? Math.round(Math.min(100, Math.max(0, raw))) : typeof raw === "string" ? raw.slice(0, 7).toLowerCase() : raw;
      const path = `chromaKey.${key}`;
      if (playhead !== undefined && typeof value === "number" && isObject(element.animations) && element.animations[path]) writeKey(element, ref.elementPath, path, { time: keyTime(element, playhead - Number(element.startTime), draft.settings.fps as Rational), value }, ctx.newId);
      else chroma[key] = value;
    }
  });
}
/** "Reset" of the Chroma key section: the object and its keyframes are removed. */
export function resetChromaKey(doc: ProjectDocument, ctx: CommitContext, elementId: string): Commit {
  return edit(doc, ctx, { commandType: "chroma.reset", label: "Reset chroma key" }, (draft) => {
    const element = editable(elementIn(draft, elementId));
    delete element.chromaKey;
    if (isObject(element.animations)) { for (const path of Object.keys(element.animations)) if (path.startsWith("chromaKey.")) delete element.animations[path]; if (Object.keys(element.animations).length === 0) delete element.animations; }
  });
}
/** The average colour of sampled source pixels (RGBA bytes) as lowercase `#rrggbb`: what the eyedropper picks. */
export function averageColor(pixels: ArrayLike<number>): string {
  let r = 0, g = 0, b = 0, count = 0;
  for (let index = 0; index + 3 < pixels.length; index += 4) { r += pixels[index]; g += pixels[index + 1]; b += pixels[index + 2]; count++; }
  const hex = (value: number) => Math.round(count ? value / count : 0).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
