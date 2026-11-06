import assert from "node:assert/strict";
import { test } from "node:test";
import {
  floorToFrame, formatTimecode, frameDuration, guessTimecodeFormat, lastFrameTime, mediaTimeFromFrame, mediaTimeFromSeconds, mediaTimeToFrame,
  mediaTimeToSeconds, parseTimecode, retimedDuration, roundToFrame, snappedSeekTime, sourceTimeAt, clipTimeAt, TimeError, checkedFrameRate,
} from "@jagentchill/editor-core";
import { TICKS_PER_SECOND } from "@jagentchill/protocol";
import { loadWasm } from "./support/wasm.ts";

const fps = (numerator: number, denominator = 1) => ({ numerator, denominator });
const code = (expected: string) => (error: unknown) => error instanceof TimeError && error.code === expected;

test("Integer tick time base — One hour is exact", async () => {
  assert.equal(TICKS_PER_SECOND, 120_000);
  assert.equal(mediaTimeFromSeconds(3600), 432_000_000);
  assert.equal((await loadWasm()).mediaTimeFromSeconds({ seconds: 3600 }), 432_000_000);
  // Conversion from seconds rounds half away from zero.
  assert.equal(mediaTimeFromSeconds(0.5 / 120_000), 1);
  assert.equal(mediaTimeFromSeconds(-0.5 / 120_000), -1);
  assert.equal(mediaTimeToSeconds(180_000), 1.5);
});

test("Integer tick time base — No accumulated drift over a long timeline", async () => {
  const rate = fps(60_000, 1001);
  assert.equal(mediaTimeFromFrame(215_784, rate), 215_784 * 2_002);
  assert.equal(mediaTimeFromFrame(215_784, rate), 431_999_568);
  assert.equal((await loadWasm()).mediaTimeFromFrame({ frame: 215_784, rate }), 431_999_568);
  // The value is a function of the index alone: stepping there frame by frame reaches the same tick.
  let stepped = 0;
  for (let frame = 1; frame <= 5000; frame++) stepped = mediaTimeFromFrame(frame, rate);
  assert.equal(stepped, 5000 * 2002);
  assert.equal(mediaTimeFromFrame(215_784, rate) - mediaTimeFromFrame(215_783, rate), 2002);
});

test("Frame-rate rationals and frame snapping — the ten presets have their exact frame durations", () => {
  const presets: [number, number, number][] = [[24000, 1001, 5005], [24, 1, 5000], [25, 1, 4800], [30000, 1001, 4004], [30, 1, 4000], [48, 1, 2500], [50, 1, 2400], [60000, 1001, 2002], [60, 1, 2000], [120, 1, 1000]];
  for (const [numerator, denominator, ticks] of presets) assert.equal(frameDuration(fps(numerator, denominator)), ticks);
});

test("Frame-rate rationals and frame snapping — Snap between frames at 30 fps", () => {
  assert.equal(roundToFrame(5_999, fps(30)), 4_000);
  assert.equal(roundToFrame(6_000, fps(30)), 8_000);
  assert.equal(floorToFrame(7_999, fps(30)), 4_000);
  assert.equal(mediaTimeToFrame(7_999, fps(30)), 1);
});

test("Frame-rate rationals and frame snapping — Seek beyond the end", () => {
  assert.equal(snappedSeekTime(1_000_000, 600_000, fps(30)), 596_000);
  assert.equal(lastFrameTime(600_000, fps(30)), 596_000);
  assert.equal(lastFrameTime(3_999, fps(30)), 0, "a duration shorter than one frame");
  assert.equal(snappedSeekTime(-10, 600_000, fps(30)), 0);
});

test("Frame-rate rationals and frame snapping — Uneven rational does not drift", () => {
  const rate = fps(7);
  for (let n = 0; n <= 100_000; n++) {
    const rest = n % 7;
    const expected = Math.floor(n / 7) * 120_000 + Math.floor((2 * rest * 120_000 + 7) / 14);
    const actual = mediaTimeFromFrame(n, rate);
    if (actual !== expected) assert.fail(`frame ${n}: ${actual} instead of ${expected}`);
    // |actual − n × 120000 / 7| ≤ 0.5, compared without a division.
    if (Math.abs(actual * 7 - n * 120_000) * 2 > 7) assert.fail(`frame ${n} is more than half a tick from the exact value`);
  }
});

