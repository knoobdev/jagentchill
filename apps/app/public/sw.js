// The web app's service worker: it keeps the files of one build of the app in Cache Storage, so the app opens with no
// network after the first visit. `scripts/finish-web-export.mjs` writes the build (its id, the list of its files and the
// app's routes) into the marker below; without it this file does nothing. Only files of a build and the page of an app
// route are answered from here — a request to a host (API, media, WebSocket) is never handled and never cached.
const BUILD = /*@build*/null;
const PREFIX = "jagentchill-shell-";
const CACHE = BUILD ? PREFIX + BUILD.id : null;
// Which build each open tab (and each worker a tab started) was loaded with, kept across restarts of this worker.
const TABS = "jagentchill-tabs";
const scope = self.registration.scope;
const base = new URL(scope).pathname;
const INDEX = new URL("index.html", scope).href;
const ACTIVE = new URL("__active", scope).href;
const RETIRED = new URL("__retired", scope).href;
const TAB = new URL("__tab/", scope).href;
const FILES = new URL("__files/", scope).href;
const files = new Set((BUILD ? BUILD.files : []).map((file) => new URL(file, scope).href));
const routes = new Set(BUILD ? BUILD.routes : []);
// A host that shares the origin with the app answers under this path (API, media, agent tools): it is never ours.
const HOST = "/jagentchill/";
const isHostPath = (pathname) => pathname.startsWith(HOST) && !base.startsWith(HOST);
const PARALLEL = 6;
// A page being loaded is not listed among the clients yet: its record is not dropped before this age.
const STARTING_MS = 15_000;
const SWEEP_AFTER_MS = 3000;

/** Every file of the build is fetched from the network (never the HTTP cache) and stored; one failure fails the install. */
async function precache() {
  const cache = await caches.open(CACHE);
  const pending = [...files];
  const one = async () => {
    for (let url = pending.pop(); url; url = pending.pop()) {
      const response = await fetch(new Request(url, { cache: "no-cache", credentials: "same-origin" }));
      // A host that answers a missing file with its page is not answering with the file.
      const page = (response.headers.get("content-type") || "").includes("text/html");
      if (!response.ok || (page && url !== INDEX)) throw new Error(`precache failed: ${url} (${response.status})`);
      await cache.put(url, response);
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, one));
  // The list of the build's files stays with its cache: after a newer build has taken over, it tells which paths a
  // tab of this build is answered from here — also those the newer build no longer has.
  await (await caches.open(TABS)).put(FILES + BUILD.id, new Response(JSON.stringify([...files])));
}

// ── the files of every kept build ──
let manifests = null, older = null;
/** build id → the addresses of its files. `older` (every address of a build other than this one) is null until read. */
const loadManifests = (again = false) => manifests = (again ? null : manifests) ?? (async () => {
  const map = new Map([[BUILD.id, files]]), state = await caches.open(TABS), union = new Set();
  for (const name of await caches.keys()) {
    if (!name.startsWith(PREFIX) || name === CACHE) continue;
    const id = name.slice(PREFIX.length), listed = await state.match(FILES + id);
    let list = null;
    try { list = listed ? await listed.json() : null; } catch { /* read from the cache below */ }
    // A build kept by a worker that wrote no list: what its cache holds is its list.
    list ??= (await (await caches.open(name)).keys()).map((request) => request.url);
    map.set(id, new Set(list));
    for (const url of list) union.add(url);
  }
  older = union;
  return map;
})();

// ── the build of each tab ──
let tabs = null;
/** client id → { build }: read once per start of this worker. */
const loadTabs = () => tabs ??= (async () => {
  const map = new Map(), cache = await caches.open(TABS);
  for (const request of await cache.keys()) {
    if (!request.url.startsWith(TAB)) continue;
    try { map.set(decodeURIComponent(request.url.slice(TAB.length)), await (await cache.match(request)).json()); } catch { /* an unreadable record is no record */ }
  }
  return map;
})();
async function remember(id, build, starting = false) {
  const entry = starting ? { build, starting_ms: Date.now() } : { build };
  (await loadTabs()).set(id, entry);
  await (await caches.open(TABS)).put(TAB + encodeURIComponent(id), new Response(JSON.stringify(entry)));
}
/**
 * The build a request belongs to — never guessed.
 *  - A request that names its build (`?build=<id>`) is that build's: the page writes the tag on the address of every
 *    worker it starts and of every file it hands a worker (`src/platform/buildTag.ts`). See `ofBuild`.
 *  - A request of a tab without a tag is the build the tab was loaded with: recorded when its page was answered, or,
 *    for a tab that was open when this worker took over, the build that was active until then.
 *  - A request without a tag from anything that is not a tab (a worker) has no build of its own. While no previous
 *    build is kept there is only one it can mean; otherwise it is not answered from here at all (null).
 */
