import { useState, type Ref } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { Icon, type IconName } from "./Icon.tsx";
import { Spinner } from "./progress.tsx";
import { Tap, type ForcedState, type Interaction } from "./tap.tsx";
import { Text } from "./text.tsx";
import { useTheme, type Theme } from "./theme.tsx";
import { Badge } from "./avatar.tsx";
import { PRESSED_OVERLAY, borderWidth, control, controlHeight, controlPadding, radius, space, type ColorToken, type ControlSize } from "./tokens.ts";

export type ButtonKind = "primary" | "strong" | "secondary" | "outline" | "ghost" | "link" | "destructive";
export type ButtonSize = ControlSize;

type Fill = { rest: ColorToken | null; hover: ColorToken | null; pressed: ColorToken | null; label: ColorToken };
export const BUTTON_FILLS: Record<ButtonKind, Fill> = {
  primary: { rest: "accent", hover: "accent/hover", pressed: "accent/pressed", label: "text/on-accent" },
  strong: { rest: "strong", hover: "strong/hover", pressed: null, label: "text/on-strong" },
  secondary: { rest: "bg/subtle", hover: "bg/hover", pressed: null, label: "text/primary" },
  outline: { rest: null, hover: "bg/hover", pressed: null, label: "text/primary" },
  ghost: { rest: null, hover: "bg/hover", pressed: null, label: "text/primary" },
  link: { rest: null, hover: null, pressed: null, label: "accent/text" },
  destructive: { rest: "danger", hover: "danger/hover", pressed: null, label: "text/on-danger" },
};
/** Fill of a button in a state. Pressed is `accent/pressed` for primary and an 8% black overlay for the others. */
export function buttonFill(theme: Theme, kind: ButtonKind, state: Interaction): { backgroundColor: string; overlay: boolean } {
  const fill = BUTTON_FILLS[kind];
  if (state.pressed && fill.pressed) return { backgroundColor: theme.color(fill.pressed), overlay: false };
  const token = state.hovered || state.pressed ? fill.hover ?? fill.rest : fill.rest;
  return { backgroundColor: token ? theme.color(token) : "transparent", overlay: state.pressed && kind !== "link" };
}

export type ButtonProps = {
  label: string; onPress?(): void; kind?: ButtonKind; size?: ButtonSize; icon?: IconName; trailingIcon?: IconName; disabled?: boolean;
  /** Shows a 14 px spinner in place of the leading icon, keeps the width and blocks activation. */
  loading?: boolean; busy?: boolean;
  /** Label colour of a ghost button that names a destructive action. */
  tone?: "danger";
  requiresHost?: boolean; shortcut?: string; forceState?: ForcedState; pressed?: boolean; expanded?: boolean; block?: boolean;
  /** Draws the icon alone; the label stays the accessible name. Used by the chevron segment of a split button. */
  iconOnly?: boolean;
  style?: StyleProp<ViewStyle>; testID?: string; ref?: Ref<View>;
};

export function Button(props: ButtonProps) {
  const theme = useTheme();
  const kind = props.kind ?? "secondary";
  const sizeToken = props.size ?? "md";
  const loading = Boolean(props.loading ?? props.busy);
  const [width, setWidth] = useState<number | undefined>(undefined);
  const labelColor: ColorToken = props.tone === "danger" ? "danger/text" : BUTTON_FILLS[kind].label;
  const link = kind === "link";
  // With no leading icon the spinner takes the label's place, so the button keeps the width it had.
  const overlaySpinner = loading && !props.icon;
  return (
    <Tap ref={props.ref} role={link ? "link" : "button"} label={props.label} onPress={loading ? undefined : props.onPress} disabled={props.disabled} busy={loading} requiresHost={props.requiresHost}
      forceState={props.forceState} testID={props.testID} pressedState={props.pressed} expanded={props.expanded}
      tooltip={props.shortcut ? { label: props.label, shortcut: props.shortcut } : undefined}
      style={(state) => {
        const fill = buttonFill(theme, kind, props.pressed ? { ...state, hovered: true } : state);
        return [{
          height: link ? undefined : controlHeight(sizeToken, theme.density), minWidth: loading ? width : undefined,
          paddingHorizontal: link ? 0 : theme.touch ? space[4] : controlPadding[sizeToken], borderRadius: radius.sm,
          borderWidth: link ? 0 : borderWidth.hairline, borderColor: kind === "outline" ? theme.color("border/strong") : "transparent",
          flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space[1.5], flexShrink: 0, backgroundColor: fill.backgroundColor,
          alignSelf: props.block ? "stretch" : undefined, overflow: "hidden",
        }, props.style];
      }}>
      {(state) => (
        <>
          {state.pressed && kind !== "primary" && !link ? <View pointerEvents="none" style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: PRESSED_OVERLAY }} /> : null}
          <View onLayout={(event) => { if (!loading) setWidth(event.nativeEvent.layout.width + 2 * (theme.touch ? space[4] : controlPadding[sizeToken]) + 2 * borderWidth.hairline); }}
            style={{ flexDirection: "row", alignItems: "center", gap: space[1.5], opacity: overlaySpinner ? 0 : 1 }}>
            {loading && props.icon ? <Spinner size={14} color={labelColor} /> : props.icon ? <Icon name={props.icon} size={14} color={labelColor} /> : null}
            {props.iconOnly ? null : <Text variant={sizeToken === "xs" && !theme.touch ? "meta" : "body-medium"} color={labelColor} numberOfLines={1}
              underline={link && (state.hovered || state.focused || theme.underlineLinks)} style={{ fontWeight: "500" }}>{props.label}</Text>}
            {props.trailingIcon ? <Icon name={props.trailingIcon} size={14} color={labelColor} /> : null}
          </View>
          {overlaySpinner ? <View pointerEvents="none" style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" }}><Spinner size={14} color={labelColor} /></View> : null}
        </>
      )}
    </Tap>
  );
}

