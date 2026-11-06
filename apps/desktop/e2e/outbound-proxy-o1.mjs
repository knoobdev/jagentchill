import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright";

const desktopRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(desktopRoot, "../..");
const runDir = process.env.JAGENTCHILL_E2E_RUN_DIR ? resolve(repoRoot, process.env.JAGENTCHILL_E2E_RUN_DIR) : join(repoRoot, ".dev/run-w8q-connections-page-34");
const webDir = process.env.JAGENTCHILL_WEB_DIR ? resolve(repoRoot, process.env.JAGENTCHILL_WEB_DIR) : join(repoRoot, ".dev/build/web-w8q-connections-page-35");
if (existsSync(runDir)) throw new Error(`Refusing to reuse test directory: ${runDir}`);
if (!existsSync(join(webDir, "index.html"))) throw new Error(`Build the Electron web export first: ${webDir}`);
const userData = join(runDir, "user-data"), library = join(runDir, "library"), remoteData = join(runDir, "remote-host"), bridgeState = join(runDir, "tsnet-state");
mkdirSync(userData, { recursive: true }); mkdirSync(library, { recursive: true }); mkdirSync(remoteData, { recursive: true });
writeFileSync(bridgeState, "connected\n");
const bridgeWrapper = join(runDir, "fake-tsnet-bridge");
writeFileSync(bridgeWrapper, `#!/bin/sh\nexec "${process.execPath}" "${join(desktopRoot, "test/fixtures/fake-tsnet-stateful.mjs")}"\n`);
chmodSync(bridgeWrapper, 0o755);
const remoteFixture = join(desktopRoot, "e2e/fixtures/remote-tailnet-host.mjs");
const env = {
  ...process.env,
  JAGENTCHILL_UNATTENDED: "1", JAGENTCHILL_USER_DATA: userData, JAGENTCHILL_LIBRARY_DIR: library, JAGENTCHILL_WEB_DIR: webDir,
  JAGENTCHILL_PORT: "18955", JAGENTCHILL_GATEWAY_PORT: "18956", JAGENTCHILL_TSNET_BRIDGE_BIN: bridgeWrapper,
  JAGENTCHILL_E2E_RUN_DIR: runDir, TSNET_TEST_STATE_FILE: bridgeState, TSNET_TEST_PROXY_TARGET: "127.0.0.1:18955",
  TSNET_TEST_TAILNET_ADDRESS: "jc-test.tailnet.ts.net:18955",
  TSNET_TEST_PROXY_ROUTES: JSON.stringify({ "remote-fixture.tailnet.ts.net:18957": "127.0.0.1:18957" }),
  TSNET_TEST_PROXY_TRACE: join(runDir, "proxy-upgrades.log"),
};
delete env.ELECTRON_RUN_AS_NODE;
const fixtureTrace = join(runDir, "fixture-requests.log");
const fixtureEnv = { ...process.env, JAGENTCHILL_PORT: "18957", JAGENTCHILL_GATEWAY_PORT: "18958", JAGENTCHILL_DATA_DIR: remoteData, JAGENTCHILL_E2E_RUN_DIR: runDir, JAGENTCHILL_E2E_TRACE: fixtureTrace };
const fixture = spawn(process.execPath, [remoteFixture, "--port", "18957"], { cwd: repoRoot, env: fixtureEnv, stdio: ["ignore", "pipe", "pipe"] });
let app;
let assertions = 0;
const check = (condition, message) => { assert.ok(condition, message); assertions++; };
const waitFor = async (predicate, label, timeout = 30_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const result = await predicate(); if (result) return result; await new Promise((resolveWait) => setTimeout(resolveWait, 100)); }
  throw new Error(`Timed out waiting for ${label}`);
};
const stop = async (child) => {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolveWait) => child.once("exit", resolveWait));
  child.kill("SIGTERM");
  await Promise.race([exited, new Promise((resolveWait) => setTimeout(resolveWait, 10_000))]);
  if (child.exitCode === null) child.kill("SIGKILL");
};
const screenshot = join(repoRoot, ".dev/evidence/w8q-o1-add-host-through-tailnet-proxy.png");

