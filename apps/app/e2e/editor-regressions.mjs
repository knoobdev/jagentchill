// End-to-end in a real browser at 1440 × 900 (the wide layout), with no host: three defects that were found through the
// phone layout and are the engine's, checked here on the wide one. Real storage, real media made with ffmpeg, nothing seeded.
//  1. Replace media: the preview shows the new media (it kept the old picture: the video texture was cached without its asset).
//  2. Freeze frame of a clip that has an effect (it was refused: the copied effect kept its id).
//  3. An emoji sticker is drawn in the preview as its colour glyph and the project exports (the colour font was never
//     handed to the engine for a sticker: an empty box in the preview, `export/font-unavailable` on export).
// The compact layout is covered by editor-mobile.mjs. A headless browser has no save dialog: the export is read as a download.
// Usage: node apps/app/e2e/editor-regressions.mjs [screenshot-dir] [base-url]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const shots = process.argv[2] ?? ".dev/shots/editor-regressions";
const base = process.argv[3] ?? "http://localhost:8096";
mkdirSync(shots, { recursive: true });
const dir = join(tmpdir(), "jagentchill-editor-mobile-e2e");
mkdirSync(dir, { recursive: true });
const ffmpeg = (...args) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args]);
const media = (name) => join(dir, name);
if (!existsSync(media("first.mp4"))) ffmpeg("-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=4", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", media("first.mp4"));
if (!existsSync(media("second.mp4"))) ffmpeg("-f", "lavfi", "-i", "testsrc=s=640x360:r=30:d=3", "-f", "lavfi", "-i", "sine=frequency=880:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", media("second.mp4"));

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light", acceptDownloads: true });
await context.addInitScript(() => { delete window.showSaveFilePicker; delete window.showDirectoryPicker; });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
const visible = (locator) => locator.filter({ visible: true }).first();
const tid = (id) => visible(page.getByTestId(id));
const expect = (condition, message) => { if (!condition) throw new Error(message); };
const wait = (ms) => page.waitForTimeout(ms);
let failed = 0;
const step = async (name, run) => {
  try { await run(); console.log("ok  ", name); }
  catch (err) { failed++; console.log("FAIL", name, "—", String(err).split("\n")[0]); await page.screenshot({ path: `${shots}/failure-${failed}.png` }).catch(() => undefined); await page.keyboard.press("Escape").catch(() => undefined); }
};
const grab = async (clip) => { const box = clip ?? await tid("canvas").boundingBox(); return page.screenshot({ clip: { x: Math.ceil(box.x) + 2, y: Math.ceil(box.y) + 2, width: Math.floor(box.width) - 4, height: Math.floor(box.height) - 4 } }); };
/** The share of pixels that differ between two grabs, and the share of a grab that is not black. */
const measure = (a, b) => page.evaluate(async ([first, second]) => {
  const load = async (data) => { const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob()); const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context2d = canvas.getContext("2d"); context2d.drawImage(bitmap, 0, 0); return context2d.getImageData(0, 0, bitmap.width, bitmap.height); };
  const one = await load(first), two = second ? await load(second) : null;
  let changed = 0, lit = 0;
  for (let index = 0; index < one.data.length; index += 4) {
    if (one.data[index] + one.data[index + 1] + one.data[index + 2] > 90) lit++;
    if (two && Math.abs(one.data[index] - two.data[index]) + Math.abs(one.data[index + 1] - two.data[index + 1]) + Math.abs(one.data[index + 2] - two.data[index + 2]) > 24) changed++;
  }
  return { changed: changed / (one.data.length / 4), lit: lit / (one.data.length / 4) };
}, [a.toString("base64"), b ? b.toString("base64") : null]);
const mainClips = () => page.evaluate(() => [...document.querySelectorAll('[data-testid="track-main-video"] [data-testid^="clip-"]')].filter((node) => /^clip-[0-9a-f]{8}-/.test(node.getAttribute("data-testid"))).length);
const newProject = async () => {
  await page.goto(`${base}/projects`, { waitUntil: "networkidle", timeout: 240_000 });
  await visible(page.getByRole("button", { name: /^(Create your first project|New project)$/ })).click({ timeout: 90_000 });
  await page.waitForURL(/\/editor\/[0-9a-f-]{36}$/);
  await tid("timeline").waitFor({ timeout: 60_000 });
  await tid("canvas").waitFor();
};

