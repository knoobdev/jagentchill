import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelRef, OrcRoleConfig } from "@jagentchill/protocol";
import {
  activitySummary, addFallback, clockOf, detailRows, revealStep, titleParts, toolCallOf, toolOutcomeOf, withCards, type ChatItem, type ToolItem, applyChatEvent, blockedReason, blocksOf, browserRows, costLabel, deleteRefusal, draftModel, emptyChat, extraBodyCounter, fallbackChoices, groupedRoles, initialView,
  itemsFromHistory, listedModes, messageLength, meterTone, tokensShort, withCompactions, nextRequest, noRuntimeReady, profileProblems, pushRecent, rowModels, searchModels, sendOutcome, sendPlan, splitHandover, thinkingChoice, toggleFavourite, withDefault,
  withProfile, withUserMessage, type BrowserGroup, type BrowserModel, type ModelCatalogue, type OrcRoleView,
} from "../src/index.ts";

const caps = (over: Record<string, unknown> = {}) => ({
  jcTools: "native", jcToolsOnly: true, nativeToolCoverage: true, steer: true, queueModes: ["steer", "followup", "interrupt"], productModes: {}, liveModeChange: true, thinking: true,
  attachments: { image: true, document: false, audio: false, video: false }, resume: true, fork: true, importSessions: false, usage: "tokens",
  approvals: "host", questions: true, compaction: "host", subAgents: true, pty: false, skills: "token", proxy: "no", ...over,
}) as BrowserGroup["capabilities"];
const model = (runtimeId: string, providerId: string, modelId: string, over: Partial<BrowserModel> = {}): BrowserModel => ({
  providerId, modelId, label: modelId, isDefault: false, input: ["text"], supportsTools: true, thinkingOptions: [], supportsFastMode: false, readiness: "ready", source: "discovered",
  ref: { runtimeId, providerId, modelId }, capabilities: caps(), ...over,
});
const mode = (id: string, over: Record<string, unknown> = {}) => ({ id, label: id, description: "", icon: "", colorTier: "safe" as const, isUnattended: false, productMode: id as "ask", supported: true, ...over });
const group = (runtimeId: string, kind: "cli", providers: Array<[string, BrowserModel[]]>, over: Partial<BrowserGroup> = {}): BrowserGroup => ({
  runtimeId, kind, label: runtimeId === "opencode" ? "OpenCode" : runtimeId === "claude-code" ? "Claude Code" : runtimeId === "codex" ? "Codex" : runtimeId, status: "ready", readiness: "ready", order: runtimeId === "opencode" ? 0 : 10,
  capabilities: caps(), defaultModeId: "edit", modes: [mode("ask"), mode("plan"), mode("edit"), mode("auto"), mode("unattended", { isUnattended: true, productMode: undefined })], features: [],
  requiresFullAccess: false, providers: providers.map(([providerId, models]) => ({ providerId, label: providerId === "anthropic" ? "Anthropic" : providerId, connected: true, models })), ...over,
});
const policy = { canSelect: true };
const sonnetCli = model("claude-code", "anthropic", "claude-sonnet-5");
const catalogue: ModelCatalogue = {
  policy,
  groups: [
    group("opencode", "cli", [["anthropic", [model("opencode", "anthropic", "claude-sonnet-5"), model("opencode", "anthropic", "claude-haiku-5")]], ["openrouter", [model("opencode", "openrouter", "gpt-6-astra")]], ["local-stub", [model("opencode", "local-stub", "stub-chat")]]]),
    group("claude-code", "cli", [["anthropic", [sonnetCli, model("claude-code", "anthropic", "claude-opus-5", { isDefault: true })]]]),
    group("codex", "cli", [["openai", [model("codex", "openai", "gpt-6-astra")]]], { order: 20 }),
  ],
};
const ref = (m: BrowserModel): ModelRef => m.ref;

