import assert from "node:assert/strict";
import { test } from "node:test";
import { pairingLinkDisplay } from "./link-display.ts";

test("pairing links stay whole while focused and elide the middle when idle", () => {
  const link = `jagentchill://pair#offer=${"x".repeat(376)}`;
  const idle = pairingLinkDisplay(link, false);
  assert.equal(idle.length, 23);
  assert.equal(idle, `${link.slice(0, 11)}…${link.slice(-11)}`);
  assert.equal(pairingLinkDisplay(link, true), link);
  assert.equal(pairingLinkDisplay("short-link", false), "short-link");
});
