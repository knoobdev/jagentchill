// Pixel tests of the effect library: every effect id of `visual-effects-filters/catalog.md` renders what its row
// describes. The picture is T of `lab.ts` (640 × 360, pixel scale factor 1/3): grey, a white block at 40…160 × 40…120,
// a red block at 400…520 × 40…120, a blue block at 40…160 × 220…320 and a black disc of radius 60 at (460, 250).
// The person matte is an ellipse of radii 120 × 150 centred on (320, 200).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { EFFECT_DEFINITIONS } from "@jagentchill/editor-core";
import { startHarness, type Harness } from "./harness.ts";
import { BLACK, changed, effectShot, GREY, installLab, luma, mean, near, px, share, shot, WHITE, worst, type Frame, type Rgb } from "./lab.ts";

let harness: Harness, plain: Frame;
before(async () => {
  harness = await startHarness();
  await installLab(harness, process.env.JC_BACKEND === "webgl2" ? "webgl2" : undefined);
  plain = await shot(harness, `const doc = lab.project(); doc.scenes[0].tracks.main.elements.push(lab.image("m", "t")); return lab.frame(doc, 0);`);
});
after(async () => { await harness?.close(); });

type Check = { params?: Record<string, unknown>; options?: Record<string, unknown>; proves: string; check: (fx: Frame, o: Frame) => boolean | Promise<boolean> };
const brighter = (fx: Frame, o: Frame, by = 40): number => share(fx, (c, x, y) => luma(c) > luma(px(o, x, y)) + by);
const never = (fx: Frame, o: Frame): boolean => share(fx, (c, x, y) => c.some((value, index) => value < px(o, x, y)[index] - 2)) === 0;
const binary = (fx: Frame): boolean => share(fx, (c) => c.every((value) => value <= 2 || value >= 253)) === 1;
const body = { clip: true };

