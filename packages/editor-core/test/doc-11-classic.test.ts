import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalize, classicCanvasFactor, droppedCount, fontWeightOf, migrateV31toV32, validateProjectDocument } from "../src/index.ts";
import { element, ids, NOW, REGISTRIES } from "./support/fixtures.ts";
import { classic, ISO_MS, key, scalar, toClassicView } from "./support/classic.ts";

const migrate = (record: unknown, media = classic.media()) => migrateV31toV32(record, media, { now_ms: NOW, newId: ids("new"), registries: REGISTRIES });
const strictlyValid = (document: unknown) => assert.deepEqual(validateProjectDocument(document, { registries: REGISTRIES }).errors, []);

// Requirement: Classic v31 mapping
test("Classic v31 mapping — Scenario: Flat params become typed fields", () => {
  const params = { "transform.positionX": 40, "transform.scaleX": 1.2, "transform.scaleY": 1.2, "transform.rotate": 15, opacity: 0.8, blendMode: "screen", volume: -6, muted: false };
  const { document } = migrate(classic.project({ main: [{ ...classic.video("v1"), params }] }));
  const migrated = element(document, "v1");
  assert.deepEqual(migrated.transform, { position: { x: 40, y: 0 }, scale: { x: 1.2, y: 1.2 }, rotation: 15 });
  assert.deepEqual([migrated.opacity, migrated.blendMode, migrated.volume, migrated.muted], [0.8, "screen", -6, false]);
  assert.equal("params" in migrated, false);
  strictlyValid(document);
});

test("Classic v31 mapping — Scenario: Classic effect element", () => {
  const layer = classic.effect("fx", "blur", 0, 2, { intensity: 30 }, { animations: { "params.intensity": scalar(key("k1", 0, 10), key("k2", 120_000, 30)) } });
  const { document, report } = migrate(classic.project({ main: [classic.video("v1")], overlay: [classic.track("t-fx", "effect", [layer])] }));
  const migrated = element(document, "fx");
  const E = migrated.effects[0].id;
  assert.deepEqual(migrated.effects, [{ id: E, type: "blur", kind: "effect", enabled: true, params: { intensity: 30 } }]);
  assert.equal(migrated.target, "beneath");
  assert.equal("effectType" in migrated, false);
  assert.equal("params" in migrated, false);
  assert.deepEqual(Object.keys(migrated.animations), [`effects.${E}.params.intensity`]);
  assert.deepEqual(migrated.animations[`effects.${E}.params.intensity`].keys.map((entry: any) => [entry.id, entry.time, entry.value]), [["k1", 0, 10], ["k2", 120_000, 30]]);
  strictlyValid(document);
  assert.deepEqual(report, []);
});

test("Classic v31 mapping — Scenario: Stale top-level copy loses to params", () => {
  const stale = { ...classic.text("t1", 0, 2, { fontSize: 20 }), fontSize: 12, opacity: 0.3, content: "old", transform: { scaleX: 3, scaleY: 3, rotate: 90, position: { x: 9, y: 9 } } };
  const { document } = migrate(classic.project({ overlay: [classic.track("t-text", "text", [stale])] }));
  const migrated = element(document, "t1");
  assert.equal(migrated.fontSize, 20);
  assert.deepEqual([migrated.opacity, migrated.content, migrated.transform.rotation], [1, "Default text", 0]);
  // With no params value the stale copy is read, and with neither the default.
  const { params: _params, ...bare } = stale as any;
  const fallback = element(migrate(classic.project({ overlay: [classic.track("t-text", "text", [{ ...bare, params: {} }])] })).document, "t1");
  assert.deepEqual([fallback.fontSize, fallback.opacity, fallback.transform.scale, fallback.transform.position, fallback.lineHeight], [12, 0.3, { x: 3, y: 3 }, { x: 9, y: 9 }, 1.2]);
});

