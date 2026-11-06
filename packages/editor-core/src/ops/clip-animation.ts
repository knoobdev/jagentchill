import { CLIP_ANIMATION_ROWS, type ClipAnimationRow } from "@jagentchill/content";
import type { ProjectDocument, Rational } from "@jagentchill/protocol";
import { isObject, type Json } from "../model.ts";
import { frameToTicks } from "../time.ts";
import { floorToFrame, roundToFrame } from "../time/index.ts";
import { refuse } from "../timeline/model.ts";
import { edit, editable, elementIn, type Commit, type CommitContext } from "./shared.ts";

/**
 * `keyframe-animation.Clip animation model` and `visual-effects-filters.Motion blur` as commands: the In, Out and
 * Combo slots of a picture element, and its motion blur. A clip animation never writes keyframes.
 */

export type ClipAnimationGroup = "in" | "out" | "combo";
export const CLIP_ANIMATION_GROUPS: readonly ClipAnimationGroup[] = ["in", "out", "combo"];
const ANIMATED_TYPES = ["video", "image", "sticker", "graphic", "compound"];
/** Video, image, sticker, graphic and compound elements carry clip animations; text has its own. */
export const isClipAnimatable = (element: { type: string }): boolean => ANIMATED_TYPES.includes(element.type);
/** The bundled animations of a group, in catalogue order. */
export const clipAnimationsOf = (group: ClipAnimationGroup): readonly ClipAnimationRow[] => CLIP_ANIMATION_ROWS.filter((row) => row.group === group);

const TENTH = 12_000, HALF = 60_000, FIVE = 600_000;
export type ClipAnimationSlot = { type: string; duration?: number; strength?: number } | null;
type Stored = { in?: Json; out?: Json; combo?: Json };
const slotsOf = (element: Json): Stored => (isObject(element.clipAnimation) ? (element.clipAnimation as Stored) : {});
const frame = (ticks: number, fps: Rational, down = false): number => { try { return down ? floorToFrame(ticks, fps) : roundToFrame(ticks, fps); } catch { return Math.round(ticks); } };
/** The shortest duration of a slot: 0.1 s, or the first frame boundary after it. */
const tenth = (fps: Rational): number => frameToTicks(Math.ceil((TENTH * fps.numerator) / (120_000 * fps.denominator) - 1e-9), fps);
const percent = (value: number | undefined): number => Math.min(100, Math.max(0, Math.round(value ?? 100)));

/**
 * The longest an In or Out may last on an element: the smaller of 5 s and what the other slot leaves of the element.
 * A Combo may last as long as the element.
 */
export function clipAnimationLimit(element: { duration: number; clipAnimation?: unknown }, group: ClipAnimationGroup): number {
  const duration = Number(element.duration), slots = slotsOf(element as Json);
  if (group === "combo") return duration;
  const other = slots[group === "in" ? "out" : "in"];
  return Math.max(0, Math.min(FIVE, duration - (isObject(other) ? Number(other.duration) || 0 : 0)));
}

/**
 * The slots of an element after one of them is set or removed (`null`). A Combo and In / Out exclude each other: the
 * one being set clears the other side. In and Out last 0.1 s to the smaller of 5 s and the element, on the frame grid,
 * and together never exceed the element: the slot being set gives way to the one already there. A Combo starts at the
 * element's length and follows it until its duration is edited.
 */
export function clampClipAnimation(element: { duration: number; clipAnimation?: unknown }, group: ClipAnimationGroup, slot: ClipAnimationSlot, fps: Rational): Json | undefined {
  const duration = Number(element.duration), current = slotsOf(element as Json), next: Stored = { ...current };
  if (slot === null) delete next[group];
  else if (group === "combo") {
    delete next.in; delete next.out;
    const before = isObject(current.combo) ? current.combo : undefined;
    // A duration that is given and is not the one the combo follows is the user's own.
    const follows = slot.duration === undefined ? before?.followsDuration !== false : before !== undefined && before.followsDuration !== false && Math.round(slot.duration) === Number(before.duration);
    const own = follows ? duration : Math.min(duration, Math.max(Math.min(tenth(fps), duration), frame(slot.duration ?? duration, fps)));
    next.combo = { type: slot.type, duration: own, strength: percent(slot.strength), followsDuration: follows };
  } else {
    delete next.combo;
    const limit = clipAnimationLimit({ duration, clipAnimation: next }, group), least = Math.min(tenth(fps), duration);
    const own = Math.min(frame(limit, fps, true), Math.max(least, frame(slot.duration ?? HALF, fps)));
    next[group] = { type: slot.type, duration: Math.max(0, own), strength: percent(slot.strength) };
  }
  return Object.keys(next).length > 0 ? (next as Json) : undefined;
}

/** Sets or removes one clip-animation slot of every given element, each clamped to its own length, as one step. */
export function setClipAnimation(doc: ProjectDocument, ctx: CommitContext, elementIds: string[], group: ClipAnimationGroup, slot: ClipAnimationSlot): Commit {
  if (slot !== null && !CLIP_ANIMATION_ROWS.some((row) => row.group === group && row.id === slot.type)) refuse("This animation is not available", "INVALID_PARAMS", { type: slot.type, group });
  return edit(doc, ctx, { commandType: "clip.animation", label: "Clip animation" }, (draft) => {
    for (const elementId of elementIds) {
      const element = editable(elementIn(draft, elementId));
      if (!isClipAnimatable(element as { type: string })) refuse("Clip animations are available for video, image, sticker and shape clips", "INVALID_PARAMS");
      const next = clampClipAnimation(element as never, group, slot, draft.settings.fps as Rational);
      if (next) element.clipAnimation = next; else delete element.clipAnimation;
    }
  });
}

export const MOTION_BLUR_DEFAULT = { enabled: false, strength: 50, samples: 8 } as const;
export const MOTION_BLUR_SAMPLES = [4, 8, 16] as const;
export type MotionBlur = { enabled: boolean; strength: number; samples: number };
/** The motion blur of an element with its defaults. */
export const motionBlurOf = (element: object): MotionBlur => { const own = (element as { motionBlur?: unknown }).motionBlur; return { ...MOTION_BLUR_DEFAULT, ...(isObject(own) ? (own as Partial<MotionBlur>) : {}) }; };
/** Changes the motion blur of every given element as one step. */
export function setMotionBlur(doc: ProjectDocument, ctx: CommitContext, elementIds: string[], change: Partial<MotionBlur>): Commit {
  if (change.samples !== undefined && !(MOTION_BLUR_SAMPLES as readonly number[]).includes(change.samples)) refuse("Motion blur samples are 4, 8 or 16", "OUT_OF_RANGE", { param: "samples" });
  return edit(doc, ctx, { commandType: "element.motionBlur", label: "Motion blur" }, (draft) => {
    for (const elementId of elementIds) {
      const element = editable(elementIn(draft, elementId)), next = { ...motionBlurOf(element), ...change };
      element.motionBlur = { enabled: next.enabled === true, strength: percent(next.strength), samples: next.samples };
    }
  });
}
