import type { AutomationSchedule } from "@jagentchill/protocol";

/** Schedules of automations: an RRULE with `DTSTART` and `TZID`, evaluated in the rule's time zone with the IANA database. */
export const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export type Rule = {
  freq: "MINUTELY" | "HOURLY" | "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY"; interval: number; byday: Array<{ ordinal?: number; day: Weekday }>; bymonthday: number[]; bymonth: number[];
  byhour: number[]; byminute: number[]; bysetpos: number[]; count?: number; until?: number; wkst: Weekday;
};
export class RuleError extends Error {
  /** Character offset of the offending part. */
  readonly position: number;
  constructor(message: string, position: number) { super(message); this.name = "RuleError"; this.position = position; }
}
export const MIN_INTERVAL_MINUTES = 5;
const FREQS = ["MINUTELY", "HOURLY", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"];

function numbers(value: string, min: number, max: number, name: string, position: number, allowNegative = false): number[] {
  return value.split(",").map((piece) => {
    const number = Number(piece);
    if (!/^-?\d+$/.test(piece) || (!allowNegative && number < 0) || Math.abs(number) < min || Math.abs(number) > max || (allowNegative && number === 0)) throw new RuleError(`${name} has the value ${piece}, which is not allowed`, position);
    return number;
  });
}

/** Parses the supported subset of RFC 5545 recurrence rules; an unsupported part is an error with its position. */
export function parseRule(text: string): Rule {
  const rule: Rule = { freq: "DAILY", interval: 1, byday: [], bymonthday: [], bymonth: [], byhour: [], byminute: [], bysetpos: [], wkst: "MO" };
  let position = 0, hasFreq = false;
  const source = text.trim().replace(/^RRULE:/i, "");
  if (!source) throw new RuleError("Enter a rule, for example FREQ=WEEKLY;BYDAY=MO", 0);
  for (const part of source.split(";")) {
    const at = position;
    position += part.length + 1;
    if (!part) continue;
    const [rawName, value = ""] = part.split("=");
    const name = rawName.toUpperCase();
    if (!value) throw new RuleError(`${rawName} has no value`, at);
    switch (name) {
      case "FREQ":
        if (value.toUpperCase() === "SECONDLY") throw new RuleError("SECONDLY is not supported", at);
        if (!FREQS.includes(value.toUpperCase())) throw new RuleError(`FREQ=${value} is not a frequency`, at);
        rule.freq = value.toUpperCase() as Rule["freq"]; hasFreq = true; break;
      case "INTERVAL": rule.interval = numbers(value, 1, 999, "INTERVAL", at)[0]; break;
      case "BYDAY":
        rule.byday = value.split(",").map((piece) => {
          const match = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(piece);
          if (!match) throw new RuleError(`BYDAY has the value ${piece}, which is not a weekday`, at);
          return { ...(match[1] ? { ordinal: Number(match[1]) } : {}), day: match[2].toUpperCase() as Weekday };
        });
        break;
      case "BYMONTHDAY": rule.bymonthday = numbers(value, 1, 31, "BYMONTHDAY", at, true); break;
      case "BYMONTH": rule.bymonth = numbers(value, 1, 12, "BYMONTH", at); break;
      case "BYHOUR": rule.byhour = numbers(value, 0, 23, "BYHOUR", at); break;
      case "BYMINUTE": rule.byminute = numbers(value, 0, 59, "BYMINUTE", at); break;
      case "BYSETPOS": rule.bysetpos = numbers(value, 1, 366, "BYSETPOS", at, true); break;
      case "COUNT": rule.count = numbers(value, 1, 100_000, "COUNT", at)[0]; break;
      case "UNTIL": {
        const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(value);
        if (!match) throw new RuleError("UNTIL is a date such as 20270131 or 20270131T235959Z", at);
        rule.until = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] ?? 23), Number(match[5] ?? 59), Number(match[6] ?? 59));
        break;
      }
      case "WKST":
        if (!(WEEKDAYS as readonly string[]).includes(value.toUpperCase())) throw new RuleError(`WKST=${value} is not a weekday`, at);
        rule.wkst = value.toUpperCase() as Weekday; break;
      case "BYSECOND": throw new RuleError("BYSECOND is not supported", at);
      default: throw new RuleError(`${rawName} is not supported`, at);
    }
  }
  if (!hasFreq) throw new RuleError("The rule needs FREQ", 0);
  return rule;
}

