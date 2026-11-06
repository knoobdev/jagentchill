import {
  SCRIPT_TARGET_DURATION_S, SHOT_DURATION_TICKS,
  type ScriptAct, type ScriptBeat, type ScriptConstraints, type ScriptDocument, type ScriptEntity, type ScriptEntityKind, type ScriptLine, type ScriptLineKind, type ScriptMeta, type ScriptScene, type ScriptShot,
} from "@jagentchill/protocol";
import { canonicalJson } from "../canonical.ts";
import { assertLimits, clone, findBeat, findLine, findScene, findShot, newBeat, newEntity, newLine, newScene, newShot, sceneLines, ScriptError, validateScript, type ScriptIds } from "./model.ts";

/**
 * Every edit of a script is a command: it runs on a copy, the result is settled (a scene keeps at least one beat, a
 * shot covers lines of its own scene only), checked against the limits and the schema, and becomes one undo step.
 */
export type ScriptEnv = { ids: ScriptIds; now_ms: number };
export type ScriptCommand<I = unknown> = {
  type: string; label: string;
  /** Consecutive runs with the same key within one second are one undo step: typing in one line. */
  coalesce?: string;
  run(draft: ScriptDocument, env: ScriptEnv): I | void;
};
export type ScriptResult<I = unknown> = { document: ScriptDocument; type: string; label: string; coalesce?: string; info: I; changed: boolean };
export type ExecuteOptions = {
  /** The user confirmed "Editing creates a new draft; version <n> stays approved". */
  confirmApprovedEdit?: boolean;
  /** The reviewer path of a human review ("Edit and approve"): the one device write accepted while `in_review`. */
  reviewerEdit?: boolean;
};

export const SHOT_DURATION_MESSAGE = "Shot duration must be between 0.5 and 120 seconds";
export const TARGET_DURATION_MESSAGE = "Target duration must be between 5 seconds and 3 hours";

/** A scene always has a beat, and a shot never names a line or a beat that left its scene. */
function settle(draft: ScriptDocument, env: ScriptEnv): void {
  for (const scene of draft.scenes) {
    if (scene.beats.length === 0) scene.beats.push(newBeat(env.ids));
    const lineIds = new Set(sceneLines(scene).map((line) => line.id)), beatIds = new Set(scene.beats.map((beat) => beat.id));
    for (const shot of scene.shots) {
      if (shot.lineIds.some((id) => !lineIds.has(id))) shot.lineIds = shot.lineIds.filter((id) => lineIds.has(id));
      if (shot.beatId && !beatIds.has(shot.beatId)) delete shot.beatId;
    }
    if (scene.actId && !draft.acts.some((act) => act.id === scene.actId)) delete scene.actId;
  }
}

export function executeScript<I>(document: ScriptDocument, command: ScriptCommand<I>, env: ScriptEnv, options: ExecuteOptions = {}): ScriptResult<I> {
  if (document.status === "locked") throw new ScriptError("SCRIPT_LOCKED", "Locked — unlock to edit", { scriptId: document.id });
  if (document.status === "in_review" && !options.reviewerEdit) throw new ScriptError("SCRIPT_READ_ONLY", "This script is in review", { scriptId: document.id });
  if (document.status === "approved" && !options.confirmApprovedEdit) throw new ScriptError("SCRIPT_READ_ONLY", "Editing creates a new draft", { scriptId: document.id, needsConfirmation: true });
  const draft = clone(document);
  const info = command.run(draft, env) as I;
  settle(draft, env);
  const base = { type: command.type, label: command.label, coalesce: command.coalesce, info };
  if (canonicalJson(draft) === canonicalJson(document)) return { ...base, document, changed: false };
  assertLimits(draft);
  const result = validateScript(draft);
  if (!result.ok) throw new ScriptError("SCRIPT_SCHEMA_INVALID", `${result.errors[0].path}: ${result.errors[0].message}`, { path: result.errors[0].path, errors: result.errors });
  // Any content edit of an approved or returned script starts a new draft; the approved version stays named.
  if (draft.status === "approved" || draft.status === "changes_requested") draft.status = "draft";
  draft.updated_ms = env.now_ms;
  draft.revision = document.revision + 1;
  return { ...base, document: draft, changed: true };
}