// chat-agent — Requirement: Model browser
test("Model browser — Scenario: All view lists every group", () => {
  const rows = browserRows(catalogue);
  assert.equal(rows.length, 5, "one row per runtime and provider");
  assert.deepEqual(rows.map((row) => `${row.title}/${row.subtitle}:${row.count}:${row.method}`), ["OpenCode/Anthropic:2:cli", "OpenCode/openrouter:1:cli", "OpenCode/local-stub:1:cli", "Claude Code/Anthropic:2:cli", "Codex/openai:1:cli"]);
  assert.deepEqual(initialView(rows, sonnetCli.ref, [sonnetCli.ref]), { view: "all" }, "the current model is a favourite: All");
});
test("Model browser — Scenario: Initial view with a non-favourite model", () => {
  assert.deepEqual(initialView(browserRows(catalogue), sonnetCli.ref, []), { view: "group", rowId: "claude-code/anthropic", back: true });
});
test("Model browser — Scenario: Single group", () => {
  const single: ModelCatalogue = { policy, groups: [catalogue.groups[1]] };
  assert.deepEqual(initialView(browserRows(single), null, []), { view: "group", rowId: "claude-code/anthropic", back: false });
});
test("Model browser — Scenario: Favourite a model", () => {
  const starred = toggleFavourite([], sonnetCli.ref);
  assert.deepEqual(starred, [sonnetCli.ref]);
  const row = browserRows(catalogue).find((entry) => entry.id === "claude-code/anthropic")!;
  assert.equal(rowModels(row, "", toggleFavourite([], ref(row.provider!.models[1])))[0].modelId, "claude-opus-5", "favourites sort first while nothing is searched");
  assert.deepEqual(toggleFavourite(starred, sonnetCli.ref), []);
  assert.equal(pushRecent([1, 2, 3, 4, 5, 6].map((n) => ({ runtimeId: "opencode", providerId: "p", modelId: `m${n}` })), sonnetCli.ref).length, 5, "the last 5 distinct models");
  assert.equal(pushRecent([sonnetCli.ref], sonnetCli.ref).length, 1);
});
test("Model browser — Scenario: Cross-runtime search", () => {
  const found = searchModels(catalogue, "Sonnet");
  assert.deepEqual(found.map((entry) => `${entry.group.label}/${entry.model.modelId}`), ["OpenCode/claude-sonnet-5", "Claude Code/claude-sonnet-5"]);
  assert.equal(searchModels(catalogue, "codex").length, 1, "the runtime label matches too");
});
test("Model browser — Scenario: No match", () => assert.equal(searchModels(catalogue, "zzz").length, 0));

// agent-runtimes — Requirement: Model readiness
test("Model readiness — Scenario: Signed-out CLI in the browser", () => {
  const signedOut = group("codex", "cli", [["openai", [model("codex", "openai", "gpt-6-astra", { readiness: "needs-auth" })]]], { readiness: "needs-auth", status: "unavailable" });
  assert.deepEqual(blockedReason(signedOut, signedOut.providers[0].models[0], policy, "admin"), { text: "Sign in required", action: "sign-in" });
  assert.deepEqual(blockedReason(group("copilot", "cli", [], { readiness: "needs-install" }), null, policy, "admin"), { text: "Not installed", action: "install" });
});
test("Model readiness — Scenario: Unsupported pair", () => {
  const copilot = group("copilot", "cli", [["github", [model("copilot", "github", "x", { readiness: "unsupported" })]]], { label: "Copilot" });
  assert.equal(blockedReason(copilot, copilot.providers[0].models[0], policy, "admin")?.text, "Not available on Copilot");
  assert.equal(blockedReason(copilot, model("copilot", "github", "y", { readiness: "cooldown" }), policy, "admin"), null, "a model in cooldown stays selectable");
});
// agent-runtimes — Requirement: Who can configure and who can select
test("Who can configure and who can select — Scenario: Editor on a default host", () => {
  assert.equal(blockedReason(catalogue.groups[1], sonnetCli, policy, "editor"), null, "an editor selects a CLI runtime: there is no admin-only runtime class");
  assert.equal(blockedReason(catalogue.groups[0], catalogue.groups[0].providers[0].models[0], policy, "editor"), null, "models of every runtime stay selectable");
  assert.equal(draftModel(catalogue, sonnetCli.ref, "editor")?.ref.runtimeId, "claude-code", "the remembered model is proposed");
  assert.equal(blockedReason(catalogue.groups[0], null, { canSelect: false, reason: "Viewers cannot select a runtime" }, "editor")?.text, "Viewers cannot select a runtime", "the host's policy is followed");
  const fullAccess = { ...catalogue.groups[1], requiresFullAccess: true };
  assert.deepEqual(listedModes(fullAccess, { role: "editor" }).map((entry) => entry.id), ["ask", "plan", "edit", "auto"], "the unattended mode is listed for admin devices only");
  assert.equal(listedModes(fullAccess, { role: "admin" }).at(-1)?.id, "unattended");
  assert.equal(listedModes(catalogue.groups[1], { role: "admin" }).some((entry) => entry.isUnattended), false, "a runtime that never runs host commands has no unattended mode");
});
test("Who can configure and who can select — Scenario: Viewer", () => assert.equal(blockedReason(catalogue.groups[0], null, policy, "viewer")?.text, "Viewers cannot select a runtime"));
// agent-runtimes — Requirement: Offline and no-runtime states
test("Offline and no-runtime states — Scenario: First run with nothing configured", () => {
  const fresh: ModelCatalogue = { policy, groups: [group("opencode", "cli", [], { readiness: "needs-auth", status: "unavailable" }), group("copilot", "cli", [], { readiness: "needs-install", status: "unavailable" })] };
  assert.equal(noRuntimeReady(fresh), true);
  assert.equal(draftModel(fresh, null, "admin"), null);
  assert.equal(noRuntimeReady(catalogue), false);
  assert.equal(noRuntimeReady({ policy, groups: [group("codex", "cli", [], { readiness: "loading", status: "loading" })] }), false, "a snapshot still loading is never shown as nothing ready");
  assert.equal(draftModel(catalogue, null, "admin")?.ref.runtimeId, "opencode", "the first ready model in the host's order");
  assert.equal(draftModel(catalogue, sonnetCli.ref, "admin")?.ref.runtimeId, "claude-code", "the remembered model");
});

