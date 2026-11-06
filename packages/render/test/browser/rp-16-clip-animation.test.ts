// Pixel tests in headless Chromium: clip animations (slide, fade, wipe reveal, blur), motion blur, frame blending, the chroma-key matte view, the eyedropper's source sample, an animated mask and bilingual captions.
import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { ffmpeg, hasFfmpeg, near, startHarness, type Harness } from "./harness.ts";

let harness: Harness;
before(async () => {
  harness = await startHarness();
  // 30 fps, frames alternately black and white: frame n is white when n is odd.
  if (hasFfmpeg()) ffmpeg(["-f", "lavfi", "-i", "color=c=black:s=64x64:r=30:d=2", "-vf", "drawbox=color=white:t=fill:enable='mod(n\\,2)'", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "30", join(harness.media, "flicker.mp4")]);
});
after(async () => { await harness?.close(); });
const SECOND = 120_000, FRAME = 4000;

test("Clip animation model — Slide In Left moves the layer, Fade In multiplies its opacity, Wipe In reveals it from the left with a soft edge, Blur In spreads it; Deterministic jitter: Shake renders pixel-identically twice", async () => {
  const result = await harness.page.evaluate(async ({ SECOND, FRAME }) => {
    const { jc } = window;
    const red = await jc.imageUrl(640, 360, (c) => { c.fillStyle = "#ff0000"; c.fillRect(0, 0, 640, 360); });
    const box = await jc.imageUrl(640, 360, (c) => { c.fillStyle = "#ffffff"; c.fillRect(220, 80, 200, 200); });
    const make = async (mediaId: string, clipAnimation: unknown, id = "e") => {
      const doc = jc.project({ width: 640, height: 360 });
      doc.media.assets.push(jc.asset("red", "image", { width: 640, height: 360 }), jc.asset("box", "image", { width: 640, height: 360 }));
      doc.scenes[0].tracks.overlay = [jc.track("video", "o0", [jc.element("image", { id, startTime: 0, duration: 4 * SECOND, mediaId, clipAnimation })])];
      return jc.open(doc, { width: 640, height: 360 }, [{ assetId: "red", original: red }, { assetId: "box", original: box }]);
    };
    const slide = await make("red", { in: { type: "slide-in-left", duration: SECOND, strength: 50 } });
    const slid = await slide.frameAt(0), settled = await slide.frameAt(SECOND);
    const fade = await (await make("red", { in: { type: "fade-in", duration: SECOND } })).frameAt(15 * FRAME);
    const wipe = await make("red", { in: { type: "wipe-in", duration: SECOND } });
    const hidden = await wipe.frameAt(0), half = await wipe.frameAt(15 * FRAME), shown = await wipe.frameAt(SECOND);
    const blur = await make("box", { in: { type: "blur-in", duration: SECOND } });
    const blurred = await blur.frameAt(6 * FRAME), sharp = await blur.frameAt(2 * SECOND);
    const shake = await make("box", { combo: { type: "shake", duration: 4 * SECOND, followsDuration: true } });
    const one = await shake.frameAt(10 * FRAME), still = await shake.frameAt(2 * SECOND), again = await shake.frameAt(10 * FRAME);
    const other = await (await make("box", { combo: { type: "shake", duration: 4 * SECOND, followsDuration: true } }, "another")).frameAt(10 * FRAME);
    const same = (a: Uint8Array, b: Uint8Array) => a.every((value, index) => value === b[index]);
    const stages = (wipe.engine as any).compositor.wasm.getLastFrameProfile?.();
    return {
      slid: [slid.at(100, 180), slid.at(400, 180)], settled: settled.at(400, 180), fade: fade.at(320, 180),
      hidden: hidden.at(100, 180), half: [half.at(100, 180), half.at(320, 180), half.at(540, 180), half.at(305, 180), half.at(335, 180)], shown: shown.at(540, 180),
      blurred: [blurred.at(215, 180), blurred.at(320, 180)], sharp: [sharp.at(215, 180), sharp.at(320, 180)],
      repeat: same(one.pixels, again.pixels), moved: !same(one.pixels, still.pixels), differs: !same(one.pixels, other.pixels), stages: Array.isArray(stages) ? stages.length : 0,
    };
  }, { SECOND, FRAME });
  // Strength 50: half the canvas to the left at the start.
  assert.ok(near(result.slid[0], [255, 0, 0, 255]) && near(result.slid[1], [0, 0, 0, 255]), `slide at 0: ${JSON.stringify(result.slid)}`);
  assert.ok(near(result.settled, [255, 0, 0, 255]));
  assert.ok(near(result.fade, [128, 0, 0, 255], 3), `fade at half: ${result.fade}`);
  assert.ok(near(result.hidden, [0, 0, 0, 255]), `wipe at 0: ${result.hidden}`);
  // reveal 0.5: the left half shows, the right is hidden, and the edge is 10 % of the box wide about the middle.
  assert.ok(near(result.half[0], [255, 0, 0, 255]) && near(result.half[2], [0, 0, 0, 255]), `wipe at half: ${JSON.stringify(result.half)}`);
  assert.ok(Math.abs(result.half[1][0] - 128) <= 6 && result.half[3][0] > 150 && result.half[3][0] < 250 && result.half[4][0] < 105 && result.half[4][0] > 5, `soft edge: ${JSON.stringify(result.half)}`);
  assert.ok(near(result.shown, [255, 0, 0, 255]));
  // The blur reaches outside the square while it runs and is gone at rest.
  assert.ok(result.blurred[0][0] > 4 && result.sharp[0][0] === 0 && result.sharp[1][0] === 255, `blur: ${JSON.stringify([result.blurred, result.sharp])}`);
  assert.deepEqual([result.repeat, result.moved, result.differs], [true, true, true]);
});

