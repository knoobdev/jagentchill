// Pixel tests in headless Chromium: the colour chain (LUT, basic, wheels, curves, HSL) and adjustment layers.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { near, startHarness, type Harness } from "./harness.ts";

let harness: Harness;
before(async () => { harness = await startHarness(); });
after(async () => { await harness?.close(); });
const expectNear = (actual: number[], expected: number[], label: string, tolerance = 2) => assert.ok(near(actual, expected, tolerance), `${label}: got ${actual}, expected ${expected}`);

test("Colour adjustment pipeline order — Identity LUT; Small LUT; LUT is applied before exposure; HSL runs after curves; No banding from chained stages; Colour wheel puck mapping in the shader; basic sliders follow their formulas", async () => {
  const result = await harness.page.evaluate(async () => {
    const { jc } = window;
    // A chart: a horizontal 0–255 grey ramp on top, colour patches below.
    const patches = ["#ff0000", "#00ff00", "#0000ff", "#c86432", "#4d4d4d", "#808080", "#1e1edc", "#f0f0f0"];
    const chart = await jc.imageUrl(256, 64, (context) => {
      const data = context.createImageData(256, 32);
      for (let x = 0; x < 256; x++) for (let y = 0; y < 32; y++) { const index = (y * 256 + x) * 4; data.data[index] = data.data[index + 1] = data.data[index + 2] = x; data.data[index + 3] = 255; }
      context.putImageData(data, 0, 0);
      patches.forEach((colour, index) => { context.fillStyle = colour; context.fillRect(index * 32, 32, 32, 32); });
    });
    const cube = (size: number, map: (r: number, g: number, b: number) => number[]) => {
      const lines = [`LUT_3D_SIZE ${size}`];
      for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) lines.push(map(r / (size - 1), g / (size - 1), b / (size - 1)).map((value) => value.toFixed(6)).join(" "));
      return URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/plain" }));
    };
    const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const entries = [
      { key: "user:" + "a".repeat(64), kind: "lut" as const, url: cube(33, (r, g, b) => [r, g, b]), sha256: "a".repeat(64) },
      { key: "user:" + "b".repeat(64), kind: "lut" as const, url: cube(2, (r, g, b) => [r, g, b]), sha256: "b".repeat(64) },
      { key: "user:" + "c".repeat(64), kind: "lut" as const, url: cube(33, (r, g, b) => (luma(r, g, b) > 0.5 ? [1, 1, 1] : [r, g, b])), sha256: "c".repeat(64) },
    ];
    const render = async (adjustments: Record<string, unknown>) => {
      const doc = jc.project({ width: 256, height: 64 });
      doc.media.assets.push(jc.asset("chart", "image", { width: 256, height: 64 }));
      doc.scenes[0].tracks.main.elements.push(jc.element("image", { id: "e", startTime: 0, duration: 120000, mediaId: "chart", adjustments }));
      const opened = await jc.open(doc, { width: 256, height: 64 }, [{ assetId: "chart", original: chart }], (port) => port.command("derived.setSources", { entries }));
      await opened.frameAt(0);
      await opened.engine.whenLutsSettled();
      const frame = await opened.frameAt(0);
      return { ramp: Array.from({ length: 256 }, (_, x) => frame.at(x, 16)), patch: patches.map((_, index) => frame.at(index * 32 + 16, 48)), stages: opened.events.filter((event) => event.type === "diagnostic").map((event) => event.payload.id) };
    };
    const plain = await render({});
    const lut = (id: string, intensity = 100) => ({ lut: { enabled: true, lutId: "user:" + id.repeat(64), intensity } });
    return {
      plain,
      identity33: await render(lut("a")), identity2: await render(lut("b")),
      lutThenExposure: await render({ ...lut("c"), basic: { enabled: true, exposure: 50 } }),
      curvesThenHsl: await render({ curves: { enabled: true, red: [{ x: 0, y: 0 }, { x: 0.5, y: 0.85 }, { x: 1, y: 1 }] }, hsl: { enabled: true, red: { hue: 0, saturation: -100, lightness: 0 } } }),
      chained: await render({ basic: { enabled: true, contrast: -50 }, curves: { enabled: true, master: [{ x: 0.15, y: 0 }, { x: 0.85, y: 1 }] }, hsl: { enabled: true, red: { hue: 0, saturation: 0, lightness: 20 } } }),
      highlightsRed: await render({ wheels: { enabled: true, shadows: { x: 0, y: 0, luminance: 0 }, midtones: { x: 0, y: 0, luminance: 0 }, highlights: { x: 1, y: 0, luminance: 0 } } }),
      shadowsUp: await render({ wheels: { enabled: true, shadows: { x: 0, y: 0, luminance: 40 }, midtones: { x: 0, y: 0, luminance: 0 }, highlights: { x: 0, y: 0, luminance: 0 } } }),
      grey: await render({ basic: { enabled: true, saturation: -100 } }),
      contrast: await render({ basic: { enabled: true, contrast: 100 } }),
      brightness: await render({ basic: { enabled: true, brightness: 100 } }),
      hue: await render({ basic: { enabled: true, hue: 120 } }),
      fade: await render({ basic: { enabled: true, fade: 100 } }),
      missing: await render({ lut: { enabled: true, lutId: "user:" + "d".repeat(64), intensity: 100 }, basic: { enabled: true, sharpness: 0 } }),
    };
  });
  const rgb = (pixel: number[]) => pixel.slice(0, 3);
  const differs = (a: number[][], b: number[][]) => Math.max(...a.map((pixel, index) => Math.max(...rgb(pixel).map((value, channel) => Math.abs(value - b[index][channel])))));
  assert.ok(differs([...result.identity33.ramp, ...result.identity33.patch], [...result.plain.ramp, ...result.plain.patch]) <= 1, "an identity 33-point LUT changes no pixel by more than 1");
  assert.ok(differs([...result.identity2.ramp, ...result.identity2.patch], [...result.plain.ramp, ...result.plain.patch]) <= 1, "a 2-point identity LUT changes no pixel by more than 1");
  // 30 % grey (77): the LUT leaves it alone, then exposure +1 stop doubles its linear value.
  const eotf = (value: number) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4), oetf = (value: number) => (value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055);
  const expected = Math.round(oetf(eotf(77 / 255) * 2) * 255);
  expectNear(rgb(result.lutThenExposure.ramp[77]), [expected, expected, expected], "LUT before exposure");
  assert.ok(expected < 250, "the output is not white");
  expectNear(rgb(result.lutThenExposure.ramp[200]), [255, 255, 255], "above 50 % the LUT gives white");
  // The red curve turns mid-grey reddish; the HSL red band then removes its saturation: R, G and B are equal.
  const neutral = rgb(result.curvesThenHsl.ramp[128]);
  assert.ok(Math.max(...neutral) - Math.min(...neutral) <= 2, `equal channels after curves then HSL: ${neutral}`);
  assert.ok(neutral[0] > 128, "and lighter than the input: the curve ran first");
  // Contrast −50 squeezes the ramp into 181 eight-bit steps; the curve stretches it back. Only a chain that keeps
  // floating point between its stages still has 200 distinct grey levels at the end.
  assert.ok(new Set(result.chained.ramp.map((pixel) => pixel[0])).size >= 200, `${new Set(result.chained.ramp.map((pixel) => pixel[0])).size} distinct levels`);
  expectNear(rgb(result.highlightsRed.ramp[128]), [255, 90, 90], "highlights pushed to red: mid-grey becomes (1.0, 0.354, 0.354)", 3);
  expectNear(rgb(result.shadowsUp.ramp[0]), [26, 26, 26], "shadows luminance +40 lifts black to 0.1");
  // Basic sliders against their formulas.
  const hexes = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [200, 100, 50]];
  hexes.forEach((colour, index) => { const l = Math.round(0.2126 * colour[0] + 0.7152 * colour[1] + 0.0722 * colour[2]); expectNear(rgb(result.grey.patch[index]), [l, l, l], `saturation −100 of ${colour}`); });
  expectNear(rgb(result.contrast.ramp[160]), Array(3).fill(Math.round((0.5 + (160 / 255 - 0.5) * 2) * 255)), "contrast +100 doubles the distance from mid-grey");
  const bright = (v: number) => Math.round((v + 0.25 * 4 * v * (1 - v)) * 255);
  expectNear(rgb(result.brightness.ramp[64]), Array(3).fill(bright(64 / 255)), "brightness +100");
  expectNear(rgb(result.brightness.ramp[255]), [255, 255, 255], "white point fixed");
  expectNear(rgb(result.fade.ramp[0]), [64, 64, 64], "fade lifts black toward 0.25");
  // A hue rotation of 120° about the grey axis moves red toward green, keeping its luma.
  const rotated = rgb(result.hue.patch[0]);
  assert.ok(rotated[1] > rotated[0] && rotated[1] > rotated[2], `red rotated by 120° is greenish: ${rotated}`);
  assert.ok(differs(result.missing.ramp, result.plain.ramp) <= 1, "a missing LUT renders as identity");
  assert.deepEqual(result.missing.stages, ["derived/unavailable"]);
});

