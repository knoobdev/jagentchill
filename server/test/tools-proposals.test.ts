// The Gateway in these tests is the FAKE of `harness.ts`; devices are simulated. The server, sync, leases and proposals are real.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { acceptPatch, canonicalJson, timeline, type StatePatch } from "@jagentchill/editor-core";
import type { ProjectDocument } from "@jagentchill/protocol";
import { tick } from "./harness.ts";
import { S, follower, key, toolWorld } from "./support/tools.ts";

const withoutStamp = (doc: ProjectDocument) => canonicalJson({ ...doc, metadata: { ...doc.metadata, updated_ms: 0 } });
let proposalScenario = 0;
async function proposalWorld(options: Parameters<typeof toolWorld>[0] = {}) {
  const root = process.env.W12H_PROPOSAL_DATA_ROOT, port = Number(process.env.JAGENTCHILL_PORT);
  if (!root || port < 19100 || port > 19104) throw new Error("proposal reproduction requires W12H_PROPOSAL_DATA_ROOT and a JAGENTCHILL_PORT in 19100–19104");
  const dataDir = join(root, `scenario-${++proposalScenario}`);
  mkdirSync(dataDir, { recursive: true });
  return toolWorld({ ...options, harness: { ...options.harness, dataDir, listenPort: port } });
}

test("Accept; Headless accept; an accepted proposal produces operations another device receives; Dependencies; A write is logged", async () => {
  const w = await toolWorld();
  const phone = await follower(w.h, "Phone", w.doc, w.head(), w.revision());
  await w.admin.call("jagentchill.session.subscribe", {});
  const base = w.revision();
  const text = await w.write("jc_text_add", { content: "DA LAT IN 48 HOURS", start: 0, duration: 3 * S });
  const effect = await w.write("jc_effect_apply", { target: { elementIds: [text.data.elementId] }, effectId: "blur" });
  await w.write("jc_clip_trim", { elementId: w.project.clipA, edge: "end", delta: -2 * S });
  await w.write("jc_marker_edit", { action: "add", time: 2 * S, note: "Hook" });
  const expected = await w.proposed();
  const proposalId = await w.submit("Tighter intro with title card");
  const view = (await w.admin.call("jagentchill.proposal.get", { proposalId })).proposal;
  assert.equal(view.state, "pending");
  assert.equal(view.title, "Tighter intro with title card");
  assert.equal(view.author.sessionId, w.sessionKey);
  assert.deepEqual(view.elements.added, [text.data.elementId]);
  assert.ok(view.elements.modified.includes(w.project.clipA));
  assert.equal(view.durationBefore, 30 * S);
  assert.equal(view.proposedDuration, 30 * S, "the music still ends at 30 s");
  assert.ok(view.elements.modified.includes(w.project.clipB), "the magnet moved the following clip");
  assert.ok(view.affectedDuration > 0);
  assert.equal(view.framesUnavailable, true, "no renderer: the card shows the counts without thumbnails");
  assert.equal(view.totals.add >= 2, true);
  assert.ok(effect.data.effectInstanceId);
  assert.deepEqual(view.changes[1].dependsOn, [view.changes[0].changeId], "the effect change depends on the change that added its element");
  // The preview descriptor is the patch list a client applies to its copy to draw the proposed state.
  assert.equal(withoutStamp(acceptPatch(w.head(), view.preview.patches as StatePatch)), withoutStamp(expected));
  assert.equal(w.revision(), base);

  // Nobody is editing: the host takes the lease as the agent's session, applies one batch and releases it.
  const accepted = await w.accept(proposalId);
  assert.equal(accepted.proposal.state, "accepted");
  assert.equal(accepted.revision, base + 1);
  assert.equal(w.revision(), base + 1);
  assert.equal(withoutStamp(w.head()), withoutStamp(expected), "every change of the proposal is in the project");
  assert.equal(w.h.app.sync.leases.current(w.doc), null, "the host lease is released");
  // The second device receives the batch through the operation log and ends with the same document.
  assert.deepEqual(await phone.pull(), ["Agent: Tighter intro with title card"]);
  assert.equal(canonicalJson(phone.document), canonicalJson(w.head()));
  assert.equal(phone.opsEvents().length, 1, "the batch was announced to the subscribed device as it happened");
  assert.deepEqual(phone.opsEvents()[0].payload.ops[0].author, { kind: "host", principal: `agent:${w.sessionKey}` });
  // The outcome reaches the agent as a message that opens a turn; the resolution is audited.
  await tick(30);
  const delivered = w.h.fake.callsOf("startTurn").at(-1);
  assert.match(delivered.message, /was accepted and applied/);
  assert.match(delivered.message, new RegExp(proposalId));
  assert.deepEqual([w.h.audit("proposal.resolve")[0].action, w.h.audit("proposal.resolve")[0].state, w.h.audit("proposal.resolve")[0].revisionAfter], ["accept", "accepted", base + 1]);
  assert.ok(w.admin.events.some((event) => event.event === "jagentchill.proposal.updated" && event.payload.proposal.state === "applying"));
  // The session can stage again.
  assert.equal((await w.write("jc_clip_rename", { elementId: w.project.clipB, name: "Interview" })).ok, true);
  w.close();
});

