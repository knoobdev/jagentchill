// The desktop app's updates and About pages, in the real shell run from source (`electron .`, unattended: no window is
// shown), on a production web export. The built-in host is switched off: the pages need none.
// One thing is not real: there is no published release, so the feed is a fixture served here over HTTP on this
// computer — a `latest-mac.yml` and a package of random bytes with its true SHA-512 (it is not an installable image).
// A build run from source cannot replace itself, exactly like an unsigned macOS package: it downloads, verifies and
// shows the package ("manual" mode). The signed path (Squirrel.Mac through electron-updater) is not exercised.
// Usage: node apps/desktop/e2e/updates.mjs <web-desktop-build-dir> [screenshot-dir]
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { freshRun, launch, quit, waitFor } from "./lib.mjs";

const check = (ok, message) => { if (!ok) throw new Error(message); };

const webDir = resolve(process.argv[2] ?? "");
if (!existsSync(join(webDir, "build.json"))) throw new Error(`${webDir} is not a finished desktop web export`);
const build = JSON.parse(readFileSync(join(webDir, "build.json"), "utf8"));
const run = freshRun("updates");
const shots = resolve(process.argv[3] ?? run.shots);
mkdirSync(shots, { recursive: true });
writeFileSync(join(run.userData, "desktop.json"), JSON.stringify({ builtInHost: false }));

// ── the feed fixture ──
const release = { version: "0.0.0", corrupt: false };
const packages = new Map();
const packageOf = (version) => { if (!packages.has(version)) packages.set(version, randomBytes(3_000_000)); return packages.get(version); };
const requests = [];
const feed = createServer((request, response) => {
  requests.push({ url: request.url, headers: request.headers });
  const path = new URL(request.url, "http://x").pathname;
  const name = `JAgentChill-${release.version}-universal.dmg`, bytes = packageOf(release.version);
  const sha512 = createHash("sha512").update(bytes).digest("base64");
  if (path === "/feed/latest-mac.yml") return void response.writeHead(200, { "content-type": "text/yaml" }).end(`version: ${release.version}\nfiles:\n  - url: ${name}\n    sha512: ${sha512}\n    size: ${bytes.length}\npath: ${name}\nsha512: ${sha512}\nreleaseDate: '2026-10-08T00:00:00.000Z'\n`);
  if (path === `/feed/${name}`) {
    const body = Buffer.from(bytes);
    if (release.corrupt) body[4096] ^= 0xff;
    response.writeHead(200, { "content-type": "application/octet-stream", "content-length": String(body.length) });
    // In pieces, so that the page has a download to show.
    let sent = 0;
    const next = () => { if (sent >= body.length) return void response.end(); response.write(body.subarray(sent, sent + 150_000)); sent += 150_000; setTimeout(next, 60); };
    return void next();
  }
  response.writeHead(404).end();
});
await new Promise((done) => feed.listen(0, "127.0.0.1", done));
const feedUrl = `http://127.0.0.1:${feed.address().port}/feed`;

const session = await launch(run, { env: { JAGENTCHILL_WEB_DIR: webDir, JAGENTCHILL_UPDATE_FEED: feedUrl } });
const { page } = session;
const tid = (id) => page.getByTestId(id).filter({ visible: true }).first();
const text = (value) => page.getByText(value, { exact: true }).filter({ visible: true }).first();
const shot = (name) => page.screenshot({ path: join(shots, `${name}.png`) });
const mainLog = () => readFileSync(join(run.userData, "logs", "main.log"), "utf8");
const updatesDir = join(run.userData, "updates");
const state = () => page.evaluate(() => globalThis.jagentchillDesktop.updates.getState());
const go = async (route) => { await page.evaluate((path) => { history.pushState(null, "", path); dispatchEvent(new PopStateEvent("popstate")); }, route); };
let failed = 0;
const step = async (name, body) => {
  try { await body(); console.log("ok  ", name); }
  catch (error) { failed++; console.log("FAIL", name, "—", String(error).split("\n").slice(0, 3).join(" ")); await shot(`failure-${failed}`).catch(() => undefined); console.log("PAGE TEXT:", (await page.locator("body").innerText().catch(() => "")).replace(/\n+/g, " | ").slice(0, 500)); }
};

