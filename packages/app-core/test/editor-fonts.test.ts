import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { availableWeights, BASELINE_FONTS, bundledFamilyOf, documentTexts, engineFontSources, fallbackFamiliesFor, fontPickerRows, hasItalicFace, isFontAvailable, pushRecentFont, toggleFavoriteFont, type BundledFace } from "../src/index.ts";

// The real manifest of the bundled fonts (packages/render/assets/fonts), as the app's generated face list reads it.
const manifest = JSON.parse(readFileSync(new URL("../../render/assets/fonts/fonts.manifest.json", import.meta.url), "utf8")) as { fonts: { fontId: string; family: string; file: string; weight: number; style: "normal" | "italic"; load: "engine" | "on-demand"; licence: string; sourceUrl: string; sha256: string }[] };
const FACES: BundledFace[] = manifest.fonts.map((font) => ({ fontId: font.fontId, family: font.family, url: `/fonts/${font.file}`, weight: font.weight, style: font.style, load: font.load }));
const catalogue = readFileSync(new URL("../../../openspec/changes/build-jagentchill/specs/text-and-titles/catalog.md", import.meta.url), "utf8");

// text-and-titles — Requirement: Bundled fonts
test("Bundled fonts — Scenario: Catalogue matches the bundle", () => {
  const rows = catalogue.slice(catalogue.indexOf("## 1."), catalogue.indexOf("## 2.")).split("\n").filter((line) => /^\| (?!Family|---)/.test(line)).map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
  assert.equal(rows.length, 16);
  for (const [family, , styles, , , load] of rows) {
    const faces = FACES.filter((face) => face.family === family);
    const expected = family === "Noto Color Emoji" ? 1 : styles.split(",").length;
    assert.equal(faces.length, expected, `${family}: ${styles}`);
    assert.ok(faces.every((face) => face.load === (load === "Engine" ? "engine" : "on-demand")), `${family} load`);
  }
  assert.equal(FACES.length, rows.reduce((sum, [family, , styles]) => sum + (family === "Noto Color Emoji" ? 1 : styles.split(",").length), 0), "no unlisted font file");
});
test("Bundled fonts — Scenario: Provenance gate", () => {
  for (const font of manifest.fonts) assert.ok(font.licence && font.sourceUrl.startsWith("https://") && /^[0-9a-f]{64}$/.test(font.sha256), font.file);
});
test("Bundled fonts — Scenario: Baseline name on Linux host", () => {
  assert.deepEqual(BASELINE_FONTS.map((font) => [font.name, font.family]), [["Arial", "Arimo"], ["Helvetica", "Arimo"], ["Times New Roman", "Tinos"], ["Courier New", "Cousine"], ["Verdana", "DejaVu Sans"], ["Georgia", "Gelasio"], ["monospace", "Noto Sans Mono"], ["sans-serif", "Noto Sans"], ["serif", "Noto Serif"]]);
  for (const font of BASELINE_FONTS) assert.ok(isFontAvailable(font.name, FACES), font.name);
  assert.equal(bundledFamilyOf("times new roman"), "Tinos");
  assert.equal(isFontAvailable("Lobster", FACES), false);
});
test("Bundled fonts — Scenario: Offline CJK", () => {
  // Only the engine faces are handed over until a text needs another script; then that family follows, from the app bundle.
  const latin = engineFontSources(FACES, ["Xin chào"]);
  assert.ok(latin.every((face) => FACES.find((entry) => entry.fontId === face.fontId)!.load === "engine"));
  const japanese = engineFontSources(FACES, ["こんにちは"]).map((face) => face.family);
  assert.ok(japanese.includes("Noto Sans JP") && !japanese.includes("Noto Sans KR") && !japanese.includes("Noto Naskh Arabic"));
  assert.ok(engineFontSources(FACES, ["こんにちは"]).every((face) => face.url.startsWith("/fonts/")));
});
test("Bundled fonts — Scenario: Hindi offline", () => { assert.deepEqual(fallbackFamiliesFor("नमस्ते दुनिया"), ["Noto Sans Devanagari"]); });
test("Bundled fonts — Scenario: Every transcription language is covered", () => {
  const samples: Record<string, string> = { "Noto Sans JP": "日本語", "Noto Sans SC": "中文", "Noto Sans KR": "한국어", "Noto Naskh Arabic": "مرحبا", "Noto Sans Hebrew": "שלום", "Noto Sans Thai": "สวัสดี", "Noto Sans Devanagari": "नमस्ते", "Noto Color Emoji": "😀" };
  for (const [family, sample] of Object.entries(samples)) { assert.ok(fallbackFamiliesFor(sample).includes(family), family); assert.ok(FACES.some((face) => face.family === family), `${family} is bundled`); }
  assert.deepEqual(fallbackFamiliesFor("Xin chào Привет Γειά"), []);
  assert.deepEqual(documentTexts({ scenes: [{ tracks: { overlay: [{ elements: [{ type: "text", content: "A" }, { type: "caption", text: "B", translation: "C" }, { type: "video" }] }], main: { elements: [] }, audio: [] } }] }), ["A", "BC"]);
});

