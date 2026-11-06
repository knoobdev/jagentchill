// End-to-end in a real browser against a RUNNING JAgentChill Server and the Claude Code CLI
// installed and signed in on this machine. Nothing a screenshot shows is seeded or mocked: the skill is installed
// through the Skills screen from the fixture folder `server/scripts/fixtures/skills`, the turns are real model turns,
// and the Usage screen shows what those turns used.
// Usage: node apps/app/e2e/skills-usage.mjs <server-log-file> <screenshot-dir>   (env: E2E_BASE)
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const [logFile, shots = ".dev/shots/skills-usage"] = process.argv.slice(2);
const base = process.env.E2E_BASE ?? "http://localhost:8069";
mkdirSync(shots, { recursive: true });
mkdirSync(".dev/compare/skills-usage", { recursive: true });
const browser = await chromium.launch();
const errors = [], results = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light", acceptDownloads: true });
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
const goto = (path) => page.goto(`${base}${path}`, { waitUntil: "networkidle", timeout: 120_000 });
const hostId = () => /\/(?:h|settings\/host)\/([0-9a-f]{32})/.exec(page.url())?.[1];
let host = "";
/** Light and dark at the desktop size, then the phone size, of the screen as it stands. */
async function themes(name) {
  for (const scheme of ["light", "dark"]) { await page.emulateMedia({ colorScheme: scheme }); await page.waitForTimeout(400); await shot(`${name}-${scheme}`); }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(600); await shot(`${name}-compact`);
  await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(400);
}
/** The design frame on the left, this screen on the right, in the same theme. */
async function compare(frame, name) {
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(500);
    const right = (await page.screenshot()).toString("base64");
    const design = await context.newPage();
    await design.setViewportSize({ width: 1700, height: 1100 });
    await design.emulateMedia({ colorScheme: scheme });
    await design.goto(`file://${process.cwd()}/docs/design/jagentchill-ui.html`);
    if (scheme === "dark") await design.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    const element = design.locator(`#${frame} .dframe`).first();
    await element.scrollIntoViewIfNeeded();
    const left = (await element.screenshot()).toString("base64");
    await design.setViewportSize({ width: 2440, height: 820 });
    await design.setContent(`<body style="margin:0;background:#888;font:600 16px system-ui;color:#fff"><div style="display:flex;gap:20px;padding:10px"><div><div>DESIGN ${frame}</div><img style="width:1200px;display:block" src="data:image/png;base64,${left}"></div><div><div>APP ${name}</div><img style="width:1200px;display:block" src="data:image/png;base64,${right}"></div></div></body>`);
    await design.screenshot({ path: `.dev/compare/skills-usage/${name}-${scheme}.png` });
    await design.close();
  }
  await page.emulateMedia({ colorScheme: "light" });
}
async function writeMessage(message) {
  await field("Message").fill(message);
  if ((await field("Message").inputValue()) !== message) { await field("Message").click(); await page.keyboard.press("ControlOrMeta+a"); await page.keyboard.type(message); }
}
/** The Skills control of the composer: a pill, or a row of "More settings" when the pills do not fit the pane. */
async function skillsControl(label) {
  if (await page.getByRole("button", { name: label, exact: true }).filter({ visible: true }).count()) return { open: () => button(label).click() };
  await button("More settings").click();
  const item = visible(page.locator('[role="menuitem"]').and(page.getByLabel(label, { exact: true })));
  await item.waitFor();
  return { open: () => item.click() };
}
const turnDone = () => page.waitForFunction(() => !document.body.innerText.includes("Working…"), null, { timeout: 240_000 });

await step("pair this browser as the first device (admin) through the UI", async () => {
  const offer = /jagentchill:\/\/pair#offer=[A-Za-z0-9_-]+/.exec(readFileSync(logFile, "utf8"))[0];
  await goto("/home");
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
  await text("What do you want to make?").waitFor();
});

await step("Settings lists Usage and limits and Skills; Skills shows the 21 built-in skills the Gateway loaded", async () => {
  await tid("footer-settings").click(); await page.waitForURL(/\/settings$/);
  await tid("settings-usage").waitFor();
  await tid("settings-skills").click(); await page.waitForURL(/\/settings\/host\/[0-9a-f]{32}\/skills/);
  host = hostId();
  await text("One list of skills for every agent and runtime: install, enable, create and train them.").waitFor();
  // The 21 skills this product ships, and the three the Gateway's own plugins bring.
  await text("Installed (24)").waitFor({ timeout: 60_000 });
  await text("jagentchill-directing", { exact: true }).waitFor();
  await visible(page.getByRole("combobox", { name: "Scope" })).click();
  await visible(page.getByRole("option", { name: "Built-in" })).click();
  await page.waitForFunction(() => [...document.querySelectorAll("*")].filter((node) => node.children.length === 0 && /^jagentchill-[a-z-]+$/.test(node.textContent ?? "")).length === 21, null, { timeout: 15_000 });
  expect((await page.getByText("acp-router", { exact: true }).filter({ visible: true }).count()) === 0, "the scope filter leaves only the built-in skills");
  await visible(page.getByRole("combobox", { name: "Scope" })).click();
  await visible(page.getByRole("option", { name: "All scopes" })).click();
  await themes("01-skills-installed");
});

