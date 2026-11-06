import type { Wasm } from "../engine/wasm.ts";
import { motionUnits, type TextMotion } from "./motion.ts";
import { placeText, type Placement } from "./units.ts";

/** What the wasm shaper returns: lines of runs of positioned glyphs, on a 1/64 px grid. */
export type TextGlyph = { id: number; cluster: number; x: number; y: number; advance: number };
export type TextRun = { fontId: string; direction: "ltr" | "rtl"; glyphs: TextGlyph[] };
export type TextLine = { runs: TextRun[]; width: number; ascent: number; descent: number; x: number; baseline: number; start: number; end: number };
export type TextLayout = { lines: TextLine[]; width: number; height: number };

type Colour = string;
/** Everything that decides the pixels of a text texture. Lengths are in px at the raster size. */
export type TextSpec = {
  content: string;
  fonts: string[];
  size: number; letterSpacing: number; lineHeight: number; align: "left" | "center" | "right" | "justify";
  maxWidth?: number;
  color: Colour; gradient?: { color: Colour; angle: number };
  underline: boolean; strikethrough: boolean;
  stroke?: { color: Colour; width: number; position: "outside" | "center" };
  shadow?: { color: Colour; opacity: number; blur: number; distance: number; angle: number };
  glow?: { color: Colour; intensity: number; sigma: number };
  background?: { color: Colour; cornerRadius: number; paddingX: number; paddingY: number; offsetX: number; offsetY: number };
  /**
   * Per-range overrides of captions: byte ranges of the content drawn in another colour, boxed, underlined, hidden,
   * scaled about their centre, or filled from the left up to `fill.progress` of their width (karaoke).
   */
  ranges?: { start: number; end: number; color?: Colour; box?: Colour; underline?: boolean; underlineColor?: Colour; hidden?: boolean; scale?: number; fill?: { color: Colour; progress: number } }[];
  /** Degrees each line subtends on its arc: positive arches upward, negative downward, 0 is straight. */
  curve?: number;
  /** A bubble drawn behind the text: catalogue path on a 100 × 100 box, scaled so that `area` holds the text block. `strokeWidth` is px. */
  bubble?: { path: string; area: [number, number, number, number]; color: Colour; strokeColor: Colour; strokeWidth: number; flip: boolean; strokeOnly: boolean };
  /** The unit animations running at this clip time. */
  motion?: TextMotion;
  /** Extra room on every side, in px (a blurred layer needs it). */
  pad?: number;
};

/**
 * A laid-out text and the texture it is drawn into. `width × height` is the texture in layout px; `originX/Y` is
 * where layout (0, 0) sits in it; `block` is the placed glyph block in layout coordinates; `scale` (≤ 1) is the
 * raster px per layout px, below 1 only when the texture would otherwise pass the size limit.
 */
export type MeasuredText = { layout: TextLayout; width: number; height: number; originX: number; originY: number; block: { x: number; y: number; width: number; height: number }; scale: number; placement: Placement };
/** The largest texture a text is rasterised into: a side, and an area that bounds its memory. */
export type TextLimit = { side: number; area: number };
export const DEFAULT_TEXT_LIMIT: TextLimit = { side: 8192, area: 4096 * 4096 };

/** Where the bubble of a text sits around its block, in layout coordinates. */
export function bubbleBox(bubble: NonNullable<TextSpec["bubble"]>, block: MeasuredText["block"]): { x: number; y: number; scaleX: number; scaleY: number } {
  const [ax, ay, aw, ah] = bubble.area;
  const scaleX = block.width / Math.max(aw, 1e-6), scaleY = block.height / Math.max(ah, 1e-6);
  // A flipped bubble mirrors its text area with it.
  const left = bubble.flip ? 100 - ax - aw : ax;
  return { x: block.x - left * scaleX, y: block.y - ay * scaleY, scaleX, scaleY };
}

const encoder = new TextEncoder();
/** Byte offset of a UTF-16 index of a string, as the shaper counts clusters. */
export const byteOffset = (text: string, index: number): number => encoder.encode(text.slice(0, index)).length;

