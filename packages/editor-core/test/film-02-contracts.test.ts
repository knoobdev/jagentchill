// Pure function of Film Studio: the JSON object of a model's answer, whatever a real model wraps around it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { film as fm, promptVideo as pv } from "../src/index.ts";

test("A bare object is read as it is", () => {
  assert.deepEqual(fm.extractJson('{"logline": "x"}'), { logline: "x" });
  assert.deepEqual(fm.extractJson('  {"a": 1, "b": {"c": 2}}  '), { a: 1, b: { c: 2 } });
});

test("An object inside ```json fences is read, with or without the language tag", () => {
  assert.deepEqual(fm.extractJson('```json\n{"a": 1}\n```'), { a: 1 });
  assert.deepEqual(fm.extractJson('```\n{"a": 1}\n```'), { a: 1 });
});

test("Prose before and after the object is ignored", () => {
  assert.deepEqual(fm.extractJson('Sure. {"a": 2} Done.'), { a: 2 });
  assert.deepEqual(fm.extractJson('Sure! Here is the plan:\n```json\n{"logline": "x"}\n```\nLet me know…'), { logline: "x" });
});

test("The first balanced object in reading order wins, inside a fence or not (a fence is no priority)", () => {
  assert.deepEqual(fm.extractJson('{"first": 1} then\n```json\n{"second": 2}\n```'), { first: 1 });
  assert.deepEqual(fm.extractJson('```json\n{"first": 1}\n``` and {"second": 2}'), { first: 1 });
  assert.deepEqual(fm.extractJson('note {"a": "a } b"} after'), { a: "a } b" });
  assert.deepEqual(fm.extractJson('{"a": 1} then {"b": 2}'), { a: 1 });
});

test("A malformed first object is reported as a problem, not skipped for a later one", () => {
  assert.throws(() => fm.extractJson('{"first": } then {"second": 2}'), (error: pv.ContractError) => /not valid JSON/.test(error.problems[0]));
  // A non-JSON brace before the plan is the first object: the step asks the model to correct it rather than jumping over it.
  assert.throws(() => fm.extractJson('Use {curly} braces, then {"a": 3}'), (error: pv.ContractError) => /not valid JSON/.test(error.problems[0]));
});

test("Quotes in the prose around the object are never read as strings", () => {
  assert.deepEqual(fm.extractJson('The screen is 5" wide:\n```json\n{"a": 1}\n```'), { a: 1 });
  assert.deepEqual(fm.extractJson('A 5" screen, then {"a": 2} after'), { a: 2 });
});

test("Trailing commas are tolerated, smart quotes are not repaired", () => {
  assert.deepEqual(fm.extractJson('{"a": 1, "b": [1, 2,],}'), { a: 1, b: [1, 2] });
  assert.throws(() => fm.extractJson('{“a”: 1}'), (error: pv.ContractError) => /not valid JSON/.test(error.problems[0]));
});

test("No object at all reads as undefined", () => {
  assert.equal(fm.extractJson("I cannot do that."), undefined);
  assert.equal(fm.extractJson("[1, 2, 3]"), undefined);
  assert.equal(fm.extractJson(""), undefined);
});

test("A character sheet carries age and gender, and a minor gets the clothed portrait instead of a turnaround sheet", () => {
  const film = fm.createFilm({ id: "film_1", now_ms: 1, title: "T" });
  const adult = fm.assetPrompt(film, "character", { name: "Linh", appearance: "black braid", age: "24", gender: "female" });
  assert.match(adult, /24 years old, female/, "the age and the gender are stated so the model does not draw an adult");
  assert.match(adult, /Character reference sheet/, "an adult gets the turnaround sheet");
  // 17 is under 18: a clothed portrait, never the reference sheet an image provider refuses for a minor.
  const child = fm.assetPrompt(film, "character", { name: "Bé", appearance: "short hair", age: "17", gender: "female" });
  assert.match(child, /portrait of a child in everyday clothes/);
  assert.ok(!/Character reference sheet/.test(child), "a minor is not asked for a turnaround sheet");
  // 18 is not a minor, and a neutral gender is left out of the wording.
  assert.match(fm.assetPrompt(film, "character", { name: "Minh", appearance: "grey hoodie", age: "18", gender: "neutral" }), /18 years old(?!,)/);
  // No age, no age phrase; locations and props keep their own sheets.
  assert.ok(!/years old/.test(fm.assetPrompt(film, "character", { name: "Noa", appearance: "cap" })));
  assert.match(fm.assetPrompt(film, "location", { name: "Street", appearance: "wet cobbles" }), /Location plate/);
  assert.match(fm.assetPrompt(film, "prop", { name: "Lantern", appearance: "faded red paper" }), /Prop sheet/);
});