test("Frame-rate rationals and frame snapping — Large denominator at 24 hours", async () => {
  const wasm = await loadWasm();
  const stored = { numerator: 29_970_000, denominator: 1_000_000 };
  assert.deepEqual(checkedFrameRate(stored), { numerator: 2997, denominator: 100 });
  const day = 10_368_000_000;
  const frame = mediaTimeToFrame(roundToFrame(day, stored), stored);
  // Exact reference in BigInt: no floating-point product anywhere.
  const exact = (n: bigint) => (n / 2997n) * 12_000_000n + (2n * (n % 2997n) * 12_000_000n + 2997n) / (2n * 2997n);
  assert.equal(BigInt(mediaTimeFromFrame(frame, stored)), exact(BigInt(frame)));
  assert.equal(wasm.mediaTimeFromFrame({ frame, rate: stored }), mediaTimeFromFrame(frame, stored));
  assert.equal(wasm.mediaTimeToFrame({ time: day, rate: stored }), mediaTimeToFrame(day, stored));
  // A rational whose parts are a million: the intermediate product r × 120000 × den passes 2^53.
  const extreme = fps(1_000_000, 999_983);
  const index = mediaTimeToFrame(day, extreme);
  const reference = (n: bigint) => (n / 1_000_000n) * (120_000n * 999_983n) + (2n * (n % 1_000_000n) * 120_000n * 999_983n + 1_000_000n) / 2_000_000n;
  assert.equal(BigInt(mediaTimeFromFrame(index, extreme)), reference(BigInt(index)));
  assert.equal(wasm.mediaTimeFromFrame({ frame: index, rate: extreme }), mediaTimeFromFrame(index, extreme));
});

test("Frame-rate rationals and frame snapping — Rational out of bounds", async () => {
  const wasm = await loadWasm();
  assert.throws(() => mediaTimeFromFrame(1, fps(2_000_003)), code("time/invalid-frame-rate"));
  assert.throws(() => wasm.mediaTimeFromFrame({ frame: 1, rate: fps(2_000_003) }), (error: unknown) => error === "time/invalid-frame-rate");
  assert.throws(() => checkedFrameRate(fps(30, 0)), code("time/invalid-frame-rate"));
  // A result whose magnitude exceeds 2^53 − 1.
  assert.throws(() => mediaTimeFromFrame(80_000_000_000, fps(1)), code("time/out-of-range"));
  assert.throws(() => wasm.mediaTimeFromFrame({ frame: 80_000_000_000, rate: fps(1) }), (error: unknown) => error === "time/out-of-range");
});

test("Timecode formatting and parsing — Frame timecode round trip", async () => {
  const wasm = await loadWasm();
  assert.equal(formatTimecode(364_000, "HH:MM:SS:FF", fps(30)), "00:00:03:01");
  assert.equal(parseTimecode("00:00:03:01", "HH:MM:SS:FF", fps(30)), 364_000);
  assert.equal(wasm.formatTimecode({ time: 364_000, format: "HH:MM:SS:FF", rate: fps(30) }), "00:00:03:01");
  assert.equal(wasm.parseTimecode({ timeCode: "00:00:03:01", format: "HH:MM:SS:FF", rate: fps(30) }), 364_000);
  // Centiseconds are the default format; the other formats.
  assert.equal(formatTimecode(mediaTimeFromSeconds(3723.45)), "01:02:03:45");
  assert.equal(formatTimecode(mediaTimeFromSeconds(3723.45), "HH:MM:SS"), "01:02:03");
  assert.equal(formatTimecode(mediaTimeFromSeconds(65), "MM:SS"), "01:05");
  assert.equal(parseTimecode("01:05", "MM:SS"), 65 * 120_000);
  assert.equal(guessTimecodeFormat("01:05"), "MM:SS");
  assert.equal(guessTimecodeFormat("00:00:01"), "HH:MM:SS");
  assert.equal(guessTimecodeFormat("00:00:01:15"), "HH:MM:SS:FF");
});

