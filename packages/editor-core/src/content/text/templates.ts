/**
 * The 30 bundled text templates: section 5 of `text-and-titles/catalog.md`. A template is a list of text and shape
 * members; positions are the member's centre in % of the canvas width and height from the canvas centre, times are
 * seconds from the group start, and every member carries its own animations.
 */
export type TemplateSlot = [id: string, seconds: number];
export type TemplateKeys = { path: string; keys: [seconds: number, value: number][]; easing?: "linear" | "out-cubic" | "out-back" };
export type TemplateText = {
  kind: "text"; content: string; fontFamily: string; fontWeight: 400 | 700; fontStyle?: "italic"; fontSize: number; textCase?: "upper";
  /** A preset id of section 2, and style fields written after it. */
  preset?: string; style?: Record<string, unknown>; bubble?: { id: string; color?: string };
  align: "left" | "center" | "right"; boxWidth?: number; position: [x: number, y: number]; from?: number; to?: number;
  in?: TemplateSlot; out?: TemplateSlot; loop?: TemplateSlot; keyframes?: TemplateKeys[];
};
export type TemplateShape = {
  kind: "shape"; definitionId: "rectangle" | "ellipse" | "arrow"; params: Record<string, unknown>;
  /** Width in % of the canvas width and height in % of the canvas height; `square` sizes both by the canvas height. */
  size: [width: number, height: number]; square?: boolean; position: [x: number, y: number]; rotation?: number; from?: number; to?: number; keyframes?: TemplateKeys[];
};
export type TextTemplate = { id: string; name: string; category: (typeof TEXT_TEMPLATE_CATEGORIES)[number]; duration: number; keywords: string[]; members: (TemplateText | TemplateShape)[] };
export const TEXT_TEMPLATE_CATEGORIES = ["Titles", "Lower thirds", "Subtitles", "Social", "Quotes", "Callouts"] as const;

type TextRest = Omit<TemplateText, "kind" | "content" | "fontFamily" | "fontWeight" | "fontSize" | "align" | "position">;
const T = (content: string, fontFamily: string, fontWeight: 400 | 700, fontSize: number, align: TemplateText["align"], position: [number, number], rest: TextRest = {}): TemplateText =>
  ({ kind: "text", content, fontFamily, fontWeight, fontSize, align, position, ...rest });
const S = (definitionId: TemplateShape["definitionId"], size: [number, number], fill: string, position: [number, number], rest: Partial<TemplateShape> = {}): TemplateShape =>
  ({ kind: "shape", definitionId, size, position, ...rest, params: { fill, ...rest.params } });
const fill = (color: string, extra: Record<string, unknown> = {}) => ({ color, ...extra });
const background = (color: string, cornerRadius = 0) => ({ background: { enabled: true, color, cornerRadius, paddingX: 30, paddingY: 42 } });
const grow = (path: string, from = 0, to = 0.3, easing: TemplateKeys["easing"] = "out-cubic"): TemplateKeys => ({ path, keys: [[from, 0], [to, 1]], easing });
/** A value that swings `a → b → a` once per `period` over the template. */
const swing = (path: string, a: number, b: number, period: number, duration: number): TemplateKeys => {
  const keys: [number, number][] = [];
  for (let time = 0; time <= duration + 1e-9; time += period / 2) keys.push([Math.round(time * 1000) / 1000, keys.length % 2 === 0 ? a : b]);
  return { path, keys, easing: "out-cubic" };
};
const FADE: TemplateSlot = ["out-fade", 0.3];

