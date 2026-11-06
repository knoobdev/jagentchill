// The runtime clients are FAKES of the runtime layer (harness.ts), and the vendor CLIs are SCRIPTED processes that print
// what the real ones were observed to print (Claude Code 2.1.289, Codex 0.160.0) — no request leaves this process. Real
// CLIs run in scripts/live-sign-in.ts.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { SpawnLogin } from "../src/providers/cli-login.ts";
import { readLoginOutput } from "../src/providers/cli-login.ts";
import { createHarness, tick, type Harness } from "./harness.ts";

type Proc = { file: string; args: string[]; env: Record<string, string>; written: string[]; killed: boolean; print(text: string): void; exit(code: number): void };
const procs: Proc[] = [];
/** What each scripted CLI prints right after it starts. */
const CLAUDE_OUT = "Opening browser to sign in…\nIf the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=CLAUDE-CODE-OWN&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&state=S1\nPaste code here if prompted > ";
const CODEX_DEVICE_OUT = "\nWelcome to Codex [v\u001b[90m0.160.0\u001b[0m]\n\nFollow these steps to sign in with ChatGPT using device code authorization:\n\n1. Open this link in your browser and sign in to your account\n   \u001b[94mhttps://auth.openai.com/codex/device\u001b[0m\n\n2. Enter this one-time code \u001b[90m(expires in 15 minutes)\u001b[0m\n   \u001b[94mGYOF-1WEHJ\u001b[0m\n\n";
const CODEX_BROWSER_OUT = "Starting local login server on http://localhost:1455.\nIf your browser did not open, navigate to this URL to authenticate:\n\nhttps://auth.openai.com/oauth/authorize?response_type=code&client_id=CODEX-OWN&redirect_uri=http%3A%2F%2F127.0.0.1%3A1455%2Fauth%2Fcallback\n\nOn a remote or headless machine? Use `codex login --device-auth` instead.\n";
const spawnLogin: SpawnLogin = (file, args, opts) => {
  let listener: (text: string) => void = () => undefined;
  let end!: (result: { code: number | null }) => void;
  const proc: Proc = { file, args, env: opts.env, written: [], killed: false, print: (text) => listener(text), exit: (code) => end({ code }) };
  procs.push(proc);
  const first = file.endsWith("claude") ? CLAUDE_OUT : args.includes("--device-auth") ? CODEX_DEVICE_OUT : CODEX_BROWSER_OUT;
  setTimeout(() => proc.print(first), 5);
  return { onOutput: (l) => void (listener = l), write: (text) => void proc.written.push(text), kill: () => { proc.killed = true; end({ code: null }); }, exited: new Promise((resolve) => (end = resolve)) };
};

let h: Harness;
let clock = 0;
let admin: Awaited<ReturnType<Harness["pair"]>>;
let editor: Awaited<ReturnType<Harness["pair"]>>;
const listed = async (id: string) => (await admin.call("jagentchill.provider.auth.list", { query: id })).providers.find((candidate: any) => candidate.providerId === id);
const start = (providerId: string, choiceId: string, extra: object = {}) => admin.call("jagentchill.provider.auth.login.start", { providerId, choiceId, ...extra });
const next = (loginId: string) => admin.call("jagentchill.provider.auth.login.next", { loginId });
const status = async (loginId: string) => (await admin.call("jagentchill.provider.auth.login.status", { loginId })).step;
const updates = (loginId: string, device = admin) => device.events.filter((event) => event.event === "jagentchill.provider.auth.login.updated" && event.payload.loginId === loginId).map((event) => event.payload.step.kind);
const everyFrame = () => [...admin.frames, ...editor.frames].join("\n");

