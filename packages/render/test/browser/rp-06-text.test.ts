// Pixel tests in headless Chromium: text, captions, stickers and gradient backgrounds.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { near, startHarness, type Harness } from "./harness.ts";

let harness: Harness;
before(async () => { harness = await startHarness(); });
after(async () => { await harness?.close(); });
const expectNear = (actual: number[], expected: number[], label: string, tolerance = 2) => assert.ok(near(actual, expected, tolerance), `${label}: got ${actual}, expected ${expected}`);

test("Text and graphic rasterisation — text is drawn from glyph outlines of the loaded font, with fill, stroke, background and alignment; Engine-side text shaping — No browser text call; Unchanged text is not re-rasterised; layout.query equals the rasterised bounds", async () => {
  const result = await harness.page.evaluate(async (origin) => {
    const { jc } = window;
    // Any browser text call would throw.
    for (const name of ["fillText", "strokeText", "measureText"] as const) {
      (CanvasRenderingContext2D.prototype as any)[name] = () => { throw new Error(`${name} was called`); };
      (OffscreenCanvasRenderingContext2D.prototype as any)[name] = () => { throw new Error(`${name} was called`); };
    }
    const fonts = [{ fontId: "arimo-400", family: "Arimo", url: `${origin}/fixtures/fonts/Arimo-Regular.ttf`, weight: 400 }, { fontId: "arimo-700", family: "Arimo", url: `${origin}/fixtures/fonts/Arimo-Bold.ttf`, weight: 700 }];
    const make = async (fields: Record<string, unknown>, background = "#000000") => {
      const doc = jc.project({ width: 640, height: 360 }, { kind: "color", color: background });
      doc.scenes[0].tracks.overlay = [jc.track("text", "t0", [jc.element("text", { id: "t", startTime: 0, duration: 120000, content: "HI", fontFamily: "Arial", fontSize: 30, color: "#ffffff", ...fields })])];
      const opened = await jc.open(doc, { width: 640, height: 360 }, [], (port) => port.command("fonts.setSources", { fonts }));
      // The faces load asynchronously; the frame is rendered again when they arrive.
      await opened.engine.whenFontsSettled();
      await opened.frameAt(0);
      return opened;
    };
    const count = (frame: Awaited<ReturnType<Awaited<ReturnType<typeof make>>["frameAt"]>>, test: (pixel: number[]) => boolean, box = { x0: 0, y0: 0, x1: 640, y1: 360 }) => {
      let total = 0, minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
      for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) if (test(frame.at(x, y))) { total++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      return { total, minX, maxX, minY, maxY };
    };
    const white = (pixel: number[]) => pixel[0] > 200 && pixel[1] > 200 && pixel[2] > 200;
    const plain = await make({});
    const plainFrame = await plain.frameAt(0);
    const ink = count(plainFrame, white);
    const layout = await plain.port.command("layout.query", { elementIds: ["t"], time: 0 }) as { boxes: Record<string, { x: number; y: number; width: number; height: number }> };
    const uploads = plain.engine.counters.textureUpload;
    for (let frame = 1; frame <= 20; frame++) await plain.frameAt(frame * 4000);
    const uploadsAfter = plain.engine.counters.textureUpload;
    // Stroke: red outline pixels appear around the white fill.
    const stroked = await (await make({ stroke: { enabled: true, color: "#ff0000", width: 10, position: "outside" } })).frameAt(0);
    const red = count(stroked, (pixel) => pixel[0] > 200 && pixel[1] < 60 && pixel[2] < 60);
    const strokedInk = count(stroked, white);
    // Background box in blue behind the text.
    const boxed = await (await make({ background: { enabled: true, color: "#0000ff", cornerRadius: 0, paddingX: 30, paddingY: 42, offsetX: 0, offsetY: 0 } })).frameAt(0);
    const blue = count(boxed, (pixel) => pixel[2] > 200 && pixel[0] < 60);
    // Bold has more ink than regular; a moved, wider letter-spaced text spans more.
    const bold = count(await (await make({ fontWeight: 700 })).frameAt(0), white);
    const spaced = count(await (await make({ letterSpacing: 100 })).frameAt(0), white);
    // Two lines, left aligned in a fixed box, coloured by a keyframe-free gradient-less fill.
    const lines = await (await make({ content: "I\nIIIII", textAlign: "left", color: "#00ff00" }, "#000000")).frameAt(0);
    const green = (pixel: number[]) => pixel[1] > 200 && pixel[0] < 80;
    const topLine = count(lines, green, { x0: 0, y0: 0, x1: 640, y1: 180 }), bottomLine = count(lines, green, { x0: 0, y0: 180, x1: 640, y1: 360 });
    const diagnostics = plain.events.filter((event) => event.type === "diagnostic").map((event) => event.payload.id);
    return { ink, layout: layout.boxes.t, uploads, uploadsAfter, red, strokedInk, blue, bold, spaced, topLine, bottomLine, diagnostics, centre: plainFrame.at(320, 180) };
  }, harness.origin);
  // "HI" at fontSize 30 on a 360-px canvas is set at 120 px, centred on the canvas.
  assert.ok(result.ink.total > 3000, `the text has ink (${result.ink.total} px)`);
  assert.ok(Math.abs((result.ink.minX + result.ink.maxX) / 2 - 320) <= 6, `horizontally centred: ${result.ink.minX}…${result.ink.maxX}`);
  // Arimo's cap height is 1409 / 2048 em: 82.6 px at 120 px.
  assert.ok(Math.abs(result.ink.maxY - result.ink.minY + 1 - 82.6) <= 3, `cap height ${result.ink.maxY - result.ink.minY + 1} px`);
  assert.ok(result.ink.minY > 90 && result.ink.maxY < 270);
  // The reported box contains the ink and is the texture the text was rasterised into.
  assert.ok(result.layout.x <= result.ink.minX && result.layout.x + result.layout.width >= result.ink.maxX && result.layout.y <= result.ink.minY && result.layout.y + result.layout.height >= result.ink.maxY, JSON.stringify(result.layout));
  assert.equal(result.uploadsAfter, result.uploads, "a static text visible for 20 more frames is rasterised and uploaded once");
  assert.ok(result.red.total > 1500, `the stroke is drawn (${result.red.total} px)`);
  assert.ok(Math.abs(result.strokedInk.total - result.ink.total) < result.ink.total * 0.05, "an outside stroke does not erode the glyph shapes");
  assert.ok(result.red.minX < result.ink.minX && result.red.maxX > result.ink.maxX);
  assert.ok(result.blue.total > 10_000 && result.blue.minX < result.ink.minX - 5 && result.blue.maxY > result.ink.maxY + 5, "the background is a box around the text block");
  assert.ok(result.bold.total > result.ink.total * 1.15, `bold has more ink (${result.bold.total} vs ${result.ink.total})`);
  assert.ok(result.spaced.maxX - result.spaced.minX > result.ink.maxX - result.ink.minX + 100, "letter spacing of one font size widens the text by one size");
  assert.ok(result.topLine.total > 0 && result.bottomLine.total > result.topLine.total * 3, "two lines");
  assert.ok(Math.abs(result.topLine.minX - result.bottomLine.minX) <= 3, "left aligned lines share their left edge");
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(harness.errors, []);
});

