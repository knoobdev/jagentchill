// Pixel tests of the transition library: every transition id of `transitions/catalog.md` renders what its row
// describes. A is red (192, 32, 32) with a white square at 40…120 × 40…120; B is blue (32, 64, 192) with a white
// square at 520…600 × 240…320 (`lab.ts`, 640 × 360, pixel scale factor 1/3, half diagonal D = 367 px).
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { after, before, test } from "node:test";
import { TRANSITION_DEFINITIONS } from "@jagentchill/editor-core";
import { cubicBezier } from "../../src/frame/library.ts";
import { startHarness, type Harness } from "./harness.ts";
import { BLACK, BLUE_B, changed, installLab, luma, mix, near, px, RED_A, share, shot, transitionShot, transitionShotAtSize, WHITE, worst, type Frame, type Rgb } from "./lab.ts";

let harness: Harness, onlyA: Frame, onlyB: Frame;
const clip = (id: string) => shot(harness, `const doc = lab.project(); doc.scenes[0].tracks.main.elements.push(lab.image("m", args)); return lab.frame(doc, 0);`, id);
before(async () => {
  harness = await startHarness();
  await installLab(harness, process.env.JC_BACKEND === "webgl2" ? "webgl2" : undefined);
  onlyA = await clip("a");
  onlyB = await clip("b");
});
after(async () => { await harness?.close(); });

const a = RED_A, b = BLUE_B, GREEN: Rgb = [0, 255, 0];
const isA = (frame: Frame, x: number, y: number) => near(px(frame, x, y), a, 4), isB = (frame: Frame, x: number, y: number) => near(px(frame, x, y), b, 4);
type Step = { p: number; params?: Record<string, unknown>; check: (frame: Frame, dissolve: Frame) => boolean };
type Check = { proves: string; steps: Step[] };
const at = (p: number, check: Step["check"], params?: Record<string, unknown>): Step => ({ p, params, check });
// The colour-only version of a hard cut at p: A before 0.5, B from 0.5 on.
const cut = (frame: Frame, p: number) => (p < 0.5 ? isA(frame, 320, 180) : isB(frame, 320, 180));

