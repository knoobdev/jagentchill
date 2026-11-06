// The golden cases. Each builds a small project in the page (through `window.jc`) and names the time to render.
// Cases are data: `build` is serialised and run in the browser, so it uses nothing but its argument.
export type GoldenCase = { id: string; group: string; time: number; build: string; args?: unknown };
import { EFFECT_DEFINITIONS, FILTER_DEFINITIONS, TRANSITION_DEFINITIONS } from "@jagentchill/editor-core";

const BLEND_MODES = ["normal", "darken", "multiply", "color-burn", "lighten", "screen", "plus-lighter", "color-dodge", "overlay", "soft-light", "hard-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"];
/** The transitions whose three cases are all main-track cases (their references predate the overlay rule); every other id has its 50 % case on an overlay pair. */
const MAIN_ONLY_TRANSITIONS = ["cross-dissolve", "dip-to-black", "dip-to-white", "dip-to-color", "additive-dissolve", "linear-wipe", "slide", "push", "iris-circle"];
export const GOLDEN_TRANSITIONS = TRANSITION_DEFINITIONS.map((definition) => definition.type);
export const GOLDEN_MASKS = ["rectangle", "ellipse", "diamond", "star", "heart"];
/** A freeform path: a rounded triangle, in fractions of the element's half size. */
const FREEFORM = [{ id: "p1", x: 0, y: -0.8, inX: -0.2, inY: 0, outX: 0.2, outY: 0 }, { id: "p2", x: 0.8, y: 0.7, inX: 0, inY: -0.3, outX: 0, outY: 0 }, { id: "p3", x: -0.8, y: 0.7, inX: 0, inY: 0, outX: 0, outY: -0.3 }];

// Shared page-side helpers, prepended to every case body.
const PRELUDE = `
  const { jc } = window;
  const W = 640, H = 360;
  const picture = (hue) => jc.imageUrl(320, 180, (c) => { const g = c.createLinearGradient(0, 0, 320, 180); g.addColorStop(0, "hsl(" + hue + ",85%,55%)"); g.addColorStop(1, "hsl(" + (hue + 150) + ",85%,30%)"); c.fillStyle = g; c.fillRect(0, 0, 320, 180); c.fillStyle = "#ffffff"; c.fillRect(20, 20, 60, 40); c.fillStyle = "#000000"; c.beginPath(); c.arc(240, 110, 40, 0, 7); c.fill(); });
  const sources = [{ assetId: "a", original: await picture(20) }, { assetId: "b", original: await picture(200) }];
  const base = (background) => { const doc = jc.project({ width: W, height: H }, background || { kind: "color", color: "#202428" }); for (const s of sources) doc.media.assets.push(jc.asset(s.assetId, "image", { width: 320, height: 180 })); return doc; };
  const image = (id, mediaId, fields) => jc.element("image", { id, startTime: 0, duration: 120000, mediaId, ...fields });
`;
const body = (code: string): string => `${PRELUDE}\n let derived = [];\n${code}\n return { doc, sources, derived };`;
// A person matte for the body effects: a white figure (ellipse) on black, the size of the picture.
const MATTE = `const matte = await jc.imageUrl(320, 180, (c) => { c.fillStyle = "#000000"; c.fillRect(0, 0, 320, 180); c.fillStyle = "#ffffff"; c.beginPath(); c.ellipse(160, 100, 60, 75, 0, 0, 7); c.fill(); }); derived = [{ key: "person-matte:a", kind: "person-matte", url: matte, sha256: "a".repeat(64) }];`;

