// End-to-end in a real browser against a RUNNING JAgentChill Server with the real Gateway and the Claude Code CLI
// installed and signed in on this machine: the agent panel of the editor. Nothing is seeded or mocked — the project is
// created through the Projects screen, the session by sending a message in the panel, the answer by a real model turn.
// Usage: node apps/app/e2e/editor-agent.mjs <server-log-file> <screenshot-dir>   (env: E2E_BASE)
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";

const [logFile, shots = ".dev/shots/editor-agent"] = process.argv.slice(2);
const base = process.env.E2E_BASE ?? "http://localhost:8069";
mkdirSync(shots, { recursive: true });
const browser = await chromium.launch();
const errors = [], results = [];
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, colorScheme: "light" });
const page = await context.newPage();
page.on("pageerror", (err) => errors.push(String(err)));
page.on("console", (msg) => msg.type() === "error" && !/status of (401|403|404|409|422|502|503)|Failed to load resource/.test(msg.text()) && errors.push(msg.text().slice(0, 300)));
const visible = (locator) => locator.filter({ visible: true }).first();
const text = (value, options) => visible(page.getByText(value, options));
const tid = (id) => visible(page.getByTestId(id));
const button = (name, exact = true) => visible(page.getByRole("button", { name, exact }));
const field = (label) => visible(page.getByLabel(label, { exact: true }));
const shot = (name) => page.screenshot({ path: `${shots}/${name}.png` });
const expect = (condition, message) => { if (!condition) throw new Error(message); };
const step = async (name, run) => {
  try { await run(); console.log("ok  ", name); results.push(["ok", name]); }
  catch (err) { console.log("FAIL", name, "—", String(err).split("\n").slice(0, 6).join("\n")); errors.push(`step failed: ${name}`); results.push(["FAIL", name]); await shot(`failure-${results.length}`).catch(() => undefined); await page.keyboard.press("Escape").catch(() => undefined); }
};
const box = async (id) => (await tid(id).boundingBox());
const panelMode = () => tid("agent-panel").getAttribute("data-mode");
let editorUrl = "", projectName = "", sessionUrl = "";
/** Drags the panel's splitter by `dx` px (negative widens the panel). */
async function dragSplitter(dx) {
  const handle = await box("agent-panel-splitter");
  const x = handle.x + handle.width / 2, y = handle.y + 300;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx / 2, y, { steps: 4 }); await page.mouse.move(x + dx, y, { steps: 4 }); await page.mouse.up();
  await page.waitForTimeout(300);
}

await step("No host: the toggle of the top bar opens the panel, which shows \"Requires a host\" with \"Connect a host\" and no composer", async () => {
  await page.goto(`${base}/projects`, { waitUntil: "networkidle", timeout: 180_000 });
  await button("Create your first project").click({ timeout: 90_000 });
  await page.waitForURL(/\/editor\/[0-9a-f-]{36}$/);
  for (const id of ["editor-bar", "asset-panel", "player", "inspector", "timeline"]) await tid(id).waitFor({ timeout: 60_000 });
  editorUrl = page.url();
  projectName = (await tid("project-name").innerText()).trim();
  expect((await page.getByTestId("agent-panel").count()) === 0, "the panel is collapsed by default");
  await tid("toggle-agent").click();
  await tid("agent-panel-requires-host").waitFor();
  const panel = await tid("agent-panel").innerText();
  expect(panel.includes("Requires a host") && panel.includes("Connect a host"), `the requires-host state is shown: ${panel}`);
  expect((await tid("agent-panel").getByTestId("composer").count()) === 0, "there is no composer without a host");
  await shot("01-no-host");
  await tid("agent-panel-connect").click();
  await page.waitForURL(/\/pair\/start/);
});

