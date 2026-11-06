// Pixel tests of the filter library (39 baked recipes), the six remaining mask types and the spatial colour steps
// (sharpness, clarity, grain). Pictures are those of `lab.ts`.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { FILTER_DEFINITIONS } from "@jagentchill/editor-core";
import { applyRecipe, filterRecipe } from "../../src/frame/recipe.ts";
import { startHarness, type Harness } from "./harness.ts";
import { BLACK, changed, GREY, installLab, luma, near, px, share, shot, WHITE, worst, type Frame, type Rgb } from "./lab.ts";

let harness: Harness, plain: Frame;
const picture = (id: string, fields: Record<string, unknown> = {}, time = 0) => shot(harness, `const doc = lab.project(); doc.scenes[0].tracks.main.elements.push(lab.image("m", args.id, args.fields)); return lab.frame(doc, args.time);`, { id, fields, time });
const filter = (type: string, intensity = 100) => ({ effects: [{ id: "f", type, kind: "filter", enabled: true, params: { intensity } }] });
before(async () => {
  harness = await startHarness();
  await installLab(harness, process.env.JC_BACKEND === "webgl2" ? "webgl2" : undefined);
  plain = await picture("t");
});
after(async () => { await harness?.close(); });
/** Largest channel difference over the 35 937 lattice pixels of two frames of L. */
const latticeWorst = (one: Frame, other: Frame): number => { let out = 0; for (let n = 0; n < 35937 * 4; n++) out = Math.max(out, Math.abs(one.data[n] - other.data[n])); return out; };
/** Lattice entries of two frames of L that differ by more than `tolerance` on a channel. */
const latticeOff = (one: Frame, other: Frame, tolerance: number): number => { let count = 0; for (let n = 0; n < 35937; n++) if ([0, 1, 2].some((channel) => Math.abs(one.data[n * 4 + channel] - other.data[n * 4 + channel]) > tolerance)) count++; return count; };

test("Bundled filter library — Baked table equals its recipe; Intensity zero is identity; Wheel recipe is reproducible; every filter changes the picture as its recipe says", async () => {
  const lattice = await picture("l");
  const failures: string[] = [], report: string[] = [];
  for (const definition of FILTER_DEFINITIONS) {
    const recipe = filterRecipe(definition.type)!;
    const baked = await picture("l", filter(definition.type)), live = await picture("l", { adjustments: recipe });
    const off = latticeOff(baked, live, 2);
    report.push(`${definition.type} ${latticeOff(baked, live, 1)}/${off}/${latticeWorst(baked, live)}`);
    // Where the chain renormalises luma on values that have gone negative (temperature after a strong contrast) the
    // formula is ill-conditioned, and binary64 and the GPU's f32 part company on a handful of the 35 937 points.
    if (off > 12) failures.push(`${definition.type}: ${off} lattice points of the baked table are more than 2/255 from the live chain`);
    if (worst(await picture("l", filter(definition.type, 0)), lattice) !== 0) failures.push(`${definition.type}: intensity 0 is not the unfiltered picture`);
    if (changed(baked, lattice, 3) < 0.05) failures.push(`${definition.type}: the filter does nothing`);
    // The lattice entry 16, 16, 16 (the picture holds it as 128/255) is the recipe's formula, computed here in binary64.
    const n = 16 + 33 * 16 + 1089 * 16, expected = applyRecipe([128 / 255, 128 / 255, 128 / 255], recipe).map((value) => value * 255) as Rgb;
    if (!near(px(baked, n % 640, Math.floor(n / 640)), expected, 1.01)) failures.push(`${definition.type}: mid-grey is ${px(baked, n % 640, Math.floor(n / 640))}, the recipe gives ${expected.map((value) => value.toFixed(2))}`);
  }
  console.log(`filters, lattice points off by more than 1 / more than 2 / worst: ${report.join("; ")}`);
  assert.deepEqual(failures, []);
});

