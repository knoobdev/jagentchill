import { compactScale } from "./compact.ts";

/**
 * Design tokens. This file is the only place a visual value is written: every row is `[token, light, dark]` and holds the
 * values of the design-system specification. Components name tokens; they never state a colour, size or duration.
 */
const COLOR_ROWS = [
  // Semantic colours.
  ["bg/app", "#FFFFFF", "#1B1B1B"], ["bg/sidebar", "#F7F7F7", "#141414"], ["bg/subtle", "#EFEFEF", "#2A2A2A"],
  ["bg/hover", "#F3F3F3", "#232323"], ["bg/elevated", "#FFFFFF", "#242424"], ["bg/inset", "#FAFAFA", "#161616"],
  ["bg/canvas", "#EDEDED", "#0F0F0F"], ["bg/scrim", "rgba(0,0,0,0.40)", "rgba(0,0,0,0.60)"],
  ["border/hairline", "#E8E8E8", "#2E2E2E"], ["border/strong", "#D4D4D4", "#3D3D3D"], ["border/control", "#808080", "#808080"],
  ["text/primary", "#1A1A1A", "#EDEDED"], ["text/secondary", "#6B6B6B", "#9A9A9A"], ["text/placeholder", "#6F6F6F", "#909090"],
  ["text/tertiary", "#A3A3A3", "#6A6A6A"], ["text/on-accent", "#FFFFFF", "#0B1B3A"], ["text/on-danger", "#FFFFFF", "#3A0D09"],
  ["text/on-strong", "#FFFFFF", "#1A1A1A"],
  ["accent", "#2F6FEB", "#4C8DFF"], ["accent/hover", "#2560D4", "#6A9FFF"], ["accent/pressed", "#1E52B8", "#86B1FF"],
  ["accent/text", "#245FD6", "#8FB6FF"], ["accent/subtle", "#E8F0FE", "#1C2B4A"],
  ["strong", "#1A1A1A", "#EDEDED"], ["strong/hover", "#333333", "#FFFFFF"],
  ["success", "#1B914D", "#3DBE7A"], ["success/text", "#15733F", "#3DBE7A"], ["success/subtle", "#E6F6EA", "#173524"],
  ["danger", "#D93025", "#F26D63"], ["danger/hover", "#B8261D", "#F58A82"], ["danger/text", "#B8261D", "#F58A82"],
  ["danger/subtle", "#FDECEC", "#3A1D1D"],
  ["warning", "#E8890C", "#F0A23B"], ["warning/icon", "#B06500", "#F0A23B"], ["warning/text", "#8F5300", "#F0A23B"],
  ["warning/subtle", "#FDF3E3", "#3A2A12"],
  ["purple", "#7C4DDB", "#A98BEF"], ["purple/text", "#5B34B0", "#A98BEF"], ["purple/subtle", "#F1EBFC", "#2A2140"],
  ["control/thumb", "#FFFFFF", "#FFFFFF"], ["avatar/text", "#FFFFFF", "#FFFFFF"],
  ["avatar/bg/1", "#2D6DEB", "#2D6DEB"], ["avatar/bg/2", "#0D818D", "#0D818D"], ["avatar/bg/3", "#B65B0B", "#B65B0B"],
  ["avatar/bg/4", "#7C4DDB", "#7C4DDB"], ["avatar/bg/5", "#1A8648", "#1A8648"], ["avatar/bg/6", "#C2447A", "#C2447A"],
  ["avatar/bg/7", "#A85F00", "#A85F00"], ["avatar/bg/8", "#5F6B7A", "#5F6B7A"],
  ["diff/added", "#E6F6EA", "#173524"], ["diff/removed", "#FDECEC", "#3A1D1D"], ["diff/added-strong", "#BDE9C9", "#1F5A38"],
  ["diff/removed-strong", "#F8C9C5", "#6A2A28"], ["diff/gutter-added", "#15733F", "#3DBE7A"], ["diff/gutter-removed", "#B8261D", "#F26D63"],
  // Editor colours.
  ["clip/video", "#2D6CEA", "#2D6CEA"], ["clip/overlay", "#5566E8", "#5566E8"], ["clip/image", "#8B53D9", "#8B53D9"],
  ["clip/audio", "#258154", "#258154"], ["clip/text", "#AD5F1A", "#AD5F1A"], ["clip/sticker", "#CF346E", "#CF346E"],
  ["clip/effect", "#B741B7", "#B741B7"], ["clip/filter", "#2F7D8A", "#2F7D8A"], ["clip/adjustment", "#6B7280", "#6B7280"],
  ["clip/caption", "#906D15", "#906D15"], ["clip/compound", "#207F7F", "#207F7F"], ["clip/label", "#FFFFFF", "#FFFFFF"],
  ["clip/label-scrim", "rgba(0,0,0,0.60)", "rgba(0,0,0,0.60)"], ["bg/editor", "#161616", "#161616"],
  ["timeline/track-bg", "#F7F7F7", "#202020"], ["timeline/track-bg-alt", "#F1F1F1", "#1D1D1D"],
  ["timeline/ruler-text", "#6B6B6B", "#9A9A9A"], ["timeline/playhead", "#1A1A1A", "#FFFFFF"],
  ["timeline/selection", "#1A1A1A", "#FFFFFF"], ["timeline/snap", "#B06500", "#F0A23B"],
  ["timeline/range", "rgba(47,111,235,0.16)", "rgba(76,141,255,0.22)"],
  ["keyframe/fill", "#2F6FEB", "#4C8DFF"], ["preview/handle-fill", "#FFFFFF", "#FFFFFF"],
  ["preview/handle-border", "#2F6FEB", "#4C8DFF"], ["preview/guide", "#E8890C", "#F0A23B"],
  ["waveform/fill", "rgba(255,255,255,0.85)", "rgba(255,255,255,0.85)"], ["waveform/clip", "#B8261D", "#B8261D"],
  ["waveform/beat", "#FFD60A", "#FFD60A"], ["preview/offline-fill", "#2A2A2A", "#2A2A2A"],
  ["preview/offline-hatch", "#4A4A4A", "#4A4A4A"],
  ["marker/1", "#009DFF", "#009DFF"], ["marker/2", "#34C759", "#34C759"], ["marker/3", "#FFCC00", "#FFCC00"],
  ["marker/4", "#FF9500", "#FF9500"], ["marker/5", "#FF3B30", "#FF3B30"], ["marker/6", "#AF52DE", "#AF52DE"],
  ["marker/7", "#FF2D92", "#FF2D92"], ["marker/8", "#8E8E93", "#8E8E93"],
  // Workflow canvas.
  ["wf/canvas-bg", "#FAFAFA", "#161616"], ["wf/grid-minor", "#E2E2E2", "#262626"], ["wf/grid-major", "#CFCFCF", "#333333"],
  ["wf/node-bg", "#FFFFFF", "#242424"], ["wf/edge-idle", "#8A8A8A", "#7A7A7A"],
  ["wf/type/agent", "#7C4DDB", "#A98BEF"], ["wf/type/generate", "#C2447A", "#EE7FAE"], ["wf/type/script", "#C2610C", "#F08A4B"],
  ["wf/type/editor", "#4F5BD5", "#8B95F5"], ["wf/type/tool", "#5F6B7A", "#9AA5B4"], ["wf/type/gate", "#A85F00", "#F0A23B"],
  ["wf/type/flow", "#0E8C99", "#35C2CF"], ["wf/type/trigger", "#1F9D55", "#3DBE7A"], ["wf/type/output", "#2A7FB8", "#5FB0E6"],
  ["wf/type/unknown", "#6B6B6B", "#9A9A9A"], ["wf/type/sub", "#5E7F12", "#A3C94A"], ["wf/type/wait", "#8A6A4F", "#C9A88A"],
  ["wf/port/text", "#C2610C", "#F08A4B"], ["wf/port/json", "#5F6B7A", "#9AA5B4"], ["wf/port/image", "#8E5BD8", "#B79AF0"],
  ["wf/port/video", "#4F5BD5", "#8B95F5"], ["wf/port/audio", "#1F9D55", "#3DBE7A"], ["wf/port/project", "#C2447A", "#EE7FAE"],
  ["wf/port/file", "#2A7FB8", "#5FB0E6"], ["wf/port/scalar", "#0E8C99", "#35C2CF"], ["wf/port/control", "#1A1A1A", "#EDEDED"],
  ["wf/port/any", "#8A8A8A", "#7A7A7A"],
  ["wf/group/1", "#6B7280", "#9AA5B4"], ["wf/group/2", "#2F6FEB", "#4C8DFF"], ["wf/group/3", "#0E8C99", "#35C2CF"],
  ["wf/group/4", "#1F9D55", "#3DBE7A"], ["wf/group/5", "#A85F00", "#F0A23B"], ["wf/group/6", "#C2610C", "#F08A4B"],
  ["wf/group/7", "#C2447A", "#EE7FAE"], ["wf/group/8", "#7C4DDB", "#A98BEF"],
  // Terminal.
  ["terminal/bg", "#FFFFFF", "#161616"], ["terminal/fg", "#1A1A1A", "#EDEDED"], ["terminal/cursor", "#1A1A1A", "#EDEDED"],
  ["terminal/cursor-text", "#FFFFFF", "#161616"], ["terminal/selection", "rgba(47,111,235,0.25)", "rgba(76,141,255,0.35)"],
  ["terminal/ansi/black", "#1A1A1A", "#2E2E2E"], ["terminal/ansi/red", "#B8261D", "#F26D63"],
  ["terminal/ansi/green", "#116A39", "#3DBE7A"], ["terminal/ansi/yellow", "#8F5300", "#F0A23B"],
  ["terminal/ansi/blue", "#1E52B8", "#4C8DFF"], ["terminal/ansi/magenta", "#8E35A8", "#C792EA"],
  ["terminal/ansi/cyan", "#0B6E7A", "#35C2CF"], ["terminal/ansi/white", "#6B6B6B", "#C8C8C8"],
  ["terminal/ansi/bright-black", "#5A5A5A", "#8A8A8A"], ["terminal/ansi/bright-red", "#D0271C", "#F58A82"],
  ["terminal/ansi/bright-green", "#177A43", "#6BD69B"], ["terminal/ansi/bright-yellow", "#A05A00", "#F5BC6A"],
  ["terminal/ansi/bright-blue", "#2560D4", "#6A9FFF"], ["terminal/ansi/bright-magenta", "#A445C0", "#D9B0F2"],
  ["terminal/ansi/bright-cyan", "#0B7785", "#6FD8E2"], ["terminal/ansi/bright-white", "#3D3D3D", "#FFFFFF"],
  // Data visualisation.
  ["chart/1", "#2F6FEB", "#4C8DFF"], ["chart/2", "#0E8C99", "#35C2CF"], ["chart/3", "#C2610C", "#F08A4B"],
  ["chart/4", "#7C4DDB", "#A98BEF"], ["chart/5", "#1F9D55", "#3DBE7A"], ["chart/6", "#C2447A", "#EE7FAE"],
  ["chart/7", "#A85F00", "#F0A23B"], ["chart/8", "#5F6B7A", "#9AA5B4"], ["chart/grid", "#E8E8E8", "#2E2E2E"],
  ["chart/axis-text", "#6B6B6B", "#9A9A9A"],
  // QR symbol: fixed in both themes, because inverted or tinted symbols fail to scan.
  ["qr/module", "#000000", "#000000"], ["qr/tile", "#FFFFFF", "#FFFFFF"],
] as const;

