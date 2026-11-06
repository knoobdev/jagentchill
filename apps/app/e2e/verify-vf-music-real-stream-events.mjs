// Verifier reproduction: attach observers to detached audio elements; retain original user steps and assertions.
// Verifier copy: original assertions unchanged. E2E_BASE and host port supplied by runner.
// W7-I: measure ▶ to the browser's real `playing` event, then verify that Add consumes that same signed stream.
// Catalogue rows are from saved Openverse fixtures served by .dev/w7/music/catalogue-double.mjs; the picked audio
// bytes are the real CC BY Jamendo file named in the fixture. Chromium is headless and audio output is muted.
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";
import { pairAdmin } from "../../../server/scripts/live-lib.ts";

const [runDir, shots = ".dev/shots/w7i-music"] = process.argv.slice(2), base = process.env.E2E_BASE ?? "http://localhost:8085";
mkdirSync(shots, { recursive: true });
const logFile = `${runDir}/server.log`, firstOffer = /jagentchill:\/\/pair#offer=[A-Za-z0-9_-]+/.exec(readFileSync(logFile, "utf8"))?.[0];
if (!firstOffer) throw new Error("No pairing offer in this run's server log.");
const setup = await pairAdmin(firstOffer, logFile, "Host setup");
const codes = new Map();
setup.on((event, payload) => { if (event === "jagentchill.pairing.requested") codes.set(payload.request.deviceName, payload.code); });
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
const page = await context.newPage(), streams = [], fetchRpcs = [], errors = [], streamFinished = new Map();
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
page.on("request", (request) => { const id = /\/jagentchill\/v1\/music\/stream\/([0-9a-f-]{36})/.exec(new URL(request.url()).pathname)?.[1]; if (id) streams.push(id); });
page.on("requestfinished", (request) => { const id = /\/jagentchill\/v1\/music\/stream\/([0-9a-f-]{36})/.exec(new URL(request.url()).pathname)?.[1]; if (id) streamFinished.set(id, Date.now()); });
page.on("websocket", (socket) => socket.on("framesent", (frame) => { try { if (JSON.parse(frame.payload.toString()).method === "jagentchill.music.fetch") fetchRpcs.push("jagentchill.music.fetch"); } catch { /* channel frame */ } }));
await context.addInitScript(() => {
  window.__musicPressed = 0;
  window.__musicPlaying = null;
  window.__musicPlayingEvents = 0;
  window.__musicEndedEvents = 0;
  window.__musicAudio = null;
  document.addEventListener("click", (event) => { if ((event.target instanceof Element) && event.target.closest('[data-testid="audio-preview"]')) window.__musicPressed = performance.now(); }, true);
  document.addEventListener("playing", (event) => { if (event.target instanceof HTMLAudioElement && event.target.src.startsWith("blob:")) { window.__musicAudio = event.target; window.__musicPlayingEvents++; } }, true);
  document.addEventListener("ended", (event) => { if (event.target === window.__musicAudio) window.__musicEndedEvents++; }, true);
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    if (!this.__musicMeasured) { this.__musicMeasured = true; this.muted=true; this.addEventListener("playing", () => { window.__musicAudio=this; window.__musicPlayingEvents++; window.__musicPlaying = performance.now() - window.__musicPressed; }); this.addEventListener("ended", () => { window.__musicEndedEvents++; }); }
    return play.call(this);
  };
});
const visible = (locator) => locator.filter({ visible: true }).first(), tid = (id) => visible(page.getByTestId(id));
const button = (name, exact = true) => visible(page.getByRole("button", { name, exact })), field = (name) => visible(page.getByLabel(name, { exact: true }));
const shot = (name) => page.screenshot({ path: `${shots}/${name}.png` });
try {
  // This separate profile has no paired host. Verify the actual shelf state and its adjacent connection action.
  const localContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" }), localPage = await localContext.newPage();
  localPage.on("pageerror", (error) => errors.push(`unpaired profile: ${String(error)}`));
  localPage.on("console", (message) => { if (message.type() === "error") errors.push(`unpaired profile console: ${message.text()}`); });
  await localPage.goto(`${base}/projects`, { waitUntil: "networkidle", timeout: 90_000 });
  const localVisible = (locator) => locator.filter({ visible: true }).first();
  await localVisible(localPage.getByRole("button", { name: "Create your first project", exact: true })).click({ timeout: 90_000 });
  await localVisible(localPage.getByTestId("timeline")).waitFor({ timeout: 90_000 });
  await localVisible(localPage.getByTestId("panel-tab-audio")).click();
  await localPage.waitForFunction(() => document.querySelector('[data-testid="audio-music"]')?.getAttribute("data-state") === "no_host", null, { timeout: 30_000 });
  const noHostLine = await localVisible(localPage.getByTestId("audio-music-down")).innerText();
  if (!/Connect to a host to browse music/.test(noHostLine) || await localPage.getByTestId("audio-music-connect").filter({ visible: true }).count() !== 1) throw new Error(`Unpaired shelf has no useful Connect action: ${noHostLine}`);
  await localPage.screenshot({ path: `${shots}/00-no-host-connect.png` });
  await localVisible(localPage.getByTestId("audio-music-connect")).click();
  await localPage.waitForURL(/\/pair\/start/, { timeout: 15_000 });
  await localContext.close();

  const offer = (await setup.call("jagentchill.pairing.offer.create", { role: "admin" })).url;
  await page.goto(`${base}/home`, { waitUntil: "networkidle", timeout: 180_000 });
  await visible(page.getByText("What do you want to make?")).waitFor({ timeout: 90_000 });
  await button("Connect").click();
  await field("Pairing link").fill(offer);
  await field("Name of this device").fill("Stream browser");
  await button("Continue", false).click();
  await visible(page.getByText(/Enter the code shown next to [0-9a-f]{8}/)).waitFor();
  for (let wait = 0; wait < 100 && !codes.has("Stream browser"); wait++) await page.waitForTimeout(100);
  await field("Verification code").fill(codes.get("Stream browser"));
  await visible(page.getByText("Connected", { exact: true })).waitFor();
  await page.goto(`${base}/projects`, { waitUntil: "networkidle", timeout: 180_000 });
  await button("Create your first project").click({ timeout: 90_000 });
  await tid("timeline").waitFor({ timeout: 90_000 });
  await tid("panel-tab-audio").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="audio-music"]')?.getAttribute("data-state") === "ready", null, { timeout: 90_000 });
  const row = visible(page.getByTestId("audio-music-row")).first();
  const trackId = await row.getAttribute("data-track");
  await row.getByTestId("audio-preview").click();
  await page.waitForFunction(() => typeof window.__musicPlaying === "number", null, { timeout: 20_000 });
  const startMs = await page.evaluate(() => Math.round(window.__musicPlaying));
  console.log(`preview press → playing: ${startMs} ms (track ${trackId})`);
  await shot("01-stream-playing");
  const playingEvents = await page.evaluate(() => window.__musicPlayingEvents);
  if (playingEvents < 1) throw new Error(`Expected a real audio element playing event, got ${playingEvents}`);
  // Stop and play again while the same stream is still available. This used to reuse its already-locked body.
  await row.getByTestId("audio-preview").click();
  await row.getByTestId("audio-preview").click();
  await page.waitForFunction((count) => window.__musicPlayingEvents > count, playingEvents, { timeout: 20_000 });
  for (let wait = 0; wait < 900 && !streamFinished.has(trackId); wait++) await page.waitForTimeout(100);
  if (!streamFinished.has(trackId)) throw new Error(`The preview stream for ${trackId} did not finish downloading`);
  const audioState = await page.evaluate(() => {
    const audio = window.__musicAudio;
    return audio ? { paused: audio.paused, duration: audio.duration, currentTime: audio.currentTime } : null;
  });
  if (!audioState || audioState.paused || !Number.isFinite(audioState.duration) || audioState.duration <= 1) throw new Error(`Playback paused at download EOF or has no finite duration: ${JSON.stringify(audioState)}`);
  await page.evaluate(() => { const audio = window.__musicAudio; if (audio && audio.duration > 0) audio.currentTime = Math.max(0, audio.duration - 0.2); });
  await page.waitForFunction(() => window.__musicEndedEvents > 0, null, { timeout: 10_000 });
  console.log(`media events: playing=${await page.evaluate(() => window.__musicPlayingEvents)}, ended=${await page.evaluate(() => window.__musicEndedEvents)}; download finished while audio remained unpaused`);
  await shot("03-stream-ended");
  await row.getByTestId("audio-preview").click();
  await row.getByTestId("audio-add").click();
  await page.getByTestId("audio-row").filter({ visible: true }).first().waitFor({ timeout: 90_000 });
  const streamCount = streams.filter((id) => id === trackId).length;
  if (streamCount !== 1 || fetchRpcs.length !== 0) throw new Error(`Add did not reuse its preview stream: stream requests=${streamCount}, legacy fetch RPCs=${fetchRpcs.length}`);
  await tid("audio-licence").click();
  await tid("licence-check").waitFor();
  const credit = await page.getByTestId("licence-row").filter({ visible: true }).first().innerText();
  if (!/CC BY|CC0/.test(credit) || !/https:\/\//.test(credit)) throw new Error(`The added catalogue track has no licence credit: ${credit}`);
  await page.waitForTimeout(700);
  await shot("02-stream-added-licence");
  if (errors.length) throw new Error(`Browser errors: ${errors.join("; ")}`);
  console.log(`Add reused the preview: one stream request, zero music.fetch RPCs; Licence check: ${credit.replace(/\n/g, " | ")}`);
} catch (error) {
  await shot("failure-stream-w7i").catch(() => undefined);
  throw error;
} finally {
  await browser.close();
  setup.close();
}
