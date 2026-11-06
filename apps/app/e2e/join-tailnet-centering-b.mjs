import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseURL = process.env.JAGENTCHILL_E2E_URL;
assert.ok(baseURL, "Set JAGENTCHILL_E2E_URL to the locally served web export");
const browser = await chromium.launch({ headless: true });
let assertions = 0;
const check = (condition, message) => { assert.ok(condition, message); assertions++; };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
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
      connectionMode: { get: async () => null, set: async () => undefined },
      tailnet: { getStatus: async () => ({ connected: false, host: null, loginUrl: null, port: null, enabled: false, updatedAt: Date.now() }) },
      policy: { devToolsDisabled: true, appMenuInWindow: false },
    };
    window.jagentchillDesktop = new Proxy(bridge, { get(target, property) { return property in target ? target[property] : namespace(String(property)); } });
  });
  await page.goto(baseURL, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Join your tailnet" }).waitFor();
  for (const [width, height, filename] of [[1440, 900, "w8-b5-centered-1440x900.png"], [1000, 700, "w8-b5-centered-1000x700.png"]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(150);
    const geometry = await page.evaluate(() => {
      const rect = document.querySelector('[data-testid="join-tailnet-content"]').getBoundingClientRect();
      return { viewportWidth: window.innerWidth, left: rect.left, width: rect.width, center: rect.left + rect.width / 2 };
    });
    check(geometry.viewportWidth === width, `test viewport is ${width} CSS pixels wide`);
    check(Math.abs(geometry.center - width / 2) <= 1, `Join your tailnet content is centered at ${width}x${height}: ${JSON.stringify(geometry)}`);
    await page.screenshot({ path: `.dev/evidence/${filename}`, fullPage: true });
  }
  console.log(`PASS join-tailnet-centering-b: ${assertions} assertions; Chromium headless, fake desktop bridge`);
} finally {
  await browser.close();
}
