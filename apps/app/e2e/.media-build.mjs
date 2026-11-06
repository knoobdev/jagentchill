// End-to-end in a real browser against the Expo web dev server, with no host: the media library of a project.
// Real files generated with ffmpeg (the fixtures of packages/media), imported through the real file input and the real
// drop zone into real storage (IndexedDB and OPFS of a fresh browser profile). Nothing is seeded, mocked or stubbed;
// the camera of the recording step is Chromium's own fake capture device (--use-fake-device-for-media-stream), and the
// two remote servers of the URL-import step are answered by Playwright's network routing (a web page, and the real
// fixture file with permissive CORS), because the test machine has no public media server.
// Usage: node apps/app/e2e/media.mjs <screenshot-dir>
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { ensureFixtures, fixturePath } from "../../../packages/media/test/support/fixtures.ts";

const shots = process.argv[2] ?? ".dev/shots/media";
mkdirSync(shots, { recursive: true });
const NAMES = ["h264-aac.mp4", "alpha.png", "exif-rotated.jpg", "sine-10s.wav", "tone.mp3", "vp9-opus.webm", "uhd.webm", "large.jpg", "truncated.mp4", "scripted.svg", "silent.webm"];
ensureFixtures(NAMES);
const work = join(tmpdir(), "jagentchill-media-e2e"); mkdirSync(work, { recursive: true });
const longName = join(work, "very-long-recording-name-final-v2.webm"); copyFileSync(fixturePath("vp9-opus.webm"), longName);
const docx = join(work, "notes.docx"); writeFileSync(docx, "not media");
const f = (name) => fixturePath(name);

const base = "http://localhost:8091";
const browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light", acceptDownloads: true, permissions: ["clipboard-read", "clipboard-write"] });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (err) => errors.push(String(err)));
page.on("console", (msg) => msg.type() === "error" && !/Failed to load resource|ERR_/.test(msg.text()) && errors.push(msg.text()));
const visible = (locator) => locator.filter({ visible: true }).first();
const text = (value, options) => visible(page.getByText(value, options));
const button = (name, exact = true) => visible(page.getByRole("button", { name, exact }));
const menuItem = (name) => visible(page.getByRole("menuitem", { name, exact: true }).or(page.getByRole("menuitemradio", { name, exact: true })).or(page.getByRole("menuitemcheckbox", { name, exact: true })));
const shot = (name) => page.screenshot({ path: `${shots}/${name}.png` });
const tile = (name) => visible(page.getByTestId(`asset-${name}`));
const expect = (condition, message) => { if (!condition) throw new Error(message); };
const step = async (name, run) => { try { await run(); console.log("ok  ", name); } catch (err) { console.log("FAIL", name, "—", String(err).split("\n").slice(0, 4).join(" ")); errors.push(`step failed: ${name}`); await shot("failure"); console.log("PAGE TEXT:", (await page.locator("body").innerText()).replace(/\n+/g, " | ").slice(0, 700)); await browser.close(); console.log("ERRORS:\n" + errors.join("\n")); process.exit(1); } };
const importFiles = async (paths) => { const chooser = page.waitForEvent("filechooser"); await button("Import").click(); await menuItem("Import files…").click(); await (await chooser).setFiles(paths); };
const assetNames = async () => page.locator('[data-testid="media-items"] [data-testid^="asset-"]').filter({ visible: true }).evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid").slice(6)));
const context_ = async (name, item) => { await tile(name).click({ button: "right" }); await menuItem(item).click(); };
const info = async (id) => (await visible(page.getByTestId(`info-${id}`)).innerText()).trim();
const dropFiles = async (paths, target) => {
  const data = await page.evaluateHandle((files) => { const transfer = new DataTransfer(); for (const file of files) transfer.items.add(new File([Uint8Array.from(atob(file.b64), (c) => c.charCodeAt(0))], file.name, { type: file.type })); return transfer; },
    paths.map(([path, type]) => ({ name: path.split("/").pop(), type, b64: readFileSync(path).toString("base64") })));
  await target.dispatchEvent("dragenter", { dataTransfer: data });
  await target.dispatchEvent("dragover", { dataTransfer: data });
  return { drop: () => target.dispatchEvent("drop", { dataTransfer: data }) };
};

