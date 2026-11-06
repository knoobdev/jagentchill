// Pixel tests in headless Chromium: masks, effects, transitions, keying, compound clips, scene effects, the surface.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { near, startHarness, type Harness } from "./harness.ts";

let harness: Harness;
before(async () => { harness = await startHarness(); });
after(async () => { await harness?.close(); });
const expectNear = (actual: number[], expected: number[], label: string, tolerance = 2) => assert.ok(near(actual, expected, tolerance), `${label}: got ${actual}, expected ${expected}`);

test("Multi-mask compositing with feather — Single rectangle mask; Subtract combination; Intersect uses the minimum; Exclude combination; Mask opacity; Feather width", async () => {
  const result = await harness.page.evaluate(async () => {
    const { jc } = window;
    const white = await jc.imageUrl(8, 8, (context) => { context.fillStyle = "#ffffff"; context.fillRect(0, 0, 8, 8); });
    const render = async (masks: Record<string, unknown>[], size = 200) => {
      const doc = jc.project({ width: size, height: size }, { kind: "transparent" });
      doc.media.assets.push(jc.asset("w", "image", { width: 8, height: 8 }));
      doc.scenes[0].tracks.main.elements.push(jc.element("image", { id: "e1", startTime: 0, duration: 120000, mediaId: "w", masks: masks.map((mask, index) => ({ id: `m${index}`, enabled: true, combine: "add", ...mask })) }));
      return (await jc.open(doc, { width: size, height: size }, [{ assetId: "w", original: white }])).frameAt(0);
    };
    const rect = (params: Record<string, unknown>, fields: Record<string, unknown> = {}) => ({ type: "rectangle", params, ...fields });
    const single = await render([rect({ width: 0.5, height: 0.5 })]);
    // A rectangle minus an ellipse inside it.
    const subtract = await render([rect({ width: 0.8, height: 0.8 }), { type: "ellipse", combine: "subtract", params: { width: 0.4, height: 0.4 } }]);
    // Two overlapping masks of coverage 0.5 each.
    const intersect = await render([rect({ width: 0.8, height: 0.8, opacity: 50 }, { combine: "intersect" }), rect({ width: 0.8, height: 0.8, opacity: 50 }, { combine: "intersect" })]);
    // Left and right rectangles overlapping in the middle.
    const exclude = await render([rect({ width: 0.5, height: 0.5, centerX: -0.25 }), rect({ width: 0.5, height: 0.5, centerX: 0.25 }, { combine: "exclude" })]);
    const opacity = await render([rect({ width: 0.5, height: 0.5, opacity: 50 })]);
    // Feather 40 px at a 1920-px long side: rendered on a 1920-wide canvas, alpha rises across a 40 px band on the edge.
    const doc = jc.project({ width: 1920, height: 200 }, { kind: "transparent" });
    doc.media.assets.push(jc.asset("w", "image", { width: 8, height: 8 }));
    doc.scenes[0].tracks.main.elements.push(jc.element("image", { id: "e1", startTime: 0, duration: 120000, mediaId: "w", transform: { position: { x: 0, y: 0 }, scale: { x: 9.6, y: 1 }, rotation: 0 }, masks: [{ id: "m", type: "rectangle", enabled: true, combine: "add", params: { width: 4, height: 4, feather: 40, centerX: 0.2291667 } }] }));
    const feathered = await (await jc.open(doc, { width: 1920, height: 200 }, [{ assetId: "w", original: white }])).frameAt(0);
    const profile: number[] = [];
    for (let x = 720; x < 840; x++) profile.push(feathered.at(x, 100)[3]);
    return {
      single: { inside: single.at(100, 100), outside: single.at(20, 20), edgeIn: single.at(52, 100), edgeOut: single.at(47, 100) },
      subtract: { ring: subtract.at(30, 100), hole: subtract.at(100, 100), outside: subtract.at(5, 5) },
      intersect: intersect.at(100, 100),
      exclude: { leftOnly: exclude.at(40, 100), both: exclude.at(100, 100), rightOnly: exclude.at(160, 100), neither: exclude.at(100, 20) },
      opacity: { inside: opacity.at(100, 100), outside: opacity.at(20, 20) },
      profile,
    };
  });
  assert.equal(result.single.inside[3], 255);
  assert.equal(result.single.outside[3], 0);
  assert.equal(result.single.edgeIn[3], 255);
  assert.equal(result.single.edgeOut[3], 0);
  assert.equal(result.subtract.ring[3], 255, "visible inside the rectangle");
  assert.equal(result.subtract.hole[3], 0, "except inside the ellipse");
  assert.equal(result.subtract.outside[3], 0);
  expectNear([result.intersect[3]], [128], "intersect of 0.5 and 0.5 is 0.5, not 0.25");
  assert.deepEqual([result.exclude.leftOnly[3], result.exclude.both[3], result.exclude.rightOnly[3], result.exclude.neither[3]], [255, 0, 255, 0]);
  expectNear([result.opacity.inside[3]], [128], "mask opacity 0.5");
  assert.equal(result.opacity.outside[3], 0);
  // The feathered edge sits at x = 780. Coverage is smoothstep(−20, +20, d): it is 0 and 255 at the ends of the
  // 40 px band, a half at the edge, monotonic in between, and its 10–90 % rise spans 0.6084 of the band.
  const profile = result.profile;
  assert.ok(profile.every((alpha, index) => index === 0 || alpha >= profile[index - 1]), "monotonic");
  assert.deepEqual([profile[40 - 2], profile[80 + 2]], [0, 255], `0 and 255 outside the band: ${profile.join(",")}`);
  const cross = (level: number) => { const index = profile.findIndex((alpha) => alpha >= level); return index - (profile[index] - level) / (profile[index] - profile[index - 1]); };
  assert.ok(Math.abs(cross(127.5) - 60) <= 1, `the half point is on the edge: ${cross(127.5) + 720}`);
  const band = (cross(229.5) - cross(25.5)) / 0.6084;
  assert.ok(Math.abs(band - 40) <= 2, `feather band ${band.toFixed(1)} px`);
});

