import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RESTART_BACKOFF_MS, STATE_LABELS, SUPERVISOR_STATES, choosePorts, connectRetryDelay, createRestartPolicy, hostView, invalidConfigKey, isOwnRuntime, isServerOfDataDir, killSteps,
  nodeVersionSupported, parseSupervisorRecord, reasonText, serverArguments, serverEnvironment,
} from "../src/index.ts";

const freeExcept = (...busy: number[]) => async (port: number) => !busy.includes(port);

test("Default port busy: the server takes 18911, the Gateway the next free port after it, and those are tried first next time", async () => {
  assert.deepEqual(await choosePorts({ isFree: freeExcept() }), { ok: true, serverPort: 18910, gatewayPort: 18911 });
  const chosen = await choosePorts({ isFree: freeExcept(18910, 18912) });
  assert.deepEqual(chosen, { ok: true, serverPort: 18911, gatewayPort: 18913 });
  assert.deepEqual(await choosePorts({ isFree: freeExcept(), remembered: { serverPort: 18911, gatewayPort: 18913 } }), { ok: true, serverPort: 18911, gatewayPort: 18913 });
  // A remembered port that is busy now is not waited for.
  assert.deepEqual(await choosePorts({ isFree: freeExcept(18913), remembered: { serverPort: 18911, gatewayPort: 18913 } }), { ok: true, serverPort: 18912, gatewayPort: 18914 });
  assert.deepEqual(await choosePorts({ configured: 20000, isFree: freeExcept() }), { ok: true, serverPort: 20000, gatewayPort: 20001 });
});

test("Range exhausted: fewer than two free ports of the 21 fails and the message names the range", async () => {
  const only = (port: number) => async (candidate: number) => candidate === port;
  assert.deepEqual(await choosePorts({ isFree: only(18920) }), { ok: false, message: "No free port between 18910 and 18930", from: 18910, to: 18930 });
  assert.deepEqual(await choosePorts({ isFree: async () => false }), { ok: false, message: "No free port between 18910 and 18930", from: 18910, to: 18930 });
  assert.deepEqual(await choosePorts({ isFree: async (port) => port >= 18929 }), { ok: true, serverPort: 18929, gatewayPort: 18930 });
});

test("Foreign host on the port: a port in use is skipped whatever answers on it — only bind checks decide", async () => {
  const probed: number[] = [];
  const chosen = await choosePorts({ isFree: async (port) => { probed.push(port); return port !== 18910; } });
  assert.deepEqual(chosen, { ok: true, serverPort: 18911, gatewayPort: 18912 });
  assert.deepEqual(probed, [18910, 18911, 18912]);
});

test("A busy remembered desktop pair advances from that pair instead of drifting to the standalone default", async () => {
  const chosen = await choosePorts({
    configured: 18910,
    remembered: { serverPort: 18915, gatewayPort: 18916 },
    isFree: freeExcept(18915),
  });
  assert.deepEqual(chosen, { ok: true, serverPort: 18916, gatewayPort: 18917 });
});

test("each supervisor state has its fixed label", () => {
  assert.deepEqual(SUPERVISOR_STATES.map((state) => STATE_LABELS[state]), ["Stopped", "Starting…", "Running", "Running with problems", "Restarting…", "Repairing configuration…", "Failed", "Stopping…"]);
});

test("Ready by handshake: connected is ready only once the server also reports its Gateway ready", () => {
  assert.deepEqual(hostView({ phase: "starting" }), { state: "starting", reasons: [] });
  assert.deepEqual(hostView({ phase: "connected" }), { state: "degraded", reasons: ["gateway_starting"] });
  assert.deepEqual(hostView({ phase: "connected", gateway: { state: "starting" } }), { state: "degraded", reasons: ["gateway_starting"] });
  assert.deepEqual(hostView({ phase: "connected", gateway: { state: "ready" } }), { state: "ready", reasons: [] });
});

test("Gateway down while the server is up: crash_loop and config_invalid degrade, the process is not restarted for them", () => {
  assert.deepEqual(hostView({ phase: "connected", gateway: { state: "crash_loop" } }), { state: "degraded", reasons: ["gateway_crash_loop"] });
  assert.deepEqual(hostView({ phase: "connected", gateway: { state: "config_invalid", lastExitCode: 78 } }), { state: "degraded", reasons: ["gateway_config_invalid"] });
  assert.equal(reasonText("gateway_crash_loop"), "Agents are unavailable on this computer");
  assert.equal(reasonText("gateway_config_invalid"), "Host configuration repair failed");
});

test("Single crash of the Gateway: restarting maps to degraded with gateway_starting", () => {
  assert.deepEqual(hostView({ phase: "connected", gateway: { state: "restarting", lastExitCode: 1 } }), { state: "degraded", reasons: ["gateway_starting"] });
});

