import type { MediaFile } from "../prompt-video/contracts.ts";
import { ASPECT_RATIOS, TICKS, type AspectRatio } from "../prompt-video/params.ts";

/**
 * A film of Film Studio: one story, its cast, places and props with their reference pictures, the storyboard panels
 * grouped in clips, the voice lines with their takes, and the editor project it was assembled into. One document per
 * film, changed only through `applyOps`, so the host, a pipeline step and a person editing a screen share one path.
 */
export const FILM_FORMAT = "jagentchill.film";
/** The single episode of a film (episode splitting is not built: the id is fixed so routes stay stable when it is). */
export const EPISODE_ID = "e1";
export const STAGES = ["story", "assets", "storyboard", "voice", "timeline"] as const;
export type StageId = (typeof STAGES)[number];
export const FILM_ASPECT_RATIOS = ASPECT_RATIOS;
export const ART_STYLES = [
  { id: "cinematic-realistic", label: "Cinematic realistic", descriptor: "cinematic, photorealistic, natural light, shallow depth of field" },
  { id: "anime", label: "Anime", descriptor: "anime illustration, clean line art, cel shading" },
  { id: "comic", label: "Comic", descriptor: "comic book art, bold ink outlines, flat colours" },
  { id: "watercolour", label: "Watercolour storybook", descriptor: "watercolour storybook illustration, soft washes, visible paper texture" },
  { id: "3d-animation", label: "3D animation", descriptor: "3D animated film still, soft global illumination, stylised characters" },
  { id: "custom", label: "Custom", descriptor: "" },
] as const;
export type ArtStyle = (typeof ART_STYLES)[number]["id"];
export const FRAME_RATES = [24, 25, 30] as const;
export const SHOT_SIZES = ["extreme-wide", "wide", "full", "medium", "medium-close", "close-up", "extreme-close-up", "insert"] as const;
export type ShotSize = (typeof SHOT_SIZES)[number];
export const CAMERA_MOTIONS = ["static", "pan-left", "pan-right", "tilt-up", "tilt-down", "push-in", "pull-out", "track", "orbit", "handheld"] as const;
export type CameraMotion = (typeof CAMERA_MOTIONS)[number];
export const LINE_KINDS = ["dialogue", "inner", "narration"] as const;
export type LineKind = (typeof LINE_KINDS)[number];
export const EMOTIONS = ["", "calm", "warm", "tender", "hopeful", "earnest", "startled", "joyful", "sad", "angry", "fearful"] as const;
export const CHARACTER_ROLES = ["lead", "supporting", "extra"] as const;
/** The voice a character is cast to: a gender the speech voices are also tagged with, or "neutral" when unknown. */
export const GENDERS = ["female", "male", "neutral"] as const;
export type Gender = (typeof GENDERS)[number];
export const ASSET_KINDS = ["character", "location", "prop"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];
/**
 * How a voice may be asked to speak, by the film's language: the regional accents a story's people have. Vietnamese
 * has the three the owner named (a film's lines drifted between North and South when nothing was asked); for every
 * other language the accent is the person's own words ("British", "Kansai"), passed on as they are. `say`: what the
 * voice model is told — in the way its provider documents delivery instructions, never inside the text it reads aloud.
 */
export const ACCENTS: Record<string, readonly { id: string; label: string; say: string }[]> = {
  vi: [
    { id: "northern", label: "Northern", say: "Speak Vietnamese with a Northern (Hà Nội) accent." },
    { id: "central", label: "Central", say: "Speak Vietnamese with a Central (Huế) accent." },
    { id: "southern", label: "Southern", say: "Speak Vietnamese with a Southern (Sài Gòn) accent." },
  ],
};
export const ACCENT_MAX = 60;
const languageOf = (language: string): string => language.toLowerCase().split(/[-_]/)[0];
/** The accents offered for a language as a closed list; empty: the accent is free words. */
export const accentsOf = (language: string): readonly { id: string; label: string; say: string }[] => ACCENTS[languageOf(language)] ?? [];
/** An accent as a film may hold it for its language: one of the listed ids, or (a language without a list) short free words; anything else is none. */
export const accentValue = (language: string, value: unknown): string => {
  const listed = accentsOf(language), said = typeof value === "string" ? value.trim() : "";
  if (!said) return "";
  if (listed.length) { const wanted = said.toLowerCase(); return listed.find((entry) => entry.id === wanted || entry.label.toLowerCase() === wanted)?.id ?? ""; }
  return said.replace(/[\r\n]+/g, " ").slice(0, ACCENT_MAX);
};
/** The accent a speaker's lines are asked in: their own, else the film's one default; "" when neither is set (the voice model then decides by itself, line by line). */
export const accentOf = (film: Pick<Film, "characters" | "accent">, speakerId: string): string => (speakerId === NARRATOR ? "" : film.characters.find((entry) => entry.id === speakerId)?.accent ?? "") || film.accent || "";
/** What the voice model is told for an accent. */
export const accentWords = (language: string, accent: string): string => (!accent ? "" : accentsOf(language).find((entry) => entry.id === accent)?.say ?? `Speak with this accent: ${accent}.`);
/** A person's own recording a character's voice is taken from. */
export type VoiceSample = { blobId: string; name: string; bytes: number; mime: string; duration_ticks?: number; /** What the recording says, when the person wrote it down. */ text?: string; added_ms: number };
export const VOICE_SAMPLE_LIMITS = { /** The provider's documented limit of one inline reference: 15 MiB of decoded media. */ maxBytes: 15 * 1024 * 1024, /** …and of its transcript. */ maxText: 10_000 } as const;
/** The clip a frame's picture was animated into: a video that starts from THAT picture (`pictureId`). */
export type PanelClip = Version & { pictureId: string; duration_ticks: number; /** This motion no longer matches the Camera or Video prompt of its shot. */ stale?: boolean };
/** The clip that is the frame's motion NOW: only while the picture it was started from is still the one in use and not outdated. */
export const clipOf = (panel: Pick<Panel, "clip" | "picture">): PanelClip | null => (panel.clip && panel.clip.stale !== true && panel.picture.current && !panel.picture.stale && panel.clip.pictureId === panel.picture.current.id ? panel.clip : null);
export const MUSIC_MOODS = ["none", "calm", "upbeat", "dramatic", "playful", "dark", "epic", "romantic"] as const;
export const NARRATOR = "narrator";
export const LIMITS = {
  title: 120, description: 2000, sourceText: 60_000, artStyleText: 500, name: 80, text: 1200, lineText: 600, panels: 600, panelsPerClip: 40, clips: 100, lines: 1000, assets: 100, takes: 10, candidates: 4,
  panelMin_ticks: TICKS, panelMax_ticks: 15 * TICKS, panelDefault_ticks: 4 * TICKS,
} as const;

