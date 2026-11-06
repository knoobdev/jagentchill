import assert from "node:assert/strict";
import { test } from "node:test";
import { renameProject, timeline } from "@jagentchill/editor-core";
import { TICKS_PER_SECOND as S } from "@jagentchill/protocol";
import { ids, NOW, REGISTRIES } from "../../editor-core/test/support/fixtures.ts";
import { el, main, overlay, project, spans, trackIdOf } from "../../editor-core/test/support/timeline.ts";
import {
  actionForKey, bindingKeys, clipZone, comboOf, createEditorController, dragLibraryItems, dropTargetAt, filmstripFrameIndex, filmstripTiles, FREEZE_DEFAULT_TICKS, freezeTarget, layoutRows, marqueeOf, pressClip, pressEmpty, pressMarker, pressRuler, rowAtY,
  rowsHeight, runEditorAction, TIMELINE_FRAME, timeAtX, trimTooltip, visibleElements, waveformBars, xOfTime, zoomAction, type ActionHost, type GestureEnv, type GesturePoint, type SavedCommit,
} from "../src/index.ts";

let prefs = { ...timeline.DEFAULT_TIMELINE_PREFERENCES };
/** A controller over the fixture project: the 20 s video twice on the main track (0–20, 20–40) and the 60 s sound under it. */
function open() {
  prefs = { ...timeline.DEFAULT_TIMELINE_PREFERENCES };
  const saved: SavedCommit[] = [], messages: string[] = [], locals: number[] = [];
  const controller = createEditorController({
    document: project(), newId: ids("gen"), now: () => NOW + 1, registries: REGISTRIES, platform: "web", prefs: () => prefs,
    onCommit: (commit) => { saved.push(commit); }, onLocal: (document) => locals.push(timeline.playheadOf(document)), onMessage: (message) => messages.push(message),
  });
  const sceneId = controller.session.sceneId;
  const add = (assetId: string, time: number) => controller.run(timeline.addToTimeline({ sceneId, items: [{ kind: "media", assetId }], time })).info!.elementIds[0];
  const first = add("a4", 0), second = add("a4", 20 * S), sound = add("a3", 0);
  const host: ActionHost = { controller, prefs: () => prefs, setPrefs: (next) => { prefs = next; }, viewportWidth: () => 1000, message: (text) => messages.push(text) };
  const env: GestureEnv = { controller, prefs: () => prefs, rows: () => layoutRows(controller.document), zoomLevel: () => controller.session.view.zoomLevel, platform: "web" };
  return { controller, sceneId, first, second, sound, host, env, saved, messages, locals, act: (id: string, payload?: { trackId?: string }) => runEditorAction(host, id, payload) };
}
/** A pointer sample at a time and a content y; x on screen follows the time at 50 px per second. */
const at = (seconds: number, y: number, extra: Partial<GesturePoint> = {}): GesturePoint => ({ time: Math.round(seconds * S), y, clientX: seconds * 50, clientY: y, ...extra });