export type ColorToken = (typeof COLOR_ROWS)[number][0];
export type Palette = Record<ColorToken, string>;
export type Scheme = "light" | "dark";

const column = (index: 1 | 2) => Object.fromEntries(COLOR_ROWS.map((row) => [row[0], row[index]])) as Palette;
export const palettes: { light: Palette; dark: Palette } = { light: column(1), dark: column(2) };
export const colorTokens: readonly ColorToken[] = COLOR_ROWS.map((row) => row[0]);

/** The "Increase contrast" preference: hairlines become control boundaries, secondary and placeholder text become primary. */
export const INCREASE_CONTRAST: Partial<Record<ColorToken, ColorToken>> = {
  "border/hairline": "border/control", "text/secondary": "text/primary", "text/placeholder": "text/primary",
};
export function resolveColor(scheme: Scheme, token: ColorToken, increaseContrast = false): string {
  return palettes[scheme][(increaseContrast && INCREASE_CONTRAST[token]) || token];
}

/** Fill tokens colour fills, borders, dots and icons only; text uses the `/text` grade named here. */
export const TEXT_GRADE = { accent: "accent/text", success: "success/text", warning: "warning/text", danger: "danger/text", purple: "purple/text" } as const;

/** Marker palette in "next colour" order, with the localisation keys of the colour names. */
export const MARKER_COLORS = [
  ["marker/1", "Blue"], ["marker/2", "Green"], ["marker/3", "Yellow"], ["marker/4", "Orange"],
  ["marker/5", "Red"], ["marker/6", "Purple"], ["marker/7", "Pink"], ["marker/8", "Grey"],
] as const satisfies ReadonlyArray<readonly [ColorToken, string]>;
export const nextMarkerIndex = (index: number) => (index + 1) % MARKER_COLORS.length;

