import { MAX_ELEMENT_DURATION, type Rational } from "@jagentchill/protocol";
import { isObject, type Json } from "../model.ts";
import { frameTicks, roundHalfAway, snapToFrame } from "../time.ts";
import { clipTimeAt, curveRateAt, retimeClipOf, retimedDuration, sourceTimeAt, validCurve, type CurvePoint, type RetimeSpec } from "../time/retime.ts";
import type { TimelineCommand } from "./command.ts";
import { endOf, fpsOf, isFreeze, isRetimable, refuse, sceneById, tracksOfScene, type El, type Sc, type Tr } from "./model.ts";

/**
 * Speed changes of elements (`speed-retime`): constant rate, speed curves and their presets, reverse, and what a
 * change of speed carries with it — the element's duration, its keyframes, clip animations, fades and linked
 * captions — as one step. The time map itself is `time/retime.ts`; nothing here computes a mapping of its own.
 */

export const SPEED_LIMITS = { min: 0.1, max: 100, curveMin: 0.1, curveMax: 10, maxPoints: 32, minGap: 0.02, maxDuration: 6 * 3600 * 120_000 } as const;
export const SPEED_STOPS = [0.1, 1, 2, 5, 10, 100] as const;
export const NO_ROOM_MESSAGE = "Not enough room to slow this clip. Turn on ripple or move the next clip.";
export const TOO_LONG_MESSAGE = "Resulting clip would be longer than 6 hours";
const p = (u: number, rate: number): CurvePoint => ({ u, rate });
export const SPEED_CURVE_PRESETS: Record<string, { name: string; points: CurvePoint[] }> = {
  montage: { name: "Montage", points: [p(0, 0.9), p(0.25, 0.9), p(0.4, 6), p(0.6, 6), p(0.75, 0.4), p(1, 0.4)] },
  hero: { name: "Hero", points: [p(0, 1), p(0.2, 5), p(0.4, 0.5), p(0.6, 0.5), p(0.8, 5), p(1, 1)] },
  bullet: { name: "Bullet", points: [p(0, 5.5), p(0.3, 5.5), p(0.45, 0.5), p(0.55, 0.5), p(0.7, 5.5), p(1, 5.5)] },
  "jump-cut": { name: "Jump Cut", points: [p(0, 0.6), p(0.3, 0.6), p(0.45, 5.5), p(0.55, 5.5), p(0.7, 0.6), p(1, 0.6)] },
  "flash-in": { name: "Flash In", points: [p(0, 5.5), p(0.4, 5.5), p(0.6, 1), p(1, 1)] },
  "flash-out": { name: "Flash Out", points: [p(0, 1), p(0.4, 1), p(0.6, 5.5), p(1, 5.5)] },
};
export const CUSTOM_CURVE_POINTS: CurvePoint[] = [p(0, 1), p(0.25, 1), p(0.5, 1), p(0.75, 1), p(1, 1)];
/** The tiles of the Curve tab, in order. */
export const SPEED_CURVE_TILES = [{ id: "none", name: "None" }, { id: "custom", name: "Custom" }, ...Object.entries(SPEED_CURVE_PRESETS).map(([id, preset]) => ({ id, name: preset.name }))] as const;

