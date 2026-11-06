// The music shelf's host side. The provider answers in these tests are FIXTURES: responses of the real Openverse API
// (api.openverse.org) saved on 2026-10-08 in `fixtures/music/` — no test here uses the network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createOpenverseProvider, trackOfRow } from "../src/music/openverse.ts";
import { MUSIC_CHIPS, MusicUnavailable, isOfferedLicence, orderForChip, type MusicProvider } from "../src/music/provider.ts";
import { MUSIC_METHOD_SCOPES, MUSIC_SEARCH_TTL_MS } from "../src/music/service.ts";
import type { ImportNet } from "../src/tools/import.ts";
import { createHarness } from "./harness.ts";

const fixture = (name: string) => JSON.parse(readFileSync(join(import.meta.dirname, "fixtures/music", `openverse-${name}.json`), "utf8")) as { result_count: number; page_count: number; results: Record<string, unknown>[] };
/** A double of the API's HTTP side that serves the saved responses and counts what it is asked. */
function double(over: { status?: number; fail?: boolean } = {}) {
  const asked: string[] = [];
  const ask = (async (input: string | URL) => {
    const url = new URL(String(input));
    asked.push(`${url.pathname}?${url.searchParams}`);
    if (over.fail) throw new TypeError("fetch failed");
    if (over.status) return new Response("{}", { status: over.status });
    const one = /\/audio\/([0-9a-f-]{36})\/$/.exec(url.pathname);
    if (one) { for (const name of ["upbeat", "piano", "unfiltered-chill"]) { const row = fixture(name).results.find((entry) => entry.id === one[1]); if (row) return Response.json(row); } return new Response("{}", { status: 404 }); }
    const q = url.searchParams.get("q") ?? "", first = q.toLowerCase().split(/[^a-z0-9]+/)[0];
    const source = ({ nc: "unfiltered-chill", lofi: "lounge", lounge: "lounge", downtempo: "lounge", chill: "lounge", upbeat: "upbeat", happy: "happy", pop: "upbeat", cinematic: "cinematic", filmscore: "cinematic", trailer: "cinematic", epic: "cinematic", hiphop: "hiphop", trap: "hiphop", rap: "hiphop", triphop: "hiphop", edm: "energetic", electronic: "energetic", future: "energetic", dance: "energetic", acoustic: "acoustic", guitar: "acoustic", folk: "acoustic", corporate: "corporate", business: "corporate", commercial: "corporate", house: "house", deephouse: "house", piano: "piano", emotional: "piano", solo: "piano", travel: "travel", adventure: "travel", world: "travel" } as Record<string, string>)[first] ?? first;
    try { return Response.json(fixture(source)); } catch { return Response.json({ result_count: 0, page_count: 0, results: [] }); }
  }) as typeof fetch;
  return { asked, provider: createOpenverseProvider({ baseUrl: "https://api.test/v1", fetch: ask }) };
}

test("W7 music — a row of the catalogue becomes a shelf track with its title, author, length, licence name + URL, source page and a complete credit line", () => {
  const row = fixture("upbeat").results.find((entry) => entry.title === "Upbeat Corporate")!, track = trackOfRow(row)!;
  assert.deepEqual([track.provider, track.id, track.title, track.author, track.seconds, track.licenceId, track.licence, track.licenceUrl, track.sourceUrl, track.attributionRequired], ["openverse", row.id, "Upbeat Corporate", "Soundrider/Dope", 100, "by", "CC BY 3.0", "https://creativecommons.org/licenses/by/3.0/", row.foreign_landing_url, true]);
  assert.equal(track.credit, `"Upbeat Corporate" by Soundrider/Dope — CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/) — ${row.foreign_landing_url}`);
  assert.ok(track.genres.includes("corporate") && track.tags.includes("instrumental") && track.fileUrl.startsWith("https://"));
});

test("W7 music — the licence filter never lets NC, ND or SA through: of an UNFILTERED answer of the API (20 rows: by-nc-nd, by-nd, by-nc-sa, by-sa) nothing is offered, and a row is refused whatever else it says", async () => {
  const rows = fixture("unfiltered-chill").results, licences = [...new Set(rows.map((row) => row.license))].sort();
  assert.deepEqual(licences, ["by-nc-nd", "by-nc-sa", "by-nd", "by-sa"]);
  assert.equal(rows.filter((row) => trackOfRow(row) !== null).length, 0);
  // The same through the provider and the service's method: the API is asked for by,cc0 — and what comes back is checked again.
  const api = double(), page = await api.provider.search({ text: "nc", page: 1 });
  assert.deepEqual([page.tracks.length, new URLSearchParams(api.asked[0].split("?")[1]).get("license"), new URLSearchParams(api.asked[0].split("?")[1]).get("category")], [0, "by,cc0", "music"]);
  const good = fixture("upbeat").results[0];
  for (const licence of ["by-nc", "by-nd", "by-sa", "by-nc-sa", "by-nc-nd", "nc-sampling+", "sampling+", "", "BY-NC", "all-rights-reserved"]) assert.equal(trackOfRow({ ...good, license: licence }), null, licence);
  for (const licence of ["by", "cc0", "pdm"]) assert.ok(trackOfRow({ ...good, license: licence }), licence);
  assert.deepEqual([isOfferedLicence("by"), isOfferedLicence("by-nc"), isOfferedLicence("toString")], [true, false, false]);
  // A row that is not music, has no https file, no page, no length — or is CC BY without an author to credit — is not offered either.
  for (const broken of [{ category: "sound_effect" }, { url: "http://example.com/a.mp3" }, { foreign_landing_url: "" }, { duration: null }, { creator: "" }]) assert.equal(trackOfRow({ ...good, ...broken }), null, JSON.stringify(broken));
});

