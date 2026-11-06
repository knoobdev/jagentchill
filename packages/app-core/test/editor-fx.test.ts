import assert from "node:assert/strict";
import { test } from "node:test";
import { timeline } from "@jagentchill/editor-core";
import { TICKS_PER_SECOND as S } from "@jagentchill/protocol";
import { project } from "../../editor-core/test/support/timeline.ts";
import {
  FX_CATEGORY, FX_PREVIEW, FX_SAMPLES, FX_SCENE_ID, fxCategories, fxDefaultCategory, fxEmptyText, fxGridColumns, fxStillSize, fxTiles, gridMove, optionLabel, paramLabel, transitionLoop, withCatalogueScene,
} from "../src/index.ts";

const library = timeline.emptyLibraryState();

test("Effects and filters panels — Category filter; Bundled effect library: Every bundled effect is present offline; Bundled filter library: All filters listed by category", () => {
  assert.deepEqual(fxCategories("effect"), ["All", "Favourites", "Recent", "My presets", "Blur", "Distort", "Stylise", "Light", "Glitch", "Retro", "Particles", "Lens", "Photo", "Body", "AI styles"]);
  assert.deepEqual(fxCategories("filter"), ["All", "Favourites", "Recent", "My presets", "Film", "Portrait", "Landscape", "Food", "Night", "Retro", "Mono", "Style"]);
  assert.equal(fxTiles("effect", { category: "All", library }).length, 61);
  assert.deepEqual(fxTiles("effect", { category: "Glitch", library }).map((tile) => tile.name), ["RGB Split", "Block Glitch", "Scanline Jitter", "Signal Loss", "Pixel Sort"]);
  assert.deepEqual(["Blur", "Distort", "Stylise", "Light", "Glitch", "Retro", "Particles", "Lens", "Photo", "Body"].map((category) => fxTiles("effect", { category, library }).length), [7, 9, 9, 6, 5, 6, 6, 5, 3, 5]);
  assert.equal(fxTiles("filter", { category: "All", library }).length, 39);
  assert.equal(fxCategories("filter").slice(4).reduce((sum, category) => sum + fxTiles("filter", { category, library }).length, 0), 39);
  // Body tiles are the ones that need the person matte; time-driven tiles are the ones a hover animates.
  assert.equal(fxTiles("effect", { category: "Body", library }).every((tile) => tile.body), true);
  assert.equal(fxTiles("effect", { category: "All", library }).find((tile) => tile.type === "snow")?.timeDriven, true);
  assert.equal(fxTiles("effect", { category: "All", library }).find((tile) => tile.type === "blur")?.timeDriven, false);
  // The AI styles category is an entry point: it lists no library tile.
  assert.deepEqual(fxTiles("effect", { category: FX_CATEGORY.ai, library }), []);
});

test("Transition library panel — Tab is functional; Bundled transition library: Library is complete offline", () => {
  assert.deepEqual(fxCategories("transition").slice(0, 4), ["Featured", "Favourites", "Recent", "My presets"]);
  assert.equal(fxDefaultCategory("transition"), "Featured");
  assert.equal(fxTiles("transition", { category: "Featured", library }).length, 10);
  const tiles = fxCategories("transition").slice(4).flatMap((category) => fxTiles("transition", { category, library }));
  // 55 since Domain Warp, Chromatic Split and Light Leak (w22c).
  assert.equal(new Set(tiles.map((tile) => tile.type)).size, 55);
  assert.equal(tiles.every((tile) => tile.timeDriven && tile.available), true, "every transition tile plays on hover");
});

test("Search effects and filters — Keyword match; No results; Search transitions — Search by keyword; No results", () => {
  assert.equal(fxTiles("effect", { category: "Glitch", query: "defocus", library }).some((tile) => tile.name === "Gaussian Blur"), true, "a search runs across every category");
  assert.deepEqual(fxTiles("effect", { category: "All", query: "zzzz", library }), []);
  const wipe = fxTiles("transition", { category: "Featured", query: "WIPE", library }).map((tile) => tile.name);
  assert.ok(wipe.includes("Linear Wipe") && wipe.includes("Clock Wipe"), wipe.join());
  assert.deepEqual(fxTiles("transition", { category: "Basic", query: "qqq", library }), []);
  // The localised name matches too, without diacritics.
  assert.deepEqual(fxTiles("filter", { category: "All", query: "NAU", library, localise: (name) => (name === "Sepia" ? "Nâu đỏ" : name) }).map((tile) => tile.type), ["sepia"]);
});

