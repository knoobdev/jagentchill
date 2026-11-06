// Downloads go through real HTTP against a local server. The recorder driver and the clock are stand-ins (there is
// no camera or MediaRecorder in this process): the session, storage and recovery logic under test is real.
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { after, before, test } from "node:test";
import {
  CONNECTOR_MAX_SELECTION, CONNECTOR_PAGE_SIZE, RECORDING_COUNTDOWN_SECONDS, RECORDING_FLUSH_MS, RECORDING_STORAGE_CHECK_MS, RecordingSession, STOCK_PAGE_SIZE, TRANSFER_CHUNK_BYTES, URL_MAX_REDIRECTS, URL_STALL_TIMEOUT_MS,
  UrlImportError, checkImportUrl, checkStarterCatalogue, connectorErrorMessage, connectorMenuItem, downloadMedia, isPrivateHost, memorySink, message, parseSendFromPhonePayload, recordingCountdown, recordingName,
  recordingSources, recordingStorageLow, recoverableRecordings, remainingChunks, searchStarterItems, sendFromPhoneAccess, sendFromPhonePayload, sha256Hex, slatePreflight, slateSize, starterImport, stockSectionState,
  toggleConnectorSelection, urlImportRoute, type RecorderDriver, type RecordingManifest, type RecordingStore,
} from "../src/index.ts";
import { fixture } from "./support/fixtures.ts";
import { MIB, SECOND } from "./support/project.ts";