test("Proposal conflict reproduction: a second delivery is a no-op that reports already applied", async () => {
  const w = await proposalWorld({ empty: true });
  const video = await w.write("jc_clip_add", { assetId: w.project.assets.drone, duration: 10 * S, start: 0 });
  const music = await w.write("jc_clip_add", { assetId: w.project.assets.music, duration: 40 * S, start: 0, newTrack: { zone: "audio", type: "audio" } });
  const proposalId = await w.submit("Add the music for 40 s");
  const before = w.revision();
  const first = await w.admin.call("jagentchill.proposal.resolve", { proposalId, action: "accept" });
  assert.deepEqual([first.proposal.state, first.revision, w.revision()], ["accepted", before + 1, before + 1]);
  assert.equal(w.scene(w.head()).tracks.audio.flatMap((track: any) => track.elements).filter((element: any) => element.mediaId === w.project.assets.music).length, 1);
  const duplicate = await w.admin.call("jagentchill.proposal.resolve", { proposalId, action: "accept" });
  assert.deepEqual([duplicate.proposal.state, duplicate.revision, duplicate.alreadyApplied, w.revision()], ["accepted", before + 1, true, before + 1]);
  await tick(30);
  assert.equal(w.h.fake.callsOf("startTurn").filter((call) => call.message.includes(proposalId)).length, 1, "duplicate delivery does not tell the model twice");
  assert.equal(video.ok && music.ok, true);
  w.close();
});

test("Proposal conflict reproduction: a sync revision bump after the read is rebased; a second old proposal applies", async () => {
  const w = await proposalWorld({ empty: true });
  await w.write("jc_clip_add", { assetId: w.project.assets.drone, duration: 10 * S, start: 0 });
  const secondSession = await w.session();
  const firstWrite = await w.write("jc_clip_add", { assetId: w.project.assets.music, duration: 40 * S, start: 0, newTrack: { zone: "audio", type: "audio" } });
  const firstId = await w.submit("Add the music for 40 s");
  const secondWrite = await w.write("jc_text_add", { content: "Da Lat", start: 0, duration: 2 * S }, secondSession);
  const secondId = await w.submit("Add a title", secondSession);
  const base = w.revision();
  // A sync autosave changes an unrelated project field after both proposals were staged.
  const editor = await w.h.pair("Laptop", "editor"), lease = (await editor.call("jagentchill.sync.lease.acquire", { doc: w.doc })).lease;
  await editor.call("jagentchill.sync.ops.push", { doc: w.doc, leaseId: lease.leaseId, baseRevision: base, ops: [w.s.op([{ op: "replace", path: "/metadata/name", value: "Saved between read and accept" }])] });
  await editor.call("jagentchill.sync.lease.release", { doc: w.doc, leaseId: lease.leaseId });
  const bumped = w.revision();
  const first = await w.admin.call("jagentchill.proposal.resolve", { proposalId: firstId, action: "accept" });
  const second = await w.admin.call("jagentchill.proposal.resolve", { proposalId: secondId, action: "accept" });
  assert.deepEqual([first.proposal.state, second.proposal.state, first.revision, second.revision], ["accepted", "accepted", bumped + 1, bumped + 2]);
  assert.equal(w.scene(w.head()).tracks.audio.flatMap((track: any) => track.elements).filter((element: any) => element.mediaId === w.project.assets.music).length, 1);
  assert.ok(firstWrite.ok && secondWrite.ok);
  w.close();
});