// — Controller: one writer, one history, one save —
test("every executed command reaches the save manager once, with its patch and label", () => {
  const { controller, saved, sceneId, first } = open();
  const before = saved.length;
  controller.run(timeline.split({ sceneId, time: 5 * S, elementIds: [first] }));
  assert.equal(saved.length, before + 1);
  assert.equal(saved[saved.length - 1].label, "Split");
  assert.ok(saved[saved.length - 1].patch.length > 0);
  assert.equal(saved[saved.length - 1].document, controller.stored);
  controller.undo();
  assert.equal(saved.length, before + 2);
  assert.equal(main(controller.stored).elements.length, 2);
});
test("a command of another family is one step of the same history, and a refused one says why", () => {
  const { controller, messages } = open();
  const steps = controller.session.historyLength;
  assert.ok(controller.external((doc, ctx) => renameProject(doc, ctx, "Trip")));
  assert.equal(controller.stored.metadata.name, "Trip");
  assert.equal(controller.session.historyLength, steps + 1);
  controller.undo();
  assert.notEqual(controller.stored.metadata.name, "Trip");
  controller.redo();
  assert.equal(controller.stored.metadata.name, "Trip");
  assert.equal(controller.external(() => { throw new timeline.CommandRefused("The track is locked", "track-locked"); }), false);
  assert.deepEqual(messages, ["The track is locked"]);
});
test("a live draft is drawn without a step, and the commit that follows is one step from the stored document", () => {
  const { controller } = open();
  const steps = controller.session.historyLength;
  controller.external((doc, ctx) => renameProject(doc, ctx, "A"), true);
  controller.external((doc, ctx) => renameProject(doc, ctx, "AB"), true);
  assert.equal(controller.document.metadata.name, "AB");
  assert.notEqual(controller.stored.metadata.name, "AB");
  assert.equal(controller.session.historyLength, steps);
  controller.external((doc, ctx) => renameProject(doc, ctx, "ABC"));
  assert.equal(controller.stored.metadata.name, "ABC");
  assert.equal(controller.session.historyLength, steps + 1);
});
test("a rolled-back media commit leaves no undo step and never comes back by redo", () => {
  const { controller } = open();
  const steps = controller.session.historyLength;
  let made: ReturnType<typeof renameProject> | null = null;
  controller.external((doc, ctx) => (made = renameProject(doc, ctx, "Imported")));
  assert.ok(controller.rollback(made!));
  assert.notEqual(controller.stored.metadata.name, "Imported");
  assert.equal(controller.session.historyLength, steps);
  assert.equal(controller.session.canRedo, false);
});
test("view state changes are device-local: they notify, save without a patch and add no step", () => {
  const { controller, saved, locals } = open();
  const before = saved.length, steps = controller.session.historyLength;
  let notified = 0;
  controller.subscribe(() => notified++);
  controller.seek(3 * S);
  controller.setView({ zoomLevel: 2, scrollLeft: 40 });
  assert.equal(notified, 2);
  assert.equal(saved.length, before);
  assert.equal(controller.session.historyLength, steps);
  assert.equal(locals[locals.length - 2], 3 * S);
  assert.deepEqual([controller.session.view.zoomLevel, controller.session.view.scrollLeft], [2, 40]);
});
test("a read-only project rejects commands with the reason", () => {
  const { controller, messages, sceneId, first } = open();
  controller.setReadOnly("Read-only");
  assert.equal(controller.run(timeline.deleteElements({ sceneId, elementIds: [first] })).ok, false);
  assert.equal(controller.external((doc, ctx) => renameProject(doc, ctx, "X")), false);
  assert.deepEqual(messages, ["Read-only", "Read-only"]);
});

