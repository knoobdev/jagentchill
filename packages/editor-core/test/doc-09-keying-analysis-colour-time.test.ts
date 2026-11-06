import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addCrossfade, applyAiMotion, applyAutoReframe, cutoutMatteArrived, disableCutout, expireCutouts, matchFaces, recordFaces, reduceSpeedCurve, requestCutout,
  setBasicAdjustment, setElementFields, setElementValue, setRetime, setRetouch, upsertKeyframe, CUTOUT_RETENTION_MS,
} from "../src/index.ts";
import { asset, assertFails, assertValid, audio, context, element, HASH, NOW, put, rejected, SECOND, studio, tweak, validate, video } from "./support/fixtures.ts";

const clip = () => put(studio(), "main", video("v", 0, 4, { sourceDuration: 4 * SECOND }));
const matte = (id: string) => asset(id, "video", { kind: "derived", derived: { role: "matte", sourceAssetId: "a1" }, provenance: { source: "derived", tool: "cutout" } });
const withMatte = (id: string) => tweak(clip(), (draft) => { draft.media.assets.push(matte(id)); draft.media.assets.sort((a: any, b: any) => (a.id < b.id ? -1 : 1)); });

// Requirement: Chroma key and cutout fields
test("Chroma key and cutout fields — Scenario: Auto cutout requested", () => {
  const after = requestCutout(clip(), context(), "v").document;
  assert.deepEqual(element(after, "v").cutout, {
    mode: "auto", inverted: false, feather: 2, shift: 0, stroke: { style: "none", width: 8, color: "#ffffff", offset: 0, opacity: 100 }, background: { kind: "none" },
  });
  assert.equal("matteAssetId" in element(after, "v").cutout, false, "valid without a matte: it renders uncut until the job completes");
  assertValid(after);
  const keyed = setElementFields(clip(), context(), "v", { chromaKey: { enabled: true } }).document;
  assertValid(keyed);
  assertFails(tweak(keyed, (draft) => { draft.scenes[0].tracks.main.elements[0].chromaKey.color = "#00ff00ff"; }), "document/invalid-color");
});

test("Chroma key and cutout fields — Scenario: Matte arrives", () => {
  const requested = requestCutout(withMatte("m7"), context(), "v").document;
  const commit = cutoutMatteArrived(requested, context(), "v", "m7");
  assert.deepEqual(commit.patch.filter((entry) => entry.path !== "/metadata/updated_ms"), [{ op: "add", path: "/scenes/@s1/tracks/main/elements/@v/cutout/matteAssetId", value: "m7" }]);
  assert.equal(commit.history, false, "the undo stack length is unchanged");
  assertFails(tweak(commit.document, (draft) => { draft.scenes[0].tracks.main.elements[0].cutout.matteAssetId = "a2"; }), "document/asset-type-mismatch");
});

test("Chroma key and cutout fields — Scenario: Media background without an asset", () => {
  const requested = requestCutout(clip(), context(), "v").document;
  assertFails(tweak(requested, (draft) => { draft.scenes[0].tracks.main.elements[0].cutout.background = { kind: "media" }; }), "document/missing-field", "/cutout/background/mediaId");
  assertFails(tweak(requested, (draft) => { draft.scenes[0].tracks.main.elements[0].cutout.background = { kind: "color", color: "#101010", blurIntensity: 5 }; }), "document/field-not-allowed");
  assertValid(tweak(requested, (draft) => { draft.scenes[0].tracks.main.elements[0].cutout.background = { kind: "media", mediaId: "a2" }; }));
});

