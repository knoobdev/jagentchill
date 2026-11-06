// Cross-device sync, document side: operation log, revisions, snapshots, pushing, document kinds, access control and
// error codes. Devices are simulated (test/device-sim.ts) and the Gateway is the fake of test/harness.ts; the server
// app, its database and its blob directory are real.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { after, before, test } from "node:test";
import { PROJECT_SCHEMA_VERSION, SYNC_ERROR_CODES, SYNC_EVENTS, SYNC_METHODS, blobRoutes, type SyncPatchEntry } from "@jagentchill/protocol";
import { canonicalJson, documentHash } from "@jagentchill/editor-core";
import { createHarness, tick, type Harness } from "./harness.ts";
import { sampleDocument, sha256Hex, support, type Paired } from "./support/sync.ts";

let h: Harness, s: ReturnType<typeof support>;
let admin: Paired, editor: Paired, second: Paired, viewer: Paired;
const E1 = "/scenes/@s1/tracks/main/elements/@e1";

before(async () => {
  h = await createHarness();
  s = support(h);
  admin = await h.pair("Studio Mac", "admin");
  editor = await h.pair("Laptop", "editor");
  second = await h.pair("Phone", "editor");
  viewer = await h.pair("Client iPad", "viewer");
});
after(() => h.close());

/** A synced project whose lease `holder` has. */
async function editing(holder: Paired, name: string, elements = 2) {
  const doc = await s.enable(holder, sampleDocument(randomUUID(), name, elements));
  const { lease } = await holder.call("jagentchill.sync.lease.acquire", { doc });
  return { doc, leaseId: lease.leaseId as string };
}

test("Scenario: One command, one operation — one pushed operation raises the revision by exactly 1", async () => {
  const { doc, leaseId } = await editing(editor, "One command");
  const result = await editor.call("jagentchill.sync.ops.push", { doc, leaseId, baseRevision: 1, ops: s.ops(1) });
  assert.deepEqual(result, { revisions: [2], head: 2 });
  const { ops } = await editor.call("jagentchill.sync.ops.pull", { doc, afterRevision: 1 });
  assert.equal(ops.length, 1);
  assert.deepEqual([ops[0].revision, ops[0].baseRevision, ops[0].author], [2, 1, { kind: "device", deviceId: editor.device.deviceId }]);
  assert.deepEqual(Object.keys(ops[0]).sort(), ["author", "baseRevision", "commandType", "created_ms", "doc", "label", "opId", "patches", "revision", "schemaVersion"]);
});

test("Scenario: Undo is an operation — the patches that restore the previous state are a new revision; history is never rewritten", async () => {
  const { doc, leaseId } = await editing(editor, "Undo");
  await editor.call("jagentchill.sync.ops.push", { doc, leaseId, baseRevision: 1, ops: [s.op([{ op: "replace", path: `${E1}/opacity`, value: 0.4 }])] });
  const undo = await editor.call("jagentchill.sync.ops.push", { doc, leaseId, baseRevision: 2, ops: [s.op([{ op: "replace", path: `${E1}/opacity`, value: 1 }], { commandType: "history.undo", label: "Undo Change opacity" })] });
  assert.deepEqual(undo, { revisions: [3], head: 3 });
  assert.equal(s.headDocument(doc).scenes[0].tracks.main.elements[0].opacity, 1);
  assert.equal((await editor.call("jagentchill.sync.ops.pull", { doc, afterRevision: 1 })).ops.length, 2);
});

test("Scenario: Applier does not run commands — an operation of an unknown command type is stored by its patches and keeps its label", async () => {
  const { doc, leaseId } = await editing(editor, "Unknown command");
  await editor.call("jagentchill.sync.ops.push", { doc, leaseId, baseRevision: 1, ops: [s.op([{ op: "add", path: `${E1}/speedCurve`, value: { points: [0, 0.25, 1] } }], { commandType: "clip.speedCurve.set", label: "Speed curve" })] });
  assert.deepEqual(s.headDocument(doc).scenes[0].tracks.main.elements[0].speedCurve, { points: [0, 0.25, 1] });
  const { ops } = await viewer.call("jagentchill.sync.ops.pull", { doc, afterRevision: 1 });
  assert.deepEqual([ops[0].commandType, ops[0].label], ["clip.speedCurve.set", "Speed curve"]);
});