export const GOLDEN_CASES: GoldenCase[] = [
  ...BLEND_MODES.map((mode): GoldenCase => ({
    id: `blend-${mode}`, group: "blend", time: 0, args: mode,
    build: body(`const doc = base(); doc.scenes[0].tracks.main.elements.push(image("m", "a")); const top = image("o", "b", { transform: { position: { x: 60, y: 30 }, scale: { x: 0.7, y: 0.7 }, rotation: 0 }, opacity: 0.85 }); top.blendMode = args; doc.scenes[0].tracks.overlay = [jc.track("video", "o0", [top])];`),
  })),
  ...GOLDEN_MASKS.flatMap((type): GoldenCase[] => [0, 24].map((feather) => ({
    id: `mask-${type}${feather ? "-feather" : ""}`, group: "mask", time: 0, args: { type, feather },
    build: body(`const doc = base(); doc.scenes[0].tracks.main.elements.push(image("m", "a", { masks: [{ id: "k", type: args.type, enabled: true, combine: "add", params: { width: 0.8, height: 0.6, feather: args.feather, rotation: 15 } }] }));`),
  }))),
  ...["subtract", "intersect", "exclude"].map((combine): GoldenCase => ({
    id: `mask-combine-${combine}`, group: "mask", time: 0, args: combine,
    build: body(`const doc = base(); doc.scenes[0].tracks.main.elements.push(image("m", "a", { masks: [{ id: "k1", type: "rectangle", enabled: true, combine: "add", params: { width: 0.9, height: 0.7 } }, { id: "k2", type: "ellipse", enabled: true, combine: args, params: { width: 0.6, height: 0.6, centerX: 0.3 } }] }));`),
  })),
  ...["split", "mirror", "cinematic-bars"].flatMap((type): GoldenCase[] => [0, 24].map((feather) => ({
    id: `mask-${type}${feather ? "-feather" : ""}`, group: "mask", time: 0, args: { type, feather },
    build: body(`const doc = base(); doc.scenes[0].tracks.main.elements.push(image("m", "a", { masks: [{ id: "k", type: args.type, enabled: true, combine: "add", params: { feather: args.feather, rotation: 15, centerY: 0.1 } }] }));`),
  }))),
  { id: "mask-text", group: "mask", time: 0, build: body(`const doc = base(); doc.scenes[0].tracks.main.elements.push(image("m", "a", { masks: [{ id: "k", type: "text", enabled: true, combine: "add", params: { content: "MASK", fontSize: 60, fontWeight: "bold" } }] }));`) },
  { id: "mask-freeform", group: "mask", time: 0, args: FREEFORM, build: body(`const doc = base(); doc.scenes[0].tracks.main.elements.push(image("m", "a", { masks: [{ id: "k", type: "freeform", enabled: true, combine: "add", params: { closed: true, path: args, feather: 8 } }] }));`) },
  ...GOLDEN_TRANSITIONS.flatMap((type): GoldenCase[] => [0.25, 0.5, 0.75].map((progress) => ({
    id: `transition-${type}-${progress * 100}`, group: "transition", time: 60000 + Math.round((progress * 120000) / 4000) * 4000, args: { type, overlay: progress === 0.5 && !MAIN_ONLY_TRANSITIONS.includes(type) },
    // The overlay case joins two half-size clips with transparent surroundings, above a main-track picture.
    build: body(`const doc = base(); const place = args.overlay ? { transform: { position: { x: -80, y: 30 }, scale: { x: 0.5, y: 0.5 }, rotation: 0 } } : {}; const pair = [image("A", "a", { transitionOut: "t", ...place }), jc.element("image", { id: "B", startTime: 120000, duration: 120000, mediaId: "b", transitionIn: "t", ...place })]; const record = { id: "t", kind: "transition", fromElementId: "A", toElementId: "B", duration: 120000, shape: "equal-power", type: args.type, params: args.type === "dip-to-color" ? { color: "#ff8800" } : {}, easing: "linear", audioCrossfade: true }; if (args.overlay) { doc.scenes[0].tracks.main.elements.push(jc.element("image", { id: "M", startTime: 0, duration: 240000, mediaId: "b", opacity: 0.5 })); const track = jc.track("video", "o0", pair); track.transitions = [record]; doc.scenes[0].tracks.overlay = [track]; } else { doc.scenes[0].tracks.main.elements.push(...pair); doc.scenes[0].tracks.main.transitions = [record]; }`),
  }))),
  // Every effect as a clip effect on a clip scaled to 60 % and rotated 20°, so that the effect frame is exercised …
  ...EFFECT_DEFINITIONS.filter((definition) => definition.type !== "blur").map((definition): GoldenCase => ({
    id: `effect-${definition.type}`, group: "effect", time: 40000, args: definition.type,
    build: body(`${definition.requires ? MATTE : ""} const doc = base(); doc.scenes[0].tracks.main.elements.push(image("m", "a", { transform: { position: { x: 0, y: 0 }, scale: { x: 0.6, y: 0.6 }, rotation: 20 }, effects: [{ id: "fx", type: args, kind: "effect", enabled: true, params: {} }] }));`),
  })),
  // … and, where it may be one, as a standalone effect element over the canvas.
  ...EFFECT_DEFINITIONS.filter((definition) => definition.layer && definition.type !== "blur").map((definition): GoldenCase => ({
    id: `effect-layer-${definition.type}`, group: "effect-layer", time: 40000, args: definition.type,
    build: body(`const doc = base(); doc.scenes[0].tracks.main.elements.push(image("m", "a")); doc.scenes[0].tracks.overlay = [jc.track("effect", "fx", [jc.element("effect", { id: "f", startTime: 0, duration: 120000, effects: [{ id: "e", type: args, kind: "effect", enabled: true, params: {} }] })])];`),
  })),
  ...FILTER_DEFINITIONS.map((definition): GoldenCase => ({
    id: `filter-${definition.type}`, group: "filter", time: 0, args: definition.type,
    build: body(`const doc = base(); doc.scenes[0].tracks.main.elements.push(image("m", "a", { effects: [{ id: "fx", type: args, kind: "filter", enabled: true, params: { intensity: 100 } }] }));`),
  })),
  { id: "color-basic", group: "color", time: 0, build: body(`const doc = base(); doc.scenes[0].tracks.main.elements.push(image("m", "a", { adjustments: { basic: { enabled: true, exposure: 20, contrast: 30, highlights: -40, shadows: 30, temperature: 40, tint: -20, saturation: 35, vibrance: 20, hue: 25, fade: 15, vignette: -60 } } }));`) },
  { id: "color-wheels", group: "color", time: 0, build: body(`const doc = base(); doc.scenes[0].tracks.main.elements.push(image("m", "a", { adjustments: { wheels: { enabled: true, shadows: { x: -0.3, y: -0.2, luminance: 10 }, midtones: { x: 0.1, y: 0.3, luminance: -5 }, highlights: { x: 0.4, y: 0.1, luminance: 5 } } } }));`) },
  { id: "color-curves-hsl", group: "color", time: 0, build: body(`const doc = base(); doc.scenes[0].tracks.main.elements.push(image("m", "b", { adjustments: { curves: { enabled: true, master: [{ x: 0, y: 0.05 }, { x: 0.4, y: 0.3 }, { x: 0.7, y: 0.8 }, { x: 1, y: 0.95 }], blue: [{ x: 0, y: 0 }, { x: 0.5, y: 0.6 }, { x: 1, y: 1 }] }, hsl: { enabled: true, blue: { hue: 40, saturation: 30, lightness: -10 }, aqua: { hue: -30, saturation: -50, lightness: 10 } } } }));`) },
  { id: "adjustment-layer-masked", group: "color", time: 0, build: body(`const doc = base(); doc.scenes[0].tracks.main.elements.push(image("m", "a")); doc.scenes[0].tracks.overlay = [jc.track("adjustment", "adj", [jc.element("adjustment", { id: "j", startTime: 0, duration: 120000, opacity: 0.8, adjustments: { basic: { enabled: true, saturation: -100, contrast: 20 } }, masks: [{ id: "k", type: "ellipse", enabled: true, combine: "add", params: { width: 1.2, height: 0.8, feather: 30 } }] })])];`) },
  { id: "transform-crop-rotate-flip", group: "node", time: 0, build: body(`const doc = base(); doc.scenes[0].tracks.main.elements.push(image("m", "a", { crop: { left: 0.2, top: 0.1, right: 0.05, bottom: 0 }, flip: { horizontal: true, vertical: false }, transform: { position: { x: -40, y: 20 }, scale: { x: 0.8, y: 0.8 }, rotation: 33 } }));`) },
  { id: "effect-blur", group: "effect", time: 0, build: body(`const doc = base(); doc.scenes[0].tracks.main.elements.push(image("m", "a", { effects: [{ id: "fx", type: "blur", kind: "effect", enabled: true, params: { intensity: 60 } }] }));`) },
  { id: "chroma-key", group: "key", time: 0, build: body(`const doc = base({ kind: "color", color: "#804020" }); const g = await jc.imageUrl(320, 180, (c) => { c.fillStyle = "#00ff00"; c.fillRect(0, 0, 320, 180); c.fillStyle = "#3355ff"; c.fillRect(100, 40, 120, 100); }); sources.push({ assetId: "g", original: g }); doc.media.assets.push(jc.asset("g", "image", { width: 320, height: 180 })); doc.scenes[0].tracks.main.elements.push(image("m", "g", { chromaKey: { enabled: true, color: "#00ff00", strength: 40, edge: 10, shadow: 0, spill: 50 } }));`) },
  { id: "background-gradient", group: "background", time: 0, build: body(`const doc = base({ kind: "gradient", css: "radial-gradient(circle at 30% 40%, #ffcc00 0, rgba(255,0,0,0) 400px), linear-gradient(135deg, #102040, #40a0c0)" });`) },
  { id: "background-per-clip-blur", group: "background", time: 0, build: body(`const doc = base(); doc.scenes[0].tracks.main.elements.push(image("m", "a", { background: { kind: "blur", blurIntensity: 200 }, transform: { position: { x: 0, y: 0 }, scale: { x: 0.5, y: 0.5 }, rotation: 0 } }));`) },
  { id: "graphic-shapes", group: "node", time: 0, build: body(`const doc = base(); const shape = (id, definitionId, x, params) => jc.element("graphic", { id, startTime: 0, duration: 120000, definitionId, params, transform: { position: { x, y: 0 }, scale: { x: 0.6, y: 0.6 }, rotation: 0 } }); doc.scenes[0].tracks.overlay = [jc.track("graphic", "g", [shape("r", "rectangle", -200, { fill: "#ff3355", stroke: "#ffffff", strokeWidth: 8, strokeAlign: "center", cornerRadius: 20 }), shape("e", "ellipse", 0, { fill: "#33cc88", stroke: "#000000", strokeWidth: 0, strokeAlign: "center" }), shape("s", "star", 200, { fill: "#ffd400", stroke: "#000000", strokeWidth: 4, strokeAlign: "inside", points: 5, depth: 50 })])];`) },
  { id: "compound-nesting", group: "node", time: 0, build: body(`const doc = base(); doc.scenes[0].tracks.main.elements.push(image("m", "a")); const inner = JSON.parse(JSON.stringify(doc.scenes[0])); inner.id = "s2"; inner.isMain = false; inner.kind = "compound"; inner.tracks.main.elements = [image("i", "b", { transform: { position: { x: 100, y: 50 }, scale: { x: 0.5, y: 0.5 }, rotation: -10 } })]; doc.scenes.push(inner); doc.scenes[0].tracks.overlay = [jc.track("video", "o0", [jc.element("compound", { id: "c", startTime: 0, duration: 120000, sceneId: "s2", sourceDuration: 120000, opacity: 0.8, transform: { position: { x: -60, y: -30 }, scale: { x: 0.9, y: 0.9 }, rotation: 5 } })])];`) },
  { id: "scene-effect-blur-masked", group: "effect", time: 0, build: body(`const doc = base(); doc.scenes[0].tracks.main.elements.push(image("m", "a")); doc.scenes[0].tracks.overlay = [jc.track("effect", "fx", [jc.element("effect", { id: "f", startTime: 0, duration: 120000, effects: [{ id: "e", type: "blur", kind: "effect", enabled: true, params: { intensity: 80 } }] })])];`) },
  { id: "keyframes-middle", group: "animation", time: 60000, build: body(`const doc = base(); const key = (id, time, value) => ({ id, time, value, segmentToNext: "bezier", tangentMode: "auto" }); doc.scenes[0].tracks.main.elements.push(image("m", "a", { animations: { "transform.rotation": { keys: [key("a", 0, 0), key("b", 120000, 120)] }, "transform.scale.x": { keys: [key("c", 0, 0.3), key("d", 120000, 1)] }, "transform.scale.y": { keys: [key("e", 0, 0.3), key("f", 120000, 1)] }, opacity: { keys: [key("g", 0, 0.2), key("h", 120000, 1)] } } }));`) },
  { id: "text-stroke-shadow-glow", group: "text", time: 0, build: body(`const doc = base(); doc.scenes[0].tracks.main.elements.push(image("m", "a")); const t = (id, y, fields) => jc.element("text", { id, startTime: 0, duration: 120000, content: "Golden Frame 123", fontFamily: "Arial", fontSize: 12, color: "#ffffff", transform: { position: { x: 0, y }, scale: { x: 1, y: 1 }, rotation: 0 }, ...fields }); doc.scenes[0].tracks.overlay = [jc.track("text", "t", [t("t1", -110, { stroke: { enabled: true, color: "#000000", width: 8, position: "outside" } }), t("t2", 0, { fontWeight: 700, shadow: { enabled: true, color: "#000000", opacity: 80, blur: 10, distance: 8, angle: -45 } }), t("t3", 110, { glow: { enabled: true, color: "#00e0ff", intensity: 80, radius: 25 }, background: { enabled: true, color: "#00000080", cornerRadius: 40, paddingX: 20, paddingY: 12, offsetX: 0, offsetY: 0 } })])];`) },
  { id: "caption-word-states", group: "text", time: 60000, build: body(`const doc = base(); doc.scenes[0].tracks.main.elements.push(image("m", "b")); doc.scenes[0].tracks.overlay = [jc.track("caption", "c", [jc.element("caption", { id: "c1", startTime: 0, duration: 120000, text: "every word has a state", words: [{ text: "every", start: 0, end: 24000 }, { text: "word", start: 24000, end: 48000 }, { text: "has", start: 48000, end: 72000 }, { text: "a", start: 72000, end: 84000 }, { text: "state", start: 84000, end: 120000 }] })], { caption: { style: { fontFamily: "sans-serif", fontSize: 7 }, highlight: { style: "background", color: "#ffd400", textColor: "#000000", scale: 1.2 } } })];`) },
];