test("Chroma key and cutout fields — Scenario: Matte kept for 30 days after turning cutout off", () => {
  const T = NOW + 5000;
  const on = cutoutMatteArrived(requestCutout(withMatte("m1"), context(), "v").document, context(), "v", "m1").document;
  const off = disableCutout(on, context({ now_ms: T }), "v").document;
  const cutout = element(off, "v").cutout;
  assert.deepEqual([cutout.mode, cutout.matteAssetId, cutout.disabled_ms], ["none", "m1", T]);
  assertValid(off);
  // Turning it on again within 30 days reuses the matte.
  const again = element(requestCutout(off, context({ now_ms: T + 86_400_000 }), "v").document, "v").cutout;
  assert.deepEqual([again.mode, again.matteAssetId, "disabled_ms" in again], ["auto", "m1", false]);
  // 29 days later nothing changes; 31 days later the two keys go, and the matte asset with them.
  assert.deepEqual(expireCutouts(off, context({ now_ms: T + 29 * 86_400_000 })).patch, []);
  const expired = expireCutouts(off, context({ now_ms: T + CUTOUT_RETENTION_MS + 86_400_000 }));
  assert.equal(expired.history, false, "a non-history update");
  assert.deepEqual(["matteAssetId" in element(expired.document, "v").cutout, "disabled_ms" in element(expired.document, "v").cutout], [false, false]);
  assert.equal(expired.document.media.assets.some((entry) => entry.id === "m1"), false);
  // An asset another element still references is kept.
  const shared = tweak(put(off, "t-video", video("u", 0, 2)), (draft) => { draft.scenes[0].tracks.overlay[0].elements[0].cutout = { mode: "auto", matteAssetId: "m1" }; });
  assert.equal(expireCutouts(shared, context({ now_ms: T + 31 * 86_400_000 })).document.media.assets.some((entry) => entry.id === "m1"), true);
  assertFails(tweak(on, (draft) => { draft.scenes[0].tracks.main.elements[0].cutout.disabled_ms = T; }), "document/field-not-allowed", "/cutout/disabled_ms");
});

// Requirement: Analysis-driven settings
test("Analysis-driven settings — Scenario: Retouch all faces", () => {
  const after = setRetouch(clip(), context(), "v", "all", { smoothSkin: 40 }).document;
  const retouch = element(after, "v").retouch;
  assert.deepEqual([retouch.enabled, retouch.applyToAll], [true, true]);
  assert.deepEqual(Object.keys(retouch.faces), ["all"]);
  assert.equal(retouch.faces.all.smoothSkin, 40);
  assert.ok("body" in retouch);
  assertValid(after);
  const perFace = validate(setRetouch(after, context(), "v", "f1", { skinTone: -10 }).document);
  assert.deepEqual([perFace.ok, perFace.warnings.length], [true, 0]);
  const unknownFace = validate(setRetouch(after, context(), "v", "f9", { skinTone: -10 }).document);
  assert.deepEqual([unknownFace.ok, unknownFace.warnings.map((warning) => warning.code)], [true, ["document/unknown-reference"]]);
});

test("Analysis-driven settings — Scenario: Keyframed relight", () => {
  const lit = setElementFields(clip(), context(), "v", { relight: { enabled: true } }).document;
  const after = upsertKeyframe(lit, context(), "v", "relight.intensity", { time: SECOND, value: 80 }).document;
  assert.deepEqual(Object.keys(element(after, "v").animations), ["relight.intensity"]);
  assertValid(after);
  rejected(() => upsertKeyframe(lit, context(), "v", "relight.scope", { time: 0, value: "face" }), "document/animation-path-invalid");
});

