import assert from "node:assert/strict";
import { test } from "node:test";
import { readRecord } from "./buildRecord.ts";

/** An answer whose body tells whether it was read to its end. */
function answer(status: number, type: string, text: string) {
  const state = { read: false };
  const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close(); state.read = true; } }, { highWaterMark: 0 });
  return { state, fetch: (async () => new Response(body, { status, headers: { "content-type": type } })) as typeof fetch };
}

test("A build without build.json: a 404 is no record, and its body is read so the request ends", async () => {
  const missing = answer(404, "text/plain", "Not found");
  assert.equal(await readRecord("/build.json", { fetch: missing.fetch }), null);
  assert.equal(missing.state.read, true, "the answer was read to its end");
});

test("A build without build.json: the server's page in place of the file is no record, and its body is read", async () => {
  const page = answer(200, "text/html; charset=utf-8", "<!DOCTYPE html><html></html>");
  assert.equal(await readRecord("/build.json", { fetch: page.fetch }), null);
  assert.equal(page.state.read, true);
});

test("A build without build.json: a request that never answers is given up after the timeout", async () => {
  const never = ((_path: string, init?: RequestInit) => new Promise<Response>((_done, fail) => init!.signal!.addEventListener("abort", () => fail(new DOMException("aborted", "AbortError"))))) as typeof fetch;
  const started = Date.now();
  assert.equal(await readRecord("/build.json", { fetch: never, timeout_ms: 50 }), null);
  assert.ok(Date.now() - started < 2000);
});

test("A finished build: the record is returned; text that is not JSON is no record", async () => {
  assert.deepEqual(await readRecord("/build.json", { fetch: answer(200, "application/json", '{"version":"1.2.3"}').fetch }), { version: "1.2.3" });
  assert.equal(await readRecord("/build.json", { fetch: answer(200, "application/json", "<html>").fetch }), null);
});
