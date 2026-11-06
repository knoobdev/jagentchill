// W7 item 6: a zero-price estimate for an unrouted role still opens Run setup and refuses to start.
// A local workflow fixture produces the warning; the run is never submitted and no model is called.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";
import { workflow as wf } from "@jagentchill/editor-core";
import { pairAdmin } from "../../../server/scripts/live-lib.ts";

const [runDir, shots = ".dev/shots/w7-real-run-findings"] = process.argv.slice(2);
const base = process.env.E2E_BASE ?? "http://localhost:8088";
const port = Number(process.env.JAGENTCHILL_PORT), gatewayPort = Number(process.env.JAGENTCHILL_GATEWAY_PORT);
if (!runDir || port !== 18976 || gatewayPort !== 18977 || base !== "http://localhost:8088") throw new Error("Set the isolated W7 host and web ports before running this browser test.");
mkdirSync(shots, { recursive: true });
const logFile = `${runDir}/server.log`;
const offer = /jagentchill:\/\/pair#offer=[A-Za-z0-9_-]+/.exec(readFileSync(logFile, "utf8"))?.[0];
assert.ok(offer, "the isolated host printed a pairing offer");
const admin = await pairAdmin(offer, logFile, "W7 item 6 setup");
let browser;
try {
  const { document } = await admin.call("jagentchill.workflow.create", { name: "Unrouted director fixture" });
  const made = wf.makeNode(document, "agent", { x: 400, y: 200 }, "director-step");
  const agent = { ...made, name: "Director", config: { ...made.config, promptTemplate: "Write a short note.", runtime: { mode: "orc", role: "director" } } };
  await admin.call("jagentchill.workflow.apply", { workflowId: document.id, ops: [
    { op: "node.add", node: agent },
    { op: "edge.add", edge: { id: "e1", kind: "control", from: { node: "start", port: "done" }, to: { node: "director-step", port: "start" } } },
  ] });
  const estimate = await admin.call("jagentchill.workflow.run.estimate", { workflowId: document.id, params: {} });
  assert.equal(estimate.estimate.highUsd, 0, "an unrouted role has zero known cost");
  assert.equal(estimate.confirmation.needed, false, "the estimate alone does not ask for cost confirmation");
  assert.deepEqual(estimate.estimate.assumptions, ["Cannot run: no model for director"], "the estimate says why the run cannot start");

  const codes = new Map();
  admin.on((event, payload) => { if (event === "jagentchill.pairing.requested") codes.set(payload.request.deviceName, payload.code); });
  const pairingOffer = (await admin.call("jagentchill.pairing.offer.create", { role: "admin" })).url;
  browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  const page = await context.newPage();
  page.on("pageerror", (error) => { throw error; });
  const visible = (locator) => locator.filter({ visible: true }).first();
  const tid = (id) => visible(page.getByTestId(id));
  const button = (name) => visible(page.getByRole("button", { name, exact: true }));
  const field = (name) => visible(page.getByLabel(name, { exact: true }));
  let assertions = 3;
  await page.goto(`${base}/home`, { waitUntil: "networkidle", timeout: 120_000 });
  await visible(page.getByText("What do you want to make?")).waitFor({ timeout: 60_000 });
  await button("Connect").click();
  await field("Pairing link").fill(pairingOffer);
  await field("Name of this device").fill("W7 item 6 browser");
  await button("Continue").click();
  await field("Verification code").waitFor({ timeout: 30_000 });
  for (let i = 0; i < 50 && !codes.has("W7 item 6 browser"); i++) await page.waitForTimeout(100);
  assert.ok(codes.has("W7 item 6 browser"), "the host issued a pairing code"); assertions++;
  await field("Verification code").fill(codes.get("W7 item 6 browser"));
  await visible(page.getByRole("button", { name: "Workflows", exact: true }).or(page.getByRole("link", { name: "Workflows", exact: true }))).click();
  await page.waitForURL(/\/h\/[^/]+\/workflows$/);
  await tid(`workflow-row-${document.name}`).waitFor({ timeout: 30_000 });
  await tid(`workflow-row-${document.name}`).click();
  await page.waitForURL(/\/workflows\/[^/]+$/);
  await tid("wf-run").waitFor();
  assert.equal(await tid("wf-run").isDisabled(), false, "the valid graph can open Run setup"); assertions++;
  await tid("wf-run").click();
  await tid("run-cannot-run-director").getByText("Cannot run: no model for director", { exact: true }).waitFor({ timeout: 30_000 });
  assert.equal((await tid("run-cannot-run-director").textContent()).trim(), "Cannot run: no model for director", "Run setup tells the person the missing role"); assertions++;
  assert.equal(await button("Run").isDisabled(), true, "Run cannot be submitted without a routed model"); assertions++;
  await page.screenshot({ path: `${shots}/item-6-workflow-unrouted-run-estimate.png` });
  console.log(`PASS item 6: ${assertions} explicit assertions; a zero-dollar estimate names the unrouted director, and Run setup refuses the run.`);
} finally {
  await browser?.close();
  admin.close();
}
