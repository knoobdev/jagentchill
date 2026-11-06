import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalize, libraryAssets } from "@jagentchill/editor-core";
import { projectDocumentSchema, type ProjectDocument } from "@jagentchill/protocol";
import {
  DEFAULT_LIBRARY_PREFERENCES, DEFAULT_SORT, EMPTY_SELECTION, NO_FILTERS, SORT_LABELS, actionTargets, activeFilterCount, addTag, addTargets, canCreateFolderIn, canMoveFolder, cardLabel, checkFolderName,
  chooseSort, cleanupSuggestions, clipsUsingAsset, createFolderCommand, creditsList, deleteFolderCommand, folderChainForDroppedPath, foldText, importAssetCommand, indexingLabel, infoFields, isEmptySlot, isOfflineFile, listLibrary,
  marqueeHits, message, moveToFolderCommand, provenance, readLibraryPreferences, removalImpact, removeAssetsCommand, renameAssetCommand, renameFolderCommand, revealAsset, selection, setAssetTagsCommand,
  setLocalAsset, shortHash, sourceBadges, sourceFilterOf, unreferencedEphemeralAssets, usageCounts, type LibraryView,
} from "../src/index.ts";
import { HASH, NOW, SECOND, addScene, asset, audioClip, imageClip, place, project, session, videoClip } from "./support/project.ts";

const view = (over: Partial<LibraryView> = {}): LibraryView => ({ folderId: null, query: "", filters: NO_FILTERS, sort: DEFAULT_SORT, ...over });
const names = (doc: ProjectDocument, v: LibraryView, data?: Parameters<typeof listLibrary>[2]) => listLibrary(doc, v, data).rows.map((row) => row.asset.name);
const online = { present: { original: true, proxy: false, mezzanine: false } };

test("Ephemeral asset hidden: an ephemeral tool asset is not in the grid, list, search or counts", () => {
  const doc = project([asset("a1", "video"), asset("tmp", "image", { ephemeral: true, name: "tmp-frame.png" }), asset("m1", "image", { kind: "derived", derived: { role: "matte", sourceAssetId: "a1" }, provenance: { source: "derived", tool: "cutout" } })]);
  assert.deepEqual(names(doc, view()), ["a1.mp4"]);
  assert.deepEqual(names(doc, view({ query: "tmp" })), []);
  assert.equal(libraryAssets(doc).length, 1);
  assert.equal(listLibrary(doc, view()).empty, false);
  // Removed at project close when no element references it.
  assert.deepEqual(unreferencedEphemeralAssets(doc), ["tmp"]);
  place(doc, "main", [imageClip("e1", "tmp")]);
  assert.deepEqual(unreferencedEphemeralAssets(doc), []);
});

test("Empty library: a project with no assets shows the drop zone as the panel content", () => {
  assert.equal(listLibrary(project(), view()).empty, true);
  assert.equal(message("media.drop-zone").text, "Drag and drop videos, photos, and audio files here");
  assert.equal(message("media.drop-zone.processing", { percent: 40 }).text, "Processing your files (40 %)");
});

test("Flip sort order: choosing the active key flips ascending/descending and a new key starts ascending", () => {
  assert.deepEqual(DEFAULT_SORT, { key: "name", direction: "asc" });
  assert.deepEqual(chooseSort({ key: "name", direction: "asc" }, "name"), { key: "name", direction: "desc" });
  assert.deepEqual(chooseSort({ key: "name", direction: "desc" }, "size"), { key: "size", direction: "asc" });
  assert.deepEqual(Object.values(SORT_LABELS), ["Name", "Type", "Duration", "File size", "Date added"]);
  const doc = project([
    asset("a1", "video", { name: "b-roll 10.mp4", size: 300, duration: 5 * SECOND, created_ms: NOW + 3 }), asset("a2", "image", { name: "Alpha.png", size: 100, created_ms: NOW + 1 }),
    asset("a3", "audio", { name: "b-roll 2.wav", size: 200, duration: 9 * SECOND, created_ms: NOW + 2 }),
  ]);
  const s = session(doc);
  s.commit(createFolderCommand(s.document, s.context(), "Zeta"));
  s.commit(createFolderCommand(s.document, s.context(), "Beta"));
  assert.deepEqual(names(s.document, view()), ["Alpha.png", "b-roll 2.wav", "b-roll 10.mp4"]);
  assert.deepEqual(names(s.document, view({ sort: { key: "name", direction: "desc" } })), ["b-roll 10.mp4", "b-roll 2.wav", "Alpha.png"]);
  assert.deepEqual(names(s.document, view({ sort: { key: "size", direction: "desc" } })), ["b-roll 10.mp4", "b-roll 2.wav", "Alpha.png"]);
  assert.deepEqual(names(s.document, view({ sort: { key: "duration", direction: "asc" } })), ["Alpha.png", "b-roll 10.mp4", "b-roll 2.wav"]);
  assert.deepEqual(names(s.document, view({ sort: { key: "created", direction: "asc" } })), ["Alpha.png", "b-roll 2.wav", "b-roll 10.mp4"]);
  assert.deepEqual(names(s.document, view({ sort: { key: "type", direction: "asc" } })), ["b-roll 2.wav", "Alpha.png", "b-roll 10.mp4"]);
  // Folders are always listed first.
  assert.deepEqual(listLibrary(s.document, view({ sort: { key: "size", direction: "desc" } })).folders.map((folder) => folder.name), ["Beta", "Zeta"]);
});

