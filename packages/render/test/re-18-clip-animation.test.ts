// Clip animations In / Out / Combo from the catalogue tables, motion blur, frame blending and mask keyframe paths, as the frame builder resolves them (no GPU).
import assert from "node:assert/strict";
import { test } from "node:test";
import { CLIP_ANIMATION_ROWS } from "@jagentchill/content";
import { animatablePath } from "@jagentchill/protocol";
import { buildFrame, clipAnimationPose, cubicBezier, knownClipAnimation, NEUTRAL_POSE, periodicRowsMatch, resolveClipAnimation, type ClipPose, type LayerItem } from "../src/index.ts";
import { asset, element, project, track } from "./support/doc.ts";

const SECOND = 120_000, FRAME = 4000;
const pose = (type: string, u: number, t = u, strength = 100, id = "e") => clipAnimationPose(type, u, t, strength, id)!;
const close = (actual: number, expected: number, range: number, label: string) => assert.ok(Math.abs(actual - expected) <= range * 0.005 + 1e-9, `${label}: ${actual}, expected ${expected}`);
const EASE_OUT = (x: number) => cubicBezier(0, 0, 0.58, 1, x), EASE_IN = (x: number) => cubicBezier(0.42, 0, 1, 1, x), EASE_IO = (x: number) => cubicBezier(0.42, 0, 0.58, 1, x);
const CHANNELS = ["x", "y", "scaleX", "scaleY", "rotation", "opacity", "blur", "reveal"] as const;
const RANGE: Record<(typeof CHANNELS)[number], number> = { x: 200, y: 200, scaleX: 260, scaleY: 260, rotation: 720, opacity: 1, blur: 40, reveal: 1 };

