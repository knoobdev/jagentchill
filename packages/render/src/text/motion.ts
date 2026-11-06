import { hash, TEXT_ANIMATIONS } from "@jagentchill/editor-core";
import { cubicBezier } from "../frame/library.ts";
import { fnv1a } from "./spec.ts";

/**
 * The bundled text animations of `text-and-titles/catalog.md` section 4, evaluated from element-local time only:
 * the same frame comes out of a seek and out of playback. A `block` animation moves the whole layer; a `line`,
 * `word` or `character` animation moves the units of the rasterised text.
 */

export type UnitKind = "line" | "word" | "character";
/** A slot of `textAnimation` at one clip time: `p` is the progress of In / Out, or the cycle position of Loop. */
export type MotionSlot = { id: string; p: number; strength: number; /** Seconds since the end of In (Loop only). */ t?: number };
export type MotionSlots = { in?: MotionSlot; out?: MotionSlot; loop?: MotionSlot };
/** The part of the animation the rasteriser needs, kept inside the raster description (and so inside its cache key). */
export type TextMotion = MotionSlots & { seed: number };

export type BlockPose = {
  /** Raster px. */
  dx: number; dy: number; scaleX: number; scaleY: number;
  /** Degrees, clockwise. */
  rotate: number; pivot: "center" | "top";
  opacity: number;
  /** Gaussian blur radius in raster px. */
  blur: number;
};
export type UnitPose = {
  dx: number; dy: number; scale: number; rotate: number; opacity: number;
  /** The visible part of a line, as fractions of its width (wipes). */
  reveal?: [number, number];
};
export type Glitch = { channel: number; slices: number[] };

type Slotted = { id: string; duration?: number; period?: number; strength?: number };
const UNIT = new Map(TEXT_ANIMATIONS.map((animation) => [animation.id, animation.unit]));
const clamp01 = (value: number): number => Math.min(Math.max(value, 0), 1);
const outCubic = (p: number): number => cubicBezier(0.33, 1, 0.68, 1, p);
const inCubic = (p: number): number => cubicBezier(0.32, 0, 0.67, 0, p);
const outBack = (p: number): number => cubicBezier(0.34, 1.56, 0.64, 1, p);
const identity = (p: number): number => p;

/** A value from `[p, value]` keys, eased inside each segment. */
function keyed(keys: readonly (readonly [number, number])[], p: number, ease: (p: number) => number = identity): number {
  if (p <= keys[0][0]) return keys[0][1];
  for (let index = 1; index < keys.length; index++) {
    const [at, value] = keys[index], [from, before] = keys[index - 1];
    if (p <= at) return before + (value - before) * ease((p - from) / (at - from));
  }
  return keys[keys.length - 1][1];
}
/** A value that changes at the stated instants and holds in between. */
function stepped(keys: readonly (readonly [number, number])[], p: number): number {
  let value = keys[0][1];
  for (const [at, next] of keys) if (p >= at) value = next;
  return value;
}

/** Whether an animation id is one this build draws; an unknown id renders without animation. */
export const knownTextAnimation = (id: string | undefined): boolean => id !== undefined && UNIT.has(id);

/**
 * The slots that are running at a clip time (ticks). In covers `[0, in.duration)`, Out the last `out.duration`,
 * Loop the time in between; In + Out never exceed the element.
 */
export function motionSlots(animation: { in?: Slotted; out?: Slotted; loop?: Slotted } | undefined, clipTime: number, duration: number, ticksPerSecond = 120_000): MotionSlots {
  const slots: MotionSlots = {};
  if (!animation) return slots;
  const strength = (slot: Slotted) => clamp01((slot.strength ?? 100) / 100);
  const enter = knownTextAnimation(animation.in?.id) ? animation.in : undefined, leave = knownTextAnimation(animation.out?.id) ? animation.out : undefined;
  const inTicks = Math.min(Math.max(enter?.duration ?? 0, 0), duration);
  const outTicks = Math.min(Math.max(leave?.duration ?? 0, 0), duration - inTicks);
  if (enter && inTicks > 0 && clipTime < inTicks) slots.in = { id: enter.id, p: clamp01(clipTime / inTicks), strength: strength(enter) };
  else if (leave && outTicks > 0 && clipTime >= duration - outTicks) slots.out = { id: leave.id, p: clamp01((clipTime - (duration - outTicks)) / outTicks), strength: strength(leave) };
  else if (animation.loop && knownTextAnimation(animation.loop.id)) {
    const period = Math.max(animation.loop.period ?? ticksPerSecond, 1), since = clipTime - inTicks;
    slots.loop = { id: animation.loop.id, p: (((since % period) + period) % period) / period, strength: strength(animation.loop), t: since / ticksPerSecond };
  }
  return slots;
}