type Retime = { rate?: number; maintainPitch?: boolean; reverse?: boolean; smooth?: string; curve?: { preset: string; points: CurvePoint[] } };
const retimeOf = (element: El): Retime | undefined => (isObject(element.retime) ? (element.retime as Retime) : undefined);
const specOf = (retime: Retime | undefined): RetimeSpec | undefined => (retime ? { rate: retime.rate, reverse: retime.reverse, curve: retime.curve?.points } : undefined);
/** The curve of an element when it is a valid one; a stored curve that is not valid is ignored everywhere. */
export const speedCurveOf = (element: El): CurvePoint[] | null => validCurve(specOf(retimeOf(element)));
/** `true` when the element stores a curve the time map cannot use ("This speed curve was invalid and has been reset"). */
export const hasInvalidCurve = (element: El): boolean => retimeOf(element)?.curve !== undefined && speedCurveOf(element) === null;
/** The visible source length of an element in ticks. */
export const sourceSpanOf = (element: El): number => retimeClipOf(element as never).sourceSpan;
/** The speed a clip shows: its constant rate, or the average rate of its curve. */
export function effectiveRate(element: El): number {
  const retime = retimeOf(element);
  if (speedCurveOf(element)) return Math.max(1e-6, sourceSpanOf(element) / Math.max(1, element.duration));
  const rate = retime?.rate;
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0 ? rate : 1;
}
/** Lowest and highest instantaneous rate of an element. */
export function rateRange(element: El): { min: number; max: number } {
  const curve = speedCurveOf(element);
  if (!curve) { const rate = effectiveRate(element); return { min: rate, max: rate }; }
  let min = Infinity, max = 0;
  for (let step = 0; step <= 256; step++) { const rate = curveRateAt(curve, step / 256); min = Math.min(min, rate); max = Math.max(max, rate); }
  return { min, max };
}
/** Keep pitch stretches between 0.25× and 4× for the whole clip; outside it the audio is resampled. */
export const pitchKept = (element: El): boolean => { const range = rateRange(element); return retimeOf(element)?.maintainPitch === true && range.min >= 0.25 && range.max <= 4; };
/** The badge of a retimed clip: "2.0x", "0.25x", a preset's name, "Curve" for a custom curve; `null` at 1× with no curve. */
export function speedBadge(element: El): string | null {
  if (isFreeze(element)) return "Freeze";
  const retime = retimeOf(element);
  if (!retime) return null;
  if (speedCurveOf(element)) return SPEED_CURVE_PRESETS[retime.curve!.preset]?.name ?? "Curve";
  const rate = effectiveRate(element);
  if (rate === 1) return null;
  return `${rate < 1 ? (Math.round(rate * 100) / 100).toFixed(2) : (Math.round(rate * 10) / 10).toFixed(1)}x`;
}
/** A typed or dragged rate as it is stored: two decimals, 0.1–100. */
export const clampRate = (rate: number): number => Math.min(SPEED_LIMITS.max, Math.max(SPEED_LIMITS.min, Math.round(rate * 100) / 100));
/** The rate that gives a requested duration, and the duration that rate really gives. */
export function rateForDuration(sourceSpan: number, duration: number, fps: Rational): { rate: number; duration: number } {
  const rate = Math.min(SPEED_LIMITS.max, Math.max(SPEED_LIMITS.min, sourceSpan / Math.max(1, duration)));
  return { rate, duration: retimedDuration(sourceSpan, { rate }, fps) };
}
/** Position 0–1 of a rate on the logarithmic slider, and back. */
export const rateToSlider = (rate: number): number => Math.log10(Math.min(100, Math.max(0.1, rate)) / 0.1) / 3;
export const sliderToRate = (position: number): number => 0.1 * 10 ** (3 * Math.min(1, Math.max(0, position)));
/** A slider position snapped to a labelled stop within `pixels` of it. */
export function snapSlider(position: number, width: number, free = false, pixels = 4): number {
  if (free) return sliderToRate(position);
  const stop = SPEED_STOPS.find((value) => Math.abs(rateToSlider(value) - position) * width <= pixels);
  return stop ?? sliderToRate(position);
}

// — Curves —
const gapped = (points: CurvePoint[]): CurvePoint[] => {
  const out: CurvePoint[] = [];
  for (const point of points) if (out.length === 0 || point.u - out[out.length - 1].u > 1e-9) out.push(point);
  return out;
};
/** Thins a curve to `max` points, keeping its ends and the largest changes of rate. */
function thin(points: CurvePoint[], max: number = SPEED_LIMITS.maxPoints): CurvePoint[] {
  const kept = [...points];
  while (kept.length > max) {
    let weakest = 1, smallest = Infinity;
    for (let index = 1; index < kept.length - 1; index++) {
      const span = kept[index + 1].u - kept[index - 1].u, expected = kept[index - 1].rate + ((kept[index + 1].rate - kept[index - 1].rate) * (kept[index].u - kept[index - 1].u)) / span;
      const error = Math.abs(kept[index].rate - expected);
      if (error < smallest) { smallest = error; weakest = index; }
    }
    kept.splice(weakest, 1);
  }
  return kept;
}
const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;
/**
 * The curve of the part `[from, to]` of a source span (positions 0–1 of the old span; outside it the end rate
 * continues): boundary points carry the interpolated rate and `u` is renormalised to the part.
 */
