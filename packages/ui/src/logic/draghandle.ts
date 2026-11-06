/**
 * The cursors of drag handles. A handle says what its drag does: a splitter between columns `col-resize`, between rows
 * `row-resize`, an edge that trims or a value that scrubs `ew-resize` / `ns-resize`, a corner its diagonal, a thing that
 * is carried `grab` (and `grabbing` while it is held) or `move`.
 */
export const HANDLE_CURSORS = ["col-resize", "row-resize", "ew-resize", "ns-resize", "nwse-resize", "nesw-resize", "grab", "grabbing", "move", "crosshair", "not-allowed"] as const;
export type HandleCursor = (typeof HANDLE_CURSORS)[number];
export const isHandleCursor = (value: string | null | undefined): value is HandleCursor => (HANDLE_CURSORS as readonly string[]).includes(value ?? "");
/** The cursor while the handle is held: a thing that is carried closes the hand, every other handle keeps its own. */
export const draggingCursor = (cursor: HandleCursor): HandleCursor => (cursor === "grab" ? "grabbing" : cursor);
/** The attribute a handle carries, and the one the document carries while a handle is dragged. */
export const HANDLE_ATTRIBUTE = "data-draghandle", DRAGGING_ATTRIBUTE = "data-dragging";
/**
 * The style sheet of the handles. A handle and everything inside it show the handle's cursor — a pressable inside a
 * handle would otherwise show the hand. While one is dragged the whole document shows its cursor, wherever the pointer
 * goes, and no text can be selected.
 */
export function handleStyleSheet(): string {
  // Repeating the attribute gives a handle itself higher specificity than any ancestor's descendant rule.
  const ownHandles = HANDLE_CURSORS.map((cursor) => `[${HANDLE_ATTRIBUTE}="${cursor}"][${HANDLE_ATTRIBUTE}]{cursor:${cursor} !important}`).join("");
  const regular = HANDLE_CURSORS.map((cursor) =>
    `[${HANDLE_ATTRIBUTE}="${cursor}"],[${HANDLE_ATTRIBUTE}="${cursor}"] *{cursor:${cursor} !important}` +
    `html[${DRAGGING_ATTRIBUTE}="${cursor}"],html[${DRAGGING_ATTRIBUTE}="${cursor}"] *{cursor:${cursor} !important;user-select:none !important;-webkit-user-select:none !important}`).join("");
  return regular + ownHandles;
}
