import { z } from "zod";
import { film as fm } from "@jagentchill/editor-core";
import { TOOL_RESULT_MAX_BYTES } from "@jagentchill/protocol";
import { WRITE, clip, defineTool, fail, id, ticks, type ToolContext, type ToolDefinition } from "../tools/kit.ts";

/**
 * The film family of the agent tools (`film-production`): the film assistant, and any agent, reads the open film and
 * changes its story, its cast and its scenes and shots. A film is a host document, not a project, so nothing is staged
 * in a proposal: every tool goes through the same service functions the studio screens use (`read`, `edit`,
 * `reorderClips`), so the open Film screen follows the `jagentchill.film.updated` event. A delete asks the user first,
 * the way every effect outside a project does. A session bound to a film (the film assistant's) may leave filmId out, but
 * may not name another film. `jc_film_get` answers in parts, so no single read of a 40 000-character story passes the
 * 32 KiB result limit: "overview" (the default) truncates the story text, "story" pages it, "scenes" lists the scenes.
 */
const available = (host: ToolContext["host"]): boolean => !!host.films;
const host = (ctx: ToolContext) => ctx.host.films!;
const FILM = { filmId: id().optional() };
/** The story text a read sends at most when it is not the point of the call, and the page size of the "story" part. */
const STORY_PREVIEW_CHARS = 2000, STORY_PAGE_DEFAULT = 8000;
const CHARACTER_FIELDS = ["name", "role", "age", "description", "appearance", "voiceId", "confirmed"] as const;
const SHOT_FIELDS = ["duration_ticks", "shotSize", "cameraMotion", "action", "characterIds", "locationId", "propIds", "videoPrompt"] as const;
type CharacterFields = Partial<Pick<fm.Character, "name" | "role" | "age" | "description" | "appearance" | "voiceId" | "confirmed">>;
type ShotFields = Partial<Pick<fm.Panel, "duration_ticks" | "shotSize" | "cameraMotion" | "action" | "characterIds" | "locationId" | "propIds" | "videoPrompt">>;

/** The film a call works on: the one named, or the film this session is bound to (the film assistant's session). */
function filmOf(ctx: ToolContext, filmId?: string): { id: string; film: fm.Film } {
  const bound = ctx.session.scriptId;
  if (filmId && bound && filmId !== bound) fail("INVALID_PARAMS", "This session is bound to another film. Ask about the film you are working on, or start a new session for that one.", { field: "filmId", bound });
  const chosen = filmId ?? bound;
  if (!chosen) fail("INVALID_PARAMS", "Name the film with filmId: this session is not bound to one.", { field: "filmId" });
  return { id: chosen as string, film: host(ctx).read(chosen as string) };
}

/** One change through the service, with the film model's refusals in the tool error shape. */
function change(ctx: ToolContext, filmId: string, ops: readonly fm.FilmOp[]): fm.Film {
  try { return host(ctx).edit(filmId, ops); } catch (error) {
    if (error instanceof fm.FilmError) fail(error.code === "NOT_FOUND" ? "NOT_FOUND" : error.code === "FILM_LIMIT_EXCEEDED" ? "OUT_OF_RANGE" : "INVALID_PARAMS", error.message, error.details);
    throw error;
  }
}

/** Every reference a shot names must exist in the film: a missing id is the family's NOT_FOUND, never silently dropped. */
function requireShotRefs(film: fm.Film, refs: { afterId?: string; characterIds?: string[]; locationId?: string | null; propIds?: string[] }): void {
  if (refs.afterId !== undefined && !film.panels.some((entry) => entry.id === refs.afterId)) fail("NOT_FOUND", "This shot is no longer in the film.", { id: refs.afterId });
  for (const characterId of refs.characterIds ?? []) if (!film.characters.some((entry) => entry.id === characterId)) fail("NOT_FOUND", "This character is no longer in the film.", { id: characterId });
  if (refs.locationId != null && !film.locations.some((entry) => entry.id === refs.locationId)) fail("NOT_FOUND", "This location is no longer in the film.", { id: refs.locationId });
  for (const propId of refs.propIds ?? []) if (!film.props.some((entry) => entry.id === propId)) fail("NOT_FOUND", "This prop is no longer in the film.", { id: propId });
}

