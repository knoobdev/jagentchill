import { animatablePath, STATIC_ANIMATABLE_PATHS, type ProjectDocument, type Rational } from "@jagentchill/protocol";
import { isObject, type Json } from "../model.ts";
import { snapToFrame } from "../time.ts";
import { refuse } from "../timeline/model.ts";
import { valueAt } from "../timeline/keyframes.ts";
import { hexToLinear, segmentType, writeKey } from "./animation.ts";
import { edit, editable, elementIn, type Commit, type CommitContext } from "./shared.ts";

/**
 * Keyframe editing (`keyframe-animation`): easing, tangents, moves, removal with the value kept, copy and paste, and
 * the read side the lanes, the toggles and the graph editor draw from. Everything that writes goes through the
 * commit pipeline as one step.
 */

export type Bezier = [number, number, number, number];
export type KeyRef = { elementId: string; path: string; keyId: string };
export type Handle = { dt: number; dv: number };
type Key = Json & { id: string; time: number; value: unknown; segmentToNext?: string; tangentMode?: string; leftHandle?: Handle; rightHandle?: Handle; easing?: Bezier };

export const KEY_LIMIT = 1000;
export const KEY_LIMIT_MESSAGE = "Keyframe limit reached (1000 per property)";
/** The grouped property: one toggle, one diamond and one lane over the two stored scale channels. */
export const SCALE_GROUP = "transform.scale";
const SCALE_PATHS = ["transform.scale.x", "transform.scale.y"];
/** The stored channels a presented path stands for. */
export const storedPaths = (path: string): string[] => (path === SCALE_GROUP ? SCALE_PATHS : [path]);

export const EASING_PRESETS: readonly { id: string; group: "Basic" | "In" | "Out" | "Ease"; name: string; bezier: Bezier }[] = [
  { id: "linear", group: "Basic", name: "Linear", bezier: [0, 0, 1, 1] },
  { id: "smooth", group: "Basic", name: "Smooth", bezier: [0.25, 0.1, 0.25, 1] },
  { id: "pop", group: "Basic", name: "Pop", bezier: [0.175, 0.885, 0.32, 1.275] },
  { id: "ease-in", group: "In", name: "Ease in", bezier: [0.8, 0, 1, 1] },
  { id: "quad-in", group: "In", name: "Quad in", bezier: [0.55, 0.085, 0.68, 0.53] },
  { id: "cubic-in", group: "In", name: "Cubic in", bezier: [0.55, 0.055, 0.675, 0.19] },
  { id: "ease-out", group: "Out", name: "Ease out", bezier: [0, 0, 0.2, 1] },
  { id: "quad-out", group: "Out", name: "Quad out", bezier: [0.25, 0.46, 0.45, 0.94] },
  { id: "cubic-out", group: "Out", name: "Cubic out", bezier: [0.215, 0.61, 0.355, 1] },
  { id: "in-out", group: "Ease", name: "In out", bezier: [0.4, 0, 0.2, 1] },
  { id: "quad-in-out", group: "Ease", name: "Quad in out", bezier: [0.455, 0.03, 0.515, 0.955] },
  { id: "cubic-in-out", group: "Ease", name: "Cubic in out", bezier: [0.645, 0.045, 0.355, 1] },
  { id: "expo-in-out", group: "Ease", name: "Expo in out", bezier: [1, 0, 0, 1] },
];
const LINEAR: Bezier = [0, 0, 1, 1];
export const sameBezier = (a: Bezier, b: Bezier, tolerance = 0.02): boolean => a.every((value, index) => Math.abs(value - b[index]) <= tolerance);
/** The preset a bezier matches within 0.02 on every component. */
export const matchingPreset = (bezier: Bezier | null): string | null => (bezier ? EASING_PRESETS.find((preset) => sameBezier(preset.bezier, bezier))?.id ?? null : null);
/** A named preset as tools give it ("Ease out", "ease-out"). */
export const easingPreset = (name: string): Bezier | null => EASING_PRESETS.find((preset) => preset.id === name || preset.name.toLowerCase() === name.toLowerCase())?.bezier ?? null;

// — Reading —
const channelOf = (element: Json, path: string): Json | undefined => (isObject(element.animations) && isObject(element.animations[path]) ? (element.animations[path] as Json) : undefined);
const isColor = (channel: Json): boolean => "r" in channel;
/** The key lists of a channel: four for a colour, one otherwise. */
const partsOf = (channel: Json): Key[][] => (isColor(channel) ? ["r", "g", "b", "a"].map((part) => ((channel[part] as Json).keys ?? []) as Key[]) : [(channel.keys ?? []) as Key[]]);
const setParts = (channel: Json, change: (keys: Key[]) => Key[]): void => {
  if (isColor(channel)) for (const part of ["r", "g", "b", "a"]) (channel[part] as Json).keys = change(((channel[part] as Json).keys ?? []) as Key[]);
  else channel.keys = change((channel.keys ?? []) as Key[]);
};
const isScalar = (channel: Json): boolean => !isColor(channel) && typeof ((channel.keys as Key[] | undefined)?.[0]?.value) === "number";
const isPath = (channel: Json): boolean => !isColor(channel) && isObject((channel.keys as Key[] | undefined)?.[0]?.value);