/** The pose of the whole layer: every `block` animation except the ones drawn by the rasteriser (rainbow, glitch). */
export function blockPose(slots: MotionSlots, size: { blockWidth: number; blockHeight: number; fontSize: number }): BlockPose {
  const pose: BlockPose = { dx: 0, dy: 0, scaleX: 1, scaleY: 1, rotate: 0, pivot: "center", opacity: 1, blur: 0 };
  const { blockWidth: bw, blockHeight: bh, fontSize: fs } = size;
  const enter = slots.in;
  if (enter) {
    const s = enter.strength, p = enter.p, e = outCubic(p), rest = (1 - e) * s;
    switch (enter.id) {
      case "in-fade": pose.opacity *= p; break;
      case "in-slide-up": pose.dy += bh * rest; pose.opacity *= e; break;
      case "in-slide-down": pose.dy -= bh * rest; pose.opacity *= e; break;
      case "in-slide-left": pose.dx += bw * rest; pose.opacity *= e; break;
      case "in-slide-right": pose.dx -= bw * rest; pose.opacity *= e; break;
      case "in-zoom-in": pose.scaleX *= 1 - 0.5 * rest; pose.scaleY *= 1 - 0.5 * rest; pose.opacity *= e; break;
      case "in-zoom-out": pose.scaleX *= 1 + 0.6 * rest; pose.scaleY *= 1 + 0.6 * rest; pose.opacity *= e; break;
      case "in-blur": pose.blur += 0.4 * fs * rest; pose.opacity *= e; break;
      case "in-flicker": pose.opacity *= stepped([[0, 0], [0.15, 1], [0.3, 0], [0.5, 1], [0.7, 0.3], [1, 1]], p); break;
      case "in-stretch": pose.scaleX *= 1 + 1.2 * rest; pose.opacity *= e; break;
      case "in-shake": pose.dx += (keyed([[0, 12], [0.2, -10], [0.4, 8], [0.6, -6], [0.8, 3], [1, 0]], p) / 100) * fs * s; pose.opacity *= clamp01(p / 0.2); break;
    }
  }
  const leave = slots.out;
  if (leave) {
    const s = leave.strength, p = leave.p, e = inCubic(p), gone = e * s;
    switch (leave.id) {
      case "out-fade": pose.opacity *= 1 - p; break;
      case "out-slide-up": pose.dy -= bh * gone; pose.opacity *= 1 - e; break;
      case "out-slide-down": pose.dy += bh * gone; pose.opacity *= 1 - e; break;
      case "out-slide-left": pose.dx -= bw * gone; pose.opacity *= 1 - e; break;
      case "out-slide-right": pose.dx += bw * gone; pose.opacity *= 1 - e; break;
      case "out-zoom-in": pose.scaleX *= 1 + 0.6 * gone; pose.scaleY *= 1 + 0.6 * gone; pose.opacity *= 1 - e; break;
      case "out-zoom-out": pose.scaleX *= 1 - 0.5 * gone; pose.scaleY *= 1 - 0.5 * gone; pose.opacity *= 1 - e; break;
      case "out-blur": pose.blur += 0.4 * fs * gone; pose.opacity *= 1 - e; break;
      case "out-flicker": pose.opacity *= stepped([[0, 1], [0.3, 0.3], [0.5, 1], [0.7, 0], [0.85, 1], [1, 0]], p); break;
      case "out-stretch": pose.scaleX *= 1 + 1.2 * gone; pose.opacity *= 1 - e; break;
      case "out-shake": pose.dx += (keyed([[0, 0], [0.2, 3], [0.4, -6], [0.6, 8], [0.8, -10], [1, 12]], p) / 100) * fs * s; pose.opacity *= clamp01((1 - p) / 0.2); break;
    }
  }
  const loop = slots.loop;
  if (loop) {
    const s = loop.strength, wave = Math.sin(2 * Math.PI * loop.p);
    switch (loop.id) {
      case "loop-pulse": pose.scaleX *= 1 + 0.08 * wave * s; pose.scaleY *= 1 + 0.08 * wave * s; break;
      case "loop-wobble": pose.rotate += 4 * wave * s; break;
      case "loop-float": pose.dy -= 0.08 * fs * wave * s; break;
      case "loop-blink": pose.opacity *= loop.p < 0.5 ? 1 : 0; break;
      case "loop-swing": pose.rotate += 10 * wave * s; pose.pivot = "top"; break;
      case "loop-breathe": pose.opacity *= 0.75 + 0.25 * Math.cos(2 * Math.PI * loop.p); break;
      case "loop-heartbeat": { const scale = 1 + (keyed([[0, 1], [0.14, 1.15], [0.28, 1], [0.42, 1.1], [0.7, 1], [1, 1]], loop.p) - 1) * s; pose.scaleX *= scale; pose.scaleY *= scale; break; }
    }
  }
  return pose;
}