test("Proposal conflict reproduction: editor must not report applied when its sync push did not reach the host", async () => {
  const w = await proposalWorld({ empty: true });
  await w.write("jc_clip_add", { assetId: w.project.assets.drone, duration: 10 * S, start: 0 });
  await w.write("jc_clip_add", { assetId: w.project.assets.music, duration: 40 * S, start: 0, newTrack: { zone: "audio", type: "audio" } });
  const proposalId = await w.submit("Add the music for 40 s");
  const editor = await w.h.pair("Editor", "editor"), lease = (await editor.call("jagentchill.sync.lease.acquire", { doc: w.doc })).lease;
  editor.ws.on("message", (data: { toString(): string }) => {
    const frame = JSON.parse(data.toString());
    if (frame.t === "evt" && frame.event === "jagentchill.sync.applyRemote") void editor.call("jagentchill.sync.applyRemote.result", { batchId: frame.payload.batchId, result: "applied" });
  });
  const before = w.revision();
  const result = await w.admin.call("jagentchill.proposal.resolve", { proposalId, action: "accept" });
  assert.deepEqual([result.proposal.state, w.revision(), w.scene(w.head()).tracks.audio.flatMap((track: any) => track.elements).length], ["failed", before, 0]);
  assert.equal(result.proposal.error?.code, "CONFLICT");
  await tick(30);
  const outcomes = w.h.fake.callsOf("startTurn").filter((call) => call.message.includes(proposalId));
  assert.deepEqual([outcomes.length, outcomes[0]?.message.includes(`revision ${before}`)], [1, true], "the model is told once, with the unchanged host revision");
  await editor.call("jagentchill.sync.lease.release", { doc: w.doc, leaseId: lease.leaseId });
  w.close();
});

test("Reject with feedback; Double resolve; Device without the write scope; Viewer cannot revert", async () => {
  const w = await proposalWorld();
  const viewer = await w.h.pair("Lobby screen", "viewer");
  const before = canonicalJson(w.head()), base = w.revision();
  await w.write("jc_clip_delete", { elementIds: [w.project.clipA] });
  const proposalId = await w.submit("Drop the intro");
  assert.equal((await viewer.fail("jagentchill.proposal.resolve", { proposalId, action: "accept" })).code, "SCOPE_DENIED");
  assert.equal((await viewer.fail("jagentchill.proposal.revert", { proposalId })).code, "SCOPE_DENIED");
  assert.equal(w.h.app.tools.proposal(proposalId)!.state, "pending");
  const rejected = await w.admin.call("jagentchill.proposal.resolve", { proposalId, action: "reject", feedback: "do not touch the intro" });
  assert.deepEqual([rejected.proposal.state, rejected.proposal.feedback], ["rejected", "do not touch the intro"]);
  assert.equal(canonicalJson(w.head()), before);
  assert.equal(w.revision(), base);
  await tick(30);
  assert.match(w.h.fake.callsOf("startTurn").at(-1).message, /was rejected with this feedback: do not touch the intro/);
  // Resolved exactly once.
  assert.equal((await w.admin.fail("jagentchill.proposal.resolve", { proposalId, action: "accept" })).code, "PROPOSAL_CLOSED");
  // Two devices accepting the same proposal: the first wins.
  await w.write("jc_clip_rename", { elementId: w.project.clipA, name: "Opening" });
  const second = await w.submit("Rename"), editor = await w.h.pair("Laptop", "editor");
  const results = await Promise.all([w.admin.call("jagentchill.proposal.resolve", { proposalId: second, action: "accept" }).then((result) => result), editor.call("jagentchill.proposal.resolve", { proposalId: second, action: "accept" }).then((result) => result)]);
  assert.deepEqual(results.map((result) => [result.proposal.state, result.alreadyApplied === true]), [["accepted", false], ["accepted", true]]);
  assert.equal(w.revision(), base + 1, "two surfaces accepting one proposal commit one operation");
  w.close();
});

