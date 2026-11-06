import assert from "node:assert/strict";
import { test } from "node:test";

test("the package loads and builds the whole catalogue without throwing", async () => {
  // The app imports this package at start: a throw at module level blanks every screen.
  const core = await import("@jagentchill/editor-core");
  assert.deepEqual(core.CATALOGUE_LOAD_ERRORS, []);
  assert.equal(core.TRANSITION_DEFINITIONS.length, 55);
  assert.equal(core.EFFECT_DEFINITIONS.length, 61);
  assert.equal(core.FILTER_DEFINITIONS.length, 39);
  assert.equal(core.FEATURED_TRANSITIONS.length, 10);
  for (const definition of [...core.EFFECT_DEFINITIONS, ...core.FILTER_DEFINITIONS, ...core.TRANSITION_DEFINITIONS]) {
    assert.equal(typeof definition.name, "string");
    assert.ok(Array.isArray(definition.params) && Array.isArray(definition.keywords), definition.type);
    for (const param of definition.params) assert.ok(param.default !== undefined, `${definition.type}.${param.key}`);
  }
  for (const definition of core.EFFECT_DEFINITIONS) assert.equal(typeof definition.timeDriven, "boolean");
});

test("a catalogue row with missing fields yields a definition instead of a throw", async () => {
  const { safeParams, CATALOGUE_LOAD_ERRORS } = await import("@jagentchill/editor-core");
  assert.deepEqual(safeParams("x", undefined, true), []);
  const before = CATALOGUE_LOAD_ERRORS.length;
  assert.deepEqual(safeParams("broken-row", "what is this", true), []);
  assert.equal(CATALOGUE_LOAD_ERRORS.length, before + 1);
  CATALOGUE_LOAD_ERRORS.length = before;
});
