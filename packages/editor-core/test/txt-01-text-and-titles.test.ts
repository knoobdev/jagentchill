import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  applyStyleToAllText, applyTextPreset, clampTextAnimation, clampTextContent, copyTextStyle, otherTextElements, pasteTextStyle, renderedFontSize, saveTextPreset, searchTextTemplates, setElementFields, setTextAnimation,
  setTextBackground, setTextBoxMode, TEXT_REGISTRIES, validateProjectDocument, setTextBubble, storedFontSize, TEXT_ANIMATIONS, TEXT_BUBBLES, TEXT_PRESETS, TEXT_TEMPLATES, textAnimationsOf, textBarLabel, timeline, toggledBoldWeight, type SavedTextPreset,
} from "../src/index.ts";
import { context as baseContext, element, put, REGISTRIES, studio, text } from "./support/fixtures.ts";
import { el, ON, open as openSession, project, S, trackIdOf } from "./support/timeline.ts";

// The real text registries: the bundled animation and bubble ids.
const registries = { ...REGISTRIES, ...TEXT_REGISTRIES };
const context = () => baseContext({ registries });
const open = (doc: Parameters<typeof openSession>[0]) => openSession(doc, { registries });
const isValid = (doc: Parameters<typeof validateProjectDocument>[0]) => validateProjectDocument(doc, { mode: "strict", registries }).ok;

