import type { ColorChannel, ScalarChannel, ScalarKey } from "@jagentchill/protocol";

/**
 * Evaluation of animated properties at a clip time (the frame START time minus the element start). Step, linear
 * and bezier segments; colours are stored and interpolated in linear light.
 */

const cubic = (a: number, b: number, c: number, d: number, s: number): number => {
  const inverse = 1 - s;
  return inverse * inverse * inverse * a + 3 * inverse * inverse * s * b + 3 * inverse * s * s * c + s * s * s * d;
};

/** Control points of the bezier between two keys: the outgoing key's right handle and the next key's left handle. */
function bezierPoints(from: ScalarKey, to: ScalarKey): { t: [number, number, number, number]; v: [number, number, number, number] } {
  const span = to.time - from.time;
  const right = from.rightHandle ?? { dt: span / 3, dv: 0 };
  const left = to.leftHandle ?? { dt: -span / 3, dv: 0 };
  // Handles never leave the segment in time, so the curve stays a function of time.
  const t1 = Math.min(Math.max(from.time + right.dt, from.time), to.time);
  const t2 = Math.min(Math.max(to.time + left.dt, from.time), to.time);
  return { t: [from.time, t1, t2, to.time], v: [from.value, from.value + right.dv, to.value + left.dv, to.value] };
}

function bezierValue(from: ScalarKey, to: ScalarKey, time: number): number {
  const { t, v } = bezierPoints(from, to);
  // time(s) is monotone on [0, 1]: bisection finds s to well under a tick.
  let low = 0, high = 1;
  for (let step = 0; step < 48; step++) {
    const middle = (low + high) / 2;
    if (cubic(t[0], t[1], t[2], t[3], middle) < time) low = middle; else high = middle;
  }
  return cubic(v[0], v[1], v[2], v[3], (low + high) / 2);
}

/** Slope (value per tick) of the segment `from → to` at one of its ends. */
function slopeAt(from: ScalarKey, to: ScalarKey, atEnd: boolean): number {
  if (from.segmentToNext === "step") return 0;
  if (from.segmentToNext === "linear") return (to.value - from.value) / (to.time - from.time);
  const { t, v } = bezierPoints(from, to);
  const [dt, dv] = atEnd ? [t[3] - t[2], v[3] - v[2]] : [t[1] - t[0], v[1] - v[0]];
  return dt === 0 ? 0 : dv / dt;
}

/** Value of a scalar channel at `time` (ticks, element-local). */
export function evaluateScalar(channel: ScalarChannel, time: number): number {
  const keys = channel.keys;
  const first = keys[0], last = keys[keys.length - 1];
  if (time <= first.time) {
    if (time === first.time || channel.extrapolation?.before !== "linear" || keys.length < 2) return first.value;
    return first.value + slopeAt(first, keys[1], false) * (time - first.time);
  }
  if (time >= last.time) {
    if (time === last.time || channel.extrapolation?.after !== "linear" || keys.length < 2) return last.value;
    return last.value + slopeAt(keys[keys.length - 2], last, true) * (time - last.time);
  }
  let low = 0, high = keys.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (keys[middle].time <= time) low = middle; else high = middle;
  }
  const from = keys[low], to = keys[high];
  if (from.segmentToNext === "step") return from.value;
  if (from.segmentToNext === "bezier") return bezierValue(from, to, time);
  return from.value + (to.value - from.value) * ((time - from.time) / (to.time - from.time));
}

const srgbFromLinear = (value: number): number => {
  const clamped = Math.min(Math.max(value, 0), 1);
  return clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
};
export const linearFromSrgb = (value: number): number => (value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4));
const hex = (value: number): string => Math.round(Math.min(Math.max(value, 0), 1) * 255).toString(16).padStart(2, "0");

/** Value of a colour channel at `time` as `#rrggbb` or `#rrggbbaa`: components interpolate in linear RGB. */
export function evaluateColor(channel: ColorChannel, time: number): string {
  const [r, g, b] = [channel.r, channel.g, channel.b].map((component) => srgbFromLinear(evaluateScalar(component, time)));
  const alpha = evaluateScalar(channel.a, time);
  return `#${hex(r)}${hex(g)}${hex(b)}${alpha >= 1 ? "" : hex(alpha)}`;
}

type Animated = { animations?: Record<string, unknown> };
const read = (element: unknown, path: string): unknown => path.split(".").reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], element);

/** A numeric property of an element at a clip time: its animation channel when it has one, else the stored value. */
export function resolveNumber(element: Animated, path: string, clipTime: number, fallback: number): number {
  const channel = element.animations?.[path] as ScalarChannel | undefined;
  if (channel?.keys?.length) return evaluateScalar(channel, clipTime);
  const stored = read(element, path);
  return typeof stored === "number" && Number.isFinite(stored) ? stored : fallback;
}

export function resolveColor(element: Animated, path: string, clipTime: number, fallback: string): string {
  const channel = element.animations?.[path] as ColorChannel | undefined;
  if (channel?.r?.keys?.length) return evaluateColor(channel, clipTime);
  const stored = read(element, path);
  return typeof stored === "string" ? stored : fallback;
}

/** `#rgb`, `#rrggbb` or `#rrggbbaa` to straight RGBA in 0…1. */
export function parseHexColor(text: string): [number, number, number, number] {
  let digits = text.replace(/^#/, "");
  if (digits.length === 3 || digits.length === 4) digits = [...digits].map((digit) => digit + digit).join("");
  const part = (index: number) => parseInt(digits.slice(index, index + 2), 16) / 255;
  if (!/^[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(digits)) return [0, 0, 0, 1];
  return [part(0), part(2), part(4), digits.length === 8 ? part(6) : 1];
}
