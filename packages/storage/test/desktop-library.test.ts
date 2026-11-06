// Fakes declared: none for the store — the desktop library runs for real in temporary directories. Scaled-down or injected where the real thing cannot run in a test process: the 12 GiB library of "Move the library" is a few files with the destination's free space injected (`freeBytes`); the removed volume of "Move interrupted" is a copy step that starts failing at 40 % (`copyFile`); the 4 GiB linked file is a sparse file; "another computer" is a lock file written with another host name; the unplugged drive is a path under a directory that does not exist.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { closeSync, cpSync, existsSync, ftruncateSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { addAsset, setLocal, sha256, toHex } from "@jagentchill/editor-core";
import { createProjectDocument, type ProjectDocument } from "@jagentchill/protocol";
import { collect, isStorageError, loadProject, saveProject, serializeProjectRecord } from "../src/index.ts";
import { defaultLibraryFolder, inspectLibraryLocation, LIBRARY_LOCK, openDesktopStorage, readLibraryLock, type DesktopStorage } from "../src/desktop.ts";
import { temporaryDirectory } from "./support/platforms.ts";

const NOW = 1_800_000_000_000, MiB = 1024 * 1024, GiB = 1024 * MiB;
const ids = () => { let count = 0; return () => `id${++count}`; };
const project = (id: string, name = "Project"): ProjectDocument => createProjectDocument({ id, mainSceneId: `${id}-scene`, mainTrackId: `${id}-track`, now_ms: NOW, name });
const bytes = (length: number, seed = 1) => Uint8Array.from({ length }, (_, index) => (index * 31 + seed) & 255);
const fileHash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
function tree(root: string, directory = root, out: Record<string, string> = {}): Record<string, string> {
  for (const name of readdirSync(directory)) {
    const full = join(directory, name);
    if (statSync(full).isDirectory()) tree(root, full, out); else if (name !== LIBRARY_LOCK && name !== "library.sqlite") out[full.slice(root.length + 1)] = fileHash(full);
  }
  return out;
}
async function library(projects = 3) {
  const folder = temporaryDirectory("library"), cache = temporaryDirectory("cache");
  const port = await openDesktopStorage({ library: folder, cache });
  for (let index = 1; index <= projects; index++) {
    const id = `p${index}`;
    const document = addAsset(project(id, `Project ${index}`), { now_ms: NOW, newId: ids() }, { id: "a1", name: "clip.mp4", type: "video", size: 4096, contentHash: toHex(sha256(bytes(4096, index))) }).document;
    await port.writeMedia(id, "a1", bytes(4096, index), { extension: "mp4" });
    await saveProject(port, document);
    await port.putSnapshot(id, { id: "s1", kind: "manual", created_ms: NOW, label: "v1", duration: 0, schemaVersion: 32, record: serializeProjectRecord(document) });
  }
  await port.writeLibrary("folders", { folders: [{ id: "f1", name: "Work", parentId: null }] });
  await port.putDocument("script", "script-1", { title: "Pilot" });
  await port.writeLibraryFile("luts/teal.cube", bytes(128));
  return { folder, cache, port };
}

