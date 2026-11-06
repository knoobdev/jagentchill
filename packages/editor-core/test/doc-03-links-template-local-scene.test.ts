import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acceptPatch, addAsset, addGlossaryPair, applyBrand, canonicalize, deriveCredits, diffDocuments, documentHash, fillTemplateSlot, insertElement, leaveTemplateMode,
  moveElement, moveScene, setElementFields, setExportSettings, switchScene, toBoundaryError, trimElement, validateDocumentChange, validateProjectDocument, deleteElements,
} from "../src/index.ts";
import { asset, assertFails, assertValid, codes, context, element, HASH, put, rejected, SECOND, studio, tweak, validate, video } from "./support/fixtures.ts";
import { templateDraft } from "./support/template.ts";

const scriptLink = (scriptId: string) => ({ scriptId, sceneId: "sc1", versionId: "ver1", syncedHash: HASH("a") });

// Requirement: Project provenance links
test("Project provenance links — Scenario: Element link implies project link", () => {
  const commit = insertElement(studio(), context(), "t-main", { type: "image", id: "i1", name: "Shot 1", startTime: 0, duration: 2 * SECOND, mediaId: "a2", scriptLink: scriptLink("s1") });
  assert.deepEqual(commit.document.scriptLinks, [{ scriptId: "s1" }]);
  assert.ok(commit.patch.some((entry) => entry.path.startsWith("/scriptLinks")), "the same patch adds the project entry");
  // Removing the last element link of the script removes the project entry in the same step.
  const removed = deleteElements(commit.document, context(), ["i1"]);
  assert.deepEqual(removed.document.scriptLinks, []);
});

test("Project provenance links — Scenario: Missing project entry is invalid", () => {
  const doc = put(studio(), "main", { ...video("v1"), scriptLink: scriptLink("s2") });
  const error = assertFails(doc, "document/unknown-reference");
  assert.equal(error.path, "/scenes/@s1/tracks/main/elements/@v1/scriptLink");
  assertFails(tweak(studio(), (draft) => { draft.scriptLink = { scriptId: "s2" }; }), "document/field-not-allowed", "/scriptLink");
});

test("Project provenance links — Scenario: Deleted target stays valid", () => {
  // The film named by the link exists nowhere in the document: links are data, never resolved by the validator.
  const doc = tweak(put(studio(), "main", { ...video("v1"), filmLink: { filmId: "film-gone", episodeId: "ep1", assetVersionId: "av1" }, workflowLink: { runId: "r1", stepId: "st1", artifactVersionId: "art1" } }), (draft) => {
    draft.filmLink = { filmId: "film-gone", episodeId: "ep1" };
    draft.workflowLink = { runId: "r1" };
  });
  const result = assertValid(doc);
  assert.deepEqual(result.warnings, []);
});

// Requirement: Template mode model
test("Template mode model — Scenario: Unfilled slot element", () => {
  const doc = templateDraft();
  assert.equal(doc.template!.slots[2].filled, false);
  assert.equal("mediaId" in element(doc, "slot3"), false);
  assertValid(doc);
});

test("Template mode model — Scenario: Element without media outside a slot", () => {
  const doc = tweak(put(studio(), "main", video("v1")), (draft) => { delete draft.scenes[0].tracks.main.elements[0].mediaId; });
  const error = assertFails(doc, "document/missing-field");
  assert.equal(error.path, "/scenes/@s1/tracks/main/elements/@v1/mediaId");
});

test("Template mode model — Scenario: Slot points at a text element", () => {
  assertFails(tweak(templateDraft(), (draft) => { draft.template.slots[0].elementId = "free"; }), "document/template-invalid", "/template/slots/@sl1/elementId");
  assertFails(tweak(templateDraft(), (draft) => { draft.template.slots[1].index = 5; }), "document/template-invalid", "/template/slots");
  assertFails(tweak(templateDraft(), (draft) => { draft.template.slots[0].duration = 120_000; }), "document/template-invalid");
  assertFails(tweak(templateDraft(), (draft) => { draft.template.editableTexts.push({ elementId: "slot1", label: "x", maxLength: 10 }); }), "document/template-invalid");
});

