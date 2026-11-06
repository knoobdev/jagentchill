import assert from "node:assert/strict";
import { test } from "node:test";
import { createProjectDocument } from "@jagentchill/protocol";
import {
  canonicalize, documentHash, duplicateElement, insertElement, roundStored, setElementValue, setLocal, sha256, toHex, trimElement, utf8, validateProjectDocument,
} from "../src/index.ts";
import { assertFails, assertValid, context, element, ids, NOW, put, rejected, SECOND, studio, tweak, video } from "./support/fixtures.ts";

// Requirement: Document envelope
test("Document envelope — Scenario: New project envelope", () => {
  const doc = createProjectDocument({ id: "p1", mainSceneId: "s1", mainTrackId: "t1", now_ms: NOW });
  assert.equal(doc.format, "jagentchill.project");
  assert.equal(doc.schemaVersion, 33);
  assert.equal(doc.minReaderSchemaVersion, 32);
  assert.deepEqual(doc.scenes.map((scene) => scene.isMain), [true]);
  assert.deepEqual(doc.media, { assets: [], folders: [], luts: [] });
  assert.deepEqual(doc.scriptLinks, []);
  assert.deepEqual(doc.glossaries, {});
  assert.equal(doc.cover, null);
  assertValid(doc);
});

test("Document envelope — Scenario: Missing format", () => {
  const { format: _format, ...record } = studio();
  const error = assertFails(record, "document/unknown-format");
  assert.equal(error.path, "/format");
});

test("Document envelope — Scenario: Duration follows content", () => {
  const doc = insertElement(studio(), context(), "t-main", { type: "video", id: "v1", name: "clip", startTime: 0, duration: 10 * SECOND, mediaId: "a1", sourceDuration: 10 * SECOND }).document;
  assert.equal(doc.metadata.duration, 10 * SECOND);
  const commit = trimElement(doc, context(), "v1", { duration: 600_000, trimEnd: 600_000 });
  assert.deepEqual(commit.patch.find((entry) => entry.path === "/metadata/duration"), { op: "replace", path: "/metadata/duration", value: 600_000 });
  assert.equal(commit.document.metadata.duration, 600_000);
});

test("Document envelope: a schema below 32, a newer minimum reader and an inverted minimum reader each have their code", () => {
  assertFails({ ...studio(), schemaVersion: 31 }, "document/schema-too-old", "/schemaVersion");
  assertFails({ ...studio(), schemaVersion: 40, minReaderSchemaVersion: 34 }, "document/schema-too-new");
  assertFails({ ...studio(), minReaderSchemaVersion: 34 }, "document/invalid-min-reader");
  assertFails([], "document/not-an-object");
  assertFails({ ...studio(), id: "p1" }, "document/field-not-allowed", "/id");
});

// Requirement: Identifiers
test("Identifiers — Scenario: Duplicate rewrites internal references", () => {
  const source = video("v1", 0, 2, {
    effects: [{ id: "e1", type: "blur", kind: "effect", enabled: true, params: { intensity: 15 } }],
    animations: { "effects.e1.params.intensity": { keys: [{ id: "k1", time: 0, value: 10, segmentToNext: "linear", tangentMode: "auto" }] } },
  });
  const before = put(studio(), "main", source);
  const newId = ids("c");
  const after = duplicateElement(before, context({ newId }), "v1").document;
  const copy = after.scenes[0].tracks.main.elements[1] as any;
  assert.notEqual(copy.id, "v1");
  assert.equal(copy.effects.length, 1);
  const effectId = copy.effects[0].id;
  assert.notEqual(effectId, "e1");
  assert.deepEqual(Object.keys(copy.animations), [`effects.${effectId}.params.intensity`]);
  assert.notEqual(copy.animations[`effects.${effectId}.params.intensity`].keys[0].id, "k1");
  assert.deepEqual(Object.keys(element(after, "v1").animations), ["effects.e1.params.intensity"], "the original is untouched");
  assertValid(after);
});

test("Identifiers — Scenario: Colliding ids are invalid", () => {
  const doc = tweak(put(studio(), "main", video("x1")), (draft) => { draft.scenes[0].markers = [{ id: "x1", time: 0, color: 1 }]; });
  const error = assertFails(doc, "document/duplicate-id");
  assert.deepEqual((error.details!.paths as string[]).sort(), ["/scenes/@s1/markers/@x1", "/scenes/@s1/tracks/main/elements/@x1"]);
});

test("Identifiers: keyframe ids are unique within their element and an id outside the grammar is invalid", () => {
  const key = (id: string, time: number) => ({ id, time, value: 0.5, segmentToNext: "linear", tangentMode: "auto" });
  const doc = put(studio(), "main", video("v1", 0, 2, { animations: { opacity: { keys: [key("k1", 0)] }, "transform.rotation": { keys: [key("k1", 0)] } } }));
  assertFails(doc, "document/duplicate-id", "/animations/transform.rotation/keys/@k1");
  assertFails(put(studio(), "main", { ...video("v1"), id: "has space" }), "document/invalid-id");
});

