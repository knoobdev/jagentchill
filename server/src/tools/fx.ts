import { z } from "zod";
import {
  addMaskOfType, applyLut, baseValue, BASIC_SLIDERS, EASING_PRESETS, easingPreset, effectDefinition, frameTicks, isAdjustable, isMaskable, KEY_LIMIT, keysOfPath, MASK_COMBINE, MASK_LIMIT, maskHas, maskParamRange, masksOf,
  registerEffectParams, removeAllKeys, removeKeys, removeMask, reorderMask, resetAdjustments, resetChromaKey, setAdjustment, setBasicValues, setChromaKey, setColorCurve, setKeyframe, setMaskField, setMaskParams,
  setSectionEnabled, snapToFrame, storedPaths, timeline, transitionDefinition, type BundledEffectDefinition,
} from "@jagentchill/editor-core";
import { animatablePath, HSL_BANDS, MASK_TYPES, STATIC_ANIMATABLE_PATHS, WHEELS } from "@jagentchill/protocol";
import { SCENE, WRITE, checkRange, clip, color, elementIn, elementLabel, elementsIn, fail, id, ids, outOfRange, readTool, seconds, ticks, trackIn, unlocked, writeTool, type El, type ToolContext, type Tr } from "./kit.ts";

type Json = Record<string, unknown>;
const TICKS = 120_000;
const end = (element: { startTime: number; duration: number }) => element.startTime + element.duration;
const modify = (element: { id: string; name: string }) => ({ kind: "modify" as const, entity: "element" as const, entityId: element.id, label: element.name });
const many = (hits: timeline.Located[]) => (hits.length === 1 ? elementLabel(hits[0].element) : `${hits.length} elements`);
const registry = timeline.createParamRegistry();
registerEffectParams(registry);
const paramValue = () => z.union([z.number(), z.boolean(), z.string().max(4000)]);

/** A library effect or filter with its parameters checked: an unknown id, an unknown key, a value outside its range. */
function library(effectId: string, kind: "effect" | "filter", params: Record<string, unknown> | undefined): BundledEffectDefinition {
  const definition = effectDefinition(effectId);
  if (!definition || definition.kind !== kind) return fail("LIBRARY_ITEM_NOT_FOUND", `"${effectId}" is not a ${kind} of the library. Find ids with jc_library_search {kind: "${kind}"}.`, { field: `${kind}Id`, id: effectId });
  for (const [key, value] of Object.entries(params ?? {})) {
    const known = definition.params.find((entry) => entry.key === key);
    if (!known) fail("INVALID_PARAMS", `"${key}" is not a parameter of the ${kind} "${definition.name}". Its parameters are: ${definition.params.map((entry) => entry.key).join(", ") || "none"}.`, { field: `params.${key}`, allowed: definition.params.map((entry) => entry.key) });
    if (known!.type === "number") {
      if (typeof value !== "number") fail("INVALID_PARAMS", `params.${key} is a number.`, { field: `params.${key}` });
      if (known!.min !== undefined && known!.max !== undefined) checkRange(`params.${key}`, value as number, known!.min, known!.max);
    } else if (known!.type === "boolean" && typeof value !== "boolean") fail("INVALID_PARAMS", `params.${key} is true or false.`, { field: `params.${key}` });
    else if (known!.type === "select" && !(known!.options ?? []).includes(String(value))) fail("INVALID_PARAMS", `params.${key} must be one of: ${(known!.options ?? []).join(", ")}.`, { field: `params.${key}`, allowed: known!.options });
    else if (known!.type === "color" && !(typeof value === "string" && /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value))) fail("INVALID_PARAMS", `params.${key} is a colour, #RRGGBB or #RRGGBBAA.`, { field: `params.${key}` });
  }
  return definition;
}
const stack = (element: El): { id: string; type: string; kind: string; enabled: boolean; params: Json }[] => (Array.isArray(element.effects) ? element.effects : []) as never;
function layer(ctx: ToolContext, sceneId: string | undefined, definition: BundledEffectDefinition, at: { start: number; duration: number }, params: Record<string, unknown> | undefined) {
  const scene = ctx.scene(sceneId), frame = frameTicks(ctx.doc.settings.fps);
  if (!definition.layer) fail("UNSUPPORTED_FOR_ELEMENT", `The effect "${definition.name}" works on a clip only, not as a standalone layer. Apply it with target {elementIds}.`, { effectId: definition.type });
  if (at.duration < frame) outOfRange("duration", frame, 2_592_000_000, at.duration, "at least one frame");
  const made = ctx.run(timeline.addEffectLayer({ sceneId: scene.id, type: definition.type, playhead: at.start, duration: at.duration }));
  const entry = stack(timeline.located(ctx.doc, made.elementId).element)[0];
  if (params && Object.keys(params).length > 0) ctx.run(timeline.setParams({ registry, writes: Object.entries(params).map(([key, value]) => ({ elementId: made.elementId, key: `effects.${entry.id}.${key}`, value })) }));
  return { elementId: made.elementId, trackId: made.trackId, effectInstanceId: entry.id };
}

// — Keyframes —
const easingShape = () => z.union([z.string().min(1).max(40), z.object({ bezier: z.tuple([z.number(), z.number(), z.number(), z.number()]) }).strict()]);
function validPaths(element: El): string[] {
  const fixed = STATIC_ANIMATABLE_PATHS.filter((entry) => (entry.types as readonly string[]).includes(element.type)).map((entry) => entry.path);
  const effects = stack(element).flatMap((entry) => (effectDefinition(entry.type)?.params ?? []).filter((param) => param.keyframable).map((param) => `effects.${entry.id}.params.${param.key}`));
  const masks = masksOf(element as Json).flatMap((mask) => Object.keys(mask.params).map((key) => `masks.${mask.id}.params.${key}`).filter((path) => animatablePath(element as never, path)));
  const graphic = element.type === "graphic" ? Object.keys((element.params ?? {}) as object).map((key) => `params.${key}`).filter((path) => animatablePath(element as never, path)) : [];
  return [...fixed, ...effects, ...masks, ...graphic];
}
function propertyOf(element: El, property: string): { paths: string[]; range?: { min: number; max: number }; shape: string | null } {
  if (property === "transform.scale" && animatablePath(element as never, "transform.scale.x")) return { paths: storedPaths(property), range: animatablePath(element as never, "transform.scale.x")!.range, shape: "scalar" };
  const found = animatablePath(element as never, property);
  if (!found) {
    const valid = validPaths(element);
    return fail("INVALID_PARAMS", `"${property}" is not an animatable property of ${elementLabel(element)}. Use one of the canonical paths, for example: ${valid.slice(0, 12).join(", ")}${valid.length > 12 ? ", … (jc_keyframe_properties lists them all)" : ""}.`, { field: "property", allowed: valid });
  }
  let range = found!.range;
  if (found!.entry?.collection === "effects") { const entry = stack(element).find((item) => item.id === found!.entry!.id), param = effectDefinition(entry?.type ?? "")?.params.find((item) => item.key === found!.entry!.key); if (param?.min !== undefined && param.max !== undefined) range = { min: param.min, max: param.max }; }
  return { paths: [property], range, shape: found!.shape };
}

