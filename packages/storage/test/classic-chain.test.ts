// Fakes declared: `fake-indexeddb` and the in-memory Origin Private File System of `support/platforms.ts` stand in for the browser stores OpenCut classic writes to (neither exists in a Node test process). The classic records are written by `support/classic-store.ts`, a reproduction of classic's own writers; the v1-era shapes are those of classic's own fixtures of that era, since its v1 writer no longer exists at the pinned commit.
import assert from "node:assert/strict";
import { test } from "node:test";
import { isFrameAligned, validateProjectDocument } from "@jagentchill/editor-core";
import { classic } from "../../editor-core/test/support/classic.ts";
import { CLASSIC_CHAIN, classicOriginSource, detectVersion, MIGRATION_CHAIN, migrateRecord, type MigrationContext } from "../src/index.ts";
import { classicSaveLegacyTimeline, classicSaveMediaAsset, classicSaveProject, classicSaveRawProject, type ClassicRuntimeProject } from "./support/classic-store.ts";
import { fakeBrowser } from "./support/platforms.ts";

const NOW = 1_800_000_000_000;
const ids = () => { let count = 0; return () => `gen-${++count}`; };
const context = (over: Partial<MigrationContext> = {}): MigrationContext => ({ now_ms: NOW, newId: ids(), mediaRecords: [], ...over });
/** One step of the chain, applied to a fixture of its source version. */
const step = (from: number, project: Record<string, unknown>, over: Partial<MigrationContext> = {}) => {
  const found = CLASSIC_CHAIN.find((candidate) => candidate.from === from)!;
  const result = found.run({ id: "p", version: from, ...project }, context(over));
  assert.equal(result.skipped ?? false, false, `${found.name} ran`);
  assert.equal(result.record.version, from + 1, `${found.name} sets the version`);
  return result.record as any;
};
/** A project of the flat-tracks era (v2 … v23) holding the given elements on one track. */
const flat = (elements: unknown[], track: Record<string, unknown> = {}, project: Record<string, unknown> = {}) => ({
  metadata: { id: "p", name: "P", createdAt: "2024-06-01T10:00:00.000Z", updatedAt: "2024-06-01T10:00:00.000Z" },
  settings: { fps: 30, canvasSize: { width: 1920, height: 1080 }, background: { type: "color", color: "#000000" } },
  scenes: [{ id: "s", name: "Main scene", isMain: true, bookmarks: [], tracks: [{ id: "t", type: "video", name: "Video Track", isMain: true, elements, ...track }] }],
  ...project,
});
/** A project of the zoned-tracks era (v24 … v31). */
const zoned = (elements: unknown[], project: Record<string, unknown> = {}) => ({
  ...flat([], {}, project),
  scenes: [{ id: "s", name: "Main scene", isMain: true, bookmarks: [], tracks: { overlay: [], audio: [], main: { id: "t", type: "video", name: "Main", elements } } }],
});
const first = (record: any) => (Array.isArray(record.scenes[0].tracks) ? record.scenes[0].tracks[0] : record.scenes[0].tracks.main).elements[0];

/** A v1-era project as it lies in the classic stores: flat project fields, and the timeline in its own legacy database. */
async function v1Origin() {
  const browser = fakeBrowser();
  await classicSaveRawProject(browser, "project-v1", {
    version: 1, name: "My V1 Project", createdAt: "2024-01-15T10:00:00.000Z", updatedAt: "2024-01-15T12:00:00.000Z", fps: 30, canvasSize: { width: 1920, height: 1080 },
    backgroundColor: "#1a1a1a", backgroundType: "color", currentSceneId: "scene-main", bookmarks: [2.0, 4.5, 7.0],
    scenes: [{ id: "scene-main", name: "Main scene", isMain: true, tracks: [], bookmarks: [], createdAt: "2024-01-15T10:00:00.000Z", updatedAt: "2024-01-15T12:00:00.000Z" }],
  });
  await classicSaveLegacyTimeline(browser, "project-v1", "scene-main", [
    { id: "legacy-media", type: "media", name: "Media", elements: [{ id: "clip-1", name: "Clip", type: "media", mediaId: "media-1", duration: 4.37, startTime: 0, trimStart: 0.5, trimEnd: 0 }] },
    { id: "legacy-text", type: "text", name: "Text", elements: [{ id: "title-1", name: "Title", type: "text", content: "Hello", x: 120, y: 240, rotation: 15, opacity: 0.5, fontSize: 48, fontFamily: "Inter", color: "#ffffff", backgroundColor: "#202020", textAlign: "center", fontWeight: "bold", fontStyle: "normal", textDecoration: "none", duration: 3, startTime: 1.01, trimStart: 0, trimEnd: 0 }] },
    { id: "legacy-audio", type: "audio", name: "Audio", elements: [{ id: "song-1", name: "Song", type: "audio", mediaId: "media-2", duration: 6.123, startTime: 0.2, trimStart: 0, trimEnd: 0, volume: 0.5 }] },
  ]);
  await classicSaveMediaAsset(browser, "project-v1", { id: "media-1", name: "clip.mp4", type: "video", bytes: new Uint8Array(64).fill(7), lastModified: 1_700_000_000_000, width: 1920, height: 1080, duration: 12.5 });
  await classicSaveMediaAsset(browser, "project-v1", { id: "media-2", name: "song.mp3", type: "audio", bytes: new Uint8Array(32).fill(9), lastModified: 1_700_000_000_000, duration: 30 });
  return browser;
}

