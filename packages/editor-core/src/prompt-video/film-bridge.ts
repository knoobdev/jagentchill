import { NARRATOR, activeTake, type Breakdown, type Film, type FilmFields, type FilmOp, type Line, type Panel } from "../film/model.ts";
import { STORYBOARD_ROUNDS } from "../film/template.ts";
import { ContractError, isSpoken, motionOf, type Brief, type Script, type Segment, type Shot, type ShotList, type ShotMedia, type Take } from "./contracts.ts";
import { narrated, type VideoParams } from "./params.ts";
import { readingSeconds } from "../script/estimate.ts";

/**
 * A video made from one prompt is drawn and spoken by the film engine: the run keeps a WORKING FILM (its shots as the
 * film's panels, its spoken segments as the film's lines), the film's own stages make the pictures and the recordings —
 * references, the picture check, one recording per speaker, the read-back check, consent, refusals — and what they made
 * is read back here as the run's artifacts. Pure: the mapping both ways, nothing else.
 */
export const PICTURE_ROUNDS = STORYBOARD_ROUNDS;

const CAMERA = { static: "static", pan: "pan-left", tilt: "tilt-up", "push-in": "push-in", "pull-out": "pull-out", track: "track", handheld: "handheld", orbit: "orbit" } as const;
const key = (text: string): string => text.trim().toLowerCase().replace(/\s+/g, " ");
const speakerId = (name: string): string => `sp_${[...key(name)].reduce((hash, char) => (Math.imul(hash, 31) + char.codePointAt(0)!) >>> 0, 7).toString(36)}`;

/** What a panel of the working film is asked to show: the shot's own words, where it is, and who or what is in it. */
export const shotAction = (shot: Pick<Shot, "description" | "setting" | "subjects">): string =>
  [shot.description, shot.setting && `Setting: ${shot.setting}.`, shot.subjects.length ? `In the picture: ${shot.subjects.join(", ")}.` : ""].filter(Boolean).join(" ").slice(0, 1200);

/**
 * The working film of a run, as the fields and the breakdown the film model takes. Shots of one setting are one scene
 * (the film draws a frame with the frame before it in its scene as a reference, so a place keeps its light and look);
 * every spoken segment is a line of the Narrator or of the character who says it, tied to the first shot that shows it.
 */
export function workingFilm(params: VideoParams, brief: Pick<Brief, "title" | "tone" | "visualStyle">, script: Script, shotList: ShotList): { fields: FilmFields; breakdown: Breakdown } {
  const scenes = new Map<string, string>(), count = new Map<string, number>(), clips: Breakdown["clips"] = [];
  const panels: Breakdown["panels"] = shotList.shots.map((shot) => {
    // A scene of the film holds at most 40 panels: a place with more shots continues as a new scene.
    let place = key(shot.setting) || `shot ${shot.index + 1}`;
    for (let part = 2; (count.get(place) ?? 0) >= 40; part++) place = `${key(shot.setting)} #${part}`;
    count.set(place, (count.get(place) ?? 0) + 1);
    if (!scenes.has(place)) { scenes.set(place, `scene_${scenes.size + 1}`); clips.push({ id: scenes.get(place)!, title: (shot.setting.trim() || `Shot ${shot.index + 1}`).slice(0, 120) }); }
    return { id: shot.id, clipId: scenes.get(place)!, duration_ticks: shot.duration_ticks, shotSize: shot.shotSize, cameraMotion: CAMERA[shot.cameraMotion], action: shotAction(shot), characterIds: [], locationId: null, propIds: [], videoPrompt: "" };
  });
  const owner = new Map<string, string>();
  for (const shot of shotList.shots) for (const id of shot.segmentIds) if (!owner.has(id)) owner.set(id, shot.id);
  const spoken = narrated(params) ? script.segments.filter(isSpoken) : [];
  const speakers = new Map<string, string>();
  for (const segment of spoken) if (segment.kind === "dialogue" && !speakers.has(key(segment.speaker))) speakers.set(key(segment.speaker), segment.speaker);
  return {
    fields: {
      title: brief.title.slice(0, 120), aspectRatio: params.aspectRatio, artStyle: "custom", artStyleText: brief.visualStyle.text.slice(0, 500), language: params.language, captions: params.captions,
      // The voice a person chose is the Narrator's; "auto" leaves the casting to the film.
      ...(params.voice !== "auto" && params.voice !== "none" ? { narratorVoiceId: params.voice, narratorVoiceAuto: false } : {}),
    },
    breakdown: {
      logline: brief.title, synopsis: "",
      characters: [...speakers.values()].map((name) => ({ id: speakerId(name), name: name.slice(0, 80), role: "supporting" as const, age: "", description: "", appearance: "", gender: "neutral" as const })),
      locations: [], props: [], clips, panels,
      lines: spoken.map((segment) => ({ id: segment.id, kind: segment.kind === "dialogue" ? "dialogue" as const : "narration" as const, speakerId: segment.kind === "dialogue" ? speakerId(segment.speaker) : NARRATOR, text: segment.text, panelId: owner.get(segment.id) ?? null, emotion: "" })),
    },
  };
}

