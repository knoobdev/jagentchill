import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createTrack } from "@jagentchill/protocol";
import {
  acceptPatch, addAsset, applyPatch, canonicalize, commitChange, createFolder, deleteFolder, diffDocuments, DOCUMENT_ERROR_CODES, documentError, insertElement, moveElement,
  moveTrack, setElementFields, setElementValue, setLocal, toBoundaryError, toggleSolo, upsertKeyframe, validateDocumentChange, validateProjectDocument, withoutLocal,
} from "../src/index.ts";
import { asset, assertFails, assertValid, audio, codes, context, element, HASH, ids, put, rejected, SECOND, studio, tweak, validate, video } from "./support/fixtures.ts";
import { templateDraft } from "./support/template.ts";

// Requirement: Asset provenance
const generated = { source: "ai", provider: "imagen", model: "imagen-4", role: "image", prompt: "a red kite over dunes", referenceAssetIds: [], jobId: "job-77", created_ms: 1_800_000_000_500 };
const stock = { source: "stock", provider: "pexels", itemId: "9", author: "Ana", licence: "Pexels", licenceUrl: "https://pexels.com/license", sourceUrl: "https://pexels.com/9", attributionRequired: true };

test("Asset provenance — Scenario: Generated image", () => {
  const after = addAsset(studio(), context(), { id: "gen1", name: "kite.png", type: "image", size: 400_000, width: 1024, height: 1024, provenance: generated }).document;
  const record = after.media.assets.find((entry) => entry.id === "gen1")!;
  assert.deepEqual(record.provenance, { ...generated, attributionRequired: false });
  assertValid(after);
  for (const missing of ["provider", "model", "role", "jobId"]) {
    const { [missing]: _removed, ...partial } = generated as Record<string, unknown>;
    assertFails(tweak(after, (draft) => { draft.media.assets.find((entry: any) => entry.id === "gen1").provenance = partial; }), "document/missing-field", `/provenance/${missing}`);
  }
});

test("Asset provenance — Scenario: Provenance survives a package round trip", () => {
  const ctx = context();
  const doc = addAsset(addAsset(studio(), ctx, { id: "gen1", name: "kite.png", type: "image", size: 1, provenance: generated }).document, ctx, { id: "st1", name: "city.mp4", type: "video", size: 1, provenance: stock }).document;
  // What a package carries is the canonical form; reading it back gives the same provenance values byte for byte.
  const imported = JSON.parse(canonicalize(doc));
  for (const id of ["gen1", "st1"]) {
    const before = doc.media.assets.find((entry) => entry.id === id)!.provenance, after = imported.media.assets.find((entry: any) => entry.id === id).provenance;
    assert.equal(canonicalize({ provenance: after }), canonicalize({ provenance: before }));
  }
  assertValid(imported);
});

test("Asset provenance — Scenario: Secret in provenance", () => {
  for (const secret of ["apiKey", "token", "authorization", "signature"]) {
    const error = assertFails(tweak(studio(), (draft) => { draft.media.assets[0].provenance = { source: "imported", [secret]: "sk-123" }; }), "document/field-not-allowed");
    assert.equal(error.path, `/media/assets/@a1/provenance/${secret}`);
  }
  assertFails(tweak(studio(), (draft) => { draft.media.assets[0].provenance = { source: "url" }; }), "document/missing-field", "/provenance/url");
  assertFails(tweak(studio(), (draft) => { draft.media.assets[0].provenance = { source: "telepathy" }; }), "document/wrong-type");
});

