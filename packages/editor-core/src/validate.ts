import {
  animatablePath, channelShapeOf, ELEMENT_TYPES, ELEMENT_VARIANTS, findUnknownFields, MAX_TICKS, PROJECT_SCHEMA_VERSION, projectDocumentSchema,
  TRACK_ELEMENT_TYPES, type AssetRecord, type ProjectDocument, type Rational, type Scene, type TimelineElement,
} from "@jagentchill/protocol";
import type { z } from "zod";
import { canonicalize, isCanonicalNumber, MAX_DOCUMENT_BYTES, withoutLocal } from "./canonical.ts";
import { documentError, type DocumentError } from "./errors.ts";
import { allElements, allTracks, asArray, findElement, isObject, scenePathOf, tracksIn, type ElementRef, type Json, type TrackRef } from "./model.ts";
import { compareIds, entryId, ID_KEYED_ARRAYS, pointer } from "./patch.ts";
import { EQ_PRESET_BANDS, type Registries } from "./registries.ts";
import { repairDocument, type Repair } from "./repair.ts";
import { utf8 } from "./sha256.ts";
import { frameTicks, isFrameAligned } from "./time.ts";

export type ValidateOptions = {
  /** `strict`: every writer; any error rejects. `load`: repair, then report what could not be repaired. */
  mode?: "strict" | "load";
  registries?: Registries;
  /** The schema this reader implements. */
  readerSchema?: number;
  /** Incremental mode: validate only these elements, their tracks and the references into and out of them. */
  scope?: { elementIds: string[] };
};
export type ValidationResult = {
  ok: boolean;
  /** At most 100 findings of severity `error`. */
  errors: DocumentError[];
  /** References that are allowed to dangle, and content of a newer schema that is kept without being understood. */
  warnings: DocumentError[];
  /** Keys and union members no schema of this build declares; they are preserved unchanged. */
  unknownFields: string[];
  /** The document must not be modified by this build (a newer minimum reader, or an unknown colour pipeline). */
  readOnly: boolean;
  /** `load` mode: the repaired document and what was repaired. The stored record is untouched until the next edit. */
  document?: ProjectDocument;
  repairs?: Repair[];
};

const MAX_ERRORS = 100;
const SOURCELESS = new Set(["text", "caption", "sticker", "graphic", "effect", "adjustment", "image"]);
const LINK_PARTNERS = new Set(["video", "compound", "text"]);
const num = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

type Ctx = {
  doc: ProjectDocument;
  fps: Rational;
  frame: number;
  registries: Registries;
  errors: DocumentError[];
  warnings: DocumentError[];
  assets: Map<string, AssetRecord>;
  scenes: Map<string, Scene>;
  unfilledSlotElements: Set<string>;
  scriptIds: Set<string>;
  editableLimits: Map<string, number>;
  tolerant: boolean;
};
const err = (c: Ctx, code: string, path: string, message: string, details?: Record<string, unknown>) => {
  // An id of an open registry (transition, clip animation, text animation, bubble) that this build does not register is
  // an error for a writer; on a document of a newer schema it is content of a newer app, kept and not rendered.
  if (code === "document/unknown-definition" && c.tolerant && details?.unknownMember !== true) { c.warnings.push(documentError(code, path, `${message} (kept unchanged)`, details)); return; }
  c.errors.push(documentError(code, path, message, details));
};
const warn = (c: Ctx, code: string, path: string, message: string, details?: Record<string, unknown>) => { c.warnings.push(documentError(code, path, message, details)); };
const aligned = (c: Ctx, value: unknown, path: string) => {
  if (num(value) && Number.isInteger(value) && value >= 0 && !isFrameAligned(value, c.fps)) err(c, "document/not-frame-aligned", path, "the time is not on the project frame grid");
};

/** Turns a Zod path (array indices) into an id path: members of id-keyed arrays are written `@<id>`. */
export function idPath(root: unknown, path: readonly (string | number)[]): string {
  let current: unknown = root, out = "", key = "";
  for (const segment of path) {
    if (typeof segment === "number" && Array.isArray(current)) {
      const id = ID_KEYED_ARRAYS.has(key) ? entryId(current[segment]) : undefined;
      out += pointer(id !== undefined ? `@${id}` : segment);
      current = current[segment];
    } else {
      out += pointer(segment);
      current = isObject(current) || Array.isArray(current) ? (current as Json)[segment as string] : undefined;
      key = String(segment);
    }
  }
  return out;
}

type Mapped = { code: string; path: readonly (string | number)[]; message: string; details?: Record<string, unknown>; unknownMember?: boolean };
const MEMBERSHIP = new Set(["invalid_enum_value", "invalid_literal"]);
const MESSAGES: Record<string, string> = {
  "document/invalid-id": "an id is 1–64 characters from A–Z a–z 0–9 _ . : -",
  "document/not-integer-ticks": "a time is a non-negative integer number of ticks",
  "document/invalid-color": "a colour is #rrggbb (or #rrggbbaa where alpha is allowed)",
};
/** The `document/…` code of a Zod issue. A union reports the member that came closest. */
function mapIssue(issue: z.ZodIssue): Mapped {
  const base = { path: issue.path, message: issue.message };
  const coded = /^code:(\S+)/.exec(issue.message);
  if (coded) return { ...base, code: coded[1], message: MESSAGES[coded[1]] ?? issue.message };
  switch (issue.code) {
    case "custom": {
      const params = (issue.params ?? {}) as { code?: string; details?: Record<string, unknown> };
      const limit = /^limit:(.+)$/.exec(issue.message);
      if (limit) return { ...base, code: "document/limit-exceeded", details: params.details ?? { limit: limit[1] } };
      return { ...base, code: params.code ?? "document/wrong-type", details: params.details, unknownMember: params.details?.unknownMember === true };
    }
    case "invalid_type":
      if (issue.received === "undefined") return { ...base, code: "document/missing-field", message: "a required field is absent" };
      if (issue.received === "nan") return { ...base, code: "document/invalid-number" };
      return { ...base, code: "document/wrong-type" };
    case "not_finite": return { ...base, code: "document/invalid-number" };
    case "too_small": return { ...base, code: "document/out-of-range", details: { min: Number(issue.minimum) } };
    case "too_big": {
      const limit = /^limit:(.+)$/.exec(issue.message);
      if (limit) return { ...base, code: "document/limit-exceeded", message: `at most ${issue.maximum} entries`, details: { limit: limit[1], value: Number(issue.maximum) } };
      return { ...base, code: "document/out-of-range", details: { max: Number(issue.maximum) } };
    }
    case "invalid_union": {
      const members = issue.unionErrors.map((error) => error.issues.map(mapIssue));
      // The member that got furthest: one whose findings are not all "wrong JSON type".
      const closest = members.find((found) => found.length > 0 && found.every((entry) => entry.code !== "document/wrong-type" && entry.code !== "document/missing-field"));
      if (closest) return closest[0];
      const allMembership = issue.unionErrors.every((error) => error.issues.every((entry) => MEMBERSHIP.has(entry.code)));
      return { ...base, code: "document/wrong-type", unknownMember: allMembership };
    }
    default:
      return { ...base, code: "document/wrong-type", unknownMember: MEMBERSHIP.has(issue.code) };
  }
}

