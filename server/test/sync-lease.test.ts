// Cross-device sync, the edit lease: single writer, host principals, takeover and transfer. Devices are simulated
// (test/device-sim.ts), the clock is injected and moved by the test; the lease manager and the server app are real.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { createLeaseManager } from "../src/sync/leases.ts";
import { createHarness, tick, type Harness } from "./harness.ts";
import { connect, sampleDocument, support, type Paired } from "./support/sync.ts";

let h: Harness, s: ReturnType<typeof support>;
let offset = 0;
const now = () => Date.now() + offset;
/** Moves the clock and lets the once-a-second sweep see it. */
const advance = async (ms: number) => { offset += ms; h.app.sync.sweep(); await tick(); };
let admin: Paired, desktop: Paired, phone: Paired, tablet: Paired, guest: Paired;
const OPACITY = "/scenes/@s1/tracks/main/elements/@e1/opacity";
const leaseEvents = (paired: { events: Paired["events"] }, doc: { id: string }) => paired.events.filter((entry) => entry.event === "jagentchill.sync.lease" && entry.payload.doc.id === doc.id).map((entry) => entry.payload);
const pendingCall = (paired: Paired, method: string, params: unknown) => { const state: { result?: any; error?: any } = {}; const done = paired.call(method, params).then((result) => (state.result = result), (error) => (state.error = error)); return { state, done }; };
/** The answer of a call that may fail, without asserting which way it goes. */
const answer = (paired: Paired, method: string, params: unknown) => new Promise<any>((resolve) => {
  const id = `q${randomUUID()}`;
  const listener = (data: any) => { const frame = JSON.parse(data.toString()); if (frame.t === "res" && frame.id === id) { paired.ws.off("message", listener); resolve(frame); } };
  paired.ws.on("message", listener);
  paired.ws.send(JSON.stringify({ t: "req", id, method, params }));
});

before(async () => {
  h = await createHarness({ now, sync: { timings: { applyRemoteAnswerMs: 150, applyRemoteRetryMs: 30, hostYieldMs: 5000 } } });
  s = support(h, now);
  admin = await h.pair("Studio Mac", "admin");
  desktop = await h.pair("Desktop", "editor");
  phone = await h.pair("Phone", "editor");
  tablet = await h.pair("Tablet", "editor");
  guest = await h.pair("Guest laptop", "editor");
});
after(() => h.close());
const project = (owner: Paired, name: string) => s.enable(owner, sampleDocument(randomUUID(), name));

test("Lease expiry is exactly 30 seconds after the captured acquisition time", async () => {
  let clock = 10_000;
  const manager = createLeaseManager({ now: () => ++clock, deviceName: () => "Desktop", emit: () => {}, onReleased: () => {} });
  const lease = await manager.acquire({ kind: "project", id: randomUUID() }, { deviceId: "device-1", connId: "connection-1", clientInstanceId: "sim" });
  assert.equal(lease.expires_ms - lease.acquired_ms, 30_000);
});

test("Scenario: Acquire a free lease — a leaseId with expires_ms 30 000 ms ahead", async () => {
  const doc = await project(desktop, "Free lease");
  const at = now(), { lease, head } = await desktop.call("jagentchill.sync.lease.acquire", { doc });
  assert.match(lease.leaseId, /^[0-9a-f-]{36}$/);
  assert.ok(Math.abs(lease.expires_ms - lease.acquired_ms - 30_000) === 0 && Math.abs(lease.acquired_ms - at) < 500);
  assert.deepEqual([lease.holder.kind, lease.holder.deviceId, lease.holder.clientInstanceId, lease.holderName, head], ["device", desktop.device.deviceId, "sim", "Desktop", 1]);
  assert.equal((await desktop.call("jagentchill.sync.project.get", { doc })).lease.leaseId, lease.leaseId);
});

test("Scenario: Second device opens the project — acquire returns LEASE_HELD naming the first device", async () => {
  const doc = await project(desktop, "Second device");
  const { lease } = await desktop.call("jagentchill.sync.lease.acquire", { doc });
  await advance(5000);
  const held = await phone.fail("jagentchill.sync.lease.acquire", { doc });
  assert.equal(held.code, "LEASE_HELD");
  assert.deepEqual([held.details.holderName, held.details.holderDeviceId, held.details.acquired_ms, held.details.expires_ms, held.details.sameDevice], ["Desktop", desktop.device.deviceId, lease.acquired_ms, lease.expires_ms, false]);
  // The second device follows: it subscribes and reads.
  assert.equal((await phone.call("jagentchill.sync.subscribe", { doc })).lease.holderName, "Desktop");
});

