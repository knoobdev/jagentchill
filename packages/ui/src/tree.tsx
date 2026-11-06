import { useMemo, useRef, useState, type ReactNode } from "react";
import { PanResponder, TextInput, View } from "react-native";
import { Icon, type IconName } from "./Icon.tsx";
import { VirtualList } from "./list.tsx";
import { VIRTUALISE, canDrop, flattenTree, selectWith, treeKey, typeAhead, typeAheadBuffer, type TreeNode } from "./logic/lists.ts";
import { focusElement } from "./platform/dom";
import { IconButton } from "./button.tsx";
import { holdDragCursor } from "./draghandle.ts";
import { ContextMenu, Menu, type MenuItem } from "./menu.tsx";
import { Spinner } from "./progress.tsx";
import { Tap, keyOf, type KeyEvent } from "./tap.tsx";
import { Text } from "./text.tsx";
import { useTheme } from "./theme.tsx";
import { borderWidth, densityDefaults, radius, size, space } from "./tokens.ts";

export type { TreeNode };
export type TreeItem = TreeNode & { icon?: IconName; meta?: string; children?: TreeItem[] };
export type TreeProps = {
  label: string; nodes: TreeItem[]; expanded: ReadonlySet<string>; onExpandedChange(expanded: Set<string>): void;
  selected: ReadonlySet<string>; onSelectedChange(selected: Set<string>): void; multiple?: boolean; onOpen?(id: string): void;
  /** Called when a parent whose children are not loaded yet is expanded; an inline spinner row shows until they arrive. */
  onLoadChildren?(id: string): void; loading?: ReadonlySet<string>;
  onRename?(id: string, label: string): void; onMove?(id: string, target: string, position: "inside" | "before" | "after"): void;
  menu?(node: TreeItem): MenuItem[]; height?: number; renaming?: string | null; dropPreview?: { id: string; position: "inside" | "before" | "after" };
};

/**
 * Hierarchical rows of 28 px with 16 px indentation per level. Keyboard follows the WAI-ARIA tree pattern; F2 or a
 * double-click renames in place; nodes move by drag and drop with a 2 px `accent` insertion line or a highlighted target.
 */