test("Scenario: Concurrent-safe addressing by id — an insert before @e4 and a replace on @e9 reach the intended members whatever the positions", async () => {
  const { doc, leaseId } = await editing(editor, "By id", 9);
  // The overlay track is not sorted by start time, so `before` places the new member.
  await editor.call("jagentchill.sync.ops.push", { doc, leaseId, baseRevision: 1, ops: [s.op([{ op: "add", path: "/scenes/@s1/tracks/overlay/@t1", value: { id: "t1", elements: [] } }, { op: "add", path: "/scenes/@s1/tracks/overlay/@t0", value: { id: "t0", elements: [] }, before: "@t1" }])] });
  await editor.call("jagentchill.sync.ops.push", { doc, leaseId, baseRevision: 2, ops: [
    s.op([{ op: "add", path: "/scenes/@s1/tracks/main/elements/@n1", value: { id: "n1", startTime: 300000, duration: 10, opacity: 1 } }]),
    s.op([{ op: "replace", path: "/scenes/@s1/tracks/main/elements/@e9/opacity", value: 0.5 }]),
  ] });
  const document = s.headDocument(doc), elements = document.scenes[0].tracks.main.elements;
  assert.deepEqual(document.scenes[0].tracks.overlay.map((track: any) => track.id), ["t0", "t1"]);
  assert.equal(elements.find((element: any) => element.id === "e9").opacity, 0.5);
  assert.equal(elements.findIndex((element: any) => element.id === "n1"), 3, "placed by the array's canonical order, before e4");
});

test("Scenario: Device-local path pushed — a patch under /local is refused with PATCH_INVALID and nothing is stored", async () => {
  const { doc, leaseId } = await editing(editor, "Local path");
  const bad = s.op([{ op: "replace", path: "/local/timelineViewState/zoom", value: 2 }]);
  const error = await editor.fail("jagentchill.sync.ops.push", { doc, leaseId, baseRevision: 1, ops: [...s.ops(1), bad] });
  assert.equal(error.code, "PATCH_INVALID");
  assert.deepEqual(error.details, { opId: bad.opId, index: 0, documentCode: "document/patch-invalid" });
  assert.equal(s.head(doc), 1);
  assert.equal((await editor.fail("jagentchill.sync.ops.pull", { doc, afterRevision: 0 })).code, "SNAPSHOT_REQUIRED", "no operation was stored");
});

test("Scenario: Invalid patch — a replace under a scene that does not exist refuses the whole batch and head is unchanged", async () => {
  const { doc, leaseId } = await editing(editor, "Invalid patch");
  const bad = s.op([{ op: "replace", path: `${E1}/opacity`, value: 0.2 }, { op: "replace", path: "/scenes/@s9/name", value: "x" }]);
  const error = await editor.fail("jagentchill.sync.ops.push", { doc, leaseId, baseRevision: 1, ops: [bad] });
  assert.equal(error.code, "PATCH_INVALID");
  assert.deepEqual(error.details, { opId: bad.opId, index: 1, documentCode: "document/patch-invalid" });
  assert.equal(s.head(doc), 1);
  assert.equal(s.headDocument(doc).scenes[0].tracks.main.elements[0].opacity, 1);
  // The other invalid forms of the state patch format are refused the same way.
  const invalidPatches: SyncPatchEntry[][] = [
    [{ op: "add", path: "/scenes/@s1", value: { id: "s1" } }], [{ op: "add", path: "/scenes/@s2", value: { id: "other" } }],
    [{ op: "remove", path: "/scenes/@s1/tracks/main/elements/@nope" }], [{ op: "replace", path: "/metadata/missing", value: 1 }],
  ];
  for (const patches of invalidPatches) assert.equal((await editor.fail("jagentchill.sync.ops.push", { doc, leaseId, baseRevision: 1, ops: [s.op(patches)] })).code, "PATCH_INVALID");
});

