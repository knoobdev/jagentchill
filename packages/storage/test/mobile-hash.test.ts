import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { hashMobileFile } from "../src/mobile.ts";

test("mobile picked media hashes exact ranges incrementally without a whole-file read", async () => {
  const bytes = Uint8Array.from({ length: 257 }, (_, index) => (index * 37) & 255), reads: [number, number][] = [], progress: number[] = [];
  const digest = await hashMobileFile({ size: bytes.length, async read(start, end) { reads.push([start, end]); return bytes.slice(start, end); } }, {
    chunkSize: 31, onProgress: (loaded) => progress.push(loaded),
  });
  assert.equal(digest, createHash("sha256").update(bytes).digest("hex"));
  assert.deepEqual(reads[0], [0, 31]);
  assert.deepEqual(reads.at(-1), [248, 257]);
  assert.equal(Math.max(...reads.map(([start, end]) => end - start)), 31);
  assert.equal(reads.length, 9);
  assert.deepEqual(progress, reads.map(([, end]) => end));
});

test("mobile picked media rejects short range reads and stops when cancelled", async () => {
  await assert.rejects(() => hashMobileFile({ size: 10, async read() { return new Uint8Array(2); } }, { chunkSize: 4 }), /returned 2 bytes/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => hashMobileFile({ size: 10, async read() { return new Uint8Array(10); } }, { signal: controller.signal }), /cancelled/);
});