// Requirement: Library folders and LUT records
test("Library folders and LUT records — Scenario: Automatic folder", () => {
  const ctx = context({ newId: ids("f") });
  const first = addAsset(studio(), ctx, { id: "gen1", name: "kite.png", type: "image", size: 1, provenance: generated }).document;
  assert.deepEqual(first.media.folders, [{ id: "f1", name: "AI generated", parentId: null, kind: "ai-generated" }]);
  assert.equal(first.media.assets.find((entry) => entry.id === "gen1")!.folderId, "f1");
  const second = addAsset(first, ctx, { id: "gen2", name: "kite2.png", type: "image", size: 1, provenance: generated }).document;
  assert.equal(second.media.folders.length, 1, "at most one folder of each automatic kind");
  assertFails(tweak(second, (draft) => { draft.media.folders.push({ id: "f9", name: "More AI", parentId: null, kind: "ai-generated" }); }), "document/limit-exceeded");
  assertFails(tweak(second, (draft) => { draft.media.assets[0].folderId = "nowhere"; }), "document/unknown-reference", "/folderId");
});

test("Library folders and LUT records — Scenario: Fifth level", () => {
  const ctx = context();
  let doc = studio(), parent: string | null = null;
  for (let level = 1; level <= 4; level++) { const made = createFolder(doc, ctx, `Level ${level}`, parent); doc = made.document; parent = made.folderId; }
  assert.equal(doc.media.folders.length, 4);
  const errors = rejected(() => createFolder(doc, ctx, "Level 5", parent), "document/limit-exceeded");
  assert.equal(errors[0].details!.limit, "folderDepth");
  assertFails(tweak(doc, (draft) => { draft.media.folders.push({ id: "deep", name: "Level 5", parentId: parent, kind: "user" }); }), "document/limit-exceeded");
  assertFails(tweak(doc, (draft) => { draft.media.folders.push({ id: "twin", name: "level 1", parentId: null, kind: "user" }); }), "document/out-of-range", "/name");
});

test("Library folders and LUT records — Scenario: Folder deleted", () => {
  const ctx = context();
  const outer = createFolder(studio(), ctx, "Shoot");
  const inner = createFolder(outer.document, ctx, "Day 1", outer.folderId);
  const filed = tweak(inner.document, (draft) => { for (const entry of draft.media.assets) entry.folderId = inner.folderId; });
  const commit = deleteFolder(filed, ctx, inner.folderId);
  assert.deepEqual(commit.document.media.assets.map((entry) => entry.folderId), [outer.folderId, outer.folderId, outer.folderId]);
  assert.equal(commit.history, true);
  assert.equal(commit.patch.filter((entry) => entry.path.endsWith("/folderId")).length, 3, "in the same patch, so the same undo step");
  const lut = { id: `user:${HASH("1")}`, name: "Teal", format: "cube", size: 2048, sha256: HASH("1") };
  assertValid(tweak(studio(), (draft) => { draft.media.luts = [lut]; }));
  assertFails(tweak(studio(), (draft) => { draft.media.luts = [{ ...lut, id: "bundled:teal" }]; }), "document/wrong-type");
});

// Requirement: Document validator
test("Document validator — Scenario: Same answer for every writer", () => {
  const before = put(studio(), "main", video("v", 0, 2));
  const attempts = [
    () => setElementFields(before, context({ writer: { id: "ui:inspector" } }), "v", { duration: 0 }),
    () => commitChange(before, context({ writer: { id: "ui:shortcut" } }), { commandType: "element.trim", label: "Trim" }, (draft) => { draft.scenes[0].tracks.main.elements[0].duration = 0; }),
    () => acceptPatch(before, [{ op: "replace", path: "/scenes/@s1/tracks/main/elements/@v/duration", value: 0 }], { writer: { id: "agent:session-1" } }),
  ];
  const answers = attempts.map((attempt) => rejected(attempt, "document/out-of-range").filter((error) => error.code === "document/out-of-range").map((error) => error.path));
  assert.deepEqual(answers, Array(3).fill(["/scenes/@s1/tracks/main/elements/@v/duration"]));
  assert.equal(element(before, "v").duration, 2 * SECOND, "the document is unchanged");
});

