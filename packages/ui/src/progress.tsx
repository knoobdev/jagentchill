import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, AppState, Easing, View, type DimensionValue, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { Icon } from "./Icon.tsx";
import { LOADING } from "./logic/timers.ts";
import { hasDom } from "./platform/dom";
import { Text } from "./text.tsx";
import { useTheme } from "./theme.tsx";
import { ICON_STROKE, motion, radius, size, space, type ColorToken } from "./tokens.ts";
import { shouldAnimate } from "./logic/foreground.ts";

/**
 * An endless animation as the browser runs it by itself (a CSS animation): a looping `Animated` value is driven from
 * JavaScript there and renders its component on every frame — sixty React commits a second for as long as a spinner
 * is on screen, under everything else the person does. Native keeps the `Animated` loop below.
 */
/** One CSS declaration block per keyframe step; a React Native transform list becomes a CSS transform. */
const cssStep = (step: Record<string, unknown>): string => Object.entries(step).map(([key, value]) => {
  if (key === "transform" && Array.isArray(value)) return `transform:${value.map((part) => Object.entries(part as Record<string, unknown>).map(([fn, arg]) => `${fn}(${arg})`).join(" ")).join(" ")}`;
  const name = key === "marginStart" ? "margin-inline-start" : key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  return `${name}:${value}`;
}).join(";");
const cssLoopNames = new Map<string, string>();
/** Registers the keyframes in the document once and returns their name: the style system's own keyframes prop left the animation unnamed in the packaged app, so every spinner stood still. */
function cssKeyframes(keyframes: Record<string, object>): string | undefined {
  if (!hasDom || typeof document === "undefined") return undefined;
  const body = Object.entries(keyframes).map(([at, step]) => `${at}{${cssStep(step as Record<string, unknown>)}}`).join("");
  let name = cssLoopNames.get(body);
  if (!name) {
    name = `jc-loop-${cssLoopNames.size + 1}`;
    const sheet = document.createElement("style");
    sheet.setAttribute("data-jc-loop", name);
    sheet.textContent = `@keyframes ${name}{${body}}`;
    document.head.appendChild(sheet);
    cssLoopNames.set(body, name);
  }
  return name;
}
export const cssLoop = (keyframes: Record<string, object>, duration: number, easing = "linear"): object => {
  const name = cssKeyframes(keyframes);
  return name
    ? { animationName: name, animationDuration: `${duration}ms`, animationIterationCount: "infinite", animationTimingFunction: easing }
    : { animationKeyframes: [keyframes], animationDuration: `${duration}ms`, animationIterationCount: "infinite", animationTimingFunction: easing };
};

/** A looping 0→1 value; it stays at 0 under reduced motion. */
function useLoop(duration: number, active = true) {
  const theme = useTheme();
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (theme.reduceMotion || !active) { value.setValue(0); return; }
    let loop: Animated.CompositeAnimation | undefined;
    const start = (state = AppState.currentState) => {
      loop?.stop();
      loop = undefined;
      if (!shouldAnimate(active, theme.reduceMotion, state)) { value.setValue(0); return; }
      loop = Animated.loop(Animated.timing(value, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true }));
      loop.start();
    };
    start();
    const subscription = AppState.addEventListener("change", start);
    return () => { subscription.remove(); loop?.stop(); };
  }, [value, duration, active, theme.reduceMotion]);
  return value;
}

const SPINNER = { 12: size.spinnerSm, 14: size.spinner, 16: size.spinnerMd, 24: size.spinnerLg } as const;
/** A circular spinner: 12, 14, 16 or 24 px, one turn in 0.8 s. */
export function Spinner(props: { size?: 12 | 14 | 16 | 24; color?: ColorToken; label?: string }) {
  const theme = useTheme();
  const turn = useLoop(motion.spin, !hasDom);
  const box = SPINNER[props.size ?? 14];
  const color = theme.color(props.color ?? "text/secondary");
  const ring: ViewStyle = { position: "absolute", width: box, height: box, borderRadius: radius.full, borderWidth: ICON_STROKE };
  return (
    <View accessibilityRole="progressbar" role="progressbar" accessibilityLabel={props.label ?? theme.t("loading")} aria-busy style={{ width: box, height: box, flexShrink: 0 }}>
      <View style={[ring, { borderColor: color, opacity: 0.25 }]} />
      {hasDom
        ? <View style={[ring, { borderColor: "transparent", borderTopColor: color }, theme.reduceMotion ? null : cssLoop({ "0%": { transform: [{ rotate: "0deg" }] }, "100%": { transform: [{ rotate: "360deg" }] } }, motion.spin)]} />
        : <Animated.View style={[ring, { borderColor: "transparent", borderTopColor: color, transform: [{ rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }] }]} />}
    </View>
  );
}

