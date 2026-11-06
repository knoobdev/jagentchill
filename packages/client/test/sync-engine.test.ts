// Cross-device sync end to end in one process: the real JAgentChill Server app (no Gateway child — sync never uses
// it) and two or three simulated devices made of the real client SDK, the real sync engine, the real storage port and
// the editor's real commit pipeline and save manager (see support/devices.ts). No UI, no model turn, no provider key.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { canonicalize, documentHash, insertElement, moveElement, renameProject, setLocal } from "@jagentchill/editor-core";
import { createTrack, type ProjectDocument } from "@jagentchill/protocol";
import { HostError, connectHost, copyName, nextBatch } from "../src/index.ts";
import { pause, startHost, until, type Device, type Editor, type Host } from "./support/devices.ts";

let host: Host, A: Device, B: Device, V: Device;
before(async () => {
  host = await startHost();
  A = await host.device("Studio Mac", "admin", "desktop");
  B = await host.device("Phone", "editor", "web");
  V = await host.device("Client iPad", "viewer", "mobile");
});
after(() => host.close());

const doc = (projectId: string) => ({ kind: "project" as const, id: projectId });
const head = (projectId: string) => host.app.sync.documents.row(doc(projectId))!.head;
const hostDocument = (projectId: string) => host.app.sync.documents.head(host.app.sync.documents.row(doc(projectId)) as never) as ProjectDocument;
const mainScene = (document: ProjectDocument) => document.scenes[0];
const names = (document: ProjectDocument) => mainScene(document).tracks.overlay.flatMap((track) => track.elements.map((element) => element.name));
/** Adds a text track once and a text element on it: two committed commands the first time, one afterwards. */
function addText(editor: Editor, name: string, startTime = 0): boolean {
  if (!mainScene(editor.document).tracks.overlay.some((track) => track.type === "text")) {
    if (!editor.change("Add text track", (draft) => { draft.scenes[0].tracks.overlay.push(createTrack("text", { id: editor.device.context().newId(), name: "Text" })); })) return false;
  }
  const track = mainScene(editor.document).tracks.overlay.find((entry) => entry.type === "text")!;
  return editor.commit((document, context) => insertElement(document, context, track.id, { type: "text", name, startTime, duration: 360000, content: name }, "Add text"));
}
const synced = (editor: Editor) => until(() => editor.status.kind === "synced" && editor.session.state.pending === 0, `${editor.device.name} to be synced (now ${JSON.stringify(editor.status)})`);
/** A synced project that A edits, B has fetched and opened (view-only), and both are at the same revision. */
async function shared(name: string): Promise<{ id: string; a: Editor; b: Editor }> {
  const id = await A.createProject(name), a = await A.edit(id);
  addText(a, "Opening title");
  await A.engine.enable(id);
  await synced(a);
  await B.engine.fetchProject(id);
  const b = await B.edit(id);
  await until(() => b.session.state.mode === "viewing", "B to be viewing");
  return { id, a, b };
}