test("Subset applied; Missing dependency", async () => {
  const w = await toolWorld();
  const split = await w.write("jc_clip_split", { elementIds: [w.project.clipA], times: [4 * S] });
  const trim = await w.write("jc_clip_trim", { elementId: split.data.elementIds[1], edge: "end", delta: -1 * S });
  const rename = await w.write("jc_clip_rename", { elementId: w.project.clipB, name: "Interview" });
  const marker = await w.write("jc_marker_edit", { action: "add", time: 2 * S });
  const proposalId = await w.submit();
  // The trim builds on the split: selecting it alone is refused and names the split.
  const missing = await w.admin.fail("jagentchill.proposal.resolve", { proposalId, action: "accept_partial", changeIds: [trim.changeIds![0], rename.changeIds![0]] });
  assert.equal(missing.code, "INVALID_PARAMS");
  assert.deepEqual(missing.details.missing, [split.changeIds![0]]);
  assert.equal(w.h.app.tools.proposal(proposalId)!.state, "pending");
  const partial = await w.admin.call("jagentchill.proposal.resolve", { proposalId, action: "accept_partial", changeIds: [rename.changeIds![0], marker.changeIds![0]] });
  assert.equal(partial.proposal.state, "partially_accepted");
  assert.deepEqual(partial.proposal.acceptedChangeIds, [rename.changeIds![0], marker.changeIds![0]]);
  const head = w.head(), scene = w.scene(head);
  assert.equal(timeline.located(head, w.project.clipB).element.name, "Interview");
  assert.equal(scene.markers.length, 1);
  assert.equal(scene.tracks.main.elements.length, 2, "the split was discarded with the rest");
  // With includeDependencies the missing changes are added.
  const again = await toolWorld();
  const a = await again.write("jc_clip_split", { elementIds: [again.project.clipA], times: [4 * S] });
  const b = await again.write("jc_clip_trim", { elementId: a.data.elementIds[1], edge: "end", delta: -1 * S });
  const id2 = await again.submit();
  const both = await again.admin.call("jagentchill.proposal.resolve", { proposalId: id2, action: "accept_partial", changeIds: [b.changeIds![0]], includeDependencies: true });
  assert.deepEqual(both.proposal.acceptedChangeIds, [a.changeIds![0], b.changeIds![0]]);
  assert.equal(again.scene(again.head()).tracks.main.elements.length, 3);
  again.close();
  w.close();
});

