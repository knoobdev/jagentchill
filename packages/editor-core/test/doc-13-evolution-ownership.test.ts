import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { computeMinReaderSchemaVersion, ELEMENT_KEYS, generateFieldList, type BreakingFeature, type ProjectDocument } from "@jagentchill/protocol";
import { allElements, canonicalize, diffDocuments, moveElement, validateProjectDocument } from "../src/index.ts";
import { assertValid, context, element, put, SECOND, studio, tweak, video } from "./support/fixtures.ts";
import { findRestatedSchemas, lintSpecs, ownershipTable } from "./support/spec-lint.ts";

const specs = new URL("../../../openspec/changes/build-jagentchill/specs/", import.meta.url).pathname;

// Requirement: Evolution rules
/** A document as a schema-33 app writes it: the additive element field `lensCorrection`, and a key at the root. */
const schema33 = () => tweak(put(studio(), "main", { ...video("v1"), lensCorrection: { k1: 0.1 } }, video("v2", 4, 2)), (draft) => { draft.schemaVersion = 33; draft.gradeNotes = { author: "A", text: "warmer" }; draft.metadata.duration = 6 * SECOND; });

test("Evolution rules — Scenario: Additive field", () => {
  const doc = schema33();
  assert.equal(doc.minReaderSchemaVersion, 32, "an additive field never raises the minimum reader");
  const opened = assertValid(doc);
  assert.equal(opened.readOnly, false, "the schema-32 app opens it read-write");
  assert.deepEqual(opened.unknownFields.sort(), ["gradeNotes", "scenes[0].tracks.main.elements[0].lensCorrection"]);
  const saved = moveElement(doc, context(), "v2", 8 * SECOND).document;
  assert.deepEqual(element(saved, "v1").lensCorrection, { k1: 0.1 });
  assert.deepEqual((saved as any).gradeNotes, { author: "A", text: "warmer" });
});

const particle: BreakingFeature = { level: 34, name: "element type particle", present: (doc) => [...allElements(doc)].some((ref) => (ref.element as { type: string }).type === "particle") };

test("Evolution rules — Scenario: Breaking union member", () => {
  const sparks = { id: "p1", type: "particle", name: "Sparks", startTime: 0, duration: 2 * SECOND };
  const withParticle = tweak(put(studio(), "t-video", sparks), (draft) => { draft.schemaVersion = 34; }) as ProjectDocument;
  assert.equal(computeMinReaderSchemaVersion(withParticle, false, [particle]), 34);
  const without = tweak(studio(), (draft) => { draft.schemaVersion = 34; }) as ProjectDocument;
  assert.equal(computeMinReaderSchemaVersion(without, false, [particle]), 32, "a schema-34 document without one keeps the lower value");
  // A schema-32 reader does not open a document whose minimum reader is above its own schema.
  const refused = validateProjectDocument({ ...withParticle, minReaderSchemaVersion: 34 });
  assert.deepEqual([refused.errors[0].code, refused.readOnly], ["document/schema-too-new", true]);
});

test("Evolution rules — Scenario: Down-level test", () => {
  // This build is the previous app version for a schema-33 fixture: open, move, save.
  const fixture = schema33();
  const ctx = context();
  const saved = moveElement(fixture, ctx, "v2", 8 * SECOND).document;
  const changed = diffDocuments(fixture, saved).map((entry) => entry.path).sort();
  assert.deepEqual(changed, ["/metadata/duration", "/metadata/updated_ms", "/scenes/@s1/tracks/main/elements/@v2/startTime"], "only the moved field and the metadata the move rewrites");
  assert.equal(saved.schemaVersion, 33);
  const stripped = (doc: unknown) => { const copy = JSON.parse(canonicalize(doc as object)); copy.metadata.updated_ms = 0; copy.metadata.duration = 0; copy.scenes[0].tracks.main.elements[1].startTime = 0; return canonicalize(copy); };
  assert.equal(stripped(saved), stripped(fixture), "no field is lost");
});

// Requirement: Minimum reader version
test("Minimum reader version — Scenario: Schema 32", () => {
  const saved = moveElement(put(studio(), "main", video("v1")), context(), "v1", 2 * SECOND).document;
  // A document of this build (schema 33) without a breaking feature keeps the first reader level.
  assert.deepEqual([saved.schemaVersion, saved.minReaderSchemaVersion], [33, 32]);
  assert.equal(computeMinReaderSchemaVersion(saved, false), 32);
});

