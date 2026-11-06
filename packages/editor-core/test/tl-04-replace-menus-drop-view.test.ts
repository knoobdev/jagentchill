import assert from "node:assert/strict";
import { test } from "node:test";
import { projectDocumentSchema } from "@jagentchill/protocol";
import { timeline as tl, upsertKeyframe } from "../src/index.ts";
import { audio, context, HASH, put, sticker, text, tweak, video } from "./support/fixtures.ts";
import { audioTracks, el, main, OFF, ON, open, overlay, project, S, spans, trackIdOf, trackOf, withTracks } from "./support/timeline.ts";

const clip = (id: string, start: number, seconds: number, extra: Record<string, unknown> = {}) => video(id, start, seconds, { sourceDuration: 60 * S, trimEnd: (60 - seconds) * S, ...extra });
const mainOf = (...clips: [string, number, number][]) => clips.reduce((doc, [id, start, seconds]) => put(doc, "t-main", clip(id, start, seconds)), project());
const media = (assetId: string): tl.LibraryItem => ({ kind: "media", assetId });
const ids = (menu: tl.MenuItem[]) => menu.flatMap((item) => ("id" in item ? [item.id] : []));
const labels = (menu: tl.MenuItem[]) => menu.flatMap((item) => ("label" in item ? [item.label] : []));
const FILM = { filmId: "film1", episodeId: "ep1", panelId: "panel12", assetVersionId: "v1" };
const SCRIPT = { scriptId: "script1", sceneId: "sc1", shotId: "shot3", versionId: "v1", syncedHash: HASH("a") };
/** A project whose second video asset lasts `seconds`. */
const withAsset = (seconds: number, doc = project()) => tweak(doc, (draft) => { draft.media.assets[3].duration = seconds * S; });

// — Replace media —
test("Replace media: Replace keeps edits", () => {
  const effects = [{ id: "e1", type: "blur", kind: "effect", enabled: true, params: { intensity: 15 } }];
  const session = open(put(withAsset(20), "t-main", clip("c", 2, 5, { effects, flip: { horizontal: true, vertical: false } })));
  const result = session.execute(tl.replaceMedia({ elementId: "c", assetId: "a4" }), OFF);
  const after = el(session.document, "c");
  assert.deepEqual([result.ok && result.info?.trimAdjusted, after.mediaId, after.startTime, after.duration, after.trimStart, after.trimEnd, after.effects, after.flip.horizontal, session.historyLength], [false, "a4", 2 * S, 5 * S, 0, 15 * S, effects, true, 1]);
});
test("Replace media: Replace keeps the in-point", () => {
  const session = open(put(withAsset(20), "t-main", clip("c", 0, 5, { trimStart: 8 * S, trimEnd: 47 * S })));
  session.execute(tl.replaceMedia({ elementId: "c", assetId: "a4" }), OFF);
  assert.deepEqual([el(session.document, "c").duration, el(session.document, "c").trimStart, el(session.document, "c").trimEnd], [5 * S, 8 * S, 7 * S]);
});
test("Replace media: Shorter replacement", () => {
  const session = open(put(withAsset(3), "t-main", clip("c", 0, 5)));
  const result = session.execute(tl.replaceMedia({ elementId: "c", assetId: "a4" }), OFF);
  assert.deepEqual([el(session.document, "c").duration, result.ok && result.info?.trimAdjusted, session.isTrimAdjusted("c")], [3 * S, true, true]);
  assert.ok(tl.clipPresentation(session.document, el(session.document, "c"), 200, { trimAdjusted: session.isTrimAdjusted("c") }).badges.includes("trim-adjusted"));
  // The badge stays until the element is next edited.
  session.execute(tl.renameElement({ sceneId: "s1", elementId: "c", name: "Take 2" }), OFF);
  assert.equal(session.isTrimAdjusted("c"), false);
});
test("Replace media: Incompatible asset", () => {
  const doc = put(project(), "t-main", clip("c", 0, 5));
  assert.equal(tl.dropOnElementDecision(el(doc, "c"), { type: "audio" }, true), "insert");
  assert.equal(tl.dropOnElementDecision(el(doc, "c"), { type: "image" }, true), "replace");
  assert.equal(tl.dropOnElementDecision(el(doc, "c"), { type: "video" }, false), "insert");
  const session = open(doc);
  assert.equal(session.execute(tl.replaceMedia({ elementId: "c", assetId: "a3" }), OFF).ok, false);
  // Video ↔ image is allowed: the element changes type and loses its source span.
  session.execute(tl.replaceMedia({ elementId: "c", assetId: "a2" }), OFF);
  assert.deepEqual([el(session.document, "c").type, "retime" in el(session.document, "c"), "volume" in el(session.document, "c"), el(session.document, "c").duration], ["image", false, false, 5 * S]);
});

