/**
 * "Reload" into a waiting build of the web app. The new worker takes over only when the page is really going to reload:
 * an export running in this tab, or work that is not saved yet, is looked at FIRST — the browser would ask before
 * leaving such a page, and a person who then stays must still be on the worker they had.
 */
export type ReloadGate = {
  exporting(): boolean;
  /** Finishes the saves of this page (`unsavedWork.ts`): called once. */
  settle(): Promise<void>;
  /** Whether leaving would lose work. Must change nothing: it is asked repeatedly. */
  unsaved(): boolean;
  waiting(): { postMessage(message: unknown): void } | null;
  /** Runs `run` once, when the waiting worker has taken over this page. */
  onTakeover(run: () => void): void;
  reload(): void;
  sleep(ms: number): Promise<void>;
};
/** A save that is being written gets this long to finish before "Reload" is refused. */
export const SAVE_WAIT_MS = 3000;
const SAVE_POLL_MS = 100;

export async function reloadIntoUpdate(gate: ReloadGate): Promise<"reloading" | "export" | "unsaved"> {
  if (gate.exporting()) return "export";
  // The last change is written now, once; after that the page is only looked at until the save has landed.
  let settled = false;
  void gate.settle().then(() => { settled = true; }, () => { settled = true; });
  for (let waited = 0; !settled || gate.unsaved(); waited += SAVE_POLL_MS) {
    if (waited >= SAVE_WAIT_MS) return "unsaved";
    await gate.sleep(SAVE_POLL_MS);
  }
  if (gate.exporting()) return "export";
  const waiting = gate.waiting();
  if (!waiting) { gate.reload(); return "reloading"; }
  gate.onTakeover(gate.reload);
  waiting.postMessage({ type: "activate" });
  return "reloading";
}
