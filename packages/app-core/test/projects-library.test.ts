import assert from "node:assert/strict";
import { test } from "node:test";
import { createHistory, setCanvasSize, type CommitContext } from "@jagentchill/editor-core";
import {
  canCreateFolderIn, countProjectsIn, createProjectLibrary, daysRemaining, folderMoveRefusal, kindsPresent, summarize, TRASH_EVALUATION_INTERVAL_MS, TRASH_RETENTION_MS, validateFolderName,
  type ProjectFolder, type ProjectLibrary,
} from "../src/index.ts";
import { idSource, memoryStorage, type MemoryStorage } from "./support/memory.ts";

const DAY = 86_400_000;
function setup(options: { phone?: boolean } = {}): { storage: MemoryStorage; library: ProjectLibrary; clock: { now: number }; newId: () => string } {
  const clock = { now: 1_800_000_000_000 };
  const storage = memoryStorage(() => clock.now), newId = idSource();
  const library = createProjectLibrary({ storage, newId, now: () => ++clock.now, phone: options.phone });
  return { storage, library, clock, newId };
}
const names = (library: ProjectLibrary, trashed = false) => library.getState().projects.filter((project) => (project.trash !== null) === trashed).map((project) => project.name).sort();
const bytes = (text: string) => new TextEncoder().encode(text);

test("Project thumbnail summary — first media asset id is available to load the host-produced thumbnail", () => {
  const summary = summarize("project-1", { metadata: { name: "Video", duration: 0, created_ms: 1, updated_ms: 2 }, media: { assets: [{ id: "asset-video-1" }] } });
  assert.equal(summary.assets, 1);
  assert.equal(summary.thumbnailAssetId, "asset-video-1");
  assert.equal(summarize("empty", { metadata: { name: "Empty", created_ms: 1 }, media: { assets: [] } }).thumbnailAssetId, null);
});

test("Projects list — Loading state: the index is loading until the stored projects are read, then lists them", async () => {
  const { storage, library, newId } = setup();
  await library.load();
  await library.create({ name: "Trip" });
  const second = createProjectLibrary({ storage, newId });
  assert.equal(second.getState().status, "loading");
  let notified = 0;
  second.subscribe(() => notified++);
  await second.load();
  assert.equal(second.getState().status, "ready");
  assert.deepEqual(names(second), ["Trip"]);
  assert.ok(notified > 0, "listeners are told when the list arrives");
  assert.equal(second.load(), second.load(), "loaded once per app session");
});

test("Projects list — Offline: all local projects are listed and can be opened with no network and no host", async () => {
  // The library is given nothing but the storage port: there is no connection to consult.
  const { library } = setup();
  await library.load();
  const id = await library.create({ name: "Local" });
  assert.deepEqual(names(library), ["Local"]);
  assert.equal((await library.open(id)).state, "ok");
});

test("Projects list — Size sort measures the UTF-8 bytes of the project record", async () => {
  const { storage, library } = setup();
  await library.load();
  const id = await library.create({ name: "日本語 Việt" });
  const text = await storage.readProjectText(id);
  assert.ok(text.length < new TextEncoder().encode(text).byteLength, "multibyte text distinguishes bytes from UTF-16 code units");
  assert.equal(await library.storageBytes(id), new TextEncoder().encode(text).byteLength);
});

test("Projects list — Unreadable record: a record with no metadata is listed as unreadable and cannot be opened", async () => {
  const { storage, library, newId } = setup();
  await storage.writeProjectText(newId(), JSON.stringify({ scenes: [] }));
  await library.load();
  const [entry] = library.getState().projects;
  assert.equal(entry.unreadable, true);
  assert.equal((await library.open(entry.id)).state, "error", "the editor does not open it");
});

test("Projects list — Template draft badge: a locked template project is a draft until \"Edit in full editor\" unlocks it", async () => {
  const { storage, library } = setup();
  await library.load();
  const id = await library.create({ name: "From template" });
  const record = await storage.readProject(id);
  await storage.writeProjectText(id, JSON.stringify({ ...record, template: { templateId: "00000000-0000-4000-8000-0000000000aa", locked: true } }));
  assert.equal((await library.refresh(id))?.templateDraft, true);
  await storage.writeProjectText(id, JSON.stringify({ ...record, template: { templateId: "00000000-0000-4000-8000-0000000000aa", locked: false } }));
  assert.equal((await library.refresh(id))?.templateDraft, false);
});

