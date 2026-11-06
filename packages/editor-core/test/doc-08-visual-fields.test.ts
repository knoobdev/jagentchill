import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addEffect, addMask, applyBackgroundToAll, moveElement, removeEffect, setElementBackground, setElementValue, setTransform, toggleFlip, trimElement,
  commitChange,
} from "../src/index.ts";
import { assertFails, assertValid, context, element, put, rejected, SECOND, studio, text, tweak, validate, video } from "./support/fixtures.ts";

const clip = () => put(studio(), "main", video("v", 0, 4, { sourceDuration: 4 * SECOND }), video("w", 4, 2));
const key = (id: string, time: number, value: unknown) => ({ id, time, value, segmentToNext: "linear", tangentMode: "auto" });

// Requirement: Transform
test("Transform — Scenario: Stored shape", () => {
  const after = setTransform(clip(), context(), "v", { position: { x: 120, y: 0 }, scale: { x: 1.5, y: 1.5 }, rotation: 30 }).document;
  assert.deepEqual(element(after, "v").transform, { position: { x: 120, y: 0 }, scale: { x: 1.5, y: 1.5 }, rotation: 30 });
});

test("Transform — Scenario: Negative static scale", () => {
  const errors = rejected(() => setElementValue(clip(), context(), "v", "transform.scale.x", -1), "document/out-of-range");
  assert.ok(errors[0].path.endsWith("/elements/@v/transform/scale/x"));
  assertFails(tweak(clip(), (draft) => { draft.scenes[0].tracks.main.elements[0].transform.rotation = 3601; }), "document/out-of-range");
  // A key of −100…−0.01 is valid on a scale channel (migrated from classic); it is not on any other path.
  assertValid(tweak(clip(), (draft) => { draft.scenes[0].tracks.main.elements[0].animations = { "transform.scale.x": { keys: [key("k1", 0, 1), key("k2", SECOND, -1)] } }; }));
  assertFails(tweak(clip(), (draft) => { draft.scenes[0].tracks.main.elements[0].animations = { opacity: { keys: [key("k1", 0, -1)] } }; }), "document/out-of-range", "/keys/@k1/value");
});

test("Transform — Scenario: Old spelling", () => {
  const old = tweak(clip(), (draft) => { draft.scenes[0].tracks.main.elements[0].transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotate: 30 }; });
  const result = validate(old);
  assert.ok(result.errors.some((error) => error.code === "document/missing-field" && error.path.endsWith("/transform/rotation")));
  assert.ok(result.errors.some((error) => error.code === "document/field-not-allowed" && error.path.endsWith("/transform/rotate")));
  for (const legacy of ["scaleX", "scaleY", "positionX", "positionY"]) assertFails(tweak(clip(), (draft) => { draft.scenes[0].tracks.main.elements[0].transform[legacy] = 1; }), "document/field-not-allowed", `/transform/${legacy}`);
  assertFails(tweak(clip(), (draft) => { draft.scenes[0].tracks.main.elements[0].animations = { "transform.rotate": { keys: [key("k1", 0, 30)] } }; }), "document/animation-path-invalid");
});

// Requirement: Opacity, blend mode, crop and flip
test("Opacity, blend mode, crop and flip — Scenario: Crop sum", () => {
  assertFails(tweak(clip(), (draft) => { draft.scenes[0].tracks.main.elements[0].crop = { left: 0.6, right: 0.5, top: 0, bottom: 0 }; }), "document/out-of-range", "/crop/right");
  assertFails(tweak(clip(), (draft) => { draft.scenes[0].tracks.main.elements[0].crop = { left: 0, right: 0, top: 0.5, bottom: 0.5 }; }), "document/out-of-range", "/crop/bottom");
  assertFails(tweak(clip(), (draft) => { draft.scenes[0].tracks.main.elements[0].opacity = 80; }), "document/out-of-range", "/opacity");
});

test("Opacity, blend mode, crop and flip — Scenario: Unknown blend mode from a newer schema", () => {
  const opened = tweak(clip(), (draft) => { draft.schemaVersion = 34; draft.scenes[0].tracks.main.elements[0].blendMode = "linear-burn"; });
  const result = assertValid(opened);
  assert.ok(result.warnings.some((warning) => warning.path.endsWith("/elements/@v/blendMode") && warning.details?.unknownMember === true), "the notice of unknown content has this entry");
  const saved = moveElement(opened, context(), "w", 6 * SECOND).document;
  assert.equal(element(saved, "v").blendMode, "linear-burn", "the value is preserved");
});

test("Opacity, blend mode, crop and flip — Scenario: Flip is a flag", () => {
  const after = toggleFlip(clip(), context(), "v", "horizontal").document;
  assert.deepEqual(element(after, "v").flip, { horizontal: true, vertical: false });
  assert.equal(element(after, "v").transform.scale.x, 1);
  assert.equal(element(toggleFlip(after, context(), "v", "horizontal").document, "v").flip.horizontal, false);
});

