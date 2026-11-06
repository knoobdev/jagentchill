// Cross-device sync, the host space: project listing, trash, named versions, conflict resolution on the host, review
// comments, presence, continuity and library items. Devices are simulated (test/device-sim.ts) and the clock is
// injected; the server app and its database are real.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { after, before, test } from "node:test";
import { blobRoutes } from "@jagentchill/protocol";
import { createHarness, tick, type Harness } from "./harness.ts";
import { sampleDocument, support, type Paired } from "./support/sync.ts";

let h: Harness, s: ReturnType<typeof support>;
let offset = 0;
const now = () => Date.now() + offset;
const DAY = 86_400_000;
const advance = async (ms: number) => { offset += ms; h.app.sync.sweep(); await tick(); };
let admin: Paired, desktop: Paired, phone: Paired, viewer: Paired;
const OPACITY = "/scenes/@s1/tracks/main/elements/@e1/opacity";
const presenceOf = (deviceType: string, over: Record<string, unknown> = {}) => ({ deviceType, appVisible: true, supportedSchemaVersion: { project: 32, script: 1, workflow: 1 }, lastActivity_ms: now(), ...over });

before(async () => {
  h = await createHarness({ now });
  s = support(h, now);
  admin = await h.pair("Studio Mac", "admin");
  desktop = await h.pair("Desktop", "editor");
  phone = await h.pair("Phone", "editor");
  viewer = await h.pair("Client iPad", "viewer");
});
after(() => h.close());
async function editing(holder: Paired, name: string) {
  const doc = await s.enable(holder, sampleDocument(randomUUID(), name));
  const { lease } = await holder.call("jagentchill.sync.lease.acquire", { doc });
  return { doc, leaseId: lease.leaseId as string };
}

test("Scenario: Browsing projects from a second device — a project synced from the desktop is listed with its cover, duration and the desktop's device name", async () => {
  const document = sampleDocument(randomUUID(), "Ha Giang loop vlog");
  document.cover = { image: { sha256: "9".repeat(64), mime: "image/jpeg" } };
  const doc = await s.enable(desktop, document);
  const { lease } = await desktop.call("jagentchill.sync.lease.acquire", { doc });
  await desktop.call("jagentchill.sync.ops.push", { doc, leaseId: lease.leaseId, baseRevision: 1, ops: s.ops(1) });
  const listed = await phone.call("jagentchill.sync.project.list", { search: "ha giang" });
  assert.equal(listed.total, 1);
  const [item] = listed.items;
  assert.deepEqual([item.doc, item.name, item.duration, item.coverSha256, item.lastAuthorName, item.head, item.lease.holderName], [doc, "Ha Giang loop vlog", 240000, "9".repeat(64), "Desktop", 2, "Desktop"]);
  // Lists page 50 at a time and sort by name, date and size.
  for (let index = 0; index < 51; index++) await s.enable(desktop, sampleDocument(randomUUID(), `Paged ${String(index).padStart(2, "0")}`));
  const first = await phone.call("jagentchill.sync.project.list", { search: "Paged", sort: "name" });
  assert.deepEqual([first.items.length, first.total, first.nextCursor, first.items[0].name], [50, 51, 50, "Paged 00"]);
  const rest = await phone.call("jagentchill.sync.project.list", { search: "Paged", sort: "name", cursor: first.nextCursor });
  assert.deepEqual([rest.items.map((entry: any) => entry.name), rest.nextCursor], [["Paged 50"], null]);
  assert.equal((await phone.fail("jagentchill.sync.project.list", { limit: 51 })).code, "INVALID_PARAMS");
});

test("Scenario: Delete while another device edits — the deletion is refused with a message naming the editing device", async () => {
  const { doc } = await editing(phone, "Being edited");
  const refused = await desktop.fail("jagentchill.sync.doc.disable", { doc, removeHostCopy: true, trash: true });
  assert.deepEqual([refused.code, refused.message, refused.details.holderName], ["CONFLICT", "Phone is editing this project", "Phone"]);
  assert.equal((await desktop.call("jagentchill.sync.project.get", { doc })).head, 1);
  // The holder itself may delete.
  assert.deepEqual(await phone.call("jagentchill.sync.doc.disable", { doc, removeHostCopy: true, trash: true }), { removed: true, trashed: true });
});

