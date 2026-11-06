import { ContractError } from "../prompt-video/contracts.ts";
import { TICKS } from "../prompt-video/params.ts";
import { planWords, type UpperPlan } from "./upper-plan.ts";
import { accentValue, accentsOf, CAMERA_MOTIONS, CHARACTER_ROLES, GENDERS, LIMITS, LINE_KINDS, NARRATOR, SHOT_SIZES, panelTicks, styleText, type AssetKind, type Asset, type Breakdown, type Character, type Film, type Panel } from "./model.ts";

/**
 * The words the writing steps send and the checks of what comes back. A model's answer is never trusted: every field is
 * bounded, every reference must resolve, and the problems are listed so the step can ask for a correction.
 */
export const STORY_LENGTHS = [30, 60, 120, 180, 300, 600] as const;
/** The instruction the breakdown prompt ends with and every correction repeats: a real model must answer with one object. */
export const RULES = "Answer with ONE JSON object only and nothing else: no prose, no code fence.";
const json = (value: unknown): string => JSON.stringify(value, null, 1);
/** Languages written without spaces between words are sized in characters. */
const spaceless = (language: string): boolean => /^(ja|zh|th|lo|km|my)\b/i.test(language);
export function storyRange(language: string, seconds: number): { unit: "words" | "characters"; min: number; max: number } {
  const target = (spaceless(language) ? 400 : 250) * (seconds / 60);
  return { unit: spaceless(language) ? "characters" : "words", min: Math.floor(target * 0.8), max: Math.ceil(target * 1.2) };
}

export const PROMPTS = {
  story: (film: Pick<Film, "language">, idea: string, seconds: number, tone: string): string => {
    const range = storyRange(film.language, seconds);
    return [
      "[[jc-film:story]] You write the story of a short film as plain prose.",
      `Answer with the story only: between ${range.min} and ${range.max} ${range.unit}, in language ${film.language}, paragraphs separated by one empty line. No title, no Markdown heading, no list, no emphasis marks.`,
      tone.trim() ? `Tone: ${tone.trim().slice(0, 200)}` : "",
      `Idea: """${idea.trim()}"""`,
    ].filter(Boolean).join("\n");
  },
  /** `plan`: the limits the film was quoted by (`upperPlan` of its story) — stated to the writer, and enforced on the answer (`planProblems`). */
  breakdown: (film: Pick<Film, "language" | "sourceText" | "artStyle" | "artStyleText" | "title">, plan?: Pick<UpperPlan, "assets" | "panels" | "lines">): string => [
    "[[jc-film:breakdown]] You turn a story into the plan of a short film: who and what is in it, the storyboard panels, and the spoken lines.",
    `Language of names, descriptions and lines: ${film.language}. Look of the film: ${styleText(film) || "decide yourself"}.`,
    "Fields:",
    "logline (1 sentence); synopsis (2-4 sentences);",
    // The accent: one for the whole film (so the voices do not drift from line to line), and a person's own only where the story says so.
    ...(accentsOf(film.language).length ? [`accent — the ONE accent this film is told in, one of: ${accentsOf(film.language).map((entry) => entry.id).join(", ")}. Take it from the story (where it is set, where its people are from); when the story gives no sign, choose the one a listener of this story would expect and keep it for the whole film;`] : ["accent — the accent this film is told in, in one or two words, ONLY when the story itself says or shows it (where it is set, where its people are from); otherwise \"\";"]),
    `characters — 1-12 of {name, role (${CHARACTER_ROLES.join(", ")}), age, gender (${GENDERS.join(", ")}, so the right voice is cast), accent (${accentsOf(film.language).length ? `one of ${accentsOf(film.language).map((entry) => entry.id).join(", ")}, or ""` : `one or two words, or ""`} — ONLY when the story says this person speaks differently from the film's accent; otherwise ""), description (who they are), appearance (what they LOOK like, so that every picture shows the same person: face, hair, build, clothes)};`,
    "locations — 1-12 of {name, description, appearance (what the place looks like, with no people)};",
    "props — 0-12 of {name, description, appearance} — only objects the story depends on;",
    `clips — 1-20 of {title (what happens), panels}; panels — 1-12 per clip of {action (what the picture shows, no spoken words), duration_s (1-15), shotSize (${SHOT_SIZES.join(", ")}), cameraMotion (${CAMERA_MOTIONS.join(", ")}), characters (names), location (name or ""), props (names), videoPrompt (how the picture moves), lines};`,
    `lines — 0-4 per panel of {kind (${LINE_KINDS.join(", ")}), speaker (a character name, or "Narrator"), text (what is said, 1-${LIMITS.lineText} chars), emotion (one word or "")}.`,
    "Every name used by a panel or a line must be one of the characters, locations or props you listed.",
    "Stay inside the story: do not add events, people, places or facts it does not have, and do not change who did what to whom.",
    "Dialogue: every sentence the story puts between quotation marks is a line, with EXACTLY the story's words and the speaker the story gives it. Do not reword it, do not give it to someone else. Add a line of your own only where the story tells that someone spoke without quoting them; keep how the story's people address each other.",
    "A character is someone who speaks or acts; an animal or an object that only appears is a prop, not a character.",
    "Narration: the film must TELL the whole story to someone who only listens. Everything the story tells that is not quoted dialogue is carried by the Narrator, in the story's own sentences (shortened where needed, never contradicted), spread over the panels in the story's order — at least one narration line for every panel that has no dialogue. A film whose only lines are the quoted ones is not accepted.",
    ...(plan ? [planWords(plan)] : []),
    `Story: """${film.sourceText.trim()}"""`,
  ].join("\n"),
};