// — Layout —
test("rows follow the engine's order at the frame's sizes, and a row grows by its keyframe lanes", () => {
  const { controller } = open();
  const rows = layoutRows(controller.stored);
  assert.deepEqual(rows.map((row) => [row.zone, row.type, row.top, row.height]), [["main", "video", 4, 56], ["audio", "audio", 64, 40]]);
  assert.equal(rowsHeight(rows), 108);
  assert.deepEqual(rows.map((row) => row.alt), [false, true]);
  assert.equal(TIMELINE_FRAME.headerWidth, 112);
});
test("a content y maps to a row and its half; gaps belong to the row above; outside is above or below", () => {
  const rows = layoutRows(open().controller.stored);
  assert.deepEqual([rowAtY(rows, 10).half, rowAtY(rows, 50).half, rowAtY(rows, 62).row?.zone, rowAtY(rows, 70).row?.zone], ["upper", "lower", "main", "audio"]);
  assert.deepEqual([rowAtY(rows, 0).outside, rowAtY(rows, 500).outside], ["above", "below"]);
  assert.deepEqual(dropTargetAt(rows, 10, "up"), { hoveredTrackId: rows[0].trackId, half: "upper", dragDirection: "up" });
  assert.deepEqual(dropTargetAt(rows, 500), { outside: "below" });
});
test("pixels and ticks map through zoom and scroll, on the device-pixel grid", () => {
  const view = { zoomLevel: 2, scrollLeft: 100 };
  assert.equal(timeAtX(100, view), 2 * S);
  assert.equal(xOfTime(2 * S, view), 100);
  assert.equal(timeAtX(-500, view), 0);
  assert.equal(xOfTime(1, { zoomLevel: 1, scrollLeft: 0 }, 2), 0);
});
test("the trim handles are the 8 px at the edges, and a narrow clip keeps a body", () => {
  assert.deepEqual([clipZone(3, 200), clipZone(100, 200), clipZone(195, 200)], ["trim-start", "body", "trim-end"]);
  assert.deepEqual([clipZone(2, 12), clipZone(6, 12), clipZone(11, 12)], ["trim-start", "body", "trim-end"]);
});
test("only the elements inside the viewport and its overscan are mounted; a dragged one stays", () => {
  const elements = Array.from({ length: 200 }, (_, index) => ({ id: `e${index}`, startTime: index * 10 * S, duration: 10 * S }));
  const shown = visibleElements(elements, { zoomLevel: 1, scrollLeft: 20_000, width: 1000 }, 400);
  assert.deepEqual([shown[0].id, shown[shown.length - 1].id, shown.length], ["e39", "e42", 4]);
  assert.ok(visibleElements(elements, { zoomLevel: 1, scrollLeft: 20_000, width: 1000 }, 400, new Set(["e0"])).some((element) => element.id === "e0"));
});
test("filmstrip tiles are as wide as the strip is high times the aspect, each at its own source time", () => {
  const tiles = filmstripTiles({ clipWidth: 200, stripHeight: 40, aspect: 16 / 9, trimStart: 2 * S, zoomLevel: 1 });
  assert.deepEqual(tiles.map((tile) => [tile.x, tile.width]), [[0, 71], [71, 71], [142, 71]]);
  assert.deepEqual(tiles.map((tile) => tile.sourceTime), [2 * S, 2 * S + 170_400, 2 * S + 340_800]);
  assert.deepEqual(filmstripTiles({ clipWidth: 2000, stripHeight: 40, aspect: 16 / 9, trimStart: 0, zoomLevel: 1, visibleFrom: 700, visibleTo: 900 }).map((tile) => tile.x), [639, 710, 781, 852]);
  assert.equal(filmstripFrameIndex(2.4 * S, S, 10), 2);
});
test("waveform bars read the clip's source window out of the asset's summary", () => {
  const peaks = Float32Array.from({ length: 100 }, (_, index) => (index < 50 ? 0.2 : 0.8));
  assert.deepEqual(waveformBars(peaks, 10 * S, { trimStart: 4 * S, sourceSpan: 2 * S }, 2), [0.20000000298023224, 0.800000011920929]);
  assert.deepEqual(waveformBars(peaks, 10 * S, { trimStart: 9 * S, sourceSpan: 2 * S }, 2).length, 2);
  assert.equal(trimTooltip(1.5 * S, -1.5 * S), "00:01.5 (−00:01.5)");
  assert.deepEqual(marqueeOf({ x: 100, y: 50 }, { x: 50, y: 10 }, 1), { startTime: S, endTime: 2 * S, top: 10, bottom: 50 });
});