test("Minimum reader version — Scenario: Older app edits a newer document", () => {
  const newer = tweak(schema33(), (draft) => { draft.schemaVersion = 34; });
  const saved = moveElement(newer, context(), "v2", 8 * SECOND).document;
  assert.deepEqual([saved.schemaVersion, saved.minReaderSchemaVersion], [34, 32], "both values are unchanged");
  // While unknown content is present the value never drops below the stored one.
  const raised = tweak(schema33(), (draft) => { draft.schemaVersion = 35; draft.minReaderSchemaVersion = 33; }) as ProjectDocument;
  assert.equal(computeMinReaderSchemaVersion(raised, true), 33);
  assert.equal(computeMinReaderSchemaVersion(raised, false), 32);
});

test("Minimum reader version — Scenario: Feature removed", () => {
  // Seen from a schema-34 app, whose feature table lists `particle` at level 34.
  const sparks = { id: "p1", type: "particle", name: "Sparks", startTime: 0, duration: 2 * SECOND };
  const before = tweak(put(studio(), "t-video", sparks), (draft) => { draft.schemaVersion = 34; draft.minReaderSchemaVersion = 34; }) as ProjectDocument;
  assert.equal(computeMinReaderSchemaVersion(before, false, [particle]), 34);
  const after = tweak(before, (draft) => { draft.scenes[0].tracks.overlay[0].elements = []; }) as ProjectDocument;
  assert.equal(computeMinReaderSchemaVersion(after, false, [particle]), 32, "the highest level of the breaking features still present");
  assert.ok(computeMinReaderSchemaVersion(after, false, [particle]) <= after.schemaVersion);
});

// Requirement: Field ownership
test("Field ownership — Scenario: One owner per section", () => {
  const table = ownershipTable(readFileSync(`${specs}project-document/spec.md`, "utf8"));
  const owners = new Set(table.flatMap((entry) => entry.owners));
  assert.ok(table.length >= 20 && owners.has("timeline-editing") && owners.has("audio-editing"));
  const catalogue = readFileSync(`${specs}project-document/catalog.md`, "utf8");
  const seen = new Map<string, string>();
  let section = "", rows = 0;
  for (const line of catalogue.split("\n")) {
    const heading = /^#{2,3}\s+(\d+(?:\.\d+)?)\.?\s/.exec(line);
    if (heading) section = heading[1];
    const cells = line.split(/(?<!\\)\|/).slice(1, -1).map((cell) => cell.trim());
    if (cells.length !== 6 || cells[0] === "Field" || cells[0].startsWith("---")) continue;
    rows++;
    for (const owner of cells[5].split("/").map((name) => name.trim())) assert.ok(owners.has(owner), `§${section} ${cells[0]}: owner "${owner}" is not in the ownership table`);
    // The same field of one section never appears with two different owners.
    for (const field of cells[0].matchAll(/`([^`]+)`/g)) {
      const id = `${section}|${field[1]}`;
      assert.ok(!seen.has(id) || seen.get(id) === cells[5], `§${section} ${field[1]} has two behaviour owners`);
      seen.set(id, cells[5]);
    }
  }
  assert.ok(rows > 400, `checked ${rows} catalogue rows`);
});

test("Field ownership — Scenario: Owner wants a new field", () => {
  // The field does not exist until `project-document` adds it to the catalogue and to the Zod schema.
  assert.equal(generateFieldList().some((row) => row.key === "stereoWidth"), false);
  assert.equal(ELEMENT_KEYS.audio.includes("stereoWidth"), false);
  // Until then a writer cannot store it as a schema-32 field: it is an unknown key, kept but never interpreted.
  const result = validateProjectDocument(tweak(put(studio(), "main", video("v1")), (draft) => { draft.scenes[0].tracks.main.elements[0].stereoWidth = 120; }));
  assert.deepEqual(result.unknownFields, ["scenes[0].tracks.main.elements[0].stereoWidth"]);
});

test("Field ownership — Scenario: Restated shape is a lint error", () => {
  const structures: Record<string, string[]> = { ...ELEMENT_KEYS, transform: ["position", "scale", "rotation"], retime: ["rate", "maintainPitch", "reverse", "smooth", "curve"], marker: ["id", "time", "note", "color", "duration"] };
  const restated = "A marker SHALL be `{id, time, note?, color?, duration?}` and is listed in the panel.";
  assert.deepEqual(findRestatedSchemas("timeline-editing", restated, structures).map((entry) => [entry.capability, entry.line, entry.structure]), [["timeline-editing", 1, "marker"]]);
  assert.deepEqual(findRestatedSchemas("project-document", restated, structures), [], "the defining capability states shapes");
  assert.deepEqual(findRestatedSchemas("agent-workflows", "An edge SHALL be `{id, kind, from, to}`.", structures), [], "a structure that is not part of the document is not a restatement");
  // The specs of this change as they are.
  assert.deepEqual(lintSpecs(specs, structures), []);
});
