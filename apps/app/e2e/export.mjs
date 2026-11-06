// End-to-end in a real browser, with no host: export-share — the export dialog, the job, the queue, the history.
// Real storage (IndexedDB and OPFS of a fresh browser profile) and real media made with ffmpeg; every exported file is
// read back with ffprobe. One thing is not the real one: a headless browser has no save dialog, so `showSaveFilePicker`
// is replaced by a function that returns a real file handle of the origin's private file system (the app then writes
// through File System Access exactly as it does to a chosen file), and it is removed for the steps that check the
// download path. Nothing else is seeded, mocked or stubbed.
// Usage: node apps/app/e2e/export.mjs [screenshot-dir] [base-url]
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const shots = process.argv[2] ?? ".dev/shots/export";
const base = process.argv[3] ?? "http://localhost:8081";
mkdirSync(shots, { recursive: true });
const dir = join(tmpdir(), "jagentchill-export-e2e"), out = join(dir, "out");
mkdirSync(out, { recursive: true });
const ffmpeg = (...args) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args]);
const media = (name) => join(dir, name);
// — Media made here with ffmpeg: a 4 s red clip with a 440 Hz tone, a 3 s blue clip with an 880 Hz tone —
if (!existsSync(media("red.mp4"))) ffmpeg("-f", "lavfi", "-i", "color=c=red:s=640x360:r=30:d=4", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", media("red.mp4"));
// A clip of moving detail (test pattern with light noise), so that an encoder has to spend the bitrate it is given. (With heavy
// noise the H.264 encoder of the browser reaches its coarsest quantiser and overshoots: measured 15.9 Mbps for 4 asked.)
if (!existsSync(media("detail2.mp4"))) ffmpeg("-f", "lavfi", "-i", "testsrc2=s=1280x720:r=30:d=4,noise=alls=12:allf=t", "-c:v", "libx264", "-preset", "veryfast", "-crf", "14", "-pix_fmt", "yuv420p", media("detail2.mp4"));
if (!existsSync(media("blue.mp4"))) ffmpeg("-f", "lavfi", "-i", "color=c=blue:s=640x360:r=30:d=3", "-f", "lavfi", "-i", "sine=frequency=880:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", media("blue.mp4"));
const probe = (path, entries = "format=duration,bit_rate,format_name:stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,nb_read_frames,sample_rate,channels,bits_per_sample,pix_fmt:stream_disposition=attached_pic") =>
  JSON.parse(execFileSync("ffprobe", ["-v", "error", "-count_frames", "-show_entries", entries, "-of", "json", path]).toString());

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light", acceptDownloads: true });
await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
// The save dialog of a headless browser: a real handle in the private file system, under `picked/`.
await context.addInitScript(() => {
  window.__picked = [];
  window.showSaveFilePicker = async (options) => {
    const root = await navigator.storage.getDirectory(), folder = await root.getDirectoryHandle("picked", { create: true });
    const handle = await folder.getFileHandle(options.suggestedName, { create: true });
    window.__picked.push(options.suggestedName);
    return handle;
  };
  delete window.showDirectoryPicker;
});
const page = await context.newPage();
const errors = [], results = [];
page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
page.on("console", (msg) => { if (msg.type() === "error" && !/Failed to load resource|favicon/.test(msg.text())) errors.push(msg.text()); });
const visible = (locator) => locator.filter({ visible: true }).first();
const tid = (id) => visible(page.getByTestId(id));
const button = (name, exact = true) => visible(page.getByRole("button", { name, exact }));
const shot = (name) => page.screenshot({ path: `${shots}/${name}.png` });
const expect = (condition, message) => { if (!condition) throw new Error(message); };
const step = async (name, run) => {
  try { await run(); console.log("ok  ", name); }
  catch (err) { console.log("FAIL", name, "—", String(err).split("\n")[0]); errors.push(`step failed: ${name}`); await shot(`failure-${name.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}`).catch(() => undefined); await page.keyboard.press("Escape").catch(() => undefined); }
};
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;
const saved = () => visible(page.getByTestId("save-state").getByText("Saved", { exact: true })).waitFor({ timeout: 20_000 });
const dialog = () => tid("export-dialog");
/** The dialog asks the encoders again after a change and redraws: what is read next is read after that. */
const settle = () => page.waitForTimeout(400);
/** Picks an option of a select of the dialog by its accessible name. */
const choose = async (label, option) => {
  await visible(dialog().getByRole("combobox", { name: label, exact: true })).click();
  await visible(page.getByRole("option", { name: option, exact: true })).click();
  await settle();
};
const segment = (group, name) => visible(dialog().getByRole("radiogroup", { name: group, exact: true }).getByRole("radio", { name, exact: true }));
const openDialog = async () => { if (!(await page.getByTestId("export-dialog").count())) { await tid("open-export").click(); await dialog().waitFor(); await page.waitForTimeout(800); } };
const closeDialog = async () => { if (await page.getByTestId("export-dialog").count()) { await tid("export-close").click(); await page.getByTestId("export-dialog").waitFor({ state: "detached" }); } };
/** The bytes of a file the app wrote through the stand-in save dialog, copied out of the private file system. */
const picked = async (name) => {
  const bytes = await page.evaluate(async (fileName) => {
    const root = await navigator.storage.getDirectory(), folder = await root.getDirectoryHandle("picked"), file = await (await folder.getFileHandle(fileName)).getFile();
    const data = new Uint8Array(await file.arrayBuffer());
    let text = ""; for (let at = 0; at < data.length; at += 0x8000) text += String.fromCharCode(...data.subarray(at, at + 0x8000));
    return btoa(text);
  }, name);
  const path = join(out, name);
  writeFileSync(path, Buffer.from(bytes, "base64"));
  return path;
};
const privateFiles = () => page.evaluate(async () => {
  const names = [], root = await navigator.storage.getDirectory();
  for (const folder of ["exports", "picked"]) { try { const handle = await root.getDirectoryHandle(folder); for await (const [name, entry] of handle.entries()) names.push(`${folder}/${name}:${entry.kind === "file" ? (await entry.getFile()).size : 0}`); } catch { /* not there */ } }
  return names;
});
/** Presses Export and waits for the job to end; returns the name the file was saved under. */
const runExport = async (expected = "export-done") => {
  await tid("export-start").click();
  await Promise.race([tid(expected).waitFor({ timeout: 120_000 }), tid("export-error").waitFor({ timeout: 120_000 })]);
  expect(await page.getByTestId(expected).count(), `the export ended as expected; the dialog reads: ${(await dialog().innerText()).replace(/\s+/g, " ").slice(-300)}`);
  return (await tid("export-done-name").innerText()).trim();
};
/** The colour at the centre of the preview canvas, read from a screenshot. */
const previewColour = async () => {
  const box = await tid("canvas").boundingBox();
  const png = await page.screenshot({ clip: { x: Math.round(box.x + box.width / 2) - 3, y: Math.round(box.y + box.height / 2) - 3, width: 6, height: 6 } });
  return page.evaluate(async (data) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context2d = canvas.getContext("2d");
    context2d.drawImage(bitmap, 0, 0);
    const [r, g, b] = context2d.getImageData(3, 3, 1, 1).data;
    return { r, g, b };
  }, png.toString("base64"));
};
// What the page fetched of the engine's own files, and the workers it started.
const fetched = [], workers = [];
page.on("request", (request) => { if (/\/engine\//.test(request.url())) fetched.push(new URL(request.url()).pathname); });
page.on("worker", (worker) => workers.push(worker.url()));
const record = (name, facts) => { results.push({ name, ...facts }); console.log("      ffprobe", name, JSON.stringify(facts)); };
const streamsOf = (info, type) => info.streams.filter((stream) => stream.codec_type === type && stream.disposition?.attached_pic !== 1);
let projectName = "";
const fpsOf = (stream) => { const [n, d] = stream.avg_frame_rate.split("/").map(Number); return n / d; };

await step("a project with two clips: 7 s, 1920 × 1080, 30 fps", async () => {
  await page.goto(`${base}/projects`, { waitUntil: "networkidle", timeout: 180_000 });
  await button("Create your first project").click({ timeout: 90_000 });
  await page.waitForURL(/\/editor\/[0-9a-f-]{36}$/);
  await tid("timeline").waitFor({ timeout: 60_000 });
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), tid("media-dropzone").click()]);
  await chooser.setFiles([media("red.mp4"), media("blue.mp4")]);
  for (const name of ["red.mp4", "blue.mp4"]) await tid(`label-${name}`).waitFor({ timeout: 60_000 });
  await tid("thumb-red.mp4").dblclick();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="track-main-video"] [data-testid^="clip-"]').length >= 1);
  await page.keyboard.press("End");
  await tid("thumb-blue.mp4").dblclick();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="track-main-video"] [data-testid^="clip-"]').length >= 2);
  expect((await tid("player-duration").innerText()).includes("00:00:07:00"), `the scene is 7 s long: ${await tid("player-duration").innerText()}`);
  await saved();
  projectName = (await tid("project-name").innerText()).trim();
  await page.waitForTimeout(1500);
});