test("Favourites and recents — Favourite persists across restart; Recent list is capped; Effect and filter presets — Save and apply; Transition presets — Save and apply", () => {
  let state = timeline.toggleFavourite(library, "effect", "vhs").state;
  state = timeline.toggleFavourite(state, "effect", "glow").state;
  assert.deepEqual(fxTiles("effect", { category: FX_CATEGORY.favourites, library: state }).map((tile) => tile.name), ["VHS Tape", "Glow"], "in the order they were added");
  for (const tile of fxTiles("effect", { category: "All", library }).slice(0, 21)) state = timeline.pushRecent(state, "effect", tile.type);
  const recent = fxTiles("effect", { category: FX_CATEGORY.recent, library: state });
  assert.equal(recent.length, 20);
  assert.equal(recent.some((tile) => tile.type === "blur"), false, "the first-applied effect is no longer listed");
  assert.equal(fxEmptyText(FX_CATEGORY.favourites), "Star an effect to keep it here");
  assert.equal(fxEmptyText(FX_CATEGORY.recent), "Effects you apply appear here");
  // A preset is a tile of its base definition carrying its own params; one of an unregistered type is listed unavailable.
  const effectPresets: timeline.EffectPreset[] = [{ name: "Soft bloom", type: "glow", kind: "effect", params: { intensity: 80, radius: 55 } }, { name: "Gone", type: "vendor-x", kind: "effect", params: {} }, { name: "Warm", type: "sepia", kind: "filter", params: { intensity: 60 } }];
  const presets = fxTiles("effect", { category: FX_CATEGORY.presets, library, effectPresets });
  assert.deepEqual(presets.map((tile) => [tile.name, tile.type, tile.available, tile.params?.intensity]), [["Soft bloom", "glow", true, 80], ["Gone", "vendor-x", false, undefined]]);
  assert.deepEqual(fxTiles("filter", { category: FX_CATEGORY.presets, library, effectPresets }).map((tile) => tile.preset), ["Warm"]);
  const transitionPresets: timeline.TransitionPreset[] = [{ name: "Soft drop", type: "linear-wipe", params: { angle: 90, softness: 40 }, easing: "linear", duration: 0.8 * S, audioCrossfade: true, shape: "equal-power" }];
  assert.deepEqual(fxTiles("transition", { category: FX_CATEGORY.presets, library, transitionPresets }).map((tile) => [tile.preset, tile.type, tile.params?.angle]), [["Soft drop", "linear-wipe", 90]]);
});

test("Effects and filters panels — the grid is keyboard navigable; parameter and option labels", () => {
  assert.equal(fxGridColumns(432 - 64, 96, 12, 12), 3, "three 96 px tiles fit the panel of the frame");
  assert.equal(fxGridColumns(296 - 64, 96, 12, 12), 2);
  assert.equal(fxGridColumns(40, 96, 12, 12), 1);
  assert.deepEqual([gridMove(0, "ArrowRight", 3, 8), gridMove(0, "ArrowDown", 3, 8), gridMove(4, "ArrowUp", 3, 8), gridMove(0, "ArrowLeft", 3, 8), gridMove(7, "ArrowDown", 3, 8), gridMove(5, "Home", 3, 8), gridMove(2, "End", 3, 8)], [1, 3, 1, 0, 7, 0, 7]);
  assert.deepEqual(["intensity", "centerX", "blockSize", "twinkleSpeed", "colorA"].map(paramLabel), ["Intensity", "Center X", "Block size", "Twinkle speed", "Color A"]);
  assert.deepEqual(["left-to-right", "counter-clockwise", "cmyk"].map(optionLabel), ["Left to right", "Counter clockwise", "Cmyk"]);
});

