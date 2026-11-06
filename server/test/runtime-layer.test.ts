import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { AcpRuntimeClient, ClaudeRuntimeClient, CodexRuntimeClient } from "../src/agents/runtime/clients.ts";

const fake = resolve(import.meta.dirname, "fixtures/fake-codex-app-server.mjs");
/** Reads a pid file the fake CLI writes once it has started (the SDK starts it a moment after the session opens). */
const pidOf = async (file: string): Promise<number> => { for (let attempt = 0; attempt < 150; attempt++) { try { return Number(await readFile(file, "utf8")); } catch { await new Promise((resolve) => setTimeout(resolve, 20)); } } throw new Error(`no pid file ${file}`); };
const until = async <T>(promise: Promise<T>, ms = 3000): Promise<T> => Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);

test("Codex adapter: fake app-server initializes, streams text/tool/usage/permission, and persists a resumable thread handle", async () => {
  const client = new CodexRuntimeClient(fake);
  const session = await client.createSession({ model: "fixture-model", mcpUrl: "http://127.0.0.1:18930/agent-tools/mcp?session=s1", mcpToken: "fixture" });
  const events: any[] = [];
  session.subscribe((event) => events.push(event));
  const { turnId } = await session.startTurn("hello");
  await until(new Promise<void>((resolve) => {
    const poll = () => events.some((event) => event.type === "permission_requested") ? resolve() : setTimeout(poll, 10);
    poll();
  }));
  await session.respondToPermission("approval-1", "allow");
  await until(new Promise<void>((resolve) => {
    const poll = () => events.some((event) => event.type === "turn_completed") ? resolve() : setTimeout(poll, 10);
    poll();
  }));
  assert.ok(events.some((event) => event.type === "assistant_text_delta" && event.text === "hello"));
  assert.ok(events.some((event) => event.type === "tool_call_started" && event.name === "jc_echo"));
  assert.ok(events.some((event) => event.type === "tool_call_updated" && event.id === "tool-1"));
  assert.ok(events.some((event) => event.type === "tool_call_finished" && event.id === "tool-1" && event.status === "completed"));
  assert.ok(events.some((event) => event.type === "usage" && event.inputTokens === 4));
  assert.deepEqual(session.persistence(), { runtime: "codex", sessionId: "thread-fixture", nativeHandle: { threadId: "thread-fixture" } });
  assert.ok(events.some((event) => event.type === "turn_started" && event.turnId === turnId));
  await session.close();
  const resumed = await client.resumeSession({ runtime: "codex", sessionId: "thread-fixture" });
  assert.equal(resumed.persistence().sessionId, "thread-fixture");
  await resumed.close();
});

test("Codex adapter: deny resolves the permission and interrupt cancels and reaps the CLI child", async () => {
  const pidFile = resolve(import.meta.dirname, "../../.dev/run-w21a2-1/codex-interrupt.pid");
  process.env.JAGENTCHILL_FIXTURE_PID_FILE = pidFile;
  const client = new CodexRuntimeClient(fake);
  const denied = await client.createSession();
  const deniedEvents: any[] = []; denied.subscribe((event) => deniedEvents.push(event));
  await denied.startTurn("hello");
  await until(new Promise<void>((resolve) => { const poll = () => deniedEvents.some((event) => event.type === "permission_requested") ? resolve() : setTimeout(poll, 10); poll(); }));
  await denied.respondToPermission("approval-1", "deny");
  await until(new Promise<void>((resolve) => { const poll = () => deniedEvents.some((event) => event.type === "turn_completed") ? resolve() : setTimeout(poll, 10); poll(); }));
  assert.ok(deniedEvents.some((event) => event.type === "permission_resolved" && event.id === "approval-1" && event.decision === "deny"));
  await denied.close();

  const session = await client.createSession();
  const events: any[] = []; session.subscribe((event) => events.push(event));
  await session.startTurn("interrupt");
  const pid = await until(pidOf(pidFile));
  await session.interrupt();
  await until(new Promise<void>((resolve, reject) => { const poll = () => { try { process.kill(pid, 0); setTimeout(poll, 10); } catch { resolve(); } }; setTimeout(poll, 10); setTimeout(() => reject(new Error(`pid ${pid} still alive`)), 2000); }));
  assert.ok(events.some((event) => event.type === "turn_cancelled"));
  delete process.env.JAGENTCHILL_FIXTURE_PID_FILE;
  await session.close();
});

test("Codex adapter: process crash reports exit code and recent stderr", async () => {
  const session = await new CodexRuntimeClient(fake).createSession();
  const events: any[] = []; session.subscribe((event) => events.push(event));
  await session.startTurn("crash");
  const failed = await until(new Promise<any>((resolve) => {
    const poll = () => { const event = events.find((candidate) => candidate.type === "turn_failed"); return event ? resolve(event) : setTimeout(poll, 10); };
    poll();
  }));
  assert.equal(failed.code, "23");
  assert.match(failed.diagnostic, /fixture exploded/);
  assert.match(failed.diagnostic, /second diagnostic/);
  await session.close();
});