// Requirement: Migration chain
test("Migration chain — Scenario: Full chain from v1", async () => {
  const source = classicOriginSource(await v1Origin());
  const [record] = await source.projects();
  assert.equal(record.id, "project-v1", "classic's adapter stores the key in the record");
  assert.equal(detectVersion(record), 1);
  const mediaRecords = await source.mediaRecords("project-v1");
  assert.deepEqual(mediaRecords.map((media) => [media.id, media.type, media.size]), [["media-1", "video", 64], ["media-2", "audio", 32]]);
  const legacyTracksBySceneId = { "scene-main": (await source.legacyTimeline("project-v1", "scene-main"))! };
  const migrated = migrateRecord(record, context({ mediaRecords, legacyTracksBySceneId }));
  assert.deepEqual([migrated.from, migrated.to, migrated.skipped], [1, 33, false]);
  const document = migrated.record as any;
  assert.equal(validateProjectDocument(document, { mode: "strict" }).ok, true, "the result validates against the current schema");
  const tracks = document.scenes[0].tracks;
  assert.deepEqual(Object.keys(tracks).sort(), ["audio", "main", "overlay"], "its tracks have the {overlay, main, audio} shape");
  const all = [...tracks.overlay, tracks.main, ...tracks.audio];
  const text = all.find((track: any) => track.elements.some((element: any) => element.id === "title-1"));
  assert.equal(text.type, "text", "the legacy text track is a typed text track");
  const title = text.elements[0];
  assert.deepEqual([title.type, title.content, title.fontWeight, title.opacity, title.transform.position, title.transform.rotation], ["text", "Hello", 700, 0.5, { x: 120, y: 240 }, 15]);
  assert.deepEqual([title.background.enabled, title.background.color], [false, "#202020"], "classic stored the legacy colour with the background switched off");
  // All times are integer ticks, and the timeline times lie on the 30 fps frame grid (4 000 ticks).
  const fps = document.settings.fps;
  for (const track of all) for (const element of track.elements) {
    for (const key of ["startTime", "duration", "trimStart", "trimEnd"]) assert.ok(Number.isInteger(element[key]) && element[key] >= 0, `${element.id}.${key} = ${element[key]}`);
    assert.ok(isFrameAligned(element.startTime, fps) && isFrameAligned(element.duration, fps), `${element.id} is on the frame grid`);
  }
  const clip = tracks.main.elements.find((element: any) => element.id === "clip-1");
  assert.deepEqual([clip.type, clip.mediaId, clip.trimStart, clip.duration], ["video", "media-1", 60_000, 524_000], "a media element of a video asset is a video element; 4.37 s is 131 frames");
  const song = tracks.audio[0].elements[0];
  assert.deepEqual([song.type, song.sourceType, song.volume], ["audio", "upload", 0], "a legacy audio element is a typed upload audio element at unity gain (classic v1→v2), which is 0 dB after v17→v18");
  assert.deepEqual(document.scenes[0].markers.map((marker: any) => marker.time), [240_000, 540_000, 840_000], "the legacy project bookmarks are markers of the main scene");
  assert.deepEqual([document.metadata.name, document.metadata.created_ms, document.settings.background], ["My V1 Project", Date.parse("2024-01-15T10:00:00.000Z"), { kind: "color", color: "#1a1a1a" }]);
  assert.deepEqual(document.media.assets.map((asset: any) => asset.id), ["media-1", "media-2"]);
  // The classic stores were only read.
  assert.equal((await source.projects())[0].version, 1);
});

