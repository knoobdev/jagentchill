#!/usr/bin/env node
import readline from "node:readline";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
if (process.env.JAGENTCHILL_FIXTURE_PID_FILE) { mkdirSync(dirname(process.env.JAGENTCHILL_FIXTURE_PID_FILE), { recursive: true }); writeFileSync(process.env.JAGENTCHILL_FIXTURE_PID_FILE, String(process.pid)); }
// W23A_FIXTURE_DUMP: a JSON line per start with the credential-bearing variables this CLI was given (what a test checks reaches it).
const dumpAccess = (cli, extra = {}) => { const file = process.env.W23A_FIXTURE_DUMP; if (!file) return; const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => /KEY|TOKEN|ANTHROPIC|OPENAI|OPENROUTER|GEMINI|OPENCODE|JAGENTCHILL_ENDPOINT/.test(name))); mkdirSync(dirname(file), { recursive: true }); appendFileSync(file, `${JSON.stringify({ cli, env, ...extra })}\n`); };
const rl = readline.createInterface({ input: process.stdin });
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
let sessionId = process.env.JAGENTCHILL_FAKE_CLAUDE_SESSION ?? "claude-fixture";
dumpAccess("claude", { argv: process.argv.slice(2) });
send({ type: "system", subtype: "init", session_id: sessionId, tools: [], model: "fixture-model", permissionMode: "default", cwd: process.cwd() });
rl.on("line", (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (msg.type === "control_request") {
    send({ type: "control_response", response: { subtype: "success", request_id: msg.request_id, response: {} } });
    return;
  }
  if (msg.type === "control_response") {
    send({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "claude-tool", content: "echoed", is_error: false }] } });
    send({ type: "result", subtype: "success", session_id: sessionId, usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 1 }, total_cost_usd: 0.01 });
    return;
  }
  if (msg.type !== "user") return;
  const prompt = msg.message?.content?.[0]?.text ?? "";
  if (prompt === "crash") { process.stderr.write("claude fixture exploded\nsecond claude diagnostic\n"); rl.close(); setTimeout(() => process.exit(25), 60); return; }
  if (prompt === "interrupt") return;
  send({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "claude hello" } } });
  send({ type: "assistant", message: { content: [{ type: "tool_use", id: "claude-tool", name: "jc_echo", input: { text: prompt } }] } });
  send({ type: "control_request", request_id: "claude-permission", request: { subtype: "can_use_tool", tool_name: "jc_echo", input: { text: prompt }, permission_suggestions: [] } });
});