test("Create project — Factory defaults on desktop: \"New project\", 1920 × 1080, 30 fps, black background, empty main track", async () => {
  const { library } = setup();
  await library.load();
  const opened = await library.open(await library.create());
  assert.equal(opened.state, "ok");
  if (opened.state !== "ok") return;
  const { document } = opened.loaded;
  assert.equal(document.metadata.name, "New project");
  assert.deepEqual(document.settings.canvasSize, { width: 1920, height: 1080 });
  assert.deepEqual(document.settings.fps, { numerator: 30, denominator: 1 });
  assert.deepEqual(document.settings.background, { kind: "color", color: "#000000" });
  assert.deepEqual([document.settings.canvasSizeMode, document.settings.lastCustomCanvasSize, document.settings.originalCanvasSize], ["preset", null, null]);
  assert.deepEqual([document.settings.adoptCanvasFromFirstMedia, document.settings.adoptFrameRateFromFirstMedia], [true, true], "adoption is armed");
  assert.equal(document.scenes.length, 1);
  assert.deepEqual([document.scenes[0].name, document.scenes[0].isMain, document.scenes[0].tracks.main.elements.length], ["Main scene", true, 0]);
});

test("Create project — Blank project on a phone: an empty project with a 1080 × 1920 canvas at 30 fps", async () => {
  const { library } = setup({ phone: true });
  await library.load();
  const summary = library.find(await library.create())!;
  assert.deepEqual(summary.canvasSize, { width: 1080, height: 1920 });
  assert.deepEqual(summary.fps, { numerator: 30, denominator: 1 });
});

test("Create project — Fixed preference disarms adoption: a 1:1 canvas preference is applied and is not armed", async () => {
  const { library } = setup();
  await library.load();
  const opened = await library.open(await library.create({ preferences: { canvas: { width: 1080, height: 1080 }, frameRate: "match" } }));
  assert.equal(opened.state, "ok");
  if (opened.state !== "ok") return;
  assert.deepEqual(opened.loaded.document.settings.canvasSize, { width: 1080, height: 1080 });
  assert.equal(opened.loaded.document.settings.adoptCanvasFromFirstMedia, false, "the first clip cannot replace an explicit canvas");
  assert.equal(opened.loaded.document.settings.adoptFrameRateFromFirstMedia, true, "the frame rate is still armed");
});

test("Create project — Save failure: when storage rejects the initial save the project list is unchanged and no partial record remains", async () => {
  const { storage, library } = setup();
  await library.load();
  await library.create({ name: "Kept" });
  storage.failWrites("Unavailable", (store) => store === "projects");
  await assert.rejects(library.create());
  storage.failWrites(null);
  assert.deepEqual(names(library), ["Kept"]);
  assert.equal((await storage.listProjects()).length, 1);
});

test("Project not found and load errors — Unknown id: the not-found state and the number of stored projects is unchanged", async () => {
  const { storage, library } = setup();
  await library.load();
  await library.create();
  assert.deepEqual(await library.open("00000000-0000-4000-8000-00000000dead"), { state: "not-found" });
  assert.equal((await storage.listProjects()).length, 1, "the app never creates a project silently");
});

test("Project not found and load errors — Create from the not-found screen: \"Untitled Project\" is created with the new-project defaults", async () => {
  const { library } = setup();
  await library.load();
  const summary = library.find(await library.create({ name: "Untitled Project" }))!;
  assert.equal(summary.name, "Untitled Project");
  assert.deepEqual(summary.canvasSize, { width: 1920, height: 1080 });
});

test("Project not found and load errors — Load failure with retry: a failed read loads normally once the cause is resolved", async () => {
  const { storage, library } = setup();
  await library.load();
  const id = await library.create({ name: "Trip" });
  const good = await storage.readProjectText(id);
  await storage.writeProjectText(id, "{ this is not json");
  const failed = await library.open(id);
  assert.equal(failed.state, "error");
  assert.equal(failed.state === "error" && failed.hasSnapshot, false);
  await storage.writeProjectText(id, good);
  assert.equal((await library.open(id)).state, "ok", "Retry");
  // With a version snapshot the error screen offers "Restore latest snapshot".
  await storage.putSnapshot(id, { id: "s1", kind: "manual", created_ms: 5, label: "v1", duration: 0, schemaVersion: 32, record: good });
  await storage.writeProjectText(id, "{ broken again");
  const again = await library.open(id);
  assert.equal(again.state === "error" && again.hasSnapshot, true);
  assert.equal(await library.restoreLatestSnapshot(id), true);
  assert.equal((await library.open(id)).state, "ok");
});

