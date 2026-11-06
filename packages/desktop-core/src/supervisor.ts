import type { Environment, OsPlatform } from "./os.ts";
/** What the desktop app shows of its built-in host. */
export const SUPERVISOR_STATES = ["stopped", "starting", "ready", "degraded", "restarting", "doctor", "failed", "stopping"] as const;
export type SupervisorState = (typeof SUPERVISOR_STATES)[number];
/** The fixed label of each state, used in the chip popover, the tray menu and Host ▸ Diagnostics only. */
export const STATE_LABELS: Record<SupervisorState, string> = {
  stopped: "Stopped", starting: "Starting…", ready: "Running", degraded: "Running with problems", restarting: "Restarting…",
  doctor: "Repairing configuration…", failed: "Failed", stopping: "Stopping…",
};

export type GatewayState = "starting" | "ready" | "restarting" | "config_invalid" | "crash_loop" | "stopped";
export type GatewayReport = { state: GatewayState; lastExitCode?: number | null };
/** What the server process and the app's connection to it are doing. */
export type ProcessPhase = "stopped" | "starting" | "connected" | "restarting" | "failed" | "stopping";

export type HostView = { state: SupervisorState; reasons: string[] };

/**
 * The state shown for the built-in host. The server process and channel P give the base state; the Gateway's state,
 * read from the server, and the health reasons can only lower `ready` to `degraded` or `doctor` — the app stays
 * connected and the editor, sync and media keep working while agents do not.
 */
export function hostView(input: {
  phase: ProcessPhase; failureReason?: string; gateway?: GatewayReport; healthReasons?: readonly string[];
  protocolCompatible?: boolean; notADevice?: boolean;
}): HostView {
  if (input.phase === "failed") return { state: "failed", reasons: input.failureReason ? [input.failureReason] : [] };
  if (input.phase !== "connected") {
    if (input.notADevice) return { state: "degraded", reasons: ["not_a_device"] };
    return { state: input.phase, reasons: [] };
  }
  const reasons: string[] = [];
  if (input.protocolCompatible === false) reasons.push("protocol_incompatible");
  const gateway = input.gateway;
  let doctor = false;
  if (gateway) {
    if (gateway.state === "starting" || gateway.state === "restarting" || gateway.state === "stopped") {
      // A Gateway that is coming back after exit code 78 is being repaired by the server.
      if (gateway.lastExitCode === 78 && gateway.state !== "stopped") doctor = true;
      else reasons.push("gateway_starting");
    } else if (gateway.state === "crash_loop") reasons.push("gateway_crash_loop");
    else if (gateway.state === "config_invalid") reasons.push("gateway_config_invalid");
  } else reasons.push("gateway_starting");
  for (const reason of input.healthReasons ?? []) if (!reasons.includes(reason)) reasons.push(reason);
  if (doctor && reasons.length === 0) return { state: "doctor", reasons: [] };
  return reasons.length ? { state: "degraded", reasons } : { state: "ready", reasons: [] };
}

export const REASON_TEXT: Record<string, string> = {
  key_storage_unavailable: "The device key cannot be stored on this computer",
  not_a_device: "This computer is not a device of its own host",
  gateway_starting: "Agents are starting",
  gateway_crash_loop: "Agents are unavailable on this computer",
  gateway_config_invalid: "Host configuration repair failed",
  server_config_invalid: "The host configuration file is not valid",
  protocol_incompatible: "The host and the app use incompatible protocol versions",
  ffmpeg_missing: "Host export and proxy generation are unavailable",
  render_host_unavailable: "The render host is unavailable",
  runtime_missing: "The installation is incomplete — reinstall JAgentChill",
  crash_loop: "The built-in host stopped",
  disabled: "The built-in host is turned off",
};
export const reasonText = (reason: string): string => REASON_TEXT[reason] ?? reason;

export const RESTART_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000] as const;
export const RESTART_WINDOW_MS = 5 * 60_000;
export const STABLE_AFTER_MS = 2 * 60_000;
export const READY_DEADLINE_MS = 60_000;
export const CHANNEL_LOSS_LIMIT_MS = 15_000;
export const BOOTSTRAP_WAIT_MS = 30_000;
export const STOP_GRACE_MS = 5000;
export const PREPARE_CONNECT_MS = 2000;

/** The pause before the next attempt to open channel P: every 250 ms for the first 5 s after spawn, then every second. */
export const connectRetryDelay = (sinceSpawnMs: number): number => (sinceSpawnMs < 5000 ? 250 : 1000);

export type RestartDecision = { action: "restart"; delayMs: number; attempt: number } | { action: "give-up" } | { action: "hold"; reason: "server_config_invalid" };

/**
 * The crash-restart policy of the server child: 1, 2, 4, 8 and 16 s; five failed restarts inside five minutes end it.
 * A server that stayed connected for two minutes starts from zero again. Exit code 78 is a configuration the server
 * refuses: it is never restarted automatically.
 */
export function createRestartPolicy(now: () => number = Date.now) {
  let failures: number[] = [];
  return {
    get failures() { return failures.length; },
    /** The server exited unexpectedly, lost its connection for too long, or never became ready. */
    failed(exitCode?: number | null): RestartDecision {
      if (exitCode === 78) return { action: "hold", reason: "server_config_invalid" };
      const at = now();
      failures = failures.filter((time) => at - time < RESTART_WINDOW_MS);
      if (failures.length >= RESTART_BACKOFF_MS.length) return { action: "give-up" };
      failures.push(at);
      return { action: "restart", delayMs: RESTART_BACKOFF_MS[failures.length - 1], attempt: failures.length };
    },
    /** Called when the connection has been up for `connectedForMs`. */
    stable(connectedForMs: number): void { if (connectedForMs >= STABLE_AFTER_MS) failures = []; },
    reset(): void { failures = []; },
  };
}