test("two devices: A creates and edits a project, B receives it and sees live edits, B takes the lease and edits, A sees them", async () => {
  // A works on a local project first; nothing of it is on the host.
  const id = await A.createProject("Ha Giang loop vlog"), a = await A.edit(id);
  assert.deepEqual(a.status, { kind: "local" });
  addText(a, "Day 1");
  assert.equal((await A.connection!.call<any>("jagentchill.sync.project.list", {})).items.some((item: any) => item.doc.id === id), false);

  // Scenario: Enable sync on an existing project — the snapshot is revision 1 and the project is in the host space.
  const enabled = await A.engine.enable(id);
  assert.deepEqual(enabled, { attached: false, media: 0 });
  const listed = (await B.connection!.call<any>("jagentchill.sync.project.list", {})).items.find((item: any) => item.doc.id === id);
  assert.deepEqual([listed.name, listed.head, listed.lastAuthorName], ["Ha Giang loop vlog", 1, "Studio Mac"]);
  await until(() => a.session.state.mode === "editing", "A to hold the lease");
  await synced(a);

  // Scenario: Browsing projects from a second device, Scenario: First open on a phone — B downloads the snapshot and opens view-only.
  const started = Date.now();
  assert.deepEqual(await B.engine.fetchProject(id), { revision: 1, name: "Ha Giang loop vlog" });
  const b = await B.edit(id);
  await until(() => b.session.state.mode === "viewing", "B to be viewing");
  assert.ok(Date.now() - started < 3000, "the timeline structure is there within 3 seconds");
  assert.deepEqual(names(b.document), ["Day 1"]);
  assert.equal(documentHash(b.document), documentHash(a.document));
  // Scenario: Second device opens the project — view-only, with the holder named.
  assert.deepEqual(b.status, { kind: "viewing", name: "Studio Mac", agent: false, sameDevice: false });
  assert.equal(b.readOnly, "Studio Mac");
  // Scenario: Editing controls disabled — a view-only editor changes nothing.
  assert.equal(addText(b, "Not allowed"), false);
  assert.deepEqual(names(b.document), ["Day 1"]);

  // Scenario: Viewer sees an edit, Scenario: One command, one operation — one command on A is one revision, and B shows it within a second of the host accepting it.
  const before = head(id);
  addText(a, "Day 2", 360000);
  assert.deepEqual(a.status.kind, "syncing");
  await until(() => head(id) === before + 1, "the host to accept the operation");
  const accepted = Date.now();
  await until(() => names(b.document).includes("Day 2"), "B to show the new element");
  assert.ok(Date.now() - accepted < 1000);
  // Scenario: Status progression — "Syncing", then "Synced" within 2 seconds of the acceptance.
  await synced(a);
  assert.ok(Date.now() - accepted < 2000);
  assert.equal(documentHash(b.document), documentHash(hostDocument(id)));
  assert.equal(b.session.state.revision, head(id));

  // Scenario: Undo is an operation — undo on A is a new revision that restores the previous state everywhere.
  a.undo();
  await until(() => head(id) === before + 2 && !names(b.document).includes("Day 2"), "the undo to reach B");
  assert.equal((await B.connection!.call<any>("jagentchill.sync.ops.pull", { doc: doc(id), afterRevision: before + 1 })).ops[0].commandType, "history.undo");

  // Scenario: Selection change — moving the playhead or changing device-local view state appends nothing.
  a.document = setLocal(a.document, (local) => { local.timelineViewState = { ...(local.timelineViewState as object), zoomLevel: 3 }; });
  a.autosave.changeLocal(a.document);
  a.session.notePosition({ sceneId: mainScene(a.document).id, playhead_ticks: 480000 });
  await a.autosave.flush();
  await pause(700);
  assert.equal(head(id), before + 2);
  // Scenario: Local section excluded — the two devices hold different local sections and the same canonical form.
  assert.notDeepEqual((await A.stored(id) as any).local, (await B.stored(id) as any).local);
  assert.equal(documentHash(await A.stored(id)), documentHash(await B.stored(id)));

  // Scenario: Holder hands over — B asks, A hands over; B is the writer at the latest head and A is view-only.
  addText(a, "Day 3", 720000);
  const asking = b.session.requestEdit();
  await until(() => a.session.state.request?.role === "holder", "A to be asked");
  assert.deepEqual([a.session.state.request!.deviceName, a.session.state.request!.kind], ["Phone", "takeover"]);
  const handed = Date.now();
  await a.session.answerTakeover(true);
  assert.equal(await asking, true);
  assert.ok(Date.now() - handed < 6000);
  await until(() => a.session.state.mode === "viewing" && b.session.state.mode === "editing", "the roles to swap");
  assert.deepEqual([a.readOnly, b.readOnly], ["Phone", null]);
  assert.ok(names(b.document).includes("Day 3"), "A's pending work was flushed before the hand-over");
  assert.deepEqual(a.status, { kind: "viewing", name: "Phone", agent: false, sameDevice: false });

  // B edits; A, now a viewer, sees it.
  addText(b, "From the phone", 1080000);
  b.commit((document, context) => renameProject(document, context, "Ha Giang loop vlog (final)"));
  await until(() => names(a.document).includes("From the phone") && a.document.metadata.name === "Ha Giang loop vlog (final)", "A to show B's edits");
  await synced(b);
  assert.equal(documentHash(a.document), documentHash(b.document));
  await until(async () => documentHash(await A.stored(id)) === documentHash(hostDocument(id)), "A's saved record to be the host head too");
  // The project list on every device shows the same last-modified time and last author.
  const [fromA, fromB] = await Promise.all([A, B].map(async (device) => (await device.connection!.call<any>("jagentchill.sync.project.get", { doc: doc(id) }))));
  assert.deepEqual([fromA.updated_ms, fromA.lastAuthorName, fromA.name], [fromB.updated_ms, "Phone", "Ha Giang loop vlog (final)"]);
  await a.close(); await b.close();
  assert.equal(host.app.sync.leases.current(doc(id)), null, "closing the document releases the lease");
});

