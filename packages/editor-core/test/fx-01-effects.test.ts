import assert from "node:assert/strict";
import { test } from "node:test";
import { bodyEffects, canonicalize, EFFECT_CATEGORIES, EFFECT_DEFINITIONS, effectDefinition, FILTER_CATEGORIES, FILTER_DEFINITIONS, listEffects, timeline as tl, upsertKeyframe, validatorEffectRegistry, validatorTransitionRegistry, videoEffects } from "../src/index.ts";
import { context, ids, image, put, REGISTRIES, text, tweak, video } from "./support/fixtures.ts";
import { el, OFF, open as openSession, overlay, project, S, trackOf, withTracks } from "./support/timeline.ts";

const CATALOGUE = { ...REGISTRIES, effects: validatorEffectRegistry(), transitions: validatorTransitionRegistry() };
const open = (doc: ReturnType<typeof project>) => openSession(doc, { registries: CATALOGUE });
const clip = (id: string, start = 0, seconds = 4, extra: Record<string, unknown> = {}) => video(id, start, seconds, { sourceDuration: 60 * S, trimEnd: (60 - seconds) * S, ...extra });
const one = () => open(put(project(), "t-main", clip("v")));
const apply = (session: ReturnType<typeof open>, type: string, elementIds = ["v"]) => session.execute(tl.applyEffect({ sceneId: "s1", elementIds, type }), OFF) as any;
const stack = (session: ReturnType<typeof open>, id = "v"): any[] => el(session.document, id).effects;

test("Effect and filter data model: Appending an effect uses defaults; Stack limit reached; Second filter replaces the first; Apply an effect or filter to a clip: Undo apply", () => {
  const session = one();
  assert.ok(apply(session, "blur").ok);
  assert.deepEqual(stack(session).map(({ id: _id, ...rest }) => rest), [{ type: "blur", kind: "effect", enabled: true, params: { intensity: 15 } }]);
  session.undo();
  assert.deepEqual(stack(session), []);
  for (let index = 0; index < 16; index++) apply(session, "glow");
  const full = apply(session, "vignette");
  assert.deepEqual([full.ok, full.message, stack(session).length], [false, "This clip already has 16 effects. Remove one to add another.", 16]);
  // A filter at intensity 70, then another filter: one entry, the same id and intensity, the new type; one undo step.
  const filtered = one();
  apply(filtered, "amber-reel");
  const id = stack(filtered)[0].id;
  filtered.execute(tl.setParams({ registry: registry(), writes: [{ elementId: "v", key: `effects.${id}.intensity`, value: 70 }] }), OFF);
  const steps = filtered.historyLength;
  apply(filtered, "teal-dusk");
  assert.deepEqual([stack(filtered), filtered.historyLength - steps], [[{ id, type: "teal-dusk", kind: "filter", enabled: true, params: { intensity: 70 } }], 1]);
});
function registry() { const out = tl.createParamRegistry({ visual: tl.CORE_VISUAL_PARAMS }); for (const definition of [...EFFECT_DEFINITIONS, ...FILTER_DEFINITIONS]) out.register(`effect:${definition.type}`, [...definition.params]); return out; }

