// The agent runtimes in this file are FAKES of the runtime layer and no CLI is started (see harness.ts): these tests
// cover what the server decides before and around the runtime calls — policy, modes, queueing, the runtime switch and
// its hand-over, fork, rewind, delete, titles and usage.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { buildHandover } from "../src/agents/handover.ts";
import { classifyTurnError } from "../src/runtimes/errors.ts";
import { SAMPLE_MODELS, createHarness, model, tick, type Harness } from "./harness.ts";

let h: Harness;
let admin: Awaited<ReturnType<Harness["pair"]>>;
let editor: Awaited<ReturnType<Harness["pair"]>>;

const CLAUDE = { runtimeId: "claude-code", providerId: "anthropic", modelId: "sonnet" };
const CLAUDE_OPUS = { runtimeId: "claude-code", providerId: "anthropic", modelId: "opus" };
const CODEX = { runtimeId: "codex", providerId: "openai", modelId: "gpt-x" };
const GEMINI = { runtimeId: "gemini-cli", providerId: "google", modelId: "gem-1" };
const OPENCODE = { runtimeId: "acp-opencode", providerId: "opencode", modelId: "oc/one" };
// A custom ACP command an admin adds: nothing says it asks before it acts, so it runs only "without asking". (OpenCode
// asks over ACP and runs in Edit/Auto since the agent CLIs are driven directly.)
const CUSTOM_ACP = { runtimeId: "my-agent", providerId: "acp", modelId: "ma/one" };

before(async () => {
  h = await createHarness({
    installed: ["claude", "codex", "gemini", "opencode", "my-agent"],
    models: { ...SAMPLE_MODELS, "gemini-cli": [model("gem-1")], "acp-opencode": [model("oc/one")], "my-agent": [model("ma/one")] },
  });
  h.results.set("gemini --version", h.ok("0.1.0\n"));
  h.results.set("opencode --version", h.ok("1.0.0\n"));
  h.results.set("opencode auth list", h.ok("2 credentials\n"));
  h.results.set("my-agent --version", h.ok("1.0.0\n"));
  admin = await h.pair("Admin", "admin");
  editor = await h.pair("Editor", "editor");
  await admin.call("jagentchill.runtime.config.update", { expectedRevision: 0, patch: { entries: { "my-agent": { extends: "acp", label: "My agent", command: ["my-agent", "--acp"] } } } });
  await h.settled();
});
after(() => h.close());

const create = async (device: typeof admin, params: object) => (await device.call("jagentchill.session.create", params)).session;
/** The runtime session the last turn opened (or resumed). */
const lastOpen = () => [...h.fake.calls].reverse().find((call) => call.method === "createSession" || call.method === "resumeSession")!.params;
/** Sends a message and returns the run id. */
const send = async (device: typeof admin, sessionKey: string, message = "go") => (await device.call("jagentchill.chat.send", { sessionKey, message })).runId as string;

test("Bare model id: a selection without runtime and provider is refused naming the missing fields", async () => {
  const before = h.fake.calls.length;
  const error = await admin.fail("jagentchill.session.create", { ref: { modelId: "gpt-5" } });
  assert.equal(error.code, "INVALID_PARAMS");
  assert.deepEqual(error.details.missing, ["runtimeId", "providerId"]);
  const session = await create(admin, { ref: CLAUDE });
  const control = await admin.fail("jagentchill.session.control.set", { sessionKey: session.sessionKey, ref: { modelId: "opus" } });
  assert.equal(control.code, "INVALID_PARAMS");
  assert.deepEqual((await admin.call("jagentchill.session.get", { sessionKey: session.sessionKey })).session.ref, CLAUDE);
  assert.equal(h.fake.calls.slice(before).filter((call) => call.method !== "catalog").length, 0, "nothing reached a runtime");
});