/** The key the server named when it refused its own configuration: the last `config key "<name>"` of its output. */
export function invalidConfigKey(lastLogLines: readonly string[]): string | null {
  for (let i = lastLogLines.length - 1; i >= 0; i--) {
    const match = /(?:unknown|invalid) (?:configuration |config )?key[: ]+"?([A-Za-z0-9_.-]+)"?/i.exec(lastLogLines[i]);
    if (match) return match[1];
  }
  return null;
}

export type KillStep = { command: string; args: string[] } | { signal: "SIGTERM" | "SIGKILL"; pid: number; group: boolean };
/**
 * How a process tree is ended. Windows gives no graceful signal to a windowless child, so the tree is ended at once;
 * elsewhere the process is asked first and killed after the grace period.
 */
export function killSteps(platform: OsPlatform, pid: number, opts: { group?: boolean; graceful?: boolean } = {}): KillStep[] {
  if (platform === "win32") return [{ command: "taskkill", args: ["/PID", String(pid), "/T", "/F"] }];
  const group = opts.group ?? false;
  return opts.graceful === false ? [{ signal: "SIGKILL", pid, group }] : [{ signal: "SIGTERM", pid, group }, { signal: "SIGKILL", pid, group }];
}

/** Whether a command line is the bundled Node running the given entry: the check before a recorded pid is killed. */
export function isOwnRuntime(commandLine: string, nodePath: string, entry: string): boolean {
  const normalise = (text: string) => text.replace(/\\/g, "/").toLowerCase();
  const line = normalise(commandLine);
  return line.includes(normalise(nodePath)) && line.includes(normalise(entry));
}

/** Whether a command line is a JAgentChill server on this data directory, whatever build or runtime started it. */
export function isServerOfDataDir(commandLine: string, dataDir: string): boolean {
  const normalise = (text: string) => text.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const line = normalise(commandLine.trim()), flag = `--data-dir ${normalise(dataDir)}`;
  // The data directory may hold spaces: it ends where the next option starts or the line ends.
  return line.includes("jagentchill-server.mjs") && line.includes(" serve ") && (line.endsWith(flag) || line.includes(`${flag} --`));
}

export type SupervisorRecord = { serverPid?: number; serverPort?: number; gatewayPort?: number };
export const parseSupervisorRecord = (text: string): SupervisorRecord => {
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    const pid = (key: string) => (Number.isInteger(value[key]) && (value[key] as number) > 1 ? (value[key] as number) : undefined);
    return { serverPid: pid("serverPid"), serverPort: pid("serverPort"), gatewayPort: pid("gatewayPort") };
  } catch {
    return {};
  }
};

/** The environment of the server child: the caller's, plus the product variables; never a variable that turns Electron into Node. */
export function serverEnvironment(base: Environment, vars: { /** The app's own pid: the server leaves when that process is gone. */ parentPid?: number; renderHostPath: string; /** The local image engine the app ships (macOS). */ sdEnginePath?: string | null; ffmpegPath?: string | null; ffprobePath?: string | null; bootstrapPublicKey: string; keyProtection: string }): Environment {
  const env: Environment = { ...base };
  for (const name of ["ELECTRON_RUN_AS_NODE", "ELECTRON_NO_ATTACH_CONSOLE", "NODE_OPTIONS", "JAGENTCHILL_PORT", "JAGENTCHILL_DATA_DIR", "JAGENTCHILL_FFMPEG", "JAGENTCHILL_FFPROBE", "JAGENTCHILL_SD_ENGINE"]) delete env[name];
  return {
    ...env,
    JAGENTCHILL_RENDER_HOST_PATH: vars.renderHostPath,
    JAGENTCHILL_BOOTSTRAP_DEVICE_PUBLIC_KEY: vars.bootstrapPublicKey,
    JAGENTCHILL_BOOTSTRAP_KEY_PROTECTION: vars.keyProtection,
    ...(vars.ffmpegPath ? { JAGENTCHILL_FFMPEG: vars.ffmpegPath } : {}),
    ...(vars.sdEnginePath ? { JAGENTCHILL_SD_ENGINE: vars.sdEnginePath } : {}),
    ...(vars.ffprobePath ? { JAGENTCHILL_FFPROBE: vars.ffprobePath } : {}),
    ...(vars.parentPid ? { JAGENTCHILL_PARENT_PID: String(vars.parentPid) } : {}),
  };
}
export const serverArguments = (entry: string, dataDir: string, port: number): string[] => [entry, "serve", "--data-dir", dataDir, "--port", String(port)];

const NODE_RANGE = /^v?(\d+)\.(\d+)\.(\d+)/;
/** The Node runtime of the host: `>=24.16.0 <25 || >=26.1.0`. */
export function nodeVersionSupported(version: string): boolean {
  const match = NODE_RANGE.exec(version.trim());
  if (!match) return false;
  const [major, minor] = [Number(match[1]), Number(match[2])];
  return (major === 24 && minor >= 16) || (major === 26 && minor >= 1) || major > 26;
}