/** Ids the rasteriser draws although their unit is the block. */
const RASTER_BLOCK = new Set(["loop-rainbow", "loop-glitch"]);
/** The slots the rasteriser needs: unit animations, and the block animations that change the ink itself. */
export function rasterMotion(slots: MotionSlots, elementId: string): TextMotion | undefined {
  const keep = (slot: MotionSlot | undefined) => (slot && (UNIT.get(slot.id) !== "block" || RASTER_BLOCK.has(slot.id)) ? slot : undefined);
  const enter = keep(slots.in), leave = keep(slots.out), loop = keep(slots.loop);
  if (!enter && !leave && !loop) return undefined;
  // A glitch outside its burst, and a rainbow (applied to the colours), leave the raster untouched.
  if (!enter && !leave && loop && (loop.id === "loop-rainbow" || (loop.id === "loop-glitch" && loop.p < 0.9))) return undefined;
  return { seed: fnv1a(elementId), ...(enter ? { in: enter } : {}), ...(leave ? { out: leave } : {}), ...(loop ? { loop } : {}) };
}

/** The unit kinds a motion animates, finest first: the rasteriser groups glyphs by them. */
export function motionUnits(motion: MotionSlots | undefined): UnitKind[] {
  const kinds = new Set<UnitKind>();
  for (const slot of [motion?.in, motion?.out, motion?.loop]) {
    const unit = slot && UNIT.get(slot.id);
    if (unit && unit !== "block") kinds.add(unit);
  }
  return (["character", "word", "line"] as const).filter((kind) => kinds.has(kind));
}

/** `hash(a, b, c)` of the catalogue: the engine hash seeded by the element id, mapped to [−1, 1]. */
export const signedHash = (seed: number, a: number, b: number, c: number): number => (hash((seed ^ Math.imul(a + 1, 2654435761)) >>> 0, b, c) / 4294967296) * 2 - 1;

/** Progress of unit `index` of `count` inside a staggered animation: a window of half the duration per unit. */
export function staggered(p: number, index: number, count: number): number {
  return count <= 1 ? p : clamp01((p - (index * 0.5) / (count - 1)) / 0.5);
}

