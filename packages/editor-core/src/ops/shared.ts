import { ELEMENT_KEYS, ELEMENT_TYPES, type ProjectDocument, type TimelineElement, type Track } from "@jagentchill/protocol";
import { commitChange, type Commit, type CommitContext, type CommitMeta } from "../commit.ts";
import { documentError, DocumentRejected } from "../errors.ts";
import { clone, findElement, findTrack, isObject, tracksIn, type ElementRef, type Json } from "../model.ts";
import { compareIds } from "../patch.ts";

export type { Commit, CommitContext };
export const reject = (code: string, path: string, message: string, details?: Record<string, unknown>): never => {
  throw new DocumentRejected([documentError(code, path, message, details)]);
};
/** Runs one document command through the single commit pipeline. */
export const edit = (doc: ProjectDocument, ctx: CommitContext, meta: CommitMeta, mutate: (draft: ProjectDocument) => void): Commit => commitChange(doc, ctx, meta, mutate);

export function elementIn(draft: ProjectDocument, id: string): ElementRef {
  return findElement(draft, id) ?? reject("document/unknown-reference", "", `element "${id}" does not exist`);
}
export function trackIn(draft: ProjectDocument, id: string) {
  return findTrack(draft, id) ?? reject("document/unknown-reference", "", `track "${id}" does not exist`);
}
/** Elements of a type this build does not know are kept, shown locked ("Needs newer app") and accept only delete. */
export const isUnknownElement = (element: { type: string }): boolean => !(ELEMENT_TYPES as readonly string[]).includes(element.type);
export function editable(ref: ElementRef): Json {
  if (isUnknownElement(ref.element)) reject("document/wrong-type", ref.elementPath, "Needs newer app: this content is kept unchanged and is not edited by this version");
  return ref.element as unknown as Json;
}
export const sortElements = (track: Track): void => {
  (track.elements as TimelineElement[]).sort((a, b) => a.startTime - b.startTime || compareIds(a.id, b.id));
};

/** Removes the transition records of a track that no longer join two exactly adjacent elements, and clears both references. */
export function dropBrokenTransitions(track: Track): void {
  const elements = new Map((track.elements as TimelineElement[]).map((element) => [element.id, element as unknown as Json]));
  const kept = (track.transitions as unknown as Json[]).filter((record) => {
    const from = elements.get(String(record.fromElementId)), to = elements.get(String(record.toElementId));
    return from && to && (from.startTime as number) + (from.duration as number) === to.startTime;
  });
  const ids = new Set(kept.map((record) => record.id));
  (track as unknown as Json).transitions = kept;
  for (const element of elements.values()) {
    if ("transitionIn" in element && element.transitionIn !== null && !ids.has(element.transitionIn)) element.transitionIn = null;
    if ("transitionOut" in element && element.transitionOut !== null && !ids.has(element.transitionOut)) element.transitionOut = null;
  }
}

/** A combo clip animation that follows the duration is rewritten with it. */
export function followDuration(element: Json): void {
  const combo = (element.clipAnimation as Json | undefined)?.combo as Json | undefined;
  if (isObject(combo) && combo.followsDuration !== false) combo.duration = element.duration;
}

/**
 * A copy of an element for split, duplicate, paste and compound creation: new ids for the element, its effect
 * entries, masks and keyframes, and every reference inside the copy (animation paths through an effect or mask id)
 * rewritten to them. Keys this build does not know are copied as they are.
 */
export function copyElement(source: TimelineElement, newId: () => string): { element: Json; ids: Map<string, string> } {
  const element = clone(source) as unknown as Json;
  const ids = new Map<string, string>([[source.id, newId()]]);
  element.id = ids.get(source.id);
  for (const key of ["effects", "masks"]) {
    for (const entry of (Array.isArray(element[key]) ? element[key] : []) as Json[]) {
      const next = newId();
      ids.set(String(entry.id), next);
      entry.id = next;
    }
  }
  if (isObject(element.animations)) {
    const renamed: Json = {};
    for (const [path, channel] of Object.entries(element.animations)) {
      const parts = path.split(".");
      if ((parts[0] === "effects" || parts[0] === "masks") && ids.has(parts[1])) parts[1] = ids.get(parts[1])!;
      const fresh = new Map<string, string>();
      const rekey = (keys: unknown) => { for (const key of (Array.isArray(keys) ? keys : []) as Json[]) { if (!fresh.has(String(key.id))) fresh.set(String(key.id), newId()); key.id = fresh.get(String(key.id)); } };
      if (isObject(channel) && "r" in channel) for (const part of ["r", "g", "b", "a"]) rekey((channel[part] as Json | undefined)?.keys);
      else if (isObject(channel)) rekey(channel.keys);
      for (const [from, to] of fresh) ids.set(from, to);
      renamed[parts.join(".")] = channel;
    }
    element.animations = renamed;
  }
  for (const list of [(element.aiMotion as Json | undefined), (element.autoReframe as Json | undefined)]) {
    if (isObject(list) && Array.isArray(list.keyIds)) list.keyIds = list.keyIds.map((id) => ids.get(String(id)) ?? id);
  }
  return { element, ids };
}

/** Removes from an element every key its type does not carry; used when an element changes type. */
export function keepKeysOf(element: Json, type: keyof typeof ELEMENT_KEYS): void {
  const allowed = new Set(ELEMENT_KEYS[type]);
  const known = new Set(Object.values(ELEMENT_KEYS).flat());
  for (const key of Object.keys(element)) if (known.has(key) && !allowed.has(key)) delete element[key];
}

/** Every element of the scene that holds `ref`. */
export function sceneElements(ref: ElementRef): Json[] {
  const out: Json[] = [];
  for (const { track } of tracksIn(ref.scene, "")) out.push(...(track.elements as unknown as Json[]));
  return out;
}