await step("a new project opens with the Media tab and the empty drop zone", async () => {
  await page.goto(`${base}/projects`, { waitUntil: "networkidle", timeout: 180_000 });
  await button("Create your first project").click();
  await page.waitForURL(/\/editor\/[0-9a-f-]{36}$/);
  await visible(page.getByTestId("media-dropzone")).waitFor();
  await text("Drag and drop videos, photos, and audio files here").waitFor();
  await visible(page.getByTestId("media-footer")).waitFor();
  await shot("01-empty-library");
});
await step("Picker cancelled: nothing changes and no toast is shown", async () => {
  const chooser = page.waitForEvent("filechooser"); await visible(page.getByTestId("media-dropzone")).click(); await (await chooser).setFiles([]);
  await page.waitForTimeout(600);
  expect((await assetNames()).length === 0 && (await page.getByRole("status").filter({ hasText: "uploaded" }).count()) === 0, "nothing imported, no toast");
});
await step("Multiple files + Batch with one failure: real files through the file input, the .docx is reported as unsupported", async () => {
  const chooser = page.waitForEvent("filechooser"); await visible(page.getByTestId("media-dropzone")).click();
  await (await chooser).setFiles([f("h264-aac.mp4"), f("alpha.png"), docx, f("exif-rotated.jpg"), f("sine-10s.wav")]);
  await text("4 media assets have been uploaded").waitFor({ timeout: 90_000 });
  await text("Unsupported file type: notes.docx", { exact: false }).waitFor();
  const names = await assetNames();
  expect(JSON.stringify(names) === JSON.stringify(["alpha.png", "exif-rotated.jpg", "h264-aac.mp4", "sine-10s.wav"]), `sorted by name ascending: ${names}`);
});
await step("Thumbnails, duration badges and the audio waveform glyph come from the files", async () => {
  for (const name of ["h264-aac.mp4", "alpha.png", "exif-rotated.jpg"]) {
    const image = visible(page.getByTestId(`thumb-${name}`)); await image.waitFor({ timeout: 30_000 });
    const size = await image.evaluate(async (node) => { const img = node.tagName === "IMG" ? node : node.querySelector("img"); const url = img?.src ?? getComputedStyle(node.firstElementChild ?? node).backgroundImage.slice(5, -2); const loaded = new Image(); loaded.src = url; await loaded.decode(); return [loaded.naturalWidth, loaded.naturalHeight, url.slice(0, 5)]; });
    console.log("     thumbnail", name, size.join("×"));
    if (name === "h264-aac.mp4") expect(size[0] === 640 && size[1] === 360, `video thumbnail ${size}`);
    if (name === "alpha.png") expect(size[0] === 64 && size[1] === 48, `png thumbnail ${size}`);
    // The JPEG is 80 × 40 with EXIF orientation 6: displayed upright it is 40 × 80.
    if (name === "exif-rotated.jpg") expect(size[0] === 40 && size[1] === 80, `rotated thumbnail ${size}`);
    expect(size[2] === "blob:", "thumbnails come from the thumbnail store, not data URLs");
  }
  expect((await visible(page.getByTestId("duration-h264-aac.mp4")).innerText()) === "00:02", "video duration badge");
  expect((await visible(page.getByTestId("duration-sine-10s.wav")).innerText()) === "00:10", "audio duration badge");
  await page.waitForFunction(() => { const glyph = document.querySelector('[data-testid^="waveform-"]'); return glyph && glyph.children.length > 10; }, null, { timeout: 30_000 });
  await shot("02-library-grid");
});
await step("Info for a video: values probed from the file; Info for an image omits frame rate, duration and audio", async () => {
  await context_("h264-aac.mp4", "Info");
  await visible(page.getByTestId("asset-info")).waitFor();
  expect((await info("type")) === "Video", "type");
  expect((await info("container")) === "MP4 · H.264 · AAC", `container ${await info("container")}`);
  expect((await info("resolution")) === "640 × 360", `resolution ${await info("resolution")}`);
  expect((await info("fps")) === "30 fps", `fps ${await info("fps")}`);
  expect((await info("duration")) === "00:02", "duration");
  await page.waitForFunction(() => document.querySelector('[data-testid="info-audio"]')?.textContent === "48 kHz · Stereo", null, { timeout: 20_000 });
  expect(/^[0-9a-f]{12}$/.test(await visible(page.getByTestId("info-hash")).innerText()), "12 characters of the content hash");
  expect((await info("usage")) === "0 clips", "usage");
  await visible(page.locator("video")).waitFor();
  await shot("03-info-video");
  await button("Back to media").click();
  await context_("alpha.png", "Info");
  expect((await info("resolution")) === "64 × 48 · Alpha", `png resolution ${await info("resolution")}`);
  expect((await page.getByTestId("info-fps").count()) === 0 && (await page.getByTestId("info-duration").count()) === 0 && (await page.getByTestId("info-audio").count()) === 0, "no frame rate, duration or audio for an image");
  await button("Back to media").click();
  await context_("exif-rotated.jpg", "Info");
  expect((await info("resolution")) === "40 × 80", `rotated jpeg ${await info("resolution")}`);
  await button("Back to media").click();
  await context_("sine-10s.wav", "Info");
  await page.waitForFunction(() => document.querySelector('[data-testid="info-audio"]')?.textContent === "44.1 kHz · Mono", null, { timeout: 20_000 });
  await visible(page.locator("audio")).waitFor();
  await button("Back to media").click();
});
await step("Probe results survive reload: the values are shown again without the files being probed", async () => {
  await text("Saved", { exact: true }).waitFor();
  await page.reload({ waitUntil: "networkidle" });
  await tile("h264-aac.mp4").waitFor({ timeout: 90_000 });
  await visible(page.getByTestId("thumb-h264-aac.mp4")).waitFor({ timeout: 30_000 });
  await context_("h264-aac.mp4", "Info");
  expect((await info("fps")) === "30 fps" && (await info("container")) === "MP4 · H.264 · AAC", "persisted probe fields");
  await button("Back to media").click();
});
await step("Drop files: the drop zone appears over the panel and both audio files are imported; a duplicate is reused", async () => {
  const panel = visible(page.getByTestId("media-panel"));
  const drag = await dropFiles([[f("tone.mp3"), "audio/mpeg"], [f("sine-10s.wav"), "audio/wav"]], panel);
  await visible(page.getByTestId("media-drop-overlay")).waitFor(); await shot("04-drop-zone");
  await drag.drop();
  await text("tone.mp3 has been uploaded").waitFor({ timeout: 60_000 });
  await text("sine-10s.wav is already in this project").waitFor();
  expect((await page.getByTestId("media-drop-overlay").filter({ visible: true }).count()) === 0, "the panel left the drag-over state");
  expect((await assetNames()).filter((name) => name === "sine-10s.wav").length === 1, "the duplicate was not added again");
});
await step("Truncated name; Unable to read a truncated MP4; SVG with a script is rasterised without running it", async () => {
  await importFiles([longName, f("truncated.mp4"), f("scripted.svg")]);
  await text("2 media assets have been uploaded").waitFor({ timeout: 60_000 });
  await text("Unable to read truncated.mp4", { exact: false }).waitFor();
  expect((await visible(page.getByTestId("label-very-long-recording-name-final-v2.webm")).innerText()) === "very-long-record…-v2", "card label");
  await visible(page.getByTestId("thumb-scripted.svg")).waitFor({ timeout: 20_000 });
  expect(await page.evaluate(() => !("__svgScriptRan" in window)), "the SVG script did not run");
});
await step("Flip sort order, sort by file size, list view and Persistence across a reload", async () => {
  const sortBy = async (name) => { await button("Sort and filter").click(); await visible(page.getByRole("menuitemcheckbox", { name }).or(page.getByRole("menuitemradio", { name })).or(page.getByRole("menuitem", { name }))).click(); };
  await sortBy(/^Name/);
  const descending = await assetNames();
  expect(descending[0] === "very-long-recording-name-final-v2.webm" && descending.at(-1) === "alpha.png", `name descending: ${descending}`);
  await sortBy(/^File size/);
  await button("List view").click();
  await text("Resolution", { exact: true }).waitFor(); await text("Date added", { exact: true }).waitFor();
  await shot("05-list-view");
  await text("Saved", { exact: true }).waitFor();
  await page.reload({ waitUntil: "networkidle" });
  await button("Grid view").waitFor({ timeout: 90_000 });
  await button("Sort and filter").click(); await visible(page.getByRole("menuitemcheckbox", { name: /^File size ↑/ }).or(page.getByRole("menuitem", { name: /^File size ↑/ })).or(page.getByRole("menuitemradio", { name: /^File size ↑/ }))).waitFor(); await page.keyboard.press("Escape");
  await button("Grid view").click();
  await button("Sort and filter").click(); await visible(page.getByRole("menuitem", { name: /^Name/ }).or(page.getByRole("menuitemcheckbox", { name: /^Name/ })).or(page.getByRole("menuitemradio", { name: /^Name/ }))).click();
});
await step("Folders: create, Depth limit, Move into a folder by drag, search across folders with the folder path, Delete folder keeps assets", async () => {
  await button("New folder").click(); await page.getByLabel("Folder name").fill("B-roll"); await button("Create").click();
  await visible(page.getByTestId("folder-B-roll")).waitFor();
  await tile("h264-aac.mp4").click(); await tile("alpha.png").click({ modifiers: ["ControlOrMeta"] });
  await tile("h264-aac.mp4").dragTo(visible(page.getByTestId("folder-B-roll")));
  await tile("h264-aac.mp4").waitFor({ state: "detached" }); await tile("alpha.png").waitFor({ state: "detached" });
  await page.getByRole("searchbox", { name: "Search media" }).fill("H264");
  await tile("h264-aac.mp4").waitFor(); await text("B-roll", { exact: true }).first().waitFor();
  expect((await assetNames()).length === 1, "search is case-insensitive and spans folders");
  await page.getByRole("searchbox", { name: "Search media" }).fill("zzzz"); await text("No media found").waitFor(); await button("Clear search").click();
  await visible(page.getByTestId("folder-B-roll")).click(); await tile("h264-aac.mp4").waitFor(); await shot("06-folder");
  // Levels 2, 3 and 4, then "New folder" is disabled.
  for (const name of ["L2", "L3", "L4"]) { await button("New folder").click(); await page.getByLabel("Folder name").fill(name); await button("Create").click(); await visible(page.getByTestId(`folder-${name}`)).click(); }
  expect(await button("New folder").isDisabled(), "New folder is disabled inside a level-4 folder");
  await visible(page.getByRole("link", { name: "Project media" }).or(page.getByRole("button", { name: "Project media" }))).click();
  await visible(page.getByTestId("folder-B-roll")).click({ button: "right" }); await menuItem("Delete folder").click(); await button("Delete folder").click();
  await tile("h264-aac.mp4").waitFor(); await tile("alpha.png").waitFor();
});
await step("Filters: Type is Audio shows a chip and only audio; Clear filters restores", async () => {
  await button("Sort and filter").click(); await page.getByRole("menuitem", { name: "Type", exact: true }).filter({ visible: true }).last().click(); await menuItem("Audio").click();
  await visible(page.getByTestId("media-filters")).waitFor();
  const audio = await assetNames();
  expect(JSON.stringify(audio.sort()) === JSON.stringify(["sine-10s.wav", "tone.mp3"]), `audio only: ${audio}`);
  await shot("07-filter");
  await text("Clear filters").click();
  expect((await assetNames()).length === 7, `all assets again: ${await assetNames()}`);
});
await step("Range select, marquee, rename (undoable), tags with the 32-character limit", async () => {
  const names = await assetNames();
  await tile(names[0]).click(); await tile(names[3]).click({ modifiers: ["Shift"] });
  const ranged = await page.locator('[data-testid^="asset-"][aria-selected="true"]').count();
  expect(ranged === 4, `Shift-click selects assets 1–4, got ${ranged} of ${names.length}`);
  await page.keyboard.press("Escape");
  const first = await tile(names[0]).boundingBox(), footer = await visible(page.getByTestId("media-footer")).boundingBox();
  // The drag starts on the empty area under the last row of cards.
  await page.mouse.move(footer.x + footer.width / 2, footer.y - 12); await page.mouse.down();
  await page.mouse.move(first.x + 4, first.y + 4, { steps: 8 });
  await visible(page.getByTestId("media-marquee")).waitFor(); await shot("07b-marquee");
  const selected = await page.locator('[data-testid^="asset-"][aria-selected="true"]').count();
  await page.mouse.up();
  expect(selected >= 3, `the marquee selected the cards it touched, got ${selected}`);
  await context_("tone.mp3", "Rename"); await page.getByLabel("New name").fill("  Music bed  "); await page.keyboard.press("Enter");
  await tile("Music bed").waitFor();
  await button(/^Undo/).click(); await tile("tone.mp3").waitFor(); await button(/^Redo/).click(); await tile("Music bed").waitFor();
  await context_("Music bed", "Info");
  await page.getByLabel("Add a tag").fill("x".repeat(40));
  expect((await page.getByLabel("Add a tag").inputValue()).length === 32, "a tag has at most 32 characters");
  await page.getByLabel("Add a tag").fill("music"); await page.keyboard.press("Enter"); await text("music", { exact: true }).waitFor();
  await button("Back to media").click();
  await page.getByRole("searchbox", { name: "Search media" }).fill("MUSIC"); await page.waitForFunction(() => document.querySelectorAll('[data-testid="media-items"] [data-testid^="asset-"]').length === 1, null, { timeout: 5000 }); expect((await assetNames())[0] === "Music bed", "search by tag");
  await page.getByRole("searchbox", { name: "Search media" }).fill("");
});
await step("Automatic proxy for 4K: the card shows progress, then the Proxy badge; Delete proxy and Create proxy", async () => {
  await importFiles([f("uhd.webm")]);
  await text("uhd.webm has been uploaded").waitFor({ timeout: 120_000 });
  await tile("uhd.webm").getByText(/^Proxy( \d+ %| queued)?$/).first().waitFor({ timeout: 60_000 });
  await tile("uhd.webm").getByText("Proxy", { exact: true }).waitFor({ timeout: 240_000 });
  await context_("uhd.webm", "Info");
  const proxy = await info("proxy"); console.log("     proxy:", proxy);
  expect(/^Proxy · (MP4|WEBM) · /.test(proxy), `proxy state ${proxy}`);
  await shot("08-proxy");
  await button("Back to media").click();
  await context_("uhd.webm", "Delete proxy");
  await tile("uhd.webm").getByText("Proxy", { exact: true }).waitFor({ state: "detached" });
});
await step("Export original files: the download is byte-identical to the imported file", async () => {
  const download = page.waitForEvent("download");
  await context_("alpha.png", "Export original files");
  const saved = await (await download).path();
  expect(readFileSync(saved).equals(readFileSync(f("alpha.png"))), "exported bytes equal the original");
});
await step("Relink with the same file is silent; a different file shows the comparison and trims nothing without clips", async () => {
  const relink = async (name, path) => { const chooser = page.waitForEvent("filechooser"); await context_(name, "Relink…"); await (await chooser).setFiles(path); };
  await relink("h264-aac.mp4", f("h264-aac.mp4"));
  await text("Media relinked").waitFor({ timeout: 30_000 });
  expect((await page.getByTestId("relink-compare").count()) === 0, "no dialog for the same content");
  await relink("h264-aac.mp4", longName);
  await visible(page.getByTestId("relink-compare")).waitFor({ timeout: 30_000 }); await shot("09-relink-compare");
  await text("640 × 360").waitFor(); await text("320 × 240").waitFor();
  await button("Relink").click(); await text("Media relinked").waitFor({ timeout: 30_000 });
  await context_("h264-aac.mp4", "Info"); expect((await info("resolution")) === "320 × 240", "the asset now describes the new file"); await button("Back to media").click();
  await button(/^Undo/).click();
  await context_("h264-aac.mp4", "Info"); expect((await info("resolution")) === "640 × 360", "relink is undoable"); await button("Back to media").click();
  await button(/^Redo/).click();
});
await step("Unused asset is deleted without confirmation; undo brings it back", async () => {
  await context_("exif-rotated.jpg", "Delete");
  await tile("exif-rotated.jpg").waitFor({ state: "detached" });
  expect((await page.getByRole("dialog").filter({ visible: true }).count()) === 0, "no confirmation for an unused asset");
  await button(/^Undo/).click(); await tile("exif-rotated.jpg").waitFor();
  await visible(page.getByTestId("thumb-exif-rotated.jpg")).waitFor();
});
await step("Import from URL: a private address and a web page are refused; Direct download adds a video whose provenance records the URL", async () => {
  await page.route("https://media.example.test/**", (route) => (route.request().url().endsWith(".webm")
    ? route.fulfill({ status: 200, headers: { "content-type": "video/webm", "access-control-allow-origin": "*" }, body: readFileSync(f("silent.webm")) })
    : route.fulfill({ status: 200, headers: { "content-type": "text/html", "access-control-allow-origin": "*" }, body: "<html></html>" })));
  const confirm = () => visible(page.getByRole("dialog").getByRole("button", { name: "Import", exact: true })).click();
  await button("Import").click(); await menuItem("Import from URL…").click();
  await page.getByLabel("Link to a video, image or audio file").fill("http://192.168.1.10/a.mp4"); await confirm();
  await text("Download from 192.168.1.10 failed", { exact: false }).waitFor({ timeout: 20_000 });
  await page.getByLabel("Link to a video, image or audio file").fill("https://media.example.test/page.html"); await confirm();
  await text("The link does not point to a supported media file").waitFor({ timeout: 20_000 }); await shot("10-url-import");
  await page.getByLabel("Link to a video, image or audio file").fill("https://media.example.test/downloaded-clip.webm"); await confirm();
  await text("downloaded-clip.webm has been uploaded").waitFor({ timeout: 60_000 });
  await context_("downloaded-clip.webm", "Info");
  await text("Imported from a link").waitFor(); await text("https://media.example.test/downloaded-clip.webm").waitFor();
  await button("Back to media").click();
});
await step("Camera recording: countdown, elapsed time, level meter, Pause and Resume, Stop makes a video asset with audio", async () => {
  await button("Import").click(); await menuItem("Record").click(); await menuItem("Camera").click();
  await button("Start recording").click();
  await visible(page.getByTestId("recorder-countdown")).waitFor({ timeout: 20_000 });
  await text("Recording", { exact: true }).waitFor({ timeout: 15_000 });
  await page.waitForTimeout(2200); await shot("11-recorder");
  await button("Pause").click(); await text("Paused", { exact: true }).waitFor(); const paused = await visible(page.getByTestId("recorder-elapsed")).innerText();
  await page.waitForTimeout(2000);
  expect((await visible(page.getByTestId("recorder-elapsed")).innerText()) === paused, "paused time is not recorded");
  await button("Resume").click(); await page.waitForTimeout(1500);
  await button("Stop").click();
  await text(/Camera recording .* has been uploaded/).waitFor({ timeout: 60_000 });
  const recorded = (await assetNames()).find((name) => name.startsWith("Camera recording"));
  expect(/^Camera recording \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}\.webm$/.test(recorded ?? ""), `recording name ${recorded}`);
  await context_(recorded, "Info");
  const seconds = (await info("duration")); console.log("     recorded duration", seconds, "source", await visible(page.getByText("Recorded", { exact: true })).innerText());
  expect(["00:03", "00:04", "00:05"].includes(seconds), `about 3.7 s were recorded, the 2 s pause is not: ${seconds}`);
  await button("Back to media").click();
});
await step("Missing media: bytes removed from the store show Offline, the banner and Relink; picking the original brings it back", async () => {
  const projectId = page.url().split("/").pop();
  // The asset's file is deleted behind the app's back, in the origin's private file system — as a wiped disk would.
  await page.evaluate(async (id) => {
    const root = await navigator.storage.getDirectory(); const media = await (await (await root.getDirectoryHandle("projects")).getDirectoryHandle(id)).getDirectoryHandle("media");
    for await (const [name] of media.entries()) if (name.endsWith(".png")) await media.removeEntry(name);
  }, projectId);
  await page.reload({ waitUntil: "networkidle" });
  await visible(page.getByTestId("media-offline-banner")).waitFor({ timeout: 90_000 });
  await text("1 media file is offline").waitFor(); await tile("alpha.png").getByText("Offline").waitFor(); await shot("12-offline");
  const chooser = page.waitForEvent("filechooser"); await visible(page.getByTestId("media-offline-banner").getByText("Relink…")).click(); await (await chooser).setFiles(f("alpha.png"));
  await text("Media relinked").waitFor({ timeout: 30_000 });
  await visible(page.getByTestId("media-offline-banner")).waitFor({ state: "detached" });
});
await step("Libraries are separate: another project does not list these files", async () => {
  await text("Saved", { exact: true }).waitFor();
  await button("Editor menu").click(); await menuItem("Back to projects").click(); await page.waitForURL(/\/projects$/);
  await button("New project").click(); await page.waitForURL(/\/editor\//);
  await visible(page.getByTestId("media-dropzone")).waitFor();
  expect((await assetNames()).length === 0, "the second project's library is empty");
  await button("Editor menu").click(); await menuItem("Back to projects").click(); await page.waitForURL(/\/projects$/);
});
await step("Import media on Home creates a project and imports the picked files into it", async () => {
  await page.goto(`${base}/home`, { waitUntil: "networkidle" });
  const chooser = page.waitForEvent("filechooser"); await button("Import media").click(); await (await chooser).setFiles([f("large.jpg")]);
  await page.waitForURL(/\/editor\//);
  await tile("large.jpg").waitFor({ timeout: 90_000 });
  const size = await visible(page.getByTestId("thumb-large.jpg")).evaluate(async (node) => { const img = node.tagName === "IMG" ? node : node.querySelector("img"); const loaded = new Image(); loaded.src = img?.src ?? getComputedStyle(node.firstElementChild ?? node).backgroundImage.slice(5, -2); await loaded.decode(); return [loaded.naturalWidth, loaded.naturalHeight]; });
  expect(size[0] === 1080 && size[1] === 720, `Large image: the stored thumbnail of a 6000 × 4000 image is 1080 × 720, got ${size}`);
});

for (const [width, height, scheme, name] of [[1440, 900, "dark", "20-editor-1440-dark"], [390, 844, "light", "21-editor-390-light"], [390, 844, "dark", "22-editor-390-dark"]]) {
  await step(`screenshot ${name}`, async () => {
    await page.emulateMedia({ colorScheme: scheme }); await page.setViewportSize({ width, height }); await page.waitForTimeout(600);
    if (width < 720) { await button("Media").click(); await visible(page.getByTestId("media-sheet")).waitFor(); await tile("large.jpg").waitFor(); await page.waitForTimeout(900); }
    await shot(name);
    if (width < 720) await page.keyboard.press("Escape");
  });
}
await browser.close();
if (errors.length) { console.log("ERRORS:\n" + errors.join("\n")); process.exit(1); }
console.log("E2E OK — no page errors");
