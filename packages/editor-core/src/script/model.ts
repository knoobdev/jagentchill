import {
  SCRIPT_FORMAT, SCRIPT_SCHEMA_VERSION, scriptDocumentSchema,
  type ScriptAspectRatio, type ScriptBeat, type ScriptDocument, type ScriptEntity, type ScriptEntityKind, type ScriptErrorCode, type ScriptLine, type ScriptLineKind, type ScriptScene, type ScriptShot,
} from "@jagentchill/protocol";
import { canonicalJson } from "../canonical.ts";
import type { RandomSource } from "../ids.ts";
import { utf8 } from "../sha256.ts";

/** A refusal of the script domain: one of the codes of `script-studio.Script error codes`, with the thing concerned. */
export class ScriptError extends Error {
  readonly code: ScriptErrorCode;
  readonly details: Record<string, unknown>;
  constructor(code: ScriptErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ScriptError";
    this.code = code;
    this.details = details;
  }
}

const platformRandom: RandomSource = (bytes) => (globalThis as unknown as { crypto: { getRandomValues(array: Uint8Array): Uint8Array } }).crypto.getRandomValues(bytes);
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
/** 16 random bytes, base64url without padding: the stable id of an act, scene, beat, line, shot, entity and script. */
export function scriptId(random: RandomSource = platformRandom): string {
  const bytes = random(new Uint8Array(16));
  let out = "";
  for (let index = 0; index < 16; index += 3) {
    const a = bytes[index], b = bytes[index + 1] ?? 0, c = bytes[index + 2] ?? 0;
    out += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)] + (index + 1 < 16 ? B64[((b & 15) << 2) | (c >> 6)] : "") + (index + 2 < 16 ? B64[c & 63] : "");
  }
  return out;
}
export type ScriptIds = () => string;
/** Ids of a session, never issued twice. */
export function createScriptIds(random: RandomSource = platformRandom): ScriptIds {
  const issued = new Set<string>();
  return () => { let next = scriptId(random); while (issued.has(next)) next = scriptId(random); issued.add(next); return next; };
}

export const SCRIPT_LIMITS = { acts: 20, scenes: 500, beatsPerScene: 100, linesPerBeat: 200, shotsPerScene: 60, shots: 2000, characters: 600_000, bytes: 10 * 1024 * 1024, entities: 200, projectLinks: 20 } as const;
const LIMIT_MESSAGES: Record<string, (value: number) => string> = {
  acts: (value) => `A script can have at most ${value} acts`, scenes: (value) => `A script can have at most ${value} scenes`,
  beatsPerScene: (value) => `A scene can have at most ${value} beats`, linesPerBeat: (value) => `A beat can have at most ${value} lines`,
  shotsPerScene: (value) => `A scene can have at most ${value} shots`, shots: (value) => `A script can have at most ${value.toLocaleString("en-US")} shots`,
  characters: (value) => `A script can have at most ${value.toLocaleString("en-US")} characters of text`, bytes: () => "A script can be at most 10 MiB",
  entities: (value) => `A script can have at most ${value} characters, locations or props of each kind`,
};
export const limitMessage = (limit: string, value: number): string => (LIMIT_MESSAGES[limit] ?? (() => `Limit reached: ${limit}`))(value);

export const newLine = (ids: ScriptIds, kind: ScriptLineKind = "action", text = "", extra: Partial<ScriptLine> = {}): ScriptLine => ({ id: ids(), kind, text, ...extra });
export const newBeat = (ids: ScriptIds, label = "", intent = "", lines: ScriptLine[] = []): ScriptBeat => ({ id: ids(), label, intent, lines });
export const newScene = (ids: ScriptIds, fields: Partial<ScriptScene> = {}): ScriptScene => ({
  id: ids(), heading: { setting: "NONE", locationText: "", timeOfDay: "" }, title: "", summary: "", beats: [newBeat(ids)], shots: [], omitted: false, ...fields,
});
/** Defaults of a new shot: medium, eye-level, static, source auto, a cut out. */
export const newShot = (ids: ScriptIds, fields: Partial<ScriptShot> = {}): ScriptShot => ({
  id: ids(), lineIds: [], description: "", size: "medium", angle: "eye-level", movement: "static", characterIds: [], propIds: [], references: [], onScreenText: "", transitionOut: "cut", source: "auto", notes: "", ...fields,
});
export const newEntity = (ids: ScriptIds, name: string, colorIndex = 1): ScriptEntity => ({ id: ids(), name, aliases: [], description: "", colorIndex });

