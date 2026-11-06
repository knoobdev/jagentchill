// Pixel tests in headless Chromium: project document + scene + time → frame, for colour, image and graphic clips.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { near, startHarness, type Harness } from "./harness.ts";

let harness: Harness;
before(async () => { harness = await startHarness(); });
after(async () => { await harness?.close(); });

const expectNear = (actual: number[], expected: number[], label: string, tolerance = 2) => assert.ok(near(actual, expected, tolerance), `${label}: got ${actual}, expected ${expected}`);

test("Engine capability probe and ready handshake — engine.ready reports the backend, codecs and constraints of this runtime", async () => {
  const ready = await harness.page.evaluate(async () => {
    const { jc } = window;
    const opened = await jc.open(jc.project({ width: 320, height: 180 }), { width: 320, height: 180 });
    const canvases = opened.host.querySelectorAll("canvas").length, videos = document.querySelectorAll("video").length;
    return { ready: opened.ready(), canvases, videos };
  });
  console.log("engine.ready", JSON.stringify(ready.ready));
  assert.ok(["webgpu", "webgl2"].includes(ready.ready.backend));
  assert.equal(ready.ready.surface, "same-thread");
  assert.equal(ready.ready.protocolVersion, 1);
  assert.deepEqual([ready.ready.constraints.binarySink, ready.ready.constraints.cachePoolScale, ready.ready.constraints.timeEventsPerSecond], ["direct", 1, 30]);
  assert.equal(ready.canvases, 1, "exactly one canvas owned by the engine inside the host element");
  assert.equal(ready.videos, 0, "no <video> element is created by the engine");
});

test("Background nodes — a colour background fills the frame and a transparent one leaves alpha 0", async () => {
  const result = await harness.page.evaluate(async () => {
    const { jc } = window;
    const coloured = await jc.open(jc.project({ width: 320, height: 180 }, { kind: "color", color: "#204060" }), { width: 320, height: 180 });
    const a = (await coloured.frameAt(0)).at(160, 90);
    const transparent = await jc.open(jc.project({ width: 320, height: 180 }, { kind: "transparent" }), { width: 320, height: 180 });
    const b = (await transparent.frameAt(0)).at(160, 90);
    return { a, b };
  });
  expectNear(result.a, [0x20, 0x40, 0x60, 255], "colour background");
  assert.deepEqual(result.b, [0, 0, 0, 0], "transparent background");
});

test("Contain-fit, crop, flip and transform — an image clip is contain-fitted, positioned, scaled, rotated, flipped and cropped", async () => {
  const result = await harness.page.evaluate(async () => {
    const { jc } = window;
    // A 200×100 picture: left half red, right half blue, with a white 20×20 square in the top-left corner.
    const url = await jc.imageUrl(200, 100, (context) => {
      context.fillStyle = "#ff0000"; context.fillRect(0, 0, 100, 100);
      context.fillStyle = "#0000ff"; context.fillRect(100, 0, 100, 100);
      context.fillStyle = "#ffffff"; context.fillRect(0, 0, 20, 20);
    });
    const make = async (fields: Record<string, unknown>) => {
      const doc = jc.project({ width: 400, height: 400 }, { kind: "color", color: "#00ff00" });
      doc.media.assets.push(jc.asset("img", "image", { width: 200, height: 100 }));
      doc.scenes[0].tracks.main.elements.push(jc.element("image", { id: "e1", startTime: 0, duration: 120000, mediaId: "img", ...fields }));
      const opened = await jc.open(doc, { width: 400, height: 400 }, [{ assetId: "img", original: url }]);
      return opened.frameAt(0);
    };
    const plain = await make({});
    const moved = await make({ transform: { position: { x: 100, y: -100 }, scale: { x: 0.5, y: 0.5 }, rotation: 0 } });
    const rotated = await make({ transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 90 } });
    const flipped = await make({ flip: { horizontal: true, vertical: false } });
    const cropped = await make({ crop: { left: 0.5, top: 0, right: 0, bottom: 0 } });
    return {
      // Contain-fit: 200×100 in 400×400 → 400×200, centred: rows 100…299.
      plain: { above: plain.at(200, 50), red: plain.at(100, 200), blue: plain.at(300, 200), white: plain.at(10, 110), below: plain.at(200, 350) },
      // Scale 0.5 → 200×100 centred at (300, 100): x 200…399, y 50…149.
      moved: { red: moved.at(250, 100), blue: moved.at(350, 100), outside: moved.at(150, 100), under: moved.at(300, 160) },
      // Rotated 90° clockwise: the picture's left (red) half is now on top, and its width runs down the canvas.
      rotated: { top: rotated.at(200, 100), bottom: rotated.at(200, 300), side: rotated.at(50, 200) },
      flipped: { left: flipped.at(100, 200), right: flipped.at(300, 200), white: flipped.at(390, 110) },
      // Cropping the left half leaves the blue 100×100 region, contain-fitted to 400×400.
      cropped: { corner: cropped.at(20, 20), centre: cropped.at(200, 200), far: cropped.at(380, 380) },
    };
  });
  expectNear(result.plain.above, [0, 255, 0, 255], "background above the picture");
  expectNear(result.plain.red, [255, 0, 0, 255], "left half");
  expectNear(result.plain.blue, [0, 0, 255, 255], "right half");
  expectNear(result.plain.white, [255, 255, 255, 255], "top-left marker");
  expectNear(result.plain.below, [0, 255, 0, 255], "background below the picture");
  expectNear(result.moved.red, [255, 0, 0, 255], "moved: left half");
  expectNear(result.moved.blue, [0, 0, 255, 255], "moved: right half");
  expectNear(result.moved.outside, [0, 255, 0, 255], "moved: left of the picture");
  expectNear(result.moved.under, [0, 255, 0, 255], "moved: under the picture");
  expectNear(result.rotated.top, [255, 0, 0, 255], "rotated: top");
  expectNear(result.rotated.bottom, [0, 0, 255, 255], "rotated: bottom");
  expectNear(result.rotated.side, [0, 255, 0, 255], "rotated: beside the picture");
  expectNear(result.flipped.left, [0, 0, 255, 255], "flipped: left is now blue");
  expectNear(result.flipped.right, [255, 0, 0, 255], "flipped: right is now red");
  expectNear(result.flipped.white, [255, 255, 255, 255], "flipped: the marker moved to the top-right");
  for (const [name, pixel] of Object.entries(result.cropped)) expectNear(pixel, [0, 0, 255, 255], `cropped ${name}`);
});