// Requirement: Desktop project library folder
test("Desktop project library folder — Scenario: Move the library", async () => {
  const { folder, cache, port } = await library();
  const before = tree(folder), list = (await port.listProjects()).map((entry) => [entry.id, entry.name]);
  const destination = join(temporaryDirectory("volume"), "JAgentChill");
  mkdirSync(destination);
  const progress: number[] = [];
  let persisted = "";
  // An empty folder on another volume with 20 GiB free.
  const result = await port.moveTo(destination, { freeBytes: async () => 20 * GiB, onProgress: (step) => progress.push(step.copiedFiles), persist: async (moved) => { persisted = moved; } });
  assert.equal(result.moved, true);
  const moved = (result as { storage: DesktopStorage }).storage;
  assert.deepEqual(tree(destination), before, "every file exists at the destination with matching SHA-256");
  assert.deepEqual((await moved.listProjects()).map((entry) => [entry.id, entry.name]), list, "the Projects list is unchanged");
  assert.deepEqual([existsSync(folder), persisted, moved.library, progress.at(-1)], [false, destination, destination, Object.keys(before).length + 1], "the old folder no longer contains the library (every file and the derived index were copied)");
  assert.deepEqual(await moved.readMedia("p2", "a1"), bytes(4096, 2));
  assert.deepEqual([(await moved.listSnapshots("p1")).length, await moved.getDocument("script", "script-1"), (await moved.readLibraryFile("luts/teal.cube"))!.length], [1, { title: "Pilot" }, 128]);
  assert.equal(readLibraryLock(destination)!.pid, process.pid, "the running instance holds the lock of the new folder");
  moved.close();
  assert.equal(existsSync(join(destination, LIBRARY_LOCK)), false);
  // Refusals name their reason and leave the library where it is.
  const again = await library(1);
  const occupied = temporaryDirectory("occupied");
  writeFileSync(join(occupied, "notes.txt"), "mine");
  const refusals = [
    await again.port.moveTo(occupied, { freeBytes: async () => 20 * GiB }),
    await again.port.moveTo(join(again.folder, "p1", "inside"), { freeBytes: async () => 20 * GiB }),
    await again.port.moveTo(join(temporaryDirectory("small"), "lib"), { freeBytes: async () => 10 * MiB }),
  ] as { moved: boolean; message: string; reason: string; code: string }[];
  assert.deepEqual(refusals.map((refusal) => [refusal.moved, refusal.message, refusal.code]), [[false, "The library was not moved", "not-empty"], [false, "The library was not moved", "inside-library"], [false, "The library was not moved", "no-space"]]);
  assert.deepEqual(refusals.map((refusal) => refusal.reason), ["The destination folder is not empty", "The destination is inside the current library", "The destination has not enough free space (50.0 MiB needed, 10.0 MiB available)"]);
  assert.deepEqual([readdirSync(occupied), (await again.port.listProjects()).length], [["notes.txt"], 1]);
  void cache;
});

test("Desktop project library folder — Scenario: Move interrupted", async () => {
  const { folder, port } = await library();
  const before = tree(folder), total = Object.keys(before).length;
  const destination = join(temporaryDirectory("volume"), "JAgentChill");
  let copied = 0;
  // The destination volume is removed while 40 % of the files are copied.
  const result = await port.moveTo(destination, {
    freeBytes: async () => 20 * GiB,
    copyFile: async (source, target) => { if (copied >= Math.floor(total * 0.4)) throw Object.assign(new Error("ENXIO: no such device or address"), { code: "ENXIO" }); copied++; cpSync(source, target); },
  }) as { moved: boolean; message: string; reason: string };
  assert.deepEqual([result.moved, result.message], [false, "The library was not moved"]);
  assert.match(result.reason, /^A file could not be copied: ENXIO/, "with the reason");
  assert.equal(existsSync(destination), false, "the partial copy is removed");
  assert.deepEqual(tree(folder), before);
  // The app keeps using the old library, and every project still opens.
  for (const entry of await port.listProjects()) assert.equal((await loadProject(port, entry.id)).document.metadata.id, entry.id);
  await port.writeLibrary("folders", { folders: [] });
  // A cancellation and a copy that does not verify end the same way.
  const cancelled = await port.moveTo(destination, { freeBytes: async () => 20 * GiB, signal: { aborted: true } }) as { moved: boolean; code: string };
  const corrupted = await port.moveTo(destination, { freeBytes: async () => 20 * GiB, copyFile: async (source, target) => { cpSync(source, target); if (target.endsWith("project.json")) writeFileSync(target, readFileSync(target, "utf8").replace("Project", "Projekt")); } }) as { moved: boolean; code: string };
  assert.deepEqual([cancelled.moved, cancelled.code, corrupted.moved, corrupted.code, existsSync(destination), (await port.listProjects()).length], [false, "cancelled", false, "verify-failed", false, 3]);
});

