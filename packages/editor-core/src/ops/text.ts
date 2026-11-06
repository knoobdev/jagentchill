import { TEXT_STYLE_KEYS, type ProjectDocument } from "@jagentchill/protocol";
import { TEXT_BUBBLES } from "../content/text/bubbles.ts";
import { TEXT_PRESETS, type TextPreset } from "../content/text/presets.ts";
import { isObject, type Json } from "../model.ts";
import { roundStored } from "../canonical.ts";
import { edit, editable, elementIn, reject, type Commit, type CommitContext } from "./shared.ts";

/** `text-and-titles`: the operations of the text inspector and the Text asset tab. */

export const TEXT_CONTENT_LIMIT = 10_000;
/** Content holds at most 10 000 Unicode characters; `shortened` tells the screen to say so. */
export function clampTextContent(content: string): { content: string; shortened: boolean } {
  const characters = Array.from(content);
  return characters.length > TEXT_CONTENT_LIMIT ? { content: characters.slice(0, TEXT_CONTENT_LIMIT).join(""), shortened: true } : { content, shortened: false };
}
/** What the timeline bar of a text element reads: the first 30 characters of the first non-empty line, or "Text". */
export function textBarLabel(content: unknown): string {
  const line = String(content ?? "").split("\n").map((entry) => entry.trim()).find((entry) => entry.length > 0);
  return line ? Array.from(line).slice(0, 30).join("") : "Text";
}
/** A font size as stored: 1–500, one decimal. */
export const storedFontSize = (value: number): number => Math.min(500, Math.max(1, Math.round(value * 10) / 10));
/** The rendered font size in canvas pixels. */
export const renderedFontSize = (fontSize: number, canvasHeight: number): number => (fontSize * canvasHeight) / 90;

const merged = (element: Json, key: string, change: Json): Json => ({ ...(isObject(element[key]) ? (element[key] as Json) : {}), ...change });

/**
 * The fields a preset writes: fill, stroke, shadow and glow at the catalogue values, a feature the row leaves out
 * disabled with its other values kept. `null` is the tile "None": no stroke, shadow or glow, and a solid white fill.
 */
export function presetFields(element: Json, preset: TextPreset | null): Json {
  const feature = <T extends object>(key: string, value: T | undefined): Json => merged(element, key, value ? { enabled: true, ...value } : { enabled: false });
  return {
    color: preset?.color ?? "#ffffff",
    fill: merged(element, "fill", preset?.gradient ? { type: "gradient", gradientColor: preset.gradient.color, gradientAngle: preset.gradient.angle } : { type: "solid" }),
    stroke: feature("stroke", preset?.stroke), shadow: feature("shadow", preset?.shadow), glow: feature("glow", preset?.glow),
    stylePresetId: preset?.id,
  };
}
const presetById = (id: string | null): TextPreset | null => (id === null ? null : TEXT_PRESETS.find((preset) => preset.id === id) ?? reject("document/unknown-reference", "", `"${id}" is not a text effect preset`));
const writeFields = (element: Json, fields: Json): void => { for (const [key, value] of Object.entries(fields)) { if (value === undefined) delete element[key]; else element[key] = value; } };

/** Applies an effect preset to text elements as one step; content, font, size, alignment, box, curve, background, bubble, transform and animations stay. */
export function applyTextPreset(doc: ProjectDocument, ctx: CommitContext, elementIds: string[], presetId: string | null): Commit {
  const preset = presetById(presetId);
  return edit(doc, ctx, { commandType: "text.preset", label: "Text effect" }, (draft) => {
    for (const id of elementIds) { const element = editable(elementIn(draft, id)); if (element.type === "text") writeFields(element, presetFields(element, preset)); }
  });
}