test("Unrelated manual edit; Conflicting manual edit; Expiry; Proposal revert before acceptance", async () => {
  let clock = Date.now();
  const w = await proposalWorld({ harness: { now: () => clock } });
  const laptop = await w.h.pair("Laptop", "editor");
  // The device edits the project (a marker's note) after the proposal was staged.
  await w.write("jc_clip_trim", { elementId: w.project.clipA, edge: "end", delta: -2 * S });
  const stale1 = await w.submit("Trim the intro");
  const lease = (await laptop.call("jagentchill.sync.lease.acquire", { doc: w.doc })).lease;
  await laptop.call("jagentchill.sync.ops.push", { doc: w.doc, leaseId: lease.leaseId, baseRevision: w.revision(), ops: [w.s.op([{ op: "replace", path: "/metadata/name", value: "Renamed on the laptop" }])] });
  await laptop.call("jagentchill.sync.lease.release", { doc: w.doc, leaseId: lease.leaseId });
  const rebased = await w.accept(stale1);
  assert.equal(rebased.proposal.state, "accepted", "an unrelated edit does not stop the proposal: it is rebased and applied");
  assert.equal(w.head().metadata.name, "Renamed on the laptop");
  assert.equal(timeline.located(w.head(), w.project.clipA).element.duration, 8 * S);
  // The device deletes the clip the next proposal trims.
  await w.write("jc_clip_trim", { elementId: w.project.clipB, edge: "end", delta: -2 * S });
  const stale2 = await w.submit("Trim the interview");
  const lease2 = (await laptop.call("jagentchill.sync.lease.acquire", { doc: w.doc })).lease;
  await laptop.call("jagentchill.sync.ops.push", { doc: w.doc, leaseId: lease2.leaseId, baseRevision: w.revision(), ops: [w.s.op([{ op: "remove", path: `/scenes/@${w.project.sceneId}/tracks/main/elements/@${w.project.clipB}` }, { op: "replace", path: "/metadata/duration", value: 8 * S }])] });
  await laptop.call("jagentchill.sync.lease.release", { doc: w.doc, leaseId: lease2.leaseId });
  const refused = await w.admin.call("jagentchill.proposal.resolve", { proposalId: stale2, action: "accept" });
  assert.deepEqual([refused.proposal.state, refused.proposal.error?.code, refused.proposal.error?.details?.currentRevision], ["stale", "PROPOSAL_STALE", w.revision()]);
  assert.match(refused.proposal.error?.message ?? "", /timeline changed.*Current revision/);
  assert.ok(refused.proposal.error?.details?.changed?.some((entry: any) => entry.reason.includes("No element has the id")));
  await tick(30);
  const outcomes = w.h.fake.callsOf("startTurn").filter((call) => call.message.includes(stale2));
  assert.deepEqual([outcomes.length, outcomes[0]?.message.includes(`Current revision is ${w.revision()}`)], [1, true]);
  assert.equal(w.h.app.tools.proposal(stale2)!.state, "stale");
  // A stale proposal frees the session to open a new one.
  await w.write("jc_clip_rename", { elementId: w.project.clipA, name: "Opening" });
  // Before submitting, staged changes can be taken back: dependants go with them.
  const split = await w.write("jc_clip_split", { elementIds: [w.project.clipA], times: [4 * S] });
  const dependent = await w.write("jc_clip_rename", { elementId: split.data.elementIds[1], name: "Tail" });
  const taken = await w.ok("jc_proposal_revert", { changeIds: split.changeIds });
  assert.deepEqual(new Set(taken.data.removedChangeIds), new Set([split.changeIds![0], dependent.changeIds![0]]));
  assert.equal(taken.data.changeCount, 1);
  assert.equal(w.scene(await w.proposed()).tracks.main.elements.length, 1);
  // Seven days without a decision: expired, and the session can stage again.
  const pending = await w.submit("Rename");
  clock += 7 * 86_400_000 + 1000;
  assert.equal((await w.admin.call("jagentchill.proposal.get", { proposalId: pending })).proposal.state, "expired");
  assert.equal((await w.admin.fail("jagentchill.proposal.resolve", { proposalId: pending, action: "accept" })).code, "PROPOSAL_CLOSED");
  assert.equal((await w.write("jc_clip_rename", { elementId: w.project.clipA, name: "Again" })).ok, true);
  w.close();
});