before(async () => {
  h = await createHarness({ now: () => Date.now() + clock, spawnLogin });
  admin = await h.pair("Admin", "admin");
  editor = await h.pair("Editor", "editor");
  // The host starts signed out of both CLIs.
  h.results.set("claude auth status", { code: 1, stdout: JSON.stringify({ loggedIn: false, authMethod: "none" }), stderr: "", timedOut: false });
  h.results.set("codex login status", { code: 1, stdout: "", stderr: "Not logged in\n", timedOut: false });
  await h.settled();
});
after(() => h.close());

test("What the CLIs print is read as observed: Claude's address and rejected code, Codex's address with its one-time code", () => {
  assert.equal(readLoginOutput("claude", CLAUDE_OUT).url, "https://claude.com/cai/oauth/authorize?code=true&client_id=CLAUDE-CODE-OWN&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&state=S1");
  assert.equal(readLoginOutput("claude", `${CLAUDE_OUT}Invalid code. Please make sure the full code was copied.\n`, CLAUDE_OUT.length).invalidCode, true);
  assert.equal(readLoginOutput("claude", `${CLAUDE_OUT}Login failed: Request failed with status code 400\n`, CLAUDE_OUT.length).failure, "Login failed: Request failed with status code 400");
  assert.deepEqual(readLoginOutput("codex-device", CODEX_DEVICE_OUT), { url: "https://auth.openai.com/codex/device", userCode: "GYOF-1WEHJ", expiresMinutes: 15, invalidCode: false });
  assert.match(readLoginOutput("codex-browser", CODEX_BROWSER_OUT).url!, /^https:\/\/auth\.openai\.com\/oauth\/authorize\?/);
});

test("Sign-in choices are the vendor CLIs on the host, then an API key; the catalogue's own sign-ins of those providers name the CLI choice", async () => {
  const shape = (provider: any) => provider.choices.map((choice: any) => [choice.choiceId, choice.method, choice.kind, choice.appDriven === true, choice.identity ?? null, choice.available]);
  assert.deepEqual(shape(await listed("anthropic")), [["claude-code", "cli", "cli-login", true, "Claude Code", true], ["apiKey", "api-key", "api-key", false, null, true]]);
  assert.deepEqual(shape(await listed("openai")), [["codex-cli", "cli", "cli-login", true, "Codex CLI", true], ["codex-cli-browser", "cli", "cli-login", true, "Codex CLI", true], ["openai-api-key", "api-key", "api-key", false, null, true]]);
  assert.deepEqual(shape(await listed("openrouter")), [["openrouter-oauth", "oauth", "oauth", true, "JAgentChill", true], ["openrouter-api-key", "api-key", "api-key", false, null, true]], "OpenRouter: its sign-in yields a key the CLIs run on");
  assert.equal(await listed("chutes"), undefined, "a provider no CLI signs in to or runs on is not listed");
  for (const [providerId, choiceId, replacedBy] of [["openai", "openai", "codex-cli"], ["openai", "openai-device-code", "codex-cli"], ["openai", "openai-token-sharing", "codex-cli"], ["anthropic", "setup-token", "claude-code"]]) {
    const error = await admin.fail("jagentchill.provider.auth.login.start", { providerId, choiceId });
    assert.deepEqual([error.code, error.details.replacedBy], ["UNSUPPORTED_FEATURE", replacedBy], choiceId);
  }
  const claude = (await listed("anthropic")).choices[0];
  assert.deepEqual([claude.signedIn, claude.account], [false, undefined]);
  // No text of the list calls a sign-in blocked.
  assert.doesNotMatch(JSON.stringify([await listed("anthropic"), await listed("openai")]), /blocked|forbid/i);
  assert.equal((await editor.fail("jagentchill.provider.auth.login.start", { providerId: "anthropic", choiceId: "claude-code" })).code, "SCOPE_DENIED");
});