test("Bundled filter library — Intensity mixes linearly; Mono recipe produces greyscale; Colour wheel puck mapping — Baked recipe equals the live wheel; Filter layer is an effect element", async () => {
  // Mono on pure red: (54, 54, 54) at 100, the average with red at 50.
  const mono = await picture("t", filter("mono")), halfway = await picture("t", filter("mono", 50));
  assert.ok(near(px(mono, 460, 80), [54, 54, 54], 1) && near(px(halfway, 460, 80), [(255 + 54) / 2, 27, 27], 1.01), `${px(mono, 460, 80)} ${px(halfway, 460, 80)}`);
  assert.equal(share(mono, (c) => Math.abs(c[0] - c[1]) > 1 || Math.abs(c[1] - c[2]) > 1), 0, "every pixel is grey");
  // The recipe "highlights 30°, 0.2" baked into a LUT, against the same values set on the wheel of an identical clip.
  const baked = await picture("l", { adjustments: { lut: { enabled: true, lutId: "user:" + "c".repeat(64), intensity: 100 } } });
  const wheel = await picture("l", { adjustments: { wheels: { enabled: true, highlights: { x: 0.2 * Math.cos(Math.PI / 6), y: 0.2 * Math.sin(Math.PI / 6), luminance: 0 } } } });
  assert.ok(latticeWorst(baked, wheel) <= 2, `${latticeWorst(baked, wheel)}/255`);
  assert.ok(changed(baked, await picture("l"), 3) > 0.1, `the wheel changes ${changed(baked, await picture("l"), 3)} of the lattice`);
  // A standalone filter is an effect element whose one entry has kind `filter`: it grades everything beneath it.
  const layer = await shot(harness, `const doc = lab.project(); doc.scenes[0].tracks.main.elements.push(lab.image("m", "t")); doc.scenes[0].tracks.overlay = [jc.track("effect", "fx", [jc.element("effect", { id: "f", startTime: 0, duration: 120000, effects: [{ id: "e", type: "mono", kind: "filter", enabled: true, params: { intensity: 100 } }] })])]; return lab.frame(doc, 0);`);
  assert.ok(worst(layer, mono) <= 1, `layer differs by ${worst(layer, mono)}`);
});

test("Mask types — Horizontal split; Inverted split; Default mirror mask; Rotated band; Default bars; Heart shape; Text reveals video; Font size unit; Blank content; Bold control; Open path does not mask; a closed path masks", async () => {
  const masked = (type: string, params: Record<string, unknown> = {}) => picture("t", { masks: [{ id: "k", type, enabled: true, combine: "add", params }] });
  const shown = (frame: Frame, x: number, y: number) => near(px(frame, x, y), px(plain, x, y), 2), hidden = (frame: Frame, x: number, y: number) => near(px(frame, x, y), BLACK, 2);
  const split = await masked("split"), inverted = await masked("split", { inverted: true });
  assert.ok(Math.abs(share(split, (c, x, y) => near(c, px(plain, x, y), 2) && !near(c, BLACK, 2)) + share(inverted, (c, x, y) => near(c, px(plain, x, y), 2) && !near(c, BLACK, 2)) - share(plain, (c) => !near(c, BLACK, 2))) < 0.02, "the two halves make the picture");
  assert.ok(hidden(split, 320, 170) && shown(split, 320, 190) && shown(inverted, 320, 170) && hidden(inverted, 320, 190), "one half each, divided through the centre");
  // Mirror: a band 0.4 of the short side (144 px) across the full width; vertical at rotation 90.
  const mirror = await masked("mirror"), upright = await masked("mirror", { rotation: 90 });
  assert.ok(shown(mirror, 20, 180) && shown(mirror, 620, 112) && hidden(mirror, 320, 104) && shown(mirror, 320, 248) && hidden(mirror, 320, 256));
  assert.ok(shown(upright, 320, 10) && hidden(upright, 244, 180) && shown(upright, 252, 180) && hidden(upright, 396, 180));
  // Cinematic bars: a band 0.6 of the short side (216 px), bars of 72 px above and below.
  const bars = await masked("cinematic-bars");
  assert.ok(hidden(bars, 320, 68) && shown(bars, 320, 76) && shown(bars, 10, 284) && hidden(bars, 320, 292));
  // Heart: symmetric about the vertical centre line, bounds = the 216 px box, tip at the bottom centre, notch at the top centre.
  const heart = await masked("heart");
  assert.ok(share(heart, (c, x, y) => near(c, BLACK, 2) !== near(px(heart, 639 - x, y), BLACK, 2), 212, 72, 428, 288) < 0.02, "mirror-symmetric");
  assert.ok(shown(heart, 320, 284) && hidden(heart, 320, 76) && shown(heart, 216, 150) && hidden(heart, 208, 150) && shown(heart, 270, 76) && hidden(heart, 320, 294));
  // Text: the picture is visible only inside the glyphs; the em height is fontSize % of the short side.
  const hello = await masked("text", { content: "HELLO" }), bold = await masked("text", { content: "HELLO", fontWeight: "bold" });
  const inside = (frame: Frame) => share(frame, (c) => !near(c, BLACK, 2));
  assert.ok(inside(hello) > 0.003 && inside(hello) < 0.1 && share(hello, (c, x, y) => c.some((value, index) => value > px(plain, x, y)[index] + 2)) === 0, `${inside(hello)}`);
  const rows = Array.from({ length: 360 }, (_, y) => share(hello, (c) => !near(c, BLACK, 2), 0, y, 640, y + 1) > 0).reduce((count, on) => count + (on ? 1 : 0), 0);
  // An em of 15 % × 360 = 54 px: capitals of Arimo are 0.716 em high.
  assert.ok(Math.abs(rows - 54 * 0.716) <= 3, `capital height ${rows} px`);
  assert.ok(inside(bold) > inside(hello) * 1.1, "bold glyphs cover more");
  assert.equal(worst(await masked("text", { content: "   " }), plain), 0, "blank content leaves the element unmasked");
  const triangle = [{ id: "1", x: 0, y: -0.8 }, { id: "2", x: 0.8, y: 0.7 }, { id: "3", x: -0.8, y: 0.7 }];
  const closed = await masked("freeform", { closed: true, path: triangle });
  assert.ok(shown(closed, 320, 200) && hidden(closed, 100, 60) && hidden(closed, 540, 60) && shown(closed, 320, 60) && hidden(closed, 320, 320));
  assert.equal(worst(await masked("freeform", { closed: false, path: triangle }), plain), 0);
});