test("Analysis-driven settings — Scenario: Re-applying AI movement", () => {
  const ctx = context();
  const zoomed = applyAiMotion(clip(), ctx, "v", "zoom-in", 50, [{ path: "transform.scale.x", time: 0, value: 1 }, { path: "transform.scale.x", time: 4 * SECOND, value: 1.3 }]).document;
  const [k1, k2] = element(zoomed, "v").aiMotion.keyIds;
  const withUserKey = upsertKeyframe(zoomed, context({ newId: () => "k3" }), "v", "transform.scale.x", { time: 2 * SECOND, value: 1.1 }).document;
  const pushed = applyAiMotion(withUserKey, ctx, "v", "push", 70, [{ path: "transform.position.x", time: 0, value: 0 }, { path: "transform.position.x", time: 4 * SECOND, value: 80 }]).document;
  const ids = (path: string) => (element(pushed, "v").animations[path]?.keys ?? []).map((entry: any) => entry.id);
  assert.deepEqual(ids("transform.scale.x"), ["k3"], "k1 and k2 are removed, k3 is kept");
  assert.ok(!ids("transform.position.x").includes(k1) && !ids("transform.position.x").includes(k2));
  assert.deepEqual(element(pushed, "v").aiMotion, { style: "push", intensity: 70, keyIds: ids("transform.position.x") });
  assertValid(pushed);
});

test("Analysis-driven settings — Scenario: Seventh face entry", () => {
  const faces = Object.fromEntries(["all", "f1", "f2", "f3", "f4", "f5", "f6"].map((key) => [key, {}]));
  assertFails(tweak(clip(), (draft) => { draft.scenes[0].tracks.main.elements[0].retouch = { faces }; }), "document/out-of-range", "/retouch/faces");
});

test("Analysis-driven settings — Scenario: Re-running auto reframe keeps the user's keys", () => {
  const ctx = context();
  const first = applyAutoReframe(clip(), ctx, "v", { numerator: 1, denominator: 1 }, [{ path: "transform.position.x", time: 0, value: -40 }, { path: "transform.position.x", time: 2 * SECOND, value: 40 }]).document;
  const [r1, r2] = element(first, "v").autoReframe.keyIds;
  const withUserKey = upsertKeyframe(first, context({ newId: () => "u1" }), "v", "transform.position.x", { time: SECOND, value: 5 }).document;
  const second = applyAutoReframe(withUserKey, ctx, "v", { numerator: 9, denominator: 16 }, [{ path: "transform.position.x", time: 0, value: -200 }, { path: "transform.position.x", time: 4 * SECOND, value: 200 }]).document;
  const ids = element(second, "v").animations["transform.position.x"].keys.map((entry: any) => entry.id);
  assert.ok(!ids.includes(r1) && !ids.includes(r2) && ids.includes("u1"));
  const reframe = element(second, "v").autoReframe;
  assert.deepEqual(reframe.aspect, { numerator: 9, denominator: 16 });
  assert.deepEqual([...reframe.keyIds].sort(), ids.filter((id: string) => id !== "u1").sort());
  assertValid(second);
});

test("Analysis-driven settings — Scenario: Face ids survive a rebuilt analysis cache", () => {
  // The stored identity f1 was first seen in this box; the rebuilt analysis detects it shifted slightly, plus a new face.
  const stored = [{ id: "f1", box: { x: 100, y: 100, width: 200, height: 200 } }];
  const matched = matchFaces(stored, [{ x: 620, y: 80, width: 180, height: 180 }, { x: 110, y: 105, width: 200, height: 200 }], () => "f-new");
  assert.deepEqual(matched.map((face) => [face.id, face.isNew]), [["f-new", true], ["f1", false]]);
  // An overlap below 0.5 intersection-over-union is a different person.
  assert.equal(matchFaces(stored, [{ x: 250, y: 100, width: 200, height: 200 }], () => "f-other")[0].id, "f-other");
  // The asset's list only grows, so `retouch.faces.f1` keeps applying to the same person.
  const retouched = setRetouch(clip(), context(), "v", "f1", { smoothSkin: 30 }).document;
  const after = recordFaces(retouched, context(), "a1", matched.map((face) => ({ id: face.id, firstSeen: 0 }))).document;
  assert.deepEqual(after.media.assets.find((entry) => entry.id === "a1")!.faces.map((face) => face.id), ["f1", "f-new"]);
  assert.deepEqual(validate(after).warnings, []);
});

