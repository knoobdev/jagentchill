// End-to-end in a real browser against the Expo web dev server, with no host: the second half of the content tabs and
// inspectors of the editor — curved text, bubbles, text animations and templates, caption highlight, drawing, shapes,
// emoji and imported stickers, equaliser, ducking, normalisation and beat markers. Real storage (IndexedDB and OPFS of a fresh browser profile) and
// real media files made with ffmpeg; nothing is seeded or mocked. The exported file is probed with ffmpeg.
// Usage: node apps/app/e2e/editor-content2.mjs [screenshot-dir] [base-url]
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const shots = process.argv[2] ?? ".dev/shots/editor-content2";
const base = process.argv[3] ?? "http://localhost:8081";
const only = process.env.JC_ONLY ? process.env.JC_ONLY.split(",") : null;
mkdirSync(shots, { recursive: true });

// — Media: a silent dark video, a "voice" tone, a "music" tone, a subtitle file —
const dir = join(tmpdir(), "jagentchill-editor-content2-e2e");
mkdirSync(dir, { recursive: true });
const ffmpeg = (...args) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args]);
const media = (name) => join(dir, name);
if (!existsSync(media("dark.mp4"))) ffmpeg("-f", "lavfi", "-i", "color=c=0x101020:s=640x360:r=30:d=8", "-c:v", "libx264", "-pix_fmt", "yuv420p", media("dark.mp4"));
// A caption of four words over 4 s, and a second one; two tones (60 Hz and 1 kHz) in one file; a quiet tone; a "voice" tone; an animated sticker of two frames.
writeFileSync(media("words.srt"), "1\n00:00:01,000 --> 00:00:05,000\nalpha beta gamma delta\n\n2\n00:00:06,000 --> 00:00:07,000\nsecond line\n");
if (!existsSync(media("tones.wav"))) ffmpeg("-f", "lavfi", "-i", "sine=frequency=60:duration=3", "-f", "lavfi", "-i", "sine=frequency=1000:duration=3", "-filter_complex", "[0][1]amix=inputs=2:normalize=0,volume=2", "-ac", "2", "-ar", "48000", media("tones.wav"));
if (!existsSync(media("quiet.wav"))) ffmpeg("-f", "lavfi", "-i", "sine=frequency=1000:duration=4", "-af", "volume=-12dB", "-ac", "2", "-ar", "48000", media("quiet.wav"));
if (!existsSync(media("voice.wav"))) ffmpeg("-f", "lavfi", "-i", "sine=frequency=880:duration=2", "-ac", "2", "-ar", "48000", media("voice.wav"));
if (!existsSync(media("music.wav"))) ffmpeg("-f", "lavfi", "-i", "sine=frequency=330:duration=8", "-ac", "2", "-ar", "48000", media("music.wav"));
if (!existsSync(media("blink2.gif"))) {
  ffmpeg("-f", "lavfi", "-i", "color=c=red:s=64x64", "-frames:v", "1", media("blink-1.png"));
  ffmpeg("-f", "lavfi", "-i", "color=c=blue:s=64x64", "-frames:v", "1", media("blink-2.png"));
  ffmpeg("-framerate", "2", "-i", media("blink-%d.png"), "-loop", "0", media("blink2.gif"));
}

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light", acceptDownloads: true });
// A headless browser has no save dialog to answer: without the picker an export is offered as a download, the path this script reads.
await context.addInitScript(() => { delete window.showSaveFilePicker; delete window.showDirectoryPicker; });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
const visible = (locator) => locator.filter({ visible: true }).first();
const tid = (id) => visible(page.getByTestId(id));
const button = (name, exact = true) => visible(page.getByRole("button", { name, exact }));
const shot = (name) => page.screenshot({ path: `${shots}/${name}.png` });
const expect = (condition, message) => { if (!condition) throw new Error(message); };
const step = async (name, run) => {
  if (only && !only.some((part) => name.includes(part)) && !name.startsWith("setup")) return;
  try { await run(); console.log("ok  ", name); }
  catch (err) { console.log("FAIL", name, "—", String(err).split("\n")[0]); errors.push(`step failed: ${name}`); await shot(`failure-${name.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}`); }
};
const mod = process.platform === "darwin" ? "Meta" : "Control";
const saved = () => visible(page.getByTestId("save-state").getByText("Saved", { exact: true })).waitFor({ timeout: 20_000 });
const importFiles = async (paths) => { const [chooser] = await Promise.all([page.waitForEvent("filechooser"), tid("media-dropzone").click()]); await chooser.setFiles(paths); };
const rulerBox = () => tid("timeline-ruler").boundingBox();
const seekTo = async (seconds) => { const ruler = await rulerBox(); await page.mouse.click(ruler.x + seconds * 50, ruler.y + 6); await page.waitForTimeout(250); };
const clipBoxes = (track) => page.evaluate((type) => [...document.querySelectorAll(`[data-testid^="track-"] [data-testid^="clip-"]`)].filter((node) => !["clip-selection", "clip-hover", "clip-hatch", "clip-mute", "clip-reverse"].includes(node.getAttribute("data-testid")))
  .map((node) => { const rect = node.getBoundingClientRect(), row = node.closest('[data-testid^="track-"]'); return { id: node.getAttribute("data-testid").slice(5), track: row?.getAttribute("data-testid") ?? "", x: rect.left, y: rect.top, width: rect.width, height: rect.height, label: node.getAttribute("aria-label") ?? "" }; })
  .filter((clip) => !type || clip.track.includes(type)), track);
const clickClip = async (clip) => { await page.mouse.click(clip.x + Math.min(clip.width / 2, 20), clip.y + clip.height / 2); await page.waitForTimeout(200); };
/** Pixel statistics of the preview canvas, read from a screenshot: how many pixels are light, and how many are near a colour. */
const canvasStats = async (near = null, fromY = 0) => {
  const box = await tid("canvas").boundingBox();
  const png = await page.screenshot({ clip: { x: Math.ceil(box.x) + 1, y: Math.ceil(box.y) + 1, width: Math.floor(box.width) - 2, height: Math.floor(box.height) - 2 } });
  return page.evaluate(async ({ data, near, fromY }) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context2d = canvas.getContext("2d");
    context2d.drawImage(bitmap, 0, 0);
    const pixels = context2d.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let light = 0, close = 0, minX = bitmap.width, maxX = 0, minY = bitmap.height, maxY = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const r = pixels[index], g = pixels[index + 1], b = pixels[index + 2], x = (index / 4) % bitmap.width, y = Math.floor(index / 4 / bitmap.width);
      if (y < fromY * bitmap.height) continue;
      const isLight = r > 200 && g > 200 && b > 200, isClose = near && Math.abs(r - near[0]) < 48 && Math.abs(g - near[1]) < 48 && Math.abs(b - near[2]) < 48;
      if (isLight) light++;
      if (isClose) close++;
      if (isLight || isClose) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    }
    return { light, close, width: bitmap.width, height: bitmap.height, bounds: maxX >= minX ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, centreX: (minX + maxX) / 2 / bitmap.width, centreY: (minY + maxY) / 2 / bitmap.height } : null };
  }, { data: png.toString("base64"), near, fromY });
};
const settle = (ms = 700) => page.waitForTimeout(ms * Number(process.env.JC_SLOW ?? 1));
/** The switch in the header of an inspector section. */
const sectionSwitch = (id) => visible(page.getByTestId(id).getByRole("switch"));
const field = (testId) => visible(page.getByTestId(testId).locator("input"));
const typeInto = async (locator, value) => { await locator.click(); await locator.fill(String(value)); await locator.press("Enter"); await page.waitForTimeout(250); };
const compare = async (frameId, name, scheme = "light") => {
  // The design frame on the left, this screen on the right: what the two are compared on.
  const design = await context.newPage();
  await design.setViewportSize({ width: 1700, height: 1100 });
  await design.emulateMedia({ colorScheme: scheme });
  await design.goto(`file://${process.cwd()}/docs/design/jagentchill-ui.html`);
  if (scheme === "dark") await design.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  const frame = design.locator(`#${frameId} .dframe`).first();
  await frame.scrollIntoViewIfNeeded();
  const left = (await frame.screenshot()).toString("base64"), right = (await page.screenshot()).toString("base64");
  await design.setViewportSize({ width: 2440, height: 820 });
  await design.setContent(`<body style="margin:0;background:#888;font:600 16px system-ui;color:#fff"><div style="display:flex;gap:20px;padding:10px"><div><div>DESIGN ${frameId}</div><img style="width:1200px;display:block" src="data:image/png;base64,${left}"></div><div><div>APP /editor</div><img style="width:1200px;display:block" src="data:image/png;base64,${right}"></div></div></body>`);
  mkdirSync(".dev/compare", { recursive: true });
  await design.screenshot({ path: `.dev/compare/${name}.png` });
  await design.close();
};

