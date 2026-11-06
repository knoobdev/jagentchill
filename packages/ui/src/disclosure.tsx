import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Animated, View } from "react-native";
import { Icon } from "./Icon.tsx";
import { Tap } from "./tap.tsx";
import { Text } from "./text.tsx";
import { useTheme } from "./theme.tsx";
import { borderWidth, densityDefaults, motion, radius, space } from "./tokens.ts";

export type DisclosureProps = {
  title: string; open: boolean; onToggle(open: boolean): void;
  /** A count or summary at the inline-end. */
  summary?: ReactNode; children: ReactNode; disabled?: boolean;
};

/**
 * A header button with a 14 px chevron — pointing to the inline-end when closed, down when open — and a content region that
 * is mounted when first opened. The region's height animates in 160 ms, and not at all under reduced motion.
 */
export function Disclosure(props: DisclosureProps) {
  const theme = useTheme();
  const id = useId();
  const [mounted, setMounted] = useState(props.open);
  const [height, setHeight] = useState<number | null>(null);
  const progress = useRef(new Animated.Value(props.open ? 1 : 0)).current;
  useEffect(() => {
    if (props.open) setMounted(true);
    Animated.timing(progress, { toValue: props.open ? 1 : 0, duration: theme.reduceMotion ? 0 : motion.base, useNativeDriver: false }).start();
  }, [props.open, progress, theme.reduceMotion]);
  return (
    <View>
      <Tap role="button" label={props.title} expanded={props.open} aria={{ "aria-expanded": props.open, "aria-controls": id }} disabled={props.disabled} onPress={() => props.onToggle(!props.open)}
        style={(state) => ({ minHeight: densityDefaults[theme.density].row, flexDirection: "row", alignItems: "center", gap: space[1.5], paddingHorizontal: space[2], borderRadius: radius.sm, backgroundColor: state.hovered ? theme.color("bg/hover") : "transparent" })}>
        <Icon name={props.open ? "chev-d" : theme.rtl ? "chev-l" : "chev-r"} size={14} color="text/secondary" />
        <Text variant="body-medium" numberOfLines={1} style={{ flex: 1 }}>{props.title}</Text>
        {typeof props.summary === "string" || typeof props.summary === "number" ? <Text variant="meta" color="text/secondary">{props.summary}</Text> : props.summary}
      </Tap>
      {mounted ? (
        <Animated.View nativeID={id} role={"region" as "none"} aria-label={props.title} aria-hidden={!props.open} pointerEvents={props.open ? "auto" : "none"}
          style={{ overflow: "hidden", opacity: progress, height: height === null ? (props.open ? undefined : 0) : progress.interpolate({ inputRange: [0, 1], outputRange: [0, height] }) }}>
          <View onLayout={(event) => setHeight(event.nativeEvent.layout.height)} style={{ position: height === null ? "relative" : "absolute", start: 0, end: 0, top: 0 }}>{props.children}</View>
        </Animated.View>
      ) : null}
    </View>
  );
}

/** Disclosures separated by hairlines. In `single` mode opening one closes the others. Open state belongs to the caller. */
export function Accordion(props: { sections: Array<{ id: string; title: string; summary?: ReactNode; content: ReactNode }>; open: readonly string[]; onChange(open: string[]): void; single?: boolean }) {
  const theme = useTheme();
  return (
    <View>
      {props.sections.map((section, index) => (
        <View key={section.id} style={{ borderTopWidth: index === 0 ? 0 : borderWidth.hairline, borderTopColor: theme.color("border/hairline") }}>
          <Disclosure title={section.title} summary={section.summary} open={props.open.includes(section.id)}
            onToggle={(open) => props.onChange(open ? (props.single ? [section.id] : [...props.open, section.id]) : props.open.filter((id) => id !== section.id))}>
            {section.content}
          </Disclosure>
        </View>
      ))}
    </View>
  );
}