const CHECKS: Record<string, Check> = {
  "directional-blur": { params: { intensity: 90, angle: 0 }, proves: "a vertical edge is smeared along the angle and a horizontal edge stays sharp",
    check: (fx) => luma(px(fx, 45, 80)) < 250 && luma(px(fx, 45, 80)) > 130 && near(px(fx, 100, 43), WHITE, 3) && near(px(fx, 100, 37), GREY, 3) },
  "radial-blur": { params: { intensity: 100 }, proves: "the centre is still and a block far from it is smeared along its arc",
    check: (fx) => near(px(fx, 320, 180), GREY, 3) && !near(px(fx, 100, 43), WHITE, 6) && !near(px(fx, 100, 37), GREY, 6) },
  "zoom-blur": { params: { intensity: 100 }, proves: "the centre is still and an edge is smeared along the line to the centre",
    check: (fx) => near(px(fx, 320, 180), GREY, 3) && luma(px(fx, 44, 84)) < 250 && luma(px(fx, 36, 78)) > 130 },
  "tilt-shift": { params: { intensity: 100, width: 10, position: -60, angle: 0 }, proves: "rows on the focus line are sharp and rows far from it are blurred",
    check: (fx) => near(px(fx, 37, 72), GREY, 6) && near(px(fx, 43, 72), WHITE, 6) && !near(px(fx, 43, 270), [0, 0, 255], 20) },
  "frosted-glass": { params: { intensity: 100, grain: 100 }, proves: "pixels are taken from scattered offsets (the edge is ragged) and grain is added",
    check: (fx) => { const ragged = share(fx, (c) => luma(c) > 230, 27, 50, 40, 110), kept = share(fx, (c) => luma(c) > 230, 40, 50, 53, 110); return ragged > 0.02 && kept < 0.98 && share(fx, (c) => !near(c, GREY, 1), 250, 150, 350, 210) > 0.5; } },
  mosaic: { params: { blockSize: 60 }, proves: "every 20 px cell shows the colour of its centre",
    check: (fx, o) => near(px(fx, 41, 41), px(fx, 59, 59), 0) && near(px(fx, 41, 41), px(o, 50, 50), 2) && near(px(fx, 21, 39), px(o, 30, 30), 2) && near(px(fx, 159, 119), px(o, 150, 110), 2) },
  fisheye: { params: { strength: 100 }, proves: "the corners stay and the middle is magnified (content moves outward)",
    check: (fx, o) => near(px(fx, 2, 2), px(o, 2, 2), 6) && near(px(fx, 320, 180), GREY, 3) && near(px(fx, 150, 110), GREY, 6) && near(px(o, 150, 110), WHITE, 2) },
  wave: { params: { amplitude: 100, frequency: 2, speed: 0 }, proves: "columns are displaced vertically by the sine of their position, 16.7 px at its crest",
    check: (fx, o) => near(px(fx, 80, 28), WHITE, 6) && near(px(o, 80, 28), GREY, 2) && near(px(fx, 80, 110), GREY, 6) && near(px(fx, 2, 180), px(o, 2, 180), 6) },
  ripple: { params: { amplitude: 100, wavelength: 30, speed: 0 }, proves: "the centre is still and content is displaced radially in rings",
    check: (fx, o) => near(px(fx, 320, 180), GREY, 3) && changed(fx, o) > 0.01 && changed(fx, o) < 0.5 },
  twirl: { params: { angle: 180, radius: 100 }, proves: "content near the centre is rotated and the corners are untouched",
    check: (fx, o) => near(px(fx, 1, 1), px(o, 1, 1), 6) && near(px(o, 460, 250), BLACK, 2) && !near(px(fx, 460, 250), BLACK, 30) && changed(fx, o) > 0.1 },
  bulge: { params: { strength: 100, radius: 100 }, proves: "inside the radius the picture is magnified from the centre",
    check: (fx, o) => near(px(o, 440, 240), BLACK, 2) && near(px(fx, 440, 240), GREY, 6) && near(px(fx, 320, 180), GREY, 3) },
  mirror: { proves: "the left half is copied onto the right half, mirrored",
    check: (fx, o) => near(px(fx, 560, 80), WHITE, 3) && near(px(fx, 460, 80), GREY, 3) && share(fx, (c, x, y) => !near(c, px(fx, 639 - x, y), 3)) < 0.01 && changed(fx, o, 8) > 0.05 },
  kaleidoscope: { params: { segments: 4 }, proves: "the picture is folded into four mirrored wedges about the centre",
    check: (fx) => [[100, 0], [0, 100], [-100, 0], [0, -100]].every(([dx, dy]) => near(px(fx, 320 + dx, 180 + dy), px(fx, 420, 180), 4)) && [[60, 30], [-30, 60], [-60, -30], [30, -60]].every(([dx, dy]) => near(px(fx, 320 + dx, 180 + dy), px(fx, 380, 210), 6)) },
  shake: { params: { intensity: 100, frequency: 12, rotation: 0, seed: 3 }, proves: "the picture is moved by seeded noise, with no empty edge",
    check: (fx, o) => changed(fx, o) > 0.003 && share(fx, (c) => near(c, BLACK, 2), 0, 0, 640, 4) === 0 && share(fx, (c) => near(c, BLACK, 2), 0, 0, 4, 360) === 0 },
  tile: { params: { rows: 2, columns: 2 }, proves: "four copies of the picture at half size",
    check: (fx, o) => near(px(fx, 50, 40), px(o, 100, 80), 4) && near(px(fx, 370, 40), WHITE, 4) && near(px(fx, 50, 220), WHITE, 4) && near(px(fx, 230, 125), BLACK, 4) && near(px(fx, 550, 305), BLACK, 4) },
  posterize: { params: { levels: 2 }, proves: "every channel takes one of two levels",
    check: (fx) => binary(fx) && near(px(fx, 320, 180), WHITE, 2) && near(px(fx, 460, 250), BLACK, 2) },
  halftone: { params: { dotSize: 30 }, proves: "white stays paper, black is full dots, grey is a dot pattern, with a fill",
    check: (fx) => luma(mean(fx, 60, 60, 140, 100)) > 250 && luma(mean(fx, 440, 230, 480, 270)) < 70 && luma(mean(fx, 250, 150, 350, 210)) > 60 && luma(mean(fx, 250, 150, 350, 210)) < 200 && share(fx, (c) => c[0] === c[1] && c[1] === c[2]) === 1 },
  sketch: { params: { edgeStrength: 100, paper: 0 }, proves: "flat areas are white paper and edges are dark lines",
    check: (fx) => near(px(fx, 320, 180), WHITE, 2) && near(px(fx, 100, 80), WHITE, 2) && luma(px(fx, 40, 80)) < 60 && luma(px(fx, 400, 80)) < 200 },
  cartoon: { params: { edgeStrength: 100, levels: 2 }, proves: "colour is flattened to its levels and edges are drawn dark",
    check: (fx) => near(px(fx, 320, 180), WHITE, 2) && near(px(fx, 460, 80), [255, 0, 0], 2) && luma(px(fx, 40, 80)) < 60 },
  emboss: { proves: "flat areas are mid-grey whatever their colour and edges are raised or sunk",
    check: (fx) => near(px(fx, 320, 180), GREY, 3) && near(px(fx, 100, 80), GREY, 3) && near(px(fx, 460, 250), GREY, 3) && !near(px(fx, 40, 80), GREY, 20) },
  "neon-edges": { params: { glow: 100, threshold: 30 }, proves: "edges are drawn in the colour over black, with a glow around them",
    check: (fx) => near(px(fx, 320, 180), BLACK, 3) && px(fx, 40, 80)[2] > 150 && px(fx, 40, 80)[0] < 60 && px(fx, 30, 80)[2] > 4 && px(fx, 20, 80)[2] < px(fx, 30, 80)[2] },
  duotone: { proves: "luma is mapped from the shadow colour to the highlight colour",
    check: (fx) => near(px(fx, 460, 250), [27, 10, 74], 3) && near(px(fx, 100, 80), [255, 210, 63], 3) },
  invert: { proves: "every channel is replaced by its complement",
    check: (fx) => near(px(fx, 100, 80), BLACK, 2) && near(px(fx, 460, 80), [0, 255, 255], 2) && near(px(fx, 320, 180), [127, 127, 127], 2) },
  threshold: { params: { level: 60 }, proves: "luma above the level is white and below it black",
    check: (fx) => binary(fx) && near(px(fx, 320, 180), BLACK, 2) && near(px(fx, 100, 80), WHITE, 2) && near(px(fx, 460, 80), BLACK, 2) },
  glow: { params: { intensity: 100, radius: 60, threshold: 80 }, proves: "what is brighter than the threshold bleeds light around itself and nothing gets darker",
    check: (fx, o) => luma(px(fx, 33, 80)) > luma(px(o, 33, 80)) + 10 && near(px(fx, 320, 200), GREY, 2) && never(fx, o) },
  "light-leak": { params: { intensity: 100, speed: 0, position: 0 }, proves: "a vertical band of warm light is added",
    check: (fx, o) => { let best = 0; for (let x = 0; x < 640; x += 4) best = Math.max(best, px(fx, x, 180)[0] - px(o, x, 180)[0]); return best > 100 && never(fx, o) && mean(fx, 0, 150, 640, 210)[0] > mean(fx, 0, 150, 640, 210)[2] + 10; } },
  "lens-flare": { proves: "a core at the light position, and ghosts on the line through the centre",
    check: (fx, o) => px(fx, 192, 108)[0] > 240 && px(fx, 422, 238)[0] > 12 && px(fx, 422, 238)[0] < 40 && near(px(fx, 20, 340), px(o, 20, 340), 3) && never(fx, o) },
  "light-rays": { params: { intensity: 100, length: 100 }, proves: "bright areas throw rays away from the centre",
    check: (fx, o) => luma(px(fx, 28, 30)) > luma(px(o, 28, 30)) + 4 && near(px(fx, 600, 300), px(o, 600, 300), 2) && never(fx, o) },
  strobe: { params: { frequency: 1, intensity: 50 }, proves: "the colour is added in the first half of each period and nothing in the second",
    check: async (fx, o) => near(px(fx, 320, 180), WHITE, 3) && near(px(fx, 460, 250), GREY, 3) && worst(await effectShot(harness, "strobe", { frequency: 1, intensity: 50 }, { time: 88000 }), o) <= 1 },
  spotlight: { proves: "outside the radius the picture is darkened and the middle is untouched",
    check: (fx) => near(px(fx, 320, 180), GREY, 2) && near(px(fx, 5, 5), [38, 38, 38], 4) },
  "rgb-split": { params: { amount: 100, angle: 0 }, proves: "red and blue are sampled 6.7 px to either side",
    check: (fx) => near(px(fx, 163, 80), [128, 128, 255], 6) && near(px(fx, 157, 80), [128, 255, 255], 6) },
  glitch: { params: { intensity: 100, blockSize: 30, speed: 0, seed: 1 }, proves: "bands of rows are shifted sideways by 20 px",
    check: (fx) => (px(fx, 30, 80)[1] > 200) !== (px(fx, 50, 80)[1] < 200) },
  "scan-jitter": { params: { amount: 100, speed: 0, seed: 1 }, proves: "each scanline is shifted by its own amount",
    check: (fx) => { const column = share(fx, (c) => luma(c) > 200, 37, 45, 38, 115); return column > 0.05 && column < 0.95; } },
  "signal-loss": { params: { intensity: 100, bandHeight: 20, speed: 0 }, proves: "one horizontal band 20 % of the frame high is replaced by noise",
    check: (fx, o) => { let rows = 0; for (let y = 0; y < 360; y++) if (share(fx, (c, x) => !near(c, px(o, x, y), 8), 250, y, 390, y + 1) > 0.5) rows++; return rows >= 68 && rows <= 76; } },
  "pixel-sort": { params: { threshold: 40, length: 100, direction: "vertical" }, proves: "bright pixels smear toward −y and pixels under the threshold are left alone",
    check: (fx, o) => near(px(fx, 100, 20), WHITE, 3) && near(px(fx, 100, 130), GREY, 3) && near(px(fx, 460, 250), BLACK, 2) && near(px(o, 100, 20), GREY, 2) },
  vhs: { params: { tracking: 0, chromaBleed: 100, noise: 0, scanlines: 100 }, proves: "every second row is darkened by 30 % and colour bleeds sideways",
    check: (fx) => { const a = luma(px(fx, 320, 20)), b = luma(px(fx, 320, 21)); return Math.abs(Math.min(a, b) / Math.max(a, b) - 0.7) < 0.03 && px(fx, 397, 80)[0] > px(fx, 397, 80)[1] + 6; } },
  crt: { params: { curvature: 100, scanlines: 100, vignette: 0 }, proves: "the picture is bent like a tube with black outside, with scanlines and an RGB mask",
    check: (fx) => near(px(fx, 1, 1), BLACK, 2) && near(px(fx, 638, 358), BLACK, 2) && new Set([0, 1, 2].map((dx) => px(fx, 300 + dx, 100).indexOf(Math.max(...px(fx, 300 + dx, 100))))).size === 3 && Math.abs(Math.min(luma(px(fx, 300, 100)), luma(px(fx, 300, 101))) / Math.max(luma(px(fx, 300, 100)), luma(px(fx, 300, 101))) - 0.6) < 0.05 },
  "film-grain": { params: { amount: 100, monochrome: true, seed: 1 }, proves: "monochrome Gaussian noise of amplitude 0.2 is added",
    check: (fx) => { const region: number[] = []; for (let y = 150; y < 210; y++) for (let x = 250; x < 350; x++) region.push(px(fx, x, y)[0]); const average = region.reduce((sum, value) => sum + value, 0) / region.length; const deviation = Math.sqrt(region.reduce((sum, value) => sum + (value - average) ** 2, 0) / region.length); return Math.abs(average - 128) < 8 && deviation > 35 && deviation < 60 && share(fx, (c) => c[0] === c[1] && c[1] === c[2], 250, 150, 350, 210) === 1; } },
  "old-film": { params: { scratches: 100, flicker: 0, sepia: 100, grain: 0 }, proves: "the picture is sepia and five scratches run down the frame",
    check: (fx) => { let columns = 0; for (let x = 0; x < 640; x++) if (px(fx, x, 180)[0] > 190 && px(fx, x, 200)[0] > 190) columns++; return columns >= 1 && columns <= 5 && share(fx, (c) => near(c, [128, 110, 79], 3), 250, 150, 350, 210) > 0.9; } },
  super8: { params: { borderSize: 100, jitter: 0, warmth: 100 }, proves: "a black gate with rounded corners frames the picture, which is warmed",
    check: (fx) => near(px(fx, 10, 180), BLACK, 2) && near(px(fx, 320, 10), BLACK, 2) && near(px(fx, 57, 57), BLACK, 2) && px(fx, 320, 180)[0] > px(fx, 320, 180)[2] + 10 },
  "bit-crush": { params: { pixelSize: 60, colors: 8 }, proves: "20 px blocks, two levels per channel",
    check: (fx) => binary(fx) && near(px(fx, 41, 41), px(fx, 59, 59), 0) },
  snow: { params: { density: 100, size: 12, speed: 2, seed: 1 }, proves: "white flakes are added over the picture",
    check: (fx, o) => brighter(fx, o) > 0.003 && brighter(fx, o) < 0.3 && never(fx, o) && share(fx, (c, x, y) => { const d = c.map((value, index) => value - px(o, x, y)[index]); return Math.abs(d[0] - d[1]) > 6 && c[0] < 250 && c[1] < 250; }, 180, 130, 380, 220) === 0 },
  rain: { params: { density: 100, length: 100, opacity: 100 }, proves: "bright slanted streaks are added over the picture",
    check: (fx, o) => brighter(fx, o) > 0.003 && brighter(fx, o) < 0.3 && never(fx, o) },
  sparkles: { params: { density: 100, size: 40, twinkleSpeed: 1, color: "#00ff00" }, proves: "stars in the colour are added",
    check: (fx, o) => share(fx, (c, x, y) => c[1] > px(o, x, y)[1] + 40 && c[0] <= px(o, x, y)[0] + 2) > 0.0005 && never(fx, o) },
  bokeh: { params: { density: 100, size: 100, speed: 0 }, proves: "soft discs of light at 35 % are added",
    check: (fx, o) => brighter(fx, o, 30) > 0.05 && never(fx, o) },
  confetti: { params: { density: 100, size: 30 }, proves: "coloured rectangles are added",
    check: (fx, o) => share(fx, (c, x, y) => { const d = c.map((value, index) => value - px(o, x, y)[index]); return Math.max(...d) - Math.min(...d) > 60; }) > 0.002 && never(fx, o) },
  dust: { params: { density: 100, size: 10 }, proves: "white motes at 40 % are added",
    check: (fx, o) => brighter(fx, o, 20) > 0.001 && brighter(fx, o, 20) < 0.3 && never(fx, o) },
  vignette: { proves: "the corners are mixed toward the colour and the middle is untouched",
    check: (fx) => near(px(fx, 320, 180), GREY, 2) && near(px(fx, 2, 2), [77, 77, 77], 5) },
  "chromatic-aberration": { params: { amount: 100 }, proves: "red is sampled further out and blue further in",
    check: (fx) => near(px(fx, 45, 80), [128, 255, 255], 8) && near(px(fx, 320, 180), GREY, 2) },
  "lens-distortion": { params: { barrel: 100, autoFit: false }, proves: "barrel distortion pulls the border in (transparent without auto-fit, filled with it)",
    check: async (fx) => near(px(fx, 2, 2), BLACK, 2) && near(px(fx, 320, 180), GREY, 2) && near(px(await effectShot(harness, "lens-distortion", { barrel: 100, autoFit: true }), 2, 2), GREY, 4) },
  letterbox: { proves: "rows outside a centred 2.35 : 1 band are filled",
    check: (fx, o) => near(px(fx, 320, 40), BLACK, 2) && near(px(fx, 320, 48), px(o, 320, 48), 2) && near(px(fx, 320, 318), BLACK, 2) && near(px(fx, 100, 80), WHITE, 2) },
  "lens-zoom": { params: { amount: 200 }, proves: "the picture is magnified two times about the centre",
    check: (fx) => near(px(fx, 600, 320), BLACK, 3) && near(px(fx, 460, 250), GREY, 3) },
  "slow-zoom": { params: { startScale: 100, endScale: 200 }, options: { time: 0 }, proves: "the scale runs from start to end across the element",
    check: async (fx, o) => worst(fx, o) <= 2 && near(px(await effectShot(harness, "slow-zoom", { startScale: 100, endScale: 200 }, { time: 116000 }), 600, 320), BLACK, 3) },
  "pan-drift": { params: { direction: "left", distance: 50 }, options: { time: 0 }, proves: "the enlarged picture travels along the direction across the element",
    check: async (fx) => { const column = (frame: Frame) => { let sum = 0, count = 0; for (let y = 0; y < 360; y += 2) for (let x = 0; x < 640; x += 2) if (luma(px(frame, x, y)) < 10) { sum += x; count++; } return sum / count; }; const end = await effectShot(harness, "pan-drift", { direction: "left", distance: 50 }, { time: 116000 }); return column(end) < column(fx) - 200; } },
  "photo-frame": { params: { borderSize: 100, tilt: 0 }, proves: "the picture is scaled to 60 %, moved up, on a border in the colour",
    check: (fx, o) => near(px(fx, 320, 300), WHITE, 2) && near(px(fx, 100, 144), WHITE, 2) && near(px(fx, 320, 144), px(o, 320, 180), 3) && near(px(fx, 320, 20), WHITE, 2) && near(px(fx, 404, 186), BLACK, 6) },
  "body-outline": { params: { width: 30, glow: 0 }, options: body, proves: "a stroke in the colour runs along the edge of the person",
    check: (fx, o) => near(px(fx, 440, 200), WHITE, 6) && near(px(fx, 200, 200), WHITE, 6) && near(px(fx, 320, 200), px(o, 320, 200), 3) && near(px(fx, 20, 340), px(o, 20, 340), 3) },
  "body-glow": { params: { intensity: 100, radius: 40 }, options: body, proves: "a halo in the colour surrounds the person and the person is untouched",
    check: (fx, o) => px(fx, 450, 200)[2] > px(o, 450, 200)[2] + 30 && near(px(fx, 320, 200), px(o, 320, 200), 3) && near(px(fx, 20, 340), px(o, 20, 340), 4) },
  "background-blur": { params: { intensity: 100 }, options: body, proves: "what is behind the person is blurred and the person is sharp",
    check: (fx, o) => luma(px(fx, 43, 80)) < 245 && near(px(fx, 320, 200), px(o, 320, 200), 2) },
  "background-mono": { options: body, proves: "what is behind the person is greyscale and the person keeps its colour",
    check: (fx, o) => near(px(fx, 500, 80), [54, 54, 54], 3) && near(px(fx, 100, 270), [18, 18, 18], 3) && near(px(fx, 420, 250), px(o, 420, 250), 2) },
  "body-echo": { params: { copies: 1, distance: 300, angle: 90, fade: 0 }, options: body, proves: "a copy of the person is drawn displaced behind the person",
    check: (fx, o) => near(px(o, 420, 350), GREY, 2) && near(px(fx, 420, 350), BLACK, 6) && near(px(fx, 320, 200), px(o, 320, 200), 2) },
};