try {
  await page.waitForLoadState("load");
  await step("the shell runs the export from its own scheme and registers no service worker", async () => {
    await waitFor(async () => (await page.evaluate(() => location.origin)) === "app://jagentchill", { what: "the app origin" });
    // The app's router is up (its navigation is drawn) before any step asks it for a route.
    await page.getByText("Projects", { exact: true }).filter({ visible: true }).first().waitFor({ timeout: 150_000 });
    check((await page.evaluate(async () => (await navigator.serviceWorker?.getRegistrations?.().catch(() => []))?.length ?? 0)) === 0, "no service worker is registered in the desktop app");
  });

  await step("Local-only desktop: with no host, Personal ▸ Updates shows the version and build, both automatic switches and Check now — No channel control", async () => {
    await go("/settings/updates");
    await tid("update-check").waitFor({ timeout: 60_000 });
    check((await tid("app-version").innerText()).trim() === build.version, `version ${await tid("app-version").innerText()}`);
    check((await tid("app-build").innerText()).trim() === build.buildId, `build ${await tid("app-build").innerText()}`);
    await text("Check for updates automatically").waitFor();
    await text("Download updates automatically").waitFor();
    check((await state()).mode === "manual", `a build that cannot replace itself is in manual mode: ${(await state()).mode}`);
    await page.getByText("This build is not signed, so it cannot install an update by itself.", { exact: false }).first().waitFor();
    const body = await page.locator("body").innerText();
    check(!/channel|stable|preview|beta|pre-release/i.test(body), "the page has no channel selector and no pre-release label");
    check(!/Restart and install|Restart to update/.test(body), "no restart control is offered by a build that cannot install");
    await shot("01-updates-idle");
  });

  await step("Manual check with no update: the feed has the installed version — Up to date, with the time of the check", async () => {
    await tid("update-check").click();
    await text("Up to date").waitFor({ timeout: 20_000 });
    await page.getByText("Last checked", { exact: false }).first().waitFor();
    check(!existsSync(updatesDir) || readdirSync(updatesDir).length === 0, "nothing was downloaded");
    await shot("02-up-to-date");
  });

  await step("Update found: a newer version is downloaded with progress, verified against the feed's SHA-512, and offered as \"Show in folder\"", async () => {
    release.version = "0.1.0";
    await page.evaluate(() => { window.__progress = []; globalThis.jagentchillDesktop.updates.onState((next) => { if (next.status === "downloading") window.__progress.push(next.progress); }); });
    await tid("update-check").click();
    await page.getByText(/^Downloading \d+%$/).first().waitFor({ timeout: 20_000 });
    await shot("03-downloading");
    await text("Version 0.1.0 was downloaded and verified").waitFor({ timeout: 60_000 });
    const progress = await page.evaluate(() => window.__progress);
    check(progress.length >= 3 && progress.every((value, index) => index === 0 || value >= progress[index - 1]) && progress.at(-1) > 50, `progress was reported: ${progress.join(",")}`);
    const file = join(updatesDir, "JAgentChill-0.1.0-universal.dmg");
    check((await tid("update-file").innerText()).trim() === file, `the page names the file: ${await tid("update-file").innerText()}`);
    check(readFileSync(file).equals(packageOf("0.1.0")), "the kept file is the published package, byte for byte");
    await tid("update-reveal").waitFor();
    await shot("04-downloaded");
    // Unattended: nothing is opened on this computer; the app records which file it would show.
    await tid("update-reveal").click();
    await waitFor(() => mainLog().includes(`[reveal] ${file}`), { what: "the reveal in the main log", timeout: 10_000 });
  });

  await step("the downloaded version is announced on every screen with a banner that offers \"Show in folder\", never a restart", async () => {
    await go("/projects");
    await tid("update-banner").waitFor({ timeout: 20_000 });
    const banner = await tid("update-banner").innerText();
    check(banner.includes("Version 0.1.0 was downloaded and verified") && banner.includes("Show in folder") && banner.includes("Remind me in 4 hours") && !/Restart/.test(banner), `banner: ${banner}`);
    await shot("05-banner");
  });

  await step("Tampered download: a package that does not match the feed's hash is deleted and refused, and update_verification_failed is logged", async () => {
    release.version = "0.2.0"; release.corrupt = true;
    await go("/settings/updates");
    await tid("update-check").waitFor();
    await tid("update-check").click();
    await text("The update could not be downloaded").waitFor({ timeout: 60_000 });
    await page.getByText("The downloaded file did not match the published checksum and was deleted", { exact: false }).first().waitFor();
    check(readdirSync(updatesDir).length === 0, `nothing is kept: ${readdirSync(updatesDir)}`);
    check(/update_verification_failed version=0\.2\.0 /.test(mainLog()), "the failure is in the local log");
    check(await page.getByTestId("update-reveal").count() === 0 && await page.getByTestId("update-banner").count() === 0, "nothing is offered to open");
    check(await tid("update-check").isEnabled(), "Check now remains available");
    await tid("update-retry").waitFor();
    await shot("06-tampered-refused");
  });

  await step("Download fails on disk: the downloads folder cannot be written — the app keeps running, the page says the download failed with the reason, and \"Try again\" downloads the version once the folder is writable", async () => {
    release.corrupt = false;
    chmodSync(updatesDir, 0o555);
    try {
      await tid("update-retry").click();
      await page.getByText(/EACCES|EPERM/).first().waitFor({ timeout: 60_000 });
      await text("The update could not be downloaded").waitFor();
      check(/update_download_failed version=0\.2\.0 /.test(mainLog()), "the failure is in the local log");
      check((await state()).status === "error" && (await state()).reason === "download", `state: ${JSON.stringify(await state())}`);
      await tid("update-retry").waitFor();
      await shot("06b-download-failed-try-again");
    } finally { chmodSync(updatesDir, 0o755); }
    check(readdirSync(updatesDir).length === 0, `no partial file is left: ${readdirSync(updatesDir)}`);
    await tid("update-retry").click();
    await text("Version 0.2.0 was downloaded and verified").waitFor({ timeout: 60_000 });
    check(readFileSync(join(updatesDir, "JAgentChill-0.2.0-universal.dmg")).equals(packageOf("0.2.0")), "the kept file is the published package");
    check(await page.getByTestId("update-retry").count() === 0, "Try again is gone");
    await shot("06c-downloaded-after-try-again");
  });

  await step("Check fails: an unreachable feed says so with the reason and the time of the last successful check; no dialog is raised", async () => {
    await new Promise((done) => feed.close(done));
    feed.closeAllConnections?.();
    await tid("update-check").click();
    await text("Unable to check for updates").waitFor({ timeout: 30_000 });
    await page.getByText("Last checked", { exact: false }).first().waitFor();
    check(!mainLog().split("\n").some((line) => line.startsWith("[dialog]") && /update/i.test(line)), "no dialog was raised for the failed check");
    await shot("07-unreachable");
  });

  await step("Desktop request contents: every request to the feed is the feed path with a random value, or the package; none names this installation", async () => {
    const checks = requests.filter((request) => request.url.startsWith("/feed/latest-mac.yml"));
    check(checks.length >= 3 && checks.every((request) => /^\/feed\/latest-mac\.yml\?noCache=[0-9a-f]{16}$/.test(request.url)), `feed requests: ${checks.map((request) => request.url)}`);
    check(new Set(checks.map((request) => request.url)).size === checks.length, "the value differs per request");
    check(requests.every((request) => request.url.startsWith("/feed/latest-mac.yml?") || /^\/feed\/JAgentChill-0\.[12]\.0-universal\.dmg$/.test(request.url)), "nothing else was asked");
    const identity = readFileSync(join(run.userData, "desktop.json"), "utf8");
    for (const request of requests) for (const [name, value] of Object.entries(request.headers)) check(!/cookie|authorization|x-/i.test(name) && !/jagentchill/i.test(String(value)), `header ${name}: ${value}`);
    check(identity.includes("updateLastCheck_ms"), "the time of the last successful check is kept in the shell's settings");
  });

  await step("Personal ▸ About shows the app, version, build, build date and platform; the menu's About opens it; the licence list is the build's", async () => {
    check((await page.evaluate(() => location.pathname)) === "/settings/updates", "the step starts on another page");
    // The real item of the application menu is pressed; nothing else brings the page to About.
    const item = await session.app.evaluate(({ Menu, BrowserWindow }) => {
      const find = (items) => { for (const entry of items) { if (/^About\b/.test(entry.label)) return entry; if (entry.submenu) { const hit = find(entry.submenu.items); if (hit) return hit; } } return null; };
      const found = find(Menu.getApplicationMenu().items);
      if (!found) return { found: false };
      found.click(undefined, BrowserWindow.getAllWindows()[0], undefined);
      return { found: true, label: found.label, enabled: found.enabled };
    });
    check(item.found && item.enabled, `the application menu has an enabled About item: ${JSON.stringify(item)}`);
    await waitFor(async () => (await page.evaluate(() => location.pathname)) === "/settings/about", { timeout: 15_000, what: `"${item.label}" of the menu opens /settings/about` });
    await tid("app-platform").waitFor({ timeout: 20_000 });
    check((await tid("app-version").innerText()).trim() === build.version && (await tid("app-build").innerText()).trim() === build.buildId, "version and build");
    check(/^macOS \((arm64|x64)\)$/.test((await tid("app-platform").innerText()).trim()), `platform ${await tid("app-platform").innerText()}`);
    check(/\d{4}/.test(await tid("app-build-date").innerText()), "build date");
    await tid("licences-toggle").click();
    await tid("licences-list").waitFor();
    const listed = JSON.parse(readFileSync(join(webDir, "licences.json"), "utf8")).packages, shown = await tid("licences-list").innerText();
    for (const entry of listed) check(shown.includes(`${entry.name} ${entry.version}`), `Licence list complete: ${entry.name} ${entry.version} is missing`);
    await shot("08-about");
  });
} finally {
  await quit(session);
  if (feed.listening) feed.close();
}
const errors = session.logs.filter((line) => /^\[pageerror\]/.test(line));
if (errors.length) console.log("PAGE ERRORS:\n" + [...new Set(errors)].slice(0, 8).join("\n"));
console.log(failed ? `${failed} step(s) failed` : "all steps passed", `— run ${run.dir}`);
process.exit(failed || errors.length ? 1 : 0);