const cubic = (a: number, b: number, c: number, d: number, s: number): number => (1 - s) ** 3 * a + 3 * (1 - s) ** 2 * s * b + 3 * (1 - s) * s * s * c + s ** 3 * d;
/** The `y` of a normalised cubic bezier at `x`. */
export function bezierProgress(bezier: Bezier, x: number): number {
  let low = 0, high = 1;
  for (let step = 0; step < 48; step++) { const mid = (low + high) / 2; if (cubic(0, bezier[0], bezier[2], 1, mid) < x) low = mid; else high = mid; }
  return cubic(0, bezier[1], bezier[3], 1, (low + high) / 2);
}
const slopeAt = (from: Key, to: Key, atEnd: boolean): number => {
  const span = to.time - from.time, a = from.value as number, b = to.value as number;
  if (from.segmentToNext === "step" || span === 0) return 0;
  if (from.segmentToNext !== "bezier") return (b - a) / span;
  const right = from.rightHandle ?? { dt: span / 3, dv: 0 }, left = to.leftHandle ?? { dt: -span / 3, dv: 0 };
  const [dt, dv] = atEnd ? [-left.dt, -left.dv] : [right.dt, right.dv];
  return dt === 0 ? 0 : dv / dt;
};
/** Value of a scalar channel at a local time, with its extrapolation; the same rule the renderer resolves by. */
export function scalarAt(channel: { keys: unknown[]; extrapolation?: { before?: string; after?: string } }, time: number): number {
  const keys = channel.keys as Key[], first = keys[0], last = keys[keys.length - 1];
  if (time < first.time && channel.extrapolation?.before === "linear" && keys.length > 1) return (first.value as number) + slopeAt(first, keys[1], false) * (time - first.time);
  if (time > last.time && channel.extrapolation?.after === "linear" && keys.length > 1) return (last.value as number) + slopeAt(keys[keys.length - 2], last, true) * (time - last.time);
  return valueAt(keys as never, time) as number;
}
const linearToSrgb = (value: number): number => { const clamped = Math.min(1, Math.max(0, value)); return clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055; };
const byteHex = (value: number): string => Math.round(Math.min(1, Math.max(0, value)) * 255).toString(16).padStart(2, "0");
/** Linear-light components → lowercase `#rrggbb`, or `#rrggbbaa` when not opaque. */
export const linearToHex = (color: { r: number; g: number; b: number; a: number }): string => `#${byteHex(linearToSrgb(color.r))}${byteHex(linearToSrgb(color.g))}${byteHex(linearToSrgb(color.b))}${color.a < 1 - 1e-6 ? byteHex(color.a) : ""}`;

const read = (target: unknown, parts: string[]): unknown => { let current = target; for (const part of parts) current = isObject(current) ? current[part] : undefined; return current; };
/** Where the static value of a path lives: the entry of an id-keyed collection, or the element itself. */
function baseSlot(element: Json, path: string): { holder: Json; parts: string[] } | null {
  const parts = path.split(".");
  if ((parts[0] === "effects" || parts[0] === "masks") && parts.length === 4) {
    const entry = ((element[parts[0]] as Json[] | undefined) ?? []).find((candidate) => candidate.id === parts[1]);
    return entry ? { holder: entry, parts: parts.slice(2) } : null;
  }
  return { holder: element, parts };
}
/** The stored (un-animated) value of a path. */
export function baseValue(element: Json, path: string): unknown {
  const slot = baseSlot(element, path);
  return slot ? read(slot.holder, slot.parts) : undefined;
}
function writeBase(element: Json, path: string, value: unknown): void {
  const slot = baseSlot(element, path);
  if (!slot) return;
  let target = slot.holder;
  for (const part of slot.parts.slice(0, -1)) target = (isObject(target[part]) ? target[part] : (target[part] = {})) as Json;
  target[slot.parts[slot.parts.length - 1]] = value;
}
/** The value a property shows at an element-local time: the animated one when it has keys, the stored one otherwise. */
export function resolvedValue(element: Json, path: string, local: number, fallback?: unknown): unknown {
  const channel = channelOf(element, path);
  if (!channel) { const stored = baseValue(element, path); return stored === undefined ? fallback : stored; }
  if (isColor(channel)) { const [r, g, b, a] = ["r", "g", "b", "a"].map((part) => scalarAt(channel[part] as never, local)); return linearToHex({ r, g, b, a }); }
  if (isScalar(channel)) {
    const range = animatablePath(element as never, path)?.range, value = scalarAt(channel as never, local);
    return range ? Math.min(range.max, Math.max(range.min, value)) : value;
  }
  return valueAt((channel.keys ?? []) as never, local);
}

const STATIC_ORDER = new Map(STATIC_ANIMATABLE_PATHS.map((entry, index) => [entry.path, index]));
/** Animated paths of an element in lane order: the nine groups, the catalogue's row order inside a group. Scale is one lane. */
export function lanePaths(element: Json): string[] {
  const paths = Object.keys(isObject(element.animations) ? element.animations : {});
  const presented = [...new Set(paths.map((path) => (SCALE_PATHS.includes(path) ? SCALE_GROUP : path)))];
  const rank = (path: string): [number, number] => {
    const stored = storedPaths(path)[0];
    return [animatablePath(element as never, stored)?.group ?? 10, STATIC_ORDER.get(stored) ?? 10_000];
  };
  return presented.map((path, index) => ({ path, index, rank: rank(path) })).sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.index - b.index).map((entry) => entry.path);
}
const LABELS: Record<string, string> = {
  "transform.position.x": "Position X", "transform.position.y": "Position Y", "transform.scale": "Scale", "transform.scale.x": "Scale X", "transform.scale.y": "Scale Y", "transform.rotation": "Rotation", opacity: "Opacity", volume: "Volume", pan: "Pan",
};
const words = (key: string): string => key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase());
/** What a lane or a channel is called. */
export function pathLabel(path: string): string {
  if (LABELS[path]) return LABELS[path];
  const parts = path.split(".");
  if (parts[0] === "masks" || parts[0] === "effects") return `${parts[0] === "masks" ? "Mask" : "Effect"} ${words(parts[3] ?? "")}`.trim();
  if (parts[0] === "adjustments") return parts.slice(2).map(words).join(" ");
  return parts.slice(-2).map(words).join(" ");
}
/** The keys of a presented path (the first stored channel's, the first part's for a colour). */
export function keysOfPath(element: Json, path: string): Key[] {
  const channel = channelOf(element, storedPaths(path)[0]);
  return channel ? partsOf(channel)[0] : [];
}
/** Distinct key times of an element, or of one presented path. */
export function keyTimes(element: Json, path?: string): number[] {
  const paths = path ? [path] : lanePaths(element);
  return [...new Set(paths.flatMap((entry) => keysOfPath(element, entry).map((key) => key.time)))].sort((a, b) => a - b);
}
/** The nearest key time strictly before or after a local time; `null` when there is none in that direction. */
export function neighbourKeyTime(element: Json, local: number, direction: "previous" | "next", path?: string): number | null {
  const times = keyTimes(element, path);
  const found = direction === "next" ? times.find((time) => time > local) : [...times].reverse().find((time) => time < local);
  return found ?? null;
}
/** `hollow`: no keys; `half`: keys, none at the time; `filled`: a key at the time (on every stored channel of the path). */
export function toggleState(element: Json, path: string, local: number): "hollow" | "half" | "filled" {
  const lists = storedPaths(path).map((stored) => keysOfPath(element, stored));
  if (lists.every((keys) => keys.length === 0)) return "hollow";
  return lists.every((keys) => keys.some((key) => key.time === local)) ? "filled" : "half";
}

