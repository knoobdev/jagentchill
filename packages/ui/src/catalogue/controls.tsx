import { useState, type ReactNode } from "react";
import { View } from "react-native";
import { Avatar, Badge, Dot, StatusPill } from "../avatar.tsx";
import { Button, IconButton, ToggleButton, type ButtonKind } from "../button.tsx";
import { AddFilterChip, AttachmentChip, Chip, FilterChip, Tag, TokenChip } from "../chips.tsx";
import { ColorPicker, Swatch } from "../colorpicker.tsx";
import { DateField, DateRangeField, TimeField, WeekdayPicker } from "../date.tsx";
import { FormField, Input, Textarea } from "../input.tsx";
import { Kbd } from "../kbd.tsx";
import { MenuButton, SplitButton } from "../menu.tsx";
import { NumberField } from "../number.tsx";
import { SearchField } from "../search.tsx";
import { Combobox, Select } from "../select.tsx";
import { Slider } from "../slider.tsx";
import { Segmented, TabPanel, TabStrip, Tabs } from "../tabs.tsx";
import { Text } from "../text.tsx";
import { useTheme } from "../theme.tsx";
import { Checkbox, Radio, RadioGroup, Switch } from "../toggles.tsx";
import { TooltipBubble } from "../tooltip.tsx";
import { space } from "../tokens.ts";
import { SAMPLE_COLORS } from "../logic/color.ts";
import { entry, type Section } from "./frame.tsx";
import type { ForcedState } from "../tap.tsx";

const STATES: Array<[string, ForcedState | undefined, boolean]> = [["rest", undefined, false], ["hover", "hover", false], ["pressed", "pressed", false], ["focus-visible", "focus", false], ["disabled", undefined, true]];
const BUTTONS: Array<[ButtonKind, string]> = [["primary", "Export"], ["strong", "Create"], ["secondary", "Cancel"], ["outline", "Cancel"], ["ghost", "Cancel"], ["link", "Learn more"], ["destructive", "Delete project"]];
const Row = (props: { children: ReactNode; gap?: number }) => <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: props.gap ?? space[2] }}>{props.children}</View>;
const Labelled = (props: { label: string; children: ReactNode }) => <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}><Text variant="meta" color="text/secondary" style={{ width: space[16] + space[6] }}>{props.label}</Text>{props.children}</View>;

function Stateful<T>(props: { initial: T; children(value: T, set: (value: T) => void): ReactNode }) {
  const [value, set] = useState(props.initial);
  return <>{props.children(value, set)}</>;
}
const noop = () => {};
const LANGUAGES = [{ value: "en", label: "English" }, { value: "ja", label: "日本語" }, { value: "vi", label: "Tiếng Việt (Vietnamese)" }, { value: "fr", label: "Français" }];
const FPS = [{ value: "24", label: "24 fps" }, { value: "25", label: "25 fps" }, { value: "30", label: "30 fps" }, { value: "50", label: "50 fps" }, { value: "60", label: "60 fps" }, { value: "match", label: "Match first clip", disabled: true }];

