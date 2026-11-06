// Two real browser profiles exercise a host sync conflict through the app UI and assert its inbox feed.
// Usage: JAGENTCHILL_PORT=18995 JAGENTCHILL_GATEWAY_PORT=18996 node apps/app/e2e/notifications-sync.mjs --port 18995 --data-dir .dev/run-w7k-shell-N/data <shots> [base]
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { encodeOfferUrl } from "@jagentchill/protocol";
import { ensureFixtures, fixturePath } from "../../../packages/media/test/support/fixtures.ts";
import { createHarness, SAMPLE_MODELS } from "../../../server/test/harness.ts";

const arg = (name) => { const at = process.argv.indexOf(name); return at < 0 ? undefined : process.argv[at + 1]; };
const port = Number(arg("--port")), dataDir = arg("--data-dir");
const positionals = process.argv.slice(2).filter((value, index, all) => !["--port", "--data-dir"].includes(all[index - 1]) && !["--port", "--data-dir"].includes(value) && !/^\d+$/.test(value));
const shots = positionals[0] ?? ".dev/shots/w7-shell/notifications-sync";
const base = positionals[1]?.startsWith("http") ? positionals[1] : "http://localhost:8083";
if (!Number.isInteger(port) || port < 18995 || port > 18999 || Number(process.env.JAGENTCHILL_PORT) !== port || Number(process.env.JAGENTCHILL_GATEWAY_PORT) !== port + 1 || !dataDir?.startsWith(".dev/run-w7k-shell-")) throw new Error("Pass an owned W7-K port, matching environment, and fresh run directory.");
mkdirSync(shots, { recursive: true });
ensureFixtures(["h264-aac.mp4"]);
const h = await createHarness({ dataDir: `${process.cwd()}/${dataDir}`, listenPort: port, allowedOrigins: [new URL(base).origin], models: SAMPLE_MODELS, connected: ["acme"] });
const browser = await chromium.launch(), errors = [];
const contexts = [];
const step = async (name, run) => { await run(); console.log(`ok  ${name}`); };
const expect = (condition, message) => { if (!condition) throw new Error(message); };
const waitFor = async (read, test, message, page) => { for (let i = 0; i < 180; i++) { const value = await read(); if (test(value)) return value; await page.waitForTimeout(100); } throw new Error(`${message}: ${JSON.stringify(await read())}`); };
async function device(name) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" }); contexts.push(context);
  await context.addInitScript(() => { class Recorder { static permission = "default"; static requestPermission = async () => "granted"; constructor() {} close() {} } window.Notification = Recorder; });
  const page = await context.newPage(); page.on("pageerror", (error) => errors.push(`${name}: ${error.message}`));
  const visible = (locator) => locator.filter({ visible: true }).first();
  const api = { name, page, context, visible, text: (value, options) => visible(page.getByText(value, options)), button: (value) => visible(page.getByRole("button", { name: value, exact: true })), tid: (id) => visible(page.getByTestId(id)), menu: (value) => visible(page.getByRole("menuitem", { name: value, exact: true })) };
  const offer = encodeOfferUrl(h.app.pairing.createOffer([{ kind: "loopback", url: `ws://127.0.0.1:${port}/jagentchill/v1/ws` }], { firstDeviceIsAdmin: true }));
  await page.goto(`${base}/pair/start`, { waitUntil: "networkidle", timeout: 180_000 });
  await visible(page.getByLabel("Pairing link", { exact: true })).fill(offer);
  await visible(page.getByLabel("Name of this device", { exact: true })).fill(name);
  await api.button("Continue").click();
  await api.text(/Enter the code shown next to [0-9a-f]{8}/).waitFor({ timeout: 60_000 });
  const request = h.app.pairing.pending().find((entry) => entry.deviceName === name);
  if (!request) throw new Error(`pairing request for ${name} not found`);
  await visible(page.getByLabel("Verification code", { exact: true })).fill(request.code);
  await api.text("Connected", { exact: true }).waitFor({ timeout: 60_000 });
  return api;
}
let failure;
try {
  let A, B, projectPath;
  await step("pair two independent browser profiles with one local fake-Gateway host", async () => { A = await device("Sync browser A"); B = await device("Sync browser B"); });
  await step("A creates a project, imports a generated video fixture, and syncs it to the host", async () => {
    await A.page.goto(`${base}/projects`, { waitUntil: "networkidle" });
    await A.button("Create your first project").click();
    await A.page.waitForURL(/\/editor\/[0-9a-f-]{36}$/); projectPath = new URL(A.page.url()).pathname;
    await A.tid("timeline").waitFor({ timeout: 60_000 });
    const chooser = A.page.waitForEvent("filechooser"); await A.button("Import").click(); await A.menu("Import files…").click(); await (await chooser).setFiles(fixturePath("h264-aac.mp4"));
    await A.tid("label-h264-aac.mp4").waitFor({ timeout: 60_000 });
    await waitFor(async () => await A.tid("sync-status").textContent().catch(() => ""), (state) => /Synced|Syncing/.test(state), "project began syncing", A.page);
  });
  await step("B opens the synced project and receives A's source media", async () => {
    await B.page.goto(`${base}/projects`, { waitUntil: "networkidle" });
    await B.tid("host-projects").waitFor({ timeout: 60_000 });
    await B.button("Open on this device").click();
    await B.page.waitForURL(/\/editor\/[0-9a-f-]{36}$/); expect(new URL(B.page.url()).pathname === projectPath, "B opened the same synced project");
    await B.tid("timeline").waitFor({ timeout: 60_000 });
    await B.tid("label-h264-aac.mp4").waitFor({ timeout: 90_000 });
    await A.tid("thumb-h264-aac.mp4").dblclick(); await A.page.waitForFunction(() => document.querySelectorAll('[data-testid="track-main-video"] [data-testid^="clip-"]').length === 1, null, { timeout: 30_000 });
    await B.page.waitForFunction(() => document.querySelectorAll('[data-testid="track-main-video"] [data-testid^="clip-"]').length === 1, null, { timeout: 30_000 });
    await A.tid("sync-status").click(); await A.tid("sync-activity").waitFor();
    await A.tid("sync-transfer-picker").getByText("Sync browser B").waitFor({ timeout: 15_000 });
    await A.tid("sync-transfer-to").click();
    await B.text("Sync browser A wants to transfer editing to this device").waitFor({ timeout: 15_000 });
    await B.button("Start editing").click();
    await A.text("Sync browser B is editing this project").waitFor({ timeout: 15_000 });
  });
  await step("B edits offline while A takes over and makes a conflicting host edit", async () => {
    await B.context.setOffline(true);
    await B.tid("label-h264-aac.mp4").dblclick();
    await B.page.waitForFunction(() => document.querySelectorAll('[data-testid="track-main-video"] [data-testid^="clip-"]').length === 2, null, { timeout: 30_000 });
    await A.tid("sync-take-over").click({ timeout: 40_000 });
    await A.tid("sync-force-confirm").click();
    await A.page.waitForFunction(() => document.querySelector('[data-testid="sync-banner"]') === null, null, { timeout: 20_000 });
    await A.tid("thumb-h264-aac.mp4").dblclick(); await A.tid("thumb-h264-aac.mp4").dblclick();
    await A.page.waitForFunction(() => document.querySelectorAll('[data-testid="track-main-video"] [data-testid^="clip-"]').length === 3, null, { timeout: 30_000 });
    await B.context.setOffline(false);
    await B.page.waitForFunction(() => /Sync paused — conflict/.test(document.querySelector('[data-testid="sync-status"]')?.textContent ?? ""), null, { timeout: 60_000 });
  });
  await step("the conflict reaches B's notification centre with an editor route", async () => {
    await B.button("Notifications").click(); await B.tid("inbox").waitFor();
    await B.tid("inbox").getByText(/changed here and on another device/, { exact: false }).waitFor({ timeout: 15_000 });
    const entry = B.visible(B.tid("inbox-entry-link").filter({ hasText: "changed here and on another device" }));
    await entry.click(); await B.page.waitForURL(`**${projectPath}`);
    await B.page.screenshot({ path: `${shots}/sync-conflict-centre.png` });
  });
} catch (error) { failure = error; const page = contexts[1]?.pages()[0]; if (page) await page.screenshot({ path: `${shots}/failure.png` }).catch(() => undefined); }
finally { for (const context of contexts) await context.close(); await browser.close(); await h.stop(); }
if (failure || errors.length) { console.error(failure ? String(failure).split("\n")[0] : errors.join("\n")); process.exitCode = 1; }
else console.log("5/5 steps ok; content: two independent browser profiles and a generated ffmpeg media fixture through a fake Gateway host; no model, provider, CLI or OS notification ran.");
