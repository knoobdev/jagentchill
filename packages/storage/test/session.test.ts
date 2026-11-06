// Fakes declared: time is a fake clock (`support/clock.ts`) so that debounce, retry and heartbeat schedules are exact; the stores are those of `support/platforms.ts` (fake-indexeddb + in-memory OPFS for web, node:sqlite + node:fs for mobile, the real desktop store in a temp dir); a failing or full store is the real store with `writeProjectText` or `available` overridden; `navigator.storage` is a stub object, since no browser exists in a Node test process (the real one is exercised in `test/browser`).
import assert from "node:assert/strict";
import { test } from "node:test";
import { addAsset, applyPatch, canonicalize, commitChange, createHistory, insertElement, removeAssets, renameProject, setLocal, setProjectBackground, type CommitContext } from "@jagentchill/editor-core";
import { createProjectDocument, type ProjectDocument } from "@jagentchill/protocol";
import {
  completeMigratedAssets, crashPrompt, createMigrationDialog, createPersistenceRequest, createPreferences, createProjectAutosave, createScriptAutosave, createSnapshotManager, dismissCrashPrompt,
  isStorageError, loadProject, markProjectOpened, markSessionClean, openProjectLock, PREFERENCES, recordSaveState, removeOrphanMedia, reopenAfterCrash, restoreOffered, runMigrations, saveProject,
  scriptJournalKey, serializeProjectRecord, splitRecord, StorageError, STEP_V31_TO_V32, verifyJournal, type PreferencesPort, type SaveStatus, type StoragePort,
} from "../src/index.ts";
import { fakeClock } from "./support/clock.ts";
import { platforms } from "./support/platforms.ts";

const NOW = 1_800_000_000_000, MiB = 1024 * 1024, MINUTE = 60_000;
const idSource = (prefix = "id") => { let count = 0; return () => `${prefix}${++count}`; };
const project = (id = "p1", name = "Project"): ProjectDocument => createProjectDocument({ id, mainSceneId: `${id}-scene`, mainTrackId: `${id}-track`, now_ms: NOW, name });
const web = async () => (await platforms()[0].open()) as StoragePort;
const stored = async (port: StoragePort, id = "p1") => JSON.parse(await port.readProjectText(id));
/** An editing session: the document, its history, a commit context on the fake clock, and the save manager. */
async function session(options: { port?: StoragePort; synced?: boolean; document?: ProjectDocument; start?: number } = {}) {
  const port = options.port ?? await web(), clock = fakeClock(options.start ?? NOW + 1000), newId = idSource();
  const initial = options.document ?? project();
  await saveProject(port, initial);
  const statuses: SaveStatus[] = [];
  const autosave = createProjectAutosave({ port, document: initial, clock, synced: options.synced, onStatus: (status) => statuses.push(status), trashBytes: async () => trash.bytes });
  const trash = { bytes: 0 };
  clock.busy.push(() => autosave.status.state === "saving");
  const ctx = (): CommitContext => ({ now_ms: clock.now(), newId });
  const edit = (name: string) => autosave.commit(renameProject(autosave.document, ctx(), name)).document;
  return { port, clock, autosave, ctx, edit, statuses, trash, newId };
}
/** The real store, with project record writes failing as the callback says. */
function failing(base: StoragePort, fail: () => StorageError | null): StoragePort & { writes: number } {
  const port = Object.assign(Object.create(base) as StoragePort, {
    writes: 0,
    writeProjectText: async (id: string, text: string) => { port.writes++; const error = fail(); if (error) throw error; await base.writeProjectText(id, text); },
  });
  return port;
}

// Requirement: Autosave
test("Autosave — Scenario: Debounce", async () => {
  const { port, clock, edit, autosave } = await session({ start: 0 });
  const counting = { saves: [] as number[] };
  const write = port.writeProjectText.bind(port);
  port.writeProjectText = async (id, text) => { counting.saves.push(clock.now()); await write(id, text); };
  edit("One");
  await clock.advance(300); edit("Two");
  await clock.advance(300); edit("Three");
  await clock.advance(799);
  assert.deepEqual(counting.saves, [], "nothing is saved before 800 ms have passed since the last change");
  await clock.advance(1);
  assert.deepEqual(counting.saves, [1400], "exactly one save starts at t = 1400 ms");
  await clock.advance(5000);
  assert.deepEqual([counting.saves.length, (await stored(port)).metadata.name, autosave.status.state], [1, "Three", "saved"]);
});

test("Autosave — Scenario: Coalescing", async () => {
  const base = await web();
  let release: () => void = () => undefined, writes = 0, hold = false;
  const port = Object.assign(Object.create(base) as StoragePort, {
    writeProjectText: async (id: string, text: string) => { writes++; if (hold && writes === 1) await new Promise<void>((resolve) => { release = resolve; }); await base.writeProjectText(id, text); },
  });
  const { clock, edit, autosave } = await session({ port });
  writes = 0; hold = true;
  // The first save stays in flight until the test releases it.
  clock.busy.length = 0;
  edit("First");
  await clock.advance(800);
  assert.equal(autosave.status.state, "saving", "the save is in flight");
  for (const name of ["a", "b", "c", "d", "Fifth"]) edit(name);
  await clock.advance(5000);
  assert.equal(writes, 1, "no second save starts while the first is in flight");
  release();
  await clock.advance(0);
  assert.deepEqual([writes, (await stored(base)).metadata.name, autosave.status.state], [2, "Fifth", "saved"], "exactly one additional save runs, and the record holds all five edits");
  await clock.advance(10_000);
  assert.equal(writes, 2);
});

test("Autosave — Scenario: Settings-only change", async () => {
  const { port, clock, autosave, ctx } = await session();
  autosave.commit(setProjectBackground(autosave.document, ctx(), { kind: "color", color: "#336699" }));
  await clock.advance(800);
  assert.deepEqual((await loadProject(port, "p1")).document.settings.background, { kind: "color", color: "#336699" }, "the colour is present after reload");
});

test("Autosave — Scenario: Scroll does not touch modified time", async () => {
  const { port, clock, autosave } = await session();
  const before = (await stored(port)).metadata.updated_ms;
  autosave.changeLocal(setLocal(autosave.document, (local) => { local.timelineViewState = { zoomLevel: 2, scrollLeft: 640, playheadTime: 0, scenePlayheads: {}, expandedKeyframeElementIds: [] }; }));
  await clock.advance(299);
  assert.equal((await stored(port)).local?.timelineViewState?.scrollLeft ?? 0, 0, "view state has its own 300 ms debounce");
  await clock.advance(1);
  const record = await stored(port);
  assert.deepEqual([record.local.timelineViewState.scrollLeft, record.metadata.updated_ms], [640, before], "the scroll is stored; the modified timestamp is unchanged");
  assert.equal(autosave.revision, 0, "and no patch was emitted");
});

