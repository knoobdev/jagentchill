#!/usr/bin/env node
import readline from "node:readline";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
if (process.env.JAGENTCHILL_FIXTURE_PID_FILE) mkdirSync(dirname(process.env.JAGENTCHILL_FIXTURE_PID_FILE), { recursive: true }), writeFileSync(process.env.JAGENTCHILL_FIXTURE_PID_FILE, String(process.pid));
// W23A_FIXTURE_DUMP: a JSON line per start with the credential-bearing variables this CLI was given (what a test checks reaches it).
const dumpAccess = (cli, extra = {}) => { const file = process.env.W23A_FIXTURE_DUMP; if (!file) return; const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => /KEY|TOKEN|ANTHROPIC|OPENAI|OPENROUTER|GEMINI|OPENCODE|JAGENTCHILL_ENDPOINT/.test(name))); mkdirSync(dirname(file), { recursive: true }); appendFileSync(file, `${JSON.stringify({ cli, env, ...extra })}\n`); };
const rl = readline.createInterface({ input: process.stdin });
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
let pendingElicitation = null;
rl.on("line", (line) => {
  let req; try { req = JSON.parse(line); } catch { return; }
  if (req.id === "elicit-1" && pendingElicitation) {
    const tid = pendingElicitation; pendingElicitation = null;
    send({ jsonrpc: "2.0", method: "textDelta", params: { turnId: tid, delta: `elicitation:${JSON.stringify(req.result)}` } });
    setTimeout(() => send({ jsonrpc: "2.0", method: "turn/completed", params: { turnId: tid } }), 20);
    return;
  }
  if (req.method === "initialize") { send({ jsonrpc: "2.0", id: req.id, result: {} }); return; }
  if (req.method === "thread/start") { dumpAccess("codex", { threadStart: req.params }); send({ jsonrpc: "2.0", id: req.id, result: { thread: { id: "thread-fixture" } } }); return; }
  if (req.method === "thread/resume") { send({ jsonrpc: "2.0", id: req.id, result: { thread: { id: req.params.threadId } } }); return; }
  if (req.method === "turn/start") {
    const tid = req.params.turnId;
    send({ jsonrpc: "2.0", id: req.id, result: { turnId: tid } });
    const prompt = req.params.input?.[0]?.text ?? req.params.prompt;
    if (prompt === "crash") { process.stderr.write("fixture exploded\nsecond diagnostic\n"); rl.close(); setTimeout(() => process.exit(23), 80); return; }
    if (prompt === "interrupt") return;
    // A real Codex asks before an MCP tool runs with an elicitation (mcpServer/elicitation/request); the reply is echoed as text.
    if (prompt === "elicit-own" || prompt === "elicit-other") {
      send({ jsonrpc: "2.0", id: "elicit-1", method: "mcpServer/elicitation/request", params: { serverName: prompt === "elicit-own" ? "jagentchill" : "someone-else", threadId: "thread-fixture", turnId: tid, mode: "form", message: "Allow the jc_project_list tool?", requestedSchema: { type: "object", properties: { approve: { type: "boolean" } } } } });
      pendingElicitation = tid;
      return;
    }
    send({ jsonrpc: "2.0", method: "item/created", params: { turnId: tid, item: { id: "tool-1", name: "jc_echo", input: { text: "hello" } } } });
    send({ jsonrpc: "2.0", method: "textDelta", params: { turnId: tid, delta: prompt ?? "hello" } });
    send({ jsonrpc: "2.0", method: "usage", params: { input_tokens: 4, output_tokens: 2 } });
    send({ jsonrpc: "2.0", id: "approval-1", method: "item/commandExecution/requestApproval", params: { command: "echo hello" } });
    setTimeout(() => send({ jsonrpc: "2.0", method: "item/updated", params: { turnId: tid, item: { id: "tool-1", input: { text: "hello" }, output: "hello" } } }), 20);
    setTimeout(() => send({ jsonrpc: "2.0", method: "item/completed", params: { turnId: tid, item: { id: "tool-1", name: "jc_echo", input: { text: "hello" }, output: "hello", status: "completed" } } }), 40);
    setTimeout(() => send({ jsonrpc: "2.0", method: "turn/completed", params: { turnId: tid } }), 100);
    return;
  }
  if (req.method === "turn/interrupt") { send({ jsonrpc: "2.0", id: req.id, result: {} }); setTimeout(() => process.exit(0), 30); return; }
  if (req.method === "model/list") { send({ jsonrpc: "2.0", id: req.id, result: { data: [{ id: "fixture-model" }] } }); return; }
  if (req.id !== undefined) send({ jsonrpc: "2.0", id: req.id, result: {} });
});