test("Rename project — the name is trimmed, the modified time moves and duplicate names are allowed", async () => {
  const { library } = setup();
  await library.load();
  const a = await library.create({ name: "A" }), b = await library.create({ name: "B" });
  const before = library.find(a)!.updated_ms;
  assert.equal(await library.rename(a, "  Launch video  "), true);
  assert.equal(library.find(a)!.name, "Launch video");
  assert.ok(library.find(a)!.updated_ms > before);
  assert.equal(await library.rename(b, "Launch video"), true, "duplicate names are allowed");
  assert.equal(await library.rename(b, "   "), false, "an empty result keeps the previous name");
  assert.equal(library.find(b)!.name, "Launch video");
});

test("Bulk actions — Bulk duplicate: three selected projects give three copies named by the duplicate rule", async () => {
  const { library } = setup();
  await library.load();
  const ids = [await library.create({ name: "Trip" }), await library.create({ name: "Promo" }), await library.create({ name: "(1) Trip" })];
  const steps: string[] = [];
  const result = await library.duplicate(ids, (index, total) => steps.push(`Processing ${index} of ${total}`));
  assert.equal(result.created.length, 3);
  assert.deepEqual(steps, ["Processing 1 of 3", "Processing 2 of 3", "Processing 3 of 3"]);
  assert.deepEqual(names(library), ["(1) Promo", "(1) Trip", "(2) Trip", "(3) Trip", "Promo", "Trip"], "N increments within the batch");
  const copy = library.find(result.created[0])!, source = library.find(ids[0])!;
  assert.notEqual(copy.id, source.id);
  assert.ok(copy.created_ms > source.created_ms, "new created and modified timestamps");
  assert.equal(copy.folderId, source.folderId);
});

test("Bulk actions — Partial failure: one of three duplicates fails for lack of storage and is named with the quota message", async () => {
  const { storage, library } = setup();
  await library.load();
  const ids = [await library.create({ name: "One" }), await library.create({ name: "Two" }), await library.create({ name: "Three" })];
  let writes = 0;
  // The second copy's record write is refused as a full store would refuse it.
  storage.failWrites("QuotaExceeded", (store) => store === "projects" && ++writes === 2);
  const result = await library.duplicate(ids);
  storage.failWrites(null);
  assert.equal(result.created.length, 2);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].name, "Two");
  assert.match(result.failed[0].message, /^Not enough storage for Two \(.+\)\. .+ available\.$/);
  assert.equal((await storage.listProjects()).length, 5, "no partial copy remains");
});

test("Duplicate project — Media independence: removing an asset from the duplicate leaves the original's asset readable", async () => {
  const { storage, library } = setup();
  await library.load();
  const id = await library.create({ name: "Trip" });
  const stored = await storage.writeMedia(id, "asset-1", bytes("clip bytes"), { extension: "mp4" });
  const { created: [copy] } = await library.duplicate([id]);
  assert.equal(await storage.mediaReferences(stored.contentHash), 2, "the same content-addressed bytes, by reference");
  assert.equal([...storage.files.keys()].filter((path) => path.includes("/media/")).length, 1, "no bytes are copied");
  await storage.removeMedia(copy, "asset-1");
  assert.deepEqual(await storage.readMedia(id, "asset-1"), bytes("clip bytes"));
  const missing = await library.duplicate(["00000000-0000-4000-8000-00000000dead"]);
  assert.equal(missing.failed[0].message, "Project(s) not found");
});

test("Project info — Info content: 4 media assets totalling 350 MiB are counted and summed", async () => {
  const { storage, library } = setup();
  await library.load();
  const id = await library.create({ name: "Trip" });
  const sizes = [100, 100, 100, 50].map((mib) => mib * 1024 * 1024);
  // The media index is what Info sums; the bytes themselves are not needed for the sum.
  for (const [index, size] of sizes.entries()) await storage.raw.put("index:media", `${id}/a${index}`, { contentHash: `h${index}`, size, extension: "mp4" });
  const record = await storage.readProject(id);
  await storage.writeProjectText(id, JSON.stringify({ ...record, media: { ...(record.media as object), assets: sizes.map((_size, index) => ({ id: `a${index}` })) } }));
  await library.refresh(id);
  const info = (await library.info(id))!;
  assert.equal(info.mediaAssets, 4);
  assert.equal(info.storageBytes, 350 * 1024 * 1024);
  assert.equal(info.location, null, "\"App storage\" outside the desktop app");
});

