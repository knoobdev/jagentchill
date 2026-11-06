import { createElement, type ProjectDocument } from "@jagentchill/protocol";
import { effectDefinition, type BundledEffectDefinition } from "../catalogue/effects.ts";
import { paramDefaults } from "../catalogue/params.ts";
import { clone, isObject, type Json } from "../model.ts";
import type { TimelineCommand } from "./command.ts";
import { elementsOfScene, endOf, located, refuse, sceneById, tracksOfScene, type El, type Sc } from "./model.ts";
import { ParamRejected } from "./params.ts";
import { placeElements } from "./placement.ts";

/**
 * Effects and filters on the timeline (`visual-effects-filters`): the stack of a clip, standalone effect and filter
 * layers, copying between clips, presets, favourites and recents. The stored shape is `project-document.Effect
 * entries`; this module owns the behaviour on it.
 */

const TICKS_PER_SECOND = 120_000;
export const EFFECT_STACK_LIMIT = 16, EFFECT_PRESET_LIMIT = 200, FAVOURITE_LIMIT = 500, RECENT_LIMIT = 20;
export const DEFAULT_EFFECT_LAYER_DURATION = 5 * TICKS_PER_SECOND;
export const EFFECT_MESSAGES = {
  stackFull: "This clip already has 16 effects. Remove one to add another.",
  skipped: (count: number) => `${count} clips skipped (not supported by this effect)`,
  notPasted: (count: number) => `${count} effects not pasted (limit reached)`,
  bodyNeedsClip: "Select a video or image clip to use body effects",
  bodyUnavailable: "Body effects need the on-device person model, which is not available on this device",
  unavailable: "Unavailable effect",
  presetLimit: "Preset limit reached (200)",
  favouriteLimit: "Favourites limit reached (500)",
  emptyFavourites: "Star an effect to keep it here",
  emptyRecent: "Effects you apply appear here",
  emptyStack: "No effects",
  analysing: (percent: number) => `Analysing ${Math.round(percent)}%`,
} as const;

export type StackEntry = { id: string; type: string; kind: "effect" | "filter"; enabled: boolean; params: Record<string, number | boolean | string> };
const stackOf = (element: El): StackEntry[] => (Array.isArray(element.effects) ? element.effects : (element.effects = [])) as StackEntry[];
const readStack = (element: El): StackEntry[] => (Array.isArray(element.effects) ? element.effects : []) as StackEntry[];
const defaultsOf = (definition: BundledEffectDefinition): Record<string, number | boolean | string> => paramDefaults(definition.params);
const known = (type: string): BundledEffectDefinition => effectDefinition(type) ?? refuse(EFFECT_MESSAGES.unavailable, "unavailable");
/** The animation path of an effect parameter, on a clip and on an effect element alike. */
export const effectParamPath = (effectId: string, key: string): string => `effects.${effectId}.params.${key}`;
const dropChannels = (element: El, effectId: string): void => {
  if (isObject(element.animations)) for (const path of Object.keys(element.animations)) if (path.startsWith(`effects.${effectId}.`)) delete element.animations[path];
};
/** Whether a definition accepts an element (its type is among the targets). */
export const acceptsEffect = (definition: BundledEffectDefinition, element: { type: string }): boolean => definition.targets.includes(element.type);

/** Writes one entry on an element: a filter replaces the existing filter in place; anything else is appended. */
function putEntry(element: El, definition: BundledEffectDefinition, newId: () => string, params?: Record<string, number | boolean | string>): "added" | "replaced" | "full" {
  const stack = stackOf(element);
  if (definition.kind === "filter") {
    const existing = stack.find((entry) => entry.kind === "filter");
    if (existing) {
      // The entry keeps its id, its place, its enabled state and its intensity; only the type changes.
      existing.type = definition.type;
      if (params) existing.params = { ...existing.params, ...params };
      return "replaced";
    }
  }
  if (stack.length >= EFFECT_STACK_LIMIT) return "full";
  stack.push({ id: newId(), type: definition.type, kind: definition.kind, enabled: true, params: { ...defaultsOf(definition), ...params } });
  return "added";
}

export type ApplyEffectInfo = { applied: string[]; skipped: number; full: number; message?: string };
/**
 * Applies an effect or filter to every selected element that accepts it, as one undo step; the others are skipped
 * and counted. A clip whose stack is full takes nothing; when no element took the entry the command is refused.
 */
