// The file system is a real temporary directory; hashing and copying are done on real bytes.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { after, test } from "node:test";
import { canonicalize } from "@jagentchill/editor-core";
import type { AssetRecord, LocalAsset, ProjectDocument } from "@jagentchill/protocol";
import {
  LOCATE_MAX_FILES, checkExternalAssets, copyIntoLibrary, exportDelivery, exportOriginals, externalFileStatus, isOffline, localAssetOf, locateInFolder, managedLocal, message, offersCopyIntoLibrary, offlineBanner,
  planCopyIntoLibrary, planExportOriginals, relinkAssetCommand, replaceLocalAsset, relinkDecision, relinkFileName, setLocalAsset, uniqueFileNames, type FoundFile,
} from "../src/index.ts";
import { GIB, HASH, MIB, SECOND, asset, place, project, session, videoClip } from "./support/project.ts";

const root = mkdtempSync(join(tmpdir(), "jagentchill-media-relink-"));
after(() => rmSync(root, { recursive: true, force: true }));
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const write = (relative: string, content: string): string => { const path = join(root, relative); mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, content); return path; };
const files = {
  stat: async (path: string) => (existsSync(path) ? { size: statSync(path).size, mtime_ms: Math.round(statSync(path).mtimeMs) } : null),
  hash: async (path: string) => sha(path),
};
function* walk(directory: string): Generator<FoundFile> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield { path, name: entry.name, size: statSync(path).size };
  }
}
/** A project whose assets link to real files on disk. */
function linkedProject(entries: { id: string; path: string }[]): { doc: ProjectDocument; locals: Record<string, LocalAsset>; assets: AssetRecord[] } {
  let doc = project(entries.map((entry) => asset(entry.id, "video", { name: basename(entry.path), size: statSync(entry.path).size, contentHash: sha(entry.path) })));
  for (const entry of entries) doc = setLocalAsset(doc, entry.id, { storage: "external", externalPath: entry.path, externalGrantId: "grant-1", externalSize: statSync(entry.path).size, externalMtime_ms: Math.round(statSync(entry.path).mtimeMs), present: { original: true, proxy: false, mezzanine: false } });
  return { doc, assets: doc.media.assets, locals: Object.fromEntries(entries.map((entry) => [entry.id, localAssetOf(doc, entry.id)])) };
}

test("File moved: when the linked file is moved in the file manager and the app regains focus, the asset is offline", async () => {
  const path = write("moved/clip.mp4", "original footage");
  const { doc, assets, locals } = linkedProject([{ id: "a1", path }]);
  assert.deepEqual(await checkExternalAssets(assets, locals, files), [{ assetId: "a1", online: true }]);
  renameSync(path, join(root, "moved/clip-elsewhere.mp4"));
  const checks = await checkExternalAssets(assets, locals, files);
  assert.deepEqual(checks, [{ assetId: "a1", online: false }]);
  const after = setLocalAsset(doc, "a1", { ...locals.a1, present: { original: false, proxy: false, mezzanine: false } });
  assert.equal(isOffline(localAssetOf(after, "a1")), true);
  assert.deepEqual([message("media.offline").text, message("media.offline.badge").text], ["Media offline", "Offline"]);
});

