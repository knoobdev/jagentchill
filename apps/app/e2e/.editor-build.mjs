// End-to-end in a real browser against the Expo web dev server, with no host: the editor screen — timeline, player, inspector.
// Real storage (IndexedDB and OPFS of a fresh browser profile) and real media files made with ffmpeg; nothing is seeded or mocked.
// Usage: node apps/app/e2e/editor.mjs [screenshot-dir] [base-url]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const shots = process.argv[2] ?? ".dev/shots/editor";
const base = process.argv[3] ?? "http://localhost:8091";
mkdirSync(shots, { recursive: true });

// — Media: two H.264/AAC clips of different colours and tones, a PNG, a WAV —
const dir = join(tmpdir(), "jagentchill-editor-e2e");
mkdirSync(dir, { recursive: true });
const ffmpeg = (...args) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args]);
const media = (name) => join(dir, name);
if (!existsSync(media("red.mp4"))) ffmpeg("-f", "lavfi", "-i", "color=c=red:s=640x360:r=30:d=4", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", media("red.mp4"));
if (!existsSync(media("blue.mp4"))) ffmpeg("-f", "lavfi", "-i", "color=c=blue:s=640x360:r=30:d=3", "-f", "lavfi", "-i", "sine=frequency=880:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", media("blue.mp4"));
if (!existsSync(media("still.png"))) ffmpeg("-f", "lavfi", "-i", "color=c=green:s=320x320:d=1", "-frames:v", "1", media("still.png"));
if (!existsSync(media("tone.wav"))) ffmpeg("-f", "lavfi", "-i", "sine=frequency=220:duration=6", media("tone.wav"));

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
if (process.env.JC_DEBUG) {
  // The JavaScript stack of every console error, for tracing a failure to its source.
  const cdp = await context.newCDPSession(page);
  await cdp.send("Runtime.enable");
  cdp.on("Runtime.consoleAPICalled", (event) => { if (event.type === "error") console.log("CONSOLE ERROR", String(event.args[0]?.value).slice(0, 100), "\n" + (event.stackTrace?.callFrames ?? []).slice(0, 16).map((frame) => `   ${frame.functionName} :${frame.lineNumber}`).join("\n")); });
}
const visible = (locator) => locator.filter({ visible: true }).first();
const tid = (id) => visible(page.getByTestId(id));
const button = (name, exact = true) => visible(page.getByRole("button", { name, exact }));
// A menu row is a menuitem, or a menuitemradio / menuitemcheckbox when it carries a check mark.
const menuItem = (name) => visible(page.locator('[role^="menuitem"]').filter({ has: page.getByText(name, { exact: true }) }));
const shot = (name) => page.screenshot({ path: `${shots}/${name}.png` });
const expect = (condition, message) => { if (!condition) throw new Error(message); };
const near = (a, b, tolerance = 2) => Math.abs(a - b) <= tolerance;
const step = async (name, run) => {
  try { await run(); console.log("ok  ", name); }
  catch (err) { console.log("FAIL", name, "—", String(err).split("\n")[0]); errors.push(`step failed: ${name}`); await shot(`failure-${name.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}`); }
};
const end2seconds = (text) => { const [h, m, sec, f] = text.replace("/ ", "").trim().split(":").map(Number); return h * 3600 + m * 60 + sec + f / 30; };
const mod = process.platform === "darwin" ? "Meta" : "Control";

/** The clips on screen, read from the DOM: track row, left edge and width in px, selected or not. */
const clips = () => page.evaluate(() => [...document.querySelectorAll('[data-testid^="clip-"]')].filter((node) => !["clip-selection", "clip-hover", "clip-hatch", "clip-mute", "clip-reverse"].includes(node.getAttribute("data-testid"))).map((node) => {
  const rect = node.getBoundingClientRect(), row = node.closest('[data-testid^="track-"]');
  return { id: node.getAttribute("data-testid").slice(5), track: row?.getAttribute("data-testid") ?? "", x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height), label: node.getAttribute("aria-label") ?? "", selected: node.querySelector('[data-testid="clip-selection"]') !== null };
}).sort((a, b) => a.y - b.y || a.x - b.x));
const onTrack = async (track) => (await clips()).filter((clip) => clip.track === track);
const timecode = () => tid("timecode").inputValue();
const tracksBox = () => tid("timeline-tracks").boundingBox();
const rulerBox = () => tid("timeline-ruler").boundingBox();
const playheadX = async () => Math.round((await tid("playhead").boundingBox()).x);
/** Px per second on the timeline, measured from a clip whose duration is known. */
let pxPerSecond = 50;
/** The colour at the centre of the preview canvas, read from a screenshot of it. */
const previewColour = async () => {
  const box = await tid("canvas").boundingBox();
  const png = await page.screenshot({ clip: { x: Math.round(box.x + box.width / 2) - 4, y: Math.round(box.y + box.height / 2) - 4, width: 8, height: 8 } });
  return page.evaluate(async (data) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context2d = canvas.getContext("2d");
    context2d.drawImage(bitmap, 0, 0);
    const [r, g, b] = context2d.getImageData(4, 4, 1, 1).data;
    return { r, g, b, name: r > 150 && b < 90 && g < 90 ? "red" : b > 150 && r < 90 && g < 90 ? "blue" : g > 100 && r < 90 && b < 90 ? "green" : r < 40 && g < 40 && b < 40 ? "black" : "other" };
  }, png.toString("base64"));
};
const importFiles = async (paths) => { const [chooser] = await Promise.all([page.waitForEvent("filechooser"), tid("media-dropzone").click()]); await chooser.setFiles(paths); };
const saved = () => visible(page.getByTestId("save-state").getByText("Saved", { exact: true })).waitFor({ timeout: 20_000 });
const drag = async (from, to, options = {}) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const steps = options.steps ?? 8;
  for (let index = 1; index <= steps; index++) { await page.mouse.move(from.x + ((to.x - from.x) * index) / steps, from.y + ((to.y - from.y) * index) / steps); await page.waitForTimeout(16); }
  if (options.hold) await options.hold();
  await page.mouse.up();
  await page.waitForTimeout(120);
};