test("Delete project with enforced confirmation — Move to trash: \"Trip\" leaves the Projects list and appears in the Trash view", async () => {
  const { storage, library } = setup();
  await library.load();
  const id = await library.create({ name: "Trip" });
  const canonical = (await storage.readProjectText(id)).split(',"local":')[0];
  await library.moveToTrash([id]);
  assert.deepEqual(names(library), []);
  assert.deepEqual(names(library, true), ["Trip"]);
  assert.deepEqual((await library.trashEntries()).map((entry) => [entry.kind, entry.name]), [["project", "Trip"]]);
  assert.equal((await storage.readProjectText(id)).split(',"local":')[0], canonical, "trashing changes no canonical document");
});

test("Delete project with enforced confirmation — Media removed: the record and 3 unshared media files are gone and usage decreases", async () => {
  const { storage, library } = setup();
  await library.load();
  const id = await library.create({ name: "Trip" }), other = await library.create({ name: "Other" });
  for (const name of ["a", "b", "c"]) await storage.writeMedia(id, name, bytes(`bytes of ${name}`), { extension: "mp4" });
  await storage.writeMedia(other, "kept", bytes("kept bytes"), { extension: "mp4" });
  const before = await library.storageBytes(id);
  assert.ok(before > 0);
  await library.deletePermanently([id]);
  assert.equal(await storage.hasProject(id), false);
  assert.deepEqual([...storage.files.keys()], [`projects/${other}/media/kept.mp4`]);
  assert.equal(await library.storageBytes(id), 0);
  assert.deepEqual(names(library), ["Other"]);
});

test("Delete project with enforced confirmation — a failure names the project and leaves it intact", async () => {
  const { storage, library } = setup();
  await library.load();
  const id = await library.create({ name: "Trip" });
  storage.failWrites("Unavailable", (store) => store === "projects");
  const result = await library.moveToTrash([id]);
  storage.failWrites(null);
  assert.deepEqual(result.failed.map((entry) => entry.name), ["Trip"]);
  assert.deepEqual(names(library), ["Trip"]);
});

test("Trash — Restore: \"Trip\" is listed in its original folder with all media intact", async () => {
  const { storage, library } = setup();
  await library.load();
  const folder = await library.createFolder("Clients", null);
  assert.equal(folder.ok, true);
  if (!folder.ok) return;
  const id = await library.create({ name: "Trip", folderId: folder.id });
  await storage.writeMedia(id, "a", bytes("media"), { extension: "mp4" });
  await storage.putSnapshot(id, { id: "s1", kind: "manual", created_ms: 1, label: "v1", duration: 0, schemaVersion: 32, record: "{}" });
  await library.moveToTrash([id]);
  await library.restore([id]);
  assert.equal(library.find(id)!.trash, null);
  assert.equal(library.find(id)!.folderId, folder.id);
  assert.deepEqual(await storage.readMedia(id, "a"), bytes("media"));
  assert.equal((await storage.listSnapshots(id)).length, 1, "snapshots are intact");
});

test("Trash — Expiry at start: a project trashed 31 days earlier and its media are removed without a prompt", async () => {
  const { storage, library, clock, newId } = setup();
  await library.load();
  const id = await library.create({ name: "Old" }), fresh = await library.create({ name: "Recent" });
  await storage.writeMedia(id, "a", bytes("media"), { extension: "mp4" });
  await library.moveToTrash([id]);
  clock.now += 28 * DAY;
  await library.moveToTrash([fresh]);
  clock.now += 3 * DAY;
  // A new app session: the index is read again, then expiry runs.
  const restarted = createProjectLibrary({ storage, newId, now: () => clock.now });
  await restarted.load();
  assert.deepEqual(await restarted.expireTrash(), [id]);
  assert.equal(await storage.hasProject(id), false);
  assert.equal(storage.files.size, 0);
  assert.deepEqual(names(restarted, true), ["Recent"]);
});

test("Trash — Expiry while running: the 6-hour evaluation removes a project that passed 30 days, without a restart", async () => {
  const { library, clock } = setup();
  await library.load();
  const id = await library.create({ name: "Trip" });
  await library.moveToTrash([id]);
  clock.now += TRASH_RETENTION_MS - TRASH_EVALUATION_INTERVAL_MS / 2;
  assert.deepEqual(await library.expireTrash(), [], "not yet 30 days at this evaluation");
  assert.equal(daysRemaining(library.find(id)!.trash!.deleted_ms, clock.now), 1);
  clock.now += TRASH_EVALUATION_INTERVAL_MS;
  assert.deepEqual(await library.expireTrash(), [id]);
  assert.equal(library.find(id), undefined);
});

