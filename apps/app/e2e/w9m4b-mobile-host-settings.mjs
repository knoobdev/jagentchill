// Browser-only phone check for host-backed M4 pages. Pairing uses a fresh local test host and no provider/model calls.
// Usage: node apps/app/e2e/w9m4b-mobile-host-settings.mjs <shots-dir> <base-url> <fixture-run-dir>
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";

const [shots, base, fixtureDir] = process.argv.slice(2);
if (!shots || !base || !fixtureDir) throw new Error("Pass screenshot directory, explicit local web URL, and fixture run directory.");
mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light", isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const check = (condition, message) => assert.ok(condition, message);
const shot = async (name, fullPage = true) => {
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${shots}/${name}-browser-only.png`, fullPage });
};
const noOverflow = async () => {
  const sizes = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  assert.ok(sizes.content <= sizes.viewport, `horizontal overflow ${sizes.content - sizes.viewport}px`);
};
const localOffer = readFileSync(`${fixtureDir}/offer.txt`, "utf8").trim();
const offer = new URL(localOffer).hash.split("offer=")[1];
const hostId = JSON.parse(Buffer.from(offer, "base64url").toString("utf8")).gatewayId;
let assertions = 0;
const assertVisible = async (locator, label) => { await locator.waitFor({ state: "visible", timeout: 30_000 }); assertions++; console.log(`assert ${assertions}: ${label}`); };

try {
  // The browser device pairs through the normal Paste pairing link → verification code path.
  await page.goto(`${base}/pair/start?offer=${encodeURIComponent(offer)}`, { waitUntil: "domcontentloaded" });
  await assertVisible(page.getByLabel("Pairing link", { exact: true }), "pairing link field visible");
  console.log("pair link populated", (await page.getByLabel("Pairing link", { exact: true }).inputValue()).length > 40);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const codeInput = page.getByTestId("pairing-verification-code");
  try { await page.getByRole("button", { name: "Verification code", exact: true }).waitFor({ state: "visible", timeout: 8_000 }); }
  catch { console.log("pairing state after Continue:", (await page.locator("body").innerText()).slice(-1600)); await page.screenshot({ path: `${shots}/pairing-debug.png`, fullPage: true }); throw new Error("Pairing did not advance to the verification-code step."); }
  assertions++; console.log(`assert ${assertions}: verification code cells visible`);
  await codeInput.waitFor({ state: "attached", timeout: 30_000 });
  let code;
  for (let attempt = 0; attempt < 60 && !code; attempt++) {
    if (existsSync(`${fixtureDir}/codes.json`)) code = Object.values(JSON.parse(readFileSync(`${fixtureDir}/codes.json`, "utf8"))).at(-1);
    if (!code) await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.match(code ?? "", /^\d{6}$/, "fresh local host produced a six-digit pairing code");
  await codeInput.fill(code);
  await page.waitForURL(/\/(home|welcome)$/, { timeout: 30_000 });
  await page.goto(`${base}/settings/host/${hostId}/connections`, { waitUntil: "networkidle", timeout: 60_000 });
  await assertVisible(page.getByRole("heading", { name: "Connections and devices", exact: true }), "combined Host Connections and devices page visible");
  const connectionRow = page.locator('[data-testid^="host-connection-"]').first();
  await assertVisible(connectionRow, "saved connection row visible");
  await assertVisible(page.getByRole("button", { name: "Copy address", exact: true }), "Copy address control visible");
  await assertVisible(page.getByRole("heading", { name: "Devices", exact: true }), "Devices section visible");
  await assertVisible(page.getByText("Connected via", { exact: true }).first(), "device connection-path label visible");
  await assertVisible(page.getByRole("button", { name: "Pair a device", exact: true }), "Pair a device control visible");
  await noOverflow();
  await shot("item1-connections-and-devices-390");
  await page.getByRole("button", { name: "Pair a device", exact: true }).click();
  await assertVisible(page.getByText("Host fingerprint", { exact: true }), "pairing sheet fingerprint field visible");
  await assertVisible(page.getByText("Role for the new device", { exact: true }), "pairing sheet role field visible");
  await noOverflow();
  await shot("item1-pair-device-sheet-390", false);
  await page.getByText("Role for the new device", { exact: true }).scrollIntoViewIfNeeded();
  for (const label of ["Host fingerprint", "Role for the new device"]) {
    const item = page.getByText(label, { exact: true }).first();
    const bounds = await item.boundingBox();
    const viewport = page.viewportSize();
    assert.ok(bounds && viewport && bounds.y >= 0 && bounds.y + bounds.height <= viewport.height, `${label} is reachable in the scrollable pairing sheet`);
    assertions++;
  }
  await noOverflow();
  await shot("item1-pair-device-sheet-details-390", false);
  await page.keyboard.press("Escape");

  // Providers cards, the sign-in/key route, its provider choice sheet, and CLI rows.
  await page.goto(`${base}/settings/host/${hostId}/runtimes`, { waitUntil: "networkidle", timeout: 60_000 });
  await assertVisible(page.getByRole("heading", { name: "Providers", exact: true }), "Providers page visible");
  await assertVisible(page.getByRole("button", { name: "Add provider", exact: true }), "Add provider control visible");
  await noOverflow(); await shot("item2-providers-390");
  await page.getByRole("button", { name: "Add provider", exact: true }).click();
  await page.waitForURL(/\/runtimes\/keys$/);
  await assertVisible(page.getByRole("heading", { name: "Providers", exact: true }), "sign-in and API key page visible");
  await assertVisible(page.getByText(/Sign in with your account at the provider/), "sign-in and API key instructions visible");
  await page.waitForTimeout(500);
  await noOverflow(); await shot("item2-sign-in-api-key-390");
  // The web native accessibility tree reports these React Native rows as hidden during route transitions although
  // they render in the captured page; dispatch the row's click handler after confirming it is mounted.
  const provider = page.getByTestId("provider-anthropic").first();
  await provider.waitFor({ state: "attached", timeout: 30_000 });
  await provider.dispatchEvent("click");
  await assertVisible(page.getByRole("dialog"), "provider sign-in/API-key sheet visible");
  await noOverflow(); await shot("item2-provider-choice-sheet-390", false);
  await page.keyboard.press("Escape");
  await page.goto(`${base}/settings/host/${hostId}/runtimes/runtimes`, { waitUntil: "networkidle", timeout: 60_000 });
  await assertVisible(page.getByRole("heading", { name: "Providers", exact: true }), "CLI runtimes page visible");
  await noOverflow(); await shot("item2-cli-runtimes-390");

  // ORC, secrets, usage and limits.
  for (const [slug, title] of [["model-routing", "Model routing (ORC)"], ["secrets", "Secrets"], ["usage", "Usage and limits"], ["usage/limits", "Usage and limits"], ["host-storage", "Storage on host"], ["skills", "Skills"]]) {
    await page.goto(`${base}/settings/host/${hostId}/${slug}`, { waitUntil: "networkidle", timeout: 60_000 });
    await assertVisible(page.getByRole("heading", { name: title, exact: true }), `${title} page visible`);
    if (slug === "usage") {
      const range = page.getByRole("combobox", { name: "Range" });
      await assertVisible(range, "Usage range selector visible");
      assert.match(await range.innerText(), /Last 30 days/, "full Usage range label is visible at compact width");
      assertions++;
    }
    await noOverflow();
    const name = slug.replaceAll("/", "-");
    await shot(`${slug.startsWith("usage/") ? "item3-usage-limits" : slug === "usage" ? "item3-usage" : slug === "model-routing" || slug === "secrets" ? `item3-${name}` : `item4-${name}`}-390`);
  }
  assert.deepEqual(errors, [], `browser page errors: ${errors.join(" | ")}`);
  console.log(`${assertions} visible-control/page assertions; 13 host-page and sheet screenshots at 390×844; horizontal overflow: 0 px; page errors: 0. Content source: live fresh local test host, paired browser device, host runtime discovery and bundled catalogue; no provider sign-in action or model turn.`);
} finally {
  await context.close();
  await browser.close();
}
