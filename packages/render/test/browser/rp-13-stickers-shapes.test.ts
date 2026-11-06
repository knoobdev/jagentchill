// Pixel tests in headless Chromium: line and arrow shapes, stretched shapes, freehand drawings, animated and emoji stickers, and the 30 text templates.
import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { ffmpeg, hasFfmpeg, startHarness, type Harness } from "./harness.ts";

let harness: Harness;
before(async () => {
  harness = await startHarness();
  if (hasFfmpeg()) {
    // Four frames of 0.5 s each: red, green, blue, white — as GIF (in the encoder's stock palette, whose blue and white are dull) and as APNG.
    const source = ["-f", "lavfi", "-i", "color=c=black:s=64x64:r=2:d=2"];
    const paint = "drawbox=color=red:t=fill:enable='lt(t,0.5)',drawbox=color=lime:t=fill:enable='between(t,0.5,0.99)',drawbox=color=blue:t=fill:enable='between(t,1,1.49)',drawbox=color=white:t=fill:enable='gte(t,1.5)'";
    // The GIF muxer writes no delay for the last frame unless it is told one (in 1/100 s).
    ffmpeg([...source, "-vf", paint, "-loop", "0", "-final_delay", "50", join(harness.media, "four.gif")]);
    ffmpeg([...source, "-vf", paint, "-f", "apng", "-plays", "0", join(harness.media, "four.png")]);
  }
});
after(async () => { await harness?.close(); });

