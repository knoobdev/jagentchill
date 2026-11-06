import assert from "node:assert/strict";
import { test } from "node:test";
import { createProjectDocument } from "@jagentchill/protocol";
import {
  addEffect, canonicalize, commitChange, insertElement, isUnknownElement, moveElement, setCanvasSize, setCover, setProjectBackground, setRetime, splitElement,
  trimElement, validateProjectDocument,
} from "../src/index.ts";
import { asset, assertFails, assertValid, context, element, HASH, NOW, put, rejected, SECOND, studio, tweak, validate, video } from "./support/fixtures.ts";

// Requirement: Absent, null and default values
test("Absent, null and default values — Scenario: Retime returns to default", () => {
  const doc = put(studio(), "main", video("v1", 0, 2, { sourceDuration: 4 * SECOND, retime: { rate: 2, maintainPitch: false, reverse: false, smooth: "none" } }));
  const commit = setRetime(doc, context(), "v1", { rate: 1 });
  assert.equal("retime" in element(commit.document, "v1"), false);
  assert.ok(commit.patch.some((entry) => entry.op === "remove" && entry.path.endsWith("/elements/@v1/retime")));
});

test("Absent, null and default values — Scenario: Null where absent is required", () => {
  const error = assertFails(put(studio(), "main", { ...video("v1"), freeze: null }), "document/wrong-type");
  assert.equal(error.path, "/scenes/@s1/tracks/main/elements/@v1/freeze");
  // Only the fields the catalogue types "or null" accept null.
  assertValid(put(studio(), "main", { ...video("v2"), groupId: null, linkId: null, transitionIn: null, transitionOut: null }));
  assertFails(put(studio(), "main", { ...video("v3"), sourceDuration: null }), "document/wrong-type");
});

test("Absent, null and default values — Scenario: New element writes its defaults", () => {
  const doc = insertElement(studio(), context(), "t-main", { type: "video", id: "v1", name: "clip", startTime: 0, duration: 2 * SECOND, mediaId: "a1", sourceDuration: 2 * SECOND }).document;
  const stored = element(doc, "v1");
  assert.deepEqual(stored.transform, { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0 });
  assert.deepEqual(stored.crop, { left: 0, top: 0, right: 0, bottom: 0 });
  assert.deepEqual(stored.flip, { horizontal: false, vertical: false });
  for (const [key, value] of Object.entries({ opacity: 1, blendMode: "normal", volume: 0, muted: false, pan: 0, hidden: false, groupId: null, linkId: null, transitionIn: null, transitionOut: null, isSourceAudioEnabled: true })) {
    assert.equal(stored[key], value, key);
  }
  assert.deepEqual(stored.effects, []);
  assert.deepEqual(stored.masks, []);
  for (const key of ["retime", "freeze", "adjustments", "cutout", "animations"]) assert.equal(key in stored, false, key);
});

// Requirement: Unknown-field preservation
const newer = () => tweak(put(studio(), "main", { ...video("v1"), lensCorrection: { k1: 0.1 } }, video("v2", 4, 2)), (draft) => { draft.schemaVersion = 34; });

test("Unknown-field preservation — Scenario: Unknown element field survives an edit", () => {
  const before = newer();
  const opened = assertValid(before);
  assert.deepEqual(opened.unknownFields, ["scenes[0].tracks.main.elements[0].lensCorrection"], "the notice \"Some content was made with a newer app version and is kept unchanged\" has something to show");
  const saved = moveElement(before, context(), "v1", 2 * SECOND).document;
  assert.deepEqual(element(saved, "v1").lensCorrection, { k1: 0.1 });
  assert.equal(element(saved, "v1").startTime, 2 * SECOND);
  assert.equal(saved.schemaVersion, 34, "the newer document keeps its own schema");
  assert.equal(saved.minReaderSchemaVersion, 32);
});