test("Scenario: Two tabs of one device — the second tab receives LEASE_HELD with details.sameDevice and its push is refused with LEASE_NOT_HELD", async () => {
  const doc = await project(desktop, "Two tabs");
  const { lease } = await desktop.call("jagentchill.sync.lease.acquire", { doc });
  const tab = await connect(desktop, "second-tab");
  const held = await tab.fail("jagentchill.sync.lease.acquire", { doc });
  assert.deepEqual([held.code, held.details.sameDevice], ["LEASE_HELD", true]);
  assert.equal((await tab.fail("jagentchill.sync.ops.push", { doc, leaseId: lease.leaseId, baseRevision: 1, ops: s.ops(1) })).code, "LEASE_NOT_HELD");
  assert.equal((await tab.fail("jagentchill.sync.lease.heartbeat", { doc, leaseId: lease.leaseId })).code, "LEASE_NOT_HELD");
  // A reconnect of the SAME app instance before expiry re-binds the lease to the new connection.
  const reconnected = await connect(desktop, "sim");
  const again = await reconnected.call("jagentchill.sync.lease.acquire", { doc });
  assert.equal(again.lease.leaseId, lease.leaseId);
  assert.deepEqual(await reconnected.call("jagentchill.sync.ops.push", { doc, leaseId: lease.leaseId, baseRevision: 1, ops: s.ops(1) }), { revisions: [2], head: 2 });
  assert.equal((await desktop.fail("jagentchill.sync.ops.push", { doc, leaseId: lease.leaseId, baseRevision: 2, ops: s.ops(1) })).code, "LEASE_NOT_HELD", "the old connection no longer holds it");
  await reconnected.call("jagentchill.sync.lease.release", { doc, leaseId: lease.leaseId });
  await tab.close(); await reconnected.close();
});

test("Scenario: Holder disappears — no heartbeat for 30 seconds frees the lease and subscribers receive jagentchill.sync.lease", async () => {
  const doc = await project(desktop, "Holder disappears");
  const holder = await connect(desktop, "leaving");
  const { lease } = await holder.call("jagentchill.sync.lease.acquire", { doc });
  await phone.call("jagentchill.sync.subscribe", { doc });
  await holder.call("jagentchill.sync.ops.push", { doc, leaseId: lease.leaseId, baseRevision: 1, ops: s.ops(3) });
  await advance(10_000);
  await holder.call("jagentchill.sync.lease.heartbeat", { doc, leaseId: lease.leaseId });
  await holder.close();
  await advance(29_000);
  assert.equal(h.app.sync.leases.current(doc)?.leaseId, lease.leaseId, "29 s after the last heartbeat the lease still stands");
  await advance(1_001);
  const events = leaseEvents(phone, doc);
  assert.deepEqual([events.at(-1).lease, events.at(-1).reason], [null, "expired"]);
  // A lease released with operations since the last snapshot leaves a snapshot at the head.
  assert.equal((await phone.call("jagentchill.sync.project.get", { doc })).snapshot.revision, 4);
  assert.equal((await phone.call("jagentchill.sync.lease.acquire", { doc })).lease.holderName, "Phone");
});

test("Scenario: Heartbeat after expiry — the former holder's heartbeat returns LEASE_NOT_HELD once another device acquired the lease", async () => {
  const doc = await project(desktop, "Heartbeat after expiry");
  const { lease } = await desktop.call("jagentchill.sync.lease.acquire", { doc });
  await advance(30_001);
  await phone.call("jagentchill.sync.lease.acquire", { doc });
  assert.equal((await desktop.fail("jagentchill.sync.lease.heartbeat", { doc, leaseId: lease.leaseId })).code, "LEASE_NOT_HELD");
  assert.equal((await desktop.fail("jagentchill.sync.ops.push", { doc, leaseId: lease.leaseId, baseRevision: 1, ops: s.ops(1) })).code, "LEASE_NOT_HELD");
  assert.deepEqual(leaseEvents(desktop, doc).slice(-2).map((event) => [event.reason, event.lease?.holderName ?? null]), [["expired", null], ["acquired", "Phone"]]);
});