export const SCRIPT_HISTORY_LIMIT = 200;
export const SCRIPT_COALESCE_MS = 1000;
type Step = { before: ScriptDocument; after: ScriptDocument; label: string; coalesce?: string; at_ms: number };
/** What undo never touches: status, policy, versions and links are reversed by their own actions. */
const carry = (content: ScriptDocument, current: ScriptDocument, now_ms: number): ScriptDocument => {
  const next = { ...clone(content), status: current.status, links: clone(current.links), headVersionId: current.headVersionId, revision: current.revision + 1, updated_ms: now_ms };
  if (current.approvalPolicy) next.approvalPolicy = clone(current.approvalPolicy); else delete next.approvalPolicy;
  if (current.approvedVersionId) next.approvedVersionId = current.approvedVersionId; else delete next.approvedVersionId;
  return next;
};
/** The undo history of one script on one device: 200 steps, typing in one line coalesced until a pause of 1 s. */
export function createScriptHistory(limit: number = SCRIPT_HISTORY_LIMIT) {
  const undoStack: Step[] = [], redoStack: Step[] = [];
  return {
    get canUndo(): boolean { return undoStack.length > 0; },
    get canRedo(): boolean { return redoStack.length > 0; },
    get length(): number { return undoStack.length; },
    get undoLabel(): string | undefined { return undoStack[undoStack.length - 1]?.label; },
    get redoLabel(): string | undefined { return redoStack[redoStack.length - 1]?.label; },
    record(before: ScriptDocument, result: ScriptResult, at_ms: number): void {
      if (!result.changed) return;
      const last = undoStack[undoStack.length - 1];
      if (last && result.coalesce !== undefined && last.coalesce === result.coalesce && at_ms - last.at_ms <= SCRIPT_COALESCE_MS) Object.assign(last, { after: result.document, at_ms });
      else undoStack.push({ before, after: result.document, label: result.label, coalesce: result.coalesce, at_ms });
      if (undoStack.length > limit) undoStack.splice(0, undoStack.length - limit);
      redoStack.length = 0;
    },
    /** A caret move or a different command ends the coalescing of the last step. */
    seal(): void { const last = undoStack[undoStack.length - 1]; if (last) last.coalesce = undefined; },
    undo(current: ScriptDocument, now_ms: number): { document: ScriptDocument; label: string } | null {
      const step = undoStack.pop();
      if (!step) return null;
      step.coalesce = undefined;
      redoStack.push(step);
      return { document: carry(step.before, current, now_ms), label: step.label };
    },
    redo(current: ScriptDocument, now_ms: number): { document: ScriptDocument; label: string } | null {
      const step = redoStack.pop();
      if (!step) return null;
      undoStack.push(step);
      return { document: carry(step.after, current, now_ms), label: step.label };
    },
    /** Another device's version became the head: the version history is the recovery path from here. */
    clear(): void { undoStack.length = 0; redoStack.length = 0; },
  };
}
export type ScriptHistory = ReturnType<typeof createScriptHistory>;

const need = <T>(value: T | undefined, what: string): T => { if (value === undefined) throw new ScriptError("SCRIPT_SCHEMA_INVALID", `${what} does not exist`, { path: what }); return value; };
const sceneOf = (draft: ScriptDocument, sceneId: string): ScriptScene => need(findScene(draft, sceneId), `scene ${sceneId}`);
const reId = <T extends { id: string }>(value: T, ids: ScriptIds): T => ({ ...clone(value), id: ids() });
/** A copy of a scene with new ids everywhere, its shots following the copied lines. */
function copyScene(scene: ScriptScene, ids: ScriptIds): ScriptScene {
  const lineMap = new Map<string, string>(), beatMap = new Map<string, string>();
  const beats = scene.beats.map((beat) => { const copy = { ...reId(beat, ids), lines: beat.lines.map((line) => { const next = reId(line, ids); lineMap.set(line.id, next.id); return next; }) }; beatMap.set(beat.id, copy.id); return copy; });
  const shots = scene.shots.map((shot) => { const copy = { ...reId(shot, ids), lineIds: shot.lineIds.map((id) => lineMap.get(id)!) }; if (shot.beatId) copy.beatId = beatMap.get(shot.beatId); return copy; });
  return { ...clone(scene), id: ids(), beats, shots };
}
const move = <T>(list: T[], from: number, to: number): void => { const [item] = list.splice(from, 1); list.splice(Math.max(0, Math.min(list.length, to)), 0, item); };

// — Details —
export const setTitle = (title: string): ScriptCommand => ({ type: "script.title", label: "Rename script", coalesce: "title", run(draft) { draft.title = title; } });
export function setMeta(patch: Partial<ScriptMeta>, coalesce?: string): ScriptCommand {
  return {
    type: "script.meta", label: "Edit details", coalesce,
    run(draft) {
      if (patch.targetDuration_s !== undefined && (patch.targetDuration_s < SCRIPT_TARGET_DURATION_S.min || patch.targetDuration_s > SCRIPT_TARGET_DURATION_S.max)) throw new ScriptError("SCRIPT_SCHEMA_INVALID", TARGET_DURATION_MESSAGE, { path: "meta.targetDuration_s" });
      Object.assign(draft.meta, patch);
      for (const key of Object.keys(patch) as (keyof ScriptMeta)[]) if (patch[key] === undefined) delete draft.meta[key];
    },
  };
}
export const setConstraints = (constraints: ScriptConstraints | undefined): ScriptCommand => ({
  type: "script.constraints", label: "Edit constraints", coalesce: "constraints",
  run(draft) { if (constraints && Object.keys(constraints).length) draft.constraints = clone(constraints); else delete draft.constraints; },
});

