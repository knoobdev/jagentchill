// Headless user path for the host-driven Claude CLI sign-in. The host must be started with the fake CLI directory first
// on PATH and W13_FAKE_CLI_STATE pointing inside its isolated run dir; no user CLI or provider request is involved.
// Usage: JAGENTCHILL_PORT=19110 JAGENTCHILL_GATEWAY_PORT=19111 W13_FAKE_CLI_STATE=.dev/run-w13a-cli-signin-2/fake-cli-state E2E_BASE=http://localhost:8100 node apps/app/e2e/w13-cli-signin.mjs <host-log> <shots-dir>
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";

const [logFile, shots] = process.argv.slice(2);
const base = process.env.E2E_BASE ?? "http://localhost:8100";
const port = Number(process.env.JAGENTCHILL_PORT);
if (!logFile || !shots || port !== 19110 || Number(process.env.JAGENTCHILL_GATEWAY_PORT) !== port + 1 || !process.env.W13_FAKE_CLI_STATE || !process.env.W13_FAKE_CLI_LOG || new URL(base).port !== "8100") {
  throw new Error("Use the isolated w13 host on 19110/19111, web build on 8100, W13_FAKE_CLI_STATE/W13_FAKE_CLI_LOG, and pass its host log and screenshot directory.");
}
mkdirSync(shots, { recursive: true });
const stateFile = process.env.W13_FAKE_CLI_STATE;
const offerFromLog = () => /jagentchill:\/\/pair#offer=[A-Za-z0-9_-]+/.exec(readFileSync(logFile, "utf8"))?.[0];
const hostIdFromLog = () => /\(host ([0-9a-f]+)\)/.exec(readFileSync(logFile, "utf8"))?.[1];
const pageErrors = [];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1800, height: 1200 }, colorScheme: "light" });
page.setDefaultTimeout(30_000);
page.on("pageerror", (error) => pageErrors.push(String(error)));
const shot = (name) => page.screenshot({ path: `${shots}/${name}.fake-cli.png`, fullPage: true });
const setFakeStatus = (status) => writeFileSync(stateFile, status, { mode: 0o600 });

