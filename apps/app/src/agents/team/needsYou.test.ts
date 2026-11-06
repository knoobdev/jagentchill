// Pure: when the Agents tab shows "Needs you" and what stands under it. Run with `node --test apps/app/src/agents/team/needsYou.test.ts`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { escalatedDissents, needsYou } from "./needsYou.ts";

const dissent = (id: string, status: string, outcome?: string) => ({ id, status, outcome }) as never;

test("\"Needs you\" is shown only with its items, and a disagreement the lead gave to the person is one of them (it was drawn further down the page, under a heading with nothing below it)", () => {
  // The owner's case: the run waits for a decision on a disagreement; the Team view is open; no hand-off waits.
  const run = { waitingReason: "dissent" as const, dissents: [dissent("d1", "open", "ESCALATED_TO_HUMAN"), dissent("d2", "resolved", "ESCALATED_TO_HUMAN"), dissent("d3", "open", "UPHELD")] };
  const escalated = escalatedDissents([run]);
  assert.deepEqual(escalated.map((entry) => entry.dissent.id), ["d1"], "the open, escalated one is the card under the heading");
  assert.equal(needsYou("team", run, escalated, []), true);
  // The same run once the person decided: no card, so no heading (before: the heading stayed while the run waited).
  const decided = { waitingReason: "dissent" as const, dissents: [dissent("d1", "resolved", "ESCALATED_TO_HUMAN")] };
  assert.equal(needsYou("team", decided, escalatedDissents([decided]), []), false);
  assert.equal(needsYou("roster", decided, escalatedDissents([decided]), []), false);
  // A result that waits for sign-off, and a hand-off: each is an item.
  assert.equal(needsYou("team", { waitingReason: "signoff" }, [], []), true);
  assert.equal(needsYou("roster", undefined, [], [{}]), true);
  assert.equal(needsYou("roster", undefined, [], []), false);
  // The activity log has no such section.
  assert.equal(needsYou("activity", { waitingReason: "signoff" }, escalated, [{}]), false);
});
