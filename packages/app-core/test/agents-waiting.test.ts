// The chat timeline around a question and during a wait (brief w7-chat items 2 and 3), from the events the host relays
// for a turn of an agent CLI: \`lifecycle\` start, \`thinking\`, \`tool\` start/result, \`compaction\`, and the answer's text
// as increments of \`chat.stream\`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyChatEvent, emptyChat, reconcileChatRun, withCards, withUserMessage, type ChatEvent, type ChatItem, type ChatState } from "../src/index.ts";

const LEAD = "Before I go on I need your confirmation of abc.", AFTER = "Thanks — you confirmed. I am going on.";
const ev = (ts_ms: number, name: string, payload: Record<string, unknown>): ChatEvent => ({ event: `jagentchill.${name}`, ts_ms, payload: { sessionKey: "s", runId: "r1", ...payload } });
const fold = (chat: ChatState, events: ChatEvent[]) => events.reduce(applyChatEvent, chat);
const rows = (items: ChatItem[]) => items.map((item) => (item.kind === "assistant" ? `text:${item.text}` : item.kind === "tool" ? `tool:${item.name}` : item.kind === "card" ? "card" : item.kind === "user" ? "user" : item.kind));
const toolStart = (ts: number, id = "t1", name = "jc_session_ask") => ev(ts, "chat.activity", { stream: "tool", data: { phase: "start", name, toolCallId: id, args: {} } });
const toolResult = (ts: number, id = "t1", name = "jc_session_ask") => ev(ts, "chat.activity", { stream: "tool", data: { phase: "result", name, toolCallId: id, result: { ok: true } } });
const delta = (ts: number, deltaText: string, length: number, replace = false) => ev(ts, "chat.stream", { state: "delta", deltaText, length, ...(replace ? { replace: true } : {}) });
const started = () => withUserMessage(emptyChat(), "u1", "Please do abc", { ts_ms: 1000 });
const CARD = [{ id: "question-q1", ts_ms: 2100 }];

test("a host-started proposal follow-up ends when the host reports no live run, even if its final event was missed", () => {
  // Proposal acceptance writes a host outcome note, which starts a second turn without chat.send from the pane.
  const afterProposal = applyChatEvent(emptyChat(), ev(20_000, "chat.turn.pending", { reason: "host" }));
  assert.equal(afterProposal.running, true);
  const before = applyChatEvent(afterProposal, ev(20_100, "chat.stream", { state: "status", runId: "proposal-follow-up" }));
  assert.deepEqual([before.running, before.turn?.wait], [true, "host"]);
  // On reconnect, the snapshot restores a run whose start event was missed. Without a later terminal event, old
  // event-only state stays at "Starting the agent…" indefinitely.
  const missedStart = reconcileChatRun(emptyChat(), ["proposal-follow-up"], 20_100);
  assert.deepEqual([missedStart.running, missedStart.turn?.wait], [true, "starting"]);
  const closed = reconcileChatRun(missedStart, [], 50_000);
  assert.deepEqual([closed.running, closed.runId, closed.turn], [false, null, undefined]);
  const endedByHost = applyChatEvent({ ...before, runId: "proposal-follow-up" }, ev(40_000, "chat.turn.ended", { runId: "proposal-follow-up", state: "final" }));
  assert.deepEqual([endedByHost.running, endedByHost.runId, endedByHost.turn], [false, null, undefined]);
  assert.equal(applyChatEvent({ ...before, runId: "newer-run" }, ev(40_000, "chat.turn.ended", { runId: "proposal-follow-up" })).running, true, "a late end cannot close a newer run");
  const joined = reconcileChatRun(emptyChat(), ["host-follow-up"], 60_000);
  assert.deepEqual([joined.running, joined.runId, joined.turn?.wait], [true, "host-follow-up", "starting"]);
  assert.equal(reconcileChatRun(joined, undefined), joined, "absence of the membership field remains unknown");
});

test("Order around a question — an increment that arrives AFTER the tool call's start (increments are throttled) completes the row above the tool; it is not a second piece of text below the question", () => {
  let chat = fold(started(), [delta(1880, "Before I go on I need your confirmat", 36), toolStart(2000), delta(2010, "ion of abc.", 47)]);
  assert.deepEqual(rows(withCards(chat.items, CARD)), ["user", `text:${LEAD}`, "tool:jc_session_ask", "card"]);
  // The next message of the model starts on a new line: that one goes below.
  chat = fold(chat, [toolResult(9010), delta(11000, `\n\n${AFTER}`, 47 + 2 + AFTER.length)]);
  assert.deepEqual(rows(withCards(chat.items, CARD)), ["user", `text:${LEAD}`, "tool:jc_session_ask", "card", `text:${AFTER}`]);
});

