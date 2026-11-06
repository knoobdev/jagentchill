import { ELEMENT_VARIANTS, type ProjectDocument } from "@jagentchill/protocol";
import type { z } from "zod";
import { findAsset, isObject, type Json } from "../model.ts";
import { followDuration, isUnknownElement, keepKeysOf } from "../ops/shared.ts";
import { frameTicks, roundHalfAway, snapToFrame } from "../time.ts";
import type { TimelineCommand } from "./command.ts";
import { windowAnimations } from "./keyframes.ts";
import { fpsOf, locate, refuse, rejectDoc, sceneById, tracksOfScene, type El } from "./model.ts";

/** Which library assets may replace an element's media: video↔image for visual clips, audio only for audio. */
export const canReplaceWith = (element: { type: string }, asset: { type: string }): boolean =>
  element.type === "audio" ? asset.type === "audio" : (element.type === "video" || element.type === "image") && (asset.type === "video" || asset.type === "image");
/** An Alt/Option drop of an asset on a clip replaces its media when compatible; otherwise it is a normal insert. */
export const dropOnElementDecision = (element: { type: string }, asset: { type: string }, altKey: boolean): "replace" | "insert" => (altKey && canReplaceWith(element, asset) ? "replace" : "insert");

/**
 * Swaps the source of an element and preserves its in-point and out-point: with `D` the new source's duration and
 * `need` the source span the element consumes at its retime, `trimStart` is kept when `trimStart + need ≤ D`,
 * otherwise clamped to `max(0, D − need)`; when `D < need` the element is shortened to what `D` provides.
 * Returns whether the clamp changed `trimStart` or the duration ("Trim adjusted").
 */
function swapSource(draft: ProjectDocument, element: El, assetId: string, newId: () => string, replaceInTrack: (next: El) => void): boolean {
  const asset = findAsset(draft, assetId) ?? rejectDoc("document/unknown-asset", "", `asset "${assetId}" does not exist`);
  if (isUnknownElement(element)) rejectDoc("document/wrong-type", "", "Needs newer app: this content is kept unchanged and is not edited by this version");
  if (!canReplaceWith(element, asset)) refuse("This media cannot replace the clip", "incompatible");
  const fps = fpsOf(draft), before = { trimStart: element.trimStart, duration: element.duration };
  element.mediaId = assetId;
  if (asset.type === "image") {
    // An image has no source span: retime and sound go, the timing stays.
    if (element.type !== "image") { element.type = "image"; keepKeysOf(element, "image"); }
    element.trimStart = 0; element.trimEnd = 0;
  } else {
    if (asset.type === "video" && element.type === "image") { element.type = "video"; keepKeysOf(element, "video"); }
    const D = asset.duration ?? rejectDoc("document/asset-type-mismatch", "", `asset "${assetId}" has no duration`);
    const rate = isObject(element.retime) && typeof element.retime.rate === "number" ? element.retime.rate : 1;
    let need = roundHalfAway(element.duration * rate);
    if (D < need) {
      const frame = frameTicks(fps);
      let duration = Math.max(frame, snapToFrame(D / rate, fps));
      while (duration > frame && roundHalfAway(duration * rate) > D) duration -= frame;
      windowAnimations(element, 0, duration, newId);
      element.duration = duration;
      need = Math.min(D, roundHalfAway(duration * rate));
    }
    element.trimStart = element.trimStart + need <= D ? element.trimStart : Math.max(0, D - need);
    element.sourceDuration = D;
    element.trimEnd = Math.max(0, D - element.trimStart - need);
    followDuration(element);
  }
  replaceInTrack((ELEMENT_VARIANTS[element.type as "video"] as z.ZodTypeAny).parse(element) as El);
  return element.trimStart !== before.trimStart || element.duration !== before.duration;
}
const swapIn = (draft: ProjectDocument, elementId: string, assetId: string, newId: () => string): { element: El; trimAdjusted: boolean } => {
  const hit = locate(draft, elementId) ?? rejectDoc("document/unknown-reference", "", `element "${elementId}" does not exist`);
  if (hit.track.locked) refuse("The track is locked", "track-locked");
  let stored = hit.element;
  const trimAdjusted = swapSource(draft, hit.element, assetId, newId, (next) => { hit.track.elements[hit.track.elements.indexOf(hit.element)] = next; stored = next; });
  return { element: stored, trimAdjusted };
};

/**
 * "Replace media" by the user: keeps timing, transform, crop, background, effects, masks, adjustments, animations,
 * transitions, speed and track; removes `filmLink` and `workflowLink` and keeps `scriptLink`.
 */
export const replaceMedia = (options: { elementId: string; assetId: string }): TimelineCommand<{ trimAdjusted: boolean }> => ({
  type: "timeline.replace-media", label: "Replace media",
  run(draft, env) {
    const { element, trimAdjusted } = swapIn(draft, options.elementId, options.assetId, env.newId);
    delete element.filmLink; delete element.workflowLink;
    return { info: { trimAdjusted } };
  },
});
/**
 * `ReplaceElementSource {elementId, mediaId, link}`: a producer (film studio, workflow, script studio) updates a
 * linked element. One undo step labelled with the producer's name; `trimAdjusted` is the transient session flag.
 */
export const replaceElementSource = (options: { elementId: string; mediaId: string; link?: { filmLink?: unknown; workflowLink?: unknown; scriptLink?: unknown }; producer: string }): TimelineCommand<{ trimAdjusted: boolean }> => ({
  type: "timeline.replace-element-source", label: options.producer,
  run(draft, env) {
    const { element, trimAdjusted } = swapIn(draft, options.elementId, options.mediaId, env.newId);
    for (const [key, value] of Object.entries(options.link ?? {})) if (value !== undefined) element[key] = value;
    return { info: { trimAdjusted } };
  },
});

export const PROVENANCE_FIELDS = ["filmLink", "workflowLink", "scriptLink"] as const;
export const hasProvenance = (element: Record<string, unknown>): boolean => PROVENANCE_FIELDS.some((field) => element[field] !== undefined);
/** "Unlink" (source): removes the three provenance fields from the selected elements and changes nothing else. */
export const unlinkSource = (options: { sceneId: string; elementIds: string[] }): TimelineCommand => ({
  type: "timeline.unlink-source", label: "Unlink", sceneId: options.sceneId,
  run(draft) {
    for (const track of tracksOfScene(sceneById(draft, options.sceneId))) for (const element of track.elements) {
      if (options.elementIds.includes(element.id) && !track.locked) for (const field of PROVENANCE_FIELDS) delete element[field];
    }
  },
});
/**
 * The provenance chips of an element — "From film · Panel {n}", "From workflow · {step}", "From script · Shot {n}" —
 * shown on a clip at least 64 px wide. The producer supplies the label of a reachable target; without one the chip
 * reads "Source no longer available".
 */
export function provenanceChips(element: Record<string, unknown>, resolve: (kind: "film" | "workflow" | "script", link: Json) => string | undefined, clipWidthPx = Infinity): { kind: "film" | "workflow" | "script"; text: string; available: boolean }[] {
  if (clipWidthPx < 64) return [];
  const chips: { kind: "film" | "workflow" | "script"; text: string; available: boolean }[] = [];
  for (const [field, kind, prefix] of [["filmLink", "film", "From film · "], ["workflowLink", "workflow", "From workflow · "], ["scriptLink", "script", "From script · "]] as const) {
    if (!isObject(element[field])) continue;
    const label = resolve(kind, element[field]);
    chips.push({ kind, text: label === undefined ? "Source no longer available" : `${prefix}${label}`, available: label !== undefined });
  }
  return chips;
}
