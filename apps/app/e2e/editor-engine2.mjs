// End-to-end in a real browser against the web app, with no host: what the editor does with the engine features added
// last — clip animations, motion blur, smooth slow-mo, Keep pitch, the matte view and the eyedropper of the chroma
// key, mask keyframes, the voice effects and the fade handles of audio clips.
// Real storage (IndexedDB and OPFS of a fresh browser profile) and real media files made with ffmpeg; nothing is
// seeded or mocked. Every picture check reads the pixels the preview canvas really shows (from a screenshot of it),
// every sound check reads a WAV file the app exported.
// Usage: node apps/app/e2e/editor-engine2.mjs [screenshot-dir] [base-url]   (ONLY=<text> runs the steps whose name contains it)
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const shots = process.argv[2] ?? ".dev/shots/editor-engine2";
const base = process.argv[3] ?? "http://localhost:8081";
mkdirSync(shots, { recursive: true });

// — Media made here with ffmpeg —
const dir = join(tmpdir(), "jagentchill-editor-engine2-e2e");
mkdirSync(dir, { recursive: true });
const ffmpeg = (...args) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args]);
const media = (name) => join(dir, name);
// A 4 s red clip with a 440 Hz tone.
if (!existsSync(media("red.mp4"))) ffmpeg("-f", "lavfi", "-i", "color=c=red:s=640x360:r=30:d=4", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", media("red.mp4"));
// A 2 s clip whose frames alternate black and white, every frame a key frame: two neighbouring source frames never look alike.
if (!existsSync(media("flicker.mp4"))) ffmpeg("-f", "lavfi", "-i", "color=c=black:s=320x180:r=30:d=2,format=yuv420p,geq=lum='255*mod(N,2)':cb=128:cr=128", "-c:v", "libx264", "-g", "1", "-crf", "8", "-pix_fmt", "yuv420p", media("flicker.mp4"));
// A picture whose left half is pure green and whose right half is red.
if (!existsSync(media("split.png"))) ffmpeg("-f", "lavfi", "-i", "color=c=0x00ff00:s=320x360:d=1", "-f", "lavfi", "-i", "color=c=0xff0000:s=320x360:d=1", "-filter_complex", "hstack", "-frames:v", "1", media("split.png"));
// A voice stand-in: a 450 Hz tone with harmonics for 0.5 s, then 1.5 s of silence (an echo or a hall is heard in the silence).
// 450 Hz lies between two semitones, so an effect that tunes the voice moves it.
if (!existsSync(media("voice450.wav"))) ffmpeg("-f", "lavfi", "-i", "aevalsrc='if(lt(t,0.5),0.4*sin(2*PI*450*t)+0.15*sin(2*PI*900*t)+0.1*sin(2*PI*1350*t),0)':s=48000:d=2", "-ac", "2", media("voice450.wav"));

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light", acceptDownloads: true });
// A headless browser has no save dialog to answer: without the picker an export is offered as a download, the path this script reads.
await context.addInitScript(() => { delete window.showSaveFilePicker; delete window.showDirectoryPicker; });
const page = await context.newPage();
const errors = [], measured = {};
page.on("pageerror", (err) => { console.log("      pageerror:", err.message.slice(0, 200), process.env.ONLY ? err.stack : ""); errors.push(`pageerror: ${err.message}`); });
page.on("console", (msg) => { if (msg.type() === "error" && !/Failed to load resource|favicon/.test(msg.text())) errors.push(msg.text().slice(0, 400)); });
const visible = (locator) => locator.filter({ visible: true }).first();
const tid = (id) => visible(page.getByTestId(id));
const button = (name, exact = true) => visible(page.getByRole("button", { name, exact }));
const tab = (name) => visible(page.getByRole("tab", { name, exact: true }));
const option = (name) => visible(page.getByRole("option", { name, exact: true }));
const menuItem = (name) => visible(page.locator('[role^="menuitem"]').filter({ has: page.getByText(name, { exact: true }) }));
const shot = (name) => page.screenshot({ path: `${shots}/${name}.png` });
const expect = (condition, message) => { if (!condition) throw new Error(message); };
const step = async (name, run) => {
  if (process.env.ONLY && !name.toLowerCase().includes(process.env.ONLY.toLowerCase())) return;
  try { await run(); console.log("ok  ", name); }
  catch (err) { console.log("FAIL", name, "—", String(err).split("\n").slice(0, 3).join(" | ")); errors.push(`step failed: ${name}`); await shot(`failure-${name.replace(/[^a-z0-9]+/gi, "-").slice(0, 48)}`).catch(() => undefined); await page.keyboard.press("Escape").catch(() => undefined); }
};
const settle = (ms = 450) => page.waitForTimeout(ms);
const saved = () => visible(page.getByTestId("save-state").getByText("Saved", { exact: true })).waitFor({ timeout: 20_000 });
const note = (name, value) => { measured[name] = value; console.log("      measured", name, JSON.stringify(value)); };
/** Types a time into the player's timecode field: frames at 30 fps. */
const seekFrame = async (frames) => {
  const text = `00:00:${String(Math.floor(frames / 30)).padStart(2, "0")}:${String(frames % 30).padStart(2, "0")}`;
  const field = tid("timecode");
  await field.click(); await field.fill(text); await field.press("Enter");
  await settle(500);
};
const seek = (seconds) => seekFrame(Math.round(seconds * 30));
const timecode = () => tid("timecode").inputValue();
/** The preview canvas as pixels: its middle row and the column an eighth in from the left, read from a screenshot of the canvas box. */
const picture = async () => {
  const box = await tid("canvas").boundingBox();
  const png = await page.screenshot({ clip: { x: Math.ceil(box.x), y: Math.ceil(box.y), width: Math.floor(box.width) - 1, height: Math.floor(box.height) - 1 } });
  return page.evaluate(async (data) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context2d = canvas.getContext("2d");
    context2d.drawImage(bitmap, 0, 0);
    const { width, height } = bitmap, pixels = context2d.getImageData(0, 0, width, height).data;
    const at = (x, y) => { const index = (Math.min(height - 1, Math.max(0, Math.round(y))) * width + Math.min(width - 1, Math.max(0, Math.round(x)))) * 4; return [pixels[index], pixels[index + 1], pixels[index + 2]]; };
    return { width, height, row: Array.from({ length: width }, (_, x) => at(x, height / 2)), column: Array.from({ length: height }, (_, y) => at(width / 8, y)), centre: at(width / 2, height / 2) };
  }, png.toString("base64"));
};
const colourAt = async (fx = 0.5, fy = 0.5) => {
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
const say = (c) => (Array.isArray(c) ? `rgb(${c.join(", ")})` : `rgb(${c.r}, ${c.g}, ${c.b})`);
/** The red stretch of a row of the preview, as fractions of its width: where the red clip is. */
const redSpan = (row) => { const on = row.map((pixel) => pixel[0] > 128 && pixel[1] < 90); const first = on.indexOf(true), last = on.lastIndexOf(true); return first < 0 ? null : { left: first / row.length, right: (last + 1) / row.length }; };
/** The length, in pixels of the profile, over which the red channel goes from 10 % to 90 % of its range along an edge. */
const edgeWidth = (profile) => {
  const reds = profile.map((pixel) => pixel[0]), high = Math.max(...reds), low = Math.min(...reds);
  if (high - low < 60) return 0;
  const partial = reds.map((value) => (value - low) / (high - low)).filter((value) => value > 0.1 && value < 0.9).length;
  return partial;
};
const clips = () => page.evaluate(() => [...document.querySelectorAll('[data-testid^="clip-"]')].filter((node) => !["clip-selection", "clip-hover", "clip-hatch", "clip-mute", "clip-reverse"].includes(node.getAttribute("data-testid"))).map((node) => {
  const rect = node.getBoundingClientRect();
  return { id: node.getAttribute("data-testid").slice(5), x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) };
}).sort((a, b) => a.y - b.y || a.x - b.x));
const clickClip = async (clip) => { await page.mouse.click(clip.x + clip.width / 2, clip.y + clip.height - 6); await settle(250); };
const importFiles = async (paths) => { const [chooser] = await Promise.all([page.waitForEvent("filechooser"), tid("media-dropzone").click()]); await chooser.setFiles(paths); };
const typeNumber = async (id, value) => { const input = tid(id).locator("input").first(); await input.click(); await input.fill(String(value)); await input.press("Enter"); await settle(400); };
const numberOf = async (id) => Number((await tid(id).locator("input").first().inputValue()).replace(/[^\d.\-]/g, ""));
const fieldByLabel = (label) => visible(tid("inspector").locator(`input[aria-label="${label}"]:not([type="range"])`));
const setLabelled = async (label, value) => { const input = fieldByLabel(label); await input.click(); await input.fill(String(value)); await input.press("Enter"); await settle(400); };
const pressed = (id) => tid(id).getAttribute("aria-pressed");
const undo = async () => { await tid("bar-undo").click(); await settle(300); };
const playEnded = async () => { await button("Play").waitFor({ timeout: 15_000 }); await settle(350); };
let first = true;
/** A new project with one file on its timeline (a picture or a video on the main track, a sound on an audio track). */
const newProject = async (file) => {
  await page.goto(`${base}/projects`, { waitUntil: "networkidle", timeout: 180_000 });
  await button(first ? "Create your first project" : "New project").click({ timeout: 90_000 });
  first = false;
  await page.waitForURL(/\/editor\/[0-9a-f-]{36}$/);
  for (const id of ["editor-bar", "asset-panel", "player", "inspector", "timeline"]) await tid(id).waitFor({ timeout: 60_000 });
  await importFiles([media(file)]);
  await tid(`label-${file}`).waitFor({ timeout: 60_000 });
  // A picture or a video goes on from its thumbnail; a sound from the Audio tab.
  if (file.endsWith(".wav")) { await tid("panel-tab-audio").click(); await tid("audio-add").click(); } else await tid(`thumb-${file}`).dblclick();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="timeline-tracks"] [data-testid^="clip-"]').length >= 1, null, { timeout: 30_000 });
  await saved();
  await settle(1200);
  const [clip] = await clips();
  await clickClip(clip);
  return clip;
};
/** Exports the timeline's sound as a WAV file and returns its samples (mono, 48 kHz). */
const exportWav = async (name) => {
  await tid("open-export").click();
  await tid("export-dialog").waitFor();
  await settle(700);
  await visible(tid("export-dialog").getByRole("radiogroup", { name: "Export type", exact: true }).getByRole("radio", { name: "Audio", exact: true })).click(); await settle(400);
  await visible(tid("export-dialog").getByRole("combobox", { name: "Format", exact: true })).click();
  await option("WAV").click(); await settle(400);
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 120_000 }), tid("export-start").click()]);
  await tid("export-done").waitFor({ timeout: 60_000 });
  const path = join(dir, `${name}.wav`);
  await download.saveAs(path);
  await tid("export-close").click();
  await page.getByTestId("export-dialog").waitFor({ state: "detached" });
  const pcm = execFileSync("ffmpeg", ["-loglevel", "error", "-i", path, "-vn", "-ac", "1", "-ar", "48000", "-f", "f32le", "-"], { maxBuffer: 1 << 27 });
  return new Float32Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + Math.floor(pcm.byteLength / 4) * 4));
};
/** The amplitude of one frequency in a stretch of samples (seconds), and the level of the stretch. */
const tone = (samples, frequency, from = 0, to = samples.length / 48_000) => {
  let re = 0, im = 0; const start = Math.round(from * 48_000), end = Math.min(samples.length, Math.round(to * 48_000));
  for (let index = start; index < end; index++) { const angle = (2 * Math.PI * frequency * (index - start)) / 48_000; re += samples[index] * Math.cos(angle); im += samples[index] * Math.sin(angle); }
  return end > start ? (2 * Math.hypot(re, im)) / (end - start) : 0;
};
const rms = (samples, from = 0, to = samples.length / 48_000) => { let sum = 0; const start = Math.round(from * 48_000), end = Math.min(samples.length, Math.round(to * 48_000)); for (let index = start; index < end; index++) sum += samples[index] ** 2; return end > start ? Math.sqrt(sum / (end - start)) : 0; };
/** The frequency between 200 and 1200 Hz that carries the most energy in a stretch, to 1 Hz. */
const dominant = (samples, from, to) => { let best = 0, level = 0; for (let frequency = 200; frequency <= 1200; frequency += 2) { const value = tone(samples, frequency, from, to); if (value > level) { level = value; best = frequency; } } return best; };
/** The design frame on the left, this screen on the right, same theme: what the two are compared on. */
const compare = async (frameId, scheme, name = frameId) => {
  const design = await context.newPage();
  await design.setViewportSize({ width: 1700, height: 1100 });
  await design.emulateMedia({ colorScheme: scheme });
  await design.goto(`file://${process.cwd()}/docs/design/jagentchill-ui.html`);
  if (scheme === "dark") await design.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  const frame = design.locator(`#${frameId} .dframe`).first();
  await frame.scrollIntoViewIfNeeded();
  const left = (await frame.screenshot()).toString("base64"), right = (await page.screenshot()).toString("base64");
  await design.setViewportSize({ width: 2440, height: 820 });
  await design.setContent(`<body style="margin:0;background:#888;font:600 16px system-ui;color:#fff"><div style="display:flex;gap:20px;padding:10px"><div><div>DESIGN ${frameId}</div><img style="width:1200px;display:block" src="data:image/png;base64,${left}"></div><div><div>APP /editor — ${name}</div><img style="width:1200px;display:block" src="data:image/png;base64,${right}"></div></div></body>`);
  mkdirSync(".dev/compare", { recursive: true });
  await design.screenshot({ path: `.dev/compare/${name}-${scheme}.png` });
  await design.close();
};
const inBothThemes = async (run) => { for (const scheme of ["light", "dark"]) { await page.emulateMedia({ colorScheme: scheme }); await settle(500); await run(scheme); } await page.emulateMedia({ colorScheme: "light" }); await settle(300); };

