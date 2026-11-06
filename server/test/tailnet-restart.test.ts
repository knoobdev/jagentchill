import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { createTailnetListener, type TailnetListener } from "../src/tailnet/listener.ts";

const repoRoot = resolve(import.meta.dirname, "../..");
const testPort = Number(process.env.JAGENTCHILL_PORT ?? 18955);
const testRunRoot = process.env.JAGENTCHILL_TEST_RUN_ROOT ? resolve(repoRoot, process.env.JAGENTCHILL_TEST_RUN_ROOT) : join(repoRoot, ".dev/run-w8g-tailnet-pairing");
const firstDataDir = join(testRunRoot, "tailnet-restart-1");
const secondDataDir = join(testRunRoot, "tailnet-restart-2");
const fakeBridge = new URL("./fixtures/fake-tsnet-bridge.mjs", import.meta.url).pathname;

async function waitForConnected(listener: TailnetListener): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!listener.status().connected && Date.now() < deadline) await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  assert.equal(listener.status().connected, true, "fake bridge should publish TSNET_READY");
}

function listener(dataDir: string, capture: string): TailnetListener {
  const stateDir = join(dataDir, "tailscale");
  return createTailnetListener({
    port: testPort,
    stateDir,
    bridgeBinary: process.execPath,
    bridgeArgs: [fakeBridge],
    fakeBridgeEnv: { FAKE_TSNET_MODE: "ready", FAKE_TSNET_DELAY_MS: "20", FAKE_TSNET_ENV_CAPTURE: capture },
    attachSocket: () => assert.fail("restart test does not dial a tailnet socket"),
  });
}

test("enabled tailnet resumes after host restart without an auth key and keeps each host state isolated", async () => {
  mkdirSync(firstDataDir, { recursive: true });
  mkdirSync(secondDataDir, { recursive: true });
  const firstCapture = join(firstDataDir, "first-bridge.json");
  const resumedCapture = join(firstDataDir, "resumed-bridge.json");
  const otherHostCapture = join(secondDataDir, "other-host-bridge.json");
  const first = listener(firstDataDir, firstCapture);
  try {
    await first.joinWithAuthKey("tskey-auth-fake-test-only");
    await waitForConnected(first);
  } finally {
    await first.stop();
  }
  assert.equal(readFileSync(join(firstDataDir, "tailscale", "jagentchill-enabled"), "utf8"), "1");

  const resumed = listener(firstDataDir, resumedCapture);
  try {
    assert.equal(resumed.status().enabled, true, "the persisted mode is visible immediately after process construction");
    const status = await resumed.resume();
    assert.equal(status.enabled, true);
    await waitForConnected(resumed);
    const capture = JSON.parse(readFileSync(resumedCapture, "utf8")) as { hasAuthKey: boolean; stateDir: string };
    assert.equal(capture.hasAuthKey, false, "restart must not receive TS_AUTHKEY");
    assert.equal(capture.stateDir, join(firstDataDir, "tailscale"));
    assert.equal(readFileSync(join(firstDataDir, "tailscale", "jagentchill-enabled"), "utf8"), "1");
    await resumed.setEnabled(false);
  } finally {
    await resumed.stop();
  }

  const disabled = listener(firstDataDir, join(firstDataDir, "disabled-bridge.json"));
  try {
    assert.equal(disabled.status().enabled, false, "disable clears the persisted startup choice");
    assert.equal((await disabled.resume()).connected, false, "disabled tailnet is not relaunched");
  } finally { await disabled.stop(); }

  const otherHost = listener(secondDataDir, otherHostCapture);
  try {
    await otherHost.joinWithAuthKey("tskey-auth-fake-test-only");
    await waitForConnected(otherHost);
    const other = JSON.parse(readFileSync(otherHostCapture, "utf8")) as { stateDir: string };
    assert.equal(other.stateDir, join(secondDataDir, "tailscale"));
    assert.notEqual(other.stateDir, join(firstDataDir, "tailscale"), "different --data-dir values map to different tsnet state directories");
  } finally { await otherHost.stop(); }
});
