import {
  EFFECT_CATEGORIES, EFFECT_DEFINITIONS, effectDefinition, FILTER_CATEGORIES, FILTER_DEFINITIONS, listEffects, listTransitions, timeline, TRANSITION_DEFINITIONS, TRANSITION_PANEL_CATEGORIES, transitionDefinition,
  type BundledEffectDefinition, type TransitionDefinition,
} from "@jagentchill/editor-core";
import { createElement, TICKS_PER_SECOND, type ProjectDocument, type Rational } from "@jagentchill/protocol";
import { preference } from "../shell/prefs.ts";

/**
 * What the Effects, Filters and Transitions tabs and their inspectors compute outside the screen: the category strips,
 * the tiles of a category or a search, keyboard movement in the grid, what the device keeps (favourites, recents,
 * presets, the default transition) and the scene the engine renders the tiles from.
 */

export type FxKind = timeline.LibraryKind;
type Params = Record<string, number | boolean | string>;
const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((entry) => typeof entry === "string");
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const isLibrary = (value: unknown): value is timeline.LibraryState => isObject(value) && (["favourites", "recents"] as const).every((list) => isObject(value[list]) && (["effect", "filter", "transition"] as const).every((kind) => isStrings((value[list] as Record<string, unknown>)[kind])));
const isEffectPresets = (value: unknown): value is timeline.EffectPreset[] => Array.isArray(value) && value.every((entry) => isObject(entry) && typeof entry.name === "string" && typeof entry.type === "string" && (entry.kind === "effect" || entry.kind === "filter") && isObject(entry.params));
const isTransitionPresets = (value: unknown): value is timeline.TransitionPreset[] => Array.isArray(value) && value.every((entry) => isObject(entry) && typeof entry.name === "string" && typeof entry.type === "string" && typeof entry.duration === "number" && isObject(entry.params));
const isDefaults = (value: unknown): value is timeline.TransitionDefaults => isObject(value) && typeof value.type === "string" && typeof value.duration === "number" && value.duration > 0;

/** What the library keeps per device. */
export const FX_PREFS = {
  library: preference<timeline.LibraryState>("fx.library", timeline.emptyLibraryState(), isLibrary),
  effectPresets: preference<timeline.EffectPreset[]>("fx.effect-presets", [], isEffectPresets),
  transitionPresets: preference<timeline.TransitionPreset[]>("fx.transition-presets", [], isTransitionPresets),
  /** "Set as default": the type and duration `transition.add-default` uses. */
  transitionDefaults: preference<timeline.TransitionDefaults>("fx.transition-defaults", timeline.INITIAL_TRANSITION_DEFAULTS, isDefaults),
};

export const FX_CATEGORY = { all: "All", favourites: "Favourites", recent: "Recent", presets: "My presets", featured: "Featured", ai: "AI styles" } as const;
/** The category strip of a panel, in order. */
export function fxCategories(kind: FxKind): readonly string[] {
  if (kind === "transition") return TRANSITION_PANEL_CATEGORIES;
  const library = kind === "effect" ? EFFECT_CATEGORIES : FILTER_CATEGORIES;
  return [FX_CATEGORY.all, FX_CATEGORY.favourites, FX_CATEGORY.recent, FX_CATEGORY.presets, ...library, ...(kind === "effect" ? [FX_CATEGORY.ai] : [])];
}
/** The category a panel opens on. */
export const fxDefaultCategory = (kind: FxKind): string => (kind === "transition" ? FX_CATEGORY.featured : FX_CATEGORY.all);

export type FxDefinition = BundledEffectDefinition | TransitionDefinition;
export const fxDefinition = (kind: FxKind, type: string): FxDefinition | undefined => (kind === "transition" ? transitionDefinition(type) : effectDefinition(type));
const allOf = (kind: FxKind): readonly FxDefinition[] => (kind === "transition" ? TRANSITION_DEFINITIONS : kind === "effect" ? EFFECT_DEFINITIONS : FILTER_DEFINITIONS);

