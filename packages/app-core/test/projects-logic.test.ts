import assert from "node:assert/strict";
import { test } from "node:test";
import {
  batchExportState, binarySize, clampInput, compareNames, dimensionMessage, duplicateName, durationBadge, durationCell, durationInfo, EMPTY_SELECTION, foldText, FRAME_RATES,
  frameRateLabel, frameRateOptions, gridColumns, matchesQuery, moveFocus, normalizeName, packageFileName, parseDimension, presetOf, pruneSelection, scaleToShortSide, secondsToTicks,
  selectAllState, selectRange, sortProjects, SORT_KEYS, isPinned, pinTarget, toggleSelectAll, toggleSelected, CANVAS_PRESETS, GRADIENT_PRESETS, PATTERN_PRESETS, SOLID_SWATCHES, areaAllowed, SKELETON_COUNT,
} from "../src/index.ts";

const project = (name: string, updated_ms = 0, duration = 0, created_ms = 0) => ({ name, updated_ms, duration, created_ms });

test("Project search — Case-insensitive match: typing \"reel\" shows only \"Holiday Reel\"", () => {
  const names = ["Holiday Reel", "Promo"];
  assert.deepEqual(names.filter((name) => matchesQuery(name, "reel")), ["Holiday Reel"]);
  assert.equal(matchesQuery("Đà Lạt in 48 hours", "da lat"), true, "diacritic-insensitive");
  assert.equal(foldText("Café ÉTÉ"), "cafe ete");
  assert.deepEqual(names.filter((name) => matchesQuery(name, "")), names, "clearing the field restores the full list");
});

test("Project search — Hidden selections are dropped: the selection count is 0 once the filter hides the selected project", () => {
  const selected = toggleSelected(EMPTY_SELECTION, "promo");
  const displayed = [{ id: "reel", name: "Holiday Reel" }, { id: "promo", name: "Promo" }].filter((entry) => matchesQuery(entry.name, "reel")).map((entry) => entry.id);
  assert.equal(pruneSelection(selected, displayed).ids.size, 0);
});

test("Project sorting — Name sort: Alpha, beta, Clip 2, Clip 10", () => {
  const sorted = sortProjects([project("beta"), project("Alpha"), project("Clip 10"), project("Clip 2")], "name", "asc");
  assert.deepEqual(sorted.map((entry) => entry.name), ["Alpha", "beta", "Clip 2", "Clip 10"]);
  assert.ok(compareNames("clip 2", "Clip 2") === 0, "case-insensitive");
  // Ties are broken by Modified descending, whatever the order.
  assert.deepEqual(sortProjects([{ ...project("Same", 1), id: "old" }, { ...project("same", 9), id: "new" }], "name", "asc").map((entry) => entry.id), ["new", "old"]);
  assert.deepEqual(sortProjects([project("a", 1), project("b", 3), project("c", 2)], "modified", "desc").map((entry) => entry.name), ["b", "c", "a"], "default Modified descending");
});

test("Project sorting — Toggle order: Duration ascending toggled lists the longest project first", () => {
  const items = [project("short", 0, 10), project("long", 0, 900), project("mid", 0, 50)];
  assert.equal(sortProjects(items, "duration", "asc")[0].name, "short");
  assert.equal(sortProjects(items, "duration", "desc")[0].name, "long");
});

test("w7 shell item 2 — pinned projects stay first under every sort key and both orders; inside each group the chosen sort applies", () => {
  const items = [
    { ...project("delta", 40, 10, 4), id: "d", bytes: 100, pinned_ms: null }, { ...project("alpha", 10, 40, 1), id: "a", bytes: 400, pinned_ms: null },
    { ...project("charlie", 30, 20, 3), id: "c", bytes: 200, pinned_ms: 5000 }, { ...project("bravo", 20, 30, 2), id: "b", bytes: 300, pinned_ms: 9000 },
  ];
  const order = (key: Parameters<typeof sortProjects>[1], direction: "asc" | "desc") => sortProjects(items, key, direction).map((entry) => entry.id).join("");
  assert.equal(order("modified", "desc"), "cbda");
  assert.equal(order("modified", "asc"), "bcad");
  assert.equal(order("created", "asc"), "bcad");
  assert.equal(order("name", "asc"), "bcad");
  assert.equal(order("name", "desc"), "cbda");
  assert.equal(order("duration", "desc"), "bcad");
  assert.equal(order("size", "desc"), "bcad", "by size: the largest first, pinned ones before the rest");
  assert.equal(order("size", "asc"), "cbda");
  assert.deepEqual([...SORT_KEYS], ["modified", "created", "name", "duration", "size"]);
  // A project without the field (written by an older build) is not pinned.
  assert.equal(isPinned({}), false); assert.equal(isPinned({ pinned_ms: null }), false); assert.equal(isPinned({ pinned_ms: 1 }), true);
  // "Pin" on a selection pins when one of them is not pinned yet; when all are, it unpins.
  assert.equal(pinTarget([{ pinned_ms: 1 }, { pinned_ms: null }]), true); assert.equal(pinTarget([{ pinned_ms: 1 }, { pinned_ms: 2 }]), false);
});

