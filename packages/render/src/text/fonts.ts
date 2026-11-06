import type { Wasm } from "../engine/wasm.ts";

/** The nine baseline names resolve to bundled open fonts, never to a font of the operating system. */
export const BASELINE_FAMILIES: Record<string, string> = {
  arial: "Arimo", helvetica: "Arimo", "times new roman": "Tinos", "courier new": "Cousine", georgia: "Gelasio", verdana: "DejaVu Sans",
  "sans-serif": "Noto Sans", serif: "Noto Serif", monospace: "Noto Sans Mono",
};
/** The glyph fallback chain, in its fixed order. */
export const FALLBACK_FAMILIES = ["Noto Sans", "Noto Sans JP", "Noto Sans SC", "Noto Sans KR", "Noto Naskh Arabic", "Noto Sans Hebrew", "Noto Sans Thai", "Noto Sans Devanagari", "Noto Color Emoji"] as const;

export type FontSource = { fontId: string; family: string; url: string; weight?: number; style?: "normal" | "italic"; sha256?: string };
export type FontChain = {
  /** Loaded font ids in fallback order, the element's face first. */
  ids: string[];
  /** Faces that are known but whose bytes have not arrived. */
  pending: FontSource[];
  /** The requested family has no source at all, or its face failed to load: the text uses the fallback chain. */
  fallback: boolean;
  family: string;
  /** The element's own face when it is known and still loading. */
  waiting?: FontSource;
};

const key = (name: string): string => name.trim().toLowerCase();

/**
 * The fonts of the engine: sources given by `fonts.setSources` (the bundled faces and the user's), their bytes
 * fetched from the engine's own origin and handed to the wasm shaper. No face is registered with the browser.
 */
export class FontRegistry {
  private sources: FontSource[] = [];
  private readonly loaded = new Set<string>();
  private readonly failed = new Set<string>();
  private readonly loading = new Map<string, Promise<boolean>>();
  private readonly wasm: () => Promise<Wasm>;
  private readonly fetchBytes: (url: string) => Promise<Uint8Array>;
  /** Called when a face finishes loading, so that text waiting for it renders again. */
  onLoaded: (source: FontSource) => void = () => undefined;

  constructor(wasm: () => Promise<Wasm>, fetchBytes: (url: string) => Promise<Uint8Array> = async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`font request failed with ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }) {
    this.wasm = wasm;
    this.fetchBytes = fetchBytes;
  }

  setSources(fonts: FontSource[]): void {
    this.sources = fonts.map((font) => ({ ...font }));
    this.failed.clear();
  }

  /** The bundled family a stored `fontFamily` resolves to. */
  resolveFamily(name: string): string { return BASELINE_FAMILIES[key(name)] ?? name.trim(); }

  /** The face of a family nearest to a weight and style. */
  pick(family: string, weight = 400, style: "normal" | "italic" = "normal"): FontSource | undefined {
    const faces = this.sources.filter((source) => key(source.family) === key(family));
    if (faces.length === 0) return undefined;
    const score = (face: FontSource) => Math.abs((face.weight ?? 400) - weight) + ((face.style ?? "normal") === style ? 0 : 10_000);
    return [...faces].sort((a, b) => score(a) - score(b) || (a.fontId < b.fontId ? -1 : 1))[0];
  }

  /** The font chain of a text: its own face, then the fallback families, in order. */
  chain(fontFamily: string, weight?: number, style?: "normal" | "italic"): FontChain {
    const family = this.resolveFamily(fontFamily);
    const own = this.pick(family, weight, style);
    const wanted = [own, ...FALLBACK_FAMILIES.filter((name) => key(name) !== key(family)).map((name) => this.pick(name, weight, style))].filter((face): face is FontSource => face !== undefined);
    const ids = wanted.filter((face) => this.loaded.has(face.fontId)).map((face) => face.fontId);
    const pending = wanted.filter((face) => !this.loaded.has(face.fontId) && !this.failed.has(face.fontId));
    return { ids, pending, fallback: !own || this.failed.has(own.fontId), family, ...(own && !this.loaded.has(own.fontId) && !this.failed.has(own.fontId) ? { waiting: own } : {}) };
  }

  /** Fetches and parses a face once; resolves `false` when its bytes cannot be had or read. */
  ensure(source: FontSource): Promise<boolean> {
    let pending = this.loading.get(source.fontId);
    if (!pending) {
      pending = (async () => {
        try {
          const [wasm, data] = await Promise.all([this.wasm(), this.fetchBytes(source.url)]);
          if (!wasm.loadFont({ id: source.fontId, data })) throw new Error("not a readable font");
          this.loaded.add(source.fontId);
          this.onLoaded(source);
          return true;
        } catch {
          this.failed.add(source.fontId);
          return false;
        } finally {
          this.loading.delete(source.fontId);
        }
      })();
      this.loading.set(source.fontId, pending);
    }
    return pending;
  }

  isLoaded(fontId: string): boolean { return this.loaded.has(fontId); }

  /** After the wasm instance was replaced: no face is in the new one, and every face that was loaded is loaded again. */
  async reload(): Promise<void> {
    const loaded = this.sources.filter((source) => this.loaded.has(source.fontId));
    await Promise.all([...this.loading.values()]);
    this.loaded.clear();
    await Promise.all(loaded.map((source) => this.ensure(source)));
  }
}
