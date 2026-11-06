import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { decodeOffer } from "@jagentchill/protocol";
import { DeviceSim } from "../../../server/test/device-sim.ts";

const desktopRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(desktopRoot, "../..");
const run = join(repoRoot, ".dev/run-w8x2-connections-devices-1");
const userData = join(run, "user-data"), home = join(run, "home"), library = join(run, "library");
const state = join(run, "tailnet-state.txt"), keyStoreState = join(run, "key-store-state.txt"), fake = join(run, "fake-tsnet-bridge");
const screenshots = join(repoRoot, ".dev/evidence/w8x2-connections-devices");
const executable = join(repoRoot, ".dev/build/desktop-w8x2-connections-devices/mac-arm64/JAgentChill.app/Contents/MacOS/JAgentChill");
const bridgeFixture = join(desktopRoot, "test/fixtures/fake-tsnet-stateful.mjs");
const shot = (name) => join(screenshots, name);
assert.ok(existsSync(executable), `packaged executable missing: ${executable}`);
assert.equal(existsSync(run), false, `run directory must be fresh: ${run}`);
mkdirSync(userData, { recursive: true }); mkdirSync(home, { recursive: true }); mkdirSync(library, { recursive: true }); mkdirSync(screenshots, { recursive: true });
writeFileSync(state, "login\n");
writeFileSync(keyStoreState, "available\n");
writeFileSync(fake, `#!/usr/bin/env node\nimport ${JSON.stringify(bridgeFixture)};\n`, { mode: 0o755 });
chmodSync(fake, 0o755);