test("Migration chain — Scenario: Volume conversion", () => {
  const migrated = step(17, flat([{ id: "a", type: "audio", volume: 0.5 }, { id: "b", type: "video" }, { id: "c", type: "audio", volume: 0 }, { id: "d", type: "video", volume: 100 }]));
  const [a, b, c, d] = migrated.scenes[0].tracks[0].elements;
  assert.ok(Math.abs(a.volume - -6.02) <= 0.01, `−6.02 dB (±0.01), got ${a.volume}`);
  assert.deepEqual([b.volume, c.volume, d.volume], [0, -60, 20], "missing → 0 dB; clamped to −60…+20");
});

test("Migration chain — Scenario: Unknown sticker id", () => {
  const stickers = [{ id: "s1", type: "sticker", stickerId: "mystery-thing" }, { id: "s2", type: "sticker", stickerId: "emoji:1f600" }, { id: "s3", type: "sticker", stickerId: "thumbs-up" }, { id: "s4", type: "sticker", iconName: "JP", color: "#fff" }];
  const catalogue = (id: string) => ({ "thumbs-up": "emoji", JP: "flags" } as Record<string, string>)[id] ?? null;
  const migrated = step(4, flat(stickers, { type: "sticker" }), { stickerProviderOf: catalogue });
  assert.deepEqual(migrated.scenes[0].tracks[0].elements.map((element: any) => element.stickerId), ["mystery-thing", "emoji:1f600", "emoji:thumbs-up", "flags:JP"], "an id in no catalogue is unchanged; a known prefix is kept; the others get the provider whose catalogue holds them");
  assert.equal("iconName" in migrated.scenes[0].tracks[0].elements[3], false);
  // The migration of the project succeeds all the way.
  const whole = migrateRecord({ id: "p", version: 4, ...flat([{ id: "s1", type: "sticker", name: "S", stickerId: "mystery-thing", startTime: 0, duration: 2, trimStart: 0, trimEnd: 0, transform: { scale: 1, position: { x: 0, y: 0 }, rotate: 0 }, opacity: 1 }], { type: "sticker", isMain: false }) }, context());
  assert.deepEqual([whole.to, whole.skipped, validateProjectDocument(whole.record, { mode: "strict" }).ok], [33, false, true], "the migration of the project succeeds");
  // Schema 32 addresses a sticker as `provider:id`, so the v31→v32 step cannot carry the un-prefixed id: the element is
  // listed in the migration report (and kept, with its id, in the pre-migration backup).
  assert.deepEqual(whole.report.filter((entry) => entry.reason === "removed-element").map((entry) => entry.path), ["/scenes/@s/tracks/overlay/@t/elements/@s1"]);
});

test("Migration chain — Scenario: Blur background at v20", () => {
  const blur = (background: Record<string, unknown>) => step(20, flat([], {}, { settings: { fps: 30, canvasSize: { width: 1920, height: 1080 }, background } })).settings.background;
  assert.deepEqual([blur({ type: "blur", blurIntensity: 10 }).blurIntensity, blur({ type: "blur" }).blurIntensity, blur({ type: "blur", blurIntensity: NaN }).blurIntensity], [50, 50, 50], "10 × 5; the unscaled default; the unscaled default");
  assert.deepEqual(blur({ type: "color", color: "#123456" }), { type: "color", color: "#123456" }, "a colour background is unchanged by that step");
});