/** One generated file as the film keeps it: the blob, what it cost and the words it was made from. */
export type Version = { id: string; media: MediaFile; costUsd: number; prompt: string; created_ms: number; /** What a model that can see said about this picture: is it the frame that was asked (absent when nobody could look, and on pictures made before the check existed). */ check?: import("./picture-check.ts").PictureCheck; /** Which drawing of its request this is (1 = the first; more = earlier drawings failed the picture check). */ drawing?: number };
/** A picture that could not be had, kept in the film so it is still known after a restart: the provider refused to draw it, or (a panel) every drawing failed the picture check. */
export type Refusal = { message: string; at_ms: number; /** `picture`: drawn, but not the frame — its last drawing is among the candidates. Absent or `policy`: the provider refused to draw. */ reason?: "policy" | "picture" };
/** A picture slot: the one in use, the candidates offered beside it, and whether what it shows was edited since. */
export type Picture = { current: Version | null; candidates: Version[]; stale: boolean };
export type Character = { id: string; name: string; role: (typeof CHARACTER_ROLES)[number]; age: string; description: string; appearance: string; gender: Gender; voiceId: string; /** True while `voiceId` came from automatic casting; a person's own pick sets it false. */ voiceAuto: boolean; /** How this person speaks (`ACCENTS`, or free words); absent or "": the film's default. */ accent?: string; /** True while `accent` came from the script; a person's own choice sets it false. */ accentAuto?: boolean; /** A recording of a person's own: this character speaks in ITS voice where the voice model takes a sample. */ voiceSample?: VoiceSample; confirmed: boolean; picture: Picture; /** The provider refused to draw the sheet. Gone once the words change or a picture arrives. */ refused?: Refusal };
export type Location = { id: string; name: string; description: string; appearance: string; picture: Picture; refused?: Refusal };
export type Prop = { id: string; name: string; description: string; appearance: string; picture: Picture; refused?: Refusal };
export type Asset = Character | Location | Prop;
export type Clip = { id: string; title: string };
export type Panel = {
  id: string; clipId: string; duration_ticks: number; shotSize: ShotSize; cameraMotion: CameraMotion; action: string; characterIds: string[]; locationId: string | null; propIds: string[];
  /** How the still moves while it is on screen, in words. */
  videoPrompt: string; picture: Picture;
  /** This frame could not be had — the image provider refused to draw it, also in plainer words, or every drawing failed the picture check: it waits for a person (new words, a candidate chosen, or `leftOut`). Gone once the words change or a picture arrives. */
  refused?: Refusal;
  /** A person decided the film goes on without this frame: it is not drawn and not placed on the timeline. Gone once the words change or a picture arrives. */
  leftOut?: boolean;
  /** The frame's picture set in motion by a video model (see `clipOf`: it counts only for the picture it was started from). */
  clip?: PanelClip;
  /** A person decided this shot stays a still: no clip is made for it. */
  still?: boolean;
};
export type Take = { id: string; media: MediaFile; costUsd: number; duration_ticks: number; stale: boolean; voiceId: string; created_ms: number; /** The accent this take was ASKED in ("" or absent: none). Nobody measures an accent here: the read-back check compares words, so an accent is never reported as verified. */ accent?: string; /** The take was spoken in the voice of the speaker's sample (its blob id). */ voiceSampleId?: string; /** What a listener heard in this take and whether it is the line (absent on takes made before the check existed). */ check?: import("./speech-check.ts").SpeechCheck; /** Nobody listened to this take (and its length is plausible): it has NO verdict — it is neither checked nor failed. Never set together with `check`. */ unchecked?: import("./speech-check.ts").Unchecked };
export type Line = { id: string; kind: LineKind; speakerId: string; text: string; panelId: string | null; emotion: string; intensity: number; rate: number; takes: Take[]; activeTakeId: string | null };
export type FilmProject = { projectId: string; name: string; assembled_ms: number; hash: string; clips: number; voiceElements: number; captionCues: number; musicElements: number; duration_ticks: number };
export type Film = {
  format: typeof FILM_FORMAT; schemaVersion: 1; id: string; revision: number; title: string; description: string; aspectRatio: AspectRatio; artStyle: ArtStyle; artStyleText: string; language: string;
  frameRate: (typeof FRAME_RATES)[number]; sourceText: string; logline: string; synopsis: string;
  characters: Character[]; locations: Location[]; props: Prop[]; clips: Clip[]; panels: Panel[]; lines: Line[];
  narratorVoiceId: string; /** True while `narratorVoiceId` came from automatic casting. */ narratorVoiceAuto: boolean; /** The film's ONE default accent: every speaker without an accent of their own, and the narrator, is asked to speak in it. "" or absent: none. */ accent?: string; /** True while `accent` came from the script. */ accentAuto?: boolean; captions: boolean; music: { mood: (typeof MUSIC_MOODS)[number]; current: Version | null };
  /** Stages whose input changed after they were made (the purple dot of the tab strip). */
  stale: StageId[];
  /** No longer read (2026-10-08: nothing is asked per action; what a connected provider is sent is told where it is connected). Kept so films and screens that wrote it stay valid. */
  sendAllowed?: string[];
  /** The story was edited after the script was made from it: everything made from the script is outdated until it is written again. */
  scriptStale?: boolean; project: FilmProject | null; pipelineRunId: string | null; spentUsd: number; created_ms: number; updated_ms: number; opened_ms: number;
};

export class FilmError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;
  constructor(code: string, message: string, details: Record<string, unknown> = {}) { super(message); this.name = "FilmError"; this.code = code; this.details = details; }
}
const invalid = (message: string, details: Record<string, unknown> = {}): never => { throw new FilmError("INVALID_PARAMS", message, details); };
const missing = (what: string, id: string): never => { throw new FilmError("NOT_FOUND", `This ${what} is no longer in the film.`, { id }); };

