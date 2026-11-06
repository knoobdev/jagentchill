// The origin's host is a stand-in made here (see offline-worker.mjs): it serves the files of the two builds.
// End-to-end in a real browser on a production build: a worker belongs to the build of the page that started it. Two
// tabs of one browser profile run two builds of the app and export at the same time; every file an export worker
// loads — its script and its wasm — must be its own build's, whichever asks first, and an export in the old tab must
// finish with a file that plays while the other tab runs the new build. A worker without an address of its own (a blob)
// that is handed its build keeps it, right after another tab loaded the new build and after that tab closed.
// "Build 2" is a copy of <build-1> made here: one line added to `index.html` and to `engine/export-worker.js`, a custom
// section (which changes nothing in the module) added to the wasm; finished with `scripts/finish-web-export.mjs`.
// The clip is a real file made here with ffmpeg; the project is made through the UI; the exports are real.
// JC_NO_RESULTING_CLIENT=1: the service worker is served with one line in front that hides `resultingClientId`, the
// way a browser without it behaves (the condition of review r3 finding 2).
// Usage: node apps/app/e2e/offline-builds.mjs <screenshot-dir> <build-1> [port]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const shots = process.argv[2] ?? ".dev/shots/offline-builds";
const first = resolve(process.argv[3] ?? "");
const port = Number(process.argv[4] ?? 8088);
const base = `http://localhost:${port}`;
const hideResultingClient = process.env.JC_NO_RESULTING_CLIENT === "1";
mkdirSync(shots, { recursive: true });
const temp = mkdtempSync(join(tmpdir(), "jagentchill-offline-builds-"));
const second = join(temp, "build-2");
const sha = (data) => createHash("sha256").update(data).digest("hex");
const WORKER = "/engine/export-worker.js", WASM = "/wasm/opencut_wasm_bg.wasm";

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".svg": "image/svg+xml", ".wasm": "application/wasm", ".ttf": "font/ttf", ".woff2": "font/woff2", ".mp4": "video/mp4" };
let root = first;
let releaseWorker = () => undefined;
const workerReleased = new Promise((done) => { releaseWorker = done; });
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
  const target = extname(path) ? join(root, path) : join(root, "index.html");
  let body = await readFile(target).catch(() => null);
  if (!body) return void res.writeHead(404, { "content-type": "text/plain", "cache-control": "no-store" }).end("Not found");
  // The first visit: the worker's script is held back until the test lets it through, so that the editor and its
  // engine are certainly started on a page no worker answers yet.
  if (path === "/sw.js") await workerReleased;
  if (path === "/sw.js" && hideResultingClient) body = Buffer.concat([Buffer.from('Object.defineProperty(FetchEvent.prototype, "resultingClientId", { get: () => "" });\n'), body]);
  res.writeHead(200, { "content-type": TYPES[extname(target)] ?? "application/octet-stream", "cache-control": "no-store" }).end(body);
});

let browser = null, failed = 0;
const errors = [];
const expect = (condition, message) => { if (!condition) throw new Error(message); };
const until = async (read, check, what, tries = 200) => { let value; for (let index = 0; index < tries; index++) { value = await read(); if (check(value)) return value; await new Promise((done) => setTimeout(done, 150)); } throw new Error(`${what}: ${JSON.stringify(value)}`); };
let shown = null;
const step = async (name, run) => {
  try { await run(); console.log("ok  ", name); }
  catch (error) { failed++; console.log("FAIL", name, "—", String(error).split("\n").slice(0, 3).join(" ")); await shown?.screenshot({ path: `${shots}/builds-failure-${failed}.png` }).catch(() => undefined); }
};
const tid = (page, id) => page.getByTestId(id).filter({ visible: true }).first();
const buildOf = (page) => page.evaluate(() => document.querySelector('meta[name="jagentchill-build"]')?.getAttribute("content") ?? null);

