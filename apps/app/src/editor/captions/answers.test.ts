// Pure rules of the captions tools' money answers; the host is a function of this file (a fake: the real one is a server).
import assert from "node:assert/strict";
import { test } from "node:test";
import { answerOf, isProgress, partAnswers, progressKey, sumEstimates, translateBatches, translationEstimate, wholeOf, wholeSeconds, type Answer, type Progress } from "./answers.ts";

const lines = (n: number) => Array.from({ length: n }, (_unused, index) => ({ id: `c${index}`, text: `line ${index}` }));
class Ask extends Error { details: Record<string, unknown>; constructor(details: Record<string, unknown>) { super("ask"); this.details = details; } }
/** A host that approves only the answer naming its current question, and asks again before `askAt` (a batch index). */
function host(askAt: number | null) {
  const sent: { texts: string[]; answer: Answer }[] = [];
  let quote = "q1", asked = false;
  return {
    sent, quote: () => quote,
    send: async (texts: string[], answer: Answer): Promise<string[]> => {
      sent.push({ texts, answer });
      if (answer.confirmed !== true || answer.actionId !== "act" || answer.quoteId !== quote) throw new Ask({ confirmWith: { actionId: "act", quoteId: quote } });
      if (askAt !== null && !asked && sent.filter((entry) => entry.answer.quoteId === quote).length === askAt + 1) { asked = true; quote = "q2"; throw new Ask({ spentUsd: 0.02, confirmWith: { actionId: "act", quoteId: "q2" } }); }
      return texts.map((text) => `T ${text}`);
    },
  };
}
const asks = (error: unknown) => error instanceof Ask;

test("Three batches with a re-confirmation before the last: every batch carries the complete answer, and no batch that was translated is sent again", async () => {
  const list = lines(5), key = progressKey(list, "vi"), world = host(2);
  let stored: Progress | null = null;
  const go = (answer: Answer) => translateBatches({ list, size: 2, key, answer, kept: stored, send: world.send, asks, live: () => true, save: (next) => { stored = next; } });
  const first = await go({ confirmed: true, actionId: "act", quoteId: "q1" });
  assert.equal(first.status, "asked");
  assert.deepEqual((first.asked as Ask).details.confirmWith, { actionId: "act", quoteId: "q2" });
  // The two batches before the question went out with ALL the fields of the answer — the second as complete as the first.
  assert.deepEqual(world.sent.slice(0, 2).map((entry) => entry.answer), [{ confirmed: true, actionId: "act", quoteId: "q1" }, { confirmed: true, actionId: "act", quoteId: "q1" }]);
  assert.equal(stored!.at, 4);
  assert.equal(stored!.done.length, 4);
  const second = await go({ confirmed: true, actionId: "act", quoteId: "q2" });
  assert.equal(second.status, "done");
  assert.deepEqual([...second.done.keys()], ["c0", "c1", "c2", "c3", "c4"]);
  // Sent in all: batch 1, batch 2, batch 3 (asked), batch 3 again with the new answer. Batches 1 and 2 once each.
  assert.deepEqual(world.sent.map((entry) => entry.texts.join("|")), ["line 0|line 1", "line 2|line 3", "line 4", "line 4"]);
  assert.deepEqual(world.sent[3].answer, { confirmed: true, actionId: "act", quoteId: "q2" });
  assert.equal(stored, null);
});

test("A reload during the money question: the progress read back from the store goes on at the asking batch under the answer it had", async () => {
  const list = lines(5), key = progressKey(list, "vi"), world = host(1);
  let stored: string | null = null;
  const save = (next: Progress | null) => { stored = next ? JSON.stringify(next) : null; };
  const first = await translateBatches({ list, size: 2, key, answer: { confirmed: true, actionId: "act", quoteId: "q1" }, kept: null, send: world.send, asks, live: () => true, save });
  assert.equal(first.status, "asked");
  // The page is gone; only the store is left.
  const read: unknown = JSON.parse(stored!);
  assert.ok(isProgress(read));
  assert.equal(read.at, 2);
  // Translate after the reload sends the asking batch under the old answer: the host asks its standing question again…
  const again = await translateBatches({ list, size: 2, key, answer: read.answer, kept: read, send: world.send, asks, live: () => true, save });
  assert.equal(again.status, "asked");
  // …and the answer finishes the work. The first batch was sent ONCE in all.
  const end = await translateBatches({ list, size: 2, key, answer: { confirmed: true, actionId: "act", quoteId: "q2" }, kept: JSON.parse(stored!) as Progress, send: world.send, asks, live: () => true, save });
  assert.equal(end.status, "done");
  assert.equal(end.done.size, 5);
  assert.equal(world.sent.filter((entry) => entry.texts[0] === "line 0").length, 1);
  assert.equal(stored, null);
});