test("Each runtime is opened with its own permission mode for the product mode; a CLI runtime changes nothing about the session: there is one kind", async () => {
  const claude = await create(admin, { ref: CLAUDE });
  await send(admin, claude.sessionKey);
  assert.deepEqual([lastOpen().runtimeId, lastOpen().model, lastOpen().mode, "agentClass" in claude], ["claude-code", "sonnet", "acceptEdits", false]);
  // Session placed on Codex: its app-server thread runs in the workspace sandbox and asks before it acts.
  const codex = await create(admin, { ref: CODEX });
  await send(admin, codex.sessionKey);
  assert.deepEqual([lastOpen().runtimeId, lastOpen().model, lastOpen().mode], ["codex", "gpt-x", "workspace-write"]);
  const gemini = await create(admin, { ref: GEMINI });
  await send(admin, gemini.sessionKey);
  assert.deepEqual([lastOpen().runtimeId, gemini.modeId], ["gemini-cli", "edit"]);
  // Ask and Plan never let a runtime change anything by itself; Auto is decided by the server's own rules.
  const ask = await create(editor, { ref: CLAUDE, modeId: "ask" });
  await send(editor, ask.sessionKey);
  assert.equal(lastOpen().mode, "plan");
  const askCodex = await create(editor, { ref: CODEX, modeId: "ask" });
  await send(editor, askCodex.sessionKey);
  assert.equal(lastOpen().mode, "read-only");
  const auto = await create(editor, { ref: CLAUDE, modeId: "auto" });
  await send(editor, auto.sessionKey);
  assert.equal(lastOpen().mode, "default", "Auto asks the server, which allows what is not risky");
  // Every runtime session is given the server's tools for that session only, and works in a folder of its own.
  assert.ok(h.fake.callsOf("createSession").every((params) => typeof params.mode === "string" || params.runtimeId === "gemini-cli"));
  assert.ok(h.fake.callsOf("createSession").every((params) => typeof params.cwd === "string" && params.cwd.startsWith(h.dataDir)));
  assert.deepEqual([claude.access, codex.access], ["private", "private"]);
  for (const key of [claude, codex, gemini, ask, askCodex, auto].map((session) => session.sessionKey)) h.fake.endTurn(key);
});

test("Mode change keeps an explicit value and is applied when the runtime session opens again", async () => {
  const session = await create(admin, { ref: CODEX });
  await admin.call("jagentchill.session.control.set", { sessionKey: session.sessionKey, modeId: "auto" });
  const ask = await admin.call("jagentchill.session.control.set", { sessionKey: session.sessionKey, modeId: "ask" });
  assert.equal(ask.applied.modeId, "ask");
  await send(admin, session.sessionKey);
  assert.equal(lastOpen().mode, "read-only");
  h.fake.endTurn(session.sessionKey);
  await tick();
  // Stale expectation: a change made against a mode another device already replaced is refused.
  const stale = await admin.fail("jagentchill.session.control.set", { sessionKey: session.sessionKey, modeId: "edit", expected: { modeId: "auto" } });
  assert.deepEqual([stale.code, stale.details.modeId], ["CONFLICT", "ask"]);
  // The next turn opens the runtime session again with the new mode, resuming its own conversation.
  await admin.call("jagentchill.session.control.set", { sessionKey: session.sessionKey, modeId: "edit" });
  await send(admin, session.sessionKey);
  assert.deepEqual([lastOpen().mode, h.fake.calls.filter((call) => call.method === "resumeSession").at(-1)?.params.handle.sessionId], ["workspace-write", h.fake.state.opened.at(-2)!.resumed?.sessionId ?? h.fake.callsOf("resumeSession").at(-1).handle.sessionId]);
  h.fake.endTurn(session.sessionKey);
  // Unsupported product mode: Gemini CLI cannot run in Ask.
  const gemini = await create(admin, { ref: GEMINI });
  const unsupported = await admin.fail("jagentchill.session.control.set", { sessionKey: gemini.sessionKey, modeId: "ask" });
  assert.deepEqual([unsupported.code, unsupported.message], ["runtime/unsupported-capability", "This runtime edits files without asking"]);
});

test("An editor selects CLI runtimes like an admin; a viewer selects none; running without asking stays with admin devices", async () => {
  const policy = async (device: typeof admin) => (await device.call("jagentchill.runtime.models.list", {})).policy;
  assert.deepEqual([await policy(editor), await policy(admin)], [{ canSelect: true }, { canSelect: true }]);
  const viewer = await h.pair("Viewer", "viewer");
  assert.deepEqual(await policy(viewer), { canSelect: false, reason: "Viewers cannot select a runtime" });
  const own = await create(editor, { ref: CLAUDE });
  assert.deepEqual(own.ref, CLAUDE);
  const switched = await editor.call("jagentchill.session.runtime.switch", { sessionKey: own.sessionKey, ref: CODEX, idempotencyKey: "editor-switch-0001" });
  assert.deepEqual(switched.session.ref, CODEX);
  // A runtime that brings its own permissions is confirmed by an admin device, never by an editor.
  assert.equal((await editor.fail("jagentchill.session.create", { ref: CUSTOM_ACP, confirmFullAccess: true })).code, "SCOPE_DENIED");
  assert.equal((await editor.fail("jagentchill.session.unattended.set", { sessionKey: own.sessionKey, enabled: true, confirm: true })).code, "SCOPE_DENIED");
});