export const CLIP_TYPES = ["video", "overlay", "image", "audio", "text", "sticker", "effect", "filter", "adjustment", "caption", "compound"] as const;
export type ClipType = (typeof CLIP_TYPES)[number];
/** Order the "Timeline clip colours: By track" preference cycles through. */
export const CLIP_COLORS_BY_TRACK: readonly ClipType[] = ["video", "image", "audio", "text", "sticker", "effect", "filter", "caption"];
export const clipColorForTrack = (trackIndex: number): ColorToken => `clip/${CLIP_COLORS_BY_TRACK[trackIndex % CLIP_COLORS_BY_TRACK.length]!}`;
/** Opacity rules of the editor tokens. */
export const opacity = { disabled: 0.4, dragging: 0.6, "clip/hidden": 0.5, "clip/dragging": 0.8, "clip/hover-outline": 0.5, "waveform/muted": 0.35, "group/idle": 0.6, "pressed-overlay": 0.08 } as const;

/** 4 px grid. */
export const space = { 0: 0, 0.5: 2, 1: 4, 1.5: 6, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64 } as const;
export type SpaceToken = keyof typeof space;
export const SPACE_VALUES: readonly number[] = Object.values(space);

/** `control`, `card`, `modal` and `clip` are the names the first screens used for `sm`, `md`, `lg` and `xs`. */
export const radius = { none: 0, xs: 4, sm: 6, md: 8, lg: 12, xl: 16, full: 9999, control: 6, card: 8, modal: 12, clip: 4 } as const;
export const borderWidth = { hairline: 1, check: 1.5, focus: 2 } as const;
/** Card row padding: 12 px horizontal by 10 px vertical. */
export const cardRow = { paddingHorizontal: 12, paddingVertical: 10, minHeight: 44 } as const;