test("Claude Code sign-in: the address is relayed, the pasted code goes to the CLI's own prompt, a malformed code is asked for again, and the CLI's status ends it", async () => {
  const started = await start("anthropic", "claude-code", { email: "ada@example.com" });
  const cli = procs.at(-1)!;
  assert.deepEqual([cli.file.split("/").pop(), cli.args], ["claude", ["auth", "login", "--claudeai", "--email", "ada@example.com"]]);
  // The host's own browser is not opened: the address belongs to the device that asked.
  assert.match(cli.env.BROWSER, /\/true$/);
  assert.deepEqual([started.step.kind, started.step.returns, started.step.url], ["open-url", "paste-code", "https://claude.com/cai/oauth/authorize?code=true&client_id=CLAUDE-CODE-OWN&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&state=S1"]);
  // The same device gets its running login back; one login per provider.
  assert.equal((await start("anthropic", "claude-code")).loginId, started.loginId);
  const ask = (await next(started.loginId)).step;
  assert.deepEqual(ask, { kind: "enter-text", prompt: "Paste the code shown on the sign-in page", masked: false, secretName: `LOGIN_${started.loginId}` });
  assert.equal((await admin.fail("jagentchill.provider.auth.login.next", { loginId: started.loginId })).code, "INVALID_PARAMS");
  // A malformed code: the CLI keeps its prompt open and the device is asked again.
  await admin.putSecret(ask.secretName, "not-a-code");
  const pending = next(started.loginId);
  await tick(40);
  assert.deepEqual(cli.written, ["not-a-code\n"]);
  cli.print("Invalid code. Please make sure the full code was copied.\n");
  const again = (await pending).step;
  assert.deepEqual([again.kind, again.retryReason], ["enter-text", "That was not a complete code. Copy the whole code from the sign-in page."]);
  // The real code: the CLI finishes, and its own status command is what says "signed in".
  await admin.putSecret(ask.secretName, "REAL-CODE-77#S1");
  h.results.set("claude auth status", h.ok(JSON.stringify({ loggedIn: true, email: "ada@example.com", authMethod: "claude.ai" })));
  const finishing = next(started.loginId);
  await tick(40);
  assert.equal(cli.written.at(-1), "REAL-CODE-77#S1\n");
  cli.print("Login successful.\n");
  cli.exit(0);
  assert.deepEqual((await finishing).step, { kind: "done", profileId: "claude-code:cli", account: "a***@example.com" });
  assert.deepEqual(updates(started.loginId), ["open-url", "enter-text", "progress", "enter-text", "progress", "done"]);
  assert.deepEqual(updates(started.loginId, editor), []);
  // The pasted code travelled on the signed secret route only, and is gone.
  assert.ok(!everyFrame().includes("REAL-CODE-77") && !h.app.secrets.has(ask.secretName));
  const anthropic = await listed("anthropic");
  assert.deepEqual([anthropic.connected, anthropic.choices[0].signedIn, anthropic.choices[0].account], [true, true, "a***@example.com"]);
  assert.deepEqual(anthropic.profiles.map((profile: any) => [profile.profileId, profile.type, profile.account, profile.health]), [["claude-code:cli", "cli-login", "a***@example.com", "ok"]]);
  // A later CLI status probe is authoritative; a recent successful app login must not hide an expired account.
  h.results.set("claude auth status", { code: 1, stdout: JSON.stringify({ loggedIn: false }), stderr: "Not logged in\n", timedOut: false });
  await admin.call("jagentchill.runtime.snapshot.refresh", { runtimeIds: ["claude-code"] });
  const expired = await listed("anthropic");
  assert.deepEqual([expired.connected, expired.choices[0].signedIn, expired.profiles.length], [false, false, 0]);
  assert.equal(expired.choices[0].available, true, "the row can start sign-in again");
  assert.deepEqual(h.audit("provider.auth.connect").at(-1), { actor: `device:${admin.device.deviceId}`, providerId: "anthropic", profileId: "claude-code:cli", outcome: "signed_in" } as never);
  // The server stored no secret of its own for the sign-in: the credential stays in the CLI.
  assert.deepEqual(h.app.secrets.list(), []);
});