test("Autosave — Scenario: Retry schedule", async () => {
  const base = await web();
  let broken = false;
  const port = failing(base, () => (broken ? new StorageError("Unavailable", "the store is gone") : null));
  const { clock, edit, autosave } = await session({ port, start: 1_000_000 - 800 });
  const T0 = 1_000_000;
  const lastGood = await base.readProjectText("p1");
  broken = true; port.writes = 0;
  edit("Unsaved title");
  const attempts: number[] = [];
  const write = port.writeProjectText;
  port.writeProjectText = async (id, text) => { attempts.push(clock.now() - T0); await write(id, text); };
  await clock.advance(800);
  assert.deepEqual([attempts, autosave.status.state], [[0], "retrying"], "the save fails with Unavailable at t = 0");
  await clock.advance(14_000);
  assert.deepEqual(attempts, [0, 2000, 6000, 14_000], "retries start at t = 2 s, 6 s and 14 s");
  assert.equal(autosave.status.state, "failed", "after the third retry fails the save state is failed");
  await clock.advance(60_000);
  assert.equal(attempts.length, 4, "no further automatic retry");
  assert.equal(await base.readProjectText("p1"), lastGood, "the stored record equals the last successfully saved record");
  assert.equal(autosave.document.metadata.name, "Unsaved title", "the in-memory project still holds the unsaved edits");
  assert.deepEqual(autosave.leavePrompt("exit")!.text, "Changes are not saved");
  // "Save failed — Retry" once the store is back.
  broken = false;
  await autosave.retryNow();
  assert.deepEqual([autosave.status.state, (await stored(base)).metadata.name], ["saved", "Unsaved title"]);
});

test("Autosave: each save recomputes metadata.duration; saving is skipped while migrating; flush resolves when storage has acknowledged", async () => {
  const { port, clock, autosave, ctx } = await session();
  const withAsset = autosave.commit(addAsset(autosave.document, ctx(), { id: "a1", name: "c.mp4", type: "video", size: 1, duration: 480_000 })).document;
  const committed = autosave.commit(insertElement(withAsset, ctx(), "p1-track", { type: "video", id: "v1", name: "clip", startTime: 0, duration: 240_000, mediaId: "a1" }));
  assert.equal(committed.document.metadata.duration, 240_000, "the duration follows the timeline");
  assert.ok(committed.patch.some((entry) => entry.path === "/metadata/duration" && entry.value === 240_000), "as part of the same patch");
  await autosave.flush();
  assert.deepEqual([(await stored(port)).metadata.duration, autosave.status.state], [240_000, "saved"]);
  // Preview-layer data never reaches the record.
  autosave.change({ ...autosave.document, previewElements: [{ id: "ghost" }] } as never);
  await autosave.flush();
  assert.equal(/previewElements|ghost/.test(await port.readProjectText("p1")), false);
  // While the runner migrates the project its autosave is paused.
  const classicPort = await web();
  await classicPort.writeProjectText("p9", JSON.stringify({ version: 31, metadata: { id: "p9", name: "Old", duration: 0, createdAt: "2025-01-02T03:04:05.000Z", updatedAt: "2025-01-02T03:04:05.000Z" }, settings: { fps: { numerator: 30, denominator: 1 }, canvasSize: { width: 1920, height: 1080 }, background: { type: "color", color: "#000000" } }, currentSceneId: "s", scenes: [{ id: "s", name: "Main scene", isMain: true, bookmarks: [], createdAt: "2025-01-02T03:04:05.000Z", updatedAt: "2025-01-02T03:04:05.000Z", tracks: { overlay: [], audio: [], main: { id: "m", name: "Main Track", type: "video", elements: [] } } }] }));
  const { isMigrating } = await import("../src/index.ts");
  const seen: boolean[] = [];
  await runMigrations(classicPort, { now: () => NOW, newId: () => { seen.push(isMigrating(classicPort, "p9")); return `n${seen.length}`; }, steps: [{ ...STEP_V31_TO_V32, run: (record, context) => { context.newId(); return STEP_V31_TO_V32.run(record, context); } }] });
  assert.deepEqual([seen[0], isMigrating(classicPort, "p9")], [true, false]);
  await clock.advance(0);
});

// Requirement: Autosave failure and storage-full handling
async function fullStorage(freeBytes: number, recordBytes = 2 * MiB) {
  const base = await web();
  const state = { free: Infinity as number };
  const port = Object.assign(Object.create(base) as StoragePort, { available: async () => (state.free === Infinity ? null : state.free) });
  const opened = await session({ port });
  // A project record of about 2 MiB.
  const big = setLocal(opened.autosave.document, () => undefined);
  const padded = { ...big, glossaries: { en: [{ source: "x".repeat(recordBytes), target: "y" }] } } as unknown as ProjectDocument;
  return { ...opened, base, state, padded, set: (bytes: number) => { state.free = bytes; }, freeBytes };
}
test("Autosave failure and storage-full handling — Scenario: Save with 3 MiB available", async () => {
  const run = await fullStorage(3 * MiB);
  const lastGood = await run.base.readProjectText("p1");
  run.set(3 * MiB);
  const edited = run.autosave.change(run.padded);
  assert.ok(serializeProjectRecord(run.padded).length >= 2 * MiB);
  await run.clock.advance(800);
  const status = run.autosave.status;
  assert.equal(status.state, "storage-full");
  assert.equal(status.dialog!.text, "Storage is full — your recent changes are not saved", "the blocking dialog is shown");
  assert.deepEqual(status.dialog!.actions.map((action) => action.label), ["Free up space", "Export project package", "Keep editing"], "\"Empty trash\" is shown only when the trash is not empty");
  assert.equal(await run.base.readProjectText("p1"), lastGood, "the stored record is byte-identical to the last good save");
  assert.equal(run.autosave.document, edited, "the editor still holds the unsaved edits");
  assert.equal(status.snapshotsSuspended, true, "automatic snapshots are suspended");
  // "Keep editing": the dialog closes, the non-dismissable banner with the same text and actions stays.
  run.autosave.keepEditing();
  assert.deepEqual([run.autosave.status.dialog, run.autosave.status.banner!.text], [null, "Storage is full — your recent changes are not saved"]);
  // The save is retried every 30 s.
  const before = run.statuses.filter((entry) => entry.state === "saving").length;
  await run.clock.advance(30_000);
  assert.equal(run.statuses.filter((entry) => entry.state === "saving").length, before + 1);
  assert.equal(run.autosave.status.state, "storage-full");
});

test("Autosave failure and storage-full handling — Scenario: Exit while unsaved", async () => {
  const run = await fullStorage(3 * MiB);
  await run.autosave.flush();
  run.clock.set(new Date(2026, 9, 5, 10, 2).getTime());
  run.autosave.commit(renameProject(run.autosave.document, run.ctx(), "Saved at 10:02"));
  await run.autosave.flush();
  run.set(3 * MiB);
  const edited = run.autosave.change(run.padded);
  await run.clock.advance(800);
  const prompt = run.autosave.leavePrompt("exit")!;
  assert.equal(prompt.text, "Leave without saving? Changes since 10:02 will be lost");
  assert.deepEqual(prompt.actions.map((action) => [action.label, action.default === true]), [["Stay", true], ["Leave", false]], "\"Stay\" is the default");
  // Choosing "Stay" keeps the project open with its unsaved edits: nothing was written or dropped by asking.
  assert.equal(run.autosave.document, edited);
  for (const reason of ["close", "quit", "switch"] as const) assert.equal(run.autosave.leavePrompt(reason)!.text, prompt.text);
  // On mobile, moving to the background posts no dialog and keeps the in-memory project.
  const mobile = await platforms()[2].open();
  const mobilePort = Object.assign(Object.create(mobile) as StoragePort, { available: async () => 3 * MiB });
  const phone = await session({ port: mobilePort });
  const onPhone = phone.autosave.change(run.padded);
  await phone.clock.advance(800);
  assert.deepEqual([phone.autosave.status.state, phone.autosave.leavePrompt("background"), phone.autosave.document === onPhone], ["storage-full", null, true]);
});

