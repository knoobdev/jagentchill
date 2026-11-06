import { bakeRecipe, BAKED_LUT_SIZE, cubeText, LUT_LIMITS, LutRejected, lutIdOf, parseLut, parseRecipe } from "@jagentchill/editor-core";
import type { ProjectDocument } from "@jagentchill/protocol";
import type { StoragePort } from "@jagentchill/storage";
import { objectUrl, releaseUrl, sha256Hex } from "../dom";
import type { LutSource } from "../runtime";

/**
 * The LUT tables the engine reads: the twelve built-in ones, baked on this device from their recipes the first time a
 * clip uses them, and the files the user imported, kept with the project as `.cube` text.
 */

const srgbEotf = (value: number): number => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
const srgbOetf = (value: number): number => (value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055);
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
/** The built-in LUTs (`color-adjustment` catalogue): a recipe of adjustment values, or a per-channel transfer. */
export const BUILT_IN_LUTS: readonly { id: string; name: string; recipe?: string; transfer?: (value: number) => number }[] = [
  { id: "neutral", name: "Neutral", transfer: (value) => value },
  { id: "log-to-display", name: "Log to Display", transfer: (value) => clamp01(srgbOetf(0.18 * 2 ** ((value - 0.41) * 14))) },
  { id: "soft-s-curve", name: "Soft S-Curve", recipe: "C{master: (0.25, 0.22), (0.75, 0.78)}" },
  { id: "strong-s-curve", name: "Strong S-Curve", recipe: "C{master: (0.25, 0.15), (0.75, 0.85)}" },
  { id: "warm-film", name: "Warm Film", recipe: "B{temperature 18, tint 3, contrast 8, saturation −5, fade 6}; W{highlights: 40°, 0.15, 0}; C{master: (0.25, 0.23), (0.75, 0.78)}" },
  { id: "cool-film", name: "Cool Film", recipe: "B{temperature −16, contrast 8, saturation −8, fade 6}; W{shadows: 210°, 0.15, 0}; C{master: (0.25, 0.23), (0.75, 0.78)}" },
  { id: "teal-orange", name: "Teal & Orange", recipe: "B{contrast 10, vibrance 8}; W{shadows: 185°, 0.30, 0; highlights: 30°, 0.26, 0}" },
  { id: "high-key", name: "High Key", recipe: "B{exposure 12, contrast −8, whites 10}" },
  { id: "day-for-night", name: "Day for Night", recipe: "B{exposure −30, temperature −40, saturation −30, contrast 12, highlights −20}; W{midtones: 220°, 0.15, −6}" },
  { id: "faded-matte", name: "Faded Matte", recipe: "B{fade 28, contrast −10, saturation −12}; C{master: (0, 0.09), (1, 0.95)}" },
  { id: "vivid", name: "Vivid", recipe: "B{vibrance 35, saturation 10, contrast 12}" },
  { id: "display-gamma-24", name: "Display Gamma 2.4", transfer: (value) => clamp01(srgbEotf(value) ** (1 / 2.4)) },
];
export const builtInLutId = (id: string): string => `bundled:${id}`;
function bakeBuiltIn(id: string): string | null {
  const lut = BUILT_IN_LUTS.find((entry) => entry.id === id);
  if (!lut) return null;
  if (lut.recipe) return cubeText(bakeRecipe(parseRecipe(lut.recipe)));
  const size = BAKED_LUT_SIZE, table = new Float64Array(size ** 3 * 3);
  let at = 0;
  for (let blue = 0; blue < size; blue++) for (let green = 0; green < size; green++) for (let red = 0; red < size; red++) for (const value of [red, green, blue]) table[at++] = lut.transfer!(value / (size - 1));
  return cubeText(table);
}
const blobName = (sha256: string): string => `lut-${sha256}.cube`;
const encoder = new TextEncoder();

export type LutImport = { ok: true; lut: { sha256: string; name: string; format: "cube" | "3dl"; size: number }; lutId: string } | { ok: false; name: string; reason: string };
export function createLutStore(storage: StoragePort, projectId: string) {
  const urls = new Map<string, { url: string; sha256: string }>();
  async function sourceOf(lutId: string): Promise<LutSource | null> {
    const known = urls.get(lutId);
    if (known) return { key: lutId, kind: "lut", ...known };
    let text: string | null = null;
    if (lutId.startsWith("bundled:")) text = bakeBuiltIn(lutId.slice(8));
    else { const bytes = await storage.getBlob("cover", projectId, blobName(lutId.slice(5))).catch(() => undefined); if (bytes) text = new TextDecoder().decode(bytes); }
    if (text === null) return null;
    const bytes = encoder.encode(text), made = { url: objectUrl(bytes, "text/plain"), sha256: await sha256Hex(bytes) };
    urls.set(lutId, made);
    return { key: lutId, kind: "lut", ...made };
  }
  return {
    /** Every LUT the document names — in its list or on an element — that this device can read. */
    async sources(document: ProjectDocument): Promise<LutSource[]> {
      const ids = new Set<string>(((document.media as { luts?: { id: string }[] }).luts ?? []).map((lut) => lut.id));
      for (const scene of document.scenes) for (const track of [scene.tracks.main, ...scene.tracks.overlay]) for (const element of track.elements as unknown as { adjustments?: { lut?: { lutId?: string } } }[]) if (element.adjustments?.lut?.lutId) ids.add(element.adjustments.lut.lutId);
      return (await Promise.all([...ids].map(sourceOf))).filter((entry): entry is LutSource => entry !== null);
    },
    /** Reads a picked or dropped file and stores its table with the project. A file that cannot be read adds nothing. */
    async importFile(file: File): Promise<LutImport> {
      try {
        if (file.size > LUT_LIMITS.maxBytes) throw new LutRejected("File is larger than 32 MiB");
        const raw = new Uint8Array(await file.arrayBuffer()), parsed = parseLut(file.name, new TextDecoder().decode(raw), raw.length), sha256 = await sha256Hex(raw);
        await storage.putBlob("cover", projectId, blobName(sha256), encoder.encode(parsed.cube));
        return { ok: true, lut: { sha256, name: (parsed.title || file.name.replace(/\.(cube|3dl)$/i, "")).slice(0, 120), format: parsed.format, size: raw.length }, lutId: lutIdOf(sha256) };
      } catch (error) { return { ok: false, name: file.name, reason: error instanceof LutRejected ? error.reason : "Not a .cube or .3dl file" }; }
    },
    close(): void { for (const entry of urls.values()) releaseUrl(entry.url); urls.clear(); },
  };
}
export type LutStore = ReturnType<typeof createLutStore>;