test("Scenario: Deterministic application — a snapshot and 500 recorded operations give the same canonical SHA-256 on the server as an independent application", async () => {
  const { doc, leaseId } = await editing(editor, "Deterministic", 4);
  let local = sampleDocument(doc.id, "Deterministic", 4);
  const { applyPatch } = await import("@jagentchill/editor-core");
  for (let batch = 0; batch < 5; batch++) {
    const ops = Array.from({ length: 100 }, (_, index) => {
      const n = batch * 100 + index, target = `e${(n % 4) + 1}`;
      return s.op(n % 7 === 0
        ? [{ op: "add", path: `/scenes/@s1/tracks/main/elements/@x${n}`, value: { id: `x${n}`, startTime: n * 1000 + 0.125, duration: 1000, opacity: 0.333333 } }]
        : [{ op: "replace", path: `/scenes/@s1/tracks/main/elements/@${target}/opacity`, value: Math.round((n / 500) * 1e6) / 1e6 }, { op: "replace", path: "/metadata/updated_ms", value: n }]);
    });
    for (const op of ops) local = applyPatch(local, op.patches as never);
    await editor.call("jagentchill.sync.ops.push", { doc, leaseId, baseRevision: 1 + batch * 100, ops });
  }
  assert.equal(s.head(doc), 501);
  assert.equal(documentHash(s.headDocument(doc)), documentHash(local));
  // The snapshot a new device downloads is that same canonical form. (V8 here; JavaScriptCore and Hermes run the same pure TypeScript applier in the app.)
  await editor.call("jagentchill.sync.lease.release", { doc, leaseId });
  const info = await viewer.call("jagentchill.sync.project.get", { doc });
  assert.equal(info.snapshot.revision, 501);
  const fetched = await s.send(viewer, "GET", blobRoutes.bytes(info.snapshot.sha256));
  assert.equal(sha256Hex(fetched.body), info.snapshot.sha256);
  assert.equal(gunzipSync(fetched.body).toString("utf8"), canonicalJson(local));
});

test("Scenario: Snapshot cadence by count — 200 operations after a snapshot at revision 400 give a snapshot at revision 600", async () => {
  const { doc, leaseId } = await editing(editor, "Cadence");
  // 399 operations: snapshots at revisions 1 (enable), 201 and 400 would need a snapshot at 400 — taken by releasing the lease there.
  for (let pushed = 0; pushed < 399; pushed += 57) await editor.call("jagentchill.sync.ops.push", { doc, leaseId, baseRevision: 1 + pushed, ops: s.ops(57, pushed) });
  assert.equal(s.head(doc), 400);
  await editor.call("jagentchill.sync.lease.release", { doc, leaseId });
  const again = (await editor.call("jagentchill.sync.lease.acquire", { doc })).lease.leaseId;
  const revisions = () => (h.app.db.prepare("SELECT revision FROM sync_snapshots WHERE kind = 'project' AND id = ? ORDER BY revision").all(doc.id) as { revision: number }[]).map((row) => row.revision);
  assert.deepEqual(revisions(), [1, 201, 400]);
  // 250 more in batches that do not end on 600: the snapshot is still at exactly 600.
  for (let pushed = 0; pushed < 250; pushed += 50) await editor.call("jagentchill.sync.ops.push", { doc, leaseId: again, baseRevision: 400 + pushed, ops: s.ops(50, pushed) });
  await editor.call("jagentchill.sync.ops.push", { doc, leaseId: again, baseRevision: 650, ops: s.ops(90) });
  assert.deepEqual(revisions(), [1, 201, 400, 600]);
  assert.ok(s.eventsOf(editor, "jagentchill.sync.snapshot").some((event) => event.doc.id === doc.id && event.revision === 600));
});

