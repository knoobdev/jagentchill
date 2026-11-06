// Home slash palette with a registered fake CLI runtime. It calls no installed CLI and sends no model turn.
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { pairAdmin } from "../../../server/scripts/live-lib.ts";

const [logFile, shots = ".dev/shots/w7n-toolbar/item2-cli-home"] = process.argv.slice(2);
const base = process.env.E2E_BASE, fakeBin = process.env.W7_FAKE_CLI_BIN, fakeHome = process.env.W7_FAKE_HOME;
if (!logFile || !base || !fakeBin || !fakeHome || !process.env.JAGENTCHILL_PORT) throw new Error("Set E2E_BASE, W7_FAKE_CLI_BIN, W7_FAKE_HOME and JAGENTCHILL_PORT; pass the server log and screenshot directory.");
mkdirSync(shots, { recursive: true }); mkdirSync(fakeBin, { recursive: true });
const fakeCommands = Array.from({ length: 12 }, (_, i) => ({ name: `w7-fake-${String(i + 1).padStart(2, "0")}`, description: `Fixture prompt ${i + 1} from the fake Codex CLI home.` }));
const binary = `${fakeBin}/codex`;
writeFileSync(binary, "#!/bin/sh\nif [ \"$1\" = --version ]; then echo 'codex-cli fixture'; exit 0; fi\nif [ \"$1\" = login ] && [ \"$2\" = status ]; then echo 'Logged in using fixture'; exit 0; fi\nexit 71\n"); chmodSync(binary, 0o755);
const promptDir = `${fakeHome}/.codex/prompts`;
mkdirSync(promptDir, { recursive: true });
for (const [i, command] of fakeCommands.entries()) writeFileSync(`${promptDir}/${command.name}.md`, `---\ndescription: ${command.description}\n---\nHandle $ARGUMENTS with fixture prompt ${i + 1}.`);
const offer = /jagentchill:\/\/pair#offer=[A-Za-z0-9_-]+/.exec(readFileSync(logFile, "utf8"))?.[0];
if (!offer) throw new Error("No initial pairing offer in the isolated server log");
const setup = await pairAdmin(offer, logFile, "Fake CLI Home setup");
const stored = await setup.call("jagentchill.runtime.config.get", {});
if (stored.config.entries.codex?.label !== "W7 Fake CLI" || !stored.config.entries.codex.models?.some((model) => model.modelId === "w7-fake-model")) {
  await setup.call("jagentchill.runtime.config.update", {
    expectedRevision: stored.config.revision,
    patch: { entries: { codex: { label: "W7 Fake CLI", models: [{ providerId: "openai", modelId: "w7-fake-model", label: "W7 Fake CLI model", source: "custom" }] } } },
  });
}
let fakeModelAvailable = false;
for (let i = 0; i < 30; i++) {
  await setup.call("jagentchill.runtime.snapshot.refresh", { runtimeIds: ["codex"] });
  const groups = await setup.call("jagentchill.runtime.models.list", {});
  fakeModelAvailable = groups.groups.some((group) => group.runtimeId === "codex" && group.providers?.some((provider) => provider.providerId === "openai" && provider.models?.some((model) => model.modelId === "w7-fake-model" && model.readiness === "ready")));
  if (fakeModelAvailable) break;
  await new Promise((resolve) => setTimeout(resolve, 300));
}
if (!fakeModelAvailable) {
  const diagnostic = await setup.call("jagentchill.runtime.models.list", {});
  const failedGroup = diagnostic.groups.find((group) => group.runtimeId === "codex");
  throw new Error(`configured fake CLI model was not ready: ${JSON.stringify(failedGroup && { status: failedGroup.status, readiness: failedGroup.readiness, error: failedGroup.error, providers: failedGroup.providers })}`);
}
const inventory = await setup.call("jagentchill.chat.commands", { ref: { runtimeId: "codex", providerId: "openai", modelId: "w7-fake-model" } });
assert(inventory.commands.length >= 12, `fake CLI inventory has at least 12 entries: ${inventory.commands.length}`);
assert(new Set(inventory.commands.map((entry) => entry.source)).size >= 2, `commands come from at least two sources: ${[...new Set(inventory.commands.map((entry) => entry.source))]}`);
assert(inventory.commands.filter((entry) => entry.source === "codex-prompt").length === 12, "the host listed all 12 fake Codex prompt files");

