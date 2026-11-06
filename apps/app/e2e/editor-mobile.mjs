// End-to-end in a real browser with touch emulation (hasTouch, isMobile) at a phone viewport, with no host: the compact
// (phone) layout of the editor — top bar, preview, transport row, fixed-playhead timeline, two-level bottom toolbar, tool sheets.
// Real storage (IndexedDB and OPFS of a fresh browser profile) and real media files made with ffmpeg; nothing is seeded or mocked.
// Fingers are real touch events dispatched through the DevTools protocol (one and two touch points). One thing is not the
// real one: a headless browser has no save dialog, so `showSaveFilePicker` is removed and the export is read as a download.
// Usage: node apps/app/e2e/editor-mobile.mjs [screenshot-dir] [base-url] [width] [height]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const shots = process.argv[2] ?? ".dev/shots/editor-mobile";
const base = process.argv[3] ?? "http://localhost:8096";
const width = Number(process.argv[4] ?? 390), height = Number(process.argv[5] ?? 844);
// The second viewport runs the same flow without the per-tool sweep.
const smoke = process.argv.includes("--smoke");
mkdirSync(shots, { recursive: true });

// — Media: two H.264/AAC clips whose picture changes every frame, a PNG, a WAV —
const dir = join(tmpdir(), "jagentchill-editor-mobile-e2e");
mkdirSync(dir, { recursive: true });
const ffmpeg = (...args) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args]);
const media = (name) => join(dir, name);
if (!existsSync(media("first.mp4"))) ffmpeg("-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=4", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", media("first.mp4"));
if (!existsSync(media("second.mp4"))) ffmpeg("-f", "lavfi", "-i", "testsrc=s=640x360:r=30:d=3", "-f", "lavfi", "-i", "sine=frequency=880:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", media("second.mp4"));
if (!existsSync(media("still.png"))) ffmpeg("-f", "lavfi", "-i", "color=c=green:s=320x320:d=1", "-frames:v", "1", media("still.png"));
if (!existsSync(media("tone.wav"))) ffmpeg("-f", "lavfi", "-i", "sine=frequency=220:duration=6", media("tone.wav"));

// The microphone of the voiceover step is Chromium's own fake capture device.
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, colorScheme: "light", acceptDownloads: true, permissions: ["microphone"] });
await context.addInitScript(() => { delete window.showSaveFilePicker; delete window.showDirectoryPicker; });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
const errors = [];
page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
page.on("console", (msg) => { if (msg.type() === "error") errors.push(`${msg.text()} ${msg.location()?.url ?? ""}`); });
// A load that the page itself gave up (a media element that was unmounted) is not an error.
page.on("requestfailed", (request) => { if (request.failure()?.errorText !== "net::ERR_ABORTED") errors.push(`request failed: ${request.url().slice(0, 120)} ${request.failure()?.errorText ?? ""}`); });

const visible = (locator) => locator.filter({ visible: true }).first();
const tid = (id) => visible(page.getByTestId(id));
const shot = (name) => page.screenshot({ path: `${shots}/${name}.png` });
const expect = (condition, message) => { if (!condition) throw new Error(message); };
const near = (a, b, tolerance = 2) => Math.abs(a - b) <= tolerance;
const wait = (ms) => page.waitForTimeout(ms);
let failed = 0;
// JC_ONLY (a regular expression over step names) runs a part of the flow while debugging; the run then never counts as a pass.
const only = process.env.JC_ONLY ? new RegExp(process.env.JC_ONLY) : null;
const step = async (name, run) => {
  if (only && !only.test(name)) return;
  try { await run(); console.log("ok  ", name); }
  catch (err) { failed++; console.log("FAIL", name, "—", String(err).split("\n")[0]); errors.push(`step failed: ${name}`); await shot(`failure-${name.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}`).catch(() => undefined); if (process.env.JC_FAILFAST) { console.log(errors.slice(-6).map((text) => text.slice(0, 700)).join("\n")); await browser.close(); process.exit(1); } }
};

// — Fingers —
const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map((point, id) => ({ x: Math.round(point.x * 100) / 100, y: Math.round(point.y * 100) / 100, id })) });
/** The box of an element once it has come to rest: sheets and dialogs slide in, and a finger aimed at a moving button misses it. */
const rested = async (locator) => { let box = await locator.boundingBox(); for (let index = 0; index < 20; index++) { await wait(80); const next = await locator.boundingBox(); if (box && next && Math.abs(next.x - box.x) < 0.5 && Math.abs(next.y - box.y) < 0.5) return next; box = next; } return box; };
const tap = async (target) => { const box = "x" in target ? null : await rested(target); const point = box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : target; await touch("touchStart", [point]); await wait(30); await touch("touchEnd", []); await wait(150); };
/** One finger from a point to another: `hold` keeps it down first (a long press), `rest` keeps it down at the end (no fling). */
const swipe = async (from, to, options = {}) => {
  const steps = options.steps ?? 12;
  await touch("touchStart", [from]);
  if (options.hold) await wait(options.hold);
  for (let index = 1; index <= steps; index++) { await touch("touchMove", [{ x: from.x + ((to.x - from.x) * index) / steps, y: from.y + ((to.y - from.y) * index) / steps }]); await wait(16); }
  if (options.during) await options.during();
  await wait(options.rest ?? 220);
  await touch("touchEnd", []);
  await wait(200);
};
/** Two fingers about a centre, from one distance apart to another. */
const pinch = async (centre, from, to, steps = 10) => {
  const at = (distance) => [{ x: centre.x - distance / 2, y: centre.y }, { x: centre.x + distance / 2, y: centre.y }];
  await touch("touchStart", [at(from)[0]]); await touch("touchStart", at(from));
  for (let index = 1; index <= steps; index++) { await touch("touchMove", at(from + ((to - from) * index) / steps)); await wait(16); }
  await wait(60);
  await touch("touchEnd", []);
  await wait(200);
};

/** Turns the emulated phone on its side and back: the metrics and the orientation the page reads. */
const turn = (landscape) => cdp.send("Emulation.setDeviceMetricsOverride", { width: landscape ? height : width, height: landscape ? width : height, deviceScaleFactor: 2, mobile: true, screenOrientation: landscape ? { type: "landscapePrimary", angle: 90 } : { type: "portraitPrimary", angle: 0 } });

