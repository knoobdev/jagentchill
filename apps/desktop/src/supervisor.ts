import { execFile, execFileSync, spawn, type ChildProcess } from "node:child_process";
import { userPath } from "./shell-path.ts";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { connectHost, HostError, type HostConnection } from "@jagentchill/client";
import {
  BOOTSTRAP_WAIT_MS, CHANNEL_LOSS_LIMIT_MS, PREPARE_CONNECT_MS, READY_DEADLINE_MS, STATE_LABELS, STOP_GRACE_MS, choosePorts, connectRetryDelay,
  createRestartPolicy, hostView, invalidConfigKey, isOwnRuntime, isServerOfDataDir, killSteps, parseSupervisorRecord, reasonText, serverArguments, serverEnvironment,
  type GatewayReport, type ProcessPhase, type RotatingLog, type SupervisorState,
} from "@jagentchill/desktop-core";
import { MIN_PROTOCOL_VERSION, PROTOCOL_VERSION, TAILNET_METHODS, base64UrlToBytes, gatewayIdFromKeyDigest, type DesktopHostRecord, type NetworkLevel, type TailnetStatus } from "@jagentchill/protocol";
import { createHash } from "node:crypto";
import { shouldStartBundledHost } from "./connection-mode.ts";
import { KeyStorageUnavailable, type Identity } from "./identity.ts";
import type { RuntimeCheck } from "./runtime.ts";

