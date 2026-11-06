import { CANVAS_PRESETS, TICKS_PER_SECOND, type CanvasSize, type Rational } from "@jagentchill/protocol";
import { formatLocale } from "../format.ts";

/** Longest project name and inline title, in characters. */
export const NAME_MAX = 120;
export const FOLDER_NAME_MAX = 80;

// ── Names ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** What a name or title field holds after input: pasted text is cut at the limit, by code point. */
export const clampInput = (text: string, max: number = NAME_MAX): string => Array.from(text).slice(0, max).join("");
/** The name a rename stores: trimmed and cut at 120; `null` when nothing visible is left, which keeps the previous name. */
export function normalizeName(text: string, max: number = NAME_MAX): string | null {
  const name = clampInput(text.trim(), max).trim();
  return name.length > 0 ? name : null;
}
/** A package file name: `<project name>.jagentchill` with characters no file system takes replaced by `_`. */
export const packageFileName = (name: string): string => `${name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/[. ]+$/, "_") || "_"}.jagentchill`;

const PREFIX = /^\((\d+)\) /;
/**
 * The name of a duplicate: an existing leading `(N) ` is stripped to get the base; the copy is `(N) base` with N one
 * above the highest number in use for that base, or 1. `taken` grows inside a batch, so N increments there.
 */
export function duplicateName(source: string, taken: Iterable<string>): string {
  const base = source.replace(PREFIX, "");
  let highest = 0;
  for (const name of taken) {
    const match = PREFIX.exec(name);
    if (match && name.slice(match[0].length) === base) highest = Math.max(highest, Number(match[1]));
  }
  return clampInput(`(${highest + 1}) ${base}`);
}

// ── Durations, dates, sizes ──────────────────────────────────────────────────────────────────────────────────────────