test("Truncated name: \"very-long-recording-name-final-v2.mp4\" reads \"very-long-record…-v2\" on its card", () => {
  assert.equal(cardLabel("very-long-recording-name-final-v2.mp4"), "very-long-record…-v2");
  // 22 characters or fewer are shown in full.
  assert.equal(cardLabel("exactly-22-chars-x.mp4"), "exactly-22-chars-x.mp4");
  assert.equal(cardLabel("short.mp4"), "short.mp4");
});

test("Persistence: list view sorted by File size is read back after a restart; unreadable preferences fall back to the defaults", () => {
  const stored = JSON.parse(JSON.stringify({ view: "list", sort: { key: "size", direction: "asc" } }));
  assert.deepEqual(readLibraryPreferences(stored), { view: "list", sort: { key: "size", direction: "asc" } });
  assert.deepEqual(readLibraryPreferences(undefined), DEFAULT_LIBRARY_PREFERENCES);
  assert.deepEqual(readLibraryPreferences({ view: "tiles", sort: { key: "colour" } }), { view: "grid", sort: { key: "name", direction: "asc" } });
});

test("Move into a folder: three assets dragged onto \"B-roll\" are listed inside it and their timeline clips are unaffected", () => {
  const s = session(place(project([asset("a1", "video"), asset("a2", "video"), asset("a3", "image"), asset("a4", "audio")]), "main", [videoClip("e1", "a1"), videoClip("e2", "a2", 2)]));
  const folder = createFolderCommand(s.document, s.context(), "  B-roll  ");
  s.commit(folder);
  const before = canonicalize({ ...s.document, media: undefined, metadata: undefined });
  s.commit(moveToFolderCommand(s.document, s.context(), { assetIds: ["a1", "a2", "a3"] }, folder.folderId));
  assert.deepEqual(names(s.document, view({ folderId: folder.folderId })), ["a1.mp4", "a2.mp4", "a3.png"]);
  assert.deepEqual(names(s.document, view()), ["a4.wav"]);
  assert.equal(listLibrary(s.document, view({ folderId: folder.folderId })).breadcrumb[0].name, "B-roll");
  assert.equal(canonicalize({ ...s.document, media: undefined, metadata: undefined }), before);
  // Folder changes are undoable commands that emit state patches.
  assert.ok(s.commits.at(-1)!.patch.length > 0);
  assert.equal(s.undo(), true);
  assert.deepEqual(names(s.document, view()), ["a1.mp4", "a2.mp4", "a3.png", "a4.wav"]);
});

test("Delete folder keeps assets: a folder with 5 assets is deleted and the 5 assets are listed in the parent folder", () => {
  const s = session(project(["a1", "a2", "a3", "a4", "a5"].map((id) => asset(id, "image"))));
  const parent = createFolderCommand(s.document, s.context(), "Shoot"); s.commit(parent);
  const child = createFolderCommand(s.document, s.context(), "Day 1", parent.folderId); s.commit(child);
  s.commit(moveToFolderCommand(s.document, s.context(), { assetIds: ["a1", "a2", "a3", "a4", "a5"] }, child.folderId));
  s.commit(deleteFolderCommand(s.document, s.context(), child.folderId));
  assert.equal(names(s.document, view({ folderId: parent.folderId })).length, 5);
  assert.equal(s.document.media.assets.length, 5);
  assert.equal(s.document.media.folders.length, 1);
});

