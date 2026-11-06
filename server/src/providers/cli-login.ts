import { spawn } from "node:child_process";
import type { LoginStep } from "@jagentchill/protocol";
import type { LoginResult } from "../runtimes/probe.ts";

/**
 * Sign-in of a vendor CLI installed on the host, started by the server and relayed to the admin device.
 *
 * What the CLIs do was observed on real runs with an empty configuration home (Claude Code 2.1.289, Codex 0.160.0):
 *
 *  - `claude auth login` needs no terminal. It prints "Opening browser to sign in…", then "If the browser didn't open,
 *    visit: <address>" and "Paste code here if prompted > ", and reads one line from standard input. The printed
 *    address returns to Anthropic's own page, which shows a code; the address it gives the host's browser returns to a
 *    loopback port instead. A malformed code prints "Invalid code. Please make sure the full code was copied." and the
 *    prompt stays; a refused code prints "Login failed: …" and the command exits 1. It honours `BROWSER`.
 *  - `codex login --device-auth` prints an address and a one-time code "(expires in 15 minutes)" and waits by itself.
 *  - `codex login` prints an address that returns to 127.0.0.1:1455 on the host and opens the host's browser.
 *
 * The server never sees a token: it passes the address and the code prompt on, writes the pasted code to the CLI's
 * standard input exactly as a person at the terminal would, and asks the CLI's own status command whether it worked.
 */
export type CliLoginFlow = "claude" | "codex-device" | "codex-browser";

export type LoginProcess = {
  onOutput(listener: (text: string) => void): void;
  write(text: string): void;
  kill(): void;
  exited: Promise<{ code: number | null }>;
};
export type SpawnLogin = (file: string, args: string[], opts: { env: Record<string, string> }) => LoginProcess;

/** The command with plain pipes, in its own process group so that cancelling removes whatever it started. */
export const spawnLoginProcess: SpawnLogin = (file, args, opts) => {
  const windows = process.platform === "win32";
  const child = spawn(file, args, { env: opts.env, stdio: ["pipe", "pipe", "pipe"], detached: !windows, shell: windows && /\.(cmd|bat|ps1)$/i.test(file), windowsHide: true });
  const listeners = new Set<(text: string) => void>();
  const emit = (chunk: Buffer) => listeners.forEach((listener) => listener(chunk.toString("utf8")));
  child.stdout.on("data", emit);
  child.stderr.on("data", emit);
  child.stdin.on("error", () => undefined);
  let over = false;
  const exited = new Promise<{ code: number | null }>((resolve) => {
    child.on("error", () => { over = true; resolve({ code: null }); });
    child.on("close", (code) => { over = true; resolve({ code }); });
  });
  const signal = (name: NodeJS.Signals) => {
    if (over || child.pid === undefined) return;
    try {
      if (windows) spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      else process.kill(-child.pid, name);
    } catch {
      // Already gone.
    }
  };
  return {
    onOutput: (listener) => void listeners.add(listener),
    write: (text) => void child.stdin.write(text),
    kill: () => {
      signal("SIGTERM");
      setTimeout(() => signal("SIGKILL"), 2000).unref();
    },
    exited,
  };
};

export function loginArguments(flow: CliLoginFlow, opts: { email?: string; sso?: boolean } = {}): string[] {
  if (flow === "codex-device") return ["login", "--device-auth"];
  if (flow === "codex-browser") return ["login"];
  return ["auth", "login", "--claudeai", ...(opts.email ? ["--email", opts.email] : []), ...(opts.sso ? ["--sso"] : [])];
}
export const logoutArguments = (runtimeId: string): string[] => (runtimeId === "codex" ? ["logout"] : ["auth", "logout"]);

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
export const plain = (text: string): string => text.replace(ANSI, "").replace(/\r/g, "");

export type LoginOutput = { url?: string; userCode?: string; expiresMinutes?: number; invalidCode: boolean; failure?: string };