test("Refused before any runtime: the unattended mode cannot be selected through control.set", async () => {
  const session = await create(editor, { ref: CLAUDE });
  const before = h.fake.calls.length;
  const error = await editor.fail("jagentchill.session.control.set", { sessionKey: session.sessionKey, modeId: "unattended" });
  assert.equal(error.code, "SCOPE_DENIED");
  assert.equal(h.fake.calls.slice(before).filter((call) => call.method !== "catalog").length, 0);
  assert.equal((await editor.call("jagentchill.session.get", { sessionKey: session.sessionKey })).session.modeId, "edit");
});

test("Confirm and badge; Editor attempts it; an unattended session's runtime is never asked", async () => {
  await h.settled();
  const session = await create(admin, { ref: CUSTOM_ACP, confirmFullAccess: true });
  await admin.call("jagentchill.session.subscribe", {});
  await admin.call("jagentchill.session.unattended.set", { sessionKey: session.sessionKey, enabled: false });
  // Without the explicit confirmation nothing changes.
  assert.equal((await admin.fail("jagentchill.session.unattended.set", { sessionKey: session.sessionKey, enabled: true })).code, "INVALID_PARAMS");
  const granted = await admin.call("jagentchill.session.unattended.set", { sessionKey: session.sessionKey, enabled: true, confirm: true });
  assert.equal(granted.session.unattended, true);
  await tick();
  assert.ok(admin.events.some((event) => event.event === "jagentchill.session.updated" && event.payload.session.sessionKey === session.sessionKey && event.payload.session.unattended === true));
  assert.deepEqual(h.audit("session.unattended.set").at(-1), { actor: `device:${admin.device.deviceId}`, sessionKey: session.sessionKey, enabled: true, runtimeId: "my-agent" });
  // Running without asking: what the runtime asks is allowed by the server, nobody is shown a card.
  await send(admin, session.sessionKey);
  h.fake.ask(session.sessionKey, { id: "oc:1", kind: "session/request_permission", detail: { toolCall: { title: "rm", kind: "execute", rawInput: { command: "rm -rf build" } } } });
  await tick();
  assert.equal(h.fake.answers().get("oc:1")?.decision, "allow");
  h.fake.endTurn(session.sessionKey);
  // Editor attempts it: the scope is missing.
  assert.equal((await editor.fail("jagentchill.session.unattended.set", { sessionKey: session.sessionKey, enabled: true, confirm: true })).code, "SCOPE_DENIED");
  // A runtime that asks before it runs anything on the host has nothing to allow.
  const plain = await create(admin, { ref: CODEX });
  assert.equal((await admin.fail("jagentchill.session.unattended.set", { sessionKey: plain.sessionKey, enabled: true, confirm: true })).code, "runtime/unsupported-capability");
});

test("A runtime that decides by itself what it runs needs an admin's explicit confirmation", async () => {
  await h.settled();
  const before = h.fake.callsOf("createSession").length;
  const unconfirmed = await admin.fail("jagentchill.session.create", { ref: CUSTOM_ACP });
  assert.equal(unconfirmed.code, "runtime/unattended-not-granted");
  assert.equal(h.fake.callsOf("createSession").length, before);
  const session = await create(admin, { ref: CUSTOM_ACP, confirmFullAccess: true });
  assert.equal(session.unattended, true);
  await send(admin, session.sessionKey);
  assert.deepEqual([lastOpen().runtimeId, lastOpen().model], ["my-agent", "ma/one"]);
  h.fake.endTurn(session.sessionKey);
  assert.equal(h.audit("session.unattended.set").at(-1).reason, "runtime-requires-full-access");
});

