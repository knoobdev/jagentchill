// A clip whose original is not on the device plays from its proxy; when the original arrives, the preview and an export
// must read the ORIGINAL — not the proxy that was cached before. Real blobs and real `blob:` URLs: what a URL gives is
// read back through `fetch`, the way the engine reads it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createSourceCache } from "./source-cache.ts";

const PROXY = "proxy bytes (720p)", ORIGINAL = "ORIGINAL BYTES (2160p, much longer than the proxy)";
function device() {
  const originals = new Map<string, string>(), proxies = new Map<string, string>(), released: string[] = [];
  const cache = createSourceCache({
    hasOriginal: async (assetId) => originals.has(assetId),
    original: async (assetId) => new Blob([originals.get(assetId)!], { type: "video/quicktime" }),
    proxy: async (assetId) => (proxies.has(assetId) ? new Blob([proxies.get(assetId)!], { type: "video/mp4" }) : null),
  }, (blob) => URL.createObjectURL(blob), (url) => { released.push(url); URL.revokeObjectURL(url); });
  return { cache, originals, proxies, released };
}
const read = async (url: string | null) => (url === null ? null : await (await fetch(url)).text());

test("proxy then original: after the original arrives the asset's URL gives the original's bytes, the version moves, and the proxy's URL is let go", async () => {
  const { cache, originals, proxies, released } = device();
  proxies.set("clip", PROXY);
  const first = await cache.url("clip");
  assert.equal(await read(first), PROXY);
  assert.equal(cache.readFrom("clip"), "proxy");
  assert.equal(await cache.url("clip"), first, "the same URL while nothing changes");
  const before = cache.version();
  assert.deepEqual(await cache.arrived(), [], "an arrival of something else changes nothing");
  assert.equal(cache.version(), before);

  originals.set("clip", ORIGINAL);
  // Without being told, the cache still answers with the proxy — the defect of the review, were `arrived` not called.
  assert.equal(await read(await cache.url("clip")), PROXY);
  assert.deepEqual(await cache.arrived(), ["clip"]);
  assert.equal(cache.version(), before + 1, "whoever gave the old URL to an engine sees that it has to ask again");
  const second = await cache.url("clip");
  assert.notEqual(second, first);
  assert.equal(await read(second), ORIGINAL, "the preview and an export now read the original");
  assert.equal((await cache.blob("clip"))!.type, "video/quicktime");
  assert.equal(cache.readFrom("clip"), "original");
  // The old URL stays readable until the next replacement or the end (an engine may be in the middle of reading it).
  assert.equal(await read(first), PROXY);
  assert.deepEqual(await cache.arrived(), []);
  cache.clear();
  assert.deepEqual(released.sort(), [first!, second!].sort());
  await assert.rejects(fetch(second!));
});

test("proxy then original: only assets read from a proxy are read anew — a handed-over file and an original keep their URL; an asset with nothing gets one when its file comes", async () => {
  const { cache, originals, proxies } = device();
  originals.set("picture", "picture bytes"); proxies.set("clip", PROXY);
  cache.hold("fresh", new Blob(["dropped in this session"]));
  assert.equal(await cache.url("missing"), null);
  const picture = await cache.url("picture"), fresh = await cache.url("fresh"), clip = await cache.url("clip");
  originals.set("clip", ORIGINAL); originals.set("fresh", "the stored copy"); originals.set("missing", "late file");
  assert.deepEqual(await cache.arrived(), ["clip"]);
  assert.equal(await cache.url("picture"), picture);
  assert.equal(await cache.url("fresh"), fresh);
  assert.equal(await read(fresh), "dropped in this session");
  assert.notEqual(await cache.url("clip"), clip);
  assert.equal(await read(await cache.url("missing")), "late file");
  cache.clear();
});

test("proxy then original: a question that was on its way when the original arrived does not leave the proxy behind", async () => {
  const { cache, originals, proxies } = device();
  proxies.set("clip", PROXY);
  await cache.url("clip");
  originals.set("clip", ORIGINAL);
  // The arrival and two readers at once.
  const [, a, b] = await Promise.all([cache.arrived(), cache.url("clip"), cache.blob("clip")]);
  void a; void b;
  await cache.arrived();
  assert.equal(await read(await cache.url("clip")), ORIGINAL);
  assert.equal(await (await cache.blob("clip"))!.text(), ORIGINAL);
  cache.clear();
});

test("review A2: the original arrives while the FIRST read of the proxy is still pending — the read that then finishes must not leave the proxy in the cache", async () => {
  const originals = new Map<string, string>(), released: string[] = [];
  // The device's store with its proxy read held open: the read has started and answers only when `finishProxyRead` is called.
  let finishProxyRead!: () => void, proxyStarted!: () => void, proxyReads = 0;
  const gate = new Promise<void>((resolve) => { finishProxyRead = resolve; }), proxyAsked = new Promise<void>((resolve) => { proxyStarted = resolve; });
  const cache = createSourceCache({
    hasOriginal: async (assetId) => originals.has(assetId), original: async (assetId) => new Blob([originals.get(assetId)!], { type: "video/quicktime" }),
    proxy: async () => { proxyReads += 1; proxyStarted(); await gate; return new Blob([PROXY], { type: "video/mp4" }); },
  }, (blob) => URL.createObjectURL(blob), (url) => { released.push(url); URL.revokeObjectURL(url); });

  const pending = cache.url("clip"); // the preview asks; no original yet → the proxy read starts and hangs
  await proxyAsked;
  originals.set("clip", ORIGINAL); // the original is delivered…
  assert.deepEqual(await cache.arrived(), [], "nothing is cached yet, so the arrival has nothing to drop"); // …and the session says so
  finishProxyRead(); // only now the proxy read answers
  const url = await pending;
  assert.equal(proxyReads, 1);
  assert.equal(await read(url), ORIGINAL, "the read that was pending answers with the original");
  assert.equal(cache.readFrom("clip"), "original");
  assert.equal(await read(await cache.url("clip")), ORIGINAL, "and playback and export stay on it");
  assert.equal((await cache.blob("clip"))!.type, "video/quicktime");
  assert.deepEqual(await cache.arrived(), [], "nothing is left to repair by a later arrival");
  cache.clear();
});

test("review A2: an arrival of ANOTHER file during a pending proxy read keeps the proxy, and the asset's own original still replaces it later", async () => {
  const originals = new Map<string, string>();
  let open!: () => void;
  const gate = new Promise<void>((resolve) => { open = resolve; });
  let asked!: () => void;
  const started = new Promise<void>((resolve) => { asked = resolve; });
  const cache = createSourceCache({
    hasOriginal: async (assetId) => originals.has(assetId), original: async (assetId) => new Blob([originals.get(assetId)!]),
    proxy: async () => { asked(); await gate; return new Blob([PROXY]); },
  }, (blob) => URL.createObjectURL(blob), (url) => URL.revokeObjectURL(url));
  const pending = cache.url("clip");
  await started;
  originals.set("other", "another file");
  await cache.arrived();
  open();
  assert.equal(await read(await pending), PROXY);
  assert.equal(cache.readFrom("clip"), "proxy");
  originals.set("clip", ORIGINAL);
  assert.deepEqual(await cache.arrived(), ["clip"]);
  assert.equal(await read(await cache.url("clip")), ORIGINAL);
  cache.clear();
});
