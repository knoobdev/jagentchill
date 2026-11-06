import { adjustmentsSchema, BASIC_KEYS, BASIC_UNSIGNED, CURVES, HSL_BANDS, WHEELS, type ProjectDocument, type Rational } from "@jagentchill/protocol";
import { clone, isObject, type Json } from "../model.ts";
import { refuse } from "../timeline/model.ts";
import { keyTime, resolvedValue, writeProperty } from "./keyframes.ts";
import { writeKey } from "./animation.ts";
import { edit, editable, elementIn, type Commit, type CommitContext } from "./shared.ts";

/**
 * Colour adjustment commands (`color-adjustment`): the five sections of `adjustments`, curves and wheels, LUT files,
 * copy and paste of a look, and the picture analysis behind Auto adjust and Colour match. The colour maths itself is
 * the renderer's; nothing here computes a pixel of the picture.
 */

export const ADJUSTMENT_SECTIONS = ["basic", "hsl", "curves", "wheels", "lut"] as const;
export type AdjustmentSection = (typeof ADJUSTMENT_SECTIONS)[number];
export const ADJUSTABLE_TYPES = ["video", "image", "sticker", "graphic", "compound", "adjustment"] as const;
export const isAdjustable = (element: { type: string }): boolean => (ADJUSTABLE_TYPES as readonly string[]).includes(element.type);
/** The sliders of the Basic section in the order the tab lays them out, with their range. */
export const BASIC_SLIDERS: readonly { key: (typeof BASIC_KEYS)[number]; label: string; min: number; max: number }[] = [
  ["exposure", "Exposure"], ["brightness", "Brightness"], ["contrast", "Contrast"], ["saturation", "Saturation"], ["vibrance", "Vibrance"], ["highlights", "Highlights"], ["shadows", "Shadows"], ["whites", "Whites"], ["blacks", "Blacks"],
  ["temperature", "Temperature"], ["tint", "Tint"], ["hue", "Hue"], ["sharpness", "Sharpness"], ["clarity", "Clarity"], ["fade", "Fade"], ["vignette", "Vignette"], ["grain", "Grain"],
].map(([key, label]) => ({ key: key as (typeof BASIC_KEYS)[number], label, min: key === "hue" ? -180 : (BASIC_UNSIGNED as readonly string[]).includes(key) ? 0 : -100, max: key === "hue" ? 180 : 100 }));
export const HSL_LABELS: Record<(typeof HSL_BANDS)[number], string> = { red: "Red", orange: "Orange", yellow: "Yellow", green: "Green", aqua: "Aqua", blue: "Blue", purple: "Purple", magenta: "Magenta" };
export const WHEEL_LABELS: Record<(typeof WHEELS)[number], string> = { shadows: "Shadows (lift)", midtones: "Midtones (gamma)", highlights: "Highlights (gain)" };
export { BASIC_KEYS, CURVES, HSL_BANDS, WHEELS };

/** A section as it is stored when first written: every value at its default. */
export const sectionDefaults = (section: AdjustmentSection): Json => ((adjustmentsSchema.parse({ [section]: {} }) as Json)[section] as Json);
const sectionOf = (element: Json, section: AdjustmentSection): Json => {
  const adjustments = (isObject(element.adjustments) ? element.adjustments : (element.adjustments = {})) as Json;
  return (isObject(adjustments[section]) ? adjustments[section] : (adjustments[section] = sectionDefaults(section))) as Json;
};
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const animatedPaths = (element: Json, section?: AdjustmentSection): string[] => Object.keys(isObject(element.animations) ? element.animations : {}).filter((path) => path.startsWith(section ? `adjustments.${section}.` : "adjustments."));
/** `true` when a section differs from its defaults or carries keyframes (the modified-state dot; Reset is enabled). */
export function sectionModified(element: Json, section: AdjustmentSection): boolean {
  const stored = (element.adjustments as Json | undefined)?.[section] as Json | undefined;
  if (animatedPaths(element, section).length > 0) return true;
  if (!isObject(stored)) return false;
  const { enabled: _a, ...values } = stored, { enabled: _b, ...defaults } = sectionDefaults(section);
  return !same(values, defaults);
}
export const sectionEnabled = (element: Json, section: AdjustmentSection): boolean => ((element.adjustments as Json | undefined)?.[section] as Json | undefined)?.enabled !== false;
/** The stored value of an adjustment path (`adjustments.basic.exposure`), or the section's default. */
export function adjustmentValue(element: Json, path: string, local: number): unknown {
  const [, section, ...rest] = path.split(".");
  let fallback: unknown = sectionDefaults(section as AdjustmentSection);
  for (const part of rest) fallback = isObject(fallback) ? fallback[part] : undefined;
  return resolvedValue(element, path, local, fallback);
}