test("Effect definition registry: Unknown effect type is preserved; Param coercion; Invalid select value from an agent tool; Bundled effect library: Param boundaries; Every bundled effect is present offline", () => {
  assert.deepEqual([EFFECT_DEFINITIONS.length, FILTER_DEFINITIONS.length, [...EFFECT_CATEGORIES].map((category) => listEffects("effect", { category }).length)], [61, 39, [7, 9, 9, 6, 5, 6, 6, 5, 3, 5]]);
  assert.deepEqual([...FILTER_CATEGORIES].map((category) => listEffects("filter", { category }).length), [6, 5, 5, 4, 4, 5, 5, 5]);
  for (const definition of [...EFFECT_DEFINITIONS, ...FILTER_DEFINITIONS]) assert.ok(definition.type && definition.nameKey && definition.category && definition.algorithm && Array.isArray(definition.targets) && typeof definition.timeDriven === "boolean", definition.type);
  assert.deepEqual(FILTER_DEFINITIONS[0].params, [{ key: "intensity", type: "number", min: 0, max: 100, step: 1, default: 100, keyframable: true }]);
  // An entry of an unregistered type is kept unchanged through an edit and a save, and listed as unavailable.
  const doc = tweak(put(project(), "t-main", clip("v")), (draft) => { draft.scenes[0].tracks.main.elements[0].effects = [{ id: "x", type: "vendor-x", kind: "effect", enabled: true, params: { amount: 3 } }]; });
  const session = openSession(doc, { registries: { ...REGISTRIES, effects: undefined, transitions: undefined } });
  session.execute(tl.applyEffect({ sceneId: "s1", elementIds: ["v"], type: "glow" }), OFF);
  assert.deepEqual(JSON.parse(canonicalize(session.document)).scenes[0].tracks.main.elements[0].effects[0], { id: "x", type: "vendor-x", kind: "effect", enabled: true, params: { amount: 3 } });
  assert.deepEqual(tl.effectRows(el(session.document, "v")).map((row) => [row.label, row.available]), [["Unavailable effect", false], ["Glow", true]]);
  // Coercion: 104.6 on a 0–100 step-1 param is 100; Twirl angle 500 stays, −900 becomes −720; a bad select value fails by name.
  const params = registry();
  assert.equal(tl.coerceParamWrite(params, "effect:glow", "intensity", 104.6), 100);
  assert.deepEqual([tl.coerceParamWrite(params, "effect:twirl", "angle", 500), tl.coerceParamWrite(params, "effect:twirl", "angle", -900)], [500, -720]);
  const wave = one();
  apply(wave, "wave");
  const bad = wave.execute(tl.setParams({ registry: params, writes: [{ elementId: "v", key: `effects.${stack(wave)[0].id}.direction`, value: "diagonal" }] }), OFF) as any;
  assert.deepEqual([bad.ok, bad.code, /direction/.test(bad.message), stack(wave)[0].params.direction], [false, "param-rejected", true, "horizontal"]);
  assert.equal(tl.coerceParamWrite(params, "effect:vignette", "color", "#FFAA00"), "#ffaa00", "a colour is stored in lower case");
});

test("Effects and filters panels: Category filter; Mobile library filters; Search effects and filters: Keyword match; No results; Favourites and recents: Favourite persists across restart; Recent list is capped", () => {
  assert.equal(listEffects("effect", { category: "Glitch" }).length, 5);
  assert.deepEqual([bodyEffects().length, videoEffects().length, bodyEffects().every((definition) => !definition.layer && definition.targets.join() === "video,image")], [5, 56, true]);
  assert.ok(listEffects("effect", { query: "Defocus" }).some((definition) => definition.name === "Gaussian Blur"));
  assert.deepEqual(listEffects("effect", { query: "zzzz" }), []);
  let state = tl.emptyLibraryState();
  const starred = tl.toggleFavourite(state, "effect", "vhs");
  // The state is plain data: what is stored in preferences is what comes back after a restart.
  state = JSON.parse(JSON.stringify(starred.state));
  assert.deepEqual([starred.favourite, state.favourites.effect], [true, ["vhs"]]);
  assert.equal(tl.toggleFavourite(state, "effect", "vhs").favourite, false);
  const crowded = { ...state, favourites: { ...state.favourites, filter: Array.from({ length: 500 }, (_, index) => `f${index}`) } };
  assert.deepEqual([tl.toggleFavourite(crowded, "filter", "mono").favourite, tl.toggleFavourite(crowded, "filter", "mono").message], [false, "Favourites limit reached (500)"]);
  for (const definition of EFFECT_DEFINITIONS.slice(0, 21)) state = tl.pushRecent(state, "effect", definition.type);
  assert.deepEqual([state.recents.effect.length, state.recents.effect[0], state.recents.effect.includes(EFFECT_DEFINITIONS[0].type)], [20, EFFECT_DEFINITIONS[20].type, false]);
  assert.deepEqual([tl.EFFECT_MESSAGES.emptyFavourites, tl.EFFECT_MESSAGES.emptyRecent], ["Star an effect to keep it here", "Effects you apply appear here"]);
});

