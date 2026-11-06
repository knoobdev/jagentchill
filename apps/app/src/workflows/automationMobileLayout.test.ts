import assert from "node:assert/strict";
import test from "node:test";
import { automationListLayout } from "./automationMobileLayout.ts";

test("automation list uses stacked full-width controls at 393 pt", () => {
  assert.deepEqual(automationListLayout(true), { padding: 16, filterDirection: "column", filterAlign: "stretch", filterGap: 8, fullWidthControls: true });
  assert.equal(automationListLayout(false).filterDirection, "row");
});