test("Depth limit: \"New folder\" is disabled inside a level-4 folder with the tooltip \"Folders can be nested up to 4 levels\"", () => {
  const s = session(project());
  let parent: string | null = null;
  for (const name of ["L1", "L2", "L3", "L4"]) { const made = createFolderCommand(s.document, s.context(), name, parent); s.commit(made); parent = made.folderId; }
  assert.equal(canCreateFolderIn(s.document, parent), false);
  assert.equal(canCreateFolderIn(s.document, s.document.media.folders.find((folder) => folder.name === "L3")!.id), true);
  assert.equal(message("media.folder-depth").text, "Folders can be nested up to 4 levels");
  assert.throws(() => createFolderCommand(s.document, s.context(), "L5", parent), /nested up to 4 levels/);
  // A subtree may not be moved where it would exceed the limit, nor into itself.
  const [l1, l2] = ["L1", "L2"].map((name) => s.document.media.folders.find((folder) => folder.name === name)!.id);
  const other = createFolderCommand(s.document, s.context(), "Other"); s.commit(other);
  assert.equal(canMoveFolder(s.document, l1, other.folderId), false);
  assert.equal(canMoveFolder(s.document, l1, l2), false);
  assert.equal(canMoveFolder(s.document, other.folderId, l2), true);
  assert.throws(() => moveToFolderCommand(s.document, s.context(), { folderIds: [l1] }, other.folderId));
});

test("folder names are trimmed, 1–80 characters and unique among siblings", () => {
  const s = session(project());
  const made = createFolderCommand(s.document, s.context(), "  Interviews "); s.commit(made);
  assert.equal(s.document.media.folders[0].name, "Interviews");
  assert.deepEqual(checkFolderName(s.document, null, "interviews"), { ok: false, reason: "duplicate" });
  assert.deepEqual(checkFolderName(s.document, null, "   "), { ok: false, reason: "empty" });
  assert.deepEqual(checkFolderName(s.document, null, "x".repeat(81)), { ok: false, reason: "too-long" });
  assert.deepEqual(checkFolderName(s.document, made.folderId, "Interviews"), { ok: true, name: "Interviews" });
  assert.throws(() => createFolderCommand(s.document, s.context(), "INTERVIEWS"));
  s.commit(renameFolderCommand(s.document, s.context(), made.folderId, "Talking heads"));
  assert.equal(s.document.media.folders[0].name, "Talking heads");
  // A dropped directory tree: depth capped at 4, deeper files land in the level-4 folder.
  assert.deepEqual(folderChainForDroppedPath("Trip/Day 1/Cam A/Raw/Deep/Deeper/clip.mp4"), ["Trip", "Day 1", "Cam A", "Raw"]);
  assert.deepEqual(folderChainForDroppedPath("clip.mp4"), []);
  assert.deepEqual(folderChainForDroppedPath("A/B/C/clip.mp4", 2), ["A", "B"]);
});

test("Search by name across folders: typing \"beach\" lists \"Beach-01.mp4\" from a subfolder with its folder path", () => {
  const s = session(project([asset("a1", "video", { name: "Beach-01.mp4" }), asset("a2", "video", { name: "City.mp4" }), asset("a3", "image", { name: "Plage été.png", tags: ["Séjour"] })]));
  const top = createFolderCommand(s.document, s.context(), "Holiday"); s.commit(top);
  const sub = createFolderCommand(s.document, s.context(), "Day 2", top.folderId); s.commit(sub);
  s.commit(moveToFolderCommand(s.document, s.context(), { assetIds: ["a1"] }, sub.folderId));
  const hits = listLibrary(s.document, view({ query: "beach" })).rows;
  assert.deepEqual(hits.map((row) => [row.asset.name, row.folderPath]), [["Beach-01.mp4", "Holiday / Day 2"]]);
  // Case- and diacritic-insensitive, over name, folder name, tags and provenance prompt.
  assert.deepEqual(names(s.document, view({ query: "ETE" })), ["Plage été.png"]);
  assert.deepEqual(names(s.document, view({ query: "sejour" })), ["Plage été.png"]);
  assert.deepEqual(names(s.document, view({ query: "day 2" })), ["Beach-01.mp4"]);
  assert.equal(foldText("Tiếng Việt ĐẸP"), "tieng viet dep");
  const none = listLibrary(s.document, view({ query: "zebra" }));
  assert.equal(none.noResults, true);
  assert.deepEqual([message("media.no-results").text, message("media.clear-search").text], ["No media found", "Clear search"]);
});