await step("pair this browser as the first device (admin) through the UI", async () => {
  const offer = /jagentchill:\/\/pair#offer=[A-Za-z0-9_-]+/.exec(readFileSync(logFile, "utf8"))[0];
  await page.goto(`${base}/home`, { waitUntil: "networkidle" });
  await text("What do you want to make?").waitFor({ timeout: 120_000 });
  await button("Connect").click();
  await field("Pairing link").fill(offer);
  await field("Name of this device").fill("Studio browser");
  await button("Continue", false).click();
  await text(/Enter the code shown next to [0-9a-f]{8}/).waitFor();
  const fingerprint = /next to ([0-9a-f]{8})/.exec(await page.content())[1];
  await page.waitForTimeout(600);
  const code = /code (\d{6})/.exec(readFileSync(logFile, "utf8").split("\n").filter((line) => line.includes(`${fingerprint})`)).pop())[1];
  await field("Verification code").fill(code);
  await text("Connected", { exact: true }).waitFor();
});

await step("Open the panel at 1600 px: docked, 360 px, at the inline-end side of the inspector, with the new-session composer", async () => {
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  await tid("inspector").waitFor({ timeout: 60_000 });
  // The panel was left open on this device: it opens again with the editor.
  await tid("agent-panel").waitFor();
  await tid("agent-panel-new").waitFor({ timeout: 60_000 });
  const panel = await box("agent-panel"), inspector = await box("inspector");
  expect((await panelMode()) === "docked" && Math.round(panel.width) === 360, `docked at 360 px: ${await panelMode()} ${panel.width}`);
  expect(panel.x >= inspector.x + inspector.width - 2 && Math.round(panel.x + panel.width) === 1600, "it sits at the inline-end side of the inspector");
  await text(`Ask the agent about ${projectName}`).waitFor();
  await shot("02-new-session");
});

await step("Width limits: the splitter stops at 320 px and at 40 % of the editor; the width is kept on this device", async () => {
  await dragSplitter(160);
  expect(Math.round((await box("agent-panel")).width) === 320, `dragged to 200 px it stops at 320: ${(await box("agent-panel")).width}`);
  await dragSplitter(-900);
  expect(Math.round((await box("agent-panel")).width) === 640, `it stops at 40 % of 1600: ${(await box("agent-panel")).width}`);
  await dragSplitter(240);
  const kept = Math.round((await box("agent-panel")).width);
  expect(kept === 400, `a width in range is taken: ${kept}`);
  await page.reload({ waitUntil: "networkidle" });
  await tid("agent-panel").waitFor({ timeout: 60_000 });
  expect(Math.round((await box("agent-panel")).width) === kept, "the width persists across a reload");
});

await step("Narrow wide window: at 1100 px the panel opens as a 420 px overlay and the regions keep their sizes", async () => {
  await tid("agent-panel-close").click();
  await page.setViewportSize({ width: 1100, height: 900 }); await page.waitForTimeout(600);
  const before = [await box("asset-panel"), await box("player"), await box("inspector")].map((region) => Math.round(region.width));
  await tid("toggle-agent").click();
  await tid("agent-panel").waitFor();
  const panel = await box("agent-panel");
  expect((await panelMode()) === "overlay" && Math.round(panel.width) === 420, `overlay of 420 px: ${await panelMode()} ${panel.width}`);
  const after = [await box("asset-panel"), await box("player"), await box("inspector")].map((region) => Math.round(region.width));
  expect(JSON.stringify(before) === JSON.stringify(after), `the three top regions keep their sizes: ${before} → ${after}`);
  await shot("03-overlay-1100");
  await page.setViewportSize({ width: 1600, height: 900 }); await page.waitForTimeout(600);
  expect((await panelMode()) === "docked", "widened again, the panel is docked");
});

