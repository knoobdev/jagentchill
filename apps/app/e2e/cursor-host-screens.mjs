// Finding 23: exercise handles on the workflow and Film Studio screens as well as the local screens in cursors.mjs.
// A local fresh host is used only for pairing and to create empty workflow/film records; no model call is sent.
// Usage: JAGENTCHILL_PORT=<p> E2E_BASE=http://localhost:8088 node apps/app/e2e/cursor-host-screens.mjs <server.log> <shots-dir>
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";
import { pairAdmin } from "../../../server/scripts/live-lib.ts";

const [logFile, shots = ".dev/shots/w7r-f23/cursor-host-screens"] = process.argv.slice(2);
const base = process.env.E2E_BASE ?? "http://localhost:8088";
mkdirSync(shots, { recursive: true });
const offerUrl = /jagentchill:\/\/pair#offer=[A-Za-z0-9_-]+/.exec(readFileSync(logFile, "utf8"))?.[0];
if (!offerUrl) throw new Error("No pairing offer in the fresh test-host log.");
const setup = await pairAdmin(offerUrl, logFile, "Cursor test setup");
const codes = new Map();
setup.on((event, payload) => { if (event === "jagentchill.pairing.requested") codes.set(payload.request.deviceName, payload.code); });
const browserOffer = (await setup.call("jagentchill.pairing.offer.create", { role: "admin" })).url;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 980 }, colorScheme: "light" });
const page = await context.newPage(), results = [];
const visible = (locator) => locator.filter({ visible: true }).first();
const tid = (id) => visible(page.getByTestId(id));
const expect = (condition, message) => { if (!condition) throw new Error(message); };
const checkMarkedHandles = async (screen) => {
  const result = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll("[data-draghandle]")].filter((node) => node.getClientRects().length);
    return { count: nodes.length, wrong: nodes.filter((node) => { const want = node.getAttribute("data-draghandle"); return want && getComputedStyle(node).cursor !== want; }).map((node) => `${node.getAttribute("data-testid") ?? node.getAttribute("aria-label") ?? node.tagName}: ${getComputedStyle(node).cursor} ≠ ${node.getAttribute("data-draghandle")}`) };
  });
  expect(result.count > 0, `${screen}: no visible marked handle was exercised`);
  expect(result.wrong.length === 0, `${screen}: ${result.wrong.join("; ")}`);
  console.log(`ok   ${screen}: ${result.count}/${result.count} visible marked handles match`);
  results.push([screen, result.count]);
};
try {
  await page.goto(`${base}/home`, { waitUntil: "networkidle", timeout: 180_000 });
  await visible(page.getByText("What do you want to make?")).waitFor({ timeout: 90_000 });
  await visible(page.getByRole("button", { name: "Connect", exact: true })).click();
  await visible(page.getByLabel("Pairing link", { exact: true })).fill(browserOffer);
  await visible(page.getByLabel("Name of this device", { exact: true })).fill("Cursor test browser");
  await visible(page.getByRole("button", { name: "Continue" })).click();
  await visible(page.getByText(/Enter the code shown next to [0-9a-f]{8}/)).waitFor({ timeout: 30_000 });
  for (let wait = 0; wait < 50 && !codes.has("Cursor test browser"); wait++) await page.waitForTimeout(100);
  const code = codes.get("Cursor test browser");
  expect(code, "the host produced the test browser's pairing code");
  await visible(page.getByLabel("Verification code", { exact: true })).fill(code);
  await visible(page.getByText("Connected", { exact: true })).waitFor({ timeout: 30_000 });

  const hostId = setup.offer.gatewayId;
  await page.goto(`${base}/h/${hostId}/workflows`, { waitUntil: "networkidle" });
  await tid("workflow-new").waitFor({ timeout: 60_000 });
  await tid("workflow-new").click();
  await page.waitForURL(/\/workflows\/[^/?]+$/);
  await tid("wf-canvas").waitFor({ timeout: 60_000 });
  await page.waitForTimeout(300);
  await checkMarkedHandles("Workflow editor");
  await page.screenshot({ path: `${shots}/workflow-editor-handles.png` });

  await page.goto(`${base}/h/${hostId}/film`, { waitUntil: "networkidle" });
  await tid("film-new").waitFor({ timeout: 60_000 });
  await tid("film-new").click();
  await tid("film-tabs").waitFor({ timeout: 60_000 });
  await tid("film-write-ai").click();
  await tid("film-agent-panel").waitFor({ timeout: 30_000 });
  await tid("film-agent-splitter").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(300);
  await checkMarkedHandles("Film Studio");
  await page.screenshot({ path: `${shots}/film-studio-handles.png` });
  expect(results.length === 2, `two host-backed screens checked: ${JSON.stringify(results)}`);
  console.log(`\n${results.map(([screen, count]) => `${screen}=${count}`).join(", ")}`);
} finally {
  await browser.close();
  setup.close();
}
