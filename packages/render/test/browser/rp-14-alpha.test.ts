// Pixel tests in headless Chromium: one alpha convention (straight) from a canvas-made texture to the composite, on WebGPU / the default backend and on WebGL2.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { near, startHarness, type Harness } from "./harness.ts";

// The GPU backend of a page is chosen once: each backend gets a page of its own.
const harnesses: Harness[] = [];
after(async () => { for (const harness of harnesses) await harness.close(); });

for (const forceBackend of [undefined, "webgl2"] as const) {
  test(`Compositor render procedure — half-transparent ink of a canvas-made texture composites as stored, not darker (${forceBackend ?? "default backend"})`, async () => {
    const harness = await startHarness();
    harnesses.push(harness);
    const result = await harness.page.evaluate(async ({ origin, forceBackend }) => {
      const { jc } = window;
      const fonts = [{ fontId: "arimo-700", family: "Arimo", url: `${origin}/fixtures/fonts/Arimo-Bold.ttf`, weight: 700 }];
      const view = { width: 400, height: 200, forceBackend };
      const open = async (overlay: unknown[], sources: { assetId: string; original: string }[] = [], assets: unknown[] = []) => {
        const doc = jc.project({ width: 400, height: 200 }, { kind: "color", color: "#ffffff" });
        doc.media.assets.push(...assets);
        doc.scenes[0].tracks.overlay = overlay;
        const opened = await jc.open(doc, view, sources, (port) => port.command("fonts.setSources", { fonts }));
        await opened.engine.whenFontsSettled();
        return { backend: opened.ready().backend as string, frame: await opened.frameAt(0) };
      };
      const transform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0 };
      // A shape filled with 50 % red, over white.
      const shape = await open([jc.track("graphic", "g0", [jc.element("graphic", { id: "g", startTime: 0, duration: 120000, definitionId: "rectangle", params: { fill: "#ff000080", strokeWidth: 0, cornerRadius: 0 }, transform })])]);
      // A text whose background box is 50 % blue, over white; the box is sampled beside the glyphs.
      const text = await open([jc.track("text", "t0", [jc.element("text", { id: "t", startTime: 0, duration: 120000, content: "I", fontFamily: "Arial", fontWeight: 700, fontSize: 20, color: "#000000", background: { enabled: true, color: "#0000ff80", cornerRadius: 0, paddingX: 200, paddingY: 60, offsetX: 0, offsetY: 0 } })])]);
      // A freehand stroke in 50 % green, over white.
      const drawing = await open([jc.track("graphic", "d0", [jc.element("graphic", { id: "d", startTime: 0, duration: 120000, definitionId: "drawing", params: { colorOverride: "" }, intrinsicWidth: 400, intrinsicHeight: 200, strokes: [{ id: "s", points: [[-160, 0], [160, 0]], width: 60, color: "#00ff0080", brush: "pen" }], transform })])]);
      // An image file with 50 % red pixels, over white.
      const half = await jc.imageUrl(100, 100, (c) => { c.fillStyle = "#ff000080"; c.fillRect(0, 0, 100, 100); });
      const image = await open([jc.track("video", "v1", [jc.element("image", { id: "i", startTime: 0, duration: 120000, mediaId: "half" })])], [{ assetId: "half", original: half }], [jc.asset("half", "image", { width: 100, height: 100 })]);
      // The same shape at 50 % element opacity: 25 % ink.
      const faded = await open([jc.track("graphic", "g0", [jc.element("graphic", { id: "g", startTime: 0, duration: 120000, definitionId: "rectangle", params: { fill: "#ff000080", strokeWidth: 0, cornerRadius: 0 }, transform, opacity: 0.5 })])]);
      return { backend: shape.backend, shape: shape.frame.at(200, 100), text: text.frame.at(150, 100), drawing: drawing.frame.at(200, 100), image: image.frame.at(200, 100), faded: faded.frame.at(200, 100), corner: shape.frame.at(5, 5) };
    }, { origin: harness.origin, forceBackend });
    if (forceBackend) assert.equal(result.backend, "webgl2");
    const expect = (actual: number[], expected: number[], label: string) => assert.ok(near(actual, expected, 3), `${label} on ${result.backend}: got ${actual}, expected ${expected}`);
    expect(result.corner, [255, 255, 255, 255], "background");
    // 0.5 × ink + 0.5 × white.
    expect(result.shape, [255, 128, 128, 255], "50 % red shape over white");
    expect(result.text, [128, 128, 255, 255], "50 % blue text box over white");
    expect(result.drawing, [128, 255, 128, 255], "50 % green stroke over white");
    expect(result.image, [255, 128, 128, 255], "50 % red image over white");
    expect(result.faded, [255, 191, 191, 255], "50 % red shape at 50 % opacity over white");
  });
}
