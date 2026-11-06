import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyEasing, boxKeySelection, clampEasing, clickKeySelection, copyKeys, easingState, EASING_PRESETS, EASING_REASONS, insertKeyOnCurve, KEY_LIMIT_MESSAGE, lanePaths, matchingPreset, moveHandle, moveKeys, neighbourKeyTime,
  pasteKeys, removeAllKeys, removeKeys, resolvedValue, scalarAt, segmentBezier, setExtrapolation, setKeyframe, setKeyValue, setSegmentType, setTangentMode, snapKeyDrag, timeline as tl, toggleKeyframe, toggleState, writeProperty,
  type KeyRef,
} from "../src/index.ts";
import { context, ids, image, put, text, video } from "./support/fixtures.ts";
import { el, open, project, S, withTracks } from "./support/timeline.ts";

// One id source for the whole file: a document passes through many commands.
const CTX = context({ newId: ids("k") });

const clip = (id = "v", start = 0, seconds = 10, extra: Record<string, unknown> = {}) => video(id, start, seconds, { sourceDuration: 60 * S, trimEnd: (60 - seconds) * S, ...extra });
const doc0 = () => put(project(), "t-main", clip());
const keys = (doc: any, path: string, id = "v"): any[] => el(doc, id).animations?.[path]?.keys ?? [];
const set = (doc: any, path: string, time: number, value: any, extra: Record<string, unknown> = {}, id = "v") => setKeyframe(doc, CTX, id, path, { time, value, ...extra }).document;
const refused = (run: () => unknown): { message: string; reason?: string; details?: any } => { try { run(); } catch (error: any) { return { message: error.message, reason: error.reason, details: error.details }; } throw new Error("the command was not refused"); };
const ref = (doc: any, path: string, time: number, id = "v"): KeyRef => ({ elementId: id, path, keyId: keys(doc, path === "transform.scale" ? "transform.scale.x" : path, id).find((key) => key.time === time).id });

