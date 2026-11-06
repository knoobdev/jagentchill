import assert from "node:assert/strict";
import { test } from "node:test";
import { CLIP_ANIMATION_ROWS } from "@jagentchill/content";
import { clampClipAnimation, clipAnimationLimit, clipAnimationsOf, clipProcessing, measureLoudness, motionBlurOf, normalizeGainDb, setClipAnimation, setMotionBlur } from "../src/index.ts";
import { context, ids, put, text, video } from "./support/fixtures.ts";
import { el, project, S, withTracks } from "./support/timeline.ts";

const FPS = { numerator: 30, denominator: 1 };
const CTX = context({ newId: ids("c"), registries: { clipAnimations: CLIP_ANIMATION_ROWS.map((row) => row.id) } });
const clip = (seconds = 4, extra: Record<string, unknown> = {}) => video("v", 0, seconds, { sourceDuration: 60 * S, trimEnd: (60 - seconds) * S, ...extra });
const doc0 = (seconds = 4, extra: Record<string, unknown> = {}) => put(project(), "t-main", clip(seconds, extra));
const slots = (doc: any, id = "v") => el(doc, id).clipAnimation;
const refused = (run: () => unknown): string => { try { run(); } catch (error: any) { return String(error.reason ?? error.code ?? error.message); } throw new Error("the command was not refused"); };

test("Bundled clip animation library: exactly 44 animations — 16 In, 16 Out and 12 Combo — and each group lists its own", () => {
  assert.deepEqual([clipAnimationsOf("in").length, clipAnimationsOf("out").length, clipAnimationsOf("combo").length, CLIP_ANIMATION_ROWS.length], [16, 16, 12, 44]);
  assert.equal(new Set(CLIP_ANIMATION_ROWS.map((row) => row.id)).size, 44);
});

test("Clip animation model: In and Out together are stored with their defaults; None removes the in slot and Out is unchanged", () => {
  let doc = setClipAnimation(doc0(), CTX, ["v"], "in", { type: "fade-in" }).document;
  assert.deepEqual(slots(doc), { in: { type: "fade-in", duration: 0.5 * S, strength: 100 } });
  doc = setClipAnimation(doc, CTX, ["v"], "out", { type: "fade-out", duration: S }).document;
  assert.deepEqual(slots(doc), { in: { type: "fade-in", duration: 0.5 * S, strength: 100 }, out: { type: "fade-out", duration: S, strength: 100 } });
  doc = setClipAnimation(doc, CTX, ["v"], "in", null).document;
  assert.deepEqual(slots(doc), { out: { type: "fade-out", duration: S, strength: 100 } });
  doc = setClipAnimation(doc, CTX, ["v"], "out", null).document;
  assert.equal(slots(doc), undefined);
});

test("Clip animation model: Combo replaces In and Out in one step, and setting an In clears the combo", () => {
  const withBoth = setClipAnimation(setClipAnimation(doc0(), CTX, ["v"], "in", { type: "fade-in" }).document, CTX, ["v"], "out", { type: "fade-out" }).document;
  const combo = setClipAnimation(withBoth, CTX, ["v"], "combo", { type: clipAnimationsOf("combo")[0].id });
  // The combo starts at the element's length and follows it.
  assert.deepEqual(slots(combo.document), { combo: { type: clipAnimationsOf("combo")[0].id, duration: 4 * S, strength: 100, followsDuration: true } });
  // One commit: undoing it gives the In and the Out back.
  assert.deepEqual(slots(withBoth), { in: { type: "fade-in", duration: 0.5 * S, strength: 100 }, out: { type: "fade-out", duration: 0.5 * S, strength: 100 } });
  const again = setClipAnimation(combo.document, CTX, ["v"], "in", { type: "zoom-in" }).document;
  assert.deepEqual(Object.keys(slots(again)), ["in"]);
  // The first edit of the combo's duration is the user's: it no longer follows the element.
  const edited = setClipAnimation(combo.document, CTX, ["v"], "combo", { type: clipAnimationsOf("combo")[0].id, duration: 2 * S, strength: 40 }).document;
  assert.deepEqual(slots(edited).combo, { type: clipAnimationsOf("combo")[0].id, duration: 2 * S, strength: 40, followsDuration: false });
});