test("a linked file is offline only when size and modified time both differ and the content hash differs too", async () => {
  const recorded = { size: 10, mtime_ms: 1000, contentHash: HASH("a") };
  let hashed = 0;
  const hash = (value: string) => async () => { hashed++; return value; };
  assert.deepEqual(await externalFileStatus(recorded, null, hash(HASH("a"))), { online: false });
  // Touched (new time, same size) or same time: online without hashing.
  assert.deepEqual(await externalFileStatus(recorded, { size: 10, mtime_ms: 2000 }, hash(HASH("b"))), { online: true });
  assert.deepEqual(await externalFileStatus(recorded, { size: 11, mtime_ms: 1000 }, hash(HASH("b"))), { online: true });
  assert.equal(hashed, 0);
  // Both differ: the hash decides, and an unchanged content refreshes the recorded facts.
  assert.deepEqual(await externalFileStatus(recorded, { size: 11, mtime_ms: 2000 }, hash(HASH("a"))), { online: true, refreshed: { size: 11, mtime_ms: 2000 } });
  assert.deepEqual(await externalFileStatus(recorded, { size: 11, mtime_ms: 2000 }, hash(HASH("b"))), { online: false });
  // Real files: rewritten with different content and a different time.
  const path = write("changed/clip.mp4", "version one");
  const { assets, locals } = linkedProject([{ id: "a1", path }]);
  writeFileSync(path, "a longer second version");
  utimesSync(path, new Date(2_000_000_000_000), new Date(2_000_000_000_000));
  assert.deepEqual(await checkExternalAssets(assets, locals, files), [{ assetId: "a1", online: false }]);
});

test("Exact relink: picking the moved original file relinks silently — the hash matches, no comparison dialog", () => {
  const offline = asset("a1", "video", { contentHash: HASH("a") });
  assert.deepEqual(relinkDecision(offline, { contentHash: HASH("a"), duration: 10 * SECOND }), { kind: "exact" });
  const s = session(place(project([offline]), "main", [videoClip("e1", "a1", 0, 4, { sourceDuration: 10 * SECOND, trimEnd: 6 * SECOND })]));
  const clips = canonicalize(s.document.scenes);
  s.commit(relinkAssetCommand(s.document, s.context(), "a1", { contentHash: HASH("a"), size: 1000, duration: 10 * SECOND }));
  assert.equal(canonicalize(s.document.scenes), clips, "clips are untouched");
});

test("Different file: a file with another hash and a shorter duration needs confirmation, then clips exceeding the new duration are shortened to it", () => {
  const original = asset("a1", "video", { contentHash: HASH("a"), duration: 10 * SECOND });
  const decision = relinkDecision(original, { contentHash: HASH("b"), duration: 6 * SECOND, width: 1280, height: 720, fps: { numerator: 25, denominator: 1 } });
  assert.deepEqual(decision, {
    kind: "different", shorter: true,
    comparison: { duration: { from: 10 * SECOND, to: 6 * SECOND }, resolution: { from: [1920, 1080], to: [1280, 720] }, fps: { from: { numerator: 30, denominator: 1 }, to: { numerator: 25, denominator: 1 } } },
  });
  const s = session(place(project([original]), "main", [
    videoClip("whole", "a1", 0, 10, { sourceDuration: 10 * SECOND }),
    videoClip("short", "a1", 10, 3, { sourceDuration: 10 * SECOND, trimStart: 1 * SECOND, trimEnd: 6 * SECOND }),
    videoClip("tail", "a1", 13, 4, { sourceDuration: 10 * SECOND, trimStart: 4 * SECOND, trimEnd: 2 * SECOND }),
  ]));
  s.commit(relinkAssetCommand(s.document, s.context(), "a1", { contentHash: HASH("b"), size: 500, duration: 6 * SECOND, width: 1280, height: 720, fps: { numerator: 25, denominator: 1 } }));
  const clip = (id: string) => s.document.scenes[0].tracks.main.elements.find((element) => element.id === id) as unknown as { startTime: number; duration: number; trimStart: number; trimEnd: number; sourceDuration: number };
  // The 10 s clip is trimmed to the 6 s the new file has; clips keep their start times.
  assert.deepEqual([clip("whole").startTime, clip("whole").duration, clip("whole").trimStart, clip("whole").trimEnd, clip("whole").sourceDuration], [0, 6 * SECOND, 0, 0, 6 * SECOND]);
  // A clip that fits keeps its timing: 3 s from 1 s.
  assert.deepEqual([clip("short").startTime, clip("short").duration, clip("short").trimStart, clip("short").trimEnd], [10 * SECOND, 3 * SECOND, 1 * SECOND, 2 * SECOND]);
  // A clip showing 4 s from 4 s gets the 2 s that are left.
  assert.deepEqual([clip("tail").startTime, clip("tail").duration, clip("tail").trimStart, clip("tail").trimEnd], [13 * SECOND, 2 * SECOND, 4 * SECOND, 0]);
  const relinked = s.document.media.assets[0];
  assert.deepEqual([relinked.contentHash, relinked.duration, relinked.width, relinked.fps], [HASH("b"), 6 * SECOND, 1280, { numerator: 25, denominator: 1 }]);
  // Relink is undoable.
  s.undo();
  assert.deepEqual([clip("whole").duration, s.document.media.assets[0].contentHash], [10 * SECOND, HASH("a")]);
});