// Requirement: Per-clip canvas background field
test("Per-clip canvas background field — Scenario: Override stored on the clip", () => {
  const after = setElementBackground(clip(), context(), "w", { kind: "color", color: "#ffffff" }).document;
  assert.deepEqual(element(after, "w").background, { kind: "color", color: "#ffffff" });
  assert.deepEqual(after.settings.background, { kind: "color", color: "#000000" });
  assert.equal("background" in element(after, "v"), false);
});

test("Per-clip canvas background field — Scenario: Apply to all", () => {
  const overridden = setElementBackground(clip(), context(), "w", { kind: "color", color: "#ffffff" }).document;
  const commit = applyBackgroundToAll(overridden, context(), { kind: "blur", blurIntensity: 200 });
  assert.deepEqual(commit.document.settings.background, { kind: "blur", blurIntensity: 200 });
  assert.ok(commit.document.scenes.every((scene) => scene.tracks.main.elements.every((entry) => !("background" in entry))));
  assert.equal(commit.history, true);
});

test("Per-clip canvas background field — Scenario: Overlay keeps the data", () => {
  const overridden = setElementBackground(clip(), context(), "w", { kind: "color", color: "#ffffff" }).document;
  const moved = commitChange(overridden, context(), { commandType: "element.move-track", label: "Move" }, (draft) => {
    const [taken] = draft.scenes[0].tracks.main.elements.splice(1, 1);
    (draft.scenes[0].tracks.overlay[0].elements as unknown[]).push(taken);
  }).document;
  assert.deepEqual(moved.scenes[0].tracks.overlay[0].elements.map((entry: any) => [entry.id, entry.background]), [["w", { kind: "color", color: "#ffffff" }]]);
  assertValid(moved);
  // On a text element `background` is the text background object; the canvas union never appears there.
  assertFails(put(studio(), "t-text", { ...text("x"), background: { kind: "color", color: "#ffffff", enabled: "yes" } }), "document/wrong-type", "/background/enabled");
});

// Requirement: Effect entries
test("Effect entries — Scenario: Second filter", () => {
  const ctx = context();
  const filtered = addEffect(clip(), ctx, "v", { type: "warm-film", kind: "filter" }).document;
  assert.deepEqual(element(filtered, "v").effects[0].params, { intensity: 100 }, "every key of the definition is present");
  const errors = rejected(() => addEffect(filtered, ctx, "v", { type: "cool-film", kind: "filter" }), "document/effects-limit");
  assert.ok(errors[0].path.endsWith("/elements/@v/effects"));
  assertValid(addEffect(filtered, ctx, "v", { type: "blur", kind: "effect" }).document);
});

test("Effect entries — Scenario: Removing an entry removes its channels", () => {
  const before = tweak(clip(), (draft) => {
    const target = draft.scenes[0].tracks.main.elements[0];
    target.effects = [{ id: "e1", type: "blur", kind: "effect", enabled: true, params: { intensity: 15 } }];
    target.animations = { "effects.e1.params.intensity": { keys: [key("k1", 0, 10)] }, opacity: { keys: [key("k2", 0, 1)] } };
  });
  assertValid(before);
  const commit = removeEffect(before, context(), "v", "e1");
  assert.deepEqual(Object.keys(element(commit.document, "v").animations), ["opacity"]);
  const removed = commit.patch.filter((entry) => entry.op === "remove").map((entry) => entry.path.split("/elements/@v")[1]).sort();
  assert.deepEqual(removed, ["/animations/effects.e1.params.intensity", "/effects/@e1"], "the same patch removes the animation path");
});

test("Effect entries — Scenario: Missing parameter key", () => {
  const error = assertFails(tweak(clip(), (draft) => { draft.scenes[0].tracks.main.elements[0].effects = [{ id: "e1", type: "blur", kind: "effect", enabled: true, params: {} }]; }), "document/missing-field");
  assert.equal(error.path, "/scenes/@s1/tracks/main/elements/@v/effects/@e1/params/intensity");
  // An entry of a type this build does not register is preserved (pass-through), reported as a warning.
  const foreign = validate(tweak(clip(), (draft) => { draft.scenes[0].tracks.main.elements[0].effects = [{ id: "e1", type: "hologram", kind: "effect", enabled: true, params: { depth: 3 } }]; }));
  assert.equal(foreign.ok, true);
  assert.deepEqual(foreign.warnings.map((warning) => warning.code), ["document/unknown-definition"]);
});

// Requirement: Motion blur and clip animation fields
const slot = (type: string, duration = 60_000) => ({ type, duration, strength: 100 });