// — time zones —
const formatters = new Map<string, Intl.DateTimeFormat>();
function parts(ms: number, tzid: string): { year: number; month: number; day: number; hour: number; minute: number } {
  let formatter = formatters.get(tzid);
  if (!formatter) formatters.set(tzid, (formatter = new Intl.DateTimeFormat("en-US", { timeZone: tzid, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" })));
  const out: Record<string, number> = {};
  for (const part of formatter.formatToParts(ms)) if (part.type !== "literal") out[part.type] = Number(part.value);
  return { year: out.year, month: out.month, day: out.day, hour: out.hour % 24, minute: out.minute };
}
export function isTimeZone(tzid: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tzid }); return true; } catch { return false; }
}
/**
 * The instant of a wall-clock time in a zone. A time in an hour the clocks skip is the first valid instant after it; a
 * time in a repeated hour is its first instance.
 */
export function zonedTime(year: number, month: number, day: number, hour: number, minute: number, tzid: string): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const offsetAt = (ms: number) => { const p = parts(ms, tzid); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - ms; };
  // The two offsets around the time: before a transition and after it.
  const early = wall - offsetAt(wall - 86_400_000), late = wall - offsetAt(wall + 86_400_000);
  const fits = (ms: number) => { const p = parts(ms, tzid); return p.hour === hour && p.minute === minute && p.day === day; };
  if (fits(Math.min(early, late))) return Math.min(early, late);
  if (fits(Math.max(early, late))) return Math.max(early, late);
  // Skipped: the first instant after the gap is the later of the two readings rounded to the transition.
  let ms = Math.min(early, late);
  while (parts(ms, tzid).hour * 60 + parts(ms, tzid).minute < hour * 60 + minute && parts(ms, tzid).day === day) ms += 60_000;
  return ms;
}

const dayNumber = (year: number, month: number, day: number): number => Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
const fromDayNumber = (value: number) => { const date = new Date(value * 86_400_000); return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), weekday: date.getUTCDay() }; };
const daysIn = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** The days of one month the rule selects, before the frequency's own interval is applied. */
function monthDays(rule: Rule, year: number, month: number, startDay: number): number[] {
  const length = daysIn(year, month);
  let days: number[];
  if (rule.byday.length) {
    days = [];
    for (const entry of rule.byday) {
      const matching = Array.from({ length }, (_unused, index) => index + 1).filter((day) => WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] === entry.day);
      if (entry.ordinal === undefined) days.push(...matching);
      else { const picked = entry.ordinal > 0 ? matching[entry.ordinal - 1] : matching[matching.length + entry.ordinal]; if (picked) days.push(picked); }
    }
    if (rule.bymonthday.length) days = days.filter((day) => rule.bymonthday.some((wanted) => (wanted > 0 ? wanted : length + 1 + wanted) === day));
  } else days = (rule.bymonthday.length ? rule.bymonthday : [startDay]).map((wanted) => (wanted > 0 ? wanted : length + 1 + wanted)).filter((day) => day >= 1 && day <= length);
  days = [...new Set(days)].sort((a, b) => a - b);
  if (rule.bysetpos.length) days = rule.bysetpos.map((position) => (position > 0 ? days[position - 1] : days[days.length + position])).filter((day): day is number => day !== undefined).sort((a, b) => a - b);
  return days;
}

