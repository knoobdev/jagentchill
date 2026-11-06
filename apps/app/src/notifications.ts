import { useSyncExternalStore } from "react";
import type { InboxNotice, NoticeCategory } from "@jagentchill/app-core";
import { preferenceStore } from "./platform/store";

/** One entry of the notification centre: something that happened in this app on this device, or that the host says waits for the person. */
export type Notice = InboxNotice;
const KEY = "jagentchill.notifications", LIMIT = 100;
let entries: Notice[] = (() => { try { const stored = JSON.parse(preferenceStore.get(KEY) ?? "[]") as Notice[]; return Array.isArray(stored) ? stored.filter((entry) => entry && typeof entry.message === "string") : []; } catch { return []; } })();
const listeners = new Set<() => void>();
/** Told once for every entry that is new (or that waits again): what shows it outside the app listens here. */
const arrivals = new Set<(notice: Notice) => void>();
const arrived = (notice: Notice) => { for (const listener of arrivals) listener(notice); };
const publish = (next: Notice[]) => { entries = next.slice(0, LIMIT); try { preferenceStore.set(KEY, JSON.stringify(entries)); } catch { /* the inbox lives for the session */ } for (const listener of listeners) listener(); };

/** The inbox of this device: fed by what really happened here — finished and failed operations, storage warnings. Newest first. */
export const notifications = {
  /** `quiet`: the entry is listed without being announced outside the app (what was already waiting when this device connected). */
  add(notice: { kind: Notice["kind"]; message: string; route?: string; subject?: string; category?: NoticeCategory; quiet?: boolean }): void {
    const { quiet, ...given } = notice;
    // An entry about a subject waits for a decision: unless its feed names another kind, that is "the agent needs you".
    const fields = given.subject && !given.category ? { ...given, category: "needs-you" as const } : given;
    // One entry per waiting subject: a reminder renews it instead of adding a second one.
    if (fields.subject && entries.some((entry) => entry.subject === fields.subject && !entry.resolved)) {
      const same = entries.find((entry) => entry.subject === fields.subject && !entry.resolved)!;
      // Said again with the same words (a list read again on reconnect): nothing new.
      if (same.message === fields.message) return;
      publish(entries.map((entry) => (entry === same ? { ...entry, ...fields, at_ms: Date.now(), read: false } : entry)));
      if (!quiet) arrived(entries.find((entry) => entry.id === same.id)!);
      return;
    }
    // Text alone is not identity: two sessions can ask for the same thing, and
    // two runs can finish with the same words. Only collapse a matching event.
    const duplicate = entries.find((entry) => entry.message === fields.message && entry.subject === fields.subject && entry.route === fields.route && entry.category === fields.category && Date.now() - entry.at_ms < 60_000);
    if (duplicate) return;
    const entry: Notice = { ...fields, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at_ms: Date.now(), read: false };
    publish([entry, ...entries]);
    if (!quiet) arrived(entry);
  },
  /** Called for every entry that is new or waits again. */
  onArrival(listener: (notice: Notice) => void): () => void { arrivals.add(listener); return () => void arrivals.delete(listener); },
  markRead(id: string, read = true): void { if (entries.some((entry) => entry.id === id && entry.read !== read)) publish(entries.map((entry) => (entry.id === id ? { ...entry, read } : entry))); },
  /** Takes one entry out of the list. */
  remove(id: string): void { if (entries.some((entry) => entry.id === id)) publish(entries.filter((entry) => entry.id !== id)); },
  /** The subject of an entry no longer waits (decided on any device, or ended): the entry stays as history, no longer new, with what became of it. */
  resolve(subject: string, message?: (was: string) => string): void {
    if (entries.some((entry) => entry.subject === subject && !entry.resolved)) publish(entries.map((entry) => (entry.subject === subject && !entry.resolved ? { ...entry, kind: "info" as const, read: true, resolved: true, ...(message ? { message: message(entry.message) } : {}) } : entry)));
  },
  markAllRead(): void { if (entries.some((entry) => !entry.read)) publish(entries.map((entry) => ({ ...entry, read: true }))); },
  clear(): void { publish([]); },
  list: (): Notice[] => entries,
  subscribe(listener: () => void): () => void { listeners.add(listener); return () => void listeners.delete(listener); },
};
export function useNotifications(): Notice[] {
  return useSyncExternalStore(notifications.subscribe, notifications.list, notifications.list);
}