test("Document validator — Scenario: All errors returned", () => {
  const imported = put(studio(), "main", video("a", 0, 3), video("b", 2, 3, { mediaId: "missing" }));
  const result = validate(imported);
  assert.ok(codes(result).includes("document/elements-overlap") && codes(result).includes("document/unknown-asset"));
  // Never more than 100, each `{code, path, message, details?}`.
  const many = put(studio(), "main", ...Array.from({ length: 150 }, (_, index) => video(`v${index}`, index * 2, 2, { mediaId: `gone${index}` })));
  const capped = validate(many);
  assert.equal(capped.errors.length, 100);
  for (const error of capped.errors) assert.deepEqual(Object.keys(error).filter((key) => key !== "details"), ["code", "path", "message"]);
});

test("Document validator — Scenario: Remote patch is validated", () => {
  const before = put(studio(), "main", video("a", 0, 2), video("b", 2, 2));
  const patch = [{ op: "add" as const, path: "/scenes/@s1/tracks/overlay/@t-video/elements/@a", value: video("a", 0, 2) }];
  const errors = rejected(() => acceptPatch(before, patch), "document/duplicate-id");
  assert.equal(toBoundaryError(errors, "sync").code, "PATCH_INVALID");
  assert.equal(before.scenes[0].tracks.overlay[0].elements.length, 0, "the patch is not applied");
});

test("Document validator — Scenario: Incremental validation budget", () => {
  let doc = studio();
  for (let index = 0; index < 4; index++) {
    doc.scenes[0].tracks.overlay.push(createTrack("video", { id: `bulk${index}`, name: "Video" }) as never);
    doc = put(doc, `bulk${index}`, ...Array.from({ length: 2500 }, (_, at) => video(`e${index}_${at}`, at * 2, 2)));
  }
  const edited = tweak(doc, (draft) => { draft.scenes[0].tracks.overlay.at(-2).elements[1200].opacity = 0.4; });
  const scope = { elementIds: ["e2_1200"] };
  for (let warm = 0; warm < 20; warm++) validateDocumentChange(doc, edited, { scope });
  const samples = Array.from({ length: 21 }, () => { const start = performance.now(); const result = validateProjectDocument(edited, { scope }); assert.equal(result.ok, true); return performance.now() - start; }).sort((a, b) => a - b);
  assert.ok(samples[10] < 5, `incremental validation of one element in a 10 000-element project took ${samples[10].toFixed(2)} ms (budget 5 ms)`);
  // The incremental mode still sees what the edit could break: its own fields, its neighbours and its references.
  const broken = tweak(edited, (draft) => { const target = draft.scenes[0].tracks.overlay.at(-2).elements[1200]; target.opacity = 4; target.startTime += SECOND; target.mediaId = "gone"; });
  assert.deepEqual(codes(validateProjectDocument(broken, { scope })).sort(), ["document/elements-overlap", "document/out-of-range", "document/unknown-asset"]);
  // Full validation of the same document, for the record of the 150 ms / 600 ms budgets on the reference devices.
  const start = performance.now();
  assert.equal(validateProjectDocument(edited).ok, true);
  console.log(`full validation of 10 000 elements: ${(performance.now() - start).toFixed(0)} ms on this machine; incremental median ${samples[10].toFixed(2)} ms`);
});

// Requirement: Structural and reference invariants
test("Structural and reference invariants — Scenario: Missing main track", () => {
  assertFails(tweak(studio(), (draft) => { delete draft.scenes[0].tracks.main; }), "document/main-track-invalid", "/scenes/@s1/tracks/main");
});