test("Mode change during a CLI turn is applied after the turn; Downgrade; Expected turn no longer active; a follow-up starts its own turn", async () => {
  const session = await create(admin, { ref: CLAUDE });
  const runId = await send(admin, session.sessionKey, "work");
  const opens = h.fake.callsOf("createSession").length + h.fake.callsOf("resumeSession").length;
  const changed = await admin.call("jagentchill.session.control.set", { sessionKey: session.sessionKey, modeId: "plan" });
  assert.deepEqual([changed.accepted, changed.pending, changed.notices.map((n: any) => n.message), changed.applied.modeId], [true, { modeId: "plan" }, ["Applies after this turn"], "edit"]);
  // Downgrade: a steer on a runtime that cannot take messages mid-turn becomes a follow-up.
  assert.deepEqual(await admin.call("jagentchill.session.queue.resolve", { sessionKey: session.sessionKey, requested: "steer" }), { effective: "followup", downgradedFrom: "steer", reason: "This runtime cannot take messages mid-turn", activeRunId: runId });
  const sends = h.fake.callsOf("startTurn").length;
  const queued = await admin.call("jagentchill.chat.send", { sessionKey: session.sessionKey, message: "also this", queueMode: "steer" });
  assert.deepEqual([queued.effective, queued.downgradedFrom, queued.status, queued.runId], ["followup", "steer", "queued", runId]);
  assert.equal(h.fake.callsOf("startTurn").length, sends, "held until the turn ends");
  // Expected turn no longer active: nothing is sent.
  assert.deepEqual(await admin.call("jagentchill.session.queue.resolve", { sessionKey: session.sessionKey, requested: "steer", expectedRunId: "run-gone" }), { effective: "none", reason: "turn-changed", activeRunId: runId });
  assert.deepEqual(await admin.call("jagentchill.chat.send", { sessionKey: session.sessionKey, message: "late", queueMode: "steer", expectedRunId: "run-gone" }), { delivered: false, effective: "none", reason: "turn-changed" });
  h.fake.endTurn(session.sessionKey, runId);
  await tick(40);
  assert.deepEqual([(await admin.call("jagentchill.session.get", { sessionKey: session.sessionKey })).session.modeId], ["plan"]);
  // The held follow-up starts its own turn, on a runtime session opened again in the new mode.
  assert.equal(h.fake.callsOf("startTurn").at(-1).message, "also this");
  assert.equal(h.fake.callsOf("createSession").length + h.fake.callsOf("resumeSession").length, opens + 1);
  assert.equal(lastOpen().mode, "plan");
  h.fake.endTurn(session.sessionKey);
  // "Interrupt" stops the running turn and starts the new one at once.
  const first = await send(admin, session.sessionKey, "long job");
  const replaced = await admin.call("jagentchill.chat.send", { sessionKey: session.sessionKey, message: "do this instead", queueMode: "interrupt" });
  assert.notEqual(replaced.runId, first);
  assert.equal(h.fake.callsOf("interrupt").at(-1).turnId, first);
  assert.equal(h.fake.callsOf("startTurn").at(-1).message, "do this instead");
  h.fake.endTurn(session.sessionKey);
});

test("Model, thinking and features: stored, offered by the model, and taken by the runtime when it opens next", async () => {
  const session = await create(admin, { ref: CLAUDE });
  const thinking = await admin.call("jagentchill.session.control.set", { sessionKey: session.sessionKey, thinkingOptionId: "high" });
  assert.equal(thinking.applied.thinkingOptionId, "high");
  const fast = await admin.call("jagentchill.session.control.set", { sessionKey: session.sessionKey, features: { fast_mode: "on" } });
  assert.deepEqual(fast.applied.featureValues, { fast_mode: "on" });
  await send(admin, session.sessionKey);
  assert.deepEqual([lastOpen().model, lastOpen().thinking], ["sonnet", "high"]);
  h.fake.endTurn(session.sessionKey);
  // Model-dependent feature: the next model has no fast mode, so the value falls back and is reported; so does thinking.
  const moved = await admin.call("jagentchill.session.control.set", { sessionKey: session.sessionKey, ref: CLAUDE_OPUS });
  assert.deepEqual([moved.resetFeatures, moved.applied.featureValues.fast_mode, moved.applied.ref, moved.applied.thinkingOptionId], [["fast_mode"], "off", CLAUDE_OPUS, null]);
  await send(admin, session.sessionKey);
  assert.deepEqual([lastOpen().model, lastOpen().thinking], ["opus", undefined]);
  h.fake.endTurn(session.sessionKey);
  // Unsupported feature.
  const unsupported = await admin.fail("jagentchill.session.control.set", { sessionKey: session.sessionKey, features: { fast_mode: "on" } });
  assert.deepEqual([unsupported.code, unsupported.message], ["runtime/unsupported-capability", "This runtime does not support Fast mode"]);
  // A thinking option the model does not offer is refused; another runtime is a runtime switch.
  assert.equal((await admin.fail("jagentchill.session.control.set", { sessionKey: session.sessionKey, thinkingOptionId: "high" })).code, "runtime/unsupported-capability");
  assert.equal((await admin.fail("jagentchill.session.control.set", { sessionKey: session.sessionKey, ref: CODEX })).code, "runtime/switch-required");
});