test("Per-layer stage order — Mask is applied after effects; Transform precedes effects; Compositor algorithm — Scene effect ordering; Adjustment and effect layer nodes — layers above are not affected", async () => {
  const result = await harness.page.evaluate(async () => {
    const { jc } = window;
    // A black-to-white vertical step edge.
    const edge = await jc.imageUrl(200, 200, (context) => { context.fillStyle = "#000000"; context.fillRect(0, 0, 100, 200); context.fillStyle = "#ffffff"; context.fillRect(100, 0, 100, 200); });
    const blur = { id: "fx", type: "blur", kind: "effect", enabled: true, params: { intensity: 100 } };
    const sources = [{ assetId: "edge", original: edge }];
    const base = (elementFields: Record<string, unknown>) => {
      const doc = jc.project({ width: 1920, height: 1920 }, { kind: "transparent" });
      doc.media.assets.push(jc.asset("edge", "image", { width: 200, height: 200 }));
      doc.scenes[0].tracks.main.elements.push(jc.element("image", { id: "e1", startTime: 0, duration: 120000, mediaId: "edge", ...elementFields }));
      return doc;
    };
    const row = (frame: Awaited<ReturnType<Awaited<ReturnType<typeof jc.open>>["frameAt"]>>, y: number, from: number, to: number, channel = 0) => { const out: number[] = []; for (let x = from; x < to; x++) out.push(frame.at(x, y)[channel]); return out; };
    // Blur (sigma 40 px) with an ellipse mask: blurred inside, a sharp mask edge.
    const masked = await (await jc.open(base({ effects: [blur], masks: [{ id: "m", type: "ellipse", enabled: true, combine: "add", params: { width: 0.5, height: 0.5 } }] }), { width: 1920, height: 1920 }, sources)).frameAt(0);
    const full = await (await jc.open(base({ effects: [blur] }), { width: 1920, height: 1920 }, sources)).frameAt(0);
    const half = await (await jc.open(base({ effects: [blur], transform: { position: { x: 0, y: 0 }, scale: { x: 0.5, y: 0.5 }, rotation: 0 } }), { width: 1920, height: 1920 }, sources)).frameAt(0);
    // [layer A, sceneEffect blur, layer B]: an effect element between two clips.
    const doc = base({});
    doc.scenes[0].tracks.overlay = [
      jc.track("video", "top", [jc.element("image", { id: "b", startTime: 0, duration: 120000, mediaId: "edge", transform: { position: { x: 0, y: -600 }, scale: { x: 0.25, y: 0.25 }, rotation: 0 } })]),
      jc.track("effect", "fx", [jc.element("effect", { id: "f", startTime: 0, duration: 60000, effects: [blur] })]),
    ];
    const opened = await jc.open(doc, { width: 1920, height: 1920 }, sources);
    const during = await opened.frameAt(0), afterEffect = await opened.frameAt(60000);
    return {
      maskEdge: row(masked, 960, 470, 490, 3), insideGrey: masked.at(960, 960),
      fullRow: row(full, 960, 760, 1160), halfRow: row(half, 960, 760, 1160),
      sceneA: row(during, 1400, 760, 1160), sceneB: row(during, 360, 940, 980), sceneAfter: row(afterEffect, 1400, 760, 1160),
    };
  });
  // The ellipse edge at x = 480: alpha jumps from 0 to 255 within a few pixels although the content is blurred.
  const jump = result.maskEdge.filter((alpha) => alpha > 5 && alpha < 250).length;
  assert.ok(jump <= 3, `mask edge is sharp: ${result.maskEdge.join(",")}`);
  assert.ok(result.insideGrey[0] > 90 && result.insideGrey[0] < 165, `the content inside the ellipse is blurred: ${result.insideGrey}`);
  // 10–90 % rise distance of the blurred edge at scale 1 and at scale 0.5: equal within ±2 px.
  const rise = (values: number[]) => values.findIndex((value) => value >= 229.5) - values.findIndex((value) => value >= 25.5);
  assert.ok(Math.abs(rise(result.fullRow) - rise(result.halfRow)) <= 2, `rise ${rise(result.fullRow)} px at 100 %, ${rise(result.halfRow)} px at 50 %`);
  // Intensity 100 (the top of its range) is sigma 20: the 10–90 % distance of a Gaussian-blurred step is 2.563 σ = 51.3 px.
  assert.ok(Math.abs(rise(result.fullRow) - 51.3) <= 4, `rise ${rise(result.fullRow)} px for sigma 20`);
  // A is blurred by the scene effect, B (above it) is sharp, and after the effect element ends A is sharp again.
  assert.ok(rise(result.sceneA) > 40, `A is blurred: rise ${rise(result.sceneA)}`);
  assert.ok(result.sceneB.filter((value) => value > 10 && value < 245).length <= 2, `B is sharp: ${result.sceneB.join(",")}`);
  // The 200-px source is enlarged 9.6 times, so its own edge is about ten pixels wide; a blurred one is a hundred.
  assert.ok(rise(result.sceneAfter) < 20, `outside the element time range no scene effect is emitted: rise ${rise(result.sceneAfter)}`);
});