// One unit test per step, on a fixture of its source version.
test("Migration chain v0→v1: adds scenes with one \"Main scene\" and currentSceneId", () => {
  const record = CLASSIC_CHAIN[0].run({ id: "p0", name: "Old", createdAt: "2023-01-01T00:00:00.000Z" }, context()).record as any;
  assert.deepEqual([record.version, record.scenes.length, record.scenes[0].name, record.scenes[0].isMain, record.currentSceneId], [1, 1, "Main scene", true, record.scenes[0].id]);
  assert.equal(record.scenes[0].createdAt, new Date(NOW).toISOString(), "the time comes from the migration context");
});
test("Migration chain v1→v2: metadata and settings from flat fields with the era defaults; media tracks become video tracks", () => {
  const found = CLASSIC_CHAIN[1];
  const bare = found.run({ id: "p", version: 1, scenes: [{ id: "s", name: "Main scene", isMain: true, tracks: [], bookmarks: [] }], backgroundType: "blur" }, context()).record as any;
  assert.deepEqual([bare.version, bare.metadata.id, bare.settings.fps, bare.settings.canvasSize, bare.settings.background], [2, "p", 30, { width: 1920, height: 1080 }, { type: "blur", blurIntensity: 10 }]);
  const color = found.run({ id: "p", version: 1, scenes: [] }, context()).record as any;
  assert.deepEqual(color.settings.background, { type: "color", color: "#000000" });
  const legacy = { s: [{ id: "lt", type: "media", name: "M", elements: [{ id: "e", type: "media", mediaId: "m1", duration: 2, startTime: 0, trimStart: 0, trimEnd: 0 }] }] };
  const withTracks = found.run({ id: "p", version: 1, bookmarks: [1.5], scenes: [{ id: "s", name: "Main scene", isMain: true, tracks: [], bookmarks: [] }] }, context({ legacyTracksBySceneId: legacy, mediaRecords: [{ id: "m1", name: "a.png", type: "image", size: 1 }] })).record as any;
  assert.deepEqual([withTracks.scenes[0].tracks[0].type, withTracks.scenes[0].tracks[0].elements[0].type, withTracks.scenes[0].bookmarks], ["video", "image", [1.5]]);
});
test("Migration chain v2→v3: adds metadata.duration", () => {
  assert.equal(step(2, flat([{ id: "a", type: "video", startTime: 1, duration: 4 }, { id: "b", type: "video", startTime: 5, duration: 2.5 }])).metadata.duration, 7.5);
});
test("Migration chain v3→v4: normalises text fontWeight", () => {
  const weights = ["normal", "bold", 300, "900", "heavy", 950, undefined];
  const migrated = step(3, flat(weights.map((fontWeight, index) => ({ id: `t${index}`, type: "text", fontWeight })), { type: "text" }));
  assert.deepEqual(migrated.scenes[0].tracks[0].elements.map((element: any) => element.fontWeight), ["400", "700", "300", "900", "400", "400", "400"], "normal → 400, bold → 700, numeric 100–900 kept, anything else → 400");
});
test("Migration chain v5→v6: bookmark numbers become {time}", () => {
  const migrated = step(5, { ...flat([]), scenes: [{ id: "s", isMain: true, tracks: [], bookmarks: [2, 5.5, { time: 9, note: "x" }] }] });
  assert.deepEqual(migrated.scenes[0].bookmarks, [{ time: 2 }, { time: 5.5 }, { time: 9, note: "x" }]);
});
test("Migration chain v6→v7: text backgroundColor becomes a background object", () => {
  assert.deepEqual(first(step(6, flat([{ id: "t", type: "text", backgroundColor: "#112233" }], { type: "text" }))).background, { color: "#112233", cornerRadius: 0, paddingX: 8, paddingY: 4, offsetX: 0, offsetY: 0 });
});
test("Migration chain v7→v8: sourceDuration = trimStart + duration + trimEnd for video and audio", () => {
  const migrated = step(7, flat([{ id: "v", type: "video", trimStart: 1, duration: 4, trimEnd: 0.5 }, { id: "i", type: "image", trimStart: 0, duration: 4, trimEnd: 0 }, { id: "a", type: "audio", trimStart: 0, duration: 2, trimEnd: 0, sourceDuration: 9 }]));
  assert.deepEqual(migrated.scenes[0].tracks[0].elements.map((element: any) => element.sourceDuration), [5.5, undefined, 9]);
});
test("Migration chain v8→v9: background.enabled is true unless the colour is transparent", () => {
  const migrated = step(8, flat([{ id: "a", type: "text", background: { color: "#000000" } }, { id: "b", type: "text", background: { color: "transparent" } }], { type: "text" }));
  assert.deepEqual(migrated.scenes[0].tracks[0].elements.map((element: any) => element.background.enabled), [true, false]);
});
test("Migration chain v9→v10: a version bump", () => {
  const source = flat([{ id: "a", type: "video" }]);
  assert.deepEqual({ ...step(9, source), version: 9 }, { id: "p", version: 9, ...source });
});
test("Migration chain v10→v11: transform.scale becomes scaleX and scaleY, animation channels included", () => {
  const element = first(step(10, flat([{ id: "v", type: "video", transform: { scale: 1.5, position: { x: 0, y: 0 }, rotate: 0 }, animations: { channels: { "transform.scale": { valueKind: "number", keyframes: [{ id: "k", time: 0, value: 2, interpolation: "linear" }] } } } }])));
  assert.deepEqual([element.transform.scaleX, element.transform.scaleY, "scale" in element.transform], [1.5, 1.5, false]);
  assert.deepEqual(Object.keys(element.animations.channels).sort(), ["transform.scaleX", "transform.scaleY"]);
});
test("Migration chain v11→v12: position x/y channels merge into one vector channel", () => {
  const key = (id: string, time: number, value: number) => ({ id, time, value, interpolation: "linear" });
  const element = first(step(11, flat([{ id: "v", type: "video", transform: { position: { x: 5, y: 7 } }, animations: { channels: { "transform.position.x": { keyframes: [key("x0", 0, 0), key("x1", 2, 100)] }, "transform.position.y": { keyframes: [key("y0", 0, 10)] } } } }])));
  assert.deepEqual(Object.keys(element.animations.channels), ["transform.position"]);
  assert.deepEqual(element.animations.channels["transform.position"].keyframes.map((entry: any) => [entry.time, entry.value]), [[0, { x: 0, y: 10 }], [2, { x: 100, y: 10 }]]);
});
test("Migration chain v12→v13: mask feather, inverted and stroke move into mask.params", () => {
  const [plain, stroked] = first(step(12, flat([{ id: "v", type: "video", masks: [{ id: "m1", type: "rectangle", params: { width: 1 } }, { id: "m2", type: "ellipse", feather: 12, inverted: true, stroke: { color: "#ff0000", width: 3 }, params: {} }] }]))).masks;
  assert.deepEqual(plain.params, { width: 1, feather: 0, inverted: false, strokeColor: "#ffffff", strokeWidth: 0 });
  assert.deepEqual([stroked.params, "feather" in stroked, "stroke" in stroked], [{ feather: 12, inverted: true, strokeColor: "#ff0000", strokeWidth: 3 }, false, false]);
});
test("Migration chain v13→v14: the split-mask anchor becomes explicit x and y", () => {
  const [mask] = first(step(13, flat([{ id: "v", type: "video", masks: [{ id: "m", type: "split", params: { position: 0.75, rotation: 0 } }] }]))).masks;
  assert.deepEqual([mask.params.x, Math.abs(mask.params.y) < 1e-12, "position" in mask.params], [0.25, true, false]);
});
test("Migration chain v14→v15: stickers get intrinsicWidth and intrinsicHeight 200", () => {
  const migrated = step(14, flat([{ id: "a", type: "sticker" }, { id: "b", type: "sticker", intrinsicWidth: 64, intrinsicHeight: 32 }], { type: "sticker" }));
  assert.deepEqual(migrated.scenes[0].tracks[0].elements.map((element: any) => [element.intrinsicWidth, element.intrinsicHeight]), [[200, 200], [64, 32]]);
});
test("Migration chain v15→v16: sticker tracks become graphic tracks", () => {
  assert.equal(step(15, flat([{ id: "a", type: "sticker" }], { type: "sticker" })).scenes[0].tracks[0].type, "graphic");
});
test("Migration chain v16→v17: masks get strokeAlign \"center\"", () => {
  assert.equal(first(step(16, flat([{ id: "v", type: "video", masks: [{ id: "m", type: "rectangle", params: { strokeWidth: 2 } }] }]))).masks[0].params.strokeAlign, "center");
});
test("Migration chain v18→v19: canvasSizeMode \"preset\" and lastCustomCanvasSize null", () => {
  const { settings } = step(18, flat([]));
  assert.deepEqual([settings.canvasSizeMode, settings.lastCustomCanvasSize], ["preset", null]);
});
test("Migration chain v19→v20: video elements get isSourceAudioEnabled true", () => {
  const migrated = step(19, flat([{ id: "a", type: "video" }, { id: "b", type: "video", isSourceAudioEnabled: false }, { id: "c", type: "image" }]));
  assert.deepEqual(migrated.scenes[0].tracks[0].elements.map((element: any) => element.isSourceAudioEnabled), [true, false, undefined]);
});
test("Migration chain v21→v22: animations become bindings plus per-component channels; colours are linear-RGB components", () => {
  const key = (id: string, time: number, value: unknown, interpolation = "linear") => ({ id, time, value, interpolation });
  const element = first(step(21, flat([{ id: "t", type: "text", animations: { channels: {
    opacity: { valueKind: "number", keyframes: [key("o", 1, 0.5)] }, "transform.position": { valueKind: "vector", keyframes: [key("p", 2, { x: 10, y: 20 }, "hold")] }, color: { valueKind: "color", keyframes: [key("c", 3, "#ff0000")] },
  } } }], { type: "text" })));
  const { bindings, channels } = element.animations;
  assert.deepEqual(bindings.opacity, { path: "opacity", kind: "number", components: [{ key: "value", channelId: "opacity:value" }] });
  assert.deepEqual(bindings["transform.position"].components.map((component: any) => component.channelId), ["transform.position:x", "transform.position:y"]);
  assert.deepEqual([bindings.color.kind, bindings.color.colorSpace], ["color", "srgb-linear"]);
  assert.deepEqual(["r", "g", "b", "a"].map((part) => channels[`color:${part}`].keys[0].value), [1, 0, 0, 1], "pure red in linear RGB");
  assert.equal(channels["opacity:value"].keys[0].value, 0.5);
});
test("Migration chain v22→v23: times become integer ticks and fps a rational by the one rule", () => {
  const record = step(22, flat([{ id: "v", type: "video", startTime: 1.5, duration: 2.25, trimStart: 0.1, trimEnd: 0, sourceDuration: 2.35 }], {}, { metadata: { id: "p", name: "P", duration: 3.75 } }));
  const element = first(record);
  assert.deepEqual([element.startTime, element.duration, element.trimStart, element.sourceDuration, record.metadata.duration], [180_000, 270_000, 12_000, 282_000, 450_000]);
  const fps = (value: number) => step(22, flat([], {}, { settings: { fps: value, canvasSize: { width: 1920, height: 1080 }, background: { type: "color", color: "#000" } } })).settings.fps;
  assert.deepEqual([fps(30), fps(29.97), fps(23.976), fps(59.94), fps(12.5), fps(14.9853)], [{ numerator: 30, denominator: 1 }, { numerator: 30000, denominator: 1001 }, { numerator: 24000, denominator: 1001 }, { numerator: 60000, denominator: 1001 }, { numerator: 25, denominator: 2 }, { numerator: 2997, denominator: 200 }], "a standard rate within 0.01, otherwise three decimals reduced");
});
test("Migration chain v23→v24: the scene's track array becomes {overlay, main, audio}", () => {
  const record = step(23, { ...flat([]), scenes: [{ id: "s", isMain: true, bookmarks: [], tracks: [{ id: "tx", type: "text", elements: [] }, { id: "tv", type: "video", isMain: true, elements: [] }, { id: "ta", type: "audio", elements: [] }] }] });
  const { tracks } = record.scenes[0];
  assert.deepEqual([tracks.main.id, tracks.overlay.map((track: any) => track.id), tracks.audio.map((track: any) => track.id)], ["tv", ["tx"], ["ta"]]);
});
test("Migration chain v24→v25: the position vector binding becomes positionX and positionY; no step leaves another track shape", () => {
  const animations = { bindings: { "transform.position": { path: "transform.position", kind: "vector2", components: [{ key: "x", channelId: "transform.position:x" }, { key: "y", channelId: "transform.position:y" }] } }, channels: { "transform.position:x": { kind: "scalar", keys: [{ id: "k", time: 0, value: 4 }] }, "transform.position:y": { kind: "scalar", keys: [{ id: "k", time: 0, value: 8 }] } } };
  const element = first(step(24, zoned([{ id: "v", type: "video", animations }])));
  assert.deepEqual(Object.keys(element.animations.bindings).sort(), ["transform.positionX", "transform.positionY"]);
  assert.deepEqual([element.animations.channels["transform.positionX:value"].keys[0].value, element.animations.channels["transform.positionY:value"].keys[0].value], [4, 8]);
  // A scene that reaches the step with the flat array classic could leave behind comes out zoned, not as an object with numeric keys.
  const broken = step(24, { ...flat([]), scenes: [{ id: "s", isMain: true, bookmarks: [], tracks: [{ id: "tv", type: "video", isMain: true, elements: [] }, { id: "ta", type: "audio", elements: [] }] }] });
  assert.deepEqual([Object.keys(broken.scenes[0].tracks).sort(), broken.scenes[0].tracks.main.id, broken.scenes[0].tracks.audio[0].id], [["audio", "main", "overlay"], "tv", "ta"]);
});
test("Migration chain v25→v26: repairs scenes corrupted by the previous step", () => {
  const corrupted = { 0: { id: "tv", type: "video", isMain: true, elements: [] }, 1: { id: "tx", type: "text", elements: [] }, 2: { id: "ta", type: "audio", elements: [] } };
  const { tracks } = step(25, { ...flat([]), scenes: [{ id: "s", isMain: true, bookmarks: [], tracks: corrupted }] }).scenes[0];
  assert.deepEqual([tracks.main.id, "isMain" in tracks.main, tracks.overlay.map((track: any) => track.id), tracks.audio.map((track: any) => track.id)], ["tv", false, ["tx"], ["ta"]]);
});
test("Migration chain v26→v27: a custom mask path string becomes a typed point array", () => {
  const point = (id: string, x: number, y: number) => ({ id, x, y, inX: 0, inY: 0, outX: 0, outY: 0 });
  const path = JSON.stringify([point("a", 0, 0), point("b", 1, 0.5)]);
  const [mask] = first(step(26, zoned([{ id: "v", type: "video", masks: [{ id: "m", type: "custom", params: { path } }] }]))).masks;
  assert.deepEqual(mask.params.path, [point("a", 0, 0), point("b", 1, 0.5)]);
});
test("Migration chain v27→v28: every media time is rounded to an integer tick", () => {
  const element = first(step(27, zoned([{ id: "v", type: "video", startTime: 4000.4, duration: 119_999.5, trimStart: 0.49, trimEnd: 0 }])));
  assert.deepEqual([element.startTime, element.duration, element.trimStart], [4000, 120_000, 0]);
});
test("Migration chain v28→v29: built-in element fields are copied into params and the sources are kept", () => {
  const element = first(step(28, zoned([{ id: "v", type: "video", name: "V", transform: { position: { x: 12, y: -4 }, scaleX: 1.25, scaleY: 0.75, rotate: 9 }, opacity: 0.5, blendMode: "multiply", volume: -6, muted: true }])));
  assert.deepEqual(element.params, { "transform.positionX": 12, "transform.positionY": -4, "transform.scaleX": 1.25, "transform.scaleY": 0.75, "transform.rotate": 9, opacity: 0.5, blendMode: "multiply", volume: -6, muted: true });
  assert.deepEqual([element.opacity, element.transform.scaleX], [0.5, 1.25], "the sources stay");
});
test("Migration chain v29→v30: animation bindings and channels are flattened into a map keyed by property path", () => {
  const animations = { bindings: { opacity: { path: "opacity", kind: "number", components: [{ key: "value", channelId: "opacity:value" }] } }, channels: { "opacity:value": { kind: "scalar", keys: [{ id: "o1", time: 0, value: 0.5 }] } } };
  const element = first(step(29, zoned([{ id: "t", type: "text", animations }])));
  assert.deepEqual(element.animations.opacity.keys, [{ id: "o1", time: 0, value: 0.5 }]);
});
test("Migration chain v30→v31: mask type custom becomes freeform", () => {
  const masks = first(step(30, zoned([{ id: "v", type: "video", masks: [{ id: "a", type: "custom", params: { path: [] } }, { id: "b", type: "ellipse", params: {} }] }]))).masks;
  assert.deepEqual(masks.map((mask: any) => mask.type), ["freeform", "ellipse"]);
});
test("Migration chain: the chain is ordered v0→v1 … v31→v32, v32→v33 and is deterministic for one id source", () => {
  assert.deepEqual(MIGRATION_CHAIN.map((entry) => [entry.from, entry.to]), Array.from({ length: 33 }, (_, index) => [index, index + 1]));
  const run = () => JSON.stringify(migrateRecord({ id: "p0", name: "Old", createdAt: "2023-01-01T00:00:00.000Z", updatedAt: "2023-01-01T00:00:00.000Z" }, context()).record);
  assert.equal(run(), run(), "the same record and id seed give identical bytes");
  assert.equal(JSON.parse(run()).schemaVersion, 33, "a v0 record reaches the current schema");
});