// — Transform entry points in the timeline —
test("Transform entry points in the timeline: Mirror several clips", () => {
  const session = open(put(withTracks(project(), ["t-v", "video"]), "t-v", clip("a", 0, 2), clip("b", 2, 2), clip("c", 4, 2, { flip: { horizontal: true, vertical: false } })));
  session.execute(tl.flipElements({ sceneId: "s1", elementIds: ["a", "b", "c"], axis: "horizontal" }), OFF);
  assert.deepEqual([["a", "b", "c"].map((id) => el(session.document, id).flip.horizontal), session.historyLength], [[true, true, false], 1]);
});
test("Transform entry points in the timeline: Disabled for an audio-only selection", () => {
  const doc = put(withTracks(project(), ["t-a", "audio"]), "t-a", audio("u", 0, 4));
  const states = tl.toolStates(doc, { selectedIds: ["u"], playhead: 2 * S });
  assert.deepEqual([states.crop.enabled, states["rotate-90"].enabled, states.mirror.enabled, states.freeze.enabled, states.reverse.enabled], [false, false, false, false, true]);
  assert.equal(open(doc).execute(tl.flipElements({ sceneId: "s1", elementIds: ["u"], axis: "horizontal" }), OFF).ok, false);
});

// — Element hide, mute and deactivate —
test("Element hide, mute and deactivate: Mixed selection hide", () => {
  const session = open(put(withTracks(project(), ["t-v", "video"]), "t-v", clip("a", 0, 2, { hidden: true }), clip("b", 2, 2)));
  session.execute(tl.toggleElementFlag({ sceneId: "s1", elementIds: ["a", "b"], flag: "hidden" }), OFF);
  assert.deepEqual([el(session.document, "a").hidden, el(session.document, "b").hidden], [true, true]);
  session.execute(tl.toggleElementFlag({ sceneId: "s1", elementIds: ["a", "b"], flag: "hidden" }), OFF);
  assert.deepEqual([el(session.document, "a").hidden, el(session.document, "b").hidden], [false, false]);
});
test("Element hide, mute and deactivate: Deactivate", () => {
  const session = open(put(project(), "t-main", clip("a", 0, 2)));
  session.execute(tl.toggleElementFlag({ sceneId: "s1", elementIds: ["a"], flag: "active" }), OFF);
  const shown = tl.clipPresentation(session.document, el(session.document, "a"), 200);
  assert.deepEqual([el(session.document, "a").hidden, el(session.document, "a").muted, shown.hidden, shown.badges.includes("muted"), session.historyLength], [true, true, true, true, 1]);
  session.execute(tl.toggleElementFlag({ sceneId: "s1", elementIds: ["a"], flag: "active" }), OFF);
  assert.deepEqual([el(session.document, "a").hidden, el(session.document, "a").muted], [false, false]);
});

// — Element provenance link —
const resolve = (kind: string, link: Record<string, unknown>) => (kind === "film" ? `Panel ${String(link.panelId).replace("panel", "")}` : kind === "script" ? "Shot 3" : "Step");
test("Element provenance link: Split keeps the link", () => {
  const session = open(put(project(), "t-main", clip("c", 0, 6, { filmLink: FILM })));
  session.execute(tl.split({ sceneId: "s1", time: 2 * S, elementIds: ["c"] }), OFF);
  const halves = main(session.document).elements;
  assert.deepEqual(halves.map((half: { filmLink: unknown }) => half.filmLink), [FILM, FILM]);
  assert.deepEqual(halves.map((half: Record<string, unknown>) => tl.provenanceChips(half, resolve)[0].text), ["From film · Panel 12", "From film · Panel 12"]);
  assert.deepEqual(tl.provenanceChips(halves[0], resolve, 50), [], "a clip narrower than 64 px shows no chip");
});
test("Element provenance link: Paste into another project", () => {
  const link = { runId: "r1", stepId: "st1", artifactVersionId: "v1" };
  const entry = tl.copyElements(put(project(), "t-main", clip("c", 0, 4, { workflowLink: link })), "s1", ["c"]);
  const session = open(tweak(project(), (draft) => { draft.metadata.id = "p2"; }));
  session.execute(tl.paste({ sceneId: "s1", entry, time: 0 }), OFF);
  assert.deepEqual(el(session.document, session.selection.selectedElements[0]).workflowLink, link);
});
test("Element provenance link: User replace clears film and workflow links", () => {
  const session = open(put(withAsset(20), "t-main", clip("c", 0, 4, { filmLink: FILM, scriptLink: SCRIPT })));
  session.execute(tl.replaceMedia({ elementId: "c", assetId: "a4" }), OFF);
  const after = el(session.document, "c");
  assert.deepEqual(["filmLink" in after, after.scriptLink, tl.provenanceChips(after, resolve).map((chip) => chip.text)], [false, SCRIPT, ["From script · Shot 3"]]);
  assert.deepEqual(session.document.scriptLinks, [{ scriptId: "script1" }]);
});
test("Element provenance link: Unlink", () => {
  const session = open(put(project(), "t-main", clip("c", 0, 4, { filmLink: FILM, scriptLink: SCRIPT })));
  const before = el(session.document, "c");
  session.execute(tl.unlinkSource({ sceneId: "s1", elementIds: ["c"] }), OFF);
  const after = el(session.document, "c");
  assert.deepEqual([tl.hasProvenance(after), after.startTime, after.duration, after.mediaId, session.historyLength], [false, before.startTime, before.duration, before.mediaId, 1]);
  session.undo();
  assert.deepEqual([el(session.document, "c").filmLink, el(session.document, "c").scriptLink], [FILM, SCRIPT]);
});
test("Element provenance link: Producer update shortens the clip", () => {
  const ctx = context();
  const keyed = upsertKeyframe(put(withAsset(3), "t-main", clip("c", 0, 5, { filmLink: FILM, effects: [{ id: "e1", type: "blur", kind: "effect", enabled: true, params: { intensity: 15 } }] })), ctx, "c", "opacity", { time: S, value: 0.5 }).document;
  const session = open(keyed);
  const result = session.execute(tl.replaceElementSource({ elementId: "c", mediaId: "a4", link: { filmLink: { ...FILM, assetVersionId: "v2" } }, producer: "Film studio" }), ON);
  const after = el(session.document, "c");
  assert.deepEqual([after.startTime, after.duration, after.effects.length, after.animations.opacity.keys.length, after.filmLink.assetVersionId, result.ok && result.info?.trimAdjusted, session.isTrimAdjusted("c"), session.undoLabel], [0, 3 * S, 1, 1, "v2", true, true, "Film studio"]);
  session.undo();
  assert.deepEqual([el(session.document, "c").mediaId, el(session.document, "c").duration], ["a1", 5 * S]);
});
test("Element provenance link: Regenerating a split panel keeps both in-points", () => {
  const session = open(put(withAsset(6), "t-main", video("c", 0, 6, { sourceDuration: 6 * S, filmLink: FILM })));
  session.execute(tl.split({ sceneId: "s1", time: 2 * S, elementIds: ["c"] }), OFF);
  const [first, second] = main(session.document).elements.map((element: { id: string }) => element.id);
  for (const id of [first, second]) session.execute(tl.replaceElementSource({ elementId: id, mediaId: "a4", producer: "Film studio" }), OFF);
  const halves = main(session.document).elements;
  assert.deepEqual(halves.map((half: any) => [half.trimStart / S, (half.trimStart + half.duration) / S]), [[0, 2], [2, 6]]);
  assert.deepEqual([session.isTrimAdjusted(first), session.isTrimAdjusted(second)], [false, false]);
});
test("Element provenance link: In-point beyond the new source", () => {
  const session = open(put(withAsset(5), "t-main", clip("c", 0, 2, { trimStart: 4 * S, trimEnd: 54 * S })));
  const result = session.execute(tl.replaceElementSource({ elementId: "c", mediaId: "a4", producer: "Workflow" }), OFF);
  assert.deepEqual([el(session.document, "c").trimStart, el(session.document, "c").duration, result.ok && result.info?.trimAdjusted], [3 * S, 2 * S, true]);
});
test("Element provenance link: Target deleted", () => {
  const element = clip("c", 0, 4, { filmLink: FILM });
  assert.deepEqual(tl.provenanceChips(element, () => undefined), [{ kind: "film", text: "Source no longer available", available: false }]);
});

