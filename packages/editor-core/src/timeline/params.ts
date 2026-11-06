import { BLEND_MODES, type ProjectDocument } from "@jagentchill/protocol";
import { isObject, type Json } from "../model.ts";
import { isUnknownElement } from "../ops/shared.ts";
import type { TimelineCommand } from "./command.ts";
import { locate, refuse, rejectDoc } from "./model.ts";

export type ParamType = "number" | "boolean" | "color" | "select" | "text" | "font";
export type ElementParamDefinition = {
  key: string; type: ParamType; default: number | boolean | string;
  min?: number; max?: number; step?: number; displayMultiplier?: number; unit?: string; options?: readonly string[]; group?: string; keyframable?: boolean; dependencies?: readonly string[];
};
/** Element kinds of the registry; an effect or a graphic definition registers under `effect:<type>` / `graphic:<definitionId>`. */
export type ParamKind = "visual" | "audio" | "text" | "mask" | `effect:${string}` | `graphic:${string}`;

/**
 * The one registry of parameter definitions per element kind. Definition values are owned by the feature specs, which
 * register them here; every command that writes a parameter coerces through it, whatever triggered the write.
 */
export function createParamRegistry(initial: Partial<Record<ParamKind, ElementParamDefinition[]>> = {}) {
  const kinds = new Map<string, Map<string, ElementParamDefinition>>();
  const registry = {
    register(kind: ParamKind, definitions: ElementParamDefinition[]): void {
      const map = kinds.get(kind) ?? new Map<string, ElementParamDefinition>();
      for (const definition of definitions) map.set(definition.key, definition);
      kinds.set(kind, map);
    },
    get: (kind: ParamKind, key: string): ElementParamDefinition | undefined => kinds.get(kind)?.get(key),
    list: (kind: ParamKind): ElementParamDefinition[] => [...(kinds.get(kind)?.values() ?? [])],
  };
  for (const [kind, definitions] of Object.entries(initial)) registry.register(kind as ParamKind, definitions ?? []);
  return registry;
}
export type ParamRegistry = ReturnType<typeof createParamRegistry>;

/** A parameter write that did not pass the registry. Nothing changed and no history entry exists. */
export class ParamRejected extends Error {
  readonly key: string;
  constructor(key: string, message: string) { super(message); this.name = "ParamRejected"; this.key = key; }
}
const COLOR = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
/** Coerces one value by its definition: a number is snapped to the nearest step, then clamped; every other type must already be valid. */
export function coerceParam(definition: ElementParamDefinition, value: unknown): number | boolean | string {
  const fail = (message: string): never => { throw new ParamRejected(definition.key, `${definition.key}: ${message}`); };
  switch (definition.type) {
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return fail("a number is required");
      const base = definition.min ?? 0;
      let next = definition.step ? base + Math.round((value - base) / definition.step) * definition.step : value;
      if (definition.step) next = Math.round(next * 1e9) / 1e9;
      return Math.min(definition.max ?? Infinity, Math.max(definition.min ?? -Infinity, next));
    }
    case "boolean": return typeof value === "boolean" ? value : fail("a boolean is required");
    case "color": return typeof value === "string" && COLOR.test(value) ? value.toLowerCase() : fail("a colour is #RRGGBB or #RRGGBBAA");
    case "select": return typeof value === "string" && (definition.options ?? []).includes(value) ? value : fail(`"${String(value)}" is not one of its options`);
    case "font": return typeof value === "string" && value.trim().length > 0 ? value : fail("a font is a non-empty family name");
    case "text": return typeof value === "string" ? value : fail("text is required");
  }
}
/** Coerces a write by key; a key that is not registered for the kind fails and is reported by name. */
export function coerceParamWrite(registry: ParamRegistry, kind: ParamKind, key: string, value: unknown): number | boolean | string {
  const definition = registry.get(kind, key);
  if (!definition) throw new ParamRejected(key, `"${key}" is not a parameter of ${kind} elements`);
  return coerceParam(definition, value);
}
/** A stored value outside its range is clamped for evaluation only; the document is corrected the next time the parameter is written. */
export const evaluateParam = (definition: ElementParamDefinition, stored: unknown): number | boolean | string => {
  try { return coerceParam(definition, stored); } catch { return definition.default; }
};
/** The registry kinds an element's parameters belong to, most specific first. */
export function paramKindsOf(element: { type: string; definitionId?: unknown }): ParamKind[] {
  if (element.type === "audio") return ["audio"];
  if (element.type === "text") return ["text", "visual"];
  if (element.type === "graphic") return [`graphic:${String(element.definitionId)}`, "visual"];
  if (element.type === "video" || element.type === "compound") return ["visual", "audio"];
  return ["visual"];
}