test("Scenario: Delete propagates, Scenario: Restore from trash, Scenario: Purge after retention, Scenario: Editor purges trash, Scenario: Purge needs the device-management scope", async () => {
  const bytes = new Uint8Array(3000).fill(4), sha256 = await s.upload(desktop, bytes);
  const document = sampleDocument(randomUUID(), "Hoi An lanterns");
  document.media.assets.push({ id: "a1", contentHash: sha256 });
  const { doc, leaseId } = await (async () => { const d = await s.enable(desktop, document); const { lease } = await desktop.call("jagentchill.sync.lease.acquire", { doc: d }); return { doc: d, leaseId: lease.leaseId }; })();
  await desktop.call("jagentchill.sync.ops.push", { doc, leaseId, baseRevision: 1, ops: s.ops(4) });
  await phone.call("jagentchill.sync.subscribe", { doc });
  await desktop.call("jagentchill.sync.doc.disable", { doc, removeHostCopy: true, trash: true });
  await tick();
  // The phone learns it from the lease event of its subscription and from its next sync call: "Deleted on <desktop name>".
  assert.equal(phone.events.filter((entry) => entry.event === "jagentchill.sync.lease" && entry.payload.doc.id === doc.id).at(-1)!.payload.lease, null);
  const deleted = await phone.fail("jagentchill.sync.project.get", { doc });
  assert.deepEqual([deleted.code, deleted.details.deletedByName], ["PROJECT_IN_TRASH", "Desktop"]);
  assert.equal((await phone.call("jagentchill.sync.project.list", { search: "Hoi An" })).total, 0);
  const [entry] = (await phone.call("jagentchill.trash.list", { kind: "project" })).entries.filter((item: any) => item.id === doc.id);
  assert.deepEqual([entry.kind, entry.name, entry.deletedByName, entry.purge_ms - entry.deleted_ms], ["project", "Hoi An lanterns", "Desktop", 30 * DAY]);

  const denied = await desktop.fail("jagentchill.trash.purge", { kind: "project", id: doc.id });
  assert.deepEqual([denied.code, denied.details.requiredScope], ["SCOPE_DENIED", "jagentchill.devices.manage"]);
  assert.equal((await viewer.fail("jagentchill.trash.restore", { kind: "project", id: doc.id })).code, "SCOPE_DENIED");

  await advance(10 * DAY);
  h.app.sync.storageSweep();
  assert.deepEqual(await phone.call("jagentchill.trash.restore", { kind: "project", id: doc.id }), { restored: true, head: 5 });
  const restored = await phone.call("jagentchill.sync.project.get", { doc });
  assert.deepEqual([restored.head, restored.name], [5, "Hoi An lanterns"]);
  assert.equal((await s.send(phone, "GET", blobRoutes.status(sha256))).body.state, "complete", "its media was kept while it lay in the trash");
  assert.equal((await phone.call("jagentchill.blob.get", { sha256 })).refCount, 1);

  // Trashed again and left for 31 days: purged with its operations and snapshots; the tombstone answers PROJECT_PURGED.
  await phone.call("jagentchill.sync.doc.disable", { doc, removeHostCopy: true, trash: true });
  await advance(31 * DAY);
  assert.equal(h.app.sync.storageSweep().purged >= 1, true);
  assert.equal((await phone.call("jagentchill.trash.list", {})).entries.some((item: any) => item.id === doc.id), false);
  assert.equal((await phone.fail("jagentchill.trash.restore", { kind: "project", id: doc.id })).code, "NOT_FOUND");
  assert.equal((await phone.fail("jagentchill.sync.ops.pull", { doc, afterRevision: 0 })).code, "PROJECT_PURGED");
  assert.equal((h.app.db.prepare("SELECT COUNT(*) AS n FROM sync_ops WHERE id = ?").get(doc.id) as { n: number }).n + (h.app.db.prepare("SELECT COUNT(*) AS n FROM sync_snapshots WHERE id = ?").get(doc.id) as { n: number }).n, 0);
});