test("Shape parameter table — line (cap, dash) and arrow (head, shaft, double head) are drawn from their parameters; Stretch without distortion; Shape stroke — Inside alignment", async () => {
  const result = await harness.page.evaluate(async () => {
    const { jc } = window;
    const make = async (definitionId: string, params: Record<string, unknown>, scale = { x: 1, y: 1 }) => {
      const doc = jc.project({ width: 800, height: 400 });
      doc.scenes[0].tracks.overlay = [jc.track("graphic", "g0", [jc.element("graphic", { id: "g", startTime: 0, duration: 120000, definitionId, params, transform: { position: { x: 0, y: 0 }, scale, rotation: 0 } })])];
      const opened = await jc.open(doc, { width: 800, height: 400 });
      return { opened, frame: await opened.frameAt(0) };
    };
    type Frame = Awaited<ReturnType<typeof make>>["frame"];
    const run = (frame: Frame, y: number, test: (pixel: number[]) => boolean) => { const xs: number[] = []; for (let x = 0; x < 800; x++) if (test(frame.at(x, y))) xs.push(x); return xs; };
    const column = (frame: Frame, x: number, test: (pixel: number[]) => boolean) => { const ys: number[] = []; for (let y = 0; y < 400; y++) if (test(frame.at(x, y))) ys.push(y); return ys; };
    const span = (list: number[]) => (list.length ? [list[0], list[list.length - 1], list.length] : null);
    const lit = (pixel: number[]) => pixel[0] > 128;
    const red = (pixel: number[]) => pixel[0] > 128 && pixel[1] < 90;
    const white = (pixel: number[]) => pixel[0] > 128 && pixel[1] > 128;
    // A line: 200 units wide, 20 thick, across the middle of its box.
    const butt = await make("line", { stroke: "#ffffff", strokeWidth: 20, lineCap: "butt", dash: 0 });
    const round = await make("line", { stroke: "#ffffff", strokeWidth: 20, lineCap: "round", dash: 0 });
    const dashed = await make("line", { stroke: "#ffffff", strokeWidth: 10, lineCap: "butt", dash: 20 });
    const defaults = await make("line", {});
    const dashes = run(dashed.frame, 200, lit);
    let groups = 0;
    dashes.forEach((x, index) => { if (index === 0 || x - dashes[index - 1] > 1) groups++; });
    // An arrow pointing right: shaft 30 % and head 40 % of the height.
    const arrow = await make("arrow", { fill: "#ff0000", headSize: 40, shaftWidth: 30, doubleHeaded: false });
    const double = await make("arrow", { fill: "#ff0000", headSize: 40, shaftWidth: 30, doubleHeaded: true });
    const thin = await make("arrow", { fill: "#ff0000", headSize: 20, shaftWidth: 10, doubleHeaded: false });
    const shape = (frame: Frame) => ({ row: span(run(frame, 200, red)), shaft: span(column(frame, 330, red)), head: span(column(frame, 430, red)), tip: span(column(frame, 495, red)), left: span(column(frame, 305, red)) });
    // A rectangle stretched 3 × 1 with corner radius 20 and a stroke of 8: the stroke is 8 units on every side.
    const stretched = await make("rectangle", { fill: "#ff0000", stroke: "#ffffff", strokeWidth: 8, strokeAlign: "center", cornerRadius: 20 }, { x: 3, y: 1 });
    const strokeLeft = span(run(stretched.frame, 200, white).filter((x) => x < 400)), strokeTop = span(column(stretched.frame, 400, white).filter((y) => y < 200));
    const bounds = { row: span(run(stretched.frame, 200, lit)), column: span(column(stretched.frame, 400, lit)) };
    // The corner: the first lit row at 10 px from the left edge is as far down as the first lit column at 10 px from the top is in (a circle).
    const cornerDown = column(stretched.frame, bounds.row![0] + 6, lit)[0] - bounds.column![0], cornerIn = run(stretched.frame, bounds.column![0] + 6, lit)[0] - bounds.row![0];
    // Inside alignment: the outer boundary of the shape equals the unstroked outline.
    const inside = await make("rectangle", { fill: "#ff0000", stroke: "#ffffff", strokeWidth: 10, strokeAlign: "inside" });
    const plain = await make("rectangle", { fill: "#ff0000", strokeWidth: 0 });
    const errors = [butt, round, dashed, arrow, double, stretched].flatMap((made) => made.opened.events.filter((event) => event.type === "diagnostic" || event.type === "engine.error").map((event) => event.payload.id ?? event.payload.code));
    return {
      butt: { row: span(run(butt.frame, 200, lit)), column: span(column(butt.frame, 400, lit)) }, round: { row: span(run(round.frame, 200, lit)), nearEnd: span(column(round.frame, 303, lit)) },
      buttNearEnd: span(column(butt.frame, 303, lit)), groups, defaults: { row: span(run(defaults.frame, 200, lit)), column: span(column(defaults.frame, 400, lit)), pixel: defaults.frame.at(400, 200) },
      arrow: shape(arrow.frame), double: shape(double.frame), thin: shape(thin.frame), strokeLeft, strokeTop, bounds, cornerDown, cornerIn,
      inside: { row: span(run(inside.frame, 200, lit)), stroke: span(run(inside.frame, 200, white).filter((x) => x < 400)) }, plain: span(run(plain.frame, 200, lit)), errors,
    };
  });
  // The line spans its 200-unit box (300…499) and is 20 px thick about the middle row.
  assert.ok(Math.abs(result.butt.row![0] - 300) <= 1 && Math.abs(result.butt.row![1] - 499) <= 1, `line span ${result.butt.row}`);
  assert.ok(Math.abs(result.butt.column![2] - 20) <= 1 && Math.abs((result.butt.column![0] + result.butt.column![1]) / 2 - 199.5) <= 1, `line thickness ${result.butt.column}`);
  // A round cap ends inside the box and is narrower near its end; a butt cap is full height there.
  assert.ok(Math.abs(result.round.row![0] - 300) <= 1 && Math.abs(result.round.row![1] - 499) <= 1);
  assert.ok(result.round.nearEnd![2] < result.buttNearEnd![2] - 2, `round cap ${result.round.nearEnd} vs butt ${result.buttNearEnd}`);
  // Dash 20: dash and gap of 20 units each over 200 units → five dashes.
  assert.equal(result.groups, 5);
  // Defaults of a line: white, 8 units thick, round caps.
  assert.ok(result.defaults.row && Math.abs(result.defaults.column![2] - 8) <= 1 && result.defaults.pixel[0] > 250 && result.defaults.pixel[1] > 250, JSON.stringify(result.defaults));
  // The arrow: shaft 60 px thick (30 % of 200), head 200 px high at its base and narrowing to the tip at the right edge; the head is 80 px long.
  assert.ok(Math.abs(result.arrow.row![0] - 300) <= 1 && Math.abs(result.arrow.row![1] - 499) <= 1, `arrow span ${result.arrow.row}`);
  assert.ok(Math.abs(result.arrow.shaft![2] - 60) <= 2, `shaft ${result.arrow.shaft}`);
  assert.ok(Math.abs(result.arrow.head![2] - 175) <= 6, `head 10 px behind its base at x = 420: ${result.arrow.head}`);
  assert.ok(result.arrow.tip![2] < 20, `tip ${result.arrow.tip}`);
  assert.ok(Math.abs(result.arrow.left![2] - 60) <= 2, "a single-headed arrow has a flat tail");
  assert.ok(result.double.left![2] < 20, `a double-headed arrow has a head at the tail too: ${result.double.left}`);
  assert.ok(Math.abs(result.thin.shaft![2] - 20) <= 2 && Math.abs(result.thin.head![2] - 20) <= 2, `shaftWidth 10 and headSize 20: ${JSON.stringify(result.thin)}`);
  // Stretched 3 × 1: 600 × 200 px, the stroke 8 px on the left side and on the top side, the corners circular.
  assert.ok(Math.abs(result.bounds.row![2] - 600) <= 2 && Math.abs(result.bounds.column![2] - 200) <= 2, JSON.stringify(result.bounds));
  assert.ok(Math.abs(result.strokeLeft![2] - 8) <= 1 && Math.abs(result.strokeTop![2] - 8) <= 1, `stroke ${result.strokeLeft} / ${result.strokeTop}`);
  assert.ok(Math.abs(result.cornerDown - result.cornerIn) <= 1 && result.cornerDown >= 2, `the corner is a circular arc (${result.cornerDown} down, ${result.cornerIn} in)`);
  assert.deepEqual([result.inside.row![0], result.inside.row![1]], [result.plain![0], result.plain![1]], "an inside stroke does not grow the shape");
  assert.ok(Math.abs(result.inside.stroke![2] - 10) <= 1);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(harness.errors, []);
});

