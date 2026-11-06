// The agent runtimes in these tests are the FAKES of `harness.ts` and devices are simulated; the server, sync, the tools
// and the MCP server/client pair (in-memory transport) are real. A connection is bound to the session its URL names.
// One dependency is replaced in one assertion: the budget check of the tool endpoint is made to refuse (its real
// behaviour is covered by usage.test.ts "Session budget").
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { addAsset, createIdSource, timeline, type CommitContext } from "@jagentchill/editor-core";
import { PROPOSAL_MAX_CHANGES, TOOL_CONDITIONAL, TOOL_MANIFEST, TOOL_RATE_LIMITS, type ProjectDocument, type ToolEnvelope } from "@jagentchill/protocol";
import { registerAgentTools } from "../src/tools/mcp.ts";
import { S, buildProject, key, toolWorld } from "./support/tools.ts";

test("Burst of calls; Retry hint; Per-turn limit", async () => {
  let clock = Date.now();
  const w = await toolWorld({ harness: { now: () => clock } });
  for (let call = 0; call < TOOL_RATE_LIMITS.callsPerMinute; call++) await w.ok("jc_scene_list");
  const limited = await w.fails("jc_scene_list");
  assert.deepEqual([limited.code, limited.retryable], ["RATE_LIMITED", true]);
  assert.ok(Number.isInteger(limited.details.retryAfter_ms) && limited.details.retryAfter_ms > 0, "retryAfter_ms is a positive integer");
  // A minute later the window is free again.
  clock += 61_000;
  await w.ok("jc_scene_list");
  // 200 calls in one turn, however slowly they come.
  w.h.app.tools.turnStarted(w.sessionKey);
  for (let call = 0; call < TOOL_RATE_LIMITS.callsPerTurn; call++) { clock += 1000; await w.ok("jc_scene_list"); }
  clock += 1000;
  const turn = await w.fails("jc_scene_list");
  assert.deepEqual([turn.code, turn.details.reason, turn.details.limit], ["RATE_LIMITED", "per_turn_limit", 200]);
  w.close();
});

test("PROPOSAL_NOT_FOUND; PROPOSAL_TOO_LARGE; PROJECT_NOT_FOUND for a project in the host trash", async () => {
  const w = await toolWorld();
  // Nothing is staged: there is no proposal to submit, discard or trim.
  assert.equal((await w.fails("jc_proposal_submit", { title: "Nothing", summary: "Nothing." })).code, "PROPOSAL_NOT_FOUND");
  assert.equal((await w.fails("jc_proposal_discard")).code, "PROPOSAL_NOT_FOUND");
  assert.equal((await w.fails("jc_proposal_revert", { changeIds: [randomUUID()] })).code, "PROPOSAL_NOT_FOUND");
  assert.equal((await w.admin.fail("jagentchill.proposal.resolve", { proposalId: randomUUID(), action: "accept" })).code, "PROPOSAL_NOT_FOUND");
  assert.equal((await w.admin.fail("jagentchill.proposal.revert", { proposalId: randomUUID() })).code, "PROPOSAL_NOT_FOUND");
  // A proposal holds at most 2,000 changes. One change is staged by the tool; the stored list is then filled up to the
  // limit in the host store (staging 2,000 real changes is what the per-turn limit of 600 forbids in one turn).
  const first = await w.write("jc_marker_edit", { action: "add", time: S, note: "Hook" });
  const row = w.h.app.db.prepare("SELECT json FROM tool_proposals WHERE proposal_id = ?").get(first.proposalId!) as { json: string };
  const body = JSON.parse(row.json) as { calls: { changeId: string; patch: unknown[] }[] };
  body.calls = [body.calls[0], ...Array.from({ length: PROPOSAL_MAX_CHANGES - 1 }, () => ({ ...body.calls[0], changeId: randomUUID(), patch: [] }))];
  w.h.app.db.prepare("UPDATE tool_proposals SET json = ? WHERE proposal_id = ?").run(JSON.stringify(body), first.proposalId!);
  const full = await w.writeFails("jc_marker_edit", { action: "add", time: 2 * S });
  assert.deepEqual([full.code, full.details.limit, full.retryable], ["PROPOSAL_TOO_LARGE", 2000, false]);
  // A dry run stages nothing, so it is not refused for size.
  assert.equal((await w.call("jc_marker_edit", { action: "add", time: 2 * S, idempotencyKey: key(), dryRun: true })).ok, true);
  await w.ok("jc_proposal_discard");
  // The project is moved to the host trash: tools no longer find it, and say so.
  w.h.app.sync.documents.trash.move(w.doc, w.admin.device.deviceId);
  const trashed = await w.fails("jc_timeline_snapshot");
  assert.deepEqual([trashed.code, trashed.retryable], ["PROJECT_NOT_FOUND", false]);
  assert.match(trashed.message, /trash/);
  assert.equal((await w.writeFails("jc_clip_delete", { elementIds: [w.project.clipA] })).code, "PROJECT_NOT_FOUND");
  w.close();
});

