import assert from "node:assert/strict";
import { test } from "node:test";
import { RenderHostManager } from "./manager.ts";

test("a configured render host stays startable after an unavailable probe so export can retry it", () => {
  const manager = new RenderHostManager({ path: process.execPath });
  (manager as unknown as { stateValue: { state: string; reason: string } }).stateValue = { state: "unavailable", reason: "temporary probe failure" };

  assert.equal(manager.available(), false, "preview still reports the current unhealthy renderer state");
  assert.equal(manager.canStart(), true, "a later capabilities/export request can retry the configured executable");
});