let origin = "", hits: string[] = [];
const routes: Record<string, (request: IncomingMessage, response: ServerResponse) => void> = {
  "/clip.mp4": (_, response) => {
    const bytes = fixture("h264-aac.mp4");
    response.writeHead(200, { "content-type": "video/mp4", "content-length": bytes.length, "access-control-allow-origin": "*" });
    // Three writes, so progress is observable.
    response.write(bytes.subarray(0, 20_000));
    setTimeout(() => { response.write(bytes.subarray(20_000, 40_000)); setTimeout(() => response.end(bytes.subarray(40_000)), 15); }, 15);
  },
  "/page": (_, response) => { response.writeHead(200, { "content-type": "text/html; charset=utf-8" }); response.end("<html>not a video</html>"); },
  "/download": (_, response) => { response.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": 'attachment; filename="voice memo.mp3"' }); response.end(fixture("tone.mp3")); },
  "/stall.mp4": (_, response) => { response.writeHead(200, { "content-type": "video/mp4", "content-length": 5_000_000 }); response.write(new Uint8Array(4096)); },
  "/missing.mp4": (_, response) => { response.writeHead(404); response.end(); },
  "/short.mp4": (_, response) => { response.writeHead(200, { "content-type": "video/mp4", "content-length": 9000 }); response.write(new Uint8Array(100)); setTimeout(() => response.destroy(), 20); },
};
const server = createServer((request, response) => {
  const path = new URL(request.url ?? "/", "http://x").pathname;
  hits.push(path);
  const hop = path.match(/^\/hop\/(\d+)$/);
  if (hop) { const left = Number(hop[1]); response.writeHead(302, { location: left > 0 ? `/hop/${left - 1}` : "/clip.mp4" }); return void response.end(); }
  (routes[path] ?? routes["/missing.mp4"])(request, response);
});
before(() => new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => { origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`; resolve(); })));
after(() => { server.closeAllConnections(); server.close(); });
// The test server is on loopback, which the address rule refuses; the tests reach it through an allow-listed alias.
const local = (path: string) => `http://media.test${path}`;
const viaLoopback: typeof fetch = (input, init) => fetch(String(input).replace("http://media.test", origin), init);
const allow = async () => ({ allowed: true as const });

test("Direct download: an MP4 served with permissive CORS is downloaded with progress and its provenance records the URL", async () => {
  const sink = memorySink(), progress: number[] = [];
  const downloaded = await downloadMedia({ url: local("/clip.mp4"), sink, fetch: viaLoopback, evaluateQuota: allow, onProgress: (state) => progress.push(state.fraction!) });
  assert.equal(sha256Hex(sink.bytes()), sha256Hex(fixture("h264-aac.mp4")));
  assert.deepEqual([downloaded.name, downloaded.mimeType, downloaded.size], ["clip.mp4", "video/mp4", fixture("h264-aac.mp4").length]);
  assert.deepEqual(downloaded.provenance, { source: "url", url: local("/clip.mp4") });
  assert.ok(progress.length >= 2 && progress.at(-1) === 1 && progress[0] < 1, `progress ${progress}`);
  assert.deepEqual(urlImportRoute({ platform: "web", corsAllowed: true, gatewayConnected: false }), { route: "direct" });
  assert.deepEqual(urlImportRoute({ platform: "desktop", corsAllowed: false, gatewayConnected: false }), { route: "direct" });
  // A generic content type is accepted on the strength of the file name.
  const named = await downloadMedia({ url: local("/download"), sink: memorySink(), fetch: viaLoopback, evaluateQuota: allow });
  assert.deepEqual([named.name, named.mimeType], ["voice memo.mp3", "audio/mpeg"]);
});

test("Not a media file: a URL that returns text/html creates nothing and shows \"The link does not point to a supported media file\"", async () => {
  const sink = memorySink();
  await assert.rejects(downloadMedia({ url: local("/page"), sink, fetch: viaLoopback, evaluateQuota: allow }), (error: unknown) => error instanceof UrlImportError && error.message === "The link does not point to a supported media file" && error.reason === "not-media");
  assert.equal(sink.bytes().length, 0);
});

test("Web without CORS and without Gateway: the message states that a connected host is required to import this link", () => {
  const blocked = urlImportRoute({ platform: "web", corsAllowed: false, gatewayConnected: false });
  assert.equal(blocked.route, "blocked");
  assert.equal(blocked.route === "blocked" && blocked.message.text, "A connected host is required to import this link");
  assert.deepEqual(urlImportRoute({ platform: "web", corsAllowed: false, gatewayConnected: true }), { route: "gateway" });
});

test("Stalled download: with no bytes arriving for the stall timeout the download is aborted, the partial file removed and the failure names the host", async () => {
  assert.equal(URL_STALL_TIMEOUT_MS, 30_000);
  const sink = memorySink(), started = Date.now();
  // The 30 s rule, run here with a 200 ms timeout.
  await assert.rejects(downloadMedia({ url: local("/stall.mp4"), sink, fetch: viaLoopback, evaluateQuota: allow, stallTimeoutMs: 200 }),
    (error: unknown) => error instanceof UrlImportError && error.reason === "stalled" && error.message === "Download from media.test failed: no data received for 30 seconds");
  assert.ok(Date.now() - started < 3000);
  assert.equal(sink.bytes().length, 0, "the partial file is removed");
});

test("URL import follows at most 5 redirects, checks size against quota before and during the download, and can be cancelled", async () => {
  assert.equal(URL_MAX_REDIRECTS, 5);
  hits = [];
  const five = await downloadMedia({ url: local("/hop/4"), sink: memorySink(), fetch: viaLoopback, evaluateQuota: allow });
  assert.equal(five.size, fixture("h264-aac.mp4").length);
  assert.equal(hits.filter((path) => path.startsWith("/hop/")).length, 5);
  await assert.rejects(downloadMedia({ url: local("/hop/5"), sink: memorySink(), fetch: viaLoopback, evaluateQuota: allow }), (error: unknown) => error instanceof UrlImportError && error.reason === "too-many-redirects");
  // Declared size against quota: refused before a single byte is stored.
  const asked: number[] = [], sink = memorySink();
  await assert.rejects(downloadMedia({ url: local("/clip.mp4"), sink, fetch: viaLoopback, evaluateQuota: async (bytes) => { asked.push(bytes); return { allowed: false, required: bytes, available: 0 }; } }), (error: unknown) => error instanceof UrlImportError && error.reason === "quota");
  assert.deepEqual(asked, [fixture("h264-aac.mp4").length]);
  assert.equal(sink.bytes().length, 0);
  // Undeclared size: checked as the bytes arrive.
  const during: number[] = [];
  await downloadMedia({ url: local("/download"), sink: memorySink(), fetch: viaLoopback, evaluateQuota: async (bytes) => { during.push(bytes); return { allowed: true }; } });
  assert.ok(during.length >= 1 && during[0] >= fixture("tone.mp3").length);
  const controller = new AbortController(), cancelled = memorySink();
  const pending = downloadMedia({ url: local("/clip.mp4"), sink: cancelled, fetch: viaLoopback, evaluateQuota: allow, signal: controller.signal, onProgress: () => controller.abort() });
  await assert.rejects(pending, (error: unknown) => error instanceof UrlImportError && error.reason === "cancelled");
  assert.equal(cancelled.bytes().length, 0);
  await assert.rejects(downloadMedia({ url: local("/missing.mp4"), sink: memorySink(), fetch: viaLoopback, evaluateQuota: allow }), /Download from media\.test failed: the server answered 404/);
  await assert.rejects(downloadMedia({ url: local("/short.mp4"), sink: memorySink(), fetch: viaLoopback, evaluateQuota: allow }), /Download from media\.test failed/);
});

test("\"Import from URL\" accepts http and https URLs of 1–2048 characters and refuses private-network and metadata addresses", async () => {
  assert.equal(checkImportUrl("https://example.org/a.mp4").ok, true);
  assert.deepEqual(checkImportUrl(""), { ok: false, reason: "empty" });
  assert.deepEqual(checkImportUrl("ftp://example.org/a.mp4"), { ok: false, reason: "scheme" });
  assert.deepEqual(checkImportUrl("not a url"), { ok: false, reason: "invalid" });
  assert.deepEqual(checkImportUrl(`https://example.org/${"a".repeat(2048)}`), { ok: false, reason: "too-long" });
  assert.equal(checkImportUrl(`https://example.org/${"a".repeat(2048 - 20)}`).ok, true);
  for (const host of ["localhost", "127.0.0.1", "10.1.2.3", "172.16.0.9", "192.168.1.1", "169.254.169.254", "[::1]", "[fd00::1]", "[fe80::1]", "printer.local", "0.0.0.0"]) {
    assert.equal(isPrivateHost(host), true, host);
    assert.deepEqual(checkImportUrl(`http://${host}/a.mp4`), { ok: false, reason: "private-address" }, host);
  }
  assert.equal(isPrivateHost("93.184.216.34"), false);
  assert.equal(isPrivateHost("172.32.0.1"), false);
  // Refused without a request being made.
  hits = [];
  await assert.rejects(downloadMedia({ url: `${origin}/clip.mp4`, sink: memorySink(), evaluateQuota: allow }), /this address is not allowed/);
  assert.deepEqual(hits, []);
});

// ------------------------------------------------------------------------------------------------------- recording
function recordingRig(options: { free?: () => number | null } = {}) {
  let now = 1_800_000_000_000;
  const files = new Map<string, { manifest: RecordingManifest; chunks: Uint8Array[]; finished: boolean }>();
  const store: RecordingStore = {
    begin: async (id, manifest) => { files.set(id, { manifest, chunks: [], finished: false }); },
    append: async (id, chunk) => { files.get(id)!.chunks.push(chunk); },
    finish: async (id) => { files.get(id)!.finished = true; },
    unfinished: async () => [...files].filter(([, file]) => !file.finished).map(([id, file]) => ({ id, ...file.manifest, bytes: file.chunks.reduce((sum, chunk) => sum + chunk.length, 0) })),
    discard: async (id) => { files.delete(id); },
  };
  let emit: (chunk: Uint8Array) => void = () => undefined, paused = false, timeslice = 0;
  const driver: RecorderDriver = { mimeType: "video/webm", start: async (ms, onData) => { timeslice = ms; emit = onData; }, pause: () => { paused = true; }, resume: () => { paused = false; }, stop: async () => { emit(new Uint8Array(10)); } };
  const intervals: { run: () => void; ms: number }[] = [];
  /** Advances the clock; the driver delivers one chunk per flush interval of recorded time. */
  const advance = async (ms: number) => {
    for (let passed = 0; passed < ms; passed += 1000) {
      now += 1000;
      if (!paused && (passed + 1000) % timeslice === 0) emit(new Uint8Array(1000));
      for (const interval of intervals) if ((now - 1_800_000_000_000) % interval.ms === 0) interval.run();
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
  const make = (id: string, kind: "camera" | "screen" | "voice" = "camera", onStoppedForStorage?: (result: unknown) => void) => new RecordingSession({
    id, projectId: "p1", kind, driver, store, now: () => now, freeBytes: async () => (options.free ? options.free() : 10 * 1024 * MIB), onStoppedForStorage,
    setInterval: ((run: () => void, ms: number) => { intervals.push({ run, ms }); return intervals.length; }) as unknown as typeof setInterval, clearInterval: (() => { intervals.length = 0; }) as unknown as typeof clearInterval,
  });
  return { make, advance, files, store, timeslice: () => timeslice };
}

test("Camera recording: 10 s recorded from the camera and stopped becomes a recording of 10 s with provenance recorded", async () => {
  const rig = recordingRig(), recording = rig.make("r1");
  await recording.start();
  await rig.advance(10_000);
  const result = await recording.stop();
  assert.equal(result.duration, 10 * SECOND);
  assert.deepEqual(result.provenance, { source: "recorded" });
  assert.match(result.name, /^Camera recording \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}$/);
  assert.equal(result.bytes, 5 * 1000 + 10);
  assert.equal(rig.files.get("r1")!.finished, true);
  assert.equal(recordingName("screen", new Date(2026, 9, 5, 7, 4, 9)), "Screen recording 2026-10-05 07.04.09");
  assert.equal(recordingName("voice", new Date(2026, 0, 31, 23, 59, 59)), "Voice recording 2026-01-31 23.59.59");
  // A 3 s countdown precedes screen and camera recording; screen recording is omitted on mobile.
  assert.deepEqual([recordingCountdown("camera"), recordingCountdown("screen"), recordingCountdown("voice"), RECORDING_COUNTDOWN_SECONDS], [3, 3, 0, 3]);
  assert.deepEqual(recordingSources("mobile"), ["camera", "voice"]);
  assert.deepEqual(recordingSources("web"), ["camera", "screen", "voice"]);
});

test("Pause and resume: 4 s recorded, 10 s paused, 6 s recorded gives an asset of 10 s — paused time is not recorded", async () => {
  const rig = recordingRig(), recording = rig.make("r2");
  await recording.start();
  await rig.advance(4000);
  recording.pause();
  assert.equal(recording.state, "paused");
  await rig.advance(10_000);
  assert.equal(recording.elapsedMs, 4000, "the elapsed time stands still while paused");
  recording.resume();
  await rig.advance(6000);
  assert.equal(recording.elapsedMs, 10_000);
  assert.equal((await recording.stop()).duration, 10 * SECOND);
});

test("Interrupted recording: after the app is terminated 20 s into a recording, the library offers \"Recovered recording\" with at least the first 18 s", async () => {
  const rig = recordingRig(), recording = rig.make("r3");
  await recording.start();
  assert.equal(rig.timeslice(), RECORDING_FLUSH_MS);
  assert.equal(RECORDING_FLUSH_MS, 2000);
  await rig.advance(20_000);
  // The process dies here: `stop` is never called. A new session of the app looks at the store.
  const recovered = await recoverableRecordings(rig.store, "p1");
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].label, "Recovered recording");
  // One chunk reached storage every 2 s: at least 9 of them (18 s) are there.
  assert.ok(recovered[0].bytes >= 9 * 1000, `bytes ${recovered[0].bytes}`);
  assert.deepEqual([recovered[0].kind, recovered[0].mimeType], ["camera", "video/webm"]);
  assert.deepEqual(await recoverableRecordings(rig.store, "another-project"), []);
});

test("Storage runs out: when free space after the reserve falls to 90 MiB, recording stops within 5 s, the captured part is kept and a notice states that storage ran low", async () => {
  let free = 2000 * MIB;
  const stopped: { duration: number; notice: { text: string } | null; stoppedForStorage: boolean }[] = [];
  const rig = recordingRig({ free: () => free }), recording = rig.make("r4", "voice", (result) => stopped.push(result as (typeof stopped)[number]));
  await recording.start();
  await rig.advance(7000);
  free = 90 * MIB + 50 * MIB;
  await rig.advance(5000);
  assert.equal(RECORDING_STORAGE_CHECK_MS, 5000);
  assert.equal(recording.state, "stopped");
  assert.equal(stopped.length, 1);
  assert.ok(stopped[0].duration >= 7 * SECOND && stopped[0].duration <= 12 * SECOND, `duration ${stopped[0].duration}`);
  assert.equal(stopped[0].stoppedForStorage, true);
  assert.equal(stopped[0].notice!.text, "Recording stopped because storage ran low");
  assert.equal(rig.files.get("r4")!.finished, true, "the captured part is kept");
  assert.equal(recordingStorageLow(149 * MIB), true);
  assert.equal(recordingStorageLow(150 * MIB), false);
  assert.equal(recordingStorageLow(null), false);
});

// --------------------------------------------------------------------------------------------- Gateway-backed sources
const host = (over: Partial<{ connected: boolean; features: string[]; configured: boolean; name: string }> = {}) => ({ connected: true, features: ["connectors"], configured: true, name: "Studio Mac", ...over });

test("No Gateway: without a connected host both connector items are disabled with the explanation that a host is required", () => {
  for (const [connector, label] of [["google-drive", "Google Drive"], ["dropbox", "Dropbox"]] as const) {
    const item = connectorMenuItem(connector, null, "editor");
    assert.deepEqual([item.enabled, item.hint?.text], [false, `Connect a host to import from ${label}`]);
  }
  // A host that does not advertise the `connectors` feature flag counts the same.
  assert.equal(connectorMenuItem("dropbox", host({ features: [] }), "admin").enabled, false);
  assert.equal(connectorMenuItem("dropbox", host(), "editor").opens, "browser");
});

test("Not configured: with no OAuth client stored, an editor choosing \"Dropbox\" gets the set-up sheet without a link, and nothing is downloaded", () => {
  const editor = connectorMenuItem("dropbox", host({ configured: false }), "editor");
  assert.deepEqual([editor.opens, editor.hint?.text, editor.setupLink], ["setup-sheet", "Set up Dropbox on Studio Mac", false]);
  assert.equal(connectorMenuItem("dropbox", host({ configured: false }), "admin").setupLink, true);
});

test("Authorisation revoked: the transfer job fails with \"Reconnect Google Drive in Settings\"", () => {
  assert.equal(connectorErrorMessage("google-drive", { code: "connector/auth-revoked" }).text, "Reconnect Google Drive in Settings");
  assert.equal(connectorErrorMessage("dropbox", { code: "connector/auth-expired" }).text, "Reconnect Dropbox in Settings");
  assert.equal(connectorErrorMessage("dropbox", { code: "connector/rate-limited" }).text, "Dropbox is busy — retrying");
  assert.equal(connectorErrorMessage("google-drive", { code: "connector/file-gone", fileName: "take 4.mov" }).text, "take 4.mov is no longer available");
  // The browser lists 50 per page and selects at most 100 files.
  assert.deepEqual([CONNECTOR_PAGE_SIZE, CONNECTOR_MAX_SELECTION, STOCK_PAGE_SIZE], [50, 100, 30]);
  let selected: string[] = [];
  for (let index = 0; index < 105; index++) selected = toggleConnectorSelection(selected, `f${index}`);
  assert.equal(selected.length, 100);
  assert.equal(toggleConnectorSelection(selected, "f3").length, 99);
});

test("Unpaired phone: the code carries only the project id and the host id, and no file is accepted before pairing is approved", () => {
  const payload = sendFromPhonePayload("3f1c7a52-0000-4000-8000-000000000001", "host-42");
  assert.deepEqual(parseSendFromPhonePayload(payload), { projectId: "3f1c7a52-0000-4000-8000-000000000001", gatewayId: "host-42" });
  assert.deepEqual([...new URLSearchParams(payload.split("?")[1]).keys()], ["project", "host"]);
  assert.equal(parseSendFromPhonePayload(`${payload}&token=abc`), null);
  assert.equal(parseSendFromPhonePayload("https://example.org"), null);
  assert.deepEqual(sendFromPhoneAccess({ paired: false }), { allowed: false, next: "pair" });
  assert.deepEqual(sendFromPhoneAccess({ paired: true, role: "editor" }), { allowed: true });
  const viewer = sendFromPhoneAccess({ paired: true, role: "viewer" });
  assert.equal(!viewer.allowed && viewer.next === "refuse" && viewer.message.text, "Your role on this host is view-only");
  assert.equal(message("media.devices.needs-host").text, "Connect a host to import from your devices");
});

test("Interrupted transfer: a transfer that dropped at 60 % resumes from the last completed 4 MiB chunk", () => {
  assert.equal(TRANSFER_CHUNK_BYTES, 4 * MIB);
  const size = 50 * MIB, completed = Math.floor((0.6 * size) / TRANSFER_CHUNK_BYTES);
  const remaining = remainingChunks(size, completed);
  assert.equal(completed, 7);
  assert.deepEqual(remaining[0], { index: 7, start: 28 * MIB, end: 32 * MIB });
  assert.deepEqual(remaining.at(-1), { index: 12, start: 48 * MIB, end: 50 * MIB });
  assert.equal(remaining.length, 6);
  assert.deepEqual(remainingChunks(size, 13), []);
});

test("No provider: with no stock provider enabled the Library section shows the connect message and no results", () => {
  assert.deepEqual(stockSectionState({ enabledSources: 0, gatewayConnected: true, role: "admin" }), { state: "connect", message: message("media.stock.connect"), link: true });
  assert.equal(message("media.stock.connect").text, "Connect a stock source in Settings");
  const other = stockSectionState({ enabledSources: 0, gatewayConnected: true, role: "editor" });
  assert.equal(other.state === "connect" && other.message.text, "Ask an admin to connect a stock source");
  assert.deepEqual(stockSectionState({ enabledSources: 2, gatewayConnected: true, role: "editor" }), { state: "ready" });
  assert.equal(message("media.stock.error").text, "Couldn't load results");
});

test("the bundled catalogue accepts only CC0-1.0 or project-authored items with complete rows, and a used item carries bundled provenance", () => {
  const items = [
    { id: "music-calm-01", title: "Morning Walk", category: "Calm", licence: "CC0-1.0", sourceUrl: "https://example.org/1", kind: "music" as const },
    { id: "sfx-whoosh-01", title: "Whoosh Été", category: "Transitions", licence: "JAgentChill", sourceUrl: "https://example.org/2", kind: "sfx" as const },
  ];
  assert.deepEqual(checkStarterCatalogue(items), []);
  assert.deepEqual(checkStarterCatalogue([...items, { ...items[0] }, { id: "x", title: "X", category: "Calm", licence: "CC-BY-4.0", sourceUrl: "https://e" }, { id: "y", title: "", category: "Calm", licence: "CC0-1.0", sourceUrl: "" }]),
    [{ id: "music-calm-01", problem: "duplicate-id" }, { id: "x", problem: "licence" }, { id: "y", problem: "missing-field" }]);
  assert.deepEqual(starterImport(items[0], "mp3"), { name: "Morning Walk.mp3", provenance: { source: "bundled", itemId: "music-calm-01", licence: "CC0-1.0", sourceUrl: "https://example.org/1", attributionRequired: false } });
  assert.deepEqual(searchStarterItems(items, "ete").map((item) => item.id), ["sfx-whoosh-01"]);
  assert.deepEqual(searchStarterItems(items, "", "Calm").map((item) => item.id), ["music-calm-01"]);
  assert.deepEqual(slateSize({ width: 3840, height: 2160 }), { width: 1920, height: 1080 });
  assert.deepEqual(slateSize({ width: 1080, height: 1920 }), { width: 1080, height: 1920 });
  assert.equal(slatePreflight(0), null);
});
