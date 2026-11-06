// Fakes declared: `fake-indexeddb` stands in for the browser's IndexedDB and an in-memory directory tree for the Origin Private File System (neither exists in a Node test process); the mobile store's SQL and file drivers are `node:sqlite` and `node:fs` in place of `expo-sqlite` and `expo-file-system`. The desktop store runs for real against temporary directories.
import assert from "node:assert/strict";
import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { addAsset, canonicalize, commitChange, documentHash, insertElement, renameAsset, setLocal, sha256, toHex } from "@jagentchill/editor-core";
import { createProjectDocument, type ProjectDocument } from "@jagentchill/protocol";
import { openDesktopStorage } from "../src/desktop.ts";
import {
  detectVersion, isStorageError, loadProject, NEEDS_NEWER_APP, openability, openWebStorage, saveMediaAsset, saveProject, saveSound, savedSounds, serializeProjectRecord,
  StorageError, WEB_STORAGE_UNAVAILABLE, WORKFLOW_CACHE_LIMIT, type StoragePort,
} from "../src/index.ts";
import { fakeBrowser, platforms, temporaryDirectory } from "./support/platforms.ts";

const NOW = 1_800_000_000_000;
const ids = () => { let count = 0; return () => `id${++count}`; };
const ctx = (now_ms = NOW + 1000) => ({ now_ms, newId: ids() });
const project = (id: string, name = "Project", updated = NOW): ProjectDocument => ({ ...createProjectDocument({ id, mainSceneId: `${id}-scene`, mainTrackId: `${id}-track`, now_ms: updated, name }) });
const bytes = (length: number, seed = 1) => Uint8Array.from({ length }, (_, index) => (index * 31 + seed) & 255);
const rejects = async (run: () => Promise<unknown>, kind: string) => assert.rejects(run, (error) => isStorageError(error) && error.kind === kind);

/** Everything a reader can ask of the port, for comparing two states of a store. */
async function readEverything(port: StoragePort, projectIds: string[]) {
  const out: Record<string, unknown> = { projects: await port.listProjects(), library: await port.readLibrary("folders"), sounds: await port.readLibrary("saved-sounds"), scripts: await port.listDocuments("script") };
  for (const id of projectIds) {
    if (!(await port.hasProject(id))) { out[id] = null; continue; }
    const media = await port.listMedia(id);
    out[id] = {
      text: await port.readProjectText(id), media, snapshots: await port.listSnapshots(id), backups: await port.listBackups(id), journal: await port.readJournal(id),
      bytes: await Promise.all(media.map(async (entry) => toHex(sha256(await port.readMedia(id, entry.assetId))))), references: await Promise.all(media.map((entry) => port.mediaReferences(entry.contentHash))),
    };
  }
  return out;
}

