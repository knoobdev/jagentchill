import { beginDragCursor, markHandle } from "./platform/dom";
import { HANDLE_ATTRIBUTE, type HandleCursor } from "./logic/draghandle.ts";

export { HANDLE_CURSORS, draggingCursor, isHandleCursor, type HandleCursor } from "./logic/draghandle.ts";
/**
 * THE way an element becomes a drag handle. Spread on the view that takes the press:
 * `<View {...dragHandle("col-resize")} {...pan.panHandlers} />`. The handle and everything inside it show that cursor on
 * hover; from the press to the release the whole document shows it (`grab` becomes `grabbing`), also when the pointer
 * has left the handle, and text cannot be selected. `null` (a disabled handle) marks nothing.
 */
export function dragHandle(cursor: HandleCursor | null): object {
  return cursor ? { dataSet: { draghandle: cursor } } : {};
}
/** The same for an element that is bound by hand, and for a surface whose cursor follows what is under the pointer (`null`: nothing to drag here). */
export function markDragHandle(node: unknown, cursor: HandleCursor | null): void { markHandle(node, HANDLE_ATTRIBUTE, cursor); }
/**
 * For a drag that starts on something that is not a handle before it moves (a tab or a row that is pressed, and carried
 * once it has moved): the document shows `cursor` until the returned function is called.
 */
export function holdDragCursor(cursor: HandleCursor): () => void { return beginDragCursor(cursor); }