test("Structural and reference invariants — Scenario: Warning does not block", () => {
  const doc = tweak(studio(), (draft) => { draft.cover = { source: "image", mediaId: "removed", crop: { x: 0.5, y: 0.5, zoom: 1 }, texts: [], image: { sha256: HASH("c"), mime: "image/png", width: 640, height: 360 } }; });
  const result = validate(doc);
  assert.equal(result.ok, true);
  assert.deepEqual(result.warnings.map((warning) => [warning.code, warning.path]), [["document/unknown-asset", "/cover/mediaId"]]);
  // A removed background asset is a warning too; a required media id is an error.
  assert.deepEqual(validate(tweak(studio(), (draft) => { draft.settings.background = { kind: "image", mediaId: "removed", fit: "cover" }; })).warnings.map((warning) => warning.code), ["document/unknown-asset"]);
});

test("Structural and reference invariants — Scenario: Group across scenes", () => {
  const doc = tweak(put(studio(), "main", video("a", 0, 2, { groupId: "g1" }), video("b", 2, 2, { groupId: "g1" })), (draft) => {
    const second = { ...draft.scenes[0], id: "s2", name: "Second", isMain: false, kind: "compound", tracks: { overlay: [], audio: [], main: { ...draft.scenes[0].tracks.main, id: "main2", elements: [] } } };
    second.tracks.main.elements = [{ ...video("c", 0, 2), groupId: "g1" }, { ...video("d", 2, 2), groupId: "g1" }];
    draft.scenes.push(second);
  });
  assertFails(doc, "document/group-invalid");
});

// Requirement: Load-time repair
test("Load-time repair — Scenario: Dangling link cleared", () => {
  const stored = put(studio(), "main", video("v", 0, 2, { linkId: "L1" }));
  const loaded = validateProjectDocument(stored, { mode: "load" });
  assert.equal(loaded.ok, true);
  assert.equal(element(loaded.document!, "v").linkId, null);
  assert.deepEqual(loaded.repairs!.map((repair) => [repair.kind, repair.path]), [["cleared-reference", "/scenes/@s1/tracks/main/elements/@v/linkId"]]);
  assert.equal(element(stored, "v").linkId, "L1", "the stored record is not modified by loading");
});

test("Load-time repair — Scenario: Overlap on load", () => {
  const loaded = validateProjectDocument(put(studio(), "main", video("first", 0, 3), video("second", 2, 3)), { mode: "load" });
  assert.equal(loaded.ok, true);
  assert.deepEqual(loaded.document!.scenes[0].tracks.main.elements.map((entry) => entry.id), ["first"]);
  assert.equal(loaded.repairs!.length, 1, "the notice reports one repaired or skipped item (the singular form of the locale)");
  assert.deepEqual([loaded.repairs![0].kind, loaded.repairs![0].code], ["removed-element", "document/elements-overlap"]);
});