test("Unknown-field preservation — Scenario: Unknown element type is kept and locked", () => {
  const particle = { id: "x1", type: "particle", name: "Sparks", startTime: 0, duration: 2 * SECOND, emitter: { rate: 40 } };
  const before = tweak(put(studio(), "t-video", particle, video("v2", 4, 2)), (draft) => { draft.schemaVersion = 34; });
  const result = assertValid(before);
  assert.ok(result.warnings.some((warning) => warning.code === "document/wrong-type" && warning.details?.unknownMember === true), "kept, not judged");
  assert.equal(isUnknownElement(element(before, "x1")), true, "not rendered; its clip shows \"Needs newer app\"");
  const errors = rejected(() => trimElement(before, context(), "x1", { duration: SECOND }));
  assert.match(errors[0].message, /Needs newer app/);
  // An edit elsewhere and a save leave it value-identical.
  const saved = moveElement(before, context(), "v2", 6 * SECOND).document;
  assert.deepEqual(element(saved, "x1"), particle);
  assert.ok(canonicalize(saved).includes(canonicalize(particle)), "byte-for-value identical in the canonical form");
  // The same element in a schema-32 document is not content of a newer schema: it is an error.
  assertFails(put(studio(), "t-video", particle), "document/wrong-type");
});

test("Unknown-field preservation — Scenario: Split copies unknown keys", () => {
  const doc = put(tweak(studio(), (draft) => { draft.schemaVersion = 34; }), "main", { ...video("v1", 0, 4, { sourceDuration: 4 * SECOND }), lensCorrection: { k1: 0.1 } });
  const after = splitElement(doc, context(), "v1", 1 * SECOND).document;
  const halves = after.scenes[0].tracks.main.elements as any[];
  assert.equal(halves.length, 2);
  assert.deepEqual(halves.map((half) => half.lensCorrection), [{ k1: 0.1 }, { k1: 0.1 }]);
  assert.deepEqual(halves.map((half) => [half.startTime, half.duration, half.trimStart, half.trimEnd]), [[0, SECOND, 0, 3 * SECOND], [SECOND, 3 * SECOND, SECOND, 0]]);
  assertValid(after);
});

test("Unknown-field preservation: an unknown union member is kept on a newer document and a writer error at schema 32", () => {
  const blend = { ...video("v1"), blendMode: "linear-burn" };
  assertFails(put(studio(), "main", blend), "document/wrong-type", "/blendMode");
  const result = assertValid(tweak(put(studio(), "main", blend), (draft) => { draft.schemaVersion = 34; }));
  assert.ok(result.warnings.some((warning) => warning.path.endsWith("/blendMode")));
  const pipeline = validate(tweak(studio(), (draft) => { draft.schemaVersion = 34; draft.settings.colorPipeline = "hdr-rec2020-10bit"; }));
  assert.equal(pipeline.readOnly, true, "\"This project uses a colour pipeline that needs a newer app\"");
});

// Requirement: Document size and count limits
test("Document size and count limits — Scenario: Seventeenth effect refused", () => {
  const entries = Array.from({ length: 16 }, (_, index) => ({ id: `fx${index}`, type: "blur", kind: "effect", enabled: true, params: { intensity: 15 } }));
  const before = put(studio(), "main", video("v1", 0, 2, { effects: entries }));
  assertValid(before);
  const errors = rejected(() => addEffect(before, context(), "v1", { type: "blur", kind: "effect" }), "document/limit-exceeded");
  assert.equal(errors[0].details!.limit, "effectsPerElement");
  assert.equal(element(before, "v1").effects.length, 16);
  // A document that already holds 17 is invalid for every writer.
  const seventeen = tweak(before, (draft) => { draft.scenes[0].tracks.main.elements[0].effects.push({ id: "fx16", type: "blur", kind: "effect", enabled: true, params: { intensity: 15 } }); });
  assert.equal(assertFails(seventeen, "document/limit-exceeded").details!.limit, "effectsPerElement");
  assertFails(seventeen, "document/effects-limit");
});

