// Text animations, curved text and caption word timing as pure functions: the catalogue motions at exact times.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { TEXT_ANIMATIONS } from "@jagentchill/editor-core";
import { blockPose, glitchOf, highlightRanges, measureText, motionSlots, motionUnits, placeText, rasterMotion, rotateHue, synthesiseWords, unitPose, type TextSpec } from "../src/index.ts";
import { loadWasm } from "./support/wasm.ts";

const SECOND = 120_000;
const size = { blockWidth: 400, blockHeight: 120, fontSize: 100 };
const near = (actual: number, expected: number, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected}`);

test("Text animations in, out and loop — In animation: Typewriter over 1 s shows character i of \"Hello\" at i × 0.2 s and all five from 0.8 s on", () => {
  const animation = { in: { id: "in-typewriter", duration: SECOND, strength: 100 } };
  const visible = (seconds: number) => {
    const motion = rasterMotion(motionSlots(animation, seconds * SECOND, 4 * SECOND), "t");
    return [0, 1, 2, 3, 4].map((index) => (motion ? unitPose(motion, "character", index, 5, 100, 400).opacity : 1));
  };
  assert.deepEqual(visible(0), [1, 0, 0, 0, 0]);
  assert.deepEqual(visible(0.19), [1, 0, 0, 0, 0]);
  assert.deepEqual(visible(0.2), [1, 1, 0, 0, 0]);
  assert.deepEqual(visible(0.61), [1, 1, 1, 1, 0]);
  assert.deepEqual(visible(0.8), [1, 1, 1, 1, 1]);
  assert.deepEqual(visible(2), [1, 1, 1, 1, 1]);
});

test("Text animations in, out and loop — Catalogue motion: Slide up starts one block height below with opacity 0 and ends in place; strength 50 halves the offset and leaves the opacity ramp", () => {
  const at = (seconds: number, strength: number) => blockPose(motionSlots({ in: { id: "in-slide-up", duration: 0.5 * SECOND, strength } }, seconds * SECOND, 4 * SECOND), size);
  const start = at(0, 100), end = at(0.5, 100), half = at(0, 50);
  near(start.dy, 120); near(start.opacity, 0);
  near(end.dy, 0); near(end.opacity, 1);
  near(half.dy, 60); near(half.opacity, 0);
  // Half-way the eased offset is the same fraction at both strengths; the opacity does not depend on strength.
  const mid = at(0.25, 100), midHalf = at(0.25, 50);
  near(midHalf.dy, mid.dy / 2, 1e-9);
  near(midHalf.opacity, mid.opacity, 1e-9);
});

test("Text animations in, out and loop — Loop between in and out: a 5 s text with In 0.5 s, Out 0.5 s and Pulse of 1 s pulses from 0.5 s to 4.5 s and completes 4 cycles; Durations clamp", () => {
  const animation = { in: { id: "in-fade", duration: 0.5 * SECOND }, out: { id: "out-fade", duration: 0.5 * SECOND }, loop: { id: "loop-pulse", period: SECOND } };
  const slots = (seconds: number) => motionSlots(animation, Math.round(seconds * SECOND), 5 * SECOND);
  assert.ok(slots(0.25).in && !slots(0.25).loop);
  assert.ok(slots(4.75).out && !slots(4.75).loop);
  let cycles = 0, before = -1;
  for (let frame = 0; frame <= 150; frame++) {
    const loop = slots(frame / 30).loop;
    if (!loop) { before = -1; continue; }
    if (before >= 0 && loop.p < before) cycles++;
    before = loop.p;
  }
  // Four periods fit between 0.5 s and 4.5 s: the cycle position wraps three times inside and ends the fourth at 4.5 s.
  assert.equal(cycles, 3);
  near(slots(0.5).loop!.p, 0); near(slots(1.75).loop!.p, 0.25); near(slots(4.25).loop!.p, 0.75);
  near(blockPose(slots(0.75), size).scaleX, 1.08); near(blockPose(slots(1.25), size).scaleX, 0.92);
  // In + Out never exceed the element: a 2 s text with In 1.5 s leaves Out 0.5 s.
  const clamped = motionSlots({ in: { id: "in-fade", duration: 1.5 * SECOND }, out: { id: "out-fade", duration: SECOND } }, 1.75 * SECOND, 2 * SECOND);
  near(clamped.out!.p, 0.5);
});

test("Text animations in, out and loop — Exact counts offline: every catalogue id has a motion that differs from rest inside its range and is at rest at its end; Seek equals playback; Missing font and preset resources — Unknown animation id", () => {
  assert.deepEqual([TEXT_ANIMATIONS.filter((entry) => entry.group === "in").length, TEXT_ANIMATIONS.filter((entry) => entry.group === "out").length, TEXT_ANIMATIONS.filter((entry) => entry.group === "loop").length], [20, 20, 12]);
  const rest = JSON.stringify(blockPose({}, size));
  const unitRest = JSON.stringify({ dx: 0, dy: 0, scale: 1, rotate: 0, opacity: 1 });
  for (const animation of TEXT_ANIMATIONS) {
    const stored = animation.group === "loop" ? { loop: { id: animation.id, period: SECOND, strength: 100 } } : { [animation.group]: { id: animation.id, duration: SECOND, strength: 100 } };
    // Inside the range: 0.3 s into In, 0.75 s into Out; a Loop is sampled at three cycle positions (0.95 is inside the glitch burst).
    const times = animation.group === "in" ? [0.3 * SECOND] : animation.group === "out" ? [3.75 * SECOND] : [0.1 * SECOND, 0.35 * SECOND, 0.95 * SECOND];
    const movedAt = (time: number): boolean => {
      const slots = motionSlots(stored, time, 4 * SECOND);
      const motion = rasterMotion(slots, "element");
      return JSON.stringify(blockPose(slots, size)) !== rest
        || (motion !== undefined && motionUnits(motion).some((kind) => [0, 1, 2, 3].some((index) => JSON.stringify(unitPose(motion, kind, index, 4, 100, 400)) !== unitRest)))
        || glitchOf(motion, 100) !== null || (animation.id === "loop-rainbow" && rotateHue("#ff0000", 360 * slots.loop!.p) !== "#ff0000");
    };
    assert.ok(times.some(movedAt), `${animation.id} changes the text inside its range`);
    const time = times[times.length - 1], slots = motionSlots(stored, time, 4 * SECOND), motion = rasterMotion(slots, "element");
    const kinds = motionUnits(motion);
    assert.equal(animation.unit === "block" ? kinds.length : kinds[0], animation.unit === "block" ? 0 : animation.unit, `${animation.id} animates its catalogue unit`);
    // The same time always gives the same pose: nothing but element-local time feeds it.
    assert.equal(JSON.stringify([blockPose(motionSlots(stored, time, 4 * SECOND), size), rasterMotion(motionSlots(stored, time, 4 * SECOND), "element")]), JSON.stringify([blockPose(slots, size), motion]));
    if (animation.group === "in") {
      // An In animation ends at rest: one tick before its end every unit is in place and opaque, within the last step.
      const last = motionSlots(stored, SECOND, 4 * SECOND);
      assert.equal(last.in, undefined, `${animation.id} is over at its duration`);
    }
  }
  // Jitter: the pose at 1.3 s is a pure function of the time; another element id gives another jitter.
  const jitter = (id: string) => unitPose(rasterMotion(motionSlots({ loop: { id: "loop-jitter", period: SECOND } }, 1.3 * SECOND, 5 * SECOND), id)!, "character", 2, 5, 100, 400);
  assert.deepEqual(jitter("a"), jitter("a"));
  assert.notDeepEqual(jitter("a"), jitter("b"));
  assert.ok(Math.abs(jitter("a").dx) <= 3 && Math.abs(jitter("a").dy) <= 3);
  // An id unknown to this build renders without animation and without an error.
  assert.deepEqual(motionSlots({ in: { id: "in-from-the-future", duration: SECOND } }, 0, 4 * SECOND), {});
});

test("Curved text — Half circle: at curve 180 the first and last glyph baselines point in opposite directions on an arch that rises; Straight: curve 0 equals the uncurved layout; a full circle at 360", async () => {
  const wasm = await loadWasm();
  wasm.loadFont({ id: "arimo", data: new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures/fonts/Arimo-Regular.ttf"))) });
  const base: TextSpec = { content: "HHHHHHHHHHHH", fonts: ["arimo"], size: 100, letterSpacing: 0, lineHeight: 1.2, align: "center", color: "#ffffff", underline: false, strikethrough: false };
  const straight = measureText(wasm as never, base)!, zero = measureText(wasm as never, { ...base, curve: 0 })!;
  assert.deepEqual(zero.layout, straight.layout);
  assert.deepEqual(zero.block, straight.block);
  assert.ok(zero.placement.glyphs.every((glyph) => glyph.curve === undefined));
  const half = measureText(wasm as never, { ...base, curve: 180 })!;
  const first = half.placement.glyphs[0].curve!, last = half.placement.glyphs.at(-1)!.curve!, middle = half.placement.glyphs[6].curve!;
  // The glyph centres span 11/12 of the half turn: the two end baselines are 165° apart, turned opposite ways.
  near(((last.angle - first.angle) * 180) / Math.PI, 165, 0.5);
  near(first.angle, -last.angle, 1e-6);
  // Arching upward: the ends sit lower (larger y) than the middle, on a circle whose radius is width / π.
  assert.ok(first.y > middle.y + 100 && last.y > middle.y + 100);
  const radius = straight.layout.width / Math.PI;
  near(Math.hypot(first.x - straight.layout.width / 2, first.y - (straight.layout.lines[0].baseline + radius)), radius, 0.01);
  assert.ok(half.block.height > straight.block.height * 2, "the curved block is taller");
  // Negative curve arches downward: the ends sit higher than the middle.
  const down = measureText(wasm as never, { ...base, curve: -180 })!;
  assert.ok(down.placement.glyphs[0].curve!.y < down.placement.glyphs[6].curve!.y - 100);
  const circle = measureText(wasm as never, { ...base, curve: 360 })!;
  near(Math.abs(circle.block.width - circle.block.height) / circle.block.width, 0, 0.25);
  // Two lines lie on concentric arcs a line height apart; justify renders as centre.
  const two = measureText(wasm as never, { ...base, content: "HHHHHH\nHHHHHH", curve: 90, align: "justify" })!;
  const upper = two.placement.glyphs.find((glyph) => glyph.line === 0)!.curve!, lower = two.placement.glyphs.find((glyph) => glyph.line === 1)!.curve!;
  const centreY = two.layout.lines[0].baseline + two.layout.width / (Math.PI / 2), centreX = two.layout.width / 2;
  near(Math.hypot(upper.x - centreX, upper.y - centreY) - Math.hypot(lower.x - centreX, lower.y - centreY), 120, 0.5);
  // Units: a joined Arabic word is one rigid unit, Latin letters are one unit each.
  wasm.loadFont({ id: "naskh", data: new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures/fonts/NotoNaskhArabic-Regular.ttf"))) });
  const mixed = measureText(wasm as never, { ...base, content: "ab مرحبا", fonts: ["arimo", "naskh"] })!;
  const arabic = mixed.placement.glyphs.filter((glyph) => glyph.word === 1);
  assert.ok(arabic.length >= 4 && new Set(arabic.map((glyph) => glyph.character)).size === 1, "the joined word is one unit");
  assert.equal(mixed.placement.counts.word, 2);
});

test("Texture cache and upload rules — a text wider than the texture limit is rasterised scaled into the limit with its layout unchanged", async () => {
  const wasm = await loadWasm();
  wasm.loadFont({ id: "arimo", data: new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures/fonts/Arimo-Regular.ttf"))) });
  const spec: TextSpec = { content: "WWWWWWWWWWWWWWWWWWWWWWWWW", fonts: ["arimo"], size: 6000, letterSpacing: 0, lineHeight: 1.2, align: "center", color: "#ffffff", underline: false, strikethrough: false };
  const measured = measureText(wasm as never, spec, { side: 8192, area: 4096 * 4096 })!;
  assert.ok(measured.width > 100_000, `the layout keeps its real width (${measured.width})`);
  assert.ok(measured.scale < 1 && measured.width * measured.scale <= 8192.5 && measured.height * measured.scale <= 8192.5);
  assert.ok(measured.width * measured.scale * measured.height * measured.scale <= 4096 * 4096 * 1.01);
  assert.equal(measureText(wasm as never, { ...spec, size: 60 })!.scale, 1);
});

test("Word-level highlight — Imported captions without word timings: \"ab cdef\" over 3 s gives \"ab\" 1 s and \"cdef\" 2 s; Karaoke: spoken words are filled and the active word is filled over its spoken part", () => {
  assert.deepEqual(synthesiseWords("ab cdef", 3 * SECOND), [{ text: "ab", start: 0, end: SECOND }, { text: "cdef", start: SECOND, end: 3 * SECOND }]);
  const words = [{ text: "one", start: 0, end: SECOND }, { text: "two", start: SECOND, end: 2 * SECOND }, { text: "three", start: 2 * SECOND, end: 3 * SECOND }];
  const karaoke = highlightRanges("one two three", words, 2.5 * SECOND, { style: "karaoke", color: "#ff0000", textColor: "#000000" })!;
  assert.deepEqual(karaoke, [{ start: 0, end: 3, color: "#ff0000" }, { start: 4, end: 7, color: "#ff0000" }, { start: 8, end: 13, fill: { color: "#ff0000", progress: 0.5 } }]);
  assert.deepEqual(highlightRanges("one two three", words, 1.5 * SECOND, { style: "scale", color: "#ff0000", textColor: "#000000", scale: 1.25 }), [{ start: 4, end: 7, scale: 1.25 }]);
  assert.deepEqual(highlightRanges("one two three", words, 1.5 * SECOND, { style: "scale", color: "#ff0000", textColor: "#000000" }), [{ start: 4, end: 7, scale: 1.2 }]);
});