test("Load-time repair: the fixed order — ticks, counts, order, references, animation paths, elements, main scene and track", () => {
  const stored = tweak(put(put(studio(), "main", video("late", 4, 2), video("early", 0, 2), video("lost", 8, 2), video("keyed", 6, 2)), "t-text", { id: "bad-type", type: "particle", name: "x", startTime: 0, duration: 4000 }), (draft) => {
    const [early, late, keyed, lost] = draft.scenes[0].tracks.main.elements;
    early.startTime = 0.4; early.duration = 239_999.6;
    late.transitionOut = "t-gone";
    lost.mediaId = "no-such-asset";
    keyed.animations = { "transform.rotate": { keys: [{ id: "k", time: 0, value: 1 }] }, opacity: { keys: [{ id: "k2", time: 120_000, value: 1 }, { id: "k1", time: 0, value: 0 }] } };
    keyed.opacity = 7;
    draft.scenes[0].tracks.main.elements = [late, early, lost, keyed];
    draft.scenes[0].tracks.main.transitions = [{ id: "orphan", kind: "transition", fromElementId: "early", toElementId: "nobody", type: "dissolve" }];
    draft.scenes[0].markers = [{ id: "m2", time: 240_000, color: 1 }, { id: "m1", time: 0, color: 1 }];
    draft.settings.fps = { numerator: 60000, denominator: 2000 };
    draft.media.assets[0].folderId = "no-folder";
    draft.futureBlock = { untouched: [3, 2, 1] };
    draft.schemaVersion = 34;
  });
  const loaded = validateProjectDocument(stored, { mode: "load" });
  assert.equal(loaded.ok, true, JSON.stringify(loaded.errors));
  const doc = loaded.document as any, main = doc.scenes[0].tracks.main;
  assert.deepEqual(main.elements.map((entry: any) => entry.id), ["early", "late", "keyed"], "sorted; the element with an unknown asset is removed");
  assert.deepEqual([main.elements[0].startTime, main.elements[0].duration], [0, 240_000], "ticks rounded half away from zero");
  assert.deepEqual(doc.settings.fps, { numerator: 30, denominator: 1 });
  assert.deepEqual([main.transitions, main.elements[1].transitionOut], [[], null]);
  assert.deepEqual(Object.keys(main.elements[2].animations), ["opacity"]);
  assert.deepEqual(main.elements[2].animations.opacity.keys.map((entry: any) => entry.id), ["k1", "k2"]);
  assert.equal(main.elements[2].opacity, 7, "a number outside its range is kept as stored");
  assert.deepEqual(doc.scenes[0].markers.map((marker: any) => marker.id), ["m1", "m2"]);
  assert.equal(doc.media.assets[0].folderId, null);
  assert.deepEqual(doc.futureBlock, { untouched: [3, 2, 1] }, "unknown fields are never touched");
  assert.deepEqual(doc.scenes[0].tracks.overlay[1].elements.length, 1, "an element of an unknown type is kept on a newer document");
  assert.deepEqual([...new Set(loaded.repairs!.map((repair) => repair.kind))].sort(), ["cleared-reference", "reduced-rational", "removed-animation-path", "removed-element", "removed-transition", "rounded-ticks", "sorted"]);
  // (g) a missing main scene and a missing main track are recreated empty.
  const headless = validateProjectDocument(tweak(studio(), (draft) => { draft.scenes[0].isMain = false; draft.scenes[0].kind = "compound"; }), { mode: "load" });
  assert.deepEqual([headless.ok, headless.document!.scenes[0].name, headless.document!.scenes[0].isMain, headless.document!.scenes[0].tracks.main.elements], [true, "Main scene", true, []]);
  const trackless = validateProjectDocument(tweak(studio(), (draft) => { delete draft.scenes[0].tracks.main; }), { mode: "load" });
  assert.deepEqual([trackless.ok, trackless.document!.scenes[0].tracks.main.name, trackless.document!.scenes[0].tracks.main.type], [true, "Main Track", "video"]);
  // At schema 32 an element of an unknown type is one bad element: skipped.
  const skipped = validateProjectDocument(put(studio(), "t-text", { id: "bad-type", type: "particle", name: "x", startTime: 0, duration: 4000 }), { mode: "load" });
  assert.deepEqual([skipped.ok, skipped.document!.scenes[0].tracks.overlay[1].elements.length, skipped.repairs!.length], [true, 0, 1]);
});

test("Load-time repair — Scenario: Repair is not saved until an edit", () => {
  const stored = put(studio(), "main", video("first", 0, 3), video("second", 2, 3));
  const bytes = JSON.stringify(stored);
  const loaded = validateProjectDocument(stored, { mode: "load" });
  assert.equal(loaded.repairs!.length, 1);
  assert.equal(JSON.stringify(stored), bytes, "opening and closing without an edit leaves the record byte-identical");
  // The repair becomes part of the first save that follows an edit.
  const saved = moveElement(loaded.document!, context(), "first", SECOND).document;
  assert.deepEqual(saved.scenes[0].tracks.main.elements.map((entry) => entry.id), ["first"]);
});

