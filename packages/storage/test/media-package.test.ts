// Fakes declared: the stores of `support/platforms.ts` (fake-indexeddb + in-memory OPFS for web, node:sqlite + node:fs for mobile, the real desktop store in a temp dir); free space is a stubbed `available()` where a scenario fixes an exact number of bytes; the 2 GiB of "Budget enforcement" are entries of a size-only file store (no test process should write 2 GiB into memory), with the same eviction run for real bytes at a small budget; the 10 GiB package of "Large package memory bound" is 1 GiB by default (`JC_LARGE_PACKAGE_GIB=10` runs the full size) — the import is streamed, so its memory does not depend on the size; classic bundles are ZIPs built by this package's own writer in the layout of `projects.OpenCut classic data import`.
import assert from "node:assert/strict";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { addAsset, sha256, toHex, utf8 } from "@jagentchill/editor-core";
import { createProjectDocument, type ProjectDocument } from "@jagentchill/protocol";
import { classic, toClassicView } from "../../editor-core/test/support/classic.ts";
import {
  bytesZipSource, CACHE_BUDGET_MAX, CACHE_BUDGET_MIN, clampCacheBudget, createCacheStore, createPreferences, createZipWriter, DEFAULT_CACHE_BUDGET, emptyTrash, evaluateStorageCapacity, expireTrash,
  exportProjectPackage, FILE_FORMATS, importProjectPackage, ingestClassic, isImportedUnopened, isStorageError, listTrash, loadProject, memorySink, migrateRecord, openClassicBundle, openMobileStorage, openPackage,
  openWebStorage, PackageError, packageFileName, PREFERENCES, readJsonFormat, restoreProject, saveMediaAsset, saveMediaAssetStream, saveProject, savedSounds, splitRecord, storageUsage, StorageError, trashBytes, trashDocument,
  trashProject, TRASH_RETENTION_MS, writeJsonFormat, writePackage, type FileStore, type PackageSink, type RecordStore, type StoragePort, type ZipSource,
} from "../src/index.ts";
import { filePackageSink, fileZipSource, nodeSha256, openDesktopStorage } from "../src/desktop.ts";
import { fakeBrowser, nodeFileDriver, nodeSqlDriver, platforms, temporaryDirectory } from "./support/platforms.ts";

const NOW = 1_800_000_000_000, MiB = 1024 * 1024, GiB = 1024 * MiB;
const ids = (prefix = "id") => { let count = 0; return () => `${prefix}${++count}`; };
const project = (id = "p1", name = "Project"): ProjectDocument => createProjectDocument({ id, mainSceneId: `${id}-scene`, mainTrackId: `${id}-track`, now_ms: NOW, name });
const bytes = (length: number, seed = 1) => Uint8Array.from({ length }, (_, index) => (index * 31 + seed) & 255);
const withAssets = (document: ProjectDocument, assets: { id: string; data: Uint8Array; name?: string }[]) => assets.reduce((current, asset) => addAsset(current, { now_ms: NOW, newId: ids() }, { id: asset.id, name: asset.name ?? `${asset.id}.mp4`, type: "video", size: asset.data.length, contentHash: toHex(sha256(asset.data)) }).document, document);
const sinkOf = (): PackageSink & { bytes(): Uint8Array; aborted: boolean; closed: boolean } => { const memory = memorySink(); const sink = Object.assign(memory, { aborted: false, closed: false, close: async () => { sink.closed = true; }, abort: async () => { sink.aborted = true; } }); return sink; };

// Requirement: Atomic media writes with rollback
test("Atomic media writes with rollback — Scenario: Metadata failure", async () => {
  for (const platform of platforms()) {
    const port = await platform.open();
    await saveProject(port, project());
    const failingRecord = async () => { throw new StorageError("Unavailable", "the record store is gone"); };
    await assert.rejects(() => saveMediaAsset(port, "p1", "a1", bytes(2048), failingRecord, { extension: "mp4" }), (error) => isStorageError(error, "Unavailable"));
    await assert.rejects(() => saveMediaAssetStream(port, "p1", "a2", [bytes(1024), bytes(1024, 2)], failingRecord, { extension: "mp4" }), (error) => isStorageError(error, "Unavailable"));
    const reopened = platform.name.startsWith("desktop") ? port : await platform.open();
    assert.deepEqual([await reopened.listMedia("p1"), await reopened.listMediaFiles(), (await loadProject(reopened, "p1")).document.media.assets], [[], [], []], `${platform.name}: the file is removed and the asset is not listed after reload`);
    // A store quota error surfaces as QuotaExceeded, and nothing remains either.
    await assert.rejects(() => saveMediaAsset(port, "p1", "a3", bytes(16), async () => { throw Object.assign(new Error("The quota has been exceeded."), { name: "QuotaExceededError" }); }), (error) => isStorageError(error) || (error as Error).name === "QuotaExceededError");
    assert.deepEqual(await port.listMediaFiles(), []);
    // Both steps succeed: the file is there under the asset's name, complete, with its hash.
    const stored = await saveMediaAssetStream(port, "p1", "ok", [bytes(700), bytes(300, 5)], async () => undefined, { extension: "mov" });
    const whole = new Uint8Array(1000); whole.set(bytes(700)); whole.set(bytes(300, 5), 700);
    assert.deepEqual([stored.contentHash, stored.size, await port.readMedia("p1", "ok")], [toHex(sha256(whole)), 1000, whole]);
  }
});

