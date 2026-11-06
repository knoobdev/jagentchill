import assert from "node:assert/strict";
import test from "node:test";
import { scriptListLayout } from "./mobileLayout.ts";

test("script library controls fit and stack inside a 393 pt phone", () => {
  assert.deepEqual(scriptListLayout(true), { padding: 16, direction: "column", align: "stretch", gap: 8, fullWidth: true });
  assert.equal(scriptListLayout(false).direction, "row");
});