// — Gestures —
test("a press on a clip selects it; a drag past the threshold moves the selection as one undo step", () => {
  const { controller, env, sound } = open();
  const steps = controller.session.historyLength;
  const gesture = pressClip(env, { ...at(2, 80), elementId: sound, zone: "body" });
  assert.deepEqual(controller.session.selection.selectedElements, [sound]);
  gesture.move(at(2.04, 80));
  assert.equal(gesture.feedback.kind, "idle");
  gesture.move(at(5.2, 80, { shift: true }));
  assert.equal(gesture.feedback.kind, "move");
  assert.equal(el(controller.document, sound).startTime, 384_000);
  assert.equal(el(controller.stored, sound).startTime, 0);
  gesture.end();
  assert.equal(el(controller.stored, sound).startTime, 384_000);
  assert.equal(controller.session.historyLength, steps + 1);
});
test("a moved clip snaps to the edges of the others and shows the snap line there", () => {
  const { controller, env, sound, sceneId } = open();
  controller.run(timeline.trim({ sceneId, elementId: sound, side: "end", delta: -50 * S }));
  const gesture = pressClip(env, { ...at(1, 80), elementId: sound, zone: "body" });
  gesture.move(at(21.1, 80));
  assert.equal(el(controller.document, sound).startTime, 20 * S);
  assert.equal(gesture.feedback.snapTime, 20 * S);
  gesture.cancel();
  assert.equal(el(controller.document, sound).startTime, 0);
});
test("dragging a main clip outside the rows opens a new overlay track, and the magnet closes the gap", () => {
  const { controller, env, first, second } = open();
  const gesture = pressClip(env, { ...at(25, 30), elementId: second, zone: "body" });
  gesture.move(at(25, -40));
  assert.deepEqual(gesture.feedback.drop, { kind: "new-track", y: 4 });
  gesture.end();
  assert.equal(overlay(controller.stored).length, 1);
  assert.equal(trackIdOf(controller.stored, second), overlay(controller.stored)[0].id);
  assert.deepEqual(spans(controller.stored, main(controller.stored).id), [[0, 20]]);
  void first;
});
test("a drag of an edge trims with the duration tooltip; Escape leaves the clip as it was", () => {
  const { controller, env, second } = open();
  controller.seek(30 * S);
  const gesture = pressClip(env, { ...at(40, 30), elementId: second, zone: "trim-end" });
  gesture.move(at(30.1, 30));
  assert.equal(gesture.feedback.kind, "trim");
  assert.equal(gesture.feedback.snapTime, 30 * S);
  assert.equal(gesture.feedback.tooltip?.text, "00:10.0 (−00:10.0)");
  assert.equal(el(controller.document, second).duration, 10 * S);
  gesture.cancel();
  assert.equal(el(controller.document, second).duration, 20 * S);
  assert.equal(controller.session.gestureActive, false);
});
test("a click with the toggle modifier adds to the selection; a plain click on one of several leaves it alone selected", () => {
  const { controller, env, first, second } = open();
  pressClip(env, { ...at(2, 30), elementId: first, zone: "body" }).end();
  pressClip(env, { ...at(25, 30), elementId: second, zone: "body", toggle: true }).end();
  assert.deepEqual([...controller.session.selection.selectedElements].sort(), [first, second].sort());
  pressClip(env, { ...at(25, 30), elementId: second, zone: "body" }).end();
  assert.deepEqual(controller.session.selection.selectedElements, [second]);
});
test("in Split mode a press cuts the clip under the pointer; on a locked track a press does nothing", () => {
  const { controller, env, first, act } = open();
  controller.setCursorMode("blade");
  pressClip(env, { ...at(5, 30), elementId: first, zone: "body" });
  assert.equal(main(controller.stored).elements.length, 3);
  controller.setCursorMode("select");
  act("timeline.track-lock.toggle", { trackId: main(controller.stored).id });
  const gesture = pressClip(env, { ...at(2, 30), elementId: first, zone: "body" });
  gesture.move(at(9, 30)); gesture.end();
  assert.equal(el(controller.stored, first).startTime, 0);
});
test("a press on the ruler seeks without snapping, and scrubbing snaps to clip edges", () => {
  const { controller, env } = open();
  const gesture = pressRuler(env, at(19.95, 0));
  assert.equal(controller.session.playhead, 2_396_000);
  gesture.move(at(20.1, 0));
  assert.equal(controller.session.playhead, 20 * S);
  assert.equal(gesture.feedback.snapTime, 20 * S);
  gesture.move(at(500, 0));
  assert.equal(controller.session.playhead, 60 * S);
});
test("a press on empty track area deselects and seeks; a drag draws the marquee and selects what it meets", () => {
  const { controller, env, first, second, sound } = open();
  controller.select(timeline.selectElements([first]));
  pressEmpty(env, { ...at(45, 30), contentX: 45 * 50, now_ms: 0 }).end({ ...at(45, 30), now_ms: 100 } as GesturePoint);
  assert.deepEqual(controller.session.selection.selectedElements, []);
  assert.equal(controller.session.playhead, 45 * S);
  const gesture = pressEmpty(env, { ...at(45, 20), contentX: 45 * 50, now_ms: 0 });
  gesture.move(at(30, 90));
  assert.deepEqual(gesture.feedback.marquee, { left: 1500, top: 20, width: 750, height: 70 });
  assert.deepEqual([...controller.session.selection.selectedElements].sort(), [second, sound].sort());
  gesture.cancel();
  assert.deepEqual(controller.session.selection.selectedElements, []);
});
test("a marker follows a drag with snapping as one step; a press without travel is a click", () => {
  const { controller, env, sceneId } = open();
  const markerId = controller.run(timeline.toggleMarker({ sceneId, time: 5 * S })).info!.markerId!;
  const steps = controller.session.historyLength;
  let clicked = 0;
  pressMarker(env, { ...at(5, 0), markerId, onClick: () => clicked++ }).end();
  assert.equal(clicked, 1);
  const gesture = pressMarker(env, { ...at(5, 0), markerId, onClick: () => clicked++ });
  gesture.move(at(19.9, 0));
  gesture.end();
  assert.equal((timeline.sceneById(controller.stored, sceneId).markers as { time: number }[])[0].time, 20 * S);
  assert.equal(controller.session.historyLength, steps + 1);
});
test("a library item dragged over the tracks shows where the engine would place it, and the drop inserts it there", () => {
  const { controller, env } = open();
  const rows = layoutRows(controller.stored), drag = dragLibraryItems(env, [{ kind: "media", assetId: "a2" }]);
  const over = drag.over({ time: 50 * S, y: rows[0].top + 40 })!;
  assert.deepEqual([over.type, over.duration, over.decision.kind], ["image", 600_000, "track"]);
  assert.ok(drag.drop({ time: 50 * S, y: rows[0].top + 40 }));
  assert.equal(main(controller.stored).elements.length, 3);
  assert.ok(dragLibraryItems(env, [{ kind: "media", assetId: "a3" }]).over({ time: 0, y: -50 })?.decision.kind === "new-track");
});