export const emptyPicture = (): Picture => ({ current: null, candidates: [], stale: false });
export type CreateInput = { id: string; now_ms: number; title: string; sourceText?: string; aspectRatio?: AspectRatio; artStyle?: ArtStyle; artStyleText?: string; language?: string };
/** A film with the defaults of the spec: 16:9, cinematic realistic, 24 fps, voice and captions on. */
export function createFilm(input: CreateInput): Film {
  const film: Film = {
    format: FILM_FORMAT, schemaVersion: 1, id: input.id, revision: 1, title: "", description: "", aspectRatio: input.aspectRatio ?? "16:9", artStyle: input.artStyle ?? "cinematic-realistic", artStyleText: input.artStyleText ?? "",
    language: input.language ?? "en", frameRate: 24, sourceText: "", logline: "", synopsis: "", characters: [], locations: [], props: [], clips: [], panels: [], lines: [], narratorVoiceId: "", narratorVoiceAuto: false, captions: true,
    music: { mood: "calm", current: null }, stale: [], project: null, pipelineRunId: null, spentUsd: 0, created_ms: input.now_ms, updated_ms: input.now_ms, opened_ms: input.now_ms,
  };
  return applyOps(film, [{ op: "film.set", fields: { title: input.title, sourceText: input.sourceText ?? "" } }], { now_ms: input.now_ms, newId: () => "" }, false);
}

type AssetFields = Partial<Pick<Character, "name" | "role" | "age" | "description" | "appearance" | "gender" | "voiceId" | "voiceAuto" | "confirmed" | "accent">>;
type PanelFields = Partial<Pick<Panel, "duration_ticks" | "shotSize" | "cameraMotion" | "action" | "characterIds" | "locationId" | "propIds" | "videoPrompt">>;
type LineFields = Partial<Pick<Line, "kind" | "speakerId" | "text" | "panelId" | "emotion" | "intensity" | "rate">>;
export type FilmFields = Partial<Pick<Film, "title" | "description" | "aspectRatio" | "artStyle" | "artStyleText" | "language" | "frameRate" | "sourceText" | "logline" | "synopsis" | "narratorVoiceId" | "narratorVoiceAuto" | "captions" | "accent">> & { musicMood?: Film["music"]["mood"] };
export type FilmOp =
  | { op: "film.set"; fields: FilmFields }
  | { op: "asset.add"; kind: AssetKind; id?: string; fields: AssetFields }
  | { op: "asset.update"; kind: AssetKind; id: string; fields: AssetFields }
  | { op: "asset.remove"; kind: AssetKind; id: string }
  | { op: "asset.picture"; kind: AssetKind; id: string; version: Version }
  | { op: "asset.use"; kind: AssetKind; id: string; versionId: string }
  | { op: "asset.dismiss"; kind: AssetKind; id: string }
  | { op: "clip.add"; id?: string; title: string }
  | { op: "clip.update"; id: string; title: string }
  | { op: "clip.remove"; id: string }
  | { op: "panel.add"; id?: string; clipId: string; afterId?: string; fields?: PanelFields }
  | { op: "panel.update"; id: string; fields: PanelFields }
  | { op: "panel.remove"; id: string }
  | { op: "panel.move"; id: string; clipId: string; index: number }
  | { op: "panel.picture"; id: string; version: Version }
  | { op: "panel.use"; id: string; versionId: string }
  | { op: "panel.dismiss"; id: string }
  | { op: "panel.refused"; id: string; message: string; reason?: "policy" | "picture" }
  /** A drawing kept beside the frame without being used: one that failed the picture check, for a person to see. */
  | { op: "panel.candidate"; id: string; version: Version }
  | { op: "asset.refused"; kind: AssetKind; id: string; message: string }
  | { op: "panel.leave"; id: string; leftOut: boolean }
  /** The frame's picture set in motion (made by the host); null: the clip is taken away and the shot is its still again. */
  | { op: "panel.clip"; id: string; clip: PanelClip | null }
  /** A person's choice for one shot: `still: true` — it stays a still (its clip, if any, is not used and none is made). */
  | { op: "panel.still"; id: string; still: boolean }
  /** A person's own recording becomes a character's voice (null: it is taken away). */
  | { op: "voice.sample"; id: string; sample: Omit<VoiceSample, "added_ms"> | null }
  | { op: "line.add"; id?: string; afterId?: string; fields: LineFields }
  | { op: "line.update"; id: string; fields: LineFields }
  | { op: "line.remove"; id: string }
  | { op: "line.take"; id: string; take: Take; keepCurrent?: boolean }
  | { op: "line.take.use"; id: string; takeId: string }
  | { op: "line.take.remove"; id: string; takeId: string }
  | { op: "music.set"; version: Version | null }
  | { op: "breakdown.set"; breakdown: Breakdown }
  | { op: "project.set"; project: FilmProject | null }
  | { op: "pipeline.set"; runId: string | null }
  /** Accepted and recorded, decides nothing (see `sendAllowed`). */
  | { op: "references.allow"; providerId: string; kind?: "image" | "audio" }
  | { op: "spent.add"; usd: number }
  | { op: "opened" };
/** What the writing step produces from the story: who and what is in it, and how it is cut into panels and lines. */
export type Breakdown = {
  logline: string; synopsis: string;
  /** The accent the story is told in, when the script names one (see `ACCENTS`). */
  accent?: string;
  characters: (Pick<Character, "id" | "name" | "role" | "age" | "description" | "appearance" | "gender"> & { accent?: string })[]; locations: Pick<Location, "id" | "name" | "description" | "appearance">[]; props: Pick<Prop, "id" | "name" | "description" | "appearance">[];
  clips: Clip[]; panels: Omit<Panel, "picture">[]; lines: Pick<Line, "id" | "kind" | "speakerId" | "text" | "panelId" | "emotion">[];
};
export type OpContext = { now_ms: number; newId: () => string };

