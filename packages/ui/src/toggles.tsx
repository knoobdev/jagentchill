import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, View } from "react-native";
import { Icon } from "./Icon.tsx";
import { Tap, type ForcedState } from "./tap.tsx";
import { Text } from "./text.tsx";
import { useTheme } from "./theme.tsx";
import { useToast } from "./toast.tsx";
import { borderWidth, motion, radius, size, space } from "./tokens.ts";

type Common = { label?: string; accessibilityLabel?: string; disabled?: boolean; invalid?: boolean; forceState?: ForcedState; children?: ReactNode };
const Labelled = (props: { label?: string; children?: ReactNode; control: ReactNode }) => (
  <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], minHeight: size.toggleHit }}>
    {props.control}
    {props.label ? <Text>{props.label}</Text> : props.children}
  </View>
);

export type SwitchProps = Common & {
  value: boolean;
  /** Applied immediately. When it returns a promise that rejects, the switch returns to its prior state and an error toast states the reason. */
  onChange(value: boolean): void | Promise<unknown>;
  errorMessage?(error: unknown): string;
  /** Drawn inside another control that owns the interaction, e.g. a menu row. */
  decorative?: boolean;
};

/** 32×18 px (44×26 at compact-touch density). The thumb position carries the state independently of colour. */
export function Switch(props: SwitchProps) {
  const theme = useTheme();
  const toast = useToast();
  const [pending, setPending] = useState<boolean | null>(null);
  const value = pending ?? props.value;
  const width = theme.touch ? size.switchWidthTouch : size.switchWidth, height = theme.touch ? size.switchHeightTouch : size.switchHeight, thumb = theme.touch ? size.switchThumbTouch : size.switchThumb;
  const travel = width - thumb - 2 * size.switchInset;
  const slide = useRef(new Animated.Value(value ? 1 : 0)).current;
  // The thumb moves when the value CHANGES. A switch that appears is already where its value puts it: animating it "to"
  // the same place drew it again on every frame of 120 ms, for every switch of a panel that was opened.
  const shown = useRef(value);
  useEffect(() => { if (shown.current === value) return; shown.current = value; Animated.timing(slide, { toValue: value ? 1 : 0, duration: theme.reduceMotion ? 0 : motion.fast, useNativeDriver: false }).start(); }, [value, slide, theme.reduceMotion]);
  // Once the caller's value catches up, the optimistic state is dropped.
  useEffect(() => { if (pending !== null && pending === props.value) setPending(null); }, [pending, props.value]);
  const toggle = () => {
    const next = !value;
    const result = props.onChange(next);
    if (!result || typeof (result as Promise<unknown>).then !== "function") return;
    setPending(next);
    (result as Promise<unknown>).then(() => setPending(null), (error: unknown) => {
      setPending(null);
      toast.show({ kind: "error", message: props.errorMessage?.(error) ?? (error instanceof Error ? error.message : String(error)) });
    });
  };
  const track = (
    <View style={{ width, height, borderRadius: radius.full, backgroundColor: theme.color(value ? "accent" : "border/control"), justifyContent: "center", padding: size.switchInset,
      borderWidth: props.invalid ? borderWidth.focus : 0, borderColor: theme.color("danger") }}>
      {value && theme.increaseContrast ? <View style={{ position: "absolute", start: space[1] }}><Icon name="check" size={12} color="text/on-accent" /></View> : null}
      <Animated.View style={{ width: thumb, height: thumb, borderRadius: radius.full, backgroundColor: theme.color("control/thumb"), transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [0, theme.rtl ? -travel : travel] }) }] }} />
    </View>
  );
  if (props.decorative) return <View aria-hidden>{track}</View>;
  return (
    <Tap role="switch" label={props.accessibilityLabel ?? props.label} checked={value} aria={{ "aria-checked": value, "aria-invalid": props.invalid || undefined }} disabled={props.disabled} forceState={props.forceState} onPress={toggle}
      target={!props.label && !props.children} style={{ borderRadius: radius.full, flexShrink: 0 }}>
      <Labelled label={props.label} control={track}>{props.children}</Labelled>
    </Tap>
  );
}