// chat-agent — Requirement: Composer layout and controls
test("Composer layout and controls — Scenario: Length limit", () => {
  assert.deepEqual(messageLength("x".repeat(32_500)), { counter: "32,500 / 32,000", over: true });
  assert.deepEqual(messageLength("x".repeat(29_999)), { counter: null, over: false });
  assert.deepEqual(messageLength("x".repeat(30_000)), { counter: "30,000 / 32,000", over: false });
});
// chat-agent — Requirement: Steer, queue and interrupt while running
test("Steer, queue and interrupt while running — Scenario: Interrupt setting", () => {
  assert.deepEqual(sendPlan("interrupt"), { primary: "interrupt", alternate: "followup" });
  assert.deepEqual(sendPlan("steer"), { primary: "steer", alternate: "interrupt" });
  assert.deepEqual(sendPlan("queue"), { primary: "followup", alternate: "steer" });
});
test("Steer, queue and interrupt while running — Scenario: Runtime cannot steer", () => {
  assert.deepEqual(sendOutcome({ delivered: true, effective: "followup", downgradedFrom: "steer", reason: "This runtime cannot take messages mid-turn" }, "Claude Code"), { restore: false, notice: "Claude Code cannot take messages mid-turn", chip: "Will send after this turn" });
  let chat = withUserMessage(emptyChat(), "u1", "first");
  chat = applyChatEvent(chat, { event: "jagentchill.chat.stream", payload: { runId: "r1", state: "delta", message: { content: [{ type: "text", text: "wor" }] } } });
  chat = withUserMessage(chat, "u2", "use a warmer grade", { queued: true });
  assert.deepEqual(chat.queued, [{ id: "u2", text: "use a warmer grade" }]);
  chat = applyChatEvent(chat, { event: "jagentchill.chat.stream", payload: { runId: "r1", state: "final", message: { content: [{ type: "text", text: "working done" }] } } });
  assert.equal(chat.queued.length, 0, "the queued message starts its own turn when the running one ends");
  assert.equal(chat.running, true);
});
test("Steer, queue and interrupt while running — Scenario: Turn changed before the steer arrived", () => {
  assert.deepEqual(sendOutcome({ delivered: false, effective: "none", reason: "turn-changed" }, "Claude Code"), { restore: true, notice: "The agent's turn changed before your message arrived", chip: null });
});
// chat-agent — Requirement: Stop a running turn
test("Stop a running turn — Scenario: Stop during streaming text", () => {
  let chat = withUserMessage(emptyChat(), "u1", "write");
  chat = applyChatEvent(chat, { event: "jagentchill.chat.activity", ts_ms: 1000, payload: { runId: "r1", stream: "tool", data: { toolCallId: "t1", name: "mcp__jagentchill__jc_echo", phase: "start" } } });
  chat = applyChatEvent(chat, { event: "jagentchill.chat.stream", payload: { runId: "r1", state: "delta", message: { content: [{ type: "text", text: "partial te" }] } } });
  assert.equal(chat.running, true);
  assert.equal(chat.items.some((item) => item.kind === "status"), false, "no Stopped line before the runtime acknowledges");
  chat = applyChatEvent(chat, { event: "jagentchill.chat.stream", ts_ms: 3000, payload: { runId: "r1", state: "aborted" } });
  assert.equal(chat.running, false);
  assert.deepEqual(chat.items.map((item) => (item.kind === "tool" ? `tool:${item.status}` : item.kind === "status" ? `status:${item.text}` : `${item.kind}:${(item as { text: string }).text}`)), ["user:write", "tool:cancelled", "assistant:partial te", "status:Stopped"]);
});
// chat-agent — Requirement: Tool call rendering and lifecycle / Collapsible activity groups
test("Tool call rendering and lifecycle — Scenario: a call runs, then completes or fails", () => {
  let chat = emptyChat();
  const tool = (id: string, phase: string, ts: number, isError?: boolean) => ({ event: "jagentchill.chat.activity", ts_ms: ts, payload: { stream: "tool", data: { toolCallId: id, name: "Bash", phase, isError } } });
  chat = applyChatEvent(chat, tool("a", "start", 0));
  chat = applyChatEvent(chat, tool("a", "result", 72_000));
  chat = applyChatEvent(chat, tool("b", "start", 72_000));
  assert.equal(activitySummary(blocksOf(chat.items)[0].kind === "activity" ? (blocksOf(chat.items)[0] as { steps: never[] }).steps : [], true).text, "Working · 2 steps");
  chat = applyChatEvent(chat, tool("b", "result", 72_200, true));
  const blocks = blocksOf(chat.items);
  assert.equal(blocks.length, 1, "consecutive tool calls form one group");
  assert.deepEqual(activitySummary((blocks[0] as { steps: never[] }).steps, false), { text: "Worked for 1m 12s · 2 steps", failed: 1 });
});
test("Collapsible activity groups — Scenario: history keeps text, tool calls and their results in order", () => {
  const items = itemsFromHistory([
    { role: "user", content: [{ type: "text", text: "<chat-history-summary>\nSession: A\nItems: 6\n\nUser: hi\n</chat-history-summary>\n\nWhich markers?" }] },
    { role: "assistant", content: [{ type: "thinking", thinking: "look" }, { type: "text", text: "Checking." }, { type: "toolcall", id: "c1", name: "mcp__jagentchill__jc_echo", arguments: { text: "kiwi" } }] },
    { role: "toolResult", toolCallId: "c1", content: [{ type: "text", text: "kiwi" }] },
    { role: "assistant", content: [{ type: "text", text: "kiwi" }] },
    { role: "system", content: "hidden" },
  ]);
  assert.deepEqual(items.map((item) => item.kind), ["user", "reasoning", "assistant", "tool", "assistant"]);
  assert.deepEqual([items[0].kind === "user" && items[0].text, items[0].kind === "user" && items[0].handoverItems], ["Which markers?", 6]);
  assert.equal(items[3].kind === "tool" && items[3].output, "kiwi");
});
// chat-agent — Requirement: Switch runtime or provider mid-conversation
test("Switch runtime or provider mid-conversation — Scenario: Carried context is visible", () => {
  assert.deepEqual(splitHandover("<chat-history-summary>\nSession: S\nItems: 4\n\nUser: a\n</chat-history-summary>\n\nnext"), { text: "next", handoverItems: 4 });
  assert.deepEqual(splitHandover("plain"), { text: "plain" });
  const chat = withUserMessage(emptyChat(), "u", "next", { handoverItems: 4 });
  assert.equal(chat.items[0].kind === "user" && chat.items[0].handoverItems, 4);
});
// chat-agent — Requirement: Session insights and usage
test("Session insights and usage — Scenario: a runtime that reports nothing is never shown as zero", () => {
  assert.equal(costLabel({ reported: false, cost: null }), "Not reported");
  assert.equal(costLabel({ reported: true, cost: null }), "Tokens only");
  assert.equal(costLabel({ reported: true, cost: 0.0412 }), "est. $0.0412");
});