export type NewScriptOptions = { ids: ScriptIds; now_ms: number; locale: string; title?: string; createdBy?: string; aspectRatio?: ScriptAspectRatio; formatId?: string };
/** The blank script: language of the app locale, 9:16, normal pace, no target, one scene with one empty beat. */
export function createScript(options: NewScriptOptions): ScriptDocument {
  return {
    format: SCRIPT_FORMAT, schemaVersion: SCRIPT_SCHEMA_VERSION, id: options.ids(), title: options.title ?? "Untitled script",
    meta: { logline: "", synopsis: "", genre: [], tone: "", audience: "", language: options.locale, aspectRatio: options.aspectRatio ?? "9:16", formatId: options.formatId ?? "blank", pace: "normal", author: "", notes: "", tags: [] },
    status: "draft", acts: [], scenes: [newScene(options.ids)], entities: { characters: [], locations: [], props: [] },
    links: { projectIds: [] }, headVersionId: options.ids(), revision: 0, createdBy: options.createdBy ?? "device", created_ms: options.now_ms, updated_ms: options.now_ms,
  };
}

export type ScriptIssue = { code: ScriptErrorCode; path: string; message: string; id?: string };
/** Schema validation of a document about to be saved: every violation is `SCRIPT_SCHEMA_INVALID` naming its path. */
export function validateScript(document: unknown): { ok: boolean; errors: ScriptIssue[] } {
  const parsed = scriptDocumentSchema.safeParse(document);
  const errors: ScriptIssue[] = parsed.success ? [] : parsed.error.issues.map((issue) => ({ code: "SCRIPT_SCHEMA_INVALID", path: issue.path.join("."), message: issue.message }));
  if (parsed.success) {
    const seen = new Set<string>();
    const once = (value: string, path: string) => { if (seen.has(value)) errors.push({ code: "SCRIPT_SCHEMA_INVALID", path, message: `id "${value}" is used twice` }); seen.add(value); };
    const doc = parsed.data;
    doc.acts.forEach((act, index) => once(act.id, `acts.${index}.id`));
    doc.scenes.forEach((scene, s) => {
      once(scene.id, `scenes.${s}.id`);
      if (scene.actId && !doc.acts.some((act) => act.id === scene.actId)) errors.push({ code: "SCRIPT_SCHEMA_INVALID", path: `scenes.${s}.actId`, message: "the act does not exist" });
      const lineIds = new Set<string>();
      scene.beats.forEach((beat, b) => { once(beat.id, `scenes.${s}.beats.${b}.id`); beat.lines.forEach((line, l) => { once(line.id, `scenes.${s}.beats.${b}.lines.${l}.id`); lineIds.add(line.id); }); });
      scene.shots.forEach((shot, index) => {
        once(shot.id, `scenes.${s}.shots.${index}.id`);
        if (shot.lineIds.some((lineId) => !lineIds.has(lineId))) errors.push({ code: "SCRIPT_SCHEMA_INVALID", path: `scenes.${s}.shots.${index}.lineIds`, message: "a shot covers lines of its own scene only" });
      });
    });
    for (const kind of ["characters", "locations", "props"] as const) {
      const names = new Set<string>();
      doc.entities[kind].forEach((entity, index) => {
        once(entity.id, `entities.${kind}.${index}.id`);
        const key = entity.name.trim().toLowerCase();
        if (names.has(key)) errors.push({ code: "SCRIPT_SCHEMA_INVALID", path: `entities.${kind}.${index}.name`, message: "names are unique per kind" });
        names.add(key);
      });
    }
  }
  return { ok: errors.length === 0, errors };
}

/** Problems of single lines that never block saving a draft: a dialogue line with no speaker, an empty on-screen text. */
export function lineProblems(document: ScriptDocument): ScriptIssue[] {
  const issues: ScriptIssue[] = [];
  for (const { line, path } of allLines(document)) {
    if (line.kind === "dialogue" && !line.characterId && !line.speakerText?.trim()) issues.push({ code: "SCRIPT_LINE_INVALID", path, id: line.id, message: "Add a speaker" });
  }
  return issues;
}

/** Refuses a document that passed a limit, naming the limit and its value. */
export function assertLimits(document: ScriptDocument): void {
  const fail = (limit: string, value: number, details: Record<string, unknown> = {}): never => { throw new ScriptError("SCRIPT_LIMIT_EXCEEDED", limitMessage(limit, value), { limit, value, ...details }); };
  if (document.acts.length > SCRIPT_LIMITS.acts) fail("acts", SCRIPT_LIMITS.acts);
  if (document.scenes.length > SCRIPT_LIMITS.scenes) fail("scenes", SCRIPT_LIMITS.scenes);
  let shots = 0, characters = 0;
  for (const scene of document.scenes) {
    if (scene.beats.length > SCRIPT_LIMITS.beatsPerScene) fail("beatsPerScene", SCRIPT_LIMITS.beatsPerScene, { sceneId: scene.id });
    if (scene.shots.length > SCRIPT_LIMITS.shotsPerScene) fail("shotsPerScene", SCRIPT_LIMITS.shotsPerScene, { sceneId: scene.id });
    shots += scene.shots.length;
    for (const beat of scene.beats) {
      if (beat.lines.length > SCRIPT_LIMITS.linesPerBeat) fail("linesPerBeat", SCRIPT_LIMITS.linesPerBeat, { beatId: beat.id });
      for (const line of beat.lines) characters += line.text.length;
    }
  }
  if (shots > SCRIPT_LIMITS.shots) fail("shots", SCRIPT_LIMITS.shots);
  if (characters > SCRIPT_LIMITS.characters) fail("characters", SCRIPT_LIMITS.characters);
  for (const kind of ["characters", "locations", "props"] as const) if (document.entities[kind].length > SCRIPT_LIMITS.entities) fail("entities", SCRIPT_LIMITS.entities, { kind });
  // The cheap bound first: the canonical form is measured only when the text alone could reach the ceiling.
  if (characters * 4 + document.scenes.length * 2000 > SCRIPT_LIMITS.bytes && utf8(canonicalJson(document)).length > SCRIPT_LIMITS.bytes) fail("bytes", SCRIPT_LIMITS.bytes);
}

