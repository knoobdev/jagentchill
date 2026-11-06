// Behaviour scenarios of the design-system specification that are decided by the package's pure logic. Timers are a fake clock.
import assert from "node:assert/strict";
import { test } from "node:test";
import { extractColor, hsvToRgb, parseHex, pushRecent, rgbToHsv, savedColors, toHex } from "../src/logic/color.ts";
import { backspaceAt, chartColor, chartTable, clipName, errorDetails, errorMessage, fitPills, groupSeries, rulerStep, sendKeyAction, sendState, textareaHeight } from "../src/logic/content.ts";
import { formatDate, formatRange, formatTime, parseDate, parseTime, pickRangeDay, presetRange, rangeTooLong, stepTime, weekdays } from "../src/logic/date.ts";
import { appMenuKeys, keycaps, shortcutText } from "../src/logic/keys.ts";
import { bulkState, canDrop, collapseBreadcrumb, filterOptions, flattenTree, moveIndex, toggleAll, treeKey, type TreeNode } from "../src/logic/lists.ts";
import { blockKey, highlight, parseMarkdown, visibleLines } from "../src/logic/markdown.ts";
import { commitInput, dragSession, evaluateExpression, scrubber, sliderKey } from "../src/logic/number.ts";
import { headingToward, place } from "../src/logic/position.ts";
import { QR, qrLayout, qrSymbol } from "../src/logic/qr.ts";
import { avatarFill, badgeCount, initials, statusTone, toneOfStatus, TONES, truncateMiddle, unmappedStatuses } from "../src/logic/status.ts";
import { closeDecision, modalQueue, needsTypedConfirmation, panelLayout, shouldDismiss } from "../src/logic/surfaces.ts";
import { debouncer, loadingFeedback, type Timers } from "../src/logic/timers.ts";
import { toastStore, TOAST } from "../src/logic/toast.ts";
import { resetTooltipWarmth, tooltipController, TOOLTIP } from "../src/logic/tooltip.ts";
import { resultCount, translator } from "../src/strings.ts";

function clock(): Timers & { advance(ms: number): void } {
  let now = 0, id = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now, set: (fn, ms) => { pending.set(++id, { at: now + ms, fn }); return id; }, clear: (handle) => { pending.delete(handle as number); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...pending.entries()].filter(([, item]) => item.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        pending.delete(next[0]); now = next[1].at; next[1].fn();
      }
      now = end;
    },
  };
}
const t = translator("en");

