import { FEATURED_TRANSITION_NAMES, TRANSITION_ROWS } from "@jagentchill/content";
import type { ParamDefinition } from "../registries.ts";
import type { ElementParamDefinition } from "../timeline/params.ts";
import { matchesSearch, safeParams } from "./params.ts";

/** One transition of the bundled library (`transitions.Bundled transition library`). */
export type TransitionDefinition = {
  type: string; nameKey: string; name: string; category: string; keywords: readonly string[];
  /** Transition params are not keyframable. */
  params: readonly ElementParamDefinition[];
  algorithm: string;
};

export const TRANSITION_DEFINITIONS: readonly TransitionDefinition[] = TRANSITION_ROWS.map((row) => ({
  type: row.id, nameKey: `transitions.${row.id}.name`, name: row.name, category: row.category, keywords: row.keywords ?? [],
  params: safeParams(row.id, row.params, false), algorithm: row.algorithm ?? "",
}));
const BY_TYPE = new Map(TRANSITION_DEFINITIONS.map((definition) => [definition.type, definition]));
export const transitionDefinition = (type: string): TransitionDefinition | undefined => BY_TYPE.get(type);

/** The category strip of the library panel, in order; "Featured" is curated, the others come from the table. */
export const TRANSITION_CATEGORIES = ["Featured", "Basic", "Camera", "Overlay", "Light Effect", "Split", "Distortion", "Glitch", "Blur", "Social Media", "Slide", "MG", "Mask"] as const;
/** Favourites, Recent and My presets follow Featured in the panel. */
export const TRANSITION_PANEL_CATEGORIES = ["Featured", "Favourites", "Recent", "My presets", ...TRANSITION_CATEGORIES.slice(1)] as const;
export const FEATURED_TRANSITIONS: readonly TransitionDefinition[] = FEATURED_TRANSITION_NAMES.flatMap((name) => TRANSITION_DEFINITIONS.filter((definition) => definition.name === name));
export const TRANSITION_EASINGS = ["linear", "ease-in", "ease-out", "ease-in-out"] as const;

/** The tiles of a category, or of a search across all categories. */
export function listTransitions(options: { category?: string; query?: string; localise?: (definition: TransitionDefinition) => string } = {}): TransitionDefinition[] {
  if (options.query && options.query.trim() !== "") return TRANSITION_DEFINITIONS.filter((definition) => matchesSearch(options.query!, definition, options.localise?.(definition)));
  if (options.category === "Featured") return [...FEATURED_TRANSITIONS];
  return options.category ? TRANSITION_DEFINITIONS.filter((definition) => definition.category === options.category) : [...TRANSITION_DEFINITIONS];
}
/** The ids and parameter definitions the document validator consults. */
export function validatorTransitionRegistry(): Record<string, { params: Record<string, ParamDefinition> }> {
  return Object.fromEntries(TRANSITION_DEFINITIONS.map((definition) => [definition.type, {
    params: Object.fromEntries(definition.params.map((param): [string, ParamDefinition] => [param.key, { type: param.type === "select" ? "string" : (param.type as ParamDefinition["type"]), min: param.min, max: param.max, default: param.default }])),
  }]));
}