test("Bundled effect library — every effect renders what its catalogue row describes; No effect needs frame history", async () => {
  const failures: string[] = [];
  for (const definition of EFFECT_DEFINITIONS) {
    if (definition.type === "blur") continue;
    const entry = CHECKS[definition.type];
    if (!entry) { failures.push(`${definition.type}: no pixel check`); continue; }
    // One frame, with no other frame rendered or decoded for it.
    const fx = await effectShot(harness, definition.type, entry.params ?? {}, entry.options ?? {});
    if (fx.diagnostics.length > 0) failures.push(`${definition.type}: ${fx.diagnostics.join(", ")}`);
    else if (!(await entry.check(fx, plain))) failures.push(`${definition.type}: does not show that ${entry.proves}`);
  }
  assert.deepEqual(failures, []);
  assert.deepEqual(harness.errors.filter((error) => !error.includes("adapter") && !error.includes("404")), []);
});

test("Deterministic time-driven effects — Seek determinism; Seed changes the pattern; a speed of 0 freezes the animation", async () => {
  const snow = (seed: number, time: number, speed = 2) => effectShot(harness, "snow", { density: 100, size: 12, speed, seed }, { time });
  const first = await snow(0, 240000 * 0 + 80000);
  await snow(0, 12000);
  assert.equal(worst(await snow(0, 80000), first), 0, "the same time renders the same frame after another seek");
  assert.ok(changed(await snow(1, 80000), first) > 0.001, "another seed gives another pattern");
  assert.ok(changed(await snow(0, 84000), first) > 0.001, "the flakes move with time");
  assert.equal(worst(await snow(0, 80000, 0), await snow(0, 4000, 0)), 0, "speed 0 holds the time-zero state");
  const glitch = (seed: number) => effectShot(harness, "glitch", { intensity: 50, blockSize: 10, speed: 5, seed }, { time: 80000 });
  assert.ok(changed(await glitch(0), await glitch(1)) > 0.001, "Seed changes the pattern");
});

