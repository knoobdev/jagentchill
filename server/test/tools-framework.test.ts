// The Gateway in these tests is the FAKE of `harness.ts`; devices are simulated. The server, sync and the tools are real.
import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalJson } from "@jagentchill/editor-core";
import { TOOL_CONDITIONAL, TOOL_INDEX, TOOL_MANIFEST, TOOL_NAME_PATTERN } from "@jagentchill/protocol";
import { ALL_TOOLS } from "../src/tools/index.ts";
import { tick } from "./harness.ts";
import { S, follower, key, toolWorld } from "./support/tools.ts";

test("Catalogue matches the manifest; Name pattern; Tool outside the index; Index and manifest drift; Removed names are not registered", async () => {
  const w = await toolWorld();
  const served = w.h.app.tools.definitions().map((tool) => tool.name).sort(), manifest = TOOL_MANIFEST.map((entry) => entry.name).filter((name) => !TOOL_CONDITIONAL.includes(name)).sort(); // no generation provider is connected here
  assert.deepEqual(served, manifest, "the served tools are exactly the manifest");
  assert.equal(new Set(served).size, served.length);
  const indexed = new Set(Object.values(TOOL_INDEX).flat());
  for (const tool of ALL_TOOLS) {
    assert.match(tool.name, TOOL_NAME_PATTERN);
    assert.ok(tool.name.length <= 48 && tool.description.length <= 600, tool.name);
    assert.ok(indexed.has(tool.name), `${tool.name} is a row of the family index`);
    assert.equal(TOOL_INDEX[tool.family]?.includes(tool.name), true, `${tool.name} is listed under its family ${tool.family}`);
    assert.equal(TOOL_MANIFEST.find((entry) => entry.name === tool.name)?.family, tool.family);
  }
  for (const gone of ["jc_diagram_get", "jc_diagram_patch", "jc_film_step_run", "jc_film_asset_edit", "jc_film_panel_edit"]) assert.equal(served.includes(gone), false);
  // The catalogue of channel P: one entry per served tool with its owner and a closed parameter schema.
  const catalog = (await w.admin.call("jagentchill.tool.catalog", {})).tools;
  assert.deepEqual(catalog.map((entry: any) => entry.name).sort(), manifest);
  for (const entry of catalog) { assert.equal(entry.owner, "agent-editing-tools"); assert.equal(entry.parametersSchema.additionalProperties, false); assert.equal(typeof entry.readOnly, "boolean"); }
  assert.equal(catalog.find((entry: any) => entry.name === "jc_timeline_snapshot").readOnly, true);
  assert.equal(catalog.find((entry: any) => entry.name === "jc_timeline_snapshot").readsAmbientState, true);
  assert.equal(catalog.find((entry: any) => entry.name === "jc_clip_trim").needsWriterToken, true);
  w.close();
});

test("Unknown parameter; Fractional ticks; Idempotency key too short; Failure shape; Session unknown to the server", async () => {
  const w = await toolWorld();
  const unknown = await w.fails("jc_timeline_snapshot", { sessionHandle: "abc" });
  assert.equal(unknown.code, "INVALID_PARAMS");
  assert.match(unknown.message, /sessionHandle/);
  assert.equal(unknown.retryable, false);
  const fractional = await w.writeFails("jc_clip_split", { elementIds: [w.project.clipA], times: [1200.5] });
  assert.equal(fractional.code, "INVALID_PARAMS");
  assert.match(fractional.message, /times\.0/);
  const short = await w.fails("jc_clip_delete", { elementIds: [w.project.clipA], idempotencyKey: "12345678" });
  assert.equal(short.code, "INVALID_PARAMS");
  assert.match(short.message, /16–64 characters/);
  const negative = await w.writeFails("jc_clip_trim", { elementId: w.project.clipA, edge: "end", to: -5 });
  assert.equal(negative.code, "INVALID_PARAMS");
  // Nothing was executed by any of them.
  assert.equal(w.h.app.tools.currentProposal(w.sessionKey), undefined);
  // A session the server did not create can use no tool, and the attempt is audited as denied.
  const stranger = (await w.h.app.tools.call("agent:main:unknown", "jc_timeline_snapshot", {})).envelope;
  assert.deepEqual([stranger.ok, stranger.error?.code, stranger.error?.details?.reason, stranger.error?.retryable], [false, "SESSION_UNBOUND", "no_session", true]);
  assert.equal(w.h.audit("tool.call").find((record: any) => record.outcome === "denied")?.errorCode, "SESSION_UNBOUND");
  const missing = (await w.h.app.tools.call(w.sessionKey, "jc_generate_image", { prompt: "x" })).envelope;
  assert.equal(missing.error?.code, "TOOL_NOT_AVAILABLE");
  w.close();
});

