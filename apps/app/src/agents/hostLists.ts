import { useSyncExternalStore } from "react";
import type { HostRecordKind } from "./proposals/notes";

/**
 * Whether the host's lists of a session's permission requests, questions and proposals have answered on this device.
 * The chat decides by those records which messages the host wrote to the agent (`proposals/notes.ts`); until all three
 * have answered (or failed) it does not yet know, and says so instead of guessing from an empty list.
 */
const answered = new Map<string, Set<HostRecordKind>>(), listeners = new Set<() => void>();
const tell = () => { for (const listener of listeners) listener(); };
export const hostLists = {
  /** A list is asked for (again): what was known of it is no longer current. */
  asked(sessionKey: string, kind: HostRecordKind): void { if (answered.get(sessionKey)?.delete(kind)) tell(); },
  /** A list answered, or failed for good: there is nothing more to wait for. */
  answered(sessionKey: string, kind: HostRecordKind): void {
    const kinds = answered.get(sessionKey) ?? new Set<HostRecordKind>();
    if (kinds.has(kind)) return;
    kinds.add(kind); answered.set(sessionKey, kinds); tell();
  },
  ready: (sessionKey: string): boolean => answered.get(sessionKey)?.size === 3,
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
};
export const useHostListsReady = (sessionKey: string): boolean => useSyncExternalStore(hostLists.subscribe, () => hostLists.ready(sessionKey), () => false);
