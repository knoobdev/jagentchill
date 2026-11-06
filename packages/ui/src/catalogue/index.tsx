/**
 * The component catalogue: every component of the design system in every state. Development and test builds mount it as a
 * route; visual-regression snapshots of it are a CI gate.
 */
import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { Icon } from "../Icon.tsx";
import { ICONS, type IconName } from "../icons.gen.ts";
import { Segmented } from "../tabs.tsx";
import { Text } from "../text.tsx";
import { useTheme, type ThemePreference } from "../theme.tsx";
import { borderWidth, colorTokens, control, iconSize, motion, radius, space, typography, zIndex, type ColorToken, type TypeToken } from "../tokens.ts";
import { controlSections } from "./controls.tsx";
import { SectionView, entry, type Section } from "./frame.tsx";
import { surfaceSections, type TimelineDimensions } from "./surfaces.tsx";

export type { Entry, Section } from "./frame.tsx";
export type { TimelineDimensions } from "./surfaces.tsx";

/** Every shared component the specification names. A capability that needs another shared component adds it here first. */
export const COMPONENTS = [
  "Button", "IconButton", "ToggleButton", "Input", "Textarea", "FormField", "SearchField", "Select", "Combobox", "SegmentedControl", "Tabs", "TabStrip", "Switch", "Checkbox", "Radio",
  "Slider", "NumberField", "ColorPicker", "DateField", "DateRangeField", "TimeField", "WeekdayPicker", "Chip", "Tag", "FilterChip", "TokenChip", "AttachmentChip", "ListRow", "Card",
  "GroupedSettingCard", "Table", "Tree", "Disclosure", "Breadcrumb", "Tooltip", "Popover", "Menu", "ContextMenu", "AppMenu", "Modal", "SideSheet", "BottomSheet", "AdaptiveSheet", "Drawer",
  "Toast", "Callout", "Banner", "ProgressBar", "Spinner", "StatusRing", "Stepper", "Skeleton", "EmptyState", "Avatar", "Badge", "StatusPill", "Kbd", "QRCode", "MarkdownView", "CodeBlock",
  "Composer", "PanelGroup", "Timeline atoms", "BarChart", "HorizontalBarChart", "LineChart", "Sparkline",
] as const;
export type ComponentName = (typeof COMPONENTS)[number];

const POINTER = ["rest", "hover", "pressed", "focus-visible"] as const;
/** The states that apply to each component. Controls have the pointer and keyboard states; the rest are listed by name. */
export const APPLICABLE_STATES: Record<ComponentName, readonly string[]> = {
  Button: [...POINTER, "disabled", "loading"], IconButton: [...POINTER, "disabled"], ToggleButton: [...POINTER, "disabled", "selected"],
  Input: [...POINTER, "disabled", "invalid", "read-only"], Textarea: [...POINTER, "disabled", "invalid", "read-only"], FormField: [...POINTER, "disabled", "invalid"],
  SearchField: [...POINTER, "disabled", "loading"], Select: [...POINTER, "disabled", "invalid"], Combobox: [...POINTER, "disabled", "invalid", "loading", "selected"],
  SegmentedControl: [...POINTER, "disabled", "selected"], Tabs: [...POINTER, "disabled", "selected"], TabStrip: [...POINTER, "selected"],
  Switch: [...POINTER, "disabled", "selected", "invalid"], Checkbox: [...POINTER, "disabled", "selected", "invalid"], Radio: [...POINTER, "disabled", "selected", "invalid"],
  Slider: [...POINTER, "disabled"], NumberField: [...POINTER, "disabled", "invalid"], ColorPicker: [...POINTER, "disabled"], DateField: [...POINTER, "disabled", "invalid"],
  DateRangeField: [...POINTER, "disabled", "invalid"], TimeField: [...POINTER, "disabled", "invalid"], WeekdayPicker: [...POINTER, "disabled", "selected"],
  Chip: [...POINTER, "disabled", "selected"], Tag: ["rest"], FilterChip: [...POINTER, "disabled"], TokenChip: [...POINTER], AttachmentChip: ["rest", "loading", "invalid"],
  ListRow: [...POINTER, "disabled", "selected"], Card: [...POINTER, "disabled", "selected"], GroupedSettingCard: ["rest"], Table: ["rest", "selected", "loading", "invalid"], Tree: ["rest", "selected", "loading"],
  Disclosure: ["rest", "selected", "disabled"], Breadcrumb: ["rest"], Tooltip: ["rest"], Popover: ["rest", "selected"], Menu: ["rest", "selected"], ContextMenu: ["rest"], AppMenu: ["rest"],
  Modal: ["rest"], SideSheet: ["rest"], BottomSheet: ["rest"], AdaptiveSheet: ["rest"], Drawer: ["rest"], Toast: ["rest", "loading"], Callout: ["rest"], Banner: ["rest"],
  ProgressBar: ["rest", "loading"], Spinner: ["rest"], StatusRing: ["rest"], Stepper: ["rest"], Skeleton: ["rest", "loading"], EmptyState: ["rest", "invalid"], Avatar: ["rest"], Badge: ["rest"], StatusPill: ["rest"], Kbd: ["rest"],
  QRCode: ["rest"], MarkdownView: ["rest", "loading"], CodeBlock: ["rest"], Composer: ["rest", "focus-visible", "loading", "disabled", "invalid"], PanelGroup: ["rest", "focus-visible"], "Timeline atoms": ["rest"],
  BarChart: ["rest"], HorizontalBarChart: ["rest"], LineChart: ["rest"], Sparkline: ["rest"],
};

