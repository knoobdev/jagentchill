// Writes `fixtures/time-vectors.json`, the cases the TypeScript time API and the Rust `time` crate must both answer.
//
// The base cases are computed here by a reference written directly from the requirement text in exact `BigInt`
// arithmetic, not by the module under test. The curve cases of the retime section have no closed form: their expected
// values come from `src/time/retime.ts`, and the file exists so that the Rust crate is held to the same ticks (the
// preset durations of the specification anchor them in `test/time-03-retime.test.ts`).
//
//   node scripts/gen-time-vectors.ts          writes the file
//   node scripts/gen-time-vectors.ts --check  exits 1 when the committed file differs
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { clipTimeAt, retimedDuration, sourceTimeAt, type RetimeClip, type RetimeSpec } from "../src/time/retime.ts";

type Rate = { numerator: number; denominator: number };
type Case = { op: string; args: Record<string, unknown>; expect?: unknown; error?: string };

const TPS = 120_000n;
const MAX = BigInt(Number.MAX_SAFE_INTEGER);
const DAY = 10_368_000_000;

// A fixed linear congruential generator: the file is the same on every run.
let seed = 0x2545f491;
const random = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const randomInt = (min: number, max: number): number => min + Math.floor(random() * (max - min + 1));

const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b));
class Refused extends Error { readonly code: string; constructor(code: string) { super(code); this.code = code; } }
function reduced(rate: Rate): { num: bigint; den: bigint } {
  if (!Number.isInteger(rate.numerator) || !Number.isInteger(rate.denominator) || rate.numerator < 1 || rate.denominator < 1) throw new Refused("time/invalid-frame-rate");
  const divisor = gcd(BigInt(rate.numerator), BigInt(rate.denominator));
  const num = BigInt(rate.numerator) / divisor, den = BigInt(rate.denominator) / divisor;
  if (num > 1_000_000n || den > 1_000_000n) throw new Refused("time/invalid-frame-rate");
  return { num, den };
}
const safe = (value: bigint): number => { if (value > MAX || value < -MAX) throw new Refused("time/out-of-range"); return Number(value); };
/** Frame time by the decomposition of "Frame-rate rationals and frame snapping". */
function frameTime(frame: bigint, rate: Rate): bigint {
  const { num, den } = reduced(rate);
  const n = frame < 0n ? -frame : frame;
  const q = n / num, r = n % num;
  const a = r * TPS * den;
  const ticks = q * (TPS * den) + (2n * a + num) / (2n * num);
  return frame < 0n ? -ticks : ticks;
}
function frameIndex(ticks: bigint, rate: Rate): bigint {
  const { num, den } = reduced(rate);
  let frame = (ticks * num) / (TPS * den) - 2n;
  while (frameTime(frame + 1n, rate) <= ticks) frame += 1n;
  return frame;
}
const reference: Record<string, (args: any) => unknown> = {
  mediaTime: ({ value }) => { if (!Number.isInteger(value)) throw new Refused("time/non-integer-ticks"); return safe(BigInt(value)); },
  mediaTimeFromSeconds: ({ seconds }) => { const ticks = Math.sign(seconds) * Math.round(Math.abs(seconds * 120_000)); if (!(Math.abs(ticks) <= Number.MAX_SAFE_INTEGER)) throw new Refused("time/out-of-range"); return ticks + 0; },
  mediaTimeToSeconds: ({ time }) => time / 120_000,
  mediaTimeFromFrame: ({ frame, rate }) => safe(frameTime(BigInt(frame), rate)),
  mediaTimeToFrame: ({ time, rate }) => safe(frameIndex(BigInt(time), rate)),
  floorToFrame: ({ time, rate }) => safe(frameTime(frameIndex(BigInt(time), rate), rate)),
  roundToFrame: ({ time, rate }) => {
    const ticks = BigInt(time), index = frameIndex(ticks, rate);
    const below = frameTime(index, rate), above = frameTime(index + 1n, rate);
    const down = ticks - below, up = above - ticks;
    return safe(down < up ? below : up < down ? above : ticks < 0n ? below : above);
  },
  isFrameAligned: ({ time, rate }) => frameTime(frameIndex(BigInt(time), rate), rate) === BigInt(time),
  lastFrameTime: ({ duration, rate }) => {
    reduced(rate);
    let last = 0n;
    if (BigInt(duration) > 0n) { const index = frameIndex(BigInt(duration), rate); if (index >= 1n) last = frameTime(index - 1n, rate); }
    return safe(last);
  },
  snappedSeekTime: ({ time, duration, rate }) => {
    const last = BigInt(reference.lastFrameTime({ duration, rate }) as number);
    const clamped = BigInt(time) < 0n ? 0n : BigInt(time) > last ? last : BigInt(time);
    return safe(frameTime(frameIndex(clamped, rate), rate));
  },
  mediaTimeAdd: ({ lhs, rhs }) => safe(BigInt(lhs) + BigInt(rhs)),
  mediaTimeSub: ({ lhs, rhs }) => safe(BigInt(lhs) - BigInt(rhs)),
  mediaTimeMin: ({ lhs, rhs }) => (lhs < rhs ? lhs : rhs),
  mediaTimeMax: ({ lhs, rhs }) => (lhs > rhs ? lhs : rhs),
  mediaTimeClamp: ({ time, min, max }) => (time < min ? min : time > max ? max : time),
  guessTimecodeFormat: ({ timeCode }) => {
    const parts = String(timeCode).trim().split(":");
    if (String(timeCode).trim() === "" || !parts.every((part) => /^\+?[0-9]+$/.test(part) && BigInt(part) <= 4294967295n)) return null;
    return ({ 2: "MM:SS", 3: "HH:MM:SS", 4: "HH:MM:SS:FF" } as Record<number, string>)[parts.length] ?? null;
  },
  formatTimecode: ({ time, format, rate }) => {
    const total = BigInt(time) < 0n ? 0n : BigInt(time);
    const pad = (value: bigint) => value.toString().padStart(2, "0");
    const hours = total / (3600n * TPS), minutes = (total % (3600n * TPS)) / (60n * TPS), seconds = (total / TPS) % 60n, within = total % TPS;
    const kind = format ?? "HH:MM:SS:CS";
    if (kind === "MM:SS") return `${pad(minutes)}:${pad(seconds)}`;
    if (kind === "HH:MM:SS") return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    if (kind === "HH:MM:SS:CS") return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(within / 1200n)}`;
    if (!rate) return null;
    try { return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(frameIndex(within, rate))}`; } catch { return null; }
  },
  parseTimecode: ({ timeCode, format, rate }) => {
    const text = String(timeCode).trim(), parts = text.split(":");
    if (text === "" || !parts.every((part) => /^\+?[0-9]+$/.test(part) && BigInt(part) <= 4294967295n)) return null;
    const values = parts.map((part) => BigInt(part));
    const kind = format ?? "HH:MM:SS:CS";
    if (kind === "MM:SS") return values.length === 2 && values[1] < 60n ? Number((values[0] * 60n + values[1]) * TPS) : null;
    if (values.length !== (kind === "HH:MM:SS" ? 3 : 4) || values[1] >= 60n || values[2] >= 60n) return null;
    const base = (values[0] * 3600n + values[1] * 60n + values[2]) * TPS;
    if (kind === "HH:MM:SS") return Number(base);
    if (kind === "HH:MM:SS:CS") return values[3] < 100n ? Number(base + values[3] * 1200n) : null;
    if (!rate) return null;
    try {
      const { num, den } = reduced(rate);
      if (values[3] >= (2n * num + den) / (2n * den)) return null;
      return Number(base + frameTime(values[3], rate));
    } catch { return null; }
  },
};