test("Scenario: Local edit is never blocked, Scenario: Fast-forward — an edit while the host is unreachable is applied and saved at once; on reconnect the offline operations are pushed without a dialog", async () => {
  const { id, a, b } = await shared("Fast forward");
  const base = head(id);
  await A.disconnect();
  const started = performance.now();
  addText(a, "Offline 1", 400000);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 50, `the commit took ${elapsed} ms: nothing waits for the host`);
  assert.ok(names(a.document).includes("Offline 1"));
  await until(() => a.status.kind === "offline", "A to show offline changes");
  assert.deepEqual(a.status, { kind: "offline", count: 1 });
  addText(a, "Offline 2", 800000);
  a.commit((document, context) => moveElement(document, context, mainScene(document).tracks.overlay[0].elements[0].id, 1200000));
  await a.autosave.flush();
  assert.equal((await A.storage.readJournal(id)).length, 3, "unpushed operations are in the store before any push is attempted");
  assert.equal(head(id), base);
  // The lease expired meanwhile (30 s without a heartbeat) and nobody took it.
  host.app.sync.leases.dropDevice(A.signer.deviceId);
  await until(() => b.session.state.mode === "free", "B to see the lease free");

  await A.reconnect();
  await until(() => head(id) === base + 3, "the branch to be pushed");
  await synced(a);
  assert.deepEqual(A.conflicts.filter((entry) => entry === id), [], "no dialog");
  assert.deepEqual((await A.storage.readJournal(id)).length, 0);
  await until(() => documentHash(b.document) === documentHash(a.document), "B to follow");
  // Scenario: Event gap — B missed nothing: its revision equals head.
  assert.equal(b.session.state.revision, head(id));
  await a.close(); await b.close();
});

test("Scenario: Event gap — a viewer whose connection dropped pulls the operations it missed", async () => {
  const { id, a, b } = await shared("Event gap");
  await B.disconnect();
  for (let index = 0; index < 15; index++) a.change(`Marker ${index}`, (draft) => { draft.scenes[0].markers.push({ id: A.context().newId(), time: 4000 * (index + 1), name: `M${index}`, color: "#ff0000" }); });
  await synced(a);
  assert.equal(b.session.state.revision, head(id) - 15);
  await B.reconnect();
  await until(() => b.session.state.revision === head(id), "B to catch up");
  assert.equal(mainScene(b.document).markers.length, 15);
  assert.equal(documentHash(b.document), documentHash(hostDocument(id)));
  await a.close(); await b.close();
});

test("Scenario: App killed with pending operations — relaunched online, the unpushed operations are pushed in order without user action", async () => {
  const { id, a, b } = await shared("Killed");
  const base = head(id);
  await A.disconnect();
  for (let index = 0; index < 7; index++) a.change(`Marker ${index}`, (draft) => { draft.scenes[0].markers.push({ id: A.context().newId(), time: 4000 * (index + 1), name: `M${index}`, color: "#00ff00" }); });
  await a.autosave.flush();
  host.app.sync.leases.dropDevice(A.signer.deviceId);
  await A.restart();
  const again = await A.edit(id);
  await until(() => head(id) === base + 7, "the seven operations to be pushed");
  const { ops } = await B.connection!.call<any>("jagentchill.sync.ops.pull", { doc: doc(id), afterRevision: base });
  assert.deepEqual(ops.map((op: any) => op.label), Array.from({ length: 7 }, (_, index) => `Marker ${index}`));
  await synced(again);
  await until(() => mainScene(b.document).markers.length === 7, "B to receive them");
  await again.close(); await b.close();
});