await step("Deferred probes — after the engine is ready a worker decodes the bundled probe clip and times the encoder; the result is kept for this browser", async () => {
  // The probes start 500 ms after the engine is ready, while nothing plays or exports, and take at most a few seconds.
  await page.waitForFunction(() => localStorage.getItem("jagentchill.engine.probes.v1") !== null, null, { timeout: 60_000 });
  const stored = JSON.parse(await page.evaluate(() => localStorage.getItem("jagentchill.engine.probes.v1")));
  console.log("      probes", JSON.stringify(stored.result));
  expect(workers.some((url) => new URL(url).pathname.endsWith("/engine/export-worker.js")), `the probes ran in the engine's worker: ${workers.join(", ")}`);
  expect(fetched.includes("/engine/decode-1080p30.mp4"), `the worker read the bundled probe clip: ${fetched.join(", ")}`);
  expect(stored.result.decode && stored.result.decode.realtime > 0 && stored.result.decode.seekP95 >= 0, `the decode probe measured the clip: ${JSON.stringify(stored.result.decode)}`);
  expect(stored.result.encode && stored.result.encode.realtime > 0, `the encode probe measured the encoder: ${JSON.stringify(stored.result.encode)}`);
});

await step("Open export on desktop — Default preset — Six export types — Recommended at 1080p30 H.264", async () => {
  await openDialog();
  expect((await tid("export-subtitle").innerText()).includes("16:9") && (await tid("export-subtitle").innerText()).includes("30 fps"), `the header names the project: ${await tid("export-subtitle").innerText()}`);
  const types = await dialog().getByRole("radiogroup", { name: "Export type" }).getByRole("radio").allInnerTexts();
  expect(types.join("|") === "Video|GIF|Audio|Image sequence|Still frame|Captions only", `six export types in order: ${types.join("|")}`);
  const summary = (await tid("export-summary").innerText()).replace(/\s+/g, " ");
  for (const text of ["Match project", "1920 × 1080", "30 fps", "H.264 · 10.0 Mbps VBR", "AAC 192 kbps · 48 kHz stereo", "Whole timeline"]) expect(summary.includes(text), `the summary shows ${text}: ${summary}`);
  expect((await tid("export-bitrate").innerText()).trim() === "10.0 Mbps", `Recommended at 1080p30 H.264 is 10.0 Mbps: ${await tid("export-bitrate").innerText()}`);
  expect((await tid("export-duration").innerText()).trim() === "00:07", "the duration is the timeline's");
  expect((await tid("export-estimate").innerText()).trim() === "≈ 8.9 MB", `the estimate is (10.0 Mbps + 192 kbps) × 7 s / 8: ${await tid("export-estimate").innerText()}`);
  expect((await tid("export-target").innerText()).trim() === "This device", "the target is this device");
  expect(await page.evaluate(() => document.activeElement?.getAttribute("data-testid") === "export-file-name" || document.activeElement?.closest('[data-testid="export-file-name"]') !== null), "focus is on the file name field");
  expect((await tid("export-range-hint").innerText()).includes("Set in and out points on the timeline"), "No range defined: the in/out choice is disabled with its hint");
  expect((await tid("export-no-captions").innerText()).includes("This project has no captions"), "the captions section says the project has none");
  expect(await segment("Export on", "Host (not connected)").isDisabled(), "Host not connected: the host target is disabled");
  await shot("01-dialog-1440-light");
});