/**
 * Writes one adjustment value on every given element as one step: a key at the playhead where the path has keys, the
 * stored value otherwise. The section appears with its defaults the first time one of its values is written.
 */
export function setAdjustment(doc: ProjectDocument, ctx: CommitContext, elementIds: string[], path: string, value: number, playhead: number, label = "Adjust"): Commit {
  const [, section] = path.split(".") as [string, AdjustmentSection];
  return edit(doc, ctx, { commandType: "adjustment.set", label }, (draft) => {
    for (const elementId of elementIds) {
      const ref = elementIn(draft, elementId), element = editable(ref);
      if (!isAdjustable(element as never)) continue;
      sectionOf(element, section);
      const local = keyTime(element, playhead - Number(element.startTime), draft.settings.fps as Rational);
      if (isObject(element.animations) && element.animations[path]) writeKey(element, ref.elementPath, path, { time: local, value }, ctx.newId);
      else { let target = element; const parts = path.split("."); for (const part of parts.slice(0, -1)) target = target[part] as Json; target[parts[parts.length - 1]] = value; }
    }
  });
}
export function setSectionEnabled(doc: ProjectDocument, ctx: CommitContext, elementIds: string[], section: AdjustmentSection, enabled: boolean): Commit {
  return edit(doc, ctx, { commandType: "adjustment.enable", label: enabled ? "Enable adjustment" : "Disable adjustment" }, (draft) => {
    for (const elementId of elementIds) sectionOf(editable(elementIn(draft, elementId)), section).enabled = enabled;
  });
}
function clearSection(element: Json, section: AdjustmentSection): void {
  if (isObject(element.adjustments)) { delete element.adjustments[section]; if (Object.keys(element.adjustments).length === 0) delete element.adjustments; }
  if (isObject(element.animations)) { for (const path of animatedPaths(element, section)) delete element.animations[path]; if (Object.keys(element.animations).length === 0) delete element.animations; }
}
/** Restores a section to its defaults and removes its keyframes; without a section, all five. */
export function resetAdjustments(doc: ProjectDocument, ctx: CommitContext, elementIds: string[], section?: AdjustmentSection): Commit {
  return edit(doc, ctx, { commandType: "adjustment.reset", label: section ? "Reset adjustment" : "Reset all adjustments" }, (draft) => {
    for (const elementId of elementIds) { const element = editable(elementIn(draft, elementId)); for (const name of section ? [section] : ADJUSTMENT_SECTIONS) clearSection(element, name); }
  });
}
export const hasAdjustmentKeyframes = (element: Json): boolean => animatedPaths(element).length > 0;

