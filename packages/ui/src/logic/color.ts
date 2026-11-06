/** Colour parsing and conversion for the ColorPicker. These are user-chosen content colours, not theme tokens. */
export type Hsva = { h: number; s: number; v: number; a: number };
export type Rgba = { r: number; g: number; b: number; a: number };
export type ColorFormat = "HEX" | "RGB" | "HSL" | "HSV";
export const COLOR_FORMATS: readonly ColorFormat[] = ["HEX", "RGB", "HSL", "HSV"];

const byte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
const two = (value: number) => byte(value).toString(16).padStart(2, "0").toUpperCase();

/** Hex with or without `#`, in 3, 4, 6 or 8 digits. */
export function parseHex(input: string): Rgba | null {
  const match = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(input.trim());
  if (!match) return null;
  let digits = match[1]!;
  if (digits.length <= 4) digits = [...digits].map((d) => d + d).join("");
  const n = (at: number) => parseInt(digits.slice(at, at + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: digits.length === 8 ? n(6) / 255 : 1 };
}
/** Uppercase hex; alpha is written only when the colour is not opaque. */
export function toHex(color: Rgba, withHash = true): string {
  const alpha = color.a < 1 ? two(color.a * 255) : "";
  return `${withHash ? "#" : ""}${two(color.r)}${two(color.g)}${two(color.b)}${alpha}`;
}
export function rgbToHsv({ r, g, b, a }: Rgba, keepHue = 0): Hsva {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B), min = Math.min(R, G, B), delta = max - min;
  // A grey has no hue of its own: the hue the user last chose is kept.
  let h = keepHue;
  if (delta > 0) {
    h = max === R ? ((G - B) / delta) % 6 : max === G ? (B - R) / delta + 2 : (R - G) / delta + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max, a };
}
export function hsvToRgb({ h, s, v, a }: Hsva): Rgba {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: byte((r + m) * 255), g: byte((g + m) * 255), b: byte((b + m) * 255), a };
}
function hslToRgb(h: number, s: number, l: number, a: number): Rgba {
  const v = l + s * Math.min(l, 1 - l);
  return hsvToRgb({ h, s: v === 0 ? 0 : 2 * (1 - l / v), v, a });
}
function rgbToHsl(color: Rgba): { h: number; s: number; l: number } {
  const { h, s, v } = rgbToHsv(color);
  const l = v * (1 - s / 2);
  return { h, s: l === 0 || l === 1 ? 0 : (v - l) / Math.min(l, 1 - l), l };
}
const numbers = (input: string) => (input.match(/-?\d*\.?\d+/g) ?? []).map(Number);
/** Parses text typed in the field of a format. Null for invalid input: the previous value is restored. */
export function parseColorText(input: string, format: ColorFormat, alpha = 1): Rgba | null {
  if (format === "HEX") {
    const hex = parseHex(input);
    return hex ? { ...hex, a: input.replace("#", "").trim().length % 4 === 0 ? hex.a : alpha } : null;
  }
  const [a, b, c] = numbers(input);
  if (a === undefined || b === undefined || c === undefined || numbers(input).length < 3) return null;
  if (format === "RGB") return a > 255 || b > 255 || c > 255 || a < 0 || b < 0 || c < 0 ? null : { r: byte(a), g: byte(b), b: byte(c), a: alpha };
  if (a < 0 || a > 360 || b < 0 || b > 100 || c < 0 || c > 100) return null;
  return format === "HSL" ? hslToRgb(a % 360, b / 100, c / 100, alpha) : hsvToRgb({ h: a % 360, s: b / 100, v: c / 100, a: alpha });
}
export function formatColorText(color: Rgba, format: ColorFormat): string {
  if (format === "HEX") return toHex({ ...color, a: 1 }, false);
  if (format === "RGB") return `${color.r}, ${color.g}, ${color.b}`;
  const round = Math.round;
  if (format === "HSL") { const { h, s, l } = rgbToHsl(color); return `${round(h)}, ${round(s * 100)}, ${round(l * 100)}`; }
  const { h, s, v } = rgbToHsv(color);
  return `${round(h)}, ${round(s * 100)}, ${round(v * 100)}`;
}
/**
 * Finds a colour in any pasted text. The current alpha is kept unless the pasted value carries its own.
 * `#FF000080` + "brand colour: #00ff00" → `#00FF0080`.
 */