test("Load-time repair — Scenario: Unrepairable", () => {
  const record = { ...studio(), scenes: "all of them" };
  const bytes = JSON.stringify(record);
  const loaded = validateProjectDocument(record, { mode: "load" });
  assert.equal(loaded.ok, false, "the load fails with the load-error screen");
  assert.equal(loaded.document, undefined);
  assert.equal(JSON.stringify(record), bytes, "no record is modified");
  assert.equal(validateProjectDocument("not json", { mode: "load" }).errors[0].code, "document/not-an-object");
  const { schemaVersion: _version, ...unversioned } = studio();
  assert.equal(validateProjectDocument(unversioned, { mode: "load" }).ok, false);
});

// Requirement: Validation error codes
test("Validation error codes — Scenario: Tool boundary", () => {
  const before = put(studio(), "main", video("a", 0, 3));
  const errors = rejected(() => insertElement(before, context({ writer: { id: "agent:session-1" } }), "t-main", { type: "video", id: "b", name: "b", startTime: 2 * SECOND, duration: 3 * SECOND, mediaId: "a1" }));
  const result = { error: toBoundaryError(errors.filter((error) => error.code === "document/elements-overlap"), "tool") };
  assert.equal(result.error.code, "INVALID_PARAMS");
  assert.equal(result.error.details.documentErrors[0].code, "document/elements-overlap");
  assert.deepEqual(Object.keys(result.error.details.documentErrors[0]), ["code", "path", "message"]);
});