test("Bundled clip animation library — Library counts; Table-driven values: each of the 44 animations at u = 0, 0.5 and 1 equals its catalogue table; all In animations end and all Out animations start at the unmodified state; Out mirrors In", () => {
  assert.deepEqual(["in", "out", "combo"].map((group) => CLIP_ANIMATION_ROWS.filter((row) => row.group === group).length), [16, 16, 12]);
  for (const row of CLIP_ANIMATION_ROWS) assert.ok(knownClipAnimation(row.id, row.group), `${row.id} is drawn`);
  assert.deepEqual(periodicRowsMatch(), [], "the time-function rows read as the engine's formulas");
  const neutral = (value: ClipPose, label: string) => { for (const channel of CHANNELS) close(value[channel], NEUTRAL_POSE[channel], RANGE[channel], `${label} ${channel}`); };
  for (const row of CLIP_ANIMATION_ROWS) {
    // The jitter of the Shake pair has amplitude 0 at the resting end.
    if (row.group === "in") neutral(pose(row.id, 1), `${row.id} at its end`);
    if (row.group === "out") neutral(pose(row.id, 0), `${row.id} at its start`);
  }
  // Every Out row is the time-mirror of its In counterpart, as the catalogue's "Mirror of" column says.
  const mirrors: Record<string, string> = { "fade-out": "fade-in", "zoom-out": "zoom-in", "zoom-in-out": "zoom-out-in", "slide-out-left": "slide-in-left", "slide-out-right": "slide-in-right", "slide-out-up": "slide-in-down", "slide-out-down": "slide-in-up", "spin-out": "spin-in", "swing-out": "swing-in", "bounce-out": "bounce-in", "drop-out": "drop-in", "pop-out": "pop-in", "blur-out": "blur-in", "flip-out": "flip-in", "wipe-out": "wipe-in" };
  for (const [leave, enter] of Object.entries(mirrors)) for (const u of [0, 0.1, 0.25, 0.5, 0.7, 0.9, 1]) for (const channel of CHANNELS) close(pose(leave, u)[channel], pose(enter, 1 - u)[channel], RANGE[channel], `${leave} mirrors ${enter} at ${u}, ${channel}`);
  // The tables at u = 0, 0.5 and 1, written from catalog.md.
  const table: [string, number, Partial<ClipPose>][] = [
    ["fade-in", 0, { opacity: 0 }], ["fade-in", 0.5, { opacity: 0.5 }], ["fade-in", 1, { opacity: 1 }],
    ["zoom-in", 0, { scaleX: 50, scaleY: 50, opacity: 0 }], ["zoom-in", 0.5, { scaleX: 50 + 50 * EASE_OUT(0.5), opacity: 1 }], ["zoom-out-in", 0, { scaleX: 160 }], ["zoom-out-in", 0.5, { scaleY: 160 - 60 * EASE_OUT(0.5) }],
    ["slide-in-left", 0, { x: -100 }], ["slide-in-left", 0.5, { x: -100 + 100 * EASE_OUT(0.5) }], ["slide-in-right", 0, { x: 100 }], ["slide-in-up", 0, { y: 100 }], ["slide-in-down", 0, { y: -100 }],
    ["spin-in", 0, { rotation: -360, scaleX: 30 }], ["spin-in", 0.5, { rotation: -360 + 360 * EASE_OUT(0.5), scaleY: 30 + 70 * EASE_OUT(0.5) }],
    ["swing-in", 0, { rotation: -30, opacity: 0 }], ["swing-in", 0.6, { rotation: 8 }], ["swing-in", 0.8, { rotation: -3 }], ["swing-in", 0.5, { rotation: -30 + 38 * EASE_IO(0.5 / 0.6) }],
    ["bounce-in", 0, { scaleX: 30 }], ["bounce-in", 0.5, { scaleX: 112, opacity: 1 }], ["bounce-in", 0.75, { scaleY: 96 }],
    ["drop-in", 0, { y: -100 }], ["drop-in", 0.45, { y: 0 }], ["drop-in", 0.6, { y: -12 }], ["drop-in", 0.5, { y: -12 * EASE_OUT(0.05 / 0.15) }], ["drop-in", 0.87, { y: -4 }],
    ["pop-in", 0, { scaleX: 0, scaleY: 0 }], ["pop-in", 0.7, { scaleX: 120 }], ["pop-in", 0.5, { scaleX: 120 * EASE_OUT(0.5 / 0.7) }],
    ["blur-in", 0, { blur: 40, opacity: 0 }], ["blur-in", 0.5, { blur: 40 - 40 * EASE_OUT(0.5), opacity: EASE_OUT(0.5) }],
    ["flip-in", 0, { scaleX: -100, scaleY: 100 }], ["flip-in", 0.5, { scaleX: -100 + 200 * EASE_OUT(0.5) }], ["wipe-in", 0, { reveal: 0 }], ["wipe-in", 0.5, { reveal: 0.5 }],
    ["zoom-out", 0.5, { scaleX: 100 - 50 * EASE_IN(0.5), opacity: 1 }], ["zoom-out", 1, { scaleX: 50, opacity: 0 }], ["drop-out", 0.4, { y: -12 }], ["swing-out", 1, { rotation: -30, opacity: 0 }],
    ["slide-through", 0, { x: -100 }], ["slide-through", 0.5, { x: 0 }], ["slide-through", 1, { x: 100 }], ["spin-through", 0, { rotation: -180, scaleX: 40 }], ["spin-through", 0.5, { rotation: 0, scaleX: 100 }], ["spin-through", 1, { rotation: 180, scaleY: 40 }],
    ["flip-through", 0, { scaleX: -100 }], ["flip-through", 0.5, { scaleX: 100 }], ["flip-through", 1, { scaleX: -100 }], ["stretch", 0.5, { scaleX: 130, scaleY: 80 }], ["stretch", 1, { scaleX: 100, scaleY: 100 }],
    ["drift-in", 0, { scaleX: 100 }], ["drift-in", 0.5, { scaleX: 110 }], ["drift-in", 1, { scaleY: 120 }], ["drift-out", 0, { scaleX: 120 }], ["drift-out", 1, { scaleX: 100 }],
  ];
  for (const [type, u, expected] of table) for (const [channel, value] of Object.entries(expected)) close(pose(type, u)[channel as "x"], value as number, RANGE[channel as "x"], `${type} at ${u}, ${channel}`);
  // The periodic rows are functions of seconds.
  close(pose("zoom-pulse", 0, 0.5).scaleX, 115, 260, "zoom pulse peak"); close(pose("zoom-pulse", 0, 1).scaleX, 100, 260, "zoom pulse rest");
  close(pose("swing", 0, 0.375).rotation, 10, 720, "swing"); close(pose("pendulum", 0, 0.5).rotation, 15, 720, "pendulum"); assert.equal(pose("pendulum", 0, 0.5).pivot, "top");
  close(pose("bounce", 0, 0.4).y, -8, 200, "bounce"); close(pose("wobble", 0, 0.15).scaleX, 104, 260, "wobble x"); close(pose("wobble", 0, 0.15).scaleY, 96, 260, "wobble y");
});

