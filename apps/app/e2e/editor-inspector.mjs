// End-to-end in a real browser against the Expo web dev server, with no host: the inspector tools of the editor — keyframes and
// the graph editor, speed, colour adjustment, masks, chroma key, crop on the canvas and text typed on the canvas.
// Real storage (IndexedDB and OPFS of a fresh browser profile) and real media files made with ffmpeg; nothing is seeded or mocked.
// Every check of the picture reads pixels of the preview canvas from a screenshot.
// Usage: node apps/app/e2e/editor-inspector.mjs [screenshot-dir] [base-url]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const shots = process.argv[2] ?? ".dev/shots/editor-inspector";
const base = process.argv[3] ?? "http://localhost:8081";
mkdirSync(shots, { recursive: true });

// — Media: a clip that is red for 2 s and then blue for 2 s, a green screen with a red box, and a LUT that inverts the picture —
const dir = join(tmpdir(), "jagentchill-inspector-e2e");
mkdirSync(dir, { recursive: true });
const ffmpeg = (...args) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args]);
const media = (name) => join(dir, name);
if (!existsSync(media("twotone.mp4"))) ffmpeg("-f", "lavfi", "-i", "color=c=red:s=640x360:r=30:d=2", "-f", "lavfi", "-i", "color=c=blue:s=640x360:r=30:d=2", "-filter_complex", "[0:v][1:v]concat=n=2:v=1[v]", "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "15", media("twotone.mp4"));
if (!existsSync(media("key.mp4"))) ffmpeg("-f", "lavfi", "-i", "color=c=0x00ff00:s=640x360:r=30:d=3", "-vf", "drawbox=x=220:y=80:w=200:h=200:color=red:t=fill", "-c:v", "libx264", "-pix_fmt", "yuv420p", media("key.mp4"));
writeFileSync(media("invert.cube"), ["TITLE \"Invert\"", "LUT_3D_SIZE 2", ...Array.from({ length: 8 }, (_, index) => `${1 - (index & 1)} ${1 - ((index >> 1) & 1)} ${1 - ((index >> 2) & 1)}`)].join("\n") + "\n");
writeFileSync(media("broken.cube"), "LUT_3D_SIZE 2\n0 0 0\n0 zero 0\n");

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
const visible = (locator) => locator.filter({ visible: true }).first();
const tid = (id) => visible(page.getByTestId(id));
const button = (name, exact = true) => visible(page.getByRole("button", { name, exact }));
const tab = (name) => visible(page.getByRole("tab", { name, exact: true }));
const menuItem = (name) => visible(page.locator('[role^="menuitem"]').filter({ has: page.getByText(name, { exact: true }) }));
const shot = (name) => page.screenshot({ path: `${shots}/${name}.png` });
const expect = (condition, message) => { if (!condition) throw new Error(message); };
const step = async (name, run) => {
  try { await run(); console.log("ok  ", name); }
  catch (err) { console.log("FAIL", name, "—", String(err).split("\n")[0]); errors.push(`step failed: ${name}`); await shot(`failure-${name.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}`); await page.keyboard.press("Escape").catch(() => {}); }
};
const saved = () => visible(page.getByTestId("save-state").getByText("Saved", { exact: true })).waitFor({ timeout: 20_000 });
const settle = (ms = 500) => page.waitForTimeout(ms);
const cursorAt = (x, y) => page.evaluate(([px, py]) => { const node = document.elementFromPoint(px, py); return node ? getComputedStyle(node).cursor : "none"; }, [x, y]);
const assertPointCursor = async (locator, label, screenshot) => {
  const box = await locator.boundingBox();
  expect(box, `${label} is visible`);
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(at.x, at.y); await settle(100);
  const cursor = await cursorAt(at.x, at.y);
  expect(cursor === "grab", `${label} hover cursor is grab, got ${cursor}`);
  await shot(screenshot);
  console.log(`     cursor ${label}: ${cursor}`);
};
/** The colour of the preview at a point of the canvas (fractions of its box), read from a screenshot. */
const colourAt = async (fx = 0.5, fy = 0.5) => {
  const box = await tid("canvas").boundingBox();
  const png = await page.screenshot({ clip: { x: Math.round(box.x + box.width * fx) - 2, y: Math.round(box.y + box.height * fy) - 2, width: 4, height: 4 } });
  return page.evaluate(async (data) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context2d = canvas.getContext("2d");
    context2d.drawImage(bitmap, 0, 0);
    const [r, g, b] = context2d.getImageData(1, 1, 1, 1).data;
    return { r, g, b };
  }, png.toString("base64"));
};
const isRed = (c) => c.r > 170 && c.g < 80 && c.b < 80, isBlue = (c) => c.b > 170 && c.r < 80 && c.g < 80, isBlack = (c) => c.r < 40 && c.g < 40 && c.b < 40, isGreen = (c) => c.g > 150 && c.r < 100 && c.b < 100;
const say = (c) => JSON.stringify(c);
/** Types a time into the player's timecode field: frames at 30 fps. */
const seek = async (seconds) => {
  const frames = Math.round(seconds * 30), text = `00:00:${String(Math.floor(frames / 30)).padStart(2, "0")}:${String(frames % 30).padStart(2, "0")}`;
  const field = tid("timecode");
  await field.click(); await field.fill(text); await field.press("Enter");
  await settle(450);
};
const clips = () => page.evaluate(() => [...document.querySelectorAll('[data-testid^="clip-"]')].filter((node) => !["clip-selection", "clip-hover", "clip-hatch", "clip-mute", "clip-reverse"].includes(node.getAttribute("data-testid"))).map((node) => {
  const rect = node.getBoundingClientRect();
  return { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height), label: node.getAttribute("aria-label") ?? "", text: node.textContent ?? "" };
}).sort((a, b) => a.y - b.y || a.x - b.x));
const clickClip = async (clip, options) => { await page.mouse.click(clip.x + clip.width / 2, clip.y + clip.height / 2, options); await settle(200); };
const importFiles = async (paths) => { const [chooser] = await Promise.all([page.waitForEvent("filechooser"), tid("media-dropzone").click()]); await chooser.setFiles(paths); };
/** Types a number into a number field found by the test id of its wrapper. */
const typeNumber = async (id, value) => { const input = tid(id).locator("input").first(); await input.click(); await input.fill(String(value)); await input.press("Enter"); await settle(400); };
const numberOf = async (id) => Number((await tid(id).locator("input").first().inputValue()).replace(/[^\d.\-]/g, ""));
const drag = async (from, to, steps = 8) => { await page.mouse.move(from.x, from.y); await page.mouse.down(); for (let index = 1; index <= steps; index++) { await page.mouse.move(from.x + ((to.x - from.x) * index) / steps, from.y + ((to.y - from.y) * index) / steps); await page.waitForTimeout(16); } await page.mouse.up(); await settle(350); };
const centre = async (locator) => { const box = await locator.boundingBox(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; };
const state = async (id) => (await tid(id).locator('[data-testid^="diamond-"]').first().getAttribute("data-testid")).slice(8);
/** The design frame on the left, this screen on the right: what the two are compared on. */
const compare = async (frameId, scheme = "light") => {
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
let main = null;
/** Selects the first clip of the main track (a failed step may have cleared the selection). */
const selectMain = async () => { [main] = (await clips()).filter((clip) => clip.label.includes("twotone") || clip.text.includes("twotone")); if (!main) [main] = await clips(); await clickClip(main); };

await step("a project with a two-tone clip on the main track", async () => {
  await page.goto(`${base}/projects`, { waitUntil: "networkidle", timeout: 180_000 });
  await button("Create your first project").click({ timeout: 90_000 });
  await page.waitForURL(/\/editor\/[0-9a-f-]{36}$/);
  for (const id of ["editor-bar", "asset-panel", "player", "inspector", "timeline"]) await tid(id).waitFor({ timeout: 60_000 });
  await importFiles([media("twotone.mp4"), media("key.mp4")]);
  for (const name of ["twotone.mp4", "key.mp4"]) await tid(`label-${name}`).waitFor({ timeout: 60_000 });
  await tid("thumb-twotone.mp4").dblclick();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="track-main-video"] [data-testid^="clip-"]').length >= 1);
  await settle(1500);
  [main] = await clips();
  expect(Math.abs(main.width - 200) <= 2, `a 4 s clip is 200 px wide, got ${main.width}`);
  await seek(0.5);
  expect(isRed(await colourAt()), `the clip starts red, got ${say(await colourAt())}`);
  await seek(3);
  expect(isBlue(await colourAt()), `the clip ends blue, got ${say(await colourAt())}`);
  await saved();
});

// — keyframe-animation —
await step("Keyframe toggle in the properties panel — Add at playhead; Auto-keyframe on change: a keyframed opacity changes the picture over time", async () => {
  await clickClip(main);
  await seek(0);
  expect((await state("kf-opacity")) === "hollow", "the opacity diamond is hollow with no keys");
  await tid("kf-opacity").click();
  await settle();
  expect((await state("kf-opacity")) === "filled", `a key at the playhead fills the diamond, got ${await state("kf-opacity")}`);
  await seek(1.6);
  expect((await state("kf-opacity")) === "half", "away from the key the diamond is half-filled");
  // The property has keys: typing a value writes a second key instead of the stored value.
  const field = visible(page.getByRole("spinbutton", { name: "Opacity" }).or(page.getByLabel("Opacity", { exact: true }).locator("input")));
  await field.click(); await field.fill("0"); await field.press("Enter");
  await settle();
  expect((await state("kf-opacity")) === "filled", "editing a keyframed property adds a key at the playhead");
  const at = async (seconds) => { await seek(seconds); return colourAt(); };
  const start = await at(0), middle = await at(0.8), end = await at(1.6);
  expect(isRed(start), `opacity 100 % at 0 s is full red, got ${say(start)}`);
  expect(middle.r > 70 && middle.r < 190 && middle.g < 60, `half way the red is half as bright, got ${say(middle)}`);
  expect(isBlack(end), `opacity 0 % at 1.6 s shows the background, got ${say(end)}`);
  await shot("01-keyframed-opacity");
});

await step("Keyframe navigation — Next keyframe; Expanded keyframe lanes and keyframe panel — Expand; Keyframe click selection — Click seeks and selects", async () => {
  await seek(0.5);
  await clickClip(main, { button: "right" });
  await menuItem("Expand keyframes").click();
  await settle();
  expect((await page.getByTestId("keyframe-lane").count()) === 1, "one lane for the one animated property");
  expect((await page.getByTestId("lane-key").count()) === 2, "two diamonds in the Opacity lane");
  await assertPointCursor(page.getByTestId("lane-key").first(), "keyframe diamond", "cursor-keyframe-diamond");
  await tid("lane-next").click();
  await settle();
  expect((await tid("timecode").inputValue()) === "00:00:01:18", `Next keyframe moves the playhead to 1.6 s, got ${await tid("timecode").inputValue()}`);
  expect(await tid("lane-next").isDisabled(), "with no further keyframe the next button is disabled");
  // A click on a diamond seeks to it and selects only it.
  const first = await page.getByTestId("lane-key").first().boundingBox();
  await page.mouse.click(first.x + first.width / 2, first.y + first.height / 2);
  await settle();
  expect((await tid("timecode").inputValue()) === "00:00:00:00", "clicking the first diamond seeks to it");
  expect((await page.locator('[data-testid="lane-key"][aria-selected="true"]').count()) === 1, "only the clicked keyframe is selected");
});

await step("Drag keyframes in time — Move two keys (one here), with undo", async () => {
  await page.mouse.click((await page.getByTestId("lane-key").nth(1).boundingBox()).x + 5, (await page.getByTestId("lane-key").nth(1).boundingBox()).y + 5);
  await settle();
  const last = await page.getByTestId("lane-key").nth(1).boundingBox(), from = { x: last.x + last.width / 2, y: last.y + last.height / 2 };
  await drag(from, { x: from.x + 20, y: from.y });
  const moved = await page.getByTestId("lane-key").nth(1).boundingBox();
  expect(Math.abs(moved.x - last.x - 20) <= 2, `the key moved 20 px (0.4 s) to the right, moved ${moved.x - last.x}`);
  await seek(2);
  expect((await state("kf-opacity")) === "filled", "the moved key is at 2 s");
  await tid("bar-undo").click();
  await settle();
  const back = await page.getByTestId("lane-key").nth(1).boundingBox();
  expect(Math.abs(back.x - last.x) <= 2, `one undo returns the key, off by ${back.x - last.x}`);
});

await step("Graph editor availability; Graph editor curves view — Multi-key curve; Easing presets — Apply Ease out: the curve changes the picture", async () => {
  await selectMain();
  await tid("tool-graph-editor").click();
  await tid("graph-editor").waitFor();
  expect((await page.getByTestId("graph-key").count()) === 2, "the Curves view draws the two opacity keys");
  await assertPointCursor(page.getByTestId("graph-key").first(), "graph-editor key point", "cursor-graph-point");
  expect((await tid("graph-summary").innerText()).includes("1 channel visible"), "one channel is visible");
  const linear = await (async () => { await seek(0.8); return colourAt(); })();
  // Select the first key in the graph and apply "Ease out" from the easing panel.
  const key = await page.getByTestId("graph-key").first().boundingBox();
  await page.mouse.click(key.x + 4, key.y + 4);
  await settle();
  await tid("graph-preset-ease-out").click();
  await settle();
  await assertPointCursor(page.locator('[data-testid="graph-easing-curve"] circle').nth(1), "graph-editor easing handle", "cursor-graph-easing-handle");
  const values = (await tid("graph-easing-values").innerText()).replace(/\s+/g, " ");
  expect(values.includes("0.00 0.00 0.20 1.00"), `the segment is the Ease out bezier, got ${values}`);
  await seek(0.8);
  const eased = await colourAt();
  expect(eased.r < linear.r - 40, `ease-out is further along half way: less red than linear (${linear.r}), got ${eased.r}`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await shot("02-graph-editor");
  await compare("d-editor-graph");
  // The Easing view lists every preset; Linear is stored as linear again.
  await visible(page.getByRole("radio", { name: "Easing", exact: true })).click();
  await tid("graph-easing-view").waitFor();
  expect((await page.locator('[data-testid^="easing-"][role="button"]').count()) >= 13, "the Easing view shows the thirteen presets");
  await tid("easing-linear").click();
  await settle();
  await seek(0.8);
  const again = await colourAt();
  expect(Math.abs(again.r - linear.r) <= 12, `Linear restores the straight ramp, got ${again.r} vs ${linear.r}`);
  await visible(page.getByRole("radio", { name: "Curves", exact: true })).click();
  await tid("graph-close").click();
});

await step("Removing the last keyframe — the value at the playhead becomes the stored value", async () => {
  await clickClip(main, { button: "right" });
  await menuItem("Collapse keyframes").click();
  await clickClip(main);
  for (const seconds of [0, 1.6]) { await seek(seconds); await tid("kf-opacity").click(); await settle(); }
  expect((await state("kf-opacity")) === "hollow", "no keys are left");
  // The last key was removed at 1.6 s where the opacity was 0: bring it back to 100 %.
  const field = visible(page.getByRole("spinbutton", { name: "Opacity" }).or(page.getByLabel("Opacity", { exact: true }).locator("input")));
  expect(Number((await field.inputValue()).replace(/[^\d.]/g, "")) === 0, "the stored opacity is the value the last key held");
  await field.click(); await field.fill("100"); await field.press("Enter");
  await seek(0.5);
  expect(isRed(await colourAt()), "the clip is opaque again");
});

// — speed-retime —
await step("Constant speed range; Duration linked to speed — Rate changes duration; Speed badges on clips: 2× halves the clip and shows later source sooner", async () => {
  await selectMain();
  await tab("Speed").click();
  await tid("speed-tab").waitFor();
  await seek(1.5);
  expect(isRed(await colourAt()), "at 1× the picture at 1.5 s is still the red half");
  await tid("speed-stop-2").click();
  await settle(700);
  const [fast] = await clips();
  expect(Math.abs(fast.width - 100) <= 2, `at 2× the 4 s clip is 2 s (100 px) long, got ${fast.width}`);
  expect((await tid("player-duration").innerText()).includes("00:00:02:00"), "the scene lasts 2 s");
  expect((await numberOf("speed-field")) === 2 && (await numberOf("speed-duration")) === 2, "the fields show 2x and 2 s");
  expect(fast.text.includes("2.0x"), `the clip carries the badge 2.0x, got "${fast.text}"`);
  await seek(1.5);
  expect(isBlue(await colourAt()), `at 2× the picture at 1.5 s is the blue half (source 3 s), got ${say(await colourAt())}`);
  // It plays faster: from the start, the blue half is reached within about a second of playback.
  await seek(0);
  await tid("player-play").click();
  // Waits on the playhead, not on the clock: under load the first frames of playback come late. Past 1.2 s of the
  // timeline (source 2.4 s at 2×) the red half is over, and the picture is read once the preview shows that moment.
  await page.waitForFunction(() => { const [h, m, s, f] = (document.querySelector('[data-testid="timecode"]')?.value ?? "0:0:0:0").split(":").map(Number); return h * 3600 + m * 60 + s + f / 30 >= 1.2; }, null, { timeout: 20_000, polling: 100 });
  let playing = await colourAt();
  for (let tries = 0; tries < 20 && !(isBlue(playing) || isBlack(playing)); tries++) { await page.waitForTimeout(150); playing = await colourAt(); }
  await tid("player-play").click().catch(() => {});
  expect(isBlue(playing) || isBlack(playing), `past 1.2 s of playback at 2× the red half is over, got ${say(playing)}`);
  // Duration sets the rate: 8 s for 4 s of source is 0.5×.
  await typeNumber("speed-duration", 8);
  expect((await numberOf("speed-field")) === 0.5, `a duration of 8 s gives 0.5x, got ${await numberOf("speed-field")}`);
  await typeNumber("speed-field", 250);
  expect((await numberOf("speed-field")) === 100, "a typed rate above the range is stored as 100");
  await typeNumber("speed-field", 1);
  const [normal] = await clips();
  expect(Math.abs(normal.width - 200) <= 2 && !normal.text.includes("x"), "back at 1× the clip is 4 s long and has no badge");
  await shot("03-speed-normal");
});

await step("Speed curve presets — Apply Hero; None; Custom speed curve editor; Reverse — First frame after reversing", async () => {
  await selectMain();
  await tab("Speed").click();
  await visible(page.getByRole("tab", { name: "Curve", exact: true })).click();
  await tid("speed-preset-hero").click();
  await tid("speed-curve").waitFor();
  await assertPointCursor(page.locator('[data-testid="speed-curve"] circle').first(), "speed-curve point", "cursor-speed-point");
  await settle(800);
  await tid("player-play").click().catch(() => {});
  const [hero] = await clips();
  // Hero on 4 s of source: 239 / 300 of the source span at 30 fps → 3.19 s.
  expect(Math.abs(hero.width - 159) <= 3, `Hero gives a 3.19 s clip (159 px), got ${hero.width}`);
  expect(hero.text.includes("Hero"), `the badge reads Hero, got "${hero.text}"`);
  expect((await tid("speed-curve-duration").innerText()).replace(/\s+/g, " ").includes("4.0 s → 3.2 s"), `the editor shows the durations, got ${await tid("speed-curve-duration").innerText()}`);
  expect(await tid("speed-curve-remove").isDisabled(), "with no point selected, Delete point is disabled");
  await seek(1);
  await shot("04-speed-curve");
  await compare("d-editor-speed");
  // "+" adds a point at the playhead; the curve keeps its shape, so the duration stays.
  const before = await tid("speed-curve-duration").innerText();
  await tid("speed-curve-add").click();
  await settle();
  expect((await tid("speed-curve-duration").innerText()) === before, "a point added on the curve does not change its shape");
  await tid("speed-preset-none").click();
  await settle(600);
  const [plain] = await clips();
  expect(Math.abs(plain.width - 200) <= 2, "None restores the constant 1×");
  await visible(page.getByRole("tab", { name: "Normal", exact: true })).click();
  await tid("speed-reverse").getByRole("switch").click();
  await settle(900);
  await seek(0.2);
  expect(isBlue(await colourAt()), `reversed, the clip starts with its blue end, got ${say(await colourAt())}`);
  await seek(3.5);
  expect(isRed(await colourAt()), "and ends with its red start");
  await tid("speed-reverse").getByRole("switch").click();
  await settle(700);
  await seek(0.2);
  expect(isRed(await colourAt()), "reversed twice, it plays as before");
});

// — color-adjustment —
await step("Basic adjustment sliders; Reset adjustments: a slider changes the picture and the reset brings it back", async () => {
  await selectMain();
  await tab("Adjustment").click();
  await tid("adjustment-tab").waitFor();
  await seek(0.5);
  await typeNumber("adjust-saturation-value", -100);
  const grey = await colourAt();
  expect(Math.abs(grey.r - grey.g) < 25 && Math.abs(grey.g - grey.b) < 25, `saturation −100 leaves no colour, got ${say(grey)}`);
  await tid("adjust-dot-basic").waitFor();
  await tid("adjust-reset-basic").click();
  await settle();
  expect(isRed(await colourAt()), "Reset restores the red picture");
  expect((await page.getByTestId("adjust-dot-basic").count()) === 0, "the modified dot is gone");
  await typeNumber("adjust-exposure-value", -60);
  const dark = await colourAt();
  expect(dark.r < 215 && dark.g < 60, `exposure −60 darkens the red, got ${say(dark)}`);
  await tid("bar-undo").click();
  await settle();
  expect(isRed(await colourAt()), "one undo takes the exposure back");
});

await step("LUT import; LUT rendering: an imported .cube changes the picture, a malformed one adds nothing", async () => {
  await selectMain(); await tab("Adjustment").click(); await seek(0.5);
  const [bad] = await Promise.all([page.waitForEvent("filechooser"), tid("lut-import").click()]);
  await bad.setFiles([media("broken.cube")]);
  await visible(page.getByText("broken.cube: Malformed line 3", { exact: false })).waitFor({ timeout: 10_000 });
  expect((await page.locator('[data-testid^="lut-user:"]').count()) === 0, "a file that cannot be read adds nothing");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), tid("lut-import").click()]);
  await chooser.setFiles([media("invert.cube")]);
  await page.locator('[data-testid^="lut-user:"]').first().waitFor({ timeout: 10_000 });
  await settle(1500);
  const inverted = await colourAt();
  expect(inverted.r < 90 && inverted.g > 160 && inverted.b > 160, `the inverting LUT turns red into cyan, got ${say(inverted)}`);
  // Intensity 0 shows the picture without the table.
  await typeNumber("adjust-lut-intensity-value", 0);
  expect(isRed(await colourAt()), "at intensity 0 the LUT has no effect");
  await typeNumber("adjust-lut-intensity-value", 100);
  // A built-in table, baked on this device from its recipe.
  await tid("lut-bundled:day-for-night").click();
  await settle(1500);
  const night = await colourAt();
  expect(night.r < 200 && !isRed(night) || night.r < 170, `"Day for Night" darkens and cools the red, got ${say(night)}`);
  await tid("lut-none").click();
  await settle(600);
  expect(isRed(await colourAt()), "None removes the LUT");
  await saved();
});

