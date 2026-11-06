import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalize, timeline as tl, validatorEffectRegistry, validatorTransitionRegistry, listTransitions, TRANSITION_PANEL_CATEGORIES, TRANSITION_DEFINITIONS, hash, stringSeed } from "../src/index.ts";
import { image, put, REGISTRIES, text, tweak, video } from "./support/fixtures.ts";
import { el, main, OFF, ON, open as openSession, project, RIPPLE, S, spans, trackOf, withTracks } from "./support/timeline.ts";

const CATALOGUE = { ...REGISTRIES, effects: validatorEffectRegistry(), transitions: validatorTransitionRegistry() };
const open = (doc: ReturnType<typeof project>) => openSession(doc, { registries: CATALOGUE });
const FPS = { numerator: 30, denominator: 1 };
/** A video clip with `handle` seconds of unused media on each side. */
const clip = (id: string, start: number, seconds: number, handle = 10, extra: Record<string, unknown> = {}) => video(id, start, seconds, { sourceDuration: (seconds + 2 * handle) * S, trimStart: handle * S, trimEnd: handle * S, ...extra });
const mainOf = (...clips: unknown[]) => put(project(), "t-main", ...clips);
const records = (doc: any, trackId = "t-main"): any[] => trackOf(doc, trackId).transitions;
const add = (session: ReturnType<typeof open>, fromId: string, toId: string, type = "cross-dissolve", seconds?: number) => session.execute(tl.applyTransition({ sceneId: "s1", fromId, toId, type, seconds }), OFF) as any;
const pair = () => open(mainOf(clip("A", 0, 5), clip("B", 5, 5)));

test("Transition data model: Both clips reference the transition; Record removed with its clip; Unknown transition type", () => {
  const session = pair();
  const result = add(session, "A", "B");
  assert.ok(result.ok, result.message);
  const [record] = records(session.document);
  assert.deepEqual({ ...record, id: "x" }, { id: "x", kind: "transition", fromElementId: "A", toElementId: "B", duration: 60_000, type: "cross-dissolve", params: {}, easing: "ease-in-out", audioCrossfade: true, shape: "equal-power" });
  assert.deepEqual([el(session.document, "A").transitionOut, el(session.document, "B").transitionIn], [record.id, record.id]);
  session.execute(tl.deleteElements({ sceneId: "s1", elementIds: ["B"] }), OFF);
  assert.deepEqual([records(session.document), el(session.document, "A").transitionOut], [[], null]);
  session.undo();
  assert.equal(records(session.document).length, 1, "one undo restores the clip and its transition");
  // A type that is not registered is kept as it is and named "Unavailable transition" with Replace and Remove.
  const unknown = { ...record, type: "vendor-wipe", params: { amount: 3 } };
  assert.deepEqual(tl.transitionInspectorState(unknown), { name: "Unavailable transition", available: false, actions: ["Replace", "Remove"] });
  assert.equal(tl.transitionInspectorState(record).name, "Cross Dissolve");
  assert.deepEqual(tl.coerceTransitionParams("vendor-wipe", { amount: 3 }), { amount: 3 });
});

test("Eligible cuts: Gap prevents a transition; Image-to-video cut is eligible; Freeze element is eligible", () => {
  const frame = 4000;
  const gapped = open(put(withTracks(project(), ["t-v", "video"]), "t-v", clip("A", 0, 2), clip("B", 2 + frame / S, 2)));
  assert.deepEqual(tl.eligibleCuts(gapped.document.scenes[0] as never), []);
  const refused = gapped.execute(tl.applyTransition({ sceneId: "s1", fromId: "A", toId: "B", type: "push" }), OFF) as any;
  assert.deepEqual([refused.ok, refused.message, records(gapped.document, "t-v")], [false, "Place two clips next to each other to add a transition", []]);
  assert.deepEqual(tl.transitionDropZones(gapped.document.scenes[0] as never, 100, (time) => time / 1000), []);
  const mixed = mainOf(image("I", 0, 2), clip("V", 2, 2), video("F", 4, 3, { sourceDuration: undefined, freeze: { mediaId: "a1", sourceTime: 0 } }), clip("R", 7, 2), text("T", 9, 2));
  const cuts = tl.eligibleCuts(mixed.scenes[0] as never).map((cut) => `${cut.fromId}>${cut.toId}`);
  assert.deepEqual(cuts, ["I>V", "V>F", "F>R"], "image, video and freeze cuts are eligible; a text element is not");
  // Overlay video tracks are eligible like the main track; audio is not.
  assert.equal(tl.isEligibleCut({ type: "audio" } as never, { type: "video", startTime: 0, duration: 1 } as never, { type: "video", startTime: 1, duration: 1 } as never), false);
});

