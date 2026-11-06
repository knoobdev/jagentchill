import {
  SCRIPT_ASPECT_RATIOS, SHOT_ANGLES, SHOT_MOVEMENTS, SHOT_SIZES,
  type ScriptAct, type ScriptBeat, type ScriptDocument, type ScriptEntity, type ScriptLine, type ScriptMeta, type ScriptScene, type ScriptShot,
} from "@jagentchill/protocol";
import type { ScriptContent } from "./commands.ts";
import { shotTicks, TICKS_PER_SECOND } from "./estimate.ts";
import { clone, entityName, newBeat, newEntity, newLine, newScene, newShot, sceneLines, speakerOf, type ScriptIds } from "./model.ts";

/**
 * Fountain, with the product's conventions that stay valid Fountain (`script-studio.Plain-text mode with screenplay
 * conventions`): narration as a `(V.O.)` cue, on-screen text as `SUPER:` / `TITLE:`, a shot as a `[[SHOT …]]` note
 * before the first line it covers. Text that cannot be parsed is never rejected: it becomes action.
 */
const HEADING = /^(INT\.?\/EXT\.?|I\/E\.?|INT\.|EXT\.|EST\.)(?:\s+|$)/i;
const isHeading = (line: string): boolean => HEADING.test(line) || /^\.[^.\s]/.test(line) || line === ".-";
const isTransition = (line: string): boolean => /^[^a-z]*\bTO:$/.test(line) && /[A-Z]/.test(line);
const isUpper = (line: string): boolean => /\p{Lu}/u.test(line) && !/\p{Ll}/u.test(line);
const cueName = (line: string): string => line.replace(/\^\s*$/, "").replace(/\s*\([^)]*\)\s*/g, " ").trim();
const SHOT_NOTE = /^\[\[SHOT\s+([\d.]*)\s*:\s*([^,\]]*),\s*([^,\]]*),\s*([^,\]]*),\s*([\d.]+)s(?:\s+—\s*([\s\S]*))?\]\]$/;
const SETTINGS: Record<string, ScriptScene["heading"]["setting"]> = { "INT.": "INT", "EXT.": "EXT", "EST.": "EXT" };