export function extractColor(text: string, currentAlpha: number): Rgba | null {
  const functional = /(rgba?|hsla?)\(([^)]+)\)/i.exec(text);
  if (functional) {
    const parts = numbers(functional[2]!);
    if (parts.length >= 3) {
      const alpha = parts.length >= 4 ? Math.max(0, Math.min(1, /%/.test(functional[2]!.split(/[,/]/).at(-1)!) ? parts[3]! / 100 : parts[3]!)) : currentAlpha;
      return functional[1]!.toLowerCase().startsWith("rgb")
        ? { r: byte(parts[0]!), g: byte(parts[1]!), b: byte(parts[2]!), a: alpha }
        : hslToRgb(((parts[0]! % 360) + 360) % 360, parts[1]! / 100, parts[2]! / 100, alpha);
    }
  }
  for (const match of text.matchAll(/#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![0-9a-f])/gi)) {
    const hex = parseHex(match[0]);
    if (hex) return { ...hex, a: match[1]!.length % 4 === 0 ? hex.a : currentAlpha };
  }
  const bare = /(?:^|[^0-9a-z])([0-9a-f]{6})(?![0-9a-z])/i.exec(text);
  const hex = bare ? parseHex(bare[1]!) : null;
  return hex ? { ...hex, a: currentAlpha } : null;
}
export const RECENT_COLORS = 12;
export const SAVED_COLORS = 48;
/** Most recent first, without duplicates, at most 12. */
export const pushRecent = (recent: readonly string[], hex: string) => [hex, ...recent.filter((item) => item !== hex)].slice(0, RECENT_COLORS);
/** Saved colours of a device: add, remove and reorder, at most 48. */
export const savedColors = {
  add: (saved: readonly string[], hex: string) => (saved.includes(hex) || saved.length >= SAVED_COLORS ? [...saved] : [...saved, hex]),
  remove: (saved: readonly string[], hex: string) => saved.filter((item) => item !== hex),
  move: (saved: readonly string[], from: number, to: number) => { const next = [...saved]; const [item] = next.splice(from, 1); if (item) next.splice(Math.max(0, Math.min(to, next.length)), 0, item); return next; },
  parse: (stored: string | null): string[] => { try { const list: unknown = JSON.parse(stored ?? "[]"); return Array.isArray(list) ? list.filter((item): item is string => typeof item === "string" && parseHex(item) !== null).slice(0, SAVED_COLORS) : []; } catch { return []; } },
};
export const SAVED_COLORS_KEY = "jagentchill.savedColors";
export const cssColor = (color: Rgba) => `rgba(${color.r},${color.g},${color.b},${Number(color.a.toFixed(3))})`;
/** Colour-space pictures of the picker: the hue bar, and the saturation/value square of a hue. */
export const HUE_BAR = "linear-gradient(90deg, #FF0000, #FFFF00, #00FF00, #00FFFF, #0000FF, #FF00FF, #FF0000)";
export const svSquare = (hueHex: string) => `linear-gradient(0deg, #000000, transparent), linear-gradient(90deg, #FFFFFF, ${hueHex})`;
/** Example user colours the catalogue shows in the picker. */
export const SAMPLE_COLORS = { text: "#FF5A3C", fill: "#2F6FEB80", dark: "#1A1A1A", tint: "#3FA7B8", stroke: "#00FF0080", shadow: "#000000", brand: ["#1A1A1A", "#F6C445"], recent: ["#FF5A3C", "#2F6FEB", "#FFFFFF", "#1A1A1A", "#F6C445", "#1F9D55", "#7C4DDB", "#D95C8A", "#3FA7B8", "#E8890C", "#6B7280", "#00000080"], white: "#FFFFFF" } as const;