// — Element parameter registry —
const registry = () => tl.createParamRegistry({
  visual: [...tl.CORE_VISUAL_PARAMS, { key: "transform.rotation", type: "number", default: 0, min: -180, max: 180, step: 1 }],
  text: [{ key: "fontSize", type: "number", default: 15, min: 0, max: 100, step: 5 }, { key: "fontFamily", type: "font", default: "Arial" }, { key: "color", type: "color", default: "#ffffff" }],
});
test("Element parameter registry: Step then clamp", () => {
  assert.equal(tl.coerceParam({ key: "p", type: "number", default: 0, min: 0, max: 100, step: 5 }, 103.7), 100);
  assert.equal(tl.coerceParam({ key: "p", type: "number", default: 0, min: 0, max: 100, step: 5 }, 42.4), 40);
  const session = open(put(withTracks(project(), ["t-text", "text"]), "t-text", text("x", 0, 2)));
  session.execute(tl.setParams({ registry: registry(), writes: [{ elementId: "x", key: "fontSize", value: 103.7 }] }), OFF);
  assert.equal(el(session.document, "x").fontSize, 100);
});
test("Element parameter registry: Invalid select value from an agent tool", () => {
  const session = open(put(project(), "t-main", clip("c", 0, 2))), before = session.document;
  const result = session.execute(tl.setParams({ registry: registry(), writes: [{ elementId: "c", key: "blendMode", value: "shiny" }] }), tl.HOST_EDIT_CONTEXT);
  assert.deepEqual([result.ok, session.document === before, session.historyLength], [false, true, 0]);
  for (const bad of [{ key: "color", value: "red" }, { key: "fontFamily", value: " " }]) assert.throws(() => tl.coerceParamWrite(registry(), "text", bad.key, bad.value), tl.ParamRejected);
});
test("Element parameter registry: Unknown key", () => {
  const session = open(put(withTracks(project(), ["t-text", "text"]), "t-text", text("x", 0, 2)));
  const result = session.execute(tl.setParams({ registry: registry(), writes: [{ elementId: "x", key: "fontSize", value: 20 }, { elementId: "x", key: "sparkle", value: 3 }] }), OFF);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.message.includes("sparkle"));
  assert.equal(el(session.document, "x").fontSize, 15, "the whole command failed");
});
test("Element parameter registry: Same result from two triggers", () => {
  const opacity = registry().get("visual", "opacity")!;
  const inspector = open(put(project(), "t-main", clip("c", 0, 2, { opacity: 0.4 }))), tool = open(put(project(), "t-main", clip("c", 0, 2, { opacity: 0.4 })));
  inspector.execute(tl.setParams({ registry: registry(), writes: [{ elementId: "c", key: "opacity", value: tl.displayToStored(opacity, 250) }] }), ON);
  tool.execute(tl.setParams({ registry: registry(), writes: [{ elementId: "c", key: "opacity", value: 2.5 }] }), tl.HOST_EDIT_CONTEXT);
  assert.deepEqual([tl.storedToDisplay(opacity, el(inspector.document, "c").opacity), tl.storedToDisplay(opacity, el(tool.document, "c").opacity)], [100, 100]);
  // A stored value outside its range is clamped for evaluation only.
  assert.equal(tl.evaluateParam(opacity, 7), 1);
});

