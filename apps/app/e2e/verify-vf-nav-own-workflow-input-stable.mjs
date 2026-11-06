// Evidence copy: only port defaults/guards and muted headless launch adapted.
// W7 item 5: a workflow template that reads an unconnected input blocks the run in Problems.
// The workflow is created through the browser; no model or provider is called.
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";
import { pairAdmin } from "../../../server/scripts/live-lib.ts";

const [logFile, shots = ".dev/shots/w7-real-run-findings"] = process.argv.slice(2);
const base = process.env.E2E_BASE ?? "http://localhost:8070";
if (!logFile || Number(process.env.JAGENTCHILL_PORT) !== 19010 || Number(process.env.JAGENTCHILL_GATEWAY_PORT) !== 19011 || base !== "http://localhost:8070") throw new Error("Set the W7 host and web ports before running this browser test.");
mkdirSync(shots, { recursive: true });
const offer = /jagentchill:\/\/pair#offer=[A-Za-z0-9_-]+/.exec(readFileSync(logFile, "utf8"))?.[0];
if (!offer) throw new Error("The fresh host log has no pairing offer.");
const setup = await pairAdmin(offer, logFile, "Workflow input test");
const codes = new Map();
setup.on((event, payload) => { if (event === "jagentchill.pairing.requested") codes.set(payload.request.deviceName, payload.code); });
const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
const page = await context.newPage();
page.on("pageerror", (error) => { throw error; });
const visible = (locator) => locator.filter({ visible: true }).first();
const tid = (id) => visible(page.getByTestId(id));
const text = (value, options) => visible(page.getByText(value, options));
const button = (name) => visible(page.getByRole("button", { name, exact: true }));
const field = (name) => visible(page.getByLabel(name, { exact: true }));
let assertions = 0;
const check = (ok, message) => { assertions++; if (!ok) throw new Error(message); };
const center = async (id) => { const box = await tid(id).boundingBox(); if (!box) throw new Error(`${id} is not visible`); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; };
const drag = async (fromId, toId) => { const from = await center(fromId), to = await center(toId); await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 8 }); await page.mouse.move(to.x, to.y, { steps: 8 }); await page.mouse.up(); };
try {
  const pairingOffer = (await setup.call("jagentchill.pairing.offer.create", { role: "admin" })).url;
  await page.goto(`${base}/home`, { waitUntil: "networkidle", timeout: 120_000 });
  await text("What do you want to make?").waitFor({ timeout: 60_000 });
  await button("Connect").click();
  await field("Pairing link").fill(pairingOffer);
  await field("Name of this device").fill("Workflow input browser");
  await button("Continue").click();
  await field("Verification code").waitFor({ timeout: 30_000 });
  for (let i = 0; i < 50 && !codes.has("Workflow input browser"); i++) await page.waitForTimeout(100);
  check(codes.has("Workflow input browser"), "The host issued a pairing code.");
  await field("Verification code").fill(codes.get("Workflow input browser"));
  await text("Connected", { exact: true }).waitFor();
  await visible(page.getByRole("link", { name: "Workflows" }).or(page.getByRole("button", { name: "Workflows" }))).click();
  await page.waitForURL(/\/h\/[^/]+\/workflows$/);
  await tid("workflow-new").click();
  await page.waitForURL(/\/workflows\/[^/]+$/);
  const workflowId = /\/workflows\/([^/?]+)/.exec(page.url())[1];
  await tid("wf-canvas").waitFor();
  await tid("wf-palette-agent").click();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid^="wf-node-"]')].some((node) => node.getClientRects().length));
  await tid("wf-node-name").fill("Editor");
  await page.keyboard.press("Tab");
  await page.waitForTimeout(900);
  const namedDoc = (await setup.call("jagentchill.workflow.get", { workflowId })).document;
  check(namedDoc.nodes.some((node) => node.name === "Editor"), "The Agent step is renamed through its inspector.");
  await drag("wf-port-start-out-done", "wf-port-agent-in-start");
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="wf-canvas"]')].some((node) => node.getClientRects().length && node.getAttribute("data-edges") === "1"));
  const canvas = await tid("wf-canvas").boundingBox();
  if (!canvas) throw new Error("Workflow canvas is not visible.");
  await page.mouse.click(canvas.x + 40, canvas.y + canvas.height - 40);
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="wf-problems"]')].some((node) => node.getClientRects().length));
  const message = "Editor reads its input, but nothing is connected to it";
  await text(message, { exact: true }).waitFor({ timeout: 15_000 });
  const vfReason=(await tid("wf-run-reason").textContent()).trim();
  console.log('OBSERVED item 5 run reason:',JSON.stringify(vfReason));
  await tid('wf-run-reason').getByText('Fix 1 problem to run',{exact:true}).waitFor({timeout:10000});
  check((await tid("wf-run-reason").textContent()).trim() === "Fix 1 problem to run", "The run control shows exactly one blocking problem.");
  check(await tid("wf-run").isDisabled(), "Run is disabled while the template input is missing.");
  check((await tid("wf-problems").textContent()).includes("WORKFLOW_INPUT_MISSING"), "Problems identifies WORKFLOW_INPUT_MISSING.");
  console.log("OBSERVED item 5:", JSON.stringify(await tid("wf-problems").innerText()));
  await page.screenshot({ path: `${shots}/item-5-workflow-unconnected-template-input.png` });

  const agentBox = await tid("wf-node-agent").boundingBox();
  if (!agentBox) throw new Error("Editor node is not visible.");
  await page.mouse.click(agentBox.x + agentBox.width / 2, agentBox.y + 12);
  await tid("wf-agent-prompt").fill("Run the fixed instruction.");
  await page.keyboard.press("Tab");
  const validCanvas = await tid("wf-canvas").boundingBox();
  if (!validCanvas) throw new Error("Workflow canvas is not visible.");
  await page.mouse.click(validCanvas.x + 40, validCanvas.y + validCanvas.height - 40);
  await text("No problems: this workflow can run.", { exact: true }).waitFor({ timeout: 15_000 });
  check((await tid("wf-no-problems").textContent()).trim() === "No problems: this workflow can run.", "A template that no longer reads input is valid.");
  check((await page.getByTestId("wf-run-reason").filter({ visible: true }).count()) === 0, "No validation reason blocks the run.");
  await page.screenshot({ path: `${shots}/item-5-workflow-unused-input-valid.png` });
  console.log(`PASS item 5: ${assertions} explicit assertions; unconnected template input blocks Run and removing that read restores a valid workflow.`);
} catch(error) {
  await page.screenshot({path:`${shots}/failure.png`});console.error("OBSERVED failure screen",(await page.locator("body").innerText()).slice(-2400));throw error;
} finally {
  await browser.close();
  await setup.close?.();
}