/** Depth and number validity of the whole tree, including keys no schema declares. */
function scanTree(c: Ctx, value: unknown, path: (string | number)[], depth: number, state: { deep: boolean }): void {
  if (typeof value === "number") {
    if (!isCanonicalNumber(value)) err(c, "document/invalid-number", idPath(c.doc, path), "a number is NaN, infinite, negative zero or beyond ±(2^53 − 1)");
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (depth > 32) {
    if (!state.deep) err(c, "document/limit-exceeded", idPath(c.doc, path), "JSON nesting is at most 32 levels", { limit: "jsonDepth", value: 32 });
    state.deep = true;
    return;
  }
  if (Array.isArray(value)) value.forEach((entry, index) => { path.push(index); scanTree(c, entry, path, depth + 1, state); path.pop(); });
  else for (const key of Object.keys(value)) { path.push(key); scanTree(c, (value as Json)[key], path, depth + 1, state); path.pop(); }
}

function reportIssues(c: Ctx, issues: z.ZodIssue[], root: unknown, prefix: string): void {
  for (const issue of issues) {
    const mapped = mapIssue(issue);
    if (prefix === "" && ["format", "schemaVersion", "minReaderSchemaVersion"].includes(String(mapped.path[0])) && mapped.path.length === 1) continue;
    const path = prefix + idPath(root, mapped.path);
    if (mapped.code === "document/invalid-number" && c.errors.some((error) => error.code === mapped.code && error.path === path)) continue;
    // A document written by a newer schema may hold union members this build does not know: they are kept, not judged.
    if (c.tolerant && mapped.unknownMember) warn(c, mapped.code, path, `${mapped.message} (kept unchanged)`, { ...mapped.details, unknownMember: true });
    else err(c, mapped.code, path, mapped.message, mapped.details);
  }
}

function checkEnvelope(c: Ctx, doc: Json, readerSchema: number): boolean {
  if (doc.format !== "jagentchill.project") err(c, "document/unknown-format", "/format", "format is not \"jagentchill.project\"");
  const schemaVersion = doc.schemaVersion, minReader = doc.minReaderSchemaVersion;
  if (schemaVersion === undefined) err(c, "document/missing-field", "/schemaVersion", "a required field is absent");
  else if (!Number.isInteger(schemaVersion)) err(c, "document/wrong-type", "/schemaVersion", "schemaVersion is an integer");
  else if ((schemaVersion as number) < 32) err(c, "document/schema-too-old", "/schemaVersion", "the document needs migration before it is validated");
  if (minReader === undefined) err(c, "document/missing-field", "/minReaderSchemaVersion", "a required field is absent");
  else if (!Number.isInteger(minReader) || (minReader as number) < 32 || (Number.isInteger(schemaVersion) && (minReader as number) > (schemaVersion as number))) {
    err(c, "document/invalid-min-reader", "/minReaderSchemaVersion", "minReaderSchemaVersion lies in 32 … schemaVersion");
  } else if ((minReader as number) > readerSchema) {
    err(c, "document/schema-too-new", "/minReaderSchemaVersion", "the document needs a newer app");
    return false;
  }
  return true;
}

function resolveAsset(c: Ctx, id: unknown, path: string, expect: (asset: AssetRecord) => boolean, what: string, dangling: "error" | "warning" = "error"): AssetRecord | undefined {
  if (typeof id !== "string") return undefined;
  const asset = c.assets.get(id);
  if (!asset) { (dangling === "error" ? err : warn)(c, "document/unknown-asset", path, `asset "${id}" does not exist`); return undefined; }
  if (!expect(asset)) err(c, "document/asset-type-mismatch", path, `asset "${id}" is not ${what}`);
  return asset;
}
const isDerived = (role: string) => (asset: AssetRecord) => asset.kind === "derived" && asset.derived?.role === role;

function checkBackground(c: Ctx, background: unknown, path: string): void {
  if (isObject(background) && background.kind === "image") resolveAsset(c, background.mediaId, path, (asset) => asset.type === "image", "an image", "warning");
}

function checkKeys(c: Ctx, keys: unknown[], path: string, duration: number, range: { min: number; max: number } | undefined, scalePath: boolean, keyIds: Map<string, string>, shared: boolean): void {
  let previous = -1;
  keys.forEach((entry, index) => {
    const key = entry as { id?: string; time?: number; value?: unknown; leftHandle?: { dt: number }; rightHandle?: { dt: number } };
    const at = `${path}/keys${pointer(`@${String(key.id)}`)}`;
    if (typeof key.id === "string" && !shared) {
      if (keyIds.has(key.id)) err(c, "document/duplicate-id", at, `keyframe id "${key.id}" is used twice in the element`, { paths: [keyIds.get(key.id), at] });
      else keyIds.set(key.id, at);
    }
    if (!num(key.time)) return;
    if (key.time <= previous) err(c, "document/animation-channel-invalid", at, "keys are sorted by time with one key per tick");
    if (key.time > duration) err(c, "document/animation-channel-invalid", at, "a key lies outside [0, duration]");
    aligned(c, key.time, `${at}/time`);
    if (range && num(key.value) && (key.value < range.min || key.value > range.max) && !(scalePath && key.value >= -100 && key.value <= -0.01)) {
      err(c, "document/out-of-range", `${at}/value`, `expected ${range.min}…${range.max}`, range);
    }
    const before = keys[index - 1] as { time?: number } | undefined, after = keys[index + 1] as { time?: number } | undefined;
    if (key.leftHandle && before && num(before.time) && key.time + key.leftHandle.dt < before.time) err(c, "document/animation-channel-invalid", `${at}/leftHandle`, "a handle never extends past the neighbouring key");
    if (key.rightHandle && after && num(after.time) && key.time + key.rightHandle.dt > after.time) err(c, "document/animation-channel-invalid", `${at}/rightHandle`, "a handle never extends past the neighbouring key");
    previous = key.time;
  });
}

function checkAnimations(c: Ctx, element: Json, p: string): void {
  if (!isObject(element.animations)) return;
  const keyIds = new Map<string, string>();
  const duration = num(element.duration) ? element.duration : 0;
  for (const [path, channel] of Object.entries(element.animations)) {
    const at = `${p}/animations${pointer(path)}`;
    const target = animatablePath(element as never, path);
    if (!target) { err(c, "document/animation-path-invalid", at, `"${path}" is not an animatable path of this element`); continue; }
    const actual = channelShapeOf(channel);
    let expected = target.shape;
    if (expected === null) {
      // An effect parameter: the definition decides; without one the stored shape is taken as it is.
      const entry = asArray(element.effects).find((effect) => isObject(effect) && effect.id === target.entry!.id) as Json | undefined;
      const definition = c.registries.effects?.[String(entry?.type)]?.params[target.entry!.key];
      if (definition) {
        if (definition.keyframable === false) { err(c, "document/animation-path-invalid", at, `"${target.entry!.key}" is not keyframable`); continue; }
        expected = definition.type === "number" ? "scalar" : definition.type === "color" ? "color" : "discrete";
        if (definition.type === "number" && definition.min !== undefined && definition.max !== undefined) target.range = { min: definition.min, max: definition.max };
      } else if (c.registries.effects?.[String(entry?.type)]) { err(c, "document/animation-path-invalid", at, `the effect has no parameter "${target.entry!.key}"`); continue; }
      else expected = actual === "path" ? "scalar" : actual;
    }
    if (actual !== expected || !isObject(channel)) { err(c, "document/animation-channel-invalid", at, `the channel is not a ${expected} channel`); continue; }
    const scalePath = path === "transform.scale.x" || path === "transform.scale.y";
    if (actual === "color") {
      const parts = ["r", "g", "b", "a"].map((name) => asArray((channel[name] as Json | undefined)?.keys) as { id?: string; time?: number }[]);
      const signature = (keys: { id?: string; time?: number }[]) => keys.map((key) => `${key.id}@${key.time}`).join(",");
      if (parts.some((keys) => keys.length === 0 || signature(keys) !== signature(parts[0]))) err(c, "document/animation-channel-invalid", at, "the four colour components have identical key ids and times");
      parts.forEach((keys, index) => checkKeys(c, keys, `${at}/${"rgba"[index]}`, duration, { min: 0, max: 1 }, false, keyIds, index > 0));
    } else {
      const keys = asArray(channel.keys);
      checkKeys(c, keys, at, duration, actual === "scalar" ? target.range : undefined, scalePath, keyIds, false);
      if (actual === "path") {
        const mask = asArray(element.masks).find((entry) => isObject(entry) && entry.id === target.entry!.id) as Json | undefined;
        const ids = asArray((mask?.params as Json | undefined)?.path).map((point) => (point as Json).id).sort().join(",");
        for (const key of keys as Json[]) {
          const points = asArray((key.value as Json | undefined)?.points).map((point) => (point as Json).id).sort().join(",");
          if (points !== ids) err(c, "document/animation-channel-invalid", `${at}/keys${pointer(`@${String(key.id)}`)}`, "a path key lists exactly the point ids of the mask's path");
        }
      }
    }
  }
}

function checkEffects(c: Ctx, element: Json, p: string): void {
  const effects = asArray(element.effects);
  if (effects.length > 16) err(c, "document/effects-limit", `${p}/effects`, "an element holds at most 16 effect entries", { limit: "effectsPerElement", value: 16 });
  for (const entry of effects as Json[]) {
    if (!isObject(entry)) continue;
    const at = `${p}/effects${pointer(`@${String(entry.id)}`)}`;
    const definition = c.registries.effects?.[String(entry.type)];
    // An entry of a type this build does not register is kept and rendered as pass-through.
    if (c.registries.effects && !definition) { warn(c, "document/unknown-definition", `${at}/type`, `effect "${String(entry.type)}" is not registered`); continue; }
    if (!definition || !isObject(entry.params)) continue;
    for (const key of Object.keys(definition.params)) if (entry.params[key] === undefined) err(c, "document/missing-field", `${at}/params${pointer(key)}`, "a required field is absent");
  }
}

function checkMasks(c: Ctx, element: Json, p: string, asset: AssetRecord | undefined): void {
  const masks = asArray(element.masks);
  if (masks.length > 8) err(c, "document/masks-limit", `${p}/masks`, "an element holds at most 8 masks", { limit: "masksPerElement", value: 8 });
  for (const mask of masks as Json[]) {
    if (!isObject(mask)) continue;
    const at = `${p}/masks${pointer(`@${String(mask.id)}`)}`;
    const points = asArray((mask.params as Json | undefined)?.path) as Json[];
    if (points.length > 256) err(c, "document/masks-limit", `${at}/params/path`, "a freeform path holds at most 256 points", { limit: "pointsPerPath", value: 256 });
    const seen = new Set<unknown>();
    for (const point of points) {
      if (seen.has(point.id)) err(c, "document/duplicate-id", `${at}/params/path${pointer(`@${String(point.id)}`)}`, "point ids are unique within the mask");
      seen.add(point.id);
    }
    const tracking = mask.tracking as Json | undefined;
    if (isObject(tracking) && !asset?.motionTracks?.some((track) => track.id === tracking.trackId)) err(c, "document/unknown-reference", `${at}/tracking/trackId`, "the motion track does not exist on the element's asset");
  }
}

function checkSlots(c: Ctx, value: Json, p: string, duration: number): void {
  const clip = value.clipAnimation as Json | undefined;
  if (isObject(clip)) {
    const total = ["in", "out"].reduce((sum, key) => sum + (num((clip[key] as Json | undefined)?.duration) ? ((clip[key] as Json).duration as number) : 0), 0);
    for (const key of ["in", "out", "combo"]) {
      const slot = clip[key] as Json | undefined;
      if (!isObject(slot)) continue;
      const length = num(slot.duration) ? slot.duration : 60_000;
      aligned(c, length, `${p}/clipAnimation/${key}/duration`);
      const max = key === "combo" ? duration : Math.min(600_000, duration);
      if (length < Math.min(12_000, duration) || length > max) err(c, "document/out-of-range", `${p}/clipAnimation/${key}/duration`, "the animation duration is outside its range");
      if (c.registries.clipAnimations && !c.registries.clipAnimations.includes(String(slot.type))) err(c, "document/unknown-definition", `${p}/clipAnimation/${key}/type`, `clip animation "${String(slot.type)}" is not registered`);
    }
    if (total > duration) err(c, "document/out-of-range", `${p}/clipAnimation/out/duration`, "in + out is at most the element duration");
  }
}
function checkTextStyle(c: Ctx, style: Json, p: string, duration: number): void {
  const animation = style.textAnimation as Json | undefined;
  if (isObject(animation)) {
    let total = 0;
    for (const key of ["in", "out", "loop"]) {
      const slot = animation[key] as Json | undefined;
      if (!isObject(slot)) continue;
      if (key !== "loop" && num(slot.duration)) {
        total += slot.duration;
        aligned(c, slot.duration, `${p}/textAnimation/${key}/duration`);
        if (slot.duration < Math.min(12_000, duration) || slot.duration > duration) err(c, "document/out-of-range", `${p}/textAnimation/${key}/duration`, "the animation duration is outside its range");
      }
      if (c.registries.textAnimations && !c.registries.textAnimations.includes(String(slot.id))) err(c, "document/unknown-definition", `${p}/textAnimation/${key}/id`, `text animation "${String(slot.id)}" is not registered`);
    }
    if (total > duration) err(c, "document/out-of-range", `${p}/textAnimation/out/duration`, "in + out is at most the element duration");
  }
  const bubble = style.bubble as Json | undefined;
  if (isObject(bubble) && c.registries.bubbles && !c.registries.bubbles.includes(String(bubble.id))) err(c, "document/unknown-definition", `${p}/bubble/id`, `bubble "${String(bubble.id)}" is not registered`);
}

function checkAudio(c: Ctx, value: Json, p: string, duration: number): void {
  const fadeIn = (value.fadeIn as Json | undefined)?.duration, fadeOut = (value.fadeOut as Json | undefined)?.duration;
  const head = num(fadeIn) ? fadeIn : 0, tail = num(fadeOut) ? fadeOut : 0;
  aligned(c, head, `${p}/fadeIn/duration`);
  aligned(c, tail, `${p}/fadeOut/duration`);
  if (head + tail > duration) err(c, "document/out-of-range", `${p}/fadeOut/duration`, "fadeIn + fadeOut is at most the element duration");
  const beats = asArray(value.beats) as number[];
  for (let index = 1; index < beats.length; index++) {
    if (!(beats[index] > beats[index - 1])) { err(c, "document/elements-unsorted", `${p}/beats`, "beats are strictly increasing"); break; }
  }
  const eq = value.eq as Json | undefined;
  if (isObject(eq) && typeof eq.preset === "string" && eq.preset !== "custom" && EQ_PRESET_BANDS[eq.preset]) {
    const bands = (eq.bands ?? {}) as Json, expected = EQ_PRESET_BANDS[eq.preset] as Record<string, number>;
    if (Object.keys(expected).some((band) => (bands[band] ?? 0) !== expected[band])) err(c, "document/out-of-range", `${p}/eq/bands`, `preset "${eq.preset}" carries its own band values; edited bands are "custom"`);
  }
  const stems = value.vocalIsolation as Json | undefined;
  if (isObject(stems)) {
    resolveAsset(c, stems.vocalsAssetId, `${p}/vocalIsolation/vocalsAssetId`, isDerived("stem-vocals"), "a vocals stem");
    resolveAsset(c, stems.accompanimentAssetId, `${p}/vocalIsolation/accompanimentAssetId`, isDerived("stem-accompaniment"), "an accompaniment stem");
  }
}

function checkElement(c: Ctx, ref: ElementRef): void {
  const element = ref.element as unknown as Json, p = ref.elementPath, type = String(element.type);
  const accepted = TRACK_ELEMENT_TYPES[ref.track.type as keyof typeof TRACK_ELEMENT_TYPES];
  if (accepted && (ELEMENT_TYPES as readonly string[]).includes(type) && !accepted.includes(type)) err(c, "document/element-track-mismatch", p, `a ${type} element does not live on a ${ref.track.type} track`);
  if (!(ELEMENT_TYPES as readonly string[]).includes(type)) return;
  const start = element.startTime, duration = element.duration;
  if (!num(start) || !num(duration)) return;
  aligned(c, start, `${p}/startTime`);
  aligned(c, duration, `${p}/duration`);
  if (duration >= 1 && duration < c.frame) err(c, "document/out-of-range", `${p}/duration`, "an element lasts at least one frame", { min: c.frame });
  if (start + duration > MAX_TICKS) err(c, "document/time-out-of-bounds", p, "an element ends within 24 h");
  const trimStart = num(element.trimStart) ? element.trimStart : 0, trimEnd = num(element.trimEnd) ? element.trimEnd : 0;
  const frozen = isObject(element.freeze);
  if (SOURCELESS.has(type) || frozen) {
    if (trimStart !== 0 || trimEnd !== 0) err(c, "document/out-of-range", `${p}/trimStart`, "an element without a source has no trim");
  } else if (num(element.sourceDuration) && trimStart + trimEnd > element.sourceDuration) err(c, "document/time-out-of-bounds", p, "trimStart + trimEnd exceeds the source");

  // The classic spelling is not a way to give the rotation: with `rotate` and no `rotation` the stored key is missing.
  if (isObject(element.transform) && "rotate" in element.transform && !("rotation" in element.transform)) err(c, "document/missing-field", `${p}/transform/rotation`, "a required field is absent");

  let asset: AssetRecord | undefined;
  if (type === "video" || type === "image" || type === "audio") {
    if (element.mediaId === undefined) {
      if (type !== "audio" && !c.unfilledSlotElements.has(String(element.id))) err(c, "document/missing-field", `${p}/mediaId`, "a required field is absent");
    } else asset = resolveAsset(c, element.mediaId, `${p}/mediaId`, (found) => (type === "audio" ? found.type !== "image" : found.type === type), type === "audio" ? "an audio or video asset" : `a ${type} asset`);
  }
  if (frozen) {
    const freeze = element.freeze as Json;
    if (type === "video" && freeze.mediaId !== undefined && freeze.mediaId !== element.mediaId) err(c, "document/unknown-reference", `${p}/freeze/mediaId`, "freeze.mediaId equals the element's mediaId");
    if (asset && num(asset.duration) && num(freeze.sourceTime) && freeze.sourceTime >= asset.duration) err(c, "document/time-out-of-bounds", `${p}/freeze/sourceTime`, "the held frame lies inside the asset");
  }
  checkBackground(c, type === "text" ? undefined : element.background, `${p}/background`);
  const cutout = element.cutout as Json | undefined;
  if (isObject(cutout)) {
    resolveAsset(c, cutout.matteAssetId, `${p}/cutout/matteAssetId`, isDerived("matte"), "a matte");
    const behind = cutout.background as Json | undefined;
    if (isObject(behind) && behind.kind === "media") resolveAsset(c, behind.mediaId, `${p}/cutout/background/mediaId`, (found) => found.type !== "audio", "an image or video", "warning");
  }
  const processed = element.processedSource as Json | undefined;
  if (isObject(processed)) resolveAsset(c, processed.originalMediaId, `${p}/processedSource/originalMediaId`, () => true, "");
  if (type === "sticker" && typeof element.stickerId === "string") {
    const hash = /^(?:user|generated):(.+)$/.exec(element.stickerId)?.[1];
    if (hash && ![...c.assets.values()].some((found) => found.contentHash === hash)) warn(c, "document/unknown-asset", `${p}/stickerId`, "the sticker's bytes are not in the project");
  }
  const lutId = ((element.adjustments as Json | undefined)?.lut as Json | undefined)?.lutId;
  if (typeof lutId === "string" && lutId.startsWith("user:") && !asArray(c.doc.media?.luts).some((lut) => (lut as Json).id === lutId)) warn(c, "document/unknown-reference", `${p}/adjustments/lut/lutId`, "the LUT record is missing");
  const curves = (element.adjustments as Json | undefined)?.curves as Json | undefined;
  if (isObject(curves)) {
    for (const [name, points] of Object.entries(curves)) {
      if (Array.isArray(points) && points.some((point, index) => index > 0 && !((point as Json).x as number > ((points[index - 1] as Json).x as number)))) err(c, "document/out-of-range", `${p}/adjustments/curves/${name}`, "curve points have strictly increasing x");
    }
  }
  const faces = (element.retouch as Json | undefined)?.faces as Json | undefined;
  if (isObject(faces)) {
    for (const key of Object.keys(faces)) if (key !== "all" && !asset?.faces?.some((face) => face.id === key)) warn(c, "document/unknown-reference", `${p}/retouch/faces${pointer(key)}`, "the asset lists no such face; the settings are kept and not applied");
  }
  const script = element.scriptLink as Json | undefined;
  if (isObject(script) && !c.scriptIds.has(String(script.scriptId))) err(c, "document/unknown-reference", `${p}/scriptLink`, "scriptLinks holds the scriptId of every element scriptLink");
  const points = ((element.retime as Json | undefined)?.curve as Json | undefined)?.points;
  if (Array.isArray(points) && points.length >= 2) {
    const us = points.map((point) => (point as Json).u as number);
    if (us[0] !== 0 || us[us.length - 1] !== 1 || us.some((u, index) => index > 0 && !(u > us[index - 1]))) err(c, "document/out-of-range", `${p}/retime/curve/points`, "u increases strictly from exactly 0 to exactly 1");
  }
  checkEffects(c, element, p);
  checkMasks(c, element, p, asset);
  checkSlots(c, element, p, duration);
  if (type === "text") {
    checkTextStyle(c, element, p, duration);
    const limit = c.editableLimits.get(String(element.id));
    if (limit !== undefined && typeof element.content === "string" && [...element.content].length > limit) err(c, "document/out-of-range", `${p}/content`, `the text holds at most ${limit} characters`, { max: limit });
  }
  if (type === "audio" || type === "video" || type === "compound") checkAudio(c, element, p, duration);
  if (type === "caption") {
    let previous = 0;
    for (const word of asArray(element.words) as Json[]) {
      if (!num(word.start) || !num(word.end) || word.start < previous || word.end < word.start || word.end > duration) {
        err(c, "document/caption-overlap", `${p}/words`, "words are ordered, do not overlap and lie inside the caption");
        break;
      }
      previous = word.end;
    }
    if (isObject(element.style)) checkTextStyle(c, element.style, `${p}/style`, duration);
  }
  if (type === "graphic") {
    const seen = new Set<unknown>();
    for (const stroke of asArray(element.strokes) as Json[]) {
      if (seen.has(stroke.id)) err(c, "document/duplicate-id", `${p}/strokes${pointer(`@${String(stroke.id)}`)}`, "stroke ids are unique within the element");
      seen.add(stroke.id);
    }
  }
  checkAnimations(c, element, p);
}

function checkTrack(c: Ctx, ref: TrackRef, sceneElements: SceneIndex, scope: Set<string> | null): void {
  const track = ref.track as unknown as Json, caption = track.type === "caption";
  if (caption && ref.zone !== "overlay") err(c, "document/track-zone-mismatch", ref.path, "a caption track lives in the overlay zone");
  if (isObject(track.caption) && isObject(track.caption.style)) checkTextStyle(c, track.caption.style, `${ref.path}/caption/style`, MAX_TICKS);
  const elements = asArray(track.elements) as unknown as TimelineElement[];
  const inScope = (element: { id?: unknown } | undefined) => !scope || (element !== undefined && scope.has(String(element.id)));
  let unsorted = false;
  for (let index = 1; index < elements.length; index++) {
    const before = elements[index - 1], after = elements[index];
    if (!isObject(before) || !isObject(after)) continue;
    // Incremental: only the pairs a touched element is part of can have changed.
    if (scope && !inScope(before) && !inScope(after)) continue;
    if (!num(before.startTime) || !num(after.startTime) || !num(before.duration)) continue;
    const order = before.startTime - after.startTime || compareIds(String(before.id), String(after.id));
    if (order > 0 && !unsorted) { err(c, "document/elements-unsorted", `${ref.path}/elements`, "elements are sorted by startTime, then id"); unsorted = true; }
    const overlap = order > 0 ? after.startTime + after.duration > before.startTime : before.startTime + before.duration > after.startTime;
    if (overlap) {
      err(c, caption ? "document/caption-overlap" : "document/elements-overlap", `${ref.path}/elements${pointer(`@${String(after.id)}`)}`,
        `"${String(after.id)}" overlaps "${String(before.id)}"`, { elementIds: [before.id, after.id] });
    }
  }
  const records = asArray(track.transitions).filter(isObject) as Json[];
  const byId = new Map<string, Json>();
  if (records.length) for (const element of elements) if (isObject(element)) byId.set(String(element.id), element as unknown as Json);
  const cuts = new Set<string>();
  for (const record of records) {
    const at = `${ref.path}/transitions${pointer(`@${String(record.id)}`)}`;
    const wanted = track.type === "audio" ? "crossfade" : track.type === "video" ? "transition" : "";
    if (record.kind !== wanted) err(c, "document/field-not-allowed", `${at}/kind`, "a transition lives on a video track and a crossfade on an audio track");
    const from = byId.get(String(record.fromElementId)), to = byId.get(String(record.toElementId));
    if (!from || !to || from.transitionOut !== record.id || to.transitionIn !== record.id) {
      err(c, "document/transition-ref-mismatch", at, "the record and the transitionOut / transitionIn of its two elements mirror each other");
      continue;
    }
    if ((from.startTime as number) + (from.duration as number) !== to.startTime) err(c, "document/transition-not-adjacent", at, "the two elements are exactly adjacent");
    const cut = `${String(from.id)}>${String(to.id)}`;
    if (cuts.has(cut)) err(c, "document/transition-ref-mismatch", at, "a cut holds at most one record");
    cuts.add(cut);
    const duration = num(record.duration) ? record.duration : 60_000;
    aligned(c, duration, `${at}/duration`);
    const [min, max] = record.kind === "crossfade" ? [6000, 1_200_000] : [12_000, 600_000];
    if (duration < Math.max(min, 2 * c.frame) || duration > max) err(c, "document/out-of-range", `${at}/duration`, "the duration is outside its range (at least 2 frames)");
    if (record.kind === "transition" && c.registries.transitions && !c.registries.transitions[String(record.type)]) err(c, "document/unknown-definition", `${at}/type`, `transition "${String(record.type)}" is not registered`);
    // The end of an element under a crossfade (or a transition's paired crossfade) carries no fade of its own.
    if (record.kind === "crossfade" || record.audioCrossfade !== false) {
      if (((from.fadeOut as Json | undefined)?.duration ?? 0) !== 0) err(c, "document/out-of-range", `${ref.path}/elements${pointer(`@${String(from.id)}`)}/fadeOut/duration`, "the end under a crossfade has no fade");
      if (((to.fadeIn as Json | undefined)?.duration ?? 0) !== 0) err(c, "document/out-of-range", `${ref.path}/elements${pointer(`@${String(to.id)}`)}/fadeIn/duration`, "the end under a crossfade has no fade");
    }
  }
  const recordIds = new Map(records.map((record) => [record.id, record]));
  for (const element of elements as unknown as Json[]) {
    if (!isObject(element)) continue;
    const tracked = isObject(element.tracking) && (inScope(element) || (scope !== null && scope.has(String(element.tracking.targetElementId))));
    if (scope && !tracked && !inScope(element)) continue;
    for (const [key, side] of [["transitionIn", "toElementId"], ["transitionOut", "fromElementId"]] as const) {
      const id = element[key];
      if (id === null || id === undefined) continue;
      if (recordIds.get(id)?.[side] !== element.id) err(c, "document/transition-ref-mismatch", `${ref.path}/elements${pointer(`@${String(element.id)}`)}/${key}`, `no transition record "${String(id)}" names this element`);
    }
    const tracking = element.tracking as Json | undefined;
    if (isObject(tracking)) {
      const at = `${ref.path}/elements${pointer(`@${String(element.id)}`)}/tracking`;
      const target = sceneElements.get(String(tracking.targetElementId));
      if (!target || target.element.type !== "video") err(c, "document/unknown-reference", `${at}/targetElementId`, "the target is a video element of the same scene");
      else if (!c.assets.get(String((target.element as { mediaId?: string }).mediaId))?.motionTracks?.some((entry) => entry.id === tracking.trackId)) err(c, "document/unknown-reference", `${at}/trackId`, "the motion track does not exist on the target's asset");
    }
  }
}

function checkScene(c: Ctx, scene: Scene, scope: Set<string> | null): void {
  const s = scene as unknown as Json, p = scenePathOf(scene);
  if (!isObject(s.tracks) || !isObject(s.tracks.main)) err(c, "document/main-track-invalid", `${p}/tracks/main`, "a scene has a main track of type video");
  aligned(c, s.inPoint, `${p}/inPoint`);
  aligned(c, s.outPoint, `${p}/outPoint`);
  if (num(s.inPoint) && num(s.outPoint) && s.inPoint >= s.outPoint) err(c, "document/out-of-range", `${p}/outPoint`, "inPoint lies before outPoint");
  let previous = -1, count = 0;
  for (const marker of asArray(s.markers) as Json[]) {
    if (!isObject(marker) || !num(marker.time)) continue;
    const at = `${p}/markers${pointer(`@${String(marker.id)}`)}`;
    aligned(c, marker.time, `${at}/time`);
    aligned(c, marker.duration, `${at}/duration`);
    if (marker.time <= previous) err(c, "document/elements-unsorted", at, "markers are sorted by time with at most one per frame");
    previous = Math.max(previous, marker.time);
  }
  const refs = [...tracksIn(scene, p)];
  for (const ref of refs) count += asArray((ref.track as { elements?: unknown }).elements).length;
  if (count > 20_000) err(c, "document/limit-exceeded", p, "a scene holds at most 20 000 elements", { limit: "elementsPerScene", value: 20_000 });
  const index = sceneIndex(scene, refs);
  for (const ref of refs) {
    const elements = asArray((ref.track as { elements?: unknown }).elements);
    const touched = !scope || elements.some((element) => isObject(element) && scope.has(element.id as string));
    // A follower's tracking binding points into a touched element, so graphic and text tracks are looked at as well.
    if (touched || ref.track.type === "text" || ref.track.type === "graphic") checkTrack(c, ref, index, scope);
    if (!touched) continue;
    for (let at = 0; at < elements.length; at++) {
      const element = elements[at];
      if (isObject(element) && (!scope || scope.has(String(element.id)))) checkElement(c, elementRef(scene, ref, element, at));
    }
  }
  checkGroups(c, scene, refs, index);
  checkMulticam(c, scene, p, refs);
}

const elementRef = (scene: Scene, ref: TrackRef, element: Json, index: number): ElementRef => ({
  scene, track: ref.track, zone: ref.zone, path: ref.path, element: element as never, index,
  // The id path is built on demand: most elements never need one.
  get elementPath() { return `${ref.path}/elements${pointer(`@${String(element.id)}`)}`; },
});
/** Elements of a scene by id; the map is built only when something asks. */
type SceneIndex = { get(id: string): ElementRef | undefined };
function sceneIndex(scene: Scene, refs: TrackRef[]): SceneIndex {
  let map: Map<string, ElementRef> | undefined;
  return {
    get(id) {
      if (!map) {
        map = new Map();
        for (const ref of refs) asArray((ref.track as { elements?: unknown }).elements).forEach((element, index) => { if (isObject(element)) map!.set(String(element.id), elementRef(scene, ref, element, index)); });
      }
      return map.get(id);
    },
  };
}

function checkGroups(c: Ctx, scene: Scene, refs: TrackRef[], index: SceneIndex): void {
  // Counted on the raw elements; a path is resolved only for a group or link that is wrong.
  const groups = new Map<string, { first: string; count: number }>(), links = new Map<string, { first: string; count: number; audio: number; partners: number }>();
  for (const ref of refs) {
    for (const element of asArray((ref.track as { elements?: unknown }).elements) as Json[]) {
      if (!isObject(element)) continue;
      const { groupId, linkId } = element;
      if (typeof groupId === "string") { const entry = groups.get(groupId); if (entry) entry.count++; else groups.set(groupId, { first: String(element.id), count: 1 }); }
      if (typeof linkId === "string") {
        const entry = links.get(linkId) ?? { first: String(element.id), count: 0, audio: 0, partners: 0 };
        entry.count++;
        if (element.type === "audio") entry.audio++;
        if (LINK_PARTNERS.has(String(element.type))) entry.partners++;
        links.set(linkId, entry);
      }
    }
  }
  for (const [id, entry] of groups) if (entry.count < 2) err(c, "document/group-invalid", `${index.get(entry.first)!.elementPath}/groupId`, `group "${id}" is shared by at least 2 elements of one scene`, { sceneId: scene.id });
  for (const [id, entry] of links) {
    if (entry.count !== 2 || entry.audio !== 1 || entry.partners !== 1) err(c, "document/link-invalid", `${index.get(entry.first)!.elementPath}/linkId`, `link "${id}" joins exactly one audio element and one video, compound or text element of one scene`);
  }
}

function checkMulticam(c: Ctx, scene: Scene, p: string, refs: TrackRef[]): void {
  const s = scene as unknown as Json, multicam = s.multicam as Json | undefined;
  if ((s.kind === "multicam") !== isObject(multicam)) { err(c, "document/multicam-invalid", `${p}/multicam`, "a multicam scene, and only a multicam scene, carries the multicam definition"); return; }
  if (!isObject(multicam)) return;
  const angles = asArray(multicam.angles).filter(isObject) as Json[];
  const used = new Set<unknown>();
  angles.forEach((angle) => {
    const track = refs.find((ref) => ref.zone === "overlay" && ref.track.id === angle.trackId);
    if (!track || track.track.type !== "video" || used.has(angle.trackId)) err(c, "document/multicam-invalid", `${p}/multicam/angles${pointer(`@${String(angle.id)}`)}/trackId`, "each angle names a distinct video track of the scene");
    used.add(angle.trackId);
  });
  if (multicam.audioAngleId !== undefined && !angles.some((angle) => angle.id === multicam.audioAngleId)) err(c, "document/multicam-invalid", `${p}/multicam/audioAngleId`, "the audio angle is one of the angles");
  for (const ref of refs) {
    const count = asArray((ref.track as { elements?: unknown }).elements).length;
    if (ref.zone === "main" && count > 0) err(c, "document/multicam-invalid", ref.path, "a multicam scene holds no element on its main track");
    if (ref.zone === "audio" && count > 0) err(c, "document/multicam-invalid", ref.path, "the audio tracks of a multicam scene are empty");
    if (ref.zone === "overlay" && !used.has(ref.track.id)) err(c, "document/multicam-invalid", ref.path, "a multicam scene has no overlay track other than the angle tracks");
  }
}

function checkCompounds(c: Ctx): void {
  const edges = new Map<string, Set<string>>();
  let any = false;
  eachRawElement(c.doc as unknown as Json, (element) => { if (element.type === "compound") any = true; });
  if (!any) return;
  for (const ref of allElements(c.doc)) {
    const element = ref.element as unknown as Json;
    if (element.type !== "compound") continue;
    const target = c.scenes.get(String(element.sceneId)) as unknown as Json | undefined;
    const p = ref.elementPath;
    if (!target) { err(c, "document/unknown-scene", `${p}/sceneId`, `scene "${String(element.sceneId)}" does not exist`); continue; }
    if (target.isMain === true || target.id === ref.scene.id) err(c, "document/compound-cycle", `${p}/sceneId`, "a compound element never reaches its own scene or the main scene");
    else if (target.kind !== "compound" && target.kind !== "multicam") err(c, "document/unknown-scene", `${p}/sceneId`, "a compound element references a compound or multicam scene");
    const angleId = (element.multicam as Json | undefined)?.angleId;
    const angles = asArray((target.multicam as Json | undefined)?.angles) as Json[];
    if (target.kind === "multicam" ? !angles.some((angle) => angle.id === angleId) : element.multicam !== undefined) {
      err(c, "document/multicam-invalid", `${p}/multicam`, "a multi-camera clip names one of its scene's angles, and only a multi-camera clip carries multicam");
    }
    edges.set(ref.scene.id, (edges.get(ref.scene.id) ?? new Set()).add(String(element.sceneId)));
  }
  // Depth of the reference graph from every scene; a scene met again on the current walk is a cycle.
  const depth = new Map<string, number>(), walking = new Set<string>();
  const visit = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (walking.has(id)) { err(c, "document/compound-cycle", scenePathOf({ id }), "the compound reference graph is acyclic"); return 0; }
    walking.add(id);
    let deepest = 0;
    for (const next of edges.get(id) ?? []) if (c.scenes.has(next)) deepest = Math.max(deepest, 1 + visit(next));
    walking.delete(id);
    depth.set(id, deepest);
    return deepest;
  };
  let deepest: [string, number] | undefined;
  for (const id of c.scenes.keys()) { const value = visit(id); if (!deepest || value > deepest[1]) deepest = [id, value]; }
  if (deepest && deepest[1] > 8) err(c, "document/compound-depth", scenePathOf({ id: deepest[0] }), "compound nesting is at most 8 levels", { limit: "compoundDepth", value: 8 });
}