/** A is offline with unpushed work while B, who took the lease, moved the host head. Both reconnected, conflict raised on A. */
async function diverged(name: string): Promise<{ id: string; a: Editor; b: Editor; base: number }> {
  const { id, a, b } = await shared(name), base = head(id);
  await A.disconnect();
  addText(a, "Mine (offline)", 500000);
  a.commit((document, context) => renameProject(document, context, `${name} — mine`));
  await a.autosave.flush();
  host.app.sync.leases.dropDevice(A.signer.deviceId);
  await until(() => b.session.state.mode === "free", "the lease to be free");
  assert.equal(await b.session.startEditing(), true);
  addText(b, "Theirs (host)", 900000);
  addText(b, "Theirs 2", 1300000);
  await synced(b);
  assert.equal(head(id), base + 2);
  await b.session.stopEditing();
  await A.reconnect();
  await until(() => a.status.kind === "conflict" && A.conflicts.includes(id), "the conflict to be raised on A");
  return { id, a, b, base };
}

test("Scenario: Diverged, Scenario: Not now — nothing is pushed, the conflict is raised at once, and with \"Not now\" further edits extend the local branch", async () => {
  const { id, a, b, base } = await diverged("Diverged");
  assert.equal(head(id), base + 2, "nothing was pushed");
  assert.deepEqual(A.conflicts.filter((entry) => entry === id), [id], "raised once, on the device that holds the branch");
  const conflict = a.session.state.conflict!;
  assert.deepEqual([conflict.head, conflict.hostAuthorName, conflict.deferred, a.session.state.pending], [base + 2, "Phone", false, 2]);
  assert.equal(a.readOnly, null, "the document stays editable locally");
  await a.session.notNow();
  addText(a, "Still mine", 1700000);
  await a.autosave.flush();
  await pause(700);
  assert.equal(head(id), base + 2);
  assert.equal((await A.storage.readJournal(id)).length, 3);
  assert.deepEqual([a.status, a.session.state.conflict!.deferred], [{ kind: "conflict" }, true]);
  // The badge survives a restart of the app and opens the same choice again.
  await A.restart();
  const again = await A.edit(id);
  await until(() => again.status.kind === "conflict", "the conflict to be there after a restart");
  assert.equal(again.session.state.conflict!.deferred, true);
  assert.deepEqual(await A.engine.statusOf(id), { kind: "conflict" });
  await again.close(); await b.close();
});

test("Scenario: Keep this device's version — head becomes head + 1 with the device's state and the replaced head is a named version", async () => {
  const { id, a, b, base } = await diverged("Keep mine");
  const hostBefore = canonicalize(hostDocument(id));
  // Scenario: Lease held by another device during choice (a) — while B edits, nothing changes.
  assert.equal(await b.session.startEditing(), true);
  assert.deepEqual(await a.session.keepMine(), { ok: false, holderName: "Phone" });
  assert.equal(head(id), base + 2);
  assert.equal(a.status.kind, "conflict");
  await b.session.stopEditing();

  assert.deepEqual(await a.session.keepMine(), { ok: true });
  assert.equal(head(id), base + 3);
  assert.equal(canonicalize(hostDocument(id)), canonicalize(a.document));
  assert.deepEqual([a.status.kind, a.session.state.mode, a.session.state.conflict, (await A.storage.readJournal(id)).length], ["synced", "editing", null, 0]);
  const { versions } = await A.connection!.call<any>("jagentchill.sync.version.list", { doc: doc(id) });
  assert.match(versions[0].name, /^Replaced on \d{4}-\d{2}-\d{2} by Studio Mac$/);
  assert.equal(versions[0].revision, base + 2);
  // B, a viewer now, is brought to the device's version by the snapshot.
  await until(() => canonicalize(b.document) === canonicalize(a.document), "B to show A's version");
  assert.ok(names(b.document).includes("Mine (offline)") && !names(b.document).includes("Theirs (host)"));
  // The superseded head is recoverable: restoring the version brings it back as a new revision.
  await a.session.stopEditing();
  const lease = (await B.connection!.call<any>("jagentchill.sync.lease.acquire", { doc: doc(id) })).lease;
  await B.connection!.call("jagentchill.sync.version.restore", { versionId: versions[0].versionId, leaseId: lease.leaseId });
  assert.equal(canonicalize(hostDocument(id)), hostBefore);
  await B.connection!.call("jagentchill.sync.lease.release", { doc: doc(id), leaseId: lease.leaseId });
  // Editing goes on from the new head.
  await a.close(); await b.close();
});

