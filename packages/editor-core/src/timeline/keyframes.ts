import { isObject, type Json } from "../model.ts";

type Key = Json & { id: string; time: number; value: unknown };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Value of a cubic Bézier segment between two scalar keys at `time`, with the keys' handles (absent: a third of the span, flat). */
function bezierValue(from: Key, to: Key, time: number): number {
  const span = to.time - from.time, a = from.value as number, b = to.value as number;
  const out = (from.rightHandle as { dt: number; dv: number } | undefined) ?? { dt: span / 3, dv: 0 }, inn = (to.leftHandle as { dt: number; dv: number } | undefined) ?? { dt: -span / 3, dv: 0 };
  const x1 = Math.min(span, Math.max(0, out.dt)), x2 = Math.min(span, Math.max(0, span + inn.dt)), target = time - from.time;
  const cubic = (p1: number, p2: number, p3: number, s: number) => 3 * (1 - s) ** 2 * s * p1 + 3 * (1 - s) * s * s * p2 + s ** 3 * p3;
  let low = 0, high = 1;
  for (let step = 0; step < 40; step++) { const mid = (low + high) / 2; if (cubic(x1, x2, span, mid) < target) low = mid; else high = mid; }
  const s = (low + high) / 2;
  return (1 - s) ** 3 * a + 3 * (1 - s) ** 2 * s * (a + out.dv) + 3 * (1 - s) * s * s * (b + inn.dv) + s ** 3 * b;
}

/** The value a list of keys gives at a local time: held outside the keys, interpolated by the segment type inside. */
export function valueAt(keys: Key[], time: number): unknown {
  if (keys.length === 0) return undefined;
  if (time <= keys[0].time) return keys[0].value;
  const last = keys[keys.length - 1];
  if (time >= last.time) return last.value;
  const index = keys.findIndex((key) => key.time > time), from = keys[index - 1], to = keys[index];
  if (from.time === time) return from.value;
  if (typeof from.value === "number" && typeof to.value === "number") {
    const segment = from.segmentToNext ?? "linear";
    if (segment === "step") return from.value;
    return segment === "bezier" ? bezierValue(from, to, time) : lerp(from.value, to.value, (time - from.time) / (to.time - from.time));
  }
  const a = (from.value as Json | undefined)?.points, b = (to.value as Json | undefined)?.points;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length && from.segmentToNext !== "step") {
    const t = (time - from.time) / (to.time - from.time);
    return { points: a.map((point: Json, at: number) => Object.fromEntries(Object.entries(point).map(([key, value]) => [key, typeof value === "number" ? lerp(value, (b[at] as Json)[key] as number, t) : value]))) };
  }
  return from.value;
}

const round6 = (value: unknown) => (typeof value === "number" ? Math.round(value * 1e6) / 1e6 : value);
/**
 * Restricts a key list to the local window `[from, to]` and re-bases it to start at 0. A key outside the window is
 * dropped and a boundary key holding the interpolated value takes its place on that edge, so the picture at every
 * remaining time is what it was. `boundaryId` hands out the id of a boundary key (shared by the parts of a colour).
 */
function windowKeys(keys: Key[], from: number, to: number, boundaryId: (edge: "start" | "end") => string, rekey?: (id: string) => string): Key[] {
  if (keys.length === 0) return keys;
  const inside = keys.filter((key) => key.time >= from && key.time <= to).map((key) => ({ ...key, id: rekey ? rekey(key.id) : key.id, time: key.time - from }) as Key);
  const boundary = (edge: "start" | "end", time: number): Key => {
    const near = edge === "start" ? keys.find((key) => key.time > time) ?? keys[keys.length - 1] : [...keys].reverse().find((key) => key.time < time) ?? keys[0];
    const { leftHandle: _l, rightHandle: _r, ...shape } = near;
    return { ...shape, id: boundaryId(edge), time: time - from, value: round6(valueAt(keys, time)) } as Key;
  };
  if (keys.some((key) => key.time < from) && !inside.some((key) => key.time === 0)) inside.unshift(boundary("start", from));
  if (keys.some((key) => key.time > to) && !inside.some((key) => key.time === to - from)) inside.push(boundary("end", to));
  // A channel whose keys all lay outside keeps its held value through one key.
  if (inside.length === 0) inside.push(boundary(keys[0].time > to ? "end" : "start", keys[0].time > to ? to : from));
  // Handles never reach past the neighbouring key after the cut.
  inside.forEach((key, index) => {
    const next = inside[index + 1], previous = inside[index - 1];
    if (isObject(key.rightHandle) && next) (key.rightHandle as Json).dt = Math.min(key.rightHandle.dt as number, next.time - key.time);
    if (isObject(key.leftHandle) && previous) (key.leftHandle as Json).dt = Math.max(key.leftHandle.dt as number, previous.time - key.time);
  });
  return inside;
}

/**
 * Restricts every animation channel of an element to the local window `[from, to]`, re-based to 0: the keyframe part
 * of trim and split. `rekeyAll`: the result belongs to a copy, so kept keys receive new ids too.
 */
export function windowAnimations(element: Json, from: number, to: number, newId: () => string, rekeyAll = false): void {
  if (!isObject(element.animations)) return;
  for (const channel of Object.values(element.animations) as Json[]) {
    const fresh = new Map<string, string>(), edges = new Map<string, string>();
    const rekey = rekeyAll ? (id: string) => { if (!fresh.has(id)) fresh.set(id, newId()); return fresh.get(id)!; } : undefined;
    const boundaryId = (edge: "start" | "end") => { if (!edges.has(edge)) edges.set(edge, newId()); return edges.get(edge)!; };
    if ("r" in channel) for (const part of ["r", "g", "b", "a"]) (channel[part] as Json).keys = windowKeys((channel[part] as Json).keys as Key[], from, to, boundaryId, rekey);
    else channel.keys = windowKeys(channel.keys as Key[], from, to, boundaryId, rekey);
  }
}
/** Shifts every key by `delta` local ticks (an element that grew to the left keeps its keys on the same content). */
export function shiftAnimations(element: Json, delta: number): void {
  if (!isObject(element.animations) || delta === 0) return;
  for (const channel of Object.values(element.animations) as Json[]) {
    for (const part of "r" in channel ? ["r", "g", "b", "a"].map((name) => channel[name] as Json) : [channel]) for (const key of part.keys as Key[]) key.time += delta;
  }
}