export function cropCurve(points: CurvePoint[], from: number, to: number): CurvePoint[] {
  const width = to - from;
  if (!(width > 0)) return [p(0, curveRateAt(points, from)), p(1, curveRateAt(points, from))];
  const inside = points.filter((point) => point.u > from + 1e-9 && point.u < to - 1e-9);
  const dense: CurvePoint[] = [];
  // Between stored points the rate is a cubic: the crop samples it so that the shape of a cut segment survives.
  const stops = [from, ...inside.map((point) => point.u), to];
  for (let index = 0; index < stops.length - 1; index++) {
    const a = stops[index], b = stops[index + 1];
    dense.push(p(a, curveRateAt(points, a)));
    if (index === 0 || index === stops.length - 2) for (const step of [0.25, 0.5, 0.75]) dense.push(p(a + (b - a) * step, curveRateAt(points, a + (b - a) * step)));
  }
  dense.push(p(to, curveRateAt(points, to)));
  const cropped = thin(gapped(dense.sort((a, b) => a.u - b.u))).map((point) => p(round6((point.u - from) / width), round6(Math.min(SPEED_LIMITS.curveMax, Math.max(SPEED_LIMITS.curveMin, point.rate)))));
  cropped[0].u = 0; cropped[cropped.length - 1].u = 1;
  return gapped(cropped).length >= 2 ? gapped(cropped) : [p(0, cropped[0].rate), p(1, cropped[0].rate)];
}
/** Inserts a point at a position of the curve with the curve's rate there; `null` when it would crowd a neighbour or the curve is full. */
export function addCurvePoint(points: CurvePoint[], u: number): CurvePoint[] | null {
  if (points.length >= SPEED_LIMITS.maxPoints || points.some((point) => Math.abs(point.u - u) < SPEED_LIMITS.minGap) || u <= 0 || u >= 1) return null;
  return [...points, p(round6(u), round6(curveRateAt(points, u)))].sort((a, b) => a.u - b.u);
}
/** Removes an interior point; `null` for an end point or when only two remain. */
export const removeCurvePoint = (points: CurvePoint[], index: number): CurvePoint[] | null => (points.length <= 2 || index <= 0 || index >= points.length - 1 ? null : points.filter((_, at) => at !== index));
/** Moves a point: rate 0.1–10 (snapping to 1.0 within ±0.05 unless `free`), `u` between its neighbours with the minimum gap; end points move vertically only. */
export function moveCurvePoint(points: CurvePoint[], index: number, to: { u?: number; rate?: number }, free = false): CurvePoint[] {
  const point = points[index];
  if (!point) return points;
  let rate = Math.min(SPEED_LIMITS.curveMax, Math.max(SPEED_LIMITS.curveMin, to.rate ?? point.rate));
  if (!free && Math.abs(rate - 1) <= 0.05) rate = 1;
  const end = index === 0 || index === points.length - 1;
  const u = end || to.u === undefined ? point.u : Math.min(points[index + 1].u - SPEED_LIMITS.minGap, Math.max(points[index - 1].u + SPEED_LIMITS.minGap, to.u));
  return points.map((entry, at) => (at === index ? p(round6(u), round6(rate)) : entry));
}
/** The position 0–1 of the source span a clip shows at an element-local time. */
export function sourcePositionAt(element: El, local: number): number {
  const clip = retimeClipOf(element as never);
  return clip.sourceSpan > 0 ? (sourceTimeAt(clip, local) - clip.sourceStart) / clip.sourceSpan : 0;
}