const text = (value: unknown, max: number, what: string, min = 0): string => {
  if (typeof value !== "string") invalid(`${what} must be text.`, { field: what });
  const trimmed = (value as string).trim();
  if (trimmed.length < min) invalid(`${what} cannot be empty.`, { field: what });
  if (trimmed.length > max) invalid(`${what} is at most ${max} characters.`, { field: what, max });
  return trimmed;
};
const oneOf = <T extends string | number>(value: unknown, list: readonly T[], what: string): T => (list.includes(value as T) ? (value as T) : invalid(`${what} is not one of the offered values.`, { field: what }));
const listOf = (film: Film, kind: AssetKind): Asset[] => (kind === "character" ? film.characters : kind === "location" ? film.locations : film.props);
const mark = (film: Film, ...stages: StageId[]): void => { for (const stage of stages) if (!film.stale.includes(stage)) film.stale.push(stage); };
const frameOf = (film: Pick<Film, "frameRate">): number => TICKS / film.frameRate;
/** A panel length on the frame grid, inside the limits. */
export const panelTicks = (film: Pick<Film, "frameRate">, ticks: number): number => {
  const frame = frameOf(film);
  return Math.round(Math.min(LIMITS.panelMax_ticks, Math.max(LIMITS.panelMin_ticks, ticks)) / frame) * frame;
};

function assetFields(target: Asset, kind: AssetKind, fields: AssetFields, film: Film): void {
  if (fields.name !== undefined) {
    const name = text(fields.name, LIMITS.name, "Name", 1);
    if (listOf(film, kind).some((other) => other !== target && other.name.toLowerCase() === name.toLowerCase())) invalid(`A ${kind} with this name already exists`, { field: "name" });
    target.name = name;
  }
  if (fields.description !== undefined) target.description = text(fields.description, LIMITS.text, "Description");
  if (fields.appearance !== undefined) {
    const appearance = text(fields.appearance, LIMITS.text, "Appearance");
    // The words every picture of this asset is drawn from changed: its reference and the panels that show it are outdated.
    if (appearance !== target.appearance) {
      target.appearance = appearance;
      delete target.refused;
      if (target.picture.current) target.picture.stale = true;
      for (const panel of film.panels) if (panel.picture.current && (kind === "character" ? panel.characterIds.includes(target.id) : kind === "location" ? panel.locationId === target.id : panel.propIds.includes(target.id))) panel.picture.stale = true;
    }
  }
  if (kind !== "character") return;
  const character = target as Character;
  if (fields.role !== undefined) character.role = oneOf(fields.role, CHARACTER_ROLES, "Role");
  if (fields.age !== undefined) character.age = text(fields.age, 40, "Age");
  if (fields.gender !== undefined) character.gender = oneOf(fields.gender, GENDERS, "Gender");
  if (fields.confirmed !== undefined) character.confirmed = fields.confirmed === true;
  // A voice that changes without the auto mark is the person's own pick and clears the tag; a save that carries the
  // voice unchanged (an edit of another field) leaves the tag alone.
  if (fields.voiceId !== undefined) {
    const voiceId = text(fields.voiceId, 80, "Voice");
    if (voiceId !== character.voiceId) { character.voiceId = voiceId; character.voiceAuto = fields.voiceAuto === true; staleTakes(film, character.id); }
    else if (fields.voiceAuto !== undefined) character.voiceAuto = fields.voiceAuto === true;
  } else if (fields.voiceAuto !== undefined) character.voiceAuto = fields.voiceAuto === true;
  // A person's own accent for this speaker ("" gives the choice back to the film's default): the takes spoken before it are outdated.
  if (fields.accent !== undefined) {
    const before = accentOf(film, character.id), accent = accentValue(film.language, fields.accent);
    if (fields.accent.trim() && !accent) invalid("This accent is not one of the offered ones.", { field: "accent" });
    if (accent) character.accent = accent; else delete character.accent;
    character.accentAuto = false;
    if (accentOf(film, character.id) !== before) staleTakes(film, character.id);
  }
}
/** The takes of a speaker no longer sound like the speaker's voice. */
function staleTakes(film: Film, speakerId: string): void { for (const line of film.lines) if (line.speakerId === speakerId) for (const take of line.takes) take.stale = true; }
function panelFields(film: Film, panel: Panel, fields: PanelFields): void {
  let redraw = false;
  let remotion = false;
  if (fields.duration_ticks !== undefined) { if (!Number.isFinite(fields.duration_ticks)) invalid("Duration must be a number.", { field: "duration_ticks" }); panel.duration_ticks = panelTicks(film, fields.duration_ticks); }
  if (fields.shotSize !== undefined) { redraw ||= fields.shotSize !== panel.shotSize; panel.shotSize = oneOf(fields.shotSize, SHOT_SIZES, "Shot size"); }
  if (fields.cameraMotion !== undefined) { remotion ||= fields.cameraMotion !== panel.cameraMotion; panel.cameraMotion = oneOf(fields.cameraMotion, CAMERA_MOTIONS, "Camera motion"); }
  if (fields.action !== undefined) { const action = text(fields.action, LIMITS.text, "Description", 1); redraw ||= action !== panel.action; panel.action = action; }
  if (fields.videoPrompt !== undefined) { remotion ||= fields.videoPrompt !== panel.videoPrompt; panel.videoPrompt = text(fields.videoPrompt, 2000, "Video prompt"); }
  if (fields.characterIds !== undefined) { const ids = [...new Set(fields.characterIds)].filter((id) => film.characters.some((entry) => entry.id === id)).slice(0, 8); redraw ||= ids.join() !== panel.characterIds.join(); panel.characterIds = ids; }
  if (fields.propIds !== undefined) { const ids = [...new Set(fields.propIds)].filter((id) => film.props.some((entry) => entry.id === id)).slice(0, 8); redraw ||= ids.join() !== panel.propIds.join(); panel.propIds = ids; }
  if (fields.locationId !== undefined) { const id = fields.locationId && film.locations.some((entry) => entry.id === fields.locationId) ? fields.locationId : null; redraw ||= id !== panel.locationId; panel.locationId = id; }
  if (redraw && panel.picture.current) panel.picture.stale = true;
  if (remotion && panel.clip) panel.clip.stale = true;
  // New words are a new request: what the provider said about the old ones, and a decision made because of it, no longer hold.
  if (redraw) { delete panel.refused; delete panel.leftOut; }
}
function lineFields(film: Film, line: Line, fields: LineFields): void {
  let again = false;
  if (fields.kind !== undefined) line.kind = oneOf(fields.kind, LINE_KINDS, "Kind");
  if (fields.speakerId !== undefined) { if (fields.speakerId !== NARRATOR && !film.characters.some((entry) => entry.id === fields.speakerId)) invalid("This speaker is not in the film.", { field: "speakerId" }); again ||= fields.speakerId !== line.speakerId; line.speakerId = fields.speakerId; }
  if (fields.text !== undefined) { const value = text(fields.text, LIMITS.lineText, "Text", 1); again ||= value !== line.text; line.text = value; }
  if (fields.panelId !== undefined) line.panelId = fields.panelId && film.panels.some((entry) => entry.id === fields.panelId) ? fields.panelId : null;
  if (fields.emotion !== undefined) { const value = text(fields.emotion, 200, "Emotion"); again ||= value !== line.emotion; line.emotion = value; }
  if (fields.intensity !== undefined) { if (!(fields.intensity >= 0 && fields.intensity <= 100)) invalid("Intensity is between 0 and 100.", { field: "intensity" }); line.intensity = Math.round(fields.intensity); }
  if (fields.rate !== undefined) { if (!(fields.rate >= 0.5 && fields.rate <= 2)) invalid("Rate is between 0.5× and 2×.", { field: "rate" }); again ||= fields.rate !== line.rate; line.rate = Math.round(fields.rate * 100) / 100; }
  if (again) for (const take of line.takes) take.stale = true;
}
const newPanel = (film: Film, id: string, clipId: string): Panel => ({ id, clipId, duration_ticks: panelTicks(film, LIMITS.panelDefault_ticks), shotSize: "medium", cameraMotion: "static", action: "New panel", characterIds: [], locationId: null, propIds: [], videoPrompt: "", picture: emptyPicture() });
/** Panels in the order of their clips, then of the list. */
export function orderedPanels(film: Pick<Film, "clips" | "panels">): Panel[] {
  const order = new Map(film.clips.map((clip, index) => [clip.id, index]));
  return film.panels.map((panel, index) => ({ panel, index })).sort((a, b) => (order.get(a.panel.clipId) ?? 0) - (order.get(b.panel.clipId) ?? 0) || a.index - b.index).map((entry) => entry.panel);
}