/** The lit pixels of the preview canvas (brighter than the dark video): their count, bounds and, per column, the first and last lit row. */
/** Runs `shoot` with the selection box and its handles hidden: what is measured is the picture the engine drew. */
const bare = async (shoot) => {
  const style = await page.addStyleTag({ content: '[data-testid="selection-box"], :has(> [data-testid="handle-nw"]), [data-testid^="handle-"], [data-testid="snap-guide"] { visibility: hidden !important; }' });
  try { return await shoot(); } finally { await style.evaluate((node) => node.remove()); }
};
let litCount = 0;
const lit = async (sum = 200) => {
  const box = await tid("canvas").boundingBox();
  const png = await bare(() => page.screenshot({ clip: { x: Math.ceil(box.x) + 1, y: Math.ceil(box.y) + 1, width: Math.floor(box.width) - 2, height: Math.floor(box.height) - 2 } }));
  if (process.env.JC_DEBUG) console.log(`     [lit ${litCount + 1}] timecode ${await tid("timecode").inputValue().catch(() => "?")}, play button: ${await tid("player-play").getAttribute("aria-label")}`);
  if (process.env.JC_DEBUG) writeFileSync(`${shots}/lit-${String(++litCount).padStart(2, "0")}.png`, png);
  return page.evaluate(async ({ data, sum }) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context2d = canvas.getContext("2d");
    context2d.drawImage(bitmap, 0, 0);
    const pixels = context2d.getImageData(0, 0, bitmap.width, bitmap.height).data, width = bitmap.width, height = bitmap.height;
    const top = new Array(width).fill(-1), bottom = new Array(width).fill(-1);
    let count = 0, minX = width, maxX = -1, minY = height, maxY = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      if (pixels[at] + pixels[at + 1] + pixels[at + 2] <= sum) continue;
      count++; if (top[x] < 0) top[x] = y; bottom[x] = y;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    return { count, width, height, top, bottom, bounds: maxX >= 0 ? { x: minX, y: minY, right: maxX, bottom: maxY, width: maxX - minX + 1, height: maxY - minY + 1, centreX: (minX + maxX) / 2, centreY: (minY + maxY) / 2 } : null };
  }, { data: png.toString("base64"), sum });
};
/** The colour of one pixel of the preview canvas, at a fraction of its width and height. */
const pixelAt = async (fx, fy) => {
  const box = await tid("canvas").boundingBox();
  const png = await bare(() => page.screenshot({ clip: { x: Math.round(box.x + fx * box.width) - 1, y: Math.round(box.y + fy * box.height) - 1, width: 3, height: 3 } }));
  return page.evaluate(async (data) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
    const canvas = new OffscreenCanvas(3, 3), context2d = canvas.getContext("2d");
    context2d.drawImage(bitmap, 0, 0);
    return Array.from(context2d.getImageData(1, 1, 1, 1).data.slice(0, 3));
  }, png.toString("base64"));
};
/** Waits until the engine's canvas is the preview's own again: library tiles are rendered into the same canvas, under a cover picture. */
const engineIdle = async () => { for (let quiet = 0; quiet < 4;) { await page.waitForTimeout(250); quiet = (await page.locator("[data-fx-cover]").count()) === 0 ? quiet + 1 : 0; } };
/** Where the pixels of two colours are in the lower part of the preview canvas: a colour is "near" within 60 per channel. */
const colours = async (first, second, fromY = 0.6) => {
  const box = await tid("canvas").boundingBox();
  const png = await bare(() => page.screenshot({ clip: { x: Math.ceil(box.x) + 1, y: Math.ceil(box.y) + 1, width: Math.floor(box.width) - 2, height: Math.floor(box.height) - 2 } }));
  return page.evaluate(async ({ data, first, second, fromY }) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context2d = canvas.getContext("2d");
    context2d.drawImage(bitmap, 0, 0);
    const pixels = context2d.getImageData(0, 0, bitmap.width, bitmap.height).data, width = bitmap.width;
    const found = [first, second].map(() => ({ count: 0, left: width, right: -1 }));
    for (let index = Math.floor(fromY * bitmap.height) * width * 4; index < pixels.length; index += 4) [first, second].forEach((colour, at) => {
      if (Math.abs(pixels[index] - colour[0]) > 60 || Math.abs(pixels[index + 1] - colour[1]) > 60 || Math.abs(pixels[index + 2] - colour[2]) > 60) return;
      const x = (index / 4) % width;
      found[at].count++; found[at].left = Math.min(found[at].left, x); found[at].right = Math.max(found[at].right, x);
    });
    return { first: found[0], second: found[1], width };
  }, { data: png.toString("base64"), first, second, fromY });
};
const rms = (file, from, to, filter = "anull") => {
  const text = spawnSync("ffmpeg", ["-hide_banner", "-ss", String(from), "-t", String(to - from), "-i", file, "-vn", "-af", `${filter},astats=metadata=0:measure_overall=RMS_level:measure_perchannel=none`, "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const match = /RMS level dB: (-?[\d.]+|-inf)/.exec(text);
  return match ? (match[1] === "-inf" ? -120 : Number(match[1])) : NaN;
};
/** Integrated loudness of a part of a file (EBU R 128, by ffmpeg). */
const lufs = (file, from, to) => {
  const text = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-ss", String(from), "-t", String(to - from), "-i", file, "-vn", "-af", "ebur128", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const match = /Integrated loudness:\s+I:\s+(-?[\d.]+) LUFS/.exec(text);
  return match ? Number(match[1]) : NaN;
};
const audioClip = async (name, nth = 0) => (await clipBoxes("audio")).filter((clip) => clip.label.includes(name)).sort((a, b) => a.x - b.x)[nth];
const addSound = async (name, seconds) => { await seekTo(seconds); await visible(page.getByTestId("audio-row").filter({ hasText: name }).getByTestId("audio-add")).click(); await page.waitForTimeout(500); };
const inspectorTab = (name) => visible(page.getByTestId("inspector").getByRole("tab", { name, exact: true }));
const documentOf = () => page.evaluate(async () => {
  // The stored project, read from the app's own database: what a reload would open.
  const id = location.pathname.split("/").pop();
  const database = await new Promise((resolve, reject) => { const request = indexedDB.open("jagentchill"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  const find = (value, depth = 0) => {
    if (value instanceof Uint8Array || value instanceof ArrayBuffer) { try { return find(JSON.parse(new TextDecoder().decode(value)), depth + 1); } catch { return null; } }
    if (typeof value === "string") { if (!value.includes('"scenes"')) return null; try { return find(JSON.parse(value), depth + 1); } catch { return null; } }
    if (value === null || typeof value !== "object" || depth > 4) return null;
    if (Array.isArray(value.scenes) && value.settings && value.metadata?.id === id) return value;
    for (const member of Object.values(value)) { const found = find(member, depth + 1); if (found) return found; }
    return null;
  };
  for (const store of database.objectStoreNames) {
    const rows = await new Promise((resolve) => { const all = database.transaction(store).objectStore(store).getAll(); all.onsuccess = () => resolve(all.result); all.onerror = () => resolve([]); });
    for (const row of rows) { const found = find(row); if (found) return found; }
  }
  return null;
});
const elementsOf = (doc) => doc.scenes.flatMap((scene) => [...scene.tracks.overlay, scene.tracks.main, ...scene.tracks.audio].flatMap((track) => track.elements));

await step("setup: a new project with a dark video on the main track", async () => {
  await page.goto(`${base}/projects`, { waitUntil: "networkidle", timeout: 180_000 });
  await button("Create your first project").click({ timeout: 90_000 });
  await page.waitForURL(/\/editor\/[0-9a-f-]{36}$/);
  for (const id of ["editor-bar", "asset-panel", "player", "inspector", "timeline"]) await tid(id).waitFor({ timeout: 60_000 });
  await importFiles([media("dark.mp4"), media("tones.wav"), media("quiet.wav"), media("voice.wav"), media("music.wav")]);
  for (const name of ["dark.mp4", "tones.wav", "quiet.wav", "voice.wav", "music.wav"]) await tid(`label-${name}`).waitFor({ timeout: 60_000 });
  await tid("thumb-dark.mp4").dblclick();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="track-main-video"] [data-testid^="clip-"]').length >= 1);
  await saved();
  await settle(1500);
});

// ————————————————————————————————— Text —————————————————————————————————
await step("text: Curve bends the line along an arc — Half circle, Straight", async () => {
  await seekTo(1);
  await tid("panel-tab-text").click();
  await engineIdle();
  await tid("text-add").click();
  await tid("text-inspector").waitFor();
  await tid("text-content").fill("ARC OF TEXT");
  await tid("text-content").blur();
  await typeInto(field("text-size"), 10);
  await tid("text-content").blur();
  await settle(1500);
  const straight = await lit();
  const column = (stats, fraction) => { const x = Math.round(stats.bounds.x + fraction * (stats.bounds.width - 1)); for (let offset = 0; offset < 12; offset++) for (const at of [x + offset, x - offset]) if (stats.top[at] >= 0) return { top: stats.top[at], bottom: stats.bottom[at] }; return null; };
  await typeInto(field("text-curve"), 180);
  await settle(1500);
  const up = await lit();
  const edgeL = column(up, 0.04), centre = column(up, 0.5), edgeR = column(up, 0.96);
  console.log(`     straight ${straight.bounds.width}×${straight.bounds.height}; curve 180: ${up.bounds.width}×${up.bounds.height}, tops at 4 % / 50 % / 96 % of the width: ${edgeL.top} / ${centre.top} / ${edgeR.top}`);
  expect(up.bounds.height > straight.bounds.height * 3, `a half circle is much taller than the straight line (${straight.bounds.height} → ${up.bounds.height} px)`);
  // A line of length L on a half circle has the radius L/π: with the glyphs standing on the outside of the arc it spans 2 (L/π + glyph height) across.
  const across = 2 * (straight.bounds.width / Math.PI + straight.bounds.height);
  expect(Math.abs(up.bounds.width - across) < across * 0.12, `the arc spans ${up.bounds.width} px across; a half circle of this line gives ${Math.round(across)} px`);
  // Arching upward: the middle of the line is at the top of the arc, its two ends at the bottom.
  expect(centre.top < edgeL.top - straight.bounds.height && centre.top < edgeR.top - straight.bounds.height, `the middle is above both ends (${centre.top} vs ${edgeL.top}, ${edgeR.top})`);
  // The pixels follow the arc: the block is a half disc (as high as half its width), and the top of the ink in every column lies in the ring between
  // the circle the glyphs stand on and the circle their tops touch — sampled at every lit column.
  const outer = up.bounds.width / 2, cx = up.bounds.centreX, cy = up.bounds.bottom, glyph = straight.bounds.height;
  expect(Math.abs(up.bounds.height - outer) <= 4, `a half circle is as high as half its width (${up.bounds.height} px high, ${up.bounds.width} px wide)`);
  const distances = up.top.map((y, x) => (y < 0 ? null : Math.hypot(x - cx, y - cy))).filter((value) => value !== null);
  const onRim = distances.filter((value) => Math.abs(value - outer) <= 3).length, outside = distances.filter((value) => value > outer + 3 || value < outer - glyph - 6).length;
  console.log(`     ${distances.length} lit columns: ${onRim} have their top on the outer circle (radius ${outer.toFixed(1)} px), ${outside} lie outside the ring`);
  expect(outside === 0, `no ink outside the ring of the arc (${outside} columns)`);
  expect(onRim > distances.length * 0.3, `the tops of the glyphs touch the outer circle all along the arc (${onRim} of ${distances.length} columns)`);
  // The first and the last glyph stand at the two ends of the half circle: their ink reaches the level of the centre.
  const lowest = (from, to) => Math.max(...up.bottom.slice(Math.round(from), Math.round(to) + 1));
  expect(lowest(up.bounds.x, up.bounds.x + up.bounds.width * 0.12) >= cy - 6 && lowest(up.bounds.right - up.bounds.width * 0.12, up.bounds.right) >= cy - 6, "both ends of the line reach the diameter");
  await shot("01-text-curve-180");
  await typeInto(field("text-curve"), -180);
  await settle(1500);
  const down = await lit(), downCentre = column(down, 0.5), downEdge = column(down, 0.04);
  expect(downCentre.bottom > downEdge.bottom + straight.bounds.height, `a negative curve arches downward: the middle is below the ends (${downCentre.bottom} vs ${downEdge.bottom})`);
  await typeInto(field("text-curve"), 0);
  await settle(1500);
  const back = await lit();
  expect(Math.abs(back.bounds.width - straight.bounds.width) <= 2 && Math.abs(back.bounds.height - straight.bounds.height) <= 2 && Math.abs(back.count - straight.count) < straight.count * 0.02, `curve 0 is the straight layout again (${back.bounds.width}×${back.bounds.height})`);
});

await step("text: an In animation moves and fades the block as its definition says — Catalogue motion, Remove", async () => {
  if (process.env.JC_MEDIA) { await tid("panel-tab-media").click(); await settle(1000); }
  await inspectorTab("Animation").click();
  await tid("animation-tab").waitFor();
  const counts = {};
  for (const group of ["In", "Out", "Loop"]) { await visible(page.getByTestId("animation-tab").getByRole("tab", { name: group, exact: true })).click(); await page.waitForTimeout(200); counts[group] = await page.locator('[data-testid^="text-animation-"][data-testid*="-' + group.toLowerCase() + '-"]').count(); }
  expect(counts.In === 21 && counts.Out === 21 && counts.Loop === 13, `In and Out list None + 20, Loop None + 12: ${JSON.stringify(counts)}`);
  await visible(page.getByTestId("animation-tab").getByRole("tab", { name: "In", exact: true })).click();
  await seekTo(2.5);
  await settle(900);
  const rest = await lit();
  await tid("text-animation-in-in-slide-up").click();
  await page.mouse.move(700, 300);
  await settle(600);
  await saved();
  console.log(`     stored after the click: ${JSON.stringify(elementsOf(await documentOf()).find((element) => element.type === "text")?.textAnimation)}`);
  // Slide up, In: from +100 % of the block height and opacity 0 to its place, out-cubic. The clip starts at 1 s; the default duration is 0.5 s.
  await typeInto(field("text-animation-time"), 1);
  await saved();
  if (process.env.JC_DEBUG) console.log(`     stored after the duration: ${JSON.stringify(elementsOf(await documentOf()).filter((element) => element.type === "text").map((element) => ({ start: element.startTime, duration: element.duration, animation: element.textAnimation, opacity: element.opacity, curve: element.curve })))}`);
  if (process.env.JC_PROBE2) { await seekTo(1); for (const ms of [150, 300, 600, 1000, 2000, 4000]) { await page.waitForTimeout(ms); const probe = await lit(120); console.log(`     +${ms} ms: ${probe.count} lit, centre y ${probe.bounds?.centreY}`); } }
  if (process.env.JC_PROBE) for (const seconds of process.env.JC_PROBE.split(",").map(Number)) { await seekTo(seconds); await settle(1500); const probe = await lit(120); console.log(`     probe ${seconds} s: ${probe.count} lit, centre y ${probe.bounds?.centreY}`); }
  await seekTo(1);
  await settle(1200);
  const start = await lit(120);
  await seekTo(1.5);
  await settle(1200);
  const middle = await lit(120);
  await seekTo(2.5);
  await settle(1200);
  const end = await lit(120), restAt = await lit(120);
  console.log(`     slide up over 1 s: lit pixels at 0 / 0.5 / 1.5 s of the clip: ${start.count} / ${middle.count} / ${end.count}; centre y ${middle.bounds?.centreY} → ${end.bounds?.centreY}; block height ${end.bounds.height}`);
  expect(start.count < end.count * 0.05, `at its first frame the text is transparent (${start.count} lit pixels of ${end.count})`);
  expect(middle.bounds !== null && middle.bounds.centreY > end.bounds.centreY + 1 && middle.bounds.centreY < end.bounds.centreY + end.bounds.height * 1.05, `half-way the block is still below its place, by less than its height (${middle.bounds?.centreY} vs ${end.bounds.centreY})`);
  // Out-cubic at 0.5 leaves 12.5 % of the travel: the block is one eighth of its height below its place (±1/8).
  const travel = (middle.bounds.centreY - end.bounds.centreY) / end.bounds.height;
  expect(travel > 0.03 && travel < 0.3, `the offset half-way is about 12.5 % of the block height: ${(travel * 100).toFixed(1)} %`);
  expect(Math.abs(end.count - restAt.count) < 5 && Math.abs(end.bounds.centreY - rest.bounds.centreY) <= 1, "after the animation the text is at rest, where it was without one");
  await shot("02-text-animation");
  // The animated zone is shaded on the clip's bar.
  expect((await page.getByTestId("animation-zone-in").count()) === 1, "the clip shows its In zone");
  const doc = await (async () => { await saved(); return documentOf(); })();
  const text = elementsOf(doc).find((element) => element.type === "text");
  expect(text.textAnimation?.in?.id === "in-slide-up" && text.textAnimation.in.duration === 120_000 && text.textAnimation.in.strength === 100, `the stored animation: ${JSON.stringify(text.textAnimation)}`);
  await tid("text-animation-in-none").click();
  await page.mouse.move(700, 300);
  await seekTo(1);
  await settle(1200);
  const none = await lit(120);
  expect(Math.abs(none.count - end.count) < end.count * 0.02, `with None the text is fully visible from its first frame (${none.count} of ${end.count})`);
});

await step("text: a Loop animation runs between In and Out and a seek shows the same frame every time — Seek equals playback", async () => {
  await visible(page.getByTestId("animation-tab").getByRole("tab", { name: "Loop", exact: true })).click();
  // Pulse: scale = 1 + 0.08 × sin(2πφ), one turn per period (1 s). A quarter of a period in the block is 8 % larger, at three quarters 8 % smaller, and a whole period later it is the same again.
  const at = async (seconds) => { await seekTo(seconds); await settle(1100); return lit(120); };
  await tid("text-animation-loop-none").click();
  const plain = await at(1.25);
  await tid("text-animation-loop-loop-pulse").click();
  await page.mouse.move(700, 300);
  const a = await at(1.25), b = await at(1.75), c = await at(2.25), again = await at(1.25);
  console.log(`     pulse, widths at 0.25 / 0.75 / 1.25 s of the clip: ${a.bounds.width} / ${b.bounds.width} / ${c.bounds.width} (${plain.bounds.width} without it)`);
  expect(Math.abs(a.bounds.width / plain.bounds.width - 1.08) < 0.02, `a quarter of a period in, the block is 8 % wider (${(a.bounds.width / plain.bounds.width).toFixed(3)})`);
  expect(Math.abs(b.bounds.width / plain.bounds.width - 0.92) < 0.02, `at three quarters it is 8 % narrower (${(b.bounds.width / plain.bounds.width).toFixed(3)})`);
  expect(Math.abs(a.bounds.width - c.bounds.width) <= 1, `one period apart the block has the same size (${a.bounds.width} vs ${c.bounds.width})`);
  expect(again.count === a.count && again.bounds.width === a.bounds.width, "seeking to the same time draws the same frame");
  await tid("text-animation-loop-none").click();
});

await step("text: a bubble is drawn behind the text and turns the background off — Apply a bubble, Exclusive with background", async () => {
  await seekTo(2);
  await inspectorTab("Text").click();
  await sectionSwitch("text-background").click();
  await settle(600);
  await visible(page.getByTestId("text-inspector").getByRole("tab", { name: "Bubble" })).click();
  await tid("bubble-tab").waitFor();
  expect((await page.locator('[data-testid^="bubble-"]:not([data-testid="bubble-tab"]):not([data-testid="bubble-settings"]):not([data-testid="bubble-flip"]):not([data-testid="bubble-stroke-width"])').count()) === 21, "None and the 20 bundled bubbles");
  const before = await lit(600);
  await tid("bubble-speech-round-left").click();
  await page.mouse.move(700, 300);
  await settle(1500);
  const bubbled = await lit(600);
  // The bubble is white with a black stroke: the white area is far larger than the glyphs, and the tail reaches below the text.
  expect(bubbled.count > before.count * 3, `the white bubble covers far more pixels than the white letters (${before.count} → ${bubbled.count})`);
  expect(bubbled.bounds.height > before.bounds.height * 1.5, `the bubble is taller than the line (${before.bounds.height} → ${bubbled.bounds.height})`);
  await saved();
  const text = elementsOf(await documentOf()).find((element) => element.type === "text");
  expect(text.bubble?.id === "speech-round-left" && text.bubble.color === "#ffffff" && text.bubble.strokeWidth === 4 && text.background.enabled === false, `the bubble is stored with its catalogue colours and the background is off: ${JSON.stringify(text.bubble)} ${JSON.stringify(text.background)}`);
  await tid("bubble-settings").waitFor();
  await shot("03-text-bubble");
  // Longer text: the bubble grows with it.
  await visible(page.getByTestId("text-inspector").getByRole("tab", { name: "Basic" })).click();
  await tid("text-content").fill("CURVED TEXT ON AN ARC THAT IS NOW A MUCH LONGER SENTENCE THAN BEFORE");
  await tid("text-content").blur();
  await settle(1500);
  const longer = await lit(600);
  expect(longer.count > bubbled.count * 1.3, `the bubble grows with the text (${bubbled.count} → ${longer.count} white pixels)`);
  await page.keyboard.press(`${mod}+z`);
  await visible(page.getByTestId("text-inspector").getByRole("tab", { name: "Bubble" })).click();
  await tid("bubble-none").click();
  await page.mouse.move(700, 300);
  await settle(1000);
  const cleared = await lit(600);
  expect(Math.abs(cleared.count - before.count) < before.count * 0.1, `None removes the bubble (${cleared.count} vs ${before.count})`);
});

await step("text: a keyframe toggle on Font size animates the size — Animate size", async () => {
  await visible(page.getByTestId("text-inspector").getByRole("tab", { name: "Basic" })).click();
  await tid("text-content").fill("GROW");
  await tid("text-content").blur();
  await seekTo(1);
  await typeInto(field("text-size"), 10);
  await tid("kf-fontSize").click();
  await seekTo(3);
  await typeInto(field("text-size"), 20);
  await saved();
  const text = elementsOf(await documentOf()).find((element) => element.type === "text");
  const keys = text.animations?.fontSize?.keys ?? [];
  expect(keys.length === 2 && keys[0].value === 10 && keys[1].value === 20, `two size keys, 10 and 20: ${JSON.stringify(keys)}`);
  const at = async (seconds) => { await seekTo(seconds); await settle(1100); return lit(); };
  const small = await at(1), mid = await at(2), large = await at(3);
  console.log(`     GROW heights at 0 / 1 / 2 s of the clip: ${small.bounds.height} / ${mid.bounds.height} / ${large.bounds.height}`);
  expect(Math.abs(large.bounds.height / small.bounds.height - 2) < 0.2, `size 20 is twice size 10 (${small.bounds.height} → ${large.bounds.height})`);
  expect(Math.abs(mid.bounds.height / small.bounds.height - 1.5) < 0.15, `half-way the size is 15 (${mid.bounds.height})`);
  expect((await field("text-size").inputValue()) === "20", "the field shows the value at the playhead");
  expect((await page.getByTestId("text-font-row").getByTestId(/^kf-/).count()) === 0, "the Font family field has no keyframe toggle");
});

await step("text: an emoji typed from the picker is drawn in colour", async () => {
  await seekTo(2);
  await tid("text-content").fill("OK ");
  await tid("text-content").press("End");
  await tid("text-emoji").click();
  await tid("emoji-popover").waitFor();
  await visible(page.getByRole("searchbox", { name: "Search emoji" })).fill("red heart");
  await tid("emoji-2764-fe0f").click();
  await settle(2500);
  expect((await tid("text-content").inputValue()) === "OK ❤️", `the emoji is in the content: ${await tid("text-content").inputValue()}`);
  await tid("text-content").blur();
  await settle(1500);
  const box = await tid("canvas").boundingBox();
  const png = await page.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
  const red = await page.evaluate(async (data) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context2d = canvas.getContext("2d");
    context2d.drawImage(bitmap, 0, 0);
    const pixels = context2d.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let count = 0;
    for (let index = 0; index < pixels.length; index += 4) if (pixels[index] > 180 && pixels[index + 1] < 90 && pixels[index + 2] < 90) count++;
    return count;
  }, png.toString("base64"));
  expect(red > 150, `the heart is drawn red by the colour font next to the white letters (${red} red pixels)`);
  await shot("04-text-emoji");
  await tid("panel-tab-text").click();
  await engineIdle();
  await compare("d-editor-text", "d-editor-text-content2-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await settle(800);
  await compare("d-editor-text", "d-editor-text-content2-dark", "dark");
  await page.emulateMedia({ colorScheme: "light" });
});

await step("text: a template adds all its members as one group, and its tile is the engine's picture — Add a template, Exactly 30 offline", async () => {
  await seekTo(5);
  await tid("panel-tab-text").click();
  await tid("text-templates").waitFor();
  expect((await page.locator('[data-testid^="text-template-"]:not([data-testid="text-template-image"])').count()) === 30, "30 templates");
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="text-template-image"]').length >= 6, null, { timeout: 60_000 });
  await engineIdle();
  const before = (await clipBoxes()).length;
  await tid("text-template-lower-third-bar").scrollIntoViewIfNeeded();
  await tid("text-template-lower-third-bar").click();
  await page.mouse.move(700, 300);
  await saved();
  const doc = await documentOf(), members = elementsOf(doc).filter((element) => element.startTime === 600_000 && element.groupId);
  console.log(`     lower-third-bar: ${members.map((member) => `${member.type}${member.definitionId ? `:${member.definitionId}` : ""} ${member.duration / 120_000}s`).join(", ")}`);
  expect(members.length === 3 && members.filter((member) => member.type === "text").length === 2 && members.filter((member) => member.type === "graphic" && member.definitionId === "rectangle").length === 1, "its two texts and one rectangle are inserted at 5 s");
  expect(new Set(members.map((member) => member.groupId)).size === 1 && Math.max(...members.map((member) => member.startTime + member.duration)) === 600_000 + 4 * 120_000, "as one group that lasts 4 s");
  expect((await clipBoxes()).length === before + 3, "three clips more on the timeline");
  await seekTo(7);
  await settle(1500);
  const drawn = await lit();
  expect(drawn.count > 150 && drawn.bounds.centreY > drawn.height * 0.6, `the lower third is drawn in the lower part of the frame (${drawn.count} lit pixels around y ${Math.round(drawn.bounds.centreY)} of ${drawn.height})`);
  // The name is white on the dark bar and the role yellow under it: the bar lies under both.
  const yellow = await canvasStats([255, 212, 0]);
  expect(yellow.close > 10, `the role is drawn in its yellow, above the bar (${yellow.close} yellow pixels)`);
  await shot("05-text-template");
  await page.keyboard.press(`${mod}+z`);
  await page.waitForTimeout(500);
  expect((await clipBoxes()).length === before, "one undo removes the whole group");
  await page.keyboard.press(`${mod}+Shift+z`);
  await page.waitForTimeout(500);
});

// ————————————————————————————————— Captions —————————————————————————————————
await step("captions: the import options offset the cues, and Start at playhead places the first one — Offset", async () => {
  await tid("panel-tab-captions").click();
  await tid("captions-tab").waitFor();
  expect(await tid("captions-generate").isDisabled(), "Generate is not offered as working while speech recognition is absent");
  expect((await tid("captions-empty").innerText()) === "No captions yet — generate them from speech or import a subtitle file.", "the empty state of the list");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), tid("captions-import").click()]);
  await chooser.setFiles(media("words.srt"));
  await tid("captions-import-dialog").waitFor();
  expect((await tid("captions-import-count").innerText()) === "2 captions in words.srt", `the dialog counts the cues: ${await tid("captions-import-count").innerText()}`);
  await tid("captions-import-language").fill("en");
  await tid("captions-import-offset").fill("00:00:00:15");
  await shot("06-captions-import-dialog");
  await tid("captions-import-confirm").click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="caption-row"]').length === 2, null, { timeout: 15_000 });
  await saved();
  const doc = await documentOf(), track = doc.scenes[0].tracks.overlay.find((entry) => entry.type === "caption");
  expect(track.caption.language === "en" && track.elements[0].startTime === 1.5 * 120_000 && track.elements[0].duration === 4 * 120_000, `every cue starts 15 frames later, in English: ${track.caption.language} ${track.elements[0].startTime / 120_000} s`);
  await page.keyboard.press(`${mod}+z`);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="caption-row"]').length === 0);
  // Without an offset: the cue is at 1–5 s, as in the file.
  const [again] = await Promise.all([page.waitForEvent("filechooser"), tid("captions-import").click()]);
  await again.setFiles(media("words.srt"));
  await tid("captions-import-confirm").click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="caption-row"]').length === 2, null, { timeout: 15_000 });
});