/** One tile of a grid: a library entry, or a saved preset of one (`preset` is its name). */
export type FxTile = { key: string; kind: FxKind; type: string; name: string; category: string; preset?: string; params?: Params; available: boolean; timeDriven: boolean; body: boolean };
const tileOf = (kind: FxKind, definition: FxDefinition): FxTile => ({
  key: `${kind}:${definition.type}`, kind, type: definition.type, name: definition.name, category: definition.category, available: true,
  timeDriven: kind === "transition" || (definition as BundledEffectDefinition).timeDriven === true, body: (definition as BundledEffectDefinition).requires === "person-matte",
});
export type FxListOptions = {
  category: string; query?: string; library: timeline.LibraryState; localise?: (name: string) => string;
  effectPresets?: readonly timeline.EffectPreset[]; transitionPresets?: readonly timeline.TransitionPreset[];
};
/** The tiles a panel shows: a search runs across every category, a category lists its own. */
export function fxTiles(kind: FxKind, options: FxListOptions): FxTile[] {
  const localise = options.localise ? (definition: { name: string }) => options.localise!(definition.name) : undefined;
  const known = (types: readonly string[]): FxTile[] => types.flatMap((type) => { const definition = fxDefinition(kind, type); return definition ? [tileOf(kind, definition)] : []; });
  if (options.query && options.query.trim() !== "") return (kind === "transition" ? listTransitions({ query: options.query, localise }) : listEffects(kind, { query: options.query, localise })).map((definition) => tileOf(kind, definition));
  if (options.category === FX_CATEGORY.favourites) return known(options.library.favourites[kind]);
  if (options.category === FX_CATEGORY.recent) return known(options.library.recents[kind]);
  if (options.category === FX_CATEGORY.ai) return [];
  if (options.category === FX_CATEGORY.presets) {
    const presets: readonly (timeline.EffectPreset | timeline.TransitionPreset)[] = kind === "transition" ? options.transitionPresets ?? [] : (options.effectPresets ?? []).filter((preset) => preset.kind === kind);
    return presets.map((preset) => {
      const definition = fxDefinition(kind, preset.type);
      return { ...(definition ? tileOf(kind, definition) : { kind, type: preset.type, category: "", timeDriven: false, body: false }), key: `${kind}:preset:${preset.type}:${preset.name}`, name: preset.name, preset: preset.name, params: preset.params, available: definition !== undefined };
    });
  }
  if (kind === "transition") return listTransitions({ category: options.category }).map((definition) => tileOf(kind, definition));
  return listEffects(kind, { category: options.category }).map((definition) => tileOf(kind, definition));
}
/** The text of an empty Favourites or Recent category. */
export const fxEmptyText = (category: string): string | null => (category === FX_CATEGORY.favourites ? timeline.EFFECT_MESSAGES.emptyFavourites : category === FX_CATEGORY.recent ? timeline.EFFECT_MESSAGES.emptyRecent : category === FX_CATEGORY.presets ? "Presets you save appear here" : null);

/** Arrow keys in a tile grid: the index the focus moves to, kept inside the grid. */
export function gridMove(index: number, key: string, columns: number, count: number): number {
  const step = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : key === "ArrowDown" ? columns : key === "ArrowUp" ? -columns : key === "Home" ? -index : key === "End" ? count - 1 - index : 0;
  const next = index + step;
  return next < 0 || next >= count ? index : next;
}
/** How many tiles of a width fit a row of the panel, at least one. */
export const fxGridColumns = (panelWidth: number, tile: number, gap: number, padding: number): number => Math.max(1, Math.floor((panelWidth - 2 * padding + gap) / (tile + gap)));

