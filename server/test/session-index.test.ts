// The index of a whole session (brief w7-chat-2, B1 + B5): the steps and the searchable messages of a transcript that a
// pane only loads the newest page of. The transcript here is MADE UP (a table of this file, served in pages the way the
// Gateway's `chat.history` serves them: `offset` = how many of the newest to skip); no Gateway and no model runs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createSessionIndex, indexMessages, searchIndex, type HistoryPage } from "../src/agents/session-index.ts";

/** `turns` turns: a person's message, an assistant message with a tool call, the tool's result, the answer. */
function transcript(turns: number): unknown[] {
  const out: unknown[] = [];
  for (let n = 1; n <= turns; n++) {
    out.push({ role: "user", content: [{ type: "text", text: `Question ${n}: what about scene ${n}?` }], timestamp: n * 1000, id: `u${n}` });
    out.push({ role: "assistant", content: [{ type: "text", text: `Looking at scene ${n}.` }, { type: "toolCall", id: `call-${n}`, name: "jc_timeline_snapshot", arguments: { sceneId: `s${n}` } }], timestamp: n * 1000 + 1, id: `a${n}` });
    out.push({ role: "toolResult", toolCallId: `call-${n}`, isError: n % 50 === 0, content: [{ type: "text", text: `scene ${n} has ${n} clips` }], id: `r${n}` });
    out.push({ role: "assistant", content: [{ type: "text", text: n === 7 ? "The LANTERN shot is the seventh." : `Scene ${n} is fine.` }], timestamp: n * 1000 + 2, id: `f${n}` });
  }
  return out;
}
function served(all: () => unknown[], paged = true) {
  const reads: Array<{ limit: number; offset?: number }> = [];
  const read = async (_key: string, params: { limit: number; offset?: number }): Promise<HistoryPage> => {
    reads.push({ limit: params.limit, ...(params.offset !== undefined ? { offset: params.offset } : {}) });
    const list = all();
    // A transcript the engine does not page answers the newest page whatever the offset, and says nothing about more.
    if (!paged) return { messages: list.slice(-params.limit) };
    const offset = params.offset ?? 0, end = list.length - offset, start = Math.max(0, end - params.limit);
    return { messages: list.slice(start, end), nextOffset: offset + (end - start), hasMore: start > 0, totalMessages: list.length };
  };
  return { read, reads };
}

test("Session index: the steps and messages of the WHOLE transcript — 2,000 messages read in 4 pages of 500, 500 steps with their results (10 failed), although a pane loads the newest 60", async () => {
  const all = transcript(500), host = served(() => all);
  const index = await createSessionIndex({ read: host.read }).of("s");
  assert.deepEqual([index.total, index.raw, index.pages, index.paged, host.reads.length], [2000, 2000, 4, true, 4]);
  assert.deepEqual([index.steps.length, index.steps.filter((step) => step.status === "failed").length, index.steps[0]!.id, index.steps.at(-1)!.output], [500, 10, "call-1", "scene 500 has 500 clips"]);
  // What the newest 60 messages alone give (the old source of the Worklog): 15 steps.
  assert.equal(indexMessages(all.slice(-60)).steps.length, 15);
  assert.equal(index.messages.length, 1500);
});

test("Session index: find — every message is searched, newest match first, case-insensitive, with the text around the match and how far back it stands; the limit bounds the list and not the count", async () => {
  const all = transcript(500), index = await createSessionIndex({ read: served(() => all).read }).of("s");
  const lantern = searchIndex(index, "lantern", 50);
  assert.deepEqual([lantern.total, lantern.matches[0]!.messageId, lantern.matches[0]!.role, lantern.matches[0]!.snippet, lantern.matches[0]!.newer], [1, "f7", "assistant", "The LANTERN shot is the seventh.", 2000 - 28]);
  assert.equal(lantern.matches[0]!.snippet.slice(lantern.matches[0]!.at, lantern.matches[0]!.at + 7), "LANTERN");
  const many = searchIndex(index, "what about scene", 20);
  assert.deepEqual([many.total, many.matches.length, many.matches[0]!.messageId, many.matches[19]!.messageId], [500, 20, "u500", "u481"]);
  assert.deepEqual(searchIndex(index, "no such words", 20), { total: 0, matches: [] });
  // Tool results are searchable as part of their step; host-authored notes are not conversation messages.
  const result = searchIndex(index, "has 7 clips", 20);
  assert.deepEqual([result.total, result.matches[0]!.kind, result.matches[0]!.itemId], [1, "step", "call-7"]);
  assert.match(result.matches[0]!.snippet, /jc_timeline_snapshot.*sceneId.*s7.*scene 7 has 7 clips/);
  assert.equal(indexMessages([{ role: "user", content: "[JAgentChill] Permission request…", jagentchill: { author: "host" } }]).messages.length, 0);
});

