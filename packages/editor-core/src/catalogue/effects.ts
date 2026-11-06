import { EFFECT_ROWS, FILTER_ROWS } from "@jagentchill/content";
import type { EffectDefinition as ValidatorEffectDefinition, ParamDefinition } from "../registries.ts";
import type { ElementParamDefinition, ParamRegistry } from "../timeline/params.ts";
import { matchesSearch, safeParams } from "./params.ts";

/** One effect or filter of the bundled library (`visual-effects-filters.Effect definition registry`). */
export type BundledEffectDefinition = {
  type: string; kind: "effect" | "filter";
  /** Locale key of the display name; `name` is its English text. */
  nameKey: string; name: string;
  category: string; keywords: readonly string[]; params: readonly ElementParamDefinition[];
  /** Element types the definition accepts. */
  targets: readonly string[];
  /** Whether it can be used as a standalone effect element. */
  layer: boolean;
  timeDriven: boolean; requires: "" | "person-matte";
  /** The normative one-sentence description (a filter's is its recipe). */
  algorithm: string;
};

const ALL_TARGETS = ["video", "image", "text", "sticker", "graphic", "compound"] as const;
const BODY_TARGETS = ["video", "image"] as const;
export const EFFECT_CATEGORIES = ["Blur", "Distort", "Stylise", "Light", "Glitch", "Retro", "Particles", "Lens", "Photo", "Body"] as const;
export const FILTER_CATEGORIES = ["Film", "Portrait", "Landscape", "Food", "Night", "Retro", "Mono", "Style"] as const;
/** The remap effects: a sample outside the effect frame is transparent black. */
export const REMAP_EFFECTS = ["fisheye", "wave", "ripple", "twirl", "bulge", "mirror", "kaleidoscope", "tile", "lens-distortion", "lens-zoom", "slow-zoom", "pan-drift", "crt", "photo-frame"] as const;

export const EFFECT_DEFINITIONS: readonly BundledEffectDefinition[] = EFFECT_ROWS.map((row) => {
  // A row without flags is a plain effect: module-level code of this package never throws on catalogue data.
  const flags = row.flags ?? "";
  const matte = flags.includes("M");
  return {
    type: row.id, kind: "effect", nameKey: `effects.${row.id}.name`, name: row.name, category: row.category, keywords: row.keywords ?? [],
    params: safeParams(row.id, row.params, true), targets: matte ? BODY_TARGETS : ALL_TARGETS, layer: !matte,
    timeDriven: flags.includes("T"), requires: matte ? "person-matte" : "", algorithm: row.algorithm ?? "",
  };
});
const INTENSITY: ElementParamDefinition = { key: "intensity", type: "number", min: 0, max: 100, step: 1, default: 100, keyframable: true };
export const FILTER_DEFINITIONS: readonly BundledEffectDefinition[] = FILTER_ROWS.map((row) => ({
  type: row.id, kind: "filter", nameKey: `filters.${row.id}.name`, name: row.name, category: row.category, keywords: [], params: [INTENSITY],
  targets: ALL_TARGETS, layer: true, timeDriven: false, requires: "", algorithm: row.recipe,
}));

const BY_TYPE = new Map<string, BundledEffectDefinition>([...EFFECT_DEFINITIONS, ...FILTER_DEFINITIONS].map((definition) => [definition.type, definition]));
/** The definition of an effect or filter type; `undefined` for a type this build does not register. */
export const effectDefinition = (type: string): BundledEffectDefinition | undefined => BY_TYPE.get(type);

/** Registers every definition's parameters under `effect:<type>`, so that every write is coerced the same way. */
export function registerEffectParams(registry: ParamRegistry): void {
  for (const definition of BY_TYPE.values()) registry.register(`effect:${definition.type}`, [...definition.params]);
}
/** The ids and parameter definitions the document validator consults. */
export function validatorEffectRegistry(): Record<string, ValidatorEffectDefinition> {
  const out: Record<string, ValidatorEffectDefinition> = {};
  for (const definition of BY_TYPE.values()) {
    out[definition.type] = {
      kind: definition.kind,
      params: Object.fromEntries(definition.params.map((param): [string, ParamDefinition] => [param.key, { type: param.type === "select" ? "string" : (param.type as ParamDefinition["type"]), min: param.min, max: param.max, default: param.default, keyframable: param.keyframable }])),
    };
  }
  return out;
}

/** The tiles of a panel for a category and a search query; a query searches every category. */
export function listEffects(kind: "effect" | "filter", options: { category?: string; query?: string; localise?: (definition: BundledEffectDefinition) => string } = {}): BundledEffectDefinition[] {
  const all = kind === "effect" ? EFFECT_DEFINITIONS : FILTER_DEFINITIONS;
  if (options.query && options.query.trim() !== "") return all.filter((definition) => matchesSearch(options.query!, definition, options.localise?.(definition)));
  return options.category && options.category !== "All" ? all.filter((definition) => definition.category === options.category) : [...all];
}
/** The two fixed library filters of the mobile Effects group. */
export const videoEffects = (): BundledEffectDefinition[] => EFFECT_DEFINITIONS.filter((definition) => definition.requires === "");
export const bodyEffects = (): BundledEffectDefinition[] => EFFECT_DEFINITIONS.filter((definition) => definition.requires === "person-matte");
