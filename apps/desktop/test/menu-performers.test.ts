// Reads the sources of the editor to see that every editor action the application menu can dispatch has a performer.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { MENU_ACTIONS, isEditorAction } from "@jagentchill/desktop-core";

const repo = join(import.meta.dirname, "../../..");
const read = (file: string) => readFileSync(join(repo, file), "utf8");
const ids = (source: string) => new Set([...source.matchAll(/"([a-z]+(?:\.[a-z0-9-]+)+)"/g)].map((match) => match[1]));

test("Menu invokes the action: every editor action of the menu is performed by the editor, or is declared not built and shown disabled", () => {
  const dispatcher = ids(read("packages/app-core/src/editor/actions.ts")), runtime = ids(read("apps/app/src/editor/runtime.ts")), player = ids(read("apps/app/src/editor/Player.tsx"));
  const bridge = read("apps/app/src/editor/DesktopMenuBridge.tsx"), screen = ids(read("apps/app/src/editor/EditorScreen.tsx"));
  const notBuilt = ids(/const NOT_BUILT = \[(.*?)\]/s.exec(bridge)![1]);
  const bridged = ids(bridge);
  const editorActions = MENU_ACTIONS.filter((action) => isEditorAction(action) || action === "edit.undo" || action === "edit.redo");
  assert.ok(editorActions.length > 40);
  const unperformed = editorActions.filter((action) => !dispatcher.has(action) && !runtime.has(action) && !player.has(action) && !(bridged.has(action) && (screen.has(action) || /project\.|media\.import/.test(action))) && !notBuilt.has(action));
  assert.deepEqual(unperformed, []);
  // What is not built is exactly this list; it shrinks as the editor grows and never hides a built action.
  assert.deepEqual([...notBuilt].sort(), ["editor.layout.apply", "timeline.multicam.create", "timeline.multicam.flatten", "timeline.speed", "view.focus-mode.toggle"]);
  const cases = new Set([...`${read("packages/app-core/src/editor/actions.ts")}${read("apps/app/src/editor/runtime.ts")}`.matchAll(/case "([^"]+)"/g)].map((match) => match[1]));
  for (const action of notBuilt) assert.equal(cases.has(action), false, `${action} is built: remove it from NOT_BUILT`);
});