test("Text and graphic rasterisation — a family without a face renders in the fallback chain with font/fallback; Caption nodes — Active word at a frame time; Captions excluded", async () => {
  const result = await harness.page.evaluate(async (origin) => {
    const { jc } = window;
    // Only the fallback family "Noto Sans" is available (served here by the Arimo test file).
    const fonts = [{ fontId: "fallback", family: "Noto Sans", url: `${origin}/fixtures/fonts/Arimo-Regular.ttf` }, { fontId: "broken", family: "Tinos", url: `${origin}/fixtures/fonts/absent.ttf` }];
    const doc = jc.project({ width: 640, height: 360 });
    doc.scenes[0].tracks.overlay = [
      jc.track("text", "t0", [jc.element("text", { id: "t", startTime: 0, duration: 240000, content: "AB", fontFamily: "Times New Roman", fontSize: 20, color: "#ffffff", transform: { position: { x: 0, y: -100 }, scale: { x: 1, y: 1 }, rotation: 0 } })]),
      jc.track("caption", "c0", [jc.element("caption", { id: "c", startTime: 0, duration: 240000, text: "one two three", words: [{ text: "one", start: 0, end: 48000 }, { text: "two", start: 48000, end: 108000 }, { text: "three", start: 108000, end: 180000 }] })],
        { caption: { style: { fontFamily: "sans-serif", fontSize: 8, color: "#ffffff", stroke: { enabled: false } }, highlight: { style: "color", color: "#ff0000", textColor: "#000000", scale: 1.2 } } }),
    ];
    const opened = await jc.open(doc, { width: 640, height: 360 }, [], (port) => port.command("fonts.setSources", { fonts }));
    await opened.engine.whenFontsSettled();
    const scan = async (time: number) => {
      const frame = await opened.frameAt(time);
      const red: number[] = [], white: number[] = [];
      for (let y = 250; y < 360; y++) for (let x = 0; x < 640; x++) { const pixel = frame.at(x, y); if (pixel[0] > 200 && pixel[1] < 80) red.push(x); else if (pixel[0] > 200 && pixel[1] > 200) white.push(x); }
      let top = 0;
      for (let y = 0; y < 160; y++) for (let x = 0; x < 640; x++) if (frame.at(x, y)[0] > 200) top++;
      const span = (list: number[]) => (list.length ? [Math.min(...list), Math.max(...list)] : null);
      return { red: span(red), white: span(white), top, whiteCount: white.length, redCount: red.length };
    };
    // 500 ms: the second word is active.
    const second = await scan(60000), first = await scan(4000);
    const diagnostics = opened.events.filter((event) => event.type === "diagnostic").map((event) => [event.payload.id, event.payload.elementId, event.payload.details?.family]);
    // A still without captions.
    const stills: Uint8Array[] = [];
    opened.port.on("still.done", (_payload, transfer) => { stills.push(new Uint8Array(transfer![0])); });
    await opened.port.command("still.render", { requestId: "s1", time: 60000, includeCaptions: false });
    await opened.waitFor("still.done");
    const bitmap = await createImageBitmap(new Blob([stills[0] as BlobPart], { type: "image/png" }));
    const canvas = new OffscreenCanvas(640, 360);
    const context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 250, 640, 110).data;
    let captionPixels = 0;
    for (let index = 0; index < data.length; index += 4) if (data[index] > 100) captionPixels++;
    return { second, first, diagnostics, captionPixels };
  }, harness.origin);
  assert.ok(result.second.top > 500, "the text is drawn in the fallback family");
  assert.deepEqual(result.diagnostics, [["font/fallback", "t", "Tinos"]], "one font/fallback diagnostic names the element");
  // At 500 ms the second word is red, between the white first and third words.
  assert.ok(result.second.red && result.second.white, JSON.stringify(result.second));
  assert.ok(result.second.red![0] > result.second.white![0] + 20 && result.second.red![1] < result.second.white![1] - 20, `the active word is the middle one: ${JSON.stringify(result.second)}`);
  // At 33 ms the first word is the active one.
  assert.ok(result.first.red![0] < result.first.white![0], `the first word is active: ${JSON.stringify(result.first)}`);
  assert.equal(result.captionPixels, 0, "a render with includeCaptions false contains no caption pixels");
});