const CHECKS: Record<string, Check> = {
  "cross-dissolve": { proves: "each pixel is mix(A, B, p)", steps: [at(0.5, (f) => near(px(f, 320, 180), mix(a, b, 0.5), 1) && near(px(f, 80, 80), mix(WHITE, b, 0.5), 1)), at(0.25, (f) => near(px(f, 320, 180), mix(a, b, 0.25), 1))] },
  "dip-to-black": { proves: "A fades to black, then black fades to B", steps: [at(0.5, (f) => share(f, (c) => near(c, BLACK, 1)) === 1), at(0.25, (f) => near(px(f, 320, 180), mix(a, BLACK, 0.5), 2)), at(0.75, (f) => near(px(f, 320, 180), mix(BLACK, b, 0.5), 2)), at(0.4, (f) => share(f, (c) => near(c, BLACK, 1)) === 1, { hold: 50 })] },
  "dip-to-white": { proves: "A fades to white, then white fades to B", steps: [at(0.5, (f) => share(f, (c) => near(c, WHITE, 1)) === 1), at(0.25, (f) => near(px(f, 320, 180), mix(a, WHITE, 0.5), 2))] },
  "dip-to-color": { proves: "A fades to the colour, then the colour fades to B", steps: [at(0.5, (f) => share(f, (c) => near(c, GREEN, 1)) === 1, { color: "#00ff00" }), at(0.75, (f) => near(px(f, 320, 180), mix(GREEN, b, 0.5), 2), { color: "#00ff00" })] },
  "additive-dissolve": { proves: "min(1, A (1 − p)(1 + p) + B p (2 − p))", steps: [at(0.5, (f) => near(px(f, 320, 180), [168, 72, 168], 2) && near(px(f, 80, 80), [215, 239, 255], 2))] },
  "linear-wipe": { proves: "B enters along the angle behind a straight edge", steps: [at(0.25, (f) => isB(f, 150, 180) && isA(f, 170, 180), { softness: 0 }), at(0.25, (f) => isB(f, 320, 80) && isA(f, 320, 100), { softness: 0, angle: 90 }), at(0.5, (f) => near(px(f, 320, 180), mix(a, b, 0.5), 6) && isB(f, 250, 180) && isA(f, 390, 180), { softness: 20 })] },
  "clock-wipe": { proves: "B is revealed by a hand sweeping from the start angle", steps: [at(0.25, (f) => isB(f, 380, 120) && isA(f, 380, 240) && isA(f, 260, 120), { softness: 0 }), at(0.25, (f) => isB(f, 260, 120) && isA(f, 380, 120), { softness: 0, direction: "counter-clockwise" }), at(0.25, (f) => isB(f, 380, 240) && isA(f, 380, 120), { softness: 0, startAngle: 90 })] },
  "barn-door": { proves: "B grows outward from the centre line, or inward from both edges", steps: [at(0.5, (f) => isB(f, 320, 180) && isB(f, 170, 180) && isA(f, 150, 180) && isA(f, 500, 180), { softness: 0 }), at(0.5, (f) => isA(f, 320, 180) && isB(f, 150, 180) && isB(f, 500, 300), { softness: 0, mode: "close" }), at(0.5, (f) => isB(f, 320, 100) && isA(f, 320, 80), { softness: 0, orientation: "vertical" })] },
  slide: { proves: "B slides in over a static A", steps: [at(0.5, (f) => isB(f, 330, 180) && near(px(f, 80, 80), WHITE, 2) && isA(f, 300, 180)), at(0.5, (f) => isB(f, 320, 170) && isA(f, 320, 190) && near(px(f, 560, 100), WHITE, 2), { direction: "down" })] },
  push: { proves: "A is pushed out as B follows edge to edge", steps: [at(0.5, (f) => isA(f, 80, 80) && isA(f, 310, 180) && isB(f, 330, 180)), at(0.25, (f) => near(px(f, 240, 80), WHITE, 2) && isB(f, 80, 80) && isA(f, 400, 80), { direction: "right" })] },
  cover: { proves: "B slides over A and throws a shadow ahead of its edge", steps: [at(0.5, (f) => isB(f, 330, 180) && near(px(f, 80, 80), WHITE, 2) && near(px(f, 318, 180), [a[0] * 0.7, a[1] * 0.7, a[2] * 0.7], 8) && isA(f, 300, 180))] },
  uncover: { proves: "A slides away from a static B, its shadow on B", steps: [at(0.5, (f) => isA(f, 100, 180) && near(px(f, 560, 280), WHITE, 2) && near(px(f, 322, 180), [b[0] * 0.7, b[1] * 0.7, b[2] * 0.7], 8) && isB(f, 345, 180))] },
  "elastic-slide": { proves: "a push whose progress springs past the end and settles", steps: [at(0.1, (f) => isA(f, 40, 180) && isB(f, 70, 180), { bounce: 0 }), at(0.25, (f) => share(f, (c) => near(c, b, 4) || near(c, WHITE, 4)) === 1 && !near(px(f, 560, 280), WHITE, 4), { bounce: 100 })] },
  "zoom-in": { proves: "A grows and gives way to B, which grows to full size", steps: [at(0.2, (f) => near(px(f, 30, 30), WHITE, 3) && isA(f, 320, 180), { scale: 200, blur: 0 }), at(0.8, (f) => isB(f, 320, 180) && near(px(f, 2, 2), BLACK, 2), { scale: 200, blur: 0 }), at(0.2, (f) => luma(px(f, 30, 30)) < 250 && luma(px(f, 30, 30)) > 80, { scale: 200, blur: 100 })] },
  "zoom-out": { proves: "A shrinks away and B shrinks from large to full size", steps: [at(0.2, (f) => near(px(f, 5, 5), BLACK, 2) && isA(f, 320, 180), { scale: 200, blur: 0 }), at(0.8, (f) => isB(f, 320, 180) && isB(f, 5, 5), { scale: 200, blur: 0 })] },
  "whip-pan": { proves: "a push blurred along its direction", steps: [at(0.5, (f) => isA(f, 310, 180) && isB(f, 330, 180), { blur: 0 }), at(0.5, (f) => !isA(f, 310, 180) && !isB(f, 330, 180) && near(px(f, 320, 180), mix(a, b, 0.5), 12) && isA(f, 320 - 80, 180) && isB(f, 320 + 80, 180), { blur: 100 })] },
  spin: { proves: "both pictures turn about the centre and cross-fade", steps: [at(0.2, (f) => near(px(f, 123, 16), WHITE, 6) && isA(f, 320, 180), { turns: 0.25, blur: 0 }), at(0.2, (f) => !near(px(f, 123, 16), WHITE, 30), { turns: 0.25, blur: 0, direction: "counter-clockwise" }), at(0.8, (f) => isB(f, 320, 180), { turns: 0.25, blur: 0 })] },
  roll: { proves: "A turns about a bottom corner over a static B", steps: [at(0.5, (f) => isB(f, 600, 20) && near(px(f, 560, 280), WHITE, 2) && isA(f, 100, 300) && isB(f, 30, 200)), at(0.5, (f) => isB(f, 40, 20) && isA(f, 540, 300) && isB(f, 610, 200), { direction: "counter-clockwise" })] },
  "shake-cut": { proves: "a hard cut at the middle with both sides shaken", steps: [at(0.25, (f) => isA(f, 320, 180) && changed(f, onlyA) > 0.0005, { intensity: 100, seed: 1 }), at(0.75, (f) => isB(f, 320, 180) && changed(f, onlyB) > 0.0005, { intensity: 100, seed: 1 })] },
  "pull-focus": { proves: "the mix goes out of focus in the middle (sigma 6.7 px: a step keeps 63 % of its height across ±6 px)", steps: [at(0.5, (f) => Math.abs(Math.abs(px(f, 514, 280)[0] - px(f, 526, 280)[0]) - 70) < 12 && near(px(f, 320, 180), mix(a, b, 0.5), 3), { blur: 100 }), at(0.5, (f) => Math.abs(px(f, 514, 280)[0] - px(f, 526, 280)[0]) > 100, { blur: 0 })] },
  "blur-dissolve": { proves: "a dissolve that is blurred in the middle (sigma 6.7 px)", steps: [at(0.5, (f) => Math.abs(Math.abs(px(f, 514, 280)[0] - px(f, 526, 280)[0]) - 70) < 12 && near(px(f, 320, 180), mix(a, b, 0.5), 3), { blur: 100 }), at(0.25, (f) => near(px(f, 320, 180), mix(a, b, 0.25), 3), { blur: 100 })] },
  "directional-blur-wipe": { proves: "a dissolve blurred along the angle only", steps: [at(0.5, (f) => Math.abs(px(f, 514, 280)[0] - px(f, 526, 280)[0]) < 30 && Math.abs(px(f, 560, 236)[0] - px(f, 560, 244)[0]) > 40, { blur: 100, angle: 0 })] },
  "zoom-blur-dissolve": { proves: "a dissolve blurred along the line to the centre", steps: [at(0.5, (f) => near(px(f, 320, 180), mix(a, b, 0.5), 2) && Math.abs(px(f, 514, 280)[0] - px(f, 526, 280)[0]) < 60, { blur: 100 })] },
  "ripple-dissolve": { proves: "a dissolve with both pictures displaced in rings", steps: [at(0.5, (f, d) => near(px(f, 320, 180), mix(a, b, 0.5), 2) && changed(f, d) > 0.002 && changed(f, d) < 0.3, { amplitude: 100 })] },
  swirl: { proves: "both pictures are twirled about the centre while they mix", steps: [at(0.5, (f, d) => near(px(f, 320, 180), mix(a, b, 0.5), 3) && !near(px(f, 80, 80), px(d, 80, 80), 20) && near(px(f, 2, 2), px(d, 2, 2), 8))] },
  "liquid-warp": { proves: "both pictures are displaced along a noise field while they mix", steps: [at(0.5, (f, d) => near(px(f, 320, 180), mix(a, b, 0.5), 2) && changed(f, d) > 0.002, { strength: 100, scale: 10, seed: 1 })] },
  "domain-warp": { proves: "seeded two-axis noise bends the two pictures in opposite directions while they mix", steps: [at(0.5, (f, d) => near(px(f, 320, 180), mix(a, b, 0.5), 10) && changed(f, d) > 0.002 && changed(f, d) < 0.4, { strength: 100, scale: 8, seed: 17 })] },
  stretch: { proves: "A is stretched from its far edge as it fades and B arrives stretched", steps: [at(0.25, (f, d) => changed(f, d) > 0.01 && px(f, 320, 180)[0] > px(f, 320, 180)[2], { amount: 100 }), at(0.75, (f) => px(f, 320, 180)[2] > px(f, 320, 180)[0], { amount: 100 })] },
  "glitch-cut": { proves: "a hard cut with bands of rows displaced around it", steps: [at(0.3, (f) => { const rows = share(f, (c) => luma(c) > 200, 28, 42, 29, 118); return isA(f, 320, 10) && rows > 0.05 && rows < 0.95; }, { intensity: 100, seed: 1 }), at(0.7, (f) => px(f, 320, 180)[2] > 150, { intensity: 100, seed: 1 }), at(0.1, (f) => worst(f, onlyA) <= 1, { intensity: 100, seed: 1 })] },
  "rgb-split-cut": { proves: "a dissolve with red and blue pulled apart sideways", steps: [at(0.5, (f, d) => px(f, 530, 280)[2] < px(d, 530, 280)[2] - 20 && near(px(f, 320, 180), mix(a, b, 0.5), 2), { amount: 100 })] },
  "chromatic-split": { proves: "red and blue channels separate along the selected axis", steps: [at(0.5, (f, d) => changed(f, d) > 0.001 && changed(f, d) < 0.4 && near(px(f, 320, 180), mix(a, b, 0.5), 12), { amount: 100, direction: "horizontal" })] },
  pixelate: { proves: "a hard cut seen through a mosaic that is coarsest in the middle", steps: [at(0.5, (f) => near(px(f, 521, 241), px(f, 559, 279), 0) && isB(f, 320, 180), { maxBlock: 120 }), at(0.25, (f) => isA(f, 320, 180) && near(px(f, 1, 1), px(f, 27, 27), 0), { maxBlock: 120 })] },
  "signal-noise": { proves: "a hard cut drowned in mono noise in the middle", steps: [at(0.5, (f) => share(f, (c) => c[0] === c[1] && c[1] === c[2]) === 1 && share(f, (c) => c[0] > 128) > 0.4 && share(f, (c) => c[0] > 128) < 0.6, { intensity: 100 }), at(0.25, (f) => px(f, 320, 180)[0] !== px(f, 321, 180)[0] || px(f, 322, 180)[0] !== px(f, 323, 180)[0], { intensity: 50 })] },
  flash: { proves: "a hard cut under a flash of the colour that peaks in the middle", steps: [at(0.5, (f) => share(f, (c) => near(c, WHITE, 1)) === 1), at(0.25, (f) => near(px(f, 320, 180), [a[0] + 64, a[1] + 64, a[2] + 64], 3)), at(0.75, (f) => near(px(f, 320, 180), [b[0] + 64, b[1] + 64, b[2] + 64], 3))] },
  "light-sweep": { proves: "a soft wipe with a band of light on its front", steps: [at(0.5, (f) => isB(f, 100, 180) && isA(f, 540, 180) && px(f, 320, 180)[0] > 240 && px(f, 320, 180)[1] > 200 && px(f, 250, 180)[0] > b[0] + 20, { angle: 0 })] },
  "light-leak-transition": { proves: "a warm soft light band flares over a dissolving picture", steps: [at(0.5, (f, d) => share(f, (c, x) => c[0] > px(d, x, 180)[0] + 15, 250, 0, 390, 360) > 0.04 && changed(f, d) > 0.005, { color: "#ff8a3d", intensity: 100, position: 0 })] },
  "film-burn": { proves: "B burns through A along a noise front that glows in the colour", steps: [at(0.5, (f) => { const aShare = share(f, (c) => near(c, a, 6)), bShare = share(f, (c) => near(c, b, 6)); return aShare > 0.1 && bShare > 0.1 && share(f, (c) => c[0] > 230 && c[1] > 90 && c[2] < 120) > 0.001; }, { intensity: 100, seed: 1 })] },
  "glow-dissolve": { proves: "a dissolve with a bloom of its bright areas", steps: [at(0.5, (f, d) => share(f, (c, x, y) => c.some((value, index) => value < px(d, x, y)[index] - 2)) === 0 && px(f, 80, 80)[0] > px(d, 80, 80)[0] + 8 && luma(px(f, 34, 80)) > luma(px(d, 34, 80)) && near(px(f, 320, 180), px(d, 320, 180), 2), { intensity: 100 })] },
  "split-horizontal": { proves: "A is cut along the horizontal centre line and its halves move up and down", steps: [at(0.5, (f) => isB(f, 320, 180) && isB(f, 320, 100) && near(px(f, 60, 20), WHITE, 2) && isA(f, 320, 80) && isA(f, 320, 280), { softness: 0 })] },
  "split-vertical": { proves: "A is cut along the vertical centre line and its halves move left and right", steps: [at(0.5, (f) => isB(f, 320, 180) && isB(f, 170, 180) && isA(f, 150, 180) && isA(f, 490, 180), { softness: 0 })] },
  "diagonal-split": { proves: "A splits along a line at the angle and the halves move apart along its normal", steps: [at(0.25, (f) => isB(f, 320, 180) && isB(f, 320, 100) && isA(f, 320, 80) && isA(f, 320, 280), { angle: 0 }), at(0.25, (f) => isB(f, 320, 180) && isA(f, 220, 180) && isA(f, 420, 180), { angle: 90 })] },
  "shutter-slices": { proves: "slices are wiped one after another", steps: [at(0.25, (f) => isB(f, 70, 180) && isA(f, 90, 180) && isB(f, 190, 180) && isA(f, 210, 180) && isA(f, 330, 180), { count: 4 }), at(0.25, (f) => isB(f, 320, 40) && isA(f, 320, 50) && isA(f, 320, 190), { count: 4, orientation: "horizontal" })] },
  "iris-circle": { proves: "B opens in a circle from the centre point", steps: [at(0.5, (f) => isB(f, 320, 180) && isB(f, 320 + 170, 180) && isA(f, 320 + 195, 180) && isB(f, 320, 180 + 170), { softness: 0 }), at(0.2, (f) => isB(f, 480, 180) && isA(f, 320, 180), { softness: 0, centerX: 50 })] },
  "iris-shape": { proves: "B opens in the chosen shape", steps: [
    at(0.5, (f) => isB(f, 470, 180) && isA(f, 490, 180) && isB(f, 320, 260) && isA(f, 320, 280), { shape: "rectangle", softness: 0 }),
    at(0.5, (f) => isB(f, 470, 180) && isA(f, 570, 320), { shape: "diamond", softness: 0 }),
    // Star: the points reach p × D / 0.45 and the inner vertices (36° from a point) p × D.
    at(0.5, (f) => isB(f, 320, 10) && isA(f, 438, 18) && isB(f, 391, 83) && isB(f, 320, 180), { softness: 0 }),
    // Heart: the notch above the centre reaches p × D, the tip below it twice that.
    at(0.2, (f) => isA(f, 320, 80) && isB(f, 320, 320) && isB(f, 320, 240) && isA(f, 320, 350) && near(px(f, 270, 140), px(f, 370, 140), 2), { shape: "heart", softness: 0 })] },
  "luma-fade": { proves: "the brightest areas of A change first", steps: [at(0.5, (f) => isB(f, 80, 80) && isA(f, 320, 180), { softness: 0 }), at(0.5, (f) => near(px(f, 80, 80), WHITE, 2) && isB(f, 320, 180), { softness: 0, invert: true })] },
  "noise-dissolve": { proves: "pixels switch to B in the order of a noise field", steps: [at(0.5, (f) => share(f, (c) => near(c, a, 2) || near(c, b, 2) || near(c, WHITE, 2)) === 1 && share(f, (c) => near(c, b, 2)) > 0.3 && share(f, (c) => near(c, b, 2)) < 0.7, { softness: 0, seed: 1 })] },
  checkerboard: { proves: "the cells of a grid are wiped in two groups", steps: [at(0.25, (f) => isB(f, 150, 80) && isA(f, 170, 80) && isA(f, 400, 80) && isB(f, 400, 280) && isA(f, 100, 280), { rows: 2, columns: 2 }), at(0.75, (f) => isB(f, 300, 80) && isB(f, 400, 80) && isA(f, 600, 80), { rows: 2, columns: 2 })] },
  "ink-spread": { proves: "ink spreads from five points, covers the picture and recedes from B", steps: [at(0.5, (f) => share(f, (c) => near(c, GREEN, 1)) === 1, { color: "#00ff00", softness: 0, seed: 1 }), at(0.05, (f) => share(f, (c) => near(c, GREEN, 1)) > 0.02 && share(f, (c) => near(c, a, 2)) > 0.2, { color: "#00ff00", softness: 0, seed: 1 }), at(0.75, (f) => share(f, (c) => near(c, GREEN, 1) || near(c, b, 2) || near(c, WHITE, 2)) === 1 && share(f, (c) => near(c, b, 2)) > 0.02, { color: "#00ff00", softness: 0, seed: 1 })] },
  "paper-tear": { proves: "B appears behind a ragged front that has a rim in the edge colour", steps: [at(0.5, (f) => isB(f, 100, 180) && isA(f, 540, 180) && share(f, (c) => near(c, GREEN, 2), 280, 180, 360, 181) > 0, { edgeColor: "#00ff00" })] },
  "color-bars": { proves: "three coloured bars cross the canvas ahead of B", steps: [at(0.3, (f) => near(px(f, 600, 180), [245, 158, 11], 2) && near(px(f, 480, 180), [34, 211, 238], 2) && near(px(f, 330, 180), [124, 92, 255], 2) && isA(f, 200, 180)), at(0.8, (f) => isB(f, 400, 180) && near(px(f, 100, 180), [245, 158, 11], 2))] },
  "circle-burst": { proves: "rings in the colour burst from the centre and B follows inside the last one", steps: [at(0.25, (f) => isB(f, 320, 180) && isB(f, 470, 180) && near(px(f, 500, 180), GREEN, 2) && isA(f, 600, 180), { rings: 1, color: "#00ff00" })] },
  "swipe-up": { proves: "a push upward", steps: [at(0.5, (f) => isA(f, 320, 170) && isB(f, 320, 190) && isA(f, 80, 80), { bounce: 0 })] },
  flip: { proves: "a card turns from A to B, in perspective, with nothing around it", steps: [at(0.25, (f) => near(px(f, 5, 180), BLACK, 2) && isA(f, 320, 180)), at(0.75, (f) => isB(f, 320, 180) && share(f, (c) => near(c, WHITE, 6), 320, 0, 640, 360) > 0.005 && share(f, (c) => near(c, WHITE, 6), 0, 0, 320, 360) === 0), at(0.25, (f) => near(px(f, 320, 3), BLACK, 2) && isA(f, 320, 180), { axis: "vertical" })] },
  "page-turn": { proves: "the page of A curls over a line and its back lies on top, B beneath", steps: [at(0.5, (f) => near(px(f, 200, 180), [a[0] * 0.7, a[1] * 0.7, a[2] * 0.7], 5) && isA(f, 20, 180) && isB(f, 600, 180), { shadow: 100 })] },
  "cube-rotate": { proves: "A and B are adjacent faces of a turning box", steps: [at(0.5, (f) => px(f, 160, 180)[0] > 150 && px(f, 480, 180)[2] > 150 && near(px(f, 2, 2), BLACK, 2) && near(px(f, 637, 2), BLACK, 2))] },
};

