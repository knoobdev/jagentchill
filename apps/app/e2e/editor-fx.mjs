// End-to-end in a real browser against the Expo web dev server, with no host: transitions, effects and filters in the editor —
// the three library tabs, the transition handle and inspector, the Effects tab of a clip, standalone layers, and an MP4 export.
// Real storage (IndexedDB and OPFS of a fresh browser profile) and real media files made with ffmpeg; nothing is seeded or mocked.
// Every picture check reads the pixels the preview canvas (or the exported file) really shows.
// Usage: node apps/app/e2e/editor-fx.mjs [screenshot-dir] [base-url]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const shots = process.argv[2] ?? ".dev/shots/editor-fx";
const base = process.argv[3] ?? "http://localhost:8081";
mkdirSync(shots, { recursive: true });

// — Media: two H.264/AAC clips of different colours and tones, and a PNG —
const dir = join(tmpdir(), "jagentchill-editor-fx-e2e");
mkdirSync(dir, { recursive: true });
const ffmpeg = (...args) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args]);
const media = (name) => join(dir, name);
if (!existsSync(media("red.mp4"))) ffmpeg("-f", "lavfi", "-i", "color=c=red:s=640x360:r=30:d=4", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", media("red.mp4"));
if (!existsSync(media("blue.mp4"))) ffmpeg("-f", "lavfi", "-i", "color=c=blue:s=640x360:r=30:d=4", "-f", "lavfi", "-i", "sine=frequency=880:duration=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", media("blue.mp4"));
if (!existsSync(media("green.png"))) ffmpeg("-f", "lavfi", "-i", "color=c=0x00c000:s=640x360:d=1", "-frames:v", "1", media("green.png"));

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light", acceptDownloads: true });
// A headless browser has no save dialog to answer: without the picker an export is offered as a download, the path this script reads.
await context.addInitScript(() => { delete window.showSaveFilePicker; delete window.showDirectoryPicker; });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text().slice(0, 400)); });
const visible = (locator) => locator.filter({ visible: true }).first();
const tid = (id) => visible(page.getByTestId(id));
const button = (name, exact = true) => visible(page.getByRole("button", { name, exact }));
const menuItem = (name) => visible(page.locator('[role^="menuitem"]').filter({ has: page.getByText(name, { exact: true }) }));
/** Chooses an item of the open menu and waits for the menu to be gone, so the next press lands on the screen under it. */
const choose = async (name) => { await menuItem(name).click(); await page.waitForFunction(() => document.querySelector('[role="menu"]') === null, null, { timeout: 5000 }); await page.waitForTimeout(150); };
const option = (name) => visible(page.getByRole("option", { name, exact: true }));
const shot = (name) => page.screenshot({ path: `${shots}/${name}.png` });
const expect = (condition, message) => { if (!condition) throw new Error(message); };
const step = async (name, run) => {
  try { await run(); console.log("ok  ", name); }
  catch (err) { console.log("FAIL", name, "—", String(err).split("\n")[0]); errors.push(`step failed: ${name}`); await shot(`failure-${name.replace(/[^a-z0-9]+/gi, "-").slice(0, 48)}`).catch(() => undefined); }
};
const mod = process.platform === "darwin" ? "Meta" : "Control";
const PX = 50; // px per second at the zoom a new project opens with

const saved = () => visible(page.getByTestId("save-state").getByText("Saved", { exact: true })).waitFor({ timeout: 20_000 });
const importFiles = async (paths) => { const [chooser] = await Promise.all([page.waitForEvent("filechooser"), tid("media-dropzone").click()]); await chooser.setFiles(paths); };
const showTab = async (tab) => { await tid(`panel-tab-${tab}`).click(); await tid(tab === "media" ? "label-red.mp4" : `fx-library-${tab === "effects" ? "effect" : tab === "filters" ? "filter" : "transition"}`).waitFor(); };
const category = async (name) => { await tid(`fx-category-${name}`).click(); await page.waitForTimeout(120); };
const tileNames = () => page.evaluate(() => [...document.querySelectorAll('[data-testid="fx-grid"] [data-testid="fx-tile-name"]')].map((node) => node.textContent));
/** The preview shows its own frame again: no tile is being rendered and the frame of the playhead is drawn. */
const settled = async () => { await page.waitForFunction(() => document.querySelector("[data-fx-cover]") === null, null, { timeout: 30_000 }); await page.waitForTimeout(350); };
const seek = async (text) => { await tid("timecode").fill(text); await page.keyboard.press("Enter"); await page.waitForTimeout(250); await settled(); };
/** The colour of the preview at a point of the canvas (fractions of its width and height), read from a screenshot. */
const pixel = async (fx = 0.5, fy = 0.5) => {
  const box = await tid("canvas").boundingBox();
  const png = await page.screenshot({ clip: { x: Math.round(box.x + box.width * fx) - 3, y: Math.round(box.y + box.height * fy) - 3, width: 6, height: 6 } });
  return page.evaluate(async (data) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context2d = canvas.getContext("2d");
    context2d.drawImage(bitmap, 0, 0);
    const [r, g, b] = context2d.getImageData(3, 3, 1, 1).data;
    return { r, g, b };
  }, png.toString("base64"));
};
const isRed = (c) => c.r > 180 && c.g < 70 && c.b < 70, isBlue = (c) => c.b > 180 && c.r < 70 && c.g < 70, isGreen = (c) => c.g > 130 && c.r < 70 && c.b < 70;
const show = (c) => `rgb(${c.r}, ${c.g}, ${c.b})`;
const close = (a, b, tolerance = 12) => Math.abs(a.r - b.r) <= tolerance && Math.abs(a.g - b.g) <= tolerance && Math.abs(a.b - b.b) <= tolerance;
/** The transition handles on the timeline, left to right. */
const handles = () => page.evaluate(() => [...document.querySelectorAll('[data-testid^="tl-ctl-transition-"]')].map((node) => { const rect = node.getBoundingClientRect(); return { id: node.getAttribute("data-testid").slice("tl-ctl-transition-".length), type: node.getAttribute("data-type"), duration: Number(node.getAttribute("data-duration")), selected: node.getAttribute("data-selected") === "true", x: rect.left, y: rect.top, width: rect.width, height: rect.height }; }).sort((a, b) => a.x - b.x));
const clips = () => page.evaluate(() => [...document.querySelectorAll('[data-testid^="clip-"]')].filter((node) => !["clip-selection", "clip-hover", "clip-hatch", "clip-mute", "clip-reverse"].includes(node.getAttribute("data-testid"))).map((node) => {
  const rect = node.getBoundingClientRect(), row = node.closest('[data-testid^="track-"]');
  return { id: node.getAttribute("data-testid").slice(5), track: row?.getAttribute("data-testid") ?? "", x: rect.left, y: rect.top, width: rect.width, height: rect.height, label: node.getAttribute("aria-label") ?? "" };
}).sort((a, b) => a.y - b.y || a.x - b.x));
const mainClips = async () => (await clips()).filter((clip) => clip.track === "track-main-video");
const clickClip = async (clip) => { await page.mouse.click(clip.x + clip.width / 2, clip.y + 8); await page.waitForTimeout(150); };
/** Deselects everything by the Deselect all shortcut (a press on empty track space would also move the playhead). */
const deselect = async () => { await page.evaluate(() => document.activeElement?.blur?.()); await page.keyboard.press(`${mod}+Shift+KeyA`); await page.waitForTimeout(150); };
const undo = async () => { await tid("bar-undo").click(); await page.waitForTimeout(200); };
const redo = async () => { await tid("bar-redo").click(); await page.waitForTimeout(200); };
const toast = (text) => visible(page.getByText(text, { exact: false })).waitFor({ timeout: 5000 });
/** Types a value into the number field of an inspector row and commits it. */
const setField = async (rowId, value) => { const input = visible(tid(rowId).locator("input")); await input.fill(String(value)); await input.press("Enter"); await page.waitForTimeout(200); };
const fieldValue = (rowId) => visible(tid(rowId).locator("input")).inputValue();
/** The loop a transition edit starts has ended: the transport is paused on the playhead again. */
const loopEnded = async () => { await button("Play").waitFor({ timeout: 8000 }); await settled(); };
/** Applies a transition tile by its "+" (shown while the pointer is over the tile). */
const addTransition = async (type) => { const tile = tid(`fx-tile-transition-${type}`); await tile.scrollIntoViewIfNeeded(); await tile.hover(); await tid(`fx-add-${type}`).click(); await page.waitForTimeout(250); };

