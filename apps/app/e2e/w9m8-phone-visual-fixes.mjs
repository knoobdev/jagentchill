import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.E2E_BASE;
const runDir = process.env.W9M8_RUN_DIR;
const shots = process.argv[2] ?? ".dev/shots/w9m8-phone-visual-fixes";
if (!base || !runDir) throw new Error("Set E2E_BASE and W9M8_RUN_DIR to this isolated run.");
mkdirSync(shots, { recursive: true });
const offer = readFileSync(`${runDir}/browser-offer.txt`, "utf8");
const gatewayId = JSON.parse(Buffer.from(offer.split("offer=")[1], "base64url").toString("utf8")).gatewayId;
const deviceName = `W9M8 browser ${Date.now()}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, colorScheme: "light" });
page.on("pageerror", (error) => console.error(`PAGEERROR ${error.message}`));
const screenshot = (name) => page.screenshot({ path: `${shots}/${name}.png` });
const waitScreen = async (text) => page.getByText(text, { exact: true }).first().waitFor({ timeout: 30000 });

try {
  await page.goto(`${base}/welcome`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Paste pairing link", exact: true }).click();
  await page.getByLabel("Pairing link", { exact: true }).fill(offer);
  await page.getByLabel("Name of this device", { exact: true }).fill(deviceName);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByTestId("pairing-verification-code").waitFor({ timeout: 30000 });
  let code = "";
  for (let attempt = 0; attempt < 100 && !code; attempt++) {
    try { code = JSON.parse(readFileSync(`${runDir}/browser-codes.json`, "utf8"))[deviceName] ?? ""; } catch { /* event file is not written yet */ }
    if (!code) await page.waitForTimeout(100);
  }
  assert.equal(code.length, 6, "host issues a six-digit code to the browser device");
  await page.getByTestId("pairing-verification-code").fill(code);
  // Pairing success replaces this modal, so trigger the native click without Playwright waiting on the unmount.
  await page.getByRole("button", { name: "Pair", exact: true }).evaluate((button) => button.click());
  await page.waitForTimeout(1500);
  console.log(`After pairing route ${page.url()}`);
  await screenshot("debug-after-pair-browser-393");
  await page.getByTestId("home-page").waitFor({ timeout: 30000 });
  await screenshot("before-home-browser-393");

  await page.goto(`${base}/settings/host/${gatewayId}/host-storage`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Open on this device", exact: true }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Open on this device", exact: true }).click();
  await page.waitForURL(/\/editor\//, { timeout: 30000 });
  await page.goto(`${base}/home`, { waitUntil: "networkidle" });
  await page.getByTestId("home-page").waitFor({ timeout: 30000 });
  await page.locator('[data-testid^="home-recent-project-"]').first().waitFor({ timeout: 30000 });
  await page.getByTestId("home-quick-start-new").click();
  await page.waitForURL(/\/editor\//, { timeout: 30000 });
  await page.goto(`${base}/home`, { waitUntil: "networkidle" });
  await page.locator('[data-testid^="home-recent-project-"]').first().waitFor({ timeout: 30000 });
  await page.getByTestId("project-empty-thumbnail").waitFor({ timeout: 15000 });
  await screenshot("after-home-project-thumbnails-browser-393");
  const mediaTile = page.locator('[data-testid^="home-recent-project-"]').filter({ hasText: "W9 Mobile" }).first();
  const mediaTileImage = await mediaTile.locator("img").count();
  const emptyTile = await page.getByTestId("project-empty-thumbnail").count();
  assert.equal(emptyTile, 1, "an empty project displays the labeled empty state even if it has a black frame cache");
  const scroll = page.getByTestId("home-mobile-scroll");
  await scroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const [checklist, dock] = await Promise.all([
    page.getByText("Make a video from a prompt", { exact: true }).evaluate((element) => element.getBoundingClientRect().bottom),
    page.getByTestId("home-composer-dock").evaluate((element) => element.getBoundingClientRect().top),
  ]);
  assert(checklist <= dock, `Get started last row bottom ${checklist} is above Ask dock top ${dock}`);
  await screenshot("after-home-get-started-browser-393");
  console.log(`HOME thumbnails: media-card images ${mediaTileImage}; empty tiles ${emptyTile}; Get started bottom ${checklist} <= Ask dock top ${dock}`);

  await page.goto(`${base}/host/add-connection`, { waitUntil: "networkidle" });
  await page.getByTestId("add-connection-method-tailscale").waitFor({ timeout: 30000 });
  await screenshot("before-add-connection-browser-393");

  const hostPages = [
    ["runtimes", "Providers"], ["model-routing", "Model routing (ORC)"], ["secrets", "Secrets"],
    ["usage", "Usage and limits"], ["host-storage", "Storage on host"], ["skills", "Skills"],
  ];
  for (const [section, title] of hostPages) {
    await page.goto(`${base}/settings/host/${gatewayId}/${section}`, { waitUntil: "networkidle" });
    await waitScreen(title);
    await screenshot(`before-host-${section}-browser-393`);
  }

  const personalPages = ["general", "editing", "storage", "sync", "notifications", "updates", "about"];
  for (const section of personalPages) {
    await page.goto(`${base}/settings/${section}`, { waitUntil: "networkidle" });
    await screenshot(`before-personal-${section}-browser-393`);
  }

  await page.goto(`${base}/settings/host/${gatewayId}/connections`, { waitUntil: "networkidle" });
  await page.getByTestId("devices-section").scrollIntoViewIfNeeded();
  await page.getByTestId("devices-content").waitFor({ timeout: 30000 });
  await screenshot("before-device-role-browser-393");
  const roleLabel = await page.getByText(/^(admin|Admin)$/).allTextContents();
  assert(roleLabel.includes("Admin"), `Devices role selector displays title-cased Admin; visible values: ${roleLabel.join(",")}`);

  await page.goto(`${base}/home`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /JAgentChill/ }).first().click();
  await page.getByTestId("host-switcher-list").waitFor({ timeout: 10000 });
  await page.getByTestId(`host-disconnect-${gatewayId}`).click();
  await page.getByRole("button", { name: "Disconnect", exact: true }).last().click();
  await page.waitForURL(/\/welcome/, { timeout: 30000 });
  await page.getByText("Connect your computer to get started", { exact: true }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Scan QR code", exact: true }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Paste pairing link", exact: true }).waitFor({ timeout: 30000 });
  await screenshot("after-no-host-connect-browser-393");
  console.log(`PASS after captures at 393 px (browser only); paired host ${gatewayId}; role value ${roleLabel.join(",")}; host removal returns to connect screen`);
} finally {
  await browser.close();
}