await step("captions: karaoke fills the words in step with their timing, colour marks the active word — Karaoke, Colour highlight", async () => {
  await visible(page.getByTestId("caption-seek").first()).click();
  await tid("caption-inspector").waitFor();
  expect((await page.locator('[data-testid^="caption-style-"]').count()) === 24, "the 24 bundled caption styles");
  await visible(page.getByTestId("caption-highlight-style").getByRole("combobox")).click().catch(async () => { await visible(page.getByTestId("caption-highlight-style").getByRole("button")).last().click(); });
  await visible(page.getByRole("option", { name: "Karaoke", exact: true })).click();
  await typeInto(visible(page.getByTestId("caption-highlight-colour").locator("input")), "#FF0000");
  await saved();
  const track = (await documentOf()).scenes[0].tracks.overlay.find((entry) => entry.type === "caption");
  expect(track.caption.highlight.style === "karaoke" && track.caption.highlight.color === "#ff0000", `the track's highlight: ${JSON.stringify(track.caption.highlight)}`);
  // "alpha beta gamma delta" over 4 s from 1 s, timed by character counts (5, 4, 5, 5 of 19): alpha 1.00–2.05 s, beta –2.89 s, gamma –3.95 s, delta –5.00 s.
  const RED = [255, 0, 0], WHITE = [255, 255, 255];
  const at = async (seconds) => { await seekTo(seconds); await settle(1200); const found = await colours(RED, WHITE, 0.78); const left = Math.min(found.first.count ? found.first.left : 1e9, found.second.count ? found.second.left : 1e9), right = Math.max(found.first.right, found.second.right); return { red: found.first.count, white: found.second.count, fill: found.first.count ? (found.first.right - left) / (right - left) : 0, redLeft: found.first.count ? (found.first.left - left) / (right - left) : null }; };
  const first = await at(1.5), third = await at(3.4), last = await at(4.9);
  console.log(`     karaoke: red reaches ${(first.fill * 100).toFixed(0)} % of the line half-way through "alpha", ${(third.fill * 100).toFixed(0)} % half-way through "gamma", ${(last.fill * 100).toFixed(0)} % at the end`);
  // The line is 22 characters: half of "alpha" is about 11 %, "alpha beta " plus half of "gamma" about 61 %.
  expect(first.red > 20 && first.fill > 0.03 && first.fill < 0.2, `half-way through the first word only its left half is filled (${(first.fill * 100).toFixed(0)} %)`);
  expect(third.fill > 0.5 && third.fill < 0.72 && third.white > 50, `half-way through the third word, words one and two are filled and the third over its left half (${(third.fill * 100).toFixed(0)} %)`);
  expect(last.fill > 0.93, `at the end every word is filled (${(last.fill * 100).toFixed(0)} %)`);
  expect(first.fill < third.fill && third.fill < last.fill, "the fill only grows with time");
  await shot("07-captions-karaoke");
  // Colour: only the word that is spoken takes the highlight colour.
  await visible(page.getByTestId("caption-highlight-style").getByRole("combobox")).click().catch(async () => { await visible(page.getByTestId("caption-highlight-style").getByRole("button")).last().click(); });
  await visible(page.getByRole("option", { name: "Colour", exact: true })).click();
  await settle(800);
  const second = await at(2.5), fourth = await at(4.5);
  if (process.env.JC_DEBUG) await shot("debug-colour-highlight");
  console.log(`     colour: during "beta" red spans ${(second.redLeft * 100).toFixed(0)}–${(second.fill * 100).toFixed(0)} % of the line, during "delta" ${(fourth.redLeft * 100).toFixed(0)}–${(fourth.fill * 100).toFixed(0)} %`);
  expect(second.redLeft > 0.2 && second.fill < 0.55, `during the second word only it is red (${(second.redLeft * 100).toFixed(0)}–${(second.fill * 100).toFixed(0)} %)`);
  expect(fourth.redLeft > 0.65 && fourth.fill > 0.95, `during the fourth word only it is red (${(fourth.redLeft * 100).toFixed(0)}–${(fourth.fill * 100).toFixed(0)} %)`);
  // Scale: the active word is drawn larger.
  await visible(page.getByTestId("caption-highlight-style").getByRole("combobox")).click().catch(async () => { await visible(page.getByTestId("caption-highlight-style").getByRole("button")).last().click(); });
  await visible(page.getByRole("option", { name: "None", exact: true })).click();
  await seekTo(2.5); await settle(1200);
  const whites = async () => (await colours([255, 255, 255], [255, 0, 0], 0.7)).first.count;
  const plain = await whites();
  await visible(page.getByTestId("caption-highlight-style").getByRole("combobox")).click().catch(async () => { await visible(page.getByTestId("caption-highlight-style").getByRole("button")).last().click(); });
  await visible(page.getByRole("option", { name: "Scale", exact: true })).click();
  await tid("caption-highlight-scale").waitFor();
  await typeInto(field("caption-highlight-scale"), 200);
  await settle(1300);
  const scaled = await whites();
  expect(scaled > plain * 1.25, `with Scale the spoken word is drawn larger (${plain} → ${scaled} white pixels)`);
});