/** The occurrences of a schedule after an instant, in order. `limit` bounds the result, `horizonDays` the search. */
export function occurrences(schedule: AutomationSchedule, after_ms: number, limit: number, horizonDays = 366 * 5): number[] {
  const rule = parseRule(schedule.rrule);
  const [startYear, startMonth, startDay] = schedule.dtstart.split("-").map(Number);
  const start = dayNumber(startYear, startMonth, startDay);
  const found: number[] = [];
  let produced = 0;
  const emit = (ms: number): boolean => {
    produced += 1;
    if (rule.until !== undefined && ms > rule.until) return false;
    if (rule.count !== undefined && produced > rule.count) return false;
    if (ms > after_ms) found.push(ms);
    return found.length < limit;
  };
  if (rule.freq === "MINUTELY" || rule.freq === "HOURLY") {
    const step = rule.interval * (rule.freq === "HOURLY" ? 3_600_000 : 60_000);
    const first = zonedTime(startYear, startMonth, startDay, rule.freq === "HOURLY" ? 0 : 0, rule.byminute[0] ?? 0, schedule.tzid);
    // Without COUNT the search starts near `after`; with it every occurrence since the start is counted.
    let ms = rule.count === undefined && after_ms > first ? first + Math.floor((after_ms - first) / step) * step : first;
    const end = Math.max(after_ms, first) + horizonDays * 86_400_000;
    for (; ms <= end; ms += step) {
      const local = parts(ms, schedule.tzid);
      if (rule.byhour.length && !rule.byhour.includes(local.hour)) continue;
      if (rule.byday.length && !rule.byday.some((entry) => entry.day === WEEKDAYS[new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay()])) continue;
      if (!emit(ms)) break;
    }
    return found;
  }
  const hours = rule.byhour.length ? [...rule.byhour].sort((a, b) => a - b) : [0], minutes = rule.byminute.length ? [...rule.byminute].sort((a, b) => a - b) : [0];
  const startWeekday = fromDayNumber(start).weekday;
  const weekStart = start - ((startWeekday - WEEKDAYS.indexOf(rule.wkst) + 7) % 7);
  const afterDay = dayNumber(parts(after_ms, schedule.tzid).year, parts(after_ms, schedule.tzid).month, parts(after_ms, schedule.tzid).day);
  // Without COUNT nothing before the day of `after` matters.
  const from = rule.count === undefined ? Math.max(start, afterDay - 1) : start;
  const cache = new Map<string, number[]>();
  for (let day = from; day <= Math.max(afterDay, start) + horizonDays; day++) {
    const date = fromDayNumber(day);
    let matches = false;
    if (rule.bymonth.length && !rule.bymonth.includes(date.month)) continue;
    if (rule.freq === "DAILY") {
      matches = (day - start) % rule.interval === 0 && (!rule.byday.length || rule.byday.some((entry) => entry.day === WEEKDAYS[date.weekday])) && (!rule.bymonthday.length || rule.bymonthday.some((wanted) => (wanted > 0 ? wanted : daysIn(date.year, date.month) + 1 + wanted) === date.day));
    } else if (rule.freq === "WEEKLY") {
      matches = Math.floor((day - weekStart) / 7) % rule.interval === 0 && (rule.byday.length ? rule.byday.some((entry) => entry.day === WEEKDAYS[date.weekday]) : date.weekday === startWeekday);
    } else {
      const months = (date.year - startYear) * 12 + date.month - startMonth;
      if (rule.freq === "MONTHLY" ? months % rule.interval !== 0 : (date.year - startYear) % rule.interval !== 0 || (!rule.bymonth.length && date.month !== startMonth)) continue;
      const key = `${date.year}-${date.month}`;
      if (!cache.has(key)) cache.set(key, monthDays(rule, date.year, date.month, startDay));
      matches = cache.get(key)!.includes(date.day);
    }
    if (!matches) continue;
    for (const hour of hours) for (const minute of minutes) if (!emit(zonedTime(date.year, date.month, date.day, hour, minute, schedule.tzid))) return found;
  }
  return found;
}