/** Visits every element without allocating a reference for it. */
function eachRawElement(doc: Json, visit: (element: Json, track: Json) => void): void {
  for (const scene of asArray(doc.scenes)) {
    const tracks = isObject(scene) && isObject(scene.tracks) ? scene.tracks : undefined;
    if (!tracks) continue;
    for (const track of [...asArray(tracks.overlay), tracks.main, ...asArray(tracks.audio)]) {
      if (!isObject(track) || !Array.isArray(track.elements)) continue;
      for (const element of track.elements) if (isObject(element)) visit(element, track);
    }
  }
}

/** Cheap first pass: whether any two entities share an id at all. Paths are built only when they do. */
function idsCollide(doc: Json, only?: Set<string>): boolean {
  const seen = new Set<unknown>();
  let count = 0;
  // Incremental: only the ids of the touched entities can have become duplicates, so only they are counted.
  const claim = only
    ? (id: unknown) => { if (typeof id === "string" && only.has(id)) { seen.add(id); count++; } }
    : (id: unknown) => { if (typeof id === "string") { seen.add(id); count++; } };
  const each = (list: unknown, key = "id") => { for (const entry of asArray(list)) if (isObject(entry)) claim(entry[key]); };
  for (const scene of asArray(doc.scenes)) {
    if (!isObject(scene)) continue;
    claim(scene.id);
    each(scene.markers);
    each((scene.multicam as Json | undefined)?.angles);
    const tracks = isObject(scene.tracks) ? scene.tracks : {};
    for (const track of [...asArray(tracks.overlay), tracks.main, ...asArray(tracks.audio)]) {
      if (!isObject(track)) continue;
      claim(track.id);
      each(track.transitions);
      for (const element of asArray(track.elements)) {
        if (!isObject(element)) continue;
        claim(element.id);
        if (Array.isArray(element.effects) && element.effects.length) each(element.effects);
        if (Array.isArray(element.masks) && element.masks.length) each(element.masks);
      }
    }
  }
  const media = (doc.media ?? {}) as Json;
  each(media.assets);
  each(media.folders);
  each((doc.template as Json | undefined)?.slots, "slotId");
  each((doc.cover as Json | undefined)?.texts);
  return seen.size !== count;
}

