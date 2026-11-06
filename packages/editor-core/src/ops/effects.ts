import { createElement, MASK_VARIANTS, type MaskType, type ProjectDocument, type Rational } from "@jagentchill/protocol";
import type { z } from "zod";
import { clone, findAsset, isObject, type Json } from "../model.ts";
import { EQ_PRESET_BANDS } from "../registries.ts";
import { replaceToolKeys } from "./animation.ts";
import { edit, editable, elementIn, reject, sortElements, trackIn, type Commit, type CommitContext } from "./shared.ts";

const defaults = (ctx: CommitContext, type: string): Record<string, number | boolean | string> =>
  Object.fromEntries(Object.entries(ctx.registries?.effects?.[type]?.params ?? {}).map(([key, definition]) => [key, definition.default]));

/** Adds an effect or filter entry to a clip, with every parameter of its definition written out. */
export function addEffect(doc: ProjectDocument, ctx: CommitContext, elementId: string, entry: { type: string; kind: "effect" | "filter"; params?: Record<string, number | boolean | string> }): Commit {
  return edit(doc, ctx, { commandType: "effect.add", label: "Add effect" }, (draft) => {
    const ref = elementIn(draft, elementId);
    const element = editable(ref);
    const effects = (Array.isArray(element.effects) ? element.effects : (element.effects = [])) as Json[];
    // Rejected before anything is written: the command fails as a whole with the named limit.
    if (effects.length >= 16) reject("document/limit-exceeded", `${ref.elementPath}/effects`, "an element holds at most 16 effect entries", { limit: "effectsPerElement", value: 16 });
    effects.push({ id: ctx.newId(), type: entry.type, kind: entry.kind, enabled: true, params: { ...defaults(ctx, entry.type), ...entry.params } });
  });
}

/** Removes an entry and every animation path that starts with `effects.<id>.`. */
export function removeEffect(doc: ProjectDocument, ctx: CommitContext, elementId: string, effectId: string): Commit {
  return edit(doc, ctx, { commandType: "effect.remove", label: "Remove effect" }, (draft) => {
    const element = editable(elementIn(draft, elementId));
    element.effects = (element.effects as Json[]).filter((entry) => entry.id !== effectId);
    if (isObject(element.animations)) for (const path of Object.keys(element.animations)) if (path.startsWith(`effects.${effectId}.`)) delete element.animations[path];
  });
}

/** A standalone effect or filter layer: an `effect` element with exactly one entry, applied to everything beneath it. */
export function addEffectLayer(doc: ProjectDocument, ctx: CommitContext, trackId: string, entry: { type: string; kind: "effect" | "filter"; params?: Record<string, number | boolean | string> }, at: { startTime: number; duration: number; name?: string }): Commit {
  return edit(doc, ctx, { commandType: "effect.layer.add", label: "Add effect layer" }, (draft) => {
    const { track } = trackIn(draft, trackId);
    (track.elements as unknown[]).push(createElement("effect", {
      id: ctx.newId(), name: at.name ?? entry.type, startTime: at.startTime, duration: at.duration, target: "beneath",
      effects: [{ id: ctx.newId(), type: entry.type, kind: entry.kind, enabled: true, params: { ...defaults(ctx, entry.type), ...entry.params } }],
    }));
    sortElements(track);
  });
}

/** Adds a mask with the defaults of its type. */
export function addMask(doc: ProjectDocument, ctx: CommitContext, elementId: string, type: MaskType): Commit {
  return edit(doc, ctx, { commandType: "mask.add", label: "Add mask" }, (draft) => {
    const element = editable(elementIn(draft, elementId));
    const masks = (Array.isArray(element.masks) ? element.masks : (element.masks = [])) as unknown[];
    masks.push((MASK_VARIANTS[type] as z.ZodTypeAny).parse({ id: ctx.newId(), type }));
  });
}

/** Attaches a mask to a motion track of its own clip. The binding is resolved live: no keyframe is written. */
export function attachMaskTracking(doc: ProjectDocument, ctx: CommitContext, elementId: string, maskId: string, trackId: string): Commit {
  return edit(doc, ctx, { commandType: "mask.tracking.attach", label: "Track mask" }, (draft) => {
    const mask = (editable(elementIn(draft, elementId)).masks as Json[]).find((entry) => entry.id === maskId)!;
    mask.tracking = { trackId, followPosition: true, followScale: true, followRotation: true, offset: { x: 0, y: 0 } };
  });
}