// ————————————————————————————————————————— clip animations, motion blur, masks, Keep pitch: the red clip —

await step("the Animation tab of a video clip: In, Out and Combo with the 44 bundled animations, a search, None first", async () => {
  await newProject("red.mp4");
  expect((await page.getByRole("tablist", { name: "Inspector" }).getByRole("tab").allInnerTexts()).join("|") === "Video|Audio|Speed|Animation|Adjustment|Effects", `the frame's tab order (Animation after Speed): ${(await page.getByRole("tablist", { name: "Inspector" }).getByRole("tab").allInnerTexts()).join("|")}`);
  await tab("Animation").click();
  await tid("clip-animation-tab").waitFor();
  const count = async (group) => page.locator(`[data-testid="clip-animations-${group}"] [data-testid^="clip-animation-${group}-"]`).count();
  expect((await count("in")) === 17, `None and 16 In animations: ${await count("in")}`);
  expect((await page.locator('[data-testid="clip-animations-in"] [role="button"]').first().innerText()).trim() === "None", "None is the first tile");
  await tab("Out").click(); await settle(200);
  expect((await count("out")) === 17, `None and 16 Out animations: ${await count("out")}`);
  await tab("Combo").click(); await settle(200);
  expect((await count("combo")) === 13, `None and 12 Combo animations: ${await count("combo")}`);
  await tab("In").click(); await settle(200);
  await visible(tid("clip-animation-search").locator("input")).fill("slide");
  await settle(250);
  const found = await page.locator('[data-testid="clip-animations-in"] [role="button"]').allInnerTexts();
  expect(found.length === 4 && found.every((name) => name.includes("Slide In")), `the search keeps the four Slide In animations: ${found.join(", ")}`);
  await visible(tid("clip-animation-search").locator("input")).fill("zzz");
  await tid("clip-animation-empty").waitFor();
  await visible(tid("clip-animation-search").locator("input")).fill("");
  await settle(250);
});