await step("a new project opens the four regions of the editor — Empty main track in a new project", async () => {
  await page.goto(`${base}/projects`, { waitUntil: "networkidle", timeout: 180_000 });
  await button("Create your first project").click({ timeout: 90_000 });
  await page.waitForURL(/\/editor\/[0-9a-f-]{36}$/);
  for (const id of ["editor-bar", "asset-panel", "player", "inspector", "timeline", "timeline-toolbar", "player-bar"]) await tid(id).waitFor({ timeout: 60_000 });
  // Empty main track in a new project: the main track row shows the dashed placeholder border.
  await tid("main-placeholder").waitFor();
  expect((await timecode()) === "00:00:00:00", "the timecode starts at zero");
  expect(await button("Play").isDisabled(), "Play is disabled in an empty scene");
  await shot("01-empty-editor");
});

await step("import two videos, a picture and a sound", async () => {
  await importFiles([media("red.mp4"), media("blue.mp4"), media("still.png"), media("tone.wav")]);
  for (const name of ["red.mp4", "blue.mp4", "still.png", "tone.wav"]) await tid(`label-${name}`).waitFor({ timeout: 60_000 });
  await saved();
});

await step("click adds a clip to the main track; the preview shows its picture", async () => {
  await tid("thumb-red.mp4").dblclick();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="track-main-video"] [data-testid^="clip-"]').length >= 1);
  const [red] = await onTrack("track-main-video");
  pxPerSecond = red.width / 4;
  expect(near(pxPerSecond, 50, 1), `a 4 s clip is 200 px at zoom 1, got ${red.width}`);
  expect(red.selected, "the added clip is selected");
  expect((await tid("player-duration").innerText()).includes("00:00:04:00"), "the scene is 4 s long");
  await page.waitForFunction(async () => true);
  await page.waitForTimeout(1500);
  const colour = await previewColour();
  expect(colour.name === "red", `the preview shows the red clip, got ${JSON.stringify(colour)}`);
});

await step("drag adds a second clip after the first, with a drop ghost on the way", async () => {
  const from = await tid("thumb-blue.mp4").boundingBox(), tracks = await tracksBox(), [red] = await onTrack("track-main-video");
  const target = { x: red.x + red.width + 60, y: red.y + red.height / 2 };
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2 + 20, { steps: 4 });
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await page.waitForTimeout(150);
  const ghost = await page.getByTestId("drop-ghost").count();
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="track-main-video"] [data-testid^="clip-"]').length >= 2, null, { timeout: 10_000 });
  expect(ghost > 0, "the drop ghost was drawn while dragging");
  const main = await onTrack("track-main-video");
  expect(main.length === 2 && near(main[1].x, main[0].x + main[0].width), `the blue clip follows the red one edge to edge: ${JSON.stringify(main.map((clip) => [clip.x, clip.width]))}`);
  expect((await tid("player-duration").innerText()).includes("00:00:07:00"), "the scene is 7 s long");
  void tracks;
  await shot("02-two-clips");
});


const seekTo = async (seconds) => { const ruler = await rulerBox(); await page.mouse.click(ruler.x + seconds * pxPerSecond, ruler.y + 6); await page.waitForTimeout(150); };
const mainCount = async () => (await onTrack("track-main-video")).length;
const clickClip = async (clip, options) => { await page.mouse.click(clip.x + clip.width / 2, clip.y + clip.height / 2, options); await page.waitForTimeout(120); };