// — Curves —
export type CurvePoint2 = { x: number; y: number };
export const COLOR_CURVE = { maxPoints: 16, minGap: 0.01, nudge: 0.004, bigNudge: 0.04, removeDistance: 24 } as const;
const unit = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 1e4) / 1e4;
/** The monotone cubic (Fritsch–Carlson) through curve points at `x`, held outside the end points and clamped to 0–1. */
export function colorCurveAt(points: CurvePoint2[], x: number): number {
  if (x <= points[0].x) return points[0].y;
  const last = points[points.length - 1];
  if (x >= last.x) return last.y;
  const count = points.length, secants = points.slice(0, -1).map((point, index) => (points[index + 1].y - point.y) / (points[index + 1].x - point.x));
  const slopes = points.map((_, index) => (index === 0 ? secants[0] : index === count - 1 ? secants[count - 2] : secants[index - 1] * secants[index] <= 0 ? 0 : (secants[index - 1] + secants[index]) / 2));
  for (let index = 0; index < count - 1; index++) {
    if (secants[index] === 0) { slopes[index] = 0; slopes[index + 1] = 0; continue; }
    const a = slopes[index] / secants[index], b = slopes[index + 1] / secants[index], length = a * a + b * b;
    if (length > 9) { const scale = 3 / Math.sqrt(length); slopes[index] = scale * a * secants[index]; slopes[index + 1] = scale * b * secants[index]; }
  }
  const at = Math.max(0, points.findIndex((point) => point.x > x) - 1), from = points[at], to = points[at + 1], width = to.x - from.x, t = (x - from.x) / width;
  const value = (2 * t ** 3 - 3 * t * t + 1) * from.y + (t ** 3 - 2 * t * t + t) * width * slopes[at] + (3 * t * t - 2 * t ** 3) * to.y + (t ** 3 - t * t) * width * slopes[at + 1];
  return Math.min(1, Math.max(0, value));
}
/** Adds a point on the curve at `x`; `null` at the 16-point limit ("Maximum of 16 points") or on top of a neighbour. */
export function addColorCurvePoint(points: CurvePoint2[], x: number, y?: number): { points: CurvePoint2[]; index: number } | null {
  if (points.length >= COLOR_CURVE.maxPoints || points.some((point) => Math.abs(point.x - x) < COLOR_CURVE.minGap)) return null;
  const next = [...points, { x: unit(x), y: unit(y ?? colorCurveAt(points, x)) }].sort((a, b) => a.x - b.x);
  return { points: next, index: next.findIndex((point) => point.x === unit(x)) };
}
/** Moves a point: `x` between its neighbours (the first within 0–0.5, the last within 0.5–1), `y` within 0–1. */
export function moveColorCurvePoint(points: CurvePoint2[], index: number, to: CurvePoint2): CurvePoint2[] {
  const low = index === 0 ? 0 : points[index - 1].x + COLOR_CURVE.minGap, high = index === points.length - 1 ? 1 : points[index + 1].x - COLOR_CURVE.minGap;
  const x = Math.min(index === 0 ? Math.min(0.5, high) : high, Math.max(index === points.length - 1 ? Math.max(0.5, low) : low, to.x));
  return points.map((point, at) => (at === index ? { x: unit(x), y: unit(to.y) } : point));
}
/** Removes an interior point; the end points stay. */
export const removeColorCurvePoint = (points: CurvePoint2[], index: number): CurvePoint2[] => (index <= 0 || index >= points.length - 1 ? points : points.filter((_, at) => at !== index));
export const isDefaultCurve = (points: CurvePoint2[] | undefined): boolean => !points || same(points, [{ x: 0, y: 0 }, { x: 1, y: 1 }]);
/** Stores one of the four curves on every given element. */
export function setColorCurve(doc: ProjectDocument, ctx: CommitContext, elementIds: string[], channel: (typeof CURVES)[number], points: CurvePoint2[]): Commit {
  if (points.length > COLOR_CURVE.maxPoints) refuse("Maximum of 16 points", "INVALID_PARAMS");
  return edit(doc, ctx, { commandType: "adjustment.curve", label: "Curves" }, (draft) => {
    for (const elementId of elementIds) sectionOf(editable(elementIn(draft, elementId)), "curves")[channel] = points.map((point) => ({ x: unit(point.x), y: unit(point.y) }));
  });
}