test("Scenario: Restore from the host trash — a script deleted 3 days ago is back in Scripts at its last revision", async () => {
  const doc = await s.enable(desktop, { id: randomUUID(), schemaVersion: 1, title: "Episode 2", blocks: [] }, "script");
  await desktop.call("jagentchill.sync.doc.disable", { doc, removeHostCopy: true, trash: true });
  assert.deepEqual((await desktop.call("jagentchill.trash.list", { kind: "script" })).entries.map((entry: any) => [entry.kind, entry.name]), [["script", "Episode 2"]]);
  await advance(3 * DAY);
  await desktop.call("jagentchill.trash.restore", { kind: "script", id: doc.id });
  assert.deepEqual((await phone.call("jagentchill.sync.doc.list", { kind: "script" })).items.map((item: any) => [item.name, item.head]), [["Episode 2", 1]]);
  // Host-only kinds are sent to the trash by their owners inside the server; a client cannot invent one.
  assert.equal((await desktop.fail("jagentchill.trash.restore", { kind: "film", id: "film-1" })).code, "NOT_FOUND");
});

test("Scenario: Offline delete of a project that changed — a deletion recorded at base revision 80 is not applied when head is 85; Remove from host deletes only the server copy", async () => {
  const { doc, leaseId } = await editing(desktop, "Changed meanwhile");
  await desktop.call("jagentchill.sync.ops.push", { doc, leaseId, baseRevision: 1, ops: s.ops(84) });
  await desktop.call("jagentchill.sync.lease.release", { doc, leaseId });
  const refused = await phone.fail("jagentchill.sync.doc.disable", { doc, removeHostCopy: true, trash: true, baseRevision: 80 });
  assert.deepEqual([refused.code, refused.details.head], ["REVISION_CONFLICT", 85]);
  assert.equal((await phone.call("jagentchill.sync.project.get", { doc })).head, 85);
  // "Keep on host": the server copy stays at its last revision.
  assert.deepEqual(await phone.call("jagentchill.sync.doc.disable", { doc, removeHostCopy: false }), { removed: false });
  assert.equal((await desktop.call("jagentchill.sync.project.get", { doc })).head, 85);
  // "Remove from host": gone for good, not in the trash; every device's copy becomes "On this device only".
  assert.deepEqual(await phone.call("jagentchill.sync.doc.disable", { doc, removeHostCopy: true }), { removed: true, trashed: false });
  assert.equal((await desktop.fail("jagentchill.sync.project.get", { doc })).code, "PROJECT_PURGED");
  assert.equal((await desktop.call("jagentchill.trash.list", {})).entries.some((entry: any) => entry.id === doc.id), false);
  // The same id can be synced again and starts at revision 1.
  assert.equal((await s.enable(desktop, sampleDocument(doc.id, "Synced again"))).id, doc.id);
  assert.equal((await phone.call("jagentchill.sync.project.get", { doc })).head, 1);
});

test("Scenario: Restore, Scenario: Restore without the lease, Scenario: Version from another device — a named version is restored as a new revision", async () => {
  const { doc, leaseId } = await editing(desktop, "Versions");
  await viewer.call("jagentchill.sync.subscribe", { doc });
  await desktop.call("jagentchill.sync.ops.push", { doc, leaseId, baseRevision: 1, ops: [s.op([{ op: "replace", path: OPACITY, value: 0.25 }])] });
  const { versionId, version } = await desktop.call("jagentchill.sync.version.create", { doc, name: "Rough cut v1", idempotencyKey: "save-1" });
  assert.deepEqual([version.name, version.revision, version.authorName, version.source, version.expires_ms], ["Rough cut v1", 2, "Desktop", "user", null]);
  assert.equal((await desktop.call("jagentchill.sync.version.create", { doc, name: "Rough cut v1", idempotencyKey: "save-1" })).versionId, versionId, "the same call again creates nothing");
  await desktop.call("jagentchill.sync.ops.push", { doc, leaseId, baseRevision: 2, ops: s.ops(8) });
  // The phone lists it with the desktop's device badge.
  const listed = (await phone.call("jagentchill.sync.version.list", { doc })).versions;
  assert.deepEqual(listed.map((entry: any) => [entry.name, entry.revision, entry.authorName, entry.authorDeviceId]), [["Rough cut v1", 2, "Desktop", desktop.device.deviceId]]);
  assert.equal((await phone.fail("jagentchill.sync.version.create", { doc, name: "x".repeat(81), idempotencyKey: "long" })).code, "INVALID_PARAMS");
  assert.equal((await viewer.fail("jagentchill.sync.version.create", { doc, name: "Mine", idempotencyKey: "viewer" })).code, "SCOPE_DENIED");

  const withoutLease = await phone.fail("jagentchill.sync.version.restore", { versionId, leaseId });
  assert.equal(withoutLease.code, "LEASE_NOT_HELD");
  const restored = await desktop.call("jagentchill.sync.version.restore", { versionId, leaseId });
  assert.deepEqual([restored.revision, restored.head], [11, 11]);
  assert.equal(s.headDocument(doc).scenes[0].tracks.main.elements[0].opacity, 0.25, "head + 1 holds the state of the version");
  await tick();
  const announced = s.eventsOf(viewer, "jagentchill.sync.snapshot").filter((event) => event.doc.id === doc.id && event.revision === 11);
  assert.equal(announced.length, 1, "viewers are told and fetch the snapshot");
  assert.equal((await desktop.call("jagentchill.sync.ops.pull", { doc, afterRevision: 1 })).ops.length, 10, "history is never truncated");
  await phone.call("jagentchill.sync.version.rename", { versionId, name: "Rough cut (approved)" });
  assert.equal((await phone.call("jagentchill.sync.version.list", { doc })).versions[0].name, "Rough cut (approved)");
  await phone.call("jagentchill.sync.version.delete", { versionId });
  assert.deepEqual((await phone.call("jagentchill.sync.version.list", { doc })).versions, []);
});