export type TypeStyle = { fontSize: number; lineHeight: number; fontWeight: "400" | "500" | "600" };
const type = (regular: [number, number, number], touch: [number, number, number]) => ({
  regular: { fontSize: regular[0], lineHeight: regular[1], fontWeight: String(regular[2]) } as TypeStyle,
  touch: { fontSize: touch[0], lineHeight: touch[1], fontWeight: String(touch[2]) } as TypeStyle,
});
const compactType = (name: keyof typeof compactScale.type, weight?: 400 | 500 | 600): [number, number, number] => {
  const value = compactScale.type[name];
  return [value.fontSize, value.lineHeight, weight ?? Number(value.fontWeight) as 400 | 500 | 600];
};

/** size / line height / weight at regular density and at compact-touch density. Letter spacing is 0 everywhere. */
export const typography = {
  caption: type([11, 16, 500], compactType("caption")),
  meta: type([12, 16, 400], compactType("secondary")),
  body: type([13, 19, 400], compactType("body")),
  "body-medium": type([13, 19, 500], compactType("body", 500)),
  "title-sm": type([14, 20, 600], compactType("section")),
  "title-md": type([16, 22, 600], compactType("title")),
  h1: type([20, 28, 600], compactType("title")),
  display: type([28, 34, 600], [28, 34, 600]),
  mono: type([12, 18, 400], [13, 20, 400]),
} as const;
export type TypeToken = keyof typeof typography;

export const fontFamily = {
  ui: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif',
  /** Japanese faces go ahead of the generic fallbacks. */
  uiJa: 'Inter, "Noto Sans JP", "Hiragino Sans", "Yu Gothic UI", system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif',
  mono: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace',
} as const;
export const FONT_WEIGHTS = ["400", "500", "600"] as const;
const JAPANESE = /[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]/;
/** The bundled Noto Sans JP subset is loaded only for the `ja` UI language or for a string with kana or Han characters. */
export const needsJapaneseFace = (locale: string, text = "") => locale.toLowerCase().startsWith("ja") || JAPANESE.test(text);
/** Noto Sans JP ships in weights 400 and 600 only: 500 falls back to 600 in that face. */
export const japaneseWeight = (weight: TypeStyle["fontWeight"]): "400" | "600" => (weight === "400" ? "400" : "600");

