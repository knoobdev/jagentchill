import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright";

const desktopRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(desktopRoot, "../..");
const runDir = process.env.JAGENTCHILL_E2E_RUN_DIR ? resolve(repoRoot, process.env.JAGENTCHILL_E2E_RUN_DIR) : join(repoRoot, ".dev/run-w8b3-reload-not-csp-2");
const userData = join(runDir, "user-data");
const library = join(runDir, "library");
const stateFile = join(runDir, "tailnet-state.txt");
const openedUrlFile = join(runDir, "opened-url.txt");
const webDir = process.env.JAGENTCHILL_WEB_DIR ? resolve(repoRoot, process.env.JAGENTCHILL_WEB_DIR) : join(repoRoot, ".dev/build/web-w8b3-reload-not-csp");
const fakeBridgeFixture = join(desktopRoot, "test/fixtures/fake-tsnet-stateful.mjs");
const fakeBridge = join(runDir, "fake-tsnet-bridge");
const evidence = join(repoRoot, ".dev/evidence");
if (existsSync(runDir)) throw new Error(`Refusing to reuse existing run directory: ${runDir}`);
mkdirSync(userData, { recursive: true });
mkdirSync(library, { recursive: true });
mkdirSync(evidence, { recursive: true });
writeFileSync(stateFile, "login\n");
writeFileSync(fakeBridge, `#!/usr/bin/env node\nimport ${JSON.stringify(fakeBridgeFixture)};\n`, { mode: 0o755 });
chmodSync(fakeBridge, 0o755);