// — Actions and keys —
test("Freeze frame of a clip that has an effect: the freeze element gets ids of its own for the copied effects", () => {
  const { controller, first, act, sceneId, messages } = open();
  assert.ok(controller.run(timeline.applyEffect({ sceneId, elementIds: [first], type: "glow" })).ok);
  controller.select(timeline.selectElements([first]));
  controller.seek(5 * S);
  act("timeline.freeze");
  assert.deepEqual(messages, [], "the freeze is not refused");
  const [left, frozen, right] = main(controller.stored).elements as unknown as { effects: { id: string; type: string }[]; freeze?: unknown }[];
  assert.ok(frozen.freeze, "the freeze element is between the two parts");
  assert.deepEqual(frozen.effects.map((entry) => entry.type), ["glow"]);
  assert.equal(new Set([left, frozen, right].flatMap((element) => element.effects.map((entry) => entry.id))).size, 3, "no effect id is used twice");
});
test("Freeze frame entry: the clip is split at the playhead, a 3 s freeze goes between, and the rest moves right as one step", () => {
  const { controller, first, second, act, sceneId } = open();
  controller.select(timeline.selectElements([first]));
  controller.seek(5 * S);
  assert.equal(freezeTarget(controller.stored, sceneId, [first], 5 * S), first);
  const steps = controller.session.historyLength;
  act("timeline.freeze");
  assert.deepEqual(spans(controller.stored, main(controller.stored).id), [[0, 5], [5, 8], [8, 23], [23, 43]]);
  const frozen = main(controller.stored).elements[1];
  assert.deepEqual([frozen.freeze, frozen.duration], [{ mediaId: "a4", sourceTime: 5 * S }, FREEZE_DEFAULT_TICKS]);
  assert.equal(el(controller.stored, second).startTime, 23 * S);
  assert.equal(controller.session.historyLength, steps + 1);
  controller.undo();
  assert.deepEqual(spans(controller.stored, main(controller.stored).id), [[0, 20], [20, 40]]);
  // With no selection the main-track clip under the playhead is the target; outside any clip there is none.
  assert.equal(freezeTarget(controller.stored, sceneId, [], 25 * S), second);
  assert.equal(freezeTarget(controller.stored, sceneId, [first], 25 * S), undefined);
});
test("toolbar actions run the engine's commands: split, delete left, duplicate, ripple delete, marker, range", () => {
  const { controller, first, second, act, sceneId } = open();
  controller.select(timeline.selectElements([first]));
  controller.seek(5 * S);
  act("timeline.split");
  assert.equal(main(controller.stored).elements.length, 3);
  act("edit.undo");
  controller.select(timeline.selectElements([first]));
  act("timeline.delete-left");
  assert.deepEqual(spans(controller.stored, main(controller.stored).id), [[0, 15], [15, 35]]);
  act("edit.undo");
  controller.select(timeline.selectElements([second]));
  act("timeline.ripple-delete");
  assert.deepEqual(spans(controller.stored, main(controller.stored).id), [[0, 20]]);
  act("edit.undo"); act("edit.redo"); act("edit.undo");
  assert.equal(main(controller.stored).elements.length, 2);
  act("marker.toggle");
  assert.equal(timeline.sceneById(controller.stored, sceneId).markers.length, 1);
  controller.seek(5 * S); act("range.set-in"); controller.seek(9 * S); act("range.set-out");
  assert.deepEqual([timeline.sceneById(controller.stored, sceneId).inPoint, timeline.sceneById(controller.stored, sceneId).outPoint], [5 * S, 9 * S]);
  act("range.clear");
  assert.equal(timeline.sceneById(controller.stored, sceneId).inPoint, undefined);
  assert.equal(act("no.such.action"), false);
});
test("copy, cut and paste go through the one clipboard; select all and Escape work on the selection", () => {
  const { controller, second, act } = open();
  controller.select(timeline.selectElements([second]));
  act("timeline.copy");
  controller.seek(50 * S);
  act("timeline.paste");
  assert.equal(timeline.elementsOfScene(timeline.sceneById(controller.stored, controller.session.sceneId)).length, 4);
  act("selection.all");
  assert.equal(controller.session.selection.selectedElements.length, 4);
  act("editor.cancel");
  assert.equal(controller.session.selection.selectedElements.length, 0);
});
test("the toggles change the device preferences; turning the magnet on closes gaps as one step", () => {
  const { controller, first, act, sceneId } = open();
  act("timeline.magnet.toggle");
  assert.equal(prefs.magnet, false);
  controller.run(timeline.move({ sceneId, elementIds: [first], time: 50 * S }));
  assert.ok(timeline.mainTrackHasGaps(controller.stored, sceneId));
  act("timeline.magnet.toggle");
  assert.equal(prefs.magnet, true);
  assert.equal(timeline.mainTrackHasGaps(controller.stored, sceneId), false);
  for (const [action, key] of [["timeline.snapping.toggle", "snapping"], ["timeline.linkage.toggle", "linkage"], ["timeline.ripple.toggle", "ripple"], ["timeline.preview-axis.toggle", "previewAxis"]] as const) { const before = prefs[key]; act(action); assert.equal(prefs[key], !before); }
});
test("zoom actions step by 1.7 around the playhead, and fit puts the scene on 95 % of the viewport", () => {
  const { controller, host } = open();
  controller.setView({ zoomLevel: 2 });
  zoomAction(host, "in");
  assert.equal(controller.session.view.zoomLevel, 2 * 1.7);
  zoomAction(host, "out");
  assert.equal(controller.session.view.zoomLevel, 2);
  zoomAction(host, "fit");
  assert.deepEqual([Math.round(controller.session.view.zoomLevel * 1000) / 1000, controller.session.view.scrollLeft], [0.317, 0]);
  zoomAction(host, { slider: 1 });
  assert.equal(controller.session.view.zoomLevel, timeline.ZOOM_MAX);
});
test("keys resolve to actions by physical key and platform modifier, and tooltips read the binding", () => {
  assert.equal(actionForKey({ key: "b", code: "KeyB", meta: true }, { mac: true }), "timeline.split");
  assert.equal(actionForKey({ key: "b", code: "KeyB", ctrl: true }, { mac: false }), "timeline.split");
  assert.equal(actionForKey({ key: "b", code: "KeyB", ctrl: true }, { mac: true }), undefined);
  assert.equal(actionForKey({ key: "Z", code: "KeyZ", meta: true, shift: true }, { mac: true }), "edit.redo");
  assert.equal(actionForKey({ key: " ", code: "Space" }, { mac: true }), "playback.toggle");
  assert.equal(actionForKey({ key: "Delete", code: "Delete", shift: true }, { mac: false }), "timeline.ripple-delete");
  assert.equal(comboOf({ key: "=", code: "Equal", ctrl: true }, false), "Mod+=");
  assert.deepEqual([bindingKeys("timeline.split", true), bindingKeys("timeline.split", false), bindingKeys("timeline.freeze", true)], [["⌘", "B"], ["Ctrl", "B"], null]);
});