/**
 * A linear bar: 4 px, or 2 px `thin` for cards and chips. Determinate with a value 0–100, or indeterminate with a 1.2 s
 * loop. `tone` and `track` let a toast or a status draw it on another fill.
 */
export function ProgressBar(props: { value?: number | null; thin?: boolean; label?: string; tone?: ColorToken; track?: ColorToken; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  const determinate = typeof props.value === "number";
  const slide = useLoop(motion.indeterminate, !determinate && !hasDom);
  const value = determinate ? Math.max(0, Math.min(100, props.value!)) : undefined;
  const fill = theme.color(props.tone ?? "accent");
  return (
    <View accessibilityRole="progressbar" role="progressbar" accessibilityLabel={props.label ?? theme.t("progress")} accessibilityValue={determinate ? { min: 0, max: 100, now: value, text: theme.t("percent", { n: Math.round(value!) }) } : undefined}
      aria-valuemin={determinate ? 0 : undefined} aria-valuemax={determinate ? 100 : undefined} aria-valuenow={value} aria-valuetext={determinate ? theme.t("percent", { n: Math.round(value!) }) : undefined}
      style={[{ height: props.thin ? size.progressThin : size.progress, borderRadius: radius.full, backgroundColor: theme.color(props.track ?? "bg/subtle"), overflow: "hidden", flexGrow: 1, flexShrink: 1, minWidth: size.sliderMin }, props.style]}>
      {determinate
        ? <View style={{ height: "100%", width: `${value!}%`, backgroundColor: fill, borderRadius: radius.full }} />
        : hasDom ? <View style={[{ height: "100%", width: "40%", backgroundColor: fill, borderRadius: radius.full, marginStart: "30%" }, theme.reduceMotion ? null : cssLoop({ "0%": { marginStart: "-40%" }, "100%": { marginStart: "100%" } }, motion.indeterminate)]} />
        : <Animated.View style={{ position: "absolute", start: 0, height: "100%", width: "40%", backgroundColor: fill, borderRadius: radius.full, transform: [{ translateX: theme.reduceMotion ? 0 : (slide.interpolate({ inputRange: [0, 1], outputRange: ["-100%", "250%"] }) as unknown as number) }] }} />}
    </View>
  );
}

/** A 16 px ring showing a percentage, or a state glyph when done or failed. */
export function StatusRing(props: { value?: number; state?: "progress" | "done" | "failed"; label: string }) {
  const theme = useTheme();
  if (props.state === "done") return <Icon name="check-c" size={16} color="success" label={props.label} />;
  if (props.state === "failed") return <Icon name="x-c" size={16} color="danger" label={props.label} />;
  const r = 6, length = 2 * Math.PI * r, value = Math.max(0, Math.min(100, props.value ?? 0));
  return (
    <View accessibilityRole="progressbar" role="progressbar" accessibilityLabel={props.label} accessibilityValue={{ min: 0, max: 100, now: value }} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <Svg width={size.statusRing} height={size.statusRing} viewBox="0 0 16 16">
        <Circle cx={8} cy={8} r={r} fill="none" stroke={theme.color("bg/subtle")} strokeWidth={2} />
        <Circle cx={8} cy={8} r={r} fill="none" stroke={theme.color("accent")} strokeWidth={2} strokeDasharray={`${(value / 100) * length} ${length}`} transform="rotate(-90 8 8)" />
      </Svg>
    </View>
  );
}

/** "n of m" with a thin bar, or named stages with the current one filled and the completed ones checked. */
export function Stepper(props: { title?: string; current: number; total?: number; stages?: string[] }) {
  const theme = useTheme();
  if (props.stages) {
    return (
      <View accessibilityRole="list" role="list" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] }}>
        {props.stages.map((stage, index) => {
          const done = index < props.current, now = index === props.current;
          return (
            <View key={stage} role="listitem" aria-current={now ? "step" : undefined} style={{ flexDirection: "row", alignItems: "center", gap: space[1.5] }}>
              <View style={{ width: size.statusRing, height: size.statusRing, borderRadius: radius.full, alignItems: "center", justifyContent: "center", backgroundColor: theme.color(done || now ? "accent" : "bg/subtle") }}>
                {done ? <Icon name="check" size={12} color="text/on-accent" /> : <Text variant="caption" color={now ? "text/on-accent" : "text/secondary"}>{index + 1}</Text>}
              </View>
              <Text variant={now ? "body-medium" : "body"} color={now || done ? "text/primary" : "text/secondary"}>{stage}</Text>
            </View>
          );
        })}
      </View>
    );
  }
  const total = props.total ?? 1;
  return (
    <View style={{ gap: space[1] }}>
      <View style={{ flexDirection: "row", gap: space[2] }}>
        {props.title ? <Text variant="meta" style={{ fontWeight: "500" }}>{props.title}</Text> : null}
        <Text variant="meta" color="text/secondary">{theme.t("nOfM", { n: props.current, m: total })}</Text>
      </View>
      <ProgressBar thin value={(props.current / total) * 100} label={props.title} />
    </View>
  );
}