test("Scenario: Agent writes while nobody edits — the lease goes to agent:<sessionId>, one operation with a host author is appended, the lease is released", async () => {
  const doc = await project(desktop, "Agent writes");
  await phone.call("jagentchill.sync.subscribe", { doc });
  const result = await h.app.sync.host.applyBatch({ doc, principal: "agent:sess-42", label: "Agent: Tighten the intro", baseRevision: 1, originDeviceId: desktop.device.deviceId, patches: [{ op: "replace", path: OPACITY, value: 0.5 }] });
  assert.deepEqual(result, { state: "applied", revision: 2 });
  await tick();
  const { ops } = await phone.call("jagentchill.sync.ops.pull", { doc, afterRevision: 1 });
  assert.deepEqual([ops.length, ops[0].author, ops[0].label], [1, { kind: "host", principal: "agent:sess-42" }, "Agent: Tighten the intro"]);
  assert.deepEqual(leaseEvents(phone, doc).map((event) => [event.reason, event.lease?.holder.principal ?? null]), [["acquired", "agent:sess-42"], ["released", null]]);
  assert.equal(h.app.sync.leases.current(doc), null);
  assert.deepEqual(h.audit("sync.host.batch").at(-1), { actor: "agent:sess-42", doc, revision: 2, originDeviceId: desktop.device.deviceId });
  // A principal of another form is refused.
  await assert.rejects(h.app.sync.host.applyBatch({ doc, principal: "plugin:x", label: "x", baseRevision: 2, originDeviceId: "", patches: [] }), /host principal/);
  // A batch prepared against an older revision is the owner's to rebase.
  assert.deepEqual(await h.app.sync.host.applyBatch({ doc, principal: "agent:sess-42", label: "x", baseRevision: 1, originDeviceId: "", patches: [{ op: "replace", path: OPACITY, value: 0.1 }] }), { state: "rejected", head: 2 });
});

test("Scenario: Film assembly with nobody editing — the host acquires the lease as film:<filmId> and commits one revision with that principal", async () => {
  const doc = await project(desktop, "Film assembly");
  const result = await h.app.sync.host.applyBatch({ doc, principal: "film:film-7", label: "Film: Episode 1", baseRevision: 1, originDeviceId: phone.device.deviceId, patches: [{ op: "add", path: "/scenes/@s1/tracks/main/elements/@p1", value: { id: "p1", startTime: 500000, duration: 5 } }] });
  assert.deepEqual(result, { state: "applied", revision: 2 });
  const info = await desktop.call("jagentchill.sync.project.get", { doc });
  // What a screen is given to show is never the principal: a name, and the facts to word it in the person's language.
  assert.deepEqual([info.lastAuthor, info.lastAuthorName, info.lastAuthorDisplay, info.lease], [{ kind: "host", principal: "film:film-7" }, "Film Studio", { kind: "film" }, null]);
});