await step("Apply and auto-preview — Fade In plays the first 0.5 s once and the playhead returns; at its midpoint the clip is half visible (opacity 0 → 1, linear)", async () => {
  await seek(2);
  const before = await timecode();
  const times = [];
  const watch = setInterval(() => { timecode().then((value) => times.push(value)).catch(() => undefined); }, 60);
  await tid("clip-animation-in-fade-in").click();
  await page.waitForTimeout(250);
  await playEnded();
  clearInterval(watch);
  expect((await pressed("clip-animation-in-fade-in")) === "true", "the tile is chosen");
  expect(times.some((value) => value.startsWith("00:00:00:")), `the preview played the first half second: ${[...new Set(times)].join(" ")}`);
  expect((await timecode()) === before, `the playhead is back at ${before}: ${await timecode()}`);
  expect((await numberOf("clip-animation-duration")) === 0.5, `the default duration is 0.5 s: ${await numberOf("clip-animation-duration")}`);
  await typeNumber("clip-animation-duration", 1);
  await seek(0); const start = await colourAt();
  await seek(0.5); const middle = await colourAt();
  await seek(1); const end = await colourAt();
  note("fade-in red at 0 / 0.5 / 1.0 s", [start.r, middle.r, end.r]);
  expect(start.r < 30, `at the start the clip is invisible: ${say(start)}`);
  expect(middle.r > 90 && middle.r < 215, `at the midpoint it is half visible: ${say(middle)}`);
  expect(end.r > 230, `at the end it is fully visible: ${say(end)}`);
  await shot("01-animation-in-1440-light");
});

