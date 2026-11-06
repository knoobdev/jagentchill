import { useRef, useState, type ReactNode } from "react";
import { TextInput, View } from "react-native";
import { Icon, type IconName } from "./Icon.tsx";
import { IconButton } from "./button.tsx";
import { BREADCRUMB, collapseBreadcrumb } from "./logic/lists.ts";
import { truncateMiddle } from "./logic/status.ts";
import { Menu } from "./menu.tsx";
import { Tap, keyOf, type KeyEvent } from "./tap.tsx";
import { Text } from "./text.tsx";
import { useTheme } from "./theme.tsx";
import { borderWidth, control, radius, space } from "./tokens.ts";

/** `onNode` receives the segment's element, e.g. to make it a drop target. */
export type Crumb = { id: string; label: string; icon?: IconName; onPress?(): void; onRename?(label: string): void; onNode?(node: View | null): void };

/**
 * A navigation landmark "Breadcrumb" of up to five segments separated by a 12 px chevron. Ancestors are links in
 * `text/secondary`; the last segment is the current page and is not a link. Segments that do not fit collapse into a "…"
 * menu; on compact form factors only the parent is shown, as a back control.
 */
export function Breadcrumb(props: { segments: Crumb[] }) {
  const theme = useTheme();
  const segments = props.segments.slice(-BREADCRUMB.maxSegments);
  const [available, setAvailable] = useState<number | null>(null);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const more = useRef<View>(null);
  const last = segments.length - 1;
  const chevron = <Icon name={theme.rtl ? "chev-l" : "chev-r"} size={12} color="text/secondary" />;

  if (theme.compact) {
    const parent = segments[last - 1];
    if (!parent) return null;
    return (
      <View role="navigation" aria-label={theme.t("breadcrumb")} accessibilityLabel={theme.t("breadcrumb")}>
        <Tap role="link" label={`${theme.t("back")}, ${parent.label}`} onPress={parent.onPress} style={{ flexDirection: "row", alignItems: "center", gap: space[1], minHeight: control.touch, borderRadius: radius.sm }}>
          <Icon name={theme.rtl ? "chev-r" : "chev-l"} size={16} color="text/secondary" />
          <Text color="text/secondary" numberOfLines={1}>{truncateMiddle(parent.label, BREADCRUMB.maxChars)}</Text>
        </Tap>
      </View>
    );
  }
  const measured = segments.every((segment) => widths[segment.id] !== undefined);
  const shape = available !== null && measured
    ? collapseBreadcrumb(segments.map((segment) => widths[segment.id]!), available, { separator: BREADCRUMB.chevron + 2 * space[1], ellipsis: control.xs })
    : { visible: segments.map((_, index) => index), hidden: [] as number[] };
  const segment = (crumb: Crumb, index: number) => {
    const current = index === last;
    const text = truncateMiddle(crumb.label, BREADCRUMB.maxChars);
    if (editing === crumb.id) {
      return (
        <TextInput key={crumb.id} autoFocus selectTextOnFocus accessibilityLabel={theme.t("rename")} aria-label={theme.t("rename")} value={draft} onChangeText={setDraft}
          onBlur={() => { if (draft.trim() && draft !== crumb.label) crumb.onRename?.(draft.trim()); setEditing(null); }}
          {...({ "data-escape": "", onKeyPress: (event: KeyEvent) => { const key = keyOf(event); if (key.key === "Enter") { key.preventDefault(); (event as unknown as { target: { blur(): void } }).target.blur(); } if (key.key === "Escape") { key.preventDefault(); setDraft(crumb.label); setEditing(null); } } } as object)}
          style={[theme.type("body"), { height: control.xs, paddingHorizontal: space[1.5], borderRadius: radius.sm, borderWidth: borderWidth.focus, borderColor: theme.color("accent"), color: theme.color("text/primary"), backgroundColor: theme.color("bg/app"), outlineWidth: 0 }]} />
      );
    }
    const content = (underline: boolean) => (
      <>
        {crumb.icon ? <Icon name={crumb.icon} size={14} color={current ? "text/primary" : "text/secondary"} /> : null}
        <Text color={current ? "text/primary" : "text/secondary"} numberOfLines={1} underline={underline || (!current && theme.underlineLinks)}>{text}</Text>
      </>
    );
    return (
      <View key={crumb.id} role="listitem" ref={crumb.onNode} onLayout={(event) => { const width = event.nativeEvent.layout.width; setWidths((all) => (all[crumb.id] === width ? all : { ...all, [crumb.id]: width })); }}>
        {current ? (
          // The current page is not a link; an editable one becomes a rename field on activation.
          crumb.onRename
            ? <Tap role="button" label={`${theme.t("rename")}: ${crumb.label}`} current="page" tooltip={text === crumb.label ? undefined : { label: crumb.label }} onPress={() => { setDraft(crumb.label); setEditing(crumb.id); }} style={{ flexDirection: "row", alignItems: "center", gap: space[1], borderRadius: radius.xs }}>{content(false)}</Tap>
            : <View accessible aria-current="page" accessibilityLabel={crumb.label} style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}>{content(false)}</View>
        ) : (
          <Tap role="link" label={crumb.label} onPress={crumb.onPress} tooltip={text === crumb.label ? undefined : { label: crumb.label }} style={{ flexDirection: "row", alignItems: "center", gap: space[1], borderRadius: radius.xs }}>
            {(state) => content(state.hovered || state.focused)}
          </Tap>
        )}
      </View>
    );
  };
  const parts: ReactNode[] = [];
  shape.visible.forEach((index, at) => {
    if (at > 0) parts.push(<View key={`sep-${index}`} aria-hidden>{chevron}</View>);
    if (at === 1 && shape.hidden.length > 0) {
      parts.push(<IconButton key="more" ref={more} icon="more" size="xs" compactVisual label={theme.t("hiddenSegments")} expanded={menu} onPress={() => setMenu(true)} />);
      parts.push(<View key="sep-more" aria-hidden>{chevron}</View>);
    }
    parts.push(segment(segments[index]!, index));
  });
  return (
    <View role="navigation" aria-label={theme.t("breadcrumb")} accessibilityLabel={theme.t("breadcrumb")} onLayout={(event) => setAvailable(event.nativeEvent.layout.width)} style={{ flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
      <View role="list" style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}>{parts}</View>
      {/* Hidden segments are measured off-screen so that they can return when the bar widens. */}
      <View aria-hidden pointerEvents="none" style={{ position: "absolute", opacity: 0, flexDirection: "row" }}>{shape.hidden.map((index) => segment(segments[index]!, index))}</View>
      <Menu open={menu} anchor={more} label={theme.t("hiddenSegments")} onClose={() => setMenu(false)}
        items={shape.hidden.map((index) => ({ id: segments[index]!.id, label: segments[index]!.label, icon: segments[index]!.icon, onSelect: segments[index]!.onPress }))} />
    </View>
  );
}
