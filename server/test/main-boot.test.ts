// Boots the real entry point (src/main.ts) as a child process, with no agent CLI on its PATH and a HOME of its own (no
// CLI of the developer is looked at). What is under test is the server's own start-up and shutdown order.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, test } from "node:test";

// A port of the test range only: never the owner's running app.
const port = 18955;
const repoRoot = resolve(import.meta.dirname, "../..");
const runDirs: string[] = [];
const freshRunDir = () => {
  const base = process.env.JAGENTCHILL_TEST_RUN_ROOT
    ? resolve(repoRoot, process.env.JAGENTCHILL_TEST_RUN_ROOT)
    : join(repoRoot, ".dev/run-w7t-suite2");
  mkdirSync(base, { recursive: true });
  const root = mkdtempSync(join(base, "main-boot-"));
  runDirs.push(root);
  return root;
};
after(() => { for (const dir of runDirs.splice(0)) rmSync(dir, { recursive: true }); });

test("the server entry starts, answers its health route and stops on SIGTERM without an uncaught error", async () => {
  const booted = await bootServer();
  try {
    const health = await fetch(`http://127.0.0.1:${port}/jagentchill/v1/health`).then((response) => response.json() as Promise<{ ok?: boolean; agentsReady?: boolean }>, () => null);
    assert.equal(booted.child.exitCode, null, booted.output());
    assert.deepEqual([health?.ok, health?.agentsReady], [true, true], booted.output());
    assert.doesNotMatch(booted.output(), /ReferenceError|TypeError|uncaughtException|unhandledRejection/);
  } finally { booted.child.kill("SIGTERM"); }
  const ended = await orLate(booted.exited, 15_000);
  assert.notEqual(ended, "still running", booted.output());
  assert.equal((ended as { code: number | null }).code, 0, booted.output());
  assert.doesNotMatch(booted.output(), /ReferenceError|uncaughtException/);
});

/** The entry as a child process on a data directory and a HOME of its own, with no agent CLI on its PATH. */
async function bootServer(extraEnv: Record<string, string> = {}) {
  const root = freshRunDir();
  mkdirSync(join(root, "home"));
  const child = spawn(process.execPath, [join(import.meta.dirname, "..", "src", "main.ts"), "serve", "--data-dir", join(root, "data"), "--port", String(port)], {
    env: { ...process.env, PATH: "/usr/bin:/bin", HOME: join(root, "home"), JAGENTCHILL_PORT: String(port), ...extraEnv }, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const exited = new Promise<{ code: number | null; ms: number }>((done) => { const from = Date.now(); child.once("exit", (code) => done({ code, ms: Date.now() - from })); });
  for (let attempt = 0; attempt < 100 && child.exitCode === null; attempt++) {
    if (await fetch(`http://127.0.0.1:${port}/jagentchill/v1/health`).then(() => true, () => false)) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  return { child, exited, output: () => output, root };
}
const orLate = <T>(promise: Promise<T>, ms: number) => Promise.race([promise, new Promise<"still running">((done) => setTimeout(() => done("still running"), ms))]);

test("Orphan server: a server whose parent app is gone stops by itself", async () => {
  // The parent is a process this test ends: the server must notice within seconds and exit.
  const parent = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  const booted = await bootServer({ JAGENTCHILL_PARENT_PID: String(parent.pid) });
  try {
    assert.equal(booted.child.exitCode, null, booted.output());
    parent.kill("SIGKILL");
    const ended = await orLate(booted.exited, 15_000);
    assert.notEqual(ended, "still running", booted.output());
    assert.match(booted.output(), /the app that started this server is gone/);
  } finally { booted.child.kill("SIGKILL"); parent.kill("SIGKILL"); await booted.exited; }
});