// — Velocity from beats —
export type VelocityPattern = "slow-fast" | "fast-slow" | "pulse";
export const velocityRates = (intensity: number): { fast: number; slow: number } => ({ fast: Math.round((1 + (5 * intensity) / 100) * 1e6) / 1e6, slow: Math.round((1 - (0.7 * intensity) / 100) * 1e6) / 1e6 });
/** The rate of each section of a pattern. */
export function velocitySections(pattern: VelocityPattern, count: number, intensity: number): number[] {
  const { fast, slow } = velocityRates(intensity);
  return Array.from({ length: count }, (_, index) => (pattern === "pulse" ? (index % 4 === 0 ? slow : fast) : (index % 2 === 0) === (pattern === "slow-fast") ? slow : fast));
}
/**
 * A custom curve whose rate changes at the chosen beats. `beats`: positions 0–1 of the clip's source span, in order.
 * Each boundary is two points 0.02 apart; a curve holds 32 points, so at most 15 boundaries are kept.
 */
export function velocityCurve(beats: number[], step: number, pattern: VelocityPattern, intensity: number): { points: CurvePoint[]; boundaries: number; dropped: number } {
  const chosen = beats.filter((_, index) => index % step === 0).filter((u) => u > 0.011 && u < 0.989);
  const spaced: number[] = [];
  for (const u of chosen) if (spaced.length === 0 || u - spaced[spaced.length - 1] > 0.021) spaced.push(u);
  const kept = spaced.slice(0, 15), rates = velocitySections(pattern, kept.length + 1, intensity);
  const points: CurvePoint[] = [p(0, round6(rates[0]))];
  kept.forEach((u, index) => { points.push(p(round6(u - 0.01), round6(rates[index])), p(round6(u + 0.01), round6(rates[index + 1]))); });
  points.push(p(1, round6(rates[rates.length - 1])));
  return { points: gapped(points), boundaries: kept.length, dropped: spaced.length - kept.length };
}

// — Keyframes and other clip-local data through a retime —
type Key = Json & { id: string; time: number; value: unknown; segmentToNext?: string; leftHandle?: { dt: number; dv: number }; rightHandle?: { dt: number; dv: number }; easing?: number[] };
const channelLists = (element: El): Key[][] => Object.values(isObject(element.animations) ? element.animations : {}).flatMap((channel) => ("r" in (channel as Json) ? ["r", "g", "b", "a"].map((part) => ((channel as Json)[part] as Json).keys as Key[]) : [(channel as Json).keys as Key[]]));
/** Plays a key list backwards: times mirror about the duration, and each segment's type and shape move to the key that now starts it. */
function reverseKeys(keys: Key[], duration: number): void {
  const old = keys.map((key) => ({ ...key }));
  const count = old.length;
  for (let index = 0; index < count; index++) {
    const source = old[count - 1 - index], key = keys[index];
    for (const name of Object.keys(key)) delete key[name];
    Object.assign(key, source, { time: duration - source.time });
    // The segment that now leaves this key was the one arriving at it.
    const arriving = old[count - 2 - index];
    if ("segmentToNext" in source || arriving) key.segmentToNext = arriving?.segmentToNext ?? "linear";
    delete key.leftHandle; delete key.rightHandle; delete key.easing;
    if (source.leftHandle) key.rightHandle = { dt: source.leftHandle.dt === 0 ? 0 : -source.leftHandle.dt, dv: source.leftHandle.dv };
    if (source.rightHandle) key.leftHandle = { dt: source.rightHandle.dt === 0 ? 0 : -source.rightHandle.dt, dv: source.rightHandle.dv };
    if (arriving?.easing) { const [x1, y1, x2, y2] = arriving.easing; key.easing = [1 - x2, 1 - y2, 1 - x1, 1 - y1]; }
  }
}
/** Moves every key so that it stays on its source frame: `map` takes an old local time to the new one (frame-snapped, clamped). */
function remapKeys(element: El, map: (time: number) => number, scale = 1): void {
  for (const keys of channelLists(element)) {
    const byTime = new Map<number, Key>();
    // Keys that collide after snapping keep the last one in original time order.
    for (const key of keys) { const time = map(key.time); byTime.set(time, Object.assign(key, { time, ...(key.rightHandle ? { rightHandle: { dt: Math.max(0, Math.round(key.rightHandle.dt * scale)), dv: key.rightHandle.dv } } : {}), ...(key.leftHandle ? { leftHandle: { dt: Math.min(0, Math.round(key.leftHandle.dt * scale)), dv: key.leftHandle.dv } } : {}) })); }
    const next = [...byTime.values()].sort((a, b) => a.time - b.time);
    next.forEach((key, index) => {
      if (key.rightHandle && next[index + 1]) key.rightHandle.dt = Math.min(key.rightHandle.dt, next[index + 1].time - key.time);
      if (key.leftHandle && next[index - 1]) key.leftHandle.dt = Math.max(key.leftHandle.dt, next[index - 1].time - key.time);
    });
    keys.splice(0, keys.length, ...next);
  }
}
/** Clip animations and fades keep their timeline length, clamped by the element's new duration. */
function clampTimed(element: El): void {
  const duration = element.duration, animation = element.clipAnimation as Json | undefined;
  if (isObject(animation)) {
    const slotIn = animation.in as Json | undefined, slotOut = animation.out as Json | undefined, combo = animation.combo as Json | undefined;
    if (isObject(slotIn)) slotIn.duration = Math.min(Number(slotIn.duration), duration);
    if (isObject(slotOut)) slotOut.duration = Math.min(Number(slotOut.duration), duration - (isObject(slotIn) ? Number(slotIn.duration) : 0));
    if (isObject(combo)) combo.duration = combo.followsDuration !== false ? duration : Math.min(Number(combo.duration), duration);
  }
  for (const name of ["fadeIn", "fadeOut"]) { const fade = element[name] as Json | undefined; if (isObject(fade) && typeof fade.duration === "number") fade.duration = Math.min(fade.duration, duration); }
}