/** A story expansion is accepted when it is plain prose of the asked size. */
export function checkStory(textValue: string, language: string, seconds: number): string {
  const story = textValue.trim().replace(/\r\n/g, "\n"), range = storyRange(language, seconds), problems: string[] = [];
  const size = range.unit === "words" ? (story ? story.split(/\s+/).length : 0) : story.replace(/\s/g, "").length;
  if (size < range.min || size > range.max) problems.push(`the story has ${size} ${range.unit}; it must have between ${range.min} and ${range.max}`);
  if (/^\s{0,3}#{1,6}\s/m.test(story)) problems.push("remove the Markdown headings");
  if (/^\s*(?:[-*+]|\d+[.)])\s+/m.test(story)) problems.push("remove the list markers");
  if (/(\*\*|__)[^\s]|(^|\s)[*_][^\s*_][^*_\n]*[*_](\s|$)/m.test(story)) problems.push("remove the emphasis marks");
  if (problems.length) throw new ContractError("The story is not valid", problems);
  return story;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown, max: number): string => (typeof value === "string" ? value.trim().slice(0, max) : "");
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const key = (name: string): string => name.trim().toLowerCase();
const pick = <T extends string>(value: unknown, offered: readonly T[], fallback: T): T => { const wanted = typeof value === "string" ? value.trim().toLowerCase().replace(/[\s_]+/g, "-") : ""; return (offered as readonly string[]).includes(wanted) ? (wanted as T) : fallback; };

/** Drops the commas a model leaves before a closing brace or bracket, outside strings. */
function withoutTrailingCommas(text: string): string {
  let out = "", inString = false, escaped = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (inString) { out += char; if (escaped) escaped = false; else if (char === "\\") escaped = true; else if (char === '"') inString = false; continue; }
    if (char === '"') { inString = true; out += char; continue; }
    if (char === ",") { let after = index + 1; while (after < text.length && /\s/.test(text[after])) after++; if (text[after] === "}" || text[after] === "]") continue; }
    out += char;
  }
  return out;
}
/**
 * Every top-level balanced `{…}` of a text, left to right. Quotes and braces are tracked only once a candidate has
 * started: an inch mark or a stray quote in the prose around the object can never hide it.
 */