test("The project list names who edited last and never shows an id: an agent's edit is the agent (no session key), a device that was removed keeps its last known name", async () => {
  const doc = await project(desktop, "Named authors");
  await phone.call("jagentchill.sync.subscribe", { doc });
  // An agent's write: the principal is `agent:<session key>` — a session key reads "agent:main:jc:…".
  const principal = "agent:agent:main:jc:5a3224fe-008c-4208-9dd6-b3205f77ca1e";
  assert.deepEqual(await h.app.sync.host.applyBatch({ doc, principal, label: "Agent: Tighten the intro", baseRevision: 1, originDeviceId: desktop.device.deviceId, patches: [{ op: "replace", path: OPACITY, value: 0.5 }] }), { state: "applied", revision: 2 });
  await tick();
  const item = (await phone.call("jagentchill.sync.project.list", { search: "Named authors" })).items[0];
  assert.deepEqual([item.lastAuthorName, item.lastAuthorDisplay], ["Agent", { kind: "agent" }]);
  const info = await phone.call("jagentchill.sync.project.get", { doc });
  assert.deepEqual([info.lastAuthorName, info.lastAuthorDisplay], ["Agent", { kind: "agent" }]);
  // While the agent held the lease, the devices were told who holds it the same way.
  const held = leaseEvents(phone, doc).find((event) => event.reason === "acquired");
  assert.deepEqual([held.lease.holderName, held.lease.holderDisplay], ["Agent", { kind: "agent" }]);
  for (const shown of [item.lastAuthorName, info.lastAuthorName, held.lease.holderName]) assert.doesNotMatch(shown, /agent:|jc:|5a3224fe/);
  // A device that edits and is then removed: the host still has its record, so its last known name stays.
  const leaving = await h.pair("Borrowed tablet", "editor");
  const { lease } = await leaving.call("jagentchill.sync.lease.acquire", { doc });
  await leaving.call("jagentchill.sync.ops.push", { doc, leaseId: lease.leaseId, baseRevision: 2, ops: s.ops(1) });
  await leaving.call("jagentchill.sync.lease.release", { doc, leaseId: lease.leaseId });
  await admin.call("jagentchill.device.revoke", { deviceId: leaving.device.deviceId });
  const after = (await phone.call("jagentchill.sync.project.list", { search: "Named authors" })).items[0];
  assert.deepEqual([after.lastAuthorName, after.lastAuthorDisplay], ["Borrowed tablet", { kind: "device", name: "Borrowed tablet" }]);
});

test("Scenario: Device opens the project during a host batch — acquire returns a lease after the host batch's revision and never LEASE_HELD", async () => {
  const doc = await project(desktop, "During host batch");
  const turn = (await h.app.sync.leases.host.begin(doc, "run:run-3"))!;
  // Host principals are serialised among themselves: a second batch waits for the first.
  let secondDone = false;
  const second = h.app.sync.host.applyBatch({ doc, principal: "automation:auto-1", label: "Automation: Nightly", baseRevision: 2, originDeviceId: "", patches: [{ op: "replace", path: OPACITY, value: 0.2 }] }).then((result) => { secondDone = true; return result; });
  const acquiring = pendingCall(desktop, "jagentchill.sync.lease.acquire", { doc });
  await tick(80);
  assert.equal(acquiring.state.result, undefined, "the device waits for the batch");
  assert.equal(secondDone, false);
  h.app.sync.documents.push(doc, 1, [s.op([{ op: "replace", path: OPACITY, value: 0.7 }])], { kind: "host", principal: "run:run-3" });
  const started = Date.now();
  turn.end();
  await acquiring.done;
  assert.ok(Date.now() - started < 5000);
  assert.equal(acquiring.state.error, undefined);
  assert.ok(acquiring.state.result!.head >= 2, "the lease is granted after the host batch's revision");
  assert.equal(acquiring.state.result!.lease.holderName, "Desktop");
  // The waiting host batch now finds a device holding the lease and hands the batch to it instead of taking the lease.
  await tick(300);
  assert.equal(h.app.sync.leases.current(doc)?.holderName, "Desktop");
  desktop.ws.send(JSON.stringify({ t: "req", id: "ans", method: "jagentchill.sync.applyRemote.result", params: { batchId: s.eventsOf(desktop, "jagentchill.sync.applyRemote").at(-1).batchId, result: "rejected" } }));
  assert.equal((await second).state, "rejected");
});

test("Scenario: Device holds the lease — the holder receives jagentchill.sync.applyRemote, pushes one operation and answers applied", async () => {
  const doc = await project(desktop, "Device holds the lease");
  const { lease } = await desktop.call("jagentchill.sync.lease.acquire", { doc });
  const applying = h.app.sync.host.applyBatch({ doc, principal: "agent:sess-9", label: "Agent: Add captions", baseRevision: 1, originDeviceId: desktop.device.deviceId, patches: [{ op: "replace", path: OPACITY, value: 0.3 }] });
  await tick(60);
  const [remote] = s.eventsOf(desktop, "jagentchill.sync.applyRemote").filter((event) => event.doc.id === doc.id);
  assert.deepEqual([remote.baseRevision, remote.label, remote.patches], [1, "Agent: Add captions", [{ op: "replace", path: OPACITY, value: 0.3 }]]);
  assert.equal(s.eventsOf(phone, "jagentchill.sync.applyRemote").length, 0, "sent only to the connection that holds the lease");
  // The device applies the patches as one step of its own history and pushes the resulting operation.
  await desktop.call("jagentchill.sync.ops.push", { doc, leaseId: lease.leaseId, baseRevision: 1, ops: [s.op(remote.patches, { label: remote.label, commandType: "sync.applyRemote" })] });
  await desktop.call("jagentchill.sync.applyRemote.result", { batchId: remote.batchId, result: "applied" });
  assert.deepEqual(await applying, { state: "applied", revision: 2 });
  const { ops } = await desktop.call("jagentchill.sync.ops.pull", { doc, afterRevision: 1 });
  assert.deepEqual([ops.length, ops[0].author.kind, ops[0].label], [1, "device", "Agent: Add captions"]);
  assert.equal(h.app.sync.leases.current(doc)?.leaseId, lease.leaseId, "no lease change occurred");
});