test("Batch locate: with 12 assets offline and a folder containing 10 of the files, 10 are relinked and the banner reports 2 still offline", async () => {
  const originals = Array.from({ length: 12 }, (_, index) => ({ id: `a${String(index + 1).padStart(2, "0")}`, path: write(`shoot/clip-${index + 1}.mp4`, `footage number ${index + 1} ${"x".repeat(index)}`) }));
  const { assets, locals } = linkedProject(originals);
  // The drive is reorganised: ten files end up in nested folders, two are gone.
  for (const [index, entry] of originals.entries()) {
    if (index < 10) { const target = join(root, "archive", index % 2 ? "b/deep" : "a", basename(entry.path)); mkdirSync(join(target, ".."), { recursive: true }); renameSync(entry.path, target); }
    else rmSync(entry.path);
  }
  // A decoy with the right name and size but other content must not be relinked.
  write("archive/decoy/clip-11.mp4", "f".repeat(statSyncSize(assets[10])));
  const result = await locateInFolder({ offline: assets, locals, walk: walk(join(root, "archive")), hash: files.hash });
  assert.equal(result.matches.length, 10);
  assert.deepEqual(result.stillOffline, ["a11", "a12"]);
  for (const match of result.matches) assert.equal(sha(match.file.path), assets.find((entry) => entry.id === match.assetId)!.contentHash);
  assert.equal(offlineBanner(result.stillOffline.length)!.text, "2 media files are offline");
  assert.equal(offlineBanner(1)!.text, "1 media file is offline");
  assert.equal(offlineBanner(0), null);
  assert.equal(LOCATE_MAX_FILES, 50_000);
  assert.equal(relinkFileName(assets[0], locals.a01), "clip-1.mp4");
  assert.deepEqual([message("media.relink").text, message("media.locate-folder").text], ["Relink…", "Locate folder…"]);
});
const statSyncSize = (entry: AssetRecord): number => entry.size;

/** Copies with real file I/O into a library folder and reports the SHA-256 of what was written. */
function library(directory: string, onCopy?: (assetId: string) => void) {
  mkdirSync(directory, { recursive: true });
  return {
    exists: async (path: string) => existsSync(path),
    copy: async (assetId: string, path: string, onBytes: (bytes: number) => void) => { onCopy?.(assetId); const target = join(directory, assetId); copyFileSync(path, target); onBytes(statSync(target).size); return sha(target); },
    removeCopy: async (assetId: string) => rmSync(join(directory, assetId), { force: true }),
  };
}
const twelve = (folder: string) => Array.from({ length: 12 }, (_, index) => ({ id: `a${String(index + 1).padStart(2, "0")}`, path: write(`${folder}/take-${index + 1}.mov`, `take ${index + 1} `.repeat(50 + index)) }));

