import type { ReactNode } from "react";
import { View, type ViewStyle } from "react-native";
import { Text } from "../text.tsx";
import { useTheme } from "../theme.tsx";
import { borderWidth, radius, space } from "../tokens.ts";

/** One state of one component as the catalogue shows it. The completeness test reads `component` and `state`. */
export type Entry = { component: string; state: string; node: ReactNode; label?: string; wide?: boolean };
export type Section = { id: string; title: string; span?: 1 | 2 | 3; entries: Entry[]; note?: string; layout?: "row" | "column" };
export const entry = (component: string, state: string, node: ReactNode, options: { label?: string; wide?: boolean } = {}): Entry => ({ component, state, node, ...options });

/** A catalogue block: a caption, its entries with their state labels, and a note. */
export function SectionView(props: { section: Section; style?: ViewStyle }) {
  const theme = useTheme();
  const { section } = props;
  return (
    <View nativeID={`cat-${section.id}`} testID={`cat-${section.id}`} style={[{ backgroundColor: theme.color("bg/app"), borderWidth: borderWidth.hairline, borderColor: theme.color("border/hairline"), borderRadius: radius.md, padding: space[4], gap: space[3] }, props.style]}>
      <Text variant="caption" color="text/secondary" level={3}>{section.title.toUpperCase()}</Text>
      <View style={section.layout === "column" ? { gap: space[3] } : { flexDirection: "row", flexWrap: "wrap", gap: space[3], alignItems: "flex-end" }}>
        {section.entries.map((item, index) => (
          <View key={`${item.component}-${item.state}-${index}`} testID={`entry-${item.component}-${item.state}`} style={item.wide || section.layout === "column" ? { alignSelf: "stretch", width: "100%", gap: space[1] } : { alignItems: "center", gap: space[1] }}>
            {item.node}
            <Text variant="caption" color="text/secondary">{item.label ?? item.state}</Text>
          </View>
        ))}
      </View>
      {section.note ? <Text variant="meta" color="text/secondary">{section.note}</Text> : null}
    </View>
  );
}
