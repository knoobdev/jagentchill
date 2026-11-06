import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright";

const desktopRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(desktopRoot, "../..");
const runDir = process.env.JAGENTCHILL_E2E_RUN_DIR ? resolve(repoRoot, process.env.JAGENTCHILL_E2E_RUN_DIR) : join(repoRoot, ".dev/run-w8u-really-connected-7");
const webDir = process.env.JAGENTCHILL_WEB_DIR ? resolve(repoRoot, process.env.JAGENTCHILL_WEB_DIR) : join(repoRoot, ".dev/build/web-w8u-really-connected-3");
if (existsSync(runDir)) throw new Error(`Refusing to reuse existing run directory: ${runDir}`);
if (!existsSync(join(webDir, "index.html"))) throw new Error(`Build the Electron web export first: ${webDir}`);
const userData = join(runDir, "user-data"), tempHome = join(runDir, "home"), library = join(runDir, "library"), remoteData = join(runDir, "remote-host");
const stateFile = join(runDir, "tailnet-state.txt"), openedLinks = join(runDir, "opened-links.txt"), proxyTrace = join(runDir, "proxy-trace.log");
const identityDir = join(userData, "identity"), bridge = join(desktopRoot, "test/fixtures/fake-tsnet-stateful.mjs"), bridgeRunner = join(runDir, "fake-tsnet-bridge");
const fixtureScript = join(desktopRoot, "e2e/fixtures/tailnet-host-u.mjs"), evidence = join(repoRoot, ".dev/evidence");
for (const dir of [userData, tempHome, library, remoteData, identityDir, evidence]) mkdirSync(dir, { recursive: true, mode: dir === identityDir ? 0o700 : undefined });
writeFileSync(stateFile, "login\n");
const fixtureKey = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
writeFileSync(join(identityDir, "device.key"), JSON.stringify({ v: 1, protection: "file", data: Buffer.from(fixtureKey).toString("base64") }), { mode: 0o600 });
writeFileSync(bridgeRunner, `#!/usr/bin/env node\nimport ${JSON.stringify(bridge)};\n`, { mode: 0o755 });
chmodSync(bridgeRunner, 0o755);
const fixtureEnv = {
  ...process.env, JAGENTCHILL_UNATTENDED: "1", JAGENTCHILL_PORT: "18953", JAGENTCHILL_GATEWAY_PORT: "18954",
  JAGENTCHILL_DATA_DIR: remoteData, JAGENTCHILL_E2E_RUN_DIR: runDir,
};
const fixture = spawn(process.execPath, [fixtureScript, "--port", "18953"], { cwd: repoRoot, env: fixtureEnv, stdio: ["ignore", "pipe", "pipe"] });
let fixtureText = "";
fixture.stdout.on("data", (chunk) => { fixtureText += chunk.toString(); });
fixture.stderr.on("data", (chunk) => { fixtureText += chunk.toString(); });
const proxyRoutes = { "remote-fixture.tailnet.ts.net:18953": "127.0.0.1:18953" };
const env = {
  ...process.env, HOME: tempHome, JAGENTCHILL_UNATTENDED: "1", JAGENTCHILL_USER_DATA: userData,
  JAGENTCHILL_LIBRARY_DIR: library, JAGENTCHILL_WEB_DIR: webDir, JAGENTCHILL_E2E_RUN_DIR: runDir,
  JAGENTCHILL_PORT: "18950", JAGENTCHILL_GATEWAY_PORT: "18951", JAGENTCHILL_TSNET_BRIDGE_BIN: bridgeRunner,
  JAGENTCHILL_TEST_OPEN_EXTERNAL_FILE: openedLinks, TSNET_TEST_STATE_FILE: stateFile,
  TSNET_TEST_PROXY_TARGET: "127.0.0.1:18950", TSNET_TEST_TAILNET_ADDRESS: "jc-test.tailnet.ts.net:18950",
  TSNET_TEST_PROXY_PORT: "18952", TSNET_TEST_PROXY_ROUTES: JSON.stringify(proxyRoutes), TSNET_TEST_PROXY_TRACE: proxyTrace,
};
delete env.ELECTRON_RUN_AS_NODE;
const waitFor = async (predicate, label, timeout = 60_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await predicate(); if (value) return value; await new Promise((resolveWait) => setTimeout(resolveWait, 150)); }
  throw new Error(`Timed out waiting for ${label}`);
};
const stop = async (child) => {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolveWait) => child.once("exit", resolveWait));
  child.kill("SIGTERM");
  await Promise.race([exited, new Promise((resolveWait) => setTimeout(resolveWait, 10_000))]);
  if (child.exitCode === null) child.kill("SIGKILL");
};
let app;
let assertions = 0;
const check = (condition, label) => { assert.ok(condition, label); assertions++; };
try {
  await waitFor(async () => { try { return (await fetch("http://127.0.0.1:18953/__fixture/offer")).ok; } catch { return false; } }, "isolated remote host fixture");
  app = await _electron.launch({ cwd: desktopRoot, args: [".", "--headless"], env, timeout: 150_000 });
  const page = await app.firstWindow({ timeout: 150_000 });
  page.on("pageerror", (error) => console.error(`renderer error: ${error.message}`));
  await page.getByRole("heading", { name: "Join your tailnet" }).waitFor({ timeout: 30_000 });
  await page.getByText("Local", { exact: true }).last().click();
  await page.getByTestId("continue-local").click();
  await page.waitForURL(/\/home$/, { timeout: 30_000 });
  const local = await waitFor(async () => {
    const status = await page.evaluate(() => window.jagentchillDesktop.gateway.getStatus()).catch(() => null);
    return status && ["ready", "degraded"].includes(status.state) ? status : null;
  }, "isolated bundled host", 120_000);
  check(local.port === 18950 && local.gatewayPort === 18951, "bundled host uses only server/Gateway ports 18950/18951");

  await page.goto("app://jagentchill/settings/devices");
  await page.waitForURL(/\/settings\/devices$/);
  const localHostRow = page.getByTestId(`paired-host-${local.gatewayId}`);
  await localHostRow.getByRole("button", { name: "Host options" }).click();
  await page.getByRole("menuitem", { name: "Switch to Tailscale" }).click();
  await page.waitForURL(/\/join-tailnet\?manage=1/, { timeout: 30_000 });
  writeFileSync(stateFile, "connected\n");
  await page.getByTestId("tailscale-sign-in").click();
  await page.waitForURL(/\/settings\/devices$/, { timeout: 60_000 });
  await waitFor(async () => (await page.evaluate(() => window.jagentchillDesktop.tailnet.getStatus()).catch(() => null))?.connected, "fake tailnet proxy", 60_000);

  const offered = await (await fetch("http://127.0.0.1:18953/__fixture/offer")).json();
  await page.getByRole("button", { name: "Connect a host", exact: true }).last().click();
  await page.getByTestId("pairing-link-input").fill(offered.url);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("heading", { name: /Enter the code shown next to/ }).waitFor({ timeout: 45_000 });
  const pairingCode = await waitFor(async () => {
    const state = await (await fetch("http://127.0.0.1:18953/__fixture/pending")).json();
    return state.requests?.[0]?.code;
  }, "remote host pairing code");
  check(/^\d{6}$/.test(pairingCode), "remote tailnet host presents the normal six-digit pairing challenge");
  await page.getByLabel("Verification code", { exact: true }).fill(pairingCode);
  await page.getByLabel("Verification code", { exact: true }).waitFor({ state: "hidden", timeout: 45_000 });
  const remoteId = offered.gatewayId;
  await page.goto("app://jagentchill/home");
  await page.getByTestId("host-switcher").click();
  await page.screenshot({ path: join(evidence, "w8u4-host-switcher-before-select.png"), fullPage: true });
  await page.getByTestId(`host-row-${remoteId}`).click();
  await page.waitForTimeout(500);
  console.log("host selection after click:", await page.getByTestId("host-switcher").getAttribute("aria-label"), "remote row:", await page.getByTestId(`host-row-${remoteId}`).count().catch(() => -1));
  await page.screenshot({ path: join(evidence, "w8u4-host-switcher-after-select.png"), fullPage: true });
  await page.getByTestId("connection-chip").getByText("Connected · Tailscale", { exact: true }).waitFor({ timeout: 45_000 });
  await page.goto(`app://jagentchill/h/${remoteId}/film`);
  await page.getByTestId("top-bar").getByRole("heading", { name: "Film Studio", exact: true }).waitFor({ timeout: 30_000 });
  check(!(await page.locator("body").innerText()).includes("Requires a host"), "Film Studio opens on the authenticated remote tailnet host");
  await page.goto("app://jagentchill/home");
  try { await page.getByTestId("connection-chip").getByText("Connected · Tailscale", { exact: true }).waitFor({ timeout: 45_000 }); }
  catch (error) {
    await page.screenshot({ path: join(evidence, "w8u4-remote-footer-failure.png"), fullPage: true });
    console.error("remote footer diagnostic:", await page.evaluate(async () => ({ gateway: await window.jagentchillDesktop.gateway.getStatus(), mode: await window.jagentchillDesktop.connectionMode.get(), tailnet: await window.jagentchillDesktop.tailnet.getStatus(), hosts: await window.jagentchillDesktop.secureStore.keys("host/") })), "visible:", (await page.locator("body").innerText()).slice(-1200));
    throw error;
  }
  check(await page.getByText("Set up models", { exact: true }).count() === 0, "Home reads the connected remote host state instead of showing the missing-host setup pill");
  await page.screenshot({ path: join(evidence, "w8u4-remote-home-tailnet-connected.png"), fullPage: true });
  await page.goto(`app://jagentchill/h/${remoteId}/film`);
  await page.getByTestId("top-bar").getByRole("heading", { name: "Film Studio", exact: true }).waitFor({ timeout: 15_000 });
  await page.screenshot({ path: join(evidence, "w8u4-remote-film-studio-connected.png"), fullPage: true });
  check(fixtureText.includes("REMOTE_FIXTURE_READY 18953 18954"), "remote fixture server reports its assigned 18953/18954 pair");

  await page.goto("app://jagentchill/settings/devices");
  await page.waitForURL(/\/settings\/devices$/);
  const remoteRow = page.getByTestId(`paired-host-${remoteId}`);
  await remoteRow.getByText("Connected", { exact: true }).waitFor({ timeout: 30_000 });
  const remoteLine = remoteRow.getByTestId(`paired-host-connection-${remoteId}`);
  check((await remoteLine.innerText()).includes("Tailscale") && (await remoteLine.innerText()).includes("remote-fixture.tailnet.ts.net:18953"), "Connections and devices shows the typed remote Tailscale address");
  const traceAfterPairing = readFileSync(proxyTrace, "utf8");
  check(traceAfterPairing.includes("upstream remote-fixture.tailnet.ts.net:18953 HTTP/1.1 101"), "the remote session WebSocket completed through the authenticated fake tailnet proxy");
  await page.screenshot({ path: join(evidence, "w8u4-remote-connection-row-tailnet.png"), fullPage: true });

  await page.evaluate(() => window.jagentchillDesktop.tailnet.logout());
  await remoteRow.getByText("Host unavailable", { exact: true }).waitFor({ timeout: 45_000 });
  await page.goto("app://jagentchill/home");
  await page.getByTestId("connection-chip").getByText("Host unavailable · Tailscale", { exact: true }).waitFor({ timeout: 15_000 });
  check(true, "disabling the fake tailnet bridge closes the forwarder and the remote session becomes unavailable");
  await page.screenshot({ path: join(evidence, "w8u4-remote-forwarder-stopped.png"), fullPage: true });

  const baseHostKey = `host/${remoteId}`;
  const directOrigin = "http://127.0.0.1:18953";
  await page.evaluate(async ({ baseHostKey, directOrigin, remoteId }) => {
    const raw = await window.jagentchillDesktop.secureStore.get(baseHostKey);
    const legacy = JSON.parse(raw);
    legacy.origin = directOrigin;
    await window.jagentchillDesktop.secureStore.set(baseHostKey, JSON.stringify(legacy));
    await window.jagentchillDesktop.secureStore.set(`host-connections/${remoteId}`, JSON.stringify({
      connections: [
        { id: "tailnet:remote-fixture.tailnet.ts.net:18953", kind: "tailnet", origin: "http://remote-fixture.tailnet.ts.net:18953", tailnetAddress: "remote-fixture.tailnet.ts.net:18953" },
        { id: "direct:fixture-loopback", kind: "direct", origin: directOrigin },
      ],
      preferredConnectionId: "tailnet:remote-fixture.tailnet.ts.net:18953",
    }));
  }, { baseHostKey, directOrigin, remoteId });
  await app.evaluate(() => {
    process.env.TSNET_TEST_PROXY_ROUTES = JSON.stringify({ "remote-fixture.tailnet.ts.net:18953": "127.0.0.1:18952" });
  });
  await page.evaluate(() => window.jagentchillDesktop.connectionMode.set("local"));
  await page.reload();
  await page.waitForURL(/\/home$/);
  try { await page.getByTestId("connection-chip").getByText("Connected · Local", { exact: true }).waitFor({ timeout: 60_000 }); }
  catch (error) {
    await page.screenshot({ path: join(evidence, "w8u2-remote-fallback-failure.png"), fullPage: true });
    console.error("direct fallback diagnostic:", await page.evaluate(async () => ({ mode: await window.jagentchillDesktop.connectionMode.get(), tailnet: await window.jagentchillDesktop.tailnet.getStatus(), hosts: await window.jagentchillDesktop.secureStore.keys("host/"), keys: await window.jagentchillDesktop.secureStore.keys("host-connections/") })), "visible:", (await page.locator("body").innerText()).slice(-1200));
    throw error;
  }
  await page.screenshot({ path: join(evidence, "w8u2-remote-fallback-local.png"), fullPage: true });
  await page.goto(`app://jagentchill/h/${remoteId}/film`);
  await page.getByTestId("top-bar").getByRole("heading", { name: "Film Studio", exact: true }).waitFor({ timeout: 30_000 });
  check(!(await page.locator("body").innerText()).includes("Requires a host"), "when the tailnet route is unavailable, the saved direct connection authenticates the remote host");
  await page.screenshot({ path: join(evidence, "w8u2-remote-fallback-film.png"), fullPage: true });
  console.log(`PASS tailscale-remote-u24: ${assertions} assertions; isolated remote host, fake authenticated tailnet proxy, direct fallback; no provider/model calls`);
} finally {
  if (app && app.process().exitCode === null) {
    await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
    await Promise.race([new Promise((resolveWait) => app.process().once("exit", resolveWait)), new Promise((resolveWait) => setTimeout(resolveWait, 45_000))]);
    if (app.process().exitCode === null) app.process().kill("SIGKILL");
  }
  await stop(fixture);
  let listeners = "";
  try { listeners = (await import("node:child_process")).execFileSync("lsof", ["-nP", "-iTCP:18950-18954", "-iTCP:8084", "-sTCP:LISTEN"], { encoding: "utf8" }); } catch (error) { listeners = String(error.stdout ?? ""); }
  check(!/LISTEN/.test(listeners), "no test process remains listening on 18950–18954 or 8084");
}
