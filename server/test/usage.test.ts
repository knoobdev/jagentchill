// The agent runtimes in these tests are the FAKES of `harness.ts`: turns and their usage events are scripted here.
// "API-key provider" turns run on Codex signed in with an API key (billed per call); "plan" turns on Claude Code signed
// in with a personal subscription (`generation/billing.ts`).
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { USAGE_CSV_COLUMNS, USAGE_METHOD_SCOPES } from "@jagentchill/protocol";
import { SAMPLE_MODELS, createHarness, model, tick, type Harness } from "./harness.ts";
// The run view's own "Raise budget" (pure: no React, no imports) — the test drives the host with what the screen sends.
import { raiseOnHost } from "../../apps/app/src/workflows/budgetStop.ts";

// A test that fails before it closes its server must not keep the run alive.
const open: Harness[] = [];
afterEach(() => { for (const h of open.splice(0)) { try { h.close(); } catch { /* already closed by the test */ } } });
type Device = Awaited<ReturnType<Harness["pair"]>>;
const ACME = { runtimeId: "codex", providerId: "openai", modelId: "gpt-x" };
const SMALL = { runtimeId: "codex", providerId: "openai", modelId: "gpt-small" };
const CLAUDE = { runtimeId: "claude-code", providerId: "anthropic", modelId: "sonnet" };
const MODELS = { ...SAMPLE_MODELS, codex: [model("gpt-x", { isDefault: true, contextWindow: 200_000 }), model("gpt-small")] };
/** gpt-x has a list price; gpt-small has none. */
const price = (ref: { modelId: string }) => (ref.modelId === "gpt-x" ? { inputPerMillionUsd: 3, outputPerMillionUsd: 15, cachedInputPerMillionUsd: 0.3, source: "admin" as const } : undefined);