// Fixtures at an intermediate version and at v31, written by classic's own writer.
test("Migration chain: a v12-era record from the classic store reaches schema 32", async () => {
  const browser = fakeBrowser();
  await classicSaveRawProject(browser, "project-v12", {
    version: 12, metadata: { id: "project-v12", name: "Mid era", duration: 6, createdAt: "2024-09-01T10:00:00.000Z", updatedAt: "2024-09-02T10:00:00.000Z" },
    settings: { fps: 29.97, canvasSize: { width: 1080, height: 1920 }, originalCanvasSize: null, background: { type: "blur", blurIntensity: 8 } }, currentSceneId: "s",
    scenes: [{ id: "s", name: "Main scene", isMain: true, bookmarks: [{ time: 1.001 }], createdAt: "2024-09-01T10:00:00.000Z", updatedAt: "2024-09-02T10:00:00.000Z", tracks: [
      { id: "tv", type: "video", name: "Video Track", isMain: true, muted: false, hidden: false, elements: [{
        id: "v1", type: "video", name: "Clip", mediaId: "m1", startTime: 0, duration: 4.004, trimStart: 0, trimEnd: 0, sourceDuration: 4.004, muted: false, hidden: false, volume: 0.25, opacity: 0.9,
        transform: { scaleX: 1.2, scaleY: 1.2, position: { x: 30, y: -10 }, rotate: 0 }, masks: [{ id: "mk", type: "ellipse", feather: 4, inverted: false, params: { centerX: 0, centerY: 0, width: 0.5, height: 0.5, rotation: 0 } }],
        animations: { channels: { opacity: { valueKind: "number", keyframes: [{ id: "k1", time: 0, value: 0, interpolation: "linear" }, { id: "k2", time: 1.001, value: 1, interpolation: "linear" }] } } },
      }] },
      { id: "tt", type: "text", name: "Text Track", hidden: false, elements: [{ id: "x1", type: "text", name: "Title", content: "Hi", fontSize: 40, fontFamily: "Arial", color: "#ffffff", textAlign: "center", fontWeight: "700", fontStyle: "normal", textDecoration: "underline", background: { enabled: false, color: "transparent", cornerRadius: 0, paddingX: 8, paddingY: 4, offsetX: 0, offsetY: 0 }, startTime: 0.5, duration: 2, trimStart: 0, trimEnd: 0, hidden: false, opacity: 1, transform: { scaleX: 1, scaleY: 1, position: { x: 0, y: 0 }, rotate: 0 } }] },
    ] }],
  });
  await classicSaveMediaAsset(browser, "project-v12", { id: "m1", name: "clip.mov", type: "video", bytes: new Uint8Array(16), lastModified: 1_700_000_000_000, width: 1080, height: 1920, duration: 4.004 });
  const source = classicOriginSource(browser), [record] = await source.projects();
  const migrated = migrateRecord(record, context({ mediaRecords: await source.mediaRecords("project-v12") }));
  const document = migrated.record as any;
  assert.deepEqual([migrated.from, migrated.to, validateProjectDocument(document, { mode: "strict" }).ok], [12, 33, true]);
  const clip = document.scenes[0].tracks.main.elements[0], title = document.scenes[0].tracks.overlay[0].elements[0];
  assert.deepEqual([document.settings.fps, clip.transform.scale, clip.transform.position, Math.round(clip.volume * 100) / 100, clip.masks[0].params.feather], [{ numerator: 30000, denominator: 1001 }, { x: 1.2, y: 1.2 }, { x: 30, y: -10 }, -12.04, 4]);
  assert.deepEqual([clip.duration, clip.sourceDuration, Object.keys(clip.animations), clip.animations.opacity.keys.map((key: any) => key.time)], [480_480, 480_480, ["opacity"], [0, 120_120]], "4.004 s is 120 frames of 4 004 ticks");
  assert.deepEqual([title.fontWeight, title.underline, title.strikethrough, title.background.enabled], [700, true, false, false]);
  assert.equal(document.settings.background.kind, "blur");
});