function balancedObjects(text: string): string[] {
  const found: string[] = [];
  let depth = 0, start = -1, inString = false, escaped = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (depth === 0) { if (char === "{") { start = index; depth = 1; inString = false; escaped = false; } continue; }
    if (inString) { if (escaped) escaped = false; else if (char === "\\") escaped = true; else if (char === '"') inString = false; continue; }
    if (char === '"') { inString = true; continue; }
    if (char === "{") { depth++; continue; }
    if (char === "}") { depth--; if (depth === 0 && start >= 0) { found.push(text.slice(start, index + 1)); start = -1; } }
  }
  return found;
}
/**
 * The JSON object of a model answer: the FIRST balanced `{…}` of the text in reading order, whether a real model wrapped
 * it in prose, a ```json fence, or both. Braces inside strings are ignored; trailing commas are tolerated; smart quotes
 * around keys are not repaired. The first `{…}` is never skipped: when it is not valid JSON that is a problem of the
 * answer the step sends back. Undefined only when the text holds no `{…}` at all.
 */
export function extractJson(text: string): unknown {
  const candidate = balancedObjects(text)[0];
  if (candidate === undefined) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(withoutTrailingCommas(candidate)); }
  catch (error) { throw new ContractError("The film plan is not valid", [`the first {…} of the answer is not valid JSON: ${(error as Error).message.slice(0, 160)}`]); }
  if (!isRecord(parsed)) throw new ContractError("The film plan is not valid", ["the answer is not a JSON object"]);
  return parsed;
}

/**
 * The model's breakdown as the film stores it. Ids are derived from position and name, so writing again from the same
 * story keeps the ids of what did not change (and with them the pictures and takes a person already has).
 */