await step("ruler click seeks; playback advances the playhead and the preview turns to the second clip at its start", async () => {
  await seekTo(3.2);
  expect((await timecode()) === "00:00:03:06", `a click at 3.2 s seeks to the frame there, got ${await timecode()}`);
  await page.waitForTimeout(600);
  expect((await previewColour()).name === "red", "3.2 s is inside the red clip");
  const startX = await playheadX();
  await button("Play").click();
  await button("Pause").waitFor({ timeout: 5000 });
  let firstBlue = null, lastRed = null;
  for (let index = 0; index < 60 && firstBlue === null; index++) {
    // The picture is sampled by a screenshot, which takes time: a red frame is dated by the timecode read before it, a blue one by the timecode read after.
    const before = await timecode(), colour = await previewColour(), after = await timecode();
    if (colour.name === "red") lastRed = before;
    if (colour.name === "blue") firstBlue = after;
    await page.waitForTimeout(50);
  }
  await button("Pause").click();
  await button("Play").waitFor();
  expect((await playheadX()) > startX + 20, "the playhead moved with playback");
  expect(firstBlue !== null && firstBlue >= "00:00:03:28" && firstBlue <= "00:00:04:25", `blue appears when the playhead reaches 4 s (first blue at ${firstBlue}, last red at ${lastRed})`);
  expect(lastRed !== null && lastRed < "00:00:04:03", `red is shown up to the cut and not after it (last red at ${lastRed})`);
  const paused = await timecode();
  await page.waitForTimeout(400);
  expect((await timecode()) === paused, "pause holds the playhead");
});

await step("split at the playhead cuts the selected clip in two", async () => {
  await seekTo(2);
  expect((await timecode()) === "00:00:02:00", `playhead at 2 s, got ${await timecode()}`);
  const [red] = await onTrack("track-main-video");
  await clickClip(red);
  await tid("tool-split").click();
  await page.waitForTimeout(200);
  const main = await onTrack("track-main-video");
  expect(main.length === 3, `three clips after the split, got ${main.length}`);
  expect(near(main[0].width, 2 * pxPerSecond) && near(main[1].width, 2 * pxPerSecond) && near(main[2].width, 3 * pxPerSecond), `2 s + 2 s + 3 s: ${main.map((clip) => clip.width)}`);
});

await step("trimming an edge snaps to the playhead, with a snap line and the duration tooltip", async () => {
  await seekTo(5.5);
  const main = await onTrack("track-main-video"), blue = main[2];
  await clickClip(blue);
  const edge = { x: blue.x + blue.width - 3, y: blue.y + blue.height / 2 }, ruler = await rulerBox();
  let seen = { snap: 0, tooltip: "" };
  // Released 6 px away from the playhead: inside the 10 px snap distance.
  await drag(edge, { x: ruler.x + 5.5 * pxPerSecond + 6, y: edge.y }, { hold: async () => { seen = { snap: await page.getByTestId("snap-line").count(), tooltip: await tid("trim-tooltip").innerText().catch(() => "") }; } });
  const after = (await onTrack("track-main-video"))[2];
  expect(seen.snap > 0, "the snap line is drawn while the edge is at the playhead");
  expect(seen.tooltip.includes("00:01.5"), `the tooltip reads the new duration, got "${seen.tooltip}"`);
  expect(near(after.width, 1.5 * pxPerSecond, 1), `the clip ends exactly at the playhead: ${after.width} px`);
  expect((await tid("player-duration").innerText()).includes("00:00:05:15"), "the scene now ends at 5.5 s");
});

await step("dragging a clip above the main track puts it on a new overlay track; the magnet closes the gap", async () => {
  const main = await onTrack("track-main-video"), middle = main[1];
  const from = { x: middle.x + middle.width / 2, y: middle.y + middle.height / 2 };
  let line = 0;
  await drag(from, { x: from.x + 10, y: middle.y - 30 }, { steps: 10, hold: async () => { line = await page.getByTestId("drop-insert").count(); } });
  const overlay = await onTrack("track-overlay-video"), after = await onTrack("track-main-video");
  expect(line > 0, "the new-track line is drawn while dragging outside the rows");
  expect(overlay.length === 1 && near(overlay[0].width, 2 * pxPerSecond), `one 2 s clip on a new overlay track: ${JSON.stringify(overlay.map((clip) => clip.width))}`);
  expect(after.length === 2 && near(after[1].x, after[0].x + after[0].width), `the main track is edge to edge again: ${JSON.stringify(after.map((clip) => [clip.x, clip.width]))}`);
  await shot("03-overlay-track");
});

