import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { creditsText, leaveTemplateMode, licenceCheck, splitElement, TEXT_TEMPLATES, transitionDefinition, validateProjectDocument } from "../src/index.ts";
import {
  adjustTemplateSlot, applyBrandKit, AudioRefused, replaceTemplateAudio, brandItemCount, buildPack, buildTemplate, bundledTemplateDemo, bundledTemplateLooks, bundledTemplates, placeStarterMusic, starterMusic, STARTER_MUSIC_ELEMENT, STARTER_MUSIC_TRACK, changeBrandKit, clearTemplateSlot, defaultMaxLength, embeddedAssets, EMPTY_BRAND_KIT, fillSlot, shorterThanSlot, slotCrop, SlotRefused,
  fillPlan, filterTemplates, isBundledTemplate, isEmptyBrandKit, mergePackPresets, missingRequired, NO_TEMPLATE_FILTER, PackInvalid, projectFromTemplate, proposeTemplate, ratioLabel, readBrandKit,
  readPackItems, readPackManifest, readTemplateManifest, setTemplateText, fillTemplateVariables, TEMPLATE_CATEGORIES, TEMPLATE_LIMITS, TemplateInvalid, templateProblems, TemplateRefused, withoutPack, type BrandKit,
} from "../src/template/index.ts";
import { asset, assertValid, audio, context, element, image, NOW, put, REGISTRIES, rejected, SECOND, shape, studio, text, tweak, video } from "./support/fixtures.ts";
import { templateDraft } from "./support/template.ts";

// The folder of this file, from its URL: the same when the suite is run as a bundle elsewhere (render's boundary test).
const HERE = dirname(fileURLToPath(import.meta.url));

/** A project with 4 main-track clips, an overlay image, 2 texts, a rectangle and music. */
function source() {
  let doc = put(studio(), "main", video("c1", 0, 2), video("c2", 2, 2), image("c3", 4, 2), video("c4", 6, 2));
  doc = put(doc, "t-video", image("logo", 0, 8));
  doc = put(doc, "t-text", text("title", 0, 2, { content: "Hello", color: "#ff0000", fontSize: 12 }), text("sub", 2, 2, { content: "A longer line of text", color: "#ff0000", fontSize: 6 }));
  doc = put(doc, "t-graphic", shape("bar", "rectangle", 0, 2, { params: { fill: "#00ff00" } }));
  doc = put(doc, "t-audio", audio("music", 0, 8));
  return tweak(doc, (draft) => { draft.metadata.duration = 8 * SECOND; draft.metadata.name = "Trip"; });
}
const env = (id = "tpl-a") => ({ id, now_ms: NOW });
const saved = (change: (draft: ReturnType<typeof proposeTemplate>) => void = () => undefined) => { const doc = source(), draft = proposeTemplate(doc, "s1"); change(draft); return { doc, ...buildTemplate(doc, "s1", draft, env()) }; };

// Requirement: Create a template from a project
test("Create a template from a project — Scenario: Save a template", () => {
  const before = JSON.stringify(source());
  const { doc, manifest, snapshot } = saved();
  assert.equal(manifest.slots.length, 4);
  assert.ok(manifest.slots.every((slot) => slot.required));
  assert.equal(manifest.editableTexts.length, 2);
  assert.equal(JSON.stringify(doc), before, "the project is unchanged");
  assertValid(snapshot);
  assert.equal(snapshot.template!.locked, true);
  assert.deepEqual(snapshot.template!.variables.filter((entry) => entry.type === "text").map((entry) => entry.bindings.length), [1, 1]);
  assert.ok(snapshot.template!.variables.some((entry) => entry.type === "color" && entry.bindings.length === 2));
});
test("Typed template variables — text and shared colour bindings change together in one commit", () => {
  const { snapshot } = saved();
  const result = fillTemplateVariables(snapshot, context(), { "text-title": "Summer trip", "color-1": "#123456" });
  assert.equal(result.commandType, "template.variables.fill");
  assert.equal(result.document.template!.variables.find((entry) => entry.id === "text-title")!.value, "Summer trip");
  assert.equal((element(result.document, "title") as any).content, "Summer trip");
  assert.equal((element(result.document, "title") as any).color, "#123456");
  assert.equal((element(result.document, "sub") as any).color, "#123456");
  assert.equal(result.patch.filter((entry) => entry.path.includes("/elements/")).length, 3);
});
test("Typed template variables — number and image values update their bound element properties", () => {
  const imageTarget = image("variable-image", 0, 2);
  let doc = put(templateDraft(), "t-video", imageTarget);
  doc = tweak(doc, (draft) => {
    draft.media.assets.push(asset("a9", "image"));
    draft.template.variables = [
      { id: "font-size", label: "Font size", type: "number", defaultValue: 12, value: 12, bindings: [{ elementId: "title", field: "fontSize" }] },
      { id: "logo-image", label: "Logo", type: "image", defaultValue: "a2", value: "a2", bindings: [{ elementId: "variable-image", field: "mediaId" }] },
    ];
  });
  const changed = fillTemplateVariables(doc, context(), { "font-size": 42, "logo-image": "a9" }).document;
  assert.deepEqual([(element(changed, "title") as any).fontSize, (element(changed, "variable-image") as any).mediaId], [42, "a9"]);
});
test("Create a template from a project — dialog defaults: main clips are slots, overlay clips are not, audio is not replaceable, text limit", () => {
  const draft = proposeTemplate(source(), "s1");
  assert.deepEqual(draft.media.map((row) => [row.elementId, row.slot]), [["c1", true], ["c2", true], ["c3", true], ["c4", true], ["logo", false]]);
  assert.deepEqual(draft.audio.map((row) => row.replaceable), [false]);
  assert.equal(draft.texts.find((row) => row.elementId === "title")!.maxLength, 20);
  assert.equal(draft.texts.find((row) => row.elementId === "sub")!.maxLength, 42);
  assert.equal(defaultMaxLength("x".repeat(400)), 500);
  assert.deepEqual(draft.themeColors, ["#ff0000", "#00ff00"]);
  assert.equal(draft.thumbnailTime, SECOND);
  assert.equal(draft.showMedia, true);
});
test("Create a template from a project — Scenario: Too large", () => {
  const doc = tweak(source(), (draft) => { draft.media.assets.find((entry: { id: string }) => entry.id === "a2").size = 3 * 1024 ** 3; });
  assert.throws(() => buildTemplate(doc, "s1", proposeTemplate(doc, "s1"), env()), (error: unknown) => error instanceof TemplateRefused && error.code === "too-large" && error.details.bytes > 2 * 1024 ** 3);
});
test("Create a template from a project — Scenario: Slot media is not embedded", () => {
  const { doc, snapshot, embeddedAssetIds } = saved();
  // a1 is only used by slot clips; a2 by the overlay logo (and by slot c3), a3 by the music.
  assert.deepEqual(embeddedAssetIds.sort(), ["a2", "a3"]);
  assert.deepEqual(snapshot.media.assets.map((entry) => entry.id).sort(), ["a2", "a3"]);
  for (const id of ["c1", "c2", "c3", "c4"]) assert.equal("mediaId" in element(snapshot, id), false);
  assert.deepEqual(embeddedAssets(doc, "s1", proposeTemplate(doc, "s1")).ids.sort(), ["a2", "a3"]);
});
test("Create a template from a project — a scene with no clip saves with zero slots; a template draft is refused", () => {
  const doc = put(studio(), "t-text", text("only", 0, 2, { content: "Hi" }));
  const built = buildTemplate(doc, "s1", proposeTemplate(doc, "s1"), env());
  assert.equal(built.manifest.slots.length, 0);
  assertValid(built.snapshot);
  assert.throws(() => buildTemplate(templateDraft(), "s1", proposeTemplate(templateDraft(), "s1"), env()), (error: unknown) => error instanceof TemplateRefused && error.code === "template-mode");
});