// — Element context menu —
test("Element context menu: Menu on a video clip with audio", () => {
  const doc = put(project(), "t-main", clip("c", 0, 4));
  assert.deepEqual(labels(tl.elementContextMenu(doc, "s1", ["c"])), ["Split", "Cut", "Copy", "Paste", "Duplicate", "Mute", "Extract audio", "Hide", "Deactivate", "Create compound clip", "To overlay", "Freeze frame", "Reverse", "Crop", "Rotate 90°", "Mirror", "Replace media", "Reveal media", "Rename", "Delete clip", "Ripple delete"]);
});
test("Element context menu: Menu on a text element", () => {
  const doc = put(withTracks(project(), ["t-text", "text"]), "t-text", text("x", 0, 2));
  const menu = labels(tl.elementContextMenu(doc, "s1", ["x"]));
  for (const absent of ["Mute", "Extract audio", "Reverse", "Replace media", "Reveal media", "Rename", "Expand keyframes"]) assert.ok(!menu.includes(absent), absent);
  assert.ok(menu.includes("Delete text"));
  const session = open(put(project(), "t-main", clip("c", 0, 4)));
  session.execute(tl.renameElement({ sceneId: "s1", elementId: "c", name: "  Beach  " }), OFF);
  assert.equal(el(session.document, "c").name, "Beach");
});
test("Element context menu: Linked clip", () => {
  const doc = put(project(), "t-main", clip("c", 0, 4, { filmLink: FILM }));
  const menu = labels(tl.elementContextMenu(doc, "s1", ["c"]));
  assert.ok(menu.includes("Open source") && menu.includes("Unlink source"));
});

// — Track context menu —
test("Track context menu: Delete a populated track", () => {
  const doc = put(withTracks(project(), ["t-top", "text", { pinned: true }], ["t-v", "video"]), "t-v", clip("a", 0, 1), clip("b", 1, 1), clip("c", 2, 1), clip("d", 3, 1));
  const session = open(doc);
  assert.equal(tl.deleteTrackConfirmation(trackOf(session.document, "t-v")), "Delete track and its 4 elements?");
  session.execute(tl.deleteTrack({ trackId: "t-v" }), OFF);
  assert.deepEqual(overlay(session.document).map((track) => track.id), ["t-top"]);
  session.undo();
  assert.deepEqual([overlay(session.document).map((track) => track.id), trackOf(session.document, "t-v").elements.length], [["t-top", "t-v"], 4]);
});
test("Track context menu: Main track menu", () => {
  const doc = put(withTracks(project(), ["t-v", "video"]), "t-v", clip("a", 0, 1));
  const menu = ids(tl.trackContextMenu(doc, "t-main"));
  for (const absent of ["delete-track", "move-up", "move-down"]) assert.ok(!menu.includes(absent));
  assert.deepEqual(ids(tl.trackContextMenu(doc, "t-v")), ["paste", "add-track", "rename-track", "mute-track", "solo-track", "hide-track", "lock-track", "move-up", "move-down", "select-all-on-track", "delete-track"]);
  assert.deepEqual(tl.selectAllOnTrack(doc, "t-v").selectedElements, ["a"]);
});

// — Drag and drop from the library —
test("Drag and drop from the library: Drop on free space of a compatible track", () => {
  const session = open(put(withTracks(withAsset(4), ["t-v", "video"]), "t-v", clip("a", 0, 2)));
  session.execute(tl.dropLibraryItem({ sceneId: "s1", items: [media("a4")], time: 12.5 * S, target: { hoveredTrackId: "t-v" } }), ON);
  assert.deepEqual([spans(session.document, "t-v")[1], session.selection.selectedElements.length], [[12.5, 16.5], 1]);
  assert.deepEqual(tl.previewDrop(session.document, "s1", "video", 30 * S, 4 * S, { hoveredTrackId: "t-v" }, ON), { kind: "track", trackId: "t-v", startTime: 30 * S });
});
test("Drag and drop from the library: Drop below all tracks", () => {
  const session = open(put(withTracks(project(), ["t-a", "audio"]), "t-a", audio("u", 0, 2)));
  session.execute(tl.dropLibraryItem({ sceneId: "s1", items: [media("a3")], time: 0, target: { outside: "below" } }), ON);
  assert.deepEqual(audioTracks(session.document).map((track) => track.id === "t-a"), [true, false]);
  session.undo();
  assert.equal(audioTracks(session.document).length, 1);
});
test("Drag and drop from the library: Drop on the magnetic main track", () => {
  const session = open(put(put(withAsset(4), "t-main", clip("c1", 0, 6)), "t-main", clip("c2", 6, 4)));
  session.execute(tl.dropLibraryItem({ sceneId: "s1", items: [media("a4")], time: 5 * S, target: { hoveredTrackId: "t-main" } }), ON);
  assert.deepEqual(spans(session.document, "t-main"), [[0, 6], [6, 10], [10, 14]]);
  assert.equal(main(session.document).elements[1].mediaId, "a4");
});

