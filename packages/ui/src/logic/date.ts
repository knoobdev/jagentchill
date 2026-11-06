/** Calendar arithmetic for DateField, DateRangeField, TimeField and WeekdayPicker. Dates are local calendar days as `YYYY-MM-DD`. */
export type Day = { y: number; m: number; d: number };
export type DayRange = { start: string; end: string };

const pad = (value: number, width = 2) => String(value).padStart(width, "0");
export const iso = (day: Day) => `${pad(day.y, 4)}-${pad(day.m)}-${pad(day.d)}`;
export function fromIso(value: string): Day | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? valid({ y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) }) : null;
}
const utc = (day: Day) => Date.UTC(day.y, day.m - 1, day.d);
const ofUtc = (ms: number): Day => { const date = new Date(ms); return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() }; };
function valid(day: Day): Day | null {
  const back = ofUtc(utc(day));
  return day.y >= 1 && back.y === day.y && back.m === day.m && back.d === day.d ? day : null;
}
export const DAY_MS = 86400000;
export const addDays = (value: string, days: number) => iso(ofUtc(utc(fromIso(value)!) + days * DAY_MS));
export function addMonths(value: string, months: number): string {
  const day = fromIso(value)!;
  const first = new Date(Date.UTC(day.y, day.m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return iso({ y: first.getUTCFullYear(), m: first.getUTCMonth() + 1, d: Math.min(day.d, last) });
}
export const daysBetween = (start: string, end: string) => Math.round((utc(fromIso(end)!) - utc(fromIso(start)!)) / DAY_MS);
export const weekdayOf = (value: string) => new Date(utc(fromIso(value)!)).getUTCDay();
export const todayIso = (now: Date = new Date()) => iso({ y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() });

/** Order of day, month and year in the locale's short date, and its separator: `vi` → d/m/y "/", `ja` → y/m/d "/", `en-US` → m/d/y. */
export function dateOrder(locale: string): { order: Array<"d" | "m" | "y">; separator: string } {
  const parts = new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC" }).formatToParts(new Date(Date.UTC(2026, 9, 5)));
  const order = parts.flatMap((part) => (part.type === "day" ? ["d" as const] : part.type === "month" ? ["m" as const] : part.type === "year" ? ["y" as const] : []));
  return { order, separator: parts.find((part) => part.type === "literal")?.value.trim() || "/" };
}
export function formatDate(value: string, locale: string): string {
  const day = fromIso(value);
  return day ? new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC" }).format(new Date(utc(day))) : "";
}
/** Accepts the locale's short format and ISO `YYYY-MM-DD`. */
export function parseDate(input: string, locale: string): string | null {
  const text = input.trim();
  const isoDay = fromIso(text);
  if (isoDay) return iso(isoDay);
  const numbers = text.split(/[^\d]+/).filter(Boolean).map(Number);
  if (numbers.length !== 3) return null;
  const { order } = dateOrder(locale);
  const pick = (part: "d" | "m" | "y") => numbers[order.indexOf(part)]!;
  let year = pick("y");
  if (year < 100) year += 2000;
  const day = valid({ y: year, m: pick("m"), d: pick("d") });
  return day ? iso(day) : null;
}
export function fullDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: "UTC" }).format(new Date(utc(fromIso(value)!)));
}
export function monthTitle(year: number, month: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
}
export const monthNames = (locale: string) => Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, i, 1))));

/** The weeks of a month grid, starting on the locale's first day of the week, padded with the neighbouring months' days. */
export function monthGrid(year: number, month: number, firstDayOfWeek: number): string[][] {
  const first = iso({ y: year, m: month, d: 1 });
  const lead = (weekdayOf(first) - firstDayOfWeek + 7) % 7;
  const start = addDays(first, -lead);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const weeks = Math.ceil((lead + daysInMonth) / 7);
  return Array.from({ length: weeks }, (_, week) => Array.from({ length: 7 }, (_, day) => addDays(start, week * 7 + day)));
}
/** Grid keyboard: arrows by day and week, Page Up/Down by month, with Shift by year, Home/End to the ends of the week. */
export function gridKey(focused: string, key: string, shift: boolean, firstDayOfWeek: number, rtl = false): string | null {
  const column = (weekdayOf(focused) - firstDayOfWeek + 7) % 7;
  const inline = rtl ? -1 : 1;
  switch (key) {
    case "ArrowLeft": return addDays(focused, -inline);
    case "ArrowRight": return addDays(focused, inline);
    case "ArrowUp": return addDays(focused, -7);
    case "ArrowDown": return addDays(focused, 7);
    case "PageUp": return addMonths(focused, shift ? -12 : -1);
    case "PageDown": return addMonths(focused, shift ? 12 : 1);
    case "Home": return addDays(focused, -column);
    case "End": return addDays(focused, 6 - column);
    default: return null;
  }
}
export type DateLimits = { min?: string; max?: string; disabledDate?(value: string): boolean };
export const dateAllowed = (value: string, limits: DateLimits) => !(limits.min && value < limits.min) && !(limits.max && value > limits.max) && !limits.disabledDate?.(value);

