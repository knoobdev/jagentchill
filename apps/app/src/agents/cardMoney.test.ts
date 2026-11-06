// Pure: the amounts of an agent's per-message cost card, as the shared money formatter words them.
import assert from "node:assert/strict";
import { test } from "node:test";
import { cardAmounts, cardDigits } from "./cardMoney.ts";

const cents = (text: string | null) => Math.round(Number((text ?? "").replace(/[^0-9.]/g, "")) * 1e6);

test("The rows of a message's cost card add up to its total as shown: two pictures at $0.034 are '$0.034' twice under '$0.068' — not '$0.03' twice under '$0.07'", () => {
  const shown = cardAmounts([0.034, 0.034], 0.068, "en");
  assert.deepEqual(shown, { items: ["$0.034", "$0.034"], total: "$0.068" });
  for (const [items, total] of [[[0.034, 0.034], 0.068], [[0.011, 0.25, 0.0004], 0.2614], [[0.03, 0.04], 0.07], [[0.0336, 0.0336, null], 0.0672], [[0.000026, 1.5], 1.500026]] as [ (number | null)[], number ][]) {
    const card = cardAmounts(items, total, "en");
    assert.equal(card.items.reduce((sum, text) => sum + (text === null ? 0 : cents(text)), 0), cents(card.total), `${JSON.stringify(card)}`);
  }
  assert.deepEqual([cardDigits([0.03, 0.04, 0.07]), cardDigits([0.034, 0.068]), cardDigits([null, 0.0004]), cardDigits([0.000026])], [2, 3, 4, 6]);
  assert.deepEqual(cardAmounts([0.03, 0.04], 0.07, "en"), { items: ["$0.03", "$0.04"], total: "$0.07" }, "whole cents stay two decimals");
});