/** Lays a text out and sizes its texture: the block plus the padding its stroke, shadow, glow, background, bubble and motion need. */
export function measureText(wasm: Wasm, spec: TextSpec, limit: TextLimit = DEFAULT_TEXT_LIMIT): MeasuredText | null {
  const curved = (spec.curve ?? 0) !== 0;
  const layout = wasm.layoutText({
    // On a curve justify renders as centre.
    style: { fonts: spec.fonts, size: spec.size, letterSpacing: spec.letterSpacing, lineHeight: spec.lineHeight, align: curved && spec.align === "justify" ? "center" : spec.align }, content: spec.content, maxWidth: spec.maxWidth,
  }) as TextLayout | undefined;
  if (!layout || !Number.isFinite(layout.width) || !Number.isFinite(layout.height)) return null;
  const placement = placeText(spec, layout);
  let block = placement.bounds;
  if (spec.bubble && !curved && layout.lines.length > 0) {
    // A bubble holds the lines themselves, not the box they were wrapped in.
    const left = Math.min(...layout.lines.map((line) => line.x)), right = Math.max(...layout.lines.map((line) => line.x + line.width));
    if (right > left) block = placement.bounds = { ...block, x: left, width: right - left };
  }
  let left = 0, top = 0, right = 0, bottom = 0;
  const grow = (l: number, t: number, r: number, b: number) => { left = Math.max(left, l); top = Math.max(top, t); right = Math.max(right, r); bottom = Math.max(bottom, b); };
  const stroke = spec.stroke ? (spec.stroke.position === "outside" ? spec.stroke.width : spec.stroke.width / 2) : 0;
  // Glyphs overhang their advance box a little (italics, accents): a fifth of the size on every side.
  let overhang = spec.size * 0.2 + stroke + (spec.pad ?? 0);
  // Animated units leave their place by up to 0.8 of the font size; a scaled word grows about its centre.
  if (spec.motion && (motionUnits(spec.motion).length > 0 || spec.motion.loop?.id === "loop-glitch")) overhang += spec.size * Math.max(spec.motion.in?.strength ?? 0, spec.motion.out?.strength ?? 0, spec.motion.loop?.strength ?? 0);
  const scaled = Math.max(1, ...(spec.ranges ?? []).map((range) => range.scale ?? 1));
  if (scaled > 1) overhang += (scaled - 1) * spec.size * 2;
  grow(overhang, overhang, overhang, overhang);
  if (spec.shadow) {
    const radians = (spec.shadow.angle * Math.PI) / 180;
    const dx = Math.cos(radians) * spec.shadow.distance, dy = -Math.sin(radians) * spec.shadow.distance, reach = spec.shadow.blur * 2 + overhang;
    grow(reach - dx, reach - dy, reach + dx, reach + dy);
  }
  if (spec.glow) { const reach = spec.glow.sigma * 3 + overhang; grow(reach, reach, reach, reach); }
  if (spec.background) {
    const { paddingX, paddingY, offsetX, offsetY } = spec.background;
    grow(paddingX - offsetX, paddingY - offsetY, paddingX + offsetX, paddingY + offsetY);
  }
  if (spec.bubble) {
    const box = bubbleBox(spec.bubble, block), half = spec.bubble.strokeWidth / 2 + 1;
    grow(block.x - box.x + half, block.y - box.y + half, box.x + 100 * box.scaleX - (block.x + block.width) + half, box.y + 100 * box.scaleY - (block.y + block.height) + half);
  }
  const pad = (value: number) => Math.max(0, Math.ceil(value));
  const width = Math.max(2, pad(left) + Math.ceil(block.width) + pad(right)), height = Math.max(2, pad(top) + Math.ceil(block.height) + pad(bottom));
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  // A texture past the limits is rasterised smaller and stretched over the same quad: the layout does not change.
  const scale = Math.min(1, limit.side / width, limit.side / height, Math.sqrt(limit.area / (width * height)));
  return { layout, placement, block, scale, originX: pad(left) - block.x, originY: pad(top) - block.y, width, height };
}