let A, B; // the colour tests of the first and the second clip on the main track

await step("a new project with one clip: “+” on a transition tile has no cut to go on — No eligible cut", async () => {
  await page.goto(`${base}/projects`, { waitUntil: "networkidle", timeout: 180_000 });
  await button("Create your first project").click({ timeout: 90_000 });
  await page.waitForURL(/\/editor\/[0-9a-f-]{36}$/);
  for (const id of ["editor-bar", "asset-panel", "player", "inspector", "timeline"]) await tid(id).waitFor({ timeout: 60_000 });
  await importFiles([media("red.mp4"), media("blue.mp4"), media("green.png")]);
  for (const name of ["red.mp4", "blue.mp4", "green.png"]) await tid(`label-${name}`).waitFor({ timeout: 60_000 });
  await saved();
  await tid("thumb-red.mp4").dblclick();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="track-main-video"] [data-testid^="clip-"]').length >= 1);
  await showTab("transitions");
  await category("Basic");
  await addTransition("cross-dissolve");
  await toast("Place two clips next to each other to add a transition");
  expect((await handles()).length === 0, "nothing is added");
});

await step("the Transitions tab lists the library with rendered tiles — Library is complete offline; Tab is functional", async () => {
  await showTab("media");
  await tid("thumb-blue.mp4").dblclick();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="track-main-video"] [data-testid^="clip-"]').length >= 2);
  const main = await mainClips();
  expect(main.length === 2 && Math.abs(main[0].x + main[0].width - main[1].x) < 1.5, `two clips sit edge to edge on the main track: ${JSON.stringify(main.map((clip) => [Math.round(clip.x), Math.round(clip.width)]))}`);
  await seek("00:00:01:00"); const first = await pixel();
  await seek("00:00:06:00"); const second = await pixel();
  expect((isRed(first) && isBlue(second)) || (isBlue(first) && isRed(second)), `the two clips show red and blue: ${show(first)} then ${show(second)}`);
  A = isRed(first) ? isRed : isBlue; B = isRed(first) ? isBlue : isRed;
  await showTab("transitions");
  const strip = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="fx-category-"]')].map((node) => node.textContent));
  expect(JSON.stringify(strip) === JSON.stringify(["Featured", "Favourites", "Recent", "My presets", "Basic", "Camera", "Overlay", "Light Effect", "Split", "Distortion", "Glitch", "Blur", "Social Media", "Slide", "MG", "Mask"]), `the category strip: ${strip.join(", ")}`);
  await category("Featured");
  expect(JSON.stringify(await tileNames()) === JSON.stringify(["Cross Dissolve", "Dip to Black", "Slide", "Push", "Zoom In", "Whip Pan", "Blur Dissolve", "Glitch Cut", "Flash", "Luma Fade"]), `Featured is the curated ten: ${(await tileNames()).join(", ")}`);
  const all = new Set();
  for (const [name, count] of [["Basic", 8], ["Camera", 7], ["Overlay", 2], ["Light Effect", 4], ["Split", 4], ["Distortion", 4], ["Glitch", 4], ["Blur", 3], ["Social Media", 4], ["Slide", 5], ["MG", 2], ["Mask", 5]]) {
    await category(name);
    const names = await tileNames();
    expect(names.length === count, `${name} has ${count} tiles, got ${names.length}`);
    names.forEach((entry) => all.add(entry));
  }
  expect(all.size === 52, `the 12 library categories hold 52 distinct tiles, got ${all.size}`);
  // No "coming soon" notice: a grid of tiles whose pictures the engine rendered from the samples A and B.
  await category("Basic");
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="fx-grid"] [data-testid="fx-tile-picture"]').length >= 6, null, { timeout: 60_000 });
  const tile = tid("fx-tile-transition-linear-wipe");
  const size = await tile.locator('[role="button"]').first().boundingBox();
  expect(Math.round(size.width) === 96 && Math.round(size.height) === 64, `a transition tile is 96 × 64, got ${size.width} × ${size.height}`);
  // Hovering a tile animates A to B: the picture of the tile changes over time.
  const picture = () => tile.locator('[data-testid="fx-tile-picture"]').evaluate((node) => getComputedStyle(node).backgroundImage);
  const before = await picture();
  await tile.hover();
  const seen = new Set([before]);
  for (let index = 0; index < 60 && seen.size < 4; index++) { await page.waitForTimeout(120); seen.add(await picture()); }
  expect(seen.size >= 4, `the hovered tile plays its frames, saw ${seen.size} pictures`);
  await page.mouse.move(700, 300);
  await settled();
  await shot("01-transitions-tab");
});

await step("search matches names and keywords across categories — Search by keyword; No results", async () => {
  const search = visible(page.getByRole("searchbox", { name: "Search transitions" }));
  await search.fill("wipe");
  await page.waitForTimeout(150);
  const names = await tileNames();
  // The catalogue gives Directional Blur the keywords "motion, streak" (catalog.md), so it is not a match for "wipe"; Swipe Up of another category is.
  expect(["Linear Wipe", "Clock Wipe", "Swipe Up"].every((name) => names.includes(name)) && !names.includes("Cross Dissolve"), `"wipe" lists the wipes of every category and nothing else: ${names.join(", ")}`);
  await search.fill("qqq");
  await tid("fx-no-results").waitFor();
  await button("Clear search").click();
  await page.waitForTimeout(150);
  expect((await tileNames()).length === 8 && (await tid("fx-category-Basic").getAttribute("aria-selected")) === "true", "clearing the search restores the category that was selected");
});

await step("“+” adds a Cross Dissolve on the cut and selects it; undo and redo keep its id — Both clips reference the transition; Redo keeps identity", async () => {
  await addTransition("cross-dissolve");
  let [handle] = await handles();
  expect(handle && handle.type === "cross-dissolve" && handle.duration === 60_000 && handle.selected, `a selected Cross Dissolve of 0.5 s sits on the cut: ${JSON.stringify(handle)}`);
  const main = await mainClips();
  expect(Math.abs(handle.x + handle.width / 2 - main[1].x) < 14, "the handle is on the cut between the two clips");
  await tid("transition-inspector").waitFor();
  expect((await tid("transition-name").innerText()) === "Cross Dissolve", "the inspector names it");
  expect((await tid("transition-inspector").innerText()).includes("Basic · between clip 1 and clip 2"), "and says where it is");
  expect((await fieldValue("transition-duration")) === "0.5", `its duration reads 0.5, got ${await fieldValue("transition-duration")}`);
  // Neither clip moved, and the scene is as long as before.
  const after = await mainClips();
  expect(after.every((clip, index) => Math.abs(clip.x - main[index].x) < 0.5 && Math.abs(clip.width - main[index].width) < 0.5), "adding a transition moves and trims nothing");
  await category("Recent");
  expect(JSON.stringify(await tileNames()) === JSON.stringify(["Cross Dissolve"]), "the applied transition is the newest of Recent");
  const id = handle.id;
  await undo();
  expect((await handles()).length === 0, "undo removes it");
  await redo();
  [handle] = await handles();
  expect(handle?.id === id, `redo restores the same transition id (${id} → ${handle?.id})`);
  await saved();
});