await step("ripple delete removes the clip and closes its gap; undo and redo walk the steps", async () => {
  const [first] = await onTrack("track-main-video"), tracks = await tracksBox();
  await clickClip(first);
  await page.keyboard.press("Shift+Delete");
  await page.waitForTimeout(200);
  let main = await onTrack("track-main-video");
  expect(main.length === 1 && near(main[0].x, tracks.x), `one clip left, at the start: ${JSON.stringify(main.map((clip) => [clip.x, clip.width]))}`);
  await tid("tool-undo").click();
  await page.waitForTimeout(200);
  expect((await mainCount()) === 2, "undo brings the clip back");
  await tid("bar-redo").click();
  await page.waitForTimeout(200);
  expect((await mainCount()) === 1, "redo removes it again");
  await page.keyboard.press(`${mod}+z`);
  await page.waitForTimeout(200);
  expect((await mainCount()) === 2, "the undo key brings it back");
});

await step("zoom in, out and to fit change the scale around the playhead", async () => {
  const before = (await onTrack("track-main-video"))[0].width;
  await tid("tool-zoom-in").click();
  await page.waitForTimeout(200);
  const zoomed = (await onTrack("track-main-video"))[0].width;
  expect(near(zoomed, before * 1.7, 2), `zoom in is ×1.7: ${before} → ${zoomed}`);
  await tid("tool-zoom-out").click();
  await page.waitForTimeout(200);
  // The smallest zoom keeps a short scene on a quarter of the viewport, so zooming out may stop before the starting scale.
  const out = (await onTrack("track-main-video"))[0].width;
  expect(out < zoomed && out >= before - 2, `zoom out steps back: ${zoomed} → ${out}`);
  await tid("tool-zoom-fit").click();
  await page.waitForTimeout(200);
  const tracks = await tracksBox(), main = await onTrack("track-main-video"), end = Math.max(...(await clips()).map((clip) => clip.x + clip.width));
  expect(near(end - tracks.x, tracks.width * 0.95, 4), `fit puts the scene on 95 % of the viewport: ${end - tracks.x} of ${tracks.width}`);
  await page.keyboard.press(`${mod}+Minus`);
  await page.waitForTimeout(200);
  expect((await onTrack("track-main-video"))[0].width < main[0].width, "the zoom-out key zooms out");
  await tid("tool-zoom-fit").click();
  await page.waitForTimeout(200);
  pxPerSecond = (await onTrack("track-main-video"))[0].width / 2;
});

await step("a marker is added at the playhead and shown on the ruler", async () => {
  await seekTo(1);
  await tid("tool-marker").click();
  await page.waitForTimeout(200);
  expect((await page.getByTestId("tl-ctl-marker").count()) === 1, "one marker flag on the ruler");
  await saved();
});

await step("sound and a picture join the timeline by click", async () => {
  // A sound has a waveform where a picture has a thumbnail: its tile is pressed on its name.
  await tid("label-tone.wav").dblclick();
  await page.waitForFunction(() => document.querySelector('[data-testid="track-audio-audio"] [data-testid^="clip-"]') !== null, null, { timeout: 10_000 });
  await page.keyboard.press("End");
  await tid("thumb-still.png").dblclick();
  await page.waitForTimeout(600);
  expect((await mainCount()) === 3, "the picture is appended to the main track");
  await tid("tool-zoom-fit").click();
  await saved();
});

let beforeReload = [];
await step("a reload restores the same timeline and its view", async () => {
  await page.waitForTimeout(800);
  beforeReload = (await clips()).map((clip) => [clip.track, clip.x, clip.width]);
  const playhead = await timecode();
  await page.reload({ waitUntil: "networkidle" });
  await tid("timeline").waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="track-main-video"] [data-testid^="clip-"]').length >= 3, null, { timeout: 30_000 });
  await page.waitForTimeout(800);
  const after = (await clips()).map((clip) => [clip.track, clip.x, clip.width]);
  expect(JSON.stringify(after) === JSON.stringify(beforeReload), `the same clips at the same places:\n${JSON.stringify(beforeReload)}\n${JSON.stringify(after)}`);
  expect((await timecode()) === playhead, `the playhead is where it was (${playhead}), got ${await timecode()}`);
  expect((await page.getByTestId("tl-ctl-marker").count()) === 1, "the marker is still there");
  expect(await tid("bar-undo").isDisabled(), "the history of the last session is gone");
  await page.keyboard.press("Home");
  await page.waitForTimeout(1200);
  expect((await previewColour()).name === "red", `the preview draws the stored media after the reload: ${JSON.stringify(await previewColour())}`);
});

