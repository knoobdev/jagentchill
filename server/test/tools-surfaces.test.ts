import test from "node:test";
import assert from "node:assert/strict";
import { deniedToolNames, toolNamesForSurface } from "../src/tools/surfaces.ts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAgentTools } from "../src/tools/mcp.ts";
import { ACME, toolWorld } from "./support/tools.ts";

const names = [
  "jc_server_info", "jc_tool_help", "jc_session_ask", "jc_timeline_snapshot", "jc_clip_trim", "jc_project_get",
  "jc_film_get", "jc_film_update_story", "jc_workflow_get", "jc_workflow_start",
  "jc_agent_send", "jc_team_create_peer", "jc_review_submit",
];

test("product surfaces expose their own MCP families and deny unrelated tools", () => {
  const visible = (surface: Parameters<typeof toolNamesForSurface>[1]) => toolNamesForSurface(names, surface);
  assert.deepEqual(visible("editor"), ["jc_server_info", "jc_tool_help", "jc_session_ask", "jc_timeline_snapshot", "jc_clip_trim", "jc_project_get", "jc_agent_send", "jc_team_create_peer", "jc_review_submit"]);
  assert.deepEqual(visible("team"), visible("editor"));
  assert.deepEqual(visible("film"), ["jc_server_info", "jc_tool_help", "jc_film_get", "jc_film_update_story"]);
  assert.deepEqual(visible("workflow"), ["jc_server_info", "jc_tool_help", "jc_session_ask", "jc_timeline_snapshot", "jc_clip_trim", "jc_project_get", "jc_workflow_get", "jc_workflow_start"]);
  assert.deepEqual(visible("workflow-run"), ["jc_server_info", "jc_tool_help", "jc_timeline_snapshot", "jc_clip_trim", "jc_project_get", "jc_workflow_get", "jc_workflow_start"]);
  assert.deepEqual(deniedToolNames(names, "workflow-run"), ["jc_session_ask", "jc_film_get", "jc_film_update_story", "jc_agent_send", "jc_team_create_peer", "jc_review_submit"]);
  assert.deepEqual(deniedToolNames(names, "film"), ["jc_session_ask", "jc_timeline_snapshot", "jc_clip_trim", "jc_project_get", "jc_workflow_get", "jc_workflow_start", "jc_agent_send", "jc_team_create_peer", "jc_review_submit"]);
});

test("each session keeps its surface, and the tool endpoint serves a session only its surface's tools", async () => {
  const w = await toolWorld();
  try {
    /** One MCP connection of an agent session, named in its URL as the server gives it to the runtime. */
    const connect = async (sessionKey: string) => {
      const server = new McpServer({ name: "jagentchill", version: "0.0.0" });
      registerAgentTools(server, { tools: () => w.h.app.tools, session: (key) => w.h.app.relay.session(key), assertBudget: () => undefined, directSessionKey: sessionKey });
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      await server.connect(serverSide);
      const client = new Client({ name: "agent", version: "0.0.0" });
      await client.connect(clientSide);
      return client;
    };
    const refused = async (sessionKey: string, name: string) => {
      const client = await connect(sessionKey);
      const result = await client.callTool({ name: "jc_tool_help", arguments: { name } }) as { content: { text: string }[]; isError?: boolean };
      await client.close();
      return result.isError === true && JSON.parse(result.content[0].text).error.code === "TOOL_NOT_AVAILABLE";
    };
    const surfaceOf = async (sessionKey: string) => (await w.admin.call("jagentchill.session.get", { sessionKey })).session.toolSurface;
    assert.equal(await surfaceOf(w.sessionKey), "editor");
    assert.deepEqual([await refused(w.sessionKey, "jc_film_get"), await refused(w.sessionKey, "jc_workflow_get"), await refused(w.sessionKey, "jc_timeline_snapshot")], [true, true, false]);

    const film = (await w.admin.call("jagentchill.session.create", { ref: ACME, scriptId: "film-script" })).session.sessionKey;
    assert.equal(await surfaceOf(film), "film");
    assert.deepEqual([await refused(film, "jc_timeline_snapshot"), await refused(film, "jc_film_get")], [true, false]);

    const workflow = (await w.admin.call("jagentchill.session.create", { ref: ACME, toolSurface: "workflow" })).session.sessionKey;
    assert.deepEqual([await refused(workflow, "jc_workflow_get"), await refused(workflow, "jc_timeline_snapshot"), await refused(workflow, "jc_session_ask")], [false, false, false]);

    const workflowRunSession = await w.admin.call("jagentchill.session.create", { ref: ACME, toolSurface: "workflow-run", origin: "workflow" });
    assert.equal(await refused(workflowRunSession.session.sessionKey, "jc_session_ask"), true);
    const workflowRun = await w.admin.call("jagentchill.session.get", { sessionKey: workflowRunSession.session.sessionKey });
    assert.equal(workflowRun.session.origin, "workflow");
    assert.equal(workflowRun.session.toolSurface, "workflow-run");
    assert.ok(!(await w.admin.call("jagentchill.session.list", {})).sessions.some((session: { sessionKey: string }) => session.sessionKey === workflowRun.session.sessionKey));
    assert.ok((await w.admin.call("jagentchill.session.list", { includeWorkflowRuns: true })).sessions.some((session: { sessionKey: string }) => session.sessionKey === workflowRun.session.sessionKey));

    const team = (await w.admin.call("jagentchill.session.create", { ref: ACME, agentId: "jagentchill-team" })).session.sessionKey;
    assert.equal(await surfaceOf(team), "team");
  } finally {
    w.close();
  }
});