test("ACP adapter: streams tool lifecycle and usage, resolves allow/deny, resumes, reports crashes, and reaps interrupted child", async () => {
  const acpFake = resolve(import.meta.dirname, "fixtures/fake-acp-agent.mjs");
  const client = new AcpRuntimeClient(acpFake);
  const session = await client.createSession({ mcpUrl: "http://127.0.0.1:18930/agent-tools/mcp?session=acp-fixture", mcpToken: "fixture" });
  const events: any[] = []; session.subscribe((event) => events.push(event));
  const { turnId } = await session.startTurn("hello");
  await until(new Promise<void>((resolve) => { const poll = () => events.some((event) => event.type === "permission_requested") ? resolve() : setTimeout(poll, 10); poll(); }));
  await session.respondToPermission("acp-permission", "allow");
  await until(new Promise<void>((resolve) => { const poll = () => events.some((event) => event.type === "turn_completed") ? resolve() : setTimeout(poll, 10); poll(); }));
  assert.ok(events.some((event) => event.type === "assistant_text_delta" && event.text === "hi"));
  assert.ok(events.some((event) => event.type === "tool_call_started" && event.name === "jc_echo"));
  assert.ok(events.some((event) => event.type === "tool_call_updated" && event.id === "acp-tool"));
  assert.ok(events.some((event) => event.type === "tool_call_finished" && event.id === "acp-tool" && event.status === "completed"));
  assert.ok(events.some((event) => event.type === "usage" && event.inputTokens === 3 && event.outputTokens === 1));
  assert.ok(events.some((event) => event.type === "turn_started" && event.turnId === turnId));
  assert.ok(events.some((event) => event.type === "permission_resolved" && event.decision === "allow"));
  const handle = session.persistence(); await session.close();
  const resumed = await client.resumeSession(handle); assert.equal(resumed.persistence().sessionId, "acp-fixture"); await resumed.close();

  const denied = await client.createSession(); const deniedEvents: any[] = []; denied.subscribe((event) => deniedEvents.push(event));
  await denied.startTurn("hello");
  await until(new Promise<void>((resolve) => { const poll = () => deniedEvents.some((event) => event.type === "permission_requested") ? resolve() : setTimeout(poll, 10); poll(); }));
  await denied.respondToPermission("acp-permission", "deny");
  assert.ok(deniedEvents.some((event) => event.type === "permission_resolved" && event.decision === "deny")); await denied.close();

  const crashed = await client.createSession(); const crashEvents: any[] = []; crashed.subscribe((event) => crashEvents.push(event));
  await crashed.startTurn("crash");
  const failed = await until(new Promise<any>((resolve) => { const poll = () => { const event = crashEvents.find((candidate) => candidate.type === "turn_failed"); return event ? resolve(event) : setTimeout(poll, 10); }; poll(); }));
  assert.equal(failed.code, "24"); assert.match(failed.diagnostic, /acp fixture exploded/); assert.match(failed.diagnostic, /second acp diagnostic/); await crashed.close();

  const pidFile = resolve(import.meta.dirname, "../../.dev/run-w21a2-1/acp-interrupt.pid"); process.env.JAGENTCHILL_FIXTURE_PID_FILE = pidFile;
  const interrupted = await client.createSession(); const interruptEvents: any[] = []; interrupted.subscribe((event) => interruptEvents.push(event));
  await interrupted.startTurn("interrupt"); const pid = await until(pidOf(pidFile));
  await interrupted.interrupt();
  await until(new Promise<void>((resolve, reject) => { const poll = () => { try { process.kill(pid, 0); setTimeout(poll, 10); } catch { resolve(); } }; setTimeout(poll, 10); setTimeout(() => reject(new Error(`pid ${pid} still alive`)), 2000); }));
  assert.ok(interruptEvents.some((event) => event.type === "turn_cancelled")); delete process.env.JAGENTCHILL_FIXTURE_PID_FILE; await interrupted.close();
});

