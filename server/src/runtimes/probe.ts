import { spawn } from "node:child_process";
import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

export type ProbeStep = "resolve-binary" | "version" | "login-check" | "catalogue" | "acp-initialize" | "acp-session-new";
export const STEP_LABEL: Record<ProbeStep, string> = {
  "resolve-binary": "finding the command", version: "reading the version", "login-check": "checking the sign-in", catalogue: "reading the model list",
  "acp-initialize": "starting the agent", "acp-session-new": "opening a test session",
};

export type HostPlatform = { platform: NodeJS.Platform; env: Record<string, string | undefined> };
export type ResolvedBinary = { path: string; source: "override" | "default" };
export type CommandResult = { code: number | null; stdout: string; stderr: string; timedOut: boolean };

const DENY_PATTERNS = [/^JAGENTCHILL_/, /^CLAUDECODE$/, /^CLAUDE_CODE_ENTRYPOINT$/, /^CLAUDE_CODE_SSE_PORT$/, /^CODEX_SANDBOX/];

/**
 * The environment of a process the server starts itself: the server's environment without the host's own secrets and
 * without the markers of a parent agent session, so a server started from inside an agent CLI can still launch that CLI.
 */
export function launchEnvironment(base: Record<string, string | undefined>, overlay: Record<string, string> = {}, secretNames: string[] = [], platform: NodeJS.Platform = process.platform): Record<string, string> {
  const fold = (name: string) => (platform === "win32" ? name.toUpperCase() : name);
  const denied = new Set(secretNames.map(fold));
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(base)) {
    if (value === undefined) continue;
    const key = fold(name);
    if (denied.has(key) || DENY_PATTERNS.some((pattern) => pattern.test(key))) continue;
    out[name] = value;
  }
  return { ...out, ...overlay };
}

function isExecutable(file: string, host: HostPlatform): boolean {
  try {
    const real = realpathSync(file);
    if (!statSync(real).isFile()) return false;
    if (host.platform === "win32") {
      const extensions = (host.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").map((ext) => ext.toLowerCase());
      return extensions.some((ext) => real.toLowerCase().endsWith(ext));
    }
    accessSync(real, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Directories searched for a bare command name, in order. */
export function searchPath(host: HostPlatform, extraPath: string[]): string[] {
  const path = host.env.PATH ?? host.env.Path ?? "";
  return [...path.split(host.platform === "win32" ? ";" : delimiter).filter(Boolean), ...extraPath];
}

/** Finds the launch command the way the host's operating system does; undefined means `runtime/not-installed`. */
export function resolveBinary(command: string, source: ResolvedBinary["source"], host: HostPlatform, extraPath: string[] = []): ResolvedBinary | undefined {
  if (isAbsolute(command) || /^[A-Za-z]:[\\/]/.test(command)) return isExecutable(command, host) ? { path: command, source } : undefined;
  const names = host.platform === "win32" && !/\.[^\\/.]+$/.test(command)
    ? (host.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").map((ext) => command + ext.toLowerCase())
    : [command];
  for (const dir of searchPath(host, extraPath)) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (isExecutable(candidate, host)) return { path: candidate, source };
    }
  }
  return undefined;
}

/**
 * Runs one command with a deadline and no stdin, in its own process group, and removes the whole group when the
 * deadline passes or the caller aborts: SIGTERM, then SIGKILL after two seconds (taskkill /T on Windows).
 */
export function runCommand(file: string, args: string[], opts: { env: Record<string, string>; timeoutMs: number; signal?: AbortSignal; cwd?: string }): Promise<CommandResult> {
  return new Promise((resolve) => {
    const windows = process.platform === "win32";
    const viaShell = windows && /\.(cmd|bat|ps1)$/i.test(file);
    const child = spawn(file, args, { env: opts.env, cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"], detached: !windows, shell: viaShell, windowsHide: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const cap = (text: string, chunk: Buffer) => (text.length < 65_536 ? text + chunk.toString("utf8") : text);
    child.stdout.on("data", (chunk: Buffer) => (stdout = cap(stdout, chunk)));
    child.stderr.on("data", (chunk: Buffer) => (stderr = cap(stderr, chunk)));
    const killTree = (force: boolean) => {
      if (child.pid === undefined) return;
      try {
        if (windows) spawn("taskkill", ["/PID", String(child.pid), "/T", ...(force ? ["/F"] : [])], { stdio: "ignore" });
        else process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM");
      } catch {
        // The group is already gone.
      }
    };
    const stop = () => {
      if (settled) return;
      timedOut = true;
      killTree(false);
      setTimeout(() => killTree(true), 2000).unref();
    };
    const timer = setTimeout(stop, opts.timeoutMs);
    opts.signal?.addEventListener("abort", stop, { once: true });
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", stop);
      resolve({ code, stdout, stderr, timedOut });
    };
    child.on("error", () => finish(null));
    child.on("close", (code) => finish(code));
  });
}

/** `a***@example.com` for an address, the text itself for a plain display name, never a token. */
export function maskAccount(account: string): string {
  const match = /^([^@\s])[^@\s]*@([^@\s]+)$/.exec(account.trim());
  return match ? `${match[1]}***@${match[2]}` : account.trim().slice(0, 60);
}

export type LoginResult = { state: "signed_in" | "signed_out" | "unknown"; account?: string; command?: string; exitCode?: number | null };

/** Reads a CLI's own status command. No credential file and no keychain item is opened by the server. */
export function interpretStatus(runtimeTarget: string, result: CommandResult, command: string): LoginResult {
  if (result.timedOut || result.code === null) return { state: "unknown", command, exitCode: result.code };
  const text = `${result.stdout}\n${result.stderr}`;
  if (result.code !== 0) return { state: "signed_out", command, exitCode: result.code };
  if (runtimeTarget === "claude-code") {
    try {
      const status = JSON.parse(result.stdout) as { loggedIn?: boolean; email?: string; authMethod?: string };
      if (status.loggedIn === false) return { state: "signed_out", command, exitCode: 0 };
      return { state: "signed_in", account: maskAccount(status.email ?? status.authMethod ?? "Signed in"), command, exitCode: 0 };
    } catch {
      return /not logged in|no account/i.test(text) ? { state: "signed_out", command, exitCode: 0 } : { state: "unknown", command, exitCode: 0 };
    }
  }
  if (/not logged in|logged out|no credentials|0 credentials/i.test(text)) return { state: "signed_out", command, exitCode: 0 };
  if (runtimeTarget === "codex") {
    const via = /logged in using (.+)/i.exec(text)?.[1]?.trim();
    return { state: "signed_in", ...(via ? { account: maskAccount(via) } : {}), command, exitCode: 0 };
  }
  if (runtimeTarget === "acp-opencode") {
    const count = /(\d+) credentials?/i.exec(text.replace(/\x1b\[[0-9;]*m/g, ""))?.[1];
    return count && Number(count) > 0 ? { state: "signed_in", account: `${count} accounts`, command, exitCode: 0 } : { state: "signed_out", command, exitCode: 0 };
  }
  return { state: "signed_in", command, exitCode: 0 };
}

/** At most `limit` tasks run at once; the others wait in order. */
export class Limiter {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly limit: number;
  peak = 0;

  constructor(limit: number) {
    this.limit = limit;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active += 1;
    this.peak = Math.max(this.peak, this.active);
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}