test("Autosave failure and storage-full handling — Scenario: Save resumes after the trash is emptied", async () => {
  const run = await fullStorage(3 * MiB);
  run.trash.bytes = 3 * 1024 * MiB;
  run.set(3 * MiB);
  run.autosave.change(run.padded);
  await run.clock.advance(800);
  run.autosave.keepEditing();
  assert.deepEqual(run.autosave.status.banner!.actions.map((action) => action.label), ["Free up space", "Empty trash (3.0 GiB)", "Export project package", "Keep editing"]);
  // The user chooses "Empty trash (3.0 GiB)": space is back, and the save starts immediately.
  run.set(4 * 1024 * MiB);
  assert.equal(await run.autosave.storageFreed(), true);
  const status = run.autosave.status;
  assert.deepEqual([status.state, status.banner, status.dialog, status.snapshotsSuspended], ["saved", null, null, false], "the banner disappears and automatic snapshots resume");
  assert.equal((await stored(run.base)).glossaries.en[0].target, "y");
});

test("Autosave failure and storage-full handling — Scenario: Flush rejects", async () => {
  const run = await fullStorage(3 * MiB);
  run.set(3 * MiB);
  run.autosave.change(run.padded);
  await run.clock.advance(800);
  const saving = run.statuses.filter((entry) => entry.state === "saving").length;
  await assert.rejects(() => run.autosave.flush(), (error) => isStorageError(error, "QuotaExceeded"));
  assert.equal(run.statuses.filter((entry) => entry.state === "saving").length, saving + 1, "within one save attempt");
  // A store that itself reports "full" on write gets one cache eviction and one retry before the storage-full path.
  const base = await web();
  let evictions = 0, diskFull = false;
  const port = failing(base, () => (diskFull ? new StorageError("QuotaExceeded", "disk full") : null));
  Object.defineProperty(port, "cache", { value: Object.assign(Object.create(base.cache), { evict: async () => { evictions++; return 0; } }) });
  const other = await session({ port });
  port.writes = 0; diskFull = true;
  other.edit("x");
  await other.clock.advance(800);
  assert.deepEqual([other.autosave.status.state, port.writes, evictions >= 1], ["storage-full", 2, true]);
});

// Requirement: State patch emission
const clip = (id: string, startTime: number) => ({ type: "video" as const, id, name: id, startTime, duration: 120_000, mediaId: "a1" });
async function threeClips(synced = true) {
  const opened = await session({ synced });
  let document = opened.autosave.commit(addAsset(opened.autosave.document, opened.ctx(), { id: "a1", name: "c.mp4", type: "video", size: 1, duration: 480_000 })).document;
  for (const [id, start] of [["c1", 0], ["c2", 120_000], ["c3", 240_000]] as const) document = opened.autosave.commit(insertElement(document, opened.ctx(), "p1-track", clip(id, start))).document;
  await opened.autosave.flush();
  return opened;
}
test("State patch emission — Scenario: One step, one patch", async () => {
  const { autosave, ctx, port } = await threeClips();
  const base = autosave.document, journalBefore = (await port.readJournal("p1")).length;
  // A ripple delete: one clip goes and the two after it move up, as one undo step.
  const commit = commitChange(base, ctx(), { commandType: "element.ripple-delete", label: "Ripple delete" }, (draft) => {
    const elements = draft.scenes[0].tracks.main.elements;
    elements.splice(0, 1);
    for (const element of elements) element.startTime -= 120_000;
  });
  const emitted = autosave.commit(commit);
  const paths = emitted.patch.map((entry) => `${entry.op} ${entry.path}`);
  assert.deepEqual(paths.filter((path) => path.includes("/elements/")), ["remove /scenes/@p1-scene/tracks/main/elements/@c1", "replace /scenes/@p1-scene/tracks/main/elements/@c2/startTime", "replace /scenes/@p1-scene/tracks/main/elements/@c3/startTime"]);
  await autosave.flush();
  const journal = await port.readJournal("p1");
  assert.equal(journal.length, journalBefore + 1, "exactly one patch is emitted");
  const entry = journal.at(-1)!;
  assert.deepEqual([entry.commandType, entry.label, entry.revision - entry.baseRevision], ["element.ripple-delete", "Ripple delete", 1], "with commandType, a display label, the base and the resulting revision");
  assert.equal(emitted.patch.some((patch) => patch.path.startsWith("/local")), false);
  // Undo and redo produce patches of their own.
  const history = createHistory();
  history.record(base, { ...commit, document: emitted.document });
  const undone = history.undo(emitted.document, (document, patch) => applyPatch(document, patch))!;
  autosave.commit({ document: undone.document, patch: undone.patch, commandType: "history.undo", label: undone.label });
  await autosave.flush();
  assert.deepEqual([(await port.readJournal("p1")).length, (await port.readJournal("p1")).at(-1)!.commandType], [journalBefore + 2, "history.undo"]);
});

test("State patch emission — Scenario: Patch application is engine-independent", async () => {
  const { autosave, ctx, port } = await threeClips();
  // Applying a patch executes no editor command logic: it is the generic applier over plain JSON, with numbers copied
  // as the writer serialised them. The same code runs in V8, JavaScriptCore and Hermes; this process is V8, the
  // browser harness of `test/browser` repeats the replay in Chromium, and a JavaScriptCore or Hermes run needs a device.
  const base = JSON.parse(canonicalize(project())) as ProjectDocument;
  autosave.commit(commitChange(autosave.document, ctx(), { commandType: "element.update", label: "Opacity" }, (draft) => { (draft.scenes[0].tracks.main.elements[0] as { opacity: number }).opacity = 0.1 + 0.2; }));
  await autosave.flush();
  const journal = await port.readJournal("p1");
  const replay = () => canonicalize(journal.reduce<object>((document, entry) => applyPatch(document, JSON.parse(JSON.stringify(entry.patch))), base));
  assert.equal(replay(), replay());
  assert.equal(replay(), splitRecord(await port.readProjectText("p1")).canonical, "byte-identical to the saved record");
  assert.match(replay(), /"opacity":0\.3[,}]/, "the writer rounded the number before it was stored; appliers copy it");
});

