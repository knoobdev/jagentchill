import assert from "node:assert/strict";
import { test } from "node:test";
import { workflow as wf } from "../src/index.ts";

const at = (iso: string) => Date.parse(iso);
const local = (ms: number, tzid: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tzid, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" }).format(ms);

test("Schedule trigger with the visual editor: Weekly schedule", () => {
  const visual: wf.VisualSchedule = { every: 1, unit: "weeks", weekdays: ["TH", "MO"], monthly: { kind: "day", day: 1 }, hour: 8, minute: 30, ends: { kind: "never" } };
  const rrule = wf.ruleOfVisual(visual);
  assert.equal(rrule, "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TH;BYHOUR=8;BYMINUTE=30");
  const schedule = { rrule, tzid: "Asia/Tokyo", dtstart: "2026-10-05" };
  assert.equal(wf.scheduleText(schedule), "Every week on Mon, Thu at 08:30 (Asia/Tokyo)");
  assert.deepEqual(wf.describeSchedule(schedule).filter((piece) => piece.chip).map((piece) => piece.text), ["week", "Mon, Thu", "08:30", "Asia/Tokyo"]);
  const next = wf.occurrences(schedule, at("2026-10-05T00:00:00+09:00"), 3);
  assert.deepEqual(next.map((ms) => local(ms, "Asia/Tokyo")), ["Mon, 05/10/2026, 08:30", "Thu, 08/10/2026, 08:30", "Mon, 12/10/2026, 08:30"]);
  assert.deepEqual(wf.visualOfRule(rrule), { ...visual, weekdays: ["MO", "TH"] });
});

test("Schedule trigger with the visual editor: Interval too short", () => {
  const rrule = wf.ruleOfVisual({ every: 2, unit: "minutes", weekdays: [], monthly: { kind: "day", day: 1 }, hour: 0, minute: 0, ends: { kind: "never" } });
  assert.throws(() => wf.checkSchedule({ rrule, tzid: "UTC", dtstart: "2026-10-05" }), /The shortest interval is 5 minutes/);
  assert.doesNotThrow(() => wf.checkSchedule({ rrule: "FREQ=MINUTELY;INTERVAL=5", tzid: "UTC", dtstart: "2026-10-05" }));
  // A rule whose shortest gap is under five minutes is refused even when its frequency is not.
  assert.throws(() => wf.checkSchedule({ rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0,2", tzid: "UTC", dtstart: "2026-10-05" }), /shortest interval/);
  assert.throws(() => wf.checkSchedule({ rrule: "FREQ=DAILY", tzid: "Mars/Olympus", dtstart: "2026-10-05" }), /not a time zone/);
});

test("Schedule trigger with the visual editor: Day 31 in a short month", () => {
  const schedule = { rrule: wf.ruleOfVisual({ every: 1, unit: "months", weekdays: [], monthly: { kind: "day", day: 31 }, hour: 9, minute: 0, ends: { kind: "never" } }), tzid: "UTC", dtstart: "2026-10-01" };
  const next = wf.occurrences(schedule, at("2026-10-01T00:00:00Z"), 4);
  assert.deepEqual(next.map((ms) => new Date(ms).toISOString().slice(0, 16)), ["2026-10-31T09:00", "2026-12-31T09:00", "2027-01-31T09:00", "2027-03-31T09:00"]);
  const last = { ...schedule, rrule: wf.ruleOfVisual({ every: 1, unit: "months", weekdays: [], monthly: { kind: "day", day: "last" }, hour: 9, minute: 0, ends: { kind: "never" } }) };
  assert.deepEqual(wf.occurrences(last, at("2026-10-31T10:00:00Z"), 2).map((ms) => new Date(ms).toISOString().slice(0, 10)), ["2026-11-30", "2026-12-31"]);
});

test("Schedule trigger with RRULE: Valid rule — the first Monday of the next three months at 10:00", () => {
  const schedule = { rrule: "FREQ=MONTHLY;BYDAY=MO;BYSETPOS=1;BYHOUR=10;BYMINUTE=0", tzid: "UTC", dtstart: "2026-10-06" };
  assert.doesNotThrow(() => wf.checkSchedule(schedule));
  assert.deepEqual(wf.occurrences(schedule, at("2026-10-06T00:00:00Z"), 3).map((ms) => new Date(ms).toISOString().slice(0, 16)), ["2026-11-02T10:00", "2026-12-07T10:00", "2027-01-04T10:00"]);
  assert.deepEqual(wf.visualOfRule(schedule.rrule)!.monthly, { kind: "weekday", ordinal: 1, weekday: "MO" });
});

test("Schedule trigger with RRULE: Unsupported part", () => {
  assert.throws(() => wf.parseRule("FREQ=SECONDLY"), (error: wf.RuleError) => error.message === "SECONDLY is not supported" && error.position === 0);
  assert.throws(() => wf.parseRule("FREQ=DAILY;BYSECOND=5"), (error: wf.RuleError) => error instanceof wf.RuleError && error.position === 11);
  assert.throws(() => wf.parseRule(""), /Enter a rule/);
  assert.throws(() => wf.parseRule("FREQ=DAILY;BYHOUR=25"), /BYHOUR has the value 25/);
  assert.equal(wf.parseRule("rrule:freq=weekly;byday=mo,-1fr;wkst=su").byday.length, 2);
});

test("Schedule trigger with RRULE: Rule not expressible visually", () => {
  assert.equal(wf.visualOfRule("FREQ=MONTHLY;BYDAY=MO;BYSETPOS=-2;BYHOUR=10;BYMINUTE=0"), undefined);
  assert.equal(wf.visualOfRule("FREQ=YEARLY;BYMONTH=3"), undefined);
  assert.equal(wf.visualOfRule("FREQ=DAILY;BYHOUR=9,17;BYMINUTE=0"), undefined);
  assert.ok(wf.visualOfRule("FREQ=DAILY;INTERVAL=2;BYHOUR=9;BYMINUTE=15"));
});

test("Schedule timing, time zones and missed runs: Daylight-saving change", () => {
  const schedule = { rrule: "FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0", tzid: "Europe/Berlin", dtstart: "2027-03-26" };
  const next = wf.occurrences(schedule, at("2027-03-26T00:00:00Z"), 4);
  assert.deepEqual(next.map((ms) => local(ms, "Europe/Berlin").slice(-5)), ["09:00", "09:00", "09:00", "09:00"]);
  // The clocks go forward on 28 March 2027: the gap between the two runs is 23 hours.
  assert.equal(next[2] - next[1], 23 * 3_600_000);
  // An occurrence in the skipped hour runs at the first valid instant after it.
  const skipped = wf.occurrences({ rrule: "FREQ=DAILY;BYHOUR=2;BYMINUTE=30", tzid: "Europe/Berlin", dtstart: "2027-03-28" }, at("2027-03-27T23:00:00Z"), 1)[0];
  assert.equal(new Date(skipped).toISOString(), "2027-03-28T01:00:00.000Z");
  // An occurrence in the repeated hour runs once, at its first instance.
  const repeated = wf.occurrences({ rrule: "FREQ=DAILY;BYHOUR=2;BYMINUTE=30", tzid: "Europe/Berlin", dtstart: "2027-10-31" }, at("2027-10-30T22:00:00Z"), 2);
  assert.equal(new Date(repeated[0]).toISOString(), "2027-10-31T00:30:00.000Z");
  assert.equal(new Date(repeated[1]).toISOString().slice(0, 10), "2027-11-01");
});

test("Schedule timing: COUNT and UNTIL end a schedule; intervals count from the start date", () => {
  const counted = { rrule: "FREQ=DAILY;COUNT=3;BYHOUR=9;BYMINUTE=0", tzid: "UTC", dtstart: "2026-10-05" };
  assert.equal(wf.occurrences(counted, at("2026-10-05T00:00:00Z"), 10).length, 3);
  assert.deepEqual(wf.occurrences(counted, at("2026-10-07T10:00:00Z"), 10), []);
  assert.equal(wf.occurrences({ rrule: "FREQ=DAILY;UNTIL=20261007;BYHOUR=9;BYMINUTE=0", tzid: "UTC", dtstart: "2026-10-05" }, at("2026-10-05T00:00:00Z"), 10).length, 3);
  const everyThird = wf.occurrences({ rrule: "FREQ=DAILY;INTERVAL=3;BYHOUR=9;BYMINUTE=0", tzid: "UTC", dtstart: "2026-10-05" }, at("2026-10-09T00:00:00Z"), 2);
  assert.deepEqual(everyThird.map((ms) => new Date(ms).toISOString().slice(0, 10)), ["2026-10-11", "2026-10-14"]);
  const minutes = wf.occurrences({ rrule: "FREQ=MINUTELY;INTERVAL=15", tzid: "UTC", dtstart: "2026-10-05" }, at("2026-10-06T10:07:00Z"), 2);
  assert.deepEqual(minutes.map((ms) => new Date(ms).toISOString().slice(11, 16)), ["10:15", "10:30"]);
});

test("Automations index: Prompt to draft, Vietnamese cadence, and No cadence in the prompt", () => {
  assert.deepEqual(wf.cadenceOf("every weekday at 9 export yesterday's project as 1080p"), { rrule: "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0" });
  assert.deepEqual(wf.cadenceOf("mỗi thứ hai lúc 8 giờ làm video tổng kết tuần"), { rrule: "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;BYHOUR=8;BYMINUTE=0" });
  assert.equal(wf.cadenceOf("caption my new clips"), undefined);
  assert.deepEqual(wf.cadenceOf("every 2 minutes check the folder"), { rrule: "FREQ=MINUTELY;INTERVAL=5", raised: true });
  assert.deepEqual(wf.cadenceOf("Every Monday make a recap"), { rrule: "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;BYHOUR=9;BYMINUTE=0" });
  assert.deepEqual(wf.cadenceOf("daily at 6:30 pm"), { rrule: "FREQ=DAILY;INTERVAL=1;BYHOUR=18;BYMINUTE=30" });
  assert.deepEqual(wf.cadenceOf("on the 15th of each month"), { rrule: "FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=15;BYHOUR=9;BYMINUTE=0" });
  assert.deepEqual(wf.cadenceOf("毎週金曜 18時 にまとめを作る"), { rrule: "FREQ=WEEKLY;INTERVAL=1;BYDAY=FR;BYHOUR=18;BYMINUTE=0" });
  assert.deepEqual(wf.cadenceOf("every 3 hours"), { rrule: "FREQ=HOURLY;INTERVAL=3" });
});