test("Claude Code sign-in refused by Anthropic, cancelled, or without the CLI: each ends with its reason and no process is left", async () => {
  const refused = await start("anthropic", "claude-code");
  const cli = procs.at(-1)!;
  const ask = (await next(refused.loginId)).step;
  await admin.putSecret(ask.secretName, "WRONG-CODE#S1");
  const pending = next(refused.loginId);
  await tick(40);
  cli.print("Login failed: Request failed with status code 400\n");
  cli.exit(1);
  assert.deepEqual((await pending).step, { kind: "error", code: "runtime/auth-failed", message: "Login failed: Request failed with status code 400" });
  // Cancel: the CLI process is removed.
  const second = await start("anthropic", "claude-code");
  const cancelled = await admin.call("jagentchill.provider.auth.login.cancel", { loginId: second.loginId });
  assert.deepEqual([cancelled.step.code, procs.at(-1)!.killed], ["CANCELLED", true]);
  // A CLI that ends without a sign-in (exit 0, status still signed out).
  h.results.set("claude auth status", { code: 1, stdout: JSON.stringify({ loggedIn: false }), stderr: "", timedOut: false });
  const third = await start("anthropic", "claude-code");
  procs.at(-1)!.exit(0);
  await tick(60);
  assert.deepEqual([(await status(third.loginId)).kind, (await status(third.loginId)).code], ["error", "runtime/signed-out"]);
});

test("Codex CLI sign-in: the one-time code and address are relayed and the CLI finishes by itself; the browser variant says it returns to the host", async () => {
  const started = await start("openai", "codex-cli");
  const cli = procs.at(-1)!;
  assert.deepEqual([cli.file.split("/").pop(), cli.args], ["codex", ["login", "--device-auth"]]);
  assert.match(cli.env.BROWSER, /\/true$/);
  assert.deepEqual([started.step.kind, started.step.userCode, started.step.verificationUrl, started.step.intervalSec], ["device-code", "GYOF-1WEHJ", "https://auth.openai.com/codex/device", 5]);
  assert.ok(started.step.expires_ms > Date.now() + 14 * 60_000);
  // Asking again while the CLI waits answers with the same step after a pause, not at once.
  const asked = Date.now();
  assert.equal((await next(started.loginId)).step.kind, "device-code");
  assert.ok(Date.now() - asked >= 250);
  h.results.set("codex login status", h.ok("Logged in using ChatGPT\n"));
  const waiting = next(started.loginId);
  cli.exit(0);
  assert.deepEqual((await waiting).step, { kind: "done", profileId: "codex:cli", account: "ChatGPT" });
  assert.deepEqual((await listed("openai")).profiles.map((profile: any) => [profile.profileId, profile.type]), [["codex:cli", "cli-login"]]);
  assert.deepEqual(cli.written, []);
  // The browser variant.
  const browser = await start("openai", "codex-cli-browser");
  assert.deepEqual([procs.at(-1)!.args, browser.step.kind, browser.step.returns], [["login"], "open-url", "cli"]);
  // Only this variant, chosen for a browser on the host, may open one there.
  assert.equal(procs.at(-1)!.env.BROWSER, undefined);
  assert.match(browser.step.instructions, /browser on the host computer/);
  assert.equal((await next(browser.loginId)).step.kind, "progress");
  await admin.call("jagentchill.provider.auth.login.cancel", { loginId: browser.loginId });
});