test("State patch emission — Scenario: Journal survives a restart", async () => {
  for (const platform of platforms()) {
    const port = await platform.open();
    const opened = await session({ port, synced: true });
    const base = opened.autosave.document;
    for (const name of ["One", "Two", "Three"]) { opened.edit(name); await opened.clock.advance(800); }
    opened.autosave.stop();
    // The app is restarted.
    const restarted = platform.name.startsWith("desktop") ? port : await platform.open();
    const journal = await restarted.readJournal("p1");
    assert.deepEqual(journal.map((entry) => [entry.baseRevision, entry.revision]), [[0, 1], [1, 2], [2, 3]], `${platform.name}: the journal holds three patches`);
    assert.deepEqual(await verifyJournal(restarted, "p1", base), { ok: true, patches: 3, revision: 3 }, "replaying them on the base revision equals the saved record");
    // The server acknowledged revision 2: the journal is truncated.
    await restarted.truncateJournal("p1", 2);
    assert.deepEqual((await restarted.readJournal("p1")).map((entry) => entry.revision), [3]);
    // A journal that no longer replays to the saved record is discarded: the client falls back to a full snapshot.
    await restarted.appendJournal("p1", { baseRevision: 3, revision: 4, commandType: "x", label: "x", patch: [{ op: "replace", path: "/metadata/name", value: "Never saved" }] });
    const check = await verifyJournal(restarted, "p1", applyPatch(applyPatch(base, journal[0].patch as never), journal[1].patch as never));
    assert.deepEqual([check.ok, (check as { fallback?: string }).fallback, await restarted.readJournal("p1")], [false, "snapshot", []]);
  }
  // A project that is not synced keeps no journal.
  const local = await session({ synced: false });
  local.edit("Local only");
  await local.autosave.flush();
  assert.deepEqual(await local.port.readJournal("p1"), []);
  // The same emission applies to documents of kind `script`.
  const port = await web(), clock = fakeClock(NOW);
  const script = createScriptAutosave({ port, scriptId: "s1", document: { title: "Pilot", scenes: [{ id: "sc1", text: "INT." }] }, clock, synced: true });
  const patch = script.edit({ title: "Pilot", scenes: [{ id: "sc1", text: "INT. KITCHEN" }] }, { commandType: "script.edit", label: "Edit" });
  assert.deepEqual(patch, [{ op: "replace", path: "/scenes/@sc1/text", value: "INT. KITCHEN" }]);
  await clock.advance(800);
  assert.deepEqual([(await port.getDocument<{ scenes: { text: string }[] }>("script", "s1"))!.scenes[0].text, (await port.readJournal(scriptJournalKey("s1"))).length], ["INT. KITCHEN", 1]);
});

test("State patch emission — Scenario: View state is not patched", async () => {
  const { autosave, clock, port } = await threeClips();
  const journal = (await port.readJournal("p1")).length, revision = autosave.revision;
  for (const [zoomLevel, scrollLeft] of [[2, 100], [3, 400]]) autosave.changeLocal(setLocal(autosave.document, (local) => { local.timelineViewState = { zoomLevel, scrollLeft, playheadTime: 0, scenePlayheads: {}, expandedKeyframeElementIds: [] }; }));
  await clock.advance(1000);
  assert.deepEqual([(await port.readJournal("p1")).length, autosave.revision, (await stored(port)).local.timelineViewState.zoomLevel], [journal, revision, 3], "no patch is emitted; the view state is stored");
  assert.equal(commitChange(autosave.document, { now_ms: NOW, newId: idSource() }, { commandType: "noop", label: "" }, () => undefined).patch.length, 0);
});

// Requirement: Version snapshots
async function versions(settings: { interval: 1 | 5 | 10 | 30 | "off"; keepAutomatic: number } = { interval: 10, keepAutomatic: 20 }, sync?: Parameters<typeof createSnapshotManager>[0]["sync"]) {
  const opened = await session();
  const current = { ...settings };
  const snapshots = createSnapshotManager({ port: opened.port, projectId: "p1", newId: idSource("snap"), clock: opened.clock, settings: () => current, autosave: opened.autosave, sync });
  return { ...opened, snapshots, current };
}
test("Version snapshots — Scenario: Periodic snapshot", async () => {
  const run = await versions();
  await run.snapshots.open();
  const opening = (await run.port.listSnapshots("p1")).length;
  assert.equal(opening, 1, "one automatic snapshot when a project is opened and has changed since its last snapshot");
  // Edited continuously for 25 minutes with the default interval of 10 minutes.
  for (let minute = 0; minute < 25; minute++) { run.edit(`Edit ${minute}`); await run.clock.advance(MINUTE); }
  const taken = (await run.port.listSnapshots("p1")).filter((info) => info.kind === "automatic").length - opening;
  assert.ok(taken >= 2, `at least 2 automatic snapshots were created during that time (${taken})`);
  // Without a save since the last snapshot the interval takes none.
  await run.clock.advance(10 * MINUTE);
  const before = (await run.port.listSnapshots("p1")).length;
  await run.clock.advance(30 * MINUTE);
  assert.equal((await run.port.listSnapshots("p1")).length, before);
  run.snapshots.stop();
});

test("Version snapshots — Scenario: Interval off", async () => {
  const run = await versions({ interval: "off", keepAutomatic: 20 });
  await run.snapshots.open();
  const opening = (await run.port.listSnapshots("p1")).length;
  for (let minute = 0; minute < 25; minute++) { run.edit(`Edit ${minute}`); await run.clock.advance(MINUTE); }
  assert.equal((await run.port.listSnapshots("p1")).length, opening, "no interval snapshot is created");
  run.edit("Last words");
  const exit = await run.snapshots.exit();
  assert.equal(exit!.kind, "automatic", "the snapshot taken on Exit project still is");
  assert.equal(JSON.parse((await run.port.readSnapshot("p1", exit!.id)).record).metadata.name, "Last words", "after the pending save was flushed");
});

test("Version snapshots — Scenario: Restore is reversible", async () => {
  const run = await versions();
  run.edit("Yesterday");
  const yesterday = await run.snapshots.saveVersion("Rough cut");
  await run.clock.advance(24 * 60 * MINUTE);
  run.edit("Today");
  await run.autosave.flush();
  const count = (await run.port.listSnapshots("p1")).length;
  const restored = await run.snapshots.restore(yesterday.id);
  assert.equal(restored.document.metadata.name, "Yesterday");
  assert.equal(splitRecord(await run.port.readProjectText("p1")).canonical, (await run.port.readSnapshot("p1", yesterday.id)).record, "the project equals that snapshot");
  const history = await run.port.listSnapshots("p1");
  assert.equal(history.length, count + 1);
  assert.deepEqual([history[0].kind, JSON.parse((await run.port.readSnapshot("p1", history[0].id)).record).metadata.name], ["automatic", "Today"], "a new automatic snapshot of the state just before the restore");
  // Media referenced by a retained snapshot is not purged, and comes back with the record on Restore.
  const withAsset = run.autosave.commit(addAsset(restored.document, run.ctx(), { id: "a1", name: "c.mp4", type: "video", size: 3 })).document;
  await run.port.writeMedia("p1", "a1", Uint8Array.of(1, 2, 3), { extension: "mp4" });
  const kept = await run.snapshots.saveVersion("With clip");
  run.autosave.commit(removeAssets(withAsset, run.ctx(), ["a1"]));
  await run.autosave.flush();
  const { purgeUnreferencedMedia } = await import("../src/index.ts");
  assert.deepEqual(await purgeUnreferencedMedia(run.port, "p1", { now: run.clock.now(), only: ["a1"] }), [], "a retained snapshot still references the asset");
  const back = await run.snapshots.restore(kept.id);
  assert.deepEqual([back.document.media.assets.map((asset) => asset.id), [...await run.port.readMedia("p1", "a1")]], [["a1"], [1, 2, 3]]);
  // Version history lists time, label, kind and duration; rename, duplicate and delete work on a snapshot.
  await run.snapshots.rename(kept.id, "Keeper");
  const entry = (await run.snapshots.history()).find((item) => item.id === kept.id)!;
  assert.deepEqual([entry.label, entry.kind, entry.source, typeof entry.created_ms, (entry as { duration: number }).duration], ["Keeper", "manual", "local", "number", 0]);
  assert.equal((await run.snapshots.preview(kept.id)).readOnly, true);
  await run.snapshots.duplicateAsNewProject(kept.id, { id: "p2", name: "Copy" });
  assert.deepEqual([(await loadProject(run.port, "p2")).document.metadata.name, [...await run.port.readMedia("p2", "a1")], await run.port.mediaReferences((await run.port.mediaInfo("p1", "a1"))!.contentHash)], ["Copy", [1, 2, 3], 2]);
  await assert.rejects(() => run.snapshots.saveVersion("x".repeat(81)), RangeError);
});