await step("captions: a style with an animation animates the captions, Apply to all off overrides one caption — Override one caption", async () => {
  // The Animation tab of a caption writes the track's animation: Fade in over 1 s makes the first frames of every caption transparent.
  await inspectorTab("Animation").click();
  await tid("animation-tab").waitFor();
  await tid("text-animation-in-in-fade").click();
  await page.mouse.move(700, 300);
  await typeInto(field("text-animation-time"), 1);
  await saved();
  const track = (await documentOf()).scenes[0].tracks.overlay.find((entry) => entry.type === "caption");
  expect(track.caption.style.textAnimation?.in?.id === "in-fade" && track.caption.style.textAnimation.in.duration === 120_000, `the track style holds the animation: ${JSON.stringify(track.caption.style.textAnimation)}`);
  const at = async (seconds) => { await seekTo(seconds); await settle(1200); return (await colours([255, 255, 255], [255, 0, 0], 0.78)).first.count; };
  const early = await at(1.1), late = await at(3);
  expect(early < late * 0.3, `0.1 s into a 1 s fade the caption is nearly transparent (${early} of ${late} light pixels)`);
  await tid("text-animation-in-none").click();
  await page.mouse.move(700, 300);
  // Apply to all off: a colour typed in the caption's Text tab is this caption's own.
  await inspectorTab("Captions").click();
  await visible(page.getByTestId("caption-apply-all").getByRole("switch")).click();
  await tid("caption-track-only").waitFor();
  await inspectorTab("Text").click();
  await tid("caption-text-tab").waitFor();
  await typeInto(visible(page.getByTestId("caption-text-fill").locator("input")), "#00FF00");
  await saved();
  const after = (await documentOf()).scenes[0].tracks.overlay.find((entry) => entry.type === "caption");
  const overridden = after.elements.filter((element) => element.style !== undefined);
  console.log(`     overrides: ${JSON.stringify(overridden.map((element) => element.style))}`);
  expect(overridden.length === 1 && after.elements.length === 2, "only the selected caption carries an override");
  expect((await page.getByTestId("caption-override").count()) === 1, "the list marks the overridden caption");
  await inspectorTab("Captions").click();
  await tid("caption-reset-style").click();
  await saved();
  expect((await documentOf()).scenes[0].tracks.overlay.find((entry) => entry.type === "caption").elements.every((element) => element.style === undefined), "Reset to track style removes the override");
  await visible(page.getByTestId("caption-apply-all").getByRole("switch")).click();
  await shot("08-captions-inspector");
  await compare("d-editor-captions", "d-editor-captions-content2-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await settle(800);
  await compare("d-editor-captions", "d-editor-captions-content2-dark", "dark");
  await page.emulateMedia({ colorScheme: "light" });
});

await step("captions: the Transcript tab says what a track without word timings needs — Track without word timings", async () => {
  await tid("panel-tab-transcript").click();
  await tid("transcript-tab").waitFor();
  expect((await tid("transcript-needs-words").innerText()) === "Transcript needs word timings — generate captions to use it", "an SRT track has no word timings");
  await tid("panel-tab-captions").click();
  // The caption track is removed for the steps that follow.
  await page.keyboard.press(`${mod}+z`).catch(() => undefined);
});

// ————————————————————————————————— Stickers, shapes and drawing —————————————————————————————————
await step("stickers: Line and Arrow are drawn from their parameters — Shape items", async () => {
  await seekTo(0.4);
  await tid("panel-tab-stickers").click();
  await tid("stickers-tab").waitFor();
  expect((await page.locator('[data-testid="stickers-tab"] [data-testid^="shape-"]').count()) === 6, "six shape items");
  const empty = await lit(600);
  await tid("shape-arrow").click();
  await tid("shape-inspector").waitFor();
  await settle(1500);
  const arrow = await lit(600);
  expect(arrow.count > empty.count + 2000, `a white arrow is drawn (${empty.count} → ${arrow.count} white pixels)`);
  // An arrow points right: its right-most column is the tip (a few pixels high), its left-most the full height of the shaft.
  const tall = (stats, x) => (stats.top[x] < 0 ? 0 : stats.bottom[x] - stats.top[x] + 1);
  const tip = tall(arrow, arrow.bounds.right - 2), tail = tall(arrow, arrow.bounds.x + 3), head = Math.max(...arrow.top.map((_, x) => tall(arrow, x)));
  console.log(`     arrow ${arrow.bounds.width}×${arrow.bounds.height}: shaft ${tail} px high at the tail, head ${head} px, ${tip} px at the tip`);
  expect(tip < head * 0.25 && tail > head * 0.15 && tail < head * 0.6, "the tail is the shaft (30 % of the height) and the right end narrows to the tip");
  await visible(page.getByTestId("shape-doubleHeaded").getByRole("switch")).click();
  await settle(1200);
  const both = await lit(600);
  expect(tall(both, both.bounds.x + 2) < head * 0.25, `with two heads the left end is a tip too (${tall(both, both.bounds.x + 2)} px)`);
  await page.keyboard.press("Delete");
  await settle(500);
  await tid("shape-line").click();
  await tid("shape-inspector").waitFor();
  await settle(1500);
  const line = await lit(600);
  expect(line.count > 200 && line.bounds.height < line.bounds.width * 0.2, `a line is a thin stroke (${line.bounds.width}×${line.bounds.height})`);
  await typeInto(field("shape-strokeWidth"), 40);
  await settle(1200);
  const thick = await lit(600);
  expect(thick.bounds.height > line.bounds.height * 2.5, `its stroke width makes it thicker (${line.bounds.height} → ${thick.bounds.height} px)`);
  await shot("09-shape-line");
  await page.keyboard.press("Delete");
  await settle(500);
});

await step("stickers: an emoji sticker is drawn from the colour font — Add an emoji", async () => {
  await visible(page.getByTestId("stickers-tab").getByRole("tab", { name: "Emoji", exact: true })).click();
  await tid("stickers-emoji").waitFor();
  await tid("emoji-1f600").click();
  await settle(2500);
  await saved();
  const sticker = elementsOf(await documentOf()).find((element) => element.type === "sticker");
  expect(sticker?.stickerId === "emoji:1f600" && sticker.intrinsicWidth === 512 && sticker.intrinsicHeight === 512, `the sticker element: ${JSON.stringify(sticker && { id: sticker.stickerId, w: sticker.intrinsicWidth })}`);
  const face = await colours([255, 204, 50], [255, 255, 255], 0);
  expect(face.first.count > 1500, `the grinning face is drawn in its yellow (${face.first.count} pixels)`);
  await shot("10-sticker-emoji");
  await page.keyboard.press("Delete");
  await visible(page.getByTestId("stickers-tab").getByRole("tab", { name: "All", exact: true })).click();
  expect((await page.locator('[data-testid="stickers-tab"] [data-testid="sticker-emoji-1f600"]').count()) >= 1, "the emoji is under Recently used");
});

await step("stickers: a drawn stroke appears where it was drawn and is there after a reload — Draw and commit, Erase", async () => {
  await seekTo(0.4);
  await tid("stickers-draw").click();
  await tid("draw-panel").waitFor();
  await typeInto(visible(page.getByTestId("draw-colour").locator("input")), "#FF0000");
  const box = await tid("canvas").boundingBox();
  const drag = async (from, to) => { await page.mouse.move(box.x + from[0] * box.width, box.y + from[1] * box.height); await page.mouse.down(); await page.mouse.move(box.x + to[0] * box.width, box.y + to[1] * box.height, { steps: 24 }); await page.mouse.up(); await page.waitForTimeout(250); };
  await drag([0.2, 0.3], [0.7, 0.3]);
  await drag([0.2, 0.6], [0.7, 0.6]);
  expect((await tid("draw-count").innerText()) === "2 strokes", `two strokes: ${await tid("draw-count").innerText()}`);
  await tid("draw-undo").click();
  expect((await tid("draw-count").innerText()) === "1 stroke", "undo takes the last stroke back");
  await tid("draw-redo").click();
  expect((await tid("draw-count").innerText()) === "2 strokes", "redo brings it back");
  // The eraser removes the whole stroke it touches.
  await visible(page.getByTestId("draw-tool").getByText("Eraser", { exact: true })).click();
  await page.mouse.click(box.x + 0.45 * box.width, box.y + 0.6 * box.height);
  await page.waitForTimeout(250);
  expect((await tid("draw-count").innerText()) === "1 stroke", "the eraser removed the second stroke");
  await tid("draw-done").click();
  await tid("drawing-inspector").waitFor();
  await page.mouse.move(box.x + 0.9 * box.width, box.y + 0.9 * box.height);
  await settle(1500);
  const isRed = (rgb) => rgb[0] > 180 && rgb[1] < 90 && rgb[2] < 90;
  const sample = async () => ({ on: [await pixelAt(0.25, 0.3), await pixelAt(0.45, 0.3), await pixelAt(0.65, 0.3)], above: await pixelAt(0.45, 0.22), erased: await pixelAt(0.45, 0.6), beyond: await pixelAt(0.8, 0.3) });
  const drawn = await sample();
  console.log(`     pixels on the stroke ${JSON.stringify(drawn.on)}, above it ${JSON.stringify(drawn.above)}, on the erased stroke ${JSON.stringify(drawn.erased)}`);
  expect(drawn.on.every(isRed), "the engine draws the stroke red along the path that was drawn");
  expect(!isRed(drawn.above) && !isRed(drawn.erased) && !isRed(drawn.beyond), "and nowhere else: not above it, not past its end, not where the erased stroke was");
  await saved();
  const stored = elementsOf(await documentOf()).find((element) => element.type === "graphic" && element.definitionId === "drawing");
  const canvasWidth = 1920, expectedWidth = 0.5 * canvasWidth + 12;
  console.log(`     stored: ${stored.strokes.length} stroke of ${stored.strokes[0].points.length} points, ${stored.intrinsicWidth}×${stored.intrinsicHeight} at ${JSON.stringify(stored.transform.position)}`);
  expect(stored.strokes.length === 1 && stored.strokes[0].points.length === 2 && stored.strokes[0].color === "#ff0000", "one stroke, simplified to its two ends (a straight line)");
  expect(Math.abs(stored.intrinsicWidth - expectedWidth) < 12 && Math.abs(stored.intrinsicHeight - 12) < 2, `its box is the stroke plus half its width on each side (${stored.intrinsicWidth}×${stored.intrinsicHeight})`);
  expect(Math.abs(stored.transform.position.x - (0.45 - 0.5) * canvasWidth) < 8 && Math.abs(stored.transform.position.y - (0.3 - 0.5) * 1080) < 8, `and it sits where it was drawn (${JSON.stringify(stored.transform.position)})`);
  await shot("11-drawing");
  // A reload opens the stored project: the stroke is drawn at the same pixels.
  await page.reload({ waitUntil: "networkidle" });
  for (const id of ["editor-bar", "player", "timeline"]) await tid(id).waitFor({ timeout: 60_000 });
  await settle(3000);
  await seekTo(0.4);
  await settle(2500);
  const reloaded = await sample();
  expect(reloaded.on.every(isRed) && !isRed(reloaded.above) && !isRed(reloaded.erased), `after the reload the stroke is where it was: ${JSON.stringify(reloaded.on)}`);
  await shot("12-drawing-reloaded");
});

await step("stickers: an imported GIF plays its frames at its own timing — Animated stickers", async () => {
  await tid("panel-tab-stickers").click();
  await tid("stickers-tab").waitFor();
  const clip = (await clipBoxes()).find((entry) => entry.label.includes("Drawing"));
  if (clip) { await clickClip(clip); await page.keyboard.press("Delete"); await settle(400); }
  await seekTo(5);
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), tid("stickers-import").first().click()]);
  await chooser.setFiles(media("blink2.gif"));
  await visible(page.locator('[data-testid^="sticker-user-"]')).first().waitFor({ timeout: 30_000 });
  await visible(page.locator('[data-testid^="sticker-user-"]')).first().click();
  await saved();
  const sticker = elementsOf(await documentOf()).find((element) => element.type === "sticker");
  expect(/^user:[0-9a-f]{64}$/.test(sticker?.stickerId ?? ""), `the sticker is identified by the hash of its file: ${sticker?.stickerId}`);
  // Two frames of half a second, red then blue, looping: 0.2 s and 1.2 s into the clip are red, 0.7 s is blue.
  const at = async (seconds) => { await seekTo(5 + seconds); await settle(1800); return pixelAt(0.5, 0.5); };
  const a = await at(0.2), b = await at(0.7), c = await at(1.2);
  console.log(`     centre pixel at 0.2 / 0.7 / 1.2 s of the clip: ${JSON.stringify(a)} / ${JSON.stringify(b)} / ${JSON.stringify(c)}`);
  expect(a[0] > 180 && a[2] < 90 && b[2] > 180 && b[0] < 90 && c[0] > 180 && c[2] < 90, "red, blue, then red again on the next pass");
  await tid("sticker-inspector").waitFor();
  await visible(page.getByTestId("sticker-loop").getByRole("switch")).click();
  const held = await at(1.2);
  expect(held[2] > 180 && held[0] < 90, `with Loop off the last frame (blue) holds after one pass: ${JSON.stringify(held)}`);
  await shot("13-sticker-animated");
  await page.keyboard.press("Delete");
});