// — Track sound —
test("track volume and pan are clamped, each change is one undo step, and a track without sound refuses", async () => {
  const { setTrackSound, trackSound, panLabel } = await import("../src/index.ts");
  const { controller, messages, sceneId } = open();
  const audio = timeline.sceneById(controller.stored, sceneId).tracks.audio[0];
  const steps = controller.session.historyLength;
  controller.run(setTrackSound({ trackId: audio.id, volume: 40 }));
  controller.run(setTrackSound({ trackId: audio.id, pan: -250 }));
  const after = timeline.sceneById(controller.stored, sceneId).tracks.audio[0];
  assert.deepEqual(trackSound(after), { volume: 12, pan: -100, muted: false, solo: false });
  assert.equal(controller.session.historyLength, steps + 2);
  controller.undo();
  assert.equal(trackSound(timeline.sceneById(controller.stored, sceneId).tracks.audio[0]).pan, 0);
  const text = controller.run(timeline.addTrack({ sceneId, type: "text", id: "t-text" }));
  assert.ok(text.ok);
  assert.equal(controller.run(setTrackSound({ trackId: "t-text", volume: -6 })).ok, false);
  assert.equal(messages[messages.length - 1], "This track has no sound");
  assert.deepEqual([panLabel(0), panLabel(-40), panLabel(100)], ["C", "L 40", "R 100"]);
});
test("solo is saved with the project and emits a patch, but adds no undo step", () => {
  const { controller, saved, sceneId, act } = open();
  const audio = timeline.sceneById(controller.stored, sceneId).tracks.audio[0];
  const steps = controller.session.historyLength, patches = saved.length;
  act("timeline.track.solo.toggle", { trackId: audio.id });
  assert.equal(timeline.sceneById(controller.stored, sceneId).tracks.audio[0].solo, true);
  assert.equal(controller.session.historyLength, steps);
  assert.equal(saved.length, patches + 1);
});