// — Effect drop targets —
test("Effect drop targets: Drop on a clip", () => {
  const session = open(put(project(), "t-main", clip("c", 0, 4)));
  session.execute(tl.dropEffect({ sceneId: "s1", item: { kind: "effect", effectType: "blur" }, time: S, targetElementId: "c" }), ON);
  assert.deepEqual([el(session.document, "c").effects.length, tl.clipPresentation(session.document, el(session.document, "c"), 200).badges, overlay(session.document).length, session.historyLength], [1, ["effects"], 0, 1]);
});
test("Effect drop targets: Drop on empty area", () => {
  const session = open(put(project(), "t-main", clip("c", 0, 4)));
  session.execute(tl.dropEffect({ sceneId: "s1", item: { kind: "effect", effectType: "blur" }, time: 3 * S }), ON);
  const track = overlay(session.document)[0];
  assert.deepEqual([track.type, spans(session.document, track.id), session.historyLength], ["effect", [[3, 8]], 1]);
  // A hovered effect track that is free takes the next one.
  session.execute(tl.dropEffect({ sceneId: "s1", item: { kind: "filter", effectType: "warm-film" }, time: 10 * S, hoveredTrackId: track.id }), ON);
  assert.equal(overlay(session.document).length, 1);
});

// — Operating-system file drop —
test("Operating-system file drop: First visual on an empty timeline", () => {
  const session = open(project());
  session.execute(tl.dropFiles({ sceneId: "s1", assetIds: ["a1"], time: 7 * S, target: { outside: "above" } }), OFF);
  assert.deepEqual([spans(session.document, "t-main"), overlay(session.document).length], [[[0, 60]], 0]);
});
test("Operating-system file drop: Unsupported file in a batch", () => {
  // The import pipeline skips the PDF and reports it; the timeline inserts what was imported.
  const imported = ["a4"], session = open(withAsset(4));
  session.execute(tl.dropFiles({ sceneId: "s1", assetIds: imported, time: 0, target: { hoveredTrackId: "t-main" } }), ON);
  assert.deepEqual(spans(session.document, "t-main"), [[0, 4]]);
});
test("Operating-system file drop: Mixed batch", () => {
  const doc = tweak(put(withTracks(project(), ["t-v", "video", { pinned: true }]), "t-main", clip("m", 0, 2)), (draft) => { draft.media.assets[0].duration = 4 * S; draft.media.assets[3].duration = 6 * S; draft.media.assets[2].duration = 10 * S; draft.scenes[0].tracks.main.elements[0].sourceDuration = 2 * S; draft.scenes[0].tracks.main.elements[0].trimEnd = 0; });
  const session = open(doc);
  session.execute(tl.dropFiles({ sceneId: "s1", assetIds: ["a1", "a4", "a3"], time: 8 * S, target: { hoveredTrackId: "t-v" } }), OFF);
  assert.deepEqual([spans(session.document, "t-v"), spans(session.document, audioTracks(session.document)[0].id), session.historyLength], [[[8, 12], [12, 18]], [[8, 18]], 1]);
  session.undo();
  assert.deepEqual([spans(session.document, "t-v"), audioTracks(session.document).length], [[], 0]);
});

// — Timeline zoom —
test("Timeline zoom: Button zoom", () => {
  assert.equal(tl.zoomIn(1, 0.01), 1.7);
  assert.equal(tl.pixelsPerSecond(1.7), 85);
  assert.ok(Math.abs(tl.zoomOut(1.7, 0.01) - 1) < 1e-12);
});
test("Timeline zoom: Zoom to fit", () => {
  const fit = tl.zoomToFit(60 * S, 1200);
  assert.deepEqual([Math.round(fit.zoomLevel * 100) / 100, Math.round(tl.ticksToPixels(60 * S, fit.zoomLevel)), tl.pixelsPerSecond(fit.zoomLevel), fit.scrollLeft], [0.38, 1140, 19, 0]);
});
test("Timeline zoom: Maximum", () => {
  assert.equal(tl.zoomIn(100, 0.01), 100);
  const min = tl.zoomMin(60 * S, 1200);
  assert.equal(min, (1200 * 0.25) / (60 * 50));
  assert.ok(Math.abs(tl.sliderToZoom(0, min) - min) < 1e-12 && Math.abs(tl.sliderToZoom(1, min) - 100) < 1e-9 && Math.abs(tl.zoomToSlider(tl.sliderToZoom(0.37, min), min) - 0.37) < 1e-12);
  assert.ok(Math.abs(tl.wheelZoom(1, 300, min) - Math.exp(-0.1)) < 1e-12, "the per-frame delta is capped at ±30");
  assert.deepEqual([tl.rightPaddingPx(1000, min, min), Math.round(tl.rightPaddingPx(1000, 100, min))], [750, 150]);
  // At slider position ≥ 0.15 the playhead keeps its viewport offset; wheel zoom keeps the time under the pointer.
  const anchored = tl.zoomScroll({ zoomLevel: 2, scrollLeft: 400 }, 4, { kind: "playhead", playheadTime: 5 * S }, min);
  assert.equal(tl.ticksToPixels(5 * S, 4) - anchored.scrollLeft, tl.ticksToPixels(5 * S, 2) - 400);
  const pointed = tl.zoomScroll({ zoomLevel: 2, scrollLeft: 400 }, 4, { kind: "pointer", viewportX: 300 }, min);
  assert.equal((pointed.scrollLeft + 300) / 4, (400 + 300) / 2);
});