export const hasSceneHeading = (text: string): boolean => text.split(/\r?\n/).some((line) => isHeading(line.trim()) && !/^\.\.\./.test(line.trim()));
export function parseHeading(line: string): ScriptScene["heading"] & { forced: boolean } {
  const trimmed = line.trim().replace(/\s*#[^#]*#\s*$/, "");
  const match = HEADING.exec(trimmed);
  const prefix = match ? match[1].toUpperCase() : "";
  const rest = match ? trimmed.slice(match[0].length) : trimmed === ".-" ? "" : trimmed.replace(/^\./, "");
  const cut = rest.lastIndexOf(" - ") >= 0 ? rest.lastIndexOf(" - ") : rest.lastIndexOf(" – ");
  const setting = !match ? "NONE" : SETTINGS[prefix.endsWith(".") ? prefix : `${prefix}.`] ?? (prefix.includes("/") ? "INT_EXT" : "NONE");
  return { setting, locationText: (cut >= 0 ? rest.slice(0, cut) : rest).trim().slice(0, 120), timeOfDay: (cut >= 0 ? rest.slice(cut + 3) : "").trim().slice(0, 40), forced: !match };
}

export type FountainOptions = {
  ids: ScriptIds;
  /** The document the text was produced from: ids, links and every field with no text form are kept where the text is unchanged. */
  previous?: ScriptDocument;
  language?: string;
};
export type ParsedScript = ScriptContent & { warnings: string[] };
type Pending = { size: ScriptShot["size"]; angle: ScriptShot["angle"]; movement: ScriptShot["movement"]; description: string };
const pick = <T extends string>(values: readonly T[], value: string, fallback: T): T => (values.includes(value.trim() as T) ? (value.trim() as T) : fallback);

export function parseFountain(source: string, options: FountainOptions): ParsedScript {
  const { ids, previous } = options;
  const text = source.replace(/\r\n?/g, "\n").replace(/^﻿/, "");
  const raw = text.split("\n");
  const meta: Partial<ScriptMeta> = {};
  let title: string | undefined, start = 0;
  // Title page: `Key: value` pairs up to the first blank line.
  if (/^[A-Za-z][A-Za-z ]*:/.test(raw[0] ?? "") && !isHeading(raw[0].trim()) && !/^(SUPER|TITLE):/i.test(raw[0]) || /^Title:/i.test(raw[0] ?? "")) {
    let key = "";
    const pairs = new Map<string, string>();
    for (; start < raw.length && raw[start].trim() !== ""; start++) {
      const pair = /^([A-Za-z][A-Za-z ]*):\s*(.*)$/.exec(raw[start]);
      if (pair && !/^\s/.test(raw[start])) { key = pair[1].trim().toLowerCase(); pairs.set(key, pair[2].trim()); }
      else if (key) pairs.set(key, [pairs.get(key), raw[start].trim()].filter(Boolean).join(" "));
    }
    const get = (name: string) => pairs.get(name);
    if (get("title")) title = get("title")!.replace(/\*\*|\*|_/g, "").slice(0, 120);
    if (get("author") ?? get("authors")) meta.author = (get("author") ?? get("authors"))!.slice(0, 120);
    if (get("logline")) meta.logline = get("logline")!.slice(0, 300);
    if (get("language")) meta.language = get("language")!.slice(0, 35);
    if (get("notes")) meta.notes = get("notes")!.slice(0, 4000);
    if (get("tone")) meta.tone = get("tone")!.slice(0, 200);
    if (get("audience")) meta.audience = get("audience")!.slice(0, 200);
    const ratio = get("aspect ratio"); if (ratio && (SCRIPT_ASPECT_RATIOS as readonly string[]).includes(ratio)) meta.aspectRatio = ratio as ScriptMeta["aspectRatio"];
    const target = Number(get("target duration")?.replace(/s$/, "")); if (target >= 5 && target <= 10_800) meta.targetDuration_s = target;
    const pace = get("pace"); if (pace === "slow" || pace === "normal" || pace === "fast") meta.pace = pace;
    if (get("tags")) meta.tags = get("tags")!.split(",").map((tag) => tag.trim().slice(0, 24)).filter(Boolean).slice(0, 10);
  }
  const acts: ScriptAct[] = [], scenes: ScriptScene[] = [];
  const characters: ScriptEntity[] = clone(previous?.entities.characters ?? []);
  let actId: string | undefined, scene: ScriptScene | null = null, beat: ScriptBeat | null = null, pending: Pending[] = [], omitNext = false;
  const flushPending = (target: ScriptScene | null) => { if (target) for (const shot of pending) target.shots.push(newShot(ids, { ...shot })); pending = []; };
  const open = (heading?: ScriptScene["heading"]): ScriptScene => {
    flushPending(scene);
    scene = newScene(ids, { ...(heading ? { heading } : {}), ...(actId ? { actId } : {}) });
    beat = scene.beats[0];
    scenes.push(scene);
    return scene;
  };
  const here = (): { scene: ScriptScene; beat: ScriptBeat } => { if (!scene || !beat) open(); return { scene: scene!, beat: beat! }; };
  const push = (line: ScriptLine) => {
    const at = here();
    at.beat.lines.push(line);
    for (const shot of pending) at.scene.shots.push(newShot(ids, { ...shot, lineIds: [line.id], beatId: at.beat.id }));
    pending = [];
  };
  const character = (name: string): string => {
    let entity = characters.find((entry) => entry.name.toLowerCase() === name.toLowerCase() || entry.aliases.some((alias) => alias.toLowerCase() === name.toLowerCase()));
    if (!entity) { entity = newEntity(ids, name.slice(0, 60), (characters.length % 8) + 1); characters.push(entity); }
    return entity.id;
  };
  // Boneyard is kept, hidden from the story, as a note that serialises back to `/* … */`.
  const lines = text.split("\n").slice(start);
  const blank = (index: number): boolean => index < 0 || index >= lines.length || lines[index].trim() === "";
  for (let index = 0; index < lines.length; index++) {
    const full = lines[index], line = full.trim();
    if (line === "") continue;
    if (line.startsWith("/*")) {
      const block: string[] = [];
      for (; index < lines.length; index++) { block.push(lines[index]); if (lines[index].includes("*/")) break; }
      push(newLine(ids, "visual_note", block.join("\n").trim().slice(0, 600)));
      continue;
    }
    if (/^={3,}$/.test(line)) continue;
    if (/^#{1}\s/.test(line) || line === "#") {
      const name = line.replace(/^#\s*/, "");
      if (name === "-" || name === "") actId = undefined; else { const act: ScriptAct = { id: ids(), title: name.slice(0, 80), summary: "" }; acts.push(act); actId = act.id; }
      flushPending(scene); scene = null; beat = null;
      continue;
    }
    if (/^#{2,}\s/.test(line)) {
      const label = line.replace(/^#+\s*/, ""), at = here();
      const name = label === "-" ? "" : label.slice(0, 60);
      // The first beat of a scene takes the first label; every further `##` starts a beat.
      if (at.scene.beats.length === 1 && at.beat.lines.length === 0 && !at.beat.label && !at.beat.intent) at.beat.label = name;
      else { beat = newBeat(ids, name); at.scene.beats.push(beat); }
      continue;
    }
    if (/^=(?!=)/.test(line)) {
      const summary = line.replace(/^=\s*/, ""), at = here();
      if (at.scene.beats.length === 1 && at.beat.lines.length === 0 && !at.beat.label && !at.scene.summary) at.scene.summary = summary.slice(0, 500);
      else if (acts.length && !scene) acts[acts.length - 1].summary = summary.slice(0, 500);
      else at.beat.intent = [at.beat.intent, summary].filter(Boolean).join(" ").slice(0, 300);
      continue;
    }
    if (isHeading(line) && blank(index - 1) && !line.startsWith("...")) {
      const { forced: _forced, ...heading } = parseHeading(line);
      open(heading);
      // An exported file names an omitted scene by a forced heading "OMITTED".
      if (_forced && heading.locationText === "OMITTED" && !heading.timeOfDay) { scene!.omitted = true; scene!.heading.locationText = ""; }
      if (omitNext) { scene!.omitted = true; omitNext = false; }
      continue;
    }
    if (line === "[[OMITTED]]") { if (scene && sceneLines(scene).length === 0) (scene as ScriptScene).omitted = true; else omitNext = true; continue; }
    const shot = SHOT_NOTE.exec(line);
    if (shot) { pending.push({ size: pick(SHOT_SIZES, shot[2], "medium"), angle: pick(SHOT_ANGLES, shot[3], "eye-level"), movement: pick(SHOT_MOVEMENTS, shot[4], "static"), description: (shot[6] ?? "").trim().slice(0, 800) }); continue; }
    if (/^\[\[[\s\S]*\]\]$/.test(line)) {
      const body = line.slice(2, -2).trim(), sound = /^SOUND:\s*/i.exec(body);
      push(newLine(ids, sound ? "sound_note" : "visual_note", (sound ? body.slice(sound[0].length) : body).slice(0, 600)));
      continue;
    }
    if (/^>.*<$/.test(line)) { push(newLine(ids, "action", line)); continue; }
    if ((line.startsWith(">") || isTransition(line)) && blank(index - 1) && blank(index + 1)) { push(newLine(ids, "transition", line.replace(/^>\s*/, "").slice(0, 600))); continue; }
    const forcedCue = line.startsWith("@");
    if ((forcedCue || (isUpper(cueName(line)) && !line.startsWith("!"))) && blank(index - 1) && !blank(index + 1)) {
      const cue = forcedCue ? line.slice(1) : line, name = cueName(cue), dual = /\^\s*$/.test(cue), voiceOver = /\(\s*V\.?O\.?\s*\)/i.test(cue);
      const speaker = voiceOver && name.toUpperCase() === "NARRATOR" ? undefined : name;
      let parenthetical: string | undefined, body: string[] = [];
      const emit = () => {
        if (body.length === 0 && parenthetical === undefined) return;
        const entry = newLine(ids, voiceOver ? "narration" : "dialogue", body.join("\n").slice(0, 4000));
        if (speaker) entry.characterId = character(speaker);
        if (parenthetical !== undefined) entry.parenthetical = parenthetical.slice(0, 120);
        if (dual) entry.dual = true;
        push(entry); parenthetical = undefined; body = [];
      };
      for (index++; index < lines.length && (lines[index].trim() !== "" || lines[index] === "  "); index++) {
        const part = lines[index].trim();
        if (/^\(.*\)$/.test(part)) { emit(); parenthetical = part.slice(1, -1); } else body.push(part);
      }
      emit();
      continue;
    }
    // Action: the paragraph up to the next blank line.
    const paragraph: string[] = [];
    for (; index < lines.length && lines[index].trim() !== ""; index++) paragraph.push(lines[index].replace(/\s+$/, ""));
    index--;
    const body = paragraph.join("\n").replace(/^!/, "").replace(/^\s+/, ""), onScreen = /^(SUPER|TITLE):\s*/i.exec(body);
    if (onScreen) push(newLine(ids, "on_screen_text", body.slice(onScreen[0].length).replace(/\n/g, " ").slice(0, 200)));
    else push(newLine(ids, "action", body.slice(0, 4000)));
  }
  flushPending(scene);
  if (scenes.length === 0) open();
  const base = previous ?? null;
  const content: ParsedScript = {
    title: title ?? base?.title ?? "Untitled script",
    meta: { ...(base?.meta ?? { logline: "", synopsis: "", genre: [], tone: "", audience: "", language: options.language ?? "en", aspectRatio: "9:16", formatId: "blank", pace: "normal", author: "", notes: "", tags: [] }), ...meta } as ScriptMeta,
    acts, scenes, entities: { characters, locations: clone(base?.entities.locations ?? []), props: clone(base?.entities.props ?? []) },
    ...(base?.constraints ? { constraints: clone(base.constraints) } : {}), warnings: [],
  };
  if (previous) reconcile(content, previous);
  return content;
}

/** Gives the parsed content the ids of the document it came from, wherever the text still corresponds. */
function reconcile(content: ScriptContent, previous: ScriptDocument): void {
  const actByTitle = new Map(previous.acts.map((act) => [act.title, act]));
  const actIds = new Map<string, string>();
  for (const act of content.acts) { const old = actByTitle.get(act.title); if (old) { actByTitle.delete(act.title); actIds.set(act.id, old.id); act.id = old.id; if (!act.summary) act.summary = old.summary; } }
  const key = (document: Pick<ScriptDocument, "entities">, scene: ScriptScene) => `${scene.heading.setting}|${(entityName(document, "locations", scene.heading.locationId) ?? scene.heading.locationText).toUpperCase()}|${scene.heading.timeOfDay.toUpperCase()}|${sceneLines(scene)[0]?.text ?? ""}`;
  const unused = new Set(previous.scenes), pairs = new Map<ScriptScene, ScriptScene>();
  for (const scene of content.scenes) for (const old of unused) if (key(previous, old) === key(content, scene)) { pairs.set(scene, old); unused.delete(old); break; }
  content.scenes.forEach((scene, index) => { const old = previous.scenes[index]; if (!pairs.has(scene) && old && unused.has(old)) { pairs.set(scene, old); unused.delete(old); } });
  for (const scene of content.scenes) {
    if (scene.actId) scene.actId = actIds.get(scene.actId) ?? scene.actId;
    const old = pairs.get(scene);
    if (!old) continue;
    scene.id = old.id; scene.title = old.title;
    if (old.colorIndex) scene.colorIndex = old.colorIndex;
    if (old.durationOverride_ticks !== undefined) scene.durationOverride_ticks = old.durationOverride_ticks;
    if (old.sourceId) scene.sourceId = old.sourceId;
    const location = entityName(previous, "locations", old.heading.locationId);
    if (location && location.toUpperCase() === scene.heading.locationText.toUpperCase()) { scene.heading.locationId = old.heading.locationId; scene.heading.locationText = old.heading.locationText; }
    scene.beats.forEach((beat, index) => { const before = old.beats[index]; if (before) { beat.id = before.id; if (before.sourceId) beat.sourceId = before.sourceId; } });
    const fresh = sceneLines(scene), oldLines = sceneLines(old), free = new Set(oldLines), renamed = new Map<string, string>();
    const signature = (document: Pick<ScriptDocument, "entities">, line: ScriptLine) => `${line.kind}|${speakerOf(document, line).toUpperCase()}|${line.parenthetical ?? ""}|${line.text}`;
    const adopt = (line: ScriptLine, before: ScriptLine) => {
      free.delete(before); renamed.set(line.id, before.id); line.id = before.id;
      for (const field of ["language", "needsCheck", "sourceRef", "sourceId"] as const) if (before[field] !== undefined) (line as Record<string, unknown>)[field] = before[field];
      // A speaker held as plain text stays plain text while the cue reads the same.
      if (before.speakerText && line.characterId && speakerOf(content, line).toUpperCase() === before.speakerText.toUpperCase()) { delete line.characterId; line.speakerText = before.speakerText; }
    };
    for (const line of fresh) for (const before of free) if (signature(previous, before) === signature(content, line)) { adopt(line, before); break; }
    fresh.forEach((line, index) => { const before = oldLines[index]; if (!renamed.has(line.id) && ![...renamed.values()].includes(line.id) && before && free.has(before) && before.kind === line.kind) adopt(line, before); });
    const ids = new Set(fresh.map((line) => line.id)), freeShots = new Set(old.shots);
    scene.shots.forEach((shot, index) => {
      shot.lineIds = shot.lineIds.map((id) => renamed.get(id) ?? id);
      const before = [...freeShots].find((entry) => entry.description === shot.description && old.shots.indexOf(entry) === index) ?? [...freeShots].find((entry) => entry.description === shot.description) ?? (old.shots[index] && freeShots.has(old.shots[index]) ? old.shots[index] : undefined);
      if (!before) return;
      freeShots.delete(before);
      const first = shot.lineIds[0], covered = before.lineIds.filter((id) => ids.has(id));
      Object.assign(shot, clone(before), { description: shot.description, size: shot.size, angle: shot.angle, movement: shot.movement, lineIds: first && !covered.includes(first) ? [first, ...covered].slice(0, 40) : covered });
      if (shot.beatId && !scene.beats.some((beat) => beat.id === shot.beatId)) delete shot.beatId;
    });
  }
  // A cue that names a character the script already has keeps that character; unused new ones are not invented twice.
  const used = new Set(content.scenes.flatMap((scene) => sceneLines(scene).map((line) => line.characterId)));
  content.entities.characters = content.entities.characters.filter((entity) => used.has(entity.id) || previous.entities.characters.some((old) => old.id === entity.id));
}

export type SerializeOptions = {
  titlePage?: boolean; shots?: boolean; notes?: boolean; sceneNumbers?: boolean;
  /** A file for other people: an omitted scene reads "OMITTED" and carries no content. The plain-text mode keeps everything. */
  forExport?: boolean; sceneIds?: readonly string[];
};
const cueOf = (name: string): string => { const upper = name.toUpperCase(); return isUpper(upper) ? upper : `@${name}`; };
const SETTING_OUT = { INT: "INT.", EXT: "EXT.", INT_EXT: "INT./EXT.", NONE: "" } as const;
/** The heading line of a scene, forced with `.` when it has no INT./EXT. prefix. */
export function fountainHeading(document: Pick<ScriptDocument, "entities">, scene: ScriptScene): string {
  const location = (entityName(document, "locations", scene.heading.locationId) ?? scene.heading.locationText).toUpperCase(), time = scene.heading.timeOfDay.toUpperCase();
  const tail = [location, time].filter(Boolean).join(" - ");
  return scene.heading.setting === "NONE" ? `.${tail || "-"}` : `${SETTING_OUT[scene.heading.setting]} ${tail}`.trim();
}
const needsForce = (text: string): boolean => {
  const first = text.split("\n")[0].trim();
  return isHeading(first) || isTransition(first) || /^[#=>~@!.]|^\[\[|^\/\*|^(SUPER|TITLE):/i.test(first) && !/^\.\.\./.test(first) || (isUpper(cueName(first)) && text.includes("\n"));
};
export function lineToFountain(document: Pick<ScriptDocument, "entities">, line: ScriptLine): string {
  switch (line.kind) {
    case "dialogue": case "narration": {
      const speaker = speakerOf(document, line), voiceOver = line.kind === "narration";
      const cue = `${cueOf(speaker || (voiceOver ? "NARRATOR" : "UNKNOWN"))}${voiceOver ? " (V.O.)" : ""}${line.dual ? " ^" : ""}`;
      const body = (line.text || "…").split("\n").map((part) => (part.trim() === "" ? "  " : part));
      return [cue, ...(line.parenthetical !== undefined ? [`(${line.parenthetical})`] : []), ...body].join("\n");
    }
    case "on_screen_text": return `SUPER: ${line.text}`;
    case "visual_note": return line.text.startsWith("/*") ? line.text : `[[${line.text}]]`;
    case "sound_note": return `[[SOUND: ${line.text}]]`;
    case "transition": return isTransition(line.text) ? line.text : `> ${line.text}`;
    default: return /^>.*<$/.test(line.text.trim()) ? line.text : needsForce(line.text) ? `!${line.text}` : line.text;
  }
}
export function serializeFountain(document: ScriptDocument, options: SerializeOptions = {}): string {
  const { titlePage = true, shots = true, notes = true } = options;
  const out: string[] = [];
  if (titlePage) {
    const page = [`Title: ${document.title}`];
    if (document.meta.author) page.push(`Author: ${document.meta.author}`);
    if (document.meta.logline) page.push(`Logline: ${document.meta.logline.replace(/\n/g, " ")}`);
    page.push(`Language: ${document.meta.language}`, `Aspect ratio: ${document.meta.aspectRatio}`, `Pace: ${document.meta.pace}`);
    if (document.meta.targetDuration_s !== undefined) page.push(`Target duration: ${document.meta.targetDuration_s}s`);
    if (document.meta.tags.length) page.push(`Tags: ${document.meta.tags.join(", ")}`);
    out.push(page.join("\n"));
  }
  let actId: string | undefined | null = null;
  document.scenes.forEach((scene, sceneIndex) => {
    if (options.sceneIds && !options.sceneIds.includes(scene.id)) return;
    if (scene.actId !== actId && (document.acts.length > 0)) {
      const act = document.acts.find((entry) => entry.id === scene.actId);
      if (act || actId) { out.push(`# ${act ? act.title || "-" : "-"}`); if (act?.summary) out.push(`= ${act.summary}`); }
      actId = scene.actId;
    }
    const heading = fountainHeading(document, scene);
    const headless = sceneIndex === 0 && heading === ".-" && !options.forExport && !scene.omitted;
    if (options.forExport && scene.omitted) { out.push(`.OMITTED${options.sceneNumbers ? ` #${sceneIndex + 1}#` : ""}`); return; }
    if (!headless) out.push(`${heading}${options.sceneNumbers ? ` #${sceneIndex + 1}#` : ""}`);
    if (scene.omitted) out.push("[[OMITTED]]");
    if (scene.summary) { if (headless) out.push(".-"); out.push(`= ${scene.summary.replace(/\n/g, " ")}`); }
    const emitted = new Set<string>();
    scene.beats.forEach((beat, beatIndex) => {
      if (beatIndex > 0 || beat.label || beat.intent) { out.push(`## ${beat.label || "-"}`); if (beat.intent) out.push(`= ${beat.intent.replace(/\n/g, " ")}`); }
      for (const line of beat.lines) {
        if (!notes && (line.kind === "visual_note" || line.kind === "sound_note")) continue;
        if (shots) for (const shot of scene.shots) if (shot.lineIds[0] === line.id && !emitted.has(shot.id)) { emitted.add(shot.id); out.push(shotNote(document, scene, shot, sceneIndex)); }
        out.push(lineToFountain(document, line));
      }
    });
    if (shots) for (const shot of scene.shots) if (!emitted.has(shot.id)) out.push(shotNote(document, scene, shot, sceneIndex));
  });
  return `${out.join("\n\n")}\n`;
}
const shotNote = (document: ScriptDocument, scene: ScriptScene, shot: ScriptShot, sceneIndex: number): string =>
  `[[SHOT ${sceneIndex + 1}.${scene.shots.indexOf(shot) + 1}: ${shot.size}, ${shot.angle}, ${shot.movement}, ${Number((shotTicks(document, scene, shot) / TICKS_PER_SECOND).toFixed(1))}s${shot.description ? ` — ${shot.description.replace(/\s*\n\s*/g, " ")}` : ""}]]`;

export type SplitMode = "blank-lines" | "headings" | "one";
/**
 * Prose with no scene heading: one scene, scenes at Markdown headings, or scenes at groups of blank lines (two or
 * more). Every paragraph becomes an action line and nothing is lost.
 */
export function parsePlainText(source: string, mode: SplitMode, options: FountainOptions): ParsedScript {
  const text = source.replace(/\r\n?/g, "\n").replace(/^﻿/, "");
  const chunks: { title: string; body: string }[] = [];
  if (mode === "headings") {
    let current = { title: "", body: "" };
    for (const line of text.split("\n")) { const heading = /^#{1,6}\s+(.*)$/.exec(line); if (heading) { if (current.title || current.body.trim()) chunks.push(current); current = { title: heading[1].trim(), body: "" }; } else current.body += `${line}\n`; }
    if (current.title || current.body.trim()) chunks.push(current);
  } else if (mode === "blank-lines") for (const body of text.split(/\n[ \t]*\n(?:[ \t]*\n)+/)) { if (body.trim()) chunks.push({ title: "", body }); }
  else chunks.push({ title: "", body: text });
  const parsed = parseFountain("", { ...options, previous: undefined });
  parsed.scenes = (chunks.length ? chunks : [{ title: "", body: "" }]).map((chunk) => {
    const scene = newScene(options.ids, { title: chunk.title.slice(0, 80) });
    scene.beats[0].lines = chunk.body.split(/\n[ \t]*\n/).map((paragraph) => paragraph.trim()).filter(Boolean).map((paragraph) => newLine(options.ids, "action", paragraph.slice(0, 4000)));
    return scene;
  });
  const first = text.split("\n").find((line) => line.trim());
  if (mode === "headings" && chunks.length === 1 && chunks[0].title) parsed.title = chunks[0].title.slice(0, 120);
  else if (first && first.trim().length <= 80 && /^#\s/.test(first)) parsed.title = first.replace(/^#\s+/, "").trim().slice(0, 120);
  return parsed;
}