export function controlSections(): Section[] {
  return [
    {
      id: "button", title: "Button — variants × states", span: 2, layout: "column",
      entries: [
        ...BUTTONS.map(([kind, label]) => entry("Button", "rest", <Row gap={space[3]}>{STATES.map(([state, forced, disabled]) => (
          <View key={state} style={{ alignItems: "center", gap: space[1] }}><Button kind={kind} label={label} forceState={forced} disabled={disabled} onPress={noop} /><Text variant="caption" color="text/secondary">{state}</Text></View>
        ))}</Row>, { label: kind })),
        entry("Button", "hover", <Row><Button kind="primary" label="Export" forceState="hover" /><Button kind="secondary" label="Cancel" forceState="hover" /></Row>),
        entry("Button", "pressed", <Row><Button kind="primary" label="Export" forceState="pressed" /><Button kind="strong" label="Create" forceState="pressed" /></Row>),
        entry("Button", "focus-visible", <Row><Button kind="primary" label="Export" forceState="focus" /></Row>),
        entry("Button", "disabled", <Row><Button kind="primary" label="Export" disabled /></Row>),
        entry("Button", "loading", <Row>
          <Button size="xs" label="Add" /><Button size="sm" label="Add" /><Button size="md" label="Add" /><Button size="lg" label="Add" />
          <Button kind="strong" icon="plus" label="New project" /><Button kind="primary" icon="export" label="Export" loading /><Button kind="primary" label="Export" loading />
          <SplitButton kind="primary" label="Merge" menuLabel="Merge options" onPress={noop} items={[{ id: "squash", label: "Squash and merge" }, { id: "rebase", label: "Rebase and merge" }]} />
          <MenuButton label="Sort" items={[{ id: "name", label: "Name", checked: true }, { id: "date", label: "Date modified", checked: false }]} />
          <Button kind="secondary" icon="zap" label="Generate" requiresHost />
        </Row>, { label: "sizes xs 24 · sm 28 · md 32 · lg 40, icon, loading, split, menu, requires host" }),
      ],
    },
    {
      id: "iconbutton", title: "IconButton · ToggleButton",
      entries: [
        entry("IconButton", "rest", <IconButton icon="scissors" size="xs" label="Split" noTooltip />, { label: "24" }),
        entry("IconButton", "rest", <IconButton icon="scissors" label="Split" shortcut="edit.split" />, { label: "28 rest" }),
        entry("IconButton", "hover", <IconButton icon="scissors" label="Split" forceState="hover" noTooltip />),
        entry("IconButton", "pressed", <IconButton icon="scissors" label="Split" forceState="pressed" noTooltip />),
        entry("IconButton", "focus-visible", <IconButton icon="scissors" label="Split" forceState="focus" noTooltip />, { label: "focus" }),
        entry("IconButton", "disabled", <IconButton icon="scissors" label="Split" disabled noTooltip />),
        entry("IconButton", "rest", <IconButton icon="scissors" label="Split" variant="outline" noTooltip />, { label: "outline" }),
        entry("IconButton", "rest", <IconButton icon="scissors" size="md" label="Split" noTooltip />, { label: "32" }),
        entry("ToggleButton", "selected", <Stateful initial>{(on, set) => <ToggleButton icon="magnet" label="Auto snapping" on={on} onChange={set} />}</Stateful>, { label: "toggle on" }),
        entry("ToggleButton", "rest", <Stateful initial={false}>{(on, set) => <ToggleButton icon="magnet" label="Auto snapping" on={on} onChange={set} />}</Stateful>, { label: "off" }),
        entry("ToggleButton", "hover", <ToggleButton icon="magnet" label="Auto snapping" on={false} onChange={noop} forceState="hover" />),
        entry("ToggleButton", "pressed", <ToggleButton icon="magnet" label="Auto snapping" on={false} onChange={noop} forceState="pressed" />),
        entry("ToggleButton", "focus-visible", <ToggleButton icon="magnet" label="Auto snapping" on onChange={noop} forceState="focus" />),
        entry("ToggleButton", "disabled", <ToggleButton icon="magnet" label="Auto snapping" on onChange={noop} disabled />),
        entry("ToggleButton", "selected", <ToggleButton icon="snap" tone="accent" label="Snap to beats" on onChange={noop} />, { label: "accent tone" }),
        entry("Tooltip", "rest", <TooltipBubble label="Split" keys={["Mod", "B"]} />, { label: "tooltip + key hint" }),
      ],
    },
    {
      id: "input", title: "Input · Textarea · FormField · SearchField", layout: "column",
      entries: [
        entry("Input", "rest", <Labelled label="rest"><Input accessibilityLabel="Search projects" leadingIcon="search" placeholder="Search projects…" value="" onChangeText={noop} style={{ flex: 1 }} /></Labelled>),
        entry("Input", "hover", <Labelled label="hover"><Input accessibilityLabel="Name" value="Da Lat" onChangeText={noop} forceState="hover" style={{ flex: 1 }} /></Labelled>),
        entry("Input", "focus-visible", <Labelled label="focus"><Input accessibilityLabel="Name" value="Da Lat in 48 hours" onChangeText={noop} clearable clearAlways forceState="focus" style={{ flex: 1 }} /></Labelled>),
        entry("Input", "disabled", <Labelled label="disabled"><Input accessibilityLabel="Host" value="Studio Mac" disabled style={{ flex: 1 }} /></Labelled>),
        entry("Input", "read-only", <Labelled label="read-only"><Input accessibilityLabel="Session id" mono readOnly value="ses_8f41c2e0" style={{ flex: 1 }} /></Labelled>),
        entry("Input", "pressed", <Labelled label="prefix · suffix"><Input accessibilityLabel="Bitrate" prefix="≈" suffix="Mbps" value="12" onChangeText={noop} forceState="pressed" style={{ flex: 1 }} /></Labelled>),
        entry("Input", "invalid", <FormField label="Project name" required><Input accessibilityLabel="Project name" placeholder="Required" value="" onChangeText={noop} error="Enter a name for the project." /></FormField>),
        entry("FormField", "rest", <Stateful initial="Da Lat teaser">{(value, set) => (
          <FormField label="Project name" description="Shown in the project list." value={value} validate={(text) => (String(text).trim() ? undefined : "Enter a name for the project.")}>
            {(ids) => <Input labelledBy={ids.labelledBy} describedBy={ids.describedBy} value={value} onChangeText={set} onBlur={ids.onBlur} error={ids.error} />}
          </FormField>
        )}</Stateful>),
        entry("FormField", "invalid", <FormField label="Device name" error="Use at most 64 characters."><Input accessibilityLabel="Device name" value="Studio Mac in the editing room on the second floor of the building" invalid onChangeText={noop} /></FormField>),
        entry("FormField", "disabled", <FormField label="Host name" description="Set by the host."><Input accessibilityLabel="Host name" value="Studio Mac" disabled /></FormField>),
        entry("FormField", "hover", <FormField label="Description"><Input accessibilityLabel="Description" value="Teaser" onChangeText={noop} forceState="hover" /></FormField>),
        entry("FormField", "pressed", <FormField label="Description"><Input accessibilityLabel="Description" value="Teaser" onChangeText={noop} forceState="pressed" /></FormField>),
        entry("FormField", "focus-visible", <FormField label="Description"><Input accessibilityLabel="Description" value="Teaser" onChangeText={noop} forceState="focus" /></FormField>),
        entry("Textarea", "rest", <Stateful initial="Cut silences longer than 0.6 s, keep the laugh at 00:41, and add burned-in captions in Vietnamese.">{(value, set) => (
          <FormField label="Instructions" description="Grows from 2 to 8 lines, then scrolls."><Textarea accessibilityLabel="Instructions" value={value} onChangeText={set} maxLength={8000} counter /></FormField>
        )}</Stateful>),
        entry("Textarea", "hover", <Textarea accessibilityLabel="Notes" value="Hover" onChangeText={noop} forceState="hover" />),
        entry("Textarea", "pressed", <Textarea accessibilityLabel="Notes" value="Pressed" onChangeText={noop} forceState="pressed" />),
        entry("Textarea", "focus-visible", <Textarea accessibilityLabel="Notes" value="Focused" onChangeText={noop} forceState="focus" />),
        entry("Textarea", "disabled", <Textarea accessibilityLabel="Notes" value="Disabled" disabled />),
        entry("Textarea", "invalid", <Textarea accessibilityLabel="Notes" value="" onChangeText={noop} error="Write at least one instruction." />),
        entry("Textarea", "read-only", <Textarea accessibilityLabel="Notes" value="Read-only notes." readOnly />),
        entry("SearchField", "rest", <Stateful initial="">{(value, set) => <SearchField label="Search projects" placeholder="Search projects…" value={value} onChangeText={set} trailing={<Kbd keys={["Mod", "K"]} />} />}</Stateful>),
        entry("SearchField", "focus-visible", <Stateful initial="intro">{(value, set) => <SearchField label="Search clips" value={value} onChangeText={set} resultCount={12} forceState="focus" />}</Stateful>, { label: "focus, with text and result count" }),
        entry("SearchField", "loading", <SearchField label="Search library" value="lantern" onChangeText={noop} loading resultCount={0} />),
        entry("SearchField", "hover", <SearchField label="Search" value="" placeholder="Hover" onChangeText={noop} forceState="hover" />),
        entry("SearchField", "pressed", <SearchField label="Search" value="" placeholder="Pressed" onChangeText={noop} forceState="pressed" />),
        entry("SearchField", "disabled", <SearchField label="Search" value="" placeholder="Search…" onChangeText={noop} disabled />),
      ],
    },
    {
      id: "select", title: "Select · Combobox", layout: "column",
      entries: [
        entry("Select", "rest", <Stateful initial="30">{(value, set) => <Select label="Frame rate" options={FPS} value={value} onChange={set} width={160} />}</Stateful>),
        entry("Select", "hover", <Select label="Frame rate" options={FPS} value="30" onChange={noop} width={160} forceState="hover" />),
        entry("Select", "pressed", <Select label="Frame rate" options={FPS} value="30" onChange={noop} width={160} forceState="pressed" />),
        entry("Select", "focus-visible", <Select label="Frame rate" options={FPS} value="30" onChange={noop} width={160} forceState="focus" />),
        entry("Select", "disabled", <Select label="Frame rate" options={FPS} value="30" onChange={noop} width={160} disabled />),
        entry("Select", "invalid", <Select label="Frame rate" options={FPS} value={null} onChange={noop} width={160} invalid />),
        entry("Combobox", "rest", <Stateful initial={"vi" as string | null}>{(value, set) => <Combobox label="Language" options={LANGUAGES} value={value} onChange={(next) => set(next as string)} width={240} />}</Stateful>),
        entry("Combobox", "selected", <Stateful initial={["en", "ja"]}>{(value, set) => <Combobox label="Subtitle languages" options={LANGUAGES} value={value} onChange={(next) => set(next as string[])} onCreate={noop} width={320} />}</Stateful>, { label: "multi-select with chips and Create" }),
        entry("Combobox", "loading", <Combobox label="Voice" options={() => new Promise<Array<{ value: string; label: string }>>(() => {})} value={null} onChange={noop} placeholder="Choose a voice" width={240} />, { label: "async source" }),
        entry("Combobox", "invalid", <Combobox label="Language" options={LANGUAGES} value={null} onChange={noop} invalid placeholder="Required" width={240} />),
        entry("Combobox", "disabled", <Combobox label="Language" options={LANGUAGES} value="en" onChange={noop} disabled width={240} />),
        entry("Combobox", "hover", <Combobox label="Language" options={LANGUAGES} value="fr" onChange={noop} width={240} forceState="hover" />),
        entry("Combobox", "pressed", <Combobox label="Language" options={LANGUAGES} value="ja" onChange={noop} width={240} forceState="pressed" />),
        entry("Combobox", "focus-visible", <Combobox label="Language" options={LANGUAGES} value="vi" onChange={noop} width={240} forceState="focus" />),
      ],
    },
    {
      id: "tabs", title: "SegmentedControl · Tabs · TabStrip", layout: "column",
      entries: [
        entry("SegmentedControl", "selected", <Row>
          <Stateful initial="visual">{(value, set) => <Segmented label="Schedule editor" options={[{ value: "visual", label: "Visual" }, { value: "rrule", label: "RRULE" }]} value={value} onChange={set} />}</Stateful>
          <Stateful initial="workspace">{(value, set) => <Segmented size="sm" label="Pane" options={[{ value: "chat", label: "Chat" }, { value: "workspace", label: "Workspace" }]} value={value} onChange={set} />}</Stateful>
          <Stateful initial="current">{(value, set) => <Segmented size="xs" label="Version" options={[{ value: "current", label: "Current" }, { value: "proposed", label: "Proposed" }]} value={value} onChange={set} />}</Stateful>
        </Row>, { label: "md · sm · xs" }),
        entry("SegmentedControl", "rest", <Segmented label="Density" options={[{ value: "a", label: "Comfortable" }, { value: "b", label: "Compact" }, { value: "c", label: "Dense" }]} value="a" onChange={noop} />),
        entry("SegmentedControl", "hover", <Segmented label="Hover" options={[{ value: "a", label: "Grid" }, { value: "b", label: "List" }]} value="b" onChange={noop} forceState={{ a: "hover" }} />),
        entry("SegmentedControl", "pressed", <Segmented label="Pressed" options={[{ value: "a", label: "Fit" }, { value: "b", label: "Fill" }]} value="a" onChange={noop} forceState={{ b: "pressed" }} />),
        entry("SegmentedControl", "focus-visible", <Segmented label="Focus" options={[{ value: "a", label: "Light" }, { value: "b", label: "Dark" }, { value: "c", label: "System" }]} value="c" onChange={noop} forceState={{ c: "focus" }} />),
        entry("SegmentedControl", "disabled", <Segmented label="Disabled" disabled options={[{ value: "a", label: "On" }, { value: "b", label: "Off" }]} value="a" onChange={noop} />),
        entry("Tabs", "selected", <Stateful initial="automations">{(value, set) => (
          <View>
            <Tabs id="cat-underline" label="Automations" items={[{ id: "automations", label: "Automations", count: 6 }, { id: "runs", label: "Runs" }, { id: "archived", label: "Archived", disabled: true }]} value={value} onChange={set} />
            <TabPanel group="cat-underline" id="automations" active={value === "automations"}><Text variant="meta" color="text/secondary" style={{ padding: space[3] }}>Six automations.</Text></TabPanel>
            <TabPanel group="cat-underline" id="runs" active={value === "runs"}><Text variant="meta" color="text/secondary" style={{ padding: space[3] }}>Run history.</Text></TabPanel>
          </View>
        )}</Stateful>, { label: "underline, with count badge and a disabled tab" }),
        entry("Tabs", "rest", <Stateful initial="characters">{(value, set) => <Tabs id="cat-pill" variant="pill" label="Asset kind" items={["All", "Characters", "Locations", "Props", "Voices"].map((label) => ({ id: label.toLowerCase(), label }))} value={value} onChange={set} />}</Stateful>, { label: "pill" }),
        entry("Tabs", "hover", <Tabs id="cat-hover" variant="pill" label="Hover" items={[{ id: "a", label: "All" }, { id: "b", label: "Mine" }]} value="a" onChange={noop} forceState={{ b: "hover" }} />),
        entry("Tabs", "pressed", <Tabs id="cat-pressed" variant="pill" label="Pressed" items={[{ id: "a", label: "All" }, { id: "b", label: "Mine" }]} value="a" onChange={noop} forceState={{ b: "pressed" }} />),
        entry("Tabs", "focus-visible", <Tabs id="cat-focus" label="Focus" items={[{ id: "a", label: "Overview" }, { id: "b", label: "Providers" }]} value="a" onChange={noop} forceState={{ a: "focus" }} />),
        entry("Tabs", "disabled", <Tabs id="cat-disabled" label="Disabled" items={[{ id: "a", label: "Overview" }, { id: "b", label: "Plan", disabled: true }]} value="a" onChange={noop} />),
        entry("TabStrip", "selected", <Stateful initial={{ value: "timeline", tabs: [{ id: "timeline", label: "Timeline preview", icon: "film" as const }, { id: "changes", label: "Changes" }, { id: "shotlist", label: "shotlist.md", icon: "doc" as const, closable: true }, { id: "worklog", label: "Worklog" }, { id: "notes", label: "notes.md", icon: "doc" as const, closable: true }] }}>{(state, set) => (
          <TabStrip id="cat-strip" label="Workspace" tabs={state.tabs} value={state.value} onChange={(value) => set({ ...state, value })} onNew={noop}
            onClose={(id) => set({ value: state.value === id ? "timeline" : state.value, tabs: state.tabs.filter((tab) => tab.id !== id) })}
            onReorder={(from, to) => { const tabs = [...state.tabs]; const [moved] = tabs.splice(from, 1); tabs.splice(to, 0, moved!); set({ ...state, tabs }); }} />
        )}</Stateful>, { label: "closable tabs, +, drag to reorder, overflow fade" }),
        entry("TabStrip", "rest", <TabStrip id="cat-strip-rest" tabs={[{ id: "a", label: "Files" }, { id: "b", label: "Terminal" }]} value="a" onChange={noop} />),
        entry("TabStrip", "hover", <TabStrip id="cat-strip-hover" tabs={[{ id: "a", label: "Files" }, { id: "b", label: "brief.md", closable: true }]} value="a" onChange={noop} onClose={noop} forceState={{ b: "hover" }} />),
        entry("TabStrip", "pressed", <TabStrip id="cat-strip-pressed" tabs={[{ id: "a", label: "Diagram" }, { id: "b", label: "Assets" }]} value="b" onChange={noop} forceState={{ a: "pressed" }} />),
        entry("TabStrip", "focus-visible", <TabStrip id="cat-strip-focus" tabs={[{ id: "a", label: "Agents" }, { id: "b", label: "Changes" }]} value="a" onChange={noop} forceState={{ a: "focus" }} />),
      ],
    },
    {
      id: "toggles", title: "Switch · Checkbox · Radio",
      entries: [
        entry("Switch", "rest", <Stateful initial={false}>{(value, set) => <Switch accessibilityLabel="Reduce motion" value={value} onChange={set} />}</Stateful>, { label: "off" }),
        entry("Switch", "selected", <Stateful initial>{(value, set) => <Switch accessibilityLabel="Auto snapping" value={value} onChange={set} />}</Stateful>, { label: "on" }),
        entry("Switch", "hover", <Switch accessibilityLabel="Hover" value onChange={noop} forceState="hover" />),
        entry("Switch", "pressed", <Switch accessibilityLabel="Pressed" value onChange={noop} forceState="pressed" />),
        entry("Switch", "focus-visible", <Switch accessibilityLabel="Focus" value onChange={noop} forceState="focus" />, { label: "focus" }),
        entry("Switch", "disabled", <Switch accessibilityLabel="Disabled" value onChange={noop} disabled />),
        entry("Switch", "invalid", <Switch accessibilityLabel="Invalid" value={false} onChange={noop} invalid />),
        entry("Checkbox", "rest", <Stateful initial={false}>{(value, set) => <Checkbox accessibilityLabel="Burn in captions" checked={value} onChange={set} />}</Stateful>),
        entry("Checkbox", "selected", <Checkbox accessibilityLabel="Checked" checked onChange={noop} />, { label: "checked" }),
        entry("Checkbox", "selected", <Checkbox accessibilityLabel="Some" checked={false} indeterminate onChange={noop} />, { label: "indeterminate" }),
        entry("Checkbox", "hover", <Checkbox accessibilityLabel="Hover" checked={false} onChange={noop} forceState="hover" />),
        entry("Checkbox", "pressed", <Checkbox accessibilityLabel="Pressed" checked onChange={noop} forceState="pressed" />),
        entry("Checkbox", "focus-visible", <Checkbox accessibilityLabel="Focus" checked onChange={noop} forceState="focus" />, { label: "focus" }),
        entry("Checkbox", "disabled", <Checkbox accessibilityLabel="Disabled" checked={false} onChange={noop} disabled />),
        entry("Checkbox", "invalid", <Checkbox accessibilityLabel="Invalid" checked={false} onChange={noop} invalid />),
        entry("Radio", "rest", <Radio accessibilityLabel="Rest" selected={false} onSelect={noop} />),
        entry("Radio", "selected", <Radio accessibilityLabel="Selected" selected onSelect={noop} />),
        entry("Radio", "hover", <Radio accessibilityLabel="Hover" selected={false} onSelect={noop} forceState="hover" />),
        entry("Radio", "pressed", <Radio accessibilityLabel="Pressed" selected onSelect={noop} forceState="pressed" />),
        entry("Radio", "focus-visible", <Radio accessibilityLabel="Focus" selected onSelect={noop} forceState="focus" />, { label: "focus" }),
        entry("Radio", "disabled", <Radio accessibilityLabel="Disabled" selected={false} onSelect={noop} disabled />),
        entry("Radio", "invalid", <Radio accessibilityLabel="Invalid" selected={false} onSelect={noop} invalid />),
        entry("Radio", "selected", <Stateful initial={"fit" as string | null}>{(value, set) => <RadioGroup label="Scale" horizontal options={[{ value: "fit", label: "Fit" }, { value: "fill", label: "Fill" }, { value: "stretch", label: "Stretch" }]} value={value} onChange={set} />}</Stateful>, { label: "group with labels" }),
      ],
    },
    {
      id: "slider", title: "Slider", layout: "column", note: "4 px track, 14 px thumb (20 px at compact-touch density). Default tick; double-click resets; one commit per drag.",
      entries: [
        entry("Slider", "rest", <Stateful initial={72}>{(value, set) => <Labelled label="Opacity"><Slider label="Opacity" min={0} max={100} value={value} defaultValue={100} onChange={(next) => set(next as number)} onCommit={(next) => set(next as number)} field unit="%" /></Labelled>}</Stateful>),
        entry("Slider", "selected", <Stateful initial={36}>{(value, set) => <Labelled label="Exposure"><Slider label="Exposure" min={-100} max={100} value={value} defaultValue={0} centre onChange={(next) => set(next as number)} onCommit={(next) => set(next as number)} field /></Labelled>}</Stateful>, { label: "centre origin" }),
        entry("Slider", "hover", <Labelled label="Temperature"><Slider label="Temperature" min={-100} max={100} value={-36} defaultValue={0} centre onCommit={noop} forceState="hover" /></Labelled>),
        entry("Slider", "selected", <Stateful initial={[20, 70] as [number, number]}>{(value, set) => <Labelled label="Range"><Slider label="Range" min={0} max={100} value={value} onChange={(next) => set(next as [number, number])} onCommit={(next) => set(next as [number, number])} /></Labelled>}</Stateful>, { label: "range (2 thumbs)" }),
        entry("Slider", "pressed", <Labelled label="Dragging"><Slider label="Dragging" min={0} max={100} value={55} onCommit={noop} forceState="pressed" /></Labelled>),
        entry("Slider", "focus-visible", <Labelled label="Volume"><Slider label="Volume" min={0} max={200} step={5} value={100} defaultValue={100} onCommit={noop} forceState="focus" /></Labelled>),
        entry("Slider", "disabled", <Labelled label="Disabled"><Slider label="Disabled" min={0} max={100} value={40} disabled onCommit={noop} /></Labelled>),
      ],
    },
    {
      id: "number", title: "NumberField — scrub, units, expression, mixed", layout: "column", note: "The label is the scrub handle (1 unit/px; Shift ×10; Alt ×0.1). “—” = mixed values. Invalid input reverts after 1.5 s. Reset shows only when the value differs from the default.",
      entries: [
        entry("NumberField", "rest", <Row><Stateful initial={970}>{(value, set) => <NumberField label="X" unit="px" value={value} onChange={set} onCommit={set} />}</Stateful><Stateful initial={-120}>{(value, set) => <NumberField label="Y" unit="px" value={value} onChange={set} onCommit={set} />}</Stateful></Row>),
        entry("NumberField", "focus-visible", <Row><NumberField label="X" unit="px" value={970} forceText="1920/2+10" forceState="focus" onCommit={noop} /><NumberField label="W" value={1080} invalid forceText="12px" onCommit={noop} /></Row>, { label: "expression · invalid" }),
        entry("NumberField", "invalid", <NumberField label="W" value={1080} invalid forceText="12px" onCommit={noop} width={120} />),
        entry("NumberField", "selected", <Row><NumberField label="Opacity" unit="%" value={null} onCommit={noop} /><Stateful initial={12.5}>{(value, set) => <NumberField label="Rotation" unit="°" value={value} min={-360} max={360} step={0.5} defaultValue={0} onChange={set} onCommit={set} />}</Stateful></Row>, { label: "mixed · reset" }),
        entry("NumberField", "hover", <NumberField label="Scale" unit="%" value={100} onCommit={noop} width={140} forceState="hover" />),
        entry("NumberField", "pressed", <NumberField icon="rotate" label="Rotation" unit="°" value={0} onCommit={noop} width={140} forceState="pressed" />),
        entry("NumberField", "disabled", <NumberField label="Height" unit="px" value={1080} disabled onCommit={noop} width={140} />),
      ],
    },
    {
      id: "color", title: "ColorPicker", layout: "column",
      entries: [
        entry("ColorPicker", "rest", <Stateful initial={SAMPLE_COLORS.text as string}>{(value, set) => <ColorPicker label="Text colour" value={value} defaultValue={SAMPLE_COLORS.white} onChange={set} onCommit={set} width={140} onPickFromPreview={noop} />}</Stateful>),
        entry("ColorPicker", "selected", <Stateful initial={SAMPLE_COLORS.fill as string}>{(value, set) => <ColorPicker label="Shape fill" value={value} onChange={set} onCommit={set} width={140} brandColors={[...SAMPLE_COLORS.brand]} />}</Stateful>, { label: "with alpha" }),
        entry("ColorPicker", "disabled", <ColorPicker label="Background" value={SAMPLE_COLORS.dark} onCommit={noop} disabled width={140} />),
        entry("ColorPicker", "hover", <ColorPicker label="Tint" value={SAMPLE_COLORS.tint} onCommit={noop} width={140} forceState="hover" />),
        entry("ColorPicker", "rest", <Row>{SAMPLE_COLORS.recent.map((hex) => <Swatch key={hex} size="sm" color={hex} />)}</Row>, { label: "recent colours" }),
        entry("ColorPicker", "pressed", <ColorPicker label="Stroke" value={SAMPLE_COLORS.stroke} onCommit={noop} width={140} forceState="pressed" />),
        entry("ColorPicker", "focus-visible", <ColorPicker label="Shadow" value={SAMPLE_COLORS.shadow} onCommit={noop} width={140} forceState="focus" />),
      ],
    },
    {
      id: "dates", title: "DateField · DateRangeField · TimeField · WeekdayPicker", layout: "column",
      entries: [
        entry("DateField", "rest", <Stateful initial={"2026-10-05" as string | null}>{(value, set) => <DateField label="Start date" value={value} onChange={set} width={160} />}</Stateful>),
        entry("DateField", "invalid", <DateField label="Due date" value="2026-10-05" onChange={noop} error="Choose a date after today." width={220} />),
        entry("DateField", "disabled", <DateField label="Created" value="2026-10-02" onChange={noop} disabled width={160} />),
        entry("DateField", "hover", <DateField label="Publish" value={null} onChange={noop} width={160} forceState="hover" />),
        entry("DateField", "pressed", <DateField label="Archive" value="2026-12-31" onChange={noop} width={160} min="2026-10-01" forceState="pressed" />),
        entry("DateField", "focus-visible", <DateField label="Review" value="2026-11-15" onChange={noop} width={160} forceState="focus" />),
        entry("DateRangeField", "rest", <Stateful initial={{ start: "2026-09-29", end: "2026-10-05" } as { start: string; end: string } | null}>{(value, set) => <DateRangeField label="Usage period" value={value} onChange={set} maxSpanDays={366} allowEmpty width={240} today="2026-10-05" />}</Stateful>),
        entry("DateRangeField", "invalid", <DateRangeField label="Export history" value={{ start: "2025-08-01", end: "2026-10-05" }} onChange={noop} maxSpanDays={366} width={240} />, { label: "range too long" }),
        entry("DateRangeField", "disabled", <DateRangeField label="Period" value={{ start: "2026-10-01", end: "2026-10-05" }} onChange={noop} disabled width={240} />),
        entry("DateRangeField", "hover", <DateRangeField label="Period" value={null} onChange={noop} width={240} forceState="hover" />),
        entry("DateRangeField", "pressed", <DateRangeField label="Period" value={{ start: "2026-10-05", end: "2026-10-05" }} onChange={noop} width={240} forceState="pressed" />),
        entry("DateRangeField", "focus-visible", <DateRangeField label="Period" value={{ start: "2026-09-06", end: "2026-10-05" }} onChange={noop} width={240} forceState="focus" />),
        entry("TimeField", "rest", <Stateful initial="22:00">{(value, set) => <TimeField label="Run at" value={value} onChange={set} />}</Stateful>),
        entry("TimeField", "selected", <Stateful initial="07:30:15">{(value, set) => <TimeField label="Start" value={value} onChange={set} withSeconds />}</Stateful>, { label: "with seconds" }),
        entry("TimeField", "invalid", <TimeField label="Run at" value="03:00" onChange={noop} invalid />),
        entry("TimeField", "disabled", <TimeField label="Run at" value="09:00" onChange={noop} disabled />),
        entry("TimeField", "hover", <TimeField label="Run at" value="12:00" onChange={noop} forceState="hover" />),
        entry("TimeField", "pressed", <TimeField label="Run at" value="00:00" onChange={noop} forceState="pressed" />),
        entry("TimeField", "focus-visible", <TimeField label="Run at" value="18:45" onChange={noop} forceState="focus" />),
        entry("WeekdayPicker", "selected", <Stateful initial={[1, 2, 3, 4, 5]}>{(value, set) => <WeekdayPicker label="Repeat on" value={value} onChange={set} withPresets />}</Stateful>),
        entry("WeekdayPicker", "rest", <Stateful initial={[6]}>{(value, set) => <WeekdayPicker label="Day" value={value} onChange={set} multiple={false} />}</Stateful>, { label: "single select" }),
        entry("WeekdayPicker", "disabled", <WeekdayPicker label="Repeat on" value={[0, 6]} onChange={noop} disabled />),
        entry("WeekdayPicker", "hover", <WeekdayPicker label="Repeat on" value={[]} onChange={noop} forceState="hover" />),
        entry("WeekdayPicker", "pressed", <WeekdayPicker label="Repeat on" value={[3]} onChange={noop} forceState="pressed" />),
        entry("WeekdayPicker", "focus-visible", <WeekdayPicker label="Repeat on" value={[0, 1, 2, 3, 4, 5, 6]} onChange={noop} forceState="focus" />),
      ],
    },
    {
      id: "chips", title: "Chip · Tag · FilterChip · TokenChip · AttachmentChip", layout: "column",
      entries: [
        entry("Chip", "rest", <Row><Chip label="Draft" /><Chip size="md" icon="tag" label="Vertical" /><Chip label="client: Phuong" onRemove={noop} /></Row>),
        entry("Chip", "hover", <Chip label="B-roll" onPress={noop} forceState="hover" />),
        entry("Chip", "pressed", <Chip label="B-roll" onPress={noop} forceState="pressed" />),
        entry("Chip", "focus-visible", <Chip label="B-roll" onPress={noop} forceState="focus" />),
        entry("Chip", "selected", <Stateful initial={true as boolean}>{(on, set) => <Chip label="Selected" selected={on} onPress={() => set(!on)} />}</Stateful>),
        entry("Chip", "disabled", <Chip label="Unavailable" onPress={noop} disabled />),
        entry("Tag", "rest", <Row><Tag label="4K" /><Tag size="md" icon="lock" label="Private" /></Row>),
        entry("FilterChip", "rest", <Row><FilterChip field="Status" value="Failed" onRemove={noop} /><AddFilterChip onPress={noop} /></Row>),
        entry("FilterChip", "hover", <FilterChip field="Owner" value="Mai" onRemove={noop} onPress={noop} forceState="hover" />),
        entry("FilterChip", "pressed", <FilterChip field="Preset" value="1080p" onRemove={noop} onPress={noop} forceState="pressed" />),
        entry("FilterChip", "focus-visible", <FilterChip field="Type" value="Video" onRemove={noop} onPress={noop} forceState="focus" />),
        entry("FilterChip", "disabled", <FilterChip field="Type" value="Video" onRemove={noop} onPress={noop} disabled />),
        entry("TokenChip", "rest", <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[1] }}>
          <Text>When</Text><TokenChip icon="export" label="an export finishes" onPress={noop} /><Text>in project</Text><TokenChip icon="folder" label="Q4 promo" onPress={noop} /><Text>and Preset equals</Text><TokenChip label="1080p" /><Text>— also inline as</Text><TokenChip icon="user" label="Mai" onPress={noop} /><Text>mentions.</Text>
        </View>),
        entry("TokenChip", "hover", <TokenChip icon="folder" label="A project with a very long name that is truncated" onPress={noop} forceState="hover" />, { label: "truncated at 24 characters" }),
        entry("TokenChip", "pressed", <TokenChip icon="user" label="Phuong" onPress={noop} forceState="pressed" />),
        entry("TokenChip", "focus-visible", <TokenChip icon="bot" label="Editor agent" onPress={noop} forceState="focus" />),
        entry("AttachmentChip", "rest", <AttachmentChip file={{ name: "drone_dalat_01.mp4", size: "84 MB", status: "ready", icon: "video" }} onRemove={noop} />),
        entry("AttachmentChip", "loading", <AttachmentChip file={{ name: "IMG_20261002_184233_cover.jpg", status: "uploading", progress: 62, icon: "image" }} onRemove={noop} />),
        entry("AttachmentChip", "invalid", <AttachmentChip file={{ name: "brief.pdf", status: "failed", error: "Failed" }} onRemove={noop} onRetry={noop} />, { label: "upload failed" }),
      ],
    },
    {
      id: "identity", title: "Avatar · Badge · StatusPill · Kbd", layout: "column",
      entries: [
        entry("Avatar", "rest", <Row><Avatar name="Mai" size={16} /><Avatar name="Mai Anh" /><Avatar name="Tran Phuong" size={24} /><Avatar name="Khanh Linh" size={32} /><Avatar name="Ngoc Chanh" size={40} /><Avatar name="Studio Mac" square /><Avatar name="Project Q4" square size={24} /><Avatar name="Da Lat" square size={32} /><Avatar name="Editor agent" glyph="bot" size={24} /></Row>),
        entry("Badge", "rest", <Row><Badge count={3} /><Badge count={128} tone="attention" /><Badge kind="new" /><Badge kind="built-in" /><Dot /></Row>),
        entry("StatusPill", "rest", <Row><StatusPill label="Queued" status="queued" /><StatusPill label="Running" status="running" /><StatusPill label="Needs approval" status="waiting_approval" /><StatusPill label="Paused" status="paused" /><StatusPill label="Result ready" status="result_ready" /><StatusPill label="Failed" status="failed" /><StatusPill label="Cancelled" status="cancelled" reason="parked_timeout" /><StatusPill label="Exported" status="exported" /></Row>),
        entry("Kbd", "rest", <Row gap={space[4]}><Kbd keys={["Mod", "B"]} /><Kbd keys={["Mod", "Shift", "F"]} /><Kbd keys={["Ctrl", "Shift", "Z"]} /><Kbd keys={["ArrowLeft"]} /><Kbd keys={["Space"]} /></Row>),
      ],
    },
  ];
}
