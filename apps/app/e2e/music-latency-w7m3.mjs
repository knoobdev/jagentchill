// W7-M3 item 2: one live Openverse search and one preview. Headless Chromium is muted; no paid service is used.
// `server-timing` separates host checks, upstream response headers, and upstream first-body-byte wait. Browser media
// events show the time from the first host response byte through metadata, canplay, and actual playing.
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";
import { pairAdmin } from "../../../server/scripts/live-lib.ts";

const [runDir, shots = ".dev/shots/w7m3-music"] = process.argv.slice(2), base = process.env.E2E_BASE ?? "http://localhost:8085";
mkdirSync(shots, { recursive: true });
const firstOffer = /jagentchill:\/\/pair#offer=[A-Za-z0-9_-]+/.exec(readFileSync(`${runDir}/server.log`, "utf8"))?.[0];
if (!firstOffer) throw new Error("No pairing offer in this run's server log.");
const setup = await pairAdmin(firstOffer, `${runDir}/server.log`, "Host setup"), codes = new Map();
setup.on((event, payload) => { if (event === "jagentchill.pairing.requested") codes.set(payload.request.deviceName, payload.code); });
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
const page = await context.newPage(), errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
await context.addInitScript(() => {
  window.__musicMeasure = { press: 0, headers: 0, serverTiming: "", marks: [] };
  document.addEventListener("click", (event) => { if (event.target instanceof Element && event.target.closest('[data-testid="audio-preview"]')) window.__musicMeasure.press = performance.now(); }, true);
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const response = await nativeFetch(input, init);
    if (url.includes("/jagentchill/v1/music/stream/")) {
      window.__musicMeasure.headers = performance.now();
      window.__musicMeasure.serverTiming = response.headers.get("server-timing") ?? "";
    }
    return response;
  };
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    if (!this.__musicMeasuredW7) {
      this.__musicMeasuredW7 = true;
      for (const name of ["loadedmetadata", "canplay", "playing"]) this.addEventListener(name, () => window.__musicMeasure.marks.push({ name, at: performance.now(), fromPress: performance.now() - window.__musicMeasure.press, fromFirstByte: window.__musicMeasure.headers ? performance.now() - window.__musicMeasure.headers : null }));
    }
    return play.call(this);
  };
});
const visible = (locator) => locator.filter({ visible: true }).first(), tid = (id) => visible(page.getByTestId(id));
const button = (name, exact = true) => visible(page.getByRole("button", { name, exact })), field = (name) => visible(page.getByLabel(name, { exact: true }));
try {
  const offer = (await setup.call("jagentchill.pairing.offer.create", { role: "admin" })).url;
  await page.goto(`${base}/home`, { waitUntil: "networkidle", timeout: 180_000 });
  await visible(page.getByText("What do you want to make?")).waitFor({ timeout: 90_000 });
  await button("Connect").click(); await field("Pairing link").fill(offer); await field("Name of this device").fill("W7-M3 live timing"); await button("Continue", false).click();
  await visible(page.getByText(/Enter the code shown next to [0-9a-f]{8}/)).waitFor();
  for (let wait = 0; wait < 100 && !codes.has("W7-M3 live timing"); wait++) await page.waitForTimeout(100);
  await field("Verification code").fill(codes.get("W7-M3 live timing")); await visible(page.getByText("Connected", { exact: true })).waitFor();
  await page.goto(`${base}/projects`, { waitUntil: "networkidle", timeout: 180_000 });
  await button("Create your first project").click({ timeout: 90_000 }); await tid("timeline").waitFor({ timeout: 90_000 }); await tid("panel-tab-audio").click();
  await page.waitForFunction(() => { const state = document.querySelector('[data-testid="audio-music"]')?.getAttribute("data-state"); return state === "ready" || state === "rate_limited" || state === "provider_error"; }, null, { timeout: 90_000 });
  const state = await page.getByTestId("audio-music").getAttribute("data-state");
  if (state === "rate_limited") throw new Error("Openverse returned 429; stopping live calls as required.");
  if (state !== "ready") throw new Error(`Live catalogue did not become ready: ${state}`);
  const row = visible(page.getByTestId("audio-music-row")).first(), trackName = await row.innerText();
  await row.getByTestId("audio-preview").click();
  await page.waitForFunction(() => window.__musicMeasure.marks.some((mark) => mark.name === "playing"), null, { timeout: 30_000 });
  const data = await page.evaluate(() => {
    const marks = window.__musicMeasure.marks, loaded = marks.find((mark) => mark.name === "loadedmetadata"), canplay = marks.find((mark) => mark.name === "canplay"), playing = marks.find((mark) => mark.name === "playing");
    return { pressToFirstHostByteMs: Math.round(window.__musicMeasure.headers - window.__musicMeasure.press), upstreamTimings: window.__musicMeasure.serverTiming, firstByteToMetadataMs: loaded && Math.round(loaded.fromFirstByte), metadataToCanplayMs: loaded && canplay && Math.round(canplay.at - loaded.at), canplayToPlayingMs: canplay && playing && Math.round(playing.at - canplay.at), pressToPlayingMs: playing && Math.round(playing.fromPress), marks };
  });
  if (!data.upstreamTimings.includes("provider-first-byte") || typeof data.pressToPlayingMs !== "number") throw new Error(`No decomposed startup timings were exposed: ${JSON.stringify(data)}`);
  const hostMs = Number(/(?:^|,\s*)host;dur=([\d.]+)/.exec(data.upstreamTimings)?.[1]);
  if (!Number.isFinite(hostMs) || hostMs >= 100) throw new Error(`The warmed host route must stay below 100 ms; measured ${hostMs}: ${JSON.stringify(data)}`);
  await page.screenshot({ path: `${shots}/05-live-latency-playing.png` });
  if (errors.length) throw new Error(`Browser errors: ${errors.join("; ")}`);
  console.log(`Live Openverse track: ${trackName.replace(/\n/g, " | ")}`);
  console.log(`Startup timings: ${JSON.stringify(data)}`);
} finally { await browser.close(); setup.close(); }
