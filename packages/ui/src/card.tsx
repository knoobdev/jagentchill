import { useRef, useState, type ReactNode } from "react";
import { Image, TextInput, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon, type IconName } from "./Icon.tsx";
import { StatusPill, type Tone } from "./avatar.tsx";
import { IconButton } from "./button.tsx";
import { copyText } from "./platform/dom";
import { Spinner } from "./progress.tsx";
import { Tap, keyOf, type ForcedState, type KeyEvent } from "./tap.tsx";
import { Text } from "./text.tsx";
import { useTheme } from "./theme.tsx";
import { useToast } from "./toast.tsx";
import { TOAST } from "./logic/toast.ts";
import { compactSettingRowStacks } from "./compact.ts";
import { borderWidth, cardRow, radius, size, space } from "./tokens.ts";

export type CardProps = {
  children: ReactNode; style?: StyleProp<ViewStyle>; padding?: number;
  /** Makes the card interactive: hover `bg/hover` and a focus ring. */
  onPress?(): void; label?: string; selected?: boolean; tint?: boolean; requiresHost?: boolean; forceState?: ForcedState; disabled?: boolean;
};

/** A `bg/app` surface with a 1 px `border/hairline` border, radius 8 and no shadow. Selected cards have a 2 px `accent` border. */
export function Card(props: CardProps) {
  const theme = useTheme();
  const edge = props.selected ? borderWidth.focus : borderWidth.hairline;
  const padding = (props.padding ?? space[3]) - (edge - borderWidth.hairline);
  const base = (hovered: boolean): ViewStyle => ({
    backgroundColor: theme.color(props.tint ? "accent/subtle" : hovered ? "bg/hover" : "bg/app"), borderWidth: edge, borderColor: theme.color(props.selected ? "accent" : "border/hairline"),
    borderRadius: radius.md, padding: Math.max(0, padding),
  });
  if (!props.onPress) return <View style={[base(props.forceState === "hover"), props.style]}>{props.children}</View>;
  return (
    <Tap role="button" label={props.label} onPress={props.onPress} selected={props.selected} requiresHost={props.requiresHost} forceState={props.forceState} disabled={props.disabled}
      style={(state) => [base(state.hovered || state.pressed), props.style]}>
      {props.children}
    </Tap>
  );
}

const FRAMES = { "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1 } as const;
/** A card with a thumbnail in a 16:9, 9:16 or 1:1 frame, a title, a meta line and an optional play overlay, duration and status pill. */
export function MediaCard(props: {
  title: string; meta?: string; image?: string; preview?: ReactNode; frame?: keyof typeof FRAMES; duration?: string; play?: boolean;
  status?: { label: string; tone?: Tone; status?: string }; onPress?(): void; selected?: boolean; requiresHost?: boolean; width?: number;
}) {
  const theme = useTheme();
  return (
    <Card padding={0} onPress={props.onPress} label={props.title} selected={props.selected} requiresHost={props.requiresHost} style={{ overflow: "hidden", width: props.width }}>
      <View style={{ aspectRatio: FRAMES[props.frame ?? "16:9"], backgroundColor: theme.color("bg/canvas") }}>
        {props.preview ?? (props.image ? <Image source={{ uri: props.image }} accessibilityLabel="" style={{ width: "100%", height: "100%" }} /> : null)}
        {props.play ? (
          <View pointerEvents="none" style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" }}>
            <View style={{ width: size.mediaPlay, height: size.mediaPlay, borderRadius: radius.full, backgroundColor: theme.color("clip/label-scrim"), alignItems: "center", justifyContent: "center" }}><Icon name="play" size={16} color="clip/label" /></View>
          </View>
        ) : null}
        {props.duration ? (
          <View style={{ position: "absolute", end: space[1], bottom: space[1], backgroundColor: theme.color("clip/label-scrim"), borderRadius: radius.xs, paddingHorizontal: space[1] }}>
            <Text variant="caption" color="clip/label" tabular>{props.duration}</Text>
          </View>
        ) : null}
      </View>
      <View style={{ padding: space[2] }}>
        <Text variant="body-medium" numberOfLines={1}>{props.title}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[1.5] }}>
          <Text variant="meta" color="text/secondary" numberOfLines={1} style={{ flex: 1 }}>{props.meta ?? ""}</Text>
          {props.status ? <StatusPill {...props.status} /> : null}
        </View>
      </View>
    </Card>
  );
}

/** One bordered card whose rows are separated by hairlines. */
export function GroupedSettingCard(props: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <Card padding={0} style={props.style}>{props.children}</Card>;
}

export type SettingRowProps = {
  label: string; description?: string; children?: ReactNode; last?: boolean;
  /** The landing variant: a 28 px icon tile at the start and a chevron at the end. */
  icon?: IconName; onPress?(): void; requiresHost?: boolean; testID?: string;
};
/**
 * A row of a grouped setting card: a label, an optional description of up to 3 lines and one control aligned to the end.
 * Padding 12×10 px, at least 44 px tall. On compact form factors the control wraps below the label in rows narrower than 360 px.
 */