test("Copy media into library: 12 linked files are copied with progress, each copy matches its source SHA-256 and every asset becomes managed", async () => {
  const { doc, assets, locals } = linkedProject(twelve("drive-a"));
  assert.equal(offersCopyIntoLibrary("desktop", assets, locals), true);
  assert.equal(offersCopyIntoLibrary("web", assets, locals), false);
  const total = assets.reduce((sum, entry) => sum + entry.size, 0), plan = planCopyIntoLibrary(assets, locals, 20 * GIB);
  assert.deepEqual([plan.files, plan.totalBytes, plan.requiredBytes, plan.ok, plan.refusal], [12, total, total + 50 * MIB, true, null]);
  assert.match(plan.summary.text, /^Copy 12 files \(/);
  let current = doc;
  const progress: number[] = [], clips = canonicalize(doc.scenes), target = join(root, "library-a");
  const result = await copyIntoLibrary({ assets, locals, files: library(target), switchToManaged: (id) => { current = replaceLocalAsset(current, id, managedLocal(localAssetOf(current, id))); }, onProgress: (state) => progress.push(state.fraction) });
  assert.deepEqual([result.converted.length, result.offline.length, result.failed.length, result.cancelled], [12, 0, 0, false]);
  for (const entry of assets) {
    assert.equal(sha(join(target, entry.id)), entry.contentHash);
    const local = localAssetOf(current, entry.id);
    assert.deepEqual([local.storage, local.externalPath, local.present.original], ["managed", undefined, true]);
  }
  assert.equal(progress.at(-1), 1);
  assert.ok(progress.every((value, index) => index === 0 || value >= progress[index - 1]), "progress is determinate and never goes back");
  // The project plays with the original drive disconnected: nothing points at it any more, and clips are unchanged.
  rmSync(join(root, "drive-a"), { recursive: true });
  assert.ok(assets.every((entry) => existsSync(join(target, entry.id))));
  assert.equal(canonicalize(current.scenes), clips);
});

test("Not enough space: with less free space than the total plus 50 MiB nothing is copied and the message names the required and the available space", () => {
  let doc = project(Array.from({ length: 12 }, (_, index) => asset(`a${index + 10}`, "video", { size: Math.round((8 * GIB) / 12) })));
  for (const entry of doc.media.assets) doc = setLocalAsset(doc, entry.id, { storage: "external", externalPath: `/Volumes/X/${entry.name}`, externalSize: entry.size });
  const locals = Object.fromEntries(doc.media.assets.map((entry) => [entry.id, localAssetOf(doc, entry.id)]));
  const plan = planCopyIntoLibrary(doc.media.assets, locals, 6 * GIB);
  assert.equal(plan.ok, false);
  assert.equal(plan.refusal!.text, "Not enough space to copy media into the library. 8.0 GiB required, 6.0 GiB available.");
  assert.equal(planCopyIntoLibrary(doc.media.assets, locals, 20 * GIB).ok, true);
});

test("One file is offline: 11 assets become managed and the result lists the missing file with \"Relink…\"", async () => {
  const entries = twelve("drive-b"), { doc, assets, locals } = linkedProject(entries);
  rmSync(entries[4].path);
  let current = doc;
  const result = await copyIntoLibrary({ assets, locals, files: library(join(root, "library-b")), switchToManaged: (id) => { current = replaceLocalAsset(current, id, managedLocal(localAssetOf(current, id))); } });
  assert.equal(result.converted.length, 11);
  assert.deepEqual(result.offline, [{ assetId: "a05", name: "take-5.mov" }]);
  assert.equal(localAssetOf(current, "a05").storage, "external");
  assert.equal(message("media.relink").text, "Relink…");
});

test("copying can be cancelled: converted assets stay managed and the rest stay linked; a copy that fails verification is removed", async () => {
  const { doc, assets, locals } = linkedProject(twelve("drive-c")), controller = new AbortController(), target = join(root, "library-c");
  let current = doc;
  const io = library(target, (assetId) => { if (assetId === "a04") controller.abort(); });
  const result = await copyIntoLibrary({ assets, locals, files: io, switchToManaged: (id) => { current = replaceLocalAsset(current, id, managedLocal(localAssetOf(current, id))); }, signal: controller.signal });
  assert.deepEqual([result.converted, result.cancelled], [["a01", "a02", "a03", "a04"], true]);
  assert.equal(localAssetOf(current, "a05").storage, "external");
  // A corrupted copy is not accepted.
  const corrupting = { ...library(join(root, "library-d")), copy: async (assetId: string) => { writeFileSync(join(root, "library-d", assetId), "damaged"); return sha(join(root, "library-d", assetId)); } };
  const bad = await copyIntoLibrary({ assets: assets.slice(0, 1), locals, files: corrupting, switchToManaged: () => assert.fail("must not switch") });
  assert.deepEqual([bad.converted.length, bad.failed.length, existsSync(join(root, "library-d", "a01"))], [0, 1, false]);
});

test("Convert to managed: \"Copy into project\" turns one external asset into a managed one and leaves its clips unchanged", () => {
  const local: LocalAsset = { storage: "external", externalPath: "/Volumes/X/a.mov", externalGrantId: "g1", externalSize: GIB, externalMtime_ms: 5, canDecode: true, needsProbe: false, proxy: { state: "none" }, present: { original: true, proxy: false, mezzanine: false } };
  assert.deepEqual(managedLocal(local), { storage: "managed", canDecode: true, needsProbe: false, proxy: { state: "none" }, present: { original: true, proxy: false, mezzanine: false } });
});

test("Export two assets on desktop: the chosen folder receives two files byte-identical to the imported originals", async () => {
  const sources = { a1: write("originals/Interview.mov", "interview bytes"), a2: write("originals/B-roll.mp4", "b-roll bytes") };
  let doc = project([asset("a1", "video", { name: "Interview A", container: "mov", provenance: { source: "imported", originalFileName: "Interview.mov" } }), asset("a2", "video", { name: "B-roll.mp4" })]);
  for (const id of ["a1", "a2"]) doc = setLocalAsset(doc, id, { present: { original: true, proxy: true, mezzanine: false }, proxy: { state: "succeeded" } });
  const locals = { a1: localAssetOf(doc, "a1"), a2: localAssetOf(doc, "a2") }, out = join(root, "exported");
  mkdirSync(out);
  const plan = planExportOriginals(doc.media.assets, locals);
  assert.deepEqual(plan.files, [{ assetId: "a1", fileName: "Interview.mov" }, { assetId: "a2", fileName: "B-roll.mp4" }]);
  const done = await exportOriginals(plan, { read: async (id) => new Uint8Array(readFileSync(sources[id as "a1" | "a2"])), write: async (name, bytes) => writeFileSync(join(out, name), bytes) });
  assert.deepEqual(done, { written: ["Interview.mov", "B-roll.mp4"], failed: [] });
  assert.deepEqual(readdirSync(out).sort(), ["B-roll.mp4", "Interview.mov"]);
  assert.equal(sha(join(out, "Interview.mov")), sha(sources.a1));
  assert.equal(sha(join(out, "B-roll.mp4")), sha(sources.a2));
  // Name collisions get " (n)"; each platform delivers its own way.
  assert.deepEqual(uniqueFileNames(["clip.mp4", "clip.mp4", "CLIP.mp4", "notes"], ["notes"]), ["clip.mp4", "clip (1).mp4", "CLIP (2).mp4", "notes (1)"]);
  assert.deepEqual([exportDelivery("desktop"), exportDelivery("web"), exportDelivery("mobile")], ["folder", "save-dialog", "share-sheet"]);
});

test("Offline asset: the other files are exported and a notice names the skipped asset", () => {
  let doc = project([asset("a1", "video", { name: "here.mp4" }), asset("a2", "video", { name: "missing.mp4" })]);
  doc = setLocalAsset(doc, "a1", { present: { original: true, proxy: false, mezzanine: false } });
  const plan = planExportOriginals(doc.media.assets, { a1: localAssetOf(doc, "a1"), a2: localAssetOf(doc, "a2") });
  assert.deepEqual(plan.files.map((entry) => entry.fileName), ["here.mp4"]);
  assert.deepEqual(plan.skipped, [{ assetId: "a2", name: "missing.mp4" }]);
  assert.equal(plan.notice!.text, "Skipped offline media: missing.mp4");
});