/** The conformance suite: one set of expectations, run against every implementation of the port. */
async function conformance(port: StoragePort, afterMutation: () => Promise<void> = async () => undefined): Promise<void> {
  // Project records: exact bytes back, atomic replacement, listing by modified time, unreadable records flagged.
  const first = serializeProjectRecord(project("p1", "First", NOW)), second = serializeProjectRecord(project("p2", "Second", NOW + 5000));
  await port.writeProjectText("p1", first); await afterMutation();
  await port.writeProjectText("p2", second); await afterMutation();
  assert.equal(await port.readProjectText("p1"), first);
  assert.deepEqual((await port.readProject("p2")).metadata, JSON.parse(second).metadata);
  assert.deepEqual((await port.listProjects()).map((entry) => [entry.id, entry.name, entry.schemaVersion, entry.unreadable]), [["p2", "Second", 32, false], ["p1", "First", 32, false]]);
  await port.writeProjectText("broken", "{ not json"); await afterMutation();
  assert.deepEqual((await port.listProjects()).find((entry) => entry.id === "broken")!.unreadable, true, "a record without metadata is flagged, never dropped");
  await rejects(() => port.readProject("broken"), "Corrupt");
  await rejects(() => port.readProjectText("missing"), "NotFound");
  await rejects(() => port.readMedia("p1", "nothing"), "NotFound");
  assert.equal(await port.hasProject("missing"), false);

  // Media: identical bytes are stored once per device and counted per reference. The file is written first and the
  // asset record (inside the project record) second; the record is what a rebuilt index reads the reference from.
  const clip = bytes(4096);
  const withAssets = (id: string, name: string, updated: number, assets: { id: string; contentHash: string }[]) => {
    const record = JSON.parse(serializeProjectRecord(project(id, name, updated)));
    record.media.assets = assets.map((asset) => ({ ...asset, name: asset.id, type: "video", kind: null, size: 1, created_ms: NOW }));
    return JSON.stringify(record);
  };
  const stored = await port.writeMedia("p1", "a1", clip, { extension: "mp4" });
  const firstWithMedia = withAssets("p1", "First", NOW, [{ id: "a1", contentHash: stored.contentHash }]);
  await port.writeProjectText("p1", firstWithMedia); await afterMutation();
  assert.deepEqual([stored.contentHash, stored.size, stored.extension, stored.shared], [toHex(sha256(clip)), 4096, "mp4", false]);
  const again = await port.writeMedia("p2", "b1", clip, { extension: "mp4" });
  const other = await port.writeMedia("p2", "b2", bytes(100, 7), { extension: "png" });
  await port.writeProjectText("p2", withAssets("p2", "Second", NOW + 5000, [{ id: "b1", contentHash: again.contentHash }, { id: "b2", contentHash: other.contentHash }])); await afterMutation();
  assert.equal(again.shared, true);
  assert.equal(await port.mediaReferences(stored.contentHash), 2);
  assert.deepEqual((await port.listMedia("p2")).map((entry) => [entry.assetId, entry.extension, entry.size]), [["b1", "mp4", 4096], ["b2", "png", 100]]);
  assert.deepEqual(await port.readMedia("p2", "b1"), clip);

  // Snapshots, backups and the pending-patch journal.
  for (const [id, created] of [["s1", NOW], ["s2", NOW + 10]] as const) await port.putSnapshot("p1", { id, kind: "automatic", created_ms: created, label: "", duration: 0, schemaVersion: 32, record: first });
  await afterMutation();
  assert.deepEqual((await port.listSnapshots("p1")).map((entry) => entry.id), ["s2", "s1"]);
  assert.equal((await port.readSnapshot("p1", "s1")).record, first);
  assert.equal(await port.readProjectText("p1"), firstWithMedia, "a snapshot is a copy: it does not change the record");
  const backup = await port.putBackup("p1", { sourceVersion: 31, time_ms: NOW, record: "{\"version\":31}", report: [{ path: "/x", classicKey: "glow", reason: "unregistered" }] }); await afterMutation();
  assert.equal(backup.name, `31-${NOW}`);
  assert.deepEqual([(await port.readBackup("p1", backup.name)).record, (await port.listBackups("p1")).length], ["{\"version\":31}", 1]);
  for (const revision of [1, 2, 3]) await port.appendJournal("p1", { baseRevision: revision - 1, revision, commandType: "element.move", label: "Move", patch: [{ op: "replace", path: "/metadata/updated_ms", value: revision }] });
  await afterMutation();
  await port.truncateJournal("p1", 2); await afterMutation();
  assert.deepEqual((await port.readJournal("p1")).map((entry) => entry.revision), [3]);

  // Thumbnails and covers are files, library-wide records belong to no project, scripts are documents of their own.
  await port.putBlob("thumbnail", "p1", "a1.jpg", bytes(64)); await port.putBlob("cover", "p1", "cover.jpg", bytes(32, 3));
  assert.deepEqual(await port.getBlob("cover", "p1", "cover.jpg"), bytes(32, 3));
  assert.equal(await port.getBlob("thumbnail", "p1", "none.jpg"), undefined);
  await port.writeLibrary("folders", { folders: [{ id: "f1", name: "Work", parentId: null }] }); await afterMutation();
  await port.putDocument("script", "script-1", { title: "Pilot", versions: [{ id: "v1" }] }); await afterMutation();
  assert.deepEqual(await port.getDocument("script", "script-1"), { title: "Pilot", versions: [{ id: "v1" }] });
  await port.putSession("marker", { projectId: "p1", opened_ms: NOW, clean: false });
  assert.deepEqual(await port.getSession("marker"), { projectId: "p1", opened_ms: NOW, clean: false });
  const free = await port.available();
  assert.ok(free === null || free > 0);

  // Every index is derived: after a rebuild every read gives the same answer.
  const before = await readEverything(port, ["p1", "p2", "broken"]);
  await port.rebuildIndexes();
  assert.deepEqual(await readEverything(port, ["p1", "p2", "broken"]), before);

  // Deleting a project leaves the shared bytes readable from the other one, and nothing of its own.
  await port.deleteProject("p1"); await afterMutation();
  assert.equal(await port.mediaReferences(stored.contentHash), 1);
  assert.deepEqual(await port.readMedia("p2", "b1"), clip);
  assert.deepEqual([await port.hasProject("p1"), await port.listSnapshots("p1"), await port.listBackups("p1"), await port.readJournal("p1"), await port.listMedia("p1"), await port.getBlob("cover", "p1", "cover.jpg")], [false, [], [], [], [], undefined]);
  await port.removeMedia("p2", "b1"); await afterMutation();
  assert.equal(await port.mediaReferences(stored.contentHash), 0);
  await rejects(() => port.readMedia("p2", "b1"), "NotFound");
}

