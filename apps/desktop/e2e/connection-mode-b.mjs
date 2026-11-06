import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright";

const desktopRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(desktopRoot, "../..");
const runDir = process.env.JAGENTCHILL_E2E_RUN_DIR ? resolve(repoRoot, process.env.JAGENTCHILL_E2E_RUN_DIR) : join(repoRoot, ".dev/run-w8q-connections-page-1");
const userData = join(runDir, "user-data");
const library = join(runDir, "library");
const tailnetStateFile = join(runDir, "tailnet-state.txt");
const fakeBridge = join(desktopRoot, "test/fixtures/fake-tsnet-stateful.mjs");
const fakeBridgeRunner = join(runDir, "fake-tsnet-bridge");
const evidence = join(repoRoot, ".dev/evidence");
if (existsSync(runDir)) throw new Error(`Refusing to reuse existing run directory: ${runDir}`);
mkdirSync(userData, { recursive: true });
mkdirSync(library, { recursive: true });
mkdirSync(evidence, { recursive: true });
writeFileSync(tailnetStateFile, "login\n");
writeFileSync(fakeBridgeRunner, `#!/usr/bin/env node\nimport ${JSON.stringify(fakeBridge)};\n`, { mode: 0o755 });
chmodSync(fakeBridgeRunner, 0o755);