test("Transition nodes — Midpoint of a cross-dissolve; Transition alpha and blend rule — Dissolve of a half-frame overlay does not darken; Dissolve from a clip to nothing; Dip to black on an overlay covers only the clips; Background nodes — Backgrounds travel with their clips through a slide; Unknown transition shader", async () => {
  const result = await harness.page.evaluate(async () => {
    const { jc } = window;
    const solid = (color: string) => jc.imageUrl(16, 16, (context) => { context.fillStyle = color; context.fillRect(0, 0, 16, 16); });
    const sources = [{ assetId: "red", original: await solid("#ff0000") }, { assetId: "blue", original: await solid("#0000ff") }, { assetId: "white", original: await solid("#ffffff") }, { assetId: "green", original: await solid("#00ff00") }];
    const transition = (type: string, fields: Record<string, unknown> = {}) => ({ id: "t1", kind: "transition", fromElementId: "A", toElementId: "B", duration: 120000, shape: "equal-power", type, params: {}, easing: "linear", audioCrossfade: true, ...fields });
    const pair = (a: Record<string, unknown>, b: Record<string, unknown>) => [
      jc.element("image", { id: "A", startTime: 0, duration: 120000, transitionOut: "t1", ...a }), jc.element("image", { id: "B", startTime: 120000, duration: 120000, transitionIn: "t1", ...b }),
    ];
    const make = (background: unknown) => {
      const doc = jc.project({ width: 200, height: 200 }, background);
      for (const source of sources) doc.media.assets.push(jc.asset(source.assetId, "image", { width: 16, height: 16 }));
      return doc;
    };
    const open = (doc: unknown) => jc.open(doc, { width: 200, height: 200 }, sources);
    // 1. Red → blue cross-dissolve on the main track, window [60 000, 180 000).
    const main = make({ kind: "color", color: "#000000" });
    main.scenes[0].tracks.main.elements.push(...pair({ mediaId: "red" }, { mediaId: "blue" }));
    main.scenes[0].tracks.main.transitions = [transition("cross-dissolve")];
    const mainOpened = await open(main);
    const midpoint = (await mainOpened.frameAt(120000)).at(100, 100), before = (await mainOpened.frameAt(56000)).at(100, 100), quarter = (await mainOpened.frameAt(88000)).at(100, 100);
    // 2. Two white overlays covering the left half, dissolved over a white main clip.
    const halfFrame = { transform: { position: { x: -50, y: 0 }, scale: { x: 0.5, y: 1 }, rotation: 0 }, mediaId: "white" };
    const overlay = make({ kind: "color", color: "#000000" });
    overlay.scenes[0].tracks.main.elements.push(jc.element("image", { id: "M", startTime: 0, duration: 240000, mediaId: "white" }));
    overlay.scenes[0].tracks.overlay = [jc.track("video", "o0", pair(halfFrame, halfFrame), { transitions: [transition("cross-dissolve")] })];
    const overlayFrame = await (await open(overlay)).frameAt(120000);
    const whites = [overlayFrame.at(50, 100), overlayFrame.at(99, 100), overlayFrame.at(100, 100), overlayFrame.at(150, 100)];
    // 3. A full red overlay dissolving to an overlay that covers only the right half, at progress 0.25, over nothing.
    const toNothing = make({ kind: "transparent" });
    toNothing.scenes[0].tracks.overlay = [jc.track("video", "o0", pair({ mediaId: "red" }, { mediaId: "blue", transform: { position: { x: 50, y: 0 }, scale: { x: 0.5, y: 1 }, rotation: 0 } }), { transitions: [transition("cross-dissolve")] })];
    const fading = (await (await open(toNothing)).frameAt(88000)).at(50, 100);
    // 4. Dip to black between two overlays that cover the centre quarter, over a green main clip.
    const centre = { transform: { position: { x: 0, y: 0 }, scale: { x: 0.5, y: 0.5 }, rotation: 0 } };
    const dip = make({ kind: "color", color: "#000000" });
    dip.scenes[0].tracks.main.elements.push(jc.element("image", { id: "M", startTime: 0, duration: 240000, mediaId: "green" }));
    dip.scenes[0].tracks.overlay = [jc.track("video", "o0", pair({ mediaId: "red", ...centre }, { mediaId: "blue", ...centre }), { transitions: [transition("dip-to-black")] })];
    const dipFrame = await (await open(dip)).frameAt(120000);
    // 5. A slide between two contain-fitted clips with red and blue backgrounds: every pixel is one picture or the other.
    const narrow = { transform: { position: { x: 0, y: 0 }, scale: { x: 0.5, y: 0.5 }, rotation: 0 } };
    const slide = make({ kind: "color", color: "#000000" });
    slide.scenes[0].tracks.main.elements.push(...pair({ mediaId: "white", background: { kind: "color", color: "#ff0000" }, ...narrow }, { mediaId: "green", background: { kind: "color", color: "#0000ff" }, ...narrow }));
    slide.scenes[0].tracks.main.transitions = [transition("slide", { params: { direction: "left" } })];
    const slideFrame = await (await open(slide)).frameAt(120000);
    const colours = new Set<string>();
    for (let x = 4; x < 200; x += 7) for (let y = 4; y < 200; y += 7) colours.add(slideFrame.at(x, y).join(","));
    // 6. An unknown transition id renders as a linear cross-dissolve and says so.
    const unknown = make({ kind: "color", color: "#000000" });
    unknown.scenes[0].tracks.main.elements.push(...pair({ mediaId: "red" }, { mediaId: "blue" }));
    unknown.scenes[0].tracks.main.transitions = [transition("does-not-exist")];
    const unknownOpened = await open(unknown);
    const unknownPixel = (await unknownOpened.frameAt(120000)).at(100, 100);
    await unknownOpened.frameAt(124000);
    const diagnostics = unknownOpened.events.filter((event) => event.type === "diagnostic").map((event) => event.payload.id);
    return { midpoint, before, quarter, whites, fading, dip: { centre: dipFrame.at(100, 100), outside: dipFrame.at(20, 20) }, colours: [...colours], unknownPixel, diagnostics };
  });
  expectNear(result.midpoint, [128, 0, 128, 255], "midpoint of a cross-dissolve");
  expectNear(result.before, [255, 0, 0, 255], "frame before the window");
  expectNear(result.quarter, [196, 0, 59, 255], "progress 0.2333");
  for (const pixel of result.whites) expectNear(pixel, [255, 255, 255, 255], "no grey edge or area", 1);
  expectNear(result.fading, [255, 0, 0, 196], "red with alpha 1 − 0.2333, not a darkened red", 3);
  expectNear(result.dip.centre, [0, 0, 0, 255], "the centre quarter is black at the midpoint");
  expectNear(result.dip.outside, [0, 255, 0, 255], "the rest shows the layers beneath");
  for (const colour of result.colours) assert.ok(["255,0,0,255", "0,0,255,255", "255,255,255,255", "0,255,0,255"].includes(colour), `no pixel blends the two backgrounds: ${colour}`);
  assert.ok(result.colours.includes("255,0,0,255") && result.colours.includes("0,0,255,255"));
  expectNear(result.unknownPixel, [128, 0, 128, 255], "unknown transition falls back to a cross-dissolve");
  // Two frames of the window were rendered: each diagnostic is emitted once per scene revision. The clips are images
  // without handle material, so each side is also reported as held.
  assert.deepEqual(result.diagnostics.sort(), ["scene/transition-held-frame", "shader/unknown-transition"]);
  assert.deepEqual(harness.errors, []);
});