// Requirement: Template data model
test("Template data model — Scenario: Manifest validity", () => {
  const doc = put(source(), "main", video("c5", 8, 2));
  const { manifest, snapshot } = buildTemplate(doc, "s1", proposeTemplate(doc, "s1"), env());
  assert.equal(manifest.slots.length, 5);
  assert.equal(new Set(manifest.slots.map((slot) => slot.slotId)).size, 5);
  assert.deepEqual(manifest.slots.map((slot) => slot.index), [1, 2, 3, 4, 5]);
  assert.deepEqual(templateProblems(manifest, snapshot), []);
});
test("Template data model — Scenario: Schema validation", () => {
  const { manifest } = saved();
  const { canvas: _canvas, ...rest } = manifest;
  assert.throws(() => readTemplateManifest(rest), (error: unknown) => error instanceof TemplateInvalid && error.reason.includes("canvas"));
});
test("Template data model — Scenario: Provenance is cleared", () => {
  const doc = tweak(source(), (draft) => {
    draft.workflowLink = { runId: "r1" };
    draft.scenes[0].tracks.main.elements[0].workflowLink = { runId: "r1", stepId: "st1", artifactVersionId: "art1" };
  });
  const { snapshot } = buildTemplate(doc, "s1", proposeTemplate(doc, "s1"), env());
  assert.equal(snapshot.workflowLink, undefined);
  assert.equal(JSON.stringify(snapshot).includes("workflowLink"), false);
});
test("Template data model — Scenario: Older manifest key", () => {
  const { manifest, snapshot } = saved();
  const old = { ...manifest, slots: manifest.slots.map(({ elementId, ...slot }) => ({ ...slot, elementRef: elementId })), editableTexts: manifest.editableTexts.map(({ elementId, ...entry }) => ({ ...entry, elementRef: elementId })) };
  const read = readTemplateManifest(old);
  assert.deepEqual(read, manifest);
  assert.equal(JSON.stringify(read).includes("elementRef"), false);
  const project = projectFromTemplate(read, snapshot, { id: "p9", now_ms: NOW });
  assert.deepEqual(project.template!.slots.map((slot) => slot.elementId), manifest.slots.map((slot) => slot.elementId));
});

// Requirement: Use a template
const draftOf = () => { const { manifest, snapshot } = saved(); return { manifest, project: projectFromTemplate(manifest, snapshot, { id: "p2", now_ms: NOW + 5, name: "My trip" }) }; };
const withAssets = (doc: ReturnType<typeof source>, ...assets: ReturnType<typeof asset>[]) => tweak(doc, (draft) => { draft.media.assets.push(...assets); draft.media.assets.sort((a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : 1)); });
test("Use a template — Scenario: Draft is stored locked", () => {
  const { project, manifest } = draftOf();
  assertValid(project);
  assert.equal(project.metadata.id, "p2");
  assert.equal(project.metadata.name, "My trip");
  assert.equal(project.template!.locked, true);
  assert.equal(project.template!.templateId, manifest.id);
  assert.ok(project.template!.slots.every((slot) => !slot.filled));
});
test("Use a template — Scenario: Fill in order", () => {
  const { project } = draftOf();
  const slots = project.template!.slots.slice(0, 3);
  const plan = fillPlan(slots, [{ id: "A", type: "video" }, { id: "B", type: "image" }, { id: "C", type: "video" }]);
  assert.deepEqual(plan.fills, [{ slotId: "slot-1", assetId: "A" }, { slotId: "slot-2", assetId: "B" }, { slotId: "slot-3", assetId: "C" }]);
  let doc = withAssets(project, asset("A", "video"), asset("B", "image"), asset("C", "video"), asset("D", "video"));
  for (const fill of [...plan.fills, { slotId: "slot-4", assetId: "D" }]) doc = fillSlot(doc, context(), fill.slotId, fill.assetId).document;
  assert.deepEqual(["c1", "c2", "c3"].map((id) => element(doc, id).mediaId), ["A", "B", "C"]);
  assert.deepEqual(["c1", "c2", "c3"].map((id) => element(doc, id).type), ["video", "image", "video"], "a slot that accepts any media becomes what it holds");
  assert.equal(element(doc, "c2").duration, 2 * SECOND, "an image fills the whole slot");
  assertValid(doc);
  assert.deepEqual(missingRequired(doc), [], "Export is enabled");
});
test("Use a template — Scenario: Missing required slot", () => {
  const { project } = draftOf();
  let doc = withAssets(project, asset("A", "video"));
  for (const slotId of ["slot-1", "slot-2", "slot-3"]) doc = fillSlot(doc, context(), slotId, "A").document;
  assert.deepEqual(missingRequired(doc), ["slot-4"]);
});
test("Slot semantics and locked structure — Scenario: Wrong type", () => {
  const plan = fillPlan([{ slotId: "s", index: 1, accepts: "video" }], [{ id: "pic", type: "image" }]);
  assert.deepEqual(plan.fills, []);
  assert.deepEqual(plan.refused, [{ slotId: "s", assetId: "pic", needs: "video" }]);
});
test("Slot semantics and locked structure — Scenario: Cover fit", () => {
  // A 16:9 video in a 9:16 canvas: the sides are cropped equally and the height is shown whole.
  const { project } = draftOf();
  let doc = tweak(withAssets(project, asset("A", "video")), (draft) => { draft.settings.canvasSize = { width: 1080, height: 1920 }; });
  assert.equal(slotCrop(doc, "c1", { width: 1920, height: 1080 }), null, "an empty slot shows nothing");
  doc = fillSlot(doc, context(), "slot-1", "A").document;
  const crop = slotCrop(doc, "c1", { width: 1920, height: 1080 })!;
  assert.equal(crop.top, 0);
  assert.equal(crop.bottom, 0);
  assert.equal(crop.left, crop.right);
  assert.ok(Math.abs((1920 * (1 - crop.left - crop.right)) / 1080 - 1080 / 1920) < 1e-9, "what is shown has the canvas ratio");
  // Zoom 2× panned fully left: the left edge of the source is at the left edge of the frame, and the frame stays covered.
  doc = adjustTemplateSlot(doc, context(), "slot-1", { zoom: 2, panX: -1 }).document;
  const framed = slotCrop(doc, "c1", { width: 1920, height: 1080 })!;
  assert.equal(framed.left, 0);
  assert.ok(Math.abs((1 - framed.top - framed.bottom) - 0.5) < 1e-9);
  assert.ok(framed.left >= 0 && framed.right >= 0 && framed.top >= 0 && framed.bottom >= 0);
  assert.equal(slotCrop(doc, "c1", { width: 1920, height: 1080 }, { left: 0.1, top: 0, right: 0, bottom: 0 }), null, "a crop of its own wins");
  assert.equal(slotCrop(doc, "title", { width: 10, height: 10 }), null);
});
test("Slot semantics and locked structure — Scenario: Short clip", () => {
  const { project } = draftOf();
  let doc = withAssets(project, asset("A", "video", { duration: SECOND }), asset("pic", "image"));
  doc = fillSlot(doc, context(), "slot-1", "A").document;
  assert.equal(element(doc, "c1").duration, 2 * SECOND, "the slot keeps its duration");
  assert.equal(shorterThanSlot(doc, "slot-1"), true);
  assertValid(doc);
  const strict = tweak(doc, (draft) => { draft.template.slots[1].accepts = "video"; });
  assert.throws(() => fillSlot(strict, context(), "slot-2", "pic"), (error: unknown) => error instanceof SlotRefused && error.needs === "video" && error.message === "This slot needs a video");
});
test("Slot semantics and locked structure — a locked draft refuses a structural edit and takes slot edits", () => {
  const { project } = draftOf();
  const errors = rejected(() => splitElement(project, context(), "title", SECOND));
  assert.ok(errors.some((error) => error.code === "document/template-locked"));
  let doc = withAssets(project, asset("A", "video"));
  doc = fillSlot(doc, context(), "slot-1", "A").document;
  doc = clearTemplateSlot(doc, context(), "slot-1").document;
  assert.equal(doc.template!.slots[0].filled, false);
  assert.equal("mediaId" in element(doc, "c1"), false);
  assertValid(doc);
});