/** Old films stored before `gender` and `voiceAuto` existed read with their defaults (no format bump): fill them in
 *  whatever op runs first, so a reader and the casting always see the same shape. */
export function normaliseFilm(film: Film): Film {
  for (const character of film.characters) {
    if (character.gender !== "female" && character.gender !== "male" && character.gender !== "neutral") character.gender = "neutral";
    if (typeof character.voiceAuto !== "boolean") character.voiceAuto = false;
  }
  if (typeof film.narratorVoiceAuto !== "boolean") film.narratorVoiceAuto = false;
  return film;
}

/** Applies ops in order to a copy of the film. `revise: false` keeps the revision (used while a film is being created). */
export function applyOps(source: Film, ops: readonly FilmOp[], context: OpContext, revise = true): Film {
  const film = normaliseFilm(structuredClone(source) as Film);
  const id = (given?: string): string => given || context.newId();
  const asset = (kind: AssetKind, assetId: string): Asset => listOf(film, kind).find((entry) => entry.id === assetId) ?? missing(kind, assetId);
  const panel = (panelId: string): Panel => film.panels.find((entry) => entry.id === panelId) ?? missing("panel", panelId);
  const line = (lineId: string): Line => film.lines.find((entry) => entry.id === lineId) ?? missing("line", lineId);
  const offer = (picture: Picture, version: Version): void => {
    // The first picture is used at once; a later one waits beside the current one until a person chooses.
    if (!picture.current) { picture.current = version; picture.stale = false; return; }
    picture.candidates = [...picture.candidates, version].slice(-LIMITS.candidates);
  };
  const use = (picture: Picture, versionId: string): void => {
    const chosen = picture.candidates.find((entry) => entry.id === versionId) ?? missing("candidate", versionId);
    picture.current = chosen; picture.candidates = []; picture.stale = false;
  };
  for (const op of ops) {
    switch (op.op) {
      case "film.set": {
        const fields = op.fields;
        if (fields.title !== undefined) film.title = text(fields.title, LIMITS.title, "Title", 1);
        if (fields.description !== undefined) film.description = text(fields.description, LIMITS.description, "Description");
        if (fields.aspectRatio !== undefined && fields.aspectRatio !== film.aspectRatio) { film.aspectRatio = oneOf(fields.aspectRatio, FILM_ASPECT_RATIOS, "Aspect ratio"); for (const entry of film.panels) if (entry.picture.current) entry.picture.stale = true; if (film.panels.length) mark(film, "storyboard", "timeline"); }
        if (fields.artStyle !== undefined || fields.artStyleText !== undefined) {
          const style = fields.artStyle !== undefined ? oneOf(fields.artStyle, ART_STYLES.map((entry) => entry.id), "Art style") : film.artStyle;
          const custom = fields.artStyleText !== undefined ? text(fields.artStyleText, LIMITS.artStyleText, "Art style text") : film.artStyleText;
          if (style === "custom" && !custom) invalid("Describe the custom style", { field: "artStyleText" });
          if (style !== film.artStyle || custom !== film.artStyleText) {
            film.artStyle = style; film.artStyleText = custom;
            for (const entry of [...film.characters, ...film.locations, ...film.props, ...film.panels]) if (entry.picture.current) entry.picture.stale = true;
            if (film.panels.length) mark(film, "assets", "storyboard", "timeline");
          }
        }
        if (fields.language !== undefined) film.language = text(fields.language, 16, "Language", 2);
        if (fields.frameRate !== undefined) film.frameRate = oneOf(fields.frameRate, FRAME_RATES, "Frame rate");
        if (fields.sourceText !== undefined) {
          if (typeof fields.sourceText !== "string" || fields.sourceText.length > LIMITS.sourceText) invalid("Episode text limit reached — split into episodes", { field: "sourceText", max: LIMITS.sourceText });
          // The story moved under a script that was made from it: every later stage is outdated.
          if (fields.sourceText !== film.sourceText) { film.sourceText = fields.sourceText; if (film.panels.length) { film.scriptStale = true; mark(film, "timeline"); } }
        }
        if (fields.logline !== undefined) film.logline = text(fields.logline, 300, "Logline");
        if (fields.synopsis !== undefined) film.synopsis = text(fields.synopsis, LIMITS.description, "Synopsis");
        if (fields.narratorVoiceId !== undefined) {
          const voiceId = text(fields.narratorVoiceId, 80, "Voice");
          if (voiceId !== film.narratorVoiceId) { film.narratorVoiceId = voiceId; film.narratorVoiceAuto = fields.narratorVoiceAuto === true; staleTakes(film, NARRATOR); }
          else if (fields.narratorVoiceAuto !== undefined) film.narratorVoiceAuto = fields.narratorVoiceAuto === true;
        } else if (fields.narratorVoiceAuto !== undefined) film.narratorVoiceAuto = fields.narratorVoiceAuto === true;
        // The film's ONE default accent, a person's own choice ("" takes it away): the takes of everybody who speaks in the default are outdated.
        if (fields.accent !== undefined) {
          const accent = accentValue(film.language, fields.accent), before = film.accent ?? "";
          if (typeof fields.accent === "string" && fields.accent.trim() && !accent) invalid("This accent is not one of the offered ones.", { field: "accent" });
          if (accent) film.accent = accent; else delete film.accent;
          film.accentAuto = false;
          if ((film.accent ?? "") !== before) for (const entry of film.lines) if (entry.speakerId === NARRATOR || !film.characters.find((other) => other.id === entry.speakerId)?.accent) for (const take of entry.takes) take.stale = true;
        }
        if (fields.captions !== undefined) film.captions = fields.captions === true;
        if (fields.musicMood !== undefined && fields.musicMood !== film.music.mood) film.music = { mood: oneOf(fields.musicMood, MUSIC_MOODS, "Music"), current: null };
        break;
      }
      case "asset.add": {
        const list = listOf(film, op.kind);
        if (list.length >= LIMITS.assets) invalid(`A film holds at most ${LIMITS.assets} of these.`, { limit: LIMITS.assets });
        const base = { id: id(op.id), name: "", description: "", appearance: "", picture: emptyPicture() };
        const created: Asset = op.kind === "character" ? { ...base, role: "supporting", age: "", gender: "neutral", voiceId: "", voiceAuto: false, confirmed: false } : base;
        if (op.fields.name === undefined) invalid("Name cannot be empty.", { field: "name" });
        assetFields(created, op.kind, op.fields, film);
        list.push(created);
        break;
      }
      case "asset.update": assetFields(asset(op.kind, op.id), op.kind, op.fields, film); break;
      case "asset.remove": {
        asset(op.kind, op.id);
        if (op.kind === "character") { film.characters = film.characters.filter((entry) => entry.id !== op.id); for (const entry of film.panels) entry.characterIds = entry.characterIds.filter((other) => other !== op.id); for (const entry of film.lines) if (entry.speakerId === op.id) { entry.speakerId = NARRATOR; for (const take of entry.takes) take.stale = true; } }
        else if (op.kind === "location") { film.locations = film.locations.filter((entry) => entry.id !== op.id); for (const entry of film.panels) if (entry.locationId === op.id) entry.locationId = null; }
        else { film.props = film.props.filter((entry) => entry.id !== op.id); for (const entry of film.panels) entry.propIds = entry.propIds.filter((other) => other !== op.id); }
        break;
      }
      case "asset.picture": { const drawn = asset(op.kind, op.id); offer(drawn.picture, op.version); delete drawn.refused; break; }
      case "asset.refused": asset(op.kind, op.id).refused = { message: text(op.message, 500, "Message"), at_ms: context.now_ms }; break;
      case "asset.use": use(asset(op.kind, op.id).picture, op.versionId); break;
      case "asset.dismiss": asset(op.kind, op.id).picture.candidates = []; break;
      case "clip.add": if (film.clips.length >= LIMITS.clips) invalid(`A film holds at most ${LIMITS.clips} clips.`, { limit: LIMITS.clips }); film.clips.push({ id: id(op.id), title: text(op.title, 200, "Title") }); break;
      case "clip.update": (film.clips.find((entry) => entry.id === op.id) ?? missing("clip", op.id)).title = text(op.title, 200, "Title"); break;
      case "clip.remove": {
        if (!film.clips.some((entry) => entry.id === op.id)) missing("clip", op.id);
        const gone = new Set(film.panels.filter((entry) => entry.clipId === op.id).map((entry) => entry.id));
        film.clips = film.clips.filter((entry) => entry.id !== op.id); film.panels = film.panels.filter((entry) => !gone.has(entry.id));
        for (const entry of film.lines) if (entry.panelId && gone.has(entry.panelId)) entry.panelId = null;
        mark(film, "timeline");
        break;
      }
      case "panel.add": {
        if (!film.clips.some((entry) => entry.id === op.clipId)) missing("clip", op.clipId);
        if (film.panels.length >= LIMITS.panels) invalid(`An episode holds at most ${LIMITS.panels} panels.`, { limit: LIMITS.panels });
        if (film.panels.filter((entry) => entry.clipId === op.clipId).length >= LIMITS.panelsPerClip) invalid(`A clip can have at most ${LIMITS.panelsPerClip} panels`, { limit: LIMITS.panelsPerClip });
        const created = newPanel(film, id(op.id), op.clipId);
        if (op.fields) panelFields(film, created, op.fields);
        const after = op.afterId ? film.panels.findIndex((entry) => entry.id === op.afterId) : -1;
        if (after >= 0) film.panels.splice(after + 1, 0, created);
        else { const last = film.panels.map((entry) => entry.clipId).lastIndexOf(op.clipId); film.panels.splice(last >= 0 ? last + 1 : film.panels.length, 0, created); }
        if (film.project) mark(film, "timeline");
        break;
      }
      case "panel.update": panelFields(film, panel(op.id), op.fields); if (film.project) mark(film, "timeline"); break;
      case "panel.remove": panel(op.id); film.panels = film.panels.filter((entry) => entry.id !== op.id); for (const entry of film.lines) if (entry.panelId === op.id) entry.panelId = null; if (film.project) mark(film, "timeline"); break;
      case "panel.move": {
        const moved = panel(op.id);
        if (!film.clips.some((entry) => entry.id === op.clipId)) missing("clip", op.clipId);
        const rest = film.panels.filter((entry) => entry.id !== op.id), siblings = rest.filter((entry) => entry.clipId === op.clipId);
        if (moved.clipId !== op.clipId && siblings.length >= LIMITS.panelsPerClip) invalid(`A clip can have at most ${LIMITS.panelsPerClip} panels`, { limit: LIMITS.panelsPerClip });
        const index = Math.max(0, Math.min(siblings.length, Math.trunc(op.index)));
        const anchor = index < siblings.length ? rest.indexOf(siblings[index]) : siblings.length ? rest.indexOf(siblings[siblings.length - 1]) + 1 : rest.length;
        rest.splice(anchor, 0, { ...moved, clipId: op.clipId });
        film.panels = rest;
        if (film.project) mark(film, "timeline");
        break;
      }
      case "panel.picture": {
        const drawn = panel(op.id);
        // An OUTDATED picture (the frame's words changed since) is replaced by the new one and waits beside it; a current one keeps its place and the new one is offered.
        if (drawn.picture.current && drawn.picture.stale) { const old = drawn.picture.current; drawn.picture = { current: op.version, candidates: [...drawn.picture.candidates, old].slice(-LIMITS.candidates), stale: false }; }
        else offer(drawn.picture, op.version);
        delete drawn.refused; delete drawn.leftOut; if (film.project) mark(film, "timeline"); break;
      }
      case "panel.refused": panel(op.id).refused = { message: text(op.message, 500, "Message"), at_ms: context.now_ms, ...(op.reason === "picture" ? { reason: "picture" as const } : {}) }; break;
      case "panel.candidate": { const kept = panel(op.id).picture; kept.candidates = [...kept.candidates, op.version].slice(-LIMITS.candidates); break; }
      case "panel.clip": { const moved = panel(op.id); if (op.clip) { moved.clip = op.clip; delete moved.still; } else delete moved.clip; if (film.project) mark(film, "timeline"); break; }
      case "panel.still": { const held = panel(op.id); if (op.still === true) held.still = true; else delete held.still; if (film.project) mark(film, "timeline"); break; }
      case "voice.sample": {
        const speaker = film.characters.find((entry) => entry.id === op.id) ?? missing("character", op.id);
        if (op.sample) {
          if (!/^[a-f0-9]{64}$/.test(op.sample.blobId)) invalid("This recording is not on the host.", { field: "sample.blobId" });
          if (!(op.sample.bytes > 0) || op.sample.bytes > VOICE_SAMPLE_LIMITS.maxBytes) invalid(`A voice sample is at most ${VOICE_SAMPLE_LIMITS.maxBytes / 1_048_576} MB.`, { field: "sample.bytes", max: VOICE_SAMPLE_LIMITS.maxBytes });
          const said = op.sample.text === undefined ? "" : text(op.sample.text, VOICE_SAMPLE_LIMITS.maxText, "What the sample says");
          speaker.voiceSample = { blobId: op.sample.blobId, name: text(op.sample.name, 200, "Name", 1), bytes: Math.round(op.sample.bytes), mime: text(op.sample.mime, 80, "Type", 1), ...(typeof op.sample.duration_ticks === "number" && op.sample.duration_ticks > 0 ? { duration_ticks: Math.round(op.sample.duration_ticks) } : {}), ...(said ? { text: said } : {}), added_ms: context.now_ms };
        } else delete speaker.voiceSample;
        staleTakes(film, speaker.id);
        break;
      }
      case "panel.leave": { const left = panel(op.id); if (op.leftOut === true) { left.leftOut = true; delete left.refused; } else delete left.leftOut; if (film.project) mark(film, "timeline"); break; }
      case "panel.use": { const chosen = panel(op.id); use(chosen.picture, op.versionId); delete chosen.refused; delete chosen.leftOut; if (film.project) mark(film, "timeline"); break; }
      case "panel.dismiss": panel(op.id).picture.candidates = []; break;
      case "line.add": {
        if (film.lines.length >= LIMITS.lines) (() => { throw new FilmError("FILM_LIMIT_EXCEEDED", `An episode holds at most ${LIMITS.lines} voice lines.`, { limit: "linesPerEpisode", max: LIMITS.lines, actual: film.lines.length + 1 }); })();
        const created: Line = { id: id(op.id), kind: "narration", speakerId: NARRATOR, text: "", panelId: null, emotion: "", intensity: 50, rate: 1, takes: [], activeTakeId: null };
        if (op.fields.text === undefined) invalid("Text cannot be empty.", { field: "text" });
        lineFields(film, created, op.fields);
        const after = op.afterId ? film.lines.findIndex((entry) => entry.id === op.afterId) : -1;
        film.lines.splice(after >= 0 ? after + 1 : film.lines.length, 0, created);
        if (film.project) mark(film, "timeline");
        break;
      }
      case "line.update": lineFields(film, line(op.id), op.fields); if (film.project) mark(film, "timeline"); break;
      case "line.remove": line(op.id); film.lines = film.lines.filter((entry) => entry.id !== op.id); if (film.project) mark(film, "timeline"); break;
      case "line.take": {
        const target = line(op.id);
        target.takes = [op.take, ...target.takes].slice(0, LIMITS.takes);
        // "Keep current take": the new take is kept beside the one in use — unless that one is outdated, which is why this take was made.
        if (!op.keepCurrent || activeTake(target)?.stale !== false) target.activeTakeId = op.take.id;
        if (film.project) mark(film, "timeline");
        break;
      }
      case "line.take.use": { const target = line(op.id); if (!target.takes.some((entry) => entry.id === op.takeId)) missing("take", op.takeId); target.activeTakeId = op.takeId; if (film.project) mark(film, "timeline"); break; }
      case "line.take.remove": {
        const target = line(op.id);
        if (!target.takes.some((entry) => entry.id === op.takeId)) missing("take", op.takeId);
        target.takes = target.takes.filter((entry) => entry.id !== op.takeId);
        if (target.activeTakeId === op.takeId) target.activeTakeId = target.takes[0]?.id ?? null;
        if (film.project) mark(film, "timeline");
        break;
      }
      case "music.set": film.music = { ...film.music, current: op.version }; if (film.project) mark(film, "timeline"); break;
      case "breakdown.set": {
        const made = op.breakdown;
        const previousAccents = new Map(source.lines.map((entry) => [entry.id, accentOf(source, entry.speakerId)]));
        // Written again from the story: what a person already made for an entity of the same id stays with it.
        const kept = <T extends { id: string; picture: Picture }>(before: T[], entryId: string): Picture => { const found = before.find((entry) => entry.id === entryId)?.picture; return found ? { ...found, stale: !!found.current } : emptyPicture(); };
        const voices = new Map(film.characters.map((entry) => [entry.id, entry]));
        film.logline = made.logline; film.synopsis = made.synopsis;
        // The accents: a person's own choice stays; otherwise what the script says of the story (none when it says nothing).
        if (!(film.accent && film.accentAuto === false)) { const told = accentValue(film.language, made.accent); if (told) { film.accent = told; film.accentAuto = true; } else if (film.accentAuto !== false) { delete film.accent; delete film.accentAuto; } }
        film.characters = made.characters.map(({ accent: told, ...entry }) => {
          const before = voices.get(entry.id), own = before?.accent && before.accentAuto === false ? before.accent : "", written = own || accentValue(film.language, told);
          return { ...entry, voiceId: before?.voiceId ?? "", voiceAuto: before?.voiceAuto ?? false, ...(written ? { accent: written, accentAuto: !own } : {}), ...(before?.voiceSample ? { voiceSample: before.voiceSample } : {}), confirmed: false, picture: kept(source.characters, entry.id) };
        });
        film.locations = made.locations.map((entry) => ({ ...entry, picture: kept(source.locations, entry.id) }));
        film.props = made.props.map((entry) => ({ ...entry, picture: kept(source.props, entry.id) }));
        film.clips = made.clips.map((entry) => ({ ...entry }));
        film.panels = made.panels.map((entry) => { const before = source.panels.find((other) => other.id === entry.id); return { ...entry, duration_ticks: panelTicks(film, entry.duration_ticks), picture: kept(source.panels, entry.id), ...(before?.clip ? { clip: before.clip } : {}), ...(before?.still ? { still: true } : {}) }; });
        const lines = new Map(source.lines.map((entry) => [entry.id, entry]));
        film.lines = made.lines.map((entry) => { const before = lines.get(entry.id), accentChanged = previousAccents.get(entry.id) !== accentOf(film, entry.speakerId); return { ...entry, intensity: before?.intensity ?? 50, rate: before?.rate ?? 1, takes: (before?.takes ?? []).map((take) => ({ ...take, stale: take.stale || before?.text !== entry.text || accentChanged })), activeTakeId: before?.activeTakeId ?? null }; });
        film.stale = film.project ? ["timeline"] : [];
        film.scriptStale = false;
        break;
      }
      case "project.set": film.project = op.project; film.stale = film.stale.filter((stage) => stage !== "timeline"); break;
      case "pipeline.set": film.pipelineRunId = op.runId; break;
      case "spent.add": film.spentUsd = Math.round((film.spentUsd + Math.max(0, op.usd)) * 10_000) / 10_000; break;
      case "references.allow": { const entry = `${op.kind === "audio" ? "audio" : "image"}:${text(op.providerId, 120, "Provider", 1)}`; if (!film.sendAllowed?.includes(entry)) film.sendAllowed = [...(film.sendAllowed ?? []), entry].slice(-40); break; }
      case "opened": film.opened_ms = context.now_ms; break;
      default: invalid("Unknown change.", { op: (op as { op: string }).op });
    }
  }
  // A stage is marked exactly while something in it is outdated: a reference picture, a panel image, the take a line uses.
  const rewritten = film.scriptStale === true && film.panels.length > 0;
  const outdated: Partial<Record<StageId, boolean>> = {
    assets: rewritten || [...film.characters, ...film.locations, ...film.props].some((entry) => entry.picture.stale), storyboard: rewritten || film.panels.some((entry) => entry.picture.stale),
    voice: rewritten || film.lines.some((entry) => activeTake(entry)?.stale === true), timeline: film.stale.includes("timeline"),
  };
  film.stale = STAGES.filter((stage) => outdated[stage] === true);
  if (revise) { film.revision = source.revision + 1; film.updated_ms = context.now_ms; }
  return film;
}

