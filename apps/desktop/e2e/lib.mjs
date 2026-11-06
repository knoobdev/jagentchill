// Shared by the desktop checks: launching the real app with Playwright's Electron support, and looking at real processes.
import { execFileSync } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright";

export const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const repoRoot = resolve(desktopRoot, "../..");
export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** A fresh data directory per run, under `.dev/`; never reused and never deleted. */
export function freshRun(name) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const dir = join(repoRoot, ".dev", `run-desktop-${name}-${stamp}-${process.pid}`);
  mkdirSync(join(dir, "user-data"), { recursive: true });
  return { dir, userData: join(dir, "user-data"), library: join(dir, "library"), shots: join(dir, "shots") };
}

/** Every process whose command line mentions this run's directory: the app, its server, the Gateway and their children. */
export function processesOf(run) {
  const out = execFileSync("ps", ["-axo", "pid=,ppid=,pgid=,command="], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out.split("\n").map((line) => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line)).filter(Boolean)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), command: m[4] }))
    .filter((p) => p.command.includes(run.dir) && !p.command.includes("e2e/") && !/^(\/bin\/)?(ps|sh|zsh|bash) /.test(p.command));
}
export const describe = (list) => list.map((p) => `  pid ${p.pid} ppid ${p.ppid} pgid ${p.pgid}  ${p.command.replace(repoRoot, "<repo>").slice(0, 200)}`).join("\n") || "  (none)";
export async function waitFor(check, { timeout = 60_000, every = 250, what = "condition" } = {}) {
  const limit = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > limit) throw new Error(`timed out waiting for ${what}`);
    await sleep(every);
  }
}

/**
 * Starts the app. `packaged` names the executable of a local build; without it the development entry runs
 * (`electron .`). The web bundle, the server, the Gateway and the key store are the real ones.
 */
export async function launch(run, { packaged, args = [], env = {} } = {}) {
  const common = {
    // Unattended: the windows exist and are driven, but are never shown and never take the focus of the person at this computer.
    env: { ...process.env, JAGENTCHILL_USER_DATA: run.userData, JAGENTCHILL_LIBRARY_DIR: run.library, JAGENTCHILL_UNATTENDED: "1", ...env },
    timeout: 150_000,
  };
  delete common.env.ELECTRON_RUN_AS_NODE;
  const app = packaged
    ? await _electron.launch({ ...common, env: { ...common.env, JAGENTCHILL_HOLD_START: "1" }, executablePath: packaged, args })
    : await _electron.launch({ ...common, cwd: desktopRoot, args: [".", ...args] });
  // What the app writes to its own stderr and stdout is kept beside the run's data.
  launching.push(app);
  // Playwright cannot hold a packaged app's start the way it holds `electron .`: the app waits for this signal before
  // it opens its first window, so that the window is created with Playwright already attached.
  if (packaged) process.kill(app.process().pid, "SIGUSR2");
  const out = createWriteStream(join(run.dir, "electron-output.log"), { flags: "a" });
  app.process().stderr.on("data", (chunk) => out.write(chunk));
  app.process().stdout.on("data", (chunk) => out.write(chunk));
  // The first start of a freshly copied bundle is slow while macOS checks it: the window is waited for accordingly.
  const page = await app.firstWindow({ timeout: 150_000 });
  const logs = [];
  page.on("console", (message) => logs.push(`[${message.type()}] ${message.text()}`));
  page.on("pageerror", (error) => logs.push(`[pageerror] ${error.message}`));
  const session = { app, page, logs, pid: app.process().pid };
  launched.push(session);
  return session;
}
/** Quits the way a user does (the app's own quit sequence), then waits for the process to end. */
export async function quit(session) {
  const closed = new Promise((done) => session.app.process().once("exit", done));
  await session.app.evaluate(({ app }) => { app.quit(); }).catch(() => undefined);
  await Promise.race([closed, sleep(40_000)]);
}
const launched = [];
const launching = [];
let failing = false;
/**
 * A check that throws must not leave an app, a server or a Gateway behind: every app this process launched is ended.
 * The app's own quit runs first (it stops the host); a process that does not answer is killed, and so is the server
 * it started, by pid.
 */
for (const event of ["uncaughtException", "unhandledRejection"]) {
  process.on(event, (error) => {
    if (failing) return;
    failing = true;
    console.error(error);
    void (async () => {
      for (const app of launching) {
        const child = app.process();
        if (child.exitCode !== null) continue;
        const children = execFileSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8" }).split("\n").map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)).filter((m) => m && Number(m[2]) === child.pid && / serve --data-dir /.test(m[3])).map((m) => Number(m[1]));
        const gone = new Promise((done) => child.once("exit", done));
        await Promise.race([app.evaluate(({ app: a }) => { globalThis.__answer = 1; a.quit(); }).catch(() => undefined), sleep(3000)]);
        if ((await Promise.race([gone.then(() => "gone"), sleep(25_000)])) !== "gone") { try { child.kill("SIGKILL"); } catch { /* gone */ } }
        // A server whose app had to be killed stops its own Gateway when it is asked to end.
        for (const pid of children) { try { process.kill(pid, "SIGTERM"); } catch { /* gone */ } }
      }
      process.exit(1);
    })();
  });
}
export const bridge = (page, body, arg) => page.evaluate(body, arg);
export function check(results, name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "✔" : "✖"} ${name}${detail ? ` — ${detail}` : ""}`);
}
