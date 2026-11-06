// Bundled content as data. The catalogue rows are the normative tables of the specs, verbatim; the packages that
// own behaviour (`editor-core` for definitions, `render` for shaders and tables) read them from here.
import { CATALOGUE } from "./catalogue.generated.ts";

export type TransitionRow = { category: string; id: string; name: string; params: string; keywords: readonly string[]; algorithm: string };
export type EffectRow = { category: string; id: string; name: string; params: string; flags: string; keywords: readonly string[]; algorithm: string };
export type FilterRow = { category: string; id: string; name: string; recipe: string };

export const TRANSITION_ROWS: readonly TransitionRow[] = CATALOGUE.transitions;
/** The curated "Featured" category: display names, in order. */
export const FEATURED_TRANSITION_NAMES: readonly string[] = CATALOGUE.featuredTransitions;
export const EFFECT_ROWS: readonly EffectRow[] = CATALOGUE.effects;
export const FILTER_ROWS: readonly FilterRow[] = CATALOGUE.filters;
/** A clip animation of `keyframe-animation/catalog.md`: `channels` is the normative channel text of its row. */
export type ClipAnimationRow = { group: "in" | "out" | "combo"; id: string; name: string; channels: string };
export const CLIP_ANIMATION_ROWS: readonly ClipAnimationRow[] = CATALOGUE.clipAnimations as readonly ClipAnimationRow[];

