import { useRef, useState, type ReactNode } from "react";
import { View } from "react-native";
import { AppMenu, type AppMenuModel } from "../appmenu.tsx";
import { Breadcrumb } from "../breadcrumb.tsx";
import { Button, IconButton } from "../button.tsx";
import { Banner, Callout } from "../callout.tsx";
import { Card, CopyValue, GroupedSettingCard, InlineEditChip, MediaCard, SettingRow } from "../card.tsx";
import { BarChart, HorizontalBarChart, LineChart, Sparkline } from "../charts.tsx";
import { Composer } from "../composer.tsx";
import { ConfirmDialog, DestructiveConfirmDialog, DetailDialog, FormDialog, ListPickerDialog, ProgressDialog, TagPickerDialog } from "../dialogs.tsx";
import { Accordion, Disclosure } from "../disclosure.tsx";
import { EmptyState, ErrorState, FirstUseState, NoResultsState, RequiresHostState } from "../empty.tsx";
import { Input } from "../input.tsx";
import { Kbd } from "../kbd.tsx";
import { ListCaption, ListRow } from "../list.tsx";
import { CodeBlock, MarkdownView } from "../markdown.tsx";
import { ContextMenu, Menu, MenuList, type MenuItem } from "../menu.tsx";
import { AdaptiveSheet, BottomSheet, Drawer, Modal, Popover, SideSheet, popoverBox } from "../overlay.tsx";
import { PanelGroup } from "../panels.tsx";
import { OperationProgress, ProgressBar, Skeleton, Spinner, StatusRing, Stepper } from "../progress.tsx";
import { SkeletonCards, SkeletonChat, SkeletonGrid, SkeletonList, SkeletonTable, SkeletonText } from "../skeletons.tsx";
import { QRCode } from "../qrcode.tsx";
import { Select } from "../select.tsx";
import { Table } from "../table.tsx";
import { Text } from "../text.tsx";
import { useTheme } from "../theme.tsx";
import { Clip, DropIndicator, Filmstrip, KeyframeDiamond, Marker, Playhead, RangeBar, Ruler, SnapLine, ThumbnailTile, TrackHeader, TrackLane, TransitionHandle, Transport, Waveform, ZoomSlider } from "../timeline.tsx";
import { ToastView, useToast } from "../toast.tsx";
import { Switch } from "../toggles.tsx";
import { Tooltip, TooltipBubble } from "../tooltip.tsx";
import { Tree, type TreeItem } from "../tree.tsx";
import { Dot } from "../avatar.tsx";
import { CLIP_TYPES, borderWidth, radius, space } from "../tokens.ts";
import { entry, type Section } from "./frame.tsx";

const noop = () => {};
const Row = (props: { children: ReactNode; gap?: number; top?: boolean }) => <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: props.top ? "flex-start" : "center", gap: props.gap ?? space[2] }}>{props.children}</View>;
function Stateful<T>(props: { initial: T; children(value: T, set: (value: T) => void): ReactNode }) {
  const [value, set] = useState(props.initial);
  return <>{props.children(value, set)}</>;
}
const Box = (props: { children: ReactNode; width?: number }) => {
  const theme = useTheme();
  return <View style={{ backgroundColor: theme.color("bg/sidebar"), padding: space[2], borderRadius: radius.md, width: props.width }}>{props.children}</View>;
};
/** A popover drawn in place, for the catalogue: the same box a `Popover` puts in the overlay stack. */
const StaticPopover = (props: { children: ReactNode; width?: number }) => {
  const theme = useTheme();
  return <View style={[popoverBox(theme), { width: props.width }]}>{props.children}</View>;
};
const MENU: MenuItem[] = [
  { id: "open", label: "Open", icon: "ext" }, { id: "rename", label: "Rename", icon: "pencil", keys: ["F2"] }, { id: "duplicate", label: "Duplicate", icon: "copy", shortcut: "edit.duplicate" },
  { id: "move", label: "Move to folder", icon: "folder", submenu: [{ type: "caption", label: "Move to" }, { id: "client", label: "Client work", checked: true }, { id: "travel", label: "Travel", checked: false }, { type: "separator" }, { id: "new", label: "New folder…", icon: "plus" }] },
  { type: "separator" }, { id: "ruler", label: "Show ruler", switch: true, checked: true }, { id: "export", label: "Export package", icon: "export", disabled: true }, { id: "share", label: "Share link", icon: "link", requiresHost: true },
  { type: "separator" }, { id: "delete", label: "Delete", icon: "trash", danger: true },
];
const APP_MENU: AppMenuModel = [
  { id: "file", title: "&File", items: [{ id: "new", label: "New project", shortcut: "project.new" }, { id: "open", label: "Open…" }, { type: "separator" }, { id: "quit", label: "Quit" }] },
  { id: "edit", title: "&Edit", items: [{ id: "undo", label: "Undo", shortcut: "edit.undo" }, { id: "redo", label: "Redo" }] },
  { id: "view", title: "&View", items: [{ id: "ruler", label: "Show ruler", switch: true, checked: true }] },
  { id: "help", title: "&Help", items: [{ id: "shortcuts", label: "Keyboard shortcuts" }] },
];
type Secret = { id: string; name: string; usedBy: string; updated: string };
const SECRETS: Secret[] = [{ id: "1", name: "FREESOUND_KEY", usedBy: "Sounds library", updated: "2 Oct 2026" }, { id: "2", name: "WEBHOOK_SIGNING", usedBy: "2 automations", updated: "28 Sep 2026" }, { id: "3", name: "ELEVEN_KEY", usedBy: "Voice", updated: "20 Sep 2026" }];
const COLUMNS = [
  { id: "name", title: "Name", sortable: true, mono: true, text: (row: Secret) => row.name }, { id: "usedBy", title: "Used by", text: (row: Secret) => row.usedBy },
  { id: "updated", title: "Updated", sortable: true, text: (row: Secret) => row.updated },
];
const TREE: TreeItem[] = [
  { id: "footage", label: "Footage", icon: "folder", meta: "14", children: [
    { id: "day1", label: "Day 1 — pine forest", icon: "folder", children: [{ id: "drone", label: "drone_dalat_01.mp4", icon: "video" }, { id: "market", label: "market_walk.mp4", icon: "video" }] },
    { id: "day2", label: "Day 2 — lake", icon: "folder", hasChildren: true },
  ] },
  { id: "music", label: "Music", icon: "folder", hasChildren: true },
];
const MARKDOWN = "## Shot list\n\nCut the **intro** to 4 s, keep the `laugh` at 00:41 and see the [brief](jagentchill://project/q4).\n\n- [x] Drone opening\n- [ ] Market walk\n\n> Captions are burned in for the vertical cut.\n\n| Shot | Length |\n|---|---:|\n| Drone | 4 s |\n| Market | 9 s |\n\n<img src=x onerror=alert(1)>\n";
const CODE = "export function ticks(seconds: number): number {\n  // 120 000 ticks per second\n  return Math.round(seconds * 120000);\n}";
const PEAKS = Array.from({ length: 64 }, (_, i) => Math.abs(Math.sin(i * 0.7) * 0.8 + Math.sin(i * 0.13) * 0.4));
const ERROR = { code: "RATE_LIMITED", message: "Too many requests", request: "sessions.list", at_ms: 1791187200000 };

