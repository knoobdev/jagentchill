// Fakes declared: the stores are the ones of `support/platforms.ts` (fake-indexeddb and an in-memory OPFS for web, `node:sqlite` and `node:fs` drivers for mobile, the real desktop store in a temporary directory). Free space is a stubbed `available()` where a test needs an exact number of bytes.
import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalize, validateProjectDocument, type ClassicMediaRecord } from "@jagentchill/editor-core";
import {
  capacityMessage, evaluateStorageCapacity, formatBytes, loadProject, migrateV31toV32, migrationFailure, restoreBackup, runMigrations, STEP_V31_TO_V32, STEP_V32_TO_V33, type MigrationStep,
  type StoragePort,
} from "../src/index.ts";
import { platforms } from "./support/platforms.ts";

const NOW = 1_800_000_000_000, MiB = 1024 * 1024, GiB = 1024 * MiB;
const ids = () => { let count = 0; return () => `new${++count}`; };
const visual = { "transform.positionX": 0, "transform.positionY": 0, "transform.scaleX": 1, "transform.scaleY": 1, "transform.rotate": 0, opacity: 1, blendMode: "normal" };
const media: ClassicMediaRecord[] = [
  { id: "m1", name: "clip.mp4", type: "video", size: 1000, lastModified: 1_700_000_000_000, width: 1920, height: 1080, duration: 10 },
  { id: "m2", name: "photo.png", type: "image", size: 500, lastModified: 1_700_000_000_000, width: 800, height: 600, thumbnailUrl: "data:image/png;base64,iVBORw0KGgo=" },
];
/** A classic v31 project record in the shape classic stores (constructed from the classic type definitions). */
const classicProject = (id: string, elements: Record<string, unknown>[] = [], extra: Record<string, unknown> = {}) => ({
  version: 31, metadata: { id, name: `Classic ${id}`, duration: 240_000, createdAt: "2025-01-02T03:04:05.000Z", updatedAt: "2025-01-02T03:04:05.000Z" },
  settings: { fps: { numerator: 30, denominator: 1 }, canvasSize: { width: 1920, height: 1080 }, canvasSizeMode: "preset", background: { type: "color", color: "#000000" } },
  currentSceneId: "sc", timelineViewState: { zoomLevel: 1, scrollLeft: 0, playheadTime: 0 },
  scenes: [{ id: "sc", name: "Main scene", isMain: true, bookmarks: [], createdAt: "2025-01-02T03:04:05.000Z", updatedAt: "2025-01-02T03:04:05.000Z", tracks: { overlay: [], audio: [], main: { id: `${id}-main`, name: "Main Track", type: "video", muted: false, hidden: false, elements } } }],
  ...extra,
});
const video = (id: string, start: number, params: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({ id, type: "video", name: id, startTime: start, duration: 240_000, trimStart: 0, trimEnd: 0, sourceDuration: 240_000, mediaId: "m1", params: { ...visual, volume: 0, muted: false, ...params }, ...extra });
const text = (id: string, params: Record<string, unknown>) => ({ id, type: "text", name: id, startTime: 0, duration: 240_000, trimStart: 0, trimEnd: 0, params: { ...visual, content: "Hi", fontSize: 15, fontFamily: "Arial", color: "#ffffff", textAlign: "center", fontStyle: "normal", letterSpacing: 0, lineHeight: 1.2, ...params } });
const migrate = (record: unknown, records = media) => migrateV31toV32(record, records, { now_ms: NOW, newId: ids() });
const main = (document: any) => document.scenes[0].tracks.main.elements;
const runner = (port: StoragePort, steps: MigrationStep[] = [STEP_V31_TO_V32, STEP_V32_TO_V33]) => runMigrations(port, { steps, now: () => NOW, newId: ids(), mediaRecordsFor: async () => media });

// Requirement: Schema 32 migration
test("Schema 32 migration — Scenario: Classic params map becomes typed fields", () => {
  const params = { "transform.positionX": 120, "transform.scaleX": 1.5, "transform.rotate": 30, opacity: 0.8, volume: -6 };
  const [migrated] = main(migrate(classicProject("p", [{ ...video("v", 0), params, opacity: 1 }])).document);
  assert.deepEqual([migrated.transform.position.x, migrated.transform.scale.x, migrated.transform.rotation, migrated.opacity, migrated.volume], [120, 1.5, 30, 0.8, -6]);
  assert.equal("params" in migrated, false);
});

test("Schema 32 migration — Scenario: Negative static scale becomes a flip", () => {
  const [migrated] = main(migrate(classicProject("p", [video("v", 0, { "transform.scaleX": -1.5 })])).document);
  assert.deepEqual([migrated.transform.scale.x, migrated.flip], [1.5, { horizontal: true, vertical: false }]);
});

test("Schema 32 migration — Scenario: Mixed-sign scale animation is tolerated", () => {
  const key = (id: string, time: number, value: number) => ({ id, time, value, segmentToNext: "linear", tangentMode: "auto" });
  const { document } = migrate(classicProject("p", [video("v", 0, {}, { animations: { "transform.scaleX": { keys: [key("k1", 0, 1), key("k2", 240_000, -1)] } } })]));
  const [migrated] = main(document);
  assert.deepEqual(migrated.animations["transform.scale.x"].keys.map((entry: any) => entry.value), [1, -1], "unchanged key values on the renamed path");
  assert.equal(migrated.flip.horizontal, false);
  assert.deepEqual(validateProjectDocument(document).errors, []);
});

test("Schema 32 migration — Scenario: Bookmarks become markers", () => {
  const record = classicProject("p");
  (record.scenes[0] as any).bookmarks = [{ time: 360_000, note: "cut" }, { time: 120_000 }];
  const scene = migrate(record).document.scenes[0] as any;
  assert.equal("bookmarks" in scene, false);
  assert.deepEqual(scene.markers.map(({ id: _id, ...rest }: any) => rest), [{ time: 120_000, color: 1 }, { time: 360_000, note: "cut", color: 1 }]);
  assert.equal(new Set(scene.markers.map((marker: any) => marker.id)).size, 2, "two new ids");
});

test("Schema 32 migration — Scenario: Renamed track is pinned", () => {
  const record = classicProject("p") as any;
  record.scenes[0].tracks.overlay = [{ id: "t1", name: "B-roll", type: "video", muted: false, hidden: false, elements: [] }, { id: "t2", name: "Video track", type: "video", muted: false, hidden: false, elements: [] }];
  const [broll, plain] = migrate(record).document.scenes[0].tracks.overlay as any[];
  assert.deepEqual([broll.pinned, plain.pinned], [true, false]);
  for (const track of [broll, plain]) assert.deepEqual([track.transitions, track.solo, track.volume, track.pan], [[], false, 0, 0]);
});

test("Schema 32 migration — Scenario: Font weight and decoration", () => {
  const record = classicProject("p") as any;
  record.scenes[0].tracks.overlay = [{ id: "tt", name: "Text track", type: "text", hidden: false, elements: [
    text("a", { fontWeight: "bold", textDecoration: "none" }), { ...text("b", { fontWeight: "300", textDecoration: "none" }), startTime: 240_000 }, { ...text("c", { fontWeight: "heavy", textDecoration: "line-through" }), startTime: 480_000 },
  ] }];
  const [a, b, c] = (migrate(record).document.scenes[0].tracks.overlay[0] as any).elements;
  assert.deepEqual([a.fontWeight, b.fontWeight, c.fontWeight], [700, 300, 400]);
  assert.deepEqual([c.strikethrough, c.underline, "textDecoration" in c], [true, false, false]);
});

test("Schema 32 migration — Scenario: Media records enter the document", async () => {
  const port = await platforms()[1].open();
  const original = JSON.stringify(classicProject("p", [video("v", 0)]));
  await port.writeProjectText("p", original);
  const [outcome] = await runner(port);
  assert.equal(outcome.status, "migrated");
  const stored = JSON.parse(await port.readProjectText("p"));
  assert.deepEqual(stored.media.assets.map((asset: any) => asset.id), ["m1", "m2"], "sorted by id");
  assert.deepEqual(Object.values(stored.local.media).map((entry: any) => entry.storage), ["managed", "managed"]);
  assert.ok((await port.getBlob("thumbnail", "p", "m2.png"))!.length > 0, "one thumbnail blob exists");
  assert.equal(JSON.stringify(stored).includes("data:image"), false, "no data URL remains in the record");
  const [backup] = await port.listBackups("p");
  assert.equal((await port.readBackup("p", backup.name)).record, original, "the pre-migration backup still holds the original record");
});

test("Schema 32 migration — Scenario: Step fails closed", async () => {
  const port = await platforms()[0].open();
  const broken = JSON.stringify({ version: 31, metadata: { id: "bad", name: "Broken" }, scenes: "not an array" });
  await port.writeProjectText("bad", broken);
  const [outcome] = await runner(port);
  assert.deepEqual([outcome.status, (outcome as any).step], ["failed", "v31→v32"]);
  assert.equal(await port.readProjectText("bad"), broken, "the stored record is unchanged");
  assert.deepEqual((await migrationFailure(port, "bad"))!.step, "v31→v32", "the project is marked \"Migration failed\" with the failing step");
  assert.throws(() => migrate({ version: 31, metadata: { id: "x" }, scenes: 3 }), { name: "MigrationFailed" });
});

test("Schema 32 migration: the same fixture and id seed give identical bytes", () => {
  const record = classicProject("p", [video("v", 0, { customGlow: 1 })]);
  assert.equal(canonicalize(migrate(record).document), canonicalize(migrate(record).document));
});

// Requirement: Migration runner
test("Migration runner — Scenario: Migrated record is written to the right store", async () => {
  for (const platform of platforms()) {
    const port = await platform.open();
    await port.writeProjectText("p1", JSON.stringify(classicProject("p1", [video("v", 0)])));
    const outcomes = await runner(port);
    assert.deepEqual(outcomes.map((outcome) => [outcome.id, outcome.status]), [["p1", "migrated"]], platform.name);
    const record = await port.readProject("p1");
    assert.equal(record.schemaVersion, 33, "reading p1 from the projects store returns the project at the current version");
    assert.equal((await loadProject(port, "p1")).document.metadata.id, "p1");
    assert.equal((await port.listProjects())[0].schemaVersion, 33);
  }
});

test("Migration runner — Scenario: Failure isolation", async () => {
  const port = await platforms()[2].open();
  const records = ["a", "b", "c"].map((id) => [id, JSON.stringify({ ...classicProject(id, [video("v", 0)]), version: 21 })] as const);
  for (const [id, text] of records) await port.writeProjectText(id, text);
  // A chain from 21 to 31 of version bumps, in which the step v21→v22 throws for the second project.
  const chain: MigrationStep[] = Array.from({ length: 10 }, (_, index) => ({
    from: 21 + index, to: 22 + index, name: `v${21 + index}→v${22 + index}`,
    run(record) { if (index === 0 && (record.metadata as any).id === "b") throw new Error("animation bindings are malformed"); return { record: { ...record, version: 22 + index } }; },
  }));
  const outcomes = await runner(port, [...chain, STEP_V31_TO_V32, STEP_V32_TO_V33]);
  assert.deepEqual(outcomes.map((outcome) => [outcome.id, outcome.status]), [["a", "migrated"], ["b", "failed"], ["c", "migrated"]]);
  assert.deepEqual([(await port.readProject("a")).schemaVersion, (await port.readProject("c")).schemaVersion], [33, 33]);
  assert.equal(await port.readProjectText("b"), records[1][1], "byte-identical to its pre-run record");
  assert.deepEqual(await migrationFailure(port, "b"), { step: "v21→v22", error: "animation bindings are malformed", time_ms: NOW });
});

test("Migration runner — Scenario: Interrupted run", async () => {
  const port = await platforms()[1].open();
  for (const id of ["p1", "p2", "p3", "p4", "p5"]) await port.writeProjectText(id, JSON.stringify(classicProject(id, [video("v", 0)])));
  // The app is terminated after one of five projects was migrated …
  await runMigrations(port, { steps: [STEP_V31_TO_V32, STEP_V32_TO_V33], now: () => NOW, newId: ids(), mediaRecordsFor: async () => media, only: "p3" });
  const firstRecord = await port.readProjectText("p3");
  // … and restarted: the run is resumable and idempotent.
  const outcomes = await runner(port);
  assert.deepEqual(outcomes.map((outcome) => outcome.id).sort(), ["p1", "p2", "p4", "p5"], "the first is not processed again");
  assert.equal(await port.readProjectText("p3"), firstRecord);
  assert.deepEqual(await runner(port), [], "nothing left to migrate");
});

// Requirement: Backup before migration
test("Backup before migration — Scenario: Backup exists after migration", async () => {
  const port = await platforms()[0].open();
  const original = JSON.stringify({ ...classicProject("p", [video("v", 0, { customGlow: 2 })]), version: 20 });
  await port.writeProjectText("p", original);
  const bump: MigrationStep[] = Array.from({ length: 11 }, (_, index) => ({ from: 20 + index, to: 21 + index, name: `v${20 + index}→v${21 + index}`, run: (record) => ({ record: { ...record, version: 21 + index } }) }));
  const [outcome] = await runner(port, [...bump, STEP_V31_TO_V32, STEP_V32_TO_V33]);
  const [backup] = await port.listBackups("p");
  assert.deepEqual([backup.sourceVersion, backup.name, outcome.status], [20, `20-${NOW}`, "migrated"]);
  const stored = await port.readBackup("p", backup.name);
  assert.equal(stored.record, original, "equals the pre-migration record");
  assert.deepEqual(stored.report, [{ path: "/scenes/@sc/tracks/main/elements/@v", classicKey: "customGlow", reason: "unregistered" }], "the migration report is stored with the backup");
  assert.equal((outcome as any).notice, "1 items from the original project have no equivalent and were not migrated");
});

test("Backup before migration — Scenario: Restore", async () => {
  const port = await platforms()[1].open();
  const original = JSON.stringify(classicProject("p", [video("v", 0)]));
  await port.writeProjectText("p", original);
  await runner(port);
  const [backup] = await port.listBackups("p");
  await restoreBackup(port, "p", backup.name);
  assert.equal(await port.readProjectText("p"), original, "the stored record equals the backup, at its old version");
  assert.equal((await port.listProjects())[0].schemaVersion, 31);
  assert.deepEqual((await runner(port)).map((outcome) => outcome.status), ["migrated"], "the runner migrates it again on the next load");
});

test("Backup before migration — Scenario: No space for backup", async () => {
  const base = await platforms()[2].open();
  const original = JSON.stringify(classicProject("p", [video("v", 0)]));
  await base.writeProjectText("p", original);
  // Available storage after the reserve is smaller than the record.
  const port: StoragePort = Object.assign(Object.create(base), { available: async () => 5 * MiB + 100 });
  const [outcome] = await runner(port);
  assert.deepEqual([outcome.status, (outcome as any).message], ["no-space", "Not enough storage to update this project"]);
  assert.equal(await base.readProjectText("p"), original, "the project remains at its old version");
  assert.deepEqual(await base.listBackups("p"), []);
});

// Requirement: Quota evaluation
const withFree = (bytes: number | null) => ({ available: async () => bytes });

test("Quota evaluation — Scenario: Inside the reserve", async () => {
  const decision = await evaluateStorageCapacity(withFree(120 * MiB), 100 * MiB, { evictCache: async () => 0 });
  assert.deepEqual(decision, { allowed: false, required: 100 * MiB, available: 70 * MiB });
  assert.equal(capacityMessage("a.mov", decision as never).text, "Not enough storage for a.mov (100.0 MiB). 70.0 MiB available.");
  assert.deepEqual(await evaluateStorageCapacity(withFree(150 * MiB), 100 * MiB), { allowed: true });
});

test("Quota evaluation — Scenario: No estimate", async () => {
  assert.deepEqual(await evaluateStorageCapacity(withFree(null), 100 * GiB), { allowed: true });
});

test("Quota evaluation — Scenario: Record save under pressure", async () => {
  assert.deepEqual(await evaluateStorageCapacity(withFree(30 * MiB), 2 * MiB, { kind: "record" }), { allowed: true }, "a record may use the reserve");
  assert.equal((await evaluateStorageCapacity(withFree(30 * MiB), 2 * MiB)).allowed, false, "media may not");
});

test("Quota evaluation — Scenario: Record save at the floor", async () => {
  const decision = await evaluateStorageCapacity(withFree(6 * MiB), 2 * MiB, { kind: "record", evictCache: async () => 0 });
  assert.deepEqual(decision, { allowed: false, required: 2 * MiB, available: 1 * MiB }, "it would leave less than 5 MiB");
});

test("Quota evaluation — Scenario: Offer to empty the trash", async () => {
  const decision = await evaluateStorageCapacity(withFree(60 * MiB), 800 * MiB);
  assert.deepEqual(capacityMessage("b.mp4", decision as never, 3 * GiB).actions, ["Empty trash (3.0 GiB)", "Manage storage"]);
  assert.deepEqual(capacityMessage("b.mp4", decision as never).actions, ["Manage storage"]);
  assert.deepEqual([formatBytes(1536), formatBytes(5 * MiB), formatBytes(12 * GiB)], ["1.5 KiB", "5.0 MiB", "12.0 GiB"]);
});

test("Cache management — Scenario: Eviction before rejecting an import", async () => {
  // 300 MiB available after the reserve, 2 GiB of evictable cache: entries are evicted and the import is allowed.
  let free = 350 * MiB, evicted = 0;
  const port = { available: async () => free };
  const decision = await evaluateStorageCapacity(port, 800 * MiB, { evictCache: async (needed) => { evicted = needed; free += 2 * GiB; return 2 * GiB; } });
  assert.deepEqual([decision.allowed, evicted], [true, 500 * MiB]);
});