export type SpeedChange = {
  rate?: number;
  /** A preset id, explicit points, or `null` to remove the curve. */
  curve?: { preset: string } | { points: CurvePoint[]; preset?: string } | null;
  reverse?: boolean; maintainPitch?: boolean; smooth?: "none" | "blend" | "flow";
  /** A requested duration in ticks: sets `rate = source span / duration`. */
  duration?: number;
};
const NEUTRAL = (retime: Retime): boolean => (retime.rate ?? 1) === 1 && retime.curve === undefined && retime.reverse !== true && (retime.smooth ?? "none") === "none";

/** Applies a speed change to one element of a draft: retime, duration, keyframes, timed slots. Returns the growth in ticks. */
function retimeOne(scene: Sc, track: Tr, element: El, change: SpeedChange, fps: Rational, flowing: boolean, counts: { retimed: number; locked: number }): number {
  if (!isRetimable(element)) refuse("Select a video or audio clip", "not-retimable");
  const before = retimeOf(element), oldClip = retimeClipOf(element as never), oldDuration = element.duration, span = oldClip.sourceSpan;
  const next: Retime = { rate: 1, maintainPitch: false, reverse: false, smooth: "none", ...(before ?? {}) };
  // The first speed change of a clip made here keeps the pitch.
  if (!before && change.maintainPitch === undefined && (change.rate !== undefined || change.duration !== undefined || change.curve)) next.maintainPitch = true;
  if (change.maintainPitch !== undefined) next.maintainPitch = change.maintainPitch;
  if (change.smooth !== undefined) next.smooth = change.smooth;
  if (change.reverse !== undefined) next.reverse = change.reverse;
  if (change.duration !== undefined) { next.rate = rateForDuration(span, change.duration, fps).rate; delete next.curve; }
  if (change.rate !== undefined) { next.rate = Math.min(SPEED_LIMITS.max, Math.max(SPEED_LIMITS.min, change.rate)); delete next.curve; }
  if (change.curve === null) { delete next.curve; if (change.rate === undefined && change.duration === undefined) next.rate = 1; }
  else if (change.curve) {
    if (element.type === "compound") refuse("Not available for compound clips", "compound-curve");
    const preset = "points" in change.curve ? change.curve.preset ?? "custom" : change.curve.preset;
    const points = "points" in change.curve ? change.curve.points : preset === "custom" ? (before?.curve?.preset === "custom" && speedCurveOf(element) ? before.curve.points : CUSTOM_CURVE_POINTS) : SPEED_CURVE_PRESETS[preset]?.points;
    if (!points) refuse(`"${preset}" is not a speed curve preset`, "INVALID_PARAMS");
    next.curve = { preset, points: points!.map((point) => ({ u: point.u, rate: point.rate })) };
  }
  // A curve that is stored but not usable is dropped by the first edit.
  if (next.curve && !validCurve({ curve: next.curve.points }) && next.curve.points.length <= SPEED_LIMITS.maxPoints) delete next.curve;
  const spec = specOf(next);
  const timing = hasSpan(element), duration = timing ? retimedDuration(span, spec, fps) : oldDuration;
  if (duration > SPEED_LIMITS.maxDuration || duration > MAX_ELEMENT_DURATION) refuse(TOO_LONG_MESSAGE, "too-long");
  const growth = duration - oldDuration;
  if (growth > 0 && !flowing) {
    const following = Math.min(Infinity, ...track.elements.filter((other) => other !== element && other.startTime >= endOf(element)).map((other) => other.startTime));
    if (element.startTime + duration > following) refuse(NO_ROOM_MESSAGE, "no-room");
  }
  if (next.curve) next.rate = Math.min(100, Math.max(0.01, Math.round((span / Math.max(1, duration)) * 1e6) / 1e6));
  // Keys stay on their source frames: out through the old map, back through the new one.
  const reversing = (before?.reverse === true) !== (next.reverse === true);
  const newClip = { ...oldClip, duration, retime: spec };
  if (reversing && duration === oldDuration) for (const keys of channelLists(element)) reverseKeys(keys, duration);
  else if (growth !== 0 || reversing || before?.curve !== next.curve) remapKeys(element, (time) => Math.min(duration, Math.max(0, snapToFrame(clipTimeAt(newClip, sourceTimeAt(oldClip, time)), fps))), duration / Math.max(1, oldDuration));
  // Captions made from this clip's sound stay on their words.
  for (const captions of tracksOfScene(scene)) {
    if (captions.type !== "caption" || (captions as unknown as Json).sourceId !== element.id) continue;
    if (captions.locked) { counts.locked += captions.elements.length; continue; }
    const frame = frameTicks(fps);
    for (const caption of captions.elements) {
      const local = (time: number) => snapToFrame(clipTimeAt(newClip, sourceTimeAt(oldClip, Math.min(oldDuration, Math.max(0, time - element.startTime)))), fps);
      const a = local(caption.startTime), b = local(endOf(caption)), start = Math.min(a, b);
      caption.startTime = element.startTime + start; caption.duration = Math.max(frame, Math.abs(b - a));
      counts.retimed++;
    }
    captions.elements.sort((a, b) => a.startTime - b.startTime);
  }
  element.duration = duration;
  if (NEUTRAL(next)) delete element.retime; else element.retime = next as unknown as Json;
  clampTimed(element);
  if (flowing && growth > 0) for (const other of track.elements) if (other !== element && other.startTime >= element.startTime + oldDuration) other.startTime += growth;
  return growth;
}
const hasSpan = (element: El): boolean => typeof element.sourceDuration === "number" || element.type === "compound";