test("Bundled transition library — every transition renders what its catalogue row describes; Cross dissolve midpoint; Dip to black midpoint; Transition inspector — Edit a param", async () => {
  const failures: string[] = [];
  for (const definition of TRANSITION_DEFINITIONS) {
    const entry = CHECKS[definition.type];
    if (!entry) { failures.push(`${definition.type}: no pixel check`); continue; }
    for (const step of entry.steps) {
      const frame = await transitionShot(harness, definition.type, step.params ?? {}, step.p);
      const dissolve = await transitionShot(harness, "cross-dissolve", {}, step.p);
      if (frame.diagnostics.length > 0) failures.push(`${definition.type}: ${frame.diagnostics.join(", ")}`);
      else if (!step.check(frame, dissolve)) failures.push(`${definition.type} at ${step.p} ${JSON.stringify(step.params ?? {})}: does not show that ${entry.proves}`);
    }
  }
  assert.deepEqual(failures, []);
  assert.deepEqual(harness.errors.filter((error) => !error.includes("adapter") && !error.includes("404")), []);
});

test("Bundled transition library — Progress end points", async () => {
  // Any of the 52 at progress 0 is the outgoing frame and at progress 1 the incoming frame, within 1/255.
  const failures: string[] = [];
  for (const definition of TRANSITION_DEFINITIONS) {
    const start = worst(await transitionShot(harness, definition.type, {}, 0), onlyA), end = worst(await transitionShot(harness, definition.type, {}, 1), onlyB);
    if (start > 1 || end > 1) failures.push(`${definition.type}: ${start} at 0, ${end} at 1`);
  }
  assert.deepEqual(failures, []);
});

