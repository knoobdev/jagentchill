import assert from "node:assert/strict";
import { test } from "node:test";
import { splitStreamingMarkdown } from "./streamMarkdown.ts";

test("streaming Markdown completes headings, paragraphs, lists, tables, and closed fences while retaining only the open tail", () => {
  const result = splitStreamingMarkdown([
    "# Title", "", "A **finished** paragraph.", "", "- first", "- second", "", "| name | value |", "| --- | --- |", "| a | b |", "",
    "```js", "const done = true;", "```", "", "The **unfinished",
  ].join("\n"));
  assert.deepEqual(result.complete, [
    "# Title", "A **finished** paragraph.", "- first\n- second", "| name | value |\n| --- | --- |\n| a | b |", "```js\nconst done = true;\n```",
  ]);
  assert.equal(result.pending, "The **unfinished");
  assert.equal(result.pendingFence, false);
});

test("an unfinished fenced block stays a language-labelled code-block tail", () => {
  const result = splitStreamingMarkdown("A finished paragraph.\n\n```ts\nconst answer = 42;");
  assert.deepEqual(result.complete, ["A finished paragraph."]);
  assert.equal(result.pending, "```ts\nconst answer = 42;");
  assert.equal(result.pendingFence, true);
});