test("Scenario: Holder is mid-gesture, Scenario: Workflow editor node while a phone holds the lease — busy is retried and the batch is applied once the gesture ended", async () => {
  const doc = await project(phone, "Mid gesture");
  const { lease } = await phone.call("jagentchill.sync.lease.acquire", { doc });
  const before = s.eventsOf(phone, "jagentchill.sync.applyRemote").length;
  const applying = h.app.sync.host.applyBatch({ doc, principal: "run:run-88", label: "Workflow: Weekly recap", baseRevision: 1, originDeviceId: desktop.device.deviceId, patches: [{ op: "replace", path: OPACITY, value: 0.6 }] });
  await tick(50);
  const first = s.eventsOf(phone, "jagentchill.sync.applyRemote")[before];
  assert.equal(first.label, "Workflow: Weekly recap");
  await phone.call("jagentchill.sync.applyRemote.result", { batchId: first.batchId, result: "busy" });
  await tick(100);
  const retry = s.eventsOf(phone, "jagentchill.sync.applyRemote")[before + 1];
  assert.ok(retry && retry.batchId !== first.batchId, "the host retried after the pause");
  await phone.call("jagentchill.sync.ops.push", { doc, leaseId: lease.leaseId, baseRevision: 1, ops: [s.op(retry.patches, { label: retry.label })] });
  await phone.call("jagentchill.sync.applyRemote.result", { batchId: retry.batchId, result: "applied" });
  assert.deepEqual(await applying, { state: "applied", revision: 2 });
});

test("Scenario: Host never takes a device's lease — after five busy answers the batch stays pending as Waiting for <device name>", async () => {
  const doc = await project(tablet, "Never takes");
  const { lease } = await tablet.call("jagentchill.sync.lease.acquire", { doc });
  const before = s.eventsOf(tablet, "jagentchill.sync.applyRemote").length;
  // The tablet never answers: no answer within the limit counts as busy, five times.
  const result = await h.app.sync.host.applyBatch({ doc, principal: "agent:sess-1", label: "Agent: Recolour", baseRevision: 1, originDeviceId: "", patches: [{ op: "replace", path: OPACITY, value: 0.9 }] });
  assert.deepEqual(result, { state: "waiting", deviceName: "Tablet" });
  assert.equal(s.eventsOf(tablet, "jagentchill.sync.applyRemote").length - before, 5);
  assert.equal(h.app.sync.leases.current(doc)?.leaseId, lease.leaseId);
  assert.equal(s.head(doc), 1);
  assert.equal(leaseEvents(tablet, doc).filter((event) => event.reason !== "acquired").length, 0, "no lease change occurred");
});