test("Shader transition evidence — deterministic midpoint renders for Domain Warp, Light Leak and Chromatic Split", async () => {
  const cases = [
    ["domain-warp", { strength: 100, scale: 8, seed: 17 }, "domain-warp-midpoint.png"],
    ["light-leak-transition", { color: "#ff8a3d", intensity: 100, position: 0 }, "light-leak-midpoint.png"],
    ["chromatic-split", { amount: 100, direction: "horizontal" }, "chromatic-split-midpoint.png"],
  ] as const;
  const directory = resolve(import.meta.dirname, "../../../../.dev/w22c-shader-screenshots");
  mkdirSync(directory, { recursive: true });
  for (const [type, params, filename] of cases) {
    const first = await transitionShot(harness, type, params, 0.5), repeat = await transitionShot(harness, type, params, 0.5);
    assert.deepEqual(first.diagnostics, [], `${type} has no render diagnostics`);
    assert.deepEqual(repeat.data, first.data, `${type} is deterministic at the same frame tick`);
    const path = resolve(directory, filename);
    await harness.page.evaluate(({ data, width, height, title }) => {
      document.body.replaceChildren();
      document.body.style.margin = "0";
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height + 32;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#111827"; context.fillRect(0, 0, canvas.width, canvas.height);
      context.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 32);
      context.fillStyle = "#f9fafb"; context.font = "16px sans-serif"; context.fillText(`${title} · progress 0.5 · fixture frames A → B`, 12, 22);
      document.body.append(canvas);
    }, { data: Array.from(first.data), width: first.width, height: first.height, title: type });
    await harness.page.locator("canvas").screenshot({ path });
  }
});