// orc-model-routing
const role = (id: string, label: string, groupId: OrcRoleView["group"]): OrcRoleView => ({ id, label, description: "", capability: "llm", group: groupId, builtin: true, state: "not_configured", taskRoutes: [], profiles: [] });
test("ORC settings page — Scenario: Search roles", () => {
  const roles = [role("director", "Director", "creative"), role("voice-tts", "Voice", "generation"), role("voice-design", "Voice design", "generation"), role("supervisor", "Supervisor", "coordination")];
  assert.deepEqual(groupedRoles(roles, "voice").flatMap((entry) => entry.roles.map((item) => item.id)), ["voice-tts", "voice-design"]);
  assert.deepEqual(groupedRoles(roles, "").map((entry) => entry.label), ["Coordination", "Agents", "Generation"]);
});
const profile = (id: string) => ({ id, provider: "local-stub", model: "stub-chat", params: {}, enabled: true });
let config: OrcRoleConfig = { enabled: true, profiles: [], routes: {}, limits: {} };
config = withProfile(withProfile(withProfile(config, profile("main")), profile("backup")), profile("quality"));
test("Role cards — Scenario: Change the default profile", () => {
  assert.equal(config.defaultProfileId, "main", "the first profile is the default and serves the default route");
  assert.equal(config.routes.default.primary.profileId, "main");
  const changed = withDefault(config, "quality");
  assert.equal(changed.defaultProfileId, "quality");
  assert.equal(changed.routes.default.primary.profileId, "quality");
});
test("Role cards — Scenario: Delete a profile used by a route", () => {
  const routed: OrcRoleConfig = { ...config, routes: { ...config.routes, "image.panel": { primary: { profileId: "backup" }, fallbacks: [] } } };
  assert.equal(deleteRefusal(routed, "backup"), "Used by route Panel");
  assert.equal(deleteRefusal(routed, "quality"), null);
  assert.match(deleteRefusal(routed, "main") ?? "", /Used by route Default/);
});
test("Route rows — Scenario: Add a fallback", () => {
  const route = addFallback(config.routes.default, "backup");
  assert.deepEqual(route.fallbacks, [{ profileId: "backup" }]);
  assert.deepEqual(fallbackChoices(config, route).map((entry) => entry.id), ["quality"]);
  assert.equal(nextRequest(route, (id) => id !== "main"), "backup", "Next request: <first healthy fallback>");
  assert.equal(nextRequest(route, () => true), null);
});
test("Route rows — Scenario: Fallback limit", () => {
  let route = config.routes.default;
  for (const id of ["a", "b", "c", "d", "e", "f"]) route = addFallback(route, id);
  assert.equal(route.fallbacks.length, 5, "up to 5 fallbacks");
});
test("Profile modal — Scenario: Extra body counter", () => {
  const body = JSON.stringify({ x: "y".repeat(8992) });
  assert.equal(new TextEncoder().encode(body).length, 9000);
  assert.deepEqual(extraBodyCounter(body), { text: "9,000 / 8,192 bytes", over: true });
  assert.ok(profileProblems({ id: "main", label: "Main", provider: "p", model: "m", extraBody: body }, [], false).extraBody, "Save is disabled");
  assert.deepEqual(profileProblems({ id: "main", label: "Main", provider: "p", model: "m", extraBody: "" }, [], false), {});
  assert.ok(profileProblems({ id: "main", label: "", provider: "", model: "", extraBody: "" }, ["main"], false).id);
});

