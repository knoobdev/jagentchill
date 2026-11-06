import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const desktopRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(desktopRoot, "../..");
const run = join(repoRoot, ".dev/run-w8w2-host-settings-port-19100");
const userData = join(run, "user-data"), home = join(run, "home"), library = join(run, "library");
const state = join(run, "tailnet-state.txt"), fake = join(run, "fake-tsnet-bridge");
const screenshots = join(run, "screenshots");
const executable = join(repoRoot, ".dev/build/desktop-w8w2-host-settings/mac-arm64/JAgentChill.app/Contents/MacOS/JAgentChill");
const evidence = (name) => join(screenshots, name);
assert.ok(existsSync(executable), `packaged executable missing: ${executable}`);
assert.equal(existsSync(run), false, `run directory must be fresh: ${run}`);
mkdirSync(userData, { recursive: true }); mkdirSync(home, { recursive: true }); mkdirSync(library, { recursive: true }); mkdirSync(screenshots, { recursive: true });
writeFileSync(state, "login\n");
const bridge = join(desktopRoot, "test/fixtures/fake-tsnet-stateful.mjs");
writeFileSync(fake, `#!/bin/sh\nexec "${process.execPath}" "${bridge}"\n`);
chmodSync(fake, 0o755);

const env = {
  ...process.env,
  HOME: home,
  JAGENTCHILL_USER_DATA: userData,
  JAGENTCHILL_LIBRARY_DIR: library,
  JAGENTCHILL_UNATTENDED: "1",
  JAGENTCHILL_PORT: "19100",
  JAGENTCHILL_GATEWAY_PORT: "19101",
  JAGENTCHILL_TSNET_BRIDGE_BIN: fake,
  JAGENTCHILL_TEST_OPEN_EXTERNAL_FILE: join(run, "opened-url.txt"),
  TSNET_TEST_STATE_FILE: state,
  TSNET_TEST_PROXY_TARGET: "127.0.0.1:19100",
  TSNET_TEST_TAILNET_ADDRESS: "w8-host-settings.ts.net:19100",
  TSNET_TEST_PROXY_TRACE: join(run, "proxy-trace.txt"),
  TSNET_TEST_PROXY_PORT: "19103",
  FAKE_TSNET_FORWARD_PORT: "19102",
};
delete env.ELECTRON_RUN_AS_NODE;
const app = spawn(executable, ["--headless", "--remote-debugging-port=19104"], { env, stdio: ["ignore", "pipe", "pipe"] });
let browser;
let assertions = 0;
const check = (condition, label) => { assert.ok(condition, label); assertions++; };
const waitFor = async (read, label, timeout = 45_000) => {
  const limit = Date.now() + timeout;
  while (Date.now() < limit) {
    const value = await read();
    if (value) return value;
    await new Promise((done) => setTimeout(done, 150));
  }
  throw new Error(`timed out waiting for ${label}`);
};