test("Scenario: Keep this device's version — head 95 becomes 96 with the device's state and a version \"Replaced on …\" holds revision 95 for 30 days", async () => {
  const { doc, leaseId } = await editing(desktop, "Conflict");
  await desktop.call("jagentchill.sync.ops.push", { doc, leaseId, baseRevision: 1, ops: s.ops(94) });
  await desktop.call("jagentchill.sync.lease.release", { doc, leaseId });
  assert.equal(s.head(doc), 95);
  const hostState = JSON.stringify(s.headDocument(doc));
  // The phone edited offline from an older base and keeps its own state.
  const mine = sampleDocument(doc.id, "Conflict (phone edit)");
  const sha256 = await s.snapshot(phone, mine);
  // Scenario: Lease held by another device during choice (a) — without the lease nothing changes.
  const other = await desktop.call("jagentchill.sync.lease.acquire", { doc });
  assert.equal((await phone.fail("jagentchill.sync.conflict.resolve", { doc, choice: "keep-device", leaseId: other.lease.leaseId, head: 95, sha256, idempotencyKey: randomUUID() })).code, "LEASE_NOT_HELD");
  assert.equal((await phone.fail("jagentchill.sync.lease.acquire", { doc })).details.holderName, "Desktop");
  assert.equal(s.head(doc), 95);
  await desktop.call("jagentchill.sync.lease.release", { doc, leaseId: other.lease.leaseId });

  const { lease } = await phone.call("jagentchill.sync.lease.acquire", { doc });
  const resolved = await phone.call("jagentchill.sync.conflict.resolve", { doc, choice: "keep-device", leaseId: lease.leaseId, head: 95, sha256, idempotencyKey: "resolve-1" });
  assert.deepEqual([resolved.revision, resolved.head], [96, 96]);
  assert.equal(s.headDocument(doc).metadata.name, "Conflict (phone edit)");
  const [replaced] = (await desktop.call("jagentchill.sync.version.list", { doc })).versions;
  assert.match(replaced.name, /^Replaced on \d{4}-\d{2}-\d{2} by Phone$/);
  assert.deepEqual([replaced.revision, replaced.source, replaced.expires_ms - replaced.created_ms], [95, "conflict", 30 * DAY]);
  const kept = await s.send(desktop, "GET", blobRoutes.bytes(replaced.sha256));
  assert.equal(JSON.stringify(JSON.parse(gunzipSync(kept.body).toString("utf8"))), JSON.stringify(JSON.parse(hostState)), "the superseded head is recoverable");
  assert.equal((await phone.fail("jagentchill.sync.conflict.resolve", { doc, choice: "keep-device", leaseId: lease.leaseId, head: 95, sha256, idempotencyKey: randomUUID() })).code, "REVISION_CONFLICT");
  // A conflict version expires after 30 days unless it was renamed, which makes it permanent.
  const second = await editing(desktop, "Conflict 2");
  await desktop.call("jagentchill.sync.conflict.resolve", { doc: second.doc, choice: "keep-device", leaseId: second.leaseId, head: 1, sha256: await s.snapshot(desktop, sampleDocument(second.doc.id, "Mine")), idempotencyKey: randomUUID() });
  await desktop.call("jagentchill.sync.version.rename", { versionId: replaced.versionId, name: "Before the phone edit" });
  await advance(31 * DAY);
  assert.deepEqual((await desktop.call("jagentchill.sync.version.list", { doc })).versions.map((entry: any) => [entry.name, entry.expires_ms]), [["Before the phone edit", null]]);
  assert.deepEqual((await desktop.call("jagentchill.sync.version.list", { doc: second.doc })).versions, []);
});