test("Motion blur — Moving element is blurred along its path: 200 px per frame at strength 50 smears 100 px horizontally and not vertically; Static element unchanged; Strength zero", async () => {
  const result = await harness.page.evaluate(async ({ SECOND, FRAME }) => {
    const { jc } = window;
    const make = async (motionBlur: unknown, moving = true) => {
      const doc = jc.project({ width: 1920, height: 1080 });
      const animations = moving ? { "transform.position.x": { keys: [{ id: "k0", time: 0, value: -900, segmentToNext: "linear" }, { id: "k1", time: 9 * FRAME, value: 900, segmentToNext: "linear" }] } } : {};
      doc.scenes[0].tracks.overlay = [jc.track("graphic", "g0", [jc.element("graphic", { id: "g", startTime: 0, duration: SECOND, definitionId: "rectangle", params: { fill: "#ffffff", strokeWidth: 0, cornerRadius: 0 }, transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0 }, animations, motionBlur })])];
      const opened = await jc.open(doc, { width: 1920, height: 1080 });
      const frame = await opened.frameAt(4 * FRAME);
      const row: number[] = [], column: number[] = [];
      for (let x = 0; x < 1920; x++) if (frame.at(x, 540)[0] > 4) row.push(x);
      // The column through the middle of the smear.
      const middle = row.length ? Math.round((row[0] + row[row.length - 1]) / 2) : 960;
      for (let y = 0; y < 1080; y++) if (frame.at(middle, y)[0] > 4) column.push(y);
      return { width: row.length, height: column.length, first: row[0], last: row[row.length - 1], centre: frame.at(middle, 540), pixels: frame.pixels };
    };
    const off = await make({ enabled: false, strength: 50, samples: 16 }), on = await make({ enabled: true, strength: 50, samples: 16 }), zero = await make({ enabled: true, strength: 0, samples: 16 });
    const still = await make({ enabled: true, strength: 50, samples: 16 }, false), stillOff = await make({ enabled: false, strength: 50, samples: 16 }, false);
    const same = (a: Uint8Array, b: Uint8Array) => a.every((value, index) => value === b[index]);
    return { off: [off.width, off.height, off.last], on: [on.width, on.height, on.last], centre: on.centre, zero: same(zero.pixels, off.pixels), still: same(still.pixels, stillOff.pixels) };
  }, { SECOND, FRAME });
  // The shape is 200 px; a trailing shutter of half a frame is 100 px of travel behind it.
  assert.ok(Math.abs(result.off[0] - 200) <= 2 && Math.abs(result.off[1] - 200) <= 2, `unblurred: ${result.off}`);
  assert.ok(Math.abs(result.on[0] - result.off[0] - 100) <= 5, `smeared across 100 ± 5 px: ${result.on[0] - result.off[0]}`);
  assert.ok(Math.abs(result.on[1] - result.off[1]) <= 1, `not smeared vertically: ${result.on[1]} against ${result.off[1]}`);
  assert.ok(Math.abs(result.on[2] - result.off[2]) <= 1, "the shutter trails: the leading edge is where the frame time puts it");
  assert.equal(result.centre[0], 255, "where every copy overlaps the layer is whole");
  assert.deepEqual([result.zero, result.still], [true, true]);
});

