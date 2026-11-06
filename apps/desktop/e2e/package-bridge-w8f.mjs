import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repo = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const packageOut = process.env.JAGENTCHILL_DESKTOP_OUT ? resolve(repo, process.env.JAGENTCHILL_DESKTOP_OUT) : join(repo, ".dev/build/desktop-w8f");
const appBundle = join(packageOut, "mac-arm64/JAgentChill.app");
const executable = join(appBundle, "Contents/MacOS/JAgentChill");
const bridge = join(appBundle, "Contents/Resources/bin/jagentchill-tsnet-bridge");
const fixture = join(repo, "server/test/fixtures/fake-tsnet-bridge.mjs");
const evidence = join(repo, ".dev/evidence");
const testRunRoot = process.env.JAGENTCHILL_E2E_RUN_DIR ? resolve(repo, process.env.JAGENTCHILL_E2E_RUN_DIR) : join(repo, ".dev/run-w8f-package-bridge");
const runRoots = [1, 2].map((number) => join(testRunRoot, `case-${number}`));
const fake = join(runRoots[0], "fake-tsnet-bridge");
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function waitFor(read, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await sleep(100);
  }
  throw new Error("timed out waiting for the packaged app window");
}
assert.ok(existsSync(executable), `packaged executable missing: ${executable}`);
assert.ok(existsSync(bridge), `packaged bridge missing: ${bridge}`);
for (const root of runRoots) assert.equal(existsSync(root), false, `run directory must be fresh: ${root}`);
mkdirSync(evidence, { recursive: true });
mkdirSync(runRoots[0], { recursive: true });
writeFileSync(fake, `#!/bin/sh\nexec node '${fixture}'\n`, { mode: 0o755 });
chmodSync(fake, 0o755);

const start = async (number, bridgePath, extra = {}) => {
  const dir = runRoots[number - 1];
  const userData = join(dir, "user-data");
  mkdirSync(userData, { recursive: true, mode: 0o700 });
  const child = spawn(executable, ["--headless", "--remote-debugging-port=0"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      JAGENTCHILL_USER_DATA: userData,
      JAGENTCHILL_LIBRARY_DIR: join(dir, "library"),
      JAGENTCHILL_UNATTENDED: "1",
      JAGENTCHILL_PORT: "18955",
      JAGENTCHILL_GATEWAY_PORT: "18956",
      JAGENTCHILL_TSNET_BRIDGE_BIN: bridgePath,
      JAGENTCHILL_TEST_OPEN_EXTERNAL_FILE: join(dir, "external-url.txt"),
      FAKE_TSNET_MODE: "login-ready",
      FAKE_TSNET_DELAY_MS: "250",
      ...extra,
    },
  });
  const chunks = [];
  child.stdout.on("data", (chunk) => chunks.push(chunk.toString()));
  child.stderr.on("data", (chunk) => chunks.push(chunk.toString()));
  let browser;
  try {
    const endpoint = await waitFor(() => {
      if (child.exitCode !== null) throw new Error(`packaged app exited ${child.exitCode}: ${chunks.join("").slice(-2000)}`);
      const file = join(userData, "session", "DevToolsActivePort");
      return existsSync(file) ? readFileSync(file, "utf8").split("\n")[0] : null;
    });
    const origin = `http://127.0.0.1:${endpoint}`;
    await waitFor(async () => {
      try { return (await (await fetch(`${origin}/json/list`)).json()).some((target) => target.type === "page" && target.url.startsWith("app://jagentchill/")); }
      catch { return false; }
    });
    browser = await chromium.connectOverCDP(origin, { timeout: 30_000 });
    const page = browser.contexts()[0]?.pages().find((candidate) => candidate.url().startsWith("app://jagentchill/"));
    if (!page) throw new Error("packaged app did not expose its app window through CDP");
    return { child, browser, page, chunks };
  } catch (error) {
    child.kill("SIGTERM");
    if (child.exitCode === null) await new Promise((done) => child.once("exit", done));
    if (browser) await browser.close().catch(() => undefined);
    throw error;
  }
};
const stop = async (session) => {
  if (!session) return;
  const exited = new Promise((done) => session.child.once("exit", done));
  session.child.kill("SIGTERM");
  const result = await Promise.race([exited, new Promise((done) => setTimeout(() => done(null), 40_000))]);
  if (result === null && session.child.exitCode === null) session.child.kill("SIGKILL");
  await session.browser.close().catch(() => undefined);
};

let completed = 0;
let first;
try {
  first = await start(1, fake);
  await first.page.getByRole("heading", { name: "Join your tailnet" }).waitFor();
  await first.page.getByTestId("tailscale-sign-in").waitFor();
  assert.equal(new URL(first.page.url()).pathname, "/"); completed++;
  await first.page.screenshot({ path: join(evidence, "w8-f-packaged-first-launch.png"), fullPage: true });
  await first.page.getByTestId("tailscale-sign-in").click();
  await first.page.waitForURL(/\/home(?:\?.*)?$/, { timeout: 90_000 });
  await first.page.screenshot({ path: join(evidence, "w8-f-packaged-tailscale-connected.png"), fullPage: true });
  assert.match(readFileSync(join(runRoots[0], "external-url.txt"), "utf8"), /https:\/\/login\.tailscale\.com\/a\/fake-token/);
  completed += 2;
  await stop(first); first = null;

  const parkedBridge = join(runRoots[1], "packaged-bridge-original");
  mkdirSync(runRoots[1], { recursive: true });
  renameSync(bridge, parkedBridge);
  let second;
  try {
    second = await start(2, bridge);
    await second.page.getByRole("heading", { name: "Join your tailnet" }).waitFor();
    await second.page.getByTestId("tailscale-sign-in").click();
    await second.page.getByTestId("tailscale-unavailable").waitFor({ timeout: 90_000 });
    assert.match(await second.page.getByTestId("tailscale-unavailable").innerText(), /Tailscale is unavailable:.*bridge is missing/i);
    assert.equal(await second.page.getByTestId("tailscale-sign-in").isDisabled(), true);
    completed += 2;
    await second.page.screenshot({ path: join(evidence, "w8-f-bridge-unavailable.png"), fullPage: true });
  } finally {
    if (second) await stop(second);
    renameSync(parkedBridge, bridge);
  }
  console.log(`PASS package-bridge-w8f: ${completed} assertions; packaged first launch → fake Tailscale login; missing binary shows unavailable without waiting`);
} finally {
  if (first) await stop(first);
}
