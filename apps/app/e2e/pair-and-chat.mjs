// End-to-end in a real browser against a running server (real Gateway, real model) and the Expo web dev server:
// connect this browser to the host, run one agent turn that calls a JAgentChill tool, open Devices and create an offer.
// The turn runs on Claude Code (installed and signed in on the host), on the model named by LIVE_CLAUDE_MODEL.
// Usage: node apps/app/e2e/pair-and-chat.mjs <server-log-file> <screenshot-dir>   (env: E2E_BASE, default http://localhost:8081)
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const [logFile, shots] = process.argv.slice(2);
const base = process.env.E2E_BASE ?? "http://localhost:8081";
const model = process.env.LIVE_CLAUDE_MODEL ?? "claude-sonnet-5";
const offer = /jagentchill:\/\/pair#offer=[A-Za-z0-9_-]+/.exec(readFileSync(logFile, "utf8"))[0];
const browser = await chromium.launch();
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
page.on("pageerror", (err) => errors.push(String(err)));
// The wrong-code step below is answered HTTP 401 on purpose; the browser logs that as a failed resource.
page.on("console", (msg) => msg.type() === "error" && !/status of 401/.test(msg.text()) && errors.push(msg.text()));
// Screens under the current one stay mounted but hidden; only visible text counts.
const text = (value, options) => page.getByText(value, options).filter({ visible: true }).first();
const shot = (name) => page.screenshot({ path: `${shots}/${name}.png` });

try {
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await text("What do you want to make?").waitFor({ timeout: 90_000 });
  await text("Local only").waitFor();
  await shot("1-home-local");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByLabel("Pairing link").fill(offer);
  await page.getByLabel("Name of this device").fill("Studio browser");
  await shot("2-connect-host");
  await page.getByRole("button", { name: "Continue" }).click();
  await text(/Enter the code shown next to [0-9a-f]{8}/).waitFor();
  const fingerprint = /next to ([0-9a-f]{8})/.exec(await page.content())[1];
  await page.waitForTimeout(400);
  const code = /code (\d{6})/.exec(readFileSync(logFile, "utf8").split("\n").filter((l) => l.includes(`${fingerprint})`)).pop())[1];
  await page.getByLabel("Verification code").fill(code === "000000" ? "000001" : "000000");
  await text(/That code is not right\. 4 attempts left\./).waitFor();
  await shot("3-code-wrong");
  await page.getByLabel("Verification code").fill(code);
  await text("Connected", { exact: true }).waitFor();
  await text("What do you want to make?").waitFor();
  await shot("4-home-connected");
  if (process.env.E2E_SKIP_TURN !== "1") {
  // The model of the draft is chosen in the model browser: Claude Code, once the host has listed its models.
  await page.getByRole("button", { name: /^Model: / }).filter({ visible: true }).first().click();
  await page.getByTestId("model-browser").waitFor();
  await page.waitForTimeout(500);
  if (!(await page.getByTestId("model-group-claude-code/anthropic").filter({ visible: true }).count()) && (await page.getByRole("button", { name: "All models" }).filter({ visible: true }).count())) await page.getByRole("button", { name: "All models" }).click();
  await page.getByTestId("model-group-claude-code/anthropic").waitFor({ timeout: 240_000 });
  await page.getByTestId("model-group-claude-code/anthropic").click();
  await page.getByTestId(`model-claude-code/anthropic/${model}`).click();
  await page.getByTestId("model-browser").waitFor({ state: "hidden" });
  const message = 'Call the tool jc_echo from the jagentchill MCP server with text "kiwi-88" and reply with exactly what it returned.';
  const composer = page.getByLabel("Message").filter({ visible: true }).first();
  await composer.click();
  await page.keyboard.type(message);
  await page.getByRole("button", { name: "Send" }).first().click();
  await page.getByTestId("tool-jc_echo").filter({ visible: true }).first().waitFor({ timeout: 180_000 });
  await page.getByTestId("assistant-message").filter({ hasText: "kiwi-88" }).filter({ visible: true }).first().waitFor({ timeout: 180_000 });
  await text(/^Call the tool jc_echo/).waitFor({ timeout: 2000 });
  await shot("5-session");
  }
  // Devices is one of the six destinations of the "More" group.
  if (!(await page.getByTestId("nav-devices").filter({ visible: true }).count())) await page.getByTestId("nav-more").click();
  await page.getByTestId("nav-devices").filter({ visible: true }).first().click();
  await text("Studio browser").waitFor();
  await text("This device", { exact: true }).waitFor();
  await shot("6-devices");
  // The sidebar's "Pair your phone" card has a button of the same name; the screen's own is the later one.
  await page.getByRole("button", { name: "Pair a device" }).filter({ visible: true }).last().click();
  await text("Offer expires in").waitFor();
  await shot("7-pair-a-device");
} catch (err) {
  // Keep what the page showed when a step failed.
  await shot("failure");
  console.log("FAILED:", String(err).split("\n")[0]);
  console.log("PAGE TEXT:", (await page.locator("body").innerText()).replace(/\n+/g, " | ").slice(0, 700));
  errors.push("step failed");
}
await browser.close();
console.log(errors.length ? `PAGE ERRORS:\n${errors.join("\n")}` : "E2E OK — no page errors");
process.exit(errors.length ? 1 : 0);