// ————————————————————————————————— Audio —————————————————————————————————
await step("audio: sounds on the timeline, an equaliser on one clip, normalisation on another, ducking on the music track", async () => {
  await tid("panel-tab-audio").click();
  await tid("audio-tab").waitFor();
  // 0–3 s tones, 3–6 s tones with the equaliser, 6–10 s the quiet tone normalised, 10–18 s music with a voice over 13–15 s.
  await addSound("tones.wav", 0); await addSound("tones.wav", 3); await addSound("quiet.wav", 6); await addSound("music.wav", 10); await addSound("voice.wav", 13);
  // 18–21 s the tones an octave up, 21–24 s the tones through the Telephone voice effect.
  await addSound("tones.wav", 18); await addSound("tones.wav", 21);
  await saved();
  const tracks = (await documentOf()).scenes[0].tracks.audio;
  console.log(`     audio tracks: ${tracks.map((track) => track.elements.map((element) => `${element.name}@${element.startTime / 120_000}`).join(", ")).join(" | ")}`);
  // The voice overlaps the music, so it opened a second track; the two later clips took the first free track, which is that one.
  expect(tracks.length === 2 && tracks.some((track) => track.elements.length === 4 && track.elements.some((element) => element.name === "music.wav")) && tracks.some((track) => track.elements.length === 3 && track.elements.some((element) => element.name === "voice.wav")), "the music shares its track with the first three clips, the voice is on another track");
  await clickClip(await audioClip("tones.wav", 2));
  await tid("audio-inspector").waitFor();
  await sectionSwitch("audio-pitch").click();
  await typeInto(field("pitch-semitones"), 12);
  await clickClip(await audioClip("tones.wav", 3));
  await tid("voice-effect-telephone").scrollIntoViewIfNeeded().catch(() => undefined);
  await sectionSwitch("audio-voice-effects").click();
  await tid("voice-effect-telephone").click();
  expect((await page.locator('[data-testid^="voice-effect-"]').count()) === 15, "None and the 14 voice effects");
  // Equaliser on the second tones clip: the low shelf (100 Hz) all the way down.
  await clickClip(await audioClip("tones.wav", 1));
  await tid("audio-inspector").waitFor();
  await sectionSwitch("audio-eq").click();
  await typeInto(field("eq-low"), -12);
  await visible(page.getByTestId("eq-preset").getByText("Custom")).waitFor({ timeout: 5000 });
  // Normalise the quiet clip to −14 LUFS.
  await clickClip(await audioClip("quiet.wav"));
  await sectionSwitch("audio-normalize").click();
  await page.waitForFunction(() => /Measured/.test(document.querySelector('[data-testid="normalize-measured"]')?.textContent ?? ""), null, { timeout: 30_000 });
  const measured = await tid("normalize-measured").innerText();
  console.log(`     ${measured}`);
  await saved();
  const quiet = elementsOf(await documentOf()).find((element) => element.name === "quiet.wav" || element.normalize?.enabled);
  expect(quiet.normalize.enabled && (quiet.normalize.target ?? -14) === -14 && Math.abs(quiet.normalize.gainDb - (-14 - quiet.normalize.measuredLufs)) < 0.15, `the stored gain is target − measured: ${JSON.stringify(quiet.normalize)}`);
  // ffmpeg's sine is 1/8 of full scale (−18 dBFS peak); 12 dB lower, in both channels, a 1 kHz tone measures about −33 LUFS: the gain to −14 is about +19 dB.
  expect(quiet.normalize.measuredLufs < -31 && quiet.normalize.measuredLufs > -35, `the tone measures about −33 LUFS (${quiet.normalize.measuredLufs})`);
  // Ducking on the music's track, and the voice clip flagged Voice.
  await clickClip(await audioClip("music.wav"));
  await sectionSwitch("audio-ducking").click();
  await tid("ducking-no-voice").waitFor();
  await clickClip(await audioClip("voice.wav"));
  await visible(page.getByTestId("audio-voice").getByRole("switch")).click();
  await clickClip(await audioClip("music.wav"));
  expect((await page.getByTestId("ducking-no-voice").count()) === 0, "with a Voice clip on another track the hint is gone");
  expect((await page.getByTestId("ducked-zone").count()) === 1, "the music clip shows where it is lowered");
  await saved();
  await shot("14-audio-inspector");
});

