import assert from "node:assert/strict";
import test from "node:test";
import { completeMobilePairing } from "./complete-mobile-pairing.ts";

test("an accepted pairing leaves verification without waiting for the native host-list refresh", () => {
  const calls: string[] = [];
  completeMobilePairing("gateway-1", {
    selectHost: (id) => calls.push(`select:${id}`),
    navigateHome: () => calls.push("home"),
    refreshHosts: () => { calls.push("refresh"); return new Promise<void>(() => {}); },
  });
  assert.deepEqual(calls, ["select:gateway-1", "home", "refresh"]);
});
