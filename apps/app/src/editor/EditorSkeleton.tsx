import { View } from "react-native";
import { LoadingSkeleton, Skeleton, Text, borderWidth, radius, space, useTheme } from "@jagentchill/ui";
import { useT } from "../locale";

/**
 * The editor while its project is being opened: the regions of the finished screen (assets, preview, inspector,
 * timeline) as empty blocks, so the screen does not change shape when the project arrives. A phone shows the preview,
 * the toolbar and the timeline only. Announced once as "Loading project…".
 */
export function EditorSkeleton() {
  const theme = useTheme();
  const t = useT();
  const line = theme.color("border/hairline");
  const block = { borderRadius: radius.md };
  const track = (key: number) => <View key={key} style={{ flexDirection: "row", gap: space[1], alignItems: "center" }}><Skeleton width={space[8]} height={space[5]} />{[30, 18, 26].map((width, index) => <Skeleton key={index} width={`${width + (key % 2) * 6}%`} height={space[5]} style={block} />)}</View>;
  const timeline = (
    <View style={{ gap: space[2], padding: space[3], borderTopWidth: borderWidth.hairline, borderTopColor: line, height: theme.compact ? 180 : 240 }}>
      <Skeleton width={160} height={space[4]} />
      {[0, 1, 2].map(track)}
    </View>
  );
  return (
    <View style={{ flex: 1 }}>
      <Text variant="title-sm" live="polite" style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}>{t("Loading project…")}</Text>
      <LoadingSkeleton label={t("Loading project…")} testID="editor-skeleton" style={{ flex: 1 }}>
        <View style={{ flex: 1, flexDirection: "column" }}>
          <View style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
            {theme.compact ? null : (
              <View style={{ width: 320, padding: space[3], gap: space[2], borderEndWidth: borderWidth.hairline, borderEndColor: line }}>
                <Skeleton height={space[6]} style={block} />
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} width="47%" height={72} style={block} />)}</View>
              </View>
            )}
            <View style={{ flex: 1, padding: space[4], alignItems: "center", justifyContent: "center" }}>
              <Skeleton width="100%" height={null} style={{ ...block, maxWidth: 720, aspectRatio: 16 / 9 }} />
            </View>
            {theme.compact ? null : (
              <View style={{ width: 300, padding: space[3], gap: space[3], borderStartWidth: borderWidth.hairline, borderStartColor: line }}>
                <Skeleton width="50%" height={space[4]} />
                {[0, 1, 2, 3].map((index) => <View key={index} style={{ gap: space[1.5] }}><Skeleton width="30%" height={space[2]} /><Skeleton height={space[6]} style={block} /></View>)}
              </View>
            )}
          </View>
          {timeline}
        </View>
      </LoadingSkeleton>
    </View>
  );
}