// Requirement: Storage port and per-platform stores
test("Storage port and per-platform stores — Scenario: Same behaviour on every platform", async () => {
  for (const platform of platforms()) {
    const port = await platform.open();
    await assert.doesNotReject(() => conformance(port), platform.name);
  }
});

test("Storage port and per-platform stores — Scenario: Web layout", async () => {
  const browser = fakeBrowser();
  const port = await openWebStorage(browser);
  const withAsset = addAsset(project("p1"), ctx(), { id: "a1", name: "clip.mp4", type: "video", size: 2048 }).document;
  await saveMediaAsset(port, "p1", "a1", bytes(2048), async (stored) => { await saveProject(port, { ...withAsset, media: { ...withAsset.media, assets: [{ ...withAsset.media.assets[0], contentHash: stored.contentHash }] } }); }, { extension: "mp4" });
  // The project record, with the asset's metadata inside it, is a row of IndexedDB.
  const database = await new Promise<IDBDatabase>((resolve) => { const opening = browser.indexedDB.open("jagentchill"); opening.onsuccess = () => resolve(opening.result); });
  const row = await new Promise<string>((resolve) => { const reading = database.transaction("projects").objectStore("projects").get("p1"); reading.onsuccess = () => resolve(reading.result); });
  assert.equal(JSON.parse(row).media.assets[0].name, "clip.mp4");
  assert.equal([...database.objectStoreNames].includes("media-metadata"), false, "there is no separate media-metadata store");
  // The asset bytes are an OPFS file.
  const media = (((browser.opfs.children.get("projects") as any).children.get("p1") as any).children.get("media") as any).children;
  assert.deepEqual([...media.keys()], ["a1.mp4"]);
  assert.equal(media.get("a1.mp4").bytes.length, 2048);
  database.close();
});