test("Scenario: Viewer leaves a timed comment, Scenario: Resolve, Scenario: Comment too long, Scenario: Comment made offline", async () => {
  const { doc } = await editing(desktop, "Review");
  const target = { targetType: "project", targetId: doc.id };
  await desktop.call("jagentchill.comment.subscribe", target);
  const commentId = randomUUID();
  const create = { commentId, ...target, time_ticks: 12 * 120000 + 16000, point: { x: 0.4, y: 0.62 }, body: "Trim this pause", revision: 1, idempotencyKey: "c-1" };
  const made = (await viewer.call("jagentchill.comment.create", create)).comment;
  assert.deepEqual([made.body, made.time_ticks, made.point, made.authorName, made.authorDeviceId, made.resolved], ["Trim this pause", 1456000, { x: 0.4, y: 0.62 }, "Client iPad", viewer.device.deviceId, false]);
  await tick();
  const [event] = s.eventsOf(desktop, "jagentchill.comment.changed");
  assert.deepEqual([event.targetId, event.comment.commentId, event.comment.time_ticks], [doc.id, commentId, 1456000]);
  // Written offline and sent again on reconnect: stored once, whatever key the retry carries.
  await viewer.call("jagentchill.comment.create", create);
  await viewer.call("jagentchill.comment.create", { ...create, idempotencyKey: "c-1-retry" });
  assert.equal((await desktop.call("jagentchill.comment.list", target)).comments.length, 1);

  assert.equal((await viewer.fail("jagentchill.comment.create", { ...create, commentId: randomUUID(), body: "x".repeat(2001), idempotencyKey: "long" })).code, "INVALID_PARAMS");
  const reply = (await desktop.call("jagentchill.comment.create", { commentId: randomUUID(), ...target, body: "Done", parentId: commentId, idempotencyKey: "r-1" })).comment;
  assert.equal(reply.parentId, commentId);
  assert.equal((await phone.fail("jagentchill.comment.create", { commentId: randomUUID(), ...target, body: "Nested", parentId: reply.commentId, idempotencyKey: "r-2" })).code, "INVALID_PARAMS", "replies nest one level");

  // The author edits their own comment; a viewer cannot resolve; a device with write scope resolves and reopens any.
  assert.equal((await viewer.call("jagentchill.comment.update", { commentId, body: "Trim this pause (about 1 s)" })).comment.edited_ms > 0, true);
  assert.equal((await phone.fail("jagentchill.comment.update", { commentId, body: "x" })).code, "PERMISSION_DENIED");
  const denied = await viewer.fail("jagentchill.comment.resolve", { commentId, resolved: true });
  assert.deepEqual([denied.code, denied.details.requiredScope], ["SCOPE_DENIED", "jagentchill.projects.write"]);
  assert.equal((await desktop.call("jagentchill.comment.resolve", { commentId, resolved: true })).comment.resolved, true);
  const listed = (await phone.call("jagentchill.comment.list", target)).comments;
  assert.deepEqual(listed.filter((entry: any) => !entry.parentId).map((entry: any) => entry.resolved), [true], "it is under Resolved on every device");
  assert.equal((await viewer.fail("jagentchill.comment.delete", { commentId: reply.commentId })).code, "SCOPE_DENIED");
  await phone.call("jagentchill.comment.delete", { commentId });
  assert.deepEqual((await phone.call("jagentchill.comment.list", target)).comments, []);
  assert.equal(s.eventsOf(desktop, "jagentchill.comment.changed").at(-1).deletedId, commentId);
});