const webDir = process.env.JAGENTCHILL_WEB_DIR ? resolve(repoRoot, process.env.JAGENTCHILL_WEB_DIR) : join(repoRoot, ".dev/build/web-w8q-connections-page-1");
const env = {
  ...process.env,
  JAGENTCHILL_UNATTENDED: "1",
  JAGENTCHILL_USER_DATA: userData,
  JAGENTCHILL_LIBRARY_DIR: library,
  JAGENTCHILL_WEB_DIR: webDir,
  JAGENTCHILL_PORT: "18955",
  JAGENTCHILL_GATEWAY_PORT: "18956",
  JAGENTCHILL_TSNET_BRIDGE_BIN: fakeBridgeRunner,
  TSNET_TEST_STATE_FILE: tailnetStateFile,
  TSNET_TEST_PROXY_TRACE: join(runDir, "fake-bridge-trace.txt"),
  TSNET_TEST_PROXY_TARGET: "127.0.0.1:18957",
  TSNET_TEST_TAILNET_ADDRESS: "jc-test.tailnet.ts.net:18957",
  JAGENTCHILL_TEST_OPEN_EXTERNAL_FILE: join(runDir, "opened-links.txt"),
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
let page;
let serverPidBeforeTailnet;
let assertions = 0;
let appDocumentCsp = "";
const check = (condition, description) => { assert.ok(condition, description); assertions++; };
async function waitFor(predicate, timeout = 150_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Timed out waiting for the expected host state");
}
try {
  app = await _electron.launch({ cwd: desktopRoot, args: [".", "--headless"], env, timeout: 150_000 });
  page = await app.firstWindow({ timeout: 150_000 });
  page.on("response", async (response) => {
    if (response.request().isNavigationRequest() && response.url().startsWith("app://jagentchill/")) {
      appDocumentCsp = await response.headerValue("content-security-policy") ?? "";
    }
  });
  page.on("pageerror", (error) => console.error(`page error: ${error.message}`));
  try {
    await page.getByRole("heading", { name: "Join your tailnet" }).waitFor({ timeout: 30_000 });
  } catch (error) {
    await page.screenshot({ path: join(evidence, "w8n-first-launch-gate-timeout.png"), fullPage: true });
    console.error("first launch gate timeout:", page.url(), (await page.locator("body").innerText()).slice(0, 1800));
    throw error;
  }
  check((await page.evaluate(() => location.pathname)) === "/", "first launch routes to the connection gate");
  const initial = await page.evaluate(() => window.jagentchillDesktop.gateway.getStatus());
  check(initial.state === "stopped", "bundled host is stopped while connection mode is unset");
  await page.screenshot({ path: join(evidence, "w8-b1-first-launch-desktop-light.png"), fullPage: true });
  await page.evaluate(() => window.jagentchillDesktop.menu.invoke("app.theme.dark"));
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(evidence, "w8-b1-first-launch-desktop-dark.png"), fullPage: true });
  await page.evaluate(() => window.jagentchillDesktop.menu.invoke("app.theme.light"));
  await page.waitForTimeout(500);

  await page.getByText("Local", { exact: true }).last().click();
  await page.screenshot({ path: join(evidence, "w8-b1-local-choice-desktop-light.png"), fullPage: true });
  await page.evaluate(() => window.jagentchillDesktop.menu.invoke("app.theme.dark"));
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(evidence, "w8-b1-local-choice-desktop-dark.png"), fullPage: true });
  await page.evaluate(() => window.jagentchillDesktop.menu.invoke("app.theme.light"));
  await page.waitForTimeout(500);
  await page.getByTestId("continue-local").click();
  await page.waitForURL(/\/home$/, { timeout: 30_000 });
  const localStatus = await waitFor(async () => {
    const status = await page.evaluate(() => window.jagentchillDesktop.gateway.getStatus());
    if (status.state === "failed") throw new Error(`Local host failed: ${JSON.stringify(status)}`);
    return status.gatewayId && (status.state === "ready" || status.state === "degraded") ? status : null;
  });
  console.log("Local host status:", JSON.stringify(localStatus));
  check(localStatus.pid && localStatus.state !== "stopped", "Local choice starts the bundled host");
  check(localStatus.port === 18955 && localStatus.gatewayPort === 18956, "the host uses only the selected server/Gateway port pair");
  const localReadyStatus = localStatus;
  check(Boolean(localReadyStatus.gatewayId), "the Local host completes bootstrap after the app document reload");
  const localRoute = await waitFor(async () => { try { return await page.evaluate(() => location.pathname) === "/home" ? "/home" : null; } catch { return null; } }, 15_000);
  check(localRoute === "/home", "Continue with Local returns to Home after the built-in host document reload");
  await waitFor(() => appDocumentCsp.includes("http://127.0.0.1:18955") && appDocumentCsp.includes("ws://127.0.0.1:18955"), 30_000);
  check(appDocumentCsp.includes("http://127.0.0.1:18955") && appDocumentCsp.includes("ws://127.0.0.1:18955") && !/127\.0\.0\.1:\*/.test(appDocumentCsp), "the reloaded app document response header has the exact host port and no wildcard port");
  await page.screenshot({ path: join(evidence, "w8-b3-local-connected-no-manual-reload.png"), fullPage: true });

  const menuEventObserved = await page.evaluate(() => new Promise((resolve) => {
    const off = window.jagentchillDesktop.menu.onInvoke((event) => { off(); resolve(event.action); });
    void window.jagentchillDesktop.menu.invoke("app.settings.host");
    setTimeout(() => { off(); resolve("timeout"); }, 3000);
  }));
  console.log("Host settings menu event:", menuEventObserved);
  await page.goto("app://jagentchill/settings/devices");
  await page.waitForURL(/\/settings\/devices$/, { timeout: 15_000 });
  await page.setViewportSize({ width: 1440, height: 900 });
  const pageUrlBefore = page.url();
  check(await page.getByTestId("connection-overview").count() === 0, "Connections and devices has no card above its title");
  check(await page.getByText("Connect type", { exact: true }).count() === 0, "Connections and devices has no Connect type line");
  check(await page.getByTestId("devices-content").locator(":scope > *").first().getAttribute("data-testid") === "connections-title-block", "the title block is the first content on the page");
  check(!(await page.locator("body").innerText()).includes("127.0.0.1"), "the page does not expose a loopback address");
  check(await page.getByRole("button", { name: "Copy address" }).count() === 0, "address copy actions are inside the row menu");
  const builtInRow = page.getByTestId(`paired-host-${localReadyStatus.gatewayId}`);
  const localConnectionLine = builtInRow.getByTestId(`paired-host-connection-${localReadyStatus.gatewayId}`);
  check((await localConnectionLine.innerText()).includes("Local") && (await localConnectionLine.innerText()).includes("This computer"), "Local mode shows one [Local] This computer address for the built-in host");
  check(!(await localConnectionLine.innerText()).includes("Tailscale"), "Local mode does not show a second Tailscale address");
  check((await builtInRow.getByRole("button", { name: "Disconnect" }).count()) === 1, "the existing Disconnect action remains on the host row");
  serverPidBeforeTailnet = localStatus.pid;

  const captureState = async (state) => {
    await page.evaluate(() => window.jagentchillDesktop.menu.invoke("app.theme.light"));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(evidence, `w8q-connections-${state}-1440-light.png`), fullPage: true });
    await page.setViewportSize({ width: 700, height: 900 });
    await page.screenshot({ path: join(evidence, `w8q-connections-${state}-700-light.png`), fullPage: true });
    await page.evaluate(() => window.jagentchillDesktop.menu.invoke("app.theme.dark"));
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(evidence, `w8q-connections-${state}-700-dark.png`), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: join(evidence, `w8q-connections-${state}-1440-dark.png`), fullPage: true });
    await page.evaluate(() => window.jagentchillDesktop.menu.invoke("app.theme.light"));
  };
  await captureState("local");

  await app.evaluate(() => {
    process.env.JAGENTCHILL_PORT = "18957";
    process.env.JAGENTCHILL_GATEWAY_PORT = "18958";
  });
  await builtInRow.getByRole("button", { name: "Host options" }).click();
  await page.getByRole("menuitem", { name: "Switch to Tailscale" }).click();
  try {
    await page.waitForURL(/\/join-tailnet\?manage=1/, { timeout: 60_000 });
  } catch (error) {
    await page.screenshot({ path: join(evidence, "w8r-switch-to-tailscale-gate-failure.png"), fullPage: true }).catch(() => undefined);
    console.error("Tailscale gate failure:", page.url(), (await page.locator("body").innerText().catch(() => "<document unavailable>")).slice(0, 2600));
    throw error;
  }
  await page.getByTestId("tailscale-sign-in").click();
  writeFileSync(tailnetStateFile, "connected\n");
  let connectedStatus;
  try {
    connectedStatus = await waitFor(async () => {
      const status = await page.evaluate(() => window.jagentchillDesktop.tailnet.getStatus().catch(() => null)).catch(() => null);
      return status?.connected ? status : null;
    }, 60_000);
  } catch (error) {
    await page.screenshot({ path: join(evidence, "w8r-switch-to-tailscale-connected-failure.png"), fullPage: true }).catch(() => undefined);
    const visible = await page.locator("body").innerText().catch(() => "<document unavailable>");
    console.error("Tailscale connected-state failure:", page.url(), visible.slice(0, 2600));
    throw error;
  }
  try {
    await waitFor(async () => {
      try {
        const route = await page.evaluate(() => location.pathname);
        return route === "/settings/devices" ? route : null;
      } catch { return null; }
    }, 60_000);
  } catch (error) {
    await page.screenshot({ path: join(evidence, "w8r-switch-to-tailscale-return-failure.png"), fullPage: true }).catch(() => undefined);
    const visible = await page.locator("body").innerText().catch(() => "<document unavailable>");
    console.error("Tailscale return failure:", page.url(), visible.slice(0, 2600));
    throw error;
  }
  let returnDocumentOrigin = 0;
  let returnDocumentSince = 0;
  let tailscaleHostStatus;
  try {
    tailscaleHostStatus = await waitFor(async () => {
      try {
        const route = await page.evaluate(() => location.pathname);
        const timeOrigin = await page.evaluate(() => performance.timeOrigin);
        const status = await page.evaluate(() => window.jagentchillDesktop.gateway.getStatus());
        if (route !== new URL(pageUrlBefore).pathname || !status.pid || status.pid === serverPidBeforeTailnet || status.port !== 18957 || status.gatewayPort !== 18958) return null;
        if (returnDocumentOrigin !== timeOrigin) { returnDocumentOrigin = timeOrigin; returnDocumentSince = Date.now(); }
        return Date.now() - returnDocumentSince >= 1_200 ? status : null;
      } catch { return null; }
    }, 60_000);
  } catch (error) {
    await page.screenshot({ path: join(evidence, "w8r-switch-to-tailscale-return-failure.png"), fullPage: true }).catch(() => undefined);
    console.error("Tailscale stable-route failure:", page.url(), (await page.locator("body").innerText().catch(() => "<document unavailable>")).slice(0, 2400));
    throw error;
  }
  check(connectedStatus.connected && connectedStatus.host === "jc-test.tailnet.ts.net", "the built-in host reaches connected state through the fake bridge");
  check(await page.evaluate(() => window.jagentchillDesktop.connectionMode.get()) === "tailscale", "Switch to Tailscale persists the selected mode");
  check((await page.evaluate(() => location.pathname)) === new URL(pageUrlBefore).pathname, "switching connection mode returns to the current Settings route");
  check(tailscaleHostStatus.port === 18957 && tailscaleHostStatus.gatewayPort === 18958, "Tailscale mode restarts only on server/Gateway ports 18957/18958");
  const tailnetBootstrapReloads = (readFileSync(join(userData, "logs/main.log"), "utf8").match(/\[window\] reload after built-in host bootstrap on port=18957/g) ?? []).length;
  check(tailnetBootstrapReloads === 1, "the Tailscale host bootstrap triggers exactly one document reload");
  check(appDocumentCsp.includes("http://127.0.0.1:18957") && appDocumentCsp.includes("ws://127.0.0.1:18957") && !/127\.0\.0\.1:\*/.test(appDocumentCsp), "the app document retains exact-port CSP after the mode restart");
  const tailnetRow = page.getByTestId(`paired-host-${tailscaleHostStatus.gatewayId}`);
  const tailnetConnectionLine = tailnetRow.getByTestId(`paired-host-connection-${tailscaleHostStatus.gatewayId}`);
  check((await tailnetConnectionLine.innerText()).includes("Tailscale") && (await tailnetConnectionLine.innerText()).includes("jc-test.tailnet.ts.net:18957"), "Tailscale mode shows one Tailscale address for the built-in host");
  check(!(await tailnetConnectionLine.innerText()).includes("This computer"), "Tailscale mode hides the implementation's Local socket address");
  check(!(await page.locator("body").innerText()).includes("127.0.0.1"), "the page never renders a loopback address in Tailscale mode");
  check(await page.getByRole("button", { name: "Copy address" }).count() === 0, "no Copy address button is outside the row menu");
  await captureState("tailscale-connected");

  writeFileSync(tailnetStateFile, "login\n");
  let needsSignIn;
  try {
    needsSignIn = await waitFor(async () => {
      const status = await page.evaluate(() => window.jagentchillDesktop.tailnet.getStatus().catch(() => null));
      return status?.enabled && status.loginUrl && !status.connected ? status : null;
    }, 60_000);
  } catch (error) {
    await page.screenshot({ path: join(evidence, "w8r-needs-sign-in-state-failure.png"), fullPage: true }).catch(() => undefined);
    console.error("Needs-sign-in state failure:", page.url(), await page.evaluate(() => window.jagentchillDesktop.tailnet.getStatus().catch((reason) => ({ error: String(reason) }))).catch((reason) => ({ error: String(reason) })), (await page.locator("body").innerText().catch(() => "<document unavailable>")).slice(0, 1800));
    throw error;
  }
  check(Boolean(needsSignIn.loginUrl), "the fake bridge exposes a needs-sign-in state without external login");
  await tailnetRow.getByText("Tailscale needs sign-in", { exact: true }).waitFor({ timeout: 15_000 });
  await tailnetRow.getByRole("button", { name: "Sign in", exact: true }).waitFor({ timeout: 10_000 });
  check((await tailnetConnectionLine.innerText()).includes("Tailscale"), "needs-sign-in keeps the single Tailscale row");
  check(!(await page.locator("body").innerText()).includes("127.0.0.1"), "needs-sign-in state does not expose loopback");
  await captureState("tailscale-needs-sign-in");

  await tailnetRow.getByRole("button", { name: "Host options" }).click();
  await page.getByRole("menuitem", { name: "Sign in to Tailscale again" }).click();
  await page.waitForURL(/\/join-tailnet\?manage=1/, { timeout: 15_000 });
  const signInDocumentStart = await page.evaluate(() => performance.timeOrigin);
  await page.getByTestId("tailscale-sign-in").click();
  writeFileSync(tailnetStateFile, "connected\n");
  await waitFor(async () => {
    const status = await page.evaluate(() => window.jagentchillDesktop.tailnet.getStatus().catch(() => null)).catch(() => null);
    return status?.connected ? status : null;
  }, 60_000);
  await page.waitForURL(/\/settings\/devices$/, { timeout: 60_000 });
  let stableReturnDocument = 0;
  let stableReturnSince = 0;
  await waitFor(async () => {
    try {
      const route = await page.evaluate(() => location.pathname);
      const timeOrigin = await page.evaluate(() => performance.timeOrigin);
      const status = await page.evaluate(() => window.jagentchillDesktop.gateway.getStatus());
      if (route !== "/settings/devices" || timeOrigin === signInDocumentStart || status.port !== 18957 || status.gatewayPort !== 18958) return null;
      if (stableReturnDocument !== timeOrigin) { stableReturnDocument = timeOrigin; stableReturnSince = Date.now(); }
      return Date.now() - stableReturnSince >= 1_200 ? true : null;
    } catch { return null; }
  }, 60_000);
  check((await page.evaluate(() => location.pathname)) === "/settings/devices", "Sign in to Tailscale again returns to Connections and devices after connection");
  check((await page.evaluate(() => window.jagentchillDesktop.connectionMode.get())) === "tailscale", "Sign in again keeps the selected Tailscale mode");
  await page.screenshot({ path: join(evidence, "w8r-sign-in-again-return.png"), fullPage: true });

  const connectedBuiltInRow = page.getByTestId(`paired-host-${tailscaleHostStatus.gatewayId}`);
  await connectedBuiltInRow.getByRole("button", { name: "Host options" }).click();
  await page.getByRole("menuitem", { name: "Switch to Local" }).click();
  await waitFor(async () => {
    const mode = await page.evaluate(() => window.jagentchillDesktop.connectionMode.get().catch(() => null)).catch(() => null);
    const status = await page.evaluate(() => window.jagentchillDesktop.gateway.getStatus().catch(() => null)).catch(() => null);
    return mode === "local" && status?.port === 18957 && status.gatewayPort === 18958 && status.state !== "stopped" ? status : null;
  }, 60_000);
  check((await page.evaluate(() => location.pathname)) === "/settings/devices", "Switch to Local stays on Connections and devices after the host restart");
  const localAfterSwitch = page.getByTestId(`paired-host-${tailscaleHostStatus.gatewayId}`).getByTestId(`paired-host-connection-${tailscaleHostStatus.gatewayId}`);
  await localAfterSwitch.getByText("Local", { exact: true }).waitFor({ timeout: 15_000 });
  check((await localAfterSwitch.innerText()).includes("This computer") && !(await localAfterSwitch.innerText()).includes("Tailscale"), "Switch to Local leaves one [Local] This computer connection row");
  await page.screenshot({ path: join(evidence, "w8r-switch-to-local-return.png"), fullPage: true });
  console.log(`PASS connection-mode-b: ${assertions} assertions; Q screen states through headless Electron, fake bridge only`);
} finally {
  if (app && app.process().exitCode === null) {
    await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
    await Promise.race([new Promise((resolve) => app.process().once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 45_000))]);
    if (app.process().exitCode === null) app.process().kill("SIGKILL");
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const { execFileSync } = await import("node:child_process");
  let listeners = "";
  try { listeners = execFileSync("lsof", ["-nP", "-iTCP:18955-18958", "-sTCP:LISTEN"], { encoding: "utf8" }); } catch (error) { listeners = String(error.stdout ?? ""); }
  check(!/LISTEN/.test(listeners), "no process from this test is left listening on 18955-18958");
}
