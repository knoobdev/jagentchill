import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseURL = process.env.JAGENTCHILL_E2E_URL;
assert.ok(baseURL, "Set JAGENTCHILL_E2E_URL to the local web build served for this test");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 840 }, colorScheme: "light" });
  page.on("pageerror", (error) => console.error("browser page error:", error.message));
  await page.addInitScript(() => {
    const namespace = (name) => new Proxy({}, {
      get(_target, property) {
        if (property === "platform" && name === "app") return "darwin";
        if (property === "version" && name === "app") return "0.0.0";
        return (..._args) => String(property).startsWith("on") ? () => {} : Promise.resolve(null);
      },
    });
    const bridge = {
      version: 1,
      connectionMode: { get: async () => null, set: async (mode) => { window.__chosenConnectionMode = mode; } },
      tailnet: { startLogin: async () => ({ loginUrl: "https://login.tailscale.com" }), getStatus: async () => ({ state: "needs-sign-in" }) },
      policy: { devToolsDisabled: false, appMenuInWindow: false },
    };
    window.jagentchillDesktop = new Proxy(bridge, {
      get(target, property) {
        if (property in target) return target[property];
        return namespace(String(property));
      },
    });
  });
  await page.goto(baseURL, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Join your tailnet" }).waitFor();
  await page.getByText("Tailscale (default)", { exact: true }).waitFor();
  await page.getByText("Local", { exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/");
  await page.screenshot({ path: ".dev/evidence/w8-b1-first-launch-light.png", fullPage: true });

  await page.getByText("Local", { exact: true }).last().click();
  await page.getByText("Use the local JAgentChill host on this computer.").waitFor();
  await page.screenshot({ path: ".dev/evidence/w8-b1-first-launch-local-light.png", fullPage: true });
  await page.getByTestId("continue-local").click();
  await page.waitForFunction(() => window.__chosenConnectionMode === "local");
  assert.equal(await page.evaluate(() => window.__chosenConnectionMode), "local");
  console.log("PASS connection-mode-b: first-launch gate → both choices → Local persisted (1 path, 4 assertions)");
} finally {
  await browser.close();
}