test("Search by spoken words: an asset whose transcript contains \"welcome back\" is listed for that search", () => {
  const doc = project([asset("a1", "video", { name: "take3.mp4" }), asset("a2", "video", { name: "take4.mp4" }), asset("a5", "image", { name: "gen.png", provenance: provenance.ai({ provider: "p", model: "m", role: "image", jobId: "j", prompt: "a red fox at dawn" }) })]);
  const data = { searchData: { a1: { transcript: "Hello and Welcome Back to the channel" }, a2: { labels: ["dog", "park"] } } };
  assert.deepEqual(names(doc, view({ query: "welcome back" }), data), ["take3.mp4"]);
  assert.deepEqual(names(doc, view({ query: "park" }), data), ["take4.mp4"]);
  assert.deepEqual(names(doc, view({ query: "red fox" }), data), ["gen.png"]);
});

test("Labelling failed: searching \"beach\" still lists the asset by name and its Info panel shows \"Not indexed\" with \"Retry\"", () => {
  const doc = project([asset("a1", "video", { name: "Beach-01.mp4" })]);
  const data = { searchData: { a1: { indexing: "failed" as const } } };
  assert.deepEqual(names(doc, view({ query: "beach" }), data), ["Beach-01.mp4"]);
  assert.deepEqual(indexingLabel(data.searchData.a1), { text: "Not indexed", action: "Retry" });
  assert.equal(indexingLabel({ indexing: "indexed", labels: ["sea"] }), null);
});

test("Filter unused: with the filter Unused active only assets referenced by no element in any scene are listed", () => {
  const doc = addScene(project([asset("a1", "video"), asset("a2", "image"), asset("a3", "audio"), asset("a4", "video")]), "s2");
  place(doc, "main", [videoClip("e1", "a1")]);
  place(doc, "main", [imageClip("e2", "a2")], 1);
  assert.deepEqual(names(doc, view({ filters: { ...NO_FILTERS, usage: "unused" } })), ["a3.wav", "a4.mp4"]);
  assert.deepEqual(names(doc, view({ filters: { ...NO_FILTERS, usage: "used" } })), ["a1.mp4", "a2.png"]);
  assert.deepEqual(names(doc, view({ filters: { ...NO_FILTERS, usage: "unused", types: ["video"] } })), ["a4.mp4"]);
  assert.equal(activeFilterCount({ types: ["video", "audio"], usage: "unused", sources: ["ai"], statuses: [] }), 4);
  assert.equal(message("media.clear-filters").text, "Clear filters");
});

test("filters by source and status combine with search", () => {
  let doc = project([
    asset("a1", "video", { name: "import.mp4" }), asset("a2", "video", { name: "rec.mp4", provenance: provenance.recorded() }),
    asset("a3", "video", { name: "stock.mp4", provenance: provenance.stock({ provider: "px", itemId: "1", author: "A", licence: "CC-BY-4.0", licenceUrl: "https://l", sourceUrl: "https://s", attributionRequired: true }) }),
    asset("a4", "audio", { name: "starter.wav", provenance: provenance.bundled({ itemId: "music-01", licence: "CC0-1.0", sourceUrl: "https://s" }) }),
    asset("a5", "image", { name: "gen.png", provenance: provenance.ai({ provider: "p", model: "m", role: "image", jobId: "j" }) }),
    asset("a6", "video", { name: "drive.mp4", provenance: provenance.connector({ connector: "google-drive", remoteId: "f1" }) }),
    asset("a7", "image", { name: "slate.png", kind: "slate", provenance: provenance.slate({ scriptId: "sc1", sceneId: "x1", versionId: "v1" }) }),
    asset("a8", "video", { name: "link.mp4", provenance: provenance.url("https://example.org/link.mp4") }),
  ]);
  assert.deepEqual(doc.media.assets.map(sourceFilterOf), ["imported", "recorded", "stock", "stock", "ai", "connector", "slate", "imported"]);
  for (const id of ["a1", "a2", "a3", "a4", "a5", "a6", "a7"]) doc = setLocalAsset(doc, id, online);
  doc = setLocalAsset(doc, "a1", { ...online, canDecode: false });
  doc = setLocalAsset(doc, "a2", { present: { original: true, proxy: true, mezzanine: false }, proxy: { state: "succeeded" } });
  assert.deepEqual(names(doc, view({ filters: { ...NO_FILTERS, sources: ["stock"] } })), ["starter.wav", "stock.mp4"]);
  assert.deepEqual(names(doc, view({ filters: { ...NO_FILTERS, sources: ["ai", "slate"] } })), ["gen.png", "slate.png"]);
  assert.deepEqual(names(doc, view({ filters: { ...NO_FILTERS, statuses: ["offline"] } })), ["link.mp4"]);
  assert.deepEqual(names(doc, view({ filters: { ...NO_FILTERS, statuses: ["cant-preview"] } })), ["import.mp4"]);
  assert.deepEqual(names(doc, view({ filters: { ...NO_FILTERS, statuses: ["has-proxy"] } })), ["rec.mp4"]);
  assert.deepEqual(names(doc, view({ query: "mp4", filters: { ...NO_FILTERS, sources: ["connector"] } })), ["drive.mp4"]);
  assert.deepEqual(doc.media.assets.map((entry) => sourceBadges(entry).join()), ["", "", "", "", "AI", "", "Slate", ""]);
  assert.deepEqual(creditsList(doc).map((credit) => [credit.title, credit.author, credit.licence]), [["stock.mp4", "A", "CC-BY-4.0"]]);
});

