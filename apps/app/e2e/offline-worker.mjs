// The origin's host is a stand-in made here (it cannot be the real server: that one does not serve the app's files): it
// serves the build's files like `scripts/serve-web.mjs` and answers `/jagentchill/…` with its own JSON and bytes.
// End-to-end in a real browser on a production build: what the service worker must NOT do. It never answers a path of
// the host (online: the host's answer; offline: a network error, never the app's page), and after a new build is taken
// in one tab, another tab that was not reloaded keeps getting the files of the build it was loaded with.
// "Build 2" is a copy of <build-1> made here with one line added to `index.html` and to `engine/export-worker.js`, then
// finished with `scripts/finish-web-export.mjs`; it is removed at the end. Real Cache Storage of a fresh profile.
// Usage: node apps/app/e2e/offline-worker.mjs <screenshot-dir> <build-1> [port]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
// (`rmSync` below also takes one un-hashed file out of build 2: a file the new build no longer has.)
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const shots = process.argv[2] ?? ".dev/shots/offline-worker";
const first = resolve(process.argv[3] ?? "");
const port = Number(process.argv[4] ?? 8088);
const base = `http://localhost:${port}`;
mkdirSync(shots, { recursive: true });
const temp = mkdtempSync(join(tmpdir(), "jagentchill-offline-worker-"));
const second = join(temp, "build-2");
const sha = (data) => createHash("sha256").update(data).digest("hex");

const HEALTH = JSON.stringify({ ok: true, from: "the host of this test" });
const MEDIA = Buffer.from("media bytes of the host of this test");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".svg": "image/svg+xml", ".wasm": "application/wasm", ".ttf": "font/ttf", ".woff2": "font/woff2", ".mp4": "video/mp4" };
let root = first;
const hostHits = [];
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (path.startsWith("/jagentchill/")) {
    hostHits.push(path);
    if (path === "/jagentchill/v1/health") return void res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(HEALTH);
    if (path.startsWith("/jagentchill/v1/media/")) return void res.writeHead(200, { "content-type": "video/mp4", "cache-control": "no-store" }).end(MEDIA);
    return void res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: { code: "not_found" } }));
  }
  // The file is read before anything is written; a missing file is 404, a path without an extension is the page.
  const target = extname(path) ? join(root, path) : join(root, "index.html");
  const body = await readFile(target).catch(() => null);
  if (!body) return void res.writeHead(404, { "content-type": "text/plain", "cache-control": "no-store" }).end("Not found");
  res.writeHead(200, { "content-type": TYPES[extname(target)] ?? "application/octet-stream", "cache-control": "no-store" }).end(body);
});
let browser = null;
let failed = 0;
const errors = [];
const expect = (condition, message) => { if (!condition) throw new Error(message); };
const until = async (read, check, what, tries = 200) => { let value; for (let index = 0; index < tries; index++) { value = await read(); if (check(value)) return value; await new Promise((done) => setTimeout(done, 150)); } throw new Error(`${what}: ${JSON.stringify(value)}`); };
let page = null;
const step = async (name, run) => {
  try { await run(); console.log("ok  ", name); }
  catch (error) {
    failed++; console.log("FAIL", name, "—", String(error).split("\n").slice(0, 3).join(" "));
    await page.screenshot({ path: `${shots}/worker-failure-${failed}.png` }).catch(() => undefined);
  }
};
const kept = (target) => target.evaluate(async () => ({ shell: (await caches.keys()).filter((name) => name.startsWith("jagentchill-shell-")), controlled: !!navigator.serviceWorker.controller }));
const buildOf = (target) => target.evaluate(async () => (await (await fetch("/build.json")).json()).buildId);
const digestOf = (target, path) => target.evaluate(async (url) => {
  const bytes = await (await fetch(url)).arrayBuffer();
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}, path);
/** A navigation in a tab of its own: what answered it. */
const navigate = async (context, path) => {
  const tab = await context.newPage();
  try {
    const response = await tab.goto(`${base}${path}`, { waitUntil: "commit", timeout: 30_000 });
    return { type: response.headers()["content-type"] ?? "", body: await response.text(), worker: response.fromServiceWorker() };
  } catch (error) { return { error: String(error).split("\n")[0] }; }
  finally { await tab.close(); }
};
const fetched = (path) => page.evaluate(async (url) => {
  try { const response = await fetch(url); return { type: response.headers.get("content-type") ?? "", body: await response.text() }; }
  catch (error) { return { error: `${error.name}: ${error.message}` }; }
}, path);