test("Version snapshots — Scenario: Automatic retention", async () => {
  const run = await versions({ interval: "off", keepAutomatic: 20 });
  const manual = await run.snapshots.saveVersion("Keep me");
  for (let index = 1; index <= 20; index++) { run.edit(`State ${index}`); await run.snapshots.exit(); }
  const twenty = (await run.port.listSnapshots("p1")).filter((info) => info.kind === "automatic");
  assert.equal(twenty.length, 20);
  const oldest = twenty.at(-1)!.id;
  run.edit("State 21");
  await run.snapshots.exit();
  const after = await run.port.listSnapshots("p1");
  assert.deepEqual([after.filter((info) => info.kind === "automatic").length, after.some((info) => info.id === oldest), after.some((info) => info.id === manual.id)], [20, false, true], "the oldest automatic snapshot is deleted and manual snapshots are untouched");
  // Up to 50 manual snapshots: creating the 51st requires deleting one.
  for (let index = 2; index <= 50; index++) await run.snapshots.saveVersion(`v${index}`);
  await assert.rejects(() => run.snapshots.saveVersion("v51"), (error) => isStorageError(error) && error.details?.reason === "manual-snapshot-limit");
  await run.snapshots.delete(manual.id);
  assert.equal((await run.snapshots.saveNow()).kind, "manual", "\"Save now\" flushes autosave and creates a manual snapshot");
  // Automatic snapshots are suspended while storage is full.
  const full = await fullStorage(3 * MiB);
  const suspended = createSnapshotManager({ port: full.port, projectId: "p1", newId: idSource("s"), clock: full.clock, settings: () => ({ interval: 1, keepAutomatic: 20 }), autosave: full.autosave });
  full.set(3 * MiB); full.autosave.change(full.padded);
  await full.clock.advance(800);
  await suspended.open();
  await full.clock.advance(5 * MINUTE);
  assert.deepEqual([await full.port.listSnapshots("p1"), await suspended.exit()], [[], null]);
  suspended.stop();
});

test("Version snapshots — Scenario: Restore without the lease", async () => {
  const named: string[] = [];
  const lease = { held: false, holder: "Linh's MacBook" };
  const run = await versions({ interval: "off", keepAutomatic: 20 }, { lease: () => lease, createNamedVersion: async (label) => { named.push(label); }, listNamedVersions: async () => [{ id: "host-1", label: "From the phone", created_ms: NOW, device: "Pixel 9" }] });
  const version = await run.snapshots.saveVersion("Cut 1");
  assert.deepEqual(named, ["Cut 1"], "for a synced project \"Save version\" also creates a host named version with the same label");
  assert.deepEqual(run.snapshots.restoreAvailability(), { enabled: false, tooltip: "Linh's MacBook is editing this project" }, "Restore is disabled with the tooltip naming the device that holds the lease");
  await assert.rejects(() => run.snapshots.restore(version.id), (error) => isStorageError(error) && error.details?.reason === "edit-lease");
  assert.deepEqual((await run.snapshots.history()).filter((entry) => entry.source === "host").map((entry) => [entry.label, (entry as { device: string }).device]), [["From the phone", "Pixel 9"]], "named versions of other devices are listed with a device badge");
  lease.held = true;
  assert.equal(run.snapshots.restoreAvailability().enabled, true);
});

// Requirement: Crash recovery
test("Crash recovery — Scenario: Unexpected termination", async () => {
  for (const platform of platforms()) {
    const port = await platform.open();
    const opened = await session({ port });
    await markProjectOpened(port, "p1", opened.clock.now());
    opened.edit("The last edit");
    // The process is killed 5 s after the last edit: no flush, no orderly shutdown.
    await opened.clock.advance(5000);
    opened.autosave.stop();
    const restarted = platform.name.startsWith("desktop") ? port : await platform.open();
    const prompt = (await crashPrompt(restarted))!;
    assert.equal(prompt.text, "JAgentChill closed unexpectedly — Reopen 'The last edit'", platform.name);
    assert.deepEqual([prompt.actions.map((action) => action.label), prompt.detail], [["Reopen", "Dismiss"], null]);
    const reopened = await reopenAfterCrash(restarted, prompt.projectId);
    assert.equal(reopened.status === "opened" && reopened.project.document.metadata.name, "The last edit", "the reopened project contains that edit");
    await dismissCrashPrompt(restarted);
    assert.equal(await crashPrompt(restarted), null);
  }
  // An orderly exit leaves no prompt.
  const port = await web();
  await saveProject(port, project());
  await markProjectOpened(port, "p1", NOW);
  await markSessionClean(port);
  assert.equal(await crashPrompt(port), null);
});

test("Crash recovery — Scenario: Corrupt latest record", async () => {
  const run = await versions({ interval: "off", keepAutomatic: 20 });
  run.edit("Good state");
  run.clock.set(new Date(2026, 9, 5, 9, 30).getTime());
  const snapshot = await run.snapshots.saveVersion("");
  await markProjectOpened(run.port, "p1", run.clock.now());
  // A partially written record: it fails validation and is never opened.
  await run.port.writeProjectText("p1", (await run.port.readProjectText("p1")).slice(0, 200));
  const reopened = await reopenAfterCrash(run.port, "p1");
  assert.equal(reopened.status, "unreadable");
  const offer = (reopened as Extract<typeof reopened, { status: "unreadable" }>).offer!;
  assert.deepEqual([offer.kind, offer.id, offer.text], ["snapshot", snapshot.id, "Restore latest version from 09:30"]);
  await restoreOffered(run.port, "p1", offer);
  assert.equal((await loadProject(run.port, "p1")).document.metadata.name, "Good state", "it opens on confirmation");
  // With no snapshot the most recent migration backup is offered; with neither, nothing is.
  const bare = await web();
  await bare.writeProjectText("p3", "{ broken");
  assert.equal(((await reopenAfterCrash(bare, "p3")) as { offer: unknown }).offer, null);
  await bare.putBackup("p3", { sourceVersion: 31, time_ms: NOW, record: "{\"version\":31}" });
  assert.equal(((await reopenAfterCrash(bare, "p3")) as { offer: { kind: string } }).offer.kind, "backup");
});