// — Writing keys —
const durationOf = (element: Json): number => Number(element.duration ?? 0);
/** The local time a key is written at: snapped to the project frame grid and clamped to the element. */
export const keyTime = (element: Json, time: number, fps: Rational): number => Math.min(durationOf(element), Math.max(0, snapToFrame(Math.min(durationOf(element), Math.max(0, time)), fps)));
function requireKeyable(element: Json, path: string): void {
  if (!animatablePath(element as never, path)) refuse(`"${path}" is not keyframable`, "INVALID_PARAMS", { reason: "not keyframable", path });
}
function writeOne(element: Json, elementPath: string, path: string, input: { time: number; value: number | string | boolean; segmentToNext?: string }, newId: () => string): string {
  requireKeyable(element, path);
  const existing = keysOfPath(element, path);
  if (existing.length >= KEY_LIMIT && !existing.some((key) => key.time === input.time)) refuse(KEY_LIMIT_MESSAGE, "INVALID_PARAMS", { reason: "key limit", path });
  // A key that is replaced keeps its segment and its handles.
  const kept = existing.find((key) => key.time === input.time);
  const id = writeKey(element, elementPath, path, { ...input, segmentToNext: input.segmentToNext ?? kept?.segmentToNext }, newId);
  const channel = channelOf(element, path);
  if (channel && isScalar(channel)) retangent(channel.keys as Key[]);
  return id;
}
/**
 * Adds or replaces a key of a presented path at an element-local time (frame-snapped, clamped to the element). The
 * grouped Scale writes both stored channels at the same tick. A path that is not animatable on the element is refused
 * (`INVALID_PARAMS`, "not keyframable"), and so is key 1 001 of a channel.
 */
export function setKeyframe(doc: ProjectDocument, ctx: CommitContext, elementId: string, path: string, input: { time: number; value: number | string | boolean | { x: number; y: number }; segmentToNext?: string; easing?: string | Bezier }, label = "Add keyframe"): Commit {
  return edit(doc, ctx, { commandType: "keyframe.upsert", label }, (draft) => {
    const ref = elementIn(draft, elementId), element = editable(ref), time = keyTime(element, input.time, draft.settings.fps as Rational);
    const stored = storedPaths(path);
    stored.forEach((target, index) => {
      const value = isObject(input.value) ? (index === 0 ? input.value.x : input.value.y) : input.value;
      writeOne(element, ref.elementPath, target, { time, value: value as number, segmentToNext: input.segmentToNext }, ctx.newId);
    });
    const bezier = typeof input.easing === "string" ? easingPreset(input.easing) : input.easing;
    if (bezier) for (const target of stored) { const key = keysOfPath(element, target).find((entry) => entry.time === time); if (key) easeSegment(element, target, key.id, bezier); }
  });
}
/** Adds a key holding the current resolved value at the time, or removes the key that is there. */
export function toggleKeyframe(doc: ProjectDocument, ctx: CommitContext, elementId: string, path: string, local: number, fallback?: number | string | boolean): Commit {
  const element = elementIn(doc, elementId).element as unknown as Json, time = keyTime(element, local, doc.settings.fps as Rational);
  if (toggleState(element, path, time) === "filled") {
    const refs = storedPaths(path).flatMap((stored) => keysOfPath(element, stored).filter((key) => key.time === time).map((key) => ({ elementId, path: stored, keyId: key.id })));
    return removeKeys(doc, ctx, refs, { localTimes: { [elementId]: time }, label: "Remove keyframe" });
  }
  return edit(doc, ctx, { commandType: "keyframe.upsert", label: "Add keyframe" }, (draft) => {
    const ref = elementIn(draft, elementId), target = editable(ref);
    for (const stored of storedPaths(path)) writeOne(target, ref.elementPath, stored, { time, value: (resolvedValue(target, stored, time, fallback) ?? fallback ?? 0) as number }, ctx.newId);
  });
}
/**
 * Writes a property the way every editor control does: a key at the time when the property has keys, the stored
 * value otherwise. `write` sets the stored value of a path that is not a plain nested field.
 */
export function writeProperty(doc: ProjectDocument, ctx: CommitContext, elementId: string, path: string, value: number | string | boolean, local: number, meta = { commandType: "element.property", label: "Edit" }): Commit {
  return edit(doc, ctx, meta, (draft) => {
    const ref = elementIn(draft, elementId), element = editable(ref);
    if (channelOf(element, path)) writeOne(element, ref.elementPath, path, { time: keyTime(element, local, draft.settings.fps as Rational), value }, ctx.newId);
    else writeBase(element, path, value);
  });
}