await step("audio: beat markers are dots on the clip, the volume line drags and resets — Add at the playhead, Drag the line, Double-click resets", async () => {
  await clickClip(await audioClip("music.wav"));
  await seekTo(11);
  await tid("beat-add").scrollIntoViewIfNeeded();
  await tid("beat-add").click();
  await seekTo(12);
  await tid("beat-add").click();
  const dots = await page.getByTestId("beat-dot").evaluateAll((nodes) => nodes.map((node) => { const rect = node.getBoundingClientRect(); return rect.left + rect.width / 2; }));
  const ruler = await rulerBox();
  expect(dots.length === 2 && Math.abs(dots[0] - (ruler.x + 550)) <= 2 && Math.abs(dots[1] - (ruler.x + 600)) <= 2, `two dots under 11 s and 12 s: ${dots.map((x) => Math.round(x - ruler.x))}`);
  await saved();
  const music = elementsOf(await documentOf()).find((element) => element.beats?.length);
  expect(JSON.stringify(music.beats) === JSON.stringify([120_000, 240_000]), `the markers are stored in source time, 1 s and 2 s into the file: ${JSON.stringify(music.beats)}`);
  await tid("beat-delete").click();
  expect((await page.getByTestId("beat-dot").count()) === 1, "Delete beat removes the marker under the playhead");
  // The volume line: 0 dB is 68.4 % down the clip body; dragged down it lowers the volume, a double-click resets it.
  const clip = await audioClip("music.wav");
  const lineOf = (target) => page.evaluate((box) => { const node = [...document.querySelectorAll('[data-testid="volume-line"]')].find((entry) => { const rect = entry.getBoundingClientRect(); return rect.left >= box.x - 1 && rect.right <= box.x + box.width + 1 && rect.top >= box.y && rect.bottom <= box.y + box.height + 8; }); const rect = node?.getBoundingClientRect(); return rect ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height } : null; }, target);
  const line = await lineOf(clip);
  const body = { top: clip.y + 16, height: clip.height - 16 };
  expect(Math.abs(line.y + line.height / 2 - (body.top + 0.684 * body.height)) <= 1.5, `at 0 dB the line is 68.4 % down the body (${(line.y + line.height / 2 - body.top).toFixed(1)} of ${body.height} px)`);
  await page.mouse.move(line.x + 200, line.y + line.height / 2);
  await page.mouse.down();
  await page.mouse.move(line.x + 200, line.y + line.height / 2 + 5, { steps: 5 });
  await page.waitForTimeout(300);
  const tooltip = await tid("volume-tooltip").innerText();
  await page.mouse.up();
  await page.waitForTimeout(300);
  const volume = await visible(page.getByTestId("audio-volume").locator("input")).inputValue();
  console.log(`     dragged 5 px down: tooltip "${tooltip}", the Volume field reads ${volume}`);
  const db = (text) => Number(text.replace("−", "-").replace(" dB", ""));
  expect(db(volume) < -3 && /dB$/.test(tooltip) && Math.abs(db(tooltip) - db(volume)) < 0.11, "the tooltip and the field agree on the new volume");
  await page.keyboard.press(`${mod}+z`);
  await page.waitForTimeout(300);
  expect((await visible(page.getByTestId("audio-volume").locator("input")).inputValue()) === "0", "one undo returns the volume to its previous value");
  await page.keyboard.press(`${mod}+Shift+z`);
  await page.waitForTimeout(300);
  const moved = await lineOf(clip);
  await page.mouse.dblclick(moved.x + 200, moved.y + moved.height / 2);
  await page.waitForTimeout(300);
  expect((await visible(page.getByTestId("audio-volume").locator("input")).inputValue()) === "0", "a double-click puts the volume back to 0 dB");
  await compare("d-editor-audio", "d-editor-audio-content2-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await settle(800);
  await compare("d-editor-audio", "d-editor-audio-content2-dark", "dark");
  await page.emulateMedia({ colorScheme: "light" });
});

