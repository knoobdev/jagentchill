import assert from "node:assert/strict";
import test from "node:test";
import { hostRetryDelay } from "./host-retry.ts";

test("host reconnect backs off from one second and caps at thirty seconds", () => {
  assert.deepEqual(Array.from({ length: 8 }, (_, attempt) => hostRetryDelay(attempt)), [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
  assert.equal(hostRetryDelay(-1), 1_000);
});
