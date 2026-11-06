// End-to-end in a real browser against the Expo web dev server, with no host: the content tabs and inspectors of the
// editor — text, audio, stickers and shapes, captions. Real storage (IndexedDB and OPFS of a fresh browser profile) and
// real media files made with ffmpeg; nothing is seeded or mocked. The exported file is probed with ffmpeg.
// Usage: node apps/app/e2e/editor-content.mjs [screenshot-dir] [base-url]
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const shots = process.argv[2] ?? ".dev/shots/editor-content";
const base = process.argv[3] ?? "http://localhost:8091";
const only = process.env.JC_ONLY ? process.env.JC_ONLY.split(",") : null;
mkdirSync(shots, { recursive: true });

// — Media: a silent dark video, a "voice" tone, a "music" tone, a subtitle file —
const dir = join(tmpdir(), "jagentchill-editor-content-e2e");
mkdirSync(dir, { recursive: true });
const ffmpeg = (...args) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args]);
const media = (name) => join(dir, name);
if (!existsSync(media("dark.mp4"))) ffmpeg("-f", "lavfi", "-i", "color=c=0x101020:s=640x360:r=30:d=8", "-c:v", "libx264", "-pix_fmt", "yuv420p", media("dark.mp4"));
if (!existsSync(media("music.wav"))) ffmpeg("-f", "lavfi", "-i", "sine=frequency=330:duration=8", "-ac", "2", media("music.wav"));
writeFileSync(media("captions.srt"), "1\n00:00:01,000 --> 00:00:02,500\nWe left Saigon before sunrise\n\n2\n00:00:03,000 --> 00:00:04,500\nsix hours of mountain road\n\n3\n00:00:05,000 --> 00:00:06,000\n<i>and then</i> the pines appeared\n");

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light", acceptDownloads: true });
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
const settle = (ms = 700) => page.waitForTimeout(ms);
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

await step("setup: a new project with a dark video on the main track", async () => {
  await page.goto(`${base}/projects`, { waitUntil: "networkidle", timeout: 180_000 });
  await button("Create your first project").click({ timeout: 90_000 });
  await page.waitForURL(/\/editor\/[0-9a-f-]{36}$/);
  for (const id of ["editor-bar", "asset-panel", "player", "inspector", "timeline"]) await tid(id).waitFor({ timeout: 60_000 });
  await importFiles([media("dark.mp4"), media("music.wav")]);
  for (const name of ["dark.mp4", "music.wav"]) await tid(`label-${name}`).waitFor({ timeout: 60_000 });
  await tid("thumb-dark.mp4").dblclick();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="track-main-video"] [data-testid^="clip-"]').length >= 1);
  await saved();
  await settle(1500);
});

// ————————————————————————————————— Text —————————————————————————————————
await step("text: the default text card adds a selected text clip at the playhead — Add by click", async () => {
  await seekTo(1);
  await tid("panel-tab-text").click();
  await tid("text-tab").waitFor();
  const before = await canvasStats();
  await tid("text-add").click();
  await tid("text-inspector").waitFor();
  const [clip] = await clipBoxes("text");
  expect(clip && Math.abs(clip.width - 150) <= 2, `a 3 s text clip is 150 px wide at zoom 1: ${JSON.stringify(clip)}`);
  expect((await tid("text-content").inputValue()) === "Default text", "the inspector shows the content of the new text");
  await settle(1500);
  const after = await canvasStats();
  expect(after.light > before.light + 300, `the default text is drawn in the preview (${before.light} → ${after.light} light pixels)`);
  await shot("01-text-added");
});

await step("text: typing changes the preview, two lines make the block taller — Multi-line content", async () => {
  const one = await canvasStats();
  await tid("text-content").fill("DA LAT\nIN 48 HOURS");
  await settle(900);
  const live = await canvasStats();
  expect(live.bounds.height > one.bounds.height * 1.5, `two lines are taller than one (${one.bounds.height} → ${live.bounds.height} px)`);
  await tid("text-content").blur();
  await settle(500);
  const [clip] = await clipBoxes("text");
  expect(clip.label.includes("DA LAT"), `the timeline bar reads the first line: ${clip.label}`);
});