async function setup(opts: Parameters<typeof createHarness>[0] = {}) {
  // Codex on an API key: its turns are billed per call.
  const h = await createHarness({ models: MODELS, ...opts, commands: { "codex login status": { code: 0, stdout: "Logged in using an API key - sk-proj-***\n", stderr: "", timedOut: false } }, extra: { modelPrice: price, ...opts.extra } });
  open.push(h);
  const admin = await h.pair("Studio Mac", "admin");
  return { h, admin };
}
const create = async (device: Device, ref: object = ACME, extra: object = {}) => (await device.call("jagentchill.session.create", { ref, ...extra })).session.sessionKey as string;
/** Waits for what the server does after an event, however busy the machine is. */
async function until(done: () => boolean, what: string): Promise<void> {
  for (let n = 0; n < 400; n++) { if (done()) return; await tick(10); }
  throw new Error(`timed out waiting for ${what}`);
}
const closed = (h: Harness, sessionKey: string, runId: string) => until(() => (h.app.db.prepare("SELECT open FROM usage_records WHERE session_key = ? AND run_id = ?").get(sessionKey, runId) as { open: number } | undefined)?.open === 0, "the turn's record to close").then(() => tick(15));
type Usage = { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
const asEvent = (usage: Usage) => ({ inputTokens: usage.input, outputTokens: usage.output, cacheReadTokens: usage.cacheRead, cacheWriteTokens: usage.cacheWrite });
/** One turn as the runtime reports it: sent, usage reported, then the end of the turn. */
async function turn(h: Harness, device: Device, sessionKey: string, usage: Usage | null, state: "final" | "error" | "aborted" = "final") {
  const sent = await device.call("jagentchill.chat.send", { sessionKey, message: "A long private prompt about the Da Lat film" });
  if (usage) h.fake.usage(sessionKey, asEvent(usage));
  h.fake.endTurn(sessionKey, sent.runId, state);
  await closed(h, sessionKey, sent.runId);
  return sent.runId as string;
}
const usageOf = async (device: Device, sessionKey: string) => (await device.call("jagentchill.usage.session.get", { sessionId: sessionKey })).session;
const range = { from_ms: Date.now() - 30 * 86_400_000, to_ms: Date.now() + 86_400_000 };
const query = (device: Device, groupBy: string[], extra: object = {}) => device.call("jagentchill.usage.query", { groupBy, ...range, ...extra });

test("Completed turn on an API-key provider; Duplicate terminal event; No content stored", async () => {
  const { h, admin } = await setup();
  const key = await create(admin);
  const runId = await turn(h, admin, key, { input: 12_000, cacheRead: 3_000, output: 800 });
  // The end of the turn is reported a second time (the runtime, then its process).
  h.fake.endTurn(key, runId);
  await tick(30);
  const session = await usageOf(admin, key);
  assert.equal(session.records.length, 1);
  const [record] = session.records;
  assert.deepEqual([record.inputTokens, record.cachedInputTokens, record.outputTokens], [12_000, 3_000, 800]);
  assert.deepEqual([record.tokenSource, record.billing, record.outcome, record.costSource, record.priceSource], ["reported", "api", "completed", "estimated", "admin"]);
  // 12 000 × $3 + 3 000 × $0.30 + 800 × $15, per million tokens.
  assert.equal(record.costUsd, 0.0489);
  assert.equal(record.deviceId, admin.device.deviceId);
  assert.equal(h.app.db.prepare("SELECT COUNT(*) AS n FROM usage_records").get()!.n, 1);
  for (const table of ["usage_records", "usage_rollups", "budget_commits"]) {
    assert.doesNotMatch(JSON.stringify(h.app.db.prepare(`SELECT * FROM ${table}`).all()), /Da Lat|private prompt/);
  }
  h.close();
});

test("Running turn; Sub-agent finishes", async () => {
  const { h, admin } = await setup();
  const key = await create(admin);
  await admin.call("jagentchill.usage.subscribe", { sessionKeys: [key] });
  const sent = await admin.call("jagentchill.chat.send", { sessionKey: key, message: "go" });
  // Three requests of one turn: their tokens add up.
  for (let n = 0; n < 3; n++) h.fake.usage(key, { inputTokens: 1000, outputTokens: 10 });
  await tick();
  // The open record follows the stream, and the session is announced at most once per two seconds while it runs.
  assert.equal((await usageOf(admin, key)).inputTokens, 3000);
  const live = admin.events.filter((event) => event.event === "jagentchill.usage.updated");
  assert.equal(live.length, 1);
  h.fake.endTurn(key, sent.runId);
  await until(() => admin.events.filter((event) => event.event === "jagentchill.usage.updated").length >= 2, "the terminal usage event");
  const events = admin.events.filter((event) => event.event === "jagentchill.usage.updated");
  assert.equal(events.length, 2);
  // An event names the session and its root and carries no amount.
  assert.deepEqual(events[1].payload, { sessionId: key, rootSessionId: key });
  h.close();
});

test("Runtime reports nothing; Model without a price; Unpriced model; Mixed total; Accuracy flag", async () => {
  const { h, admin } = await setup();
  const priced = await create(admin);
  await turn(h, admin, priced, { input: 1000, output: 100 });
  const unpriced = await create(admin, SMALL);
  await turn(h, admin, unpriced, { input: 500, output: 50 });
  await turn(h, admin, unpriced, { input: 500, output: 50 });
  const silent = await create(admin, SMALL);
  await turn(h, admin, silent, null);
  const nothing = (await usageOf(admin, silent)).records[0];
  assert.deepEqual([nothing.tokenSource, nothing.costSource, nothing.inputTokens, nothing.costUsd], ["none", "unknown", undefined, undefined]);
  const session = await usageOf(admin, unpriced);
  // Tokens are counted; the cost is unknown, never zero, and the turns are named beside the total.
  assert.deepEqual([session.inputTokens, session.unknownCostTurns, session.accuracy, session.records[0].priceSource, session.records[0].costUsd], [1000, 2, "partial", "none", undefined]);
  const byModel = await query(admin, ["model"]);
  const small = byModel.rows.find((row: any) => row.keys[0] === "gpt-small"), large = byModel.rows.find((row: any) => row.keys[0] === "gpt-x");
  assert.deepEqual([small.accuracy, small.agent.unknownCostTurns, small.unpricedTurns, small.agent.unreportedTurns], ["partial", 3, 2, 1]);
  assert.deepEqual([large.accuracy, large.agent.unknownCostTurns], ["estimated", 0]);
  assert.equal(byModel.totals.totalCostUsd, large.totalCostUsd);
  assert.equal(byModel.totals.accuracy, "partial");
  h.close();
});

test("Subscription CLI; Plan-billed turns", async () => {
  const { h, admin } = await setup();
  await admin.call("jagentchill.provider.budget.set", { budget: { scope: "global", limitUsd: 1, period: "month" } });
  const key = await create(admin, CLAUDE);
  // A CLI on its own subscription reports its tokens and no cost.
  for (let n = 0; n < 3; n++) await turn(h, admin, key, { input: 2, output: 4, cacheRead: 64_556, cacheWrite: 25_904 });
  const session = await usageOf(admin, key);
  const [record] = session.records;
  assert.deepEqual([record.billing, record.costSource, record.costUsd, record.tokenSource, record.cachedInputTokens], ["plan", "included", 0, "reported", 64_556]);
  assert.deepEqual([session.includedTurns, session.accuracy, session.agentCostUsd], [3, "reported", 0]);
  // Plan-billed turns move no budget; the budget says how many turns it does not count.
  const { budgets } = await admin.call("jagentchill.provider.budget.list", {});
  assert.deepEqual([budgets[0].spentUsd, budgets[0].uncountedTurns, budgets[0].exhausted], [0, 3, false]);
  h.close();
});

test("Stop mid-turn; the runtime's process dies", async () => {
  const { h, admin } = await setup();
  const key = await create(admin);
  await turn(h, admin, key, { input: 6_000, output: 300 }, "aborted");
  const stopped = await usageOf(admin, key);
  assert.deepEqual([stopped.records[0].outcome, stopped.inputTokens, stopped.outputTokens, stopped.turns.cancelled], ["cancelled", 6_000, 300, 1]);
  // The runtime's process dies during a turn: the open record is closed as failed with its last update.
  const sent = await admin.call("jagentchill.chat.send", { sessionKey: key, message: "go" });
  h.fake.usage(key, { inputTokens: 900, outputTokens: 40 });
  await tick();
  h.fake.emit(key, { type: "turn_failed", turnId: sent.runId, code: "137", diagnostic: "Process exited (code=137)" });
  await closed(h, key, sent.runId);
  const after = await usageOf(admin, key);
  assert.deepEqual(after.records.map((record: any) => [record.outcome, record.inputTokens]), [["cancelled", 6_000], ["failed", 900]]);
  assert.deepEqual(after.turns, { completed: 0, cancelled: 1, failed: 1 });
  assert.equal(h.app.db.prepare("SELECT COUNT(*) AS n FROM usage_records WHERE open = 1").get()!.n, 0);
  h.close();
});

test("Runtime switch keeps totals; Fork starts at zero; Rewind does not refund", async () => {
  const { h, admin } = await setup();
  const key = await create(admin);
  await turn(h, admin, key, { input: 50_000, output: 0 });
  await admin.call("jagentchill.session.runtime.switch", { sessionKey: key, ref: CLAUDE, idempotencyKey: "s1" });
  await turn(h, admin, key, { input: 10, output: 20 });
  await turn(h, admin, key, { input: 10, output: 20 });
  const session = await usageOf(admin, key);
  assert.equal(session.turns.completed, 3);
  assert.deepEqual(session.byRuntime.map((row: any) => row.keys[0]).sort(), ["claude-code", "codex"]);
  const fork = (await admin.call("jagentchill.session.fork", { sessionKey: key })).session.sessionKey;
  assert.deepEqual([(await usageOf(admin, fork)).totalTokens, (await usageOf(admin, fork)).records.length], [0, 0]);
  // Usage that was spent stays counted whatever happens to the conversation.
  assert.equal((await usageOf(admin, key)).totalTokens, session.totalTokens);
  h.close();
});

test("Lead with two peers; Detached child", async () => {
  const { h, admin } = await setup();
  const lead = await create(admin);
  const peers = [await create(admin), await create(admin)];
  // The agents a session starts are recorded by the server with their parent.
  for (const peer of peers) h.app.db.prepare("UPDATE agent_sessions SET parent_session_key = ?, origin = 'agent' WHERE session_key = ?").run(lead, peer);
  const spend = (input: number) => ({ input, output: 0 });
  // $0.20, $0.50 and $0.30 at $3 per million input tokens.
  await turn(h, admin, lead, spend(66_667));
  await turn(h, admin, peers[0], spend(166_667));
  await turn(h, admin, peers[1], spend(100_000));
  const { node } = await admin.call("jagentchill.usage.tree.get", { rootSessionId: lead });
  assert.deepEqual([node.own.costUsd, node.subtree.costUsd, node.sharePct], [0.200001, 1.000002, 100]);
  assert.deepEqual(node.children.map((child: any) => [child.sessionKey, child.subtree.costUsd, child.sharePct]), [[peers[0], 0.500001, 50], [peers[1], 0.3, 30]]);
  // A child that leaves the tree keeps what it spent there and starts a root of its own.
  h.app.db.prepare("UPDATE agent_sessions SET parent_session_key = NULL, origin = 'device' WHERE session_key = ?").run(peers[1]);
  await turn(h, admin, peers[1], spend(1000));
  assert.equal((await admin.call("jagentchill.usage.tree.get", { rootSessionId: lead })).node.subtree.costUsd, 1.000002);
  assert.equal((await admin.call("jagentchill.usage.tree.get", { rootSessionId: peers[1] })).node.own.inputTokens, 1000);
  h.close();
});

test("Group by provider across both sources; Too many dimensions; Other sessions", async () => {
  const { h, admin } = await setup();
  const mine = await create(admin);
  await turn(h, admin, mine, { input: 1000, output: 100 });
  const editor = await h.pair("Phone", "editor");
  const theirs = await create(editor);
  await turn(h, editor, theirs, { input: 400, output: 40 });
  const byProvider = await query(editor, ["provider"]);
  // Usage of a session the device may not read is part of the provider's row, without the session's identity.
  assert.deepEqual(byProvider.rows.map((row: any) => [row.keys[0], row.agent.inputTokens, row.generation.calls]), [["openai", 1400, 0]]);
  assert.equal(typeof byProvider.timeZone, "string");
  const bySession = await query(editor, ["session"]);
  assert.deepEqual(bySession.rows.map((row: any) => [row.keys[0], row.labels[0], row.agent.inputTokens]).sort(), [[theirs, "A long private prompt about the Da Lat film", 400], ["", "Other sessions", 1000]].sort());
  assert.equal((await query(admin, ["session"])).rows.length, 2);
  assert.equal((await editor.fail("jagentchill.usage.session.get", { sessionId: mine })).code, "NOT_FOUND");
  assert.equal((await admin.fail("jagentchill.usage.query", { groupBy: ["provider", "runtime", "model", "day"], ...range })).code, "INVALID_PARAMS");
  assert.equal((await admin.fail("jagentchill.usage.query", { groupBy: ["day"], from_ms: 10, to_ms: 5 })).code, "INVALID_PARAMS");
  h.close();
});

test("Lifetime survives deletion; Day boundary; Retention purge; Reset agent usage", async () => {
  let now = Date.now();
  const { h, admin } = await setup({ now: () => now });
  const dayOf = (ms: number) => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
  // Ten seconds before and ten seconds after midnight of the host's own time zone.
  const key = await create(admin);
  const late = new Date(now); late.setHours(23, 59, 50, 0);
  now = late.getTime();
  await turn(h, admin, key, { input: 1000, output: 0 });
  now += 20_000;
  await turn(h, admin, key, { input: 2000, output: 0 });
  const history = () => admin.call("jagentchill.usage.history.get", { from_day: "2026-01-01", to_day: "2027-12-31" });
  const first = await history();
  assert.deepEqual(first.rollups.map((rollup: any) => [rollup.day, rollup.inputTokens, rollup.turns]), [[dayOf(now - 20_000), 1000, 1], [dayOf(now), 2000, 1]]);
  assert.notEqual(first.rollups[0].day, first.rollups[1].day);
  assert.deepEqual([first.lifetime.turns, first.lifetime.costUsd], [2, 0.009]);
  // Deleting the session and passing the retention period take the records; rollups and the lifetime total keep them.
  await admin.call("jagentchill.session.delete", { sessionKey: key });
  const today = now;
  now += 25 * 30.5 * 86_400_000;
  assert.equal(h.app.usage.purge(), 2);
  assert.equal((await admin.call("jagentchill.usage.query", { groupBy: ["day"], from_ms: now - 799 * 86_400_000, to_ms: now })).rows.length, 0);
  const kept = await history();
  assert.deepEqual([kept.rollups.length, kept.lifetime.costUsd], [2, 0.009]);
  // A reset starts usage from zero and leaves what budgets have counted this period.
  now = today;
  await admin.call("jagentchill.provider.budget.set", { budget: { scope: "global", limitUsd: 50, period: "month" } });
  const fresh = await create(admin);
  await turn(h, admin, fresh, { input: 1_000_000, output: 0 });
  const spent = (await admin.call("jagentchill.provider.budget.list", {})).budgets[0].spentUsd;
  assert.ok(spent >= 3);
  assert.equal((await admin.fail("jagentchill.usage.history.reset", { scope: "agent" })).code, "INVALID_PARAMS");
  await admin.call("jagentchill.usage.history.reset", { confirm: true, scope: "agent" });
  const after = await history();
  assert.deepEqual([after.rollups.length, after.lifetime.turns], [0, 0]);
  assert.equal((await admin.call("jagentchill.provider.budget.list", {})).budgets[0].spentUsd, spent);
  assert.equal(h.audit("usage.history.reset")[0].actor, `device:${admin.device.deviceId}`);
  h.close();
});

test("Meter after a turn; Near the limit; After a model change", async () => {
  const { h, admin } = await setup();
  const key = await create(admin);
  await turn(h, admin, key, { input: 150_000, output: 900 });
  assert.deepEqual((await usageOf(admin, key)).context, { usedTokens: 150_000, maxTokens: 200_000, pct: 75, source: "reported", model: "gpt-x", updated_ms: (await usageOf(admin, key)).context.updated_ms });
  await turn(h, admin, key, { input: 100_000, cacheRead: 92_000, output: 10 });
  assert.equal((await usageOf(admin, key)).context.pct, 96);
  // On another model the old figure says nothing: the meter is empty until the next turn reports.
  await admin.call("jagentchill.session.control.set", { sessionKey: key, ref: SMALL });
  assert.deepEqual((await usageOf(admin, key)).context, { source: "unknown" });
  h.close();
});

test("Send refused before the turn; Client skips the budget check; Session budget", async () => {
  const { h, admin } = await setup();
  const key = await create(admin);
  await admin.call("jagentchill.provider.budget.set", { budget: { scope: "session", scopeId: key, limitUsd: 0.05, period: "total" } });
  assert.deepEqual(await admin.call("jagentchill.usage.budget.check", { sessionKey: key }), { blocked: false });
  await turn(h, admin, key, { input: 20_000, output: 0 });
  // $0.06 spent of $0.05: the check says so, and a device that skips the check is refused by the relay all the same.
  const check = await admin.call("jagentchill.usage.budget.check", { sessionKey: key });
  assert.deepEqual([check.blocked, check.error.code, check.error.details.scope, check.error.details.overUsd], [true, "BUDGET_EXCEEDED", "session", 0.01]);
  const sends = h.fake.callsOf("startTurn").length;
  const refused = await admin.fail("jagentchill.chat.send", { sessionKey: key, message: "again" });
  assert.deepEqual([refused.code, refused.message, refused.details.scope], ["BUDGET_EXCEEDED", "Budget reached — session", "session"]);
  assert.equal(h.fake.callsOf("startTurn").length, sends);
  // The tool endpoint asks the same question for a tool call of that session.
  assert.throws(() => h.app.usage.assertBudget(key), /Budget reached/);
  // Raising the budget is an admin's action and lets the session go on; another session was never affected.
  const editor = await h.pair("Phone", "editor");
  assert.equal((await editor.fail("jagentchill.provider.budget.set", { budget: { scope: "session", scopeId: key, limitUsd: 5, period: "total" } })).code, "SCOPE_DENIED");
  await admin.call("jagentchill.provider.budget.set", { budget: { scope: "session", scopeId: key, limitUsd: 5, period: "total" } });
  await admin.call("jagentchill.chat.send", { sessionKey: key, message: "again" });
  h.close();
});

test("Unpriced model under a hard-stop budget; Unpriced model allowed", async () => {
  const { h, admin } = await setup();
  const key = await create(admin, SMALL);
  await admin.call("jagentchill.provider.budget.set", { budget: { scope: "global", limitUsd: 20, period: "month" } });
  const check = await admin.call("jagentchill.usage.budget.check", { sessionKey: key });
  assert.deepEqual([check.blocked, check.error.details.reason, check.error.message], [true, "unpriced_model", "gpt-small has no price and a spending limit is active"]);
  assert.equal((await admin.fail("jagentchill.chat.send", { sessionKey: key, message: "go" })).details.reason, "unpriced_model");
  assert.equal(h.fake.callsOf("startTurn").length, 0);
  await admin.call("jagentchill.provider.budget.set", { budget: { scope: "global", limitUsd: 20, period: "month", allowUnknownCost: true } });
  await turn(h, admin, key, { input: 500, output: 5 });
  const [budget] = (await admin.call("jagentchill.provider.budget.list", {})).budgets;
  assert.deepEqual([budget.spentUsd, budget.includesUnpriced], [0, true]);
  h.close();
});

test("Records export; Formula-like title; Editor and device names; Viewer", async () => {
  const { h, admin } = await setup();
  const key = await create(admin, ACME, { title: "=SUM(A1:A9)" });
  await turn(h, admin, key, { input: 1000, output: 100 });
  const plan = await create(admin, CLAUDE);
  await turn(h, admin, plan, { input: 5, output: 5 });
  const unknown = await create(admin, SMALL);
  await turn(h, admin, unknown, { input: 7, output: 7 });
  const download = async (device: Device) => {
    const exported = await device.call("jagentchill.usage.export", { query: { groupBy: ["day"], ...range }, detail: "records", idempotencyKey: "x" });
    const target = `/jagentchill/v1/usage/exports/${exported.blobSha256}`;
    const res = await fetch(h.base + target, { headers: device.device.signedHeaders(device.offer.gatewayId, "GET", target, undefined) });
    // The bytes as they travel: a text decoder would drop the byte-order mark.
    return { exported, text: Buffer.from(await res.arrayBuffer()).toString("utf8") };
  };
  const { exported, text } = await download(admin);
  assert.deepEqual([exported.rowCount, exported.truncated], [3, false]);
  assert.match(exported.fileName, /^jagentchill-usage-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/);
  assert.ok(text.startsWith("﻿") && text.endsWith("\r\n"));
  const lines = text.slice(1).trimEnd().split("\r\n").map((line) => line.split(","));
  assert.deepEqual(lines[0], [...USAGE_CSV_COLUMNS]);
  const column = (name: string) => lines[0].indexOf(name);
  const row = (title: string) => lines.find((line) => line[column("session_title")] === title)!;
  // A title that looks like a formula is made plain text.
  assert.ok(row("'=SUM(A1:A9)"));
  assert.equal(row("'=SUM(A1:A9)")[column("device_name")], "Studio Mac");
  const planRow = lines.find((line) => line[column("billing")] === "plan")!, unknownRow = lines.find((line) => line[column("model")] === "gpt-small")!;
  assert.deepEqual([planRow[column("cost_usd")], planRow[column("cost_source")]], ["0", "included"]);
  // An unknown cost is an empty cell, never a zero.
  assert.deepEqual([unknownRow[column("cost_usd")], unknownRow[column("cost_source")]], ["", "unknown"]);
  // A viewer reads usage and exports it; names of devices and of sessions it may not read stay on the host.
  const viewer = await h.pair("Guest", "viewer");
  const seen = (await download(viewer)).text.slice(1).trimEnd().split("\r\n").map((line) => line.split(","));
  assert.ok(seen.slice(1).every((line) => line[column("device_name")] === "" && line[column("session_title")] === ""));
  assert.equal((await viewer.fail("jagentchill.usage.history.reset", { confirm: true, scope: "agent" })).code, "SCOPE_DENIED");
  assert.equal((await viewer.fail("jagentchill.usage.budget.check", { sessionKey: key })).code, "SCOPE_DENIED");
  h.close();
});

test("Plan usage: off until an admin turns it on; only the CLIs' own sign-ins report plan limits", async () => {
  const { h, admin } = await setup();
  assert.deepEqual(await admin.call("jagentchill.usage.plan.list", {}), { enabled: false, providers: [] });
  const editor = await h.pair("Phone", "editor");
  assert.equal((await editor.fail("jagentchill.settings.host.patch", { patch: { "usage.planUsageAll": true } })).code, "SCOPE_DENIED");
  await admin.call("jagentchill.settings.host.patch", { patch: { "usage.planUsageAll": true } });
  assert.equal(h.audit("usage.planUsage.enable").length, 1);
  // No runtime but a CLI's own sign-in reports plan limits; the test host holds no CLI sign-in to read.
  const listed = await admin.call("jagentchill.usage.plan.list", {});
  assert.deepEqual([listed.enabled, listed.providers], [true, []]);
  h.close();
});

test("Ownership test is exact; Unlisted method", async () => {
  const { h } = await setup();
  const served = [...h.app.methods.keys()].filter((name) => name.startsWith("jagentchill.usage.") || name.startsWith("jagentchill.provider.budget.")).sort();
  assert.deepEqual(served, Object.keys(USAGE_METHOD_SCOPES).sort());
  assert.equal(served.filter((name) => name.startsWith("jagentchill.usage.")).length, 10);
  for (const name of served) assert.equal(h.app.methods.get(name)!.scope, USAGE_METHOD_SCOPES[name as keyof typeof USAGE_METHOD_SCOPES]);
  h.close();
});

test("Budgets during a run: Raise budget never lowers a limit another admin raised a moment ago — the run view's Raise budget is ONE raise-only call the host decides against the limit it holds then; whichever order two admins' changes arrive in, the higher limit stands; for a provider, the host-wide, a project and a session budget; a removed budget is not put back", async () => {
  const { h, admin } = await setup();
  const other = await h.pair("Office PC", "admin"), editor = await h.pair("Edit bay", "editor");
  const key = await create(admin);
  const limits = async () => Object.fromEntries(((await admin.call("jagentchill.provider.budget.list", {})).budgets as Array<{ scope: string; scopeId?: string; limitUsd: number; period: string; hardStop: boolean }>).map((b) => [`${b.scope}:${b.scopeId ?? ""}`, b.limitUsd]));
  /** What the run view's device sends, as a failure with a code when the host refuses (the app's connection does the same). */
  const send = (device: Device) => async (method: string, params: unknown) => { const error = await device.raw(method, params); if (!error.ok) throw Object.assign(new Error(error.error.message), { code: error.error.code }); return error.result; };
  for (const scope of [{ scope: "provider", scopeId: "openai" }, { scope: "global" }, { scope: "project", scopeId: "prj_film" }, { scope: "session", scopeId: key }] as Array<{ scope: string; scopeId?: string }>) {
    const name = `${scope.scope}:${scope.scopeId ?? ""}`, period = scope.scope === "project" || scope.scope === "session" ? "total" : "month";
    await admin.call("jagentchill.provider.budget.set", { budget: { ...scope, limitUsd: 0.01, period, hardStop: true, allowUnknownCost: true } });
    // The screen shows $0.01 and has "5" typed. Another admin's $50 reaches the host AFTER everything this screen
    // has read and BEFORE anything it writes: that is where a read-then-write on the device loses the $50.
    const interleaved = async (method: string, params: unknown) => {
      if (method !== "jagentchill.provider.budget.list") await other.call("jagentchill.provider.budget.set", { budget: { ...scope, limitUsd: 50, period, hardStop: true, allowUnknownCost: true } });
      return send(admin)(method, params);
    };
    const met = await raiseOnHost(interleaved, scope, 5);
    assert.equal((await limits())[name], 50, `${name}: the $50 the other admin set stands`);
    assert.deepEqual([met.kind, met.kind === "not_higher" && met.current.limitUsd], ["not_higher", 50], "and the screen is told the limit the host holds");
    // Sent at the same moment, in both orders: the higher limit is the one that is left.
    await Promise.all([raiseOnHost(send(admin), scope, 60), raiseOnHost(send(other), scope, 80)]);
    assert.equal((await limits())[name], 80);
    await Promise.all([raiseOnHost(send(other), scope, 120), raiseOnHost(send(admin), scope, 90)]);
    assert.equal((await limits())[name], 120);
    // A real raise keeps everything else of the budget, and says so.
    const raised = await raiseOnHost(send(admin), scope, 150);
    assert.deepEqual([raised.kind, raised.kind === "raised" && [raised.budget.limitUsd, raised.budget.period, raised.budget.hardStop, raised.budget.allowUnknownCost]], ["raised", [150, period, true, true]]);
    // The same amount is not a raise; a device that may not change settings cannot raise.
    assert.equal((await raiseOnHost(send(admin), scope, 150)).kind, "not_higher");
    assert.equal((await editor.fail("jagentchill.provider.budget.raise", { ...scope, toUsd: 500 })).code, "SCOPE_DENIED");
    // Removed by the other admin meanwhile: nothing is put back.
    await other.call("jagentchill.provider.budget.remove", scope);
    assert.equal((await raiseOnHost(send(admin), scope, 500)).kind, "gone");
    assert.equal((await limits())[name], undefined);
  }
  assert.deepEqual(h.audit("budget.raise").map((row: any) => [row.scope, row.fromUsd, row.limitUsd]).slice(0, 4), [["provider", 50, 60], ["provider", 60, 80], ["provider", 80, 120], ["provider", 120, 150]]);
  h.close();
});