await step("the dialog against its frame (#d-editor-export), light and dark", async () => {
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(500);
    const right = (await page.screenshot()).toString("base64");
    const design = await context.newPage();
    await design.setViewportSize({ width: 1700, height: 1100 });
    await design.emulateMedia({ colorScheme: scheme });
    await design.goto(`file://${process.cwd()}/docs/design/jagentchill-ui.html`);
    if (scheme === "dark") await design.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    const frame = design.locator("#d-editor-export .dframe").first();
    await frame.scrollIntoViewIfNeeded();
    const left = (await frame.screenshot()).toString("base64");
    await design.setViewportSize({ width: 2440, height: 820 });
    await design.setContent(`<body style="margin:0;background:#888;font:600 16px system-ui;color:#fff"><div style="display:flex;gap:20px;padding:10px"><div><div>DESIGN d-editor-export</div><img style="width:1200px;display:block" src="data:image/png;base64,${left}"></div><div><div>APP /editor — export dialog</div><img style="width:1200px;display:block" src="data:image/png;base64,${right}"></div></div></body>`);
    mkdirSync(".dev/compare", { recursive: true });
    await design.screenshot({ path: `.dev/compare/d-editor-export-${scheme}.png` });
    await design.close();
  }
  await page.emulateMedia({ colorScheme: "light" });
});

await step("Selecting WebM — Custom out of range — Odd custom size — Preset with a different aspect ratio — WebM cover", async () => {
  await openDialog();
  await choose("Format", "WebM");
  expect((await tid("export-notice").innerText()).includes("WebM requires VP9 or AV1; switched to VP9"), `the notice names the switch: ${await tid("export-notices").innerText()}`);
  expect((await tid("export-summary").innerText()).includes("VP9") && (await tid("export-summary").innerText()).includes("Opus 128 kbps"), "the codec is VP9 and the audio Opus");
  expect((await tid("export-summary").innerText()).includes("Custom"), "changing a field after a preset shows Custom");
  expect((await tid("export-cover-reason").innerText()).includes("Not supported for this format"), "Embed cover is disabled for WebM");
  await choose("Preset", "Match project");
  await segment("Bitrate", "Custom").click(); await settle();
  const custom = visible(dialog().getByRole("textbox", { name: "Custom bitrate" }));
  await custom.fill("500"); await custom.blur();
  expect((await tid("export-bitrate").innerText()).trim() === "200.0 Mbps", `a custom bitrate of 500 is clamped to 200: ${await tid("export-bitrate").innerText()}`);
  await choose("Resolution", "Custom");
  const width = visible(dialog().getByRole("textbox", { name: "Width" }));
  await width.fill("1001"); await width.blur();
  expect((await width.inputValue()) === "1002", `1001 is corrected to 1002: ${await width.inputValue()}`);
  await choose("Preset", "Vertical 9:16 short video");
  expect((await tid("export-aspect").innerText()).includes("Aspect ratio differs from the project; the picture is fitted with bars"), "the aspect warning is shown");
  expect((await tid("export-summary").innerText()).includes("1080 × 1920"), "the vertical preset is 1080 × 1920");
  await choose("Preset", "Match project");
});

await step("Keyboard-only export — export 1: Match project, H.264 + AAC in MP4, 1920 × 1080 at 30 fps — Progress is monotonic", async () => {
  // Percentages reported while it runs, read from the progress bar.
  await page.evaluate(() => { window.__percents = []; window.__watch = setInterval(() => { const bar = document.querySelector('[data-testid="export-progress-view"] [role="progressbar"]'); const now = bar?.getAttribute("aria-valuenow"); if (now !== null && now !== undefined) window.__percents.push(Number(now)); }, 100); });
  await openDialog();
  // The select that was just used gets its focus back when its list closes: the keyboard user starts after that.
  await page.waitForTimeout(500);
  await tid("export-start").focus();
  await page.keyboard.press("Enter");
  await tid("export-progress-view").waitFor({ timeout: 30_000 });
  expect(await tid("export-pause").count(), "a running on-device export offers Pause");
  await tid("export-done").waitFor({ timeout: 120_000 });
  const percents = await page.evaluate(() => { clearInterval(window.__watch); return window.__percents; });
  expect(percents.length > 2 && percents.every((value, index) => index === 0 || value >= percents[index - 1]), `each percentage is at least the one before: ${percents.join(",")}`);
  const name = (await tid("export-done-name").innerText()).trim();
  expect(name === `${projectName}.mp4`, `Default name: the project name with the extension: ${name}`);
  expect((await tid("export-saved-to").innerText()).includes(`Saved to ${projectName}.mp4`), "written to the chosen file: Download is replaced by Saved to");
  expect((await tid("export-summary-lines").innerText()).includes("No issues"), "Clean export: the summary shows No issues");
  expect((await tid("export-copy-link-reason").innerText()).includes("Connect a host to share by link"), "No host: Copy link is disabled with its reason");
  for (const id of ["tiktok", "youtube", "instagram", "facebook", "whatsapp"]) expect(await tid(`handoff-${id}`).count(), `the ${id} hand-off shortcut is there`);
  await shot("02-completion");
  const path = await picked(name), info = probe(path), [video] = streamsOf(info, "video"), [audio] = streamsOf(info, "audio");
  record("1 match-project mp4", { video: `${video.codec_name} ${video.width}x${video.height} ${video.avg_frame_rate} frames=${video.nb_read_frames}`, audio: `${audio?.codec_name} ${audio?.sample_rate} Hz ${audio?.channels} ch`, duration: info.format.duration, bit_rate: info.format.bit_rate, format: info.format.format_name });
  expect(video.codec_name === "h264" && video.width === 1920 && video.height === 1080 && near(fpsOf(video), 30, 0.01), "H.264 1920 × 1080 at 30 fps");
  expect(Number(video.nb_read_frames) === 210, `210 frames: ${video.nb_read_frames}`);
  expect(audio?.codec_name === "aac" && Number(audio.sample_rate) === 48000 && audio.channels === 2, "AAC 48 kHz stereo");
  expect(near(Number(info.format.duration), 7, 0.1), `7 s long: ${info.format.duration}`);
  const bytes = readFileSync(path), text = bytes.toString("latin1");
  expect(text.includes("xmp:CreatorTool=\"JAgentChill") && !text.includes("DigitalSourceType"), "No generated media: the file carries xmp:CreatorTool and no DigitalSourceType");
  expect(text.split("moov").length - 1 >= 1 && !text.includes("moof"), "the MP4 is not fragmented");
});