test("Classic v31 mapping — Scenario: Keyframe paths renamed", () => {
  const animations = { "transform.positionX": scalar(key("k1", 0, 0), key("k2", 120_000, 300)), "transform.rotate": scalar(key("k3", 0, 0)), bindings: {}, channels: {} };
  const { document } = migrate(classic.project({ main: [classic.video("v1", 0, 2, {}, { animations })] }));
  const migrated = element(document, "v1").animations;
  assert.deepEqual(Object.keys(migrated).sort(), ["transform.position.x", "transform.rotation"]);
  assert.deepEqual(migrated["transform.position.x"].keys, [{ ...key("k1", 0, 0) }, { ...key("k2", 120_000, 300) }], "identical keys");
});

test("Classic v31 mapping — Scenario: Bookmarks become markers", () => {
  const { document } = migrate(classic.project({ bookmarks: [{ time: 360_000, note: "cut" }] }));
  const scene = document.scenes[0] as any;
  assert.deepEqual(scene.markers, [{ id: scene.markers[0].id, time: 360_000, note: "cut", color: 1 }]);
  assert.match(scene.markers[0].id, /^new\d+$/, "a new id from the id source");
  assert.equal("bookmarks" in scene, false);
});

/** The fixture set: one project per element type, with masks, effects, keyframes and a standalone effect element. */
const mask = (id: string, type: string, extra = {}) => ({ id, type, params: { feather: 12, inverted: false, strokeColor: "#ffffff", strokeWidth: 2, strokeAlign: "center", centerX: 0.1, centerY: -0.1, rotation: 15, ...extra } });
const box = { width: 0.5, height: 0.4, scale: 1 };
const point = (id: string, x: number, y: number) => ({ id, x, y, inX: 0, inY: 0, outX: 0.05, outY: 0 });
const colour = (id: string) => ({ r: scalar(key(id, 0, 1)), g: scalar(key(id, 0, 0.5)), b: scalar(key(id, 0, 0)), a: scalar(key(id, 0, 1)) });
const FIXTURES: Record<string, () => unknown> = {
  video: () => classic.project({ main: [classic.video("v1", 0, 2, { volume: -3, "transform.scaleX": 1.4, "transform.scaleY": 1.4 }, {
    retime: { rate: 2, maintainPitch: true }, effects: [{ id: "fx1", type: "blur", params: { intensity: 20 }, enabled: true }],
    masks: [mask("mk1", "split"), mask("mk2", "rectangle", box), mask("mk3", "ellipse", box), mask("mk4", "heart", box), mask("mk5", "diamond", box), mask("mk6", "star", box), mask("mk7", "cinematic-bars", box),
      mask("mk8", "freeform", { scale: 1, closed: true, path: [point("p1", 0, 0), point("p2", 0.3, 0), point("p3", 0.3, 0.3)] })],
    animations: { "transform.positionX": scalar(key("a1", 0, -50), key("a2", 120_000, 50)), "transform.positionY": scalar(key("a3", 0, 0)), "transform.scaleX": scalar(key("a4", 0, 1)), "transform.scaleY": scalar(key("a5", 0, 1)),
      "transform.rotate": scalar(key("a6", 0, 0)), opacity: scalar(key("a7", 0, 1)), volume: scalar(key("a8", 0, -6)), "effects.fx1.params.intensity": scalar(key("a9", 0, 5)) },
  })] }),
  image: () => classic.project({ main: [classic.image("i1", 0, 3, { opacity: 0.5 }, { masks: [mask("mk1", "text", { scale: 1, content: "HI", fontSize: 20, fontFamily: "Arial", fontWeight: "bold", fontStyle: "normal", textDecoration: "none", letterSpacing: 0, lineHeight: 1.2 })] })] }),
  audio: () => classic.project({ audio: [classic.track("t-audio", "audio", [classic.audio("s1", 0, 4, { volume: -12, muted: true }), classic.audio("s2", 4, 2, {}, { sourceType: "library", sourceUrl: "https://sounds.example/rain.mp3", mediaId: undefined })])] }),
  text: () => classic.project({ overlay: [classic.track("t-text", "text", [
    classic.text("x1", 0, 2, { content: "Title", fontWeight: "bold", textDecoration: "underline", "background.enabled": true, "background.color": "#112233", "background.cornerRadius": 8 }, {
      animations: { color: colour("c1"), "background.color": colour("c2"), "background.paddingX": scalar(key("b1", 0, 30)), "background.paddingY": scalar(key("b2", 0, 42)), "background.offsetX": scalar(key("b3", 0, 0)),
        "background.offsetY": scalar(key("b4", 0, 0)), "background.cornerRadius": scalar(key("b5", 0, 8)) },
    }),
    classic.text("x2", 2, 2, { textDecoration: "line-through", "background.color": "transparent" }), classic.text("x3", 4, 2, { textDecoration: "none" }),
  ])] }),
  sticker: () => classic.project({ overlay: [classic.track("t-graphic", "graphic", [classic.sticker("k1", 0, 2, { "transform.rotate": -30 })])] }),
  graphic: () => classic.project({ overlay: [classic.track("t-graphic", "graphic", [
    classic.graphic("g1", "rectangle", 0, 2, { cornerRadius: 12 }), classic.graphic("g2", "ellipse", 2, 2), classic.graphic("g3", "polygon", 4, 2, { sides: 6, cornerRadius: 0 }),
    classic.graphic("g4", "star", 6, 2, { points: 7, depth: 60 }, { animations: { "params.depth": scalar(key("d1", 0, 40), key("d2", 120_000, 70)) } }),
  ])] }),
  "standalone-effect": () => classic.project({ main: [classic.video("v1")], overlay: [classic.track("t-fx", "effect", [classic.effect("fx", "blur", 0, 2, { intensity: 15 })])] }),
  backgrounds: () => classic.project({ main: [classic.video("v1")], background: { type: "color", color: "linear-gradient(90deg, #ff0000 0%, #0000ff 100%)" } }),
  "blur-background-9x16": () => classic.project({ main: [classic.video("v1")], canvas: { width: 1080, height: 1920 }, background: { type: "blur", blurIntensity: 100 } }),
  "negative-scale": () => classic.project({ main: [
    classic.video("flip", 0, 2, { "transform.scaleX": -1.5 }),
    classic.video("all-negative", 2, 2, { "transform.scaleY": -1 }, { animations: { "transform.scaleY": scalar(key("n1", 0, -1), key("n2", 120_000, -2)) } }),
    classic.video("mixed", 4, 2, { "transform.scaleX": 1 }, { animations: { "transform.scaleX": scalar(key("m1", 0, 1), key("m2", 240_000, -1)) } }),
  ] }),
  bookmarks: () => classic.project({ main: [classic.video("v1")], bookmarks: [{ time: 360_000, note: "cut", color: "#FF8800" }, { time: 120_000, duration: 60_000 }, { time: 120_000 }, 480_000] }),
};