test("Clip animation model — strength scales translation, scale deviation, rotation and blur and leaves opacity and reveal; Slide In Left at half strength; Deterministic jitter: the same element repeats, another element differs, the value holds for 1/12 s", () => {
  assert.equal(pose("slide-in-left", 0, 0, 50).x, -50);
  assert.equal(pose("zoom-in", 0, 0, 50).scaleX, 75);
  assert.equal(pose("zoom-in", 0, 0, 50).opacity, 0, "opacity is not scaled");
  assert.equal(Math.abs(pose("spin-in", 0, 0, 0).rotation), 0);
  assert.equal(pose("blur-in", 0, 0, 25).blur, 10);
  assert.equal(pose("wipe-in", 0.5, 0, 0).reveal, 0.5, "reveal is not scaled");
  const a = pose("shake", 0, 0.5, 100, "one"), again = pose("shake", 0, 0.5, 100, "one"), other = pose("shake", 0, 0.5, 100, "two"), held = pose("shake", 0, 0.5 + 1 / 13 - 0.01, 100, "one"), next = pose("shake", 0, 0.5 + 1 / 12, 100, "one");
  assert.deepEqual(a, again);
  assert.notDeepEqual([a.x, a.y, a.rotation], [other.x, other.y, other.rotation]);
  assert.deepEqual([held.x, held.y], [a.x, a.y]);
  assert.notDeepEqual([next.x, next.y], [a.x, a.y]);
  assert.ok(Math.abs(a.x) <= 3 && Math.abs(a.y) <= 3 && Math.abs(a.rotation) <= 1.5 && (a.x !== 0 || a.y !== 0));
  assert.ok(Math.abs(pose("shake-in", 0, 0, 100, "one").x) <= 6 && pose("shake-in", 1, 1, 100, "one").x === 0);
  assert.equal(clipAnimationPose("no-such", 0, 0, 100, "e"), null);
});

function scene(fields: Record<string, unknown>, type = "image") {
  const doc = project();
  doc.media.assets.push(asset("img", "image", { width: 960, height: 540 }), asset("vid", "video", { width: 960, height: 540, fps: { numerator: 30, denominator: 1 }, duration: 20 * SECOND }));
  doc.scenes[0].tracks.overlay = [track("video", "o0", [element(type, { id: "e", mediaId: type === "video" ? "vid" : "img", startTime: 0, duration: 4 * SECOND, ...fields })])];
  return doc;
}
const layerAt = (doc: unknown, time: number) => buildFrame({ document: doc as never, sceneId: "s1", time, render: { width: 1920, height: 1080 } }).descriptor.items.filter((item): item is LayerItem => item.type === "layer").at(-1)!;

