import { memo, useMemo } from "react";
import { SvgAst, SvgXml, parse } from "react-native-svg";
import { ICONS, type IconName } from "./icons.gen.ts";
import { useTheme } from "./theme.tsx";
import { ICON_STROKE, iconSize, type ColorToken } from "./tokens.ts";

export type { IconName };
/** The drawings of the set, for a picture written outside the component tree (an exported diagram). */
export { ICONS };
const INLINE_PAIRS: Partial<Record<IconName, IconName>> = { "chev-l": "chev-r", "chev-r": "chev-l", "arrow-l": "arrow-r", "arrow-r": "arrow-l" };
/** A back / forward / next icon named for left-to-right reading, as it is drawn in the current direction (right-to-left swaps the pair). */
export const inlineIcon = (rtl: boolean, name: IconName): IconName => (rtl ? INLINE_PAIRS[name] ?? name : name);
export type IconSize = 12 | 14 | 16 | 20 | 22 | 24 | 32;

/**
 * An icon of the one outline set: 1.5 px stroke at every size, round caps and joins. The colour defaults to the adjacent
 * text colour, `text/primary`. A `label` makes it an image for assistive technology; without one it is decorative.
 */
// Memoised: an icon is drawn from its four props and the theme alone, and every button and row of a screen holds one —
// without this each of them parsed its drawing again whenever anything above it rendered.
export const Icon = memo(function Icon(props: { name: IconName; size?: IconSize | keyof typeof iconSize; color?: ColorToken; label?: string }) {
  const theme = useTheme();
  const icon = ICONS[props.name];
  const size = typeof props.size === "string" ? iconSize[props.size] : props.size ?? iconSize.md;
  const color = theme.color(props.color ?? "text/primary");
  const xml = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${icon.viewBox}" fill="none" stroke="${color}" stroke-width="${ICON_STROKE}" stroke-linecap="round" stroke-linejoin="round">${icon.body.replaceAll("currentColor", color)}</svg>`;
  // The drawing is parsed once for the app, not once for every icon that is mounted (`SvgXml` parses its text at each
  // mount: a panel with sixteen icons parsed sixteen drawings every time it appeared).
  const override = useMemo(() => ({ width: size, height: size, "aria-label": props.label, role: props.label ? ("img" as const) : undefined, "aria-hidden": props.label ? undefined : true }), [size, props.label]);
  return <SvgAst ast={drawingOf(xml)} override={override} />;
});
const drawings = new Map<string, ReturnType<typeof parse>>();
/** The parsed drawing of an icon in one colour (a few hundred at most: the icons of the set times the colours of the theme). */
function drawingOf(xml: string): ReturnType<typeof parse> {
  let drawing = drawings.get(xml);
  if (drawing === undefined) { drawing = parse(xml); drawings.set(xml, drawing); }
  return drawing;
}

/** The product mark, original to JAgentChill. */
export function Logo(props: { size?: number; color?: ColorToken; ink?: ColorToken }) {
  const theme = useTheme();
  const size = props.size ?? iconSize.xl;
  const fill = theme.color(props.color ?? "text/tertiary");
  const ink = theme.color(props.ink ?? "bg/app");
  const xml = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="6" fill="${fill}"/><path d="M9.2 7.2v6.1a2.9 2.9 0 0 0 5.8 0" fill="none" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/><circle cx="15" cy="8" r="1.5" fill="${ink}"/></svg>`;
  return <SvgXml xml={xml} width={size} height={size} accessibilityLabel="JAgentChill" />;
}
