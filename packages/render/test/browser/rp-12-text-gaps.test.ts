// Pixel tests in headless Chromium: texture limits, curved text, bubbles, text animations, colour emoji, the preview font wait and caption word styles.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startHarness, type Harness } from "./harness.ts";

let harness: Harness;
before(async () => { harness = await startHarness(); });
after(async () => { await harness?.close(); });

test("Texture cache and upload rules — Oversized text: font size 500 on a long line renders without an engine error, scaled into one texture inside maxTextureSize; a huge sticker bitmap is downscaled; zero-size content draws nothing and the engine keeps rendering", async () => {
  const result = await harness.page.evaluate(async (origin) => {
    const { jc } = window;
    const fonts = [{ fontId: "arimo-400", family: "Arimo", url: `${origin}/fixtures/fonts/Arimo-Regular.ttf`, weight: 400 }];
    const doc = jc.project({ width: 1920, height: 1080 });
    // 500 × 1080 / 90 = 6 000 px per em: twenty-five W are about 140 000 px wide.
    doc.scenes[0].tracks.overlay = [jc.track("text", "t0", [jc.element("text", { id: "huge", startTime: 0, duration: 120000, content: "WWWWWWWWWWWWWWWWWWWWWWWWW", fontFamily: "Arial", fontSize: 500, color: "#ffffff", stroke: { enabled: true, color: "#ff0000", width: 6, position: "outside" }, shadow: { enabled: true, color: "#000000", opacity: 80, blur: 10, distance: 5, angle: -45 } })])];
    const opened = await jc.open(doc, { width: 1920, height: 1080 }, [], (port) => port.command("fonts.setSources", { fonts }));
    await opened.engine.whenFontsSettled();
    const frame = await opened.frameAt(0);
    let white = 0;
    for (let y = 0; y < frame.size.height; y += 8) for (let x = 0; x < frame.size.width; x += 8) { const pixel = frame.at(x, y); if (pixel[0] > 200 && pixel[1] > 200 && pixel[2] > 200) white++; }
    const limit = opened.ready().maxTextureSize;
    const uploaded = opened.engine.counters.textureUploadPixels;
    // The same engine goes on: an ordinary text after the oversized one.
    await opened.port.command("scene.patch", { baseRevision: 1, revision: 2, patches: [{ op: "replace", path: "/scenes/@s1/tracks/overlay/@t0/elements/@huge/fontSize", value: 20 }, { op: "replace", path: "/scenes/@s1/tracks/overlay/@t0/elements/@huge/content", value: "OK" }] });
    const small = await opened.frameAt(4000);
    let smallWhite = 0;
    for (let y = 0; y < small.size.height; y += 2) for (let x = 0; x < small.size.width; x += 2) { const pixel = small.at(x, y); if (pixel[0] > 200 && pixel[1] > 200 && pixel[2] > 200) smallWhite++; }
    const errors = opened.events.filter((event) => event.type === "engine.error" || (event.type === "diagnostic" && event.payload.severity === "error")).map((event) => event.payload);

    // A 9 000 × 40 px bitmap sticker (wider than any texture here), elements at the smallest scale and one keyframed to scale 0.
    const strip = await jc.imageUrl(9000, 40, (context) => { context.fillStyle = "#00ff00"; context.fillRect(0, 0, 9000, 40); });
    const other = jc.project({ width: 640, height: 360 });
    other.scenes[0].tracks.overlay = [
      jc.track("graphic", "g0", [
        jc.element("sticker", { id: "strip", startTime: 0, duration: 120000, stickerId: "stickers:strip", intrinsicWidth: 600, intrinsicHeight: 40 }),
        jc.element("sticker", { id: "flat", startTime: 0, duration: 120000, stickerId: "stickers:strip", intrinsicWidth: 600, intrinsicHeight: 40, transform: { position: { x: 0, y: 100 }, scale: { x: 0.01, y: 0.01 }, rotation: 0 } }),
        jc.element("graphic", { id: "nothing", startTime: 0, duration: 120000, definitionId: "rectangle", params: { fill: "#ff00ff" }, transform: { position: { x: 0, y: -100 }, scale: { x: 0.01, y: 1 }, rotation: 0 }, animations: { "transform.scale.x": { keys: [{ id: "k0", time: 0, value: 0, segmentToNext: "linear" }] } } }),
      ]),
      jc.track("text", "t1", [jc.element("text", { id: "tiny", startTime: 0, duration: 120000, content: "x", fontFamily: "Arial", fontSize: 1, transform: { position: { x: 0, y: 0 }, scale: { x: 0.01, y: 0.01 }, rotation: 0 } })]),
    ];
    const second = await jc.open(other, { width: 640, height: 360 }, [], async (port) => { await port.command("fonts.setSources", { fonts }); await port.command("derived.setSources", { entries: [{ key: "stickers:strip", kind: "sticker", url: strip, sha256: "cd".repeat(32) }] }); });
    await second.engine.whenFontsSettled();
    const stripFrame = await second.frameAt(0);
    let green = 0, magenta = 0;
    for (let x = 0; x < 640; x++) if (stripFrame.at(x, 180)[1] > 200 && stripFrame.at(x, 180)[0] < 60) green++;
    for (let y = 0; y < 360; y += 2) for (let x = 0; x < 640; x += 2) { const pixel = stripFrame.at(x, y); if (pixel[0] > 200 && pixel[2] > 200 && pixel[1] < 60) magenta++; }
    const secondErrors = second.events.filter((event) => event.type === "engine.error" || (event.type === "diagnostic" && event.payload.severity === "error")).map((event) => event.payload);
    // The upload rule itself: sizes, zero and non-finite sizes, straight bytes.
    const fit = (width: number, height: number, max: number) => { const out = jc.fitTexture({ key: "k", width, height, source: new OffscreenCanvas(Math.max(1, Math.min(width || 1, 16384)), Math.max(1, Math.min(height || 1, 64))) }, max); return out && [out.width, out.height]; };
    const bytes = jc.fitTexture({ key: "k", width: 4, height: 2, pixels: new Uint8Array(32).fill(255) }, 2);
    return {
      white, limit, uploaded, smallWhite, errors, green, magenta, secondErrors, stripUpload: second.engine.counters.textureUploadPixels,
      fits: [fit(12000, 8000, 8192), fit(100, 100, 8192), fit(0, 10, 8192), fit(10, Number.NaN, 8192), fit(9000, 40, 4096)], bytes: bytes && [bytes.width, bytes.height, bytes.pixels!.length],
    };
  }, harness.origin);
  assert.deepEqual(result.errors, [], "no engine error and no error diagnostic for the oversized text");
  assert.ok(result.white > 2000, `the oversized text is on screen (${result.white} sampled white pixels)`);
  assert.ok(result.uploaded <= 4096 * 4096 * 1.05 + 1920 * 1080, `the text texture stays inside the limit (${result.uploaded} px uploaded, maxTextureSize ${result.limit})`);
  assert.ok(result.smallWhite > 200, "the engine renders the next text");
  assert.deepEqual(result.secondErrors, []);
  assert.ok(Math.abs(result.green - 600) <= 3, `the 9 000 px bitmap is drawn 600 px wide (${result.green})`);
  assert.equal(result.magenta, 0, "an element of scale 0 covers no pixel");
  // Oversized image: 12 000 × 8 000 on a device limited to 8 192 is uploaded at 8 192 × 5 461.
  assert.deepEqual(result.fits, [[8192, 5461], [100, 100], null, null, [4096, 18]]);
  assert.deepEqual(result.bytes, [2, 1, 8]);
  assert.deepEqual(harness.errors, []);
});