test("Signing a CLI out runs the CLI's own command, only when its profile is named; a host without the CLI offers the install steps", async () => {
  await admin.call("jagentchill.provider.auth.logout", { providerId: "openai" });
  assert.ok(!h.commands.some((command) => command.args.join(" ") === "logout"));
  h.results.set("codex logout", h.ok("Successfully logged out\n"));
  h.results.set("codex login status", { code: 1, stdout: "", stderr: "Not logged in\n", timedOut: false });
  const removed = await admin.call("jagentchill.provider.auth.logout", { providerId: "openai", profileIds: ["codex:cli"] });
  assert.deepEqual(removed.removedProfileIds, ["codex:cli"]);
  assert.deepEqual(h.commands.at(-1)!.args.join(" ") === "logout" || h.commands.some((command) => command.file.endsWith("codex") && command.args.join(" ") === "logout"), true);
  assert.deepEqual((await listed("openai")).profiles, []);
  const bare = await createHarness({ installed: [], spawnLogin });
  try {
    const device = await bare.pair("Admin", "admin");
    const claude = (await device.call("jagentchill.provider.auth.list", { query: "anthropic" })).providers[0].choices[0];
    assert.deepEqual([claude.available, claude.unavailableReason, claude.setup.reason], [false, "Install Claude Code on the host first", "needs-install"]);
    assert.match(claude.setup.steps[0], /npm install -g @anthropic-ai\/claude-code/);
    assert.equal((await device.fail("jagentchill.provider.auth.login.start", { providerId: "anthropic", choiceId: "claude-code" })).code, "runtime/not-installed");
  } finally {
    bare.close();
  }
});

test("Testing a CLI sign-in asks the CLI's own status command; a turn that failed on the sign-in marks the profile until the CLI is checked again", async () => {
  // A device may make thirty changes a minute; this group of checks uses its own admin device.
  admin = await h.pair("Admin two", "admin");
  h.results.set("claude auth status", h.ok(JSON.stringify({ loggedIn: true, email: "ada@example.com", authMethod: "claude.ai" })));
  await admin.call("jagentchill.runtime.snapshot.refresh", { runtimeIds: ["claude-code"] });
  const health = async () => (await listed("anthropic")).profiles.map((profile: any) => [profile.profileId, profile.health]);
  assert.deepEqual(await health(), [["claude-code:cli", "ok"]]);
  // A turn on Claude Code failed on its sign-in (by runtime id, as the relay reports it).
  clock += 5;
  h.app.providerAuth.noteAuthFailure("claude-code");
  assert.deepEqual([await health(), (await listed("anthropic")).connected], [[["claude-code:cli", "auth_failed"]], false]);
  // The test runs the status command; the CLI still says signed in, so the mark is gone.
  const before = h.commands.length;
  const tested = await admin.call("jagentchill.provider.auth.test", { providerId: "anthropic", profileId: "claude-code:cli" });
  assert.deepEqual([tested.profileId, tested.result, tested.health], ["claude-code:cli", "ok", "ok"]);
  assert.deepEqual(h.commands.slice(before).map((command) => command.args.join(" ")), ["auth status"]);
  assert.deepEqual(await health(), [["claude-code:cli", "ok"]]);
  assert.deepEqual(h.audit("provider.auth.test").at(-1), { actor: `device:${admin.device.deviceId}`, providerId: "anthropic", profileId: "claude-code:cli", outcome: "ok" } as never);
  // A provider id marks its CLIs too; a newer probe that still finds the CLI signed in clears it.
  clock += 5;
  h.app.providerAuth.noteAuthFailure("anthropic");
  assert.deepEqual(await health(), [["claude-code:cli", "auth_failed"]]);
  clock += 5;
  await admin.call("jagentchill.runtime.snapshot.refresh", { runtimeIds: ["claude-code"] });
  assert.deepEqual(await health(), [["claude-code:cli", "ok"]]);
  // The CLI signed out meanwhile: the test says so and the profile is gone.
  h.results.set("claude auth status", { code: 1, stdout: JSON.stringify({ loggedIn: false }), stderr: "", timedOut: false });
  assert.deepEqual((await admin.call("jagentchill.provider.auth.test", { providerId: "anthropic", profileId: "claude-code:cli" })).health, "auth_failed");
  assert.deepEqual(await health(), []);
  // Only a CLI's profile can be tested.
  assert.equal((await admin.fail("jagentchill.provider.auth.test", { providerId: "anthropic", profileId: "anthropic:manual" })).code, "NOT_FOUND");
});