test("Claude adapter: fake CLI streams text/tool/usage, resolves allow/deny, resumes, and reaps interrupted child", async () => {
  const claudeFake = resolve(import.meta.dirname, "fixtures/fake-claude-cli.mjs");
  const client = new ClaudeRuntimeClient(claudeFake);
  const session = await client.createSession({ mcpUrl: "http://127.0.0.1:18930/agent-tools/mcp?session=claude-fixture", mcpToken: "fixture" });
  const events: any[] = []; session.subscribe((event) => events.push(event));
  const { turnId } = await session.startTurn("hello");
  await until(new Promise<void>((resolve) => { const poll = () => events.some((event) => event.type === "permission_requested") ? resolve() : setTimeout(poll, 10); poll(); }));
  const permission = events.find((event) => event.type === "permission_requested");
  await session.respondToPermission(permission.id, "allow");
  await until(new Promise<void>((resolve) => { const poll = () => events.some((event) => event.type === "turn_completed") ? resolve() : setTimeout(poll, 10); poll(); }));
  assert.ok(events.some((event) => event.type === "assistant_text_delta" && event.text === "claude hello"));
  assert.ok(events.some((event) => event.type === "tool_call_started" && event.name === "jc_echo"));
  assert.ok(events.some((event) => event.type === "tool_call_finished" && event.id === "claude-tool" && event.status === "completed"));
  assert.ok(events.some((event) => event.type === "usage" && event.inputTokens === 5 && event.outputTokens === 2 && event.costUsd === 0.01));
  assert.ok(events.some((event) => event.type === "permission_resolved" && event.decision === "allow"));
  assert.ok(events.some((event) => event.type === "turn_started" && event.turnId === turnId));
  const handle = session.persistence(); assert.equal(handle.sessionId, "claude-fixture"); await session.close();
  const resumed = await client.resumeSession(handle); assert.equal(resumed.persistence().sessionId, "claude-fixture"); await resumed.close();

  const denied = await client.createSession(); const deniedEvents: any[] = []; denied.subscribe((event) => deniedEvents.push(event));
  await denied.startTurn("deny");
  await until(new Promise<void>((resolve) => { const poll = () => deniedEvents.some((event) => event.type === "permission_requested") ? resolve() : setTimeout(poll, 10); poll(); }));
  const deniedPermission = deniedEvents.find((event) => event.type === "permission_requested"); await denied.respondToPermission(deniedPermission.id, "deny");
  assert.ok(deniedEvents.some((event) => event.type === "permission_resolved" && event.decision === "deny")); await denied.close();

  const crashed = await client.createSession(); const crashEvents: any[] = []; crashed.subscribe((event) => crashEvents.push(event));
  await crashed.startTurn("crash");
  const failed = await until(new Promise<any>((resolve) => { const poll = () => { const event = crashEvents.find((candidate) => candidate.type === "turn_failed"); return event ? resolve(event) : setTimeout(poll, 10); }; poll(); }));
  assert.equal(failed.code, "CLAUDE_QUERY_FAILED"); assert.match(failed.diagnostic, /claude fixture exploded/); assert.match(failed.diagnostic, /second claude diagnostic/); await crashed.close();

  const pidFile = resolve(import.meta.dirname, "../../.dev/run-w21a2-1/claude-interrupt.pid"); process.env.JAGENTCHILL_FIXTURE_PID_FILE = pidFile;
  const interrupted = await client.createSession(); const interruptEvents: any[] = []; interrupted.subscribe((event) => interruptEvents.push(event));
  await interrupted.startTurn("interrupt"); const pid = await until(pidOf(pidFile));
  await interrupted.interrupt();
  await until(new Promise<void>((resolve, reject) => { const poll = () => { try { process.kill(pid, 0); setTimeout(poll, 10); } catch { resolve(); } }; setTimeout(poll, 10); setTimeout(() => reject(new Error(`pid ${pid} still alive`)), 4000); }));
  assert.ok(interruptEvents.some((event) => event.type === "turn_cancelled")); delete process.env.JAGENTCHILL_FIXTURE_PID_FILE; await interrupted.close();
});

// A real Claude Code turn on the s67 build hung at "Listed the projects": the server allows a jc_* tool WHILE the
// permission is being announced, and the adapter only started waiting for the answer after the announcement.
test("an answer given during the permission announcement itself is not lost (Claude, Codex, ACP)", async () => {
  const cases: [string, any][] = [
    ["claude", new ClaudeRuntimeClient(resolve(import.meta.dirname, "fixtures/fake-claude-cli.mjs"))],
    ["codex", new CodexRuntimeClient(fake)],
    ["acp", new AcpRuntimeClient(resolve(import.meta.dirname, "fixtures/fake-acp-agent.mjs"))],
  ];
  for (const [name, client] of cases) {
    const session = await client.createSession({ mcpUrl: "http://127.0.0.1:18930/agent-tools/mcp?session=sync-answer", mcpToken: "fixture" });
    const events: any[] = [];
    session.subscribe((event: any) => { events.push(event); if (event.type === "permission_requested") void session.respondToPermission(event.id, "allow"); });
    await session.startTurn("hello");
    await until(new Promise<void>((resolve) => { const poll = () => events.some((event) => event.type === "turn_completed") ? resolve() : setTimeout(poll, 10); poll(); }), 5000).catch(() => assert.fail(`${name}: the turn never completed after an immediate allow`));
    assert.ok(events.some((event) => event.type === "permission_resolved" && event.decision === "allow"), name);
    await session.close();
  }
});