try {
  await waitFor(async () => { try { return (await fetch("http://127.0.0.1:18957/__fixture/offer")).ok; } catch { return false; } }, "remote pairing fixture");
  app = await _electron.launch({ cwd: desktopRoot, args: [".", "--headless"], env, timeout: 150_000 });
  const page = await app.firstWindow({ timeout: 150_000 });
  page.on("pageerror", (error) => console.error(`renderer error: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") console.error(`renderer console: ${message.text()}`); });
  await page.getByRole("heading", { name: "Join your tailnet" }).waitFor({ timeout: 30_000 });
  await page.getByText("Local", { exact: true }).last().click();
  await page.getByTestId("continue-local").click();
  await page.waitForURL(/\/home$/, { timeout: 30_000 });
  const local = await waitFor(async () => { const value = await page.evaluate(() => window.jagentchillDesktop.gateway.getStatus()); return value.state === "ready" ? value : null; }, "built-in host startup", 120_000);
  check(local.port === 18955 && local.gatewayPort === 18956, "built-in host uses the assigned 18955/18956 ports");

  await page.evaluate(() => window.jagentchillDesktop.connectionMode.set("tailscale"));
  await waitFor(async () => { try { return (await page.evaluate(() => window.jagentchillDesktop.tailnet.getStatus())).connected; } catch { return false; } }, "fake tailnet and loopback proxy", 45_000);
  const credentials = await waitFor(async () => { try { return await page.evaluate(() => window.jagentchillDesktop.tailnet.getProxyCredentials()); } catch { return null; } }, "proxy credentials after CSP reload");
  check(Number.isInteger(credentials?.port) && credentials.port > 0 && credentials.secret.length >= 40, "desktop IPC supplies the active fake loopback proxy credentials");

  const offer = await (await fetch("http://127.0.0.1:18957/__fixture/offer")).json();
  const encodedOffer = offer.url.slice(offer.url.indexOf("offer=") + 6);
  const decoded = JSON.parse(Buffer.from(encodedOffer, "base64url").toString("utf8"));
  check(decoded.addresses.length === 1 && decoded.addresses[0].kind === "tailnet" && decoded.addresses[0].url.includes("remote-fixture.tailnet.ts.net:18957"), "the remote pairing fixture is reachable only through its fake tailnet address");

  await page.evaluate(() => window.jagentchillDesktop.menu.invoke("app.settings.host"));
  await page.waitForURL(/\/settings\/devices$/);
  await page.getByRole("button", { name: "Connect a host", exact: true }).last().click();
  await page.getByTestId("pairing-link-input").fill(offer.url);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("heading", { name: /Enter the code shown next to/ }).waitFor({ timeout: 45_000 });
  const pending = await waitFor(async () => {
    const value = await (await fetch("http://127.0.0.1:18957/__fixture/pending")).json();
    return value.requests?.[0];
  }, "remote host's pairing challenge");
  check(/^\d{6}$/.test(pending.code), "remote tailnet host produced a six-digit confirmation code through proxied HTTP");
  await page.getByLabel("Verification code", { exact: true }).fill(pending.code);
  try { await page.getByLabel("Verification code", { exact: true }).waitFor({ state: "hidden", timeout: 45_000 }); }
  catch { console.error(`pairing screen after verify: ${await page.locator("body").innerText()}`); throw new Error("pairing confirmation did not finish"); }
  await page.evaluate(() => window.jagentchillDesktop.menu.invoke("app.settings.host"));
  await page.waitForURL(/\/settings\/devices$/, { timeout: 45_000 });
  const row = page.getByTestId(`paired-host-${offer.gatewayId}`);
  await row.waitFor({ timeout: 45_000 });
  await row.getByText("Connected", { exact: true }).waitFor({ timeout: 45_000 });
  await row.getByText("Tailscale", { exact: true }).waitFor();
  await row.getByText("remote-fixture.tailnet.ts.net:18957", { exact: true }).waitFor();
  check(true, "the remote host is connected through authenticated loopback WebSocket proxy and saved with its typed Tailscale route");
  await page.screenshot({ path: screenshot, fullPage: true });
  console.log(`PASS outbound-proxy-o1: ${assertions} assertions; Electron Add a host paired a tailnet-only fixture through authenticated loopback HTTP and WebSocket proxy; fixture host only, no real tailnet or provider/model calls`);
} finally {
  let electronProcess;
  try { electronProcess = app?.process(); } catch { electronProcess = undefined; }
  if (electronProcess && electronProcess.exitCode === null) {
    const exited = new Promise((resolveWait) => electronProcess.once("exit", resolveWait));
    await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
    await Promise.race([exited, new Promise((resolveWait) => setTimeout(resolveWait, 45_000))]);
    if (electronProcess.exitCode === null) electronProcess.kill("SIGKILL");
  }
  await stop(fixture);
  let listeners = "";
  try { listeners = execFileSync("lsof", ["-nP", "-iTCP:18955-18959", "-sTCP:LISTEN"], { encoding: "utf8" }); } catch (error) { listeners = String(error.stdout ?? ""); }
  check(!/LISTEN/.test(listeners), "no process from this test remains listening on 18955–18959");
}
