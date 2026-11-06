// The menu on React Native: `commitNow` of `src/platform/dom.ts` (the native file) only queues the removal, so the row's
// action has to wait until the menu's lists have really left the tree. The components run on react-native-web in jsdom,
// as in the other component tests, with that ONE function taken from the native platform file (the rest of that file
// needs the native runtime).
import { View } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, test, vi } from "vitest";

vi.mock("expo-clipboard", () => ({}));
vi.mock("../src/platform/dom", async (original) => {
  const web = await original<Record<string, unknown>>();
  // The real native implementation, read from the native file itself.
  const native = await vi.importActual<{ commitNow(update: () => void): boolean }>("../src/platform/dom.ts");
  return { ...web, commitNow: native.commitNow };
});
const { Button, ConfirmDialog, Menu, ThemeProvider } = await import("../src/index.ts");

const tick = (ms = 0) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const key = (element: Element, name: string) => fireEvent.keyDown(element, { key: name, bubbles: true });

test("Native: a menu row's action runs only after the menu and its scrim have left the tree, from the root list and from a submenu", async () => {
  const seen: Array<{ scrim: boolean; menu: boolean; closed: boolean }> = [];
  let closed = false;
  function Host() {
    const [open, setOpen] = useState(false);
    const [dialog, setDialog] = useState(false);
    const look = () => seen.push({ scrim: Boolean(document.querySelector('[data-testid="scrim"]')), menu: Boolean(document.querySelector('[role="menu"]')), closed });
    return (
      <View>
        <Button label="Actions" onPress={() => setOpen(true)} />
        <Menu open={open} anchor={{ x: 10, y: 10, width: 10, height: 10 }} label="Actions" onClose={() => { closed = true; setOpen(false); }}
          items={[{ id: "open", label: "Open", onSelect: look }, { id: "delete", label: "Delete", onSelect: () => { look(); setDialog(true); } }, { id: "more", label: "More", submenu: [{ id: "deep", label: "Deep", onSelect: look }] }]} />
        <ConfirmDialog open={dialog} title="Delete project?" confirmLabel="Delete" onConfirm={() => {}} onClose={() => setDialog(false)} />
      </View>
    );
  }
  render(<ThemeProvider scheme="light" viewport={{ width: 1280, height: 800 }} density="regular" os="mac"><Host /></ThemeProvider>);
  const opener = screen.getByRole("button", { name: "Actions" });
  const show = async () => { closed = false; fireEvent.click(opener); await tick(40); expect(screen.getByTestId("scrim")).toBeTruthy(); };
  await show();
  fireEvent.click(screen.getByRole("menuitem", { name: "Open" }));
  await tick();
  expect(seen).toEqual([{ scrim: false, menu: false, closed: true }]);
  // From a submenu, whose list is in a layer of its own that leaves one commit later.
  await show();
  const more = screen.getByRole("menuitem", { name: "More" });
  more.focus(); key(more, "ArrowRight");
  await tick(20);
  key(screen.getByRole("menuitem", { name: "Deep" }), "Enter");
  await tick();
  expect(seen[1]).toEqual({ scrim: false, menu: false, closed: true });
  // The menu opens again, and a row that opens a dialog gets it as the only surface.
  await show();
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
  await tick(40);
  expect(seen[2]).toEqual({ scrim: false, menu: false, closed: true });
  expect(screen.getByRole("dialog", { name: "Delete project?" })).toBeTruthy();
  expect(screen.queryByRole("menu")).toBeNull();
  expect(screen.getAllByTestId("scrim").length).toBe(1);
});