test("Progress of other captions, or into another language, is not this run's", async () => {
  const list = lines(3), world = host(null), other: Progress = { key: progressKey(list, "ja"), at: 2, done: [["c0", "x"], ["c1", "y"]], missed: [], answer: { confirmed: true, actionId: "act", quoteId: "q1" } };
  const result = await translateBatches({ list, size: 2, key: progressKey(list, "vi"), answer: { confirmed: true, actionId: "act", quoteId: "q1" }, kept: other, send: world.send, asks, live: () => true, save: () => undefined });
  assert.equal(world.sent.length, 2);
  assert.equal(result.done.get("c0"), "T line 0");
  assert.equal(isProgress({ key: "k", at: 1, done: [["a"]], missed: [], answer: {} }), false);
});

test("A batch that fails for another reason is missed and the run goes on; a blank answer is not a translation", async () => {
  let n = 0;
  const result = await translateBatches({ list: lines(5), size: 2, key: "k", answer: {}, kept: null, asks, live: () => true, save: () => undefined, send: async (texts) => { if (++n === 2) throw new Error("provider"); return texts.map((text, index) => (index ? "" : `T ${text}`)); } });
  assert.equal(result.status, "done");
  assert.deepEqual([...result.done.keys()], ["c0", "c4"]);
  assert.deepEqual(result.missed, ["c1", "c2", "c3"]);
  assert.deepEqual(wholeOf(lines(3)), { characters: 18, lines: 3 });
});

test("Speech: every text is estimated as it is sent, the question is the sum, and each text is answered with its own ids", () => {
  const long = "x".repeat(1900);
  const sum = sumEstimates([
    { key: long, estimate: { amountUsd: 0.019, confirmAboveUsd: 0, needsConfirmation: true, model: "tts", confirmWith: { actionId: "a1", quoteId: "q1" } } },
    { key: "second", estimate: { amountUsd: 0.006, confirmAboveUsd: 0, needsConfirmation: true, model: "tts", confirmWith: { actionId: "a2", quoteId: "q2" } } },
  ])!;
  // The second text is IN the figure (the old estimate cut the joined texts at 2,000 characters).
  assert.equal(sum.amountUsd, 0.025);
  assert.equal(sum.needsConfirmation, true);
  const answer: Answer = { ...sum.confirmWith, confirmed: true };
  const answers = partAnswers({}, answer, null);
  assert.deepEqual(answerOf(answers, long, answer), { actionId: "a1", quoteId: "q1", confirmed: true });
  assert.deepEqual(answerOf(answers, "second", answer), { actionId: "a2", quoteId: "q2", confirmed: true });
  // The host asks again about the second text only: its new answer is its own, the first keeps what it had.
  const later = partAnswers(answers, { confirmed: true, actionId: "a2", quoteId: "q9" }, "second");
  assert.deepEqual(later.second, { confirmed: true, actionId: "a2", quoteId: "q9" });
  assert.deepEqual(later[long], { actionId: "a1", quoteId: "q1", confirmed: true });
  // One part without a price: the whole is "price not known", never the sum of the rest.
  assert.equal(sumEstimates([{ key: "a", estimate: { amountUsd: 0.01, confirmAboveUsd: 0, needsConfirmation: true } }, { key: "b", estimate: { amountUsd: null, confirmAboveUsd: 0, needsConfirmation: true } }])!.amountUsd, null);
  assert.deepEqual(answerOf({}, "a", {}), {});
});

test("A recording's estimate is asked for a length longer than any piece of it", () => {
  assert.equal(wholeSeconds(3), 3.1);
  assert.equal(wholeSeconds(3.04), 3.2);
  assert.equal(wholeSeconds(0), 0);
});

test("The estimate of a translation is asked with the captions themselves, in sending order, and the names the requests carry", () => {
  const list = [{ id: "a", text: "Xin chào" }, { id: "b", text: "こんにちは" }, { id: "c", text: "Hello there" }];
  assert.deepEqual(translationEstimate(list, "English", "vi"), { kind: "translation", characters: 24, lines: 3, texts: ["Xin chào", "こんにちは", "Hello there"], targetName: "English", source: "vi" });
  // A track whose language is not known names no source (the host takes none).
  assert.equal("source" in translationEstimate(list, "English", "und"), false);
  assert.equal("source" in translationEstimate(list, "English"), false);
});

test("Where a translation runs is said by names — the runtime and the model's label — never by ids", async () => {
  const { runtimeModelName } = await import("./answers.ts");
  const groups = [
    { kind: "cli", label: "OpenCode", providers: [{ providerId: "tools-stub", label: "Scripted stub", models: [{ label: "", ref: { modelId: "stub-chat" } }] }] },
    { kind: "cli", label: "Claude Code", providers: [{ providerId: "anthropic", label: "Anthropic", models: [{ label: "Claude Opus 5.5", ref: { modelId: "claude-opus-5-5" } }] }] },
  ];
  assert.equal(runtimeModelName(groups, "anthropic", "claude-opus-5-5"), "Claude Code · Claude Opus 5.5");
  assert.equal(runtimeModelName(groups, "tools-stub", "stub-chat"), "OpenCode · stub-chat");
  assert.equal(runtimeModelName(groups, "anthropic", "not-listed"), null);
  assert.equal(runtimeModelName(null, "anthropic", "claude-opus-5-5"), null);
});
