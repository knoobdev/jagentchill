import assert from "node:assert/strict";
import test from "node:test";
import { compactCardContentWidth, compactCardTextLayout, compactListCardWidth, compactScale, compactSessionFilterMetrics, compactSessionMetrics, compactViewport, homeScrollBottomPadding, workspaceTabMetrics } from "../src/compact.ts";
import { textareaHeight } from "../src/logic/content.ts";

test("phone scale and 393x852 safe-area and keyboard geometry stay within the viewport", () => {
  assert.deepEqual(compactScale.space, { side: 16, card: 12, gapSmall: 8, gapMedium: 12, gapLarge: 16 });
  assert.equal(compactScale.control.height, 44);
  assert.equal(compactScale.control.listRow, 64);
  assert.deepEqual(compactViewport({ width: 393, height: 852, insetTop: 59, insetBottom: 34, keyboardHeight: 0 }), {
    width: 393, top: 59, bottom: 818, height: 759, keyboardTop: null,
  });
  assert.deepEqual(compactViewport({ width: 393, height: 852, insetTop: 59, insetBottom: 34, keyboardHeight: 336 }), {
    width: 393, top: 59, bottom: 516, height: 457, keyboardTop: 516,
  });
});

test("393 point timeline cards retain 16 point gutters and 12 point card padding", () => {
  assert.equal(compactCardContentWidth(393), 337);
  assert.deepEqual(compactSessionMetrics(393), { headerHeight: 44, timelineWidth: 361, workspaceMode: "pushed-screen", composerMode: "in-flow-dock" });
});

test("seeded permission, spending, attachment, tool and waiting cards fit 390 and 393 point viewports", () => {
  const seeded = [
    { id: "permission", text: "Run a command on the host?", actions: ["Allow once", "Always allow in this session", "Deny"] },
    { id: "spending", text: "The agent wants to make 3 paid items", actions: ["Allow", "Deny"] },
    { id: "attachment", text: "portrait-reference-photo-with-a-long-name.png", actions: ["Open preview", "Remove"] },
    { id: "tool", text: "Search project files and summarize matching scenes", actions: ["Expand tool step"] },
    { id: "waiting", text: "Sent your decision — waiting for the agent to finish the next step…", actions: [] },
  ];
  for (const width of [390, 393]) {
    const viewport = compactViewport({ width, height: 852, insetTop: 59, insetBottom: 34, keyboardHeight: 0 });
    const cardWidth = compactListCardWidth(width);
    const contentWidth = compactCardContentWidth(width);
    assert.equal(viewport.height, 759);
    assert.equal(cardWidth + 2 * compactScale.space.side, width);
    assert.equal(contentWidth + 2 * compactScale.space.card, cardWidth);
    for (const card of seeded) {
      assert.ok(card.text.length > 0, `${card.id} fixture has visible content`);
      assert.ok(contentWidth > 0 && contentWidth <= width, `${card.id} content stays within viewport`);
      assert.ok(card.actions.every(() => compactScale.control.height >= 44), `${card.id} controls retain 44 pt targets`);
    }
  }
  assert.deepEqual(compactCardTextLayout(true), { minWidth: 0, flexShrink: 1, maxWidth: "100%" });
  assert.deepEqual(compactCardTextLayout(false), {});
  assert.deepEqual(seeded.map(({ id }) => id), ["permission", "spending", "attachment", "tool", "waiting"]);
});

test("compact list cards remain one full-width column at 393 and 390 points", () => {
  assert.equal(compactListCardWidth(393), 361);
  assert.equal(compactListCardWidth(390), 358);
  assert.equal(compactListCardWidth(320), 288);
  assert.equal(compactListCardWidth(20), 0);
});

test("pushed session workspace keeps Files, Plan and Team tabs thumb-sized on the phone", () => {
  assert.deepEqual(workspaceTabMetrics(true), { height: 44, minTarget: 44 });
  assert.deepEqual(workspaceTabMetrics(false), { height: 36, minTarget: 28 });
  assert.equal(compactListCardWidth(393), 361);
});

test("393 point Sessions filter row uses one full label and opens a width-bounded filter sheet", () => {
  const phone = compactSessionFilterMetrics(393);
  assert.deepEqual(phone, { contentWidth: 361, triggerWidth: 112, triggerHeight: 44, fieldWidth: 320, presentation: "sheet" });
  assert.equal(compactSessionFilterMetrics(320).fieldWidth, 288);
  assert.ok(phone.triggerWidth <= phone.contentWidth);
  assert.ok(phone.triggerHeight >= 44);
});

test("Home composer and action sheets fit above the iPhone keyboard fixture", () => {
  const viewport = compactViewport({ width: 393, height: 852, insetTop: 59, insetBottom: 34, keyboardHeight: 336 });
  assert.deepEqual(viewport, { width: 393, top: 59, bottom: 516, height: 457, keyboardTop: 516 });
  assert.deepEqual(textareaHeight(10, 21, 0, 2, 3), { height: 63, scrolls: true });
  assert.equal(compactScale.control.height, 44);
  assert.ok(viewport.bottom <= viewport.keyboardTop!, "composer bottom stays at or above the keyboard edge");
});

test("Home scroll end reserves the fixed composer dock and iPhone bottom inset", () => {
  const dockHeight = compactScale.control.height + 2 * compactScale.space.card + 1;
  assert.equal(dockHeight, 69);
  assert.equal(homeScrollBottomPadding(dockHeight, 34), 103);
  assert.equal(homeScrollBottomPadding(dockHeight, 0), 69);
});
