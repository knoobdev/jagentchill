import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { join } from "node:path";
import { test } from "node:test";
import { createTailnetListener, type TailnetListener } from "../src/tailnet/listener.ts";

const fakeBridge = new URL("./fixtures/fake-tsnet-bridge.mjs", import.meta.url).pathname;
const statefulBridge = new URL("./fixtures/fake-tsnet-stateful-bridge.mjs", import.meta.url).pathname;
const repoRoot = resolve(import.meta.dirname, "../..");
const testPort = Number(process.env.JAGENTCHILL_PORT ?? 18955);
let runIndex = 4;
function dataDir(): string {
  // A fresh folder of its own on every run (a folder an earlier run left is never reused).
  const root = process.env.JAGENTCHILL_TEST_RUN_ROOT ? resolve(repoRoot, process.env.JAGENTCHILL_TEST_RUN_ROOT) : mkdtempSync(join(tmpdir(), "jagentchill-tailnet-listener-"));
  const dir = join(root, `tailnet-listener-${runIndex++}`);
  assert.equal(existsSync(dir), false, `test data directory must be fresh: ${dir}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function waitFor(listener: TailnetListener, predicate: (status: ReturnType<TailnetListener["status"]>) => boolean) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const status = listener.status();
    if (predicate(status)) return status;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`tailnet status did not reach expected state: ${JSON.stringify(listener.status())}`);
}

function makeListener(mode: string, extraEnv: Record<string, string> = {}): TailnetListener {
  const stateDir = join(dataDir(), "tailscale");
  return createTailnetListener({
    port: testPort,
    stateDir,
    bridgeBinary: process.execPath,
    bridgeArgs: [fakeBridge],
    fakeBridgeEnv: { FAKE_TSNET_MODE: mode, FAKE_TSNET_DELAY_MS: "30", ...extraEnv },
    // Fake mode launches this JS fixture instead of a bridge binary.
    attachSocket: () => assert.fail("fake bridge must not open a tailnet socket"),
  });
}

test("fake bridge publishes interactive login URL and then the ready tailnet host", async () => {
  const listener = makeListener("login-ready");
  const updates: ReturnType<TailnetListener["status"]>[] = [];
  listener.subscribe((status) => updates.push(status));
  try {
    await listener.startInteractiveLogin();
    const waiting = await waitFor(listener, (status) => status.loginUrl !== null);
    assert.equal(waiting.connected, false);
    assert.equal(waiting.loginUrl, "https://login.tailscale.com/a/fake-token");
    const ready = await waitFor(listener, (status) => status.connected);
    assert.equal(ready.host, "fake-host.example.ts.net");
    assert.equal(ready.port, testPort);
    assert.equal(ready.proxyPort, 43111);
    const proxyCredentials = listener.proxyCredentials();
    assert.equal(proxyCredentials?.port, 43111);
    assert.equal(proxyCredentials?.secret.length, 43);
    assert.equal(ready.loginUrl, null);
    assert.equal(ready.enabled, true);
    assert.ok(updates.length >= 2);
  } finally { await listener.stop(); }
});

test("a login URL after a connected bridge clears its host and proxy without marking it unavailable", async () => {
  const dir = dataDir();
  const stateFile = join(dir, "bridge-state.txt");
  writeFileSync(stateFile, "connected\n");
  const listener = createTailnetListener({
    port: testPort,
    stateDir: join(dir, "tailscale"),
    bridgeBinary: process.execPath,
    bridgeArgs: [statefulBridge],
    fakeBridgeEnv: { TSNET_TEST_STATE_FILE: stateFile },
    attachSocket: () => assert.fail("stateful fake bridge does not open a tailnet socket"),
  });
  try {
    await listener.startInteractiveLogin();
    const connected = await waitFor(listener, (status) => status.connected);
    assert.equal(connected.host, "fake-host.example.ts.net");
    assert.ok(listener.proxyCredentials());
    writeFileSync(stateFile, "login\n");
    const needsSignIn = await waitFor(listener, (status) => status.loginUrl !== null && !status.connected);
    assert.equal(needsSignIn.host, null);
    assert.equal(needsSignIn.proxyPort, null);
    assert.equal(needsSignIn.unavailableReason, null);
    assert.equal(listener.proxyCredentials(), null);
  } finally { await listener.stop(); }
});

test("fake bridge error and process exit clear connection and login state", async () => {
  const listener = makeListener("error");
  const updates: ReturnType<TailnetListener["status"]>[] = [];
  listener.subscribe((status) => updates.push(status));
  try {
    await listener.startInteractiveLogin();
    const error = await waitFor(listener, (status) => updates.length >= 2 && status.enabled && !status.connected && !status.loginUrl);
    assert.equal(error.host, null);
  } finally { await listener.stop(); }
});

test("fake bridge exit clears a previously advertised host", async () => {
  const listener = makeListener("ready", { FAKE_TSNET_EXIT_AFTER_READY_MS: "70" });
  try {
    await listener.startInteractiveLogin();
    await waitFor(listener, (status) => status.connected);
    const exited = await waitFor(listener, (status) => !status.connected);
    assert.equal(exited.host, null);
    assert.equal(exited.enabled, true);
  } finally { await listener.stop(); }
});

test("disabling the listener terminates the fake bridge and closes ingress", async () => {
  const listener = makeListener("ready");
  try {
    await listener.setEnabled(true);
    await waitFor(listener, (status) => status.connected);
    const disabled = await listener.setEnabled(false);
    assert.equal(disabled.enabled, false);
    assert.equal(disabled.connected, false);
    assert.equal(disabled.host, null);
    assert.equal(disabled.port, null);
  } finally { await listener.stop(); }
});

test("joining with an auth key passes it only to the bridge environment and restart is clean", async () => {
  const listener = makeListener("ready");
  try {
    await listener.joinWithAuthKey("tskey-auth-fake-test-only");
    const ready = await waitFor(listener, (status) => status.connected);
    assert.equal(ready.host, "fake-host.example.ts.net");
    const previousSecret = listener.proxyCredentials()?.secret;
    const restarted = await listener.restart();
    assert.equal(restarted.enabled, true);
    assert.equal(restarted.connected, false);
    const readyAgain = await waitFor(listener, (status) => status.connected);
    assert.notEqual(listener.proxyCredentials()?.secret, previousSecret);
    assert.equal(readyAgain.proxyPort, 43111);
  } finally { await listener.stop(); }
});

test("missing and non-executable bridge return an Unavailable status instead of throwing", { skip: process.platform === "win32" }, async () => {
  const stateDir = join(dataDir(), "tailscale");
  const missing = createTailnetListener({ port: testPort, stateDir, bridgeBinary: join(stateDir, "missing-bridge"), attachSocket: () => undefined });
  try {
    const status = await missing.startInteractiveLogin();
    assert.equal(status.enabled, true);
    assert.equal(status.connected, false);
    assert.match(status.unavailableReason ?? "", /bridge is missing/i);
  } finally { await missing.stop(); }

  const nonExecutable = join(stateDir, "non-executable-bridge");
  writeFileSync(nonExecutable, "#!/bin/sh\nexit 0\n", { mode: 0o600 });
  chmodSync(nonExecutable, 0o600);
  const listener = createTailnetListener({ port: testPort, stateDir, bridgeBinary: nonExecutable, attachSocket: () => undefined });
  try {
    const status = await listener.joinWithAuthKey("tskey-auth-fake-test-only");
    assert.equal(status.enabled, true);
    assert.equal(status.connected, false);
    assert.match(status.unavailableReason ?? "", /not executable/i);
  } finally { await listener.stop(); }
});