export type CheckboxProps = Common & { checked: boolean; indeterminate?: boolean; onChange(checked: boolean): void };
/** 16×16 px (20×20 at compact-touch density), radius 4. Checked and indeterminate fill `accent` with a glyph in `text/on-accent`. */
export function Checkbox(props: CheckboxProps) {
  const theme = useTheme();
  const box = theme.touch ? size.checkboxTouch : size.checkbox;
  const filled = props.checked || props.indeterminate;
  const control = (hovered: boolean) => (
    <View style={{ width: box, height: box, borderRadius: radius.xs, alignItems: "center", justifyContent: "center", backgroundColor: theme.color(filled ? "accent" : "bg/app"),
      borderWidth: borderWidth.check, borderColor: theme.color(props.invalid ? "danger" : filled ? "accent" : hovered ? "text/primary" : "border/control") }}>
      {props.indeterminate ? <View style={{ width: box / 2, height: borderWidth.check, backgroundColor: theme.color("text/on-accent") }} /> : props.checked ? <Icon name="check" size={12} color="text/on-accent" /> : null}
    </View>
  );
  return (
    <Tap role="checkbox" label={props.accessibilityLabel ?? props.label} checked={props.indeterminate ? "mixed" : props.checked} disabled={props.disabled} forceState={props.forceState}
      aria={{ "aria-checked": props.indeterminate ? "mixed" : props.checked, "aria-invalid": props.invalid || undefined }}
      // Activating an indeterminate box selects everything.
      onPress={() => props.onChange(props.indeterminate ? true : !props.checked)} target={!props.label && !props.children} style={{ borderRadius: radius.xs, flexShrink: 0 }}>
      {(state) => <Labelled label={props.label} control={control(state.hovered)}>{props.children}</Labelled>}
    </Tap>
  );
}

export type RadioProps = Common & { selected: boolean; onSelect(): void; tabIndex?: 0 | -1; onKeyDown?: Parameters<typeof Tap>[0]["onKeyDown"] };
/** A 16 px (20 px) circle with a 1.5 px ring, which becomes an `accent` ring with a 6 px (8 px) dot when selected. */
export function Radio(props: RadioProps) {
  const theme = useTheme();
  const box = theme.touch ? size.checkboxTouch : size.checkbox, dot = theme.touch ? size.radioDotTouch : size.radioDot;
  const control = (hovered: boolean) => (
    <View style={{ width: box, height: box, borderRadius: radius.full, alignItems: "center", justifyContent: "center", backgroundColor: theme.color("bg/app"),
      borderWidth: borderWidth.check, borderColor: theme.color(props.invalid ? "danger" : props.selected ? "accent" : hovered ? "text/primary" : "border/control") }}>
      {props.selected ? <View style={{ width: dot, height: dot, borderRadius: radius.full, backgroundColor: theme.color("accent") }} /> : null}
    </View>
  );
  return (
    <Tap role="radio" label={props.accessibilityLabel ?? props.label} checked={props.selected} disabled={props.disabled} forceState={props.forceState} tabIndex={props.tabIndex} onKeyDown={props.onKeyDown}
      aria={{ "aria-checked": props.selected, "aria-invalid": props.invalid || undefined }} onPress={props.onSelect} target={!props.label && !props.children} style={{ borderRadius: radius.full, flexShrink: 0 }}>
      {(state) => <Labelled label={props.label} control={control(state.hovered)}>{props.children}</Labelled>}
    </Tap>
  );
}

/** Radios of one choice: arrow keys move the selection, as the radio group pattern requires. */
export function RadioGroup<T extends string>(props: { label: string; options: Array<{ value: T; label: string; disabled?: boolean }>; value: T | null; onChange(value: T): void; invalid?: boolean; horizontal?: boolean }) {
  const move = (index: number, step: number) => {
    for (let i = 1; i <= props.options.length; i++) {
      const next = props.options[(index + step * i + props.options.length * i) % props.options.length]!;
      if (!next.disabled) { props.onChange(next.value); return; }
    }
  };
  return (
    <View accessibilityRole="radiogroup" role="radiogroup" aria-label={props.label} accessibilityLabel={props.label} style={{ flexDirection: props.horizontal ? "row" : "column", gap: props.horizontal ? space[4] : space[1] }}>
      {props.options.map((option, index) => (
        <Radio key={option.value} label={option.label} selected={option.value === props.value} disabled={option.disabled} invalid={props.invalid} onSelect={() => props.onChange(option.value)}
          tabIndex={option.value === props.value || (props.value === null && index === 0) ? 0 : -1}
          onKeyDown={(key) => {
            if (key.key === "ArrowDown" || key.key === "ArrowRight") { key.preventDefault(); move(index, 1); }
            if (key.key === "ArrowUp" || key.key === "ArrowLeft") { key.preventDefault(); move(index, -1); }
          }} />
      ))}
    </View>
  );
}