test("Scenario: Snapshot retention — of 25 automatic snapshots and 2 named versions the 5 oldest automatic ones and the operations before the oldest retained one are deleted", async () => {
  const { doc } = await editing(editor, "Retention");
  let leaseId = (await editor.call("jagentchill.sync.lease.acquire", { doc })).lease.leaseId, base = 1;
  const versions: string[] = [];
  // Each release with operations pending takes one automatic snapshot: 24 of them after the one of revision 1.
  for (let round = 0; round < 24; round++) {
    await editor.call("jagentchill.sync.ops.push", { doc, leaseId, baseRevision: base, ops: s.ops(2, round) });
    base += 2;
    if (round === 0 || round === 1) versions.push((await editor.call("jagentchill.sync.version.create", { doc, name: `Rough cut v${round + 1}`, idempotencyKey: randomUUID() })).versionId);
    await editor.call("jagentchill.sync.lease.release", { doc, leaseId });
    leaseId = (await editor.call("jagentchill.sync.lease.acquire", { doc })).lease.leaseId;
  }
  const snapshots = (h.app.db.prepare("SELECT revision FROM sync_snapshots WHERE kind = 'project' AND id = ? ORDER BY revision").all(doc.id) as { revision: number }[]).map((row) => row.revision);
  assert.equal(snapshots.length, 20);
  assert.equal(snapshots[0], 11, "revisions 1, 3, 5, 7 and 9 were the five oldest");
  const oldestOp = (h.app.db.prepare("SELECT MIN(revision) AS revision FROM sync_ops WHERE kind = 'project' AND id = ?").get(doc.id) as { revision: number }).revision;
  assert.equal(oldestOp, 12);
  const kept = (await editor.call("jagentchill.sync.version.list", { doc })).versions;
  assert.deepEqual(kept.map((version: any) => version.name).sort(), ["Rough cut v1", "Rough cut v2"]);
  for (const version of kept) assert.equal((await s.send(editor, "GET", blobRoutes.status(version.sha256))).body.state, "complete", "a named version keeps its snapshot");
  assert.deepEqual(versions.sort(), kept.map((version: any) => version.versionId).sort());

  // Scenario: Catch-up needs a snapshot — a pull from before the oldest retained operation names the nearest snapshot at or below head.
  const error = await viewer.fail("jagentchill.sync.ops.pull", { doc, afterRevision: 4 });
  assert.equal(error.code, "SNAPSHOT_REQUIRED");
  assert.equal(error.details.revision, 49);
  assert.equal(s.head(doc), 49);
});

test("Scenario: Large paste committed as a snapshot — a batch too large for a push is refused there and committed as one revision that viewers fetch", async () => {
  const { doc, leaseId } = await editing(editor, "Large paste");
  await viewer.call("jagentchill.sync.subscribe", { doc });
  const big = sampleDocument(doc.id, "Large paste", 2000);
  const patches = big.scenes[0].tracks.main.elements.slice(2).map((element: any) => ({ op: "add", path: `/scenes/@s1/tracks/main/elements/@${element.id}`, value: { ...element, note: "x".repeat(700) } }));
  assert.ok(JSON.stringify(patches).length > 1_500_000);
  // Larger than a channel frame, so the push cannot even be sent; a batch between the two limits is refused by the server.
  const medium = s.op(patches.slice(0, 520));
  assert.equal((await editor.fail("jagentchill.sync.ops.push", { doc, leaseId, baseRevision: 1, ops: [medium] })).code, "PAYLOAD_TOO_LARGE");
  assert.equal((await editor.fail("jagentchill.sync.ops.push", { doc, leaseId, baseRevision: 1, ops: s.ops(101) })).code, "PAYLOAD_TOO_LARGE");
  const sha256 = await s.snapshot(editor, big);
  const committed = await editor.call("jagentchill.sync.snapshot.commit", { doc, leaseId, baseRevision: 1, sha256, commandType: "clipboard.paste", label: "Paste 1998 elements", idempotencyKey: randomUUID() });
  assert.deepEqual(committed, { revision: 2, head: 2 });
  await tick();
  const [announced] = s.eventsOf(viewer, "jagentchill.sync.snapshot").filter((event) => event.doc.id === doc.id);
  assert.deepEqual([announced.revision, announced.sha256, announced.label], [2, sha256, "Paste 1998 elements"]);
  const { ops } = await viewer.call("jagentchill.sync.ops.pull", { doc, afterRevision: 1 });
  assert.deepEqual([ops.length, ops[0].patches.length, ops[0].snapshot.sha256], [1, 0, sha256]);
  assert.equal(s.headDocument(doc).scenes[0].tracks.main.elements.length, 2000);
  assert.equal((await editor.fail("jagentchill.sync.snapshot.commit", { doc, leaseId, baseRevision: 1, sha256, commandType: "x", label: "x", idempotencyKey: randomUUID() })).code, "REVISION_CONFLICT");
});

