/**
 * The one place that words numbers, money, dates, times and lists for a person (i18n-accessibility "Locale-aware
 * formatting"). Every function takes the locale last and falls back to the UI language the app registered with
 * `setFormatLocale`, so a table of strings or an error mapper that has no theme at hand formats like the screens do.
 * Timecodes and frame numbers are NOT here: they are locale-independent (`formatTimecode` of the editor core).
 * Durations of cards and lists (`m:ss`, `h:mm:ss`), file sizes, `formatDay`, `formatDateTime` and `relativeTime` live in
 * `projects/logic.ts`; their locale too falls back to the one registered here.
 */
let current = "en";
/** Called by the app when the UI language is known or changes. */
export const setFormatLocale = (locale: string): void => { current = locale || "en"; };
export const formatLocale = (): string => current;
// English dates read day-first ("8 Oct 2026"), as everywhere else in the product.
const dateLocale = (locale: string) => (/^en\b/.test(locale) ? "en-GB" : locale);
const safe = <T>(make: () => T, fallback: () => T): T => { try { return make(); } catch { return fallback(); } };

/** A count or a measure: grouping and decimal separator of the locale ("8,000" · "8.000"). */
export function formatAmount(value: number, options: { decimals?: number; maxDecimals?: number } = {}, locale: string = current): string {
  const min = options.decimals ?? 0, max = Math.max(min, options.maxDecimals ?? min);
  return safe(() => new Intl.NumberFormat(locale, { minimumFractionDigits: min, maximumFractionDigits: max }).format(value), () => value.toFixed(min));
}
/** A share: "42 %" worded by the locale ("42%" · "42 %"). `value` is 0–100. */
export const formatPercent = (value: number, locale: string = current): string =>
  safe(() => new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(value / 100), () => `${Math.round(value)}%`);
/**
 * An amount in US dollars, the product's one currency: two decimals, four below one cent (a generation can cost
 * $0.0004) and three below ten cents when `fine`; "≈" in front of an estimate; an em dash for an unknown amount.
 */
export function formatUsd(amount: number | null | undefined, options: { estimated?: boolean; fine?: boolean; /** Exactly this many decimals (2–6): for amounts shown together that must add up as shown. */ digits?: number } = {}, locale: string = current): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return "—";
  const digits = options.digits !== undefined ? Math.max(2, Math.min(6, Math.round(options.digits))) : amount > 0 && amount < (options.fine ? 0.001 : 0.01) ? 4 : options.fine && amount > 0 && amount < 0.1 ? 3 : 2;
  const money = (value: number, places: number) => safe(() => new Intl.NumberFormat(locale, { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol", minimumFractionDigits: places, maximumFractionDigits: places }).format(value), () => `$${value.toFixed(places)}`);
  // A real amount is never shown as zero ("$0.00", "$0.0000" for work that did cost something): when the digits it is
  // shown with cannot show it, it reads "less than $0.01".
  if (amount > 0 && Number(amount.toFixed(digits)) === 0) return lessThan(money(0.01, 2), locale);
  const text = money(amount, digits);
  return options.estimated ? `≈ ${text}` : text;
}
/**
 * The amount of a ROW of money (a step of an estimate, a line of what was spent): a real amount under one cent reads
 * "less than $0.01" — a row is no place for "$0.0004", and never for "$0.00". Unit prices and the amounts a person
 * confirms keep `formatUsd`, which shows them to the digit.
 */
export function formatUsdRow(amount: number | null | undefined, locale: string = current): string {
  if (typeof amount === "number" && Number.isFinite(amount) && amount > 0 && amount < 0.01) return lessThan(formatUsd(0.01, {}, locale), locale);
  return formatUsd(amount, { fine: true }, locale);
}
/** "less than $0.01", in the UI language (the screens' own tables are not at hand in a formatter). */
const LESS_THAN: Record<string, string> = { en: "less than {amount}", vi: "dưới {amount}", ja: "{amount} 未満" };
const lessThan = (amount: string, locale: string): string => (LESS_THAN[locale.slice(0, 2).toLowerCase()] ?? LESS_THAN.en).replace("{amount}", amount);
/** "8 Oct" — a day on a chart axis or in a short list. */
export const formatDayMonth = (ms: number, locale: string = current): string =>
  safe(() => new Intl.DateTimeFormat(dateLocale(locale), { day: "numeric", month: "short" }).format(new Date(ms)), () => new Date(ms).toISOString().slice(5, 10));
/** The time of day: "14:05" or "2:05 PM" (`hour12` is the user's preference; the locale decides when it is not given). */
export const formatTimeOfDay = (ms: number, hour12?: boolean, locale: string = current): string =>
  safe(() => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", ...(hour12 === undefined ? {} : { hour12 }) }).format(new Date(ms)), () => new Date(ms).toISOString().slice(11, 16));
/** The time of a line of a log: "14:05:09", always on the 24-hour clock. */
export const formatLogTime = (ms: number, locale: string = current): string =>
  safe(() => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(ms)), () => new Date(ms).toISOString().slice(11, 19));
/** "Ask, Plan and Edit" — a list worded by the locale (`type: "unit"` gives the plain comma list of a table cell). */
export function formatList(items: readonly string[], type: "conjunction" | "disjunction" | "unit" = "conjunction", locale: string = current): string {
  type ListFormat = new (locale: string, options: { style: string; type: string }) => { format(items: readonly string[]): string };
  const Maker = (Intl as unknown as { ListFormat?: ListFormat }).ListFormat;
  return safe(() => (Maker ? new Maker(locale, { style: type === "unit" ? "short" : "long", type }).format(items) : items.join(", ")), () => items.join(", "));
}
/** A length of time in a sentence or a cell: "4.2 s" ("4,2 s" where the comma is the decimal separator). */
export const formatSeconds = (seconds: number, decimals = 1, locale: string = current): string => `${formatAmount(seconds, { decimals }, locale)} s`;
/** A file size: binary units (1 KB = 1024 B) with one decimal from KB up, the decimal separator of the locale. */
export function formatFileSize(bytes: number, locale: string = current): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Math.max(0, bytes), unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${formatAmount(value, { decimals: unit === 0 ? 0 : 1 }, locale)} ${units[unit]}`;
}
