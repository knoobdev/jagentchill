// The mounted window of the chat list (brief w7-chat item 1): which rows are mounted for a scroll position, and how
// tall the spacers that stand for the others are.
import assert from "node:assert/strict";
import { test } from "node:test";
import { itemsFromHistory, listWindow, listWindowPrependShift, rowTop } from "../src/index.ts";

const keys = Array.from({ length: 2000 }, (_value, index) => `k${index}`);

test("A long chat is not mounted whole: at the end of 2,000 rows only the rows around the viewport are mounted, and the spacer above is as tall as the rest", () => {
  const heights = new Map<string, number>();
  const end = listWindow({ keys, heights, estimate: 100, scrollTop: 2000 * 100 - 800, viewport: 800, overscan: 800 });
  assert.deepEqual([end.first, end.end, end.before, end.after, end.total], [1983, 2000, 198_300, 0, 200_000]);
  assert.ok(end.end - end.first <= 17, `${end.end - end.first} rows mounted of 2000`);
  // In the middle: rows above and below are spacers.
  const middle = listWindow({ keys, heights, estimate: 100, scrollTop: 100_000, viewport: 800, overscan: 400 });
  assert.deepEqual([middle.first, middle.end, middle.before, middle.after], [995, 1013, 99_500, 98_700]);
  assert.equal(middle.before + (middle.end - middle.first) * 100 + middle.after, middle.total);
});

test("Measured rows change the spacers, not the rows on screen: a row measured taller above the viewport makes the spacer taller by that much", () => {
  const heights = new Map<string, number>([["k3", 500], ["k1990", 40]]);
  const at = listWindow({ keys, heights, estimate: 100, scrollTop: 150_000, viewport: 800, overscan: 0 });
  const plain = listWindow({ keys, heights: new Map(), estimate: 100, scrollTop: 150_000 - 400, viewport: 800, overscan: 0 });
  assert.deepEqual([at.first, at.end], [plain.first, plain.end], "the same rows, 400 px further down");
  assert.equal(at.before - plain.before, 400);
  assert.equal(at.total, 200_000 + 400 - 60);
  assert.equal(rowTop(keys, heights, 100, "k4"), 3 * 100 + 500);
  assert.equal(rowTop(keys, heights, 100, "nope"), null);
});

test("A gap between rows, a row that must stay mounted, an empty list, and a scroll offset beyond the list", () => {
  const few = ["a", "b", "c", "d"];
  const gapped = listWindow({ keys: few, heights: new Map(), estimate: 100, gap: 10, scrollTop: 0, viewport: 150, overscan: 0 });
  assert.deepEqual([gapped.first, gapped.end, gapped.before, gapped.after, gapped.total], [0, 2, 0, 220, 430]);
  const kept = listWindow({ keys, heights: new Map(), estimate: 100, scrollTop: 0, viewport: 300, overscan: 0, keep: new Set(["k1999"]) });
  assert.deepEqual([kept.first, kept.end], [0, 2000], "the kept row is mounted; the window is one stretch");
  assert.deepEqual(listWindow({ keys: [], heights: new Map(), estimate: 100, scrollTop: 0, viewport: 300, overscan: 0 }), { first: 0, end: 0, before: 0, after: 0, total: 0 });
  const beyond = listWindow({ keys: few, heights: new Map(), estimate: 100, scrollTop: 5000, viewport: 150, overscan: 0 });
  assert.deepEqual([beyond.first, beyond.end, beyond.after], [1, 4, 0], "the last rows are shown instead of nothing");
});

test("Pages of one transcript: a message without an id of its own gets a key no other page uses", () => {
  const page = [{ role: "user", content: "hello" }, { role: "assistant", content: "hi" }];
  const newest = itemsFromHistory(page), older = itemsFromHistory(page, "60-");
  assert.deepEqual(newest.map((item) => item.id), ["h0", "h1"]);
  assert.deepEqual(older.map((item) => item.id), ["h60-0", "h60-1"]);
  assert.equal(new Set([...newest, ...older].map((item) => item.id)).size, 4);
});

test("a final older page does not move the window away from the true transcript beginning", () => {
  assert.equal(listWindowPrependShift(0, false, 146_636), 0);
  assert.equal(listWindowPrependShift(0, true, 146_636), 0, "stay at the physical top so the newly loaded older rows remain reachable");
  assert.equal(listWindowPrependShift(2, false, 146_636), 146_636);
  assert.equal(listWindowPrependShift(null, false, 146_636), 146_636, "follow-end placement is unchanged");
});