await step("dragging the handle changes the duration about the cut — Resize by edge drag", async () => {
  let [handle] = await handles();
  await page.mouse.click(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.waitForTimeout(150);
  [handle] = await handles();
  expect(handle.selected && Math.abs(handle.width - 0.5 * PX) < 2, `selected, the handle spans its window (25 px for 0.5 s), got ${handle.width}`);
  const y = handle.y + handle.height / 2, from = handle.x + handle.width - 2, to = from + 0.25 * PX;
  await page.mouse.move(from, y); await page.mouse.down();
  for (let index = 1; index <= 6; index++) { await page.mouse.move(from + ((to - from) * index) / 6, y); await page.waitForTimeout(20); }
  expect((await tid("transition-tooltip").innerText()) === "1.0s", `the tooltip reads the duration: ${await tid("transition-tooltip").innerText()}`);
  await page.mouse.up();
  await page.waitForTimeout(200);
  [handle] = await handles();
  expect(handle.duration === 120_000, `the right edge dragged out by 0.25 s makes it 1.0 s (both edges move), got ${handle.duration / 120_000} s`);
  expect(Math.abs(handle.width - PX) < 2, `and its window is 1 s wide: ${handle.width}`);
  expect((await fieldValue("transition-duration")) === "1", `the inspector follows: ${await fieldValue("transition-duration")}`);
  await undo();
  expect((await handles())[0].duration === 60_000, "one undo step returns it to 0.5 s");
  await redo();
  expect((await handles())[0].duration === 120_000, "and redo to 1.0 s");
});

await step("a cross-dissolve at its midpoint really blends both clips — Cross dissolve midpoint; Frame-exact boundaries", async () => {
  await seek("00:00:04:00");
  const mid = await pixel();
  expect(mid.r > 90 && mid.r < 170 && mid.b > 90 && mid.b < 170 && mid.g < 50, `the frame at the cut is half red and half blue: ${show(mid)}`);
  await seek("00:00:03:14");
  expect(A(await pixel()), `the frame before the window shows only the outgoing clip: ${show(await pixel())}`);
  await seek("00:00:04:15");
  expect(B(await pixel()), `the frame after the window shows only the incoming clip: ${show(await pixel())}`);
  // A quarter of the way in, the outgoing clip still weighs more.
  await seek("00:00:03:22");
  const early = await pixel(), outgoing = A === isRed ? early.r : early.b, incoming = A === isRed ? early.b : early.r;
  expect(outgoing > incoming + 40, `early in the window the outgoing clip dominates: ${show(early)}`);
  await shot("02-cross-dissolve-midpoint");
});

await step("Replace keeps the duration; a wipe shows A on one side and B on the other; a parameter edit is one undo step — Replace keeps duration; Edit a param", async () => {
  await seek("00:00:04:00");
  const [handle] = await handles();
  await page.mouse.click(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await tid("transition-replace").click();
  await tid("fx-replace-banner").waitFor();
  await category("Basic");
  await tid("fx-tile-transition-linear-wipe").locator('[role="button"]').first().click();
  await page.waitForTimeout(300);
  const [wipe] = await handles();
  expect(wipe.id === handle.id && wipe.type === "linear-wipe" && wipe.duration === 120_000, `the same transition is now a Linear Wipe of 1.0 s: ${JSON.stringify(wipe)}`);
  expect((await fieldValue("transition-param-angle")) === "0" && (await fieldValue("transition-param-softness")) === "10", "with the new type's default params");
  await settled();
  const left = await pixel(0.2, 0.5), right = await pixel(0.8, 0.5);
  expect((A(left) && B(right)) || (B(left) && A(right)), `at the midpoint one side is the outgoing clip and the other the incoming one: ${show(left)} | ${show(right)}`);
  await shot("03-linear-wipe-midpoint");
  await setField("transition-param-angle", 90);
  await loopEnded();
  const top = await pixel(0.5, 0.2), bottom = await pixel(0.5, 0.8);
  expect((A(top) && B(bottom)) || (B(top) && A(bottom)), `with angle 90 the wipe travels vertically: ${show(top)} over ${show(bottom)}`);
  await undo();
  await settled();
  expect((await fieldValue("transition-param-angle")) === "0", "undo restores angle 0");
  const again = await pixel(0.2, 0.5);
  expect(close(again, left), `and the picture of angle 0: ${show(again)}`);
});

await step("duration limits, easing, and the paired audio crossfade — Minimum; Maximum; Switch off", async () => {
  await setField("transition-duration", 0);
  expect((await handles())[0].duration === 12_000, `0 becomes 0.1 s (3 frames), got ${(await handles())[0].duration}`);
  await setField("transition-duration", 9);
  expect((await handles())[0].duration === 600_000, `9 becomes 5.0 s between two 4 s clips, got ${(await handles())[0].duration}`);
  await setField("transition-duration", 1);
  await visible(tid("transition-easing").getByRole("combobox")).click();
  await option("Linear").click();
  await page.waitForTimeout(200);
  expect((await tid("transition-easing").innerText()).includes("Linear"), "the easing select stores the choice");
  const toggle = visible(tid("transition-audio").getByRole("switch"));
  expect((await toggle.getAttribute("aria-checked")) === "true", "the audio crossfade is on by default");
  await tid("transition-curve").waitFor();
  expect((await tid("transition-curve").innerText()).includes("Equal power"), "with the equal-power curve");
  await toggle.click();
  await page.waitForTimeout(200);
  expect((await toggle.getAttribute("aria-checked")) === "false" && (await page.getByTestId("transition-curve").count()) === 0, "switched off, the curve select goes");
  await undo();
  expect((await toggle.getAttribute("aria-checked")) === "true", "undo turns it back on");
  await loopEnded();
});

await step("Delete removes the selected transition and restores the hard cut — Delete key; Remove restores a hard cut", async () => {
  const [handle] = await handles();
  await page.mouse.click(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.keyboard.press("Delete");
  await page.waitForTimeout(250);
  expect((await handles()).length === 0, "the transition is gone");
  expect((await mainClips()).length === 2, "and neither clip");
  await seek("00:00:04:00");
  expect(B(await pixel()), `the frame at the cut shows only the incoming clip: ${show(await pixel())}`);
  await seek("00:00:03:29");
  expect(A(await pixel()), `and the frame before it only the outgoing clip: ${show(await pixel())}`);
  await undo();
  expect((await handles()).length === 1, "undo brings the transition back");
});


const dragTile = async (tileId, point) => {
  const tracks = await tid("timeline-tracks").boundingBox();
  await tid(tileId).scrollIntoViewIfNeeded();
  await tid(tileId).dragTo(tid("timeline-tracks"), { targetPosition: { x: point.x - tracks.x, y: point.y - tracks.y } });
  await page.waitForTimeout(350);
};
/** A frame of a video file at a time, averaged to one colour by ffmpeg. */
const fileColour = (path, seconds) => { const [r, g, b] = execFileSync("ffmpeg", ["-loglevel", "error", "-ss", String(seconds), "-i", path, "-frames:v", "1", "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]); return { r, g, b }; };

/** The amplitude of one frequency in a stretch of a file's sound (mono, 48 kHz). */
const toneLevel = (path, from, seconds, frequency) => {
  const pcm = execFileSync("ffmpeg", ["-loglevel", "error", "-ss", String(from), "-t", String(seconds), "-i", path, "-vn", "-ac", "1", "-ar", "48000", "-f", "f32le", "-"], { maxBuffer: 1 << 26 });
  const samples = new Float32Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + Math.floor(pcm.byteLength / 4) * 4));
  let re = 0, im = 0;
  for (let index = 0; index < samples.length; index++) { const angle = (2 * Math.PI * frequency * index) / 48_000; re += samples[index] * Math.cos(angle); im += samples[index] * Math.sin(angle); }
  return samples.length ? (2 * Math.hypot(re, im)) / samples.length : 0;
};

await step("a tile dragged onto a cut replaces the transition there — Drag onto a cut", async () => {
  const [handle] = await handles();
  await category("Slide");
  await dragTile("fx-tile-transition-push", { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 });
  const [push] = await handles();
  expect(push && push.id === handle.id && push.type === "push" && push.duration === handle.duration && push.selected, `the cut now carries a selected Push of the same duration: ${JSON.stringify(push)}`);
  expect((await tid("transition-name").innerText()) === "Push", "and the inspector shows it");
  // Dropped away from every cut, a transition tile adds nothing.
  const main = await mainClips();
  await dragTile("fx-tile-transition-cover", { x: main[0].x + 40, y: handle.y + handle.height / 2 });
  expect((await handles()).length === 1 && (await handles())[0].type === "push", "no drop target exists more than 24 px from a cut");
});

await step("an MP4 export contains the transition", async () => {
  await tid("transition-replace").click();
  await category("Basic");
  await tid("fx-tile-transition-cross-dissolve").locator('[role="button"]').first().click();
  await page.waitForTimeout(300);
  expect((await handles())[0].type === "cross-dissolve" && (await handles())[0].duration === 120_000, "a 1.0 s Cross Dissolve joins the two clips");
  await saved();
  await tid("open-export").click();
  await tid("export-dialog").waitFor();
  const download = page.waitForEvent("download", { timeout: 300_000 }).catch(() => null);
  await tid("export-start").click();
  const file = await Promise.race([download, tid("export-error").waitFor({ timeout: 300_000 }).then(() => null, () => null)]);
  expect(file !== null, "the export finished with a file");
  await tid("export-done").waitFor({ timeout: 10_000 });
  const path = join(dir, "exported-fx.mp4");
  await file.saveAs(path);
  await button("Close").click();
  const before = fileColour(path, 3.0), mid = fileColour(path, 4.0), after = fileColour(path, 5.0);
  expect(A(before) && B(after), `the file shows the outgoing clip before the window and the incoming one after it: ${show(before)} … ${show(after)}`);
  expect(mid.r > 80 && mid.r < 180 && mid.b > 80 && mid.b < 180 && mid.g < 60, `and at the cut a blend of both: ${show(mid)}`);
  // The paired audio crossfade is in the file too: each clip's tone sounds alone outside the window and both sound at the cut.
  const first = A === isRed ? 440 : 880, second = A === isRed ? 880 : 440;
  // (The clips are whole sources, so neither side has a handle to sound from beyond the cut: each fades on its own side of it.)
  const early = [toneLevel(path, 3.0, 0.3, first), toneLevel(path, 3.0, 0.3, second)], out = toneLevel(path, 3.85, 0.1, first), into = toneLevel(path, 4.05, 0.1, second), late = [toneLevel(path, 5.0, 0.3, first), toneLevel(path, 5.0, 0.3, second)];
  expect(early[0] > 0.05 && early[0] > 8 * early[1], `before the window only the outgoing clip sounds: ${early.map((level) => level.toFixed(3))}`);
  expect(late[1] > 0.05 && late[1] > 8 * late[0], `after it only the incoming one: ${late.map((level) => level.toFixed(3))}`);
  // 0.4 of the way through the 1 s window the equal-power fade-out is at sin(0.6 × π/2) = 0.81; 0.6 of the way the fade-in is at the same.
  expect(out / early[0] > 0.62 && out / early[0] < 0.93 && into / late[1] > 0.62 && into / late[1] < 0.93, `inside the window each side is on its crossfade curve: ${(out / early[0]).toFixed(2)} out, ${(into / late[1]).toFixed(2)} in`);
});

await step("Apply to all, Set as default, Remove all and the default-transition action — Apply to all on the main track; Set as default; Remove all; Default transition on a selection", async () => {
  await showTab("media");
  await tid("timecode").fill("00:00:07:29"); await page.keyboard.press("Enter"); await page.waitForTimeout(200);
  await tid("thumb-green.png").dblclick();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="track-main-video"] [data-testid^="clip-"]').length >= 3);
  const main = await mainClips();
  expect(main.length === 3 && main.every((clip, index) => index === 0 || Math.abs(main[index - 1].x + main[index - 1].width - clip.x) < 1.5), "three clips sit edge to edge");
  let list = await handles();
  expect(list.length === 1, `the transition stayed on its cut: ${list.length}`);
  await page.mouse.click(list[0].x + list[0].width / 2, list[0].y + list[0].height / 2);
  await showTab("transitions");
  await tid("transition-replace").click();
  await category("Slide");
  await tid("fx-tile-transition-slide").locator('[role="button"]').first().click();
  await page.waitForTimeout(300);
  await tid("transition-apply-all").click();
  await toast("Applied to 2 cuts");
  list = await handles();
  expect(list.length === 2 && list.every((entry) => entry.type === "slide" && entry.duration === 120_000), `both cuts carry a Slide of 1.0 s: ${JSON.stringify(list.map((entry) => [entry.type, entry.duration]))}`);
  await undo();
  expect((await handles()).length === 1, "Apply to all is a single undo step");
  await redo();
  list = await handles();
  await page.mouse.click(list[0].x + list[0].width / 2, list[0].y + list[0].height / 2);
  await tid("transition-set-default").click();
  await toast("Default transition set");
  // Remove all, from the handle's menu, with the count in the confirm dialog.
  await page.mouse.click(list[1].x + list[1].width / 2, list[1].y + list[1].height / 2, { button: "right" });
  await choose("Remove all transitions");
  await visible(page.getByText("Remove 2 transitions from this scene?")).waitFor();
  await button("Remove all").click();
  await page.waitForTimeout(300);
  expect((await handles()).length === 0, "no transition remains");
  await undo();
  expect((await handles()).length === 2, "a single undo restores them all");
  await redo();
  expect((await handles()).length === 0, "and redo removes them again");
  // The default transition on every cut between the selected clips, as one step.
  await clickClip(main[0]);
  await page.keyboard.press(`${mod}+KeyA`);
  await page.keyboard.press("Alt+KeyT");
  await page.waitForTimeout(300);
  list = await handles();
  expect(list.length === 2 && list.every((entry) => entry.type === "slide" && entry.duration === 120_000), `two transitions of the default set above (Slide, 1.0 s): ${JSON.stringify(list.map((entry) => [entry.type, entry.duration]))}`);
  await undo();
  expect((await handles()).length === 0, "added as a single undo step");
  // With nothing selected: the cut nearest the playhead.
  await seek("00:00:07:00");
  await deselect();
  await page.keyboard.press("Alt+KeyT");
  await page.waitForTimeout(300);
  list = await handles();
  const cuts = await mainClips();
  expect(list.length === 1 && Math.abs(list[0].x + list[0].width / 2 - cuts[2].x) < 14 && list[0].selected, "the nearest cut takes it and it is selected");
});

await step("presets, favourites and the keyboard on the tiles — Save and apply; Favourite persists across restart", async () => {
  await visible(tid("transition-param-direction").getByRole("combobox")).click();
  await option("Up").click();
  await page.waitForTimeout(200);
  await loopEnded();
  await tid("transition-save-preset").click();
  const name = visible(page.getByRole("textbox", { name: "Preset name" }));
  await name.fill("Soft drop");
  await tid("fx-preset-save").click();
  await toast("Preset “Soft drop” saved");
  await deselect();
  await seek("00:00:04:00");
  await category("My presets");
  expect(JSON.stringify(await tileNames()) === JSON.stringify(["Soft drop"]), "My presets lists it");
  await addTransition("preset-Soft drop");
  let list = await handles();
  expect(list.length === 2 && list[0].type === "slide" && list[0].duration === 120_000 && list[0].selected, `the preset is applied to the cut nearest the playhead: ${JSON.stringify(list.map((entry) => [entry.type, entry.duration, entry.selected]))}`);
  expect((await tid("transition-param-direction").innerText()).includes("Up"), "with its params");
  await undo();
  expect((await handles()).length === 1, "as one undo step");
  await redo();
  // Rename and delete from the tile menu.
  await tid("fx-tile-transition-preset-Soft drop").locator('[role="button"]').first().click({ button: "right" });
  await choose("Rename");
  await visible(page.getByRole("textbox", { name: "Preset name" })).fill("Gentle drop");
  await tid("fx-preset-rename-confirm").click();
  await page.waitForTimeout(200);
  expect(JSON.stringify(await tileNames()) === JSON.stringify(["Gentle drop"]), "renamed");
  // A star keeps a tile in Favourites; F on a focused tile toggles it; arrows move the focus; Enter applies.
  await category("Favourites");
  await visible(page.getByText("Star an effect to keep it here")).waitFor();
  await category("Basic");
  await tid("fx-tile-transition-dip-to-black").hover();
  await tid("fx-star-dip-to-black").click();
  const first = tid("fx-tile-transition-cross-dissolve").locator('[role="button"]').first();
  await first.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
  expect(focused === "Dip to White", `two presses of ArrowRight move the focus two tiles on: ${focused}`);
  await page.keyboard.press("KeyF");
  await category("Favourites");
  expect(JSON.stringify(await tileNames()) === JSON.stringify(["Dip to Black", "Dip to White"]), `Favourites lists the starred tiles in the order they were added: )}`);
  list = await handles();
  await page.mouse.click(list[1].x + list[1].width / 2, list[1].y + list[1].height / 2);
  await tid("fx-tile-transition-dip-to-white").locator('[role="button"]').first().focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  expect((await handles())[1].type === "dip-to-white", "Enter on a focused tile applies it to the selected cut");
  await shot("04-transition-inspector");
});


// — Effects and filters —
const rows = () => page.evaluate(() => [...document.querySelectorAll('[data-testid^="effect-row-"]')].map((node) => ({ type: node.getAttribute("data-testid").slice("effect-row-".length), id: node.getAttribute("data-effect-id"), enabled: node.getAttribute("data-enabled") === "true" })));
const effectTile = async (kind, type) => { const tile = tid(`fx-tile-${kind}-${type}`); await tile.scrollIntoViewIfNeeded(); await tile.locator('[role="button"]').first().click(); await page.waitForTimeout(300); };
const inverse = (c) => ({ r: 255 - c.r, g: 255 - c.g, b: 255 - c.b });
const between = (value, a, b, margin = 25) => value > Math.min(a, b) + margin && value < Math.max(a, b) - margin;
const effectBars = async () => (await clips()).filter((clip) => clip.track === "track-overlay-effect");
let original; // the colour of the first clip, as the preview shows it without any effect

await step("the Effects tab lists 61 effects in 10 categories with rendered tiles — Every bundled effect is present offline; Category filter; Keyword match; No results", async () => {
  // Start from a plain timeline: no transitions.
  const list = await handles();
  if (list.length > 0) { await page.mouse.click(list[0].x + list[0].width / 2, list[0].y + list[0].height / 2, { button: "right" }); await choose("Remove all transitions"); await button("Remove all").click(); await page.waitForTimeout(300); }
  expect((await handles()).length === 0, "the transitions are removed");
  await deselect();
  await showTab("effects");
  const strip = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="fx-category-"]')].map((node) => node.textContent));
  expect(JSON.stringify(strip) === JSON.stringify(["All", "Favourites", "Recent", "My presets", "Blur", "Distort", "Stylise", "Light", "Glitch", "Retro", "Particles", "Lens", "Photo", "Body", "AI styles"]), `the category strip: ${strip.join(", ")}`);
  expect((await tileNames()).length === 61, `All lists 61 effects, got ${(await tileNames()).length}`);
  for (const [name, count] of [["Blur", 7], ["Distort", 9], ["Stylise", 9], ["Light", 6], ["Glitch", 5], ["Retro", 6], ["Particles", 6], ["Lens", 5], ["Photo", 3], ["Body", 5]]) {
    await category(name);
    expect((await tileNames()).length === count, `${name} has ${count} effects, got ${(await tileNames()).length}`);
  }
  // Body effects need the on-device person model, which this device does not have: the tiles are disabled and say so.
  expect((await tid("fx-tile-effect-body-glow").locator('[role="button"]').first().getAttribute("aria-disabled")) === "true", "a Body tile is disabled");
  await category("AI styles");
  await visible(page.getByText("Connect a host to use AI styles")).waitFor();
  await category("Glitch");
  expect(JSON.stringify(await tileNames()) === JSON.stringify(["RGB Split", "Block Glitch", "Scanline Jitter", "Signal Loss", "Pixel Sort"]), "Glitch shows exactly its five effects");
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="fx-grid"] [data-testid="fx-tile-picture"]').length >= 4, null, { timeout: 60_000 });
  const size = await tid("fx-tile-effect-glitch").locator('[role="button"]').first().boundingBox();
  expect(Math.round(size.width) === 96 && Math.round(size.height) === 96, `an effect tile is 96 × 96, got ${size.width} × ${size.height}`);
  const search = visible(page.getByRole("searchbox", { name: "Search effects" }));
  await search.fill("defocus");
  await page.waitForTimeout(150);
  expect((await tileNames()).includes("Gaussian Blur"), `"defocus" finds Gaussian Blur by its keyword: ${(await tileNames()).join(", ")}`);
  await search.fill("zzzz");
  await tid("fx-no-results").waitFor();
  expect((await tid("fx-no-results").innerText()).includes("zzzz"), "the empty state names the query");
  await button("Clear search").click();
  await page.waitForTimeout(150);
  expect((await tileNames()).length === 5, "and clearing it restores the Glitch category");
  await settled();
  await shot("05-effects-tab");
});

await step("an effect clicked with a clip selected really changes the picture; undo and redo walk it — Appending an effect uses defaults; Undo apply; Wand button", async () => {
  await seek("00:00:01:00");
  original = await pixel();
  const main = await mainClips();
  await clickClip(main[0]);
  await category("Stylise");
  await effectTile("effect", "invert");
  await tid("effects-list").waitFor();
  let list = await rows();
  expect(list.length === 1 && list[0].type === "invert" && list[0].enabled, `the clip has one Invert entry and the Effects tab shows it: ${JSON.stringify(list)}`);
  expect((await fieldValue("fx-param-intensity")) === "100", "with its default intensity");
  await settled();
  const inverted = await pixel();
  expect(close(inverted, inverse(original), 30), `the picture is inverted: ${show(original)} → ${show(inverted)}`);
  expect((await page.getByTestId(`tl-ctl-wand-${main[0].id}`).count()) === 1, "the clip shows the wand of a clip with effects");
  await undo(); await settled();
  expect(close(await pixel(), original), `undo restores the original pixels: ${show(await pixel())}`);
  expect((await page.getByTestId("effects-empty").count()) === 1 || (await rows()).length === 0, "and the stack is empty again");
  await redo(); await settled();
  expect(close(await pixel(), inverted), "redo applies it again");
  // The wand selects the clip and opens its Effects tab.
  await deselect();
  await page.getByTestId(`tl-ctl-wand-${main[0].id}`).click();
  await tid("effects-list").waitFor();
  await shot("06-clip-effects");
});

await step("parameters preview live and record one step; Escape cancels a drag; the eye toggle disables — Live preview then one undo step; Escape cancels a drag; Disable an effect; Param boundaries", async () => {
  const full = await pixel();
  await setField("fx-param-intensity", 50);
  await settled();
  const half = await pixel();
  expect(["r", "g", "b"].every((channel) => Math.abs(original[channel] - full[channel]) < 60 || between(half[channel], original[channel], full[channel])), `at 50 % the picture is between the original and the full effect: ${show(original)} | ${show(half)} | ${show(full)}`);
  await undo(); await settled();
  expect((await fieldValue("fx-param-intensity")) === "100" && close(await pixel(), full), "one undo returns the value");
  // A typed value is snapped and clamped.
  await setField("fx-param-intensity", 104.6);
  expect((await fieldValue("fx-param-intensity")) === "100", `104.6 is stored as 100, got ${await fieldValue("fx-param-intensity")}`);
  // A drag of the slider: the preview follows while the button is down, and the release records a single step.
  const slider = visible(tid("fx-param-intensity").getByRole("slider"));
  const box = await slider.boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y); await page.mouse.down();
  for (let index = 1; index <= 8; index++) { await page.mouse.move(box.x + box.width / 2 - (80 * index) / 8, y); await page.waitForTimeout(30); }
  await page.waitForTimeout(400);
  const during = await pixel();
  expect(!close(during, full, 40), `the preview updates while the slider is dragged: ${show(during)}`);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const dragged = Number(await fieldValue("fx-param-intensity"));
  expect(dragged < 80, `the release stores the dragged value: ${dragged}`);
  await undo(); await settled();
  expect((await fieldValue("fx-param-intensity")) === "100", "a single undo returns to the value before the drag");
  // Escape during a drag discards it.
  const again = await slider.boundingBox();
  await page.mouse.move(again.x + again.width / 2, y); await page.mouse.down();
  for (let index = 1; index <= 6; index++) { await page.mouse.move(again.x + again.width / 2 - (70 * index) / 6, y); await page.waitForTimeout(30); }
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.waitForTimeout(300); await settled();
  expect((await fieldValue("fx-param-intensity")) === "100" && close(await pixel(), full), `Escape leaves the value as it was: ${await fieldValue("fx-param-intensity")}`);
  expect(await tid("bar-redo").isEnabled(), "and records no step (the undone drag is still what redo offers)");
  // The eye toggle.
  const main = await mainClips();
  await clickClip(main[0]);
  await tid("effect-toggle").click(); await settled();
  expect((await rows())[0].enabled === false && close(await pixel(), original), `disabled, the preview renders without the effect: ${show(await pixel())}`);
  await tid("effect-toggle").click(); await settled();
  expect((await rows())[0].enabled && close(await pixel(), full), "enabled again, with it");
});