// — What is on screen and what is stored —
const timeline = () => tid("compact-timeline");
const view = async () => { const node = timeline(), box = await node.boundingBox(); return { box, zoom: Number(await node.getAttribute("data-zoom")), scroll: Number(await node.getAttribute("data-scroll")), small: (await node.getAttribute("data-small")) === "true", pps: 50 * Number(await node.getAttribute("data-zoom")) }; };
const seconds = async () => { const [now, total] = (await tid("compact-time").innerText()).split("/").map((text) => text.trim().split(":").map(Number).reduce((sum, part) => sum * 60 + part, 0)); return { now, total }; };
/** The stored project: the record of this project in IndexedDB, as the save manager wrote it. */
const stored = () => page.evaluate(async () => {
  const id = location.pathname.split("/").pop();
  const database = await new Promise((resolve, reject) => { const request = indexedDB.open("jagentchill"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  const holds = (value) => value && typeof value === "object" && Array.isArray(value.scenes) && value.metadata?.id === id;
  const dig = (value, depth = 0) => { if (holds(value)) return value; if (!value || typeof value !== "object" || depth > 3) return null; for (const child of Object.values(value)) { const found = dig(typeof child === "string" && child.startsWith("{") && child.includes('"scenes"') ? JSON.parse(child) : child, depth + 1); if (found) return found; } return null; };
  for (const store of database.objectStoreNames) {
    const all = await new Promise((resolve) => { const request = database.transaction(store).objectStore(store).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => resolve([]); });
    for (const value of all) { const found = dig(typeof value === "string" && value.includes('"scenes"') ? JSON.parse(value) : value); if (found) { database.close(); return found; } }
  }
  database.close();
  return null;
});
const saved = async () => { await visible(page.getByTestId("save-state").getByText("Saved", { exact: true })).waitFor({ timeout: 20_000 }); await wait(150); };
const scene = async () => { await saved(); const doc = await stored(); expect(doc, "the project is stored"); return doc.scenes.find((entry) => entry.isMain) ?? doc.scenes[0]; };
const mainOf = async () => [...(await scene()).tracks.main.elements].sort((a, b) => a.startTime - b.startTime);
const T = 120_000;
/** Waits until the stored project says so. */
const until = async (check, message, timeout = 20_000) => { const started = Date.now(); for (;;) { if (await check()) return; if (Date.now() - started > timeout) throw new Error(message); await wait(200); } };
const contiguous = (elements) => elements.every((element, index) => element.startTime === (index === 0 ? 0 : elements[index - 1].startTime + elements[index - 1].duration));
/** The clips drawn on the lanes: test id, box and whether selected. */
const clips = () => page.evaluate(() => [...document.querySelectorAll('[data-testid="compact-timeline"] [data-testid^="clip-"]')].filter((node) => !["clip-selection", "clip-hover", "clip-hatch"].includes(node.getAttribute("data-testid"))).map((node) => {
  const rect = node.getBoundingClientRect(), row = node.closest('[data-testid^="track-"]');
  return { id: node.getAttribute("data-testid").slice(5), track: row?.getAttribute("data-testid") ?? "", x: rect.left, y: rect.top, width: rect.width, height: rect.height, selected: node.querySelector('[data-testid="clip-selection"]') !== null };
}).sort((a, b) => a.y - b.y || a.x - b.x));
/** The preview canvas as pixels, and how much of it differs from an earlier grab. */
const frame = async () => { const box = await tid("canvas").boundingBox(); return page.screenshot({ clip: { x: Math.ceil(box.x) + 2, y: Math.ceil(box.y) + 2, width: Math.floor(box.width) - 4, height: Math.floor(box.height) - 4 } }); };
const difference = (a, b) => page.evaluate(async ([first, second]) => {
  const load = async (data) => { const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob()); const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context2d = canvas.getContext("2d"); context2d.drawImage(bitmap, 0, 0); return context2d.getImageData(0, 0, bitmap.width, bitmap.height); };
  const one = await load(first), two = await load(second);
  if (one.width !== two.width || one.height !== two.height) return 1;
  let changed = 0;
  for (let index = 0; index < one.data.length; index += 4) if (Math.abs(one.data[index] - two.data[index]) + Math.abs(one.data[index + 1] - two.data[index + 1]) + Math.abs(one.data[index + 2] - two.data[index + 2]) > 24) changed++;
  return changed / (one.data.length / 4);
}, [a.toString("base64"), b.toString("base64")]);
const settle = () => wait(700);
/** Scrolls the timeline so the playhead is at a time: a finger drags the lanes by the distance of the difference. */
const seekTo = async (target) => {
  for (let attempt = 0; attempt < 6; attempt++) {
    const state = await view(), now = state.scroll / state.pps;
    if (Math.abs(now - target) < 0.005) break;
    // On the ruler: a toast may lie over the lower lanes.
    const y = state.box.y + 9, distance = Math.max(-300, Math.min(300, (target - now) * state.pps)), from = { x: state.box.x + state.box.width / 2 + distance / 2, y };
    // The first 8 pt of travel start the drag; they are added so the lanes move by the whole distance.
    // A short correction would not leave the 8 pt a drag starts with: the finger goes out and comes back to the same net distance.
    if (Math.abs(distance) < 40) { const out = { x: from.x + 70, y }; await touch("touchStart", [from]); for (let index = 1; index <= 6; index++) { await touch("touchMove", [{ x: from.x + (70 * index) / 6, y }]); await wait(16); } for (let index = 1; index <= 8; index++) { await touch("touchMove", [{ x: out.x + ((from.x - distance - out.x) * index) / 8, y }]); await wait(16); } await wait(260); await touch("touchEnd", []); await wait(200); }
    else await swipe(from, { x: from.x - distance, y }, { steps: 14, rest: 260 });
  }
  await wait(250);
};
const tool = (id) => tid(`tool-${id}`);
// The tool sheet slides down and leaves the tree when the slide ends; the toolbar returns only then. Both waits are bounded:
// a sheet that stays, or a toolbar that never comes back, fails the check that follows.
const sheetGone = () => page.getByTestId("tool-sheet-slot").first().waitFor({ state: "detached", timeout: 4000 }).catch(() => undefined);
const toolbarBack = async () => { if ((await page.getByTestId("tool-sheet").count()) === 0) await page.getByTestId("compact-toolbar").first().waitFor({ timeout: 4000 }).catch(() => undefined); };
const strip = async () => (await toolbarBack(), page.evaluate(() => [...document.querySelectorAll('[data-testid="compact-toolbar"] [data-testid^="tool-"]')].map((node) => node.getAttribute("data-testid").slice(5)).filter((id) => id !== "back")));
/** Taps a tool of the strip, scrolling the strip to it first. */
const useTool = async (id) => { const node = tool(id); await node.scrollIntoViewIfNeeded(); await wait(120); await tap(node); await wait(250); };
const closeSheet = async () => { if (await page.getByTestId("tool-sheet-close").count()) { await tap(tid("tool-sheet-close")); await wait(250); await sheetGone(); } };
const toastText = () => page.evaluate(() => [...document.querySelectorAll('[role="status"], [role="alert"]')].map((node) => node.textContent ?? "").join(" | "));
// The sheet slides in: its items are tapped once it has come to rest.
const pickMedia = async (name) => { await tid("media-sheet").waitFor({ timeout: 20_000 }); await tid(`thumb-${name}`).waitFor({ timeout: 60_000 }).catch(() => undefined); await wait(600); await tap(tid(`label-${name}`)); await wait(600); };
const selectClipAt = async (index) => { const main = (await clips()).filter((clip) => clip.track === "track-main-video"), clip = main[index], box = (await view()).box; await tap({ x: Math.min(box.x + box.width - 30, Math.max(box.x + 130, clip.x + clip.width / 2)), y: clip.y + clip.height / 2 }); await wait(200); return clip; };
const report = { viewport: `${width}x${height}`, tools: [], comparisons: [] };

await step("Region order — the five regions of the phone layout, none over another, the preview at least 35 % of the screen", async () => {
  await page.goto(`${base}/projects`, { waitUntil: "networkidle", timeout: 240_000 });
  await tap(visible(page.getByRole("button", { name: "Create your first project", exact: true })));
  await page.waitForURL(/\/editor\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  for (const id of ["editor-bar", "compact-preview", "transport-row", "compact-timeline", "compact-toolbar"]) await tid(id).waitFor({ timeout: 60_000 });
  const boxes = [];
  for (const id of ["editor-bar", "compact-preview", "transport-row", "compact-timeline-region", "compact-toolbar"]) boxes.push({ id, ...(await tid(id).boundingBox()) });
  for (let index = 1; index < boxes.length; index++) expect(boxes[index].y >= boxes[index - 1].y + boxes[index - 1].height - 0.5, `${boxes[index].id} starts under ${boxes[index - 1].id}: ${JSON.stringify(boxes.map((box) => [box.id, Math.round(box.y), Math.round(box.height)]))}`);
  expect(near(boxes[0].height, 45, 1.5), `the top bar is 44 pt: ${boxes[0].height}`);
  expect(boxes[1].height >= Math.floor(height * 0.35), `the preview keeps 35 % of the screen: ${boxes[1].height} of ${height}`);
  expect(near(boxes[2].height, 40, 1), `the transport row is 40 pt: ${boxes[2].height}`);
  expect(near(boxes[4].height, 64, 1) && near(boxes[4].y + boxes[4].height, height, 1), `the toolbar is 64 pt at the bottom edge: ${JSON.stringify(boxes[4])}`);
  // No wide-layout region is drawn.
  for (const id of ["asset-panel", "inspector", "timeline-toolbar", "player-bar", "track-headers"]) expect((await page.getByTestId(id).count()) === 0, `${id} of the wide layout is not drawn`);
  await tid("canvas").waitFor();
  await wait(1500);
});

await step("Empty project and Empty history — a full-width Add media button, no +, Undo and Redo disabled, the root toolbar in order", async () => {
  await tid("tl-ctl-add-media").waitFor();
  expect((await page.getByTestId("tl-ctl-add-clip").count()) === 0, "no + button in an empty project");
  expect(await tid("bar-undo").isDisabled() && await tid("bar-redo").isDisabled(), "Undo and Redo are disabled before any edit");
  expect(await tid("player-play").isDisabled(), "Play is disabled in an empty scene");
  const root = await strip();
  expect(root.join(",") === "root.edit,root.audio,root.text,root.stickers,root.overlay,root.effects,root.filters,root.captions,root.ratio,root.background,root.media,root.markers,root.more", `the root toolbar: ${root}`);
  await useTool("root.edit");
  expect((await toastText()).includes("Add media first"), `Edit with an empty main track says "Add media first": ${await toastText()}`);
  await shot("01-empty-light");
});

await step("Append — media imported from the device through the picker, two clips added to the main track in order", async () => {
  await tap(tid("tl-ctl-add-media"));
  await tid("media-sheet").waitFor({ timeout: 20_000 });
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), tap(tid("media-dropzone"))]);
  await chooser.setFiles([media("first.mp4"), media("second.mp4"), media("still.png"), media("tone.wav")]);
  for (const name of ["first.mp4", "second.mp4", "still.png", "tone.wav"]) await tid(`label-${name}`).waitFor({ timeout: 90_000 });
  await shot("02-media-picker");
  await pickMedia("first.mp4");
  await until(async () => (await mainOf()).length === 1, "the first clip is on the main track");
  await tid("tl-ctl-add-clip").waitFor();
  expect((await page.getByTestId("tl-ctl-add-media").count()) === 0, "the Add media button gives way to +");
  let main = await mainOf();
  expect(main.length === 1 && main[0].duration === 4 * T, `one 4 s clip on the main track: ${JSON.stringify(main.map((element) => element.duration / T))}`);
  // The playhead at the end: the second clip is appended.
  await seekTo(4);
  expect((await view()).scroll === 4 * (await view()).pps, `the playhead is at the end of the clip: ${(await view()).scroll}`);
  await tap(tid("tl-ctl-add-clip"));
  await pickMedia("second.mp4");
  await until(async () => (await mainOf()).length === 2, "the second clip is on the main track");
  main = await mainOf();
  expect(main.length === 2 && main[1].startTime === 4 * T && main[1].duration === 3 * T, `the second clip follows the first: ${JSON.stringify(main.map((element) => [element.startTime / T, element.duration / T]))}`);
  expect((await seconds()).total === 7, `the scene is 7 s long: ${JSON.stringify(await seconds())}`);
  await tap({ x: 20, y: (await view()).box.y + (await view()).box.height - 8 });
  await shot("03-two-clips");
});

await step("Scroll seeks and Ends reachable — dragging the lanes moves the playhead by the same time and the preview shows that frame", async () => {
  await seekTo(1);
  expect((await seconds()).now === 1, `the playhead is at 1 s: ${JSON.stringify(await seconds())}`);
  await settle();
  // Fingers go on the ruler: a toast may lie over the lower lanes for a few seconds.
  const before = await frame(), state = await view(), y = state.box.y + 9;
  // 2 s to the left at this zoom.
  await swipe({ x: 300, y }, { x: 300 - 2 * state.pps, y }, { steps: 16, rest: 260 });
  const after = await view();
  expect(near(after.scroll, state.scroll + 2 * state.pps, 10), `the lanes moved by 2 s: ${state.scroll} → ${after.scroll}`);
  expect((await seconds()).now === 3, `the playhead time rose by 2 s: ${JSON.stringify(await seconds())}`);
  await settle();
  expect((await difference(before, await frame())) > 0.02, "the preview shows another frame");
  // Fully to the right: the playhead is exactly at 0 and cannot go before it.
  await swipe({ x: 40, y }, { x: 380, y }, { steps: 10, rest: 260 });
  await swipe({ x: 40, y }, { x: 380, y }, { steps: 10, rest: 260 });
  const start = await view();
  expect(start.scroll === 0 && (await seconds()).now === 0, `the start of the scene is under the playhead: ${start.scroll}`);
  const playhead = await tid("playhead").boundingBox();
  expect(near(playhead.x + playhead.width / 2, start.box.x + start.box.width / 2, 1), "the playhead is the fixed line at the centre");
  // A flick keeps scrolling after the finger lifts, and a touch stops it.
  await swipe({ x: 300, y }, { x: 200, y }, { steps: 4, rest: 0 });
  await wait(500);
  expect((await view()).scroll > 100, `a flick carries on by inertia: ${(await view()).scroll}`);
});

await step("Touch pauses — playback advances the lanes under the playhead and a finger on the timeline pauses it", async () => {
  await seekTo(0.5);
  await tap(tid("player-play"));
  await page.getByRole("button", { name: "Pause", exact: true }).first().waitFor({ timeout: 5000 });
  await wait(900);
  const during = await view();
  expect(during.scroll > 0.5 * during.pps + 10, `the lanes scroll with playback: ${during.scroll}`);
  await tap({ x: 30, y: during.box.y + during.box.height - 10 });
  await page.getByRole("button", { name: "Play", exact: true }).first().waitFor({ timeout: 5000 });
  const paused = (await view()).scroll;
  await wait(400);
  expect((await view()).scroll === paused, "pause holds the playhead");
});

await step("Zoom keeps the playhead time and Maximum zoom — a pinch zooms about the playhead up to 24 pt per frame, where the ruler reads frames", async () => {
  await seekTo(2);
  const state = await view(), centre = { x: state.box.x + state.box.width / 2, y: state.box.y + state.box.height - 30 };
  const widthBefore = (await clips())[0].width;
  await pinch(centre, 80, 200);
  const zoomed = await view();
  expect(zoomed.zoom > state.zoom * 2 && zoomed.zoom < state.zoom * 3, `the zoom follows the fingers: ${state.zoom} → ${zoomed.zoom}`);
  expect((await seconds()).now === 2 && near(zoomed.scroll, 2 * zoomed.pps, 2), `the playhead is still at 2 s: ${zoomed.scroll / zoomed.pps}`);
  expect((await clips())[0].width > widthBefore * 2, "the clips are wider");
  for (let index = 0; index < 4; index++) await pinch(centre, 40, 330);
  const most = await view();
  expect(near(most.zoom, (24 * 30) / 50, 0.01), `the zoom stops at 24 pt per frame: ${most.zoom}`);
  expect(/\d+f/.test(await tid("timeline-ruler").innerText()), `the ruler shows frame labels: ${(await tid("timeline-ruler").innerText()).replace(/\s+/g, " ")}`);
  await shot("04-max-zoom");
  for (let index = 0; index < 5; index++) await pinch(centre, 330, 40);
  const least = await view();
  expect(least.zoom <= 1 && least.zoom >= 2 / 50, `the zoom stops where the scene fits: ${least.zoom}`);
  expect((await seconds()).now === 2, "the playhead stayed at 2 s through every pinch");
  const zoomStored = (await stored()).local?.timelineViewState?.zoomLevel;
  expect(near(zoomStored, least.zoom, 0.001), `the zoom is kept with the project on this device: ${zoomStored}`);
});