test("Resolution-independent effect parameters — Clip effect uses the element box; Rotated clip; Same effect as a layer uses the canvas; Same look at two resolutions; Particles on a cut-out clip", async () => {
  const half = { position: { x: 0, y: 0 }, scale: { x: 0.5, y: 0.5 }, rotation: 0 };
  // A vignette on a clip scaled to 50 %: centred on and bounded by the clip (the box is 160…480 × 90…270).
  const vignette = await effectShot(harness, "vignette", { amount: 100, size: 30, softness: 20 }, { clip: true, transform: half });
  assert.ok(near(px(vignette, 320, 180), [128, 128, 128], 3) && near(px(vignette, 164, 94), [0, 0, 0], 12), "the clip's own corners are dark");
  assert.ok(near(px(vignette, 100, 180), [0, 0, 0], 1), "nothing is written outside the box");
  // Tile 2 × 2 on a clip scaled to 50 % and rotated 30°: four copies fill the rotated box, edges along the box.
  const rotated = { ...half, rotation: 30 };
  const tile = await effectShot(harness, "tile", { rows: 2, columns: 2 }, { clip: true, transform: rotated });
  const without = await shot(harness, `const doc = lab.project(); doc.scenes[0].tracks.main.elements.push(lab.image("m", "t", { transform: args })); return lab.frame(doc, 0);`, rotated);
  const at = (u: number, v: number): [number, number] => { const x = (u - 0.5) * 320, y = (v - 0.5) * 180, c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6); return [320 + x * c - y * s, 180 + x * s + y * c]; };
  // The black disc of T sits at uv (0.72, 0.69); each copy shows it at half that, plus its quadrant.
  for (const [u, v] of [[0.36, 0.345], [0.86, 0.345], [0.36, 0.845], [0.86, 0.845]]) assert.ok(near(px(tile, ...at(u, v)), [0, 0, 0], 12), `a copy of the disc at uv ${u}, ${v}`);
  assert.equal(share(tile, (c, x, y) => { const dx = x - 320, dy = y - 180, c30 = Math.cos(Math.PI / 6), s30 = Math.sin(Math.PI / 6); const u = (dx * c30 + dy * s30) / 320, v = (-dx * s30 + dy * c30) / 180; return (Math.abs(u) > 0.52 || Math.abs(v) > 0.52) && !near(c, px(without, x, y), 2); }), 0, "no pixel outside the box changes");
  // As a standalone layer the same effect divides the whole canvas into four upright copies.
  const layer = await effectShot(harness, "tile", { rows: 2, columns: 2 });
  assert.ok(near(px(layer, 230, 125), [0, 0, 0], 4) && near(px(layer, 550, 305), [0, 0, 0], 4));
  // Mosaic blockSize 24: 8 px blocks at 640 wide (24 px at 1920, 48 px at 3840).
  const mosaic = await effectShot(harness, "mosaic", { blockSize: 24 });
  assert.ok(near(px(mosaic, 400, 121), px(mosaic, 407, 127), 0) && !near(px(mosaic, 400, 119), px(mosaic, 400, 121), 20), "8 px cells on the 8 px grid");
  // Snow on a clip whose picture is half transparent (a mask): snow only where the clip has picture.
  const cut = await shot(harness, `const doc = lab.project({ kind: "color", color: "#000000" }); doc.scenes[0].tracks.main.elements.push(lab.image("m", "t", { chromaKey: { enabled: true, color: "#808080", strength: 10, edge: 0, shadow: 0, spill: 0 }, effects: [{ id: "fx", type: "snow", kind: "effect", enabled: true, params: { density: 100, size: 12 } }] })); return lab.frame(doc, 40000);`);
  assert.equal(share(cut, (c) => !near(c, [0, 0, 0], 2), 200, 130, 380, 200), 0, "the keyed-out area stays transparent");
  assert.ok(share(cut, (c) => luma(c) > 60, 40, 220, 160, 320) > 0.001, "snow falls over the picture that is left");
});