/** What the CLI has said so far. `since` limits the search for a rejected code to what came after the last answer. */
export function readLoginOutput(flow: CliLoginFlow, output: string, since = 0): LoginOutput {
  const text = plain(output);
  const url = /https:\/\/[^\s"'<>]+/.exec(flow === "claude" ? text.slice(Math.max(0, text.indexOf("visit:"))) : text)?.[0];
  const recent = plain(output.slice(since));
  const failure = /^(?:Login failed|Error|error)[: ].*$/m.exec(recent)?.[0]?.trim();
  if (flow === "codex-device") {
    const userCode = /one-time code[^\n]*\n\s*([A-Z0-9]{3,6}-[A-Z0-9]{3,8})/i.exec(text)?.[1];
    const minutes = /expires in (\d+) minutes/i.exec(text)?.[1];
    return { ...(url ? { url } : {}), ...(userCode ? { userCode } : {}), ...(minutes ? { expiresMinutes: Number(minutes) } : {}), invalidCode: false, ...(failure ? { failure } : {}) };
  }
  return { ...(url ? { url } : {}), invalidCode: /Invalid code/i.test(recent), ...(failure ? { failure } : {}) };
}

export type SignInSession = {
  /** `login.next`: the device moved past the current step; `answer` is the pasted text of an `enter-text` step. */
  next(answer?: string): Promise<void>;
  cancel(): void;
};
export type SignInHost = {
  step(): LoginStep;
  /** Shows a new step to the owning device. */
  update(step: LoginStep): void;
  /** Ends the login with `done` or `error`. */
  finish(step: LoginStep): Promise<void>;
  secretName: string;
  now(): number;
  redact(text: string): string;
};

const URL_DEADLINE_MS = 30_000;
const PASTE_PROMPT = "Paste the code shown on the sign-in page";

export function startCliLogin(host: SignInHost, opts: {
  flow: CliLoginFlow; label: string; binary: string; args: string[]; env: Record<string, string>; spawn: SpawnLogin; profileId: string;
  /** The CLI's own status command, asked once the login command has ended. */
  status: () => Promise<LoginResult>;
}): SignInSession {
  const child = opts.spawn(opts.binary, opts.args, { env: opts.env });
  let output = "";
  let answeredAt = 0;
  let over = false;
  const claude = opts.flow === "claude";

  const read = () => {
    if (over) return;
    const seen = readLoginOutput(opts.flow, output, answeredAt);
    const step = host.step();
    if (step.kind === "progress" && answeredAt === 0 && seen.url) {
      if (opts.flow === "codex-device") {
        if (!seen.userCode) return;
        host.update({
          kind: "device-code", userCode: seen.userCode, verificationUrl: seen.url, expires_ms: host.now() + (seen.expiresMinutes ?? 15) * 60_000, intervalSec: 5,
          instructions: `Open the address, sign in to ChatGPT and enter this code. ${opts.label} on the host finishes the sign-in by itself. Enter the code only because you started this sign-in here.`,
        });
      } else if (claude) {
        host.update({ kind: "open-url", url: seen.url, returns: "paste-code", instructions: `Sign in on Anthropic's page. It then shows a code: copy it and paste it here. The sign-in is ${opts.label}'s own and stays on the host.` });
      } else {
        host.update({ kind: "open-url", url: seen.url, returns: "cli", instructions: "Sign in in a browser on the host computer: the page returns to the Codex CLI there (127.0.0.1:1455). From another device, use the sign-in with a one-time code." });
      }
      return;
    }
    // A code the CLI could not read leaves its prompt open: ask again.
    if (claude && answeredAt > 0 && seen.invalidCode && step.kind === "progress") {
      answeredAt = output.length;
      host.update({ kind: "enter-text", prompt: PASTE_PROMPT, masked: false, secretName: host.secretName, retryReason: "That was not a complete code. Copy the whole code from the sign-in page." });
    }
  };
  child.onOutput((text) => {
    output = (output + text).slice(-65_536);
    read();
  });
  const deadline = setTimeout(() => {
    if (over || host.step().kind !== "progress" || answeredAt > 0) return;
    over = true;
    child.kill();
    void host.finish({ kind: "error", code: "runtime/launch-failed", message: `${opts.label} did not print a sign-in address.` });
  }, URL_DEADLINE_MS);
  deadline.unref();

  void child.exited.then(async ({ code }) => {
    clearTimeout(deadline);
    if (over) return;
    over = true;
    const seen = readLoginOutput(opts.flow, output, answeredAt);
    if (code === 0) {
      const status = await opts.status().catch((): LoginResult => ({ state: "unknown" }));
      if (status.state === "signed_in") return await host.finish({ kind: "done", profileId: opts.profileId, ...(status.account ? { account: status.account } : {}) });
      return await host.finish({ kind: "error", code: "runtime/signed-out", message: `${opts.label} ended without a sign-in. Start again.` });
    }
    const reason = seen.failure ?? (code === null ? `${opts.label} could not be started.` : `${opts.label} ended the sign-in (exit ${code}).`);
    await host.finish({ kind: "error", code: code === null ? "runtime/launch-failed" : "runtime/auth-failed", message: host.redact(reason).slice(0, 300) });
  });

  return {
    async next(answer) {
      if (over) return;
      const step = host.step();
      if (step.kind === "open-url" && claude) return host.update({ kind: "enter-text", prompt: PASTE_PROMPT, masked: false, secretName: host.secretName });
      if (step.kind === "open-url") return host.update({ kind: "progress", message: "Waiting for the sign-in in the browser on the host…" });
      if (step.kind === "enter-text" && answer !== undefined) {
        answeredAt = output.length;
        host.update({ kind: "progress", message: "Finishing the sign-in…" });
        // One line, as typed at the CLI's own prompt.
        child.write(`${answer.replace(/[\r\n]+/g, "").trim()}\n`);
      }
    },
    cancel() {
      if (over) return;
      over = true;
      clearTimeout(deadline);
      child.kill();
    },
  };
}