const codes = new Map();
setup.on((event, payload) => { if (event === "jagentchill.pairing.requested") codes.set(payload.request.deviceName, payload.code); });
  const browserOffer = (await setup.call("jagentchill.pairing.offer.create", { role: setup.role === "admin" ? "admin" : "editor" })).url;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
const page = await context.newPage();
const tid = (id) => page.getByTestId(id), visible = (locator) => locator.filter({ visible: true }).first();
const shot = (name) => page.screenshot({ path: `${shots}/${name}.png` });
try {
  await page.goto(`${base}/home`, { waitUntil: "networkidle" });
  await page.getByText("What do you want to make?").waitFor({ timeout: 60000 });
  await visible(page.getByRole("button", { name: "Connect", exact: true })).click();
  await page.getByLabel("Pairing link", { exact: true }).fill(browserOffer);
  await page.getByLabel("Name of this device", { exact: true }).fill("Fake CLI Home browser");
  await visible(page.getByRole("button", { name: "Continue", exact: true })).click();
  await page.getByText(/Enter the code shown next to/).waitFor({ timeout: 30000 });
  for (let attempt = 0; attempt < 60 && !codes.has("Fake CLI Home browser"); attempt++) await page.waitForTimeout(100);
  await page.getByLabel("Verification code", { exact: true }).fill(codes.get("Fake CLI Home browser"));
  await page.getByText("Connected", { exact: true }).waitFor({ timeout: 30000 });

  const composer = visible(tid("composer"));
  const currentModel = visible(composer.getByRole("button", { name: /Choose a model|W7 Fake CLI model/ }));
  await currentModel.waitFor({ timeout: 60000 });
  await currentModel.click();
  const browserDialog = tid("model-browser");
  await browserDialog.waitFor();
  await browserDialog.getByRole("button", { name: "All models", exact: true }).click();
  await browserDialog.getByLabel("Search models", { exact: true }).fill("W7 Fake CLI model");
  const fakeModelRow = browserDialog.getByTestId("model-codex/openai/w7-fake-model");
  if (!(await fakeModelRow.count())) throw new Error(`model browser did not show fake CLI ref: ${(await browserDialog.innerText()).slice(0, 1200)}`);
  await fakeModelRow.click();
  await visible(composer.getByRole("button", { name: /W7 Fake CLI model/ })).waitFor();

  const input = composer.getByLabel("Message", { exact: true });
  await input.fill("/");
  const menu = composer.getByTestId("slash-command-menu");
  await menu.waitFor({ timeout: 30000 });
  assert.equal(await setup.call("jagentchill.session.list", {}).then((result) => result.sessions.length), 0, "Home palette opens before a session exists");
  const visibleRows = await menu.getByTestId(/^slash-command-/).count();
  assert(visibleRows > 0 && visibleRows <= 8, `palette renders a scrollable slice of up to eight rows; DOM rows=${visibleRows}`);
  await shot("slash-cli-home-wide-gateway-light");
  await input.fill("/w7-fake-");
  await menu.getByTestId("slash-command-w7-fake-01").waitFor();
  assert((await menu.getByTestId(/^slash-command-/).count()) >= 8, "the filtered Codex prompt source has 12 local entries and is scrollable");
  await menu.getByText("Codex", { exact: true }).filter({ visible: true }).first().waitFor();
  await shot("slash-cli-home-wide-light");
  await page.emulateMedia({ colorScheme: "dark" }); await shot("slash-cli-home-wide-dark");

  await input.fill("/w7-fake-12");
  await menu.getByTestId("slash-command-w7-fake-12").waitFor();
  assert.equal(await menu.getByTestId(/^slash-command-/).count(), 1, "typing filters to the matching fake CLI command");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light" }); await shot("slash-cli-home-390-light");
  await page.emulateMedia({ colorScheme: "dark" }); await shot("slash-cli-home-390-dark");
  assert.equal(await setup.call("jagentchill.session.list", {}).then((result) => result.sessions.length), 0, "the no-session Home state remains intact after filtering");
  console.log(`PASS Home fake CLI slash palette: model=W7 Fake CLI model; entries=${inventory.commands.length}; sources=${[...new Set(inventory.commands.map((entry) => entry.source))].join(",")}; filtered=1; sessions=0; model turns=0`);
} finally { await browser.close(); setup.close(); }