test("Clip animation model — In and Out together; Opacity multiplies; Composes with keyframes; Out mirrors In: the last frame of a Fade Out is below 0.04; Looping combo: Zoom Pulse peaks at 0.5 s, 1.5 s and 2.5 s; a combo follows the element duration; blur and reveal become passes at their stages", () => {
  const fades = scene({ clipAnimation: { in: { type: "fade-in", duration: 0.5 * SECOND }, out: { type: "fade-out", duration: SECOND } } });
  const opacity = (time: number) => layerAt(fades, time).opacity;
  assert.deepEqual([opacity(0), opacity(0.25 * SECOND), opacity(0.5 * SECOND), opacity(2 * SECOND), opacity(3 * SECOND), opacity(3.5 * SECOND)], [0, 0.5, 1, 1, 1, 0.5]);
  assert.ok(opacity(4 * SECOND - FRAME) < 0.04 && opacity(4 * SECOND - FRAME) > 0);
  assert.equal(layerAt(scene({ opacity: 0.5, clipAnimation: { in: { type: "fade-in", duration: SECOND } } }), 0.5 * SECOND).opacity, 0.25);
  // Slide In Left at strength 50 on a 1920 px canvas: 960 px to the left at 0, at rest at the end; added to a keyframed position.
  const keyed = { "transform.position.x": { keys: [{ id: "k0", time: 0, value: 100, segmentToNext: "linear" }, { id: "k1", time: SECOND, value: 300, segmentToNext: "linear" }] } };
  const slide = scene({ animations: keyed, clipAnimation: { in: { type: "slide-in-left", duration: SECOND, strength: 50 } } });
  const before = JSON.stringify(slide);
  assert.equal(layerAt(slide, 0).transform.centerX, 960 + 100 - 960);
  assert.equal(layerAt(slide, SECOND).transform.centerX, 960 + 300);
  assert.equal(JSON.stringify(slide), before, "the keyframes are unchanged");
  const pulse = scene({ clipAnimation: { combo: { type: "zoom-pulse", duration: 4 * SECOND, followsDuration: true } } });
  for (const at of [0.5, 1.5, 2.5]) assert.ok(Math.abs(layerAt(pulse, at * SECOND).transform.width / 1920 - 1.15) < 1e-6, `peak at ${at} s`);
  assert.ok(Math.abs(layerAt(pulse, SECOND).transform.width - 1920) < 1e-6);
  // A negative scaleX mirrors the layer; a pendulum turns about the top edge centre.
  const flip = layerAt(scene({ clipAnimation: { in: { type: "flip-in", duration: SECOND } } }), 0);
  assert.deepEqual([flip.transform.flipX, flip.transform.width], [true, 1920]);
  const swing = layerAt(scene({ clipAnimation: { combo: { type: "pendulum", duration: 4 * SECOND, followsDuration: true } } }), 0.5 * SECOND).transform;
  const turn = (swing.rotationDegrees * Math.PI) / 180;
  assert.ok(Math.abs(swing.rotationDegrees - 15) < 1e-9);
  // The top edge centre stays where it is at rest: (960, 0).
  assert.ok(Math.abs(swing.centerX + Math.sin(turn) * 540 - 960) < 1e-6 && Math.abs(swing.centerY - Math.cos(turn) * 540) < 1e-6, JSON.stringify(swing));
  const blurred = layerAt(scene({ clipAnimation: { in: { type: "blur-in", duration: SECOND } } }), 0);
  assert.equal(blurred.effectPassGroups.at(-1)![0].shader, "gaussian-blur");
  assert.equal(blurred.effectPassGroups.at(-1)![0].uniforms.u_sigma, 40, "sigma 40 on the 1920 reference canvas");
  const wiped = layerAt(scene({ clipAnimation: { in: { type: "wipe-in", duration: SECOND } } }), 0.5 * SECOND);
  assert.deepEqual(wiped.postPasses, [{ shader: "wipe-reveal", uniforms: { u_reveal: 0.5, u_angle: 0, u_softness: 0.1 } }]);
  const rest = layerAt(scene({ clipAnimation: { in: { type: "wipe-in", duration: SECOND } } }), 2 * SECOND);
  assert.deepEqual([rest.postPasses, rest.effectPassGroups], [undefined, []], "an animation at rest builds no pass");
});

test("Motion blur — a trailing shutter of strength % of one frame: the transform at its start and at the frame time; Static element renders unchanged; samples 4 / 8 / 16", () => {
  // 200 px per frame to the right.
  const moving = { "transform.position.x": { keys: [{ id: "k0", time: 0, value: 0, segmentToNext: "linear" }, { id: "k1", time: 4 * SECOND, value: 200 * 120, segmentToNext: "linear" }] } };
  const layer = layerAt(scene({ animations: moving, motionBlur: { enabled: true, strength: 50, samples: 16 } }), 10 * FRAME);
  const pass = layer.postPasses!.find((entry) => entry.shader === "motion-blur")!;
  assert.deepEqual(pass.uniforms.u_current, [960 + 2000, 540, 1920, 1080]);
  assert.deepEqual(pass.uniforms.u_previous, [960 + 1900, 540, 1920, 1080], "half a frame earlier");
  assert.equal(pass.uniforms.u_samples, 16);
  assert.equal(layerAt(scene({ motionBlur: { enabled: true, strength: 50, samples: 8 } }), 10 * FRAME).postPasses, undefined, "no motion, no pass");
  assert.equal(layerAt(scene({ animations: moving, motionBlur: { enabled: false, strength: 50, samples: 8 } }), 10 * FRAME).postPasses, undefined);
  // The clip-animation transform is part of the motion; before the element's start the transform at local time 0 is used.
  const sliding = layerAt(scene({ clipAnimation: { in: { type: "slide-in-left", duration: SECOND } }, motionBlur: { enabled: true, strength: 100, samples: 4 } }), 5 * FRAME);
  assert.ok((sliding.postPasses![0].uniforms.u_previous as number[])[0] < (sliding.postPasses![0].uniforms.u_current as number[])[0]);
  assert.equal(layerAt(scene({ animations: moving, motionBlur: { enabled: true, strength: 100, samples: 4 } }), 0).postPasses, undefined, "at local time 0 the shutter starts at 0 too");
  assert.equal(layerAt(scene({ animations: moving, motionBlur: { enabled: true, strength: 0, samples: 8 } }), 10 * FRAME).postPasses, undefined, "strength zero");
});

