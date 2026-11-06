// Token, contrast and lint scenarios of the design-system specification. `spec-tokens.json` holds the rows of the spec's tables.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { checkContrast, contrastRatio, familyOfPair, isPermittedPair, lowestOf, measurePairs } from "../src/contrast.ts";
import { lintSource } from "../scripts/lint-tokens.ts";
import {
  MARKER_COLORS, SPACE_VALUES, breakpoints, clipColorForTrack, colorTokens, control, controlHeight, densityDefaults, densityOf, elevationShadow, fontFamily, formFactorOf, iconSize, japaneseWeight,
  layout, motion, needsJapaneseFace, nextMarkerIndex, opacity, palettes, radius, resolveColor, space, typography, wfMotion, wfMotionFor, zIndex, type ColorToken,
} from "../src/tokens.ts";

const SPEC: Record<string, [string, string]> = JSON.parse(readFileSync(new URL("./spec-tokens.json", import.meta.url), "utf8"));
const same = (a: string, b: string) => a.replace(/\s/g, "").toUpperCase() === b.replace(/\s/g, "").toUpperCase();
const snapshot = (prefix?: string) => {
  for (const [token, [light, dark]] of Object.entries(SPEC)) {
    if (prefix && !token.startsWith(prefix)) continue;
    assert.ok(token in palettes.light && token in palettes.dark, `${token} is missing`);
    assert.ok(same(palettes.light[token as ColorToken], light), `${token} light: ${palettes.light[token as ColorToken]} ≠ ${light}`);
    assert.ok(same(palettes.dark[token as ColorToken], dark), `${token} dark: ${palettes.dark[token as ColorToken]} ≠ ${dark}`);
  }
};

test("Colour tokens — Scenario: Token values match in both themes", () => {
  assert.equal(Object.keys(SPEC).length, 159);
  snapshot();
  // No token is missing in either theme, and the package defines none the tables do not list (the two fixed QR tokens aside).
  for (const token of colorTokens) assert.ok(token in SPEC || token.startsWith("qr/"), `${token} is not in the specification`);
  assert.deepEqual(Object.keys(palettes.light), Object.keys(palettes.dark));
});
test("Workflow canvas tokens — Scenario: Token values match in both themes", () => {
  snapshot("wf/");
  assert.deepEqual(wfMotion, { layout: 320, camera: 400, pulse: 1600, easeInOut: "cubic-bezier(0.4, 0, 0.2, 1)" });
});
test("Colour tokens — Scenario: Status text uses the text-grade token", () => assert.equal(resolveColor("light", "success/text"), "#15733F"));
test("Colour tokens — Scenario: Primary button label in the dark theme", () => {
  assert.equal(palettes.dark.accent, "#4C8DFF");
  assert.equal(palettes.dark["text/on-accent"], "#0B1B3A");
  assert.equal(contrastRatio(palettes.dark["text/on-accent"], palettes.dark.accent).toFixed(2), "5.33");
});
test("Button — Scenario: Destructive button in the dark theme", () => {
  assert.equal(palettes.dark.danger, "#F26D63");
  assert.equal(palettes.dark["text/on-danger"], "#3A0D09");
  assert.equal(contrastRatio(palettes.dark["text/on-danger"], palettes.dark.danger).toFixed(2), "5.75");
});
test("Colour tokens — Scenario: Fill token used for text is rejected", () => {
  for (const fill of ["accent", "success", "warning", "danger", "purple"]) {
    const [finding] = lintSource("src/x.tsx", `<Text color="${fill}">Ready</Text>`);
    assert.equal(finding?.rule, "text-fill-token");
    assert.match(finding!.message, new RegExp(`${fill}/text`));
  }
  assert.equal(lintSource("src/x.tsx", `const s = { color: theme.color("danger") };`)[0]?.rule, "text-fill-token");
  assert.deepEqual(lintSource("src/x.tsx", `<Icon name="warn" color="danger" /><Text color="danger/text">x</Text>`), []);
});
test("Token source and theming contract — Scenario: Hard-coded value is rejected", () => {
  const findings = lintSource("packages/ui/src/card.tsx", `const a = 1;\nconst style = { backgroundColor: "#2F6FEB" };\nconst b = { color: "#FFFFFF" };`);
  assert.deepEqual(findings.map((finding) => [finding.file, finding.line, finding.rule]), [["packages/ui/src/card.tsx", 2, "literal-colour"], ["packages/ui/src/card.tsx", 3, "literal-colour"]]);
  assert.equal(lintSource("apps/app/app/home.tsx", `<View style={{ backgroundColor: "rgba(0,0,0,0.4)" }} />`)[0]?.rule, "literal-colour");
  assert.deepEqual(lintSource("src/x.tsx", `const id = "#components"; // #FFFFFF in a comment`), []);
});
test("Spacing, radius and border tokens — Scenario: Off-grid spacing is rejected", () => {
  assert.equal(lintSource("src/x.tsx", `const s = { marginTop: 10 };`)[0]?.rule, "off-grid-spacing");
  assert.equal(lintSource("src/x.tsx", `const s = { paddingHorizontal: 14, gap: 7 };`).length, 2);
  assert.deepEqual(lintSource("src/x.tsx", `const s = { padding: 12, marginStart: -4, gap: 6, paddingVertical: cardRow.paddingVertical };`), []);
  assert.deepEqual([...SPACE_VALUES].sort((a, b) => a - b), [0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64]);
  assert.deepEqual(space, { 0: 0, 0.5: 2, 1: 4, 1.5: 6, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64 });
  assert.deepEqual([radius.none, radius.xs, radius.sm, radius.md, radius.lg, radius.xl, radius.full], [0, 4, 6, 8, 12, 16, 9999]);
});