test("Atomic media writes with rollback — Scenario: Project deletion leaves nothing", async () => {
  /** A project with everything a project can own on a device. */
  const fill = async (port: StoragePort) => {
    for (const id of ["doomed", "other"]) {
      await saveProject(port, withAssets(project(id), [{ id: "a1", data: bytes(512) }, { id: `own-${id}`, data: bytes(64, id.length) }]));
      await port.writeMedia(id, "a1", bytes(512), { extension: "mp4" });
      await port.writeMedia(id, `own-${id}`, bytes(64, id.length), { extension: "mp4" });
      await port.putBlob("thumbnail", id, "a1.jpg", bytes(32)); await port.putBlob("cover", id, "cover.jpg", bytes(16));
      await port.putSnapshot(id, { id: "s1", kind: "manual", created_ms: NOW, label: "", duration: 0, schemaVersion: 32, record: "{}" });
      await port.putBackup(id, { sourceVersion: 31, time_ms: NOW, record: "{}" });
      await port.appendJournal(id, { baseRevision: 0, revision: 1, commandType: "x", label: "x", patch: [] });
      await port.putSession(`lock-${id}`, { owner: "tab", heartbeat_ms: NOW });
      await port.cache.put({ kind: "proxy", contentHash: `hash-${id}` }, bytes(128), { projectId: id });
    }
    await port.deleteProject("doomed");
    assert.deepEqual([await port.hasProject("doomed"), await port.listMedia("doomed"), await port.listSnapshots("doomed"), await port.listBackups("doomed"), await port.readJournal("doomed"), await port.getSession("lock-doomed"), await port.cache.has({ kind: "proxy", contentHash: "hash-doomed" })], [false, [], [], [], [], undefined, false]);
    assert.deepEqual([await port.readMedia("other", "a1"), await port.mediaReferences(toHex(sha256(bytes(512)))), (await port.listSnapshots("other")).length, await port.cache.has({ kind: "proxy", contentHash: "hash-other" })], [bytes(512), 1, 1, true], "the other project keeps the shared bytes and everything of its own");
  };
  // Web: no IndexedDB row and no OPFS directory keyed by the project id.
  const browser = fakeBrowser(), web = await openWebStorage(browser);
  await fill(web);
  web.close();
  const database = await new Promise<IDBDatabase>((resolve, reject) => { const request = browser.indexedDB.open("jagentchill"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  for (const store of Array.from(database.objectStoreNames)) {
    const keys = await new Promise<IDBValidKey[]>((resolve) => { const request = database.transaction(store).objectStore(store).getAllKeys(); request.onsuccess = () => resolve(request.result); });
    assert.deepEqual(keys.filter((key) => String(key).includes("doomed")), [], `object store ${store}`);
  }
  const projects = browser.opfs.children.get("projects") as { children: Map<string, unknown> };
  assert.deepEqual([...projects.children.keys()], ["other"], "the OPFS directory itself is gone");
  // Desktop: the <library>/<projectId>/ directory is gone, and no index row names the project.
  const library = temporaryDirectory("library"), desktop = await openDesktopStorage({ library, cache: temporaryDirectory("cache") });
  await fill(desktop);
  desktop.close();
  assert.equal(existsSync(join(library, "doomed")), false);
  const index = new DatabaseSync(join(library, "library.sqlite"));
  assert.deepEqual(index.prepare("SELECT store, key FROM entries WHERE key LIKE '%doomed%' OR value LIKE '%doomed%'").all(), []);
  index.close();
  // Mobile: no SQLite row and no directory.
  const documents = temporaryDirectory("mobile"), mobile = await openMobileStorage(nodeSqlDriver(join(documents, "records.db")), nodeFileDriver(join(documents, "files")));
  await fill(mobile);
  const rows = new DatabaseSync(join(documents, "records.db"));
  assert.deepEqual(rows.prepare("SELECT store, key FROM records WHERE key LIKE '%doomed%'").all(), []);
  rows.close();
  assert.deepEqual(readdirSync(join(documents, "files", "projects")), ["other"]);
});

// Requirement: Cache management
test("Cache management — Scenario: Clear proxies", async () => {
  for (const platform of platforms()) {
    const port = await platform.open();
    await saveProject(port, withAssets(project(), [{ id: "a1", data: bytes(256) }]));
    await port.writeMedia("p1", "a1", bytes(256), { extension: "mp4" });
    await port.putSnapshot("p1", { id: "s1", kind: "manual", created_ms: NOW, label: "", duration: 0, schemaVersion: 32, record: "{}" });
    await port.cache.put({ kind: "proxy", contentHash: "h1", variant: "540p" }, bytes(4000), { projectId: "p1" });
    await port.cache.put({ kind: "waveform", contentHash: "h1" }, bytes(300), { projectId: "p1" });
    await port.cache.put({ kind: "filmstrip", contentHash: "h1" }, bytes(200), { projectId: "p1" });
    assert.deepEqual((await port.cache.usage()).byCategory, { Proxies: 4000, "Thumbnails and filmstrips": 200, Waveforms: 300, "Render cache": 0, "AI results": 0 }, platform.name);
    assert.equal(await port.cache.clear("Proxies"), 4000);
    const usage = await port.cache.usage();
    assert.deepEqual([usage.byCategory.Proxies, usage.byCategory.Waveforms, await port.cache.get({ kind: "proxy", contentHash: "h1", variant: "540p" })], [0, 300, undefined], "proxy usage is 0; the proxy is regenerated on demand");
    assert.deepEqual([(await loadProject(port, "p1")).document.metadata.id, await port.readMedia("p1", "a1"), (await port.listSnapshots("p1")).length], ["p1", bytes(256), 1], "all projects still open; originals, records and snapshots are untouched");
    // "Clear all caches", and the usage page: by category and per project.
    const pageBefore = await storageUsage(port);
    assert.deepEqual([pageBefore.byCategory.Media, pageBefore.byCategory.Waveforms, pageBefore.byCategory["Thumbnails and filmstrips"], pageBefore.byCategory["Snapshots and backups"], pageBefore.byCategory.Projects > 0], [256, 300, 200, 2, true]);
    assert.equal(await port.cache.clear(), 500);
    assert.deepEqual([(await port.cache.usage()).total, await port.readMedia("p1", "a1")], [0, bytes(256)]);
    // The index is derived: after it is lost the entries are found again from the cache files, and a purged file (mobile) is simply absent.
    await port.cache.put({ kind: "render", contentHash: "h2" }, bytes(64));
    await port.rebuildIndexes();
    assert.deepEqual([(await port.cache.usage()).byKind.render, await port.cache.get({ kind: "render", contentHash: "h2" })], [64, bytes(64)]);
  }
  assert.deepEqual([DEFAULT_CACHE_BUDGET, CACHE_BUDGET_MIN, CACHE_BUDGET_MAX, clampCacheBudget(1), clampCacheBudget(500 * GiB)], [{ desktop: 10 * GiB, web: 2 * GiB, mobile: 1 * GiB }, 256 * MiB, 100 * GiB, 256 * MiB, 100 * GiB]);
});

/** A file store that keeps sizes only, for budgets no test should materialise. */
function sizeOnlyStores(): { records: RecordStore; files: FileStore } {
  const rows = new Map<string, unknown>(), sizes = new Map<string, number>();
  const records: RecordStore = {
    get: async (store, key) => rows.get(`${store}\n${key}`), put: async (store, key, value) => { rows.set(`${store}\n${key}`, value); }, delete: async (store, key) => { rows.delete(`${store}\n${key}`); },
    keys: async (store, prefix = "") => [...rows.keys()].filter((key) => key.startsWith(`${store}\n${prefix}`)).map((key) => key.slice(store.length + 1)),
  };
  const files: FileStore = {
    write: async (path, data) => { sizes.set(path, data.length); }, read: async () => new Uint8Array(),
    writeStream: async (path, source) => { let size = 0; for await (const chunk of source) size += chunk.length; sizes.set(path, size); return size; },
    readStream: async function* () { /* sizes only */ }, stat: async (path) => (sizes.has(path) ? { path, size: sizes.get(path)!, modified_ms: 0 } : undefined),
    remove: async (path) => { sizes.delete(path); }, removeTree: async () => undefined, move: async () => undefined,
    list: async (prefix) => [...sizes].filter(([path]) => path.startsWith(prefix)).map(([path, size]) => ({ path, size, modified_ms: 0 })), available: async () => null,
  };
  return { records, files };
}
/** A source of `size` bytes that never holds more than one zero-filled chunk. */
async function* zeros(size: number): AsyncGenerator<Uint8Array> { const chunk = new Uint8Array(4 * MiB); for (let left = size; left > 0; left -= chunk.length) yield left >= chunk.length ? chunk : chunk.subarray(0, left); }

test("Cache management — Scenario: Budget enforcement", async () => {
  const { records, files } = sizeOnlyStores();
  let now = NOW;
  const cache = createCacheStore("web", records, files, () => now++);
  assert.equal(await cache.budget(), 2 * GiB, "the default budget on web");
  // Four 512 MiB entries fill the budget exactly; one more byte exceeds it.
  for (const hash of ["oldest", "second", "third", "fourth"]) await cache.put({ kind: "render", contentHash: hash }, zeros(512 * MiB));
  assert.equal((await cache.usage()).total, 2 * GiB);
  await cache.get({ kind: "render", contentHash: "oldest" });
  await cache.put({ kind: "waveform", contentHash: "tiny" }, Uint8Array.of(1));
  const usage = await cache.usage();
  assert.ok(usage.total <= 2 * GiB, `usage is at or below 2 GiB (${usage.total})`);
  assert.deepEqual([await cache.has({ kind: "render", contentHash: "second" }), await cache.has({ kind: "render", contentHash: "oldest" }), await cache.has({ kind: "waveform", contentHash: "tiny" })], [false, true, true], "the least recently used entry went; the one just read and the new one stay");
  // The budget is adjustable from 256 MiB to 100 GiB, and lowering it evicts at once.
  assert.equal(await cache.setBudget(1), 256 * MiB);
  assert.ok((await cache.usage()).total <= 256 * MiB);
  // The same eviction with real bytes, on every platform.
  for (const platform of platforms()) {
    const port = await platform.open();
    await port.cache.setBudget(256 * MiB);
    for (const hash of ["a", "b", "c"]) await port.cache.put({ kind: "proxy", contentHash: hash }, zeros(100 * MiB));
    assert.deepEqual([(await port.cache.usage()).total, await port.cache.has({ kind: "proxy", contentHash: "a" }), await port.cache.has({ kind: "proxy", contentHash: "c" })], [200 * MiB, false, true], platform.name);
    await port.cache.clear();
  }
});

test("Cache management — Scenario: Entries in use survive", async () => {
  for (const platform of platforms()) {
    const port = await platform.open();
    const playing = { kind: "proxy" as const, contentHash: "playing" }, job = { kind: "ai-result" as const, contentHash: "matte" };
    await port.cache.put(playing, bytes(1000)); await port.cache.put(job, bytes(500));
    await port.cache.put({ kind: "proxy", contentHash: "idle" }, bytes(2000));
    // The open project's visible range plays one proxy, and a running job uses one result.
    const release = port.cache.hold([playing, job]);
    assert.equal(await port.cache.evictable(), 2000);
    assert.equal(await port.cache.evict(10 * GiB), 2000, platform.name);
    assert.deepEqual([await port.cache.has(playing), await port.cache.has(job), await port.cache.has({ kind: "proxy", contentHash: "idle" })], [true, true, false], "that proxy is not evicted");
    release();
    assert.equal(await port.cache.evict(10 * GiB), 1500);
  }
});

test("Cache management — Scenario: Eviction before rejecting an import (through the cache store)", async () => {
  const base = await platforms()[2].open();
  await base.cache.put({ kind: "proxy", contentHash: "big" }, zeros(8 * MiB));
  // 300 MiB are available after the reserve and the import needs more: evictable cache is released first.
  let free = 350 * MiB;
  const port = Object.assign(Object.create(base) as StoragePort, { available: async () => free });
  const decision = await evaluateStorageCapacity(port, 304 * MiB, { evictCache: async (needed) => { const freed = await base.cache.evict(needed); free += freed; return freed; } });
  assert.deepEqual([decision.allowed, await base.cache.has({ kind: "proxy", contentHash: "big" })], [true, false], "cache entries are evicted and the import succeeds");
});

// Requirement: Trash retention storage
test("Trash retention storage — Scenario: Caches released on trash", async () => {
  for (const platform of platforms()) {
    const port = await platform.open();
    for (const id of ["p1", "p2"]) { await saveProject(port, withAssets(project(id), [{ id: "a1", data: bytes(1024, id.length) }])); }
    await port.writeMedia("p1", "a1", bytes(1024, 2), { extension: "mp4" });
    // Proxies of p1 alone, and one both projects use.
    await port.cache.put({ kind: "proxy", contentHash: "only-p1" }, bytes(3000), { projectId: "p1" });
    await port.cache.put({ kind: "proxy", contentHash: "shared" }, bytes(500), { projectId: "p1" });
    await port.cache.put({ kind: "proxy", contentHash: "shared" }, bytes(500), { projectId: "p2" });
    const before = { cache: (await port.cache.usage()).total, record: splitRecord(await port.readProjectText("p1")).canonical, media: (await port.listMedia("p1")).reduce((sum, entry) => sum + entry.size, 0) };
    const state = await trashProject(port, "p1", NOW);
    assert.deepEqual(state, { kind: "project", deleted_ms: NOW });
    assert.equal(before.cache - (await port.cache.usage()).total, 3000, `${platform.name}: cache usage decreases by what no other project uses`);
    assert.deepEqual([(await port.listMedia("p1")).reduce((sum, entry) => sum + entry.size, 0), splitRecord(await port.readProjectText("p1")).canonical], [before.media, before.record], "the project's media usage is unchanged, and no canonical document changed");
    assert.deepEqual((await port.listProjects()).find((entry) => entry.id === "p1")!.trash, { kind: "project", deleted_ms: NOW });
    const usage = await storageUsage(port);
    assert.ok(usage.byCategory.Trash >= 1024 && usage.byCategory.Trash === await trashBytes(port), "trashed items count toward storage usage under Trash");
  }
});

test("Trash retention storage — Scenario: Trashed project is intact", async () => {
  const DAY = 86_400_000;
  for (const platform of platforms()) {
    const port = await platform.open();
    const document = withAssets(project("p1"), [{ id: "a1", data: bytes(2048) }]);
    await port.writeMedia("p1", "a1", bytes(2048), { extension: "mp4" });
    await port.putBlob("cover", "p1", "cover.jpg", bytes(64));
    await port.writeLibrary("folders", { folders: [{ id: "f1", name: "Work", parentId: null }] });
    const record = JSON.parse(JSON.stringify({ ...document, local: { folderId: "f1", trash: null } }));
    await port.writeProjectText("p1", JSON.stringify(record));
    for (const id of ["s1", "s2"]) await port.putSnapshot("p1", { id, kind: "manual", created_ms: NOW, label: id, duration: 0, schemaVersion: 32, record: "{}" });
    await port.putDocument("script", "sc1", { title: "Pilot", versions: [] });
    await port.putDocument("template", "tp1", { name: "Lower third" }); await port.writeLibraryFile("templates/tp1/preview.mp4", bytes(100));
    assert.deepEqual(await trashProject(port, "p1", NOW), { kind: "project", deleted_ms: NOW, originalFolderId: "f1" });
    await trashDocument(port, "script", "sc1", NOW + 1); await trashDocument(port, "template", "tp1", NOW + 2);
    assert.deepEqual((await listTrash(port)).map((entry) => [entry.kind, entry.id, entry.name, entry.expires_ms - entry.deleted_ms]), [["project", "p1", "Project", TRASH_RETENTION_MS], ["script", "sc1", "Pilot", TRASH_RETENTION_MS], ["template", "tp1", "Lower third", TRASH_RETENTION_MS]], platform.name);
    assert.deepEqual(await expireTrash(port, NOW + 29 * DAY), [], "nothing expires before 30 days");
    // Restored 29 days afterwards: record, media and both snapshots are present.
    await restoreProject(port, "p1");
    const entry = (await port.listProjects())[0];
    assert.deepEqual([entry.trash, entry.folderId, await port.readMedia("p1", "a1"), (await port.listSnapshots("p1")).map((info) => info.id).sort(), (await port.getBlob("cover", "p1", "cover.jpg"))!.length, (await loadProject(port, "p1")).document.media.assets.length], [null, "f1", bytes(2048), ["s1", "s2"], 64, 1]);
    // Left in the trash, an item is deleted for good 30 days (2 592 000 000 ms) after deleted_ms.
    await trashProject(port, "p1", NOW);
    assert.deepEqual((await expireTrash(port, NOW + TRASH_RETENTION_MS)).map((expired) => expired.id), ["p1"]);
    assert.deepEqual([await port.hasProject("p1"), await port.listMedia("p1"), await port.listSnapshots("p1"), await port.getDocument("script", "sc1") !== undefined], [false, [], [], true]);
    assert.ok((await emptyTrash(port)) > 0, "\"Empty trash\" frees what is left");
    assert.deepEqual([await listTrash(port), await port.listDocuments("script"), await port.listDocuments("template"), await port.listLibraryFiles("templates/tp1")], [[], [], [], []]);
  }
});

// Requirement: Package and file formats
async function packagedProject(port: StoragePort, includeMedia = true) {
  const media = [{ id: "a1", data: bytes(70_000, 1), name: "Beach day.mp4" }, { id: "a2", data: bytes(30_000, 2), name: "song.mp3" }, { id: "a3", data: bytes(70_000, 1), name: "Beach day copy.mp4" }];
  let document = withAssets(project("pk", "Holiday: 2026/Cut?"), media);
  document = { ...document, local: { folderId: "f1", trash: null, media: { a1: { storage: "external", externalPath: "/Users/an/secret.mov" } } } } as unknown as ProjectDocument;
  await saveProject(port, document);
  for (const asset of media) await port.writeMedia("pk", asset.id, asset.data, { extension: asset.name.split(".").pop() });
  await port.putBlob("cover", "pk", "cover.jpg", bytes(900, 3)); await port.putBlob("thumbnail", "pk", "project.png", bytes(400, 4));
  await port.putSnapshot("pk", { id: "s1", kind: "manual", created_ms: NOW, label: "", duration: 0, schemaVersion: 32, record: "{}" });
  await port.cache.put({ kind: "proxy", contentHash: "x" }, bytes(100), { projectId: "pk" });
  const sink = sinkOf();
  const summary = await exportProjectPackage(port, "pk", sink, { appVersion: "1.0.0", now_ms: NOW + 5, includeMedia });
  return { sink, summary, media, document };
}
test("Package and file formats: a project package round-trips with its media, cover and thumbnail, and without device-local data", async () => {
  for (const platform of platforms()) {
    const port = await platform.open();
    const { sink, summary, media } = await packagedProject(port);
    assert.deepEqual([summary.fileName, sink.closed, summary.manifest.format, summary.manifest.formatVersion, summary.manifest.schemaVersion, summary.manifest.minReaderSchemaVersion, summary.manifest.appVersion, summary.manifest.exported_ms, summary.manifest.project], ["Holiday_ 2026_Cut_.jagentchill", true, "jagentchill-project", 1, 32, 32, "1.0.0", NOW + 5, { id: "pk", name: "Holiday: 2026/Cut?" }], platform.name);
    const hash1 = toHex(sha256(media[0].data)), hash2 = toHex(sha256(media[1].data));
    assert.deepEqual(summary.manifest.entries.map((entry) => [entry.path, entry.size]), [["project.json", summary.manifest.entries[0].size], [`media/${hash1}`, 70_000], [`media/${hash2}`, 30_000], ["cover.jpg", 900], ["thumbnail.png", 400]], "identical bytes are packaged once; every entry is listed with its byte size");
    assert.deepEqual(summary.manifest.media.map((item) => [item.assetId, item.sha256, item.size, item.variant, item.name]), [["a1", hash1, 70_000, "original", "Beach day.mp4"], ["a2", hash2, 30_000, "original", "song.mp3"], ["a3", hash1, 70_000, "original", "Beach day copy.mp4"]]);
    const opened = await openPackage(bytesZipSource(sink.bytes()), FILE_FORMATS.project);
    const packaged = await opened.text("project.json");
    assert.equal(/"local"|secret\.mov|externalPath|externalGrantId|"trash"|timelineViewState/.test(packaged), false, "project.json has no local section: no folder, trash state, view state, external path or grant");
    assert.equal(packaged, splitRecord(await port.readProjectText("pk")).canonical, "it is the canonical project document");
    // Import into another device.
    const target = (await platforms().find((other) => other.name === platform.name)!.open());
    const progress: number[] = [];
    const imported = await importProjectPackage(target, bytesZipSource(sink.bytes()), { now_ms: NOW + 9, newId: ids("new"), onProgress: (step) => progress.push(step.percent) });
    assert.deepEqual([imported.projectId, imported.assets, imported.offline, imported.importedAsCopy, progress.at(-1)], ["pk", 3, [], false, 100]);
    const loaded = await loadProject(target, "pk");
    assert.deepEqual([loaded.document.metadata.name, loaded.document.media.assets.map((asset) => asset.name), await target.readMedia("pk", "a2"), await target.readMedia("pk", "a3"), await target.mediaReferences(hash1)], ["Holiday: 2026/Cut?", ["Beach day.mp4", "song.mp3", "Beach day copy.mp4"], media[1].data, media[0].data, 2]);
    assert.deepEqual([(await target.getBlob("cover", "pk", "cover.jpg"))!.length, (await target.getBlob("thumbnail", "pk", "project.png"))!.length, await target.listSnapshots("pk")], [900, 400, []]);
    // Imported again, the project arrives as a copy under a new id.
    const copy = await importProjectPackage(target, bytesZipSource(sink.bytes()), { now_ms: NOW + 10, newId: ids("copy") });
    assert.deepEqual([copy.projectId, copy.importedAsCopy, (await target.listProjects()).length], ["copy1", true, 2]);
  }
  // "Include media" off: assets are listed as external and no media bytes are written.
  const port = await platforms()[0].open();
  const slim = await packagedProject(port, false);
  assert.deepEqual([slim.summary.manifest.entries.map((entry) => entry.path), slim.summary.manifest.media.every((item) => item.external === true)], [["project.json", "cover.jpg", "thumbnail.png"], true]);
  const target = await platforms()[0].open();
  assert.deepEqual((await importProjectPackage(target, bytesZipSource(slim.sink.bytes()), { now_ms: NOW, newId: ids() })).offline, ["a1", "a2", "a3"]);
  // An asset whose bytes are not on the device is skipped and listed in the completion summary.
  await port.removeMedia("pk", "a2");
  const sink = sinkOf();
  assert.deepEqual((await exportProjectPackage(port, "pk", sink, { appVersion: "1.0.0", now_ms: NOW })).offline, [{ assetId: "a2", name: "song.mp3" }]);
  // A cancelled export aborts the sink (the partial file is deleted), and a cancelled import removes everything it wrote.
  const cancelled = sinkOf();
  await assert.rejects(() => exportProjectPackage(port, "pk", cancelled, { appVersion: "1.0.0", now_ms: NOW, signal: { aborted: true } }), (error) => error instanceof PackageError && error.code === "cancelled");
  assert.deepEqual([cancelled.aborted, cancelled.closed], [true, false]);
  const fresh = await platforms()[2].open(), signal = { aborted: false };
  const full = await packagedProject(await platforms()[0].open());
  await assert.rejects(() => importProjectPackage(fresh, bytesZipSource(full.sink.bytes()), { now_ms: NOW, newId: ids(), signal, onProgress: (step) => { if (step.writtenBytes > 80_000) signal.aborted = true; } }), (error) => error instanceof PackageError && error.code === "cancelled");
  assert.deepEqual([await fresh.hasProject("pk"), await fresh.listMediaFiles(), await fresh.listProjects()], [false, [], []]);
});

test("Package and file formats — Scenario: Path traversal entry", async () => {
  const port = await platforms()[1].open();
  const { sink } = await packagedProject(await platforms()[0].open());
  // The same archive with one entry renamed to `../../evil` (in its local header and in the central directory).
  const archive = sink.bytes().slice(), from = utf8("cover.jpg"), to = utf8("../../evl");
  let renamed = 0;
  for (let at = 0; at + from.length <= archive.length; at++) if (from.every((byte, index) => archive[at + index] === byte)) { archive.set(to, at); renamed++; }
  assert.ok(renamed >= 2);
  const before = await port.listProjects();
  await assert.rejects(() => importProjectPackage(port, bytesZipSource(archive), { now_ms: NOW, newId: ids() }), (error) => error instanceof PackageError && error.code === "invalid" && error.message === "The file is not a valid JAgentChill project");
  assert.deepEqual([await port.listProjects(), await port.listMediaFiles()], [before, []], "the import is refused and nothing is written");
  // Absolute paths, drive letters, backslashes and symbolic links are refused the same way; so is a file that is no archive.
  const { isSafeEntryName } = await import("../src/index.ts");
  assert.deepEqual(["media/a", "a/../b", "/etc/passwd", "C:/Windows/x", "..", "a\\b", "", "a//b", "./a"].map(isSafeEntryName), [true, false, false, false, false, false, false, false, false]);
  await assert.rejects(() => importProjectPackage(port, bytesZipSource(utf8("not a zip at all, just some text that is long enough")), { now_ms: NOW, newId: ids() }), (error) => error instanceof PackageError && error.code === "invalid");
  // An entry whose bytes were changed fails its SHA-256, and everything the import wrote is removed.
  const tampered = sink.bytes().slice(), marker = bytes(70_000, 1).subarray(100, 132);
  for (let at = 0; at + marker.length <= tampered.length; at++) if (marker.every((byte, index) => tampered[at + index] === byte)) { tampered[at] ^= 0xff; break; }
  await assert.rejects(() => importProjectPackage(port, bytesZipSource(tampered), { now_ms: NOW, newId: ids() }), (error) => error instanceof PackageError && error.code === "invalid");
  assert.deepEqual([await port.hasProject("pk"), await port.listMediaFiles()], [false, []]);
  // An entry the manifest does not list makes the whole archive invalid.
  const extra = sinkOf(), zip = createZipWriter(extra);
  await zip.add("manifest.json", utf8(JSON.stringify({ format: "jagentchill-project", formatVersion: 1, entries: [] }))); await zip.add("stowaway.bin", bytes(10)); await zip.finish();
  await assert.rejects(() => openPackage(bytesZipSource(extra.bytes()), FILE_FORMATS.project), (error) => error instanceof PackageError && error.code === "invalid");
  // The uncompressed total is checked against the quota before anything is written.
  const small = Object.assign(Object.create(port) as StoragePort, { available: async () => 50 * MiB + 1000 });
  await assert.rejects(() => importProjectPackage(small, bytesZipSource(sink.bytes()), { now_ms: NOW, newId: ids() }), (error) => error instanceof PackageError && error.code === "no-space" && /^Not enough storage for Holiday: 2026\/Cut\? \(/.test(error.message));
  assert.deepEqual(await port.listMediaFiles(), []);
});

test("Package and file formats — Scenario: Newer format version", async () => {
  const port = await platforms()[0].open();
  const script = { format: "jagentchill.script.file", formatVersion: FILE_FORMATS.script.formatVersion + 1, script: { id: "s1", title: "Pilot" } };
  assert.throws(() => readJsonFormat(JSON.stringify(script)), (error) => error instanceof PackageError && error.code === "newer" && error.message === "This file was created with a newer version of JAgentChill. Update the app to open it.");
  assert.deepEqual(await port.listDocuments("script"), [], "no script is created");
  // The supported version opens; the kind is recognised by content, whatever the file was called (`*.jcscript.json`).
  const written = writeJsonFormat("script", { script: { id: "s1", title: "Pilot" } });
  assert.deepEqual([written.fileName("My: script"), readJsonFormat(written.text).kind, readJsonFormat<{ script: { title: string } }>(`\uFEFF${written.text}`, "script").value.script.title], ["My_ script.jcscript", "script", "Pilot"]);
  assert.deepEqual([readJsonFormat(writeJsonFormat("workflow", {}).text).kind, readJsonFormat(writeJsonFormat("keys", {}).text).kind], ["workflow", "keys"]);
  assert.throws(() => readJsonFormat(written.text, "keys"), (error) => error instanceof PackageError && error.code === "invalid");
  assert.throws(() => readJsonFormat("{ not json"), (error) => error instanceof PackageError && error.code === "invalid");
  assert.deepEqual(Object.values(FILE_FORMATS).map((format) => format.extension), [".jagentchill", ".jctpl", ".jcpack", ".jcscript", ".jcworkflow", ".jckeys"], "one final extension each");
  assert.deepEqual([packageFileName("a", "template"), packageFileName("a", "pack"), packageFileName("a", "workflow"), packageFileName("a", "keys"), FILE_FORMATS.project.mime], ["a.jctpl", "a.jcpack", "a.jcworkflow", "a.jckeys", "application/vnd.jagentchill.project+zip"]);
  // A ZIP package with a higher formatVersion is refused with the same message, and nothing is written.
  const sink = sinkOf();
  await writePackage(sink, { format: "jagentchill-project", formatVersion: 2 }, [{ path: "project.json", data: utf8("{}") }]);
  await assert.rejects(() => importProjectPackage(port, bytesZipSource(sink.bytes()), { now_ms: NOW, newId: ids() }), (error) => error instanceof PackageError && error.code === "newer");
  assert.deepEqual(await port.listProjects(), []);
});

test("Package and file formats — Scenario: Large package memory bound", { timeout: 1_800_000 }, async () => {
  const size = Number(process.env.JC_LARGE_PACKAGE_GIB ?? 1) * GiB;
  const work = temporaryDirectory("large"), packagePath = join(work, "big.jagentchill");
  try {
    const source = await openDesktopStorage({ library: join(work, "source"), cache: join(work, "cache-a") });
    // A project with media of the wanted size, written, hashed and packaged by streaming.
    let state = 1;
    const noise = async function* (total: number): AsyncGenerator<Uint8Array> {
      for (let left = total; left > 0;) { const chunk = new Uint8Array(Math.min(left, 4 * MiB)); for (let index = 0; index < chunk.length; index += 4096) { state = (state * 1103515245 + 12345) >>> 0; chunk[index] = state & 255; chunk[index + 1] = state >>> 8; } left -= chunk.length; yield chunk; }
    };
    const stored = await source.writeMediaStream("big", "a1", noise(size), { extension: "mov" });
    await saveProject(source, addAsset(project("big", "Feature"), { now_ms: NOW, newId: ids() }, { id: "a1", name: "feature.mov", type: "video", size, contentHash: stored.contentHash }).document);
    const sample = async (run: () => Promise<unknown>) => {
      globalThis.gc?.();
      const before = process.memoryUsage().rss;
      let peak = before;
      const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 20);
      try { await run(); } finally { clearInterval(timer); }
      return Math.max(peak, process.memoryUsage().rss) - before;
    };
    const exportGrowth = await sample(async () => exportProjectPackage(source, "big", await filePackageSink(packagePath), { appVersion: "1.0.0", now_ms: NOW, hasher: nodeSha256 }));
    assert.ok(statSync(packagePath).size > size, "a ZIP (ZIP64 above 4 GiB) holding the media without recompression");
    source.close();
    const target = await openDesktopStorage({ library: join(work, "target"), cache: join(work, "cache-b") });
    const zip = await fileZipSource(packagePath);
    const importGrowth = await sample(() => importProjectPackage(target, zip, { now_ms: NOW, newId: ids(), hasher: nodeSha256 }));
    await zip.close();
    assert.ok(importGrowth < 256 * MiB, `the peak resident-memory increase during the import is below 256 MiB (${Math.round(importGrowth / MiB)} MiB for ${size / GiB} GiB)`);
    assert.ok(exportGrowth < 256 * MiB, `and during the export (${Math.round(exportGrowth / MiB)} MiB)`);
    assert.deepEqual([(await target.mediaInfo("big", "a1"))!.contentHash, (await target.mediaInfo("big", "a1"))!.size], [stored.contentHash, size]);
    target.close();
  } finally { rmSync(work, { recursive: true, force: true }); }
});

test("Package and file formats: ZIP64 records are written and read for an entry of 4 GiB and more", { timeout: 600_000 }, async () => {
  // The archive goes to a sink that keeps only its head and tail: the records are what is under test, not 4 GiB of zeros.
  const kept: { offset: number; bytes: Uint8Array }[] = [];
  let offset = 0;
  const sink = { write: async (chunk: Uint8Array) => { if (offset < 4096 || chunk.length < MiB) kept.push({ offset, bytes: chunk.slice() }); offset += chunk.length; } };
  const zip = createZipWriter(sink), big = 4 * GiB + 5;
  await zip.add("media/huge", zeros(big), { size: big });
  await zip.add("after.txt", utf8("tail"));
  const total = await zip.finish();
  const source: ZipSource = { size: total, read: async (start, length) => { const out = new Uint8Array(length); for (const part of kept) { const from = Math.max(start, part.offset), to = Math.min(start + length, part.offset + part.bytes.length); if (from < to) out.set(part.bytes.subarray(from - part.offset, to - part.offset), from - start); } return out; } };
  const { readZipDirectory, readZipEntry } = await import("../src/index.ts");
  const entries = await readZipDirectory(source);
  assert.deepEqual(entries.map((entry) => [entry.name, entry.size, entry.offset]), [["media/huge", big, 0], ["after.txt", 4, entries[1].offset]]);
  assert.ok(entries[1].offset > 4 * GiB, "an offset beyond 4 GiB");
  let tail = "";
  for await (const chunk of readZipEntry(source, entries[1])) tail += String.fromCharCode(...chunk);
  assert.equal(tail, "tail");
});

// Requirement: Classic bundle ingestion
const ISO = "2025-03-04T05:06:07.000Z";
const v12Project = (id: string) => ({
  id, version: 12, metadata: { id, name: "Mid era", duration: 4, createdAt: ISO, updatedAt: ISO }, settings: { fps: 30, canvasSize: { width: 1920, height: 1080 }, originalCanvasSize: null, background: { type: "color", color: "#000000" } }, currentSceneId: "s",
  scenes: [{ id: "s", name: "Main scene", isMain: true, bookmarks: [], createdAt: ISO, updatedAt: ISO, tracks: [{ id: "tv", type: "video", name: "Video Track", isMain: true, muted: false, hidden: false, elements: [
    { id: "v1", type: "video", name: "Clip", mediaId: "old-video", startTime: 0, duration: 2, trimStart: 0, trimEnd: 0, sourceDuration: 2, muted: false, hidden: false, volume: 1, opacity: 1, transform: { scaleX: 1, scaleY: 1, position: { x: 0, y: 0 }, rotate: 0 } },
    { id: "i1", type: "image", name: "Still", mediaId: "old-image", startTime: 2, duration: 2, trimStart: 0, trimEnd: 0, hidden: false, opacity: 1, transform: { scaleX: 1, scaleY: 1, position: { x: 0, y: 0 }, rotate: 0 } },
  ] }] }],
});
const v31Project = (id: string) => ({ id, ...(classic.project({ main: [classic.video("v1", 0, 2), classic.image("i1", 2, 2)], audio: [classic.track("ta", "audio", [classic.audio("a1", 0, 2)])] }) as Record<string, unknown>), metadata: { id, name: "Holiday cut", duration: 480_000, createdAt: ISO, updatedAt: ISO } });
async function bundle(options: { projects: Record<string, unknown>[]; media: Record<string, { record: Record<string, unknown>; data?: Uint8Array }[]>; sounds?: unknown; localStorage?: Record<string, string>; formatVersion?: number }) {
  const sink = memorySink(), zip = createZipWriter(sink);
  await zip.add("classic-manifest.json", utf8(JSON.stringify({ format: "opencut-classic-bundle", formatVersion: options.formatVersion ?? 1, origin: "https://opencut.app", exported_ms: NOW })));
  await zip.add("projects.json", utf8(JSON.stringify(options.projects)));
  for (const [projectId, items] of Object.entries(options.media)) {
    await zip.add(`media/${projectId}/metadata.json`, utf8(JSON.stringify(items.map((item) => item.record))));
    for (const item of items) if (item.data) await zip.add(`media/${projectId}/${String(item.record.id)}`, item.data);
  }
  if (options.sounds) await zip.add("saved-sounds.json", utf8(JSON.stringify(options.sounds)));
  await zip.add("local-storage.json", utf8(JSON.stringify(options.localStorage ?? {})));
  await zip.finish();
  return bytesZipSource(sink.bytes());
}
const media = (id: string, type: "video" | "image" | "audio", name: string, data: Uint8Array) => ({ record: { id, name, type, size: data.length, lastModified: 1_700_000_000_000, ...(type === "image" ? { width: 800, height: 600 } : { duration: 10 }), ...(type === "video" ? { width: 1920, height: 1080 } : {}) }, data });

test("Classic bundle ingestion — Scenario: Mixed versions", async () => {
  for (const platform of platforms()) {
    const port = await platform.open();
    const source = await bundle({
      projects: [v12Project("classic-12"), v31Project("classic-31")],
      media: {
        "classic-12": [media("old-video", "video", "old.mp4", bytes(3000, 1)), media("old-image", "image", "old.png", bytes(800, 2))],
        "classic-31": [media("m-video", "video", "clip.mp4", bytes(5000, 3)), media("m-image", "image", "photo.png", bytes(700, 4)), media("m-audio", "audio", "song.mp3", bytes(900, 5))],
      },
      sounds: { id: "user-sounds", sounds: [{ id: 101, name: "Whoosh", username: "fx", duration: 1.2, tags: [], license: "CC0", savedAt: "2025-01-02T03:04:05.000Z" }, { id: 202, name: "Click", username: "fx", duration: 0.2, tags: [], license: "CC0", savedAt: "2025-01-03T03:04:05.000Z" }], lastModified: ISO },
    });
    await port.writeLibrary("saved-sounds", { sounds: [{ id: "202", name: "Click (already here)", savedAt_ms: 5 }], lastModified_ms: 5 });
    const opened = await openClassicBundle(source);
    const summary = await ingestClassic(port, opened, { now: () => NOW, newId: ids("imported-"), mediaBytes: opened.mediaBytes });
    assert.deepEqual(summary.skipped, [], platform.name);
    assert.deepEqual(summary.imported.map((entry) => [entry.classicId, entry.fromVersion, entry.assets, entry.offlineAssets]), [["classic-12", 12, 2, []], ["classic-31", 31, 3, []]]);
    for (const entry of summary.imported) {
      assert.notEqual(entry.projectId, entry.classicId, "under a new project id");
      const { document } = await loadProject(port, entry.projectId);
      assert.deepEqual([document.schemaVersion, document.metadata.id, document.metadata.importedFrom], [32, entry.projectId, { source: "opencut-classic", id: entry.classicId }], "at the current schema version, the classic id kept in metadata.importedFrom");
      for (const asset of document.media.assets) {
        const stored = (await port.mediaInfo(entry.projectId, asset.id))!;
        assert.deepEqual([asset.contentHash, (document as unknown as { local: { media: Record<string, { storage: string; present: { original: boolean } }> } }).local.media[asset.id].storage, (document as unknown as { local: { media: Record<string, { present: { original: boolean } }> } }).local.media[asset.id].present.original], [stored.contentHash, "managed", true], "its media is online, as managed assets");
      }
      assert.equal(await isImportedUnopened(port, entry.projectId), true, "listed with the label \"Imported\" until first opened");
    }
    assert.deepEqual(await port.readMedia(summary.imported[1].projectId, "m-video"), bytes(5000, 3));
    assert.deepEqual((await port.listProjects()).map((entry) => entry.schemaVersion), [32, 32]);
    // Saved sounds are merged; an id that is already present is skipped.
    assert.deepEqual([summary.savedSoundsAdded, (await savedSounds(port)).map((sound) => [sound.id, sound.name, sound.savedAt_ms])], [1, [["202", "Click (already here)", 5], ["101", "Whoosh", Date.parse("2025-01-02T03:04:05.000Z")]]]);
  }
  // A project whose chain fails is skipped with the failing step recorded; the others are still ingested.
  const port = await platforms()[0].open();
  const broken = { ...v31Project("classic-bad"), scenes: "not an array" };
  const summary = await ingestClassic(port, await openClassicBundle(await bundle({ projects: [broken, v31Project("classic-ok")], media: { "classic-ok": [media("m-video", "video", "clip.mp4", bytes(100)), media("m-image", "image", "p.png", bytes(50)), media("m-audio", "audio", "s.mp3", bytes(70))] } })), { now: () => NOW, newId: ids("n") });
  assert.deepEqual([summary.skipped.map((entry) => [entry.classicId, entry.step]), summary.imported.map((entry) => entry.classicId), (await port.listProjects()).length, (await port.listMediaFiles()).length], [[["classic-bad", "v31→v32"]], ["classic-ok"], 1, 3]);
  // A bundle of a newer format, and an archive with an unsafe entry, are refused as a whole.
  await assert.rejects(async () => openClassicBundle(await bundle({ projects: [], media: {}, formatVersion: 2 })), (error) => error instanceof PackageError && error.code === "newer");
  // The quota is evaluated for the bundle's total media size before anything is written.
  const tight = Object.assign(Object.create(port) as StoragePort, { available: async () => 50 * MiB + 10 });
  const opened = await openClassicBundle(await bundle({ projects: [v31Project("classic-q")], media: { "classic-q": [media("m-video", "video", "clip.mp4", bytes(100))] } }));
  await assert.rejects(() => ingestClassic(tight, opened, { now: () => NOW, newId: ids("q"), mediaBytes: opened.mediaBytes }), (error) => error instanceof PackageError && error.code === "no-space");
  assert.equal((await port.listProjects()).length, 1);
});

test("Classic bundle ingestion — Scenario: Missing media entry", async () => {
  const port = await platforms()[1].open();
  const withoutFile = { record: media("m-image", "image", "photo.png", bytes(10)).record };
  const source = await bundle({ projects: [v31Project("classic-31")], media: { "classic-31": [media("m-video", "video", "clip.mp4", bytes(5000, 3)), withoutFile, media("m-audio", "audio", "song.mp3", bytes(900, 5))] } });
  const summary = await ingestClassic(port, await openClassicBundle(source), { now: () => NOW, newId: ids("imported-") });
  assert.deepEqual([summary.skipped, summary.imported[0].assets, summary.imported[0].offlineAssets], [[], 2, ["m-image"]], "the project is ingested and that asset is offline");
  const id = summary.imported[0].projectId, { document } = await loadProject(port, id);
  const local = (document as unknown as { local: { media: Record<string, { present: { original: boolean } }> } }).local.media;
  assert.deepEqual([document.media.assets.map((asset) => asset.id), local["m-image"].present.original, local["m-video"].present.original, await port.hasMedia(id, "m-image")], [["m-audio", "m-image", "m-video"], false, true, false]);
  assert.equal(document.scenes[0].tracks.main.elements.length, 2, "the element that uses the offline asset is kept");
  // Ingestion is transactional per project: a failure while its media is written removes its partial record and media.
  const flaky = await platforms()[2].open();
  let writes = 0;
  const failing = Object.assign(Object.create(flaky) as StoragePort, { writeMediaStream: async (...args: Parameters<StoragePort["writeMediaStream"]>) => { if (++writes === 2) throw new StorageError("Unavailable", "the disk went away"); return flaky.writeMediaStream(...args); } });
  const failed = await ingestClassic(failing, await openClassicBundle(await bundle({ projects: [v31Project("classic-31")], media: { "classic-31": [media("m-video", "video", "clip.mp4", bytes(5000, 3)), media("m-image", "image", "photo.png", bytes(10)), media("m-audio", "audio", "song.mp3", bytes(900, 5))] } })), { now: () => NOW, newId: ids("x") });
  assert.deepEqual([failed.imported, failed.skipped.map((entry) => [entry.classicId, entry.step]), await flaky.listProjects(), await flaky.listMediaFiles()], [[], [["classic-31", "write"]], [], []]);
});

test("Classic bundle ingestion — Scenario: Unknown local-storage key", async () => {
  const port = await platforms()[0].open();
  const stored = new Map<string, string>();
  const preferences = createPreferences({ getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => { stored.set(key, value); }, removeItem: (key) => { stored.delete(key); } });
  const handed: Record<string, string> = {};
  const persisted = (state: Record<string, unknown>, version = 0) => JSON.stringify({ state, version });
  const source = await bundle({ projects: [v31Project("classic-31")], media: {}, localStorage: {
    hasSeenOnboarding: "true", "some-analytics-id": "abc",
    "opencut-keybindings": persisted({ keybindings: { space: "toggle-play" } }), "graph-editor-presets": persisted({ presets: [] }),
    "timeline-store": persisted({ snappingEnabled: false, rippleEditingEnabled: true }), "projects-view-mode": persisted({ viewMode: "list", sortKey: "name", sortOrder: "asc" }),
    "assets-panel": persisted({ mediaViewMode: "list", mediaSortBy: "size", mediaSortOrder: "desc" }), "panel-sizes": persisted({ panels: { tools: 25, preview: 50 } }, 2),
    "stickers-settings": persisted({ selectedCategory: "emoji", recentStickers: ["emoji:1f600"] }, 1), "preview-settings": persisted({ activeGuide: "thirds", overlays: { safeArea: true }, gridConfig: { rows: 4, columns: 6 } }, 6), theme: "dark",
  } });
  const summary = await ingestClassic(port, await openClassicBundle(source), { now: () => NOW, newId: ids("imported-"), preferences, keybindings: (raw) => { handed.keybindings = raw; }, easingPresets: (raw) => { handed.easing = raw; } });
  assert.deepEqual([summary.ignoredKeys.sort(), summary.imported.length, summary.skipped], [["hasSeenOnboarding", "some-analytics-id"], 1, []], "the key is ignored and ingestion succeeds");
  assert.deepEqual(summary.preferenceKeys.sort(), ["assets-panel", "graph-editor-presets", "opencut-keybindings", "panel-sizes", "preview-settings", "projects-view-mode", "stickers-settings", "theme", "timeline-store"]);
  assert.deepEqual([JSON.parse(handed.keybindings).state.keybindings.space, JSON.parse(handed.easing).state.presets], ["toggle-play", []], "the two keys of other owners are handed on as they are");
  assert.deepEqual([preferences.get(PREFERENCES.timelineSnapping), preferences.get(PREFERENCES.timelineRipple), preferences.get(PREFERENCES.projectsViewMode), preferences.get(PREFERENCES.projectsSort), preferences.get(PREFERENCES.mediaViewMode), preferences.get(PREFERENCES.mediaSort), preferences.get(PREFERENCES.panelSizes), preferences.get(PREFERENCES.stickerSettings), preferences.get(PREFERENCES.previewSettings), preferences.get(PREFERENCES.theme)],
    [false, true, "list", { key: "name", order: "asc" }, "list", { key: "size", order: "desc" }, { tools: 25, preview: 50 }, { category: "emoji", recents: ["emoji:1f600"] }, { activeGuide: "thirds", overlays: { safeArea: true }, grid: { rows: 4, columns: 6 } }, "dark"]);
  assert.equal([...stored.keys()].some((key) => /onboarding|analytics/i.test(key)), false);
});

// Requirement: Schema 32 migration — the storage half of the round trip and of the classic effect element.
test("Schema 32 migration — Scenario: Round trip on a real classic fixture", () => {
  // The fixture "all-element-types": every classic element type, as classic stores it at v31 (see `classic-chain.test.ts`
  // for the records written through classic's own writer). It is built from classic's types, not exported from a running classic build.
  const fixture = classic.project({
    main: [classic.video("v1", 0, 2, { "transform.positionX": 120, opacity: 0.8, volume: -6 }), classic.image("i1", 2, 2, { "transform.rotate": 30 })],
    overlay: [classic.track("t-text", "text", [classic.text("x1", 0, 2, { content: "Title", fontSize: 48 })]), classic.track("t-gfx", "graphic", [classic.sticker("s1", 0, 2), classic.graphic("g1", "rectangle", 2, 2)]), classic.track("t-fx", "effect", [classic.effect("fx1", "blur", 0, 2, { intensity: 15 })])],
    audio: [classic.track("t-audio", "audio", [classic.audio("a1", 0, 2, { volume: -3 })])],
  }) as any;
  const migrated = migrateRecord({ id: "classic-1", ...fixture }, { now_ms: NOW, newId: ids("n"), mediaRecords: classic.media() });
  const document = migrated.record as any;
  const elements = new Map<string, any>([...document.scenes[0].tracks.overlay, document.scenes[0].tracks.main, ...document.scenes[0].tracks.audio].flatMap((track: any) => track.elements).map((element: any) => [element.id, element]));
  for (const track of [...fixture.scenes[0].tracks.overlay, fixture.scenes[0].tracks.main, ...fixture.scenes[0].tracks.audio]) {
    for (const original of track.elements) {
      const view = toClassicView(elements.get(original.id));
      for (const [param, value] of Object.entries(original.params as Record<string, unknown>)) {
        if (["fontWeight", "textDecoration"].includes(param) || (original.type !== "graphic" && original.type !== "effect" && !(param in view.params))) continue;
        assert.deepEqual(view.params[param], value, `${original.id} params.${param}`);
      }
      assert.deepEqual(view.animationPaths, Object.keys(original.animations ?? {}).sort());
    }
  }
  assert.deepEqual(migrated.report, [], "the migration report lists only the outcomes of §13.7 — none for this fixture");
  assert.equal(elements.size, 7);
});

test("Schema 32 migration — Scenario: Classic effect element validates and renders the same", async () => {
  const { validateProjectDocument } = await import("@jagentchill/editor-core");
  const fixture = classic.project({ main: [classic.video("v1", 0, 2)], overlay: [classic.track("t-fx", "effect", [classic.effect("fx1", "blur", 0, 2, { intensity: 15 })])] }) as Record<string, unknown>;
  const migrated = migrateRecord({ id: "classic-1", ...fixture }, { now_ms: NOW, newId: ids("new"), mediaRecords: classic.media() });
  const effect = (migrated.record as any).scenes[0].tracks.overlay[0].elements[0];
  assert.deepEqual(effect.effects, [{ id: effect.effects[0].id, type: "blur", kind: "effect", enabled: true, params: { intensity: 15 } }]);
  assert.match(effect.effects[0].id, /^new\d+$/, "a new id from the id source");
  assert.deepEqual([effect.target, "effectType" in effect, "params" in effect, validateProjectDocument(migrated.record, { mode: "strict" }).ok], ["beneath", false, false, true]);
  // The rendered-frame half of this scenario (the classic reference frame within the golden tolerance) belongs to the
  // render engine's golden-frame suite; this package fixes the document the engine renders.
});