test("Migration chain: a v31 record written by classic's saveProject reaches schema 32 with every element", async () => {
  const browser = fakeBrowser(), at = new Date("2025-03-04T05:06:07.000Z");
  const project: ClassicRuntimeProject = {
    metadata: { id: "classic-31", name: "Holiday cut", createdAt: at, updatedAt: at }, currentSceneId: "scene-main", version: 31,
    settings: { fps: { numerator: 30, denominator: 1 }, canvasSize: { width: 1920, height: 1080 }, canvasSizeMode: "preset", lastCustomCanvasSize: null, originalCanvasSize: null, background: { type: "color", color: "#101010" } },
    timelineViewState: { zoomLevel: 2, scrollLeft: 120, playheadTime: 240_000 },
    scenes: [{ id: "scene-main", name: "Main scene", isMain: true, bookmarks: [{ time: 360_000, note: "cut" }], createdAt: at, updatedAt: at, tracks: {
      overlay: [classic.track("t-text", "text", [classic.text("x1", 0, 2)]), classic.track("t-fx", "effect", [classic.effect("fx1", "blur", 0, 2, { intensity: 15 })])],
      main: classic.track("track-main", "video", [classic.video("v1", 0, 2), classic.image("i1", 2, 2)], { name: "Main Track" }),
      audio: [classic.track("t-audio", "audio", [{ ...classic.audio("a1", 0, 2), buffer: { length: 96000 } }])],
    } }],
  };
  const stored = await classicSaveProject(browser, project);
  assert.deepEqual([stored.id, (stored.metadata as any).createdAt, (stored.metadata as any).duration, "thumbnail" in (stored.metadata as any)], ["classic-31", "2025-03-04T05:06:07.000Z", 480_000, false], "classic's stored shape: key in the record, ISO dates, computed duration");
  const [record] = await classicOriginSource(browser).projects();
  assert.equal("buffer" in (record.scenes as any)[0].tracks.audio[0].elements[0], false, "classic strips audio buffers on save");
  const migrated = migrateRecord(record, context({ mediaRecords: classic.media() }));
  const document = migrated.record as any;
  assert.deepEqual([migrated.from, migrated.to, validateProjectDocument(document, { mode: "strict" }).ok], [31, 33, true]);
  assert.deepEqual([document.metadata.created_ms, document.scenes[0].markers.map((marker: any) => [marker.time, marker.note])], [at.getTime(), [[360_000, "cut"]]]);
  assert.equal([...document.scenes[0].tracks.overlay, document.scenes[0].tracks.main, ...document.scenes[0].tracks.audio].reduce((sum: number, track: any) => sum + track.elements.length, 0), 5);
});
