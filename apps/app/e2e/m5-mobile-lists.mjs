// Weak browser-only check for the three M5 phone list screens at a 390 px viewport.
// The host and its records are local test data; no generation/model call is made.
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";
import { pairAdmin } from "../../../server/scripts/live-lib.ts";

const [logFile, shots = ".dev/shots/w9-m5/item-1"] = process.argv.slice(2);
const base = process.env.E2E_BASE ?? "http://localhost:8088";
mkdirSync(shots, { recursive: true });
const firstOffer = /jagentchill:\/\/pair#offer=[A-Za-z0-9_-]+/.exec(readFileSync(logFile, "utf8"))?.[0];
if (!firstOffer) throw new Error("The local test host did not print a pairing offer.");
const setup = await pairAdmin(firstOffer, logFile, "M5 mobile lists");
const codes = new Map();
setup.on((event, payload) => { if (event === "jagentchill.pairing.requested") codes.set(payload.request.deviceName, payload.code); });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => message.type() === "error" && !/Failed to load resource|ERR_/.test(message.text()) && errors.push(message.text()));
const byId = (id) => page.getByTestId(id).filter({ visible: true }).first();
const byButton = (name) => page.getByRole("button", { name, exact: true }).filter({ visible: true }).first();
const expect = (condition, message) => { if (!condition) throw new Error(message); };
const shot = (name) => page.screenshot({ path: `${shots}/${name}.png` });
const navigate = async (name) => {
  await byButton("Open navigation").click();
  await byId(`nav-${name}`).click();
};

try {
  await page.goto(`${base}/home`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.getByText("What do you want to make?", { exact: true }).waitFor({ timeout: 60_000 });
  await byButton("Connect").click();
  await page.getByLabel("Pairing link", { exact: true }).fill((await setup.call("jagentchill.pairing.offer.create", { role: "admin" })).url);
  await page.getByLabel("Name of this device", { exact: true }).fill("M5 browser check");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByText(/Enter the code shown next to [0-9a-f]{8}/).waitFor();
  for (let wait = 0; wait < 100 && !codes.has("M5 browser check"); wait++) await page.waitForTimeout(100);
  await page.getByLabel("Verification code", { exact: true }).fill(codes.get("M5 browser check") ?? "");
  await page.getByText("Connected", { exact: true }).waitFor();

  await navigate("workflows");
  await page.getByText("No workflows yet", { exact: true }).waitFor({ timeout: 30_000 });
  await byId("workflow-new").waitFor();
  await page.getByLabel("Search workflows", { exact: true }).waitFor();
  await shot("workflows-empty-390");
  await byId("workflow-new").click();
  await byId("wf-canvas").waitFor({ timeout: 30_000 });
  await page.goBack();
  await page.getByText("Never", { exact: true }).waitFor({ timeout: 30_000 });
  const workflowRow = byId("workflow-row-Untitled workflow");
  await workflowRow.waitFor();
  const workflowBox = await workflowRow.boundingBox();
  expect(workflowBox && workflowBox.x >= 0 && workflowBox.x + workflowBox.width <= 390, `workflow name overflows 390 px: ${JSON.stringify(workflowBox)}`);
  await page.getByRole("button", { name: "Row actions", exact: true }).first().click();
  await page.getByRole("menuitem", { name: "Open", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await shot("workflows-row-390");

  await navigate("film");
  await page.getByText("No films yet", { exact: true }).waitFor({ timeout: 30_000 });
  await byId("film-new").click();
  await page.getByText("Untitled film", { exact: true }).waitFor({ timeout: 30_000 });
  await page.goBack();
  const filmCard = byId("film-card");
  await filmCard.waitFor({ timeout: 30_000 });
  const filmBox = await filmCard.boundingBox();
  expect(filmBox && filmBox.x >= 0 && filmBox.x + filmBox.width <= 390, `film card overflows 390 px: ${JSON.stringify(filmBox)}`);
  await page.getByLabel("Search films", { exact: true }).fill("no match");
  await page.getByText("No results", { exact: true }).waitFor();
  await page.getByLabel("Search films", { exact: true }).fill("");
  await page.getByText("Untitled film", { exact: true }).waitFor();
  await shot("film-row-390");

  await navigate("automations");
  await page.getByText("No automations yet", { exact: true }).waitFor({ timeout: 30_000 });
  await byId("automation-create").waitFor();
  await page.getByLabel("Search automations", { exact: true }).waitFor();
  await expectAutomationControls(page);
  await shot("automations-empty-390");

  expect(errors.length === 0, `browser errors: ${errors.join(" | ")}`);
  console.log("PASS M5 phone lists: workflows empty/create/card/menu, film empty/create/search/card, automations empty/search/create; viewport 390x844; browser only");
} finally {
  await context.close();
  await browser.close();
}

function expectAutomationControls(page) {
  return Promise.all([
    page.getByRole("button", { name: "Create automation", exact: true }).filter({ visible: true }).count().then((count) => { if (count !== 1) throw new Error(`expected one visible automation create action, got ${count}`); }),
    page.getByTestId("automation-composer").filter({ visible: true }).count().then((count) => { if (count !== 0) throw new Error("the phone list must expose one create action, not a second docked composer"); }),
  ]);
}