export function SettingRow(props: SettingRowProps) {
  const theme = useTheme();
  const [width, setWidth] = useState(theme.width);
  const stack = compactSettingRowStacks(width, theme.compact, Boolean(props.children));
  const style: ViewStyle = {
    flexDirection: stack ? "column" : "row", alignItems: stack ? "stretch" : "center", gap: stack ? space[2] : space[3], paddingVertical: cardRow.paddingVertical, paddingHorizontal: cardRow.paddingHorizontal,
    minHeight: cardRow.minHeight, borderBottomWidth: props.last ? 0 : borderWidth.hairline, borderBottomColor: theme.color("border/hairline"),
  };
  const content = (
    <>
      {props.icon ? <View style={{ width: size.iconTile, height: size.iconTile, borderRadius: radius.sm, backgroundColor: theme.color("bg/subtle"), alignItems: "center", justifyContent: "center" }}><Icon name={props.icon} size={16} color="text/secondary" /></View> : null}
      <View style={{ flex: stack ? undefined : 1, minWidth: 0 }}>
        <Text variant="body-medium">{props.label}</Text>
        {props.description ? <Text variant="meta" color="text/secondary" numberOfLines={3}>{props.description}</Text> : null}
      </View>
      {props.children ? <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexShrink: 0 }}>{props.children}</View> : null}
      {props.onPress ? <Icon name={theme.rtl ? "chev-l" : "chev-r"} size={14} color="text/secondary" /> : null}
    </>
  );
  if (props.onPress) {
    return <Tap role="button" label={props.label} testID={props.testID} onPress={props.onPress} requiresHost={props.requiresHost} style={(state) => [style, { backgroundColor: state.hovered || state.pressed ? theme.color("bg/hover") : "transparent" }]}>{content}</Tap>;
  }
  return <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={style}>{content}</View>;
}

/**
 * A value shown as a chip with a pencil. Activating it edits in place: Enter saves — the row shows a pending state until the
 * save settles — and Escape restores the previous value without saving.
 */
export function InlineEditChip(props: { label: string; value: string; onSave(value: string): void | Promise<unknown>; maxLength?: number }) {
  const theme = useTheme();
  const toast = useToast();
  const [draft, setDraft] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const cancelled = useRef(false);
  const save = () => {
    const next = (draft ?? "").trim();
    setDraft(null);
    if (cancelled.current || next === "" || next === props.value) return;
    const result = props.onSave(next);
    if (!result || typeof (result as Promise<unknown>).then !== "function") return;
    setPending(next);
    (result as Promise<unknown>).then(() => setPending(null), (error: unknown) => { setPending(null); toast.show({ kind: "error", message: error instanceof Error ? error.message : String(error) }); });
  };
  if (draft !== null) {
    return (
      <TextInput autoFocus accessibilityLabel={props.label} aria-label={props.label} value={draft} maxLength={props.maxLength} onChangeText={setDraft} onBlur={save} selectTextOnFocus
        {...({ "data-escape": "", onKeyPress: (event: KeyEvent) => {
          const key = keyOf(event);
          if (key.key === "Enter") { key.preventDefault(); save(); }
          if (key.key === "Escape") { key.preventDefault(); key.stopPropagation?.(); cancelled.current = true; setDraft(null); }
        } } as object)}
        style={[theme.type("body"), { height: size.chipMd, minWidth: size.sliderMin * 3, paddingHorizontal: space[2], borderRadius: radius.sm, borderWidth: borderWidth.focus, borderColor: theme.color("accent"), color: theme.color("text/primary"), backgroundColor: theme.color("bg/app"), outlineWidth: 0 }]} />
    );
  }
  return (
    <Tap role="button" label={`${theme.t("edit")} ${props.label}`} busy={pending !== null} disabled={pending !== null} onPress={() => { cancelled.current = false; setDraft(props.value); }}
      style={(state) => ({ height: size.chipMd, paddingHorizontal: space[2], borderRadius: radius.full, flexDirection: "row", alignItems: "center", gap: space[1], backgroundColor: theme.color(state.hovered ? "bg/hover" : "bg/subtle") })}>
      <Text variant="meta" numberOfLines={1}>{pending ?? props.value}</Text>
      {pending !== null ? <Spinner size={12} /> : <Icon name="pencil" size={12} color="text/secondary" />}
    </Tap>
  );
}

/** A read-only monospace value with a copy button; copying shows the toast "Copied" for 2 s. */
export function CopyValue(props: { label: string; value: string }) {
  const theme = useTheme();
  const toast = useToast();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space[1], flexShrink: 1 }}>
      <Text variant="mono" color="text/secondary" numberOfLines={1} selectable style={{ flexShrink: 1 }}>{props.value}</Text>
      <IconButton icon="copy" size="xs" compactVisual label={`${theme.t("copy")} ${props.label}`} onPress={() => { void copyText(props.value).then(() => toast.show({ kind: "info", message: theme.t("copied"), duration: TOAST.confirmation })); }} />
    </View>
  );
}