test("Switch while idle carries the conversation; First turn fails; the hand-over survives until it is answered", async () => {
  const session = await create(admin, { ref: CLAUDE, title: "Trailer" });
  await admin.call("jagentchill.session.control.set", { sessionKey: session.sessionKey, thinkingOptionId: "high" });
  await send(admin, session.sessionKey, "Cut the intro to five seconds");
  h.fake.emit(session.sessionKey, { type: "reasoning_delta", turnId: h.fake.session(session.sessionKey).turnId, text: "secret reasoning" });
  h.fake.text(session.sessionKey, "Done.");
  h.fake.tool(session.sessionKey, { id: "t1", name: "jc_trim", input: { clip: "a" }, output: "trimmed" });
  h.fake.endTurn(session.sessionKey);
  await tick();
  const switched = await admin.call("jagentchill.session.runtime.switch", { sessionKey: session.sessionKey, ref: CODEX, idempotencyKey: "s1" });
  // Switch while idle: the same session, on the target, with the target's defaults.
  assert.deepEqual([switched.session.sessionKey, switched.session.title, switched.session.ref, switched.session.modeId, switched.session.thinkingOptionId],
    [session.sessionKey, "Trailer", CODEX, "edit", null]);
  assert.deepEqual(switched.handover, { itemCount: 3, omittedCount: 0 });
  assert.ok(["summary-context", "thinking-reset", "no-rewind"].every((code) => switched.notices.some((n: any) => n.code === code)));
  // A repeated request with the same key answers the same and does nothing again.
  assert.deepEqual((await admin.call("jagentchill.session.runtime.switch", { sessionKey: session.sessionKey, ref: CODEX, idempotencyKey: "s1" })).handover, switched.handover);
  const stored = (await admin.call("jagentchill.session.handover.get", { sessionKey: session.sessionKey })).handovers[0];
  assert.equal(stored.status, "staged");
  assert.match(stored.text, /^<chat-history-summary>\nSession: Trailer\nEarlier runtime and model: claude-code · anthropic\/sonnet/);
  assert.ok(stored.text.includes("User: Cut the intro to five seconds") && stored.text.includes("[tool jc_trim]") && !stored.text.includes("secret reasoning"));
  // First turn fails: the record stays staged and the next message carries it again, exactly once.
  const first = await send(admin, session.sessionKey, "continue");
  assert.equal(lastOpen().runtimeId, "codex", "a new runtime session on the target");
  assert.ok(h.fake.callsOf("startTurn").at(-1).message.startsWith("<chat-history-summary>") && h.fake.callsOf("startTurn").at(-1).message.endsWith("\n\ncontinue"));
  h.fake.endTurn(session.sessionKey, first, "error", "connection reset");
  await tick(30);
  assert.equal((await admin.call("jagentchill.session.handover.get", { sessionKey: session.sessionKey })).handovers[0].status, "staged");
  const second = await send(admin, session.sessionKey, "again");
  assert.equal(h.fake.callsOf("startTurn").at(-1).message.match(/<chat-history-summary>/g)!.length, 1);
  h.fake.endTurn(session.sessionKey, second, "final");
  await tick(30);
  assert.equal((await admin.call("jagentchill.session.handover.get", { sessionKey: session.sessionKey })).handovers[0].status, "delivered");
  await send(admin, session.sessionKey, "third");
  assert.equal(h.fake.callsOf("startTurn").at(-1).message, "third");
  h.fake.endTurn(session.sessionKey);
});

test("Never more permissive: a session in Ask is not moved to a runtime that only edits unless the person confirmed the mode", async () => {
  const ask = await create(admin, { ref: CODEX, modeId: "ask" });
  const refused = await admin.fail("jagentchill.session.runtime.switch", { sessionKey: ask.sessionKey, ref: GEMINI, idempotencyKey: "g1" });
  assert.deepEqual([refused.code, refused.message, refused.details.acceptModeChange], ["runtime/unsupported-capability", "This runtime cannot run in Ask mode", "edit"]);
  assert.deepEqual((await admin.call("jagentchill.session.get", { sessionKey: ask.sessionKey })).session.ref, CODEX);
  const accepted = await admin.call("jagentchill.session.runtime.switch", { sessionKey: ask.sessionKey, ref: GEMINI, idempotencyKey: "g2", acceptModeChange: "edit" });
  assert.deepEqual([accepted.session.modeId, accepted.session.ref], ["edit", GEMINI]);
  // A switch during a turn stops the turn first; the device keeps addressing the session by its own key.
  const moved = await create(admin, { ref: CLAUDE });
  await admin.call("jagentchill.chat.subscribe", { sessionKey: moved.sessionKey });
  const running = await send(admin, moved.sessionKey, "busy");
  await admin.call("jagentchill.session.runtime.switch", { sessionKey: moved.sessionKey, ref: CODEX, idempotencyKey: "r1" });
  assert.equal(h.fake.callsOf("interrupt").at(-1).turnId, running);
  await send(admin, moved.sessionKey, "on the new one");
  assert.deepEqual([lastOpen().runtimeId, lastOpen().sessionKey], ["codex", moved.sessionKey]);
  h.fake.text(moved.sessionKey, "hi");
  await tick();
  assert.ok(admin.events.some((event) => event.event === "jagentchill.chat.stream" && event.payload.sessionKey === moved.sessionKey && event.payload.state === "delta"));
  assert.ok(admin.events.some((event) => event.event === "jagentchill.chat.notice" && event.payload.code === "turn-stopped"));
  h.fake.endTurn(moved.sessionKey);
});