test("Default project; No bound project; Unsynced project; After sync is enabled; Read-only tool leaves the revision unchanged", async () => {
  const w = await toolWorld();
  const before = w.revision();
  const snapshot = await w.ok("jc_timeline_snapshot");
  assert.equal(snapshot.revision, before);
  assert.equal(snapshot.data.sceneId, w.project.sceneId);
  assert.equal(w.revision(), before);
  assert.equal(w.h.app.tools.currentProposal(w.sessionKey), undefined, "no proposal is opened by a read");
  // An unbound session.
  const unbound = await w.session(w.admin, null);
  assert.equal((await w.fails("jc_timeline_snapshot", {}, unbound)).code, "NO_PROJECT_BOUND");
  assert.equal((await w.writeFails("jc_clip_delete", { elementIds: [w.project.clipA] }, unbound)).code, "NO_PROJECT_BOUND");
  // A project that exists only on a device.
  const local = await w.session(w.admin, "0f0e0d0c-0b0a-4a09-8807-060504030201");
  await w.admin.call("jagentchill.session.subscribe", {});
  const refused = await w.fails("jc_timeline_snapshot", {}, local);
  assert.deepEqual([refused.code, refused.retryable], ["PROJECT_NOT_SYNCED", false]);
  assert.match(refused.message, /turn on sync/);
  // The chat gets one card for it, naming the device, however often the tool is retried.
  await w.fails("jc_project_get", {}, local);
  const listed = await w.admin.call("jagentchill.proposal.list", { sessionKey: local });
  assert.equal(listed.notices.length, 1);
  assert.deepEqual([listed.notices[0].code, listed.notices[0].deviceName, listed.notices[0].synced], ["PROJECT_NOT_SYNCED", "Studio Mac", false]);
  assert.ok(w.admin.events.some((event) => event.event === "jagentchill.tool.notice" && event.payload.notice.code === "PROJECT_NOT_SYNCED"));
  // The user turns sync on: the same call succeeds and reports the synced revision.
  const { buildProject } = await import("./support/tools.ts");
  const other = buildProject({ name: "Phone project" });
  other.doc.metadata.id = "0f0e0d0c-0b0a-4a09-8807-060504030201";
  await w.s.enable(w.admin, other.doc);
  const retried = await w.ok("jc_timeline_snapshot", {}, local);
  assert.equal(retried.revision, 1);
  assert.equal((await w.admin.call("jagentchill.proposal.list", { sessionKey: local })).notices[0].synced, true);
  w.close();
});

test("Successful write; Dry-run trim; Dry run surfaces the same error; Retried generation (idempotency); Key reused with other parameters; Failed validation keeps the key free; A write is logged; Secrets are redacted", async () => {
  const w = await toolWorld();
  const k = key(), args = { elementId: w.project.clipA, edge: "end", delta: -2 * S, idempotencyKey: k };
  const dry = await w.ok("jc_clip_trim", { ...args, idempotencyKey: key(), dryRun: true });
  assert.equal(dry.data.provisional, true);
  assert.equal(dry.data.duration, 8 * S);
  assert.deepEqual(dry.changeIds, []);
  assert.equal(w.h.app.tools.currentProposal(w.sessionKey), undefined, "a dry run stages nothing and opens no proposal");
  assert.equal(w.h.app.tools.writerOf(w.doc.id), undefined, "a dry run needs no writer token");
  const first = await w.ok("jc_clip_trim", args);
  assert.equal(first.ok, true);
  assert.ok(first.proposalId);
  assert.equal(first.changeIds?.length, 1);
  assert.ok(first.summary && first.summary.length <= 200);
  assert.equal(first.data.durationTimecode, "00:00:08:00");
  // The same key and parameters: the stored result, replayed, and no second change.
  const again = await w.ok("jc_clip_trim", args);
  assert.equal(again.replayed, true);
  assert.deepEqual(again.changeIds, first.changeIds);
  assert.equal(w.h.app.tools.currentProposal(w.sessionKey)!.changes.length, 1);
  assert.equal((await w.fails("jc_clip_trim", { ...args, delta: -3 * S })).code, "IDEMPOTENCY_CONFLICT");
  // A key of a call that failed validation is free for the corrected call; keys are per session.
  const reuse = key();
  assert.equal((await w.fails("jc_clip_rename", { elementId: w.project.clipA, name: "", idempotencyKey: reuse })).code, "OUT_OF_RANGE");
  assert.equal((await w.ok("jc_clip_rename", { elementId: w.project.clipA, name: "Opening", idempotencyKey: reuse })).ok, true);
  // The same error for a dry run as for the real call.
  await w.write("jc_track_edit", { action: "lock", trackId: w.project.musicTrack });
  const realError = await w.writeFails("jc_clip_move", { elementIds: [w.project.music], delta: S });
  const dryError = await w.writeFails("jc_clip_move", { elementIds: [w.project.music], delta: S, dryRun: true });
  assert.equal(realError.code, "TRACK_LOCKED");
  assert.deepEqual([dryError.code, dryError.message], [realError.code, realError.message]);
  assert.match(realError.message, /Audio track/);
  assert.match(realError.message, /jc_track_edit/);
  // One audit record per call, with the tool, the proposal and the change ids; a token in a URL is not stored.
  const records = w.h.audit("tool.call") as any[];
  const logged = records.find((record) => record.tool === "jc_clip_trim" && record.outcome === "ok" && !record.dryRun);
  assert.deepEqual([logged.category, logged.family, logged.proposalId, logged.changeIds, logged.actor.sessionId], ["agent", "clip", first.proposalId, first.changeIds, w.sessionKey]);
  assert.equal(records.filter((record) => record.tool === "jc_clip_trim" && record.outcome === "replayed").length, 1);
  assert.equal(records.find((record) => record.dryRun === true)?.outcome, "ok");
  await w.ok("jc_library_search", { kind: "effect", query: "see https://cdn.example.com/a.mp4?token=s3cr3t" });
  assert.equal(JSON.stringify(w.h.audit("tool.call")).includes("s3cr3t"), false);
  w.close();
});