/** The pictures of the run as the working film holds them: each shot's picture with the verdict of its check, or why it has none. */
export function shotMediaOfFilm(film: Pick<Film, "panels">, shotList: ShotList, costOf: (shotId: string) => number = () => 0): ShotMedia[] {
  return shotList.shots.map((shot) => {
    const panel = film.panels.find((entry) => entry.id === shot.id), version = panel?.picture.stale ? null : panel?.picture.current ?? null;
    return {
      shotId: shot.id, method: "image", prompt: shot.description, motion: motionOf(shot), media: version?.media ?? null, costUsd: version ? version.costUsd : costOf(shot.id),
      ...(version?.check ? { check: version.check } : {}), ...(version?.drawing ? { drawing: version.drawing } : {}),
      ...(panel?.refused ? { refused: { message: panel.refused.message, reason: panel.refused.reason ?? "policy" as const }, error: panel.refused.message } : {}),
      ...(panel?.leftOut ? { leftOut: true } : {}),
    };
  });
}

/** The recordings of the run as the working film holds them: the take each line uses, with what the listener said about it. */
export function takesOfFilm(film: Pick<Film, "lines">, script: Script): Take[] {
  return script.segments.flatMap((segment): Take[] => {
    const line = film.lines.find((entry) => entry.id === segment.id), take = line ? activeTake(line) : null;
    if (!take || take.stale) return [];
    return [{ segmentId: segment.id, media: { ...take.media, duration_ticks: take.duration_ticks }, ...(take.check ? { check: take.check } : {}), ...(take.unchecked ? { unchecked: take.unchecked } : {}), ...(take.voiceId ? { voiceId: take.voiceId } : {}) }];
  });
}

/**
 * The shot list without the shots a person left out. What such a shot showed is not lost: its segments go to the shot
 * before it (the one after it for the first), so every spoken line still has a picture under it.
 */
export function withoutLeftOut(shotList: ShotList, leftOut: readonly string[]): ShotList {
  if (!leftOut.length) return shotList;
  const gone = new Set(leftOut), kept = shotList.shots.filter((shot) => !gone.has(shot.id)).map((shot) => ({ ...shot, segmentIds: [...shot.segmentIds] }));
  if (!kept.length) return { shots: [] };
  for (const shot of shotList.shots) {
    if (!gone.has(shot.id)) continue;
    const heir = [...kept].reverse().find((entry) => entry.index < shot.index) ?? kept[0];
    for (const id of shot.segmentIds) if (!kept.some((entry) => entry.segmentIds.includes(id))) { if (heir.index < shot.index) heir.segmentIds.push(id); else heir.segmentIds.unshift(id); }
  }
  return { shots: kept.map((shot, index) => ({ ...shot, index })) };
}

/**
 * Narration carries the script: in a run with a voice, the words are SPOKEN. A script in which most segments are
 * silent, or a shot list in which most shots have nothing said under them, is sent back to the writer (a film made
 * that way was pictures with a few quoted lines and nobody telling the story).
 */
export function narrationProblems(params: Pick<VideoParams, "voice">, script: Pick<Script, "segments">, shotList?: ShotList): string[] {
  if (!narrated(params)) return [];
  const problems: string[] = [], spoken = script.segments.filter(isSpoken);
  if (!spoken.length) problems.push("the video has a voice but the script speaks nothing: write what the narrator says as segments of kind \"narration\"");
  else if (spoken.length * 2 < script.segments.length) problems.push(`${script.segments.length - spoken.length} of ${script.segments.length} segments are not spoken: the narrator tells the video — make them "narration" (a silent beat is the exception)`);
  if (shotList && spoken.length) {
    const voiced = new Set(spoken.map((segment) => segment.id)), silent = shotList.shots.filter((shot) => !shot.segmentIds.some((id) => voiced.has(id)));
    if (silent.length * 2 > shotList.shots.length) problems.push(`${silent.length} of ${shotList.shots.length} shots have nothing said under them (shots ${silent.slice(0, 12).map((shot) => shot.index + 1).join(", ")}): list a spoken segment in segmentIds of each`);
  }
  return problems;
}
export function assertNarration(what: "script" | "shot list", params: Pick<VideoParams, "voice">, script: Pick<Script, "segments">, shotList?: ShotList): void {
  const problems = narrationProblems(params, script, shotList);
  if (problems.length) throw new ContractError(`The ${what} is not valid`, problems);
}