test("Rate limit: the 21st runtime switch within an hour is refused", async () => {
  const session = await create(admin, { ref: CODEX });
  for (let i = 0; i < 20; i++) await admin.call("jagentchill.session.runtime.switch", { sessionKey: session.sessionKey, ref: i % 2 ? CODEX : CLAUDE, idempotencyKey: `k${i}` });
  const limited = await admin.fail("jagentchill.session.runtime.switch", { sessionKey: session.sessionKey, ref: CLAUDE, idempotencyKey: "k20" });
  assert.equal(limited.code, "RATE_LIMITED");
  assert.ok(limited.details.retryAfter_ms > 0 && limited.details.retryAfter_ms <= 3_600_000);
});

test("Disabled runtime still referenced: the next send is refused before any runtime call", async () => {
  const session = await create(admin, { ref: CODEX });
  await send(admin, session.sessionKey, "hello");
  h.fake.endTurn(session.sessionKey);
  const revision = (await admin.call("jagentchill.runtime.config.get", {})).config.revision;
  await admin.call("jagentchill.runtime.config.update", { expectedRevision: revision, patch: { entries: { codex: { enabled: false } } } });
  const sends = h.fake.callsOf("startTurn").length;
  const refused = await admin.fail("jagentchill.chat.send", { sessionKey: session.sessionKey, message: "again" });
  assert.deepEqual([refused.code, refused.message], ["runtime/disabled", "This runtime was turned off — choose another"]);
  assert.equal(h.fake.callsOf("startTurn").length, sends);
  await admin.call("jagentchill.runtime.config.update", { expectedRevision: revision + 1, patch: { entries: { codex: {} } } });
  await h.settled();
});