await step("Curves; Colour wheels; Before and after compare; Copy and paste attributes", async () => {
  await selectMain(); await tab("Adjustment").click(); await seek(0.5);
  await tid("adjust-curve").scrollIntoViewIfNeeded();
  const curve = await tid("adjust-curve").boundingBox();
  // The white end of the Master curve pulled down to the middle darkens the bright red.
  await drag({ x: curve.x + curve.width - 2, y: curve.y + 2 }, { x: curve.x + curve.width - 2, y: curve.y + curve.height * 0.55 });
  const curved = await colourAt();
  expect(curved.r < 200, `the lowered curve darkens the red, got ${say(curved)}`);
  // A click on the curve adds a point.
  await page.mouse.click(curve.x + curve.width * 0.5, curve.y + curve.height * 0.72);
  await settle();
  expect((await tid("adjust-curve-count").innerText()).startsWith("3 of 16 points"), `the curve has three points, got ${await tid("adjust-curve-count").innerText()}`);
  await tid("adjust-curve-reset").click();
  await settle();
  expect(isRed(await colourAt()), "Reset Master restores the straight curve");
  await assertPointCursor(page.locator('[data-testid="adjust-curve"] circle').first(), "tone-curve point", "cursor-tone-point");
  // The highlights puck dragged towards blue (lower left) adds blue to the bright red.
  const disc = await tid("adjust-wheel-highlights-disc").boundingBox(), middle = { x: disc.x + disc.width / 2, y: disc.y + disc.height / 2 };
  await tid("adjust-wheel-highlights-disc").scrollIntoViewIfNeeded();
  const placed = await tid("adjust-wheel-highlights-disc").boundingBox();
  await assertPointCursor(tid("adjust-wheel-highlights-puck"), "colour-wheel puck", "cursor-colour-wheel-puck");
  await drag({ x: placed.x + placed.width / 2, y: placed.y + placed.height / 2 }, { x: placed.x + placed.width / 2 - 20, y: placed.y + placed.height / 2 + 34 });
  void middle;
  const tinted = await colourAt();
  expect(tinted.r < 230, `the highlights wheel pulled away from red lowers the red, got ${say(tinted)}`);
  await shot("05-adjustment");
  // Compare, split view: the left of the divider shows the picture without the look.
  await tid("adjust-compare").click();
  await tid("compare-before").waitFor({ timeout: 10_000 });
  await settle(900);
  const before = await colourAt(0.2, 0.5), after = await colourAt(0.8, 0.5);
  expect(before.r > 240 && after.r < 230, `Before is the plain red and After the graded one, got ${say(before)} / ${say(after)}`);
  await page.locator('[data-testid="adjust-section-lut"]').scrollIntoViewIfNeeded().catch(() => {});
  await compare("d-editor-color");
  await tid("adjust-compare").click();
  await tid("adjust-copy").click();
  await tid("adjust-reset-all").click();
  await settle();
  expect((await colourAt()).r > 240, "Reset all clears the look");
  await tid("adjust-paste").click();
  await settle();
  expect((await colourAt()).r < 230, "Paste brings the copied look back");
  await tid("adjust-reset-all").click();
  await settle();
});