test("Centred overlap using source handles: Timeline duration is unchanged; Full handles available; No handle on the incoming clip; Odd frame count", () => {
  const session = pair();
  const before = [spans(session.document, "t-main"), session.document.metadata.duration];
  add(session, "A", "B", "cross-dissolve", 1);
  assert.deepEqual([spans(session.document, "t-main"), session.document.metadata.duration], before);
  const track = main(session.document), [record] = records(session.document);
  assert.deepEqual(tl.heldFrames(track, record, FPS), { outgoing: 0, incoming: 0, warning: false });
  // The incoming clip starts on the first frame of its source: its half of the window (0.5 s) is a held frame.
  const tight = main(mainOf(clip("A", 0, 5), clip("B", 5, 5, 10, { trimStart: 0 })));
  const held = tl.heldFrames(tight, { fromElementId: "A", toElementId: "B", duration: S }, FPS);
  assert.deepEqual([held.outgoing, held.incoming, held.warning], [0, 0.5 * S, true]);
  assert.equal(held.message, "Not enough extra footage: 0.0s of the outgoing clip and 0.5s of the incoming clip are held frames.");
  // 5 frames on a cut at frame 100 cover frames 98 … 102.
  const window = tl.transitionWindow(100 * 4000, 5 * 4000, FPS);
  assert.deepEqual([window.start / 4000, window.end / 4000 - 1], [98, 102]);
});

test("Transition duration limits: Clamp by short clip; Two transitions on one clip; Minimum; Maximum; Tool call beyond the cut's limit; Agent request above the limit", () => {
  const short = open(mainOf(clip("A", 0, 5), clip("B", 5, 0.6)));
  const result = add(short, "A", "B", "cross-dissolve", 3);
  assert.deepEqual([records(short.document)[0].duration, result.info.clamped, result.info.message], [1.2 * S, true, "Limited to 1.2s by clip length"]);
  // A 2 s clip with a 2.0 s in-transition (1.0 s inside it) takes an out-transition of 0.5 s; 3.0 s clamps to 2.0 s.
  const two = open(mainOf(clip("A", 0, 5), clip("B", 5, 2), clip("C", 7, 5)));
  add(two, "A", "B", "slide", 2);
  const out = add(two, "B", "C");
  assert.deepEqual(records(two.document).map((record) => record.duration / S), [2, 0.5]);
  const raised = two.execute(tl.editTransition(out.info.transitionId, { seconds: 3 }), OFF) as any;
  assert.deepEqual([raised.info.seconds, raised.info.message], [2, "Limited to 2.0s by clip length"]);
  const long = open(mainOf(clip("A", 0, 60, 30), clip("B", 60, 60, 30)));
  const id = add(long, "A", "B").info.transitionId;
  long.execute(tl.editTransition(id, { seconds: 0 }), OFF);
  assert.equal(records(long.document)[0].duration, 3 * 4000, "0 is stored as 0.1 s (3 frames)");
  long.execute(tl.editTransition(id, { seconds: 9 }), OFF);
  assert.equal(records(long.document)[0].duration, 5 * S);
  assert.equal(tl.durationToTicks(0.1, { numerator: 12, denominator: 1 }), 2 * 10_000, "never fewer than 2 frames");
  // The agent path refuses instead of clamping, with the limits of that cut, and stores nothing.
  const tool = open(mainOf(clip("A", 0, 5), clip("B", 5, 0.6)));
  const toolId = add(tool, "A", "B", "cross-dissolve", 0.5).info.transitionId;
  const strict = tool.execute(tl.editTransition(toolId, { seconds: 3 }, { strict: true }), OFF) as any;
  assert.deepEqual([strict.ok, strict.code, strict.details, records(tool.document)[0].duration], [false, "OUT_OF_RANGE", { field: "duration", min: 0.1, max: 1.2, value: 3 }, 0.5 * S]);
  assert.deepEqual(tl.checkToolDuration(3, tl.durationLimits(main(tool.document), "A", "B", FPS, toolId)), { ok: false, code: "OUT_OF_RANGE", details: { field: "duration", min: 0.1, max: 1.2, value: 3 } });
});