await step("the timeline is operated by keyboard only", async () => {
  await page.keyboard.press("Escape");
  await page.keyboard.press("Home");
  expect((await timecode()) === "00:00:00:00", "Home goes to the start");
  await page.keyboard.press("ArrowRight");
  expect((await timecode()) === "00:00:00:01", "Right steps one frame");
  await page.keyboard.press("Shift+ArrowRight");
  expect((await timecode()) === "00:00:00:11", "Shift+Right steps ten frames");
  // Cut points are the starts and ends of every clip: the sound starts at 1 s, the first main clip ends at 2 s.
  await page.keyboard.press("ArrowDown");
  expect((await timecode()) === "00:00:01:00", `Down goes to the next cut point, got ${await timecode()}`);
  await page.keyboard.press("ArrowDown");
  expect((await timecode()) === "00:00:02:00", `Down again goes to the cut after it, got ${await timecode()}`);
  await page.keyboard.press("ArrowLeft"); await page.keyboard.press("ArrowLeft"); await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("]");
  await page.waitForTimeout(150);
  const selected = (await clips()).filter((clip) => clip.selected);
  expect(selected.length === 1, `] selects a clip, selected ${selected.length}`);
  const count = (await clips()).length;
  await page.keyboard.press(`${mod}+b`);
  await page.waitForTimeout(200);
  expect((await clips()).length === count + 1, "the split key cuts the selected clip at the playhead");
  await page.keyboard.press(`${mod}+z`);
  await page.waitForTimeout(200);
  expect((await clips()).length === count, "the undo key takes the split back");
  await page.keyboard.press(`${mod}+d`);
  await page.waitForTimeout(200);
  expect((await clips()).length === count + 1, "the duplicate key copies the selection");
  await page.keyboard.press("Delete");
  await page.waitForTimeout(200);
  expect((await clips()).length === count, "Delete removes the selected copy");
  await page.keyboard.press(`${mod}+a`);
  await page.waitForTimeout(150);
  expect((await clips()).every((clip) => clip.selected), "select all selects every clip");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  expect((await clips()).every((clip) => !clip.selected), "Escape clears the selection");
  await page.keyboard.press("m");
  await page.waitForTimeout(150);
  expect((await page.getByTestId("tl-ctl-marker").count()) === 2, "M adds a marker at the playhead");
  const startedAt = await timecode();
  await page.keyboard.press("Space");
  await button("Pause").waitFor({ timeout: 5000 });
  await page.waitForFunction((from) => document.querySelector('[data-testid="timecode"]').value > from, startedAt, { timeout: 10_000 });
  await page.keyboard.press("k");
  await button("Play").waitFor({ timeout: 5000 });
  expect((await timecode()) > startedAt, `Space plays and K stops: ${startedAt} → ${await timecode()}`);
  // Track rows are lists named by their track; every clip is exposed with its role, name, start and duration.
  const labels = (await clips()).map((clip) => clip.label);
  expect(labels.every((label) => /clip, .+, starts \d\d:\d\d:\d\d:\d\d, duration \d\d:\d\d:\d\d:\d\d/.test(label)), `clips carry their description: ${labels[0]}`);
});

await step("the preview: select on the canvas, move with the inspector following, undo", async () => {
  await seekTo(0.5);
  const canvas = await tid("canvas").boundingBox();
  await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await tid("handle-rotate").waitFor({ timeout: 5000 });
  expect((await page.locator('[data-testid^="handle-"]').count()) === 9, "eight resize handles and the rotate handle");
  await drag({ x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 }, { x: canvas.x + canvas.width / 2 + 60, y: canvas.y + canvas.height / 2 + 30 });
  const x = Number(await visible(page.getByLabel("X", { exact: true })).inputValue());
  expect(x > 100, `the element moved right on the canvas, X = ${x}`);
  await page.keyboard.press(`${mod}+z`);
  await page.waitForTimeout(200);
  expect(Number(await visible(page.getByLabel("X", { exact: true })).inputValue()) === 0, "one undo puts it back");
  await page.keyboard.press("Escape");
});


const rgb = (hex) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
const clipFills = () => page.evaluate(() => [...document.querySelectorAll('[data-testid^="track-"] [data-testid^="clip-"]')].flatMap((node) => [...node.querySelectorAll("div")].slice(0, 3).map((inner) => getComputedStyle(inner).backgroundColor)));

await step("context menus: a clip offers the engine's items, a track row its own; a locked track is hatched and refuses a drag", async () => {
  const [first] = await onTrack("track-main-video");
  await page.mouse.click(first.x + first.width / 2, first.y + first.height / 2, { button: "right" });
  for (const item of ["Split", "Copy", "Duplicate", "Mute", "Extract audio", "To overlay", "Freeze frame", "Replace media", "Delete clip", "Ripple delete"]) await menuItem(item).waitFor({ timeout: 5000 });
  await menuItem("Duplicate").click();
  await page.waitForTimeout(250);
  expect((await mainCount()) === 4, "Duplicate from the menu copies the clip");
  await page.keyboard.press(`${mod}+z`);
  const tracks = await tracksBox(), audio = (await onTrack("track-audio-audio"))[0];
  await page.mouse.click(tracks.x + tracks.width - 30, audio.y + 10, { button: "right" });
  for (const item of ["Add track", "Rename track", "Mute track", "Lock track", "Select all on track", "Delete track"]) await menuItem(item).waitFor({ timeout: 5000 });
  await menuItem("Lock track").click();
  await tid("lane-hatch").waitFor({ timeout: 5000 });
  const before = (await onTrack("track-audio-audio"))[0].x;
  await drag({ x: audio.x + 40, y: audio.y + 20 }, { x: audio.x + 140, y: audio.y + 20 });
  expect((await onTrack("track-audio-audio"))[0].x === before, "a clip on a locked track does not move");
  await button("Unlock").click();
  await page.waitForTimeout(200);
  expect((await page.getByTestId("lane-hatch").count()) === 0, "the header's lock button unlocks the track");
});