test("Repair succeeds: a Gateway coming back after exit code 78 shows doctor, then ready", () => {
  assert.deepEqual(hostView({ phase: "connected", gateway: { state: "starting", lastExitCode: 78 } }), { state: "doctor", reasons: [] });
  assert.deepEqual(hostView({ phase: "connected", gateway: { state: "ready", lastExitCode: 78 } }), { state: "ready", reasons: [] });
});

test("Degraded health: a health reason degrades a connected host; FFmpeg missing does too", () => {
  assert.deepEqual(hostView({ phase: "connected", gateway: { state: "ready" }, healthReasons: ["render_host_unavailable"] }), { state: "degraded", reasons: ["render_host_unavailable"] });
  assert.deepEqual(hostView({ phase: "connected", gateway: { state: "ready" }, healthReasons: ["ffmpeg_missing"] }), { state: "degraded", reasons: ["ffmpeg_missing"] });
  assert.deepEqual(hostView({ phase: "connected", gateway: { state: "ready" }, protocolCompatible: false }), { state: "degraded", reasons: ["protocol_incompatible"] });
});

test("Device key lost: a host that has devices and not this computer is degraded with the restore action's reason", () => {
  assert.deepEqual(hostView({ phase: "starting", notADevice: true }), { state: "degraded", reasons: ["not_a_device"] });
  assert.equal(reasonText("not_a_device"), "This computer is not a device of its own host");
});

test("No secret store on first run: failed with key_storage_unavailable", () => {
  assert.deepEqual(hostView({ phase: "failed", failureReason: "key_storage_unavailable" }), { state: "failed", reasons: ["key_storage_unavailable"] });
});

test("Crash loop: 1, 2, 4, 8 and 16 s, then no sixth automatic start inside five minutes", () => {
  let now = 0;
  const policy = createRestartPolicy(() => now);
  const delays: number[] = [];
  for (let i = 0; i < 5; i++) { const decision = policy.failed(1); assert.equal(decision.action, "restart"); delays.push((decision as { delayMs: number }).delayMs); now += 3000; }
  assert.deepEqual(delays, [...RESTART_BACKOFF_MS]);
  assert.deepEqual(policy.failed(1), { action: "give-up" });
  // Outside the five-minute window the count starts again.
  now += 5 * 60_000;
  assert.deepEqual(policy.failed(null), { action: "restart", delayMs: 1000, attempt: 1 });
});

test("Single crash of the server: the first restart comes after 1 s, and two minutes connected reset the counter", () => {
  let now = 0;
  const policy = createRestartPolicy(() => now);
  assert.deepEqual(policy.failed(null), { action: "restart", delayMs: 1000, attempt: 1 });
  assert.deepEqual(policy.failed(null), { action: "restart", delayMs: 2000, attempt: 2 });
  policy.stable(119_000);
  assert.equal(policy.failures, 2);
  policy.stable(120_000);
  assert.deepEqual(policy.failed(null), { action: "restart", delayMs: 1000, attempt: 1 });
});

test("Invalid server configuration: exit code 78 is never restarted automatically and the key is named", () => {
  const policy = createRestartPolicy();
  assert.deepEqual(policy.failed(78), { action: "hold", reason: "server_config_invalid" });
  assert.equal(policy.failures, 0);
  assert.equal(invalidConfigKey(["[server] starting", '[config] unknown key "queue.maxConcurent"']), "queue.maxConcurent");
  assert.equal(invalidConfigKey(["nothing here"]), null);
});

test("Handshake never completes: the connection is retried every 250 ms for 5 s and every second afterwards", () => {
  assert.equal(connectRetryDelay(0), 250);
  assert.equal(connectRetryDelay(4999), 250);
  assert.equal(connectRetryDelay(5000), 1000);
});

test("Prepared stop on Windows: the tree is ended with taskkill /T /F; elsewhere SIGTERM, then SIGKILL", () => {
  assert.deepEqual(killSteps("win32", 1234), [{ command: "taskkill", args: ["/PID", "1234", "/T", "/F"] }]);
  assert.deepEqual(killSteps("darwin", 1234, { group: true }), [{ signal: "SIGTERM", pid: 1234, group: true }, { signal: "SIGKILL", pid: 1234, group: true }]);
  assert.deepEqual(killSteps("linux", 1234, { group: true, graceful: false }), [{ signal: "SIGKILL", pid: 1234, group: true }]);
});