// — Wheels —
/** A puck position kept inside the unit disc. */
export function clampPuck(x: number, y: number): { x: number; y: number } {
  const length = Math.hypot(x, y), scale = length > 1 ? 1 / length : 1;
  return { x: Math.round(x * scale * 1e4) / 1e4 || 0, y: Math.round(y * scale * 1e4) / 1e4 || 0 };
}
/** Moves a wheel's puck (and writes keys where its values are keyframed). */
export function setWheel(doc: ProjectDocument, ctx: CommitContext, elementIds: string[], wheel: (typeof WHEELS)[number], value: { x?: number; y?: number; luminance?: number }, playhead: number): Commit {
  let current = doc, last: Commit | null = null;
  const patch: Commit["patch"] = [];
  const puck = value.x !== undefined && value.y !== undefined ? clampPuck(value.x, value.y) : null;
  const writes: [string, number][] = [...(puck ? ([["x", puck.x], ["y", puck.y]] as [string, number][]) : []), ...(value.luminance !== undefined ? ([["luminance", Math.round(Math.min(100, Math.max(-100, value.luminance)))]] as [string, number][]) : [])];
  for (const [key, next] of writes) { last = setAdjustment(current, ctx, elementIds, `adjustments.wheels.${wheel}.${key}`, next, playhead, "Colour wheels"); current = last.document; patch.push(...last.patch); }
  return last ? { ...last, patch, commandType: "adjustment.wheel" } : edit(doc, ctx, { commandType: "adjustment.wheel", label: "Colour wheels" }, () => undefined);
}

// — LUT files —
export const LUT_LIMITS = { maxBytes: 32 * 1024 * 1024, max1d: 65536, max3d: 65, perLibrary: 500 } as const;
export class LutRejected extends Error {
  readonly reason: string;
  constructor(reason: string) { super(reason); this.name = "LutRejected"; this.reason = reason; }
}
export type ParsedLut = { format: "cube" | "3dl"; kind: "1d" | "3d"; size: number; title?: string; /** A 3D `.cube` text the renderer reads, whatever the file was. */ cube: string };
const fixed = (value: number): string => (Math.round(Math.min(1, Math.max(0, value)) * 1e6) / 1e6).toString();
const cubeText = (size: number, sample: (r: number, g: number, b: number) => [number, number, number]): string => {
  const lines = [`LUT_3D_SIZE ${size}`];
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) lines.push(sample(r / (size - 1), g / (size - 1), b / (size - 1)).map(fixed).join(" "));
  return `${lines.join("\n")}\n`;
};
/**
 * Reads a `.cube` (1D or 3D, `DOMAIN_MIN`/`DOMAIN_MAX` honoured) or `.3dl` (3D, 17/33/65) file. A file that cannot be
 * read throws `LutRejected` with the reason shown to the user; nothing is imported.
 */