await step("the stack: a second effect, reorder by keyboard and by drag, reset, keyframe, remove — Reorder by drag; Empty state; Keyframe on an effect", async () => {
  await category("Lens");
  await effectTile("effect", "vignette");
  let list = await rows();
  expect(JSON.stringify(list.map((row) => row.type)) === JSON.stringify(["invert", "vignette"]), `a new entry is appended at the end: ${list.map((row) => row.type)}`);
  await visible(tid("effect-row-vignette").getByTestId("effect-name")).focus();
  await page.keyboard.press("Alt+ArrowUp");
  await page.waitForTimeout(200);
  expect(JSON.stringify((await rows()).map((row) => row.type)) === JSON.stringify(["vignette", "invert"]), "Alt+Up moves the focused row up");
  await undo();
  expect(JSON.stringify((await rows()).map((row) => row.type)) === JSON.stringify(["invert", "vignette"]), "one undo restores the order");
  // By drag: the first row below the second.
  const grip = await visible(tid("effect-row-invert").getByTestId("effect-grip")).boundingBox();
  const lower = await tid("effect-row-vignette").boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await page.mouse.down();
  for (let index = 1; index <= 6; index++) { await page.mouse.move(grip.x + grip.width / 2, grip.y + ((lower.y + lower.height + 10 - grip.y) * index) / 6); await page.waitForTimeout(30); }
  expect((await page.getByTestId("effects-drop-line").count()) === 1, "a line shows where the row would land");
  await page.mouse.up();
  await page.waitForTimeout(250);
  expect(JSON.stringify((await rows()).map((row) => row.type)) === JSON.stringify(["vignette", "invert"]), `the dragged row lands after the other: ${(await rows()).map((row) => row.type)}`);
  // Reset returns the parameters to their defaults.
  await setField("fx-param-amount", 90);
  expect((await visible(tid("effect-row-vignette").getByTestId("fx-param-amount").locator("input")).inputValue()) === "90", "a parameter of the vignette is edited");
  await visible(tid("effect-row-vignette").getByTestId("effect-reset")).click();
  await page.waitForTimeout(200);
  expect((await visible(tid("effect-row-vignette").getByTestId("fx-param-amount").locator("input")).inputValue()) === "40", "Reset restores its default (40)");
  // A keyframe toggle on a keyframable parameter.
  const key = visible(tid("effect-row-invert").getByTestId("fx-kf-intensity"));
  await key.click();
  await page.waitForTimeout(200);
  expect((await key.getAttribute("aria-pressed")) === "true", "the diamond is filled: a key sits at the playhead");
  await key.click();
  await page.waitForTimeout(200);
  expect((await key.getAttribute("aria-pressed")) === "false", "and hollow again once the key is removed");
  // Remove both: the picture is the original again and the tab shows its empty state.
  await visible(tid("effect-row-vignette").getByTestId("effect-remove")).click();
  await visible(tid("effect-row-invert").getByTestId("effect-remove")).click();
  await tid("effects-empty").waitFor();
  await settled();
  expect(close(await pixel(), original), `removing restores the original pixels: ${show(await pixel())}`);
  await visible(page.getByText("No effects", { exact: true })).waitFor();
  await showTab("transitions");
  await tid("effects-open").click();
  await tid("fx-library-effect").waitFor();
});