/** Removes keys from a draft element. A channel left empty hands the value it had at `local` to the stored field and is deleted. */
function dropKeys(element: Json, path: string, keyIds: ReadonlySet<string>, local: number): void {
  const channel = channelOf(element, path);
  if (!channel) return;
  const before = resolvedValue(element, path, local);
  setParts(channel, (keys) => keys.filter((key) => !keyIds.has(key.id)));
  // A key the user removed is no longer one a tool wrote.
  for (const name of ["aiMotion", "autoReframe"]) {
    const owner = element[name];
    if (!isObject(owner) || !Array.isArray(owner.keyIds)) continue;
    owner.keyIds = owner.keyIds.filter((id) => !keyIds.has(String(id)));
    if ((owner.keyIds as unknown[]).length === 0) delete element[name];
  }
  if (partsOf(channel)[0].length > 0) { if (isScalar(channel)) retangent(channel.keys as Key[]); return; }
  delete (element.animations as Json)[path];
  if (Object.keys(element.animations as Json).length === 0) delete element.animations;
  if (before !== undefined && !isObject(before)) writeBase(element, path, before);
}
/**
 * Removes keyframes as one step. When that empties a channel, the value the property had at the playhead goes to the
 * stored field (`localTimes`: the element-local playhead per element; without one the first removed key's time).
 */
export function removeKeys(doc: ProjectDocument, ctx: CommitContext, refs: KeyRef[], options: { localTimes?: Record<string, number>; label?: string } = {}): Commit {
  return edit(doc, ctx, { commandType: "keyframe.remove", label: options.label ?? (refs.length > 1 ? "Delete keyframes" : "Remove keyframe") }, (draft) => {
    for (const elementId of new Set(refs.map((ref) => ref.elementId))) {
      const element = editable(elementIn(draft, elementId));
      const mine = refs.filter((ref) => ref.elementId === elementId);
      for (const path of new Set(mine.flatMap((ref) => storedPaths(ref.path)))) {
        const ids = new Set(mine.filter((ref) => storedPaths(ref.path).includes(path)).map((ref) => ref.keyId));
        // The grouped Scale names its x key; the y key of the same tick goes with it.
        const times = new Set(mine.filter((ref) => ref.path === SCALE_GROUP).flatMap((ref) => keysOfPath(element, SCALE_PATHS[0]).filter((key) => key.id === ref.keyId).map((key) => key.time)));
        for (const key of keysOfPath(element, path)) if (times.has(key.time)) ids.add(key.id);
        const fallback = keysOfPath(element, path).find((key) => ids.has(key.id))?.time ?? 0;
        dropKeys(element, path, ids, Math.min(durationOf(element), Math.max(0, options.localTimes?.[elementId] ?? fallback)));
      }
    }
  });
}
/** "Remove all keyframes" of a property: the channel is deleted and the stored value becomes the one at the playhead. */
export function removeAllKeys(doc: ProjectDocument, ctx: CommitContext, elementId: string, path: string, local: number): Commit {
  const element = elementIn(doc, elementId).element as unknown as Json;
  const refs = storedPaths(path).flatMap((stored) => keysOfPath(element, stored).map((key) => ({ elementId, path: stored, keyId: key.id })));
  return removeKeys(doc, ctx, refs, { localTimes: { [elementId]: local }, label: "Remove all keyframes" });
}

// — Tangents and easing —
const third = (span: number): number => Math.max(0, Math.round(span / 3));
/** The canonical form holds no negative zero. */
const nz = (value: number): number => (value === 0 ? 0 : value);
const handleOf = (dt: number, dv: number): Handle => ({ dt: nz(dt), dv: nz(dv) });
/**
 * Recomputes the handles of `auto` and `flat` keys from their neighbours (Catmull-Rom slope, a third of each
 * segment), on the sides that touch a bezier segment; a side that touches none carries no handle.
 */
