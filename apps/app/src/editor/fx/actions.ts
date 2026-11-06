import { EDITOR_PREFS, FX_PREFS, transitionLoop, transitionPlace, type FxTile } from "@jagentchill/app-core";
import { effectDefinition, timeline } from "@jagentchill/editor-core";
import { TICKS_PER_SECOND } from "@jagentchill/protocol";
import type { T } from "../../locale";
import { getPref, setPref } from "../../state";
import type { EditorRuntime } from "../runtime";
import { fxOf, noteApplied } from "./store";

/** What an action of the library needs from the screen it runs on: the translator and the toast. */
export type FxUi = { t: T; toast(message: string, kind?: "info" | "error" | "success"): void };
const M = timeline.EFFECT_MESSAGES, TM = timeline.TRANSITION_MESSAGES;
/** The asset panel shows a tab of this project. */
export function showAssetTab(runtime: EditorRuntime, tab: "effects" | "filters" | "transitions"): void {
  const projectId = runtime.controller.stored.metadata.id;
  setPref(EDITOR_PREFS.assetTabs, { ...getPref(EDITOR_PREFS.assetTabs), [projectId]: tab });
}
/** The inspector shows the Effects tab for the types of these elements. */
function showEffectsTab(runtime: EditorRuntime, elementIds: string[]): void {
  const tabs = { ...getPref(EDITOR_PREFS.inspectorTabs) };
  for (const id of elementIds) { const element = timeline.locate(runtime.controller.stored, id)?.element; if (element && element.type !== "effect") tabs[element.type] = "effects"; }
  setPref(EDITOR_PREFS.inspectorTabs, tabs);
}
/** The Body tiles need the on-device person model, which this build does not carry. */
export const bodyEffectsAvailable = (): boolean => false;

const loopTimers = new WeakMap<EditorRuntime, ReturnType<typeof setTimeout>>();
/** How long the cut keeps looping after the last change of a parameter: one more pass. */
export const TRANSITION_LOOP_TAIL_MS = 2200;
/**
 * A parameter of a transition changed: the preview plays the cut on a loop, from 1 s before it to 1 s after it, and
 * returns to the playhead once the parameters have stopped changing.
 */
export function touchTransitionLoop(runtime: EditorRuntime, transitionId: string): void {
  const place = transitionPlace(runtime.controller.stored, transitionId);
  if (!place || !runtime.engine || runtime.transport.engine !== "ready") return;
  if (!runtime.previewLooping) runtime.previewLoop(transitionLoop(place.cut, runtime.duration()));
  const pending = loopTimers.get(runtime);
  if (pending) clearTimeout(pending);
  loopTimers.set(runtime, setTimeout(() => { loopTimers.delete(runtime); runtime.previewLoop(null); }, TRANSITION_LOOP_TAIL_MS));
}
/** Ends the loop at once (the transition was deselected or removed). */
export function endTransitionLoop(runtime: EditorRuntime): void {
  const pending = loopTimers.get(runtime);
  if (pending) { clearTimeout(pending); loopTimers.delete(runtime); }
  runtime.previewLoop(null);
}

/**
 * A transition tile applied to a cut: the given one (a drop), else the cut of the selected transition or the one a
 * "Replace" waits for, else the eligible cut nearest the playhead on the main track. One undo step; the transition
 * becomes the selection.
 */
export function applyTransitionTile(runtime: EditorRuntime, tile: FxTile, ui: FxUi, cut?: timeline.Cut): boolean {
  const { controller } = runtime, fx = fxOf(runtime), sceneId = controller.session.sceneId, scene = timeline.sceneById(controller.stored, sceneId);
  const chosen = fx.state.replace?.kind === "transition" ? fx.state.replace.transitionId : fx.state.transitionId;
  const target = cut ?? (chosen ? timeline.eligibleCuts(scene).find((entry) => entry.transitionId === chosen) : undefined) ?? timeline.nearestCut(scene, controller.session.playhead);
  if (!target) { ui.toast(ui.t(TM.noCut), "info"); return false; }
  const preset = tile.preset ? getPref(FX_PREFS.transitionPresets).find((entry) => entry.name === tile.preset && entry.type === tile.type) : undefined;
  const result = controller.run(preset
    ? timeline.applyTransitionPreset({ sceneId, fromId: target.fromId, toId: target.toId, preset })
    : timeline.applyTransition({ sceneId, fromId: target.fromId, toId: target.toId, type: tile.type, seconds: getPref(FX_PREFS.transitionDefaults).duration / TICKS_PER_SECOND }));
  if (!result.ok || !result.info) return false;
  noteApplied("transition", tile.type);
  fx.set({ replace: null });
  fx.selectTransition(result.info.transitionId);
  if (result.info.clamped) ui.toast(ui.t("Limited to {seconds}s by clip length", { seconds: (timeline.findTransition(controller.stored, result.info.transitionId)!.record.duration / TICKS_PER_SECOND).toFixed(1) }), "info");
  return true;
}
/** `transition.add-default`: the default type and duration on every eligible cut touching the selection, else on the cut nearest the playhead. */
export function addDefaultTransitions(runtime: EditorRuntime, ui: FxUi): boolean {
  const { controller } = runtime, session = controller.session;
  const scene = timeline.sceneById(controller.stored, session.sceneId);
  if (timeline.eligibleCuts(scene).length === 0) { ui.toast(ui.t(TM.noCut), "info"); return false; }
  const result = controller.run(timeline.addDefaultTransitions({ sceneId: session.sceneId, elementIds: session.selection.selectedElements, playhead: session.playhead, defaults: getPref(FX_PREFS.transitionDefaults) }));
  if (!result.ok || !result.info) return false;
  const ids = result.info.transitionIds;
  if (ids.length === 1) fxOf(runtime).selectTransition(ids[0]);
  return true;
}

