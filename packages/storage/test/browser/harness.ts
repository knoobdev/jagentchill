/**
 * Runs in a real browser (Chromium, through Playwright): the web store on the browser's own IndexedDB and Origin
 * Private File System. Each check returns plain data; the Node test asserts on it.
 */
import { addAsset, applyPatch, canonicalize, renameProject, sha256, toHex } from "@jagentchill/editor-core";
import { createProjectDocument } from "@jagentchill/protocol";
import {
  blobZipSource, classicDataPresent, classicOriginSource, createPersistenceRequest, createPreferences, createProjectAutosave, exportProjectPackage, importProjectPackage, ingestClassic,
  loadProject, memorySink, openWebStorage, saveProject, splitRecord, verifyJournal,
} from "../../src/index.ts";

const NOW = 1_800_000_000_000;
const bytes = (length: number, seed = 1) => Uint8Array.from({ length }, (_, index) => (index * 31 + seed) & 255);
const project = (id: string, name: string) => createProjectDocument({ id, mainSceneId: `${id}-scene`, mainTrackId: `${id}-track`, now_ms: NOW, name });
const ids = (prefix: string) => { let count = 0; return () => `${prefix}${++count}`; };
const request = <T>(run: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => { run.onsuccess = () => resolve(run.result); run.onerror = () => reject(run.error); });
async function opfsNames(...path: string[]): Promise<string[] | null> {
  try {
    let directory = await navigator.storage.getDirectory();
    for (const part of path) directory = await directory.getDirectoryHandle(part);
    const names: string[] = [];
    for await (const [name] of (directory as unknown as { entries(): AsyncIterable<[string, unknown]> }).entries()) names.push(name);
    return names.sort();
  } catch { return null; }
}

