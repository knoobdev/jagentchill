// End-to-end in a real browser on a production build, with no host and no model: the web app after its first load works
// with the network off, and a new deployment is announced and taken only on "Reload".
// Real storage (IndexedDB, OPFS and Cache Storage of a fresh browser profile); the clip is a real file made here with
// ffmpeg; the project is made through the UI. Nothing is seeded. The two builds are served by `scripts/serve-web.mjs`,
// started and stopped here: <build-1> first, then <build-2> on the same port as "the new deployment".
// Usage: node apps/app/e2e/offline.mjs <screenshot-dir> <build-1> <build-2> [port]
//   build-1: `node apps/app/scripts/export-web.mjs <dir>`; build-2: another finished export with a different build id.
import { execFileSync, spawn } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const shots = process.argv[2] ?? ".dev/shots/offline";
const builds = [resolve(process.argv[3] ?? ""), resolve(process.argv[4] ?? "")];
const port = Number(process.argv[5] ?? 8088);
const base = `http://localhost:${port}`;
const record = builds.map((dir) => JSON.parse(readFileSync(join(dir, "build.json"), "utf8")));
if (record[0].buildId === record[1].buildId) throw new Error("the two builds have the same id");
mkdirSync(shots, { recursive: true });
const dir = join(tmpdir(), `jagentchill-offline-e2e-${process.pid}`);
mkdirSync(dir, { recursive: true });
const clip = join(dir, "red.mp4");
execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=0xD02020:s=1280x720:r=30:d=30", "-c:v", "libx264", "-pix_fmt", "yuv420p", clip]);

let server = null;
const serve = async (root) => {
  if (server) { const gone = new Promise((done) => server.once("exit", done)); server.kill(); await gone; }
  server = spawn(process.execPath, [join(repo, "scripts/serve-web.mjs"), root, String(port)], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((done, fail) => { server.stdout.once("data", done); server.once("exit", () => fail(new Error("the web server did not start"))); });
};

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
let failed = 0;
const errors = [];
const expect = (condition, message) => { if (!condition) throw new Error(message); };
const until = async (read, check, what, tries = 200) => { let value; for (let index = 0; index < tries; index++) { value = await read(); if (check(value)) return value; await new Promise((done) => setTimeout(done, 150)); } throw new Error(`${what}: ${JSON.stringify(value?.notes ?? value)}`); };
const newContext = async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  // The save dialog of a headless browser: a real handle in the private file system, under `picked/`.
  await context.addInitScript(() => { window.showSaveFilePicker = async (options) => { const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle("picked", { create: true }); return folder.getFileHandle(options.suggestedName, { create: true }); }; });
  return context;
};
let page = null;
const visible = (locator) => locator.filter({ visible: true }).first();
const tid = (id) => visible(page.getByTestId(id));
const button = (name) => visible(page.getByRole("button", { name, exact: true }));
const shot = (name) => page.screenshot({ path: `${shots}/${name}.png` });
const step = async (name, run) => {
  try { await run(); console.log("ok  ", name); }
  catch (error) {
    failed++; console.log("FAIL", name, "—", String(error).split("\n").slice(0, 3).join(" "));
    await shot(`failure-${failed}`).catch(() => undefined);
    console.log("PAGE TEXT:", (await page.locator("body").innerText().catch(() => "")).replace(/\n+/g, " | ").slice(0, 400));
  }
};
/** What the worker keeps: the names of the caches of this origin and the paths stored in the shell caches. */
const kept = () => page.evaluate(async () => {
  const names = await caches.keys(), shell = {};
  for (const name of names.filter((entry) => entry.startsWith("jagentchill-shell-"))) shell[name] = (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname.slice(1));
  // The worker's own notes (which tab runs which build), for the message of a failed step.
  const notes = {}, tabs = await caches.open("jagentchill-tabs");
  for (const request of await tabs.keys()) { const path = new URL(request.url).pathname; if (!path.startsWith("/__files/")) notes[path] = await (await tabs.match(request)).text(); }
  return { names, shell: Object.fromEntries(Object.entries(shell).map(([name, list]) => [name, list])), notes, controlled: !!navigator.serviceWorker.controller };
});
const runningBuild = () => page.evaluate(async () => (await (await fetch("/build.json")).json()).buildId);
const previewColour = async () => {
  const box = await tid("canvas").boundingBox();
  const png = await page.screenshot({ clip: { x: Math.round(box.x + box.width / 2) - 4, y: Math.round(box.y + box.height / 2) - 4, width: 8, height: 8 } });
  return page.evaluate(async (data) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context2d = canvas.getContext("2d");
    context2d.drawImage(bitmap, 0, 0);
    const [r, g, b] = context2d.getImageData(4, 4, 1, 1).data;
    return r > 150 && b < 90 && g < 90 ? "red" : `${r},${g},${b}`;
  }, png.toString("base64"));
};
const coversLoaded = () => page.locator('[data-testid="template-card"][data-source="bundled"]').filter({ visible: true }).evaluateAll((nodes) => nodes.map((node) => { const image = node.querySelector('[data-testid="template-cover"] img'); return Boolean(image && image.complete && image.naturalWidth > 0); }));

