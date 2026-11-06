// Coordinator's audit of the Film Studio fixes, in a real browser against a RUNNING server (no model turn is sent):
// the Story stage fills the width, "Write with AI" only opens the assistant with an EMPTY composer and creates no session,
// and the assistant panel resizes by its inner edge within its limits.
// Usage: node apps/app/e2e/film-audit.mjs <server-log-file> <base-url> [shots-dir]
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";
import { pairAdmin } from "../../../server/scripts/live-lib.ts";
const [logFile, base = "http://localhost:8081", shots = ".dev/shots/film-audit"] = process.argv.slice(2);
mkdirSync(shots, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR", String(e).slice(0, 200)));
const visible = (locator) => locator.filter({ visible: true }).first();
const tid = (id) => visible(page.getByTestId(id));
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? " — " + detail : ""}`); };
const setup = await pairAdmin(/jagentchill:\/\/pair#offer=[A-Za-z0-9_-]+/.exec(readFileSync(logFile, "utf8"))[0], logFile, "Host setup");
const codes = new Map();
setup.on((event, payload) => { if (event === "jagentchill.pairing.requested") codes.set(payload.request.deviceName, payload.code); });
const offer = (await setup.call("jagentchill.pairing.offer.create", { role: "admin" })).url;
await page.goto(`${base}/home`, { waitUntil: "networkidle", timeout: 180_000 });
await visible(page.getByText("What do you want to make?")).waitFor({ timeout: 120_000 });
await visible(page.getByRole("button", { name: "Connect", exact: true })).click();
await visible(page.getByLabel("Pairing link")).fill(offer);
await visible(page.getByLabel("Name of this device")).fill("Film audit");
await visible(page.getByRole("button", { name: "Continue" })).click();
await visible(page.getByText(/Enter the code shown next to [0-9a-f]{8}/)).waitFor();
for (let wait = 0; wait < 50 && !codes.has("Film audit"); wait++) await page.waitForTimeout(100);
await visible(page.getByLabel("Verification code")).fill(codes.get("Film audit"));
await visible(page.getByText("Connected", { exact: true })).waitFor();
const hostId = /\(host ([0-9a-f]+)\)/.exec(readFileSync(logFile, "utf8"))[1];
await page.goto(`${base}/h/${hostId}/film`, { waitUntil: "networkidle", timeout: 120_000 });
await tid("film-new").click({ timeout: 60_000 });
await tid("film-tabs").waitFor({ timeout: 60_000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${shots}/01-story.png` });
// Story fills the width: the widest text field of the stage and what is beside it leave no empty half.
const stage = await page.evaluate(() => { const fields = [...document.querySelectorAll("textarea, input")].filter((el) => el.offsetParent !== null && !el.closest('[data-testid="sidebar"]')).map((el) => el.getBoundingClientRect()); const right = Math.max(0, ...fields.map((r) => r.right)); const left = Math.min(...fields.map((r) => r.left)); return { fields: fields.length, left: Math.round(left), right: Math.round(right), window: innerWidth }; });
check("Story stage: its fields reach across the stage (no empty area beside them)", stage.fields > 0 && stage.window - stage.right < 100, JSON.stringify(stage));
const sessionsBefore = (await setup.call("jagentchill.session.list", {})).sessions.length;
await tid("film-write-ai").click();
await tid("film-agent-panel").waitFor({ timeout: 15_000 });
await page.waitForTimeout(2500);
const composer = visible(tid("film-agent-panel").locator("textarea"));
const text = (await composer.count()) ? await composer.inputValue() : "(no composer)";
const sessionsAfter = (await setup.call("jagentchill.session.list", {})).sessions.length;
check("Write with AI: opens the assistant, composer empty", text === "", `composer=${JSON.stringify(text)}`);
check("Write with AI: creates no session and sends nothing", sessionsAfter === sessionsBefore, `sessions ${sessionsBefore} → ${sessionsAfter}`);
await page.screenshot({ path: `${shots}/02-assistant-open.png` });
// The assistant resizes by its inner edge.
const panel = tid("film-agent-panel"), grip = tid("film-agent-splitter");
const width = async () => Math.round((await panel.boundingBox()).width);
const before = await width(), g = await grip.boundingBox(), p = await panel.boundingBox();
const inward = g.x > p.x + p.width / 2 ? 1 : -1, y = g.y + 300, x = g.x + g.width / 2;
await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + inward * 120, y, { steps: 10 }); await page.mouse.up();
const wider = await width();
const g2 = await grip.boundingBox(); await page.mouse.move(g2.x + g2.width / 2, y); await page.mouse.down(); await page.mouse.move(g2.x - inward * 1200, y, { steps: 10 }); await page.mouse.up();
const narrow = await width();
const g3 = await grip.boundingBox(); await page.mouse.move(g3.x + g3.width / 2, y); await page.mouse.down(); await page.mouse.move(g3.x + inward * 1400, y, { steps: 10 }); await page.mouse.up();
const widest = await width();
check("Assistant panel resizes: +120 px, then stops at 320 px and at 40 % of the studio", wider === before + 120 && narrow === 320 && widest <= Math.round(1600 * 0.4) + 2 && widest > wider, `start ${before} → ${wider} → narrowest ${narrow} → widest ${widest}`);
await page.screenshot({ path: `${shots}/03-assistant-wide.png` });
await browser.close(); setup.close?.();
console.log(results.every(Boolean) ? "FILM AUDIT OK" : "FILM AUDIT FAILED");
process.exit(results.every(Boolean) ? 0 : 1);