await step("track headers: hide, mute and rename; the marker opens its editor and is deleted there; scenes are created and switched", async () => {
  await button("Hide").first().click();
  await button("Show").waitFor({ timeout: 5000 });
  await button("Show").click();
  await page.getByTestId("track-name-main").dblclick();
  await page.getByLabel("Rename track").fill("Story");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector('[data-testid="track-name-main"]')?.textContent === "Story", null, { timeout: 5000 });
  const flags = await page.getByTestId("tl-ctl-marker").count();
  await page.getByTestId("tl-ctl-marker").first().click();
  await tid("marker-note").fill("Intro ends");
  await tid("marker-delete").click();
  await page.waitForTimeout(250);
  expect((await page.getByTestId("tl-ctl-marker").count()) === flags - 1, "the marker is deleted from its editor");
  await tid("tool-scenes").click();
  await tid("scene-new").click();
  await page.waitForTimeout(300);
  expect((await page.getByTestId("scene-row-1").count()) === 1, "a second scene exists");
  await button("Close").click();
  await tid("main-placeholder").waitFor({ timeout: 5000 });
  await tid("tool-scenes").click();
  await visible(page.getByTestId("scene-row-0").getByRole("button").first()).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="track-main-video"] [data-testid^="clip-"]').length >= 3, null, { timeout: 5000 });
});

await step("track header: solo adds no undo step; volume and pan are set in the header popover; Cover button opens the cover editor and saves a frame", async () => {
  const undoBefore = await tid("bar-undo").getAttribute("aria-label");
  await tid("track-solo-audio").click();
  expect((await tid("track-solo-audio").getAttribute("aria-pressed")) === "true", "the audio track is soloed");
  expect((await tid("bar-undo").getAttribute("aria-label")) === undoBefore, "solo is not an undo step");
  await tid("track-solo-audio").click();
  await tid("track-sound-audio").click();
  await tid("track-sound-panel").waitFor();
  const volume = visible(page.getByRole("slider", { name: "Track volume" }));
  await volume.focus();
  for (let press = 0; press < 5; press++) await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(200);
  expect((await tid("track-volume-value").innerText()) !== "0.0 dB", `the volume slider lowers the track: ${await tid("track-volume-value").innerText()}`);
  const pan = visible(page.getByRole("slider", { name: "Track pan" }));
  await pan.focus();
  for (let press = 0; press < 3; press++) await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(200);
  expect((await tid("track-pan-value").innerText()).startsWith("L "), `the pan slider moves left: ${await tid("track-pan-value").innerText()}`);
  await page.keyboard.press("Escape");
  await tid("track-cover").click();
  await tid("cover-editor").waitFor();
  await tid("cover-preview").waitFor({ timeout: 15_000 });
  expect((await tid("cover-time").innerText()) === "00:00:00:00", "the cover editor opens on frame 0");
  await tid("cover-save").click();
  await visible(page.getByText("Cover updated", { exact: true })).waitFor({ timeout: 20_000 });
  await tid("track-cover").click();
  expect(!(await tid("cover-reset").isDisabled()), "a saved cover can be reset");
  await tid("cover-reset").click();
  await page.waitForTimeout(300);
  await saved();
});

