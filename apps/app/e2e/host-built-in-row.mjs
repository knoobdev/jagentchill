// D.3 desktop host-switcher row check with an isolated bridge stub; this never starts a desktop process.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const shots = process.argv[2] ?? ".dev/shots/w8-host-connect-D";
const base = process.argv[3] ?? "http://127.0.0.1:8089";
mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(() => {
  window.__builtInEnabled = false;
  window.jagentchillDesktop = {
    connectionMode: { get: async () => "local", set: async () => undefined },
    gateway: { setEnabled: async (enabled) => { window.__builtInEnabled = enabled; } },
    notifications: { onActivated: () => () => undefined, permission: async () => "denied", openSystemSettings: async () => undefined, setBadge: async () => undefined },
  };
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
console.log("debug route", page.url(), "page errors", JSON.stringify(errors));
if (!(await page.getByTestId("host-switcher").count())) await page.screenshot({ path: `${shots}/d3-enable-built-in-host-failure.png` });
await page.getByTestId("host-switcher").waitFor({ timeout: 5_000 });
await page.getByTestId("host-switcher").click();
const enable = page.getByText("Enable built-in host", { exact: true });
await enable.waitFor();
await page.waitForTimeout(400);
await page.screenshot({ path: `${shots}/d3-enable-built-in-host.png` });
await enable.click();
await page.waitForFunction(() => window.__builtInEnabled === true, null, { timeout: 10_000 });
assert.deepEqual(errors, []);
console.log(JSON.stringify({ test: "desktop host switcher enable built-in host row", assertions: 2, enabled: true, screenshot: `${shots}/d3-enable-built-in-host.png` }));
await context.close();
await browser.close();