test("Trash — Typed entries: a trashed template and a trashed script are listed with their kinds", async () => {
  const { storage, library, clock } = setup();
  await library.load();
  const id = await library.create({ name: "Promo template" });
  const record = await storage.readProject(id);
  await storage.writeProjectText(id, JSON.stringify({ ...record, template: { templateId: "00000000-0000-4000-8000-0000000000aa", locked: true } }));
  await library.refresh(id);
  await library.moveToTrash([id]);
  await storage.putDocument("script", "script-1", { title: "Coffee routine", trash: { kind: "script", deleted_ms: clock.now } });
  await storage.putDocument("script", "script-2", { title: "Not trashed" });
  const entries = await library.trashEntries();
  assert.deepEqual(entries.map((entry) => [entry.kind, entry.name]).sort(), [["script", "Coffee routine"], ["template", "Promo template"]]);
  assert.deepEqual(kindsPresent(entries), ["template", "script"], "the filter offers \"Templates\" and \"Scripts\"");
});

test("Trash — Host kinds offline: with no host connected no film or workflow-run entry is listed", async () => {
  const { library } = setup();
  await library.load();
  await library.moveToTrash([await library.create({ name: "Trip" })]);
  const kinds = (await library.trashEntries()).map((entry) => entry.kind);
  assert.ok(!kinds.includes("film") && !kinds.includes("workflow-run"), "host-side kinds come only from a connected host");
});

test("Trash — Empty trash state: an empty trash lists nothing, and \"Empty trash\" removes everything in it", async () => {
  const { library } = setup();
  await library.load();
  assert.deepEqual(await library.trashEntries(), []);
  await library.moveToTrash([await library.create({ name: "A" }), await library.create({ name: "B" })]);
  assert.ok((await library.trashBytes()) > 0, "trashed items still count toward storage usage");
  await library.emptyTrash();
  assert.deepEqual(await library.trashEntries(), []);
  assert.equal(await library.trashBytes(), 0);
});

test("Project folders — Move by drag: two projects dropped on \"Clients\" are listed inside it and no longer in the root", async () => {
  const { library } = setup();
  await library.load();
  const folder = await library.createFolder("Clients", null);
  if (!folder.ok) return assert.fail("folder");
  const ids = [await library.create({ name: "A" }), await library.create({ name: "B" })];
  await library.moveProjects(ids, folder.id);
  assert.deepEqual(ids.map((id) => library.find(id)!.folderId), [folder.id, folder.id]);
  assert.equal(countProjectsIn(library.getState().folders, library.getState().projects, folder.id), 2);
  assert.deepEqual(await library.createFolder(" clients ", null), { ok: false, reason: "duplicate" }, "A folder with this name already exists");
  assert.deepEqual(await library.createFolder("   ", null), { ok: false, reason: "empty" });
});

test("Project folders — Depth limit: \"New folder\" is refused inside a level-4 folder", async () => {
  const { library } = setup();
  await library.load();
  let parent: string | null = null;
  for (const name of ["L1", "L2", "L3", "L4"]) { const made = await library.createFolder(name, parent); if (!made.ok) return assert.fail(name); parent = made.id; }
  assert.equal(canCreateFolderIn(library.getState().folders, parent), false);
  assert.deepEqual(await library.createFolder("L5", parent), { ok: false, reason: "depth" });
});

test("Project folders — Delete folder: the folder is gone and its 3 projects are in the trash", async () => {
  const { library } = setup();
  await library.load();
  const folder = await library.createFolder("Clients", null);
  if (!folder.ok) return assert.fail("folder");
  const sub = await library.createFolder("2026", folder.id);
  if (!sub.ok) return assert.fail("sub");
  await library.create({ name: "A", folderId: folder.id });
  await library.create({ name: "B", folderId: folder.id });
  await library.create({ name: "C", folderId: sub.id });
  await library.create({ name: "Outside" });
  await library.deleteFolder(folder.id);
  assert.deepEqual(library.getState().folders, []);
  assert.deepEqual(names(library, true), ["A", "B", "C"]);
  assert.deepEqual(names(library), ["Outside"]);
});

