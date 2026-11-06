import assert from "node:assert/strict";
import { test } from "node:test";
import {
  boxInverse, buildFrame, buildScene, clampCrop, containFit, evaluateColor, evaluateScalar, gaussianBlurPasses, layerQuad, pixelScaleFactor, previewRenderSize,
  QualityGovernor, serializeScene, type LayerItem, type SceneDiagnostic, type TransitionItem,
} from "../src/index.ts";
import { asset, element, project, track } from "./support/doc.ts";

const image = (id: string, fields: Record<string, unknown> = {}) => element("image", { id, mediaId: "img", ...fields });
function stacked() {
  const doc = project();
  doc.media.assets.push(asset("img", "image", { width: 1920, height: 1080 }));
  doc.scenes[0].tracks.main.elements.push(image("M"));
  doc.scenes[0].tracks.overlay = [track("video", "o0", [image("B")]), track("video", "o1", [image("A")])];
  return doc;
}
const ids = (root: ReturnType<typeof buildScene>) => root.children.map((node) => ("elementId" in node ? node.elementId ?? "background" : "transition"));

test("Scene build order — Overlay stacking", () => {
  const root = buildScene(stacked(), "s1");
  assert.deepEqual(ids(root), ["background", "M", "A", "B"], "background, main, overlay[1], overlay[0]");
  assert.deepEqual([root.width, root.height, root.frameRate, root.duration], [1920, 1080, { numerator: 30, denominator: 1 }, 120_000]);
  // Within a track elements are ordered by start time and then by id.
  const doc = stacked();
  doc.scenes[0].tracks.overlay[0].elements = [image("z", { startTime: 0 }), image("a", { startTime: 240_000 }), image("b", { startTime: 0, duration: 4000 })] as never;
  assert.deepEqual(ids(buildScene(doc, "s1")).slice(-3), ["b", "z", "a"]);
});

test("Scene build order — Hidden track is skipped", () => {
  const doc = stacked();
  (doc.scenes[0].tracks.overlay[0] as { hidden: boolean }).hidden = true;
  (doc.scenes[0].tracks.overlay[0].elements[0] as { duration: number }).duration = 600_000;
  const root = buildScene(doc, "s1");
  assert.deepEqual(ids(root), ["background", "M", "A"]);
  assert.equal(root.duration, 600_000, "the duration still includes the hidden elements' end times");
  // Hidden elements are skipped as well; audio tracks produce no visual nodes.
  const hidden = stacked();
  (hidden.scenes[0].tracks.overlay[1].elements[0] as { hidden: boolean }).hidden = true;
  hidden.scenes[0].tracks.audio = [track("audio", "a0", [element("audio", { id: "snd", mediaId: "img", sourceType: "upload", duration: 900_000 })])];
  const built = buildScene(hidden, "s1");
  assert.deepEqual(ids(built), ["background", "M", "B"]);
  assert.equal(built.duration, 900_000);
});

test("Scene build order — Same snapshot builds the same tree", () => {
  const snapshot = JSON.stringify(stacked());
  assert.equal(serializeScene(buildScene(JSON.parse(snapshot), "s1")), serializeScene(buildScene(JSON.parse(snapshot), "s1")));
});

test("Scene node types — Unknown element type; Mask on a text element is ignored; Standalone filter is an effect layer", () => {
  const doc = stacked();
  doc.scenes[0].tracks.overlay.push(
    track("text", "t0", [{ ...(element("text", { id: "T" }) as object), masks: [{ id: "m1", type: "rectangle", enabled: true, combine: "add", params: {} }] }]),
    track("video", "o2", [{ id: "H", type: "hologram", startTime: 0, duration: 4000 }]),
    track("effect", "fx", [element("effect", { id: "F", effects: [{ id: "f1", type: "warm", kind: "filter", enabled: true, params: {} }] })]),
    track("adjustment", "adj", [element("adjustment", { id: "J" })]),
    track("graphic", "g", [element("graphic", { id: "G", definitionId: "rectangle" }), element("sticker", { id: "S", stickerId: "pack:star", startTime: 120_000 })]),
    track("caption", "c", [element("caption", { id: "C" })], { caption: { style: {} } }),
  );
  const diagnostics: SceneDiagnostic[] = [];
  const root = buildScene(doc, "s1", { diagnose: (diagnostic) => diagnostics.push(diagnostic) });
  const types = Object.fromEntries(root.children.flatMap((node) => ("element" in node ? [[node.elementId, node.type]] : [])));
  assert.deepEqual(types, { M: "Image", A: "Image", B: "Image", T: "Text", F: "EffectLayer", J: "AdjustmentLayer", G: "Graphic", S: "Sticker", C: "Caption" });
  assert.deepEqual(diagnostics.map((diagnostic) => [diagnostic.id, diagnostic.elementId]).sort(), [["mask/unsupported-element", "T"], ["scene/unknown-element-type", "H"]]);
  const text = root.children.find((node) => "element" in node && node.elementId === "T") as { masks: unknown[] };
  assert.deepEqual(text.masks, [], "the text renders unmasked");
  // Captions are omitted when a render asks for none.
  assert.ok(!ids(buildScene(doc, "s1", { includeCaptions: false })).includes("C"));
});