const base: Case[] = [];
function add(op: string, args: Record<string, unknown>): void {
  try {
    const expect = reference[op](args);
    base.push({ op, args, expect: expect === undefined ? null : expect });
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    base.push({ op, args, error: error.code });
  }
}

const PRESETS: Rate[] = [[24000, 1001], [24, 1], [25, 1], [30000, 1001], [30, 1], [48, 1], [50, 1], [60000, 1001], [60, 1], [120, 1]].map(([numerator, denominator]) => ({ numerator, denominator }));
const UNEVEN: Rate[] = [[7, 1], [10, 3], [1, 1], [2997, 100], [29_970_000, 1_000_000], [15, 2], [1, 7]].map(([numerator, denominator]) => ({ numerator, denominator }));
const EXTREME: Rate[] = [[1_000_000, 1], [1, 1_000_000], [1_000_000, 999_983], [999_983, 1_000_000], [1_000_000, 1001], [24, 1_000_000]].map(([numerator, denominator]) => ({ numerator, denominator }));
const BAD: Rate[] = [[2_000_003, 1], [1, 2_000_003], [0, 1], [30, 0], [1_000_001, 1], [3_000_001, 2]].map(([numerator, denominator]) => ({ numerator, denominator }));

// Every preset frame rate: fixed landmarks, negatives, zero, 24 hours, and random times.
for (const rate of PRESETS) {
  const frame = Number(frameTime(1n, rate));
  const times = [0, 1, -1, frame - 1, frame, frame + 1, Math.floor(frame / 2), Math.floor(frame / 2) + 1, -frame, -Math.floor(frame / 2), -frame - 1,
    120_000, 432_000_000, DAY, DAY - 1, DAY + 1, -DAY, 5_999, 6_000, 364_000, 600_000];
  for (let index = 0; index < 22; index++) times.push(randomInt(-DAY, DAY));
  for (const time of times) {
    add("mediaTimeToFrame", { time, rate });
    add("floorToFrame", { time, rate });
    add("roundToFrame", { time, rate });
    add("isFrameAligned", { time, rate });
  }
  for (const frameNumber of [0, 1, 2, -1, -2, 29, 30, 215_784, 1000, -1000, 1_000_000, Number(frameIndex(BigInt(DAY), rate)), randomInt(0, 3_000_000), randomInt(-3_000_000, 0)]) {
    add("mediaTimeFromFrame", { frame: frameNumber, rate });
  }
  for (const duration of [0, 1, frame - 1, frame, frame + 1, 2 * frame, 600_000, 598_000, DAY, -5, randomInt(0, DAY), randomInt(0, 1_000_000)]) {
    add("lastFrameTime", { duration, rate });
    for (const time of [-1, 0, duration, duration + frame, 1_000_000, randomInt(0, Math.max(1, duration))]) add("snappedSeekTime", { time, duration, rate });
  }
  for (const time of [0, 364_000, 180_000, DAY, 432_000_000 + 7 * frame, -4, randomInt(0, DAY), randomInt(0, DAY)]) {
    for (const format of ["MM:SS", "HH:MM:SS", "HH:MM:SS:CS", "HH:MM:SS:FF", undefined]) add("formatTimecode", { time, ...(format ? { format } : {}), rate });
    add("formatTimecode", { time, format: "HH:MM:SS:FF" });
  }
  for (const timeCode of ["00:00:03:01", "00:00:01:30", "00:00:01:29", "01:05", "00:00:01", "1:2:3:4", "00:60:00:00", "00:00:60:00", "", "  00:00:02:10 ", "a:b", "00:00:01:-1", "23:59:59:23", "00:00:01:24", "00:00:00:99", "+1:+2", "1::2", "4294967296:00", "00:00:01.5"]) {
    add("guessTimecodeFormat", { timeCode });
    for (const format of ["MM:SS", "HH:MM:SS", "HH:MM:SS:CS", "HH:MM:SS:FF", undefined]) add("parseTimecode", { timeCode, ...(format ? { format } : {}), rate });
  }
}
// Uneven rationals and rationals at the bounds, evaluated around zero and at 24 hours.
for (const rate of [...UNEVEN, ...EXTREME]) {
  const atDay = Number(frameIndex(BigInt(DAY), rate));
  for (const frame of [0, 1, 2, 6, 7, 8, -1, -7, 100_000, atDay, atDay + 1, atDay - 1, -atDay, randomInt(0, Math.max(1, atDay))]) add("mediaTimeFromFrame", { frame, rate });
  for (const time of [0, 1, -1, 17_142, 17_143, 17_144, 60_000, DAY, DAY - 1, DAY + 1, -DAY, randomInt(-DAY, DAY), randomInt(0, DAY), randomInt(0, 10_000_000)]) {
    add("mediaTimeToFrame", { time, rate });
    add("floorToFrame", { time, rate });
    add("roundToFrame", { time, rate });
    add("isFrameAligned", { time, rate });
    add("lastFrameTime", { duration: time, rate });
    add("snappedSeekTime", { time: randomInt(-10, DAY), duration: time, rate });
  }
}
// Frame 0…100 000 at 7/1 in steps, the drift scenario.
for (let frame = 0; frame <= 100_000; frame += 997) add("mediaTimeFromFrame", { frame, rate: { numerator: 7, denominator: 1 } });
for (const rate of BAD) {
  add("mediaTimeFromFrame", { frame: 10, rate });
  add("mediaTimeToFrame", { time: 1000, rate });
  add("roundToFrame", { time: 1000, rate });
  add("floorToFrame", { time: 1000, rate });
  add("isFrameAligned", { time: 1000, rate });
  add("lastFrameTime", { duration: 1000, rate });
  add("snappedSeekTime", { time: 10, duration: 1000, rate });
}
// Results that leave the safe integer range.
add("mediaTimeFromFrame", { frame: Number.MAX_SAFE_INTEGER, rate: { numerator: 1, denominator: 1_000_000 } });
add("mediaTimeFromFrame", { frame: 80_000_000_000, rate: { numerator: 1, denominator: 1 } });
add("mediaTimeFromFrame", { frame: 75_059_993_789, rate: { numerator: 1, denominator: 1 } });
add("mediaTimeAdd", { lhs: Number.MAX_SAFE_INTEGER, rhs: 1 });
add("mediaTimeSub", { lhs: -Number.MAX_SAFE_INTEGER, rhs: 1 });
for (const value of [0, 1, -1, 1000, 1000.5, -0.25, DAY, Number.MAX_SAFE_INTEGER, 1e300]) add("mediaTime", { value });
for (const seconds of [0, 1, 3600, 86_400, -1, 1.5, 0.5 / 120_000, -0.5 / 120_000, 1.5 / 120_000, 2.5 / 120_000, 1 / 3, -1 / 3, 0.1, 1e-9, 12_345.678_9, 1e12, 1e13, -1e13, 1 / 120_000, 1001 / 30_000]) add("mediaTimeFromSeconds", { seconds });
for (let index = 0; index < 60; index++) add("mediaTimeFromSeconds", { seconds: (random() - 0.5) * 2 * 86_400 });
for (const time of [0, 1, -1, 120_000, 432_000_000, DAY, 4004, 5005, -5005, Number.MAX_SAFE_INTEGER]) add("mediaTimeToSeconds", { time });
for (let index = 0; index < 40; index++) add("mediaTimeToSeconds", { time: randomInt(-DAY, DAY) });
for (let index = 0; index < 60; index++) {
  const lhs = randomInt(-DAY, DAY), rhs = randomInt(-DAY, DAY), third = randomInt(-DAY, DAY);
  add("mediaTimeAdd", { lhs, rhs });
  add("mediaTimeSub", { lhs, rhs });
  add("mediaTimeMin", { lhs, rhs });
  add("mediaTimeMax", { lhs, rhs });
  add("mediaTimeClamp", { time: third, min: Math.min(lhs, rhs), max: Math.max(lhs, rhs) });
}