const two = (value: number) => String(value).padStart(2, "0");
/** The duration badge of a card: `MM:SS`, `H:MM:SS` from one hour. `ticks` is the document's duration. */
export function durationBadge(ticks: number): string {
  const seconds = Math.floor(Math.max(0, ticks) / TICKS_PER_SECOND), hours = Math.floor(seconds / 3600);
  const rest = `${two(Math.floor((seconds % 3600) / 60))}:${two(seconds % 60)}`;
  return hours > 0 ? `${hours}:${rest}` : rest;
}
/** The duration cell of a list row: an em dash for an empty project. */
export const durationCell = (ticks: number): string => (ticks > 0 ? durationBadge(ticks) : "—");
/** The duration of the Info dialog: `0:00` when empty, `1:30`, `1:02:03`. */
export function durationInfo(ticks: number): string {
  const seconds = Math.floor(Math.max(0, ticks) / TICKS_PER_SECOND), hours = Math.floor(seconds / 3600), minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds % 60)}` : `${minutes}:${two(seconds % 60)}`;
}
export const secondsToTicks = (seconds: number): number => Math.round(seconds * TICKS_PER_SECOND);
/** "350.0 MiB": binary units with one decimal; bytes below 1 KiB are shown in KiB too. */
export function binarySize(bytes: number): string {
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = Math.max(0, bytes) / 1024, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toFixed(1)} ${units[unit]}`;
}
export const formatDay = (ms: number, locale: string = formatLocale()): string => new Intl.DateTimeFormat(/^en\b/.test(locale) ? "en-GB" : locale, { day: "numeric", month: "short", year: "numeric" }).format(new Date(ms));
export const formatDateTime = (ms: number, locale: string = formatLocale()): string => new Intl.DateTimeFormat(/^en\b/.test(locale) ? "en-GB" : locale, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
/** "12 min ago", "Yesterday", "2 days ago", then the date. */
export function relativeTime(ms: number, now_ms: number = Date.now(), locale: string = formatLocale()): string {
  // Hermes builds may omit RelativeTimeFormat. Keep project lists renderable without a native intl polyfill.
  if (typeof Intl.RelativeTimeFormat !== "function") return formatDay(ms, locale);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
  const minutes = Math.round((now_ms - ms) / 60_000);
  if (minutes < 1) return format.format(0, "second");
  if (minutes < 60) return format.format(-minutes, "minute");
  if (minutes < 1440) return format.format(-Math.round(minutes / 60), "hour");
  if (minutes < 7 * 1440) return format.format(-Math.round(minutes / 1440), "day");
  return formatDay(ms, locale);
}

// ── Search ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Case-insensitive and diacritic-insensitive form: "Đà Lạt" → "da lat". */
export const foldText = (text: string): string => text.normalize("NFD").replace(/\p{M}+/gu, "").replace(/[đĐ]/g, "d").toLowerCase();
export const matchesQuery = (name: string, query: string): boolean => foldText(name).includes(foldText(query.trim()));

// ── Sorting ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export const SORT_KEYS = ["modified", "created", "name", "duration", "size"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortOrder = "asc" | "desc";
/** `bytes`: what the project holds on this device (its record and media); `pinned_ms`: when it was pinned, `null` while it is not. */
export type Sortable = { name: string; created_ms: number; updated_ms: number; duration: number; bytes?: number; pinned_ms?: number | null };
export const isPinned = (item: { pinned_ms?: number | null }): boolean => typeof item.pinned_ms === "number";
export const DEFAULT_SORT: { key: SortKey; order: SortOrder } = { key: "modified", order: "desc" };

const collators = new Map<string, Intl.Collator>();
/** Locale-aware, case-insensitive, numeric: "Clip 2" before "Clip 10". */
export function compareNames(a: string, b: string, locale = "en"): number {
  let collator = collators.get(locale);
  if (!collator) { collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" }); collators.set(locale, collator); }
  return collator.compare(a, b);
}
/**
 * Projects in display order. Pinned projects come first whatever the key and the order say; inside the pinned ones and
 * inside the rest the chosen sort applies. Ties are broken by Modified descending whatever the order toggle says.
 */
export function sortProjects<T extends Sortable>(items: readonly T[], key: SortKey, order: SortOrder, locale = "en"): T[] {
  const sign = order === "asc" ? 1 : -1;
  const primary = (a: T, b: T) => (key === "name" ? compareNames(a.name, b.name, locale) : key === "created" ? a.created_ms - b.created_ms : key === "duration" ? a.duration - b.duration
    : key === "size" ? (a.bytes ?? 0) - (b.bytes ?? 0) : a.updated_ms - b.updated_ms);
  return [...items].sort((a, b) => Number(isPinned(b)) - Number(isPinned(a)) || sign * primary(a, b) || b.updated_ms - a.updated_ms);
}
/** What "Pin" does to a selection: it pins when at least one of them is not pinned yet, and unpins when all are. */
export const pinTarget = (items: readonly { pinned_ms?: number | null }[]): boolean => items.some((item) => !isPinned(item));

// ── Selection ────────────────────────────────────────────────────────────────────────────────────────────────────────

export type Selection = { ids: ReadonlySet<string>; anchor: string | null };
export const EMPTY_SELECTION: Selection = { ids: new Set(), anchor: null };
export function toggleSelected(selection: Selection, id: string): Selection {
  const ids = new Set(selection.ids);
  if (ids.has(id)) { ids.delete(id); return { ids, anchor: selection.anchor === id ? null : selection.anchor }; }
  ids.add(id);
  return { ids, anchor: id };
}
/** Shift-click: the range from the anchor to `id` in displayed order is merged into the selection. */
export function selectRange(selection: Selection, displayed: readonly string[], id: string): Selection {
  const from = selection.anchor === null ? -1 : displayed.indexOf(selection.anchor), to = displayed.indexOf(id);
  if (from < 0 || to < 0) return toggleSelected(selection, id);
  const ids = new Set(selection.ids);
  for (const item of displayed.slice(Math.min(from, to), Math.max(from, to) + 1)) ids.add(item);
  return { ids, anchor: selection.anchor };
}
export type SelectAllState = "none" | "some" | "all";
export function selectAllState(selection: Selection, displayed: readonly string[]): SelectAllState {
  const count = displayed.filter((id) => selection.ids.has(id)).length;
  return count === 0 ? "none" : count === displayed.length ? "all" : "some";
}
/** The header checkbox: selects every displayed project unless all of them already are, which clears the selection. */
export const toggleSelectAll = (selection: Selection, displayed: readonly string[]): Selection =>
  (selectAllState(selection, displayed) === "all" ? EMPTY_SELECTION : { ids: new Set(displayed), anchor: selection.anchor });
/** Entries of projects the filter hides leave the selection. */
export function pruneSelection(selection: Selection, displayed: readonly string[]): Selection {
  const shown = new Set(displayed);
  const ids = new Set([...selection.ids].filter((id) => shown.has(id)));
  return ids.size === selection.ids.size ? selection : { ids, anchor: selection.anchor !== null && shown.has(selection.anchor) ? selection.anchor : null };
}

// ── Bulk actions and grid ────────────────────────────────────────────────────────────────────────────────────────────

export const BATCH_EXPORT = { min: 2, max: 20 } as const;
/** "Export video…" of the bulk bar: enabled for 2–20 selected projects. `reason` is the key of its tooltip otherwise. */
export function batchExportState(count: number): { enabled: boolean; reason: "atLeast" | "atMost" | null } {
  if (count > BATCH_EXPORT.max) return { enabled: false, reason: "atMost" };
  if (count < BATCH_EXPORT.min) return { enabled: false, reason: "atLeast" };
  return { enabled: true, reason: null };
}
/** Columns of the grid: 1, 2, 3 or 4 at widths < 640, ≥ 640, ≥ 1024, ≥ 1280 px; phones always 2. */
export const gridColumns = (width: number, phone = false): number => (phone ? 2 : width >= 1280 ? 4 : width >= 1024 ? 3 : width >= 640 ? 2 : 1);
/** Below 640 px the create button reads "New" and the bulk actions collapse into a menu. */
export const NARROW_HEADER = 640;
export const SKELETON_COUNT = 24;

/** Arrow-key focus movement between cards of a grid with `columns` columns (1 for the list view). */
export function moveFocus(index: number, key: string, count: number, columns: number, rtl = false): number | null {
  if (count === 0) return null;
  const forward = rtl ? "ArrowLeft" : "ArrowRight", backward = rtl ? "ArrowRight" : "ArrowLeft";
  const next = key === forward ? index + 1 : key === backward ? index - 1 : key === "ArrowDown" ? index + columns : key === "ArrowUp" ? index - columns : key === "Home" ? 0 : key === "End" ? count - 1 : null;
  return next === null || next < 0 || next >= count ? (next === null ? null : index) : next;
}

// ── Canvas size and frame rate ───────────────────────────────────────────────────────────────────────────────────────

export const CANVAS_LIMITS = { min: 16, max: 7680, maxArea: 33_177_600 } as const;
export const RESOLUTIONS = [480, 720, 1080, 1440, 2160] as const;
export { CANVAS_PRESETS };
const even = (value: number) => Math.round(value / 2) * 2;
export type DimensionResult = { ok: true; value: number } | { ok: false; reason: "range" | "area"; axis: "Width" | "Height" };
/** A typed width or height: an integer from 16 to 7680, rounded to the nearest even number (1081 → 1082). */
export function parseDimension(text: string, axis: "Width" | "Height"): DimensionResult {
  const value = Number(text.trim());
  if (!/^\d+$/.test(text.trim()) || value < CANVAS_LIMITS.min || value > CANVAS_LIMITS.max) return { ok: false, reason: "range", axis };
  return { ok: true, value: Math.min(CANVAS_LIMITS.max, Math.max(CANVAS_LIMITS.min, even(value))) };
}
/** The message under an invalid custom size field. */
export const dimensionMessage = (axis: "Width" | "Height"): string => `${axis} must be between ${CANVAS_LIMITS.min} and ${CANVAS_LIMITS.max}`;
export const areaAllowed = (size: CanvasSize): boolean => size.width * size.height <= CANVAS_LIMITS.maxArea;
/** The preset a size is exactly equal to, if any. */
export const presetOf = (size: CanvasSize) => CANVAS_PRESETS.find((preset) => preset.width === size.width && preset.height === size.height) ?? null;
/** The resolution selector: the current ratio scaled so that its short side is `shortSide`, in even numbers. */
export function scaleToShortSide(size: CanvasSize, shortSide: number): CanvasSize {
  const factor = shortSide / Math.min(size.width, size.height);
  return { width: Math.min(CANVAS_LIMITS.max, Math.max(CANVAS_LIMITS.min, even(size.width * factor))), height: Math.min(CANVAS_LIMITS.max, Math.max(CANVAS_LIMITS.min, even(size.height * factor))) };
}
/** Which canvas a new project starts with: 1080 × 1920 on phones, 1920 × 1080 everywhere else. */
export const factoryCanvas = (phone: boolean): CanvasSize => (phone ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 });

/** The ten frame rates of the selector, in order. */
export const FRAME_RATES: readonly (Rational & { label: string })[] = [
  { label: "23.976", numerator: 24000, denominator: 1001 }, { label: "24", numerator: 24, denominator: 1 }, { label: "25", numerator: 25, denominator: 1 },
  { label: "29.97", numerator: 30000, denominator: 1001 }, { label: "30", numerator: 30, denominator: 1 }, { label: "48", numerator: 48, denominator: 1 },
  { label: "50", numerator: 50, denominator: 1 }, { label: "59.94", numerator: 60000, denominator: 1001 }, { label: "60", numerator: 60, denominator: 1 },
  { label: "120", numerator: 120, denominator: 1 },
];
export const sameRate = (a: Rational, b: Rational): boolean => a.numerator * b.denominator === b.numerator * a.denominator;
/** A listed rate reads as its label; any other stored rate as its decimal value with two fraction digits. */
export const frameRateLabel = (rate: Rational): string => FRAME_RATES.find((entry) => sameRate(entry, rate))?.label ?? (rate.numerator / rate.denominator).toFixed(2);
/** The options of the selector for a project: the ten rates, plus the stored rate when it is not one of them. */
export function frameRateOptions(current: Rational): (Rational & { label: string })[] {
  return FRAME_RATES.some((entry) => sameRate(entry, current)) ? [...FRAME_RATES] : [...FRAME_RATES, { ...current, label: frameRateLabel(current) }];
}
export const rateKey = (rate: Rational): string => `${rate.numerator}/${rate.denominator}`;