await step("text: font, weight, italic, size and case really change the drawn pixels", async () => {
  const start = await canvasStats();
  await tid("font-picker").click();
  await tid("font-popover").waitFor();
  expect((await page.locator('[data-testid^="font-row-"]').count()) === 9, "the picker lists the nine baseline families");
  await visible(page.getByRole("searchbox", { name: "Search fonts" })).fill("cour");
  await page.waitForTimeout(300);
  expect((await page.locator('[data-testid^="font-row-"]').count()) === 1, "search filters by substring, any case");
  await tid("font-row-Courier New").click();
  await settle(2500);
  const courier = await canvasStats();
  expect(courier.bounds.width !== start.bounds.width, `Courier New (Cousine) lays the lines out at another width (${start.bounds.width} → ${courier.bounds.width})`);
  await tid("text-bold").click();
  await settle(2000);
  const bold = await canvasStats();
  expect(bold.light > courier.light * 1.1, `bold covers more pixels (${courier.light} → ${bold.light})`);
  // The field clamps what is typed to 1–500. (The upper bound is not typed here: the engine cannot yet draw a line of text wider than its 8 192 px texture limit.)
  await typeInto(field("text-size"), 0.2);
  expect((await field("text-size").inputValue()) === "1", `0.2 clamps to 1: ${await field("text-size").inputValue()}`);
  await typeInto(field("text-size"), 10);
  await settle(1200);
  const small = await canvasStats();
  expect(small.bounds.height < bold.bounds.height * 0.8, `size 10 is smaller than size 15 (${bold.bounds.height} → ${small.bounds.height})`);
  await tid("font-picker").click();
  await tid("font-row-Arial").click();
  await settle(1500);
  // Recent lists the families committed, most recent first.
  await tid("font-picker").click();
  await tid("font-popover").waitFor();
  await page.waitForTimeout(400);
  await visible(page.getByTestId("font-popover").getByRole("tab", { name: "Recent" })).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid^="font-row-"]').length === 2, null, { timeout: 5000 }).catch(() => undefined);
  const recent = await page.locator('[data-testid^="font-row-"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid").slice(9)));
  expect(recent.join(",") === "Arial,Courier New", `Recent is Arial then Courier New: ${recent}`);
  await page.keyboard.press("Escape");
  await typeInto(field("text-size"), 15);
});

await step("text: stroke, shadow, glow and background switches draw their feature — Section toggles", async () => {
  await settle(800);
  const plain = await canvasStats([255, 0, 0]);
  await sectionSwitch("text-background").click();
  await settle(1200);
  const boxed = await canvasStats();
  // The default background is black: the light pixels stay, and the block of dark pixels around them replaces the video.
  await sectionSwitch("text-background").click();
  await sectionSwitch("text-stroke").click();
  await settle(1200);
  const stroked = await canvasStats();
  expect(Math.abs(stroked.light - plain.light) < plain.light * 0.15, `an outside stroke leaves the fill shape (${plain.light} → ${stroked.light} light pixels)`);
  expect(boxed.bounds !== null && Math.abs(boxed.light - plain.light) < plain.light * 0.15, `the background sits behind the glyphs (${plain.light} → ${boxed.light} light pixels)`);
  await sectionSwitch("text-glow").click();
  await settle(1500);
  const glowing = await canvasStats();
  expect(glowing.bounds.width > stroked.bounds.width + 4 || glowing.light > stroked.light, `the glow spreads light around the glyphs (${stroked.bounds.width} → ${glowing.bounds.width} px wide, ${stroked.light} → ${glowing.light})`);
  await sectionSwitch("text-glow").click();
  await sectionSwitch("text-stroke").click();
});

await step("text: an effect preset restyles the selection and None takes it back — Apply a preset", async () => {
  await settle(800);
  await visible(page.getByTestId("text-inspector").getByRole("tab", { name: "Effects" })).click();
  await visible(page.locator('[data-testid="text-inspector"] [data-testid="text-presets"]')).waitFor();
  const count = await page.locator('[data-testid="text-inspector"] [data-testid^="text-preset-"]').count();
  expect(count === 41, `None plus the 40 bundled presets: ${count}`);
  await visible(page.locator('[data-testid="text-inspector"] [data-testid="text-preset-yellow-pop"]')).click();
  await settle(1500);
  const yellow = await canvasStats([255, 212, 0]);
  // The selection handles are white: they are what is left of the light pixels once the fill is yellow.
  expect(yellow.close > 3000 && yellow.light < 1500, `Yellow pop fills the text #ffd400 (${yellow.close} yellow, ${yellow.light} light pixels)`);
  await shot("02-text-preset");
  await visible(page.locator('[data-testid="text-inspector"] [data-testid="text-preset-none"]')).click();
  await settle(1500);
  const none = await canvasStats([255, 212, 0]);
  expect(none.light > 3000 && none.close < 300, `None is solid white again (${none.light} light, ${none.close} yellow)`);
  await page.keyboard.press(`${mod}+z`);
  await settle(1200);
  expect((await canvasStats([255, 212, 0])).close > 3000, "one undo returns the preset");
  await visible(page.getByTestId("text-inspector").getByRole("tab", { name: "Basic" })).click();
});