// A real Codex turn on s68 said "the project list tool call was rejected": Codex asks with an MCP elicitation, which the
// adapter did not answer. JAgentChill's own server is accepted at once; another MCP server's question goes to the person.
test("Codex MCP elicitation: JAgentChill's own tools are accepted; another server's elicitation becomes a permission", async () => {
  const client = new CodexRuntimeClient(fake);
  const own = await client.createSession({ mcpUrl: "http://127.0.0.1:18930/agent-tools/mcp?session=e1", mcpToken: "fixture" });
  const ownEvents: any[] = []; own.subscribe((event) => ownEvents.push(event));
  await own.startTurn("elicit-own");
  await until(new Promise<void>((resolve) => { const poll = () => ownEvents.some((event) => event.type === "turn_completed") ? resolve() : setTimeout(poll, 10); poll(); }));
  const reply = ownEvents.filter((event) => event.type === "assistant_text_delta").map((event) => event.text).join("");
  assert.equal(reply, 'elicitation:{"action":"accept","content":{"approve":true}}');
  assert.equal(ownEvents.some((event) => event.type === "permission_requested"), false, "nobody is asked about JAgentChill's own tools");
  await own.close();
  const other = await client.createSession({});
  const otherEvents: any[] = []; other.subscribe((event) => otherEvents.push(event));
  await other.startTurn("elicit-other");
  await until(new Promise<void>((resolve) => { const poll = () => otherEvents.some((event) => event.type === "permission_requested") ? resolve() : setTimeout(poll, 10); poll(); }));
  await other.respondToPermission("elicit-1", "deny");
  await until(new Promise<void>((resolve) => { const poll = () => otherEvents.some((event) => event.type === "turn_completed") ? resolve() : setTimeout(poll, 10); poll(); }));
  assert.equal(otherEvents.filter((event) => event.type === "assistant_text_delta").map((event) => event.text).join(""), 'elicitation:{"action":"decline"}');
  await other.close();
});

// OpenCode runs over ACP and lists its models (the free OpenCode Zen ones included) as the "model" select of the
// session's configOptions; the app showed only "Agent default" and could not pick glm-5.3-flash-free.
test("ACP models: the catalogue is the agent's model select, and a chosen model is set on the session", async () => {
  assert.deepEqual((await new AcpRuntimeClient(resolve(import.meta.dirname, "fixtures/fake-acp-agent.mjs")).catalog()).models, [{ id: "default", label: "Agent default", isDefault: true }], "an agent that is not asked to list its models is not started for it");
  const client = new AcpRuntimeClient(resolve(import.meta.dirname, "fixtures/fake-acp-agent.mjs"), ["--acp"], { listModels: true });
  const catalog = await client.catalog();
  assert.deepEqual(catalog.models, [
    { id: "opencode/big-pickle", label: "Big Pickle", isDefault: true },
    { id: "opencode/glm-5.3-flash-free", label: "GLM 5.3 Flash Free" },
    { id: "opencode/deepseek-v4.1-flash-free", label: "DeepSeek V4.1 Flash Free" },
  ]);
  const session = await client.createSession({ model: "opencode/glm-5.3-flash-free" });
  const events: any[] = []; session.subscribe((event) => events.push(event));
  await session.startTurn("which-model");
  await until(new Promise<void>((resolve) => { const poll = () => events.some((event) => event.type === "turn_completed") ? resolve() : setTimeout(poll, 10); poll(); }));
  assert.equal(events.filter((event) => event.type === "assistant_text_delta").map((event) => event.text).join(""), 'model:{"sessionId":"acp-fixture","configId":"model","value":"opencode/glm-5.3-flash-free"}');
  await session.close();
});

// Gemini was left running once per catalogue refresh: an agent that never answers is stopped when the time is up.
test("ACP model list: an agent that never answers is given up after the time limit and is not left running", async () => {
  const marker = `jc-silent-agent-${process.pid}-${Date.now()}`;
  const client = new AcpRuntimeClient(process.execPath, ["-e", `/* ${marker} */ setInterval(() => {}, 1e9)`], { listModels: true });
  const started = Date.now();
  assert.deepEqual((await client.catalog()).models, [{ id: "default", label: "Agent default", isDefault: true }]);
  assert.ok(Date.now() - started < 30_000, `gave up after ${Date.now() - started} ms`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const { execFileSync } = await import("node:child_process");
  const left = (() => { try { return execFileSync("pgrep", ["-f", marker], { encoding: "utf8" }).trim(); } catch { return ""; } })();
  assert.equal(left, "", "the agent process is gone");
});