test("Smooth slow motion — Frame blending at 0.5×: every second output frame is the 50/50 mix of two consecutive source frames and the others equal a source frame; Off repeats frames", { skip: hasFfmpeg() ? false : "ffmpeg is not installed" }, async () => {
  const result = await harness.page.evaluate(async ({ SECOND, FRAME, origin }) => {
    const { jc } = window;
    const run = async (smooth: string) => {
      const doc = jc.project({ width: 64, height: 64 });
      doc.media.assets.push(jc.asset("v", "video", { width: 64, height: 64, duration: 2 * SECOND, fps: { numerator: 30, denominator: 1 }, hasAudio: false }));
      doc.scenes[0].tracks.main.elements.push(jc.element("video", { id: "e", startTime: 0, duration: 2 * SECOND, mediaId: "v", sourceDuration: 2 * SECOND, retime: { rate: 0.5, smooth } }));
      const opened = await jc.open(doc, { width: 64, height: 64 }, [{ assetId: "v", original: `${origin}/media/flicker.mp4` }]);
      const levels: number[] = [];
      for (let frame = 0; frame < 8; frame++) levels.push((await opened.frameAt(frame * FRAME)).at(32, 32)[0]);
      // Backwards again: a scrub to an earlier blended frame.
      levels.push((await opened.frameAt(3 * FRAME)).at(32, 32)[0]);
      return { levels, errors: opened.events.filter((event) => event.type === "engine.error" || event.type === "diagnostic").map((event) => event.payload.id ?? event.payload.code) };
    };
    return { blend: await run("blend"), none: await run("none") };
  }, { SECOND, FRAME, origin: harness.origin });
  const level = (value: number) => (value < 40 ? "black" : value > 215 ? "white" : Math.abs(value - 128) <= 20 ? "mix" : `${value}`);
  // Source frames 0, 1, 2, 3 are black, white, black, white; at 0.5× output frame 2k is source frame k.
  assert.deepEqual(result.blend.levels.map(level), ["black", "mix", "white", "mix", "black", "mix", "white", "mix", "mix"], JSON.stringify(result.blend));
  assert.deepEqual(result.none.levels.map(level), ["black", "black", "white", "white", "black", "black", "white", "white", "white"], JSON.stringify(result.none));
  assert.deepEqual([result.blend.errors, result.none.errors], [[], []]);
});

test("Chroma key — Matte view: white for kept and black for removed areas, a view state that never reaches a committed render; Source sample for the chroma eyedropper: the unkeyed colour of the source, not a transparent value", async () => {
  const result = await harness.page.evaluate(async ({ SECOND }) => {
    const { jc } = window;
    // A green screen with a red subject, shown at half size in the middle of the canvas.
    const screen = await jc.imageUrl(200, 100, (c) => { c.fillStyle = "#00ff00"; c.fillRect(0, 0, 200, 100); c.fillStyle = "#ff0000"; c.fillRect(120, 20, 60, 60); });
    const doc = jc.project({ width: 400, height: 200 }, { kind: "color", color: "#0000ff" });
    doc.media.assets.push(jc.asset("screen", "image", { width: 200, height: 100 }));
    doc.scenes[0].tracks.main.elements.push(jc.element("image", { id: "e1", startTime: 0, duration: SECOND, mediaId: "screen", chromaKey: { enabled: true, color: "#00ff00", strength: 40, edge: 10, shadow: 0, spill: 0 }, transform: { position: { x: 0, y: 0 }, scale: { x: 0.5, y: 0.5 }, rotation: 0 } }));
    const opened = await jc.open(doc, { width: 400, height: 200 }, [{ assetId: "screen", original: screen }]);
    const keyed = await opened.frameAt(0);
    await opened.port.command("preview.setOverride", { overrides: { e1: { chromaKey: { enabled: true, color: "#00ff00", strength: 40, edge: 10, shadow: 0, spill: 0, showMatte: true } } } });
    const matte = await opened.frameAt(0);
    // The element covers canvas x 100…300, y 50…150: green at (150, 100), the subject at (250, 100).
    const green = await opened.port.command("layout.sampleSource", { elementId: "e1", x: 150, y: 100, size: 5 }) as { color: string; rgba: number[] };
    const subject = await opened.port.command("layout.sampleSource", { elementId: "e1", x: 250, y: 100, size: 1 }) as { color: string; rgba: number[] };
    const outside = await opened.port.command("layout.sampleSource", { elementId: "e1", x: 20, y: 20, size: 3 }) as { color: string; rgba: number[] };
    const unknown = await opened.port.command("layout.sampleSource", { elementId: "nobody", x: 20, y: 20, size: 3 }).then(() => "ok", (error) => error.code ?? String(error));
    // The preview is drawn again after a sample.
    const after = await opened.frameAt(0);
    await opened.port.command("preview.clearOverride", {});
    const cleared = await opened.frameAt(0);
    return { keyed: [keyed.at(150, 100), keyed.at(250, 100)], matte: [matte.at(150, 100), matte.at(250, 100), matte.at(20, 20)], after: after.at(250, 100), cleared: [cleared.at(150, 100), cleared.at(250, 100)], green, subject, outside, unknown };
  }, { SECOND });
  assert.ok(near(result.keyed[0], [0, 0, 255, 255]) && near(result.keyed[1], [255, 0, 0, 255]), `keyed: ${JSON.stringify(result.keyed)}`);
  assert.ok(near(result.matte[0], [0, 0, 0, 255]) && near(result.matte[1], [255, 255, 255, 255]) && near(result.matte[2], [0, 0, 255, 255]), `matte: ${JSON.stringify(result.matte)}`);
  assert.ok(near(result.after, [255, 255, 255, 255]), "the matte view is back after a sample");
  assert.ok(near(result.cleared[0], [0, 0, 255, 255]) && near(result.cleared[1], [255, 0, 0, 255]), "clearing the override shows the keyed picture");
  assert.ok(near(result.green.rgba, [0, 255, 0, 255]) && result.green.color === "#00ff00", `green: ${JSON.stringify(result.green)}`);
  assert.ok(near(result.subject.rgba, [255, 0, 0, 255]), `subject: ${JSON.stringify(result.subject)}`);
  assert.equal(result.outside.rgba[3], 0, "outside the picture nothing is sampled");
  assert.equal(result.unknown, "surface/invalid-payload");
});