test("Automatic title, rename, fork, rewind, delete and usage per turn", async () => {
  const session = await create(admin, { ref: CLAUDE });
  const long = "Make the opening shot slower and add a title card that fades in after two seconds";
  const runId = await send(admin, session.sessionKey, long);
  let current = (await admin.call("jagentchill.session.get", { sessionKey: session.sessionKey })).session;
  assert.deepEqual([current.title, current.titleSource], [long.slice(0, 60), "auto"]);
  // A title a person typed is never overwritten by automatic titling.
  await admin.call("jagentchill.session.update", { sessionKey: session.sessionKey, title: "  Opening shot  " });
  // Usage of the turn is what the runtime reported during it.
  h.fake.reply(session.sessionKey, "Slower now.", { usage: { inputTokens: 20, outputTokens: 5, costUsd: 0.002 } });
  await tick(40);
  const next = await send(admin, session.sessionKey, "another");
  current = (await admin.call("jagentchill.session.get", { sessionKey: session.sessionKey })).session;
  assert.deepEqual([current.title, current.titleSource], ["Opening shot", "user"]);
  const usage = await admin.call("jagentchill.session.usage.list", { sessionKey: session.sessionKey });
  // Claude Code on its own sign-in reports tokens; the cost it estimates is not what was paid.
  assert.deepEqual([usage.reports, usage.turns.length, usage.turns[0].runId, usage.turns[0].modelId, usage.turns[0].cost, usage.totals], ["tokens", 1, runId, "sonnet", null, { inputTokens: 20, outputTokens: 5, totalTokens: 25, cost: 0, turns: 1 }]);
  h.fake.reply(session.sessionKey, "Done.");
  await tick(40);
  // Fork: a new session of the same model, mode and thinking, carrying a summary of the conversation, never the unattended grant.
  const fork = await admin.call("jagentchill.session.fork", { sessionKey: session.sessionKey });
  assert.deepEqual([fork.session.title, fork.session.parentSessionKey, fork.session.ref, fork.session.unattended, fork.carried], ["Opening shot (fork)", session.sessionKey, CLAUDE, false, "summary"]);
  assert.equal((await admin.call("jagentchill.session.handover.get", { sessionKey: fork.session.sessionKey })).handovers[0].itemCount, 4);
  // Fork from one message: the summary stops at that message.
  const messages = (await admin.call("jagentchill.chat.history", { sessionKey: session.sessionKey })).messages;
  const firstAnswer = messages.find((message: any) => message.role === "assistant");
  const early = await admin.call("jagentchill.session.fork", { sessionKey: session.sessionKey, boundary: { messageId: firstAnswer.id } });
  const earlyHandover = (await admin.call("jagentchill.session.handover.get", { sessionKey: early.session.sessionKey })).handovers[0];
  assert.equal(earlyHandover.itemCount, 2);
  assert.ok(earlyHandover.text.includes("Slower now.") && !earlyHandover.text.includes("another"));
  assert.equal((await admin.fail("jagentchill.session.fork", { sessionKey: session.sessionKey, boundary: { messageId: "gone" } })).code, "FORK_ANCHOR_GONE");
  // The fork's first message carries the conversation.
  await send(admin, fork.session.sessionKey, "go on");
  assert.ok(h.fake.callsOf("startTurn").at(-1).message.startsWith("<chat-history-summary>"));
  h.fake.endTurn(fork.session.sessionKey);
  // Rewind: no runtime the server drives can continue from an earlier message.
  const noRewind = await admin.fail("jagentchill.session.rewind", { sessionKey: session.sessionKey, messageId: firstAnswer.id, scope: ["conversation"] });
  assert.deepEqual([noRewind.code, noRewind.details.capability], ["runtime/unsupported-capability", "rewind.conversation"]);
  // Delete: the runtime session and the transcript go; another editor could never delete it.
  assert.equal((await editor.fail("jagentchill.session.delete", { sessionKey: session.sessionKey })).code, "NOT_FOUND");
  await admin.call("jagentchill.session.delete", { sessionKey: session.sessionKey });
  assert.equal(h.fake.state.sessions.get(session.sessionKey)?.closed, true);
  assert.equal(h.app.transcript.total(session.sessionKey), 0);
  assert.equal((await admin.fail("jagentchill.session.get", { sessionKey: session.sessionKey })).code, "NOT_FOUND");
  assert.equal((await admin.call("jagentchill.session.usage.list", { sessionKey: fork.session.sessionKey })).totals, null);
  void next;
});

test("A failed turn reaches the device with a mapped code; a credential failure re-probes the runtime", async () => {
  const session = await create(admin, { ref: CLAUDE });
  await admin.call("jagentchill.chat.subscribe", { sessionKey: session.sessionKey });
  const sent = await admin.call("jagentchill.chat.send", { sessionKey: session.sessionKey, message: "go" });
  // A runtime may report the same failure twice (its own end, then its process exit).
  const runtime = h.fake.session(session.sessionKey);
  runtime.emit({ type: "turn_failed", turnId: sent.runId, code: "RUNTIME_ERROR", diagnostic: "429 Too Many Requests: retry after 90s" });
  runtime.emit({ type: "turn_failed", turnId: sent.runId, code: "RUNTIME_ERROR", diagnostic: "429 Too Many Requests: retry after 90s" });
  await tick(30);
  const errors = admin.events.filter((candidate) => candidate.event === "jagentchill.chat.error" && candidate.payload.sessionKey === session.sessionKey && candidate.payload.runId === sent.runId);
  assert.equal(errors.length, 1, "the same failed run is delivered once");
  const event = errors[0];
  assert.deepEqual([event.payload.error.code, event.payload.error.retryable, event.payload.error.details.retryAfter_ms], ["runtime/rate-limited", true, 90_000]);
  const history = await admin.call("jagentchill.chat.history", { sessionKey: session.sessionKey });
  const saved = history.messages.find((message: any) => message.role === "error");
  assert.deepEqual([saved?.id, saved?.jagentchill.error.code, saved?.jagentchill.error.message], [`e-${sent.runId}`, "runtime/rate-limited", "The provider is limiting requests. Try again shortly."]);
});

test("Stop targets the running turn and always ends it", async () => {
  const session = await create(admin, { ref: CLAUDE });
  const sent = await admin.call("jagentchill.chat.send", { sessionKey: session.sessionKey, message: "retrying provider request" });
  const stopped = await admin.call("jagentchill.chat.abort", { sessionKey: session.sessionKey });
  assert.deepEqual(h.fake.callsOf("interrupt").at(-1), { sessionKey: session.sessionKey, turnId: sent.runId });
  assert.deepEqual(stopped, { aborted: true, runId: sent.runId });
  // Nothing is running any more: Stop answers at once.
  assert.deepEqual(await admin.call("jagentchill.chat.abort", { sessionKey: session.sessionKey }), { aborted: true });
});