test("Shader transitions — Domain Warp, Light Leak and Chromatic Split render at 9:16, 16:9 and 1:1", async () => {
  const cases = [
    ["domain-warp", { strength: 100, scale: 8, seed: 17 }],
    ["light-leak-transition", { color: "#ff8a3d", intensity: 100, position: 0 }],
    ["chromatic-split", { amount: 100, direction: "horizontal" }],
  ] as const;
  const sizes = [[360, 640], [640, 360], [500, 500]] as const;
  for (const [type, params] of cases) for (const [width, height] of sizes) {
    const frame = await transitionShotAtSize(harness, type, params, 0.5, width, height);
    assert.deepEqual(frame.diagnostics, [], `${type} ${width}×${height} has no render diagnostics`);
    assert.deepEqual([frame.width, frame.height], [width, height]);
    assert.equal(frame.data.length, width * height * 4);
    assert.ok(share(frame, (color) => !near(color, a, 8) && !near(color, b, 8)) > 0.05, `${type} renders a visible midpoint at ${width}×${height}`);
  }
});

test("Transition rendering — Frame-exact boundaries; Easing changes progress; Clip effects are included; Transition data model — Unknown transition type; Remove a transition — Remove restores a hard cut", async () => {
  const frames = await harness.page.evaluate(async () => {
    const { jc } = window, lab = (window as any).lab;
    const make = (type: string | null, easing: string, fromFields: Record<string, unknown> = {}) => {
      const doc = lab.project();
      doc.scenes[0].tracks.main.elements.push(lab.image("A", "a", type ? { transitionOut: "x", ...fromFields } : fromFields), jc.element("image", { id: "B", startTime: 120000, duration: 120000, mediaId: "b", ...(type ? { transitionIn: "x" } : {}) }));
      if (type) doc.scenes[0].tracks.main.transitions = [{ id: "x", kind: "transition", fromElementId: "A", toElementId: "B", duration: 120000, shape: "equal-power", type, params: {}, easing, audioCrossfade: true }];
      return doc;
    };
    const centre = (doc: unknown, time: number) => lab.turn(async () => { const built = await lab.build(doc, time); const item = built.descriptor.items.find((entry: any) => entry.type === "transition"); return { progress: item ? item.progress : null, shot: await lab.draw(built.descriptor) }; });
    const linear = make("cross-dissolve", "linear");
    return {
      // The window of 30 frames is frames 15 … 44 (ticks 60 000 … 176 000).
      before: await centre(linear, 56000), first: await centre(linear, 60000), last: await centre(linear, 176000), after: await centre(linear, 180000),
      easeIn: await centre(make("cross-dissolve", "ease-in"), 120000),
      sepia: await centre(make("cross-dissolve", "linear", { effects: [{ id: "f", type: "sepia", kind: "filter", enabled: true, params: { intensity: 100 } }] }), 120000),
      unknown: await centre(make("made-up", "linear"), 120000), dissolve: await centre(linear, 120000),
      cutBefore: await centre(make(null, "linear"), 116000), cutAt: await centre(make(null, "linear"), 120000),
    };
  });
  const read = (entry: { shot: { pixels: string; diagnostics: string[] } }): Frame => ({ width: 640, height: 360, data: new Uint8Array(Buffer.from(entry.shot.pixels, "base64")), diagnostics: entry.shot.diagnostics });
  assert.deepEqual([frames.before.progress, frames.first.progress, frames.after.progress], [null, 0, null]);
  assert.ok(Math.abs(frames.last.progress - 29 / 30) < 1e-9);
  assert.ok(worst(read(frames.before), onlyA) <= 1 && worst(read(frames.first), onlyA) <= 1 && worst(read(frames.after), onlyB) <= 1);
  // ease-in at the middle of the window: cubic-bezier(0.42, 0, 1, 1)(0.5) = 0.315.
  assert.ok(Math.abs(frames.easeIn.progress - 0.315) <= 0.01 && Math.abs(cubicBezier(0.42, 0, 1, 1, 0.5) - frames.easeIn.progress) < 1e-9, `${frames.easeIn.progress}`);
  assert.ok(near(px(read(frames.easeIn), 320, 180), mix(a, b, frames.easeIn.progress), 2));
  // The outgoing side carries its sepia filter into the mix; the incoming side has none.
  const sepia = px(read(frames.sepia), 320, 180), plainMix = px(read(frames.dissolve), 320, 180);
  assert.ok(!near(sepia, plainMix, 6) && Math.abs(sepia[2] - (plainMix[2] - a[2] / 2)) < 60 && sepia[2] >= b[2] / 2 - 1);
  // A type that is not registered renders as a cross-dissolve of the same progress.
  assert.equal(worst(read(frames.unknown), read(frames.dissolve)), 0);
  assert.deepEqual(read(frames.unknown).diagnostics, ["shader/unknown-transition:made-up"]);
  // Without a transition the frame before the cut is A and the frame at the cut is B.
  assert.ok(worst(read(frames.cutBefore), onlyA) <= 1 && worst(read(frames.cutAt), onlyB) <= 1);
});