export function retangent(keys: Key[]): void {
  keys.forEach((key, index) => {
    const previous = keys[index - 1], next = keys[index + 1];
    const incoming = previous?.segmentToNext === "bezier", outgoing = Boolean(next) && key.segmentToNext === "bezier";
    if (!incoming) delete key.leftHandle;
    if (!outgoing) delete key.rightHandle;
    const mode = key.tangentMode ?? "auto";
    if (mode !== "auto" && mode !== "flat") {
      // A hand-set handle never reaches past the neighbouring key.
      if (key.rightHandle && next) key.rightHandle = handleOf(Math.min(Math.max(0, key.rightHandle.dt), next.time - key.time), key.rightHandle.dv);
      if (key.leftHandle && previous) key.leftHandle = handleOf(Math.max(Math.min(0, key.leftHandle.dt), previous.time - key.time), key.leftHandle.dv);
      if (outgoing && !key.rightHandle) key.rightHandle = handleOf(third(next.time - key.time), 0);
      if (incoming && !key.leftHandle) key.leftHandle = handleOf(-third(key.time - previous.time), 0);
      return;
    }
    const a = previous ?? key, b = next ?? key;
    const slope = mode === "flat" || b.time === a.time ? 0 : ((b.value as number) - (a.value as number)) / (b.time - a.time);
    if (outgoing) { const dt = third(next.time - key.time); key.rightHandle = handleOf(dt, slope * dt); }
    if (incoming) { const dt = -third(key.time - previous.time); key.leftHandle = handleOf(dt, slope * dt); }
  });
}
/** The outgoing segment of a key as a normalised bezier; `null` for a hold segment or a key with no next key. */
export function segmentBezier(keys: Key[], keyId: string): Bezier | null {
  const index = keys.findIndex((key) => key.id === keyId), from = keys[index], to = keys[index + 1];
  if (!from || !to || from.segmentToNext === "step") return null;
  if (isObject(from.value)) return from.segmentToNext === "bezier" ? (from.easing ?? [0.25, 0.1, 0.25, 1]) : LINEAR;
  if (from.segmentToNext !== "bezier") return LINEAR;
  const span = to.time - from.time, dv = (to.value as number) - (from.value as number);
  const right = from.rightHandle ?? { dt: span / 3, dv: 0 }, left = to.leftHandle ?? { dt: -span / 3, dv: 0 };
  const round = (value: number) => Math.round(value * 1e4) / 1e4;
  // A segment between equal values has no height to normalise by: its handles read as resting on the line.
  return [round(right.dt / span), dv === 0 ? 0 : round(right.dv / dv), round(1 + left.dt / span), dv === 0 ? 1 : round(1 + left.dv / dv)];
}
/** Writes a normalised bezier onto the outgoing segment of a key of one stored channel. `[0, 0, 1, 1]` is stored as `linear`. */
function easeSegment(element: Json, path: string, keyId: string, bezier: Bezier): boolean {
  const channel = channelOf(element, path);
  if (!channel) return false;
  let done = false;
  for (const keys of partsOf(channel)) {
    const index = keys.findIndex((key) => key.id === keyId), from = keys[index], to = keys[index + 1];
    if (!from || !to || to.time === from.time) continue;
    done = true;
    const linear = sameBezier(bezier, LINEAR, 1e-9);
    from.segmentToNext = linear ? "linear" : "bezier";
    if (isObject(from.value)) { if (linear) delete from.easing; else from.easing = bezier; continue; }
    if (linear) { delete from.rightHandle; delete to.leftHandle; continue; }
    const span = to.time - from.time, dv = (to.value as number) - (from.value as number);
    from.rightHandle = handleOf(Math.round(bezier[0] * span), bezier[1] * dv);
    to.leftHandle = handleOf(Math.round((bezier[2] - 1) * span), (bezier[3] - 1) * dv);
    // The easing is the shape the user asked for: neighbours moving later do not recompute it.
    if ((from.tangentMode ?? "auto") === "auto" || from.tangentMode === "flat") from.tangentMode = "broken";
    if ((to.tangentMode ?? "auto") === "auto" || to.tangentMode === "flat") to.tangentMode = "broken";
  }
  return done;
}
/** Handle limits of the Easing view: X 0–1, Y −0.5–1.5; Y snaps to 0 or 1 within 0.06 unless `free`. */
export function clampEasing(bezier: Bezier, free = false): Bezier {
  const x = (value: number) => Math.min(1, Math.max(0, value));
  const y = (value: number) => { const clamped = Math.min(1.5, Math.max(-0.5, value)); if (free) return clamped; return Math.abs(clamped) <= 0.06 ? 0 : Math.abs(clamped - 1) <= 0.06 ? 1 : clamped; };
  return [x(bezier[0]), y(bezier[1]), x(bezier[2]), y(bezier[3])];
}
/** Applies one easing to the outgoing segment of every given key, as one step. */
export function applyEasing(doc: ProjectDocument, ctx: CommitContext, refs: KeyRef[], bezier: Bezier): Commit {
  return edit(doc, ctx, { commandType: "keyframe.curve", label: "Easing" }, (draft) => {
    for (const ref of refs) { const element = editable(elementIn(draft, ref.elementId)); for (const path of storedPaths(ref.path)) easeSegment(element, path, sameTickId(element, ref, path), bezier); }
  });
}
/** The key of `path` that sits on the same tick as the referenced key (the y key of a grouped Scale reference). */
function sameTickId(element: Json, ref: KeyRef, path: string): string {
  if (ref.path !== SCALE_GROUP || path === SCALE_PATHS[0]) return ref.keyId;
  const time = keysOfPath(element, SCALE_PATHS[0]).find((key) => key.id === ref.keyId)?.time;
  return keysOfPath(element, path).find((key) => key.time === time)?.id ?? ref.keyId;
}
export const EASING_REASONS = {
  none: "Select a keyframe to edit its curve.", elements: "Selected keyframes must be on the same element.", last: "Select a keyframe that has an outgoing segment.",
  hold: "Hold segments have a fixed value - easing has no effect here.", sameTime: "Cannot edit a segment where both keyframes are at the same time.", channel: "Selected properties do not share a graph-editable channel.",
} as const;
/** What the Easing view shows for a keyframe selection: the bezier of the first editable segment, or the reason it has none. */
export function easingState(doc: ProjectDocument, refs: KeyRef[]): { ok: true; bezier: Bezier; refs: KeyRef[] } | { ok: false; reason: string } {
  if (refs.length === 0) return { ok: false, reason: EASING_REASONS.none };
  if (new Set(refs.map((ref) => ref.elementId)).size > 1) return { ok: false, reason: EASING_REASONS.elements };
  const element = elementIn(doc, refs[0].elementId).element as unknown as Json;
  const usable: KeyRef[] = [];
  let reason: string = EASING_REASONS.last, bezier: Bezier | null = null;
  for (const ref of refs) {
    const stored = storedPaths(ref.path)[0], channel = channelOf(element, stored);
    if (!channel) continue;
    if (!isScalar(channel) && !isColor(channel) && !isPath(channel)) { reason = EASING_REASONS.channel; continue; }
    const keys = partsOf(channel)[0], index = keys.findIndex((key) => key.id === ref.keyId), from = keys[index], to = keys[index + 1];
    if (!from || !to) continue;
    if (to.time === from.time) { reason = EASING_REASONS.sameTime; continue; }
    if (from.segmentToNext === "step") { reason = EASING_REASONS.hold; continue; }
    usable.push(ref);
    bezier ??= segmentBezier(keys, ref.keyId);
  }
  return usable.length > 0 && bezier ? { ok: true, bezier, refs: usable } : { ok: false, reason };
}