await step("presets and copy / paste of effects — Save and apply; Paste onto several clips", async () => {
  const main = await mainClips();
  await clickClip(main[0]);
  await category("Stylise");
  await effectTile("effect", "invert");
  await setField("fx-param-intensity", 80);
  await tid("effect-save-preset").click();
  await visible(page.getByRole("textbox", { name: "Preset name" })).fill("Soft bloom");
  await tid("fx-preset-save").click();
  await toast("Preset “Soft bloom” saved");
  await clickClip(main[1]);
  await category("My presets");
  expect(JSON.stringify(await tileNames()) === JSON.stringify(["Soft bloom"]), "My presets lists it");
  await effectTile("effect", "preset-Soft bloom");
  expect((await rows()).length === 1 && (await rows())[0].type === "invert" && (await fieldValue("fx-param-intensity")) === "80", "the other clip gains the effect with the preset's values");
  await undo();
  await clickClip(main[1]);
  expect((await page.getByTestId("effects-empty").count()) === 1, "as one undo step");
  // Copy the effects of the first clip and paste them onto the two others.
  await page.mouse.click(main[0].x + main[0].width / 2, main[0].y + 8, { button: "right" });
  await choose("Copy effects");
  await clickClip(main[1]);
  await page.keyboard.down("Shift"); await clickClip(main[2]); await page.keyboard.up("Shift");
  await page.mouse.click(main[2].x + main[2].width / 2, main[2].y + 8, { button: "right" });
  await choose("Paste effects");
  await page.waitForTimeout(300);
  for (const index of [1, 2]) expect((await page.getByTestId(`tl-ctl-wand-${main[index].id}`).count()) === 1, `clip ${index + 1} has effects now`);
  await undo();
  for (const index of [1, 2]) expect((await page.getByTestId(`tl-ctl-wand-${main[index].id}`).count()) === 0, "one undo removes the pasted entries from both");
  await clickClip(main[0]);
  await visible(tid("effect-row-invert").getByTestId("effect-remove")).click();
  await tid("effects-empty").waitFor();
});