export function parseLut(name: string, text: string, bytes = text.length): ParsedLut {
  if (bytes > LUT_LIMITS.maxBytes) throw new LutRejected("File is larger than 32 MiB");
  const extension = name.toLowerCase().slice(name.lastIndexOf(".") + 1);
  if (extension !== "cube" && extension !== "3dl") throw new LutRejected("Not a .cube or .3dl file");
  const rows: number[][] = [];
  let size1 = 0, size3 = 0, title: string | undefined, low = [0, 0, 0], high = [1, 1, 1], grid: number[] | null = null;
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.split("#")[0].trim();
    if (line === "") return;
    const parts = line.split(/\s+/), head = parts[0].toUpperCase();
    if (head === "TITLE") { title = line.slice(5).trim().replace(/^"|"$/g, ""); return; }
    if (head === "LUT_1D_SIZE") { size1 = Number(parts[1]); return; }
    if (head === "LUT_3D_SIZE") { size3 = Number(parts[1]); return; }
    if (head === "DOMAIN_MIN") { low = parts.slice(1, 4).map(Number); return; }
    if (head === "DOMAIN_MAX") { high = parts.slice(1, 4).map(Number); return; }
    if (/^[A-Z_]+$/.test(head) && extension === "cube") return;
    const numbers = parts.map(Number);
    if (numbers.some((value) => !Number.isFinite(value))) throw new LutRejected(`Malformed line ${index + 1}`);
    // The first numeric row of a .3dl file is its input grid.
    if (extension === "3dl" && grid === null && numbers.length !== 3) { grid = numbers; return; }
    if (numbers.length !== 3) throw new LutRejected(`Malformed line ${index + 1}`);
    rows.push(numbers);
  });
  if (extension === "3dl") {
    const size = Math.round(Math.cbrt(rows.length));
    if (![17, 33, 65].includes(size) || size ** 3 !== rows.length) throw new LutRejected("Unsupported LUT size");
    const peak = Math.max(...rows.map((row) => Math.max(...row))), depth = peak <= 1 ? 1 : 2 ** Math.ceil(Math.log2(peak + 1)) - 1;
    // .3dl lists blue fastest; .cube lists red fastest.
    const at = (r: number, g: number, b: number) => rows[r * size * size + g * size + b].map((value) => value / depth) as [number, number, number];
    return { format: "3dl", kind: "3d", size, title, cube: cubeText(size, (r, g, b) => at(Math.round(r * (size - 1)), Math.round(g * (size - 1)), Math.round(b * (size - 1)))) };
  }
  const span = high.map((value, index) => value - low[index] || 1), norm = (row: number[]) => row.map((value, index) => (value - low[index]) / span[index]) as [number, number, number];
  if (size3 > 0) {
    if (!Number.isInteger(size3) || size3 < 2 || size3 > LUT_LIMITS.max3d || rows.length !== size3 ** 3) throw new LutRejected("Unsupported LUT size");
    return { format: "cube", kind: "3d", size: size3, title, cube: cubeText(size3, (r, g, b) => norm(rows[Math.round(b * (size3 - 1)) * size3 * size3 + Math.round(g * (size3 - 1)) * size3 + Math.round(r * (size3 - 1))])) };
  }
  if (!Number.isInteger(size1) || size1 < 2 || size1 > LUT_LIMITS.max1d || rows.length !== size1) throw new LutRejected("Unsupported LUT size");
  // A 1D table is three independent channel curves: baked into a 33-point cube the renderer samples.
  const curve = (value: number, channel: number) => { const position = value * (size1 - 1), index = Math.min(size1 - 2, Math.floor(position)), mix = position - index; return norm(rows[index])[channel] * (1 - mix) + norm(rows[index + 1])[channel] * mix; };
  return { format: "cube", kind: "1d", size: size1, title, cube: cubeText(33, (r, g, b) => [curve(r, 0), curve(g, 1), curve(b, 2)]) };
}
export const lutIdOf = (sha256: string): string => `user:${sha256}`;
/** Records an imported LUT in the project (content-addressed: the same file is listed once). */
export function addLut(doc: ProjectDocument, ctx: CommitContext, lut: { sha256: string; name: string; format: "cube" | "3dl"; size: number }): Commit | null {
  const id = lutIdOf(lut.sha256), luts = (doc.media as unknown as { luts?: Json[] }).luts ?? [];
  if (luts.some((entry) => entry.id === id)) return null;
  if (luts.length >= LUT_LIMITS.perLibrary) refuse("LUT limit reached (500)", "limit");
  return edit(doc, ctx, { commandType: "lut.import", label: "Import LUT", history: false }, (draft) => {
    const media = draft.media as unknown as { luts?: Json[] };
    (media.luts ??= []).push({ id, name: lut.name.slice(0, 120), format: lut.format, size: lut.size, sha256: lut.sha256 });
  });
}
/** Applies a LUT to elements (`null` removes it), keeping the section's intensity. */
export function applyLut(doc: ProjectDocument, ctx: CommitContext, elementIds: string[], lutId: string | null): Commit {
  return edit(doc, ctx, { commandType: "adjustment.lut", label: lutId ? "Apply LUT" : "Remove LUT" }, (draft) => {
    for (const elementId of elementIds) {
      const section = sectionOf(editable(elementIn(draft, elementId)), "lut");
      if (lutId) { section.lutId = lutId; section.enabled = true; } else delete section.lutId;
    }
  });
}
/** Removes a LUT from the project's list and from every element that used it. */
export function removeLut(doc: ProjectDocument, ctx: CommitContext, lutId: string): Commit {
  return edit(doc, ctx, { commandType: "lut.remove", label: "Remove LUT" }, (draft) => {
    const media = draft.media as unknown as { luts?: Json[] };
    media.luts = (media.luts ?? []).filter((entry) => entry.id !== lutId);
    for (const scene of draft.scenes) for (const track of [scene.tracks.main, ...scene.tracks.overlay, ...scene.tracks.audio]) for (const element of track.elements as unknown as Json[]) {
      const lut = (element.adjustments as Json | undefined)?.lut as Json | undefined;
      if (isObject(lut) && lut.lutId === lutId) delete lut.lutId;
    }
  });
}