test("Template mode model — Scenario: Leaving template mode", () => {
  const locked = templateDraft();
  rejected(() => moveElement(locked, context(), "free", 4 * SECOND), "document/template-locked");
  const open = leaveTemplateMode(locked, context()).document;
  assert.equal(open.template!.locked, false);
  assert.deepEqual(open.template!.slots.map((slot) => slot.filled), [true, true, true]);
  const slate = open.media.assets.find((entry) => entry.id === element(open, "slot3").mediaId)!;
  assert.equal(slate.kind, "slate");
  assert.equal(open.template!.templateId, "tpl1", "the template object stays as a record of origin");
  assertValid(open);
  // The next structural edit is accepted.
  assert.equal(element(moveElement(open, context(), "free", 4 * SECOND).document, "free").startTime, 4 * SECOND);
});

test("Template mode model — Scenario: Brand colours follow the bindings", () => {
  const before = tweak(templateDraft(), (draft) => { draft.template.colorBindings = [{ colorIndex: 0, elementId: "title", field: "color" }]; });
  const after = applyBrand(before, context(), ["#112233"]).document;
  assert.equal(element(after, "title").color, "#112233");
  assert.deepEqual(after.template!.themeColors, ["#112233", "#00ff00"]);
  // No other colour field of the document changes.
  const changed = diffDocuments(before, after).map((entry) => entry.path).filter((path) => path !== "/metadata/updated_ms");
  assert.deepEqual(changed.sort(), ["/scenes/@s1/tracks/overlay/@t-text/elements/@title/color", "/template/themeColors/0"].sort());
  assert.equal(element(after, "free").color, "#ffffff");
});

// Requirement: Template lock enforcement
test("Template lock enforcement — Scenario: Agent tool cannot trim a locked template", () => {
  const before = templateDraft();
  const hash = documentHash(before);
  const errors = rejected(() => trimElement(before, context({ writer: { id: "agent:session-1" } }), "slot1", { duration: SECOND }), "document/template-locked");
  assert.equal(documentHash(before), hash, "the document is unchanged");
  assert.equal(toBoundaryError(errors, "tool").code, "CONFLICT");
});

test("Template lock enforcement — Scenario: Replacing slot media is allowed", () => {
  const before = tweak(templateDraft(), (draft) => { draft.media.assets.push(asset("a9", "video", { duration: 6 * SECOND })); });
  const commit = fillTemplateSlot(before, context(), "sl2", "a9", { sourceOffset: SECOND, framing: { panX: 0.4 } });
  const clip = element(commit.document, "slot2"), slot = commit.document.template!.slots[1];
  assert.deepEqual([clip.mediaId, clip.sourceDuration, clip.trimStart, clip.trimEnd], ["a9", 6 * SECOND, SECOND, 3 * SECOND]);
  assert.deepEqual([slot.filled, slot.framing, slot.sourceOffset], [true, { zoom: 1, panX: 0.4, panY: 0 }, SECOND]);
  assert.equal(commit.history, true, "one undo step");
  // The other allowed differences: slot levels and name, editable text, audio-slot levels and media, project-level data.
  for (const allowed of [
    () => setElementFields(before, context(), "slot1", { volume: -6, muted: true, name: "Opening" }),
    () => setElementFields(before, context(), "title", { content: "Launch day" }),
    () => setElementFields(before, context(), "music", { volume: -12, muted: false }),
    () => setExportSettings(before, context(), { values: { scope: "project" } }),
  ]) assert.ok(allowed().patch.length > 0);
  // A structural difference, and a text style change outside "Apply brand", are not.
  rejected(() => setElementFields(before, context(), "title", { fontFamily: "Inter" }), "document/template-locked");
  rejected(() => setElementFields(before, context(), "slot1", { opacity: 0.5 }), "document/template-locked");
  rejected(() => setElementFields(before, context(), "free", { content: "not an editable text" }), "document/template-locked");
});