test("Range select: with the first asset selected, Shift-click on the fourth selects assets 1–4", () => {
  const displayed = ["a1", "a2", "a3", "a4", "a5"];
  let current = selection.click(EMPTY_SELECTION, "a1");
  current = selection.range(current, "a4", displayed);
  assert.deepEqual(current.ids, ["a1", "a2", "a3", "a4"]);
  // The anchor stays: a second Shift-click re-ranges from it.
  assert.deepEqual(selection.range(current, "a2", displayed).ids, ["a1", "a2"]);
  current = selection.toggle(selection.click(EMPTY_SELECTION, "a1"), "a3");
  assert.deepEqual(current.ids, ["a1", "a3"]);
  assert.deepEqual(selection.toggle(current, "a1").ids, ["a3"]);
  assert.deepEqual(selection.all(displayed).ids, displayed);
  assert.deepEqual(selection.clear().ids, []);
  assert.deepEqual(selection.prune({ ids: ["a1", "gone"], anchor: "gone" }, displayed), { ids: ["a1"], anchor: null });
  assert.deepEqual(actionTargets({ ids: ["a1", "a3"], anchor: "a1" }, "a3"), ["a1", "a3"]);
  assert.deepEqual(actionTargets({ ids: ["a1", "a3"], anchor: "a1" }, "a5"), ["a5"]);
});

test("Marquee: dragging a marquee over three cards selects those three assets", () => {
  const cards = ["a1", "a2", "a3", "a4", "a5", "a6"].map((id, index) => ({ id, x: (index % 3) * 120, y: Math.floor(index / 3) * 140, width: 112, height: 130 }));
  const hit = marqueeHits({ x: 380, y: 10, width: -370, height: 60 }, cards);
  assert.deepEqual(hit, ["a1", "a2", "a3"]);
  assert.deepEqual(selection.marquee(EMPTY_SELECTION, hit, false).ids, ["a1", "a2", "a3"]);
  // Additive with Shift/Ctrl/Cmd.
  assert.deepEqual(selection.marquee({ ids: ["a5", "a1"], anchor: "a5" }, hit, true).ids, ["a5", "a1", "a2", "a3"]);
  assert.deepEqual(marqueeHits({ x: 113, y: 0, width: 5, height: 5 }, cards), []);
});

test("Add several: with three assets selected, \"+\" on one of them adds all three in displayed order", () => {
  const displayed = ["a1", "a2", "a3", "a4"];
  assert.deepEqual(addTargets({ ids: ["a4", "a1", "a3"], anchor: "a4" }, "a3", displayed), ["a1", "a3", "a4"]);
  assert.deepEqual(addTargets({ ids: ["a4", "a1"], anchor: "a4" }, "a2", displayed), ["a2"]);
});

test("Reveal: on a clip whose asset is in another folder while a search is active, the search is cleared, the folder opened and the asset selected and highlighted", () => {
  const s = session(place(project([asset("a1", "video", { name: "Interview.mp4" }), asset("a2", "image")]), "main", [videoClip("e1", "a1")]));
  const folder = createFolderCommand(s.document, s.context(), "Rushes"); s.commit(folder);
  s.commit(moveToFolderCommand(s.document, s.context(), { assetIds: ["a1"] }, folder.folderId));
  const current = view({ query: "png", filters: { ...NO_FILTERS, types: ["image"] } });
  const result = revealAsset(s.document, current, "a1", NOW);
  assert.ok(result.found);
  assert.deepEqual(result.view, { folderId: folder.folderId, query: "", filters: NO_FILTERS, sort: DEFAULT_SORT });
  assert.deepEqual(result.selection, { ids: ["a1"], anchor: "a1" });
  assert.deepEqual(result.highlight, { assetId: "a1", until_ms: NOW + 2000 });
  assert.equal(result.scrollTo, "a1");
  // A filter that does not hide it is kept.
  const kept = revealAsset(s.document, view({ filters: { ...NO_FILTERS, types: ["video"] } }), "a1", NOW);
  assert.ok(kept.found && kept.view.filters.types.length === 1);
});

