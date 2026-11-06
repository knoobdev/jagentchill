// Pure: who a document was last edited by, as the project lists word it. Run with `node --test apps/app/src/sync/authorWords.test.ts`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { holderPhrase, lastEditedBy } from "./authorWords.ts";

const t = (text: string, params: Record<string, string | number> = {}) => text.replace(/\{(\w+)\}/g, (_all, key: string) => String(params[key] ?? `{${key}}`));

test("The project list never shows an id: an agent's edit is \"the agent\" (with its name when it has one), a device is its last known name", () => {
  assert.equal(lastEditedBy(t, { kind: "agent" }, "Agent"), "Last edited by the agent");
  assert.equal(lastEditedBy(t, { kind: "agent", name: "Editor A" }, "Editor A"), "Last edited by the agent “Editor A”");
  assert.equal(lastEditedBy(t, { kind: "device", name: "Studio laptop" }, "Studio laptop"), "Last edited by Studio laptop");
  assert.equal(lastEditedBy(t, { kind: "device" }, "Unknown device"), "Last edited by a device that is no longer paired");
  assert.equal(lastEditedBy(t, { kind: "run" }, "Workflow run"), "Last edited by a workflow run");
  // A host that sends no facts: its name as it is.
  assert.equal(lastEditedBy(t, undefined, "Studio laptop"), "Last edited by Studio laptop");
  assert.equal(holderPhrase(t, { kind: "agent" }, "Agent"), "The agent");
  assert.equal(holderPhrase(t, { kind: "device", name: "Phone" }, "Phone"), "Phone");
  for (const shown of [lastEditedBy(t, { kind: "agent" }, "agent:agent:main:jc:5a3224fe"), holderPhrase(t, { kind: "agent" }, "agent:agent:main:jc:5a3224fe")]) assert.doesNotMatch(shown, /agent:|jc:/);
});
