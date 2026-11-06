import { useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { Icon } from "./Icon.tsx";
import { Button, IconButton } from "./button.tsx";
import { Chip } from "./chips.tsx";
import { FieldError, Input, fieldBox } from "./input.tsx";
import {
  DEFAULT_PRESETS, WEEKDAY_PRESETS, addMonths, dateAllowed, formatDate, formatRange, fromIso, fullDate, gridKey, monthGrid, monthNames, parseDate, parseTime, pickRangeDay, presetRange,
  rangeTooLong, stepTime, timeParts, timeSegments, timeValue, todayIso, toggleWeekday, typeDigit, weekdays, type DateLimits, type DayRange, type RangePreset, type TimeSegment,
} from "./logic/date.ts";
import { focusElement } from "./platform/dom";
import { Popover } from "./overlay.tsx";
import { Select } from "./select.tsx";
import { Tap, type ForcedState } from "./tap.tsx";
import { Text } from "./text.tsx";
import { useTheme } from "./theme.tsx";
import { borderWidth, radius, size, space } from "./tokens.ts";
import type { StringKey } from "./strings.ts";

type CalendarProps = DateLimits & {
  /** `YYYY-MM` of the month shown. */
  month: string; onMonthChange(month: string): void; focused: string; onFocus(day: string): void; onPick(day: string): void;
  selected?: string | null; range?: { start: string | null; end: string | null }; hideHeader?: boolean; label: string;
};

/** A month grid with the `grid` role: each day's accessible name is its full date. Arrows move by day and week, Page Up/Down by month, with Shift by year, Home/End to the ends of the week. */
export function Calendar(props: CalendarProps) {
  const theme = useTheme();
  const [year, month] = props.month.split("-").map(Number) as [number, number];
  const weeks = monthGrid(year, month, theme.firstDayOfWeek);
  const names = weekdays(theme.locale, theme.firstDayOfWeek);
  const cell = theme.touch ? size.calendarCellTouch : size.calendarCell;
  const refs = useRef(new Map<string, View | null>());
  const today = todayIso();
  const move = (day: string) => { props.onFocus(day); if (day.slice(0, 7) !== props.month) props.onMonthChange(day.slice(0, 7)); setTimeout(() => focusElement(refs.current.get(day)), 0); };
  const years = Array.from({ length: 21 }, (_, index) => String(year - 10 + index));
  return (
    <View style={{ gap: space[2] }}>
      {props.hideHeader ? <Text variant="body-medium" align="center">{new Intl.DateTimeFormat(theme.locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)))}</Text> : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}>
          <IconButton icon={theme.rtl ? "chev-r" : "chev-l"} size="xs" compactVisual label={theme.t("previousMonth")} onPress={() => props.onMonthChange(addMonths(`${props.month}-01`, -1).slice(0, 7))} />
          <View style={{ flex: 1, flexDirection: "row", gap: space[1] }}>
            <Select size="sm" label={theme.t("month")} value={String(month)} options={monthNames(theme.locale).map((name, index) => ({ value: String(index + 1), label: name }))} onChange={(value) => props.onMonthChange(`${year}-${value.padStart(2, "0")}`)} />
            <Select size="sm" label={theme.t("year")} value={String(year)} options={years.map((value) => ({ value, label: value }))} width={size.sliderMin * 2} onChange={(value) => props.onMonthChange(`${value}-${String(month).padStart(2, "0")}`)} />
          </View>
          <IconButton icon={theme.rtl ? "chev-l" : "chev-r"} size="xs" compactVisual label={theme.t("nextMonth")} onPress={() => props.onMonthChange(addMonths(`${props.month}-01`, 1).slice(0, 7))} />
        </View>
      )}
      <View role="grid" aria-label={props.label} accessibilityLabel={props.label}>
        <View role="row" style={{ flexDirection: "row" }}>
          {names.map((name) => <View key={name.day} role="columnheader" aria-label={name.full} style={{ width: cell, alignItems: "center" }}><Text variant="caption" color="text/secondary">{name.narrow}</Text></View>)}
        </View>
        {weeks.map((week) => (
          <View key={week[0]} role="row" style={{ flexDirection: "row" }}>
            {week.map((day) => {
              const outside = day.slice(0, 7) !== props.month;
              const allowed = dateAllowed(day, props);
              const picked = props.selected === day || props.range?.start === day || props.range?.end === day;
              const between = Boolean(props.range?.start && props.range.end && day > props.range.start && day < props.range.end);
              return (
                <Tap key={day} ref={(node) => { refs.current.set(day, node); }} role="gridcell" label={fullDate(day, theme.locale)} selected={picked} disabled={!allowed} testID={`day-${day}`}
                  aria={{ "aria-selected": picked, "aria-current": day === today ? "date" : undefined }} tabIndex={day === props.focused ? 0 : -1} onPress={() => props.onPick(day)}
                  onKeyDown={(key) => {
                    if (key.key === "Enter" || key.key === " ") { key.preventDefault(); if (allowed) props.onPick(day); return; }
                    const next = gridKey(day, key.key, key.shift, theme.firstDayOfWeek, theme.rtl);
                    if (next) { key.preventDefault(); move(next); }
                  }}
                  style={(state) => ({ width: cell, height: cell, alignItems: "center", justifyContent: "center", borderRadius: radius.sm,
                    backgroundColor: picked ? theme.color("accent") : between ? theme.color("accent/subtle") : state.hovered ? theme.color("bg/hover") : "transparent",
                    borderWidth: borderWidth.hairline, borderColor: day === today && !picked ? theme.color("border/control") : "transparent" })}>
                  <Text color={picked ? "text/on-accent" : outside ? "text/secondary" : "text/primary"} tabular>{String(fromIso(day)!.d)}</Text>
                </Tap>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

export type DateFieldProps = DateLimits & { label: string; value: string | null; onChange(value: string | null): void; size?: "sm" | "md"; disabled?: boolean; invalid?: boolean; error?: string; preferNative?: boolean; width?: number; forceOpen?: boolean; forceState?: ForcedState };

/**
 * A date in the locale's short format with a calendar button. Typing accepts the locale format and ISO `YYYY-MM-DD`. On iOS
 * and Android `preferNative` hands the field to the system date input.
 */
export function DateField(props: DateFieldProps) {
  const theme = useTheme();
  const [text, setText] = useState<string | null>(null);
  const [open, setOpen] = useState(Boolean(props.forceOpen));
  const [bad, setBad] = useState(false);
  const anchor = useRef<View>(null);
  const start = props.value ?? todayIso();
  const [month, setMonth] = useState(start.slice(0, 7));
  const [focused, setFocused] = useState(start);
  const commit = (raw: string) => {
    setText(null);
    if (raw.trim() === "") { setBad(false); if (props.value !== null) props.onChange(null); return; }
    const day = parseDate(raw, theme.locale);
    if (!day || !dateAllowed(day, props)) { setBad(true); return; }
    setBad(false);
    if (day !== props.value) props.onChange(day);
  };
  const show = () => { const day = props.value ?? todayIso(); setMonth(day.slice(0, 7)); setFocused(day); setOpen(true); };
  return (
    <View ref={anchor} style={{ width: props.width, minWidth: 0 }}>
      <Input accessibilityLabel={props.label} size={props.size} forceState={props.forceState} value={text ?? (props.value ? formatDate(props.value, theme.locale) : "")} placeholder={formatDate("2026-12-31", theme.locale).replace(/\d/g, "–")} disabled={props.disabled}
        invalid={bad || props.invalid} error={props.error} onChangeText={setText} onBlur={() => { if (text !== null) commit(text); }} onSubmitEditing={() => { if (text !== null) commit(text); }}
        onKey={(key) => { if (key.key === "Enter" && text !== null) commit(text); if (key.key === "ArrowDown" && key.alt) { key.preventDefault(); show(); } }}
        {...(props.preferNative && !theme.rtl ? ({ aria: { type: "date" } } as object) : null)}
        trailing={<IconButton icon="calendar" size="xs" compactVisual label={theme.t("openCalendar")} expanded={open} disabled={props.disabled} onPress={show} />} />
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} label={props.label} title={props.label} padded initialFocus='[tabindex="0"][role="gridcell"]'>
        <Calendar label={props.label} month={month} onMonthChange={setMonth} focused={focused} onFocus={setFocused} selected={props.value} min={props.min} max={props.max} disabledDate={props.disabledDate}
          onPick={(day) => { setOpen(false); setBad(false); if (day !== props.value) props.onChange(day); }} />
        <View style={{ flexDirection: "row", marginTop: space[2] }}>
          <Button size="sm" kind="ghost" label={theme.t("today")} disabled={!dateAllowed(todayIso(), props)} onPress={() => { const day = todayIso(); setOpen(false); if (day !== props.value) props.onChange(day); }} />
        </View>
      </Popover>
    </View>
  );
}

export type DateRangeFieldProps = DateLimits & {
  label: string; value: DayRange | null; onChange(value: DayRange | null): void; presets?: readonly RangePreset[]; presetLabels?: Partial<Record<RangePreset, string>>;
  /** Longer ranges are rejected with the invalid state and "Choose at most <n> days". */
  maxSpanDays?: number; allowEmpty?: boolean; size?: "sm" | "md"; disabled?: boolean; width?: number; forceOpen?: boolean; today?: string; forceState?: ForcedState;
};

/** Two linked dates shown as one field "start – end": presets at the inline-start and a two-month calendar in which the first activation sets the start and the second the end. */
export function DateRangeField(props: DateRangeFieldProps) {
  const theme = useTheme();
  const today = props.today ?? todayIso();
  const [open, setOpen] = useState(Boolean(props.forceOpen));
  const [draft, setDraft] = useState<{ start: string | null; end: string | null }>(props.value ?? { start: null, end: null });
  const [month, setMonth] = useState((props.value?.start ?? today).slice(0, 7));
  const [focused, setFocused] = useState(props.value?.start ?? today);
  const [preset, setPreset] = useState<RangePreset>("custom");
  const anchor = useRef<View>(null);
  useEffect(() => { if (open) { setDraft(props.value ?? { start: null, end: null }); setMonth((props.value?.start ?? today).slice(0, 7)); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const complete = draft.start && draft.end ? { start: draft.start, end: draft.end } : null;
  const tooLong = complete ? rangeTooLong(complete, props.maxSpanDays) : false;
  const external = props.value ? rangeTooLong(props.value, props.maxSpanDays) : false;
  const presets = props.presets ?? DEFAULT_PRESETS;
  const pick = (value: RangePreset) => {
    setPreset(value);
    const range = presetRange(value, today);
    if (range) { setDraft(range); setMonth(range.start.slice(0, 7)); }
  };
  const next = addMonths(`${month}-01`, 1).slice(0, 7);
  const calendar = (which: string, header: boolean) => (
    <Calendar label={props.label} month={which} onMonthChange={(value) => setMonth(which === month ? value : addMonths(`${value}-01`, -1).slice(0, 7))} focused={focused} onFocus={setFocused} range={draft} hideHeader={!header}
      min={props.min} max={props.max} disabledDate={props.disabledDate} onPick={(day) => { setPreset("custom"); setDraft((current) => pickRangeDay(current, day)); }} />
  );
  const label = (value: RangePreset) => props.presetLabels?.[value] ?? theme.t(value as StringKey);
  return (
    <View ref={anchor} style={{ width: props.width, minWidth: 0 }}>
      <Tap role="button" label={props.value ? `${props.label}: ${formatRange(props.value, theme.locale)}` : props.label} expanded={open} disabled={props.disabled} forceState={props.forceState} noRing onPress={() => setOpen(true)}
        style={(state) => fieldBox(theme, props.size ?? "md", { hovered: state.hovered, focused: state.focused || open, invalid: external })}>
        <Text numberOfLines={1} tabular color={props.value ? "text/primary" : "text/placeholder"} style={{ flex: 1 }}>{props.value ? formatRange(props.value, theme.locale) : `${theme.t("startDate")} – ${theme.t("endDate")}`}</Text>
        <Icon name="calendar" size={14} color="text/secondary" />
      </Tap>
      {external ? <FieldError message={theme.t("chooseAtMost", { n: props.maxSpanDays! })} /> : null}
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} label={props.label} title={props.label} padded wide style={{ maxWidth: undefined }}>
        <View style={{ flexDirection: theme.compact ? "column" : "row", gap: space[3] }}>
          {theme.compact ? (
            // On compact form factors the presets are a horizontally scrolling chip row and one month is shown.
            <ScrollView horizontal showsHorizontalScrollIndicator={false}><View style={{ flexDirection: "row", gap: space[2] }}>{presets.map((value) => <Chip key={value} size="md" label={label(value)} selected={preset === value} onPress={() => pick(value)} />)}</View></ScrollView>
          ) : (
            <View role="list" style={{ gap: space[0.5], minWidth: size.sliderMin * 3 }}>
              {presets.map((value) => <Button key={value} size="sm" kind={preset === value ? "secondary" : "ghost"} label={label(value)} pressed={preset === value} onPress={() => pick(value)} style={{ justifyContent: "flex-start" }} />)}
            </View>
          )}
          <View style={{ flexDirection: "row", gap: space[4] }}>
            {calendar(month, true)}
            {theme.compact ? null : calendar(next, false)}
          </View>
        </View>
        {tooLong ? <FieldError message={theme.t("chooseAtMost", { n: props.maxSpanDays! })} /> : null}
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: space[2], marginTop: space[3] }}>
          {props.allowEmpty ? <Button size="sm" kind="ghost" label={theme.t("clear")} onPress={() => { setOpen(false); props.onChange(null); }} /> : null}
          <Button size="sm" kind="primary" label={theme.t("apply")} disabled={!complete} onPress={() => { if (!complete || tooLong) return; setOpen(false); props.onChange(complete); }} />
        </View>
      </Popover>
    </View>
  );
}

export type TimeFieldProps = { label: string; value: string; onChange(value: string): void; withSeconds?: boolean; size?: "sm" | "md"; disabled?: boolean; invalid?: boolean; preferNative?: boolean; forceState?: ForcedState };

/**
 * Hours and minutes (and seconds) as separate spin segments, in the 12- or 24-hour form of the "Time format" preference. Each
 * segment changes by typing or Up/Down; Left/Right move between segments. Values are local wall-clock times with no zone.
 */
export function TimeField(props: TimeFieldProps) {
  const theme = useTheme();
  const time = parseTime(props.value) ?? { h: 0, m: 0, s: 0 };
  const parts = timeParts(time, theme.hour12);
  const segments = timeSegments(theme.hour12, Boolean(props.withSeconds));
  const refs = useRef(new Map<TimeSegment, View | null>());
  const buffer = useRef("");
  const [active, setActive] = useState<TimeSegment | null>(null);
  const names: Record<TimeSegment, string> = { h: theme.t("hours"), m: theme.t("minutes"), s: theme.t("seconds"), p: theme.t("dayPeriod") };
  const set = (next: typeof time) => props.onChange(timeValue(next, Boolean(props.withSeconds)));
  const go = (segment: TimeSegment, step: number) => { const target = segments[segments.indexOf(segment) + step]; if (target) focusElement(refs.current.get(target)); };
  return (
    <View role="group" aria-label={props.label} accessibilityLabel={props.label} style={[fieldBox(theme, props.size ?? "md", { focused: active !== null || props.forceState === "focus", hovered: props.forceState === "hover", invalid: props.invalid, disabled: props.disabled }), { alignSelf: "flex-start", gap: space[0.5] }]}>
      {segments.map((segment, index) => {
        const text = segment === "p" ? theme.t(parts.p === "AM" ? "am" : "pm") : parts[segment];
        const numeric = segment === "p" ? undefined : segment === "h" ? time.h : time[segment];
        return (
          <View key={segment} style={{ flexDirection: "row", alignItems: "center" }}>
            {index > 0 && segment !== "p" ? <Text color="text/secondary">:</Text> : null}
            <Tap ref={(node) => { refs.current.set(segment, node); }} label={names[segment]} disabled={props.disabled} noRing testID={`time-${segment}`}
              aria={{ role: "spinbutton", "aria-valuenow": numeric, "aria-valuetext": text, "aria-valuemin": segment === "p" ? undefined : 0, "aria-valuemax": segment === "h" ? 23 : segment === "p" ? undefined : 59 }}
              onFocus={() => { setActive(segment); buffer.current = ""; }} onBlur={() => setActive((current) => (current === segment ? null : current))} onPress={() => focusElement(refs.current.get(segment))}
              onKeyDown={(key) => {
                if (key.key === "ArrowUp" || key.key === "ArrowDown") { key.preventDefault(); set(stepTime(time, segment, key.key === "ArrowUp" ? 1 : -1)); return; }
                if (key.key === "ArrowLeft" || key.key === "ArrowRight") { key.preventDefault(); go(segment, (key.key === "ArrowRight") !== theme.rtl ? 1 : -1); return; }
                if (segment === "p") { if (/^[ap]$/i.test(key.key) && (key.key.toLowerCase() === "a") !== (time.h < 12)) set(stepTime(time, "p", 1)); return; }
                if (/^\d$/.test(key.key)) {
                  key.preventDefault();
                  const result = typeDigit(time, segment, buffer.current, key.key, theme.hour12);
                  buffer.current = result.buffer;
                  set(result.time);
                  if (result.done) go(segment, 1);
                }
              }}
              style={{ minWidth: size.timeSegment, paddingHorizontal: space[0.5], borderRadius: radius.xs, alignItems: "center", backgroundColor: active === segment ? theme.color("accent/subtle") : "transparent", marginStart: segment === "p" ? space[1] : 0 }}>
              <Text tabular color={active === segment ? "accent/text" : "text/primary"}>{text}</Text>
            </Tap>
          </View>
        );
      })}
    </View>
  );
}

export type WeekdayPickerProps = { label: string; value: number[]; onChange(value: number[]): void; multiple?: boolean; withPresets?: boolean; disabled?: boolean; forceState?: ForcedState };

/** Seven toggle buttons in the locale's week order, labelled with the narrow weekday name and carrying the full name as accessible name. */
export function WeekdayPicker(props: WeekdayPickerProps) {
  const theme = useTheme();
  const multiple = props.multiple ?? true;
  const days = weekdays(theme.locale, theme.firstDayOfWeek);
  const same = (list: readonly number[]) => list.length === props.value.length && list.every((day) => props.value.includes(day));
  return (
    <View role="group" aria-label={props.label} accessibilityLabel={props.label} style={{ gap: space[2] }}>
      {props.withPresets && multiple ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
          {(Object.keys(WEEKDAY_PRESETS) as Array<keyof typeof WEEKDAY_PRESETS>).map((preset) => <Chip key={preset} size="md" label={theme.t(preset)} selected={same(WEEKDAY_PRESETS[preset])} disabled={props.disabled} onPress={() => props.onChange([...WEEKDAY_PRESETS[preset]])} />)}
        </View>
      ) : null}
      <View style={{ flexDirection: "row", gap: space[1] }}>
        {days.map((day) => {
          const on = props.value.includes(day.day);
          return (
            <Tap key={day.day} role="button" label={day.full} pressedState={on} disabled={props.disabled} forceState={day.day === days[0]!.day ? props.forceState : undefined} target onPress={() => props.onChange(toggleWeekday(props.value, day.day, multiple))}
              style={(state) => ({ width: size.weekday, height: size.weekday, borderRadius: radius.full, alignItems: "center", justifyContent: "center", borderWidth: borderWidth.hairline,
                borderColor: theme.color(on ? "accent" : "border/control"), backgroundColor: on ? theme.color("accent") : state.hovered ? theme.color("bg/hover") : "transparent" })}>
              <Text variant="meta" color={on ? "text/on-accent" : "text/primary"} style={{ fontWeight: "500" }}>{day.narrow}</Text>
            </Tap>
          );
        })}
      </View>
    </View>
  );
}