await step("a tile clicked with nothing selected becomes a standalone layer on an effect track — Effect layer outside its range; Replace keeps the range; Convert layer to clip filter", async () => {
  await deselect();
  await seek("00:00:01:00");
  await category("Stylise");
  await effectTile("effect", "invert");
  let bars = await effectBars();
  expect(bars.length === 1 && Math.abs(bars[0].width - 5 * PX) < 2, `a 5 s effect bar sits on an effect track: ${JSON.stringify(bars.map((bar) => [bar.track, Math.round(bar.width)]))}`);
  const main = await mainClips();
  expect(Math.abs(bars[0].x - (main[0].x + PX)) < 2 && bars[0].y < main[0].y, "it starts at the playhead, above the main track");
  await tid("layer-parameters").waitFor();
  expect((await tid("layer-name").innerText()) === "Invert" && (await tid("layer-parameters").innerText()).includes("Stylise · standalone effect layer"), "its inspector names the layer");
  await settled();
  expect(close(await pixel(), inverse(original), 30), `the picture beneath it is inverted: ${show(await pixel())}`);
  // Outside its range the frame is rendered without the effect: before its start, and one frame after its end.
  await seek("00:00:00:15");
  expect(close(await pixel(), original), `before the layer the picture is the clip's own: ${show(await pixel())}`);
  await seek("00:00:06:00");
  expect(B(await pixel()), `one frame after its end the second clip is untouched: ${show(await pixel())}`);
  await seek("00:00:05:29");
  expect(!B(await pixel()), "and on its last frame it is still inverted");
  await seek("00:00:01:00");
  // The header switch disables the layer.
  const toggle = visible(tid("layer-parameters").getByRole("switch"));
  await toggle.click(); await settled();
  expect(close(await pixel(), original), "switched off, the layer does nothing");
  await toggle.click(); await settled();
  // Replace swaps the entry and keeps the range.
  await tid("layer-replace").click();
  await tid("fx-replace-banner").waitFor();
  await effectTile("effect", "posterize");
  const replaced = await effectBars();
  expect(replaced.length === 1 && Math.abs(replaced[0].x - bars[0].x) < 0.5 && Math.abs(replaced[0].width - bars[0].width) < 0.5, "the bar keeps its start and its end");
  expect((await tid("layer-name").innerText()) === "Posterize" && (await fieldValue("fx-param-levels")) === "6", "and holds Posterize at its defaults");
  await undo();
  expect((await tid("layer-name").innerText()) === "Invert", "one undo brings Invert back");
  // Target → a clip: the layer becomes an entry of that clip.
  await visible(tid("layer-target").getByRole("combobox")).click();
  await visible(page.getByRole("option").filter({ hasText: /\.mp4$/ })).click();
  await page.waitForTimeout(300);
  expect((await effectBars()).length === 0 && (await rows()).length === 1 && (await rows())[0].type === "invert", "the layer is gone and the clip has the entry");
  await undo();
  expect((await effectBars()).length === 1, "one undo restores the standalone layer");
  // Remove the layer: the original pixels are back.
  bars = await effectBars();
  await clickClip(bars[0]);
  await tid("layer-remove").click();
  await page.waitForTimeout(300); await settled();
  expect((await effectBars()).length === 0 && close(await pixel(), original), `removing the layer restores the picture: ${show(await pixel())}`);
});