export type IconButtonProps = {
  icon: IconName; label: string; onPress?(): void; size?: "xs" | "sm" | "md"; variant?: "ghost" | "outline";
  /** Toggle state: `bg/subtle` fill with a `text/primary` icon, or `accent/subtle` with an `accent` icon for the accent tone. */
  on?: boolean; tone?: "accent"; badge?: number; showZeroBadge?: boolean; disabled?: boolean; color?: ColorToken; requiresHost?: boolean;
  /** Action id whose current binding is shown in the tooltip. */
  shortcut?: string; keys?: readonly string[]; forceState?: ForcedState; toggle?: boolean; expanded?: boolean; noTooltip?: boolean;
  /** Keeps the regular-density box at compact-touch density, inside a 44 px hit area. */
  compactVisual?: boolean; onKeyDown?: Parameters<typeof Tap>[0]["onKeyDown"]; testID?: string; ref?: Ref<View>; tabIndex?: 0 | -1;
};

/** A square button at the control height (24, 28, 32 or 44 px). Always labelled, always with a tooltip. */
export function IconButton(props: IconButtonProps) {
  const theme = useTheme();
  const visual = props.size === "xs" ? control.xs : props.size === "md" ? control.md : control.sm;
  const box = theme.touch && !props.compactVisual ? control.touch : visual;
  const accent = props.tone === "accent" && props.on;
  return (
    <Tap ref={props.ref} role="button" label={props.label} onPress={props.onPress} disabled={props.disabled} requiresHost={props.requiresHost} forceState={props.forceState} testID={props.testID}
      pressedState={props.toggle || props.on !== undefined ? Boolean(props.on) : undefined} expanded={props.expanded} target={props.compactVisual} onKeyDown={props.onKeyDown} tabIndex={props.tabIndex}
      tooltip={props.noTooltip ? undefined : { label: props.label, shortcut: props.shortcut, keys: props.keys }} hideBadge
      style={(state) => ({
        width: box, height: box, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", flexShrink: 0,
        borderWidth: borderWidth.hairline, borderColor: props.variant === "outline" ? theme.color("border/strong") : "transparent",
        backgroundColor: accent ? theme.color("accent/subtle") : props.on ? theme.color("bg/subtle") : state.hovered || state.pressed ? theme.color("bg/hover") : "transparent",
      })}>
      {(state) => (
        <>
          {state.pressed ? <View pointerEvents="none" style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, borderRadius: radius.sm, backgroundColor: PRESSED_OVERLAY }} /> : null}
          <Icon name={props.icon} size={16} color={props.color ?? (accent ? "accent" : props.on || state.hovered ? "text/primary" : "text/secondary")} />
          {props.badge !== undefined && (props.badge > 0 || props.showZeroBadge) ? <View style={{ position: "absolute", top: -space[0.5], end: -space[1] }}><Badge count={props.badge} tone="accent" /></View> : null}
        </>
      )}
    </Tap>
  );
}

/** An IconButton, or a Button when given `text`, with a pressed state exposed as `aria-pressed`. */
export function ToggleButton(props: Omit<IconButtonProps, "on" | "onPress" | "toggle" | "icon"> & { icon?: IconName; text?: boolean; on: boolean; onChange(on: boolean): void }) {
  const { on, onChange, text, icon, ...rest } = props;
  if (text || !icon) return <Button label={rest.label} icon={icon} kind={on ? "secondary" : "ghost"} size={rest.size} pressed={on} onPress={() => onChange(!on)} disabled={rest.disabled} forceState={rest.forceState} />;
  return <IconButton {...rest} icon={icon} toggle on={on} onPress={() => onChange(!on)} />;
}