export const applyEffect = (options: { sceneId: string; elementIds: string[]; type: string; params?: Record<string, number | boolean | string> }): TimelineCommand<ApplyEffectInfo> => ({
  type: "effect.apply", label: "Add effect", sceneId: options.sceneId,
  run(draft, env) {
    const definition = known(options.type), scene = sceneById(draft, options.sceneId);
    if (options.elementIds.length === 0 && definition.requires === "person-matte") refuse(EFFECT_MESSAGES.bodyNeedsClip, "body-needs-clip");
    const info: ApplyEffectInfo = { applied: [], skipped: 0, full: 0 };
    for (const element of elementsOfScene(scene).filter((candidate) => options.elementIds.includes(candidate.id))) {
      if (!acceptsEffect(definition, element) || element.type === "effect") { info.skipped++; continue; }
      if (putEntry(element, definition, env.newId, options.params) === "full") info.full++; else info.applied.push(element.id);
    }
    if (info.applied.length === 0) refuse(info.full > 0 ? EFFECT_MESSAGES.stackFull : EFFECT_MESSAGES.skipped(info.skipped), info.full > 0 ? "stack-full" : "not-supported");
    if (info.skipped > 0) info.message = EFFECT_MESSAGES.skipped(info.skipped);
    return { info, selection: options.elementIds };
  },
});
/** A body tile tapped on mobile with nothing selected: the main-track video or image clip under the playhead. */
export function bodyEffectTarget(doc: ProjectDocument, sceneId: string, playhead: number): string | null {
  const clip = (sceneById(doc, sceneId).tracks.main.elements as El[]).find((element) => (element.type === "video" || element.type === "image") && element.startTime <= playhead && playhead < endOf(element));
  return clip?.id ?? null;
}

/**
 * A standalone effect or filter layer at the playhead: an `effect` element with exactly one entry and
 * `target: "beneath"`, on the first effect track with room, else on a new effect track. Body effects are not layers.
 */
export const addEffectLayer = (options: { sceneId: string; type: string; playhead: number; duration?: number }): TimelineCommand<{ elementId: string; trackId: string }> => ({
  type: "effect.layer.add", label: "Add effect layer", sceneId: options.sceneId,
  run(draft, env) {
    const definition = known(options.type), scene = sceneById(draft, options.sceneId);
    if (!definition.layer) refuse(EFFECT_MESSAGES.bodyNeedsClip, "body-needs-clip");
    const element = clone(createElement("effect", {
      id: env.newId(), name: definition.name, startTime: Math.max(0, options.playhead), duration: options.duration ?? DEFAULT_EFFECT_LAYER_DURATION, target: "beneath",
      effects: [{ id: env.newId(), type: definition.type, kind: definition.kind, enabled: true, params: defaultsOf(definition) }],
    } as never)) as unknown as El;
    const placed = placeElements(scene, [element], { strategy: "firstAvailable" }, env);
    return { info: { elementId: element.id, trackId: (placed as { track: { id: string } }).track.id }, selection: [element.id] };
  },
});

const entryOf = (element: El, effectId: string): StackEntry => readStack(element).find((entry) => entry.id === effectId) ?? refuse("The effect no longer exists", "unknown-effect");
const onEntry = <I>(type: string, label: string, elementId: string, change: (element: El, draft: ProjectDocument) => I): TimelineCommand<I> => ({
  type, label,
  run(draft) {
    const hit = located(draft, elementId);
    if (hit.track.locked) refuse("The track is locked", "track-locked");
    return { info: change(hit.element, draft) };
  },
});
/** The eye toggle of a row. */
export const toggleEffect = (elementId: string, effectId: string): TimelineCommand<{ enabled: boolean }> =>
  onEntry("effect.toggle", "Toggle effect", elementId, (element) => { const entry = entryOf(element, effectId); entry.enabled = !entry.enabled; return { enabled: entry.enabled }; });
/** Removes an entry and its animation channels in the same step. */
export const removeEffectEntry = (elementId: string, effectId: string): TimelineCommand<{ removed: boolean }> =>
  onEntry("effect.remove", "Remove effect", elementId, (element) => { entryOf(element, effectId); element.effects = readStack(element).filter((entry) => entry.id !== effectId); dropChannels(element, effectId); return { removed: true }; });
/** "Remove filter": the clip's filter entry goes; the other entries keep their order. */
export const removeFilter = (elementId: string): TimelineCommand<{ removed: boolean }> =>
  onEntry("effect.remove-filter", "Remove filter", elementId, (element) => {
    const filter = readStack(element).find((entry) => entry.kind === "filter");
    if (!filter) return { removed: false };
    element.effects = readStack(element).filter((entry) => entry !== filter);
    dropChannels(element, filter.id);
    return { removed: true };
  });
