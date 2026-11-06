// The list of every drag handle of the app. A file that binds a drag (a pan responder, a pointer binding, a splitter)
// must be in this list — with the handles it holds, which then go through the one primitive of `packages/ui`
// (`dragHandle` / `markDragHandle` / `holdDragCursor`), or with the reason its drag is not a handle. A resize or
// carry cursor written by hand anywhere else fails as well: that is how a handle used to end up with the hand cursor.
// Run: node --test apps/app/src/platform/dragHandles.test.ts
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { HANDLE_CURSORS, draggingCursor, handleStyleSheet } from "../../../../packages/ui/src/logic/draghandle.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
/** Handles: what the person drags → the cursor it shows. */
export const HANDLES: Record<string, string[]> = {
  "packages/ui/src/panels.tsx": ["splitter between two panels side by side → col-resize", "splitter between two panels one above the other → row-resize"],
  "packages/ui/src/overlay.tsx": ["side sheet: its inner edge → col-resize"],
  "packages/ui/src/table.tsx": ["table: the edge of a column header → col-resize"],
  "packages/ui/src/number.tsx": ["number field: its label scrubs the value → ew-resize (the pointer is locked and hidden while it drags)"],
  "packages/ui/src/tabs.tsx": ["tab strip: a tab carried to another place → grabbing once it moves (a resting tab is a button)"],
  "packages/ui/src/tree.tsx": ["tree: a row carried to another place → grabbing once it moves (a resting row is a button)"],
  "apps/app/src/platform/store.web.ts": ["bindSplitter — the binding of the app's own splitters → col-resize"],
  "apps/app/src/shell/Shell.tsx": ["sidebar: its edge → col-resize"],
  "apps/app/src/editor/AgentPanel.tsx": ["editor: the agent panel's edge → col-resize"],
  "apps/app/src/film/FilmAgentPanel.tsx": ["film: the assistant panel's edge → col-resize"],
  "apps/app/src/film/Progress.tsx": ["film: the progress panel's edge → col-resize"],
  "apps/app/src/scripts/ScriptEditorScreen.tsx": ["script editor: the navigator's edge → col-resize", "script editor: the inspector's edge → col-resize"],
  "apps/app/src/editor/dom.web.ts": ["setCursor — the cursor of a surface that draws its own handles goes through the primitive"],
  "apps/app/src/editor/Timeline.tsx": ["timeline: a clip's start and end edge (trim) → ew-resize", "timeline: a clip's body (move) → grab, grabbing while held", "timeline: a locked clip → not-allowed", "timeline: the blade tool → col-resize", "timeline: a marker flag on the ruler → ew-resize"],
  "apps/app/src/editor/Player.tsx": ["preview: corner handles → nwse-resize / nesw-resize (turned with the picture)", "preview: edge handles → ns-resize / ew-resize (turned with the picture)", "preview: the rotate handle → grab, grabbing while held", "preview: the selected picture → move", "preview: Space or the middle button pans the zoomed view → grab, grabbing while held"],
  "apps/app/src/editor/fx/TimelineLayer.tsx": ["timeline: an effect's bar (its range) → ew-resize"],
  "apps/app/src/editor/fx/inspector.tsx": ["inspector: the grip that reorders an effect → grab, grabbing while held"],
  "apps/app/src/editor/graph/GraphEditor.tsx": ["graph editor: its bottom edge (height) → ns-resize", "graph editor: keyframe points and easing handles → grab, grabbing while held"],
  "apps/app/src/editor/timeline/KeyframeLanes.tsx": ["timeline: keyframe diamonds → grab, grabbing while held"],
  "apps/app/src/editor/inspector/SpeedTab.tsx": ["inspector: speed-curve points → grab, grabbing while held"],
  "apps/app/src/editor/inspector/AdjustmentTab.tsx": ["inspector: tone-curve points and colour-wheel puck → grab, grabbing while held"],
  "apps/app/src/editor/timeline/ContentLayer.tsx": ["clip: the volume line → ns-resize", "clip: a fade handle → ew-resize", "clip: a volume point → ns-resize", "clip: a beat dot → ew-resize"],
  "apps/app/src/editor/canvas/CanvasTools.tsx": ["preview: the before/after divider → ew-resize"],
  "apps/app/src/workflows/Canvas.tsx": ["workflow canvas: a step (carried) → grab, grabbing while held", "workflow canvas: an output port (draws a connection) → crosshair", "workflow canvas: the canvas itself while it is panned → grabbing"],
  "apps/app/src/workflows/WorkflowEditorScreen.tsx": ["workflow editor: a step in the palette (carried onto the canvas) → grab, grabbing while held"],
  "apps/app/src/workflows/WorkflowAgentPanel.tsx": ["workflow editor: the agent panel edge → col-resize"],
};
/** Drags that are not handles, and why. */
export const NOT_HANDLES: Record<string, string> = {
  "packages/ui/src/slider.tsx": "a slider's thumb: a value control, the arrow stays",
  "packages/ui/src/colorpicker.tsx": "the colour field and its hue bar: a value control",
  "packages/ui/src/toast.tsx": "swipe a toast away: touch gesture",
  "apps/app/src/editor/compact/sheets.tsx": "pull the bottom tool sheet down to close: touch gesture",
};
/** In files that hold handles: the other drags of the same file that are not handles. */
export const ALSO_IN_THOSE_FILES = [
  "packages/ui/src/overlay.tsx — bottom sheet pulled down to close, drawer swiped open/closed: touch gestures",
  "apps/app/src/editor/Timeline.tsx — the ruler (a press places the playhead), the scroll bar's thumb: the arrow stays",
  "apps/app/src/editor/Player.tsx — the bar that wakes in full screen: no drag",
  "apps/app/src/editor/canvas/CanvasTools.tsx — mask, crop and eyedropper tools take the preview's own pointer binding (Player.tsx)",
];

