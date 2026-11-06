// Isolated host-install failure paths. The registry fixture packages only w13-fake-cli.sh.
// Usage: JAGENTCHILL_PORT=19110 JAGENTCHILL_GATEWAY_PORT=19111 E2E_BASE=http://localhost:8100 node apps/app/e2e/w13-cli-install-failure.mjs <host-log> <shots-dir> <run-dir> <checksum|version|offline>
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";

const [hostLog, shots, runDir, mode] = process.argv.slice(2);
const base = process.env.E2E_BASE ?? "http://localhost:8100";
const port = Number(process.env.JAGENTCHILL_PORT);
const expected = { checksum: "could not be verified", version: "version check failed", offline: "Unable to reach the package registry" }[mode];
if (!hostLog || !shots || !runDir || !expected || port !== 19110 || Number(process.env.JAGENTCHILL_GATEWAY_PORT) !== 19111 || new URL(base).port !== "8100") throw new Error("Use a fresh W13 host on 19110/19111, web 8100, and mode checksum, version or offline.");
mkdirSync(shots, { recursive: true });
const log = () => readFileSync(hostLog, "utf8");
const offer = () => /jagentchill:\/\/pair#offer=[A-Za-z0-9_-]+/.exec(log())?.[0];
const hostId = () => /\(host ([0-9a-f]+)\)/.exec(log())?.[1];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1800, height: 1200 }, colorScheme: "light" });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.setDefaultTimeout(30_000);
const shot = () => page.screenshot({ path: `${shots}/${mode}-install-failure.fake-installer-fake-cli.png`, fullPage: true });

try {
  await page.goto(`${base}/pair-link?link=${encodeURIComponent(offer() ?? "")}`, { waitUntil: "networkidle" });
  await page.getByLabel("Pairing link").fill(offer());
  await page.getByLabel("Name of this device").fill(`W13 ${mode} installer`);
  await page.getByRole("button", { name: "Continue" }).click();
  const codeInput = page.getByTestId("pairing-verification-code");
  await codeInput.waitFor();
  const fingerprint = /next to ([0-9a-f]{8})/.exec(await page.locator("body").innerText())?.[1];
  let code;
  for (let i = 0; i < 100 && !code; i++) {
    code = /code (\d{6})/.exec(log().split("\n").filter((line) => line.includes(`${fingerprint})`)).at(-1) ?? "")?.[1];
    if (!code) await page.waitForTimeout(100);
  }
  assert.match(code ?? "", /^\d{6}$/);
  await codeInput.fill(code);
  await page.getByText("What do you want to make?").waitFor();
  const id = hostId();
  assert.ok(id);
  await page.goto(`${base}/settings/host/${id}/runtimes/runtimes`, { waitUntil: "networkidle" });
  const row = page.getByTestId("runtime-claude-code");
  await row.getByTestId("install-claude-code").click();
  await page.getByTestId("install-confirm-claude-code").waitFor();
  await page.getByRole("button", { name: "Install now" }).click();
  await row.getByRole("button", { name: "Retry", exact: true }).waitFor({ timeout: 120_000 });
  const body = await row.innerText();
  assert.ok(body.includes(expected), `expected ${mode} reason in runtime row, got: ${body}`);
  assert.deepEqual(errors, [], `browser errors: ${errors.join(" | ")}`);
  await shot();
  console.log(`W13 ${mode.toUpperCase()} INSTALL FAILURE E2E PASS — local fixture only; error wording and Retry visible; no provider/model request.`);
} catch (error) {
  await shot().catch(() => undefined);
  console.error(`W13 ${mode} INSTALL FAILURE E2E FAIL: ${String(error).split("\n")[0]}`);
  console.error((await page.locator("body").innerText().catch(() => "")).replace(/\n+/g, " | ").slice(0, 1200));
  throw error;
} finally { await browser.close(); }
