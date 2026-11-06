import type { ScriptBeat, ScriptDocument, ScriptLine, ScriptScene, ScriptShot } from "@jagentchill/protocol";
import type { ScriptContent } from "./commands.ts";
import { plainText, totalTicks } from "./estimate.ts";
import { sceneLines } from "./model.ts";

/** `script-studio.Diff between versions`: a pure function, the same on every platform and on the host. */
export type TextSegment = { op: "equal" | "insert" | "delete"; text: string };
export type ScriptChange = {
  changeId: string; kind: "added" | "removed" | "moved" | "modified"; target: "meta" | "act" | "scene" | "beat" | "line" | "shot" | "entity";
  id: string; parentId: string | null; path?: string; before?: unknown; after?: unknown; textDiff?: TextSegment[]; dependsOn: string[];
  /** The scene the change belongs to, for grouping and "Go to". */
  sceneId?: string;
};
export type ScriptDiff = { changes: ScriptChange[]; totals: { added: number; removed: number; moved: number; modified: number; wordsAdded: number; wordsRemoved: number; durationDelta_ticks: number } };

/** Japanese, Chinese and Thai have no spaces between words: their text is compared grapheme by grapheme. */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;
function tokens(text: string): string[] {
  if (!UNSPACED.test(text)) return text.split(/(\s+)/).filter((token) => token !== "");
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: string }) => { segment(text: string): Iterable<{ segment: string }> } }).Segmenter;
  return Segmenter ? Array.from(new Segmenter(undefined, { granularity: "grapheme" }).segment(text), (part) => part.segment) : Array.from(text);
}
/** The longest common subsequence of two token lists, as index pairs. */
function lcs<T>(a: readonly T[], b: readonly T[]): [number, number][] {
  const rows = a.length + 1, cols = b.length + 1, table = new Uint32Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i * cols + j] = a[i] === b[j] ? table[(i + 1) * cols + j + 1] + 1 : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
  const pairs: [number, number][] = [];
  for (let i = 0, j = 0; i < a.length && j < b.length;) { if (a[i] === b[j]) { pairs.push([i, j]); i++; j++; } else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) i++; else j++; }
  return pairs;
}
/** Word-level segments of a text change; a word and the space after it travel together so that the result reads naturally. */
export function textDiff(before: string, after: string): TextSegment[] {
  const a = tokens(before), b = tokens(after);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const midA = a.slice(head, a.length - tail), midB = b.slice(head, b.length - tail);
  const out: TextSegment[] = [];
  const push = (op: TextSegment["op"], text: string) => { if (!text) return; const last = out[out.length - 1]; if (last && last.op === op) last.text += text; else out.push({ op, text }); };
  push("equal", a.slice(0, head).join(""));
  // Very long middles are compared as two blocks: the result stays correct, only coarser.
  if (midA.length * midB.length > 4_000_000) { push("delete", midA.join("")); push("insert", midB.join("")); }
  else {
    let i = 0, j = 0;
    for (const [x, y] of lcs(midA, midB)) { push("delete", midA.slice(i, x).join("")); push("insert", midB.slice(j, y).join("")); push("equal", midA[x]); i = x + 1; j = y + 1; }
    push("delete", midA.slice(i).join("")); push("insert", midB.slice(j).join(""));
  }
  push("equal", a.slice(a.length - tail).join(""));
  return out;
}
const normalise = (text: string): string => plainText(text).toLowerCase().replace(/\s+/g, " ").trim();
/** 2·|common tokens| ÷ (|a| + |b|) on normalised text: content without matching ids is matched at 0.6 and above. */
export function similarity(a: string, b: string): number {
  const x = tokens(normalise(a)).filter((token) => token.trim()), y = tokens(normalise(b)).filter((token) => token.trim());
  if (x.length + y.length === 0) return 1;
  return (2 * lcs(x, y).length) / (x.length + y.length);
}
const words = (text: string): number => tokens(text).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
/** Ids present on both sides whose relative order changed: those outside the longest common order. */
function movedIds(before: readonly string[], after: readonly string[]): Set<string> {
  const common = new Set(before.filter((id) => after.includes(id)));
  const a = before.filter((id) => common.has(id)), b = after.filter((id) => common.has(id));
  const kept = new Set(lcs(a, b).map(([index]) => a[index]));
  return new Set(a.filter((id) => !kept.has(id)));
}
const without = <T extends object>(value: T, ...keys: string[]): Record<string, unknown> => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));