test("Validation error codes — Scenario: Unlisted code", () => {
  const catalogue = readFileSync(new URL("../../../openspec/changes/build-jagentchill/specs/project-document/catalog.md", import.meta.url), "utf8");
  const section = catalogue.slice(catalogue.indexOf("## 14."), catalogue.indexOf("## 15."));
  const listed = [...section.matchAll(/^\| `(document\/[a-z-]+)` \|/gm)].map((match) => match[1]);
  assert.deepEqual([...DOCUMENT_ERROR_CODES], listed, "the validator's code table equals catalog.md §14");
  assert.throws(() => documentError("document/made-up", "", "x"), /not a document error code/);
  // Every `document/…` literal in the sources is one of the listed codes.
  const sources = ["validate.ts", "repair.ts", "commit.ts", "patch.ts", "ops/shared.ts", "ops/elements.ts", "ops/effects.ts", "ops/structure.ts", "ops/project.ts", "ops/media.ts", "ops/animation.ts", "classic/v31-to-v32.ts"]
    .map((file) => readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8")).join("\n")
    + ["kit.ts", "values.ts", "animation.ts", "element-fields.ts", "elements.ts", "structure.ts"].map((file) => readFileSync(new URL(`../../protocol/src/project-document/${file}`, import.meta.url), "utf8")).join("\n");
  const used = new Set([...sources.matchAll(/"(?:code:)?(document\/[a-z-]+)"/g)].map((match) => match[1]));
  assert.deepEqual([...used].filter((code) => !listed.includes(code)), []);
});

test("Validation error codes — Scenario: Locked template over RPC", () => {
  const errors = rejected(() => moveElement(templateDraft(), context({ writer: { id: "run:workflow-9" } }), "free", 4 * SECOND));
  const rpc = toBoundaryError(errors, "rpc");
  assert.equal(rpc.code, "CONFLICT");
  assert.equal(rpc.details.documentErrors[0].code, "document/template-locked");
});

// Requirement: State patch format
const placed = () => tweak(put(put(studio(), "t-video", video("e9", 0, 2)), "main", video("first", 0, 2), video("last", 5, 2)), (draft) => { draft.metadata.duration = 7 * SECOND; });

test("State patch format — Scenario: Field edit", () => {
  const ctx = context();
  const commit = setElementValue(tweak(placed(), (draft) => { draft.scenes[0].tracks.overlay[0].id = "t3"; }), ctx, "e9", "transform.position.x", 120);
  assert.deepEqual(commit.patch, [
    { op: "replace", path: "/scenes/@s1/tracks/overlay/@t3/elements/@e9/transform/position/x", value: 120 },
    { op: "replace", path: "/metadata/updated_ms", value: ctx.now_ms },
  ]);
  assert.equal(canonicalize(applyPatch(tweak(placed(), (draft) => { draft.scenes[0].tracks.overlay[0].id = "t3"; }), commit.patch)), canonicalize(commit.document));
});

test("State patch format — Scenario: Insert into a sorted array", () => {
  const before = placed();
  const commit = insertElement(before, context(), "t-main", { type: "video", id: "e12", name: "e12", startTime: 2 * SECOND, duration: 2 * SECOND, mediaId: "a1", sourceDuration: 2 * SECOND });
  const entry = commit.patch.find((candidate) => candidate.path === "/scenes/@s1/tracks/main/elements/@e12")!;
  assert.equal(entry.op, "add");
  assert.equal((entry.value as any).id, "e12");
  assert.equal("before" in entry, false);
  // Every applier places it second: the generic applier needs no editor code.
  assert.deepEqual(applyPatch(before, commit.patch).scenes[0].tracks.main.elements.map((element) => element.id), ["first", "e12", "last"]);
});

test("State patch format — Scenario: Reorder a track", () => {
  const before = tweak(studio(), (draft) => { draft.scenes[0].tracks.overlay = [createTrack("video", { id: "t1", name: "A" }), createTrack("text", { id: "t2", name: "B" }), createTrack("video", { id: "t3", name: "C" })]; });
  const commit = moveTrack(before, context(), "t3", "t1");
  assert.deepEqual(commit.patch.filter((entry) => entry.path === "/scenes/@s1/tracks/overlay/@t3").map(({ op, before: anchor, value }) => [op, anchor, (value as any)?.id]), [["remove", undefined, undefined], ["add", "@t1", "t3"]]);
  assert.deepEqual(applyPatch(before, commit.patch).scenes[0].tracks.overlay.map((track) => track.id), ["t3", "t1", "t2"]);
});

test("State patch format — Scenario: Ambiguous id", () => {
  const twins = tweak(placed(), (draft) => { draft.scenes[0].tracks.overlay[0].elements.push({ ...draft.scenes[0].tracks.overlay[0].elements[0], startTime: 4 * SECOND }); });
  const base = "/scenes/@s1/tracks/overlay/@t-video/elements";
  rejected(() => applyPatch(twins, [{ op: "replace", path: `${base}/@e9/opacity`, value: 0.5 }]), "document/patch-invalid");
  const doc = placed();
  for (const patch of [
    [{ op: "replace", path: `${base}/@nope/opacity`, value: 0.5 }], [{ op: "add", path: `${base}/@e9`, value: video("e9") }], [{ op: "add", path: `${base}/@zz`, value: video("other") }],
    [{ op: "move", path: `${base}/@e9` }], [{ op: "replace", path: "scenes", value: [] }], [{ op: "replace", path: `${base}/@e9/nothing/here`, value: 1 }],
  ] as const) rejected(() => applyPatch(doc, patch as never), "document/patch-invalid");
  assert.equal(canonicalize(doc), canonicalize(placed()), "a rejected patch applies nothing");
});

test("State patch format — Scenario: Keyframe addressed by id", () => {
  const keyed = upsertKeyframe(placed(), context({ newId: () => "k4" }), "e9", "opacity", { time: 0, value: 1 }).document;
  const commit = upsertKeyframe(keyed, context(), "e9", "opacity", { time: 0, value: 0.25 });
  assert.ok(commit.patch.some((entry) => entry.op === "replace" && entry.path === "/scenes/@s1/tracks/overlay/@t-video/elements/@e9/animations/opacity/keys/@k4/value" && entry.value === 0.25));
  assert.equal(element(applyPatch(keyed, commit.patch), "e9").animations.opacity.keys[0].value, 0.25);
});

test("State patch format: applying the patch of any change to its base gives the committed document, byte for byte", () => {
  const ctx = context();
  let doc = placed();
  const steps = [
    (current: typeof doc) => moveElement(current, ctx, "last", 9 * SECOND),
    (current: typeof doc) => moveElement(current, ctx, "last", 2 * SECOND + 4000 * 30),
    (current: typeof doc) => setElementFields(current, ctx, "first", { beats: [1, 2, 3], masks: [] }),
    (current: typeof doc) => setElementFields(current, ctx, "first", { beats: [1, 2, 3, 4] }),
    (current: typeof doc) => setElementFields(current, ctx, "first", { beats: [9] }),
    (current: typeof doc) => upsertKeyframe(current, ctx, "first", "transform.position.x", { time: SECOND, value: 5 }),
    (current: typeof doc) => upsertKeyframe(current, ctx, "first", "transform.position.x", { time: 0, value: 1 }),
    (current: typeof doc) => addAsset(current, ctx, { id: "a0", name: "first.png", type: "image", size: 1 }),
  ];
  for (const step of steps) {
    const commit = step(doc);
    assert.equal(canonicalize(applyPatch(doc, commit.patch)), canonicalize(commit.document));
    assert.deepEqual(diffDocuments(applyPatch(doc, commit.patch), commit.document), []);
    doc = commit.document;
  }
  const appended = diffDocuments(setElementFields(placed(), ctx, "first", { beats: [1, 2, 3] }).document, setElementFields(placed(), ctx, "first", { beats: [1, 2, 3, 4] }).document);
  assert.ok(appended.some((entry) => entry.op === "add" && entry.path.endsWith("/beats/-") && entry.value === 4), "an index-addressed array appends with `-`");
});

// Requirement: Device-local data is never synced
test("Device-local data is never synced — Scenario: Patch touching local", () => {
  const errors = rejected(() => applyPatch(studio(), [{ op: "replace", path: "/local/timelineViewState/zoomLevel", value: 2 }]), "document/device-local-in-patch");
  assert.equal(errors[0].path, "/local/timelineViewState/zoomLevel");
  rejected(() => acceptPatch(studio(), [{ op: "add", path: "/local", value: {} }]), "document/device-local-in-patch");
});

test("Device-local data is never synced — Scenario: External path stays on the desktop", () => {
  const desktop = setLocal(tweak(studio(), (draft) => { draft.media.assets.push(asset("ext1", "video", { contentHash: HASH("e") })); }), (local) => {
    local.media = { ext1: { storage: "external", externalPath: "/Volumes/Shoot/take1.mov", externalGrantId: "grant-1", externalSize: 4096, externalMtime_ms: 1 } };
  });
  // What sync, snapshots and packages carry: the canonical form, and patches computed from it.
  const sent = canonicalize(desktop);
  assert.equal(sent.includes("/Volumes/Shoot"), false);
  assert.equal(JSON.stringify(diffDocuments(studio(), desktop)).includes("/Volumes/Shoot"), false);
  const phone = validateProjectDocument({ ...JSON.parse(sent), local: {} }, { mode: "load" });
  assert.equal(phone.document!.media.assets.some((entry) => entry.id === "ext1"), true, "the phone receives the asset record");
  assert.equal(((phone.document as any).local.media.ext1 ?? { storage: "managed" }).storage, "managed");
  assert.equal("local" in withoutLocal(desktop), false);
});

test("Device-local data is never synced — Scenario: Solo syncs", () => {
  const holder = studio(), viewer = studio();
  const commit = toggleSolo(holder, context(), "t-audio");
  const followed = acceptPatch(viewer, commit.patch);
  assert.equal(followed.scenes[0].tracks.audio[0].solo, true, "the viewer shows the track soloed after the next applied patch");
  assert.equal(canonicalize(followed), canonicalize(commit.document));
});
