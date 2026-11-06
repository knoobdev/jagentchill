import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import { gzip } from "../src/sync/blobs.ts";

test("snapshot gzip falls back to portable stored DEFLATE when CompressionStream is unavailable", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "CompressionStream");
  Object.defineProperty(globalThis, "CompressionStream", { configurable: true, writable: true, value: undefined });
  try {
    for (const source of ["", "phone project snapshot", "JAgentChill project 📹\n".repeat(5000)]) {
      const compressed = await gzip(source);
      assert.equal(gunzipSync(compressed).toString("utf8"), source);
    }
  } finally {
    if (original) Object.defineProperty(globalThis, "CompressionStream", original);
    else Reflect.deleteProperty(globalThis, "CompressionStream");
  }
});
