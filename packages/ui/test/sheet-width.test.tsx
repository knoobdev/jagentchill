// The side sheet restores its chosen width from storage: a stored value that reads as a finite number, never below the
// 320 px minimum, and the caller's fallback for anything else. The read/guard logic is a pure function so it is tested
// here without a browser (the localStorage read itself is one line in `dom.web.ts`).
import { expect, test } from "vitest";
import { restoredSheetWidth } from "../src/overlay.tsx";

test("Side sheet width — Scenario: Nothing stored keeps the default", () => {
  expect(restoredSheetWidth(null, 400)).toBe(400);
});

test("Side sheet width — Scenario: A stored width is restored", () => {
  expect(restoredSheetWidth("512", 400)).toBe(512);
  expect(restoredSheetWidth("0.5", 400)).toBe(320);
});

test("Side sheet width — Scenario: A value that is not a number falls back", () => {
  expect(restoredSheetWidth("abc", 400)).toBe(400);
  expect(restoredSheetWidth("NaN", 400)).toBe(400);
  expect(restoredSheetWidth("Infinity", 400)).toBe(400);
});

test("Side sheet width — Scenario: The stored width never goes below the minimum", () => {
  expect(restoredSheetWidth("100", 400)).toBe(320);
  expect(restoredSheetWidth("319.6", 400)).toBe(320);
  expect(restoredSheetWidth("320", 400)).toBe(320);
});

test("Side sheet width — Scenario: The stored width is rounded to whole pixels", () => {
  expect(restoredSheetWidth("512.4", 400)).toBe(512);
  expect(restoredSheetWidth("512.6", 400)).toBe(513);
});
