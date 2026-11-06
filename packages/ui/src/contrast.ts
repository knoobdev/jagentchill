/** WCAG 2.2 contrast of the token pairings a component may draw: the contrast pair matrix of the design-system specification. */
import { INCREASE_CONTRAST, palettes, type ColorToken, type Palette, type Scheme } from "./tokens.ts";

export type Rgba = { r: number; g: number; b: number; a: number };

export function parseColor(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value.trim());
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: hex[2] ? parseInt(hex[2], 16) / 255 : 1 };
  }
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(value.trim());
  if (!rgba) throw new Error(`Not a colour: ${value}`);
  return { r: Number(rgba[1]), g: Number(rgba[2]), b: Number(rgba[3]), a: rgba[4] === undefined ? 1 : Number(rgba[4]) };
}

/** Source-over composite of a colour with alpha on an opaque backdrop. */
export function composite(top: Rgba, backdrop: Rgba): Rgba {
  const mix = (a: number, b: number) => a * top.a + b * (1 - top.a);
  return { r: mix(top.r, backdrop.r), g: mix(top.g, backdrop.g), b: mix(top.b, backdrop.b), a: 1 };
}

export function luminance(color: Rgba): number {
  const channel = (value: number) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

/** Contrast ratio of a foreground on a background. Alpha colours are composited first: the background on `under`, then the foreground on it. */
export function contrastRatio(foreground: string, background: string, under = "#FFFFFF"): number {
  const back = composite(parseColor(background), parseColor(under));
  const fore = composite(parseColor(foreground), back);
  const [a, b] = [luminance(fore), luminance(back)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const SURFACES = ["bg/app", "bg/sidebar", "bg/subtle", "bg/hover", "bg/elevated", "bg/inset", "bg/canvas"] as const satisfies readonly ColorToken[];
const CLIPS = ["clip/video", "clip/overlay", "clip/image", "clip/audio", "clip/text", "clip/sticker", "clip/effect", "clip/filter", "clip/adjustment", "clip/caption", "clip/compound"] as const satisfies readonly ColorToken[];
const LANES = ["timeline/track-bg", "timeline/track-bg-alt"] as const satisfies readonly ColorToken[];
const CHART_SURFACES = ["bg/app", "bg/elevated", "bg/sidebar"] as const satisfies readonly ColorToken[];
const numbered = <P extends string>(prefix: P, count: number) => Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`) as ColorToken[];
const prefixed = (prefix: string) => (Object.keys(palettes.light) as ColorToken[]).filter((token) => token.startsWith(prefix));

export type PairFamily = {
  name: string; kind: "text" | "non-text"; minimum: number;
  /** Explicit pairs. `under` is an opaque token or colour the background is composited on when it has alpha. */
  pairs: Array<{ fg: ColorToken; bg: ColorToken; under?: ColorToken | "#FFFFFF" }>;
  /** Pairs exempt in one theme (dark `terminal/ansi/black`). */
  exempt?: Array<{ fg: ColorToken; scheme: Scheme }>;
};
const cross = (fgs: readonly ColorToken[], bgs: readonly ColorToken[], under?: ColorToken | "#FFFFFF") =>
  fgs.flatMap((fg) => bgs.map((bg) => ({ fg, bg, under })));
const family = (name: string, kind: "text" | "non-text", pairs: PairFamily["pairs"], exempt?: PairFamily["exempt"]): PairFamily =>
  ({ name, kind, minimum: kind === "text" ? 4.5 : 3, pairs, exempt });

const STATUS = ["success", "warning", "danger", "purple"] as const;

/** The families a component may draw. A foreground on a background outside every family is a lint error. */
export const PAIR_FAMILIES: PairFamily[] = [
  family("Body text", "text", cross(["text/primary", "text/secondary"], SURFACES)),
  family("Link, token-chip and selected-chip text", "text", cross(["accent/text"], [...SURFACES, "accent/subtle"])),
  family("Status text", "text", STATUS.flatMap((tone) => cross([`${tone}/text`], [...SURFACES, `${tone}/subtle`]))),
  family("Neutral text on tinted fills", "text", cross(["text/primary", "text/secondary"], ["accent/subtle", "success/subtle", "warning/subtle", "danger/subtle", "purple/subtle"])),
  family("Placeholder text", "text", cross(["text/placeholder"], ["bg/app", "bg/elevated", "bg/inset", "bg/sidebar"])),
  family("Primary button label", "text", cross(["text/on-accent"], ["accent", "accent/hover", "accent/pressed"])),
  family("Destructive button label", "text", cross(["text/on-danger"], ["danger", "danger/hover"])),
  family("Strong button, tooltip and toast text and icons", "text", cross(["text/on-strong"], ["strong", "strong/hover"])),
  family("Control boundary", "non-text", cross(["border/control"], SURFACES)),
  family("Switch and slider thumb", "non-text", cross(["control/thumb"], ["border/control", "accent"])),
  family("Focus ring, switch-on track, checked fill, unread dot, progress fill, selected-card border", "non-text", cross(["accent"], SURFACES)),
  family("Accent icon on its tint", "non-text", cross(["accent"], ["accent/subtle"])),
  family("Meaningful status icon", "non-text", cross(["success", "warning/icon", "danger", "purple"], SURFACES)),
  family("Invalid field border", "non-text", cross(["danger"], ["bg/app", "bg/elevated", "bg/inset"])),
  family("Diff text", "text", cross(["text/primary"], ["diff/added", "diff/removed", "diff/added-strong", "diff/removed-strong"])),
  family("Diff gutter mark", "text", [{ fg: "diff/gutter-added", bg: "diff/added" }, { fg: "diff/gutter-removed", bg: "diff/removed" }]),
  family("Clip label on clip fill", "text", cross(["clip/label"], CLIPS)),
  family("Clip label on the scrim", "text", cross(["clip/label"], ["clip/label-scrim"], "#FFFFFF")),
  family("Clip fill against the lane", "non-text", cross(CLIPS, LANES)),
  family("Keyframe outline and clip badges on clip fill", "non-text", cross(["clip/label"], CLIPS)),
  family("Waveform on clip fill", "non-text", cross(["waveform/fill"], ["clip/audio", "clip/video"])),
  family("Clipping tip on the waveform", "non-text", [{ fg: "waveform/clip", bg: "waveform/fill", under: "clip/audio" }, { fg: "waveform/clip", bg: "waveform/fill", under: "clip/video" }]),
  family("Beat marker on an audio-bearing clip", "non-text", cross(["waveform/beat"], ["clip/audio", "clip/video"])),
  family("Ruler text", "text", cross(["timeline/ruler-text"], LANES)),
  family("Playhead, selection outline, marker outline, snap line", "non-text", cross(["timeline/playhead", "timeline/selection", "timeline/snap"], LANES)),
  family("Preview handle and guide on the stage", "non-text", cross(["preview/handle-fill", "preview/guide"], ["bg/editor"])),
  family("Preview handle border on its fill", "non-text", cross(["preview/handle-border"], ["preview/handle-fill"])),
  family("Avatar initials", "text", cross(["avatar/text"], numbered("avatar/bg/", 8))),
  family("Chart series", "non-text", cross(numbered("chart/", 8), CHART_SURFACES)),
  family("Chart axis text", "text", cross(["chart/axis-text"], CHART_SURFACES)),
  // Families owned by the workflow canvas and terminal token requirements, tested with the same thresholds.
  family("Workflow canvas colours", "non-text", cross([...prefixed("wf/type/"), ...prefixed("wf/port/"), ...prefixed("wf/group/"), "wf/edge-idle"], ["wf/node-bg", "wf/canvas-bg"])),
  family("Terminal text", "text", cross(["terminal/fg", ...prefixed("terminal/ansi/")], ["terminal/bg"]), [{ fg: "terminal/ansi/black", scheme: "dark" }]),
  // Pairs components draw that sit inside the listed families' intent and are checked with them.
  family("Text on the editor stage", "text", cross(["clip/label"], ["bg/editor", "preview/offline-fill"])),
  family("QR modules on the tile", "non-text", cross(["qr/module"], ["qr/tile"])),
  family("Terminal cursor", "non-text", cross(["terminal/cursor"], ["terminal/bg"]).concat(cross(["terminal/cursor-text"], ["terminal/cursor"]))),
];

export type PairResult = { family: string; kind: "text" | "non-text"; fg: ColorToken; bg: ColorToken; scheme: Scheme; ratio: number; minimum: number };

const rounded = (ratio: number) => Math.round(ratio * 100) / 100;

/** Every pair of the matrix in one theme, with ratios rounded to two decimals as the specification states them. */
export function measurePairs(palette: Palette, scheme: Scheme, families: PairFamily[] = PAIR_FAMILIES): PairResult[] {
  return families.flatMap((entry) => entry.pairs
    .filter((pair) => !entry.exempt?.some((skip) => skip.fg === pair.fg && skip.scheme === scheme))
    .map((pair) => {
      const under = pair.under ? (pair.under.startsWith("#") ? pair.under : palette[pair.under as ColorToken]) : "#FFFFFF";
      return { family: entry.name, kind: entry.kind, fg: pair.fg, bg: pair.bg, scheme, minimum: entry.minimum, ratio: rounded(contrastRatio(palette[pair.fg], palette[pair.bg], under)) };
    }));
}

export function increaseContrastPalette(palette: Palette): Palette {
  const next = { ...palette };
  for (const [token, target] of Object.entries(INCREASE_CONTRAST)) next[token as ColorToken] = palette[target as ColorToken];
  return next;
}

export type ContrastFailure = PairResult & { message: string };

/** Runs the matrix on a token export in both themes, and again for the "Increase contrast" mapping. Returns the failing pairs. */
export function checkContrast(themes: { light: Palette; dark: Palette } = palettes): ContrastFailure[] {
  const failures: ContrastFailure[] = [];
  for (const scheme of ["light", "dark"] as const) {
    for (const palette of [themes[scheme], increaseContrastPalette(themes[scheme])]) {
      for (const result of measurePairs(palette, scheme)) {
        if (result.ratio < result.minimum && !failures.some((f) => f.fg === result.fg && f.bg === result.bg && f.scheme === scheme)) {
          failures.push({ ...result, message: `${result.fg} on ${result.bg}, ${scheme} theme: ${result.ratio.toFixed(2)}:1 is below the ${result.minimum}:1 minimum (${result.family})` });
        }
      }
    }
  }
  return failures;
}

const PERMITTED = new Set(PAIR_FAMILIES.flatMap((entry) => entry.pairs.map((pair) => `${pair.fg}|${pair.bg}`)));
/** True when a component may draw this foreground on this background. */
export const isPermittedPair = (fg: ColorToken, bg: ColorToken) => PERMITTED.has(`${fg}|${bg}`);
/** Name of the family a pair belongs to, or null when it belongs to none. */
export const familyOfPair = (fg: ColorToken, bg: ColorToken) => PAIR_FAMILIES.find((entry) => entry.pairs.some((pair) => pair.fg === fg && pair.bg === bg))?.name ?? null;

/** Lowest ratio of a family in a theme. */
export function lowestOf(familyName: string, scheme: Scheme, themes = palettes): PairResult {
  const results = measurePairs(themes[scheme], scheme).filter((result) => result.family === familyName);
  return results.reduce((low, result) => (result.ratio < low.ratio ? result : low));
}