/** A standalone layer of a tile at a time; a preset writes its params in the same step. */
function addLayer(runtime: EditorRuntime, tile: FxTile, time: number, ui: FxUi): boolean {
  const { controller } = runtime, sceneId = controller.session.sceneId;
  if (tile.body) { ui.toast(ui.t(M.bodyNeedsClip), "info"); return false; }
  const base = timeline.addEffectLayer({ sceneId, type: tile.type, playhead: time });
  const result = controller.run({
    ...base,
    run(draft, env) {
      const outcome = base.run(draft, env);
      if (tile.params && outcome?.info) { const entry = (timeline.locate(draft, outcome.info.elementId)!.element.effects as timeline.StackEntry[])[0]; entry.params = { ...entry.params, ...tile.params }; }
      return outcome;
    },
  });
  if (!result.ok) return false;
  noteApplied(tile.kind, tile.type);
  return true;
}
/** An effect or filter applied to the given clips as one step; the Effects tab of the inspector opens on them. */
function applyToClips(runtime: EditorRuntime, tile: FxTile, elementIds: string[], ui: FxUi): boolean {
  const { controller } = runtime, sceneId = controller.session.sceneId;
  const result = controller.run(timeline.applyEffect({ sceneId, elementIds, type: tile.type, ...(tile.params ? { params: tile.params } : {}) }));
  if (!result.ok || !result.info) return false;
  noteApplied(tile.kind, tile.type);
  showEffectsTab(runtime, result.info.applied);
  if (result.info.skipped > 0) ui.toast(ui.t("{n} clips skipped (not supported by this effect)", { n: result.info.skipped }), "info");
  if (result.info.full > 0) ui.toast(ui.t(M.stackFull), "info");
  return true;
}
/**
 * An effect or filter tile clicked (or Enter on it): a waiting "Replace" swaps the layer's entry; with clips selected
 * it goes on every one that accepts it; with nothing selected it becomes a standalone layer at the playhead.
 */
export function applyEffectTile(runtime: EditorRuntime, tile: FxTile, ui: FxUi): boolean {
  const { controller } = runtime, fx = fxOf(runtime), replace = fx.state.replace;
  if (replace?.kind === "layer") {
    const done = controller.run(timeline.replaceLayerEffect(replace.elementId, tile.type)).ok;
    if (done) { noteApplied(tile.kind, tile.type); fx.set({ replace: null }); }
    return done;
  }
  const selected = controller.session.selection.selectedElements.filter((id) => { const element = timeline.locate(controller.stored, id)?.element; return element !== undefined && element.type !== "effect" && element.type !== "adjustment"; });
  if (selected.length > 0) return applyToClips(runtime, tile, selected, ui);
  return addLayer(runtime, tile, controller.session.playhead, ui);
}
/** Whether a dragged effect or filter may land on an element. */
export function acceptsTile(tile: { type: string }, element: { type: string }): boolean {
  const definition = effectDefinition(tile.type);
  return definition !== undefined && element.type !== "effect" && element.type !== "adjustment" && timeline.acceptsEffect(definition, element);
}
/** A tile dropped on a clip of the timeline or on an element of the preview. */
export function dropEffectOnClip(runtime: EditorRuntime, tile: FxTile, elementId: string, ui: FxUi): boolean {
  const element = timeline.locate(runtime.controller.stored, elementId)?.element;
  if (!element || !acceptsTile(tile, element)) return false;
  const done = applyToClips(runtime, tile, [elementId], ui);
  if (done) runtime.controller.select(timeline.selectElements([elementId]));
  return done;
}
/** A tile dropped on an empty part of the tracks: a standalone layer starting there. */
export const dropEffectAt = (runtime: EditorRuntime, tile: FxTile, time: number, ui: FxUi): boolean => addLayer(runtime, tile, time, ui);
/** Any tile, by its kind. */
export const applyTile = (runtime: EditorRuntime, tile: FxTile, ui: FxUi): boolean => (tile.kind === "transition" ? applyTransitionTile(runtime, tile, ui) : applyEffectTile(runtime, tile, ui));
