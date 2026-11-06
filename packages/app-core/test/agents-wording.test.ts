import assert from "node:assert/strict";
import { test } from "node:test";
import { activitySummary, applyChatEvent, emptyChat, itemsFromHistory, mergeHistory, type ToolItem } from "../src/agents/timeline.ts";
import { productWording, toolAwaitsApproval, toolOutcomeOf } from "../src/agents/worklog.ts";

test("No raw diagnostics in a work-log row: refusals and failures of a runtime's own tool read in the product's words", () => {
  // The host answers a declined permission "Denied by user"; Codex words its own refusal alike.
  assert.equal(productWording("Denied by user"), "You declined this.");
  assert.equal(productWording("exec command rejected by user"), "You declined this.");
  assert.equal(productWording("PreToolUse:Bash hook error: blocked by the project's hook"), "The action could not be completed.");
  const samples = [
    "429 rate limit exceeded; retry after 30 seconds", "insufficient_quota: exceeded quota", "HTTP 503 provider overloaded",
    "network unreachable: ENETUNREACH", "request timed out: ETIMEDOUT", "maximum context length exceeded",
    "Error: tool crashed\\n at invoke (/private/engine.js:1:2)", "Run aborted by user",
    "config rejected by provider", "session not found: private-key",
    "attachment payload too large", "agent child process killed", "turn sent while engine starting", "invalid model id: private/model",
    "request failed: internal error", "{\"error\":\"failure\",\"stack\":\"at run (/private/src/a.js:1)\"}",
  ];
  const forbidden = /ECONN|ETIMEDOUT|stack|at [A-Za-z_.]+ \(|\{"error"/i;
  for (const sample of samples) assert.doesNotMatch(productWording(sample), forbidden, sample);
  assert.equal(productWording("429 rate limit exceeded"), "The provider is limiting requests. Try again shortly.");
  assert.equal(productWording("HTTP 503 provider overloaded"), "The provider is busy right now. Try again shortly.");
  assert.equal(productWording("request timed out: ETIMEDOUT"), "The request took too long to finish. Try again.");
  // Ordinary results are left alone.
  assert.equal(productWording("Added text “DA LAT”"), "Added text “DA LAT”");
  const outcome = toolOutcomeOf("Denied by user", true);
  assert.deepEqual([outcome.ok, outcome.text, outcome.error?.message], [false, "You declined this.", "You declined this."]);
  const envelope = toolOutcomeOf(JSON.stringify({ ok: false, error: { code: "UNAVAILABLE", message: "connect ECONNREFUSED 127.0.0.1:9" } }), true);
  assert.equal(envelope.error?.message, "The host could not reach the provider. Check the connection and try again.");
});

test("A saved engine failure in chat history becomes the same mapped error row after reload", () => {
  const [item] = itemsFromHistory([{ role: "error", id: "e-run-1", timestamp: 123, content: "", jagentchill: { error: { code: "runtime/rate-limited", message: "The provider is limiting requests. Try again shortly.", messageKey: "The provider is limiting requests. Try again shortly.", action: "Try again shortly", retryable: true, raw: "429 private engine detail" } } }]);
  assert.deepEqual(item, { kind: "error", id: "e-run-1", code: "runtime/rate-limited", message: "The provider is limiting requests. Try again shortly.", messageKey: "The provider is limiting requests. Try again shortly.", action: "Try again shortly", retryable: true, raw: "429 private engine detail" });
});

test("A live failure and repeated history reads keep one error row", () => {
  const event = { event: "jagentchill.chat.error", ts_ms: 123, payload: { id: "e-run-1", runId: "run-1", error: { code: "UNAVAILABLE", message: "The action could not be completed." } } };
  const live = applyChatEvent(emptyChat(), event);
  assert.equal(applyChatEvent(live, event), live);
  const [saved] = itemsFromHistory([{ role: "error", id: "e-run-1", content: "", jagentchill: { error: { code: "UNAVAILABLE", message: "The action could not be completed." } } }]);
  const merged = mergeHistory([saved], live.items);
  assert.deepEqual(merged.map((item) => item.id), ["e-run-1"]);
});

test("The user's message is one bubble: the copy the pane showed at once is dropped when the transcript already holds the message", async () => {
  const { mergeHistory } = await import("../src/agents/timeline.ts");
  const user = (id: string, text: string) => ({ kind: "user" as const, id, text });
  const assistant = (id: string, text: string) => ({ kind: "assistant" as const, id, text });
  const prompt = "Làm cho video này đẹp lên được không, chuyển cảnh mượt hơn";
  // A new session: the first message was sent before the transcript was read, and the transcript already has it.
  assert.deepEqual(mergeHistory([user("h0", prompt)], [user("u1791", prompt)]).map((item) => item.id), ["h0"]);
  // The turn was even answered meanwhile.
  assert.deepEqual(mergeHistory([user("h0", prompt), assistant("h1", "Done.")], [user("u1791", ` ${prompt} `)]).map((item) => item.id), ["h0", "h1"]);
  // A message the transcript does not hold yet stays, after it; so do other rows; an older equal message is not mistaken for it.
  assert.deepEqual(mergeHistory([user("h0", "Hello"), assistant("h1", "Hi")], [user("u2", "And now?"), { kind: "status" as const, id: "s1", text: "Now working on Da Lat" }]).map((item) => item.id), ["h0", "h1", "u2", "s1"]);
  assert.deepEqual(mergeHistory([user("h0", "Again"), assistant("h1", "Ok"), user("h2", "Other"), assistant("h3", "Ok")], [user("u3", "Again")]).map((item) => item.id), ["h0", "h1", "h2", "h3", "u3"]);
  assert.deepEqual(mergeHistory([], [user("u4", "First")]).map((item) => item.id), ["u4"]);
});

test("Frame limit in the work log: a tool refused for a limit again and again is one refusal and one line that counts the rest", async () => {
  const { blocksOf } = await import("../src/agents/timeline.ts");
  const refused = JSON.stringify({ ok: false, warnings: [], error: { code: "RATE_LIMITED", message: "The frame budget of this minute is used up" } });
  const tool = (id: string, name: string, status: "completed" | "failed", output = "{}") => ({ kind: "tool" as const, id, name, status, output });
  const blocks = blocksOf([tool("t1", "jc_frame_render", "completed"), ...[2, 3, 4, 5, 6, 7].map((n) => tool(`t${n}`, "jc_frame_render", "failed", refused)), tool("t8", "jc_timeline_snapshot", "failed", refused), tool("t9", "jc_frame_render", "failed", refused)]);
  const steps = blocks[0].kind === "activity" ? blocks[0].steps : [];
  assert.deepEqual(steps.map((step) => [step.id, step.repeats ?? 0]), [["t1", 0], ["t2", 0], ["t3-more", 5], ["t8", 0], ["t9", 0]]);
});

test("A turn the pane did not start: the person's message is taken from the transcript when the turn ends — once", async () => {
  const { withTranscriptUser } = await import("../src/agents/timeline.ts");
  const user = (id: string, text: string) => ({ kind: "user" as const, id, text }), assistant = (id: string, text: string) => ({ kind: "assistant" as const, id, text });
  const tool = { kind: "tool" as const, id: "call_1", name: "jc_timeline_snapshot", status: "completed" as const };
  // The editor's "new session" composer sent the first message: the pane holds the turn's rows only.
  const history = [user("h0", "What is on my timeline?"), tool, assistant("h3", "One clip.")];
  assert.deepEqual(withTranscriptUser(history, [tool, assistant("a1", "One clip.")]).map((item) => item.id), ["h0", "call_1", "a1"]);
  // A pane that already shows the message is left alone (the same array comes back).
  const shown = [user("u1", "What is on my timeline?"), tool, assistant("a1", "One clip.")];
  assert.equal(withTranscriptUser(history, shown), shown);
  // A later message sent from elsewhere: the rows are the transcript's; a pane that holds an error keeps its rows.
  const later = [...history, user("h4", "And the audio?"), assistant("h5", "None.")];
  assert.deepEqual(withTranscriptUser(later, [...shown, assistant("a2", "None.")]).map((item) => item.id), ["h0", "call_1", "h3", "h4", "h5"]);
  const failed = [...shown, { kind: "error" as const, id: "e1", code: "X", message: "Stopped." }];
  assert.equal(withTranscriptUser(later, failed), failed);
  assert.equal(withTranscriptUser([], shown), shown);
});

test("A refusal of the product's own tool is shown without its code", async () => {
  const { productWording } = await import("../src/agents/worklog.ts");
  assert.equal(productWording("PROJECT_NOT_SYNCED — This project has no copy on the host."), "This project has no copy on the host.");
  assert.equal(productWording("RATE_LIMITED — At most 30 frames can be rendered per minute."), "At most 30 frames can be rendered per minute.");
  assert.equal(productWording("OK — fine"), "OK — fine");
});

test("Work log: a call the host holds for the person's approval (APPROVAL_PENDING) is a step that waits for them, not a failed step — a real failure still is", () => {
  const message = "APPROVAL_PENDING:perm_1 — this needs the user's permission, and they were asked. End your turn; when the decision arrives, call jc_workflow_create again with exactly the same parameters.";
  const envelope = JSON.stringify({ ok: false, error: { code: "APPROVAL_PENDING", message, details: { requestId: "perm_1" } } });
  const asked = { kind: "tool", id: "t1", name: "jc_workflow_create", status: "failed", output: envelope } as unknown as ToolItem;
  // As a runtime records it: the envelope, the envelope inside a content block, or only the sentence.
  assert.equal(toolAwaitsApproval(asked), true);
  assert.equal(toolAwaitsApproval({ status: "failed", output: JSON.stringify({ content: [{ type: "text", text: envelope }] }) }), true);
  assert.equal(toolAwaitsApproval({ status: "failed", output: message }), true);
  // Not a pending approval: another refusal, a call that went through, a result that only mentions the word.
  const broken = { kind: "tool", id: "t2", name: "jc_workflow_create", status: "failed", output: JSON.stringify({ ok: false, error: { code: "INVALID_PARAMS", message: "The name is missing." } }) } as unknown as ToolItem;
  assert.equal(toolAwaitsApproval(broken), false);
  assert.equal(toolAwaitsApproval({ status: "completed", output: envelope }), false);
  assert.equal(toolAwaitsApproval({ status: "failed", output: JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "No request APPROVAL_PENDING here." } }) }), false);
  // The group's header counts only what failed.
  assert.equal(activitySummary([asked], false).failed, 0);
  assert.equal(activitySummary([asked, broken], false).failed, 1);
});