const SHADOWS = [
  [[0, 1, 2, 0.04, 0.4], [0, 2, 8, 0.06, 0.4]],
  [[0, 4, 16, 0.12, 0.5]],
  [[0, 12, 40, 0.2, 0.6]],
] as const;
export type ElevationLevel = 0 | 1 | 2 | 3;
/** CSS `box-shadow` value of an elevation token. The dark theme keeps the offsets and raises the alpha. */
export function elevationShadow(level: ElevationLevel, scheme: Scheme = "light"): string {
  if (level === 0) return "none";
  return SHADOWS[level - 1]!.map(([x, y, blur, lightAlpha, darkAlpha]) => `${x} ${y}px ${blur}px rgba(0,0,0,${(scheme === "dark" ? darkAlpha : lightAlpha).toFixed(2)})`).join(", ");
}
/** The shadow layers of a level, for platforms that take offset, radius and opacity separately. */
export function elevationLayer(level: 1 | 2 | 3, scheme: Scheme = "light") {
  const [, y, blur, lightAlpha, darkAlpha] = SHADOWS[level - 1]!.at(-1)!;
  return { offsetY: y, blur, alpha: scheme === "dark" ? darkAlpha : lightAlpha };
}
export const zIndex = { base: 0, sticky: 100, drawer: 200, popover: 300, modal: 400, toast: 500, tooltip: 600 } as const;

export const motion = {
  fast: 120, base: 160, slow: 240, exit: 120,
  easeEnter: "cubic-bezier(0.2, 0, 0, 1)", easeExit: "cubic-bezier(0.4, 0, 1, 1)",
  /** Largest translation of a popover or modal; a dropdown travels `popoverShift`. Drawers and sheets move their full size. */
  maxShift: 8, popoverShift: 4,
  /** Under reduced motion only an opacity change of at most this long remains. */
  reducedFade: 120,
  spin: 800, indeterminate: 1200, shimmer: 1400, pulse: 1200,
} as const;
export const easing = { enter: [0.2, 0, 0, 1], exit: [0.4, 0, 1, 1], wfInOut: [0.4, 0, 0.2, 1] } as const;
export const wfMotion = { layout: 320, camera: 400, pulse: 1600, easeInOut: "cubic-bezier(0.4, 0, 0.2, 1)" } as const;
/** Canvas durations under reduced motion: layout and camera moves are immediate and the pulse is a static ring. */
export const wfMotionFor = (reduceMotion: boolean) => (reduceMotion ? { layout: 0, camera: 0, pulse: 0, easeInOut: wfMotion.easeInOut } : wfMotion);

export const iconSize = { xs: 12, sm: 14, md: 16, lg: 20, "toolbar-touch": 22, xl: 24 } as const;
export const ICON_STROKE = 1.5;

export const control = { xs: 24, sm: 28, md: 32, lg: 40, touch: 44, "editor-bar-compact": 44 } as const;
export type ControlSize = "xs" | "sm" | "md" | "lg";
export type Density = "regular" | "touch";
export type FormFactor = "compact" | "medium" | "wide";
/** Default sizes per density: `touch` is the compact-touch density of the specification. */
export const densityDefaults = {
  regular: { row: 28, rowTwoLine: 44, button: 32, input: 32, inspectorField: 28, toolbarButton: 28, tabStrip: 36, topBar: 48, hitTarget: 24 },
  touch: { row: 44, rowTwoLine: 56, button: 44, input: 44, inspectorField: 44, toolbarButton: 44, tabStrip: 44, topBar: 56, hitTarget: 44 },
} as const;
/** Height of a control of a size token: every size is 44 px at compact-touch density. */
export const controlHeight = (size: ControlSize, density: Density) => (density === "touch" ? control.touch : control[size]);
export const controlPadding: Record<ControlSize, number> = { xs: 8, sm: 10, md: 12, lg: 16 };

