import assert from "node:assert/strict";
import test from "node:test";
import { compactEditedDate, phoneProjectsBottomPadding, phoneProjectsGrid, showPhoneNewProjectAction } from "./layout.ts";

test("phone projects keep two cards across a 393 pt viewport", () => {
  const grid = phoneProjectsGrid(393, 16, 12);
  assert.equal(grid.columns, 2);
  assert.equal(grid.cardWidth, 174.5);
  assert.equal(grid.cardWidth * 2 + 32 + 12, 393);
});

test("empty phone projects state has one New project action, then a floating action with content", () => {
  assert.equal(showPhoneNewProjectAction({ ready: true, selected: false, projects: 0, folders: 0 }), false);
  assert.equal(showPhoneNewProjectAction({ ready: true, selected: false, projects: 1, folders: 0 }), true);
  assert.equal(showPhoneNewProjectAction({ ready: true, selected: true, projects: 1, folders: 0 }), false);
});

test("phone project cards use a short date and scrolling clears the floating action and home indicator", () => {
  assert.equal(compactEditedDate(Date.UTC(2026, 9, 13, 12), "en"), "13 Oct");
  assert.equal(phoneProjectsBottomPadding(34), 130);
  assert.equal(phoneProjectsBottomPadding(-1), 96);
});