test("Scenario: Batch accepted, Scenario: Duplicate delivery, Scenario: Revision conflict — revisions 42 to 44, the same again for the same batch, and REVISION_CONFLICT with details.head", async () => {
  const { doc, leaseId } = await editing(editor, "Batch");
  await second.call("jagentchill.sync.subscribe", { doc });
  await editor.call("jagentchill.sync.ops.push", { doc, leaseId, baseRevision: 1, ops: s.ops(40) });
  assert.equal(s.head(doc), 41);
  const batch = s.ops(3);
  assert.deepEqual(await editor.call("jagentchill.sync.ops.push", { doc, leaseId, baseRevision: 41, ops: batch }), { revisions: [42, 43, 44], head: 44 });
  // The answer was lost and the batch is sent again.
  assert.deepEqual(await editor.call("jagentchill.sync.ops.push", { doc, leaseId, baseRevision: 41, ops: batch }), { revisions: [42, 43, 44], head: 44 });
  assert.equal(s.head(doc), 44);
  await tick();
  const published = s.eventsOf(second, "jagentchill.sync.ops").filter((event) => event.doc.id === doc.id).flatMap((event) => event.ops.map((op: any) => op.revision));
  assert.deepEqual(published, Array.from({ length: 43 }, (_, index) => index + 2), "each accepted operation is published once");
  assert.equal(s.eventsOf(editor, "jagentchill.sync.ops").filter((event) => event.doc.id === doc.id).length, 0, "the writer is not sent its own operations");

  const conflict = await editor.fail("jagentchill.sync.ops.push", { doc, leaseId, baseRevision: 41, ops: s.ops(1) });
  assert.equal(conflict.code, "REVISION_CONFLICT");
  assert.deepEqual(conflict.details, { head: 44 });
  assert.equal(s.head(doc), 44, "no operation was stored");
});