test("Crash recovery — Scenario: Crash while storage was full", async () => {
  const run = await fullStorage(3 * MiB);
  run.clock.set(new Date(2026, 9, 5, 10, 2).getTime());
  run.autosave.commit(renameProject(run.autosave.document, run.ctx(), "The 10:02 record"));
  await run.autosave.flush();
  const at1002 = await run.base.readProjectText("p1");
  await markProjectOpened(run.base, "p1", run.clock.now());
  await recordSaveState(run.base, run.autosave.status);
  run.set(3 * MiB);
  run.autosave.change(run.padded);
  await run.clock.advance(800);
  run.autosave.keepEditing();
  assert.ok(run.autosave.status.banner, "the storage-full banner is shown");
  await recordSaveState(run.base, run.autosave.status);
  // Killed here.
  const prompt = (await crashPrompt(run.base))!;
  assert.equal(prompt.detail, "Changes after 10:02 were not saved");
  const reopened = await reopenAfterCrash(run.base, "p1");
  assert.equal(await run.base.readProjectText("p1"), at1002);
  assert.equal(reopened.status === "opened" && reopened.project.document.metadata.name, "The 10:02 record", "the reopened project equals the 10:02 record");
});

test("Crash recovery — Scenario: Orphan cleanup", async () => {
  const HOUR = 3_600_000;
  for (const platform of platforms()) {
    const port = await platform.open();
    const withAsset = addAsset(project(), { now_ms: NOW, newId: idSource() }, { id: "kept", name: "kept.mp4", type: "video", size: 3 }).document;
    await saveProject(port, withAsset);
    await port.writeMedia("p1", "kept", Uint8Array.of(1, 2, 3), { extension: "mp4" });
    // An interrupted import: the file was written and its asset record never was.
    await port.writeMedia("p1", "orphan", Uint8Array.of(9, 9), { extension: "mp4" });
    const written = (await port.listMediaFiles()).find((file) => file.assetId === "orphan")!.modified_ms;
    assert.deepEqual(await removeOrphanMedia(port, written + 23 * HOUR), [], `${platform.name}: a file younger than 24 hours is left alone`);
    assert.deepEqual(await removeOrphanMedia(port, written + 25 * HOUR), [{ projectId: "p1", assetId: "orphan" }], "a 25-hour-old file no asset record references is deleted");
    assert.deepEqual([await port.hasMedia("p1", "orphan"), [...await port.readMedia("p1", "kept")], (await port.listMediaFiles()).map((file) => file.assetId)], [false, [1, 2, 3], ["kept"]]);
    // A file that only a retained snapshot references is not an orphan.
    await port.writeMedia("p1", "old", Uint8Array.of(4), { extension: "mp4" });
    const record = JSON.parse(await port.readProjectText("p1"));
    record.media.assets.push({ ...record.media.assets[0], id: "old" });
    await port.putSnapshot("p1", { id: "s1", kind: "manual", created_ms: NOW, label: "", duration: 0, schemaVersion: 32, record: JSON.stringify(record) });
    assert.deepEqual(await removeOrphanMedia(port, written + 100 * HOUR), []);
  }
});

// Requirement: Persistent storage request
const memoryPreferences = (initial: Record<string, string> = {}): PreferencesPort & { data: Map<string, string> } => {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: (key) => { data.delete(key); } };
};
function browserStorage(grant: boolean, initiallyPersisted = false) {
  const state = { persisted: initiallyPersisted, requests: 0 };
  return { state, storage: { persist: async () => { state.requests++; if (grant) state.persisted = true; return state.persisted; }, persisted: async () => state.persisted } };
}
test("Persistent storage request — Scenario: Prompting browser", async () => {
  const { state, storage } = browserStorage(true), clock = fakeClock(NOW);
  const request = createPersistenceRequest({ platform: "web", storage, prompts: true }, createPreferences(memoryPreferences()), clock.now);
  const view = await request.onProjectsScreen();
  assert.deepEqual([view.dialog!.title, view.dialog!.actions.map((action) => action.label), state.requests], ["Don't lose your projects", ["Allow", "Not now"], 0], "the dialog is shown before anything is requested");
  const allowed = await request.allow();
  assert.deepEqual([state.requests, allowed.dialog, allowed.persisted, allowed.banner], [1, null, true, null], "choosing Allow calls persist(), which triggers the browser permission prompt");
});

test("Persistent storage request — Scenario: Dismissed", async () => {
  const { state, storage } = browserStorage(true), clock = fakeClock(NOW), preferences = createPreferences(memoryPreferences());
  const request = createPersistenceRequest({ platform: "web", storage, prompts: true }, preferences, clock.now);
  assert.ok((await request.onProjectsScreen()).dialog);
  request.notNow();
  await clock.advance(5 * 86_400_000);
  assert.deepEqual([(await request.onProjectsScreen()).dialog, state.requests], [null, 0], "5 days after \"Not now\" the dialog is not shown");
  await clock.advance(26 * 86_400_000);
  assert.ok((await request.onProjectsScreen()).dialog, "after 30 days it is shown again");
  assert.equal(preferences.get(PREFERENCES.dismissals).persistDialog_ms, NOW, "the dismissal is recorded as a UI preference");
});

test("Persistent storage request — Scenario: Silent grant", async () => {
  const { state, storage } = browserStorage(true);
  const request = createPersistenceRequest({ platform: "web", storage, prompts: false }, createPreferences(memoryPreferences()), () => NOW);
  const view = await request.onProjectsScreen();
  assert.deepEqual([view.dialog, view.banner, view.persisted, view.storagePage, state.requests], [null, null, true, null, 1], "no dialog and no banner; storage is reported as persisted");
  // Already persisted: nothing is asked. Desktop and mobile are durable and make no request.
  const again = browserStorage(true, true);
  await createPersistenceRequest({ platform: "web", storage: again.storage, prompts: false }, createPreferences(memoryPreferences()), () => NOW).onProjectsScreen();
  assert.equal(again.state.requests, 0);
  for (const platform of ["desktop", "mobile"] as const) {
    const spy = browserStorage(true);
    const durable = await createPersistenceRequest({ platform, storage: spy.storage }, createPreferences(memoryPreferences()), () => NOW).onProjectsScreen();
    assert.deepEqual([durable.persisted, durable.dialog, durable.banner, spy.state.requests], [true, null, null, 0]);
  }
});

test("Persistent storage request — Scenario: Not persisted", async () => {
  const { state, storage } = browserStorage(false), clock = fakeClock(NOW);
  const request = createPersistenceRequest({ platform: "web", storage, prompts: false, installAvailable: true }, createPreferences(memoryPreferences()), clock.now);
  const view = await request.onProjectsScreen();
  assert.equal(view.banner!.text, "This browser can delete your projects. Install the app or turn on sync");
  assert.deepEqual(view.banner!.actions.map((action) => action.label), ["Install", "Sync with a host", "Hide for 7 days"]);
  assert.deepEqual([view.storagePage!.text, view.storagePage!.action.label], ["The browser can clear this storage", "Request again"]);
  assert.equal(request.hideBanner().banner, null);
  await clock.advance(6 * 86_400_000);
  assert.equal(request.view().banner, null);
  await clock.advance(2 * 86_400_000);
  assert.ok(request.view().banner, "8 days after \"Hide for 7 days\" it is shown again");
  const requests = state.requests;
  await request.requestAgain();
  assert.equal(state.requests, requests + 1);
  // Where the browser offers no install prompt the banner has no "Install".
  const plain = await createPersistenceRequest({ platform: "web", storage: browserStorage(false).storage, prompts: false }, createPreferences(memoryPreferences()), clock.now).onProjectsScreen();
  assert.deepEqual(plain.banner!.actions.map((action) => action.label), ["Sync with a host", "Hide for 7 days"]);
});