test("Project views and view persistence — Duration badge: 3723 s reads \"1:02:03\"", () => {
  assert.equal(durationBadge(secondsToTicks(3723)), "1:02:03");
  assert.equal(durationBadge(secondsToTicks(192)), "03:12");
  assert.equal(durationCell(0), "—");
  assert.deepEqual([gridColumns(500), gridColumns(640), gridColumns(1024), gridColumns(1280), gridColumns(1280, true)], [1, 2, 3, 4, 2]);
  assert.equal(SKELETON_COUNT, 24);
});

test("Project multi-selection — Range selection: checking the 2nd and Shift-clicking the 5th selects 2 through 5", () => {
  const displayed = ["p1", "p2", "p3", "p4", "p5", "p6"];
  const range = selectRange(toggleSelected(EMPTY_SELECTION, "p2"), displayed, "p5");
  assert.deepEqual([...range.ids].sort(), ["p2", "p3", "p4", "p5"]);
  // The range is merged into what was selected already.
  assert.deepEqual([...selectRange({ ids: new Set(["p6", "p2"]), anchor: "p2" }, displayed, "p3").ids].sort(), ["p2", "p3", "p6"]);
});

test("Project multi-selection — Indeterminate: 2 of 6 selected is indeterminate and activating Select all selects all 6", () => {
  const displayed = ["p1", "p2", "p3", "p4", "p5", "p6"];
  const two = toggleSelected(toggleSelected(EMPTY_SELECTION, "p1"), "p4");
  assert.equal(selectAllState(two, displayed), "some");
  const all = toggleSelectAll(two, displayed);
  assert.equal(all.ids.size, 6);
  assert.equal(selectAllState(all, displayed), "all");
  assert.equal(toggleSelectAll(all, displayed).ids.size, 0, "Cancel clears the selection");
});

test("Bulk actions — Batch export bound: 21 selected disables \"Export video…\" with \"Select at most 20 projects\"", () => {
  assert.deepEqual(batchExportState(21), { enabled: false, reason: "atMost" });
  assert.deepEqual(batchExportState(1), { enabled: false, reason: "atLeast" });
  assert.deepEqual([batchExportState(2).enabled, batchExportState(20).enabled], [true, true]);
});

test("Rename project — Empty rename: a cleared field keeps the previous name (the Rename button is disabled)", () => {
  assert.equal(normalizeName("   "), null);
  assert.equal(normalizeName("  Launch video  "), "Launch video");
});

test("Rename project — Length bound: a pasted 150-character name leaves the first 120 characters in the field", () => {
  const pasted = "x".repeat(150);
  assert.equal(clampInput(pasted).length, 120);
  assert.equal(clampInput(pasted), pasted.slice(0, 120));
  assert.equal(normalizeName(pasted)?.length, 120);
});

test("Duplicate project — First and second duplicate: \"Trip\" twice gives \"(1) Trip\" and \"(2) Trip\"", () => {
  const taken = ["Trip"];
  const first = duplicateName("Trip", taken);
  taken.push(first);
  assert.deepEqual([first, duplicateName("Trip", taken)], ["(1) Trip", "(2) Trip"]);
});

test("Duplicate project — Duplicate of a duplicate: \"(2) Trip\" duplicated while (1) and (2) exist is \"(3) Trip\"", () => {
  assert.equal(duplicateName("(2) Trip", ["Trip", "(1) Trip", "(2) Trip"]), "(3) Trip");
  assert.equal(duplicateName("(7) Other", ["Trip", "(1) Trip"]), "(1) Other");
});

test("Project info — Info content: 90 s reads \"1:30\" and 350 MiB reads \"350.0 MiB\"", () => {
  assert.equal(durationInfo(secondsToTicks(90)), "1:30");
  assert.equal(durationInfo(0), "0:00");
  assert.equal(binarySize(350 * 1024 * 1024), "350.0 MiB");
});