export async function run(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { userAgent: navigator.userAgent };
  const port = await openWebStorage();

  // Web layout: the record and the asset metadata in IndexedDB, the asset bytes an OPFS file.
  const clip = bytes(300_000);
  const withAsset = addAsset(project("p1", "Browser project"), { now_ms: NOW, newId: ids("a") }, { id: "a1", name: "clip.mp4", type: "video", size: clip.length, contentHash: toHex(sha256(clip)) }).document;
  const stored = await port.writeMediaStream("p1", "a1", [clip.subarray(0, 100_000), clip.subarray(100_000)], { extension: "mp4" });
  await saveProject(port, withAsset);
  const database = await request(indexedDB.open("jagentchill"));
  const row = await request(database.transaction("projects").objectStore("projects").get("p1"));
  database.close();
  const file = await (await (await (await (await navigator.storage.getDirectory()).getDirectoryHandle("projects")).getDirectoryHandle("p1")).getDirectoryHandle("media")).getFileHandle("a1.mp4");
  out.layout = {
    recordInIndexedDb: typeof row === "string" && JSON.parse(row).media.assets[0].name === "clip.mp4",
    opfsFileSize: (await file.getFile()).size, hashMatches: stored.contentHash === toHex(sha256(clip)),
    readBack: toHex(sha256(await port.readMedia("p1", "a1"))) === stored.contentHash,
    range: Array.from((await (async () => { const parts: number[] = []; for await (const chunk of port.readMediaStream("p1", "a1", { start: 299_998, end: 300_000 })) parts.push(...chunk); return parts; })())),
    expectedRange: Array.from(clip.subarray(299_998)),
  };

  // Identical bytes are stored once and counted per reference; deleting a project leaves nothing of it.
  await saveProject(port, addAsset(project("p2", "Second"), { now_ms: NOW, newId: ids("b") }, { id: "b1", name: "same.mp4", type: "video", size: clip.length, contentHash: stored.contentHash }).document);
  const shared = await port.writeMedia("p2", "b1", clip, { extension: "mp4" });
  const referencesBefore = await port.mediaReferences(stored.contentHash);
  await port.putSnapshot("p1", { id: "s1", kind: "manual", created_ms: NOW, label: "", duration: 0, schemaVersion: 32, record: "{}" });
  await port.deleteProject("p1");
  out.sharing = {
    shared: shared.shared, referencesBefore, referencesAfter: await port.mediaReferences(stored.contentHash), survivorReadable: toHex(sha256(await port.readMedia("p2", "b1"))) === stored.contentHash,
    opfsProjects: await opfsNames("projects"), deletedDirectory: await opfsNames("projects", "p1"), listed: (await port.listProjects()).map((entry) => entry.id),
  };

  // Autosave with a pending-patch journal; the journal replays to the saved record in this engine too.
  const base = project("p3", "Journal");
  await saveProject(port, base);
  const autosave = createProjectAutosave({ port, document: base, synced: true });
  for (const name of ["One", "Two", "Three"]) autosave.commit(renameProject(autosave.document, { now_ms: Date.now(), newId: ids("j") }, name));
  await autosave.flush();
  const journal = await port.readJournal("p3");
  const replayed = canonicalize(journal.reduce<object>((document, entry) => applyPatch(document, entry.patch as never), base));
  out.journal = { patches: journal.length, check: await verifyJournal(port, "p3", base), replayEqualsRecord: replayed === splitRecord(await port.readProjectText("p3")).canonical, replayed };

  // The cache store, the quota estimate and the indexes on the real stores.
  await port.cache.put({ kind: "proxy", contentHash: "h1" }, bytes(5000), { projectId: "p2" });
  const cached = (await port.cache.usage()).byCategory.Proxies;
  await port.rebuildIndexes();
  out.cache = { cached, afterRebuild: (await port.cache.usage()).byCategory.Proxies, cleared: await port.cache.clear("Proxies"), available: await port.available(), references: await port.mediaReferences(stored.contentHash) };

  // A project package written and read in the browser, the archive as a Blob.
  const sink = Object.assign(memorySink(), { close: async () => undefined, abort: async () => undefined });
  const exported = await exportProjectPackage(port, "p2", sink, { appVersion: "test", now_ms: NOW });
  await port.deleteProject("p2");
  const imported = await importProjectPackage(port, blobZipSource(new Blob([sink.bytes() as BlobPart])), { now_ms: NOW, newId: ids("i") });
  out.package = { entries: exported.manifest.entries.map((entry) => entry.path), imported: imported.projectId, assets: imported.assets, media: toHex(sha256(await port.readMedia("p2", "b1"))) === stored.contentHash, name: (await loadProject(port, "p2")).document.metadata.name };

  // In-place classic data: written the way classic's adapter writes it, read without creating or changing a classic store.
  const before = (await indexedDB.databases()).map((entry) => entry.name).sort();
  out.classicAbsent = await classicDataPresent({ indexedDB });
  out.noDatabaseCreatedByAsking = JSON.stringify((await indexedDB.databases()).map((entry) => entry.name).sort()) === JSON.stringify(before);
  const opening = indexedDB.open("video-editor-projects", 1);
  opening.onupgradeneeded = () => { opening.result.createObjectStore("projects", { keyPath: "id" }); };
  const classicDb = await request(opening);
  const classicRecord = {
    id: "classic-1", version: 31, metadata: { id: "classic-1", name: "From classic", duration: 0, createdAt: "2025-03-04T05:06:07.000Z", updatedAt: "2025-03-04T05:06:07.000Z" },
    settings: { fps: { numerator: 30, denominator: 1 }, canvasSize: { width: 1920, height: 1080 }, background: { type: "color", color: "#000000" } }, currentSceneId: "s",
    scenes: [{ id: "s", name: "Main scene", isMain: true, bookmarks: [], createdAt: "2025-03-04T05:06:07.000Z", updatedAt: "2025-03-04T05:06:07.000Z", tracks: { overlay: [], audio: [], main: { id: "m", name: "Main Track", type: "video", muted: false, hidden: false, elements: [] } } }],
  };
  await request(classicDb.transaction("projects", "readwrite").objectStore("projects").put(classicRecord));
  classicDb.close();
  const classicNames = (await indexedDB.databases()).map((entry) => entry.name).sort();
  const summary = await ingestClassic(port, classicOriginSource({ indexedDB, storage: navigator.storage, localStorage }), { now: () => NOW, newId: ids("classic-import-") });
  const again = await request(indexedDB.open("video-editor-projects"));
  const untouched = await request(again.transaction("projects").objectStore("projects").get("classic-1"));
  again.close();
  out.classic = {
    present: await classicDataPresent({ indexedDB }), imported: summary.imported.map((entry) => [entry.classicId, entry.fromVersion]), skipped: summary.skipped,
    schemaVersion: summary.imported[0] ? (await loadProject(port, summary.imported[0].projectId)).document.schemaVersion : null,
    importedFrom: summary.imported[0] ? (await loadProject(port, summary.imported[0].projectId)).document.metadata.importedFrom : null,
    classicUnchanged: JSON.stringify(untouched) === JSON.stringify(classicRecord),
    noClassicDatabaseAdded: JSON.stringify((await indexedDB.databases()).map((entry) => entry.name).sort()) === JSON.stringify(classicNames),
  };

  // The persistent-storage request against the browser's own navigator.storage.
  const preferences = createPreferences(localStorage);
  const view = await createPersistenceRequest({ platform: "web", storage: navigator.storage, prompts: false }, preferences).onProjectsScreen();
  out.persistence = { persisted: view.persisted, browserSays: await navigator.storage.persisted(), dialog: view.dialog, banner: view.banner?.text ?? null, storagePage: view.storagePage?.text ?? null, preferenceInLocalStorage: localStorage.getItem("jagentchill.pref.dismissals") };

  port.close();
  // After a restart (a second open of the same stores) everything is still there.
  const reopened = await openWebStorage();
  out.reopened = { projects: (await reopened.listProjects()).map((entry) => entry.name).sort(), journal: (await reopened.readJournal("p3")).length };
  reopened.close();
  return out;
}