/**
 * Writes parameters of elements through the registry. The key is the stored dotted path (`opacity`,
 * `transform.position.x`, `effects.<id>.intensity`, `params.cornerRadius`). One failing write fails the whole command.
 */
export const setParams = (options: { registry: ParamRegistry; writes: { elementId: string; key: string; value: unknown }[]; label?: string; coalesce?: string }): TimelineCommand => ({
  type: "timeline.param.set", label: options.label ?? "Edit", coalesce: options.coalesce,
  run(draft) {
    for (const write of options.writes) {
      const hit = locate(draft, write.elementId) ?? rejectDoc("document/unknown-reference", "", `element "${write.elementId}" does not exist`);
      if (hit.track.locked) refuse("The track is locked", "track-locked");
      if (isUnknownElement(hit.element)) rejectDoc("document/wrong-type", "", "Needs newer app: this content is kept unchanged and is not edited by this version");
      const parts = write.key.split(".");
      let kinds = paramKindsOf(hit.element), key = write.key, target = hit.element as Json, leaf = parts[parts.length - 1];
      if ((parts[0] === "effects" || parts[0] === "masks") && parts.length === 3) {
        const entry = ((hit.element[parts[0]] as Json[] | undefined) ?? []).find((candidate) => candidate.id === parts[1]) ?? rejectDoc("document/unknown-reference", "", `${parts[0]} entry "${parts[1]}" does not exist`);
        kinds = parts[0] === "effects" ? [`effect:${String(entry.type)}`] : ["mask"];
        key = parts[2]; leaf = parts[2];
        target = parts[0] === "effects" ? (entry.params as Json) : entry;
      } else {
        if (parts[0] === "params") key = parts.slice(1).join(".");
        for (const part of parts.slice(0, -1)) target = (isObject(target[part]) ? target[part] : (target[part] = {})) as Json;
      }
      const kind = kinds.find((candidate) => options.registry.get(candidate, key)) ?? kinds[0];
      target[leaf] = coerceParamWrite(options.registry, kind, key, write.value);
    }
  },
});
/** The shared value of a property over a multi-selection: the value when all agree, "Mixed" otherwise. */
export function sharedValue(doc: ProjectDocument, elementIds: string[], path: string): { mixed: boolean; value?: unknown; elementIds: string[] } {
  const values: unknown[] = [], having: string[] = [];
  for (const id of elementIds) {
    let target: unknown = locate(doc, id)?.element;
    for (const part of path.split(".")) target = isObject(target) ? target[part] : undefined;
    if (target !== undefined) { values.push(target); having.push(id); }
  }
  const mixed = values.some((value) => JSON.stringify(value) !== JSON.stringify(values[0]));
  return { mixed, ...(mixed || values.length === 0 ? {} : { value: values[0] }), elementIds: having };
}
/** The definitions `editor-core` itself knows for the common visual fields; feature specs register the rest. */
export const CORE_VISUAL_PARAMS: ElementParamDefinition[] = [
  { key: "opacity", type: "number", default: 1, min: 0, max: 1, step: 0.01, displayMultiplier: 100, unit: "%", keyframable: true, group: "blend" },
  { key: "blendMode", type: "select", default: "normal", options: BLEND_MODES, group: "blend" },
];
/** The inspector shows a stored value multiplied by `displayMultiplier` (opacity 0–1 as 0–100 %); a typed value goes back through it. */
export const displayToStored = (definition: ElementParamDefinition, shown: number): number => shown / (definition.displayMultiplier ?? 1);
export const storedToDisplay = (definition: ElementParamDefinition, stored: number): number => Math.round(stored * (definition.displayMultiplier ?? 1) * 1e6) / 1e6;