test("Asset gone: reveal-media with the id of a removed asset shows \"Media not found in this project\" and changes nothing", () => {
  const doc = project([asset("a1", "video")]);
  assert.deepEqual(revealAsset(doc, view({ query: "x" }), "removed", NOW), { found: false, toast: "Media not found in this project" });
  assert.equal(message("media.not-found").text, "Media not found in this project");
});

test("Usage count: an asset used by 2 clips in the main scene and 1 clip in another scene has the badge 3", () => {
  const doc = addScene(project([asset("a1", "video"), asset("a2", "image")]), "s2");
  place(doc, "main", [videoClip("e1", "a1"), videoClip("e2", "a1", 4)]);
  place(doc, "main", [videoClip("e3", "a1", 1)], 1);
  assert.equal(usageCounts(doc).get("a1"), 3);
  // No badge when 0.
  assert.equal(usageCounts(doc).has("a2"), false);
  assert.deepEqual(listLibrary(doc, view()).rows.map((row) => row.usage), [3, 0]);
  // "Select clips in timeline": the referencing elements of the active scene and the earliest of them.
  assert.deepEqual(clipsUsingAsset(doc, "s1", "a1"), { elementIds: ["e1", "e2"], earliestStart: 0 });
  assert.deepEqual(clipsUsingAsset(doc, "s2", "a1"), { elementIds: ["e3"], earliestStart: SECOND });
});

test("Rename propagates to default-named clips: the asset and the clip that carried its name are renamed; a clip the user renamed keeps its name", () => {
  const s = session(place(project([asset("a1", "video", { name: "IMG_0042.mov" })]), "main", [videoClip("e1", "a1", 0, 2, { name: "IMG_0042.mov" }), videoClip("e2", "a1", 2, 2, { name: "Intro" })]));
  s.commit(renameAssetCommand(s.document, s.context(), "a1", "  Interview A ")!);
  const clipNames = () => s.document.scenes[0].tracks.main.elements.map((element) => element.name);
  assert.equal(s.document.media.assets[0].name, "Interview A");
  assert.deepEqual(clipNames(), ["Interview A", "Intro"]);
  // Empty input reverts; rename is one undoable step.
  assert.equal(renameAssetCommand(s.document, s.context(), "a1", "   "), null);
  s.undo();
  assert.equal(s.document.media.assets[0].name, "IMG_0042.mov");
  assert.deepEqual(clipNames(), ["IMG_0042.mov", "Intro"]);
});

test("Info for an image: the panel shows resolution and file size and omits frame rate, duration and audio fields", () => {
  const image = infoFields(asset("a1", "image"));
  assert.ok(image.includes("resolution") && image.includes("fileSize"));
  for (const field of ["frameRate", "duration", "sampleRate", "channels", "proxy"]) assert.ok(!image.includes(field), field);
  const video = infoFields(asset("a2", "video"), { sampleRate: 48000, channels: 2 });
  for (const field of ["name", "type", "container", "codecs", "resolution", "frameRate", "duration", "sampleRate", "channels", "fileSize", "dateAdded", "storage", "proxy", "usage", "contentHash", "tags", "provenance"]) assert.ok(video.includes(field), field);
  assert.ok(!infoFields(asset("a3", "audio"), { sampleRate: 44100, channels: 1 }).includes("resolution"));
  assert.equal(shortHash(HASH("ab").slice(0, 64)), "abababababab");
});

test("Tag limit: an asset with 20 tags accepts no further tag and shows \"Up to 20 tags\"", () => {
  const twenty = Array.from({ length: 20 }, (_, index) => `tag-${index}`);
  assert.deepEqual(addTag(twenty, "one more"), { ok: false, reason: "limit", message: "Up to 20 tags" });
  assert.deepEqual(addTag(["a"], " B "), { ok: true, tags: ["a", "B"] });
  assert.equal(addTag(["a"], "A").ok, false);
  assert.equal(addTag([], "x".repeat(33)).ok, false);
  assert.equal(addTag([], "  ").ok, false);
  const s = session(project([asset("a1", "video")]));
  s.commit(setAssetTagsCommand(s.document, s.context(), "a1", twenty));
  assert.equal(s.document.media.assets[0].tags.length, 20);
  assert.throws(() => setAssetTagsCommand(s.document, s.context(), "a1", [...twenty, "extra"]), /Up to 20 tags/);
  s.undo();
  assert.deepEqual(s.document.media.assets[0].tags, []);
});