test("Curved text — Half circle arches upward and Straight equals the uncurved layout; Text bubbles — Apply a bubble; Longer text; Text rendering rules — Mixed scripts: colour emoji are drawn from the bundled colour font", async () => {
  const result = await harness.page.evaluate(async (origin) => {
    const { jc } = window;
    const fonts = [
      { fontId: "arimo-400", family: "Arimo", url: `${origin}/fixtures/fonts/Arimo-Regular.ttf`, weight: 400 },
      { fontId: "emoji", family: "Noto Color Emoji", url: `${origin}/assets/fonts/NotoColorEmoji-Regular.ttf`, weight: 400 },
    ];
    const make = async (fields: Record<string, unknown>) => {
      const doc = jc.project({ width: 640, height: 360 }, { kind: "color", color: "#203040" });
      doc.scenes[0].tracks.overlay = [jc.track("text", "t0", [jc.element("text", { id: "t", startTime: 0, duration: 120000, content: "HHHHHHHHHH", fontFamily: "Arial", fontSize: 10, color: "#ffffff", ...fields })])];
      const opened = await jc.open(doc, { width: 640, height: 360 }, [], (port) => port.command("fonts.setSources", { fonts }));
      await opened.engine.whenFontsSettled();
      return { opened, frame: await opened.frameAt(0) };
    };
    type Frame = Awaited<ReturnType<typeof make>>["frame"];
    const box = (frame: Frame, test: (pixel: number[]) => boolean, x0 = 0, x1 = 640) => {
      let total = 0, minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
      for (let y = 0; y < 360; y++) for (let x = x0; x < x1; x++) if (test(frame.at(x, y))) { total++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      return { total, minX, maxX, minY, maxY };
    };
    const white = (pixel: number[]) => pixel[0] > 220 && pixel[1] > 220 && pixel[2] > 220;
    const straight = await make({}), zero = await make({ curve: 0 }), curved = await make({ curve: 180 }), down = await make({ curve: -180 });
    let same = true;
    for (let index = 0; index < straight.frame.pixels.length; index++) if (straight.frame.pixels[index] !== zero.frame.pixels[index]) { same = false; break; }
    // The ends of the arc are the 30 columns at the left edge of its ink; the middle is the columns about the canvas centre.
    const ends = (frame: Frame) => { const all = box(frame, white); return box(frame, white, all.minX, all.minX + 30); };
    const arch = { all: box(curved.frame, white), middle: box(curved.frame, white, 305, 335), left: ends(curved.frame), flat: box(straight.frame, white) };
    const sag = { middle: box(down.frame, white, 305, 335), left: ends(down.frame) };

    // Bubbles: the catalogue path behind black text, its fill white and its stroke black.
    const dark = (pixel: number[]) => pixel[0] < 40 && pixel[1] < 40 && pixel[2] < 40;
    const short = await make({ content: "Hello", color: "#0000ff", bubble: { id: "speech-round-left" } });
    const long = await make({ content: "Hello there, this is a much longer line of text to hold", color: "#0000ff", bubble: { id: "speech-round-left" } });
    const blue = (pixel: number[]) => pixel[2] > 200 && pixel[0] < 80 && pixel[1] < 80;
    const bubble = { fill: box(short.frame, white), stroke: box(short.frame, dark), ink: box(short.frame, blue), longFill: box(long.frame, white), longInk: box(long.frame, blue) };
    const layout = await short.opened.port.command("layout.query", { elementIds: ["t"], time: 0 }) as { boxes: Record<string, { x: number; y: number; width: number; height: number }> };
    const unknown = await make({ content: "Hello", bubble: { id: "bubble-from-the-future" } });
    const plain = await make({ content: "Hello" });
    let unknownSame = true;
    for (let index = 0; index < plain.frame.pixels.length; index++) if (plain.frame.pixels[index] !== unknown.frame.pixels[index]) { unknownSame = false; break; }
    const flipped = await make({ content: "Hello", color: "#0000ff", bubble: { id: "speech-round-left", flipHorizontal: true, color: "#ffd400", strokeWidth: 0 } });
    const yellow = (pixel: number[]) => pixel[0] > 220 && pixel[1] > 180 && pixel[2] < 60;
    // The tail of the bubble hangs below the body: on the left when not flipped, on the right when flipped.
    const tail = (frame: Frame, test: (pixel: number[]) => boolean) => { const all = box(frame, test); let sum = 0, count = 0; for (let x = 0; x < 640; x++) if (test(frame.at(x, all.maxY - 2))) { sum += x; count++; } return { x: sum / Math.max(count, 1), centre: (all.minX + all.maxX) / 2 }; };
    const tails = { plain: tail(short.frame, white), flipped: tail(flipped.frame, yellow) };

    // Colour emoji: the glyph of the bundled colour font, in colour, next to Latin text.
    const emoji = await make({ content: "A😀", fontSize: 30 });
    const emojiYellow = box(emoji.frame, (pixel) => pixel[0] > 200 && pixel[1] > 150 && pixel[2] < 110);
    const emojiWhite = box(emoji.frame, white);
    const diagnostics = [...curved.opened.events, ...short.opened.events, ...emoji.opened.events].filter((event) => event.type === "diagnostic").map((event) => event.payload.id);
    return { same, arch, sag, bubble, layout: layout.boxes.t, unknownSame, tails, emojiYellow, emojiWhite, diagnostics };
  }, harness.origin);
  assert.ok(result.same, "curve 0 renders exactly the uncurved text");
  // Ten H at 40 px are about 289 px wide: on a half circle the block is about 2 × 289 / π wide and as high as its radius.
  assert.ok(result.arch.all.maxY - result.arch.all.minY > (result.arch.flat.maxY - result.arch.flat.minY) * 2.5, `the curved text is taller: ${JSON.stringify(result.arch.all)}`);
  assert.ok(result.arch.all.maxX - result.arch.all.minX < result.arch.flat.maxX - result.arch.flat.minX - 40, "and narrower than the straight line");
  assert.ok(result.arch.middle.maxY < result.arch.left.maxY - 40, `arching upward: the middle is above the ends (${result.arch.middle.maxY} vs ${result.arch.left.maxY})`);
  assert.ok(result.sag.middle.minY > result.sag.left.minY + 40, "a negative curve arches downward");
  // The bubble: fill around the text, stroke around the fill, the text inside its text area.
  const { fill, stroke, ink, longFill, longInk } = result.bubble;
  assert.ok(fill.total > 3000 && stroke.total > 300, `bubble fill ${fill.total} px, stroke ${stroke.total} px`);
  assert.ok(fill.minX < ink.minX && fill.maxX > ink.maxX && fill.minY < ink.minY && fill.maxY > ink.maxY, "the text sits inside the bubble");
  assert.ok(stroke.minX <= fill.minX && stroke.maxX >= fill.maxX && stroke.minY <= fill.minY, "the stroke surrounds the fill");
  assert.ok(result.layout.x <= stroke.minX + 1 && result.layout.x + result.layout.width >= stroke.maxX - 1 && result.layout.y + result.layout.height >= stroke.maxY - 1, `the element bounds include the bubble: ${JSON.stringify(result.layout)}`);
  assert.ok(longFill.maxX - longFill.minX > (fill.maxX - fill.minX) * 2, `the bubble grows with the text: ${JSON.stringify(result.bubble)}`);
  assert.ok(longFill.minX < longInk.minX && longFill.maxX > longInk.maxX && longFill.minY < longInk.minY && longFill.maxY > longInk.maxY, "no glyph crosses the grown bubble");
  assert.ok(longInk.maxY - longInk.minY > (ink.maxY - ink.minY) * 1.8, "the long text wraps inside the bubble");
  assert.ok(result.unknownSame, "an unknown bubble id renders without a bubble");
  assert.ok(result.tails.plain.x < result.tails.plain.centre - 10 && result.tails.flipped.x > result.tails.flipped.centre + 10, `the flipped bubble has its tail on the other side: ${JSON.stringify(result.tails)}`);
  assert.ok(result.emojiYellow.total > 1500, `the emoji is drawn in colour (${result.emojiYellow.total} yellow px)`);
  assert.ok(result.emojiWhite.total > 500 && result.emojiYellow.minX > result.emojiWhite.minX + 20, "after the Latin letter, at its glyph position");
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(harness.errors, []);
});

test("Text animations in, out and loop — every catalogue animation renders and changes the frame inside its range; In animation (Typewriter); Catalogue motion (Slide up); Seek equals playback (Jitter); Remove; Unknown animation id", async () => {
  const result = await harness.page.evaluate(async (origin) => {
    const { jc } = window;
    const fonts = [{ fontId: "arimo-400", family: "Arimo", url: `${origin}/fixtures/fonts/Arimo-Regular.ttf`, weight: 400 }];
    const SECOND = 120000;
    const doc = jc.project({ width: 320, height: 180 });
    doc.scenes[0].tracks.overlay = [jc.track("text", "t0", [jc.element("text", { id: "t", startTime: 0, duration: 4 * SECOND, content: "Hello you\nall", fontFamily: "Arial", fontSize: 14, color: "#ff8000" })])];
    const opened = await jc.open(doc, { width: 320, height: 180 }, [], (port) => port.command("fonts.setSources", { fonts }));
    await opened.engine.whenFontsSettled();
    let revision = 1;
    const animate = async (textAnimation: unknown) => {
      await opened.port.command("scene.patch", { baseRevision: revision, revision: revision + 1, patches: [{ op: "add", path: "/scenes/@s1/tracks/overlay/@t0/elements/@t/textAnimation", value: textAnimation }] });
      revision++;
    };
    const ink = (frame: Awaited<ReturnType<typeof opened.frameAt>>) => {
      let total = 0, minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, sum = 0;
      for (let y = 0; y < 180; y++) for (let x = 0; x < 320; x++) { const pixel = frame.at(x, y); sum = (sum * 31 + pixel[0] * 7 + pixel[1] * 3 + pixel[2]) >>> 0; if (pixel[0] > 60) { total++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); } }
      return { total, minX, maxX, minY, maxY, sum };
    };
    await animate({});
    const rest = ink(await opened.frameAt(2 * SECOND));
    const changed: Record<string, boolean> = {};
    for (const animation of jc.editorCore.TEXT_ANIMATIONS) {
      await animate(animation.group === "loop" ? { loop: { id: animation.id, period: SECOND, strength: 100 } } : { [animation.group]: { id: animation.id, duration: SECOND, strength: 100 } });
      // Frames inside the range: 0.3 s into In, 0.75 s into Out, three cycle positions of a Loop (the last inside the glitch burst).
      const times = animation.group === "in" ? [0.3 * SECOND] : animation.group === "out" ? [3.75 * SECOND] : [0.1 * SECOND, 0.35 * SECOND, 114000];
      let differs = false;
      for (const time of times) differs ||= ink(await opened.frameAt(time)).sum !== rest.sum;
      changed[animation.id] = differs;
    }
    // Typewriter over 1 s on one line of five characters.
    await opened.port.command("scene.patch", { baseRevision: revision, revision: ++revision, patches: [{ op: "replace", path: "/scenes/@s1/tracks/overlay/@t0/elements/@t/content", value: "HHHHH" }] });
    await animate({});
    const full = ink(await opened.frameAt(2 * SECOND));
    await animate({ in: { id: "in-typewriter", duration: SECOND, strength: 100 } });
    const typed = [];
    for (const seconds of [0.1, 0.3, 0.5, 0.7, 0.9]) typed.push(ink(await opened.frameAt(Math.round(seconds * SECOND / 4000) * 4000)).total);
    // Slide up over 0.5 s: one block height below and transparent at 0, in place at the end; strength 50 halves the way.
    await animate({ in: { id: "in-slide-up", duration: SECOND / 2, strength: 100 } });
    const slide = [ink(await opened.frameAt(0)), ink(await opened.frameAt(SECOND / 4)), ink(await opened.frameAt(SECOND / 2))];
    await animate({ in: { id: "in-slide-up", duration: SECOND / 2, strength: 50 } });
    const slideHalf = ink(await opened.frameAt(SECOND / 4));
    // Jitter at 1.3 s: by a seek, and again after other frames were rendered in between.
    await animate({ loop: { id: "loop-jitter", period: SECOND, strength: 100 } });
    const jitterA = ink(await opened.frameAt(156000));
    await opened.frameAt(40000); await opened.frameAt(300000);
    const jitterB = ink(await opened.frameAt(156000));
    const jitterOther = ink(await opened.frameAt(168000));
    // None again, and an id this build does not know.
    await animate({});
    const removed = ink(await opened.frameAt(0));
    await animate({ in: { id: "in-from-the-future", duration: SECOND, strength: 100 } });
    const unknown = ink(await opened.frameAt(0));
    const errors = opened.events.filter((event) => event.type === "engine.error" || (event.type === "diagnostic" && event.payload.severity === "error")).map((event) => event.payload);
    return { changed, full, typed, slide, slideHalf, jitter: [jitterA.sum, jitterB.sum, jitterOther.sum], removed, unknown, errors, count: jc.editorCore.TEXT_ANIMATIONS.length };
  }, harness.origin);
  assert.equal(result.count, 52);
  assert.deepEqual(Object.entries(result.changed).filter(([, changed]) => !changed).map(([id]) => id), [], "every animation changes the frame inside its range");
  // Characters appear one by one: 1, 2, 3, 4, 5 of 5 at 0.1 … 0.9 s.
  result.typed.forEach((total, index) => assert.ok(Math.abs(total - (result.full.total * (index + 1)) / 5) <= result.full.total * 0.04, `typewriter step ${index}: ${total} of ${result.full.total}`));
  const height = result.full.maxY - result.full.minY + 1;
  assert.equal(result.slide[0].total, 0, "transparent at the start");
  assert.ok(result.slide[1].minY > result.full.minY + 1 && result.slide[1].minY < result.full.minY + height * 1.2, "below its place half-way");
  assert.ok(Math.abs(result.slide[2].minY - result.full.minY) <= 1 && Math.abs(result.slide[2].total - result.full.total) <= result.full.total * 0.02, "in place at the end");
  const way = result.slide[1].minY - result.full.minY, halfWay = result.slideHalf.minY - result.full.minY;
  assert.ok(Math.abs(halfWay - way / 2) <= 1.5, `strength 50 halves the offset (${halfWay} vs ${way})`);
  assert.equal(result.jitter[0], result.jitter[1], "the frame at 1.3 s is the same by seek and after other frames");
  assert.notEqual(result.jitter[0], result.jitter[2], "the jitter steps at 12 Hz");
  assert.equal(result.removed.sum, result.full.sum, "without an animation the text is fully visible from its first frame");
  assert.equal(result.unknown.sum, result.full.sum, "an unknown id renders without animation");
  assert.deepEqual(result.errors, []);
  assert.deepEqual(harness.errors, []);
});