/**
 * Changes the speed of elements as one step. A linked audio or video partner changes with its clip. The element keeps
 * its start; with ripple or the main-track magnet the followers move with its end, otherwise a result that would
 * overlap the next clip is refused. `info` counts the captions that moved with it.
 */
export const setSpeed = (options: { sceneId: string; elementIds: string[]; change: SpeedChange; label?: string; coalesce?: string }): TimelineCommand<{ captionsRetimed: number; captionsLocked: number; durations: Record<string, number> }> => ({
  type: "timeline.speed", label: options.label ?? (options.change.reverse !== undefined && Object.keys(options.change).length === 1 ? (options.change.reverse ? "Reverse" : "Reverse off") : "Speed"), sceneId: options.sceneId, coalesce: options.coalesce,
  run(draft, env) {
    const scene = sceneById(draft, options.sceneId), fps = fpsOf(draft), counts = { retimed: 0, locked: 0 };
    const all = tracksOfScene(scene).flatMap((track) => track.elements.map((element) => ({ track, element })));
    const direct = all.filter((hit) => options.elementIds.includes(hit.element.id));
    // The extracted sound of a clip (or the clip of a sound) follows while the two are linked.
    const links = new Set(direct.map((hit) => hit.element.linkId).filter((id): id is string => id !== null));
    const targets = env.edit.linkage === false ? direct : all.filter((hit) => options.elementIds.includes(hit.element.id) || (hit.element.linkId !== null && links.has(hit.element.linkId) && isRetimable(hit.element)));
    const durations: Record<string, number> = {};
    for (const { track, element } of targets) {
      if (track.locked) refuse("The track is locked", "track-locked");
      const flowing = env.edit.ripple || (track === scene.tracks.main && env.edit.magnet && !env.edit.freeLayer);
      retimeOne(scene, track, element, options.change, fps, flowing, counts);
      durations[element.id] = element.duration;
    }
    return { info: { captionsRetimed: counts.retimed, captionsLocked: counts.locked, durations } };
  },
});

