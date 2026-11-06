/**
 * The work a page would lose by being left now. A screen registers what the browser's leave question asks (`ask`, which
 * may write a last change on its way) and, where it saves by itself, how to finish saving (`settle`, run ONCE) and a
 * question that changes nothing (`pending`). "Reload" into a new build settles once and then only looks: asking `ask`
 * again and again would push the editor's save further away each time.
 */
export type UnsavedWork = { settle(): Promise<void> | void; pending(): boolean };
type Guard = { ask: () => boolean; work?: UnsavedWork };
const guards = new Set<Guard>();

export function registerUnsaved(ask: () => boolean, work?: UnsavedWork): () => void {
  const guard: Guard = { ask, work };
  guards.add(guard);
  return () => void guards.delete(guard);
}
/** Finishes every save that can be finished; resolves when they have answered, whatever the answer. */
export async function settleUnsaved(): Promise<void> {
  await Promise.all([...guards].map(async (guard) => { try { await guard.work?.settle(); } catch { /* what is left unsaved is seen by `unsavedPending` */ } }));
}
/** Whether leaving now would lose work. Changes nothing where the screen gave a `pending`. */
export const unsavedPending = (): boolean => [...guards].some((guard) => (guard.work ? guard.work.pending() : guard.ask()));