function OverlayButtons(props: { open: string | undefined; ids: string[] }) {
  const toast = useToast();
  const [open, setOpen] = useState<string | null>(props.open && props.ids.includes(props.open) ? props.open : null);
  const [picked, setPicked] = useState<string[]>(["a"]);
  const [tags, setTags] = useState<string[]>(["travel"]);
  const [name, setName] = useState("");
  const anchor = useRef<View>(null);
  const close = () => setOpen(null);
  const button = (id: string, label: string) => (props.ids.includes(id) ? <Button key={id} size="sm" label={label} testID={`open-${id}`} onPress={() => setOpen(id)} /> : null);
  return (
    <View style={{ gap: space[2] }}>
      <Row>
        {button("modal", "Form modal")}{button("confirm", "Confirm")}{button("destructive", "Destructive confirm")}{button("picker", "List picker")}{button("tags", "Tag picker")}{button("detail", "Tabbed detail")}{button("progress", "Progress")}
        {button("sidesheet", "Side sheet")}{button("bottomsheet", "Bottom sheet")}{button("toolsheet", "Tool sheet")}{button("adaptive", "Adaptive sheet")}{button("drawer", "Drawer")}
        <View ref={anchor}>{button("popover", "Popover")}{button("menu", "Menu")}</View>
        {props.ids.includes("toast") ? <Button size="sm" label="Show a toast" testID="open-toast" onPress={() => toast.show({ kind: "success", message: "Project moved to trash", undo: () => {} })} /> : null}
      </Row>
      <FormDialog open={open === "modal"} title="New project" description="Projects hold your timeline, media and exports." submitLabel="Create" dirty={name !== ""} onClose={close} onSubmit={close}>
        <Input accessibilityLabel="Project name" placeholder="Project name" value={name} onChangeText={setName} />
        <Select label="Canvas" options={[{ value: "9:16", label: "9:16 vertical" }, { value: "16:9", label: "16:9 landscape" }]} value="9:16" onChange={noop} />
      </FormDialog>
      <ConfirmDialog open={open === "confirm"} title="Archive this session?" description="You can restore it from the archive." confirmLabel="Archive" onConfirm={close} onClose={close} />
      <DestructiveConfirmDialog open={open === "destructive"} title="Delete “Da Lat teaser”?" description="This permanently deletes the project and its exports." confirmLabel="Delete project" irreversible confirmWord="Da Lat teaser" onConfirm={close} onClose={close} />
      <ListPickerDialog open={open === "picker"} title="Add clips" searchLabel="Search clips" items={[{ id: "a", label: "drone_dalat_01.mp4", description: "00:32" }, { id: "b", label: "market_walk.mp4", description: "01:04" }, { id: "c", label: "lake_sunrise.mp4", description: "00:18" }]}
        selected={picked} onChange={setPicked} confirmLabel={(count) => `Add ${count} clip${count === 1 ? "" : "s"}`} onConfirm={close} onClose={close} />
      <TagPickerDialog open={open === "tags"} title="Tags" searchLabel="Search tags" doneLabel="Done" tags={["travel", "client", "vertical", "b-roll"]} selected={tags} onChange={setTags} onCreate={(tag) => setTags([...tags, tag])} onClose={close} />
      <DetailDialog open={open === "detail"} title="Export details" onClose={close} tabs={[{ id: "general", label: "General", rows: [{ key: "Preset", value: "1080p H.264" }, { key: "Duration", value: "00:32" }] }, { id: "file", label: "File", rows: [{ key: "Size", value: "84 MB" }] }]} />
      <ProgressDialog open={open === "progress"} title="Generating proxies" step="Processing 3 of 8" value={38} onCancel={close} onClose={close} />
      <SideSheet open={open === "sidesheet"} title="Add secret" onClose={close} footer={<><Button kind="ghost" label="Cancel" onPress={close} /><Button kind="primary" label="Add secret" onPress={close} /></>}>
        <Input accessibilityLabel="Name" placeholder="NAME" mono value="" onChangeText={noop} />
      </SideSheet>
      <BottomSheet open={open === "bottomsheet"} title="Export" onClose={close} padded footer={<Button kind="primary" label="Export" onPress={close} />}><Text>Choose a preset for this export.</Text><Input accessibilityLabel="File name" value="dalat-teaser" onChangeText={noop} /></BottomSheet>
      <BottomSheet open={open === "toolsheet"} title="Opacity" modal={false} onClose={close} onConfirm={close} headerStart={<Button size="sm" kind="ghost" label="Reset" onPress={noop} />} padded><Text color="text/secondary">The preview above stays interactive.</Text></BottomSheet>
      <AdaptiveSheet open={open === "adaptive"} title="Rename" onClose={close} width={360} footer={<Button kind="primary" label="Save" onPress={close} />}><Input accessibilityLabel="Name" value="Da Lat teaser" onChangeText={noop} /></AdaptiveSheet>
      <Drawer open={open === "drawer"} label="Navigation" onClose={close} header={<View style={{ padding: space[3] }}><Text variant="title-sm">Studio Mac</Text></View>}>
        <ListRow title="Projects" icon="folder" onPress={close} /><ListRow title="Sessions" icon="chat" selected onPress={close} /><ListRow title="Workflows" icon="flow" onPress={close} requiresHost />
      </Drawer>
      <Popover open={open === "popover"} anchor={anchor} onClose={close} label="Filters" padded><Text variant="body-medium">Filters</Text><Text color="text/secondary">Anchored with a 4 px offset; flips and shifts to stay 8 px inside the viewport.</Text></Popover>
      <Menu open={open === "menu"} anchor={anchor} items={MENU} label="Project actions" onClose={close} />
    </View>
  );
}

