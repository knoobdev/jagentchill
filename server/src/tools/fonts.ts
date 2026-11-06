import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The fonts a text can be set in: the catalogue of the editor's font picker — its nine baseline names, each drawn with
 * a bundled family, and the families of the bundled font manifest (`packages/render/assets/fonts`). The product has no
 * imported fonts; a family a project already uses counts too, because its devices drew it.
 */
export type FontCategory = "sans" | "serif" | "mono" | "emoji";
export type FontEntry = { family: string; category: FontCategory; /** A baseline name is drawn with this bundled family. */ drawnWith?: string; weights: number[]; italic: boolean };

const BASELINE: readonly { name: string; family: string }[] = [
  { name: "Arial", family: "Arimo" }, { name: "Helvetica", family: "Arimo" }, { name: "Times New Roman", family: "Tinos" }, { name: "Courier New", family: "Cousine" }, { name: "Verdana", family: "DejaVu Sans" },
  { name: "Georgia", family: "Gelasio" }, { name: "monospace", family: "Noto Sans Mono" }, { name: "sans-serif", family: "Noto Sans" }, { name: "serif", family: "Noto Serif" },
];
/** What a family is, by its name: enough to replace an unknown one with one of the same kind. */
export function fontCategory(name: string): FontCategory {
  const text = name.toLowerCase();
  if (/emoji/.test(text)) return "emoji";
  if (/mono|courier|cousine|consol|code|menlo|terminal|typewriter/.test(text)) return "mono";
  if (/sans|grotesk|gothic/.test(text)) return "sans";
  if (/serif|times|tinos|georgia|gelasio|garamond|playfair|merriweather|baskerville|bodoni|didot|caslon|palatino|cambria|lora\b|minion|book antiqua|slab|roman/.test(text)) return "serif";
  return "sans";
}
let catalogue: FontEntry[] | undefined;
export function fontCatalogue(): FontEntry[] {
  if (catalogue) return catalogue;
  const manifest = join(import.meta.dirname, "../../../packages/render/assets/fonts/fonts.manifest.json");
  let faces: { family: string; weight?: number; style?: string }[] = [];
  try { faces = existsSync(manifest) ? (JSON.parse(readFileSync(manifest, "utf8")) as { fonts: typeof faces }).fonts : []; } catch { faces = []; }
  const of = (family: string) => faces.filter((face) => face.family === family);
  const facts = (family: string) => ({ weights: [...new Set(of(family).map((face) => face.weight ?? 400))].sort((a, b) => a - b), italic: of(family).some((face) => face.style === "italic") });
  const bundled = [...new Set(faces.map((face) => face.family))].sort((a, b) => a.localeCompare(b));
  catalogue = [
    ...BASELINE.map((font) => ({ family: font.name, category: fontCategory(font.family), drawnWith: font.family, ...facts(font.family) })),
    ...bundled.map((family) => ({ family, category: fontCategory(family), ...facts(family) })),
  ];
  return catalogue;
}
/** The family names of the catalogue, for a tool description: the model picks one that exists. */
export const fontFamilyList = (): string => fontCatalogue().map((font) => font.family).join(", ");

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) { let previous = row[0]!; row[0] = i; for (let j = 1; j <= b.length; j++) { const held = row[j]!; row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1)); previous = held; } }
  return row[b.length]!;
}
const squash = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * The family a text is set in when `wanted` is asked for. A name of the catalogue (or one the project uses) in any
 * letter case is itself. Any other name never fails an edit: it becomes the family whose name is closest (a typing
 * slip, a spelled-out variant), else — the name says nothing — the project's own text font when that is of the same
 * kind (sans, serif, mono), else the first family of that kind; `substituted` says so.
 */
export function resolveFont(wanted: string, used: readonly string[] = []): { family: string; substituted?: { wanted: string; by: "name" | "kind" } } {
  const asked = wanted.trim(), names = [...new Set([...fontCatalogue().map((font) => font.family), ...used])];
  const exact = names.find((name) => name.toLowerCase() === asked.toLowerCase());
  if (exact) return { family: exact };
  const key = squash(asked);
  const scored = names.filter((name) => fontCategory(name) !== "emoji").map((name) => ({ name, d: distance(squash(name), key), contains: key.length >= 4 && (squash(name).startsWith(key) || key.startsWith(squash(name))) })).sort((a, b) => a.d - b.d || a.name.length - b.name.length);
  const near = scored.find((entry) => entry.d <= Math.max(1, Math.floor(key.length / 4))) ?? scored.filter((entry) => entry.contains).sort((a, b) => b.name.length - a.name.length)[0];
  if (near) return { family: near.name, substituted: { wanted: asked, by: "name" } };
  const kind = fontCategory(asked);
  // The project's own font: the family most of its texts are set in.
  const counts = new Map<string, number>();
  for (const name of used) counts.set(name, (counts.get(name) ?? 0) + 1);
  const own = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name).find((name) => fontCategory(name) === kind);
  const family = own ?? (kind === "mono" ? "monospace" : kind === "serif" ? "serif" : kind === "emoji" ? "Noto Color Emoji" : "Arial");
  return { family: names.find((name) => name.toLowerCase() === family.toLowerCase()) ?? "Arial", substituted: { wanted: asked, by: "kind" } };
}
