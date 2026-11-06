// Headless UI check for the workflow panel's Vietnamese Outline label. It pairs to a fresh local host,
// creates an empty workflow through the product UI, and makes no model calls.
// Usage: node apps/app/e2e/vi-outline.mjs <server-log-file> <screenshot-dir> [base-url]
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";
import { pairAdmin } from "../../../server/scripts/live-lib.ts";

const [logFile, shots = ".dev/shots/w7-shell/vi-outline", base = "http://localhost:8083"] = process.argv.slice(2);
mkdirSync(shots, { recursive: true });
const firstOffer = /jagentchill:\/\/pair#offer=[A-Za-z0-9_-]+/.exec(readFileSync(logFile, "utf8"))?.[0];
if (!firstOffer) throw new Error("The server did not print its first pairing offer");
const setup = await pairAdmin(firstOffer, logFile, "Host setup");
const codes = new Map();
setup.on((event, payload) => { if (event === "jagentchill.pairing.requested") codes.set(payload.request.deviceName, payload.code); });
const offer = (await setup.call("jagentchill.pairing.offer.create", { role: "admin" })).url;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const button = (name) => page.getByRole("button", { name, exact: true }).filter({ visible: true }).first();
  const field = (name) => page.getByLabel(name, { exact: true }).filter({ visible: true }).first();
  await page.goto(`${base}/home`, { waitUntil: "networkidle", timeout: 180_000 });
  await button("Connect").waitFor({ timeout: 60_000 });
  await button("Connect").click();
  await field("Pairing link").fill(offer);
  await field("Name of this device").fill("Studio browser");
  await button("Continue").click();
  await page.getByLabel("Verification code").waitFor({ timeout: 30_000 });
  for (let i = 0; i < 50 && !codes.has("Studio browser"); i++) await page.waitForTimeout(100);
  if (!codes.has("Studio browser")) throw new Error("Pairing code did not arrive");
  await field("Verification code").fill(codes.get("Studio browser"));
  await page.getByText("Connected", { exact: true }).waitFor({ timeout: 60_000 });

  await page.goto(`${base}/settings/general`, { waitUntil: "networkidle" });
  const language = page.getByRole("combobox", { name: "Language", exact: true }).filter({ visible: true }).first();
  await language.waitFor({ timeout: 30_000 });
  await language.click();
  await page.getByRole("option", { name: "Tiếng Việt", exact: true }).filter({ visible: true }).click();
  await page.waitForTimeout(300);
  const hostId = setup.offer.gatewayId;
  await page.goto(`${base}/h/${hostId}/workflows`, { waitUntil: "networkidle" });
  await page.getByTestId("workflow-new").filter({ visible: true }).click({ timeout: 60_000 });
  await page.getByTestId("wf-outline").filter({ visible: true }).waitFor({ timeout: 30_000 });
  const label = page.getByText("Dàn bước", { exact: true }).filter({ visible: true });
  await label.waitFor({ timeout: 10_000 });
  await page.screenshot({ path: `${shots}/workflow-outline-vi-wide-light.png` });
  if (errors.length) throw new Error(`Page errors: ${errors.join("; ")}`);
  console.log("PASS 1/1 — workflow outline renders “Dàn bước” in the Vietnamese UI; workflow created through the UI; no model calls");
} finally {
  setup.close();
  await browser.close();
}