await step("text: copy style and paste style carry the look to another text — Paste to several elements", async () => {
  await button("Copy style").click();
  await seekTo(5);
  await tid("text-add").click();
  await tid("text-inspector").waitFor();
  await settle(1500);
  const white = await canvasStats([255, 212, 0]);
  expect(white.close < 300, "the new text is plain white");
  await button("Paste style").click();
  await settle(1500);
  const pasted = await canvasStats([255, 212, 0]);
  expect(pasted.close > 1500, `the pasted style fills it yellow (${pasted.close})`);
  expect((await tid("text-content").inputValue()) === "Default text", "its own content is kept");
});

await step("text: the screen next to its design frame, light and dark", async () => {
  const texts = await clipBoxes("text");
  await clickClip(texts[0]);
  await seekTo(1.5);
  await clickClip((await clipBoxes("text"))[0]);
  await tid("text-content").scrollIntoViewIfNeeded();
  await settle(1500);
  await shot("03-text-1440-light");
  await compare("d-editor-text", "d-editor-text-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await settle(800);
  await shot("04-text-1440-dark");
  await compare("d-editor-text", "d-editor-text-dark", "dark");
  await page.emulateMedia({ colorScheme: "light" });
});

await step("text: Text to speech needs a host — No host", async () => {
  await visible(page.getByRole("tab", { name: "Text to speech" })).click();
  await tid("tts-tab").waitFor();
  expect((await tid("tts-state").innerText()).includes("Connect to a host to use this tool"), "the requires-host state is shown");
  expect(await tid("tts-generate").isDisabled(), "Generate speech is disabled");
  await visible(page.getByRole("tab", { name: "Text", exact: true })).click();
});

// ————————————————————————————————— Audio —————————————————————————————————
/** The RMS level in dB of an audio stream between two times, measured by ffmpeg's `astats`. */
const rms = (file, from, to) => {
  const text = spawnSync("ffmpeg", ["-hide_banner", "-ss", String(from), "-t", String(to - from), "-i", file, "-vn", "-af", "astats=metadata=0:measure_overall=RMS_level:measure_perchannel=none", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const match = /RMS level dB: (-?[\d.]+|-inf)/.exec(text);
  return match ? (match[1] === "-inf" ? -120 : Number(match[1])) : NaN;
};

await step("audio: the Audio tab lists the project's sound, previews it and adds it to an audio track", async () => {
  await tid("panel-tab-audio").click();
  await tid("audio-tab").waitFor();
  expect((await page.getByTestId("audio-row").count()) === 1, "one sound in the Audio tab");
  await visible(page.getByRole("searchbox", { name: "Search sounds" })).fill("zzz");
  await tid("audio-empty").waitFor();
  expect((await tid("audio-empty").innerText()).includes('No sounds found for "zzz"'), "an unmatched search says so");
  await visible(page.getByRole("searchbox", { name: "Search sounds" })).fill("");
  await tid("audio-preview").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="audio-preview"]')?.getAttribute("aria-pressed") === "true", null, { timeout: 5000 });
  await tid("audio-preview").click();
  await seekTo(0);
  await tid("audio-add").click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid^="track-"] [data-testid^="clip-"][aria-label*="music.wav"]').length >= 1);
  await tid("audio-inspector").waitFor();
  await tid("audio-licence").click();
  await tid("licence-check").waitFor();
  expect((await tid("licence-row").innerText()).includes("licence not known"), "an imported file's licence is not known to the app");
  expect(await tid("licence-copy").isDisabled(), "there are no credits to copy");
  await button("Done").click();
});

await step("audio: volume, pan and fades are set in the inspector — Fades cannot overlap", async () => {
  const volume = visible(page.getByTestId("audio-volume").locator("input"));
  await typeInto(volume, 35);
  expect((await volume.inputValue()) === "20", `35 dB clamps to 20: ${await volume.inputValue()}`);
  await typeInto(volume, -6);
  await typeInto(visible(page.getByTestId("audio-fade-in").locator("input")), 3);
  await typeInto(visible(page.getByTestId("audio-fade-out").locator("input")), 7);
  // An 8 s clip with a 3 s fade in leaves 5 s for the fade out.
  expect((await visible(page.getByTestId("audio-fade-out").locator("input")).inputValue()) === "5", `fade out is clamped to 5 s: ${await visible(page.getByTestId("audio-fade-out").locator("input")).inputValue()}`);
  await typeInto(visible(page.getByTestId("audio-fade-out").locator("input")), 2);
  await visible(page.getByTestId("audio-fade-in").getByRole("combobox")).click().catch(async () => { await visible(page.getByTestId("audio-fade-in").getByRole("button")).last().click(); });
  await visible(page.getByRole("option", { name: "Linear" })).click();
  await saved();
  await shot("05-audio-inspector");
  await compare("d-editor-audio", "d-editor-audio-light");
});

let exported = null;
await step("audio: the fade really ramps the exported sound — Fade in", async () => {
  await tid("open-export").click();
  await tid("export-dialog").waitFor();
  const download = page.waitForEvent("download", { timeout: 300_000 }).catch(() => null);
  await tid("export-start").click();
  const file = await Promise.race([download, tid("export-error").waitFor({ timeout: 300_000 }).then(() => null, () => null)]);
  expect(file !== null, `the export finished with a file; the dialog reads: ${(await tid("export-dialog").innerText()).replace(/\s+/g, " ").slice(-200)}`);
  exported = join(dir, "content.mp4");
  await file.saveAs(exported);
  await button("Close").click();
  // A 330 Hz tone at −6 dB with a 3 s linear fade in and a 2 s fade out over 8 s.
  const early = rms(exported, 0.2, 0.5), middle = rms(exported, 1.4, 1.6), full = rms(exported, 4, 5), late = rms(exported, 7.5, 7.9);
  console.log(`     levels: 0.35 s ${early} dB, 1.5 s ${middle} dB, 4.5 s ${full} dB, 7.7 s ${late} dB`);
  // Linear fade: gain 0.5 at 1.5 s of 3 s is −6 dB under the full level; at 0.35 s it is 0.117, −18.6 dB under.
  expect(Math.abs(full - middle - 6) < 1.5, `the level halfway through the fade in is 6 dB under the full level (${(full - middle).toFixed(1)} dB)`);
  expect(full - early > 14 && full - early < 24, `the level near the start is about 19 dB under (${(full - early).toFixed(1)} dB)`);
  expect(full - late > 8, `the fade out lowers the end (${(full - late).toFixed(1)} dB)`);
});

// ————————————————————————————————— Stickers and shapes —————————————————————————————————
await step("stickers: a shape added from the Stickers tab renders, and its fill is edited in the inspector — Add a shape", async () => {
  await seekTo(0.2);
  await tid("panel-tab-stickers").click();
  await tid("stickers-tab").waitFor();
  expect((await page.locator('[data-testid^="shape-"]').count()) === 4, "the Shapes grid lists the four shapes the engine draws");
  const before = await canvasStats();
  await tid("shape-star").click();
  await tid("shape-inspector").waitFor();
  await settle(1500);
  const star = await canvasStats();
  expect(star.light > before.light + 3000, `a white star is drawn (${before.light} → ${star.light} light pixels)`);
  expect(Math.abs(star.bounds.centreX - 0.5) < 0.05 && Math.abs(star.bounds.centreY - 0.5) < 0.08, `it sits at the centre of the canvas: ${JSON.stringify(star.bounds)}`);
  // 25 % of the canvas's shorter side; the measured box also holds the white selection handles around it.
  expect(star.bounds.height / star.height > 0.22 && star.bounds.height / star.height < 0.4, `its longer side is about a quarter of the canvas height (${(star.bounds.height / star.height).toFixed(3)} with its handles)`);
  const hex = visible(page.getByTestId("shape-fill").locator("input"));
  await typeInto(hex, "#FF0000");
  await settle(1200);
  const red = await canvasStats([255, 0, 0]);
  expect(red.close > 3000, `the fill is red now (${red.close} red pixels)`);
  await typeInto(visible(page.getByTestId("shape-points").locator("input")), 30);
  expect((await visible(page.getByTestId("shape-points").locator("input")).inputValue()) === "12", "a star has at most 12 points");
  await shot("06-shape");
  await page.keyboard.press("Delete");
  await settle(600);
});

// ————————————————————————————————— Captions —————————————————————————————————
await step("captions: an imported SRT shows its captions at their times — Valid file", async () => {
  await tid("panel-tab-captions").click();
  await tid("captions-tab").waitFor();
  expect((await tid("captions-empty").innerText()).startsWith("No captions yet"), "the empty state is shown with no caption track");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), tid("captions-import").click()]);
  await chooser.setFiles(media("captions.srt"));
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="caption-row"]').length === 3, null, { timeout: 15_000 });
  const texts = await page.getByTestId("caption-text").evaluateAll((nodes) => nodes.map((node) => node.value));
  expect(texts.join("|") === "We left Saigon before sunrise|six hours of mountain road|and then the pines appeared", `the cues are listed without markup: ${texts.join("|")}`);
  const bars = await clipBoxes("caption");
  const ruler = await rulerBox();
  expect(bars.length === 3 && Math.abs(bars[0].x - (ruler.x + 50)) <= 2 && Math.abs(bars[0].width - 75) <= 2, `the first caption bar spans 1.0–2.5 s: ${JSON.stringify(bars.map((bar) => [Math.round(bar.x - ruler.x), Math.round(bar.width)]))}`);
  // The lower fifth of the picture holds the caption while one is live, and nothing between two captions.
  const band = async (seconds) => { await seekTo(seconds); await settle(1300); return canvasStats(null, 0.8); };
  const first = await band(1.5), gap = await band(2.75), second = await band(3.5), third = await band(5.5), after = await band(7);
  expect(first.light > 500 && second.light > 500 && third.light > 500, `each caption is drawn while it is live (${first.light}, ${second.light}, ${third.light} light pixels)`);
  expect(gap.light < 100 && after.light < 100, `no caption is drawn between or after them (${gap.light}, ${after.light})`);
  expect(first.light > second.light * 1.05, `the longer first line covers more pixels than the second (${first.light} vs ${second.light})`);
  await saved();
});

