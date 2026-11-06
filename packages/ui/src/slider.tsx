import { useMemo, useRef, useState } from "react";
import { PanResponder, View } from "react-native";
import { dragSession, sliderFill, sliderFraction, sliderKey, sliderValueAt } from "./logic/number.ts";
import { NumberField } from "./number.tsx";
import { Tap, type ForcedState } from "./tap.tsx";
import { useTheme } from "./theme.tsx";
import { borderWidth, control, opacity, radius, size, space } from "./tokens.ts";

export type SliderProps = {
  label: string; min: number; max: number; step?: number; disabled?: boolean;
  /** One value, or `[low, high]` in range mode with two thumbs. */
  value: number | [number, number];
  /** Live preview while dragging, at most once per animation frame. */
  onChange?(value: number | [number, number]): void;
  /** Once per gesture, on release: the consumer records a single undo step. */
  onCommit?(value: number | [number, number]): void;
  /** Drawn as a tick mark; double-click or double-tap resets to it. */
  defaultValue?: number;
  /** Bipolar range: the fill grows from the default tick. */
  centre?: boolean;
  /** Shows a paired NumberField with the same value. */
  field?: boolean; unit?: string; formatValue?(value: number): string; forceState?: ForcedState;
};

/** A 4 px track with a 14 px thumb (20 px at compact-touch density, inside a 44×44 px hit area). */
export function Slider(props: SliderProps) {
  const theme = useTheme();
  const range = Array.isArray(props.value);
  const values = (range ? props.value : [props.value]) as number[];
  const thumb = theme.touch ? size.sliderThumbTouch : size.sliderThumb;
  const track = useRef<View>(null);
  const geometry = useRef({ x: 0, width: 1 });
  const [active, setActive] = useState<number | null>(null);
  const latest = useRef({ props, values });
  latest.current = { props, values };
  const emit = (list: number[]) => (latest.current.props.value instanceof Array ? ([Math.min(list[0]!, list[1]!), Math.max(list[0]!, list[1]!)] as [number, number]) : list[0]!);
  const gesture = useRef<{ index: number; session: ReturnType<typeof dragSession>; current: number[]; tick: number } | null>(null);
  const pan = useMemo(() => {
    const valueAt = (pageX: number) => {
      const { x, width } = geometry.current;
      const fraction = (pageX - x) / width;
      const { min, max, step } = latest.current.props;
      return sliderValueAt(theme.rtl ? 1 - fraction : fraction, { min, max, step });
    };
    const move = (pageX: number) => {
      const state = gesture.current;
      if (!state) return;
      const next = valueAt(pageX);
      if (state.tick > 0 && state.current[state.index] === next) return;
      state.current = state.current.map((value, index) => (index === state.index ? next : value));
      // The session delivers at most one change per frame; it is fed a counter because the values live in `state.current`.
      state.session.update(++state.tick);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => !latest.current.props.disabled,
      onMoveShouldSetPanResponderCapture: (_event, g) => !latest.current.props.disabled && Math.abs(g.dx) > 2,
      onPanResponderGrant: (event) => {
        const pageX = event.nativeEvent.pageX;
        track.current?.measureInWindow((x, _y, width) => {
          geometry.current = { x, width: width || 1 };
          const target = valueAt(pageX);
          const current = [...latest.current.values];
          const index = current.length === 1 ? 0 : Math.abs(current[0]! - target) <= Math.abs(current[1]! - target) ? 0 : 1;
          const notify = { onChange: () => latest.current.props.onChange?.(emit(state.current)), onCommit: () => latest.current.props.onCommit?.(emit(state.current)) };
          const state: { index: number; current: number[]; session: ReturnType<typeof dragSession>; tick: number } = { index, current, tick: 0, session: dragSession(notify, (fn) => requestAnimationFrame(fn)) };
          gesture.current = state;
          setActive(index);
          move(pageX);
        });
      },
      onPanResponderMove: (_event, g) => move(g.moveX),
      onPanResponderRelease: () => { gesture.current?.session.end(); gesture.current = null; setActive(null); },
      onPanResponderTerminate: () => { gesture.current?.session.end(); gesture.current = null; setActive(null); },
    });
  }, [theme.rtl]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = (index: number, value: number) => {
    const next = values.map((item, at) => (at === index ? value : item));
    props.onChange?.(emit(next));
    props.onCommit?.(emit(next));
  };
  const fill = range
    ? { from: sliderFraction(Math.min(...values), props.min, props.max), to: sliderFraction(Math.max(...values), props.min, props.max) }
    : sliderFill(values[0]!, { min: props.min, max: props.max, origin: props.centre ? props.defaultValue ?? (props.min + props.max) / 2 : undefined });
  const tick = props.defaultValue === undefined ? null : sliderFraction(props.defaultValue, props.min, props.max);
  const hit = theme.touch ? control.touch : thumb;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexGrow: 1, flexShrink: 1, opacity: props.disabled ? opacity.disabled : 1 }}>
      <View {...pan.panHandlers} style={{ flexGrow: 1, flexShrink: 1, minWidth: size.sliderMin, height: hit, justifyContent: "center", marginHorizontal: thumb / 2 }}>
        <View ref={track} style={{ height: size.sliderTrack, borderRadius: radius.full, backgroundColor: theme.color("border/control") }}>
          <View style={{ position: "absolute", top: 0, bottom: 0, start: `${fill.from * 100}%`, width: `${(fill.to - fill.from) * 100}%`, borderRadius: radius.full, backgroundColor: theme.color("accent") }} />
        </View>
        {tick === null ? null : <View pointerEvents="none" style={{ position: "absolute", start: `${tick * 100}%`, width: borderWidth.hairline, height: size.sliderTick, backgroundColor: theme.color("text/secondary") }} />}
        {values.map((value, index) => (
          <View key={index} pointerEvents="box-none" style={{ position: "absolute", start: `${sliderFraction(value, props.min, props.max) * 100}%`, marginStart: -hit / 2, width: hit, height: hit, alignItems: "center", justifyContent: "center" }}>
            <Tap role="adjustable" label={range ? `${props.label} ${index + 1}` : props.label} disabled={props.disabled} forceState={props.forceState} noRing
              aria={{ role: "slider", "aria-valuemin": props.min, "aria-valuemax": props.max, "aria-valuenow": value, "aria-valuetext": props.formatValue?.(value), "aria-orientation": "horizontal" }}
              onDoublePress={props.defaultValue === undefined ? undefined : () => commit(index, props.defaultValue!)} onPress={() => {}}
              onKeyDown={(key) => {
                const logical = theme.rtl ? ({ ArrowLeft: "ArrowRight", ArrowRight: "ArrowLeft" } as Record<string, string>)[key.key] ?? key.key : key.key;
                const next = sliderKey(value, logical, key.shift, props);
                if (next === null) return;
                key.preventDefault();
                commit(index, next);
              }}
              style={(state) => ({ width: thumb, height: thumb, borderRadius: radius.full, backgroundColor: theme.color("control/thumb"),
                borderWidth: state.focused || state.pressed || active === index ? borderWidth.focus : borderWidth.check, borderColor: theme.color(state.focused || state.pressed || active === index ? "accent" : state.hovered ? "text/primary" : "border/control") })} />
          </View>
        ))}
      </View>
      {props.field && !range ? <NumberField label={props.label} value={values[0]!} min={props.min} max={props.max} step={props.step} unit={props.unit} defaultValue={props.defaultValue} width={size.sliderMin + space[6]} hideLabel onCommit={(value) => commit(0, value)} /> : null}
    </View>
  );
}