test("FrameDescriptor schema — Minimal descriptor", () => {
  const doc = project();
  doc.media.assets.push(asset("img", "image", { width: 1920, height: 1080 }));
  doc.scenes[0].tracks.main.elements.push(image("e1"));
  doc.settings.background = { kind: "transparent" } as never;
  const built = buildFrame({ document: doc, sceneId: "s1", time: 0, render: { width: 1920, height: 1080 } });
  assert.equal(built.descriptor.version, 3);
  assert.deepEqual(built.descriptor.clear.color, [0, 0, 0, 0]);
  assert.equal(built.descriptor.items.length, 1);
  const layer = built.descriptor.items[0] as LayerItem;
  assert.equal(layer.type, "layer");
  assert.deepEqual(layer.effectPassGroups, []);
  assert.deepEqual(layer.masks, []);
  for (const key of ["stabilise", "key", "matte", "analysis", "color", "filter", "maskStroke", "reveal", "motionBlur"] as const) assert.equal(layer[key], null, key);
  assert.deepEqual(layer.transform, { centerX: 960, centerY: 540, width: 1920, height: 1080, rotationDegrees: 0, flipX: false, flipY: false });
  assert.deepEqual(built.textures, [{ id: "image:img:2048", kind: "image", assetId: "img", maxLongSide: 2048, elementId: "e1" }]);
});

test("FrameDescriptor schema — Exclude mask is representable", () => {
  const doc = project();
  doc.media.assets.push(asset("img", "image", { width: 1920, height: 1080 }));
  const mask = (id: string, combine: string, params: Record<string, unknown>, enabled = true) => ({ id, type: "rectangle", enabled, combine, params });
  doc.scenes[0].tracks.main.elements.push(image("e1", { masks: [mask("m1", "add", {}), mask("m2", "exclude", { opacity: 50 }), mask("m3", "add", {}, false)] }));
  const layer = buildFrame({ document: doc, sceneId: "s1", time: 0, render: { width: 1920, height: 1080 } }).descriptor.items.at(-1) as LayerItem;
  assert.equal(layer.masks.length, 2, "disabled masks are omitted");
  assert.deepEqual([layer.masks[1].combine, layer.masks[1].opacity], ["exclude", 0.5]);
});