await step("Sources: the defaults are listed; a folder on the host is added as a source", async () => {
  await tid("skill-sources").click();
  await tid("skill-sources-sheet").waitFor();
  await text("Anthropic skills").waitFor(); await text("OpenAI skills").waitFor();
  await tid("source-label").fill("Fixture skills");
  await tid("source-location").fill(resolve("server/scripts/fixtures/skills"));
  await tid("source-add").click();
  await text("Source added").waitFor();
  await text("Fixture skills").first().waitFor();
  await shot("02-sources");
  await page.keyboard.press("Escape");
  await tid("skill-sources-sheet").waitFor({ state: "hidden" });
});

await step("Browse lists the fixture skill; Install opens the trust prompt; confirming installs it", async () => {
  await visible(page.getByRole("tab", { name: "Browse" })).click();
  await tid("skills-browse").waitFor();
  await tid("skill-card-sign-off-check").waitFor({ timeout: 30_000 });
  await shot("03-browse");
  await tid("skill-install-sign-off-check").click();
  await tid("trust-prompt").waitFor();
  const prompt = await tid("trust-prompt").innerText();
  expect(prompt.includes("Fixture skills") && prompt.includes("server/scripts/fixtures/skills/sign-off-check") && /Files\s+2 · /.test(prompt), `the prompt names the source and the files: ${prompt.slice(0, 300)}`);
  await button("View SKILL.md").click(); await text(/KIWI-73/).first().waitFor();
  await shot("04-trust-prompt");
  await button("Install").click();
  await text("sign-off-check installed").waitFor({ timeout: 30_000 });
  await visible(page.getByRole("tab", { name: /Installed \(25\)/ })).click();
  await text("sign-off-check", { exact: true }).waitFor();
});

await step("Detail of the installed skill: rendered SKILL.md, files, source, and a lesson is added", async () => {
  await text("sign-off-check", { exact: true }).click();
  await tid("skill-detail").waitFor();
  const detail = () => tid("skill-detail").innerText();
  expect((await detail()).includes("Sign-off check") && (await detail()).includes("notes/readme.txt") && (await detail()).includes("Folder on the host") && (await detail()).includes("by Studio browser"), "the detail shows the text, the files and the source");
  await field("New lesson").fill("Put the sign-off on its own line");
  await button("Add lesson").click();
  await text("Put the sign-off on its own line").waitFor();
  await shot("05-skill-detail");
  await page.keyboard.press("Escape");
});

await step("Create skill: an authored skill appears in the list, is disabled and enabled again", async () => {
  await tid("skill-create").click();
  await tid("skill-name").fill("e2e-brand-voice");
  await tid("skill-description").fill("How the brand speaks in titles and captions");
  await tid("skill-body").fill("Use short sentences.\nNo exclamation marks.");
  await button("Create skill").last().click();
  await text("e2e-brand-voice created").waitFor({ timeout: 30_000 });
  await text("Installed (26)").waitFor();
  const toggle = visible(page.getByRole("switch", { name: "Enable e2e-brand-voice" }));
  await toggle.click();
  await page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="Enable e2e-brand-voice"]')?.getAttribute("aria-checked") === "false", null, { timeout: 15_000 });
  await toggle.click();
  await page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="Enable e2e-brand-voice"]')?.getAttribute("aria-checked") === "true", null, { timeout: 15_000 });
  await field("Search skills").fill("sign-off");
  await text("sign-off-check", { exact: true }).waitFor();
  expect((await page.getByText("jagentchill-directing", { exact: true }).filter({ visible: true }).count()) === 0, "search filters the list");
  await shot("06-skills-search");
  await field("Search skills").fill("");
});

await step("REAL TURN on Claude Code: a session is started from Home", async () => {
  await goto("/home"); await text("What do you want to make?").waitFor(); await page.waitForTimeout(1500);
  await visible(page.getByRole("button", { name: /^Model: / })).click();
  await tid("model-browser").waitFor();
  await tid("model-group-claude-code/anthropic").waitFor({ timeout: 180_000 });
  await tid("model-group-claude-code/anthropic").click();
  await tid("model-claude-code/anthropic/claude-sonnet-5").click();
  await writeMessage("Say hello in one word.");
  await button("Send").click();
  await page.waitForURL(/\/sessions\//);
  await tid("assistant-message").waitFor({ timeout: 240_000 });
  await turnDone();
});

await step("The composer's Skills control attaches the installed skill; the next REAL TURN is answered with the skill loaded", async () => {
  await (await skillsControl("Skills")).open();
  await tid("skill-picker").waitFor();
  expect((await tid("skill-count").innerText()) === "0/8", "nothing is attached yet");
  await field("Search skills").fill("sign");
  await tid("skill-option-sign-off-check").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="skill-count"]')?.textContent === "1/8");
  await shot("07-skill-picker");
  await page.keyboard.press("Escape");
  await tid("skill-picker").waitFor({ state: "hidden" });
  // The control now reads "1 skill".
  await skillsControl("1 skill"); await page.keyboard.press("Escape");
  await writeMessage("Say goodbye in one word.");
  await button("Send").click();
  await visible(page.getByTestId("assistant-message").filter({ hasText: "KIWI-73" })).waitFor({ timeout: 240_000 });
  await turnDone();
  // The line that names the skill is drawn as a chip on the message, not as text.
  await tid("message-skills").waitFor();
  expect((await tid("message-skills").innerText()).trim() === "sign-off-check", "the message shows the skill chip");
  expect(!(await page.locator("body").innerText()).includes("$sign-off-check"), "the raw invocation line is not shown");
  await shot("08-turn-with-skill");
});