export function normaliseBreakdown(raw: unknown, film: Pick<Film, "frameRate"> & { language?: string }): Breakdown {
  if (!isRecord(raw)) throw new ContractError("The film plan is not valid", ["the answer is not a JSON object"]);
  // An accent is kept only as the film's language offers it (a listed id, or short free words): anything else the writer put there is no accent.
  const language = film.language ?? "";
  const problems: string[] = [];
  const slug = (prefix: string, name: string): string => `${prefix}_${key(name).replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 40) || "x"}`;
  const named = <T extends { id: string; name: string }>(prefix: string, what: string, value: unknown, max: number, build: (entry: Record<string, unknown>, id: string, name: string) => T): T[] => {
    const out: T[] = [], seen = new Set<string>();
    for (const entry of list(value)) {
      if (!isRecord(entry)) continue;
      const name = str(entry.name, LIMITS.name);
      if (!name) { problems.push(`a ${what} has no name`); continue; }
      if (seen.has(key(name))) continue;
      seen.add(key(name));
      out.push(build(entry, slug(prefix, name), name));
    }
    if (out.length > max) problems.push(`at most ${max} ${what}s`);
    return out.slice(0, max);
  };
  const characters = named("ch", "character", raw.characters, 12, (entry, id, name): Pick<Character, "id" | "name" | "role" | "age" | "description" | "appearance" | "gender"> & { accent?: string } =>
    ({ id, name, role: pick(entry.role, CHARACTER_ROLES, "supporting"), age: str(entry.age ?? "", 40) || (typeof entry.age === "number" ? String(entry.age) : ""), gender: pick(entry.gender, GENDERS, "neutral"), ...((accent) => (accent ? { accent } : {}))(accentValue(language, entry.accent)), description: str(entry.description, LIMITS.text), appearance: str(entry.appearance, LIMITS.text) || str(entry.description, LIMITS.text) }));
  const locations = named("lo", "location", raw.locations, 12, (entry, id, name) => ({ id, name, description: str(entry.description, LIMITS.text), appearance: str(entry.appearance, LIMITS.text) || str(entry.description, LIMITS.text) }));
  const props = named("pr", "prop", raw.props, 12, (entry, id, name) => ({ id, name, description: str(entry.description, LIMITS.text), appearance: str(entry.appearance, LIMITS.text) || str(entry.description, LIMITS.text) }));
  if (!characters.length) problems.push("list at least one character");
  if (!locations.length) problems.push("list at least one location");
  const byName = (entries: { id: string; name: string }[]) => new Map(entries.map((entry) => [key(entry.name), entry.id]));
  const characterIds = byName(characters), locationIds = byName(locations), propIds = byName(props);
  const resolve = (names: unknown, ids: Map<string, string>, what: string, where: string): string[] => list(names).flatMap((name) => {
    if (typeof name !== "string" || !name.trim()) return [];
    const found = ids.get(key(name));
    if (!found) problems.push(`${where} names the ${what} "${name}", which is not in your list`);
    return found ? [found] : [];
  });

  const clips: Breakdown["clips"] = [], panels: Breakdown["panels"] = [], lines: Breakdown["lines"] = [];
  list(raw.clips).forEach((entry, clipIndex) => {
    if (!isRecord(entry)) return;
    const clipId = `cl_${clipIndex + 1}`, before = panels.length;
    list(entry.panels).forEach((value) => {
      if (!isRecord(value)) return;
      const where = `panel ${panels.length + 1}`, action = str(value.action, LIMITS.text);
      if (!action) { problems.push(`${where} has no action`); return; }
      const seconds = Number(value.duration_s), panelId = `pa_${panels.length + 1}`;
      const location = typeof value.location === "string" && value.location.trim() ? resolve([value.location], locationIds, "location", where)[0] ?? null : null;
      const panel: Omit<Panel, "picture"> = {
        id: panelId, clipId, duration_ticks: panelTicks(film, (Number.isFinite(seconds) && seconds > 0 ? seconds : 4) * TICKS), shotSize: pick(value.shotSize, SHOT_SIZES, "medium"), cameraMotion: pick(value.cameraMotion, CAMERA_MOTIONS, "static"), action,
        characterIds: [...new Set(resolve(value.characters, characterIds, "character", where))].slice(0, 8), locationId: location, propIds: [...new Set(resolve(value.props, propIds, "prop", where))].slice(0, 8), videoPrompt: str(value.videoPrompt, 2000),
      };
      panels.push(panel);
      for (const spoken of list(value.lines)) {
        if (!isRecord(spoken)) continue;
        const textValue = str(spoken.text, LIMITS.lineText);
        if (!textValue) continue;
        const speaker = str(spoken.speaker, LIMITS.name), kind = pick(spoken.kind, LINE_KINDS, "narration");
        const speakerId = !speaker || key(speaker) === NARRATOR ? NARRATOR : characterIds.get(key(speaker));
        if (!speakerId) { problems.push(`a line of ${where} is spoken by "${speaker}", who is not in your list of characters`); continue; }
        lines.push({ id: `li_${lines.length + 1}`, kind: speakerId === NARRATOR && kind === "dialogue" ? "narration" : kind, speakerId, text: textValue, panelId, emotion: str(spoken.emotion, 200).toLowerCase() });
      }
    });
    if (panels.length === before) { problems.push(`clip ${clipIndex + 1} has no panels`); return; }
    if (panels.length - before > LIMITS.panelsPerClip) problems.push(`clip ${clipIndex + 1} has more than ${LIMITS.panelsPerClip} panels`);
    clips.push({ id: clipId, title: str(entry.title, 200) || `Clip ${clipIndex + 1}` });
  });
  if (!clips.length) problems.push("list at least one clip with panels");
  if (panels.length > LIMITS.panels) problems.push(`at most ${LIMITS.panels} panels`);
  if (problems.length) throw new ContractError("The film plan is not valid", problems.slice(0, 12));
  const accent = accentValue(language, raw.accent);
  return { logline: str(raw.logline, 300), synopsis: str(raw.synopsis, LIMITS.description), ...(accent ? { accent } : {}), characters, locations, props, clips, panels, lines };
}

