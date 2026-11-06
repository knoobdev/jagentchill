import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { View } from "react-native";
import { Icon, type IconName } from "./Icon.tsx";
import { Button, type ButtonKind, type ButtonSize } from "./button.tsx";
import { ShortcutText } from "./kbd.tsx";
import { moveIndex, typeAhead, typeAheadBuffer } from "./logic/lists.ts";
import { headingToward, type Rect, type Side } from "./logic/position.ts";
import { commitNow, focusElement } from "./platform/dom";
import type { KeyInfo } from "./platform/types.ts";
import { Popover } from "./overlay.tsx";
import { Tap } from "./tap.tsx";
import { Text } from "./text.tsx";
import { useHostGate, useTheme } from "./theme.tsx";
import { Switch } from "./toggles.tsx";
import { borderWidth, densityDefaults, opacity, radius, size, space } from "./tokens.ts";

export type MenuItem =
  | { type: "separator" }
  | { type: "caption"; label: string }
  | {
    type?: "item"; id: string; label: string; icon?: IconName; description?: string;
    /** Action id whose current binding is shown as the trailing hint; nothing is shown when it is unbound. */
    shortcut?: string; keys?: readonly string[];
    /** A check mark for a selected item; with `switch` the row carries a switch and the menu stays open. */
    checked?: boolean; switch?: boolean; danger?: boolean; disabled?: boolean; requiresHost?: boolean;
    onSelect?(): void; submenu?: MenuItem[];
    /** Called while the row is hovered or focused; `onPreviewEnd` discards the effect unless the item is committed. */
    onPreview?(): void; onPreviewEnd?(): void;
  };
type Row = Extract<MenuItem, { id: string }>;
const isRow = (item: MenuItem): item is Row => "id" in item;
export const SUBMENU_DELAY = 150;

export function MenuSeparator() {
  const theme = useTheme();
  return <View role="separator" style={{ height: borderWidth.hairline, backgroundColor: theme.color("border/hairline"), marginVertical: size.menuSeparatorMargin }} />;
}
export function MenuCaption(props: { label: string }) {
  return <View style={{ paddingTop: space[1.5], paddingBottom: space[0.5], paddingHorizontal: space[2] }}><Text variant="caption" color="text/secondary">{props.label}</Text></View>;
}

/**
 * The rows of a menu with its keyboard model: Down/Up move with wrap, Home/End jump, typing focuses the next match, Enter
 * or Space activates, Right or Enter opens a submenu and Left closes it, Tab closes every level.
 */
