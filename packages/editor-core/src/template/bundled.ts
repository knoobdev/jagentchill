import { createElement, createProjectDocument, createTrack, projectDocumentSchema, type ProjectDocument } from "@jagentchill/protocol";
import { normalizeDocumentValues } from "../canonical.ts";
import { TEXT_TEMPLATES } from "../content/text/templates.ts";
import { writeKey } from "../ops/animation.ts";
import type { CommandEnv } from "../timeline/command.ts";
import { buildTextTemplate } from "../timeline/text.ts";
import { TEMPLATE_PACKAGE_VERSION, readTemplateManifest, type TemplateCategory, type TemplateManifest } from "./model.ts";

/**
 * The twelve starter templates the app ships (`templates/catalog.md` section 2). Each is written here as data and
 * built with the editor's own parts — empty media slots, the bundled text templates, shapes and transitions. A starter
 * holds NO file: its music is NAMED (`starterMusic`: a track of the remote music catalogue by its id, and the search
 * that finds another when that track is gone) and fetched when a project is made from the starter on a connected
 * device; the starter itself has an empty "Music" audio track. Its cover and preview are renders of the starter
 * filled with the demo media named in `demo` (`packages/content/scripts/render-template-covers.mjs`); the demo media
 * is never part of a project.
 */
/**
 * The music a starter opens with: a track of the remote catalogue (no file is shipped). `id` is the provider's id of
 * the track; `query` is the search whose first result is taken when the provider no longer has it. Each was chosen for
 * the starter's subject from Openverse API fields (genres, tags, instrumental marker and 45–300 s duration) on
 * 2026-10-09 — nobody listened. All twelve are CC BY 3.0 at their source (Jamendo).
 */
export type StarterMusic = { provider: "openverse"; id: string; query: string; title: string; author: string };
const STARTER_MUSIC: Record<string, StarterMusic> = {
  "vlog-day": { provider: "openverse", id: "745ea2ac-be6c-4317-b0d6-c27f97bdc7f2", query: "upbeat instrumental", title: "Be Happy - FREE MUSIC", author: "ANtarcticbreeze" },
  "vlog-travel": { provider: "openverse", id: "1ac126c7-f225-483a-b819-05798020ef75", query: "travel instrumental", title: "Travel On", author: "Soularis" },
  "promo-product": { provider: "openverse", id: "3b4580e1-1454-4b4c-a03a-e03bf4af0849", query: "corporate instrumental", title: "Upbeat Corporate", author: "Soundrider/Dope" },
  "promo-sale": { provider: "openverse", id: "e9b042ea-f0ea-4ed1-8cb2-7fbaa8ef6825", query: "edm", title: "Red Moonlight ( Extended Mix )", author: "Pokki DJ" },
  "slideshow-memories": { provider: "openverse", id: "5d7a84a5-f700-4aeb-93db-b039673e7acc", query: "piano instrumental", title: "Feeling - Piano Instrumental", author: "E. Erkut" },
  "slideshow-story": { provider: "openverse", id: "311ba94a-3222-4289-80a3-97edc841ebda", query: "acoustic instrumental", title: "Little Tomcat (Instrumental Version)", author: "Josh Woodward (Instrumental Versions)" },
  "intro-channel": { provider: "openverse", id: "394ae39d-127a-4989-8aee-9a1a78619c1b", query: "corporate instrumental", title: "Inspiring Corporate", author: "Soundrider/Dope" },
  "outro-end-screen": { provider: "openverse", id: "662db44a-1cbf-4971-914d-e99c6647d995", query: "lofi", title: "Champagne", author: "Ton in Ton" },
  "short-hook": { provider: "openverse", id: "e4812054-c375-4e15-90d0-f42e9e6bf892", query: "house", title: "House Music", author: "DJ Frankie Holmes" },
  "short-top-three": { provider: "openverse", id: "8cc93f6d-fdf1-48ba-b8dc-24c7f733794f", query: "happy instrumental", title: "Be Happy", author: "Tioben Neenot" },
  "event-countdown": { provider: "openverse", id: "1a767512-5d64-4486-b6a4-5e052b4f48f5", query: "cinematic", title: "Apocalypse", author: "Hyperreal" },
  "quote-card": { provider: "openverse", id: "8b18b336-5aa4-471d-9ad7-51683f13ff7d", query: "piano", title: "Emotional - Piano Instrumental", author: "E. Erkut" },
};
export const starterMusic = (templateId: string): StarterMusic | undefined => STARTER_MUSIC[templateId];
/** The audio track every starter has for its music, and the element the fetched track becomes on it. */
export const STARTER_MUSIC_TRACK = "track-music", STARTER_MUSIC_ELEMENT = "music-1";
const SECOND = 120_000;
type Json = Record<string, any>;
type Accepts = "video" | "image" | "any";
/** A slot: what it accepts, its seconds, required or optional, and a label. `window` puts it on an overlay track at a scale and a place (% of the canvas). */
type SlotSpec = { accepts: Accepts; seconds: number; required: boolean; label?: string; window?: { scale: number; x: number; y: number } };
/**
 * One use of a bundled text template from `from` to `to` seconds. `texts` names the text members that can be changed
 * (by their position among the texts of the template); `glyphs` keeps a text member as part of the design with the
 * given content; every other text member is left out. Shapes stay. `move` shifts the whole group (% of the canvas),
 * `size` and `width` set the font size and the box width of an editable text and `nudge` shifts it alone, `colors` gives a member (text or
 * shape, by its position in the template) a theme colour.
 */