test("W7 music — curated queries merge and deduplicate rows, rank instrumental/title/tag/genre matches, and drop missing authors and tracks outside 45–300 seconds", async () => {
  const tracks = fixture("house").results.map(trackOfRow).filter((track) => track !== null);
  const ordered = orderForChip(tracks, "house"), words = MUSIC_CHIPS.find((chip) => chip.id === "house")!.match;
  const hit = (track: (typeof tracks)[number]) => [...track.genres, ...track.tags].some((word) => words.includes(word));
  const firstMiss = ordered.findIndex((track) => !hit(track));
  assert.ok(firstMiss > 0 && ordered.slice(firstMiss).every((track) => !hit(track)), "matches first");
  const instrumental = { ...tracks[0]!, id: "instrumental", tags: ["house", "instrumental"] }, vocal = { ...tracks[0]!, id: "vocal", tags: ["house", "vocal"] };
  assert.deepEqual(orderForChip([vocal, instrumental], "house").map((track) => track.id), ["instrumental", "vocal"], "instrumentals win a matched-row tie");
  assert.deepEqual(orderForChip(tracks, undefined), tracks);
  assert.equal(MUSIC_CHIPS.length, 10);
  assert.ok(MUSIC_CHIPS.every((chip) => chip.queries.length >= 3), "each chip has several curated tag searches");
  const row = fixture("upbeat").results.find((entry) => entry.title === "Upbeat Corporate")!;
  assert.equal(trackOfRow({ ...row, duration: 44_999 }), null);
  assert.equal(trackOfRow({ ...row, duration: 300_001 }), null);
  assert.equal(trackOfRow({ ...row, creator: "" }), null);
  const api = double(), h = await createHarness({ extra: { music: { providers: [api.provider] } } as never });
  try {
    const shelf = await (await h.pair("curated", "editor")).call("jagentchill.music.search", { chip: "corporate" });
    assert.equal(api.asked.length, 3);
    assert.deepEqual(api.asked.map((request) => new URLSearchParams(request.split("?")[1]).get("q")), ["corporate instrumental", "business instrumental", "commercial instrumental"]);
    assert.equal(shelf.tracks.length, 5, "the same fixture rows from three tag queries are deduplicated");
    assert.ok(shelf.tracks.every((track: { author: string; seconds: number }) => track.author && track.seconds >= 45 && track.seconds <= 300));
  } finally { h.stop(); }
});

test("W7 music — the host's methods: search (cached for ten minutes, the file address never leaves the host), track by id with a query fallback, and what the shelf is told when the catalogue cannot be reached, is over its limit, or none is connected", async () => {
  let skew = 0;
  const api = double(), h = await createHarness({ now: () => Date.now() + skew, extra: { music: { providers: [api.provider] } } as never });
  try {
    const editor = await h.pair("Editor", "editor");
    for (const [name, scope] of Object.entries(MUSIC_METHOD_SCOPES)) assert.equal(h.app.methods.get(name)!.scope, scope, name);
    const first = await editor.call("jagentchill.music.search", { chip: "corporate" });
    assert.deepEqual([first.ok, first.provider.id, first.provider.notice, first.query, first.tracks.length, first.chips.length], [true, "openverse", "Made using Openverse — not endorsed or certified by Openverse.", "corporate instrumental", 5, 10]);
    assert.ok(first.tracks.every((track: Record<string, unknown>) => !("fileUrl" in track) && track.licence === "CC BY 3.0" && String(track.credit).includes(String(track.sourceUrl))));
    await editor.call("jagentchill.music.search", { chip: "corporate" });
    assert.equal(api.asked.length, 3, "three curated tag queries are cached as one chip result");
    skew += MUSIC_SEARCH_TTL_MS + 1;
    await editor.call("jagentchill.music.search", { chip: "corporate" });
    assert.equal(api.asked.length, 6, "after ten minutes all three curated queries are asked again");
    // Typed words win over the chip.
    assert.equal((await editor.call("jagentchill.music.search", { chip: "corporate", query: "  piano " })).query, "piano");
    // A track the shelf has shown is known without another request; an unknown id is asked for; a gone id falls back to the query.
    const before = api.asked.length, known = await editor.call("jagentchill.music.track", { id: first.tracks[0].id });
    assert.deepEqual([known.ok, known.track.title, api.asked.length], [true, first.tracks[0].title, before]);
    const gone = await editor.call("jagentchill.music.track", { id: "00000000-0000-4000-8000-000000000000" });
    assert.deepEqual([gone.ok, gone.reason], [false, "not_found"]);
    const fallback = await editor.call("jagentchill.music.track", { id: "00000000-0000-4000-8000-000000000000", query: "travel" });
    assert.deepEqual([fallback.ok, fallback.track.id], [true, fixture("travel").results.map(trackOfRow).find((track) => track !== null)!.id]);
    assert.equal((await editor.raw("jagentchill.music.search", { page: 99 })).ok, false, "parameters are checked");
  } finally { h.stop(); }
  for (const [over, reason] of [[{ fail: true }, "offline"], [{ status: 429 }, "rate_limited"], [{ status: 500 }, "provider_error"]] as const) {
    const down = await createHarness({ extra: { music: { providers: [double(over).provider] } } as never });
    try { const answer = await (await down.pair("E", "editor")).call("jagentchill.music.search", { chip: "upbeat" }); assert.deepEqual([answer.ok, answer.reason, typeof answer.message, answer.chips.length], [false, reason, "string", 10]); } finally { down.stop(); }
  }
  const none: MusicProvider = { id: "licensed", name: "Licensed", notice: "", site: "https://example.com", ready: () => false, search: async () => { throw new MusicUnavailable("offline", "x"); }, track: async () => null };
  const bare = await createHarness({ extra: { music: { providers: [none] } } as never });
  try { const answer = await (await bare.pair("E", "editor")).call("jagentchill.music.search", {}); assert.deepEqual([answer.ok, answer.reason, answer.provider], [false, "not_connected", null]); } finally { bare.stop(); }
});