/** Checks a schedule: the rule parses, the zone exists, and no two occurrences are closer than five minutes. */
export function checkSchedule(schedule: AutomationSchedule, minMinutes = MIN_INTERVAL_MINUTES): Rule {
  const rule = parseRule(schedule.rrule);
  if (!isTimeZone(schedule.tzid)) throw new RuleError(`${schedule.tzid} is not a time zone`, 0);
  const [year, month, day] = schedule.dtstart.split("-").map(Number);
  const next = occurrences(schedule, zonedTime(year, month, day, 0, 0, schedule.tzid) - 1, 12);
  for (let index = 1; index < next.length; index++) if (next[index] - next[index - 1] < minMinutes * 60_000) throw new RuleError(`The shortest interval is ${minMinutes} minutes`, 0);
  return rule;
}

// — the visual editor —
export type VisualSchedule = {
  every: number; unit: "minutes" | "hours" | "days" | "weeks" | "months"; weekdays: Weekday[];
  monthly: { kind: "day"; day: number | "last" } | { kind: "weekday"; ordinal: 1 | 2 | 3 | 4 | -1; weekday: Weekday };
  hour: number; minute: number; ends: { kind: "never" } | { kind: "on"; date: string } | { kind: "after"; runs: number };
};
const UNIT_FREQ = { minutes: "MINUTELY", hours: "HOURLY", days: "DAILY", weeks: "WEEKLY", months: "MONTHLY" } as const;
export function ruleOfVisual(visual: VisualSchedule): string {
  const pieces = [`FREQ=${UNIT_FREQ[visual.unit]}`, `INTERVAL=${visual.every}`];
  if (visual.unit === "weeks") pieces.push(`BYDAY=${WEEKDAYS.filter((day) => visual.weekdays.includes(day)).sort((a, b) => ((WEEKDAYS.indexOf(a) + 6) % 7) - ((WEEKDAYS.indexOf(b) + 6) % 7)).join(",")}`);
  if (visual.unit === "months") pieces.push(visual.monthly.kind === "day" ? `BYMONTHDAY=${visual.monthly.day === "last" ? -1 : visual.monthly.day}` : `BYDAY=${visual.monthly.weekday};BYSETPOS=${visual.monthly.ordinal}`);
  if (visual.unit === "days" || visual.unit === "weeks" || visual.unit === "months") pieces.push(`BYHOUR=${visual.hour}`, `BYMINUTE=${visual.minute}`);
  if (visual.ends.kind === "on") pieces.push(`UNTIL=${visual.ends.date.replaceAll("-", "")}`);
  if (visual.ends.kind === "after") pieces.push(`COUNT=${visual.ends.runs}`);
  return pieces.join(";");
}
/** The visual form of a rule, or undefined when the rule can only be edited as text. */
export function visualOfRule(text: string): VisualSchedule | undefined {
  let rule: Rule;
  try { rule = parseRule(text); } catch { return undefined; }
  const unit = (Object.keys(UNIT_FREQ) as Array<VisualSchedule["unit"]>).find((key) => UNIT_FREQ[key] === rule.freq);
  if (!unit || rule.bymonth.length || rule.byhour.length > 1 || rule.byminute.length > 1) return undefined;
  const timed = unit === "days" || unit === "weeks" || unit === "months";
  if (!timed && (rule.byhour.length || rule.byminute.length || rule.byday.length || rule.bymonthday.length || rule.bysetpos.length)) return undefined;
  const visual: VisualSchedule = {
    every: rule.interval, unit, weekdays: ["MO"], monthly: { kind: "day", day: 1 }, hour: rule.byhour[0] ?? 0, minute: rule.byminute[0] ?? 0,
    ends: rule.count !== undefined ? { kind: "after", runs: rule.count } : rule.until !== undefined ? { kind: "on", date: new Date(rule.until).toISOString().slice(0, 10) } : { kind: "never" },
  };
  if (unit === "days" && (rule.byday.length || rule.bymonthday.length || rule.bysetpos.length)) return undefined;
  if (unit === "weeks") {
    if (!rule.byday.length || rule.byday.some((entry) => entry.ordinal !== undefined) || rule.bymonthday.length || rule.bysetpos.length) return undefined;
    visual.weekdays = rule.byday.map((entry) => entry.day);
  }
  if (unit === "months") {
    if (rule.byday.length === 1 && rule.bysetpos.length === 1 && rule.byday[0].ordinal === undefined && [1, 2, 3, 4, -1].includes(rule.bysetpos[0]) && !rule.bymonthday.length) visual.monthly = { kind: "weekday", ordinal: rule.bysetpos[0] as 1, weekday: rule.byday[0].day };
    else if (rule.bymonthday.length === 1 && !rule.byday.length && !rule.bysetpos.length && (rule.bymonthday[0] === -1 || rule.bymonthday[0] > 0)) visual.monthly = { kind: "day", day: rule.bymonthday[0] === -1 ? "last" : rule.bymonthday[0] };
    else return undefined;
  }
  return visual;
}