test("Scenario: Comment on a script — stored with targetType script and announced to the script's subscribers", async () => {
  const doc = await s.enable(desktop, { id: randomUUID(), schemaVersion: 1, title: "Pilot", blocks: [{ id: "b1", text: "FADE IN" }] }, "script");
  const target = { targetType: "script", targetId: doc.id };
  await phone.call("jagentchill.comment.subscribe", target);
  const made = (await viewer.call("jagentchill.comment.create", { commentId: randomUUID(), ...target, anchor: { blockId: "b1", from: 0, to: 4 }, body: "Too abrupt?", idempotencyKey: "s-1" })).comment;
  assert.deepEqual([made.targetType, made.anchor], ["script", { blockId: "b1", from: 0, to: 4 }]);
  await tick();
  assert.equal(s.eventsOf(phone, "jagentchill.comment.changed").at(-1).comment.targetType, "script");
  assert.equal((await viewer.fail("jagentchill.comment.create", { commentId: randomUUID(), targetType: "workflow", targetId: "w", body: "x", idempotencyKey: "w" })).code, "INVALID_PARAMS", "workflows have no review comments");
  assert.equal((await viewer.fail("jagentchill.comment.list", { targetType: "script", targetId: randomUUID() })).code, "SCRIPT_NOT_SYNCED");
});

