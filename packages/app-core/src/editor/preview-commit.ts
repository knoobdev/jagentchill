import { removeKeyframe, setElementFields, timeline, upsertKeyframe, type Commit, type CommitContext } from "@jagentchill/editor-core";
import type { ProjectDocument } from "@jagentchill/protocol";
import { RESET_KEYFRAME_PATHS, RESET_TRANSFORM, rotateQuarter } from "./preview-transform.ts";

export type TransformChange = { position?: { x: number; y: number }; scale?: { x: number; y: number }; rotation?: number; flip?: { horizontal: boolean; vertical: boolean } };
type Animations = Record<string, { keys?: { id: string; time: number }[] }>;
const PATHS = { "transform.position.x": (change: TransformChange) => change.position?.x, "transform.position.y": (change: TransformChange) => change.position?.y, "transform.scale.x": (change: TransformChange) => change.scale?.x, "transform.scale.y": (change: TransformChange) => change.scale?.y, "transform.rotation": (change: TransformChange) => change.rotation } as const;
export const hasKeyframes = (element: timeline.El, path: string): boolean => ((element.animations ?? {}) as Animations)[path] !== undefined;
/** The transform an element has in the document, with every default filled in. */
export function transformOf(element: timeline.El): { position: { x: number; y: number }; scale: { x: number; y: number }; rotation: number; flip: { horizontal: boolean; vertical: boolean } } {
  const stored = (element.transform ?? {}) as { position?: { x?: number; y?: number }; scale?: { x?: number; y?: number }; rotation?: number }, flip = (element.flip ?? {}) as { horizontal?: boolean; vertical?: boolean };
  return { position: { x: stored.position?.x ?? 0, y: stored.position?.y ?? 0 }, scale: { x: stored.scale?.x ?? 1, y: stored.scale?.y ?? 1 }, rotation: stored.rotation ?? 0, flip: { horizontal: flip.horizontal === true, vertical: flip.vertical === true } };
}
/** One commit out of several of another family: each applied to the result of the one before. */
export function chainCommits(doc: ProjectDocument, ctx: CommitContext, label: string, commandType: string, steps: ((doc: ProjectDocument, ctx: CommitContext) => Commit | null)[]): Commit | null {
  let current = doc, last: Commit | null = null;
  const patch: Commit["patch"] = [];
  for (const step of steps) { const made = step(current, ctx); if (!made) continue; last = made; current = made.document; patch.push(...made.patch); }
  return last ? { ...last, document: current, patch, label, commandType } : null;
}
/**
 * Writes a transform change of one element. A property that has keyframes gets a keyframe at the playhead — the
 * other keys stay as they are — and a property without them gets its base value. A scale is stored positive.
 */
export function commitTransform(doc: ProjectDocument, ctx: CommitContext, elementId: string, playhead: number, change: TransformChange, label = "Transform"): Commit | null {
  const found = timeline.locate(doc, elementId);
  if (!found) return null;
  const element = found.element, current = transformOf(element), local = Math.max(0, playhead - element.startTime);
  const next = { position: change.position ?? current.position, scale: change.scale ? { x: Math.abs(change.scale.x), y: Math.abs(change.scale.y) } : current.scale, rotation: change.rotation ?? current.rotation };
  const steps: ((doc: ProjectDocument, ctx: CommitContext) => Commit | null)[] = [];
  const base = { ...next, position: { ...next.position }, scale: { ...next.scale } };
  for (const [path, read] of Object.entries(PATHS)) {
    const value = read({ ...change, scale: change.scale ? next.scale : undefined });
    if (value === undefined || !hasKeyframes(element, path)) continue;
    steps.push((before, context) => upsertKeyframe(before, context, elementId, path, { time: local, value }));
    // The base value of a keyframed property is left as stored.
    const [, group, axis] = path.split(".");
    if (group === "rotation") base.rotation = current.rotation; else (base[group as "position" | "scale"] as Record<string, number>)[axis] = (current[group as "position" | "scale"] as Record<string, number>)[axis];
  }
  steps.unshift((before, context) => setElementFields(before, context, elementId, { transform: base, ...(change.flip ? { flip: change.flip } : {}) }, { commandType: "element.transform", label }));
  return chainCommits(doc, ctx, label, "element.transform", steps);
}
/** "Reset transform" on every given element as one step: position, scale, rotation and flips; their keyframes are removed; crop stays. */
export function resetTransforms(doc: ProjectDocument, ctx: CommitContext, elementIds: string[]): Commit | null {
  return chainCommits(doc, ctx, "Reset transform", "element.reset-transform", elementIds.flatMap((elementId) => {
    const element = timeline.locate(doc, elementId)?.element;
    if (!element || !timeline.isVisual(element)) return [];
    const keys = RESET_KEYFRAME_PATHS.flatMap((path) => (((element.animations ?? {}) as Animations)[path]?.keys ?? []).map((key) => ({ path, keyId: key.id })));
    return [
      ...keys.map(({ path, keyId }) => (before: ProjectDocument, context: CommitContext) => removeKeyframe(before, context, elementId, path, keyId)),
      (before: ProjectDocument, context: CommitContext) => setElementFields(before, context, elementId, { transform: RESET_TRANSFORM.transform, flip: RESET_TRANSFORM.flip }, { commandType: "element.reset-transform", label: "Reset transform" }),
    ];
  }));
}
/** "Rotate 90°" on every given visual element as one step; a keyframed rotation gets a key at the playhead with `current + 90`. */
export function rotateQuarterTurn(doc: ProjectDocument, ctx: CommitContext, elementIds: string[], playhead: number, valueAt: (element: timeline.El) => number = (element) => transformOf(element).rotation): Commit | null {
  return chainCommits(doc, ctx, "Rotate 90°", "element.rotate-90", elementIds.flatMap((elementId) => {
    const element = timeline.locate(doc, elementId)?.element;
    if (!element || !timeline.isVisual(element)) return [];
    const keyed = hasKeyframes(element, "transform.rotation");
    return [(before: ProjectDocument, context: CommitContext) => commitTransform(before, context, elementId, playhead, { rotation: rotateQuarter(valueAt(element), keyed) }, "Rotate 90°")];
  }));
}
/** Moves every given visual element by the same canvas delta, as one step. */
export function moveElements(doc: ProjectDocument, ctx: CommitContext, elementIds: string[], playhead: number, delta: { x: number; y: number }, start?: Map<string, { x: number; y: number }>): Commit | null {
  return chainCommits(doc, ctx, "Move", "element.transform", elementIds.flatMap((elementId) => {
    const element = timeline.locate(doc, elementId)?.element;
    if (!element || !timeline.isVisual(element)) return [];
    const from = start?.get(elementId) ?? transformOf(element).position;
    return [(before: ProjectDocument, context: CommitContext) => commitTransform(before, context, elementId, playhead, { position: { x: Math.round((from.x + delta.x) * 100) / 100, y: Math.round((from.y + delta.y) * 100) / 100 } }, "Move")];
  }));
}