const SENTENCE = /[^.!?。！？…\n]+[.!?。！？…]*["”’」)]*\s*/gu;
/**
 * A person's own script as the run's script: their words, in their order, cut into segments of one or two sentences —
 * nothing is rewritten. A line that starts with a name and a colon ("Mai: …") is that speaker's dialogue.
 */
export function scriptFromText(text: string, params: Pick<VideoParams, "language" | "voice">, title = "Script"): Script {
  const spokenRun = narrated(params), segments: Segment[] = [];
  const push = (kind: Segment["kind"], speaker: string, words: string): void => {
    const clean = words.replace(/\s+/g, " ").trim();
    if (!clean) return;
    // A piece longer than a segment holds is cut at a space.
    for (let rest = clean; rest; ) {
      let cut = rest.length <= 400 ? rest.length : rest.lastIndexOf(" ", 400);
      if (cut <= 0) cut = Math.min(400, rest.length);
      const part = rest.slice(0, cut).trim();
      rest = rest.slice(cut).trim();
      const shown = spokenRun ? kind : "on-screen-text";
      segments.push({ id: `seg_${segments.length + 1}`, beatLabel: "", kind: shown, speaker: shown === "dialogue" ? speaker : shown === "narration" ? "Narrator" : "", text: part, estimatedDuration_s: Math.max(0.5, Math.round(Math.max(shown === "on-screen-text" ? 2 : 0, readingSeconds(part, params.language)) * 10) / 10) });
    }
  };
  for (const paragraph of text.split(/\n+/)) {
    const named = /^\s*([\p{L}\p{N}][\p{L}\p{N} .'’-]{0,38}):\s+(.+)$/u.exec(paragraph);
    if (named) { push("dialogue", named[1].trim(), named[2]); continue; }
    const sentences = paragraph.match(SENTENCE) ?? [];
    // One or two sentences a segment: a short sentence joins the one before it.
    let held = "";
    for (const sentence of sentences) {
      if (held && (held.length + sentence.length > 220 || held.length > 90)) { push("narration", "", held); held = ""; }
      held += sentence;
    }
    push("narration", "", held);
  }
  if (!segments.length) throw new ContractError("The script is not valid", ["the script holds no words"]);
  if (segments.length > 500) throw new ContractError("The script is not valid", ["at most 500 segments: shorten the script"]);
  return { title: title.slice(0, 80) || "Script", language: params.language, segments };
}
/** How long a person's own script lasts as a video, in whole seconds: its reading time plus the room around the takes. */
export const scriptDuration_s = (script: Pick<Script, "segments">): number => Math.min(600, Math.max(5, Math.ceil(script.segments.reduce((sum, segment) => sum + segment.estimatedDuration_s + 0.4, 0))));

/**
 * The changes that bring a run's working film to what the run now says, entity by entity: a shot or a line whose words
 * changed is changed alone (the film marks its picture or its recording outdated; everything else stays as it is), a
 * new one is added, one that is gone is removed. Nothing that still holds is made again.
 */
export function filmSyncOps(film: Film, made: { fields: FilmFields; breakdown: Breakdown }): FilmOp[] {
  const ops: FilmOp[] = [], fields: Record<string, unknown> = {}, next = made.breakdown;
  for (const [name, value] of Object.entries(made.fields)) if ((name === "musicMood" ? film.music.mood : (film as unknown as Record<string, unknown>)[name]) !== value) fields[name] = value;
  if (Object.keys(fields).length) ops.push({ op: "film.set", fields: fields as FilmFields });
  const has = (list: readonly { id: string }[], id: string): boolean => list.some((entry) => entry.id === id);
  for (const entry of next.characters) if (!has(film.characters, entry.id)) ops.push({ op: "asset.add", kind: "character", id: entry.id, fields: { name: entry.name, role: entry.role, gender: entry.gender } });
  for (const clip of next.clips) { const before = film.clips.find((entry) => entry.id === clip.id); if (!before) ops.push({ op: "clip.add", id: clip.id, title: clip.title }); else if (before.title !== clip.title) ops.push({ op: "clip.update", id: clip.id, title: clip.title }); }
  for (const panel of film.panels) if (!has(next.panels, panel.id)) ops.push({ op: "panel.remove", id: panel.id });
  const placed = new Map<string, string[]>();
  for (const panel of next.panels) {
    const before = film.panels.find((entry) => entry.id === panel.id), siblings = placed.get(panel.clipId) ?? [], wanted = { duration_ticks: panel.duration_ticks, shotSize: panel.shotSize, cameraMotion: panel.cameraMotion, action: panel.action };
    if (!before) ops.push({ op: "panel.add", id: panel.id, clipId: panel.clipId, ...(siblings.length ? { afterId: siblings[siblings.length - 1] } : {}), fields: wanted });
    else {
      if (before.clipId !== panel.clipId) ops.push({ op: "panel.move", id: panel.id, clipId: panel.clipId, index: siblings.length });
      const changed = Object.fromEntries(Object.entries(wanted).filter(([name, value]) => (before as unknown as Record<string, unknown>)[name] !== value && name !== "duration_ticks"));
      if (Object.keys(changed).length) ops.push({ op: "panel.update", id: panel.id, fields: changed });
    }
    placed.set(panel.clipId, [...siblings, panel.id]);
  }
  for (const line of film.lines) if (!has(next.lines, line.id)) ops.push({ op: "line.remove", id: line.id });
  next.lines.forEach((line, index) => {
    const before = film.lines.find((entry) => entry.id === line.id), wanted = { kind: line.kind, speakerId: line.speakerId, text: line.text, panelId: line.panelId };
    if (!before) { ops.push({ op: "line.add", id: line.id, ...(index ? { afterId: next.lines[index - 1].id } : {}), fields: wanted }); return; }
    const changed = Object.fromEntries(Object.entries(wanted).filter(([name, value]) => (before as unknown as Record<string, unknown>)[name] !== value));
    if (Object.keys(changed).length) ops.push({ op: "line.update", id: line.id, fields: changed });
  });
  for (const clip of film.clips) if (!has(next.clips, clip.id)) ops.push({ op: "clip.remove", id: clip.id });
  for (const entry of film.characters) if (!has(next.characters, entry.id)) ops.push({ op: "asset.remove", kind: "character", id: entry.id });
  return ops;
}
/**
 * "Make this shot again" with the same words: the film draws a frame again when what it shows changed, so the frame's
 * size is changed and changed back — its words stay, its picture is outdated.
 */
export const redrawOps = (panel: Pick<Panel, "id" | "shotSize">): FilmOp[] => [{ op: "panel.update", id: panel.id, fields: { shotSize: panel.shotSize === "medium" ? "wide" : "medium" } }, { op: "panel.update", id: panel.id, fields: { shotSize: panel.shotSize } }];
/** The same for a line's recording: its pace is changed and changed back. */
export const rerecordOps = (line: Pick<Line, "id" | "rate">): FilmOp[] => [{ op: "line.update", id: line.id, fields: { rate: line.rate === 1 ? 1.01 : 1 } }, { op: "line.update", id: line.id, fields: { rate: line.rate } }];

/**
 * A script of the script studio as the text a run speaks ("Send to workflow…"): its narration as it is written, its
 * dialogue with the speaker's name before it, scene by scene. What is not spoken (action, notes, transitions) describes
 * pictures and is left to the shot list.
 */
export function spokenTextOfScript(document: { scenes: readonly { beats: readonly { lines: readonly { kind: string; text: string; characterId?: string; speakerText?: string }[] }[] }[]; entities: { characters: readonly { id: string; name: string }[] } }): string {
  const names = new Map(document.entities.characters.map((entry) => [entry.id, entry.name]));
  const out: string[] = [];
  for (const scene of document.scenes) for (const beat of scene.beats) for (const line of beat.lines) {
    const text = line.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (line.kind === "narration") out.push(text);
    // A cue's extension — "(O.S.)", "(V.O.)" — says where the voice comes from, not who speaks.
    else if (line.kind === "dialogue") out.push(`${((line.characterId && names.get(line.characterId)) || line.speakerText || "Speaker").replace(/\([^)]*\)/g, " ").replace(/[^\p{L}\p{N} .'’-]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 38) || "Speaker"}: ${text}`);
  }
  return out.join("\n");
}