function checkIds(c: Ctx, scope: Set<string> | null): void {
  let only: Set<string> | undefined;
  if (scope) {
    only = new Set(scope);
    const add = only;
    eachRawElement(c.doc as unknown as Json, (element) => {
      if (!scope.has(element.id as string)) return;
      for (const key of ["effects", "masks"]) for (const entry of asArray(element[key])) if (isObject(entry) && typeof entry.id === "string") add.add(entry.id);
    });
  }
  if (!idsCollide(c.doc as unknown as Json, only)) return;
  const seen = new Map<string, string>();
  const claim = (id: unknown, path: string) => {
    if (typeof id !== "string") return;
    const first = seen.get(id);
    if (first !== undefined) err(c, "document/duplicate-id", path, `id "${id}" is used by two entities`, { paths: [first, path] });
    else seen.set(id, path);
  };
  const doc = c.doc as unknown as Json;
  for (const scene of asArray(doc.scenes).filter(isObject) as Json[]) {
    const p = scenePathOf(scene);
    claim(scene.id, p);
    for (const marker of asArray(scene.markers).filter(isObject) as Json[]) claim(marker.id, `${p}/markers${pointer(`@${String(marker.id)}`)}`);
    for (const angle of asArray((scene.multicam as Json | undefined)?.angles).filter(isObject) as Json[]) claim(angle.id, `${p}/multicam/angles${pointer(`@${String(angle.id)}`)}`);
    for (const ref of tracksIn(scene as unknown as Scene, p)) {
      const track = ref.track as unknown as Json;
      claim(track.id, ref.path);
      for (const record of asArray(track.transitions).filter(isObject) as Json[]) claim(record.id, `${ref.path}/transitions${pointer(`@${String(record.id)}`)}`);
      for (const element of asArray(track.elements).filter(isObject) as Json[]) {
        const at = `${ref.path}/elements${pointer(`@${String(element.id)}`)}`;
        claim(element.id, at);
        for (const entry of asArray(element.effects).filter(isObject) as Json[]) claim(entry.id, `${at}/effects${pointer(`@${String(entry.id)}`)}`);
        for (const mask of asArray(element.masks).filter(isObject) as Json[]) claim(mask.id, `${at}/masks${pointer(`@${String(mask.id)}`)}`);
      }
    }
  }
  const media = (doc.media ?? {}) as Json;
  for (const asset of asArray(media.assets).filter(isObject) as Json[]) claim(asset.id, `/media/assets${pointer(`@${String(asset.id)}`)}`);
  for (const folder of asArray(media.folders).filter(isObject) as Json[]) claim(folder.id, `/media/folders${pointer(`@${String(folder.id)}`)}`);
  for (const slot of asArray((doc.template as Json | undefined)?.slots).filter(isObject) as Json[]) claim(slot.slotId, `/template/slots${pointer(`@${String(slot.slotId)}`)}`);
  for (const entry of asArray((doc.cover as Json | undefined)?.texts).filter(isObject) as Json[]) claim(entry.id, `/cover/texts${pointer(`@${String(entry.id)}`)}`);
}