test("Clip animation model: Durations cannot overlap — a 1.0 s clip with In 0.6 s clamps Out 0.8 s to 0.4 s; Duration slider limit — a 2 s clip with Out 0.5 s allows In up to 1.5 s", () => {
  let doc = setClipAnimation(doc0(1), CTX, ["v"], "in", { type: "fade-in", duration: 0.6 * S }).document;
  doc = setClipAnimation(doc, CTX, ["v"], "out", { type: "fade-out", duration: 0.8 * S }).document;
  assert.deepEqual([slots(doc).in.duration, slots(doc).out.duration], [0.6 * S, 0.4 * S]);
  const two = setClipAnimation(doc0(2), CTX, ["v"], "out", { type: "fade-out", duration: 0.5 * S }).document;
  assert.equal(clipAnimationLimit(el(two, "v"), "in"), 1.5 * S);
  assert.equal(slots(setClipAnimation(two, CTX, ["v"], "in", { type: "fade-in", duration: 9 * S }).document).in.duration, 1.5 * S);
  // In and Out never last longer than 5 s, and never less than 0.1 s; durations sit on the frame grid.
  const long = clampClipAnimation({ duration: 20 * S }, "in", { type: "fade-in", duration: 9 * S }, FPS) as any;
  assert.equal(long.in.duration, 5 * S);
  assert.equal((clampClipAnimation({ duration: 20 * S }, "in", { type: "fade-in", duration: 10 }, FPS) as any).in.duration, 0.1 * S);
  assert.equal((clampClipAnimation({ duration: 20 * S }, "in", { type: "fade-in", duration: 0.31 * S }, FPS) as any).in.duration, 36_000);
  assert.equal((clampClipAnimation({ duration: 20 * S }, "in", { type: "fade-in", duration: 10 }, { numerator: 24, denominator: 1 }) as any).in.duration, 15_000);
  assert.equal((clampClipAnimation({ duration: 20 * S }, "in", { type: "fade-in", strength: 140 }, FPS) as any).in.strength, 100);
});

test("Clip animation panel: with several eligible elements the choice applies to all of them, each clamped to its own length; Not available on text", () => {
  const two = put(doc0(4), "t-main", video("w", 4, 0.3, { sourceDuration: 60 * S, trimEnd: 59.7 * S }));
  const doc = setClipAnimation(two, CTX, ["v", "w"], "in", { type: "fade-in", duration: S }).document;
  assert.deepEqual([slots(doc, "v").in.duration, slots(doc, "w").in.duration], [S, 0.3 * S]);
  const withText = put(withTracks(doc0(), ["t-text", "text"]), "t-text", text("x", 0, 2));
  assert.equal(refused(() => setClipAnimation(withText, CTX, ["x"], "in", { type: "fade-in" })), "INVALID_PARAMS");
  assert.equal(refused(() => setClipAnimation(doc0(), CTX, ["v"], "in", { type: "fade-out" })), "INVALID_PARAMS");
});

test("Motion blur: the switch, the strength and the samples are stored with their defaults and ranges", () => {
  assert.deepEqual(motionBlurOf(el(doc0(), "v")), { enabled: false, strength: 50, samples: 8 });
  let doc = setMotionBlur(doc0(), CTX, ["v"], { enabled: true }).document;
  assert.deepEqual(el(doc, "v").motionBlur, { enabled: true, strength: 50, samples: 8 });
  doc = setMotionBlur(doc, CTX, ["v"], { strength: 130, samples: 16 }).document;
  assert.deepEqual(el(doc, "v").motionBlur, { enabled: true, strength: 100, samples: 16 });
  assert.equal(refused(() => setMotionBlur(doc, CTX, ["v"], { samples: 5 })), "OUT_OF_RANGE");
});

test("Loudness maths shared with the engine: a full-scale 1 kHz sine on both channels measures about 0 LUFS and is brought to −14 LUFS; the processing of an element is read from its stored fields", () => {
  const left = new Float32Array(48_000 * 2), right = new Float32Array(48_000 * 2);
  for (let index = 0; index < left.length; index++) left[index] = right[index] = Math.sin((2 * Math.PI * 1000 * index) / 48_000);
  const loudness = measureLoudness(left, right);
  assert.ok(Math.abs(loudness.lufs) < 0.3, String(loudness.lufs));
  assert.ok(Math.abs(normalizeGainDb(-14, loudness).gainDb - (-14 - loudness.lufs)) < 0.01);
  assert.deepEqual(clipProcessing({ eq: { enabled: true, bands: { low: 3 } }, compressor: { enabled: false }, normalize: { enabled: true, gainDb: -2 } }), { eq: { low: 3 }, normalizeDb: -2 });
  assert.equal(clipProcessing({ eq: { enabled: true, bands: { low: 0 } } }), undefined);
});