await step("Two-finger tap does nothing to history — and Edit selects the clip under the playhead", async () => {
  const before = (await mainOf()).length, preview = await tid("compact-preview").boundingBox();
  await touch("touchStart", [{ x: preview.x + 120, y: preview.y + 150 }]); await touch("touchStart", [{ x: preview.x + 120, y: preview.y + 150 }, { x: preview.x + 220, y: preview.y + 150 }]); await wait(40); await touch("touchEnd", []);
  await wait(200);
  expect((await mainOf()).length === before && !(await tid("bar-redo").isEnabled()), "a two-finger tap on the preview changes nothing");
  await tap({ x: 30, y: (await view()).box.y + (await view()).box.height - 10 });
  await useTool("root.edit");
  const main = (await clips()).filter((clip) => clip.track === "track-main-video");
  expect(main[0].selected && !main[1].selected, "Edit selects the main-track clip under the playhead");
  const tools = await strip();
  expect(tools[0] === "clip.split" && tools.includes("clip.speed") && tools.includes("clip.volume") && tools.includes("clip.delete") && !tools.includes("clip.to-main"), `the video clip strip: ${tools}`);
  expect((await tid("compact-timeline").innerText()).includes("4.0s"), "the selected clip reads its length");
  expect((await page.getByTestId("trim-handle-start").count()) === 1 && (await page.getByTestId("trim-handle-end").count()) === 1, "the selected clip shows its two trim handles");
  const handle = await tid("trim-handle-end").boundingBox();
  expect(near(handle.width, 20, 0.5), `a trim handle is 20 pt wide: ${handle.width}`);
  await shot("05-clip-selected");
});

await step("Undo toast — Split cuts the selected clip at the playhead; Undo names the step, Redo brings it back", async () => {
  await useTool("clip.split");
  let main = await mainOf();
  expect(main.length === 3 && main[0].duration === 2 * T && main[1].duration === 2 * T && main[2].duration === 3 * T, `2 s + 2 s + 3 s: ${main.map((element) => element.duration / T)}`);
  await tap(tid("bar-undo"));
  await wait(300);
  expect((await toastText()).includes("Undo: Split"), `the toast names the undone step: ${await toastText()}`);
  expect((await mainOf()).length === 2, "the split is undone");
  await tap(tid("bar-redo"));
  await wait(300);
  expect((await toastText()).includes("Redo: Split"), `the toast names the redone step: ${await toastText()}`);
  main = await mainOf();
  expect(main.length === 3 && contiguous(main), "the split is back");
});

await step("Selection swaps the strip — the back button deselects and returns to the root toolbar; a tap on empty lane space deselects without seeking", async () => {
  await selectClipAt(0);
  expect((await page.getByTestId("tool-back").count()) === 1 && (await strip())[0].startsWith("clip."), "a selection shows its strip with the back button");
  await tap(tid("tool-back"));
  expect((await strip())[0] === "root.edit" && (await clips()).every((clip) => !clip.selected), "back deselects and shows the root toolbar");
  await selectClipAt(1);
  expect((await clips()).some((clip) => clip.selected), "a tap selects a clip");
  const before = (await view()).scroll, box = (await view()).box;
  await tap({ x: box.x + 60, y: box.y + box.height - 20 });
  expect((await clips()).every((clip) => !clip.selected) && (await view()).scroll === before, "a tap on empty space deselects and does not seek");
});

await step("Trim the end and Source limit — dragging the end handle shortens the clip; past the source it stops at the source end", async () => {
  await seekTo(5.5);
  const state = await view(), last = (await clips()).filter((clip) => clip.track === "track-main-video")[2];
  await tap({ x: last.x + last.width / 2, y: last.y + last.height / 2 });
  expect((await clips()).find((clip) => clip.id === last.id).selected && (await tid("compact-timeline").innerText()).includes("3.0s"), "the last clip is selected and reads 3.0s");
  const edge = { x: last.x + last.width - 8, y: last.y + last.height / 2 };
  let tooltip = "";
  await swipe(edge, { x: edge.x - state.pps, y: edge.y }, { steps: 12, during: async () => { tooltip = await tid("trim-tooltip").innerText().catch(() => ""); } });
  let main = await mainOf();
  expect(main[2].duration === 2 * T, `the clip is 2 s long: ${main[2].duration / T} (tooltip "${tooltip}")`);
  expect(tooltip.includes("00:02.0"), `the tooltip reads the new length while dragging: "${tooltip}"`);
  expect((await seconds()).total === 6 && (await tid("compact-timeline").innerText()).includes("2.0s"), "the scene ends at 6 s and the badge reads 2.0s");
  // Past the end of the source: the edge stops there.
  const shorter = (await clips()).find((clip) => clip.id === last.id), end = { x: shorter.x + shorter.width - 8, y: shorter.y + shorter.height / 2 };
  await swipe(end, { x: end.x + 2.5 * state.pps, y: end.y }, { steps: 14 });
  main = await mainOf();
  expect(main[2].duration === 3 * T, `the edge stops at the source end: ${main[2].duration / T}`);
  // The start handle trims the other edge, and the clips after it stay edge to edge.
  await seekTo(0.5);
  const first = (await clips()).filter((clip) => clip.track === "track-main-video")[0];
  await tap({ x: first.x + first.width / 2 + 20, y: first.y + first.height / 2 });
  const head = (await clips()).find((clip) => clip.id === first.id), from = { x: head.x + 8, y: head.y + head.height / 2 };
  await swipe(from, { x: from.x + 0.5 * state.pps, y: from.y }, { steps: 10 });
  main = await mainOf();
  expect(main[0].duration === 1.5 * T && main[0].trimStart === 0.5 * T && contiguous(main), `the start is trimmed by 0.5 s and the track stays closed: ${JSON.stringify(main.map((element) => [element.startTime / T, element.duration / T]))}`);
  await tap(tid("bar-undo"));
  expect((await mainOf())[0].duration === 2 * T, "one undo restores the trimmed start");
  await tap(tid("tool-back"));
});

await step("Long press reached and Reorder — a held clip is picked up and dropped after the next one; one undo restores the order", async () => {
  await seekTo(2);
  const before = await mainOf(), main = (await clips()).filter((clip) => clip.track === "track-main-video"), state = await view();
  const from = { x: main[0].x + main[0].width - 30, y: main[0].y + main[0].height / 2 };
  // 390 ms and a lift is a tap: the clip is selected and nothing moves.
  await touch("touchStart", [from]); await wait(300); await touch("touchEnd", []); await wait(200);
  expect((await mainOf()).map((element) => element.id).join() === before.map((element) => element.id).join(), "a short hold does not pick the clip up");
  // Reorder mode: every main-track clip is a 56 pt tile, the held one under the finger, the others making room.
  let tiles = null;
  await swipe(from, { x: from.x + 3.2 * state.pps, y: from.y }, { hold: 520, steps: 18, during: async () => { tiles = await page.evaluate(() => ({ held: [...document.querySelectorAll('[data-testid="reorder-tile-held"]')].map((node) => { const rect = node.getBoundingClientRect(); return [Math.round(rect.width), Math.round(rect.height), node.getAttribute("data-slot")]; }), others: [...document.querySelectorAll('[data-testid="reorder-tile"]')].map((node) => node.getAttribute("data-slot")), clips: document.querySelectorAll('[data-testid="track-main-video"] [data-testid^="clip-"]').length })); } });
  expect(tiles && tiles.held.length === 1 && tiles.held[0][0] === 56 && tiles.held[0][1] === 56 && tiles.others.length === 2 && tiles.clips === 0, `while held the clips are 56 pt tiles: ${JSON.stringify(tiles)}`);
  expect(tiles.held[0][2] === "2" && tiles.others.join() === "0,1", `the other tiles make room where the held one would drop: ${JSON.stringify(tiles)}`);
  expect((await page.getByTestId("reorder-tiles").count()) === 0, "the tiles are gone when the finger lifts");
  const after = await mainOf();
  expect(after.length === 3 && contiguous(after) && after.map((element) => element.id).join() === [before[1].id, before[2].id, before[0].id].join(), `the order is 2, 3, 1: ${before.map((element) => element.id.slice(0, 4))} → ${after.map((element) => element.id.slice(0, 4))}`);
  await tap(tid("bar-undo"));
  expect((await mainOf()).map((element) => element.id).join() === before.map((element) => element.id).join(), "one undo restores the order");
  if ((await page.getByTestId("tool-back").count()) > 0) await tap(tid("tool-back"));
});

await step("Delete closes the gap — Delete of the strip removes the clip, the next one moves up; Undo and Redo", async () => {
  await seekTo(3);
  await useTool("root.edit");
  const before = await mainOf();
  await useTool("clip.delete");
  let main = await mainOf();
  expect(main.length === 2 && contiguous(main) && main[1].id === before[2].id, `the third clip touches the first: ${JSON.stringify(main.map((element) => [element.startTime / T, element.duration / T]))}`);
  expect((await strip())[0] === "root.edit", "with nothing selected the root toolbar is back");
  await tap(tid("bar-undo"));
  expect((await mainOf()).length === 3, "Undo restores the clip");
  await tap(tid("bar-redo"));
  main = await mainOf();
  expect(main.length === 2 && (await seconds()).total === 5, "Redo deletes it again: the scene is 5 s");
  await shot("06-after-edits");
});

// — Every tool of the bottom toolbar that has a feature behind it: opened, one value changed, the stored project and the frame read —
const located = async (id) => { const now = await scene(); for (const track of [...now.tracks.overlay, now.tracks.main, ...now.tracks.audio]) { const element = track.elements.find((entry) => entry.id === id); if (element) return { element, track, scene: now }; } return { element: null, track: null, scene: now }; };
const sheetIds = () => page.evaluate(() => [...new Set([...document.querySelectorAll('[data-testid="tool-sheet"] [data-testid], [role="dialog"] [data-testid], [role="menu"] [data-testid]')].map((node) => node.getAttribute("data-testid")))].slice(0, 90).join(" "));
const typeInto = async (input, value) => { await input.scrollIntoViewIfNeeded(); await input.tap(); await input.fill(String(value)); await input.press("Enter"); await wait(450); };
const typeNumber = (id, value) => typeInto(tid(id).locator('input:not([type="range"])').first(), value);
const fieldByLabel = (label) => visible(page.locator(`[data-testid="tool-sheet"] input[aria-label="${label}"]:not([type="range"])`));
/** A sheet is open: the preview keeps 35 % of the screen and the 48 pt timeline stays above the sheet, under the transport row. */
const sheetRules = async (title) => {
  await tid("tool-sheet").waitFor({ timeout: 10_000 });
  // The sheet rises from the bottom edge: its place is measured once the slide has ended.
  await page.locator('[data-testid="tool-sheet-slot"][data-settled="true"]').first().waitFor({ timeout: 4000 }).catch(() => undefined);
  if (title) expect((await tid("tool-sheet-title").innerText()).trim() === title, `the sheet is titled ${title}: ${await tid("tool-sheet-title").innerText()}`);
  const preview = await tid("compact-preview").boundingBox(), small = await tid("compact-timeline-region").boundingBox(), sheet = await tid("tool-sheet").boundingBox(), transport = await tid("transport-row").boundingBox();
  expect(preview.height >= Math.floor(height * 0.35), `the preview keeps 35 % with a sheet open: ${preview.height}`);
  expect(near(small.height, 48, 1) && small.y >= transport.y + transport.height - 0.5 && sheet.y >= small.y + small.height - 0.5, `the 48 pt timeline sits between the transport row and the sheet: ${JSON.stringify([transport.y, small.y, small.height, sheet.y])}`);
  expect(near(sheet.y + sheet.height, height, 1) && (await page.getByTestId("compact-toolbar").count()) === 0, "the sheet takes the place of the toolbar");
};
const toRoot = async () => { await closeSheet(); await toolbarBack(); for (let index = 0; index < 3 && (await page.getByTestId("tool-back").count()) > 0; index++) await tap(tid("tool-back")); await wait(150); };
const tracksOf = async (type) => { const now = await scene(); return [...now.tracks.overlay, ...now.tracks.audio].filter((track) => track.type === type); };
const record = (toolId, state, note) => report.tools.push({ tool: toolId, state, ...(note ? { note } : {}) });
let target = "";
/** One tool: open it, change one value, compare the stored element and (for a picture change) the frame; then undo the change. */
const sweep = async (id, options) => {
  await step(`tool ${id} — ${options.what}`, async () => {
    const read = async () => JSON.stringify(options.read(await located(target)));
    await settle();
    const before = await read(), frameBefore = await frame();
    await useTool(id);
    if (options.sheet !== false) await sheetRules(options.sheet);
    try { await options.change(); } catch (error) { console.log("      sheet ids:", await sheetIds()); throw error; }
    const after = await read();
    expect(after !== before, `the stored project changed: ${before} → ${after}`);
    let changed = null;
    if (options.frame !== false) { await settle(); changed = await difference(frameBefore, await frame()); expect(changed > (options.threshold ?? 0.01), `the rendered frame changed: ${changed}`); }
    if (options.shot) await shot(options.shot);
    await closeSheet();
    report.tools.push({ tool: id, state: "works e2e", stored: `${before.slice(0, 60)} → ${after.slice(0, 60)}`, frame: changed === null ? "not a picture change" : Number(changed.toFixed(3)) });
    if (options.undo !== false) { await tap(tid("bar-undo")); await wait(250); expect((await read()) === before, `Undo restores it: ${await read()}`); }
  });
};