// Requirement: Font weight, italic, underline and strikethrough
test("Font weight, italic, underline and strikethrough — Scenario: Available weights", () => {
  assert.deepEqual(availableWeights("Arial", FACES), [400, 700]);
  assert.deepEqual(availableWeights("monospace", FACES), [400, 700]);
});
test("Font weight, italic, underline and strikethrough — Scenario: Synthesised italic", () => {
  // Noto Sans Mono ships no italic face: the engine synthesises it; the families with one use it.
  assert.equal(hasItalicFace("monospace", FACES), false);
  assert.equal(hasItalicFace("Arial", FACES), true);
});

// Requirement: Font picker
test("Font picker — Scenario: Search", () => {
  assert.deepEqual(fontPickerRows("all", "", { favorites: [], recent: [] }), BASELINE_FONTS.map((font) => font.name));
  assert.deepEqual(fontPickerRows("all", "ROBO", { favorites: [], recent: [] }, ["Roboto Slab", "Inter"]), ["Roboto Slab"]);
  assert.deepEqual(fontPickerRows("all", "ser", { favorites: [], recent: [] }), ["sans-serif", "serif"]);
});
// Requirement: Font picker tabs, favourites and recents
test("Font picker tabs, favourites and recents — Scenario: Favourite a font", () => {
  const prefs = toggleFavoriteFont({ favorites: [], recent: [] }, "Georgia");
  assert.deepEqual(fontPickerRows("favorites", "", prefs), ["Georgia"]);
  assert.deepEqual(toggleFavoriteFont(prefs, "Georgia").favorites, []);
});
test("Font picker tabs, favourites and recents — Scenario: Recents order", () => {
  let prefs = { favorites: [] as string[], recent: [] as string[] };
  for (const family of ["Arial", "Georgia", "Arial"]) prefs = pushRecentFont(prefs, family);
  assert.deepEqual(fontPickerRows("recent", "", prefs), ["Arial", "Georgia"]);
  for (let index = 0; index < 30; index++) prefs = pushRecentFont(prefs, `Family ${index}`);
  assert.equal(prefs.recent.length, 20);
});
test("Font picker tabs, favourites and recents — Scenario: Empty tab", () => { assert.deepEqual(fontPickerRows("favorites", "", { favorites: [], recent: [] }), []); assert.deepEqual(fontPickerRows("recent", "", { favorites: [], recent: [] }), []); });

test("Emoji stickers: an emoji sticker asks the engine for the colour emoji family, like emoji in text", () => {
  const document = { scenes: [{ tracks: { overlay: [{ elements: [{ type: "sticker", stickerId: "emoji:1f600" }, { type: "sticker", stickerId: "user:abc" }] }], main: { elements: [] }, audio: [] } }] };
  assert.deepEqual(documentTexts(document), ["\u{1f600}"]);
  assert.ok(engineFontSources(FACES, documentTexts(document)).some((face) => face.family === "Noto Color Emoji"));
  assert.ok(!engineFontSources(FACES, []).some((face) => face.family === "Noto Color Emoji"), "the colour font is fetched only when something needs it");
});