test("Scenario: Push without the lease, Scenario: Viewer reads but cannot push, Scenario: Viewer pulls operations, Scenario: Viewer requests the lease", async () => {
  const { doc, leaseId } = await editing(editor, "Access");
  await editor.call("jagentchill.sync.ops.push", { doc, leaseId, baseRevision: 1, ops: s.ops(2) });
  const refused = await second.fail("jagentchill.sync.ops.push", { doc, leaseId, baseRevision: 3, ops: s.ops(1) });
  assert.equal(refused.code, "LEASE_NOT_HELD");
  assert.equal(s.head(doc), 3);

  assert.equal((await viewer.call("jagentchill.sync.ops.pull", { doc, afterRevision: 1 })).ops.length, 2);
  const push = await viewer.fail("jagentchill.sync.ops.push", { doc, leaseId, baseRevision: 3, ops: s.ops(1) });
  assert.deepEqual([push.code, push.details.requiredScope], ["SCOPE_DENIED", "jagentchill.projects.write"]);
  const acquire = await viewer.fail("jagentchill.sync.lease.acquire", { doc });
  assert.deepEqual([acquire.code, acquire.details.requiredScope], ["SCOPE_DENIED", "jagentchill.projects.write"]);

  // Scenario: Viewer cannot enable sync — enabling needs jagentchill.projects.write, and so does uploading the snapshot.
  const enable = await viewer.fail("jagentchill.sync.doc.enable", { doc: { kind: "project", id: randomUUID() }, sha256: "0".repeat(64), schemaVersion: 32, idempotencyKey: randomUUID() });
  assert.deepEqual([enable.code, enable.details.requiredScope], ["SCOPE_DENIED", "jagentchill.projects.write"]);
  const init = await s.send(viewer, "POST", blobRoutes.init("0".repeat(64)), { size: 1, mime: "a/b", name: "x", chunkSize: 4194304 });
  assert.deepEqual([init.status, init.body.error.code, init.body.error.details.requiredScope], [403, "SCOPE_DENIED", "jagentchill.media.write"]);
});

test("Scenario: Push while host storage is full — operations are accepted when the blob quota is exhausted", async () => {
  const small = await createHarness({ sync: { quotaBytes: () => 1024 } });
  try {
    const t = support(small), device = await small.pair("Laptop", "editor");
    const doc = await t.enable(device, sampleDocument(randomUUID()));
    const full = await t.send(device, "POST", blobRoutes.init("1".repeat(64)), { size: 4096, mime: "video/mp4", name: "clip.mp4", chunkSize: 4194304 });
    assert.deepEqual([full.status, full.body.error.code, full.body.error.details.reason, full.body.error.details.availableBytes], [507, "QUOTA_EXCEEDED", "quota", 1024]);
    const { lease } = await device.call("jagentchill.sync.lease.acquire", { doc });
    assert.deepEqual(await device.call("jagentchill.sync.ops.push", { doc, leaseId: lease.leaseId, baseRevision: 1, ops: t.ops(2) }), { revisions: [2, 3], head: 3 });
  } finally { small.close(); }
});

test("Scenario: Script uses the lease, Scenario: Unsynced script, Scenario: Workflow does not use the lease", async () => {
  const script = { id: randomUUID(), schemaVersion: 1, title: "Episode 1", blocks: [{ id: "b1", text: "INT. KITCHEN" }] };
  const unsynced = await editor.fail("jagentchill.sync.ops.pull", { doc: { kind: "script", id: script.id }, afterRevision: 0 });
  assert.equal(unsynced.code, "SCRIPT_NOT_SYNCED");
  assert.equal((await editor.fail("jagentchill.sync.ops.pull", { doc: { kind: "project", id: randomUUID() }, afterRevision: 0 })).code, "PROJECT_NOT_SYNCED");

  const doc = await s.enable(editor, script, "script");
  const info = await editor.call("jagentchill.sync.doc.get", { doc });
  assert.deepEqual([info.kind, info.name, info.head, info.schemaVersion, info.maxSchemaVersion], ["script", "Episode 1", 1, 1, 1]);
  const { lease } = await editor.call("jagentchill.sync.lease.acquire", { doc });
  const held = await second.fail("jagentchill.sync.lease.acquire", { doc });
  assert.deepEqual([held.code, held.details.holderName], ["LEASE_HELD", "Laptop"]);
  await editor.call("jagentchill.sync.ops.push", { doc, leaseId: lease.leaseId, baseRevision: 1, ops: [s.op([{ op: "replace", path: "/blocks/0/text", value: "INT. KITCHEN — NIGHT" }], { schemaVersion: 1 })] });
  assert.deepEqual((await second.call("jagentchill.sync.doc.list", { kind: "script" })).items.map((item: any) => [item.name, item.head]), [["Episode 1", 2]]);

  // Scenario: Script batch is compared with the script maximum — schema 2 is refused although it is below the project maximum.
  const tooNew = await editor.fail("jagentchill.sync.ops.push", { doc, leaseId: lease.leaseId, baseRevision: 2, ops: [s.op([{ op: "replace", path: "/title", value: "x" }], { schemaVersion: 2 })] });
  assert.deepEqual([tooNew.code, tooNew.details], ["SCHEMA_TOO_NEW", { kind: "script", max: 1 }]);

  for (const method of ["jagentchill.sync.lease.acquire", "jagentchill.sync.doc.get", "jagentchill.sync.subscribe"]) {
    assert.equal((await editor.fail(method, { doc: { kind: "workflow", id: "wf-1" } })).code, "INVALID_PARAMS", method);
  }
});