test("Chroma key and matte stages — Key out pure green; Strength zero; Compound clip nodes — Compound of overlay elements does not hide the main track; graphics are rasterised", async () => {
  const result = await harness.page.evaluate(async () => {
    const { jc } = window;
    const screen = await jc.imageUrl(100, 100, (context) => { context.fillStyle = "#00ff00"; context.fillRect(0, 0, 100, 100); context.fillStyle = "#ff0000"; context.fillRect(30, 30, 40, 40); context.fillStyle = "#00fa00"; context.fillRect(0, 0, 10, 10); });
    const blue = await jc.imageUrl(8, 8, (context) => { context.fillStyle = "#0000ff"; context.fillRect(0, 0, 8, 8); });
    const sources = [{ assetId: "screen", original: screen }, { assetId: "blue", original: blue }];
    const keyed = async (chromaKey: Record<string, unknown>) => {
      const doc = jc.project({ width: 100, height: 100 }, { kind: "transparent" });
      doc.media.assets.push(jc.asset("screen", "image", { width: 100, height: 100 }));
      doc.scenes[0].tracks.main.elements.push(jc.element("image", { id: "e1", startTime: 0, duration: 120000, mediaId: "screen", chromaKey: { enabled: true, color: "#00ff00", shadow: 0, spill: 0, ...chromaKey } }));
      return (await jc.open(doc, { width: 100, height: 100 }, sources)).frameAt(0);
    };
    const standard = await keyed({ strength: 40, edge: 10 }), exact = await keyed({ strength: 0, edge: 0 });
    // A compound scene holding only a graphic, placed on an overlay above a blue main clip.
    const doc = jc.project({ width: 200, height: 200 });
    doc.media.assets.push(jc.asset("blue", "image", { width: 8, height: 8 }));
    doc.scenes[0].tracks.main.elements.push(jc.element("image", { id: "M", startTime: 0, duration: 120000, mediaId: "blue" }));
    const inner = JSON.parse(JSON.stringify(doc.scenes[0]));
    inner.id = "s2"; inner.isMain = false; inner.kind = "compound"; inner.tracks.main.elements = [];
    inner.tracks.overlay = [jc.track("graphic", "g", [jc.element("graphic", { id: "G", startTime: 0, duration: 120000, definitionId: "ellipse", params: { fill: "#ffff00", stroke: "#000000", strokeWidth: 0, strokeAlign: "center" }, transform: { position: { x: 0, y: 0 }, scale: { x: 0.5, y: 0.5 }, rotation: 0 } })])];
    doc.scenes.push(inner);
    doc.scenes[0].tracks.overlay = [jc.track("video", "o0", [jc.element("compound", { id: "C", startTime: 0, duration: 120000, sceneId: "s2", sourceDuration: 120000 })])];
    const opened = await jc.open(doc, { width: 200, height: 200 }, sources);
    const compound = await opened.frameAt(0);
    const layout = await opened.port.command("layout.query", { elementIds: ["M", "C", "nope"], time: 0 });
    return {
      standard: { green: standard.at(80, 80), red: standard.at(50, 50), near: standard.at(5, 5) }, exact: { green: exact.at(80, 80), near: exact.at(5, 5), red: exact.at(50, 50) },
      compound: { centre: compound.at(100, 100), corner: compound.at(10, 10), edge: compound.at(100, 55) }, layout,
    };
  });
  assert.equal(result.standard.green[3], 0, "green pixels have alpha 0");
  expectNear(result.standard.red, [255, 0, 0, 255], "the red square has alpha 255");
  assert.equal(result.standard.near[3], 0, "a near-green is inside the key at strength 40");
  assert.equal(result.exact.green[3], 0, "the key colour itself is transparent at strength 0");
  assert.equal(result.exact.near[3], 255, "only the exact key colour becomes transparent at strength 0");
  assert.equal(result.exact.red[3], 255);
  expectNear(result.compound.centre, [255, 255, 0, 255], "the graphic of the compound scene");
  expectNear(result.compound.corner, [0, 0, 255, 255], "the compound is transparent where its elements do not draw");
  expectNear(result.compound.edge, [255, 255, 0, 255], "an ellipse of 100 px diameter");
  assert.deepEqual(result.layout, { boxes: { M: { x: 0, y: 0, width: 200, height: 200, rotation: 0 }, C: { x: 0, y: 0, width: 200, height: 200, rotation: 0 } } });
});