test("Bundled transition library: Library is complete offline; Search transitions: Search by keyword; No results", () => {
  assert.deepEqual([...TRANSITION_PANEL_CATEGORIES], ["Featured", "Favourites", "Recent", "My presets", "Basic", "Camera", "Overlay", "Light Effect", "Split", "Distortion", "Glitch", "Blur", "Social Media", "Slide", "MG", "Mask"]);
  const tiles = TRANSITION_PANEL_CATEGORIES.slice(4).flatMap((category) => listTransitions({ category }));
  assert.deepEqual([new Set(tiles.map((tile) => tile.type)).size, tiles.length, listTransitions({ category: "Featured" }).length], [55, 55, 10]);
  // Name, English name and keywords, case- and diacritic-insensitive, across all categories.
  const wipe = listTransitions({ query: "WIPE" }).map((definition) => definition.name);
  assert.ok(wipe.includes("Linear Wipe") && wipe.includes("Clock Wipe") && wipe.includes("Barn Door"), wipe.join());
  assert.deepEqual(listTransitions({ query: "fundido", localise: (definition) => (definition.type === "cross-dissolve" ? "Fundido cruzado" : definition.name) }).map((definition) => definition.type), ["cross-dissolve"]);
  assert.deepEqual(listTransitions({ query: "qqq" }), []);
  for (const definition of TRANSITION_DEFINITIONS) assert.ok(definition.params.every((param) => param.keyframable === false), "transition params are not keyframable");
});

test("Apply a transition on desktop and web: Drag onto a cut; No eligible cut; Default transition on a selection; Transition inspector: Set as default; Replace a transition: Replace keeps duration", () => {
  const session = open(mainOf(clip("A", 0, 5), clip("B", 5, 5), clip("C", 10, 5)));
  const zones = tl.transitionDropZones(session.document.scenes[0] as never, 510, (time) => time / 1200);
  assert.deepEqual(zones.map((zone) => [zone.cut.fromId, zone.x, zone.width]), [["A", 492, 16]], "the cut within 24 px of the pointer, 16 px wide");
  const dropped = add(session, zones[0].cut.fromId, zones[0].cut.toId, "push");
  assert.deepEqual([records(session.document)[0].type, records(session.document)[0].duration, records(session.document)[0].params], ["push", 0.5 * S, { direction: "left" }]);
  // A second tile on the same cut replaces: type and default params change, the rest stays.
  session.execute(tl.editTransition(dropped.info.transitionId, { seconds: 1.2, easing: "linear" }), OFF);
  session.execute(tl.replaceTransition(dropped.info.transitionId, "spin"), OFF);
  const replaced = records(session.document)[0];
  assert.deepEqual([replaced.id, replaced.type, replaced.duration, replaced.easing, replaced.params], [dropped.info.transitionId, "spin", 1.2 * S, "linear", { turns: 1, direction: "clockwise", blur: 50 }]);
  const single = open(mainOf(clip("A", 0, 5)));
  const none = single.execute(tl.applyTransitionAtPlayhead(single.document, { sceneId: "s1", playhead: 0, type: "push" }), OFF) as any;
  assert.deepEqual([none.ok, none.message, single.historyLength], [false, "Place two clips next to each other to add a transition", 0]);
  // Three adjacent selected clips: two Cross Dissolves, one undo step.
  const three = open(mainOf(clip("A", 0, 5), clip("B", 5, 5), clip("C", 10, 5)));
  three.execute(tl.addDefaultTransitions({ sceneId: "s1", elementIds: ["A", "B", "C"], playhead: 0 }), OFF);
  assert.deepEqual([records(three.document).map((record) => record.type), three.historyLength], [["cross-dissolve", "cross-dissolve"], 1]);
  three.undo();
  assert.deepEqual(records(three.document), []);
  // "Set as default" on a 0.8 s Whip Pan: the next default transition is one.
  const defaults = tl.defaultsFrom({ type: "whip-pan", duration: 0.8 * S });
  three.execute(tl.addDefaultTransitions({ sceneId: "s1", elementIds: [], playhead: 5.2 * S, defaults }), OFF);
  assert.deepEqual(records(three.document).map((record) => [record.fromElementId, record.type, record.duration]), [["A", "whip-pan", 0.8 * S]]);
});

