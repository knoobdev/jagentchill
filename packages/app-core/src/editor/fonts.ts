import { preference } from "../shell/prefs.ts";

/** `text-and-titles`: the fonts the editor offers and hands to the engine. Pure logic; the font files are the bundle of `packages/render/assets/fonts`. */

/** A face of the bundled font manifest (`fonts.manifest.json`), with the URL the app serves it from. */
export type BundledFace = { fontId: string; family: string; url: string; weight: number; style: "normal" | "italic"; load: "engine" | "on-demand" };
export type FontSource = { fontId: string; family: string; url: string; weight: number; style: "normal" | "italic" };

/** The nine baseline names the picker always lists, and the bundled family each one is drawn with. */
export const BASELINE_FONTS: readonly { name: string; family: string }[] = [
  { name: "Arial", family: "Arimo" }, { name: "Helvetica", family: "Arimo" }, { name: "Times New Roman", family: "Tinos" }, { name: "Courier New", family: "Cousine" }, { name: "Verdana", family: "DejaVu Sans" },
  { name: "Georgia", family: "Gelasio" }, { name: "monospace", family: "Noto Sans Mono" }, { name: "sans-serif", family: "Noto Sans" }, { name: "serif", family: "Noto Serif" },
];
export const bundledFamilyOf = (name: string): string => BASELINE_FONTS.find((font) => font.name.toLowerCase() === name.trim().toLowerCase())?.family ?? name.trim();
/** Whether a stored `fontFamily` can be drawn with what this device has: a baseline name or a bundled family. */
export const isFontAvailable = (name: string, faces: readonly BundledFace[]): boolean => faces.some((face) => face.family.toLowerCase() === bundledFamilyOf(name).toLowerCase());
/** The weights the weight select lists for a family: only those it ships. */
export function availableWeights(name: string, faces: readonly BundledFace[]): number[] {
  const family = bundledFamilyOf(name).toLowerCase();
  return [...new Set(faces.filter((face) => face.family.toLowerCase() === family).map((face) => face.weight))].sort((a, b) => a - b);
}
export const hasItalicFace = (name: string, faces: readonly BundledFace[]): boolean => faces.some((face) => face.family.toLowerCase() === bundledFamilyOf(name).toLowerCase() && face.style === "italic");

// The scripts whose glyphs live in an on-demand fallback family, by code-point range.
const SCRIPT_FAMILIES: [family: string, test: RegExp][] = [
  ["Noto Sans JP", /[぀-ヿㇰ-ㇿｦ-ﾟ　-〿一-鿿㐀-䶿＀-￯]/u],
  ["Noto Sans SC", /[一-鿿㐀-䶿\u{20000}-\u{2ebef}]/u],
  ["Noto Sans KR", /[가-힯ᄀ-ᇿ㄰-㆏]/u],
  ["Noto Naskh Arabic", /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/u],
  ["Noto Sans Hebrew", /[֐-׿יִ-ﭏ]/u],
  ["Noto Sans Thai", /[฀-๿]/u],
  ["Noto Sans Devanagari", /[ऀ-ॿ꣠-ꣿ]/u],
  ["Noto Color Emoji", /\p{Extended_Pictographic}|[\u{1f1e6}-\u{1f1ff}]/u],
];
/** The on-demand fallback families a text needs glyphs from, in the order of the fallback chain. */
export const fallbackFamiliesFor = (text: string): string[] => SCRIPT_FAMILIES.filter(([, test]) => test.test(text)).map(([family]) => family);

/**
 * The faces the engine is given: every face loaded with the engine, plus the on-demand fallback families whose scripts
 * the project's text uses — a fallback font is fetched from the app bundle the first time a glyph needs it, and never
 * before.
 */
