import assert from "node:assert/strict";
import { test } from "node:test";
import { clipTimeAt, retimeClipOf, retimedDuration, setKeyframe, snapToFrame, sourceTimeAt, timeline as tl } from "../src/index.ts";
import { audio, context, ids, image, put, video } from "./support/fixtures.ts";
import { el, OFF, ON, open, project, RIPPLE, S, spans, withTracks } from "./support/timeline.ts";

const CTX = context({ newId: ids("k") });
const FRAME = 4000;
/** A clip showing `seconds` of a 60 s source from `trimStart`. */
const clip = (id = "v", start = 0, seconds = 10, extra: Record<string, unknown> = {}) => video(id, start, seconds, { sourceDuration: 60 * S, trimEnd: (60 - seconds) * S, ...extra });
const one = (extra: Record<string, unknown> = {}) => open(put(project(), "t-main", clip("v", 0, 10, extra)));
const speed = (session: ReturnType<typeof open>, change: tl.SpeedChange, ids_ = ["v"], edit = OFF) => session.execute(tl.setSpeed({ sceneId: "s1", elementIds: ids_, change }), edit) as any;
const frames = (ticks: number) => ticks / FRAME;

test("Retime data model: Constant rate mapping; Neutral retime is removed; Compound element; Duration linked to speed: Rate changes duration; Duration sets rate; Requested duration out of range; No room without ripple", () => {
  const session = open(put(project(), "t-main", clip("v", 0, 10, { trimStart: 2 * S, trimEnd: 48 * S })));
  assert.ok(speed(session, { rate: 2 }).ok);
  const v = el(session.document, "v");
  assert.deepEqual([v.duration, v.startTime, v.retime.rate, v.retime.maintainPitch], [5 * S, 0, 2, true]);
  assert.equal(sourceTimeAt(retimeClipOf(v), S), 4 * S);
  speed(session, { rate: 1, maintainPitch: false });
  assert.deepEqual([el(session.document, "v").retime, el(session.document, "v").duration], [undefined, 10 * S]);
  // 10 s of source asked to last 4 s: 2.5×. Asked to last 0.01 s: 100×, which lasts 0.1 s.
  speed(session, { duration: 4 * S });
  assert.deepEqual([el(session.document, "v").retime.rate, el(session.document, "v").duration], [2.5, 4 * S]);
  speed(session, { duration: 0.01 * S });
  assert.deepEqual([el(session.document, "v").retime.rate, el(session.document, "v").duration], [100, 0.1 * S]);
  assert.deepEqual(tl.rateForDuration(10 * S, 0.01 * S, { numerator: 30, denominator: 1 }), { rate: 100, duration: 0.1 * S });
  // Ripple off and a clip right behind: slowing down is refused and nothing changes.
  const tight = open(put(withTracks(project(), ["t-v2", "video"]), "t-v2", clip("v", 0, 10), clip("w", 10, 5)));
  const refusal = speed(tight, { rate: 0.5 });
  assert.deepEqual([refusal.ok, refusal.message, el(tight.document, "v").duration], [false, tl.NO_ROOM_MESSAGE, 10 * S]);
  assert.ok(speed(tight, { rate: 0.5 }, ["v"], RIPPLE).ok);
  assert.deepEqual(spans(tight.document, "t-v2"), [[0, 20], [20, 25]]);
  assert.equal(speed(one({ trimEnd: 0, duration: 60 * S } as never), { rate: 0.1 }).ok, true);
});