await step("Strength and Duration — Zoom In grows from 50 % to 100 % with an ease-out: the clip's edge moves out, fastest at first", async () => {
  await tid("clip-animation-in-zoom-in").click();
  await playEnded();
  expect((await pressed("clip-animation-in-zoom-in")) === "true" && (await pressed("clip-animation-in-fade-in")) === "false", "Zoom In replaces Fade In in the In slot");
  await typeNumber("clip-animation-duration", 1);
  const lefts = [];
  for (const at of [0.4, 0.7, 1]) { await seek(at); lefts.push(redSpan((await picture()).row)?.left ?? 1); }
  note("zoom-in left edge at 0.4 / 0.7 / 1.0 s (fraction of the canvas)", lefts.map((value) => Number(value.toFixed(3))));
  expect(lefts[0] > lefts[1] + 0.005 && lefts[1] > lefts[2] && lefts[2] < 0.01, `the clip grows to the full frame: ${lefts.join(", ")}`);
  expect(lefts[0] < 0.25 && lefts[0] > 0.01, `at 0.4 s it is between 50 % and 100 %: ${lefts[0]}`);
  // Strength 0 leaves only the opacity component: the clip no longer changes size.
  await typeNumber("clip-animation-strength", 0);
  await seek(0.5);
  const flat = redSpan((await picture()).row);
  expect(flat !== null && flat.left < 0.01 && flat.right > 0.99, `with strength 0 the clip keeps its size: ${JSON.stringify(flat)}`);
  await typeNumber("clip-animation-strength", 100);
});

await step("Duration slider limit — Out: Slide Out Right moves the clip off to the right over its last second; In and Out share the clip", async () => {
  await tab("Out").click(); await settle(200);
  await tid("clip-animation-out-slide-out-right").click();
  await playEnded();
  await typeNumber("clip-animation-duration", 1);
  const lefts = [];
  for (const at of [3, 3.5, 3.9]) { await seek(at); lefts.push(redSpan((await picture()).row)?.left ?? 1); }
  note("slide-out-right left edge at 3.0 / 3.5 / 3.9 s", lefts.map((value) => Number(value.toFixed(3))));
  expect(lefts[0] < 0.01, `before the animation the clip fills the frame: ${lefts[0]}`);
  expect(lefts[1] > 0.05 && lefts[1] < 0.6 && lefts[2] > lefts[1] + 0.2, `it slides out, slowly at first (ease-in): ${lefts.join(", ")}`);
  // The clip is 4 s long and its In lasts 1 s: the Out cannot be longer than 3 s.
  await typeNumber("clip-animation-duration", 9);
  expect((await numberOf("clip-animation-duration")) === 3, `Out is limited by In: ${await numberOf("clip-animation-duration")}`);
  await typeNumber("clip-animation-duration", 1);
  await shot("02-animation-out");
});

await step("Combo replaces In and Out — the notice, Spin Through over the whole clip, and one undo restores In and Out; None removes", async () => {
  await tab("Combo").click(); await settle(200);
  expect((await tid("clip-animation-combo-notice").innerText()).includes("Combo replaces In and Out"), "the Combo tab says what it replaces");
  await tid("clip-animation-combo-spin-through").click();
  await page.waitForTimeout(400);
  // The combo range is the whole clip: the preview is stopped by hand.
  await page.keyboard.press("Space").catch(() => undefined);
  await tid("player-play").waitFor();
  if (await page.getByRole("button", { name: "Pause", exact: true }).count()) await button("Pause").click();
  await playEnded();
  expect((await numberOf("clip-animation-duration")) === 4, `a combo starts at the clip's length: ${await numberOf("clip-animation-duration")}`);
  expect(await page.getByTestId("clip-animation-combo-notice").count() === 0, "In and Out are gone, and the notice with them");
  const spans = [];
  for (const at of [0, 2, 3.9]) { await seek(at); const span = redSpan((await picture()).row); spans.push(span ? Number((span.right - span.left).toFixed(3)) : 0); }
  note("spin-through width of the clip at 0 / 2.0 / 3.9 s (fraction of the canvas)", spans);
  expect(spans[0] > 0.2 && spans[0] < 0.75, `it enters small: ${spans[0]}`);
  expect(spans[1] > 0.99, `in the middle it fills the frame: ${spans[1]}`);
  expect(spans[2] < 0.85, `it leaves small: ${spans[2]}`);
  await tab("In").click(); await settle(200);
  expect((await pressed("clip-animation-in-none")) === "true", "the In slot is empty");
  await undo();
  expect((await pressed("clip-animation-in-zoom-in")) === "true", "one undo restores the In animation");
  await tab("Out").click(); await settle(200);
  expect((await pressed("clip-animation-out-slide-out-right")) === "true", "and the Out animation");
  await tid("clip-animation-out-none").click(); await settle(300);
  expect((await pressed("clip-animation-out-none")) === "true", "None removes the Out slot");
  await tab("In").click(); await settle(200);
  expect((await pressed("clip-animation-in-zoom-in")) === "true", "In is unchanged");
  await tid("clip-animation-in-none").click(); await settle(300);
});