export function MenuList(props: {
  items: MenuItem[]; onClose(): void; onCloseAll(): void; onBack?(): void; autoFocus?: boolean; label?: string;
  /** Given by `Menu`: takes the whole menu out of the tree, then closes it and runs the row's action. */
  commit?(action: () => void): void;
  /** Given by `Menu`: called when this list is in the tree; the function returned, when it has left it. */
  track?(): () => void;
}) {
  const theme = useTheme();
  const gate = useHostGate();
  const rows = props.items.filter(isRow);
  const [focused, setFocused] = useState(props.autoFocus === false ? -1 : 0);
  const [open, setOpen] = useState<string | null>(null);
  const [page, setPage] = useState<Row | null>(null);
  const refs = useRef(new Map<string, View | null>());
  const anchors = useRef(new Map<string, RefObject<View | null>>());
  const hover = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const previous = useRef<{ x: number; y: number } | null>(null);
  const submenuRect = useRef<Rect | null>(null);
  const previewing = useRef<Row | null>(null);
  const buffer = useRef(typeAheadBuffer()).current;
  const height = densityDefaults[theme.density].row;

  const endPreview = () => { previewing.current?.onPreviewEnd?.(); previewing.current = null; };
  const preview = (row: Row) => { if (previewing.current === row) return; endPreview(); if (row.onPreview) { previewing.current = row; row.onPreview(); } };
  // The list of a submenu is in an overlay layer of its own: the menu knows from each list when it is really gone.
  useEffect(() => props.track?.(), []); // eslint-disable-line react-hooks/exhaustive-deps
  // Leaving the menu without committing discards a hover preview.
  useEffect(() => () => { previewing.current?.onPreviewEnd?.(); if (hover.current) clearTimeout(hover.current); }, []);
  useEffect(() => { const row = rows[focused]; if (row) focusElement(refs.current.get(row.id)); }, [focused, rows.length, page]); // eslint-disable-line react-hooks/exhaustive-deps

  const anchorOf = (id: string) => { let ref = anchors.current.get(id); if (!ref) { ref = { current: null }; anchors.current.set(id, ref); } return ref; };
  const openSubmenu = (row: Row) => { if (theme.compact) setPage(row); else setOpen(row.id); };
  const activate = (row: Row) => {
    if (row.disabled) return;
    if (row.requiresHost && !gate.connected) { props.onCloseAll(); gate.onRequiresHost(row.label); return; }
    if (row.submenu) { openSubmenu(row); return; }
    // Committing keeps the previewed effect.
    previewing.current = null;
    // A switch row keeps the menu open. Any other row's action may navigate or open another surface, so inside a
    // `Menu` it runs only once the menu and its scrim have left the tree.
    if (props.commit && !row.switch) { props.commit(() => row.onSelect?.()); return; }
    row.onSelect?.();
    if (!row.switch) props.onCloseAll();
  };
  const onKey = (key: KeyInfo, index: number) => {
    const row = rows[index]!;
    const forward = theme.rtl ? "ArrowLeft" : "ArrowRight", backward = theme.rtl ? "ArrowRight" : "ArrowLeft";
    if (key.key === "Tab") { key.preventDefault(); props.onCloseAll(); return; }
    if (key.key === "Enter" || key.key === " ") { key.preventDefault(); activate(row); return; }
    if (key.key === forward && row.submenu && !row.disabled) { key.preventDefault(); openSubmenu(row); return; }
    if (key.key === backward && props.onBack) { key.preventDefault(); props.onBack(); return; }
    const next = moveIndex(index, key.key, rows.length, { wrap: true });
    if (next !== null) { key.preventDefault(); setFocused(next); preview(rows[next]!); return; }
    if (key.key.length === 1 && !key.ctrl && !key.meta && !key.alt) {
      const match = typeAhead(rows.map((item) => item.label), buffer.push(key.key), index);
      if (match !== null) setFocused(match);
    }
  };
  if (page) {
    return (
      <View>
        <Tap role="button" label={theme.t("back")} onPress={() => setPage(null)} style={{ height, flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[2] }}>
          <Icon name={theme.rtl ? "chev-r" : "chev-l"} size={16} color="text/secondary" /><Text variant="body-medium">{page.label}</Text>
        </Tap>
        <MenuSeparator />
        <MenuList items={page.submenu!} onClose={() => setPage(null)} onCloseAll={props.onCloseAll} commit={props.commit} track={props.track} onBack={() => setPage(null)} />
      </View>
    );
  }
  let index = -1;
  return (
    <View role="menu" aria-label={props.label} accessibilityLabel={props.label}
      {...({ onPointerMove: (event: { nativeEvent: { pageX: number; pageY: number } }) => { previous.current = pointer.current; pointer.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY }; } } as object)}>
      {props.items.map((item, at) => {
        if (!isRow(item)) return item.type === "separator" ? <MenuSeparator key={at} /> : <MenuCaption key={at} label={item.label} />;
        const mine = ++index;
        const gated = Boolean(item.requiresHost) && !gate.connected;
        const fg = item.danger ? "danger/text" : "text/primary";
        const anchor = anchorOf(item.id);
        return (
          <View key={item.id}>
            <Tap ref={(node) => { refs.current.set(item.id, node); anchor.current = node; }} testID={`menu-${item.id}`}
              role={item.switch ? "menuitemcheckbox" : item.checked !== undefined ? "menuitemradio" : "menuitem"} label={item.disabled ? `${item.label}, ${theme.t("unavailable")}` : item.label}
              requiresHost={item.requiresHost} checked={item.checked} expanded={item.submenu ? open === item.id : undefined} hideBadge
              // A disabled row stays focusable by arrow keys and is announced as unavailable.
              aria={{ "aria-disabled": item.disabled || undefined, "aria-haspopup": item.submenu ? "menu" : undefined }}
              tabIndex={mine === focused ? 0 : -1} noRing onPress={() => activate(item)} onKeyDown={(key) => onKey(key, mine)}
              onFocus={() => { if (focused !== mine) setFocused(mine); }}
              onHoverIn={() => {
                // While the pointer heads diagonally toward the open submenu, the row under it does not take over.
                if (open && open !== item.id && previous.current && pointer.current && submenuRect.current && headingToward(previous.current, pointer.current, submenuRect.current)) return;
                setFocused(mine); preview(item);
                if (hover.current) clearTimeout(hover.current);
                if (theme.touch) return;
                hover.current = setTimeout(() => setOpen(item.submenu && !item.disabled ? item.id : null), SUBMENU_DELAY);
              }}
              onHoverOut={() => { if (previewing.current === item) endPreview(); }}
              style={(state) => ({
                height, minHeight: item.description ? size.tableRow : undefined, paddingHorizontal: theme.touch ? space[4] : space[2], borderRadius: radius.sm, flexDirection: "row", alignItems: "center", gap: theme.touch ? space[3] : space[2],
                backgroundColor: state.hovered || state.pressed || mine === focused || open === item.id ? theme.color("bg/hover") : "transparent", opacity: item.disabled ? opacity.disabled : 1,
              })}>
              {item.icon ? <Icon name={item.icon} size={16} color={item.danger ? "danger" : "text/secondary"} /> : null}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text color={fg} numberOfLines={1}>{item.label}</Text>
                {item.description ? <Text variant="meta" color="text/secondary" numberOfLines={1}>{item.description}</Text> : null}
              </View>
              {gated ? <Icon name="link" size={12} color="text/secondary" /> : null}
              {item.switch ? <Switch value={Boolean(item.checked)} onChange={() => activate(item)} label={item.label} decorative />
                : item.submenu ? <Icon name={theme.rtl ? "chev-l" : "chev-r"} size={14} color="text/secondary" />
                : item.checked ? <Icon name="check" size={14} color="text/secondary" />
                : <ShortcutText action={item.shortcut} keys={item.keys} />}
            </Tap>
            {item.submenu && open === item.id ? (
              <Popover open anchor={anchor} side="end" align="start" role="menu" label={item.label} neverSheet scrim="none" initialFocus='[tabindex="0"]' onClose={() => setOpen(null)}
                onRequestClose={(reason) => { setOpen(null); if (reason === "scrim") props.onCloseAll(); else setFocused(mine); }}>
                <View onLayout={(event) => { const layoutRect = event.nativeEvent.layout; anchor.current?.measureInWindow((x, y, width) => { submenuRect.current = { x: x + width, y, width: layoutRect.width, height: layoutRect.height }; }); }}>
                  <MenuList items={item.submenu} onClose={() => setOpen(null)} onCloseAll={props.onCloseAll} commit={props.commit} track={props.track} onBack={() => { setOpen(null); setFocused(mine); focusElement(refs.current.get(item.id)); }} />
                </View>
              </Popover>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

export type MenuProps = { open: boolean; onClose(): void; anchor: RefObject<View | null> | Rect; items: MenuItem[]; label?: string; title?: string; wide?: boolean; side?: Side; align?: "start" | "end"; matchAnchor?: boolean };
/** A dropdown menu: a popover on medium and wide form factors (44 px rows at compact-touch density), a bottom sheet on compact ones. */
export function Menu(props: MenuProps) {
  // Choosing a row takes the menu out of the tree without its exit animation, and only then closes it and runs the row's
  // action. The action may navigate at once: the screen that owns the menu is then put away before a 120 ms exit could
  // finish, and the scrim would stay over the screen the person came to. Escape and an outside press still close with
  // the exit animation.
  const [gone, setGone] = useState(false);
  const close = useRef(props.onClose);
  close.current = props.onClose;
  // The lists of the menu that are in the tree (the root's and one per open submenu), and the action that waits for them to leave.
  const lists = useRef(0), waiting = useRef<(() => void) | null>(null);
  const finish = (action: () => void) => {
    close.current();
    action();
    // Batched with the owner's own update: the menu is back in the tree closed, or open again if the action reopened it.
    setGone(false);
  };
  const track = () => {
    lists.current += 1;
    return () => {
      lists.current -= 1;
      // Native: the last list has left the tree, its layer and scrim with it.
      if (lists.current === 0 && waiting.current) { const action = waiting.current; waiting.current = null; finish(action); }
    };
  };
  const commit = (action: () => void) => {
    if (waiting.current) return;
    // The web applies the removal before going on (submenus are layers of their own: all of them are out by then).
    if (commitNow(() => setGone(true))) { finish(action); return; }
    // React Native only queues it: the action runs when every list of the menu has reported that it is gone.
    waiting.current = action;
  };
  if (gone) return null;
  return (
    <Popover open={props.open} onClose={props.onClose} anchor={props.anchor} role="menu" label={props.label} title={props.title} wide={props.wide} side={props.side} align={props.align} matchAnchor={props.matchAnchor} initialFocus='[tabindex="0"]'>
      <MenuList items={props.items} onClose={props.onClose} onCloseAll={props.onClose} label={props.label} commit={commit} track={track} />
    </Popover>
  );
}

/** Opens a menu at the pointer on right-click, at the element on the Menu key or Shift+F10, and on a 500 ms long-press on touch. */
export function ContextMenu(props: { items: MenuItem[]; label?: string; children: ReactNode; disabled?: boolean; onLongPress?(): void }) {
  const [at, setAt] = useState<Rect | null>(null);
  const ref = useRef<View>(null);
  const openAtElement = () => ref.current?.measureInWindow((x, y, _width, height) => setAt({ x, y: y + height, width: 0, height: 0 }));
  return (
    <Tap ref={ref} focusable={false} noRing disabled={props.disabled} style={{ opacity: 1 }}
      onContextMenu={(point) => setAt({ x: point.x, y: point.y, width: 0, height: 0 })} onLongPress={props.onLongPress ?? openAtElement}
      onKeyDown={(key) => { if (key.key === "ContextMenu" || (key.key === "F10" && key.shift)) { key.preventDefault(); openAtElement(); } }}>
      {props.children}
      {at ? <Menu open anchor={at} items={props.items} label={props.label} onClose={() => setAt(null)} /> : null}
    </Tap>
  );
}

/** A button that opens a menu below itself. */
export function MenuButton(props: { label: string; items: MenuItem[]; kind?: ButtonKind; size?: ButtonSize; icon?: IconName; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<View>(null);
  return (
    <>
      <Button ref={ref} label={props.label} kind={props.kind} size={props.size} icon={props.icon} trailingIcon="chev-d" disabled={props.disabled} expanded={open} onPress={() => setOpen(true)} />
      <Menu open={open} anchor={ref} items={props.items} label={props.label} onClose={() => setOpen(false)} />
    </>
  );
}

/** A main action paired with a 24 px chevron segment that opens a menu, separated by a 1 px divider. */
export function SplitButton(props: { label: string; onPress(): void; items: MenuItem[]; menuLabel: string; kind?: ButtonKind; size?: ButtonSize; icon?: IconName; disabled?: boolean; loading?: boolean; testID?: string }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<View>(null);
  const kind = props.kind ?? "primary";
  const flat = { borderTopEndRadius: 0, borderBottomEndRadius: 0 }, flatStart = { borderTopStartRadius: 0, borderBottomStartRadius: 0, paddingHorizontal: 0, width: size.splitSegment };
  return (
    <View ref={ref} style={{ flexDirection: "row", flexShrink: 0 }}>
      <Button label={props.label} kind={kind} size={props.size} icon={props.icon} disabled={props.disabled} loading={props.loading} onPress={props.onPress} testID={props.testID} style={flat} />
      <View style={{ width: borderWidth.hairline, backgroundColor: theme.color(kind === "outline" || kind === "ghost" || kind === "secondary" ? "border/control" : "bg/app"), opacity: 0.35 }} />
      <SplitChevron label={props.menuLabel} kind={kind} size={props.size} disabled={props.disabled} expanded={open} onPress={() => setOpen(true)} style={flatStart} />
      <Menu open={open} anchor={ref} items={props.items} label={props.menuLabel} align="end" onClose={() => setOpen(false)} />
    </View>
  );
}
function SplitChevron(props: { label: string; kind: ButtonKind; size?: ButtonSize; disabled?: boolean; expanded: boolean; onPress(): void; style: object }) {
  return <Button label={props.label} iconOnly icon="chev-d" kind={props.kind} size={props.size} disabled={props.disabled} expanded={props.expanded} onPress={props.onPress} style={props.style} />;
}
