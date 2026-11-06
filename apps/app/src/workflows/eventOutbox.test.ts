import assert from "node:assert/strict";
import { test } from "node:test";
import { createEventOutbox, refusalKind, type PendingEvent } from "./eventOutbox.ts";

const memory = () => { const data = new Map<string, string>(); return { get: (key: string) => data.get(key) ?? null, set: (key: string, value: string) => void data.set(key, value) }; };
const exported = (id: string, hostId = "host-a"): Omit<PendingEvent, "queued_ms"> => ({ id, hostId, event: "export.finished", fields: { projectId: "p1", fileName: `${id}.mp4` } });

test("An export that ends while the host cannot be reached is told after the reconnect: it is kept before it is sent, survives a restart of the app, and leaves the list only when the host has answered", async () => {
  const store = memory(), outbox = createEventOutbox(store);
  outbox.add(exported("job-1"));
  outbox.add(exported("job-2"));
  outbox.add(exported("job-1"));
  assert.deepEqual(outbox.pending().map((entry) => entry.id), ["job-1", "job-2"], "the same export is one event");
  // The connection is gone: the call fails, and nothing is forgotten.
  const down = await outbox.flush("host-a", async () => { throw Object.assign(new Error("not connected"), { code: "UNAVAILABLE" }); });
  assert.deepEqual([down.sent, down.left], [0, 2]);
  // The first is answered, then the connection drops again: only the answered one is gone.
  let calls = 0;
  const half = await outbox.flush("host-a", async () => { if (++calls === 2) throw new Error("socket closed"); return { runs: [] }; });
  assert.deepEqual([half.sent, half.left, outbox.pending().map((entry) => entry.id)], [1, 1, ["job-2"]]);
  // The app is closed and opened again: what waits is read from the device's store.
  outbox.add(exported("job-3", "host-b"));
  const reopened = createEventOutbox(store), told: string[] = [];
  const up = await reopened.flush("host-a", async (entry) => { told.push(`${entry.event}:${entry.id}`); });
  assert.deepEqual([told, up.left], [["export.finished:job-2"], 0]);
  assert.deepEqual(reopened.pending().map((entry) => [entry.hostId, entry.id]), [["host-b", "job-3"]], "an export made for another host waits for that host");
});

// — w2 run 4, item 6 —
test("An export the host REFUSED is kept until it is delivered or the person removes it: a device without the permission (SCOPE_DENIED) loses nothing, the event says why it waits, the exports after it are still told, and once the permission is back it is delivered", async () => {
  let clock = 5_000, allowed = false;
  const store = memory(), outbox = createEventOutbox(store, () => clock), told: string[] = [];
  outbox.add(exported("job-1")); outbox.add(exported("job-2"));
  // The host answers — and its answer is no: this device may not report events.
  const host = async (entry: PendingEvent) => { if (!allowed) throw Object.assign(new Error("This device lacks the scope jagentchill.automations.run"), { code: "SCOPE_DENIED" }); told.push(entry.id); };
  const denied = await outbox.flush("host-a", host);
  assert.deepEqual([denied.sent, denied.left, denied.refused], [0, 2, 2], "both were tried (the host is there), neither was dropped");
  assert.deepEqual(outbox.pending("host-a").map((entry) => [entry.id, entry.refused?.code, entry.refused?.at_ms]), [["job-1", "SCOPE_DENIED", 5_000], ["job-2", "SCOPE_DENIED", 5_000]]);
  assert.equal(refusalKind("SCOPE_DENIED"), "permission");
  // Over a restart of the app, and however long it takes.
  clock += 30 * 86_400_000;
  const reopened = createEventOutbox(store, () => clock);
  assert.deepEqual(reopened.pending("host-a").map((entry) => entry.refused?.code), ["SCOPE_DENIED", "SCOPE_DENIED"]);
  // A host that does not take such an event at all (another version) says so differently; the event is kept the same way.
  reopened.add(exported("job-3"));
  await reopened.flush("host-a", async () => { throw Object.assign(new Error("Unknown field"), { code: "INVALID_PARAMS" }); });
  assert.deepEqual([reopened.pending("host-a").length, refusalKind(reopened.pending("host-a")[2].refused!.code)], [3, "not_accepted"]);
  // The person removes one themselves; an admin gives the device its permission back; "Try now" delivers the rest.
  reopened.remove("host-a", "job-3");
  allowed = true;
  const delivered = await reopened.flush("host-a", host);
  assert.deepEqual([delivered.sent, delivered.left, told, reopened.pending("host-a")], [2, 0, ["job-1", "job-2"], []]);
});

test("An unacknowledged export stays until it is delivered or the person removes it: the list is not cut at any length, nothing expires when another is added, a store that cannot be written loses nothing, and removal is the person's act", async () => {
  let clock = 1_000;
  const store = memory(), outbox = createEventOutbox(store, () => clock);
  for (let n = 1; n <= 201; n++) outbox.add(exported(`job-${n}`));
  assert.equal(outbox.pending("host-a").length, 201, "201 unsent exports are 201 pending events");
  // Three months later another export ends: the old ones are still waiting.
  clock += 90 * 86_400_000;
  outbox.add(exported("job-202"));
  assert.deepEqual([outbox.pending("host-a").length, outbox.pending("host-a")[0].id], [202, "job-1"]);
  assert.equal(createEventOutbox(store).pending("host-a").length, 202, "and all of them are in the device's store");
  // The device's store refuses a write: what is in memory is still told.
  const full = createEventOutbox({ get: () => null, set: () => { throw new Error("QuotaExceededError"); } }), told: string[] = [];
  full.add(exported("job-a")); full.add(exported("job-b"));
  await full.flush("host-a", async (entry) => { told.push(entry.id); });
  assert.deepEqual([told, full.pending().length], [["job-a", "job-b"], 0]);
  // The person removes one, then all that wait for this host; the screens that show the count are told.
  let changes = 0;
  const off = outbox.subscribe(() => { changes += 1; });
  outbox.add(exported("job-x", "host-b"));
  outbox.remove("host-a", "job-1");
  assert.equal(outbox.pending("host-a").length, 201);
  outbox.remove("host-a");
  off();
  assert.deepEqual([outbox.pending("host-a").length, outbox.pending("host-b").map((entry) => entry.id), changes], [0, ["job-x"], 3]);
});