// — Acts —
export const addAct = (title = ""): ScriptCommand<{ actId: string }> => ({ type: "script.act.add", label: "Add act", run(draft, env) { const act: ScriptAct = { id: env.ids(), title, summary: "" }; draft.acts.push(act); return { actId: act.id }; } });
export const updateAct = (actId: string, patch: Partial<Omit<ScriptAct, "id">>): ScriptCommand => ({ type: "script.act.update", label: "Edit act", coalesce: `act:${actId}`, run(draft) { Object.assign(need(draft.acts.find((act) => act.id === actId), `act ${actId}`), patch); } });
/** Deleting an act keeps its scenes, which move to the top level. */
export const deleteAct = (actId: string): ScriptCommand => ({ type: "script.act.delete", label: "Delete act", run(draft) { draft.acts = draft.acts.filter((act) => act.id !== actId); } });
/** Acts move with their scenes: the scenes of the moved act are regrouped in act order. */
export const moveAct = (actId: string, delta: -1 | 1): ScriptCommand => ({
  type: "script.act.move", label: delta < 0 ? "Move up" : "Move down",
  run(draft) {
    const index = draft.acts.findIndex((act) => act.id === actId);
    if (index < 0 || index + delta < 0 || index + delta >= draft.acts.length) return;
    move(draft.acts, index, index + delta);
    const order = new Map(draft.acts.map((act, position) => [act.id, position]));
    const loose = draft.scenes.filter((scene) => !scene.actId), grouped = draft.scenes.filter((scene) => scene.actId).sort((a, b) => order.get(a.actId!)! - order.get(b.actId!)!);
    draft.scenes = [...loose, ...grouped];
  },
});

// — Scenes —
export function addScene(options: { afterSceneId?: string; actId?: string; fields?: Partial<ScriptScene> } = {}): ScriptCommand<{ sceneId: string; lineId: string }> {
  return {
    type: "script.scene.new", label: "New scene",
    run(draft, env) {
      const after = options.afterSceneId ? draft.scenes.findIndex((scene) => scene.id === options.afterSceneId) : draft.scenes.length - 1;
      const actId = options.actId ?? draft.scenes[after]?.actId;
      const scene = newScene(env.ids, { ...options.fields, ...(actId ? { actId } : {}) });
      scene.beats[0].lines.push(newLine(env.ids));
      draft.scenes.splice(after + 1, 0, scene);
      return { sceneId: scene.id, lineId: scene.beats[0].lines[0].id };
    },
  };
}
export type ScenePatch = Partial<Pick<ScriptScene, "title" | "summary" | "colorIndex" | "omitted" | "actId" | "durationOverride_ticks">> & { heading?: Partial<ScriptScene["heading"]> };
export function updateScenes(sceneIds: readonly string[], patch: ScenePatch, label = "Edit scene"): ScriptCommand {
  return {
    type: "script.scene.update", label, coalesce: sceneIds.length === 1 ? `scene:${sceneIds[0]}:${Object.keys(patch).join(",")}:${Object.keys(patch.heading ?? {}).join(",")}` : undefined,
    run(draft) {
      for (const sceneId of sceneIds) {
        const scene = sceneOf(draft, sceneId), { heading, ...rest } = patch;
        Object.assign(scene, rest);
        for (const key of Object.keys(rest) as (keyof typeof rest)[]) if (rest[key] === undefined) delete scene[key];
        if (heading) { Object.assign(scene.heading, heading); if ("locationId" in heading && heading.locationId === undefined) delete scene.heading.locationId; }
      }
    },
  };
}
export const duplicateScenes = (sceneIds: readonly string[]): ScriptCommand<{ sceneIds: string[] }> => ({
  type: "script.scene.duplicate", label: "Duplicate scene",
  run(draft, env) {
    const created: string[] = [];
    for (const sceneId of sceneIds) { const index = draft.scenes.findIndex((scene) => scene.id === sceneId); if (index < 0) continue; const copy = copyScene(draft.scenes[index], env.ids); draft.scenes.splice(index + 1, 0, copy); created.push(copy.id); }
    return { sceneIds: created };
  },
});
export const deleteScenes = (sceneIds: readonly string[]): ScriptCommand => ({ type: "script.scene.delete", label: "Delete scene", run(draft) { draft.scenes = draft.scenes.filter((scene) => !sceneIds.includes(scene.id)); } });
/** Moves a scene to a position of the scene list; every id it holds survives. */
export const moveScene = (sceneId: string, toIndex: number): ScriptCommand => ({
  type: "script.scene.move", label: "Move scene",
  run(draft) { const from = draft.scenes.findIndex((scene) => scene.id === sceneId); if (from >= 0) move(draft.scenes, from, toIndex); },
});
/** "Split scene here": a new scene from that line onward with a copied heading; shots follow the lines they cover. */
export function splitScene(lineId: string): ScriptCommand<{ sceneId: string }> {
  return {
    type: "script.scene.split", label: "Split scene",
    run(draft, env) {
      const ref = need(findLine(draft, lineId), `line ${lineId}`), scene = draft.scenes[ref.sceneIndex], beat = scene.beats[ref.beatIndex];
      const tail = beat.lines.splice(ref.lineIndex), later = scene.beats.splice(ref.beatIndex + 1);
      const first: ScriptBeat = ref.lineIndex === 0 ? { ...beat, lines: tail } : { id: env.ids(), label: beat.label, intent: beat.intent, lines: tail };
      if (ref.lineIndex === 0) scene.beats.splice(ref.beatIndex, 1);
      const next: ScriptScene = { ...clone(scene), id: env.ids(), title: "", summary: "", beats: [first, ...later], shots: [] };
      delete next.durationOverride_ticks;
      const moved = new Set(sceneLines(next).map((line) => line.id)), kept: ScriptShot[] = [];
      for (const shot of scene.shots) {
        if (shot.lineIds.length > 0 && shot.lineIds.every((id) => moved.has(id))) next.shots.push(shot);
        else if (shot.lineIds.length === 0 && shot.beatId && next.beats.some((entry) => entry.id === shot.beatId)) next.shots.push(shot);
        else kept.push(shot);
      }
      scene.shots = kept;
      draft.scenes.splice(ref.sceneIndex + 1, 0, next);
      return { sceneId: next.id };
    },
  };
}
export const mergeSceneWithPrevious = (sceneId: string): ScriptCommand => ({
  type: "script.scene.merge", label: "Merge scenes",
  run(draft) {
    const index = draft.scenes.findIndex((scene) => scene.id === sceneId);
    if (index <= 0) return;
    const [scene] = draft.scenes.splice(index, 1), previous = draft.scenes[index - 1];
    previous.beats.push(...scene.beats); previous.shots.push(...scene.shots);
  },
});

