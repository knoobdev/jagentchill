import { View } from "react-native";
import { chordSeparator, isApple, keycaps } from "./logic/keys.ts";
import { Text } from "./text.tsx";
import { useShortcut, useTheme } from "./theme.tsx";
import { borderWidth, radius, size, space } from "./tokens.ts";

/**
 * A key or chord as keycaps with platform labels: ⌘ ⌥ ⇧ ⌃ on macOS and iOS, words elsewhere, arrows as glyphs. Chords are
 * separated by a thin space on macOS and by " + " elsewhere. `inverse` draws it inside a tooltip.
 */
export function Kbd(props: { keys: string[]; inverse?: boolean }) {
  const theme = useTheme();
  const caps = keycaps(props.keys, theme.os, theme.locale);
  const plus = !isApple(theme.os);
  return (
    <View accessible accessibilityLabel={caps.join(chordSeparator(theme.os))} style={{ flexDirection: "row", alignItems: "center", gap: space[0.5], flexShrink: 0 }}>
      {caps.map((cap, index) => (
        <View key={`${cap}${index}`} style={{ flexDirection: "row", alignItems: "center", gap: space[0.5] }}>
          {plus && index > 0 ? <Text variant="caption" color={props.inverse ? "text/on-strong" : "text/secondary"}>+</Text> : null}
          <View style={{ minWidth: size.kbd, height: size.kbd, paddingHorizontal: space[1], borderRadius: radius.xs, borderWidth: borderWidth.hairline,
            borderColor: theme.color(props.inverse ? "strong/hover" : "border/hairline"), backgroundColor: theme.color(props.inverse ? "strong/hover" : "bg/subtle"), alignItems: "center", justifyContent: "center" }}>
            <Text variant="caption" color={props.inverse ? "text/on-strong" : "text/primary"}>{cap}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

/** The current binding of an action as keycaps, read live from the binding lookup. Draws nothing when the action is unbound. */
export function ShortcutHint(props: { action: string; inverse?: boolean }) {
  const keys = useShortcut(props.action);
  return keys?.length ? <Kbd keys={keys} inverse={props.inverse} /> : null;
}
/** The binding as plain secondary text, for menu rows. */
export function ShortcutText(props: { action?: string; keys?: readonly string[] }) {
  const theme = useTheme();
  const bound = useShortcut(props.action);
  const keys = props.keys ?? bound;
  return keys?.length ? <Text variant="meta" color="text/secondary">{keycaps(keys, theme.os, theme.locale).join(chordSeparator(theme.os))}</Text> : null;
}
