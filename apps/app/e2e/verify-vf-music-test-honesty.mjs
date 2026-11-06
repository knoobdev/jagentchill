// Evidence of finding 14: original setup/search/preview assertions; playback disabled and console error injected. Other steps omitted.
// Verifier copy: original assertions unchanged. E2E_BASE and host port supplied by runner.
// W7 music (brief `w7-music.md`) end to end, in a real headless browser on a PRODUCTION web build against a FRESH host.
//
// WHAT IS REAL AND WHAT IS NOT — read before looking at a screenshot of this run:
//   * default mode: the Music shelf shows LIVE answers of the Openverse API (api.openverse.org), asked by the host of
//     this run without a key; the tracks played and added are the real files of those rows (hosted by Jamendo).
//   * JC_MODE=offline: the host was started with the catalogue's address pointing at a port where nothing listens;
//     the shelf's "cannot be reached" line is the product's real answer to that.
//   * "More music": NOTHING is fetched from Pixabay or NCS. `window.open` is replaced in the page so that pressing
//     "Open …" only records the address. The "NCS" files are SINE TONES made here with ffmpeg and merely NAMED like an
//     NCS release; the pasted credit is text typed by this script. The picture is an ffmpeg colour clip.
//
// Usage: node apps/app/e2e/music-w7.mjs <run-dir> [screenshot-dir]
//   against a host started with `.dev/w7/music/run.sh start <run-dir> <build-dir> [offline]` (ports 18980/18981, web 8085).
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { pairAdmin } from "../../../server/scripts/live-lib.ts";

const [runDir, shots = ".dev/shots/w7-music"] = process.argv.slice(2);
const offline = process.env.JC_MODE === "offline", logFile = `${runDir}/server.log`, base = process.env.E2E_BASE ?? "http://localhost:8085";
mkdirSync(shots, { recursive: true });
const out = join(runDir, `generated-${Date.now()}`); mkdirSync(out, { recursive: true });
// Safety: cleanup by verifier with explicit rm -r of this run dir.
const ffmpeg = (args) => { const made = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { encoding: "utf8" }); if (made.status !== 0) throw new Error(`ffmpeg: ${made.stderr}`); };
// GENERATED test media: a 4 s colour clip and two 4 s sine tones. One tone is NAMED like an NCS release; neither is NCS music.
const picture = join(out, "picture.mp4"), ncsNamed = join(out, "Tone Maker - Test Tone [NCS Release].wav"), plain = join(out, "plain-tone.wav");
ffmpeg(["-f", "lavfi", "-i", "color=c=0x2a6f97:s=640x360:r=30:d=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", picture]);
ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-ac", "2", ncsNamed]);
ffmpeg(["-f", "lavfi", "-i", "sine=frequency=660:duration=4", "-ac", "2", plain]);
const NCS_FORM = "Song: Tone Maker - Test Tone [NCS Release]\nMusic provided by NoCopyrightSounds";
const PASTED = "Song: Script - Typed Credit [NCS Release]\nMusic provided by NoCopyrightSounds\nFree Download/Stream: http://ncs.io/typed-by-the-test";

const firstOffer = /jagentchill:\/\/pair#offer=[A-Za-z0-9_-]+/.exec(readFileSync(logFile, "utf8"))[0];
const setup = await pairAdmin(firstOffer, logFile, "Host setup");
const codes = new Map();
setup.on((event, payload) => { if (event === "jagentchill.pairing.requested") codes.set(payload.request.deviceName, payload.code); });

const browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"] });
const errors = [], results = [];
const musicStreams = [], musicFetchRpc = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light", acceptDownloads: true, permissions: ["clipboard-read", "clipboard-write"] });
// The system's "save as" window cannot be answered in a headless browser: the export is given a file in the browser's own private storage instead (as the other e2e scripts do).
await context.addInitScript(() => {
  window.showSaveFilePicker = async (options) => { const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle("picked", { create: true }); return folder.getFileHandle(options.suggestedName, { create: true }); };
  delete window.showDirectoryPicker;
});
const page = await context.newPage();
// Inject a silent media implementation to verify whether the ORIGINAL preview assertion notices no playing.
await context.addInitScript(() => {
 window.__vfFalsePositive={playCalls:0,playing:0};
 HTMLMediaElement.prototype.play=function(){window.__vfFalsePositive.playCalls++;this.addEventListener('playing',()=>window.__vfFalsePositive.playing++);return Promise.resolve();};
});
await page.route('**/jagentchill/v1/music/stream/**', route=>route.fulfill({status:200,contentType:'audio/mpeg',body:readFileSync(`${runDir}/tone.mp3`)}));
page.on("request", (request) => { const match = /\/jagentchill\/v1\/music\/stream\/([0-9a-f-]{36})/.exec(new URL(request.url()).pathname); if (match) musicStreams.push(match[1]); });
page.on("websocket", (socket) => socket.on("framesent", (frame) => { try { const value = JSON.parse(frame.payload.toString()); if (value.method === "jagentchill.music.fetch") musicFetchRpc.push(value.method); } catch { /* non-JSON channel frame */ } }));
page.on("pageerror", (err) => { if (!/GPU context not initialized/.test(String(err))) errors.push(String(err)); });
page.on("console", (msg) => msg.type() === "error" && !/status of (400|401|403|404|409|422|502|503)|Failed to load resource|ERR_|GPU context|WebSocket/.test(msg.text()) && errors.push(msg.text().slice(0, 300)));
// No request of this run may go to Pixabay, NCS or TikTok.
const forbidden = [];
page.on("request", (request) => { if (/pixabay\.com|ncs\.io|tiktok\.com/.test(request.url())) forbidden.push(request.url()); });
const visible = (locator) => locator.filter({ visible: true }).first();
const tid = (id) => visible(page.getByTestId(id));
const button = (name, exact = true) => visible(page.getByRole("button", { name, exact }));
const field = (label) => visible(page.getByLabel(label, { exact: true }));
const shot = (name) => page.screenshot({ path: `${shots}/${name}.png` });
const expect = (condition, message) => { if (!condition) throw new Error(message); };
const step = async (name, run) => {
  if (!name.startsWith("setup:") && !name.startsWith("Shelf")) return;
  try { await run(); console.log("ok  ", name); results.push([name, true]); }
  catch (err) { console.log("FAIL", name, "—", String(err).split("\n")[0]); results.push([name, false]); errors.push(`step failed: ${name}`); await shot(`failure-${name.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}`).catch(() => undefined); await page.keyboard.press("Escape").catch(() => undefined); }
};
const attr = (id, name) => page.evaluate(([testId, attribute]) => [...document.querySelectorAll(`[data-testid="${testId}"]`)].find((node) => node.getClientRects().length)?.getAttribute(attribute) ?? null, [id, name]);
const waitAttr = (id, name, wanted, timeout = 60_000) => page.waitForFunction(([testId, attribute, value]) => [...document.querySelectorAll(`[data-testid="${testId}"]`)].some((node) => node.getClientRects().length && node.getAttribute(attribute) === value), [id, name, wanted], { timeout });
const until = async (read, done, what, tries = 300) => { let value = await read(); for (let n = 0; n < tries && !done(value); n++) { await page.waitForTimeout(200); value = await read(); } if (!done(value)) throw new Error(`timed out waiting for ${what}: ${JSON.stringify(value).slice(0, 400)}`); return value; };
const pick = async (trigger, files) => { const [chooser] = await Promise.all([page.waitForEvent("filechooser"), trigger.click()]); await chooser.setFiles(files); };
const rows = (id) => page.getByTestId(id).filter({ visible: true });
const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
const licenceRows = async () => { await tid("audio-licence").click(); await tid("licence-check").waitFor(); return page.getByTestId("licence-row").filter({ visible: true }).allInnerTexts(); };

await step("setup: the browser pairs with a fresh host; a project with a 4 s colour clip on its timeline (GENERATED media)", async () => {
  const offer = (await setup.call("jagentchill.pairing.offer.create", { role: "admin" })).url;
  await page.goto(`${base}/home`, { waitUntil: "networkidle", timeout: 180_000 });
  await visible(page.getByText("What do you want to make?")).waitFor({ timeout: 120_000 });
  await button("Connect").click();
  await field("Pairing link").fill(offer);
  await field("Name of this device").fill("Music browser");
  await button("Continue", false).click();
  await visible(page.getByText(/Enter the code shown next to [0-9a-f]{8}/)).waitFor();
  for (let wait = 0; wait < 50 && !codes.has("Music browser"); wait++) await page.waitForTimeout(100);
  await field("Verification code").fill(codes.get("Music browser"));
  await visible(page.getByText("Connected", { exact: true })).waitFor();
  await page.goto(`${base}/projects`, { waitUntil: "networkidle", timeout: 180_000 });
  await button("Create your first project").click({ timeout: 90_000 });
  await page.waitForURL(/\/editor\/[0-9a-f-]{36}$/);
  await tid("timeline").waitFor({ timeout: 60_000 });
  await pick(tid("media-dropzone"), [picture]);
  await tid("label-picture.mp4").waitFor({ timeout: 60_000 });
  await tid("thumb-picture.mp4").dblclick();
  await page.keyboard.press("Home");
  await tid("panel-tab-audio").click();
  await tid("audio-tab").waitFor();
  await page.evaluate(() => { window.__opened = []; window.open = (url) => { window.__opened.push(String(url)); return null; }; });
});