function checkMedia(c: Ctx): void {
  const media = (c.doc.media ?? {}) as unknown as Json;
  const assets = asArray(media.assets).filter(isObject) as Json[], folders = asArray(media.folders).filter(isObject) as Json[];
  for (let index = 1; index < assets.length; index++) {
    if (compareIds(String(assets[index - 1].id), String(assets[index].id)) > 0) { err(c, "document/elements-unsorted", "/media/assets", "assets are sorted by id"); break; }
  }
  const folderById = new Map(folders.map((folder) => [folder.id, folder]));
  for (const asset of assets) {
    const at = `/media/assets${pointer(`@${String(asset.id)}`)}`;
    if (typeof asset.folderId === "string" && !folderById.has(asset.folderId)) err(c, "document/unknown-reference", `${at}/folderId`, "the folder does not exist");
    const source = (asset.derived as Json | undefined)?.sourceAssetId;
    if (source !== undefined && !c.assets.has(String(source))) err(c, "document/unknown-asset", `${at}/derived/sourceAssetId`, "the source asset does not exist");
  }
  const automatic = new Set<unknown>(), siblings = new Set<string>();
  for (const folder of folders) {
    const at = `/media/folders${pointer(`@${String(folder.id)}`)}`;
    if (typeof folder.parentId === "string" && !folderById.has(folder.parentId)) { err(c, "document/unknown-reference", `${at}/parentId`, "the parent folder does not exist"); continue; }
    let level = 1;
    for (let parent = folder.parentId; typeof parent === "string" && level <= 2001; parent = folderById.get(parent)?.parentId) level++;
    if (level > 4) err(c, "document/limit-exceeded", at, "folders nest at most 4 levels", { limit: "folderDepth", value: 4 });
    if (folder.kind !== "user") {
      if (automatic.has(folder.kind)) err(c, "document/limit-exceeded", at, `at most one "${String(folder.kind)}" folder exists`, { limit: "automaticFolders", value: 1 });
      automatic.add(folder.kind);
    }
    const name = `${String(folder.parentId)}/${String(folder.name).toLowerCase()}`;
    if (siblings.has(name)) err(c, "document/out-of-range", `${at}/name`, "sibling folder names are unique, ignoring case");
    siblings.add(name);
  }
}

