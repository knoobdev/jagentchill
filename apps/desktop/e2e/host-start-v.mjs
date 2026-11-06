import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright";

const desktopRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(desktopRoot, "../..");
const webDir = process.env.JAGENTCHILL_WEB_DIR ? resolve(repoRoot, process.env.JAGENTCHILL_WEB_DIR) : join(repoRoot, ".dev/build/web-w8v-host-start-ports-1");
const bridgeFixture = join(desktopRoot, "test/fixtures/fake-tsnet-stateful.mjs");
const evidence = join(repoRoot, ".dev/evidence");
if (!existsSync(join(webDir, "index.html"))) throw new Error(`Missing Electron web export: ${webDir}`);
mkdirSync(evidence, { recursive: true });

const waitFor = async (predicate, label, timeout = 45_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
};

async function runCase({ runName, initialState, connectAfterMs, shotPrefix, waitForConnect }) {
  const runDir = join(repoRoot, ".dev", runName);
  if (existsSync(runDir)) throw new Error(`Refusing to reuse existing run directory: ${runDir}`);
  const userData = join(runDir, "user-data"), home = join(runDir, "home"), library = join(runDir, "library");
  const stateFile = join(runDir, "tailnet-state.txt"), bridge = join(runDir, "fake-tsnet-bridge"), openedUrl = join(runDir, "opened-url.txt");
  for (const directory of [userData, home, library, join(userData, "identity")]) mkdirSync(directory, { recursive: true, mode: 0o700 });
  const fixtureKey = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  writeFileSync(join(userData, "identity", "device.key"), JSON.stringify({ v: 1, protection: "file", data: Buffer.from(fixtureKey).toString("base64") }), { mode: 0o600 });
  writeFileSync(stateFile, `${initialState}\n`);
  writeFileSync(bridge, `#!/usr/bin/env node\nimport ${JSON.stringify(bridgeFixture)};\n`, { mode: 0o755 });
  chmodSync(bridge, 0o755);
  const env = {
    ...process.env,
    HOME: home, JAGENTCHILL_UNATTENDED: "1", JAGENTCHILL_USER_DATA: userData,
    JAGENTCHILL_LIBRARY_DIR: library, JAGENTCHILL_WEB_DIR: webDir,
    JAGENTCHILL_PORT: "18950", JAGENTCHILL_GATEWAY_PORT: "18951",
    JAGENTCHILL_TSNET_BRIDGE_BIN: bridge, JAGENTCHILL_E2E_RUN_DIR: runDir,
    JAGENTCHILL_TEST_OPEN_EXTERNAL_FILE: openedUrl,
    TSNET_TEST_STATE_FILE: stateFile, TSNET_TEST_PROXY_TARGET: "127.0.0.1:18950",
    TSNET_TEST_TAILNET_ADDRESS: "jc-test.tailnet.ts.net:18950", TSNET_TEST_PROXY_PORT: "18952",
    TSNET_TEST_CONNECT_AFTER_MS: String(connectAfterMs ?? 0),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  let assertions = 0;
  const check = (condition, description) => { assert.ok(condition, description); assertions++; };
  try {
    app = await _electron.launch({ cwd: desktopRoot, args: [".", "--headless"], env, timeout: 150_000 });
    const page = await app.firstWindow({ timeout: 150_000 });
    await page.getByRole("heading", { name: "Join your tailnet" }).waitFor({ timeout: 30_000 });
    const startedAt = Date.now();
    await page.getByTestId("tailscale-sign-in").click();
    await waitFor(() => existsSync(openedUrl), "the fake bridge login URL");
    const ready = await waitFor(async () => {
      const status = await page.evaluate(() => window.jagentchillDesktop.gateway.getStatus()).catch(() => null);
      return status && ["ready", "degraded"].includes(status.state) && status.serverVersion ? status : null;
    }, "the local host channel while Tailscale is pending");
    const elapsed = Date.now() - startedAt;
    const tailnetPending = await page.evaluate(() => window.jagentchillDesktop.tailnet.getStatus());
    check(ready.port === 18950 && ready.gatewayPort === 18951, `${shotPrefix}: the local host reached its ready channel on 18950/18951`);
    check(!tailnetPending.connected, `${shotPrefix}: the app host is ready while the fake Tailscale bridge is still disconnected`);
    check(elapsed < 20_000, `${shotPrefix}: local readiness took ${elapsed} ms, before the delayed tailnet connection`);
    await page.screenshot({ path: join(evidence, `${shotPrefix}-local-ready-tailnet-pending.png`), fullPage: true });

    if (waitForConnect) {
      const connected = await waitFor(async () => {
        const status = await page.evaluate(() => window.jagentchillDesktop.tailnet.getStatus()).catch(() => null);
        return status?.connected ? status : null;
      }, "fake Tailscale connection after 20 seconds", 30_000);
      check(connected.host === "jc-test.tailnet.ts.net", `${shotPrefix}: fake bridge connects after its 20-second delay`);
      await page.waitForURL(/\/home$/, { timeout: 30_000 });
      await page.getByTestId("connection-chip").getByText("Connected · This computer (Tailscale on)", { exact: true }).waitFor({ timeout: 15_000 });
      await page.screenshot({ path: join(evidence, `${shotPrefix}-connected.png`), fullPage: true });
    } else {
      await new Promise((resolveWait) => setTimeout(resolveWait, 20_500));
      const stillPending = await page.evaluate(() => window.jagentchillDesktop.tailnet.getStatus());
      check(!stillPending.connected, `${shotPrefix}: fake bridge never connects and local host remains independently ready`);
      const stillReady = await page.evaluate(() => window.jagentchillDesktop.gateway.getStatus());
      check(["ready", "degraded"].includes(stillReady.state) && stillReady.port === 18950, `${shotPrefix}: local host is still ready after 20 seconds without Tailscale`);
      await page.screenshot({ path: join(evidence, `${shotPrefix}-still-local-ready.png`), fullPage: true });
    }
    console.log(`PASS host-start-v (${shotPrefix}): ${assertions} assertions; fake bridge only; no model/provider calls`);
  } finally {
    if (app && app.process().exitCode === null) {
      await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
      await Promise.race([new Promise((resolveWait) => app.process().once("exit", resolveWait)), new Promise((resolveWait) => setTimeout(resolveWait, 45_000))]);
      if (app.process().exitCode === null) app.process().kill("SIGKILL");
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    let listeners = "";
    try { listeners = execFileSync("lsof", ["-nP", "-iTCP:18950-18954", "-sTCP:LISTEN"], { encoding: "utf8" }); }
    catch (error) { listeners = String(error.stdout ?? ""); }
    assert.ok(!/LISTEN/.test(listeners), `${shotPrefix}: no test process remains on ports 18950–18954`);
  }
}

await runCase({ runName: "run-w8v-host-start-ports-2", initialState: "delayed", connectAfterMs: 20_000, shotPrefix: "w8v1-delayed", waitForConnect: true });
await runCase({ runName: "run-w8v-host-start-ports-3", initialState: "login", shotPrefix: "w8v1-never", waitForConnect: false });