/** Drag a row, or Alt+Up / Alt+Down: the entry moves to `toIndex` of the array. */
export const reorderEffect = (elementId: string, effectId: string, toIndex: number): TimelineCommand<{ order: string[] }> =>
  onEntry("effect.reorder", "Reorder effects", elementId, (element) => {
    const stack = stackOf(element), from = stack.findIndex((entry) => entry.id === effectId);
    if (from < 0) refuse("The effect no longer exists", "unknown-effect");
    const [entry] = stack.splice(from, 1);
    stack.splice(Math.max(0, Math.min(stack.length, toIndex)), 0, entry);
    return { order: stack.map((item) => item.id) };
  });
/** The reset button of a row, or a double-click on one thumb: the definition defaults, keyframes removed. */
export const resetEffect = (elementId: string, effectId: string, key?: string): TimelineCommand<{ params: Record<string, unknown> }> =>
  onEntry("effect.reset", "Reset effect", elementId, (element) => {
    const entry = entryOf(element, effectId), defaults = defaultsOf(known(entry.type));
    if (key === undefined) { entry.params = defaults; dropChannels(element, effectId); }
    else { if (!(key in defaults)) throw new ParamRejected(key, `"${key}" is not a parameter of this effect`); entry.params[key] = defaults[key]; if (isObject(element.animations)) delete element.animations[effectParamPath(effectId, key)]; }
    return { params: entry.params };
  });
/** "Replace" on an effect bar: the entry's type changes and the element keeps its range; a filter keeps its intensity. */
export const replaceLayerEffect = (elementId: string, type: string): TimelineCommand<{ type: string }> =>
  onEntry("effect.layer.replace", "Replace", elementId, (element) => {
    const definition = known(type), entry = readStack(element)[0] ?? refuse("The effect no longer exists", "unknown-effect");
    if (!definition.layer || definition.kind !== entry.kind) refuse(EFFECT_MESSAGES.unavailable, "wrong-kind");
    const intensity = entry.params.intensity;
    entry.type = type;
    entry.params = { ...defaultsOf(definition), ...(entry.kind === "filter" && intensity !== undefined ? { intensity } : {}) };
    dropChannels(element, entry.id);
    element.name = definition.name;
    return { type };
  });

/** A copy of animation channels under another effect id, without the keys after `duration`. */
function copyChannels(source: El, fromId: string, toId: string, duration: number, newId: () => string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!isObject(source.animations)) return out;
  const keep = (channel: Json): Json | null => {
    const keys = (Array.isArray(channel.keys) ? channel.keys : []) as Json[];
    const kept = keys.filter((key) => (key.time as number) <= duration).map((key) => ({ ...clone(key), id: newId() }));
    return kept.length > 0 ? { ...clone(channel), keys: kept } : null;
  };
  for (const [path, channel] of Object.entries(source.animations)) {
    if (!path.startsWith(`effects.${fromId}.`) || !isObject(channel)) continue;
    let copy: Json | null;
    if ("r" in channel) {
      const parts = ["r", "g", "b", "a"].map((part) => (isObject(channel[part]) ? keep(channel[part] as Json) : null));
      copy = parts.every((part) => part !== null) ? { ...clone(channel), r: parts[0], g: parts[1], b: parts[2], a: parts[3] } : null;
    } else copy = keep(channel);
    if (copy) out[`effects.${toId}.${path.slice(`effects.${fromId}.`.length)}`] = copy;
  }
  return out;
}

/**
 * "Target → Clip…" of a standalone layer: its entry becomes a clip entry of the chosen clip (params and keyframes,
 * without the keyframes after the clip's duration) and the layer is deleted, in one step. A full stack refuses.
 */
export const convertLayerToClip = (layerId: string, targetElementId: string): TimelineCommand<{ effectId: string }> => ({
  type: "effect.layer.convert", label: "Move to clip",
  run(draft, env) {
    const layer = located(draft, layerId), target = located(draft, targetElementId);
    const entry = readStack(layer.element)[0] ?? refuse("The effect no longer exists", "unknown-effect");
    const definition = known(entry.type);
    if (!acceptsEffect(definition, target.element)) refuse(EFFECT_MESSAGES.skipped(1), "not-supported");
    const stack = stackOf(target.element), existing = entry.kind === "filter" ? stack.find((item) => item.kind === "filter") : undefined;
    if (!existing && stack.length >= EFFECT_STACK_LIMIT) refuse(EFFECT_MESSAGES.stackFull, "stack-full");
    let effectId: string;
    if (existing) { dropChannels(target.element, existing.id); Object.assign(existing, { type: entry.type, params: { ...entry.params } }); effectId = existing.id; }
    else { effectId = env.newId(); stack.push({ ...clone(entry), id: effectId }); }
    const channels = copyChannels(layer.element, entry.id, effectId, target.element.duration, env.newId);
    if (Object.keys(channels).length > 0) target.element.animations = { ...(isObject(target.element.animations) ? target.element.animations : {}), ...channels };
    layer.track.elements = layer.track.elements.filter((element) => element.id !== layerId);
    return { info: { effectId }, selection: [targetElementId], noRipple: true, noMagnet: true };
  },
});