test("Resolve pass — Element not yet started; Key at the element end; Keyframed opacity at the frame start; Colour interpolation in linear RGB", () => {
  const key = (id: string, time: number, value: number, segmentToNext = "linear") => ({ id, time, value, segmentToNext, tangentMode: "auto" }) as never;
  const channel = { keys: [key("a", 0, 0), key("b", 120_000, 1)], extrapolation: { before: "hold", after: "hold" } } as never;
  assert.equal(evaluateScalar(channel, 30_000), 0.25);
  const doc = project();
  doc.media.assets.push(asset("img", "image", { width: 1920, height: 1080 }));
  doc.scenes[0].tracks.main.elements.push(image("e1", { startTime: 120_000, duration: 120_000, animations: { opacity: { keys: [key("a", 0, 0.2), key("b", 120_000, 0.9)] } } }));
  const frame = (time: number) => buildFrame({ document: doc, sceneId: "s1", time, render: { width: 1920, height: 1080 } });
  const before = frame(119_999);
  assert.deepEqual(before.textures.filter((texture) => texture.kind === "image"), [], "one tick before the start no decode request is issued");
  // The last rendered frame samples clip time 116 000; the key at 120 000 is never sampled.
  const last = frame(236_000).descriptor.items.at(-1) as LayerItem;
  assert.ok(Math.abs(last.opacity - (0.2 + 0.7 * (116_000 / 120_000))) < 1e-12);
  assert.equal(frame(240_000).descriptor.items.length, 1, "at the element end only the background is left");
  // Step holds the outgoing value; bezier with default handles eases through the midpoint.
  assert.equal(evaluateScalar({ keys: [key("a", 0, 3, "step"), key("b", 100, 9)] } as never, 99), 3);
  assert.ok(Math.abs(evaluateScalar({ keys: [key("a", 0, 0, "bezier"), key("b", 100, 1)] } as never, 50) - 0.5) < 1e-6);
  // Linear extrapolation continues along the boundary tangent.
  assert.equal(evaluateScalar({ keys: [key("a", 100, 0), key("b", 200, 1)], extrapolation: { before: "linear", after: "linear" } } as never, 300), 2);
  const scalar = (from: number, to: number) => ({ keys: [key("a", 0, from), key("b", 120_000, to)] });
  assert.equal(evaluateColor({ r: scalar(0, 1), g: scalar(0, 1), b: scalar(0, 1), a: scalar(1, 1) } as never, 60_000), "#bcbcbc");
});

test("Contain-fit, crop, flip and transform — Contain-fit of a portrait video; Crop then fit; Flip combined with negative scale; Clip animation composes with the element transform", () => {
  const canvas = { width: 1920, height: 1080 };
  const placement = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0 };
  const none = { left: 0, top: 0, right: 0, bottom: 0 };
  const portrait = layerQuad({ source: { width: 1080, height: 1920 }, crop: none, placement, canvas, render: canvas, fit: "contain" });
  assert.deepEqual([portrait.width, portrait.height, portrait.centerX, portrait.centerY], [607.5, 1080, 960, 540]);
  const cropped = layerQuad({ source: canvas, crop: { ...none, left: 0.25, right: 0.25 }, placement, canvas, render: canvas, fit: "contain" });
  assert.deepEqual([cropped.width, cropped.height, cropped.centerX], [960, 1080, 960]);
  const flipped = layerQuad({ source: canvas, crop: none, placement: { ...placement, scale: { x: -1, y: 1 }, flip: { horizontal: true } }, canvas, render: canvas, fit: "contain" });
  assert.deepEqual([flipped.flipX, flipped.width], [false, 1920]);
  const animated = layerQuad({ source: canvas, crop: none, placement: { ...placement, scale: { x: 0.5, y: 0.5 }, rotation: 10 }, canvas, render: canvas, fit: "contain", animation: { x: 30, y: 0, scaleX: 1.2, scaleY: 1.2, rotation: 5 } });
  assert.deepEqual([animated.width, animated.height, animated.rotationDegrees, animated.centerX], [1920 * 0.6, 1080 * 0.6, 15, 990]);
  // Stickers and graphics keep their intrinsic size; the render size scales everything uniformly.
  const sticker = layerQuad({ source: { width: 200, height: 100 }, crop: none, placement, canvas, render: { width: 960, height: 540 }, fit: "intrinsic" });
  assert.deepEqual([sticker.width, sticker.height, sticker.centerX], [100, 50, 480]);
  assert.deepEqual(containFit({ width: 100, height: 100 }, canvas), { width: 1080, height: 1080 });
  // A crop outside its range is clamped.
  assert.deepEqual(clampCrop({ left: 0.7, right: 0.6, top: -1, bottom: 2 }), { crop: { left: 0.7, right: 0.99 - 0.7, top: 0, bottom: 0.99 }, clamped: true });
  // The box matrix maps the box corners to uv (0,0) and (1,1), also for a rotated box.
  const quad = { centerX: 500, centerY: 300, width: 200, height: 100, rotationDegrees: 90, flipX: false, flipY: false };
  const m = boxInverse(quad);
  const uv = (x: number, y: number) => [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]].map((value) => Math.round(value * 1e9) / 1e9);
  assert.deepEqual(uv(500, 300), [0.5, 0.5]);
  assert.deepEqual(uv(550, 200), [0, 0], "the box's top-left corner after a 90° turn");
});

