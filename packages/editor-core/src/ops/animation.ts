import { animatablePath, type ProjectDocument } from "@jagentchill/protocol";
import { isObject, type Json } from "../model.ts";
import { edit, editable, elementIn, reject, type Commit, type CommitContext } from "./shared.ts";

/** Tools and users say "hold"; the stored word is `step`. */
export const segmentType = (value: string | undefined): "step" | "linear" | "bezier" => (value === "hold" ? "step" : (value as "step" | "linear" | "bezier" | undefined) ?? "linear");

const srgbToLinear = (channel: number) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
/** `#rrggbb[aa]` → linear-light components 0–1, the form colour channels store. */
export function hexToLinear(hex: string): { r: number; g: number; b: number; a: number } {
  const byte = (index: number) => parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
  return { r: srgbToLinear(byte(0)), g: srgbToLinear(byte(1)), b: srgbToLinear(byte(2)), a: hex.length === 9 ? byte(3) : 1 };
}

function upsertScalar(channel: Json, key: Json): void {
  const keys = channel.keys as Json[];
  const existing = keys.find((entry) => entry.time === key.time);
  if (existing) Object.assign(existing, { value: key.value, segmentToNext: key.segmentToNext });
  else { keys.push(key); keys.sort((a, b) => (a.time as number) - (b.time as number)); }
}
const scalarChannel = (): Json => ({ keys: [], extrapolation: { before: "hold", after: "hold" } });

export type KeyInput = { time: number; value: number | string | boolean; segmentToNext?: string; id?: string };
/** Writes one key into the draft element and returns the key id; the path must be animatable on that element. */
export function writeKey(element: Json, elementPath: string, path: string, input: KeyInput, newId: () => string): string {
  const target = animatablePath(element as never, path) ?? reject("document/animation-path-invalid", `${elementPath}/animations/${path}`, `"${path}" is not an animatable path of this element`);
  const animations = (isObject(element.animations) ? element.animations : (element.animations = {})) as Json;
  const id = input.id ?? newId();
  const base = { id, time: input.time, segmentToNext: segmentType(input.segmentToNext), tangentMode: "auto" };
  const shape = target.shape ?? (typeof input.value === "number" ? "scalar" : "discrete");
  if (shape === "color") {
    const channel = (animations[path] ?? (animations[path] = { r: scalarChannel(), g: scalarChannel(), b: scalarChannel(), a: scalarChannel() })) as Json;
    const linear = hexToLinear(String(input.value));
    // The four components always share key ids and times.
    const shared = ((channel.r as Json).keys as Json[]).find((entry) => entry.time === input.time)?.id ?? id;
    for (const part of ["r", "g", "b", "a"] as const) upsertScalar(channel[part] as Json, { ...base, id: shared, value: linear[part] });
    return String(shared);
  }
  const channel = (animations[path] ?? (animations[path] = shape === "scalar" ? scalarChannel() : { keys: [] })) as Json;
  if (shape === "scalar") upsertScalar(channel, { ...base, value: input.value });
  else upsertScalar(channel, { id, time: input.time, value: input.value });
  return id;
}

/**
 * Adds or replaces a keyframe. `transform.scale` is the grouped property: the key is written to both stored channels
 * at the same tick with the same segment type.
 */
export function upsertKeyframe(doc: ProjectDocument, ctx: CommitContext, elementId: string, path: string, input: KeyInput): Commit {
  return edit(doc, ctx, { commandType: "keyframe.upsert", label: "Keyframe" }, (draft) => {
    const ref = elementIn(draft, elementId);
    const element = editable(ref);
    if (path === "transform.scale") {
      const scale = ((element.transform as Json | undefined)?.scale ?? { x: 1, y: 1 }) as { x: number; y: number };
      const value = typeof input.value === "number" ? { x: input.value, y: input.value } : scale;
      writeKey(element, ref.elementPath, "transform.scale.x", { ...input, value: value.x, id: undefined }, ctx.newId);
      writeKey(element, ref.elementPath, "transform.scale.y", { ...input, value: value.y, id: undefined }, ctx.newId);
    } else writeKey(element, ref.elementPath, path, input, ctx.newId);
  });
}

/** Removes a key by id. Removing the last key removes the path; the last path removes `animations`. */
export function removeKeyframe(doc: ProjectDocument, ctx: CommitContext, elementId: string, path: string, keyId: string): Commit {
  return edit(doc, ctx, { commandType: "keyframe.remove", label: "Remove keyframe" }, (draft) => {
    const element = editable(elementIn(draft, elementId));
    const channel = (element.animations as Json | undefined)?.[path] as Json | undefined;
    if (!isObject(channel)) return;
    const parts = "r" in channel ? ["r", "g", "b", "a"].map((part) => channel[part] as Json) : [channel];
    for (const part of parts) part.keys = (part.keys as Json[]).filter((key) => key.id !== keyId);
    // A key the user removed is no longer one a tool wrote.
    for (const owner of [element.aiMotion, element.autoReframe] as (Json | undefined)[]) if (isObject(owner) && Array.isArray(owner.keyIds)) owner.keyIds = owner.keyIds.filter((id) => id !== keyId);
  });
}

/**
 * Replaces the keys a tool wrote earlier (`owner.keyIds`) with a new set and records the new ids, leaving every key
 * the user authored in place. Used by AI movement and Auto reframe.
 */
export function replaceToolKeys(element: Json, elementPath: string, owner: Json, keys: { path: string; time: number; value: number }[], newId: () => string): void {
  const mine = new Set((Array.isArray(owner.keyIds) ? owner.keyIds : []) as string[]);
  for (const [path, channel] of Object.entries(isObject(element.animations) ? element.animations : {}) as [string, Json][]) {
    if (!Array.isArray(channel.keys)) continue;
    channel.keys = channel.keys.filter((key: Json) => !mine.has(String(key.id)));
    if ((channel.keys as Json[]).length === 0) delete (element.animations as Json)[path];
  }
  owner.keyIds = keys.map((key) => writeKey(element, elementPath, key.path, { time: key.time, value: key.value }, newId));
}