/** Sets the segment type of the outgoing segment of keys ("hold" is the user's word for `step`). Bezier creates handles by the `auto` rule when none exist. */
export function setSegmentType(doc: ProjectDocument, ctx: CommitContext, refs: KeyRef[], type: "linear" | "hold" | "step" | "bezier"): Commit {
  return edit(doc, ctx, { commandType: "keyframe.curve", label: "Segment type" }, (draft) => {
    for (const ref of refs) {
      const element = editable(elementIn(draft, ref.elementId));
      for (const path of storedPaths(ref.path)) {
        const channel = channelOf(element, path), id = sameTickId(element, ref, path);
        if (!channel) continue;
        for (const keys of partsOf(channel)) {
          const key = keys.find((entry) => entry.id === id);
          if (!key || !("segmentToNext" in key || typeof key.value === "number" || isObject(key.value))) continue;
          key.segmentToNext = segmentType(type);
          if (isObject(key.value)) continue;
          if (key.segmentToNext === "bezier" && !key.rightHandle) { const saved = keys.map((entry) => entry.tangentMode); const index = keys.indexOf(key); for (const at of [index, index + 1]) if (keys[at] && !(at === index ? keys[at].rightHandle : keys[at].leftHandle)) keys[at].tangentMode = "auto"; retangent(keys); keys.forEach((entry, at) => { entry.tangentMode = saved[at] ?? "auto"; }); }
          else retangent(keys);
        }
      }
    }
  });
}
/** Sets the tangent mode of keys; `auto` and `flat` recompute the handles at once. */
export function setTangentMode(doc: ProjectDocument, ctx: CommitContext, refs: KeyRef[], mode: "auto" | "aligned" | "broken" | "flat"): Commit {
  return edit(doc, ctx, { commandType: "keyframe.curve", label: "Tangent mode" }, (draft) => {
    for (const ref of refs) {
      const element = editable(elementIn(draft, ref.elementId));
      for (const path of storedPaths(ref.path)) {
        const channel = channelOf(element, path), id = sameTickId(element, ref, path);
        if (!channel || !isScalar(channel)) continue;
        const keys = channel.keys as Key[], key = keys.find((entry) => entry.id === id);
        if (!key) continue;
        key.tangentMode = mode;
        if (mode === "aligned" && key.leftHandle && key.rightHandle && key.rightHandle.dt !== 0) key.leftHandle = handleOf(key.leftHandle.dt, (key.rightHandle.dv / key.rightHandle.dt) * key.leftHandle.dt);
        retangent(keys);
      }
    }
  });
}
/**
 * Moves one tangent handle of a scalar key. `dt` never passes the neighbouring key. A drag on an `auto` or `flat` key
 * makes it `aligned` (the other handle turns to stay collinear and keeps its reach in time); `breakTangent` makes it
 * `broken`, and the other handle stays where it is.
 */
export function moveHandle(doc: ProjectDocument, ctx: CommitContext, ref: KeyRef, side: "left" | "right", handle: Handle, options: { breakTangent?: boolean } = {}): Commit {
  return edit(doc, ctx, { commandType: "keyframe.curve", label: "Tangent" }, (draft) => {
    const element = editable(elementIn(draft, ref.elementId)), channel = channelOf(element, ref.path);
    if (!channel || !isScalar(channel)) return;
    const keys = channel.keys as Key[], index = keys.findIndex((key) => key.id === ref.keyId), key = keys[index];
    if (!key) return;
    const neighbour = side === "right" ? keys[index + 1] : keys[index - 1];
    if (!neighbour) return;
    const reach = Math.abs(neighbour.time - key.time), dt = Math.min(reach, Math.max(0, Math.round(Math.abs(handle.dt)))) * (side === "right" ? 1 : -1);
    const mode = options.breakTangent ? "broken" : key.tangentMode === "broken" ? "broken" : "aligned";
    key.tangentMode = mode;
    if (side === "right") { key.rightHandle = handleOf(dt, handle.dv); if (key.segmentToNext !== "bezier") key.segmentToNext = "bezier"; }
    else { key.leftHandle = handleOf(dt, handle.dv); if (neighbour.segmentToNext !== "bezier") neighbour.segmentToNext = "bezier"; }
    const other = side === "right" ? key.leftHandle : key.rightHandle;
    if (mode === "aligned" && other && dt !== 0) { const turned = handleOf(other.dt, (handle.dv / dt) * other.dt); if (side === "right") key.leftHandle = turned; else key.rightHandle = turned; }
    retangent(keys);
  });
}
/** "Before first key" / "After last key": Hold or Linear. */
export function setExtrapolation(doc: ProjectDocument, ctx: CommitContext, elementId: string, path: string, change: { before?: "hold" | "linear"; after?: "hold" | "linear" }): Commit {
  return edit(doc, ctx, { commandType: "keyframe.curve", label: "Extrapolation" }, (draft) => {
    const element = editable(elementIn(draft, elementId));
    for (const stored of storedPaths(path)) {
      const channel = channelOf(element, stored);
      if (!channel) continue;
      for (const part of isColor(channel) ? ["r", "g", "b", "a"].map((name) => channel[name] as Json) : [channel]) if ("extrapolation" in part || isScalar(part)) part.extrapolation = { before: "hold", after: "hold", ...(isObject(part.extrapolation) ? part.extrapolation : {}), ...change };
    }
  });
}

// — Moving keys in time and value —
/**
 * Moves keys by one frame-rounded delta, each clamped to its element. A moved key that lands on the tick of a key
 * that is not moving replaces it. Returns the applied times through the commit's document.
 */
