import type { ScriptDocument } from "@jagentchill/protocol";
import { addBeat, addLine, deleteLines, mergeLineWithPrevious, setLineKind, splitLine, splitScene, type ScriptCommand } from "./commands.ts";
import { findLine, sceneLines } from "./model.ts";

/**
 * The screenplay typing rules of `script-studio.Formatting shortcuts and typing behaviour`, as pure decisions: which
 * command a key runs on a line and where the caret goes next. In the structured editor a character cue is the speaker
 * field above its dialogue, so "a cue" is a dialogue line whose cue field has the focus.
 */
export type TypingField = "text" | "cue" | "parenthetical" | "location";
export type TypingKey = "Enter" | "Tab" | "ShiftTab" | "Backspace";
export type TypingInput = { key: TypingKey; lineId: string; field: TypingField; caret?: number; /** An input-method composition is active: no rule fires. */ composing?: boolean };
export type TypingOutcome = {
  commands: ScriptCommand<unknown>[];
  /** Where the focus goes: a line named here, or the line (or scene) the last command created. */
  focus: { lineId?: string; created?: boolean; field: TypingField; caret?: number };
};
const run = (focus: TypingOutcome["focus"], ...commands: ScriptCommand<unknown>[]): TypingOutcome => ({ commands, focus });

export function typingRule(document: ScriptDocument, input: TypingInput): TypingOutcome | null {
  if (input.composing) return null;
  const ref = findLine(document, input.lineId);
  if (!ref) return null;
  const { line, beat } = ref, empty = line.text === "", last = ref.lineIndex === beat.lines.length - 1, spoken = line.kind === "dialogue" || line.kind === "narration";
  const blankCue = !line.characterId && !line.speakerText;
  switch (input.key) {
    case "Enter": {
      if (input.field === "cue" || input.field === "parenthetical") return run({ lineId: line.id, field: "text" });
      // An empty action line turns into a character cue on the next Enter.
      if (line.kind === "action" && empty) return run({ lineId: line.id, field: "cue" }, setLineKind([line.id], "dialogue"));
      // An empty line in a beat's last position exits to a new beat.
      if (empty && last && (!spoken || blankCue)) return run({ created: true, field: "text" }, ...(beat.lines.length > 1 ? [deleteLines([line.id])] : []), addBeat(ref.scene.id, beat.id));
      const caret = input.caret ?? line.text.length;
      if (line.kind === "action" && caret < line.text.length) return run({ created: true, field: "text", caret: 0 }, splitLine(line.id, caret));
      return run({ created: true, field: "text" }, addLine({ beatId: beat.id, afterLineId: line.id, kind: "action" }));
    }
    case "Tab": {
      if (line.kind === "action" && empty) return run({ lineId: line.id, field: "cue" }, setLineKind([line.id], "dialogue"));
      if (line.kind === "dialogue" && input.field === "cue" && empty) return run({ lineId: line.id, field: "text" }, setLineKind([line.id], "transition"));
      if (spoken && input.field === "text") return run({ lineId: line.id, field: "parenthetical" });
      return null;
    }
    case "ShiftTab": {
      if (line.kind === "transition" && empty) return run({ lineId: line.id, field: "cue" }, setLineKind([line.id], "dialogue"));
      if (line.kind === "dialogue" && input.field === "cue" && empty) return run({ lineId: line.id, field: "text" }, setLineKind([line.id], "action"));
      if (input.field === "parenthetical") return run({ lineId: line.id, field: "text" });
      return null;
    }
    case "Backspace": {
      if (input.field !== "text" || (input.caret ?? 0) !== 0) return null;
      // An empty typed line becomes action before it is deleted.
      if (empty && line.kind !== "action") return run({ lineId: line.id, field: "text" }, setLineKind([line.id], "action"));
      const lines = sceneLines(ref.scene), at = lines.indexOf(line), previous = lines[at - 1];
      if (empty && previous) return run({ lineId: previous.id, field: "text", caret: previous.text.length }, deleteLines([line.id]));
      if (!empty && line.kind === "action" && ref.lineIndex > 0 && beat.lines[ref.lineIndex - 1].kind === "action") return run({ lineId: beat.lines[ref.lineIndex - 1].id, field: "text", caret: beat.lines[ref.lineIndex - 1].text.length + (beat.lines[ref.lineIndex - 1].text ? 1 : 0) }, mergeLineWithPrevious(line.id));
      return null;
    }
  }
}

const HEADING_PREFIX = /^(INT\.\/EXT\.|INT\.|EXT\.)\s$/i;
/**
 * Rules that fire on what was typed rather than on a key: `(` at the start of dialogue starts a parenthetical, and
 * `INT.` or `EXT.` at the start of an action line converts it to a scene heading.
 */
export function textRule(document: ScriptDocument, lineId: string, text: string, composing = false): TypingOutcome | null {
  if (composing) return null;
  const ref = findLine(document, lineId);
  if (!ref) return null;
  if ((ref.line.kind === "dialogue" || ref.line.kind === "narration") && ref.line.text === "" && text === "(") return run({ lineId, field: "parenthetical" });
  const heading = ref.line.kind === "action" ? HEADING_PREFIX.exec(text) : null;
  if (heading) return run({ created: true, field: "location" }, headingFromLine(lineId, heading[1].toUpperCase() === "INT." ? "INT" : heading[1].toUpperCase() === "EXT." ? "EXT" : "INT_EXT"));
  return null;
}
/** The line becomes the first line of a scene with that setting: a new scene from there on, unless it already opens a scene with no heading. */
export function headingFromLine(lineId: string, setting: "INT" | "EXT" | "INT_EXT"): ScriptCommand<{ sceneId: string; lineId: string }> {
  return {
    type: "script.scene.fromHeading", label: "New scene",
    run(draft, env) {
      const ref = findLine(draft, lineId)!;
      let scene = draft.scenes[ref.sceneIndex];
      const opens = ref.beatIndex === 0 && ref.lineIndex === 0 && scene.heading.setting === "NONE" && !scene.heading.locationText && !scene.heading.locationId;
      if (!opens) { const { sceneId } = splitScene(lineId).run(draft, env) as { sceneId: string }; scene = draft.scenes.find((entry) => entry.id === sceneId)!; }
      scene.heading = { setting, locationText: "", timeOfDay: "" };
      findLine(draft, lineId)!.line.text = "";
      return { sceneId: scene.id, lineId };
    },
  };
}