test("Contrast pair matrix — Scenario: Every pair passes in both themes", () => {
  assert.deepEqual(checkContrast().map((failure) => failure.message), []);
  const all = [...measurePairs(palettes.light, "light"), ...measurePairs(palettes.dark, "dark")];
  assert.equal(Math.min(...all.filter((pair) => pair.kind === "text").map((pair) => pair.ratio)), 4.55);
  assert.equal(Math.min(...all.filter((pair) => pair.kind === "non-text").map((pair) => pair.ratio)), 3.2);
  // The lowest ratio of each family, as the matrix states them.
  const expected: Array<[string, number, number]> = [
    ["Body text", 4.55, 5.1], ["Link, token-chip and selected-chip text", 4.87, 6.9], ["Status text", 5.04, 5.21], ["Neutral text on tinted fills", 4.58, 4.75], ["Placeholder text", 4.69, 4.86],
    ["Primary button label", 4.57, 5.33], ["Destructive button label", 4.77, 5.75], ["Strong button, tooltip and toast text and icons", 12.63, 14.87], ["Control boundary", 3.37, 3.63],
    ["Switch and slider thumb", 3.95, 3.2], ["Accent icon on its tint", 3.99, 4.39], ["Meaningful status icon", 3.45, 4.88], ["Invalid field border", 4.57, 5.28], ["Diff text", 11.73, 6.96],
    ["Diff gutter mark", 5.27, 5.2], ["Clip fill against the lane", 4.17, 3.36], ["Waveform on clip fill", 3.87, 3.87], ["Clipping tip on the waveform", 5.16, 5.16], ["Beat marker on an audio-bearing clip", 3.35, 3.35],
    ["Ruler text", 4.72, 5.79], ["Playhead, selection outline, marker outline, snap line", 3.95, 7.71], ["Preview handle and guide on the stage", 6.91, 8.56], ["Preview handle border on its fill", 4.57, 3.2],
    ["Avatar initials", 4.62, 4.62], ["Chart series", 3.26, 4.85], ["Chart axis text", 4.97, 5.52],
  ];
  for (const [family, light, dark] of expected) { assert.equal(lowestOf(family, "light").ratio, light, family); assert.equal(lowestOf(family, "dark").ratio, dark, family); }
});
test("Contrast pair matrix — Scenario: A regression is caught", () => {
  const dark = { ...palettes.dark, "text/on-accent": "#FFFFFF" };
  const failure = checkContrast({ light: palettes.light, dark }).find((item) => item.fg === "text/on-accent" && item.bg === "accent");
  assert.ok(failure);
  assert.equal(failure.scheme, "dark");
  assert.equal(failure.ratio.toFixed(2), "3.20");
  assert.equal(failure.minimum, 4.5);
  assert.match(failure.message, /text\/on-accent on accent, dark theme: 3\.20:1 is below the 4\.5:1 minimum/);
});
test("Contrast pair matrix — Scenario: Pair outside the matrix", () => {
  assert.equal(isPermittedPair("warning", "bg/app"), false);
  assert.equal(familyOfPair("warning", "bg/app"), null);
  assert.equal(familyOfPair("warning/text", "bg/app"), "Status text");
});
test("Contrast pair matrix — Scenario: Input boundary", () => {
  assert.equal(palettes.dark["border/control"], "#808080");
  assert.equal(contrastRatio(palettes.dark["border/control"], palettes.dark["bg/subtle"]).toFixed(2), "3.63");
});
test("Contrast pair matrix — the Increase contrast mapping passes too", () => {
  assert.equal(resolveColor("light", "border/hairline", true), palettes.light["border/control"]);
  assert.equal(resolveColor("dark", "text/secondary", true), palettes.dark["text/primary"]);
  assert.equal(resolveColor("dark", "text/placeholder", true), palettes.dark["text/primary"]);
});
test("Workflow canvas tokens — Scenario: Contrast of canvas colours", () => {
  for (const scheme of ["light", "dark"] as const) {
    const pairs = measurePairs(palettes[scheme], scheme).filter((pair) => pair.family === "Workflow canvas colours");
    assert.equal(pairs.length, (12 + 10 + 8 + 1) * 2);
    for (const pair of pairs) assert.ok(pair.ratio >= 3, `${pair.fg} on ${pair.bg} (${scheme}): ${pair.ratio}`);
  }
});
test("Workflow canvas tokens — Scenario: Reduced motion", () => {
  assert.deepEqual([wfMotionFor(true).layout, wfMotionFor(true).camera, wfMotionFor(true).pulse], [0, 0, 0]);
  assert.equal(wfMotionFor(false).layout, 320);
});
test("Terminal tokens — Scenario: Terminal follows the theme", () => {
  snapshot("terminal/");
  assert.equal(resolveColor("light", "terminal/bg"), "#FFFFFF");
  assert.equal(resolveColor("light", "terminal/fg"), "#1A1A1A");
  assert.equal(colorTokens.filter((token) => token.startsWith("terminal/ansi/")).length, 16);
});
test("Terminal tokens — Scenario: ANSI contrast gate", () => {
  for (const scheme of ["light", "dark"] as const) {
    for (const token of colorTokens.filter((item) => item.startsWith("terminal/ansi/"))) {
      if (scheme === "dark" && token === "terminal/ansi/black") continue;
      assert.ok(contrastRatio(palettes[scheme][token], palettes[scheme]["terminal/bg"]) >= 4.5, `${token} (${scheme})`);
    }
  }
  assert.ok(!checkContrast().some((failure) => failure.fg === "terminal/ansi/black"));
});
test("Editor colour tokens — Scenario: Clip type decides the fill", () => {
  for (const scheme of ["light", "dark"] as const) {
    assert.deepEqual([palettes[scheme]["clip/video"], palettes[scheme]["clip/audio"], palettes[scheme]["clip/caption"]], ["#2D6CEA", "#258154", "#906D15"]);
    for (const clip of ["clip/video", "clip/audio", "clip/caption"] as const) assert.ok(contrastRatio(palettes[scheme]["clip/label"], palettes[scheme][clip]) >= 4.7);
  }
});
test("Editor colour tokens — Scenario: Label over a filmstrip", () => assert.equal(contrastRatio(palettes.light["clip/label"], palettes.light["clip/label-scrim"], "#FFFFFF").toFixed(2), "5.74"));
test("Editor colour tokens — Scenario: Overlay clip colour", () => assert.equal(resolveColor("light", "clip/overlay"), "#5566E8"));
test("Editor colour tokens — Scenario: Muted and hidden are different (opacity tokens)", () => {
  assert.equal(opacity["waveform/muted"], 0.35);
  assert.equal(opacity["clip/hidden"], 0.5);
});
test("Editor colour tokens — Scenario: Marker palette", () => {
  let index = 0;
  const picked = [index, (index = nextMarkerIndex(index)), (index = nextMarkerIndex(index))].map((at) => MARKER_COLORS[at]![0]);
  assert.deepEqual(picked, ["marker/1", "marker/2", "marker/3"]);
  for (const token of picked) assert.equal(palettes.light[token], palettes.dark[token]);
  assert.deepEqual(MARKER_COLORS.map((entry) => entry[1]), ["Blue", "Green", "Yellow", "Orange", "Red", "Purple", "Pink", "Grey"]);
  assert.equal(nextMarkerIndex(7), 0);
  assert.equal(clipColorForTrack(0), "clip/video");
  assert.equal(clipColorForTrack(8), "clip/video");
});
test("Timeline atoms — Scenario: Clip label contrast gate", () => {
  for (const scheme of ["light", "dark"] as const) {
    const fills = measurePairs(palettes[scheme], scheme).filter((pair) => pair.family === "Clip label on clip fill");
    assert.equal(fills.length, 11);
    for (const pair of fills) assert.ok(pair.ratio >= 4.5, `${pair.bg}: ${pair.ratio}`);
    assert.ok(lowestOf("Clip label on the scrim", scheme).ratio >= 4.5);
  }
  const broken = checkContrast({ light: { ...palettes.light, "clip/video": "#9DBBF5" }, dark: palettes.dark });
  assert.ok(broken.some((failure) => failure.fg === "clip/label" && failure.bg === "clip/video"));
});
test("Data-visualisation tokens — chart colours reach 3:1 on their surfaces", () => {
  snapshot("chart/");
  assert.ok(lowestOf("Chart series", "light").ratio >= 3 && lowestOf("Chart series", "dark").ratio >= 3);
});