test("Constant speed range: Upper bound; Lower bound; Migrated slow clip; Speed badges on clips: Constant speed badge; Curve badge; Normal speed", () => {
  const session = one();
  speed(session, { rate: 250 });
  assert.equal(el(session.document, "v").retime.rate, 100);
  speed(session, { rate: 0.03 }, ["v"], RIPPLE);
  assert.equal(el(session.document, "v").retime.rate, 0.1);
  assert.deepEqual([tl.clampRate(250), tl.clampRate(0.03), tl.clampRate(1.234)], [100, 0.1, 1.23]);
  // A migrated 0.05× is kept and shown as stored.
  const slow = el(put(project(), "t-main", clip("v", 0, 10, { retime: { rate: 0.05 } })), "v");
  assert.deepEqual([tl.effectiveRate(slow), tl.speedBadge(slow)], [0.05, "0.05x"]);
  assert.deepEqual([tl.speedBadge(clip("a", 0, 10, { retime: { rate: 5 } }) as never), tl.speedBadge(clip("b", 0, 10, { retime: { rate: 0.25 } }) as never), tl.speedBadge(clip("c") as never)], ["5.0x", "0.25x", null]);
  const hero = one();
  speed(hero, { curve: { preset: "hero" } });
  assert.equal(tl.speedBadge(el(hero.document, "v")), "Hero");
  // The logarithmic slider: stops at 0.1, 1, 2, 5, 10, 100; within 4 px it lands on a stop.
  assert.deepEqual([tl.rateToSlider(0.1), Math.round(tl.rateToSlider(1) * 1e6) / 1e6, tl.rateToSlider(100)], [0, 0.333333, 1]);
  assert.equal(tl.snapSlider(tl.rateToSlider(2) + 3 / 300, 300), 2);
  assert.notEqual(tl.snapSlider(tl.rateToSlider(2) + 3 / 300, 300, true), 2);
});

test("Speed curve presets: Apply Hero; Preset durations; Editing a preset makes it custom; None; Speed curve model: Flat curve equals constant speed; Duration from the integral; Too many points", () => {
  const expected: Record<string, number> = { montage: 328, hero: 239, bullet: 146, "jump-cut": 354, "flash-in": 167, "flash-out": 167 };
  for (const [preset, count] of Object.entries(expected)) {
    const session = one();
    assert.ok(speed(session, { curve: { preset } }, ["v"], RIPPLE).ok, preset);
    const v = el(session.document, "v");
    assert.ok(Math.abs(frames(v.duration) - count) <= 1, `${preset}: ${frames(v.duration)} frames`);
    assert.deepEqual([v.retime.curve.preset, v.retime.curve.points.length, v.startTime], [preset, tl.SPEED_CURVE_PRESETS[preset].points.length, 0]);
  }
  const session = one();
  speed(session, { curve: { preset: "hero" } });
  const points = el(session.document, "v").retime.curve.points;
  speed(session, { curve: { preset: "custom", points: tl.moveCurvePoint(points, 2, { rate: 2 }) } });
  const custom = el(session.document, "v").retime.curve;
  assert.deepEqual([custom.preset, custom.points[2].rate, custom.points.filter((_: unknown, at: number) => at !== 2)], ["custom", 2, points.filter((_: unknown, at: number) => at !== 2)]);
  speed(session, { curve: null }, ["v"], RIPPLE);
  assert.deepEqual([el(session.document, "v").retime, el(session.document, "v").duration], [undefined, 10 * S]);
  const flat = one();
  speed(flat, { curve: { points: [{ u: 0, rate: 2 }, { u: 1, rate: 2 }] } });
  // The 1 025-node table of the time map rounds each node: a flat curve agrees with the constant rate to the tick.
  assert.equal(el(flat.document, "v").duration, 5 * S);
  assert.ok(Math.abs(sourceTimeAt(retimeClipOf(el(flat.document, "v")), 2 * S) - 4 * S) <= 1);
  const hill = one();
  speed(hill, { curve: { points: [{ u: 0, rate: 1 }, { u: 0.5, rate: 4 }, { u: 1, rate: 1 }] } });
  assert.ok(Math.abs(frames(el(hill.document, "v").duration) - 128) <= 1);
  const many = speed(hill, { curve: { points: Array.from({ length: 33 }, (_, index) => ({ u: index / 32, rate: 1 })) } });
  assert.equal(many.ok, false);
  assert.equal(el(hill.document, "v").retime.curve.points.length, 3);
});