const env = {
  ...process.env,
  HOME: home,
  JAGENTCHILL_UNATTENDED: "1",
  JAGENTCHILL_USER_DATA: userData,
  JAGENTCHILL_LIBRARY_DIR: library,
  JAGENTCHILL_PORT: "19100",
  JAGENTCHILL_GATEWAY_PORT: "19101",
  JAGENTCHILL_TSNET_BRIDGE_BIN: fake,
  JAGENTCHILL_TEST_OPEN_EXTERNAL_FILE: join(run, "opened-url.txt"),
  JAGENTCHILL_TEST_KEY_STORE_STATE_FILE: keyStoreState,
  TSNET_TEST_STATE_FILE: state,
  TSNET_TEST_PROXY_TARGET: "127.0.0.1:19100",
  TSNET_TEST_TAILNET_ADDRESS: "w8x2-host.ts.net:19100",
  TSNET_TEST_PROXY_TRACE: join(run, "proxy-trace.txt"),
  TSNET_TEST_PROXY_PORT: "19103",
  FAKE_TSNET_FORWARD_PORT: "19102",
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
let browser;
let page;
let assertions = 0;
const check = (condition, label) => { assert.ok(condition, label); assertions++; };
const waitFor = async (read, label, timeout = 60_000) => {
  const limit = Date.now() + timeout;
  while (Date.now() < limit) {
    try {
      const value = await read();
      if (value) return value;
    } catch { /* The main process reloads the document once the host port is known. */ }
    await new Promise((done) => setTimeout(done, 150));
  }
  throw new Error(`timed out waiting for ${label}`);
};

try {
  app = spawn(executable, ["--headless", "--remote-debugging-port=19104"], { env, stdio: ["ignore", "pipe", "pipe"] });
  await waitFor(async () => {
    try { return (await (await fetch("http://127.0.0.1:19104/json/list")).json()).some((item) => item.type === "page" && item.url.startsWith("app://jagentchill/")); }
    catch { return false; }
  }, "hidden packaged Electron page", 120_000);
  browser = await chromium.connectOverCDP("http://127.0.0.1:19104", { timeout: 5_000 });
  page = browser.contexts()[0].pages().find((item) => item.url().startsWith("app://jagentchill/"));
  assert.ok(page, "hidden packaged app page is available through CDP");
  await page.getByRole("heading", { name: "Join your tailnet" }).waitFor({ timeout: 45_000 });
  await page.screenshot({ path: shot("x0-first-launch-connection-choice.png"), fullPage: true });
  await page.getByText("Local", { exact: true }).last().click();
  await page.getByTestId("continue-local").click();
  await page.waitForURL(/\/home$/, { timeout: 45_000 });
  await waitFor(async () => { const status = await page.evaluate(() => window.jagentchillDesktop.gateway.getStatus()); return ["ready", "degraded"].includes(status.state) && status.port === 19100; }, "built-in host on 19100/19101", 120_000);
  await page.getByTestId("footer-settings").click();
  await page.getByTestId("settings-connections").waitFor({ timeout: 30_000 });
  const nav = page.getByTestId("settings-nav");
  const navText = await nav.innerText();
  check((navText.match(/Connections and devices/g) ?? []).length === 1, "Settings has exactly one Connections and devices entry under Host");
  check(!navText.includes("Personal\nConnections and devices") && await page.getByTestId("settings-devices").count() === 0, "there is no personal entry or separate Host Devices page");
  await page.screenshot({ path: shot("x5-settings-menu-one-host-entry.png"), fullPage: true });
  await page.getByTestId("settings-connections").click();
  await page.getByTestId("connections-section").waitFor();
  await page.getByTestId("devices-section").waitFor();
  await page.getByText("Local · This computer", { exact: true }).waitFor();
  check(await page.getByTestId(/host-connection-/).count() === 1, "Local mode renders one live Local row before tailnet is joined");
  await page.getByRole("button", { name: "Add connection", exact: true }).click();
  await page.getByRole("heading", { name: "Join your tailnet" }).waitFor();
  await page.getByTestId("tailscale-sign-in").click();
  await waitFor(() => existsSync(join(run, "opened-url.txt")), "fake login URL without opening a browser");
  check(readFileSync(join(run, "opened-url.txt"), "utf8").trim() === "https://login.tailscale.com/example-host-login", "interactive login uses the fake bridge URL without opening a browser");
  writeFileSync(state, "connected\n");
  await page.waitForURL(/\/settings\/host\/[^/]+\/connections$/, { timeout: 45_000 });
  await waitFor(async () => { const status = await page.evaluate(() => window.jagentchillDesktop.gateway.getStatus()); return ["ready", "degraded"].includes(status.state) && status.port === 19100; }, "Tailscale-mode host on 19100/19101", 120_000);
  await page.getByText("Tailscale · w8x2-host.ts.net:19100", { exact: true }).waitFor({ timeout: 30_000 });
  check(await page.getByTestId(/host-connection-/).count() === 2, "built-in connections are live Local and Tailscale rows, with no stale saved address");

  await page.getByRole("button", { name: "Pair a device", exact: true }).click();
  const offerUrl = await page.getByLabel("Pairing link", { exact: true }).inputValue();
  const decoded = decodeOffer(offerUrl);
  assert.ok(decoded.ok, "the host pairing sheet provides a decodable offer");
  const phone = new DeviceSim("http://127.0.0.1:19102", "Fake tailnet phone");
  const requestId = await phone.enrolUntilProved(decoded.offer);
  const codeCell = page.getByRole("button", { name: "Verification code" });
  await codeCell.waitFor({ timeout: 30_000 });
  const code = (await codeCell.textContent() ?? "").replace(/\D/g, "");
  assert.match(code, /^\d{6}$/, "host shows the six-digit pairing code");
  const verified = await phone.verify(decoded.offer, requestId, code);
  check(verified.status === 200, "second device passes the host's six-digit pairing check over fake tailnet ingress");
  const session = phone.connect(decoded.offer, { token: phone.token, clientInstanceId: "w8x2-fake-tailnet-phone" });
  const connected = await session.outcome;
  assert.ok(connected.ready, `second device authenticated over fake tailnet ingress: ${JSON.stringify(connected.close ?? {})}`);
  await page.getByText("Fake tailnet phone", { exact: true }).waitFor({ timeout: 30_000 });
  await page.getByText("Tailscale", { exact: true }).last().waitFor();
  check(await page.getByTestId("devices-content").getByText("Local", { exact: true }).count() >= 1, "the desktop app device row identifies its loopback path as Local");
  check(await page.getByTestId("devices-content").getByText("Tailscale", { exact: true }).count() >= 1, "the paired phone row identifies its authenticated path as Tailscale");
  await page.screenshot({ path: shot("x1-connections-and-devices-wide.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("devices-content").getByText("Connected via", { exact: true }).first().waitFor();
  check(await page.getByRole("table", { name: "Devices" }).count() === 0 && await page.getByTestId("devices-content").getByText("Fake tailnet phone", { exact: true }).count() === 1, "390 px browser-only layout stacks device facts and keeps the tailnet path visible");
  await page.screenshot({ path: shot("x4-connections-and-devices-390-browser-only.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });

  const tailnetRow = page.getByTestId(/host-connection-tailnet:/);
  await tailnetRow.getByRole("button", { name: "Remove", exact: true }).click();
  await page.getByRole("heading", { name: "Remove this connection?" }).waitFor();
  check(await page.getByText("Phones will no longer reach this computer until they sign in to Tailscale again.", { exact: true }).count() === 1, "Tailscale removal explains phone reachability before confirming");
  await page.getByRole("button", { name: "Remove", exact: true }).last().click();
  await page.getByRole("heading", { name: "Join your tailnet" }).waitFor({ timeout: 30_000 });
  check(await page.evaluate(() => window.jagentchillDesktop.connectionMode.get()) === null, "removing Tailscale disables the listener and clears the saved connection mode");
  await page.screenshot({ path: shot("x2-remove-tailscale-returns-to-sign-in.png"), fullPage: true });
  session.ws.close();

  await page.getByText("Local", { exact: true }).last().click();
  await page.getByTestId("continue-local").click();
  await page.waitForURL(/\/home$/, { timeout: 45_000 });
  await waitFor(async () => { const status = await page.evaluate(() => window.jagentchillDesktop.gateway.getStatus()); return ["ready", "degraded"].includes(status.state) && status.port === 19100; }, "Local-mode host restart", 120_000);
  await page.getByTestId("footer-settings").click();
  await page.getByTestId("settings-connections").click();
  await page.getByText("Local · This computer", { exact: true }).waitFor();
  const localRow = page.getByTestId(/host-connection-local:/);
  await localRow.getByRole("button", { name: "Remove", exact: true }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).last().click();
  await page.getByRole("heading", { name: "Join your tailnet" }).waitFor({ timeout: 30_000 });
  check(await page.evaluate(() => window.jagentchillDesktop.connectionMode.get()) === null, "removing the last Local row clears the mode and returns to sign-in");
  await page.screenshot({ path: shot("x3-remove-last-local-returns-to-sign-in.png"), fullPage: true });

  console.log(`PASS connections-devices-x: ${assertions} assertions; packaged Electron; ports 19100-19104; fake bridge and paired fake tailnet phone; screenshots ${screenshots}`);
} catch (error) {
  console.error("connections-devices-x failure", page?.url(), page ? (await page.locator("body").innerText().catch(() => "")).slice(0, 1800) : "");
  throw error;
} finally {
  if (page && !page.isClosed()) await page.screenshot({ path: shot("failure.png"), fullPage: true }).catch(() => undefined);
  if (browser) await browser.close().catch(() => undefined);
  if (app?.exitCode === null) {
    app.kill("SIGTERM");
    await Promise.race([new Promise((done) => app.once("exit", done)), new Promise((done) => setTimeout(done, 35_000))]);
    if (app.exitCode === null) app.kill("SIGKILL");
  }
}