// — Beats —
export const addBeat = (sceneId: string, afterBeatId?: string, label = ""): ScriptCommand<{ beatId: string; lineId: string }> => ({
  type: "script.beat.new", label: "New beat",
  run(draft, env) {
    const scene = sceneOf(draft, sceneId), after = afterBeatId ? scene.beats.findIndex((beat) => beat.id === afterBeatId) : scene.beats.length - 1;
    const beat = newBeat(env.ids, label, "", [newLine(env.ids)]);
    scene.beats.splice(after + 1, 0, beat);
    return { beatId: beat.id, lineId: beat.lines[0].id };
  },
});
export const updateBeat = (beatId: string, patch: Partial<Pick<ScriptBeat, "label" | "intent">>): ScriptCommand => ({
  type: "script.beat.update", label: "Edit beat", coalesce: `beat:${beatId}:${Object.keys(patch).join(",")}`, run(draft) { Object.assign(need(findBeat(draft, beatId), `beat ${beatId}`).beat, patch); },
});
/** Deleting the only beat of a scene leaves an empty beat in its place, in the same step. */
export const deleteBeat = (beatId: string): ScriptCommand => ({ type: "script.beat.delete", label: "Delete beat", run(draft) { const found = need(findBeat(draft, beatId), `beat ${beatId}`); found.scene.beats.splice(found.index, 1); } });
export const duplicateBeat = (beatId: string): ScriptCommand<{ beatId: string }> => ({
  type: "script.beat.duplicate", label: "Duplicate beat",
  run(draft, env) { const found = need(findBeat(draft, beatId), `beat ${beatId}`); const copy = { ...reId(found.beat, env.ids), lines: found.beat.lines.map((line) => reId(line, env.ids)) }; found.scene.beats.splice(found.index + 1, 0, copy); return { beatId: copy.id }; },
});
export const moveBeat = (beatId: string, delta: -1 | 1): ScriptCommand => ({
  type: "script.beat.move", label: delta < 0 ? "Move up" : "Move down",
  run(draft) { const found = need(findBeat(draft, beatId), `beat ${beatId}`); if (found.index + delta >= 0 && found.index + delta < found.scene.beats.length) move(found.scene.beats, found.index, found.index + delta); },
});
/** A new beat from that line onward. */
export const splitBeat = (lineId: string): ScriptCommand<{ beatId: string }> => ({
  type: "script.beat.split", label: "Split beat",
  run(draft, env) {
    const ref = need(findLine(draft, lineId), `line ${lineId}`), beat = draft.scenes[ref.sceneIndex].beats[ref.beatIndex];
    const next = newBeat(env.ids, "", "", beat.lines.splice(ref.lineIndex));
    draft.scenes[ref.sceneIndex].beats.splice(ref.beatIndex + 1, 0, next);
    return { beatId: next.id };
  },
});
export const mergeBeatWithPrevious = (beatId: string): ScriptCommand => ({
  type: "script.beat.merge", label: "Merge beats",
  run(draft) { const found = need(findBeat(draft, beatId), `beat ${beatId}`); if (found.index === 0) return; found.scene.beats[found.index - 1].lines.push(...found.beat.lines); found.scene.beats.splice(found.index, 1); },
});

