import { CLIP_ANIMATION_ROWS } from "@jagentchill/content";
import { TICKS_PER_SECOND } from "@jagentchill/protocol";
import { cubicBezier } from "../frame/library.ts";
import { signedHash } from "../text/motion.ts";
import { fnv1a } from "../text/spec.ts";

/**
 * Clip animations In, Out and Combo (`keyframe-animation.Clip animation model`): a layer of transform, opacity, blur
 * and reveal values on top of the element's own, read at the frame start time from the channel tables of
 * `keyframe-animation/catalog.md` (the data of `@jagentchill/content`). Nothing here writes a keyframe.
 */

/** The channels of a clip animation at one instant. Translation is in percent of the canvas, scale in percent. */
export type ClipPose = { x: number; y: number; scaleX: number; scaleY: number; rotation: number; opacity: number; blur: number; reveal: number; pivot: "centre" | "top" };
export const NEUTRAL_POSE: Readonly<ClipPose> = { x: 0, y: 0, scaleX: 100, scaleY: 100, rotation: 0, opacity: 1, blur: 0, reveal: 1, pivot: "centre" };

type Key = { u: number; value: number; easing: string };
type Channel = "x" | "y" | "scale" | "scaleX" | "scaleY" | "rotation" | "opacity" | "blur" | "reveal";
type Parsed = { tables: Partial<Record<Channel, Key[]>>; /** Jitter on x and y with an amplitude table (Shake In, Shake Out). */ jitter?: Key[]; periodic?: (t: number, seed: number) => Partial<ClipPose> };

const EASINGS: Record<string, [number, number, number, number] | null> = { lin: null, in: [0.42, 0, 1, 1], out: [0, 0, 0.58, 1], io: [0.42, 0, 0.58, 1], pop: [0.175, 0.885, 0.32, 1.275] };
const CHANNELS = new Set<string>(["x", "y", "scale", "scaleX", "scaleY", "rotation", "opacity", "blur", "reveal"]);

/** `jit(c, A)`: held for each 1/12 s step, from the element's seed. */
const jit = (seed: number, t: number, channel: number, amplitude: number): number => amplitude * signedHash(seed, Math.floor(t * 12), channel, 0);

/**
 * The rows of the catalogue that are functions of time, as the code that draws them. The text is the catalogue's:
 * a row that is edited there no longer matches, and the animation is then reported unknown instead of being drawn
 * from a stale formula (`periodicRowsMatch` is the test's hook for that).
 */
const PERIODIC: Record<string, { text: string; at: (t: number, seed: number) => Partial<ClipPose> }> = {
  "zoom-pulse": { text: "scale = 100 + 15 × (1 − cos(2π t)) / 2 (period 1 s; peak 115 at t = 0.5 s, 1.5 s, …)", at: (t) => { const scale = 100 + (15 * (1 - Math.cos(2 * Math.PI * t))) / 2; return { scaleX: scale, scaleY: scale }; } },
  swing: { text: "rotation = 10 × sin(2π t / 1.5) (period 1.5 s)", at: (t) => ({ rotation: 10 * Math.sin((2 * Math.PI * t) / 1.5) }) },
  pendulum: { text: "rotation = 15 × sin(2π t / 2) (period 2 s); pivot = centre of the element's top edge", at: (t) => ({ rotation: 15 * Math.sin((2 * Math.PI * t) / 2), pivot: "top" }) },
  bounce: { text: "y = −8 × abs(sin(π t / 0.8)) (one hop per 0.8 s)", at: (t) => ({ y: -8 * Math.abs(Math.sin((Math.PI * t) / 0.8)) }) },
  wobble: { text: "scaleX = 100 + 4 × sin(2π t / 0.6); scaleY = 100 − 4 × sin(2π t / 0.6) (period 0.6 s)", at: (t) => ({ scaleX: 100 + 4 * Math.sin((2 * Math.PI * t) / 0.6), scaleY: 100 - 4 * Math.sin((2 * Math.PI * t) / 0.6) }) },
  shake: { text: "x = jit(0, 3); y = jit(1, 3); rotation = jit(2, 1.5)", at: (t, seed) => ({ x: jit(seed, t, 0, 3), y: jit(seed, t, 1, 3), rotation: jit(seed, t, 2, 1.5) }) },
};
const JITTER_PREFIX = "x = jit(0, A), y = jit(1, A) with A — ";

function parseKeys(text: string): Key[] | null {
  const keys: Key[] = [];
  for (const part of text.split(";")) {
    const match = /^([\d.]+): (-?[\d.]+)(?: \[(\w+)\])?$/.exec(part.trim().replace(/−/g, "-"));
    if (!match || (match[3] !== undefined && !(match[3] in EASINGS))) return null;
    keys.push({ u: Number(match[1]), value: Number(match[2]), easing: match[3] ?? "lin" });
  }
  return keys.length > 0 ? keys : null;
}

function parseRow(id: string, channels: string): Parsed | null {
  const periodic = PERIODIC[id];
  if (periodic) return periodic.text === channels ? { tables: {}, periodic: periodic.at } : null;
  const parsed: Parsed = { tables: {} };
  for (const part of channels.split(" · ")) {
    if (part.startsWith(JITTER_PREFIX)) {
      const keys = parseKeys(part.slice(JITTER_PREFIX.length));
      if (!keys) return null;
      parsed.jitter = keys;
      continue;
    }
    const split = part.indexOf(" — ");
    const name = part.slice(0, split), keys = split > 0 ? parseKeys(part.slice(split + 3)) : null;
    if (!keys || !CHANNELS.has(name)) return null;
    parsed.tables[name as Channel] = keys;
  }
  return parsed;
}

