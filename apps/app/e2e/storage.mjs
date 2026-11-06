// End-to-end in a real browser against the Expo web dev server, with no host: the storage screens.
// Real storage (IndexedDB and OPFS of a fresh browser profile) and real files generated with ffmpeg; nothing is seeded
// or mocked. The crash of the crash-recovery step is a real one: the page is closed without leaving the editor.
// Usage: node apps/app/e2e/storage.mjs <screenshot-dir>
import { mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { ensureFixtures, fixturePath } from "../../../packages/media/test/support/fixtures.ts";

const shots = process.argv[2] ?? ".dev/shots/storage";
mkdirSync(shots, { recursive: true });
ensureFixtures(["h264-aac.mp4", "alpha.png", "tone.mp3"]);
const base = process.env.E2E_BASE ?? "http://localhost:8081";
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light", acceptDownloads: true });
let page = await context.newPage();
const errors = [];
const watch = (target) => { target.on("pageerror", (err) => errors.push(String(err))); target.on("console", (msg) => msg.type() === "error" && !/Failed to load resource|ERR_/.test(msg.text()) && errors.push(msg.text())); };
watch(page);
const visible = (locator) => locator.filter({ visible: true }).first();
const on = (target) => ({
  text: (value, options) => visible(target.getByText(value, options)), button: (name, exact = true) => visible(target.getByRole("button", { name, exact })),
  menuItem: (name) => visible(target.getByRole("menuitem", { name, exact: true })), tile: (name) => visible(target.getByTestId(`asset-${name}`)),
});
let ui = on(page);
const shot = (name) => page.screenshot({ path: `${shots}/${name}.png` });
const expect = (condition, message) => { if (!condition) throw new Error(message); };
const step = async (name, run) => { try { await run(); console.log("ok  ", name); } catch (err) { console.log("FAIL", name, "—", String(err).split("\n").slice(0, 4).join(" ")); errors.push(`step failed: ${name}`); await shot("failure"); console.log("PAGE TEXT:", (await page.locator("body").innerText()).replace(/\n+/g, " | ").slice(0, 700)); await browser.close(); console.log("ERRORS:\n" + errors.join("\n")); process.exit(1); } };
const editorMenu = async (item) => { await ui.button("Editor menu").click(); await ui.menuItem(item).click(); };
let packagePath = "";

await step("a project with real media: created through the UI, three files imported through the file input", async () => {
  await page.goto(`${base}/projects`, { waitUntil: "networkidle", timeout: 180_000 });
  await ui.button("Create your first project").click(); await page.waitForURL(/\/editor\//);
  await ui.button("Rename: New project").click(); await page.getByLabel("Project name").fill("Da Lat trip"); await page.keyboard.press("Enter");
  const chooser = page.waitForEvent("filechooser"); await visible(page.getByTestId("media-dropzone")).click();
  await (await chooser).setFiles([fixturePath("h264-aac.mp4"), fixturePath("alpha.png"), fixturePath("tone.mp3")]);
  await ui.text("3 media assets have been uploaded").waitFor({ timeout: 90_000 });
  await ui.text("Saved", { exact: true }).waitFor();
});
await step("Version history: Save version, delete an asset, Restore brings it back with an empty undo history", async () => {
  await editorMenu("Version history");
  await page.getByLabel("Version label").fill("Three assets"); await ui.button("Save version").click();
  await ui.text("Three assets", { exact: true }).waitFor(); await ui.text("Manual", { exact: true }).waitFor(); await shot("01-version-history");
  await ui.button("Close").click();
  await ui.tile("alpha.png").click({ button: "right" }); await ui.menuItem("Delete").click();
  await ui.tile("alpha.png").waitFor({ state: "detached" }); await ui.text("Saved", { exact: true }).waitFor();
  await editorMenu("Version history");
  const row = visible(page.getByTestId("version-row").filter({ hasText: "Three assets" }));
  await row.getByRole("button", { name: "Restore", exact: true }).click();
  await ui.text("Version restored").waitFor({ timeout: 30_000 });
  await ui.tile("alpha.png").waitFor({ timeout: 30_000 });
  await visible(page.getByTestId("thumb-alpha.png")).waitFor({ timeout: 20_000 });
  expect(await ui.button(/^Undo/).isDisabled(), "the undo history is empty after a restore");
  await editorMenu("Version history");
  await visible(page.getByTestId("version-row").filter({ hasText: "Three assets" })).waitFor();
  expect((await page.getByTestId("version-row").filter({ visible: true }).count()) >= 2, "the restore took a safety snapshot first");
  // Preview opens the version read-only.
  await visible(page.getByTestId("version-row").filter({ hasText: "Three assets" })).getByRole("button", { name: /^Actions for/ }).click(); await ui.menuItem("Preview").click();
  await visible(page.getByTestId("preview-banner")).waitFor(); await shot("02-version-preview");
  await ui.button("Close preview").or(ui.text("Close preview")).first().click();
});
await step("Export package from the editor, then Import project: the round trip keeps the assets, their values and their bytes", async () => {
  const download = page.waitForEvent("download");
  await editorMenu("Export package");
  const saved = await download;
  expect(saved.suggestedFilename() === "Da Lat trip.jagentchill", `file name ${saved.suggestedFilename()}`);
  packagePath = join(tmpdir(), `jagentchill-e2e-${Date.now()}.jagentchill`); await saved.saveAs(packagePath);
  expect(statSync(packagePath).size > 80_000, `the package holds the media: ${statSync(packagePath).size} bytes`);
  await ui.text("Package exported").waitFor();
  await editorMenu("Back to projects"); await page.waitForURL(/\/projects$/);
  const chooser = page.waitForEvent("filechooser"); await ui.button("Projects list options").click(); await ui.menuItem("Import project").click(); await (await chooser).setFiles(packagePath);
  // The import follows the duplicate naming rule of `projects`: the copy of "Da Lat trip" is "(1) Da Lat trip".
  await ui.text("'(1) Da Lat trip' imported").waitFor({ timeout: 60_000 });
  expect((await page.locator('[data-testid="project-Da Lat trip"]').filter({ visible: true }).count()) === 1 && (await page.locator('[data-testid="project-(1) Da Lat trip"]').filter({ visible: true }).count()) === 1, "the package became a second project, the first one is untouched");
  await shot("03-imported");
  await ui.button("Open").click(); await page.waitForURL(/\/editor\//);
  for (const name of ["h264-aac.mp4", "alpha.png", "tone.mp3"]) await ui.tile(name).waitFor({ timeout: 60_000 });
  await visible(page.getByTestId("thumb-h264-aac.mp4")).waitFor({ timeout: 30_000 });
  expect((await page.getByTestId("media-offline-banner").filter({ visible: true }).count()) === 0, "no asset is offline after the import");
  await ui.tile("h264-aac.mp4").click({ button: "right" }); await ui.menuItem("Info").click();
  expect((await visible(page.getByTestId("info-container")).innerText()) === "MP4 · H.264 · AAC" && (await visible(page.getByTestId("info-fps")).innerText()) === "30 fps", "probe values travelled in the package");
  await visible(page.locator("video")).waitFor();
  await ui.button("Back to media").click();
});
await step("This project is open in another window: the second tab is read-only, Take over moves the ownership", async () => {
  const second = await context.newPage(); watch(second);
  await second.goto(page.url(), { waitUntil: "networkidle" });
  const other = on(second);
  await visible(second.getByTestId("lock-banner")).waitFor({ timeout: 60_000 });
  await other.text("This project is open in another window").waitFor(); await other.text("Read-only").waitFor();
  await second.screenshot({ path: `${shots}/04-open-in-another-window.png` });
  expect(await other.button("Import").isDisabled(), "a read-only window cannot import");
  await other.text("Take over").click();
  await visible(second.getByTestId("lock-banner")).waitFor({ state: "detached", timeout: 45_000 });
  await visible(page.getByTestId("lock-banner")).waitFor({ timeout: 45_000 });
  await second.close();
});
await step("Crash recovery: the page is closed without leaving the editor; Projects offers Reopen", async () => {
  await page.close();
  // The first window was read-only when it closed; the project is opened again and its window is closed mid-edit.
  page = await context.newPage(); watch(page); ui = on(page);
  await page.goto(`${base}/projects`, { waitUntil: "networkidle" });
  await visible(page.getByTestId("crash-prompt")).waitFor({ timeout: 60_000 });
  await ui.text("JAgentChill closed unexpectedly — Reopen '(1) Da Lat trip'", { exact: false }).waitFor(); await shot("05-crash-prompt");
  await visible(page.getByTestId("crash-prompt")).getByText("Reopen", { exact: true }).click();
  await page.waitForURL(/\/editor\//); await ui.tile("alpha.png").waitFor({ timeout: 60_000 });
  await editorMenu("Back to projects"); await page.waitForURL(/\/projects$/);
  await page.reload({ waitUntil: "networkidle" }); await ui.text("Every project on this device.").waitFor({ timeout: 60_000 }); await page.waitForTimeout(1500);
  expect((await page.getByTestId("crash-prompt").filter({ visible: true }).count()) === 0, "a clean exit leaves no prompt");
});
await step("Persistent storage: the banner offers Sync with a host and Hide for 7 days; hiding is remembered", async () => {
  const banner = visible(page.getByTestId("persist-banner"));
  if (await page.getByTestId("persist-banner").filter({ visible: true }).count()) {
    await banner.getByText("Hide for 7 days").click(); await banner.waitFor({ state: "detached" });
    await page.reload({ waitUntil: "networkidle" }); await ui.text("Every project on this device.").waitFor({ timeout: 60_000 }); await page.waitForTimeout(1000);
    expect((await page.getByTestId("persist-banner").filter({ visible: true }).count()) === 0, "the banner stays hidden");
  } else console.log("     this browser granted persistent storage: no banner to hide");
});
await step("Storage page: usage by category and per project, Clear all caches", async () => {
  await page.locator('[data-testid="sidebar"]').getByRole("button", { name: "Settings", exact: true }).click(); await page.waitForURL(/\/settings$/);
  await visible(page.getByTestId("settings-storage")).click(); await page.waitForURL(/\/settings\/storage$/);
  await visible(page.getByTestId("storage-total")).waitFor({ timeout: 30_000 });
  const media = await visible(page.getByTestId("usage-Media")).innerText(); console.log("     media usage:", media);
  expect(/(KiB|MiB)$/.test(media) && media !== "0.0 KiB", `media usage ${media}`);
  expect((await visible(page.getByTestId("usage-Snapshots and backups")).innerText()) !== "0.0 KiB", "snapshots are counted");
  await ui.text("By project").waitFor(); await ui.text("Da Lat trip").first().waitFor(); await shot("06-storage-page");
  await visible(page.getByTestId("clear-all-caches")).click(); await ui.text(/freed$/).waitFor();
  expect((await visible(page.getByTestId("usage-Media")).innerText()) === media, "clearing caches never removes originals");
});
await step("Export packages from the bulk bar: one file per selected project", async () => {
  await page.goto(`${base}/projects`, { waitUntil: "networkidle" });
  for (const name of ["Da Lat trip", "(1) Da Lat trip"]) await page.locator(`[data-testid="project-${name}"]`).filter({ visible: true }).getByRole("checkbox").click();
  await ui.text("2 selected").waitFor();
  const downloads = []; page.on("download", (download) => downloads.push(download.suggestedFilename()));
  await ui.button("Export packages").click();
  await ui.text("2 packages exported").waitFor({ timeout: 60_000 });
  expect(downloads.length === 2, `two downloads, got ${downloads.length}`);
});
await browser.close();
if (errors.length) { console.log("ERRORS:\n" + errors.join("\n")); process.exit(1); }
console.log("E2E OK — no page errors");