test("Gaussian blur effect pass — Pass count and per-pass sigma for sigma 100; Small sigma is one pair; Maximum; Element scale does not change the blur", () => {
  const big = gaussianBlurPasses(100);
  assert.equal(big.length, 14, "7 horizontal and 7 vertical passes");
  assert.ok(Math.abs((big[0].uniforms.u_sigma as number) - 37.8) < 0.01 && Math.abs((big[0].uniforms.u_step as number) - 3.78) < 0.01);
  assert.deepEqual(big.slice(0, 2).map((pass) => pass.uniforms.u_direction), [[1, 0], [0, 1]]);
  const small = gaussianBlurPasses(8);
  assert.deepEqual(small.map((pass) => [pass.uniforms.u_sigma, pass.uniforms.u_step]), [[8, 1], [8, 1]]);
  const most = gaussianBlurPasses(200);
  assert.equal(most.length, 16);
  assert.ok(Math.abs((most[0].uniforms.u_sigma as number) - 70.71) < 0.01 && Math.abs((most[0].uniforms.u_step as number) - 7.07) < 0.01);
  assert.deepEqual(gaussianBlurPasses(0.0005), []);
  // Blur intensity 40 on a 1920×1080 canvas is sigma 8 px at element scale 1 and at 0.5.
  for (const scale of [1, 0.5]) {
    const doc = project();
    doc.media.assets.push(asset("img", "image", { width: 1920, height: 1080 }));
    doc.scenes[0].tracks.main.elements.push(image("e1", { transform: { position: { x: 0, y: 0 }, scale: { x: scale, y: scale }, rotation: 0 }, effects: [{ id: "fx", type: "blur", kind: "effect", enabled: true, params: { intensity: 40 } }, { id: "off", type: "blur", kind: "effect", enabled: false, params: { intensity: 90 } }] }));
    const layer = buildFrame({ document: doc, sceneId: "s1", time: 0, render: { width: 1920, height: 1080 } }).descriptor.items.at(-1) as LayerItem;
    assert.deepEqual(layer.effectPassGroups.map((group) => group.map((pass) => pass.uniforms.u_sigma)), [[8, 8]]);
  }
  assert.equal(pixelScaleFactor({ width: 960, height: 540 }), 0.5);
  assert.equal(pixelScaleFactor({ width: 1080, height: 1920 }), 1);
});

test("Transition nodes — Frame before the window; the window is centred on the cut; Transition alpha and blend rule — Blend mode switches at the midpoint", () => {
  const doc = project();
  doc.media.assets.push(asset("img", "image", { width: 1920, height: 1080 }));
  doc.scenes[0].tracks.overlay = [track("video", "o0", [image("A", { duration: 120_000, blendMode: "screen", transitionOut: "t1" }), image("B", { startTime: 120_000, duration: 120_000, blendMode: "multiply", transitionIn: "t1" })],
    { transitions: [{ id: "t1", kind: "transition", fromElementId: "A", toElementId: "B", duration: 120_000, shape: "equal-power", type: "cross-dissolve", params: {}, easing: "linear", audioCrossfade: true }] })];
  const diagnostics: SceneDiagnostic[] = [];
  const at = (time: number) => buildFrame({ document: doc, sceneId: "s1", time, render: { width: 1920, height: 1080 }, diagnose: (diagnostic) => diagnostics.push(diagnostic) }).descriptor.items.at(-1)!;
  // Window: [120 000 − 60 000, 180 000).
  const before = at(56_000);
  assert.equal(before.type, "layer", "immediately before windowStart only A contributes and no transition shader runs");
  const middle = at(120_000) as TransitionItem;
  assert.equal(middle.type, "transition");
  assert.equal(middle.progress, 0.5);
  assert.deepEqual([middle.blendModeFrom, middle.blendModeTo, middle.shader], ["screen", "multiply", "cross-dissolve"]);
  assert.equal((at(116_000) as TransitionItem).progress < 0.5, true);
  assert.equal(middle.fromBackground, null, "on an overlay track the inputs start transparent");
  assert.equal(at(180_000).type, "layer", "after the window B renders as an ordinary node");
  assert.ok(diagnostics.some((diagnostic) => diagnostic.id === "scene/transition-held-frame"), "a side without handle material holds a frame and says so");
});