test("Scenario: Keep the host version — the working copy equals the head and the local branch is kept as a local version", async () => {
  const { id, a, b, base } = await diverged("Keep theirs");
  const mine = canonicalize(a.document);
  await a.session.keepTheirs();
  assert.equal(head(id), base + 2, "the host copy is untouched");
  assert.equal(canonicalize(a.document), canonicalize(hostDocument(id)));
  assert.equal(canonicalize(await A.stored(id)), canonicalize(hostDocument(id)));
  assert.deepEqual([a.session.state.conflict, a.session.state.revision, (await A.storage.readJournal(id)).length], [null, base + 2, 0]);
  const [version] = (await A.storage.listSnapshots(id)).filter((snapshot) => snapshot.label.startsWith("Local changes from "));
  assert.match(version.label, /^Local changes from \d{4}-\d{2}-\d{2}$/);
  assert.equal(canonicalize(JSON.parse((await A.storage.readSnapshot(id, version.id)).record)), mine, "the local branch can be restored or saved as a copy");
  const record = await A.engine.record(id);
  assert.ok(record!.localVersions![0].expires_ms - Date.now() > 29 * 86_400_000, "kept for 30 days");
  // A is the writer again when nobody else is, and edits from the host version.
  await until(() => a.session.state.mode === "editing", "A to edit again");
  addText(a, "After choosing theirs", 2100000);
  await synced(a);
  assert.equal(head(id), base + 3);
  await a.close(); await b.close();
});

test("Scenario: Save mine as a copy — two projects exist: the original at the host head and a new one with the local state", async () => {
  const { id, a, b, base } = await diverged("Save as copy");
  const mine = a.document;
  const copy = await a.session.saveCopy();
  assert.match(copy.name, /^Save as copy — mine \(copy from Studio Mac \d{4}-\d{2}-\d{2} \d{2}:\d{2}\)$/);
  assert.equal(copyName("Trip", "Phone", new Date(2026, 9, 6, 9, 5).getTime()), "Trip (copy from Phone 2026-10-06 09:05)");
  assert.notEqual(copy.projectId, id);
  const stored = await A.stored(copy.projectId);
  assert.deepEqual([stored.metadata.name, names(stored)], [copy.name, names(mine)]);
  assert.equal(head(id), base + 2);
  assert.equal(canonicalize(a.document), canonicalize(hostDocument(id)));
  assert.equal((await A.engine.record(copy.projectId)), null, "the copy is a new document; it is synced like any new project when the user's preference says so");
  await a.close(); await b.close();
});

test("Scenario: Lease held but head unchanged — the branch is kept, the status names the device, and Request to edit pushes it", async () => {
  const { id, a, b } = await shared("Waiting");
  const base = head(id);
  await A.disconnect();
  addText(a, "Offline", 500000);
  await a.autosave.flush();
  host.app.sync.leases.dropDevice(A.signer.deviceId);
  await until(() => b.session.state.mode === "free", "the lease to be free");
  assert.equal(await b.session.startEditing(), true);
  await A.reconnect();
  await until(() => a.status.kind === "offline" && a.status.waitingFor === "Phone", "A to wait for the phone");
  assert.deepEqual(a.status, { kind: "offline", count: 1, waitingFor: "Phone" });
  assert.equal(head(id), base);
  assert.deepEqual(A.conflicts.filter((entry) => entry === id), []);
  // "Request to edit": the phone hands over (it has nothing pending) and the branch is fast-forwarded.
  const asking = a.session.requestEdit();
  await until(() => b.session.state.request !== null, "B to be asked");
  await b.session.answerTakeover(true);
  assert.equal(await asking, true);
  await until(() => head(id) === base + 1, "the branch to be pushed");
  await synced(a);
  await a.close(); await b.close();
});