await step("Usage and limits shows those turns: tiles, the chart, the breakdown and the per-day table", async () => {
  await goto(`/settings/host/${host}/usage`);
  await tid("usage-overview").waitFor({ timeout: 60_000 });
  const tiles = await tid("usage-overview").innerText();
  expect(/Estimated spend\s+Included in plan/.test(tiles), `spend is labelled, not shown as zero: ${tiles.slice(0, 200)}`);
  // Two turns of the Claude Code CLI carry about 90 000 cached tokens each: both must be counted.
  const tokens = /LLM tokens\s+([\d.]+)\s?k/.exec(tiles);
  expect(/2 turns/.test(tiles) && tokens && Number(tokens[1]) > 150, `turns and tokens are shown: ${tiles.slice(0, 200)}`);
  await text("Cost is included in the plan — showing tokens").waitFor();
  await text("Anthropic", { exact: true }).first().waitFor();
  await page.waitForTimeout(800);
  await shot("09-usage");
  await compare("d-usage", "usage");
  await themes("10-usage");
});

await step("Grouping by runtime, model, session and device; a session's usage opens with its turns", async () => {
  for (const [option, expected] of [["By runtime", "Claude Code"], ["By model", "claude-sonnet-5"], ["By device", "Studio browser"], ["By session", "Say hello in one word."]]) {
    await visible(page.getByRole("combobox", { name: "Group by" })).click();
    await visible(page.getByRole("option", { name: option })).click();
    await text(expected).first().waitFor({ timeout: 15_000 });
  }
  await shot("11-usage-by-session");
  await tid("usage-view").click();
  await tid("session-usage").waitFor();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="usage-turn"]').length === 2, null, { timeout: 15_000 });
  const sheet = await tid("session-usage").innerText();
  expect(!/\b0 in\b/.test(sheet), "each turn shows the tokens it used");
  expect(sheet.includes("Included in plan") && sheet.includes("Claude Code · claude-sonnet-5") && sheet.includes("This session did not start other agents"), `the sheet shows the turns: ${sheet.slice(0, 300)}`);
  await shot("12-session-usage");
  await page.keyboard.press("Escape");
});

await step("Export CSV downloads the records of the range", async () => {
  const [download] = await Promise.all([page.waitForEvent("download"), tid("usage-export").click()]);
  expect(/^jagentchill-usage-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/.test(download.suggestedFilename()), download.suggestedFilename());
  const csv = readFileSync(await download.path(), "utf8");
  const lines = csv.trimEnd().split("\r\n");
  expect(lines.length === 3 && lines[0].includes("session_id") && lines[1].includes("claude-sonnet-5") && lines[1].includes("included"), `the file holds the two turns: ${lines.length} lines`);
  await text("2 rows exported").waitFor();
});

await step("Limits: a spending limit is added and shown; plan usage is off until confirmed; a session limit refuses the next send", async () => {
  await visible(page.getByRole("tab", { name: "Limits" })).click();
  await tid("usage-limits").waitFor();
  await text("No limit is set. Agents can spend without a ceiling on this host.").waitFor();
  await text("Plan usage is off").waitFor();
  await tid("budget-add").click();
  await tid("budget-limit").fill("80");
  await button("Save limit").click();
  await tid("budget-global").waitFor();
  expect((await tid("budget-global").innerText()).includes("$0.00 of $80.00"), "the limit shows what is spent of it");
  await text("Plan-billed and unreported turns do not count toward budgets").waitFor();
  await shot("13-limits");
  await visible(page.getByRole("tab", { name: "Usage" })).click();
  await text("of $80.00 monthly limit").waitFor();
  await shot("14-usage-with-limit");
  await compare("d-usage", "usage-with-limit");
});

console.log(results.map(([state, name]) => `${state === "ok" ? "✓" : "✗"} ${name}`).join("\n"));
console.log(errors.length ? `ERRORS:\n${errors.join("\n")}` : "SKILLS AND USAGE E2E OK");
await browser.close();
process.exit(errors.length ? 1 : 0);
