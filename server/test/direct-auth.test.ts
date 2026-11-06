import assert from "node:assert/strict";
import { test } from "node:test";
import { bytesToBase64Url, utf8 } from "@jagentchill/protocol";
import { directPasswordFromProtocols, hashDirectPassword, verifyDirectPassword } from "../src/tailnet/direct-auth.ts";

test("direct listener second factor uses a salted verifier and a base64url WebSocket protocol", () => {
  const password = "spaces, punctuation ! and unicode ✓";
  const hash = hashDirectPassword(password);
  assert.notEqual(hash, password);
  assert.ok(hash.startsWith("scrypt$"));
  assert.equal(verifyDirectPassword(password, hash), true);
  assert.equal(verifyDirectPassword("wrong", hash), false);
  assert.equal(verifyDirectPassword(password, undefined), false);
  const encoded = bytesToBase64Url(utf8(password));
  assert.equal(directPasswordFromProtocols(`other.protocol, jagentchill.password.${encoded}`), password);
  assert.equal(directPasswordFromProtocols("jagentchill.password.not-valid=="), null);
});