export function moveKeys(doc: ProjectDocument, ctx: CommitContext, refs: KeyRef[], delta: number): Commit {
  return edit(doc, ctx, { commandType: "keyframe.retime", label: refs.length > 1 ? "Move keyframes" : "Move keyframe" }, (draft) => {
    const fps = draft.settings.fps as Rational, shift = snapToFrame(Math.abs(delta), fps) * Math.sign(delta);
    for (const elementId of new Set(refs.map((ref) => ref.elementId))) {
      const element = editable(elementIn(draft, elementId)), duration = durationOf(element);
      const mine = refs.filter((ref) => ref.elementId === elementId);
      for (const path of new Set(mine.flatMap((ref) => storedPaths(ref.path)))) {
        const channel = channelOf(element, path);
        if (!channel) continue;
        const moving = new Set(mine.filter((ref) => storedPaths(ref.path).includes(path)).map((ref) => sameTickId(element, ref, path)));
        setParts(channel, (keys) => {
          const moved = keys.filter((key) => moving.has(key.id)).map((key) => ({ ...key, time: Math.min(duration, Math.max(0, key.time + shift)) }) as Key);
          const taken = new Set(moved.map((key) => key.time));
          // Two moved keys clamped onto one tick keep the later one in original order.
          const unique = new Map<number, Key>(); for (const key of moved) unique.set(key.time, key);
          const next = [...keys.filter((key) => !moving.has(key.id) && !taken.has(key.time)), ...unique.values()].sort((a, b) => a.time - b.time);
          if (typeof next[0]?.value === "number") retangent(next);
          return next;
        });
      }
    }
  });
}
/** Sets the value of a scalar key, clamped to the parameter's range. */
export function setKeyValue(doc: ProjectDocument, ctx: CommitContext, ref: KeyRef, value: number, time?: number): Commit {
  return edit(doc, ctx, { commandType: "keyframe.upsert", label: "Keyframe value" }, (draft) => {
    const element = editable(elementIn(draft, ref.elementId)), channel = channelOf(element, ref.path);
    if (!channel || !isScalar(channel)) return;
    const keys = channel.keys as Key[], key = keys.find((entry) => entry.id === ref.keyId);
    if (!key) return;
    const range = animatablePath(element as never, ref.path)?.range;
    key.value = range ? Math.min(range.max, Math.max(range.min, value)) : value;
    if (time !== undefined) {
      const target = keyTime(element, time, draft.settings.fps as Rational);
      if (!keys.some((entry) => entry !== key && entry.time === target)) { key.time = target; keys.sort((a, b) => a.time - b.time); }
    }
    retangent(keys);
  });
}
/** Inserts a key on a scalar curve at a local time, holding the curve's value there. */
export function insertKeyOnCurve(doc: ProjectDocument, ctx: CommitContext, elementId: string, path: string, local: number): Commit {
  const element = elementIn(doc, elementId).element as unknown as Json, time = keyTime(element, local, doc.settings.fps as Rational);
  return setKeyframe(doc, ctx, elementId, path, { time, value: resolvedValue(element, path, time) as number });
}

// — Clipboard —
export type CopiedKey = { path: string; time: number; value: unknown; segmentToNext?: string; tangentMode?: string; leftHandle?: Handle; rightHandle?: Handle; easing?: Bezier; entry?: { collection: "effects" | "masks"; type: string; index: number; key: string } };
export type KeyframeClipboard = { sourceElement: string; items: CopiedKey[] };
/** The entry of a collection a path passes through, as "the n-th entry of that type". */
function entryOf(element: Json, path: string): CopiedKey["entry"] | undefined {
  const parts = path.split(".");
  if ((parts[0] !== "effects" && parts[0] !== "masks") || parts.length !== 4) return undefined;
  const list = (element[parts[0]] as Json[] | undefined) ?? [], entry = list.find((candidate) => candidate.id === parts[1]);
  if (!entry) return undefined;
  return { collection: parts[0], type: String(entry.type), index: list.filter((candidate) => candidate.type === entry.type).indexOf(entry), key: parts[3] };
}
/** The clipboard payload of a keyframe selection. Keys of several elements copy the first element's. */
export function copyKeys(doc: ProjectDocument, refs: KeyRef[]): KeyframeClipboard | null {
  if (refs.length === 0) return null;
  const elementId = refs[0].elementId, element = elementIn(doc, elementId).element as unknown as Json;
  const items: CopiedKey[] = [];
  for (const ref of refs.filter((entry) => entry.elementId === elementId)) {
    for (const path of storedPaths(ref.path)) {
      const channel = channelOf(element, path), id = sameTickId(element, ref, path);
      if (!channel) continue;
      const key = partsOf(channel)[0].find((entry) => entry.id === id);
      if (!key) continue;
      const value = isColor(channel) ? linearToHex(Object.fromEntries(["r", "g", "b", "a"].map((part) => [part, ((channel[part] as Json).keys as Key[]).find((entry) => entry.id === id)?.value ?? 0])) as never) : key.value;
      items.push({ path, time: key.time, value: JSON.parse(JSON.stringify(value)), segmentToNext: key.segmentToNext, tangentMode: key.tangentMode, leftHandle: isColor(channel) ? undefined : key.leftHandle, rightHandle: isColor(channel) ? undefined : key.rightHandle, easing: key.easing, entry: entryOf(element, path) });
    }
  }
  return items.length > 0 ? { sourceElement: elementId, items: items.sort((a, b) => a.time - b.time) } : null;
}
/**
 * Pastes copied keys onto every target at `playhead − target.startTime` (clamped to the target): the earliest copied
 * key lands on that anchor and the others keep their offsets. Keys past the target's end, paths the target does not
 * animate, entries it has no counterpart for and keys beyond the limit are skipped and counted.
 */
