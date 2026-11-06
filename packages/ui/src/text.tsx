import type { ReactNode } from "react";
import { Text as NativeText, type StyleProp, type TextStyle } from "react-native";
import { useTheme } from "./theme.tsx";
import { japaneseWeight, needsJapaneseFace, type ColorToken, type TypeToken } from "./tokens.ts";

export type TextProps = {
  children: ReactNode; variant?: TypeToken; color?: ColorToken; style?: StyleProp<TextStyle>; numberOfLines?: number; selectable?: boolean;
  /** Tabular figures, for timecodes and numeric cells. Always on for `mono`. */
  tabular?: boolean; underline?: boolean; align?: "auto" | "center" | "right" | "left";
  /** Heading level exposed to assistive technology. */
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  nativeID?: string; testID?: string; live?: "polite" | "assertive"; role?: "alert" | "status";
  onPress?(): void;
};

const stringOf = (node: ReactNode): string => (typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(stringOf).join("") : "");

/** Text in a type token and a colour token. Text never takes a fill token: status and link text use the `/text` grades. */
export function Text(props: TextProps) {
  const theme = useTheme();
  const variant = props.variant ?? "body";
  const content = stringOf(props.children);
  const type = theme.type(variant, content);
  // The bundled Japanese face has no weight 500.
  const weight = variant !== "mono" && needsJapaneseFace(theme.locale, content) ? japaneseWeight(type.fontWeight) : type.fontWeight;
  return (
    <NativeText numberOfLines={props.numberOfLines} selectable={props.selectable} nativeID={props.nativeID} testID={props.testID} onPress={props.onPress}
      accessibilityRole={props.level ? "header" : props.role === "alert" ? "alert" : undefined} aria-level={props.level}
      accessibilityLiveRegion={props.live} aria-live={props.live} role={props.level ? "heading" : props.role}
      style={[type, { fontWeight: weight, color: theme.color(props.color ?? "text/primary") },
        props.tabular || variant === "mono" ? TABULAR : null, props.underline ? UNDERLINE : null, props.align ? { textAlign: props.align } : null, props.style]}>
      {props.children}
    </NativeText>
  );
}
const TABULAR: TextStyle = { fontVariant: ["tabular-nums"] };
const UNDERLINE: TextStyle = { textDecorationLine: "underline" };

/** Text for assistive technology only: announced through a live region and not drawn. */
export function Announce(props: { children: string; assertive?: boolean }) {
  return (
    <NativeText accessibilityLiveRegion={props.assertive ? "assertive" : "polite"} aria-live={props.assertive ? "assertive" : "polite"} role={props.assertive ? "alert" : "status"} style={HIDDEN}>
      {props.children}
    </NativeText>
  );
}
const HIDDEN: TextStyle = { position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0 };
