import assert from "node:assert/strict";
import test from "node:test";
import { messageFor } from "./messages.ts";

test("pairing errors name expired offers, unreachable hosts, empty replies, and unavailable signing", () => {
  assert.match(messageFor({ code: "OFFER_EXPIRED" }), /pairing link has expired/i);
  assert.match(messageFor({ code: "GATEWAY_UNREACHABLE" }), /Tailscale is connected on both devices/i);
  assert.match(messageFor({ code: "UNAVAILABLE" }), /without a pairing response/i);
  assert.match(messageFor(new Error("crypto.subtle Ed25519 signing failed")), /build cannot sign/i);
  assert.doesNotMatch(messageFor(new Error("unexpected end of JSON input")), /Something went wrong/i);
});