// — Timeline scrolling and layout —
test("Timeline scrolling and layout: Ruler stays visible", () => {
  // Ruler and marker row are outside the vertical scroll; wheel maths decides the axis.
  assert.deepEqual(tl.wheelIntent({ deltaX: 0, deltaY: 120 }), { kind: "vertical", delta: 120 });
  assert.deepEqual(tl.wheelIntent({ deltaX: 0, deltaY: 120, shiftKey: true }), { kind: "horizontal", delta: 40 });
  assert.deepEqual(tl.wheelIntent({ deltaX: -90, deltaY: 10 }), { kind: "horizontal", delta: -40 });
  assert.equal(tl.wheelIntent({ deltaX: 0, deltaY: 10, ctrlKey: true }).kind, "zoom");
});
test("Timeline scrolling and layout: Initial scroll", () => {
  let doc = put(project(), "t-main", clip("m", 0, 2));
  for (let index = 0; index < 12; index++) doc = put(withTracks(doc, [`o${index}`, "text"]), `o${index}`, text(`x${index}`));
  const rows = tl.trackRows(doc), last = rows[rows.length - 1], viewport = 5 * 31;
  const scrollTop = tl.initialVerticalScroll(last.top + last.height, viewport);
  const mainRow = rows.find((row) => row.zone === "main")!;
  assert.ok(mainRow.top >= scrollTop && mainRow.top + mainRow.height <= scrollTop + viewport);
});

// — Timeline view state persistence —
test("Timeline view state persistence: Restore on reopen", () => {
  const session = open(put(project(), "t-main", clip("m", 0, 20)));
  session.setView({ zoomLevel: 3.2, scrollLeft: 840 });
  session.seek(12 * S);
  assert.deepEqual([session.historyLength, session.patches.length], [0, 0]);
  const reopened = open(projectDocumentSchema.parse(JSON.parse(JSON.stringify(session.document))));
  assert.deepEqual([reopened.view.zoomLevel, reopened.view.scrollLeft, reopened.playhead], [3.2, 840, 12 * S]);
  // Scroll saves are debounced 300 ms; a scrub that ends saves at once.
  const saved: number[] = [], saver = tl.createScrollSaver((value) => saved.push(value));
  saver.scrolled(10, 0); saver.scrolled(20, 100); saver.tick(350);
  assert.deepEqual(saved, []);
  saver.tick(400); saver.scrolled(30, 500); saver.flush();
  assert.deepEqual(saved, [20, 30]);
});
test("Timeline view state persistence: Expanded lanes survive a reload", () => {
  const session = open(put(project(), "t-main", clip("a", 0, 4), clip("b", 4, 4)));
  session.setView({ expandedKeyframeElementIds: ["a", "gone"] });
  const reopened = open(projectDocumentSchema.parse(JSON.parse(JSON.stringify(session.document))));
  assert.deepEqual(reopened.view.expandedKeyframeElementIds, ["a"]);
});

// — Ruler and timecode —
const FPS = { numerator: 30, denominator: 1 };
test("Ruler and timecode: Label format past one hour", () => {
  assert.equal(tl.rulerLabel(3725, FPS), "1:02:05");
  assert.equal(tl.rulerLabel(65, FPS), "01:05");
  // 30 px per second: labels every 5 s, so 1 h 2 min 5 s carries one.
  const ticks = tl.rulerTicks(0.6, FPS, 3725 * 30 - 300, 600);
  assert.ok(ticks.some((tick) => tick.label === "1:02:05"));
  assert.ok(ticks.every((tick) => tick.x >= 3725 * 30 - 300 - 200 - 30 && tick.x <= 3725 * 30 + 300 + 200 + 30), "only the viewport and its buffer are produced");
});
test("Ruler and timecode: Timecode entry moves the timeline playhead", () => {
  assert.equal(tl.seekFromTimecode("00:00:10:15", 60 * S, FPS), 10.5 * S);
  assert.equal(tl.seekFromTimecode("00:02:00:00", 60 * S, FPS), 60 * S);
  assert.equal(tl.seekFromTimecode("nonsense", 60 * S, FPS), null);
  assert.equal(tl.autoFollowScroll("page", { playheadX: tl.ticksToPixels(10.5 * S, 1), scrollLeft: 2000, viewportWidth: 1000 }), tl.ticksToPixels(10.5 * S, 1) - 100);
});
test("Ruler and timecode: Frame labels", () => {
  const zoom = (20 * 30) / 50, config = tl.rulerConfig(zoom, FPS);
  assert.deepEqual([Math.round(config.tickIntervalSeconds * 30), Math.round(config.labelIntervalSeconds * 30)], [1, 10]);
  assert.equal(tl.rulerLabel(10 / 30, FPS), "10f");
  for (const level of [0.02, 0.3, 1, 7, 40, 100]) { const { tickIntervalSeconds, labelIntervalSeconds } = tl.rulerConfig(level, FPS); const ratio = labelIntervalSeconds / tickIntervalSeconds; assert.ok(Math.abs(ratio - Math.round(ratio)) < 1e-6, `tick divides label at ${level}`); }
});