await step("REAL TURN: sending in the panel creates a session bound to this project without leaving the editor", async () => {
  await visible(tid("agent-panel").getByTestId("composer").getByRole("button", { name: /\(Claude CLI\)|Select model|^Model/ })).click();
  await tid("model-browser").waitFor();
  await page.waitForTimeout(500);
  // The browser opens on the group of the current model; the other groups are one step back.
  if (!(await page.getByTestId("model-group-claude-code/anthropic").filter({ visible: true }).count()) && (await page.getByRole("button", { name: "All models" }).filter({ visible: true }).count())) await button("All models").click();
  await tid("model-group-claude-code/anthropic").waitFor({ timeout: 180_000 });
  await tid("model-group-claude-code/anthropic").click();
  await tid("model-claude-code/anthropic/claude-sonnet-5").click();
  await page.getByTestId("model-browser").waitFor({ state: "hidden" });
  await field("Message").fill("Reply with the single word: ready");
  await button("Send").click();
  await visible(tid("agent-panel").getByTestId("assistant-message")).waitFor({ timeout: 240_000 });
  await page.waitForFunction(() => !document.querySelector('[data-testid="agent-panel"]')?.textContent?.includes("Working…"), null, { timeout: 240_000 });
  expect(page.url() === editorUrl, "the editor stays open");
  expect(/ready/i.test(await visible(tid("agent-panel").getByTestId("assistant-message")).innerText()), "the agent answered in the panel");
  expect((await tid("agent-panel-switcher").innerText()).includes("Reply with the single word"), "the header names the session");
  await shot("04-session-in-panel");
});

await step("The session switcher lists the sessions of this project and \"New session\"; \"Open in session view\" shows the project chip", async () => {
  await tid("agent-panel-switcher").click();
  await visible(page.locator('[role="menuitemradio"], [role="menuitemcheckbox"], [role="menuitem"]').filter({ hasText: "Reply with the single word" })).waitFor();
  await visible(page.locator('[role="menuitemradio"], [role="menuitemcheckbox"], [role="menuitem"]').filter({ hasText: "New session" })).waitFor();
  await shot("05-switcher");
  await page.keyboard.press("Escape");
  await tid("agent-panel-open-session").click();
  await page.waitForURL(/\/h\/[0-9a-f]{32}\/sessions\//);
  sessionUrl = page.url();
  await tid("assistant-message").waitFor({ timeout: 60_000 });
  // The top bar of the session names the project it is bound to.
  const chip = visible(page.getByTestId("top-bar").getByRole("button", { name: projectName, exact: true }));
  await chip.waitFor();
  await shot("06-session-view-chip");
  await chip.click();
  await page.waitForURL(/\/editor\/[0-9a-f-]{36}$/);
  expect(page.url() === editorUrl, "the chip opens the editor of that project");
});

await step("Reopening the editor finds the same session in the panel", async () => {
  await tid("agent-panel").waitFor({ timeout: 60_000 });
  await visible(tid("agent-panel").getByTestId("assistant-message")).waitFor({ timeout: 60_000 });
  expect((await tid("agent-panel-switcher").innerText()).includes("Reply with the single word"), "the panel shows the session bound to the project");
  expect(/ready/i.test(await tid("agent-panel").innerText()), "with its conversation");
  await page.emulateMedia({ colorScheme: "dark" }); await page.waitForTimeout(400); await shot("07-reopened-dark");
  await page.emulateMedia({ colorScheme: "light" }); await shot("07-reopened-light");
  // The action of the toggle: Ctrl/Cmd+Shift+J closes and opens the panel.
  await tid("player").click({ position: { x: 20, y: 20 } });
  await page.keyboard.press("ControlOrMeta+Shift+J");
  // An editor left behind in the navigation history keeps its own, hidden, copy of the panel: only a visible one counts.
  const shownPanels = () => page.getByTestId("agent-panel").filter({ visible: true }).count();
  for (let n = 0; n < 50 && (await shownPanels()) > 0; n++) await page.waitForTimeout(100);
  expect((await shownPanels()) === 0, "the action closes the panel");
  await page.waitForTimeout(300);
  await page.keyboard.press("ControlOrMeta+Shift+J");
  await tid("agent-panel").waitFor();
});

console.log(results.map(([state, name]) => `${state === "ok" ? "✓" : "✗"} ${name}`).join("\n"));
console.log(errors.length ? `ERRORS:\n${errors.join("\n")}` : "EDITOR AGENT E2E OK");
await browser.close();
process.exit(errors.length ? 1 : 0);