async function ownerOf(event) {
  const map = await loadTabs(), id = event.clientId;
  const known = id && map.get(id);
  if (known) return known.build;
  const client = id ? await self.clients.get(id) : null;
  if (client && client.type === "window") { await remember(id, BUILD.id); return BUILD.id; }
  return (await previousKept()) ? null : BUILD.id;
}
let olderKept = null;
/** Whether a build from before this one is still kept (a tab still runs it). */
const previousKept = async () => { if (olderKept === null) { try { olderKept = JSON.parse(await note(RETIRED) || "[]").length > 0; } catch { olderKept = false; } } return olderKept; };
/** The answer to a request that cannot be given this build's bytes: loud, and never another build's file. */
const refuse = (why) => new Response(why, { status: 409, statusText: "Build Mismatch", headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
/**
 * A file of `build` that is not kept here. The origin serves one deployment, which may be a newer one: its file is
 * this build's only if the origin says, now, that it is this build. Then it is fetched whole (and kept again when it
 * is the active build's); otherwise the request is refused.
 */
async function fromOrigin(build, href) {
  let serving = null;
  try {
    const record = await fetch(new Request(new URL("build.json", scope).href, { cache: "no-store", credentials: "same-origin" }));
    serving = record.ok && (record.headers.get("content-type") || "").includes("json") ? (await record.json()).buildId : null;
  } catch { return Response.error(); }
  if (serving !== build) return refuse(`This page runs build ${build} and the server now has ${serving ? `build ${serving}` : "no build record"}: the file is not available any more. Reload the page.`);
  const response = await fetch(new Request(href, { cache: "no-store", credentials: "same-origin" }));
  if (response.ok && build === BUILD.id && files.has(href)) await (await caches.open(CACHE)).put(href, response.clone());
  return response;
}
/** A request that names its build is answered with exactly that build's bytes, or not at all. */
async function ofBuild(tag, href, hashed) {
  const listed = (await loadManifests()).get(tag);
  if (listed && !listed.has(href)) return new Response("Not a file of this build", { status: 404, headers: { "content-type": "text/plain" } });
  return (listed ? await stored(tag, href) : null) || (hashed ? await anywhere(href) : null) || fromOrigin(tag, href);
}
/** A request without a tag: the build of its tab; from a worker, the only build there is — or it is refused. */
async function ofOwner(event, href, hashed) {
  const request = event.request, build = await ownerOf(event), lists = await loadManifests();
  if (build === null) {
    if (hashed) return (await anywhere(href)) || fetch(request);
    // A file that differs between builds, asked for by a worker that does not say which build it runs.
    return [...lists.values()].some((list) => list.has(href)) ? refuse("Two builds of the app are open: a worker must name the build of the file it asks for (?build=<id>).") : fetch(request);
  }
  const listed = lists.get(build);
  if (listed && listed.has(href)) return (await stored(build, href)) || (hashed ? await anywhere(href) : null) || fromOrigin(build, href);
  return (hashed ? await anywhere(href) : null) || fetch(request);
}
/** The part of a kept file a `Range` request asks for (media readers ask this way, also for a whole file). */
async function ranged(response, request) {
  const asked = request.headers.get("range");
  if (!asked || response.status !== 200) return response;
  const bytes = await response.arrayBuffer(), size = bytes.byteLength, match = /^bytes=(\d*)-(\d*)$/.exec(asked.trim());
  const headers = new Headers({ "content-type": response.headers.get("content-type") || "application/octet-stream", "accept-ranges": "bytes" });
  let start = match && match[1] ? Number(match[1]) : NaN, end = match && match[2] ? Number(match[2]) : size - 1;
  // "bytes=-n": the last n bytes.
  if (match && !match[1] && match[2]) { start = Math.max(0, size - Number(match[2])); end = size - 1; }
  end = Math.min(end, size - 1);
  if (!match || !(start >= 0) || start > end) { headers.set("content-range", `bytes */${size}`); return new Response(null, { status: 416, statusText: "Range Not Satisfiable", headers }); }
  headers.set("content-range", `bytes ${start}-${end}/${size}`);
  headers.set("content-length", String(end - start + 1));
  return new Response(bytes.slice(start, end + 1), { status: 206, statusText: "Partial Content", headers });
}
const everyClient = () => self.clients.matchAll({ type: "window", includeUncontrolled: true });
const note = async (key) => { const kept = await (await caches.open(TABS)).match(key); return kept ? kept.text() : ""; };

const pause = (ms) => new Promise((done) => setTimeout(done, ms));
let queue = Promise.resolve();
/** Drops the records of closed tabs, then the previous builds no open tab was loaded with. One at a time. */
const sweep = () => (queue = queue.catch(() => undefined).then(async () => {
  const map = await loadTabs(), state = await caches.open(TABS);
  const open = new Set((await everyClient()).map((client) => client.id));
  for (const [id, entry] of map) if (!open.has(id) && !(entry.starting_ms && Date.now() - entry.starting_ms < STARTING_MS)) { map.delete(id); await state.delete(TAB + encodeURIComponent(id)); }
  const used = new Set([BUILD.id, ...[...map.values()].map((entry) => entry.build)]);
  // Only builds that were here when this one took over are previous ones: a newer build being fetched is not touched.
  let retired = [];
  try { retired = JSON.parse(await note(RETIRED) || "[]"); } catch { /* nothing known to be previous */ }
  const left = [];
  for (const id of retired) { if (used.has(id)) left.push(id); else { await caches.delete(PREFIX + id); await state.delete(FILES + id); } }
  if (left.length !== retired.length) { await state.put(RETIRED, new Response(JSON.stringify(left))); await loadManifests(true); }
  olderKept = left.length > 0;
}));

self.addEventListener("install", (event) => {
  // A newer worker waits until the person chooses "Reload" (the page then sends `activate`): it never takes over by itself.
  event.waitUntil(BUILD ? precache() : self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    if (!BUILD) { await self.registration.unregister(); return; }
    const state = await caches.open(TABS);
    const others = (await caches.keys()).filter((name) => name.startsWith(PREFIX) && name !== CACHE).map((name) => name.slice(PREFIX.length));
    // The build that was active until now: every tab open at this moment without a record was loaded with it, and
    // keeps being answered from it until the tab reloads.
    const was = await note(ACTIVE);
    const previous = was && was !== BUILD.id && others.includes(was) ? was : others[others.length - 1];
    if (previous) { const map = await loadTabs(); for (const client of await everyClient()) if (!map.has(client.id)) await remember(client.id, previous); }
    await state.put(RETIRED, new Response(JSON.stringify(others)));
    olderKept = others.length > 0;
    await state.put(ACTIVE, new Response(BUILD.id));
    // A previous worker's clean-up may have met this build's cache half-written: it is completed before it is used.
    if ((await (await caches.open(CACHE)).keys()).length < files.size) await precache().catch(() => undefined);
    await loadManifests(true);
    await sweep();
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "activate") void self.skipWaiting();
  if (event.data && event.data.type === "build" && event.ports[0]) event.ports[0].postMessage(BUILD ? { id: BUILD.id, version: BUILD.version, builtAt_ms: BUILD.builtAt_ms } : null);
});

const stored = async (build, url) => (await caches.has(PREFIX + build)) ? (await (await caches.open(PREFIX + build)).match(url)) || null : null;
/** A file with its content hash in its name is the same file in whichever build keeps it. */
async function anywhere(url) {
  for (const name of await caches.keys()) {
    if (!name.startsWith(PREFIX)) continue;
    const kept = await (await caches.open(name)).match(url);
    if (kept) return kept;
  }
  return null;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (!BUILD || request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(scope) || isHostPath(url.pathname)) return;
  const href = url.origin + url.pathname;
  // An app route is a path without a file extension under one of the app's own screens; the page of the build answers
  // it. Any other path a person navigates to belongs to whoever serves the origin.
  const route = request.mode === "navigate" && !/\.[A-Za-z0-9]{1,8}$/.test(url.pathname) && routes.has(url.pathname.slice(base.length).split("/")[0]);
  const hashed = /[.-][0-9a-f]{16,}\.[a-z0-9]+$/i.test(url.pathname);
  const tag = url.searchParams.get("build");
  if (tag && !route) { event.respondWith(ofBuild(tag, href, hashed).then((answer) => ranged(answer, request))); return; }
  // A path that is in no kept build is not ours. Until the lists of the previous builds are read (a moment after
  // this worker starts) such a request is looked at below and, belonging to no build, passed on as it is.
  if (!route && !files.has(href) && !hashed && older && !older.has(href)) return;
  if (route) {
    // A page being loaded gets the active build, and is recorded as such: it keeps that build when a newer one takes
    // over. The tab it replaces is gone a moment later, and its build with it.
    event.waitUntil((async () => {
      if (event.resultingClientId) await remember(event.resultingClientId, BUILD.id, true);
      await pause(SWEEP_AFTER_MS); await sweep(); await pause(STARTING_MS); await sweep();
    })());
    event.respondWith((async () => (await stored(BUILD.id, INDEX)) || fetch(request))());
    return;
  }
  // Answered from the build the request belongs to — by that build's own list of files, so also a file the newest
  // build no longer has — and never with another build's bytes. Only a file with its content hash in its name is the
  // same file wherever it is kept.
  event.respondWith(ofOwner(event, href, hashed).then((answer) => ranged(answer, request)));
});

if (BUILD) void loadManifests();