// — Playhead and seeking —
test("Playhead and seeking: Next cut point", () => {
  const doc = put(withTracks(project(), ["t-v", "video"]), "t-v", clip("a", 0, 4), clip("b", 6, 3));
  assert.deepEqual([tl.seekAction(doc, "next-cut", 5 * S), tl.seekAction(doc, "previous-cut", 5 * S), tl.seekAction(doc, "next-cut", 9 * S)], [6 * S, 4 * S, 9 * S]);
  const ends = put(withTracks(project(), ["t-v", "video"]), "t-v", clip("a", 0, 4), clip("b", 4, 5));
  assert.deepEqual([tl.seekAction(ends, "next-cut", 5 * S), tl.seekAction(ends, "previous-cut", 5 * S)], [9 * S, 4 * S]);
});
test("Playhead and seeking: Multi-frame step", () => {
  const doc = put(project(), "t-main", clip("a", 0, 20));
  assert.equal(tl.seekAction(doc, "step-forward-10", 100 * 4000), 110 * 4000);
  assert.deepEqual([tl.seekAction(doc, "step-back", 0), tl.seekAction(doc, "go-to-end", 0), tl.seekAction(doc, "jump-forward-5s", 18 * S), tl.seekAction(doc, "stop", 7 * S), tl.seekAction(doc, "seek-back-1s", 3 * S)], [0, 20 * S, 20 * S, 0, 2 * S]);
});
test("Playhead and seeking: Page auto-follow", () => {
  assert.equal(tl.autoFollowScroll("page", { playheadX: 1001, scrollLeft: 0, viewportWidth: 1000 }), 901);
  assert.equal(tl.autoFollowScroll("page", { playheadX: 600, scrollLeft: 0, viewportWidth: 1000 }), 0);
  assert.equal(tl.autoFollowScroll("smooth", { playheadX: 700, scrollLeft: 0, viewportWidth: 1000 }), 200);
  assert.equal(tl.autoFollowScroll("page", { playheadX: 1001, scrollLeft: 0, viewportWidth: 1000, now_ms: 1500, lastManualScroll_ms: 1000 }), 0, "suspended for 1 s after a manual scroll");
});
test("Playhead and seeking: Auto-follow off", () => {
  assert.equal(tl.autoFollowScroll("off", { playheadX: 5000, scrollLeft: 120, viewportWidth: 1000 }), 120);
});
test("Playhead and seeking: Mobile fixed playhead", () => {
  const before = tl.mobileScrollToTime(tl.mobileTimeToScroll(4 * S, 2), 2, 60 * S, FPS);
  const after = tl.mobileScrollToTime(tl.mobileTimeToScroll(4 * S, 2) + tl.ticksToPixels(2 * S, 2), 2, 60 * S, FPS);
  assert.deepEqual([before, after - before], [4 * S, 2 * S]);
  assert.equal(tl.mobileScrollToTime(1e9, 2, 60 * S, FPS), 60 * S, "the content end can be scrolled to the centre line");
});

// — In/out range —
const ranged = () => open(put(withTracks(project(), ["t-v", "video"]), "t-v", clip("a", 2, 3), clip("b", 7, 2)));
test("In/out range: Set a range", () => {
  const session = ranged();
  session.execute(tl.setRangePoint({ sceneId: "s1", point: "in", time: 2 * S }), OFF);
  session.execute(tl.setRangePoint({ sceneId: "s1", point: "out", time: 6 * S }), OFF);
  assert.deepEqual([session.document.scenes[0].inPoint, session.document.scenes[0].outPoint], [2 * S, 6 * S]);
  session.undo();
  assert.deepEqual([session.document.scenes[0].inPoint, session.document.scenes[0].outPoint], [2 * S, undefined]);
  session.redo();
  session.execute(tl.clearRange({ sceneId: "s1" }), OFF);
  assert.deepEqual(["inPoint" in session.document.scenes[0], "outPoint" in session.document.scenes[0]], [false, false]);
});
test("In/out range: In after out", () => {
  const session = ranged();
  session.execute(tl.setRangePoint({ sceneId: "s1", point: "out", time: 6 * S }), OFF);
  session.execute(tl.setRangePoint({ sceneId: "s1", point: "in", time: 8 * S }), OFF);
  assert.deepEqual([session.document.scenes[0].inPoint, session.document.scenes[0].outPoint], [8 * S, undefined]);
});
test("In/out range: Drag an end", () => {
  const session = ranged();
  session.execute(tl.setRangePoint({ sceneId: "s1", point: "in", time: 2 * S }), OFF);
  session.execute(tl.setRangePoint({ sceneId: "s1", point: "out", time: 6 * S }), OFF);
  const steps = session.historyLength, dragged = 9 * S - tl.pixelsToTicks(6, 1);
  const snap = tl.snapGesture(session.document, "range-drag", [dragged], { zoomLevel: 1, enabled: true });
  session.execute(tl.setRangePoint({ sceneId: "s1", point: "out", time: snap.time }), OFF);
  assert.deepEqual([session.document.scenes[0].outPoint, session.historyLength], [9 * S, steps + 1]);
});
test("In/out range: Range from the selection", () => {
  const session = ranged();
  session.execute(tl.setRangePoint({ sceneId: "s1", point: "in", time: 1 * S }), OFF);
  session.execute(tl.setRangeToSelection({ sceneId: "s1", elementIds: ["a", "b"] }), OFF);
  assert.deepEqual([session.document.scenes[0].inPoint, session.document.scenes[0].outPoint], [2 * S, 9 * S]);
  session.undo();
  assert.deepEqual([session.document.scenes[0].inPoint, session.document.scenes[0].outPoint], [1 * S, undefined]);
  const none = session.execute(tl.setRangeToSelection({ sceneId: "s1", elementIds: [] }), OFF);
  assert.deepEqual([none.ok, !none.ok && none.message, tl.toolStates(session.document, { selectedIds: [], playhead: 0 })["range.set-to-selection"].reason], [false, "Select a clip first", "Select a clip first"]);
});