test("Apply an effect or filter to a clip: Drag onto a compatible clip; Click with clips selected; Incompatible target; Standalone effect layer: Body effect is not offered as a layer; Body effect tapped on mobile with nothing selected", () => {
  const session = open(put(withTracks(put(project(), "t-main", clip("v1", 0), clip("v2", 4)), ["t-t", "text", { pinned: true }]), "t-t", text("t1", 0, 2)));
  assert.deepEqual(tl.effectDropTargets(session.document.scenes[0] as never, "body-glow"), ["v1", "v2"], "a body effect does not highlight a text element");
  assert.ok(tl.effectDropTargets(session.document.scenes[0] as never, "glow").includes("t1"));
  session.execute(tl.applyEffect({ sceneId: "s1", elementIds: ["v1"], type: "glow" }), OFF);
  assert.deepEqual(stack(session, "v1").map((entry) => entry.type), ["glow"]);
  const steps = session.historyLength;
  const many = session.execute(tl.applyEffect({ sceneId: "s1", elementIds: ["v1", "v2", "t1"], type: "body-glow" }), OFF) as any;
  assert.deepEqual([many.info.applied, many.info.message, stack(session, "v1").length, stack(session, "v2").length, el(session.document, "t1").effects ?? []], [["v1", "v2"], "1 clips skipped (not supported by this effect)", 2, 1, []]);
  session.undo();
  assert.deepEqual([stack(session, "v1").length, stack(session, "v2").length, session.historyLength], [1, 0, steps]);
  const dropped = session.execute(tl.applyEffect({ sceneId: "s1", elementIds: ["t1"], type: "body-glow" }), OFF) as any;
  assert.equal(dropped.ok, false);
  const layer = session.execute(tl.addEffectLayer({ sceneId: "s1", type: "background-blur", playhead: 0 }), OFF) as any;
  assert.deepEqual([layer.ok, layer.message], [false, "Select a video or image clip to use body effects"]);
  assert.equal((session.execute(tl.applyEffect({ sceneId: "s1", elementIds: [], type: "background-blur" }), OFF) as any).message, "Select a video or image clip to use body effects");
  assert.deepEqual([tl.bodyEffectTarget(session.document, "s1", 5 * S), tl.bodyEffectTarget(session.document, "s1", 60 * S)], ["v2", null]);
});