test("Freehand drawing — Drawing appears where it was drawn; Marker crossing itself; Colour override; strokes are smooth splines with round caps", async () => {
  const result = await harness.page.evaluate(async () => {
    const { jc } = window;
    const make = async (strokes: unknown[], intrinsic: [number, number], position: { x: number; y: number }, params: Record<string, unknown> = { colorOverride: "" }, scale = 1) => {
      const doc = jc.project({ width: 1920, height: 1080 }, { kind: "color", color: "#000000" });
      doc.scenes[0].tracks.overlay = [jc.track("graphic", "g0", [jc.element("graphic", { id: "d", startTime: 0, duration: 120000, definitionId: "drawing", params, intrinsicWidth: intrinsic[0], intrinsicHeight: intrinsic[1], strokes, transform: { position, scale: { x: scale, y: scale }, rotation: 0 } })])];
      const opened = await jc.open(doc, { width: 1920, height: 1080 });
      return { opened, frame: await opened.frameAt(0) };
    };
    // One pen stroke of width 12 from canvas (200, 300) to (1100, 300): the box is 912 × 12 at (650, 300).
    const line = await make([{ id: "s1", points: [[-450, 0], [450, 0]], width: 12, color: "#ffffff", brush: "pen" }], [912, 12], { x: 650 - 960, y: 300 - 540 });
    const row: number[] = [], column: number[] = [];
    for (let x = 0; x < 1920; x++) if (line.frame.at(x, 300)[0] > 128) row.push(x);
    for (let y = 0; y < 1080; y++) if (line.frame.at(650, y)[0] > 128) column.push(y);
    const layout = await line.opened.port.command("layout.query", { elementIds: ["d"], time: 0 }) as { boxes: Record<string, { x: number; y: number; width: number; height: number }> };
    // A marker stroke in red that crosses itself (a figure of eight), a second marker stroke across it, and a pen stroke.
    const marker = await make([
      { id: "m1", points: [[-200, -100], [200, 100], [200, -100], [-200, 100]], width: 40, color: "#ff0000", brush: "marker" },
      { id: "m2", points: [[-250, 150], [250, 150]], width: 40, color: "#ff0000", brush: "marker" },
      { id: "m3", points: [[0, 100], [0, 200]], width: 40, color: "#ff0000", brush: "marker" },
      { id: "p1", points: [[-250, -180], [250, -180]], width: 20, color: "#ffffff80", brush: "pen" },
    ], [600, 440], { x: 0, y: 0 });
    const at = (x: number, y: number) => marker.frame.at(960 + x, 540 + y);
    // The spline passes through its points; the stroke of the figure of eight crosses itself at the centre.
    const single = at(-150, 150), cross = at(0, 0), twoStrokes = at(0, 150), pen = at(0, -180), through = at(200, 100);
    const green = await make([{ id: "a", points: [[-100, -50], [100, -50]], width: 30, color: "#ffffff", brush: "pen" }, { id: "b", points: [[-100, 50], [100, 50]], width: 30, color: "#ff0000", brush: "pen" }], [230, 130], { x: 0, y: 0 }, { colorOverride: "#00ff00" });
    const own = await make([{ id: "a", points: [[-100, -50], [100, -50]], width: 30, color: "#ffffff", brush: "pen" }, { id: "b", points: [[-100, 50], [100, 50]], width: 30, color: "#ff0000", brush: "pen" }], [230, 130], { x: 0, y: 0 });
    // Scaled 3 ×: the stroke edge stays about a pixel wide (rasterised at the displayed size, not enlarged).
    const big = await make([{ id: "s", points: [[-100, 0], [100, 0]], width: 60, color: "#ffffff", brush: "pen" }], [260, 60], { x: 0, y: 0 }, { colorOverride: "" }, 3);
    let edge = 0;
    for (let y = 400; y < 540; y++) { const value = big.frame.at(960, y)[0]; if (value > 30 && value < 225) edge++; }
    const errors = [line, marker, green].flatMap((made) => made.opened.events.filter((event) => event.type === "diagnostic" || event.type === "engine.error").map((event) => event.payload.id ?? event.payload.code));
    return { row: [row[0], row[row.length - 1]], column: [column[0], column[column.length - 1]], layout: layout.boxes.d, single, cross, twoStrokes, pen, through, green: [green.frame.at(960, 490), green.frame.at(960, 590)], own: [own.frame.at(960, 490), own.frame.at(960, 590)], edge, errors };
  });
  // Round caps reach half the width beyond the end points: 194…1105 on the row, 294…305 on the column.
  assert.ok(Math.abs(result.row[0] - 194) <= 1 && Math.abs(result.row[1] - 1105) <= 1, `the stroke runs from 200 to 1100 with round caps: ${result.row}`);
  assert.ok(Math.abs(result.column[0] - 294) <= 1 && Math.abs(result.column[1] - 305) <= 1, `12 px thick about y = 300: ${result.column}`);
  assert.ok(Math.abs(result.layout.x - 194) <= 1 && Math.abs(result.layout.width - 912) <= 1 && Math.abs(result.layout.height - 12) <= 1, JSON.stringify(result.layout));
  // A marker is laid down at half its alpha: red 128 on black; where one stroke crosses itself it is the same.
  assert.ok(Math.abs(result.single[0] - 128) <= 3, `marker at 50 %: ${JSON.stringify([result.single, result.cross, result.twoStrokes, result.pen, result.through])}`);
  assert.ok(Math.abs(result.cross[0] - result.single[0]) <= 2, `the crossing of one stroke is not darker or lighter: ${result.cross}`);
  assert.ok(Math.abs(result.through[0] - 128) <= 3, "the spline passes through its points");
  // Two different marker strokes build up: 1 − 0.5 × 0.5 = 75 %.
  assert.ok(Math.abs(result.twoStrokes[0] - 191) <= 4, `two marker strokes build up: ${result.twoStrokes}`);
  // A pen stroke keeps its own alpha (0x80).
  assert.ok(Math.abs(result.pen[0] - 128) <= 3 && Math.abs(result.pen[1] - 128) <= 3, `pen alpha: ${result.pen}`);
  assert.ok(result.green.every((pixel) => pixel[1] > 250 && pixel[0] < 5), `both strokes render green under the override: ${JSON.stringify(result.green)}`);
  assert.ok(result.own[0][0] > 250 && result.own[0][2] > 250 && result.own[1][0] > 250 && result.own[1][1] < 5, "white and red without it");
  assert.ok(result.edge <= 3, `a drawing scaled 3 × has a sharp edge (${result.edge} px)`);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(harness.errors, []);
});