// chat-agent — the stream carries the whole text of the turn, also after a tool call.
test("Text written before a tool call stays whole above the call and is not repeated below it", () => {
  const SAID = "Mình sẽ xem timeline trước rồi thêm đoạn text vào bên dưới video.";
  const stream = (state: string, text: string) => ({ event: "jagentchill.chat.stream", payload: { runId: "r9", state, message: { content: [{ type: "text", text }] } } });
  const tool = (phase: string) => ({ event: "jagentchill.chat.activity", ts_ms: 1, payload: { runId: "r9", stream: "tool", data: { toolCallId: "t9", name: "mcp__jagentchill__jc_timeline_snapshot", phase } } });
  let chat = emptyChat();
  for (const event of [stream("delta", "Mìn"), stream("delta", SAID), tool("start"), tool("result"), stream("delta", `${SAID}\n\nXong.`), stream("final", `${SAID}\n\nXong.`)]) chat = applyChatEvent(chat, event);
  assert.deepEqual(chat.items.map((item) => (item.kind === "assistant" ? item.text : item.kind)), [SAID, "tool", "Xong."]);
  assert.equal(chat.running, false);
});

test("Thinking control — Hidden for a single option; Remembered per model; the default is used until one is chosen", () => {
  const levels = (ids: string[]) => ids.map((id) => ({ id, label: id }));
  const a = model("claude-code", "anthropic", "a", { thinkingOptions: levels(["off", "low", "high"]), defaultThinkingOptionId: "low" });
  const b = model("claude-code", "anthropic", "b", { thinkingOptions: levels(["off", "medium"]) });
  assert.equal(thinkingChoice(model("claude-code", "anthropic", "one", { thinkingOptions: levels(["off"]) }), "off"), null, "one option: no control");
  assert.equal(thinkingChoice(null, "high"), null);
  const remembered: Record<string, string> = { "claude-code/anthropic/a": "high" };
  assert.equal(thinkingChoice(a, remembered["claude-code/anthropic/a"]), "high", "the draft shows what was set on model A");
  assert.equal(thinkingChoice(b, remembered["claude-code/anthropic/b"]), "off", "model B has no default and none remembered: its first option");
  assert.equal(thinkingChoice(a, undefined), "low", "the model's default");
  assert.equal(thinkingChoice(b, "high"), "off", "an option the model does not offer is not shown");
});