test("Apply a transition on mobile: Add from the junction button; None removes; Discard; Timeline affordance: Resize by edge drag; Delete key; Transition inspector: Edit a param", () => {
  const session = pair();
  // The sheet previews through a batch that ✓ commits as one step; ✕ commits nothing.
  const commit = session.execute(tl.batch("Transition", [tl.applyTransition({ sceneId: "s1", fromId: "A", toId: "B", type: "zoom-in", id: "tr1" }), tl.editTransition("tr1", { seconds: 2 })]), OFF) as any;
  assert.deepEqual([commit.ok, records(session.document).map((record) => [record.type, record.duration]), session.historyLength], [true, [["zoom-in", 2 * S]], 1]);
  session.undo();
  assert.deepEqual([records(session.document), session.historyLength], [[], 0], "✕ after a preview leaves the cut as it was");
  session.redo();
  assert.equal(records(session.document)[0].id, "tr1");
  // Dragging the right edge of a 0.5 s transition out by 0.25 s moves both edges: 1.0 s, one step.
  session.execute(tl.editTransition("tr1", { seconds: 0.5 }), OFF);
  const steps = session.historyLength;
  const resized = session.execute(tl.resizeTransition("tr1", 0.25 * S), OFF) as any;
  assert.deepEqual([records(session.document)[0].duration, resized.info.tooltip, session.historyLength - steps], [S, "1.0s", 1]);
  session.execute(tl.replaceTransition("tr1", "linear-wipe"), OFF);
  session.execute(tl.editTransition("tr1", { params: { angle: 90 } }), OFF);
  assert.deepEqual(records(session.document)[0].params, { angle: 90, softness: 10 });
  session.undo();
  assert.equal(records(session.document)[0].params.angle, 0);
  const bad = session.execute(tl.editTransition("tr1", { params: { angle: "steep" } }), OFF) as any;
  assert.deepEqual([bad.ok, bad.code], [false, "param-rejected"]);
  // Delete (and the "None" tile) removes the transition; neither clip changes.
  const before = spans(session.document, "t-main");
  session.execute(tl.removeTransition("tr1"), OFF);
  assert.deepEqual([records(session.document), spans(session.document, "t-main"), el(session.document, "A").transitionOut, el(session.document, "B").transitionIn], [[], before, null, null]);
});

test("Remove a transition: Remove all; Apply to all cuts: Apply to all on the main track; Short clip clamps one copy", () => {
  const clips = [0, 1, 2, 3, 4, 5].map((index) => clip(`c${index}`, index * 4, 4));
  const session = open(mainOf(...clips));
  const id = add(session, "c0", "c1", "slide").info.transitionId;
  session.execute(tl.editTransition(id, { params: { direction: "up" } }), OFF);
  const all = session.execute(tl.applyTransitionToAll(id), OFF) as any;
  assert.deepEqual(all.info, { applied: 5, shortened: 0, message: "Applied to 5 cuts" });
  assert.deepEqual(records(session.document).map((record) => [record.type, record.duration, record.params.direction]), Array(5).fill(["slide", 0.5 * S, "up"]));
  assert.equal(tl.countTransitions(session.document, "s1"), 5);
  const steps = session.historyLength;
  session.execute(tl.removeAllTransitions("s1"), OFF);
  assert.deepEqual([records(session.document), session.historyLength - steps], [[], 1]);
  session.undo();
  assert.equal(records(session.document).length, 5, "a single undo restores them all");
  // One clip lasts 0.4 s: the transitions on its two cuts share it.
  const tight = open(mainOf(clip("a", 0, 4), clip("b", 4, 0.4), clip("c", 4.4, 4), clip("d", 8.4, 4)));
  const first = add(tight, "c", "d", "slide").info.transitionId;
  const fitted = tight.execute(tl.applyTransitionToAll(first), OFF) as any;
  const windows = records(tight.document).filter((record) => record.fromElementId === "b" || record.toElementId === "b").map((record) => tl.transitionWindow(0, record.duration, FPS));
  const inside = records(tight.document).reduce((sum, record) => sum + (record.toElementId === "b" ? tl.transitionWindow(0, record.duration, FPS).after : record.fromElementId === "b" ? tl.transitionWindow(0, record.duration, FPS).before : 0), 0);
  assert.ok(windows.length >= 1 && inside <= 0.4 * S, `inside halves total ${inside / S} s`);
  assert.ok(fitted.info.shortened >= 1 && /^Applied to \d cuts \(\d shortened to fit\)$/.test(fitted.info.message), fitted.info.message);
  // A locked track is skipped.
  const locked = open(tweak(mainOf(clip("a", 0, 4), clip("b", 4, 4), clip("c", 8, 4)), (draft) => { draft.scenes[0].tracks.main.transitions = [{ id: "t", kind: "transition", fromElementId: "a", toElementId: "b", duration: 60000, type: "slide", params: { direction: "left" }, easing: "linear", audioCrossfade: true, shape: "equal-power" }]; draft.scenes[0].tracks.main.elements[0].transitionOut = "t"; draft.scenes[0].tracks.main.elements[1].transitionIn = "t"; draft.scenes[0].tracks.main.locked = true; }));
  assert.equal((locked.execute(tl.applyTransitionToAll("t"), OFF) as any).info.applied, 0);
});