const LIBRARY = new Map<string, { group: string; parsed: Parsed | null }>(CLIP_ANIMATION_ROWS.map((row) => [row.id, { group: row.group, parsed: parseRow(row.id, row.channels) }]));

/** Whether an id of a group is a clip animation the engine draws. */
export const knownClipAnimation = (id: string, group?: "in" | "out" | "combo"): boolean => { const entry = LIBRARY.get(id); return !!entry?.parsed && (!group || entry.group === group); };
/** The time-function rows of the catalogue still read as the formulas the engine has for them. */
export const periodicRowsMatch = (): string[] => Object.keys(PERIODIC).filter((id) => !LIBRARY.get(id)?.parsed);

/** A channel table at `u`: the value holds before the first and after the last key; a segment eases as its first key says. */
function tableAt(keys: Key[], u: number): number {
  if (u <= keys[0].u) return keys[0].value;
  const last = keys[keys.length - 1];
  if (u >= last.u) return last.value;
  let index = 0;
  while (keys[index + 1].u <= u) index++;
  const from = keys[index], to = keys[index + 1], bezier = EASINGS[from.easing];
  const progress = (u - from.u) / (to.u - from.u);
  return from.value + (to.value - from.value) * (bezier ? cubicBezier(bezier[0], bezier[1], bezier[2], bezier[3], progress) : progress);
}

/**
 * One animation at normalised position `u` and `t` seconds into its slot. `strength` 0–100 scales translation,
 * the deviation of scale from 100 %, rotation, blur and jitter; opacity and reveal are not scaled.
 */
export function clipAnimationPose(type: string, u: number, t: number, strength: number, elementId: string): ClipPose | null {
  const parsed = LIBRARY.get(type)?.parsed;
  if (!parsed) return null;
  const s = Math.min(Math.max(strength, 0), 100) / 100, seed = fnv1a(elementId);
  const pose: ClipPose = { ...NEUTRAL_POSE };
  const at = (channel: Channel) => (parsed.tables[channel] ? tableAt(parsed.tables[channel]!, u) : undefined);
  const scale = at("scale");
  Object.assign(pose, {
    x: at("x") ?? 0, y: at("y") ?? 0, scaleX: at("scaleX") ?? scale ?? 100, scaleY: at("scaleY") ?? scale ?? 100,
    rotation: at("rotation") ?? 0, opacity: at("opacity") ?? 1, blur: at("blur") ?? 0, reveal: at("reveal") ?? 1,
  });
  if (parsed.jitter) { const amplitude = tableAt(parsed.jitter, u); pose.x += jit(seed, t, 0, amplitude); pose.y += jit(seed, t, 1, amplitude); }
  if (parsed.periodic) Object.assign(pose, parsed.periodic(t, seed));
  pose.x *= s; pose.y *= s; pose.rotation *= s; pose.blur *= s;
  pose.scaleX = 100 + (pose.scaleX - 100) * s; pose.scaleY = 100 + (pose.scaleY - 100) * s;
  return pose;
}

type Slot = { type?: string; duration?: number; strength?: number; followsDuration?: boolean };
export type ClipAnimation = { in?: Slot; out?: Slot; combo?: Slot };

/**
 * The clip animation of an element at an element-local time (ticks): In over `[0, in.duration]`, Out over
 * `[duration − out.duration, duration]`, Combo over `[0, combo.duration]` (the element duration while it follows
 * it). Translation and rotation add, scale and opacity multiply. `null` when nothing animates at that time.
 */
export function resolveClipAnimation(animation: ClipAnimation | undefined, clipTime: number, duration: number, elementId: string, unknown?: (type: string) => void): ClipPose | null {
  if (!animation) return null;
  let out: ClipPose | null = null;
  const apply = (slot: Slot | undefined, group: "in" | "out" | "combo", start: number, length: number) => {
    if (!slot?.type || slot.type === "none" || !(length > 0) || clipTime < start || clipTime > start + length) return;
    // In ends, and Out starts, at the unmodified state: outside its range a slot contributes nothing.
    if (group === "in" && clipTime >= start + length) return;
    if (!knownClipAnimation(slot.type, group)) { unknown?.(slot.type); return; }
    const pose = clipAnimationPose(slot.type, (clipTime - start) / length, (clipTime - start) / TICKS_PER_SECOND, slot.strength ?? 100, elementId)!;
    if (!out) { out = pose; return; }
    out = { x: out.x + pose.x, y: out.y + pose.y, scaleX: (out.scaleX * pose.scaleX) / 100, scaleY: (out.scaleY * pose.scaleY) / 100, rotation: out.rotation + pose.rotation, opacity: out.opacity * pose.opacity, blur: out.blur + pose.blur, reveal: Math.min(out.reveal, pose.reveal), pivot: pose.pivot === "top" ? "top" : out.pivot };
  };
  if (animation.combo?.type && animation.combo.type !== "none") {
    const length = animation.combo.followsDuration === false ? Math.min(animation.combo.duration ?? duration, duration) : duration;
    apply(animation.combo, "combo", 0, length);
  } else {
    const enter = Math.min(animation.in?.duration ?? 0, duration), leave = Math.min(animation.out?.duration ?? 0, duration - (animation.in?.type ? enter : 0));
    apply(animation.in, "in", 0, enter);
    apply(animation.out, "out", duration - leave, leave);
  }
  return out;
}
