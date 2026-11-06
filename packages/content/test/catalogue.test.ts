import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CLIP_ANIMATION_ROWS, EFFECT_ROWS, FEATURED_TRANSITION_NAMES, FILTER_ROWS, TRANSITION_ROWS } from "../src/index.ts";
import { catalogueSource, extractCatalogue } from "../scripts/sync-catalogue.ts";

const count = (rows: readonly { category: string }[]) => { const out: Record<string, number> = {}; for (const row of rows) out[row.category] = (out[row.category] ?? 0) + 1; return out; };

test("the catalogue data equals the normative tables of the specs, row for row", () => {
  assert.equal(readFileSync(join(import.meta.dirname, "../src/catalogue.generated.ts"), "utf8"), catalogueSource());
  const spec = extractCatalogue();
  assert.deepEqual(JSON.parse(JSON.stringify(TRANSITION_ROWS)), spec.transitions);
  assert.deepEqual(JSON.parse(JSON.stringify(EFFECT_ROWS)), spec.effects);
  assert.deepEqual(JSON.parse(JSON.stringify(FILTER_ROWS)), spec.filters);
});

test("Bundled transition library — 55 transitions in 12 categories and 10 featured; Bundled effect library — 61 effects in 10 categories; Bundled filter library — 39 filters in 8 categories", () => {
  assert.deepEqual(count(TRANSITION_ROWS), { Basic: 8, Slide: 5, Camera: 7, Blur: 3, Distortion: 5, Glitch: 5, "Light Effect": 5, Split: 4, Mask: 5, Overlay: 2, MG: 2, "Social Media": 4 });
  assert.deepEqual(FEATURED_TRANSITION_NAMES, ["Cross Dissolve", "Dip to Black", "Slide", "Push", "Zoom In", "Whip Pan", "Blur Dissolve", "Glitch Cut", "Flash", "Luma Fade"]);
  assert.deepEqual(count(EFFECT_ROWS), { Blur: 7, Distort: 9, Stylise: 9, Light: 6, Glitch: 5, Retro: 6, Particles: 6, Lens: 5, Photo: 3, Body: 5 });
  assert.deepEqual(count(FILTER_ROWS), { Film: 6, Portrait: 5, Landscape: 5, Food: 4, Night: 4, Retro: 5, Mono: 5, Style: 5 });
  for (const rows of [TRANSITION_ROWS, EFFECT_ROWS, FILTER_ROWS]) assert.equal(new Set(rows.map((row) => row.id)).size, rows.length, "ids are unique");
  // Every row carries every field: the reader never meets an undefined one.
  for (const row of EFFECT_ROWS) assert.deepEqual([typeof row.flags, typeof row.params, typeof row.algorithm, Array.isArray(row.keywords)], ["string", "string", "string", true], row.id);
  for (const row of TRANSITION_ROWS) assert.deepEqual([typeof row.params, typeof row.algorithm, Array.isArray(row.keywords)], ["string", "string", true], row.id);
  assert.equal(EFFECT_ROWS.filter((row) => row.flags.includes("M")).length, 5);
  assert.equal(FILTER_ROWS.filter((row) => row.recipe.includes("W{")).length, 19, "19 recipes use a wheel");
});

test("Bundled clip animation library — Library counts: exactly 16 In, 16 Out and 12 Combo animations, each with its channel table", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(CLIP_ANIMATION_ROWS)), extractCatalogue().clipAnimations);
  assert.deepEqual(count(CLIP_ANIMATION_ROWS.map((row) => ({ category: row.group }))), { in: 16, out: 16, combo: 12 });
  assert.equal(new Set(CLIP_ANIMATION_ROWS.map((row) => row.id)).size, 44, "ids are unique");
  for (const row of CLIP_ANIMATION_ROWS) assert.ok(row.name.length > 0 && row.channels.length > 0, row.id);
});