test("Scenario: Holder declines, Scenario: Two tabs of one device — the requester sees the decline and the cooldown; a second window of the holder opens view-only", async () => {
  const { id, a, b } = await shared("Declines");
  const asking = b.session.requestEdit();
  await until(() => a.session.state.request !== null, "A to be asked");
  await a.session.answerTakeover(false);
  assert.equal(await asking, false);
  assert.equal(b.session.state.requesting, "declined");
  assert.equal(await b.session.requestEdit(), false);
  assert.equal(b.session.state.requesting, "cooldown");
  assert.ok(b.session.state.requestRetry_ms - Date.now() > 50_000);
  assert.equal(a.session.state.mode, "editing");
  // A second window: another app instance of the same device, on its own connection.
  const second = await connectHost({ host: A.host, signer: A.signer, clientInstanceId: "second-window", onTokenRotated: () => undefined });
  await assert.rejects(second.call("jagentchill.sync.lease.acquire", { doc: doc(id) }), (error: HostError) => error.code === "LEASE_HELD" && error.details?.sameDevice === true && error.details?.holderName === "Studio Mac");
  await assert.rejects(second.call("jagentchill.sync.ops.push", { doc: doc(id), leaseId: a.session.state.lease!.leaseId, baseRevision: head(id), ops: [{ opId: "00000000-0000-7000-8000-000000000001", created_ms: 1, commandType: "x", label: "x", patches: [], schemaVersion: 32 }] }), (error: HostError) => error.code === "LEASE_NOT_HELD");
  second.close();
  await a.close(); await b.close();
});

test("Scenario: Admin forces takeover with unpushed work on the holder — the admin edits at once; the former holder's work is its offline branch", async () => {
  const id = await B.createProject("Forced"), b = await B.edit(id);
  addText(b, "From the phone");
  await B.engine.enable(id);
  await synced(b);
  await A.engine.fetchProject(id);
  const a = await A.edit(id);
  await until(() => a.session.state.mode === "viewing", "A to be viewing");
  const base = head(id);
  await B.disconnect();
  for (let index = 0; index < 4; index++) addText(b, `Unpushed ${index}`, 400000 * (index + 1));
  await b.autosave.flush();
  await a.session.forceTake();
  assert.equal(a.session.state.mode, "editing");
  addText(a, "Admin edit", 3000000);
  await synced(a);
  await B.reconnect();
  await until(() => b.status.kind === "conflict", "B's branch to be raised as a conflict");
  assert.deepEqual([b.session.state.pending, head(id)], [4, base + 1]);
  await a.close(); await b.close();
});

test("a viewer device follows a project and cannot write it", async () => {
  const { id, a, b } = await shared("Viewer");
  await V.engine.fetchProject(id);
  const v = await V.edit(id);
  await until(() => v.session.state.mode === "viewing", "the viewer to follow");
  assert.equal(v.session.state.canWrite, false, "no Request to edit for a viewer role");
  addText(a, "Seen by the viewer", 400000);
  await until(() => names(v.document).includes("Seen by the viewer"), "the viewer to see the edit");
  assert.equal(addText(v, "Viewer edit"), false);
  await a.close();
  await until(() => v.session.state.lease === null, "the lease to be free");
  assert.equal(await v.session.startEditing(), false, "a free lease is still not a viewer's");
  await assert.rejects(V.connection!.call("jagentchill.sync.lease.acquire", { doc: doc(id) }), (error: HostError) => error.code === "SCOPE_DENIED" && error.details?.requiredScope === "jagentchill.projects.write");
  await assert.rejects(V.connection!.call("jagentchill.sync.ops.push", { doc: doc(id), leaseId: "00000000-0000-4000-8000-000000000000", baseRevision: 1, ops: [{ opId: "00000000-0000-7000-8000-000000000000", created_ms: 1, commandType: "x", label: "x", patches: [], schemaVersion: 32 }] }), (error: HostError) => error.code === "SCOPE_DENIED");
  await assert.rejects(V.engine.enable(await V.createProject("Viewer's own")), (error: HostError) => error.code === "SCOPE_DENIED", "Scenario: Viewer cannot enable sync");
  await v.close(); await b.close();
});