test("Speed curve model: Invalid stored curve; Custom speed curve editor: Drag a point up; Add at the playhead; Cannot delete an end point; Rate limit per point", () => {
  const broken = el(put(project(), "t-main", clip("v", 0, 10, { retime: { rate: 2, curve: { preset: "custom", points: [{ u: 0, rate: 1 }, { u: 0.6, rate: 2 }, { u: 0.4, rate: 1 }, { u: 1, rate: 1 }] } } })), "v");
  assert.deepEqual([tl.hasInvalidCurve(broken), tl.speedCurveOf(broken), tl.effectiveRate(broken)], [true, null, 2]);
  const points = tl.CUSTOM_CURVE_POINTS;
  const raised = tl.moveCurvePoint(points, 2, { rate: 3 });
  assert.equal(raised[2].rate, 3);
  const fps = { numerator: 30, denominator: 1 };
  assert.ok(retimedDuration(10 * S, { curve: raised }, fps) < retimedDuration(10 * S, { curve: points }, fps));
  // "+" at 40 % of the span: a point with the curve's rate there, the shape unchanged.
  const hero = tl.SPEED_CURVE_PRESETS.hero.points, added = tl.addCurvePoint(hero, 0.5)!;
  assert.deepEqual([added.length, added[3].u, added[3].rate], [7, 0.5, 0.5]);
  assert.ok(Math.abs(retimedDuration(10 * S, { curve: added }, fps) - retimedDuration(10 * S, { curve: hero }, fps)) <= FRAME);
  assert.equal(tl.addCurvePoint(hero, 0.41), null);
  assert.deepEqual([tl.removeCurvePoint(hero, 0), tl.removeCurvePoint(hero, 5), tl.removeCurvePoint(hero, 2)!.length, tl.removeCurvePoint([hero[0], hero[5]], 1)], [null, null, 5, null]);
  assert.deepEqual([tl.moveCurvePoint(hero, 1, { rate: 40 })[1].rate, tl.moveCurvePoint(hero, 1, { rate: 1.04 })[1].rate, tl.moveCurvePoint(hero, 1, { rate: 1.04 }, true)[1].rate], [10, 1, 1.04]);
  // Interior points move between their neighbours with the minimum gap; end points stay at their `u`.
  assert.deepEqual([tl.moveCurvePoint(hero, 1, { u: 0.9 })[1].u, tl.moveCurvePoint(hero, 0, { u: 0.5, rate: 2 })[0]], [0.38, { u: 0, rate: 2 }]);
});