test("No blank state of a live turn: from the wire's events the turn always knows what it waits for — starting, the model, a tool, the person's answer, the answer sent, compacting — until text or the end", () => {
  const wait = (chat: ChatState) => (chat.turn?.thinking ? "thinking" : chat.turn?.wait ?? (chat.running ? "writing" : "idle"));
  let chat = started();
  const seen: string[] = [wait(chat)];
  const feed = (...events: ChatEvent[]) => { for (const event of events) { chat = applyChatEvent(chat, event); assert.ok(!chat.running || chat.turn, `a running turn has its state after ${event.event}`); if (seen.at(-1) !== wait(chat)) seen.push(wait(chat)); } };
  feed(ev(1100, "chat.stream", { state: "status" }), ev(1400, "chat.activity", { stream: "lifecycle", data: { phase: "start" } }), ev(2000, "chat.activity", { stream: "thinking", data: { delta: "hm" } }), delta(3000, "Looking.", 8),
    toolStart(3100, "t0", "jc_timeline_snapshot"), toolResult(3900, "t0", "jc_timeline_snapshot"), toolStart(4000), ev(4100, "chat.question.requested", { question: { sessionKey: "s", state: "pending" } }));
  assert.equal(chat.turn?.wait, "your-answer");
  feed(ev(9000, "chat.question.resolved", { question: { sessionKey: "s", state: "answered" } }));
  assert.deepEqual([chat.turn?.wait, chat.turn?.wait_since_ms], ["answer-sent", 9000], "from the moment the answer is submitted");
  // The result of the question's own call: the answer is still "sent".
  feed(toolResult(9010), ev(9030, "chat.stream", { state: "status" }));
  assert.equal(chat.turn?.wait, "answer-sent", "until the next token or tool step");
  feed(ev(11000, "chat.activity", { stream: "compaction", data: { phase: "start" } }), ev(16000, "chat.activity", { stream: "compaction", data: { phase: "end", completed: true } }), delta(17000, "\n\nGoing on.", 19));
  assert.equal(chat.turn?.wait, undefined, "text ends the wait");
  feed(ev(18000, "chat.stream", { state: "final", message: { content: [{ type: "text", text: "Looking.\n\nGoing on." }] } }));
  assert.deepEqual(seen, ["starting", "model", "thinking", "writing", "tool", "model", "tool", "your-answer", "answer-sent", "compacting", "model", "writing", "idle"]);
  assert.equal(chat.turn, undefined);
});

test("A turn the host starts (the person answered after the question's call stopped holding): `chat.turn.pending` makes the turn alive at once with the words for it; the runtime's first reports keep them; a turn that does not come takes them back", () => {
  let chat: ChatState = { ...emptyChat(), items: [{ kind: "assistant", id: "a0", text: "I will wait for your answer.", ts_ms: 900 }] };
  chat = applyChatEvent(chat, ev(5000, "chat.turn.pending", { reason: "answer", runId: undefined }));
  assert.deepEqual([chat.running, chat.turn?.wait, chat.turn?.started_ms], [true, "answer-sent", 5000]);
  chat = fold(chat, [ev(6400, "chat.stream", { state: "status" }), ev(7000, "chat.activity", { stream: "lifecycle", data: { phase: "start" } })]);
  assert.deepEqual([chat.running, chat.turn?.wait, chat.turn?.started_ms], [true, "answer-sent", 5000]);
  chat = applyChatEvent(chat, delta(9000, "Thanks.", 7));
  assert.equal(chat.turn?.wait, undefined);
  // Decision on a card, any other word of the host.
  assert.equal(applyChatEvent(emptyChat(), ev(1, "chat.turn.pending", { reason: "decision" })).turn?.wait, "decision-sent");
  assert.equal(applyChatEvent(emptyChat(), ev(1, "chat.turn.pending", { reason: "host" })).turn?.wait, "host");
  // Cancelled before the runtime reported anything.
  const cancelled = fold(emptyChat(), [ev(1, "chat.turn.pending", { reason: "answer", runId: undefined }), ev(2, "chat.turn.pending", { cancelled: true, runId: undefined })]);
  assert.deepEqual([cancelled.running, cancelled.turn], [false, undefined]);
  // A turn that is already running is not restarted by it.
  const running = applyChatEvent(started(), ev(2000, "chat.turn.pending", { reason: "host" }));
  assert.deepEqual([running.turn?.wait, running.turn?.started_ms], ["starting", 1000]);
});