// Requirement: Time values and timestamps
test("Time values and timestamps — Scenario: Fractional tick rejected", () => {
  const before = studio();
  const errors = rejected(() => insertElement(before, context(), "t-main", { type: "video", id: "v1", name: "clip", startTime: 1200.5, duration: 2 * SECOND, mediaId: "a1" }), "document/not-integer-ticks");
  assert.ok(errors.some((error) => error.code === "document/not-integer-ticks" && error.path === "/scenes/@s1/tracks/main/elements/@v1/startTime"));
  assert.equal(before.scenes[0].tracks.main.elements.length, 0, "nothing is written");
  assertFails(put(studio(), "main", { ...video("v1"), startTime: -4000 }), "document/not-integer-ticks");
});

test("Time values and timestamps — Scenario: Unreduced rational rejected", () => {
  assertFails(tweak(studio(), (draft) => { draft.settings.fps = { numerator: 60, denominator: 2 }; }), "document/invalid-rational", "/settings/fps");
  assertFails(tweak(studio(), (draft) => { draft.settings.fps = { numerator: 0, denominator: 1 }; }), "document/invalid-rational");
});

test("Time values and timestamps — Scenario: Off-grid start", () => {
  const error = assertFails(put(studio(), "main", { ...video("v1"), startTime: 4001 }), "document/not-frame-aligned");
  assert.equal(error.path, "/scenes/@s1/tracks/main/elements/@v1/startTime");
  // Source-domain times are integer ticks and need not be on the grid.
  assertValid(put(studio(), "main", video("v2", 0, 2, { trimStart: 4001, sourceDuration: 2 * SECOND + 4001 })));
  // A 30000/1001 project has frames of 4004 ticks.
  const ntsc = tweak(studio(), (draft) => { draft.settings.fps = { numerator: 30000, denominator: 1001 }; });
  assertValid(put(ntsc, "main", { ...video("v3"), startTime: 4004, duration: 4004 * 60 }));
  assertFails(put(ntsc, "main", { ...video("v3"), startTime: 4000, duration: 4004 * 60 }), "document/not-frame-aligned");
});

// Requirement: Canonical JSON serialisation
test("Canonical JSON serialisation — Scenario: Key order is canonical", () => {
  const base = video("v1");
  const { id, name, ...rest } = base as any;
  const first = put(studio(), "main", { name, id, ...rest }), second = put(studio(), "main", { ...rest, id, name });
  assert.notEqual(JSON.stringify(first), JSON.stringify(second), "the two writers inserted keys in a different order");
  assert.equal(canonicalize(first), canonicalize(second));
  assert.equal(documentHash(first), documentHash(second));
  assert.match(documentHash(first), /^[0-9a-f]{64}$/);
  assert.equal(canonicalize({ b: 1, a: { d: "é", c: [1, 2] } }), '{"a":{"c":[1,2],"d":"é"},"b":1}');
  assert.equal(canonicalize({ text: "é" }), '{"text":"é"}', "strings are NFC");
  assert.equal(toHex(sha256(utf8("abc"))), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("Canonical JSON serialisation — Scenario: Local data does not change the hash", () => {
  const doc = setLocal(studio(), (local) => { local.timelineViewState = { zoomLevel: 1, scrollLeft: 0, playheadTime: 0, scenePlayheads: {}, expandedKeyframeElementIds: [] }; });
  const scrolled = setLocal(doc, (local) => { (local.timelineViewState as any).scrollLeft = 480; });
  assert.equal((scrolled as any).local.timelineViewState.scrollLeft, 480);
  assert.equal(canonicalize(scrolled), canonicalize(doc));
  assert.equal(documentHash(scrolled), documentHash(doc));
  assert.equal(canonicalize(doc).includes("timelineViewState"), false);
});

test("Canonical JSON serialisation — Scenario: Float rounding", () => {
  const doc = put(studio(), "main", video("v1"));
  const after = setElementValue(doc, context(), "v1", "transform.scale.x", 1.23456789012).document;
  assert.equal(element(after, "v1").transform.scale.x, 1.234568);
  assert.ok(canonicalize(after).includes('"scale":{"x":1.234568,"y":1}'));
  assert.equal(roundStored(-0.0000004), 0, "rounding never produces negative zero");
  assert.equal(roundStored(2.5000005), 2.500001, "half away from zero");
});

test("Canonical JSON serialisation — Scenario: Negative zero rejected", () => {
  const doc = put(studio(), "main", video("v1"));
  const broken = tweak(doc, (draft) => { draft.scenes[0].tracks.main.elements[0].transform.rotation = 0; });
  (broken.scenes[0].tracks.main.elements[0] as any).transform.rotation = -0;
  const result = validateProjectDocument(broken);
  assert.equal(result.errors[0].code, "document/invalid-number");
  assert.equal(result.errors[0].path, "/scenes/@s1/tracks/main/elements/@v1/transform/rotation");
  assert.ok(Object.is((broken.scenes[0].tracks.main.elements[0] as any).transform.rotation, -0), "the validator normalises nothing");
  assert.throws(() => canonicalize(broken), /negative zero/);
  assertFails(tweak(doc, (draft) => { draft.metadata.duration = Number.MAX_SAFE_INTEGER + 2; }), "document/invalid-number");
});