const DAY_LABEL: Record<Weekday, string> = { SU: "Sun", MO: "Mon", TU: "Tue", WE: "Wed", TH: "Thu", FR: "Fri", SA: "Sat" };
const pad = (value: number): string => String(value).padStart(2, "0");
/** The sentence of a schedule as a list of pieces; `chip` pieces are drawn as token chips. */
export function describeSchedule(schedule: AutomationSchedule): Array<{ text: string; chip?: boolean }> {
  const visual = visualOfRule(schedule.rrule);
  if (!visual) return [{ text: "On the rule" }, { text: schedule.rrule, chip: true }, { text: `(${schedule.tzid})`, chip: true }];
  const unit = visual.every === 1 ? visual.unit.slice(0, -1) : `${visual.every} ${visual.unit}`;
  const out: Array<{ text: string; chip?: boolean }> = [{ text: "Every" }, { text: unit, chip: true }];
  if (visual.unit === "weeks") out.push({ text: "on" }, { text: visual.weekdays.map((day) => DAY_LABEL[day]).join(", "), chip: true });
  if (visual.unit === "months") out.push({ text: "on" }, { text: visual.monthly.kind === "day" ? (visual.monthly.day === "last" ? "the last day" : `day ${visual.monthly.day}`) : `the ${{ 1: "first", 2: "second", 3: "third", 4: "fourth", [-1]: "last" }[visual.monthly.ordinal]} ${DAY_LABEL[visual.monthly.weekday]}`, chip: true });
  if (visual.unit === "days" || visual.unit === "weeks" || visual.unit === "months") out.push({ text: "at" }, { text: `${pad(visual.hour)}:${pad(visual.minute)}`, chip: true });
  out.push({ text: schedule.tzid, chip: true });
  return out;
}
export const scheduleText = (schedule: AutomationSchedule): string => {
  const pieces = describeSchedule(schedule);
  return `${pieces.slice(0, -1).map((piece) => piece.text).join(" ")} (${pieces.at(-1)!.text.replace(/^\(|\)$/g, "")})`;
};

/**
 * A cadence named in a prompt, recognised by fixed pattern tables for English, Vietnamese and Japanese — never by a
 * model. A cadence without a time runs at 09:00; an interval under five minutes is raised to five.
 */