test("Document size and count limits — Scenario: Byte limit", () => {
  // 3 000 pasted elements whose content brings the canonical form past 67 108 864 bytes.
  const before = tweak(studio(), (draft) => { draft.schemaVersion = 34; });
  const payload = "x".repeat(22_400);
  const pasted = Array.from({ length: 3000 }, (_, index) => ({ ...video(`p${index}`, index * 2, 2), pastedNote: payload }));
  const errors = rejected(() => commitChange(before, context(), { commandType: "clipboard.paste", label: "Paste" }, (draft) => { (draft.scenes[0].tracks.main.elements as unknown[]).push(...pasted); }), "document/too-large");
  assert.ok((errors[0].details!.bytes as number) > 67_108_864);
  assert.equal(before.scenes[0].tracks.main.elements.length, 0, "nothing is pasted");
});

test("Document size and count limits — Scenario: Deep nesting", () => {
  let nested: Record<string, unknown> = { leaf: true };
  for (let level = 0; level < 40; level++) nested = { inner: nested };
  const imported = tweak(studio(), (draft) => { draft.schemaVersion = 34; draft.futureBlock = nested; });
  assert.equal(assertFails(imported, "document/limit-exceeded").details!.limit, "jsonDepth");
});

test("Document size and count limits: scenes, tracks, elements per track, markers and assets are limited by name", () => {
  const scenes = tweak(studio(), (draft) => { for (let index = 0; index < 200; index++) draft.scenes.push({ ...createProjectDocument({ id: "x", mainSceneId: `sc${index}`, mainTrackId: `mt${index}`, now_ms: NOW }).scenes[0], isMain: false, kind: "compound" }); });
  assert.equal(assertFails(scenes, "document/limit-exceeded", "/scenes").details!.limit, "scenesPerProject");
  const markers = tweak(studio(), (draft) => { draft.scenes[0].markers = Array.from({ length: 1001 }, (_, index) => ({ id: `mk${index}`, time: index * 4000, color: 1 })); });
  assert.equal(assertFails(markers, "document/limit-exceeded").details!.limit, "markersPerScene");
  const assets = tweak(studio(), (draft) => { draft.media.assets = Array.from({ length: 10_001 }, (_, index) => asset(`as${String(index).padStart(5, "0")}`, "image")); });
  assert.equal(assertFails(assets, "document/limit-exceeded").details!.limit, "assetsPerProject");
});

// Requirement: Project settings
test("Project settings — Scenario: Adoption flag cleared by an explicit choice", () => {
  const commit = setCanvasSize(studio(), context(), { width: 1080, height: 1920 });
  assert.equal(commit.document.settings.adoptCanvasFromFirstMedia, false);
  assert.equal(commit.document.settings.adoptFrameRateFromFirstMedia, true);
  assert.equal(commit.history, true);
  assert.ok(commit.patch.some((entry) => entry.path === "/settings/adoptCanvasFromFirstMedia" && entry.value === false), "in the same patch, so in the same undo step");
});

test("Project settings — Scenario: Odd canvas size", () => {
  const errors = rejected(() => setCanvasSize(studio(), context(), { width: 1081, height: 1920 }), "document/out-of-range");
  assert.equal(errors.find((error) => error.code === "document/out-of-range")!.path, "/settings/canvasSize/width");
  assertFails(tweak(studio(), (draft) => { draft.settings.canvasSize = { width: 7680, height: 7680 }; }), "document/out-of-range", "/settings/canvasSize/height");
});

