import assert from "node:assert/strict";
import { test } from "node:test";
import { checkSpeech, checkUnheard, speechLengthProblem, speechMatch, spokenWords } from "../src/film/index.ts";

test("Speech check: the words heard are compared without case and punctuation, and marks on letters stay part of the word", () => {
  assert.deepEqual(spokenWords("Nồi vẫn đầy... khách chẳng còn như xưa."), ["nồi", "vẫn", "đầy", "khách", "chẳng", "còn", "như", "xưa"]);
  assert.equal(speechMatch("Nồi vẫn đầy... khách chẳng còn như xưa.", "nồi vẫn đầy, khách chẳng còn như xưa."), 1);
  // What a wrong reader really produced on the provider (2026-10-07): the same line heard as other words.
  assert.ok(speechMatch("Nồi vẫn đầy... khách chẳng còn như xưa.", "nói vấn đề các chương còn nhớ sư.") < 0.3);
  // Marks matter: "ma" is not "má".
  assert.ok(speechMatch("má đi chợ", "ma đi chợ") < 0.8);
});
test("Speech check: a recording far longer or shorter than a person reading the line is not the line", () => {
  // The real failure: an 8-word line that took 16 seconds.
  assert.equal(speechLengthProblem("Nồi vẫn đầy... khách chẳng còn như xưa.", 16), "too_long");
  assert.equal(speechLengthProblem("Nồi vẫn đầy... khách chẳng còn như xưa.", 3.2), undefined);
  assert.equal(speechLengthProblem("Hồi nhỏ cô cũng nhặt một con y như vầy, cũng trú mưa ngay chỗ này.", 0.6), "too_short");
  assert.equal(speechLengthProblem("Dạ!", 0.05), "silent");
});
test("Speech check: the verdict names why a take fails, and a take nobody listened to has no verdict at all", () => {
  assert.deepEqual(checkSpeech("Về thôi, cả ba mẹ con mình.", 2.48, "về thôi cả ba mẹ con mình."), { ok: true, score: 1, heard: "về thôi cả ba mẹ con mình.", seconds: 2.48 });
  assert.equal(checkSpeech("Về thôi, cả ba mẹ con mình.", 2.5, "xin chào các bạn").reason, "words");
  assert.equal(checkSpeech("Dạ! Cảm ơn cô Tư!", 8.6, "dạ cảm ơn cô tư").reason, "too_long");
  // Nobody listened: there is NO verdict (never "ok, score 1") — unless the length alone shows it is not the line.
  assert.equal(checkUnheard("Về thôi, cả ba mẹ con mình.", 2.5), undefined);
  assert.deepEqual(checkUnheard("Dạ! Cảm ơn cô Tư!", 8.6), { ok: false, score: 0, heard: "", seconds: 8.6, reason: "too_long" });
});