// — A look, copied —
export type CopiedLook = { adjustments: Json | null; animations: Json };
/** "Copy attributes" of the Adjustment tab: the five sections and their keyframes. */
export function copyLook(element: Json): CopiedLook {
  return { adjustments: isObject(element.adjustments) ? clone(element.adjustments) : null, animations: Object.fromEntries(animatedPaths(element).map((path) => [path, clone((element.animations as Json)[path])])) };
}
function placeLook(element: Json, look: CopiedLook, newId: () => string): void {
  for (const section of ADJUSTMENT_SECTIONS) clearSection(element, section);
  if (look.adjustments) element.adjustments = clone(look.adjustments);
  const duration = Number(element.duration);
  for (const [path, channel] of Object.entries(look.animations)) {
    const copy = clone(channel) as Json, fresh = new Map<string, string>();
    for (const part of "r" in copy ? ["r", "g", "b", "a"].map((name) => copy[name] as Json) : [copy]) {
      part.keys = (part.keys as Json[]).filter((key) => (key.time as number) <= duration).map((key) => { if (!fresh.has(String(key.id))) fresh.set(String(key.id), newId()); return { ...key, id: fresh.get(String(key.id)) }; });
    }
    if (((("r" in copy ? (copy.r as Json) : copy).keys as Json[]) ?? []).length === 0) continue;
    ((isObject(element.animations) ? element.animations : (element.animations = {})) as Json)[path] = copy;
  }
}
/** "Paste attributes": the copied look replaces the look of every given element, as one step. */
export function pasteLook(doc: ProjectDocument, ctx: CommitContext, elementIds: string[], look: CopiedLook, label = "Paste attributes"): Commit {
  return edit(doc, ctx, { commandType: "adjustment.paste", label }, (draft) => {
    for (const elementId of elementIds) { const element = editable(elementIn(draft, elementId)); if (isAdjustable(element as never)) placeLook(element, look, ctx.newId); }
  });
}
/** "Apply to all": the look of one element on every other adjustable clip of its scene. Returns how many received it. */
export function applyLookToAll(doc: ProjectDocument, ctx: CommitContext, sourceId: string): { commit: Commit; count: number } {
  const ref = elementIn(doc, sourceId), look = copyLook(ref.element as unknown as Json);
  const targets = [ref.scene.tracks.main, ...ref.scene.tracks.overlay].filter((track) => !track.locked).flatMap((track) => track.elements as unknown as Json[]).filter((element) => element.id !== sourceId && isAdjustable(element as never) && element.type !== "adjustment").map((element) => String(element.id));
  return { commit: pasteLook(doc, ctx, targets, look, "Apply to all"), count: targets.length };
}