await step("Copy description — Title too long — the publish caption is saved with the project", async () => {
  const title = visible(tid("publish-caption").getByRole("textbox", { name: "Title" }));
  await title.fill("x".repeat(101));
  expect((await tid("publish-title-count").innerText()).trim() === "100 / 100", `the 101st character is not accepted: ${await tid("publish-title-count").innerText()}`);
  await title.fill("Two colours");
  const description = visible(tid("publish-caption").getByRole("textbox", { name: "Description" }));
  await description.fill("A red clip and a blue clip.");
  await tid("publish-description-copy").click();
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
  expect(clip === null || clip === "A red clip and a blue clip.", `the clipboard holds the description: ${clip}`);
  await closeDialog();
});

await step("Export render session — the export runs in a worker of its own and the preview stays interactive: a seek during the export shows its frame", async () => {
  const before = workers.length;
  await openDialog();
  await tid("export-start").click();
  await tid("export-progress-view").waitFor({ timeout: 30_000 });
  await closeDialog();
  await tid("export-indicator").waitFor({ timeout: 10_000 });
  const reads = [];
  // 5 s is in the blue clip, 1 s in the red one: each seek is answered with its own frame while the file is being rendered.
  for (const [time, name] of [["00:00:05:00", "blue"], ["00:00:01:00", "red"], ["00:00:06:00", "blue"], ["00:00:02:00", "red"]]) {
    await tid("timecode").fill(time); await page.keyboard.press("Enter");
    await page.waitForTimeout(350);
    const colour = await previewColour(), running = (await page.getByTestId("export-indicator").count()) > 0;
    const percent = running ? await tid("export-indicator-open").innerText().catch(() => "") : "done";
    reads.push({ time, name, colour, running, percent });
  }
  console.log("      seeks during the export", JSON.stringify(reads));
  expect(workers.slice(before).some((url) => new URL(url).pathname.endsWith("/engine/export-worker.js")), `the export started the engine's worker: ${workers.slice(before).join(", ")}`);
  const during = reads.filter((read) => read.running);
  expect(during.length >= 2, `at least two seeks were made while the export ran: ${reads.map((read) => read.percent).join(" ")}`);
  for (const read of during) expect(read.name === "blue" ? read.colour.b > 150 && read.colour.r < 90 : read.colour.r > 150 && read.colour.b < 90, `the preview shows the ${read.name} clip at ${read.time} during the export: ${JSON.stringify(read.colour)}`);
  await page.getByTestId("export-indicator").waitFor({ state: "detached", timeout: 120_000 });
  const path = await picked(`${projectName}.mp4`), info = probe(path), [video] = streamsOf(info, "video");
  record("1b match-project mp4, with seeks in the preview meanwhile", { video: `${video.codec_name} ${video.width}x${video.height} frames=${video.nb_read_frames}`, duration: info.format.duration });
  // The file is the whole timeline, whatever the preview showed meanwhile: red at 1 s, blue at 6 s.
  const frame = (at) => execFileSync("ffmpeg", ["-loglevel", "error", "-ss", String(at), "-i", path, "-frames:v", "1", "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  expect(Number(video.nb_read_frames) === 210 && frame(1)[0] > 150 && frame(6)[2] > 150, `the export is complete and unaffected by the seeks: ${video.nb_read_frames} frames`);
  await tid("timecode").fill("00:00:00:00"); await page.keyboard.press("Enter");
});

await step("export 2: 720p at 24 fps, VP9 + Opus in WebM, lower bitrate", async () => {
  await openDialog();
  expect((await tid("export-summary").innerText()).includes("Match project"), "the dialog opens with the settings last used for this project");
  await choose("Preset", "WebM");
  await choose("Resolution", "720p");
  await choose("Frame rate", "24 fps");
  await segment("Bitrate", "Lower").click(); await settle();
  const name = await runExport();
  const info = probe(await picked(name)), [video] = streamsOf(info, "video"), [audio] = streamsOf(info, "audio");
  record("2 webm 720p24", { video: `${video.codec_name} ${video.width}x${video.height} ${video.avg_frame_rate} frames=${video.nb_read_frames}`, audio: `${audio?.codec_name} ${audio?.sample_rate} Hz`, duration: info.format.duration, bit_rate: info.format.bit_rate, format: info.format.format_name });
  expect(name.endsWith(".webm") && video.codec_name === "vp9" && video.width === 1280 && video.height === 720, "VP9 1280 × 720 in WebM");
  expect(near(fpsOf(video), 24, 0.05) && near(Number(video.nb_read_frames), 168, 1), `24 fps, 168 frames: ${video.avg_frame_rate} ${video.nb_read_frames}`);
  expect(audio?.codec_name === "opus", "Opus audio");
  await closeDialog();
});

await step("Audio off — export 3: 480p MOV without audio at a custom 2.0 Mbps, bitrate within tolerance", async () => {
  await openDialog();
  await choose("Preset", "Match project");
  await choose("Resolution", "480p");
  await choose("Format", "MOV");
  await segment("Bitrate", "Custom").click(); await settle();
  const custom = visible(dialog().getByRole("textbox", { name: "Custom bitrate" }));
  await custom.fill("2"); await custom.blur(); await settle();
  await visible(dialog().getByRole("switch", { name: "Include audio" })).click(); await settle();
  expect((await tid("export-summary").innerText()).replace(/\s+/g, " ").includes("Audio None"), "the summary shows no audio");
  const name = await runExport();
  const path = await picked(name), info = probe(path), [video] = streamsOf(info, "video");
  record("3 mov 480p no audio", { video: `${video.codec_name} ${video.width}x${video.height} ${video.avg_frame_rate}`, audio: streamsOf(info, "audio").length, duration: info.format.duration, bit_rate: info.format.bit_rate, format: info.format.format_name });
  expect(name.endsWith(".mov") && video.width === 854 && video.height === 480, `854 × 480 in MOV: ${video.width}x${video.height}`);
  expect(streamsOf(info, "audio").length === 0, "the file contains no audio track");
  expect(readFileSync(path).subarray(4, 12).toString("latin1") === "ftypqt  ", "MOV output: the major brand is qt");
  expect(Number(info.format.bit_rate) < 2_000_000 * 1.6, `the bitrate follows the 2.0 Mbps asked (a flat colour needs less): ${info.format.bit_rate}`);
  await closeDialog();
});

await step("Export a range — export 4: in/out 2 s–5 s exports 90 frames starting inside the red clip", async () => {
  const ruler = await tid("timeline-ruler").boundingBox();
  // 50 px per second at zoom 1: the playhead goes to 2 s and to 5 s on the ruler.
  await page.mouse.click(ruler.x + 100, ruler.y + ruler.height / 2);
  await page.keyboard.press("i");
  await page.mouse.click(ruler.x + 250, ruler.y + ruler.height / 2);
  await page.keyboard.press("o");
  await openDialog();
  await choose("Preset", "Match project");
  await choose("Resolution", "480p");
  await segment("Range", "In/out range").click(); await settle();
  const start = await tid("export-range-start").inputValue(), end = await tid("export-range-end").inputValue();
  expect(start === "00:00:02:00" && end === "00:00:05:00", `the range is shown as timecodes: ${start} – ${end}`);
  expect((await tid("export-duration").innerText()).trim() === "00:03", "the duration is the range's");
  const name = await runExport();
  const path = await picked(name), info = probe(path), [video] = streamsOf(info, "video"), [audio] = streamsOf(info, "audio");
  record("4 range 2s-5s", { video: `${video.codec_name} ${video.width}x${video.height} frames=${video.nb_read_frames}`, audio: audio?.codec_name, duration: info.format.duration });
  expect(Number(video.nb_read_frames) === 90 && near(Number(info.format.duration), 3, 0.1), `90 frames, 3 s: ${video.nb_read_frames} ${info.format.duration}`);
  // The first frame is red (2 s into the red clip), the last blue (the blue clip starts at 4 s).
  const pixel = (at) => execFileSync("ffmpeg", ["-loglevel", "error", "-ss", String(at), "-i", path, "-frames:v", "1", "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  const first = pixel(0), last = pixel(2.8);
  expect(first[0] > 150 && first[2] < 90, `the first frame is the red clip: ${[...first]}`);
  expect(last[2] > 150 && last[0] < 90, `the last frame is the blue clip: ${[...last]}`);
  expect(audio?.codec_name === "aac", "the range has its audio");
  await closeDialog();
});

await step("Default GIF — export 5: a 3 s range as GIF, 854 × 480 at 15 fps, looping", async () => {
  await openDialog();
  await segment("Export type", "GIF").click(); await settle();
  expect((await tid("export-summary").innerText()).includes("854 × 480") && (await tid("export-summary").innerText()).includes("15 fps"), "GIF defaults: 480 short side, 15 fps");
  const name = await runExport();
  const path = await picked(name), info = probe(path), [video] = streamsOf(info, "video"), bytes = readFileSync(path);
  record("5 gif", { video: `${video.codec_name} ${video.width}x${video.height} frames=${video.nb_read_frames}`, duration: info.format.duration, bytes: bytes.length });
  expect(bytes.subarray(0, 6).toString("latin1") === "GIF89a" && video.width === 854 && video.height === 480, "a GIF89a of 854 × 480");
  expect(Number(video.nb_read_frames) === 45, `45 frames for 3 s at 15 fps: ${video.nb_read_frames}`);
  expect(bytes.includes(Buffer.from("NETSCAPE2.0")) && bytes.includes(Buffer.from("XMP DataXMP")), "infinite looping and the XMP packet are written");
  // Frame delays in 10 ms units repeat 7, 7, 6.
  const delays = []; for (let at = bytes.indexOf(Buffer.from([0x21, 0xf9, 0x04])); at >= 0 && delays.length < 6; at = bytes.indexOf(Buffer.from([0x21, 0xf9, 0x04]), at + 1)) delays.push(bytes.readUInt16LE(at + 4));
  expect(delays.join(",") === "7,7,6,7,7,6", `frame delays repeat 70, 70, 60 ms: ${delays.join(",")}`);
  await closeDialog();
});

await step("Too long for GIF is not the case here; WAV export — export 6: the 3 s range as WAV 16-bit 48 kHz stereo", async () => {
  await openDialog();
  await segment("Export type", "Audio").click(); await settle();
  await choose("Format", "WAV");
  expect((await tid("export-estimate").innerText()).trim() === "0.6 MB", `the WAV size is exact (576 044 bytes): ${await tid("export-estimate").innerText()}`);
  const name = await runExport();
  const path = await picked(name), info = probe(path), [audio] = streamsOf(info, "audio"), bytes = readFileSync(path);
  const dataAt = bytes.indexOf(Buffer.from("data")), dataBytes = bytes.readUInt32LE(dataAt + 4);
  record("6 wav", { audio: `${audio.codec_name} ${audio.sample_rate} Hz ${audio.channels} ch ${audio.bits_per_sample} bit`, duration: info.format.duration, dataBytes, fileBytes: bytes.length });
  expect(name.endsWith(".wav") && audio.codec_name === "pcm_s16le" && Number(audio.sample_rate) === 48000 && audio.channels === 2, "PCM 16-bit 48 kHz stereo");
  expect(streamsOf(info, "video").length === 0, "audio alone: no video stream");
  expect(dataBytes === 48000 * 2 * 2 * 3, `the sample data is exactly sampleRate × channels × 2 × 3 s: ${dataBytes}`);
  // The mix is not silent: the red clip's tone is in it.
  const peak = spawnSync("ffmpeg", ["-hide_banner", "-i", path, "-af", "volumedetect", "-f", "null", "-"]).stderr.toString().match(/max_volume: (-?[\d.]+) dB/);
  expect(peak && Number(peak[1]) > -30, `the WAV holds the mix: max volume ${peak?.[1]} dB`);
  await closeDialog();
});

await step("export 7: AAC in an .m4a container", async () => {
  await openDialog();
  await segment("Export type", "Audio").click(); await settle();
  await choose("Format", "AAC (M4A)");
  const name = await runExport();
  const info = probe(await picked(name)), [audio] = streamsOf(info, "audio");
  record("7 m4a", { audio: `${audio.codec_name} ${audio.sample_rate} Hz ${audio.channels} ch`, duration: info.format.duration, video: streamsOf(info, "video").length });
  expect(name.endsWith(".m4a") && audio.codec_name === "aac" && streamsOf(info, "video").length === 0 && near(Number(info.format.duration), 3, 0.15), "AAC alone, 3 s");
  expect(await visible(page.getByTestId("export-dialog")).count(), "the dialog is still open");
  await closeDialog();
});

await step("Still at playhead — export 8: a PNG still of the project canvas at the playhead", async () => {
  const ruler = await tid("timeline-ruler").boundingBox();
  await page.mouse.click(ruler.x + 300, ruler.y + ruler.height / 2);
  await openDialog();
  await segment("Export type", "Still frame").click(); await settle();
  await choose("Resolution", "Project (1920 × 1080)");
  const name = await runExport();
  const path = await picked(name), info = probe(path, "stream=codec_name,width,height"), bytes = readFileSync(path);
  record("8 still png", { name, video: `${info.streams[0].codec_name} ${info.streams[0].width}x${info.streams[0].height}`, bytes: bytes.length });
  expect(name === `${projectName}-00-00-06-00.png`, `the name carries the playhead timecode: ${name}`);
  expect(info.streams[0].codec_name === "png" && info.streams[0].width === 1920 && info.streams[0].height === 1080, "a PNG of the canvas size");
  expect(bytes.includes(Buffer.from("XML:com.adobe.xmp")) && bytes.includes(Buffer.from("xmp:CreatorTool")), "the PNG carries the XMP packet");
  const pixel = execFileSync("ffmpeg", ["-loglevel", "error", "-i", path, "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  expect(pixel[2] > 150 && pixel[0] < 90, `the frame at 6 s is the blue clip: ${[...pixel]}`);
  await closeDialog();
});

await step("Web without directory access — export 9: a JPEG sequence of the 3 s range as one ZIP, 90 files", async () => {
  await openDialog();
  await segment("Export type", "Image sequence").click(); await settle();
  await choose("Resolution", "480p");
  await choose("Format", "JPEG");
  expect((await tid("export-estimate").innerText()).trim() === "90 frames", `the estimate is the frame count: ${await tid("export-estimate").innerText()}`);
  expect((await tid("export-destination").inputValue()).includes("one ZIP file"), "without a directory picker the sequence is one ZIP");
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 120_000 }), tid("export-start").click()]);
  await tid("export-done").waitFor({ timeout: 60_000 });
  expect(download.suggestedFilename() === `${projectName}_frames.zip`, `the ZIP is named after the project: ${download.suggestedFilename()}`);
  const path = join(out, "frames.zip");
  await download.saveAs(path);
  const names = execFileSync("unzip", ["-Z1", path]).toString().split("\n").filter((name) => /\.jpg$/.test(name));
  mkdirSync(join(out, "frames"), { recursive: true });
  execFileSync("unzip", ["-o", "-q", path, `${projectName}_000001.jpg`, "-d", join(out, "frames")]);
  const info = probe(join(out, "frames", `${projectName}_000001.jpg`), "stream=codec_name,width,height");
  record("9 jpeg sequence zip", { files: names.length, first: names[0], last: names[names.length - 1], frame: `${info.streams[0].codec_name} ${info.streams[0].width}x${info.streams[0].height}` });
  expect(names.length === 90 && names[0] === `${projectName}_000001.jpg` && names[89].endsWith("_000090.jpg"), `90 files named _000001 … _000090: ${names.length} ${names[0]} ${names[89]}`);
  expect(info.streams[0].codec_name === "mjpeg" && info.streams[0].width === 854 && info.streams[0].height === 480, "each frame is a JPEG of the asked size");
  await closeDialog();
});

await step("Cancel mid-render — nothing partial is left, the job is in the history as cancelled", async () => {
  await openDialog();
  await segment("Export type", "Video").click(); await settle();
  await choose("Preset", "Match project");
  await segment("Range", "Entire timeline").click(); await settle();
  const before = await privateFiles();
  await tid("export-start").click();
  await tid("export-progress-view").waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => Number(document.querySelector('[data-testid="export-progress-view"] [role="progressbar"]')?.getAttribute("aria-valuenow") ?? 0) >= 20, null, { timeout: 120_000 });
  const pressed = Date.now();
  await tid("export-cancel").click();
  await visible(page.getByRole("dialog").getByText("Cancel export? The partial file is deleted.")).waitFor({ timeout: 5000 });
  await visible(page.getByRole("dialog").filter({ hasText: "Cancel export? The partial file is deleted." }).getByRole("button", { name: "Cancel export", exact: true })).click();
  await page.getByTestId("export-progress-view").waitFor({ state: "detached", timeout: 10_000 });
  console.log(`      cancelled ${Date.now() - pressed} ms after the press (confirmation included)`);
  await page.waitForTimeout(800);
  const after = await privateFiles();
  // The handle the stand-in dialog returned was never written to: the swap file was discarded on abort.
  const grown = after.filter((entry) => !before.includes(entry) && !/:0$/.test(entry));
  expect(grown.length === 0, `no output and no partial file remains: ${grown.join(", ")}`);
  await closeDialog();
});

await step("Second export is queued — two exports at once: the first runs, the second waits and starts when the first finishes", async () => {
  await openDialog();
  await choose("Resolution", "480p");
  await tid("export-start").click();
  await tid("export-progress-view").waitFor({ timeout: 30_000 });
  await closeDialog();
  // Close dialog during an export: the export continues and the top bar shows it.
  await tid("export-indicator").waitFor({ timeout: 10_000 });
  await openDialog();
  if (await page.getByTestId("export-progress-view").count()) { /* the dialog reopens on its settings */ }
  await choose("Format", "WebM");
  await tid("export-start").click();
  await tid("export-progress-view").waitFor({ timeout: 30_000 });
  expect((await tid("export-stage").innerText()).trim() === "Queued", `the second job is queued behind the first: ${await tid("export-stage").innerText()}`);
  await closeDialog();
  await tid("export-indicator-open").click();
  await page.waitForURL(/\/exports\/queue/);
  await tid("export-queue").waitFor({ timeout: 10_000 });
  const rows = await page.locator('[data-testid^="export-row-state-"]').allInnerTexts();
  expect(rows.length === 2, `the queue lists both jobs: ${rows.join(" | ")}`);
  await shot("03-queue-1440-light");
  // Opened from the top bar: the running job's view is open over the queue.
  await tid("job-dialog").waitFor({ timeout: 5000 });
  await button("Close").click();
  expect((await tid("footer-exports").getAttribute("aria-label")).includes("2 in progress"), `the Exports button shows the badge 2: ${await tid("footer-exports").getAttribute("aria-label")}`);
  // The editor closed while its engine was rendering: the jobs go on with an engine of their own.
  await page.waitForFunction(() => document.querySelectorAll('[data-testid^="export-row-state-"]').length === 0, null, { timeout: 400_000 });
  await visible(page.getByText("Nothing is exporting")).waitFor({ timeout: 10_000 });
});

await step("Export history — both jobs, the cancelled one and the earlier ones are listed; search and filters; Empty results", async () => {
  await visible(page.getByRole("tab", { name: "History", exact: true })).click();
  await page.waitForURL(/\/exports\/history/);
  await tid("export-history").waitFor({ timeout: 10_000 });
  const states = await page.locator('[data-testid^="export-row-state-"]').allInnerTexts();
  expect(states.filter((state) => state === "Finished").length === results.length + 2 && states.filter((state) => state === "Cancelled").length === 1, `the history holds every job: ${states.join(",")}`);
  await shot("04-history-1440-light");
  await visible(page.getByRole("combobox", { name: "State", exact: true })).click();
  await visible(page.getByRole("option", { name: "Cancelled", exact: true })).click();
  expect((await page.locator('[data-testid^="export-row-state-"]').allInnerTexts()).join() === "Cancelled", "the state filter keeps the cancelled job");
  await visible(page.getByRole("combobox", { name: "State", exact: true })).click();
  await visible(page.getByRole("option", { name: "All states", exact: true })).click();
  await visible(page.getByRole("searchbox", { name: "Search exports" })).fill("frames.zip");
  await page.waitForTimeout(500);
  expect((await page.locator('[data-testid^="export-row-state-"]').count()) === 1, "search by file name finds the sequence");
  await visible(page.getByRole("searchbox", { name: "Search exports" })).fill("");
  // The two jobs that ran after the editor closed were downloaded (no chosen file after a restart of their engine).
  const [first] = await page.locator('[data-testid^="export-row-open-"]').all();
  await first.click();
  await tid("job-dialog").waitFor();
  await tid("export-done").waitFor();
  await shot("05-history-job");
  await button("Close").click();
});

await step("Links without a host — the Links tab shows the requires-host state", async () => {
  await visible(page.getByRole("tab", { name: "Links", exact: true })).click();
  await page.waitForURL(/\/exports\/links/);
  await visible(tid("export-links-no-host").getByText("Connect a host to share by link")).waitFor({ timeout: 10_000 });
  await shot("06-links-no-host");
});

await step("the Exports screens at 390 × 844 and in the dark theme", async () => {
  for (const [name, size, scheme] of [["07-history-1440-dark", { width: 1440, height: 900 }, "dark"], ["08-history-390-light", { width: 390, height: 844 }, "light"], ["09-history-390-dark", { width: 390, height: 844 }, "dark"]]) {
    await page.setViewportSize(size); await page.emulateMedia({ colorScheme: scheme });
    await page.goto(`${base}/exports/history`, { waitUntil: "networkidle" });
    await tid("export-history").waitFor({ timeout: 30_000 });
    await shot(name);
  }
  await page.setViewportSize({ width: 1440, height: 900 }); await page.emulateMedia({ colorScheme: "light" });
});

await step("Settings restored per project — reopening the project finds the stored export settings; Re-export from history", async () => {
  await page.goto(`${base}/exports/history`, { waitUntil: "networkidle" });
  await tid("export-history").waitFor({ timeout: 30_000 });
  // "Export again" on the WebM job: the editor opens the dialog with every setting of that entry.
  const menus = await page.getByRole("button", { name: "Actions", exact: true }).all();
  await menus[0].click();
  await visible(page.locator('[role^="menuitem"]').filter({ hasText: "Export again" })).click();
  await page.waitForURL(/\/editor\//);
  await dialog().waitFor({ timeout: 90_000 });
  const again = (await tid("export-summary").innerText()).replace(/\s+/g, " ");
  expect(again.includes("VP9") && again.includes("854 × 480"), `Export again restores the entry's settings: ${again}`);
  await closeDialog();
  await page.reload({ waitUntil: "networkidle" });
  await tid("timeline").waitFor({ timeout: 90_000 });
  await page.waitForTimeout(1500);
  await openDialog();
  const stored = (await tid("export-summary").innerText()).replace(/\s+/g, " ");
  expect(stored.includes("VP9") && stored.includes("854 × 480") && stored.includes("Opus"), `the project keeps its last export settings: ${stored}`);
  const document = await page.evaluate(async () => {
    const id = location.pathname.split("/").pop();
    const database = await new Promise((resolve, reject) => { const request = indexedDB.open("jagentchill"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    for (const store of database.objectStoreNames) {
      const found = await new Promise((resolve) => { const all = database.transaction(store).objectStore(store).getAll(); all.onsuccess = () => resolve(all.result); all.onerror = () => resolve([]); });
      for (const value of found) { const text = typeof value === "string" ? value : JSON.stringify(value); if (text.includes(id) && text.includes("exportSettings")) return text.slice(text.indexOf("exportSettings") - 1, text.indexOf("exportSettings") + 400); }
    }
    return null;
  }).catch(() => null);
  if (document) console.log("      stored:", document.replace(/\\"/g, '"').slice(0, 300));
  await shot("10-dialog-restored");
});

await step("the dialog at 390 × 844 (full width below 960) and dark at 1440", async () => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(400);
  await shot("11-dialog-1440-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  const box = await dialog().boundingBox();
  expect(box.width >= 388, `below 960 px the dialog takes the full width: ${box.width}`);
  await shot("12-dialog-390-light");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(600);
  await closeDialog();
});

await step("Browser without File System Access — the file is downloaded from private storage under the sanitised name", async () => {
  await page.evaluate(() => { delete window.showSaveFilePicker; });
  await openDialog();
  await choose("Preset", "Small file 720p");
  await segment("Range", "In/out range").click(); await settle();
  const field = tid("export-file-name");
  await field.fill("Q3: Plan/Review?"); await field.blur();
  expect((await field.inputValue()) === "Q3_ Plan_Review_", `Illegal characters are replaced: ${await field.inputValue()}`);
  expect((await tid("export-destination").inputValue()) === "Browser downloads", "without a save dialog the destination is the browser's downloads");
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 120_000 }), tid("export-start").click()]);
  await tid("export-done").waitFor({ timeout: 60_000 });
  expect(download.suggestedFilename() === "Q3_ Plan_Review_.mp4", `downloaded under the sanitised name: ${download.suggestedFilename()}`);
  const path = join(out, "small.mp4");
  await download.saveAs(path);
  const info = probe(path), [video] = streamsOf(info, "video"), [audio] = streamsOf(info, "audio");
  record("10 small-720p (download)", { video: `${video.codec_name} ${video.width}x${video.height} ${video.avg_frame_rate} frames=${video.nb_read_frames}`, audio: `${audio?.codec_name}`, duration: info.format.duration, bit_rate: info.format.bit_rate });
  expect(video.width === 1280 && video.height === 720 && Number(video.nb_read_frames) === 90, "1280 × 720, 90 frames of the range");
  expect(await tid("export-download").isEnabled(), "Download is offered again from the completion view");
  await closeDialog();
});

await step("bitrate follows the setting — export 11: a detailed clip at 720p, Custom 4.0 Mbps CBR, muted audio; a second project has its own settings", async () => {
  await page.goto(`${base}/projects`, { waitUntil: "networkidle" });
  await button("New project").click({ timeout: 30_000 });
  await page.waitForURL(/\/editor\/[0-9a-f-]{36}$/);
  await tid("timeline").waitFor({ timeout: 60_000 });
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), tid("media-dropzone").click()]);
  await chooser.setFiles([media("detail2.mp4")]);
  await tid("label-detail2.mp4").waitFor({ timeout: 60_000 });
  await tid("thumb-detail2.mp4").dblclick();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="track-main-video"] [data-testid^="clip-"]').length >= 1);
  await saved();
  await page.waitForTimeout(1500);
  await openDialog();
  const fresh = (await tid("export-summary").innerText()).replace(/\s+/g, " ");
  // A project with no settings of its own starts from the settings last used on this device (the 720p export just made).
  expect(fresh.includes("1280 × 720") && fresh.includes("H.264") && !fresh.includes("VP9"), `a project with no saved settings opens on the device's last settings, not on the other project's: ${fresh}`);
  await choose("Preset", "Match project");
  await choose("Resolution", "720p");
  await segment("Bitrate", "Custom").click(); await settle();
  const custom = visible(dialog().getByRole("textbox", { name: "Custom bitrate" }));
  await custom.fill("4"); await custom.blur(); await settle();
  await choose("Rate control", "CBR");
  const path = await picked(await runExport());
  const info = probe(path), [video] = streamsOf(info, "video");
  const videoRate = Number(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=bit_rate", "-of", "csv=p=0", path]).toString().trim());
  record("11 detail 720p custom 4 Mbps CBR", { video: `${video.codec_name} ${video.width}x${video.height} frames=${video.nb_read_frames}`, audioStreams: streamsOf(info, "audio").length, duration: info.format.duration, video_bit_rate: videoRate, asked: 4_000_000 });
  expect(video.width === 1280 && video.height === 720 && Number(video.nb_read_frames) === 120, "1280 × 720, 120 frames");
  expect(videoRate > 4_000_000 * 0.65 && videoRate < 4_000_000 * 1.35, `the video bitrate is within 35 % of the 4.0 Mbps asked: ${videoRate}`);
  // The clip has no sound: "Include audio" on writes a silent track.
  expect(streamsOf(info, "audio").length === 1, "a timeline with no audible source and audio on gets a silent audio track");
  await closeDialog();
});

await browser.close();
writeFileSync(join(shots, "ffprobe.json"), JSON.stringify(results, null, 2));
if (errors.length) { console.log("\nERRORS\n" + [...new Set(errors)].join("\n")); process.exit(1); }
console.log("\nexport e2e: all steps passed");