// Requirement: Replace and adjust slot media
test("Replace and adjust slot media — Scenario: Choose the start offset", () => {
  const { project } = draftOf();
  let doc = withAssets(project, asset("A", "video", { duration: 10 * SECOND }));
  doc = fillSlot(doc, context(), "slot-1", "A").document;
  doc = adjustTemplateSlot(doc, context(), "slot-1", { sourceOffset: 4 * SECOND }).document;
  // A 2 s slot of a 10 s source from 4 s: 4 s are trimmed before and 4 s after.
  assert.equal(element(doc, "c1").trimStart, 4 * SECOND);
  assert.equal(element(doc, "c1").trimEnd, 4 * SECOND);
  assert.equal(doc.template!.slots[0].sourceOffset, 4 * SECOND);
});
test("Replace and adjust slot media — Scenario: Offset limit", () => {
  const { project } = draftOf();
  let doc = withAssets(project, asset("A", "video", { duration: 10 * SECOND }));
  doc = fillSlot(doc, context(), "slot-1", "A").document;
  doc = adjustTemplateSlot(doc, context(), "slot-1", { sourceOffset: 60 * SECOND }).document;
  assert.equal(doc.template!.slots[0].sourceOffset, 8 * SECOND, "sourceDuration − slotDuration");
});
test("Replace and adjust slot media — Scenario: Adjust framing", () => {
  const { project } = draftOf();
  let doc = withAssets(project, asset("A", "video"));
  doc = fillSlot(doc, context(), "slot-1", "A").document;
  doc = adjustTemplateSlot(doc, context(), "slot-1", { zoom: 9, panX: -3 }).document;
  assert.deepEqual(doc.template!.slots[0].framing, { zoom: 5, panX: -1, panY: 0 });
});

// Requirement: Edit template text and audio
test("Edit template text and audio — Scenario: Edit a title", () => {
  const { project } = draftOf();
  const doc = setTemplateText(project, context(), "title", "Summer 2026").document;
  assert.equal(element(doc, "title").content, "Summer 2026");
  assert.equal(element(doc, "title").fontSize, 12, "the template's font is kept");
});
test("Edit template text and audio — Scenario: Length limit", () => {
  const { project } = draftOf();
  const limit = project.template!.editableTexts.find((entry) => entry.elementId === "title")!.maxLength;
  const doc = setTemplateText(project, context(), "title", "x".repeat(60)).document;
  assert.equal(element(doc, "title").content.length, limit);
});

test("Edit template text and audio — Scenario: Replace music", () => {
  const doc = source(), draft = proposeTemplate(doc, "s1");
  draft.audio[0].replaceable = true;
  const { manifest, snapshot } = buildTemplate(doc, "s1", draft, env());
  const project = withAssets(projectFromTemplate(manifest, snapshot, { id: "p4", now_ms: NOW }), asset("long", "audio", { duration: 60 * SECOND }), asset("short", "audio", { duration: 6 * SECOND }));
  // The 8 s music slot plays the first 8 s of the 60 s track.
  const replaced = replaceTemplateAudio(project, context(), "music", "long").document;
  assert.equal(element(replaced, "music").mediaId, "long");
  assert.equal(element(replaced, "music").duration, 8 * SECOND);
  assert.equal(element(replaced, "music").trimStart, 0);
  assert.equal(element(replaced, "music").trimEnd, 52 * SECOND);
  assertValid(replaced);
  // Scenario "Short replacement loops" is not built: a shorter sound is refused instead of being looped.
  assert.throws(() => replaceTemplateAudio(project, context(), "music", "short"), AudioRefused);
  const fixed = projectFromTemplate(saved().manifest, saved().snapshot, { id: "p5", now_ms: NOW });
  assert.throws(() => replaceTemplateAudio(fixed, context(), "music", "a3"), AudioRefused, "a slot that is not replaceable keeps its audio");
});