test("Session index: tool and card titles/arguments are searchable and point back to their transcript step", () => {
  const built = indexMessages([
    { role: "user", content: [{ type: "text", text: "Please check the cut." }], id: "u1" },
    { role: "assistant", timestamp: 1234, content: [{ type: "toolCall", id: "call-proposal", name: "jc_proposal_submit", arguments: { title: "Lantern kickoff card", summary: "Move the title." } }], id: "a1" },
    { role: "toolResult", toolCallId: "call-proposal", content: [{ type: "text", text: "Proposal created." }] },
  ]);
  const indexValue = { total: 3, paged: true, messages: built.messages, steps: built.steps, pages: 1, read_ms: 0, at_ms: 0, raw: 3 };
  const result = searchIndex(indexValue, "Lantern kickoff", 10);
  assert.deepEqual([result.total, result.matches[0]?.kind, result.matches[0]?.messageId, result.matches[0]?.itemId, result.matches[0]?.ts_ms], [1, "step", "a1", "call-proposal", 1234]);
  assert.match(result.matches[0]!.snippet, /Lantern kickoff card/);
});

test("Session index: search only indexes what the person typed, using the same transcript cleanup", () => {
  const built = indexMessages([
    { role: "user", id: "u-context", content: `[JAgentChill editor context — written by the editor, not by the user]\nCurrent turn: injected-only-needle\n[End of editor context. The user's message follows.]\n\n[Workflow "Fixture" (wf_test), revision 1, 1 steps]\n- start\n\nPlease find my [Attached file: private-name.txt | text/plain | blob:secret] note.` },
    { role: "user", id: "u-film", content: `[Film Studio] Injected-only-needle from the current turn.\n\nA second ordinary message.` },
  ]);
  const index = { total: 2, paged: true, messages: built.messages, steps: built.steps, pages: 1, read_ms: 0, at_ms: 0, raw: 2 };
  assert.equal(searchIndex(index, "injected-only-needle", 20).total, 0);
  const result = searchIndex(index, "ordinary", 20);
  assert.equal(result.total, 1);
  assert.equal(result.matches[0]!.messageId, "u-film");
  const clean = indexMessages([{ role: "user", id: "u-clean", content: `[Workflow "Fixture" (wf_test), revision 1, 1 steps]\n- start\n\nPlease find my [Attached file: private-name.txt | text/plain | blob:secret] note.` }]);
  assert.equal(clean.messages[0]!.text, "Please find my note.");
  assert.doesNotMatch(searchIndex({ ...index, messages: clean.messages }, "note", 20).matches[0]!.snippet, /\[End of|\[Attached file|Current turn:/);
});

test("Session index: kept and brought up to date — asked again at once nothing is read; after a turn added 4 messages ONE page is read and the new step is there; a transcript that got shorter (a rewind) is read whole again", async () => {
  let clock = 0, all = transcript(300);
  const host = served(() => all), index = createSessionIndex({ read: host.read, now: () => clock });
  assert.equal((await index.of("s")).steps.length, 300);
  const first = host.reads.length;
  assert.equal(first, 3);
  await index.of("s");
  assert.equal(host.reads.length, first, "asked again within the moment: nothing read");
  clock += 5000; all = transcript(301);
  const grown = await index.of("s");
  assert.deepEqual([host.reads.length - first, grown.steps.length, grown.total, grown.messages.at(-1)!.id, grown.messages[0]!.newer], [1, 301, 1204, "f301", 1203]);
  clock += 5000; all = transcript(120);
  const shorter = await index.of("s");
  assert.deepEqual([shorter.steps.length, shorter.total], [120, 480]);
});

test("Session index: a transcript the engine does not page (a CLI runtime's own session) — what one read of 500 gives, read once, and said so", async () => {
  const all = transcript(400), host = served(() => all, false);
  const index = await createSessionIndex({ read: host.read }).of("s");
  assert.deepEqual([index.paged, index.total, index.raw, host.reads.length, index.steps.length], [false, undefined, 500, 1, 125]);
});