test("Background nodes — a gradient background is rasterised by the engine; Scene node types — a sticker is drawn at its intrinsic size and re-rasterised when it grows; Image and sticker caches — Sticker sharpness when scaled up; a missing sticker is reported", async () => {
  const result = await harness.page.evaluate(async () => {
    const { jc } = window;
    const svg = URL.createObjectURL(new Blob(["<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' width='100' height='100'><circle cx='50' cy='50' r='50' fill='#ff0000'/></svg>"], { type: "image/svg+xml" }));
    const make = (scale: number) => {
      const doc = jc.project({ width: 800, height: 800 }, { kind: "gradient", css: "conic-gradient(red, blue), linear-gradient(90deg, #000000 0%, #ffffff 100%)" });
      doc.scenes[0].tracks.overlay = [jc.track("graphic", "g0", [
        jc.element("sticker", { id: "s", startTime: 0, duration: 120000, stickerId: "shapes:dot", intrinsicWidth: 180, intrinsicHeight: 180, transform: { position: { x: 0, y: 0 }, scale: { x: scale, y: scale }, rotation: 0 } }),
        jc.element("sticker", { id: "gone", startTime: 0, duration: 120000, stickerId: "icons:lost", intrinsicWidth: 100, intrinsicHeight: 100 }),
      ])];
      return doc;
    };
    const run = async (scale: number) => {
      const opened = await jc.open(make(scale), { width: 800, height: 800 }, [], (port) => port.command("derived.setSources", { entries: [{ key: "shapes:dot", kind: "sticker", url: svg, sha256: "ab".repeat(32) }] }));
      const frame = await opened.frameAt(0);
      // Width of the edge of the disc along the row through its centre: the number of partly covered pixels.
      let edge = 0, reds = 0;
      for (let x = 0; x < 800; x++) { const pixel = frame.at(x, 400); const redness = pixel[0] - pixel[2]; if (redness > 200) reds++; }
      for (let x = 0; x < 400; x++) { const pixel = frame.at(x, 400); const cover = (pixel[0] - pixel[1]) / 255; if (cover > 0.15 && cover < 0.85 && frame.at(x + 6, 400)[1] < 30) edge++; }
      return { opened, frame, reds, edge };
    };
    const small = await run(1), large = await run(700 / 180);
    const diagnostics = small.opened.events.filter((event) => event.type === "diagnostic").map((event) => [event.payload.id, event.payload.details?.key ?? ""]);
    return {
      gradient: [small.frame.at(4, 100), small.frame.at(400, 100), small.frame.at(796, 100)], smallReds: small.reds, largeReds: large.reds, largeEdge: large.edge, centre: small.frame.at(400, 400), diagnostics,
      uploads: [small.opened.engine.counters.textureUploadPixels, large.opened.engine.counters.textureUploadPixels],
    };
  });
  expectNear(result.gradient[0], [1, 1, 1, 255], "gradient left", 3);
  expectNear(result.gradient[1], [128, 128, 128, 255], "gradient middle", 3);
  expectNear(result.gradient[2], [254, 254, 254, 255], "gradient right", 3);
  expectNear(result.centre, [255, 0, 0, 255], "the sticker");
  assert.ok(Math.abs(result.smallReds - 180) <= 3, `the sticker is 180 px wide (${result.smallReds})`);
  assert.ok(Math.abs(result.largeReds - 700) <= 4, `scaled to 700 px (${result.largeReds})`);
  // Displayed at 700 px the sticker is rasterised at 1 024 px, not enlarged from 256 px: its edge stays about a pixel wide.
  assert.ok(result.largeEdge <= 2, `the enlarged sticker has a sharp edge (${result.largeEdge} px)`);
  assert.ok(result.uploads[1] - result.uploads[0] > 900_000, "re-rasterised at the next power of two");
  assert.deepEqual(result.diagnostics.sort(), [["derived/unavailable", "icons:lost"], ["scene/background-layer-skipped", ""]]);
});