// — Lines —
export function addLine(options: { beatId: string; afterLineId?: string; atStart?: boolean; kind?: ScriptLineKind; text?: string; fields?: Partial<ScriptLine> }): ScriptCommand<{ lineId: string }> {
  return {
    type: "script.line.add", label: "Add line",
    run(draft, env) {
      const { beat } = need(findBeat(draft, options.beatId), `beat ${options.beatId}`);
      const after = options.atStart ? -1 : options.afterLineId ? beat.lines.findIndex((line) => line.id === options.afterLineId) : beat.lines.length - 1;
      const line = newLine(env.ids, options.kind ?? "action", options.text ?? "", options.fields);
      beat.lines.splice(after + 1, 0, line);
      return { lineId: line.id };
    },
  };
}
export type LinePatch = Partial<Pick<ScriptLine, "text" | "speakerText" | "characterId" | "parenthetical" | "dual" | "language" | "needsCheck">>;
export function updateLine(lineId: string, patch: LinePatch): ScriptCommand {
  return {
    type: "script.line.update", label: "text" in patch ? "Typing" : "Edit line", coalesce: `line:${lineId}:${Object.keys(patch).join(",")}`,
    run(draft) {
      const { line } = need(findLine(draft, lineId), `line ${lineId}`);
      Object.assign(line, patch);
      for (const key of Object.keys(patch) as (keyof LinePatch)[]) if (patch[key] === undefined || patch[key] === false || (key !== "text" && patch[key] === "")) delete line[key];
    },
  };
}
/** The speaker of a line by name: an existing character is linked, a new name creates a local character. */
export function setSpeaker(lineId: string, name: string): ScriptCommand {
  return {
    type: "script.line.speaker", label: "Set speaker",
    run(draft, env) {
      const { line } = need(findLine(draft, lineId), `line ${lineId}`), wanted = name.trim().slice(0, 60);
      delete line.speakerText; delete line.characterId;
      if (!wanted) return;
      let character = draft.entities.characters.find((entity) => entity.name.toLowerCase() === wanted.toLowerCase() || entity.aliases.some((alias) => alias.toLowerCase() === wanted.toLowerCase()));
      if (!character) { character = newEntity(env.ids, wanted, (draft.entities.characters.length % 8) + 1); draft.entities.characters.push(character); }
      line.characterId = character.id;
    },
  };
}
/** Characters whose name or alias starts with what was typed on a cue. */
export const completeCue = (document: ScriptDocument, typed: string): ScriptEntity[] => {
  const prefix = typed.trim().toLowerCase();
  return prefix ? document.entities.characters.filter((entity) => entity.name.toLowerCase().startsWith(prefix) || entity.aliases.some((alias) => alias.toLowerCase().startsWith(prefix))) : [];
};
/** Changes the kind of lines; the text is kept, and fields the new kind has no use for are dropped. */
export const setLineKind = (lineIds: readonly string[], kind: ScriptLineKind): ScriptCommand => ({
  type: `script.line.kind.${kind}`, label: "Change line kind",
  run(draft) {
    for (const lineId of lineIds) {
      const { line } = need(findLine(draft, lineId), `line ${lineId}`);
      line.kind = kind;
      if (kind !== "dialogue" && kind !== "narration") { delete line.characterId; delete line.speakerText; delete line.parenthetical; delete line.dual; }
    }
  },
});
export const deleteLines = (lineIds: readonly string[]): ScriptCommand => ({
  type: "script.line.delete", label: "Delete line",
  run(draft) { for (const scene of draft.scenes) for (const beat of scene.beats) beat.lines = beat.lines.filter((line) => !lineIds.includes(line.id)); },
});
export const duplicateLine = (lineId: string): ScriptCommand<{ lineId: string }> => ({
  type: "script.line.duplicate", label: "Duplicate line",
  run(draft, env) { const ref = need(findLine(draft, lineId), `line ${lineId}`); const copy = reId(ref.line, env.ids); ref.beat.lines.splice(ref.lineIndex + 1, 0, copy); return { lineId: copy.id }; },
});
/** Moves lines, in their current order, to a beat (before a line of it, or at its end). A line that leaves its scene is dropped by that scene's shots. */
export function moveLines(lineIds: readonly string[], target: { beatId: string; beforeLineId?: string }): ScriptCommand {
  return {
    type: "script.line.move", label: "Move line",
    run(draft) {
      const moving: ScriptLine[] = [];
      for (const scene of draft.scenes) for (const beat of scene.beats) { moving.push(...beat.lines.filter((line) => lineIds.includes(line.id))); beat.lines = beat.lines.filter((line) => !lineIds.includes(line.id)); }
      const { beat } = need(findBeat(draft, target.beatId), `beat ${target.beatId}`);
      const at = target.beforeLineId ? beat.lines.findIndex((line) => line.id === target.beforeLineId) : -1;
      beat.lines.splice(at < 0 ? beat.lines.length : at, 0, ...moving);
    },
  };
}
/** "Move up" / "Move down": within the beat, then into the neighbouring beat, then into the neighbouring scene. */
export function moveLineBy(lineId: string, delta: -1 | 1): ScriptCommand {
  return {
    type: delta < 0 ? "script.move.up" : "script.move.down", label: delta < 0 ? "Move up" : "Move down",
    run(draft) {
      const ref = need(findLine(draft, lineId), `line ${lineId}`), beat = ref.beat;
      const to = ref.lineIndex + delta;
      if (to >= 0 && to < beat.lines.length) { move(beat.lines, ref.lineIndex, to); return; }
      const beats = draft.scenes.flatMap((scene) => scene.beats), position = beats.indexOf(beat) + delta;
      if (position < 0 || position >= beats.length) return;
      beat.lines.splice(ref.lineIndex, 1);
      if (delta < 0) beats[position].lines.push(ref.line); else beats[position].lines.unshift(ref.line);
    },
  };
}
export const splitLine = (lineId: string, offset: number): ScriptCommand<{ lineId: string }> => ({
  type: "script.line.split", label: "Split line",
  run(draft, env) {
    const ref = need(findLine(draft, lineId), `line ${lineId}`), text = ref.line.text;
    const next: ScriptLine = { ...clone(ref.line), id: env.ids(), text: text.slice(offset).replace(/^\s+/, "") };
    ref.line.text = text.slice(0, offset).replace(/\s+$/, "");
    ref.beat.lines.splice(ref.lineIndex + 1, 0, next);
    return { lineId: next.id };
  },
});
/** Joins a line to the one before it in its beat; shots that covered it cover the joined line. */
export const mergeLineWithPrevious = (lineId: string): ScriptCommand<{ lineId: string; offset: number }> => ({
  type: "script.line.merge", label: "Merge lines",
  run(draft) {
    const ref = need(findLine(draft, lineId), `line ${lineId}`);
    if (ref.lineIndex === 0) return { lineId, offset: 0 };
    const previous = ref.beat.lines[ref.lineIndex - 1], offset = previous.text.length;
    previous.text = [previous.text, ref.line.text].filter(Boolean).join(previous.text && ref.line.text ? " " : "");
    ref.beat.lines.splice(ref.lineIndex, 1);
    for (const shot of ref.scene.shots) if (shot.lineIds.includes(lineId)) shot.lineIds = [...new Set(shot.lineIds.map((id) => (id === lineId ? previous.id : id)))];
    return { lineId: previous.id, offset };
  },
});

