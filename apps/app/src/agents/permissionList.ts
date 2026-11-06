import type { PermissionRequest } from "@jagentchill/protocol";

/**
 * The permission requests of a session after its list was read again (first load, or a reconnect). The host's list is
 * the truth for that session: what this device still held from before is replaced by it — a request another device
 * answered while this one was away is no longer "pending". Only what arrived as an event WHILE the list was on its way
 * is newer than the list and wins over it. The requests of other sessions are left as they are.
 */
export function mergeFetchedPermissions(held: readonly PermissionRequest[], sessionKey: string, listed: readonly PermissionRequest[], during: ReadonlyMap<string, PermissionRequest>): PermissionRequest[] {
  const fresh = listed.map((entry) => during.get(entry.requestId) ?? entry);
  const added = [...during.values()].filter((entry) => entry.sessionKey === sessionKey && !listed.some((own) => own.requestId === entry.requestId));
  return [...held.filter((entry) => entry.sessionKey !== sessionKey), ...fresh, ...added].sort((a, b) => a.created_ms - b.created_ms);
}