export const FX_TOOLS = [
  writeTool({
    name: "jc_effect_apply", family: "effect",
    description: "Apply an effect of the library (ids from jc_library_search {kind: \"effect\"}) to elements, or as a standalone effect layer over a time range (effectLayer) or over the whole scene (scene: true). params override the effect's defaults and are checked against its parameter ranges. An element holds at most 16 effect entries. Returns the effect instance ids.",
    shape: {
      target: z.union([z.object({ elementIds: ids() }).strict(), z.object({ scene: z.literal(true) }).strict(), z.object({ effectLayer: z.object({ start: ticks(), duration: ticks() }).strict() }).strict()]),
      effectId: id(), params: z.record(paramValue()).optional(), ...SCENE, ...WRITE,
    },
    handle(ctx, args) {
      const definition = library(args.effectId, "effect", args.params);
      if ("elementIds" in args.target) {
        const { scene, hits } = elementsIn(ctx, args.target.elementIds);
        for (const hit of hits) {
          unlocked(hit.track);
          if (!timeline.acceptsEffect(definition, hit.element) || hit.element.type === "effect") fail("UNSUPPORTED_FOR_ELEMENT", `The effect "${definition.name}" cannot be applied to ${elementLabel(hit.element)}: it works on ${definition.targets.join(", ")} elements.`, { elementId: hit.element.id });
          if (stack(hit.element).length >= timeline.EFFECT_STACK_LIMIT) outOfRange("effects", 0, timeline.EFFECT_STACK_LIMIT, stack(hit.element).length + 1, `${elementLabel(hit.element)} already holds 16 effect entries; remove one first`);
        }
        const before = new Map(hits.map((hit) => [hit.element.id, new Set(stack(hit.element).map((entry) => entry.id))]));
        ctx.run(timeline.applyEffect({ sceneId: scene.id, elementIds: args.target.elementIds, type: definition.type, ...(args.params ? { params: args.params as Record<string, number | boolean | string> } : {}) }));
        const instances = args.target.elementIds.map((elementId) => ({ elementId, effectInstanceId: stack(timeline.located(ctx.doc, elementId).element).find((entry) => !before.get(elementId)!.has(entry.id))!.id }));
        return { data: { effectId: definition.type, instances, effectInstanceId: instances[0].effectInstanceId }, summary: `Applied the effect "${definition.name}" to ${many(hits)}.`, change: modify(hits[0].element) };
      }
      const scene = ctx.scene(args.sceneId), at = "scene" in args.target ? { start: 0, duration: Math.max(timeline.sceneDurationOf(scene), frameTicks(ctx.doc.settings.fps)) } : args.target.effectLayer;
      const made = layer(ctx, scene.id, definition, at, args.params);
      return { data: { effectId: definition.type, ...made }, summary: `Added the effect layer "${definition.name}" (${seconds(at.duration)} from ${seconds(at.start)}).`, change: { kind: "add", entity: "element", entityId: made.elementId, label: definition.name } };
    },
  }),
  writeTool({
    name: "jc_effect_update", family: "effect",
    description: "Change one effect instance of an element: its parameters (checked against the effect's ranges), whether it is enabled, and its position in the element's effect order.",
    shape: { elementId: id(), effectInstanceId: id(), params: z.record(paramValue()).optional(), enabled: z.boolean().optional(), order: z.number().int().min(0).max(15).optional(), ...WRITE },
    refine(args) { if (args.params === undefined && args.enabled === undefined && args.order === undefined) fail("INVALID_PARAMS", "Name what to change: params, enabled or order."); },
    handle(ctx, args) {
      const hit = elementIn(ctx, args.elementId), entry = stack(hit.element).find((item) => item.id === args.effectInstanceId) ?? fail("NOT_FOUND", `${elementLabel(hit.element)} has no effect instance "${args.effectInstanceId}". Read the element with jc_timeline_snapshot {detail: "full"}.`, { effectInstanceId: args.effectInstanceId });
      unlocked(hit.track);
      const definition = library(entry.type, entry.kind as "effect" | "filter", args.params);
      if (args.params && Object.keys(args.params).length > 0) ctx.run(timeline.setParams({ registry, writes: Object.entries(args.params).map(([key, value]) => ({ elementId: hit.element.id, key: `effects.${entry.id}.${key}`, value })), label: "Edit effect" }));
      if (args.enabled !== undefined && args.enabled !== entry.enabled) ctx.run(timeline.toggleEffect(hit.element.id, entry.id));
      if (args.order !== undefined) { if (args.order > stack(hit.element).length - 1) outOfRange("order", 0, stack(hit.element).length - 1, args.order); ctx.run(timeline.reorderEffect(hit.element.id, entry.id, args.order)); }
      const now = stack(timeline.located(ctx.doc, hit.element.id).element);
      return { data: { elementId: hit.element.id, effectInstanceId: entry.id, effect: now.find((item) => item.id === entry.id), order: now.map((item) => item.id) }, summary: `Changed the effect "${definition.name}" of ${elementLabel(hit.element)}.`, change: modify(hit.element) };
    },
  }),
  writeTool({
    name: "jc_effect_remove", family: "effect",
    description: "Remove effect instances from an element by id, or all of its effects (all: true). A filter is removed with jc_filter_remove.",
    shape: { elementId: id(), effectInstanceIds: ids(16).optional(), all: z.literal(true).optional(), ...WRITE },
    refine(args) { if ((args.effectInstanceIds === undefined) === (args.all === undefined)) fail("INVALID_PARAMS", "Give either effectInstanceIds or all: true, exactly one.", { field: "effectInstanceIds" }); },
    handle(ctx, args) {
      const hit = elementIn(ctx, args.elementId), entries = stack(hit.element);
      unlocked(hit.track);
      const wanted = args.all ? entries.filter((entry) => entry.kind === "effect").map((entry) => entry.id) : args.effectInstanceIds!;
      for (const instance of wanted) if (!entries.some((entry) => entry.id === instance)) fail("NOT_FOUND", `${elementLabel(hit.element)} has no effect instance "${instance}".`, { effectInstanceId: instance });
      for (const instance of wanted) ctx.run(timeline.removeEffectEntry(hit.element.id, instance));
      return { data: { elementId: hit.element.id, removed: wanted }, summary: `Removed ${wanted.length} effect(s) from ${elementLabel(hit.element)}.`, change: modify(hit.element) };
    },
  }),
  writeTool({
    name: "jc_filter_apply", family: "filter",
    description: "Apply a filter of the library (ids from jc_library_search {kind: \"filter\"}) to elements, or as a standalone filter layer over a time range. intensity is 0–100 (default 100). An element has at most one filter: a second one replaces the first.",
    shape: { target: z.union([z.object({ elementIds: ids() }).strict(), z.object({ filterLayer: z.object({ start: ticks(), duration: ticks() }).strict() }).strict()]), filterId: id(), intensity: z.number().optional(), ...SCENE, ...WRITE },
    refine(args) { checkRange("intensity", args.intensity, 0, 100); },
    handle(ctx, args) {
      const definition = library(args.filterId, "filter", undefined), params = { intensity: args.intensity ?? 100 };
      if ("elementIds" in args.target) {
        const { scene, hits } = elementsIn(ctx, args.target.elementIds);
        for (const hit of hits) {
          unlocked(hit.track);
          if (!timeline.acceptsEffect(definition, hit.element) || hit.element.type === "effect") fail("UNSUPPORTED_FOR_ELEMENT", `A filter cannot be applied to ${elementLabel(hit.element)}.`, { elementId: hit.element.id });
          if (!stack(hit.element).some((entry) => entry.kind === "filter") && stack(hit.element).length >= timeline.EFFECT_STACK_LIMIT) outOfRange("effects", 0, timeline.EFFECT_STACK_LIMIT, stack(hit.element).length + 1, `${elementLabel(hit.element)} already holds 16 effect entries`);
        }
        ctx.run(timeline.applyEffect({ sceneId: scene.id, elementIds: args.target.elementIds, type: definition.type, params }));
        const instances = args.target.elementIds.map((elementId) => ({ elementId, filterInstanceId: stack(timeline.located(ctx.doc, elementId).element).find((entry) => entry.kind === "filter")!.id }));
        return { data: { filterId: definition.type, intensity: params.intensity, instances }, summary: `Applied the filter "${definition.name}" at ${params.intensity} % to ${many(hits)}.`, change: modify(hits[0].element) };
      }
      const made = layer(ctx, args.sceneId, definition, args.target.filterLayer, params);
      return { data: { filterId: definition.type, intensity: params.intensity, ...made }, summary: `Added the filter layer "${definition.name}" (${seconds(args.target.filterLayer.duration)}).`, change: { kind: "add", entity: "element", entityId: made.elementId, label: definition.name } };
    },
  }),
  writeTool({
    name: "jc_filter_remove", family: "filter",
    description: "Remove the filter of elements. Their other effects stay.",
    shape: { elementIds: ids(), ...WRITE },
    handle(ctx, args) {
      const { hits } = elementsIn(ctx, args.elementIds);
      for (const hit of hits) unlocked(hit.track);
      const removed = args.elementIds.filter((elementId) => ctx.run(timeline.removeFilter(elementId)).removed);
      if (removed.length === 0) ctx.warnings.push("no_change");
      return { data: { removedFrom: removed }, summary: removed.length > 0 ? `Removed the filter from ${removed.length} element(s).` : "None of the elements had a filter.", change: modify(hits[0].element) };
    },
  }),

  writeTool({
    name: "jc_transition_set", family: "transition",
    description: "Put a transition of the library (ids from jc_library_search {kind: \"transition\"}) on the cut between two adjacent clips of one video track (betweenElementIds), or on every eligible cut of a track (allOnTrack). duration is in ticks; outside the limits of that cut the call fails with OUT_OF_RANGE and the valid range. Omitted, the default 0.5 s is used, shortened to what the cut allows.",
    shape: {
      betweenElementIds: z.tuple([id(), id()]).optional(), allOnTrack: id().optional(), transitionId: id(), duration: ticks().optional(), params: z.record(paramValue()).optional(),
      easing: z.enum(["linear", "ease-in", "ease-out", "ease-in-out"]).optional(), audioCrossfade: z.boolean().optional(), shape: z.enum(["linear", "equal-power", "s-curve", "logarithmic", "exponential"]).optional(), ...WRITE,
    },
    refine(args) { if ((args.betweenElementIds === undefined) === (args.allOnTrack === undefined)) fail("INVALID_PARAMS", "Give either betweenElementIds or allOnTrack, exactly one.", { field: "betweenElementIds" }); },
    handle(ctx, args) {
      const definition = transitionDefinition(args.transitionId) ?? fail("LIBRARY_ITEM_NOT_FOUND", `"${args.transitionId}" is not a transition of the library. Find ids with jc_library_search {kind: "transition"}.`, { field: "transitionId", id: args.transitionId });
      for (const key of Object.keys(args.params ?? {})) if (!definition.params.some((entry) => entry.key === key)) fail("INVALID_PARAMS", `"${key}" is not a parameter of the transition "${definition.name}". Its parameters are: ${definition.params.map((entry) => entry.key).join(", ") || "none"}.`, { field: `params.${key}`, allowed: definition.params.map((entry) => entry.key) });
      for (const entry of definition.params) { const value = args.params?.[entry.key]; if (typeof value === "number" && entry.min !== undefined && entry.max !== undefined) checkRange(`params.${entry.key}`, value, entry.min, entry.max); }
      const fps = ctx.doc.settings.fps, extra = { ...(args.params ? { params: args.params } : {}), ...(args.easing ? { easing: args.easing } : {}), ...(args.audioCrossfade !== undefined ? { audioCrossfade: args.audioCrossfade } : {}), ...(args.shape ? { shape: args.shape } : {}) };
      const applyOn = (sceneId: string, track: Tr, fromId: string, toId: string, strict: boolean): { transitionId: string; duration: number } | null => {
        const existing = (track.transitions as Json[]).find((record) => record.kind === "transition" && record.fromElementId === fromId && record.toElementId === toId);
        const limits = timeline.durationLimits(track, fromId, toId, fps, existing ? String(existing.id) : undefined), wanted = args.duration !== undefined ? args.duration / TICKS : undefined;
        if (limits.max < limits.min) { if (strict) fail("OUT_OF_RANGE", "These clips are too short to hold a transition between them.", { field: "duration", min: 0, max: 0 }); return null; }
        if (wanted !== undefined && (wanted < limits.min || wanted > limits.max)) { if (strict) outOfRange("duration", Math.round(limits.min * TICKS), Math.round(limits.max * TICKS), args.duration, `ticks; this cut takes ${limits.min}–${limits.max} s`); return null; }
        const made = ctx.run(timeline.applyTransition({ sceneId, fromId, toId, type: definition.type, seconds: wanted ?? Math.min(timeline.DEFAULT_TRANSITION_SECONDS, limits.max), ...(args.params ? { params: args.params } : {}) }));
        if (Object.keys(extra).length > 0 || (existing && wanted !== undefined)) ctx.run(timeline.editTransition(made.transitionId, { ...extra, ...(wanted !== undefined ? { seconds: wanted } : {}) }, { strict: true }));
        const record = (timeline.trackById(ctx.scene(sceneId), track.id)!.transitions as Json[]).find((item) => item.id === made.transitionId)!;
        return { transitionId: made.transitionId, duration: Number(record.duration) };
      };
      if (args.betweenElementIds) {
        const [a, b] = args.betweenElementIds.map((elementId) => elementIn(ctx, elementId));
        if (a.track.id !== b.track.id) fail("INVALID_PARAMS", "The two elements are on different tracks. A transition joins two adjacent clips of the same track.", { field: "betweenElementIds" });
        unlocked(a.track);
        const [from, to] = a.element.startTime <= b.element.startTime ? [a.element, b.element] : [b.element, a.element];
        if (end(from) !== to.startTime) fail("INVALID_PARAMS", `The elements are not adjacent: there is ${end(from) < to.startTime ? `a gap of ${seconds(to.startTime - end(from))}` : "an overlap"} between them. Close the gap first (jc_gap_close or jc_clip_move).`, { field: "betweenElementIds", gap: to.startTime - end(from) });
        if (!timeline.isEligibleCut(a.track, from, to)) fail("UNSUPPORTED_FOR_ELEMENT", "A transition joins video, image or compound clips on a video track.", { elementIds: args.betweenElementIds });
        const made = applyOn(a.scene.id, a.track, from.id, to.id, true)!;
        return { data: { transitionId: made.transitionId, type: definition.type, duration: made.duration, fromElementId: from.id, toElementId: to.id }, summary: `Set the transition "${definition.name}" (${seconds(made.duration)}) between ${elementLabel(from)} and ${elementLabel(to)}.`, change: modify(from) };
      }
      const { scene, track } = trackIn(ctx, args.allOnTrack!);
      unlocked(track);
      const cuts = timeline.eligibleCuts(scene).filter((cut) => cut.trackId === track.id), applied: Json[] = [];
      if (cuts.length === 0) fail("INVALID_PARAMS", `The track "${track.name}" has no cut between two adjacent clips to put a transition on.`, { field: "allOnTrack" });
      for (const cut of cuts) {
        const live = timeline.trackById(ctx.scene(scene.id), track.id)!, made = applyOn(scene.id, live, cut.fromId, cut.toId, false);
        if (made) applied.push({ ...made, fromElementId: cut.fromId, toElementId: cut.toId }); else ctx.warnings.push(`skipped_pair: ${cut.fromId} → ${cut.toId} cannot hold this duration`);
      }
      if (applied.length === 0) fail("OUT_OF_RANGE", "No cut of the track can hold a transition of that duration. Use a shorter duration.", { field: "duration", min: Math.round(timeline.TRANSITION_MIN_SECONDS * TICKS), max: args.duration ?? Math.round(timeline.DEFAULT_TRANSITION_SECONDS * TICKS) });
      return { data: { type: definition.type, transitions: applied }, summary: `Set the transition "${definition.name}" on ${applied.length} cut(s) of the track "${clip(track.name, 40)}".`, change: { kind: "modify", entity: "track", entityId: track.id, label: track.name } };
    },
  }),
  writeTool({
    name: "jc_transition_remove", family: "transition",
    description: "Remove transitions: by transitionIds, between two elements (betweenElementIds), or all of a track (allOnTrack). The clips are neither moved nor trimmed.",
    shape: { transitionIds: ids().optional(), betweenElementIds: z.tuple([id(), id()]).optional(), allOnTrack: id().optional(), ...WRITE },
    refine(args) { if ([args.transitionIds, args.betweenElementIds, args.allOnTrack].filter((value) => value !== undefined).length !== 1) fail("INVALID_PARAMS", "Give exactly one of transitionIds, betweenElementIds or allOnTrack.", { field: "transitionIds" }); },
    handle(ctx, args) {
      const records = (ctx.doc.scenes as unknown as timeline.Sc[]).flatMap((scene) => timeline.tracksOfScene(scene).flatMap((track) => (track.transitions as Json[]).filter((record) => record.kind === "transition").map((record) => ({ track, record }))));
      let wanted: { track: Tr; record: Json }[];
      if (args.transitionIds) wanted = args.transitionIds.map((transitionId) => records.find((entry) => entry.record.id === transitionId) ?? fail("NOT_FOUND", `No transition has the id "${transitionId}".`, { transitionId }));
      else if (args.betweenElementIds) { const pair = new Set(args.betweenElementIds); wanted = records.filter((entry) => pair.has(String(entry.record.fromElementId)) && pair.has(String(entry.record.toElementId))); if (wanted.length === 0) fail("NOT_FOUND", "There is no transition between these two elements.", { elementIds: args.betweenElementIds }); }
      else { const { track } = trackIn(ctx, args.allOnTrack!); wanted = records.filter((entry) => entry.track.id === track.id); }
      for (const entry of wanted) unlocked(entry.track);
      for (const entry of wanted) ctx.run(timeline.removeTransition(String(entry.record.id)));
      if (wanted.length === 0) ctx.warnings.push("no_change");
      return { data: { removed: wanted.map((entry) => entry.record.id) }, summary: `Removed ${wanted.length} transition(s).`, change: { kind: "modify", entity: "track", entityId: wanted[0]?.track.id ?? args.allOnTrack ?? "", label: wanted[0]?.track.name ?? "Track" } };
    },
  }),

  writeTool({
    name: "jc_color_adjust", family: "color",
    description: "Set colour adjustments of elements, or add an adjustment layer over a time range and adjust that. basic holds the sliders (exposure, brightness, contrast, saturation, vibrance, highlights, shadows, whites, blacks, temperature, tint: −100 to 100; hue: −180 to 180; sharpness, clarity, fade, vignette, grain: 0–100); hsl per colour band; curves of 2–16 points; wheels; lut. Groups you pass replace the same group, others stay. reset: true clears everything first.",
    shape: {
      target: z.union([z.object({ elementIds: ids() }).strict(), z.object({ adjustmentLayer: z.object({ start: ticks(), duration: ticks() }).strict() }).strict()]),
      basic: z.record(z.number()).optional(), hsl: z.record(z.object({ hue: z.number().optional(), saturation: z.number().optional(), lightness: z.number().optional() }).strict()).optional(),
      curves: z.object(Object.fromEntries(["master", "red", "green", "blue"].map((name) => [name, z.array(z.object({ x: z.number(), y: z.number() }).strict()).optional()])) as Record<"master" | "red" | "green" | "blue", z.ZodOptional<z.ZodArray<z.ZodObject<{ x: z.ZodNumber; y: z.ZodNumber }, "strict">>>>).strict().optional(),
      wheels: z.record(z.object({ x: z.number().optional(), y: z.number().optional(), luminance: z.number().optional() }).strict()).optional(), lut: z.object({ lutId: z.string().max(80).nullable(), intensity: z.number().optional() }).strict().optional(),
      enabled: z.object({ lut: z.boolean().optional(), basic: z.boolean().optional(), wheels: z.boolean().optional(), curves: z.boolean().optional(), hsl: z.boolean().optional() }).strict().optional(), reset: z.boolean().optional(), ...SCENE, ...WRITE,
    },
    refine(args) {
      for (const [key, value] of Object.entries(args.basic ?? {})) {
        const slider = BASIC_SLIDERS.find((entry) => entry.key === key);
        if (!slider) fail("INVALID_PARAMS", `"${key}" is not a basic adjustment. The accepted keys are: ${BASIC_SLIDERS.map((entry) => entry.key).join(", ")}.`, { field: `basic.${key}`, allowed: BASIC_SLIDERS.map((entry) => entry.key) });
        checkRange(`basic.${key}`, value, slider!.min, slider!.max);
        if (!Number.isInteger(value)) fail("INVALID_PARAMS", `basic.${key} is a whole number.`, { field: `basic.${key}` });
      }
      for (const [band, values] of Object.entries(args.hsl ?? {})) {
        if (!(HSL_BANDS as readonly string[]).includes(band)) fail("INVALID_PARAMS", `"${band}" is not a colour band. The bands are: ${HSL_BANDS.join(", ")}.`, { field: `hsl.${band}`, allowed: [...HSL_BANDS] });
        for (const [key, value] of Object.entries(values)) { checkRange(`hsl.${band}.${key}`, value, -100, 100); if (!Number.isInteger(value)) fail("INVALID_PARAMS", `hsl.${band}.${key} is a whole number.`, { field: `hsl.${band}.${key}` }); }
      }
      for (const [name, points] of Object.entries(args.curves ?? {})) {
        if (!points) continue;
        if (points.length < 2) fail("INVALID_PARAMS", `curves.${name} needs at least 2 points (it has ${points.length}).`, { field: `curves.${name}` });
        if (points.length > 16) outOfRange(`curves.${name}`, 2, 16, points.length, "points");
        points.forEach((point, index) => { checkRange(`curves.${name}.${index}.x`, point.x, 0, 1); checkRange(`curves.${name}.${index}.y`, point.y, 0, 1); if (index > 0 && point.x <= points[index - 1].x) fail("INVALID_PARAMS", `curves.${name}: x must increase strictly from point to point.`, { field: `curves.${name}.${index}.x` }); });
      }
      for (const [wheel, value] of Object.entries(args.wheels ?? {})) {
        if (!(WHEELS as readonly string[]).includes(wheel)) fail("INVALID_PARAMS", `"${wheel}" is not a colour wheel. The wheels are: ${WHEELS.join(", ")}.`, { field: `wheels.${wheel}`, allowed: [...WHEELS] });
        checkRange(`wheels.${wheel}.x`, value.x, -1, 1); checkRange(`wheels.${wheel}.y`, value.y, -1, 1); checkRange(`wheels.${wheel}.luminance`, value.luminance, -100, 100);
        if ((value.x ?? 0) ** 2 + (value.y ?? 0) ** 2 > 1) outOfRange(`wheels.${wheel}`, -1, 1, Math.hypot(value.x ?? 0, value.y ?? 0), "x and y lie inside the unit circle");
      }
      checkRange("lut.intensity", args.lut?.intensity, 0, 100);
    },
    handle(ctx, args) {
      let elementIds: string[], created: string | undefined;
      if ("adjustmentLayer" in args.target) {
        const scene = ctx.scene(args.sceneId), at = args.target.adjustmentLayer, frame = frameTicks(ctx.doc.settings.fps);
        if (at.duration < frame) outOfRange("adjustmentLayer.duration", frame, 2_592_000_000, at.duration, "at least one frame");
        const made = ctx.run(timeline.addToTimeline({ sceneId: scene.id, items: [{ kind: "adjustment" }], time: at.start, request: { strategy: "firstAvailable" }, defaults: { ...timeline.FACTORY_INSERT_DEFAULTS, effectDuration: at.duration }, agent: true }));
        elementIds = made.elementIds; created = made.elementIds[0];
      } else elementIds = args.target.elementIds;
      const { hits } = elementsIn(ctx, elementIds);
      for (const hit of hits) { unlocked(hit.track); if (!isAdjustable(hit.element)) fail("UNSUPPORTED_FOR_ELEMENT", `${elementLabel(hit.element)} has no colour adjustments: they apply to video, image, sticker, graphic, compound and adjustment elements.`, { elementId: hit.element.id }); }
      if (args.lut?.lutId && !(ctx.doc.media.luts ?? []).some((lut) => lut.id === args.lut!.lutId) && !args.lut.lutId.startsWith("bundled:")) fail("LIBRARY_ITEM_NOT_FOUND", `No LUT has the id "${args.lut.lutId}" in this project.`, { field: "lut.lutId" });
      const groups: string[] = [], at = hits[0].element.startTime;
      if (args.reset) { ctx.apply((doc, c) => resetAdjustments(doc, c, elementIds)); groups.push("reset"); }
      if (args.basic && Object.keys(args.basic).length > 0) { ctx.apply((doc, c) => setBasicValues(doc, c, elementIds, args.basic!, "Adjust")); groups.push("basic"); }
      for (const [band, values] of Object.entries(args.hsl ?? {})) for (const [key, value] of Object.entries(values)) ctx.apply((doc, c) => setAdjustment(doc, c, elementIds, `adjustments.hsl.${band}.${key}`, value, at));
      if (args.hsl) groups.push("hsl");
      for (const [name, points] of Object.entries(args.curves ?? {})) if (points) ctx.apply((doc, c) => setColorCurve(doc, c, elementIds, name as "master", points));
      if (args.curves) groups.push("curves");
      for (const [wheel, value] of Object.entries(args.wheels ?? {})) for (const [key, entry] of Object.entries(value)) ctx.apply((doc, c) => setAdjustment(doc, c, elementIds, `adjustments.wheels.${wheel}.${key}`, entry, at));
      if (args.wheels) groups.push("wheels");
      if (args.lut) { ctx.apply((doc, c) => applyLut(doc, c, elementIds, args.lut!.lutId)); if (args.lut.intensity !== undefined) ctx.apply((doc, c) => setAdjustment(doc, c, elementIds, "adjustments.lut.intensity", args.lut!.intensity!, at)); groups.push("lut"); }
      for (const [section, value] of Object.entries(args.enabled ?? {})) ctx.apply((doc, c) => setSectionEnabled(doc, c, elementIds, section as "basic", value));
      if (args.enabled) groups.push("enabled");
      if (groups.length === 0 && !created) fail("INVALID_PARAMS", "Name at least one adjustment group: basic, hsl, curves, wheels, lut, enabled or reset.");
      const now = timeline.located(ctx.doc, elementIds[0]).element;
      return { data: { elementIds, ...(created ? { adjustmentLayerId: created } : {}), adjustments: now.adjustments ?? null }, summary: `${created ? "Added an adjustment layer and set" : "Set"} ${groups.join(", ") || "its defaults"} on ${many(hits)}.`, change: created ? { kind: "add", entity: "element", entityId: created, label: "Adjustment" } : modify(hits[0].element) };
    },
  }),

  writeTool({
    name: "jc_keyframe_set", family: "keyframe",
    description: "Set keyframes of one animatable property of an element. property is a canonical path such as transform.position.x, transform.scale (both axes), transform.rotation, opacity, volume, crop.left or effects.<instanceId>.params.<key> (jc_keyframe_properties lists them with ranges). Each keyframe has a timeline time inside the element, a value, and an easing to the next key: a preset id, \"linear\", \"step\" (or \"hold\"), or {bezier: [x1, y1, x2, y2]}. A key at an existing time replaces it; replaceExisting: true removes the property's other keys first.",
    shape: { elementId: id(), property: z.string().min(1).max(200), keyframes: z.array(z.object({ time: ticks(), value: z.union([z.number(), z.string().max(40), z.boolean()]), easing: easingShape().optional() }).strict()).min(1).max(200), replaceExisting: z.boolean().optional(), ...WRITE },
    handle(ctx, args) {
      const hit = elementIn(ctx, args.elementId), { element } = hit;
      unlocked(hit.track);
      const property = propertyOf(element, args.property);
      const keys = args.keyframes.map((key, index) => {
        if (key.time < element.startTime || key.time > end(element)) outOfRange(`keyframes.${index}.time`, element.startTime, end(element), key.time, "a keyframe lies inside its element, in timeline time");
        if (property.shape === "scalar" || (property.shape === null && typeof key.value === "number")) {
          if (typeof key.value !== "number") fail("INVALID_PARAMS", `keyframes.${index}.value is a number for ${args.property}.`, { field: `keyframes.${index}.value` });
          if (property.range) checkRange(`keyframes.${index}.value`, key.value as number, property.range.min, property.range.max);
        } else if (property.shape === "color" && !(typeof key.value === "string" && /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(key.value))) fail("INVALID_PARAMS", `keyframes.${index}.value is a colour (#RRGGBB or #RRGGBBAA) for ${args.property}.`, { field: `keyframes.${index}.value` });
        let segmentToNext: string | undefined, easing: [number, number, number, number] | undefined;
        if (typeof key.easing === "string") {
          if (key.easing === "linear") segmentToNext = "linear";
          else if (key.easing === "step" || key.easing === "hold") segmentToNext = "step";
          // The scenario of the requirement writes the preset "in-out" as "ease-in-out": both name it.
          else { easing = easingPreset(key.easing) ?? easingPreset(key.easing.replace(/^ease-/, "")) ?? fail("LIBRARY_ITEM_NOT_FOUND", `"${key.easing}" is not an easing preset. The preset ids are: ${EASING_PRESETS.map((preset) => preset.id).join(", ")}; "linear" and "step" are also accepted.`, { field: `keyframes.${index}.easing`, allowed: EASING_PRESETS.map((preset) => preset.id) }); segmentToNext = "bezier"; }
        } else if (key.easing) {
          const [x1, , x2] = key.easing.bezier;
          if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) outOfRange(`keyframes.${index}.easing.bezier`, 0, 1, x1 < 0 || x1 > 1 ? x1 : x2, "x1 and x2 lie between 0 and 1");
          easing = key.easing.bezier; segmentToNext = "bezier";
        }
        return { local: key.time - element.startTime, value: key.value, segmentToNext, easing };
      });
      const existing = keysOfPath(element as Json, property.paths[0]).length, added = keys.filter((key) => !keysOfPath(element as Json, property.paths[0]).some((stored) => stored.time === key.local)).length;
      if ((args.replaceExisting ? 0 : existing) + added > KEY_LIMIT) outOfRange("keyframes", 1, KEY_LIMIT - (args.replaceExisting ? 0 : existing), added, `a property holds at most ${KEY_LIMIT} keyframes`);
      if (args.replaceExisting && existing > 0) ctx.apply((doc, c) => removeAllKeys(doc, c, element.id, args.property, 0));
      // In time order, so that the easing of each key shapes the segment to the key written after it.
      for (const key of [...keys].sort((a, b) => a.local - b.local)) ctx.apply((doc, c) => setKeyframe(doc, c, element.id, args.property, { time: key.local, value: key.value as number, ...(key.segmentToNext ? { segmentToNext: key.segmentToNext } : {}), ...(key.easing ? { easing: key.easing } : {}) }));
      const now = timeline.located(ctx.doc, element.id).element as Json;
      const stored = keysOfPath(now, property.paths[0]).map((key) => ({ time: element.startTime + key.time, value: (key as unknown as Json).value, segmentToNext: (key as unknown as Json).segmentToNext }));
      return { data: { elementId: element.id, property: args.property, storedPaths: property.paths, keyframes: stored }, summary: `Set ${keys.length} keyframe(s) of ${args.property} on ${elementLabel(element)}.`, change: modify(element) };
    },
  }),
  writeTool({
    name: "jc_keyframe_remove", family: "keyframe",
    description: "Remove keyframes of one property of an element: the ones at the given timeline times, or all of them (all: true). When the last key goes, the property keeps the value it had.",
    shape: { elementId: id(), property: z.string().min(1).max(200), times: z.array(ticks()).min(1).max(200).optional(), all: z.literal(true).optional(), ...WRITE },
    refine(args) { if ((args.times === undefined) === (args.all === undefined)) fail("INVALID_PARAMS", "Give either times or all: true, exactly one.", { field: "times" }); },
    handle(ctx, args) {
      const hit = elementIn(ctx, args.elementId), { element } = hit;
      unlocked(hit.track);
      const property = propertyOf(element, args.property), fps = ctx.doc.settings.fps;
      const stored = property.paths.flatMap((path) => keysOfPath(element as Json, path).map((key) => ({ elementId: element.id, path, keyId: key.id, time: key.time })));
      const wanted = args.all ? stored : stored.filter((key) => args.times!.some((time) => snapToFrame(Math.max(0, time - element.startTime), fps) === key.time));
      if (wanted.length === 0) { ctx.warnings.push("no_change"); return { data: { elementId: element.id, property: args.property, removed: 0 }, summary: `No keyframe of ${args.property} was at the given times.`, change: modify(element) }; }
      ctx.apply((doc, c) => removeKeys(doc, c, wanted.map(({ elementId, path, keyId }) => ({ elementId, path, keyId }))));
      return { data: { elementId: element.id, property: args.property, removed: new Set(wanted.map((key) => key.time)).size }, summary: `Removed ${new Set(wanted.map((key) => key.time)).size} keyframe(s) of ${args.property} from ${elementLabel(element)}.`, change: modify(element) };
    },
  }),

  writeTool({
    name: "jc_speed_set", family: "speed",
    description: "Change the playback speed of video and audio elements: a constant rate (0.1–100), a speed curve (a preset: montage, hero, bullet, jump-cut, flash-in, flash-out; or 2–32 points {u 0–1, rate 0.1–10} with u from exactly 0 to exactly 1), reverse, maintainPitch and frame smoothing. The element's length changes with its speed; ripple (default on the main track) moves the following elements with it. Returns the new durations.",
    shape: {
      elementIds: ids(), rate: z.number().optional(), curve: z.union([z.object({ preset: z.string().min(1).max(40) }).strict(), z.object({ points: z.array(z.object({ u: z.number(), rate: z.number() }).strict()) }).strict(), z.null()]).optional(),
      maintainPitch: z.boolean().optional(), reverse: z.boolean().optional(), smooth: z.enum(["none", "blend", "flow"]).optional(), ripple: z.boolean().optional(), ...WRITE,
    },
    refine(args) {
      checkRange("rate", args.rate, timeline.SPEED_LIMITS.min, timeline.SPEED_LIMITS.max);
      if (args.curve && "points" in args.curve) {
        const points = args.curve.points;
        if (points.length < 2 || points.length > timeline.SPEED_LIMITS.maxPoints) outOfRange("curve.points", 2, timeline.SPEED_LIMITS.maxPoints, points.length, "points");
        points.forEach((point, index) => { checkRange(`curve.points.${index}.u`, point.u, 0, 1); checkRange(`curve.points.${index}.rate`, point.rate, timeline.SPEED_LIMITS.curveMin, timeline.SPEED_LIMITS.curveMax); });
        if (points[0].u !== 0 || points[points.length - 1].u !== 1 || points.some((point, index) => index > 0 && point.u <= points[index - 1].u)) fail("INVALID_PARAMS", "curve.points: u starts at exactly 0, ends at exactly 1 and increases strictly.", { field: "curve.points" });
      }
      if (args.curve && "preset" in args.curve && !timeline.SPEED_CURVE_PRESETS[args.curve.preset]) fail("LIBRARY_ITEM_NOT_FOUND", `"${args.curve.preset}" is not a speed curve preset. The presets are: ${Object.keys(timeline.SPEED_CURVE_PRESETS).join(", ")}.`, { field: "curve.preset", allowed: Object.keys(timeline.SPEED_CURVE_PRESETS) });
      if (args.rate === undefined && args.curve === undefined && args.maintainPitch === undefined && args.reverse === undefined && args.smooth === undefined) fail("INVALID_PARAMS", "Name what to change: rate, curve, reverse, maintainPitch or smooth.");
    },
    handle(ctx, args) {
      const { scene, hits } = elementsIn(ctx, args.elementIds);
      for (const hit of hits) {
        unlocked(hit.track);
        if (!timeline.isRetimable(hit.element)) fail("UNSUPPORTED_FOR_ELEMENT", `The speed of ${elementLabel(hit.element)} cannot be changed: speed applies to video and audio clips.`, { elementId: hit.element.id });
        if (args.curve && hit.element.type === "compound") fail("UNSUPPORTED_FOR_ELEMENT", "A compound clip takes a constant rate only, not a speed curve.", { elementId: hit.element.id });
      }
      const change: timeline.SpeedChange = { ...(args.rate !== undefined ? { rate: args.rate } : {}), ...(args.curve !== undefined ? { curve: args.curve } : {}), ...(args.reverse !== undefined ? { reverse: args.reverse } : {}), ...(args.maintainPitch !== undefined ? { maintainPitch: args.maintainPitch } : {}), ...(args.smooth ? { smooth: args.smooth } : {}) };
      const made = ctx.run(timeline.setSpeed({ sceneId: scene.id, elementIds: args.elementIds, change }));
      const after = args.elementIds.map((elementId) => { const now = timeline.located(ctx.doc, elementId).element; return { elementId, start: now.startTime, duration: now.duration, retime: now.retime ?? null }; });
      return { data: { elements: after, captionsRetimed: made.captionsRetimed, sceneDuration: timeline.sceneDurationOf(ctx.scene(scene.id)) }, summary: `Changed the speed of ${many(hits)}; ${hits.length === 1 ? `it is now ${seconds(after[0].duration)} long` : "their lengths changed with it"}.`, change: modify(hits[0].element) };
    },
  }),

  writeTool({
    name: "jc_mask_set", family: "mask",
    description: "Manage the masks of an element (video, image, graphic, sticker, compound, adjustment; at most 8): add one of a type (split, mirror, cinematic-bars, rectangle, ellipse, heart, diamond, star, text, freeform), update its params, combine mode or enabled state, remove it, or reorder it. params use stored units: centerX/centerY −1 to 1, sizes as a fraction of the short side, feather 0–1000, rotation in degrees.",
    shape: {
      elementId: id(), action: z.enum(["add", "update", "remove", "reorder"]), maskId: id().optional(), index: z.number().int().min(0).max(7).optional(), type: z.enum(MASK_TYPES).optional(), combine: z.enum(MASK_COMBINE).optional(),
      enabled: z.boolean().optional(), params: z.record(paramValue()).optional(), ...WRITE,
    },
    refine(args) {
      if (args.action === "add" && !args.type) fail("INVALID_PARAMS", "add needs type.", { field: "type" });
      if (args.action !== "add" && !args.maskId) fail("INVALID_PARAMS", `${args.action} needs maskId.`, { field: "maskId" });
      if (args.action === "reorder" && args.index === undefined) fail("INVALID_PARAMS", "reorder needs index.", { field: "index" });
    },
    handle(ctx, args) {
      const hit = elementIn(ctx, args.elementId), { element } = hit;
      unlocked(hit.track);
      if (!isMaskable(element)) fail("UNSUPPORTED_FOR_ELEMENT", `${elementLabel(element)} cannot be masked: masks apply to video, image, graphic, sticker, compound and adjustment elements.`, { elementId: element.id });
      const masks = masksOf(element as Json);
      let maskId = args.maskId ?? "";
      if (args.action === "add") {
        if (masks.length >= MASK_LIMIT) outOfRange("masks", 0, MASK_LIMIT, masks.length + 1, "an element holds at most 8 masks");
        maskId = ctx.commitContext().newId();
        ctx.apply((doc, c) => addMaskOfType(doc, c, element.id, args.type!, maskId));
      } else if (!masks.some((mask) => mask.id === maskId)) fail("NOT_FOUND", `${elementLabel(element)} has no mask "${maskId}".`, { maskId });
      if (args.action === "remove") { ctx.apply((doc, c) => removeMask(doc, c, element.id, maskId)); return { data: { elementId: element.id, removedMaskId: maskId }, summary: `Removed a mask from ${elementLabel(element)}.`, change: modify(element) }; }
      if (args.action === "reorder") { if (args.index! > masks.length - 1) outOfRange("index", 0, masks.length - 1, args.index); ctx.apply((doc, c) => reorderMask(doc, c, element.id, maskId, args.index!)); }
      const type = masksOf(timeline.located(ctx.doc, element.id).element as Json).find((mask) => mask.id === maskId)!.type;
      for (const [key, value] of Object.entries(args.params ?? {})) {
        if (!maskHas(type, key) || key === "path") fail("INVALID_PARAMS", `A ${type} mask has no "${key}" parameter${key === "path" ? " that this tool sets" : ""}.`, { field: `params.${key}` });
        const range = maskParamRange(key);
        if (typeof value === "number" && range && key !== "rotation") checkRange(`params.${key}`, value, range.min, range.max);
      }
      if (args.params && Object.keys(args.params).length > 0) ctx.apply((doc, c) => setMaskParams(doc, c, element.id, maskId, args.params as Record<string, number | boolean | string>));
      if (args.combine !== undefined || args.enabled !== undefined) ctx.apply((doc, c) => setMaskField(doc, c, element.id, maskId, { ...(args.combine ? { combine: args.combine } : {}), ...(args.enabled !== undefined ? { enabled: args.enabled } : {}) }));
      const now = masksOf(timeline.located(ctx.doc, element.id).element as Json);
      return { data: { elementId: element.id, maskId, mask: now.find((mask) => mask.id === maskId), order: now.map((mask) => mask.id) }, summary: `${args.action === "add" ? `Added a ${type} mask to` : args.action === "reorder" ? "Reordered a mask of" : "Changed a mask of"} ${elementLabel(element)}.`, change: modify(element) };
    },
  }),
  writeTool({
    name: "jc_chroma_set", family: "chroma",
    description: "Set chroma keying (green-screen removal) of video and image elements: enabled, the key colour (#RRGGBB) and strength, edge, shadow and spill (each 0–100). enabled: false keeps the settings and turns the key off.",
    shape: { elementIds: ids(), enabled: z.boolean(), color: color().optional(), strength: z.number().optional(), edge: z.number().optional(), shadow: z.number().optional(), spill: z.number().optional(), reset: z.boolean().optional(), ...WRITE },
    refine(args) {
      for (const key of ["strength", "edge", "shadow", "spill"] as const) checkRange(key, args[key], 0, 100);
      if (args.color && args.color.length !== 7) fail("INVALID_PARAMS", "The key colour is #RRGGBB, without alpha.", { field: "color" });
    },
    handle(ctx, args) {
      const { hits } = elementsIn(ctx, args.elementIds);
      for (const hit of hits) { unlocked(hit.track); if (hit.element.type !== "video" && hit.element.type !== "image") fail("UNSUPPORTED_FOR_ELEMENT", `${elementLabel(hit.element)} cannot be keyed: chroma key applies to video and image clips.`, { elementId: hit.element.id }); }
      const change = { enabled: args.enabled, ...(args.color ? { color: args.color } : {}), ...Object.fromEntries((["strength", "edge", "shadow", "spill"] as const).filter((key) => args[key] !== undefined).map((key) => [key, args[key]])) };
      for (const hit of hits) { if (args.reset) ctx.apply((doc, c) => resetChromaKey(doc, c, hit.element.id)); ctx.apply((doc, c) => setChromaKey(doc, c, hit.element.id, change)); }
      return { data: { elementIds: args.elementIds, chromaKey: timeline.located(ctx.doc, args.elementIds[0]).element.chromaKey }, summary: `${args.enabled ? "Set" : "Turned off"} the chroma key of ${many(hits)}.`, change: modify(hits[0].element) };
    },
  }),
  readTool({
    name: "jc_keyframe_properties", family: "keyframe",
    description: "List the animatable property paths of an element with their current value, their range and how many keyframes each has. Use the paths with jc_keyframe_set; transform.scale is accepted there as shorthand for both scale paths.",
    shape: { elementId: id() },
    handle(ctx, args) {
      const { element } = elementIn(ctx, args.elementId);
      const properties = validPaths(element).map((path) => {
        const found = animatablePath(element as never, path), property = found ? propertyOf(element, path) : undefined;
        return { path, value: baseValue(element as Json, path) ?? null, ...(property?.range ? { min: property.range.min, max: property.range.max } : {}), kind: found?.shape ?? "scalar", keyframes: keysOfPath(element as Json, path).length };
      });
      return { elementId: element.id, elementType: element.type, start: element.startTime, duration: element.duration, properties, shorthand: properties.some((entry) => entry.path === "transform.scale.x") ? ["transform.scale"] : [] };
    },
  }),
];
