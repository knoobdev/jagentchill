import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCssColor, parseGradient, rasterGradient } from "../src/scene/gradient.ts";

const pixel = (css: string, width: number, height: number) => {
  const parsed = parseGradient(css), data = rasterGradient(parsed, width, height);
  return { parsed, at: (x: number, y: number) => Array.from(data.slice((y * width + x) * 4, (y * width + x) * 4 + 4)) };
};
const near = (actual: number[], expected: number[], tolerance: number) => assert.ok(actual.every((value, index) => Math.abs(value - expected[index]) <= tolerance), `${actual} is not ${expected}`);

test("Background gradient parsing — Two-stop linear gradient", () => {
  const { at } = pixel("linear-gradient(90deg, #000000 0%, #ffffff 100%)", 1920, 4);
  near(at(960, 2), [128, 128, 128, 255], 2);
  near(at(0, 2), [0, 0, 0, 255], 2);
  near(at(1919, 2), [255, 255, 255, 255], 2);
  // The default direction is "to bottom"; "to top right" ends in the top-right corner.
  near(pixel("linear-gradient(#f00, #00f)", 4, 100).at(2, 99), [3, 0, 252, 255], 3);
  const corner = pixel("linear-gradient(to top right, #000, #fff)", 200, 100);
  near(corner.at(199, 0), [255, 255, 255, 255], 3);
  near(corner.at(0, 99), [0, 0, 0, 255], 3);
  near(corner.at(0, 0), [128, 128, 128, 255], 3);
});

test("Background gradient parsing — Layered gradient paint order", () => {
  const { at, parsed } = pixel("radial-gradient(circle at 50% 50%, rgba(255,0,0,1) 0, rgba(255,0,0,0) 200px), linear-gradient(#0000ff, #0000ff)", 480, 270);
  assert.equal(parsed.layers.length, 2);
  near(at(240, 135), [255, 0, 0, 255], 6);
  near(at(1, 1), [0, 0, 255, 255], 1);
});

test("Background gradient parsing — Repeating gradient tiles", () => {
  const { at } = pixel("repeating-linear-gradient(90deg, #000 0px, #000 10px, #fff 10px, #fff 20px)", 1920, 1);
  let bands = 0, black = 0, white = 0;
  for (let x = 0; x < 1920; x++) {
    const value = at(x, 0)[0];
    assert.ok(value === 0 || value === 255, `column ${x} is ${value}`);
    if (x === 0 || value !== at(x - 1, 0)[0]) { bands++; if (value === 0) black++; else white++; }
  }
  assert.deepEqual([bands, black, white], [192, 96, 96]);
});

test("Background gradient parsing — Unsupported layer; Nothing parses", () => {
  const css = "conic-gradient(red, blue), linear-gradient(#112233, #112233)";
  const { at, parsed } = pixel(css, 16, 16);
  assert.equal(parsed.skipped, 1);
  assert.deepEqual(at(8, 8), [0x11, 0x22, 0x33, 255]);
  const none = parseGradient("var(--brand)");
  assert.deepEqual([none.layers.length, none.skipped], [0, 1]);
  assert.equal(parseGradient("linear-gradient(red, var(--x))").layers.length, 0);
  assert.equal(parseGradient("-webkit-linear-gradient(90deg, red, blue)").layers.length, 1, "a vendor prefix is ignored");
});

test("Background gradient parsing — Fade to transparent does not darken", () => {
  const [r, g, b, a] = pixel("linear-gradient(to right, #ff0000, transparent)", 200, 2).at(100, 1);
  // Over a white layer: straight-alpha source-over.
  const over = [r, g, b].map((value) => Math.round(value * (a / 255) + 255 * (1 - a / 255)));
  near(over, [255, 128, 128], 2);
  assert.equal(r, 255, "the hue of the opaque stop is kept");
});

test("Background gradient parsing — Pixel lengths on a square canvas", () => {
  const { at } = pixel("radial-gradient(circle 192px at center, #ffffff, #000000)", 1080, 1080);
  // The radius is 192 × 1080 / 1920 = 108 px.
  near(at(540 + 107, 540), [2, 2, 2, 255], 4);
  near(at(540 + 54, 540), [128, 128, 128, 255], 4);
  near(at(540 + 120, 540), [0, 0, 0, 255], 0);
});

test("Background gradient parsing — colours, lengths and radial extents of the grammar", () => {
  assert.deepEqual(parseCssColor("#abc"), [0xaa / 255, 0xbb / 255, 0xcc / 255, 1]);
  assert.deepEqual(parseCssColor("#11223380")?.[3], 0x80 / 255);
  assert.deepEqual(parseCssColor("rebeccapurple"), [0x66 / 255, 0x33 / 255, 0x99 / 255, 1]);
  assert.deepEqual(parseCssColor("rgba(255, 0, 0, 0.5)"), [1, 0, 0, 0.5]);
  near(parseCssColor("hsl(120, 100%, 50%)")!.map((value) => value * 255), [0, 255, 0, 255], 0.01);
  near(parseCssColor("hsla(240, 100%, 50%, 0.25)")!.map((value) => value * 255), [0, 0, 255, 63.75], 0.01);
  assert.equal(parseCssColor("notacolour"), null);
  // em = 16 px; calc() over px and %; turn and rad angles.
  near(pixel("linear-gradient(0.25turn, #000 calc(50% - 10px), #fff calc(50% + 10px))", 1920, 1).at(960, 0), [128, 128, 128, 255], 8);
  near(pixel("linear-gradient(90deg, #000 60em, #fff 60em)", 1920, 1).at(970, 0), [255, 255, 255, 255], 0);
  near(pixel("linear-gradient(90deg, #000 60em, #fff 60em)", 1920, 1).at(950, 0), [0, 0, 0, 255], 0);
  // closest-side circle on a 200×100 canvas has radius 50; farthest-corner reaches the corners.
  near(pixel("radial-gradient(circle closest-side, #fff, #000)", 200, 100).at(100 + 60, 50), [0, 0, 0, 255], 0);
  const far = pixel("radial-gradient(#fff, #000)", 200, 100);
  near(far.at(0, 0), [0, 0, 0, 255], 4);
  assert.ok(far.at(199, 50)[0] > 40, "the default ellipse is not yet black on the side");
});
