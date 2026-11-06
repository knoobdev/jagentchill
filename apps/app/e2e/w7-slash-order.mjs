// Fake Claude Code HOME/workspace proves source order in the real composer without running a CLI turn.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { chromium } from "playwright";
import { createHarness } from "../../../server/test/harness.ts";

const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
const port = Number(arg("--port")), dataDir = arg("--data-dir"), shots = arg("--shots");
const base = process.env.E2E_BASE;
if (port !== 18940 || Number(process.env.JAGENTCHILL_PORT) !== port || Number(process.env.JAGENTCHILL_GATEWAY_PORT) !== port + 1 || !dataDir?.startsWith(".dev/run-w7n-slash3-") || existsSync(dataDir) || base !== "http://localhost:8087") {
  throw new Error("Use fresh .dev/run-w7n-slash3-* data, ports 18940/18941, and E2E_BASE=http://localhost:8087");
}
mkdirSync(shots, { recursive: true });
const harness = await createHarness({ listenPort: port, dataDir: resolve(dataDir), allowedOrigins: [base] });
const admin = await harness.pair("Slash order fixture admin", "admin");
const projectId = "fixture-project";
const project = join(harness.dataDir, "workspaces", projectId);
const personalCommands = join(harness.dataDir, ".claude", "commands");
const projectCommands = join(project, ".claude", "commands");
const skills = join(project, ".claude", "skills", "fixture-skill");
mkdirSync(personalCommands, { recursive: true }); mkdirSync(projectCommands, { recursive: true }); mkdirSync(skills, { recursive: true });
writeFileSync(join(personalCommands, "README.md"), "README follows Claude's markdown command-file rule.");
for (let n = 1; n <= 10; n++) writeFileSync(join(personalCommands, `personal-${String(n).padStart(2, "0")}.md`), `---\ndescription: Personal command ${n}.\n---\nUse $ARGUMENTS for fixture ${n}.`);
for (let n = 1; n <= 2; n++) writeFileSync(join(projectCommands, `project-${String(n).padStart(2, "0")}.md`), `---\ndescription: Project command ${n}.\n---\nUse project fixture ${n}.`);
writeFileSync(join(skills, "SKILL.md"), "---\nname: fixture-skill\ndescription: Project fixture skill.\n---\nUse the project fixture skill.");
const { session } = await admin.call("jagentchill.session.create", { ref: { runtimeId: "claude-code", providerId: "anthropic", modelId: "sonnet" }, projectId });
await admin.call("jagentchill.session.access.set", { sessionKey: session.sessionKey, access: "host" });
const inventory = await admin.call("jagentchill.chat.commands", { sessionKey: session.sessionKey });
assert(inventory.commands.every((entry) => entry.source !== "gateway"), "the inventory has no Gateway source");
assert.equal(inventory.commands.filter((entry) => entry.source === "claude-personal").length, 11);
assert.equal(inventory.commands.filter((entry) => entry.source === "claude-project").length, 2);
assert.equal(inventory.commands.filter((entry) => entry.source === "skill").length, 1);
const sources = inventory.commands.map((entry) => entry.source);
assert(sources.indexOf("claude-project") > sources.indexOf("claude-personal"), "personal Claude commands precede project commands");
assert(sources.indexOf("skill") > sources.indexOf("claude-project"), "Skills follow provider commands");
assert(sources.indexOf("builtin") > sources.indexOf("skill"), "JAgentChill commands are last");
const offer = (await admin.call("jagentchill.pairing.offer.create", { role: "admin" })).url;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
const visible = (locator) => locator.filter({ visible: true }).first();
const shot = (name) => page.screenshot({ path: `${shots}/${name}.png` });
try {
  await page.goto(`${base}/home`, { waitUntil: "networkidle" });
  await visible(page.getByTestId("composer")).waitFor({ timeout: 30_000 });
  await visible(page.getByRole("button", { name: "Connect", exact: true })).click();
  await page.getByLabel("Pairing link", { exact: true }).fill(offer);
  await page.getByLabel("Name of this device", { exact: true }).fill("Slash order fixture browser");
  await visible(page.getByRole("button", { name: "Continue", exact: true })).click();
  await page.getByText(/Enter the code shown next to/).waitFor();
  for (let attempt = 0; attempt < 60 && !harness.app.pairing.pending().some((entry) => entry.deviceName === "Slash order fixture browser"); attempt++) await page.waitForTimeout(100);
  const request = harness.app.pairing.pending().find((entry) => entry.deviceName === "Slash order fixture browser");
  assert(request, "browser pairing reached fixture host");
  await page.getByLabel("Verification code", { exact: true }).fill(request.code);
  await page.getByText("Connected", { exact: true }).waitFor({ timeout: 30_000 });
  await page.goto(`${base}/h/${admin.offer.gatewayId}/sessions/${encodeURIComponent(session.sessionKey)}`, { waitUntil: "networkidle" });
  const composer = visible(page.getByTestId("composer")), input = composer.getByLabel("Message", { exact: true });
  const menu = composer.getByTestId("slash-command-menu");
  for (const [width, height, size] of [[1440, 900, "1440"], [390, 844, "390"]]) {
    await page.setViewportSize({ width, height });
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      await input.fill("/"); await menu.waitFor();
      const firstPrompt = visible(menu.getByTestId("slash-command-README"));
      await firstPrompt.waitFor();
      assert((await menu.innerText()).startsWith("Claude Code"), "Claude Code heading precedes first palette rows");
      await shot(`order-palette-${size}-${scheme}`);
    }
  }
  await input.fill("/fixture-skill");
  assert((await menu.innerText()).includes("Skills"), "skill commands use the Skills group");
  await input.fill("/status");
  assert((await menu.innerText()).includes("JAgentChill"), "host commands use the JAgentChill group");
  assert.equal(harness.fake.callsOf("chat.send").length, 0, "palette checks send no model turns");
  console.log(`PASS slash order: personal=11 (includes README.md), project=2, skills=1, host=${sources.filter((source) => source === "builtin").length}; order=runtime→skills→JAgentChill; UI palette screenshots=4; model turns=0`);
} finally { await browser.close(); admin.ws.close(); harness.stop(); }