if (offline) {
  await step("OFFLINE — the catalogue cannot be reached: the shelf says so in one line, and \"My music\" still works (a generated tone is imported and listed)", async () => {
    await tid("audio-music-down").waitFor({ timeout: 60_000 });
    const line = await tid("audio-music-down").innerText(), state = await attr("audio-music", "data-state");
    expect(state === "offline" && /can't be reached right now\. Your own files still work\./.test(line), `the shelf's line: ${state} / ${line}`);
    expect((await rows("audio-music-row").count()) === 0, "no row is shown");
    await pick(tid("audio-import"), [plain]);
    await until(() => rows("audio-row").count(), (count) => count === 1, "the person's own file to be listed");
    await rows("audio-row").first().getByTestId("audio-add").click();
    await shot("08-shelf-offline-my-music-works");
  });
} else {
  await step("More music — the section names Pixabay and NCS with their rule in one line each; \"Open\" hands the address to the system browser (recorded, nothing is loaded from either site)", async () => {
    await tid("audio-more-music").scrollIntoViewIfNeeded();
    const text = (await tid("audio-more-music").innerText()).replace(/\s+/g, " ");
    expect(/Pixabay: free, no credit needed\./.test(text) && /NCS: free for your videos, credit required\./.test(text) && /bring the file in with Import/.test(text), `the lines: ${text}`);
    expect((await attr("more-music-open-pixabay", "data-url")) === "https://pixabay.com/music/" && (await attr("more-music-open-ncs", "data-url")) === "https://ncs.io/", "the addresses");
    await tid("more-music-open-pixabay").getByText("Open Pixabay Music").click(); await tid("more-music-open-ncs").getByText("Open NCS").click();
    const opened = await page.evaluate(() => window.__opened);
    expect(JSON.stringify(opened) === JSON.stringify(["https://pixabay.com/music/", "https://ncs.io/"]) && /\/editor\//.test(page.url()), `opened outside the window: ${opened}`);
    await shot("06-more-music-section");
  });

  await step("More music — a file NAMED as an NCS release gets NCS's credit form by itself; \"This is an NCS track\" + a pasted credit is stored on the next import (both files are GENERATED TONES)", async () => {
    await tid("more-music-import").scrollIntoViewIfNeeded();
    await pick(tid("more-music-import"), [ncsNamed]);
    await until(() => rows("audio-row").count(), (count) => count === 1, "the named file to be listed");
    await tid("more-music-is-ncs").getByRole("checkbox").click();
    await tid("more-music-credit").waitFor();
    await visible(page.getByLabel("Credit from the NCS page", { exact: true })).fill(PASTED);
    await shot("06b-more-music-ncs-credit-pasted");
    await pick(tid("more-music-import"), [plain]);
    await until(() => rows("audio-row").count(), (count) => count === 2, "the second file to be listed");
    // Both go on the timeline, then the Licence check lists them with their credit lines.
    for (let index = 0; index < 2; index++) { await page.keyboard.press("Home"); await rows("audio-row").nth(index).getByTestId("audio-add").click(); }
    const listed = await licenceRows();
    expect(listed.length === 2 && listed.every((row) => /Attribution required/.test(row) && /credit required by its source/.test(row)), `the licence check: ${JSON.stringify(listed)}`);
    const all = listed.join("\n");
    expect(all.includes("Song: Tone Maker - Test Tone [NCS Release]") && all.includes("http://ncs.io/typed-by-the-test"), `both credit lines are shown: ${all}`);
    await shot("07-licence-check-imported-credits");
    await tid("licence-copy").click();
    const copied = await until(clipboard, (value) => value.includes("NoCopyrightSounds"), "the credits on the clipboard", 50);
    expect(copied.includes(NCS_FORM) && copied.includes(PASTED), `copied: ${copied}`);
    await button("Done").click();
  });

  await step("Export — the export-finished dialog offers \"Copy credits\": the clipboard gets the credit lines of the exported scene's sounds", async () => {
    await page.evaluate(() => navigator.clipboard.writeText("")); 
    await tid("open-export").click(); await tid("export-dialog").waitFor(); await page.waitForTimeout(1000);
    await tid("export-start").click();
    await Promise.race([tid("export-done").waitFor({ timeout: 300_000 }), tid("export-error").waitFor({ timeout: 300_000 })]);
    expect(await page.getByTestId("export-done").count(), `the export finished: ${(await tid("export-dialog").innerText()).replace(/\s+/g, " ").slice(-300)}`);
    await tid("export-copy-credits").click();
    const copied = await until(clipboard, (value) => value.includes("NoCopyrightSounds"), "the credits on the clipboard", 50);
    expect(copied.includes(NCS_FORM) && copied.includes(PASTED), `copied after export: ${copied}`);
    await shot("07b-export-finished-copy-credits");
    await page.keyboard.press("Escape");
    await page.getByTestId("export-dialog").first().waitFor({ state: "hidden", timeout: 20_000 }).catch(() => undefined);
  });

  let picked = "";
  await step("Shelf (LIVE Openverse) — rows with title, author · licence and length; a chip changes the search; typed words search", async () => {
    await tid("audio-music").scrollIntoViewIfNeeded();
    await waitAttr("audio-music", "data-state", "ready", 90_000);
    const first = await rows("audio-music-row").allInnerTexts();
    expect(first.length === 6 && first.every((row) => /·\s*(CC BY( \d\.\d)?|CC0|Public domain)/.test(row) && /\d\d:\d\d/.test(row)), `rows: ${JSON.stringify(first.slice(0, 3))} (${first.length})`);
    expect((await attr("audio-music", "data-provider")) === "openverse" && /Made using Openverse — not endorsed or certified by Openverse\./.test(await tid("audio-music-notice").innerText()), "the catalogue's notice is shown");
    const chips = await page.locator('[data-testid^="audio-mood-"]').filter({ visible: true }).count();
    expect(chips === 10, `ten chips: ${chips}`);
    console.log(`     upbeat: ${first.length} rows — ${first.slice(0, 3).map((row) => row.replace(/\n/g, " | ")).join(" ;; ")}`);
    await shot("01-shelf-live-upbeat");
    await tid("audio-mood-piano").getByRole("button").first().click().catch(async () => { await tid("audio-mood-piano").click(); });
    await waitAttr("audio-music", "data-chip", "piano");
    const piano = await until(() => rows("audio-music-row").allInnerTexts(), (list) => list.length >= 5 && list[0] !== first[0], "the piano rows");
    await tid("audio-music-more").click();
    const more = await until(() => rows("audio-music-row").count(), (count) => count > 6, "the rest of the page");
    console.log(`     "Show more": ${more} rows`);
    await tid("audio-music-more").click();
    console.log(`     piano: ${piano.length} rows — ${piano.slice(0, 3).map((row) => row.replace(/\n/g, " | ")).join(" ;; ")}`);
    await shot("02-shelf-live-chip-piano");
    await field("Search sounds").fill("cinematic");
    const typed = await until(() => rows("audio-music-row").allInnerTexts(), (list) => list.length >= 5 && list[0] !== piano[0], "the rows of the typed search", 150);
    console.log(`     "cinematic": ${typed.length} rows — ${typed.slice(0, 3).map((row) => row.replace(/\n/g, " | ")).join(" ;; ")}`);
    await shot("03-shelf-live-search-cinematic");
    await field("Search sounds").fill("");
    await tid("audio-mood-corporate").getByRole("button").first().click().catch(async () => { await tid("audio-mood-corporate").click(); });
    await waitAttr("audio-music", "data-chip", "corporate");
    const corporate = await until(() => rows("audio-music-row").allInnerTexts(), (list) => list.length >= 3 && list[0] !== piano[0] && list[0] !== typed[0] && list[0] !== first[0], "the corporate rows", 150);
    console.log(`     corporate: ${corporate.length} rows — ${corporate.slice(0, 3).map((row) => row.replace(/\n/g, " | ")).join(" ;; ")}`);
  });

  await step("Shelf (fixture catalogue) — ▶ starts from the signed host stream before EOF; after stopping, \"+\" reuses those bytes for the project track with one stream and no stored preview blob", async () => {
    picked = (await rows("audio-music-row").first().innerText()).split("\n")[0].trim();
    const row = rows("audio-music-row").filter({ hasText: picked }).first();
    const trackId = await row.getAttribute("data-track");
    await row.getByTestId("audio-preview").click();
    const state = await until(async () => [await row.getByTestId("audio-preview").getAttribute("aria-label"), await rows("audio-preview-failed").count()], ([label, bad]) => /^Pause /.test(label ?? "") || bad > 0, "the preview to start or fail", 600);
    expect(/^Pause /.test(state[0] ?? ""), `the preview started: ${JSON.stringify(state)}`);
    expect((await rows("audio-preview-failed").count()) === 0, "the preview plays");
    const streamCount = musicStreams.filter((id) => id === trackId).length;
    expect(streamCount === 1, `one signed stream request so far: ${streamCount}`);
    await page.waitForTimeout(1500);
    await shot("04-shelf-live-preview-playing");
    await row.getByTestId("audio-preview").click();
    const before = await rows("audio-row").count();
    await page.keyboard.press("Home");
    await row.getByTestId("audio-add").click();
    await until(() => rows("audio-row").count(), (count) => count === before + 1, "the track to become a sound of the project", 600);
    const mine = await rows("audio-row").allInnerTexts();
    expect(musicStreams.filter((id) => id === trackId).length === 1 && musicFetchRpc.length === 0, `the existing stream supplied Add (streams=${musicStreams.length}, fetch RPCs=${musicFetchRpc.length})`);
    expect(mine.some((text) => text.includes(picked) && /CC BY|CC0|Public domain/.test(text)), `the project's sound names its author and licence: ${JSON.stringify(mine)}`);
    const listed = await licenceRows(), hit = listed.find((text) => text.includes(picked));
    expect(hit && /CC BY|CC0|Public domain/.test(hit) && hit.includes(`"${picked}"`) && /https:\/\//.test(hit), `the licence check of the added track: ${JSON.stringify(listed)}`);
    console.log(`     added "${picked}": ${hit.replace(/\n/g, " | ")}`);
    await shot("05-licence-check-catalogue-track");
    await tid("licence-copy").click();
    const copied = await until(clipboard, (value) => value.includes(`"${picked}"`), "the track's credit on the clipboard", 50);
    expect(/— (CC BY \d\.\d|CC0|Public domain) \(https:\/\/creativecommons\.org\//.test(copied), `copied: ${copied}`);
    await button("Done").click();
  });

  await step("Starter (LIVE) — \"Day in my life\" opens with the track it names: fetched from the catalogue, on its Music slot; in the full editor the Licence check gives its licence and credit", async () => {
    await page.goto(`${base}/library/templates`, { waitUntil: "networkidle", timeout: 240_000 });
    await tid("templates-tab").waitFor({ timeout: 90_000 });
    await visible(page.locator('[data-testid="template-card"][data-name="Day in my life"]')).getByTestId("template-open").click();
    await tid("template-preview").waitFor();
    await tid("template-use").click();
    await page.waitForURL(/\/editor\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    await tid("template-editor").waitFor({ timeout: 60_000 });
    await visible(page.getByRole("tab", { name: /^Audio/ })).click();
    const slot = await until(async () => ((await page.getByTestId("template-audio").filter({ visible: true }).count()) ? (await tid("template-audio").innerText()) : ""), (text) => /Music/.test(text) && /\d\d:\d\d/.test(text), "the starter's music to arrive", 600);
    console.log(`     slot: ${slot.replace(/\n/g, " | ")}`);
    await shot("09-starter-opens-with-its-track");
    await tid("template-unlock").click();
    await visible(page.getByRole("dialog").getByRole("button", { name: "Edit in full editor", exact: true })).click();
    for (const id of ["asset-panel", "timeline"]) await tid(id).waitFor({ timeout: 30_000 });
    await tid("panel-tab-audio").click();
    const listed = await licenceRows();
    expect(listed.length === 1 && /Upbeat Lounge Background/.test(listed[0]) && /Soundrider\/Dope · CC BY 3\.0/.test(listed[0]) && /Attribution required/.test(listed[0]) && /jamendo\.com\/track/.test(listed[0]), `the starter's track in the licence check: ${JSON.stringify(listed)}`);
    await shot("10-starter-track-licence-check");
    await button("Done").click();
  });
}

console.log('VF14 deliberately disabled playback:',JSON.stringify(await page.evaluate(()=>window.__vfFalsePositive)));
await page.evaluate(()=>console.error('VF14 injected browser error: must fail a claiming-green test'));
await page.screenshot({path:`${shots}/vf-14-passing-with-no-playing.png`});
await browser.close();
setup.close?.();
if (forbidden.length) { errors.push(`requests to Pixabay / NCS / TikTok: ${forbidden.join(", ")}`); results.push(["no request to Pixabay, NCS or TikTok", false]); }
const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n${results.length - failed} ok, ${failed} FAIL of ${results.length} steps`);
if (errors.length) console.log("errors:\n" + [...new Set(errors)].map((entry) => `  ${entry}`).join("\n"));
process.exit(failed ? 1 : 0);
