import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addTrack, applyPatch, attachTracking, canonicalize, convertTrackingToKeyframes, createHistory, createIdSource, cutoutMatteArrived, deleteElements, insertElement,
  isUuidV4, pasteElements, removeMotionTrack, requestCutout, toggleSolo, uuidV4, visibleBeats, addMask, attachMaskTracking,
} from "../src/index.ts";
import { asset, assertValid, audio, context, element, put, SECOND, sticker, studio, text, track, tweak, validate, video } from "./support/fixtures.ts";

test("Identifiers: ids created by the app are lowercase UUID v4 and are never reused within a session", () => {
  const id = uuidV4();
  assert.ok(isUuidV4(id), id);
  assert.equal(id, id.toLowerCase());
  assert.equal(uuidV4((bytes) => bytes.fill(0xff)), "ffffffff-ffff-4fff-bfff-ffffffffffff");
  // A source that would repeat itself still never hands out the same id twice.
  let call = 0;
  const repeating = createIdSource((bytes) => bytes.fill(call++ < 2 ? 1 : call));
  const issued = [repeating(), repeating(), repeating()];
  assert.equal(new Set(issued).size, 3);
  const ctx = context({ newId: createIdSource() });
  const made = addTrack(studio(), ctx, "s1", "video");
  assert.ok(isUuidV4(made.trackId));
});

test("Identifiers: redo of a creating command restores the same id; a non-history update adds no undo step", () => {
  const ctx = context({ newId: createIdSource() });
  const history = createHistory();
  const base = studio();
  const created = insertElement(base, ctx, "t-main", { type: "video", name: "clip", startTime: 0, duration: 2 * SECOND, mediaId: "a1", sourceDuration: 2 * SECOND });
  let doc = history.record(base, created);
  const id = doc.scenes[0].tracks.main.elements[0].id;
  assert.equal(history.length, 1);
  const undone = history.undo(doc, applyPatch)!;
  assert.deepEqual(undone.document.scenes[0].tracks.main.elements, []);
  assert.ok(undone.patch.some((entry) => entry.op === "remove"), "undo produces a patch of its own");
  const redone = history.redo(undone.document, applyPatch)!;
  assert.equal(redone.document.scenes[0].tracks.main.elements[0].id, id, "the same id");
  doc = redone.document;
  // Solo and an arriving matte emit patches and leave the undo stack as it is.
  const soloed = toggleSolo(doc, ctx, "t-audio");
  doc = history.record(doc, soloed);
  assert.equal(history.length, 1);
  const afterUndo = history.undo(doc, applyPatch)!;
  assert.equal(afterUndo.document.scenes[0].tracks.audio[0].solo, true, "Undo leaves the track soloed");
  const withMatte = tweak(history.redo(afterUndo.document, applyPatch)!.document, (draft) => { draft.media.assets.push(asset("m7", "video", { kind: "derived", derived: { role: "matte", sourceAssetId: "a1" }, provenance: { source: "derived", tool: "cutout" } })); });
  const requested = history.record(withMatte, requestCutout(withMatte, ctx, id));
  const length = history.length;
  history.record(requested, cutoutMatteArrived(requested, ctx, id, "m7"));
  assert.equal(history.length, length, "the undo stack length is unchanged");
});

test("Identifiers: paste gives new ids and rewrites every reference inside the copied set", () => {
  const ctx = context();
  let doc = put(put(put(studio(), "main", video("v", 0, 2, { linkId: "L", groupId: "G" })), "t-audio", audio("s", 0, 2, { linkId: "L", groupId: "G" })), "t-text", text("label", 0, 2));
  doc = attachTracking(doc, ctx, "label", "v", "m1").document;
  const copy = (id: string, trackId: string) => ({ trackId, element: element(doc, id) });
  const after = pasteElements(doc, ctx, [copy("v", "t-main"), copy("s", "t-audio"), copy("label", "t-text")], 4 * SECOND).document;
  const [pv, ps, pl] = [track(after, "t-main").elements[1], track(after, "t-audio").elements[1], track(after, "t-text").elements[1]];
  assert.equal(new Set(["v", "s", "label", pv.id, ps.id, pl.id]).size, 6);
  assert.ok(pv.linkId === ps.linkId && pv.linkId !== "L" && pv.groupId === ps.groupId && pv.groupId !== "G");
  assert.equal(pl.tracking.targetElementId, pv.id);
  assertValid(after);
  // Pasted alone, the copy has no partner: the link and the binding are not carried.
  const alone = pasteElements(doc, ctx, [copy("label", "t-text"), copy("s", "t-audio")], 4 * SECOND).document;
  assert.deepEqual([track(alone, "t-audio").elements[1].linkId, "tracking" in track(alone, "t-text").elements[1]], [null, false]);
  assertValid(alone);
});