// — masks-blending-keying —
await step("Add-mask menu — Commit; Mask invert — Invert an ellipse; Mask feather; Mask handles on canvas: a mask cuts the picture", async () => {
  await selectMain(); await seek(0.5);
  await tab("Video").click();
  await visible(page.getByRole("tab", { name: "Mask", exact: true })).click();
  await tid("mask-tab").waitFor();
  expect((await tid("mask-count").innerText()) === "No masks", "a clip starts with no masks");
  await tid("mask-add").click();
  await menuItem("Ellipse").click();
  await settle(900);
  const inside = await colourAt(0.5, 0.5), corner = await colourAt(0.04, 0.06);
  expect(isRed(inside) && isBlack(corner), `the ellipse keeps the centre and cuts the corner, got ${say(inside)} / ${say(corner)}`);
  await tid("mask-overlay").waitFor();
  expect((await page.locator('[data-testid^="mask-handle-"]').count()) >= 10, "the canvas shows the mask's corner, edge, rotate and feather handles");
  expect((await page.getByTestId("handle-nw").count()) === 0, "the element's transform handles are hidden in mask mode");
  // The body drags the mask; its position field follows.
  const canvas = await tid("canvas").boundingBox(), middle = { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 };
  await drag(middle, { x: middle.x + canvas.width * 0.2, y: middle.y });
  const x = await numberOf("mask-centerX");
  expect(x > 30 && x < 50, `dragging the mask a fifth of the canvas moves it 40 %, got ${x}`);
  expect(isBlack(await colourAt(0.2, 0.5)), "the left of the picture is now outside the mask");
  await tid("bar-undo").click();
  await settle();
  // The feather handle softens the edge: just outside the shape the picture is partly visible.
  const handle = await centre(tid("mask-handle-feather"));
  await drag(handle, { x: handle.x, y: handle.y + 33 });
  const feather = await numberOf("mask-feather");
  expect(feather >= 25 && feather <= 35, `33 px on the feather handle is 30 %, got ${feather}`);
  await shot("06-mask");
  await compare("d-editor-mask");
  await typeNumber("mask-feather", 0);
  await tid("mask-invert-0").click();
  await settle();
  const inverted = [await colourAt(0.5, 0.5), await colourAt(0.04, 0.06)];
  expect(isBlack(inverted[0]) && isRed(inverted[1]), `inverted, the centre is cut and the corner shows, got ${say(inverted[0])} / ${say(inverted[1])}`);
  // A second mask subtracts; removing both leaves the clip whole.
  await tid("mask-add").click();
  await menuItem("Rectangle").click();
  await settle();
  expect((await tid("mask-count").innerText()).startsWith("2 masks"), "two masks are listed in order");
  await tid("mask-remove-1").click();
  await tid("mask-remove-0").click();
  await settle();
  expect(isRed(await colourAt(0.5, 0.5)) && isRed(await colourAt(0.04, 0.06)), "without masks the clip is whole");
});

