// Devices has ONE content and two ways in, on the PRODUCTION web build:
//  · Settings ▸ Connections and devices opens it INSIDE Settings (the Settings navigation stays, Back stays in Settings);
//  · the sidebar's Devices row opens the Devices screen in the main area and puts no device list into the sidebar.
// Deep links keep working: /devices, /devices?pair=1, /pair/start. No host: a fresh browser profile, nothing mocked.
// Usage: node apps/app/e2e/devices-nav.mjs [screenshot-dir] [base-url]
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const shots = process.argv[2] ?? ".dev/shots/w7-shell/devices";
const base = process.argv[3] ?? "http://localhost:8083";
mkdirSync(shots, { recursive: true });
const browser = await chromium.launch();
const errors = [], results = [];
const expect = (condition, message) => { if (!condition) throw new Error(message); };

async function run(label, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  const visible = (locator) => locator.filter({ visible: true }).first();
  const tid = (id) => visible(page.getByTestId(id));
  const shown = (id) => page.getByTestId(id).filter({ visible: true }).count();
  const path = () => new URL(page.url()).pathname;
  const step = async (name, body) => {
    try { await body(); console.log("ok  ", `[${label}]`, name); results.push("ok"); }
    catch (err) { console.log("FAIL", `[${label}]`, name, "—", String(err).split("\n")[0]); errors.push(`step failed: [${label}] ${name}`); results.push("FAIL"); await page.screenshot({ path: `${shots}/${label}-failure-${results.length}.png` }); }
  };
  const compact = viewport.width < 700;

  await step("Settings ▸ Connections and devices opens inside Settings", async () => {
    await page.goto(`${base}/settings`, { waitUntil: "networkidle", timeout: 180_000 });
    await visible(page.getByText("Connections and devices", { exact: true })).click({ timeout: 60_000 });
    await page.waitForTimeout(900);
    expect(path() === "/settings/devices", `the address is ${path()}`);
    await tid("devices-content").waitFor({ timeout: 20_000 });
    if (!compact) expect((await shown("settings-nav")) === 1 && (await shown("sidebar")) === 0, "the Settings navigation is still there, the app sidebar is not");
    if (!compact) expect((await tid("settings-devices").getAttribute("aria-current")) === "page", "its row is the selected one in the Settings navigation");
    expect(await visible(page.getByRole("heading", { level: 1, name: "Connections and devices" })).count(), "the page's title");
    expect(await visible(page.getByText("Hosts paired with this device", { exact: true })).count(), "the same content as the Devices screen");
    await page.screenshot({ path: `${shots}/${label}-settings-devices.png` });
  });
  await step("Back stays in Settings", async () => {
    await page.goBack(); await page.waitForTimeout(700);
    expect(path() === "/settings", `back went to ${path()}`);
    await page.goForward(); await page.waitForTimeout(700);
    expect(path() === "/settings/devices", `forward went to ${path()}`);
    if (!compact) { await tid("settings-general").click(); await page.waitForTimeout(600); expect(path() === "/settings/general", `another settings page: ${path()}`); await tid("settings-devices").click(); await page.waitForTimeout(600); expect(path() === "/settings/devices", `and back: ${path()}`); }
  });
  await step("The sidebar's Devices row opens the Devices screen in the main area; the sidebar holds no device list", async () => {
    await page.goto(`${base}/projects`, { waitUntil: "networkidle" });
    if (compact) { await visible(page.getByRole("button", { name: "Open navigation", exact: true })).click(); await page.waitForTimeout(600); await visible(page.getByTestId("drawer").getByText("Menu", { exact: true })).click(); await page.waitForTimeout(300); }
    await tid("nav-devices").click(); await page.waitForTimeout(900);
    expect(path() === "/devices", `the address is ${path()}`);
    await tid("devices-content").waitFor({ timeout: 20_000 });
    expect(await visible(page.getByRole("heading", { level: 1, name: "Devices" })).count(), "the page's title");
    expect((await shown("settings-nav")) === 0, "not inside Settings");
    if (!compact) {
      expect((await shown("sidebar")) === 1, "the app sidebar is there");
      const inside = await page.evaluate(() => { const sidebar = document.querySelector('[data-testid="sidebar"]'), content = document.querySelector('[data-testid="devices-content"]'); return { contentInSidebar: Boolean(sidebar?.contains(content)), sidebarText: sidebar?.innerText ?? "" }; });
      expect(!inside.contentInSidebar, "the content is in the main area");
      // "This device" is once in the sidebar — the host switcher at its top. The old device list added a row with that title and that meta under the navigation.
      expect((inside.sidebarText.match(/This device/g) ?? []).length === 1, `the sidebar lists no device: “${inside.sidebarText.replace(/\s+/g, " ").slice(0, 160)}”`);
      expect((await tid("nav-devices").getAttribute("aria-current")) === "page", "the Devices row is the selected one");
    }
    await page.screenshot({ path: `${shots}/${label}-devices.png` });
  });
  await step("Deep links: /devices, /devices?pair=1, /settings/devices and the pairing route", async () => {
    for (const [url, id] of [["/devices", "devices-content"], ["/devices?pair=1", "devices-content"], ["/settings/devices", "devices-content"]]) {
      await page.goto(`${base}${url}`, { waitUntil: "networkidle" });
      await tid(id).waitFor({ timeout: 20_000 });
    }
    await page.goto(`${base}/devices?connect=1`, { waitUntil: "networkidle" }); await page.waitForTimeout(800);
    expect(path() === "/pair/start", `?connect=1 goes to the pairing flow: ${path()}`);
    await page.goto(`${base}/pair/start`, { waitUntil: "networkidle" });
    expect(path() === "/pair/start" && !(await page.getByText("Page not found").count()), "the pairing route");
  });
  await context.close();
}
await run("wide", { width: 1440, height: 900 });
await run("390", { width: 390, height: 844 });
await browser.close();
console.log(`\n${results.filter((state) => state === "ok").length}/${results.length} steps ok`);
if (errors.length) { console.log("errors:\n" + [...new Set(errors)].slice(0, 12).join("\n")); process.exit(1); }