export type RangePreset = "today" | "yesterday" | "last7" | "last30" | "thisMonth" | "lastMonth" | "custom";
export const DEFAULT_PRESETS: readonly RangePreset[] = ["today", "yesterday", "last7", "last30", "thisMonth", "lastMonth", "custom"];
/** The range of a preset relative to today; "Last 7 days" is the seven local days ending today. Null for Custom. */
export function presetRange(preset: RangePreset, today: string): DayRange | null {
  const day = fromIso(today)!;
  switch (preset) {
    case "today": return { start: today, end: today };
    case "yesterday": return { start: addDays(today, -1), end: addDays(today, -1) };
    case "last7": return { start: addDays(today, -6), end: today };
    case "last30": return { start: addDays(today, -29), end: today };
    case "thisMonth": return { start: iso({ ...day, d: 1 }), end: today };
    case "lastMonth": {
      const end = addDays(iso({ ...day, d: 1 }), -1);
      return { start: iso({ ...fromIso(end)!, d: 1 }), end };
    }
    default: return null;
  }
}
/** The first activation sets the start, the second the end; an end before the start swaps them. */
export function pickRangeDay(draft: { start: string | null; end: string | null }, value: string): { start: string | null; end: string | null } {
  if (!draft.start || draft.end) return { start: value, end: null };
  return value < draft.start ? { start: value, end: draft.start } : { start: draft.start, end: value };
}
/** Number of days a range spans, both ends included. */
export const spanDays = (range: DayRange) => daysBetween(range.start, range.end) + 1;
export const rangeTooLong = (range: DayRange, maxSpanDays?: number) => maxSpanDays !== undefined && spanDays(range) > maxSpanDays;
export const formatRange = (range: DayRange, locale: string) => `${formatDate(range.start, locale)} – ${formatDate(range.end, locale)}`;

/** A wall-clock time with no zone. */
export type Time = { h: number; m: number; s: number };
export type TimeSegment = "h" | "m" | "s" | "p";
export function parseTime(value: string): Time | null {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return null;
  const time = { h: Number(match[1]), m: Number(match[2]), s: Number(match[3] ?? 0) };
  return time.h < 24 && time.m < 60 && time.s < 60 ? time : null;
}
export const timeValue = (time: Time, withSeconds = false) => `${pad(time.h)}:${pad(time.m)}${withSeconds ? `:${pad(time.s)}` : ""}`;
/** Segment texts in 12- or 24-hour form: 22:00 → "10", "00", "PM". */
export function timeParts(time: Time, hour12: boolean): { h: string; m: string; s: string; p: "AM" | "PM" | null } {
  const hour = hour12 ? time.h % 12 || 12 : time.h;
  return { h: hour12 ? String(hour) : pad(hour), m: pad(time.m), s: pad(time.s), p: hour12 ? (time.h < 12 ? "AM" : "PM") : null };
}
export const formatTime = (time: Time, hour12: boolean, withSeconds = false) => {
  const parts = timeParts(time, hour12);
  return `${parts.h}:${parts.m}${withSeconds ? `:${parts.s}` : ""}${parts.p ? ` ${parts.p}` : ""}`;
};
/** Up/Down on a segment: each segment wraps within itself; the AM/PM segment flips the half of the day. */
export function stepTime(time: Time, segment: TimeSegment, direction: 1 | -1): Time {
  const wrap = (value: number, size: number) => ((value % size) + size) % size;
  if (segment === "h") return { ...time, h: wrap(time.h + direction, 24) };
  if (segment === "m") return { ...time, m: wrap(time.m + direction, 60) };
  if (segment === "s") return { ...time, s: wrap(time.s + direction, 60) };
  return { ...time, h: wrap(time.h + 12, 24) };
}
/** Typing digits into a segment: a second digit completes it; an out-of-range pair starts over with the new digit. */
export function typeDigit(time: Time, segment: Exclude<TimeSegment, "p">, buffer: string, digit: string, hour12: boolean): { time: Time; buffer: string; done: boolean } {
  const text = buffer + digit;
  const max = segment === "h" ? (hour12 ? 12 : 23) : 59;
  let value = Number(text);
  let next = text;
  if (value > max || (segment === "h" && hour12 && value === 0 && text.length === 2)) { value = Number(digit); next = digit; }
  const done = next.length === 2 || value * 10 > max;
  if (segment === "h") {
    const hour = hour12 ? (value % 12) + (time.h >= 12 ? 12 : 0) : value;
    return { time: { ...time, h: hour }, buffer: done ? "" : next, done };
  }
  return { time: { ...time, [segment]: value }, buffer: done ? "" : next, done };
}
export const timeSegments = (hour12: boolean, withSeconds: boolean): TimeSegment[] => ["h", "m", ...(withSeconds ? ["s" as const] : []), ...(hour12 ? ["p" as const] : [])];

/** The seven weekdays (0 = Sunday) in the locale's week order with narrow and full names. */
export function weekdays(locale: string, firstDayOfWeek: number): Array<{ day: number; narrow: string; full: string }> {
  const name = (day: number, width: "narrow" | "long") => new Intl.DateTimeFormat(locale, { weekday: width, timeZone: "UTC" }).format(new Date(Date.UTC(2026, 9, 4 + day)));
  return Array.from({ length: 7 }, (_, i) => (firstDayOfWeek + i) % 7).map((day) => ({ day, narrow: name(day, "narrow"), full: name(day, "long") }));
}
export const WEEKDAY_PRESETS = { everyDay: [0, 1, 2, 3, 4, 5, 6], weekdays: [1, 2, 3, 4, 5], weekends: [0, 6] } as const;
export function toggleWeekday(selected: readonly number[], day: number, multiple: boolean): number[] {
  if (!multiple) return [day];
  return selected.includes(day) ? selected.filter((item) => item !== day) : [...selected, day].sort((a, b) => a - b);
}