test("Per-element processing order — Array order is render order for effects; Reordering changes the result; Disabled entry is skipped; Effect and filter data model — Filter position in the array does not change the picture; Effect definition registry — Unknown effect type is preserved", async () => {
  const stack = (effects: unknown[]) => shot(harness, `const doc = lab.project(); doc.scenes[0].tracks.main.elements.push(lab.image("m", "t", { effects: args })); return lab.frame(doc, 0);`, effects);
  const mosaic = { id: "a", type: "mosaic", kind: "effect", enabled: true, params: { blockSize: 120 } };
  const vignette = { id: "b", type: "vignette", kind: "effect", enabled: true, params: { amount: 100, size: 10, softness: 100 } };
  const smooth = await stack([mosaic, vignette]), blocky = await stack([vignette, mosaic]);
  // Inside one 40 px mosaic cell of flat grey (cell 240…280 × 160…200): a vignette on top varies, one beneath is quantised.
  assert.ok(!near(px(smooth, 242, 162), px(smooth, 278, 198), 1), "the vignette gradient is smooth over the blocks");
  assert.ok(near(px(blocky, 242, 162), px(blocky, 278, 198), 0), "the vignette is quantised into blocks");
  assert.equal(worst(await stack([{ ...mosaic, enabled: false }, vignette]), await stack([vignette])), 0);
  const sepia = { id: "f", type: "sepia", kind: "filter", enabled: true, params: { intensity: 100 } };
  assert.equal(worst(await stack([mosaic, sepia]), await stack([sepia, mosaic])), 0);
  const unknown = await stack([{ id: "u", type: "vendor-x", kind: "effect", enabled: true, params: { anything: 1 } }]);
  assert.equal(worst(unknown, plain), 0, "an unregistered type renders as a pass-through");
  assert.deepEqual(unknown.diagnostics, ["shader/unsupported:vendor-x"]);
});

test("Body effects use the on-device person matte — Background blur keeps the person sharp; Matte still computing; Body effect on an image", async () => {
  const blur = await effectShot(harness, "background-blur", { intensity: 40 }, { clip: true });
  assert.ok(near(px(blur, 320, 200), px(plain, 320, 200), 2) && luma(px(blur, 42, 80)) < 250);
  // A clip whose asset has no matte yet renders without the body effect.
  const waiting = await shot(harness, `const doc = lab.project(); doc.scenes[0].tracks.main.elements.push(lab.image("m", "a", { effects: [{ id: "fx", type: "background-mono", kind: "effect", enabled: true, params: {} }] })); return lab.frame(doc, 0);`);
  const bare = await shot(harness, `const doc = lab.project(); doc.scenes[0].tracks.main.elements.push(lab.image("m", "a")); return lab.frame(doc, 0);`);
  assert.equal(worst(waiting, bare), 0);
  // Body Echo on a still: the copies are behind the person.
  const echo = await effectShot(harness, "body-echo", { copies: 2, distance: 150, angle: 0, fade: 50 }, { clip: true });
  assert.ok(near(px(echo, 320, 200), px(plain, 320, 200), 2) && changed(echo, plain) > 0.005);
});