export function cadenceOf(prompt: string): { rrule: string; raised?: boolean } | undefined {
  const text = prompt.toLowerCase();
  const time = (): { hour: number; minute: number } => {
    const en = /\bat (\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/.exec(text);
    const vi = /lúc (\d{1,2})(?:[:h](\d{2}))?\s*(?:giờ)?\s*(sáng|chiều|tối)?/.exec(text);
    const ja = /(午前|午後)?(\d{1,2})時(?:(\d{1,2})分)?/.exec(text);
    const found = en ? { hour: en[1], minute: en[2], half: en[3] } : vi ? { hour: vi[1], minute: vi[2], half: vi[3] } : ja ? { hour: ja[2], minute: ja[3], half: ja[1] } : undefined;
    if (!found) return { hour: 9, minute: 0 };
    let hour = Number(found.hour);
    if ((found.half === "pm" || found.half === "chiều" || found.half === "tối" || found.half === "午後") && hour < 12) hour += 12;
    if ((found.half === "am" || found.half === "午前") && hour === 12) hour = 0;
    return { hour: Math.min(hour, 23), minute: Number(found.minute ?? 0) };
  };
  const at = () => { const { hour, minute } = time(); return `BYHOUR=${hour};BYMINUTE=${minute}`; };
  const every = /every (\d+) (minute|hour|day|week|month)s?/.exec(text) ?? /mỗi (\d+) (phút|giờ|ngày|tuần|tháng)/.exec(text) ?? /(\d+)(分|時間|日|週間|か月|ヶ月)(?:ごと|おき|毎)/.exec(text);
  if (every) {
    const unit = { minute: "MINUTELY", phút: "MINUTELY", 分: "MINUTELY", hour: "HOURLY", giờ: "HOURLY", 時間: "HOURLY", day: "DAILY", ngày: "DAILY", 日: "DAILY", week: "WEEKLY", tuần: "WEEKLY", 週間: "WEEKLY", month: "MONTHLY", tháng: "MONTHLY", か月: "MONTHLY", ヶ月: "MONTHLY" }[every[2]]!;
    const count = Number(every[1]);
    if (unit === "MINUTELY") return { rrule: `FREQ=MINUTELY;INTERVAL=${Math.max(count, MIN_INTERVAL_MINUTES)}`, ...(count < MIN_INTERVAL_MINUTES ? { raised: true } : {}) };
    if (unit === "HOURLY") return { rrule: `FREQ=HOURLY;INTERVAL=${count}` };
    return { rrule: `FREQ=${unit};INTERVAL=${count};${at()}` };
  }
  const DAYS: Array<[RegExp, Weekday]> = [[/\bmon(day)?s?\b|thứ hai|月曜/, "MO"], [/\btue(sday)?s?\b|thứ ba|火曜/, "TU"], [/\bwed(nesday)?s?\b|thứ tư|水曜/, "WE"], [/\bthu(rsday)?s?\b|thứ năm|木曜/, "TH"], [/\bfri(day)?s?\b|thứ sáu|金曜/, "FR"], [/\bsat(urday)?s?\b|thứ bảy|土曜/, "SA"], [/\bsun(day)?s?\b|chủ nhật|日曜/, "SU"]];
  if (/every weekday|weekdays|mỗi ngày trong tuần|平日/.test(text)) return { rrule: `FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR;${at()}` };
  if (/every weekend|weekends|mỗi cuối tuần|週末/.test(text)) return { rrule: `FREQ=WEEKLY;INTERVAL=1;BYDAY=SA,SU;${at()}` };
  if (/every |mỗi |毎週/.test(text)) {
    const days = DAYS.filter(([pattern]) => pattern.test(text)).map(([, day]) => day);
    if (days.length) return { rrule: `FREQ=WEEKLY;INTERVAL=1;BYDAY=${days.join(",")};${at()}` };
  }
  const ordinal = /on the (\d{1,2})(?:st|nd|rd|th) of each month/.exec(text) ?? /ngày (\d{1,2}) hàng tháng/.exec(text) ?? /毎月(\d{1,2})日/.exec(text);
  if (ordinal) return { rrule: `FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=${Number(ordinal[1])};${at()}` };
  if (/every day|daily|mỗi ngày|hàng ngày|毎日/.test(text)) return { rrule: `FREQ=DAILY;INTERVAL=1;${at()}` };
  if (/\bweekly\b|hàng tuần|mỗi tuần|毎週/.test(text)) return { rrule: `FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;${at()}` };
  if (/\bmonthly\b|hàng tháng|mỗi tháng|毎月/.test(text)) return { rrule: `FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=1;${at()}` };
  return undefined;
}