if (!smoke) {
  await step("the video clip strip lists the tools of the selected clip", async () => {
    await seekTo(1);
    await useTool("root.edit");
    target = (await mainOf())[0].id;
    const tools = await strip();
    report.clipStrip = tools;
    for (const id of ["clip.split", "clip.transform", "clip.cutout", "clip.mask", "clip.volume", "clip.speed", "clip.animation", "clip.adjust", "clip.effect-list", "clip.delete", "clip.duplicate", "clip.replace", "clip.mirror", "clip.rotate", "clip.crop", "clip.filter", "clip.effects", "clip.reverse", "clip.freeze", "clip.extract-audio", "clip.mute", "clip.to-overlay", "clip.compound", "clip.copy", "clip.cut", "clip.hide", "clip.deactivate", "clip.rename", "clip.layers"]) expect(tools.includes(id), `${id} is in the strip: ${tools}`);
    for (const id of ["clip.to-main", "clip.unlink", "clip.ungroup", "clip.graph"]) expect(!tools.includes(id), `${id} does not apply and is not shown`);
  });
  await step("tool clip.freeze, clip.extract-audio, clip.compound, clip.to-overlay / clip.to-main (To overlay scenario)", async () => {
    await toRoot(); await seekTo(1); await useTool("root.edit");
    target = (await mainOf())[0].id;
    let before = (await mainOf()).length;
    await useTool("clip.freeze");
    expect((await mainOf()).length > before && (await mainOf()).some((element) => element.freeze), `a freeze frame is inserted: ${(await mainOf()).length}`);
    await tap(tid("bar-undo")); await wait(200);
    await toRoot(); await seekTo(1); await useTool("root.edit");
    await useTool("clip.extract-audio");
    let audio = await tracksOf("audio");
    expect(audio.flatMap((track) => track.elements).length === 1 && (await located(target)).element.isSourceAudioEnabled === false, "the clip's sound is on an audio track and off in the clip");
    expect((await strip()).length > 0, "a strip is shown for the selection");
    await tap(tid("bar-undo")); await wait(200);
    await toRoot(); await seekTo(1); await useTool("root.edit");
    await useTool("clip.compound");
    expect((await mainOf())[0].type === "compound", `the clip is a compound clip: ${(await mainOf())[0].type}`);
    const compoundStrip = await strip();
    expect(compoundStrip[0] === "clip.compound-edit" && compoundStrip[1] === "clip.compound-dissolve", `the compound strip starts with Edit compound, Undo compound: ${compoundStrip.slice(0, 4)}`);
    // Enter and exit: the compound's own scene with the breadcrumb above the ruler, then back with the way out of the transport row.
    await useTool("clip.compound-edit");
    await tid("compound-breadcrumb").waitFor({ timeout: 5000 });
    expect((await tid("compound-breadcrumb").innerText()).includes("›") && (await page.getByTestId("transport-fullscreen").count()) === 0, `the breadcrumb names the scenes entered: ${await tid("compound-breadcrumb").innerText()}`);
    expect((await clips()).filter((clip) => clip.track === "track-main-video").length === 1 && (await seconds()).total === 2, `the timeline shows the compound's scene: ${JSON.stringify(await seconds())}`);
    await shot("11a-inside-compound");
    await tap(tid("compound-exit"));
    await wait(300);
    expect((await page.getByTestId("compound-breadcrumb").count()) === 0 && (await seconds()).total === 5, "Exit compound returns to the parent scene");
    await toRoot(); await seekTo(1); await useTool("root.edit");
    await useTool("clip.compound-dissolve");
    expect((await mainOf())[0].type === "video", "Undo compound dissolves it");
    await tap(tid("bar-undo")); await tap(tid("bar-undo")); await wait(200);
    await toRoot(); await seekTo(1); await useTool("root.edit");
    before = (await mainOf()).length;
    await useTool("clip.to-overlay");
    const moved = await located(target);
    expect((await mainOf()).length === before - 1 && contiguous(await mainOf()) && moved.track.type === "video" && moved.scene.tracks.overlay.some((track) => track.id === moved.track.id), "the clip is on an overlay track and the main track closed its gap");
    const overlayStrip = await strip();
    expect(overlayStrip.includes("clip.to-main") && !overlayStrip.includes("clip.to-overlay"), `an overlay clip offers To main track and not To overlay: ${overlayStrip}`);
    expect((await page.getByTestId("track-overlay-video").count()) === 1 && (await page.getByTestId("tl-ctl-lane-video").count()) === 1, "the overlay lane is drawn in full with its lane label while its clip is selected");
    await shot("11-overlay-lane");
    await useTool("clip.to-main");
    expect((await mainOf()).length === before && contiguous(await mainOf()), "To main track inserts it back");
    await tap(tid("bar-undo")); await tap(tid("bar-undo")); await wait(200);
    expect((await mainOf()).length === before && (await mainOf())[0].id === target, "two undos restore the main track");
    for (const id of ["clip.freeze", "clip.extract-audio", "clip.compound", "clip.compound-dissolve", "clip.to-overlay", "clip.to-main"]) record(id, "works e2e");
    record("clip.compound-edit", "works e2e"); record("compound exit", "works e2e");
  });
  await step("select the clip again for the sheets", async () => { await toRoot(); await seekTo(1); await useTool("root.edit"); target = (await mainOf())[0].id; });
  await sweep("clip.transform", { what: "Transform: scale 50 %", sheet: "Transform", shot: "10-sheet-transform", change: () => typeInto(fieldByLabel("Scale"), 50), read: ({ element }) => element.transform.scale });
  await sweep("clip.cutout", { what: "Remove BG: chroma key on", sheet: "Remove BG", change: async () => { await tap(tid("chroma-section").getByRole("switch").first()); await wait(400); }, read: ({ element }) => element.chromaKey ?? null, frame: false });
  await sweep("clip.mask", { what: "Mask: add a mask", sheet: "Mask", change: async () => { await tap(tid("mask-add")); await wait(400); if (await page.locator('[role^="menuitem"]').count()) await tap(visible(page.locator('[role^="menuitem"]'))); await wait(400); }, read: ({ element }) => (element.masks ?? []).length });
  await sweep("clip.volume", { what: "Volume: −12 dB", sheet: "Volume", change: () => typeNumber("audio-volume", -12), read: ({ element }) => element.volume ?? 0, frame: false });
  await sweep("clip.speed", { what: "Speed: 2×", sheet: "Speed", change: () => typeNumber("speed-field", 2), read: ({ element }) => [element.retime?.rate ?? 1, element.duration] });
  await sweep("clip.mirror", { what: "Mirror", sheet: false, change: async () => {}, read: ({ element }) => element.flip });
  await sweep("clip.rotate", { what: "Rotate 90°", sheet: false, change: async () => {}, read: ({ element }) => element.transform.rotation });
  await sweep("clip.reverse", { what: "Reverse", sheet: false, change: async () => {}, read: ({ element }) => element.retime?.reverse ?? false });
  await sweep("clip.mute", { what: "Mute", sheet: false, change: async () => {}, read: ({ element }) => element.muted ?? false, frame: false });
  await sweep("clip.hide", { what: "Hide", sheet: false, change: async () => {}, read: ({ element }) => element.hidden ?? false });
  await sweep("clip.deactivate", { what: "Deactivate (hidden and muted)", sheet: false, change: async () => {}, read: ({ element }) => [element.hidden ?? false, element.muted ?? false] });
  await sweep("clip.animation", { what: "Animations: an In animation", sheet: "Animations", change: async () => { const tile = visible(page.locator('[data-testid^="clip-animation-in-"]:not([data-testid$="-none"])')); await tile.scrollIntoViewIfNeeded(); await tap(tile); await wait(500); }, read: ({ element }) => element.clipAnimation ?? element.animation ?? Object.keys(element).filter((key) => /nimation/.test(key)).map((key) => element[key]), frame: false });
  await sweep("clip.adjust", { what: "Adjust: a slider of the Basic section", sheet: "Adjust", change: async () => { const input = visible(page.locator('[data-testid="tool-sheet"] [data-testid^="adjust-"] input:not([type="range"])')); await typeInto(input, 60); }, read: ({ element }) => element.adjustments ?? null });
  await sweep("clip.effects", { what: "Effects: a library effect on the clip", sheet: "Effects", undo: false, change: async () => { await page.waitForFunction(() => document.querySelectorAll('[data-testid^="fx-tile-effect-"]').length >= 3, null, { timeout: 60_000 }); const tile = visible(page.locator('[data-testid^="fx-tile-effect-"] [role="button"]')); await tap(tile); await wait(600); }, read: ({ element }) => (element.effects ?? []).map((entry) => [entry.type, entry.enabled !== false]) });
  await sweep("clip.effect-list", { what: "Effect settings: the effect switched off", sheet: "Effect settings", change: async () => { await tap(tid("effect-toggle")); await wait(400); }, read: ({ element }) => (element.effects ?? []).map((entry) => [entry.type, entry.enabled !== false]) });
  await sweep("clip.filter", { what: "Filters: a filter on the clip", sheet: "Filters", change: async () => { await page.waitForFunction(() => document.querySelectorAll('[data-testid^="fx-tile-filter-"]').length >= 3, null, { timeout: 60_000 }); await tap(visible(page.locator('[data-testid^="fx-tile-filter-"] [role="button"]'))); await wait(600); }, read: ({ element }) => (element.effects ?? []).map((entry) => entry.type) });
  await sweep("clip.crop", { what: "Crop: 20 % off the left", sheet: "Crop", change: async () => { await tid("crop-fields").waitFor(); await typeInto(fieldByLabel("Left"), 20); await tap(tid("crop-apply")); }, read: ({ element }) => element.crop ?? null });
  await sweep("clip.rename", { what: "Rename", sheet: false, frame: false, change: async () => { const input = visible(page.locator('[role="dialog"] input')); await input.fill("Opening shot"); await tap(visible(page.locator('[role="dialog"]').getByRole("button", { name: "Rename", exact: true }))); await wait(400); }, read: ({ element }) => element.name });
  // The preview redraws with the new media (it kept the old picture until the video texture was keyed by its asset).
  await sweep("clip.replace", { what: "Replace media — the preview shows the new media", sheet: false, change: async () => { await tid("replace-list").waitFor(); await tap(visible(tid("replace-list").getByText("second.mp4"))); await wait(1500); }, read: ({ element }) => element.mediaId });
  await step("Freeze frame of a clip that has an effect — the freeze is inserted with ids of its own", async () => {
    expect(((await located(target)).element.effects ?? []).length === 1, "the clip carries the effect added above");
    const before = (await mainOf()).length;
    await useTool("clip.freeze");
    const main = await mainOf();
    expect(main.length === before + 2 && main.some((element) => element.freeze) && !(await toastText()).includes("used by two"), `split around a freeze element: ${before} → ${main.length} ${await toastText()}`);
    const ids = main.flatMap((element) => (element.effects ?? []).map((entry) => entry.id));
    expect(new Set(ids).size === ids.length && ids.length === 3, `every copy of the effect has its own id: ${ids.length} / ${new Set(ids).size}`);
    await tap(tid("bar-undo")); await wait(250);
    expect((await mainOf()).length === before, "one undo takes the freeze back");
    await toRoot(); await seekTo(1); await useTool("root.edit");
  });
}