test("Transition rendering — Blend mode of an overlay pair is kept; Different blend modes switch at the midpoint; Main-track backgrounds take part; Bundled transition library — Dip to black on a small overlay pair; Cross dissolve of partly transparent clips has no dark fringe", async () => {
  const out = await harness.page.evaluate(async () => {
    const { jc } = window, lab = (window as any).lab;
    const half = (x: number) => ({ position: { x, y: 0 }, scale: { x: 0.5, y: 1 }, rotation: 0 });
    const overlay = (type: string, fields: { from?: Record<string, unknown>; to?: Record<string, unknown> }, background = "#ffffff", under = true) => {
      const doc = lab.project({ kind: "color", color: background });
      if (under) doc.scenes[0].tracks.main.elements.push(jc.element("image", { id: "M", startTime: 0, duration: 240000, mediaId: "t" }));
      const track = jc.track("video", "o0", [lab.image("A", "a", { transitionOut: "x", ...fields.from }), jc.element("image", { id: "B", startTime: 120000, duration: 120000, mediaId: "b", transitionIn: "x", ...fields.to })]);
      track.transitions = [{ id: "x", kind: "transition", fromElementId: "A", toElementId: "B", duration: 120000, shape: "equal-power", type, params: {}, easing: "linear", audioCrossfade: true }];
      doc.scenes[0].tracks.overlay = [track];
      return doc;
    };
    const stages = (doc: unknown, time: number) => lab.turn(async () => (await lab.build(doc, time)).descriptor.items.find((entry: any) => entry.type === "transition"));
    const screen = overlay("cross-dissolve", { from: { blendMode: "screen" }, to: { blendMode: "screen" } });
    const mixed = overlay("cross-dissolve", { from: { blendMode: "multiply" }, to: { blendMode: "normal" } });
    const push = lab.project();
    push.scenes[0].tracks.main.elements.push(lab.image("A", "a", { transitionOut: "x", background: { kind: "color", color: "#0000ff" }, transform: { position: { x: 0, y: 0 }, scale: { x: 0.5, y: 0.5 }, rotation: 0 } }), jc.element("image", { id: "B", startTime: 120000, duration: 120000, mediaId: "b", transitionIn: "x", background: { kind: "color", color: "#00ff00" }, transform: { position: { x: 0, y: 0 }, scale: { x: 0.5, y: 0.5 }, rotation: 0 } }));
    push.scenes[0].tracks.main.transitions = [{ id: "x", kind: "transition", fromElementId: "A", toElementId: "B", duration: 120000, shape: "equal-power", type: "push", params: {}, easing: "linear", audioCrossfade: true }];
    return {
      screenMid: await lab.frame(screen, 120000), screenModes: [await stages(screen, 80000), await stages(screen, 160000)].map((item: any) => [item.blendModeFrom, item.blendModeTo]),
      multiply: await lab.frame(mixed, 116000), normal: await lab.frame(mixed, 120000), mixedModes: await stages(mixed, 120000).then((item: any) => [item.blendModeFrom, item.blendModeTo, item.progress]),
      dip: await lab.frame(overlay("dip-to-black", { from: { transform: half(-160) }, to: { transform: half(-160) } }), 120000),
      under: await lab.frame((() => { const doc = lab.project({ kind: "color", color: "#ffffff" }); doc.scenes[0].tracks.main.elements.push(jc.element("image", { id: "M", startTime: 0, duration: 240000, mediaId: "t" })); return doc; })(), 0),
      fringe: await lab.frame(overlay("cross-dissolve", { from: { transform: half(-160) }, to: { transform: half(160) } }, "#ffffff", false), 120000),
      push: await lab.frame(push, 120000),
    };
  });
  const read = (shot: { pixels: string; diagnostics: string[] }): Frame => ({ width: 640, height: 360, data: new Uint8Array(Buffer.from(shot.pixels, "base64")), diagnostics: shot.diagnostics });
  const under = read(out.under);
  // Screen with the layers beneath, throughout: grey 128 under mix(A, B, 0.5) = (112, 48, 112) screens to 1 − (1 − s)(1 − d).
  assert.deepEqual(out.screenModes, [["screen", "screen"], ["screen", "screen"]]);
  const expected = mix(a, b, 0.5).map((value) => 255 - ((255 - value) * (255 - 128)) / 255) as Rgb;
  assert.ok(near(px(read(out.screenMid), 320, 180), expected, 3), `${px(read(out.screenMid), 320, 180)}`);
  // Multiply up to the frame before the midpoint, Normal from the midpoint on.
  assert.deepEqual(out.mixedModes, ["multiply", "normal", 0.5]);
  assert.ok(px(read(out.multiply), 320, 180)[0] < 80, "frame 14 of the window multiplies with the grey beneath");
  assert.ok(near(px(read(out.normal), 320, 180), mix(a, b, 0.5), 2), "frame 15 composites with Normal");
  // Dip to black on a pair covering the left half: black there, the layers beneath unchanged on the right.
  const dip = read(out.dip);
  assert.equal(share(dip, (c) => near(c, BLACK, 1), 0, 0, 320, 360), 1);
  assert.equal(share(dip, (c, x, y) => near(c, px(under, x, y), 1), 320, 0, 640, 360), 1);
  // A covers the left half and B the right half, transparent elsewhere, over white: at 50 % each half is its clip at
  // half alpha over the white — the premultiplied mix darkens nothing, on the clips or along the seam.
  const fringe = read(out.fringe);
  assert.ok(near(px(fringe, 100, 180), mix(a, WHITE, 0.5), 2) && near(px(fringe, 500, 180), mix(b, WHITE, 0.5), 2), `${px(fringe, 100, 180)} ${px(fringe, 500, 180)}`);
  assert.equal(share(fringe, (c) => c[0] < 110 && c[2] < 110, 300, 0, 340, 360), 0, "no dark fringe along the seam");
  // A push between two letterboxed clips with their own backgrounds: each background travels with its clip.
  const push = read(out.push);
  assert.ok(near(px(push, 10, 20), [0, 0, 255], 2) && near(px(push, 630, 20), [0, 255, 0], 2) && share(push, (c) => near(c, BLACK, 2)) === 0);
});