test("Transition inspector — the preview loops the cut from 1 s before to 1 s after", () => {
  assert.deepEqual(transitionLoop(4 * S, 8 * S), { start: 3 * S, end: 5 * S });
  assert.deepEqual(transitionLoop(S / 2, 8 * S), { start: 0, end: 1.5 * S }, "inside the scene");
  assert.deepEqual(transitionLoop(7.5 * S, 8 * S), { start: 6.5 * S, end: 8 * S });
});

test("Effects and filters panels — thumbnails are rendered by the engine from the bundled samples; Transition library panel — tiles render the transition between the frames A and B", () => {
  const doc = project();
  const { document, slots } = withCatalogueScene(doc, [
    { key: "blur", kind: "effect", type: "blur", animated: false },
    { key: "snow", kind: "effect", type: "snow", animated: true },
    { key: "sepia", kind: "filter", type: "sepia", params: { intensity: 60 }, animated: false },
    { key: "wipe", kind: "transition", type: "linear-wipe", animated: false },
    { key: "push", kind: "transition", type: "push", animated: true },
  ]);
  // The project's own scenes and assets are untouched; one scene and the three samples are added.
  assert.equal(document.scenes.length, doc.scenes.length + 1);
  assert.deepEqual(document.scenes.slice(0, doc.scenes.length), doc.scenes);
  assert.deepEqual(document.media.assets.slice(doc.media.assets.length).map((asset) => asset.id), [FX_SAMPLES.effect.id, FX_SAMPLES.a.id, FX_SAMPLES.b.id]);
  const scene = document.scenes[document.scenes.length - 1] as unknown as { id: string; isMain: boolean; tracks: { main: { elements: { id: string; mediaId: string; startTime: number; duration: number; effects: timeline.StackEntry[]; transform: { scale: { x: number } } }[]; transitions: timeline.PictureTransition[] } } };
  assert.deepEqual([scene.id, scene.isMain], [FX_SCENE_ID, false]);
  const { elements, transitions } = scene.tracks.main;
  // An effect or filter is one entry on the sample picture, at its defaults unless the request says otherwise.
  assert.deepEqual(elements[0].effects.map((entry) => [entry.type, entry.kind, entry.params.intensity]), [["blur", "effect", 15]]);
  assert.deepEqual(elements[2].effects.map((entry) => [entry.type, entry.kind, entry.params.intensity]), [["sepia", "filter", 60]]);
  assert.equal(elements[0].mediaId, FX_SAMPLES.effect.id);
  assert.equal(elements[0].transform.scale.x, 1, "the sample is fitted inside the canvas, so the whole effect frame shows");
  // A transition joins A and B, edge to edge, at the default duration; both cover the canvas.
  const [wipe] = transitions;
  const a = elements.find((element) => element.id === wipe.fromElementId)!, b = elements.find((element) => element.id === wipe.toElementId)!;
  assert.deepEqual([a.mediaId, b.mediaId, a.startTime + a.duration === b.startTime, wipe.type, wipe.duration], [FX_SAMPLES.a.id, FX_SAMPLES.b.id, true, "linear-wipe", 0.5 * S]);
  assert.ok(a.transform.scale.x > 1, "A is scaled to cover a 16:9 canvas");
  assert.deepEqual(wipe.params, { angle: 0, softness: 10 });
  // A still is one frame: the midpoint of a transition. An animation is the frames of 2 s of an effect, or of the window from A to B.
  assert.deepEqual(slots.map((slot) => slot.times.length), [1, FX_PREVIEW.effectFrames, 1, 1, FX_PREVIEW.transitionFrames + 1]);
  const window = timeline.transitionWindow(b.startTime, wipe.duration, doc.settings.fps);
  assert.equal(slots[3].times[0], window.start + wipe.duration / 2);
  const push = slots[4].times;
  assert.ok(push[0] < push[push.length - 1] && push.every((time, index) => index === 0 || time > push[index - 1]), "in time order, from the outgoing picture to the incoming one");
  // Slots do not overlap.
  assert.ok(elements.every((element, index) => index === 0 || element.startTime >= elements[index - 1].startTime + elements[index - 1].duration));
  // The size a tile is rendered at keeps the canvas shape.
  assert.deepEqual(fxStillSize({ width: 1920, height: 1080 }, 96), { width: 341, height: 192 });
  assert.deepEqual(fxStillSize({ width: 1080, height: 1920 }, 96), { width: 192, height: 341 });
});