try {
  await new Promise((done, refused) => { server.once("error", refused); server.listen(port, "127.0.0.1", done); });
  browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const clip = join(temp, "red.mp4");
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=0xD02020:s=1280x720:r=30:d=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", clip]);
  const one = JSON.parse(readFileSync(join(first, "build.json"), "utf8"));
  cpSync(first, second, { recursive: true });
  appendFileSync(join(second, "index.html"), "\n<!-- build 2 of the builds test -->\n");
  appendFileSync(join(second, "engine/export-worker.js"), "\n// build 2 of the builds test\n");
  // A custom section named "b2": a valid module with the same code and other bytes.
  appendFileSync(join(second, "wasm/opencut_wasm_bg.wasm"), Buffer.from([0x00, 0x03, 0x02, 0x62, 0x32]));
  execFileSync(process.execPath, [join(repo, "apps/app/scripts/finish-web-export.mjs"), second], { stdio: "ignore" });
  const two = JSON.parse(readFileSync(join(second, "build.json"), "utf8"));
  const digests = Object.fromEntries([[one.buildId, first], [two.buildId, second]].map(([id, dir]) => [id, { [WORKER]: sha(readFileSync(join(dir, WORKER))), [WASM]: sha(readFileSync(join(dir, WASM))) }]));
  const nameOf = (path, digest) => Object.entries(digests).find(([, files]) => files[path] === digest)?.[0] ?? `unknown (${String(digest).slice(0, 8)})`;

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  // The save dialog of a headless browser: a real handle in the private file system, under `picked/`.
  // Each tab keeps the names of the files IT saved (`__saves`): the folder is shared by every tab of the profile.
  await context.addInitScript(() => {
    const tab = Math.random().toString(16).slice(2, 10);
    window.__saves = [];
    window.showSaveFilePicker = async (options) => {
      const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle("picked", { create: true });
      const name = `${Date.now()}-${tab}-${options.suggestedName}`;
      window.__saves.push(name);
      return folder.getFileHandle(name, { create: true });
    };
  });
  /** Every answer for the worker script and the wasm that reached a tab or a worker of it: which build's bytes it was. */
  const watch = (page, label) => {
    const seen = [];
    page.on("pageerror", (error) => errors.push(`${label} pageerror: ${error.message}`));
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.pathname !== WORKER && url.pathname !== WASM) return;
      const entry = { path: url.pathname, tag: url.searchParams.get("build"), build: "…" };
      seen.push(entry);
      response.body().then((body) => { entry.build = nameOf(url.pathname, sha(body)); }, (error) => { entry.build = `unread (${String(error).slice(0, 60)})`; });
    });
    return seen;
  };
  const old = await context.newPage(), seenOld = watch(old, "old tab");
  shown = old;
  let projectUrl = "", fresh = null, seenFresh = null;

  await step("the old tab loads build 1 for the first time (no worker answers it yet) and makes a project with a real clip; it is never reloaded", async () => {
    await old.goto(`${base}/projects`, { waitUntil: "load", timeout: 240_000 });
    await old.getByRole("button", { name: "Create your first project", exact: true }).filter({ visible: true }).first().click({ timeout: 90_000 });
    await old.waitForURL(/\/editor\/[0-9a-f-]{36}$/);
    projectUrl = new URL(old.url()).pathname;
    await tid(old, "media-dropzone").waitFor({ timeout: 60_000 });
    const [chooser] = await Promise.all([old.waitForEvent("filechooser"), tid(old, "media-dropzone").click()]);
    await chooser.setFiles([clip]);
    await tid(old, "label-red.mp4").waitFor({ timeout: 90_000 });
    await tid(old, "thumb-red.mp4").dblclick();
    await old.waitForFunction(() => document.querySelectorAll('[data-testid="track-main-video"] [data-testid^="clip-"]').length >= 1, null, { timeout: 30_000 });
    await old.getByTestId("save-state").getByText("Saved", { exact: true }).filter({ visible: true }).first().waitFor({ timeout: 30_000 });
    // The engine of this tab was started on the first visit, before any worker answered the page: it is the one that
    // exports below. Only now the worker is let in; it installs, takes the page over, and the page is never reloaded.
    expect(await old.evaluate(async () => !navigator.serviceWorker.controller && !(await caches.keys()).some((name) => name.startsWith("jagentchill-shell-"))), "no worker answers the page while the editor and its engine start");
    expect(seenOld.some((entry) => entry.path === WASM), "the engine has loaded its wasm");
    await old.evaluate(() => { window.__firstVisit = true; });
    releaseWorker();
    await until(() => old.evaluate(async () => !!navigator.serviceWorker.controller && (await caches.keys()).some((name) => name.startsWith("jagentchill-shell-"))), Boolean, "the worker controls the page", 1600);
    expect((await buildOf(old)) === one.buildId, `the page names its build: ${await buildOf(old)}`);
  });

  await step("build 2 is deployed; a second tab takes it with \"Reload to update\" and opens the same project — the old tab is not reloaded", async () => {
    root = second;
    await old.evaluate(() => { window.__sameDocument = true; });
    fresh = await context.newPage();
    seenFresh = watch(fresh, "new tab");
    await fresh.goto(`${base}/settings/updates`, { waitUntil: "load", timeout: 60_000 });
    const reload = tid(fresh, "web-reload-to-update");
    await reload.waitFor({ timeout: 240_000 });
    await Promise.all([fresh.waitForEvent("load", { timeout: 60_000 }), reload.click()]);
    await until(() => buildOf(fresh), (id) => id === two.buildId, "the new tab runs build 2");
    await fresh.goto(`${base}${projectUrl}`, { waitUntil: "load", timeout: 60_000 });
    await tid(fresh, "timeline").waitFor({ timeout: 60_000 });
    expect((await buildOf(fresh)) === two.buildId && (await buildOf(old)) === one.buildId, "two tabs, two builds");
    expect(await old.evaluate(() => window.__sameDocument === true && window.__firstVisit === true), "the old tab is still the document of its first visit");
  });

  /** Starts an export in both tabs, `leader` first, and waits for both to end. Returns what each tab was answered with since. */
  const exportBoth = async (leader, follower) => {
    const marks = [seenOld.length, seenFresh.length];
    for (const page of [old, fresh]) { await tid(page, "open-export").click(); await tid(page, "export-dialog").waitFor({ timeout: 30_000 }); await tid(page, "export-start").waitFor({ timeout: 30_000 }); }
    await old.waitForTimeout(800);
    // One press after the other with nothing awaited in between but the press itself.
    await Promise.all([tid(leader, "export-start").click(), tid(follower, "export-start").click()]);
    for (const page of [old, fresh]) {
      await Promise.race([tid(page, "export-done").waitFor({ timeout: 300_000 }), tid(page, "export-error").waitFor({ timeout: 300_000 })]);
      expect(await page.getByTestId("export-done").count() > 0, `the export of the ${page === old ? "old" : "new"} tab finished: ${(await page.getByTestId("export-error").allInnerTexts()).join(" ")}`);
    }
    await old.waitForTimeout(500);
    return { old: seenOld.slice(marks[0]), fresh: seenFresh.slice(marks[1]) };
  };
  const own = (answers, build, who) => {
    for (const path of [WORKER, WASM]) {
      const mine = answers.filter((entry) => entry.path === path);
      expect(mine.length > 0, `${who}: the export asked for ${path}`);
      expect(mine.every((entry) => entry.tag === build), `${who}: ${path} was asked for ${mine.map((entry) => (entry.tag ? `as ${entry.tag}` : "without its build")).join(", ")}`);
      expect(mine.every((entry) => entry.build === build), `${who}: ${path} came from ${mine.map((entry) => `${entry.build}${entry.tag ? ` (asked as ${entry.tag})` : " (no build asked)"}`).join(", ")} — its own build is ${build}`);
    }
  };
  const closeExports = async () => { for (const page of [old, fresh]) { await tid(page, "export-close").click().catch(() => page.keyboard.press("Escape")); await page.getByTestId("export-dialog").waitFor({ state: "hidden", timeout: 15_000 }); } };

  await step("(a) Exports at the same time, the old tab first: each export worker's script and wasm are its own build's", async () => {
    shown = old;
    const answers = await exportBoth(old, fresh);
    own(answers.old, one.buildId, "old tab");
    own(answers.fresh, two.buildId, "new tab");
    await old.screenshot({ path: `${shots}/b1-old-tab-export-done.png` });
  });

  await step("(c) The export of the old tab ran to the end while a tab on the new build was open: its file plays", async () => {
    const played = await old.evaluate(async () => {
      const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle("picked");
      const names = [];
      for await (const name of folder.keys()) names.push(name);
      // Exactly the file this tab saved — the newest file of the folder may be the other tab's.
      const mine = window.__saves.at(-1);
      const file = await (await folder.getFileHandle(mine)).getFile();
      const newest = names.sort().at(-1);
      const video = document.createElement("video");
      video.muted = true; video.src = URL.createObjectURL(file);
      await new Promise((ready, broken) => { video.onloadedmetadata = ready; video.onerror = () => broken(new Error(`the file does not open: ${video.error?.message}`)); });
      await video.play();
      await new Promise((later) => setTimeout(later, 1500));
      const canvas = new OffscreenCanvas(16, 16), context2d = canvas.getContext("2d");
      context2d.drawImage(video, 0, 0, 16, 16);
      const [r, g, b] = context2d.getImageData(8, 8, 1, 1).data;
      return { name: file.name, newest, saves: window.__saves.length, inFolder: names.length, bytes: file.size, duration: video.duration, time: video.currentTime, width: video.videoWidth, colour: [r, g, b] };
    });
    expect(played.saves === 1 && played.inFolder === 2, `the old tab saved one file and the folder holds both tabs' files: ${JSON.stringify(played)}`);
    expect((await fresh.evaluate(() => window.__saves)).every((name) => name !== played.name), "the played file is not the new tab's");
    expect(played.bytes > 10_000 && played.duration > 3.5 && played.duration < 4.6 && played.time > 0.5 && played.width > 0, `the exported file plays: ${JSON.stringify(played)}`);
    expect(played.colour[0] > 150 && played.colour[1] < 90 && played.colour[2] < 90, `its picture is the clip's: ${played.colour}`);
    expect((await buildOf(old)) === one.buildId && await old.evaluate(() => window.__sameDocument === true), "the old tab still runs build 1, not reloaded");
    console.log(`     ${played.name}: ${played.bytes} bytes, ${played.duration.toFixed(2)} s, played to ${played.time.toFixed(2)} s — the newest file of the folder is ${played.newest === played.name ? "this one" : "the OTHER tab's (" + played.newest + ")"}`);
  });

  await step("(a) Exports at the same time, the new tab first: each export worker's script and wasm are its own build's", async () => {
    await closeExports();
    const answers = await exportBoth(fresh, old);
    own(answers.old, one.buildId, "old tab");
    own(answers.fresh, two.buildId, "new tab");
  });

  await step("(a) Two export workers started at once, their wasm asked for in the opposite order: each still gets its own build's script and wasm", async () => {
    // The app's own worker script, started the way the app starts it (its build on its address); the test then makes
    // each worker ask for its wasm, the one that was started last asking first.
    const start = async (page, build) => (await Promise.all([page.waitForEvent("worker", { timeout: 30_000 }), page.evaluate((id) => { window.__engine = new Worker(`/engine/export-worker.js?build=${id}`, { type: "module", name: "jagentchill-export" }); }, build)]))[0];
    const marks = [seenOld.length, seenFresh.length];
    const [workerOld, workerFresh] = await Promise.all([start(old, one.buildId), start(fresh, two.buildId)]);
    const wasmOf = (worker, build) => worker.evaluate(async (id) => { const bytes = await (await fetch(`/wasm/opencut_wasm_bg.wasm?build=${id}`)).arrayBuffer(); return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }, build);
    const gotFresh = await wasmOf(workerFresh, two.buildId);
    const gotOld = await wasmOf(workerOld, one.buildId);
    expect(nameOf(WASM, gotOld) === one.buildId, `the old tab's worker got the wasm of ${nameOf(WASM, gotOld)}`);
    expect(nameOf(WASM, gotFresh) === two.buildId, `the new tab's worker got the wasm of ${nameOf(WASM, gotFresh)}`);
    await old.waitForTimeout(500);
    const scripts = [seenOld.slice(marks[0]), seenFresh.slice(marks[1])].map((list) => list.filter((entry) => entry.path === WORKER).map((entry) => entry.build));
    expect(scripts[0].length > 0 && scripts[0].every((build) => build === one.buildId) && scripts[1].length > 0 && scripts[1].every((build) => build === two.buildId), `worker scripts: old tab ${scripts[0]}, new tab ${scripts[1]}`);
    await old.evaluate(() => window.__engine.terminate());
    await fresh.evaluate(() => window.__engine.terminate());
  });

  await step("(b) A blob worker of the old tab, handed its build, gets build 1's files right after another tab loaded the new build — and still after that tab closed", async () => {
    const third = await context.newPage();
    await third.goto(`${base}/settings/about`, { waitUntil: "commit", timeout: 60_000 });
    // No pause: the other tab's page was answered a moment ago.
    await old.evaluate((build) => {
      const origin = JSON.stringify(location.origin);
      const source = `const digest = async (bytes) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
        onmessage = async (event) => { try {
          if (event.data !== "go") { const answer = await fetch(${origin} + event.data); postMessage({ status: answer.status, text: answer.status === 200 ? "" : (await answer.text()).slice(0, 200), digest: answer.status === 200 ? await digest(await answer.arrayBuffer()) : "" }); return; }
          const record = await (await fetch(${origin} + "/build.json?build=${build}")).json();
          postMessage({ record: record.buildId, digest: await digest(await (await fetch(${origin} + "/wasm/opencut_wasm_bg.wasm?build=${build}")).arrayBuffer()) });
        } catch (error) { postMessage({ error: String(error) }); } };`;
      window.__blob = new Worker(URL.createObjectURL(new Blob([source], { type: "text/javascript" })));
      window.__ask = (what = "go") => new Promise((done) => { window.__blob.onmessage = (event) => done(event.data); window.__blob.postMessage(what); });
    }, one.buildId);
    const during = await old.evaluate(() => window.__ask());
    expect(during.record === one.buildId && during.digest === digests[one.buildId][WASM], `right after the other tab loaded: ${JSON.stringify(during).slice(0, 160)} (${nameOf(WASM, during.digest)})`);
    // The same worker asking for the wasm WITHOUT its build, while two builds are open: refused — not the server's current file.
    const unnamed = await old.evaluate(() => window.__ask("/wasm/opencut_wasm_bg.wasm"));
    expect(unnamed.status === 409 && /must name the build/.test(unnamed.text), `a worker dependency asked without its build: ${JSON.stringify(unnamed).slice(0, 200)}${unnamed.digest ? ` (${nameOf(WASM, unnamed.digest)}'s bytes)` : ""}`);
    await third.close();
    await fresh.close();
    const after = await old.evaluate(() => window.__ask());
    expect(after.record === one.buildId && after.digest === digests[one.buildId][WASM], `after the other tabs closed: ${JSON.stringify(after).slice(0, 160)} (${nameOf(WASM, after.digest)})`);
    await new Promise((done) => setTimeout(done, 5000));
    const later = await old.evaluate(() => window.__ask());
    expect(later.record === one.buildId && later.digest === digests[one.buildId][WASM], `a while after: ${JSON.stringify(later).slice(0, 160)}`);
    // A file of the build asked for by a build that is not kept is refused, not answered from another build.
    const foreign = await old.evaluate(async () => { try { return (await fetch("/wasm/opencut_wasm_bg.wasm?build=000000000000")).status; } catch (error) { return error.name; } });
    expect(foreign === 409, `a build that is not kept: ${foreign}`);
  });

  await step("A build whose kept files are gone: its file is refused while the server has another build, and fetched and kept again when the server has that build", async () => {
    const late = await context.newPage();
    shown = late;
    await late.goto(`${base}/settings/about`, { waitUntil: "load", timeout: 60_000 });
    expect((await buildOf(late)) === two.buildId, "a new tab runs build 2, the active one");
    const ask = () => late.evaluate(async (build) => {
      const answer = await fetch(`/wasm/opencut_wasm_bg.wasm?build=${build}`);
      const bytes = await answer.arrayBuffer();
      return { status: answer.status, text: answer.status === 200 ? "" : new TextDecoder().decode(bytes).slice(0, 200), digest: answer.status === 200 ? [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("") : "" };
    }, two.buildId);
    // The browser dropped the build's files (storage pressure), and the server meanwhile has ANOTHER deployment (here: build 1 again).
    await late.evaluate((name) => caches.delete(name), `jagentchill-shell-${two.buildId}`);
    root = first;
    const refused = await ask();
    expect(refused.status === 409 && refused.text.includes(two.buildId) && refused.text.includes(one.buildId), `with another deployment on the server: ${JSON.stringify(refused).slice(0, 260)}${refused.digest ? ` (${nameOf(WASM, refused.digest)}'s bytes)` : ""}`);
    // The server has build 2: the file is build 2's, and it is kept again.
    root = second;
    const again = await ask();
    expect(again.status === 200 && nameOf(WASM, again.digest) === two.buildId, `with the same build on the server: ${JSON.stringify(again).slice(0, 200)}`);
    expect(await late.evaluate(async (name) => !!(await (await caches.open(name)).match("/wasm/opencut_wasm_bg.wasm")), `jagentchill-shell-${two.buildId}`), "the file is kept again");
  });
} finally {
  releaseWorker();
  await browser?.close().catch(() => undefined);
  server.closeAllConnections?.();
  if (server.listening) server.close();
  rmSync(temp, { recursive: true });
}
if (errors.length) console.log("PAGE ERRORS:\n" + [...new Set(errors)].slice(0, 10).join("\n"));
console.log(failed ? `${failed} step(s) failed` : "all steps passed");
process.exit(failed || errors.length ? 1 : 0);