test("Audio crossfade pairing: Switch off; Extracted audio; the pairing is two fields of the record", () => {
  const session = pair();
  const id = add(session, "A", "B").info.transitionId;
  const scene = () => session.document.scenes[0] as never;
  assert.deepEqual(tl.audioCrossfadeState(scene(), records(session.document)[0]), { available: true, active: true });
  session.execute(tl.editTransition(id, { audioCrossfade: false, shape: "linear" }), OFF);
  assert.deepEqual([records(session.document)[0].audioCrossfade, records(session.document)[0].shape, tl.audioCrossfadeState(scene(), records(session.document)[0]).active], [false, "linear", false]);
  // A clip whose audio was extracted to a linked audio element: the switch is disabled with the stated tooltip.
  const linked = tweak(session.document, (draft) => { draft.scenes[0].tracks.main.elements[0].linkId = "L"; draft.scenes[0].tracks.audio.push({ id: "t-a", name: "Audio", type: "audio", locked: false, pinned: false, muted: false, solo: false, hidden: false, elements: [{ id: "x", type: "audio", linkId: "L", startTime: 0, duration: 5 * S }], transitions: [] }); });
  assert.deepEqual(tl.audioCrossfadeState(linked.scenes[0] as never, records(linked)[0]), { available: false, active: false, tooltip: "Audio was extracted. Add a crossfade on the audio track." });
});

