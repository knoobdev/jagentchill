// Pure logic of the question card; run with `node --test apps/app/src/agents/questionForm.test.ts`.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Question } from "@jagentchill/protocol";
import { EMPTY_DRAFT, allAnswered, answerText, buildAnswers, isAnswered, toggleOption, typeAnswer } from "./questionForm.ts";

const single: Question = { id: "ratio", text: "Which aspect ratio?", kind: "single", options: [{ label: "16:9" }, { label: "9:16" }] };
const multi: Question = { id: "tracks", text: "Which tracks?", kind: "multi", options: [{ label: "Video" }, { label: "Audio" }] };
const free: Question = { id: "title", text: "What is the title?", kind: "text" };

test("single-select: picking replaces the pick, tapping the picked option clears it", () => {
  const a = toggleOption(single, EMPTY_DRAFT, "16:9");
  assert.deepEqual(a.picked, ["16:9"]);
  assert.deepEqual(toggleOption(single, a, "9:16").picked, ["9:16"]);
  assert.deepEqual(toggleOption(single, a, "16:9").picked, []);
});

test("single-select: an option and a typed answer replace each other", () => {
  const typed = typeAnswer(single, toggleOption(single, EMPTY_DRAFT, "16:9"), "4:5");
  assert.deepEqual(typed, { picked: [], text: "4:5" });
  assert.deepEqual(toggleOption(single, typed, "9:16"), { picked: ["9:16"], text: "" });
});

test("multi-select keeps the checked options and the typed answer", () => {
  const draft = typeAnswer(multi, toggleOption(multi, toggleOption(multi, EMPTY_DRAFT, "Video"), "Audio"), "Captions");
  assert.deepEqual(draft, { picked: ["Video", "Audio"], text: "Captions" });
  assert.deepEqual(toggleOption(multi, draft, "Video"), { picked: ["Audio"], text: "Captions" });
});

test("answered needs a pick or non-blank text, for every question", () => {
  assert.equal(isAnswered(EMPTY_DRAFT), false);
  assert.equal(isAnswered({ picked: [], text: "   " }), false);
  assert.equal(allAnswered([single, free], { ratio: { picked: ["16:9"], text: "" } }), false);
  assert.equal(allAnswered([single, free], { ratio: { picked: ["16:9"], text: "" }, title: { picked: [], text: "Trip" } }), true);
});

test("answers take the shape the host expects, empty ones are skipped", () => {
  assert.deepEqual(buildAnswers([single, multi, free], { ratio: { picked: [], text: " 4:5 " }, tracks: { picked: ["Video"], text: "Captions" } }), [
    { id: "ratio", text: "4:5", skipped: false },
    { id: "tracks", values: ["Video"], text: "Captions", skipped: false },
    { id: "title", skipped: true },
  ]);
  assert.deepEqual(buildAnswers([single], { ratio: { picked: ["9:16"], text: "" } }), [{ id: "ratio", value: "9:16", skipped: false }]);
});

test("the answered line reads the value, the values or the text", () => {
  assert.equal(answerText(single, { id: "ratio", value: "9:16", skipped: false }), "9:16");
  assert.equal(answerText(multi, { id: "tracks", values: ["Video", "Captions"], skipped: false }), "Video, Captions");
  assert.equal(answerText(free, { id: "title", text: "Trip", skipped: false }), "Trip");
  assert.equal(answerText(free, { id: "title", skipped: true }), null);
});