// Requirement: Colour adjustments
test("Colour adjustments — Scenario: One slider", () => {
  const after = setBasicAdjustment(clip(), context(), "v", "exposure", 50).document;
  const { adjustments } = element(after, "v");
  assert.deepEqual(Object.keys(adjustments), ["basic"], "no other section");
  assert.deepEqual(adjustments.basic, {
    enabled: true, exposure: 50, brightness: 0, contrast: 0, saturation: 0, vibrance: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, temperature: 0, tint: 0, clarity: 0,
    vignette: 0, hue: 0, sharpness: 0, fade: 0, grain: 0,
  });
  assertValid(after);
  assertFails(tweak(after, (draft) => { draft.scenes[0].tracks.main.elements[0].adjustments.wheels = { shadows: { x: 0.9, y: 0.9, luminance: 0 } }; }), "document/out-of-range", "/wheels/shadows/x");
  assertFails(tweak(after, (draft) => { draft.scenes[0].tracks.main.elements[0].adjustments.curves = { master: [{ x: 0, y: 0 }, { x: 0.5, y: 0.4 }, { x: 0.5, y: 0.6 }, { x: 1, y: 1 }] }; }), "document/out-of-range", "/curves/master");
});

test("Colour adjustments — Scenario: HSL path uses stored keys", () => {
  const after = upsertKeyframe(clip(), context(), "v", "adjustments.hsl.blue.lightness", { time: SECOND, value: -20 }).document;
  assert.deepEqual(Object.keys(element(after, "v").animations), ["adjustments.hsl.blue.lightness"]);
  assertValid(after);
  rejected(() => upsertKeyframe(clip(), context(), "v", "adjustments.hsl.blue.l", { time: SECOND, value: -20 }), "document/animation-path-invalid");
  rejected(() => upsertKeyframe(clip(), context(), "v", "adjustments.lut.lutId", { time: SECOND, value: "x" }), "document/animation-path-invalid");
});

test("Colour adjustments — Scenario: Missing user LUT record", () => {
  const lutId = `user:${HASH("9")}`;
  const doc = tweak(clip(), (draft) => { draft.scenes[0].tracks.main.elements[0].adjustments = { lut: { enabled: true, lutId, intensity: 100 } }; });
  const result = validate(doc);
  assert.equal(result.ok, true);
  assert.deepEqual(result.warnings.map((warning) => [warning.code, warning.path]), [["document/unknown-reference", "/scenes/@s1/tracks/main/elements/@v/adjustments/lut/lutId"]]);
  const present = tweak(doc, (draft) => { draft.media.luts = [{ id: lutId, name: "Teal", format: "cube", size: 1024, sha256: HASH("9") }]; });
  assert.deepEqual(validate(present).warnings, []);
  assertValid(tweak(doc, (draft) => { draft.scenes[0].tracks.main.elements[0].adjustments.lut.lutId = "bundled:teal-orange"; }));
  assertFails(tweak(doc, (draft) => { draft.scenes[0].tracks.main.elements[0].adjustments.lut.lutId = "teal"; }), "document/wrong-type");
});

// Requirement: Retime and speed-curve fields
test("Retime and speed-curve fields — Scenario: Reverse only", () => {
  const after = setRetime(clip(), context(), "v", { reverse: true }).document;
  assert.deepEqual(element(after, "v").retime, { rate: 1, maintainPitch: false, reverse: true, smooth: "none" });
  assert.equal("reverse" in element(after, "v"), false);
  assertFails(tweak(clip(), (draft) => { draft.scenes[0].tracks.main.elements[0].reverse = true; }), "document/field-not-allowed", "/reverse");
  assertValid(tweak(clip(), (draft) => { draft.scenes[0].tracks.main.elements[0].retime = { rate: 0.05 }; }));
  rejected(() => upsertKeyframe(clip(), context(), "v", "retime.rate", { time: 0, value: 2 }), "document/animation-path-invalid");
});