test("Interaction with trim: Ripple trim keeps the transition; Trim opens a gap; Interaction with split, move, delete and ripple: Move breaks adjacency; Copy a pair; Delete with ripple; a split inside the range shortens", () => {
  const rippled = pair();
  const id = add(rippled, "A", "B").info.transitionId;
  rippled.execute(tl.trim({ sceneId: "s1", elementId: "A", side: "end", delta: -S }), RIPPLE);
  assert.deepEqual([spans(rippled.document, "t-main"), records(rippled.document).map((record) => [record.id, record.duration])], [[[0, 4], [4, 9]], [[id, 0.5 * S]]]);
  rippled.undo();
  assert.deepEqual(spans(rippled.document, "t-main"), [[0, 5], [5, 10]]);
  const gapped = pair();
  add(gapped, "A", "B");
  gapped.execute(tl.trim({ sceneId: "s1", elementId: "A", side: "end", delta: -S }), OFF);
  assert.deepEqual([records(gapped.document), el(gapped.document, "B").transitionIn], [[], null]);
  gapped.undo();
  assert.deepEqual([records(gapped.document).length, spans(gapped.document, "t-main")], [1, [[0, 5], [5, 10]]], "undo restores the trim and the transition");
  // Moving B to another track removes the transition; undo restores both.
  const moved = open(withTracks(mainOf(clip("A", 0, 5), clip("B", 5, 5)), ["t-v", "video", { pinned: true }]));
  add(moved, "A", "B");
  const went = moved.execute(tl.move({ sceneId: "s1", elementIds: ["B"], anchorId: "B", time: 5 * S, target: { kind: "track", trackId: "t-v" } } as never), OFF) as any;
  assert.ok(went.ok, went.message);
  assert.deepEqual(records(moved.document), []);
  moved.undo();
  assert.equal(records(moved.document).length, 1);
  // Copy and paste of the pair: the copies carry a transition of the same type, params and duration, under a new id.
  const copied = open(withTracks(mainOf(clip("A", 0, 5), clip("B", 5, 5)), ["t-v", "video", { pinned: true }]));
  const source = add(copied, "A", "B", "linear-wipe", 0.8).info.transitionId;
  const entry = tl.copyElements(copied.document, "s1", ["A", "B"])!;
  const pasted = copied.execute(tl.paste({ sceneId: "s1", entry, time: 20 * S, targetTrackId: "t-v" } as never), OFF) as any;
  const every = copied.document.scenes[0].tracks.overlay.concat([copied.document.scenes[0].tracks.main] as never).flatMap((track: any) => track.transitions);
  const twin = every.find((record: any) => record.id !== source);
  assert.ok(pasted.ok && twin, "the pasted pair has its own transition");
  assert.deepEqual([twin.type, twin.duration, twin.params, new Set(pasted.info.elementIds).has(twin.fromElementId)], ["linear-wipe", 0.8 * S, { angle: 0, softness: 10 }, true]);
  // Deleting B between A and C with ripple: both transitions go and the new A–C cut has none.
  const three = open(mainOf(clip("A", 0, 5), clip("B", 5, 5), clip("C", 10, 5)));
  add(three, "A", "B"); add(three, "B", "C");
  three.execute(tl.deleteElements({ sceneId: "s1", elementIds: ["B"], ripple: true }), RIPPLE);
  assert.deepEqual([spans(three.document, "t-main"), records(three.document)], [[[0, 5], [5, 10]], []]);
  // A split creates no transition; the left part keeps transitionIn, the right part transitionOut; a split inside the range shortens.
  const split = open(mainOf(clip("A", 0, 5), clip("B", 5, 5), clip("C", 10, 5)));
  add(split, "A", "B", "cross-dissolve", 2); add(split, "B", "C");
  split.execute(tl.split({ sceneId: "s1", time: 5.5 * S, elementIds: ["B"] }), OFF);
  const parts = main(split.document).elements.filter((element: any) => element.startTime >= 5 * S && element.startTime < 10 * S);
  assert.deepEqual([parts.length, parts[0].transitionIn !== null, parts[0].transitionOut, parts[1].transitionIn, parts[1].transitionOut !== null], [2, true, null, null, true]);
  assert.deepEqual(records(split.document).map((record) => record.duration / S), [1, 0.5], "the 2.0 s transition is shortened to what the 0.5 s part holds");
});

test("Interaction with speed, reverse and freeze: Speed change shortens a transition; Reversed outgoing clip; Freeze element has unlimited handles", () => {
  const session = pair();
  add(session, "A", "B", "cross-dissolve", 2);
  // B is sped up so that it lasts 0.8 s: in the same step the transition is clamped to 1.6 s.
  const speed: tl.TimelineCommand = { type: "retime.set", label: "Speed", run(draft) { const b = (draft.scenes[0].tracks.main.elements as any[]).find((element) => element.id === "B"); b.duration = 0.8 * S; b.retime = { rate: 6.25 }; } };
  const steps = session.historyLength;
  session.execute(speed, OFF);
  assert.deepEqual([records(session.document)[0].duration, session.historyLength - steps], [1.6 * S, 1]);
  session.undo();
  assert.deepEqual([records(session.document)[0].duration, el(session.document, "B").duration], [2 * S, 5 * S]);
  // A clip at 2× needs twice the media for its half of the window.
  const fast = main(mainOf(clip("A", 0, 5, 0.6, { retime: { rate: 2 }, sourceDuration: 11.2 * S }), clip("B", 5, 5)));
  assert.equal(tl.heldFrames(fast, { fromElementId: "A", toElementId: "B", duration: S }, FPS).outgoing, 0.2 * S + 0, "0.6 s of source is 0.3 s at 2×; 0.2 s of the 0.5 s is held");
  // Reversed, showing source 2 s … 6 s: the outgoing handle is the media before the in-point (2 s here, none at 0 s).
  const reversed = (trimStart: number) => main(mainOf(video("A", 0, 4, { sourceDuration: 20 * S, trimStart: trimStart * S, trimEnd: (16 - trimStart) * S, retime: { reverse: true } }), clip("B", 4, 5)));
  assert.deepEqual([tl.heldFrames(reversed(2), { fromElementId: "A", toElementId: "B", duration: S }, FPS).warning, tl.heldFrames(reversed(0), { fromElementId: "A", toElementId: "B", duration: S }, FPS).outgoing], [false, 0.5 * S]);
  const frozen = main(mainOf(clip("A", 0, 5), video("F", 5, 3, { sourceDuration: undefined, freeze: { mediaId: "a1", sourceTime: 0 } })));
  assert.deepEqual(tl.heldFrames(frozen, { fromElementId: "A", toElementId: "F", duration: S }, FPS), { outgoing: 0, incoming: 0, warning: false });
});