export type LineRef = { line: ScriptLine; beat: ScriptBeat; scene: ScriptScene; sceneIndex: number; beatIndex: number; lineIndex: number; path: string };
export function* allLines(document: Pick<ScriptDocument, "scenes">): Generator<LineRef> {
  for (const [sceneIndex, scene] of document.scenes.entries()) for (const [beatIndex, beat] of scene.beats.entries()) for (const [lineIndex, line] of beat.lines.entries()) {
    yield { line, beat, scene, sceneIndex, beatIndex, lineIndex, path: `scenes.${sceneIndex}.beats.${beatIndex}.lines.${lineIndex}` };
  }
}
export const findLine = (document: Pick<ScriptDocument, "scenes">, lineId: string): LineRef | undefined => { for (const ref of allLines(document)) if (ref.line.id === lineId) return ref; return undefined; };
export const sceneLines = (scene: ScriptScene): ScriptLine[] => scene.beats.flatMap((beat) => beat.lines);
export const findScene = (document: Pick<ScriptDocument, "scenes">, sceneId: string): ScriptScene | undefined => document.scenes.find((scene) => scene.id === sceneId);
export function findShot(document: Pick<ScriptDocument, "scenes">, shotId: string): { shot: ScriptShot; scene: ScriptScene; sceneIndex: number; index: number } | undefined {
  for (const [sceneIndex, scene] of document.scenes.entries()) { const index = scene.shots.findIndex((shot) => shot.id === shotId); if (index >= 0) return { shot: scene.shots[index], scene, sceneIndex, index }; }
  return undefined;
}
export function findBeat(document: Pick<ScriptDocument, "scenes">, beatId: string): { beat: ScriptBeat; scene: ScriptScene; index: number } | undefined {
  for (const scene of document.scenes) { const index = scene.beats.findIndex((beat) => beat.id === beatId); if (index >= 0) return { beat: scene.beats[index], scene, index }; }
  return undefined;
}
/** Scene numbers are derived from order, 1-based; an omitted scene keeps its number. */
export const sceneNumber = (document: Pick<ScriptDocument, "scenes">, sceneId: string): number => document.scenes.findIndex((scene) => scene.id === sceneId) + 1;
/** "<scene number>.<index in scene>", for example "3.2". */
export function shotNumber(document: Pick<ScriptDocument, "scenes">, shotId: string): string {
  const found = findShot(document, shotId);
  return found ? `${found.sceneIndex + 1}.${found.index + 1}` : "";
}
const SETTING_TEXT = { INT: "INT.", EXT: "EXT.", INT_EXT: "INT./EXT.", NONE: "" } as const;
export const entityName = (document: Pick<ScriptDocument, "entities">, kind: ScriptEntityKind, entityId: string | undefined): string | undefined => (entityId ? document.entities[kind].find((entity) => entity.id === entityId)?.name : undefined);
/** "INT. KITCHEN – NIGHT": the heading summary of the navigator, the markers and the exports (`dash` is the separator). */
export function headingText(document: Pick<ScriptDocument, "entities">, scene: ScriptScene, dash = "–"): string {
  const location = entityName(document, "locations", scene.heading.locationId) ?? scene.heading.locationText;
  return [[SETTING_TEXT[scene.heading.setting], location].filter(Boolean).join(" "), scene.heading.timeOfDay].filter(Boolean).join(` ${dash} `);
}
export const speakerOf = (document: Pick<ScriptDocument, "entities">, line: ScriptLine): string => entityName(document, "characters", line.characterId) ?? line.speakerText ?? "";
/** Lines of a scene no shot covers: the "uncovered" lines of the shot list. Notes and transitions are never shot. */
export function uncoveredLines(scene: ScriptScene): ScriptLine[] {
  const covered = new Set(scene.shots.flatMap((shot) => shot.lineIds));
  return sceneLines(scene).filter((line) => !covered.has(line.id) && line.kind !== "visual_note" && line.kind !== "sound_note" && line.kind !== "transition");
}
/** The words of a text, for the counts shown in lists and versions: space-delimited tokens that hold a letter or digit. */
export const countWords = (text: string): number => text.split(/\s+/u).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