test("W7 music item 1 — the signed host route streams its first bytes before EOF, forwards Range + Content-Range, and leaves no blob on the host", async () => {
  const first = Uint8Array.from([1, 2, 3]), last = Uint8Array.from([4, 5, 6]), requested: Array<{ range?: string }> = [];
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const net: ImportNet = {
    resolve: async () => ["93.184.216.34"],
    download: async (_url, _address, headers) => {
      requested.push({ ...(headers?.range ? { range: headers.range } : {}) });
      const ranged = headers?.range === "bytes=3-5" || headers?.range === "bytes=-3";
      return {
        status: ranged ? 206 : 200, contentLength: ranged ? 3 : 6, ...(ranged ? { contentRange: "bytes 3-5/6" } : {}), mime: "audio/mpeg",
        body: (async function* () { if (ranged) { yield last; return; } yield first; await wait; yield last; })(), cancel: () => release(),
      };
    },
  };
  const api = double(), h = await createHarness({ extra: { music: { providers: [api.provider], net } } as never });
  try {
    const editor = await h.pair("Editor", "editor");
    const shelf = await editor.call("jagentchill.music.search", { chip: "upbeat" }), pick = shelf.tracks[0];
    assert.equal(h.app.methods.has("jagentchill.music.fetch"), false, "the blob-writing fetch RPC is removed");
    const target = `/jagentchill/v1/music/stream/${pick.id}`;
    const response = await fetch(h.base + target, { headers: editor.device.signedHeaders(editor.offer.gatewayId, "GET", target, undefined) });
    assert.deepEqual([response.status, response.headers.get("accept-ranges"), response.headers.get("cache-control")], [200, "bytes", "private, no-store"]);
    assert.match(response.headers.get("server-timing") ?? "", /host;dur=\d+(?:\.\d+)?, provider-headers;dur=\d+(?:\.\d+)?, provider-first-byte;dur=\d+(?:\.\d+)?/);
    const reader = response.body!.getReader(), head = await reader.read();
    assert.deepEqual([...head.value!], [...first], "the first bytes arrive while the upstream body is still held open");
    assert.deepEqual(requested, [{}]);
    assert.equal(h.app.sync.blobs.list({ limit: 10 }).total, 0, "a preview created no host media blob");
    release();
    const tail = await reader.read();
    assert.deepEqual([...tail.value!], [...last]);
    assert.equal((await reader.read()).done, true);

    const ranged = await fetch(h.base + target, { headers: { ...editor.device.signedHeaders(editor.offer.gatewayId, "GET", target, undefined), range: "bytes=3-5" } });
    assert.deepEqual([ranged.status, ranged.headers.get("content-range"), [...new Uint8Array(await ranged.arrayBuffer())]], [206, "bytes 3-5/6", [...last]]);
    const suffix = await fetch(h.base + target, { headers: { ...editor.device.signedHeaders(editor.offer.gatewayId, "GET", target, undefined), range: "bytes=-3" } });
    assert.deepEqual([suffix.status, suffix.headers.get("content-range"), [...new Uint8Array(await suffix.arrayBuffer())]], [206, "bytes 3-5/6", [...last]]);
    assert.deepEqual(requested, [{}, { range: "bytes=3-5" }, { range: "bytes=-3" }]);
    assert.equal(h.app.sync.blobs.list({ limit: 10 }).total, 0, "a played preview leaves no unreferenced media blob");
  } finally { release(); h.close(); }
});
