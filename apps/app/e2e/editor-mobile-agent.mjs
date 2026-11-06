// End-to-end in a real browser with touch emulation at 390 × 844 against a RUNNING JAgentChill Server with its real
// Gateway: the Agent sheet of the phone editor once a host is connected. Nothing is seeded or mocked — the project is
// created through the Projects screen and this browser is paired through the UI with the offer and the code the server
// prints. NO prompt is sent and no model is called: the check ends at the composer of a new session.
// Usage: node apps/app/e2e/editor-mobile-agent.mjs <server-log-file> [screenshot-dir] [base-url]
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";

const [logFile, shots = ".dev/shots/mobile-final/agent", base = "http://localhost:8096"] = process.argv.slice(2);
if (!logFile) throw new Error("usage: editor-mobile-agent.mjs <server-log-file> [screenshot-dir] [base-url]");
mkdirSync(shots, { recursive: true });
const width = 390, height = 844;
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, colorScheme: "light" });
const page = await context.newPage();
const errors = [];
let failed = 0;
page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
const visible = (locator) => locator.filter({ visible: true }).first();
const tid = (id) => visible(page.getByTestId(id));
const text = (value, options) => visible(page.getByText(value, options));
const field = (label) => visible(page.getByLabel(label, { exact: true }));
const shot = (name) => page.screenshot({ path: `${shots}/${name}.png` });
const expect = (condition, message) => { if (!condition) throw new Error(message); };
const wait = (ms) => page.waitForTimeout(ms);
const step = async (name, run) => {
  try { await run(); console.log("ok  ", name); }
  catch (err) { failed++; console.log("FAIL", name, "—", String(err).split("\n").slice(0, 3).join(" ")); await shot(`failure-${failed}`).catch(() => undefined); console.log("PAGE TEXT:", (await page.locator("body").innerText().catch(() => "")).replace(/\n+/g, " | ").slice(0, 600)); }
};
let editorUrl = "";

await step("Agent without a host — the sheet covers the editor, says Requires a host and leads to pairing", async () => {
  await page.goto(`${base}/projects`, { waitUntil: "networkidle", timeout: 240_000 });
  await visible(page.getByRole("button", { name: /^(Create your first project|New project)$/ })).tap({ timeout: 90_000 });
  await page.waitForURL(/\/editor\/[0-9a-f-]{36}$/);
  await tid("compact-editor").waitFor({ timeout: 60_000 });
  editorUrl = page.url();
  await tid("compact-agent").tap();
  await tid("agent-panel-requires-host").waitFor();
  const sheet = await tid("agent-sheet").boundingBox();
  expect(Math.abs(sheet.width - width) <= 1 && Math.abs(sheet.height - height) <= 1, `the sheet is as large as the screen: ${JSON.stringify(sheet)}`);
  expect((await tid("agent-sheet").getByTestId("composer").count()) === 0, "no composer without a host");
  await shot("01-requires-host-390");
  await tid("agent-panel-connect").tap();
  await page.waitForURL(/\/pair\/start/);
  await shot("02-pair-start-390");
});

await step("Pair this phone as the first device through the UI — the offer and the code are the ones the server printed", async () => {
  const offer = /jagentchill:\/\/pair#offer=[A-Za-z0-9_-]+/.exec(readFileSync(logFile, "utf8"))[0];
  await field("Pairing link").fill(offer);
  await field("Name of this device").fill("Pocket phone");
  await visible(page.getByRole("button", { name: "Continue", exact: false })).tap();
  await text(/Enter the code shown next to [0-9a-f]{8}/).waitFor({ timeout: 30_000 });
  const fingerprint = /next to ([0-9a-f]{8})/.exec(await page.content())[1];
  await wait(800);
  const code = /code (\d{6})/.exec(readFileSync(logFile, "utf8").split("\n").filter((line) => line.includes(`${fingerprint})`)).pop())[1];
  await field("Verification code").fill(code);
  await page.waitForURL((url) => !url.pathname.startsWith("/pair/"), { timeout: 30_000 });
  await wait(1500);
  await shot("03-paired-390");
});

await step("Agent with a host — the same button opens the chat of the project as a full-height sheet: a new-session composer, and closing returns to the editor", async () => {
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  await tid("compact-editor").waitFor({ timeout: 60_000 });
  await tid("compact-agent").tap();
  await tid("agent-sheet").waitFor();
  await tid("agent-sheet").getByTestId("composer").waitFor({ timeout: 60_000 });
  expect((await page.getByTestId("agent-panel-requires-host").filter({ visible: true }).count()) === 0, "connected, the Requires a host state is gone");
  const sheet = await tid("agent-sheet").boundingBox(), composer = await tid("agent-sheet").getByTestId("composer").boundingBox();
  expect(Math.abs(sheet.height - height) <= 1 && composer.y + composer.height <= height + 1 && composer.x >= 0 && composer.x + composer.width <= width + 1, `the composer lies inside the sheet: ${JSON.stringify(composer)}`);
  await wait(4000);
  // The model control of the composer reads the state of the host's runtimes; whatever it is, nothing is sent here.
  console.log("      composer:", (await tid("agent-sheet").getByTestId("composer").innerText()).replace(/\s+/g, " ").slice(0, 200));
  console.log("      sheet:", (await tid("agent-sheet").innerText()).replace(/\s+/g, " ").slice(0, 300));
  await shot("04-agent-sheet-connected-390");
  await tid("agent-panel-close").tap(); await wait(400);
  expect((await page.getByTestId("agent-sheet").count()) === 0, "the sheet closes");
  await tid("compact-toolbar").waitFor();
  await page.emulateMedia({ colorScheme: "dark" }); await tid("compact-agent").tap(); await tid("agent-sheet").getByTestId("composer").waitFor({ timeout: 30_000 }); await wait(1200);
  await shot("05-agent-sheet-connected-390-dark");
});

await browser.close();
if (errors.length) console.log("ERRORS:\n" + [...new Set(errors)].slice(0, 10).join("\n"));
if (failed || errors.length) { console.log(`FAIL editor-mobile-agent: ${failed} failed steps, ${errors.length} page errors`); process.exit(1); }
console.log("PASS editor-mobile-agent: 0 failed steps, 0 page errors");