test("Timecode formatting and parsing — Invalid frame field", async () => {
  const wasm = await loadWasm();
  assert.equal(parseTimecode("00:00:01:30", "HH:MM:SS:FF", fps(30)), null);
  assert.equal(wasm.parseTimecode({ timeCode: "00:00:01:30", format: "HH:MM:SS:FF", rate: fps(30) }), undefined);
  assert.equal(parseTimecode("00:00:01:29", "HH:MM:SS:FF", fps(30)), 120_000 + 29 * 4_000);
  // Malformed input is null, never an exception.
  for (const text of ["", "abc", "1:2:3:4:5", "00:61:00", "00:00:01:xx", "-1:00"]) assert.equal(parseTimecode(text, "HH:MM:SS:FF", fps(30)), null, text);
  assert.equal(parseTimecode("00:00:01:10", "HH:MM:SS:FF"), null, "frames need a frame rate");
});

test("Retime time map — presets, constant rates, reverse and freeze follow the specification", () => {
  const curve = (points: [number, number][]) => ({ rate: 1, curve: points.map(([u, rate]) => ({ u, rate })) });
  const presets: [string, [number, number][], number][] = [
    ["montage", [[0, 0.9], [0.25, 0.9], [0.4, 6], [0.6, 6], [0.75, 0.4], [1, 0.4]], 328],
    ["hero", [[0, 1], [0.2, 5], [0.4, 0.5], [0.6, 0.5], [0.8, 5], [1, 1]], 239],
    ["bullet", [[0, 5.5], [0.3, 5.5], [0.45, 0.5], [0.55, 0.5], [0.7, 5.5], [1, 5.5]], 146],
    ["jump-cut", [[0, 0.6], [0.3, 0.6], [0.45, 5.5], [0.55, 5.5], [0.7, 0.6], [1, 0.6]], 354],
    ["flash-in", [[0, 5.5], [0.4, 5.5], [0.6, 1], [1, 1]], 167],
    ["flash-out", [[0, 1], [0.4, 1], [0.6, 5.5], [1, 5.5]], 167],
  ];
  for (const [name, points, frames] of presets) {
    const duration = retimedDuration(1_200_000, curve(points), fps(30));
    assert.ok(Math.abs(mediaTimeToFrame(duration, fps(30)) - frames) <= 1, `${name}: ${mediaTimeToFrame(duration, fps(30))} frames`);
    assert.equal(floorToFrame(duration, fps(30)), duration, "a whole number of frames");
  }
  // Constant mapping in ticks: S0 = 2 s, rate 2, clip time 1 s → 4 s.
  const constant = { sourceStart: 240_000, sourceSpan: 1_200_000, duration: 600_000, retime: { rate: 2 } };
  assert.equal(sourceTimeAt(constant, 120_000), 480_000);
  assert.equal(clipTimeAt(constant, 480_000), 120_000);
  // A flat curve equals constant speed.
  const flat = { sourceStart: 0, sourceSpan: 1_200_000, duration: retimedDuration(1_200_000, curve([[0, 2], [0.5, 2], [1, 2]]), fps(30)), retime: curve([[0, 2], [0.5, 2], [1, 2]]) };
  assert.equal(flat.duration, 600_000);
  for (const local of [0, 4_000, 300_000, 596_000]) assert.ok(Math.abs(sourceTimeAt(flat, local) - 2 * local) <= 1);
  // Reverse reads the span from its end; a freeze returns its source time for every clip time.
  const reversed = { sourceStart: 0, sourceSpan: 600_000, duration: 600_000, retime: { reverse: true } };
  assert.equal(sourceTimeAt(reversed, 0), 600_000);
  assert.equal(sourceTimeAt(reversed, 600_000), 0);
  assert.equal(sourceTimeAt({ sourceStart: 0, sourceSpan: 0, duration: 4_000, freezeSourceTime: 360_000 }, 1234), 360_000);
  // The inverse returns a frame-aligned time within one tick (Hero, 10 s source).
  const hero = curve(presets[1][1]);
  const clip = { sourceStart: 0, sourceSpan: 1_200_000, duration: retimedDuration(1_200_000, hero, fps(30)), retime: hero };
  for (let local = 0; local < clip.duration; local += 4_000) assert.ok(Math.abs(clipTimeAt(clip, sourceTimeAt(clip, local)) - local) <= 1, `clip time ${local}`);
});