test("Tracking binding: Convert to keyframes writes ordinary channels; deleting the motion track removes every binding", () => {
  const ctx = context();
  let doc = put(put(put(studio(), "main", video("v", 0, 4)), "t-text", text("label", 0, 4)), "t-graphic", sticker("badge", 0, 4));
  doc = attachTracking(attachTracking(doc, ctx, "label", "v", "m1").document, ctx, "badge", "v", "m1").document;
  doc = attachMaskTracking(addMask(doc, context({ newId: () => "mask1" }), "v", "ellipse").document, ctx, "v", "mask1", "m1").document;
  const converted = convertTrackingToKeyframes(doc, ctx, "label", [{ time: 0, x: 10, y: 20 }, { time: SECOND, x: 40, y: 25 }]).document;
  assert.equal("tracking" in element(converted, "label"), false);
  assert.deepEqual(element(converted, "label").animations["transform.position.x"].keys.map((key: any) => [key.time, key.value]), [[0, 10], [SECOND, 40]]);
  assertValid(converted);
  const commit = removeMotionTrack(doc, ctx, "a1", "m1");
  assert.deepEqual(["tracking" in element(commit.document, "label"), "tracking" in element(commit.document, "badge"), "tracking" in element(commit.document, "v").masks[0]], [false, false, false]);
  assert.equal(commit.history, true);
  assertValid(commit.document);
});

test("Beat markers field: split copies the list to both halves; only beats inside the visible source span are used", () => {
  const sound = { beats: [60_000, 180_000, 300_000, 420_000], trimStart: 120_000, trimEnd: 120_000, sourceDuration: 480_000 };
  assert.deepEqual(visibleBeats(sound), [180_000, 300_000]);
  assert.deepEqual(visibleBeats({ beats: [1, 2] }), [1, 2]);
});

test("Text style fields: an unregistered animation id is an error for a writer and is preserved on a document of a newer schema", () => {
  const animated = put(studio(), "t-text", text("x", 0, 2, { textAnimation: { in: { id: "sparkle", duration: 60_000, strength: 100 } } }));
  assert.deepEqual(validate(animated).errors.map((error) => error.code), ["document/unknown-definition"]);
  const newer = validate(tweak(animated, (draft) => { draft.schemaVersion = 34; }));
  assert.deepEqual([newer.ok, newer.warnings.map((warning) => warning.code)], [true, ["document/unknown-definition"]]);
  assert.ok(canonicalize(deleteElements(tweak(put(animated, "t-text", text("y", 4, 2)), (draft) => { draft.schemaVersion = 34; }), context(), ["y"]).document).includes("sparkle"));
});

test("Single undo: the steps a tool sheet made become one step on confirm; a cancelled sheet leaves none", () => {
  const ctx = context({ newId: createIdSource() });
  const history = createHistory();
  const base = studio();
  let doc = history.record(base, insertElement(base, ctx, "t-main", { type: "video", name: "one", startTime: 0, duration: 2 * SECOND, mediaId: "a1", sourceDuration: 2 * SECOND }));
  const opened = doc, mark = history.length;
  doc = history.record(doc, insertElement(doc, ctx, "t-main", { type: "video", name: "two", startTime: 2 * SECOND, duration: 2 * SECOND, mediaId: "a1", sourceDuration: 2 * SECOND }));
  doc = history.record(doc, insertElement(doc, ctx, "t-main", { type: "video", name: "three", startTime: 4 * SECOND, duration: 2 * SECOND, mediaId: "a1", sourceDuration: 2 * SECOND }));
  assert.equal(history.length, mark + 2);
  history.squashSince(mark, "Adjust");
  assert.equal(history.length, mark + 1);
  assert.equal(history.undoLabel, "Adjust");
  const undone = history.undo(doc, applyPatch)!;
  assert.deepEqual(undone.document.scenes[0].tracks.main.elements.map((element) => element.name), opened.scenes[0].tracks.main.elements.map((element) => element.name), "one undo returns to where the sheet opened");
  const redone = history.redo(undone.document, applyPatch)!;
  assert.equal(redone.document.scenes[0].tracks.main.elements.length, 3);
  // One step since the mark stays as it is.
  history.squashSince(history.length - 1, "Other");
  assert.equal(history.undoLabel, "Adjust");
});

test("Cancel discards: the undo history is unchanged — a cancelled tool sheet gives back the redo steps its first change displaced", () => {
  const ctx = context({ newId: createIdSource() });
  const history = createHistory();
  const base = studio();
  const add = (doc: ReturnType<typeof studio>, name: string) => history.record(doc, { ...insertElement(doc, ctx, "t-main", { type: "video", name, startTime: doc.scenes[0].tracks.main.elements.length * 2 * SECOND, duration: 2 * SECOND, mediaId: "a1", sourceDuration: 2 * SECOND }), label: name });
  let doc = add(add(base, "one"), "two");
  doc = history.undo(doc, applyPatch)!.document;
  assert.deepEqual([history.length, history.undoLabel, history.redoLabel], [1, "one", "two"]);
  // The sheet opens here, changes twice and is cancelled: each step is undone and forgotten.
  const mark = history.length;
  doc = add(add(doc, "three"), "four");
  assert.equal(history.canRedo, false);
  while (history.length > mark) { doc = history.undo(doc, applyPatch)!.document; history.forgetUndone(); }
  history.restoreRedo(mark);
  assert.deepEqual([history.length, history.undoLabel, history.redoLabel], [1, "one", "two"], "the history is what it was when the sheet opened");
  doc = history.redo(doc, applyPatch)!.document;
  assert.deepEqual(doc.scenes[0].tracks.main.elements.map((element) => element.name), ["one", "two"]);
  // Steps displaced at another length are not given back.
  doc = history.undo(add(doc, "five"), applyPatch)!.document;
  doc = add(add(doc, "six"), "seven");
  doc = history.undo(doc, applyPatch)!.document; history.forgetUndone();
  history.restoreRedo(history.length);
  assert.deepEqual([history.length, history.undoLabel, history.canRedo], [3, "six", false]);
});
