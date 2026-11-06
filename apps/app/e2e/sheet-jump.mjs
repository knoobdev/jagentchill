// A side sheet that slides in must not move the screen behind it. End-to-end in a real browser against a RUNNING server:
// the browser pairs with the host, opens Skills, opens a skill's details (a SideSheet from the inline-end edge) and the
// positions of the screen's own parts are read on every frame while the sheet comes in.
// Usage: node apps/app/e2e/sheet-jump.mjs <server-log-file> <base-url> [shots-dir]
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";
import { pairAdmin } from "../../../server/scripts/live-lib.ts";
const [logFile, base = "http://localhost:8081", shots = ".dev/shots/sheet-jump"] = process.argv.slice(2);
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
await visible(page.getByLabel("Name of this device")).fill("Sheet browser");
await visible(page.getByRole("button", { name: "Continue" })).click();
await visible(page.getByText(/Enter the code shown next to [0-9a-f]{8}/)).waitFor();
for (let wait = 0; wait < 50 && !codes.has("Sheet browser"); wait++) await page.waitForTimeout(100);
await visible(page.getByLabel("Verification code")).fill(codes.get("Sheet browser"));
await visible(page.getByText("Connected", { exact: true })).waitFor();
const hostId = /\(host ([0-9a-f]+)\)/.exec(readFileSync(logFile, "utf8"))[1];
await page.goto(`${base}/h/${hostId}/skills`, { waitUntil: "networkidle", timeout: 120_000 });
await visible(page.getByTestId("top-bar")).waitFor({ timeout: 60_000 });
await page.waitForTimeout(4000);
await page.screenshot({ path: `${shots}/01-skills.png` });
// Watch the screen behind the sheet, frame by frame.
await page.evaluate(() => {
  const parts = ["top-bar", "sidebar"].map((id) => () => document.querySelector(`[data-testid="${id}"]`));
  window.__m = []; let n = 0;
  const tick = () => {
    const lefts = parts.map((get) => { const r = get()?.getBoundingClientRect(); return r ? Math.round(r.left) : null; });
    const scrolled = [...document.querySelectorAll("*")].filter((e) => e.scrollLeft > 0 && !e.closest('[data-testid="side-sheet"]')).map((e) => `${e.getAttribute("data-testid") || e.tagName}:${e.scrollLeft}`).slice(0, 3);
    window.__m.push([lefts, scrolled.join(",")]);
    if (++n < 80) requestAnimationFrame(tick); else window.__done = true;
  };
  window.__done = false; requestAnimationFrame(tick);
});
// The first skill row's menu → Details.
const row = visible(page.locator('[role="row"]').nth(1));
await row.click({ button: "right" }).catch(() => {});
const details = page.getByRole("menuitem", { name: "Details" });
if (await details.count()) await visible(details).click(); else await row.click();
await page.waitForFunction(() => window.__done === true, null, { timeout: 10_000 });
await visible(page.getByTestId("side-sheet")).waitFor({ timeout: 10_000 });
await page.screenshot({ path: `${shots}/02-skill-detail.png` });
const frames = await page.evaluate(() => window.__m);
const first = JSON.stringify(frames[0][0]);
const moved = frames.filter((frame) => JSON.stringify(frame[0]) !== first), scrolled = frames.filter((frame) => frame[1]);
console.log(`frames ${frames.length}; frames where the top bar or the sidebar is not where it started: ${moved.length}; frames with something scrolled sideways: ${scrolled.length}`);
if (moved.length) console.log("  first moved frame:", JSON.stringify(moved[0]));
if (scrolled.length) console.log("  first scrolled frame:", JSON.stringify(scrolled[0]));
// The sheet is resizable by its inner edge: drag it 150 px towards the screen, then far beyond both limits.
const sheet = visible(page.getByTestId("side-sheet")), grip = page.getByTestId("side-sheet-grip");
const widthOf = async () => Math.round((await sheet.boundingBox()).width);
let resized = "no grip";
if (await grip.count()) {
  await page.waitForTimeout(400);
  const before = await widthOf(), box = await grip.boundingBox(), y = box.y + 200, x = box.x + box.width / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x - 150, y, { steps: 10 }); await page.mouse.up();
  const wider = await widthOf();
  const b2 = await grip.boundingBox(); await page.mouse.move(b2.x + 4, y); await page.mouse.down(); await page.mouse.move(b2.x + 900, y, { steps: 10 }); await page.mouse.up();
  // The pointer stops at the window edge, so the lower limit is reached in two drags.
  const b2b = await grip.boundingBox(); await page.mouse.move(b2b.x + 4, y); await page.mouse.down(); await page.mouse.move(b2b.x + 900, y, { steps: 10 }); await page.mouse.up();
  const narrowest = await widthOf();
  const b3 = await grip.boundingBox(); await page.mouse.move(b3.x + 4, y); await page.mouse.down(); await page.mouse.move(0, y, { steps: 10 }); await page.mouse.up();
  const widest = await widthOf();
  resized = `start ${before} px → dragged 150 px: ${wider} px → narrowest ${narrowest} px → widest ${widest} px`;
  await page.screenshot({ path: `${shots}/03-skill-detail-wide.png` });
  var sizeOk = wider === before + 150 && narrowest === 320 && widest === Math.round(1440 * 0.7);
}
console.log("resize:", resized);
const ok = moved.length === 0 && scrolled.length === 0 && (typeof sizeOk === "undefined" ? false : sizeOk);
console.log(ok ? "SHEET OK — the screen behind the sheet never moved, and the sheet resizes within its limits" : "SHEET FAILED");
await browser.close(); setup.close?.();
process.exit(ok ? 0 : 1);