test("Animatable property paths — an animated mask renders: a rectangle mask whose centre is keyframed at `masks.<maskId>.params.centerX` travels across the element", async () => {
  const result = await harness.page.evaluate(async ({ SECOND }) => {
    const { jc } = window;
    const white = await jc.imageUrl(400, 200, (c) => { c.fillStyle = "#ffffff"; c.fillRect(0, 0, 400, 200); });
    const doc = jc.project({ width: 400, height: 200 });
    doc.media.assets.push(jc.asset("w", "image", { width: 400, height: 200 }));
    const key = (time: number, value: number) => ({ id: `k${time}`, time, value, segmentToNext: "linear" });
    doc.scenes[0].tracks.main.elements.push(jc.element("image", {
      id: "e1", startTime: 0, duration: 2 * SECOND, mediaId: "w",
      masks: [{ id: "m1", type: "rectangle", enabled: true, combine: "add", params: { width: 0.25, height: 0.5, centerX: -0.25 } }],
      animations: { "masks.m1.params.centerX": { keys: [key(0, -0.25), key(SECOND, 0.25)] } },
    }));
    const opened = await jc.open(doc, { width: 400, height: 200 }, [{ assetId: "w", original: white }]);
    const span = async (time: number) => { const frame = await opened.frameAt(time); const lit: number[] = []; for (let x = 0; x < 400; x++) if (frame.at(x, 100)[0] > 128) lit.push(x); return [lit[0], lit[lit.length - 1]]; };
    return { start: await span(0), middle: await span(SECOND / 2), end: await span(SECOND) };
  }, { SECOND });
  const centre = (span: number[]) => (span[0] + span[1] + 1) / 2, width = (span: number[]) => span[1] - span[0] + 1;
  // Mask sizes are shares of the element's short side (200 px) and its centre a share of the half width.
  assert.ok(Math.abs(width(result.start) - 50) <= 2 && Math.abs(centre(result.start) - 150) <= 1.5, `the mask starts a quarter of the half width left of the centre: ${result.start}`);
  assert.ok(Math.abs(centre(result.middle) - 200) <= 1.5 && Math.abs(centre(result.end) - 250) <= 1.5, `it travels 100 px in a second: ${JSON.stringify(result)}`);
});