const catalogue = readFileSync(new URL("../../../openspec/changes/build-jagentchill/specs/text-and-titles/catalog.md", import.meta.url), "utf8").replace(/−/g, "-");
const rows = (from: string, to?: string): string[][] => catalogue.slice(catalogue.indexOf(from), to ? catalogue.indexOf(to) : undefined).split("\n").filter((line) => /^\| \d+ \|/.test(line)).map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim().replace(/`/g, "")));
const sceneId = "s1";

// Requirement: Add a text element
test("Add a text element — Scenario: Add by click", () => {
  const session = open(project());
  const result = session.execute(timeline.addDefaultText({ sceneId, time: 3 * S }), ON);
  assert.ok(result.ok);
  const added = el(session.document, session.selection.selectedElements[0]);
  assert.deepEqual([added.type, added.content, added.startTime, added.duration], ["text", "Default text", 3 * S, 360_000]);
  assert.equal(session.document.scenes[0].tracks.overlay.find((track) => track.id === trackIdOf(session.document, added.id))?.type, "text");
  assert.ok(isValid(session.document));
});
test("Add a text element — Scenario: Preference changed", () => {
  const session = open(project());
  session.execute(timeline.addDefaultText({ sceneId, time: 0, duration: 5 * S }), ON);
  assert.equal(el(session.document, session.selection.selectedElements[0]).duration, 600_000);
});
test("Add a text element — Scenario: Add by drag to the canvas", () => {
  const session = open(project());
  session.execute(timeline.addDefaultText({ sceneId, time: 0, position: { x: 200, y: -300 } }), ON);
  assert.deepEqual(el(session.document, session.selection.selectedElements[0]).transform.position, { x: 200, y: -300 });
});
test("Add a text element — Scenario: Undo", () => {
  const session = open(project());
  session.execute(timeline.addDefaultText({ sceneId, time: 0 }), ON);
  assert.equal(session.document.scenes[0].tracks.overlay.length, 1);
  session.undo();
  assert.equal(session.document.scenes[0].tracks.overlay.length, 0);
});

// Requirement: Text content
test("Text content — Scenario: Multi-line content", () => {
  assert.equal(textBarLabel("Line one\nLine two"), "Line one");
  assert.equal(textBarLabel("\n  \nSecond"), "Second");
  assert.equal(textBarLabel(""), "Text");
  assert.equal(textBarLabel("x".repeat(45)).length, 30);
});
test("Text content — Scenario: Name is separate from the bar label", () => {
  const session = open(put(project(), "t-main"));
  session.execute(timeline.addDefaultText({ sceneId, time: 0, fields: { content: "Hello" } }), ON);
  const id = session.selection.selectedElements[0];
  assert.deepEqual([el(session.document, id).name, textBarLabel(el(session.document, id).content)], ["Text", "Hello"]);
});
test("Text content — Scenario: Length limit", () => {
  const { content, shortened } = clampTextContent("é".repeat(12_000));
  assert.deepEqual([Array.from(content).length, shortened], [10_000, true]);
  assert.deepEqual(clampTextContent("short"), { content: "short", shortened: false });
});

// Requirement: Text parameter table
test("Text parameter table — Scenario: Defaults", () => {
  const stored = text("x") as any;
  const defaults = { content: "Default text", fontFamily: "Arial", fontSize: 15, fontWeight: 400, fontStyle: "normal", underline: false, strikethrough: false, textCase: "none", color: "#ffffff", textAlign: "center", letterSpacing: 0, lineHeight: 1.2, curve: 0 };
  for (const [key, value] of Object.entries(defaults)) assert.equal(stored[key], value, key);
  assert.deepEqual([stored.fill, stored.box], [{ type: "solid", gradientColor: "#ffd400", gradientAngle: 90 }, { mode: "auto", width: 80 }]);
});
test("Text parameter table — Scenario: Clamp", () => { assert.equal(storedFontSize(900), 500); assert.equal(storedFontSize(0), 1); });
test("Text parameter table — Scenario: Fractional font size is kept", () => { assert.deepEqual([4.5, 3.5, 4.44].map(storedFontSize), [4.5, 3.5, 4.4]); });
test("Text parameter table — Scenario: Stepper uses 0.5", () => { assert.equal(storedFontSize(5 + 0.5), 5.5); });

// Requirement: Font size relative to canvas height
test("Font size relative to canvas height — Scenario: 1080p", () => { assert.equal(renderedFontSize(15, 1080), 180); });
test("Font size relative to canvas height — Scenario: Resolution change", () => { assert.equal(renderedFontSize(15, 2160), 360); assert.equal(renderedFontSize(15, 2160) / 2160, renderedFontSize(15, 1080) / 1080); });

// Requirement: Font weight, italic, underline and strikethrough
test("Font weight, italic, underline and strikethrough — Scenario: Underline and strikethrough together", () => {
  const doc = put(studio(), "t-text", text("x"));
  const after = setElementFields(doc, context(), "x", { underline: true, strikethrough: true }).document;
  assert.deepEqual([element(after, "x").underline, element(after, "x").strikethrough], [true, true]);
  assert.deepEqual([toggledBoldWeight(400), toggledBoldWeight(700), toggledBoldWeight(400, [300, 500, 800]), toggledBoldWeight(800, [300, 500, 800])], [700, 400, 800, 300]);
});

// Requirement: Text box and auto-wrap
test("Text box and auto-wrap — Scenario: Switch to fixed", () => {
  const doc = put(studio(), "t-text", text("x"));
  const after = setTextBoxMode(doc, context(), "x", "fixed", 600).document;
  // 600 px of a 1920 px canvas.
  assert.deepEqual(element(after, "x").box, { mode: "fixed", width: 31.3 });
  assert.equal(element(setTextBoxMode(after, context(), "x", "auto").document, "x").box.mode, "auto");
});

// Requirement: Text background
test("Text background — Scenario: Enable background", () => {
  const doc = put(studio(), "t-text", text("x"));
  const background = element(setTextBackground(doc, context(), "x", { enabled: true }).document, "x").background;
  assert.deepEqual(background, { enabled: true, color: "#000000", cornerRadius: 0, paddingX: 30, paddingY: 42, offsetX: 0, offsetY: 0 });
});

// Requirement: Copy, paste and apply text style
test("Copy, paste and apply text style — Scenario: Paste to several elements", () => {
  const styled = text("a", 0, 2, { content: "A", fontFamily: "Georgia", fontSize: 22, color: "#ff0000", stroke: { enabled: true, width: 9 }, shadow: { enabled: true }, glow: { enabled: true }, background: { enabled: true }, textAnimation: { in: { id: "in-fade", duration: 60_000 } } });
  const doc = put(studio(), "t-text", styled, text("b", 2, 2, { content: "B", transform: { position: { x: 40, y: 0 } } }), text("c", 4, 2, { content: "C" }));
  const session = open(doc);
  const style = copyTextStyle(session.document, "a");
  assert.equal("content" in style || "transform" in style || "opacity" in style || "blendMode" in style || "textAnimation" in style, false);
  assert.ok(session.adoptCommit(pasteTextStyle(session.document, context(), ["b", "c"], style), session.document).ok);
  for (const id of ["b", "c"]) {
    const target = el(session.document, id);
    assert.deepEqual([target.fontFamily, target.fontSize, target.color, target.stroke.width, target.shadow.enabled, target.glow.enabled, target.background.enabled], ["Georgia", 22, "#ff0000", 9, true, true, true], id);
    assert.equal(target.textAnimation, undefined);
  }
  assert.deepEqual([el(session.document, "b").content, el(session.document, "b").transform.position.x, el(session.document, "c").content], ["B", 40, "C"]);
  session.undo();
  assert.deepEqual([el(session.document, "b").fontFamily, el(session.document, "c").fontFamily], ["Arial", "Arial"]);
});
test("Copy, paste and apply text style — Scenario: Nothing copied", () => {
  // The screen disables "Paste style" while it holds no copied style; the engine needs one to paste.
  const doc = put(studio(), "t-text", text("a", 0, 2, { color: "#00ff00" }), text("b", 2, 2), text("c", 4, 2));
  assert.deepEqual(otherTextElements(doc, sceneId, "a").sort(), ["b", "c"]);
  const after = applyStyleToAllText(doc, context(), sceneId, "a").document;
  assert.deepEqual([element(after, "b").color, element(after, "c").color], ["#00ff00", "#00ff00"]);
});

// Requirement: Text effect presets
test("Text effect presets — Scenario: Exactly 40 offline", () => {
  assert.equal(TEXT_PRESETS.length, 40);
  assert.deepEqual(TEXT_PRESETS.map((preset) => preset.id), rows("## 2.", "## 3.").map((row) => row[1]));
  assert.deepEqual([...new Set(TEXT_PRESETS.map((preset) => preset.group))], ["Basic", "Outline", "Shadow", "Neon", "Gradient"]);
});
test("Text effect presets — Scenario: Apply a preset", () => {
  const doc = put(studio(), "t-text", text("x", 0, 2, { content: "Keep", fontFamily: "Georgia", stroke: { enabled: true }, shadow: { enabled: true } }));
  const after = element(applyTextPreset(doc, context(), ["x"], "neon-pink").document, "x");
  assert.equal(after.color, "#ffe6f4");
  assert.deepEqual(after.glow, { enabled: true, color: "#ff2d92", intensity: 80, radius: 30 });
  assert.deepEqual([after.stroke.enabled, after.shadow.enabled, after.content, after.fontFamily, after.fill.type], [false, false, "Keep", "Georgia", "solid"]);
});
test("Text effect presets — Scenario: None", () => {
  const doc = put(studio(), "t-text", text("x", 0, 2, { color: "#123456", fill: { type: "gradient" }, stroke: { enabled: true }, shadow: { enabled: true }, glow: { enabled: true } }));
  const after = element(applyTextPreset(doc, context(), ["x"], null).document, "x");
  assert.deepEqual([after.stroke.enabled, after.shadow.enabled, after.glow.enabled, after.fill.type, after.color], [false, false, false, "solid", "#ffffff"]);
});
test("Text effect presets — Scenario: Catalogue data check", () => {
  const cell = (value: unknown) => (value === undefined ? "—" : Object.values(value as object).join(" "));
  rows("## 2.", "## 3.").forEach((row, index) => {
    const preset = TEXT_PRESETS[index];
    assert.deepEqual([preset.id, preset.name, preset.group, preset.color, preset.gradient ? `${preset.gradient.color} @ ${preset.gradient.angle}` : "—", cell(preset.stroke), cell(preset.shadow), cell(preset.glow)], row.slice(1), row[1]);
  });
});

// Requirement: Text bubbles
test("Text bubbles — Scenario: Exactly 20 offline", () => {
  const table = rows("## 3.", "## 4.");
  assert.equal(TEXT_BUBBLES.length, 20);
  table.forEach((row, index) => {
    const bubble = TEXT_BUBBLES[index];
    assert.deepEqual([bubble.id, bubble.name, bubble.group, bubble.path, bubble.textArea.join(", "), bubble.color, bubble.strokeColor, String(bubble.strokeWidth)], row.slice(1), row[1]);
  });
});
test("Text bubbles — Scenario: Apply a bubble", () => {
  const doc = put(studio(), "t-text", text("x"));
  const after = setTextBubble(doc, context(), "x", "speech-round-left").document;
  assert.deepEqual(element(after, "x").bubble, { id: "speech-round-left", color: "#ffffff", strokeColor: "#000000", strokeWidth: 4, flipHorizontal: false });
  assert.equal(element(setTextBubble(after, context(), "x", null).document, "x").bubble, undefined);
});
test("Text bubbles — Scenario: Exclusive with background", () => {
  const session = open(put(project(), "t-main"));
  session.execute(timeline.addDefaultText({ sceneId, time: 0, fields: { background: { enabled: true } } }), ON);
  const id = session.selection.selectedElements[0];
  session.adoptCommit(setTextBubble(session.document, context(), id, "label-pill"), session.document);
  assert.deepEqual([el(session.document, id).background.enabled, el(session.document, id).bubble.id], [false, "label-pill"]);
  session.undo();
  assert.deepEqual([el(session.document, id).background.enabled, el(session.document, id).bubble], [true, undefined]);
  // The other way round: turning the background on removes the bubble.
  session.redo();
  session.adoptCommit(setTextBackground(session.document, context(), id, { enabled: true }), session.document);
  assert.deepEqual([el(session.document, id).background.enabled, el(session.document, id).bubble], [true, undefined]);
});

// Requirement: Text templates
test("Text templates — Scenario: Exactly 30 offline", () => {
  const table = rows("## 5.");
  assert.equal(TEXT_TEMPLATES.length, 30);
  table.forEach((row, index) => assert.deepEqual([TEXT_TEMPLATES[index].id, TEXT_TEMPLATES[index].name, TEXT_TEMPLATES[index].category, `${TEXT_TEMPLATES[index].duration} s`], row.slice(1, 5), row[1]));
  const count = (category: string) => TEXT_TEMPLATES.filter((template) => template.category === category).length;
  assert.deepEqual(["Titles", "Lower thirds", "Subtitles", "Social", "Quotes", "Callouts"].map(count), [6, 6, 4, 5, 4, 5]);
  // Every sample text, preset, bubble and animation a row names is in the data, and only bundled ids are used.
  table.forEach((row, index) => {
    const template = TEXT_TEMPLATES[index], texts = template.members.filter((member) => member.kind === "text");
    assert.deepEqual(texts.map((member) => member.content), [...row[5].matchAll(/«([^»]*)»/g)].map((match) => match[1]), `${template.id} sample text`);
    const used = new Set(texts.flatMap((member) => [member.preset, member.bubble?.id, member.in?.[0], member.out?.[0], member.loop?.[0]]).filter(Boolean));
    const named = new Set([...row[5].matchAll(/(?:^|[\s,·])((?:in|out|loop)-[a-z-]+|[a-z]+(?:-[a-z]+)+)(?=[\s,;·]|$)/g)].map((match) => match[1]).filter((id) => TEXT_PRESETS.some((preset) => preset.id === id) || TEXT_BUBBLES.some((bubble) => bubble.id === id) || TEXT_ANIMATIONS.some((animation) => animation.id === id)));
    assert.deepEqual([...used].sort(), [...named].sort(), `${template.id} ids`);
  });
  assert.deepEqual(searchTextTemplates("lower").length, 6);
  assert.ok(searchTextTemplates("typewriter").some((template) => template.id === "title-typed"));
});
test("Text templates — the members of a template stack in catalogue order, whatever tracks the scene already has", () => {
  const session = open(project());
  // A text that already lies on the timeline elsewhere leaves a text track the template could reuse out of order.
  session.execute(timeline.addDefaultText({ sceneId, time: 20 * S }), ON);
  for (const time of [2 * S, 2 * S + S / 2]) {
    const result = session.execute(timeline.addTextTemplate({ sceneId, templateId: "lower-third-bar", time }), ON);
    assert.ok(result.ok);
    const overlay = session.document.scenes.find((scene) => scene.id === sceneId).tracks.overlay;
    // Index 0 is the topmost track: the bar is under the name, the name under the role.
    const level = (match) => overlay.findIndex((track) => track.elements.some((element) => session.selection.selectedElements.includes(element.id) && match(element)));
    const bar = level((element) => element.type === "graphic"), name = level((element) => element.content === "Full Name"), role = level((element) => element.content === "Title or role");
    assert.ok(role < name && name < bar, `role ${role} above name ${name} above bar ${bar}`);
  }
});
test("Text templates — Scenario: Add a template", () => {
  const session = open(project());
  const result = session.execute(timeline.addTextTemplate({ sceneId, templateId: "lower-third-bar", time: 2 * S }), ON);
  assert.ok(result.ok);
  const members = session.selection.selectedElements.map((id) => el(session.document, id));
  assert.deepEqual(members.map((member) => member.type).sort(), ["graphic", "text", "text"]);
  assert.equal(new Set(members.map((member) => member.groupId)).size, 1);
  assert.ok(members[0].groupId);
  for (const member of members) assert.deepEqual([member.startTime, member.duration], [2 * S, 4 * S]);
  const title = members.find((member) => member.content === "Full Name");
  assert.deepEqual([title.fontWeight, title.fontSize, title.textAlign, title.textAnimation.in.id, title.transform.position], [700, 6, "left", "in-slide-right", { x: -0.28 * 1920, y: 0.32 * 1080 }]);
  assert.ok(isValid(session.document));
  session.undo();
  assert.equal(session.document.scenes[0].tracks.overlay.length, 0);
});
test("Text templates — every bundled template inserts as a valid group", () => {
  for (const template of TEXT_TEMPLATES) {
    const session = open(project());
    const result = session.execute(timeline.addTextTemplate({ sceneId, templateId: template.id, time: 0 }), ON);
    assert.ok(result.ok, `${template.id}: ${result.ok ? "" : result.message}`);
    assert.ok(isValid(session.document), template.id);
    assert.equal(session.selection.selectedElements.length, template.members.length, template.id);
  }
});
test("Text templates — Scenario: Edit template text", () => {
  const session = open(project());
  session.execute(timeline.addTextTemplate({ sceneId, templateId: "lower-third-bar", time: 0 }), ON);
  const title = session.selection.selectedElements.map((id) => el(session.document, id)).find((member) => member.content === "Full Name");
  session.adoptCommit(setElementFields(session.document, context(), title.id, { content: "Mai Nguyen" }), session.document);
  const after = el(session.document, title.id);
  assert.deepEqual([after.content, after.textAnimation, after.groupId], ["Mai Nguyen", title.textAnimation, title.groupId]);
});
test("Text templates — Scenario: Trim the group", () => {
  const session = open(project());
  session.execute(timeline.addTextTemplate({ sceneId, templateId: "title-stack", time: 0 }), ON);
  const ids = [...session.selection.selectedElements], groupId = el(session.document, ids[0]).groupId;
  // title-stack lasts 5 s; its subtitle starts at 0.3 s.
  assert.ok(session.execute(timeline.trimGroup({ sceneId, groupId, end: 3 * S }), ON).ok);
  for (const id of ids) {
    const member = el(session.document, id);
    assert.equal(member.startTime + member.duration, 3 * S, id);
    if (member.textAnimation?.out) assert.ok(member.textAnimation.in.duration + member.textAnimation.out.duration <= member.duration);
  }
  assert.equal(el(session.document, ids[2]).startTime, 0.3 * S);
});
test("Text inspector layout — Scenario: Templates sub-tab keeps the content", () => {
  const session = open(project());
  session.execute(timeline.addDefaultText({ sceneId, time: 4 * S, fields: { content: "Spring sale" } }), ON);
  const original = session.selection.selectedElements[0];
  assert.ok(session.execute(timeline.replaceTextWithTemplate({ sceneId, elementId: original, templateId: "lower-third-bar" }), ON).ok);
  const members = session.selection.selectedElements.map((id) => el(session.document, id));
  assert.equal(el(session.document, original), undefined);
  assert.deepEqual(members.filter((member) => member.type === "text").map((member) => member.content), ["Spring sale", "Title or role"]);
  assert.ok(members.every((member) => member.startTime === 4 * S));
  session.undo();
  assert.equal(el(session.document, original).content, "Spring sale");
});
test("Text inspector layout — Scenario: Section toggles", () => {
  const doc = put(studio(), "t-text", text("x"));
  const after = setElementFields(doc, context(), "x", { stroke: { ...element(doc, "x").stroke, enabled: true } }).document;
  assert.deepEqual(element(after, "x").stroke, { enabled: true, color: "#000000", width: 6, position: "outside" });
});

// Requirement: Save a text preset
const saved = (name: string): SavedTextPreset => ({ id: name, name, style: {}, savedAt_ms: 1 });
test("Save a text preset — Scenario: Save and reuse", () => {
  const doc = put(studio(), "t-text", text("x", 0, 2, { color: "#ff00aa", fontFamily: "Georgia" }));
  const result = saveTextPreset([], { id: "p1", name: "  Brand title ", style: copyTextStyle(doc, "x"), savedAt_ms: 1 });
  assert.ok(result.ok);
  assert.equal(result.presets[0].name, "Brand title");
  const session = open(project());
  session.execute(timeline.addDefaultText({ sceneId, time: 0, fields: result.presets[0].style }), ON);
  const added = el(session.document, session.selection.selectedElements[0]);
  assert.deepEqual([added.color, added.fontFamily], ["#ff00aa", "Georgia"]);
});
test("Save a text preset — Scenario: Duplicate name", () => {
  const refused = saveTextPreset([saved("Brand")], { ...saved("Brand"), id: "new" });
  assert.deepEqual([refused.ok, refused.ok ? "" : refused.reason], [false, "duplicate"]);
  const both = saveTextPreset([saved("Brand")], { ...saved("Brand"), id: "new" }, "keep-both");
  assert.deepEqual(both.ok && both.presets.map((preset) => preset.name), ["Brand", "Brand 2"]);
  const replaced = saveTextPreset([saved("Brand")], { ...saved("Brand"), id: "new" }, "replace");
  assert.deepEqual(replaced.ok && replaced.presets.map((preset) => preset.id), ["new"]);
});
test("Save a text preset — Scenario: Limit", () => {
  const full = Array.from({ length: 200 }, (_, index) => saved(`Preset ${index}`));
  const result = saveTextPreset(full, saved("One more"));
  assert.deepEqual([result.ok, result.ok ? "" : result.message], [false, "Preset limit reached (200)"]);
});

// Requirement: Text animations in, out and loop
test("Text animations in, out and loop — Scenario: Exact counts offline", () => {
  assert.deepEqual([textAnimationsOf("in").length, textAnimationsOf("out").length, textAnimationsOf("loop").length], [20, 20, 12]);
  const table = [...rows("### 4.1", "### 4.2"), ...rows("### 4.2", "### 4.3"), ...rows("### 4.3", "## 5.")];
  table.forEach((row, index) => assert.deepEqual([TEXT_ANIMATIONS[index].id, TEXT_ANIMATIONS[index].name, TEXT_ANIMATIONS[index].unit, TEXT_ANIMATIONS[index].motion, TEXT_ANIMATIONS[index].easing], row.slice(1), row[1]));
});
test("Text animations in, out and loop — Scenario: Durations clamp", () => {
  const doc = put(studio(), "t-text", text("x", 0, 2, { textAnimation: { in: { id: "in-fade", duration: 1.5 * S } } }));
  const after = element(setTextAnimation(doc, context(), "x", "out", { id: "out-fade", duration: 1 * S }).document, "x").textAnimation;
  assert.deepEqual([after.in.duration, after.out.duration], [1 * S, 1 * S]);
  assert.equal(clampTextAnimation(2 * S, undefined, "in", { id: "in-fade", duration: 9 * S })!.in.duration, 2 * S);
  assert.equal(clampTextAnimation(2 * S, undefined, "in", { id: "in-fade", duration: 1 })!.in.duration, 0.1 * S);
});
test("Text animations in, out and loop — Scenario: Loop between in and out", () => {
  const animation = clampTextAnimation(5 * S, { in: { id: "in-fade", duration: 0.5 * S, strength: 100 }, out: { id: "out-fade", duration: 0.5 * S, strength: 100 } }, "loop", { id: "loop-pulse", period: 1 * S }) as any;
  // The loop plays between the end of In and the start of Out: 0.5 s to 4.5 s, four whole periods.
  assert.equal((5 * S - animation.in.duration - animation.out.duration) / animation.loop.period, 4);
  assert.equal(clampTextAnimation(5 * S, undefined, "loop", { id: "loop-pulse", period: 1 })!.loop.period, 0.2 * S);
});
test("Text animations in, out and loop — Scenario: Remove", () => {
  const doc = put(studio(), "t-text", text("x", 0, 2, { textAnimation: { in: { id: "in-fade", duration: 0.5 * S } } }));
  assert.equal(element(setTextAnimation(doc, context(), "x", "in", null).document, "x").textAnimation, undefined);
});