export type HostStatus = {
  state: SupervisorState; label: string; reasons: string[]; reasonTexts: string[]; message?: string;
  enabled: boolean; pid?: number; port?: number; gatewayPort?: number; gatewayId?: string;
  portChange?: { previous: string; current: string };
  started_ms?: number; serverVersion?: string; protocolVersion?: number;
  gateway?: { state: string; restartCount: number; lastExit?: { code: number | null; signal: string | null; ts_ms: number } };
  lastExit?: { code: number | null; signal: string | null; ts_ms: number };
  restartsLastHour: number; networkLevel: NetworkLevel; keyProtection: string | null; path: "This computer";
  listeners: { tailnet: { available: boolean; enabled: boolean }; lan: { available: boolean; enabled: boolean } };
};
type Settings = { get<T>(key: string): T | undefined; set(key: string, value: unknown): void };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const alive = (pid: number, group = false): boolean => { try { process.kill(group ? -pid : pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; } };
const portFree = (port: number) => new Promise<boolean>((resolve) => {
  const probe = createServer();
  probe.once("error", () => resolve(false));
  probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
});
function commandLineOf(pid: number): string {
  try {
    if (process.platform === "win32") return execFileSync("powershell", ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
    return execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8", timeout: 5000 });
  } catch { return ""; }
}

/**
 * Starts, watches and stops JAgentChill Server as a child of the app. The server starts the agent CLIs itself; the app
 * talks to the server only over the product channel, as a signed device.
 */
export function createHostSupervisor(deps: {
  userData: string; identity: Identity; runtime: () => RuntimeCheck; log: RotatingLog; diagnostics: RotatingLog; mainLog?: RotatingLog; settings: Settings;
  /** Internal timing seam for deterministic watchdog tests; production uses the fixed 15-second deadline. */
  launchWatchdogMs?: number; beforeLaunchStep?(step: "reap stale"): Promise<void>;
  tsnetBridgeBinary?: string;
  onChange(status: HostStatus): void; notify?(kind: "host.stopped" | "host.repaired"): void;
}) {
  const dataDir = join(deps.userData, "host"), recordFile = join(deps.userData, "host-supervisor.json");
  const policy = createRestartPolicy();
  let phase: ProcessPhase = "stopped";
  let failure: { reason: string; message?: string } | undefined;
  let child: ChildProcess | null = null;
  let connection: HostConnection | null = null;
  let record: DesktopHostRecord | undefined;
  let ports: { serverPort: number; gatewayPort: number } | undefined;
  let portChange: HostStatus["portChange"];
  let gateway: (GatewayReport & { pid?: number; restartCount: number; lastExit?: { code: number | null; signal: string | null; ts_ms: number } }) | undefined;
  let hostInfo: { serverVersion?: string; protocolVersion?: number } = {};
  let healthReasons: string[] = [];
  let notADevice = false;
  let started_ms: number | undefined;
  let lastExit: HostStatus["lastExit"];
  let restarts: number[] = [];
  let generation = 0;
  let restartTimer: NodeJS.Timeout | null = null;
  let healthTimer: NodeJS.Timeout | null = null;
  let connectedAt = 0;
  let wasDoctor = false;
  let stopping: Promise<void> | null = null;
  let launchTask: Promise<void> | null = null;
  let restartTask: Promise<void> | null = null;
  let launchStep = "runtime check";
  let launchWatchdog: NodeJS.Timeout | null = null;
  const launchWatchdogMs = deps.launchWatchdogMs ?? 15_000;
  const launchWatchdogLabel = launchWatchdogMs === 15_000 ? "15 s" : `${launchWatchdogMs} ms`;

  const logLaunch = (line: string) => {
    deps.diagnostics.line(line);
    deps.mainLog?.line(line);
  };
  const clearLaunchWatchdog = () => {
    if (launchWatchdog) clearTimeout(launchWatchdog);
    launchWatchdog = null;
  };

  const enabled = () => deps.settings.get<boolean>("builtInHost") !== false;
  const writeRecord = () => writeFileSync(recordFile, JSON.stringify({ serverPid: child?.pid, ...ports }), { mode: 0o600 });

  function status(): HostStatus {
    const warnings = (() => { const check = deps.runtime(); return check.ok ? check.warnings : []; })();
    const view = hostView({
      phase, failureReason: failure?.reason, gateway, healthReasons: [...warnings, ...healthReasons], notADevice,
      protocolCompatible: hostInfo.protocolVersion === undefined ? undefined : hostInfo.protocolVersion >= MIN_PROTOCOL_VERSION && hostInfo.protocolVersion <= PROTOCOL_VERSION,
    });
    const now = Date.now();
    return {
      state: view.state, label: STATE_LABELS[view.state], reasons: view.reasons, reasonTexts: view.reasons.map(reasonText), ...(failure?.message ? { message: failure.message } : {}),
      enabled: enabled(), ...(child?.pid ? { pid: child.pid } : {}), ...(ports ? { port: ports.serverPort, gatewayPort: ports.gatewayPort } : {}), ...(portChange ? { portChange } : {}),
      ...(record ? { gatewayId: record.gatewayId } : {}), ...(started_ms ? { started_ms } : {}), ...hostInfo,
      ...(gateway ? { gateway: { state: gateway.state, restartCount: gateway.restartCount, ...(gateway.lastExit ? { lastExit: gateway.lastExit } : {}) } } : {}),
      ...(lastExit ? { lastExit } : {}), restartsLastHour: restarts.filter((time) => now - time < 3_600_000).length,
      networkLevel: "this-computer", keyProtection: deps.identity.keyProtection, path: "This computer",
      // The product listeners belong to the tailnet bridge and the LAN listener, which this build does not carry.
      listeners: { tailnet: { available: false, enabled: false }, lan: { available: false, enabled: false } },
    };
  }
  let lastPushed = "";
  const changed = () => {
    const next = status(), text = JSON.stringify(next);
    if (text === lastPushed) return;
    lastPushed = text;
    // A listener that throws (a tray that is already destroyed while the app quits) never stops what the supervisor is doing.
    try { deps.onChange(next); } catch (error) { deps.diagnostics.line(`[supervisor] a status listener failed: ${error}`); }
    // The repair of exit code 78 succeeded when `doctor` is followed by `ready`.
    if (wasDoctor && next.state === "ready") deps.notify?.("host.repaired");
    wasDoctor = next.state === "doctor";
  };
  const fail = (reason: string, message?: string) => {
    clearLaunchWatchdog();
    logLaunch(`[supervisor] launch failed reason=${reason} step=${launchStep}${message ? ` message=${message}` : ""}`);
    const entering = phase !== "failed";
    phase = "failed";
    failure = { reason, ...(message ? { message } : {}) };
    changed();
    if (entering && reason !== "key_storage_unavailable") deps.notify?.("host.stopped");
  };

  /** Ends a process tree: asked first, killed after the grace period; on Windows killed at once, with its descendants. */
  async function endTree(pid: number, opts: { group: boolean; graceful: boolean }): Promise<void> {
    for (const step of killSteps(process.platform, pid, opts)) {
      if ("command" in step) { await new Promise<void>((resolve) => execFile(step.command, step.args, { windowsHide: true }, () => resolve())); continue; }
      if (!alive(pid, step.group)) return;
      try { process.kill(step.group ? -pid : pid, step.signal); } catch { /* already gone */ }
      const limit = Date.now() + (step.signal === "SIGTERM" ? STOP_GRACE_MS : 5000);
      while (alive(pid, step.group) && Date.now() < limit) await sleep(50);
    }
  }
  /** Leftovers of a run that crashed: the recorded server, when it runs our runtime. */
  async function reapStale(runtime: { node: string; serverEntry: string }): Promise<void> {
    if (existsSync(recordFile)) {
      const stale = parseSupervisorRecord(readFileSync(recordFile, "utf8"));
      if (stale.serverPid && alive(stale.serverPid) && isOwnRuntime(commandLineOf(stale.serverPid), runtime.node, runtime.serverEntry)) {
        deps.diagnostics.line(`[supervisor] ending a server left by an earlier run (pid ${stale.serverPid})`);
        await endTree(stale.serverPid, { group: process.platform !== "win32", graceful: true });
      }
      rmSync(recordFile, { force: true });
    }
    await endServerOfDataDir(true);
  }
  /**
   * Never two servers on one data directory: the server writes its pid beside its data, and whichever build or runtime
   * started it, a live process whose command line is a server on this directory is ended (asked first when `graceful`).
   */
  async function endServerOfDataDir(graceful: boolean): Promise<void> {
    const file = join(dataDir, "run", "server.json");
    if (!existsSync(file)) return;
    let pid = 0;
    try { pid = Number((JSON.parse(readFileSync(file, "utf8")) as { pid?: unknown }).pid); } catch { /* unreadable: nothing to end */ }
    if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid || !alive(pid)) { rmSync(file, { force: true }); return; }
    if (!isServerOfDataDir(commandLineOf(pid), dataDir)) { deps.diagnostics.line(`[supervisor] pid ${pid} named in ${file} is not a server of this data directory; left alone`); return; }
    deps.diagnostics.line(`[supervisor] ending a server that holds this data directory (pid ${pid})`);
    // A server this app started leads a group of its own; one that was started otherwise may not.
    await endTree(pid, { group: false, graceful });
    if (alive(pid) && process.platform !== "win32") { try { process.kill(-pid, "SIGKILL"); } catch { /* not a group leader */ } }
    rmSync(file, { force: true });
  }

  async function readBootstrapToken(deviceId: string): Promise<DesktopHostRecord["deviceToken"]> {
    const file = join(dataDir, "bootstrap", `${deviceId}.json`);
    const token = (JSON.parse(readFileSync(file, "utf8")) as { deviceToken: DesktopHostRecord["deviceToken"] }).deviceToken;
    // A token that stays readable on disk is a failed start: the file is deleted before the token is used.
    unlinkSync(file);
    if (existsSync(file)) throw new Error("the bootstrap file could not be deleted");
    return token;
  }
  /** The host's public identity, from the server this app started on the port this app chose. The id must be the digest of the key. */
  async function hostIdentity(port: number): Promise<{ gatewayId: string; gatewayPublicKey: string; protocolVersion?: number } | null> {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/jagentchill/v1/health`, { signal: AbortSignal.timeout(2000) });
      const body = (await response.json()) as { gatewayId?: string; gatewayPublicKey?: string; protocolVersion?: number };
      const raw = base64UrlToBytes(body.gatewayPublicKey ?? "");
      if (!body.gatewayId || raw?.length !== 32 || gatewayIdFromKeyDigest(createHash("sha256").update(raw).digest()) !== body.gatewayId) return null;
      return { gatewayId: body.gatewayId, gatewayPublicKey: body.gatewayPublicKey!, protocolVersion: body.protocolVersion };
    } catch { return null; }
  }
  async function refreshHealth(): Promise<void> {
    if (!ports || phase !== "connected") return;
    try {
      const body = (await (await fetch(`http://127.0.0.1:${ports.serverPort}/jagentchill/v1/health`, { signal: AbortSignal.timeout(2000) })).json()) as { reasons?: unknown };
      healthReasons = Array.isArray(body.reasons) ? body.reasons.filter((reason): reason is string => typeof reason === "string") : [];
    } catch { /* the channel, not this route, says whether the server is there */ }
    policy.stable(Date.now() - connectedAt);
    changed();
  }
  const applyHost = (payload: any) => {
    if (!payload?.gateway) return;
    gateway = { state: payload.gateway.state, pid: payload.gateway.pid, restartCount: payload.gateway.restartCount ?? 0, lastExit: payload.gateway.lastExit, lastExitCode: payload.gateway.lastExit?.code };
    hostInfo = { serverVersion: payload.serverVersion, protocolVersion: payload.protocolVersion };
    writeRecord();
    changed();
  };

  /** Opens channel P with the device key; retried until `ready`, the deadline, or the end of this generation. */
  async function connect(run: number, spawnedAt: number, deadlineMs: number): Promise<boolean> {
    while (run === generation && child && Date.now() - spawnedAt < deadlineMs) {
      // The record and the signer are read again each time: a replaced key comes with a new token.
      record = deps.identity.hosts().find((host) => host.builtIn) ?? record;
      const signer = deps.identity.signer();
      try {
        // The socket can close before `connectHost` resolves (server not listening yet): `live` must already exist then.
        let live: Awaited<ReturnType<typeof connectHost>> | null = null;
        live = await connectHost({
          // Channel P is this computer's own link to its bundled host: always loopback on the port just spawned. The
          // saved record's origin can be the host's tailnet address (what other devices use) — never dial that here.
          host: { ...record!, origin: `http://127.0.0.1:${ports!.serverPort}` }, signer, clientInstanceId: "desktop-supervisor",
          onTokenRotated: (deviceToken) => { record = { ...record!, deviceToken }; deps.identity.saveHost(record); },
          onEvent: (event) => { if (event.event === "jagentchill.settings.host.changed") applyHost(event.payload); },
          onClose: () => { if (run === generation && live && connection === live) void channelLost(run); },
        });
        if (run !== generation) { live.close(); return false; }
        connection = live;
        connectedAt = Date.now();
        phase = "connected";
        notADevice = false;
        applyHost(await live.call("jagentchill.settings.host.get"));
        void refreshHealth();
        changed();
        return true;
      } catch (error) {
        const code = error instanceof HostError ? error.code : "";
        if (["DEVICE_UNKNOWN", "TOKEN_INVALID", "TOKEN_EXPIRED", "DEVICE_REVOKED", "DEVICE_NOT_PAIRED"].includes(code)) {
          // The server is up and this computer's key is not one of its devices: nothing is retried until the user restores it.
          notADevice = true;
          changed();
          return false;
        }
        await sleep(connectRetryDelay(Date.now() - spawnedAt));
      }
    }
    return false;
  }
  async function channelLost(run: number): Promise<void> {
    connection = null;
    if (run !== generation || !child || stopping) return;
    phase = "restarting";
    changed();
    // The process is alive: fifteen seconds to come back before the server is ended and started again.
    if (await connect(run, Date.now(), CHANNEL_LOSS_LIMIT_MS)) return;
    if (run !== generation || !child || notADevice) return;
    deps.diagnostics.line("[supervisor] channel lost for more than 15 s; restarting the server");
    await kill(false);
    schedule(policy.failed());
  }
  function schedule(decision: ReturnType<typeof policy.failed>): void {
    if (decision.action === "hold") return fail("server_config_invalid", (() => { const key = invalidConfigKey(deps.log.lastLines()); return key ? `The host configuration key "${key}" is not valid` : undefined; })());
    if (decision.action === "give-up") return fail("crash_loop", "The built-in host stopped");
    phase = "restarting";
    changed();
    restarts.push(Date.now());
    restartTimer = setTimeout(() => { restartTimer = null; void launch(); }, decision.delayMs);
  }

  async function launchOnce(): Promise<void> {
    const run = ++generation;
    launchStep = "runtime check";
    clearLaunchWatchdog();
    launchWatchdog = setTimeout(() => {
      if (run === generation && phase !== "failed" && !child) {
        logLaunch(`[supervisor] launch watchdog: no server started or failure within ${launchWatchdogLabel}; step=${launchStep}`);
      }
    }, launchWatchdogMs);
    failure = undefined;
    notADevice = false;
    healthReasons = [];
    gateway = undefined;
    try {
    const check = deps.runtime();
    if (!check.ok) return fail("runtime_missing", `The installation is incomplete — reinstall JAgentChill (${check.missing.join(", ")})`);
    launchStep = "identity";
    let info: ReturnType<Identity["publicInfo"]>;
    try { info = deps.identity.publicInfo(); } catch (error) {
      // No server is spawned while this computer has no device key.
      if (error instanceof KeyStorageUnavailable) return fail("key_storage_unavailable", error.message);
      throw error;
    }
    if (phase !== "restarting") phase = "starting";
    changed();
    launchStep = "reap stale";
    await deps.beforeLaunchStep?.("reap stale");
    if (run !== generation) { logLaunch(`[supervisor] launch cancelled step=${launchStep}`); return; }
    await reapStale(check.runtime);
    launchStep = "choose ports";
    let chosen: Awaited<ReturnType<typeof choosePorts>>;
    const requestedPort = process.env.JAGENTCHILL_PORT ? Number(process.env.JAGENTCHILL_PORT) : undefined;
    const requestedGatewayPort = process.env.JAGENTCHILL_GATEWAY_PORT ? Number(process.env.JAGENTCHILL_GATEWAY_PORT) : undefined;
    if (requestedPort !== undefined || requestedGatewayPort !== undefined) {
      if (requestedPort === undefined || requestedGatewayPort === undefined || !Number.isInteger(requestedPort) || !Number.isInteger(requestedGatewayPort) || requestedGatewayPort !== requestedPort + 1
        || !(await portFree(requestedPort)) || !(await portFree(requestedGatewayPort))) {
        return fail("no_free_port", "The requested server and Gateway ports must be free and consecutive.");
      }
      chosen = { ok: true, serverPort: requestedPort, gatewayPort: requestedGatewayPort };
    } else {
      chosen = await choosePorts({ configured: deps.settings.get<number>("hostPort"), remembered: deps.settings.get("hostPorts"), isFree: portFree });
    }
    if (run !== generation) { logLaunch(`[supervisor] launch cancelled step=${launchStep}`); return; }
    if (!chosen.ok) return fail("no_free_port", chosen.message);
    const remembered = deps.settings.get<{ serverPort: number; gatewayPort: number }>("hostPorts");
    if (remembered && (remembered.serverPort !== chosen.serverPort || remembered.gatewayPort !== chosen.gatewayPort)) {
      portChange = { previous: `${remembered.serverPort}/${remembered.gatewayPort}`, current: `${chosen.serverPort}/${chosen.gatewayPort}` };
      logLaunch(`[supervisor] remembered host port pair ${portChange.previous} was occupied; using ${portChange.current}`);
    }
    ports = { serverPort: chosen.serverPort, gatewayPort: chosen.gatewayPort };
    deps.settings.set("hostPorts", ports);
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const spawnedAt = Date.now();
    const connectionMode = deps.settings.get<"tailscale" | "local">("connectionMode");
    const keepAfterQuit = deps.settings.get<boolean>("keepHostAfterQuit") === true;
    const childEnv = serverEnvironment({ ...process.env, PATH: await userPath() }, { parentPid: keepAfterQuit ? undefined : process.pid, renderHostPath: check.runtime.renderHost, sdEnginePath: check.runtime.sdEngine, ffmpegPath: check.runtime.ffmpeg, ffprobePath: check.runtime.ffprobe, bootstrapPublicKey: info.devicePublicKey, keyProtection: info.keyProtection });
    childEnv.JAGENTCHILL_PORT = String(ports.serverPort);
    if (keepAfterQuit) delete childEnv.JAGENTCHILL_PARENT_PID;
    childEnv.JAGENTCHILL_TAILNET_ENABLED = connectionMode === "tailscale" ? "1" : "0";
    if (deps.tsnetBridgeBinary) childEnv.JAGENTCHILL_TSNET_BRIDGE_BIN = deps.tsnetBridgeBinary;
    launchStep = "spawn";
    const spawned = spawn(check.runtime.node, serverArguments(check.runtime.serverEntry, dataDir, ports.serverPort), {
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
      // Its own process group, so that the tree (the server and the agent CLIs it started) is ended with one signal.
      detached: process.platform !== "win32",
    });
    child = spawned;
    started_ms = spawnedAt;
    spawned.stdout!.on("data", (chunk) => deps.log.write(chunk));
    spawned.stderr!.on("data", (chunk) => deps.log.write(chunk));
    spawned.on("error", (error) => fail("spawn_failed", error.message));
    spawned.on("exit", (code, signal) => {
      if (child !== spawned) return;
      child = null;
      connection = null;
      lastExit = { code, signal, ts_ms: Date.now() };
      deps.diagnostics.line(`[supervisor] server exited code=${code} signal=${signal}\n${deps.log.lastLines().map((line) => `    ${line}`).join("\n")}`);
      if (stopping || run !== generation) return;
      schedule(policy.failed(code));
    });
    writeRecord();
    clearLaunchWatchdog();
    logLaunch(`[supervisor] server started pid=${spawned.pid} port=${ports.serverPort} node=${check.runtime.node}`);
    changed();
    launchStep = "wait ready";
    launchWatchdog = setTimeout(() => {
      if (run === generation && child === spawned && phase !== "connected" && phase !== "failed") {
        logLaunch(`[supervisor] launch watchdog: server has not reached ready within ${launchWatchdogLabel}; step=wait ready`);
      }
    }, launchWatchdogMs);

    record = deps.identity.hosts().find((host) => host.builtIn);
    const origin = `http://127.0.0.1:${ports.serverPort}`;
    if (!record) {
      // First run: the server registers this computer and leaves the token in a file only this user can read.
      const file = join(dataDir, "bootstrap", `${info.deviceId}.json`);
      let identity: Awaited<ReturnType<typeof hostIdentity>> = null;
      // The server decides the bootstrap before it listens: once it answers, the file is there or will never be.
      while (run === generation && child && Date.now() - spawnedAt < BOOTSTRAP_WAIT_MS && !identity) {
        identity = await hostIdentity(ports.serverPort);
        if (!identity) await sleep(100);
      }
      if (run !== generation || !child) { logLaunch(`[supervisor] launch cancelled step=${launchStep}`); return; }
      if (!identity) {
        logLaunch("[supervisor] the server did not answer within 30 s of spawn");
        await kill(false);
        return schedule(policy.failed());
      }
      // The host has device records and none is this computer's key: no file is written and none is read.
      if (!existsSync(file)) { notADevice = true; changed(); return; }
      try {
        const deviceToken = await readBootstrapToken(info.deviceId);
        record = { gatewayId: identity.gatewayId, gatewayPublicKey: identity.gatewayPublicKey, gatewayName: "This computer", origin, role: "admin", deviceToken, verifiedClockOffset_ms: 0, builtIn: true };
        deps.identity.saveHost(record);
      } catch (error) {
        logLaunch(`[supervisor] bootstrap failed: ${(error as Error).message}`);
        await kill(false);
        return schedule(policy.failed());
      }
    } else if (record.origin !== origin) {
      record = { ...record, origin };
      deps.identity.saveHost(record);
    }
    if (await connect(run, spawnedAt, READY_DEADLINE_MS)) { logLaunch(`[supervisor] launch connected port=${ports.serverPort}`); return; }
    if (run !== generation || !child || notADevice) { logLaunch(`[supervisor] launch ended before ready step=${launchStep}`); return; }
    // Channel P never reached `ready`: a failed start of the server.
    logLaunch("[supervisor] channel P was not ready within 60 s of spawn");
    await kill(false);
    schedule(policy.failed());
    } catch (error) {
      fail("launch_failed", error instanceof Error ? error.message : String(error));
    } finally {
      clearLaunchWatchdog();
    }
  }

  /** Multiple lifecycle callers can converge during app bootstrap. Share one launch so one new child can never reap another. */
  function launch(): Promise<void> {
    if (launchTask) return launchTask;
    const task = launchOnce();
    let wrapped!: Promise<void>;
    wrapped = task.finally(() => { if (launchTask === wrapped) launchTask = null; });
    launchTask = wrapped;
    return wrapped;
  }

  /** Step 3 of the stop sequence: the server's tree. */
  async function kill(graceful: boolean): Promise<void> {
    const target = child;
    child = null;
    connection?.close();
    connection = null;
    if (target?.pid) await endTree(target.pid, { group: process.platform !== "win32", graceful });
    rmSync(recordFile, { force: true });
  }

  /** The one stop sequence, the same on the three systems: prepare over channel P, then end the tree. */
  function stop(): Promise<void> {
    stopping ??= (async () => {
      generation++;
      if (restartTimer) clearTimeout(restartTimer);
      restartTimer = null;
      if (!child) { phase = "stopped"; failure = undefined; notADevice = false; changed(); return; }
      phase = "stopping";
      changed();
      let live = connection;
      if (!live && record) {
        // Hung or still starting: one attempt of two seconds, then the prepare call is skipped.
        live = await Promise.race([connectHost({ host: record, signer: deps.identity.signer(), clientInstanceId: "desktop-supervisor", onTokenRotated: () => undefined }).catch(() => null), sleep(PREPARE_CONNECT_MS).then(() => null)]);
      }
      if (live) {
        const answer = await Promise.race([live.call<{ safe: boolean; running?: string[] }>("jagentchill.diagnostics.shutdown.prepare", {}).catch(() => null), sleep(12_000).then(() => null)]);
        deps.diagnostics.line(`[supervisor] shutdown.prepare → ${JSON.stringify(answer)}`);
        if (live !== connection) live.close();
      } else deps.diagnostics.line("[supervisor] shutdown.prepare skipped: channel P is not connected");
      await kill(true);
      phase = "stopped";
      failure = undefined;
      gateway = undefined;
      started_ms = undefined;
      changed();
    })().finally(() => { stopping = null; });
    return stopping;
  }

  return {
    dataDir, status,
    hostRecord: () => record,
    async callHost<T>(method: string, payload: unknown = {}): Promise<T> {
      if (!connection) throw Object.assign(new Error("The built-in host is not connected"), { code: "UNAVAILABLE" });
      return connection.call<T>(method, payload);
    },
    async tailnetStatus(): Promise<TailnetStatus> { return this.callHost<TailnetStatus>(TAILNET_METHODS.statusGet, {}); },
    async start(): Promise<void> {
      if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
      if (child || phase === "starting" || !enabled() || !shouldStartBundledHost(deps.settings.get<"tailscale" | "local">("connectionMode"))) { changed(); return; }
      policy.reset();
      await launch();
    },
    stop,
    async restart(): Promise<void> {
      if (restartTask) return restartTask;
      const task = (async () => {
        await stop();
        if (!shouldStartBundledHost(deps.settings.get<"tailscale" | "local">("connectionMode"))) return;
        policy.reset();
        await launch();
      })();
      let wrapped!: Promise<void>;
      wrapped = task.finally(() => { if (restartTask === wrapped) restartTask = null; });
      restartTask = wrapped;
      return wrapped;
    },
    /** Stops polling and the server; for app quit. */
    /** Stops the server whatever else fails; returns only when no server of this data directory is left. */
    async dispose(): Promise<void> {
      if (healthTimer) clearInterval(healthTimer);
      try { await stop(); } catch (error) { deps.diagnostics.line(`[supervisor] stop failed: ${error}`); }
      try { await endServerOfDataDir(false); } catch (error) { deps.diagnostics.line(`[supervisor] final sweep failed: ${error}`); }
    },
    watchHealth(): void { healthTimer ??= setInterval(() => void refreshHealth(), 10_000); },
    async setEnabled(on: boolean): Promise<void> {
      deps.settings.set("builtInHost", on);
      if (on) { if (shouldStartBundledHost(deps.settings.get<"tailscale" | "local">("connectionMode"))) { policy.reset(); await launch(); } else changed(); } else await stop();
    },
    /** `jagentchill doctor --fix` is the server's; from here the repair is asked of the running server. */
    async repair(): Promise<void> {
      if (!connection) throw Object.assign(new Error("The built-in host is not running"), { code: "UNAVAILABLE" });
      await connection.call("jagentchill.diagnostics.service.restart", { service: "gateway" });
    },
    /** The key was replaced: the channel is opened again with the new key and the new token. */
    async reconnect(): Promise<void> {
      connection?.close();
      connection = null;
      notADevice = false;
      if (child) await connect(generation, Date.now(), READY_DEADLINE_MS);
      changed();
    },
    /** "Restore this computer as admin": the host CLI recovery, run with the bundled Node against this app's own server. */
    async restoreAdmin(): Promise<void> {
      const check = deps.runtime();
      if (!check.ok || !ports || !child) throw Object.assign(new Error("The built-in host is not running"), { code: "UNAVAILABLE" });
      const info = deps.identity.publicInfo();
      await new Promise<void>((resolve, reject) => execFile(check.runtime.node, [check.runtime.serverEntry, "devices", "add-admin", "--public-key", info.devicePublicKey, "--local-supervisor", "--key-protection", info.keyProtection, "--data-dir", dataDir],
        { env: serverEnvironment(process.env, { renderHostPath: "", bootstrapPublicKey: "", keyProtection: info.keyProtection }), windowsHide: true, timeout: 20_000 },
        (error, _stdout, stderr) => (error ? reject(Object.assign(new Error(stderr.trim() || error.message), { code: "UNAVAILABLE" })) : resolve())));
      const identity = await hostIdentity(ports.serverPort);
      if (!identity) throw Object.assign(new Error("The built-in host did not answer"), { code: "UNAVAILABLE" });
      const deviceToken = await readBootstrapToken(info.deviceId);
      record = { gatewayId: identity.gatewayId, gatewayPublicKey: identity.gatewayPublicKey, gatewayName: "This computer", origin: `http://127.0.0.1:${ports.serverPort}`, role: "admin", deviceToken, verifiedClockOffset_ms: 0, builtIn: true };
      deps.identity.saveHost(record);
      deps.diagnostics.line("[supervisor] this computer was restored as admin of its own host");
      notADevice = false;
      await connect(generation, Date.now(), READY_DEADLINE_MS);
    },
    /** "Reset host configuration…": the Gateway state directory is moved aside by the stopped host's own data owner — the app only renames the folder. */
    async resetConfiguration(): Promise<string> {
      await stop();
      const from = join(dataDir, "gateway-state"), to = join(dataDir, `gateway-state.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`);
      if (existsSync(from)) renameSync(from, to);
      policy.reset();
      await launch();
      return to;
    },
    connection: () => connection,
  };
}
export type HostSupervisor = ReturnType<typeof createHostSupervisor>;
