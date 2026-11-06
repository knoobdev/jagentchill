import assert from "node:assert/strict";
import { test } from "node:test";
import { vi } from "./vi.ts";

test("Vietnamese workflow Outline means a step outline, not a visual border", () => {
  assert.equal(vi.Outline, "Dàn bước");
});