test("Reverse: First frame after reversing; Reverse twice; Reversing a clip with an asymmetric curve; Effect of retime on keyframes and animations: Constant speed-up; Reverse at constant rate; Reverse with a speed curve; Segment easing follows the reversal; Clip animation keeps its length", () => {
  const session = open(put(project(), "t-main", clip("v", 0, 4, { trimStart: 2 * S, trimEnd: 54 * S })));
  speed(session, { reverse: true });
  let v = el(session.document, "v");
  assert.deepEqual([v.retime.reverse, v.duration, v.startTime], [true, 4 * S, 0]);
  // The frame at clip time 0 is the source frame that starts at 6 s minus one frame; the last one starts at 2 s.
  const clipOf = retimeClipOf(v);
  assert.deepEqual([sourceTimeAt(clipOf, 0 + FRAME), sourceTimeAt(clipOf, 4 * S)], [6 * S - FRAME, 2 * S]);
  speed(session, { reverse: false });
  assert.equal(el(session.document, "v").retime?.reverse ?? false, false);
  assert.deepEqual(session.historyLength, 2);
  // Constant speed-up: a key at local 4 s lands on 2 s.
  const keyed = open(setKeyframe(put(project(), "t-main", clip("v", 0, 10, { clipAnimation: { in: { type: "fade-in", duration: 60_000, strength: 100 } } })), CTX, "v", "opacity", { time: 4 * S, value: 0.5 }).document);
  speed(keyed, { rate: 2 });
  assert.deepEqual([el(keyed.document, "v").animations.opacity.keys[0].time, el(keyed.document, "v").clipAnimation.in.duration], [2 * S, 60_000]);
  // Reverse at constant rate: 2 s → 8 s; the bezier leaving K1 leaves K2 afterwards, mirrored.
  let doc = setKeyframe(put(project(), "t-main", clip()), CTX, "v", "opacity", { time: 2 * S, value: 0 }).document;
  doc = setKeyframe(doc, CTX, "v", "opacity", { time: 4 * S, value: 1 }).document;
  doc = setKeyframe(doc, CTX, "v", "opacity", { time: 2 * S, value: 0, easing: "Ease in" }).document;
  const before = (time: number) => tl.valueAt(el(doc, "v").animations.opacity.keys, time) as number;
  const turned = open(doc);
  speed(turned, { reverse: true });
  const keys = el(turned.document, "v").animations.opacity.keys;
  assert.deepEqual(keys.map((key: any) => [key.time / S, key.value, key.segmentToNext]), [[6, 1, "bezier"], [8, 0, "linear"]]);
  for (const seconds of [2.5, 3, 3.5]) assert.ok(Math.abs((tl.valueAt(keys, (10 - seconds) * S) as number) - before(seconds * S)) < 1e-3, `value at ${seconds}`);
  // Flash In reversed: the curve and the duration stay; a key stays on its source frame at `duration − t`.
  const flash = open(put(project(), "t-main", clip()));
  speed(flash, { curve: { preset: "flash-in" } });
  const forward = el(flash.document, "v");
  const t = 20 * FRAME, source = sourceTimeAt(retimeClipOf(forward), t);
  flash.adoptCommit(setKeyframe(flash.document, CTX, "v", "opacity", { time: t, value: 0.5 }), flash.document);
  speed(flash, { reverse: true });
  const back = el(flash.document, "v"), moved = back.animations.opacity.keys[0].time;
  assert.deepEqual([back.retime.curve.points, back.duration, moved], [forward.retime.curve.points, forward.duration, forward.duration - t]);
  assert.ok(Math.abs(sourceTimeAt(retimeClipOf(back), moved) - source) <= FRAME * 6);
  assert.ok(Math.abs(clipTimeAt(retimeClipOf(back), source) - moved) <= FRAME);
});

test("Audio clip speed: Linked audio follows; Unlinked audio does not follow; Retime data model: Non-retimable element; Effect of retime on captions: Captions follow a speed-up; Unlinked captions stay", () => {
  const linked = (linkId: string | null) => open(put(put(withTracks(project(), ["t-a", "audio"], ["t-c", "caption", { sourceId: "v" }], ["t-c2", "caption"]), "t-main", clip("v", 0, 10, { linkId })), "t-a", audio("s", 0, 10, { sourceDuration: 60 * S, trimEnd: 50 * S, linkId })));
  const pair = linked("L1"), steps = pair.historyLength;
  assert.ok(speed(pair, { rate: 2 }, ["v"], ON).ok);
  assert.deepEqual([el(pair.document, "v").retime.rate, el(pair.document, "s").retime.rate, el(pair.document, "v").duration, el(pair.document, "s").duration, pair.historyLength - steps], [2, 2, 5 * S, 5 * S, 1]);
  const apart = linked(null);
  speed(apart, { rate: 2 }, ["v"], ON);
  assert.deepEqual([el(apart.document, "v").retime.rate, el(apart.document, "s").retime], [2, undefined]);
  // An image has no speed.
  const still = open(put(project(), "t-main", image("i", 0, 4)));
  assert.deepEqual([speed(still, { rate: 2 }, ["i"]).ok, tl.isRetimable(el(still.document, "i"))], [false, false]);
  // A caption track made from the clip: 4 s–6 s becomes 2 s–3 s; captions of another track stay.
  const caption = (id: string, start: number, seconds: number) => ({ id, type: "caption", name: id, startTime: start * S, duration: seconds * S, text: "words" });
  let doc = put(withTracks(project(), ["t-c", "caption", { sourceId: "v" }], ["t-c2", "caption"]), "t-main", clip());
  doc = put(put(doc, "t-c", caption("c1", 4, 2)), "t-c2", caption("c2", 4, 2));
  const captioned = open(doc), result = speed(captioned, { rate: 2 });
  assert.ok(result.ok, result.message);
  assert.deepEqual([spans(captioned.document, "t-c"), spans(captioned.document, "t-c2"), result.info.captionsRetimed], [[[2, 3]], [[4, 6]], 1]);
});