test("Animated stickers — Looping; Loop off; playback speed; Export matches preview (the frame is a function of the element time) — GIF and APNG; Emoji stickers — an emoji sticker is drawn from the bundled colour font at its intrinsic size", { skip: hasFfmpeg() ? false : "ffmpeg is not installed" }, async () => {
  const result = await harness.page.evaluate(async (origin) => {
    const { jc } = window;
    const SECOND = 120000;
    const fonts = [{ fontId: "emoji", family: "Noto Color Emoji", url: `${origin}/assets/fonts/NotoColorEmoji-Regular.ttf`, weight: 400 }];
    const run = async (file: string, fields: Record<string, unknown>, times: number[]) => {
      const doc = jc.project({ width: 320, height: 180 });
      doc.scenes[0].tracks.overlay = [jc.track("graphic", "g0", [
        jc.element("sticker", { id: "s", startTime: 0, duration: 5 * SECOND, stickerId: "stickers:four", intrinsicWidth: 64, intrinsicHeight: 64, transform: { position: { x: -80, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0 }, ...fields }),
        // A second element of the same sticker, one second later on the timeline: it shows its own frame.
        jc.element("sticker", { id: "late", startTime: SECOND, duration: 4 * SECOND, stickerId: "stickers:four", intrinsicWidth: 64, intrinsicHeight: 64, transform: { position: { x: 80, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0 }, ...fields }),
      ])];
      const opened = await jc.open(doc, { width: 320, height: 180 }, [], (port) => port.command("derived.setSources", { entries: [{ key: "stickers:four", kind: "sticker", url: `${origin}/media/${file}`, sha256: (file.endsWith("gif") ? "aa" : "bb").repeat(32) }] }));
      const name = (pixel: number[]) => (pixel[3] < 10 || pixel[0] + pixel[1] + pixel[2] < 60 ? "none" : pixel[0] > 200 && pixel[1] > 200 ? "white" : pixel[0] > 200 ? "red" : pixel[1] > 200 ? "green" : pixel[2] > 150 ? "blue" : `?${pixel}`);
      const seen: string[][] = [];
      for (const time of times) { const frame = await opened.frameAt(Math.round(time * SECOND)); seen.push([name(frame.at(80, 90)), name(frame.at(240, 90))]); }
      return { seen, diagnostics: opened.events.filter((event) => event.type === "diagnostic").map((event) => event.payload.id), opened };
    };
    // Frames: red 0–0.5 s, green 0.5–1 s, blue 1–1.5 s, white 1.5–2 s. The times are frame starts of the 30 fps project.
    const times = [0.2, 0.7, 1.2, 1.7, 2.2, 4.5, 0.7];
    const gif = await run("four.gif", {}, times), apng = await run("four.png", {}, times);
    const once = await run("four.gif", { loop: false }, [1.2, 2.5, 4.5]);
    const fast = await run("four.gif", { playbackSpeed: 2 }, [0.3, 0.6, 1.1]);
    // An emoji sticker at 512 × 512 intrinsic, shown at 160 px.
    const doc = jc.project({ width: 320, height: 180 });
    doc.scenes[0].tracks.overlay = [jc.track("graphic", "g0", [jc.element("sticker", { id: "e", startTime: 0, duration: SECOND, stickerId: "emoji:1f600", intrinsicWidth: 512, intrinsicHeight: 512, transform: { position: { x: 0, y: 0 }, scale: { x: 160 / 512, y: 160 / 512 }, rotation: 0 } })])];
    const emoji = await jc.open(doc, { width: 320, height: 180 }, [], (port) => port.command("fonts.setSources", { fonts }));
    await emoji.engine.whenFontsSettled();
    const frame = await emoji.frameAt(0);
    let yellow = 0, minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
    for (let y = 0; y < 180; y++) for (let x = 0; x < 320; x++) { const pixel = frame.at(x, y); if (pixel[0] + pixel[1] + pixel[2] > 90) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); if (pixel[0] > 200 && pixel[1] > 150 && pixel[2] < 110) yellow++; } }
    const emojiDiagnostics = emoji.events.filter((event) => event.type === "diagnostic").map((event) => event.payload.id);
    return { gif: gif.seen, apng: apng.seen, once: once.seen, fast: fast.seen, diagnostics: [...gif.diagnostics, ...apng.diagnostics, ...emojiDiagnostics], emoji: { yellow, minX, maxX, minY, maxY } };
  }, harness.origin);
  // The first element follows its own time; the second starts 1 s later, so it is one second behind (absent before 1 s).
  const expected = [["red", "none"], ["green", "none"], ["blue", "red"], ["white", "green"], ["red", "blue"], ["green", "white"], ["green", "none"]];
  assert.deepEqual(result.gif, expected, `GIF frames by element time, looping: 4.5 s shows the frame at 0.5 s: ${JSON.stringify(result.gif)}`);
  assert.deepEqual(result.apng, expected, "APNG frames by element time");
  assert.deepEqual(result.once, [["blue", "red"], ["white", "white"], ["white", "white"]], "with loop off the last frame holds after one pass");
  assert.deepEqual(result.fast, [["green", "none"], ["blue", "none"], ["red", "red"]], "speed 2 plays a pass in one second");
  assert.deepEqual(result.diagnostics, []);
  // The emoji fills most of its 160 px square about the canvas centre, in colour.
  const { emoji } = result;
  assert.ok(emoji.yellow > 6000, `the emoji is drawn in colour (${emoji.yellow} yellow px)`);
  assert.ok(emoji.maxX - emoji.minX > 110 && emoji.maxX - emoji.minX <= 162 && emoji.maxY - emoji.minY > 110 && emoji.maxY - emoji.minY <= 162, JSON.stringify(emoji));
  assert.ok(Math.abs((emoji.minX + emoji.maxX) / 2 - 160) <= 6 && Math.abs((emoji.minY + emoji.maxY) / 2 - 90) <= 12, `centred: ${JSON.stringify(emoji)}`);
  assert.deepEqual(harness.errors, []);
});