const env = {
  ...process.env,
  JAGENTCHILL_UNATTENDED: "1",
  JAGENTCHILL_USER_DATA: userData,
  JAGENTCHILL_LIBRARY_DIR: library,
  JAGENTCHILL_WEB_DIR: webDir,
  JAGENTCHILL_PORT: process.env.JAGENTCHILL_E2E_PORT ?? "18955",
  JAGENTCHILL_GATEWAY_PORT: process.env.JAGENTCHILL_E2E_GATEWAY_PORT ?? "18956",
  JAGENTCHILL_TSNET_BRIDGE_BIN: fakeBridge,
  TSNET_TEST_STATE_FILE: stateFile,
  TSNET_TEST_PROXY_TARGET: "127.0.0.1:18955",
  TSNET_TEST_TAILNET_ADDRESS: "jc-test.tailnet.ts.net:18955",
  JAGENTCHILL_TEST_OPEN_EXTERNAL_FILE: openedUrlFile,
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
let page;
let assertions = 0;
const check = (condition, description) => { assert.ok(condition, description); assertions++; };
const evidencePath = (name) => join(evidence, name);
async function waitForFile(path, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (!existsSync(path) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
  if (!existsSync(path)) throw new Error(`Timed out waiting for ${path}`);
}
async function waitFor(predicate, timeout = 150_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Timed out waiting for the expected host state");
}
function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}
try {
  app = await _electron.launch({ cwd: desktopRoot, args: [".", "--headless"], env, timeout: 150_000 });
  page = await app.firstWindow({ timeout: 150_000 });
  page.on("pageerror", (error) => console.error("renderer page error:", error.message));
  await page.getByRole("heading", { name: "Join your tailnet" }).waitFor({ timeout: 30_000 });

  await page.getByTestId("tailscale-sign-in").click();
  await waitForFile(openedUrlFile, 60_000);
  const openedUrl = readFileSync(openedUrlFile, "utf8").trim();
  check(openedUrl === "https://login.tailscale.com/example-host-login", "the injected main-process opener records the exact URL returned by the host");
  check(await page.getByRole("heading", { name: "Join your tailnet" }).isVisible(), "unattended sign-in records the URL without opening a visible browser");
  writeFileSync(stateFile, "connected\n");
  await page.waitForURL(/\/home$/, { timeout: 30_000 });
  try { await page.getByText("Connected over Tailscale as jc-test.tailnet.ts.net", { exact: true }).waitFor({ timeout: 30_000 }); }
  catch (error) {
    await page.screenshot({ path: evidencePath("w8s-signin-toast-failure.png"), fullPage: true });
    console.error("connected toast failure route:", page.url(), "visible text:", (await page.locator("body").innerText()).slice(0, 2200));
    console.error("connection notice diagnostic:", await page.evaluate(async () => ({ notice: sessionStorage.getItem("jagentchill.connectionNotice"), tailnet: await window.jagentchillDesktop.tailnet.getStatus() })));
    throw error;
  }
  check(true, "successful Tailscale join confirms the path in a one-line toast");
  await page.screenshot({ path: evidencePath("w8s-signin-toast-connected.png"), fullPage: true });

  const connectedMenuEvent = await page.evaluate(() => new Promise((resolve) => {
    const off = window.jagentchillDesktop.menu.onInvoke((event) => { if (event.action === "app.settings.host") { off(); resolve(event.action); } });
    void window.jagentchillDesktop.menu.invoke("app.settings.host");
    setTimeout(() => { off(); resolve("timeout"); }, 3000);
  }));
  check(connectedMenuEvent === "app.settings.host", "host settings menu opens the Connection & devices page");
  await page.waitForURL(/\/settings\/devices$/, { timeout: 15_000 });
  const gatewayId = await page.evaluate(async () => (await window.jagentchillDesktop.gateway.getStatus()).gatewayId);
  const builtInRow = page.getByTestId(`paired-host-${gatewayId}`);
  const connectionLine = builtInRow.getByTestId(`paired-host-connection-${gatewayId}`);
  await builtInRow.getByText("Connected", { exact: true }).waitFor({ timeout: 15_000 });
  await connectionLine.getByText(/jc-test\.tailnet\.ts\.net:18955/).waitFor({ timeout: 15_000 });
  check((await connectionLine.innerText()).includes("Tailscale") && (await connectionLine.innerText()).includes("jc-test.tailnet.ts.net:18955"), "the built-in host row shows one typed Tailscale address when connected");
  check(await page.getByTestId("connection-overview").count() === 0 && await page.getByText("Connect type", { exact: true }).count() === 0, "Connections and devices has no extra Connection card or Connect type line");
  check(!(await page.locator("body").innerText()).includes("127.0.0.1"), "Connections and devices does not show the host's loopback implementation address");
  await page.setViewportSize({ width: 1440, height: 900 });
  check(await page.getByRole("row").filter({ hasText: "macOS · desktop app" }).getByText("This computer", { exact: true }).first().isVisible(), "the device table keeps the full device name visible at 1440 px");
  await page.screenshot({ path: evidencePath("w8q-connections-tailscale-connected-1440-dark.png"), fullPage: true });
  await page.evaluate(() => window.jagentchillDesktop.menu.invoke("app.theme.light"));
  await page.waitForTimeout(500);
  await page.screenshot({ path: evidencePath("w8q-connections-tailscale-connected-1440-light.png"), fullPage: true });
  await page.setViewportSize({ width: 700, height: 900 });
  await page.screenshot({ path: evidencePath("w8q-connections-tailscale-connected-700-light.png"), fullPage: true });
  await page.evaluate(() => window.jagentchillDesktop.menu.invoke("app.theme.dark"));
  await page.waitForTimeout(300);
  await page.screenshot({ path: evidencePath("w8q-connections-tailscale-connected-700-dark.png"), fullPage: true });
  await page.evaluate(() => window.jagentchillDesktop.menu.invoke("app.theme.light"));

  writeFileSync(stateFile, "login\n");
  await waitFor(async () => {
    const status = await page.evaluate(() => window.jagentchillDesktop.tailnet.getStatus());
    return status.loginUrl && !status.connected;
  });
  await builtInRow.getByText("Tailscale needs sign-in", { exact: true }).waitFor({ timeout: 15_000 });
  await builtInRow.getByRole("button", { name: "Sign in", exact: true }).waitFor({ timeout: 15_000 });
  check((await connectionLine.innerText()).includes("Tailscale") && (await connectionLine.innerText()).includes("jc-test.tailnet.ts.net:18955"), "Needs sign-in keeps the single typed Tailscale address on its host row");
  check(await page.getByRole("button", { name: "Copy address" }).count() === 0, "Needs sign-in keeps address copy inside the host row menu");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: evidencePath("w8q-connections-tailscale-needs-sign-in-1440-light.png"), fullPage: true });
  await page.evaluate(() => window.jagentchillDesktop.menu.invoke("app.theme.dark"));
  await page.waitForTimeout(300);
  await page.screenshot({ path: evidencePath("w8q-connections-tailscale-needs-sign-in-1440-dark.png"), fullPage: true });
  await page.evaluate(() => window.jagentchillDesktop.menu.invoke("app.theme.light"));
  await page.setViewportSize({ width: 700, height: 900 });
  await page.screenshot({ path: evidencePath("w8q-connections-tailscale-needs-sign-in-700-light.png"), fullPage: true });
  await page.evaluate(() => window.jagentchillDesktop.menu.invoke("app.theme.dark"));
  await page.waitForTimeout(300);
  await page.screenshot({ path: evidencePath("w8q-connections-tailscale-needs-sign-in-700-dark.png"), fullPage: true });
  await page.evaluate(() => window.jagentchillDesktop.menu.invoke("app.theme.light"));
  await page.goto("app://jagentchill/home");
  try {
    await page.waitForURL(/\/join-tailnet/, { timeout: 12_000 });
  } catch (error) {
    await page.screenshot({ path: evidencePath("w8-b-signin-gate-failure.png"), fullPage: true });
    console.error("gate failure route:", page.url(), "visible text:", (await page.locator("body").innerText()).slice(0, 2200));
    throw error;
  }
  check(true, "the desktop gate returns Home to Join your tailnet when the host reports needs-login");
  await page.screenshot({ path: evidencePath("w8-b-signin-gate-needs-sign-in.png"), fullPage: true });
  console.log(`PASS signin-popup-b: ${assertions} assertions; fake bridge only; no browser was opened and no real Tailscale login was performed`);
} finally {
  if (app && app.process().exitCode === null) {
    await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined);
    await Promise.race([new Promise((resolve) => app.process().once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 45_000))]);
    if (app.process().exitCode === null) app.process().kill("SIGKILL");
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const { execFileSync } = await import("node:child_process");
  let listeners = "";
  try { listeners = execFileSync("lsof", ["-nP", "-iTCP:18955", "-iTCP:18956", "-sTCP:LISTEN"], { encoding: "utf8" }); } catch (error) { listeners = String(error.stdout ?? ""); }
  check(!/LISTEN/.test(listeners), "no process from this test remains listening on 18955 or 18956");
}
