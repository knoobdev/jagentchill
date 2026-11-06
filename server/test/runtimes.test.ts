// The runtime clients in this file are FAKES of the runtime layer and no CLI is started (see harness.ts): these tests
// cover the server's own rules for runtime configuration, detection, snapshots and the model browser. Real CLIs run in
// scripts/live-runtimes.ts.
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { RUNTIME_METHOD_SCOPES } from "@jagentchill/protocol";
import { Limiter, interpretStatus, launchEnvironment, maskAccount, resolveBinary } from "../src/runtimes/probe.ts";
import { createHarness, model, tick, type Harness } from "./harness.ts";

let h: Harness;
let admin: Awaited<ReturnType<Harness["pair"]>>;
let editor: Awaited<ReturnType<Harness["pair"]>>;
let viewer: Awaited<ReturnType<Harness["pair"]>>;

before(async () => {
  h = await createHarness();
  admin = await h.pair("Admin", "admin");
  editor = await h.pair("Editor", "editor");
  viewer = await h.pair("Viewer", "viewer");
});
after(() => h.close());

const entry = (runtimes: any[], id: string) => runtimes.find((runtime) => runtime.runtimeId === id);

test("Fresh host: the default runtimes are enabled and the other native ACP runtimes are disabled", async () => {
  const { runtimes } = await admin.call("jagentchill.runtime.snapshot.get", {});
  const enabled = runtimes.filter((runtime: any) => runtime.enabled).map((runtime: any) => runtime.runtimeId).sort();
  assert.deepEqual(enabled, ["acp-opencode", "claude-code", "codex", "copilot", "gemini-cli"]);
  assert.deepEqual(runtimes.filter((runtime: any) => !runtime.enabled).map((runtime: any) => runtime.runtimeId).sort(), ["acp-copilot", "acp-kilocode", "acp-pi", "acp-qwen"]);
});

test("Cold read: the response comes at once with unprobed runtimes loading, and updates follow as they settle", async () => {
  const fresh = await createHarness();
  try {
    const device = await fresh.pair("Admin", "admin");
    await device.call("jagentchill.runtime.subscribe", {});
    const started = Date.now();
    const { runtimes } = await device.call("jagentchill.runtime.snapshot.get", { cwd: "/projects/one" });
    assert.ok(Date.now() - started < 200);
    assert.ok(runtimes.filter((runtime: any) => runtime.enabled).every((runtime: any) => runtime.status === "loading"));
    await fresh.settled();
    for (let i = 0; i < 50 && entry((await device.call("jagentchill.runtime.snapshot.get", { cwd: "/projects/one" })).runtimes, "claude-code").status === "loading"; i++) await tick();
    assert.ok(device.events.some((event) => event.event === "jagentchill.runtime.updated" && event.payload.scope === "/projects/one"));
  } finally {
    fresh.close();
  }
});

test("Refresh all publishes probes that were already in flight", async () => {
  const fresh = await createHarness();
  try {
    const device = await fresh.pair("Admin", "admin");
    let release!: () => void;
    const delayed = new Promise<void>((resolve) => { release = resolve; });
    fresh.results.set("claude --version", async () => {
      await delayed;
      return fresh.ok("2.3.1 (Claude Code)\n");
    });
    await device.call("jagentchill.runtime.snapshot.get", {});
    for (let attempt = 0; attempt < 50 && !fresh.commands.some((command) => command.file.endsWith("/claude")); attempt++) await tick();
    assert.ok(fresh.commands.some((command) => command.file.endsWith("/claude")), "cold snapshot started Claude's probe");
    const refreshing = device.call("jagentchill.runtime.snapshot.refresh", { all: true });
    release();
    const { runtimes } = await refreshing;
    assert.notEqual(entry(runtimes, "claude-code").status, "loading");
  } finally {
    fresh.close();
  }
});