export const activeTake = (line: Pick<Line, "takes" | "activeTakeId">): Take | null => line.takes.find((take) => take.id === line.activeTakeId) ?? null;
export const speakerName = (film: Pick<Film, "characters">, speakerId: string): string => (speakerId === NARRATOR ? "Narrator" : film.characters.find((entry) => entry.id === speakerId)?.name ?? "Narrator");
export const voiceOf = (film: Pick<Film, "characters" | "narratorVoiceId">, speakerId: string): string => (speakerId === NARRATOR ? film.narratorVoiceId : film.characters.find((entry) => entry.id === speakerId)?.voiceId ?? "");
export const styleText = (film: Pick<Film, "artStyle" | "artStyleText">): string => (film.artStyle === "custom" ? film.artStyleText : ART_STYLES.find((entry) => entry.id === film.artStyle)?.descriptor ?? "");
/** Speakers of the film that have at least one line, the narrator last. */
export function speakers(film: Pick<Film, "characters" | "lines" | "narratorVoiceId">): { id: string; name: string; voiceId: string }[] {
  const used = new Set(film.lines.map((line) => line.speakerId));
  return [...film.characters.filter((entry) => used.has(entry.id)).map((entry) => ({ id: entry.id, name: entry.name, voiceId: entry.voiceId })), ...(used.has(NARRATOR) || !film.characters.length ? [{ id: NARRATOR, name: "Narrator", voiceId: film.narratorVoiceId }] : [])];
}