// The owner's screenshot: reads of files the agent had written under /tmp all showed "The action could not be completed".
test("a runtime's file-tool refusal says why: outside the work folder, missing file, no permission — also inside a JSON result", () => {
  assert.equal(productWording(JSON.stringify({ status: "error", tool: "read", error: "Path is outside the sandbox (/Users/o/ws): /private/tmp/vieneu-config.json" })), "That file is outside the agent's work folder, so its file tools cannot open it.");
  assert.equal(productWording("file is outside workspace root"), "That file is outside the agent's work folder, so its file tools cannot open it.");
  assert.equal(productWording(JSON.stringify({ status: "error", error: "ENOENT: no such file or directory, open '/w/a.json'" })), "That file or folder does not exist.");
  assert.equal(productWording("EACCES: permission denied, open '/w/a.json'"), "The system did not allow access to that file.");
  assert.equal(productWording("Error: could not start the tool\n    at spawn (/private/a.js:1:2)"), "The action could not be completed. Try a different action.");
});

test("an editor tool that did not answer in time says so", () => {
  assert.equal(productWording("Source: API --- MCP error -32001: Request timed out"), "The editor tool took too long to answer. Try again.");
});

// The owner's screenshot: "Checked a running command — The agent is starting up" on a step that worked, and a clip move refused with "3244000 ticks".
test("a successful result keeps its own words; times in ticks read as seconds", () => {
  assert.equal(toolOutcomeOf("Process exited with code 0.").text, "Process exited with code 0.");
  assert.equal(toolOutcomeOf("Command still running (session young-shore, pid 97958).").text, "Command still running (session young-shore, pid 97958).");
  assert.equal(productWording("The range is occupied on the track \"05\". The nearest free start for this length is 3244000 ticks; use it."), "The range is occupied on the track \"05\". The nearest free start for this length is 27.03 s; use it.");
  assert.equal(productWording("The agent runtime is not running"), "The agent is starting up. Try again in a moment.");
});