// — Shots —
export function addShot(sceneId: string, options: { beforeShotId?: string; fields?: Partial<ScriptShot> } = {}): ScriptCommand<{ shotId: string }> {
  return {
    type: "script.shot.add", label: "Add shot",
    run(draft, env) {
      const scene = sceneOf(draft, sceneId), shot = newShot(env.ids, options.fields);
      const at = options.beforeShotId ? scene.shots.findIndex((entry) => entry.id === options.beforeShotId) : -1;
      scene.shots.splice(at < 0 ? scene.shots.length : at, 0, shot);
      return { shotId: shot.id };
    },
  };
}
export type ShotPatch = Partial<Omit<ScriptShot, "id">>;
/** One shot or a bulk edit of several: a single undo step. */
export function updateShots(shotIds: readonly string[], patch: ShotPatch): ScriptCommand {
  return {
    type: "script.shot.update", label: shotIds.length > 1 ? "Edit shots" : "Edit shot", coalesce: shotIds.length === 1 && ("description" in patch || "notes" in patch || "onScreenText" in patch) ? `shot:${shotIds[0]}:${Object.keys(patch).join(",")}` : undefined,
    run(draft) {
      const override = patch.durationOverride_ticks;
      if (override !== undefined && (override < SHOT_DURATION_TICKS.min || override > SHOT_DURATION_TICKS.max)) throw new ScriptError("SCRIPT_SCHEMA_INVALID", SHOT_DURATION_MESSAGE, { path: "durationOverride_ticks" });
      for (const shotId of shotIds) {
        const { shot } = need(findShot(draft, shotId), `shot ${shotId}`);
        Object.assign(shot, clone(patch));
        for (const key of Object.keys(patch) as (keyof ShotPatch)[]) if (patch[key] === undefined) delete shot[key];
      }
    },
  };
}
export const deleteShots = (shotIds: readonly string[]): ScriptCommand => ({ type: "script.shot.delete", label: "Delete shot", run(draft) { for (const scene of draft.scenes) scene.shots = scene.shots.filter((shot) => !shotIds.includes(shot.id)); } });
export const duplicateShot = (shotId: string): ScriptCommand<{ shotId: string }> => ({
  type: "script.shot.duplicate", label: "Duplicate shot",
  run(draft, env) { const found = need(findShot(draft, shotId), `shot ${shotId}`); const copy = reId(found.shot, env.ids); found.scene.shots.splice(found.index + 1, 0, copy); return { shotId: copy.id }; },
});
/** Reorders a shot within its scene. */
export const moveShot = (shotId: string, delta: -1 | 1): ScriptCommand => ({
  type: "script.shot.move", label: delta < 0 ? "Move up" : "Move down",
  run(draft) { const found = need(findShot(draft, shotId), `shot ${shotId}`); if (found.index + delta >= 0 && found.index + delta < found.scene.shots.length) move(found.scene.shots, found.index, found.index + delta); },
});
/** "Create shot from selection": one shot covering the selected lines of one scene. */
export function shotFromSelection(lineIds: readonly string[]): ScriptCommand<{ shotId: string }> {
  return {
    type: "script.shot.fromSelection", label: "Create shot",
    run(draft, env) {
      const first = need(findLine(draft, lineIds[0] ?? ""), "the selected line"), scene = draft.scenes[first.sceneIndex];
      const inScene = sceneLines(scene).filter((line) => lineIds.includes(line.id)).map((line) => line.id).slice(0, 40);
      const shot = newShot(env.ids, { lineIds: inScene, beatId: first.beat.id });
      scene.shots.push(shot);
      return { shotId: shot.id };
    },
  };
}
const AUTO_SIZES = ["wide", "medium", "close-up"] as const;
/** "Auto shots": for every scene without shots, one shot per beat covering that beat's lines; sizes wide, medium, close-up in turn. */
export function autoShots(sceneIds?: readonly string[]): ScriptCommand<{ created: number }> {
  return {
    type: "script.shot.auto", label: "Auto shots",
    run(draft, env) {
      let created = 0;
      for (const scene of draft.scenes) {
        if (scene.shots.length > 0 || scene.omitted || (sceneIds && !sceneIds.includes(scene.id))) continue;
        scene.beats.forEach((beat, index) => {
          const lines = beat.lines.filter((line) => line.kind !== "visual_note" && line.kind !== "sound_note" && line.kind !== "transition");
          const note = beat.lines.find((line) => line.kind === "visual_note")?.text ?? "";
          scene.shots.push(newShot(env.ids, { beatId: beat.id, lineIds: lines.slice(0, 40).map((line) => line.id), size: AUTO_SIZES[index % 3], description: (note || beat.intent || beat.label).slice(0, 800), onScreenText: (beat.lines.find((line) => line.kind === "on_screen_text")?.text ?? "").slice(0, 120) }));
          created++;
        });
      }
      return { created };
    },
  };
}

