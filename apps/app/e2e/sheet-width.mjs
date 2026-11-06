// The side sheet remembers the width the person gave it across a reload. End-to-end in a real browser against a RUNNING
// server: the browser pairs with the host, opens a skill's details (a SideSheet from the inline-end edge), drags its inner
// edge 120 px, records the width, reloads the page (a fresh module graph), opens the same details again and checks the
// width came back. The width is stored under `jagentchill.ui.sideSheetWidth` in localStorage.
// Usage: node apps/app/e2e/sheet-width.mjs <server-log-file> <base-url> [shots-dir]
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";
import { pairAdmin } from "../../../server/scripts/live-lib.ts";
const [logFile, base = "http://localhost:8081", shots = ".dev/shots/sheet-width"] = process.argv.slice(2);
mkdirSync(shots, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const visible = (locator) => locator.filter({ visible: true }).first();
const setup = await pairAdmin(/jagentchill:\/\/pair#offer=[A-Za-z0-9_-]+/.exec(readFileSync(logFile, "utf8"))[0], logFile, "Host setup");
const codes = new Map();
setup.on((event, payload) => { if (event === "jagentchill.pairing.requested") codes.set(payload.request.deviceName, payload.code); });
const offer = (await setup.call("jagentchill.pairing.offer.create", { role: "admin" })).url;
await page.goto(`${base}/home`, { waitUntil: "networkidle", timeout: 180_000 });
await visible(page.getByText("What do you want to make?")).waitFor({ timeout: 120_000 });
await visible(page.getByRole("button", { name: "Connect", exact: true })).click();
await visible(page.getByLabel("Pairing link")).fill(offer);
await visible(page.getByLabel("Name of this device")).fill("Sheet width browser");
await visible(page.getByRole("button", { name: "Continue" })).click();
await visible(page.getByText(/Enter the code shown next to [0-9a-f]{8}/)).waitFor();
for (let wait = 0; wait < 50 && !codes.has("Sheet width browser"); wait++) await page.waitForTimeout(100);
await visible(page.getByLabel("Verification code")).fill(codes.get("Sheet width browser"));
await visible(page.getByText("Connected", { exact: true })).waitFor();
const hostId = /\(host ([0-9a-f]+)\)/.exec(readFileSync(logFile, "utf8"))[1];
// Opens the first data row's Details side sheet and waits for it to settle.
const openDetails = async () => {
  await page.goto(`${base}/h/${hostId}/skills`, { waitUntil: "networkidle", timeout: 120_000 });
  await visible(page.getByTestId("top-bar")).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(4000);
  const row = visible(page.locator('[role="row"]').nth(1));
  await row.click({ button: "right" }).catch(() => {});
  const details = page.getByRole("menuitem", { name: "Details" });
  if (await details.count()) await visible(details).click(); else await row.click();
  await visible(page.getByTestId("side-sheet")).waitFor({ timeout: 10_000 });
  await page.waitForTimeout(400);
};
const widthOf = async () => Math.round((await visible(page.getByTestId("side-sheet")).boundingBox()).width);
await openDetails();
const before = await widthOf();
// Drag the inner edge 120 px towards the screen (wider) and let go: the width is persisted on release.
const grip = page.getByTestId("side-sheet-grip");
const box = await grip.boundingBox(), y = box.y + 200, x = box.x + box.width / 2;
await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x - 120, y, { steps: 10 }); await page.mouse.up();
await page.waitForTimeout(200);
const chosen = await widthOf();
const stored = await page.evaluate(() => window.localStorage.getItem("jagentchill.ui.sideSheetWidth"));
await page.screenshot({ path: `${shots}/01-resized.png` });
// Reload the page — a fresh module graph — and open the same details again.
await page.reload({ waitUntil: "networkidle", timeout: 120_000 });
await openDetails();
const restored = await widthOf();
await page.screenshot({ path: `${shots}/02-restored.png` });
const ok = chosen === before + 120 && stored === String(chosen) && Math.abs(restored - chosen) <= 1;
console.log(`width start ${before} px → dragged 120 px: ${chosen} px (stored ${stored}) → after reload: ${restored} px`);
console.log(ok ? "SHEET WIDTH OK — the side sheet remembered its width across a reload" : "SHEET WIDTH FAILED");
await browser.close(); setup.close?.();
process.exit(ok ? 0 : 1);