function checkTemplate(c: Ctx): void {
  const template = (c.doc as unknown as Json).template as Json | undefined;
  if (!isObject(template)) return;
  const bad = (path: string, message: string) => err(c, "document/template-invalid", `/template${path}`, message);
  const scene = c.scenes.get(String(template.sceneId));
  if (!scene) { bad("/sceneId", "the template scene does not exist"); return; }
  const elements = new Map<string, Json>();
  for (const ref of tracksIn(scene, "")) for (const element of asArray((ref.track as { elements?: unknown }).elements).filter(isObject) as Json[]) elements.set(String(element.id), element);
  const named = new Set<unknown>();
  const name = (id: unknown, path: string) => { if (named.has(id)) bad(path, "an element is named by at most one slot, editable text or audio slot"); named.add(id); };
  const slots = asArray(template.slots).filter(isObject) as Json[];
  const indices = slots.map((slot) => slot.index as number).sort((a, b) => a - b);
  if (indices.some((value, index) => value !== index + 1)) bad("/slots", "slot indices are 1…n without gaps");
  slots.forEach((slot, index) => { if (index > 0 && (slot.index as number) < (slots[index - 1].index as number)) bad("/slots", "slots are ordered by index"); });
  for (const slot of slots) {
    const at = `/slots${pointer(`@${String(slot.slotId)}`)}`;
    const element = elements.get(String(slot.elementId));
    name(slot.elementId, `${at}/elementId`);
    if (!element || (element.type !== "video" && element.type !== "image")) { bad(`${at}/elementId`, "a slot names a video or image element of the template scene"); continue; }
    if (slot.duration !== element.duration) bad(`${at}/duration`, "a slot's duration equals its element's");
    if (slot.filled === true && element.mediaId === undefined) bad(`${at}/filled`, "a filled slot's element has media");
  }
  for (const [key, type] of [["editableTexts", "text"], ["audioSlots", "audio"]] as const) {
    asArray(template[key]).forEach((entry, index) => {
      if (!isObject(entry)) return;
      name(entry.elementId, `/${key}/${index}/elementId`);
      if (elements.get(String(entry.elementId))?.type !== type) bad(`/${key}/${index}/elementId`, `${key} name ${type} elements of the template scene`);
    });
  }
  const colours = asArray(template.themeColors).length, bound = new Set<string>();
  asArray(template.colorBindings).forEach((entry, index) => {
    if (!isObject(entry)) return;
    const key = `${String(entry.elementId)}|${String(entry.field)}`;
    if ((entry.colorIndex as number) >= colours || bound.has(key) || ![...allElements(c.doc)].some((ref) => ref.element.id === entry.elementId)) bad(`/colorBindings/${index}`, "a binding names a theme colour and one colour field of an existing element, once");
    bound.add(key);
  });
}

