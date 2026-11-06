/**
 * What this device still has to tell a host: exports that ended. An export is told to the host that was the device's
 * host when it ended; it stays here — on the device, over restarts — until that host has answered, so a connection
 * that drops between the export and the answer loses nothing. The host knows an export by its id and starts nothing
 * twice for it, so telling again is always safe. Nothing leaves the list by itself: not by age, not because the list
 * grew, and not because the host REFUSED it — a device that lacks the permission today can be given it tomorrow, a
 * host can be updated. An event leaves only when the host has it, or when the person removes it (`remove`). One the
 * host refused keeps the refusal (`refused`), so that the screen can say why it still waits.
 */
export type PendingEvent = { id: string; hostId: string; event: "export.finished" | "export.failed"; fields: Record<string, string | number>; queued_ms: number; /** The host answered, and its answer was no: with which code, and when. Cleared by nothing but delivery. */ refused?: { code: string; at_ms: number } };
export type OutboxStore = { get(key: string): string | null; set(key: string, value: string): void };
const KEY = "automation.events.pending";
/** The host's own "no" to this event (as against no answer at all): the event is KEPT with it, and the ones after it are still told. */
const REFUSALS = ["INVALID_PARAMS", "SCOPE_DENIED", "PERMISSION_DENIED", "METHOD_NOT_FOUND"];
const refusalOf = (error: unknown): string | undefined => { const code = String((error as { code?: unknown } | null)?.code); return REFUSALS.includes(code) ? code : undefined; };
/** Why the host said no, as a screen tells it apart: the device may not tell the host (permission), or the host does not take such an event (another version). */
export const refusalKind = (code: string): "permission" | "not_accepted" => (code === "SCOPE_DENIED" || code === "PERMISSION_DENIED" ? "permission" : "not_accepted");

export function createEventOutbox(store: OutboxStore, now: () => number = Date.now) {
  const parse = (): PendingEvent[] => {
    try { const list = JSON.parse(store.get(KEY) ?? "[]") as PendingEvent[]; return Array.isArray(list) ? list.filter((entry) => entry && typeof entry.id === "string" && typeof entry.hostId === "string") : []; } catch { return []; }
  };
  // The list as this app holds it: the store is its copy on the device. A store that cannot be written (full, gone)
  // loses nothing while the app runs — the list in memory is what is told.
  let held = parse();
  const listeners = new Set<() => void>();
  const read = (): PendingEvent[] => held;
  const write = (list: PendingEvent[]): void => {
    held = list;
    try { store.set(KEY, JSON.stringify(list)); } catch { /* kept in memory */ }
    for (const listener of listeners) listener();
  };
  let flushing: Promise<{ sent: number; left: number; refused: number }> | null = null;
  return {
    pending: (hostId?: string): PendingEvent[] => read().filter((entry) => !hostId || entry.hostId === hostId),
    /** Kept before anything is sent: an event is never only "on its way". */
    add(entry: Omit<PendingEvent, "queued_ms">): void {
      const list = [...read()];
      if (!list.some((known) => known.id === entry.id && known.hostId === entry.hostId)) list.push({ ...entry, queued_ms: now() });
      write(list);
    },
    /** The person's own decision: these exports are not told to the host any more (all that wait for the host, or one). */
    remove(hostId: string, id?: string): void { write(read().filter((known) => !(known.hostId === hostId && (id === undefined || known.id === id)))); },
    /** Called whenever the list changes. */
    subscribe(listener: () => void): () => void { listeners.add(listener); return () => void listeners.delete(listener); },
    /**
     * Tells the host everything that waits for it, oldest first. An event leaves the list only when the host has taken
     * it. One the host refuses stays, marked with the refusal, and the next is told (the host is there); the first
     * failure of another kind — no connection, a timeout — ends this attempt and everything left is told at the next one.
     */
    flush(hostId: string, send: (entry: PendingEvent) => Promise<unknown>): Promise<{ sent: number; left: number; refused: number }> {
      flushing ??= (async () => {
        let sent = 0;
        const same = (known: PendingEvent, entry: PendingEvent): boolean => known.id === entry.id && known.hostId === entry.hostId;
        try {
          for (const entry of read().filter((known) => known.hostId === hostId)) {
            try { await send(entry); sent += 1; write(read().filter((known) => !same(known, entry))); }
            catch (error) {
              const code = refusalOf(error);
              if (!code) break;
              write(read().map((known) => (same(known, entry) ? { ...known, refused: { code, at_ms: now() } } : known)));
            }
          }
        } finally { flushing = null; }
        const left = read().filter((known) => known.hostId === hostId);
        return { sent, left: left.length, refused: left.filter((known) => known.refused).length };
      })();
      return flushing;
    },
  };
}
export type EventOutbox = ReturnType<typeof createEventOutbox>;