test("Transition persistence and agent access: Reload; Redo keeps identity; Transition presets: Save and apply; Limit; Favourites and recents: Recent list is capped", () => {
  const session = open(mainOf(clip("A", 0, 5), clip("B", 5, 5), clip("C", 10, 5), clip("D", 15, 5)));
  const first = add(session, "A", "B", "linear-wipe", 0.8).info.transitionId;
  add(session, "B", "C", "spin"); add(session, "C", "D", "flash");
  const reopened = openSession(JSON.parse(canonicalize(session.document)), { registries: CATALOGUE });
  assert.deepEqual(records(reopened.document), records(session.document));
  session.undo(); session.undo(); session.undo();
  session.redo();
  assert.equal(records(session.document)[0].id, first, "redo restores the same id");
  // "Soft drop": a 0.8 s Linear Wipe with angle 90 and softness 40, applied to another cut as one step.
  session.execute(tl.editTransition(first, { params: { angle: 90, softness: 40 } }), OFF);
  const saved = tl.saveTransitionPreset([], "Soft drop", records(session.document)[0]) as any;
  assert.deepEqual(saved.preset, { name: "Soft drop", type: "linear-wipe", params: { angle: 90, softness: 40 }, easing: "ease-in-out", duration: 0.8 * S, audioCrossfade: true, shape: "equal-power" });
  const steps = session.historyLength;
  session.execute(tl.applyTransitionPreset({ sceneId: "s1", fromId: "C", toId: "D", preset: saved.preset }), OFF);
  const applied = records(session.document).find((record) => record.fromElementId === "C");
  assert.deepEqual([applied.type, applied.duration, applied.params, session.historyLength - steps], ["linear-wipe", 0.8 * S, { angle: 90, softness: 40 }, 1]);
  assert.equal((tl.saveTransitionPreset(saved.presets, "Soft drop", applied) as any).preset.name, "Soft drop (2)");
  const full = Array.from({ length: 200 }, (_, index) => ({ ...saved.preset, name: `p${index}` }));
  assert.deepEqual(tl.saveTransitionPreset(full, "one more", applied), { ok: false, message: "Preset limit reached (200)" });
  assert.deepEqual(tl.transitionPresetState({ ...saved.preset, type: "gone" }), { available: false, label: "Unavailable transition" });
  let library = tl.emptyLibraryState();
  for (let index = 0; index < 21; index++) library = tl.pushRecent(library, "transition", TRANSITION_DEFINITIONS[index].type);
  assert.deepEqual([library.recents.transition.length, library.recents.transition[0], library.recents.transition.includes(TRANSITION_DEFINITIONS[0].type)], [20, TRANSITION_DEFINITIONS[20].type, false]);
});

test("Deterministic hash: Known vector; a string seed is FNV-1a", () => {
  assert.deepEqual([hash(0, 0), hash(123456789, 42)], [817759070, 1212366416]);
  assert.equal(hash(7, 3, 9), hash(7, 3, 9));
  assert.deepEqual([stringSeed(""), stringSeed("a")], [2166136261, 3826002220]);
});
void ON;