const curve = (points: { u: number; rate: number }[]) => tweak(clip(), (draft) => { draft.scenes[0].tracks.main.elements[0].retime = { rate: 1, curve: { preset: "custom", points } }; });

test("Retime and speed-curve fields — Scenario: Curve end points", () => {
  assertFails(curve([{ u: 0, rate: 1 }, { u: 0.5, rate: 2 }, { u: 0.9, rate: 1 }]), "document/out-of-range", "/retime/curve/points");
  assertFails(curve([{ u: 0, rate: 1 }, { u: 0.6, rate: 2 }, { u: 0.4, rate: 2 }, { u: 1, rate: 1 }]), "document/out-of-range");
  assertValid(curve([{ u: 0, rate: 1 }, { u: 0.5, rate: 4 }, { u: 1, rate: 1 }]));
});

test("Retime and speed-curve fields — Scenario: Thirty-third point", () => {
  const produced = Array.from({ length: 33 }, (_, index) => ({ u: index / 32, rate: index % 2 ? 2 : 1 }));
  const reduced = reduceSpeedCurve(produced);
  assert.equal(reduced.length, 32, "the owner reduces it before writing");
  assert.deepEqual([reduced[0].u, reduced.at(-1)!.u], [0, 1]);
  assertValid(curve(reduced));
  assert.equal(assertFails(curve(produced), "document/limit-exceeded").details!.limit, "speedCurvePoints");
});

// Requirement: Freeze field
test("Freeze field — Scenario: Source time beyond the asset", () => {
  const frozen = (sourceTime: number) => put(studio(), "main", video("fz", 0, 3, { sourceDuration: undefined, freeze: { mediaId: "a1", sourceTime } }));
  assertFails(frozen(10 * SECOND), "document/time-out-of-bounds", "/freeze/sourceTime");
  assertValid(frozen(10 * SECOND - 1));
  assertValid(frozen(300_001), {});
});

// Requirement: Element audio level fields
test("Element audio level fields — Scenario: Volume precision", () => {
  const after = setElementValue(clip(), context(), "v", "volume", -3.14159).document;
  assert.equal(element(after, "v").volume, -3.14);
  assertFails(tweak(clip(), (draft) => { draft.scenes[0].tracks.main.elements[0].volume = 21; }), "document/out-of-range");
  assertFails(tweak(clip(), (draft) => { draft.scenes[0].tracks.main.elements[0].pan = 12.5; }), "document/wrong-type");
});

test("Element audio level fields — Scenario: Fades longer than the clip", () => {
  const faded = (fadeIn: number, fadeOut: number) => put(studio(), "t-audio", audio("s", 0, 2, { fadeIn: { duration: fadeIn, shape: "linear" }, fadeOut: { duration: fadeOut, shape: "equal-power" } }));
  assertFails(faded(180_000, 120_000), "document/out-of-range", "/fadeOut/duration");
  assertValid(faded(120_000, 120_000));
});

test("Element audio level fields — Scenario: Fade under a crossfade", () => {
  const pair = put(studio(), "t-audio", audio("a", 0, 2), audio("b", 2, 2));
  const joined = addCrossfade(pair, context(), "a", "b").document;
  const error = assertFails(tweak(joined, (draft) => { draft.scenes[0].tracks.audio[0].elements[0].fadeOut.duration = 60_000; }), "document/out-of-range");
  assert.equal(error.path, "/scenes/@s1/tracks/audio/@t-audio/elements/@a/fadeOut/duration");
  // The command that adds the crossfade clears the fades under it.
  const faded = tweak(pair, (draft) => { draft.scenes[0].tracks.audio[0].elements[0].fadeOut.duration = 60_000; });
  assert.equal(element(addCrossfade(faded, context(), "a", "b").document, "a").fadeOut.duration, 0);
});