test("Standalone effect layer: Insert with no room on existing effect track; Filter layer and clip filter conversion: Filter layer is an effect element; Remove filter from clip; Convert layer to clip filter; Target clip is full; Timeline affordances: Wand button; Replace keeps the range; Replace a filter keeps intensity", () => {
  const session = one();
  const first = session.execute(tl.addEffectLayer({ sceneId: "s1", type: "sepia", playhead: 0 }), OFF) as any;
  const layer = el(session.document, first.info.elementId);
  assert.deepEqual([layer.type, trackOf(session.document, first.info.trackId).type, layer.target, layer.duration, layer.effects.map(({ id: _id, ...rest }: any) => rest)], ["effect", "effect", "beneath", 5 * S, [{ type: "sepia", kind: "filter", enabled: true, params: { intensity: 100 } }]]);
  assert.deepEqual(tl.effectBar(layer), { icon: "three-circles", label: "Sepia", kind: "filter" });
  // The only effect track is taken over that range: the next layer gets a new effect track.
  const second = session.execute(tl.addEffectLayer({ sceneId: "s1", type: "mosaic", playhead: S }), OFF) as any;
  assert.ok(second.info.trackId !== first.info.trackId && overlay(session.document).filter((track) => track.type === "effect").length === 2);
  assert.deepEqual(tl.effectBar(el(session.document, second.info.elementId)), { icon: "wand", label: "Mosaic", kind: "effect" });
  // Replace on the bar: same range, the new type's defaults; a filter keeps its intensity.
  session.execute(tl.replaceLayerEffect(second.info.elementId, "rain"), OFF);
  const rain = el(session.document, second.info.elementId);
  assert.deepEqual([rain.startTime, rain.duration, rain.effects[0].type, rain.effects[0].params], [S, 5 * S, "rain", { density: 50, length: 30, speed: 6, angle: 10, opacity: 60, seed: 0 }]);
  session.execute(tl.setParams({ registry: registry(), writes: [{ elementId: first.info.elementId, key: `effects.${layer.effects[0].id}.intensity`, value: 60 }] }), OFF);
  session.execute(tl.replaceLayerEffect(first.info.elementId, "mono"), OFF);
  assert.deepEqual([el(session.document, first.info.elementId).effects[0].type, el(session.document, first.info.elementId).effects[0].params], ["mono", { intensity: 60 }]);
  // Target → the 4 s clip: the clip gains the filter with its intensity and keyframes up to its duration; the layer is gone; one undo.
  const keyed = tweak(session.document, (draft) => { const target = draft.scenes[0].tracks.overlay.flatMap((track: any) => track.elements).find((element: any) => element.id === first.info.elementId); const id = target.effects[0].id; target.animations = { [`effects.${id}.params.intensity`]: { keys: [{ id: "k1", time: 0, value: 20, segmentToNext: "linear" }, { id: "k2", time: 2 * S, value: 60, segmentToNext: "linear" }, { id: "k3", time: 4.5 * S, value: 90, segmentToNext: "linear" }] } }; });
  const converting = open(keyed);
  converting.execute(tl.convertLayerToClip(first.info.elementId, "v"), OFF);
  const filter = stack(converting)[0], channel = el(converting.document, "v").animations[`effects.${filter.id}.params.intensity`];
  assert.deepEqual([filter.type, filter.params, channel.keys.map((key: any) => key.time), el(converting.document, first.info.elementId)], ["mono", { intensity: 60 }, [0, 2 * S], undefined]);
  assert.ok(tl.hasEnabledEffects(el(converting.document, "v")), "the clip shows the wand button");
  converting.undo();
  assert.deepEqual([stack(converting), el(converting.document, first.info.elementId) !== undefined], [[], true]);
  converting.execute(tl.convertLayerToClip(first.info.elementId, "v"), OFF);
  converting.execute(tl.applyEffect({ sceneId: "s1", elementIds: ["v"], type: "glow" }), OFF);
  converting.execute(tl.removeFilter("v"), OFF);
  assert.deepEqual(stack(converting).map((entry) => entry.type), ["glow"]);
  // A full clip refuses an effect layer and leaves it where it is.
  const crowded = open(tweak(session.document, (draft) => { draft.scenes[0].tracks.main.elements[0].effects = Array.from({ length: 16 }, (_, index) => ({ id: `e${index}`, type: "glow", kind: "effect", enabled: true, params: { intensity: 40, radius: 30, threshold: 60 } })); }));
  const refused = crowded.execute(tl.convertLayerToClip(second.info.elementId, "v"), OFF) as any;
  assert.deepEqual([refused.ok, refused.message, el(crowded.document, second.info.elementId) !== undefined], [false, "This clip already has 16 effects. Remove one to add another.", true]);
});

