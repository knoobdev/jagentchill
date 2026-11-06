// Verifier copy: original assertions unchanged. E2E_BASE and host port supplied by runner.
// W7-M3: browser regression for progressive preview, natural end, replay, and Add during/after preview.
// Catalogue answers are saved Openverse fixtures; media bytes are a generated tone fulfilled at the signed stream
// request, so this test makes no provider requests and has no audible output (headless Chromium is muted).
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";
import { pairAdmin } from "../../../server/scripts/live-lib.ts";

const [runDir, shots = ".dev/shots/w7m3-music"] = process.argv.slice(2), base = process.env.E2E_BASE ?? "http://localhost:8085";
mkdirSync(shots, { recursive: true });
const logFile = `${runDir}/server.log`, firstOffer = /jagentchill:\/\/pair#offer=[A-Za-z0-9_-]+/.exec(readFileSync(logFile, "utf8"))?.[0];
if (!firstOffer) throw new Error("No pairing offer in this run's server log.");
const setup = await pairAdmin(firstOffer, logFile, "Host setup"), codes = new Map();
setup.on((event, payload) => { if (event === "jagentchill.pairing.requested") codes.set(payload.request.deviceName, payload.code); });
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
const page = await context.newPage(), errors = [], streamIds = [], tracksByStream = new Map();
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
await context.addInitScript(() => {
  window.__musicEvents = { playing: 0, ended: 0, marks: [] };
  window.__musicPressedAt = 0;
  document.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest('[data-testid="audio-preview"]')) window.__musicPressedAt = performance.now();
  }, true);
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    if (!this.__musicEventsW7) {
      this.__musicEventsW7 = true;
      for (const name of ["loadedmetadata", "canplay", "playing", "ended"]) this.addEventListener(name, () => {
        if (name === "playing" || name === "ended") window.__musicEvents[name]++;
        window.__musicEvents.marks.push({ name, at: performance.now(), fromPress: performance.now() - window.__musicPressedAt });
      });
    }
    return play.call(this);
  };
});
const tones = [readFileSync(`${runDir}/tone.mp3`), readFileSync(`${runDir}/tone2.mp3`)];
await page.route("**/jagentchill/v1/music/stream/**", async (route) => {
  const id = new URL(route.request().url()).pathname.split("/").at(-1);
  streamIds.push(id);
  tracksByStream.set(id, (tracksByStream.get(id) ?? 0) + 1);
  await route.fulfill({ status: 200, contentType: "audio/mpeg", headers: { "accept-ranges": "bytes", "cache-control": "private, no-store" }, body: tones[streamIds.length - 1] ?? tones[0] });
});
const visible = (locator) => locator.filter({ visible: true }).first(), tid = (id) => visible(page.getByTestId(id));
const button = (name, exact = true) => visible(page.getByRole("button", { name, exact })), field = (name) => visible(page.getByLabel(name, { exact: true }));
const shot = (name) => page.screenshot({ path: `${shots}/${name}.png` });
try {
  const offer = (await setup.call("jagentchill.pairing.offer.create", { role: "admin" })).url;
  await page.goto(`${base}/home`, { waitUntil: "networkidle", timeout: 180_000 });
  await visible(page.getByText("What do you want to make?")).waitFor({ timeout: 90_000 });
  await button("Connect").click(); await field("Pairing link").fill(offer); await field("Name of this device").fill("W7-M3 preview"); await button("Continue", false).click();
  await visible(page.getByText(/Enter the code shown next to [0-9a-f]{8}/)).waitFor();
  for (let wait = 0; wait < 100 && !codes.has("W7-M3 preview"); wait++) await page.waitForTimeout(100);
  await field("Verification code").fill(codes.get("W7-M3 preview")); await visible(page.getByText("Connected", { exact: true })).waitFor();
  await page.goto(`${base}/projects`, { waitUntil: "networkidle", timeout: 180_000 });
  await button("Create your first project").click({ timeout: 90_000 }); await tid("timeline").waitFor({ timeout: 90_000 }); await tid("panel-tab-audio").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="audio-music"]')?.getAttribute("data-state") === "ready", null, { timeout: 90_000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="audio-music-row"]').length >= 2, null, { timeout: 30_000 });
  const rowAt = async (index) => page.locator('[data-testid="audio-music-row"]').nth(index), firstId = await (await rowAt(0)).getAttribute("data-track"), secondId = await (await rowAt(1)).getAttribute("data-track");
  const firstRow = page.locator(`[data-testid="audio-music-row"][data-track="${firstId}"]`), secondRow = page.locator(`[data-testid="audio-music-row"][data-track="${secondId}"]`);

  await firstRow.getByTestId("audio-preview").click();
  await page.waitForFunction(() => window.__musicEvents.playing >= 1, null, { timeout: 10_000 });
  await shot("01-playing-tone");
  const firstPlayCount = await page.evaluate(() => window.__musicEvents.playing);
  // Stop then replay the same one-consumer stream. Both user actions must reach the audio element.
  await firstRow.getByTestId("audio-preview").click(); await firstRow.getByTestId("audio-preview").click();
  await page.waitForFunction((count) => window.__musicEvents.playing > count, firstPlayCount, { timeout: 10_000 });
  const replayCount = await page.evaluate(() => window.__musicEvents.playing);
  // Add while playback is active; importing the stream must produce one timeline row.
  await firstRow.getByTestId("audio-add").click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid^="clip-"][role="listitem"]').length === 1, null, { timeout: 20_000 });
  await shot("02-added-during-playback");

  await secondRow.getByTestId("audio-preview").click();
  const priorEnded = await page.evaluate(() => window.__musicEvents.ended);
  await page.waitForFunction((count) => window.__musicEvents.ended > count, priorEnded, { timeout: 15_000 });
  const afterEndState = await secondRow.getByTestId("audio-preview").getAttribute("aria-pressed");
  if (afterEndState === "true") throw new Error("The row remained in playing state after the audio element ended.");
  await shot("03-natural-ended");
  await secondRow.getByTestId("audio-add").click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid^="clip-"][role="listitem"]').length === 2, null, { timeout: 20_000 });
  const counts = { streams: Object.fromEntries(tracksByStream), firstId, secondId, playing: await page.evaluate(() => window.__musicEvents.playing), ended: await page.evaluate(() => window.__musicEvents.ended), replayCount, timelineClips: await page.locator('[data-testid^="clip-"][role="listitem"]').count() };
  if (streamIds.length !== 2 || counts.timelineClips !== 2 || counts.playing < 3 || counts.ended < 1 || replayCount <= firstPlayCount) throw new Error(`Unexpected preview/add counts: ${JSON.stringify(counts)}`);
  // Each catalogue row is removed after its first Add, so a second Add is impossible through this path.
  if (counts.streams[firstId] !== 1 || counts.streams[secondId] !== 1) throw new Error(`A track was streamed more than once: ${JSON.stringify(counts.streams)}`);
  await tid("audio-licence").click(); await tid("licence-check").waitFor();
  if (await page.getByTestId("licence-row").count() !== 2) throw new Error(`Expected two imported rows, got ${await page.getByTestId("licence-row").count()}`);
  await shot("04-added-after-playback-licences");
  if (errors.length) throw new Error(`Browser errors: ${errors.join("; ")}`);
  console.log(`W7-M3 events: ${JSON.stringify(counts)}; two generated 6 s fixture tones; no live provider calls.`);
  console.log(`Audio event marks: ${JSON.stringify(await page.evaluate(() => window.__musicEvents.marks))}`);
} catch (error) {
  await shot("failure-music-preview-w7m3").catch(() => undefined); throw error;
} finally { await browser.close(); setup.close(); }
