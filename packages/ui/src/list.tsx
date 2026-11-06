import { useState, type ReactNode, type Ref } from "react";
import { ScrollView, View } from "react-native";
import { Icon, type IconName } from "./Icon.tsx";
import { Dot } from "./avatar.tsx";
import { IconButton } from "./button.tsx";
import { VIRTUALISE, windowOf } from "./logic/lists.ts";
import { ContextMenu, Menu, type MenuItem } from "./menu.tsx";
import { isSelectableRole, Tap, type ForcedState } from "./tap.tsx";
import { Text } from "./text.tsx";
import { useTheme } from "./theme.tsx";
import { borderWidth, densityDefaults, opacity, radius, space, type ColorToken } from "./tokens.ts";
import { useRef } from "react";

export type MetaTone = "warning" | "success" | "danger" | "accent" | "purple";
const META: Record<MetaTone, ColorToken> = { warning: "warning/text", success: "success/text", danger: "danger/text", accent: "accent/text", purple: "purple/text" };

export type ListRowProps = {
  title: string; meta?: string; metaTone?: MetaTone; metaLeading?: ReactNode; icon?: IconName; leading?: ReactNode; trailing?: ReactNode;
  selected?: boolean; onPress?(): void; disabled?: boolean; requiresHost?: boolean; dragging?: boolean; forceState?: ForcedState;
  /** Keeps the host gate (the requires-host sheet) without drawing the link badge. */
  hideBadge?: boolean;
  /** A 6 px `accent` dot at the inline-end edge; the accessible name ends with "unread". */
  unread?: boolean; count?: number | string; chevron?: boolean; shortcut?: ReactNode;
  /** Rows of a ⋯ button shown on hover or focus (always at compact-touch density), and of the context menu on right-click and long-press. */
  menu?: MenuItem[]; current?: "page" | boolean; role?: "button" | "link" | "option" | "treeitem"; indent?: number; testID?: string;
  /** For rows that form one roving-focus list, and rows that open a group or a menu. */
  onKeyDown?: Parameters<typeof Tap>[0]["onKeyDown"]; tabIndex?: 0 | -1; expanded?: boolean; rowRef?: Ref<View>; nativeID?: string;
};

/**
 * A row of a list or of the sidebar: 28 px, or 44 px with a meta line (44 and 56 at compact-touch density). Selected rows
 * are `bg/subtle` with the title in weight 500 and their icon in `text/primary`.
 */