const GROUPS: Array<[string, (token: ColorToken) => boolean]> = [
  ["Surfaces, borders and text", (token) => /^(bg|border|text)\//.test(token) && token !== "bg/editor"],
  ["Accent, strong and status", (token) => /^(accent|strong|success|danger|warning|purple|control|qr)/.test(token)],
  ["Avatars and diff", (token) => /^(avatar|diff)\//.test(token)],
  ["Editor: clips, timeline, preview, markers", (token) => /^(clip|timeline|keyframe|preview|waveform|marker)\//.test(token) || token === "bg/editor"],
  ["Workflow canvas", (token) => token.startsWith("wf/")], ["Terminal", (token) => token.startsWith("terminal/")], ["Charts", (token) => token.startsWith("chart/")],
];

function Swatches(props: { tokens: ColorToken[] }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
      {props.tokens.map((token) => (
        <View key={token} testID={`token-${token}`} style={{ flexDirection: "row", alignItems: "center", gap: space[2], width: space[16] * 3 + space[10] }}>
          <View style={{ width: control.lg - space[1], height: control.lg - space[1], borderRadius: radius.sm, borderWidth: borderWidth.hairline, borderColor: theme.color("border/control"), backgroundColor: theme.color(token) }} />
          <View style={{ flex: 1, minWidth: 0 }}><Text variant="mono" numberOfLines={1}>{token}</Text><Text variant="mono" color="text/secondary" numberOfLines={1}>{theme.color(token)}</Text></View>
        </View>
      ))}
    </View>
  );
}

function foundationSections(): Section[] {
  const types = Object.keys(typography) as TypeToken[];
  return [
    ...GROUPS.map(([title, test], index): Section => ({ id: `color-${index}`, title: `Colour — ${title}`, span: 3, layout: "column", entries: [entry("Tokens", "rest", <Swatches tokens={colorTokens.filter(test)} />, { label: "light and dark values follow the theme" })] })),
    {
      id: "type", title: "Typography", span: 2, layout: "column",
      entries: types.map((token) => entry("Tokens", "rest", <Text variant={token}>{token === "mono" ? "ses_8f41c2e0 · 00:00:01:12" : "Make a 30 s vertical teaser — Tiếng Việt · 日本語のテキスト"}</Text>, { label: `type/${token}` })),
    },
    {
      id: "space", title: "Spacing · radius · control heights · elevation · motion · stacking", layout: "column",
      entries: [
        entry("Tokens", "rest", <Row>{Object.entries(space).map(([name, value]) => <Bar key={name} size={value} label={name} />)}</Row>, { label: "space/*" }),
        entry("Tokens", "rest", <Row>{(["none", "xs", "sm", "md", "lg", "xl", "full"] as const).map((name) => <Tile key={name} label={`${name} ${radius[name] === 9999 ? "full" : radius[name]}`} round={radius[name]} />)}</Row>, { label: "radius/*" }),
        entry("Tokens", "rest", <Row>{(["xs", "sm", "md", "lg", "touch"] as const).map((name) => <Bar key={name} size={control[name]} label={`${name} ${control[name]}`} />)}</Row>, { label: "control/*" }),
        entry("Tokens", "rest", <Row>{([0, 1, 2, 3] as const).map((level) => <Tile key={level} label={`elevation/${level}`} level={level} />)}</Row>, { label: "elevation/*" }),
        entry("Tokens", "rest", <Text variant="mono" color="text/secondary">{`motion fast ${motion.fast} · base ${motion.base} · slow ${motion.slow} · exit ${motion.exit} ms\nz ${Object.entries(zIndex).map(([name, value]) => `${name} ${value}`).join(" · ")}`}</Text>, { label: "motion/* · z/*" }),
      ],
    },
    {
      id: "icons", title: `Icons — ${Object.keys(ICONS).length} glyphs, 1.5 px stroke`, span: 3, layout: "column",
      entries: [
        entry("Tokens", "rest", <Row>{(Object.keys(iconSize) as Array<keyof typeof iconSize>).map((name) => <View key={name} style={{ alignItems: "center", gap: space[1] }}><Icon name="scissors" size={name} /><Text variant="caption" color="text/secondary">{`${name} ${iconSize[name]}`}</Text></View>)}</Row>, { label: "icon/*" }),
        entry("Tokens", "rest", <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1] }}>{(Object.keys(ICONS) as IconName[]).map((name) => <View key={name} style={{ width: space[16], alignItems: "center", gap: space[0.5], paddingVertical: space[1] }}><Icon name={name} size={16} label={name} /><Text variant="caption" color="text/secondary" numberOfLines={1}>{name}</Text></View>)}</View>, { label: "the outline set and the project-owned glyphs" }),
      ],
    },
  ];
}
const Row = (props: { children: ReactNode }) => <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", gap: space[3] }}>{props.children}</View>;
function Bar(props: { size: number; label: string }) {
  const theme = useTheme();
  return <View style={{ alignItems: "center", gap: space[1] }}><View style={{ width: Math.max(props.size, borderWidth.hairline), height: Math.max(props.size, borderWidth.hairline), backgroundColor: theme.color("accent/subtle"), borderWidth: borderWidth.hairline, borderColor: theme.color("accent") }} /><Text variant="caption" color="text/secondary">{props.label}</Text></View>;
}
function Tile(props: { label: string; round?: number; level?: 0 | 1 | 2 | 3 }) {
  const theme = useTheme();
  return <View style={{ alignItems: "center", gap: space[1] }}><View style={[{ width: space[12], height: space[10], borderRadius: props.round ?? radius.md, backgroundColor: theme.color("bg/elevated"), borderWidth: borderWidth.hairline, borderColor: theme.color("border/hairline") }, props.level ? theme.elevation(props.level) : null]} /><Text variant="caption" color="text/secondary">{props.label}</Text></View>;
}

