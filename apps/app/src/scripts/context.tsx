import { createContext, useContext } from "react";
import type { ScriptDocument } from "@jagentchill/protocol";
import type { script as s } from "@jagentchill/editor-core";
import { carryThroughPortals } from "@jagentchill/ui";
import type { ScriptSession } from "./store";

export type Selection = { sceneId: string | null; lineIds: string[]; shotIds: string[]; /** The one line is where the caret is, not a line the user ticked. */ fromCaret?: boolean };
export type FocusTarget = { lineId?: string; sceneId?: string; field: s.TypingField; caret?: number };
export type InspectorTab = "details" | "selection" | "review" | "versions" | "comments" | "activity";
/** What every pane of the script editor shares: the document on screen, the one way to edit it, and what is selected. */
export type ScriptEditorState = {
  session: ScriptSession;
  /** The document on screen: the head, or a past version being viewed. */
  document: ScriptDocument;
  /** Typing does nothing: a past version is on screen, the script is locked, or it is in review and not being edited by the reviewer. */
  readOnly: boolean;
  /** Runs a command as one undo step. A refusal is shown to the user; `undefined` means nothing was changed. */
  run<I>(command: s.ScriptCommand<I>): I | undefined;
  selection: Selection;
  select(next: Partial<Selection>): void;
  /** Scrolls the script pane to a scene and puts the caret on its first line. */
  goToScene(sceneId: string): void;
  goToLine(lineId: string): void;
  /** Scrolls to a scene and leaves the caret where it is: for a result of the find bar. */
  scrollToScene(sceneId: string): void;
  focus: FocusTarget | null;
  setFocus(target: FocusTarget | null): void;
  /** Lines the find bar matched, to highlight. */
  found: ReadonlySet<string>;
  openInspector(tab: InspectorTab): void;
};
const Context = createContext<ScriptEditorState | null>(null);
carryThroughPortals(Context);
export const ScriptEditorProvider = Context.Provider;
export function useScriptEditor(): ScriptEditorState {
  const state = useContext(Context);
  if (!state) throw new Error("useScriptEditor needs a ScriptEditorProvider");
  return state;
}