export function surfaceSections(open: string | undefined, timeline: { desktop: TimelineDimensions; touch: TimelineDimensions }): Section[] {
  return [
    {
      id: "listrow", title: "ListRow · secondary list", layout: "column",
      entries: [
        entry("ListRow", "rest", <Box width={240}>
          <ListRow title="Projects" icon="folder" onPress={noop} />
          <ListRow title="Sessions" icon="chat" selected count={2} onPress={noop} />
          <ListRow title="Workflows" icon="flow" forceState="hover" onPress={noop} menu={[{ id: "open", label: "Open" }, { id: "pin", label: "Pin" }]} />
          <ListRow title="Film Studio" icon="film" forceState="focus" onPress={noop} />
          <ListRow title="Automations" icon="zap" disabled onPress={noop} />
          <ListRow title="Skills" icon="spark" requiresHost onPress={noop} />
          <ListCaption label="Pinned" />
          <ListRow title="Tighten the Da Lat intro" meta="Needs approval" metaTone="warning" selected onPress={noop} />
          <ListRow title="Q4 promo captions" meta="Export ready" metaTone="success" unread onPress={noop} />
          <ListRow title="Coffee brand story cut" meta="Rendering 42%" metaLeading={<Dot tone="off" pulse />} onPress={noop} />
          <ListRow title="Wedding teaser music swap" meta="Failed" metaTone="danger" onPress={noop} />
          <ListRow title="Hoi An lanterns b-roll with a title too long to fit" meta="2h ago · dragging" dragging onPress={noop} />
        </Box>, { label: "rest · selected · hover · focus · disabled · requires host · two-line with status tones · unread · dragging" }),
        entry("ListRow", "hover", <Box width={240}><ListRow title="Workflows" icon="flow" forceState="hover" onPress={noop} /></Box>),
        entry("ListRow", "pressed", <Box width={240}><ListRow title="Workflows" icon="flow" forceState="pressed" onPress={noop} /></Box>),
        entry("ListRow", "focus-visible", <Box width={240}><ListRow title="Film Studio" icon="film" forceState="focus" onPress={noop} /></Box>),
        entry("ListRow", "disabled", <Box width={240}><ListRow title="Automations" icon="zap" disabled onPress={noop} /></Box>),
        entry("ListRow", "selected", <Box width={240}><ListRow title="Sessions" icon="chat" selected onPress={noop} chevron /></Box>),
      ],
    },
    {
      id: "card", title: "Card · media card · GroupedSettingCard", span: 2, layout: "column",
      entries: [
        entry("Card", "rest", <Row top gap={space[3]}>
          <Card style={{ width: 120 }}><Text>Plain</Text></Card>
          <Card style={{ width: 120 }} onPress={noop} label="Interactive" forceState="hover"><Text>Interactive · hover</Text></Card>
          <Card style={{ width: 120 }} onPress={noop} label="Pressed" forceState="pressed"><Text>Pressed</Text></Card>
          <Card style={{ width: 120 }} onPress={noop} label="Focus" forceState="focus"><Text>Focus</Text></Card>
          <Card style={{ width: 120 }} selected onPress={noop} label="Selected"><Text>Selected</Text></Card>
          <Card style={{ width: 120 }} onPress={noop} label="Disabled" disabled><Text>Disabled</Text></Card>
          <Card style={{ width: 120 }} onPress={noop} label="Workflow" requiresHost><Text>Requires host</Text></Card>
          <MediaCard width={150} title="Da Lat teaser" meta="9:16 · 2h ago" duration="00:32" play status={{ label: "Result ready", status: "result_ready" }} preview={<ThumbnailTile tone="clip/text" />} onPress={noop} />
          <MediaCard width={90} frame="9:16" title="Vertical cut" meta="1h ago" preview={<ThumbnailTile tone="clip/image" />} />
          <MediaCard width={110} frame="1:1" title="Cover" meta="Square" preview={<ThumbnailTile tone="clip/compound" />} />
        </Row>),
        entry("Card", "hover", <Card style={{ width: 120 }} onPress={noop} label="Hover" forceState="hover"><Text>Hover</Text></Card>),
        entry("Card", "pressed", <Card style={{ width: 120 }} onPress={noop} label="Pressed" forceState="pressed"><Text>Pressed</Text></Card>),
        entry("Card", "focus-visible", <Card style={{ width: 120 }} onPress={noop} label="Focus" forceState="focus"><Text>Focus</Text></Card>),
        entry("Card", "disabled", <Card style={{ width: 120 }} onPress={noop} label="Disabled" disabled><Text>Disabled</Text></Card>),
        entry("Card", "selected", <Card style={{ width: 120 }} selected onPress={noop} label="Selected"><Text>Selected</Text></Card>),
        entry("GroupedSettingCard", "rest", <GroupedSettingCard>
          <SettingRow label="Theme" description="Follows the OS when set to System."><Select label="Theme" width={120} options={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} value="system" onChange={noop} /></SettingRow>
          <SettingRow label="Reduce motion"><Stateful initial={false}>{(value, set) => <Switch accessibilityLabel="Reduce motion" value={value} onChange={set} />}</Stateful></SettingRow>
          <SettingRow label="Host name"><Stateful initial="Studio Mac">{(value, set) => <InlineEditChip label="Host name" value={value} onSave={set} />}</Stateful></SettingRow>
          <SettingRow label="Device ID"><CopyValue label="Device ID" value="dev_3f9a1c77" /></SettingRow>
          <SettingRow label="Export folder" description="Where finished videos are saved."><Button size="sm" label="Change…" onPress={noop} /></SettingRow>
          <SettingRow icon="kbd" label="Keyboard shortcuts" description="Presets and rebinding" onPress={noop} last />
        </GroupedSettingCard>, { label: "select · switch · inline-edit chip · read-only value with copy · button · sub-page" }),
      ],
    },
    {
      id: "table", title: "Table — toolbar, bulk bar, sort, states", span: 2, layout: "column",
      entries: [
        entry("Table", "rest", <Stateful initial={{ query: "", sort: { column: "name", direction: "ascending" as const }, selection: new Set<string>() }}>{(state, set) => (
          <Table label="Secrets" dense columns={COLUMNS} rows={SECRETS.filter((row) => row.name.toLowerCase().includes(state.query.toLowerCase()))} rowKey={(row) => row.id}
            search={{ label: "Search secrets", placeholder: "Search secrets…", value: state.query, onChange: (query) => set({ ...state, query }) }}
            toolbar={<><Button label="Bulk add" onPress={noop} /><Button kind="primary" label="Add secret" onPress={noop} /></>}
            sort={state.sort} onSort={(sort) => set({ ...state, sort: sort as typeof state.sort })} selection={state.selection} onSelectionChange={(selection) => set({ ...state, selection })}
            bulkActions={[{ label: "Move to folder", onPress: noop }, { label: "Add tags", onPress: noop }, { label: "Delete", danger: true, onPress: noop }]}
            rowMenu={() => [{ id: "edit", label: "Edit" }, { id: "delete", label: "Delete", danger: true }]} empty={{ icon: "key", title: "No secrets yet", description: "Secrets are stored on the host.", action: { label: "Add secret", onPress: noop } }} />
        )}</Stateful>),
        entry("Table", "selected", <Table label="Secrets, selected" dense columns={COLUMNS} rows={SECRETS} rowKey={(row) => row.id} selection={new Set(["1", "2"])} onSelectionChange={noop} bulkActions={[{ label: "Delete", danger: true, onPress: noop }]} />, { label: "bulk bar replaces the toolbar" }),
        entry("Table", "loading", <Table label="Secrets, loading" dense columns={COLUMNS} rows={[]} rowKey={(row) => row.id} loading />, { label: "loading: six skeleton rows" }),
        entry("Table", "hover", <Table label="Secrets, empty" columns={COLUMNS} rows={[]} rowKey={(row) => row.id} empty={{ icon: "key", title: "No secrets yet", description: "Secrets are stored on the host.", action: { label: "Add secret", onPress: noop } }} />, { label: "empty" }),
        entry("Table", "invalid", <Table label="Secrets, error" columns={COLUMNS} rows={[]} rowKey={(row) => row.id} error={{ title: "Couldn’t load secrets", info: ERROR, resolve: () => "The host is busy. Try again in a moment.", onRetry: noop }} />, { label: "error" }),
      ],
    },
    {
      id: "tree", title: "Tree", layout: "column", note: "28 px rows, 16 px indent per level, inline rename, 2 px accent insertion line, lazy children.",
      entries: [
        entry("Tree", "rest", <Stateful initial={{ expanded: new Set(["footage", "day1"]), selected: new Set(["day1"]) }}>{(state, set) => (
          <View style={{ width: 260 }}>
            <Tree label="Media" nodes={TREE} multiple expanded={state.expanded} onExpandedChange={(expanded) => set({ ...state, expanded })} selected={state.selected} onSelectedChange={(selected) => set({ ...state, selected })}
              onRename={noop} onMove={noop} loading={new Set(["day2", "music"])} menu={() => [{ id: "rename", label: "Rename", keys: ["F2"] }, { id: "delete", label: "Delete", danger: true }]} />
          </View>
        )}</Stateful>),
        entry("Tree", "selected", <View style={{ width: 260 }}><Tree label="Rename and drop" nodes={TREE} expanded={new Set(["footage", "day1"])} onExpandedChange={noop} selected={new Set(["drone"])} onSelectedChange={noop} onRename={noop} renaming="market" dropPreview={{ id: "drone", position: "after" }} /></View>, { label: "inline rename · insertion line" }),
        entry("Tree", "loading", <View style={{ width: 260 }}><Tree label="Loading" nodes={TREE} expanded={new Set(["footage", "day2"])} onExpandedChange={noop} selected={new Set()} onSelectedChange={noop} loading={new Set(["day2"])} /></View>, { label: "lazy children" }),
      ],
    },
    {
      id: "disclosure", title: "Disclosure · Accordion · Breadcrumb", layout: "column",
      entries: [
        entry("Disclosure", "rest", <Stateful initial={false}>{(open, set) => <Disclosure title="Advanced" summary="3 options" open={open} onToggle={set}><Text color="text/secondary" style={{ padding: space[2] }}>Shown when the section is first opened.</Text></Disclosure>}</Stateful>, { label: "closed" }),
        entry("Disclosure", "selected", <Stateful initial>{(open, set) => <Disclosure title="Reasoning" summary={4} open={open} onToggle={set}><Text color="text/secondary" style={{ padding: space[2] }}>Collapsed tool calls and reasoning in chat use this.</Text></Disclosure>}</Stateful>, { label: "open" }),
        entry("Disclosure", "disabled", <Disclosure title="Locked section" open={false} onToggle={noop} disabled><Text>—</Text></Disclosure>),
        entry("Disclosure", "hover", <Stateful initial={["transform"]}>{(open, set) => <Accordion single open={open} onChange={set} sections={[{ id: "transform", title: "Transform", content: <Text color="text/secondary" style={{ padding: space[2] }}>Position, scale, rotation.</Text> }, { id: "blend", title: "Blend", content: <Text color="text/secondary" style={{ padding: space[2] }}>Opacity and blend mode.</Text> }, { id: "mask", title: "Mask", content: <Text color="text/secondary" style={{ padding: space[2] }}>Shape and feather.</Text> }]} />}</Stateful>, { label: "single-mode accordion" }),
        entry("Breadcrumb", "rest", <Breadcrumb segments={[{ id: "settings", label: "Settings", icon: "gear", onPress: noop }, { id: "host", label: "Host", onPress: noop }, { id: "secrets", label: "Secrets" }]} />),
        entry("Breadcrumb", "hover", <View style={{ width: 320 }}><Breadcrumb segments={[{ id: "a", label: "Projects", onPress: noop }, { id: "b", label: "Client work", onPress: noop }, { id: "c", label: "Travel 2026", onPress: noop }, { id: "d", label: "Da Lat in forty-eight hours, vertical", onPress: noop }, { id: "e", label: "Exports", onRename: noop }]} /></View>, { label: "collapsed middle segments, in a 320 px bar" }),
      ],
    },
    {
      id: "overlays", title: "Tooltip · Popover · Menu · ContextMenu · AppMenu", layout: "column",
      entries: [
        entry("Tooltip", "rest", <Row top><TooltipBubble label="Auto snapping" keys={["N"]} /><TooltipBubble label="Not available for audio clips on a locked track" /><Tooltip label="Split" keys={["Mod", "B"]}><IconButton icon="scissors" label="Split" noTooltip /></Tooltip></Row>),
        entry("Menu", "rest", <Row top><StaticPopover><MenuList items={MENU} onClose={noop} onCloseAll={noop} autoFocus={false} label="Project actions" /></StaticPopover>
          <StaticPopover width={170}><MenuList items={MENU.find((item) => "id" in item && item.id === "move") && "submenu" in MENU[3]! ? MENU[3]!.submenu! : []} onClose={noop} onCloseAll={noop} autoFocus={false} label="Move to" /></StaticPopover></Row>, { label: "icons · shortcut hints · submenu · switch row · disabled · requires host · destructive" }),
        entry("Popover", "rest", <StaticPopover width={220}><View style={{ padding: space[2], gap: space[1] }}><Text variant="body-medium">Filters</Text><Text variant="meta" color="text/secondary">bg/elevated, radius 8, elevation/2.</Text></View></StaticPopover>),
        entry("ContextMenu", "rest", <ContextMenu items={MENU} label="Clip"><Card style={{ width: 220 }}><Text>Right-click, press the Menu key or long-press here.</Text></Card></ContextMenu>),
        entry("AppMenu", "rest", <View style={{ gap: space[2] }}><AppMenu model={APP_MENU} desktopApp /><AppMenu model={APP_MENU} desktopApp expanded /></View>, { label: "button, and menu bar at 1,200 px and above (Windows and Linux desktop app only)" }),
        entry("Popover", "selected", <OverlayButtons open={open} ids={["popover"]} />, { label: "anchored popover" }),
        entry("Menu", "selected", <OverlayButtons open={open} ids={["menu"]} />, { label: "dropdown menu" }),
        entry("Modal", "rest", <OverlayButtons open={open} ids={["modal", "confirm", "destructive", "picker", "tags", "detail", "progress"]} />, { label: "form · confirm · destructive confirm · list picker · tag picker · tabbed detail · progress" }),
        entry("SideSheet", "rest", <OverlayButtons open={open} ids={["sidesheet"]} />),
        entry("BottomSheet", "rest", <OverlayButtons open={open} ids={["bottomsheet", "toolsheet"]} />, { label: "modal · non-modal tool sheet" }),
        entry("AdaptiveSheet", "rest", <OverlayButtons open={open} ids={["adaptive"]} />, { label: "modal on wide, bottom sheet on compact" }),
        entry("Drawer", "rest", <OverlayButtons open={open} ids={["drawer"]} />),
        entry("Toast", "selected", <OverlayButtons open={open} ids={["toast"]} />, { label: "queue with Undo" }),
      ],
    },
    {
      id: "toast", title: "Toast", layout: "column",
      entries: [
        entry("Toast", "rest", <View style={{ gap: space[2], alignItems: "flex-start" }}>
          <ToastView toast={{ id: 1, kind: "success", message: "Project moved to trash", undo: noop, count: 1, remaining: 8000, visible: true }} />
          <ToastView toast={{ id: 2, kind: "info", message: "Copied", count: 1, remaining: 4000, visible: true }} />
          <ToastView toast={{ id: 3, kind: "warning", message: "Host offline — changes are kept on this device", count: 2, remaining: 4000, visible: true }} />
          <ToastView toast={{ id: 4, kind: "error", message: "Export failed: not enough free space", action: { label: "View", onPress: noop }, sticky: true, count: 1, remaining: null, visible: true }} />
        </View>, { label: "success with Undo · info · warning (merged ×2) · error with action" }),
        entry("Toast", "loading", <ToastView toast={{ id: 5, kind: "progress", message: "Processing 3 of 8", progress: 38, count: 1, remaining: null, visible: true }} />, { label: "progress" }),
      ],
    },
    {
      id: "callout", title: "Callout · Banner", layout: "column",
      entries: [
        entry("Callout", "rest", <View style={{ gap: space[1.5] }}>
          <Callout tone="info">Uploads continue in the background and resume after connection loss.</Callout>
          <Callout tone="success">All six steps complete.</Callout>
          <Callout tone="warning" actions={[{ label: "Learn more", onPress: noop }]}>Trigger content is untrusted. The agent treats it as data, not instructions.</Callout>
          <Callout tone="danger">Primary route failing: 3 consecutive timeouts.</Callout>
        </View>),
        entry("Banner", "rest", <View style={{ gap: space[1.5] }}>
          <Banner id="cat-offline" tone="warning" actions={[{ label: "Retry now", onPress: noop }]} dismissible="session">Host offline — reconnecting…</Banner>
          <Banner id="cat-readonly" tone="info" actions={[{ label: "Take over editing", onPress: noop }]}>Open on Studio Mac — view only</Banner>
          <Banner id="cat-renderer" tone="danger">The renderer is degraded: previews use the software path.</Banner>
          <Banner id="cat-update" tone="success" actions={[{ label: "Restart", onPress: noop }, { label: "Later", onPress: noop }]}>Version 1.4 is ready to install.</Banner>
        </View>),
      ],
    },
    {
      id: "progress", title: "Progress · Spinner · StatusRing · Stepper · Skeleton", layout: "column",
      entries: [
        entry("ProgressBar", "rest", <Row><ProgressBar value={42} label="Export" /><Text variant="meta" color="text/secondary" tabular>42%</Text><Button size="xs" kind="ghost" label="Cancel" onPress={noop} /></Row>, { label: "determinate" }),
        entry("ProgressBar", "loading", <View style={{ gap: space[3] }}><ProgressBar label="Uploading" /><ProgressBar thin value={70} label="Upload" /><OperationProgress active label="Generating proxies" value={12} /></View>, { label: "indeterminate · thin · after 1 s of work" }),
        entry("Spinner", "rest", <Row gap={space[3]}><Spinner size={12} /><Spinner /><Spinner size={16} /><Spinner size={24} /></Row>, { label: "12 · 14 · 16 · 24" }),
        entry("StatusRing", "rest", <Row gap={space[3]}><StatusRing value={64} label="Rendering, 64%" /><Text variant="meta" color="text/secondary">ring 64%</Text><StatusRing state="done" label="Done" /><StatusRing state="failed" label="Failed" /></Row>),
        entry("Stepper", "rest", <View style={{ gap: space[3] }}><Stepper title="Get started" current={2} total={6} /><Stepper current={1} stages={["Story", "Script", "Assets", "Storyboard"]} /></View>),
        entry("Skeleton", "rest", <View style={{ gap: space[1.5] }}><Skeleton width="70%" /><Skeleton width="45%" /><Skeleton height={60} /></View>),
        entry("Skeleton", "loading", <View style={{ gap: space[6] }}><SkeletonText /><SkeletonList rows={3} leading="icon" /><SkeletonList rows={2} leading="thumb" meta /><SkeletonGrid items={3} minWidth={140} /><SkeletonTable rows={3} /><SkeletonCards cards={1} /><SkeletonChat turns={1} /></View>, { label: "text · list · list with thumbnails · grid · table · setting cards · chat" }),
      ],
    },
    {
      id: "empty", title: "Empty · no-results · error · requires-host", span: 2, layout: "column",
      entries: [
        entry("EmptyState", "rest", <Row top gap={space[5]}>
          <View style={{ flex: 1, minWidth: 260 }}><FirstUseState icon="folder" title="No projects yet" description="Projects hold your timeline, media and exports." action={{ label: "Create your first project", onPress: noop }} /></View>
          <View style={{ flex: 1, minWidth: 260 }}><NoResultsState query="lantern" description="Try another name or clear the search." onClear={noop} /></View>
          <View style={{ flex: 1, minWidth: 260 }}><ErrorState title="Couldn’t load sessions" error={ERROR} resolve={(code) => (code === "RATE_LIMITED" ? "The host is busy. Try again in a moment." : undefined)} onRetry={noop} /></View>
          <View style={{ flex: 1, minWidth: 260 }}><RequiresHostState feature="Workflows" description="Connect a host to generate videos from a prompt." onConnect={noop} /></View>
        </Row>, { label: "first use · no results · error · requires host" }),
        entry("EmptyState", "invalid", <EmptyState icon="warn" title="Couldn’t load exports" description="Something went wrong (E_UNKNOWN_42)" actions={[{ label: "Retry", onPress: noop }]} />, { label: "error with an unknown code" }),
      ],
    },
    {
      id: "content", title: "QRCode · MarkdownView · CodeBlock", span: 2, layout: "column",
      entries: [
        entry("QRCode", "rest", <Row top gap={space[6]}>
          <QRCode value="jagentchill://pair#offer=eyJ2IjoxLCJob3N0IjoiU3R1ZGlvIE1hYyJ9" description="pairing offer for Studio Mac" size={160}><CopyValue label="Pairing link" value="jagentchill://pair#offer=eyJ2…" /></QRCode>
          <QRCode value="x" description="loading" size={160} state="loading"><Text variant="meta" color="text/secondary">Loading…</Text></QRCode>
          <QRCode value="x" description="expired offer" size={160} state="expired" onNewCode={noop}><Text variant="meta" color="text/secondary">The offer lasted 10 minutes.</Text></QRCode>
          <QRCode value={"x".repeat(3000)} description="too long" size={160}><CopyValue label="Link" value="jagentchill://pair#offer=…" /></QRCode>
        </Row>, { label: "ready · loading · expired · error" }),
        entry("MarkdownView", "rest", <MarkdownView source={MARKDOWN} onLink={noop} />),
        entry("MarkdownView", "loading", <MarkdownView streaming source={"Here is the function:\n\n```ts\nexport function ticks(seconds: number) {\n  return Math.round(seconds * 120000);"} onLink={noop} />, { label: "streaming: an open code fence" }),
        entry("CodeBlock", "rest", <CodeBlock code={CODE} lang="ts" showLineNumbers action={{ label: "Apply", onPress: noop }} />),
        entry("CodeBlock", "selected", <CodeBlock code={Array.from({ length: 120 }, (_, i) => `line ${i + 1}`).join("\n")} lang="text" />, { label: "collapsed after 30 lines" }),
      ],
    },
    {
      id: "composer", title: "Composer primitive", span: 2, layout: "column", note: "Empty → send disabled (bg/subtle). Text → strong + split chevron. Run active → stop. The banner slot sits inside the card. Focus = 2 px border/control.",
      entries: [
        entry("Composer", "rest", <Stateful initial="">{(value, set) => <Composer docked placeholder="Describe the video you want, or ask for an edit…" value={value} onChangeText={set} onSend={() => set("")} mode={{ id: "mode", label: "Agent", icon: "bot", menu: [{ id: "agent", label: "Agent", checked: true }, { id: "ask", label: "Ask", checked: false }] }} onAttach={noop} onDictate={noop}
          pills={[{ id: "model", label: "Sonnet", onPress: noop }, { id: "thinking", label: "Thinking", icon: "sparkles", onPress: noop }, { id: "auto", label: "Autonomous", unattended: true, onPress: noop }]} sendOptions={[{ id: "queue", label: "Send when the run ends" }]} />}</Stateful>, { label: "empty" }),
        entry("Composer", "focus-visible", <Composer docked forceFocus placeholder="…" value="Make a 30 s vertical teaser from the drone shots" onChangeText={noop} onSend={noop} mode={{ id: "mode", label: "Agent", icon: "bot" }} onAttach={noop} onDictate={noop}
          attachments={[{ name: "drone_dalat_01.mp4", size: "84 MB", status: "ready", icon: "video" }]} onRemoveAttachment={noop} sendOptions={[{ id: "queue", label: "Send when the run ends" }]} />, { label: "text and attachment, focused" }),
        entry("Composer", "loading", <Composer docked placeholder="Guide the agent while it works…" value="" onChangeText={noop} onSend={noop} onStop={noop} running mode={{ id: "mode", label: "Agent", icon: "bot" }} onAttach={noop} onDictate={noop}
          banner={<><Text variant="meta" style={{ flex: 1 }}>Connect a host to use the agent</Text><Button size="xs" label="Connect" onPress={noop} /></>} />, { label: "run active, with the banner slot" }),
        entry("Composer", "invalid", <View style={{ width: 320 }}><Composer placeholder="Ask for an edit…" value="Retry the upload" onChangeText={noop} onSend={noop} mode={{ id: "mode", label: "Agent", icon: "bot" }} onAttach={noop}
          attachments={[{ name: "brief.pdf", status: "failed", error: "Failed" }]} onRemoveAttachment={noop} onRetryAttachment={noop}
          pills={["Model", "Thinking", "Features", "Skills", "Team mode", "Autonomous"].map((label) => ({ id: label, label, onPress: noop }))} /></View>, { label: "320 px wide: failed attachment blocks sending, six pills overflow" }),
        entry("Composer", "disabled", <Composer docked disabled placeholder="This session is archived." value="" onChangeText={noop} onSend={noop} mode={{ id: "mode", label: "Agent", icon: "bot" }} />),
      ],
    },
    {
      id: "panels", title: "PanelGroup splitter", layout: "column", note: "1 px hairline, 8 px hit area (16 px on touch); 2 px accent on hover, drag and focus. Arrow keys ±1 %, Shift ±5 %; double-click resets; Enter collapses.",
      entries: [
        entry("PanelGroup", "rest", <PanelFrame><PanelGroup label="Resize panels" panels={["Asset panel", "Player", "Inspector"].map((label, index) => ({ id: label, default: index === 1 ? 50 : 25, min: 15, max: 60, collapsible: index !== 1, content: <Centre>{label}</Centre> }))} /></PanelFrame>),
        entry("PanelGroup", "focus-visible", <PanelFrame><PanelGroup label="Resize panels" forceActive={1} panels={["Chat", "Workspace", "Agents"].map((label, index) => ({ id: label, default: index === 1 ? 50 : 25, min: 15, content: <Centre>{label}</Centre> }))} /></PanelFrame>, { label: "splitter focused" }),
      ],
    },
    {
      id: "charts", title: "Charts — vertical bar, stacked, horizontal bar, line, Sparkline", span: 2, layout: "column",
      entries: [
        entry("BarChart", "rest", <BarChart label="Usage by day" emptyMessage="No usage yet" categories={["Mon", "Tue", "Wed", "Thu", "Fri"]} series={[{ name: "Agent", values: [12, 18, 9, 22, 15] }, { name: "Generation", values: [6, 4, 11, 8, 13] }]} stacked />, { label: "stacked" }),
        entry("BarChart", "selected", <BarChart label="Exports by day" emptyMessage="No exports yet" categories={["Mon", "Tue", "Wed"]} series={[{ name: "1080p", values: [3, 5, 2] }, { name: "4K", values: [1, 0, 2] }]} />, { label: "grouped" }),
        entry("HorizontalBarChart", "rest", <HorizontalBarChart label="Share by provider" emptyMessage="No usage yet" categories={["Anthropic", "OpenAI", "Local"]} series={[{ name: "Tokens (k)", values: [420, 260, 90] }]} height={96} />),
        entry("LineChart", "rest", <LineChart label="Runs per day" emptyMessage="No runs yet" categories={["1", "2", "3", "4", "5", "6", "7"]} series={[{ name: "Succeeded", values: [4, 6, 5, 9, 7, 8, 9] }, { name: "Failed", values: [1, 0, 2, 1, 0, 1, 0] }]} />),
        entry("LineChart", "disabled", <LineChart label="Runs per day" emptyMessage="No runs in this period" categories={[]} series={[]} height={80} />, { label: "empty" }),
        entry("Sparkline", "rest", <Row gap={space[3]}><Sparkline values={[0, 2, 1, 4, 3, 6, 9, 5, 4, 7, 3, 2, 6, 4]} summary="Runs per day, last 14 days: lowest 0, highest 9, latest 4" /><Text variant="meta" tabular>4</Text><Sparkline kind="bar" tone="success" values={[1, 3, 2, 5, 4, 6, 3]} summary="Exports per day, last 7 days: lowest 1, highest 6, latest 3" width={64} /><Text variant="meta" tabular>3</Text></Row>),
      ],
    },
    {
      id: "timeline", title: "Timeline atoms — ruler, playhead, clips by type and state, keyframes, marker, snap line, transition handle, range, track header, zoom, transport", span: 3, layout: "column",
      note: "Row, ruler, marker, playhead and handle sizes are those of timeline-editing on desktop and of mobile-editor on touch; the atoms take them as props.",
      entries: [entry("Timeline atoms", "rest", <TimelineDemo dimensions={timeline} />, { label: "every atom in every state" })],
    },
  ];
}