test("Context meter — colour steps at 70 % and 90 %, short token counts", () => {
  assert.deepEqual([0, 69, 70, 89, 90, 100].map(meterTone), ["normal", "normal", "warning", "warning", "danger", "danger"]);
  assert.deepEqual([950, 12_400, 51_000, 200_000, 1_200_000].map(tokensShort), ["950", "12.4k", "51k", "200k", "1.2M"]);
});

test("Context compaction marker — Automatic compaction: the divider sits at that point and earlier rows remain", () => {
  const items = [
    { kind: "user" as const, id: "u1", text: "one", ts_ms: 100 }, { kind: "assistant" as const, id: "a1", text: "1", ts_ms: 110 },
    { kind: "user" as const, id: "u2", text: "two", ts_ms: 300 }, { kind: "assistant" as const, id: "a2", text: "2", streaming: true },
  ];
  const marked = withCompactions(items, [{ id: 7, ts_ms: 200, reason: "auto", tokensBefore: 51_000, tokensAfter: 9_000 }], (entry) => `compacted ${entry.tokensBefore} → ${entry.tokensAfter}`);
  assert.deepEqual(marked.map((item) => item.id), ["u1", "a1", "compaction-7", "u2", "a2"]);
  assert.equal((marked[2] as { text: string }).text, "compacted 51000 → 9000");
  assert.deepEqual(withCompactions(items, [{ id: 8, ts_ms: 900, reason: "manual", tokensBefore: null, tokensAfter: null }], () => "c").map((item) => item.id).at(-1), "compaction-8", "a compaction after the last row closes the timeline");
  assert.equal(withCompactions(items, [], () => ""), items);
});

// chat-agent — owner bugs 2026-10-07: streaming, card order, work log
test("Streaming — increments are appended, a missed one is noticed and resynced, the end drops the live text", () => {
  const delta = (seq: number, deltaText: string, length: number, extra: object = {}) => ({ event: "jagentchill.chat.stream", ts_ms: seq, payload: { runId: "r1", state: "delta", seq, deltaText, length, ...extra } });
  let chat = applyChatEvent(emptyChat(), delta(1, "Hel", 3));
  chat = applyChatEvent(chat, delta(2, "lo", 5));
  assert.equal((chat.items[0] as { text: string }).text, "Hello");
  assert.equal((chat.items[0] as { fresh?: boolean }).fresh, true);
  // seq 3 (" wor", length 9) never arrives
  chat = applyChatEvent(chat, delta(4, "ld", 11));
  assert.equal(chat.gap, true, "the length after the increment does not match");
  assert.equal((chat.items[0] as { text: string }).text, "Hello", "nothing wrong is shown meanwhile");
  chat = applyChatEvent(chat, delta(4, "Hello world", 11, { replace: true }));
  assert.equal(chat.gap, false);
  assert.equal((chat.items[0] as { text: string }).text, "Hello world");
  chat = applyChatEvent(chat, { event: "jagentchill.chat.stream", ts_ms: 9, payload: { runId: "r1", state: "final", message: { content: [{ type: "text", text: "Hello world!" }] } } });
  assert.equal(chat.live, undefined);
  assert.deepEqual([(chat.items[0] as { text: string }).text, chat.running], ["Hello world!", false]);
});