test("Scenario: Large paste committed as a snapshot — an operation too large for a push becomes exactly one revision that viewers fetch", async () => {
  const { id, a, b } = await shared("Large paste");
  const base = head(id);
  a.change("Paste 2000 elements", (draft) => {
    const track = draft.scenes[0].tracks.overlay.find((entry: any) => entry.type === "text");
    const template = track.elements[0];
    for (let index = 0; index < 2000; index++) track.elements.push({ ...template, id: A.context().newId(), name: `Pasted ${index}`, startTime: 400000 * (index + 1), content: `Line ${index} ${"·".repeat(300)}` });
  });
  await a.autosave.flush();
  const [entry] = await A.storage.readJournal(id);
  assert.ok(JSON.stringify(entry.patch).length > 1_500_000);
  assert.equal(nextBatch([entry]), null);
  await until(() => head(id) === base + 1, "the snapshot to be committed", 20000);
  await synced(a);
  await until(() => b.session.state.revision === base + 1, "B to fetch the snapshot", 20000);
  assert.equal(documentHash(b.document), documentHash(a.document));
  assert.equal(mainScene(b.document).tracks.overlay[0].elements.length, 2001);
  await a.close(); await b.close();
});

test("Scenario: Disable sync and keep the server copy, Scenario: Pause all — edits stop being pushed and the host copy stays at its last revision", async () => {
  const { id, a, b } = await shared("Pause and disable");
  const base = head(id);
  await A.engine.setPausedAll(true);
  addText(a, "While paused", 400000);
  await a.autosave.flush();
  await pause(800);
  assert.deepEqual([head(id), a.status], [base, { kind: "paused" }]);
  assert.deepEqual(await A.engine.statusOf(id), { kind: "paused" });
  // It persists across restarts.
  assert.deepEqual(await A.storage.getSession("sync.settings"), { pausedAll: true });
  await A.engine.setPausedAll(false);
  await until(() => head(id) === base + 1, "the paused operation to be pushed");
  await synced(a);

  await A.engine.disable(id, false);
  assert.deepEqual(a.status, { kind: "local" });
  addText(a, "Local only now", 800000);
  await a.autosave.flush();
  await pause(700);
  assert.equal(head(id), base + 1, "the host copy stays at its last revision");
  assert.equal((await A.storage.readJournal(id)).length, 0, "a document whose sync is off keeps no journal");
  assert.equal((await B.connection!.call<any>("jagentchill.sync.project.get", { doc: doc(id) })).head, base + 1);
  await a.close(); await b.close();
});

test("Scenario: Delete propagates, Scenario: Delete while another device edits, Scenario: Offline delete of a project that changed, Scenario: Return after purge", async () => {
  const { id, a, b } = await shared("Deleted");
  // B cannot delete while A edits.
  assert.deepEqual(await B.engine.remove(id), { refused: "Studio Mac" });
  // A, the holder, deletes: the host copy goes to the host trash and B is told who did it.
  assert.equal(await A.engine.remove(id), "trashed");
  await until(() => b.status.kind === "deleted", "B to learn of the deletion");
  assert.deepEqual(b.status, { kind: "deleted", by: "Studio Mac" });
  assert.equal((await B.connection!.call<any>("jagentchill.trash.list", {})).entries.some((entry: any) => entry.id === id), true);
  await a.close(); await b.close();

  // An offline deletion is a tombstone; the project changed meanwhile, so it is restored at the head.
  const second = await shared("Offline delete");
  await second.a.close();
  await B.disconnect();
  assert.equal(await B.engine.remove(second.id), "pending");
  const again = await A.edit(second.id);
  await until(() => again.session.state.mode === "editing", "A to edit");
  addText(again, "Changed meanwhile", 400000);
  await synced(again);
  await again.close();
  await second.b.close();
  await B.reconnect();
  assert.deepEqual(await B.engine.applyTombstones([second.id]), { deleted: [], restored: [second.id] });
  assert.equal(canonicalize(await B.stored(second.id)), canonicalize(hostDocument(second.id)));
  assert.equal((await B.engine.record(second.id))!.tombstone, undefined);
  // An unchanged project is deleted by its tombstone.
  await B.disconnect();
  assert.equal(await B.engine.remove(second.id), "pending");
  await B.reconnect();
  assert.deepEqual(await B.engine.applyTombstones([second.id]), { deleted: [second.id], restored: [] });

  // A device with offline changes returns after the purge: its copy, with those changes, is its own.
  const third = await shared("Purged");
  await B.disconnect();
  await third.a.close();
  await A.engine.remove(third.id);
  await A.connection!.call("jagentchill.trash.purge", { kind: "project", id: third.id });
  await B.reconnect();
  await until(() => third.b.status.kind === "local", "B's copy to become On this device only");
  assert.equal(await B.engine.record(third.id), null);
  assert.equal(third.b.readOnly, null);
  assert.equal(addText(third.b, "Mine alone", 400000), true);
  await third.b.close();
});