// Requirement: Open a template project in the full editor
test("Open a template project in the full editor — Scenario: Structural edit after unlocking", () => {
  const { project } = draftOf();
  const ctx = context();
  const unlocked = leaveTemplateMode(project, ctx).document;
  assert.equal(unlocked.template!.locked, false);
  assert.equal(unlocked.media.assets.filter((entry) => entry.kind === "slate").length, 4);
  const split = splitElement(unlocked, ctx, "title", SECOND);
  assert.ok(validateProjectDocument(split.document, { registries: REGISTRIES }).errors.length === 0);
});

// Requirement: Template gallery
const cards = () => bundledTemplates().map((entry) => entry.manifest);
test("Template gallery — Scenario: Filter and search", () => {
  assert.deepEqual(filterTemplates(cards(), { category: null, ratio: "16:9", query: "TRAVEL" }).map((card) => card.id), ["vlog-travel"]);
  assert.deepEqual(filterTemplates(cards(), { category: null, ratio: "9:16", query: "travel" }), []);
  assert.deepEqual(filterTemplates(cards(), { category: "Vlog", ratio: null, query: "" }).map((card) => card.id), ["vlog-day", "vlog-travel"]);
});
test("Template gallery — Scenario: No results", () => {
  assert.deepEqual(filterTemplates(cards(), { ...NO_TEMPLATE_FILTER, query: "no such template" }), []);
  assert.equal(filterTemplates(cards(), NO_TEMPLATE_FILTER).length, cards().length);
});
test("Template gallery — Scenario: Ratio filter on the bundled set", () => {
  assert.deepEqual(filterTemplates(cards(), { ...NO_TEMPLATE_FILTER, ratio: "1:1" }).map((card) => card.id), ["promo-product", "quote-card"]);
  assert.equal(ratioLabel({ width: 1080, height: 1350 }), "4:5");
});