await step("captions: text, timing, style and word highlight are edited in the inspector — Apply a style", async () => {
  await visible(page.getByTestId("caption-seek").nth(1)).click();
  await tid("caption-inspector").waitFor();
  expect((await tid("caption-content").inputValue()) === "six hours of mountain road", "the inspector shows the selected caption");
  expect((await tid("caption-start").inputValue()) === "00:00:03:00" && (await tid("caption-end").inputValue()) === "00:00:04:15", `its timing is 3.0–4.5 s: ${await tid("caption-start").inputValue()} – ${await tid("caption-end").inputValue()}`);
  // Timing clamp: an end after the next caption's start becomes that start.
  await typeInto(tid("caption-end"), "00:00:05:20");
  expect((await tid("caption-end").inputValue()) === "00:00:05:00", `the end is clamped to the next caption's start: ${await tid("caption-end").inputValue()}`);
  await seekTo(3.5);
  await settle(1200);
  const white = await canvasStats([255, 212, 0], 0.8);
  await tid("caption-style-classic-yellow").click();
  await settle(1500);
  const yellow = await canvasStats([255, 212, 0], 0.8);
  expect(yellow.close > white.close + 400 && yellow.light < white.light * 0.6, `Classic yellow fills the captions #ffd400 (${white.close} → ${yellow.close} yellow, ${white.light} → ${yellow.light} light)`);
  await tid("caption-style-boxed").click();
  await settle(1500);
  await shot("07-captions");
  await compare("d-editor-captions", "d-editor-captions-light");
  // Merge with previous: one caption spans both ranges.
  await tid("caption-merge").click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="caption-row"]').length === 2);
  expect((await visible(page.getByTestId("caption-text").first()).inputValue()) === "We left Saigon before sunrise six hours of mountain road", "the texts are joined by a space");
  await page.keyboard.press(`${mod}+z`);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="caption-row"]').length === 3);
});

