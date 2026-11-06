import { TEXT_BUBBLES } from "@jagentchill/editor-core";
import { resolveColor, resolveNumber } from "../resolve/animation.ts";
import { byteOffset, type TextSpec } from "./layout.ts";

type Styled = Record<string, any>;
const upperFirst = (word: string): string => word.charAt(0).toLocaleUpperCase() + word.slice(1).toLocaleLowerCase();
export function applyTextCase(content: string, textCase: string | undefined): string {
  if (textCase === "upper") return content.toLocaleUpperCase();
  if (textCase === "lower") return content.toLocaleLowerCase();
  if (textCase === "title") return content.replace(/\S+/g, upperFirst);
  return content;
}

/** FNV-1a 32-bit of a string's UTF-8 bytes: the seed and cache-key hash of the engine. */
export function fnv1a(text: string): number {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(text)) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  return hash >>> 0;
}

/**
 * The raster description of a styled text at a clip time. The rendered font size is `fontSize × canvasHeight / 90`;
 * `rasterHeight` is the height of the canvas being rendered, so every length scales with the render size.
 */
export function textSpec(style: Styled, content: string, fonts: string[], clipTime: number, raster: { width: number; height: number }): TextSpec {
  const number = (path: string, fallback: number) => resolveNumber(style, path, clipTime, fallback);
  const color = (path: string, fallback: string) => resolveColor(style, path, clipTime, fallback);
  const size = (number("fontSize", 15) * raster.height) / 90;
  const percent = (value: number) => (value / 100) * size;
  const spec: TextSpec = {
    content: applyTextCase(content, style.textCase), fonts, size,
    letterSpacing: percent(number("letterSpacing", 0)), lineHeight: number("lineHeight", 1.2), align: style.textAlign ?? "center",
    color: color("color", "#ffffff"), underline: style.underline === true, strikethrough: style.strikethrough === true,
  };
  if (style.box?.mode === "fixed") spec.maxWidth = (number("box.width", 80) / 100) * raster.width;
  if (style.fill?.type === "gradient") spec.gradient = { color: color("fill.gradientColor", "#ffd400"), angle: number("fill.gradientAngle", 90) };
  if (style.stroke?.enabled && number("stroke.width", 6) > 0) spec.stroke = { color: color("stroke.color", "#000000"), width: percent(number("stroke.width", 6)), position: style.stroke.position ?? "outside" };
  if (style.shadow?.enabled) spec.shadow = { color: color("shadow.color", "#000000"), opacity: number("shadow.opacity", 80) / 100, blur: percent(number("shadow.blur", 10)), distance: percent(number("shadow.distance", 5)), angle: number("shadow.angle", -45) };
  if (style.glow?.enabled) spec.glow = { color: color("glow.color", "#ffffff"), intensity: number("glow.intensity", 50), sigma: percent(number("glow.radius", 20)) / 3 };
  const curve = Math.min(Math.max(number("curve", 0), -360), 360);
  if (curve !== 0) spec.curve = curve;
  // An unknown bubble id renders without a bubble; the stored reference is not touched.
  const bubble = style.bubble?.id ? TEXT_BUBBLES.find((entry) => entry.id === style.bubble.id) : undefined;
  if (bubble) {
    // The text is laid out in a box of the area width: the box of the element when it is fixed, 80 % of the canvas otherwise.
    spec.maxWidth ??= 0.8 * raster.width;
    spec.bubble = {
      path: bubble.path, area: bubble.textArea, color: color("bubble.color", bubble.color), strokeColor: color("bubble.strokeColor", bubble.strokeColor),
      strokeWidth: percent(number("bubble.strokeWidth", bubble.strokeWidth)), flip: style.bubble.flipHorizontal === true, strokeOnly: bubble.strokeOnly === true,
    };
  }
  // A bubble and the background are mutually exclusive: with both stored, the bubble is drawn.
  if (style.background?.enabled && !bubble) {
    // Padding is scaled by fontSize / 15 and, like every length, by the raster size.
    const scale = (number("fontSize", 15) / 15) * (raster.height / 1080);
    spec.background = {
      color: color("background.color", "#000000"), cornerRadius: number("background.cornerRadius", 0), paddingX: number("background.paddingX", 30) * scale, paddingY: number("background.paddingY", 42) * scale,
      offsetX: number("background.offsetX", 0) * (raster.height / 1080), offsetY: number("background.offsetY", 0) * (raster.height / 1080),
    };
  }
  return spec;
}

export type CaptionWord = { text: string; start: number; end: number };
export type WordState = "upcoming" | "active" | "spoken";
/** State of each word at a clip time: the active word is the one whose `[start, end)` contains it; between words the previous one stays active. */
export function wordStates(words: CaptionWord[], clipTime: number): WordState[] {
  let active = -1;
  words.forEach((word, index) => { if (word.start <= clipTime) active = index; });
  return words.map((_, index) => (index < active ? "spoken" : index === active ? "active" : "upcoming"));
}

/** Byte ranges of the words inside the caption text, found in order. */
export function wordRanges(content: string, words: CaptionWord[]): { start: number; end: number }[] {
  let from = 0;
  return words.map((word) => {
    const found = content.indexOf(word.text, from);
    const index = found < 0 ? from : found;
    from = index + word.text.length;
    return { start: byteOffset(content, index), end: byteOffset(content, from) };
  });
}

/** The per-word ranges a highlight style adds to a caption's raster description. */
export function highlightRanges(content: string, words: CaptionWord[] | undefined, clipTime: number, highlight: { style: string; color: string; textColor: string; scale?: number }): TextSpec["ranges"] {
  if (!words?.length || highlight.style === "none") return undefined;
  const states = wordStates(words, clipTime);
  return wordRanges(content, words).flatMap((range, index): NonNullable<TextSpec["ranges"]> => {
    const state = states[index];
    if (highlight.style === "reveal") return state === "upcoming" ? [{ ...range, hidden: true }] : [];
    if (highlight.style === "karaoke") {
      // Spoken words stay filled; the active word fills from its left edge in step with its own timing.
      if (state === "spoken") return [{ ...range, color: highlight.color }];
      if (state !== "active") return [];
      const word = words[index], span = Math.max(word.end - word.start, 1);
      // Quantised to 1/64 of the word so that the texture is not rasterised again for an invisible change.
      return [{ ...range, fill: { color: highlight.color, progress: Math.round(Math.min(Math.max((clipTime - word.start) / span, 0), 1) * 64) / 64 } }];
    }
    if (state !== "active") return [];
    if (highlight.style === "color") return [{ ...range, color: highlight.color }];
    if (highlight.style === "background") return [{ ...range, box: highlight.color, color: highlight.textColor }];
    if (highlight.style === "underline") return [{ ...range, underline: true, underlineColor: highlight.color }];
    if (highlight.style === "scale") return [{ ...range, scale: Math.min(Math.max(highlight.scale ?? 1.2, 1), 2) }];
    return [];
  });
}

/**
 * Word timings of a caption that has none: its duration distributed over its words in proportion to their
 * character counts. Times are element-local ticks.
 */
export function synthesiseWords(text: string, duration: number): CaptionWord[] {
  const words = text.split(/\s+/u).filter(Boolean);
  const total = words.reduce((sum, word) => sum + [...word].length, 0);
  if (total === 0) return [];
  let spent = 0;
  return words.map((word) => {
    const start = Math.round((spent / total) * duration);
    spent += [...word].length;
    return { text: word, start, end: Math.round((spent / total) * duration) };
  });
}