// — Cast and places —
export const addEntity = (kind: ScriptEntityKind, name: string): ScriptCommand<{ entityId: string }> => ({
  type: "script.entity.add", label: "Add to cast and places",
  run(draft, env) { const entity = newEntity(env.ids, name.trim(), (draft.entities[kind].length % 8) + 1); draft.entities[kind].push(entity); return { entityId: entity.id }; },
});
export const updateEntity = (kind: ScriptEntityKind, entityId: string, patch: Partial<Omit<ScriptEntity, "id">>): ScriptCommand => ({
  type: "script.entity.update", label: "Edit cast and places", coalesce: `entity:${entityId}:${Object.keys(patch).join(",")}`,
  run(draft) { Object.assign(need(draft.entities[kind].find((entity) => entity.id === entityId), `entity ${entityId}`), patch); },
});
/** How many lines, scenes and shots use an entity. */
export function entityUsage(document: ScriptDocument, kind: ScriptEntityKind, entityId: string): { lines: number; scenes: number; shots: number } {
  let lines = 0, scenes = 0, shots = 0;
  for (const scene of document.scenes) {
    let used = kind === "locations" && scene.heading.locationId === entityId;
    if (kind === "characters") for (const line of sceneLines(scene)) if (line.characterId === entityId) { lines++; used = true; }
    for (const shot of scene.shots) if (kind === "characters" ? shot.characterIds.includes(entityId) : kind === "locations" ? shot.locationId === entityId : shot.propIds.includes(entityId)) { shots++; used = true; }
    if (used) scenes++;
  }
  return { lines, scenes, shots };
}
/** Deletes an entity: its references go to another entity ("Replace with…") or become plain text ("Keep the name as text"), in one step. */
export function deleteEntity(kind: ScriptEntityKind, entityId: string, options: { replaceWith?: string } = {}): ScriptCommand {
  return {
    type: "script.entity.delete", label: "Delete from cast and places",
    run(draft) {
      const entity = need(draft.entities[kind].find((entry) => entry.id === entityId), `entity ${entityId}`), to = options.replaceWith;
      draft.entities[kind] = draft.entities[kind].filter((entry) => entry.id !== entityId);
      const swap = (ids: string[]): string[] => [...new Set(ids.flatMap((id) => (id === entityId ? (to ? [to] : []) : [id])))];
      for (const scene of draft.scenes) {
        if (kind === "locations" && scene.heading.locationId === entityId) { if (to) scene.heading.locationId = to; else { delete scene.heading.locationId; scene.heading.locationText = entity.name.slice(0, 120); } }
        if (kind === "characters") for (const line of sceneLines(scene)) if (line.characterId === entityId) { if (to) line.characterId = to; else { delete line.characterId; line.speakerText = entity.name; } }
        for (const shot of scene.shots) {
          if (kind === "characters") shot.characterIds = swap(shot.characterIds);
          else if (kind === "props") shot.propIds = swap(shot.propIds);
          else if (shot.locationId === entityId) { if (to) shot.locationId = to; else delete shot.locationId; }
        }
      }
    },
  };
}
/** Applies the capitalisation pattern of a found mention to its replacement: MAI → LAN, Mai → Lan, mai → lan. */
export function matchCase(found: string, replacement: string): string {
  if (found === found.toUpperCase() && found !== found.toLowerCase()) return replacement.toUpperCase();
  if (found === found.toLowerCase()) return replacement.toLowerCase();
  if (found[0] === found[0].toUpperCase() && found.slice(1) === found.slice(1).toLowerCase()) return replacement[0].toUpperCase() + replacement.slice(1).toLowerCase();
  return replacement;
}
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** "Rename character": renames the entity — every cue follows — and, when asked, replaces mentions in action and dialogue text. */
export function renameCharacter(entityId: string, name: string, replaceMentions: boolean): ScriptCommand<{ mentions: number }> {
  return {
    type: "script.entity.rename", label: "Rename character",
    run(draft) {
      const entity = need(draft.entities.characters.find((entry) => entry.id === entityId), `character ${entityId}`), old = entity.name;
      entity.name = name.trim();
      let mentions = 0;
      if (replaceMentions && old.trim()) {
        const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(old)}(?![\\p{L}\\p{N}])`, "giu");
        for (const scene of draft.scenes) for (const line of sceneLines(scene)) {
          if (line.kind !== "action" && line.kind !== "dialogue" && line.kind !== "narration") continue;
          line.text = line.text.replace(pattern, (found) => { mentions++; return matchCase(found, entity.name); });
        }
      }
      return { mentions };
    },
  };
}

/** Replaces the whole content (structure, cast, details) in one step: import into an open script, the plain-text mode, a restore. */
export type ScriptContent = Pick<ScriptDocument, "title" | "meta" | "acts" | "scenes" | "entities"> & { constraints?: ScriptConstraints };
export const contentOf = (document: ScriptDocument): ScriptContent => clone({ title: document.title, meta: document.meta, acts: document.acts, scenes: document.scenes, entities: document.entities, ...(document.constraints ? { constraints: document.constraints } : {}) });
export function replaceContent(content: Partial<ScriptContent>, label = "Replace content", type = "script.content.replace"): ScriptCommand {
  return {
    type, label,
    run(draft) {
      const next = clone(content);
      if (next.title !== undefined) draft.title = next.title;
      if (next.meta) draft.meta = next.meta;
      if (next.acts) draft.acts = next.acts;
      if (next.scenes) draft.scenes = next.scenes;
      if (next.entities) draft.entities = next.entities;
      if ("constraints" in next) { if (next.constraints) draft.constraints = next.constraints; else delete draft.constraints; }
    },
  };
}