test("Scenario: Phone updated before the host — nothing with a newer schema is stored and the project on the host stays at its schema", async () => {
  const { doc, leaseId } = await editing(second, "Skew");
  const refused = await second.fail("jagentchill.sync.ops.push", { doc, leaseId, baseRevision: 1, ops: [s.op([{ op: "replace", path: "/schemaVersion", value: PROJECT_SCHEMA_VERSION + 1 }], { schemaVersion: PROJECT_SCHEMA_VERSION + 1 })] });
  assert.deepEqual([refused.code, refused.details], ["SCHEMA_TOO_NEW", { kind: "project", max: PROJECT_SCHEMA_VERSION }]);
  const snapshot = await s.snapshot(second, { ...sampleDocument(doc.id), schemaVersion: PROJECT_SCHEMA_VERSION + 1 });
  assert.equal((await second.fail("jagentchill.sync.snapshot.commit", { doc, leaseId, baseRevision: 1, sha256: snapshot, schemaVersion: PROJECT_SCHEMA_VERSION + 1, commandType: "migrate", label: "Migrate", idempotencyKey: randomUUID() })).code, "SCHEMA_TOO_NEW");
  const info = await second.call("jagentchill.sync.project.get", { doc });
  assert.deepEqual([info.head, info.schemaVersion, info.maxSchemaVersion, info.kind], [1, sampleDocument(doc.id).schemaVersion, PROJECT_SCHEMA_VERSION, "project"]);
  assert.equal((await second.fail("jagentchill.sync.doc.enable", { doc: { kind: "project", id: randomUUID() }, sha256: snapshot, schemaVersion: PROJECT_SCHEMA_VERSION + 1, idempotencyKey: randomUUID() })).code, "SCHEMA_TOO_NEW");
});