try {
  await waitFor(async () => {
    try { return (await (await fetch("http://127.0.0.1:19104/json/list")).json()).some((item) => item.type === "page" && item.url.startsWith("app://jagentchill/")); }
    catch { return false; }
  }, "packaged app's hidden Electron page", 120_000);
  browser = await chromium.connectOverCDP("http://127.0.0.1:19104");
  const page = browser.contexts()[0].pages().find((item) => item.url().startsWith("app://jagentchill/"));
  assert.ok(page, "hidden packaged app page is available through CDP");
  await page.getByRole("heading", { name: "Join your tailnet" }).waitFor({ timeout: 45_000 });
  await page.getByText("Local", { exact: true }).last().click();
  await page.getByTestId("continue-local").click();
  await waitFor(async () => (await page.evaluate(() => window.jagentchillDesktop.gateway.getStatus())).state === "ready", "the bundled host on port 19100", 120_000);
  await page.getByTestId("footer-settings").click();
  await page.getByTestId("settings-connections").click();
  await page.getByRole("heading", { name: "Connections", exact: true }).waitFor();
  await page.getByText("Local (This computer)", { exact: true }).waitFor();
  check(await page.getByText("Local (This computer)", { exact: true }).count() === 1, "Host ▸ Connections is reachable and labels the built-in local connection");
  check(await page.getByRole("button", { name: "Remove", exact: true }).count() === 0, "the built-in local connection has no Remove action");
  await page.screenshot({ path: evidence("w1-host-connections-local.png"), fullPage: true });

  await page.getByRole("button", { name: "Add connection", exact: true }).click();
  await page.getByTestId("add-connection-method-direct").waitFor();
  check(await page.getByTestId("add-connection-method-tailscale").count() === 1, "Add connection opens the shared method sheet with Pair over Tailscale");
  check(await page.getByTestId("add-connection-method-paste").count() === 1, "the shared method sheet includes Paste pairing link");
  check(await page.getByTestId("add-connection-method-scan").count() === 0, "the desktop method sheet has no phone QR scanner option");
  await page.screenshot({ path: evidence("w2-add-connection-method-sheet.png"), fullPage: true });
  await page.getByTestId("add-connection-method-direct").click();
  await page.getByLabel("Host", { exact: true }).fill("127.0.0.1");
  await page.getByLabel("Port", { exact: true }).fill("19100");
  await page.getByRole("button", { name: "Probe host", exact: true }).click();
  await page.getByTestId(/host-connection-/).filter({ hasText: "Local network (127.0.0.1:19100)" }).waitFor({ timeout: 20_000 });
  check(await page.getByTestId(/host-connection-/).count() === 2, "probing the viewed host's identity adds a second connection to the same host record");
  check(await page.getByRole("button", { name: "Remove", exact: true }).count() === 1, "Remove is offered for the extra connection but not the built-in local route");
  await page.screenshot({ path: evidence("w1-host-connections-two-routes.png"), fullPage: true });
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await page.getByRole("button", { name: "Remove connection", exact: true }).click();
  await page.getByText("Local (This computer)", { exact: true }).waitFor();

  await page.getByRole("button", { name: "Connect with Tailscale", exact: true }).click();
  await page.getByTestId("tailscale-sign-in").click();
  await waitFor(() => existsSync(join(run, "opened-url.txt")), "fake sign-in URL without opening a browser", 20_000);
  writeFileSync(state, "connected\n");
  await page.getByTestId("host-tailscale-status").getByText("Connected", { exact: true }).waitFor({ timeout: 30_000 });
  check(await page.getByRole("button", { name: "Manage connection", exact: true }).count() === 1, "connected Tailscale status shows the Manage connection action");
  await page.screenshot({ path: evidence("w3-host-tailscale-connected.png"), fullPage: true });

  await page.getByRole("button", { name: "Add connection", exact: true }).click();
  await page.getByTestId("add-connection-method-tailscale").click();
  await page.getByRole("heading", { name: "Pair a device", exact: true }).waitFor({ timeout: 30_000 });
  await page.getByLabel("Pairing link", { exact: true }).waitFor();
  check(await page.getByLabel("Pairing QR code", { exact: true }).count() === 1, "Pair over Tailscale opens this host's offer with a QR code");
  check(await page.getByRole("button", { name: "Copy link", exact: true }).count() === 1, "the desktop pairing offer exposes Copy link");
  await page.screenshot({ path: evidence("w2-pair-over-tailscale-offer.png"), fullPage: true });
  await page.goto("app://jagentchill/settings/devices");
  await page.getByText("Hosts paired with this device", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Connect a host", exact: true }).last().click();
  await page.getByTestId("add-connection-method-direct").waitFor();
  check(await page.getByTestId("add-connection-method-paste").count() === 1, "Connections and devices opens the same AddHostMethodModal flow");
  await page.screenshot({ path: evidence("w2-connect-a-host-method-sheet.png"), fullPage: true });

  console.log(`PASS host-settings-w: ${assertions} assertions; packaged Electron; host/Gateway ports 19100/19101; fake Tailscale bridge and in-process host health probe; no real tailnet or provider calls; screenshots ${screenshots}`);
} finally {
  if (browser) await browser.close().catch(() => undefined);
  if (app.exitCode === null) {
    app.kill("SIGTERM");
    await Promise.race([new Promise((done) => app.once("exit", done)), new Promise((done) => setTimeout(done, 35_000))]);
    if (app.exitCode === null) app.kill("SIGKILL");
  }
}