test("Animatable property paths: Keyframe on a transform property; Scale is grouped; Non-keyframable param rejected; Path equals the stored field", () => {
  let doc = set(doc0(), "transform.position.x", S, 200);
  assert.deepEqual(keys(doc, "transform.position.x").map((key) => [key.time, key.value]), [[120_000, 200]]);
  doc = set(doc, "transform.scale", S, 1.5);
  assert.deepEqual([keys(doc, "transform.scale.x")[0].time, keys(doc, "transform.scale.y")[0].time, keys(doc, "transform.scale.y")[0].value], [S, S, 1.5]);
  // One lane, one toggle for the two stored channels.
  assert.deepEqual(lanePaths(el(doc, "v")), ["transform.position.x", "transform.scale"]);
  const failure = refused(() => set(doc, "blendMode", S, 1));
  assert.deepEqual([failure.reason, failure.details.reason], ["INVALID_PARAMS", "not keyframable"]);
  doc = set(doc, "transform.rotation", 0, 30);
  assert.ok(!JSON.stringify(doc).match(/transform\.rotate"|positionX|scaleX/));
  assert.equal(Object.keys(el(doc, "v").animations).includes("transform.rotation"), true);
});

test("Keyframe data model: Upsert at an occupied time; Time clamp; Key limit; Key at the element end", () => {
  let doc = set(doc0(), "opacity", S, 0.1);
  const id = keys(doc, "opacity")[0].id;
  doc = set(doc, "opacity", S, 0.25);
  assert.deepEqual(keys(doc, "opacity").map((key) => [key.id, key.value]), [[id, 0.25]]);
  doc = set(doc, "opacity", 12 * S, 0.5);
  assert.equal(keys(doc, "opacity").at(-1).time, 10 * S);
  // 1 000 keys on the frame grid, then one more at a free tick.
  const full = structuredClone(doc0()) as any, frame = 4000;
  full.scenes[0].tracks.main.elements[0].animations = { opacity: { keys: Array.from({ length: 1000 }, (_, index) => ({ id: `k${index}`, time: index * frame * 2, value: 0.5, segmentToNext: "linear", tangentMode: "auto" })), extrapolation: { before: "hold", after: "hold" } } };
  full.scenes[0].tracks.main.elements[0].duration = 3000 * frame; full.scenes[0].tracks.main.elements[0].trimEnd = 60 * S - 3000 * frame;
  assert.equal(refused(() => set(full, "opacity", frame, 1)).message, KEY_LIMIT_MESSAGE);
  // Keys 1 at 9 s and 0 at 10 s: the last rendered frame samples 9 s + 29 frames, and the key at the end stays stored.
  let end = set(doc0(), "opacity", 9 * S, 1);
  end = set(end, "opacity", 10 * S, 0);
  assert.ok(Math.abs((resolvedValue(el(end, "v"), "opacity", 9 * S + 29 * 4000) as number) - 1 / 30) < 0.001);
  assert.equal(keys(end, "opacity").at(-1).time, 10 * S);
});

test("Interpolation types: Linear midpoint; Frame-start evaluation; Hold segment; Hold extrapolation; Linear extrapolation; Bezier on an effect param", () => {
  let doc = set(doc0(), "transform.position.x", 0, 0);
  doc = set(doc, "transform.position.x", 2 * S, 100);
  const value = (time: number, source = doc) => resolvedValue(el(source, "v"), "transform.position.x", time);
  assert.equal(value(S), 50);
  let unit = set(doc0(), "opacity", 0, 0); unit = set(unit, "opacity", S, 1);
  assert.equal(resolvedValue(el(unit, "v"), "opacity", 15 * 4000), 0.5);
  const held = setSegmentType(doc, CTX, [ref(doc, "transform.position.x", 0)], "hold").document;
  assert.deepEqual([keys(held, "transform.position.x")[0].segmentToNext, value(2 * S - 1, held), value(2 * S, held)], ["step", 0, 100]);
  assert.equal(value(4 * S), 100);
  const linear = setExtrapolation(doc, CTX, "v", "transform.position.x", { after: "linear" }).document;
  assert.equal(value(4 * S, linear), 200);
  const curved = setSegmentType(doc, CTX, [ref(doc, "transform.position.x", 0)], "bezier").document, [from, to] = keys(curved, "transform.position.x");
  assert.deepEqual([from.segmentToNext, typeof from.rightHandle.dt, typeof to.leftHandle.dt], ["bezier", "number", "number"]);
});

test("Colour interpolation in linear RGB: Red to green midpoint", () => {
  let doc = put(withTracks(project(), ["t-text", "text"]), "t-text", text("t", 0, 2));
  doc = setKeyframe(doc, CTX, "t", "color", { time: 0, value: "#ff0000" }).document;
  doc = setKeyframe(doc, CTX, "t", "color", { time: 2 * S, value: "#00ff00" }).document;
  const mid = resolvedValue(el(doc, "t"), "color", S) as string, channel = (at: number) => parseInt(mid.slice(1 + at * 2, 3 + at * 2), 16);
  assert.ok(Math.abs(channel(0) - 0xbc) <= 1 && Math.abs(channel(1) - 0xbc) <= 1 && channel(2) === 0, mid);
});

test("Keyframe toggle in the properties panel: Add at playhead; Auto-keyframe on change; Removing the last keyframe: Last key removed; Undo restores the channel", () => {
  const base = put(project(), "t-main", clip("v", 0, 10, { opacity: 0.8 }));
  assert.equal(toggleState(el(base, "v"), "opacity", 2 * S), "hollow");
  let doc = toggleKeyframe(base, CTX, "v", "opacity", 2 * S, 1).document;
  assert.deepEqual([keys(doc, "opacity").map((key) => [key.time, key.value]), toggleState(el(doc, "v"), "opacity", 2 * S), toggleState(el(doc, "v"), "opacity", S)], [[[2 * S, 0.8]], "filled", "half"]);
  // A property with keys takes an edit as a key at the playhead; the stored value stays.
  doc = writeProperty(doc, CTX, "v", "opacity", 0.3, 5 * S).document;
  assert.deepEqual([keys(doc, "opacity").map((key) => [key.time, key.value]), el(doc, "v").opacity], [[[2 * S, 0.8], [5 * S, 0.3]], 0.8]);
  assert.equal(writeProperty(base, CTX, "v", "opacity", 0.3, 5 * S).document.scenes[0].tracks.main.elements[0].opacity, 0.3);
  // One key of 0.4 over a base of 0.1: removing it hands 0.4 to the base, and undo brings both back.
  const session = open(put(project(), "t-main", clip("v", 0, 10, { opacity: 0.1 })));
  session.adoptCommit(setKeyframe(session.document, CTX, "v", "opacity", { time: S, value: 0.4 }), session.document);
  const before = session.document;
  session.adoptCommit(toggleKeyframe(before, CTX, "v", "opacity", S), before);
  assert.deepEqual([el(session.document, "v").animations, el(session.document, "v").opacity], [undefined, 0.4]);
  session.undo();
  assert.deepEqual([keys(session.document, "opacity").length, el(session.document, "v").opacity], [1, 0.1]);
});

test("Delete keyframes: Delete selected keys; Remove all on a property; Keyframe navigation: Next keyframe; No further keyframe", () => {
  let doc = doc0();
  for (const [time, value] of [[S, 0.2], [2 * S, 1], [3 * S, 0.4]] as const) doc = set(doc, "opacity", time, value);
  doc = set(doc, "transform.rotation", 4 * S, 10);
  const session = open(doc);
  const refs = [ref(doc, "opacity", S), ref(doc, "opacity", 2 * S), ref(doc, "transform.rotation", 4 * S)];
  const steps = session.historyLength;
  session.adoptCommit(removeKeys(session.document, CTX, refs), session.document);
  assert.deepEqual([keys(session.document, "opacity").length, el(session.document, "v").animations["transform.rotation"], el(session.document, "v").transform.rotation, session.historyLength - steps], [1, undefined, 10, 1]);
  session.undo();
  assert.equal(keys(session.document, "opacity").length, 3);
  // Resolved 0.6 at the playhead becomes the stored opacity.
  const all = removeAllKeys(doc, CTX, "v", "opacity", 1.5 * S).document;
  assert.deepEqual([el(all, "v").animations.opacity, Math.round(el(all, "v").opacity * 1000) / 1000], [undefined, 0.6]);
  assert.deepEqual([neighbourKeyTime(el(doc, "v"), 0.5 * S, "next"), neighbourKeyTime(el(doc, "v"), 4 * S, "next"), neighbourKeyTime(el(doc, "v"), 4 * S, "previous"), neighbourKeyTime(el(doc, "v"), 2.5 * S, "next", "opacity")], [S, null, 3 * S, 3 * S]);
});

test("Drag keyframes in time: Move two keys; Clamp at the element end; Snap to the playhead; Shift disables snapping; Selected keys are not snap targets; Keyframe commands, undo and agent access: Undo a multi-key drag", () => {
  let doc = doc0();
  for (const time of [S, 2 * S, 9.8 * S]) doc = set(doc, "opacity", time, 0.5);
  const session = open(doc);
  session.adoptCommit(moveKeys(session.document, CTX, [ref(doc, "opacity", S), ref(doc, "opacity", 2 * S)], 15 * 4000), session.document);
  assert.deepEqual(keys(session.document, "opacity").map((key) => key.time / S), [1.5, 2.5, 9.8]);
  session.undo();
  assert.deepEqual(keys(session.document, "opacity").map((key) => key.time / S), [1, 2, 9.8]);
  assert.equal(keys(moveKeys(doc, CTX, [ref(doc, "opacity", 9.8 * S)], S).document, "opacity").at(-1).time, 10 * S);
  // The anchor key 9 px from the playhead at local 3 s, with a 10 px threshold of 100 ticks per px.
  assert.deepEqual(snapKeyDrag(2 * S, S - 900, [3 * S], 1000, true), { delta: S, line: 3 * S });
  assert.deepEqual(snapKeyDrag(2 * S, S - 900, [3 * S], 1000, false), { delta: S - 900, line: null });
  // Two selected keys 4 frames apart: the targets exclude them, so their spacing stays.
  const two = set(set(doc0(), "opacity", S, 1), "opacity", S + 16_000, 0), both = keys(two, "opacity").map((key) => ({ elementId: "v", path: "opacity", keyId: key.id }));
  const targets = tl.keySnapTargets(two, "s1", both, { playhead: 30 * S });
  assert.ok(!targets.includes(S) && !targets.includes(S + 16_000));
  const pair = moveKeys(two, CTX, both, snapKeyDrag(S, 8000, targets, 16_000, true).delta).document;
  assert.deepEqual(keys(pair, "opacity").map((key) => key.time), [S + 8000, S + 24_000]);
  // Five keys in one drag: one undo returns all five.
  let five = doc0();
  for (let index = 0; index < 5; index++) five = set(five, "transform.position.x", index * S, index);
  const many = open(five), count = many.historyLength;
  many.adoptCommit(moveKeys(many.document, CTX, keys(five, "transform.position.x").map((key) => ({ elementId: "v", path: "transform.position.x", keyId: key.id })), S), many.document);
  assert.deepEqual([keys(many.document, "transform.position.x").map((key) => key.time / S), many.historyLength - count], [[1, 2, 3, 4, 5], 1]);
  many.undo();
  assert.deepEqual(keys(many.document, "transform.position.x").map((key) => key.time / S), [0, 1, 2, 3, 4]);
});

test("Keyframe click selection: Range selection; Toggle; Keyframe box selection: Box select across lanes; Additive", () => {
  let doc = doc0();
  for (const time of [S, 2 * S, 3 * S]) doc = set(doc, "opacity", time, 0.5);
  doc = set(doc, "transform.position.x", 2 * S, 5);
  const element = el(doc, "v"), a = ref(doc, "opacity", S), c = ref(doc, "opacity", 3 * S), b = ref(doc, "opacity", 2 * S), x = ref(doc, "transform.position.x", 2 * S);
  assert.deepEqual(clickKeySelection(element, [], undefined, a, {}).keys, [a]);
  // Time-then-path order: 1 s opacity, 2 s position, 2 s opacity, 3 s opacity.
  assert.deepEqual(clickKeySelection(element, [a], a, c, { shift: true }).keys, [a, x, b, c]);
  assert.deepEqual(clickKeySelection(element, [a, c], a, a, { mod: true }).keys, [c]);
  // Lanes from y 40, 20 px each: position first, opacity second; 100 px per second.
  const geometry = { pixelsPerTick: 100 / S, top: 40, laneHeight: 20 };
  assert.deepEqual(boxKeySelection(element, { x1: 150, x2: 320, y1: 42, y2: 78 }, geometry), [x, b, c]);
  assert.deepEqual(boxKeySelection(element, { x1: 150, x2: 320, y1: 62, y2: 78 }, geometry, [a]).length, 3);
});

test("Copy and paste keyframes: Paste uses element-local time; Keys beyond the duration are dropped; Paste onto several elements; Incompatible path; Playhead outside the target; Cut", () => {
  let doc = put(project(), "t-main", clip("v", 0, 4), clip("w", 10, 4), clip("x", 14, 4), clip("y", 18, 4), image("i", 22, 4));
  doc = set(set(doc, "opacity", 0, 0.2), "opacity", S, 0.9);
  const copied = copyKeys(doc, [ref(doc, "opacity", 0), ref(doc, "opacity", S)])!;
  assert.deepEqual(copied.items.map((item) => [item.path, item.time, item.value]), [["opacity", 0, 0.2], ["opacity", S, 0.9]]);
  const one = pasteKeys(doc, CTX, copied, ["w"], 12 * S);
  assert.deepEqual([keys(one.commit!.document, "opacity", "w").map((key) => key.time / S), one.skipped, one.pasted.length], [[2, 3], 0, 2]);
  const late = pasteKeys(doc, CTX, copied, ["w"], 13.5 * S);
  assert.deepEqual([keys(late.commit!.document, "opacity", "w").map((key) => key.time / S), late.skipped], [[3.5], 1]);
  const session = open(doc), three = pasteKeys(session.document, CTX, copied, ["w", "x", "y"], 0);
  session.adoptCommit(three.commit!, session.document);
  // The playhead is before every target: the anchor is local 0.
  assert.deepEqual(["w", "x", "y"].map((id) => keys(session.document, "opacity", id).map((key) => key.time / S)), [[0, 1], [0, 1], [0, 1]]);
  session.undo();
  assert.deepEqual(["w", "x", "y"].map((id) => keys(session.document, "opacity", id).length), [0, 0, 0]);
  let sound = set(doc, "volume", 0, -6);
  const volume = pasteKeys(sound, CTX, copyKeys(sound, [ref(sound, "volume", 0)])!, ["i"], 22 * S);
  assert.deepEqual([volume.commit, volume.skipped], [null, 1]);
  // Cut: the keys are on the clipboard and one step removes them.
  const cut = open(doc), refs = [ref(doc, "opacity", 0), ref(doc, "opacity", S)], held = copyKeys(cut.document, refs)!;
  cut.adoptCommit(removeKeys(cut.document, CTX, refs, { label: "Cut keyframes" }), cut.document);
  assert.deepEqual([held.items.length, el(cut.document, "v").animations], [2, undefined]);
  cut.undo();
  assert.equal(keys(cut.document, "opacity").length, 2);
});

test("Easing presets: Apply Ease out; Linear is stored as linear; Graph editor easing view: Drag a handle; Snap; Multiple properties; Graph editor availability: Nothing selected; Keys on two elements; Last key of a channel", () => {
  assert.equal(EASING_PRESETS.length, 13);
  let doc = put(project(), "t-main", clip("v"), clip("w", 10));
  doc = set(set(doc, "opacity", 0, 0), "opacity", 2 * S, 1);
  doc = set(set(doc, "transform.position.x", 0, 0), "transform.position.x", 2 * S, 300);
  doc = set(doc, "opacity", S, 0.5, {}, "w");
  const first = ref(doc, "opacity", 0);
  let eased = applyEasing(doc, CTX, [first], [0, 0, 0.2, 1]).document;
  assert.deepEqual([keys(eased, "opacity")[0].segmentToNext, segmentBezier(keys(eased, "opacity"), first.keyId), matchingPreset(segmentBezier(keys(eased, "opacity"), first.keyId))], ["bezier", [0, 0, 0.2, 1], "ease-out"]);
  eased = applyEasing(eased, CTX, [first], [0, 0, 1, 1]).document;
  assert.deepEqual([keys(eased, "opacity")[0].segmentToNext, keys(eased, "opacity")[0].rightHandle, keys(eased, "opacity")[1].leftHandle], ["linear", undefined, undefined]);
  // A handle dragged to (0.6, 0.0); a Y of 0.97 snaps to 1.
  const dragged = applyEasing(doc, CTX, [first], clampEasing([0.6, 0.0, 0.5, 0.97])).document;
  assert.deepEqual(segmentBezier(keys(dragged, "opacity"), first.keyId), [0.6, 0, 0.5, 1]);
  assert.deepEqual(clampEasing([0.6, 0.03, 1.4, 0.97], true), [0.6, 0.03, 1, 0.97]);
  const pop = EASING_PRESETS.find((preset) => preset.id === "pop")!.bezier, session = open(doc), steps = session.historyLength;
  session.adoptCommit(applyEasing(session.document, CTX, [first, ref(doc, "transform.position.x", 0)], pop), session.document);
  assert.deepEqual([matchingPreset(segmentBezier(keys(session.document, "opacity"), first.keyId)), matchingPreset(segmentBezier(keys(session.document, "transform.position.x"), keys(doc, "transform.position.x")[0].id)), session.historyLength - steps], ["pop", "pop", 1]);
  assert.deepEqual(easingState(doc, []), { ok: false, reason: EASING_REASONS.none });
  assert.deepEqual(easingState(doc, [first, ref(doc, "opacity", S, "w")]), { ok: false, reason: "Selected keyframes must be on the same element." });
  assert.deepEqual(easingState(doc, [ref(doc, "opacity", 2 * S)]), { ok: false, reason: "Select a keyframe that has an outgoing segment." });
  const held = setSegmentType(doc, CTX, [first], "hold").document;
  assert.deepEqual(easingState(held, [first]), { ok: false, reason: EASING_REASONS.hold });
});

test("Graph editor curves view: Drag a key in value; Insert a key on the curve; Set extrapolation; Tangent handles and modes: Aligned handles; Break tangents; Handle cannot pass the next key", () => {
  let doc = doc0();
  for (const [time, value] of [[0, 0], [S, 100], [2 * S, 40], [3 * S, 90]] as const) doc = set(doc, "transform.position.x", time, value);
  doc = set(doc, "opacity", S, 0.5);
  // Opacity is clamped to its range.
  assert.equal(keys(setKeyValue(doc, CTX, ref(doc, "opacity", S), 1.7).document, "opacity")[0].value, 1);
  const refs = keys(doc, "transform.position.x").map((key) => ({ elementId: "v", path: "transform.position.x", keyId: key.id }));
  doc = setSegmentType(doc, CTX, refs, "bezier").document;
  const before = [0.5, 1.2, 1.9, 2.6].map((seconds) => resolvedValue(el(doc, "v"), "transform.position.x", Math.round(seconds * S)) as number);
  const inserted = insertKeyOnCurve(doc, CTX, "v", "transform.position.x", 1.2 * S).document;
  assert.equal(keys(inserted, "transform.position.x").length, 5);
  assert.equal(keys(inserted, "transform.position.x")[2].time, 1.2 * S);
  assert.ok(Math.abs((resolvedValue(el(inserted, "v"), "transform.position.x", 1.2 * S) as number) - before[1]) < 0.5);
  const session = open(doc);
  session.adoptCommit(setExtrapolation(session.document, CTX, "v", "transform.position.x", { after: "linear" }), session.document);
  assert.equal(el(session.document, "v").animations["transform.position.x"].extrapolation.after, "linear");
  assert.notEqual(scalarAt(el(session.document, "v").animations["transform.position.x"], 5 * S), 90);
  session.undo();
  assert.equal(el(session.document, "v").animations["transform.position.x"].extrapolation.after, "hold");
  // Aligned: the left handle turns to stay on the line through the key and keeps its reach.
  const key = refs[1];
  let handled = setTangentMode(doc, CTX, [key], "aligned").document;
  const left = keys(handled, "transform.position.x")[1].leftHandle;
  handled = moveHandle(handled, CTX, key, "right", { dt: 20_000, dv: 30 }).document;
  const turned = keys(handled, "transform.position.x")[1];
  assert.deepEqual([turned.tangentMode, turned.leftHandle.dt, Math.round((turned.leftHandle.dv / turned.leftHandle.dt) * 1e9), Math.round((30 / 20_000) * 1e9)], ["aligned", left.dt, Math.round((30 / 20_000) * 1e9), Math.round((30 / 20_000) * 1e9)]);
  const broken = moveHandle(handled, CTX, key, "right", { dt: 20_000, dv: -80 }, { breakTangent: true }).document;
  assert.deepEqual([keys(broken, "transform.position.x")[1].tangentMode, keys(broken, "transform.position.x")[1].leftHandle], ["broken", turned.leftHandle]);
  assert.equal(keys(moveHandle(handled, CTX, key, "right", { dt: 5 * S, dv: 0 }).document, "transform.position.x")[1].rightHandle.dt, S);
});

test("Keyframe commands, undo and agent access: Duplicate copies animation; Agent easing preset; Expanded keyframe lanes and keyframe panel: Expand", () => {
  let doc = put(project(), "t-main", clip("v", 0, 4, { clipAnimation: { in: { type: "fade-in", duration: 60_000, strength: 100 } } }));
  doc = set(set(doc, "opacity", 0, 0, { easing: "Ease out" }), "opacity", S, 1);
  // The preset is written when the segment exists: the first key, set again once the second is there.
  doc = set(doc, "opacity", 0, 0, { easing: "Ease out" });
  assert.deepEqual([keys(doc, "opacity")[0].segmentToNext, segmentBezier(keys(doc, "opacity"), keys(doc, "opacity")[0].id)], ["bezier", [0, 0, 0.2, 1]]);
  const session = open(doc);
  const made = session.execute(tl.duplicate({ sceneId: "s1", elementIds: ["v"] }), { magnet: true, ripple: false, linkage: true, freeLayer: false }) as any;
  assert.ok(made.ok);
  const copy = session.document.scenes[0].tracks.main.elements.concat(...session.document.scenes[0].tracks.overlay.map((track: any) => track.elements)).find((element: any) => element.id !== "v") as any;
  assert.deepEqual([copy.animations.opacity.keys.map((key: any) => key.value), copy.animations.opacity.keys.some((key: any) => keys(doc, "opacity").some((old) => old.id === key.id)), copy.clipAnimation], [[0, 1], false, el(doc, "v").clipAnimation]);
  // Lanes in group order: position, opacity; each animated path is one 20 px lane.
  let lanes = set(set(doc0(), "opacity", S, 1), "transform.position.x", S, 4);
  assert.deepEqual(lanePaths(el(lanes, "v")), ["transform.position.x", "opacity"]);
});