test("Canvas size presets and custom size — Out-of-range custom value: width 9000 shows \"Width must be between 16 and 7680\"", () => {
  const result = parseDimension("9000", "Width");
  assert.equal(result.ok, false);
  assert.equal(dimensionMessage("Width"), "Width must be between 16 and 7680");
  assert.equal(parseDimension("12", "Height").ok, false);
  assert.equal(parseDimension("abc", "Height").ok, false);
  assert.equal(areaAllowed({ width: 7680, height: 4320 }), true);
  assert.equal(areaAllowed({ width: 7680, height: 7680 }), false);
});

test("Canvas size presets and custom size — Odd value: height 1081 becomes 1082", () => {
  assert.deepEqual(parseDimension("1081", "Height"), { ok: true, value: 1082 });
  assert.deepEqual(parseDimension("1000", "Width"), { ok: true, value: 1000 });
});

test("Canvas size presets and custom size — Ultra-wide preset: 21:9 is 2520 × 1080", () => {
  const preset = CANVAS_PRESETS.find((entry) => entry.ratio === "21:9")!;
  assert.deepEqual([preset.width, preset.height], [2520, 1080]);
  assert.deepEqual(CANVAS_PRESETS.map((entry) => entry.ratio), ["16:9", "9:16", "1:1", "4:3", "3:4", "4:5", "2:1", "2.35:1", "1.85:1", "21:9"]);
  assert.equal(presetOf({ width: 1080, height: 1920 })?.ratio, "9:16");
  assert.equal(presetOf({ width: 1000, height: 500 }), null);
  assert.deepEqual(scaleToShortSide({ width: 1920, height: 1080 }, 720), { width: 1280, height: 720 });
  assert.deepEqual(scaleToShortSide({ width: 1080, height: 1920 }, 2160), { width: 2160, height: 3840 });
});

test("Frame rate — NTSC rate: 29.97 stores numerator 30000 and denominator 1001", () => {
  const rate = FRAME_RATES.find((entry) => entry.label === "29.97")!;
  assert.deepEqual([rate.numerator, rate.denominator], [30000, 1001]);
  assert.equal(FRAME_RATES.length, 10);
  assert.equal(frameRateLabel({ numerator: 15, denominator: 1 }), "15.00", "a rate outside the list reads as a decimal with two fraction digits");
  assert.equal(frameRateOptions({ numerator: 15, denominator: 1 }).length, 11, "and stays selectable");
});

test("Frame rate — 48 fps: 48 stores numerator 48 and denominator 1", () => {
  const rate = FRAME_RATES.find((entry) => entry.label === "48")!;
  assert.deepEqual([rate.numerator, rate.denominator], [48, 1]);
});

test("Background colour and gradient — Catalogue counts: 24 solid swatches, 16 gradients and 16 patterns with the catalogue ids", () => {
  assert.deepEqual([SOLID_SWATCHES.length, GRADIENT_PRESETS.length, PATTERN_PRESETS.length], [24, 16, 16]);
  assert.equal(SOLID_SWATCHES.find((entry) => entry.id === "sw-red")?.color, "#e5383b");
  assert.ok(SOLID_SWATCHES.every((entry) => /^#[0-9a-f]{6}$/.test(entry.color!)), "colours are lowercase #rrggbb");
  assert.ok(GRADIENT_PRESETS.every((entry) => entry.id.startsWith("gr-")) && PATTERN_PRESETS.every((entry) => entry.id.startsWith("pt-")));
  assert.equal(new Set([...SOLID_SWATCHES, ...GRADIENT_PRESETS, ...PATTERN_PRESETS].map((entry) => entry.id)).size, 56);
});

test("Projects screen on mobile and keyboard access — arrow keys move focus between cards", () => {
  assert.equal(moveFocus(0, "ArrowRight", 8, 4), 1);
  assert.equal(moveFocus(1, "ArrowDown", 8, 4), 5);
  assert.equal(moveFocus(5, "ArrowDown", 8, 4), 5, "stays at the last row");
  assert.equal(moveFocus(0, "ArrowLeft", 8, 4), 0);
  assert.equal(moveFocus(3, "ArrowRight", 8, 4, true), 2, "mirrored in right-to-left layouts");
  assert.equal(moveFocus(2, "ArrowDown", 5, 1), 3, "one column in the list view");
  assert.equal(moveFocus(0, "a", 8, 4), null);
});

test("Project package export — default file name replaces characters illegal in file names with \"_\"", () => {
  assert.equal(packageFileName("Q4: promo/final?"), "Q4_ promo_final_.jagentchill");
  assert.equal(packageFileName("Trip"), "Trip.jagentchill");
});