test("Smooth slow motion — Frame blending at 0.5×: every second output frame is the 50/50 mix of two consecutive source frames and the others equal a source frame; Off repeats frames; at 1× or faster nothing is blended; flow renders as blending", () => {
  const slow = (smooth: string, rate = 0.5) => scene({ sourceDuration: 20 * SECOND, retime: { rate, smooth } }, "video");
  const blend = (doc: unknown, frame: number) => layerAt(doc, frame * FRAME).blendSource ?? null;
  assert.equal(blend(slow("blend"), 0), null);
  assert.deepEqual(blend(slow("blend"), 1), { textureId: "video:e:next", mix: 0.5 });
  assert.equal(blend(slow("blend"), 2), null);
  assert.deepEqual(blend(slow("blend"), 3), { textureId: "video:e:next", mix: 0.5 });
  assert.equal(blend(slow("blend", 0.25), 1)!.mix, 0.25);
  assert.equal(blend(slow("none"), 1), null);
  assert.equal(blend(slow("blend", 1.5), 1), null, "faster than 1×: frames are skipped, not blended");
  assert.deepEqual(blend(slow("flow"), 1), { textureId: "video:e:next", mix: 0.5 });
});

test("Animatable property paths — a mask parameter and a freeform mask path are keyframed at `masks.<maskId>.params.<key>`, the path the document validates, and the renderer resolves them there", () => {
  const key = (time: number, value: unknown, extra: Record<string, unknown> = {}) => ({ id: `k${time}`, time, value, segmentToNext: "linear", ...extra });
  const masked = scene({
    masks: [{ id: "m1", type: "rectangle", combine: "add", params: { centerX: 0, centerY: 0, width: 0.4, height: 0.4, rotation: 0, scale: 1, feather: 0, opacity: 100, inverted: false, cornerRadius: 0 } }],
    animations: { "masks.m1.params.centerX": { keys: [key(0, -0.25), key(2 * SECOND, 0.25)] }, "masks.m1.params.feather": { keys: [key(0, 0), key(2 * SECOND, 40)] } },
  });
  const stored = (masked.scenes[0].tracks.overlay[0].elements[0] as any);
  assert.ok(animatablePath(stored, "masks.m1.params.centerX"), "the document accepts the path");
  assert.equal(animatablePath(stored, "masks.@m1.params.centerX"), null);
  const params = (time: number) => { const built = buildFrame({ document: masked as never, sceneId: "s1", time, render: { width: 1920, height: 1080 } }); const request = [...built.textures].find((texture) => texture.kind === "mask") as any; return { params: request.params, mask: (built.descriptor.items.at(-1) as LayerItem).masks[0] }; };
  assert.deepEqual([params(0).params.centerX, params(SECOND).params.centerX, params(2 * SECOND).params.centerX], [-0.25, 0, 0.25]);
  assert.deepEqual([params(0).mask.feather, params(SECOND).mask.feather], [0, 20]);
  // A freeform path: every point moves on its own between two keys.
  const square = (shift: number) => ["a", "b", "c", "d"].map((id, index) => ({ id, x: [-0.2, 0.2, 0.2, -0.2][index] + shift, y: [-0.2, -0.2, 0.2, 0.2][index], inX: 0, inY: 0, outX: 0, outY: 0 }));
  const freeform = scene({
    masks: [{ id: "f1", type: "freeform", combine: "add", params: { centerX: 0, centerY: 0, rotation: 0, scale: 1, feather: 0, opacity: 100, inverted: false, closed: true, path: square(0) } }],
    animations: { "masks.f1.params.path": { keys: [key(0, { points: square(0) }), key(2 * SECOND, { points: square(0.2) })] } },
  });
  const pathAt = (time: number) => ([...buildFrame({ document: freeform as never, sceneId: "s1", time, render: { width: 1920, height: 1080 } }).textures].find((texture) => texture.kind === "mask") as any).params.path.map((point: any) => point.x);
  assert.deepEqual(pathAt(0), [-0.2, 0.2, 0.2, -0.2]);
  assert.deepEqual(pathAt(SECOND).map((value: number) => Math.round(value * 1000) / 1000), [-0.1, 0.3, 0.3, -0.1]);
});