// — Trim and split through the time map —
/** The source ticks one timeline tick consumes at an edge of the clip: the constant rate, or the curve's rate at that end of the span. */
export function edgeRate(element: El, edge: "sourceStart" | "sourceEnd"): number {
  const curve = speedCurveOf(element);
  if (curve) return curve[edge === "sourceStart" ? 0 : curve.length - 1].rate;
  const rate = retimeOf(element)?.rate;
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0 ? rate : 1;
}
/**
 * Re-cuts the visible source span of an element to `[from, to]` (ticks from its current first visible source tick;
 * outside the current span the clip extends at its end rate) and crops its curve to that part.
 */
export function recutSource(element: El, from: number, to: number): void {
  const span = sourceSpanOf(element), curve = speedCurveOf(element);
  element.trimStart = Math.max(0, element.trimStart + from);
  element.trimEnd = Math.max(0, element.trimEnd + (span - to));
  if (!curve || span <= 0) return;
  const retime = element.retime as unknown as Retime;
  retime.curve = { preset: "custom", points: cropCurve(curve, from / span, to / span) };
  retime.rate = Math.min(100, Math.max(0.01, Math.round(((to - from) / Math.max(1, element.duration)) * 1e6) / 1e6));
}
/** The source tick (from the first visible one) under an element-local time, read through the time map. */
export function sourceOffsetAt(element: El, local: number): number {
  const clip = retimeClipOf(element as never);
  return sourceTimeAt(clip, local) - clip.sourceStart;
}
export { roundHalfAway as roundSourceTick };

/**
 * The times (element-local to the anchor's element) a dragged keyframe snaps to: the playhead, markers, the owning
 * element's start and end, and keys of other channels and other elements — never a key of the moving selection.
 */
export function keySnapTargets(doc: import("@jagentchill/protocol").ProjectDocument, sceneId: string, moving: { elementId: string; path: string; keyId: string }[], options: { playhead: number; beats?: number[] }): number[] {
  const scene = sceneById(doc, sceneId), owner = tracksOfScene(scene).flatMap((track) => track.elements).find((element) => element.id === moving[0]?.elementId);
  if (!owner) return [];
  const mine = new Set(moving.map((ref) => `${ref.elementId}|${ref.keyId}`));
  const local = (time: number) => time - owner.startTime, times = new Set<number>([local(options.playhead), 0, owner.duration]);
  for (const marker of ((scene as unknown as Json).markers ?? []) as { time: number }[]) times.add(local(marker.time));
  for (const beat of options.beats ?? []) times.add(local(beat));
  for (const element of tracksOfScene(scene).flatMap((track) => track.elements)) for (const keys of channelLists(element)) for (const key of keys) if (!mine.has(`${element.id}|${key.id}`)) times.add(local(element.startTime + key.time));
  return [...times].filter((time) => time >= 0 && time <= owner.duration).sort((a, b) => a - b);
}