type LookSpec = {
  look: string; from: number; to: number; texts: { part?: number; label: string; content: string; maxLength: number; size?: number; width?: number; nudge?: [x: number, y: number] }[];
  glyphs?: Record<number, string>; move?: [x: number, y: number]; colors?: Record<number, number>;
};
type ShapeSpec = { definitionId: "rectangle" | "ellipse"; width: number; height: number; x: number; y: number; from: number; to: number; fill: string | number; stroke?: number; cornerRadius?: number; under?: boolean };
type CutSpec = { type: string; seconds: number; params?: Record<string, number | boolean | string>; at?: number[] };
type Spec = {
  id: string; name: string; category: TemplateCategory; canvas: [number, number]; tags: string[]; themeColors: string[]; background: string;
  slots: SlotSpec[]; looks: LookSpec[]; shapes?: ShapeSpec[];
  /** Transitions: at the cuts listed in `at` (cut 1 is between slots 1 and 2), or at every cut. */
  cuts?: CutSpec[];
  /** Every slot grows from 1 to this scale over its duration. */
  grow?: number;
  /** The demo media of the cover and the preview, in slot order, and the second the cover shows. */
  demo: string[]; coverAt: number;
};
const video = (seconds: number, label = ""): SlotSpec => ({ accepts: "video", seconds, required: true, label });
const any = (seconds: number, required: boolean, label = ""): SlotSpec => ({ accepts: "any", seconds, required, label });
const image = (seconds: number, required: boolean): SlotSpec => ({ accepts: "image", seconds, required });