test("Classic v31 mapping — Scenario: Whole fixture set validates", () => {
  for (const [name, build] of Object.entries(FIXTURES)) {
    const source = build() as any;
    const { document, report } = migrate(source);
    strictlyValid(document);
    assert.equal(report.filter((entry) => entry.reason === "removed-element").length, 0, `${name}: zero dropped elements`);
    const count = (tracks: any) => [...tracks.overlay, tracks.main, ...tracks.audio].reduce((sum: number, track: any) => sum + track.elements.length, 0);
    assert.equal(count(document.scenes[0].tracks), count(source.scenes[0].tracks), name);
  }
});

test("Classic v31 mapping: every key the tables map without a value change survives the inverse projection", () => {
  for (const [name, build] of Object.entries(FIXTURES)) {
    const source = build() as any;
    const { document } = migrate(source);
    for (const track of [...source.scenes[0].tracks.overlay, source.scenes[0].tracks.main, ...source.scenes[0].tracks.audio]) {
      for (const original of track.elements) {
        const view = toClassicView(element(document, original.id));
        for (const [param, value] of Object.entries(original.params as Record<string, unknown>)) {
          // Keys §13 changes are checked against the prescribed value below, not against the source.
          if (["fontWeight", "textDecoration"].includes(param) || (original.type !== "graphic" && original.type !== "effect" && !(param in view.params))) continue;
          if (param === "background.color" && value === "transparent") continue;
          assert.deepEqual(view.params[param], value, `${name} ${original.id} params.${param}`);
        }
        assert.deepEqual(view.animationPaths, Object.keys(original.animations ?? {}).sort(), `${name} ${original.id} animation paths`);
      }
    }
  }
  const text = migrate(FIXTURES.text()).document;
  assert.deepEqual(["x1", "x2", "x3"].map((id) => [element(text, id).fontWeight, element(text, id).underline, element(text, id).strikethrough]), [[700, true, false], [400, false, true], [400, false, false]]);
  assert.deepEqual([element(text, "x2").background.enabled, element(text, "x2").background.color], [false, "#000000"], "a transparent background colour is a disabled background");
  assert.deepEqual([fontWeightOf("normal"), fontWeightOf("bold"), fontWeightOf("300"), fontWeightOf("650"), fontWeightOf("heavy"), fontWeightOf(undefined)], [400, 700, 300, 700, 400, 400]);
});