test("ASSET_NOT_READY; QUOTA_EXCEEDED beyond 1,000 markers", async () => {
  const w = await toolWorld();
  // A second project: a video whose probe has not finished (no duration yet) and a scene that already holds 1,000 markers.
  const ctx: CommitContext = { now_ms: 1_800_000_000_000, newId: createIdSource() };
  const built = buildProject({ name: "Markers", empty: true });
  const added = addAsset(built.doc, ctx, { name: "still_importing.mp4", type: "video", size: 1_000_000, width: 1920, height: 1080 });
  let doc: ProjectDocument = added.document;
  for (let index = 0; index < 1000; index++) doc = timeline.executeCommand(doc, ctx, timeline.HOST_EDIT_CONTEXT, timeline.addMarkerAt({ sceneId: built.sceneId, time: index * 4000 })).commit.document;
  await w.s.enable(w.admin, doc);
  const session = await w.session(w.admin, doc.metadata.id);
  const pending = await w.writeFails("jc_clip_add", { assetId: added.assetId }, session);
  assert.deepEqual([pending.code, pending.retryable, pending.details.assetId], ["ASSET_NOT_READY", true, added.assetId]);
  const quota = await w.writeFails("jc_marker_edit", { action: "add", time: 60 * S }, session);
  assert.deepEqual([quota.code, quota.details.limit], ["QUOTA_EXCEEDED", 1000]);
  assert.equal(w.h.app.tools.currentProposal(session), undefined, "nothing was staged by either call");
  w.close();
});