const SHEET: Record<AssetKind, string> = {
  character: "Character reference sheet: face close-up on the left, full-body front, side and back views on the right, plain background, even light.",
  location: "Location plate: the empty place with no people, wide view.",
  prop: "Prop sheet: the object alone, centred, plain background.",
};
/** A child is shown as a clothed portrait only: image providers refuse a turnaround sheet of a minor. */
const CHILD_SHEET = "Character portrait of a child in everyday clothes: head-and-shoulders on the left, waist-up on the right, plain background, even light.";
export const ASSET_ASPECT: Record<AssetKind, string> = { character: "16:9", location: "16:9", prop: "1:1" };
/** The picture request of an asset: its sheet, its own words and the look of the film. */
/** Who a person is to the eye, before what they wear: without the age a model draws every character as an adult. */
const person = (entry: { age?: string; gender?: string }): string => { const facts = [entry.age?.trim() ? (/^\d+$/.test(entry.age.trim()) ? `${entry.age.trim()} years old` : `age: ${entry.age.trim()}`) : "", entry.gender && entry.gender !== "neutral" ? entry.gender : ""].filter(Boolean).join(", "); return facts ? ` (${facts})` : ""; };
export const assetPrompt = (film: Pick<Film, "artStyle" | "artStyleText">, kind: AssetKind, asset: Pick<Asset, "name" | "appearance" | "description"> & { age?: string; gender?: string }): string =>
  [kind === "character" && Number.parseInt(/\d+/.exec(asset.age ?? "")?.[0] ?? "", 10) < 18 ? CHILD_SHEET : SHEET[kind], `${asset.name}${kind === "character" ? person(asset) : ""}: ${asset.appearance || asset.description || asset.name}.`, styleText(film) ? `Style: ${styleText(film)}.` : ""].filter(Boolean).join(" ").slice(0, 4000);
const SIZE_WORDS: Record<Panel["shotSize"], string> = { "extreme-wide": "extreme wide shot", wide: "wide shot", full: "full shot", medium: "medium shot", "medium-close": "medium close-up", "close-up": "close-up", "extreme-close-up": "extreme close-up", insert: "insert shot of a detail" };
/**
 * The picture request of a panel. Consistency: the appearance words of every character, the place and the props the
 * panel names are repeated in the request, so the same person looks the same in every panel.
 */
/**
 * The same frame in plain words, for a provider that refused the full request under its content policy: the story
 * moment and who is in it by age and role, without the detailed words about bodies and clothes that such filters
 * trip on (a real refusal: a child in a rain-soaked uniform bending over a box with a kitten in it).
 */
export function plainPanelPrompt(film: Pick<Film, "artStyle" | "artStyleText" | "characters" | "locations">, panel: Pick<Panel, "action" | "shotSize" | "characterIds" | "locationId">): string {
  const location = film.locations.find((entry) => entry.id === panel.locationId);
  const cast = panel.characterIds.map((id) => film.characters.find((entry) => entry.id === id)).filter((entry) => !!entry);
  return [
    "A wholesome still from a family film, everyone fully and ordinarily dressed.",
    `${SIZE_WORDS[panel.shotSize]}. ${panel.action}`,
    location ? `Place: ${location.name}.` : "",
    cast.length ? `In the frame: ${cast.map((entry) => `${entry.name}${person(entry)}`).join(", ")}.` : "",
    styleText(film) ? `Style: ${styleText(film)}.` : "", "No text, no captions, no watermark.",
  ].filter(Boolean).join(" ").slice(0, 3000);
}
export function panelPrompt(film: Pick<Film, "artStyle" | "artStyleText" | "characters" | "locations" | "props"> & Partial<Pick<Film, "synopsis" | "clips" | "panels">>, panel: Pick<Panel, "action" | "shotSize" | "characterIds" | "locationId" | "propIds"> & Partial<Pick<Panel, "id" | "clipId">>): string {
  // What the picture belongs to: a frame drawn from one sentence alone does not know the story it is in. The story in
  // short, the scene, and the frame just before it (same scene) are told first, so the frame continues them.
  const scene = panel.clipId ? film.clips?.find((entry) => entry.id === panel.clipId) : undefined;
  const inScene = panel.clipId && film.panels ? film.panels.filter((entry) => entry.clipId === panel.clipId) : [];
  const at = panel.id ? inScene.findIndex((entry) => entry.id === panel.id) : -1, before = at > 0 ? inScene[at - 1] : undefined;
  const context = [
    film.synopsis?.trim() ? `A frame of a film. The story: ${film.synopsis.trim().slice(0, 600)}` : "",
    scene?.title ? `This scene: ${scene.title}.` : "",
    before ? `The frame just before this one showed: ${before.action.slice(0, 300)} Keep the same place, light, weather and clothes; show the next moment.` : "",
  ].filter(Boolean).join(" ");
  const location = film.locations.find((entry) => entry.id === panel.locationId);
  const cast = panel.characterIds.map((id) => film.characters.find((entry) => entry.id === id)).filter((entry) => !!entry);
  const props = panel.propIds.map((id) => film.props.find((entry) => entry.id === id)).filter((entry) => !!entry);
  return [
    context,
    `Now draw: ${SIZE_WORDS[panel.shotSize]}. ${panel.action}`,
    location ? `Place — ${location.name}: ${location.appearance || location.description}.` : "",
    ...cast.map((entry) => `${entry.name}${person(entry)}: ${entry.appearance || entry.description}.`),
    ...props.map((entry) => `${entry.name}: ${entry.appearance || entry.description}.`),
    styleText(film) ? `Style: ${styleText(film)}.` : "", "No text, no captions, no watermark.",
  ].filter(Boolean).join(" ").slice(0, 6000);
}
/**
 * The reference pictures a panel is drawn WITH, in the order the request sends them, each with what it is: the current
 * sheet of every character and of the place, the frame just before it in the same scene (so the light, the weather
 * and the clothes continue), then the sheet of every prop. Most important first: a model takes only so many, and the
 * caller cuts the list from the end. Words alone do not keep a face the same; a picture does.
 */
