import { useEffect, useMemo, useState, type RefObject } from "react";
import { View } from "react-native";
import { workflow as wf } from "@jagentchill/editor-core";
import type { AutomationSchedule } from "@jagentchill/protocol";
import { AdaptiveSheet, Button, Combobox, DateField, Input, NumberField, Segmented, Select, Text, TimeField, TokenChip, WeekdayPicker, space, useTheme } from "@jagentchill/ui";
import { useT, type T } from "../locale";
import { UNIT_LABELS } from "./strings";

export const deviceZone = (): string => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } };
const today = (): string => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; };
const zones = (): string[] => { try { return (Intl as unknown as { supportedValuesOf(key: string): string[] }).supportedValuesOf("timeZone"); } catch { return []; } };
export const defaultSchedule = (rrule = "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;BYHOUR=9;BYMINUTE=0"): AutomationSchedule => ({ rrule, tzid: deviceZone(), dtstart: today() });

/** A moment in a schedule's own time zone, as weekday, day, month and 24-hour time. */
export function whenText(ms: number, tzid: string, locale: string): string {
  try { return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tzid }).format(ms); } catch { return new Date(ms).toISOString(); }
}
/** The next occurrences of a schedule, or the reason it is refused. */
export function scheduleState(schedule: AutomationSchedule, now: number): { next: number[]; error?: string; position?: number } {
  try { wf.checkSchedule(schedule); return { next: wf.occurrences(schedule, now, 3) }; }
  catch (error) { return { next: [], error: error instanceof Error ? error.message : String(error), ...(error instanceof wf.RuleError && error.position > 0 ? { position: error.position } : {}) }; }
}
const word = (t: T, text: string): string => (text === "Every" ? t("Every") : text === "on" ? t("on") : text === "at" ? t("at") : text === "On the rule" ? t("On the rule") : text);

/** A schedule as a sentence of words and accent token chips: "Every week on Mon at 09:00 Asia/Tokyo". */
export function ScheduleSentence(props: { schedule: AutomationSchedule; onPress?(): void }) {
  const t = useT();
  return (
    <View testID="schedule-sentence" accessibilityLabel={wf.scheduleText(props.schedule)} aria-label={wf.scheduleText(props.schedule)} style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space[1], flex: 1, minWidth: 0 }}>
      {wf.describeSchedule(props.schedule).map((piece, index, all) => (piece.chip ? <TokenChip key={index} label={piece.text} icon={index === all.length - 1 ? "globe" : undefined} onPress={props.onPress} /> : <Text key={index}>{word(t, piece.text)}</Text>))}
    </View>
  );
}

const ORDINALS = [{ value: "1", label: "First" }, { value: "2", label: "Second" }, { value: "3", label: "Third" }, { value: "4", label: "Fourth" }, { value: "-1", label: "Last" }] as const;
const DAY_NAMES = { SU: "Sunday", MO: "Monday", TU: "Tuesday", WE: "Wednesday", TH: "Thursday", FR: "Friday", SA: "Saturday" };
const INITIAL: wf.VisualSchedule = { every: 1, unit: "weeks", weekdays: ["MO"], monthly: { kind: "day", day: 1 }, hour: 9, minute: 0, ends: { kind: "never" } };

/**
 * The schedule editor: "Visual" builds the rule from a repeat interval, weekdays or a day of the month, a time, a zone,
 * a start and an end; "RRULE" takes the rule as text. Both show the next three runs in the chosen zone, and "Apply"
 * is offered only for a rule the host would accept.
 */
