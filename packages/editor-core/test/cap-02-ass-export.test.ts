import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAss, writeAss } from "../src/index.ts";

test("writeAss writes one Dialogue event per caption that parseAss reads back with the same times and text", () => {
  const cues = [
    { start_ms: 5200, end_ms: 7990, text: "Second line\nof two" },
    { start_ms: 1000, end_ms: 2500, text: "Xin chào {Đà Lạt}" },
    { start_ms: 3_725_010, end_ms: 3_726_000, text: "After an hour" },
    { start_ms: 9000, end_ms: 9500, text: "   " },
  ];
  const text = writeAss(cues);
  assert.match(text, /^\[Script Info\]\nScriptType: v4\.00\+/);
  assert.equal(text.split("\n").filter((line) => line.startsWith("Dialogue:")).length, 3, "the empty caption is left out");
  assert.ok(text.includes("Dialogue: 0,0:00:05.20,0:00:07.99,Default,,0,0,0,,Second line\\Nof two"));
  assert.ok(text.includes("Dialogue: 0,1:02:05.01,1:02:06.00,Default,,0,0,0,,After an hour"));
  const parsed = parseAss(text);
  assert.deepEqual(parsed.cues.map((cue) => [cue.start_ms, cue.end_ms, cue.text]), [[1000, 2500, "Xin chào Đà Lạt"], [5200, 7990, "Second line\nof two"], [3_725_010, 3_726_000, "After an hour"]]);
  // A range keeps the captions that touch it.
  assert.equal(writeAss(cues, { range: { start_ms: 0, end_ms: 3000 } }).split("\n").filter((line) => line.startsWith("Dialogue:")).length, 1);
});