test("Template lock enforcement — Scenario: Remote patch from an older layout", () => {
  const before = templateDraft();
  const patch = [{ op: "replace" as const, path: "/scenes/@s1/tracks/overlay/@t-text/elements/@free/startTime", value: 4 * SECOND }];
  const errors = rejected(() => acceptPatch(before, patch, { writer: { id: "device:phone" } }), "document/template-locked");
  // The follow path reports it as a sync application failure with the same details.
  const reported = toBoundaryError(errors, "sync");
  assert.equal(reported.code, "PATCH_INVALID");
  assert.equal(reported.details.documentErrors[0].code, "document/template-locked");
  assert.equal(element(before, "free").startTime, 2 * SECOND);
});

test("Template lock enforcement — Scenario: Text over its limit", () => {
  const before = templateDraft();
  const errors = rejected(() => setElementFields(before, context(), "title", { content: "x".repeat(41) }), "document/out-of-range");
  assert.ok(errors[0].path.endsWith("/elements/@title/content"));
  assert.ok(setElementFields(before, context(), "title", { content: "x".repeat(40) }).patch.length > 0);
  // The rule is evaluated on the two documents, so it is the same for a before/after pair built by any writer.
  const after = tweak(before, (draft) => { draft.scenes[0].tracks.overlay[1].elements[1].startTime = 6 * SECOND; });
  assert.deepEqual(codes(validateDocumentChange(before, after)), ["document/template-locked"]);
});

// Requirement: Project-level stores
test("Project-level stores — Scenario: Glossary stored per language", () => {
  const commit = addGlossaryPair(studio(), context(), "ja", "Gateway", "ゲートウェイ");
  assert.deepEqual(commit.document.glossaries.ja, [{ source: "Gateway", target: "ゲートウェイ" }]);
  assert.equal(commit.history, true);
  assert.deepEqual(commit.patch.filter((entry) => entry.path.startsWith("/glossaries")), [{ op: "add", path: "/glossaries/ja", value: [{ source: "Gateway", target: "ゲートウェイ" }] }]);
});

test("Project-level stores — Scenario: Path in export settings rejected", () => {
  assertFails(tweak(studio(), (draft) => { draft.exportSettings = { values: { path: "/Users/a/out.mp4" } }; }), "document/field-not-allowed", "/exportSettings/values/path");
  assertFails(tweak(studio(), (draft) => { draft.exportSettings = { values: { codec: "C:\\out\\clip.mp4" } }; }), "document/field-not-allowed");
  for (const key of ["token", "passcode"]) assertFails(tweak(studio(), (draft) => { draft.exportSettings = { values: { [key]: "s3cret" } }; }), "document/field-not-allowed");
  assertValid(tweak(studio(), (draft) => { draft.exportSettings = { type: "video", values: { codec: "h264", container: "mp4", resolution: { width: 1920, height: 1080 } } }; draft.publish = { title: "Launch", description: "" }; }));
});

test("Project-level stores — Scenario: Credits are derived", () => {
  const stock = { source: "stock", provider: "pexels", itemId: "9", author: "Ana", licence: "Pexels", licenceUrl: "https://pexels.com/license", sourceUrl: "https://pexels.com/9", attributionRequired: true };
  const withAsset = addAsset(studio(), context(), { id: "st1", name: "city.mp4", type: "video", size: 10, duration: 4 * SECOND, provenance: stock }).document;
  const doc = put(withAsset, "main", video("v1", 0, 2, { mediaId: "st1" }), video("v2", 2, 2));
  assert.deepEqual(deriveCredits(doc), [{ assetId: "st1", name: "city.mp4", author: "Ana", licence: "Pexels", sourceUrl: "https://pexels.com/9" }]);
  assert.deepEqual(deriveCredits(doc, { start: 2 * SECOND, end: 4 * SECOND }), [], "only assets used in the export range");
  assert.equal("credits" in doc, false);
  assertFails({ ...doc, credits: [] }, "document/field-not-allowed", "/credits");
});