test("Apply filter to all clips: Apply to all; Single undo; Clip effects list: Disable an effect; Reorder by drag; Empty state; Copy effects between clips: Paste onto several clips", () => {
  const clips = Array.from({ length: 10 }, (_, index) => clip(`c${index}`, index * 2, 2));
  const doc = tweak(put(withTracks(put(project(), "t-main", ...clips), ["t-lock", "video"]), "t-lock", image("l1", 0, 2), image("l2", 2, 2)), (draft) => { draft.scenes[0].tracks.overlay[0].locked = true; });
  const session = open(doc);
  assert.deepEqual(tl.countFilterTargets(session.document, "s1"), { affected: 10, skippedLocked: 2 });
  const steps = session.historyLength;
  session.execute(tl.applyFilterToAll({ sceneId: "s1", type: "golden-hour", intensity: 70 }), OFF);
  assert.ok(clips.every((_, index) => { const [entry] = stack(session, `c${index}`); return entry.type === "golden-hour" && entry.params.intensity === 70; }));
  assert.deepEqual([el(session.document, "l1").effects ?? [], session.historyLength - steps], [[], 1]);
  session.undo();
  assert.ok(clips.every((_, index) => stack(session, `c${index}`).length === 0));
  // The list: toggle, reorder, reset and remove are one step each.
  for (const type of ["mosaic", "vignette", "glow"]) apply(session, type, ["c0"]);
  const [first, second, third] = stack(session, "c0").map((entry) => entry.id);
  session.execute(tl.toggleEffect("c0", first), OFF);
  assert.deepEqual(tl.effectRows(el(session.document, "c0")).map((row) => [row.label, row.enabled, row.opacity]), [["Mosaic", false, 0.5], ["Vignette", true, 1], ["Glow", true, 1]]);
  session.execute(tl.reorderEffect("c0", third, 0), OFF);
  assert.deepEqual(stack(session, "c0").map((entry) => entry.id), [third, first, second]);
  session.undo();
  assert.deepEqual(stack(session, "c0").map((entry) => entry.id), [first, second, third]);
  assert.deepEqual([tl.effectRows(el(session.document, "c1")), tl.EFFECT_MESSAGES.emptyStack, tl.hasEnabledEffects(el(session.document, "c1"))], [[], "No effects", false]);
  // Two copied effects pasted onto three clips: six entries with ids of their own; one undo removes them all.
  session.execute(tl.removeEffectEntry("c0", first), OFF);
  const copied = tl.copyEffects(session.document, "c0")!;
  const before = session.historyLength;
  const pasted = session.execute(tl.pasteEffects({ sceneId: "s1", elementIds: ["c1", "c2", "c3"], clipboard: copied }), OFF) as any;
  const ids = ["c1", "c2", "c3"].flatMap((id) => stack(session, id).map((entry) => entry.id));
  assert.deepEqual([pasted.info, new Set([...ids, second, third]).size, session.historyLength - before], [{ pasted: 6, notPasted: 0 }, 8, 1]);
  session.undo();
  assert.equal(["c1", "c2", "c3"].flatMap((id) => stack(session, id)).length, 0);
  const packed = open(tweak(session.document, (draft) => { draft.scenes[0].tracks.main.elements[1].effects = Array.from({ length: 15 }, (_, index) => ({ id: `e${index}`, type: "glow", kind: "effect", enabled: true, params: { intensity: 40, radius: 30, threshold: 60 } })); }));
  const partly = packed.execute(tl.pasteEffects({ sceneId: "s1", elementIds: ["c1"], clipboard: copied }), OFF) as any;
  assert.ok(partly.ok, `${partly.message} ${JSON.stringify(partly.errors?.[0] ?? {})}`);
  assert.deepEqual(partly.info, { pasted: 1, notPasted: 1, message: "1 effects not pasted (limit reached)" });
});