test("Classic v31 mapping — Scenario: Blur intensity rescaled on a square canvas", () => {
  const square = classic.project({ canvas: { width: 1080, height: 1080 }, main: [classic.video("v1", 0, 2, {}, { effects: [{ id: "fx1", type: "blur", params: { intensity: 40 }, enabled: true }], animations: { "effects.fx1.params.intensity": scalar(key("k1", 0, 40), key("k2", 120_000, 80)) } })] });
  const { document, report } = migrate(square);
  assert.equal(classicCanvasFactor({ width: 1080, height: 1080 }), 0.5625);
  assert.equal(element(document, "v1").effects[0].params.intensity, 23, "40 × 0.5625 = 22.5, rounded half away from zero");
  assert.deepEqual(element(document, "v1").animations["effects.fx1.params.intensity"].keys.map((entry: any) => entry.value), [23, 45]);
  assert.deepEqual(report.map((entry) => [entry.reason, entry.classicKey, (entry.detail as any).from, (entry.detail as any).to]), [["rescaled", "intensity", 40, 23]]);
  assert.equal(droppedCount(report), 0, "a rescale is listed, not counted as an item that was not migrated");
  // 16:9 landscape keeps its values; 9:16 scales by 0.316.
  assert.equal(classicCanvasFactor({ width: 1920, height: 1080 }), 1);
  assert.ok(Math.abs(classicCanvasFactor({ width: 1080, height: 1920 }) - 0.316) < 0.001);
  assert.deepEqual(migrate(FIXTURES["blur-background-9x16"]()).document.settings.background, { kind: "blur", blurIntensity: 32 });
  assert.deepEqual(migrate(FIXTURES.backgrounds()).document.settings.background, { kind: "gradient", css: "linear-gradient(90deg, #ff0000 0%, #0000ff 100%)" });
  assert.deepEqual(migrate(classic.project({ background: { type: "color", color: "#AABBCCDD" } })).document.settings.background, { kind: "color", color: "#aabbcc" });
  assert.deepEqual(migrate(classic.project({ background: { type: "color", color: "transparent" } })).document.settings.background, { kind: "transparent" });
});