if (!smoke) {
  await step("tool clip.duplicate, clip.copy, root.paste, clip.cut — copies of the clip, and Paste appears first in the root toolbar", async () => {
    const before = (await mainOf()).length;
    await useTool("clip.duplicate");
    expect((await mainOf()).length === before + 1, "Duplicate adds a clip");
    await tap(tid("bar-undo"));
    await useTool("clip.copy");
    await toRoot();
    expect((await strip())[0] === "root.paste", `Paste is the first item once something is copied: ${await strip()}`);
    await useTool("root.paste");
    const pasted = await scene(), count = [...pasted.tracks.overlay, pasted.tracks.main].reduce((sum, track) => sum + track.elements.length, 0);
    expect(count === before + 1, `Paste inserts a copy at the playhead: ${count}`);
    await tap(tid("bar-undo"));
    await toRoot(); await seekTo(1); await useTool("root.edit");
    await useTool("clip.cut");
    expect((await mainOf()).length === before - 1 && contiguous(await mainOf()), "Cut removes the clip and the track closes");
    await tap(tid("bar-undo"));
    expect((await mainOf()).length === before, "Undo brings the cut clip back");
    for (const id of ["clip.duplicate", "clip.copy", "root.paste", "clip.cut"]) record(id, "works e2e");
  });

  await step("Add transform keyframes on mobile — the keyframe button writes the Transform group at the playhead; Graph editor opens for a keyed clip", async () => {
    await toRoot(); await seekTo(1); await useTool("root.edit");
    target = (await mainOf())[0].id;
    expect(await tid("transport-keyframe").isEnabled(), "the keyframe button is enabled with the playhead inside the selected clip");
    await tap(tid("transport-keyframe"));
    const keyed = Object.keys((await located(target)).element.animations ?? {}).sort();
    expect(keyed.join() === "transform.position.x,transform.position.y,transform.rotation,transform.scale.x,transform.scale.y", `keys for position, scale and rotation, none for opacity: ${keyed}`);
    expect((await tid("transport-keyframe").getAttribute("aria-label")) === "Remove keyframe", "the button switches to its minus state");
    expect((await strip()).includes("clip.graph"), "a keyed clip offers the graph editor");
    await useTool("clip.graph");
    await sheetRules("Graph editor");
    await tid("graph-sheet").waitFor();
    await shot("12-sheet-graph");
    await closeSheet();
    await tap(tid("bar-undo")); await wait(200);
    expect(Object.keys((await located(target)).element.animations ?? {}).length === 0, "one undo removes all of them");
    record("transport keyframe button", "works e2e"); record("clip.graph", "works e2e", "opened; no curve edited");
  });

  await step("On-canvas — one finger on the preview moves the selected element as one undo step", async () => {
    const canvas = await tid("canvas").boundingBox(), centre = { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 };
    const before = JSON.stringify((await located(target)).element.transform.position);
    await swipe(centre, { x: centre.x + 30, y: centre.y + 70 }, { steps: 10 });
    const after = (await located(target)).element.transform.position;
    expect(JSON.stringify(after) !== before && after.y > 0, `the clip moved with the finger: ${before} → ${JSON.stringify(after)}`);
    await tap(tid("bar-undo")); await wait(200);
    expect(JSON.stringify((await located(target)).element.transform.position) === before, "one undo puts it back");
    record("preview: drag to move", "works e2e");
  });

  await step("On-canvas pinch — two fingers scale the selected element as one undo step; with nothing selected they zoom the preview", async () => {
    const canvas = await tid("canvas").boundingBox(), centre = { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 };
    const before = (await located(target)).element.transform.scale.x;
    await pinch(centre, 60, 120);
    const after = (await located(target)).element.transform.scale.x;
    expect(after / before > 1.6 && after / before < 2.4, `the clip is about twice as large: ${before} → ${after}`);
    await tap(tid("bar-undo")); await wait(250);
    expect((await located(target)).element.transform.scale.x === before, "one undo restores the size");
    await toRoot();
    const width = (await tid("canvas").boundingBox()).width;
    await pinch(centre, 60, 150);
    const zoomed = (await tid("canvas").boundingBox()).width;
    expect(zoomed > width * 1.8, `with nothing selected the preview zooms: ${width} → ${zoomed}`);
    await pinch(centre, 150, 62);
    expect(near((await tid("canvas").boundingBox()).width, width, 1), `pinched back to about its size the preview fits again: ${(await tid("canvas").boundingBox()).width}`);
    expect((await located(target)).element.transform.scale.x === before, "zooming the preview changes nothing in the project");
    await seekTo(1); await useTool("root.edit");
    record("preview: pinch to scale", "works e2e"); record("preview: pinch to zoom", "works e2e");
  });

  await step("Cancel discards, Single undo and Passive sheet closes on preview tap — the header of a tool sheet", async () => {
    const read = async () => { const { element } = await located(target); return JSON.stringify([element.transform.scale.x, element.transform.rotation, element.opacity ?? 1]); };
    const before = await read(), undoLabel = await tid("bar-undo").getAttribute("aria-label"), redoOff = await tid("bar-redo").isDisabled();
    // ✕: what the sheet changed is taken back and no undo step is left.
    await useTool("clip.transform");
    await typeInto(fieldByLabel("Scale"), 40);
    await typeInto(fieldByLabel("Rotation"), 30);
    expect((await read()) !== before, "the sheet's changes are stored while it is open");
    await tap(tid("tool-sheet-cancel")); await wait(300);
    expect((await read()) === before, `Cancel restores what the sheet changed: ${await read()}`);
    expect((await tid("bar-undo").getAttribute("aria-label")) === undoLabel && (await tid("bar-redo").isDisabled()) === redoOff, "the undo history is as it was before the sheet");
    // ✓: three changes are one undo step.
    await useTool("clip.transform");
    await typeInto(fieldByLabel("Scale"), 60);
    await typeInto(fieldByLabel("Rotation"), 15);
    await typeInto(fieldByLabel("Opacity"), 50);
    await tap(tid("tool-sheet-close")); await wait(300);
    expect((await read()) === JSON.stringify([0.6, 15, 0.5]), `the three values are stored: ${await read()}`);
    await tap(tid("bar-undo")); await wait(300);
    expect((await read()) === before, `one Undo returns all three: ${await read()}`);
    expect((await toastText()).includes("Undo: Transform"), `the step is named after the sheet: ${await toastText()}`);
    // A sheet whose tool is not on the preview is put away by a tap on the preview; one whose tool is, keeps the preview's touches.
    await useTool("clip.volume");
    await tid("preview-dismiss").waitFor({ timeout: 5000 });
    const preview = await tid("compact-preview").boundingBox();
    await tap({ x: preview.x + 30, y: preview.y + 30 });
    await sheetGone();
    expect((await page.getByTestId("tool-sheet").count()) === 0 && (await clips()).some((clip) => clip.selected), "a tap on the preview closes the Volume sheet and leaves the selection");
    await useTool("clip.transform");
    expect((await page.getByTestId("preview-dismiss").count()) === 0, "the Transform sheet leaves the preview to its tool");
    const canvas = await tid("canvas").boundingBox(), position = JSON.stringify((await located(target)).element.transform.position);
    await swipe({ x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 }, { x: canvas.x + canvas.width / 2 + 20, y: canvas.y + canvas.height / 2 + 30 }, { steps: 8 });
    expect((await page.getByTestId("tool-sheet").count()) === 1 && JSON.stringify((await located(target)).element.transform.position) !== position, "a drag on the preview moves the element while the sheet stays open");
    await tap(tid("tool-sheet-cancel")); await wait(300);
    expect(JSON.stringify((await located(target)).element.transform.position) === position, "Cancel takes the move back too");
    record("tool sheet: cancel / confirm / preview tap", "works e2e");
  });

  await step("tool clip.layers — the Tracks sheet: lock the main track; a tap on its clip is refused with Track is locked and Unlock", async () => {
    await useTool("clip.layers");
    await sheetRules("Tracks");
    await shot("13-sheet-tracks");
    await tap(tid("track-row-main").getByRole("button", { name: "Lock", exact: true }));
    expect((await scene()).tracks.main.locked === true, "the main track is locked");
    await closeSheet(); await toRoot();
    await selectClipAt(0);
    expect((await clips()).every((clip) => !clip.selected) && (await toastText()).includes("Track is locked"), `a locked clip is not selected: ${await toastText()}`);
    await tap(visible(page.getByRole("button", { name: "Unlock", exact: true })));
    await wait(300);
    expect((await scene()).tracks.main.locked === false, "Unlock of the toast unlocks the track");
    record("clip.layers", "works e2e"); record("Tracks sheet: lock", "works e2e");
  });

  await step("Background applies — root.background sets the project background; root.ratio changes the canvas", async () => {
    await toRoot();
    const before = await stored(), frameBefore = await frame();
    await useTool("root.background");
    const swatches = page.locator('[role="dialog"] [data-testid^="bg-"]');
    await swatches.nth(3).waitFor({ timeout: 10_000 });
    await tap(swatches.nth(3));
    await wait(500);
    await shot("14-project-settings");
    await tap(visible(page.locator('[role="dialog"]').getByRole("button", { name: "Close", exact: true })));
    await wait(500);
    const after = await stored();
    expect(JSON.stringify(after.settings.background) !== JSON.stringify(before.settings.background), `the background changed: ${JSON.stringify(after.settings.background)}`);
    await settle();
    expect((await difference(frameBefore, await frame())) > 0.05, "the preview shows the new background");
    await useTool("root.ratio");
    await tap(tid("ratio-16:9"));
    await wait(500);
    await tap(visible(page.locator('[role="dialog"]').getByRole("button", { name: "Close", exact: true })));
    await wait(500);
    const size = (await stored()).settings.canvasSize;
    expect(size.width === 1920 && size.height === 1080, `the canvas is 16:9: ${JSON.stringify(size)}`);
    const canvas = await tid("canvas").boundingBox();
    expect(near(canvas.width / canvas.height, 16 / 9, 0.03), `the preview is 16:9: ${canvas.width}×${canvas.height}`);
    record("root.background", "works e2e"); record("root.ratio", "works e2e");
  });

  await step("Stickers sheet, Add overlay, Effects group items, Filter with nothing selected — content of the root toolbar lands on its own lanes", async () => {
    await toRoot(); await seekTo(0.5);
    let frameBefore = await frame();
    await useTool("root.stickers");
    await sheetRules("Stickers");
    expect((await page.getByTestId("compact-toolbar").count()) === 0, "Stickers opens a sheet");
    await tap(visible(page.locator('[data-testid^="sticker-emoji-"]')));
    await wait(700);
    await shot("15-sheet-stickers");
    await closeSheet();
    expect((await tracksOf("graphic")).flatMap((track) => track.elements).length === 1, "a sticker is on a graphic track");
    await settle();
    expect((await difference(frameBefore, await frame())) > 0.002, "the sticker is drawn");
    await toRoot();
    await useTool("root.overlay");
    expect((await strip()).join() === "overlay.add", `the Overlay group: ${await strip()}`);
    const mainRow = await tid("track-main-video").boundingBox();
    expect(near(mainRow.height, 28, 1), `in the Overlay group the main track is 28 pt high: ${mainRow.height}`);
    await useTool("overlay.add");
    await pickMedia("still.png");
    await wait(600);
    const overlay = (await tracksOf("video")).flatMap((track) => track.elements);
    expect(overlay.length === 1 && overlay[0].type === "image", `the picture is an overlay clip: ${JSON.stringify(overlay.map((element) => element.type))}`);
    const overlayStrip = await strip();
    expect(overlayStrip.includes("clip.to-main") && !overlayStrip.includes("clip.to-overlay") && !overlayStrip.includes("clip.speed") && !overlayStrip.includes("clip.volume"), `the strip of an overlay picture: ${overlayStrip}`);
    await toRoot();
    await useTool("root.effects");
    expect((await strip()).join() === "fx.video", `the Effects group: ${await strip()}`);
    await useTool("fx.video");
    await sheetRules("Effects");
    await page.waitForFunction(() => document.querySelectorAll('[data-testid^="fx-tile-effect-"]').length >= 3, null, { timeout: 60_000 });
    await tap(visible(page.locator('[data-testid^="fx-tile-effect-"] [role="button"]')));
    await wait(700);
    await closeSheet();
    const layers = (await tracksOf("effect")).flatMap((track) => track.elements);
    expect(layers.length === 1 && layers[0].type === "effect", "with nothing selected an effect tile makes an effect layer at the playhead");
    await toRoot();
    await useTool("root.filters");
    await sheetRules("Filters");
    await page.waitForFunction(() => document.querySelectorAll('[data-testid^="fx-tile-filter-"]').length >= 3, null, { timeout: 60_000 });
    await shot("16-sheet-filters");
    await tap(visible(page.locator('[data-testid^="fx-tile-filter-"] [role="button"]')));
    await wait(700);
    await closeSheet();
    expect((await tracksOf("effect")).flatMap((track) => track.elements).length === 2, "a filter tile makes a filter layer");
    await toRoot();
    // Collapsed strips: outside their groups the lanes are 4 pt strips under the main track.
    const strips = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="strip-"]:not([data-testid^="strip-el-"])')].map((node) => [node.getAttribute("data-testid"), node.getBoundingClientRect().height]));
    expect(strips.length >= 3 && strips.every(([, tall]) => tall === 4), `graphic, video and effect lanes are 4 pt strips at the root: ${JSON.stringify(strips)}`);
    await shot("17-collapsed-strips");
    for (const id of ["root.stickers", "root.overlay", "overlay.add", "root.effects", "fx.video", "root.filters"]) record(id, "works e2e");
  });

  await step("Collapsed strips — a tap on a strip enters its group and selects the element; the effect bar strip", async () => {
    const element = visible(page.locator('[data-testid="strip-effect"] [data-testid^="strip-el-"]')), box = await element.boundingBox();
    await tap({ x: Math.min(380, Math.max(10, box.x + Math.min(box.width / 2, 30))), y: box.y + 2 });
    await wait(300);
    expect((await page.getByTestId("track-overlay-effect").count()) >= 1, "the effect lanes are drawn in full");
    const tools = await strip();
    expect(tools.some((id) => id === "fx.adjust") && tools.includes("fx.delete") && tools.includes("fx.layers"), `the effect bar strip: ${tools}`);
    await useTool("fx.adjust");
    await sheetRules("Adjust");
    await tid("layer-parameters").waitFor({ timeout: 10_000 });
    await closeSheet();
    record("fx.adjust", "works e2e", "opened; no parameter changed");
    await toRoot();
  });

  await step("Captions group — subtitles imported from an .srt file make a caption track; Transcript opens", async () => {
    writeFileSync(media("lines.srt"), "1\n00:00:00,500 --> 00:00:01,500\nFirst line\n\n2\n00:00:02,000 --> 00:00:03,000\nSecond line\n");
    await useTool("root.captions");
    expect((await strip()).join() === "cap.import,cap.transcript", `the Captions group: ${await strip()}`);
    await useTool("cap.import");
    await sheetRules("Captions");
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), (async () => { const button = tid("captions-import"); await button.scrollIntoViewIfNeeded(); await tap(button); })()]);
    await chooser.setFiles([media("lines.srt")]);
    await tid("captions-import-confirm").waitFor({ timeout: 10_000 });
    await tap(tid("captions-import-confirm"));
    await wait(700);
    await closeSheet();
    const captions = (await tracksOf("caption")).flatMap((track) => track.elements);
    expect(captions.length === 2, `two captions on a caption track: ${captions.length}`);
    expect((await page.getByTestId("track-overlay-caption").count()) >= 1 && (await page.getByTestId("tl-ctl-lane-caption").count()) >= 1, "the caption lane is drawn in full with its lane label");
    const captionStrip = await strip();
    expect(captionStrip.includes("ccap.style") && captionStrip.includes("ccap.edit") && captionStrip.includes("ccap.delete"), `the imported caption is selected and shows the caption strip: ${captionStrip}`);
    await shot("17b-caption-lane");
    await toRoot();
    await useTool("root.captions");
    expect((await page.getByTestId("track-overlay-caption").count()) >= 1, "in the Captions group the caption lanes are drawn in full");
    await useTool("cap.transcript");
    await sheetRules("Transcript");
    await tid("transcript-tab").waitFor({ timeout: 10_000 }).catch(() => tid("transcript-empty").waitFor({ timeout: 2000 }));
    await closeSheet();
    record("root.captions", "works e2e"); record("cap.import", "works e2e"); record("cap.transcript", "works e2e", "opened");
    await toRoot();
  });

  await step("Add at the playhead and Edit a marker — Markers: add, the flag on the ruler, the list, a note", async () => {
    await seekTo(1.5);
    await useTool("root.markers");
    expect((await strip()).join() === "marker.add,marker.prev,marker.next,marker.list", `the Markers group: ${await strip()}`);
    await useTool("marker.list");
    await tid("markers-empty").waitFor();
    expect((await tid("markers-empty").innerText()).includes("No markers yet"), "the list is empty with No markers yet");
    await closeSheet();
    await useTool("marker.add");
    expect((await scene()).markers.length === 1 && (await scene()).markers[0].time === 1.5 * T, "a marker at 1.5 s");
    expect((await tool("marker.add").innerText()).includes("Remove marker") && (await page.getByTestId("marker-flag").count()) === 1, "the tool reads Remove marker and a flag is on the ruler");
    await seekTo(3);
    await useTool("marker.prev");
    expect((await seconds()).now === 1 && near((await view()).scroll, 75, 1), `Previous seeks to the marker: ${(await view()).scroll}`);
    // A held flag is picked up and follows the finger; one undo puts it back.
    const flag = await tid("marker-flag").boundingBox(), grip = { x: flag.x + flag.width / 2, y: flag.y + flag.height / 2 };
    await swipe(grip, { x: grip.x + (await view()).pps, y: grip.y }, { hold: 520, steps: 10 });
    expect((await scene()).markers[0].time === 2.5 * T, `the marker moved by 1 s: ${(await scene()).markers[0].time / T}`);
    await tap(tid("bar-undo")); await wait(250);
    expect((await scene()).markers[0].time === 1.5 * T, "one undo restores the marker");
    // A tap on the flag seeks to it and selects it: the strip of a marker.
    await seekTo(3);
    const again = await tid("marker-flag").boundingBox();
    await tap({ x: again.x + again.width / 2, y: again.y + again.height / 2 });
    await wait(300);
    expect(near((await view()).scroll, 75, 1) && (await tid("marker-flag").getAttribute("data-selected")) === "true", "a tap on the flag seeks to the marker and selects it");
    expect((await strip()).join() === "marker.note,marker.colour,marker.duration,marker.delete", `the marker strip: ${await strip()}`);
    await useTool("marker.note");
    const note = visible(page.locator('[role="dialog"] textarea'));
    await note.waitFor({ timeout: 10_000 });
    await note.fill("Logo in");
    await wait(300);
    await tap(visible(page.locator('[role="dialog"]').getByRole("button", { name: "Done", exact: true })));
    await wait(400);
    expect((await scene()).markers[0].note === "Logo in", "the marker's note is stored");
    // Colour: cancelled it stays as it was, confirmed it is stored.
    const colour = (await scene()).markers[0].color;
    await useTool("marker.colour");
    await sheetRules("Marker");
    await tap(tid("marker-colour-3")); await wait(250);
    expect((await scene()).markers[0].color === 3, "a colour is picked");
    await tap(tid("tool-sheet-cancel")); await wait(300);
    expect((await scene()).markers[0].color === colour, "Cancel leaves the colour it had");
    await useTool("marker.colour");
    await tap(tid("marker-colour-5")); await wait(250);
    await closeSheet();
    expect((await scene()).markers[0].color === 5, "the confirmed colour is stored");
    await useTool("marker.duration");
    await typeInto(visible(page.locator('[data-testid="marker-duration"] input')), 1);
    await closeSheet();
    expect((await scene()).markers[0].duration === T, `the marker lasts 1 s: ${(await scene()).markers[0].duration}`);
    await shot("18a-marker-strip");
    await tap(tid("tool-back"));
    expect((await strip())[0] === "marker.add", "back deselects the marker");
    // A second marker, removed from its own strip.
    await seekTo(3); await useTool("marker.add");
    expect((await scene()).markers.length === 2, "a second marker at 3 s");
    const flags = page.getByTestId("marker-flag"), last = await flags.nth((await flags.count()) - 1).boundingBox();
    await tap({ x: last.x + last.width / 2, y: last.y + last.height / 2 }); await wait(300);
    await useTool("marker.delete");
    expect((await scene()).markers.length === 1 && (await strip())[0] === "marker.add", "Delete of the strip removes the selected marker and its strip");
    await useTool("marker.list");
    await sheetRules("Markers");
    expect((await page.getByTestId("marker-row").count()) === 1 && (await tid("markers-sheet").innerText()).includes("Logo in"), "the list shows the marker with its note");
    await shot("18-sheet-markers");
    await closeSheet();
    await seekTo(0); await useTool("marker.next");
    expect(near((await view()).scroll, 75, 1), "Next seeks to the marker");
    for (const id of ["root.markers", "marker.add", "marker.prev", "marker.next", "marker.list", "marker.note", "marker.colour", "marker.duration", "marker.delete", "marker flag: tap / hold-drag"]) record(id, "works e2e");
    await toRoot();
  });

  await step("Rows of the More sheet — switches, the in/out range, Select (multi-selection strip, Group), Guides", async () => {
    await useTool("root.more");
    await sheetRules("More");
    const rows = await page.evaluate(() => [...document.querySelectorAll('[data-testid="more-sheet"] [data-testid^="more."]')].map((node) => node.getAttribute("data-testid")));
    expect(rows.join() === "more.scenes,more.tracks,more.transcript,more.range,more.select,more.snapping,more.linkage,more.free-layer,more.loop,more.rate,more.quality,more.volume,more.guides,more.snapshot,more.settings", `the rows: ${rows}`);
    await shot("19-sheet-more");
    const snapping = tid("more.snapping").getByRole("switch");
    const was = await snapping.getAttribute("aria-checked");
    await tap(snapping); await wait(200);
    expect((await snapping.getAttribute("aria-checked")) !== was, "Auto snapping switches");
    await tap(snapping); await wait(200);
    await tap(tid("range-in")); await wait(300);
    expect((await scene()).inPoint === Math.round((await view()).scroll / (await view()).pps * T), `Set in marks the playhead: ${(await scene()).inPoint}`);
    await tap(tid("range-clear")); await wait(300);
    expect((await scene()).inPoint === undefined, "Clear removes the range");
    const guides = tid("more.guides"); await guides.scrollIntoViewIfNeeded(); await tap(guides);
    await sheetRules("Guides");
    await tap(tid("guides-grid").getByRole("switch")); await wait(300);
    expect((await page.getByTestId("guide-grid").count()) > 0, "the grid is drawn over the preview");
    await tap(tid("guides-grid").getByRole("switch")); await wait(200);
    await closeSheet();
    await useTool("root.more");
    await tap(tid("more.select")); await wait(300);
    expect((await tid("toolbar-hint").innerText()).includes("Tap clips"), "Select waits for taps");
    const main = (await clips()).filter((clip) => clip.track === "track-main-video");
    // Near the top edge of the clips: the + pinned at the right edge lies over the middle of the last one.
    for (const clip of main.slice(0, 2)) { await tap({ x: Math.min(384, Math.max(130, clip.x + clip.width / 2)), y: clip.y + 5 }); await wait(150); }
    expect((await clips()).filter((clip) => clip.selected).length === 2, "two taps select two clips");
    const multi = await strip();
    expect(multi.includes("multi.delete") && multi.includes("multi.duplicate") && multi.includes("multi.group") && multi.includes("multi.copy"), `the multi-select strip: ${multi}`);
    await useTool("multi.group");
    const grouped = (await mainOf()).filter((element) => element.groupId);
    expect(grouped.length === 2 && grouped[0].groupId === grouped[1].groupId, "Group joins the two clips");
    expect((await strip()).includes("multi.ungroup"), "a grouped selection offers Ungroup");
    await tap(tid("bar-undo")); await wait(200);
    await toRoot();
    for (const id of ["root.more", "more.snapping", "more.range", "more.guides", "more.select", "multi.group"]) record(id, "works e2e");
    for (const id of ["multi.delete", "multi.duplicate", "multi.copy", "multi.cut", "multi.compound", "multi.hide"]) record(id, "works, not exercised");
  });

  await step("More: Linkage, Loop, playback rate, preview quality, volume, Save snapshot, Tracks, Transcript, Project settings", async () => {
    await toRoot(); await useTool("root.more");
    const row = async (id) => { const node = tid(id); await node.scrollIntoViewIfNeeded(); await wait(100); return node; };
    for (const id of ["more.linkage", "more.loop"]) {
      const toggle = (await row(id)).getByRole("switch"), was = await toggle.getAttribute("aria-checked");
      await tap(toggle); await wait(200);
      expect((await toggle.getAttribute("aria-checked")) !== was, `${id} switches`);
      await tap(toggle); await wait(200);
      expect((await toggle.getAttribute("aria-checked")) === was, `${id} switches back`);
    }
    for (const [id, pick, rest] of [["more.rate", "2×", "1×"], ["more.quality", "1/2", "Auto"]]) {
      const group = await row(id);
      await tap(group.getByRole("radio", { name: pick, exact: true })); await wait(250);
      expect((await group.getByRole("radio", { name: pick, exact: true }).getAttribute("aria-checked")) === "true", `${id}: ${pick} is chosen`);
      if (id === "more.rate") {
        // Twice the speed: the playhead covers about twice the time.
        await closeSheet(); await seekTo(0);
        // The time on the wall between two readings of the playhead while it plays, against the time the playhead covered.
        await tap(tid("player-play")); await wait(400);
        const first = await view(), started = Date.now();
        await wait(1000);
        const second = await view(), elapsed = (Date.now() - started) / 1000;
        await tap(tid("player-play")); await wait(300);
        const covered = (second.scroll / second.pps - first.scroll / first.pps) / elapsed;
        expect(covered > 1.6 && covered < 2.4, `at 2× the playhead covers about two seconds a second: ${covered}`);
        await useTool("root.more");
      }
      await tap((await row(id)).getByRole("radio", { name: rest, exact: true })); await wait(250);
    }
    await row("more.volume");
    await tap(tid("volume-mute")); await wait(200);
    expect((await tid("volume-value").innerText()).trim() === "0%", `mute silences the preview: ${await tid("volume-value").innerText()}`);
    await tap(tid("volume-mute")); await wait(200);
    expect((await tid("volume-value").innerText()).trim() !== "0%", "unmute restores the level");
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), (async () => { await tap(await row("more.snapshot")); })()]);
    const png = join(shots, "snapshot.png");
    await download.saveAs(png);
    const still = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,width,height", "-of", "json", png]).toString()).streams[0], size = (await stored()).settings.canvasSize;
    expect(download.suggestedFilename().endsWith(".png") && still.codec_name === "png" && still.width === size.width && still.height === size.height, `the snapshot is a PNG of the canvas: ${download.suggestedFilename()} ${JSON.stringify(still)}`);
    await tap(await row("more.tracks"));
    await sheetRules("Tracks");
    await tid("track-row-main").waitFor();
    await closeSheet(); await useTool("root.more");
    await tap(await row("more.transcript"));
    await sheetRules("Transcript");
    await closeSheet(); await useTool("root.more");
    await tap(await row("more.settings"));
    await visible(page.locator('[role="dialog"]').getByText("Project settings", { exact: true })).waitFor({ timeout: 10_000 });
    await tap(visible(page.locator('[role="dialog"]').getByRole("button", { name: "Close", exact: true })));
    await wait(400);
    await closeSheet();
    for (const id of ["more.linkage", "more.loop", "more.rate", "more.quality", "more.volume", "more.snapshot", "more.tracks", "more.transcript", "more.settings"]) record(id, "works e2e");
  });

  await step("Free layer turns the magnet off and Turning the magnet on closes gaps — the phone has no magnet or ripple switch", async () => {
    await toRoot(); await useTool("root.more");
    expect((await page.getByTestId("more.magnet").count()) === 0 && (await page.getByTestId("more.ripple").count()) === 0, "there is no magnet and no ripple switch");
    const free = tid("more.free-layer"); await free.scrollIntoViewIfNeeded();
    await tap(free.getByRole("switch")); await wait(250);
    expect((await free.getByRole("switch").getAttribute("aria-checked")) === "true", "Free layer is on");
    await closeSheet(); await seekTo(1); await useTool("root.edit");
    const before = await mainOf();
    await useTool("clip.delete");
    let main = await mainOf();
    expect(main.length === before.length - 1 && main[0].startTime === before[1].startTime && main[0].startTime > 0, `with Free layer on a gap remains where the clip was: ${JSON.stringify(main.map((element) => element.startTime / T))}`);
    await toRoot(); await useTool("root.more");
    await tid("more.free-layer").scrollIntoViewIfNeeded();
    await tap(tid("more.free-layer").getByRole("switch")); await wait(300);
    await closeSheet();
    main = await mainOf();
    expect(main[0].startTime === 0 && contiguous(main), `turning Free layer off closes the gap at once: ${JSON.stringify(main.map((element) => element.startTime / T))}`);
    await tap(tid("bar-undo")); await wait(250);
    expect((await mainOf())[0].startTime > 0, "one undo restores the gap");
    await tap(tid("bar-undo")); await wait(250);
    expect((await mainOf()).length === before.length && contiguous(await mainOf()), "another undo restores the clip");
    record("more.free-layer", "works e2e");
  });

  await step("Switch a scene — Scenes of the More sheet: a new scene, into it and back, and its removal", async () => {
    await toRoot(); await useTool("root.more");
    await tap(tid("more.scenes"));
    await tid("scene-new").waitFor({ timeout: 10_000 });
    await tap(tid("scene-new")); await wait(400);
    await until(async () => (await stored()).scenes.length === 2, "a second scene exists");
    await tap(tid("scene-row-1").getByRole("button", { name: /^Open scene/ })); await wait(500);
    await tid("tl-ctl-add-media").waitFor({ timeout: 5000 });
    expect((await seconds()).total === 0, "the timeline shows the new, empty scene");
    await useTool("root.more"); await tap(tid("more.scenes"));
    await tap(tid("scene-row-0").getByRole("button", { name: /^Open scene/ })); await wait(500);
    expect((await clips()).filter((clip) => clip.track === "track-main-video").length >= 2, "back on the main scene");
    await useTool("root.more"); await tap(tid("more.scenes"));
    await tap(tid("scene-row-1").getByRole("button", { name: "Delete", exact: true })); await wait(300);
    await tap(visible(page.getByRole("button", { name: "Delete", exact: true }).last())); await wait(400);
    await until(async () => (await stored()).scenes.length === 1, "the new scene is removed");
    await tap(visible(page.locator('[role="dialog"]').getByRole("button", { name: "Close", exact: true }))); await wait(300);
    record("more.scenes", "works e2e");
  });

  await step("Agent without a host — the Agent button opens the agent as a sheet over the whole editor, in its Requires a host state", async () => {
    await toRoot();
    const before = JSON.stringify(await mainOf());
    await tap(tid("compact-agent")); await wait(300);
    const sheet = await tid("agent-sheet").boundingBox();
    expect(near(sheet.x, 0, 1) && near(sheet.y, 0, 1) && near(sheet.width, width, 1) && near(sheet.height, height, 1), `the sheet covers the editor: ${JSON.stringify(sheet)}`);
    const said = await tid("agent-sheet").innerText();
    expect(said.includes("Requires a host") && said.includes("Connect a host") && (await tid("agent-sheet").getByTestId("composer").count()) === 0, `without a host it says so and offers to connect one: ${said.replace(/\s+/g, " ").slice(0, 120)}`);
    await shot("19a-agent-sheet");
    await tap(tid("agent-panel-close")); await wait(300);
    expect((await page.getByTestId("agent-sheet").count()) === 0 && JSON.stringify(await mainOf()) === before, "closed, the editor is as it was");
    record("top bar: Agent", "works e2e", "Requires a host state; the chat itself needs a host");
  });

  await step("Open for a cut — the + of a cut adds a transition and opens its sheet; the duration is edited there", async () => {
    await toRoot(); await seekTo(2);
    const frameBefore = await frame();
    await tap(tid("transition-add"));
    await wait(600);
    await sheetRules("Transition");
    await tid("transition-inspector").waitFor({ timeout: 10_000 });
    expect((await page.locator('[data-testid^="tl-ctl-transition-"]').count()) === 1, "the cut carries a transition");
    const text = JSON.stringify(await scene());
    expect(/"transitions?":\s*\[\s*\{/.test(text) || /"transitionId"/.test(text) || text.includes("cross-dissolve"), "the transition is stored with the scene");
    await shot("20-sheet-transition");
    await settle();
    expect((await difference(frameBefore, await frame())) > 0.01, "the frame at the cut is the transition's");
    await closeSheet();
    record("transition junction", "works e2e", "added with the default type; duration not changed");
  });

  await step("Landscape project — Fullscreen shows only the preview with its transport bar", async () => {
    await toRoot();
    await tap(tid("transport-fullscreen"));
    await wait(600);
    const on = await page.evaluate(() => document.fullscreenElement !== null);
    expect(on, "the preview is full screen");
    await tid("fullscreen-bar").waitFor({ timeout: 5000 });
    await shot("21-fullscreen");
    // The phone turned on its side (the screen rotates with a wide project where the browser can lock it): the picture fills the screen.
    const playhead = (await view().catch(() => null))?.scroll;
    // A window in full screen cannot be resized: the device itself is turned, as a phone is.
    await turn(true);
    await wait(900);
    expect(await page.evaluate(() => document.fullscreenElement !== null), "turned, the preview is still full screen");
    // When the picture is not drawn, the failure says what the preview's boxes are instead of timing out.
    const picture = await tid("canvas").boundingBox({ timeout: 10_000 }).catch(async () => { throw new Error(`turned, the canvas is not drawn: ${JSON.stringify(await page.evaluate(() => ["canvas", "player-stage", "player-canvas", "player"].map((id) => [...document.querySelectorAll(`[data-testid="${id}"]`)].map((node) => { const box = node.getBoundingClientRect(); return [id, Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height), node.style.transform, node.parentElement?.style.transform]; }))))}`); });
    expect(near(picture.width / picture.height, 16 / 9, 0.03) && picture.height >= width - 48 - 40 && picture.width > width * 1.3, `in landscape the 16:9 picture fills the screen: ${Math.round(picture.width)}×${Math.round(picture.height)} of ${height}×${width}`);
    await tid("fullscreen-bar").waitFor({ timeout: 5000 });
    await shot("21a-fullscreen-landscape");
    await tap(tid("fullscreen-exit"));
    await wait(600);
    expect(await page.evaluate(() => document.fullscreenElement === null), "Exit returns to the editor");
    await turn(false);
    await wait(900);
    await tid("compact-toolbar").waitFor();
    if (playhead !== undefined) expect((await view()).scroll === playhead, "the playhead is where it was");
    record("transport fullscreen", "works e2e");
  });
}

await step("Text group and Text style — Add text puts a text bar on its lane; the Edit sheet changes what it says", async () => {
  await toRoot(); await seekTo(1);
  await settle();
  const frameBefore = await frame();
  await useTool("root.text");
  expect((await strip()).join() === "text.add,text.templates", `the Text group: ${await strip()}`);
  await useTool("text.add");
  await wait(500);
  let texts = (await tracksOf("text")).flatMap((track) => track.elements);
  expect(texts.length === 1 && texts[0].type === "text" && texts[0].startTime === T, `a text element at the playhead: ${JSON.stringify(texts.map((element) => [element.type, element.startTime / T]))}`);
  expect((await page.getByTestId("track-overlay-text").count()) === 1, "the text lane is drawn in full");
  await settle();
  const frameText = await frame();
  expect((await difference(frameBefore, frameText)) > 0.001, "the text is drawn in the preview");
  const tools = await strip();
  expect(tools.includes("tclip.edit") && tools.includes("tclip.animation") && tools.includes("tclip.delete"), `the text strip: ${tools}`);
  await useTool("tclip.edit");
  await sheetRules("Edit");
  const content = visible(page.locator('textarea[data-testid="text-content"], input[data-testid="text-content"], [data-testid="text-content"] textarea, [data-testid="text-content"] input'));
  await content.fill("Phone edit");
  await wait(600);
  await shot(smoke ? "30-sheet-text" : "22-sheet-text");
  await closeSheet();
  texts = (await tracksOf("text")).flatMap((track) => track.elements);
  expect(texts[0].content === "Phone edit", `the stored text: ${texts[0].content}`);
  await settle();
  expect((await difference(frameText, await frame())) > 0.0005, "the preview shows the new text");
  record("root.text", "works e2e"); record("text.add", "works e2e"); record("tclip.edit", "works e2e");
  await toRoot();
  if (!smoke) {
    // A text template: placed from the sheet, and taken back whole by Cancel.
    const had = (await tracksOf("text")).flatMap((track) => track.elements).length;
    await useTool("root.text"); await useTool("text.templates");
    await sheetRules("Text");
    const template = visible(page.locator('[data-testid^="text-template-"]'));
    await template.scrollIntoViewIfNeeded(); await tap(template); await wait(600);
    const placed = (await tracksOf("text")).flatMap((track) => track.elements).length;
    expect(placed > had, `the template puts its text on the timeline: ${had} → ${placed}`);
    await shot("22a-sheet-text-templates");
    await tap(tid("tool-sheet-cancel")); await wait(400);
    expect((await tracksOf("text")).flatMap((track) => track.elements).length === had, "Cancel of the sheet takes the template back");
    record("text.templates", "works e2e");
    await toRoot();
  }
});

await step("Add audio row and Audio group — a sound of the project goes on an audio lane; its Volume sheet changes its level", async () => {
  await seekTo(0);
  await tid("tl-ctl-add-audio").waitFor();
  await tap(tid("tl-ctl-add-audio"));
  expect((await strip()).join() === "audio.sounds,audio.voiceover", `Add audio opens the Audio group: ${await strip()}`);
  await useTool("audio.sounds");
  await sheetRules("Sounds");
  const add = visible(page.getByTestId("audio-add"));
  await add.waitFor({ timeout: 10_000 });
  await shot(smoke ? "31-sheet-sounds" : "23-sheet-sounds");
  await tap(add);
  await wait(600);
  await closeSheet();
  const sounds = (await tracksOf("audio")).flatMap((track) => track.elements);
  expect(sounds.length === 1 && sounds[0].type === "audio", `one audio clip on an audio track: ${sounds.length}`);
  expect((await page.getByTestId("tl-ctl-add-audio").count()) === 0 && (await page.getByTestId("track-audio-audio").count()) === 1, "the Add audio row is gone and the audio lane is drawn in full");
  // Select the audio bar on its lane and lower it.
  const bar = (await clips()).find((clip) => clip.track === "track-audio-audio");
  await tap({ x: Math.min(380, Math.max(60, bar.x + 40)), y: bar.y + bar.height / 2 });
  const tools = await strip();
  expect(tools.includes("aclip.volume") && tools.includes("aclip.speed") && tools.includes("aclip.delete"), `the audio clip strip: ${tools}`);
  await useTool("aclip.volume");
  await sheetRules("Volume");
  await typeNumber("audio-volume", -6);
  await closeSheet();
  expect((await tracksOf("audio"))[0].elements[0].volume === -6, "the audio clip is at −6 dB");
  await shot(smoke ? "32-audio-lane" : "24-audio-lane");
  record("root.audio", "works e2e"); record("audio.sounds", "works e2e"); record("aclip.volume", "works e2e");
  await toRoot();
  if (!smoke) {
    // Voiceover: recorded from the microphone (Chromium's fake capture device) and placed where the recording started.
    await seekTo(1); await useTool("root.audio"); await useTool("audio.voiceover");
    await tap(visible(page.getByRole("button", { name: "Start recording", exact: true })));
    await visible(page.getByText("Recording", { exact: true })).waitFor({ timeout: 20_000 });
    await wait(1600);
    await tap(visible(page.getByRole("button", { name: "Stop", exact: true })));
    await until(async () => (await tracksOf("audio")).flatMap((track) => track.elements).some((element) => element.isVoice === true), "the take is on an audio track, flagged as voice", 30_000);
    const take = (await tracksOf("audio")).flatMap((track) => track.elements).find((element) => element.isVoice === true);
    expect(take.startTime === T && take.duration > 0.8 * T, `the take starts at the playhead and lasts what was recorded: ${take.startTime / T} s, ${take.duration / T} s`);
    record("audio.voiceover", "works e2e", "Chromium fake microphone");
    await toRoot();
  }
});

if (!smoke) {
  await step("Emoji sticker — its strip on the timeline selects it, and the preview draws its colour glyph, not an empty box", async () => {
    await toRoot(); await seekTo(1);
    const element = visible(page.locator('[data-testid="strip-graphic"] [data-testid^="strip-el-"]')), box = await element.boundingBox();
    await tap({ x: Math.min(380, Math.max(10, box.x + Math.min(box.width / 2, 30))), y: box.y + 2 });
    await wait(300);
    const tools = await strip();
    expect(tools.includes("sclip.transform") && tools.includes("sclip.delete") && tools.includes("sclip.hide"), `the sticker strip: ${tools}`);
    expect((await page.getByTestId("track-overlay-graphic").count()) === 1, "the sticker lane is drawn in full while its sticker is selected");
    // The middle of the sticker's box with the sticker shown and hidden: a glyph changes most of it, an outline almost nothing.
    const outline = await tid("selection-box").boundingBox(), middle = { x: outline.x + outline.width * 0.25, y: outline.y + outline.height * 0.25, width: outline.width * 0.5, height: outline.height * 0.5 };
    await settle();
    const shown = await page.screenshot({ clip: middle });
    await useTool("sclip.hide"); await settle();
    const hidden = await page.screenshot({ clip: middle });
    const filled = await difference(shown, hidden);
    expect(filled > 0.4, `the emoji fills its box: ${filled}`);
    await useTool("sclip.hide"); await wait(300);
    record("sclip.hide", "works e2e"); record("emoji sticker in the preview", "works e2e"); record("sclip.transform", "works, not exercised");
    await toRoot();
  });
}

const probe = (path) => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-count_frames", "-show_entries", "format=duration,format_name:stream=codec_type,codec_name,width,height,avg_frame_rate,nb_read_frames,sample_rate,channels", "-of", "json", path]).toString());
await step("Export chip and Airplane mode editing — the chip reads the resolution; Export writes an MP4 of the whole scene (emoji sticker included), probed with ffprobe", async () => {
  const size = (await stored()).settings.canvasSize, total = (await seconds()).total, doc = await scene();
  const end = Math.max(...[...doc.tracks.overlay, doc.tracks.main, ...doc.tracks.audio].flatMap((track) => track.elements.map((element) => element.startTime + element.duration))) / T;
  expect((await tid("export-chip").innerText()).trim().startsWith(`${Math.min(size.width, size.height)}P`), `the chip reads the resolution: ${await tid("export-chip").innerText()}`);
  await tap(tid("export-chip"));
  await tid("export-dialog").waitFor({ timeout: 15_000 });
  await wait(1200);
  await shot(smoke ? "33-export" : "25-export");
  const start = tid("export-start");
  await start.scrollIntoViewIfNeeded();
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 300_000 }), tap(start)]);
  await tid("export-done").waitFor({ timeout: 120_000 });
  const path = join(shots, `export-${width}x${height}.mp4`);
  await download.saveAs(path);
  const info = probe(path), video = info.streams.find((stream) => stream.codec_type === "video"), audio = info.streams.find((stream) => stream.codec_type === "audio");
  const [n, d] = video.avg_frame_rate.split("/").map(Number);
  report.export = { file: path, format: info.format.format_name, duration: Number(info.format.duration), video: `${video.codec_name} ${video.width}x${video.height} ${(n / d).toFixed(2)} fps ${video.nb_read_frames} frames`, audio: audio ? `${audio.codec_name} ${audio.sample_rate} Hz ${audio.channels} ch` : "none", sceneSeconds: end };
  console.log("      ffprobe", JSON.stringify(report.export));
  expect(info.format.format_name.includes("mp4"), `an MP4 file: ${info.format.format_name}`);
  expect(video.width === size.width && video.height === size.height, `at the project size: ${video.width}×${video.height}`);
  expect(near(Number(info.format.duration), end, 0.15) && near(Number(video.nb_read_frames), end * 30, 3), `the whole scene: ${info.format.duration} s, ${video.nb_read_frames} frames for ${end} s (${total})`);
  expect(Boolean(audio), "with its sound");
  await tap(visible(page.getByRole("button", { name: "Done", exact: true }).or(page.getByTestId("export-close"))));
  await wait(500);
  record("export chip / Export", "works e2e");
});