// — Analysis —
export type PictureStats = { /** Mean of R, G, B (0–1, display-referred). */ mean: [number, number, number]; /** Luma at the 1st, 50th and 99th percentile. */ low: number; mid: number; high: number; saturation: number };
/** Statistics of an RGBA picture (8-bit, any size): what Auto adjust and Colour match read. */
export function pictureStats(pixels: Uint8Array | Uint8ClampedArray): PictureStats {
  const histogram = new Uint32Array(256);
  let r = 0, g = 0, b = 0, saturation = 0, count = 0;
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    if (pixels[index + 3] === 0) continue;
    const red = pixels[index] / 255, green = pixels[index + 1] / 255, blue = pixels[index + 2] / 255, max = Math.max(red, green, blue), min = Math.min(red, green, blue);
    r += red; g += green; b += blue; saturation += max === 0 ? 0 : (max - min) / max; count++;
    histogram[Math.round((0.2126 * red + 0.7152 * green + 0.0722 * blue) * 255)]++;
  }
  if (count === 0) return { mean: [0, 0, 0], low: 0, mid: 0.5, high: 1, saturation: 0 };
  const percentile = (fraction: number) => { let seen = 0; for (let level = 0; level < 256; level++) { seen += histogram[level]; if (seen >= count * fraction) return level / 255; } return 1; };
  return { mean: [r / count, g / count, b / count], low: percentile(0.01), mid: percentile(0.5), high: percentile(0.99), saturation: saturation / count };
}
const whole = (value: number, min = -100, max = 100): number => Math.round(Math.min(max, Math.max(min, value))) || 0;
/** "Auto adjust": Basic values that stretch the tonal range, centre the midtones and neutralise a colour cast, scaled by `strength` 0–100. */
export function autoAdjustValues(stats: PictureStats, strength = 100): Record<string, number> {
  const k = strength / 100, average = (stats.mean[0] + stats.mean[1] + stats.mean[2]) / 3;
  return {
    exposure: whole((0.5 - stats.mid) * 120 * k), contrast: whole((0.9 - (stats.high - stats.low)) * 80 * k), blacks: whole(-stats.low * 100 * k), whites: whole((1 - stats.high) * 100 * k),
    temperature: whole((stats.mean[2] - stats.mean[0]) * 200 * k), tint: whole((stats.mean[1] - average) * 300 * k), saturation: whole((0.35 - stats.saturation) * 60 * k),
  };
}
/** "Colour match": Basic values that bring one picture's brightness, contrast, balance and saturation to a reference's. */
export function colorMatchValues(target: PictureStats, reference: PictureStats): Record<string, number> {
  const targetAverage = (target.mean[0] + target.mean[1] + target.mean[2]) / 3, referenceAverage = (reference.mean[0] + reference.mean[1] + reference.mean[2]) / 3;
  return {
    exposure: whole((reference.mid - target.mid) * 120), contrast: whole(((reference.high - reference.low) - (target.high - target.low)) * 80),
    temperature: whole(((reference.mean[0] - reference.mean[2]) - (target.mean[0] - target.mean[2])) * 200), tint: whole(((target.mean[1] - targetAverage) - (reference.mean[1] - referenceAverage)) * 300),
    saturation: whole((reference.saturation - target.saturation) * 120),
  };
}
/** Writes several Basic values as one step (Auto adjust, Colour match, a preset). */
export function setBasicValues(doc: ProjectDocument, ctx: CommitContext, elementIds: string[], values: Record<string, number>, label: string, extra: Record<string, number> = {}): Commit {
  return edit(doc, ctx, { commandType: "adjustment.basic", label }, (draft) => {
    for (const elementId of elementIds) { const basic = sectionOf(editable(elementIn(draft, elementId)), "basic"); Object.assign(basic, values, extra, { enabled: true }); }
  });
}
export { writeProperty as writeElementProperty };