test("Classic v31 mapping: project, settings, scene, track and media rows of §13.1 and §13.6", () => {
  const source = classic.project({
    main: [classic.video("v1")], canvas: { width: 1081, height: 9000 },
    overlay: [classic.track("t-broll", "video", [], { name: "B-roll", hidden: true, muted: true }), classic.track("t-plain", "video")], audio: [classic.track("t-audio", "audio")],
    extra: { metadata: { id: "classic-1", name: `  ${"n".repeat(130)}  `, duration: 240_000.4, createdAt: "not a date", updatedAt: "2025-03-04T05:06:07.000Z", thumbnail: "data:image/jpeg;base64,/9j/4AAQ" } },
  });
  const { document, thumbnails } = migrate(source);
  const doc = document as any;
  assert.deepEqual([doc.format, doc.schemaVersion, doc.minReaderSchemaVersion, doc.version], ["jagentchill.project", 32, 32, 31]);
  assert.deepEqual([doc.metadata.id, doc.metadata.name.length, doc.metadata.duration, doc.metadata.created_ms, doc.metadata.updated_ms, doc.metadata.thumbnail], ["classic-1", 120, 240_000, NOW, ISO_MS, null]);
  for (const gone of ["createdAt", "updatedAt"]) assert.equal(gone in doc.metadata, false);
  assert.deepEqual(doc.settings.canvasSize, { width: 1082, height: 7680 }, "rounded to the nearest even integer and clamped");
  assert.deepEqual([doc.settings.adoptCanvasFromFirstMedia, doc.settings.adoptFrameRateFromFirstMedia, doc.settings.useProxies, doc.settings.colorPipeline], [false, false, true, "sdr-rec709-8bit"]);
  assert.deepEqual([doc.cover, doc.scriptLinks, doc.glossaries], [null, [], {}]);
  assert.deepEqual([doc.scenes[0].kind, doc.scenes[0].compoundBackground, doc.scenes[0].created_ms], ["timeline", "none", ISO_MS]);
  const [broll, plain] = doc.scenes[0].tracks.overlay;
  assert.deepEqual([broll.pinned, broll.hidden, broll.muted, plain.pinned], [true, true, true, false]);
  for (const track of [broll, plain]) assert.deepEqual([track.locked, track.transitions, track.solo, track.volume, track.pan], [false, [], false, 0, 0]);
  // The v31→v32 mapping writes a schema-32 track; `mode` (schema 33) is absent and reads as "full".
  assert.deepEqual(doc.scenes[0].tracks.audio[0].ducking, { enabled: false, amount: 12, attack: 200, release: 500 });
  // Device-local data moved out of the canonical document.
  assert.deepEqual([doc.local.currentSceneId, doc.local.timelineViewState, doc.local.folderId, doc.local.trash], ["scene-main", { zoomLevel: 2, scrollLeft: 120, playheadTime: 240_000, scenePlayheads: {}, expandedKeyframeElementIds: [] }, null, null]);
  for (const gone of ["currentSceneId", "timelineViewState"]) assert.equal(gone in doc, false);
  // Media records become asset records plus device-local state; data URLs go to the thumbnail store.
  assert.deepEqual(doc.media.assets.map((asset: any) => asset.id), ["m-audio", "m-image", "m-video"]);
  const video = doc.media.assets[2];
  assert.deepEqual([video.duration, video.fps, video.hasAudio, video.lastModified_ms, video.kind, video.contentHash, video.provenance.source, video.created_ms], [1_200_000, { numerator: 30000, denominator: 1001 }, true, 1_700_000_000_000, null, null, "imported", NOW]);
  assert.equal(doc.media.assets[0].duration, 3_660_000, "30.5 s × 120 000");
  assert.deepEqual(doc.local.media["m-image"], { storage: "managed", canDecode: null, canDecodeSound: null, needsProbe: true, proxy: { state: "none" }, present: { original: false, proxy: false, mezzanine: false } });
  assert.deepEqual(thumbnails.map((entry) => [entry.owner, entry.id]), [["project", "classic-1"], ["asset", "m-image"]]);
  assert.equal(JSON.stringify(document).includes("data:image"), false, "no data URL remains in the record");
  assert.equal(migrate(classic.project()).document.settings.adoptCanvasFromFirstMedia, true, "armed while no scene holds a video or image element");
});