test("Adjustment and effect layer nodes — Adjustment layer affects only layers beneath; Masked adjustment layer; Outside the element time range", async () => {
  const result = await harness.page.evaluate(async () => {
    const { jc } = window;
    const colour = (value: string) => jc.imageUrl(16, 16, (context) => { context.fillStyle = value; context.fillRect(0, 0, 16, 16); });
    const sources = [{ assetId: "base", original: await colour("#c86432") }, { assetId: "top", original: await colour("#00c8ff") }];
    const build = (masks: unknown[]) => {
      const doc = jc.project({ width: 200, height: 100 });
      for (const source of sources) doc.media.assets.push(jc.asset(source.assetId, "image", { width: 16, height: 16 }));
      doc.scenes[0].tracks.main.elements.push(jc.element("image", { id: "m", startTime: 0, duration: 240000, mediaId: "base", transform: { position: { x: 0, y: 0 }, scale: { x: 2, y: 1 }, rotation: 0 } }));
      doc.scenes[0].tracks.overlay = [
        jc.track("video", "o0", [jc.element("image", { id: "t", startTime: 0, duration: 240000, mediaId: "top", transform: { position: { x: 0, y: 0 }, scale: { x: 0.3, y: 0.3 }, rotation: 0 } })]),
        jc.track("adjustment", "o1", [jc.element("adjustment", { id: "a", startTime: 0, duration: 120000, adjustments: { basic: { enabled: true, saturation: -100 } }, masks })]),
      ];
      return doc;
    };
    const plain = await jc.open(build([]), { width: 200, height: 100 }, sources);
    const during = await plain.frameAt(0), after = await plain.frameAt(120000);
    const masked = await (await jc.open(build([{ id: "k", type: "rectangle", enabled: true, combine: "add", params: { width: 1, height: 1, centerX: -0.5 } }]), { width: 200, height: 100 }, sources)).frameAt(0);
    return { beneath: during.at(20, 50), above: during.at(100, 50), after: after.at(20, 50), maskedLeft: masked.at(20, 50), maskedRight: masked.at(180, 50) };
  });
  const grey = Math.round(0.2126 * 200 + 0.7152 * 100 + 0.0722 * 50);
  expectNear(result.beneath, [grey, grey, grey, 255], "the clip beneath is greyscale");
  expectNear(result.above, [0, 200, 255, 255], "the clip above keeps its colours");
  expectNear(result.after, [200, 100, 50, 255], "after the element's end nothing is adjusted");
  expectNear(result.maskedLeft, [grey, grey, grey, 255], "inside the mask");
  expectNear(result.maskedRight, [200, 100, 50, 255], "outside the mask the colours are kept");
});