export function Tree(props: TreeProps) {
  const theme = useTheme();
  const rows = flattenTree(props.nodes, props.expanded);
  const ids = rows.map((row) => row.node.id);
  const [focused, setFocused] = useState(0);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(props.renaming ?? null);
  const [draft, setDraft] = useState("");
  const [drag, setDrag] = useState<{ id: string; over: string | null; position: "inside" | "before" | "after" } | null>(null);
  const refs = useRef(new Map<string, View | null>());
  const more = useRef(new Map<string, View | null>());
  const [menuFor, setMenuFor] = useState<string | null>(null);
  // Ctrl/Cmd toggles and Shift selects a range: the modifiers of the last pointer press.
  const modifiers = useRef<{ toggle?: boolean; range?: boolean }>({});
  const buffer = useRef(typeAheadBuffer()).current;
  const rowHeight = densityDefaults[theme.density].row;
  const latest = useRef({ props, rows, drag });
  latest.current = { props, rows, drag };
  const preview = props.dropPreview ? { id: "", over: props.dropPreview.id, position: props.dropPreview.position } : drag;

  const focusRow = (index: number) => { setFocused(index); focusElement(refs.current.get(rows[index]!.node.id)); };
  const setExpanded = (id: string, open: boolean) => {
    const next = new Set(props.expanded);
    if (open) next.add(id); else next.delete(id);
    props.onExpandedChange(next);
    const node = rows.find((row) => row.node.id === id)?.node;
    if (open && node?.hasChildren && !node.children?.length) props.onLoadChildren?.(id);
  };
  const select = (id: string, modifiers: { toggle?: boolean; range?: boolean }) => {
    const result = selectWith(ids, props.selected, anchor, id, modifiers, Boolean(props.multiple));
    setAnchor(result.anchor);
    props.onSelectedChange(result.selected);
  };
  const startRename = (id: string) => { if (!props.onRename) return; setDraft(rows.find((row) => row.node.id === id)?.node.label ?? ""); setRenaming(id); };
  const responders = useMemo(() => new Map<string, ReturnType<typeof PanResponder.create>>(), []);
  const carried = useRef<() => void>(() => {});
  const responderFor = (id: string) => {
    let responder = responders.get(id);
    if (!responder) {
      responder = PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) => Boolean(latest.current.props.onMove) && Math.abs(gesture.dy) > 6,
        // A row is pressed like a button; once it is carried the hand closes on it, wherever the pointer goes.
        onPanResponderGrant: () => { carried.current = holdDragCursor("grabbing"); },
        onPanResponderMove: (_event, gesture) => {
          const now = latest.current;
          const from = now.rows.findIndex((row) => row.node.id === id);
          const exact = from + gesture.dy / rowHeight;
          const index = Math.max(0, Math.min(now.rows.length - 1, Math.round(exact)));
          const target = now.rows[index]!;
          const offset = exact - index;
          const position = target.expandable && Math.abs(offset) < 0.25 ? "inside" : offset < 0 ? "before" : "after";
          // A node cannot go onto itself or one of its own descendants: no indicator is shown there.
          setDrag({ id, over: canDrop(now.props.nodes, id, target.node.id) ? target.node.id : null, position });
        },
        onPanResponderRelease: () => { carried.current(); const state = latest.current.drag; setDrag(null); if (state?.over) latest.current.props.onMove?.(state.id, state.over, state.position); },
        onPanResponderTerminate: () => { carried.current(); setDrag(null); },
      });
      responders.set(id, responder);
    }
    return responder;
  };

  const renderRow = (row: (typeof rows)[number], index: number): ReactNode => {
    const { node } = row;
    const item = node as TreeItem;
    const indent = row.depth * size.treeIndent;
    const over = preview?.over === node.id ? preview.position : null;
    const loading = row.expanded && props.loading?.has(node.id);
    return (
      <View key={node.id} {...(props.onMove && !theme.touch ? responderFor(node.id).panHandlers : null)}>
        {over === "before" ? <View testID="drop-line" style={{ height: borderWidth.focus, marginStart: indent + space[2], backgroundColor: theme.color("accent") }} /> : null}
        {renaming === node.id ? (
          <View style={{ height: rowHeight, flexDirection: "row", alignItems: "center", gap: space[2], paddingStart: space[2] + indent + size.treeIndent, paddingEnd: space[2] }}>
            {item.icon ? <Icon name={item.icon} size={14} color="text/secondary" /> : null}
            <TextInput autoFocus selectTextOnFocus accessibilityLabel={theme.t("rename")} aria-label={theme.t("rename")} value={draft} onChangeText={setDraft}
              onBlur={() => { if (renaming === node.id) { if (draft.trim() && draft !== node.label) props.onRename?.(node.id, draft.trim()); setRenaming(null); } }}
              {...({ "data-escape": "", onKeyPress: (event: KeyEvent) => {
                const key = keyOf(event);
                if (key.key === "Enter") { key.preventDefault(); if (draft.trim() && draft !== node.label) props.onRename?.(node.id, draft.trim()); setRenaming(null); focusRow(index); }
                if (key.key === "Escape") { key.preventDefault(); key.stopPropagation?.(); setRenaming(null); focusRow(index); }
              } } as object)}
              style={[theme.type("body"), { flex: 1, height: rowHeight - space[1], paddingHorizontal: space[1.5], borderRadius: radius.sm, borderWidth: borderWidth.focus, borderColor: theme.color("accent"), backgroundColor: theme.color("bg/app"), color: theme.color("text/primary"), outlineWidth: 0 }]} />
          </View>
        ) : (
          <View style={over === "inside" ? { borderRadius: radius.sm, backgroundColor: theme.color("accent/subtle") } : null}>
            <ContextMenu items={props.menu?.(item) ?? []} label={node.label} disabled={!props.menu}>
              <Tap ref={(element) => { refs.current.set(node.id, element); }} role="treeitem" label={item.meta ? `${node.label}, ${item.meta}` : node.label} selected={props.selected.has(node.id)} expanded={row.expandable ? row.expanded : undefined}
                aria={{ "aria-level": row.depth + 1, "aria-selected": props.selected.has(node.id) }} tabIndex={index === focused ? 0 : -1}
                onFocus={() => setFocused(index)} onDoublePress={props.onRename ? () => startRename(node.id) : props.onOpen ? () => props.onOpen!(node.id) : undefined}
                onKeyDown={(key) => {
                  if (key.key === "F2") { key.preventDefault(); startRename(node.id); return; }
                  if (key.key === "Enter") { key.preventDefault(); if (row.expandable) setExpanded(node.id, !row.expanded); else props.onOpen?.(node.id); return; }
                  if (key.key === " ") { key.preventDefault(); select(node.id, { toggle: key.ctrl || key.meta, range: key.shift }); return; }
                  const result = treeKey(rows, index, key.key, theme.rtl);
                  if (result) {
                    key.preventDefault();
                    if (result.collapse) setExpanded(result.collapse, false);
                    if (result.expand?.length) { if (result.expand.length === 1) setExpanded(result.expand[0]!, true); else props.onExpandedChange(new Set([...props.expanded, ...result.expand])); }
                    if (result.focus !== index) focusRow(result.focus);
                    return;
                  }
                  if (key.key.length === 1 && !key.ctrl && !key.meta && !key.alt) { const match = typeAhead(rows.map((entry) => entry.node.label), buffer.push(key.key), index); if (match !== null) focusRow(match); }
                }}
                onPress={() => { setFocused(index); select(node.id, modifiers.current); }}
                style={(state) => ({ height: rowHeight, flexDirection: "row", alignItems: "center", gap: space[1], paddingStart: space[2] + indent, paddingEnd: space[2], borderRadius: radius.sm,
                  backgroundColor: props.selected.has(node.id) ? theme.color("bg/subtle") : state.hovered ? theme.color("bg/hover") : "transparent" })}>
                {(state) => (
                  <>
                    {row.expandable
                      ? <Tap role="button" label={theme.t(row.expanded ? "collapse" : "expand")} focusable={false} onPress={() => setExpanded(node.id, !row.expanded)} style={{ borderRadius: radius.xs }}><Icon name={row.expanded ? "chev-d" : theme.rtl ? "chev-l" : "chev-r"} size={14} color="text/secondary" /></Tap>
                      : <View style={{ width: size.treeIndent - space[0.5] }} />}
                    {item.icon ? <Icon name={item.icon} size={14} color={props.selected.has(node.id) ? "text/primary" : "text/secondary"} /> : null}
                    <Text numberOfLines={1} variant={props.selected.has(node.id) ? "body-medium" : "body"} style={{ flex: 1, marginStart: space[1] }}>{node.label}</Text>
                    {item.meta ? <Text variant="meta" color="text/secondary" tabular>{item.meta}</Text> : null}
                    {props.menu ? (
                      <View style={{ opacity: theme.touch || state.hovered || state.focused || menuFor === node.id ? 1 : 0 }}>
                        <IconButton ref={(element) => { more.current.set(node.id, element); }} icon="more" size="xs" compactVisual label={theme.t("moreActions")} onPress={() => setMenuFor(node.id)} />
                      </View>
                    ) : null}
                  </>
                )}
              </Tap>
              {props.menu && menuFor === node.id ? <Menu open anchor={{ current: more.current.get(node.id) ?? null }} items={props.menu(item)} label={node.label} onClose={() => setMenuFor(null)} /> : null}
            </ContextMenu>
          </View>
        )}
        {over === "after" ? <View testID="drop-line" style={{ height: borderWidth.focus, marginStart: indent + space[2], backgroundColor: theme.color("accent") }} /> : null}
        {loading ? (
          <View style={{ height: rowHeight, flexDirection: "row", alignItems: "center", gap: space[2], paddingStart: space[2] + indent + 2 * size.treeIndent }}>
            <Spinner size={12} /><Text color="text/secondary">{theme.t("loading")}</Text>
          </View>
        ) : null}
      </View>
    );
  };
  const virtual = rows.length > VIRTUALISE.tree;
  return (
    <View role={"tree" as "list"} aria-label={props.label} accessibilityLabel={props.label} aria-multiselectable={props.multiple || undefined}
      {...({ onPointerDownCapture: (event: { nativeEvent: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } }) => { modifiers.current = { toggle: Boolean(event.nativeEvent.ctrlKey || event.nativeEvent.metaKey), range: Boolean(event.nativeEvent.shiftKey) }; } } as object)}>
      {virtual
        ? <VirtualList items={rows} rowHeight={rowHeight} height={props.height ?? rowHeight * 16} threshold={VIRTUALISE.tree} keyOf={(row) => row.node.id} render={renderRow} />
        : rows.map(renderRow)}
    </View>
  );
}