test("Colour adjustment pipeline order — the spatial pass: sharpness, clarity and grain follow their formulas", async () => {
  const basic = (values: Record<string, number>, time = 0) => picture("t", { adjustments: { basic: { enabled: true, ...values } } }, time);
  // Sharpness: v + 2p (v − gauss(v, sigma 0.5 px)): an overshoot on the dark side of an edge, flat areas unchanged.
  const sharp = await basic({ sharpness: 100 });
  assert.ok(px(sharp, 39, 80)[0] < 122 && near(px(sharp, 30, 80), GREY, 1) && near(px(sharp, 100, 80), WHITE, 1) && near(px(sharp, 320, 180), GREY, 1), `${px(sharp, 39, 80)}`);
  // Clarity: v + p (v − gauss(v, sigma 13.3 px)) × 4L(1 − L): a wide halo on the mid-tone side, none in white.
  const clear = await basic({ clarity: 100 });
  assert.ok(px(clear, 32, 80)[0] < 118 && px(clear, 39, 80)[0] < px(clear, 20, 80)[0] && near(px(clear, 100, 80), WHITE, 1) && near(px(clear, 320, 180), GREY, 2), `${px(clear, 32, 80)}`);
  assert.ok(px(await basic({ clarity: -100 }), 32, 80)[0] > 138, "negative clarity softens");
  // Grain: monochrome Gaussian noise of standard deviation 0.12 p on 0.5 px cells, new on every frame.
  const grain = await basic({ grain: 100 });
  const region: number[] = [];
  for (let y = 150; y < 210; y++) for (let x = 250; x < 350; x++) region.push(px(grain, x, y)[0]);
  const average = region.reduce((sum, value) => sum + value, 0) / region.length, deviation = Math.sqrt(region.reduce((sum, value) => sum + (value - average) ** 2, 0) / region.length);
  assert.ok(Math.abs(average - 128) < 3 && Math.abs(deviation - 0.12 * 255) < 4, `mean ${average.toFixed(1)}, deviation ${deviation.toFixed(1)}`);
  assert.equal(share(grain, (c) => c[0] !== c[1] || c[1] !== c[2], 250, 150, 350, 210), 0);
  assert.equal(worst(await basic({ grain: 100 }), grain), 0, "the same frame has the same grain");
  assert.ok(changed(await basic({ grain: 100 }, 4000), grain, 4) > 0.5, "the next frame has another pattern");
  // Order: grain comes after fade, so its deviation is not compressed by the fade.
  const faded: number[] = [];
  const both = await basic({ grain: 100, fade: 100 });
  for (let y = 150; y < 210; y++) for (let x = 250; x < 350; x++) faded.push(px(both, x, y)[0]);
  const fadedMean = faded.reduce((sum, value) => sum + value, 0) / faded.length;
  assert.ok(Math.abs(Math.sqrt(faded.reduce((sum, value) => sum + (value - fadedMean) ** 2, 0) / faded.length) - 0.12 * 255) < 4 && Math.abs(fadedMean - (128 * 0.75 + 0.25 * 255)) < 3);
  assert.ok(luma(px(plain, 320, 180)) > 0);
});