test("Revert from another device; Revert keeps unrelated edits; Conflict on revert; Inverse expired", async () => {
  let clock = Date.now();
  const w = await toolWorld({ harness: { now: () => clock } });
  const phone = await w.h.pair("Phone", "editor");
  const before = withoutStamp(w.head());
  const text = await w.write("jc_text_add", { content: "Title", start: 0, duration: 3 * S });
  await w.write("jc_clip_trim", { elementId: w.project.clipA, edge: "end", delta: -2 * S });
  const proposalId = await w.submit("Title and trim");
  await w.accept(proposalId);
  assert.equal(w.h.app.tools.proposal(proposalId)!.revert?.state, "available");
  // Three unrelated edits on the phone afterwards.
  const lease = (await phone.call("jagentchill.sync.lease.acquire", { doc: w.doc })).lease;
  await phone.call("jagentchill.sync.ops.push", { doc: w.doc, leaseId: lease.leaseId, baseRevision: w.revision(), ops: [w.s.op([{ op: "replace", path: `/scenes/@${w.project.sceneId}/tracks/audio/@${w.project.musicTrack}/elements/@${w.project.music}/volume`, value: -6 }])] });
  await phone.call("jagentchill.sync.lease.release", { doc: w.doc, leaseId: lease.leaseId });
  // The phone reverts the proposal the next day: the stored inverse is applied as a new change.
  clock += 86_400_000;
  const reverted = await phone.call("jagentchill.proposal.revert", { proposalId });
  assert.equal(reverted.proposal.revert.state, "reverted");
  assert.equal(reverted.proposal.revert.revertedByName, "Phone");
  const head = w.head();
  assert.equal(timeline.locate(head, text.data.elementId), undefined, "the title is gone");
  assert.equal(timeline.located(head, w.project.clipA).element.duration, 10 * S);
  assert.equal(timeline.located(head, w.project.music).element.volume, -6, "the newer edit stays");
  const last = (await phone.call("jagentchill.sync.ops.pull", { doc: w.doc, afterRevision: w.revision() - 1 })).ops[0];
  assert.equal(last.label, "Revert Agent: Title and trim");
  assert.equal((await phone.fail("jagentchill.proposal.revert", { proposalId })).code, "PROPOSAL_CLOSED", "a proposal is reverted once");
  void before;

  // A newer edit touched an element the proposal changed: refused, then "Revert anyway" skips it.
  const added = await w.write("jc_text_add", { content: "Second", start: 5 * S, duration: 2 * S });
  await w.write("jc_clip_rename", { elementId: w.project.clipB, name: "Interview" });
  const second = await w.submit("Second title");
  await w.accept(second);
  const lease2 = (await phone.call("jagentchill.sync.lease.acquire", { doc: w.doc })).lease;
  const track = timeline.located(w.head(), added.data.elementId).track.id;
  await phone.call("jagentchill.sync.ops.push", { doc: w.doc, leaseId: lease2.leaseId, baseRevision: w.revision(), ops: [w.s.op([{ op: "replace", path: `/scenes/@${w.project.sceneId}/tracks/overlay/@${track}/elements/@${added.data.elementId}/content`, value: "Edited by hand" }])] });
  await phone.call("jagentchill.sync.lease.release", { doc: w.doc, leaseId: lease2.leaseId });
  const conflict = await phone.fail("jagentchill.proposal.revert", { proposalId: second });
  assert.equal(conflict.code, "CONFLICT");
  assert.ok(conflict.details.conflicts.some((entry: any) => entry.entityId === added.data.elementId && entry.kind === "element"));
  const forced = await phone.call("jagentchill.proposal.revert", { proposalId: second, force: true });
  assert.ok(forced.skipped.some((entry: any) => entry.entityId === added.data.elementId));
  assert.equal(timeline.located(w.head(), added.data.elementId).element.content, "Edited by hand", "the hand-edited element is left alone");
  assert.notEqual(timeline.located(w.head(), w.project.clipB).element.name, "Interview", "the untouched part of the proposal is reverted");

  // After 30 days the inverse is gone.
  await w.write("jc_clip_rename", { elementId: w.project.clipA, name: "Old" });
  const third = await w.submit("Old rename");
  await w.accept(third);
  clock += 31 * 86_400_000;
  assert.equal((await phone.fail("jagentchill.proposal.revert", { proposalId: third })).code, "NOT_FOUND");
  assert.equal((await phone.call("jagentchill.proposal.get", { proposalId: third })).proposal.revert, undefined);
  w.close();
});