test("Text and graphic rasterisation — Font not yet loaded in preview: the text waits 3 000 ms, then renders in the fallback family with font/fallback, and re-renders in the requested font once it loads", async () => {
  const result = await harness.page.evaluate(async (origin) => {
    const { jc } = window;
    // The requested face (bold, heavy ink) takes 5 s; the fallback family (regular) loads at once.
    const fonts = [{ fontId: "slow-700", family: "Tinos", url: `${origin}/slow/5000/fixtures/fonts/Arimo-Bold.ttf`, weight: 400 }, { fontId: "fallback", family: "Noto Sans", url: `${origin}/fixtures/fonts/Arimo-Regular.ttf`, weight: 400 }];
    const doc = jc.project({ width: 320, height: 180 });
    doc.scenes[0].tracks.overlay = [jc.track("text", "t0", [jc.element("text", { id: "t", startTime: 0, duration: 120000, content: "HIHI", fontFamily: "Times New Roman", fontSize: 30, color: "#ffffff" })])];
    const started = performance.now();
    const opened = await jc.open(doc, { width: 320, height: 180 }, [], (port) => port.command("fonts.setSources", { fonts }));
    const ink = async () => { const size = opened.engine.renderSize!; const pixels = await opened.engine.readPixels(0, 0, size.width, size.height); let total = 0; for (let index = 0; index < pixels.length; index += 4) if (pixels[index] > 200) total++; return total; };
    const sleepUntil = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms - (performance.now() - started))));
    const diagnostics = () => opened.events.filter((event) => event.type === "diagnostic").map((event) => event.payload.id);
    await sleepUntil(1500);
    const early = { ink: await ink(), diagnostics: diagnostics() };
    await sleepUntil(3700);
    const fallback = { ink: await ink(), diagnostics: diagnostics() };
    await sleepUntil(6200);
    const arrived = { ink: await ink() };
    // The engine is disposed so that nothing of it renders into the shared compositor of the page afterwards.
    await opened.port.command("engine.dispose", {});
    return { early, fallback, arrived };
  }, harness.origin);
  assert.equal(result.early.ink, 0, "nothing is rasterised while the face is awaited");
  assert.deepEqual(result.early.diagnostics, []);
  assert.ok(result.fallback.ink > 1000, `after 3 s the text is drawn in the fallback family (${result.fallback.ink} px)`);
  assert.deepEqual(result.fallback.diagnostics, ["font/fallback"]);
  assert.ok(result.arrived.ink > result.fallback.ink * 1.15, `re-rendered in the requested face once it loaded (${result.arrived.ink} vs ${result.fallback.ink} px)`);
});