// Requirement: Bundled templates are original content
test("Bundled templates are original content — every starter is a valid locked draft made of texts, shapes, empty slots and NO file (W7: its music is a named track of the remote catalogue, not a bundled file)", () => {
  for (const { manifest, snapshot } of bundledTemplates()) {
    // The stand-in registries of the tests know three text animations; the starters use the product's own.
    assert.deepEqual(validateProjectDocument(snapshot).errors, [], manifest.id);
    assert.deepEqual(templateProblems(manifest, snapshot), [], manifest.id);
    // W7: a starter holds no file at all — no picture, no video, and no music (that is fetched from the remote catalogue).
    assert.deepEqual(snapshot.media.assets, [], "a starter embeds no media");
    assert.equal(manifest.license, "CC0-1.0");
    assert.ok(isBundledTemplate(manifest.id));
  }
});
test("Bundled templates are original content — Scenario: Exactly 12 offline", () => {
  // id, canvas, seconds and number of slots of every row of `templates/catalog.md` section 2, in its order.
  const rows = [
    ["vlog-day", "9:16", 15, 6], ["vlog-travel", "16:9", 20, 7], ["promo-product", "1:1", 12, 4], ["promo-sale", "9:16", 10, 3], ["slideshow-memories", "16:9", 24, 8], ["slideshow-story", "4:5", 15, 5],
    ["intro-channel", "16:9", 6, 1], ["outro-end-screen", "16:9", 8, 2], ["short-hook", "9:16", 9, 3], ["short-top-three", "9:16", 12, 3], ["quote-card", "1:1", 8, 1], ["event-countdown", "16:9", 10, 2],
  ];
  assert.deepEqual(cards().map((card) => [card.id, ratioLabel(card.canvas), card.duration / SECOND, card.slots.length]), rows);
  assert.deepEqual([...new Set(cards().map((card) => card.category))].sort(), [...TEMPLATE_CATEGORIES].sort(), "all seven categories");
  for (const card of cards()) {
    assert.ok(card.thumbnail && card.preview, `${card.id} names its rendered cover and preview`);
    const demo = bundledTemplateDemo(card.id)!;
    assert.equal(demo.media.length, card.slots.length, `${card.id}: one demo item per slot`);
    assert.ok(demo.coverAt * SECOND < card.duration);
  }
});
// The catalogue is read from the spec itself: the table of section 2 and the structure line of each template.
const CATALOGUE = readFileSync(join(HERE, "../../../openspec/changes/build-jagentchill/specs/templates/catalog.md"), "utf8");
test("Bundled templates are original content — every starter equals its catalogue row: name, category, canvas, duration, slots, theme colours, tags, texts", () => {
  const rows = [...CATALOGUE.matchAll(/^\| \d+ \| `([a-z-]+)` \| ([^|]+) \| ([^|]+) \| (\d+)×(\d+) [^|]*\| (\d+) s \| (\d+) \| [^|]*\| ([^|]+) \|$/gm)];
  assert.equal(rows.length, 12);
  for (const [, id, name, category, width, height, seconds, slots, colours] of rows) {
    const { manifest, snapshot } = bundledTemplates().find((entry) => entry.manifest.id === id)!;
    assert.deepEqual([manifest.name, manifest.category, manifest.canvas.width, manifest.canvas.height, manifest.duration / SECOND, manifest.slots.length], [name.trim(), category.trim(), Number(width), Number(height), Number(seconds), Number(slots)], id);
    assert.deepEqual(manifest.themeColors, [...colours.matchAll(/#[0-9a-f]{6}/g)].map((match) => match[0]), `${id}: theme colours`);
    assert.deepEqual(manifest.frameRate, { numerator: 30, denominator: 1 });
    const line = CATALOGUE.split("\n").find((entry) => entry.includes(`**\`${id}\`**`))!;
    assert.deepEqual(manifest.tags, /Tags: ([^.]+)\./.exec(line)![1].split(",").map((tag) => tag.trim()), `${id}: tags`);
    // Each editable text: label «sample» → `text template` … , from–to s, maximum length.
    const texts = [...line.slice(line.indexOf("Texts:"), line.indexOf("Tags:")).matchAll(/([A-Z][A-Za-z0-9 ]*) «([^»]+)» → `([a-z-]+)`[^«]*?, (\d+)–(\d+) s, (\d+)(?=;|\.)/g)].map((match) => ({ label: match[1], content: match[2], look: match[3], from: Number(match[4]), to: Number(match[5]), maxLength: Number(match[6]) }));
    const byId = new Map(snapshot.scenes[0].tracks.overlay.flatMap((track) => track.elements).map((item) => [item.id, item as unknown as Record<string, any>]));
    const looks = new Map(bundledTemplateLooks(id).map((entry) => [entry.elementId, entry]));
    // The times are those of the text template's use; a text the template itself brings in later (the subtitle of
    // `title-stack`, 0.3 s after its title) starts that much after the catalogue's start.
    const ownDelay = (elementId: string): number => { const { look, part } = looks.get(elementId)!; return (TEXT_TEMPLATES.find((entry) => entry.id === look)!.members.filter((entry) => entry.kind === "text")[part] as { from?: number }).from ?? 0; };
    assert.deepEqual(manifest.editableTexts.map((entry) => { const item = byId.get(entry.elementId)!; return { label: entry.label, content: item.content, look: looks.get(entry.elementId)!.look, from: Math.round((item.startTime / SECOND - ownDelay(entry.elementId)) * 1000) / 1000, to: (item.startTime + item.duration) / SECOND, maxLength: entry.maxLength }; }), texts, `${id}: editable texts, their text templates and their times`);
    // The text template a text names is the one it was built from: its font, weight, case and animations are that member's.
    for (const [elementId, { look, part }] of looks) {
      const member = TEXT_TEMPLATES.find((entry) => entry.id === look)!.members.filter((entry) => entry.kind === "text")[part] as Extract<(typeof TEXT_TEMPLATES)[number]["members"][number], { kind: "text" }>;
      const item = byId.get(elementId)!;
      assert.deepEqual([item.fontFamily, item.fontWeight, item.textCase, item.textAnimation?.in?.id, item.textAnimation?.out?.id, item.textAnimation?.loop?.id], [member.fontFamily, member.fontWeight, member.textCase ?? "none", member.in?.[0], member.out?.[0], member.loop?.[0]], `${id}/${elementId}: the look of ${look}`);
    }
    // A design glyph the line gives a time to: "`social-countdown` from 7 s to 10 s" is three digits, one second each.
    const glyphTimes = /`([a-z-]+)` from (\d+) s to (\d+) s/.exec(line);
    if (glyphTimes) assert.deepEqual([...looks.values()].filter((entry) => entry.look === glyphTimes[1]).map((entry) => { const item = byId.get(entry.elementId)!; return [item.content, item.startTime / SECOND, (item.startTime + item.duration) / SECOND]; }), [["3", 7, 8], ["2", 8, 9], ["1", 9, 10]].filter((row) => (row[1] as number) >= Number(glyphTimes[2]) && (row[2] as number) <= Number(glyphTimes[3])), `${id}: ${glyphTimes[1]}`);
    // Every slot: type, seconds and required as the structure line gives them, whether one by one or as a range.
    const expected: { accepts: string; seconds: number; required: boolean }[] = [];
    const slotText = /Slots: (.*?)(?:\. (?:Transitions|Every|Texts)|\(background)/.exec(line)![1];
    const range = /^(\d+)–(\d+) (video|image|any) (\d+) s each; (\d+)–(\d+) R, /.exec(slotText);
    if (range) for (let index = 1; index <= Number(range[2]); index++) expected.push({ accepts: range[3], seconds: Number(range[4]), required: index <= Number(range[6]) });
    else for (const match of slotText.matchAll(/\d+ (video|image|any) (\d+) s (R|O)/g)) expected.push({ accepts: match[1], seconds: Number(match[2]), required: match[3] === "R" });
    assert.deepEqual(manifest.slots.map((slot) => ({ accepts: slot.accepts, seconds: slot.duration / SECOND, required: slot.required })), expected, `${id}: slots`);
    // The transitions: each one the line names, with its duration and direction, at exactly the cuts it names
    // ("cut 1–2" is the cut between slots 1 and 2; "every cut" is every cut of the main track).
    const main = snapshot.scenes[0].tracks.main, order = main.elements.map((item) => item.id);
    const wanted: { cut: number; type: string; seconds: number; direction: string | null }[] = [];
    for (const part of (/Transitions: ([^.]*(?:\.\d[^.]*)*)\./.exec(line)?.[1] ?? "").split(";").filter((entry) => entry.trim() !== "")) {
      const named = /`([a-z-]+)` ([\d.]+) s(?: \(direction (\w+)\))? at (every cut|cuts? .+)$/.exec(part.trim());
      assert.ok(named, `${id}: transition "${part.trim()}" is read`);
      const cuts = named[4] === "every cut" ? order.slice(1).map((_, index) => index + 1) : [...named[4].matchAll(/(\d+)–\d+/g)].map((match) => Number(match[1]));
      for (const cut of cuts) wanted.push({ cut, type: named[1], seconds: Number(named[2]), direction: named[3] ?? null });
    }
    const placed = main.transitions.map((record) => { const entry = record as unknown as { fromElementId: string; toElementId: string; type: string; duration: number; params: { direction?: string } }; assert.equal(order.indexOf(entry.toElementId), order.indexOf(entry.fromElementId) + 1, `${id}: a transition joins two slots in a row`); return { cut: order.indexOf(entry.fromElementId) + 1, type: entry.type, seconds: entry.duration / SECOND, direction: entry.params.direction ?? null }; });
    const byCut = (a: { cut: number }, b: { cut: number }) => a.cut - b.cut;
    assert.deepEqual(placed.sort(byCut), wanted.sort(byCut), `${id}: transitions — type, seconds, direction and cut`);
    for (const { type } of placed) assert.ok(transitionDefinition(type), `${id}: transition ${type} is in the library`);
    // "Every slot has scale keyframes 1.00 → 1.06 over its duration (linear)".
    const grow = /scale keyframes 1\.00 → ([\d.]+) over its duration \(linear\)/.exec(line);
    for (const item of main.elements as unknown as Record<string, any>[]) {
      const keys = ["transform.scale.x", "transform.scale.y"].map((path) => (item.animations?.[path]?.keys ?? []).map((key: Record<string, unknown>) => [key.time, key.value, key.segmentToNext]));
      assert.deepEqual(keys, grow ? [[[0, 1, "linear"], [item.duration, Number(grow[1]), "linear"]], [[0, 1, "linear"], [item.duration, Number(grow[1]), "linear"]]] : [[], []], `${id}/${item.id}: scale keyframes`);
    }
    assert.equal(manifest.license, "CC0-1.0");
    // W7: nothing is embedded, so there is no source row.
    assert.deepEqual(manifest.sources, [], `${id}: no embedded file`);
  }
});
test("W7 remote music — every starter NAMES its track (provider id + fallback search) and ships an empty Music track until the connected host fetches that track", () => {
  // The product's own registries are not the stand-ins of these tests (the starters use the product's text animations).
  const used = new Set<string>(), real = context({ registries: undefined });
  for (const { manifest, snapshot } of bundledTemplates()) {
    const id = manifest.id, tune = starterMusic(id);
    assert.ok(tune, `${id}: a track is named`);
    assert.deepEqual([tune.provider, /^[0-9a-f-]{36}$/.test(tune.id), tune.query.length > 0, tune.title.length > 0, tune.author.length > 0], ["openverse", true, true, true, true], id);
    used.add(tune.id);
    // What ships: an empty "Music" audio track, no audio slot, no media.
    const tracks = snapshot.scenes[0].tracks.audio as unknown as { id: string; name: string; elements: Record<string, any>[] }[];
    assert.deepEqual([tracks.map((track) => [track.id, track.name, track.elements.length]), manifest.audioSlots, snapshot.media.assets.length], [[[STARTER_MUSIC_TRACK, "Music", 0]], [], 0], id);
    // WITHOUT a connection: the project is the starter as it is — an empty Music track, nothing that points at a missing file.
    const bare = projectFromTemplate(manifest, snapshot, { id: "p-bare", now_ms: NOW });
    assert.deepEqual([validateProjectDocument(bare).errors, (bare.scenes[0].tracks.audio as unknown as { elements: unknown[] }[]).map((track) => track.elements.length), licenceCheck(bare, bare.scenes[0].id)], [[], [0], []], id);
  }
  assert.equal(used.size, 12, "twelve starters, each with a track of its own");
});
test("W7 more music — a person's own file whose record holds a credit line (an NCS release) is listed with \"Attribution required\" and its credit is what \"Copy credits\" gives, as it was written; a file without one is not in the credits", () => {
  const { manifest, snapshot } = bundledTemplates().find((entry) => entry.manifest.id === "vlog-day")!, bare = projectFromTemplate(manifest, snapshot, { id: "p-ncs", now_ms: NOW });
  const credit = "Song: Tone - Test [NCS Release]\nMusic provided by NoCopyrightSounds\nFree Download/Stream: http://ncs.io/test";
  const sound = (id: string, provenance: Record<string, unknown>) => ({ id, name: `${id}.mp3`, type: "audio", size: 10, contentHash: (id === "a-ncs" ? "a" : "b").repeat(64), duration: 60 * SECOND, hasAudio: true, created_ms: NOW, provenance });
  const held = { ...bare, media: { ...bare.media, assets: [sound("a-ncs", { source: "imported", credit, attributionRequired: true }), sound("b-own", { source: "imported" })] } } as unknown as typeof bare;
  const placed = placeStarterMusic(held, context({ registries: undefined }), { sceneId: held.scenes[0].id, assetId: "a-ncs", title: "Tone", trackId: STARTER_MUSIC_TRACK, elementId: STARTER_MUSIC_ELEMENT })!.document;
  // As a person's own file is placed: "upload"; and a second own file beside it.
  const own = { ...placed, scenes: placed.scenes.map((scene) => ({ ...scene, tracks: { ...scene.tracks, audio: scene.tracks.audio.map((track) => ({ ...track, elements: [{ ...track.elements[0], sourceType: "upload" }, { ...track.elements[0], id: "music-2", mediaId: "b-own", sourceType: "upload", startTime: 0 }] })) } })) } as unknown as typeof placed;
  const rows = licenceCheck(own, own.scenes[0].id);
  assert.deepEqual(rows.map((row) => [row.assetId, row.origin, row.licence, row.flag, row.credit]), [["a-ncs", "own", "Your file — credit required by its source", "Attribution required", credit], ["b-own", "own", "Your file — licence not known to JAgentChill", undefined, undefined]]);
  assert.equal(creditsText(rows), credit);
});
/** Width and height of a JPEG (its start-of-frame segment) and of an MP4 (its first track header). */
function jpegSize(bytes: Uint8Array): [number, number] {
  for (let at = 2; at < bytes.length - 9;) {
    const marker = bytes[at + 1], length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (bytes[at] !== 0xff) break;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return [(bytes[at + 7] << 8) | bytes[at + 8], (bytes[at + 5] << 8) | bytes[at + 6]];
    at += 2 + length;
  }
  return [0, 0];
}
function mp4Size(bytes: Buffer): [number, number] {
  const at = bytes.indexOf("tkhd");
  if (at < 4) return [0, 0];
  const end = at - 4 + bytes.readUInt32BE(at - 4);
  return [bytes.readUInt32BE(end - 8) >>> 16, bytes.readUInt32BE(end - 4) >>> 16];
}
test("Bundled templates are original content — build check: every starter ships its rendered cover and preview, in the template's ratio, for the web, the desktop and the phone", () => {
  const root = join(HERE, "../../.."), native = readFileSync(join(root, "apps/app/src/templates/cover.native.tsx"), "utf8");
  for (const { manifest } of bundledTemplates()) {
    const id = manifest.id, ratio = manifest.canvas.width / manifest.canvas.height;
    assert.equal(manifest.thumbnail, "cover.jpg");
    assert.equal(manifest.preview, "preview.mp4");
    for (const name of ["cover.jpg", "preview.mp4"]) {
      const made = join(root, "packages/content/templates", id, name), shipped = join(root, "apps/app/public/templates", id, name);
      assert.ok(existsSync(made), `${id}/${name} is rendered (packages/content/scripts/render-template-covers.mjs)`);
      assert.ok(existsSync(shipped) && readFileSync(shipped).equals(readFileSync(made)), `${id}/${name} is shipped as rendered`);
    }
    const cover = readFileSync(join(root, "apps/app/public/templates", id, "cover.jpg")), preview = readFileSync(join(root, "apps/app/public/templates", id, "preview.mp4"));
    const [width, height] = jpegSize(cover), [filmWidth, filmHeight] = mp4Size(preview);
    assert.ok(Math.max(width, height) === 720 && Math.abs(width / height - ratio) < 0.01, `${id}: cover ${width}×${height}`);
    assert.ok(Math.max(filmWidth, filmHeight) === 720 && Math.abs(filmWidth / filmHeight - ratio) < 0.01, `${id}: preview ${filmWidth}×${filmHeight}`);
    assert.ok(preview.length <= TEMPLATE_LIMITS.previewBytes, `${id}: preview of ${preview.length} bytes`);
    assert.ok(native.includes(`"${id}": require("../../public/templates/${id}/cover.jpg")`), `${id}: the cover is an asset of the phone app`);
    const demo = bundledTemplateDemo(id)!, listed = JSON.parse(readFileSync(join(root, "packages/content/templates/demo/demo.json"), "utf8")) as { license: string; items: { id: string; seconds?: number }[] };
    assert.equal(listed.license, "CC0-1.0");
    for (const name of demo.media) assert.ok(listed.items.some((item) => item.id === name.replace(/\.jpg$/, "")), `${id}: demo item ${name} exists`);
    assert.ok(listed.items.every((item) => (item.seconds ?? 0) <= 6), "a demo clip lasts at most 6 s");
  }
  assert.ok(readFileSync(join(root, "docs/product/ASSET-PROVENANCE.md"), "utf8").includes("packages/content/templates/demo/"), "the demo media has its provenance row");
  // The version the app keys its kept copies of these files by is the hash of the files that are shipped.
  const hash = createHash("sha256");
  for (const { manifest } of bundledTemplates()) for (const name of ["cover.jpg", "preview.mp4"]) { hash.update(`${manifest.id}/${name}\n`); hash.update(readFileSync(join(root, "apps/app/public/templates", manifest.id, name))); }
  assert.ok(readFileSync(join(root, "apps/app/src/templates/covers.gen.ts"), "utf8").includes(`"${hash.digest("hex").slice(0, 16)}"`), "covers.gen.ts names the shipped files (render-template-covers.mjs writes it)");
});
const FFPROBE = spawnSync("ffprobe", ["-version"]).status === 0 && spawnSync("ffmpeg", ["-version"]).status === 0;
test("Bundled templates are original content — build check: every shipped preview lasts as long as its starter (± one frame) and every frame of it decodes", { skip: FFPROBE ? false : "ffprobe and ffmpeg are not installed on this machine: the previews cannot be decoded here" }, () => {
  const root = join(HERE, "../../..");
  for (const { manifest } of bundledTemplates()) {
    const file = join(root, "apps/app/public/templates", manifest.id, "preview.mp4"), seconds = manifest.duration / SECOND, frame = manifest.frameRate.denominator / manifest.frameRate.numerator;
    const probe = spawnSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "format=duration:stream=codec_name,nb_read_frames,avg_frame_rate", "-of", "json", file], { encoding: "utf8" });
    assert.equal(probe.status, 0, `${manifest.id}: ffprobe reads the preview: ${probe.stderr}`);
    const info = JSON.parse(probe.stdout) as { format: { duration: string }; streams: { codec_name: string; nb_read_frames: string; avg_frame_rate: string }[] };
    assert.ok(Math.abs(Number(info.format.duration) - seconds) <= frame + 1e-6, `${manifest.id}: the preview lasts ${info.format.duration} s, the starter ${seconds} s`);
    assert.equal(info.streams[0].codec_name, "h264", manifest.id);
    assert.ok(Math.abs(Number(info.streams[0].nb_read_frames) - seconds / frame) <= 1, `${manifest.id}: ${info.streams[0].nb_read_frames} frames read, ${seconds / frame} expected`);
    // Decoded from the first frame to the last with errors made fatal: a damaged file fails here.
    const decode = spawnSync("ffmpeg", ["-v", "error", "-xerror", "-i", file, "-f", "null", "-"], { encoding: "utf8" });
    assert.ok(decode.status === 0 && decode.stderr.trim() === "", `${manifest.id}: the preview decodes: ${decode.stderr.slice(0, 200)}`);
    assert.equal(spawnSync("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", file], { encoding: "utf8" }).stdout.trim(), "", `${manifest.id}: the preview has no sound`);
  }
});
test("Bundled templates are original content — Scenario: No uneditable sample text", () => {
  const samples = new Set(TEXT_TEMPLATES.flatMap((entry) => entry.members.flatMap((member) => (member.kind === "text" ? [member.content] : []))));
  // The design glyphs the catalogue names: the countdown and step digits and the opening quotation mark.
  const glyphs = new Set(["1", "2", "3", "“"]);
  for (const { manifest, snapshot } of bundledTemplates()) {
    const editable = new Set(manifest.editableTexts.map((entry) => entry.elementId));
    for (const track of snapshot.scenes[0].tracks.overlay) for (const item of track.elements) {
      if (item.type !== "text" || editable.has(item.id)) continue;
      const content = String((item as { content?: unknown }).content);
      assert.ok(glyphs.has(content), `${manifest.id}/${item.id} is a design glyph`);
      assert.ok(!samples.has(content) || glyphs.has(content), `${manifest.id}/${item.id}`);
    }
  }
  const all = bundledTemplates().flatMap(({ snapshot }) => snapshot.scenes[0].tracks.overlay.flatMap((track) => track.elements.map((item) => String((item as { content?: unknown }).content ?? ""))));
  for (const sample of ["Subtitle goes here", "Full Name", "Location · Date"]) assert.ok(!all.includes(sample), sample);
});
test("Bundled templates are original content — every slot of every starter takes media while the draft stays locked", () => {
  for (const { manifest, snapshot } of bundledTemplates()) {
    let doc = projectFromTemplate(manifest, snapshot, { id: "p4", now_ms: NOW });
    doc = { ...doc, media: { ...doc.media, assets: [...doc.media.assets, asset("clip", "video", { duration: 8 * SECOND }), asset("still", "image")].sort((a, b) => (a.id < b.id ? -1 : 1)) } } as typeof doc;
    // The product's own registries are not the stand-ins of these tests: the lock is what is checked here.
    for (const slot of manifest.slots) doc = fillSlot(doc, context({ registries: undefined }), slot.slotId, slot.accepts === "image" ? "still" : "clip").document;
    for (const slot of manifest.slots.filter((entry) => entry.accepts === "any")) doc = fillSlot(doc, context({ registries: undefined }), slot.slotId, "still").document;
    assert.ok(doc.template!.locked && doc.template!.slots.every((slot) => slot.filled), manifest.id);
    assert.deepEqual(missingRequired(doc), [], manifest.id);
  }
});
test("Bundled templates are original content — transitions join adjacent slots and every theme colour binding names a field with that colour", () => {
  for (const { manifest, snapshot } of bundledTemplates()) {
    const main = snapshot.scenes[0].tracks.main;
    for (const record of main.transitions) {
      const from = main.elements.find((item) => item.id === record.fromElementId)!, to = main.elements.find((item) => item.id === record.toElementId)!;
      assert.equal(from.startTime + from.duration, to.startTime, `${manifest.id}/${record.id}`);
    }
    const byId = new Map(snapshot.scenes[0].tracks.overlay.flatMap((track) => track.elements).map((item) => [item.id, item as unknown as Record<string, any>]));
    for (const binding of manifest.colorBindings) {
      const value = binding.field.split(".").reduce((at: any, key) => at?.[key], byId.get(binding.elementId));
      assert.equal(String(value).toLowerCase(), manifest.themeColors[binding.colorIndex].toLowerCase(), `${manifest.id}/${binding.elementId}/${binding.field}`);
    }
  }
});
test("Bundled templates are original content — Scenario: Demo media stays out of projects", () => {
  const { manifest, snapshot } = bundledTemplates().find((entry) => entry.manifest.id === "vlog-day")!;
  const project = projectFromTemplate(manifest, snapshot, { id: "p3", now_ms: NOW });
  assert.equal(project.template!.slots.length, 6);
  assert.ok(project.template!.slots.every((slot) => !slot.filled));
  // (W7: a new project holds no media at all — its music is fetched from the remote catalogue afterwards.)
  assert.deepEqual(project.media.assets, []);
  assert.deepEqual(missingRequired(project), ["slot-1", "slot-2", "slot-3", "slot-5"]);
});

// Requirement: Brand kit
const kit = (colors: string[], heading?: string, body?: string): BrandKit => ({
  ...EMPTY_BRAND_KIT, colors: colors.map((value, index) => ({ id: `c${index}`, name: "", value })),
  fonts: [...(heading ? [{ family: heading, roles: ["heading" as const] }] : []), ...(body ? [{ family: body, roles: ["body" as const] }] : [])],
});
test("Brand kit — Scenario: Apply brand to a template", () => {
  const { project } = draftOf();
  const doc = tweak(project, (draft) => { draft.scenes[0].tracks.overlay.find((track: { id: string }) => track.id === "t-text").elements.push(text("small", 4, 2, { content: "x", fontSize: 5 })); draft.template.editableTexts.push({ elementId: "small", label: "Small", maxLength: 20 }); });
  const commit = applyBrandKit(doc, context(), kit(["#0055ff", "#111111"], "Gelasio", "Noto Sans"));
  assert.equal(element(commit.document, "title").fontFamily, "Gelasio");
  assert.equal(element(commit.document, "sub").fontFamily, "Noto Sans");
  assert.equal(element(commit.document, "small").fontFamily, "Noto Sans");
  assert.deepEqual(commit.document.template!.themeColors, ["#0055ff", "#111111"]);
});
test("Brand kit — Scenario: Bound fields follow the theme colour", () => {
  const { project } = draftOf();
  const doc = applyBrandKit(project, context(), kit(["#0055ff"])).document;
  assert.equal(element(doc, "title").color, "#0055ff");
  assert.equal(element(doc, "bar").params.fill, "#00ff00", "theme colour 1 has no brand colour");
  assert.equal(element(doc, "title").fontFamily, element(project, "title").fontFamily, "a role with no font changes nothing");
});
test("Brand kit — Scenario: Fewer brand colours than theme colours", () => {
  const { project } = draftOf();
  const doc = applyBrandKit(project, context(), kit(["#123456"])).document;
  assert.deepEqual(doc.template!.themeColors, ["#123456", "#00ff00"]);
});
test("Brand kit — Scenario: Empty kit", () => {
  assert.equal(isEmptyBrandKit(EMPTY_BRAND_KIT), true);
  assert.equal(isEmptyBrandKit(readBrandKit(undefined)), true);
  let next = changeBrandKit(EMPTY_BRAND_KIT, { kind: "add-color", id: "c1", name: "Blue", value: "1E6BFF" }, NOW);
  next = changeBrandKit(next, { kind: "add-font", family: "Gelasio" }, NOW);
  next = changeBrandKit(next, { kind: "add-font", family: "Noto Sans" }, NOW);
  next = changeBrandKit(next, { kind: "set-role", family: "Gelasio", role: "heading", on: true }, NOW);
  next = changeBrandKit(next, { kind: "set-role", family: "Noto Sans", role: "heading", on: true }, NOW);
  assert.deepEqual(next.colors, [{ id: "c1", name: "Blue", value: "#1e6bff" }]);
  assert.deepEqual(next.fonts, [{ family: "Gelasio", roles: [] }, { family: "Noto Sans", roles: ["heading"] }], "a role belongs to one font");
  assert.equal(brandItemCount(next), 3);
  assert.deepEqual(readBrandKit(JSON.parse(JSON.stringify(next))), next);
  assert.throws(() => changeBrandKit(next, { kind: "add-color", id: "c2", name: "", value: "blue" }, NOW));
});

// Requirement: Preset packs
const PRESETS = { "text-preset": [{ id: "t1", name: "Bold", style: { color: "#ff0000" } }, { id: "t2", name: "Soft", style: {} }], "effect-preset": [{ name: "Glow", type: "blur", kind: "effect", params: { strength: 4 } }] };
const reader = (files: { path: string; text: string }[]) => async (file: string) => files.find((entry) => entry.path === file)?.text;
test("Preset packs — Scenario: Import a mixed pack", async () => {
  const { manifest, files } = buildPack(PRESETS, { id: "pack1", name: "  Launch   kit " });
  assert.equal(manifest.name, "Launch kit");
  assert.equal(manifest.items.length, 3);
  const read = await readPackItems(readPackManifest(JSON.parse(JSON.stringify(manifest))), files.map((entry) => entry.path), reader(files));
  assert.deepEqual(read.refused, []);
  assert.deepEqual(read.presets["text-preset"].map((preset) => preset.name), ["Bold", "Soft"]);
  const mine = [{ id: "t1", name: "Mine", style: {} }];
  const merged = mergePackPresets(mine, read.presets["text-preset"], manifest, () => "fresh");
  assert.deepEqual(merged.map((preset) => [preset.id, preset.name, preset.pack ?? null]), [["t1", "Mine", null], ["fresh", "Bold", "pack1"], ["t2", "Soft", "pack1"]]);
  assert.equal(mergePackPresets(merged, read.presets["text-preset"], manifest, () => "fresh2").length, 3, "importing again replaces the pack's presets");
  assert.deepEqual(withoutPack(merged, "pack1"), mine);
  // A library that knows its presets by name: a name that is taken is named after the pack too.
  const byName = mergePackPresets([{ name: "Glow", params: {} }], read.presets["effect-preset"], manifest, () => "x");
  assert.deepEqual(byName.map((preset) => preset.name), ["Glow", "Glow (Launch kit)"]);
  assert.throws(() => buildPack({}, { id: "p", name: "Empty" }), PackInvalid);
});
test("Preset packs — Scenario: Code is refused", async () => {
  const { manifest, files } = buildPack(PRESETS, { id: "pack1", name: "Kit" });
  const hostile = { ...manifest, items: [...manifest.items, { kind: "effect-preset", id: "x", name: "Shader", file: "items/effect-preset/glow.frag" }] };
  const read = await readPackItems(hostile, [...files.map((entry) => entry.path), "items/effect-preset/glow.frag", "run.js"], reader([...files, { path: "items/effect-preset/glow.frag", text: "{}" }]));
  assert.deepEqual(read.refused, [{ name: "Shader", reason: "code" }, { name: "run.js", reason: "code" }]);
  assert.equal(read.presets["effect-preset"].length, 1);
});
test("Preset packs — Scenario: Unknown kind", async () => {
  const { manifest, files } = buildPack(PRESETS, { id: "pack1", name: "Kit" });
  const read = await readPackItems({ items: [{ kind: "hologram", id: "h", name: "Holo", file: "items/h.json" }, ...manifest.items] }, files.map((entry) => entry.path), reader(files));
  assert.deepEqual(read.refused, [{ name: "Holo", reason: "unknown-kind" }]);
  assert.equal(read.presets["text-preset"].length + read.presets["effect-preset"].length, 3);
});