test("Compositor algorithm — Two layers with opacity; Scene build order — Overlay stacking; Blend modes — Multiply and Screen", async () => {
  const result = await harness.page.evaluate(async () => {
    const { jc } = window;
    const solid = (color: string) => jc.imageUrl(64, 64, (context) => { context.fillStyle = color; context.fillRect(0, 0, 64, 64); });
    const sources = [{ assetId: "red", original: await solid("#ff0000") }, { assetId: "blue", original: await solid("#0000ff") }, { assetId: "grey", original: await solid("rgb(128,128,128)") }, { assetId: "base", original: await solid("rgb(200,100,50)") }];
    const doc = (overlays: { asset: string; fields: Record<string, unknown> }[], main: string) => {
      const out = jc.project({ width: 64, height: 64 });
      for (const source of sources) out.media.assets.push(jc.asset(source.assetId, "image", { width: 64, height: 64 }));
      out.scenes[0].tracks.main.elements.push(jc.element("image", { id: "m", startTime: 0, duration: 120000, mediaId: main }));
      // overlay[0] is the topmost track.
      out.scenes[0].tracks.overlay = overlays.map((overlay, index) => jc.track("video", `o${index}`, [jc.element("image", { id: `o${index}e`, startTime: 0, duration: 120000, mediaId: overlay.asset, ...overlay.fields })]));
      return out;
    };
    const centre = async (document: unknown) => (await (await jc.open(document, { width: 64, height: 64 }, sources)).frameAt(0)).at(32, 32);
    return {
      opacity: await centre(doc([{ asset: "blue", fields: { opacity: 0.5 } }], "red")),
      stacking: await centre(doc([{ asset: "blue", fields: {} }, { asset: "red", fields: {} }], "grey")),
      multiply: await centre(doc([{ asset: "grey", fields: { blendMode: "multiply" } }], "base")),
      screen: await centre(doc([{ asset: "grey", fields: { blendMode: "screen" } }], "base")),
    };
  });
  expectNear(result.opacity, [128, 0, 128, 255], "blue at 0.5 over red");
  expectNear(result.stacking, [0, 0, 255, 255], "overlay[0] is composited last");
  expectNear(result.multiply, [100, 50, 25, 255], "multiply");
  expectNear(result.screen, [228, 178, 153, 255], "screen");
});

test("Resolve pass — Keyframed opacity at the frame start; Element not yet started", async () => {
  const result = await harness.page.evaluate(async () => {
    const { jc } = window;
    const white = await jc.imageUrl(8, 8, (context) => { context.fillStyle = "#ffffff"; context.fillRect(0, 0, 8, 8); });
    const doc = jc.project({ width: 64, height: 64 });
    doc.media.assets.push(jc.asset("white", "image", { width: 8, height: 8 }));
    const key = (id: string, time: number, value: number) => ({ id, time, value, segmentToNext: "linear", tangentMode: "auto" });
    doc.scenes[0].tracks.main.elements.push(jc.element("image", {
      id: "e1", startTime: 120000, duration: 240000, mediaId: "white",
      animations: { opacity: { keys: [key("k0", 0, 0), key("k1", 120000, 1)], extrapolation: { before: "hold", after: "hold" } } },
    }));
    const opened = await jc.open(doc, { width: 64, height: 64 }, [{ assetId: "white", original: white }]);
    const out: Record<string, number[]> = {};
    // Clip times 0, 30 000, 60 000, 120 000 and one frame before the element starts.
    for (const [name, time] of [["before", 116000], ["start", 120000], ["quarter", 148000], ["half", 180000], ["full", 240000]] as const) out[name] = (await opened.frameAt(time)).at(32, 32);
    return out;
  });
  expectNear(result.before, [0, 0, 0, 255], "one frame before the start: invisible");
  expectNear(result.start, [0, 0, 0, 255], "opacity 0 at clip time 0");
  // Clip time 28 000 (frame 7 of the clip): opacity 28000 / 120000 = 0.2333 → 59 or 60.
  expectNear(result.quarter, [60, 60, 60, 255], "opacity at clip time 28 000");
  expectNear(result.half, [128, 128, 128, 255], "opacity 0.5 at clip time 60 000");
  expectNear(result.full, [255, 255, 255, 255], "opacity 1 from the second key on");
});