const FILTER_ALL_TYPES = ["video", "image", "compound"];
const filterTracks = (scene: Sc) => [scene.tracks.main, ...scene.tracks.overlay];
/** What the confirm dialog of "Apply to all" states: the clips it changes and the ones on locked tracks it skips. */
export function countFilterTargets(doc: ProjectDocument, sceneId: string): { affected: number; skippedLocked: number } {
  let affected = 0, skippedLocked = 0;
  for (const track of filterTracks(sceneById(doc, sceneId))) for (const element of track.elements) if (FILTER_ALL_TYPES.includes(element.type)) { if (track.locked) skippedLocked++; else affected++; }
  return { affected, skippedLocked };
}
/** "Apply to all": the same filter type and intensity (no keyframes) on every video, image and compound clip of the scene. */
export const applyFilterToAll = (options: { sceneId: string; type: string; intensity: number }): TimelineCommand<{ affected: number; skippedLocked: number }> => ({
  type: "effect.filter.apply-to-all", label: "Apply filter to all", sceneId: options.sceneId,
  run(draft, env) {
    const definition = known(options.type), info = { affected: 0, skippedLocked: 0 };
    if (definition.kind !== "filter") refuse(EFFECT_MESSAGES.unavailable, "wrong-kind");
    for (const track of filterTracks(sceneById(draft, options.sceneId))) for (const element of track.elements) {
      if (!FILTER_ALL_TYPES.includes(element.type)) continue;
      if (track.locked) { info.skippedLocked++; continue; }
      const outcome = putEntry(element, definition, env.newId, { intensity: options.intensity });
      if (outcome === "full") continue;
      const filter = readStack(element).find((entry) => entry.kind === "filter")!;
      filter.params.intensity = options.intensity;
      if (isObject(element.animations)) delete element.animations[effectParamPath(filter.id, "intensity")];
      info.affected++;
    }
    return { info };
  },
});

export type EffectClipboard = { kind: "effects"; entries: StackEntry[]; source: El };
/** "Copy effects": the entries of a clip with their animation channels. The document is not changed. */
export function copyEffects(doc: ProjectDocument, elementId: string): EffectClipboard | null {
  const element = located(doc, elementId).element, entries = readStack(element);
  return entries.length === 0 ? null : { kind: "effects", entries: clone(entries), source: clone(element) };
}
/** "Paste effects": deep copies appended to every selected compatible element, within the limits; the rest is counted. */
export const pasteEffects = (options: { sceneId: string; elementIds: string[]; clipboard: EffectClipboard }): TimelineCommand<{ pasted: number; notPasted: number; message?: string }> => ({
  type: "effect.paste", label: "Paste effects", sceneId: options.sceneId,
  run(draft, env) {
    let pasted = 0, notPasted = 0;
    for (const element of elementsOfScene(sceneById(draft, options.sceneId)).filter((candidate) => options.elementIds.includes(candidate.id))) {
      const stack = stackOf(element);
      for (const entry of options.clipboard.entries) {
        const definition = effectDefinition(entry.type);
        const fits = stack.length < EFFECT_STACK_LIMIT && !(entry.kind === "filter" && stack.some((item) => item.kind === "filter")) && (!definition || acceptsEffect(definition, element));
        if (!fits) { notPasted++; continue; }
        const id = env.newId();
        stack.push({ ...clone(entry), id });
        const channels = copyChannels(options.clipboard.source, entry.id, id, element.duration, env.newId);
        if (Object.keys(channels).length > 0) element.animations = { ...(isObject(element.animations) ? element.animations : {}), ...channels };
        pasted++;
      }
    }
    return { info: { pasted, notPasted, ...(notPasted > 0 ? { message: EFFECT_MESSAGES.notPasted(notPasted) } : {}) } };
  },
});