test("Stale child at launch: a recorded pid is killed only when it runs the bundled Node with our entry", () => {
  const node = "/Applications/JAgentChill.app/Contents/Resources/node/bin/node", entry = "/Applications/JAgentChill.app/Contents/Resources/server/lib/app/jagentchill-server.mjs";
  assert.equal(isOwnRuntime(`${node} ${entry} serve --data-dir /u/host --port 18910`, node, entry), true);
  assert.equal(isOwnRuntime("/usr/bin/python3 server.py", node, entry), false);
  assert.equal(isOwnRuntime(`/usr/local/bin/node ${entry} serve`, node, entry), false);
  assert.equal(isOwnRuntime("C:\\Program Files\\JAgentChill\\resources\\node\\node.exe C:\\Program Files\\JAgentChill\\resources\\server\\jagentchill-server.mjs serve", "C:/Program Files/JAgentChill/resources/node/node.exe", "C:\\Program Files\\JAgentChill\\resources\\server\\jagentchill-server.mjs"), true);
  // A record written by an earlier build may still name a pid of the removed agent engine: it is not read.
  assert.deepEqual(parseSupervisorRecord('{"serverPid":4242,"gatewayPid":4250,"serverPort":18910,"gatewayPort":18911}'), { serverPid: 4242, serverPort: 18910, gatewayPort: 18911 });
  assert.deepEqual(parseSupervisorRecord('{"serverPid":1,"serverPort":"x"}'), { serverPid: undefined, serverPort: undefined, gatewayPort: undefined });
  assert.deepEqual(parseSupervisorRecord("not json"), {});
});

test("Start: the server receives packaged media tools as well as its host variables, without Electron-only variables", () => {
  assert.deepEqual(serverArguments("/r/server.mjs", "/u/host", 18910), ["/r/server.mjs", "serve", "--data-dir", "/u/host", "--port", "18910"]);
  const env = serverEnvironment({ PATH: "/bin", ELECTRON_RUN_AS_NODE: "1", NODE_OPTIONS: "--inspect", JAGENTCHILL_PORT: "1", JAGENTCHILL_FFMPEG: "/stale/ffmpeg" }, { renderHostPath: "/app/JAgentChill", ffmpegPath: "/resources/ffmpeg/ffmpeg", ffprobePath: "/resources/ffmpeg/ffprobe", bootstrapPublicKey: "KEY", keyProtection: "os-store" });
  assert.deepEqual(env, {
    PATH: "/bin", JAGENTCHILL_RENDER_HOST_PATH: "/app/JAgentChill", JAGENTCHILL_BOOTSTRAP_DEVICE_PUBLIC_KEY: "KEY", JAGENTCHILL_BOOTSTRAP_KEY_PROTECTION: "os-store",
    JAGENTCHILL_FFMPEG: "/resources/ffmpeg/ffmpeg", JAGENTCHILL_FFPROBE: "/resources/ffmpeg/ffprobe",
  });
});

test("Electron is never the Node runtime of the host: the runtime must be Node >=24.16 <25 or >=26.1", () => {
  for (const version of ["v24.16.0", "v24.17.0", "24.21.3", "v26.1.0", "v27.0.0"]) assert.equal(nodeVersionSupported(version), true, version);
  for (const version of ["v24.15.9", "v22.20.0", "v25.3.0", "v26.0.1", "", "electron"]) assert.equal(nodeVersionSupported(version), false, version);
});

test("Orphan server: a server on this data directory is recognised by its command line whatever build started it, and only that one", () => {
  const dir = "/Users/me/Library/Application Support/JAgentChill/host";
  const line = (runtime: string, port: number) => `${runtime}/node/bin/node ${runtime}/server/lib/app/jagentchill-server.mjs serve --data-dir ${dir} --port ${port}`;
  assert.equal(isServerOfDataDir(line("/Applications/JAgentChill.app/Contents/Resources", 18915), dir), true);
  assert.equal(isServerOfDataDir(line("/x/desktop-s8/mac-arm64/JAgentChill.app/Contents/Resources", 18911), `${dir}/`), true, "another build, a trailing slash");
  assert.equal(isServerOfDataDir(`node /r/jagentchill-server.mjs serve --data-dir ${dir} `, dir), true);
  assert.equal(isServerOfDataDir(line("/a", 1).replace(dir, "/Users/me/other"), dir), false, "another data directory");
  assert.equal(isServerOfDataDir(`vim ${dir}`, dir), false, "an unrelated process");
  assert.equal(isServerOfDataDir(`node /r/jagentchill-server.mjs serve --data-dir ${dir}-copy --port 1`, dir), false, "a directory that only starts the same");
});
test("Orphan server: the server is told which process started it, so that it leaves with it", () => {
  const base = { renderHostPath: "/a", bootstrapPublicKey: "K", keyProtection: "os-store" };
  assert.equal(serverEnvironment({}, { ...base, parentPid: 4242 }).JAGENTCHILL_PARENT_PID, "4242");
  assert.equal("JAGENTCHILL_PARENT_PID" in serverEnvironment({}, base), false);
});