test("Storage port and per-platform stores — Scenario: Desktop layout", async () => {
  const library = temporaryDirectory("library"), cache = temporaryDirectory("cache");
  const port = await openDesktopStorage({ library, cache });
  await saveProject(port, project("p1"));
  await port.writeMedia("p1", "a1", bytes(2048), { extension: "mp4" });
  assert.ok(existsSync(join(library, "p1", "project.json")));
  assert.deepEqual(readdirSync(join(library, "p1", "media")), ["a1.mp4"]);
  port.close();
  const index = new DatabaseSync(join(library, "library.sqlite"));
  assert.deepEqual(index.prepare("SELECT key FROM entries WHERE store = 'index:projects'").all().map((row) => ({ ...row })), [{ key: "p1" }]);
  index.close();
  // Neither IndexedDB nor OPFS is involved: the desktop store is built from node:fs and the SQLite index only.
  const source = readFileSync(new URL("../src/desktop.ts", import.meta.url), "utf8");
  assert.equal(/indexedDB|getDirectory\(|web\.ts/.test(source), false);
});

test("Storage port and per-platform stores — Scenario: Storage unavailable on web", async () => {
  for (const environment of [{}, { indexedDB: fakeBrowser().indexedDB }, { indexedDB: fakeBrowser().indexedDB, storage: {} }, { storage: fakeBrowser().storage }, { indexedDB: fakeBrowser().indexedDB, storage: { getDirectory: async () => { throw new Error("SecurityError"); } } }]) {
    await assert.rejects(() => openWebStorage(environment as never), (error) => isStorageError(error, "Unavailable") && error.message === WEB_STORAGE_UNAVAILABLE);
  }
  assert.equal(WEB_STORAGE_UNAVAILABLE, "Storage is not available in this browser mode");
  // Nothing was created: a browser that later provides storage starts empty.
  assert.deepEqual(await (await openWebStorage(fakeBrowser())).listProjects(), []);
});

// Requirement: Desktop project library folder
const filledLibrary = async () => {
  const library = temporaryDirectory("library"), cache = temporaryDirectory("cache");
  const port = await openDesktopStorage({ library, cache });
  const one = addAsset(project("p1", "Wedding", NOW), ctx(), { id: "a1", name: "vows.mp4", type: "video", size: 512, tags: ["ceremony"], provenance: { source: "imported", originalFileName: "vows.mp4" } }).document;
  const media = await port.writeMedia("p1", "a1", bytes(512), { extension: "mp4" });
  one.media.assets[0].contentHash = media.contentHash;
  await saveProject(port, setLocal(one, (local) => { local.folderId = "f1"; local.trash = null; }));
  await saveProject(port, setLocal(project("p2", "Holiday", NOW + 5000), (local) => { local.trash = { kind: "project", deleted_ms: NOW + 2000 }; }));
  await port.writeLibrary("folders", { folders: [{ id: "f1", name: "Clients", parentId: null }] });
  await port.putDocument("script", "script-1", { title: "Pilot" });
  await saveSound(port, { id: "snd-1", savedAt_ms: NOW }, NOW);
  await port.writeLibrary("luts", [{ id: "user:abc", name: "Teal" }]);
  await port.writeLibrary("brand-kits", [{ id: "kit-1" }]);
  return { library, cache, port };
};

test("Desktop project library folder — Scenario: Index rebuilt", async () => {
  const { library, cache, port } = await filledLibrary();
  const before = await readEverything(port, ["p1", "p2"]);
  const extras = [await port.readLibrary("luts"), await port.readLibrary("brand-kits"), await savedSounds(port), await port.getDocument("script", "script-1")];
  port.close();
  rmSync(join(library, "library.sqlite"));
  const restarted = await openDesktopStorage({ library, cache });
  assert.equal(restarted.indexRebuilt, true);
  assert.deepEqual(await readEverything(restarted, ["p1", "p2"]), before);
  assert.deepEqual((await restarted.listProjects()).map((entry) => [entry.name, entry.folderId, entry.trash]), [["Holiday", null, { kind: "project", deleted_ms: NOW + 2000 }], ["Wedding", "f1", null]]);
  const opened = await loadProject(restarted, "p1");
  const asset = opened.document.media.assets[0];
  assert.deepEqual([asset.name, asset.tags, asset.folderId, asset.provenance.originalFileName], ["vows.mp4", ["ceremony"], null, "vows.mp4"]);
  assert.deepEqual(await restarted.readMedia("p1", "a1"), bytes(512), "managed media is online");
  assert.deepEqual([await restarted.readLibrary("luts"), await restarted.readLibrary("brand-kits"), await savedSounds(restarted), await restarted.getDocument("script", "script-1")], extras);
  restarted.close();
  // An index that fails its integrity check is replaced the same way.
  rmSync(join(library, "library.sqlite"));
  cpSync(join(library, "folders.json"), join(library, "library.sqlite"));
  const repaired = await openDesktopStorage({ library, cache });
  assert.deepEqual([repaired.indexRebuilt, (await repaired.listProjects()).length], [true, 2]);
});

test("Desktop project library folder — Scenario: Project directory copied in", async () => {
  const { library: other, port: source } = await filledLibrary();
  source.close();
  const library = temporaryDirectory("library"), cache = temporaryDirectory("cache");
  (await openDesktopStorage({ library, cache })).close();
  // The user copies a project directory from another library while the app is closed.
  cpSync(join(other, "p1"), join(library, "p1"), { recursive: true });
  rmSync(join(library, "library.sqlite"));
  const port = await openDesktopStorage({ library, cache });
  assert.deepEqual((await port.listProjects()).map((entry) => [entry.id, entry.name]), [["p1", "Wedding"]]);
  const opened = await loadProject(port, "p1");
  assert.equal(opened.document.media.assets[0].name, "vows.mp4", "its clips resolve to the asset records of its own project.json");
  assert.deepEqual(await port.readMedia("p1", "a1"), bytes(512), "its managed media plays");
});

test("Desktop project library folder — Scenario: Nothing durable lives only in the index", async () => {
  const library = temporaryDirectory("library"), cache = temporaryDirectory("cache");
  const port = await openDesktopStorage({ library, cache });
  // The whole conformance suite, with library.sqlite deleted and rebuilt after every mutating operation.
  let rebuilds = 0;
  await conformance(port, async () => { rebuilds++; await port.dropAndRebuildIndex(); });
  assert.ok(rebuilds >= 12, `rebuilt ${rebuilds} times`);
  assert.deepEqual(readdirSync(library).filter((name) => /\.tmp$/.test(name)), [], "no temporary file is left behind");
});

// Requirement: Stored record layout
test("Stored record layout — Scenario: Runtime data is stripped", async () => {
  for (const platform of platforms()) {
    const port = await platform.open();
    const audio = addAsset(project("p1"), ctx(), { id: "a1", name: "song.mp3", type: "audio", size: 10, duration: 480_000 }).document;
    // In memory the editor holds a decoded buffer on an element and a selection beside the document.
    const inMemory = { ...structuredClone(audio), selection: { elementIds: ["e1"] }, history: [1, 2, 3] } as any;
    inMemory.media.assets[0].buffer = new Float32Array(1024);
    inMemory.media.assets[0].file = new Blob(["x"]);
    const text = await saveProject(port, inMemory);
    assert.equal(/buffer|selection|history|"file"/.test(text), false, platform.name);
    const reloaded = await loadProject(port, "p1");
    assert.equal(canonicalize(reloaded.document), canonicalize(audio), "reloading yields the same canonical document");
    assert.equal(/data:image/.test(serializeProjectRecord({ ...audio, metadata: { ...audio.metadata, thumbnail: "data:image/png;base64,AAAA" } } as never)), false, "a thumbnail is never embedded as a data URL");
  }
});

test("Stored record layout — Scenario: Saved sounds are global", async () => {
  for (const platform of platforms()) {
    const port = await platform.open();
    await saveProject(port, project("p1")); await saveProject(port, project("p2"));
    // Saved while the first project is open …
    await saveSound(port, { id: "snd-rain", savedAt_ms: NOW, name: "Rain" }, NOW);
    // … and listed with the second one open: the store is keyed by nothing but the device.
    await loadProject(port, "p2");
    assert.deepEqual((await savedSounds(port)).map((sound) => sound.id), ["snd-rain"], platform.name);
    assert.deepEqual(await port.readLibrary("saved-sounds"), { sounds: [{ id: "snd-rain", savedAt_ms: NOW, name: "Rain" }], lastModified_ms: NOW });
    await saveSound(port, { id: "snd-rain", savedAt_ms: NOW + 5 }, NOW + 5);
    assert.equal((await savedSounds(port)).length, 1, "an id already present is skipped");
  }
});

test("Stored record layout — Scenario: Shared bytes on every platform", async () => {
  // The scenario's file is 100 MiB; the rule does not depend on size, so the test uses 1 MiB of the same bytes.
  const file = bytes(2 ** 20, 9);
  for (const platform of platforms()) {
    const port = await platform.open();
    await saveProject(port, project("p1")); await saveProject(port, project("p2"));
    const first = await port.writeMedia("p1", "a1", file, { extension: "mov" }), second = await port.writeMedia("p2", "a9", file, { extension: "mov" });
    assert.deepEqual([first.shared, second.shared, await port.mediaReferences(first.contentHash)], [false, true, 2], platform.name);
    await port.deleteProject("p1");
    assert.deepEqual(toHex(sha256(await port.readMedia("p2", "a9"))), first.contentHash, "deleting one project leaves the file readable from the other");
    assert.equal(await port.mediaReferences(first.contentHash), 1);
  }
  // On desktop "stored once" is visible on disk: one file, and after the owner is deleted it lives in the survivor's directory.
  const library = temporaryDirectory("library");
  const desktop = await openDesktopStorage({ library, cache: temporaryDirectory("cache") });
  await desktop.writeMedia("p1", "a1", file, { extension: "mov" }); await desktop.writeMedia("p2", "a9", file, { extension: "mov" });
  assert.deepEqual([readdirSync(join(library, "p1", "media")), existsSync(join(library, "p2", "media"))], [["a1.mov"], false]);
  await desktop.deleteProject("p1");
  assert.deepEqual([existsSync(join(library, "p1")), readdirSync(join(library, "p2", "media"))], [false, ["a9.mov"]]);
});

test("Stored record layout — Scenario: Asset record lives in the project document", async () => {
  for (const platform of platforms()) {
    const port = await platform.open();
    const before = addAsset(project("p1"), ctx(), { id: "a1", name: "IMG_0001.mov", type: "video", size: 10 }).document;
    await saveProject(port, before); await port.writeLibrary("folders", { folders: [] });
    const others = [await port.readLibrary("folders"), await port.listDocuments("script")];
    const commit = renameAsset(before, ctx(NOW + 9000), "a1", "Opening shot");
    assert.deepEqual(commit.patch, [{ op: "replace", path: "/media/assets/@a1/name", value: "Opening shot" }, { op: "replace", path: "/metadata/updated_ms", value: NOW + 9000 }]);
    assert.equal(commit.history, true, "one undo step");
    await saveProject(port, commit.document);
    assert.equal((await loadProject(port, "p1")).document.media.assets[0].name, "Opening shot", platform.name);
    assert.deepEqual([await port.readLibrary("folders"), await port.listDocuments("script")], others, "no record outside the project record changes");
  }
});

test("Stored record layout — Scenario: Local section is saved with the record but not hashed", async () => {
  for (const platform of platforms()) {
    const port = await platform.open();
    const before = setLocal(project("p1"), (local) => { local.timelineViewState = { zoomLevel: 1, scrollLeft: 0, playheadTime: 0, scenePlayheads: {}, expandedKeyframeElementIds: [] }; });
    const scrolled = setLocal(before, (local) => { (local.timelineViewState as any).scrollLeft = 640; });
    await saveProject(port, scrolled);
    assert.equal(JSON.parse(await port.readProjectText("p1")).local.timelineViewState.scrollLeft, 640, platform.name);
    assert.equal(documentHash(scrolled), documentHash(before), "the document hash is unchanged");
    assert.deepEqual(commitChange(scrolled, ctx(), { commandType: "noop", label: "" }, () => undefined).patch, [], "no state patch is emitted");
    assert.equal(((await loadProject(port, "p1")).document as any).local.timelineViewState.scrollLeft, 640);
  }
});

// Requirement: Document kinds in the client store
test("Document kinds in the client store — Scenario: Script survives without a host", async () => {
  const library = temporaryDirectory("library"), cache = temporaryDirectory("cache");
  const editing = await openDesktopStorage({ library, cache });
  await editing.putDocument("script", "script-1", { title: "Pilot", body: "INT. STUDIO — DAY" });
  await editing.putDocument("script", "script-1", { title: "Pilot", body: "INT. STUDIO — NIGHT" });
  editing.close();
  // The app restarts; no host is involved at any point.
  const restarted = await openDesktopStorage({ library, cache });
  assert.deepEqual(await restarted.getDocument("script", "script-1"), { title: "Pilot", body: "INT. STUDIO — NIGHT" });
  assert.ok(existsSync(join(library, "scripts", "script-1.json")));
  for (const platform of platforms()) {
    const port = await platform.open();
    await port.putDocument("script", "s", { body: "edit" });
    assert.deepEqual(await (await platform.open()).getDocument("script", "s"), { body: "edit" }, platform.name);
  }
});

test("Document kinds in the client store — Scenario: Workflow cache bound", async () => {
  for (const platform of platforms()) {
    const port = await platform.open();
    // The cache orders by when a workflow was opened, on the store's clock, so the opens are spaced out.
    for (let index = 1; index <= WORKFLOW_CACHE_LIMIT; index++) { await port.putDocument("workflow", `wf-${String(index).padStart(2, "0")}`, { index }); await new Promise((resolve) => setTimeout(resolve, 1)); }
    await port.getDocument("workflow", "wf-01");
    await new Promise((resolve) => setTimeout(resolve, 2));
    await port.putDocument("workflow", "wf-51", { index: 51 });
    const cached = await port.listDocuments("workflow");
    assert.equal(cached.length, 50, platform.name);
    assert.equal(cached.includes("wf-02"), false, "the least recently opened one is no longer cached");
    assert.ok(cached.includes("wf-01") && cached.includes("wf-51"));
  }
});

// Requirement: Time base and timestamp conventions
test("Time base and timestamp conventions — Scenario: Non-integer tick repaired", async () => {
  const port = await platforms()[1].open();
  const stored = JSON.parse(serializeProjectRecord(insertElement(addAsset(project("p1"), ctx(), { id: "a1", name: "c.mp4", type: "video", size: 1, duration: 480_000 }).document, ctx(), "p1-track", { type: "video", id: "v1", name: "clip", startTime: 4000, duration: 240_000, mediaId: "a1" }).document));
  stored.scenes[0].tracks.main.elements[0].startTime = 4000.4;
  await port.writeProjectText("p1", JSON.stringify(stored));
  const loaded = await loadProject(port, "p1");
  assert.equal(loaded.document.scenes[0].tracks.main.elements[0].startTime, 4000);
  assert.equal(loaded.notice, "1 items were repaired or skipped while loading");
});

test("Time base and timestamp conventions — Scenario: Millisecond timestamps", async () => {
  const port = await platforms()[0].open();
  const stored = JSON.parse(await saveProject(port, project("p1")));
  assert.deepEqual([Number.isInteger(stored.metadata.created_ms), Number.isInteger(stored.metadata.updated_ms), stored.metadata.created_ms], [true, true, NOW]);
  assert.equal(/\d{4}-\d{2}-\d{2}T/.test(JSON.stringify(stored)), false, "no ISO-string timestamp exists at schema 32");
  assert.deepEqual(Object.keys(stored.metadata).filter((key) => /At$/.test(key)), []);
});

test("Time base and timestamp conventions — Scenario: Rational is reduced", async () => {
  const port = await platforms()[2].open();
  const stored = JSON.parse(serializeProjectRecord(project("p1")));
  stored.settings.fps = { numerator: 60000, denominator: 2000 };
  await port.writeProjectText("p1", JSON.stringify(stored));
  assert.deepEqual((await loadProject(port, "p1")).document.settings.fps, { numerator: 30, denominator: 1 });
});

// Requirement: Schema versioning
test("Schema versioning — Scenario: Legacy detection", () => {
  assert.equal(detectVersion({ scenes: [{ id: "s" }] }), 1);
  assert.equal(detectVersion({ scenes: [] }), 0);
  assert.equal(detectVersion({}), 0);
  assert.equal(detectVersion({ version: 17, scenes: [] }), 17);
  assert.equal(detectVersion({ schemaVersion: 32, version: 31 }), 32);
  assert.deepEqual([openability({ version: 31 }), openability({ schemaVersion: 32, minReaderSchemaVersion: 32 })], ["needs-migration", "current"]);
});

test("Schema versioning — Scenario: Newer additive project keeps unknown fields", async () => {
  const port = await platforms()[1].open();
  const base = addAsset(project("p1"), ctx(), { id: "a1", name: "c.mp4", type: "video", size: 1, duration: 960_000 }).document;
  const one = insertElement(base, ctx(), "p1-track", { type: "video", id: "v1", name: "one", startTime: 0, duration: 240_000, mediaId: "a1" }).document;
  const two = insertElement(one, ctx(), "p1-track", { type: "video", id: "v2", name: "two", startTime: 240_000, duration: 240_000, mediaId: "a1" }).document;
  const newer = JSON.parse(serializeProjectRecord(two));
  newer.schemaVersion = 33;
  newer.scenes[0].tracks.main.elements[0].lensCorrection = { k1: 0.1 };
  await port.writeProjectText("p1", JSON.stringify(newer));
  assert.equal(openability(newer), "newer-compatible");
  const opened = await loadProject(port, "p1");
  assert.equal(opened.readOnly, false);
  const edited = commitChange(opened.document, ctx(NOW + 5000), { commandType: "element.update", label: "Edit" }, (draft) => { (draft.scenes[0].tracks.main.elements[1] as any).opacity = 0.5; }).document;
  await saveProject(port, edited);
  const saved = JSON.parse(await port.readProjectText("p1"));
  assert.deepEqual([saved.schemaVersion, saved.scenes[0].tracks.main.elements[0].lensCorrection, saved.scenes[0].tracks.main.elements[1].opacity], [33, { k1: 0.1 }, 0.5]);
});

test("Schema versioning — Scenario: Newer incompatible project", async () => {
  const port = await platforms()[1].open();
  const text = JSON.stringify({ ...JSON.parse(serializeProjectRecord(project("p1", "From the future"))), schemaVersion: 40, minReaderSchemaVersion: 33 });
  await port.writeProjectText("p1", text);
  assert.equal(openability(JSON.parse(text)), "needs-newer-app");
  await assert.rejects(() => loadProject(port, "p1"), (error) => error instanceof StorageError && error.message === NEEDS_NEWER_APP && NEEDS_NEWER_APP === "Needs newer app");
  assert.equal(await port.readProjectText("p1"), text, "the record is left byte-identical");
  assert.deepEqual((await port.listProjects()).map((entry) => [entry.name, entry.schemaVersion, entry.minReaderSchemaVersion]), [["From the future", 40, 33]], "its card is still listed, with the versions that decide the badge");
});