const pictureView = (picture: fm.Picture) => ({ currentId: picture.current?.id ?? null, candidateIds: picture.candidates.map((entry) => entry.id), stale: picture.stale });

/** The id of the one entity an add appended to a list (the model inserts, so the new one is not always the last). */
const addedId = <T extends { id: string }>(before: readonly T[], after: readonly T[]): string => { const seen = new Set(before.map((entry) => entry.id)); return after.find((entry) => !seen.has(entry.id))!.id; };

/** One shot of a film as the tools read it, and its place in the order. */
const shotView = (panel: fm.Panel, index: number): Record<string, unknown> => ({ id: panel.id, index, clipId: panel.clipId, duration_ticks: panel.duration_ticks, shotSize: panel.shotSize, cameraMotion: panel.cameraMotion, action: panel.action, characterIds: panel.characterIds, locationId: panel.locationId, propIds: panel.propIds, videoPrompt: panel.videoPrompt, picture: pictureView(panel.picture) });
const lineView = (line: fm.Line): Record<string, unknown> => ({ id: line.id, kind: line.kind, speakerId: line.speakerId, text: line.text, panelId: line.panelId, emotion: line.emotion, intensity: line.intensity, rate: line.rate, takeIds: line.takes.map((take) => take.id), activeTakeId: line.activeTakeId });
const shotViews = (film: fm.Film): Record<string, unknown>[] => fm.orderedPanels(film).map((panel, index) => shotView(panel, index + 1));
const sceneViews = (film: fm.Film): Record<string, unknown>[] => film.clips.map((entry) => ({ id: entry.id, title: entry.title, shotIds: film.panels.filter((panel) => panel.clipId === entry.id).map((panel) => panel.id) }));
/** The collections a read of a film pages, and the name of each one's cursor in the answer. */
const COLLECTIONS = ["characters", "locations", "props", "scenes", "shots", "lines"] as const;
type Collection = (typeof COLLECTIONS)[number];
type Cursors = Partial<Record<Collection, string>>;
const NEXT: Record<Collection, string> = { characters: "nextCharacterCursor", locations: "nextLocationCursor", props: "nextPropCursor", scenes: "nextSceneCursor", shots: "nextCursor", lines: "nextLineCursor" };
const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value));
/**
 * One answer of `jc_film_get` within ONE budget: the fixed fields (`base`) and a page of every collection asked for,
 * together under the 32 KiB result limit — not a budget per collection. The collections share what `base` leaves, one
 * item each in turn (the ones the caller is continuing with a cursor first), so no collection is starved by a long one
 * before it, and every collection is cut at an item boundary with a cursor for the rest and its total.
 */