await step("Dark theme — the same screens in the dark theme; the preview and the timeline stay on the editor surface", async () => {
  if ((await page.getByTestId("export-dialog").count()) > 0) { await tap(tid("export-close")); await wait(400); }
  const surface = () => tid("compact-timeline").evaluate((node) => getComputedStyle(node).backgroundColor);
  const light = await surface();
  await page.emulateMedia({ colorScheme: "dark" });
  await wait(600);
  expect((await surface()) === light && light === "rgb(22, 22, 22)", `the timeline is on bg/editor in both themes: ${light} / ${await surface()}`);
  await toRoot();
  await shot(smoke ? "34-root-dark" : "26-root-dark");
  await seekTo(1); await useTool("root.edit");
  await shot(smoke ? "35-clip-dark" : "27-clip-dark");
  await useTool("clip.transform");
  await sheetRules("Transform");
  await shot(smoke ? "36-sheet-dark" : "28-sheet-transform-dark");
  await closeSheet(); await toRoot();
  await useTool("root.more");
  await shot(smoke ? "37-more-dark" : "29-sheet-more-dark");
  await closeSheet();
  await page.emulateMedia({ colorScheme: "light" });
  await wait(400);
});

await step("Close saves — Close flushes the save and returns to the projects; the project reopens with its clips", async () => {
  await toRoot();
  const id = page.url().split("/").pop(), count = (await mainOf()).length;
  await tap(tid("compact-close"));
  await page.waitForURL(/\/projects$/, { timeout: 30_000 });
  await wait(800);
  await page.goto(`${base}/editor/${id}`, { waitUntil: "networkidle", timeout: 120_000 });
  await tid("compact-timeline").waitFor({ timeout: 60_000 });
  await page.waitForFunction((wanted) => document.querySelectorAll('[data-testid="track-main-video"] [data-testid^="clip-"]').length >= wanted, count, { timeout: 30_000 });
});

writeFileSync(join(shots, `report-${width}x${height}.json`), JSON.stringify(report, null, 2));
const noise = (text) => /Download the React DevTools|favicon|ResizeObserver loop/.test(text);
const real = errors.filter((text) => !noise(text));
console.log(`${failed === 0 ? "PASS" : "FAIL"} ${width}×${height}${smoke ? " (smoke)" : ""}: ${failed} failed steps, ${real.length} console/page errors`);
for (const text of real.slice(0, 12)) console.log("   ", text.slice(0, 240));
await browser.close();
process.exit(failed === 0 && real.length === 0 && !only ? 0 : 1);
