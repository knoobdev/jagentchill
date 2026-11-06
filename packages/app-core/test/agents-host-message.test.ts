// The host's word to the agent reaches a pane through the transcript (`withTranscriptUser`). Seen in the browser run of
// review A1: when the PERSON had sent the very same text before, the pane took the host's message for the one it already
// showed (it compared texts) and the status line never appeared until a reload. Who wrote a message is the server's mark
// (`host`), never its text — here too.
import assert from "node:assert/strict";
import { test } from "node:test";
import { itemsFromHistory, mergeHistory, withTranscriptUser, type ChatItem } from "../src/agents/timeline.ts";

const TEXT = "[JAgentChill] Permission request for jc_media_import (r1) was allowed.\nThis is a status message of the editor, not a request of the user.\n{\"requestId\":\"r1\",\"state\":\"allowed\"}";
const person = (id: string, text: string) => ({ role: "user", content: text, id });
const host = (id: string, text: string) => ({ ...person(id, text), jagentchill: { author: "host" } });
const reply = (id: string, text: string) => ({ role: "assistant", content: [{ type: "text", text }], id });
const users = (items: ChatItem[]) => items.filter((item) => item.kind === "user").map((item) => [item.id, (item as { host?: boolean }).host === true]);

test("the host's message arrives after a person's identical message: it is put into the pane, marked, and the person's stays", () => {
  const shown = itemsFromHistory([person("p1", TEXT), reply("a1", "ok")]);
  const transcript = itemsFromHistory([person("p1", TEXT), reply("a1", "ok"), host("h1", TEXT), reply("a2", "told")]);
  const merged = withTranscriptUser(transcript, [...shown, { kind: "assistant", id: "run-final", text: "told" }]);
  assert.deepEqual(users(merged), [["p1", false], ["h1", true]]);
  // Once it is there, the pane is left as it is.
  assert.equal(withTranscriptUser(transcript, merged), merged);
});

test("a person's own message that the pane already shows is still recognised by its text (the pane made that row itself)", () => {
  const transcript = itemsFromHistory([person("p1", "hello"), reply("a1", "hi")]);
  const shown: ChatItem[] = [{ kind: "user", id: "u1", text: "hello" }, { kind: "assistant", id: "run-final", text: "hi" }];
  assert.equal(withTranscriptUser(transcript, shown), shown);
  // …and a host message is never taken for the row a person's send made, nor dropped as its duplicate.
  const hostTranscript = itemsFromHistory([host("h1", TEXT), reply("a1", "told")]);
  const mine: ChatItem[] = [{ kind: "user", id: "u7", text: TEXT }];
  assert.deepEqual(users(mergeHistory(hostTranscript, mine)), [["h1", true], ["u7", false]]);
});

test("the person sees only their words when a workflow context prefix was sent to the model", () => {
  const prefix = '[Workflow "W7 Agent Panel" (wf_e39a266e2ceb46ba), revision 1, 1 steps]\n- start (trigger) "Start"';
  const transcript = itemsFromHistory([person("p1", `${prefix}\n\nCheck the workflow draft controls`), reply("a1", "stub reply")]);
  assert.deepEqual(transcript.filter((item) => item.kind === "user").map((item) => (item as { text: string }).text), ["Check the workflow draft controls"]);
});

test("a file command stays in the timeline as the invocation and carries its expansion for on-demand display", () => {
  const [command] = itemsFromHistory([{
    role: "user", content: "Review color; all=color grade gentle pacing", id: "command-1",
    jagentchill: { command: { invocation: "/plan-summary color grade gentle pacing", expansion: "Review color; all=color grade gentle pacing" } },
  }]);
  assert.deepEqual(command, {
    kind: "user", id: "command-1", ts_ms: undefined, text: "/plan-summary color grade gentle pacing",
    slashCommand: { invocation: "/plan-summary color grade gentle pacing", expansion: "Review color; all=color grade gentle pacing" },
  });
});