export function diffScripts(before: ScriptContent, after: ScriptContent): ScriptDiff {
  const changes: ScriptChange[] = [];
  let counter = 0;
  const add = (change: Omit<ScriptChange, "changeId" | "dependsOn"> & { dependsOn?: string[] }): ScriptChange => { const full = { ...change, changeId: `c${++counter}`, dependsOn: change.dependsOn ?? [] }; changes.push(full); return full; };
  if (before.title !== after.title) add({ kind: "modified", target: "meta", id: "title", parentId: null, path: "title", before: before.title, after: after.title, textDiff: textDiff(before.title, after.title) });
  for (const key of new Set([...Object.keys(before.meta), ...Object.keys(after.meta)])) {
    const x = (before.meta as Record<string, unknown>)[key], y = (after.meta as Record<string, unknown>)[key];
    if (!same(x, y)) add({ kind: "modified", target: "meta", id: `meta.${key}`, parentId: null, path: `meta.${key}`, before: x, after: y });
  }
  if (!same(before.constraints, after.constraints)) add({ kind: "modified", target: "meta", id: "constraints", parentId: null, path: "constraints", before: before.constraints, after: after.constraints });
  for (const kind of ["characters", "locations", "props"] as const) {
    for (const entity of after.entities[kind]) {
      const old = before.entities[kind].find((entry) => entry.id === entity.id);
      if (!old) add({ kind: "added", target: "entity", id: entity.id, parentId: kind, after: entity });
      else if (!same(old, entity)) add({ kind: "modified", target: "entity", id: entity.id, parentId: kind, before: old, after: entity });
    }
    for (const entity of before.entities[kind]) if (!after.entities[kind].some((entry) => entry.id === entity.id)) add({ kind: "removed", target: "entity", id: entity.id, parentId: kind, before: entity });
  }
  const actMoves = movedIds(before.acts.map((act) => act.id), after.acts.map((act) => act.id));
  for (const act of after.acts) {
    const old = before.acts.find((entry) => entry.id === act.id);
    if (!old) add({ kind: "added", target: "act", id: act.id, parentId: null, after: act });
    else { if (!same(old, act)) add({ kind: "modified", target: "act", id: act.id, parentId: null, before: old, after: act }); if (actMoves.has(act.id)) add({ kind: "moved", target: "act", id: act.id, parentId: null }); }
  }
  for (const act of before.acts) if (!after.acts.some((entry) => entry.id === act.id)) add({ kind: "removed", target: "act", id: act.id, parentId: null, before: act });

  const oldScenes = new Map(before.scenes.map((scene) => [scene.id, scene])), newScenes = new Map(after.scenes.map((scene) => [scene.id, scene]));
  const sceneMoves = movedIds(before.scenes.map((scene) => scene.id), after.scenes.map((scene) => scene.id));
  // Where every beat and line lived before, so that a move between scenes is one change and not a removal and an addition.
  const oldBeatHome = new Map<string, { beat: ScriptBeat; scene: ScriptScene }>(), oldLineHome = new Map<string, { line: ScriptLine; beat: ScriptBeat; scene: ScriptScene }>();
  for (const scene of before.scenes) for (const beat of scene.beats) { oldBeatHome.set(beat.id, { beat, scene }); for (const line of beat.lines) oldLineHome.set(line.id, { line, beat, scene }); }
  const newLineIds = new Set(after.scenes.flatMap((scene) => sceneLines(scene).map((line) => line.id))), newBeatIds = new Set(after.scenes.flatMap((scene) => scene.beats.map((beat) => beat.id)));
  const addedBy = new Map<string, string>();
  const head = (scene: ScriptScene) => without(scene, "beats", "shots");
  for (const scene of after.scenes) {
    const old = oldScenes.get(scene.id);
    if (!old) {
      const change = add({ kind: "added", target: "scene", id: scene.id, parentId: scene.actId ?? null, after: scene, sceneId: scene.id });
      for (const beat of scene.beats) { addedBy.set(beat.id, change.changeId); for (const line of beat.lines) if (!oldLineHome.has(line.id)) addedBy.set(line.id, change.changeId); }
      continue;
    }
    if (sceneMoves.has(scene.id)) add({ kind: "moved", target: "scene", id: scene.id, parentId: scene.actId ?? null, before: before.scenes.indexOf(old) + 1, after: after.scenes.indexOf(scene) + 1, sceneId: scene.id });
    if (!same(head(old), head(scene))) add({ kind: "modified", target: "scene", id: scene.id, parentId: scene.actId ?? null, before: head(old), after: head(scene), sceneId: scene.id });
    const beatMoves = movedIds(old.beats.map((beat) => beat.id), scene.beats.map((beat) => beat.id));
    const removedLines = sceneLines(old).filter((line) => !newLineIds.has(line.id)), claimed = new Set<string>();
    for (const beat of scene.beats) {
      const home = oldBeatHome.get(beat.id);
      if (!home) {
        const change = add({ kind: "added", target: "beat", id: beat.id, parentId: scene.id, after: without(beat, "lines"), sceneId: scene.id });
        addedBy.set(beat.id, change.changeId);
      } else {
        if (home.scene.id !== scene.id || beatMoves.has(beat.id)) add({ kind: "moved", target: "beat", id: beat.id, parentId: scene.id, before: home.scene.id, sceneId: scene.id });
        if (home.beat.label !== beat.label || home.beat.intent !== beat.intent) add({ kind: "modified", target: "beat", id: beat.id, parentId: scene.id, before: without(home.beat, "lines"), after: without(beat, "lines"), sceneId: scene.id });
      }
      const lineMoves = home ? movedIds(home.beat.lines.map((line) => line.id), beat.lines.map((line) => line.id)) : new Set<string>();
      for (const line of beat.lines) {
        const was = oldLineHome.get(line.id);
        if (!was) {
          // No id on the other side: a removed line of this scene that reads nearly the same is the same line, edited.
          const twin = removedLines.find((entry) => !claimed.has(entry.id) && entry.kind === line.kind && similarity(entry.text, line.text) >= 0.6);
          if (twin) { claimed.add(twin.id); add({ kind: "modified", target: "line", id: line.id, parentId: beat.id, before: twin, after: line, textDiff: textDiff(twin.text, line.text), sceneId: scene.id }); continue; }
          const change = add({ kind: "added", target: "line", id: line.id, parentId: beat.id, after: line, sceneId: scene.id, dependsOn: addedBy.has(beat.id) ? [addedBy.get(beat.id)!] : [] });
          addedBy.set(line.id, change.changeId);
          continue;
        }
        if (was.beat.id !== beat.id || lineMoves.has(line.id)) add({ kind: "moved", target: "line", id: line.id, parentId: beat.id, before: was.beat.id, sceneId: scene.id, dependsOn: addedBy.has(beat.id) ? [addedBy.get(beat.id)!] : [] });
        if (!same(was.line, line)) add({ kind: "modified", target: "line", id: line.id, parentId: beat.id, before: was.line, after: line, ...(was.line.text !== line.text ? { textDiff: textDiff(was.line.text, line.text) } : {}), sceneId: scene.id });
      }
    }
    for (const line of removedLines) if (!claimed.has(line.id)) add({ kind: "removed", target: "line", id: line.id, parentId: oldLineHome.get(line.id)!.beat.id, before: line, sceneId: scene.id });
    for (const beat of old.beats) if (!newBeatIds.has(beat.id)) add({ kind: "removed", target: "beat", id: beat.id, parentId: scene.id, before: without(beat, "lines"), sceneId: scene.id });
    const shotMoves = movedIds(old.shots.map((shot) => shot.id), scene.shots.map((shot) => shot.id));
    for (const shot of scene.shots) {
      const was = old.shots.find((entry) => entry.id === shot.id);
      const dependsOn = [...new Set(shot.lineIds.map((id) => addedBy.get(id)).filter((id): id is string => !!id))];
      if (!was) add({ kind: "added", target: "shot", id: shot.id, parentId: scene.id, after: shot, sceneId: scene.id, dependsOn });
      else {
        if (shotMoves.has(shot.id)) add({ kind: "moved", target: "shot", id: shot.id, parentId: scene.id, sceneId: scene.id });
        if (!same(was, shot)) add({ kind: "modified", target: "shot", id: shot.id, parentId: scene.id, before: was, after: shot, ...(was.description !== shot.description ? { textDiff: textDiff(was.description, shot.description) } : {}), sceneId: scene.id, dependsOn });
      }
    }
    for (const shot of old.shots) if (!scene.shots.some((entry: ScriptShot) => entry.id === shot.id)) add({ kind: "removed", target: "shot", id: shot.id, parentId: scene.id, before: shot, sceneId: scene.id });
  }
  for (const scene of before.scenes) if (!newScenes.has(scene.id)) add({ kind: "removed", target: "scene", id: scene.id, parentId: scene.actId ?? null, before: scene, sceneId: scene.id });

  const totals = { added: 0, removed: 0, moved: 0, modified: 0, wordsAdded: 0, wordsRemoved: 0, durationDelta_ticks: totalTicks(after as ScriptDocument) - totalTicks(before as ScriptDocument) };
  const textOf = (value: unknown): string => (value && typeof value === "object" && "beats" in value ? sceneLines(value as ScriptScene).map((line) => line.text).join(" ") : typeof (value as ScriptLine | undefined)?.text === "string" ? (value as ScriptLine).text : "");
  for (const change of changes) {
    totals[change.kind]++;
    if (change.textDiff) for (const segment of change.textDiff) { if (segment.op === "insert") totals.wordsAdded += words(segment.text); else if (segment.op === "delete") totals.wordsRemoved += words(segment.text); }
    else if (change.kind === "added") totals.wordsAdded += words(textOf(change.after));
    else if (change.kind === "removed") totals.wordsRemoved += words(textOf(change.before));
  }
  return { changes, totals };
}
/** The filter groups of the compare view. */
export const changeGroup = (change: ScriptChange): "text" | "structure" | "shots" | "details" =>
  change.target === "shot" ? "shots" : change.target === "meta" || change.target === "entity" ? "details" : change.target === "line" && change.kind === "modified" ? "text" : change.target === "line" && change.kind !== "moved" ? "text" : "structure";
