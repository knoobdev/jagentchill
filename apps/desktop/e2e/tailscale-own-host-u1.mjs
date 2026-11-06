import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright";

const desktopRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(desktopRoot, "../..");
const runDir = process.env.JAGENTCHILL_E2E_RUN_DIR ? resolve(repoRoot, process.env.JAGENTCHILL_E2E_RUN_DIR) : join(repoRoot, ".dev/run-w8u-really-connected-1");
const webDir = process.env.JAGENTCHILL_WEB_DIR ? resolve(repoRoot, process.env.JAGENTCHILL_WEB_DIR) : join(repoRoot, ".dev/build/web-w8u-really-connected-1");
if (existsSync(runDir)) throw new Error(`Refusing to reuse existing run directory: ${runDir}`);
if (!existsSync(join(webDir, "index.html"))) throw new Error(`Build the Electron web export first: ${webDir}`);
const userData = join(runDir, "user-data"), tempHome = join(runDir, "home"), library = join(runDir, "library"), stateFile = join(runDir, "tailnet-state.txt");
const bridge = join(desktopRoot, "test/fixtures/fake-tsnet-stateful.mjs"), bridgeRunner = join(runDir, "fake-tsnet-bridge");
const evidence = join(repoRoot, ".dev/evidence");
mkdirSync(userData, { recursive: true }); mkdirSync(tempHome, { recursive: true }); mkdirSync(library, { recursive: true }); mkdirSync(evidence, { recursive: true });
writeFileSync(stateFile, "login\n");
const identityDir = join(userData, "identity");
mkdirSync(identityDir, { recursive: true, mode: 0o700 });
const fixtureKey = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
writeFileSync(join(identityDir, "device.key"), JSON.stringify({ v: 1, protection: "file", data: Buffer.from(fixtureKey).toString("base64") }), { mode: 0o600 });
writeFileSync(bridgeRunner, `#!/usr/bin/env node\nimport ${JSON.stringify(bridge)};\n`, { mode: 0o755 });
chmodSync(bridgeRunner, 0o755);
const env = {
  ...process.env,
  HOME: tempHome, JAGENTCHILL_UNATTENDED: "1", JAGENTCHILL_USER_DATA: userData, JAGENTCHILL_LIBRARY_DIR: library,
  JAGENTCHILL_WEB_DIR: webDir, JAGENTCHILL_PORT: "18950", JAGENTCHILL_GATEWAY_PORT: "18951",
  JAGENTCHILL_TSNET_BRIDGE_BIN: bridgeRunner, JAGENTCHILL_E2E_RUN_DIR: runDir,
  TSNET_TEST_STATE_FILE: stateFile, TSNET_TEST_PROXY_TARGET: "127.0.0.1:18952", TSNET_TEST_PROXY_PORT: "18954",
  TSNET_TEST_TAILNET_ADDRESS: "jc-test.tailnet.ts.net:18952", TSNET_TEST_PROXY_TRACE: join(runDir, "proxy-trace.log"),
  JAGENTCHILL_TEST_OPEN_EXTERNAL_FILE: join(runDir, "opened-links.txt"),
};
delete env.ELECTRON_RUN_AS_NODE;
const waitFor = async (predicate, label, timeout = 60_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await predicate(); if (value) return value; await new Promise((resolveWait) => setTimeout(resolveWait, 100)); }
  throw new Error(`Timed out waiting for ${label}`);
};
let app;
let assertions = 0;
const check = (condition, label) => { assert.ok(condition, label); assertions++; };
try {
  app = await _electron.launch({ cwd: desktopRoot, args: [".", "--headless"], env, timeout: 150_000 });
  const page = await app.firstWindow({ timeout: 150_000 });
  let websocketConnections = 0;
  page.on("websocket", () => { websocketConnections++; });
  page.on("pageerror", (error) => console.error(`renderer error: ${error.message}`));
  await page.getByRole("heading", { name: "Join your tailnet" }).waitFor({ timeout: 30_000 });
  await page.getByText("Local", { exact: true }).last().click();
  await page.getByTestId("continue-local").click();
  await page.waitForURL(/\/home$/, { timeout: 30_000 });
  const local = await waitFor(async () => { const status = await page.evaluate(() => window.jagentchillDesktop.gateway.getStatus()).catch(() => null); return status && ["ready", "degraded"].includes(status.state) ? status : null; }, "local built-in host", 120_000);
  check(local.port === 18950 && local.gatewayPort === 18951, "Local bootstrap uses only the assigned 18950/18951 ports");
  await page.getByTestId("connection-chip").getByText("Connected · Local", { exact: true }).waitFor({ timeout: 15_000 });
  await page.screenshot({ path: join(evidence, "w8v3-footer-local-connected.png"), fullPage: true });
  await page.goto(`app://jagentchill/settings/host/${local.gatewayId}/skills`);
  await page.getByRole("heading", { name: "Skills", exact: true }).waitFor({ timeout: 30_000 });
  const idleSocketCount = websocketConnections;
  await page.waitForTimeout(11_000);
  await page.screenshot({ path: join(evidence, "w8v4-skills-idle.png"), fullPage: true });
  check(websocketConnections === idleSocketCount, `Skills idle screen does not reconnect the host channel every five seconds (before=${idleSocketCount}, after=${websocketConnections})`);

  await page.goto("app://jagentchill/settings/devices");
  await page.waitForURL(/\/settings\/devices$/);
  const row = page.getByTestId(`paired-host-${local.gatewayId}`);
  await app.evaluate(() => { process.env.JAGENTCHILL_PORT = "18952"; process.env.JAGENTCHILL_GATEWAY_PORT = "18953"; });
  await page.screenshot({ path: join(evidence, "w8u1-own-host-devices-before-tailnet.png"), fullPage: true });
  console.log(`devices checkpoint: gateway=${local.gatewayId}; storeKeys=${JSON.stringify(await page.evaluate(() => window.jagentchillDesktop.secureStore.keys("host/")))}; rows=${await page.locator('[data-testid^="paired-host-"]').count()}; body=${(await page.locator("body").innerText()).slice(0, 500)}`);
  await row.waitFor({ state: "visible", timeout: 15_000 });
  await row.getByRole("button", { name: "Host options" }).click();
  await page.getByRole("menuitem", { name: "Switch to Tailscale" }).click();
  await page.waitForURL(/\/join-tailnet\?manage=1/, { timeout: 30_000 });
  writeFileSync(stateFile, "connected\n");
  await page.getByTestId("tailscale-sign-in").click();
  await page.waitForURL(/\/settings\/devices$/, { timeout: 60_000 });
  const tailnet = await waitFor(async () => {
    const status = await page.evaluate(() => window.jagentchillDesktop.gateway.getStatus()).catch(() => null);
    return status?.port === 18952 && status.gatewayPort === 18953 && ["ready", "degraded"].includes(status.state) ? status : null;
  }, "Tailscale-mode built-in host on 18952/18953");
  check(tailnet.port === 18952 && tailnet.gatewayPort === 18953, "Tailscale-mode host uses only the assigned 18952/18953 ports");
  const address = page.getByTestId(`paired-host-connection-${tailnet.gatewayId}`);
  await address.getByText(/jc-test\.tailnet\.ts\.net:18952/).waitFor({ timeout: 15_000 });
  check((await address.innerText()).includes("Tailscale"), "the built-in host row keeps its Tailscale address for other devices");

  await page.goto("app://jagentchill/home");
  await page.getByTestId("connection-chip").getByText("Connected · This computer (Tailscale on)", { exact: true }).waitFor({ timeout: 30_000 });
  await page.screenshot({ path: join(evidence, "w8v3-footer-tailscale-connected.png"), fullPage: true });

  const filmUrl = `app://jagentchill/h/${tailnet.gatewayId}/film`;
  await page.goto(filmUrl);
  await page.getByRole("heading", { name: "Film Studio" }).waitFor({ timeout: 30_000 });
  check(!(await page.locator("body").innerText()).includes("Requires a host"), "Film Studio opens from the desktop's authenticated session with its own host");
  const proxyTrace = existsSync(join(runDir, "proxy-trace.log")) ? readFileSync(join(runDir, "proxy-trace.log"), "utf8") : "";
  check(!proxyTrace.includes("dial jc-test.tailnet.ts.net:18952"), "the desktop's own host session never dials the host's Tailscale address through the outbound proxy");
  await page.getByTestId("connection-chip").getByText("Connected · This computer (Tailscale on)", { exact: true }).waitFor({ timeout: 15_000 });
  check(true, "the footer separates the authenticated local session from Tailscale reachability");
  await page.getByTestId("host-switcher").click();
  const selectedHostRow = page.getByTestId(`host-row-${tailnet.gatewayId}`);
  await selectedHostRow.waitFor({ timeout: 10_000 });
  check((await selectedHostRow.innerText()).includes("Local · Connected"), "the host switcher reports its authenticated loopback path and session state");
  await page.screenshot({ path: join(evidence, "w8u1-own-host-film-studio.png"), fullPage: true });
  console.log(`PASS tailscale-own-host-u1: ${assertions} assertions; own host stays on loopback in Tailscale mode; fake bridge only`);
} finally {
  if (app && app.process().exitCode === null) {
    await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
    await Promise.race([new Promise((resolveWait) => app.process().once("exit", resolveWait)), new Promise((resolveWait) => setTimeout(resolveWait, 45_000))]);
    if (app.process().exitCode === null) app.process().kill("SIGKILL");
  }
}