const SKIP = new Set(["node_modules", "catalogue", "dist", ".expo"]);
function sources(folder: string, found: string[] = []): string[] {
  for (const name of readdirSync(folder)) {
    if (SKIP.has(name)) continue;
    const path = join(folder, name);
    if (statSync(path).isDirectory()) sources(path, found);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !/\.d\.ts$/.test(name)) found.push(path);
  }
  return found;
}
const files = [...sources(join(root, "packages/ui/src")), ...sources(join(root, "apps/app/src")), ...sources(join(root, "apps/app/app"))].map((path) => ({ path: relative(root, path), text: readFileSync(path, "utf8") }));
// A pointer binding on the web twin of a native file is the same binding: `x.web.ts` and `x.ts` count as one.
const BINDS = /PanResponder\.create|\bbindSplitter\(|\bbindPointer\(/;
const USES = /\bdragHandle\(|\bmarkDragHandle\(|\bholdDragCursor\(|\bsetCursor\(|\bbindSplitter\(/;
const DEFINES = new Set(["apps/app/src/platform/store.ts", "apps/app/src/editor/dom.ts"]);
/** Per-case evidence when one source file owns several distinct handles. One primitive call in a file must not cover all of them. */
const MULTI_HANDLE_EVIDENCE: Record<string, RegExp[]> = {
  "packages/ui/src/panels.tsx": [/horizontal \? "col-resize"/, /: "row-resize"/],
  "apps/app/src/scripts/ScriptEditorScreen.tsx": [/navigatorSplitter/, /inspectorSplitter/],
  "apps/app/src/editor/Timeline.tsx": [/zone === "trim-start" \|\| zone === "trim-end"/, /zone \? "grab"/, /zone && locked/, /mode === "blade"/, /tl-ctl-marker/],
  "apps/app/src/editor/Player.tsx": [/handleCursor\(handle, box\.rotation\)/, /handleCursor\(handle, box\.rotation\)/, /handle === "rotate"/, /hitTest\(state\.boxes/, /info\.button === 1 \|\| \(info\.button === 0 && spaceHeld\.current\)/],
  "apps/app/src/editor/graph/GraphEditor.tsx": [/testID="graph-resize"/, /hit \? "grab" : "default"/],
  "apps/app/src/editor/timeline/ContentLayer.tsx": [/testID="volume-line"/, /testID=\{props\.side === "fadeIn" \? "fade-handle-in"/, /testID="volume-point"/, /testID="beat-dot"/],
  "apps/app/src/workflows/Canvas.tsx": [/hover\.port && props\.mode === "edit" \? "crosshair"/, /hover\.node && props\.mode === "edit" \? "grab"/, /drag\?\.kind === "pan" \|\| drag\?\.kind === "move" \? "grabbing"/],
};

test("every file that binds a drag is in the list of handles, or in the list of drags that are not handles", () => {
  const unknown = files.filter((file) => BINDS.test(file.text) && !DEFINES.has(file.path) && !(file.path in HANDLES) && !(file.path in NOT_HANDLES)).map((file) => file.path);
  assert.deepEqual(unknown, [], `a drag was added without saying what it is — add it to HANDLES (and give it dragHandle(...)) or to NOT_HANDLES in ${relative(root, fileURLToPath(import.meta.url))}`);
});
test("every file in the list of handles goes through the primitive, and none of them is gone", () => {
  for (const path of Object.keys(HANDLES)) {
    const file = files.find((entry) => entry.path === path);
    assert.ok(file, `${path} is in the list but not in the tree`);
    assert.match(file.text, USES, `${path} holds handles but does not use dragHandle / markDragHandle / holdDragCursor`);
  }
  for (const path of Object.keys(NOT_HANDLES)) assert.ok(files.some((entry) => entry.path === path), `${path} is in the list but not in the tree`);
});
test("each listed handle in a multi-handle file has its own source evidence", () => {
  for (const [path, evidence] of Object.entries(MULTI_HANDLE_EVIDENCE)) {
    assert.equal(evidence.length, HANDLES[path]?.length, `${path}: one check per listed handle`);
    const file = files.find((entry) => entry.path === path);
    assert.ok(file, `${path} exists`);
    evidence.forEach((pattern, index) => assert.match(file.text, pattern, `${path}: ${HANDLES[path]![index]}`));
  }
});
test("no resize or carry cursor is written by hand: only the primitive sets one", () => {
  const byHand = /cursor["']?\s*[:=]\s*["'](col-resize|row-resize|ew-resize|ns-resize|nwse-resize|nesw-resize|grab|grabbing|move)["']/;
  const found = files.filter((file) => file.path !== "packages/ui/src/logic/draghandle.ts" && byHand.test(file.text)).map((file) => file.path);
  assert.deepEqual(found, []);
});
test("the style sheet: a handle and what is inside it show its cursor; while it is dragged the whole document does, and text cannot be selected", () => {
  const css = handleStyleSheet();
  for (const cursor of HANDLE_CURSORS) {
    assert.ok(css.includes(`[data-draghandle="${cursor}"],[data-draghandle="${cursor}"] *{cursor:${cursor} !important}`), cursor);
    assert.ok(css.includes(`html[data-dragging="${cursor}"],html[data-dragging="${cursor}"] *{cursor:${cursor} !important;user-select:none !important`), cursor);
  }
  assert.equal(draggingCursor("grab"), "grabbing");
  for (const cursor of ["col-resize", "row-resize", "ew-resize", "ns-resize", "nwse-resize", "nesw-resize", "move"] as const) assert.equal(draggingCursor(cursor), cursor);
});