test("Binary on PATH: the snapshot entry carries the resolved path, the source and the first line of the version output", async () => {
  const claude = entry(await h.settled(), "claude-code");
  assert.deepEqual(claude.binary, { path: join(h.binDir, "claude"), source: "default", version: "2.3.1 (Claude Code)" });
  assert.equal(claude.status, "ready");
  assert.deepEqual(claude.login.state, "signed_in");
  assert.equal(claude.login.account, "a***@example.com");
});

test("Binary missing: a CLI that is not on PATH is unavailable with runtime/not-installed", async () => {
  const copilot = entry(await h.settled(), "copilot");
  assert.equal(copilot.status, "unavailable");
  assert.equal(copilot.error.code, "runtime/not-installed");
  assert.ok(copilot.install.steps.length > 0);
});

test("Non-executable override and the Windows rules of binary resolution", () => {
  const dir = mkdtempSync(join(tmpdir(), "jagentchill-bin-"));
  try {
    writeFileSync(join(dir, "plain"), "");
    chmodSync(join(dir, "plain"), 0o644);
    writeFileSync(join(dir, "tool"), "");
    chmodSync(join(dir, "tool"), 0o755);
    const posix = { platform: "darwin" as const, env: { PATH: dir } };
    // Non-executable override: an existing file without the execute bit does not resolve.
    assert.equal(resolveBinary(join(dir, "plain"), "override", posix), undefined);
    assert.deepEqual(resolveBinary("tool", "default", posix), { path: join(dir, "tool"), source: "default" });
    assert.equal(resolveBinary("tool", "default", { platform: "darwin", env: { PATH: "/nonexistent" } }), undefined);
    assert.deepEqual(resolveBinary("tool", "default", { platform: "darwin", env: { PATH: "/nonexistent" } }, [dir]), { path: join(dir, "tool"), source: "default" });
    // Shim on a Windows host: a bare name resolves through PATHEXT to the package manager's .cmd shim.
    const npm = join(dir, "npm");
    mkdirSync(npm);
    writeFileSync(join(npm, "claude.cmd"), "");
    writeFileSync(join(npm, "agent.txt"), "");
    const windows = { platform: "win32" as const, env: { PATH: npm, PATHEXT: ".COM;.EXE;.CMD" } };
    assert.deepEqual(resolveBinary("claude", "default", windows), { path: join(npm, "claude.cmd"), source: "default" });
    // Windows file without an executable extension: an existing .txt override does not resolve.
    assert.equal(resolveBinary(join(npm, "agent.txt"), "override", windows), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Installed but signed out: the runtime is unavailable with runtime/signed-out and a sign-in hint", async () => {
  h.results.set("claude auth status", h.ok(JSON.stringify({ loggedIn: false })));
  const { runtimes } = await admin.call("jagentchill.runtime.snapshot.refresh", { runtimeIds: ["claude-code"] });
  const claude = entry(runtimes, "claude-code");
  assert.equal(claude.status, "unavailable");
  assert.equal(claude.error.code, "runtime/signed-out");
  assert.equal(claude.signInHint, "claude");
  // Report for a signed-out CLI: the diagnostic names the resolved path, the version, the status command and its exit.
  h.results.set("claude auth status", { code: 1, stdout: "", stderr: "not logged in", timedOut: false });
  const report = await admin.call("jagentchill.runtime.diagnose", { runtimeId: "claude-code" });
  const row = (label: string) => report.rows.find((candidate: any) => candidate.label === label);
  assert.match(row("Command").value, /claude → ~\/bin\/claude \(default\)/);
  assert.match(row("Version").value, /2\.3\.1/);
  assert.equal(row("Login").value, "signed out (claude auth status, exit 1)");
  assert.equal(row("Login").level, "error");
  assert.equal(row("Status").value, "unavailable");
  assert.ok(report.text.includes("Login: signed out"));
  h.results.set("claude auth status", h.ok(JSON.stringify({ loggedIn: true, email: "ada@example.com" })));
  await admin.call("jagentchill.runtime.snapshot.refresh", { runtimeIds: ["claude-code"] });
});

test("Non-admin: an editor cannot run the diagnostic", async () => {
  assert.equal((await editor.fail("jagentchill.runtime.diagnose", { runtimeId: "claude-code" })).code, "SCOPE_DENIED");
});

test("Status command times out: the sign-in is unknown and the runtime stays ready", async () => {
  h.results.set("claude auth status", { code: null, stdout: "", stderr: "", timedOut: true });
  const { runtimes } = await admin.call("jagentchill.runtime.snapshot.refresh", { runtimeIds: ["claude-code"] });
  const claude = entry(runtimes, "claude-code");
  // The runtime lists usable models itself, which settles what the status command could not.
  assert.equal(claude.status, "ready");
  assert.equal(interpretStatus("claude-code", { code: null, stdout: "", stderr: "", timedOut: true }, "claude auth status").state, "unknown");
  h.results.set("claude auth status", h.ok(JSON.stringify({ loggedIn: true, email: "ada@example.com" })));
  await admin.call("jagentchill.runtime.snapshot.refresh", { runtimeIds: ["claude-code"] });
});

test("Warm read does not spawn processes; Stale login runs only the binary and login steps; Retry from an error row refreshes one runtime", async () => {
  await h.settled();
  const before = h.commands.length;
  const listCalls = h.fake.callsOf("catalog").length;
  await editor.call("jagentchill.runtime.snapshot.get", {});
  await editor.call("jagentchill.runtime.models.list", {});
  assert.equal(h.commands.length, before);
  // A login check younger than ten minutes is not repeated.
  await editor.call("jagentchill.runtime.snapshot.refresh", { runtimeIds: ["claude-code"], loginOnly: true });
  assert.equal(h.commands.length, before);
  // Stale login: with the last check older than ten minutes, the status command runs and the catalogue is not fetched.
  const scope = (h.app.runtimes.snapshot().find((runtime) => runtime.runtimeId === "claude-code")!.login!.checked_ms -= 700_000);
  assert.ok(scope);
  await editor.call("jagentchill.runtime.snapshot.refresh", { runtimeIds: ["claude-code"], loginOnly: true });
  assert.deepEqual(h.commands.slice(before).map((command) => command.args.join(" ")), ["--version", "auth status"]);
  assert.equal(h.fake.callsOf("catalog").length, listCalls);
  // Retry from an error row: only the named runtime is probed.
  const mark = h.commands.length;
  await editor.call("jagentchill.runtime.snapshot.refresh", { runtimeIds: ["codex"] });
  assert.ok(h.commands.slice(mark).every((command) => command.file.endsWith("/codex")));
});

test("Error keeps the previous catalogue: a failed refresh leaves the last models marked stale", async () => {
  await h.settled();
  h.fake.on("catalog", () => { throw new Error("catalogue exploded"); });
  const { runtimes } = await admin.call("jagentchill.runtime.snapshot.refresh", { runtimeIds: ["claude-code"] });
  const claude = entry(runtimes, "claude-code");
  assert.equal(claude.status, "error");
  assert.equal(claude.error.step, "catalogue");
  assert.equal(claude.stale, true);
  assert.deepEqual(claude.models.map((m: any) => m.modelId), ["sonnet", "opus"]);
  h.fake.reset("catalog");
  assert.equal(entry((await admin.call("jagentchill.runtime.snapshot.refresh", { runtimeIds: ["claude-code"] })).runtimes, "claude-code").status, "ready");
});

test("Per-runtime capability: a model's facts under a runtime come from that runtime's own catalogue and capabilities", async () => {
  const fresh = await createHarness({ installed: ["claude", "codex", "opencode"], models: {
    "claude-code": [model("shared", { thinkingLevels: [{ id: "low", label: "low" }] }), model("twice"), model("twice")],
    codex: [model("shared", { thinkingLevels: [{ id: "low", label: "low" }, { id: "xhigh", label: "xhigh" }] })],
    "acp-opencode": [model("shared", { thinkingLevels: [{ id: "low", label: "low" }] })],
  } });
  try {
    fresh.results.set("opencode auth list", fresh.ok("2 credentials\n"));
    const runtimes = await fresh.settled();
    // Each runtime lists the model with what it says of it, under its own vendor.
    assert.deepEqual(entry(runtimes, "claude-code").models.find((m: any) => m.modelId === "shared").thinkingOptions.map((o: any) => o.id), ["low"]);
    assert.deepEqual(entry(runtimes, "codex").models.find((m: any) => m.modelId === "shared").thinkingOptions.map((o: any) => o.id), ["low", "xhigh"]);
    assert.deepEqual(entry(runtimes, "codex").models.find((m: any) => m.modelId === "shared").providerId, "openai");
    // A runtime without a thinking control offers none, whatever the model says.
    assert.deepEqual(entry(runtimes, "acp-opencode").models.find((m: any) => m.modelId === "shared").thinkingOptions, []);
    // Duplicate ids: the same model id is listed once.
    assert.equal(entry(runtimes, "claude-code").models.filter((m: any) => m.modelId === "twice").length, 1);
  } finally {
    fresh.close();
  }
});

test("Disable a runtime, Reorder, Stale revision and Pill for a disabled runtime", async () => {
  await h.settled();
  const { config } = await admin.call("jagentchill.runtime.config.get", {});
  const before = h.commands.length;
  const updated = await admin.call("jagentchill.runtime.config.update", { expectedRevision: config.revision, patch: { entries: { "gemini-cli": { enabled: false }, codex: { order: 5 } } } });
  assert.equal(updated.config.revision, config.revision + 1);
  const { runtimes } = await editor.call("jagentchill.runtime.snapshot.get", {});
  // Disable a runtime: it reports unavailable with enabled false whatever is installed, and nothing is started for it.
  assert.deepEqual([entry(runtimes, "gemini-cli").status, entry(runtimes, "gemini-cli").enabled], ["unavailable", false]);
  await h.settled();
  assert.ok(!h.commands.slice(before).some((command) => command.file.endsWith("/gemini")));
  const groups = (await editor.call("jagentchill.runtime.models.list", {})).groups.map((group: any) => group.runtimeId);
  assert.ok(!groups.includes("gemini-cli"));
  // Reorder: Codex is listed before Claude Code everywhere.
  assert.ok(groups.indexOf("codex") < groups.indexOf("claude-code"));
  // Stale revision: a second device with the old revision is refused and nothing changes.
  const stale = await admin.fail("jagentchill.runtime.config.update", { expectedRevision: config.revision, patch: { entries: { codex: { enabled: false } } } });
  assert.equal(stale.code, "CONFLICT");
  assert.equal(stale.details.currentRevision, config.revision + 1);
  assert.equal((await admin.call("jagentchill.runtime.config.get", {})).config.entries.codex.enabled, undefined);
  assert.ok(h.audit("runtime.config.update").length >= 1);
  await admin.call("jagentchill.runtime.config.update", { expectedRevision: config.revision + 1, patch: { entries: { "gemini-cli": { enabled: true }, codex: {} } } });
});

test("Secret in env, Deadline out of range, Unknown base, Command missing, Built-in rows take no environment", async () => {
  const revision = async () => (await admin.call("jagentchill.runtime.config.get", {})).config.revision;
  const update = async (patch: unknown, extra: object = {}) => admin.fail("jagentchill.runtime.config.update", { expectedRevision: await revision(), patch, ...extra });
  // Secret in env: a literal value that looks like a credential is refused.
  const secret = await update({ entries: { "claude-router": { extends: "claude-code", label: "Router", env: { ANTHROPIC_API_KEY: "sk-ant-0123456789abcdef0123456789abcdef" } } } });
  assert.deepEqual([secret.code, secret.message], ["INVALID_PARAMS", "Store this value as a secret and reference it"]);
  // Deadline out of range.
  const deadline = await update({ probeTimeout_ms: 5000 });
  assert.equal(deadline.code, "INVALID_PARAMS");
  assert.deepEqual([deadline.details.min, deadline.details.max], [10_000, 600_000]);
  // Unknown base.
  const base = await update({ entries: { mine: { extends: "claude", label: "Mine" } } });
  assert.deepEqual([base.code, base.details.path, base.message], ["INVALID_PARAMS", "entries.mine.extends", "Unknown runtime 'claude'"]);
  // Command missing.
  const command = await update({ entries: { "my-agent": { extends: "acp", label: "My agent" } } });
  assert.deepEqual([command.code, command.details.path], ["INVALID_PARAMS", "entries.my-agent.command"]);
  // Built-in Claude Code row has no environment field: the built-in runtime takes neither env nor command.
  assert.equal((await update({ entries: { "claude-code": { env: { FOO: "bar" } } } })).code, "INVALID_PARAMS");
  assert.equal((await update({}, { removeRuntimeIds: ["codex"] })).code, "INVALID_PARAMS");
  assert.equal((await editor.fail("jagentchill.runtime.config.update", { expectedRevision: 0, patch: {} })).code, "SCOPE_DENIED");
});

test("A profile keeps its base's driver and catalogue; a custom ACP command is probed by its own command; Twenty-first profile", async () => {
  let revision = (await admin.call("jagentchill.runtime.config.get", {})).config.revision;
  const put = async (patch: unknown) => (revision = (await admin.call("jagentchill.runtime.config.update", { expectedRevision: revision, patch })).config.revision);
  await put({ entries: {
    "claude-team": { extends: "claude-code", label: "Team Claude", models: [{ modelId: "sonnet" }, { modelId: "opus", label: "Big" }] },
    "claude-router": { extends: "claude-code", label: "Router", env: { ANTHROPIC_BASE_URL: "https://router.example", ANTHROPIC_AUTH_TOKEN: { secret: "ROUTER_TOKEN" } } },
    "my-agent": { extends: "acp", label: "My agent", command: ["my-agent", "--acp"] },
  } });
  const listed = h.app.runtimes.runtimes();
  // A label-only profile runs on its base's driver with the base's capability column.
  const team = listed.find((runtime) => runtime.id === "claude-team")!;
  assert.deepEqual([team.driver, team.base, team.capabilities.jcTools, team.capabilities.fork], ["claude", "claude-code", "bridge", true]);
  // A profile with a different endpoint is still Claude Code, started with its own environment.
  const router = listed.find((runtime) => runtime.id === "claude-router")!;
  assert.deepEqual([router.driver, router.base, router.capabilities.steer, router.capabilities.fork], ["claude", "claude-code", false, true]);
  const runtimes = await h.settled();
  // Replacement list: exactly the configured models are listed.
  assert.deepEqual(entry(runtimes, "claude-team").models.map((m: any) => [m.modelId, m.label, m.source]), [["sonnet", "sonnet", "configured"], ["opus", "Big", "configured"]]);
  // The router profile lists what the base runtime's client lists.
  assert.deepEqual([entry(runtimes, "claude-router").status, entry(runtimes, "claude-router").models.map((m: any) => m.modelId)], ["ready", ["sonnet", "opus"]]);
  // A custom ACP command that is not on the host is listed not installed, and nothing is started for it.
  assert.deepEqual([entry(runtimes, "my-agent").status, entry(runtimes, "my-agent").error.code], ["unavailable", "runtime/not-installed"]);
  assert.ok(!h.commands.some((command) => command.file.includes("my-agent")));
  assert.ok(!h.fake.callsOf("catalog").some((call) => call.runtimeId === "my-agent"));
  // The configuration document names the secret and holds no value.
  assert.deepEqual((await admin.call("jagentchill.runtime.config.get", {})).config.entries["claude-router"].env.ANTHROPIC_AUTH_TOKEN, { secret: "ROUTER_TOKEN" });
  // Twenty-first profile.
  const many = Object.fromEntries(Array.from({ length: 19 }, (_, i) => [`profile-${i}`, { extends: "codex", label: `Profile ${i}` }]));
  const full = await admin.fail("jagentchill.runtime.config.update", { expectedRevision: revision, patch: { entries: many } });
  assert.deepEqual([full.code, full.details, full.message], ["QUOTA_EXCEEDED", { limit: "customProfiles", max: 20 }, "You can have up to 20 custom profiles"]);
  await admin.call("jagentchill.runtime.config.update", { expectedRevision: revision, patch: {}, removeRuntimeIds: ["claude-team", "claude-router", "my-agent"] });
});

test("Relabel and set default; Custom id with spaces", async () => {
  let revision = (await admin.call("jagentchill.runtime.config.get", {})).config.revision;
  revision = (await admin.call("jagentchill.runtime.config.update", { expectedRevision: revision, patch: { entries: { "claude-code": { additionalModels: [{ modelId: "sonnet", label: "Team default", isDefault: true }, { modelId: "my-own", source: "custom" }] } } } })).config.revision;
  const models = entry(await h.settled(), "claude-code").models;
  assert.deepEqual(models.map((m: any) => [m.modelId, m.label, m.isDefault, m.source]), [["sonnet", "Team default", true, "discovered"], ["opus", "opus", false, "discovered"], ["my-own", "my-own", false, "custom"]]);
  const spaces = await admin.fail("jagentchill.runtime.config.update", { expectedRevision: revision, patch: { entries: { "claude-code": { additionalModels: [{ modelId: "gpt 5" }] } } } });
  assert.deepEqual([spaces.code, spaces.message], ["INVALID_PARAMS", "Model ID cannot contain spaces"]);
  await admin.call("jagentchill.runtime.config.update", { expectedRevision: revision, patch: { entries: { "claude-code": {} } } });
});

test("Unsupported product mode is explained; Default is never unattended; Flags are complete", async () => {
  const runtimes = await h.settled();
  const gemini = entry(runtimes, "gemini-cli");
  for (const id of ["ask", "plan"]) assert.deepEqual([gemini.modes.find((m: any) => m.id === id).supported, gemini.modes.find((m: any) => m.id === id).reason], [false, "This runtime edits files without asking"]);
  assert.equal(gemini.defaultModeId, "edit");
  const flags = ["jcTools", "jcToolsOnly", "nativeToolCoverage", "steer", "queueModes", "productModes", "liveModeChange", "thinking", "attachments", "resume", "fork", "importSessions", "usage", "approvals", "questions", "compaction", "subAgents", "pty", "skills", "proxy"];
  for (const runtime of runtimes) {
    assert.deepEqual(Object.keys(runtime.capabilities).sort(), [...flags].sort(), runtime.runtimeId);
    assert.equal(runtime.modes.find((m: any) => m.id === runtime.defaultModeId)!.isUnattended, false);
    assert.equal(runtime.modes.filter((m: any) => m.isUnattended).length, 1);
  }
  const matrix = await viewer.call("jagentchill.runtime.matrix.get", {});
  assert.equal(matrix.runtimes["claude-code"].flags.jcTools, "bridge");
  assert.equal(matrix.runtimes.builtin, undefined, "there is no built-in runtime");
});

test("Both access methods in one list; Cross-runtime search; Model narrows attachments; Viewer reads the list", async () => {
  await h.settled();
  const list = await admin.call("jagentchill.runtime.models.list", {});
  const group = (id: string) => list.groups.find((candidate: any) => candidate.runtimeId === id);
  // Both access methods in one list: each group lists what it serves with its own tool capability.
  assert.equal(group("claude-code").providers[0].providerId, "anthropic");
  assert.equal(group("claude-code").providers[0].models[0].capabilities.jcTools, "bridge");
  assert.deepEqual(group("claude-code").providers[0].models[0].ref, { runtimeId: "claude-code", providerId: "anthropic", modelId: "sonnet" });
  assert.deepEqual(group("codex").providers[0].models[0].ref, { runtimeId: "codex", providerId: "openai", modelId: "gpt-x" });
  // Model narrows attachments: a text-only model has no image attachment although the runtime allows them.
  assert.equal(group("codex").capabilities.attachments.image, true);
  assert.deepEqual([group("claude-code").providers[0].models[0].capabilities.attachments.image, group("codex").providers[0].models[0].capabilities.attachments.image], [true, false]);
  // Cross-runtime search: runtimes without a match are omitted.
  const search = await admin.call("jagentchill.runtime.models.list", { query: "SONNET" });
  assert.deepEqual(search.groups.map((candidate: any) => candidate.runtimeId), ["claude-code"]);
  assert.deepEqual(search.groups[0].providers[0].models.map((m: any) => m.modelId), ["sonnet"]);
  // Viewer reads the list, read-only; editors and admins select every runtime the host has on.
  assert.deepEqual((await viewer.call("jagentchill.runtime.models.list", {})).policy, { canSelect: false, reason: "Viewers cannot select a runtime" });
  assert.deepEqual([(await editor.call("jagentchill.runtime.models.list", {})).policy, list.policy], [{ canSelect: true }, { canSelect: true }]);
});

test("Server started inside an agent CLI; the server's own variables are not inherited; Secret reference names are removed", () => {
  const env = launchEnvironment({ PATH: "/bin", CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "cli", CODEX_SANDBOX_NETWORK: "x", JAGENTCHILL_PORT: "1", JAGENTCHILL_TOKEN: "t", OPENROUTER_API_KEY: "k", KEEP: "yes" }, { EXTRA: "1" }, ["OPENROUTER_API_KEY"]);
  assert.deepEqual(env, { PATH: "/bin", KEEP: "yes", EXTRA: "1" });
  // On a Windows host variable names are matched without regard to case.
  assert.deepEqual(launchEnvironment({ ClaudeCode: "1", Path: "C:\\" }, {}, [], "win32"), { Path: "C:\\" });
  assert.equal(maskAccount("ada.lovelace@example.com"), "a***@example.com");
});

test("Concurrent probes: at most four run at once and none is skipped", async () => {
  const limiter = new Limiter(4);
  let done = 0;
  await Promise.all(Array.from({ length: 12 }, () => limiter.run(async () => {
    await tick(5);
    done += 1;
  })));
  assert.deepEqual([limiter.peak, done], [4, 12]);
});

test("Catalogue lists the ACP runtimes that can be added; No match returns nothing", async () => {
  const all = (await viewer.call("jagentchill.runtime.catalogue.list", {})).entries;
  assert.deepEqual(all.map((item: any) => item.id).sort(), ["acp-copilot", "acp-kilocode", "acp-pi", "acp-qwen"]);
  assert.ok(all.every((item: any) => item.group === "gateway-target" && !item.added));
  assert.deepEqual((await viewer.call("jagentchill.runtime.catalogue.list", { query: "QWEN" })).entries.map((item: any) => item.id), ["acp-qwen"]);
  assert.deepEqual((await viewer.call("jagentchill.runtime.catalogue.list", { query: "zzz" })).entries, []);
});

test("Deleted spelling: jagentchill.runtime.refresh is not a method; every handler of this capability is in the protocol table with its scope", async () => {
  const error = await admin.fail("jagentchill.runtime.refresh", {});
  assert.deepEqual([error.code, error.details.reason], ["NOT_FOUND", "unknown_method"]);
  const prefixes = ["jagentchill.runtime.", "jagentchill.provider.auth.", "jagentchill.provider.endpoint.", "jagentchill.provider.preset.", "jagentchill.provider.override.", "jagentchill.session.control.", "jagentchill.session.runtime.", "jagentchill.session.handover.", "jagentchill.session.queue.", "jagentchill.session.unattended."];
  const handlers = [...h.app.methods.keys()].filter((name) => prefixes.some((prefix) => name.startsWith(prefix))).sort();
  assert.deepEqual(handlers, Object.keys(RUNTIME_METHOD_SCOPES).sort());
  for (const name of handlers) assert.equal(h.app.methods.get(name)!.scope, RUNTIME_METHOD_SCOPES[name], name);
  // Login can be advanced: exactly start, next, status, cancel and transfer.
  assert.deepEqual(handlers.filter((name) => name.startsWith("jagentchill.provider.auth.login.")).map((name) => name.split(".").pop()).sort(), ["cancel", "next", "start", "status", "transfer"]);
});