await step("filters: 39 tiles in 8 categories; intensity mixes; a second filter replaces the first; apply to all; a filter layer — All filters listed by category; Intensity mixes linearly; Second filter replaces the first; Apply to all; Filter layer is an effect element", async () => {
  await showTab("filters");
  const strip = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="fx-category-"]')].map((node) => node.textContent));
  expect(JSON.stringify(strip) === JSON.stringify(["All", "Favourites", "Recent", "My presets", "Film", "Portrait", "Landscape", "Food", "Night", "Retro", "Mono", "Style"]), `the category strip: ${strip.join(", ")}`);
  expect((await tileNames()).length === 39, `39 filters, got ${(await tileNames()).length}`);
  const main = await mainClips();
  await clickClip(main[0]);
  await category("Mono");
  await effectTile("filter", "mono");
  await settled();
  const mono = await pixel();
  expect(Math.abs(mono.r - mono.g) < 12 && Math.abs(mono.g - mono.b) < 12, `Mono at 100 % is grey: ${show(mono)}`);
  await setField("fx-param-intensity", 50);
  await settled();
  const half = await pixel();
  expect(["r", "g", "b"].every((channel) => Math.abs(half[channel] - (original[channel] + mono[channel]) / 2) < 14), `at 50 % each channel is half way between the original and the filtered colour: ${show(original)} | ${show(half)} | ${show(mono)}`);
  await setField("fx-param-intensity", 0);
  await settled();
  expect(close(await pixel(), original, 3), `at 0 % the frame is the unfiltered one: ${show(await pixel())}`);
  await setField("fx-param-intensity", 70);
  const id = (await rows())[0].id;
  await category("Retro");
  await effectTile("filter", "sepia");
  let list = await rows();
  expect(list.length === 1 && list[0].type === "sepia" && list[0].id === id && (await fieldValue("fx-param-intensity")) === "70", `a second filter replaces the first and keeps its id and intensity: ${JSON.stringify(list)}`);
  await undo();
  expect((await rows())[0].type === "mono", "as a single undo step");
  // Apply to all, with the count in the confirm dialog.
  await tid("filter-apply-all").click();
  await visible(page.getByText("3 clips get “Mono” at 70%")).waitFor();
  await visible(page.getByRole("dialog").getByRole("button", { name: "Apply to all", exact: true })).click();
  await page.waitForTimeout(300);
  for (const index of [1, 2]) expect((await page.getByTestId(`tl-ctl-wand-${main[index].id}`).count()) === 1, `clip ${index + 1} has the filter`);
  await seek("00:00:05:00");
  const second = await pixel();
  expect(!B(second), `the second clip is filtered too: ${show(second)}`);
  await undo(); await settled();
  expect(B(await pixel()), "a single undo returns every clip to its previous filter state");
  // "Remove filter" from the clip menu.
  await seek("00:00:01:00");
  await page.mouse.click(main[0].x + main[0].width / 2, main[0].y + 8, { button: "right" });
  await choose("Remove filter");
  await page.waitForTimeout(300); await settled();
  expect(close(await pixel(), original), "Remove filter restores the picture");
  // A filter clicked with nothing selected is an effect element whose entry is a filter.
  await deselect();
  await effectTile("filter", "sepia");
  const bars = await effectBars();
  expect(bars.length === 1 && (await tid("layer-parameters").getAttribute("data-kind")) === "filter" && (await fieldValue("fx-param-intensity")) === "100", "a filter layer at intensity 100");
  expect((await tid("layer-parameters").innerText()).includes("standalone filter layer"), "labelled as a filter");
  await settled();
  expect(!close(await pixel(), original, 8), `it tones the layers beneath: ${show(await pixel())}`);
  await shot("07-filter-layer");
  await tid("layer-remove").click();
  await page.waitForTimeout(300);
  expect((await effectBars()).length === 0, "removed");
});