test("Trim and split of retimed clips: Split a curved clip; Trim limit at 2×; Velocity effects from beats: Intensity mapping; Pulse pattern; More beats than the curve can hold; Speed changes land on beats", () => {
  const session = one();
  speed(session, { curve: { preset: "bullet" } });
  const whole = el(session.document, "v"), clipOf = retimeClipOf(whole), middle = snapToFrame(whole.duration / 2, { numerator: 30, denominator: 1 });
  const expected = (time: number) => sourceTimeAt(clipOf, time);
  const cut = session.execute(tl.split({ sceneId: "s1", time: middle }), OFF) as any;
  assert.ok(cut.ok, cut.message);
  const left = el(session.document, "v"), right = el(session.document, cut.info.rightIds[0]);
  assert.deepEqual([left.retime.curve.preset, right.retime.curve.preset, left.trimStart, right.trimStart, 60 * S - left.trimEnd], ["custom", "custom", 0, expected(middle), expected(middle)]);
  // Every timeline frame shows the source frame of the unsplit clip, within one frame.
  for (let time = 0; time < whole.duration; time += 5 * FRAME) {
    const part = time < middle ? left : right, got = sourceTimeAt(retimeClipOf(part), time - part.startTime);
    assert.ok(Math.abs(got - expected(time)) <= FRAME * 1.5, `frame at ${time}: ${got} vs ${expected(time)}`);
  }
  // 2× with 4 s of unused source behind the out-point: the end handle stops after 2 s.
  const fast = open(put(withTracks(project(), ["t-v2", "video"]), "t-v2", clip("v", 0, 5, { trimEnd: 4 * S, sourceDuration: 14 * S, retime: { rate: 2 } })));
  const grown = fast.execute(tl.trim({ sceneId: "s1", elementId: "v", side: "end", delta: 10 * S }), OFF) as any;
  assert.deepEqual([grown.info.delta, el(fast.document, "v").duration, el(fast.document, "v").trimEnd], [2 * S, 7 * S, 0]);
  // A curved clip trimmed at its end keeps the speed of what remains.
  const trimmed = one();
  speed(trimmed, { curve: { preset: "flash-out" } });
  const beforeTrim = retimeClipOf(el(trimmed.document, "v"));
  trimmed.execute(tl.trim({ sceneId: "s1", elementId: "v", side: "end", delta: -30 * FRAME }), OFF);
  const after = el(trimmed.document, "v");
  for (let time = 0; time < after.duration; time += 7 * FRAME) assert.ok(Math.abs(sourceTimeAt(retimeClipOf(after), time) - sourceTimeAt(beforeTrim, time)) <= FRAME * 1.5);
  assert.deepEqual(tl.velocityRates(60), { fast: 4, slow: 0.58 });
  const { fast: f, slow: s } = tl.velocityRates(60);
  assert.deepEqual(tl.velocitySections("pulse", 8, 60), [s, f, f, f, s, f, f, f]);
  const crowded = tl.velocityCurve(Array.from({ length: 40 }, (_, index) => (index + 1) / 41), 1, "slow-fast", 60);
  assert.deepEqual([crowded.points.length, crowded.boundaries, crowded.dropped], [32, 15, 25]);
  // Beats every 0.5 s of a 10 s source, every second one chosen: each ramp's midpoint sits on its beat.
  const beats = Array.from({ length: 19 }, (_, index) => (index + 1) / 20), made = tl.velocityCurve(beats, 2, "slow-fast", 60);
  for (let boundary = 0; boundary < made.boundaries; boundary++) assert.ok(Math.abs((made.points[1 + boundary * 2].u + made.points[2 + boundary * 2].u) / 2 - beats[boundary * 2]) < 1e-6);
});