await step("Chroma key — Key out a green screen; Eyedropper", async () => {
  await tid("thumb-key.mp4").dblclick();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="track-main-video"] [data-testid^="clip-"]').length >= 2);
  await settle(1500);
  const all = await clips(), key = all[all.length - 1];
  const keyClip = all.find((clip) => clip.text.includes("key.mp4")) ?? key, firstX = Math.min(...all.map((clip) => clip.x));
  await clickClip(keyClip);
  await seek((keyClip.x - firstX) / 50 + 1);
  await tab("Video").click();
  await visible(page.getByRole("tab", { name: "Cutout", exact: true })).click();
  await tid("cutout-tab").waitFor();
  expect(isGreen(await colourAt(0.1, 0.1)) && isRed(await colourAt(0.5, 0.5)), `the clip is a red box on green, got ${say(await colourAt(0.1, 0.1))}`);
  await tid("chroma-section").getByRole("switch").click();
  await settle(900);
  const keyed = await colourAt(0.1, 0.1), kept = await colourAt(0.5, 0.5);
  expect(isBlack(keyed) && isRed(kept), `the green is removed and the red box stays, got ${say(keyed)} / ${say(kept)}`);
  await shot("07-chroma-key");
  // With the key colour set to something else the green is back; the eyedropper picks it from the preview again.
  const hex = tid("chroma-color").locator("input").first();
  await hex.click(); await hex.fill("#0000FF"); await hex.press("Enter");
  await settle(700);
  expect(isGreen(await colourAt(0.1, 0.1)), "keyed on blue, the green stays");
  await tid("chroma-eyedropper").click();
  const canvas = await tid("canvas").boundingBox();
  await page.mouse.click(canvas.x + canvas.width * 0.1, canvas.y + canvas.height * 0.1);
  await settle(1500);
  expect(isBlack(await colourAt(0.1, 0.1)), `the eyedropper picked the green and the key removes it, got ${say(await colourAt(0.1, 0.1))}`);
  await saved();
});

