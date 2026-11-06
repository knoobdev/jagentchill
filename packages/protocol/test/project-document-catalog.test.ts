import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { z } from "zod";
import { CATALOG_SECTIONS, createElement, createProjectDocument, createTrack, findUnknownFields, generateFieldList, projectDocumentSchema, type CatalogSection } from "../src/index.ts";
import { compareFieldLists, parseCatalog } from "./support/catalog.ts";
import { documentTypeNames, findForeignDocumentTypes } from "./support/document-type-lint.ts";

/**
 * Differences between schema and catalogue that are deliberate. Each one is a place where the catalogue's column
 * cannot express the rule; the reason says where the rule is enforced instead.
 */
const ACCEPTED = {
  "8|retime.rate|range": "the catalogue row states the writer range 0.1–100 and, in the same cell, that a migrated classic value 0.01–0.1 is valid as stored; the schema accepts what is valid as stored",
  "10.2|mediaId|default": "required, except on the element of an unfilled template slot; the validator enforces it because only it knows the slots",
  "10.4|bubble.id|default": "the row describes the `bubble` object (absent = no bubble); inside a present bubble the id is required",
};

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

test("Catalogue and schema agree: the field list generated from the Zod schemas equals the tables of catalog.md", () => {
  const { compared, differences } = compareFieldLists(generateFieldList(), parseCatalog(), ACCEPTED);
  assert.deepEqual(differences.map((entry) => `§${entry.section} ${entry.key}: ${entry.kind} — ${entry.detail}`), []);
  assert.ok(compared > 600, `compared ${compared} fields`);
  console.log(`project-document: ${compared} fields compared between the Zod schemas and catalog.md`);
});

test("A field added only in code fails CI: glowBoost is reported as in schema, not in catalogue", () => {
  const sections: CatalogSection[] = CATALOG_SECTIONS.map((entry) => (entry.section === "6"
    ? { ...entry, roots: entry.roots.map((root) => ({ ...root, shape: { ...root.shape, glowBoost: z.number().min(0).max(1).default(0) } })) }
    : entry));
  const { differences } = compareFieldLists(generateFieldList(sections), parseCatalog(), ACCEPTED);
  assert.deepEqual(differences.map((entry) => `${entry.key}: ${entry.kind}`), ["glowBoost: in schema, not in catalogue"]);
});

test("a catalogue row without a schema field, a changed range and a changed default are each reported", () => {
  const rows = parseCatalog();
  const schema = generateFieldList();
  const extra = [...rows, { section: "6", key: "stereoWidth", type: "`Percent`", range: "0–200", default: "100", owner: "audio-editing" }];
  assert.deepEqual(compareFieldLists(schema, extra, ACCEPTED).differences.map((entry) => `${entry.key}: ${entry.kind}`), ["stereoWidth: in catalogue, not in schema"]);
  const changed = rows.map((entry) => (entry.section === "7.1" && entry.key === "opacity" ? { ...entry, range: "0–2", default: "0.5" } : entry));
  assert.deepEqual(compareFieldLists(schema, changed, ACCEPTED).differences.map((entry) => `${entry.key}: ${entry.kind}`), ["opacity: range", "opacity: default"]);
  const retyped = rows.map((entry) => (entry.section === "5" && entry.key === "pan" ? { ...entry, type: "number" } : entry));
  assert.deepEqual(compareFieldLists(schema, retyped, ACCEPTED).differences.map((entry) => `${entry.key}: ${entry.kind}`), ["pan: type"]);
});

test("A second type declaration is rejected: a package other than protocol that exports a document type fails the lint", () => {
  const names = documentTypeNames(join(repoRoot, "packages/protocol/src/project-document"));
  for (const name of ["ProjectDocument", "TimelineElement", "Scene", "Track", "AssetRecord"]) assert.ok(names.has(name), name);
  // The repository as it is: no package redeclares a document structure.
  assert.deepEqual(findForeignDocumentTypes(repoRoot, ["packages", "apps", "server"], names), []);
  // A package that declares one is named.
  const fake = mkdtempSync(join(tmpdir(), "jc-lint-"));
  mkdirSync(join(fake, "packages/render/src"), { recursive: true });
  mkdirSync(join(fake, "packages/protocol/src"), { recursive: true });
  writeFileSync(join(fake, "packages/render/src/model.ts"), "export type TimelineElement = { id: string };\nexport type { Scene } from \"@jagentchill/protocol\";\n");
  writeFileSync(join(fake, "packages/protocol/src/doc.ts"), "export type TimelineElement = { id: string };\n");
  assert.deepEqual(findForeignDocumentTypes(fake, ["packages"], names), [{ file: "packages/render/src/model.ts", name: "TimelineElement" }]);
});

test("Citing a field: the horizontal position field is transform.position.x, with one range and one default", () => {
  const rows = generateFieldList().filter((entry) => entry.key === "transform.position.x");
  assert.equal(rows.length, 1, "the field is defined in exactly one place");
  assert.deepEqual({ section: rows[0].section, type: rows[0].type, min: rows[0].min, max: rows[0].max, default: rows[0].default }, { section: "7.1", type: "number", min: -100_000, max: 100_000, default: 0 });
  const catalogue = parseCatalog().filter((entry) => entry.key === "transform.position.x");
  assert.equal(catalogue.length, 1);
  assert.equal(catalogue[0].owner, "preview-canvas");
});

test("Writer creates only catalogue fields: documents, tracks and elements written by the factories hold no key outside the catalogue", () => {
  const doc = createProjectDocument({ id: "p1", mainSceneId: "s1", mainTrackId: "t1", now_ms: 1 }) as any;
  const at = { name: "x", startTime: 0, duration: 4000 };
  doc.scenes[0].tracks.overlay = [
    { ...createTrack("video", { id: "t2", name: "V" }), elements: [createElement("video", { id: "e1", mediaId: "a", ...at }), createElement("image", { id: "e2", mediaId: "a", ...at, startTime: 4000 }), createElement("compound", { id: "e3", sceneId: "s2", ...at, startTime: 8000 })] },
    { ...createTrack("text", { id: "t3", name: "T" }), elements: [createElement("text", { id: "e4", ...at })] },
    { ...createTrack("graphic", { id: "t4", name: "G" }), elements: [createElement("sticker", { id: "e5", stickerId: "flags:JP", ...at }), createElement("graphic", { id: "e6", definitionId: "star", ...at, startTime: 4000 })] },
    { ...createTrack("effect", { id: "t5", name: "E" }), elements: [createElement("effect", { id: "e7", effects: [{ id: "f1", type: "blur", kind: "effect", params: { intensity: 15 } }], ...at })] },
    { ...createTrack("adjustment", { id: "t6", name: "A" }), elements: [createElement("adjustment", { id: "e8", ...at })] },
    { ...createTrack("caption", { id: "t7", name: "C", caption: { style: {} } }), elements: [createElement("caption", { id: "e9", text: "hi", ...at })] },
  ];
  doc.scenes[0].tracks.audio = [{ ...createTrack("audio", { id: "t8", name: "A" }), elements: [createElement("audio", { id: "e10", mediaId: "a", sourceType: "upload", ...at })] }];
  assert.equal(projectDocumentSchema.safeParse(doc).success, true);
  assert.deepEqual(findUnknownFields(doc, projectDocumentSchema), []);
});