/** A `bg/subtle` block shaped like the content it replaces, with a 1.4 s shimmer that is static under reduced motion. */
export function Skeleton(props: { width?: DimensionValue; /** `null` leaves the height to the caller's style (an aspect ratio, or opposite edges). */ height?: number | null; round?: boolean; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  const shimmer = useLoop(motion.shimmer);
  return (
    <View aria-hidden style={[{ width: props.width ?? "100%", ...(props.height === null ? {} : { height: props.height ?? space[3] }), borderRadius: props.round ? radius.full : radius.xs, backgroundColor: theme.color("bg/subtle"), overflow: "hidden" }, props.style]}>
      {theme.reduceMotion ? null : <Animated.View style={{ position: "absolute", top: 0, bottom: 0, width: "50%", backgroundColor: theme.color("bg/hover"), start: 0, transform: [{ translateX: shimmer.interpolate({ inputRange: [0, 1], outputRange: ["-100%", "200%"] }) as unknown as number }] }} />}
    </View>
  );
}

/** True once `active` has lasted `ms`: skeletons wait 150 ms and progress indicators 1 s, so fast work shows neither. */
export function useElapsed(active: boolean, ms: number): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!active) { setElapsed(false); return; }
    const handle = setTimeout(() => setElapsed(true), ms);
    return () => clearTimeout(handle);
  }, [active, ms]);
  return active && elapsed;
}

/** Shows the skeleton only when loading has lasted 150 ms, then the content in the same box, so nothing shifts. */
export function SkeletonGate(props: { loading: boolean; skeleton: ReactNode; children: ReactNode }) {
  const show = useElapsed(props.loading, LOADING.skeleton);
  return <>{props.loading ? (show ? props.skeleton : null) : props.children}</>;
}

/**
 * Feedback of a running operation: nothing for the first second, then an indicator; after 10 s a determinate bar or a step
 * label, with a cancel control where cancellation is possible.
 */
export function OperationProgress(props: { active: boolean; value?: number | null; step?: string; label: string; onCancel?(): void; cancel?: ReactNode }) {
  const theme = useTheme();
  const indicator = useElapsed(props.active, LOADING.indicator);
  const long = useElapsed(props.active, LOADING.determinate);
  if (!indicator) return null;
  const determinate = typeof props.value === "number";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
      {long || determinate ? <ProgressBar value={props.value ?? null} label={props.label} /> : <Spinner label={props.label} />}
      {determinate ? <Text variant="meta" color="text/secondary" tabular>{theme.t("percent", { n: Math.round(props.value!) })}</Text> : long && props.step ? <Text variant="meta" color="text/secondary">{props.step}</Text> : null}
      {long ? props.cancel : null}
    </View>
  );
}
