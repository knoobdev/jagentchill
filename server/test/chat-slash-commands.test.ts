import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { buildProject, toolWorld, type ToolWorld } from "./support/tools.ts";

let world: ToolWorld;
after(() => world?.close());

test("runtime Markdown commands and skills are listed from isolated HOME/project roots and expanded once on send", async () => {
  world = await toolWorld({ empty: true, ...(process.env.W7_TEST_DATA_DIR ? { harness: { dataDir: process.env.W7_TEST_DATA_DIR, listenPort: Number(process.env.JAGENTCHILL_PORT) } } : {}) });
  const { h, admin, doc } = world;
  const home = h.dataDir;
  const project = join(home, "workspaces", doc.id);
  mkdirSync(join(home, ".claude", "commands"), { recursive: true });
  writeFileSync(join(home, ".claude", "commands", "README.md"), "Documentation is not a slash command.");
  mkdirSync(join(home, ".claude", "skills", "focus"), { recursive: true });
  mkdirSync(join(project, ".claude", "commands"), { recursive: true });
  writeFileSync(join(home, ".claude", "commands", "plan-summary.md"), "---\ndescription: Summarize a plan.\nargument-hint: <topic> [details]\n---\nReview $1; all=$ARGUMENTS");
  writeFileSync(join(home, ".claude", "commands", "notes.txt"), "Do not list this non-Markdown file.");
  writeFileSync(join(home, ".claude", "skills", "focus", "SKILL.md"), "---\nname: focus\ndescription: Keep edits focused.\n---\nOnly change the requested files.");
  writeFileSync(join(project, ".claude", "commands", "fix-line.md"), "---\ndescription: Fix one line.\n---\nFix $ARGUMENTS");
  const sessionKey = (await admin.call("jagentchill.session.create", { ref: { runtimeId: "claude-code", providerId: "anthropic", modelId: "sonnet" }, projectId: doc.id })).session.sessionKey;
  await admin.call("jagentchill.session.access.set", { sessionKey, access: "host" });

  const beforeHostReply = h.fake.callsOf("startTurn").length;
  const status = await admin.call("jagentchill.chat.send", { sessionKey, message: "/status" });
  assert.equal(h.fake.callsOf("startTurn").length, beforeHostReply, "/status does not start a model turn");
  assert(status.hostReply.rows.some((row: { label: string }) => row.label === "Runtime"));
  assert(status.hostReply.rows.some((row: { label: string }) => row.label === "Model"));
  assert(status.hostReply.rows.some((row: { label: string }) => row.label === "Thinking"));
  assert(status.hostReply.rows.some((row: { label: string }) => row.label === "Permission"));
  assert(status.hostReply.rows.some((row: { label: string }) => row.label === "Compactions"));
  assert(!JSON.stringify(status.hostReply).match(/gateway|agent:main:|jagentchill-unset|oauth/i), "status text excludes engine and credential identifiers");
  const help = await admin.call("jagentchill.chat.send", { sessionKey, message: "/help" });
  assert.equal(h.fake.callsOf("startTurn").length, beforeHostReply, "/help is answered locally");
  const helpInventory = await admin.call("jagentchill.chat.commands", { sessionKey });
  assert.deepEqual(help.hostReply.rows.map((row: { value: string }) => row.value), helpInventory.commands.map((entry: { name: string }) => `/${entry.name}`), "/help lists the same commands as the palette");
  const builtinKey = (await admin.call("jagentchill.session.create", { ref: { runtimeId: "claude-code", providerId: "anthropic", modelId: "sonnet" } })).session.sessionKey;
  await admin.call("jagentchill.session.access.set", { sessionKey: builtinKey, access: "host" });
  const builtinCommands = await admin.call("jagentchill.chat.commands", { sessionKey: builtinKey });
  assert(builtinCommands.commands.some((entry: { name: string; source: string }) => entry.name === "compact" && entry.source === "builtin"));
  assert(!builtinCommands.commands.some((entry: { name: string }) => ["clear", "new"].includes(entry.name)), "no host clear/new action is invented");
  // The host runs the runtime's own compaction as a turn of its own; this runtime finishes it at once.
  h.fake.on("startTurn", (params: { sessionKey: string; message: string }) => { if (params.message === "/compact") setTimeout(() => h.fake.emit(params.sessionKey, { type: "compaction", phase: "end" }) ?? h.fake.endTurn(params.sessionKey), 5); });
  const compact = await admin.call("jagentchill.chat.send", { sessionKey: builtinKey, message: "/compact" });
  h.fake.reset("startTurn");
  assert.deepEqual(h.fake.callsOf("startTurn").filter((call: { message: string }) => call.message === "/compact").map((call: { sessionKey: string }) => call.sessionKey), [builtinKey], "/compact invokes the host compaction action");
  assert.equal((await admin.call("jagentchill.chat.history", { sessionKey: builtinKey })).messages.filter((message: { role: string }) => message.role === "user").length, 0, "the compaction is not a message of the conversation");
  assert.equal(compact.hostReply.rows[0].value, "Compacted");
  assert(!JSON.stringify(compact.hostReply).match(/gateway|agent:main:|jagentchill-unset|oauth/i), "compact confirmation contains no engine or credential identifiers");

  const claude = await admin.call("jagentchill.chat.commands", { sessionKey });
  assert(claude.commands.every((entry: { source: string }) => entry.source !== "gateway"), "engine source is never exposed on the command wire");
  // Claude Code compacts on the host's request, so the host's /compact is offered too.
  assert.deepEqual(claude.commands.slice(-3).map((entry: { name: string; source: string }) => [entry.name, entry.source]), [["status", "builtin"], ["help", "builtin"], ["compact", "builtin"]]);
  assert.deepEqual(claude.commands.filter((entry: { source: string }) => entry.source.startsWith("claude-")).map((entry: { name: string; source: string; description: string }) => [entry.name, entry.source, entry.description]), [
    ["README", "claude-personal", "Documentation is not a slash command."], ["plan-summary", "claude-personal", "Summarize a plan."], ["fix-line", "claude-project", "Fix one line."],
  ]);
  assert(claude.commands.some((entry: { name: string; source: string; description: string }) => entry.name === "focus" && entry.source === "skill" && entry.description === "Keep edits focused."));
  assert(claude.commands.some((entry: { name: string; source: string }) => entry.name === "README" && entry.source === "claude-personal"), "a Markdown README follows Claude's documented command-file rule");
  assert(!claude.commands.some((entry: { name: string }) => entry.name === "notes"), "non-Markdown files are not commands");
  // Each command below is its own turn: the one before has ended.
  const done = () => { if (h.fake.isOpen(sessionKey) && h.fake.session(sessionKey).turnId) h.fake.endTurn(sessionKey); if (h.fake.isOpen(codexKeyOf()) && h.fake.session(codexKeyOf()).turnId) h.fake.endTurn(codexKeyOf()); };
  let codexKeyRef = "";
  const codexKeyOf = () => codexKeyRef;
  await admin.call("jagentchill.chat.send", { sessionKey, message: "/unknown-command" });
  assert.equal((h.fake.callsOf("startTurn").at(-1) as { message: string }).message, "/unknown-command", "unknown slash text follows the ordinary model path unchanged");
  done();
  const beforeClaude = h.fake.callsOf("startTurn").length;
  await admin.call("jagentchill.chat.send", { sessionKey, message: "/plan-summary color grade gentle pacing" });
  assert.equal(h.fake.callsOf("startTurn").length, beforeClaude + 1, "selected custom command is delivered once");
  assert.equal((h.fake.callsOf("startTurn").at(-1) as { message: string }).message, "Review color; all=color grade gentle pacing", "Claude $1 and $ARGUMENTS expand at send");
  const commandHistory = await admin.call("jagentchill.chat.history", { sessionKey });
  assert.deepEqual(commandHistory.messages.find((message: { jagentchill?: { command?: unknown } }) => message.jagentchill?.command)?.jagentchill.command, { invocation: "/plan-summary color grade gentle pacing", expansion: "Review color; all=color grade gentle pacing" }, "the timeline gets the invocation and can reveal the exact expansion");
  done();
  const beforeSkill = h.fake.callsOf("startTurn").length;
  await admin.call("jagentchill.chat.send", { sessionKey, message: "/focus keep edits small" });
  assert.equal(h.fake.callsOf("startTurn").length, beforeSkill + 1, "a skill command is delivered once");
  assert.equal((h.fake.callsOf("startTurn").at(-1) as { message: string }).message, "Only change the requested files.\n\nArguments: keep edits small", "Claude skill body is expanded with typed arguments");

  mkdirSync(join(home, ".codex", "prompts"), { recursive: true });
  writeFileSync(join(home, ".codex", "prompts", "README.md"), "Prompt documentation, not a command.");
  mkdirSync(join(home, ".agents", "skills", "quality"), { recursive: true });
  writeFileSync(join(home, ".codex", "prompts", "outline.md"), "---\ndescription: Create an outline.\n---\nOutline $ARGUMENTS");
  writeFileSync(join(home, ".codex", "prompts", "draftpr.md"), "---\ndescription: Draft a pull request.\nargument-hint: FILE=<path> PR_TITLE=\"<title>\"\n---\nDraft $FILE with title $PR_TITLE. $ARGUMENTS and literal $$HOME.");
  writeFileSync(join(home, ".agents", "skills", "quality", "SKILL.md"), "---\nname: quality\ndescription: Check quality.\n---\nCheck the result against the brief.");
  const codexKey = (await admin.call("jagentchill.session.create", { ref: { runtimeId: "codex", providerId: "openai", modelId: "gpt-x" }, projectId: doc.id })).session.sessionKey;
  await admin.call("jagentchill.session.access.set", { sessionKey: codexKey, access: "host" });
  codexKeyRef = codexKey;
  done();
  const codex = await admin.call("jagentchill.chat.commands", { sessionKey: codexKey });
  assert(codex.commands.every((entry: { source: string }) => entry.source !== "gateway"), "Codex source strings do not expose the engine");
  const customOrder = codex.commands.filter((entry: { source: string }) => entry.source.startsWith("codex-")).map((entry: { source: string }) => entry.source);
  assert.deepEqual(customOrder, ["codex-prompt", "codex-prompt", "codex-prompt"], "Codex custom prompts come from its personal prompt directory");
  assert(codex.commands.some((entry: { name: string; source: string }) => entry.name === "README" && entry.source === "codex-prompt"), "the Codex prompt folder's README follows the Markdown filename rule");
  assert.deepEqual(codex.commands.slice(-2).map((entry: { name: string; source: string }) => [entry.name, entry.source]), [["status", "builtin"], ["help", "builtin"]], "JAgentChill commands are last");
  assert(codex.commands.some((entry: { name: string; source: string }) => entry.name === "outline" && entry.source === "codex-prompt"));
  assert(codex.commands.some((entry: { name: string; source: string; argsHint?: string }) => entry.name === "draftpr" && entry.source === "codex-prompt" && entry.argsHint === 'FILE=<path> PR_TITLE="<title>"'));
  assert(codex.commands.some((entry: { name: string; source: string }) => entry.name === "quality" && entry.source === "skill"));
  const beforeCodexSkill = h.fake.callsOf("startTurn").length;
  await admin.call("jagentchill.chat.send", { sessionKey: codexKey, message: "/quality verify tests" });
  assert.equal(h.fake.callsOf("startTurn").length, beforeCodexSkill + 1, "Codex skill command is delivered once");
  assert.equal((h.fake.callsOf("startTurn").at(-1) as { message: string }).message, "Check the result against the brief.\n\nArguments: verify tests", "Codex skill body is expanded with typed arguments");
  done();
  const beforeCodex = h.fake.callsOf("startTurn").length;
  await admin.call("jagentchill.chat.send", { sessionKey: codexKey, message: "/outline title card" });
  assert.equal(h.fake.callsOf("startTurn").length, beforeCodex + 1, "Codex prompt is delivered once");
  assert.equal((h.fake.callsOf("startTurn").at(-1) as { message: string }).message, "Outline title card", "Codex prompt expands $ARGUMENTS");
  done();
  const beforeNamedPrompt = h.fake.callsOf("startTurn").length;
  await admin.call("jagentchill.chat.send", { sessionKey: codexKey, message: '/draftpr FILE=src/index.ts PR_TITLE="Add hero animation"' });
  assert.equal(h.fake.callsOf("startTurn").length, beforeNamedPrompt + 1, "Codex named prompt is delivered once");
  assert.equal((h.fake.callsOf("startTurn").at(-1) as { message: string }).message, "Draft src/index.ts with title Add hero animation. FILE=src/index.ts PR_TITLE=Add hero animation and literal $HOME.", "Codex named arguments, all arguments, and escaped dollar expand");

  const noSession = await admin.call("jagentchill.chat.commands", { ref: { runtimeId: "claude-code", providerId: "anthropic", modelId: "sonnet" }, projectId: doc.id });
  assert(noSession.commands.some((entry: { name: string }) => entry.name === "plan-summary"), "Home receives the personal command list before a session exists");
  assert(noSession.commands.some((entry: { name: string; source: string }) => entry.name === "fix-line" && entry.source === "claude-project"), "Home passes its selected project so project commands are listed before a session exists");
});
