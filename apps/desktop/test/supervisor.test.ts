// The server child is test/fixtures/slow-server.ts: the REAL server application on a real Node (its agent CLIs are started only for a turn, and none is here), listening late. The OS secret store is a FAKE safeStorage. The supervisor, the spawn, the bootstrap file, the signed channel and the stop sequence are real.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createRotatingLog } from "@jagentchill/desktop-core";
import { createIdentity, type SafeStorage } from "../src/identity.ts";
import type { RuntimeCheck } from "../src/runtime.ts";
import { createSettings } from "../src/settings.ts";
import { createHostSupervisor, type HostStatus } from "../src/supervisor.ts";

const safeStorage: SafeStorage = {
  isEncryptionAvailable: () => true, encryptString: (text) => Buffer.from(Buffer.from(text).map((byte) => byte ^ 0x5a)), decryptString: (data) => Buffer.from(data.map((byte) => byte ^ 0x5a)).toString("utf8"),
};
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
let runNumber = 0;

function setup(port: number) {
  const root = join(import.meta.dirname, "../../../.dev", `run-w8v-host-start-ports-${++runNumber}`);
  if (existsSync(root)) throw new Error(`Refusing to reuse existing run directory: ${root}`);
  mkdirSync(root, { recursive: true });
  const runtime: RuntimeCheck = { ok: true, warnings: [], runtime: { node: process.execPath, serverEntry: join(import.meta.dirname, "fixtures", "slow-server.ts"), ffmpeg: "/usr/bin/true", ffprobe: null, renderHost: "/app/JAgentChill" } };
  const settings = createSettings(join(root, "desktop.json"));
  settings.set("hostPort", port);
  const states: HostStatus[] = [];
  const diagnostics = createRotatingLog(join(root, "logs", "diagnostics.log"));
  const mainLog = createRotatingLog(join(root, "logs", "main.log"));
  const make = () => createHostSupervisor({
    userData: root, identity: createIdentity({ directory: join(root, "identity"), safeStorage, platform: "darwin" }), runtime: () => runtime,
    log: createRotatingLog(join(root, "logs", "host.log")), diagnostics, mainLog, settings, onChange: (status) => states.push(status),
  });
  return { root, states, make, settings, diagnostics, mainLog };
}
/** `start()` returns once channel P is up or the attempt has ended; a start that never returns is the fault this test exists for. */
const within = async (work: Promise<void>, ms: number, what: string) => {
  let timer: NodeJS.Timeout | undefined;
  try { await Promise.race([work, new Promise((_done, reject) => { timer = setTimeout(() => reject(new Error(`${what} did not finish within ${ms} ms`)), ms); })]); } finally { clearTimeout(timer); }
};
const connected = async (states: HostStatus[], from = 0, timeout = 20_000) => {
  const limit = Date.now() + timeout;
  // The agents are the server's own children, started per turn: a connected host whose server answers is `ready`.
  while (Date.now() < limit) { const hit = states.slice(from).find((status) => status.state === "ready" && status.reasons.length === 0 && status.serverVersion !== undefined); if (hit) return hit; await sleep(50); }
  throw new Error(`not connected: ${states.slice(from).map((status) => status.state).join(" → ")}`);
};

test("keychain failures log their reason to diagnostics and main logs", async () => {
  const { root, settings, states, diagnostics, mainLog } = setup(18950);
  settings.set("connectionMode", "local");
  const storedIdentity = createIdentity({ directory: join(root, "identity"), safeStorage, platform: "darwin" });
  storedIdentity.publicInfo();
  const unavailableStorage: SafeStorage = { ...safeStorage, isEncryptionAvailable: () => false };
  const unavailableIdentity = createIdentity({ directory: join(root, "identity"), safeStorage: unavailableStorage, platform: "darwin" });
  const supervisor = createHostSupervisor({
    userData: root, identity: unavailableIdentity,
    runtime: () => ({ ok: true, warnings: [], runtime: { node: process.execPath, serverEntry: "unused", ffmpeg: null, ffprobe: null, renderHost: "unused" } }),
    log: createRotatingLog(join(root, "logs", "host.log")), diagnostics, mainLog, settings, onChange: (status) => states.push(status),
  });
  await supervisor.start();
  assert.equal(supervisor.status().state, "failed");
  assert.ok(diagnostics.lastLines().some((line) => line.includes("launch failed reason=key_storage_unavailable step=identity")));
  assert.ok(mainLog.lastLines().some((line) => line.includes("launch failed reason=key_storage_unavailable step=identity")));
  assert.match(supervisor.status().message ?? "", /key|secure|store/i);
  await supervisor.dispose();
});

test("the launch watchdog names the step when host startup stalls before spawn", async () => {
  const { root, settings, states, diagnostics, mainLog } = setup(18950);
  settings.set("connectionMode", "local");
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const identity = createIdentity({ directory: join(root, "identity"), safeStorage, platform: "darwin" });
  identity.publicInfo();
  const supervisor = createHostSupervisor({
    userData: root, identity,
    runtime: () => ({ ok: true, warnings: [], runtime: { node: process.execPath, serverEntry: "unused", ffmpeg: null, ffprobe: null, renderHost: "unused" } }),
    log: createRotatingLog(join(root, "logs", "host.log")), diagnostics, mainLog, settings,
    launchWatchdogMs: 25, beforeLaunchStep: async () => held,
    onChange: (status) => states.push(status),
  });
  const starting = supervisor.start();
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline && !diagnostics.lastLines().some((line) => line.includes("launch watchdog") && line.includes("step=reap stale"))) await sleep(5);
  assert.ok(diagnostics.lastLines().some((line) => line.includes("launch watchdog: no server started or failure within 25 ms; step=reap stale")));
  assert.ok(mainLog.lastLines().some((line) => line.includes("launch watchdog: no server started or failure within 25 ms; step=reap stale")));
  await supervisor.stop();
  release();
  await starting;
  assert.ok(diagnostics.lastLines().some((line) => line.includes("launch cancelled step=reap stale")));
  await supervisor.dispose();
});

