import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFrame, colorChain, curveTable, parseCube, wheelTransfer, wheelValues, type LayerItem } from "../src/index.ts";
import { asset, element, project } from "./support/doc.ts";

const near = (actual: number[], expected: number[], tolerance: number) => assert.ok(actual.length === expected.length && actual.every((value, index) => Math.abs(value - expected[index]) <= tolerance), `${actual} is not ${expected}`);
const centred = { x: 0, y: 0, luminance: 0 };
const inputs = { curves: () => "curves:x", lut: () => ({ textureId: "lut:x", size: 33 }), unsupported: () => undefined };

test("Colour wheel puck mapping — Centred pucks are the identity; Highlights pushed fully to red; Shadows luminance only; Midtones toward green", () => {
  assert.equal(wheelValues(centred, centred, centred), null, "the chain emits no wheels step");
  const red = wheelValues(centred, centred, { x: 1, y: 0, luminance: 0 })!;
  near(red.slice(6), [2, 0.7071, 0.7071], 1e-4);
  near([0, 1, 2].map((channel) => wheelTransfer(0.5, red[channel], red[3 + channel], red[6 + channel])), [1, 0.3536, 0.3536], 1e-3);
  const lifted = wheelValues({ x: 0, y: 0, luminance: 40 }, centred, centred)!;
  near(lifted.slice(0, 3), [0.1, 0.1, 0.1], 1e-9);
  assert.ok(Math.abs(wheelTransfer(0, lifted[0], lifted[3], lifted[6]) - 0.1) < 1e-9);
  const angle = (120 * Math.PI) / 180;
  near(wheelValues(centred, { x: 0.5 * Math.cos(angle), y: 0.5 * Math.sin(angle), luminance: 0 }, centred)!.slice(3, 6), [0.8409, 1.4142, 0.8409], 1e-4);
});

test("Per-layer stage order — Identity stages cost nothing; Colour adjustment pipeline order — the chain carries only the steps that do something", () => {
  const identity = { basic: { enabled: true, exposure: 0, contrast: 0, hue: 0, fade: 0 }, wheels: { enabled: true, shadows: centred, midtones: centred, highlights: centred }, curves: { enabled: true, master: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }, hsl: { enabled: true, red: { hue: 0, saturation: 0, lightness: 0 } } };
  assert.equal(colorChain({ adjustments: identity }, 0, inputs), null);
  const doc = project();
  doc.media.assets.push(asset("img", "image", { width: 1920, height: 1080 }));
  doc.scenes[0].tracks.main.elements.push(element("image", { id: "e", mediaId: "img", adjustments: identity, effects: [{ id: "fx", type: "blur", kind: "effect", enabled: false, params: { intensity: 50 } }] }));
  const layer = buildFrame({ document: doc, sceneId: "s1", time: 0, render: { width: 1920, height: 1080 } }).descriptor.items.at(-1) as LayerItem;
  assert.equal(layer.color, null, "0 colour passes");
  assert.deepEqual(layer.effectPassGroups, [], "0 effect passes");
  // A disabled section is identity too; an enabled one carries its values as slider / 100, hue in degrees.
  assert.equal(colorChain({ adjustments: { basic: { enabled: false, exposure: 50 } } }, 0, inputs), null);
  const chain = colorChain({ adjustments: { basic: { enabled: true, exposure: 50, saturation: -100, hue: 90, vignette: -40 }, lut: { enabled: true, lutId: "bundled:x", intensity: 80 }, curves: { enabled: true, red: [{ x: 0, y: 0 }, { x: 0.5, y: 0.8 }, { x: 1, y: 1 }] }, hsl: { enabled: true, red: { hue: 0, saturation: -100, lightness: 0 } } } }, 0, inputs)!;
  assert.deepEqual(chain.basic, [0.5, 0, 0, 0, 0, 0, 0, 0, 0, -1, 0, 90]);
  assert.deepEqual(chain.spatial, [0, -0.4]);
  assert.deepEqual(chain.lut, { textureId: "lut:x", size: 33, intensity: 0.8 });
  assert.equal(chain.curvesTextureId, "curves:x");
  assert.deepEqual(chain.hsl!.slice(0, 3), [0, -1, 0]);
  assert.equal(chain.wheels, null);
});

test("Colour adjustment pipeline order — curves are monotone cubic tables of 256 entries; a .cube table of any size packs into a texture", () => {
  const identity = curveTable([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
  assert.equal(identity.length, 256);
  for (let entry = 0; entry < 256; entry += 17) assert.ok(Math.abs(identity[entry] - entry / 255) < 1e-6);
  const lifted = curveTable([{ x: 0, y: 0 }, { x: 0.5, y: 0.8 }, { x: 1, y: 1 }]);
  assert.ok(Math.abs(lifted[128] - 0.8) < 0.01);
  assert.ok(lifted.every((value, index) => index === 0 || value >= lifted[index - 1]), "monotone");
  // End points inside the range hold their value beyond.
  const held = curveTable([{ x: 0.2, y: 0.1 }, { x: 0.8, y: 0.9 }]);
  assert.deepEqual([held[0], held[255]].map((value) => Math.round(value * 10) / 10), [0.1, 0.9]);
  const cube = ["LUT_3D_SIZE 2", "0 0 0", "1 0 0", "0 1 0", "1 1 0", "0 0 1", "1 0 1", "0 1 1", "1 1 1"].join("\n");
  const parsed = parseCube(cube)!;
  assert.equal(parsed.size, 2);
  // Texel (r + b × size, g): the entry r = 1, g = 0, b = 1 is at x = 3, y = 0.
  assert.deepEqual([...parsed.pixels.slice(3 * 4, 3 * 4 + 4)], [255, 0, 255, 255]);
  assert.equal(parseCube("LUT_3D_SIZE 66\n"), null);
  assert.equal(parseCube("LUT_3D_SIZE 2\n0 0 0\n"), null);
});