/** The sections of the catalogue, in the order of the design file's gallery. */
export function catalogueSections(open: string | undefined, timeline: { desktop: TimelineDimensions; touch: TimelineDimensions }): Section[] {
  return [...controlSections(), ...surfaceSections(open, timeline)];
}

export type CatalogueProps = {
  /** Id of an overlay to show opened, for screenshots: `modal`, `menu`, `drawer`, … */
  open?: string;
  /** Limits the catalogue to one part. */
  part?: "foundations" | "components";
  timeline: { desktop: TimelineDimensions; touch: TimelineDimensions };
};

/** The catalogue screen. */
export function Catalogue(props: CatalogueProps) {
  const theme = useTheme();
  const sections = [...(props.part === "components" ? [] : foundationSections()), ...(props.part === "foundations" ? [] : catalogueSections(props.open, props.timeline))];
  const columns = theme.width >= 1200 ? 3 : theme.width >= 720 ? 2 : 1;
  const gap = space[4];
  return (
    <ScrollView testID="catalogue" style={{ flex: 1, backgroundColor: theme.color("bg/canvas") }} contentContainerStyle={{ padding: theme.compact ? space[3] : space[6], gap }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[3] }}>
        <View style={{ flex: 1, minWidth: space[16] * 3 }}>
          <Text variant="h1" level={1}>Component catalogue</Text>
          <Text color="text/secondary">{`Every component of the design system with its states · ${theme.scheme} theme · ${theme.formFactor} form factor · ${theme.density === "touch" ? "compact-touch" : "regular"} density`}</Text>
        </View>
        <Segmented<ThemePreference> size="sm" label="Theme" options={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} value={theme.preference} onChange={theme.setPreference} />
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap, alignItems: "flex-start" }}>
        {sections.map((section) => {
          const span = Math.min(columns, section.span ?? 1);
          return <SectionView key={section.id} section={section} style={{ flexBasis: `${(span / columns) * 100 - 2}%`, flexGrow: 1, minWidth: 0, maxWidth: "100%" }} />;
        })}
      </View>
    </ScrollView>
  );
}