await step("player: timecode entry, frame steps, loop, rate, volume, guides, quality, zoom and the shortcut sheet", async () => {
  await tid("timecode").fill("abc");
  await page.keyboard.press("Enter");
  expect((await tid("timecode").getAttribute("aria-invalid")) === "true", "text that is not a time shows the error style and stays in edit mode");
  await tid("timecode").fill("00:00:01:15");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  expect((await timecode()) === "00:00:01:15", `typing a time seeks there, got ${await timecode()}`);
  await tid("player-step-forward").click();
  expect((await timecode()) === "00:00:01:16", "step forward is one frame");
  await tid("player-end").click();
  const end = (await tid("player-duration").innerText()).replace("/ ", "");
  expect((await timecode()) === end, "go to end rests on the scene duration");
  await tid("player-start").click();
  await tid("player-loop").click();
  expect((await tid("player-loop").getAttribute("aria-pressed")) === "true", "loop is on");
  await tid("player-loop").click();
  await tid("player-rate").click();
  await menuItem("2×").click();
  expect((await tid("player-rate").innerText()).includes("2×"), "the rate menu shows 2×");
  await tid("player-rate").click();
  await menuItem("1×").click();
  await tid("player-volume").click();
  await tid("volume-mute").click();
  expect((await tid("volume-value").innerText()) === "0%", "the speaker button mutes");
  await tid("volume-mute").click();
  expect((await tid("volume-value").innerText()) === "100%", "and restores the volume");
  await page.keyboard.press("Escape");
  await tid("player-guides").click();
  await tid("guides-popover").waitFor();
  await visible(tid("guides-grid").getByRole("switch")).click();
  expect((await page.getByTestId("guide-grid").count()) === 4, "the default grid draws two vertical and two horizontal lines");
  await visible(tid("guides-safe").getByRole("switch")).click();
  expect((await page.getByTestId("guide-safe").count()) === 1, "a safe area is drawn together with the grid");
  await visible(tid("guides-grid").getByRole("switch")).click();
  await visible(tid("guides-safe").getByRole("switch")).click();
  await page.keyboard.press("Escape");
  await tid("player-quality").click();
  await menuItem("1/2").click();
  expect((await tid("player-quality").innerText()).includes("1/2"), "preview quality 1/2");
  await tid("player-quality").click();
  await menuItem("Auto").click();
  await tid("player-zoom").click();
  await menuItem("200%").click();
  expect((await tid("player-zoom").innerText()).includes("200%"), "zoom preset 200 %");
  await tid("player-zoom").click();
  await menuItem("Fit").click();
  expect((await tid("player-zoom").innerText()).includes("Fit"), "back to Fit");
  await tid("open-shortcuts").click();
  await tid("shortcut-sheet").waitFor();
  await button("Close").click();
});

await step("inspector: typed position, flip, rotate 90°, opacity, reset; region toggles; project settings from the aspect button", async () => {
  await seekTo(0.5);
  const [first] = await onTrack("track-main-video");
  await clickClip(first);
  await visible(page.getByLabel("X", { exact: true })).waitFor();
  const x = visible(page.getByLabel("X", { exact: true }));
  await x.fill("120");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  expect((await x.inputValue()) === "120", "position X is committed");
  await tid("flip-horizontal").click();
  expect((await tid("flip-horizontal").getAttribute("aria-pressed")) === "true", "flip horizontal is on");
  await tid("tool-rotate-90").click();
  expect((await visible(page.getByLabel("Rotation", { exact: true })).inputValue()) === "90", "rotate 90° adds a quarter turn");
  await tid("reset-transform").click();
  await page.waitForTimeout(200);
  expect((await x.inputValue()) === "0" && (await tid("flip-horizontal").getAttribute("aria-pressed")) !== "true", "reset transform returns position, rotation and flips");
  await tid("crop-open").click();
  await visible(page.getByLabel("Left", { exact: true })).fill("10");
  await page.keyboard.press("Enter");
  await tid("crop-apply").click();
  await page.keyboard.press(`${mod}+z`);
  await page.keyboard.press("Escape");
  await tid("toggle-inspector").click();
  expect((await page.getByTestId("inspector").filter({ visible: true }).count()) === 0, "the inspector closes");
  await tid("toggle-inspector").click();
  await tid("toggle-assets").click();
  await tid("toggle-assets").click();
  await tid("toggle-timeline").click();
  expect((await page.getByTestId("timeline").filter({ visible: true }).count()) === 0, "the timeline closes");
  await tid("toggle-timeline").click();
  await tid("timeline").waitFor();
  await tid("player-aspect").click();
  await visible(page.getByText("Project settings", { exact: true })).waitFor();
  await button("Close").click();
  await tid("inspector-modify").click();
  await visible(page.getByText("Project settings", { exact: true })).waitFor();
  await button("Close").click();
});