test("Scenario: Holder hands over — the requester becomes the writer at the latest head and the former holder is told", async () => {
  const doc = await project(desktop, "Hand over");
  const { lease } = await desktop.call("jagentchill.sync.lease.acquire", { doc });
  await phone.call("jagentchill.sync.subscribe", { doc });
  const request = pendingCall(phone, "jagentchill.sync.lease.requestTakeover", { doc });
  await tick(40);
  const asked = leaseEvents(desktop, doc).at(-1);
  assert.deepEqual([asked.reason, asked.request.deviceName, asked.request.kind, asked.request.deadline_ms - asked.request.requested_ms], ["requested", "Phone", "takeover", 30_000]);
  assert.equal(leaseEvents(tablet, doc).length, 0, "only the holder and the document's subscribers are told");
  // "Hand over": the holder flushes its pending operations, then answers.
  await desktop.call("jagentchill.sync.ops.push", { doc, leaseId: lease.leaseId, baseRevision: 1, ops: s.ops(2) });
  await desktop.call("jagentchill.sync.lease.answerTakeover", { doc, accept: true });
  await request.done;
  assert.deepEqual([request.state.result.lease.holderName, request.state.result.head], ["Phone", 3]);
  const told = leaseEvents(desktop, doc).at(-1);
  assert.deepEqual([told.reason, told.lease.holderName, told.previousHolderDeviceId], ["handed-over", "Phone", desktop.device.deviceId]);
  assert.equal((await desktop.fail("jagentchill.sync.ops.push", { doc, leaseId: lease.leaseId, baseRevision: 3, ops: s.ops(1) })).code, "LEASE_NOT_HELD");
  assert.deepEqual(await phone.call("jagentchill.sync.ops.push", { doc, leaseId: request.state.result.lease.leaseId, baseRevision: 3, ops: s.ops(1) }), { revisions: [4], head: 4 });
});

test("Scenario: Holder idle — with no answer for 30 seconds the lease transfers to the requester automatically", async () => {
  const doc = await project(desktop, "Holder idle");
  const { lease } = await desktop.call("jagentchill.sync.lease.acquire", { doc });
  const request = pendingCall(phone, "jagentchill.sync.lease.requestTakeover", { doc });
  await tick(30);
  // The holder's app is alive (it heartbeats) but nobody answers the dialog.
  for (let step = 0; step < 3; step++) { await advance(10_000); await desktop.call("jagentchill.sync.lease.heartbeat", { doc, leaseId: lease.leaseId }); }
  assert.equal(request.state.result, undefined, "the countdown has only just ended; the holder may still be flushing");
  await advance(5_001);
  await request.done;
  assert.equal(request.state.result!.lease.holderName, "Phone");
  assert.equal((await desktop.fail("jagentchill.sync.lease.heartbeat", { doc, leaseId: lease.leaseId })).code, "LEASE_NOT_HELD");
});

test("Scenario: Holder declines — the requester receives TAKEOVER_DECLINED and a second request 20 seconds afterwards is answered TAKEOVER_COOLDOWN", async () => {
  const doc = await project(desktop, "Holder declines");
  const { lease } = await desktop.call("jagentchill.sync.lease.acquire", { doc });
  const asking = answer(phone, "jagentchill.sync.lease.requestTakeover", { doc });
  await tick(40);
  await desktop.call("jagentchill.sync.lease.answerTakeover", { doc, accept: false });
  const declined = (await asking).error;
  assert.deepEqual([declined.code, declined.details.holderName], ["TAKEOVER_DECLINED", "Desktop"]);
  assert.equal(h.app.sync.leases.current(doc)?.leaseId, lease.leaseId);
  await advance(20_000);
  await desktop.call("jagentchill.sync.lease.heartbeat", { doc, leaseId: lease.leaseId });
  const cooldown = await phone.fail("jagentchill.sync.lease.requestTakeover", { doc });
  assert.deepEqual([cooldown.code, cooldown.retryable], ["TAKEOVER_COOLDOWN", true]);
  assert.ok(cooldown.details.retryAfter_ms > 39_000 && cooldown.details.retryAfter_ms <= 40_000, String(cooldown.details.retryAfter_ms));
  // Another device is not in that cooldown, and after 60 seconds the first one may ask again.
  for (const step of [20_000, 20_001]) { await advance(step); await desktop.call("jagentchill.sync.lease.heartbeat", { doc, leaseId: lease.leaseId }); }
  const again = answer(phone, "jagentchill.sync.lease.requestTakeover", { doc });
  await tick(40);
  assert.equal(leaseEvents(desktop, doc).at(-1).reason, "requested");
  await desktop.call("jagentchill.sync.lease.answerTakeover", { doc, accept: true });
  assert.equal((await again).ok, true);
});

