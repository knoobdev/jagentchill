import assert from "node:assert/strict";
import { test } from "node:test";
import { questionCardLayout } from "./questionCardLayout.ts";

const card = (id: string, ts_ms: number, pending: boolean) => ({ id: `question-${id}`, ts_ms, pending });

test("settled question cards remain at their transcript times and are never pinned", () => {
  const cards = [card("answered", 10, false), card("expired", 20, false)];
  assert.deepEqual(questionCardLayout(cards), { settled: cards, pinned: null });
});

test("multiple pending question cards share one stable pinned transcript block", () => {
  const cards = [card("answered", 10, false), card("pending-a", 20, true), card("pending-b", 30, true), card("pending-c", 40, true)];
  const layout = questionCardLayout(cards);
  assert.deepEqual(layout.settled, [cards[0]]);
  assert.deepEqual(layout.pinned, { id: "pending-questions", ts_ms: Number.MAX_SAFE_INTEGER, pending: true, cards: cards.slice(1) });
  assert.equal(layout.pinned?.id, "pending-questions", "new pending requests do not change the transcript item key");
});