test("Cascade and undo: deleting an asset used by 3 clips removes them; undo brings the asset and the 3 clips back at their original positions", () => {
  const s = session(place(place(project([asset("a1", "video"), asset("a2", "image")]), "main", [videoClip("e1", "a1"), imageClip("e2", "a2", 2), videoClip("e3", "a1", 4)]), "overlay", [videoClip("e4", "a1", 1)]));
  const folder = createFolderCommand(s.document, s.context(), "Keep"); s.commit(folder);
  s.commit(moveToFolderCommand(s.document, s.context(), { assetIds: ["a1"] }, folder.folderId));
  const before = canonicalize({ ...s.document, metadata: undefined });
  const impact = removalImpact(s.document, ["a1"]);
  assert.deepEqual([impact.assets, impact.clips], [1, 3]);
  assert.equal(impact.confirmation, "1 asset is used by 3 clips. Deleting them also removes those clips.");
  assert.equal(removalImpact(s.document, ["a1", "a2"]).confirmation, "2 assets are used by 4 clips. Deleting them also removes those clips.");
  s.commit(removeAssetsCommand(s.document, s.context(), ["a1"]));
  assert.deepEqual(s.document.media.assets.map((entry) => entry.id), ["a2"]);
  assert.deepEqual(s.document.scenes[0].tracks.main.elements.map((element) => element.id), ["e2"]);
  assert.equal(s.document.scenes[0].tracks.overlay[0].elements.length, 0);
  s.undo();
  assert.equal(canonicalize({ ...s.document, metadata: undefined }), before);
  assert.equal(s.document.media.assets.find((entry) => entry.id === "a1")!.folderId, folder.folderId);
});

test("Unused asset: deleting an unused asset needs no confirmation and removes it", () => {
  const s = session(project([asset("a1", "video"), asset("a2", "image")]));
  assert.equal(removalImpact(s.document, ["a2"]).confirmation, null);
  s.commit(removeAssetsCommand(s.document, s.context(), ["a2"]));
  assert.deepEqual(s.document.media.assets.map((entry) => entry.id), ["a1"]);
});

test("Generated image arrives: it appears in \"AI generated\" with the AI badge and its provenance", () => {
  const s = session(project());
  const added = importAssetCommand(s.document, s.context(), { name: "fox.png", type: "image", size: 10, width: 1024, height: 1024, contentHash: HASH("a"), provenance: provenance.ai({ provider: "acme", model: "img-2", role: "image", jobId: "job-9", prompt: "a red fox", seed: 7 }) });
  s.commit(added);
  const folder = s.document.media.folders.find((entry) => entry.kind === "ai-generated")!;
  assert.equal(folder.name, "AI generated");
  const generated = s.document.media.assets[0];
  assert.equal(generated.folderId, folder.id);
  assert.deepEqual(sourceBadges(generated), ["AI"]);
  assert.equal(sourceFilterOf(generated), "ai");
  assert.deepEqual([generated.provenance.provider, generated.provenance.model, generated.provenance.prompt], ["acme", "img-2", "a red fox"]);
  // A second generated asset reuses the one automatic folder.
  s.commit(importAssetCommand(s.document, s.context(), { name: "owl.png", type: "image", size: 10, contentHash: HASH("b"), provenance: provenance.ai({ provider: "acme", model: "img-2", role: "image", jobId: "job-10" }) }));
  assert.equal(s.document.media.folders.filter((entry) => entry.kind === "ai-generated").length, 1);
});

test("Provenance survives package round trip: the provenance fields are unchanged after the document is serialised and read again", () => {
  const s = session(project());
  const fields = provenance.ai({ provider: "acme", model: "vid-1", role: "video", jobId: "j1", prompt: "city at night", negativePrompt: "blur", seed: 42, referenceAssetIds: [], cost: { amount: 0.12, currency: "USD" }, created_ms: NOW });
  s.commit(importAssetCommand(s.document, s.context(), { name: "city.mp4", type: "video", size: 10, contentHash: HASH("c"), provenance: fields }));
  const before = s.document.media.assets[0].provenance;
  const { local: _local, ...canonical } = s.document as ProjectDocument & { local?: unknown };
  const restored = projectDocumentSchema.parse(JSON.parse(canonicalize(canonical)));
  assert.deepEqual(restored.media.assets[0].provenance, before);
  assert.deepEqual({ ...restored.media.assets[0].provenance, attributionRequired: undefined }, { ...fields, attributionRequired: undefined });
});