await step("audio: the export carries the equaliser, the normalisation and the ducking — EQ band, Quiet clip raised, Music ducks under voice", async () => {
  await saved();
  await tid("open-export").click();
  await tid("export-dialog").waitFor();
  const download = page.waitForEvent("download", { timeout: 600_000 }).catch(() => null);
  await tid("export-start").click();
  const file = await Promise.race([download, tid("export-error").waitFor({ timeout: 600_000 }).then(() => null, () => null)]);
  expect(file !== null, `the export finished with a file; the dialog reads: ${(await tid("export-dialog").innerText()).replace(/\s+/g, " ").slice(-200)}`);
  const exported = join(dir, "content2.mp4");
  await file.saveAs(exported);
  await button("Close").click().catch(() => undefined);
  // Two band-pass sections in a row: the other tones of the mix are far below what is measured.
  const band = (hz) => { const one = `bandpass=f=${hz}:width_type=h:w=${Math.max(20, hz / 10)}`; return `${one},${one}`; };
  // Equaliser: the same file plays twice, the second time with the 100 Hz shelf at −12 dB.
  const low = [rms(exported, 0.6, 2.6, band(60)), rms(exported, 3.6, 5.6, band(60))], mid = [rms(exported, 0.6, 2.6, band(1000)), rms(exported, 3.6, 5.6, band(1000))];
  console.log(`     60 Hz: ${low[0].toFixed(1)} dB → ${low[1].toFixed(1)} dB with the low shelf at −12 dB; 1 kHz: ${mid[0].toFixed(1)} dB → ${mid[1].toFixed(1)} dB`);
  expect(low[0] - low[1] > 9 && low[0] - low[1] < 13.5, `the 60 Hz tone is ${(low[0] - low[1]).toFixed(1)} dB lower (a 12 dB shelf at 100 Hz)`);
  expect(Math.abs(mid[0] - mid[1]) < 1, `the 1 kHz tone is unchanged (${(mid[0] - mid[1]).toFixed(2)} dB)`);
  // Pitch +12: the 1 kHz tone is at 2 kHz. Telephone (300 Hz–3.4 kHz): the 60 Hz tone is gone, the 1 kHz tone stays.
  const up = [rms(exported, 18.6, 20.6, band(1000)), rms(exported, 18.6, 20.6, band(2000))], phone = [rms(exported, 21.6, 23.6, band(60)), rms(exported, 21.6, 23.6, band(1000))];
  console.log(`     pitch +12: ${up[0].toFixed(1)} dB at 1 kHz, ${up[1].toFixed(1)} dB at 2 kHz; telephone: ${phone[0].toFixed(1)} dB at 60 Hz, ${phone[1].toFixed(1)} dB at 1 kHz`);
  expect(up[1] > up[0] + 20 && Math.abs(up[1] - mid[0]) < 3, `an octave up, the 1 kHz tone sounds at 2 kHz (${up[1].toFixed(1)} dB there, ${up[0].toFixed(1)} dB at 1 kHz)`);
  expect(low[0] - phone[0] > 24 && phone[1] > mid[0] - 6, `Telephone removes the 60 Hz tone (${(low[0] - phone[0]).toFixed(1)} dB lower) and keeps 1 kHz`);
  // Normalisation: the quiet tone leaves at the target.
  const loud = lufs(exported, 6.2, 9.8);
  console.log(`     the normalised clip measures ${loud} LUFS in the export (target −14)`);
  expect(Math.abs(loud - -14) <= 1, `within 1 LU of −14 LUFS (${loud})`);
  // Ducking: the music (330 Hz) is 12 dB lower while the voice sounds (13–15 s), after its 200 ms attack, and back after the 500 ms release.
  const before = rms(exported, 10.5, 12.5, band(330)), under = rms(exported, 13.6, 14.9, band(330)), after = rms(exported, 16.2, 17.8, band(330));
  console.log(`     music at 330 Hz: ${before.toFixed(1)} dB before the voice, ${under.toFixed(1)} dB under it, ${after.toFixed(1)} dB after`);
  expect(Math.abs(before - under - 12) < 1.5, `the music is ${(before - under).toFixed(1)} dB lower under the voice (12 dB configured)`);
  expect(Math.abs(before - after) < 1, `and back at its level afterwards (${(before - after).toFixed(2)} dB)`);
});

for (const [name, size, scheme] of [["20-content2-1440-dark", { width: 1440, height: 900 }, "dark"], ["21-content2-390-light", { width: 390, height: 844 }, "light"], ["22-content2-390-dark", { width: 390, height: 844 }, "dark"]]) {
  await step(`screenshot ${name}`, async () => {
    await page.setViewportSize(size);
    await page.emulateMedia({ colorScheme: scheme });
    await settle(1200);
    await shot(name);
  });
}

console.log(errors.length ? `\n${errors.length} problem(s):\n${errors.join("\n")}` : "\nno problems");
await browser.close();
process.exit(errors.length ? 1 : 0);