test("Motion blur and clip animation fields — Scenario: Combo excludes in", () => {
  const both = tweak(clip(), (draft) => { draft.scenes[0].tracks.main.elements[0].clipAnimation = { in: slot("fade-in"), combo: { ...slot("pulse", 4 * SECOND), followsDuration: true } }; });
  assertFails(both, "document/field-not-allowed", "/clipAnimation/in");
  assertValid(tweak(clip(), (draft) => { draft.scenes[0].tracks.main.elements[0].clipAnimation = { in: slot("fade-in"), out: slot("fade-out") }; }));
  assertFails(tweak(clip(), (draft) => { draft.scenes[0].tracks.main.elements[1].clipAnimation = { in: slot("fade-in", 180_000), out: slot("fade-out", 120_000) }; }), "document/out-of-range", "/clipAnimation/out/duration");
  assertFails(tweak(clip(), (draft) => { draft.scenes[0].tracks.main.elements[0].clipAnimation = { in: slot("spin") }; }), "document/unknown-definition");
  assertFails(tweak(clip(), (draft) => { draft.scenes[0].tracks.main.elements[0].motionBlur = { enabled: true, strength: 50, samples: 12 }; }), "document/wrong-type", "/motionBlur/samples");
  assertFails(tweak(clip(), (draft) => { draft.scenes[0].tracks.main.elements[0].fadeIn = { duration: 0, shape: "sine" }; }), "document/wrong-type");
});

test("Motion blur and clip animation fields — Scenario: Combo follows the duration", () => {
  const before = tweak(clip(), (draft) => { draft.scenes[0].tracks.main.elements[0].clipAnimation = { combo: { ...slot("pulse", 4 * SECOND), followsDuration: true } }; });
  const after = trimElement(before, context(), "v", { duration: 3 * SECOND, trimEnd: SECOND }).document;
  assert.equal(element(after, "v").clipAnimation.combo.duration, 360_000);
  const fixed = tweak(before, (draft) => { draft.scenes[0].tracks.main.elements[0].clipAnimation.combo = { ...slot("pulse", 2 * SECOND), followsDuration: false }; });
  assert.equal(element(trimElement(fixed, context(), "v", { duration: 3 * SECOND, trimEnd: SECOND }).document, "v").clipAnimation.combo.duration, 2 * SECOND);
});

test("Motion blur and clip animation fields — Scenario: Clip animation on text", () => {
  assertFails(put(studio(), "t-text", { ...text("x"), clipAnimation: { in: slot("fade-in") } }), "document/field-not-allowed", "/elements/@x/clipAnimation");
});

// Requirement: Mask fields
test("Mask fields — Scenario: New rectangle mask", () => {
  const after = addMask(clip(), context({ newId: () => "m1" }), "v", "rectangle").document;
  assert.deepEqual(element(after, "v").masks, [{
    id: "m1", type: "rectangle", enabled: true, combine: "add",
    params: { feather: 0, inverted: false, opacity: 100, strokeWidth: 0, strokeColor: "#ffffff", strokeAlign: "center", centerX: 0, centerY: 0, rotation: 0, width: 0.6, height: 0.6, scale: 1, cornerRadius: 0 },
  }]);
  assertValid(after);
});

test("Mask fields — Scenario: Path key with a foreign point", () => {
  const point = (id: string, x: number) => ({ id, x, y: 0, inX: 0, inY: 0, outX: 0, outY: 0 });
  const freeform = (keyPoints: string[]) => tweak(clip(), (draft) => {
    const target = draft.scenes[0].tracks.main.elements[0];
    target.masks = [{ id: "m1", type: "freeform", enabled: true, combine: "add", params: { closed: true, path: [point("p1", 0), point("p2", 0.2), point("p3", 0.4)] } }];
    target.animations = { "masks.m1.params.path": { keys: [{ id: "pk1", time: 0, value: { points: keyPoints.map((id, index) => point(id, index / 10)) }, segmentToNext: "linear", easing: [0.25, 0.1, 0.25, 1] }] } };
  });
  assertValid(freeform(["p1", "p2", "p3"]));
  assertFails(freeform(["p1", "p2", "p9"]), "document/animation-channel-invalid", "/animations/masks.m1.params.path/keys/@pk1");
});

test("Mask fields — Scenario: Ninth mask", () => {
  const ctx = context();
  let doc = clip();
  for (let count = 0; count < 8; count++) doc = addMask(doc, ctx, "v", "ellipse").document;
  assert.equal(element(doc, "v").masks.length, 8);
  rejected(() => addMask(doc, ctx, "v", "ellipse"), "document/masks-limit");
  assert.equal(element(doc, "v").masks.length, 8);
});

test("Mask fields — Scenario: Star key on a rectangle", () => {
  const masked = addMask(clip(), context({ newId: () => "m1" }), "v", "rectangle").document;
  const error = assertFails(tweak(masked, (draft) => { draft.scenes[0].tracks.main.elements[0].masks[0].params.innerRatio = 0.5; }), "document/field-not-allowed");
  assert.equal(error.path, "/scenes/@s1/tracks/main/elements/@v/masks/@m1/params/innerRatio");
  const star = addMask(clip(), context({ newId: () => "m2" }), "v", "star").document;
  assert.deepEqual([element(star, "v").masks[0].params.points, element(star, "v").masks[0].params.innerRatio], [5, 0.45]);
  assertFails(tweak(masked, (draft) => { draft.scenes[0].tracks.main.elements[0].masks[0].type = "blob"; }), "document/wrong-type", "/masks/@m1/type");
});