test("Scenario: Second device joins, Scenario: Device leaves, Scenario: Single heartbeat — presence of an open document", async () => {
  const { doc } = await editing(desktop, "Presence");
  await desktop.call("jagentchill.presence.subscribe", { doc });
  await desktop.call("jagentchill.presence.heartbeat", presenceOf("desktop", { openDoc: doc, mode: "editing", sceneId: "s1", playhead_ticks: 0 }));
  await phone.call("jagentchill.presence.subscribe", { doc });
  await phone.call("jagentchill.presence.heartbeat", presenceOf("phone", { openDoc: doc, mode: "viewing", sceneId: "s1", playhead_ticks: 0 }));
  await tick();
  for (const device of [desktop, phone]) {
    const seen = s.eventsOf(device, "jagentchill.presence.changed").filter((event) => event.doc?.id === doc.id).at(-1).entries;
    assert.deepEqual(seen.map((entry: any) => [entry.deviceName, entry.mode, entry.role]).sort(), [["Desktop", "editing", "editor"], ["Phone", "viewing", "editor"]]);
  }
  assert.equal((await viewer.call("jagentchill.presence.list", { doc })).entries.length, 2);
  // Presence is not persisted, and the only periodic presence call a client has is the heartbeat.
  assert.equal(h.app.db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%presence%'").all().length, 0);
  assert.deepEqual([...h.app.methods.keys()].filter((name) => name.startsWith("jagentchill.presence.")).sort(), ["jagentchill.presence.heartbeat", "jagentchill.presence.list", "jagentchill.presence.subscribe", "jagentchill.presence.unsubscribe"]);

  // The phone closes the project: its next heartbeat names no document.
  await phone.call("jagentchill.presence.heartbeat", presenceOf("phone"));
  await tick();
  assert.deepEqual(s.eventsOf(desktop, "jagentchill.presence.changed").filter((event) => event.doc?.id === doc.id).at(-1).entries.map((entry: any) => entry.deviceName), ["Desktop"]);
  // A device that just stops is stale 30 seconds after its last heartbeat.
  await phone.call("jagentchill.presence.heartbeat", presenceOf("phone", { openDoc: doc, mode: "viewing" }));
  await advance(29_000);
  await desktop.call("jagentchill.presence.heartbeat", presenceOf("desktop", { openDoc: doc, mode: "editing" }));
  assert.equal((await desktop.call("jagentchill.presence.list", { doc })).entries.length, 2);
  await advance(1_500);
  assert.deepEqual((await desktop.call("jagentchill.presence.list", { doc })).entries.map((entry: any) => entry.deviceName), ["Desktop"]);
});

test("Scenario: Continue from the desktop position, Scenario: Chip ignored — a per-device continuity record outside the op log, written at most once every 5 seconds and on close", async () => {
  const { doc } = await editing(desktop, "Continuity");
  const at = (ticks: number) => presenceOf("desktop", { openDoc: doc, mode: "editing", sceneId: "s1", playhead_ticks: ticks });
  await desktop.call("jagentchill.presence.heartbeat", at(1000));
  await desktop.call("jagentchill.presence.heartbeat", at(2000));
  let record = (await phone.call("jagentchill.sync.project.get", { doc })).continuity;
  assert.deepEqual(record.map((entry: any) => [entry.deviceName, entry.sceneId, entry.playhead_ticks]), [["Desktop", "s1", 1000]], "the second write came within 5 seconds");
  await advance(5_000);
  await desktop.call("jagentchill.presence.heartbeat", at(3000));
  assert.equal((await phone.call("jagentchill.sync.project.get", { doc })).continuity[0].playhead_ticks, 3000);
  // 00:42:10 at 30 fps, then the desktop closes the project: the position at close is kept.
  const stop = (42 * 30 + 10) * 4000;
  await desktop.call("jagentchill.presence.heartbeat", at(stop));
  await desktop.call("jagentchill.presence.heartbeat", presenceOf("desktop"));
  await advance(5 * 60_000);
  await phone.call("jagentchill.presence.heartbeat", presenceOf("phone", { openDoc: doc, mode: "viewing", sceneId: "s1", playhead_ticks: 0 }));
  record = (await phone.call("jagentchill.sync.project.get", { doc })).continuity;
  const theirs = record.find((entry: any) => entry.deviceId === desktop.device.deviceId), mine = record.find((entry: any) => entry.deviceId === phone.device.deviceId);
  assert.deepEqual([theirs.playhead_ticks, theirs.sceneId, mine.playhead_ticks], [stop, "s1", 0]);
  assert.equal(s.head(doc), 1, "continuity never makes a revision");
});

test("Scenario: Preset appears on another device, Scenario: Concurrent rename offline, Scenario: Skewed device clock — library items, last writer by server time", async () => {
  const put = (device: Paired, name: string, over: Record<string, unknown> = {}) => device.call("jagentchill.sync.library.put", { itemId: "preset-teal", kind: "preset", name, updated_ms: now(), payload: { lift: 0.1 }, idempotencyKey: randomUUID(), ...over });
  const first = (await put(desktop, "Teal and orange")).item;
  const seen = (await phone.call("jagentchill.sync.library.list", { since_ms: 0 })).items;
  assert.deepEqual(seen.map((item: any) => [item.itemId, item.kind, item.name, item.payload]), [["preset-teal", "preset", "Teal and orange", { lift: 0.1 }]]);
  assert.equal((await phone.call("jagentchill.sync.library.list", { since_ms: first.serverUpdated_ms })).items.length, 0);

  // Both rename while offline from the same base; the desktop reaches the host first, the phone second.
  await put(desktop, "Teal (desktop)", { baseServerUpdated_ms: first.serverUpdated_ms });
  // The phone's clock is one day behind: device clocks are not compared.
  const late = await put(phone, "Teal (phone)", { baseServerUpdated_ms: first.serverUpdated_ms, updated_ms: now() - DAY });
  assert.equal(late.item.name, "Teal (phone)");
  assert.equal(late.conflict.name, "Teal (desktop) (conflict Desktop)");
  const all = (await desktop.call("jagentchill.sync.library.list", {})).items;
  assert.deepEqual(all.map((item: any) => item.name).sort(), ["Teal (desktop) (conflict Desktop)", "Teal (phone)"]);
  assert.equal(all.find((item: any) => item.itemId === "preset-teal").serverUpdated_ms > first.serverUpdated_ms, true);

  // Uploading needs jagentchill.media.write; a deletion is a tombstone kept 30 days.
  assert.equal((await viewer.fail("jagentchill.sync.library.put", { itemId: "x", kind: "preset", name: "x", updated_ms: 1, payload: {}, idempotencyKey: "v" })).code, "SCOPE_DENIED");
  await desktop.call("jagentchill.sync.library.delete", { itemId: "preset-teal" });
  const tombstone = (await phone.call("jagentchill.sync.library.list", { since_ms: late.item.serverUpdated_ms })).items.find((item: any) => item.itemId === "preset-teal");
  assert.ok(tombstone.deleted_ms > 0);
  await advance(31 * DAY);
  h.app.sync.storageSweep();
  assert.equal((await phone.call("jagentchill.sync.library.list", {})).items.some((item: any) => item.itemId === "preset-teal"), false);
});
