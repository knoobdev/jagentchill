import { useState, type ReactNode } from "react";
import { View } from "react-native";
import { Icon, type IconName } from "./Icon.tsx";
import { Button } from "./button.tsx";
import { defaultStorage } from "./platform/dom";
import { Tap } from "./tap.tsx";
import { Text } from "./text.tsx";
import { useTheme } from "./theme.tsx";
import { borderWidth, radius, size, space, type ColorToken } from "./tokens.ts";

export type CalloutTone = "info" | "success" | "warning" | "danger";
// Bar, fill and icon colour per tone; the icon uses the tone's `/text` grade and has a different shape per tone.
const TONE: Record<CalloutTone, { bar: ColorToken; fill: ColorToken; icon: ColorToken; glyph: IconName }> = {
  info: { bar: "accent", fill: "accent/subtle", icon: "accent/text", glyph: "info" },
  success: { bar: "success", fill: "success/subtle", icon: "success/text", glyph: "check-c" },
  warning: { bar: "warning", fill: "warning/subtle", icon: "warning/text", glyph: "warn" },
  danger: { bar: "danger", fill: "danger/subtle", icon: "danger/text", glyph: "x-c" },
};
export type CalloutAction = { label: string; onPress(): void };

/** A link inside a callout or banner: `accent/text` with an underline. */
function InlineLink(props: CalloutAction) {
  return <Button kind="link" label={props.label} onPress={props.onPress} />;
}

/** A block with a 3 px bar at its inline-start, a tinted fill, an icon, body text in `text/primary` and optional actions. */
export function Callout(props: { tone: CalloutTone; children: ReactNode; actions?: CalloutAction[]; title?: string }) {
  const theme = useTheme();
  const tone = TONE[props.tone];
  return (
    <View accessibilityRole={props.tone === "danger" || props.tone === "warning" ? "alert" : undefined} role={props.tone === "danger" || props.tone === "warning" ? "alert" : "status"}
      style={{ flexDirection: "row", gap: space[2], paddingVertical: space[2] + space[0.5], paddingHorizontal: space[3], borderStartWidth: size.calloutBar, borderStartColor: theme.color(tone.bar), backgroundColor: theme.color(tone.fill),
        borderTopEndRadius: radius.sm, borderBottomEndRadius: radius.sm, alignItems: "flex-start" }}>
      <View style={{ marginTop: borderWidth.hairline }}><Icon name={tone.glyph} size={16} color={tone.icon} /></View>
      <View style={{ flex: 1, minWidth: 0, gap: space[1] }}>
        {props.title ? <Text variant="body-medium">{props.title}</Text> : null}
        <Text>{props.children}</Text>
        {props.actions?.length ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[3] }}>{props.actions.map((action) => <InlineLink key={action.label} {...action} />)}</View> : null}
      </View>
    </View>
  );
}

const dismissedThisSession = new Set<string>();
const bannerKey = (id: string) => `jagentchill.banner.${id}`;
/** Whether a banner was dismissed, per the caller's policy: for the session, or permanently. */
export const bannerDismissed = (id: string, policy: "session" | "permanent") => (policy === "permanent" ? defaultStorage.get(bannerKey(id)) === "1" : dismissedThisSession.has(id));
export function dismissBanner(id: string, policy: "session" | "permanent") {
  if (policy === "permanent") defaultStorage.set(bannerKey(id), "1"); else dismissedThisSession.add(id);
}

/**
 * A full-width strip at the top of a region, 36 px tall: one message, up to two actions and an optional dismiss ×, used for
 * connection loss, a degraded renderer, a read-only project lock and update readiness.
 */
export function Banner(props: { id: string; tone?: CalloutTone; children: string; actions?: [CalloutAction] | [CalloutAction, CalloutAction]; dismissible?: "session" | "permanent"; onDismiss?(): void }) {
  const theme = useTheme();
  const tone = TONE[props.tone ?? "warning"];
  const [hidden, setHidden] = useState(() => (props.dismissible ? bannerDismissed(props.id, props.dismissible) : false));
  if (hidden) return null;
  return (
    <View role={props.tone === "danger" ? "alert" : "status"} style={{ flexDirection: "row", alignItems: "center", gap: space[2], minHeight: size.banner, paddingHorizontal: space[3], backgroundColor: theme.color(tone.fill), borderBottomWidth: borderWidth.hairline, borderBottomColor: theme.color("border/hairline") }}>
      <Icon name={tone.glyph} size={16} color={tone.icon} />
      <Text numberOfLines={theme.compact ? 2 : 1} style={{ flex: 1 }}>{props.children}</Text>
      {props.actions?.map((action) => <InlineLink key={action.label} {...action} />)}
      {props.dismissible ? (
        <Tap role="button" label={theme.t("dismiss")} target style={{ borderRadius: radius.full }} onPress={() => { dismissBanner(props.id, props.dismissible!); setHidden(true); props.onDismiss?.(); }}>
          <Icon name="x" size={14} color="text/secondary" />
        </Tap>
      ) : null}
    </View>
  );
}