function fitted(base: Record<string, unknown>, lists: Partial<Record<Collection, unknown[]>>, limit: number | undefined, cursors: Cursors): Record<string, unknown> {
  const keys = COLLECTIONS.filter((key) => lists[key] !== undefined), size = Math.min(limit ?? 50, 200);
  const from = {} as Record<Collection, number>, taken = {} as Record<Collection, unknown[]>, open = new Set<Collection>(keys);
  for (const key of keys) {
    const offset = cursors[key] === undefined ? 0 : Number(cursors[key]);
    if (!Number.isInteger(offset) || offset < 0 || offset > lists[key]!.length) fail("INVALID_PARAMS", "cursor is not a cursor this tool returned. Call again without it to start from the first item.", { field: key === "shots" ? "cursor" : key === "lines" ? "lineCursor" : `cursors.${key}` });
    from[key] = offset; taken[key] = [];
  }
  // What the answer weighs before any item: the fixed fields, the empty lists, every total and every cursor it may carry, and the envelope around it.
  const shell = { ...base, ...Object.fromEntries(keys.flatMap((key) => [[key, []], [`${key}Total`, lists[key]!.length], [NEXT[key], "000000"]])) };
  let used = bytes(shell) + 1024;
  const order = [...keys.filter((key) => cursors[key] !== undefined), ...keys.filter((key) => cursors[key] === undefined)];
  while (open.size) {
    for (const key of order) {
      if (!open.has(key)) continue;
      const at = from[key] + taken[key].length, item = lists[key]![at];
      if (item === undefined || taken[key].length >= size) { open.delete(key); continue; }
      const weight = bytes(item) + 1;
      if (used + weight > TOOL_RESULT_MAX_BYTES) { open.delete(key); continue; }
      taken[key].push(item); used += weight;
    }
  }
  // Nothing at all fitted although something was asked for: one item alone is larger than the answer may be.
  if (keys.some((key) => from[key] < lists[key]!.length) && keys.every((key) => !taken[key].length)) fail("RESULT_TOO_LARGE", "One item is larger than the 32 KiB result limit.", {});
  return { ...base, ...Object.fromEntries(keys.flatMap((key) => { const next = from[key] + taken[key].length; return [[key, taken[key]], [`${key}Total`, lists[key]!.length], ...(next < lists[key]!.length ? [[NEXT[key], String(next)]] : [])]; })) };
}
const castViews = (film: fm.Film): Pick<Record<Collection, unknown[]>, "characters" | "locations" | "props"> => ({
  characters: film.characters.map((entry) => ({ id: entry.id, name: entry.name, role: entry.role, age: entry.age, description: entry.description, appearance: entry.appearance, voiceId: entry.voiceId, confirmed: entry.confirmed, picture: pictureView(entry.picture) })),
  locations: film.locations.map((entry) => ({ id: entry.id, name: entry.name, description: entry.description, appearance: entry.appearance, picture: pictureView(entry.picture) })),
  props: film.props.map((entry) => ({ id: entry.id, name: entry.name, description: entry.description, appearance: entry.appearance, picture: pictureView(entry.picture) })),
});
/** The scenes of the film with their shots and voice lines, every id included — each list a page of the one answer. */
function scenesView(film: fm.Film, limit: number | undefined, cursors: Cursors): Record<string, unknown> {
  return fitted({ filmId: film.id, revision: film.revision, part: "scenes" }, { scenes: sceneViews(film), shots: shotViews(film), lines: film.lines.map(lineView) }, limit, cursors);
}
/** The cast: characters, locations and props, each a page of the one answer. */
function castView(film: fm.Film, limit: number | undefined, cursors: Cursors): Record<string, unknown> {
  return fitted({ filmId: film.id, revision: film.revision, part: "cast" }, castViews(film), limit, cursors);
}
/** The characters of a story text that fit in `maxBytes` of the serialized page, counted the way JSON stores them (so
 *  a Japanese character costs 3 bytes and a quote or a newline 2, not 1). */
function pageEnd(text: string, from: number, maxBytes: number): number {
  let bytes = 0, to = from;
  while (to < text.length) {
    const char = String.fromCodePoint(text.codePointAt(to)!);
    const size = Buffer.byteLength(JSON.stringify(char)) - 2;
    if (bytes + size > maxBytes) break;
    bytes += size;
    to += char.length;
  }
  return to;
}
/** The story text as a page bounded by `limit` serialized bytes: `offset` and `nextOffset` are character indexes. */
function storyView(film: fm.Film, offset: number, limit: number): Record<string, unknown> {
  const text = film.sourceText, from = Math.min(offset, text.length), to = pageEnd(text, from, limit);
  return {
    filmId: film.id, revision: film.revision, part: "story", offset: from, limit,
    sourceText: text.slice(from, to), storyLength: text.length, storyTruncated: to < text.length || from > 0,
    ...(to < text.length ? { nextOffset: to } : {}),
  };
}

/** The film as an agent reads it: story, cast, scenes (the model's clips) and shots (its panels), every id included.
 *  The story text is a preview here (the "story" part pages the whole text), and EVERY list — characters, locations,
 *  props, scenes, shots, lines — is a page: the whole answer, envelope included, stays within the 32 KiB result. */
function filmView(film: fm.Film, limit: number | undefined, cursors: Cursors): Record<string, unknown> {
  const preview = film.sourceText.slice(0, STORY_PREVIEW_CHARS);
  return fitted({
    filmId: film.id, revision: film.revision, part: "overview",
    story: { title: film.title, logline: film.logline, synopsis: film.synopsis, sourceText: preview, description: film.description },
    storyLength: film.sourceText.length, storyTruncated: film.sourceText.length > preview.length,
    settings: { aspectRatio: film.aspectRatio, artStyle: film.artStyle, artStyleText: film.artStyleText, language: film.language, frameRate: film.frameRate, captions: film.captions },
    music: film.music.mood, stale: film.stale, scriptStale: film.scriptStale === true, project: film.project, pipelineRunId: film.pipelineRunId, spentUsd: film.spentUsd, counts: fm.counts(film),
  }, { ...castViews(film), scenes: sceneViews(film), shots: shotViews(film), lines: film.lines.map(lineView) }, limit, cursors);
}