const CUTOUT_DEFAULTS = { inverted: false, feather: 2, shift: 0, stroke: { style: "none", width: 8, color: "#ffffff", offset: 0, opacity: 100 }, background: { kind: "none" } };
/** "Auto cutout": the settings are stored at once; the matte arrives later by a non-history update. */
export function requestCutout(doc: ProjectDocument, ctx: CommitContext, elementId: string, mode: "auto" | "custom" = "auto"): Commit {
  return edit(doc, ctx, { commandType: "cutout.enable", label: "Cutout" }, (draft) => {
    const element = editable(elementIn(draft, elementId));
    const kept = isObject(element.cutout) ? element.cutout : {};
    // Turning the cutout on again within 30 days reuses the matte that was kept.
    const { disabled_ms: _disabled, ...rest } = kept;
    element.cutout = { ...CUTOUT_DEFAULTS, ...rest, mode };
  });
}
/** The matte job finished: one state patch, no undo step. */
export const cutoutMatteArrived = (doc: ProjectDocument, ctx: CommitContext, elementId: string, matteAssetId: string): Commit =>
  edit(doc, ctx, { commandType: "cutout.matte", label: "Cutout matte", history: false }, (draft) => {
    (editable(elementIn(draft, elementId)).cutout as Json).matteAssetId = matteAssetId;
  });
/** Turning the cutout off keeps the matte and records when, so that it is reused for 30 days. */
export const disableCutout = (doc: ProjectDocument, ctx: CommitContext, elementId: string): Commit =>
  edit(doc, ctx, { commandType: "cutout.disable", label: "Cutout off" }, (draft) => {
    const cutout = editable(elementIn(draft, elementId)).cutout as Json;
    cutout.mode = "none";
    if (cutout.matteAssetId !== undefined) cutout.disabled_ms = ctx.now_ms;
  });

export const CUTOUT_RETENTION_MS = 30 * 86_400_000;
/**
 * On project load and once a day: a cutout turned off more than 30 days ago loses its matte reference, and the matte
 * asset is removed when nothing else references it. A non-history update.
 */
export function expireCutouts(doc: ProjectDocument, ctx: CommitContext): Commit {
  return edit(doc, ctx, { commandType: "cutout.expire", label: "Cutout matte expired", history: false }, (draft) => {
    const dropped = new Set<string>(), used = new Set<string>();
    const elements: Json[] = [];
    for (const scene of draft.scenes) for (const track of [...scene.tracks.overlay, scene.tracks.main, ...scene.tracks.audio]) elements.push(...(track.elements as unknown as Json[]));
    for (const element of elements) {
      const cutout = element.cutout as Json | undefined;
      if (!isObject(cutout)) continue;
      if (typeof cutout.disabled_ms === "number" && ctx.now_ms - cutout.disabled_ms > CUTOUT_RETENTION_MS) {
        dropped.add(String(cutout.matteAssetId));
        delete cutout.matteAssetId;
        delete cutout.disabled_ms;
      } else if (typeof cutout.matteAssetId === "string") used.add(cutout.matteAssetId);
    }
    draft.media.assets = draft.media.assets.filter((asset) => !dropped.has(asset.id) || used.has(asset.id));
  });
}

const RETOUCH = { enabled: true, applyToAll: true, faces: {}, body: {} };
/** Sets one retouch value for all faces (`all`) or one face id; the structure is created with its defaults. */
export function setRetouch(doc: ProjectDocument, ctx: CommitContext, elementId: string, faceKey: string, values: Record<string, number>): Commit {
  return edit(doc, ctx, { commandType: "retouch.set", label: "Retouch" }, (draft) => {
    const element = editable(elementIn(draft, elementId));
    const retouch = (isObject(element.retouch) ? element.retouch : (element.retouch = clone(RETOUCH))) as Json;
    retouch.enabled = true;
    const faces = retouch.faces as Json;
    faces[faceKey] = { ...(faces[faceKey] as Json | undefined), ...values };
  });
}

/** AI movement: replaces exactly the keys the previous run wrote, keeps the user's, and records the new ids. */
export function applyAiMotion(doc: ProjectDocument, ctx: CommitContext, elementId: string, style: string, intensity: number, keys: { path: string; time: number; value: number }[]): Commit {
  return edit(doc, ctx, { commandType: "ai.motion", label: "AI movement" }, (draft) => {
    const ref = elementIn(draft, elementId);
    const element = editable(ref);
    const owner = (isObject(element.aiMotion) ? element.aiMotion : (element.aiMotion = { keyIds: [] })) as Json;
    Object.assign(owner, { style, intensity });
    replaceToolKeys(element, ref.elementPath, owner, keys, ctx.newId);
  });
}
/** Auto reframe: the same replace-only-your-own-keys rule, recording the target aspect. */
export function applyAutoReframe(doc: ProjectDocument, ctx: CommitContext, elementId: string, aspect: Rational, keys: { path: string; time: number; value: number }[]): Commit {
  return edit(doc, ctx, { commandType: "ai.auto-reframe", label: "Auto reframe" }, (draft) => {
    const ref = elementIn(draft, elementId);
    const element = editable(ref);
    const owner = (isObject(element.autoReframe) ? element.autoReframe : (element.autoReframe = { keyIds: [] })) as Json;
    owner.aspect = aspect;
    replaceToolKeys(element, ref.elementPath, owner, keys, ctx.newId);
  });
}