export const breakpoints = { xs: 0, sm: 576, md: 720, lg: 992, xl: 1200 } as const;
export type Breakpoint = keyof typeof breakpoints;
export function breakpointOf(width: number): Breakpoint {
  return width >= breakpoints.xl ? "xl" : width >= breakpoints.lg ? "lg" : width >= breakpoints.md ? "md" : width >= breakpoints.sm ? "sm" : "xs";
}
/** Form factor depends on viewport width only: it decides layout, never sizes. */
export function formFactorOf(width: number): FormFactor {
  return width < breakpoints.md ? "compact" : width < breakpoints.lg ? "medium" : "wide";
}
/** Density is compact-touch when the form factor is compact or the primary pointer is coarse. */
export function densityOf(width: number, coarsePointer: boolean): Density {
  return formFactorOf(width) === "compact" || coarsePointer ? "touch" : "regular";
}

export const layout = {
  sidebar: 240, sidebarMin: 200, sidebarMax: 360, topBar: 48, topBarTouch: 56, secondaryHeader: 36,
  columnComposer: 720, columnSettings: 560, columnWide: 760, columnLongForm: 820, settingsNav: 240,
  sideSheet: 400, modal: { confirm: 360, form: 480, complex: 640 }, popoverMax: 320, popoverWideMax: 400, popoverMin: 180,
  macTrafficLightInset: 78, drawerMax: 320, drawerFraction: 0.86, viewportInset: 8,
} as const;

/** Component dimensions stated by the component requirements, in px. Keys ending `Touch` apply at compact-touch density. */
export const size = {
  dot: 6, dotTouch: 8, badge: 16, badgePadding: 5, pill: 20, chipSm: 20, chipMd: 24, chipThumb: 14, attachment: 28, attachmentThumb: 20,
  kbd: 18, avatarSquare: 6, iconTile: 28, emptyIcon: 32, emptyMax: 320, linkBadge: 12,
  switchWidth: 32, switchHeight: 18, switchThumb: 14, switchWidthTouch: 44, switchHeightTouch: 26, switchThumbTouch: 22, switchInset: 2,
  checkbox: 16, checkboxTouch: 20, radioDot: 6, radioDotTouch: 8, toggleHit: 28,
  sliderTrack: 4, sliderThumb: 14, sliderThumbTouch: 20, sliderTick: 10, sliderMin: 40,
  spinnerSm: 12, spinner: 14, spinnerMd: 16, spinnerLg: 24, statusRing: 16, progress: 4, progressThin: 2,
  calloutBar: 3, banner: 36, tooltipMax: 240, tooltipGap: 6, toastMin: 240, toastMax: 420, toastEdge: 16,
  grabWidth: 36, grabHeight: 4, splitSegment: 24, send: 28, focusRing: 2, focusOffset: 2,
  tableHeader: 32, tableRow: 44, tableRowDense: 36, tableCheck: 28, treeIndent: 16, lineIndent: 16, quoteBar: 3,
  splitterHit: 8, splitterHitTouch: 16, splitterActive: 2, tabFade: 24, tabGap: 16, menuSeparatorMargin: 4,
  qrMin: 160, qrDefault: 220, qrMax: 320, imageMax: 320, swatch: 20, swatchSm: 16, checker: 8, pickerSquare: 120, pickerBar: 8,
  pickerThumb: 12, pickerWidth: 232, calendarCell: 32, calendarCellTouch: 44, weekday: 28, timeSegment: 24, otp: 44,
  rulerMajor: 8, rulerMinor: 4, rulerMinGap: 6, clipInset: 4, clipBadge: 14, clipLabel: 16, provenance: 16, keyframe: 8, keyframeSelected: 12,
  beatDot: 6, zoomTrack: 96, hatchPitch: 8, hatchLine: 2, offlineStripe: 6, selectionOutline: 2, markerLine: 1, rangeEdge: 2,
  chartHeight: 160, chartBarGap: 4, legendSwatch: 8, sparklineStroke: 1.5, mediaPlay: 36, scrollThreshold: 200,
  composerMin: 320, composerMax: 720, menuBar: 28, caption: 11,
} as const;
/** Fixed values that are not theme colours: the pressed overlay of non-accent buttons and the checkerboard behind a swatch. */
export const PRESSED_OVERLAY = "rgba(0,0,0,0.08)";
export const CHECKERBOARD = ["#CCCCCC", "#FFFFFF"] as const;
export const TRANSPARENT = "transparent";
/** Avatar sizes and the size of their initials. */
export const avatarSizes = { 16: 8, 20: 10, 24: 10, 32: 12, 40: 14 } as const;