let projectUrl = "";
try {
  await serve(builds[0]);

  // ————— A fresh profile with no network: there is nothing to show yet —————
  {
    const context = await newContext();
    page = await context.newPage();
    await step("a fresh profile offline gets the browser's own offline page, not the app", async () => {
      await context.setOffline(true);
      const error = await page.goto(`${base}/projects`, { timeout: 20_000 }).then(() => null, (reason) => String(reason));
      expect(error && /ERR_INTERNET_DISCONNECTED/.test(error), `the navigation fails offline: ${error}`);
    });
    await context.close();
  }

  // ————— A build without its record (a plain `expo export`, no finish step) —————
  {
    const plain = join(dir, "plain");
    cpSync(builds[0], plain, { recursive: true });
    for (const name of ["build.json", "sw.js", "licences.json"]) rmSync(join(plain, name));
    await serve(plain);
    const context = await newContext();
    page = await context.newPage();
    await step("A build without build.json: the page reaches network idle, registers no worker and shows the version only", async () => {
      await page.goto(`${base}/settings/about`, { waitUntil: "networkidle", timeout: 90_000 });
      expect((await tid("app-version").innerText()).trim() === record[0].version, "the version is shown");
      expect(await page.getByTestId("app-build").count() === 0 && await page.getByTestId("licences-toggle").count() === 0, "no build row and no licence list");
      expect((await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)) === 0, "no worker is registered");
      const answer = await page.evaluate(async () => (await fetch("/build.json")).status);
      expect(answer === 404, `a missing file is answered 404, not with the page: ${answer}`);
      await shot("00-build-without-record");
    });
    await context.close();
    await serve(builds[0]);
  }
  if (process.env.JC_ONLY === "plain") throw new Error("JC_ONLY=plain: stopping after the first steps");

  const context = await newContext();
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  const failedProbe = [];
  page.on("requestfailed", (request) => { if (request.url().includes("/engine/decode-1080p30.mp4")) failedProbe.push(`${request.headers().range ?? "no range"}: ${request.failure()?.errorText}`); });

  await step("first load online: the worker installs in the background and keeps every file of the build, and nothing else", async () => {
    await page.goto(`${base}/projects`, { waitUntil: "networkidle", timeout: 240_000 });
    const expected = JSON.parse(/const BUILD = (\{.*?\});/.exec(readFileSync(join(builds[0], "sw.js"), "utf8"))[1]).files.map(decodeURI).sort();
    const state = await until(kept, (value) => value.controlled && (value.shell[`jagentchill-shell-${record[0].buildId}`]?.length ?? 0) === expected.length, "the shell cache is complete and this page is controlled", 800);
    expect(JSON.stringify(state.shell[`jagentchill-shell-${record[0].buildId}`].map(decodeURI).sort()) === JSON.stringify(expected), "the cache holds exactly the files of the build");
    expect(expected.some((file) => file.endsWith(".wasm")) && expected.some((file) => file.endsWith(".ttf")) && expected.some((file) => /entry-[0-9a-f]+\.js$/.test(file)) && expected.includes("index.html"), "the build's script, wasm, fonts and page are in it");
    expect(await page.getByTestId("web-update-notice").count() === 0, "a first install is not announced as an update");
  });

  await step("a project is made online through the UI: a real clip on the main track, saved on this device", async () => {
    await button("Create your first project").click({ timeout: 90_000 });
    await page.waitForURL(/\/editor\/[0-9a-f-]{36}$/);
    projectUrl = new URL(page.url()).pathname;
    await tid("media-dropzone").waitFor({ timeout: 60_000 });
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), tid("media-dropzone").click()]);
    await chooser.setFiles([clip]);
    await tid("label-red.mp4").waitFor({ timeout: 90_000 });
    await tid("thumb-red.mp4").dblclick();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="track-main-video"] [data-testid^="clip-"]').length >= 1);
    await visible(page.getByTestId("save-state").getByText("Saved", { exact: true })).waitFor({ timeout: 30_000 });
  });

  await step("Settings ▸ About and Updates show the version, the build id and the build date of this build; the licence list has every package", async () => {
    await page.goto(`${base}/settings/about`, { waitUntil: "networkidle" });
    expect((await tid("app-version").innerText()).trim() === record[0].version, `version ${await tid("app-version").innerText()}`);
    expect((await tid("app-build").innerText()).trim() === record[0].buildId, `build ${await tid("app-build").innerText()}`);
    expect(/\d{4}/.test(await tid("app-build-date").innerText()), "the build date is shown");
    expect((await tid("app-platform").innerText()).trim() === "Web", "the platform is Web");
    const listed = JSON.parse(readFileSync(join(builds[0], "licences.json"), "utf8")).packages;
    await tid("licences-toggle").click();
    await tid("licences-list").waitFor();
    const text = await tid("licences-list").innerText();
    for (const entry of listed) expect(text.includes(`${entry.name} ${entry.version}`), `Licence list complete: ${entry.name} ${entry.version} is missing`);
    await shot("01-about-web");
    await page.goto(`${base}/settings/updates`, { waitUntil: "networkidle" });
    await visible(page.getByText("Up to date", { exact: true })).waitFor();
    expect(await page.getByTestId("web-reload-to-update").count() === 0 && await page.getByText("Check now").count() === 0, "no update control is offered when there is nothing to do");
    await shot("02-updates-web-current");
  });

  await step("Offline reopen: with the network off, a full reload renders the app and lists the project", async () => {
    await context.setOffline(true);
    requests.length = 0;
    await page.goto(`${base}/projects`, { waitUntil: "load", timeout: 60_000 });
    await visible(page.locator('[data-testid^="project-"]:not([data-testid="projects-skeleton"])')).waitFor({ timeout: 60_000 });
    expect(await page.evaluate(() => navigator.onLine) === false, "the browser is offline");
    await shot("03-offline-projects");
  });

  await step("Offline reopen: the local project opens after a full reload of its own URL, shows its picture and plays", async () => {
    // The engine's decode probe reads its clip the way a media reader does, with a Range request, from a worker.
    const probe = [];
    const onProbe = (response) => { if (new URL(response.url()).pathname === "/engine/decode-1080p30.mp4") probe.push({ status: response.status(), worker: response.fromServiceWorker(), tag: new URL(response.url()).searchParams.get("build"), asked: response.request().headers().range ?? null, range: response.headers()["content-range"] ?? null }); };
    page.on("response", onProbe);
    await page.goto(`${base}${projectUrl}`, { waitUntil: "load", timeout: 60_000 });
    for (const id of ["editor-bar", "asset-panel", "player", "timeline"]) await tid(id).waitFor({ timeout: 60_000 });
    const clipBytes = readFileSync(join(builds[0], "engine/decode-1080p30.mp4")).length;
    const read = await until(() => probe, (list) => list.some((entry) => entry.asked), "the decode probe asked for its clip with a Range request", 400).catch((error) => { throw new Error(`${error.message} — failed requests: ${failedProbe.join(", ") || "none"}`); });
    page.off("response", onProbe);
    expect(read.filter((entry) => entry.asked).every((entry) => entry.worker && entry.tag === record[0].buildId && (entry.status === 206 || entry.status === 200)), `the probe's clip offline: ${JSON.stringify(read)}`);
    expect(read.some((entry) => entry.status === 206 && new RegExp(`^bytes \\d+-\\d+/${clipBytes}$`).test(entry.range ?? "")), `a 206 with the right Content-Range (clip of ${clipBytes} bytes): ${JSON.stringify(read)}`);
    console.log(`     decode probe, offline: ${read.map((entry) => `${entry.asked} → ${entry.status} ${entry.range ?? ""}`).join("; ")}`);
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="track-main-video"] [data-testid^="clip-"]').length >= 1, null, { timeout: 60_000 });
    await until(previewColour, (colour) => colour === "red", "the preview shows the clip's picture", 100);
    const before = await tid("timecode").inputValue();
    await button("Play").click();
    await button("Pause").waitFor({ timeout: 10_000 });
    await page.waitForTimeout(1500);
    expect((await previewColour()) === "red", "the picture is the clip's while playing");
    await button("Pause").click();
    const after = await tid("timecode").inputValue();
    expect(after > before && after >= "00:00:01:00", `playback advanced the timecode offline (${before} → ${after})`);
    await shot("04-offline-editor-played");
  });

  await step("offline: Library ▸ Templates shows every bundled cover after a full reload", async () => {
    await page.goto(`${base}/library/templates`, { waitUntil: "load", timeout: 60_000 });
    const covers = await until(coversLoaded, (list) => list.length >= 12 && list.every(Boolean), "every bundled card has a loaded cover", 200);
    expect(covers.length === 12, `${covers.length} bundled cards`);
    await shot("05-offline-templates");
  });

  await step("offline: About still shows the build, and nothing but files of the build was ever put in a cache", async () => {
    await page.goto(`${base}/settings/about`, { waitUntil: "load", timeout: 60_000 });
    expect((await tid("app-build").innerText()).trim() === record[0].buildId, "the build record is read with the network off");
    const state = await kept();
    expect(state.names.every((name) => name.startsWith("jagentchill-shell-") || name.startsWith("jagentchill-templates-") || name === "jagentchill-tabs"), `caches: ${state.names}`);
    expect(Object.keys(state.shell).length === 1, "one build is kept");
  });

  // ————— A new deployment —————
  await step("New deployment: the open tab keeps the old build after a navigation, the new one is fetched in the background and announced — the page does not reload by itself", async () => {
    await context.setOffline(false);
    await serve(builds[1]);
    await page.goto(`${base}${projectUrl}`, { waitUntil: "load", timeout: 60_000 });
    await tid("timeline").waitFor({ timeout: 60_000 });
    expect((await runningBuild()) === record[0].buildId, "the navigation is answered by the build already kept");
    await page.evaluate(() => { window.__sameDocument = true; });
    await tid("web-update-notice").waitFor({ timeout: 240_000 });
    expect((await tid("web-update-notice").innerText()).includes("A new version is available"), `notice: ${await tid("web-update-notice").innerText()}`);
    await page.waitForTimeout(2000);
    expect(await page.evaluate(() => window.__sameDocument === true), "the page was not reloaded");
    expect((await runningBuild()) === record[0].buildId, "the old build keeps working until the person reloads");
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="track-main-video"] [data-testid^="clip-"]').length >= 1);
    await shot("06-new-version-notice");
  });

  await step("Reload is refused while an export runs: the page stays, a message says why", async () => {
    await tid("open-export").click();
    await tid("export-dialog").waitFor();
    await page.waitForTimeout(800);
    await tid("export-start").click();
    await tid("export-progress-view").waitFor({ timeout: 30_000 });
    // The dialog covers the notice and takes the rest of the page out of reach: its "Reload" is pressed through the DOM, which runs the same handler as a pointer press.
    await page.getByTestId("web-update-notice").getByText("Reload", { exact: true }).evaluate((node) => node.click());
    await visible(page.getByText("An export is running. Reload when it has finished.")).waitFor({ timeout: 5000 });
    expect(await page.evaluate(() => window.__sameDocument === true), "the page was not reloaded during the export");
    expect((await runningBuild()) === record[0].buildId, "the old build still runs");
    await shot("07-reload-refused-during-export");
    await Promise.race([tid("export-done").waitFor({ timeout: 240_000 }), tid("export-error").waitFor({ timeout: 240_000 })]);
    expect(await page.getByTestId("export-done").count() > 0, "the export finished");
  });

  await step("Settings ▸ Updates offers \"Reload to update\" while the new build waits", async () => {
    await page.goto(`${base}/settings/updates`, { waitUntil: "load" });
    await tid("web-reload-to-update").waitFor({ timeout: 60_000 });
    await shot("08-updates-web-reload-to-update");
  });

  await step("Edit, then Reload at once: the edit is saved first, the page reloads into the new build and the edit is there", async () => {
    await page.goto(`${base}${projectUrl}`, { waitUntil: "load", timeout: 60_000 });
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="track-main-video"] [data-testid^="clip-"]').length === 1, null, { timeout: 60_000 });
    await tid("web-update-notice").waitFor({ timeout: 60_000 });
    expect((await runningBuild()) === record[0].buildId, "the editor still runs the old build");
    await visible(page.getByTestId("save-state").getByText("Saved", { exact: true })).waitFor({ timeout: 30_000 });
    // An edit: a second clip on the track.
    await tid("thumb-red.mp4").dblclick();
    await visible(page.getByText("Used ×2", { exact: true })).waitFor({ timeout: 30_000 });
    await visible(page.getByTestId("save-state").getByText("Saved", { exact: true })).waitFor({ timeout: 30_000 });
    // Then a change that is written a moment later by itself (the zoom of the timeline), and "Reload" pressed in that
    // moment: the page has something unsaved when the button is pressed. (Asking the editor again and again whether it
    // is saved used to push this write away for ever, and Reload was refused.)
    await tid("tool-zoom-in").click();
    // The editor hands a view change to the save manager 300 ms after it, which writes it 300 ms later: in between, the page has unsaved work.
    await page.waitForTimeout(420);
    await Promise.all([page.waitForEvent("load", { timeout: 30_000 }), page.getByTestId("web-update-notice").getByText("Reload", { exact: true }).evaluate((node) => node.click())]);
    await until(runningBuild, (id) => id === record[1].buildId, "the new build runs after the reload");
    await visible(page.getByText("Used ×2", { exact: true })).waitFor({ timeout: 60_000 });
    expect(await page.getByTestId("web-update-notice").count() === 0, "the notice is gone");
    await shot("08b-reloaded-with-the-edit");
  });

  await step("After the reload: Settings ▸ Updates says Up to date, the old build is dropped and the project opens offline on the new one", async () => {
    await page.goto(`${base}/settings/updates`, { waitUntil: "load" });
    await until(runningBuild, (id) => id === record[1].buildId, "the new build runs");
    await until(kept, (state) => JSON.stringify(Object.keys(state.shell)) === JSON.stringify([`jagentchill-shell-${record[1].buildId}`]), "only the new build is kept");
    expect(await page.getByTestId("web-update-notice").count() === 0, "the notice is gone");
    await visible(page.getByText("Up to date", { exact: true })).waitFor();
    await context.setOffline(true);
    await page.goto(`${base}${projectUrl}`, { waitUntil: "load", timeout: 60_000 });
    await visible(page.getByText("Used ×2", { exact: true })).waitFor({ timeout: 60_000 });
    await shot("09-new-build-offline-project");
  });
} finally {
  await browser.close();
  if (server) server.kill();
  rmSync(dir, { recursive: true });
}
if (errors.length) console.log("PAGE ERRORS:\n" + [...new Set(errors)].slice(0, 10).join("\n"));
console.log(failed ? `${failed} step(s) failed` : "all steps passed");
process.exit(failed || errors.length ? 1 : 0);