const Centre = (props: { children: ReactNode }) => <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><Text color="text/secondary">{props.children}</Text></View>;
function PanelFrame(props: { children: ReactNode }) {
  const theme = useTheme();
  return <View style={{ height: space[16] + space[2], borderWidth: borderWidth.hairline, borderColor: theme.color("border/hairline"), borderRadius: radius.sm, overflow: "hidden", flexDirection: "row" }}>{props.children}</View>;
}

/** The dimensions `timeline-editing` and `mobile-editor` own; the caller of the catalogue passes them in. */
export type TimelineDimensions = { row: number; rowGap: number; header: number; ruler: number; marker: { width: number; height: number }; playhead: { line: number; handle: number }; trim: number; transition: number };

function TimelineDemo(props: { dimensions: { desktop: TimelineDimensions; touch: TimelineDimensions } }) {

  const theme = useTheme();
  const d = props.dimensions[theme.touch ? "touch" : "desktop"];
  const [zoom, setZoom] = useState(40);
  const [playing, setPlaying] = useState(false);
  const [track, setTrack] = useState({ hidden: false, locked: false, muted: true });
  const film = <Filmstrip frames={["clip/text", "clip/sticker", "clip/image", "clip/compound"].map((tone) => <ThumbnailTile key={tone} tone={tone as "clip/text"} />)} />;
  const lane = (children: ReactNode, options: { alt?: boolean; locked?: boolean; drop?: boolean; name: string } ) => (
    <View style={{ flexDirection: "row", marginTop: d.rowGap }}>
      <TrackHeader name={options.name} width={d.header} height={d.row} hidden={track.hidden} locked={Boolean(options.locked) || track.locked} muted={track.muted} onRename={noop} onToggle={(what, on) => setTrack({ ...track, [what]: on })} />
      <TrackLane height={d.row} alt={options.alt} locked={options.locked} dropTarget={options.drop}><View style={{ flexDirection: "row", gap: space[1], alignItems: "center", height: d.row }}>{children}</View></TrackLane>
    </View>
  );
  const clip = (props: Partial<Parameters<typeof Clip>[0]> & { label: string }) => <Clip type="video" width={128} height={d.row} trimHandleWidth={d.trim} {...props} />;
  return (
    <View style={{ gap: space[2] }}>
      <Row gap={space[4]}>
        <Transport playing={playing} onToggle={() => setPlaying(!playing)} timecode="00:00:01:12" duration="00:00:32:00" />
        <ZoomSlider value={zoom} min={10} max={100} onChange={setZoom} />
        <Row gap={space[3]}><KeyframeDiamond /><KeyframeDiamond selected /><TransitionHandle size={d.transition} set={false} /><TransitionHandle size={d.transition} set /><TransitionHandle size={d.transition} set selected /><SnapLine height={d.row} /><DropIndicator kind="insert" width={64} /><DropIndicator kind="ghost" width={64} height={d.row} /></Row>
      </Row>
      <View>
        <View style={{ marginStart: d.header }}>
          <Ruler width={760} height={d.ruler} pixelsPerUnit={zoom} minorSteps={[0.1, 0.5, 1, 5, 10]} majorEvery={5} label={(unit) => `00:${String(Math.round(unit)).padStart(2, "0")}`} />
          <View style={{ position: "absolute", start: 118, top: d.ruler - d.marker.height }}><Marker color={0} flag={d.marker} lineHeight={3 * d.row} name="Beat drop" /></View>
          <View style={{ position: "absolute", start: 300, top: d.ruler - d.marker.height }}><Marker color={4} flag={d.marker} lineHeight={3 * d.row} /></View>
        </View>
        {lane(<>{CLIP_TYPES.map((type) => <Clip key={type} type={type} label={type} width={64} height={d.row} trimHandleWidth={d.trim} />)}</>, { name: "Clip types" })}
        {lane(<>{clip({ label: "rest" })}{clip({ label: "hover", forceState: "hover" })}{clip({ label: "selected", selected: true })}{clip({ label: "dragging", dragging: true })}{clip({ label: "drop target", dropTarget: true })}</>, { name: "States", alt: true })}
        {lane(<>{clip({ label: "hidden", hidden: true, filmstrip: film })}{clip({ label: "muted", type: "audio", muted: true, waveform: <Waveform peaks={PEAKS} width={128} height={d.row - 16} muted /> })}{clip({ label: "locked", locked: true })}{clip({ label: "offline", offline: true })}{clip({ label: "group", group: "idle" })}{clip({ label: "group selected", group: "selected" })}</>, { name: "Flags" })}
        {lane(<>{clip({ label: "filmstrip", filmstrip: film, badges: { speed: "2×", duration: "00:04", linked: true, keyframes: true, effects: true }, width: 220 })}
          {clip({ label: "waveform", type: "audio", width: 200, waveform: <Waveform peaks={[...PEAKS.slice(0, 20), 1.2, 1.3, ...PEAKS.slice(22)]} width={200} height={d.row - 16} beats={[0.1, 0.35, 0.6, 0.85]} /> })}
          {clip({ label: "from a script", provenance: "script", type: "text" })}{clip({ label: "trimmed", trimAdjusted: "end", type: "caption" })}</>, { name: "Content", alt: true })}
        {lane(<><RangeBar width={160} height={d.row} /></>, { name: "Locked", locked: true })}
        {lane(null, { name: "Drop here", drop: true, alt: true })}
        <View pointerEvents="none" style={{ position: "absolute", start: d.header + 60, top: 0, bottom: 0 }}><Playhead height={d.ruler + 6 * (d.row + d.rowGap)} lineWidth={d.playhead.line} handle={d.playhead.handle} /></View>
      </View>
      <Kbd keys={["Space"]} />
    </View>
  );
}