export type FaceBox = { x: number; y: number; width: number; height: number };
const iou = (a: FaceBox, b: FaceBox) => {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x), h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  const inter = w > 0 && h > 0 ? w * h : 0;
  return inter / (a.width * a.height + b.width * b.height - inter);
};
/**
 * Face identities are stable: a rebuilt analysis matches each detected face to the stored face with the greatest
 * bounding-box overlap at `firstSeen` (at least 0.5 intersection-over-union) and reuses its id before creating one.
 * `stored` are the boxes of the asset's existing faces at their `firstSeen`, from the previous analysis.
 */
export function matchFaces(stored: { id: string; box: FaceBox }[], detected: FaceBox[], newId: () => string): { id: string; box: FaceBox; isNew: boolean }[] {
  const free = new Set(stored.map((face) => face.id));
  return detected.map((box) => {
    let best: { id: string; score: number } | undefined;
    for (const face of stored) {
      const score = iou(face.box, box);
      if (free.has(face.id) && score >= 0.5 && (!best || score > best.score)) best = { id: face.id, score };
    }
    if (best) { free.delete(best.id); return { id: best.id, box, isNew: false }; }
    return { id: newId(), box, isNew: true };
  });
}
/** The first face analysis writes the identities; later ones only append. A non-history update. */
export function recordFaces(doc: ProjectDocument, ctx: CommitContext, assetId: string, faces: { id: string; firstSeen: number }[]): Commit {
  return edit(doc, ctx, { commandType: "asset.faces", label: "Faces", history: false }, (draft) => {
    const asset = findAsset(draft, assetId)!;
    for (const face of faces) if (!asset.faces.some((known) => known.id === face.id)) asset.faces.push(face);
  });
}

const BASIC = ["exposure", "brightness", "contrast", "saturation", "vibrance", "highlights", "shadows", "whites", "blacks", "temperature", "tint", "clarity", "vignette", "hue", "sharpness", "fade", "grain"];
/** Sets one basic colour slider; the section is created with every key at 0, and no other section appears. */
export function setBasicAdjustment(doc: ProjectDocument, ctx: CommitContext, elementId: string, key: string, value: number): Commit {
  return edit(doc, ctx, { commandType: "adjustment.basic", label: "Adjust" }, (draft) => {
    const element = editable(elementIn(draft, elementId));
    const adjustments = (isObject(element.adjustments) ? element.adjustments : (element.adjustments = {})) as Json;
    const basic = (isObject(adjustments.basic) ? adjustments.basic : (adjustments.basic = { enabled: true, ...Object.fromEntries(BASIC.map((name) => [name, 0])) })) as Json;
    basic[key] = value;
  });
}

const BANDS = ["low", "lowMid", "mid", "highMid", "high"];
/** Choosing an EQ preset writes that preset's band values. */
export const setEqPreset = (doc: ProjectDocument, ctx: CommitContext, elementId: string, preset: string): Commit =>
  edit(doc, ctx, { commandType: "audio.eq.preset", label: "Equaliser" }, (draft) => {
    editable(elementIn(draft, elementId)).eq = { enabled: true, preset, bands: { ...EQ_PRESET_BANDS[preset] } };
  });
/** Moving a band of a preset turns the preset into `custom` in the same command. */
export const setEqBand = (doc: ProjectDocument, ctx: CommitContext, elementId: string, band: string, value: number): Commit =>
  edit(doc, ctx, { commandType: "audio.eq.band", label: "Equaliser" }, (draft) => {
    const element = editable(elementIn(draft, elementId));
    const eq = (isObject(element.eq) ? element.eq : (element.eq = { enabled: true, preset: "flat", bands: Object.fromEntries(BANDS.map((name) => [name, 0])) })) as Json;
    (eq.bands as Json)[band] = value;
    eq.preset = "custom";
  });

/** Adds a beat at a source time; the list stays strictly increasing. */
export const addBeat = (doc: ProjectDocument, ctx: CommitContext, elementId: string, sourceTime: number): Commit =>
  edit(doc, ctx, { commandType: "audio.beat.add", label: "Add beat" }, (draft) => {
    const element = editable(elementIn(draft, elementId));
    element.beats = [...new Set([...((element.beats as number[] | undefined) ?? []), sourceTime])].sort((a, b) => a - b);
  });