test("Scenario: Admin forces takeover with unpushed work on the holder — the admin gets the lease immediately, the holder alone is told, and the takeover is audited", async () => {
  const doc = await project(desktop, "Forced");
  const holder = await connect(desktop, "offline-soon");
  const { lease } = await holder.call("jagentchill.sync.lease.acquire", { doc });
  await holder.close();
  const denied = await phone.fail("jagentchill.sync.lease.forceTake", { doc });
  assert.deepEqual([denied.code, denied.details.requiredScope], ["SCOPE_DENIED", "jagentchill.devices.manage"]);
  const taken = await admin.call("jagentchill.sync.lease.forceTake", { doc });
  assert.deepEqual([taken.lease.holderName, taken.head], ["Studio Mac", 1]);
  assert.deepEqual(h.audit("sync.lease.forceTake").at(-1)?.doc, doc);
  assert.equal(h.audit("sync.lease.forceTake").at(-1)?.actor, `device:${admin.device.deviceId}`);
  // When the former holder reconnects, its unpushed operations cannot be pushed: they are its offline branch.
  const back = await connect(desktop, "offline-soon");
  const held = await back.fail("jagentchill.sync.lease.acquire", { doc });
  assert.deepEqual([held.code, held.details.holderName], ["LEASE_HELD", "Studio Mac"]);
  assert.equal((await back.fail("jagentchill.sync.ops.push", { doc, leaseId: lease.leaseId, baseRevision: 1, ops: s.ops(4) })).code, "LEASE_NOT_HELD");
  assert.equal(s.head(doc), 1);
  await back.close();
});

test("Scenario: Transfer target rejects — when the chosen device declines or does not answer within 30 seconds the holder keeps the lease", async () => {
  const doc = await project(desktop, "Transfer");
  const { lease } = await desktop.call("jagentchill.sync.lease.acquire", { doc });
  await tablet.call("jagentchill.presence.heartbeat", { deviceType: "tablet", appVisible: true, supportedSchemaVersion: { project: 32, script: 1, workflow: 1 }, lastActivity_ms: now() });
  const offering = answer(desktop, "jagentchill.sync.lease.transfer", { doc, toDeviceId: tablet.device.deviceId });
  await tick(40);
  const offer = leaseEvents(tablet, doc).at(-1);
  assert.deepEqual([offer.reason, offer.request.kind, offer.request.deviceName], ["offered", "transfer", "Desktop"]);
  await tablet.call("jagentchill.sync.lease.answerTakeover", { doc, accept: false });
  const declined = (await offering).error;
  assert.deepEqual([declined.code, declined.details.deviceName, declined.details.reason], ["TAKEOVER_DECLINED", "Tablet", "declined"]);
  assert.equal(h.app.sync.leases.current(doc)?.leaseId, lease.leaseId);

  // No answer within 30 seconds.
  const silent = answer(desktop, "jagentchill.sync.lease.transfer", { doc, toDeviceId: tablet.device.deviceId });
  await tick(30);
  for (let step = 0; step < 3; step++) { await advance(10_000); await desktop.call("jagentchill.sync.lease.heartbeat", { doc, leaseId: lease.leaseId }); }
  await advance(1);
  assert.deepEqual([(await silent).error.code, (await silent).error.details.reason], ["TAKEOVER_DECLINED", "timeout"]);
  assert.equal(h.app.sync.leases.current(doc)?.leaseId, lease.leaseId);

  // An accepted transfer moves the lease; a device that is not connected cannot be chosen.
  const accepted = answer(desktop, "jagentchill.sync.lease.transfer", { doc, toDeviceId: tablet.device.deviceId });
  await tick(40);
  assert.equal((await tablet.call("jagentchill.sync.lease.answerTakeover", { doc, accept: true })).lease.holderName, "Tablet");
  assert.equal((await accepted).result.lease.holderName, "Tablet");
  assert.equal((await answer(tablet, "jagentchill.sync.lease.transfer", { doc, toDeviceId: "f".repeat(64) })).error.details.reason, "offline");
});

test("a revoked device loses its lease at once", async () => {
  const doc = await project(desktop, "Revoked");
  await guest.call("jagentchill.sync.lease.acquire", { doc });
  await admin.call("jagentchill.device.revoke", { deviceId: guest.device.deviceId });
  assert.equal(h.app.sync.leases.current(doc), null);
  assert.equal((await desktop.call("jagentchill.sync.lease.acquire", { doc })).lease.holderName, "Desktop");
});