export function panelReferenceList(film: Pick<Film, "characters" | "locations" | "props"> & Partial<Pick<Film, "panels">>, panel: Pick<Panel, "characterIds" | "locationId" | "propIds"> & Partial<Pick<Panel, "id" | "clipId">>): { blobId: string; what: string }[] {
  const out: { blobId: string; what: string }[] = [], add = (blobId: string | undefined, what: string): void => { if (blobId && !out.some((entry) => entry.blobId === blobId)) out.push({ blobId, what }); };
  // The people first, the leads before the others: when the list is cut, a lead's face is the last thing to go.
  const cast = panel.characterIds.map((id) => film.characters.find((found) => found.id === id)).filter((entry) => !!entry);
  for (const entry of [...cast.filter((found) => found.role === "lead"), ...cast.filter((found) => found.role !== "lead")]) add(entry.picture.current?.media.blobId, `the character ${entry.name}`);
  const place = film.locations.find((entry) => entry.id === panel.locationId);
  add(place?.picture.current?.media.blobId, `the place ${place?.name}, shown empty`);
  const inScene = panel.clipId && film.panels ? film.panels.filter((entry) => entry.clipId === panel.clipId) : [], at = panel.id ? inScene.findIndex((entry) => entry.id === panel.id) : -1;
  if (at > 0) add(inScene[at - 1].picture.current?.media.blobId, "the frame just before this one");
  for (const id of panel.propIds) { const entry = film.props.find((found) => found.id === id); add(entry?.picture.current?.media.blobId, `the object ${entry?.name}`); }
  return out;
}
/** The most reference pictures a panel's request carries, whatever the model says it takes (measured: from six up, a real model drew unrelated pictures). The generation service enforces the same number for every request. */
export const PANEL_REFERENCES_MAX = 5;
/** What a request that carries reference pictures says about them: which is which, and that they are the truth of how things look. */
export const referenceWords = (references: readonly { what: string }[]): string => (references.length
  ? `Reference pictures are attached, in this order: ${references.map((entry, index) => `${index + 1} — ${entry.what}`).join("; ")}. Draw every person, the place and every object EXACTLY as their reference shows them (same face, hair, build, clothes, colours); a reference sheet shows several views of one person — draw that person once. Draw a new picture: do not copy the layout of a reference.`
  : "");
/** The reference pictures a panel's request names: the current sheet of each asset it shows. */
export function panelReferences(film: Pick<Film, "characters" | "locations" | "props">, panel: Pick<Panel, "characterIds" | "locationId" | "propIds">): string[] {
  const found = [...panel.characterIds.map((id) => film.characters.find((entry) => entry.id === id)), film.locations.find((entry) => entry.id === panel.locationId), ...panel.propIds.map((id) => film.props.find((entry) => entry.id === id))];
  return found.flatMap((entry) => (entry?.picture.current ? [entry.picture.current.media.blobId] : []));
}