await step("crop handles on the canvas", async () => {
  await visible(page.getByRole("tab", { name: "Basic", exact: true })).click();
  await tid("crop-open").click();
  await tid("crop-overlay").waitFor();
  expect((await page.locator('[data-testid^="crop-handle-"]').count()) === 8, "the crop frame has eight handles");
  const east = await centre(tid("crop-handle-e")), canvas = await tid("canvas").boundingBox();
  await drag(east, { x: east.x - canvas.width * 0.3, y: east.y });
  const moved = await centre(tid("crop-handle-e"));
  expect(moved.x < east.x - canvas.width * 0.1, `the right edge of the picture moved in with the handle, from ${east.x} to ${moved.x}`);
  await shot("08-crop");
  await tid("crop-canvas-reset").click();
  await settle();
  const reset = await centre(tid("crop-handle-e"));
  expect(Math.abs(reset.x - east.x) <= 3, "Reset restores the whole picture");
  await tid("crop-canvas-done").click();
  expect((await page.getByTestId("crop-overlay").count()) === 0, "Done leaves crop mode");
});

await step("text typed in place on the canvas", async () => {
  await tid("panel-tab-text").click();
  await tid("text-add").click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid^="track-overlay-text"] [data-testid^="clip-"]').length >= 1);
  await settle(1200);
  const canvas = await tid("canvas").boundingBox(), middle = { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 };
  // The new text clip, selected, with the playhead inside it.
  const text = (await clips()).find((clip) => clip.text.includes("Default text"));
  await clickClip(text);
  const origin = Math.min(...(await clips()).map((clip) => clip.x));
  await seek((text.x - origin) / 50 + 0.5);
  await page.getByTestId("selection-box").first().waitFor({ timeout: 15_000 });
  await settle(800);
  await page.mouse.dblclick(middle.x, middle.y);
  const field = tid("canvas-text-edit");
  await field.waitFor({ timeout: 5000 });
  await field.fill("Typed on canvas");
  await settle(400);
  await page.mouse.click(canvas.x + 8, canvas.y + 8);
  await settle(500);
  expect((await page.getByTestId("canvas-text-edit").count()) === 0, "leaving the field ends the edit");
  const labels = (await clips()).map((clip) => clip.text).join("|");
  expect(labels.includes("Typed on canvas"), `the text clip reads what was typed, got ${labels}`);
  await tid("bar-undo").click();
  await settle();
  expect(!(await clips()).map((clip) => clip.text).join("|").includes("Typed on canvas"), "one undo takes the typing back");
  await tid("panel-tab-media").click();
});

// — The four tools again in the dark theme —
await step("dark theme: the inspector tools draw from tokens", async () => {
  await page.emulateMedia({ colorScheme: "dark" });
  await settle(900);
  const all = await clips();
  await clickClip(all.find((clip) => clip.width > 150 && clip.y === Math.max(...all.map((entry) => entry.y))) ?? all[0]);
  await tab("Adjustment").click();
  await tid("adjustment-tab").waitFor();
  await shot("09-adjustment-dark");
  await compare("d-editor-color", "dark");
  await tab("Speed").click();
  await tid("speed-tab").waitFor();
  await shot("10-speed-dark");
  await page.emulateMedia({ colorScheme: "light" });
});

console.log(errors.length ? `\n${errors.length} problem(s):\n${errors.join("\n")}` : "\nno problems");
await browser.close();
process.exit(errors.length ? 1 : 0);