/** The rows of the clip effects list, top to bottom in render order. */
export function effectRows(element: { effects?: unknown }): { id: string; label: string; kind: string; enabled: boolean; available: boolean; opacity: number; requiresMatte: boolean }[] {
  return readStack(element as El).map((entry) => {
    const definition = effectDefinition(entry.type);
    return { id: entry.id, label: definition?.name ?? EFFECT_MESSAGES.unavailable, kind: entry.kind, enabled: entry.enabled !== false, available: definition !== undefined, opacity: entry.enabled === false ? 0.5 : 1, requiresMatte: definition?.requires === "person-matte" };
  });
}
/** A clip shows the wand button when at least one of its entries is enabled. */
export const hasEnabledEffects = (element: { effects?: unknown }): boolean => readStack(element as El).some((entry) => entry.enabled !== false);
/** The bar of a standalone effect element: its icon by kind and its name. */
export function effectBar(element: { effects?: unknown }): { icon: "wand" | "three-circles"; label: string; kind: "effect" | "filter" } | null {
  const entry = readStack(element as El)[0];
  if (!entry) return null;
  return { icon: entry.kind === "filter" ? "three-circles" : "wand", label: effectDefinition(entry.type)?.name ?? EFFECT_MESSAGES.unavailable, kind: entry.kind };
}

// ---- presets, favourites, recents -------------------------------------------------------------------------------------
export type EffectPreset = { name: string; type: string; kind: "effect" | "filter"; params: Record<string, number | boolean | string> };
/** "Save as preset": parameter values only (`resolved` are the values at the playhead when the entry is keyframed). */
export function saveEffectPreset(presets: readonly EffectPreset[], name: string, entry: Pick<StackEntry, "type" | "kind" | "params">, resolved: Record<string, number | boolean | string> = {}): { ok: true; presets: EffectPreset[]; preset: EffectPreset } | { ok: false; message: string } {
  if (presets.length >= EFFECT_PRESET_LIMIT) return { ok: false, message: EFFECT_MESSAGES.presetLimit };
  const base = name.trim().slice(0, 60);
  if (base.length === 0) throw new ParamRejected("name", "a preset name has 1 to 60 characters");
  const taken = presets.filter((preset) => preset.type === entry.type).map((preset) => preset.name);
  let unique = base;
  for (let index = 2; taken.includes(unique); index++) { const suffix = ` (${index})`; unique = `${base.slice(0, 60 - suffix.length)}${suffix}`; }
  const preset: EffectPreset = { name: unique, type: entry.type, kind: entry.kind, params: { ...entry.params, ...resolved } };
  return { ok: true, presets: [...presets, preset], preset };
}
export const effectPresetState = (preset: EffectPreset): { available: boolean; label?: string } => (effectDefinition(preset.type) ? { available: true } : { available: false, label: EFFECT_MESSAGES.unavailable });
/** Applying a preset: its base tile, then its params, as one undo step; no keyframes are created. */
export const applyEffectPreset = (options: { sceneId: string; elementIds: string[]; preset: EffectPreset }): TimelineCommand<ApplyEffectInfo> =>
  ({ ...applyEffect({ sceneId: options.sceneId, elementIds: options.elementIds, type: options.preset.type, params: options.preset.params }), type: "effect.apply-preset", label: "Apply preset" });

export type LibraryKind = "effect" | "filter" | "transition";
export type LibraryState = { favourites: Record<LibraryKind, string[]>; recents: Record<LibraryKind, string[]> };
export const emptyLibraryState = (): LibraryState => ({ favourites: { effect: [], filter: [], transition: [] }, recents: { effect: [], filter: [], transition: [] } });
/** The star toggle: favourites are kept in the order they were added, at most 500 per kind. */
export function toggleFavourite(state: LibraryState, kind: LibraryKind, id: string): { state: LibraryState; favourite: boolean; message?: string } {
  const list = state.favourites[kind];
  if (list.includes(id)) return { state: { ...state, favourites: { ...state.favourites, [kind]: list.filter((entry) => entry !== id) } }, favourite: false };
  if (list.length >= FAVOURITE_LIMIT) return { state, favourite: false, message: EFFECT_MESSAGES.favouriteLimit };
  return { state: { ...state, favourites: { ...state.favourites, [kind]: [...list, id] } }, favourite: true };
}
/** An applied item goes to the front of Recent; the list holds the 20 newest per kind. */
export const pushRecent = (state: LibraryState, kind: LibraryKind, id: string): LibraryState =>
  ({ ...state, recents: { ...state.recents, [kind]: [id, ...state.recents[kind].filter((entry) => entry !== id)].slice(0, RECENT_LIMIT) } });
/** The scene elements a tile may be dropped on (they highlight); every other clip shows the not-allowed cursor. */
export const effectDropTargets = (scene: Sc, type: string): string[] => { const definition = effectDefinition(type); return definition ? tracksOfScene(scene).flatMap((track) => track.elements).filter((element) => element.type !== "effect" && acceptsEffect(definition, element)).map((element) => element.id) : []; };