/** The keys "Copy style" takes: every text parameter except content, transform, opacity, blend mode and animations. */
export const TEXT_STYLE_COPY_KEYS: readonly string[] = TEXT_STYLE_KEYS.filter((key) => key !== "textAnimation");
export type CopiedTextStyle = Record<string, unknown>;
export function copyTextStyle(doc: ProjectDocument, elementId: string): CopiedTextStyle {
  const element = elementIn(structuredClone(doc), elementId).element as unknown as Json;
  if (element.type !== "text") reject("document/element-type-mismatch", "", "a style is copied from a text element");
  return Object.fromEntries(TEXT_STYLE_COPY_KEYS.map((key) => [key, structuredClone(element[key])]));
}
function writeStyle(element: Json, style: CopiedTextStyle): void {
  if (element.type === "text") {
    for (const key of TEXT_STYLE_COPY_KEYS) { if (style[key] === undefined) delete element[key]; else element[key] = structuredClone(style[key]); }
  } else if (element.type === "caption") {
    // A caption has no bubble; the copied style becomes its own override of the track style.
    const { bubble: _bubble, ...rest } = style;
    element.style = structuredClone(Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined)));
  }
}
/** "Paste style": the copied style on every selected text or caption element, one step. */
export function pasteTextStyle(doc: ProjectDocument, ctx: CommitContext, elementIds: string[], style: CopiedTextStyle): Commit {
  return edit(doc, ctx, { commandType: "text.style.paste", label: "Paste style" }, (draft) => { for (const id of elementIds) writeStyle(editable(elementIn(draft, id)), style); });
}
/** The text elements of a scene other than the source: what "Apply to all text" would change. */
export function otherTextElements(doc: ProjectDocument, sceneId: string, sourceId: string): string[] {
  const scene = doc.scenes.find((entry) => entry.id === sceneId);
  if (!scene) return [];
  return [...scene.tracks.overlay, scene.tracks.main, ...scene.tracks.audio].flatMap((track) => track.elements as unknown as Json[]).filter((element) => element.type === "text" && element.id !== sourceId).map((element) => String(element.id));
}
export function applyStyleToAllText(doc: ProjectDocument, ctx: CommitContext, sceneId: string, sourceId: string): Commit {
  const style = copyTextStyle(doc, sourceId), targets = otherTextElements(doc, sceneId, sourceId);
  return edit(doc, ctx, { commandType: "text.style.apply-all", label: "Apply to all text" }, (draft) => { for (const id of targets) writeStyle(editable(elementIn(draft, id)), style); });
}

/** Chooses a bubble (`null` removes it). A bubble and the text background are exclusive: the background is turned off in the same step. */
export function setTextBubble(doc: ProjectDocument, ctx: CommitContext, elementId: string, bubbleId: string | null, change: Json = {}): Commit {
  if (bubbleId !== null && !TEXT_BUBBLES.some((bubble) => bubble.id === bubbleId)) reject("document/unknown-reference", "", `"${bubbleId}" is not a text bubble`);
  return edit(doc, ctx, { commandType: "text.bubble", label: "Bubble" }, (draft) => {
    const element = editable(elementIn(draft, elementId));
    if (bubbleId === null) { delete element.bubble; return; }
    const catalogue = TEXT_BUBBLES.find((bubble) => bubble.id === bubbleId)!;
    const kept = isObject(element.bubble) && element.bubble.id === bubbleId ? (element.bubble as Json) : {};
    element.bubble = { color: catalogue.color, strokeColor: catalogue.strokeColor, strokeWidth: catalogue.strokeWidth, flipHorizontal: false, ...kept, ...change, id: bubbleId };
    element.background = merged(element, "background", { enabled: false });
  });
}
/** Turns the text background on or off; turning it on removes the bubble in the same step. */
export function setTextBackground(doc: ProjectDocument, ctx: CommitContext, elementId: string, change: Json): Commit {
  return edit(doc, ctx, { commandType: "text.background", label: "Background" }, (draft) => {
    const element = editable(elementIn(draft, elementId));
    element.background = merged(element, "background", change);
    if ((element.background as Json).enabled === true) delete element.bubble;
  });
}

const TENTH = 12_000;
export type TextAnimationSlot = { id: string; duration?: number; period?: number; strength?: number } | null;
/**
 * In and Out last 0.1 s to the element duration and together never exceed it: the group being set keeps its value and
 * the other gives way. Loop has a period of 0.2–5 s. Ticks in, ticks out.
 */