export const TEXT_TEMPLATES: readonly TextTemplate[] = [
  { id: "title-clean", name: "Clean title", category: "Titles", duration: 4, keywords: ["title", "clean", "simple"], members: [T("Your title", "Arial", 700, 12, "center", [0, 0], { preset: "plain-white", in: ["in-fade", 0.5], out: ["out-fade", 0.5] })] },
  { id: "title-outline", name: "Bold outline", category: "Titles", duration: 4, keywords: ["title", "bold", "outline"], members: [T("BIG TITLE", "Arial", 700, 16, "center", [0, 0], { textCase: "upper", preset: "outline-thick", in: ["in-pop", 0.6], out: ["out-zoom-out", 0.4] })] },
  { id: "title-stack", name: "Stacked title", category: "Titles", duration: 5, keywords: ["title", "subtitle", "stack"], members: [
    T("Main title", "Georgia", 700, 12, "center", [0, -6], { preset: "plain-white", in: ["in-rise", 0.6], out: ["out-fade", 0.4] }),
    S("rectangle", [30, 0.6], "#ffd400", [0, 2], { keyframes: [grow("transform.scale.x", 0, 0.4)] }),
    T("Subtitle goes here", "Arial", 400, 6, "center", [0, 8], { from: 0.3, preset: "plain-white", in: ["in-fade", 0.6], out: ["out-fade", 0.4] }),
  ] },
  { id: "title-neon", name: "Neon sign", category: "Titles", duration: 4, keywords: ["title", "neon", "glow"], members: [T("NEON", "sans-serif", 700, 18, "center", [0, 0], { preset: "neon-pink", in: ["in-flicker", 0.8], loop: ["loop-breathe", 2], out: ["out-fade", 0.4] })] },
  { id: "title-cinema", name: "Cinematic", category: "Titles", duration: 6, keywords: ["title", "film", "cinema"], members: [T("A FILM TITLE", "Times New Roman", 400, 10, "center", [0, 0], { textCase: "upper", preset: "plain-white", keyframes: [{ path: "letterSpacing", keys: [[0, 40], [6, 60]], easing: "linear" }], in: ["in-blur", 1.2], out: ["out-fade", 1] })] },
  { id: "title-typed", name: "Typed title", category: "Titles", duration: 4, keywords: ["title", "typewriter", "typed"], members: [T("Typing a title…", "Courier New", 700, 10, "left", [0, 0], { preset: "plain-white", boxWidth: 70, in: ["in-typewriter", 1.5], out: FADE })] },

  { id: "lower-third-bar", name: "Name bar", category: "Lower thirds", duration: 4, keywords: ["lower third", "name", "bar"], members: [
    S("rectangle", [36, 9], "#111111cc", [-28, 34], { keyframes: [grow("transform.scale.x")] }),
    T("Full Name", "Arial", 700, 6, "left", [-28, 32], { preset: "plain-white", in: ["in-slide-right", 0.4], out: FADE }),
    T("Title or role", "Arial", 400, 4, "left", [-28, 37], { style: fill("#ffd400"), in: ["in-fade", 0.4], out: FADE }),
  ] },
  { id: "lower-third-line", name: "Accent line", category: "Lower thirds", duration: 4, keywords: ["lower third", "name", "line"], members: [
    S("rectangle", [0.5, 8], "#ff3b30", [-45, 34], { keyframes: [grow("transform.scale.y", 0, 0.3, "linear")] }),
    T("Full Name", "Arial", 700, 6, "left", [-27, 32], { preset: "soft-shadow", in: ["in-slide-right", 0.4], out: FADE }),
    T("Title or role", "Arial", 400, 4, "left", [-27, 37], { preset: "soft-shadow", in: ["in-slide-right", 0.5], out: FADE }),
  ] },
  { id: "lower-third-box", name: "Boxed name", category: "Lower thirds", duration: 4, keywords: ["lower third", "name", "box"], members: [
    T("Full Name", "Arial", 700, 6, "left", [-30, 31], { style: fill("#111111", background("#ffffff")), in: ["in-wipe-right", 0.4], out: FADE }),
    T("Title or role", "Arial", 400, 4, "left", [-30, 38], { style: fill("#ffffff", background("#111111")), in: ["in-wipe-right", 0.5], out: FADE }),
  ] },
  { id: "lower-third-pill", name: "Pill tag", category: "Lower thirds", duration: 4, keywords: ["lower third", "name", "pill"], members: [T("Full Name", "Arial", 700, 5, "center", [-30, 36], { style: fill("#ffffff"), bubble: { id: "label-pill" }, in: ["in-pop", 0.4], out: FADE })] },
  { id: "lower-third-two-tone", name: "Two-tone", category: "Lower thirds", duration: 5, keywords: ["lower third", "name", "two tone"], members: [
    S("rectangle", [40, 6], "#ffd400", [-26, 32], { keyframes: [grow("transform.scale.x", 0, 0.3, "linear")] }),
    S("rectangle", [30, 4], "#111111", [-31, 37.5], { keyframes: [grow("transform.scale.x", 0.15, 0.45, "linear")] }),
    T("Full Name", "Arial", 700, 5, "left", [-26, 32], { style: fill("#111111"), in: ["in-fade", 0.4], out: FADE }),
    T("Title or role", "Arial", 400, 3.5, "left", [-31, 37.5], { style: fill("#ffffff"), in: ["in-fade", 0.5], out: FADE }),
  ] },
  { id: "lower-third-minimal", name: "Minimal", category: "Lower thirds", duration: 4, keywords: ["lower third", "name", "minimal"], members: [
    T("Full Name", "Georgia", 700, 6, "left", [-30, 33], { preset: "soft-shadow", in: ["in-rise", 0.5], out: FADE }),
    T("Location · Date", "Arial", 400, 3.5, "left", [-30, 38], { preset: "soft-shadow", style: { letterSpacing: 20 }, in: ["in-fade", 0.6], out: FADE }),
  ] },

  { id: "subtitle-plain", name: "Plain subtitle", category: "Subtitles", duration: 3, keywords: ["subtitle", "caption", "plain"], members: [T("Subtitle text goes here", "Arial", 700, 5, "center", [0, 40], { preset: "outline-black", boxWidth: 80 })] },
  { id: "subtitle-boxed", name: "Boxed subtitle", category: "Subtitles", duration: 3, keywords: ["subtitle", "caption", "box"], members: [T("Subtitle text goes here", "Arial", 400, 5, "center", [0, 40], { style: fill("#ffffff", background("#000000b3", 20)), boxWidth: 80 })] },
  { id: "subtitle-yellow", name: "Yellow subtitle", category: "Subtitles", duration: 3, keywords: ["subtitle", "caption", "yellow"], members: [T("Subtitle text goes here", "Arial", 700, 5, "center", [0, 40], { preset: "yellow-pop", boxWidth: 80 })] },
  { id: "subtitle-speaker", name: "Speaker subtitle", category: "Subtitles", duration: 3, keywords: ["subtitle", "caption", "speaker"], members: [
    T("SPEAKER", "Arial", 700, 3.5, "center", [0, 35], { style: fill("#ffd400", { stroke: { enabled: true, color: "#000000", width: 6, position: "outside" } }) }),
    T("What they say goes here", "Arial", 400, 5, "center", [0, 41], { preset: "outline-black", boxWidth: 80 }),
  ] },

  { id: "social-follow", name: "Follow prompt", category: "Social", duration: 3, keywords: ["social", "follow", "subscribe"], members: [T("Follow for more", "Arial", 700, 6, "center", [0, 30], { style: fill("#ffffff"), bubble: { id: "label-pill", color: "#ff2d92" }, in: ["in-pop", 0.4], loop: ["loop-pulse", 1], out: FADE })] },
  { id: "social-handle", name: "Handle tag", category: "Social", duration: 4, keywords: ["social", "handle", "username"], members: [T("@yourname", "Arial", 700, 5, "center", [0, -40], { style: fill("#ffffff"), bubble: { id: "label-rounded" }, in: ["in-drop", 0.4], out: FADE })] },
  { id: "social-countdown", name: "Countdown", category: "Social", duration: 3, keywords: ["social", "countdown", "timer"], members: ["3", "2", "1"].map((digit, index) => T(digit, "Arial", 700, 30, "center", [0, 0], { from: index, to: index + 1, preset: "outline-thick", in: ["in-zoom-out", 0.3], out: ["out-fade", 0.2] })) },
  { id: "social-swipe", name: "Swipe hint", category: "Social", duration: 3, keywords: ["social", "swipe", "arrow"], members: [
    S("arrow", [6, 6], "#ffffff", [0, 30], { rotation: -90, keyframes: [swing("transform.position.y", 30, 27, 1, 3)] }),
    T("Swipe up", "Arial", 700, 6, "center", [0, 38], { preset: "soft-shadow", in: ["in-fade", 0.3], loop: ["loop-float", 1] }),
  ] },
  { id: "social-new", name: "New badge", category: "Social", duration: 3, keywords: ["social", "new", "badge"], members: [T("NEW", "Arial", 700, 8, "center", [30, -30], { style: fill("#111111"), bubble: { id: "shout-burst" }, in: ["in-spin", 0.5], loop: ["loop-wobble", 1], out: ["out-zoom-out", 0.3] })] },

  { id: "quote-classic", name: "Classic quote", category: "Quotes", duration: 5, keywords: ["quote", "classic", "author"], members: [
    T("“", "Georgia", 700, 30, "center", [-36, -18], { style: fill("#ffd400"), in: ["in-fade", 0.5] }),
    T("Quote text goes here, two lines at most.", "Georgia", 400, 7, "center", [0, 0], { fontStyle: "italic", preset: "plain-white", boxWidth: 70, in: ["in-fade", 0.8], out: ["out-fade", 0.5] }),
    T("— Author", "Arial", 400, 4, "center", [0, 20], { preset: "plain-white", in: ["in-fade", 0.8], out: ["out-fade", 0.5] }),
  ] },
  { id: "quote-card", name: "Quote card", category: "Quotes", duration: 5, keywords: ["quote", "card", "author"], members: [
    S("rectangle", [80, 44], "#ffffff", [0, 0], { params: { cornerRadius: 6 }, keyframes: [{ path: "opacity", keys: [[0, 0], [0.4, 1]], easing: "linear" }] }),
    T("Quote text goes here, two lines at most.", "Georgia", 400, 6, "center", [0, -3], { style: fill("#111111"), boxWidth: 68, in: ["in-rise", 0.6], out: ["out-fade", 0.4] }),
    T("— Author", "Arial", 700, 3.5, "center", [0, 15], { style: fill("#111111"), in: ["in-fade", 0.6], out: ["out-fade", 0.4] }),
  ] },
  { id: "quote-bold", name: "Bold statement", category: "Quotes", duration: 4, keywords: ["quote", "bold", "statement"], members: [T("ONE STRONG LINE", "Arial", 700, 12, "center", [0, 0], { textCase: "upper", preset: "hard-shadow", boxWidth: 80, in: ["in-rise", 0.8], out: ["out-fade", 0.4] })] },
  { id: "quote-bubble", name: "Speech quote", category: "Quotes", duration: 4, keywords: ["quote", "speech", "bubble"], members: [T("Something worth saying", "Arial", 700, 6, "center", [0, -10], { style: fill("#111111"), bubble: { id: "speech-round-left" }, in: ["in-pop", 0.4], out: FADE })] },

  { id: "callout-arrow", name: "Arrow label", category: "Callouts", duration: 3, keywords: ["callout", "arrow", "label"], members: [
    S("arrow", [14, 6], "#ffd400", [-10, 0], { keyframes: [swing("transform.position.x", -10, -8, 0.8, 3)] }),
    T("Look here", "Arial", 700, 5, "left", [12, 0], { preset: "outline-black", in: ["in-slide-right", 0.3], out: FADE }),
  ] },
  { id: "callout-circle", name: "Circle highlight", category: "Callouts", duration: 3, keywords: ["callout", "circle", "highlight"], members: [
    S("ellipse", [24, 24], "#ffffff00", [0, 0], { square: true, params: { stroke: "#ff3b30", strokeWidth: 8 }, keyframes: [{ path: "transform.scale", keys: [[0, 1.3], [0.3, 1]], easing: "linear" }, { path: "opacity", keys: [[0, 0], [0.3, 1]], easing: "linear" }] }),
    T("Note", "Arial", 700, 5, "center", [0, 18], { preset: "outline-black", in: ["in-fade", 0.3], out: FADE }),
  ] },
  { id: "callout-tag", name: "Price tag", category: "Callouts", duration: 3, keywords: ["callout", "price", "tag"], members: [T("$19", "Arial", 700, 8, "center", [28, -28], { style: fill("#ffffff"), bubble: { id: "tag-left", color: "#ff3b30" }, in: ["in-drop", 0.4], loop: ["loop-swing", 1.5], out: FADE })] },
  { id: "callout-step", name: "Step number", category: "Callouts", duration: 3, keywords: ["callout", "step", "number"], members: [
    S("ellipse", [12, 12], "#1e6bff", [-36, -36], { square: true, keyframes: [{ path: "transform.scale", keys: [[0, 0], [0.3, 1]], easing: "out-back" }] }),
    T("1", "Arial", 700, 8, "center", [-36, -36], { preset: "plain-white", in: ["in-fade", 0.3] }),
    T("Step title", "Arial", 700, 6, "left", [-10, -36], { preset: "soft-shadow", in: ["in-slide-right", 0.4], out: FADE }),
  ] },
  { id: "callout-warning", name: "Warning banner", category: "Callouts", duration: 3, keywords: ["callout", "warning", "important"], members: [T("IMPORTANT", "Arial", 700, 6, "center", [0, -38], { style: fill("#111111"), bubble: { id: "banner-ribbon", color: "#ffcc00" }, in: ["in-stretch", 0.4], loop: ["loop-pulse", 1], out: FADE })] },
];

/** Templates by name and keyword, case-insensitive; an empty query lists all. */
export function searchTextTemplates(query: string): TextTemplate[] {
  const needle = query.trim().toLowerCase();
  return needle === "" ? [...TEXT_TEMPLATES] : TEXT_TEMPLATES.filter((template) => template.name.toLowerCase().includes(needle) || template.category.toLowerCase().includes(needle) || template.keywords.some((keyword) => keyword.includes(needle)));
}