test("Typography tokens — Scenario: Body text metrics on desktop", () => {
  assert.equal(densityOf(1280, false), "regular");
  assert.deepEqual(typography.body.regular, { fontSize: 13, lineHeight: 19, fontWeight: "400" });
});
test("Typography tokens — Scenario: Compact-touch density on a phone", () => {
  assert.equal(densityOf(390, false), "touch");
  assert.deepEqual([typography.body.touch.fontSize, typography.body.touch.lineHeight], [15, 21]);
});
test("Typography tokens — Scenario: Compact-touch density on a tablet", () => {
  assert.equal(formFactorOf(1024), "wide");
  assert.equal(densityOf(1024, true), "touch");
});
test("Typography tokens — the scale, weights and faces", () => {
  const scale = Object.fromEntries(Object.entries(typography).map(([token, value]) => [token, [value.regular.fontSize, value.regular.lineHeight, Number(value.regular.fontWeight), value.touch.fontSize, value.touch.lineHeight]]));
  assert.deepEqual(scale, { caption: [11, 16, 500, 12, 16], meta: [12, 16, 400, 13, 18], body: [13, 19, 400, 15, 21], "body-medium": [13, 19, 500, 15, 21], "title-sm": [14, 20, 600, 15, 20], "title-md": [16, 22, 600, 20, 26], h1: [20, 28, 600, 20, 26], display: [28, 34, 600, 28, 34], mono: [12, 18, 400, 13, 20] });
  assert.match(fontFamily.ui, /^Inter, system-ui/);
  assert.match(fontFamily.mono, /^"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace$/);
});
test("Typography tokens — Scenario: Japanese text on Linux (face selection)", () => {
  assert.equal(needsJapaneseFace("ja"), true);
  assert.equal(needsJapaneseFace("en", "日本語のテキスト"), true);
  assert.equal(needsJapaneseFace("en", "Tiếng Việt"), false);
  assert.ok(fontFamily.uiJa.indexOf('"Noto Sans JP"') < fontFamily.uiJa.indexOf("system-ui"));
  assert.equal(japaneseWeight("500"), "600");
});
test("Elevation tokens — Scenario: Cards do not cast shadows / Scenario: Toast above modal (token values)", () => {
  assert.equal(elevationShadow(0), "none");
  assert.equal(elevationShadow(1), "0 1px 2px rgba(0,0,0,0.04), 0 2px 8px rgba(0,0,0,0.06)");
  assert.equal(elevationShadow(2), "0 4px 16px rgba(0,0,0,0.12)");
  assert.equal(elevationShadow(3), "0 12px 40px rgba(0,0,0,0.20)");
  assert.deepEqual([elevationShadow(1, "dark"), elevationShadow(2, "dark"), elevationShadow(3, "dark")], ["0 1px 2px rgba(0,0,0,0.40), 0 2px 8px rgba(0,0,0,0.40)", "0 4px 16px rgba(0,0,0,0.50)", "0 12px 40px rgba(0,0,0,0.60)"]);
  assert.deepEqual(zIndex, { base: 0, sticky: 100, drawer: 200, popover: 300, modal: 400, toast: 500, tooltip: 600 });
  assert.ok(zIndex.toast > zIndex.modal);
});
test("Motion tokens — Scenario: Popover enter / Scenario: Reduced motion (token values)", () => {
  assert.deepEqual([motion.fast, motion.base, motion.slow, motion.exit], [120, 160, 240, 120]);
  assert.equal(motion.easeEnter, "cubic-bezier(0.2, 0, 0, 1)");
  assert.equal(motion.easeExit, "cubic-bezier(0.4, 0, 1, 1)");
  assert.deepEqual([motion.popoverShift, motion.maxShift, motion.reducedFade], [4, 8, 120]);
});
test("Icon tokens — Scenario: Sidebar nav icon (sizes)", () => {
  assert.deepEqual(iconSize, { xs: 12, sm: 14, md: 16, lg: 20, "toolbar-touch": 22, xl: 24 });
  assert.equal(typography.body.regular.fontSize, 13);
});
test("Control size tokens and density rules — Scenario: Aligned controls", () => {
  assert.deepEqual(control, { xs: 24, sm: 28, md: 32, lg: 40, touch: 44, "editor-bar-compact": 44 });
  assert.equal(controlHeight("md", "regular"), 32);
  for (const size of ["xs", "sm", "md", "lg"] as const) assert.equal(controlHeight(size, "touch"), 44);
  assert.deepEqual(densityDefaults.regular, { row: 28, rowTwoLine: 44, button: 32, input: 32, inspectorField: 28, toolbarButton: 28, tabStrip: 36, topBar: 48, hitTarget: 24 });
  assert.deepEqual([densityDefaults.touch.row, densityDefaults.touch.rowTwoLine, densityDefaults.touch.toolbarButton, densityDefaults.touch.tabStrip, densityDefaults.touch.topBar, densityDefaults.touch.hitTarget], [44, 56, 44, 44, 56, 44]);
});
test("Control size tokens and density rules — Scenario: Pointer change on a touch laptop", () => {
  assert.equal(densityOf(1440, false), "regular");
  assert.equal(densityOf(1440, true), "touch");
  assert.equal(formFactorOf(1440), "wide");
});
test("Control size tokens and density rules — Scenario: Tablet keeps the wide layout with touch sizes (tokens)", () => {
  assert.equal(formFactorOf(1180), "wide");
  assert.equal(densityOf(1180, true), "touch");
  assert.equal(densityDefaults.touch.row, 44);
});
test("Breakpoints and layout constants — Scenario: Compact detection", () => {
  assert.equal(formFactorOf(719), "compact");
  assert.equal(formFactorOf(720), "medium");
  assert.deepEqual(breakpoints, { xs: 0, sm: 576, md: 720, lg: 992, xl: 1200 });
});
test("Breakpoints and layout constants — Scenario: Wide detection", () => {
  assert.equal(formFactorOf(991), "medium");
  assert.equal(formFactorOf(992), "wide");
  assert.deepEqual([layout.sidebar, layout.sidebarMin, layout.sidebarMax, layout.topBar, layout.topBarTouch, layout.secondaryHeader, layout.columnComposer, layout.columnSettings, layout.columnWide, layout.columnLongForm, layout.settingsNav, layout.sideSheet, layout.popoverMax, layout.popoverWideMax, layout.macTrafficLightInset],
    [240, 200, 360, 48, 56, 36, 720, 560, 760, 820, 240, 400, 320, 400, 78]);
  assert.deepEqual(layout.modal, { confirm: 360, form: 480, complex: 640 });
});
