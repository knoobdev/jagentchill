import assert from "node:assert/strict";
import { test } from "node:test";
import { cachedMusicSearch, refreshMusicSearch, type ShelfAnswer } from "./remote-search.ts";

const answer: Extract<ShelfAnswer, { ok: true }> = { ok: true, provider: { id: "fixture", name: "Fixture", notice: "", site: "https://example.test" }, chips: ["upbeat"], query: "upbeat", page: 1, more: false, tracks: [] };

test("music shelf retries transient errors with backoff and caches the last good host/query result", async () => {
  let calls = 0;
  const waits: number[] = [];
  const connection = { async call<T>() { calls += 1; return (calls < 3 ? { ok: false, reason: "provider_error", message: "fixture failure" } : answer) as T; } };
  const params = { chip: "upbeat" };
  const result = await refreshMusicSearch(connection, "host-fixture-retry", params, async (ms) => { waits.push(ms); });
  assert.deepEqual([result, calls, waits, cachedMusicSearch("host-fixture-retry", params)], [answer, 3, [250, 750], answer]);
});

test("music shelf does not back off when no connected host can answer", async () => {
  const waits: number[] = [];
  const result = await refreshMusicSearch(undefined, undefined, { chip: "upbeat" }, async (ms) => { waits.push(ms); });
  assert.deepEqual([result.ok, result.ok ? null : result.reason, waits], [false, "no_host", []]);
});
