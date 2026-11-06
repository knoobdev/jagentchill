// Diagnosis, not a repeatable test: ONE real turn on a signed-in runtime, watched at every hop — the CLI's own records
// (a tee in front of the CLI), the relay (JAGENTCHILL_STREAM_TRACE), the frames reaching the browser, and what is painted.
// The MODEL IS REAL (owner allowed it, 2026-10-07): run it once per measurement, never in a loop.
// Usage: JAGENTCHILL_PORT=<port> node apps/app/e2e/stream-real.mjs <server-log> <relay-trace> <cli-tee-log> <runtimeId> <model-substring> <shot>   (env: E2E_BASE)
import { existsSync, readFileSync } from "node:fs";
import { chromium } from "playwright";
import { pairAdmin, settle } from "../../../server/scripts/live-lib.ts";

const [logFile, traceFile, teeFile, runtimeId = "claude-code", wanted = "haiku", shot] = process.argv.slice(2);
const base = process.env.E2E_BASE ?? "http://localhost:8095";
const offer0 = /jagentchill:\/\/pair#offer=[A-Za-z0-9_-]+/.exec(readFileSync(logFile, "utf8"))[0];
const setup = await pairAdmin(offer0, logFile, "Stream probe");
const codes = new Map();
setup.on((event, payload) => { if (event === "jagentchill.pairing.requested") codes.set(payload.request.deviceName, payload.code); });
let runtime;
for (let wait = 0; wait < 60; wait++) { runtime = (await setup.call("jagentchill.runtime.snapshot.get", {})).runtimes.find((entry) => entry.runtimeId === runtimeId); if (runtime?.models?.length) break; await settle(1000); }
if (!runtime?.models?.length) { console.log(`FAIL ${runtimeId} lists no model`); process.exit(1); }
const model = runtime.models.find((entry) => String(entry.modelId).includes(wanted)) ?? runtime.models[0];
const { session } = await setup.call("jagentchill.session.create", { ref: { runtimeId, providerId: model.providerId, modelId: model.modelId }, ...(process.env.THINKING ? { thinkingOptionId: process.env.THINKING } : {}) });
console.log("model:", model.modelId, "thinking:", session.thinkingOptionId ?? "(default)");

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const frames = [];
page.on("websocket", (ws) => ws.on("framereceived", (frame) => {
  const body = typeof frame.payload === "string" ? frame.payload : "";
  if (!body.includes("jagentchill.chat.")) return;
  let kind = "other", chars = 0, extra = "";
  try { const msg = JSON.parse(body), payload = msg.payload ?? msg.params?.payload ?? msg; const p = payload.payload ?? payload;
    if (body.includes("jagentchill.chat.stream")) { kind = `stream:${p.state}`; chars = String(p.deltaText ?? "").length; }
    else if (body.includes("jagentchill.chat.activity")) { kind = `activity:${p.stream}`; extra = String(p.data?.phase ?? p.data?.kind ?? ""); }
    else if (body.includes("jagentchill.chat.message")) kind = "message"; } catch { /* counted as other */ }
  frames.push({ t: Date.now(), kind, chars, extra });
}));
const visible = (locator) => locator.filter({ visible: true }).first();
const button = (name) => visible(page.getByRole("button", { name, exact: true }));
const field = (label) => visible(page.getByLabel(label, { exact: true }));
const pairOffer = (await setup.call("jagentchill.pairing.offer.create", { role: "admin" })).url;
await page.goto(`${base}/home`, { waitUntil: "networkidle" });
await button("Connect").click();
await field("Pairing link").fill(pairOffer);
await field("Name of this device").fill("Stream browser");
await visible(page.getByRole("button", { name: "Continue" })).click();
await visible(page.getByText(/Enter the code shown next to [0-9a-f]{8}/)).waitFor();
for (let wait = 0; wait < 50 && !codes.has("Stream browser"); wait++) await page.waitForTimeout(100);
await field("Verification code").fill(codes.get("Stream browser"));
await visible(page.getByText("Connected", { exact: true })).waitFor();
await visible(page.getByRole("link", { name: "Sessions" }).or(page.getByRole("button", { name: "Sessions", exact: true }))).click();
await page.waitForURL(/\/h\/[^/]+\/sessions/, { timeout: 60_000 });
const hostId = /\/h\/([^/]+)\/sessions/.exec(page.url())[1];
await page.goto(`${base}/h/${hostId}/sessions/${encodeURIComponent(session.sessionKey)}`, { waitUntil: "networkidle" });
const pane = visible(page.getByTestId("chat-pane"));
await pane.waitFor({ timeout: 60_000 });
await visible(pane.getByLabel("Message", { exact: true })).fill("In about 150 words, explain what a J-cut is in video editing and when an editor would choose it. No tools, plain text.");
// What is painted, once per frame: the length of the answer, the status line, the thinking block.
await page.evaluate(() => {
  const w = window; w.__samples = []; let last = "";
  const tick = () => {
    const answers = [...document.querySelectorAll('[data-testid="chat-pane"] [data-testid="assistant-message"]')];
    const status = [...document.querySelectorAll('[data-testid="chat-pane"] [data-testid="status-line"], [data-testid="chat-pane"] [data-testid="thinking-line"]')].map((node) => node.textContent).join("|");
    const thought = [...document.querySelectorAll('[data-testid="chat-pane"] [data-testid="reasoning-block"]')].map((node) => node.textContent.length).join(",");
    const sample = { len: answers.length ? answers[answers.length - 1].textContent.length : 0, status, thought }, key = JSON.stringify(sample);
    if (key !== last) { last = key; w.__samples.push({ t: Date.now(), ...sample }); }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
const t0 = Date.now();
await visible(pane.getByRole("button", { name: "Send", exact: true })).click();
for (let wait = 0; wait < 240 && !frames.some((frame) => /^stream:(final|error|aborted)$/.test(frame.kind)); wait++) await page.waitForTimeout(500);
await page.waitForTimeout(1500);
const samples = await page.evaluate(() => window.__samples);
if (shot) await page.screenshot({ path: shot });
await browser.close(); setup.close();

const rel = (t) => t - t0;
const read = (file) => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []);
const span = (list) => (list.length ? { n: list.length, first_ms: rel(list[0].t), last_ms: rel(list[list.length - 1].t), chars: list.reduce((sum, entry) => sum + (entry.chars ?? 0), 0) } : { n: 0 });
const cli = read(teeFile).filter((entry) => entry.t >= t0), relay = read(traceFile).filter((entry) => entry.t >= t0);
const report = {
  cli: { firstRecord_ms: cli.length ? rel(cli[0].t) : null, thinking: span(cli.filter((entry) => entry.delta === "thinking_delta")), text: span(cli.filter((entry) => entry.delta === "text_delta")), result_ms: rel(cli.find((entry) => entry.type === "result")?.t ?? NaN), blocks: cli.filter((entry) => entry.block).map((entry) => `${entry.block}@${rel(entry.t)}`) },
  relay: { firstEvent_ms: relay.length ? rel(relay[0].t) : null, agentStreams: Object.fromEntries([...new Set(relay.filter((entry) => entry.event === "agent").map((entry) => entry.stream))].map((stream) => [stream, span(relay.filter((entry) => entry.event === "agent" && entry.stream === stream))])), textDeltas: span(relay.filter((entry) => entry.event === "chat" && entry.state === "delta")), final_ms: rel(relay.find((entry) => entry.event === "chat" && entry.state === "final")?.t ?? NaN) },
  browser: { textDeltas: span(frames.filter((frame) => frame.kind === "stream:delta")), activity: Object.fromEntries([...new Set(frames.filter((frame) => frame.kind.startsWith("activity:")).map((frame) => frame.kind))].map((kind) => [kind, span(frames.filter((frame) => frame.kind === kind))])), final_ms: rel(frames.find((frame) => frame.kind === "stream:final")?.t ?? NaN) },
};
// How far the painted text is behind what has reached the browser: for each increment, when the screen showed that much.
let arrived = 0; const lags = [];
for (const frame of frames.filter((entry) => entry.kind === "stream:delta")) { arrived += frame.chars; const painted = samples.find((sample) => sample.t >= frame.t - 20 && sample.len >= arrived * 0.97); if (painted) lags.push(painted.t - frame.t); }
const texted = samples.filter((sample) => sample.len > 0);
report.painted = { firstText_ms: texted.length ? rel(texted[0].t) : null, lastGrowth_ms: texted.length ? rel(texted[texted.length - 1].t) : null, steps: texted.length, lag_ms: lags.length ? { mean: Math.round(lags.reduce((a, b) => a + b, 0) / lags.length), max: Math.max(...lags) } : null,
  status: samples.filter((sample, index) => index === 0 || sample.status !== samples[index - 1].status).map((sample) => `${rel(sample.t)}:${sample.status || "-"}`).slice(0, 40), thought: samples.filter((sample, index) => sample.thought && (index === 0 || sample.thought !== samples[index - 1].thought)).length };
console.log(JSON.stringify(report, null, 1));
console.log("cli text (ms:chars):", cli.filter((entry) => entry.delta === "text_delta").map((entry) => `${rel(entry.t)}:${entry.chars}`).join(" ").slice(0, 700));
console.log("relay text (ms:chars):", relay.filter((entry) => entry.event === "chat" && entry.state === "delta").map((entry) => `${rel(entry.t)}:${entry.chars}`).join(" ").slice(0, 700));
console.log("painted (ms:len):", texted.map((sample) => `${rel(sample.t)}:${sample.len}`).join(" ").slice(0, 900));
process.exit(0);
