import assert from "node:assert/strict";
import { test } from "node:test";
import { LIMITS, PANEL_CAST_MAX, SHEETS_PER_KIND, planProblems, sheetsShown, storySentences, upperPlan } from "../src/film/index.ts";

// Review 13 #8: a story is cut into the sentences it is spoken in, in its own writing system.
test("A story is cut into its sentences in its own writing system: Chinese and Japanese sentence marks need no space after them, Thai is cut at its spaces (its phrase breaks), a verse at its line breaks, and one very long sentence still gets the lines it cannot do without — Vietnamese and English as before", () => {
  const count = (story: string) => storySentences(story).length;
  assert.deepEqual(storySentences("太阳升起。孩子醒来。他走到河边。"), ["太阳升起。", "孩子醒来。", "他走到河边。"]);
  assert.deepEqual(storySentences("太陽が昇った。子供が目を覚ました！「おはよう！元気？」と彼は言った。"), ["太陽が昇った。", "子供が目を覚ました！", "おはよう！", "元気？", "と彼は言った。"]);
  assert.equal(count("他问：“你去哪儿？”她没有回答……只是笑了。然后走了。"), 5, "what stands before the quoted line, the quoted line, and what follows cut at 。 and at the ellipsis (a bound: an ellipsis MAY end a sentence)");
  assert.deepEqual(storySentences("พระอาทิตย์ขึ้นแล้ว เด็กชายตื่นนอน เขาเดินไปที่แม่น้ำ"), ["พระอาทิตย์ขึ้นแล้ว", "เด็กชายตื่นนอน", "เขาเดินไปที่แม่น้ำ"]);
  assert.equal(count("Mặt trời lên. Đứa trẻ thức dậy! Nó đi ra bờ sông… rồi ngồi xuống."), 4, "Vietnamese: marks followed by a space (an ellipsis may end a sentence)");
  assert.equal(count("The sun rose at 6.30 a.m. on the river. The child woke. \"Good morning!\" he said."), 5);
  assert.equal(count("Trăng lên đỉnh núi\nGió về qua sông\nAi ngồi đợi ai\nĐêm dài mênh mông"), 4, "a verse: line breaks only");
  assert.equal(count("El sol salió. ¿Adónde vas? ¡Al río!"), 3);
  assert.equal(count("सूरज निकला। बच्चा जागा। वह नदी पर गया।"), 3);
  // The plan follows: three Chinese sentences are a film of up to three lines and three frames, not one.
  assert.deepEqual([upperPlan("太阳升起。孩子醒来。他走到河边。", "zh")].map((plan) => [plan.sentences, plan.lines, plan.panels]), [[3, 3, 3]]);
  assert.deepEqual([upperPlan("พระอาทิตย์ขึ้นแล้ว เด็กชายตื่นนอน เขาเดินไปที่แม่น้ำ", "th")].map((plan) => [plan.sentences, plan.lines, plan.panels]), [[3, 3, 3]]);
  // One very long sentence, in a script with spaces and in one without: a line holds LIMITS.lineText characters.
  const long = `${"word ".repeat(400).trim()}.`, thai = "น้ำ".repeat(1000);
  assert.deepEqual([upperPlan(long, "en").sentences, upperPlan(long, "en").lines >= Math.ceil(long.length / LIMITS.lineText), upperPlan(thai, "th").sentences, upperPlan(thai, "th").lines >= Math.ceil(thai.length / LIMITS.lineText)], [1, true, 1, true]);
});

// Review 13 #7: the sheets a story may need are bounded by what its frames can show — not by how many reference pictures one frame is drawn with.
test("The sheets of a plan are what its frames can show by the contract's caps, and the validator holds a script by the same rule on its own frames: a one-sentence story that names six people gets their six sheets and the place's; a one-word story still has room for the street and the people its film shows; a script of one frame cannot list 36 sheets; an ordinary story's bound is the ceiling 3 × 12", () => {
  const six = "Anna, Ben, Carl, Dora, Eve and Finn met at the harbour.", plan = upperPlan(six, "en");
  assert.deepEqual([plan.lines, plan.panels, plan.assets, sheetsShown(1)], [1, 1, 2 * PANEL_CAST_MAX + 1, 17]);
  const some = (count: number) => Array.from({ length: count }, () => ({})) as never[];
  assert.deepEqual(planProblems({ characters: some(6), locations: some(1), props: some(0), panels: some(1), lines: some(1) }, plan), [], "six people and the harbour: seven sheets, one frame");
  assert.deepEqual(planProblems({ characters: some(3), locations: some(2), props: some(0), panels: some(1), lines: some(1) }, upperPlan("Dusk.", "en")), [], "a film shows what its story does not name");
  // An ordinary story: the ceiling of the contract (12 of each kind).
  const story = Array.from({ length: 13 }, (_, n) => `Sentence number ${n + 1} of the story goes on here.`).join(" "), ordinary = upperPlan(story, "en");
  assert.deepEqual([ordinary.panels, ordinary.assets, sheetsShown(13), sheetsShown(2)], [13, 3 * SHEETS_PER_KIND, 3 * SHEETS_PER_KIND, 2 * SHEETS_PER_KIND + 2]);
  // The validator: what the plan allows is ALSO held to the frames the script really has.
  const fat = planProblems({ characters: some(12), locations: some(12), props: some(12), panels: some(1), lines: some(1) }, ordinary);
  assert.deepEqual([fat.length, /36 characters, locations and props together; its 1 panel can show at most 17/.test(fat[0])], [1, true]);
  assert.deepEqual(planProblems({ characters: some(12), locations: some(12), props: some(12), panels: some(13), lines: some(13) }, ordinary), []);
});