test("A finished or failed chat turn reaches every device allowed to read the session without a chat subscription", async () => {
  const session = await create(admin, { ref: CLAUDE, title: "Elsewhere" });
  const finished = await admin.call("jagentchill.chat.send", { sessionKey: session.sessionKey, message: "finish" });
  h.fake.endTurn(session.sessionKey, finished.runId, "final");
  await tick(40);
  const event = admin.events.find((entry) => entry.event === "jagentchill.chat.turn.ended" && entry.payload.sessionKey === session.sessionKey);
  assert.deepEqual(event?.payload, { sessionKey: session.sessionKey, state: "final", runId: finished.runId });
  assert.equal(editor.events.some((entry) => entry.event === "jagentchill.chat.turn.ended" && entry.payload.sessionKey === session.sessionKey), false, "private sessions stay private");

  const failed = await admin.call("jagentchill.chat.send", { sessionKey: session.sessionKey, message: "fail" });
  h.fake.endTurn(session.sessionKey, failed.runId, "error", "provider failed");
  await tick(40);
  assert.ok(admin.events.some((entry) => entry.event === "jagentchill.chat.turn.ended" && entry.payload.runId === failed.runId && entry.payload.state === "error"));

  const stopped = await admin.call("jagentchill.chat.send", { sessionKey: session.sessionKey, message: "stop" });
  h.fake.endTurn(session.sessionKey, stopped.runId, "aborted");
  await tick(40);
  assert.ok(admin.events.some((entry) => entry.event === "jagentchill.chat.turn.ended" && entry.payload.runId === stopped.runId && entry.payload.state === "aborted"));
});

test("Error mapping: CLI exits at launch, Rate limit with retry time, Unknown provider failure", () => {
  // CLI exits at launch.
  assert.deepEqual(classifyTurnError("claude exited with code 127 before its first event", "Claude Code"), { code: "runtime/launch-failed", message: "Claude Code failed to start (exit 127)", retryable: false, details: { exitCode: 127 } });
  // Rate limit with retry time.
  const limited = classifyTurnError("rate limit exceeded, try again in 90 seconds", "Claude Code");
  assert.deepEqual([limited.code, limited.retryable, limited.details], ["runtime/rate-limited", true, { retryAfter_ms: 90_000 }]);
  // Unknown provider failure.
  assert.deepEqual(classifyTurnError("something odd sk-live-abcdef happened", "Claude Code"), { code: "UNAVAILABLE", message: "The provider returned an unexpected error", retryable: false });
  assert.equal(classifyTurnError("401 Incorrect API key provided", "Claude Code").code, "runtime/auth-failed");
  assert.equal(classifyTurnError("insufficient_quota: You exceeded your current quota", "Claude Code").code, "runtime/billing");
  assert.equal(classifyTurnError("This model's maximum context length is 8192 tokens", "Claude Code").code, "runtime/context-overflow");
  assert.equal(classifyTurnError("The model `x` does not exist", "Claude Code").code, "runtime/model-unavailable");
});

test("Long conversation: the hand-over is capped at 200 000 characters, drops the oldest items whole and says how many", () => {
  const messages = Array.from({ length: 450 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: [{ type: "text", text: `item ${i} ` + "x".repeat(990) }] }));
  const built = buildHandover({ title: "Long", from: CLAUDE, created_ms: 0, messages });
  assert.ok(built.text.length <= 200_000);
  assert.equal(built.itemCount, 450);
  assert.ok(built.omittedCount > 0);
  assert.ok(built.text.startsWith("<chat-history-summary>\nSession: Long\n") && built.text.includes(`[${built.omittedCount} earlier items omitted]`));
  assert.ok(built.text.includes("item 449 ") && !built.text.includes("item 0 x"));
  assert.ok(built.text.indexOf(`[${built.omittedCount} earlier items omitted]`) < built.text.indexOf(`item ${built.omittedCount} `));
  // A tool result is cut to 2 000 characters; five thousand items build well within two seconds.
  const tool = buildHandover({ title: "T", from: CLAUDE, created_ms: 0, messages: [{ role: "toolResult", toolName: "jc_probe", content: [{ type: "text", text: "r".repeat(9000) }] }] });
  assert.ok(tool.text.length < 2400);
  const started = Date.now();
  buildHandover({ title: "Many", from: CLAUDE, created_ms: 0, messages: Array.from({ length: 5000 }, (_, i) => ({ role: "user", content: `message ${i}` })) });
  assert.ok(Date.now() - started < 2000);
});