test("Keyframable effect parameters: Removing the effect removes its channels; Keyframe on an effect layer; Effect and filter data model: entries survive split; Effect and filter presets: Save and apply; Keyframes are not stored; Limit", () => {
  const session = one();
  apply(session, "blur");
  const id = stack(session)[0].id, path = tl.effectParamPath(id, "intensity");
  assert.equal(path, `effects.${id}.params.intensity`);
  assert.deepEqual([effectDefinition("blur")!.params[0].keyframable, effectDefinition("wave")!.params.find((param) => param.key === "direction")!.keyframable, effectDefinition("snow")!.params.find((param) => param.key === "seed")!.keyframable], [true, false, false]);
  const again = (doc: ReturnType<typeof project>) => openSession(doc, { registries: CATALOGUE, newId: ids("second") });
  const keyed = again(tweak(session.document, (draft) => { draft.scenes[0].tracks.main.elements[0].animations = { [path]: { keys: [{ id: "k1", time: 0, value: 0, segmentToNext: "linear" }, { id: "k2", time: 2 * S, value: 100, segmentToNext: "linear" }] } }; }));
  // Split: both halves keep a copy of the entry under a new id, and the animation path follows the id.
  const cut = keyed.execute(tl.split({ sceneId: "s1", time: S, elementIds: ["v"] }), OFF) as any;
  assert.ok(cut.ok, `${cut.message} ${JSON.stringify(cut.errors?.[0] ?? {})}`);
  const halves = trackOf(keyed.document, "t-main").elements;
  assert.equal(halves.length, 2);
  for (const half of halves) assert.deepEqual(Object.keys(half.animations ?? {}).filter((key) => key.startsWith("effects.")), half.animations ? [`effects.${half.effects[0].id}.params.intensity`] : []);
  assert.notEqual(halves[0].effects[0].id, halves[1].effects[0].id);
  keyed.undo();
  keyed.execute(tl.removeEffectEntry("v", id), OFF);
  assert.deepEqual(Object.keys(el(keyed.document, "v").animations ?? {}).filter((key) => key.startsWith(`effects.${id}.`)), []);
  keyed.undo();
  assert.ok(el(keyed.document, "v").animations[path], "undo restores the entry and its channels");
  // On a standalone layer the path is the same `effects.<id>.params.<key>`; no `params.<key>` path exists.
  const layered = one();
  const layer = layered.execute(tl.addEffectLayer({ sceneId: "s1", type: "blur", playhead: 0 }), OFF) as any;
  const entryId = el(layered.document, layer.info.elementId).effects[0].id;
  const commit = upsertKeyframe(layered.document, context({ registries: CATALOGUE }), layer.info.elementId, tl.effectParamPath(entryId, "intensity"), { time: 0, value: 30 } as never);
  const paths = Object.keys((commit.document.scenes[0].tracks.overlay.flatMap((track: any) => track.elements).find((element: any) => element.id === layer.info.elementId) as any).animations);
  assert.deepEqual([paths, paths.some((key) => key.startsWith("params."))], [[`effects.${entryId}.params.intensity`], false]);
  // "Soft bloom": Glow with intensity 80 and radius 55; the value at the playhead replaces a keyframed one.
  const saved = tl.saveEffectPreset([], "Soft bloom", { type: "glow", kind: "effect", params: { intensity: 40, radius: 55, threshold: 60 } }, { intensity: 80 }) as any;
  assert.deepEqual(saved.preset, { name: "Soft bloom", type: "glow", kind: "effect", params: { intensity: 80, radius: 55, threshold: 60 } });
  const target = one(), steps = target.historyLength;
  target.execute(tl.applyEffectPreset({ sceneId: "s1", elementIds: ["v"], preset: saved.preset }), OFF);
  assert.deepEqual([stack(target)[0].params, el(target.document, "v").animations ?? {}, target.historyLength - steps], [{ intensity: 80, radius: 55, threshold: 60 }, {}, 1]);
  assert.equal((tl.saveEffectPreset(saved.presets, "Soft bloom", saved.preset) as any).preset.name, "Soft bloom (2)");
  assert.deepEqual(tl.saveEffectPreset(Array.from({ length: 200 }, (_, index) => ({ ...saved.preset, name: `p${index}` })), "x", saved.preset), { ok: false, message: "Preset limit reached (200)" });
  assert.deepEqual(tl.effectPresetState({ ...saved.preset, type: "gone" }), { available: false, label: "Unavailable effect" });
});
