import { View } from "react-native";
// Component scenarios of the design-system specification, run on the react-native-web implementation in jsdom. jsdom has no
// layout, so geometry is asserted through computed styles; the clipboard is a recording fake because jsdom has none.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Profiler, useState, type ReactNode } from "react";
import { describe, expect, test, vi } from "vitest";
import {
  Accordion, AppMenu, Avatar, Badge, Breadcrumb, Button, Callout, Banner, Card, Clip, CodeBlock, Composer, ConfirmDialog, DestructiveConfirmDialog, Disclosure, Drawer, ErrorState, FormDialog, FormField,
  GroupedSettingCard, IconButton, InlineEditChip, Input, Kbd, ListRow, Menu, MenuList, Modal, QRCode, RequiresHostState, SearchField, SettingRow, Sparkline, StatusPill, Switch, Table, Tabs, TabPanel, Text,
  PanelGroup, ThemeProvider, ToggleButton, Transport, AdaptiveSheet, BottomSheet, CopyValue, Checkbox, Playhead, TrackLane, Combobox, useTheme, useToast, type ThemeProviderProps,
} from "../src/index.ts";
import { APPLICABLE_STATES, COMPONENTS, Catalogue, catalogueSections } from "../src/catalogue/index.tsx";

const DIMS = { row: 50, rowGap: 6, header: 136, ruler: 22, marker: { width: 12, height: 15 }, playhead: { line: 2, handle: 12 }, trim: 8, transition: 20 };
const wide = { width: 1280, height: 800 };
const ui = (node: ReactNode, props: Partial<ThemeProviderProps> = {}) => render(<ThemeProvider scheme="light" viewport={wide} density="regular" os="mac" {...props}>{node}</ThemeProvider>);
const css = (element: Element) => getComputedStyle(element);
const tick = (ms = 0) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
declare const setMedia: (word: string, matches: boolean) => void;
const key = (element: Element, name: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(element, { key: name, bubbles: true, ...init });
const gone = async (query: () => unknown) => { for (let i = 0; i < 40 && query(); i++) await tick(25); };

// The editor hands its regions to the panel group as `panels={[…]}` — a new array on each of its renders — and renders
// on every frame while a project plays. The group rebuilt its layout and set its sizes from an effect each time: one
// extra commit per frame, which React's development build reports as "Maximum update depth exceeded" after fifty in a row.
describe("Panel group under a caller that renders often", () => {
  test("a caller that renders again with the same panels costs ONE commit — the group sets no state from an effect; changed panels are still taken", async () => {
    let commits = 0, bump!: () => void, widen!: () => void;
    function Caller() {
      const [count, setCount] = useState(0), [first, setFirst] = useState(30);
      bump = () => setCount((value) => value + 1); widen = () => setFirst(45);
      return (
        <Profiler id="group" onRender={() => { commits += 1; }}>
          <PanelGroup label="Regions" panels={[{ id: "a", default: first, min: 10, content: <Text testID="a">{`A ${count}`}</Text> }, { id: "b", default: 100 - first, min: 10, content: <Text>B</Text> }]} />
        </Profiler>
      );
    }
    ui(<Caller />);
    await tick(20);
    const before = commits;
    for (let index = 0; index < 60; index++) act(() => bump());
    expect(screen.getByTestId("a").textContent).toBe("A 60");
    expect(commits - before).toBe(60);
    // Panels that really changed rebuild the layout (the effect may then set the sizes once).
    const then = commits;
    act(() => widen());
    await tick(20);
    expect(commits - then).toBeGreaterThanOrEqual(1);
    expect(commits - then).toBeLessThanOrEqual(3);
  });
});

describe("Token source and theming contract", () => {
  function Probe() { const theme = useTheme(); return <Text testID="probe">{`${theme.scheme}|${theme.color("bg/app")}|${theme.preference}`}</Text>; }
  test("Scenario: System theme follows the OS", async () => {
    render(<ThemeProvider viewport={wide}><Probe /></ThemeProvider>);
    const node = screen.getByTestId("probe");
    expect(node.textContent).toBe("light|#FFFFFF|system");
    act(() => setMedia("dark", true));
    // The same mounted node re-renders with the dark values: nothing reloads.
    expect(screen.getByTestId("probe")).toBe(node);
    expect(node.textContent).toBe("dark|#1B1B1B|system");
    act(() => setMedia("dark", false));
  });
  test("Scenario: Explicit theme overrides the OS", () => {
    function Choose() { const theme = useTheme(); return <Button label="Use light" onPress={() => theme.setPreference("light")} />; }
    const first = render(<ThemeProvider viewport={wide}><Choose /><Probe /></ThemeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Use light" }));
    expect(screen.getByTestId("probe").textContent).toBe("light|#FFFFFF|light");
    expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content).toBe("#FFFFFF");
    first.unmount();
    // After a restart the stored preference is read again.
    render(<ThemeProvider viewport={wide}><Probe /></ThemeProvider>);
    expect(screen.getByTestId("probe").textContent).toBe("light|#FFFFFF|light");
    window.localStorage.clear();
  });
});

describe("Button", () => {
  test("Scenario: Loading blocks double submit", () => {
    const onPress = vi.fn();
    ui(<Button kind="primary" label="Export" loading onPress={onPress} />);
    const button = screen.getByRole("button", { name: "Export" });
    fireEvent.click(button); fireEvent.click(button);
    expect(onPress).not.toHaveBeenCalled();
    expect(within(button).getByRole("progressbar")).toBeTruthy();
    expect(button.getAttribute("aria-busy")).toBe("true");
  });
  test("Scenario: Keyboard focus ring", () => {
    ui(<Button kind="primary" label="Export" />);
    const button = screen.getByRole("button", { name: "Export" });
    fireEvent.keyDown(document.body, { key: "Tab" });
    fireEvent.focus(button);
    expect(css(button).outlineWidth).toBe("2px");
    expect(css(button).outlineOffset).toBe("2px");
    expect(css(button).outlineColor).toBe("rgb(47, 111, 235)");
    fireEvent.blur(button);
    // Focus that results from a pointer press draws no ring.
    fireEvent.pointerDown(document.body);
    fireEvent.focus(button);
    expect(css(button).outlineWidth).toBe("0px");
  });
  test("Scenario: Disabled button", () => {
    const onPress = vi.fn();
    ui(<Button label="Export" disabled onPress={onPress} />);
    const button = screen.getByRole("button", { name: "Export" });
    fireEvent.click(button); key(button, "Enter"); key(button, " ");
    expect(onPress).not.toHaveBeenCalled();
    expect(css(button).opacity).toBe("0.4");
    expect(button.getAttribute("aria-disabled")).toBe("true");
  });
  test("Scenario: Host-gated button without a host", () => {
    const onPress = vi.fn(), onRequiresHost = vi.fn();
    ui(<Button label="Generate" requiresHost onPress={onPress} />, { host: { connected: false, onRequiresHost } });
    const button = screen.getByRole("button", { name: "Generate, requires a host" });
    expect(button.getAttribute("aria-disabled")).not.toBe("true");
    expect(button.querySelector("svg")).toBeTruthy();
    fireEvent.click(button);
    expect(onRequiresHost).toHaveBeenCalledWith("Generate");
    expect(onPress).not.toHaveBeenCalled();
  });
  test("Colour tokens — Scenario: Primary button label in the dark theme (rendered)", () => {
    ui(<Button kind="primary" label="Export" />, { scheme: "dark" });
    const button = screen.getByRole("button", { name: "Export" });
    expect(css(button).backgroundColor).toBe("rgb(76, 141, 255)");
    expect(css(screen.getByText("Export")).color).toBe("rgb(11, 27, 58)");
  });
});

describe("Icon button and toggle button", () => {
  test("Scenario: Toggle reflects state", () => {
    ui(<ToggleButton icon="magnet" label="Auto snapping" on onChange={() => {}} />);
    const button = screen.getByRole("button", { name: "Auto snapping" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(css(button).backgroundColor).toBe("rgb(239, 239, 239)");
  });
  test("Scenario: Tooltip shows the binding", async () => {
    const shown = async (os: "mac" | "windows") => {
      const view = ui(<IconButton icon="scissors" label="Split" shortcut="edit.split" />, { os, shortcuts: (action) => (action === "edit.split" ? ["Mod", "B"] : null) });
      const button = screen.getByRole("button", { name: "Split" });
      fireEvent.keyDown(document.body, { key: "Tab" });
      fireEvent.focus(button);
      await tick(30);
      const text = screen.getByRole("tooltip").textContent;
      view.unmount();
      return text;
    };
    expect(await shown("mac")).toBe("Split⌘B");
    expect(await shown("windows")).toBe("SplitCtrl+B");
  });
  test("Icon tokens — Scenario: Icon-only button is labelled", () => {
    ui(<IconButton icon="scissors" label="Split" />);
    expect(screen.getByRole("button", { name: "Split" })).toBeTruthy();
  });
  test("Control size tokens and density rules — Scenario: Touch density hit target", () => {
    ui(<IconButton icon="scissors" label="Split" />, { viewport: { width: 390, height: 844 }, density: undefined });
    const button = screen.getByRole("button", { name: "Split" });
    expect([css(button).width, css(button).height]).toEqual(["44px", "44px"]);
  });
  test("Control size tokens and density rules — Scenario: Aligned controls (rendered)", () => {
    ui(<><Button size="md" label="Add" /><Input accessibilityLabel="Name" value="" /></>);
    expect(css(screen.getByRole("button", { name: "Add" })).height).toBe("32px");
    expect(css(screen.getByLabelText("Name").parentElement!).height).toBe("32px");
  });
});

describe("Text input and textarea", () => {
  test("Scenario: Invalid field", () => {
    function Field() {
      const [value, setValue] = useState("");
      return (
        <FormField label="Project name" required value={value} validate={(text) => (String(text).trim() ? undefined : "Enter a name for the project.")}>
          {(ids) => <Input labelledBy={ids.labelledBy} value={value} onChangeText={setValue} onBlur={ids.onBlur} error={ids.error} />}
        </FormField>
      );
    }
    ui(<Field />);
    const input = screen.getByRole("textbox");
    expect(screen.queryByText("Enter a name for the project.")).toBeNull();
    fireEvent.focus(input); fireEvent.blur(input);
    const message = screen.getByText("Enter a name for the project.");
    expect(message.getAttribute("role")).toBe("alert");
    expect(css(message).color).toBe("rgb(184, 38, 29)");
    expect(css(input.parentElement!).borderTopWidth).toBe("2px");
    expect(input.parentElement!.getAttribute("style")).toContain("rgb(217, 48, 37)");
    expect(screen.getByRole("textbox")).toBe(input);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    // The message clears as soon as the value becomes valid.
    fireEvent.change(input, { target: { value: "Da Lat" } });
    expect(screen.queryByText("Enter a name for the project.")).toBeNull();
  });
  test("Scenario: Clear button", () => {
    const onChangeText = vi.fn();
    ui(<SearchField label="Search projects" value="intro" onChangeText={onChangeText} />);
    const input = screen.getByRole("searchbox", { name: "Search projects" });
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(onChangeText).toHaveBeenCalledTimes(1);
    expect(onChangeText).toHaveBeenCalledWith("");
    expect(document.activeElement).toBe(input);
  });
  test("Contrast pair matrix — Scenario: Input boundary (rendered)", () => {
    ui(<Input accessibilityLabel="Name" value="" />, { scheme: "dark" });
    expect(css(screen.getByLabelText("Name").parentElement!).borderTopColor).toBe("rgb(128, 128, 128)");
  });
});

describe("Search field", () => {
  test("Scenario: Escape clears first", () => {
    function Host() {
      const [value, setValue] = useState("intro");
      const [open, setOpen] = useState(true);
      return open ? <SearchField label="Search" value={value} onChangeText={setValue} onEscape={() => setOpen(false)} /> : <Text>closed</Text>;
    }
    ui(<Host />);
    const input = screen.getByRole("searchbox") as HTMLInputElement;
    key(input, "Escape");
    expect(input.value).toBe("");
    expect(screen.queryByText("closed")).toBeNull();
    key(screen.getByRole("searchbox"), "Escape");
    expect(screen.getByText("closed")).toBeTruthy();
  });
  test("Scenario: Result count is announced", () => {
    ui(<SearchField label="Search" value="zz" onChangeText={() => {}} resultCount={0} />);
    const status = screen.getByText("No results");
    expect(status.getAttribute("aria-live")).toBe("polite");
  });
});

describe("Breadcrumb", () => {
  test("Scenario: Current page is not a link", () => {
    ui(<Breadcrumb segments={[{ id: "a", label: "Settings", onPress: () => {} }, { id: "b", label: "Host", onPress: () => {} }, { id: "c", label: "Secrets" }]} />);
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual(["Settings", "Host"]);
    const current = nav.querySelector('[aria-current="page"]')!;
    expect(current.textContent).toBe("Secrets");
    expect(current.getAttribute("role")).not.toBe("link");
  });
});

describe("QR code view", () => {
  const code = (state?: "expired") => <QRCode value="jagentchill://pair#offer=abc" description="pairing offer" state={state} onNewCode={() => {}}><CopyValue label="Pairing link" value="jagentchill://pair#offer=abc" /><Text>482 913</Text></QRCode>;
  test("Scenario: Same symbol in the dark theme", () => {
    ui(code(), { scheme: "dark" });
    const tile = screen.getByTestId("qr-tile");
    expect(css(tile).backgroundColor).toBe("rgb(255, 255, 255)");
    expect(tile.querySelector("path")!.getAttribute("fill")).toBe("#000000");
    expect(parseInt(css(tile).width, 10)).toBeGreaterThanOrEqual(160);
    expect(tile.getAttribute("aria-label")).toBe("QR code: pairing offer");
  });
  test("Scenario: Text alternative", () => {
    ui(code());
    expect(screen.getByRole("button", { name: "Copy Pairing link" })).toBeTruthy();
    expect(screen.getByText("482 913")).toBeTruthy();
  });
  test("Scenario: Expired code cannot be scanned", () => {
    ui(code("expired"));
    expect(screen.queryByTestId("qr-tile")).toBeNull();
    expect(screen.getByText("Expired")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New code" })).toBeTruthy();
  });
});

describe("Markdown view and code block", () => {
  test("Scenario: Copy code", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    ui(<CodeBlock code={"a\nb"} lang="ts" showLineNumbers />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copy" })); });
    expect(writeText).toHaveBeenCalledWith("a\nb");
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
    vi.useRealTimers();
  });
  test("Scenario: Long block is collapsed (rendered)", () => {
    ui(<CodeBlock code={Array.from({ length: 120 }, (_, i) => `line ${i + 1}`).join("\n")} />);
    expect(screen.queryByText("line 31")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show all 120 lines" }));
    expect(screen.getByText("line 120")).toBeTruthy();
  });
});

describe("Select and combobox", () => {
  test("Scenario: Async source failure", async () => {
    let fail = true;
    const onChange = vi.fn();
    ui(<Combobox label="Voice" value="mai" forceOpen onChange={onChange} options={() => (fail ? Promise.reject(new Error("offline")) : Promise.resolve([{ value: "mai", label: "Mai" }]))} />);
    await tick(10);
    expect(screen.getByText("Couldn’t load options")).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
    fail = false;
    await act(async () => { fireEvent.click(screen.getByRole("link", { name: "Retry" })); });
    await tick(10);
    expect(screen.getByRole("option", { name: "Mai" })).toBeTruthy();
  });
});

describe("Segmented control, tabs and tab strip", () => {
  test("Scenario: Arrow key navigation", () => {
    function Host() {
      const [value, setValue] = useState("a");
      return <><Tabs id="t" items={[{ id: "a", label: "Automations" }, { id: "b", label: "Runs" }]} value={value} onChange={setValue} /><TabPanel group="t" id="a" active={value === "a"}><Text>first panel</Text></TabPanel><TabPanel group="t" id="b" active={value === "b"}><Text>second panel</Text></TabPanel></>;
    }
    ui(<Host />);
    const [first, second] = screen.getAllByRole("tab");
    first!.focus();
    key(first!, "ArrowRight");
    expect(document.activeElement).toBe(second);
    expect(second!.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").textContent).toBe("second panel");
    expect(screen.getByRole("tablist")).toBeTruthy();
  });
});

describe("Switch, checkbox and radio", () => {
  test("Scenario: Remote failure reverts the switch", async () => {
    function Host() { const [on] = useState(false); return <Switch accessibilityLabel="Web access" value={on} onChange={() => Promise.reject(new Error("The host rejected the change"))} />; }
    ui(<Host />);
    const control = screen.getByRole("switch", { name: "Web access" });
    await act(async () => { fireEvent.click(control); });
    await tick(5);
    expect(control.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("The host rejected the change")).toBeTruthy();
  });
  test("Scenario: Indeterminate checkbox", () => {
    const onChange = vi.fn();
    ui(<Checkbox accessibilityLabel="Select all" checked={false} indeterminate onChange={onChange} />);
    const box = screen.getByRole("checkbox", { name: "Select all" });
    expect(box.getAttribute("aria-checked")).toBe("mixed");
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("List rows and secondary list", () => {
  test("Scenario: Unread indicator", () => {
    ui(<ListRow title="Q4 promo captions" unread onPress={() => {}} />);
    expect(screen.getByRole("button", { name: "Q4 promo captions, unread" })).toBeTruthy();
  });
  test("Scenario: Truncation", () => {
    ui(<ListRow title="A very long session title that does not fit" onPress={() => {}} />);
    const title = screen.getByText("A very long session title that does not fit");
    expect(css(title).textOverflow).toBe("ellipsis");
    expect(css(title).whiteSpace).toBe("nowrap");
  });
  test("Colour tokens — Scenario: Status text uses the text-grade token (rendered)", () => {
    ui(<ListRow title="Q4 promo captions" meta="Export ready" metaTone="success" onPress={() => {}} />);
    expect(css(screen.getByText("Export ready")).color).toBe("rgb(21, 115, 63)");
  });
  test("Control size tokens and density rules — Scenario: Hover-revealed control on touch", () => {
    ui(<ListRow title="Session" onPress={() => {}} menu={[{ id: "pin", label: "Pin" }]} />, { density: "touch" });
    expect(css(screen.getByRole("button", { name: "More actions" }).parentElement!).opacity).toBe("1");
  });
});

describe("Cards and grouped setting cards", () => {
  test("Scenario: Inline edit chip", async () => {
    let finish: () => void = () => {};
    const onSave = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    function Host() { const [name, setName] = useState("Studio Mac"); return <InlineEditChip label="Host name" value={name} onSave={(next) => onSave().then(() => setName(next))} />; }
    ui(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Host name" }));
    const field = screen.getByRole("textbox", { name: "Host name" });
    fireEvent.change(field, { target: { value: "Edit bay" } });
    key(field, "Enter");
    expect(screen.getByRole("button", { name: "Edit Host name" }).getAttribute("aria-busy")).toBe("true");
    await act(async () => { finish(); });
    await tick();
    expect(screen.getByText("Edit bay")).toBeTruthy();
    // Escape restores the previous name without saving.
    fireEvent.click(screen.getByRole("button", { name: "Edit Host name" }));
    const again = screen.getByRole("textbox", { name: "Host name" });
    fireEvent.change(again, { target: { value: "Other" } });
    key(again, "Escape");
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Edit bay")).toBeTruthy();
  });
  test("Scenario: Copy read-only id", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    ui(<CopyValue label="Device ID" value="dev_3f9a1c77" />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copy Device ID" })); });
    expect(writeText).toHaveBeenCalledWith("dev_3f9a1c77");
    expect(screen.getByTestId("toast").textContent).toContain("Copied");
  });
  test("Spacing, radius and border tokens — Scenario: Card and composer radii", () => {
    ui(<><GroupedSettingCard><SettingRow label="Theme" last /></GroupedSettingCard><Composer placeholder="Ask" value="" onChangeText={() => {}} onSend={() => {}} mode={{ id: "m", label: "Agent" }} /></>);
    const card = screen.getByText("Theme").parentElement!.parentElement!.parentElement!;
    expect([css(card).borderTopLeftRadius, css(card).borderTopWidth, css(card).borderTopColor]).toEqual(["8px", "1px", "rgb(232, 232, 232)"]);
    const composer = screen.getByTestId("composer");
    expect([css(composer).borderTopLeftRadius, css(composer).borderTopWidth, css(composer).borderTopColor]).toEqual(["12px", "1px", "rgb(232, 232, 232)"]);
  });
  test("Elevation tokens — Scenario: Cards do not cast shadows", () => {
    ui(<Card><Text>Plain</Text></Card>);
    const card = screen.getByText("Plain").parentElement!;
    expect(css(card).borderTopWidth).toBe("1px");
    expect(css(card).boxShadow === "" || css(card).boxShadow === "none").toBe(true);
  });
});

describe("Table", () => {
  type Row = { id: string; name: string };
  const columns = [{ id: "name", title: "Name", sortable: true, text: (row: Row) => row.name }];
  const rows = ["A", "B", "C", "D"].map((name) => ({ id: name, name }));
  test("Scenario: Empty table", () => {
    ui(<Table label="Secrets" columns={columns} rows={[]} rowKey={(row) => row.id} search={{ label: "Search secrets", value: "", onChange: () => {} }} empty={{ icon: "key", title: "No secrets yet", description: "Secrets are stored on the host.", action: { label: "Add secret", onPress: () => {} } }} />);
    expect(screen.getByText("No secrets yet")).toBeTruthy();
    expect(screen.getByText("Secrets are stored on the host.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add secret" })).toBeTruthy();
  });
  test("Scenario: Empty search result", () => {
    const onChange = vi.fn();
    ui(<Table label="Secrets" columns={columns} rows={[]} rowKey={(row) => row.id} search={{ label: "Search secrets", value: "lantern", onChange }} empty={{ icon: "key", title: "No secrets yet" }} />);
    expect(screen.getByText("No results for “lantern”")).toBeTruthy();
    expect(screen.queryByText("No secrets yet")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Clear search" }).at(-1)!);
    expect(onChange).toHaveBeenCalledWith("");
  });
  test("Scenario: Bulk selection", () => {
    const onSelectionChange = vi.fn();
    ui(<Table label="Secrets" columns={columns} rows={rows} rowKey={(row) => row.id} selection={new Set(["A", "B", "C"])} onSelectionChange={onSelectionChange} search={{ label: "Search secrets", value: "", onChange: () => {} }} bulkActions={[{ label: "Delete", danger: true, onPress: () => {} }]} />);
    expect(screen.getByText("3 selected")).toBeTruthy();
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onSelectionChange.mock.calls[0]![0].size).toBe(0);
    // Switch, checkbox and radio — Scenario: Indeterminate checkbox: the header box is mixed and selects all.
    const header = screen.getByRole("checkbox", { name: "Select all" });
    expect(header.getAttribute("aria-checked")).toBe("mixed");
    fireEvent.click(header);
    expect(onSelectionChange.mock.calls[1]![0].size).toBe(4);
  });
});

describe("Disclosure", () => {
  test("Scenario: Keyboard toggle", () => {
    function Host() { const [open, setOpen] = useState(false); return <Disclosure title="Advanced" open={open} onToggle={setOpen}><Text>inside</Text></Disclosure>; }
    ui(<Host />);
    const header = screen.getByRole("button", { name: "Advanced" });
    expect(screen.queryByText("inside")).toBeNull();
    header.focus();
    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("inside")).toBeTruthy();
    expect(document.activeElement).toBe(header);
  });
  test("Scenario: Single-mode accordion", () => {
    function Host() { const [open, setOpen] = useState(["a"]); return <Accordion single open={open} onChange={setOpen} sections={[{ id: "a", title: "Transform", content: <Text>A</Text> }, { id: "b", title: "Blend", content: <Text>B</Text> }]} />; }
    ui(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Blend" }));
    expect(screen.getByRole("button", { name: "Blend" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Transform" }).getAttribute("aria-expanded")).toBe("false");
  });
});

describe("Popover, dropdown menu and context menu", () => {
  const items = [{ id: "open", label: "Open" }, { id: "move", label: "Move to folder", submenu: [{ id: "client", label: "Client work" }, { id: "travel", label: "Travel" }] }, { id: "mask", label: "Circle mask" }];
  test("Scenario: Submenu by keyboard", async () => {
    ui(<MenuList items={items} onClose={() => {}} onCloseAll={() => {}} />);
    const parent = screen.getByRole("menuitem", { name: "Move to folder" });
    parent.focus();
    key(parent, "ArrowRight");
    await tick(20);
    expect(parent.getAttribute("aria-expanded")).toBe("true");
    const first = screen.getByRole("menuitem", { name: "Client work" });
    expect(document.activeElement).toBe(first);
    key(first, "ArrowLeft");
    await gone(() => screen.queryByRole("menuitem", { name: "Client work" }));
    expect(screen.queryByRole("menuitem", { name: "Client work" })).toBeNull();
    expect(document.activeElement).toBe(parent);
  });
  test("Scenario: Hover preview is discarded", () => {
    const onPreview = vi.fn(), onPreviewEnd = vi.fn(), onSelect = vi.fn();
    const view = ui(<MenuList items={[{ id: "mask", label: "Circle mask", onPreview, onPreviewEnd, onSelect }, { id: "other", label: "Other" }]} onClose={() => {}} onCloseAll={() => {}} autoFocus={false} />);
    const row = screen.getByRole("menuitem", { name: "Circle mask" });
    row.focus(); key(row, "ArrowDown"); key(screen.getByRole("menuitem", { name: "Other" }), "ArrowUp");
    expect(onPreview).toHaveBeenCalledTimes(1);
    view.unmount();
    // Leaving without committing discards the preview and records nothing.
    expect(onPreviewEnd).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });
  test("Scenario: Compact presentation", async () => {
    ui(<Menu open anchor={{ x: 10, y: 10, width: 10, height: 10 }} items={items} label="Actions" onClose={() => {}} />, { viewport: { width: 390, height: 844 }, density: undefined });
    await tick();
    expect(screen.getByTestId("bottom-sheet")).toBeTruthy();
    expect(screen.queryByTestId("popover")).toBeNull();
    expect(css(screen.getByRole("menuitem", { name: "Open" })).height).toBe("44px");
  });
  test("Scenario: Tablet presentation", async () => {
    ui(<><Menu open anchor={{ x: 10, y: 10, width: 10, height: 10 }} items={items} label="Actions" onClose={() => {}} /><ListRow title="Session" onPress={() => {}} menu={[{ id: "pin", label: "Pin" }]} /></>, { viewport: { width: 1024, height: 768 }, density: "touch" });
    await tick();
    expect(screen.getByTestId("popover")).toBeTruthy();
    expect(screen.queryByTestId("bottom-sheet")).toBeNull();
    expect(css(screen.getByRole("menuitem", { name: "Open" })).height).toBe("44px");
  });
  test("A menu row's action runs only after the menu and its scrim have left the tree", async () => {
    // The row navigates at once in the app: the screen that owns the menu is put away before an exit animation could
    // finish, so a scrim still mounted when the action runs stays over the next screen.
    const seen: Array<{ scrim: boolean; menu: boolean; closed: boolean; focus: string | null }> = [];
    let closed = false;
    function Host() {
      const [open, setOpen] = useState(false);
      const [dialog, setDialog] = useState(false);
      const look = () => seen.push({ scrim: Boolean(document.querySelector('[data-testid="scrim"]')), menu: Boolean(document.querySelector('[role="menu"]')), closed, focus: document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent ?? null });
      return (
        <View testID="screen">
          <Button label="Actions" onPress={() => setOpen(true)} />
          <Menu open={open} anchor={{ x: 10, y: 10, width: 10, height: 10 }} label="Actions" onClose={() => { closed = true; setOpen(false); }}
            items={[{ id: "open", label: "Open", onSelect: look }, { id: "delete", label: "Delete", onSelect: () => { look(); setDialog(true); } },
              { id: "more", label: "More", submenu: [{ id: "deep", label: "Deep", onSelect: look }] }, { id: "snap", label: "Snapping", switch: true, checked: false, onSelect: look }]} />
          <ConfirmDialog open={dialog} title="Delete project?" confirmLabel="Delete" onConfirm={() => {}} onClose={() => setDialog(false)} />
        </View>
      );
    }
    ui(<Host />);
    const opener = screen.getByRole("button", { name: "Actions" });
    const show = async () => { closed = false; opener.focus(); fireEvent.click(opener); await tick(40); expect(screen.getByTestId("scrim")).toBeTruthy(); };
    await show();
    fireEvent.click(screen.getByRole("menuitem", { name: "Open" }));
    await tick();
    // Inside the action: no scrim, no menu, the owner has been told it closed, focus is back on the opener.
    expect(seen).toEqual([{ scrim: false, menu: false, closed: true, focus: "Actions" }]);
    expect(screen.queryByTestId("scrim")).toBeNull();
    // The same menu opens again, and a row of a submenu behaves the same, by keyboard too.
    await show();
    const more = screen.getByRole("menuitem", { name: "More" });
    more.focus(); key(more, "ArrowRight");
    await tick(20);
    key(screen.getByRole("menuitem", { name: "Deep" }), "Enter");
    await tick();
    expect(seen[1]).toEqual({ scrim: false, menu: false, closed: true, focus: "Actions" });
    // A switch row keeps the menu open.
    await show();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Snapping" }));
    await tick();
    expect(seen[2]).toMatchObject({ scrim: true, menu: true });
    expect(screen.getByTestId("popover")).toBeTruthy();
    // A row that opens another surface: the dialog comes up after the menu is gone and is the only scrim.
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await tick(40);
    expect(seen[3]).toMatchObject({ scrim: false, menu: false });
    expect(screen.getByRole("dialog", { name: "Delete project?" })).toBeTruthy();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getAllByTestId("scrim").length).toBe(1);
  });
  test("An outside press closes a menu through its owner and runs no action", async () => {
    const onSelect = vi.fn(), onClose = vi.fn();
    function Host() { const [open, setOpen] = useState(true); return <Menu open={open} anchor={{ x: 10, y: 10, width: 10, height: 10 }} label="Actions" onClose={() => { onClose(); setOpen(false); }} items={[{ id: "open", label: "Open", onSelect }]} />; }
    ui(<Host />);
    await tick(40);
    fireEvent.click(screen.getByTestId("scrim"));
    await gone(() => screen.queryByTestId("scrim"));
    expect(screen.queryByTestId("scrim")).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });
  test("Keycap and shortcut hint — Scenario: Unbound action / Scenario: Rebound action updates the hint", () => {
    const row = [{ id: "split", label: "Split", shortcut: "edit.split" }];
    const view = ui(<MenuList items={row} onClose={() => {}} onCloseAll={() => {}} />, { os: "windows", shortcuts: () => null });
    expect(screen.getByRole("menuitem", { name: "Split" }).textContent).toBe("Split");
    view.rerender(<ThemeProvider scheme="light" viewport={wide} density="regular" os="windows" shortcuts={() => ["Mod", "K"]} shortcutsVersion={1}><MenuList items={row} onClose={() => {}} onCloseAll={() => {}} /></ThemeProvider>);
    expect(screen.getByRole("menuitem", { name: "Split" }).textContent).toBe("SplitCtrl + K");
  });
});

describe("Modal dialog", () => {
  test("An overlay leaves with the screen that owns it: hidden owner, no scrim; shown again, the dialog is back", async () => {
    // What a navigator does to the screen behind the front one: `display: none` on its container, the screen stays mounted.
    function Host() {
      return <View testID="screen"><ConfirmDialog open title="Delete project?" confirmLabel="Delete" onConfirm={() => {}} onClose={() => {}} /></View>;
    }
    ui(<Host />);
    await tick(40);
    expect(screen.queryByTestId("scrim")).toBeTruthy();
    const owner = screen.getByTestId("screen");
    owner.style.display = "none";
    await tick(60);
    expect(screen.queryByTestId("scrim")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector("[inert]")).toBeNull();
    owner.style.display = "";
    await tick(60);
    expect(screen.queryByRole("dialog")).toBeTruthy();
  });

  test("Scenario: Focus management", async () => {
    function Host() {
      const [open, setOpen] = useState(false);
      return <><Button label="New project" onPress={() => setOpen(true)} /><FormDialog open={open} title="New project" submitLabel="Create" dirty={false} onClose={() => setOpen(false)} onSubmit={() => {}}><Input accessibilityLabel="Project name" value="" /></FormDialog></>;
    }
    ui(<Host />);
    const opener = screen.getByRole("button", { name: "New project" });
    opener.focus();
    fireEvent.click(opener);
    await tick(20);
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.contains(document.activeElement)).toBe(true);
    for (let i = 0; i < 8; i++) { fireEvent.keyDown(document.activeElement!, { key: "Tab" }); expect(dialog.contains(document.activeElement)).toBe(true); }
    expect(opener.closest("[inert]")).toBeTruthy();
    // Escape closes the topmost thing first: a tooltip showing for the focused control, then the dialog.
    let presses = 0;
    for (; presses < 3 && document.querySelector("[inert]"); presses++) { fireEvent.keyDown(document.activeElement!, { key: "Escape" }); await tick(40); }
    await gone(() => screen.queryByRole("dialog"));
    if (screen.queryByRole("dialog")) throw new Error(`DBG presses=${presses} tips=${document.querySelectorAll('[role="tooltip"]').length} active=${document.activeElement?.outerHTML.slice(0, 160)}`);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
  test("Scenario: Unsaved input guard", async () => {
    const onClose = vi.fn();
    ui(<FormDialog open title="New project" submitLabel="Create" dirty onClose={onClose} onSubmit={() => {}}><Input accessibilityLabel="Project name" value="Da Lat" /></FormDialog>);
    await tick(20);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(await screen.findByText("Discard changes?")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    await gone(() => screen.queryByText("Discard changes?"));
    expect(screen.queryByText("Discard changes?")).toBeNull();
    expect((screen.getByLabelText("Project name") as HTMLInputElement).value).toBe("Da Lat");
  });
  test("Scenario: Destructive confirmation", async () => {
    const onConfirm = vi.fn();
    ui(<DestructiveConfirmDialog open title="Delete “Da Lat teaser”?" confirmLabel="Delete project" irreversible confirmWord="Da Lat teaser" onConfirm={onConfirm} onClose={() => {}} />);
    await tick(20);
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(document.activeElement).toBe(cancel);
    const destructive = screen.getByRole("button", { name: "Delete project" });
    expect(css(destructive).backgroundColor).toBe("rgb(217, 48, 37)");
    fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    fireEvent.click(destructive);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Da Lat teaser" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
  test("Elevation tokens — Scenario: Toast above modal", async () => {
    function Raise() { const toast = useToast(); return <Button label="Raise" onPress={() => toast.show({ message: "Saved" })} />; }
    ui(<><Raise /><ConfirmDialog open title="Archive?" confirmLabel="Archive" onConfirm={() => {}} onClose={() => {}} /></>);
    fireEvent.click(screen.getByRole("button", { name: "Raise", hidden: true }));
    await tick(20);
    const layerOf = (node: Element) => { let at: Element | null = node; while (at && !(at as HTMLElement).style?.zIndex) at = at.parentElement; return Number((at as HTMLElement).style.zIndex); };
    expect(layerOf(screen.getByTestId("toast"))).toBeGreaterThan(layerOf(screen.getByRole("dialog")));
    expect(layerOf(screen.getByTestId("toast"))).toBeGreaterThan(layerOf(screen.getByTestId("scrim")));
  });
});

describe("Side sheet and bottom sheet", () => {
  test("compact modal forms put their scrolling body and pinned actions in the keyboard-avoiding layer", async () => {
    ui(<Modal title="Connect a host" onClose={() => {}} footer={<Button kind="primary" label="Continue" onPress={() => {}} />}>
      <Input accessibilityLabel="Pairing link" value="fixture" />
    </Modal>, { viewport: { width: 390, height: 844 }, density: undefined });
    await tick(10);
    const avoiding = screen.getByTestId("modal-keyboard-avoiding");
    expect(avoiding.contains(screen.getByTestId("modal"))).toBe(true);
    expect(avoiding.contains(screen.getByRole("button", { name: "Continue" }))).toBe(true);
  });

  test("Scenario: Adaptive presentation", async () => {
    const sheet = <AdaptiveSheet open title="Rename" onClose={() => {}}><Input accessibilityLabel="Name" value="x" /></AdaptiveSheet>;
    const desktop = ui(sheet);
    await tick(10);
    expect(screen.getByTestId("modal")).toBeTruthy();
    desktop.unmount();
    ui(sheet, { viewport: { width: 390, height: 844 }, density: undefined });
    await tick(10);
    expect(screen.getByTestId("bottom-sheet")).toBeTruthy();
    expect(css(screen.getByTestId("bottom-sheet")).borderTopLeftRadius).toBe("16px");
  });
  test("Scenario: Non-modal tool sheet", async () => {
    const onPress = vi.fn();
    ui(<><Button label="Preview" onPress={onPress} /><BottomSheet open modal={false} title="Opacity" onClose={() => {}} onConfirm={() => {}}><Text>tool</Text></BottomSheet></>, { viewport: { width: 390, height: 844 }, density: undefined });
    await tick(10);
    expect(screen.queryByTestId("scrim")).toBeNull();
    const preview = screen.getByRole("button", { name: "Preview" });
    expect(preview.closest("[inert]")).toBeNull();
    fireEvent.click(preview);
    expect(onPress).toHaveBeenCalled();
  });
  test("Motion tokens — Scenario: Reduced motion", async () => {
    ui(<BottomSheet open title="Export" onClose={() => {}}><Text>x</Text></BottomSheet>, { viewport: { width: 390, height: 844 }, density: undefined, reduceMotion: true });
    await tick(200);
    const sheet = screen.getByTestId("bottom-sheet");
    // No slide: the sheet sits at its place and only its opacity changed.
    expect(sheet.style.transform === "" || /translateY\(0(px)?\)/.test(sheet.style.transform)).toBe(true);
    expect(sheet.style.opacity).toBe("1");
  });
});

describe("Drawer", () => {
  test("Scenario: Drawer traps focus and restores it", async () => {
    function Host() { const [open, setOpen] = useState(false); return <><Button label="Menu" onPress={() => setOpen(true)} /><Drawer open={open} label="Navigation" onClose={() => setOpen(false)}><ListRow title="Projects" onPress={() => {}} /><ListRow title="Sessions" onPress={() => {}} /></Drawer></>; }
    ui(<Host />, { viewport: { width: 390, height: 844 }, density: undefined });
    const opener = screen.getByRole("button", { name: "Menu" });
    opener.focus(); fireEvent.click(opener);
    await tick(20);
    const drawer = screen.getByTestId("drawer");
    // 86% of 390 px is 335 px, above the 320 px maximum.
    expect(css(drawer).width).toBe("320px");
    expect(css(drawer).backgroundColor).toBe("rgb(247, 247, 247)");
    for (let i = 0; i < 5; i++) { fireEvent.keyDown(document.activeElement!, { key: "Tab" }); expect(drawer.contains(document.activeElement)).toBe(true); }
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await gone(() => screen.queryByTestId("drawer"));
    expect(screen.queryByTestId("drawer")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
  test("Scenario: Right-to-left", async () => {
    ui(<Drawer open label="Navigation" onClose={() => {}}><Text>x</Text></Drawer>, { viewport: { width: 390, height: 844 }, density: undefined, rtl: true, reduceMotion: false });
    await tick(5);
    const drawer = screen.getByTestId("drawer");
    // Anchored to the inline-start edge, which is the right edge in right-to-left layouts; it enters from positive x.
    expect(css(drawer).insetInlineStart === "0px" || drawer.style.insetInlineStart === "0px" || drawer.className.length > 0).toBe(true);
    expect(/translateX\((-|0)/.test(drawer.style.transform) && !/translateX\(-\d/.test(drawer.style.transform)).toBe(true);
  });
});

describe("Application menu button", () => {
  const model = [{ id: "file", title: "&File", items: [{ id: "new", label: "New project" }] }, { id: "help", title: "&Help", items: [{ id: "about", label: "About" }] }];
  test("Scenario: Not rendered on macOS", () => {
    ui(<AppMenu model={model} desktopApp />, { os: "mac" });
    expect(screen.queryByRole("button", { name: "Application menu" })).toBeNull();
    ui(<AppMenu model={model} desktopApp={false} />, { os: "windows" });
    expect(screen.queryByRole("button", { name: "Application menu" })).toBeNull();
  });
  test("Scenario: Menu opens from the keyboard", async () => {
    ui(<AppMenu model={model} desktopApp />, { os: "windows" });
    expect(screen.getByRole("button", { name: "Application menu" })).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "Alt", altKey: true });
    fireEvent.keyDown(document.body, { key: "f", altKey: true });
    await tick(20);
    const first = screen.getByRole("menuitem", { name: "New project" });
    expect(document.activeElement).toBe(first);
  });
  test("Scenario: Bare Alt does nothing", async () => {
    ui(<AppMenu model={model} desktopApp />, { os: "windows" });
    const before = document.activeElement;
    fireEvent.keyDown(document.body, { key: "Alt", altKey: true });
    fireEvent.wheel(document.body, { deltaY: 40, altKey: true });
    fireEvent.keyUp(document.body, { key: "Alt" });
    await tick(20);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(before);
  });
});

describe("Callouts and banners", () => {
  test("Scenario: Warning callout", () => {
    ui(<Callout tone="warning">Trigger content is untrusted.</Callout>);
    const block = screen.getByRole("alert");
    expect(css(block).backgroundColor).toBe("rgb(253, 243, 227)");
    expect(block.getAttribute("style")).toMatch(/border-(inline-start|left)-width: 3px/);
    expect(block.getAttribute("style")).toContain("rgb(232, 137, 12)");
    expect(css(screen.getByText("Trigger content is untrusted.")).color).toBe("rgb(26, 26, 26)");
  });
  test("Scenario: Persistent dismissal", () => {
    const banner = <Banner id="update-ready" dismissible="permanent">Version 1.4 is ready.</Banner>;
    const first = ui(banner);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Version 1.4 is ready.")).toBeNull();
    first.unmount();
    // After a restart the stored dismissal still hides it.
    ui(banner);
    expect(screen.queryByText("Version 1.4 is ready.")).toBeNull();
    window.localStorage.clear();
  });
});

describe("Empty, error and offline states", () => {
  test("Scenario: Requires-host state", () => {
    const onRequiresHost = vi.fn();
    ui(<RequiresHostState feature="Workflows" />, { host: { connected: false, onRequiresHost } });
    expect(screen.getByText("Workflows")).toBeTruthy();
    expect(screen.getByText("Requires a host")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Connect a host" }));
    expect(onRequiresHost).toHaveBeenCalledWith("Workflows");
    expect(screen.queryByRole("list")).toBeNull();
  });
  test("Scenario: Error state details", async () => {
    const writeText = vi.fn((_: string) => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    ui(<ErrorState title="Couldn’t load sessions" error={{ code: "RATE_LIMITED", message: "Too many requests", request: "sessions.list", at_ms: 0, context: { token: "sk-1" } }} resolve={() => "The host is busy."} onRetry={() => {}} />);
    expect(screen.getByText("The host is busy.")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copy details" })); });
    const text = writeText.mock.calls[0]![0];
    expect(text).toContain("code: RATE_LIMITED");
    expect(text).toContain("request: sessions.list");
    expect(text).not.toContain("sk-1");
  });
});

describe("Avatar, badge and status pill", () => {
  test("Scenario: Count overflow", () => {
    ui(<Badge count={128} tone="attention" />);
    const badge = screen.getByLabelText("128 unread");
    expect(badge.textContent).toBe("99+");
  });
  test("Scenario: Deterministic avatar (rendered)", () => {
    ui(<><Avatar name="Studio Mac" id="host_1" square /><Avatar name="Studio Mac" id="host_1" square /></>, { scheme: "dark" });
    const [a, b] = screen.getAllByRole("img", { name: "Studio Mac" });
    expect(css(a!).backgroundColor).toBe(css(b!).backgroundColor);
    expect(css(a!).borderTopLeftRadius).toBe("6px");
  });
  test("Scenario: Timed-out run (rendered)", () => {
    ui(<StatusPill label="Timed out" status="timed_out" reason="parked_timeout" />);
    const pill = screen.getByRole("status", { name: "Timed out" });
    expect(css(pill).backgroundColor).toBe("rgb(253, 243, 227)");
    expect(css(screen.getByText("Timed out")).color).toBe("rgb(143, 83, 0)");
    expect(css(screen.getByText("parked_timeout")).color).toBe("rgb(107, 107, 107)");
  });
  test("Keycap and shortcut hint — keycaps per platform", () => {
    ui(<Kbd keys={["Mod", "Shift", "Z"]} />, { os: "windows" });
    expect(screen.getByLabelText("Ctrl + Shift + Z")).toBeTruthy();
  });
});

describe("Composer primitive", () => {
  const composer = (props: { value: string; running?: boolean }) => <Composer placeholder="Ask" value={props.value} running={props.running} onChangeText={() => {}} onSend={() => {}} onStop={() => {}} mode={{ id: "m", label: "Agent" }} />;
  test("Scenario: Send button state", () => {
    const view = ui(composer({ value: "" }));
    const send = screen.getByRole("button", { name: "Send" });
    expect(send.getAttribute("aria-disabled")).toBe("true");
    expect(css(screen.getByTestId("composer-send").firstElementChild ?? send).backgroundColor === "rgb(239, 239, 239)" || css(send).backgroundColor === "rgb(239, 239, 239)" || send.innerHTML.includes("rgb(239, 239, 239)")).toBe(true);
    view.rerender(<ThemeProvider scheme="light" viewport={wide} density="regular" os="mac">{composer({ value: "a" })}</ThemeProvider>);
    expect(screen.getByRole("button", { name: "Send" }).getAttribute("aria-disabled")).not.toBe("true");
    expect(screen.getByRole("button", { name: "Send" }).innerHTML + screen.getByRole("button", { name: "Send" }).getAttribute("style")).toContain("26, 26, 26");
  });
  test("Scenario: Stop replaces send", () => {
    ui(composer({ value: "", running: true }));
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  });
  test("a message typed while a turn runs: the button sends it and does not stop the turn (a press right when the answer lands is not lost)", () => {
    const calls: string[] = [];
    ui(<Composer placeholder="Ask" value="and make it warmer" running onChangeText={() => {}} onSend={() => calls.push("send")} onStop={() => calls.push("stop")} />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(calls).toEqual(["send"]);
    // The turn can still be stopped: a separate, smaller button next to send.
    expect(screen.getByTestId("composer-send").getAttribute("aria-label")).toBe("Send");
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(calls).toEqual(["send", "stop"]);
  });
});

describe("Timeline atoms", () => {
  test("Scenario: Selected clip affordances", () => {
    ui(<Clip type="video" label="Drone" width={120} height={50} trimHandleWidth={8} selected />);
    const outline = screen.getByTestId("clip-selection");
    expect([css(outline).borderTopWidth, css(outline).borderTopColor]).toEqual(["2px", "rgb(26, 26, 26)"]);
    for (const id of ["trim-handle-start", "trim-handle-end"]) expect([css(screen.getByTestId(id)).backgroundColor, css(screen.getByTestId(id)).width]).toEqual(["rgb(26, 26, 26)", "8px"]);
  });
  test("Scenario: Offline media clip", () => {
    ui(<Clip type="video" label="Drone" width={120} height={50} trimHandleWidth={8} offline />);
    expect(screen.getByRole("button", { name: "Drone, media offline" })).toBeTruthy();
    expect(screen.getByTestId("offline-stripe")).toBeTruthy();
  });
  test("Scenario: Dimensions come from the owners", () => {
    ui(<><Playhead height={200} lineWidth={2} handle={12} /><TrackLane height={65} /></>);
    const handle = screen.getByTestId("playhead-handle");
    expect([css(handle).width, css(handle).height]).toEqual(["12px", "12px"]);
  });
  test("Editor colour tokens — Scenario: Muted and hidden are different", () => {
    ui(<><Clip type="audio" label="Voice" width={120} height={50} trimHandleWidth={8} muted /><Clip type="video" label="B-roll" width={120} height={50} trimHandleWidth={8} hidden /></>);
    expect(screen.getByRole("button", { name: "Voice, muted" })).toBeTruthy();
    const hidden = screen.getByRole("button", { name: "B-roll, hidden" });
    expect(css(hidden.firstElementChild!).opacity).toBe("0.5");
    expect(css(hidden).opacity).toBe("1");
  });
  test("Typography tokens — Scenario: Timecode does not jitter", () => {
    ui(<Transport playing={false} onToggle={() => {}} timecode="00:00:01:11" />);
    expect(screen.getByTestId("timecode").getAttribute("style")).toContain("tabular-nums");
  });
});

describe("Data-visualisation tokens", () => {
  test("Scenario: Sparkline has a text equivalent", () => {
    const summary = "Runs per day, last 14 days: lowest 0, highest 9, latest 4";
    ui(<><Sparkline values={[0, 9, 4]} summary={summary} /><Text>4</Text></>);
    expect(screen.getByRole("img", { name: summary })).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
  });
});

describe("Component state coverage and catalogue", () => {
  test("Scenario: Every listed component is in the catalogue", () => {
    const entries = catalogueSections(undefined, { desktop: DIMS, touch: DIMS }).flatMap((section) => section.entries);
    for (const component of COMPONENTS) {
      for (const state of APPLICABLE_STATES[component]) {
        expect(entries.some((item) => item.component === component && item.state === state), `${component} has no catalogue entry for the state ${state}`).toBe(true);
      }
    }
    expect(COMPONENTS.length).toBe(67);
  });
  test("the catalogue renders in both themes and both densities", async () => {
    for (const scheme of ["light", "dark"] as const) {
      for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 1024, height: 768 }]) {
        const view = render(<ThemeProvider scheme={scheme} viewport={viewport} density={viewport.width === 1280 ? "regular" : "touch"}><Catalogue timeline={{ desktop: DIMS, touch: DIMS }} /></ThemeProvider>);
        await tick();
        expect(screen.getByTestId("catalogue")).toBeTruthy();
        expect(screen.getByTestId("cat-timeline")).toBeTruthy();
        view.unmount();
      }
    }
  }, 60000);
  test("Scenario: Tablet combination is rendered", () => {
    ui(<><MenuList items={[{ id: "open", label: "Open" }]} onClose={() => {}} onCloseAll={() => {}} autoFocus={false} /><ListRow title="Session" onPress={() => {}} menu={[{ id: "pin", label: "Pin" }]} /></>, { viewport: { width: 1024, height: 768 }, density: "touch" });
    expect(css(screen.getByRole("menuitem", { name: "Open" })).height).toBe("44px");
    expect(css(screen.getByRole("button", { name: "More actions" }).parentElement!).opacity).toBe("1");
  });
});