try {
  await page.goto(`${base}/pair-link?link=${encodeURIComponent(offerFromLog() ?? "")}`, { waitUntil: "networkidle" });
  await page.getByLabel("Pairing link").fill(offerFromLog());
  await page.getByLabel("Name of this device").fill("W13 fake CLI browser");
  await page.getByRole("button", { name: "Continue" }).click();
  const verification = page.getByTestId("pairing-verification-code");
  await verification.waitFor();
  const fingerprint = /next to ([0-9a-f]{8})/.exec(await page.locator("body").innerText())?.[1];
  assert.ok(fingerprint, "pairing screen shows its host fingerprint");
  let code;
  for (let attempt = 0; attempt < 100 && !code; attempt++) {
    const lines = readFileSync(logFile, "utf8").split("\n").filter((line) => line.includes(`${fingerprint})`));
    code = /code (\d{6})/.exec(lines.at(-1) ?? "")?.[1];
    if (!code) await page.waitForTimeout(100);
  }
  assert.ok(code, "isolated host emitted the matching pairing code");
  await verification.fill(code);
  await page.getByText("What do you want to make?").waitFor();

  const hostId = hostIdFromLog();
  assert.ok(hostId, "isolated host id is present in the host log");
  const keysUrl = `${base}/settings/host/${hostId}/runtimes/keys`;
  await page.goto(keysUrl, { waitUntil: "networkidle" });
  await page.getByTestId("provider-anthropic").waitFor();
  await page.getByTestId("provider-anthropic").click();
  const signIn = page.getByTestId("login-claude-code");
  await signIn.waitFor();
  assert.equal(await signIn.innerText(), "Claude Code on this host", "the signed-out runtime offers the vendor CLI's own login");

  // First attempt: CLI stays open in its own login flow until the user cancels.
  await signIn.click();
  await page.getByLabel("Paste the code shown on the sign-in page").waitFor();
  await shot("01-cancel-waiting-fake-cli");
  await page.getByRole("button", { name: "Cancel sign-in" }).click();
  await page.getByTestId("login-step").waitFor({ state: "hidden" });
  assert.match(readFileSync(process.env.W13_FAKE_CLI_LOG, "utf8"), /claude login cancelled/, "cancel terminates the waiting fake CLI process");

  // Successful sign-in: the code goes to the fake CLI's stdin; the CLI changes its own status and exits.
  await page.getByTestId("login-claude-code").click();
  await page.getByLabel("Paste the code shown on the sign-in page").waitFor();
  await page.getByLabel("Paste the code shown on the sign-in page").fill("FAKE-CODE");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByTestId("auth-profile").getByText(/f\*{3}@example\.invalid/).waitFor();
  await page.getByRole("button", { name: "Sign out" }).waitFor();
  await shot("02-signed-in-fake-cli");
  assert.equal(readFileSync(stateFile, "utf8"), "signed_in");

  // Simulate the vendor CLI reporting a revoked/expired login, then ask the runtime row to refresh its status.
  await page.getByRole("button", { name: "Close", exact: true }).first().click();
  await page.goto(`${base}/settings/host/${hostId}/runtimes/runtimes`, { waitUntil: "networkidle" });
  await page.getByTestId("runtime-claude-code").getByText("Ready", { exact: true }).waitFor();
  setFakeStatus("signed_out");
  await page.getByRole("button", { name: "Refresh all" }).click();
  await page.getByTestId("runtime-claude-code").getByText("Signed out", { exact: true }).waitFor();
  await page.goto(keysUrl, { waitUntil: "networkidle" });
  await page.getByTestId("provider-anthropic").waitFor();
  await page.getByTestId("provider-anthropic").click();
  await page.getByTestId("login-claude-code").waitFor();
  assert.equal(await page.getByTestId("login-claude-code").innerText(), "Claude Code on this host", "a newer signed-out status clears the stale connected CLI state and exposes sign-in again");
  await shot("03-sign-in-again-after-expiry-fake-cli");
  await page.getByTestId("login-claude-code").click();
  await page.getByLabel("Paste the code shown on the sign-in page").waitFor();
  await page.getByLabel("Paste the code shown on the sign-in page").fill("FAKE-CODE");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByTestId("auth-profile").getByText(/f\*{3}@example\.invalid/).waitFor();

  // Sign-out is the vendor CLI's own logout command.
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByTestId("auth-profile").waitFor({ state: "hidden" });
  assert.equal(readFileSync(stateFile, "utf8"), "signed_out");
  assert.match(readFileSync(process.env.W13_FAKE_CLI_LOG, "utf8"), /claude auth logout/, "sign out invokes the vendor CLI's own logout command");
  await page.getByRole("button", { name: "Close", exact: true }).first().click();
  await page.goto(`${base}/settings/host/${hostId}/runtimes/runtimes`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Refresh all" }).click();
  await page.getByTestId("runtime-claude-code").getByText("Signed out", { exact: true }).waitFor();
  await shot("04-signed-out-fake-cli");

  // Codex's own device-code login: the fake CLI stays in its device authorization wait until the fixture approves it.
  await page.goto(keysUrl, { waitUntil: "networkidle" });
  await page.getByTestId("provider-openai").waitFor();
  await page.getByTestId("provider-openai").click();
  const codexLogin = page.getByTestId("login-codex-cli");
  await codexLogin.waitFor();
  assert.equal(await codexLogin.innerText(), "Codex CLI on this host");
  await codexLogin.click();
  await page.getByText("Waiting for you to finish in the browser…").waitFor();
  await page.getByTestId("login-elapsed").waitFor();
  await page.waitForTimeout(1200);
  assert.match(await page.getByTestId("login-elapsed").innerText(), /[1-9]\d* seconds elapsed/, "the browser wait reports elapsed time");
  assert.equal(await page.getByText("FAKE-CODE", { exact: true }).count(), 1, "the CLI device code is visible");
  await shot("05-codex-device-code-waiting-fake-cli");
  setFakeStatus("signed_in");
  await page.getByTestId("auth-profile").getByText("Codex CLI on this host").waitFor();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByTestId("auth-profile").waitFor({ state: "hidden" });
  assert.equal(readFileSync(stateFile, "utf8"), "signed_out", "the Codex CLI fixture signed out");
  assert.match(readFileSync(process.env.W13_FAKE_CLI_LOG, "utf8"), /codex logout/, "sign out invokes the Codex CLI's logout command");
  await shot("06-codex-signed-out-fake-cli");
  await page.goto(`${base}/settings/host/${hostId}/runtimes/runtimes`, { waitUntil: "networkidle" });
  const gemini = page.getByTestId("runtime-gemini-cli");
  await gemini.getByText("No provider", { exact: true }).waitFor();
  assert.equal(await gemini.getByText("gemini 1.0.0 (fake CLI)").count(), 1, "Gemini CLI version is detected from the fake executable");
  assert.match(await gemini.innerText(), /Google API key on this host version/, "the pinned Gateway requires a host Google API key for Gemini CLI");
  await shot("07-gemini-cli-api-key-requirement-fake-cli");
  assert.deepEqual(pageErrors, [], `browser errors: ${pageErrors.join(" | ")}`);
  console.log("W13 CLI SIGN-IN E2E PASS — actual host and production web build; fake Claude and Codex CLIs on private PATH handled --version, auth status, login, and logout; cancel killed the waiting login; expiry status refresh enabled Claude sign-in again; Codex device-code wait showed elapsed time; fake Gemini version was detected and its pinned Gateway API-key requirement shown; no provider turn or vendor request.");
} catch (error) {
  await shot("failure").catch(() => undefined);
  console.error("W13 CLI SIGN-IN E2E FAIL", String(error).split("\n")[0]);
  console.error((await page.locator("body").innerText().catch(() => "")).replace(/\n+/g, " | ").slice(0, 1000));
  throw error;
} finally {
  await browser.close();
}