export function clampTextAnimation(duration: number, current: Json | undefined, group: "in" | "out" | "loop", slot: TextAnimationSlot): Json | undefined {
  const next: Json = { ...(current ?? {}) };
  if (slot === null) delete next[group];
  else if (group === "loop") next.loop = { id: slot.id, period: Math.min(600_000, Math.max(24_000, Math.round(slot.period ?? 120_000))), strength: Math.min(100, Math.max(0, slot.strength ?? 100)) };
  else {
    const own = Math.min(duration, Math.max(TENTH, Math.round(slot.duration ?? 60_000)));
    next[group] = { id: slot.id, duration: own, strength: Math.min(100, Math.max(0, slot.strength ?? 100)) };
    const other = group === "in" ? "out" : "in";
    if (isObject(next[other]) && Number((next[other] as Json).duration) + own > duration) next[other] = { ...(next[other] as Json), duration: Math.max(0, duration - own) };
  }
  return Object.keys(next).length > 0 ? next : undefined;
}
/** Sets or removes one animation group of a text element (or of a caption's own style). */
export function setTextAnimation(doc: ProjectDocument, ctx: CommitContext, elementId: string, group: "in" | "out" | "loop", slot: TextAnimationSlot): Commit {
  return edit(doc, ctx, { commandType: "text.animation", label: "Text animation" }, (draft) => {
    const element = editable(elementIn(draft, elementId));
    const holder = element.type === "caption" ? ((isObject(element.style) ? element.style : (element.style = {})) as Json) : element;
    const next = clampTextAnimation(Number(element.duration), isObject(holder.textAnimation) ? (holder.textAnimation as Json) : undefined, group, slot);
    if (next) holder.textAnimation = next; else delete holder.textAnimation;
  });
}

/**
 * Auto ↔ Fixed. Switching to fixed sets `box.width` to the current block width (`blockWidth` in canvas pixels, as the
 * engine laid it out), so the layout does not change.
 */
export function setTextBoxMode(doc: ProjectDocument, ctx: CommitContext, elementId: string, mode: "auto" | "fixed", blockWidth?: number): Commit {
  return edit(doc, ctx, { commandType: "text.box", label: "Text box" }, (draft) => {
    const element = editable(elementIn(draft, elementId));
    const change: Json = { mode };
    if (mode === "fixed" && blockWidth !== undefined && blockWidth > 0) change.width = Math.min(400, Math.max(5, roundStored((blockWidth / draft.settings.canvasSize.width) * 100, 1)));
    element.box = merged(element, "box", change);
  });
}

/** B toggles between 400 and 700, or the nearest weights the family has. */
export function toggledBoldWeight(current: number, available: readonly number[] = [400, 700]): number {
  const nearest = (target: number) => [...available].sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b)[0] ?? target;
  return current >= 600 ? nearest(400) : nearest(700);
}
export const FONT_WEIGHT_NAMES: Record<number, string> = { 100: "Thin", 200: "Extra light", 300: "Light", 400: "Regular", 500: "Medium", 600: "Semi bold", 700: "Bold", 800: "Extra bold", 900: "Black" };

// — "My presets": the user's saved text styles, kept per device —
export type SavedTextPreset = { id: string; name: string; style: CopiedTextStyle; animation?: unknown; savedAt_ms: number };
export const SAVED_PRESET_LIMIT = 200;
export type SavePresetResult = { ok: true; presets: SavedTextPreset[] } | { ok: false; reason: "limit" | "name" | "duplicate"; message: string };
/** Saves a preset under a name of 1–60 characters. An existing name is refused unless `onDuplicate` says what to do with it. */
export function saveTextPreset(presets: SavedTextPreset[], entry: Omit<SavedTextPreset, "name"> & { name: string }, onDuplicate?: "replace" | "keep-both"): SavePresetResult {
  const name = entry.name.trim();
  if (name.length < 1 || Array.from(name).length > 60) return { ok: false, reason: "name", message: "Name must be 1–60 characters" };
  const existing = presets.find((preset) => preset.name === name);
  if (existing && !onDuplicate) return { ok: false, reason: "duplicate", message: "A preset with this name already exists" };
  if (existing && onDuplicate === "replace") return { ok: true, presets: presets.map((preset) => (preset === existing ? { ...entry, name } : preset)) };
  if (presets.length >= SAVED_PRESET_LIMIT) return { ok: false, reason: "limit", message: "Preset limit reached (200)" };
  let unique = name;
  for (let suffix = 2; presets.some((preset) => preset.name === unique); suffix++) unique = `${name} ${suffix}`;
  return { ok: true, presets: [...presets, { ...entry, name: unique }] };
}