test("Identifiers — Scenario: Classic id kept", () => {
  const { document } = migrate(classic.project({ main: [classic.video("aB3_x")] }));
  assert.equal(element(document, "aB3_x").id, "aB3_x");
  assert.equal(document.scenes[0].id, "scene-main");
  assert.equal(document.scenes[0].tracks.main.id, "track-main");
});

// Requirement: Classic values without a counterpart
test("Classic values without a counterpart — Scenario: Unregistered params key", () => {
  const { document, report } = migrate(classic.project({ main: [classic.image("i1", 0, 2, { customGlow: 3 })] }));
  assert.equal("customGlow" in element(document, "i1"), false);
  assert.deepEqual(report, [{ path: "/scenes/@scene-main/tracks/main/elements/@i1", classicKey: "customGlow", reason: "unregistered" }]);
  assert.equal(droppedCount(report), 1, "\"1 items from the original project have no equivalent and were not migrated\"");
});

test("Classic values without a counterpart — Scenario: Clean project", () => {
  for (const name of ["video", "image", "audio", "text", "sticker", "graphic", "standalone-effect", "backgrounds"]) {
    const { report } = migrate(FIXTURES[name]());
    assert.deepEqual(report, [], `${name}: nothing dropped, so no notice is shown`);
  }
});

test("Classic values without a counterpart — Scenario: Backup keeps the original", () => {
  // The step is pure: the record handed in (what the backup stores) is not touched, byte for byte.
  const source = classic.project({ main: [classic.video("v1", 0, 2, { customGlow: 3 })], overlay: [classic.track("t-text", "text", [classic.text("x1", 0, 2, { textDecoration: "underline" })])], bookmarks: [{ time: 360_000 }] });
  const before = JSON.stringify(source);
  migrate(source);
  assert.equal(JSON.stringify(source), before);
  const backup = JSON.parse(before);
  assert.deepEqual(backup.scenes[0].tracks.main.elements[0].params.customGlow, 3);
  assert.deepEqual([backup.scenes[0].bookmarks.length, backup.metadata.createdAt, backup.scenes[0].tracks.overlay[0].elements[0].params.textDecoration], [1, "2025-03-04T05:06:07.000Z", "underline"]);
});

test("Classic values without a counterpart: an unknown shape, a malformed sticker and an unmapped animation path are listed, never silent", () => {
  const { document, report } = migrate(classic.project({
    main: [classic.video("v1", 0, 2, {}, { buffer: {}, animations: { "transform.skewX": scalar(key("k1", 0, 1)) } })],
    overlay: [classic.track("t-graphic", "graphic", [classic.graphic("blob", "squiggle", 0, 2), classic.sticker("bad", 2, 2, {}, { stickerId: "nocolon" }), classic.sticker("ok", 4, 2)])],
  }));
  assert.deepEqual(document.scenes[0].tracks.overlay[0].elements.map((entry) => entry.id), ["ok"]);
  assert.equal("buffer" in element(document, "v1"), false);
  assert.deepEqual(report.map((entry) => [entry.reason, entry.path.split("/elements/@")[1]]).sort(), [["no-animation-path", "v1/animations/transform.skewX"], ["removed-element", "bad"], ["removed-element", "blob"]]);
  assert.equal(droppedCount(report), 3);
  strictlyValid(document);
});

test("Classic v31 mapping: the step is deterministic and fails closed", () => {
  const first = migrate(FIXTURES.video()), second = migrate(FIXTURES.video());
  assert.equal(canonicalize(first.document), canonicalize(second.document), "the same inputs and id source give the same bytes");
  assert.throws(() => migrate({ version: 31, metadata: { id: "p" }, scenes: "nope" }), { name: "MigrationFailed" });
});