test("Word-level highlight — Karaoke: words one and two are filled and the third over its left half; scale: the active word is scaled about its centre; Imported captions without word timings; Caption style templates — a style with an In animation animates each caption", async () => {
  const result = await harness.page.evaluate(async (origin) => {
    const { jc } = window;
    const fonts = [{ fontId: "arimo-700", family: "Arimo", url: `${origin}/fixtures/fonts/Arimo-Bold.ttf`, weight: 700 }];
    const SECOND = 120000;
    const words = [{ text: "HHH", start: 0, end: SECOND }, { text: "HHH", start: SECOND, end: 2 * SECOND }, { text: "HHHH", start: 2 * SECOND, end: 3 * SECOND }];
    const make = async (highlight: Record<string, unknown>, element: Record<string, unknown> = {}, style: Record<string, unknown> = {}) => {
      const doc = jc.project({ width: 640, height: 360 });
      doc.scenes[0].tracks.overlay = [jc.track("caption", "c0", [jc.element("caption", { id: "c", startTime: 0, duration: 3 * SECOND, text: "HHH HHH HHHH", words, ...element })],
        { caption: { style: { fontFamily: "Arial", fontWeight: 700, fontSize: 8, color: "#ffffff", stroke: { enabled: false }, ...style }, highlight: { style: "none", color: "#ff0000", textColor: "#000000", scale: 1.2, ...highlight } } })];
      const opened = await jc.open(doc, { width: 640, height: 360 }, [], (port) => port.command("fonts.setSources", { fonts }));
      await opened.engine.whenFontsSettled();
      return opened;
    };
    const scan = async (opened: Awaited<ReturnType<typeof make>>, time: number) => {
      const frame = await opened.frameAt(time);
      const columns = { red: [] as number[], white: [] as number[] };
      let minY = 1e9, maxY = -1;
      const rows: Record<number, [number, number]> = {};
      for (let x = 0; x < 640; x++) {
        let top = 1e9, bottom = -1, red = false, white = false;
        for (let y = 0; y < 360; y++) { const pixel = frame.at(x, y); if (pixel[0] > 200) { top = Math.min(top, y); bottom = Math.max(bottom, y); if (pixel[1] < 80) red = true; else if (pixel[1] > 200) white = true; } }
        if (red) columns.red.push(x);
        if (white) columns.white.push(x);
        if (bottom >= 0) { rows[x] = [top, bottom]; minY = Math.min(minY, top); maxY = Math.max(maxY, bottom); }
      }
      return { red: columns.red.length ? [columns.red[0], columns.red[columns.red.length - 1]] : null, white: columns.white.length ? [columns.white[0], columns.white[columns.white.length - 1]] : null, redCount: columns.red.length, minY, maxY, rows };
    };
    // Word spans from the unhighlighted caption: three groups of columns with ink.
    const plainOpened = await make({});
    const plain = await scan(plainOpened, 0);
    const xs = Object.keys(plain.rows).map(Number).sort((a, b) => a - b);
    const groups: [number, number][] = [];
    for (const x of xs) { const last = groups[groups.length - 1]; if (last && x - last[1] <= 12) last[1] = x; else groups.push([x, x]); }
    const karaoke = await scan(await make({ style: "karaoke" }), 2.5 * SECOND);
    const karaokeStart = await scan(await make({ style: "karaoke" }), 4000);
    const scaledOpened = await make({ style: "scale", scale: 1.5 });
    const scaled = await scan(scaledOpened, 1.5 * SECOND);
    const heights = groups.map(([from, to]) => { let top = 1e9, bottom = -1; for (let x = from - 30; x <= to + 30; x++) { const row = scaled.rows[x]; if (row && x >= (from + to) / 2 - 20 && x <= (from + to) / 2 + 20) { top = Math.min(top, row[0]); bottom = Math.max(bottom, row[1]); } } return bottom - top + 1; });
    // No word timings: "HHH HHH HHHH" over 3 s is 0.9 s, 0.9 s and 1.2 s.
    const synth = await make({ style: "color" }, { words: undefined });
    const synthFirst = await scan(synth, 0.5 * SECOND), synthSecond = await scan(synth, 1.5 * SECOND), synthThird = await scan(synth, 2.5 * SECOND);
    // A caption style with an In animation (the `pop-yellow` pattern): words pop in during the first 0.2 s of the caption.
    const popped = await make({ style: "color" }, {}, { textAnimation: { in: { id: "in-pop", duration: 24000, strength: 100 } } });
    const popStart = await scan(popped, 0), popLater = await scan(popped, 60000);
    const inkCount = (rows: Record<number, [number, number]>) => Object.keys(rows).length;
    return { groups, karaoke: { red: karaoke.red, white: karaoke.white }, karaokeStart: karaokeStart.redCount, heights, plainHeight: plain.maxY - plain.minY + 1, synth: [synthFirst.red, synthSecond.red, synthThird.red], pop: [inkCount(popStart.rows), inkCount(popLater.rows)] };
  }, harness.origin);
  assert.equal(result.groups.length, 3, `three words: ${JSON.stringify(result.groups)}`);
  const [one, , three] = result.groups;
  // Half-way through the third word: red from the first word's left edge to the middle of the third word.
  assert.ok(Math.abs(result.karaoke.red![0] - one[0]) <= 2, `filled from the first word: ${JSON.stringify(result.karaoke)}`);
  assert.ok(Math.abs(result.karaoke.red![1] - (three[0] + three[1]) / 2) <= 6, `the third word is filled over its left half: red to ${result.karaoke.red![1]}, word ${three}`);
  assert.ok(result.karaoke.white![0] > result.karaoke.red![1] - 3 && Math.abs(result.karaoke.white![1] - three[1]) <= 2, "its right half keeps the base colour");
  assert.ok(result.karaokeStart <= 4, `at the start nothing is filled yet (${result.karaokeStart} red columns)`);
  // Scale 1.5 on the second word: its glyphs are 1.5 × as high as the others.
  assert.ok(Math.abs(result.heights[1] / result.heights[0] - 1.5) <= 0.12 && Math.abs(result.heights[2] - result.heights[0]) <= 1, `word heights ${result.heights}`);
  const inside = (span: number[] | null, word: number[]) => span !== null && Math.abs(span[0] - word[0]) <= 2 && Math.abs(span[1] - word[1]) <= 2;
  assert.ok(inside(result.synth[0], result.groups[0]) && inside(result.synth[1], result.groups[1]) && inside(result.synth[2], result.groups[2]), `synthesised timings: ${JSON.stringify(result.synth)}`);
  assert.ok(result.pop[0] === 0 && result.pop[1] > 100, `the caption pops in (${result.pop})`);
  assert.deepEqual(harness.errors, []);
});