// ---- retime ----
const CURVES: Record<string, [number, number][]> = {
  montage: [[0, 0.9], [0.25, 0.9], [0.4, 6], [0.6, 6], [0.75, 0.4], [1, 0.4]],
  hero: [[0, 1], [0.2, 5], [0.4, 0.5], [0.6, 0.5], [0.8, 5], [1, 1]],
  bullet: [[0, 5.5], [0.3, 5.5], [0.45, 0.5], [0.55, 0.5], [0.7, 5.5], [1, 5.5]],
  "jump-cut": [[0, 0.6], [0.3, 0.6], [0.45, 5.5], [0.55, 5.5], [0.7, 0.6], [1, 0.6]],
  "flash-in": [[0, 5.5], [0.4, 5.5], [0.6, 1], [1, 1]],
  "flash-out": [[0, 1], [0.4, 1], [0.6, 5.5], [1, 5.5]],
};
const SOURCES = [1_200_000, 432_000_000];
const FPS = [{ numerator: 30, denominator: 1 }, { numerator: 30000, denominator: 1001 }];
const retime: Case[] = [];
const variants: { name: string; retime: RetimeSpec }[] = [
  ...Object.entries(CURVES).map(([name, points]) => ({ name, retime: { rate: 1, curve: points.map(([u, rate]) => ({ u, rate })) } })),
  ...Object.entries(CURVES).slice(0, 3).map(([name, points]) => ({ name: `${name} reversed`, retime: { rate: 1, reverse: true, curve: points.map(([u, rate]) => ({ u, rate })) } })),
  { name: "0.1x", retime: { rate: 0.1 } }, { name: "2x", retime: { rate: 2 } }, { name: "100x", retime: { rate: 100 } },
  { name: "2x reversed", retime: { rate: 2, reverse: true } }, { name: "1x reversed", retime: { reverse: true } },
  { name: "invalid curve falls back to the rate", retime: { rate: 2, curve: [{ u: 0, rate: 1 }, { u: 0.5, rate: 2 }, { u: 0.5, rate: 3 }, { u: 1, rate: 1 }] } },
  { name: "invalid rate reads as 1", retime: { rate: -3 } },
];
for (const variant of variants) {
  for (const sourceSpan of SOURCES) {
    for (const [index, rate] of FPS.entries()) {
      // The second frame rate adds duration cases only.
      const duration = retimedDuration(sourceSpan, variant.retime, rate);
      retime.push({ op: "retimedDuration", args: { sourceSpan, retime: variant.retime, rate }, expect: duration });
      if (index > 0) continue;
      const clip: RetimeClip = { sourceStart: 240_000, sourceSpan, duration, retime: variant.retime };
      const clipTimes = [0, 1, 4000, duration, duration - 1, duration - 4000, Math.floor(duration / 2), Math.floor(duration / 3), -5, duration + 5];
      for (let extra = 0; extra < 6; extra++) clipTimes.push(randomInt(0, duration));
      for (const clipTime of clipTimes) retime.push({ op: "sourceTimeAt", args: { element: clip, clipTime }, expect: sourceTimeAt(clip, clipTime) });
      const sourceTimes = [240_000, 240_000 + sourceSpan, 240_000 + Math.floor(sourceSpan / 2), 0, 240_000 + sourceSpan + 9];
      for (let extra = 0; extra < 5; extra++) sourceTimes.push(240_000 + randomInt(0, sourceSpan));
      for (const sourceTime of sourceTimes) retime.push({ op: "clipTimeAt", args: { element: clip, sourceTime }, expect: clipTimeAt(clip, sourceTime) });
    }
  }
}
const frozen: RetimeClip = { sourceStart: 0, sourceSpan: 0, duration: 360_000, freezeSourceTime: 360_000 };
for (const clipTime of [0, 1, 180_000, 360_000]) retime.push({ op: "sourceTimeAt", args: { element: frozen, clipTime }, expect: sourceTimeAt(frozen, clipTime) });
retime.push({ op: "clipTimeAt", args: { element: frozen, sourceTime: 360_000 }, expect: clipTimeAt(frozen, 360_000) });

const output = `${JSON.stringify({ ticksPerSecond: 120_000, base, retime })}\n`;
const file = join(import.meta.dirname, "../fixtures/time-vectors.json");
if (process.argv.includes("--check")) {
  if (readFileSync(file, "utf8") !== output) { console.error("fixtures/time-vectors.json is stale: run node scripts/gen-time-vectors.ts"); process.exit(1); }
} else {
  writeFileSync(file, output);
  console.log(`wrote ${base.length} base cases and ${retime.length} retime cases`);
}
