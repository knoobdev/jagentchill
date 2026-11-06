import assert from "node:assert/strict";
import test from "node:test";
import { usageFilterLayout } from "./usage-layout.ts";

test("usage filters stack full-width on phone and stay beside tabs on desktop", () => {
  assert.deepEqual(usageFilterLayout(true), { direction: "column", alignItems: "stretch", controlsAlign: "stretch" });
  assert.deepEqual(usageFilterLayout(false), { direction: "row", alignItems: "flex-end", controlsAlign: undefined });
});
