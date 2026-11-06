import assert from "node:assert/strict";
import { test } from "node:test";
import { formatAmount, formatDayMonth, formatFileSize, formatList, formatLocale, formatPercent, formatSeconds, formatTimeOfDay, formatUsd, formatUsdRow, setFormatLocale } from "../src/format.ts";
import { formatDay, relativeTime } from "../src/projects/logic.ts";

test("Vietnamese number format: a file of 1,536,000 bytes is \"1,5 MB\" in vi-VN and \"1.5 MB\" in English", () => {
  assert.equal(formatFileSize(1_536_000, "vi-VN"), "1,5 MB");
  assert.equal(formatFileSize(1_536_000, "en"), "1.5 MB");
  assert.equal(formatFileSize(512, "en"), "512 B");
  assert.equal(formatFileSize(3 * 1024 ** 3, "ja"), "3.0 GB");
});

test("counts use the grouping of the locale", () => {
  assert.equal(formatAmount(8000, {}, "en"), "8,000");
  assert.equal(formatAmount(8000, {}, "vi"), "8.000");
  assert.equal(formatAmount(8000, {}, "ja"), "8,000");
  assert.equal(formatSeconds(4.2, 1, "vi"), "4,2 s");
  assert.equal(formatSeconds(4.2, 1, "en"), "4.2 s");
  assert.equal(formatPercent(42, "en"), "42%");
});

test("money is US dollars with two decimals, four below one cent, and \"≈\" in front of an estimate", () => {
  assert.equal(formatUsd(1.5, {}, "en"), "$1.50");
  assert.equal(formatUsd(0.0004, {}, "en"), "$0.0004");
  assert.equal(formatUsd(0.05, { fine: true }, "en"), "$0.050");
  assert.equal(formatUsd(12, { estimated: true }, "en"), "≈ $12.00");
  assert.equal(formatUsd(null, {}, "en"), "—");
  // w7 item 4: a real amount is never shown as zero — what the digits cannot show reads "less than $0.01" (before: "$0.0000", and "$0.00" at two digits).
  assert.equal(formatUsd(0.00001, {}, "en"), "less than $0.01");
  assert.equal(formatUsd(0.00001, { fine: true }, "en"), "less than $0.01");
  assert.equal(formatUsd(0.004, { digits: 2 }, "en"), "less than $0.01");
  assert.equal(formatUsd(0, { digits: 2 }, "en"), "$0.00", "nothing is nothing: only a real amount is \"less than\"");
  assert.match(formatUsd(0.004, { digits: 2 }, "vi"), /^dưới 0,01\s?(US)?\$$/);
  assert.match(formatUsd(0.004, { digits: 2 }, "ja"), /^\$0\.01 未満$/);
  // A row of money: under one cent is "less than $0.01"; a cent and more is the figure.
  assert.deepEqual([formatUsdRow(0.0004, "en"), formatUsdRow(0.0099, "en"), formatUsdRow(0.01, "en"), formatUsdRow(0.034, "en"), formatUsdRow(1.5, "en"), formatUsdRow(null, "en")], ["less than $0.01", "less than $0.01", "$0.010", "$0.034", "$1.50", "—"]);
  assert.match(formatUsd(1234.5, {}, "vi"), /^1\.234,50\s?(US)?\$$/);
});

test("Relative versus absolute time: three hours ago is relative, ten days ago is a date, each in the UI language", () => {
  const now = Date.UTC(2026, 9, 8, 12, 0, 0), hour = 3_600_000, day = 24 * hour;
  assert.match(relativeTime(now - 3 * hour, now, "en"), /3 hr\.? ago/);
  assert.match(relativeTime(now - 3 * hour, now, "vi"), /3 giờ trước/);
  assert.match(relativeTime(now - 3 * hour, now, "ja"), /3 時間前/);
  assert.equal(relativeTime(now - 10 * day, now, "en"), formatDay(now - 10 * day, "en"));
  assert.match(formatDay(now - 10 * day, "en"), /28 Sept? 2026/);
  assert.match(formatDay(now - 10 * day, "ja"), /2026年9月28日/);
});

test("project list time falls back to a localized date when RelativeTimeFormat is unavailable", () => {
  const original = Intl.RelativeTimeFormat;
  Object.defineProperty(Intl, "RelativeTimeFormat", { configurable: true, value: undefined });
  try {
    const stamp = Date.UTC(2026, 9, 8, 12, 0, 0);
    assert.equal(relativeTime(stamp, stamp + 3_600_000, "en"), formatDay(stamp, "en"));
  } finally {
    Object.defineProperty(Intl, "RelativeTimeFormat", { configurable: true, value: original });
  }
});

test("Time zone conversion: a UTC millisecond timestamp is worded in the device's time zone", () => {
  const stamp = Date.UTC(2026, 9, 8, 7, 5, 0);
  const local = new Date(stamp);
  assert.equal(formatTimeOfDay(stamp, false, "en"), `${String(local.getHours()).padStart(2, "0")}:${String(local.getMinutes()).padStart(2, "0")}`);
  assert.match(formatDayMonth(stamp, "en"), /\d{1,2} Oct/);
});

test("lists are joined by the locale; the registered UI language is the default of every helper", () => {
  assert.equal(formatList(["Ask", "Plan", "Edit"], "conjunction", "en"), "Ask, Plan, and Edit");
  assert.equal(formatList(["Ask", "Plan"], "unit", "en"), "Ask, Plan");
  setFormatLocale("vi");
  assert.equal(formatLocale(), "vi");
  assert.equal(formatAmount(1234.5, { decimals: 1 }), "1.234,5");
  setFormatLocale("en");
});