function buildContext(doc: ProjectDocument, registries: Registries, tolerant: boolean): Ctx {
  const d = doc as unknown as Json;
  const fpsValue = (d.settings as Json | undefined)?.fps as Rational | undefined;
  const fps = fpsValue && Number.isInteger(fpsValue.numerator) && Number.isInteger(fpsValue.denominator) && fpsValue.numerator > 0 && fpsValue.denominator > 0 ? fpsValue : { numerator: 30, denominator: 1 };
  const template = d.template as Json | undefined;
  return {
    doc, fps, frame: frameTicks(fps), registries, errors: [], warnings: [], tolerant,
    assets: new Map(asArray((d.media as Json | undefined)?.assets).filter(isObject).map((asset) => [String(asset.id), asset as unknown as AssetRecord])),
    scenes: new Map(asArray(d.scenes).filter(isObject).map((scene) => [String(scene.id), scene as unknown as Scene])),
    unfilledSlotElements: new Set(asArray(template?.slots).filter((slot) => isObject(slot) && slot.filled !== true).map((slot) => String((slot as Json).elementId))),
    scriptIds: new Set(asArray(d.scriptLinks).filter(isObject).map((link) => String(link.scriptId))),
    editableLimits: new Map(asArray(template?.editableTexts).filter(isObject).map((entry) => [String(entry.elementId), entry.maxLength as number])),
  };
}