export function engineFontSources(faces: readonly BundledFace[], texts: Iterable<string>): FontSource[] {
  const needed = new Set<string>();
  for (const text of texts) for (const family of fallbackFamiliesFor(text)) needed.add(family);
  return faces.filter((face) => face.load === "engine" || needed.has(face.family)).map(({ fontId, family, url, weight, style }) => ({ fontId, family, url, weight, style }));
}
/** The emoji sequence of an `emoji:<code points>` sticker id (lower-case hex joined by `-`); `null` for any other sticker. */
export function emojiOfSticker(stickerId: unknown): string | null {
  const match = typeof stickerId === "string" ? /^emoji:([0-9a-f]{2,6}(?:-[0-9a-f]{2,6})*)$/.exec(stickerId) : null;
  if (!match) return null;
  try { return String.fromCodePoint(...match[1].split("-").map((code) => parseInt(code, 16))); } catch { return null; }
}
/** Every string the engine shapes in a document: text content, caption text and translations, and the glyphs of emoji stickers. */
export function documentTexts(document: { scenes: { tracks: { overlay: { elements: unknown[] }[]; main: { elements: unknown[] }; audio: { elements: unknown[] }[] } }[] }): string[] {
  const texts: string[] = [];
  for (const scene of document.scenes) for (const track of [...scene.tracks.overlay, scene.tracks.main, ...scene.tracks.audio]) {
    for (const element of track.elements as { type?: string; content?: string; text?: string; translation?: string; stickerId?: unknown }[]) {
      if (element.type === "text" && element.content) texts.push(element.content);
      // An emoji sticker is a glyph of the colour font: the engine needs that family for it as it does for emoji in text.
      else if (element.type === "sticker") { const emoji = emojiOfSticker(element.stickerId); if (emoji) texts.push(emoji); }
      else if (element.type === "caption") texts.push(`${element.text ?? ""}${element.translation ?? ""}`);
    }
  }
  return texts;
}

// — The font picker —
export type FontPickerTab = "all" | "favorites" | "recent";
export type FontPrefs = { favorites: string[]; recent: string[] };
const isFontPrefs = (value: unknown): value is FontPrefs => value !== null && typeof value === "object" && ["favorites", "recent"].every((key) => Array.isArray((value as Record<string, unknown>)[key]) && ((value as Record<string, unknown[]>)[key]).every((entry) => typeof entry === "string"));
/** Favourite and recent families, kept per device. */
export const FONT_PREFS = preference<FontPrefs>("editor.fonts", { favorites: [], recent: [] }, isFontPrefs);
export const RECENT_FONT_LIMIT = 20;
/** Recent lists the last 20 families committed, most recent first, without duplicates. */
export const pushRecentFont = (prefs: FontPrefs, family: string): FontPrefs => ({ ...prefs, recent: [family, ...prefs.recent.filter((entry) => entry !== family)].slice(0, RECENT_FONT_LIMIT) });
export const toggleFavoriteFont = (prefs: FontPrefs, family: string): FontPrefs => ({ ...prefs, favorites: prefs.favorites.includes(family) ? prefs.favorites.filter((entry) => entry !== family) : [...prefs.favorites, family] });
/** The rows of a picker tab: the baseline names first in their fixed order, then the others alphabetically; search is a case-insensitive substring within the tab. */
export function fontPickerRows(tab: FontPickerTab, query: string, prefs: FontPrefs, extra: readonly string[] = []): string[] {
  const baseline = BASELINE_FONTS.map((font) => font.name);
  const all = [...baseline, ...[...new Set(extra)].filter((name) => !baseline.includes(name)).sort((a, b) => a.localeCompare(b))];
  const rows = tab === "all" ? all : tab === "favorites" ? all.filter((name) => prefs.favorites.includes(name)) : prefs.recent.filter((name) => all.includes(name));
  const needle = query.trim().toLowerCase();
  return needle === "" ? rows : rows.filter((name) => name.toLowerCase().includes(needle));
}
export const FONT_TAB_EMPTY: Record<FontPickerTab, string> = { all: "No fonts found", favorites: "No favourites yet — star a font to keep it here", recent: "No recent fonts" };
