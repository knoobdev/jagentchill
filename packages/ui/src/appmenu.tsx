import { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { IconButton } from "./button.tsx";
import { appMenuKeys, mnemonicOf } from "./logic/keys.ts";
import { moveIndex } from "./logic/lists.ts";
import { hasDom, onGlobalKey, onGlobalKeyUp } from "./platform/dom";
import { Menu, type MenuItem } from "./menu.tsx";
import { Tap } from "./tap.tsx";
import { Text } from "./text.tsx";
import { useTheme } from "./theme.tsx";
import { breakpoints, radius, size, space } from "./tokens.ts";

/** A top-level menu of the shared menu model; `&` marks the mnemonic letter: "&File". */
export type AppMenuModel = Array<{ id: string; title: string; items: MenuItem[] }>;
/** The in-window application menu exists only in the desktop app on Windows and Linux: macOS has the system menu bar, browsers and mobile have none. */
export const appMenuShown = (os: string, desktopApp: boolean) => desktopApp && (os === "windows" || os === "linux");

function Title(props: { title: string; underline: boolean }) {
  const { label, index } = mnemonicOf(props.title);
  if (!props.underline || index < 0) return <Text numberOfLines={1}>{label}</Text>;
  return <Text numberOfLines={1}>{label.slice(0, index)}<Text underline>{label[index]}</Text>{label.slice(index + 1)}</Text>;
}

/**
 * The application menu inside the window: a "☰" button whose rows are the menus of the shared model, or — with `expanded`
 * at 1,200 px and above — a horizontal menu bar. F10 opens it; Alt+mnemonic opens a top-level menu; a bare Alt does nothing.
 */
export function AppMenu(props: { model: AppMenuModel; desktopApp: boolean; expanded?: boolean; overlayOpen?: boolean; /** The system whose menu conventions apply, when it is not the one the app runs on (the desktop shell's own checks). */ os?: "windows" | "linux" }) {
  const theme = useTheme();
  const shown = appMenuShown(props.os ?? theme.os, props.desktopApp);
  const [open, setOpen] = useState<number | "root" | null>(null);
  const [mnemonics, setMnemonics] = useState(false);
  const button = useRef<View>(null);
  const bar = useRef(new Map<number, View | null>());
  const keys = useMemo(() => appMenuKeys(props.model.map((menu) => menu.title), theme.os), [props.model, theme.os]);
  const asBar = Boolean(props.expanded) && theme.width >= breakpoints.xl;
  const blocked = useRef(false);
  blocked.current = Boolean(props.overlayOpen) || open !== null;
  useEffect(() => {
    if (!shown || !hasDom) return;
    const offDown = onGlobalKey((key) => {
      if (blocked.current) return false;
      const index = keys.keyDown(key);
      setMnemonics(keys.showMnemonics());
      if (index === null) return false;
      setOpen(key.key === "F10" && !asBar ? "root" : index);
      return true;
    });
    const offUp = onGlobalKeyUp((key) => { keys.keyUp(key); setMnemonics(keys.showMnemonics()); });
    return () => { offDown(); offUp(); };
  }, [shown, keys, asBar]);
  if (!shown) return null;
  const submenus: MenuItem[] = props.model.map((menu) => ({ id: menu.id, label: mnemonicOf(menu.title).label, submenu: menu.items }));
  if (!asBar) {
    const direct = typeof open === "number" ? props.model[open] : null;
    return (
      <>
        <IconButton ref={button} icon="menu" label={theme.t("applicationMenu")} expanded={open !== null} onPress={() => setOpen("root")} />
        <Menu open={open === "root"} anchor={button} items={submenus} label={theme.t("applicationMenu")} onClose={() => setOpen(null)} />
        {direct ? <Menu open anchor={button} items={direct.items} label={mnemonicOf(direct.title).label} onClose={() => setOpen(null)} /> : null}
      </>
    );
  }
  return (
    <View role="menubar" aria-label={theme.t("applicationMenu")} accessibilityLabel={theme.t("applicationMenu")} style={{ flexDirection: "row", alignItems: "center", height: size.menuBar }}>
      {props.model.map((menu, index) => (
        <View key={menu.id}>
          <Tap ref={(node) => { bar.current.set(index, node); }} role="menuitem" label={mnemonicOf(menu.title).label} expanded={open === index} aria={{ "aria-haspopup": "menu" }} tabIndex={index === 0 ? 0 : -1} onPress={() => setOpen(index)}
            onKeyDown={(key) => {
              // Left/Right move between the top-level menus.
              const next = moveIndex(index, key.key, props.model.length, { wrap: true, horizontal: true, rtl: theme.rtl });
              if (next !== null) { key.preventDefault(); (bar.current.get(next) as unknown as { focus?(): void } | null)?.focus?.(); if (open !== null) setOpen(next); }
              if (key.key === "ArrowDown") { key.preventDefault(); setOpen(index); }
            }}
            style={(state) => ({ height: size.menuBar, paddingHorizontal: space[2], borderRadius: radius.sm, justifyContent: "center", backgroundColor: state.hovered || open === index ? theme.color("bg/hover") : "transparent" })}>
            <Title title={menu.title} underline={mnemonics} />
          </Tap>
          <Menu open={open === index} anchor={{ current: bar.current.get(index) ?? null }} items={menu.items} label={mnemonicOf(menu.title).label} onClose={() => setOpen(null)} />
        </View>
      ))}
    </View>
  );
}