test("Search field — Scenario: Debounced search", () => {
  const time = clock();
  const calls: string[] = [];
  const search = debouncer((query: string) => calls.push(query), 200, time);
  for (const text of ["i", "in", "int", "intr", "intro"]) { search.call(text); time.advance(60); }
  assert.deepEqual(calls, []);
  time.advance(139);
  assert.deepEqual(calls, []);
  time.advance(1);
  assert.deepEqual(calls, ["intro"]);
});
test("Search field — Scenario: Result count is announced (text)", () => {
  assert.equal(resultCount(t, 0), "No results");
  assert.equal(resultCount(t, 12), "12 results");
  assert.equal(resultCount(t, 1), "1 result");
});
test("Comment avatars — initials use the first letter of the first two words", () => {
  assert.equal(initials("Anna (director)"), "AD");
  assert.equal(initials("Nguyễn Văn An"), "NV");
  assert.equal(initials("山田 太郎"), "山太");
});
test("Date, time and weekday fields — Scenario: Typed date in the locale format", () => {
  assert.equal(parseDate("05/10/2026", "vi"), "2026-10-05");
  assert.equal(parseDate("2026-10-05", "vi"), "2026-10-05");
  assert.equal(parseDate("31/02/2026", "vi"), null);
});
test("Date, time and weekday fields — Scenario: Range with a preset", () => {
  const range = presetRange("last7", "2026-10-05")!;
  assert.deepEqual(range, { start: "2026-09-29", end: "2026-10-05" });
  assert.equal(formatRange(range, "vi"), `${formatDate("2026-09-29", "vi")} – ${formatDate("2026-10-05", "vi")}`);
  assert.deepEqual(pickRangeDay({ start: "2026-10-05", end: null }, "2026-10-01"), { start: "2026-10-01", end: "2026-10-05" });
});
test("Date, time and weekday fields — Scenario: Range too long", () => {
  assert.equal(rangeTooLong({ start: "2025-09-01", end: "2026-10-05" }, 366), true);
  assert.equal(rangeTooLong({ start: "2025-10-05", end: "2026-10-05" }, 366), false);
  assert.equal(t("chooseAtMost", { n: 366 }), "Choose at most 366 days");
});
test("Date, time and weekday fields — Scenario: Time field in 12-hour form", () => {
  const time = parseTime("22:00")!;
  assert.equal(formatTime(time, true), "10:00 PM");
  assert.equal(formatTime(stepTime(time, "h", 1), true), "11:00 PM");
});
test("Date, time and weekday fields — Scenario: Week order follows the locale", () => {
  assert.deepEqual(weekdays("en-GB", 1).map((day) => day.full), ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
  assert.equal(weekdays("en-GB", 1)[0]!.narrow, "M");
});
test("Breadcrumb — Scenario: Collapsed middle segments", () => {
  assert.deepEqual(collapseBreadcrumb([70, 80, 80, 150, 60], 320, { separator: 20, ellipsis: 24 }), { visible: [0, 4], hidden: [1, 2, 3] });
  assert.deepEqual(collapseBreadcrumb([70, 80, 60], 400, { separator: 20, ellipsis: 24 }).hidden, []);
  assert.equal(truncateMiddle("Da Lat in forty-eight hours, vertical", 24).length, 24);
});
test("QR code view — Scenario: Same symbol in the dark theme (geometry)", () => {
  const symbol = qrSymbol("jagentchill://pair#offer=abc")!;
  const fit = qrLayout(symbol.count, 100);
  assert.ok(!("error" in fit) && fit.size >= 160);
  assert.equal(QR.quietZone, 4);
  assert.deepEqual(qrLayout(177, 220, 1), { error: "too-long" });
  assert.equal(qrSymbol("x".repeat(4000)), null);
  assert.equal(t("qrTooLong"), "This code is too long to show — use the link instead");
});
test("Markdown view and code block — Scenario: Raw HTML is inert", () => {
  assert.deepEqual(parseMarkdown("<img src=x onerror=alert(1)>"), [{ type: "paragraph", children: [{ type: "text", text: "<img src=x onerror=alert(1)>" }] }]);
  assert.deepEqual(parseMarkdown("a <b>bold</b>")[0], { type: "paragraph", children: [{ type: "text", text: "a <b>bold</b>" }] });
});
test("Markdown view and code block — Scenario: Streaming code fence", () => {
  const first = parseMarkdown("Here:\n\n```ts\none\ntwo\nthree");
  const second = parseMarkdown("Here:\n\n```ts\none\ntwo\nthree\nfour\nfive");
  assert.deepEqual(first[1], { type: "code", lang: "ts", text: "one\ntwo\nthree", open: true });
  assert.equal((second[1] as { text: string }).text, "one\ntwo\nthree\nfour\nfive");
  // The same key before and after: the block is updated in place, not re-created.
  assert.equal(blockKey(first[1]!, 1), blockKey(second[1]!, 1));
  assert.equal((parseMarkdown("```ts\na\n```\n")[0] as { open: boolean }).open, false);
  assert.equal(parseMarkdown("|a|b|\n")[0]!.type, "paragraph");
  assert.equal(parseMarkdown("|a|b|\n|-|-|\n")[0]!.type, "table");
});
test("Markdown view and code block — Scenario: Long block is collapsed", () => {
  const lines = Array.from({ length: 120 }, (_, i) => i);
  assert.deepEqual([visibleLines(lines, false).lines.length, visibleLines(lines, false).hidden], [30, 90]);
  assert.equal(t("showAllLines", { n: 120 }), "Show all 120 lines");
  assert.equal(highlight("const a = 1", "ts")[0]![0]!.kind, "keyword");
  assert.equal(highlight("const a = 1", "cobol")[0]![0]!.kind, "plain");
  assert.equal(highlight(Array.from({ length: 2001 }, () => "const a").join("\n"), "ts")[0]![0]!.kind, "plain");
});
test("Select and combobox — Scenario: Type-ahead filter", () => {
  const options = [{ label: "English" }, { label: "Tiếng Việt (Vietnamese)" }, { label: "日本語" }];
  assert.deepEqual(filterOptions(options, "viet"), [{ label: "Tiếng Việt (Vietnamese)" }]);
  assert.deepEqual(filterOptions(options, "TIENG"), [{ label: "Tiếng Việt (Vietnamese)" }]);
});
test("Select and combobox — Scenario: Empty result", () => {
  assert.deepEqual(filterOptions([{ label: "English" }], "zz"), []);
  assert.equal(t("noResults"), "No results");
});
test("Segmented control, tabs and tab strip — Scenario: Arrow key navigation (index)", () => {
  assert.equal(moveIndex(0, "ArrowRight", 3, { horizontal: true, wrap: true }), 1);
  assert.equal(moveIndex(0, "ArrowLeft", 3, { horizontal: true, wrap: true }), 2);
  assert.equal(moveIndex(1, "Home", 3, { horizontal: true }), 0);
  assert.equal(moveIndex(0, "ArrowLeft", 3, { horizontal: true, rtl: true, wrap: true }), 1);
});
test("Switch, checkbox and radio — Scenario: Indeterminate checkbox", () => {
  assert.equal(bulkState(2, 5), "some");
  assert.equal(bulkState(5, 5), "all");
  assert.equal(toggleAll(new Set(["a", "b"]), ["a", "b", "c", "d", "e"]).size, 5);
});
test("Slider — Scenario: One undo step per drag", () => {
  const live: number[] = [], commits: number[] = [];
  const frames: Array<() => void> = [];
  const session = dragSession({ onChange: (value) => live.push(value), onCommit: (value) => commits.push(value) }, (fn) => frames.push(fn));
  for (const value of [100, 90, 80]) session.update(value);
  frames.splice(0).forEach((fn) => fn());
  for (const value of [60, 40]) session.update(value);
  frames.splice(0).forEach((fn) => fn());
  session.end();
  // Two frames, two live previews; one commit with the final value.
  assert.deepEqual(live, [80, 40]);
  assert.deepEqual(commits, [40]);
});
test("Slider — Scenario: Reset to default (keyboard steps)", () => {
  assert.equal(sliderKey(50, "ArrowRight", false, { min: 0, max: 100 }), 51);
  assert.equal(sliderKey(50, "ArrowLeft", true, { min: 0, max: 100 }), 40);
  assert.equal(sliderKey(50, "PageUp", false, { min: 0, max: 100 }), 60);
  assert.equal(sliderKey(50, "Home", false, { min: 0, max: 100 }), 0);
});
test("Number field with scrubbing and expressions — Scenario: Expression evaluation", () => {
  assert.equal(commitInput("1920/2+10", {}), 970);
  assert.equal(evaluateExpression("(2+3)*-2"), -10);
});
test("Number field with scrubbing and expressions — Scenario: Invalid expression", () => {
  assert.equal(commitInput("12px", {}), null);
  assert.equal(commitInput("1/0", {}), null);
  assert.equal(commitInput("2+", {}), null);
});
test("Number field with scrubbing and expressions — Scenario: Scrub with modifier", () => {
  const scrub = scrubber(0, { step: 1, max: 400 });
  scrub.move(7, { shift: true });
  assert.equal(scrub.value(), 0, "the first move event is discarded");
  assert.equal(scrubber(0, { step: 1 }).move(1) , 0);
  const free = scrubber(0, { step: 1 }); free.move(0); assert.equal(free.move(50, { shift: true }), 500);
  assert.equal(scrub.move(50, { shift: true }), 400, "clamped to the field maximum");
  const slow = scrubber(0, { step: 1, slow: true }); slow.move(0); assert.equal(slow.move(10), 5);
  const fine = scrubber(0, { step: 1 }); fine.move(0); assert.equal(fine.move(10, { alt: true }), 1);
});
test("Number field with scrubbing and expressions — Scenario: Clamp", () => assert.equal(commitInput("500", { min: -360, max: 360 }), 360));
test("Colour picker — Scenario: Paste a colour", () => {
  const current = parseHex("#FF000080")!;
  assert.equal(toHex(extractColor("brand colour: #00ff00", current.a)!), "#00FF0080");
  assert.equal(toHex(extractColor("use #00ff00ff", current.a)!), "#00FF00");
  for (const hex of ["#abc", "abcd", "AABBCC", "#AABBCCDD"]) assert.ok(parseHex(hex));
  assert.equal(parseHex("#12345"), null);
});
test("Colour picker — Scenario: Grey keeps its hue", () => {
  const grey = hsvToRgb({ h: 210, s: 0, v: 0.6, a: 1 });
  assert.equal(rgbToHsv(grey, 210).h, 210);
  assert.equal(Math.round(rgbToHsv(hsvToRgb({ ...rgbToHsv(grey, 210), s: 0.5 })).h), 210);
});
test("Colour picker — Scenario: Saved colours persist (list rules)", () => {
  const saved = savedColors.add([], "#2F6FEB");
  assert.deepEqual(savedColors.parse(JSON.stringify(saved)), ["#2F6FEB"]);
  assert.equal(savedColors.add(Array.from({ length: 48 }, (_, i) => `#0000${String(i).padStart(2, "0")}`), "#FFFFFF").length, 48);
  assert.equal(pushRecent(Array.from({ length: 12 }, (_, i) => `#0000${String(i).padStart(2, "0")}`), "#FFFFFF").length, 12);
});
test("Chips, tags and token chips — Scenario: Token chip deletion", () => {
  const parts = ["Ask ", { token: "user:mai", label: "Mai" }, " to review"];
  assert.deepEqual(backspaceAt(parts, 5), { parts: ["Ask  to review"], caret: 4 });
  assert.deepEqual(backspaceAt(parts, 4).parts, ["Ask", { token: "user:mai", label: "Mai" }, " to review"]);
});
test("Chips, tags and token chips — Scenario: Attachment upload failure", () => {
  assert.deepEqual(sendState({ text: "go", attachments: [{ status: "failed" }], running: false }), { mode: "send", enabled: false });
  assert.equal(sendState({ text: "go", attachments: [{ status: "ready" }], running: false }).enabled, true);
});
test("Table — Scenario: Bulk selection (state)", () => {
  assert.equal(bulkState(3, 9), "some");
  assert.equal(t("selected", { n: 3 }), "3 selected");
  assert.equal(t("noResultsFor", { query: "lantern" }), "No results for “lantern”");
});
const TREE: TreeNode[] = [{ id: "a", label: "Footage", children: [{ id: "b", label: "Day 1", children: [{ id: "c", label: "clip" }] }] }, { id: "d", label: "Music" }];
test("Tree — Scenario: Keyboard expand and collapse", () => {
  const closed = flattenTree(TREE, new Set());
  assert.deepEqual(treeKey(closed, 0, "ArrowRight"), { focus: 0, expand: ["a"] });
  const open = flattenTree(TREE, new Set(["a"]));
  assert.deepEqual(treeKey(open, 0, "ArrowLeft"), { focus: 0, collapse: "a" });
  assert.deepEqual(treeKey(open, 0, "ArrowRight"), { focus: 1 });
  assert.deepEqual(treeKey(open, 1, "ArrowLeft"), { focus: 0 });
});
test("Tree — Scenario: Invalid drop", () => {
  assert.equal(canDrop(TREE, "a", "c"), false);
  assert.equal(canDrop(TREE, "a", "a"), false);
  assert.equal(canDrop(TREE, "c", "d"), true);
});
test("Tooltip — Scenario: Delay and flip", () => {
  resetTooltipWarmth();
  const time = clock(); const seen: boolean[] = [];
  const tip = tooltipController((visible) => seen.push(visible), time);
  tip.pointerEnter(); time.advance(499); assert.deepEqual(seen, []);
  time.advance(1); assert.deepEqual(seen, [true]);
  const at = place({ anchor: { x: 100, y: 4, width: 28, height: 28 }, size: { width: 80, height: 24 }, viewport: { width: 800, height: 600 }, side: "top", align: "center", offset: 6 });
  assert.equal(at.side, "bottom");
  assert.equal(at.y, 4 + 28 + 6);
});
test("Tooltip — Scenario: Touch long-press", () => {
  const time = clock(); const seen: boolean[] = [];
  const tip = tooltipController((visible) => seen.push(visible), time);
  tip.longPress(); time.advance(1499); assert.deepEqual(seen, [true]);
  time.advance(1); assert.deepEqual(seen, [true, false]);
  assert.equal(TOOLTIP.longPress, 1500);
});
test("Tooltip — Scenario: Pointer moves onto the tooltip", () => {
  resetTooltipWarmth();
  const time = clock(); const seen: boolean[] = [];
  const tip = tooltipController((visible) => seen.push(visible), time);
  tip.pointerEnter(); time.advance(500);
  tip.pointerLeave(); time.advance(60); tip.tipEnter(); time.advance(5000);
  assert.deepEqual(seen, [true]);
  tip.tipLeave(); time.advance(99); assert.deepEqual(seen, [true]);
  time.advance(1); assert.deepEqual(seen, [true, false]);
  // An adjacent trigger within 300 ms shows without delay.
  const next = tooltipController((visible) => seen.push(visible), time);
  time.advance(200); next.pointerEnter(); assert.deepEqual(seen, [true, false, true]);
});
test("Tooltip — Scenario: Escape dismisses without moving focus", () => {
  const time = clock(); const seen: boolean[] = [];
  const tip = tooltipController((visible) => seen.push(visible), time);
  tip.focus(); assert.deepEqual(seen, [true]);
  tip.dismiss(); assert.deepEqual(seen, [true, false]);
});
test("Popover, dropdown menu and context menu — Scenario: Viewport collision", () => {
  const at = place({ anchor: { x: 700, y: 552, width: 80, height: 28 }, size: { width: 200, height: 240 }, viewport: { width: 800, height: 600 }, offset: 4, inset: 8 });
  assert.equal(at.side, "top");
  assert.equal(at.y, 552 - 4 - 240);
  assert.ok(at.x + 200 <= 800 - 8 && at.y >= 8);
  assert.equal(headingToward({ x: 100, y: 100 }, { x: 120, y: 110 }, { x: 200, y: 60, width: 180, height: 200 }), true);
  assert.equal(headingToward({ x: 100, y: 100 }, { x: 90, y: 110 }, { x: 200, y: 60, width: 180, height: 200 }), false);
});
test("Modal dialog — Scenario: Unsaved input guard (decision)", () => {
  assert.equal(closeDecision("escape", { dirty: true }), "confirm-discard");
  assert.equal(closeDecision("escape", { dirty: false }), "close");
  assert.equal(closeDecision("scrim", { blocking: true }), "ignore");
  assert.equal(t("discardTitle"), "Discard changes?");
  assert.equal(t("keepEditing"), "Keep editing");
  const queue = modalQueue<{ id: string; parent?: string }>();
  queue.open({ id: "a" }); queue.open({ id: "b" }); queue.open({ id: "confirm", parent: "a" });
  assert.deepEqual(queue.visible().map((item) => item.id), ["a", "confirm"]);
  queue.close("a");
  assert.deepEqual(queue.visible().map((item) => item.id), ["b"]);
});
test("Modal dialog — Scenario: Higher-priority request interrupts an open route modal", () => {
  const queue = modalQueue<{ id: string; parent?: string; priority?: number }>();
  queue.open({ id: "pair-offer" });
  queue.open({ id: "pair-request", priority: 100 });
  assert.deepEqual(queue.visible().map((item) => item.id), ["pair-request"]);
  queue.close("pair-request");
  assert.deepEqual(queue.visible().map((item) => item.id), ["pair-offer"]);
});
test("Modal dialog — Scenario: Destructive confirmation (typed confirmation rule)", () => {
  assert.equal(needsTypedConfirmation(11, false), true);
  assert.equal(needsTypedConfirmation(1, true), true);
  assert.equal(needsTypedConfirmation(10, false), false);
});
test("Side sheet and bottom sheet — Scenario: Drag to dismiss (decision)", () => {
  assert.equal(shouldDismiss(121, 400, 0), true);
  assert.equal(shouldDismiss(120, 400, 0), false);
  assert.equal(shouldDismiss(10, 400, 801), true);
});
test("Application menu button — Scenario: Menu opens from the keyboard", () => {
  const keys = appMenuKeys(["&File", "&Edit", "&View", "&Help"], "windows");
  assert.equal(keys.keyDown({ key: "Alt", alt: true, ctrl: false, meta: false }), null);
  assert.equal(keys.showMnemonics(), true);
  assert.equal(keys.keyDown({ key: "f", alt: true, ctrl: false, meta: false }), 0);
  assert.equal(keys.keyDown({ key: "F10", alt: false, ctrl: false, meta: false }), 0);
});
test("Application menu button — Scenario: Bare Alt does nothing", () => {
  const keys = appMenuKeys(["&File", "&Edit"], "linux");
  assert.equal(keys.keyDown({ key: "Alt", alt: true, ctrl: false, meta: false }), null);
  assert.equal(keys.keyUp({ key: "Alt" }), null);
  assert.equal(keys.showMnemonics(), false);
});
test("Application menu button — Scenario: Not rendered on macOS (keys)", () => assert.equal(appMenuKeys(["&File"], "mac").keyDown({ key: "f", alt: true, ctrl: false, meta: false }), null));
test("Toast with undo — Scenario: Undo from a toast", async () => {
  const time = clock(); let restored = false;
  const store = toastStore({ timers: time });
  const id = store.show({ message: "Project moved to trash", undo: () => { restored = true; } });
  assert.equal(store.visible()[0]!.remaining, 8000);
  time.advance(7000);
  await store.undo(id);
  assert.equal(restored, true);
  assert.deepEqual([store.visible()[0]!.message, store.visible()[0]!.kind], ["Restored", "success"]);
  time.advance(1999); assert.equal(store.visible().length, 1);
  time.advance(1); assert.equal(store.visible().length, 0);
  const failing = store.show({ message: "Deleted", undo: () => { throw new Error("gone"); } });
  await store.undo(failing);
  assert.deepEqual([store.visible()[0]!.kind, store.visible()[0]!.message], ["error", "Couldn’t undo"]);
});
test("Toast with undo — Scenario: Timer pauses on hover", () => {
  const time = clock();
  const store = toastStore({ timers: time });
  const id = store.show({ message: "Copied" });
  time.advance(3000); store.pause(id); time.advance(60000);
  assert.equal(store.visible().length, 1);
  store.resume(id); time.advance(999); assert.equal(store.visible().length, 1);
  time.advance(1); assert.equal(store.visible().length, 0);
});
test("Toast with undo — Scenario: Queueing", () => {
  const time = clock();
  const store = toastStore({ timers: time });
  for (let i = 1; i <= 5; i++) { store.show({ message: `Toast ${i}` }); time.advance(100); }
  assert.deepEqual(store.visible().map((toast) => toast.message), ["Toast 1", "Toast 2", "Toast 3"]);
  time.advance(TOAST.plain - 500);
  assert.deepEqual(store.visible().map((toast) => toast.message), ["Toast 2", "Toast 3", "Toast 4"]);
  store.show({ message: "Same" }); store.show({ message: "Same" });
  assert.equal(store.all().find((toast) => toast.message === "Same")!.count, 2);
  assert.equal(toastStore({ timers: time, minDuration: 10000 }).all().length, 0);
});
test("Progress indicators and skeletons — Scenario: Fast load shows no skeleton", () => {
  assert.equal(loadingFeedback(100).skeleton, false);
  assert.equal(loadingFeedback(150).skeleton, true);
});
test("Progress indicators and skeletons — Scenario: Progress appears after one second", () => {
  assert.equal(loadingFeedback(500).indicator, false);
  assert.equal(loadingFeedback(1000).indicator, true);
});
test("Progress indicators and skeletons — Scenario: Long operation is cancellable", () => {
  assert.deepEqual(loadingFeedback(10001, true), { skeleton: true, indicator: true, determinate: true, cancel: true });
  assert.equal(loadingFeedback(9000, true).cancel, false);
});
test("Empty, error and offline states — Scenario: Error message comes from the code", () => {
  const strings: Record<string, string> = { RATE_LIMITED: "The host is busy. Try again in a moment." };
  assert.equal(errorMessage("RATE_LIMITED", (code) => strings[code], t), "The host is busy. Try again in a moment.");
});
test("Empty, error and offline states — Scenario: Unknown code", () => assert.equal(errorMessage("E_42", () => undefined, t), "Something went wrong (E_42)"));
test("Empty, error and offline states — Scenario: Error state details", () => {
  const text = errorDetails({ code: "RATE_LIMITED", message: "Too many requests", request: "sessions.list", at_ms: 0, context: { hostId: "h1", token: "sk-secret", apiKey: "k", Authorization: "Bearer x" } });
  assert.equal(text, "code: RATE_LIMITED\nmessage: Too many requests\nrequest: sessions.list\ntime: 1970-01-01T00:00:00.000Z\nhostId: h1");
});
test("Avatar, badge and status pill — Scenario: Deterministic avatar", () => {
  assert.equal(avatarFill("host_3f9a1c77"), avatarFill("host_3f9a1c77"));
  assert.match(avatarFill("host_3f9a1c77"), /^avatar\/bg\/[1-8]$/);
  assert.equal(new Set(Array.from({ length: 200 }, (_, i) => avatarFill(`id-${i}`))).size, 8);
});
test("Avatar, badge and status pill — Scenario: Count overflow", () => {
  assert.equal(badgeCount(128), "99+");
  assert.equal(badgeCount(99), "99");
  assert.equal(t("unreadCount", { n: 128 }), "128 unread");
});
test("Avatar, badge and status pill — Scenario: Workflow node waiting for approval", () => {
  assert.equal(toneOfStatus("waiting_approval"), "warning");
  assert.equal(TONES.warning.shape, "triangle");
});
test("Avatar, badge and status pill — Scenario: Timed-out run", () => {
  assert.equal(toneOfStatus("timed_out"), "warning");
  assert.deepEqual([TONES.warning.fill, TONES.warning.text], ["warning/subtle", "warning/text"]);
});
test("Avatar, badge and status pill — Scenario: Unmapped status fails the build", () => {
  assert.deepEqual(unmappedStatuses({ JobStatus: ["queued", "running", "quarantined"], RunStatus: ["succeeded"] }), ["JobStatus.quarantined"]);
  assert.equal(Object.keys(statusTone).length, 57);
});
test("Avatar, badge and status pill — Scenario: Tones differ without colour", () => {
  assert.equal(new Set(Object.values(TONES).map((tone) => tone.shape)).size, 6);
  assert.deepEqual([TONES.danger.shape, TONES.success.shape], ["cross", "check"]);
});
test("Avatar, badge and status pill — Scenario: Reason does not change the tone", () => {
  assert.deepEqual([toneOfStatus("skipped"), toneOfStatus("ready"), toneOfStatus("cancelled")], ["neutral", "neutral", "neutral"]);
  assert.equal(toneOfStatus("no_route"), null, "a reason is not a status");
});
test("Keycap and shortcut hint — Scenario: Rebound action updates the hint (labels)", () => {
  assert.deepEqual(keycaps(["Mod", "K"], "windows"), ["Ctrl", "K"]);
  assert.equal(shortcutText(["Mod", "K"], "windows"), "Ctrl + K");
  assert.equal(shortcutText(["Mod", "B"], "mac"), "⌘ B");
  assert.deepEqual(keycaps(["Alt", "Shift", "Ctrl", "ArrowLeft"], "mac"), ["⌥", "⇧", "⌃", "←"]);
});
test("Icon button and toggle button — Scenario: Tooltip shows the binding (labels)", () => {
  assert.deepEqual(keycaps(["Mod", "B"], "mac"), ["⌘", "B"]);
  assert.deepEqual(keycaps(["Mod", "B"], "linux"), ["Ctrl", "B"]);
});
test("Composer primitive — Scenario: Send button state", () => {
  assert.deepEqual(sendState({ text: "  \n", attachments: [], running: false }), { mode: "send", enabled: false });
  assert.deepEqual(sendState({ text: "a", attachments: [], running: false }), { mode: "send", enabled: true });
});
test("Composer primitive — Scenario: Stop replaces send", () => {
  assert.deepEqual(sendState({ text: "", attachments: [], running: true }), { mode: "stop", enabled: true });
  assert.equal(t("stop"), "Stop");
});
test("Composer primitive — the send key while a turn runs: a typed message is sent (steered or queued by the caller), only an empty composer's send key stops the turn", () => {
  // The button is the stop button only while the composer is empty: with a message typed it sends it, so a press made
  // while the turn has not yet reported its end is never a stop that leaves the message in the composer…
  assert.deepEqual(sendState({ text: "use a warmer grade", attachments: [], running: true }), { mode: "send", enabled: true });
  assert.deepEqual(sendState({ text: "", attachments: [{ status: "ready" }], running: true }), { mode: "send", enabled: true });
  assert.deepEqual(sendState({ text: "  ", attachments: [], running: true }), { mode: "stop", enabled: true });
  // (what cannot be sent yet is not sent, and does not turn the button into a stop either)
  assert.deepEqual(sendState({ text: "go", attachments: [{ status: "uploading" }], running: true }), { mode: "send", enabled: false });
  // …and the send key sends what was typed.
  assert.equal(sendKeyAction({ text: "use a warmer grade", attachments: [], running: true }), "send");
  assert.equal(sendKeyAction({ text: "", attachments: [{ status: "ready" }], running: true }), "send");
  assert.equal(sendKeyAction({ text: "  ", attachments: [], running: true }), "stop");
  assert.equal(sendKeyAction({ text: "go", attachments: [], running: false }), "send");
  assert.equal(sendKeyAction({ text: "", attachments: [], running: false }), "none");
  // A message that may not be sent (too long, a viewer) is not sent, and it never stops the turn by accident.
  assert.equal(sendKeyAction({ text: "go", attachments: [], running: true, canSend: false }), "none");
  assert.equal(sendKeyAction({ text: "go", attachments: [{ status: "uploading" }], running: true }), "none");
});
test("Composer primitive — Scenario: Control row overflow", () => {
  const fit = fitPills(320 - 16 - 68, 110, [70, 80, 80, 60, 90, 100], 4, 28);
  assert.ok(fit.shown < 6 && fit.shown + fit.overflow === 6);
  assert.deepEqual(fitPills(900, 110, [70, 80], 4, 28), { shown: 2, overflow: 0 });
});
test("Text input and textarea — Scenario: Textarea growth limit", () => {
  assert.deepEqual(textareaHeight(9, 19, 16), { height: 8 * 19 + 16, scrolls: true });
  assert.deepEqual(textareaHeight(1, 19, 16), { height: 2 * 19 + 16, scrolls: false });
});
test("Resizable panels and splitters — Scenario: Limits enforced", () => {
  const panels = panelLayout([{ id: "a", default: 30, min: 20 }, { id: "b", default: 70, min: 30 }]);
  panels.move(0, -40);
  assert.deepEqual(panels.sizes(), [20, 80]);
});
test("Resizable panels and splitters — Scenario: Keyboard resize", () => {
  const panels = panelLayout([{ id: "a", default: 30, max: 60 }, { id: "b", default: 70 }]);
  panels.key(0, "ArrowRight", true); panels.key(0, "ArrowRight", true);
  assert.deepEqual(panels.sizes(), [40, 60]);
  panels.key(0, "End", false);
  assert.deepEqual(panels.sizes(), [60, 40]);
});
test("Resizable panels and splitters — Scenario: Double-click reset", () => {
  const panels = panelLayout([{ id: "a", default: 30, collapsible: true }, { id: "b", default: 70 }]);
  panels.move(0, 15); panels.reset(0);
  assert.deepEqual(panels.sizes(), [30, 70]);
  panels.toggleCollapse(0, 1); assert.deepEqual(panels.sizes(), [0, 100]);
  panels.toggleCollapse(0, 1); assert.deepEqual(panels.sizes(), [30, 70]);
});
test("Data-visualisation tokens — Scenario: Series order", () => assert.deepEqual([chartColor(0), chartColor(1)], ["chart/1", "chart/2"]));
test("Data-visualisation tokens — Scenario: More than eight series", () => {
  const series = Array.from({ length: 11 }, (_, i) => ({ name: `S${i}`, values: [i + 1] }));
  const grouped = groupSeries(series, "Other");
  assert.equal(grouped.length, 8);
  assert.deepEqual(grouped.at(-1), { name: "Other", values: [1 + 2 + 3 + 4] });
  assert.equal(chartColor(7), "chart/8");
});
test("Data-visualisation tokens — Scenario: Table alternative", () => {
  assert.deepEqual(chartTable(["Mon", "Tue"], [{ name: "Agent", values: [1, 2] }, { name: "Generation", values: [3, 4] }]), { columns: ["Agent", "Generation"], rows: [{ category: "Mon", values: [1, 3] }, { category: "Tue", values: [2, 4] }] });
});
test("Timeline atoms — Scenario: Offline media clip (accessible name)", () => {
  assert.equal(clipName("Drone", { offline: true }, t), "Drone, media offline");
  assert.equal(rulerStep(2, [1, 2, 5, 10]), 5);
});
