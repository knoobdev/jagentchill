import type { ReactNode } from "react";
import { View, type DimensionValue, type StyleProp, type ViewStyle } from "react-native";
import { LOADING } from "./logic/timers.ts";
import { Skeleton, useElapsed } from "./progress.tsx";
import { useTheme } from "./theme.tsx";
import { borderWidth, cardRow, control, radius, space } from "./tokens.ts";

/**
 * The box of content that is loading (`design-system.Progress indicators and skeletons`). It takes the room of the
 * skeleton from the first frame, so nothing jumps, but draws it only once the wait has lasted 150 ms, so a fast load
 * shows nothing at all. Announced as "Loading". Callers show it only while the request is under way: a failed request
 * shows its error state instead.
 */
export function LoadingSkeleton(props: { children: ReactNode; label?: string; style?: StyleProp<ViewStyle>; testID?: string }) {
  const theme = useTheme();
  const shown = useElapsed(true, LOADING.skeleton);
  return (
    <View role="progressbar" accessibilityRole="progressbar" aria-busy aria-label={props.label ?? theme.t("loading")} accessibilityLabel={props.label ?? theme.t("loading")} testID={props.testID ?? "skeleton"}
      {...({ dataSet: { shown: String(shown) } } as object)} style={[{ opacity: shown ? 1 : 0, alignSelf: "stretch" }, props.style]}>
      {props.children}
    </View>
  );
}

// Line widths that read as text: no two neighbours end at the same place.
const WIDTHS: readonly DimensionValue[] = ["72%", "54%", "64%", "40%", "58%", "46%"];
const widthAt = (index: number) => WIDTHS[index % WIDTHS.length]!;
const range = (count: number) => Array.from({ length: count }, (_, index) => index);

/** Lines of text: a paragraph, a description, the fields of a form that is being read. */
export function SkeletonText(props: { lines?: number; style?: StyleProp<ViewStyle>; testID?: string }) {
  return (
    <LoadingSkeleton testID={props.testID} style={[{ gap: space[2] }, props.style]}>
      {range(props.lines ?? 3).map((index) => <Skeleton key={index} width={widthAt(index)} />)}
    </LoadingSkeleton>
  );
}

/** Rows of a list: an optional leading icon, avatar or thumbnail, a title line and an optional meta line. */
export function SkeletonList(props: { rows?: number; leading?: "icon" | "avatar" | "thumb"; meta?: boolean; style?: StyleProp<ViewStyle>; testID?: string }) {
  const theme = useTheme();
  const leading = props.leading === "thumb" ? { width: 64, height: 36 } : props.leading === "avatar" ? { width: 32, height: 32 } : { width: 16, height: 16 };
  const height = props.meta || props.leading === "thumb" || props.leading === "avatar" ? cardRow.minHeight + space[2] : theme.touch ? control.touch : control.md;
  return (
    <LoadingSkeleton testID={props.testID} style={props.style}>
      {range(props.rows ?? 5).map((index) => (
        <View key={index} style={{ height, flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[2] }}>
          {props.leading ? <Skeleton width={leading.width} height={leading.height} round={props.leading === "avatar"} /> : null}
          <View style={{ flex: 1, gap: space[1.5] }}>
            <Skeleton width={widthAt(index)} />
            {props.meta ? <Skeleton width={widthAt(index + 3)} height={space[2]} /> : null}
          </View>
        </View>
      ))}
    </LoadingSkeleton>
  );
}

/** Cards of a grid: a thumbnail in the grid's frame, a title line and a meta line. */
export function SkeletonGrid(props: { items?: number; minWidth?: number; ratio?: number; style?: StyleProp<ViewStyle>; testID?: string }) {
  const min = props.minWidth ?? 200;
  return (
    <LoadingSkeleton testID={props.testID} style={[{ flexDirection: "row", flexWrap: "wrap", gap: space[4] }, props.style]}>
      {range(props.items ?? 8).map((index) => (
        <View key={index} style={{ flexGrow: 1, flexBasis: min, minWidth: min, maxWidth: min * 1.6, gap: space[2] }}>
          <Skeleton height={null} style={{ aspectRatio: props.ratio ?? 16 / 9, borderRadius: radius.md }} />
          <Skeleton width={widthAt(index)} />
          <Skeleton width={widthAt(index + 3)} height={space[2]} />
        </View>
      ))}
    </LoadingSkeleton>
  );
}

/** A table: a header row and body rows of `columns` cells, the first one widest. */
export function SkeletonTable(props: { rows?: number; columns?: number; style?: StyleProp<ViewStyle>; testID?: string }) {
  const theme = useTheme();
  const columns = range(props.columns ?? 4);
  const row = (index: number, header: boolean) => (
    <View key={index} style={{ height: header ? control.md : cardRow.minHeight, flexDirection: "row", alignItems: "center", gap: space[4], paddingHorizontal: space[3], borderBottomWidth: borderWidth.hairline, borderBottomColor: theme.color("border/hairline") }}>
      {columns.map((column) => <View key={column} style={{ flex: column === 0 ? 2 : 1 }}><Skeleton width={header ? "40%" : widthAt(index + column)} height={header ? space[2] : space[3]} /></View>)}
    </View>
  );
  return (
    <LoadingSkeleton testID={props.testID} style={props.style}>
      {row(-1, true)}
      {range(props.rows ?? 5).map((index) => row(index, false))}
    </LoadingSkeleton>
  );
}

/** Grouped setting cards: a heading line, then a bordered card of rows with a label on one side and a control on the other. */
export function SkeletonCards(props: { cards?: number; rows?: number; style?: StyleProp<ViewStyle>; testID?: string }) {
  const theme = useTheme();
  return (
    <LoadingSkeleton testID={props.testID} style={[{ gap: space[5] }, props.style]}>
      {range(props.cards ?? 2).map((card) => (
        <View key={card} style={{ gap: space[2] }}>
          <Skeleton width={120} height={space[3]} />
          <View style={{ borderWidth: borderWidth.hairline, borderColor: theme.color("border/hairline"), borderRadius: radius.md }}>
            {range(props.rows ?? 3).map((index) => (
              <View key={index} style={{ minHeight: cardRow.minHeight, flexDirection: "row", alignItems: "center", gap: space[4], paddingHorizontal: cardRow.paddingHorizontal, borderTopWidth: index === 0 ? 0 : borderWidth.hairline, borderTopColor: theme.color("border/hairline") }}>
                <View style={{ flex: 1, gap: space[1.5] }}><Skeleton width={widthAt(index + card)} /><Skeleton width={widthAt(index + card + 2)} height={space[2]} /></View>
                <Skeleton width={72} height={control.xs} />
              </View>
            ))}
          </View>
        </View>
      ))}
    </LoadingSkeleton>
  );
}

/** The history of a chat while it is read: the person's messages at the inline end, the agent's lines at the start. */
export function SkeletonChat(props: { turns?: number; style?: StyleProp<ViewStyle>; testID?: string }) {
  return (
    <LoadingSkeleton testID={props.testID} style={[{ gap: space[4] }, props.style]}>
      {range(props.turns ?? 2).map((index) => (
        <View key={index} style={{ gap: space[3] }}>
          <View style={{ alignItems: "flex-end" }}><Skeleton width={index % 2 ? "46%" : "62%"} height={control.md} style={{ borderRadius: radius.lg }} /></View>
          <View style={{ gap: space[2] }}><Skeleton width="88%" /><Skeleton width="76%" /><Skeleton width={widthAt(index + 1)} /></View>
        </View>
      ))}
    </LoadingSkeleton>
  );
}
