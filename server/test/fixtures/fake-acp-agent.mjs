#!/usr/bin/env node
import readline from "node:readline";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
if (process.env.JAGENTCHILL_FIXTURE_PID_FILE) mkdirSync(dirname(process.env.JAGENTCHILL_FIXTURE_PID_FILE), { recursive: true }), writeFileSync(process.env.JAGENTCHILL_FIXTURE_PID_FILE, String(process.pid));
// W23A_FIXTURE_DUMP: a JSON line per start with the credential-bearing variables this CLI was given (what a test checks reaches it).
const dumpAccess = (cli, extra = {}) => { const file = process.env.W23A_FIXTURE_DUMP; if (!file) return; const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => /KEY|TOKEN|ANTHROPIC|OPENAI|OPENROUTER|GEMINI|OPENCODE|JAGENTCHILL_ENDPOINT/.test(name))); mkdirSync(dirname(file), { recursive: true }); appendFileSync(file, `${JSON.stringify({ cli, env, ...extra })}\n`); };
const rl = readline.createInterface({ input: process.stdin });
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
// An ACP agent answers `session/prompt` when the turn has ended (its stop reason); a cancelled turn answers "cancelled".
let pendingPrompt;
let modelSet = null;
rl.on("line", (line) => {
  let req; try { req = JSON.parse(line); } catch { return; }
  if (req.method === "initialize") { send({ jsonrpc: "2.0", id: req.id, result: { protocolVersion: 1 } }); return; }
  // Like OpenCode's ACP: the models it can use are the "model" select of `configOptions`.
  if (req.method === "session/new") { dumpAccess("acp", { argv: process.argv.slice(2) }); send({ jsonrpc: "2.0", id: req.id, result: { sessionId: "acp-fixture", configOptions: [{ id: "model", name: "Model", category: "model", type: "select", currentValue: "opencode/big-pickle", options: [{ value: "opencode/big-pickle", name: "Big Pickle" }, { value: "opencode/glm-5.3-flash-free", name: "GLM 5.3 Flash Free" }, { value: "opencode/deepseek-v4.1-flash-free", name: "DeepSeek V4.1 Flash Free" }] }] } }); return; }
  if (req.method === "session/set_config_option") { modelSet = req.params; send({ jsonrpc: "2.0", id: req.id, result: { configOptions: [] } }); return; }
  if (req.method === "session/load") { send({ jsonrpc: "2.0", id: req.id, result: { sessionId: req.params.sessionId } }); return; }
  if (req.method === "session/prompt") {
    const sid = req.params.sessionId;
    pendingPrompt = req.id;
    const prompt = req.params.prompt?.[0]?.text ?? "";
    if (prompt === "crash") { process.stderr.write("acp fixture exploded\nsecond acp diagnostic\n"); rl.close(); setTimeout(() => process.exit(24), 60); return; }
    if (prompt === "interrupt") return;
    // Echoes the model the client put the session on.
    if (prompt === "which-model") { send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: sid, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `model:${JSON.stringify(modelSet)}` } } } }); send({ jsonrpc: "2.0", id: req.id, result: { stopReason: "end_turn" } }); pendingPrompt = undefined; return; }
    send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: sid, update: { sessionUpdate: "tool_call", toolCallId: "acp-tool", title: "jc_echo", rawInput: { text: "hi" }, status: "running" } } });
    send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: sid, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } } } });
    send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: sid, update: { sessionUpdate: "tool_call_update", toolCallId: "acp-tool", rawInput: { text: "hi" }, content: [{ type: "content", text: "hi" }] } } });
    send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: sid, update: { sessionUpdate: "tool_call", toolCallId: "acp-tool", title: "jc_echo", rawInput: { text: "hi" }, content: [{ type: "content", text: "hi" }], status: "completed" } } });
    send({ jsonrpc: "2.0", method: "usage", params: { inputTokens: 3, outputTokens: 1 } });
    send({ jsonrpc: "2.0", id: "acp-permission", method: "session/request_permission", params: { sessionId: sid, toolCall: { title: "jc_write" }, options: [{ optionId: "allow_once", name: "Allow" }, { optionId: "reject_once", name: "Reject" }] } });
    setTimeout(() => { if (pendingPrompt === req.id) { pendingPrompt = undefined; send({ jsonrpc: "2.0", id: req.id, result: { stopReason: "end_turn" } }); } }, 120);
    return;
  }
  if (req.method === "session/cancel") { if (pendingPrompt !== undefined) send({ jsonrpc: "2.0", id: pendingPrompt, result: { stopReason: "cancelled" } }); pendingPrompt = undefined; if (req.id !== undefined) send({ jsonrpc: "2.0", id: req.id, result: {} }); setTimeout(() => process.exit(0), 20); return; }
  if (req.method === "turn/interrupt") { send({ jsonrpc: "2.0", id: req.id, result: {} }); return; }
  if (req.id !== undefined) send({ jsonrpc: "2.0", id: req.id, result: {} });
});