// — Timeline toolbar —
test("Timeline toolbar: Tool order", () => {
  const layout = tl.toolbarLayout(put(project(), "t-main", clip("c", 0, 4)), []);
  assert.deepEqual(layout.left, ["cursor-mode", "undo", "redo", "split", "delete-left", "delete-right", "delete", "marker", "freeze", "reverse", "mirror", "rotate-90", "crop", "extract-audio", "duplicate", "graph-editor"]);
  assert.deepEqual([layout.context, layout.overflow], [[], []]);
  assert.deepEqual(layout.right, ["record-voiceover", "magnet", "snapping", "linkage", "preview-axis", "ripple", "zoom-out", "zoom-slider", "zoom-in", "zoom-fit"]);
});
test("Timeline toolbar: Context group for a video clip", () => {
  const doc = put(put(withTracks(project(), ["t-a", "audio"]), "t-main", clip("c", 0, 4)), "t-a", audio("u", 0, 4));
  assert.deepEqual(tl.toolbarLayout(doc, ["c"]).context, ["transcript", "split-scenes", "remove-background", "auto-adjust", "enhance"]);
  assert.deepEqual([tl.toolbarLayout(doc, ["u"]).context, tl.toolbarLayout(doc, ["c", "u"]).context], [["mark-beats", "enhance-voice"], []]);
});
test("Timeline toolbar: Overflow", () => {
  const layout = tl.toolbarLayout(put(project(), "t-main", clip("c", 0, 4)), ["c"], 7);
  assert.deepEqual([layout.left, layout.overflow.length, layout.overflow[0], layout.context, layout.right.length], [["cursor-mode", "undo", "redo", "split", "delete-left", "delete-right", "delete"], 9, "marker", [], 10]);
  assert.equal(tl.toolbarLayout(project(), [], 3).left.length, 7, "the tools up to Delete never overflow");
});
test("Timeline toolbar: Disabled with reason", () => {
  const doc = put(project(), "t-main", clip("c", 0, 4));
  assert.deepEqual(tl.toolStates(doc, { selectedIds: [], playhead: 9 * S }).split, { enabled: false, reason: "Select a clip or move the playhead onto one" });
  assert.equal(tl.toolStates(doc, { selectedIds: [], playhead: 2 * S }).split.enabled, true);
  const session = open(doc);
  session.execute(tl.split({ sceneId: "s1", time: 2 * S }), OFF);
  assert.equal(tl.toolStates(session.document, { selectedIds: [], playhead: 0, canUndo: session.canUndo, undoLabel: session.undoLabel }).undo.tooltip, "Undo Split");
  assert.equal(tl.toolStates(session.document, { selectedIds: [], playhead: 0 }).redo.enabled, false);
});
test("Timeline toolbar: Scene name", () => {
  const session = open(project());
  session.execute(tl.renameScene({ sceneId: "s1", name: "Intro" }), OFF);
  assert.equal(tl.toolbarLayout(session.document, []).centre.name, "Intro");
});

// — Clip rendering (the behaviour-dependent parts; drawing is the UI's) —
test("Clip rendering: Filmstrip reflects trim", () => {
  const session = open(put(project(), "t-main", clip("c", 0, 10)));
  session.execute(tl.trim({ sceneId: "s1", elementId: "c", side: "start", delta: 5 * S }), OFF);
  assert.equal(tl.clipPresentation(session.document, el(session.document, "c"), 300).filmstripSourceStart, 5 * S);
});
test("Clip rendering: Narrow clip", () => {
  const doc = put(project(), "t-main", clip("c", 0, 10, { muted: true, linkId: null }));
  assert.deepEqual([tl.clipPresentation(doc, el(doc, "c"), 20).showHeader, tl.clipPresentation(doc, el(doc, "c"), 20).badges, tl.clipPresentation(doc, el(doc, "c"), 24).badges], [false, [], ["muted"]]);
});
test("Clip rendering: Offline media", () => {
  const doc = put(project(), "t-main", clip("c", 0, 10, { filmLink: FILM, muted: true, retime: { rate: 2, maintainPitch: false, reverse: true, smooth: "none" }, sourceDuration: 60 * S, trimEnd: 40 * S }));
  assert.deepEqual(tl.clipPresentation(doc, el(doc, "c"), 200, { offlineAssetIds: ["a1"], trimAdjusted: true }).badges, ["provenance", "speed", "reverse", "muted", "trim-adjusted", "media-offline"]);
});
void sticker; void trackIdOf;