await step("the Animation tab in the frame's inspector, light and dark (#d-editor)", async () => {
  await tid("clip-animation-in-bounce-in").click();
  await playEnded();
  await seek(0.3);
  await inBothThemes(async (scheme) => { await compare("d-editor", scheme, "d-editor-animation"); if (scheme === "dark") await shot("03-animation-1440-dark"); });
  await tid("clip-animation-in-none").click(); await settle(300);
});

await step("Motion blur — a clip moving 320 px per frame is smeared along its path, not across it; strength 0 and a still clip are unchanged", async () => {
  await tab("Video").click(); await settle(300);
  await setLabelled("Scale", 50);
  // Two position keys 6 frames apart: 1920 px in 0.2 s.
  await seekFrame(30);
  await setLabelled("X", -960);
  await tid("kf-transform.position.x").click(); await settle(300);
  await seekFrame(36);
  await setLabelled("X", 960);
  await seekFrame(31);
  const sharp = await picture();
  const sharpEdge = { across: edgeWidth(sharp.row), along: edgeWidth(sharp.column) };
  await tab("Animation").click(); await settle(300);
  await visible(tid("motion-blur").getByRole("switch", { name: "Motion blur", exact: true })).click(); await settle(400);
  await typeNumber("motion-blur-strength", 100);
  await visible(tid("motion-blur-samples").getByRole("combobox")).click();
  await option("16").click(); await settle(500);
  await seekFrame(31);
  const blurred = await picture();
  const blurEdge = { across: edgeWidth(blurred.row), along: edgeWidth(blurred.column) };
  // One frame of shutter at 320 canvas px per frame, of which 10 % – 90 % is counted, in screenshot pixels.
  const expected = 320 * 0.8 * (blurred.width / 1920);
  note("motion blur edge width in px of the preview (sharp, blurred, expected)", { sharp: sharpEdge, blurred: blurEdge, expected: Number(expected.toFixed(1)) });
  expect(sharpEdge.across <= 3, `without blur the moving clip has a sharp edge: ${sharpEdge.across}`);
  expect(Math.abs(blurEdge.across - expected) <= expected * 0.2 + 3, `the clip is smeared horizontally by a frame of movement: ${blurEdge.across} vs ${expected.toFixed(1)}`);
  expect(blurEdge.along <= 3, `it is not smeared vertically: ${blurEdge.along}`);
  await shot("04-motion-blur");
  await inBothThemes(async (scheme) => { await compare("d-editor", scheme, "d-editor-motion-blur"); });
  // Strength 0: the frame of the unblurred clip.
  await typeNumber("motion-blur-strength", 0);
  await seekFrame(31);
  expect(edgeWidth((await picture()).row) <= 3, "strength 0 equals motion blur off");
  await typeNumber("motion-blur-strength", 100);
  // A frame in which the clip does not move.
  await seekFrame(60);
  const still = await picture();
  expect(edgeWidth(still.row) <= 3 && edgeWidth(still.column) <= 3, `a clip that does not move is unchanged: ${edgeWidth(still.row)}`);
  await visible(tid("motion-blur").getByRole("switch", { name: "Motion blur", exact: true })).click(); await settle(300);
  // The position keys and the scale go again.
  await tab("Video").click(); await settle(300);
  await tid("reset-transform").click(); await settle(400);
});

await step("Mask keyframes — a rectangle mask keyed at two positions moves between them in the preview", async () => {
  await tab("Mask").click();
  await tid("mask-tab").waitFor();
  await tid("mask-add").click();
  await menuItem("Rectangle").click(); await settle(500);
  await seek(0);
  await tid("mask-centerX").locator("input").first().fill("-25"); await tid("mask-centerX").locator("input").first().press("Enter"); await settle(300);
  await tid("mask-kf-centerX").click(); await settle(300);
  expect((await tid("mask-kf-centerX").getAttribute("aria-pressed")) === "true", "the Position toggle holds a key at the playhead");
  await seek(2);
  await tid("mask-centerX").locator("input").first().fill("25"); await tid("mask-centerX").locator("input").first().press("Enter"); await settle(300);
  const centres = [];
  for (const at of [0, 1, 2]) { await seek(at); const span = redSpan((await picture()).row); centres.push(span ? Number(((span.left + span.right) / 2).toFixed(3)) : -1); }
  note("mask centre at 0 / 1 / 2 s (fraction of the canvas)", centres);
  expect(centres[0] > 0 && centres[0] < 0.4, `at 0 s the mask is on the left: ${centres[0]}`);
  expect(Math.abs(centres[1] - 0.5) < 0.04, `at 1 s it is in the middle: ${centres[1]}`);
  expect(centres[2] > 0.6, `at 2 s it is on the right: ${centres[2]}`);
  await seek(1);
  await shot("05-mask-keyframes");
  await inBothThemes(async (scheme) => { await compare("d-editor-mask", scheme, "d-editor-mask-keyframes"); });
  await tid("mask-remove-0").click(); await settle(400);
});