const SPECS: Spec[] = [
  {
    id: "vlog-day", name: "Day in my life", category: "Vlog", canvas: [1080, 1920], tags: ["vlog", "daily", "vertical"], themeColors: ["#ffd400", "#111111"], background: "#2b2a33",
    slots: [video(3, "Opening"), video(2), video(2), any(2, false), video(3), any(3, false, "Closing")],
    cuts: [{ type: "cross-dissolve", seconds: 0.5, at: [1] }, { type: "whip-pan", seconds: 0.4, params: { direction: "left" }, at: [2, 4] }],
    looks: [
      { look: "title-outline", from: 0, to: 3, move: [0, -14], colors: { 0: 0 }, texts: [{ label: "Title", content: "A day in my life", maxLength: 30, size: 10.5, width: 92 }] },
      { look: "subtitle-plain", from: 12, to: 15, move: [0, -6], texts: [{ label: "Closing line", content: "See you tomorrow", maxLength: 40, size: 6 }] },
    ],
    demo: ["sky-morning", "forest-light", "ocean-day", "studio-product", "city-dusk", "hills-sunset"], coverAt: 1.6,
  },
  {
    id: "vlog-travel", name: "Travel recap", category: "Vlog", canvas: [1920, 1080], tags: ["travel", "trip", "recap"], themeColors: ["#ffffff", "#009dff"], background: "#16324a",
    slots: [video(4, "Opening"), video(3), any(2, true), any(2, false), video(3), any(3, false), video(3, "Closing")],
    cuts: [{ type: "push", seconds: 0.5, params: { direction: "left" } }],
    looks: [
      { look: "title-stack", from: 0, to: 4, move: [0, -8], colors: { 1: 1 }, texts: [{ part: 0, label: "Title", content: "Somewhere new", maxLength: 30 }, { part: 1, label: "Subtitle", content: "Three days, one city", maxLength: 40 }] },
      { look: "lower-third-minimal", from: 4, to: 8, texts: [{ part: 0, label: "Place", content: "City, Country", maxLength: 40 }, { part: 1, label: "Date", content: "June 2026", maxLength: 30 }] },
    ],
    demo: ["city-dusk", "hills-sunset", "ocean-day", "sky-morning", "forest-light", "street-night", "bokeh-gold"], coverAt: 2,
  },
  {
    id: "promo-product", name: "Product spotlight", category: "Promo", canvas: [1080, 1080], tags: ["product", "promo", "square"], themeColors: ["#1e6bff", "#ffffff", "#ff3b30"], background: "#f1ddd0",
    slots: [any(3, true, "Product"), any(3, true), any(3, false), any(3, true)],
    cuts: [{ type: "zoom-in", seconds: 0.4 }], grow: 1.06,
    looks: [
      { look: "title-clean", from: 0, to: 3, move: [0, -37], colors: { 0: 0 }, texts: [{ label: "Product name", content: "Product name", maxLength: 30, size: 10 }] },
      { look: "subtitle-boxed", from: 3, to: 9, texts: [{ label: "Tagline", content: "One line about why it is great", maxLength: 50 }] },
      { look: "callout-tag", from: 9, to: 12, texts: [{ label: "Price", content: "$19", maxLength: 8 }] },
    ],
    shapes: [{ definitionId: "rectangle", width: 12, height: 0.8, x: 0, y: -29, from: 0, to: 3, fill: 0 }],
    demo: ["studio-product", "pastel-wash", "bokeh-gold", "light-leak"], coverAt: 1.5,
  },
  {
    id: "promo-sale", name: "Flash sale", category: "Promo", canvas: [1080, 1920], tags: ["sale", "promo", "offer"], themeColors: ["#ffcc00", "#ff2d92", "#111111"], background: "#3a1466",
    slots: [any(3, true), any(3, true), any(4, false)],
    cuts: [{ type: "flash", seconds: 0.3, at: [1] }, { type: "color-bars", seconds: 0.5, params: { direction: "up" }, at: [2] }],
    looks: [
      { look: "title-outline", from: 0, to: 3, colors: { 0: 0 }, move: [0, -6], texts: [{ label: "Headline", content: "FLASH SALE", maxLength: 20, size: 12.5, width: 94 }] },
      { look: "callout-warning", from: 3, to: 6, move: [0, 34], texts: [{ label: "Offer", content: "50% off today", maxLength: 24, size: 8 }] },
      { look: "social-follow", from: 6, to: 10, move: [0, -28], texts: [{ label: "Call to action", content: "Shop now", maxLength: 20, size: 9 }] },
    ],
    demo: ["confetti-party", "light-leak", "bokeh-gold"], coverAt: 1.5,
  },
  {
    id: "slideshow-memories", name: "Memories", category: "Slideshow", canvas: [1920, 1080], tags: ["photos", "memories", "slideshow"], themeColors: ["#ffffff", "#ffd400"], background: "#2a2622",
    slots: [image(3, true), image(3, true), image(3, true), image(3, true), image(3, false), image(3, false), image(3, false), image(3, false)],
    cuts: [{ type: "cross-dissolve", seconds: 1 }], grow: 1.08,
    looks: [
      { look: "title-cinema", from: 0, to: 6, texts: [{ label: "Title", content: "Our memories", maxLength: 30 }] },
      { look: "title-clean", from: 18, to: 24, move: [0, 36], colors: { 0: 1 }, texts: [{ label: "Date", content: "2026", maxLength: 30, size: 5 }] },
    ],
    shapes: [{ definitionId: "rectangle", width: 10, height: 0.5, x: 0, y: 11, from: 0, to: 6, fill: 1 }],
    demo: ["forest-light", "ocean-day", "hills-sunset", "sky-morning", "city-dusk", "bokeh-gold", "street-night", "pastel-wash"], coverAt: 2.2,
  },
  {
    id: "slideshow-story", name: "Photo story", category: "Slideshow", canvas: [1080, 1350], tags: ["photos", "story", "portrait"], themeColors: ["#fff8e7", "#ffd400"], background: "#33291f",
    slots: [image(3, true), image(3, true), image(3, true), image(3, false), image(3, false)],
    cuts: [{ type: "slide", seconds: 0.5, params: { direction: "up" } }],
    looks: [{ look: "quote-classic", from: 0, to: 6, glyphs: { 0: "“" }, colors: { 1: 0, 2: 0 }, texts: [{ part: 1, label: "Caption", content: "A little story", maxLength: 60, size: 9 }, { part: 2, label: "Author", content: "— You", maxLength: 30, size: 4.5 }] }],
    demo: ["street-night", "bokeh-gold", "forest-light", "hills-sunset", "ocean-day"], coverAt: 2,
  },
  {
    id: "intro-channel", name: "Channel intro", category: "Intro and outro", canvas: [1920, 1080], tags: ["intro", "opener"], themeColors: ["#ff2d92", "#ffffff"], background: "#14102e",
    slots: [any(6, false, "Background")],
    shapes: [{ definitionId: "rectangle", width: 100, height: 100, x: 0, y: 0, from: 0, to: 6, fill: "#00000040", under: true }],
    looks: [
      { look: "title-neon", from: 0, to: 6, move: [0, -4], texts: [{ label: "Channel name", content: "Your channel", maxLength: 20, size: 15 }] },
      { look: "subtitle-plain", from: 2, to: 6, move: [0, -22], texts: [{ label: "Tagline", content: "New videos every week", maxLength: 40 }] },
    ],
    demo: ["light-leak"], coverAt: 4.5,
  },
  {
    id: "outro-end-screen", name: "End screen", category: "Intro and outro", canvas: [1920, 1080], tags: ["outro", "end screen"], themeColors: ["#ff2d92", "#ffd400", "#111111"], background: "#111111",
    slots: [{ accepts: "video", seconds: 8, required: false, label: "Left video", window: { scale: 0.42, x: -24, y: 4 } }, { accepts: "video", seconds: 8, required: false, label: "Right video", window: { scale: 0.42, x: 24, y: 4 } }],
    shapes: [
      { definitionId: "rectangle", width: 43.2, height: 44.2, x: -24, y: 4, from: 0, to: 8, fill: "#1f1f24", stroke: 0, under: true },
      { definitionId: "rectangle", width: 43.2, height: 44.2, x: 24, y: 4, from: 0, to: 8, fill: "#1f1f24", stroke: 0, under: true },
    ],
    looks: [
      { look: "title-clean", from: 0, to: 8, move: [0, -36], texts: [{ label: "Thanks", content: "Thanks for watching", maxLength: 30, size: 9 }] },
      { look: "callout-arrow", from: 1, to: 8, move: [-2, 33], colors: { 0: 1 }, texts: [{ label: "Next", content: "Watch next", maxLength: 20 }] },
      { look: "social-follow", from: 2, to: 8, move: [0, 13], texts: [{ label: "Follow", content: "Subscribe", maxLength: 20, size: 5 }] },
    ],
    demo: ["city-dusk", "ocean-day"], coverAt: 4,
  },
  {
    id: "short-hook", name: "Hook and reveal", category: "Social short", canvas: [1080, 1920], tags: ["hook", "reveal", "short"], themeColors: ["#ffffff", "#ff3b30"], background: "#1d1024",
    slots: [video(2), video(3), video(4)],
    cuts: [{ type: "glitch-cut", seconds: 0.3, at: [1] }, { type: "zoom-in", seconds: 0.4, at: [2] }],
    looks: [
      { look: "title-typed", from: 0, to: 2, move: [0, -8], texts: [{ label: "Hook", content: "Wait for it…", maxLength: 24, size: 11, width: 84 }] },
      { look: "quote-bold", from: 5, to: 9, move: [0, -6], texts: [{ label: "Reveal", content: "Here it is", maxLength: 24, size: 12, width: 92 }] },
    ],
    shapes: [{ definitionId: "rectangle", width: 22, height: 0.7, x: 0, y: 12, from: 5, to: 9, fill: 1 }],
    demo: ["street-night", "light-leak", "confetti-party"], coverAt: 6.6,
  },
  {
    id: "short-top-three", name: "Top three", category: "Social short", canvas: [1080, 1920], tags: ["list", "top", "short"], themeColors: ["#1e6bff", "#ffffff"], background: "#10233f",
    slots: [video(4), video(4), video(4)],
    cuts: [{ type: "swipe-up", seconds: 0.4 }],
    looks: [
      { look: "title-outline", from: 0, to: 2, move: [0, -4], texts: [{ label: "Title", content: "Top 3", maxLength: 16, size: 16 }] },
      ...["First thing", "Second thing", "Third thing"].map((content, index): LookSpec => ({ look: "callout-step", from: index * 4, to: index * 4 + 4, move: [8, 66], glyphs: { 0: String(index + 1) }, texts: [{ part: 1, label: `Item ${index + 1}`, content, maxLength: 24, size: 6, nudge: [12, 0] }] })),
    ],
    demo: ["forest-light", "ocean-day", "hills-sunset"], coverAt: 1.4,
  },
  {
    id: "quote-card", name: "Quote of the day", category: "Quote", canvas: [1080, 1080], tags: ["quote", "square"], themeColors: ["#ffd400", "#ffffff"], background: "#3b2a3f",
    slots: [any(8, false, "Background")],
    shapes: [{ definitionId: "rectangle", width: 100, height: 100, x: 0, y: 0, from: 0, to: 8, fill: "#00000066", under: true }],
    looks: [{ look: "quote-classic", from: 0, to: 8, glyphs: { 0: "“" }, texts: [{ part: 1, label: "Quote", content: "Quote text goes here, two lines at most.", maxLength: 120, width: 86 }, { part: 2, label: "Author", content: "— Author", maxLength: 40 }] }],
    demo: ["hills-sunset.jpg"], coverAt: 3,
  },
  {
    id: "event-countdown", name: "Event countdown", category: "Other", canvas: [1920, 1080], tags: ["event", "countdown", "announcement"], themeColors: ["#1e6bff", "#ffffff"], background: "#2a1708",
    slots: [video(5), { accepts: "video", seconds: 5, required: false }],
    cuts: [{ type: "dip-to-black", seconds: 0.5 }],
    looks: [
      { look: "title-stack", from: 0, to: 5, colors: { 1: 0 }, texts: [{ part: 0, label: "Event", content: "Event name", maxLength: 30, size: 14 }] },
      { look: "lower-third-pill", from: 5, to: 10, texts: [{ label: "Date", content: "Saturday, 8 pm", maxLength: 30 }] },
      { look: "social-countdown", from: 7, to: 10, glyphs: { 0: "3", 1: "2", 2: "1" }, texts: [] },
    ],
    demo: ["bokeh-gold", "confetti-party"], coverAt: 2,
  },
];