test("Project folders — Restore after folder deletion: a project restored after its folder was deleted is listed in the root", async () => {
  const { library } = setup();
  await library.load();
  const folder = await library.createFolder("Clients", null);
  if (!folder.ok) return assert.fail("folder");
  const id = await library.create({ name: "A", folderId: folder.id });
  await library.deleteFolder(folder.id);
  assert.equal(library.find(id)!.trash!.originalFolderId, folder.id, "a trashed project remembers its folder id");
  await library.restore([id]);
  assert.equal(library.find(id)!.folderId, null);
});

test("Project folders — Move into a descendant: folder \"A\" dropped on \"A/B\" is refused and the tree is unchanged", async () => {
  const { library } = setup();
  await library.load();
  const a = await library.createFolder("A", null);
  if (!a.ok) return assert.fail("a");
  const b = await library.createFolder("B", a.id);
  if (!b.ok) return assert.fail("b");
  const before = structuredClone(library.getState().folders);
  assert.equal(await library.moveFolder(a.id, b.id), "descendant");
  assert.equal(await library.moveFolder(a.id, a.id), "self");
  assert.deepEqual(library.getState().folders, before);
  const folders: ProjectFolder[] = library.getState().folders;
  assert.equal(folderMoveRefusal(folders, b.id, null), null);
  assert.deepEqual(validateFolderName(folders, a.id, "b"), { ok: false, reason: "duplicate" });
  assert.equal((await library.renameFolder(b.id, "Renamed")).ok, true);
});

test("Canvas size presets and custom size — Custom size remembered: Custom 1000 × 500, then 1:1, then Custom again is 1000 × 500", async () => {
  const { library, newId } = setup();
  await library.load();
  const opened = await library.open(await library.create());
  if (opened.state !== "ok") return assert.fail("open");
  const context: CommitContext = { now_ms: 1, newId };
  const history = createHistory();
  let document = opened.loaded.document;
  const apply = (size: { width: number; height: number }, mode: "preset" | "custom") => { document = history.record(document, setCanvasSize(document, context, size, mode)); };
  apply({ width: 1000, height: 500 }, "custom");
  apply({ width: 1080, height: 1080 }, "preset");
  assert.deepEqual(document.settings.lastCustomCanvasSize, { width: 1000, height: 500 });
  apply(document.settings.lastCustomCanvasSize!, "custom");
  assert.deepEqual(document.settings.canvasSize, { width: 1000, height: 500 });
  assert.equal(document.settings.adoptCanvasFromFirstMedia, false, "an explicit choice disarms adoption of the canvas only");
  assert.equal(document.settings.adoptFrameRateFromFirstMedia, true);
  assert.equal(history.length, 3, "every settings change is an undoable command");
});

test("w7 shell item 2 — pin: written into the project's document (so it syncs), survives a reload, does not move Modified, a copy starts unpinned", async () => {
  const { storage, library, newId } = setup();
  await library.load();
  const trip = await library.create({ name: "Trip" }), promo = await library.create({ name: "Promo" });
  const modified = library.find(trip)!.updated_ms;
  const result = await library.setPinned([trip], true);
  assert.deepEqual(result.done, [trip]);
  assert.equal(typeof library.find(trip)!.pinned_ms, "number");
  assert.equal(library.find(promo)!.pinned_ms, null);
  assert.equal(library.find(trip)!.updated_ms, modified, "pinning is not an edit of the film");
  // In the canonical document — the part that is synced — not in the device-local section.
  const record = await storage.readProject(trip) as { metadata: Record<string, unknown>; local?: Record<string, unknown> };
  assert.equal(typeof record.metadata.pinned_ms, "number");
  assert.equal(record.local?.pinned_ms, undefined);
  // Another session of the app (or another device that received the document) reads the pin from the record.
  const second = createProjectLibrary({ storage, newId });
  await second.load();
  assert.equal(typeof second.find(trip)!.pinned_ms, "number");
  // The document still opens (the field is part of the schema).
  assert.equal((await library.open(trip)).state, "ok");
  const copy = await library.duplicate([trip]);
  assert.equal(library.find(copy.created[0])!.pinned_ms, null);
  // Several at once, and unpin.
  await library.setPinned([trip, promo], true);
  assert.ok(library.find(promo)!.pinned_ms !== null);
  await library.setPinned([trip, promo], false);
  assert.equal(library.find(trip)!.pinned_ms, null);
  assert.equal("pinned_ms" in ((await storage.readProject(trip)) as { metadata: object }).metadata, false, "unpinning removes the field");
});