/** What each screen counts: what exists, what is missing and what is outdated. */
export function counts(film: Film) {
  const assets = [...film.characters, ...film.locations, ...film.props];
  const needsTake = film.lines.filter((line) => { const take = activeTake(line); return !take || take.stale; });
  return {
    assets: assets.length, assetsMissing: assets.filter((entry) => !entry.picture.current).length, assetsStale: assets.filter((entry) => entry.picture.stale).length,
    panels: film.panels.length, panelsWithImage: film.panels.filter((entry) => entry.picture.current).length, panelsMissing: film.panels.filter((entry) => !entry.picture.current).length, panelsStale: film.panels.filter((entry) => entry.picture.stale).length,
    lines: film.lines.length, linesMissing: needsTake.length, unbound: film.lines.filter((line) => !line.panelId).length,
    duration_ticks: film.panels.reduce((sum, entry) => sum + entry.duration_ticks, 0),
  };
}
/** Whether a stage can be opened usefully, and why not. */
export function stageReady(film: Film, stage: StageId): { ready: boolean; reason: string } {
  if (stage === "story") return { ready: true, reason: "" };
  if (!film.panels.length && !film.characters.length) return { ready: false, reason: "Create the script from the story first" };
  if (stage === "timeline" && !film.panels.some((entry) => entry.picture.current)) return { ready: false, reason: "No panel has an image yet" };
  return { ready: true, reason: "" };
}
/** The words of a story: characters and words as the Story stage counts them. */
export const storyCounts = (value: string): { characters: number; words: number } => ({ characters: value.length, words: value.trim() ? value.trim().split(/\s+/).length : 0 });
