import { useEffect, useRef } from "react";
import { Animated, AppState, Image, View } from "react-native";
import { Icon, type IconName } from "./Icon.tsx";
import { TONES, avatarFill, badgeCount, initials, toneOfStatus, type Tone } from "./logic/status.ts";
import { Text } from "./text.tsx";
import { useTheme } from "./theme.tsx";
import { ICON_STROKE, avatarSizes, motion, radius, size, space, type ColorToken } from "./tokens.ts";
import { hasDom } from "./platform/dom";
import { cssLoop } from "./progress.tsx";
import { shouldAnimate } from "./logic/foreground.ts";

export type { Tone };

/**
 * A circle for people and agents, a rounded square for hosts and projects. Shows an image, a persona glyph or up to two
 * initials on a fill chosen from `avatar/bg/1…8` by hashing the entity id, so it is the same on every device and theme.
 */
export function Avatar(props: { name: string; id?: string; size?: 16 | 20 | 24 | 32 | 40; square?: boolean; image?: string; glyph?: IconName; /** The host mark of the sidebar header: one initial on the accent fill. */ host?: boolean; /** Inside a control that already says the name: the avatar is not announced again. */ decorative?: boolean }) {
  const theme = useTheme();
  const box = props.size ?? 20;
  const round = props.square ? size.avatarSquare : radius.full;
  if (props.image) return <Image source={{ uri: props.image }} accessibilityLabel={props.name} style={{ width: box, height: box, borderRadius: round, flexShrink: 0 }} />;
  return (
    <View {...(props.decorative ? { "aria-hidden": true, importantForAccessibility: "no-hide-descendants" as const } : { accessible: true, accessibilityRole: "image" as const, role: "img" as const, accessibilityLabel: props.name })}
      style={{ width: box, height: box, borderRadius: round, backgroundColor: theme.color(props.host ? "accent" : avatarFill(props.id ?? props.name)), alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      {props.glyph
        ? <Icon name={props.glyph} size={box <= 20 ? 12 : box <= 24 ? 14 : 16} color="avatar/text" />
        : <Text color={props.host ? "text/on-accent" : "avatar/text"} style={{ fontSize: avatarSizes[box], lineHeight: avatarSizes[box], fontWeight: "600" }}>{initials(props.name, box <= 16 || props.host ? 1 : 2)}</Text>}
    </View>
  );
}

type BadgeTone = "neutral" | "attention" | "accent" | "warning" | "danger" | "purple";
const BADGE: Record<BadgeTone, [ColorToken, ColorToken]> = {
  neutral: ["bg/subtle", "text/primary"], attention: ["accent", "text/on-accent"], accent: ["accent", "text/on-accent"],
  warning: ["warning/subtle", "warning/text"], danger: ["danger/subtle", "danger/text"], purple: ["purple/subtle", "purple/text"],
};
/**
 * A 16 px pill. `count` draws a count ("99+" above 99; neutral or attention); `kind` draws one of the two labels this
 * capability defines, "New" and "Built-in". `label` draws a caller's short text.
 */
export function Badge(props: { label?: string; count?: number; kind?: "new" | "built-in"; tone?: BadgeTone; accessibilityLabel?: string }) {
  const theme = useTheme();
  const [bg, fg]: [ColorToken, ColorToken] = props.kind === "new" ? ["success/subtle", "success/text"] : props.kind === "built-in" ? ["bg/subtle", "text/secondary"]
    : props.count === undefined && !props.tone ? ["bg/subtle", "text/secondary"] : BADGE[props.tone ?? "neutral"];
  const text = props.kind === "new" ? theme.t("badgeNew") : props.kind === "built-in" ? theme.t("badgeBuiltIn") : props.count !== undefined ? badgeCount(props.count) : props.label ?? "";
  const name = props.accessibilityLabel ?? (props.count !== undefined && (props.tone === "attention" || props.tone === "accent") ? theme.t("unreadCount", { n: props.count }) : text);
  return (
    <View accessible accessibilityLabel={name} aria-label={name} role="status"
      style={{ height: size.badge, minWidth: size.badge, paddingHorizontal: size.badgePadding, borderRadius: radius.full, backgroundColor: theme.color(bg), alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <Text variant="caption" color={fg} numberOfLines={1} tabular>{text}</Text>
    </View>
  );
}

const PULSE = cssLoop({ "0%": { opacity: 1 }, "50%": { opacity: 0.35 }, "100%": { opacity: 1 } }, motion.pulse, "ease-in-out");
function usePulse(active: boolean) {
  const theme = useTheme();
  const value = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!active || theme.reduceMotion) { value.setValue(1); return; }
    let loop: Animated.CompositeAnimation | undefined;
    const start = (state = AppState.currentState) => {
      loop?.stop();
      loop = undefined;
      if (!shouldAnimate(active, theme.reduceMotion, state)) { value.setValue(1); return; }
      const half = motion.pulse / 2;
      loop = Animated.loop(Animated.sequence([
        Animated.timing(value, { toValue: 0.35, duration: half, useNativeDriver: true }), Animated.timing(value, { toValue: 1, duration: half, useNativeDriver: true }),
      ]));
      loop.start();
    };
    start();
    const subscription = AppState.addEventListener("change", start);
    return () => { subscription.remove(); loop?.stop(); };
  }, [active, value, theme.reduceMotion]);
  return value;
}

const DOT: Record<string, ColorToken> = { accent: "accent", success: "success", warning: "warning", danger: "danger", purple: "purple", off: "text/tertiary" };
/** The 6 px dot badge: `accent` for unread. Other tones sit next to a text label that carries the meaning. */
export function Dot(props: { tone?: "accent" | "success" | "warning" | "danger" | "purple" | "off"; pulse?: boolean; label?: string }) {
  const theme = useTheme();
  const opacity = usePulse(Boolean(props.pulse) && !hasDom);
  // In a browser the pulse is a CSS animation (`cssLoop` in progress.tsx): nothing renders while it runs.
  if (hasDom) return <View accessible={Boolean(props.label)} accessibilityLabel={props.label} style={[{ width: size.dot, height: size.dot, borderRadius: radius.full, backgroundColor: theme.color(DOT[props.tone ?? "accent"]!), flexShrink: 0 }, props.pulse && !theme.reduceMotion ? PULSE : null]} />;
  return <Animated.View accessible={Boolean(props.label)} accessibilityLabel={props.label} style={{ width: size.dot, height: size.dot, borderRadius: radius.full, backgroundColor: theme.color(DOT[props.tone ?? "accent"]!), flexShrink: 0, opacity }} />;
}

const SHAPE_ICON = { triangle: "triangle", check: "check", cross: "x", "double-check": "check-check" } as const satisfies Record<string, IconName>;
/**
 * A 20 px pill with a leading dot or icon and a label, in six tones. The tone comes from `tone`, or from `status` through
 * the closed status → tone mapping. The six tones use different shapes, so status never rests on colour.
 */
export function StatusPill(props: { label: string; tone?: Tone; status?: string; active?: boolean; reason?: string }) {
  const theme = useTheme();
  const tone = props.tone ?? (props.status ? toneOfStatus(props.status) : null) ?? "neutral";
  const style = TONES[tone];
  const pulsing = tone === "info" && (props.active ?? true), pulse = usePulse(pulsing && !hasDom);
  const pill = (
    <View accessible accessibilityLabel={props.label} role="status"
      style={{ height: size.pill, paddingHorizontal: space[2], borderRadius: radius.full, backgroundColor: theme.color(style.fill), flexDirection: "row", alignItems: "center", gap: space[1.5], flexShrink: 0 }}>
      {style.shape === "dot" ? hasDom ? <View style={[{ width: size.dot, height: size.dot, borderRadius: radius.full, backgroundColor: theme.color(style.icon) }, pulsing && !theme.reduceMotion ? PULSE : null]} /> : <Animated.View style={{ width: size.dot, height: size.dot, borderRadius: radius.full, backgroundColor: theme.color(style.icon), opacity: pulse }} />
        : style.shape === "hollow-dot" ? <View style={{ width: size.dot, height: size.dot, borderRadius: radius.full, borderWidth: ICON_STROKE, borderColor: theme.color(style.icon) }} />
        : <Icon name={SHAPE_ICON[style.shape]} size={12} color={style.icon} />}
      <Text variant="meta" color={style.text} numberOfLines={1}>{props.label}</Text>
    </View>
  );
  // A reason a status carries is secondary text beside the pill; it never changes the tone.
  if (!props.reason) return pill;
  return <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexShrink: 1 }}>{pill}<Text variant="meta" color="text/secondary" numberOfLines={1}>{props.reason}</Text></View>;
}