test("Blend modes — Every mode matches its formula; Unknown blend id; Compositor algorithm — Alpha accumulates over a transparent clear", async () => {
  const result = await harness.page.evaluate(async () => {
    const { jc } = window;
    const sourcesColours = [[255, 128, 0], [64, 64, 64], [10, 200, 250]], backdrops = [[200, 100, 50], [30, 30, 220]];
    const css = (rgb: number[]) => `rgb(${rgb.join(",")})`;
    // One strip image per layer: six 10-px columns, a source colour over each backdrop.
    const strip = (pick: (index: number) => number[]) => jc.imageUrl(60, 20, (context) => { for (let index = 0; index < 6; index++) { context.fillStyle = css(pick(index)); context.fillRect(index * 10, 0, 10, 20); } });
    const sources = [{ assetId: "backdrop", original: await strip((index) => backdrops[index % 2]) }, { assetId: "source", original: await strip((index) => sourcesColours[Math.floor(index / 2)]) }, { assetId: "white", original: await strip(() => [255, 255, 255]) }];
    const out: Record<string, number[][]> = {};
    for (const mode of [...jc.BLEND_MODE_IDS, "linear-light"]) {
      const doc = jc.project({ width: 60, height: 20 });
      for (const source of sources) doc.media.assets.push(jc.asset(source.assetId, "image", { width: 60, height: 20 }));
      doc.scenes[0].tracks.main.elements.push(jc.element("image", { id: "b", startTime: 0, duration: 120000, mediaId: "backdrop" }));
      const top = jc.element("image", { id: "s", startTime: 0, duration: 120000, mediaId: "source" });
      top.blendMode = mode;
      doc.scenes[0].tracks.overlay = [jc.track("video", "o0", [top])];
      const opened = await jc.open(doc, { width: 60, height: 20 }, sources);
      const frame = await opened.frameAt(0);
      out[mode] = [0, 1, 2, 3, 4, 5].map((index) => frame.at(index * 10 + 5, 5).slice(0, 3));
      if (mode === "linear-light") out.diagnostics = [opened.events.filter((event) => event.type === "diagnostic").map((event) => event.payload.id) as never];
    }
    const doc = jc.project({ width: 60, height: 20 }, { kind: "transparent" });
    doc.media.assets.push(jc.asset("white", "image", { width: 60, height: 20 }));
    doc.scenes[0].tracks.main.elements.push(jc.element("image", { id: "w", startTime: 0, duration: 120000, mediaId: "white", opacity: 0.5 }));
    const accumulate = (await (await jc.open(doc, { width: 60, height: 20 }, sources)).frameAt(0)).at(30, 5);
    return { out, accumulate, modes: jc.BLEND_MODE_IDS, sourcesColours, backdrops };
  });
  // The formulas of catalog.md "Blend formulas", on gamma-encoded values.
  const lum = (c: number[]) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  const sat = (c: number[]) => Math.max(...c) - Math.min(...c);
  const clip = (c: number[]) => { const l = lum(c), n = Math.min(...c), x = Math.max(...c); let out = c; if (n < 0) out = out.map((v) => l + ((v - l) * l) / (l - n)); if (x > 1) out = out.map((v) => l + ((v - l) * (1 - l)) / (x - l)); return out; };
  const setLum = (c: number[], l: number) => clip(c.map((v) => v + l - lum(c)));
  const setSat = (c: number[], s: number) => { const max = Math.max(...c), min = Math.min(...c); return max <= min ? [0, 0, 0] : c.map((v) => ((v - min) * s) / (max - min)); };
  const hard = (cb: number, cs: number) => (cs <= 0.5 ? cb * 2 * cs : cb + (2 * cs - 1) - cb * (2 * cs - 1));
  const separable: Record<string, (cb: number, cs: number) => number> = {
    normal: (_cb, cs) => cs, darken: Math.min, multiply: (cb, cs) => cb * cs,
    "color-burn": (cb, cs) => (cb === 1 ? 1 : cs === 0 ? 0 : 1 - Math.min(1, (1 - cb) / cs)), lighten: Math.max, screen: (cb, cs) => cb + cs - cb * cs,
    "plus-lighter": (cb, cs) => Math.min(1, cb + cs), "color-dodge": (cb, cs) => (cb === 0 ? 0 : cs === 1 ? 1 : Math.min(1, cb / (1 - cs))),
    overlay: (cb, cs) => hard(cs, cb),
    "soft-light": (cb, cs) => (cs <= 0.5 ? cb - (1 - 2 * cs) * cb * (1 - cb) : cb + (2 * cs - 1) * ((cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb)) - cb)),
    "hard-light": hard, difference: (cb, cs) => Math.abs(cb - cs), exclusion: (cb, cs) => cb + cs - 2 * cb * cs,
  };
  const blend = (mode: string, cb: number[], cs: number[]): number[] => {
    if (mode === "hue") return setLum(setSat(cs, sat(cb)), lum(cb));
    if (mode === "saturation") return setLum(setSat(cb, sat(cs)), lum(cb));
    if (mode === "color") return setLum(cs, lum(cb));
    if (mode === "luminosity") return setLum(cb, lum(cs));
    return cb.map((value, channel) => separable[mode](value, cs[channel]));
  };
  assert.equal(result.modes.length, 17);
  let checked = 0;
  for (const mode of result.modes) {
    for (let index = 0; index < 6; index++) {
      const cb = result.backdrops[index % 2].map((value) => value / 255), cs = result.sourcesColours[Math.floor(index / 2)].map((value) => value / 255);
      const expected = blend(mode, cb, cs).map((value) => Math.round(Math.min(Math.max(value, 0), 1) * 255));
      expectNear(result.out[mode][index], expected, `${mode} of ${result.sourcesColours[Math.floor(index / 2)]} over ${result.backdrops[index % 2]}`);
      checked++;
    }
  }
  assert.equal(checked, 102);
  assert.deepEqual(result.out["linear-light"], result.out.normal, "an unknown blend id composites with normal");
  assert.deepEqual(result.out.diagnostics[0], ["blend/unknown"]);
  expectNear(result.accumulate, [255, 255, 255, 128], "white at opacity 0.5 over a transparent clear");
});