// Requirement: Migration progress dialog
const classicRecord = (id: string, extra: Record<string, unknown> = {}) => JSON.stringify({
  version: 31, metadata: { id, name: `Classic ${id}`, duration: 0, createdAt: "2025-01-02T03:04:05.000Z", updatedAt: "2025-01-02T03:04:05.000Z" },
  settings: { fps: { numerator: 30, denominator: 1 }, canvasSize: { width: 1920, height: 1080 }, background: { type: "color", color: "#000000" } }, currentSceneId: "s",
  scenes: [{ id: "s", name: "Main scene", isMain: true, bookmarks: [], createdAt: "2025-01-02T03:04:05.000Z", updatedAt: "2025-01-02T03:04:05.000Z", tracks: { overlay: [], audio: [], main: { id: `${id}-m`, name: "Main Track", type: "video", elements: [] } } }], ...extra,
});
test("Migration progress dialog — Scenario: Minimum display time", async () => {
  const port = await web(), clock = fakeClock(0);
  for (const id of ["a", "b", "c"]) await port.writeProjectText(id, classicRecord(id));
  await port.writeProjectText("b", classicRecord("b", { scenes: "not an array" }));
  const states: { visible: boolean; counter: string; projectName: string; progress: number }[] = [];
  const dialog = createMigrationDialog(port, { clock, onChange: (state) => states.push({ visible: state.visible, counter: state.counter, projectName: state.projectName, progress: state.progress }) });
  // The run completes in 120 ms.
  const running = dialog.run({ now: () => NOW, newId: idSource() }, async (store, options) => { const outcomes = await runMigrations(store, options); clock.set(120); return outcomes; });
  await clock.advance(120);
  assert.deepEqual([dialog.state.visible, dialog.state.title, dialog.state.dismissible], [true, "Updating your projects", false], "a modal dialog without a dismiss control");
  assert.deepEqual(states.filter((state) => state.counter).map((state) => [state.projectName, state.counter]).filter((entry, index, all) => index === 0 || entry[1] !== all[index - 1][1]), [["Classic a", "1 of 3"], ["Classic b", "2 of 3"], ["Classic c", "3 of 3"]]);
  await clock.advance(879);
  assert.equal(dialog.state.visible, true, "still visible at 999 ms");
  await clock.advance(1);
  await running;
  assert.equal(dialog.state.visible, false, "it closes automatically once 1000 ms have elapsed since it appeared");
  // A project failed: the summary lists it with "Copy details" and "Restore backup".
  const [row] = dialog.state.summary!;
  assert.deepEqual([dialog.state.summary!.length, row.name, row.status, row.step, row.actions.map((action) => [action.label, action.enabled])], [1, "Classic b", "Migration failed", "v31→v32", [["Copy details", true], ["Restore backup", false]]]);
  assert.match(row.details, /project: b\nfrom version: 31\nstep: v31→v32\nerror: /);
  dialog.closeSummary();
  assert.equal(dialog.state.summary, null);
});

test("Migration progress dialog — Scenario: Nothing to migrate", async () => {
  const port = await web(), clock = fakeClock(0), states: boolean[] = [];
  await saveProject(port, project());
  const dialog = createMigrationDialog(port, { clock, onChange: (state) => states.push(state.visible) });
  assert.deepEqual(await dialog.run({ now: () => NOW, newId: idSource() }), []);
  assert.deepEqual([states, dialog.state.visible, dialog.state.summary], [[], false, null], "no migration dialog appears");
});

// Requirement: Schema 32 migration (the lazy half)
test("Schema 32 migration — Scenario: Classic asset is re-probed once", async () => {
  const port = await web(), newId = idSource();
  await port.writeProjectText("p", classicRecord("p"));
  await runMigrations(port, { now: () => NOW, newId, mediaRecordsFor: async () => [{ id: "m1", name: "clip.mp4", type: "video", size: 4, lastModified: 1_700_000_000_000, width: 1920, height: 1080, duration: 2 }] });
  await port.writeMedia("p", "m1", Uint8Array.of(1, 2, 3, 4), { extension: "mp4" });
  const loaded = (await loadProject(port, "p")).document as ProjectDocument & { local: { media: Record<string, { needsProbe: boolean; canDecode: boolean | null }> } };
  assert.deepEqual([loaded.media.assets[0].contentHash, loaded.media.assets[0].hasAudio, loaded.media.assets[0].fps, loaded.local.media.m1.needsProbe], [null, undefined, undefined, true]);
  let probes = 0;
  const probe = async () => { probes++; return { canDecode: true, fields: { hasAudio: true, fps: { numerator: 30, denominator: 1 }, videoCodec: "avc1.640028", audioCodec: "mp4a.40.2", container: "mp4" } }; };
  const first = await completeMigratedAssets(loaded, { port, probe, context: () => ({ now_ms: NOW + 1, newId }) });
  const asset = first.document.media.assets[0] as Record<string, unknown>;
  assert.deepEqual([probes, first.probed, asset.hasAudio, asset.fps, asset.videoCodec, asset.audioCodec, asset.contentHash], [1, ["m1"], true, { numerator: 30, denominator: 1 }, "avc1.640028", "mp4a.40.2", (await port.mediaInfo("p", "m1"))!.contentHash]);
  assert.equal(first.commits[0].history, false, "persisted by non-history updates");
  await saveProject(port, first.document);
  const again = (await loadProject(port, "p")).document as typeof loaded;
  assert.deepEqual([again.local.media.m1.needsProbe, again.local.media.m1.canDecode], [false, true], "needsProbe is cleared");
  assert.deepEqual([(await completeMigratedAssets(again, { port, probe, context: () => ({ now_ms: NOW + 2, newId }) })).probed, probes], [[], 1], "a second load does not probe it");
});

// Requirement: UI preference storage
test("UI preference storage — Scenario: Toggle survives restart", () => {
  const store = memoryPreferences();
  const preferences = createPreferences(store);
  assert.equal(preferences.get(PREFERENCES.timelineRipple), false);
  preferences.set(PREFERENCES.timelineRipple, true);
  // The app is restarted: a new preference store over the same localStorage.
  assert.equal(createPreferences(store).get(PREFERENCES.timelineRipple), true);
  assert.deepEqual(JSON.parse(store.data.get("jagentchill.pref.timeline.ripple")!), { v: 1, value: true }, "a versioned JSON entry");
  const fresh = createPreferences(memoryPreferences());
  assert.deepEqual([fresh.get(PREFERENCES.timelineSnapping), fresh.get(PREFERENCES.timelineMagnet), fresh.get(PREFERENCES.timelineLinkage), fresh.get(PREFERENCES.timelineFreeLayer), fresh.get(PREFERENCES.timelineAutoFollow), fresh.get(PREFERENCES.theme), fresh.get(PREFERENCES.snapshotInterval), fresh.get(PREFERENCES.snapshotsToKeep)], [true, true, true, false, "page", "system", 10, 20]);
  // Preferences are never part of a project record.
  assert.equal(/timeline\.ripple|jagentchill\.pref/.test(serializeProjectRecord(project())), false);
});