export const FILM_TOOLS: ToolDefinition[] = [
  defineTool({
    name: "jc_film_get", family: "film", readOnly: true, needsProject: false, readsAmbientState: true, kind: "read", available,
    description: "Read the film, every id included. The whole answer stays within 32 KiB. Parts: \"overview\" (default: story preview, settings and a page of every list), \"story\" (the text, paged with offset/limit), \"cast\" (characters, locations, props), \"scenes\" (scenes, shots, lines). Every list is a page with its total (shotsTotal, …). More: nextCursor → cursor (shots), nextLineCursor → lineCursor (lines), nextCharacterCursor / nextLocationCursor / nextPropCursor / nextSceneCursor → cursors.characters / .locations / .props / .scenes. A film-bound session may leave filmId out.",
    shape: { ...FILM, part: z.enum(["overview", "story", "cast", "scenes"]).optional(), offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(16000).optional(), cursor: z.string().max(64).optional(), lineCursor: z.string().max(64).optional(), cursors: z.object({ characters: z.string().max(64).optional(), locations: z.string().max(64).optional(), props: z.string().max(64).optional(), scenes: z.string().max(64).optional() }).strict().optional() },
    handle: (ctx, args) => {
      const { film } = filmOf(ctx, args.filmId);
      if (args.part === "story") return storyView(film, args.offset ?? 0, args.limit ?? STORY_PAGE_DEFAULT);
      const cursors: Cursors = { ...args.cursors, ...(args.cursor !== undefined ? { shots: args.cursor } : {}), ...(args.lineCursor !== undefined ? { lines: args.lineCursor } : {}) };
      if (args.part === "scenes") return scenesView(film, args.limit, cursors);
      if (args.part === "cast") return castView(film, args.limit, cursors);
      return filmView(film, args.limit, cursors);
    },
  }),
  defineTool({
    name: "jc_film_update_story", family: "film", readOnly: false, needsProject: false, kind: "direct", available,
    description: "Change the story of the film: its title, its logline or the story text itself (`sourceText`). Stored on the host at once; the open Film Studio screen follows the film's change event. Editing the story after a script exists marks the later stages outdated; logline and synopsis are not edited here — a new breakdown rewrites them.",
    shape: { ...FILM, title: z.string().trim().min(1).max(fm.LIMITS.title).optional(), logline: z.string().max(300).optional(), sourceText: z.string().max(fm.LIMITS.sourceText).optional(), ...WRITE },
    refine: (args) => { if (args.title === undefined && args.logline === undefined && args.sourceText === undefined) fail("INVALID_PARAMS", "Name at least one of title, logline or sourceText."); },
    handle(ctx, args) {
      const { id: filmId } = filmOf(ctx, args.filmId), fields: fm.FilmFields = {}, changed: string[] = [];
      if (args.title !== undefined) { fields.title = args.title; changed.push("title"); }
      if (args.logline !== undefined) { fields.logline = args.logline; changed.push("logline"); }
      if (args.sourceText !== undefined) { fields.sourceText = args.sourceText; changed.push("sourceText"); }
      if (ctx.dryRun) return { data: { filmId, provisional: true, changed }, summary: `Would change the film's ${changed.join(", ")}.` };
      const film = change(ctx, filmId, [{ op: "film.set", fields }]);
      return { data: { filmId, revision: film.revision, changed }, revision: film.revision, summary: `Changed the film's ${changed.join(", ")}.` };
    },
  }),
  defineTool({
    name: "jc_film_upsert_character", family: "film", readOnly: false, needsProject: false, kind: "direct", available,
    description: "Create or change a character of the film: name, role (lead, supporting, extra), age, description and the appearance words every picture of the character is drawn from. With id the character is changed; without, one is added (then name is required).",
    shape: { ...FILM, id: id().optional(), name: z.string().trim().min(1).max(fm.LIMITS.name).optional(), role: z.enum(fm.CHARACTER_ROLES).optional(), age: z.string().max(40).optional(), description: z.string().max(fm.LIMITS.text).optional(), appearance: z.string().max(fm.LIMITS.text).optional(), voiceId: z.string().max(80).optional(), confirmed: z.boolean().optional(), ...WRITE },
    refine: (args) => {
      if (args.id === undefined && args.name === undefined) fail("INVALID_PARAMS", "name is required to add a character.", { field: "name" });
      if (args.id !== undefined && CHARACTER_FIELDS.every((field) => (args as Record<string, unknown>)[field] === undefined)) fail("INVALID_PARAMS", "Name at least one character field to change.");
    },
    handle(ctx, args) {
      const { id: filmId, film } = filmOf(ctx, args.filmId), fields: CharacterFields = {};
      for (const field of CHARACTER_FIELDS) { const value = (args as Record<string, unknown>)[field]; if (value !== undefined) (fields as Record<string, unknown>)[field] = value; }
      const exists = args.id !== undefined && film.characters.some((entry) => entry.id === args.id);
      if (args.id !== undefined && !exists) fail("NOT_FOUND", "This character is no longer in the film.", { id: args.id });
      const op: fm.FilmOp = exists ? { op: "asset.update", kind: "character", id: args.id!, fields } : { op: "asset.add", kind: "character", fields };
      if (ctx.dryRun) return { data: { filmId, characterId: args.id ?? null, created: !exists, provisional: true }, summary: `${exists ? "Would change" : "Would add"} the character ${JSON.stringify(clip(args.name ?? args.id ?? "", 60))}.` };
      const made = change(ctx, filmId, [op]), characterId = args.id ?? addedId(film.characters, made.characters);
      const name = made.characters.find((entry) => entry.id === characterId)!.name;
      return { data: { filmId, characterId, created: !exists, revision: made.revision }, revision: made.revision, summary: `${exists ? "Changed" : "Added"} the character “${clip(name, 60)}”.` };
    },
  }),
  defineTool({
    name: "jc_film_delete_character", family: "film", readOnly: false, needsProject: false, kind: "direct", available,
    description: "Delete a character from the film. The user is asked to allow it first: the call answers APPROVAL_PENDING, and after they allow it the same call (same parameters and idempotencyKey) carries it out. Lines the character speaks fall back to the narrator.",
    shape: { ...FILM, id: id(), ...WRITE },
    handle(ctx, args) {
      const { id: filmId, film } = filmOf(ctx, args.filmId), character = film.characters.find((entry) => entry.id === args.id) ?? fail("NOT_FOUND", "This character is no longer in the film.", { id: args.id });
      const lines = film.lines.filter((entry) => entry.speakerId === args.id).length;
      ctx.permit({ toolLabel: `Delete the character “${clip(character.name, 60)}”`, detail: `The character and its reference picture are removed from the film.${lines ? ` ${lines} line(s) spoken by them fall back to the narrator.` : ""}` });
      if (!ctx.dryRun) change(ctx, filmId, [{ op: "asset.remove", kind: "character", id: args.id }]);
      return { data: { filmId, characterId: args.id, name: character.name, ...(ctx.dryRun ? { provisional: true } : {}) }, summary: `Deleted the character “${clip(character.name, 60)}”.` };
    },
  }),
  defineTool({
    name: "jc_film_upsert_scene", family: "film", readOnly: false, needsProject: false, kind: "direct", available,
    description: "Create or change a scene of the film (a storyboard group; the model's clip): its title. With id the scene is renamed; without, one is added at the end (then title is required). Shots belong to a scene; reorder scenes with jc_film_reorder_scenes.",
    shape: { ...FILM, id: id().optional(), title: z.string().trim().min(1).max(200).optional(), ...WRITE },
    refine: (args) => {
      if (args.id === undefined && args.title === undefined) fail("INVALID_PARAMS", "title is required to add a scene.", { field: "title" });
      if (args.id !== undefined && args.title === undefined) fail("INVALID_PARAMS", "Name the scene's new title.", { field: "title" });
    },
    handle(ctx, args) {
      const { id: filmId, film } = filmOf(ctx, args.filmId), exists = args.id !== undefined && film.clips.some((entry) => entry.id === args.id);
      if (args.id !== undefined && !exists) fail("NOT_FOUND", "This scene is no longer in the film.", { id: args.id });
      const op: fm.FilmOp = exists ? { op: "clip.update", id: args.id!, title: args.title! } : { op: "clip.add", title: args.title! };
      if (ctx.dryRun) return { data: { filmId, sceneId: args.id ?? null, created: !exists, provisional: true }, summary: `${exists ? "Would rename" : "Would add"} the scene “${clip(args.title ?? "", 60)}”.` };
      const made = change(ctx, filmId, [op]), sceneId = args.id ?? addedId(film.clips, made.clips), title = made.clips.find((entry) => entry.id === sceneId)!.title;
      return { data: { filmId, sceneId, created: !exists, revision: made.revision }, revision: made.revision, summary: `${exists ? "Renamed" : "Added"} the scene “${clip(title, 60)}”.` };
    },
  }),
  defineTool({
    name: "jc_film_delete_scene", family: "film", readOnly: false, needsProject: false, kind: "direct", available,
    description: "Delete a scene of the film (the model's clip) and its shots. The user is asked to allow it first: the call answers APPROVAL_PENDING, and after they allow it the same call (same parameters and idempotencyKey) carries it out. Voice lines bound to its shots are unbound.",
    shape: { ...FILM, id: id(), ...WRITE },
    handle(ctx, args) {
      const { id: filmId, film } = filmOf(ctx, args.filmId), scene = film.clips.find((entry) => entry.id === args.id) ?? fail("NOT_FOUND", "This scene is no longer in the film.", { id: args.id });
      const shots = film.panels.filter((entry) => entry.clipId === args.id).length;
      ctx.permit({ toolLabel: `Delete the scene “${clip(scene.title, 60)}”`, detail: `The scene and its ${shots} shot(s) are removed from the film; voice lines bound to those shots are unbound.` });
      if (!ctx.dryRun) change(ctx, filmId, [{ op: "clip.remove", id: args.id }]);
      return { data: { filmId, sceneId: args.id, title: scene.title, shots, ...(ctx.dryRun ? { provisional: true } : {}) }, summary: `Deleted the scene “${clip(scene.title, 60)}”.` };
    },
  }),
  defineTool({
    name: "jc_film_reorder_scenes", family: "film", readOnly: false, needsProject: false, kind: "direct", available,
    description: "Reorder the scenes of the film to the given order. List every scene id exactly once; shots keep their scene. An assembled timeline is marked outdated, since panels are laid out in scene order.",
    shape: { ...FILM, ids: z.array(id()).min(1).max(fm.LIMITS.clips), ...WRITE },
    refine: (args) => { if (new Set(args.ids).size !== args.ids.length) fail("INVALID_PARAMS", "List every scene exactly once: an id appears twice.", { field: "ids" }); },
    handle(ctx, args) {
      const { id: filmId, film } = filmOf(ctx, args.filmId);
      // Every id is checked before the count and before a dry run: a scene that is gone is NOT_FOUND, never a count error.
      const known = new Set(film.clips.map((entry) => entry.id));
      const missing = args.ids.find((entry) => !known.has(entry));
      if (missing !== undefined) fail("NOT_FOUND", "This scene is no longer in the film.", { id: missing });
      if (args.ids.length !== film.clips.length) fail("INVALID_PARAMS", `List every scene exactly once: the film has ${film.clips.length} scene(s).`, { field: "ids" });
      if (ctx.dryRun) return { data: { filmId, provisional: true, ids: args.ids }, summary: "Would reorder the film's scenes." };
      const made = host(ctx).reorderClips(filmId, args.ids);
      return { data: { filmId, revision: made.revision, ids: made.clips.map((entry) => entry.id) }, revision: made.revision, summary: `Reordered the film's ${made.clips.length} scene(s).` };
    },
  }),
  defineTool({
    name: "jc_film_upsert_shot", family: "film", readOnly: false, needsProject: false, kind: "direct", available,
    description: "Create or change a shot of the film (a storyboard frame; the model's panel): its scene, duration in ticks (120000 per second), shot size, camera motion, action, characters, location, props and video prompt. With id the shot is changed; without, one is added to clipId (then required).",
    shape: {
      ...FILM, id: id().optional(), clipId: id().optional(), afterId: id().optional(), duration_ticks: ticks().optional(), shotSize: z.enum(fm.SHOT_SIZES).optional(), cameraMotion: z.enum(fm.CAMERA_MOTIONS).optional(),
      action: z.string().trim().min(1).max(fm.LIMITS.text).optional(), characterIds: z.array(id()).max(8).optional(), locationId: id().nullable().optional(), propIds: z.array(id()).max(8).optional(), videoPrompt: z.string().max(2000).optional(), ...WRITE,
    },
    refine: (args) => {
      if (args.id === undefined && args.clipId === undefined) fail("INVALID_PARAMS", "clipId is required to add a shot.", { field: "clipId" });
      if (args.id !== undefined && args.clipId !== undefined) fail("INVALID_PARAMS", "Use id to change a shot or clipId to add one, not both.", { field: "clipId" });
      if (args.id !== undefined && SHOT_FIELDS.every((field) => (args as Record<string, unknown>)[field] === undefined)) fail("INVALID_PARAMS", "Name at least one shot field to change.");
    },
    handle(ctx, args) {
      const { id: filmId, film } = filmOf(ctx, args.filmId), fields: ShotFields = {};
      for (const field of SHOT_FIELDS) { const value = (args as Record<string, unknown>)[field]; if (value !== undefined) (fields as Record<string, unknown>)[field] = value; }
      const exists = args.id !== undefined && film.panels.some((entry) => entry.id === args.id);
      if (args.id !== undefined && !exists) fail("NOT_FOUND", "This shot is no longer in the film.", { id: args.id });
      if (args.id === undefined && !film.clips.some((entry) => entry.id === args.clipId)) fail("NOT_FOUND", "This scene is no longer in the film.", { id: args.clipId });
      requireShotRefs(film, args);
      const op: fm.FilmOp = exists ? { op: "panel.update", id: args.id!, fields } : { op: "panel.add", clipId: args.clipId!, ...(args.afterId ? { afterId: args.afterId } : {}), fields };
      if (ctx.dryRun) return { data: { filmId, shotId: args.id ?? null, clipId: args.clipId ?? null, created: !exists, provisional: true }, summary: `${exists ? "Would change" : "Would add"} a shot${exists ? "" : ` to scene ${JSON.stringify(args.clipId)}`}.` };
      const made = change(ctx, filmId, [op]), ordered = fm.orderedPanels(made), shotId = args.id ?? addedId(film.panels, made.panels);
      const index = ordered.findIndex((entry) => entry.id === shotId) + 1, clipId = made.panels.find((entry) => entry.id === shotId)!.clipId;
      return { data: { filmId, shotId, clipId, index, created: !exists, revision: made.revision }, revision: made.revision, summary: `${exists ? "Changed" : "Added"} shot ${index} of the film.` };
    },
  }),
  defineTool({
    name: "jc_film_delete_shot", family: "film", readOnly: false, needsProject: false, kind: "direct", available,
    description: "Delete a shot of the film (the model's panel). The user is asked to allow it first: the call answers APPROVAL_PENDING, and after they allow it the same call (same parameters and idempotencyKey) carries it out. Voice lines bound to the shot are unbound.",
    shape: { ...FILM, id: id(), ...WRITE },
    handle(ctx, args) {
      const { id: filmId, film } = filmOf(ctx, args.filmId), shot = film.panels.find((entry) => entry.id === args.id) ?? fail("NOT_FOUND", "This shot is no longer in the film.", { id: args.id });
      const index = fm.orderedPanels(film).findIndex((entry) => entry.id === args.id) + 1, lines = film.lines.filter((entry) => entry.panelId === args.id).length;
      ctx.permit({ toolLabel: `Delete shot ${index}`, detail: `The shot and its image are removed from the film;${lines ? ` ${lines} voice line(s) bound to it are unbound.` : " no voice line is bound to it."}` });
      if (!ctx.dryRun) change(ctx, filmId, [{ op: "panel.remove", id: args.id }]);
      return { data: { filmId, shotId: args.id, clipId: shot.clipId, index, ...(ctx.dryRun ? { provisional: true } : {}) }, summary: `Deleted shot ${index} of the film.` };
    },
  }),
];
