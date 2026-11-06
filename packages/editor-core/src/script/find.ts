import type { ScriptDocument, ScriptLineKind } from "@jagentchill/protocol";
import type { ScriptCommand } from "./commands.ts";
import { findLine, findScene, findShot, headingText } from "./model.ts";

/** `script-studio.Find and replace`: plain terms up to 200 characters, never regular expressions. */
export const FIND_TERM_MAX = 200;
export type FindKind = "any" | "dialogue" | "narration" | "action" | "on_screen_text" | "notes" | "shots";
export type FindOptions = {
  matchCase?: boolean; wholeWord?: boolean; kind?: FindKind;
  scope?: { type: "script" } | { type: "act"; actId: string } | { type: "scene"; sceneId: string } | { type: "selection"; lineIds: readonly string[] };
};
export type FindField = "text" | "summary" | "title" | "description" | "onScreenText" | "notes" | "heading";
export type FindMatch = { target: "line" | "scene" | "shot"; id: string; sceneId: string; field: FindField; start: number; end: number; text: string };

const LINE_KINDS: Record<Exclude<FindKind, "any" | "shots">, ScriptLineKind[]> = { dialogue: ["dialogue"], narration: ["narration"], action: ["action"], on_screen_text: ["on_screen_text"], notes: ["visual_note", "sound_note", "transition"] };
const wordChar = (char: string | undefined): boolean => !!char && /[\p{L}\p{N}_]/u.test(char);
/** Every occurrence of `term` in `text`, as `[start, end)` pairs that never overlap. */
export function occurrences(text: string, term: string, options: Pick<FindOptions, "matchCase" | "wholeWord"> = {}): [number, number][] {
  const needle = options.matchCase ? term : term.toLowerCase(), hay = options.matchCase ? text : text.toLowerCase(), out: [number, number][] = [];
  if (!needle) return out;
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + needle.length)) {
    if (options.wholeWord && (wordChar(text[at - 1]) || wordChar(text[at + needle.length]))) continue;
    out.push([at, at + needle.length]);
  }
  return out;
}
/** Matches in document order: per scene its heading and summary, then its lines, then its shots. */
export function findInScript(document: ScriptDocument, term: string, options: FindOptions = {}): FindMatch[] {
  const query = term.slice(0, FIND_TERM_MAX), kind = options.kind ?? "any", scope = options.scope ?? { type: "script" }, matches: FindMatch[] = [];
  if (!query) return matches;
  const scan = (target: FindMatch["target"], id: string, sceneId: string, field: FindField, text: string) => { for (const [start, end] of occurrences(text, query, options)) matches.push({ target, id, sceneId, field, start, end, text }); };
  for (const scene of document.scenes) {
    if (scope.type === "scene" && scene.id !== scope.sceneId) continue;
    if (scope.type === "act" && scene.actId !== scope.actId) continue;
    if (kind === "any" && scope.type !== "selection") {
      // The heading is searched where it is plain text; a linked location is renamed in "Cast and places".
      if (!scene.heading.locationId) scan("scene", scene.id, scene.id, "heading", scene.heading.locationText);
      scan("scene", scene.id, scene.id, "title", scene.title);
      scan("scene", scene.id, scene.id, "summary", scene.summary);
    }
    if (kind !== "shots") for (const beat of scene.beats) for (const line of beat.lines) {
      if (scope.type === "selection" && !scope.lineIds.includes(line.id)) continue;
      if (kind !== "any" && !LINE_KINDS[kind].includes(line.kind)) continue;
      scan("line", line.id, scene.id, "text", line.text);
    }
    if ((kind === "any" || kind === "shots") && scope.type !== "selection") for (const shot of scene.shots) {
      scan("shot", shot.id, scene.id, "description", shot.description);
      scan("shot", shot.id, scene.id, "onScreenText", shot.onScreenText);
      scan("shot", shot.id, scene.id, "notes", shot.notes);
    }
  }
  return matches;
}
/** The results panel: matches grouped by scene, each group named by its number and heading. */
export function groupMatches(document: ScriptDocument, matches: readonly FindMatch[]): { sceneId: string; label: string; matches: FindMatch[] }[] {
  const groups = new Map<string, FindMatch[]>();
  for (const match of matches) groups.set(match.sceneId, [...(groups.get(match.sceneId) ?? []), match]);
  return [...groups].map(([sceneId, list]) => { const scene = findScene(document, sceneId)!; return { sceneId, label: `${document.scenes.indexOf(scene) + 1}. ${headingText(document, scene) || scene.title || "Scene"}`, matches: list }; });
}
/** What a replacement would produce, before applying: the diff list of "Preview". */
export const previewReplace = (matches: readonly FindMatch[], replacement: string): { match: FindMatch; before: string; after: string }[] =>
  matches.map((match) => ({ match, before: match.text, after: match.text.slice(0, match.start) + replacement + match.text.slice(match.end) }));
/** "Replace" (one match) and "Replace all in scope" (all of them): one undo step either way. */
export function replaceMatches(matches: readonly FindMatch[], replacement: string): ScriptCommand<{ replaced: number }> {
  return {
    type: "script.replace", label: matches.length === 1 ? "Replace" : "Replace all",
    run(draft) {
      const grouped = new Map<string, FindMatch[]>();
      for (const match of matches) { const key = `${match.target}:${match.id}:${match.field}`; grouped.set(key, [...(grouped.get(key) ?? []), match]); }
      let replaced = 0;
      for (const list of grouped.values()) {
        const { target, id, field } = list[0];
        const holder: Record<string, unknown> | undefined = target === "line" ? findLine(draft, id)?.line : target === "shot" ? findShot(draft, id)?.shot : field === "heading" ? findScene(draft, id)?.heading : findScene(draft, id);
        if (!holder) continue;
        const key = field === "heading" ? "locationText" : field;
        let text = String(holder[key] ?? "");
        // From the end, so that earlier offsets stay valid.
        for (const match of [...list].sort((a, b) => b.start - a.start)) { if (text.slice(match.start, match.end) !== match.text.slice(match.start, match.end)) continue; text = text.slice(0, match.start) + replacement + text.slice(match.end); replaced++; }
        holder[key] = text;
      }
      return { replaced };
    },
  };
}