test("Streaming — the text is revealed at an even pace: a large piece does not jump in, the end is not held back", () => {
  const text = "x".repeat(2000);
  let shown = 0, frames = 0, biggest = 0;
  while (shown < text.length && frames < 2000) { const next = revealStep(text, shown, 16, false); biggest = Math.max(biggest, next - shown); shown = next; frames++; }
  assert.ok(frames > 30, `a 2000 character piece takes many frames (${frames})`);
  assert.ok(biggest <= 80, `no frame adds more than a few words (${biggest})`);
  assert.ok(frames * 16 < 4000, "and it is all there within a few seconds");
  assert.equal(revealStep("ab", 2, 16, true), 2);
  assert.equal(revealStep("a😀b", 1, 1, false), 3, "a surrogate pair is never split");
});

test("Streaming — a live stream is never shown more than about 100 ms late: the screen keeps up with what has arrived", () => {
  // 300 characters a second in pieces of 23 every 76 ms (a real Claude Code turn), one frame every 16 ms.
  let arrived = 0, shown = 0, worst = 0; const text = "x".repeat(3000); const reached: number[] = [];
  for (let ms = 0; ms <= 12_000 && shown < text.length; ms += 16) {
    arrived = Math.min(text.length, Math.floor(ms / 76) * 23);
    shown = revealStep(text.slice(0, arrived), Math.min(shown, arrived), 16, false);
    reached.push(shown);
    // How long ago the text now on screen had arrived.
    const since = reached.findIndex((_, index) => Math.min(text.length, Math.floor((index * 16) / 76) * 23) >= shown);
    if (ms > 1000 && arrived < text.length) worst = Math.max(worst, ms - since * 16);
  }
  assert.ok(worst <= 180, `the reader is at most a piece and ~100 ms behind (${worst} ms)`);
});

test("Streaming — while the model thinks the turn says so: since when, how many tokens, the thought when the runtime reports it; text ends it", () => {
  let chat = withUserMessage(emptyChat(), "u1", "hello", { ts_ms: 1000 });
  assert.deepEqual(chat.turn, { started_ms: 1000, wait: "starting", wait_since_ms: 1000 });
  chat = applyChatEvent(chat, { event: "jagentchill.chat.activity", ts_ms: 3000, payload: { runId: "r1", stream: "thinking", data: { progressTokens: 12 } } });
  chat = applyChatEvent(chat, { event: "jagentchill.chat.activity", ts_ms: 4000, payload: { runId: "r1", stream: "thinking", data: { progressTokens: 40 } } });
  assert.deepEqual(chat.turn, { started_ms: 1000, thinking: { since_ms: 3000, tokens: 40 } });
  chat = applyChatEvent(chat, { event: "jagentchill.chat.activity", ts_ms: 4100, payload: { runId: "r1", stream: "thinking", data: { delta: "First, " } } });
  chat = applyChatEvent(chat, { event: "jagentchill.chat.activity", ts_ms: 4200, payload: { runId: "r1", stream: "thinking", data: { text: "First, the cut.", delta: "the cut." } } });
  assert.equal(chat.turn?.thinking?.text, "First, the cut.");
  chat = applyChatEvent(chat, { event: "jagentchill.chat.stream", ts_ms: 5000, payload: { runId: "r1", state: "delta", seq: 1, deltaText: "A J-cut", length: 7 } });
  assert.deepEqual(chat.turn, { started_ms: 1000 });
  chat = applyChatEvent(chat, { event: "jagentchill.chat.stream", ts_ms: 6000, payload: { runId: "r1", state: "final", message: { content: [{ type: "text", text: "A J-cut" }] } } });
  assert.equal(chat.turn, undefined);
  // A thinking event that arrives after the turn ended starts nothing.
  assert.equal(applyChatEvent(chat, { event: "jagentchill.chat.activity", ts_ms: 6100, payload: { runId: "r1", stream: "thinking", data: { progressTokens: 50 } } }).running, false);
});