test("Story quotes: what the story's people say is found between quotation marks — short lines too, a quoted name not — each with the speaker the story names beside it", async () => {
  const { quotesOf, storyQuotes } = await import("../src/film/index.ts");
  const story = 'Bin mở ra. "Con nhặt được nó ở cống, nhưng mẹ con không cho nuôi," Bin nói. Bà Tư cười: “Hồi nhỏ cô cũng nhặt một con y như vầy, cũng trú mưa ngay chỗ này.” Chị Hạnh bảo: "Về thôi, cả ba mẹ con mình." "Dạ!" Người ta gọi bà là "bà Tư".';
  assert.deepEqual(storyQuotes(story), ["Con nhặt được nó ở cống, nhưng mẹ con không cho nuôi", "Hồi nhỏ cô cũng nhặt một con y như vầy, cũng trú mưa ngay chỗ này.", "Về thôi, cả ba mẹ con mình.", "Dạ!"]);
  assert.deepEqual(quotesOf(story, ["Bin", "Bà Tư", "Chị Hạnh"]).map((quote) => quote.speaker), ["Bin", "Bà Tư", "Chị Hạnh", undefined]);
});
test("A script is held to the story: a quote must be spoken word for word (not reworded, not scattered), as dialogue, by the story's speaker — and the story is told by the Narrator, not only quoted", async () => {
  const { scriptProblems, unspokenQuotes } = await import("../src/film/index.ts");
  const story = 'Mưa. "Con nhặt được nó ở cống, nhưng mẹ con không cho nuôi," Bin nói. Chị Hạnh bảo: "Về thôi, cả ba mẹ con mình." "Dạ!"';
  const names = ["Bin", "Chị Hạnh"], panels = ["p1", "p2", "p3"];
  const line = (speaker: string, text: string, panelId = "p1", kind = speaker === "Narrator" ? "narration" : "dialogue") => ({ speaker, text, panelId, kind });
  const good = [line("Narrator", "Mưa.", "p1"), line("Bin", "Con nhặt được nó ở cống,", "p2"), line("Bin", "nhưng mẹ con không cho nuôi.", "p2"), line("Chị Hạnh", "Về thôi, cả ba mẹ con mình.", "p3"), line("Bin", "Dạ!", "p3")];
  assert.deepEqual(scriptProblems(story, good, panels, names), [], "one quote split over two lines of its speaker is the quote");
  // The real failures (2026-10-07): the words of the quote scattered through a longer line of the model's own, and a paraphrase.
  const scattered = scriptProblems(story, [...good.slice(0, 3), line("Chị Hạnh", "Về thôi Bin, cả ba mẹ con mình về.", "p3"), good[4]], panels, names);
  assert.equal(scattered.length, 1);
  assert.match(scattered[0], /"Về thôi, cả ba mẹ con mình\." is not spoken word for word/);
  assert.match(scriptProblems(story, [good[0], line("Bin", "Con nhặt nó ở cống mà mẹ không cho nuôi.", "p2"), good[3], good[4]], panels, names)[0], /is not spoken word for word/);
  // The short quote counts.
  assert.match(scriptProblems(story, good.slice(0, 4), panels, names)[0], /"Dạ!" is not spoken word for word/);
  // The right words by the wrong person, or told by the Narrator.
  assert.match(scriptProblems(story, [...good.slice(0, 3), line("Bin", "Về thôi, cả ba mẹ con mình.", "p3"), good[4]], panels, names)[0], /is said by Chị Hạnh in the story, not by Bin/);
  assert.match(scriptProblems(story, [...good.slice(0, 3), line("Narrator", "Về thôi, cả ba mẹ con mình.", "p3"), good[4]], panels, names)[0], /is told by the Narrator — it is dialogue/);
  // The story must be told: prose outside the quotes needs the Narrator, and most panels may not be silent.
  assert.deepEqual(scriptProblems(story, good.slice(1), panels, names), ["the plan has no narration: everything the story tells outside its quotation marks is carried by the Narrator, in the story's own sentences"]);
  assert.deepEqual(scriptProblems('Mưa rơi trên phố suốt đêm. "Dạ!"', [line("Narrator", "Mưa rơi.", "p1"), line("Bin", "Dạ!", "p1")], ["p1", "p2", "p3"], names), ["2 of 3 panels have no line (panels 2, 3): where nobody speaks, the Narrator tells that part of the story"]);
  assert.deepEqual(scriptProblems('Mưa rơi trên phố suốt đêm. "Dạ!"', [line("Narrator", "Mưa rơi.", "p1"), line("Bin", "Dạ!", "p2")], ["p1", "p2", "p3"], names), [], "one silent beat in three is a film");
  assert.deepEqual(unspokenQuotes(story, ["Về thôi Bin, cả ba mẹ con mình về.", "Dạ!", "Con nhặt được nó ở cống, nhưng mẹ con không cho nuôi."]), ["Về thôi, cả ba mẹ con mình."]);
  assert.deepEqual(scriptProblems("A story with no dialogue at all.", [], [], []), []);
});
test("Short dialogue with no punctuation inside the quotation marks is still a line when the story attributes it: Mary said: “Go” cannot be rewritten as \"Stay here.\"", async () => {
  const { quotesOf, scriptProblems } = await import("../src/film/index.ts");
  const story = "The door was open and the rain had stopped. Mary said: “Go” Then nobody moved. They called the dog \"Rex\" in those days.";
  assert.deepEqual(quotesOf(story, ["Mary"]), [{ text: "Go", speaker: "Mary" }]);
  const narration = { speaker: "Narrator", text: "The door was open and the rain had stopped.", panelId: "p1", kind: "narration" };
  const rewritten = scriptProblems(story, [narration, { speaker: "Mary", text: "Stay here.", panelId: "p1", kind: "dialogue" }], ["p1"], ["Mary"]);
  assert.equal(rewritten.length, 1);
  assert.match(rewritten[0], /the story's line "Go" is not spoken word for word/);
  assert.deepEqual(scriptProblems(story, [narration, { speaker: "Mary", text: "Go", panelId: "p1", kind: "dialogue" }], ["p1"], ["Mary"]), []);
  assert.deepEqual(quotesOf("“Go” said Mary. He was known as \"Red\" there.", ["Mary"]).map((quote) => quote.text), ["Go"]);
});