/** The pose of unit `index` of `count` units of `kind`, in reading order. Lengths are raster px. */
export function unitPose(motion: TextMotion, kind: UnitKind, index: number, count: number, fontSize: number, boxWidth: number): UnitPose {
  const pose: UnitPose = { dx: 0, dy: 0, scale: 1, rotate: 0, opacity: 1 };
  const fs = fontSize / 100;
  const enter = motion.in;
  if (enter && UNIT.get(enter.id) === kind) {
    const s = enter.strength, q = staggered(enter.p, index, count), e = outCubic(q), rest = (1 - e) * s;
    switch (enter.id) {
      case "in-typewriter": pose.opacity *= enter.p >= index / count ? 1 : 0; break;
      case "in-pop": pose.scale *= 1 - (1 - outBack(q)) * s; pose.opacity *= clamp01(q / 0.3); break;
      case "in-bounce": pose.dy += keyed([[0, -80], [0.55, 0], [0.7, -18], [0.85, 0], [0.93, -6], [1, 0]], q) * fs * s; pose.opacity *= clamp01(q / 0.2); break;
      case "in-wipe-right": pose.reveal = [0, q]; break;
      case "in-wipe-left": pose.reveal = [1 - q, 1]; break;
      case "in-rise": pose.dy += 60 * fs * rest; pose.opacity *= e; break;
      case "in-drop": pose.dy -= 60 * fs * rest; pose.opacity *= e; break;
      case "in-spin": pose.rotate -= 180 * rest; pose.scale *= 1 - 0.6 * rest; pose.opacity *= e; break;
      case "in-wave": pose.dy += keyed([[0, 40], [0.6, -15], [1, 0]], q, outCubic) * fs * s; pose.opacity *= clamp01(q / 0.4); break;
    }
  }
  const leave = motion.out;
  if (leave && UNIT.get(leave.id) === kind) {
    // The last unit leaves first, except the wipes, whose lines go in reading order.
    const wipe = leave.id === "out-wipe-right" || leave.id === "out-wipe-left";
    const s = leave.strength, q = staggered(leave.p, wipe ? index : count - 1 - index, count), e = inCubic(q), gone = e * s;
    switch (leave.id) {
      case "out-typewriter": pose.opacity *= leave.p < (count - 1 - index) / count ? 1 : 0; break;
      case "out-pop": pose.scale *= 1 + ((q < 0.3 ? 1 + 0.15 * (q / 0.3) : 1.15 * (1 - inCubic((q - 0.3) / 0.7))) - 1) * s; pose.opacity *= clamp01((1 - q) / 0.3); break;
      case "out-bounce": pose.dy += keyed([[0, 0], [0.15, -18], [0.35, 0], [1, 80]], q) * fs * s; pose.opacity *= clamp01((1 - q) / 0.2); break;
      case "out-wipe-right": pose.reveal = [q, 1]; break;
      case "out-wipe-left": pose.reveal = [0, 1 - q]; break;
      case "out-rise": pose.dy -= 60 * fs * gone; pose.opacity *= 1 - e; break;
      case "out-drop": pose.dy += 60 * fs * gone; pose.opacity *= 1 - e; break;
      case "out-spin": pose.rotate += 180 * gone; pose.scale *= 1 - 0.6 * gone; pose.opacity *= 1 - e; break;
      case "out-wave": pose.dy += keyed([[0, 0], [0.4, -15], [1, 40]], q, inCubic) * fs * s; pose.opacity *= clamp01((1 - q) / 0.4); break;
    }
  }
  const loop = motion.loop;
  if (loop && UNIT.get(loop.id) === kind) {
    const s = loop.strength;
    switch (loop.id) {
      case "loop-wave": pose.dy -= 15 * fs * Math.sin(2 * Math.PI * (loop.p - index / 8)) * s; break;
      case "loop-jitter": { const k = Math.floor((loop.t ?? 0) * 12); pose.dx += 3 * fs * signedHash(motion.seed, k, index, 0) * s; pose.dy += 3 * fs * signedHash(motion.seed, k, index, 1) * s; break; }
      case "loop-scroll": pose.dx += boxWidth * (1 - 2 * loop.p) * s; break;
    }
  }
  return pose;
}

/** The glitch burst of `loop-glitch` at its cycle position, or `null` outside it. Offsets are raster px. */
export function glitchOf(motion: TextMotion | undefined, fontSize: number): Glitch | null {
  const loop = motion?.loop;
  if (!motion || !loop || loop.id !== "loop-glitch" || loop.p < 0.9) return null;
  const k = Math.floor((loop.t ?? 0) * 24), fs = fontSize / 100;
  return { channel: 4 * fs * signedHash(motion.seed, k, 0, 0) * loop.strength, slices: Array.from({ length: 6 }, (_, slice) => 6 * fs * signedHash(motion.seed, k, slice, 1) * loop.strength) };
}

/** A colour with its hue rotated in HSL, saturation, lightness and alpha kept (`loop-rainbow`). */
export function rotateHue(color: string, degrees: number): string {
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color);
  if (!match) return color;
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(match[1].slice(at, at + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), lightness = (max + min) / 2, delta = max - min;
  if (delta === 0) return color;
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  hue = (((hue * 60 + degrees) % 360) + 360) % 360;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation, x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1)), m = lightness - chroma / 2;
  const [r1, g1, b1] = hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180 ? [0, chroma, x] : hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x];
  const hex = (value: number) => Math.round(clamp01(value + m) * 255).toString(16).padStart(2, "0");
  return `#${hex(r1)}${hex(g1)}${hex(b1)}${match[2] ?? ""}`;
}