test("Project settings — Scenario: Factory defaults", () => {
  const { settings } = createProjectDocument({ id: "p1", mainSceneId: "s1", mainTrackId: "t1", now_ms: NOW });
  assert.deepEqual(settings, {
    fps: { numerator: 30, denominator: 1 }, canvasSize: { width: 1920, height: 1080 }, canvasSizeMode: "preset", lastCustomCanvasSize: null, originalCanvasSize: null,
    adoptCanvasFromFirstMedia: true, adoptFrameRateFromFirstMedia: true, background: { kind: "color", color: "#000000" }, useProxies: true, colorPipeline: "sdr-rec709-8bit",
  });
});

// Requirement: Canvas background union
test("Canvas background union — Scenario: Transparent default", () => {
  const doc = setProjectBackground(studio(), context(), { kind: "transparent" }).document;
  assert.deepEqual(doc.settings.background, { kind: "transparent" });
  // Switching kind keeps no memory of the previous kind; a switch to blur starts at 200.
  assert.deepEqual(setProjectBackground(doc, context(), { kind: "blur", blurIntensity: 200 }).document.settings.background, { kind: "blur", blurIntensity: 200 });
});

test("Canvas background union — Scenario: Mixed keys rejected", () => {
  const error = assertFails(tweak(studio(), (draft) => { draft.settings.background = { kind: "color", color: "#112233", blurIntensity: 200 }; }), "document/field-not-allowed");
  assert.equal(error.path, "/settings/background/blurIntensity");
  // The classic discriminator `type` does not exist: without `kind` the value is not a background.
  assertFails(tweak(studio(), (draft) => { draft.settings.background = { type: "color", color: "#112233" }; }), "document/missing-field", "/settings/background/kind");
});

test("Canvas background union — Scenario: Image background needs an image asset", () => {
  const doc = tweak(studio(), (draft) => { draft.media.assets.push(asset("a7", "audio")); draft.settings.background = { kind: "image", mediaId: "a7" }; });
  assertFails(doc, "document/asset-type-mismatch", "/settings/background");
  assertValid(tweak(studio(), (draft) => { draft.settings.background = { kind: "image", mediaId: "a2", fit: "contain" }; }));
});

// Requirement: Project cover
const cover = (texts: number) => ({
  source: "frame", sceneId: "s1", time: 2 * SECOND, crop: { x: 0.5, y: 0.5, zoom: 1 },
  texts: Array.from({ length: texts }, (_, index) => ({ id: `ct${index}`, style: {}, content: "Title", position: { x: 0, y: 0 }, scale: 1, rotation: 0 })),
  image: { sha256: HASH("c"), mime: "image/jpeg", width: 1280, height: 720 },
});

test("Project cover — Scenario: Frame cover", () => {
  const doc = setCover(studio(), context(), cover(1)).document;
  const stored = doc.cover as any;
  assert.equal(stored.source, "frame");
  assert.equal(stored.sceneId, "s1");
  assert.equal(stored.time, 240_000);
  assert.deepEqual(stored.crop, { x: 0.5, y: 0.5, zoom: 1 });
  assert.equal(stored.texts.length, 1);
  assert.deepEqual(stored.image, { sha256: HASH("c"), mime: "image/jpeg", width: 1280, height: 720 });
  // A cover whose scene or asset no longer resolves stays valid; the reference is a warning.
  const dangling = validate(tweak(doc, (draft) => { draft.cover.sceneId = "gone"; }));
  assert.equal(dangling.ok, true);
  assert.deepEqual(dangling.warnings.map((warning) => warning.code), ["document/unknown-scene"]);
});

test("Project cover — Scenario: Reset", () => {
  const withCover = setCover(studio(), context(), cover(1)).document;
  assert.equal(setCover(withCover, context(), null).document.cover, null);
});

test("Project cover — Scenario: Six texts", () => {
  rejected(() => setCover(studio(), context(), cover(6)), "document/out-of-range");
  assertFails(tweak(studio(), (draft) => { draft.cover = cover(6); }), "document/out-of-range", "/cover/texts");
  assert.equal(validateProjectDocument(tweak(studio(), (draft) => { draft.cover = cover(5); })).ok, true);
});
