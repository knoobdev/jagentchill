// Browser-only responsive smoke and screenshots for M4. Library content is the browser's local store; the inbox receives
// synthetic UI rows from this test. No host or model is configured, and no system notification is sent.
// Usage: node apps/app/e2e/m4-mobile-settings.mjs <screenshot-dir> <base-url>
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const [shots, base] = process.argv.slice(2);
if (!shots || !base) throw new Error("Pass a screenshot directory and explicit web URL.");
mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 393, height: 852 }, colorScheme: "light", isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const expect = (condition, message) => { if (!condition) throw new Error(message); };
const visible = (locator) => locator.filter({ visible: true }).first();
const shot = async (name) => page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
const assertNoHorizontalOverflow = async () => {
  const size = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(size.content <= size.viewport, `horizontal overflow ${size.content - size.viewport}px at ${size.viewport}px`);
};
let checkedControls = 0;
let shortestControl = Infinity;
const assertPhoneTargets = async () => {
  const heights = await page.locator("button:visible,[role='button']:visible").evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().height * 100) / 100));
  checkedControls += heights.length;
  shortestControl = Math.min(shortestControl, ...heights);
  const short = heights.filter((height) => height < 44);
  expect(short.length === 0, `phone controls under 44 pt: ${short.join(", ")}`);
};
const pages = [
  ["general", "Preferences"], ["editing", "Editing defaults"], ["storage", "Storage"], ["sync", "Sync"],
  ["notifications", "Notifications"], ["devices", "Connections and devices"], ["updates", "Updates"], ["about", "About"],
];
let passed = 0;
try {
  await page.goto(`${base}/settings`, { waitUntil: "networkidle", timeout: 120_000 });
  for (const [id, title] of pages) {
    if (id !== "general" || !page.url().endsWith("/settings/general")) {
      await visible(page.getByText(title, { exact: true })).click({ timeout: 30_000 });
      await page.waitForURL(new RegExp(`/settings/${id}$`), { timeout: 20_000 });
    }
    await visible(page.getByRole("heading", { name: title, exact: true })).waitFor({ timeout: 30_000 });
    await assertNoHorizontalOverflow();
    await assertPhoneTargets();
    await shot(`settings-${id}-393-light`);
    if (id === "devices") {
      expect(await visible(page.getByTestId("devices-content")).count(), "Connections and devices content is visible");
      expect(await visible(page.getByText("Hosts paired with this device", { exact: true })).count(), "paired-host section is visible");
    }
    if (id === "notifications") expect(await visible(page.getByTestId("notification-settings")).count(), "notification settings controls are visible");
    passed++;
    await visible(page.getByText("Settings", { exact: true })).first().click();
    await page.waitForURL(/\/settings$/);
  }
  await page.goto(`${base}/library/fonts`, { waitUntil: "networkidle", timeout: 120_000 });
  await visible(page.getByTestId("library-screen")).waitFor({ timeout: 30_000 });
  await visible(page.getByTestId("library-toolbar")).waitFor({ timeout: 30_000 });
  await assertNoHorizontalOverflow(); await assertPhoneTargets(); await shot("library-fonts-393-light"); passed++;
  await page.goto(`${base}/library/sounds`, { waitUntil: "networkidle", timeout: 120_000 });
  await visible(page.getByTestId("library-screen")).waitFor({ timeout: 30_000 });
  await assertNoHorizontalOverflow(); await assertPhoneTargets(); await shot("library-sounds-393-light"); passed++;
  const inboxFixture = Array.from({ length: 24 }, (_, index) => ({
    id: `m4-fixture-${String(index + 1).padStart(2, "0")}`, kind: "warning", category: "needs-you",
    subject: `m4-fixture-${index + 1}`, message: `Phone inbox fixture ${String(index + 1).padStart(2, "0")}: review the pending item`,
    route: "/projects", at_ms: Date.now() - index * 60_000, read: false,
  }));
  await page.evaluate((notices) => localStorage.setItem("jagentchill.notifications", JSON.stringify(notices)), inboxFixture);
  await page.goto(`${base}/notifications`, { waitUntil: "networkidle", timeout: 120_000 });
  await visible(page.getByTestId("inbox")).waitFor({ timeout: 30_000 });
  expect(await page.getByTestId("inbox-entry").count() === inboxFixture.length, "all 24 fixture notices render in the inbox");
  const scroll = await page.getByTestId("inbox").evaluate((root) => {
    const candidate = [...root.querySelectorAll("*")].find((node) => {
      const style = getComputedStyle(node);
      return /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight;
    });
    if (!candidate) return null;
    return { clientHeight: candidate.clientHeight, scrollHeight: candidate.scrollHeight, before: candidate.scrollTop };
  });
  expect(scroll !== null && scroll.scrollHeight > scroll.clientHeight, "the phone inbox has a bounded, scrollable list viewport");
  await page.getByTestId("inbox-entry").last().scrollIntoViewIfNeeded();
  await visible(page.getByText("Phone inbox fixture 24: review the pending item", { exact: true })).waitFor({ timeout: 10_000 });
  await assertNoHorizontalOverflow(); await assertPhoneTargets(); await shot("notifications-populated-393-light"); passed++;
  expect(errors.length === 0, `page errors: ${errors.join(" | ")}`);
  console.log(`${passed}/11 screens passed at 393×852 browser touch viewport; 11 screenshots captured; ${checkedControls} visible controls measured, shortest ${shortestControl} pt, none below 44 pt; inbox ${scroll.clientHeight}/${scroll.scrollHeight} pt viewport/content with 24 notices.`);
} finally {
  await context.close();
  await browser.close();
}