test("Scenario: Corrupt snapshot, Scenario: Newer schema — a snapshot whose hash does not match is retried once and then nothing is written; a document that needs a newer app is not opened", async () => {
  const id = await A.createProject("Corrupt"), a = await A.edit(id);
  await A.engine.enable(id);
  await a.close();
  const fresh = await host.device("New tablet", "editor", "mobile");
  let fetches = 0;
  fresh.network.tamper = (url, bytes) => { if (!/\/blobs\/[0-9a-f]{64}$/.test(url)) return bytes; fetches += 1; const changed = bytes.slice(); changed[changed.length - 1] ^= 0xff; return changed; };
  await assert.rejects(fresh.engine.fetchProject(id), (error: HostError) => error.code === "BLOB_HASH_MISMATCH");
  assert.equal(fetches, 2, "retried once");
  assert.equal(await fresh.storage.hasProject(id), false);
  assert.equal(await fresh.engine.record(id), null);
  fresh.network.tamper = null;
  assert.equal((await fresh.engine.fetchProject(id)).revision, 1);

  // A host that understands schema 35 holds a project only schema-34 apps and above can read (this app reads 33).
  const next = await startHost({ maxSchemaVersion: { project: 34, script: 1, workflow: 1 } });
  try {
    const old = await next.device("Old phone", "editor");
    const admin = await next.device("Mac", "admin");
    const pid = await admin.createProject("Future"), document = { ...JSON.parse(await admin.storage.readProjectText(pid)), schemaVersion: 35, minReaderSchemaVersion: 34 };
    delete document.local;
    // Uploaded as the newer app would: the snapshot and the enable call of the wire protocol.
    const { gzip, sha256Hex, uploadBlob } = await import("../src/index.ts");
    const bytes = await gzip(canonicalize(document)), sha256 = await sha256Hex(bytes);
    await uploadBlob({ host: admin.host, signer: admin.signer }, { sha256, size: bytes.length, mime: "application/gzip", name: "s", purpose: "snapshot", read: async (start, end) => bytes.subarray(start, end) });
    await admin.connection!.call("jagentchill.sync.doc.enable", { doc: doc(pid), sha256, schemaVersion: 34, idempotencyKey: "enable-future" });
    await assert.rejects(old.engine.fetchProject(pid), (error: HostError) => error.code === "SCHEMA_TOO_NEW" && error.message === "Update JAgentChill on this device to open this project");
    assert.equal(await old.storage.hasProject(pid), false);
  } finally { await next.close(); }
});

test("Scenario: No third-party endpoint, Scenario: Key order does not matter on input — every sync connection ends at the paired host", async () => {
  const origins = new Set([A, B, V].flatMap((device) => [...device.network.requests.map((request) => new URL(request.url).origin), ...device.sockets.map((url) => new URL(url).origin.replace(/^ws/, "http"))]));
  assert.deepEqual([...origins], [host.origin]);
  assert.ok(A.network.requests.length > 10 && B.network.requests.length > 5);
  const one = { b: 1, a: { d: [1, 2], c: "x" } }, other = { a: { c: "x", d: [1, 2] }, b: 1 };
  assert.equal(canonicalize(one), canonicalize(other));
});