await step("Keep pitch at 2× — the 440 Hz tone stays at 440 Hz and lasts half as long; off — Pitch follows speed: 880 Hz", async () => {
  await tab("Speed").click();
  await tid("speed-tab").waitFor();
  await tab("Normal").click(); await settle(200);
  expect(await page.getByTestId("speed-keep-pitch").count() === 1, "a clip with sound has the Keep pitch switch");
  await typeNumber("speed-field", 2);
  const keep = visible(tid("speed-keep-pitch").getByRole("switch"));
  expect((await keep.getAttribute("aria-checked")) === "true", "Keep pitch is on the first time the speed is changed");
  expect(await page.getByTestId("speed-pitch-note").count() === 0, "inside 0.25x – 4x there is no note");
  await saved();
  const kept = await exportWav("keep-pitch-2x");
  const keptFrequency = dominant(kept, 0.3, 1.5);
  await keep.click(); await settle(400);
  expect((await keep.getAttribute("aria-checked")) === "false", "Keep pitch is off");
  await saved();
  const followed = await exportWav("follow-pitch-2x");
  const followedFrequency = dominant(followed, 0.3, 1.5);
  note("dominant frequency at 2× (Keep pitch on, off) and length in s", { on: keptFrequency, off: followedFrequency, seconds: Number((kept.length / 48_000).toFixed(3)) });
  expect(Math.abs(keptFrequency - 440) <= 440 * 0.02, `with Keep pitch the tone is 440 Hz ±2 %: ${keptFrequency}`);
  expect(Math.abs(followedFrequency - 880) <= 880 * 0.02, `without it the tone is 880 Hz ±2 %: ${followedFrequency}`);
  expect(Math.abs(kept.length / 48_000 - 2) < 0.05, `the sound lasts half as long: ${kept.length / 48_000}`);
  // Outside the stretch range the switch says so.
  await keep.click(); await settle(300);
  await typeNumber("speed-field", 8);
  expect((await tid("speed-pitch-note").innerText()).includes("Pitch is kept between 0.25x and 4x"), "at 8x the note is shown");
  await shot("06-speed-keep-pitch-note");
  await typeNumber("speed-field", 2);
  expect(await page.getByTestId("speed-pitch-note").count() === 0, "back at 2x the note is gone");
  // Fast clip: smooth slow-mo is for clips that are slowed down.
  expect(await visible(tid("speed-smooth").getByRole("combobox")).isDisabled(), "at 2x the Smooth slow-mo control is disabled");
  expect((await tid("speed-smooth-note").innerText()).includes("Available when the clip is slowed down"), "with its reason");
});

// ————————————————————————————————————————— smooth slow-mo: the flickering clip —

await step("Frame blending at 0.5× — every second frame is the mix of two source frames; Off repeats frames; Optical flow is not offered on this device", async () => {
  await newProject("flicker.mp4");
  await tab("Speed").click();
  await tid("speed-tab").waitFor();
  await tab("Normal").click(); await settle(200);
  expect(await page.getByTestId("speed-keep-pitch").count() === 0, "a clip with no sound has no Keep pitch switch");
  await typeNumber("speed-field", 0.5);
  const select = visible(tid("speed-smooth").getByRole("combobox"));
  expect(await select.isEnabled(), "a slowed clip offers Smooth slow-mo");
  const kind = (c) => (c.r < 60 ? "black" : c.r > 200 ? "white" : "mix");
  const read = async () => { const out = []; for (const frame of [10, 11, 12, 13, 14, 15]) { await seekFrame(frame); out.push(await colourAt()); } return out; };
  const off = await read();
  await select.click(); await settle(300);
  expect(await visible(page.getByText("Optical flow is not available on this device")).count() === 1, "Optical flow carries its reason");
  await shot("07-smooth-options");
  // A disabled option cannot be chosen: the list stays open and the value stays Off.
  await option("Optical flow").click(); await settle(300);
  expect(await page.getByRole("option", { name: "Frame blending", exact: true }).count() === 1, "pressing the disabled option chooses nothing: the list is still open");
  await option("Frame blending").click(); await settle(500);
  expect((await select.innerText()).trim() === "Frame blending", `Frame blending is chosen: ${await select.innerText()}`);
  const blended = await read();
  note("0.5× frames 10–15, Off", off.map((c) => c.r));
  note("0.5× frames 10–15, Frame blending", blended.map((c) => c.r));
  expect(off.every((c) => kind(c) !== "mix"), `Off shows source frames only: ${off.map(kind).join(" ")}`);
  expect(off.filter((c, index) => index % 2 === 0).every((c, index, list) => index === 0 || kind(c) !== kind(list[index - 1])), `each source frame is shown twice: ${off.map(kind).join(" ")}`);
  const kinds = blended.map(kind);
  expect(kinds.filter((value) => value === "mix").length === 3 && kinds.every((value, index) => (value === "mix") === (kinds[(index + 2) % 6] === "mix")), `every second frame is a mix: ${kinds.join(" ")}`);
  expect(blended.filter((c) => kind(c) === "mix").every((c) => c.r > 90 && c.r < 200), `the mix is half of each: ${blended.map((c) => c.r).join(" ")}`);
  await shot("08-smooth-blend");
  // The Curve tab carries the same control, as in the frame.
  await tab("Curve").click(); await settle(300);
  expect((await visible(tid("speed-smooth").getByRole("combobox")).innerText()).includes("Frame blending"), "the Curve tab shows the same Smooth slow-mo");
  // The frame shows the Hero curve in the editor, the Smooth slow-mo row under it.
  await tid("speed-preset-hero").click(); await settle(500);
  await tid("speed-curve").waitFor();
  expect((await visible(tid("speed-smooth").getByRole("combobox")).innerText()).includes("Frame blending"), "a curve keeps the Smooth slow-mo choice");
  await inBothThemes(async (scheme) => { await compare("d-editor-speed", scheme); if (scheme === "dark") await shot("09-speed-curve-1440-dark"); });
});