export function ScheduleEditor(props: { open: boolean; onClose(): void; anchor?: RefObject<View | null>; value: AutomationSchedule | null; onApply(schedule: AutomationSchedule): void }) {
  const t = useT(), theme = useTheme();
  const [mode, setMode] = useState<"visual" | "rrule">("visual");
  const [visual, setVisual] = useState<wf.VisualSchedule>(INITIAL);
  const [rule, setRule] = useState("");
  const [tzid, setTzid] = useState(deviceZone());
  const [dtstart, setDtstart] = useState(today());
  useEffect(() => {
    if (!props.open) return;
    const start = props.value ?? defaultSchedule();
    const seen = wf.visualOfRule(start.rrule);
    setVisual(seen ?? INITIAL);
    setRule(start.rrule);
    setTzid(start.tzid);
    setDtstart(start.dtstart);
    setMode(seen ? "visual" : "rrule");
  }, [props.open]); // eslint-disable-line react-hooks/exhaustive-deps
  const expressible = mode === "visual" || wf.visualOfRule(rule) !== undefined;
  const schedule: AutomationSchedule = { rrule: mode === "visual" ? wf.ruleOfVisual(visual) : rule.trim(), tzid, dtstart };
  const state = useMemo(() => scheduleState(schedule, Date.now()), [schedule.rrule, tzid, dtstart]); // eslint-disable-line react-hooks/exhaustive-deps
  const short = visual.unit === "minutes" && visual.every < wf.MIN_INTERVAL_MINUTES;
  const noDay = visual.unit === "weeks" && visual.weekdays.length === 0;
  const problem = mode === "visual" ? (short ? t("The shortest interval is 5 minutes") : noDay ? t("Choose at least one day") : state.error) : state.error && state.position ? t("{message} (at character {n})", { message: state.error, n: state.position + 1 }) : state.error;
  const timed = visual.unit === "days" || visual.unit === "weeks" || visual.unit === "months";
  const zoneOptions = useMemo(() => [...new Set([tzid, deviceZone(), "UTC", ...zones()])].map((value) => ({ value, label: value })), [tzid]);
  const set = (patch: Partial<wf.VisualSchedule>) => setVisual({ ...visual, ...patch });
  const switchMode = (next: "visual" | "rrule") => {
    if (next === "rrule") setRule(wf.ruleOfVisual(visual)); else { const seen = wf.visualOfRule(rule); if (!seen) return; setVisual(seen); }
    setMode(next);
  };
  const row = (label: string, control: React.ReactNode) => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], minHeight: 32 }}>
      <View style={{ width: 88 }}><Text variant="meta" color="text/secondary">{label}</Text></View>
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>{control}</View>
    </View>
  );
  return (
    <AdaptiveSheet open={props.open} onClose={props.onClose} anchor={props.anchor} title={t("Schedule")} width={360}>
      <View testID="schedule-editor" style={{ gap: space[2], width: theme.compact ? undefined : 320, padding: theme.compact ? 0 : space[1] }}>
        <Segmented block size="sm" label={t("Schedule editor")} value={mode} onChange={switchMode} options={[{ value: "visual", label: t("Visual"), disabled: !expressible }, { value: "rrule", label: "RRULE" }]} />
        {!expressible ? <Text variant="meta" color="text/secondary">{t("This rule can only be edited as RRULE")}</Text> : null}
        {mode === "visual" ? (
          <>
            {row(t("Repeat every"), <>
              <NumberField label={t("Repeat every")} hideLabel size="sm" width={72} min={1} max={999} step={1} value={visual.every} onCommit={(every) => set({ every })} onChange={(every) => set({ every })} invalid={short} />
              <Select size="sm" width={140} label={t("Unit")} value={visual.unit} onChange={(unit) => set({ unit })} options={(Object.keys(UNIT_LABELS) as Array<wf.VisualSchedule["unit"]>).map((value) => ({ value, label: t(UNIT_LABELS[value]) }))} />
            </>)}
            {visual.unit === "weeks" ? row(t("On"), <WeekdayPicker label={t("Days of the week")} value={visual.weekdays.map((day) => wf.WEEKDAYS.indexOf(day))} onChange={(days) => set({ weekdays: days.map((day) => wf.WEEKDAYS[day]) })} />) : null}
            {visual.unit === "months" ? row(t("On"), <>
              <Select size="sm" width={120} label={t("Monthly pattern")} value={visual.monthly.kind} onChange={(kind) => set({ monthly: kind === "day" ? { kind: "day", day: 1 } : { kind: "weekday", ordinal: 1, weekday: "MO" } })} options={[{ value: "day", label: t("On day") }, { value: "weekday", label: t("On the") }]} />
              {visual.monthly.kind === "day" ? (
                <Select size="sm" width={110} label={t("Day of the month")} value={String(visual.monthly.day)} onChange={(day) => set({ monthly: { kind: "day", day: day === "last" ? "last" : Number(day) } })} options={[...Array.from({ length: 31 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) })), { value: "last", label: t("Last day") }]} />
              ) : (
                <>
                  <Select size="sm" width={100} label={t("Which one")} value={String(visual.monthly.ordinal)} onChange={(ordinal) => visual.monthly.kind === "weekday" && set({ monthly: { ...visual.monthly, ordinal: Number(ordinal) as 1 } })} options={ORDINALS.map((entry) => ({ value: entry.value, label: t(entry.label) }))} />
                  <Select size="sm" width={130} label={t("Day of the week")} value={visual.monthly.weekday} onChange={(weekday) => visual.monthly.kind === "weekday" && set({ monthly: { ...visual.monthly, weekday } })} options={wf.WEEKDAYS.map((value) => ({ value, label: t(DAY_NAMES[value]) }))} />
                </>
              )}
            </>) : null}
            {timed ? row(t("At"), <TimeField size="sm" label={t("Time")} value={`${String(visual.hour).padStart(2, "0")}:${String(visual.minute).padStart(2, "0")}`} onChange={(value) => { const [hour, minute] = value.split(":").map(Number); if (Number.isFinite(hour) && Number.isFinite(minute)) set({ hour, minute }); }} />) : null}
          </>
        ) : (
          <Input mono multiline value={rule} onChangeText={setRule} accessibilityLabel={t("Rule")} aria-label={t("Rule")} testID="schedule-rrule" placeholder="FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0" invalid={!!state.error} style={{ minHeight: 64 }} />
        )}
        {row(t("Time zone"), <Combobox size="sm" width={216} label={t("Time zone")} value={tzid} onChange={(value) => setTzid(String(value))} options={zoneOptions} />)}
        {row(t("Starts"), <DateField size="sm" label={t("Starts")} value={dtstart} onChange={(value) => { if (value) setDtstart(value); }} />)}
        {mode === "visual" ? row(t("Ends"), <>
          <Select size="sm" width={120} label={t("Ends")} value={visual.ends.kind} onChange={(kind) => set({ ends: kind === "never" ? { kind } : kind === "on" ? { kind, date: dtstart } : { kind, runs: 10 } })} options={[{ value: "never", label: t("Never") }, { value: "on", label: t("On a date") }, { value: "after", label: t("After runs") }]} />
          {visual.ends.kind === "on" ? <DateField size="sm" label={t("End date")} value={visual.ends.date} onChange={(date) => { if (date) set({ ends: { kind: "on", date } }); }} /> : null}
          {visual.ends.kind === "after" ? <NumberField label={t("Runs")} hideLabel size="sm" width={72} min={1} max={100_000} step={1} value={visual.ends.runs} onCommit={(runs) => set({ ends: { kind: "after", runs } })} /> : null}
        </>) : null}
        {problem ? <Text variant="meta" color="danger/text" role="alert" testID="schedule-error">{problem}</Text>
          : <Text variant="meta" color="text/secondary" testID="schedule-next">{state.next.length ? t("Next: {times}", { times: state.next.map((ms) => whenText(ms, tzid, theme.locale)).join(" · ") }) : t("This schedule has no run left")}</Text>}
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: space[2], paddingTop: space[1] }}>
          <Button kind="ghost" size="sm" label={t("Cancel")} onPress={props.onClose} />
          <Button kind="primary" size="sm" label={t("Apply")} disabled={!!problem} testID="schedule-apply" onPress={() => { props.onApply(schedule); props.onClose(); }} />
        </View>
      </View>
    </AdaptiveSheet>
  );
}