test("Desktop project library folder — Scenario: Library drive missing", () => {
  const drive = join(temporaryDirectory("volumes"), "ExternalDrive");
  const path = join(drive, "JAgentChill");
  // The drive is not mounted: its mount point is under a directory the app cannot write to.
  const unmounted = inspectLibraryLocation(join("/Volumes", "JC-Not-Connected", "JAgentChill"), { usedBefore: true });
  assert.equal(unmounted.status, "missing");
  const dialog = unmounted as Extract<typeof unmounted, { status: "missing" }>;
  assert.equal(dialog.message, "Project library not found at /Volumes/JC-Not-Connected/JAgentChill");
  assert.deepEqual(dialog.actions.map((action) => [action.label, action.enabled]), [["Retry", true], ["Locate library…", true], ["Create a new library here", false], ["Quit", true]], "\"Create a new library here\" is disabled");
  assert.equal(existsSync("/Volumes/JC-Not-Connected"), false, "no new empty library is created at that path");
  // A missing folder on a writable volume offers to create one, and still writes nothing by itself.
  const writable = inspectLibraryLocation(path, { usedBefore: true });
  assert.deepEqual([(writable as typeof dialog).actions.find((action) => action.id === "create")!.enabled, existsSync(drive)], [true, false]);
  // First run: nothing was ever stored, so the default location is simply new; an existing folder is fine.
  assert.equal(inspectLibraryLocation(path, { usedBefore: false }).status, "new");
  assert.equal(inspectLibraryLocation(temporaryDirectory("existing"), { usedBefore: true }).status, "ok");
  assert.deepEqual([defaultLibraryFolder("darwin", {}, "/Users/an"), defaultLibraryFolder("win32", { USERPROFILE: "C:\\Users\\an" }, "x").replace(/\\/g, "/").replace(/\//g, "|"), defaultLibraryFolder("linux", { XDG_VIDEOS_DIR: "/data/videos" }, "/home/an"), defaultLibraryFolder("linux", {}, "/home/an")],
    ["/Users/an/Movies/JAgentChill", join("C:\\Users\\an", "Videos", "JAgentChill").replace(/\\/g, "/").replace(/\//g, "|"), "/data/videos/JAgentChill", "/home/an/Videos/JAgentChill"]);
});

/** A project with one external asset whose file lies outside the library. */
async function withExternal() {
  const { folder, cache, port } = await library(1);
  const outside = temporaryDirectory("footage"), file = join(outside, "interview.mov");
  writeFileSync(file, bytes(5000, 9));
  const reference = await port.grantExternalFile("p1", "ext", file);
  const { url, ...recorded } = reference;
  let document = (await loadProject(port, "p1")).document;
  document = addAsset(document, { now_ms: NOW + 1, newId: ids() }, { id: "ext", name: "interview.mov", type: "video", size: 5000, contentHash: fileHash(file) }).document;
  document = setLocal(document, (local) => { local.media = { ...(local.media as object), ext: { storage: "external", ...recorded, canDecode: true, needsProbe: false, proxy: { state: "none" }, present: { original: true, proxy: false, mezzanine: false } } }; });
  await saveProject(port, document);
  return { folder, cache, port, file, url, reference };
}

test("Desktop project library folder — Scenario: External file changed while the index was lost", async () => {
  const { folder, cache, port, file } = await withExternal();
  assert.equal(await port.externalStatus("p1", "ext"), "online");
  port.close();
  // The index is lost, and meanwhile the external file changed its size.
  rmSync(join(folder, "library.sqlite"));
  writeFileSync(file, bytes(6000, 9));
  const statuses: (string | null)[] = [];
  const restarted = await openDesktopStorage({ library: folder, cache, onStatus: (message) => statuses.push(message) });
  assert.deepEqual([restarted.indexRebuilt, statuses], [true, ["Rebuilding library index…", null]]);
  assert.equal(await restarted.externalStatus("p1", "ext"), "offline", "no grant is created for it: the asset is offline with \"Relink…\"");
  assert.deepEqual(await restarted.readMedia("p1", "a1"), bytes(4096, 1), "every other asset is unaffected");
  restarted.close();
  // Unchanged on disk, the file is online again after a rebuild, without a prompt.
  const fresh = await withExternal();
  fresh.port.close();
  rmSync(join(fresh.folder, "library.sqlite"));
  const reopened = await openDesktopStorage({ library: fresh.folder, cache: fresh.cache });
  assert.equal(await reopened.externalStatus("p1", "ext"), "online");
  assert.equal((await reopened.resolveGrant(fresh.reference.externalGrantId))!.path, fresh.file, "the grant is re-created with the recorded id");
});

test("Desktop project library folder: a 1 000-project library is rebuilt within 10 s, and a copied directory whose id collides is listed as a copy", async () => {
  const folder = temporaryDirectory("library"), cache = temporaryDirectory("cache");
  (await openDesktopStorage({ library: folder, cache })).close();
  for (let index = 0; index < 1000; index++) {
    const id = `proj${String(index).padStart(4, "0")}`;
    mkdirSync(join(folder, id, "media"), { recursive: true });
    const hash = toHex(sha256(Uint8Array.of(index & 255, index >> 8)));
    const record = JSON.parse(serializeProjectRecord(project(id, `Project ${index}`)));
    record.media.assets = [{ id: "a1", name: "c.mp4", type: "video", kind: null, size: 2, contentHash: hash, created_ms: NOW }];
    writeFileSync(join(folder, id, "project.json"), JSON.stringify(record));
    writeFileSync(join(folder, id, "media", "a1.mp4"), Uint8Array.of(index & 255, index >> 8));
  }
  rmSync(join(folder, "library.sqlite"));
  const started = performance.now();
  const port = await openDesktopStorage({ library: folder, cache });
  const elapsed = performance.now() - started;
  assert.deepEqual([port.indexRebuilt, (await port.listProjects()).length], [true, 1000]);
  assert.ok(elapsed < 10_000, `rebuilt in ${Math.round(elapsed)} ms`);
  port.close();
  // The user copies a project directory under another name while the app is closed: its id collides.
  cpSync(join(folder, "proj0001"), join(folder, "proj0001 copy"), { recursive: true });
  const reopened = await openDesktopStorage({ library: folder, cache, newId: () => "copied-id" });
  const names = (await reopened.listProjects()).filter((entry) => entry.name === "Project 1").map((entry) => entry.id).sort();
  assert.deepEqual([reopened.indexRebuilt, names, (await reopened.listProjects()).length], [true, ["copied-id", "proj0001"], 1001], "it is listed as a copy under a new id");
  assert.deepEqual([...await reopened.readMedia("copied-id", "a1")], [1, 0]);
  reopened.close();
  // An index older than a project.json is rebuilt; a clean shutdown leaves it fresh.
  assert.equal((await openDesktopStorage({ library: folder, cache })).indexRebuilt, false);
});

test("Desktop project library folder: a library whose lock belongs to a live process on another machine opens read-only", async () => {
  const { folder, cache, port } = await library(1);
  port.close();
  writeFileSync(join(folder, LIBRARY_LOCK), JSON.stringify({ host: "studio-mac.local", pid: 4242, started_ms: Date.now(), heartbeat_ms: Date.now() }));
  const shared = await openDesktopStorage({ library: folder, cache });
  assert.deepEqual([shared.readOnly, shared.banner], [true, "This library is open on another computer"]);
  assert.equal((await shared.listProjects()).length, 1, "it is read");
  await assert.rejects(() => shared.writeProjectText("p1", "{}"), (error) => isStorageError(error, "Unavailable") && error.details?.reason === "library-read-only");
  assert.equal(JSON.parse(readFileSync(join(folder, LIBRARY_LOCK), "utf8")).host, "studio-mac.local", "the other machine's lock is not touched");
  shared.close();
  // A lock whose heartbeat stopped more than 30 s ago is not a live process.
  writeFileSync(join(folder, LIBRARY_LOCK), JSON.stringify({ host: "studio-mac.local", pid: 4242, started_ms: 0, heartbeat_ms: Date.now() - 31_000 }));
  const taken = await openDesktopStorage({ library: folder, cache });
  assert.deepEqual([taken.readOnly, readLibraryLock(folder)!.pid], [false, process.pid]);
  taken.close();
});

// Requirement: External file references on desktop
test("External file references on desktop — Scenario: Path outside the allow-list", async () => {
  const { port, url, file, reference } = await withExternal();
  assert.match(reference.externalGrantId, /^[0-9a-f]{32}$/, "an unguessable 128-bit id");
  assert.equal((await port.serveExternalFile({ url })).status, 200);
  // A tampered record names a path for which no grant exists.
  const secret = join(temporaryDirectory("private"), "secrets.txt");
  writeFileSync(secret, "do not serve");
  const record = JSON.parse(await port.readProjectText("p1"));
  record.local.media.forged = { ...record.local.media.ext, externalPath: secret, externalGrantId: "0".repeat(32) };
  await port.writeProjectText("p1", JSON.stringify(record));
  assert.equal((await port.serveExternalFile({ url: `jagentchill-file://${"0".repeat(32)}/secrets.txt` })).status, 404, "the scheme answers 404");
  assert.equal(await port.externalStatus("p1", "forged"), "offline", "and the asset is shown offline");
  // A request for a path other than the granted one, and malformed URLs, are answered 404 as well.
  for (const bad of [`jagentchill-file://${reference.externalGrantId}/secrets.txt`, `jagentchill-file://${reference.externalGrantId}/..%2F..%2Fetc%2Fhosts`, `jagentchill-file://${reference.externalGrantId}/interview.mov/extra`, `jagentchill-file://nope/interview.mov`, `file://${file}`]) {
    assert.equal((await port.serveExternalFile({ url: bad })).status, 404, bad);
  }
  // A grant is revocable, and is removed with the project.
  await port.revokeGrant(reference.externalGrantId);
  assert.equal((await port.serveExternalFile({ url })).status, 404);
  const other = await withExternal();
  await other.port.deleteProject("p1");
  assert.deepEqual([await other.port.resolveGrant(other.reference.externalGrantId), (await other.port.serveExternalFile({ url: other.url })).status, existsSync(other.file)], [undefined, 404, true], "the external file itself is never deleted");
});

test("External file references on desktop — Scenario: Linked file is not copied", async () => {
  const { folder, port } = await library(1);
  const usage = () => Object.keys(tree(folder)).reduce((sum, path) => sum + statSync(join(folder, path)).size, 0) + statSync(join(folder, "library.sqlite")).size;
  const before = usage();
  // A 4 GiB file (sparse: its size is real, its blocks are not allocated).
  const big = join(temporaryDirectory("footage"), "feature.mov"), handle = openSync(big, "w");
  ftruncateSync(handle, 4 * GiB); closeSync(handle);
  const reference = await port.grantExternalFile("p1", "big", big);
  let document = addAsset((await loadProject(port, "p1")).document, { now_ms: NOW + 1, newId: ids() }, { id: "big", name: "feature.mov", type: "video", size: 4 * GiB }).document;
  document = setLocal(document, (local) => { const { url: _url, ...recorded } = reference; local.media = { ...(local.media as object), big: { storage: "external", ...recorded, canDecode: true, needsProbe: false, proxy: { state: "none" }, present: { original: true, proxy: false, mezzanine: false } } }; });
  await saveProject(port, document);
  assert.equal(reference.externalSize, 4 * GiB);
  assert.ok(usage() - before < MiB, `the library folder grows by less than 1 MiB (${usage() - before} bytes)`);
  assert.equal(await port.hasMedia("p1", "big"), false, "nothing was copied into the library");
});

test("External file references on desktop — Scenario: Seek inside a large linked file", async () => {
  const { port } = await library(1);
  const big = join(temporaryDirectory("footage"), "feature.mov"), handle = openSync(big, "w");
  ftruncateSync(handle, 4 * GiB);
  const keyframe = bytes(65_536, 42);
  writeSync(handle, keyframe, 0, keyframe.length, 3 * GiB);
  closeSync(handle);
  const { url } = await port.grantExternalFile("p1", "big", big);
  const response = await port.serveExternalFile({ url, range: `bytes=${3 * GiB}-${3 * GiB + keyframe.length - 1}` });
  assert.deepEqual([response.status, response.headers["content-range"], response.headers["content-length"], response.headers["accept-ranges"]], [206, `bytes ${3 * GiB}-${3 * GiB + keyframe.length - 1}/${4 * GiB}`, String(keyframe.length), "bytes"]);
  assert.deepEqual(await collect(response.body!), keyframe, "exactly that range");
  const tail = await port.serveExternalFile({ url, range: "bytes=-16" });
  assert.deepEqual([tail.status, tail.headers["content-range"], (await collect(tail.body!)).length], [206, `bytes ${4 * GiB - 16}-${4 * GiB - 1}/${4 * GiB}`, 16]);
  assert.deepEqual([(await port.serveExternalFile({ url, range: `bytes=${5 * GiB}-` })).status, (await port.serveExternalFile({ url, range: "frames=1-2" })).status], [416, 416]);
});

test("External file references on desktop — Scenario: Copied project directory cannot point at an arbitrary file", async () => {
  const source = await withExternal();
  source.port.close();
  const folder = temporaryDirectory("library"), cache = temporaryDirectory("cache");
  (await openDesktopStorage({ library: folder, cache })).close();
  // A project directory from elsewhere names /etc/hosts for an asset whose contentHash is that of a video.
  cpSync(join(source.folder, "p1"), join(folder, "p1"), { recursive: true });
  const record = JSON.parse(readFileSync(join(folder, "p1", "project.json"), "utf8"));
  const hosts = statSync("/etc/hosts");
  record.local.media.ext = { ...record.local.media.ext, externalPath: "/etc/hosts", externalSize: hosts.size, externalMtime_ms: Math.round(hosts.mtimeMs), externalGrantId: "ab".repeat(16) };
  writeFileSync(join(folder, "p1", "project.json"), JSON.stringify(record));
  const port = await openDesktopStorage({ library: folder, cache });
  assert.equal(port.indexRebuilt, true, "the copied directory is found by the scan");
  assert.deepEqual([await port.resolveGrant("ab".repeat(16)), await port.externalStatus("p1", "ext")], [undefined, "offline"], "no grant is created; the asset is offline with \"Relink…\"");
  assert.equal((await port.serveExternalFile({ url: `jagentchill-file://${"ab".repeat(16)}/hosts` })).status, 404);
  assert.deepEqual(await port.readMedia("p1", "a1"), bytes(4096, 1), "its managed media plays");
  port.close();
  // The same directory naming the real file — whose content hash IS the asset's — is granted, although this machine never selected it.
  record.local.media.ext = JSON.parse(readFileSync(join(source.folder, "p1", "project.json"), "utf8")).local.media.ext;
  writeFileSync(join(folder, "p1", "project.json"), JSON.stringify(record));
  utimesSync(join(folder, "p1", "project.json"), new Date(), new Date(Date.now() + 5000));
  const honest = await openDesktopStorage({ library: folder, cache });
  assert.equal(await honest.externalStatus("p1", "ext"), "online");
});