// ————————————————————————————————————————— chroma key: the green and red picture —

await step("Matte view — Show matte renders white for kept and black for removed; Eyedropper — picks the source colour with the key on", async () => {
  await newProject("split.png");
  await tab("Cutout").click();
  await tid("cutout-tab").waitFor();
  const swatch = () => tid("chroma-swatch").evaluate((node) => getComputedStyle(node).backgroundColor);
  await visible(tid("chroma-section").getByRole("switch", { name: "Chroma key", exact: true })).click(); await settle(600);
  const keyed = { left: await colourAt(0.25), right: await colourAt(0.75) };
  expect(keyed.left.g < 40 && keyed.right.r > 200, `the green half is removed, the red half kept: ${say(keyed.left)} ${say(keyed.right)}`);
  const matteSwitch = visible(tid("chroma-matte").getByRole("switch", { name: "Show matte", exact: true }));
  await matteSwitch.click(); await settle(600);
  const matte = { left: await colourAt(0.25), right: await colourAt(0.75) };
  note("matte: removed half, kept half", [say(matte.left), say(matte.right)]);
  expect(matte.left.r < 25 && matte.left.g < 25 && matte.left.b < 25, `removed is black: ${say(matte.left)}`);
  expect(matte.right.r > 230 && matte.right.g > 230 && matte.right.b > 230, `kept is white: ${say(matte.right)}`);
  await shot("10-chroma-matte");
  await inBothThemes(async (scheme) => { await compare("d-editor-mask", scheme, "d-editor-cutout-matte"); });
  await matteSwitch.click(); await settle(500);
  expect((await colourAt(0.75)).r > 200 && (await colourAt(0.75)).g < 60, "with the matte off the picture is back");
  // The eyedropper on the red half: red becomes the key.
  const canvas = await tid("canvas").boundingBox();
  await tid("chroma-eyedropper").click(); await settle(200);
  await tid("eyedropper-overlay").waitFor();
  await page.mouse.click(canvas.x + canvas.width * 0.75, canvas.y + canvas.height * 0.5); await settle(700);
  const picked = await swatch();
  const after = { left: await colourAt(0.25), right: await colourAt(0.75) };
  note("eyedropper on the red half: key colour, left, right", [picked, say(after.left), say(after.right)]);
  expect(/rgb\((2[3-5]\d), ([0-3]?\d), ([0-3]?\d)\)/.test(picked), `the key colour is the red of the picture: ${picked}`);
  expect(after.right.r < 40 && after.left.g > 200, `red is removed and green is back: ${say(after.left)} ${say(after.right)}`);
  // Again on the same spot, which the key now removes (the preview shows black there): the source colour is read, not the keyed one.
  await tid("chroma-eyedropper").click(); await settle(200);
  await page.mouse.click(canvas.x + canvas.width * 0.75, canvas.y + canvas.height * 0.5); await settle(700);
  const again = await swatch();
  expect(/rgb\((2[3-5]\d), ([0-3]?\d), ([0-3]?\d)\)/.test(again), `with the key on the eyedropper still reads the red source: ${again}`);
  // One undo per pick.
  await shot("11-chroma-eyedropper");
});

// ————————————————————————————————————————— voice effects and fade handles: the sound clip —