test("Another agent holds the writer token; Second agent tries to edit; Release on submit; Two unrelated sessions", async () => {
  const w = await toolWorld();
  const second = await w.session();
  await w.admin.call("jagentchill.session.update", { sessionKey: w.sessionKey, title: "Editor One" });
  await w.write("jc_clip_rename", { elementId: w.project.clipA, name: "Held" });
  assert.equal(w.h.app.tools.writerOf(w.doc.id), w.sessionKey);
  const held = await w.writeFails("jc_clip_split", { elementIds: [w.project.clipB], times: [15 * S] }, second);
  assert.deepEqual([held.code, held.retryable, held.details?.holderTitle, held.details?.holderSessionId], ["WRITER_HELD", true, "Editor One", w.sessionKey]);
  assert.match(held.message, /being edited by Editor One in another session/);
  assert.equal(w.h.app.tools.currentProposal(second), undefined, "nothing is staged for the second agent");
  // Reads, dry runs and the status are not writes.
  assert.equal((await w.ok("jc_timeline_snapshot", {}, second)).ok, true);
  assert.equal((await w.ok("jc_clip_split", { elementIds: [w.project.clipB], times: [15 * S], dryRun: true, idempotencyKey: key() }, second)).ok, true);
  // The chat of the second session gets one card for it.
  assert.equal((await w.admin.call("jagentchill.proposal.list", { sessionKey: second })).notices[0].code, "WRITER_HELD");
  // Submitting frees the token; the second agent stages its own proposal on the same project.
  await w.submit("Rename");
  assert.equal(w.h.app.tools.writerOf(w.doc.id), undefined);
  const now = await w.write("jc_clip_split", { elementIds: [w.project.clipB], times: [15 * S] }, second);
  assert.equal(now.ok, true);
  assert.equal(w.h.app.tools.writerOf(w.doc.id), second);
  // Discarding frees it too.
  await w.ok("jc_proposal_discard", {}, second);
  assert.equal(w.h.app.tools.writerOf(w.doc.id), undefined);
  w.close();
});