test("First run, then a cold launch where the server takes several seconds to listen: the socket closes before `ready`, the connection is retried, and no exception escapes", async () => {
  const faults: unknown[] = [];
  const onFault = (error: unknown) => faults.push(error);
  process.on("uncaughtException", onFault);
  process.on("unhandledRejection", onFault);
  const { root, states, make, settings } = setup(18950);
  // The built-in host starts only once this computer's connection is chosen; this test is about the local one.
  settings.set("connectionMode", "local");
  let pids: number[] = [];
  try {
    // First run: the trust bootstrap, with no user interaction.
    process.env.JC_TEST_LISTEN_DELAY_MS = "300";
    const first = make();
    await first.start();
    const one = await connected(states);
    pids.push(one.pid!);
    assert.deepEqual(readdirSync(join(root, "host", "bootstrap")), [], "the bootstrap file was read and deleted");
    assert.equal(first.hostRecord()?.builtIn, true);
    await first.stop();
    assert.equal(states.at(-1)!.state, "stopped");
    assert.equal(alive(one.pid!), false);

    // Second launch: the host record exists, so channel P is tried at once — three seconds before the server listens.
    const mark = states.length;
    process.env.JC_TEST_LISTEN_DELAY_MS = "3000";
    const second = make();
    const began = Date.now();
    await within(second.start(), 20_000, "the second launch");
    const two = await connected(states, mark);
    pids.push(two.pid!);
    assert.ok(Date.now() - began >= 2900, "the server really was not listening for three seconds");
    assert.equal(two.restartsLastHour, 0, "a late server is waited for, not restarted");
    assert.deepEqual(faults, []);
    await second.stop();

    // Third launch: something answers on the port and drops every connection before the handshake, then the server comes up.
    const mark2 = states.length;
    process.env.JC_TEST_LISTEN_DELAY_MS = "2000";
    process.env.JC_TEST_DROP_CONNECTIONS = "1";
    const third = make();
    await within(third.start(), 20_000, "the third launch");
    const three = await connected(states, mark2);
    pids.push(three.pid!);
    assert.equal(three.restartsLastHour, 0);
    assert.deepEqual(faults, []);
    assert.ok(states.slice(mark2).every((status) => status.state !== "failed"));
    await third.stop();
    assert.equal(existsSync(join(root, "host-supervisor.json")), false);
  } finally {
    delete process.env.JC_TEST_LISTEN_DELAY_MS;
    delete process.env.JC_TEST_DROP_CONNECTIONS;
    process.off("uncaughtException", onFault);
    process.off("unhandledRejection", onFault);
    for (const status of states) if (status.pid && !pids.includes(status.pid)) pids.push(status.pid);
    for (const pid of pids) if (alive(pid)) process.kill(pid, "SIGKILL");
  }
  assert.ok(pids.every((pid) => !alive(pid)), "no server process is left");
});

test("manual start during restart backoff does not let the scheduled launch reap its new child", async () => {
  const { root, states, make, settings, diagnostics } = setup(18950);
  settings.set("connectionMode", "local");
  let pids: number[] = [];
  const before = make();
  try {
    process.env.JC_TEST_EXIT_AFTER_MS = "1400";
    await within(before.start(), 20_000, "the first local launch");
    const first = await connected(states, 0);
    pids.push(first.pid!);
    const exitedBy = Date.now() + 8_000;
    while (Date.now() < exitedBy && !states.some((status) => status.state === "restarting")) await sleep(50);
    assert.ok(states.some((status) => status.state === "restarting"), "the server exit scheduled its normal restart");

    delete process.env.JC_TEST_EXIT_AFTER_MS;
    process.env.JC_TEST_LISTEN_DELAY_MS = "3000";
    const mark = states.length;
    await within(before.start(), 20_000, "the manual start during restart backoff");
    const recovered = await connected(states, mark, 15_000);
    pids.push(recovered.pid!);
    await sleep(1300);
    assert.equal(before.status().state, "ready");
    assert.ok(diagnostics.lastLines().every((line) => !line.includes("ending a server left by an earlier run")), "the retry must not reap the server started by the manual launch");
    assert.equal(new Set(states.filter((status) => status.pid).map((status) => status.pid)).size, 2, "only the first failed server and one replacement were started");
    await before.stop();
  } finally {
    delete process.env.JC_TEST_EXIT_AFTER_MS;
    delete process.env.JC_TEST_LISTEN_DELAY_MS;
    for (const status of states) if (status.pid && !pids.includes(status.pid)) pids.push(status.pid);
    for (const pid of pids) if (alive(pid)) process.kill(pid, "SIGKILL");
  }
  assert.ok(pids.every((pid) => !alive(pid)), "no server process is left");
});
