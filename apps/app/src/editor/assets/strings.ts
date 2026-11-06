/**
 * The wording the content catalogues and operations of the engine give the editor — preset, style and shape names,
 * fade shapes, weights, licence states and refusals. The engine speaks English; the screens translate these when they
 * show them, so each one is listed here for the locale resources.
 */
const CONTENT_STRINGS = {
  presetGroups: ["Basic", "Outline", "Shadow", "Neon", "Gradient"],
  presets: ["Plain white", "Plain black", "Soft shadow", "Hard shadow", "Yellow pop", "Red alert", "Ink", "Paper", "Black outline", "White outline", "Thick outline", "Blue outline", "Pink outline", "Green outline", "Hollow white", "Hollow yellow",
    "Long drop", "Blue drop", "Pink drop", "Lifted", "Retro duo", "Comic", "Emboss", "Night", "Neon pink", "Neon blue", "Neon green", "Neon yellow", "Neon purple", "Neon red", "Neon tube", "White halo", "Sunset", "Ocean", "Candy", "Lime", "Gold",
    "Silver", "Fire", "Aurora"],
  weights: ["Thin", "Extra light", "Light", "Regular", "Medium", "Semi bold", "Bold", "Extra bold", "Black"],
  fonts: ["No fonts found", "No favourites yet — star a font to keep it here", "No recent fonts"],
  bubbleGroups: ["Speech", "Thought", "Shout", "Label", "Banner", "Tag", "Frame"],
  bubbles: ["Speech, tail left", "Speech, tail right", "Oval speech, tail left", "Oval speech, tail right", "Square speech", "Thought cloud", "Thought oval", "Burst", "Jagged shout", "Rectangle label", "Rounded label", "Pill label", "Ribbon", "Folded banner",
    "Arrow banner", "Tag with hole", "Cut-corner tag", "Thin frame", "Brackets (stroke only)", "Underline bar"],
  textAnimations: ["Blink", "Blur", "Bounce", "Breathe", "Drop", "Fade", "Flicker", "Float", "Glitch", "Heartbeat", "Jitter", "Pop", "Pulse", "Rainbow", "Rise", "Scroll", "Shake", "Slide down", "Slide left", "Slide right", "Slide up", "Spin", "Stretch",
    "Swing", "Typewriter", "Wave", "Wipe left", "Wipe right", "Wobble", "Zoom in", "Zoom out"],
  templateCategories: ["Titles", "Lower thirds", "Subtitles", "Social", "Quotes", "Callouts"],
  templates: ["Clean title", "Bold outline", "Stacked title", "Neon sign", "Cinematic", "Typed title", "Name bar", "Accent line", "Boxed name", "Pill tag", "Two-tone", "Minimal", "Plain subtitle", "Boxed subtitle", "Yellow subtitle", "Speaker subtitle",
    "Follow prompt", "Handle tag", "Countdown", "Swipe hint", "New badge", "Classic quote", "Quote card", "Bold statement", "Speech quote", "Arrow label", "Circle highlight", "Price tag", "Step number", "Warning banner"],
  emojiGroups: ["Smileys and emotion", "People and body", "Animals and nature", "Food and drink", "Travel and places", "Activities", "Objects", "Symbols"],
  contentSteps: ["Curve", "Bubble", "Text animation", "Caption layout", "Caption style", "Normalise loudness", "Compressor", "Voice", "Sticker loop", "Sticker speed", "Add sticker", "Draw", "Move beat", "Head size", "Shaft width", "Dash"],
  textSteps: ["Font", "Font weight", "Italic", "Underline", "Strikethrough", "Font size", "Case", "Alignment", "Letter spacing", "Line height", "Text box", "Fill", "Fill colour", "Gradient colour", "Stroke", "Stroke colour", "Shadow colour", "Glow",
    "Glow colour", "Background", "Background colour", "Background padding", "Background offset", "Text effect", "Paste style", "Apply to all text", "Add text", "Bubble", "Text animation", "Add text template", "Apply text template",
    "Name must be 1–60 characters", "A preset with this name already exists", "Preset limit reached (200)", "This text effect is not available", "This template is not available"],
  fades: ["Linear", "Equal-power", "S-curve", "Logarithmic", "Exponential"],
  audioSteps: ["Volume", "Pan", "Fade in", "Fade out", "Add beat", "Delete beat", "Clear beats", "Equaliser", "Ducking", "Recover audio", "Beat marker limit reached (2000)", "No beat marker under the playhead"],
  licences: ["CC0", "CC BY", "CC BY-NC", "Generated", "Your file — licence not known to JAgentChill", "Your file — credit required by its source", "Not for commercial use", "Attribution required"],
  shapes: ["Rectangle", "Ellipse", "Polygon", "Star", "Line", "Arrow", "Add shape", "Shape"],
  captionStyles: ["Classic", "Classic yellow", "Boxed", "Boxed light", "Shadowed", "Film", "Terminal", "Word pop yellow", "Word pop green", "Word box pink", "Word box blue", "Word box yellow", "Punch", "Underline", "Karaoke blue", "Karaoke pink",
    "Lyrics", "Reveal", "Big word", "Neon night", "Soft pill", "Dark pill", "News bar", "Minimal"],
  captions: ["Subtitle files can be up to 10 MB", "Not a valid WebVTT file", "Subtitle files can be SRT, VTT, ASS or SSA", "No captions found in this file", "{n} skipped", "{n} trimmed", "Import captions", "Add caption", "Edit caption", "Split caption",
    "Merge captions", "Caption timing", "Caption style", "Word highlight", "Captions", "No room for a caption here", "The caret is not inside the caption text", "The caption is too short to split", "There is no caption before this one"],
};
/** Every content string of the engine the editor shows. */
export const contentStrings = (): string[] => Object.values(CONTENT_STRINGS).flat();
/** Strings a screen picks at run time (a count, a state, a row of a helper): named here so that the locale resources carry them. */
export const runtimeStrings = (t: (text: string) => string): string[] => [
  t("1 caption imported"), t("{n} captions imported"), t("{n} skipped"), t("{n} trimmed"), t("Add {name} to favourites"), t("Remove {name} from favourites"), t("Pause {name}"), t("Play {name}"), t("Credits copied"), t("Couldn't copy the credits"),
  t("Connect to a host to use this tool"), t("No provider is configured for speech"), t("Start"), t("End"), t("Colour"), t("To"), t("Angle"), t("Width"), t("Opacity"), t("Blur"), t("Distance"), t("Intensity"), t("Radius"), t("X"), t("Y"), t("W"),
  t("Fade in"), t("Fade out"), t("CC0"), t("CC BY"), t("CC BY-NC"), t("No fonts found"), t("No sounds found for \"{query}\""), t("No audio in this project yet"),
];