try {
  // Everything that can fail after the temporary folder was made is inside this block, so the folder never stays.
  await new Promise((done, refused) => { server.once("error", refused); server.listen(port, "127.0.0.1", done); });
  browser = await chromium.launch();
  const one = JSON.parse(readFileSync(join(first, "build.json"), "utf8"));
  cpSync(first, second, { recursive: true });
  appendFileSync(join(second, "index.html"), "\n<!-- build 2 of the worker test -->\n");
  appendFileSync(join(second, "engine/export-worker.js"), "\n// build 2 of the worker test\n");
  const removed = sha(readFileSync(join(first, "fx/sample.png")));
  rmSync(join(second, "fx/sample.png"));
  execFileSync(process.execPath, [join(repo, "apps/app/scripts/finish-web-export.mjs"), second], { stdio: "ignore" });
  const two = JSON.parse(readFileSync(join(second, "build.json"), "utf8"));
  expect(one.buildId !== two.buildId, "the two builds differ");
  const exportWorker = [sha(readFileSync(join(first, "engine/export-worker.js"))), sha(readFileSync(join(second, "engine/export-worker.js")))];

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));

  await step("first load: the worker controls the page and keeps build 1", async () => {
    await page.goto(`${base}/projects`, { waitUntil: "networkidle", timeout: 240_000 });
    await until(() => kept(page), (state) => state.controlled && state.shell.length === 1, "controlled, one build kept", 800);
    // The install has finished when a navigation to an app route is answered by the worker.
    await until(() => navigate(context, "/settings/about"), (answer) => answer.worker === true, "the worker answers app routes", 400);
  });

  await step("Host path, online: a navigation and a fetch to /jagentchill/v1/health get the host's answer, not the app's page; the worker does not handle them", async () => {
    const page1 = await navigate(context, "/jagentchill/v1/health");
    expect(page1.type.includes("application/json") && page1.body === HEALTH, `navigation answered with ${page1.type}: ${String(page1.body ?? page1.error).slice(0, 80)}`);
    expect(page1.worker === false, "the navigation did not go through the worker");
    const call = await fetched("/jagentchill/v1/health");
    expect(call.type.includes("application/json") && call.body === HEALTH, `fetch answered with ${call.type}`);
    // A media path of the host whose name looks like a content-hashed file of a build.
    const mediaPath = "/jagentchill/v1/media/0123456789abcdef0123456789abcdef.mp4";
    const [answer, media] = await Promise.all([page.waitForResponse((response) => new URL(response.url()).pathname === mediaPath, { timeout: 20_000 }), fetched(mediaPath)]);
    expect(answer.fromServiceWorker() === false && media.type === "video/mp4" && media.body === MEDIA.toString(), `host media: ${JSON.stringify(media).slice(0, 120)}`);
    const sub = await navigate(context, "/jagentchill/app");
    expect(sub.worker === false && sub.type.includes("application/json"), `an extensionless host path: ${JSON.stringify(sub).slice(0, 120)}`);
    // A path that is no screen of the app is the origin's to answer; an app route is the worker's.
    const stray = await navigate(context, "/some-other-service/status");
    expect(stray.worker === false, "a path outside the app's routes is not answered by the worker");
    const route = await navigate(context, "/settings/about");
    expect(route.worker === true && route.type.includes("text/html"), "an app route is answered by the worker with the page");
    const start = await navigate(context, "/");
    expect(start.worker === true, "the start page is answered by the worker");
  });

  await step("Host path, offline: the navigation and the fetch fail as network errors, never as HTML; an app route still opens", async () => {
    await context.setOffline(true);
    const before = hostHits.length;
    const gone = await navigate(context, "/jagentchill/v1/health");
    expect(gone.error && /ERR_INTERNET_DISCONNECTED/.test(gone.error), `offline navigation to the host: ${JSON.stringify(gone).slice(0, 160)}`);
    const call = await fetched("/jagentchill/v1/health");
    expect(call.error && /TypeError/.test(call.error), `offline fetch to the host: ${JSON.stringify(call).slice(0, 160)}`);
    const stray = await navigate(context, "/some-other-service/status");
    expect(stray.error && /ERR_INTERNET_DISCONNECTED/.test(stray.error), `offline navigation outside the app: ${JSON.stringify(stray).slice(0, 160)}`);
    expect(hostHits.length === before, "nothing reached the host");
    await page.goto(`${base}/settings/about`, { waitUntil: "load", timeout: 60_000 });
    expect((await page.getByTestId("app-build").filter({ visible: true }).first().innerText()).trim() === one.buildId, "the app opens offline on build 1");
    await page.screenshot({ path: `${shots}/w1-offline-app-route.png` });
    await context.setOffline(false);
  });

  // ————— two tabs and a new build —————
  let other = null, probe = null;
  await step("Two tabs: build 2 is deployed and announced in tab A; tab B takes it with \"Reload to update\"", async () => {
    root = second;
    await page.goto(`${base}/settings/about`, { waitUntil: "load", timeout: 60_000 });
    await page.evaluate(() => { window.__sameDocument = true; });
    await page.getByTestId("web-update-notice").filter({ visible: true }).first().waitFor({ timeout: 240_000 });
    expect((await buildOf(page)) === one.buildId && (await digestOf(page, "/engine/export-worker.js")) === exportWorker[0], "tab A runs build 1");
    other = await context.newPage();
    await other.goto(`${base}/settings/updates`, { waitUntil: "load", timeout: 60_000 });
    const reload = other.getByTestId("web-reload-to-update").filter({ visible: true }).first();
    await reload.waitFor({ timeout: 60_000 });
    await Promise.all([other.waitForEvent("load", { timeout: 60_000 }), reload.click()]);
    await until(() => buildOf(other), (id) => id === two.buildId, "tab B runs build 2");
    expect((await digestOf(other, "/engine/export-worker.js")) === exportWorker[1], "tab B gets build 2's export worker");
  });

  await step("Two tabs: tab A was not reloaded and still gets build 1's files — /build.json and /engine/export-worker.js — from the new worker", async () => {
    expect(await page.evaluate(() => window.__sameDocument === true), "tab A was not reloaded");
    await until(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting == null), Boolean, "the new worker is the active one");
    expect((await buildOf(page)) === one.buildId, `tab A is answered with build ${await buildOf(page)}'s record`);
    expect((await digestOf(page, "/engine/export-worker.js")) === exportWorker[0], "tab A gets the export worker of the build it was loaded with");
    expect((await kept(page)).shell.length === 2, "both builds are kept while tab A is open");
    // A file build 2 no longer has: tab A's build has it, so tab A gets it; tab B's build does not, so the origin answers.
    expect((await digestOf(page, "/fx/sample.png")) === removed, "tab A gets the un-hashed file that build 2 removed, from build 1");
    expect((await digestOf(other, "/fx/sample.png")) !== removed, "tab B is not given a file of a build it does not run");
    await page.screenshot({ path: `${shots}/w2-tab-a-keeps-build-1.png` });
  });

  await step("Two tabs: a worker tab A starts now with its build on its address is build 1's, and what it fetches with that build is build 1's too", async () => {
    [probe] = await Promise.all([page.waitForEvent("worker", { timeout: 30_000 }), page.evaluate((build) => { window.__probe = new Worker(`/engine/export-worker.js?build=${build}`, { type: "module" }); }, one.buildId)]);
    // The worker asks for its files the way the app's own worker does: with the build of the page that started it.
    const seen = await probe.evaluate(async (build) => (await (await fetch(`/build.json?build=${build}`)).json()).buildId, one.buildId);
    expect(seen === one.buildId, `the worker of tab A fetched build ${seen}'s record`);
  });

  await step("Two tabs: the worker is stopped and started again by the browser — tab A is still answered from build 1", async () => {
    const cdp = await context.newCDPSession(page);
    await cdp.send("ServiceWorker.enable");
    await cdp.send("ServiceWorker.stopAllWorkers");
    await cdp.detach();
    expect((await buildOf(page)) === one.buildId && (await digestOf(page, "/engine/export-worker.js")) === exportWorker[0], "tab A keeps build 1 after a restart of the worker");
    expect((await buildOf(other)) === two.buildId, "tab B keeps build 2");
    // A worker that runs for long (an export) is still the old build's after the worker's clean-up has run.
    await new Promise((done) => setTimeout(done, 16_000));
    await navigate(context, "/settings/about");
    await new Promise((done) => setTimeout(done, 5000));
    const late = await probe.evaluate(async (build) => (await (await fetch(`/build.json?build=${build}`)).json()).buildId, one.buildId);
    expect(late === one.buildId, `the long-running worker of tab A fetched build ${late}'s record`);
    await page.evaluate(() => window.__probe.terminate());
  });

  await step("Two tabs: tab B closes — tab A's worker files are still build 1's", async () => {
    await other.close();
    expect((await digestOf(page, `/engine/export-worker.js?build=${one.buildId}`)) === exportWorker[0] && (await buildOf(page)) === one.buildId, "tab A keeps build 1 when it is the only tab");
  });

  await step("Two tabs: when tab A reloads it gets build 2, and build 1 is dropped because no tab uses it", async () => {
    await page.reload({ waitUntil: "load", timeout: 60_000 });
    expect((await buildOf(page)) === two.buildId && (await digestOf(page, "/engine/export-worker.js")) === exportWorker[1], "tab A runs build 2 after its reload");
    // The worker looks for builds nobody uses a moment after a page load; the worker tab A started is forgotten 15 s after its start.
    await until(async () => { await navigate(context, "/settings/about"); await new Promise((done) => setTimeout(done, 4000)); return kept(page); }, (state) => JSON.stringify(state.shell) === JSON.stringify([`jagentchill-shell-${two.buildId}`]), "only build 2 is kept", 8);
    await context.setOffline(true);
    await page.goto(`${base}/settings/about`, { waitUntil: "load", timeout: 60_000 });
    expect((await page.getByTestId("app-build").filter({ visible: true }).first().innerText()).trim() === two.buildId, "build 2 opens offline");
    await page.screenshot({ path: `${shots}/w3-tab-a-reloaded-build-2-offline.png` });
  });
} finally {
  await browser?.close().catch(() => undefined);
  server.closeAllConnections?.();
  if (server.listening) server.close();
  rmSync(temp, { recursive: true });
}
if (errors.length) console.log("PAGE ERRORS:\n" + [...new Set(errors)].slice(0, 10).join("\n"));
console.log(failed ? `${failed} step(s) failed` : "all steps passed");
process.exit(failed || errors.length ? 1 : 0);