test("UI preference storage — Scenario: One value, two surfaces", () => {
  const preferences = createPreferences(memoryPreferences());
  const toolbar: boolean[] = [], settingsRow: boolean[] = [];
  preferences.subscribe(PREFERENCES.timelineSnapping, (value) => toolbar.push(value));
  const stop = preferences.subscribe(PREFERENCES.timelineSnapping, (value) => settingsRow.push(value));
  // Auto snapping is switched off in the timeline toolbar.
  preferences.set(PREFERENCES.timelineSnapping, false);
  assert.deepEqual([toolbar, settingsRow, preferences.get(PREFERENCES.timelineSnapping)], [[false], [false], false], "the row in the editing preferences shows it off without a restart");
  stop();
  preferences.set(PREFERENCES.timelineSnapping, true);
  assert.deepEqual([toolbar, settingsRow], [[false, true], [false]]);
});

test("UI preference storage — Scenario: Corrupt entry", () => {
  const store = memoryPreferences({ "jagentchill.pref.panels.sizes": "{ not json", "jagentchill.pref.theme": JSON.stringify({ v: 1, value: "neon" }), "jagentchill.pref.timeline.snapping": JSON.stringify({ v: 9, value: false }) });
  const preferences = createPreferences(store);
  assert.deepEqual(preferences.get(PREFERENCES.panelSizes), {}, "the app starts with default panel sizes");
  assert.deepEqual(JSON.parse(store.data.get("jagentchill.pref.panels.sizes")!), { v: 1, value: {} }, "and overwrites the entry");
  assert.deepEqual([preferences.get(PREFERENCES.theme), preferences.get(PREFERENCES.timelineSnapping)], ["system", true]);
  // Per-key migrations bring an entry of an earlier version forward.
  const migrating = { key: "panels.sizes", version: 2, defaults: { tools: 300 } as Record<string, number>, migrate: { 1: (old: unknown) => ({ tools: (old as { left: number }).left }) }, parse: (value: unknown) => value as Record<string, number> };
  const old = memoryPreferences({ "jagentchill.pref.panels.sizes": JSON.stringify({ v: 1, value: { left: 280 } }) });
  assert.deepEqual([createPreferences(old).get(migrating), JSON.parse(old.data.get("jagentchill.pref.panels.sizes")!)], [{ tools: 280 }, { v: 2, value: { tools: 280 } }]);
  // A store that throws (a disabled localStorage) never blocks start-up.
  const broken: PreferencesPort = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, removeItem: () => undefined };
  assert.equal(createPreferences(broken).get(PREFERENCES.projectsViewMode), "grid");
});

// Requirement: Storage integrity and concurrency
async function twoTabs() {
  const port = await web(), clock = fakeClock(NOW);
  await saveProject(port, project());
  const listeners = new Set<(message: { projectId: string }) => void>();
  const signal = { post: (message: { projectId: string }) => { for (const listener of [...listeners]) listener(message); }, listen: (handler: (message: { projectId: string }) => void) => { listeners.add(handler); return () => { listeners.delete(handler); }; } };
  const flushed: string[] = [];
  const a = openProjectLock({ port, projectId: "p1", instanceId: "tab-a", clock: clock.fork("tab-a"), signal, onRelinquish: async () => { flushed.push("a"); } });
  const b = openProjectLock({ port, projectId: "p1", instanceId: "tab-b", clock: clock.fork("tab-b"), signal });
  return { port, clock, a, b, flushed };
}
test("Storage integrity and concurrency — Scenario: Second tab", async () => {
  const { a, b, clock, port } = await twoTabs();
  assert.deepEqual([(await a.acquire()).role, (await a.acquire()).readOnly], ["owner", false]);
  const second = await b.acquire();
  assert.deepEqual([second.readOnly, second.banner!.text, second.banner!.action.label], [true, "This project is open in another window", "Take over"]);
  // Edits in tab A continue to save, and the heartbeat keeps tab B read-only.
  const autosave = createProjectAutosave({ port, document: project(), clock });
  autosave.commit(renameProject(autosave.document, { now_ms: clock.now(), newId: idSource() }, "Edited in A"));
  await clock.advance(60_000);
  assert.deepEqual([(await stored(port)).metadata.name, a.view.role, b.view.role], ["Edited in A", "owner", "reader"]);
});

test("Storage integrity and concurrency — Scenario: Take over", async () => {
  const { a, b, clock, flushed } = await twoTabs();
  await a.acquire(); await b.acquire();
  await b.takeOver();
  await clock.advance(0);
  assert.deepEqual([flushed, a.view.readOnly, a.view.banner!.text, b.view.readOnly, b.view.banner], [["a"], true, "This project is open in another window", false, null], "tab A flushes its pending save and becomes read-only, and tab B becomes editable");
  await clock.advance(60_000);
  assert.deepEqual([a.view.role, b.view.role], ["reader", "owner"]);
});

test("Storage integrity and concurrency — Scenario: Owner killed", async () => {
  const { a, b, clock } = await twoTabs();
  await a.acquire(); await b.acquire();
  await clock.advance(25_000);
  const lastHeartbeat = NOW + 20_000;
  // Tab A is killed without releasing the lock: its heartbeat stops.
  clock.kill("tab-a");
  await clock.advance(lastHeartbeat + 30_000 - clock.now());
  assert.equal(b.view.role, "reader", "not before 30 s without a heartbeat");
  await clock.advance(1);
  assert.equal(b.view.role, "owner", "tab B gains write ownership no more than 30 s after tab A's last heartbeat");
});

test("Storage integrity and concurrency — Scenario: One bad element", async () => {
  const port = await web();
  const withAsset = addAsset(project(), { now_ms: NOW, newId: idSource() }, { id: "a1", name: "c.mp4", type: "video", size: 1, duration: 480_000 }).document;
  const record = JSON.parse(serializeProjectRecord(insertElement(withAsset, { now_ms: NOW, newId: idSource() }, "p1-track", clip("good", 0)).document));
  // One element that cannot be repaired: it names an asset that does not exist.
  record.scenes[0].tracks.main.elements.push({ ...record.scenes[0].tracks.main.elements[0], id: "bad", startTime: 240_000, mediaId: "missing" });
  record.local = "not an object";
  await port.writeProjectText("p1", JSON.stringify(record));
  const loaded = await loadProject(port, "p1");
  assert.deepEqual(loaded.document.scenes[0].tracks.main.elements.map((element) => element.id), ["good"], "the project opens without that element");
  assert.equal(loaded.repairs.filter((repair) => repair.kind === "removed-element").length, 1);
  assert.match(loaded.notice!, /^\d+ items were repaired or skipped while loading$/);
  assert.equal(typeof (loaded.document as { local?: unknown }).local, "object", "a malformed local section is reset to defaults and never fails a load");
  // A structural error that cannot be repaired fails the load and leaves the record alone.
  await port.writeProjectText("p2", JSON.stringify({ ...record, metadata: { ...record.metadata, id: "p2" }, scenes: "gone" }));
  await assert.rejects(() => loadProject(port, "p2"), (error) => isStorageError(error, "Corrupt"));
});