await step("a tile dragged onto a clip applies to it; onto an empty part of the tracks it becomes a layer — Drag onto a compatible clip", async () => {
  await showTab("effects");
  await category("Light");
  const main = await mainClips();
  await dragTile("fx-tile-effect-glow", { x: main[1].x + main[1].width / 2, y: main[1].y + main[1].height / 2 });
  await tid("effects-list").waitFor();
  expect((await rows()).length === 1 && (await rows())[0].type === "glow", "the clip gains a Glow entry and its Effects tab opens");
  expect((await fieldValue("fx-param-intensity")) === "40", "with the Glow params visible at their defaults");
  await undo();
  await category("Recent");
  expect((await tileNames())[0] === "Glow", `the applied effect leads Recent: ${(await tileNames()).slice(0, 3).join(", ")}`);
});

await step("what the device keeps survives a reload — Reload; Favourite persists across restart", async () => {
  await showTab("transitions");
  await category("Basic");
  await deselect();
  await seek("00:00:04:00");
  await addTransition("cross-dissolve");
  const [before] = await handles();
  await saved();
  await page.reload({ waitUntil: "networkidle" });
  for (const id of ["editor-bar", "asset-panel", "player", "timeline"]) await tid(id).waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-testid^="tl-ctl-transition-"]').length === 1, null, { timeout: 30_000 });
  const [after] = await handles();
  expect(after.id === before.id && after.type === before.type && after.duration === before.duration, "the transition is the same after the reload");
  await showTab("transitions");
  await category("Favourites");
  expect(JSON.stringify(await tileNames()) === JSON.stringify(["Dip to Black", "Dip to White"]), `Favourites kept its tiles: ${(await tileNames()).join(", ")}`);
  await category("My presets");
  expect(JSON.stringify(await tileNames()) === JSON.stringify(["Gentle drop"]), "and My presets its preset");
});


/** The design frame on the left, this screen on the right, same theme: what the two are compared on. */
const compare = async (frameId, scheme) => {
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
  await design.screenshot({ path: `.dev/compare/${frameId}-${scheme}.png` });
  await design.close();
};

await step("the screens of the two frames, light and dark, at 1440 × 900 and 390 × 844", async () => {
  // The frames draw the asset panel at 30 % of the width, where three tiles fit a row: the panel is brought to that width.
  await showTab("transitions");
  await category("Basic");
  const panel = await tid("asset-panel").boundingBox();
  // The splitter is moved by its keys, a step at a time.
  await page.evaluate((edge) => { const found = [...document.querySelectorAll('[role="separator"][aria-orientation="vertical"]')].sort((p, q) => Math.abs(p.getBoundingClientRect().left - edge) - Math.abs(q.getBoundingClientRect().left - edge))[0]; found?.focus(); }, panel.x + panel.width);
  for (let index = 0; index < 40 && (await tid("asset-panel").boundingBox()).width < 428; index++) { await page.keyboard.press("ArrowRight"); await page.waitForTimeout(30); }
  await page.evaluate(() => document.activeElement?.blur?.());
  expect((await tid("asset-panel").boundingBox()).width >= 428, `the asset panel is 30 % wide: ${(await tid("asset-panel").boundingBox()).width}`);
  expect((await page.evaluate(() => { const tiles = [...document.querySelectorAll('[data-testid="fx-grid"] > div')].slice(0, 4).map((node) => Math.round(node.getBoundingClientRect().top)); return tiles.length < 4 || (tiles[0] === tiles[2] && tiles[3] > tiles[0]); })), "three tiles fit a row");
  // d-editor-transitions: the Transitions tab on Basic, a Linear Wipe selected on the first cut.
  await showTab("transitions");
  await category("Basic");
  let [handle] = await handles();
  await page.mouse.click(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await tid("transition-replace").click();
  await tid("fx-tile-transition-linear-wipe").locator('[role="button"]').first().click();
  await page.waitForTimeout(300);
  await setField("transition-param-angle", 45);
  await loopEnded();
  await page.mouse.move(700, 300);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="fx-grid"] [data-testid="fx-tile-picture"]').length >= 8, null, { timeout: 60_000 });
  await settled();
  expect((await tid("fx-tile-transition-linear-wipe").getByTestId("fx-tile-on").count()) === 1, "the tile of the selected transition is marked");
  for (const scheme of ["light", "dark"]) { await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(600); await shot(`10-transitions-1440-${scheme}`); await compare("d-editor-transitions", scheme); }
  // d-editor-effects: the Effects tab on All, a standalone Film Grain layer selected.
  await page.emulateMedia({ colorScheme: "light" });
  await deselect();
  await seek("00:00:00:00");
  await showTab("effects");
  await category("Retro");
  await effectTile("effect", "film-grain");
  await tid("layer-parameters").waitFor();
  await category("All");
  await page.mouse.move(700, 300);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="fx-grid"] [data-testid="fx-tile-picture"]').length >= 9, null, { timeout: 60_000 });
  await settled();
  for (const scheme of ["light", "dark"]) { await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(600); await shot(`11-effects-1440-${scheme}`); await compare("d-editor-effects", scheme); }
  for (const scheme of ["light", "dark"]) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(1200);
    for (const id of ["player", "compact-timeline"]) await tid(id).waitFor({ timeout: 10_000 });
    expect((await page.locator('[data-testid^="tl-ctl-transition-"]').count()) >= 1, "the transition handle is on the compact timeline too");
    await shot(`12-fx-390-${scheme}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
});

console.log(errors.length ? `\n${errors.length} problem(s):\n${errors.join("\n")}` : "\nno problems");
await browser.close();
process.exit(errors.length ? 1 : 0);