/** The display name of a parameter key: `centerX` → "Center X", `blockSize` → "Block size". */
export function paramLabel(key: string): string {
  const words = key.replace(/([a-z])([A-Z])/g, "$1 $2").split(" ");
  return words.map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word.length === 1 ? word.toUpperCase() : word.toLowerCase())).join(" ");
}
/** The display text of a select option: `left-to-right` → "Left to right". */
export const optionLabel = (option: string): string => { const text = option.replace(/-/g, " "); return text.charAt(0).toUpperCase() + text.slice(1); };
export const EASING_LABELS: Record<string, string> = { linear: "Linear", "ease-in": "In", "ease-out": "Out", "ease-in-out": "In out" };
export const FADE_SHAPES = ["linear", "equal-power", "s-curve", "logarithmic", "exponential"] as const;
export const FADE_SHAPE_LABELS: Record<string, string> = { linear: "Linear", "equal-power": "Equal power", "s-curve": "S-curve", logarithmic: "Logarithmic", exponential: "Exponential" };

/** "between clip 1 and clip 2": the positions of a transition's two clips on their track, counted from 1. */
export function transitionPlace(doc: ProjectDocument, transitionId: string): { from: number; to: number; cut: number; trackId: string; sceneId: string } | null {
  const found = timeline.findTransition(doc, transitionId);
  if (!found) return null;
  const track = timeline.tracksOfScene(timeline.sceneById(doc, found.sceneId)).find((entry) => entry.id === found.trackId)!;
  const ordered = [...track.elements].sort((a, b) => a.startTime - b.startTime);
  const from = ordered.findIndex((element) => element.id === found.record.fromElementId), to = ordered.findIndex((element) => element.id === found.record.toElementId);
  return from < 0 || to < 0 ? null : { from: from + 1, to: to + 1, cut: ordered[to].startTime, trackId: found.trackId, sceneId: found.sceneId };
}
/** The range the preview loops while a transition is edited: 1 s before the cut to 1 s after it, inside the scene. */
export const transitionLoop = (cut: number, sceneDuration: number): { start: number; end: number } => ({ start: Math.max(0, cut - TICKS_PER_SECOND), end: Math.min(sceneDuration, cut + TICKS_PER_SECOND) });

// ---- the scene the tiles are rendered from ----------------------------------------------------------------------------
export const FX_SCENE_ID = "fx-catalogue-scene";
export const FX_SAMPLES = {
  effect: { id: "fx-sample", url: "/fx/sample.png", width: 320, height: 320 },
  a: { id: "fx-sample-a", url: "/fx/transition-a.png", width: 480, height: 320 },
  b: { id: "fx-sample-b", url: "/fx/transition-b.png", width: 480, height: 320 },
} as const;
/** How many frames a hovered tile plays: an effect loops 2 s, a transition runs once at the default duration. */
export const FX_PREVIEW = { effectSeconds: 2, effectFrames: 16, transitionFrames: 10, hoverDelay_ms: 300, transitionPeriod_ms: 1000 } as const;
export type FxThumbRequest = { key: string; kind: FxKind; type: string; params?: Params; animated: boolean };
export type FxThumbSlot = { key: string; times: number[] };
const SLOT = 8 * TICKS_PER_SECOND, HALF = 2 * TICKS_PER_SECOND;

/**
 * The document the engine receives while tiles are waiting for their pictures: the project with one more scene, in
 * which every requested entry has a slot on the main track — an effect or filter on the sample picture, a transition
 * between the pictures A and B (scaled to cover the canvas) — and the times of the frames to read. The project's own
 * scenes are untouched, and the extra scene never reaches storage.
 */