await step("asset tabs: Text adds a text clip on its own track; Audio lists the project's sounds", async () => {
  await tid("panel-tab-text").click();
  await tid("text-add").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="track-overlay-text"] [data-testid^="clip-"]') !== null, null, { timeout: 5000 });
  // The text is typed in the inspector and drawn by the engine: the stage shows light glyph pixels over the picture.
  await tid("text-content").fill("HELLO WORLD HELLO");
  await tid("panel-tab-audio").click();
  await page.waitForTimeout(800);
  const stage = await tid("canvas").boundingBox();
  const strip = await page.screenshot({ clip: { x: Math.round(stage.x + stage.width * 0.2), y: Math.round(stage.y + stage.height / 2) - 1, width: Math.round(stage.width * 0.6), height: 2 } });
  const white = await page.evaluate(async (data) => { const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob()); const canvas = new OffscreenCanvas(bitmap.width, 1), context2d = canvas.getContext("2d"); context2d.drawImage(bitmap, 0, 0); const pixels = context2d.getImageData(0, 0, bitmap.width, 1).data; let count = 0; for (let index = 0; index < pixels.length; index += 4) if (pixels[index] > 200 && pixels[index + 1] > 200 && pixels[index + 2] > 200) count++; return count; }, strip.toString("base64"));
  expect(white > 20, `the typed text is drawn in the preview (${white} light pixels on the middle line)`);
  expect((await page.getByTestId("audio-row").count()) === 1, "one sound in the Audio tab");
  await tid("panel-tab-media").click();
  await tid("label-red.mp4").waitFor();
});

await step("export renders the scene to an MP4 file", async () => {
  await tid("open-export").click();
  await tid("export-dialog").waitFor();
  const download = page.waitForEvent("download", { timeout: 300_000 }).catch(() => null);
  await tid("export-start").click();
  const file = await Promise.race([download, tid("export-error").waitFor({ timeout: 300_000 }).then(() => null, () => null)]);
  expect(file !== null, `the export finished with a file; the dialog reads: ${(await tid("export-dialog").innerText()).replace(/\s+/g, " ").slice(-200)}`);
  expect(file.suggestedFilename().endsWith(".mp4"), `an MP4 is saved: ${file.suggestedFilename()}`);
  await tid("export-done").waitFor({ timeout: 10_000 });
  const path = join(dir, "exported.mp4");
  await file.saveAs(path);
  const probe = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_name,width,height", "-of", "json", path]).toString();
  const info = JSON.parse(probe);
  expect(info.streams.some((stream) => stream.codec_name === "h264" && stream.width === 1920 && stream.height === 1080), `the file holds H.264 1920 × 1080: ${probe.replace(/\s+/g, " ")}`);
  expect(Math.abs(Number(info.format.duration) - Number(end2seconds(await tid("player-duration").innerText()))) < 0.2, `its duration is the scene's: ${info.format.duration}`);
  await button("Close").click();
});

for (const [name, size, scheme] of [["10-editor-1440-light", { width: 1440, height: 900 }, "light"], ["11-editor-1440-dark", { width: 1440, height: 900 }, "dark"], ["12-editor-390-light", { width: 390, height: 844 }, "light"], ["13-editor-390-dark", { width: 390, height: 844 }, "dark"]]) {
  await step(`screenshot ${name}`, async () => {
    await page.setViewportSize(size);
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(1200);
    if (size.width === 1440) { const main = await onTrack("track-main-video"); if (main[0]) await clickClip(main[0]); await page.waitForTimeout(400); }
    for (const id of ["player", "timeline"]) await tid(id).waitFor({ timeout: 10_000 });
    // Fills come from tokens: every clip fill equals the value of its `clip/*` token in the active theme.
    const fills = await clipFills();
    for (const [token, hex] of [["clip/video", "#2D6CEA"], ["clip/audio", "#258154"], ["clip/image", "#8B53D9"], ["clip/text", "#AD5F1A"]]) expect(fills.includes(rgb(hex)), `${token} is ${hex} in the ${scheme} theme`);
    await shot(name);
    if (size.width === 1440) {
      // The design frame on the left, this screen on the right, same theme: what the two are compared on.
      const design = await context.newPage();
      await design.setViewportSize({ width: 1700, height: 1100 });
      await design.emulateMedia({ colorScheme: scheme });
      await design.goto(`file://${process.cwd()}/docs/design/jagentchill-ui.html`);
      if (scheme === "dark") await design.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
      const frame = design.locator("#d-editor .dframe").first();
      await frame.scrollIntoViewIfNeeded();
      const left = (await frame.screenshot()).toString("base64"), right = (await page.screenshot()).toString("base64");
      await design.setViewportSize({ width: 2440, height: 820 });
      await design.setContent(`<body style="margin:0;background:#888;font:600 16px system-ui;color:#fff"><div style="display:flex;gap:20px;padding:10px"><div><div>DESIGN d-editor</div><img style="width:1200px;display:block" src="data:image/png;base64,${left}"></div><div><div>APP /editor</div><img style="width:1200px;display:block" src="data:image/png;base64,${right}"></div></div></body>`);
      mkdirSync(".dev/compare", { recursive: true });
      await design.screenshot({ path: `.dev/compare/d-editor-${scheme}.png` });
      await design.close();
      await page.keyboard.press("Escape");
    }
  });
}

console.log(errors.length ? `\n${errors.length} problem(s):\n${errors.join("\n")}` : "\nno problems");
await browser.close();
process.exit(errors.length ? 1 : 0);