// Requirement: Device-local section
test("Device-local section — Scenario: Scene switch is local", () => {
  const before = tweak(studio(), (draft) => { draft.scenes.push({ ...draft.scenes[0], id: "s2", name: "B-roll", isMain: false, kind: "compound", tracks: { overlay: [], main: { ...draft.scenes[0].tracks.main, id: "t-main-2" }, audio: [] } }); });
  const after = switchScene(before, "s2");
  assert.equal((after as any).local.currentSceneId, "s2");
  assert.deepEqual(diffDocuments(before, after), [], "no state patch is emitted");
  assert.equal(after.metadata.updated_ms, before.metadata.updated_ms);
  assert.equal(documentHash(after), documentHash(before));
});

test("Device-local section — Scenario: Corrupt local section", () => {
  const stored = { ...studio(), local: { currentSceneId: "s1", timelineViewState: { zoomLevel: "big" } } };
  const loaded = validateProjectDocument(stored, { mode: "load" });
  assert.equal(loaded.ok, true, "a malformed local never fails a load");
  assert.deepEqual((loaded.document as any).local, {
    currentSceneId: "s1", timelineViewState: { zoomLevel: 1, scrollLeft: 0, playheadTime: 0, scenePlayheads: {}, expandedKeyframeElementIds: [] },
    folderId: null, trash: null, media: {}, uniformScaleLock: {},
  });
  assert.deepEqual(loaded.repairs!.map((repair) => [repair.kind, repair.path]), [["reset-local", "/local/timelineViewState/zoomLevel"]]);
  // In strict mode `local` is not part of what is validated either.
  assert.equal(validate(stored).ok, true);
});

test("Device-local section — Scenario: Package leaves local out", () => {
  const doc = switchScene(studio(), "s1");
  assert.ok("local" in doc);
  // The canonical form is what a package's project.json holds.
  assert.equal("local" in JSON.parse(canonicalize(doc)), false);
});

// Requirement: Scene fields
test("Scene fields — Scenario: Two main scenes", () => {
  const doc = tweak(studio(), (draft) => { draft.scenes.push({ ...draft.scenes[0], id: "s2", tracks: { overlay: [], main: { ...draft.scenes[0].tracks.main, id: "t-main-2" }, audio: [] } }); });
  assertFails(doc, "document/no-main-scene", "/scenes");
  assertFails(tweak(studio(), (draft) => { draft.scenes[0].isMain = false; }), "document/no-main-scene");
  assertFails(tweak(studio(), (draft) => { draft.scenes[0].kind = "compound"; }), "document/no-main-scene");
});

test("Scene fields — Scenario: Range order", () => {
  const error = assertFails(tweak(studio(), (draft) => { draft.scenes[0].inPoint = 480_000; draft.scenes[0].outPoint = 240_000; }), "document/out-of-range");
  assert.equal(error.path, "/scenes/@s1/outPoint");
  assertValid(tweak(studio(), (draft) => { draft.scenes[0].inPoint = 240_000; draft.scenes[0].outPoint = 480_000; }));
});

test("Scene fields — Scenario: Scene order is array order", () => {
  const before = tweak(studio(), (draft) => {
    for (const id of ["s2", "s3"]) draft.scenes.push({ ...draft.scenes[0], id, name: id, isMain: false, kind: "compound", tracks: { overlay: [], main: { ...draft.scenes[0].tracks.main, id: `main-${id}` }, audio: [] } });
  });
  const commit = moveScene(before, context(), "s3", 0);
  assert.deepEqual(commit.document.scenes.map((scene) => scene.id), ["s3", "s1", "s2"]);
  const reorder = commit.patch.filter((entry) => entry.path === "/scenes/@s3");
  assert.deepEqual(reorder.map((entry) => [entry.op, entry.before]), [["remove", undefined], ["add", "@s1"]]);
  assert.ok(commit.document.scenes.every((scene) => !("order" in scene)));
  assertFails(tweak(before, (draft) => { draft.scenes[1].order = 2; }), "document/field-not-allowed", "/order");
});
