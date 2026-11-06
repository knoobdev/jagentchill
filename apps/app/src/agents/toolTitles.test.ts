// Pure: the titles of work-log steps. Run with `node --test apps/app/src/agents/toolTitles.test.ts`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { toolTitle } from "./toolTitles.ts";

const t = (text: string, params?: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_all, key: string) => String(params?.[key] ?? `{${key}}`));
const title = (name: string, input?: unknown) => toolTitle(t, { name, ...(input === undefined ? {} : { input: JSON.stringify(input) }) });

test("Agent and team tools have human titles like the editing tools: a sentence about what was done, never the tool's id", () => {
  assert.equal(title("jc_agent_create", { title: "Editor A", prompt: "Cut the first scene to 20 seconds.", role: "editor" }), "Created agent “Editor A”");
  assert.equal(title("mcp__jagentchill__jc_agent_create", { title: "Editor A", prompt: "x" }), "Created agent “Editor A”");
  assert.equal(title("jc_agent_create"), "Created an agent");
  assert.equal(title("mcp__jagentchill__jc_agent_send", { agentId: "ag_1", prompt: "Go on." }), "Sent a message to an agent");
  const named: Record<string, string> = {
    jc_agent_list: "Listed the agents", jc_agent_status: "Checked an agent", jc_agent_wait: "Waited for agents", jc_agent_cancel: "Stopped an agent", jc_agent_handback: "Handed the work back",
    jc_agent_activity: "Read what an agent did", jc_agent_archive: "Archived an agent", jc_agent_update: "Changed an agent", jc_agent_set_mode: "Changed the mode of an agent",
    jc_agent_set_model: "Changed the model of an agent", jc_agent_handoff: "Asked to hand the work over", jc_agent_handoff_respond: "Answered a hand-over", jc_agent_catalog: "Read the roles and models for agents",
    jc_team_bootstrap_lead: "Started the team lead", jc_team_create_peer: "Added a team member", jc_team_accept_result: "Accepted the team's result",
  };
  for (const [name, wanted] of Object.entries(named)) assert.equal(title(name, { agentId: "ag_1" }), wanted, name);
  assert.equal(title("jc_agent_wait", { agentIds: ["a", "b", "c"] }), "Waited for 3 agents");
  assert.equal(title("jc_agent_update", { agentId: "ag_1", title: "Colourist" }), "Renamed an agent to “Colourist”");
  for (const name of ["jc_agent_create", ...Object.keys(named)]) assert.doesNotMatch(title(name, {}), /^(Agent|Team) [a-z]/, `${name} is titled by its id`);
});

test("Every tool an agent can call on this host has a title in the work log — none is shown by its id in English (\"Workflow create\"), so every one is translated", () => {
  // The tools the server defines for agents: `name: "jc_…"` in its tool definitions (the steps of a workflow run, `tools.set("jc_…")`, are not agent tools).
  const root = new URL("../../../../server/src", import.meta.url).pathname;
  const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => { const path = join(dir, name); return statSync(path).isDirectory() ? files(path) : /\.ts$/.test(name) ? [path] : []; });
  const names = new Set<string>();
  for (const file of files(root)) for (const found of readFileSync(file, "utf8").matchAll(/\bname: "(jc_[a-z0-9_]+)"/g)) names.add(found[1]!);
  assert.ok(names.size > 90, `the server's tools were found (${names.size})`);
  const byId = (name: string) => { const words = name.replace(/^jc_/, "").replace(/_/g, " "); return words.charAt(0).toUpperCase() + words.slice(1); };
  const untitled = [...names].filter((name) => title(name, {}) === byId(name));
  assert.deepEqual(untitled, [], "tools titled by their id");
  assert.equal(title("jc_workflow_create", { name: "Morning cut" }), "Created the workflow “Morning cut”");
  assert.equal(title("jc_generate_image", { prompt: "a poster" }), "Generated an image");
});

test("The agent CLIs' own tools have titles and glyphs: Claude Code, OpenCode and Codex name them differently", async () => {
  const { toolIcon } = await import("./toolTitles.ts");
  const cases: Array<[string, unknown, string, string]> = [
    ["Bash", { command: "ls" }, "Ran a command", "kbd"], ["bash", { command: "ls" }, "Ran a command", "kbd"], ["commandExecution", undefined, "Ran a command", "kbd"],
    ["Read", { file_path: "/a" }, "Read a file", "doc"], ["Edit", { file_path: "/a" }, "Edited a file", "pencil"], ["fileChange", undefined, "Changed files", "pencil"],
    ["Grep", { pattern: "x" }, "Searched the files", "search"], ["Glob", { pattern: "*.ts" }, "Looked for files", "search"],
    ["WebSearch", { query: "da lat" }, "Searched the web for “da lat”", "globe"], ["WebFetch", { url: "https://a" }, "Read a web page", "globe"],
    ["Task", { description: "x" }, "Gave a task to a sub-agent", "bot"], ["TodoWrite", { todos: [] }, "Updated its to-do list", "list"],
    ["AskUserQuestion", { questions: [{}, {}] }, "Asked you 2 questions", "help"], ["ToolSearch", { query: "timeline" }, "Looked for a tool: “timeline”", "search"],
  ];
  for (const [name, input, wanted, icon] of cases) {
    assert.equal(title(name, input), wanted, name);
    assert.equal(toolIcon(name), icon, `${name} glyph`);
  }
});