test("Compound clip nodes — Compound renders its inner scene; Reference cycle", () => {
  const doc = project();
  doc.media.assets.push(asset("img", "image", { width: 1920, height: 1080 }));
  const inner = JSON.parse(JSON.stringify(doc.scenes[0]));
  inner.id = "s2"; inner.isMain = false; inner.kind = "compound";
  inner.tracks.main.elements = [image("in1", { duration: 600_000 })];
  doc.scenes.push(inner);
  doc.scenes[0].tracks.main.elements.push(element("compound", { id: "c1", sceneId: "s2", startTime: 240_000, duration: 240_000, trimStart: 120_000, sourceDuration: 600_000 }));
  const built = buildFrame({ document: doc, sceneId: "s1", time: 360_000, render: { width: 1920, height: 1080 } });
  const group = built.descriptor.items.find((item) => item.type === "group") as { items: LayerItem[]; targetTextureId: string };
  assert.equal(group.targetTextureId, "compound:c1");
  assert.equal(group.items.length, 1, "the inner scene draws no background of its own");
  assert.equal((built.descriptor.items.at(-1) as LayerItem).textureId, "compound:c1");
  // The inner scene is rendered at the mapped source time: 3 s − 2 s + 1 s trim = 2 s.
  inner.tracks.main.elements[0].animations = { opacity: { keys: [{ id: "a", time: 0, value: 0, segmentToNext: "linear", tangentMode: "auto" }, { id: "b", time: 480_000, value: 1, segmentToNext: "linear", tangentMode: "auto" }] } };
  const again = buildFrame({ document: doc, sceneId: "s1", time: 360_000, render: { width: 1920, height: 1080 } });
  assert.equal(((again.descriptor.items.find((item) => item.type === "group") as { items: LayerItem[] }).items[0]).opacity, 0.5);
  // A cycle renders transparent and names both elements.
  inner.tracks.main.elements.push(element("compound", { id: "c2", sceneId: "s1", startTime: 0, duration: 600_000 }));
  const diagnostics: SceneDiagnostic[] = [];
  const cyclic = buildFrame({ document: doc, sceneId: "s1", time: 360_000, render: { width: 1920, height: 1080 }, diagnose: (diagnostic) => diagnostics.push(diagnostic) });
  assert.equal(cyclic.descriptor.items.filter((item) => item.type === "group").length, 1);
  assert.deepEqual(diagnostics.map((diagnostic) => [diagnostic.id, diagnostic.details?.elementIds]), [["scene/compound-cycle", ["s1", "s2", "c2"]]]);
});

test("Preview resolution scaling — Small viewport; Auto lowers quality under load; Auto raises quality again", () => {
  const maximum = { width: 3840, height: 2160 };
  assert.deepEqual(previewRenderSize({ width: 3840, height: 2160 }, { width: 640, height: 360 }, 2, 1, "full", maximum), { width: 1280, height: 720 });
  assert.deepEqual(previewRenderSize({ width: 1920, height: 1080 }, { width: 4000, height: 3000 }, 2, 1, "half", maximum), { width: 960, height: 540 });
  assert.deepEqual(previewRenderSize({ width: 1920, height: 1080 }, { width: 4000, height: 3000 }, 2, 1, "quarter", maximum), { width: 480, height: 270 });
  assert.deepEqual(previewRenderSize({ width: 7680, height: 4320 }, { width: 8000, height: 8000 }, 1, 1, "full", { width: 1920, height: 1080 }), { width: 1920, height: 1080 });
  const governor = new QualityGovernor();
  const frameMs = 1000 / 30;
  let changed;
  for (let frame = 0; frame < 30; frame++) changed = governor.record(45, frameMs);
  assert.deepEqual([changed, governor.level], ["half", "half"]);
  for (let frame = 0; frame < 119; frame++) assert.equal(governor.record(19, frameMs), undefined);
  assert.equal(governor.record(19, frameMs), "full");
  // A frame at or above 0.6 × the frame duration restarts the count.
  for (let frame = 0; frame < 30; frame++) governor.record(45, frameMs);
  for (let frame = 0; frame < 100; frame++) governor.record(10, frameMs);
  governor.record(21, frameMs);
  for (let frame = 0; frame < 119; frame++) assert.equal(governor.record(10, frameMs), undefined);
  assert.equal(governor.record(10, frameMs), "full");
});