function runChecks(c: Ctx, options: ValidateOptions, readerSchema: number): boolean {
  const doc = c.doc as unknown as Json;
  const readable = checkEnvelope(c, doc, readerSchema);
  if (!readable) return false;
  const scope = options.scope ? new Set(options.scope.elementIds) : null;
  if (scope) {
    // Incremental: the schema pass covers only the touched elements; relations are checked for their tracks and scenes.
    eachRawElement(doc, (element) => {
      if (!scope.has(element.id as string)) return;
      const schema = ELEMENT_VARIANTS[element.type as keyof typeof ELEMENT_VARIANTS] as z.ZodTypeAny | undefined;
      const result = schema?.safeParse(element);
      if (result && !result.success) reportIssues(c, result.error.issues, element, findElement(c.doc, String(element.id))?.elementPath ?? "");
    });
  } else {
    scanTree(c, withoutLocal(doc), [], 1, { deep: false });
    const result = projectDocumentSchema.safeParse(withoutLocal(doc));
    if (!result.success) reportIssues(c, result.error.issues, doc, "");
  }
  if (!Array.isArray(doc.scenes)) return true;
  const scenes = [...c.scenes.values()];
  const mains = scenes.filter((scene) => scene.isMain === true);
  if (mains.length !== 1 || (mains[0] as unknown as Json).kind !== undefined && mains[0].kind !== "timeline") err(c, "document/no-main-scene", "/scenes", "exactly one scene is the main scene, of kind \"timeline\"");
  checkIds(c, scope);
  for (const scene of scenes) checkScene(c, scene, scope);
  checkCompounds(c);
  if (scope) return true;
  checkGroupsAcrossScenes(c);
  checkMedia(c);
  checkTemplate(c);
  checkBackground(c, (doc.settings as Json | undefined)?.background, "/settings/background");
  const cover = doc.cover as Json | undefined;
  if (isObject(cover)) {
    aligned(c, cover.time, "/cover/time");
    if (typeof cover.sceneId === "string" && !c.scenes.has(cover.sceneId)) warn(c, "document/unknown-scene", "/cover/sceneId", "the cover's scene no longer exists; the rendered image is kept");
    if (typeof cover.mediaId === "string" && !c.assets.has(cover.mediaId)) warn(c, "document/unknown-asset", "/cover/mediaId", "the cover's asset no longer exists; the rendered image is kept");
  }
  const links = asArray(doc.scriptLinks).filter(isObject).map((link) => link.scriptId);
  if (new Set(links).size !== links.length) err(c, "document/duplicate-id", "/scriptLinks", "scriptLinks holds each scriptId once");
  let total = 0;
  for (const ref of allTracks(c.doc)) total += asArray((ref.track as { elements?: unknown }).elements).length;
  if (total > 100_000) err(c, "document/limit-exceeded", "/scenes", "a project holds at most 100 000 elements", { limit: "elementsPerProject", value: 100_000 });
  // UTF-8 never needs more than 3 bytes per UTF-16 code unit, so a short JSON text cannot exceed the byte limit and
  // the exact canonical size is computed only when it could.
  if (c.errors.length === 0 && JSON.stringify(withoutLocal(doc)).length * 3 > MAX_DOCUMENT_BYTES) {
    const bytes = utf8(canonicalize(doc)).length;
    if (bytes > MAX_DOCUMENT_BYTES) err(c, "document/too-large", "", `the canonical form is ${bytes} bytes; the limit is ${MAX_DOCUMENT_BYTES}`, { bytes, limit: MAX_DOCUMENT_BYTES });
  }
  return true;
}

/** A group id carried in two scenes is invalid even when each scene holds two members. */
function checkGroupsAcrossScenes(c: Ctx): void {
  const owner = new Map<string, string>();
  if (c.scenes.size < 2) return;
  for (const ref of allElements(c.doc)) {
    const groupId = (ref.element as { groupId?: string | null }).groupId;
    if (typeof groupId !== "string") continue;
    const first = owner.get(groupId);
    if (first !== undefined && first !== ref.scene.id && !c.errors.some((error) => error.code === "document/group-invalid" && error.path === `${ref.elementPath}/groupId`)) {
      err(c, "document/group-invalid", `${ref.elementPath}/groupId`, `group "${groupId}" spans two scenes`);
    }
    if (first === undefined) owner.set(groupId, ref.scene.id);
  }
}

function strict(document: unknown, options: ValidateOptions): ValidationResult {
  const readerSchema = options.readerSchema ?? PROJECT_SCHEMA_VERSION;
  if (!isObject(document)) return { ok: false, errors: [documentError("document/not-an-object", "", "the root is not a JSON object")], warnings: [], unknownFields: [], readOnly: false };
  const newer = Number.isInteger(document.schemaVersion) && (document.schemaVersion as number) > readerSchema;
  const c = buildContext(document as unknown as ProjectDocument, options.registries ?? {}, newer);
  const readable = runChecks(c, options, readerSchema);
  const unknownFields = readable && !options.scope ? findUnknownFields(withoutLocal(document), projectDocumentSchema) : [];
  const pipeline = (document.settings as Json | undefined)?.colorPipeline;
  const readOnly = !readable || (pipeline !== undefined && pipeline !== "sdr-rec709-8bit");
  return { ok: c.errors.length === 0, errors: c.errors.slice(0, MAX_ERRORS), warnings: c.warnings, unknownFields, readOnly };
}

/**
 * The one validator of the project document. Every writer passes it in `strict` mode before a change is committed,
 * saved, emitted as a state patch or accepted from outside; a load passes it in `load` mode, which repairs.
 * It validates and never normalises: the document handed in is not modified.
 */
export function validateProjectDocument(document: unknown, options: ValidateOptions = {}): ValidationResult {
  if (options.mode !== "load") return strict(document, options);
  if (!isObject(document) || !Array.isArray(document.scenes) || document.schemaVersion === undefined) {
    const result = strict(document, options);
    // The root, `scenes` or the version cannot be rebuilt: the load fails and no record is modified.
    return { ...result, ok: false, errors: result.errors.length ? result.errors : [documentError("document/wrong-type", "/scenes", "scenes is not an array")] };
  }
  const repaired = repairDocument(document as unknown as ProjectDocument, (candidate) => strict(candidate, options));
  const result = strict(repaired.document, options);
  // Numbers outside a range (and times off the frame grid) are kept as stored and corrected the next time the field
  // is written; they do not fail a load.
  const errors = result.errors.filter((error) => error.code !== "document/out-of-range" && error.code !== "document/not-frame-aligned");
  return { ...result, ok: errors.length === 0, errors, document: repaired.document, repairs: repaired.repairs };
}

/** The message a boundary shows for a set of findings; exported for writers that reject. */
export const firstErrorCode = (result: ValidationResult): string | undefined => result.errors[0]?.code;