test("Scenario: Older device after the push, Scenario: Additive schema step — a host that understands schema 34", async () => {
  const next = await createHarness({ sync: { maxSchemaVersion: { project: 34, script: 1, workflow: 1 } } });
  try {
    const t = support(next), laptop = await next.pair("Laptop", "editor"), tablet = await next.pair("Tablet", "editor");
    const extra = laptop.device.connect(laptop.offer as never);
    assert.deepEqual((await extra.outcome).ready.maxSchemaVersion, { project: 34, script: 1, workflow: 1 });
    extra.ws.terminate();
    // The document is at schema 34 and declares that a schema-33 app can still read and write it.
    const document = { ...sampleDocument(randomUUID()), schemaVersion: 34, minReaderSchemaVersion: 33, futureField: { added: "by schema 34", order: [3, 1, 2] } };
    const doc = await t.enable(laptop, document);
    const { lease } = await laptop.call("jagentchill.sync.lease.acquire", { doc, supportedSchemaVersion: 33 });
    // The schema-33 app pushes at the document's schema, not its own, and the fields it does not know are untouched.
    await laptop.call("jagentchill.sync.ops.push", { doc, leaseId: lease.leaseId, baseRevision: 1, ops: [t.op([{ op: "replace", path: "/scenes/@s1/tracks/main/elements/@e1/startTime", value: 5000 }], { schemaVersion: 34 })] });
    assert.equal(canonicalJson(t.headDocument(doc).futureField), canonicalJson(document.futureField));
    assert.equal((await laptop.call("jagentchill.sync.project.get", { doc })).schemaVersion, 34);
    await laptop.call("jagentchill.sync.lease.release", { doc, leaseId: lease.leaseId });

    // The tablet's app supports schema 32 only: it reads the document and is never given the lease.
    const info = await tablet.call("jagentchill.sync.project.get", { doc });
    assert.deepEqual([info.schemaVersion, info.minReaderSchemaVersion], [34, 33]);
    const refused = await tablet.fail("jagentchill.sync.lease.acquire", { doc, supportedSchemaVersion: 32 });
    assert.deepEqual([refused.code, refused.details.minReaderSchemaVersion], ["SCHEMA_TOO_NEW", 33]);
    assert.equal(next.app.sync.leases.current(doc), null);
    // Without the parameter the host uses what the device last reported in presence.
    await tablet.call("jagentchill.presence.heartbeat", { deviceType: "tablet", appVisible: true, supportedSchemaVersion: { project: 32, script: 1, workflow: 1 }, lastActivity_ms: Date.now() });
    assert.equal((await tablet.fail("jagentchill.sync.lease.acquire", { doc })).code, "SCHEMA_TOO_NEW");

    // Scenario: Confirmation before a schema-raising push — the host reports which paired devices support only a lower schema.
    const { devices } = await laptop.call("jagentchill.presence.list", {});
    assert.deepEqual(devices.filter((entry: any) => entry.supportedSchemaVersion.project < 33).map((entry: any) => entry.deviceName), ["Tablet"]);
  } finally { next.close(); }
});

test("Scenario: Method outside the list — sync, blob, trash, comment, presence and media methods match the declared surface and scopes", () => {
  const domains = /^jagentchill\.(sync|blob|trash|comment|presence|media)\./;
  const registered = [...h.app.methods.keys()].filter((name) => domains.test(name)).sort();
  assert.deepEqual(registered, Object.keys(SYNC_METHODS).sort());
  for (const [name, scope] of Object.entries(SYNC_METHODS)) assert.equal(h.app.methods.get(name)!.scope, scope, name);
  // A handler added outside the surface is named by this comparison.
  const extra = [...registered, "jagentchill.sync.project.subscribe"].filter((name) => !(name in SYNC_METHODS));
  assert.deepEqual(extra, ["jagentchill.sync.project.subscribe"]);
  assert.equal(SYNC_EVENTS.length, 7);
  assert.equal(SYNC_ERROR_CODES.length, 18);
});

test("Scenario: Project in trash, Scenario: Return after purge — a push to a trashed project answers PROJECT_IN_TRASH and to a purged one PROJECT_PURGED", async () => {
  const { doc, leaseId } = await editing(editor, "Trashed");
  await editor.call("jagentchill.sync.lease.release", { doc, leaseId });
  assert.deepEqual(await second.call("jagentchill.sync.doc.disable", { doc, removeHostCopy: true, trash: true }), { removed: true, trashed: true });
  const trashed = await editor.fail("jagentchill.sync.ops.push", { doc, leaseId, baseRevision: 1, ops: s.ops(1) });
  assert.deepEqual([trashed.code, trashed.details.deletedByName], ["PROJECT_IN_TRASH", "Phone"]);
  assert.equal((await editor.fail("jagentchill.sync.project.get", { doc })).code, "PROJECT_IN_TRASH");
  await admin.call("jagentchill.trash.purge", { kind: "project", id: doc.id });
  for (const [method, params] of [["jagentchill.sync.ops.pull", { doc, afterRevision: 0 }], ["jagentchill.sync.project.get", { doc }], ["jagentchill.sync.lease.acquire", { doc }]] as const) {
    assert.equal((await editor.fail(method, params)).code, "PROJECT_PURGED", method);
  }
});