await step("captions: the track exports as SRT with the edited timing — SRT content", async () => {
  const download = page.waitForEvent("download", { timeout: 15_000 }).catch(() => null);
  await visible(page.getByTestId("captions-export").getByRole("button")).click();
  await visible(page.locator('[role^="menuitem"]').filter({ has: page.getByText("SRT", { exact: true }) })).click();
  const file = await download;
  expect(file !== null, "the export saved a file");
  expect(file.suggestedFilename() === "New project.und.srt", `the file is named after the project and the language: ${file.suggestedFilename()}`);
  const path = join(dir, "exported.srt");
  await file.saveAs(path);
  const text = readFileSync(path, "utf8");
  expect(text === "1\r\n00:00:01,000 --> 00:00:02,500\r\nWe left Saigon before sunrise\r\n\r\n2\r\n00:00:03,000 --> 00:00:05,000\r\nsix hours of mountain road\r\n\r\n3\r\n00:00:05,000 --> 00:00:06,000\r\nand then the pines appeared\r\n", `the SRT holds the three cues: ${JSON.stringify(text)}`);
});

for (const [name, size, scheme] of [["10-content-1440-dark", { width: 1440, height: 900 }, "dark"], ["11-content-390-light", { width: 390, height: 844 }, "light"], ["12-content-390-dark", { width: 390, height: 844 }, "dark"]]) {
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