test("Draft timeline creates slates offline: slate assets live in the \"Slates\" folder, carry the Slate badge and are kept out of clean-up while their script is linked", () => {
  const s = session(project());
  for (let shot = 1; shot <= 12; shot++) {
    s.commit(importAssetCommand(s.document, s.context(), { name: `Shot ${shot}.png`, type: "image", kind: "slate", size: 10, width: 1920, height: 1080, contentHash: HASH(shot.toString(16)), provenance: provenance.slate({ scriptId: "script-1", sceneId: "scene-1", shotId: `shot-${shot}`, versionId: "v1" }) }));
  }
  const folder = s.document.media.folders.find((entry) => entry.kind === "slates")!;
  assert.equal(folder.name, "Slates");
  assert.equal(s.document.media.assets.filter((entry) => entry.kind === "slate" && entry.folderId === folder.id).length, 12);
  assert.deepEqual(sourceBadges(s.document.media.assets[0]), ["Slate"]);
  assert.equal(names(s.document, view({ filters: { ...NO_FILTERS, sources: ["slate"] } })).length, 12);
  // Usage count 0 after a replace: the slate stays in the library, and is not suggested for clean-up while the script link exists.
  const linked = { ...s.document, scriptLinks: [{ scriptId: "script-1" }] } as ProjectDocument;
  assert.equal(cleanupSuggestions(linked).length, 0);
  assert.equal(cleanupSuggestions(s.document).length, 12);
  assert.equal(message("media.slates-in-export", { n: 3 }).text, "3 placeholder shots are still in the timeline");
});

test("Libraries are separate: a file imported into project A is not listed in project B", () => {
  const a = session(project()), b = session(project());
  a.commit(importAssetCommand(a.document, a.context(), { name: "only-a.mp4", type: "video", size: 10, contentHash: HASH("a") }));
  assert.deepEqual(names(a.document, view()), ["only-a.mp4"]);
  assert.deepEqual(names(b.document, view()), []);
  // Deleting the asset in one project never touches the other project's record of the same bytes.
  b.commit(importAssetCommand(b.document, b.context(), { name: "only-a.mp4", type: "video", size: 10, contentHash: HASH("a") }));
  a.commit(removeAssetsCommand(a.document, a.context(), [a.document.media.assets[0].id]));
  assert.equal(b.document.media.assets.length, 1);
});

test("audio clips count as usage and device-local changes create no undo step and no patch", () => {
  const s = session(place(project([asset("a3", "audio")]), "audio", [audioClip("e1", "a3")]));
  assert.equal(usageCounts(s.document).get("a3"), 1);
  const before = canonicalize({ ...s.document, local: undefined });
  s.setDocument(setLocalAsset(s.document, "a3", { canDecode: true, proxy: { state: "queued" } }));
  assert.equal(canonicalize({ ...s.document, local: undefined }), before);
  assert.equal(s.undo(), false);
  assert.equal((s.document as unknown as { local: { media: Record<string, { canDecode: boolean }> } }).local.media.a3.canDecode, true);
});

test("An empty template slot is not an offline file: the slate \"Edit in full editor\" gives a slot has no file anywhere, so it carries no Offline status and the Offline filter leaves it out; a file that is not on the device does", () => {
  const { contentHash: _hash, ...slot } = asset("s1", "image", { name: "Slot 1", kind: "slate", size: 0, provenance: { source: "bundled" } }) as ReturnType<typeof asset> & { contentHash?: string };
  const doc = project([slot as never, asset("p1", "image", { name: "lantern.jpg" })]);
  assert.equal(isEmptySlot(doc.media.assets.find((entry) => entry.id === "s1")!), true);
  assert.equal(isEmptySlot(doc.media.assets.find((entry) => entry.id === "p1")!), false);
  const rows = Object.fromEntries(listLibrary(doc, view()).rows.map((row) => [row.asset.name, row.statuses]));
  assert.deepEqual(rows, { "Slot 1": [], "lantern.jpg": ["offline"] });
  assert.deepEqual(names(doc, view({ filters: { ...NO_FILTERS, statuses: ["offline"] } })), ["lantern.jpg"]);
  assert.deepEqual(doc.media.assets.filter((entry) => isOfflineFile(entry, undefined)).map((entry) => entry.name), ["lantern.jpg"]);
});