test("Text templates — Exactly 30 offline: every template renders every member (texts with presets, bubbles and animations; rectangle, ellipse and arrow shapes) without a diagnostic", async () => {
  const result = await harness.page.evaluate(async (origin) => {
    const { jc } = window;
    const fonts = [
      { fontId: "arimo-400", family: "Arimo", url: `${origin}/fixtures/fonts/Arimo-Regular.ttf`, weight: 400 }, { fontId: "arimo-700", family: "Arimo", url: `${origin}/fixtures/fonts/Arimo-Bold.ttf`, weight: 700 },
      // The other baseline families of the templates are served by the same two test faces.
      ...["Gelasio", "Tinos", "Cousine", "Noto Sans"].flatMap((family) => [{ fontId: `${family}-400`, family, url: `${origin}/fixtures/fonts/Arimo-Regular.ttf`, weight: 400 }, { fontId: `${family}-700`, family, url: `${origin}/fixtures/fonts/Arimo-Bold.ttf`, weight: 700 }]),
    ];
    const templates = jc.editorCore.TEXT_TEMPLATES;
    const base = jc.project({ width: 640, height: 360 }, { kind: "color", color: "#404040" });
    let next = 0;
    const env = { newId: () => `id${next++}` } as never;
    const opened = await jc.open(base, { width: 640, height: 360 }, [], (port) => port.command("fonts.setSources", { fonts }));
    const report: { id: string; members: number; drawn: number; changed: number; types: string[] }[] = [];
    const empty = await opened.frameAt(0);
    let revision = 1;
    for (const template of templates) {
      const elements = jc.editorCore.timeline.buildTextTemplate(base as never, template, 0, env) as unknown as Record<string, any>[];
      // Back to front as the catalogue lists them: every member on a track of its own, the first at the bottom.
      const tracks = elements.map((element, index) => jc.track(element.type === "text" ? "text" : "graphic", `tr${revision}-${index}`, [element])).reverse();
      await opened.port.command("scene.patch", { baseRevision: revision, revision: revision + 1, patches: [{ op: "replace", path: "/scenes/@s1/tracks/overlay", value: tracks }] });
      revision++;
      await opened.engine.whenFontsSettled();
      // The middle of the template (a frame start), where every In animation is over and no Out has begun.
      const time = Math.round((template.duration * 120000) / 2 / 4000) * 4000;
      const frame = await opened.frameAt(time);
      const visible = elements.filter((element) => element.startTime <= time && time < element.startTime + element.duration);
      const layout = await opened.port.command("layout.query", { elementIds: visible.map((element) => element.id), time }) as { boxes: Record<string, unknown> };
      let changed = 0;
      for (let index = 0; index < frame.pixels.length; index += 16) if (Math.abs(frame.pixels[index] - empty.pixels[index]) > 8 || Math.abs(frame.pixels[index + 1] - empty.pixels[index + 1]) > 8) changed++;
      report.push({ id: template.id, members: visible.length, drawn: Object.keys(layout.boxes).length, changed, types: [...new Set(elements.map((element) => (element.type === "graphic" ? element.definitionId : element.bubble ? "bubble" : "text")))] });
    }
    const diagnostics = opened.events.filter((event) => event.type === "diagnostic" || event.type === "engine.error").map((event) => `${event.payload.id ?? event.payload.code}:${event.payload.elementId ?? ""}`);
    return { report, diagnostics };
  }, harness.origin);
  assert.equal(result.report.length, 30);
  for (const entry of result.report) {
    assert.equal(entry.drawn, entry.members, `${entry.id}: every visible member is drawn`);
    assert.ok(entry.members > 0 && entry.changed > 40, `${entry.id} puts pixels on the frame (${entry.changed} sampled)`);
  }
  const used = new Set(result.report.flatMap((entry) => entry.types));
  assert.deepEqual([...used].sort(), ["arrow", "bubble", "ellipse", "rectangle", "text"]);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(harness.errors, []);
});