await step("Replace media — the preview shows the new media at the same playhead", async () => {
  await newProject();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), tid("media-dropzone").click()]);
  await chooser.setFiles([media("first.mp4"), media("second.mp4")]);
  await tid("label-second.mp4").waitFor({ timeout: 60_000 });
  await tid("thumb-first.mp4").dblclick();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="track-main-video"] [data-testid^="clip-"]').length >= 1);
  await wait(2000);
  const before = await grab();
  await page.locator('[data-testid="track-main-video"] [data-testid^="clip-"]').first().click({ button: "right" });
  await visible(page.locator('[role^="menuitem"]').filter({ hasText: "Replace media" })).click();
  await tid("replace-list").getByText("second.mp4").click();
  await wait(2500);
  const result = await measure(await grab(), before);
  expect(result.changed > 0.05, `the preview changed after Replace media: ${result.changed}`);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await wait(1500);
  expect((await measure(await grab(), before)).changed < 0.01, "Undo shows the first media again");
});

await step("Freeze frame of a clip that has an effect — the freeze is inserted, not refused", async () => {
  await page.locator('[data-testid="track-main-video"] [data-testid^="clip-"]').first().click();
  await tid("panel-tab-effects").click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid^="fx-tile-effect-"]').length >= 3, null, { timeout: 60_000 });
  await visible(page.locator('[data-testid^="fx-tile-effect-"] [role="button"]')).click();
  await wait(600);
  const field = tid("timecode");
  await field.click(); await field.fill("00:00:01:00"); await field.press("Enter");
  await wait(400);
  const before = await mainClips();
  if (await page.getByTestId("tool-freeze").count()) await tid("tool-freeze").click();
  else { await tid("tool-overflow").click(); await visible(page.locator('[role^="menuitem"]').filter({ hasText: "Freeze" })).click(); }
  await wait(800);
  const after = await mainClips();
  const refused = await page.evaluate(() => [...document.querySelectorAll('[role="alert"], [role="status"]')].map((node) => node.textContent ?? "").filter((text) => /used by two/.test(text)).join(" | "));
  expect(after === before + 2 && refused === "", `the clip is split around a freeze element: ${before} → ${after} ${refused}`);
});

await step("Emoji sticker — drawn as its colour glyph in the preview, and the project exports with it", async () => {
  await newProject();
  await tid("panel-tab-stickers").click();
  await visible(page.locator('[data-testid^="sticker-emoji-"]')).click();
  await page.getByTestId("selection-box").first().waitFor({ timeout: 15_000 });
  await wait(1500);
  const box = await tid("selection-box").boundingBox();
  // On the black canvas of an empty project: a glyph of the colour font lights most of its box, an empty box only its outline.
  await page.locator('[data-testid="timeline-ruler"]').click({ position: { x: 300, y: 6 } }).catch(() => undefined);
  await page.keyboard.press("Escape");
  await wait(700);
  // The colour font is loaded and the glyph rasterised after the sticker is placed: the box is read until it is lit, for up to 12 s.
  const read = async () => (await measure(await grab({ x: box.x + box.width * 0.2, y: box.y + box.height * 0.2, width: box.width * 0.6, height: box.height * 0.6 }), null)).lit;
  let lit = await read();
  for (let tries = 0; tries < 24 && !(lit > 0.5); tries++) { await wait(500); lit = await read(); }
  await page.screenshot({ path: `${shots}/emoji-preview.png` });
  expect(lit > 0.5, `the emoji fills its box in the preview: ${lit}`);
  await tid("open-export").click();
  await tid("export-dialog").waitFor();
  await wait(1000);
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 180_000 }), tid("export-start").click()]);
  await tid("export-done").waitFor({ timeout: 60_000 });
  const path = join(shots, "emoji.mp4");
  await download.saveAs(path);
  // One frame of the file: the glyph is in it.
  const png = join(shots, "emoji-frame.png");
  ffmpeg("-ss", "0.5", "-i", path, "-frames:v", "1", png);
  const stats = execFileSync("ffmpeg", ["-v", "error", "-i", png, "-vf", "signalstats,metadata=print:file=-", "-f", "null", "-"]).toString();
  const yavg = Number(/YAVG=([\d.]+)/.exec(stats)?.[1] ?? 0), ymax = Number(/YMAX=([\d.]+)/.exec(stats)?.[1] ?? 0);
  console.log("      exported frame luma: average", yavg, "max", ymax);
  expect(ymax > 120 && yavg > 17, `the exported frame holds the glyph: YAVG ${yavg}, YMAX ${ymax}`);
});

console.log(`${failed === 0 && errors.length === 0 ? "PASS" : "FAIL"} editor-regressions: ${failed} failed steps, ${errors.length} page errors`);
for (const text of errors.slice(0, 6)) console.log("   ", text.slice(0, 240));
await browser.close();
process.exit(failed === 0 && errors.length === 0 ? 0 : 1);