test("Bilingual caption rendering — Two lines: the text above its translation at 80 % of the size, a gap of 0.3 line heights, both about the anchor; order above; Hide the translation; the translation's own colour", async () => {
  const result = await harness.page.evaluate(async ({ SECOND, origin }) => {
    const { jc } = window;
    const fonts = [{ fontId: "arimo-700", family: "Arimo", url: `${origin}/fixtures/fonts/Arimo-Bold.ttf`, weight: 700 }, { fontId: "arimo-400", family: "Arimo", url: `${origin}/fixtures/fonts/Arimo-Regular.ttf`, weight: 400 }];
    const make = async (bilingual: Record<string, unknown>, translation = "HHHH") => {
      const doc = jc.project({ width: 640, height: 360 });
      doc.scenes[0].tracks.overlay = [jc.track("caption", "c0", [jc.element("caption", { id: "c", startTime: 0, duration: SECOND, text: "HHHH", ...(translation ? { translation } : {}) })], { caption: { translationLanguage: "vi", style: { fontFamily: "Arial", fontSize: 10, color: "#ffffff", stroke: { enabled: false }, shadow: { enabled: false }, background: { enabled: false } }, layout: { anchor: "middle" }, highlight: { style: "none" }, bilingual } })];
      const opened = await jc.open(doc, { width: 640, height: 360 }, [], (port) => port.command("fonts.setSources", { fonts }));
      await opened.engine.whenFontsSettled();
      const frame = await opened.frameAt(0);
      // Rows with ink, as bands; and whether a band is white or coloured.
      const bands: { top: number; bottom: number; left: number; right: number; colour: number[] }[] = [];
      for (let y = 0; y < 360; y++) {
        let left = -1, right = -1, colour = [0, 0, 0, 0];
        for (let x = 0; x < 640; x++) { const pixel = frame.at(x, y); if (pixel[0] + pixel[1] + pixel[2] > 300) { if (left < 0) left = x; right = x; colour = pixel; } }
        if (left < 0) continue;
        const band = bands[bands.length - 1];
        if (band && band.bottom === y - 1) { band.bottom = y; band.left = Math.min(band.left, left); band.right = Math.max(band.right, right); } else bands.push({ top: y, bottom: y, left, right, colour });
      }
      return bands;
    };
    return { both: await make({ visible: true, order: "below", scale: 80 }), above: await make({ visible: true, order: "above", scale: 80 }), hidden: await make({ visible: false, order: "below", scale: 80 }), coloured: await make({ visible: true, order: "below", scale: 80, color: "#ffd400" }), single: await make({ visible: true, order: "below", scale: 80 }, "") };
  }, { SECOND, origin: harness.origin });
  const height = (band: { top: number; bottom: number }) => band.bottom - band.top + 1, width = (band: { left: number; right: number }) => band.right - band.left + 1;
  assert.equal(result.both.length, 2, JSON.stringify(result.both));
  const [text, translation] = result.both;
  // "HHHH" twice: the lower one is 80 % of the upper in both directions.
  assert.ok(Math.abs(height(translation) / height(text) - 0.8) < 0.06 && Math.abs(width(translation) / width(text) - 0.8) < 0.04, `80 %: ${JSON.stringify(result.both)}`);
  // The stack is centred on the anchor (the canvas middle) and both blocks share its axis.
  assert.ok(Math.abs((text.left + text.right) / 2 - 319.5) <= 1.5 && Math.abs((translation.left + translation.right) / 2 - 319.5) <= 1.5);
  assert.ok(text.bottom < 180 && translation.top > 180, `the stack straddles the anchor: ${JSON.stringify(result.both)}`);
  // Font size 10 on a 360 px canvas is 40 px; the line height is 1.2: block heights 48 and 38.4 with a gap of 14.4 between them.
  const cap = height(text), expectedGap = 0.3 * 48 + (48 - cap) / 2 + (38.4 - cap * 0.8) / 2;
  assert.ok(Math.abs(translation.top - text.bottom - 1 - expectedGap) <= 3, `gap of 0.3 line heights between the blocks: ${translation.top - text.bottom - 1} against ${expectedGap.toFixed(1)}`);
  assert.equal(result.above.length, 2);
  assert.ok(height(result.above[0]) < height(result.above[1]), "order above puts the translation on top");
  assert.equal(result.hidden.length, 1, `hidden: ${JSON.stringify(result.hidden)}`);
  assert.equal(result.single.length, 1, `single: ${JSON.stringify(result.single)}`);
  assert.ok(Math.abs(height(result.hidden[0]) - height(text)) <= 1 && Math.abs((result.hidden[0].top + result.hidden[0].bottom) / 2 - 179.5) <= 2, "alone, the text sits on the anchor");
  // The sampled pixel is on an anti-aliased edge: its hue is the fill's (#ffd400 has no blue; white has all three).
  const [plain, tinted] = result.coloured.map((band) => band.colour);
  assert.ok(tinted[2] < 12 && tinted[0] > 100 && Math.abs(tinted[1] / tinted[0] - 212 / 255) < 0.05 && plain[0] === plain[1] && plain[1] === plain[2], `translation colour: ${JSON.stringify([plain, tinted])}`);
});