export function withCatalogueScene(doc: ProjectDocument, requests: readonly FxThumbRequest[]): { document: ProjectDocument; slots: FxThumbSlot[] } {
  const main = doc.scenes.find((scene) => scene.isMain) ?? doc.scenes[0];
  const canvas = doc.settings.canvasSize, fps = doc.settings.fps as Rational, canvasAspect = canvas.width / canvas.height;
  const elements: unknown[] = [], transitions: unknown[] = [], slots: FxThumbSlot[] = [];
  const picture = (id: string, sample: { id: string; width: number; height: number }, startTime: number, cover: boolean) => {
    const element = createElement("image", { id, name: sample.id, startTime, duration: HALF, mediaId: sample.id }) as unknown as { transform: { scale: { x: number; y: number } }; effects: unknown[]; transitionIn?: string; transitionOut?: string };
    // Scale 1 fits the picture inside the canvas; a transition's two pictures fill it instead.
    if (cover) { const aspect = sample.width / sample.height, scale = Math.max(aspect / canvasAspect, canvasAspect / aspect); element.transform = { ...element.transform, scale: { x: scale, y: scale } }; }
    return element;
  };
  requests.forEach((request, index) => {
    const start = index * SLOT;
    if (request.kind === "transition") {
      const duration = timeline.durationToTicks(timeline.DEFAULT_TRANSITION_SECONDS, fps), cut = start + HALF, window = timeline.transitionWindow(cut, duration, fps);
      const a = picture(`fx-a-${index}`, FX_SAMPLES.a, start, true), b = picture(`fx-b-${index}`, FX_SAMPLES.b, cut, true), id = `fx-t-${index}`;
      a.transitionOut = id; b.transitionIn = id;
      elements.push(a, b);
      transitions.push({ id, kind: "transition", fromElementId: `fx-a-${index}`, toElementId: `fx-b-${index}`, duration, type: request.type, params: timeline.coerceTransitionParams(request.type, request.params ?? {}), easing: "linear", audioCrossfade: false, shape: "equal-power" });
      const count = FX_PREVIEW.transitionFrames;
      // The still is the midpoint; the animation runs from the outgoing picture to the incoming one.
      slots.push({ key: request.key, times: request.animated ? Array.from({ length: count + 1 }, (_, frame) => (frame === count ? window.end : window.start + Math.floor((duration * frame) / count))) : [window.start + Math.floor(duration / 2)] });
    } else {
      const definition = effectDefinition(request.type), element = picture(`fx-e-${index}`, FX_SAMPLES.effect, start, false);
      const defaults = Object.fromEntries((definition?.params ?? []).map((param) => [param.key, param.default]));
      element.effects = [{ id: `fx-entry-${index}`, type: request.type, kind: request.kind, enabled: true, params: { ...defaults, ...request.params } }];
      elements.push(element);
      const count = FX_PREVIEW.effectFrames;
      slots.push({ key: request.key, times: request.animated ? Array.from({ length: count }, (_, frame) => start + Math.floor((HALF * frame) / count)) : [start + HALF / 4] });
    }
  });
  const scene = { ...main, id: FX_SCENE_ID, name: "Library previews", isMain: false, kind: "timeline", markers: [], inPoint: undefined, outPoint: undefined, multicam: undefined, tracks: { overlay: [], audio: [], main: { ...main.tracks.main, id: "fx-catalogue-track", hidden: false, muted: true, locked: false, elements, transitions } } };
  const assets = Object.values(FX_SAMPLES).map((sample) => ({ id: sample.id, name: sample.id, type: "image", width: sample.width, height: sample.height, hasAudio: false }));
  return { document: { ...doc, scenes: [...doc.scenes, scene], media: { ...doc.media, assets: [...doc.media.assets, ...assets] } } as unknown as ProjectDocument, slots };
}
/** The size a tile's picture is rendered at: the canvas shape, with the short side at twice the tile's long side. */
export function fxStillSize(canvas: { width: number; height: number }, tileLongSide: number): { width: number; height: number } {
  const short = Math.max(64, tileLongSide * 2), aspect = canvas.width / canvas.height;
  const size = aspect >= 1 ? { width: Math.round(short * aspect), height: short } : { width: short, height: Math.round(short / aspect) };
  return { width: Math.min(4096, size.width), height: Math.min(4096, size.height) };
}