test("Accept on the device that is editing; Another device is editing; Lease holder is busy; Host never displaces a device", async () => {
  const w = await toolWorld({ harness: { sync: { timings: { applyRemoteAnswerMs: 150, applyRemoteRetryMs: 20 } } } });
  const desktop = await w.h.pair("Desktop", "editor"), phone = await w.h.pair("Phone", "editor");
  const lease = (await desktop.call("jagentchill.sync.lease.acquire", { doc: w.doc })).lease;
  await w.write("jc_clip_rename", { elementId: w.project.clipA, name: "Opening" });
  const proposalId = await w.submit("Rename the opening");
  // The desktop holds the lease: the batch is handed to it; it applies the patches and pushes the resulting operation.
  let answer: "applied" | "busy" = "applied";
  const requests: any[] = [];
  desktop.ws.on("message", (data: { toString(): string }) => {
    const frame = JSON.parse(data.toString());
    if (frame.t !== "evt" || frame.event !== "jagentchill.sync.applyRemote") return;
    requests.push(frame.payload);
    void (async () => {
      if (answer === "applied") await desktop.call("jagentchill.sync.ops.push", { doc: w.doc, leaseId: lease.leaseId, baseRevision: frame.payload.baseRevision, ops: [{ opId: randomUUID(), created_ms: Date.now(), commandType: "sync.applyRemote", label: frame.payload.label, patches: frame.payload.patches, schemaVersion: 32 }] });
      await desktop.call("jagentchill.sync.applyRemote.result", { batchId: frame.payload.batchId, result: answer });
    })();
  });
  const accepted = await phone.call("jagentchill.proposal.resolve", { proposalId, action: "accept" });
  assert.equal(accepted.proposal.state, "accepted");
  assert.equal(accepted.proposal.sentToDeviceName, "Desktop", "the accepting phone is told where the change was sent");
  assert.equal(requests[0].label, "Agent: Rename the opening");
  assert.equal(timeline.located(w.head(), w.project.clipA).element.name, "Opening");
  const holder = w.h.app.sync.leases.current(w.doc)!;
  assert.deepEqual([holder.holder.kind, holder.leaseId], ["device", lease.leaseId], "the host never took the lease from the device");
  // The desktop is busy past the deadline: the accept fails and the proposal stays pending.
  answer = "busy";
  await w.write("jc_clip_rename", { elementId: w.project.clipB, name: "Interview" });
  const second = await w.submit("Rename the interview");
  const busy = await phone.fail("jagentchill.proposal.resolve", { proposalId: second, action: "accept" });
  assert.deepEqual([busy.code, busy.retryable, busy.details?.deviceName], ["LEASE_UNAVAILABLE", true, "Desktop"]);
  assert.equal(w.h.app.tools.proposal(second)!.state, "pending");
  assert.notEqual(timeline.located(w.head(), w.project.clipB).element.name, "Interview");
  // "Try again" once the desktop is free.
  answer = "applied";
  assert.equal((await phone.call("jagentchill.proposal.resolve", { proposalId: second, action: "accept" })).proposal.state, "accepted");
  w.close();
});

test("Headless accept in auto mode; Read sees flushed edits; Device did not flush in time", async () => {
  const w = await toolWorld({ mode: "auto", harness: { extra: { toolTimings: { flushMs: 120 } } as never } });
  await w.write("jc_clip_rename", { elementId: w.project.clipA, name: "Auto" });
  const proposalId = await w.submit("Auto rename");
  await tick(150);
  assert.equal(w.h.app.tools.proposal(proposalId)!.state, "accepted", "in auto mode a valid proposal is accepted by the host");
  assert.equal(timeline.located(w.head(), w.project.clipA).element.name, "Auto");
  assert.equal(w.h.app.sync.leases.current(w.doc), null);
  // A device that holds the lease and reported unsynced changes is waited for.
  const desktop = await w.h.pair("Desktop", "editor");
  const lease = (await desktop.call("jagentchill.sync.lease.acquire", { doc: w.doc })).lease;
  const report = (pendingOps: number) => desktop.call("jagentchill.editor.context.report", { projectId: w.doc.id, sceneId: w.project.sceneId, playhead: 0, selectedElementIds: [], selectedRange: null, inPoint: null, outPoint: null, panel: null, zoomWindow: null, focusedSessionKey: null, pendingOps });
  await report(1);
  setTimeout(() => void (async () => {
    await desktop.call("jagentchill.sync.ops.push", { doc: w.doc, leaseId: lease.leaseId, baseRevision: w.revision(), ops: [w.s.op([{ op: "replace", path: "/metadata/name", value: "Moved a clip" }])] });
    await report(0);
  })(), 30);
  const flushed = await w.ok("jc_project_get");
  assert.equal(flushed.data.name, "Moved a clip", "the read reflects what the device flushed 30 ms later");
  assert.deepEqual(flushed.warnings, []);
  await report(2);
  const ahead = await w.ok("jc_project_get");
  assert.deepEqual(ahead.warnings, ["device_ahead"]);
  assert.equal(ahead.revision, w.revision());
  w.close();
});