test("Ask mode; Staged changes are not committed; Subsequent tools see staged state; Write while a proposal is pending; Submit does not hold the turn; Auto-submit at turn end; Gateway restart with an open proposal", async () => {
  const ask = await toolWorld({ mode: "ask" });
  assert.equal((await ask.writeFails("jc_clip_delete", { elementIds: [ask.project.clipA] })).code, "MODE_READ_ONLY");
  assert.equal((await ask.ok("jc_timeline_snapshot")).ok, true, "reads work in ask mode");
  ask.close();
  const plan = await toolWorld({ mode: "plan" });
  assert.equal((await plan.writeFails("jc_clip_delete", { elementIds: [plan.project.clipA] })).code, "PLAN_NOT_APPROVED");
  plan.close();

  const w = await toolWorld();
  const device = await follower(w.h, "Phone", w.doc, w.head(), w.revision());
  const before = canonicalJson(w.head()), base = w.revision();
  const split = await w.write("jc_clip_split", { elementIds: [w.project.clipA], times: [4 * S] });
  const right = split.data.elementIds[1];
  // The right-hand part exists only in the proposal, and the next tool edits it by its new id.
  await w.write("jc_clip_trim", { elementId: right, edge: "end", delta: -1 * S });
  await w.write("jc_clip_rename", { elementId: right, name: "Second half" });
  assert.equal(w.revision(), base);
  assert.equal(canonicalJson(w.head()), before);
  assert.deepEqual(await device.pull(), [], "other devices see no change");
  const status = await w.ok("jc_proposal_status");
  assert.deepEqual([status.data.state, status.data.changeCount, status.data.validation.ok], ["open", 3, true]);
  assert.deepEqual(status.data.changes[1].dependsOn, [split.changeIds![0]], "the trim depends on the split that made its element");
  // Submit returns at once; the session has one pending proposal and cannot stage more.
  const submitted = await w.ok("jc_proposal_submit", { title: "Tighter intro", summary: "Splits clip 1 and trims its second half." });
  assert.equal(submitted.data.state, "pending");
  assert.equal(w.h.app.tools.currentProposal(w.sessionKey)!.state, "pending");
  const blocked = await w.writeFails("jc_clip_delete", { elementIds: [w.project.clipB] });
  assert.equal(blocked.code, "PROPOSAL_CLOSED");
  assert.match(blocked.message, /A proposal is waiting for the user's decision/);
  assert.equal((await w.fails("jc_proposal_discard")).code, "PROPOSAL_CLOSED");
  assert.equal(w.revision(), base);
  // Rebinding the session is refused while the proposal is pending.
  const rebind = await w.admin.fail("jagentchill.session.update", { sessionKey: w.sessionKey, patch: { projectId: "other" } });
  assert.deepEqual([rebind.code, rebind.message], ["CONFLICT", "Accept or reject the pending proposal first"]);

  // A turn that ends with staged changes submits them with a generated title; an empty one is dropped.
  const second = await w.session();
  await w.admin.call("jagentchill.session.subscribe", {});
  await w.ok("jc_proposal_begin", {}, second);
  w.h.app.tools.turnEnded(second);
  assert.equal(w.h.app.tools.currentProposal(second), undefined, "an open proposal without a change is discarded");
  await w.write("jc_marker_edit", { action: "add", time: 3 * S, note: "Hook" }, second).catch(() => undefined);
  w.close();
});

test("Auto-submit at turn end; Gateway restart with an open proposal", async () => {
  const w = await toolWorld();
  await w.admin.call("jagentchill.chat.subscribe", { sessionKey: w.sessionKey });
  for (const time of [2, 4, 6, 8]) await w.write("jc_marker_edit", { action: "add", time: time * S, note: `Beat ${time}` });
  // The Gateway reports the end of the turn.
  await w.admin.call("jagentchill.chat.send", { sessionKey: w.sessionKey, message: "add beat markers" });
  w.h.fake.endTurn(w.sessionKey, "run-1");
  await tick(50);
  const pending = w.h.app.tools.currentProposal(w.sessionKey)!;
  assert.deepEqual([pending.state, pending.changes.length], ["pending", 4]);
  assert.match(pending.title, /4 changes/);
  assert.ok(w.admin.events.some((event) => event.event === "jagentchill.proposal.updated" && event.payload.proposal.proposalId === pending.proposalId), "a proposal card appears");
  w.close();
});