/** Which text template, and which of its texts, each text element of a starter was built from. */
const LOOKS = new Map<string, { elementId: string; look: string; part: number }[]>();
const same = (a: unknown, b: string): boolean => typeof a === "string" && a.toLowerCase() === b.toLowerCase();

function build(spec: Spec): { manifest: TemplateManifest; snapshot: ProjectDocument } {
  const [width, height] = spec.canvas;
  const doc = createProjectDocument({ id: spec.id, mainSceneId: "scene", mainTrackId: "main", now_ms: 0, name: spec.name, canvasSize: { width, height }, fps: { numerator: 30, denominator: 1 } }) as unknown as Json;
  const scene = doc.scenes[0];
  doc.settings.background = { kind: "color", color: spec.background };
  let keys = 0;
  const newKey = () => `key-${++keys}`;

  // — Slots: on the main track one after another, or each in its own window on an overlay track. —
  const windows: Json[] = [];
  let at = 0;
  const slots = spec.slots.map((slot, position) => {
    const start = slot.window ? 0 : at;
    // A slot for images only is an image element from the start; any other becomes one when an image fills it.
    const element = createElement(slot.accepts === "image" ? "image" : "video", {
      id: `clip-${position + 1}`, name: slot.label || `Clip ${position + 1}`, startTime: start, duration: slot.seconds * SECOND,
      ...(slot.window ? { transform: { position: { x: Math.round((slot.window.x / 100) * width), y: Math.round((slot.window.y / 100) * height) }, scale: { x: slot.window.scale, y: slot.window.scale }, rotation: 0 } } : {}),
    }) as unknown as Json;
    delete element.mediaId;
    delete element.sourceDuration;
    if (slot.window) {
      const track = createTrack("video", { id: `track-window-${windows.length + 1}`, name: slot.label || "Video" }) as unknown as Json;
      track.elements.push(element);
      windows.unshift(track);
    } else {
      if (spec.grow) for (const path of ["transform.scale.x", "transform.scale.y"]) { writeKey(element, "", path, { time: 0, value: 1, segmentToNext: "linear" }, newKey); writeKey(element, "", path, { time: element.duration, value: spec.grow, segmentToNext: "linear" }, newKey); }
      scene.tracks.main.elements.push(element);
      at += slot.seconds * SECOND;
    }
    return { slotId: `slot-${position + 1}`, elementId: element.id as string, index: position + 1, accepts: slot.accepts, duration: slot.seconds * SECOND, required: slot.required, label: slot.label ?? "" };
  });
  const duration = Math.max(at, ...spec.slots.filter((slot) => slot.window).map((slot) => slot.seconds * SECOND));
  const main = scene.tracks.main.elements as Json[];
  for (const cut of spec.cuts ?? []) {
    for (let index = 1; index < main.length; index++) {
      if (cut.at && !cut.at.includes(index)) continue;
      const id = `cut-${index}`, from = main[index - 1], to = main[index];
      scene.tracks.main.transitions.push({ id, kind: "transition", fromElementId: from.id, toElementId: to.id, duration: Math.round(cut.seconds * SECOND), type: cut.type, params: cut.params ?? {}, easing: "ease-in-out", audioCrossfade: true, shape: "equal-power" });
      from.transitionOut = id;
      to.transitionIn = id;
    }
  }

  // — Texts and shapes: one overlay track per element that overlaps another in time; texts above shapes. —
  const above: Json[] = [], below: Json[] = [];
  const place = (type: "text" | "graphic", element: Json, under = false) => {
    const tracks = under ? below : above;
    const free = tracks.find((track) => track.type === type && track.elements.every((other: Json) => other.startTime + other.duration <= element.startTime || element.startTime + element.duration <= other.startTime));
    if (free) { free.elements.push(element); free.elements.sort((a: Json, b: Json) => a.startTime - b.startTime); return; }
    const track = createTrack(type, { id: `track-${under ? "under" : type}-${tracks.filter((entry) => entry.type === type).length + 1}`, name: type === "text" ? "Text" : "Shapes" }) as unknown as Json;
    track.elements.push(element);
    if (type === "text") tracks.unshift(track); else tracks.push(track);
  };
  const colorBindings: TemplateManifest["colorBindings"] = [];
  const editableTexts: TemplateManifest["editableTexts"] = [];
  const bindable: Json[] = [];
  let shapes = 0, texts = 0, glyphs = 0;
  const theme = (value: string | number): string => (typeof value === "number" ? spec.themeColors[value] : value);
  for (const shape of spec.shapes ?? []) {
    const element = createElement("graphic", {
      id: `shape-${++shapes}`, name: "Shape", startTime: shape.from * SECOND, duration: (shape.to - shape.from) * SECOND, definitionId: shape.definitionId,
      params: { fill: theme(shape.fill), ...(shape.stroke !== undefined ? { stroke: theme(shape.stroke), strokeWidth: 6 } : { strokeWidth: 0 }), ...(shape.cornerRadius ? { cornerRadius: shape.cornerRadius } : {}) },
      // A shape is 200 × 200 at scale 1.
      transform: { position: { x: Math.round((shape.x / 100) * width), y: Math.round((shape.y / 100) * height) }, scale: { x: Math.max(1, (shape.width / 100) * width) / 200, y: Math.max(1, (shape.height / 100) * height) / 200 }, rotation: 0 },
    }) as unknown as Json;
    place("graphic", element, shape.under);
    bindable.push(element);
  }
  const env = { newId: newKey } as CommandEnv;
  const looks: { elementId: string; look: string; part: number }[] = [];
  for (const use of spec.looks) {
    const look = TEXT_TEMPLATES.find((entry) => entry.id === use.look);
    if (!look) throw new Error(`${spec.id}: text template "${use.look}" does not exist`);
    const start = use.from * SECOND, end = use.to * SECOND, authoredEnd = start + look.duration * SECOND;
    const built = buildTextTemplate(doc as unknown as ProjectDocument, look, start, env) as unknown as Json[];
    let part = -1;
    built.forEach((element, member) => {
      delete element.groupId;
      // A member that lasted to the end of its template lasts to the end of this use; one with its own timing keeps it.
      if (element.startTime + element.duration === authoredEnd || element.startTime + element.duration > end) element.duration = end - element.startTime;
      if (element.duration <= 0) return;
      if (use.move) element.transform.position = { x: element.transform.position.x + Math.round((use.move[0] / 100) * width), y: element.transform.position.y + Math.round((use.move[1] / 100) * height) };
      const colour = use.colors?.[member];
      if (element.type !== "text") {
        element.id = `shape-${++shapes}`;
        if (colour !== undefined) element.params = { ...element.params, fill: spec.themeColors[colour] };
        place("graphic", element);
        bindable.push(element);
        return;
      }
      part++;
      const editable = use.texts.find((entry) => (entry.part ?? 0) === part), glyph = use.glyphs?.[part];
      if (!editable && glyph === undefined) return;
      if (colour !== undefined) element.color = spec.themeColors[colour];
      if (editable) {
        element.id = `text-${++texts}`;
        Object.assign(element, { name: editable.label, content: editable.content, ...(editable.size ? { fontSize: editable.size } : {}), ...(editable.width ? { box: { mode: "fixed", width: editable.width } } : {}) });
        if (editable.nudge) element.transform.position = { x: element.transform.position.x + Math.round((editable.nudge[0] / 100) * width), y: element.transform.position.y + Math.round((editable.nudge[1] / 100) * height) };
        editableTexts.push({ elementId: element.id, label: editable.label, maxLength: editable.maxLength });
      } else Object.assign(element, { id: `glyph-${++glyphs}`, name: "Design", content: glyph });
      looks.push({ elementId: element.id, look: use.look, part });
      place("text", element);
      bindable.push(element);
    });
  }
  // A theme colour is bound wherever a text fill, an outline, a bubble or a shape fill has exactly that value.
  for (const element of bindable) {
    for (const [field, value] of [["color", element.color], ["stroke.color", element.stroke?.enabled === false ? undefined : element.stroke?.color], ["bubble.color", element.bubble?.color], ["params.fill", element.params?.fill], ["params.stroke", element.params?.stroke]] as const) {
      const colorIndex = spec.themeColors.findIndex((entry) => same(value, entry));
      if (colorIndex >= 0) colorBindings.push({ colorIndex, elementId: element.id, field });
    }
  }
  const byElementId = new Map(bindable.map((element) => [element.id as string, element]));
  const variables = [
    ...editableTexts.map((entry) => ({ id: `text-${entry.elementId}`, label: entry.label, type: "text" as const, defaultValue: String(byElementId.get(entry.elementId)?.content ?? ""), maxLength: entry.maxLength, bindings: [{ elementId: entry.elementId, field: "content" }] })),
    ...spec.themeColors.map((value, colorIndex) => ({ id: `color-${colorIndex + 1}`, label: "Brand color {n}", type: "color" as const, defaultValue: value, bindings: colorBindings.filter((binding) => binding.colorIndex === colorIndex).map(({ elementId, field }) => ({ elementId, field })) })),
  ];
  LOOKS.set(spec.id, looks);
  scene.tracks.overlay = [...above, ...windows, ...below];
  doc.metadata.duration = duration;
  doc.settings.adoptCanvasFromFirstMedia = false;
  doc.settings.adoptFrameRateFromFirstMedia = false;
  // — Music: an audio track of its own, EMPTY here. The track the starter names (`starterMusic`) is fetched from the remote catalogue when a project is made from it (`placeStarterMusic`); without a connection the project keeps the empty track. —
  const audioSlots: TemplateManifest["audioSlots"] = [];
  (scene.tracks.audio as unknown as Json[]).push(createTrack("audio", { id: STARTER_MUSIC_TRACK, name: "Music" }) as unknown as Json);
  doc.template = { templateId: spec.id, locked: true, sceneId: scene.id, slots: slots.map((slot) => ({ ...slot, filled: false, framing: { zoom: 1, panX: 0, panY: 0 }, sourceOffset: 0 })), editableTexts, audioSlots, themeColors: spec.themeColors, colorBindings, variables: variables.map((variable) => ({ ...variable, value: variable.defaultValue })) };
  // Stored as every later change stores it (rounded numbers), so that filling a slot differs in that slot only.
  const snapshot = normalizeDocumentValues(projectDocumentSchema.parse(doc));
  const manifest = readTemplateManifest({
    id: spec.id, name: spec.name, category: spec.category, tags: spec.tags, canvas: { width, height }, frameRate: { numerator: 30, denominator: 1 }, duration,
    slots, editableTexts, audioSlots, themeColors: spec.themeColors, colorBindings, variables, thumbnail: "cover.jpg", preview: "preview.mp4",
    author: "JAgentChill", license: "CC0-1.0", sources: [], schemaVersion: snapshot.schemaVersion, packageVersion: TEMPLATE_PACKAGE_VERSION, created_ms: 0, appVersionMin: "0.0.0",
  });
  return { manifest, snapshot };
}

let built: { manifest: TemplateManifest; snapshot: ProjectDocument }[] | null = null;
/** The starter templates, built once. They are never renamed, deleted or exported. */
export function bundledTemplates(): readonly { manifest: TemplateManifest; snapshot: ProjectDocument }[] {
  built ??= SPECS.map(build);
  return built;
}
export const isBundledTemplate = (id: string): boolean => SPECS.some((spec) => spec.id === id);
/** What a starter's cover and preview are rendered with: its demo media in slot order, and the second its cover shows. */
export const bundledTemplateDemo = (id: string): { media: readonly string[]; coverAt: number } | undefined => { const spec = SPECS.find((entry) => entry.id === id); return spec ? { media: spec.demo, coverAt: spec.coverAt } : undefined; };
/** The bundled text template each text of a starter uses, and which text of that template it is (0 is its first). */
export const bundledTemplateLooks = (id: string): readonly { elementId: string; look: string; part: number }[] => { bundledTemplates(); return LOOKS.get(id) ?? []; };