test("Card order — a card stands where it happened; what the agent writes afterwards is below it", () => {
  const items: ChatItem[] = [
    { kind: "user", id: "u1", text: "make it", ts_ms: 100 },
    { kind: "assistant", id: "a1", text: "One question first.", started_ms: 110, ts_ms: 300, runId: "r1" },
    { kind: "tool", id: "t1", name: "jc_session_ask", status: "completed", started_ms: 120, ended_ms: 200 },
    { kind: "assistant", id: "a2", text: "Thanks, doing it.", started_ms: 210, streaming: true, runId: "r1" },
    { kind: "tool", id: "t2", name: "jc_text_add", status: "running" },
  ];
  const order = withCards(items, [{ id: "proposal-p", ts_ms: 400 }, { id: "question-q", ts_ms: 125 }]).map((item) => item.id);
  assert.deepEqual(order, ["u1", "a1", "t1", "question-q", "a2", "t2", "proposal-p"]);
  assert.deepEqual(blocksOf(withCards(items, [{ id: "question-q", ts_ms: 125 }])).map((block) => block.kind), ["item", "item", "activity", "item", "item", "activity"]);
});

test("Work log — the call's plain name, its arguments as lines, its outcome from the envelope", () => {
  const call = toolCallOf({ name: "mcp__jagentchill__jc_clip_split", input: JSON.stringify({ elementIds: ["e1"], times: [360_000] }) });
  assert.deepEqual([call.tool, titleParts(call.args).time, titleParts(call.args).count], ["jc_clip_split", "00:03", 1]);
  assert.equal(toolCallOf({ name: "mcp__jagentchill__jc_text_add", input: "{\"content\":\"Hi\"}" }).tool, "jc_text_add");
  assert.equal(clockOf(8_700_000), "01:12.5");
  const done = toolOutcomeOf(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ ok: true, data: { elementId: "e9" }, warnings: [], summary: "Added text" }) }] }));
  assert.deepEqual([done.ok, done.summary], [true, "Added text"]);
  const failed = toolOutcomeOf(JSON.stringify({ ok: false, warnings: [], error: { code: "NOT_FOUND", message: "No such clip." } }), true);
  assert.deepEqual([failed.ok, failed.error], [false, { code: "NOT_FOUND", message: "No such clip." }]);
  assert.equal(toolOutcomeOf("plain words").text, "plain words");
  assert.deepEqual(detailRows({ elementIds: ["e1", "e2"], start: 360_000, ripple: true, style: { fontSize: 40 } }).rows.map((row) => `${row.label}=${row.value}`), ["Element ids=e1, e2", "Start=00:03", "Ripple=yes", "Style=fontSize: 40"]);
  const chat = applyChatEvent(emptyChat(), { event: "jagentchill.chat.activity", ts_ms: 5, payload: { stream: "tool", data: { toolCallId: "f", name: "jc_frame_render", phase: "result", result: { content: [{ type: "text", text: "{}" }, { type: "image", data: "QUJD", mimeType: "image/jpeg" }] } } } });
  const tool = chat.items[0] as { images?: string[]; output?: string };
  assert.deepEqual(tool.images, ["data:image/jpeg;base64,QUJD"]);
  assert.ok(!tool.output?.includes("QUJD"), "the picture is kept beside the text, not inside it");
});

test("Streaming — a status event in the middle of a turn leaves the text standing", () => {
  let chat = applyChatEvent(emptyChat(), { event: "jagentchill.chat.stream", ts_ms: 1, payload: { runId: "r1", state: "delta", seq: 1, deltaText: "Hello", length: 5 } });
  chat = applyChatEvent(chat, { event: "jagentchill.chat.stream", ts_ms: 2, payload: { runId: "r1", state: "status" } });
  chat = applyChatEvent(chat, { event: "jagentchill.chat.stream", ts_ms: 3, payload: { runId: "r1", state: "delta", seq: 2, deltaText: " again", length: 11 } });
  assert.deepEqual([(chat.items[0] as { text: string }).text, chat.gap, chat.running], ["Hello again", false, true]);
});

test("work log: details show what was asked and what changed, technical fields only under raw data", () => {
  const asked = { content: "Hi", idempotencyKey: "k-1", elementId: "e1", elementIds: ["e1"], trackId: "t1", start: 360_000, style: { fontSize: 40, id: "s1" } };
  assert.deepEqual(detailRows(asked, { plain: true }).rows.map((row) => `${row.label}=${row.value}`), ["Content=Hi", "Start=00:03", "Style=fontSize: 40"]);
  assert.ok(detailRows(asked).rows.some((row) => row.label === "Idempotency key"), "raw rows keep every field");
  assert.deepEqual(detailRows({ elementId: "e9", revision: 4, name: "Intro", kind: "text" }, { plain: true }).rows.map((row) => row.key), ["name", "kind"]);
});