export function pasteKeys(doc: ProjectDocument, ctx: CommitContext, clipboard: KeyframeClipboard, targetIds: string[], playhead: number): { commit: Commit | null; pasted: KeyRef[]; skipped: number } {
  const pasted: KeyRef[] = [];
  let skipped = 0;
  const targets = targetIds.length > 0 ? targetIds : [clipboard.sourceElement];
  const first = Math.min(...clipboard.items.map((item) => item.time));
  const commit = edit(doc, ctx, { commandType: "keyframe.paste", label: "Paste keyframes" }, (draft) => {
    const fps = draft.settings.fps as Rational;
    for (const targetId of targets) {
      const ref = elementIn(draft, targetId), element = editable(ref), duration = durationOf(element);
      const anchor = snapToFrame(Math.min(duration, Math.max(0, playhead - Number(element.startTime))), fps);
      for (const item of clipboard.items) {
        const time = anchor + (item.time - first);
        let path = item.path;
        if (item.entry) {
          const entry = ((element[item.entry.collection] as Json[] | undefined) ?? []).filter((candidate) => candidate.type === item.entry!.type)[item.entry.index];
          if (!entry) { skipped++; continue; }
          path = `${item.entry.collection}.${String(entry.id)}.params.${item.entry.key}`;
        }
        const target = animatablePath(element as never, path);
        if (time > duration || !target) { skipped++; continue; }
        if (keysOfPath(element, path).length >= KEY_LIMIT && !keysOfPath(element, path).some((key) => key.time === time)) { skipped++; continue; }
        if (target.shape === "path") {
          const mask = ((element.masks as Json[] | undefined) ?? []).find((candidate) => candidate.id === path.split(".")[1]);
          const have = (((mask?.params as Json | undefined)?.path ?? []) as Json[]).map((point) => point.id).join("|"), want = (((item.value as Json).points ?? []) as Json[]).map((point) => point.id).join("|");
          if (have !== want) { skipped++; continue; }
          const animations = (isObject(element.animations) ? element.animations : (element.animations = {})) as Json;
          const channel = (animations[path] ?? (animations[path] = { keys: [] })) as Json, keys = channel.keys as Key[];
          const id = keys.find((key) => key.time === time)?.id ?? ctx.newId();
          channel.keys = [...keys.filter((key) => key.time !== time), { id, time, value: item.value, segmentToNext: item.segmentToNext ?? "linear", ...(item.easing ? { easing: item.easing } : {}) }].sort((a, b) => (a.time as number) - (b.time as number));
          pasted.push({ elementId: targetId, path, keyId: id });
          continue;
        }
        const id = writeKey(element, ref.elementPath, path, { time, value: item.value as number, segmentToNext: item.segmentToNext }, ctx.newId);
        const channel = channelOf(element, path)!;
        if (isScalar(channel)) {
          const key = (channel.keys as Key[]).find((entry) => entry.id === id)!;
          key.tangentMode = item.tangentMode ?? "auto";
          if (item.leftHandle) key.leftHandle = { ...item.leftHandle };
          if (item.rightHandle) key.rightHandle = { ...item.rightHandle };
          retangent(channel.keys as Key[]);
        }
        pasted.push({ elementId: targetId, path, keyId: id });
      }
    }
  });
  return { commit: pasted.length > 0 ? commit : null, pasted, skipped };
}

// — Selection of keys —
/** Every key of an element as references in time-then-path order (paths in lane order). */
export function orderedKeys(element: Json): (KeyRef & { time: number })[] {
  const paths = lanePaths(element);
  return paths.flatMap((path, lane) => keysOfPath(element, path).map((key) => ({ elementId: String(element.id), path, keyId: key.id, time: key.time, lane }))).sort((a, b) => a.time - b.time || a.lane - b.lane).map(({ lane: _lane, ...ref }) => ref);
}
const sameRef = (a: KeyRef, b: KeyRef): boolean => a.elementId === b.elementId && a.path === b.path && a.keyId === b.keyId;
/** Click selection of a keyframe: plain selects only it, Mod toggles it, Shift selects the range from the anchor, Shift+Mod adds that range. */
export function clickKeySelection(element: Json, selected: KeyRef[], anchor: KeyRef | undefined, clicked: KeyRef, modifiers: { mod?: boolean; shift?: boolean }): { keys: KeyRef[]; anchor: KeyRef } {
  if (modifiers.shift && anchor && anchor.elementId === clicked.elementId) {
    const all = orderedKeys(element), from = all.findIndex((key) => sameRef(key, anchor)), to = all.findIndex((key) => sameRef(key, clicked));
    if (from >= 0 && to >= 0) {
      const range = all.slice(Math.min(from, to), Math.max(from, to) + 1).map(({ time: _time, ...ref }) => ref);
      return { keys: modifiers.mod ? [...selected, ...range.filter((key) => !selected.some((entry) => sameRef(entry, key)))] : range, anchor };
    }
  }
  if (modifiers.mod) return { keys: selected.some((key) => sameRef(key, clicked)) ? selected.filter((key) => !sameRef(key, clicked)) : [...selected, clicked], anchor: clicked };
  return { keys: [clicked], anchor: clicked };
}
/** Keys whose hit box (`hit` px across) meets a rectangle of lane space; lanes are `laneHeight` tall from `top`. */
export function boxKeySelection(element: Json, rect: { x1: number; x2: number; y1: number; y2: number }, geometry: { pixelsPerTick: number; top: number; laneHeight: number; hit?: number }, base: KeyRef[] = []): KeyRef[] {
  const half = (geometry.hit ?? 14) / 2, [left, right, up, down] = [Math.min(rect.x1, rect.x2), Math.max(rect.x1, rect.x2), Math.min(rect.y1, rect.y2), Math.max(rect.y1, rect.y2)];
  const found = lanePaths(element).flatMap((path, lane) => keysOfPath(element, path).filter((key) => {
    const x = (Number(element.startTime) + key.time) * geometry.pixelsPerTick, y = geometry.top + lane * geometry.laneHeight + geometry.laneHeight / 2;
    return x + half >= left && x - half <= right && y + half >= up && y - half <= down;
  }).map((key) => ({ elementId: String(element.id), path, keyId: key.id })));
  return [...base, ...found.filter((key) => !base.some((entry) => sameRef(entry, key)))];
}
/**
 * The snapped delta of a keyframe drag: the anchor key lands on a target within `threshold` ticks; keys of the
 * moving selection are never targets. `null` line: frame rounding only.
 */
export function snapKeyDrag(anchorTime: number, delta: number, targets: number[], threshold: number, enabled: boolean): { delta: number; line: number | null } {
  if (!enabled) return { delta, line: null };
  let best: number | null = null;
  for (const target of targets) if (Math.abs(target - (anchorTime + delta)) <= threshold && (best === null || Math.abs(target - (anchorTime + delta)) < Math.abs(best - (anchorTime + delta)))) best = target;
  return best === null ? { delta, line: null } : { delta: best - anchorTime, line: best };
}
export { hexToLinear };