await step("Voice changer — each of the 14 effects changes the exported sound measurably; Deep and Chipmunk move the tone by −4 and +8 semitones, Electronic tunes it", async () => {
  await newProject("voice450.wav");
  await tab("Audio").click();
  await tid("audio-inspector").waitFor();
  const signature = (samples) => ({ level: rms(samples, 0.05, 0.5), tail: rms(samples, 0.7, 1.9), f450: tone(samples, 450, 0.1, 0.5), f900: tone(samples, 900, 0.1, 0.5), f1350: tone(samples, 1350, 0.1, 0.5), peak: dominant(samples, 0.1, 0.5) });
  const dry = signature(await exportWav("voice-dry"));
  expect(Math.abs(dry.peak - 450) <= 4 && dry.tail < 0.002, `the dry clip is the 450 Hz burst and then silence: ${JSON.stringify(dry)}`);
  await visible(tid("audio-voice-effects").getByRole("switch", { name: "Voice effects", exact: true })).click(); await settle(400);
  const names = ["deep", "high", "chipmunk", "giant", "robot", "echo", "hall", "telephone", "megaphone", "vinyl", "synth", "electronic", "tremble", "underwater"];
  expect(await page.locator('[data-testid^="voice-effect-"]').count() === 15, "None and 14 effects");
  const table = {};
  for (const name of names) {
    await tid(`voice-effect-${name}`).click(); await settle(350);
    expect((await pressed(`voice-effect-${name}`)) === "true", `${name} is chosen`);
    await saved();
    const wet = signature(await exportWav(`voice-${name}`));
    // How far the sound is from the dry one: the largest relative change of any measure, and a moved peak.
    const change = Math.max(...["level", "f450", "f900", "f1350"].map((key) => Math.abs(wet[key] - dry[key]) / Math.max(dry[key], 1e-4)), wet.tail / Math.max(dry.level, 1e-4), Math.abs(wet.peak - dry.peak) / 450);
    table[name] = { peak: wet.peak, level: Number(wet.level.toFixed(4)), tail: Number(wet.tail.toFixed(4)), f450: Number(wet.f450.toFixed(4)), change: Number(change.toFixed(3)) };
    expect(wet.level > 0.005, `${name} still sounds: ${JSON.stringify(table[name])}`);
    expect(change > 0.05, `${name} changes the sound: ${JSON.stringify(table[name])} against ${JSON.stringify(dry)}`);
  }
  note("voice effects (dominant Hz, level, tail level, 450 Hz level, change against dry)", table);
  expect(Math.abs(table.deep.peak - 357.2) <= 8, `Deep is 4 semitones down, 357 Hz: ${table.deep.peak}`);
  expect(Math.abs(table.chipmunk.peak - 714.3) <= 14, `Chipmunk is 8 semitones up, 714 Hz: ${table.chipmunk.peak}`);
  expect(Math.abs(table.electronic.peak - 440) <= 4, `Electronic tunes 450 Hz to the nearest semitone, 440 Hz: ${table.electronic.peak}`);
  expect(table.echo.tail > 0.005 && table.hall.tail > 0.002, `Echo and Hall sound on after the voice stops: ${table.echo.tail} ${table.hall.tail}`);
  await shot("12-voice-effects");
  await tid("voice-effect-none").click(); await settle(300);
});

await step("Fade handles on clips — Drag the fade-in handle 1.2 s to the right; the tooltip, the taper, one undo step; Reset by double-click", async () => {
  const [clip] = await clips();
  await page.mouse.move(clip.x + clip.width / 2, clip.y + clip.height - 6); await settle(300);
  const handleIn = tid("fade-handle-in"), handleOut = tid("fade-handle-out");
  await handleIn.waitFor(); await handleOut.waitFor();
  const box = await handleIn.boundingBox();
  expect(box.width <= 16 && Math.abs(box.y - clip.y) <= 4, `the handle is a small round one at the top corner: ${JSON.stringify(box)}`);
  // 50 px per second: 60 px is 1.2 s.
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  for (let index = 1; index <= 6; index++) { await page.mouse.move(from.x + index * 10, from.y); await page.waitForTimeout(30); }
  const tip = (await tid("fade-tooltip").innerText()).trim();
  await shot("13-fade-handle-drag");
  await page.mouse.up(); await settle(400);
  expect(tip === "Fade in 1.2s", `the tooltip names the fade: ${tip}`);
  expect((await numberOf("audio-fade-in")) === 1.2, `fadeIn.duration is 1.2 s: ${await numberOf("audio-fade-in")}`);
  expect(Number(await tid("fade-zone-in").getAttribute("data-width")) === 60, `the faded stretch is drawn over 1.2 s: ${await tid("fade-zone-in").getAttribute("data-width")}`);
  await saved();
  const faded = await exportWav("voice-fade-in");
  // The burst sits in the first half second of a 1.2 s fade: it is much quieter than dry.
  note("level of the first 0.5 s with a 1.2 s fade in", Number(rms(faded, 0.05, 0.5).toFixed(4)));
  expect(rms(faded, 0.05, 0.5) < 0.12, `the fade is heard in the export: ${rms(faded, 0.05, 0.5)}`);
  // The right handle, to the left.
  const [again] = await clips();
  await page.mouse.move(again.x + again.width / 2, again.y + again.height - 6); await settle(300);
  const right = await tid("fade-handle-out").boundingBox();
  await page.mouse.move(right.x + right.width / 2, right.y + right.height / 2); await page.mouse.down();
  for (let index = 1; index <= 5; index++) { await page.mouse.move(right.x + right.width / 2 - index * 5, right.y + right.height / 2); await page.waitForTimeout(30); }
  await page.mouse.up(); await settle(400);
  expect((await numberOf("audio-fade-out")) === 0.5, `fadeOut.duration is 0.5 s: ${await numberOf("audio-fade-out")}`);
  await inBothThemes(async (scheme) => { await compare("d-editor-audio", scheme, "d-editor-audio-fades"); if (scheme === "dark") await shot("14-fades-1440-dark"); });
  await shot("14-fades-1440-light");
  await undo();
  expect((await numberOf("audio-fade-out")) === 0, "one undo takes the fade out back");
  expect((await numberOf("audio-fade-in")) === 1.2, "and leaves the fade in");
  const [third] = await clips();
  await page.mouse.move(third.x + third.width / 2, third.y + third.height - 6); await settle(300);
  const reset = await tid("fade-handle-in").boundingBox();
  await page.mouse.dblclick(reset.x + reset.width / 2, reset.y + reset.height / 2); await settle(400);
  expect((await numberOf("audio-fade-in")) === 0, `a double-click resets the fade: ${await numberOf("audio-fade-in")}`);
});

await browser.close();
writeFileSync(join(shots, "measured.json"), JSON.stringify(measured, null, 2));
if (errors.length) { console.log("\nERRORS\n" + [...new Set(errors)].join("\n")); process.exit(1); }
console.log("\neditor-engine2 e2e: all steps passed");