test("MCP endpoint: Catalogue matches the manifest; TOOL_NOT_AVAILABLE; SESSION_UNBOUND no_session; BUDGET_EXCEEDED; a bound call lands on its session's project", async () => {
  const w = await toolWorld();
  const other = buildProject({ name: "Hoi An lanterns" });
  await w.s.enable(w.admin, other.doc);
  const second = await w.session(w.admin, other.doc.metadata.id);
  let overBudget = false;
  /** One MCP connection of an agent session: the server named the session in the URL it gave the runtime. */
  const connect = async (sessionKey: string | null, surface?: "film") => {
    const server = new McpServer({ name: "jagentchill", version: "0.0.0" });
    registerAgentTools(server, {
      tools: () => w.h.app.tools, session: (key) => { const session = w.h.app.relay.session(key); return surface && session ? { ...session, toolSurface: surface } : session; },
      assertBudget: (sessionKey) => { if (overBudget) throw new Error("Budget reached — session"); w.h.app.usage.assertBudget(sessionKey); },
      ...(sessionKey ? { directSessionKey: sessionKey } : {}),
    });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "agent", version: "0.0.0" });
    await client.connect(clientSide);
    return client;
  };
  const call = async (client: Client, _sessionKey: string | null, name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args }) as { content: { type: string; text?: string }[]; isError?: boolean };
    return { isError: result.isError === true, envelope: JSON.parse(result.content[0].text!) as ToolEnvelope & { data: any } };
  };
  const reported = async (client: Client, _sessionKey: string, name: string, args: Record<string, unknown> = {}) => (await client.callTool({ name, arguments: args })) as { content: { type: string; text: string }[]; isError?: boolean };
  const one = await connect(w.sessionKey), two = await connect(second), nobody = await connect(null), stranger = await connect("agent:main:jc:no-such-session");

  // Discovery keeps names and argument constraints, with full usage details available on demand.
  const discovered = (await one.listTools()).tools;
  const listed = discovered.map((tool) => tool.name).filter((name) => !["jc_server_info", "jc_echo", "jc_session_whoami", "jc_tool_help"].includes(name)).sort();
  assert.deepEqual(listed, TOOL_MANIFEST.map((entry) => entry.name).filter((name) => !TOOL_CONDITIONAL.includes(name)).sort()); // no generation provider is connected here
  const compact = discovered.find((tool) => tool.name === "jc_timeline_snapshot")!;
  const compactDescription = compact.description ?? "";
  assert.ok(compactDescription.length < 120 && compactDescription.includes("jc_tool_help"));
  assert.ok(!JSON.stringify(compact.inputSchema).includes("description"), "the always-loaded schema omits field manuals");
  // A tool the host does not serve.
  const absent = await call(one, w.sessionKey, "jc_generate_image", { prompt: "a lantern" });
  assert.deepEqual([absent.isError, absent.envelope.error?.code], [true, "TOOL_NOT_AVAILABLE"]);
  // A connection whose URL names no session, or a session the server does not have, executes nothing; the attempt is audited as denied.
  for (const client of [nobody, stranger]) {
    const unbound = await call(client, null, "jc_timeline_snapshot");
    assert.deepEqual([unbound.envelope.error?.code, unbound.envelope.error?.details?.reason, unbound.envelope.error?.retryable], ["SESSION_UNBOUND", "no_session", true]);
  }
  assert.equal(w.h.audit("tool.call").filter((record: any) => record.outcome === "denied").at(-1)?.errorCode, "SESSION_UNBOUND");
  // Each connection is served for the session its URL names, and reads that session's project.
  const first = await call(one, w.sessionKey, "jc_project_get"), next = await call(two, second, "jc_project_get");
  assert.deepEqual([first.envelope.ok, first.envelope.data.name, next.envelope.data.name], [true, "Da Lat in 48 hours", "Hoi An lanterns"]);
  // A write through MCP is staged in the calling session's proposal, on its project.
  const staged = await call(two, second, "jc_text_add", { content: "HOI AN BY NIGHT", start: 0, duration: 2 * S, idempotencyKey: key() });
  assert.equal(staged.envelope.ok, true);
  assert.equal(w.h.app.tools.currentProposal(second)?.projectId, other.doc.metadata.id);
  assert.equal(w.h.app.tools.currentProposal(w.sessionKey), undefined);
  // A connection is served for its own session whatever the call says: the other session's proposal is untouched.
  const own = await call(one, second, "jc_project_get");
  assert.equal(own.envelope.data.name, "Da Lat in 48 hours");
  // A spending limit of the session refuses the call before the tool runs.
  overBudget = true;
  const budget = await call(one, w.sessionKey, "jc_scene_list");
  assert.deepEqual([budget.envelope.error?.code, budget.envelope.error?.retryable], ["BUDGET_EXCEEDED", false]);
  overBudget = false;
  const third = await w.session(w.admin, other.doc.metadata.id);
  const film = await connect(third, "film");
  const hiddenTimeline = await call(film, third, "jc_timeline_snapshot");
  assert.deepEqual([hiddenTimeline.isError, hiddenTimeline.envelope.error?.code, hiddenTimeline.envelope.error?.message], [true, "TOOL_NOT_AVAILABLE", "The tool jc_timeline_snapshot is not available on this surface."]);
  const hiddenHelp = await call(film, third, "jc_tool_help", { name: "jc_timeline_snapshot" });
  assert.deepEqual([hiddenHelp.isError, hiddenHelp.envelope.error?.code], [true, "TOOL_NOT_AVAILABLE"]);
  const help = await reported(one, w.sessionKey, "jc_tool_help", { name: "jc_timeline_snapshot" });
  const manual = JSON.parse(help.content[0].text) as { name: string; description: string; inputSchema: Record<string, unknown> };
  assert.equal(manual.name, "jc_timeline_snapshot");
  assert.ok(manual.description.length > compactDescription.length, "help returns the full tool manual");
  assert.equal(JSON.stringify(manual.inputSchema), JSON.stringify(w.h.app.tools.definitions().find((tool) => tool.name === manual.name)!.inputSchema), "help preserves the canonical constraints and descriptions");
  const unknownHelp = await reported(one, w.sessionKey, "jc_tool_help", { name: "jc_not_a_tool" });
  assert.equal(unknownHelp.isError, true);
  // The owner's session asked for jc_generate_voice: the answer names the real tool instead of "not available on this surface".
  const madeUp = await reported(one, w.sessionKey, "jc_tool_help", { name: "jc_timeline_view" });
  const madeUpError = JSON.parse(madeUp.content[0].text).error as { message: string; details: { similar?: string[] } };
  assert.match(madeUpError.message, /^There is no tool named jc_timeline_view\./);
  assert.ok(madeUpError.details.similar?.includes("jc_timeline_snapshot"), JSON.stringify(madeUpError));
  await one.close(); await two.close(); await film.close(); await nobody.close(); await stranger.close();
  w.close();
});