export function ListRow(props: ListRowProps) {
  const theme = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const more = useRef<View>(null);
  const sizes = densityDefaults[theme.density];
  const name = props.unread ? `${props.title}, ${theme.t("unread")}` : props.title;
  const [hovered, setHovered] = useState(false);
  const [inside, setInside] = useState(false);
  const hot = hovered || props.forceState === "hover" || props.forceState === "pressed";
  const row = (
    // The row's surface; the main control and the trailing ⋯ button sit side by side in it, so neither contains the other.
    <View {...({ onPointerEnter: () => setHovered(!theme.touch), onPointerLeave: () => setHovered(false), onFocus: () => setInside(true), onBlur: () => setInside(false) } as object)}
      style={{ minHeight: props.meta ? sizes.rowTwoLine : sizes.row, borderRadius: radius.sm, flexDirection: "row", alignItems: "center", paddingEnd: theme.touch ? space[3] : space[2], gap: theme.touch ? space[3] : space[2],
        opacity: props.dragging ? opacity.dragging : props.disabled ? opacity.disabled : 1, backgroundColor: props.selected ? theme.color("bg/subtle") : hot ? theme.color("bg/hover") : "transparent",
        // With "Increase contrast" a selected row also carries a bar at its inline-start edge.
        borderStartWidth: borderWidth.focus, borderStartColor: props.selected && theme.increaseContrast ? theme.color("text/primary") : "transparent" }}>
      <Tap role={props.role ?? "button"} label={props.meta ? `${name}, ${props.meta}` : name} selected={isSelectableRole(props.role) ? props.selected : undefined} current={props.selected ? props.current ?? true : undefined} onPress={props.onPress} disabled={props.disabled}
        requiresHost={props.requiresHost} hideBadge={props.hideBadge} forceState={props.forceState} testID={props.testID} onKeyDown={props.onKeyDown} tabIndex={props.tabIndex} expanded={props.expanded} ref={props.rowRef} nativeID={props.nativeID}
        // The full title is the tooltip of a truncated row.
        tooltip={{ label: props.title }}
        style={{ flex: 1, minWidth: 0, alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: theme.touch ? space[3] : space[2], paddingStart: (theme.touch ? space[3] : space[2]) - borderWidth.focus + (props.indent ?? 0), borderRadius: radius.sm, opacity: 1 }}>
        {/* The row is named by its title and meta: an avatar or a status mark in it is not read a second time. */}
        {props.leading ? <View aria-hidden importantForAccessibility="no-hide-descendants">{props.leading}</View> : props.icon ? <Icon name={props.icon} size={14} color={props.selected ? "text/primary" : "text/secondary"} /> : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} variant={props.selected ? "body-medium" : "body"}>{props.title}</Text>
          {props.meta ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[1.5] }}>
              {props.metaLeading ? <View aria-hidden importantForAccessibility="no-hide-descendants">{props.metaLeading}</View> : null}
              <Text variant="meta" color={props.metaTone ? META[props.metaTone] : "text/secondary"} numberOfLines={1} style={{ flexShrink: 1 }}>{props.meta}</Text>
            </View>
          ) : null}
        </View>
        {props.shortcut}
        {props.count !== undefined ? <Text variant="meta" color="text/secondary" tabular>{props.count}</Text> : null}
      </Tap>
      {props.trailing}
      {props.menu ? (
        <View style={{ opacity: theme.touch || hot || inside || menuOpen ? 1 : 0 }}>
          <IconButton ref={more} icon="more" size="xs" compactVisual label={theme.t("moreActions")} expanded={menuOpen} onPress={() => setMenuOpen(true)} />
        </View>
      ) : null}
      {props.unread ? <Dot /> : null}
      {props.chevron ? <Icon name={theme.rtl ? "chev-l" : "chev-r"} size={14} color="text/secondary" /> : null}
    </View>
  );
  if (!props.menu) return row;
  return (
    <ContextMenu items={props.menu} label={props.title}>
      {row}
      <Menu open={menuOpen} anchor={more} items={props.menu} label={props.title} onClose={() => setMenuOpen(false)} />
    </ContextMenu>
  );
}

/** An 11 px `text/secondary` caption above a group of rows, with 12 px top spacing. */
export function ListCaption(props: { label: string }) {
  return <View style={{ paddingTop: space[3], paddingHorizontal: space[2], paddingBottom: space[1] }}><Text variant="caption" color="text/secondary" level={3}>{props.label}</Text></View>;
}

/** A scrolling list of uniform rows. Above 100 rows only the rows near the viewport are mounted. */
export function VirtualList<T>(props: { items: readonly T[]; rowHeight: number; height: number; render(item: T, index: number): ReactNode; keyOf(item: T, index: number): string; threshold?: number; label?: string; onEndReached?(): void; endThreshold?: number }) {
  const [scroll, setScroll] = useState(0);
  const virtual = props.items.length > (props.threshold ?? VIRTUALISE.rows);
  const range = virtual ? windowOf(props.items.length, props.rowHeight, scroll, props.height) : { from: 0, to: props.items.length, before: 0, after: 0 };
  return (
    <ScrollView style={{ maxHeight: props.height }} scrollEventThrottle={16} accessibilityLabel={props.label}
      onScroll={(event) => {
        const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
        setScroll(contentOffset.y);
        if (props.onEndReached && contentSize.height - contentOffset.y - layoutMeasurement.height < (props.endThreshold ?? 200)) props.onEndReached();
      }}>
      {range.before ? <View style={{ height: range.before }} /> : null}
      {props.items.slice(range.from, range.to).map((item, offset) => <View key={props.keyOf(item, range.from + offset)} style={{ height: props.rowHeight, justifyContent: "center" }}>{props.render(item, range.from + offset)}</View>)}
      {range.after ? <View style={{ height: range.after }} /> : null}
    </ScrollView>
  );
}
