import assert from "node:assert/strict";
import { test } from "node:test";
import { LIMITS, PANEL_CAST_MAX, PROMPTS, SHEETS_PER_KIND, createFilm, planProblems, storySentences, upperPlan } from "../src/film/index.ts";

test("The plan of a film comes from its story's own sentences: a quoted line is a line of its own and what stands around it another; lines ≤ sentences, frames ≤ lines, sheets ≤ what the frames can show — the same story always gives the same plan", () => {
  const story = `Linh glued silk onto a bamboo frame. "We have no light," the mayor said. "Then we use ours!" The street glowed.\nThey call her "bà Tư" in the market.`;
  assert.deepEqual(storySentences(story), ["Linh glued silk onto a bamboo frame.", "We have no light", "the mayor said.", "Then we use ours!", "The street glowed.", `They call her "bà Tư" in the market.`]);
  const plan = upperPlan(story, "en");
  assert.deepEqual([plan.sentences, plan.lines, plan.panels, plan.assets, plan.spokenCharacters], [6, 6, 6, 2 * SHEETS_PER_KIND + 6, 6 * LIMITS.lineText]);
  assert.deepEqual(upperPlan(story, "en"), plan);
  // One sentence: one line, one frame, and no more sheets than that frame can SHOW (run 12: not "what one frame can reference").
  assert.deepEqual([upperPlan("Hoi An, the night of the full moon.", "en")].map((entry) => [entry.lines, entry.panels, entry.assets]), [[1, 1, 2 * PANEL_CAST_MAX + 1]]);
  // A story of few, very long sentences still gets the lines it cannot do without: a line holds LIMITS.lineText characters, a panel lasts 15 seconds.
  const long = `${"word ".repeat(400).trim()}.`, needed = upperPlan(long, "en");
  assert.deepEqual([needed.sentences, needed.lines >= Math.ceil(long.length / LIMITS.lineText), needed.lines >= Math.ceil(needed.seconds / 15), needed.panels], [1, true, true, needed.lines]);
  // The film's own limits hold whatever the story is.
  const huge = upperPlan("A. ".repeat(5000), "en");
  assert.deepEqual([huge.lines, huge.panels, huge.assets], [LIMITS.lines, LIMITS.panels, 3 * SHEETS_PER_KIND]);
});

test("The plan binds the writer: the script prompt states the three limits, and a breakdown over any of them is named as a problem (inside them: none)", () => {
  const film = createFilm({ id: "film_1", now_ms: 1, title: "T", sourceText: "One. Two. Three." }), plan = upperPlan(film.sourceText, film.language);
  assert.match(PROMPTS.breakdown(film, plan), /at most 3 panels in all, at most 3 lines in all, and at most 27 characters, locations and props together/);
  assert.doesNotMatch(PROMPTS.breakdown(film), /LIMITS of this film/);
  const some = (count: number) => Array.from({ length: count }, () => ({})) as never[];
  assert.deepEqual(planProblems({ characters: some(2), locations: some(1), props: some(0), panels: some(3), lines: some(3) }, plan), []);
  const over = planProblems({ characters: some(12), locations: some(12), props: some(12), panels: some(14), lines: some(5) }, plan);
  assert.deepEqual(over.map((problem) => problem.split(";")[0]), ["the plan has 14 panels", "the plan has 5 lines", "the plan lists 36 characters, locations and props together"]);
  assert.ok(over.every((problem) => /this film takes at most (3|27)\b/.test(problem)));
});
