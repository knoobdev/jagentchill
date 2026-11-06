import type { StoragePort } from "./port.ts";

/** Media writes never consume the last 50 MiB. */
export const MEDIA_RESERVE_BYTES = 52_428_800;
/** Project record saves, snapshots and backups are allowed to use the reserve down to this floor. */
export const RECORD_FLOOR_BYTES = 5 * 1024 * 1024;

export type CapacityDecision = { allowed: true } | { allowed: false; required: number; available: number };
export type CapacityOptions = {
  /** What is being written: media keeps the whole reserve free; a record may use it down to the floor. */
  kind?: "media" | "record";
  /** Releases evictable cache and returns the bytes it freed; called once before a rejection. */
  evictCache?: (needed: number) => Promise<number>;
};

/**
 * Whether `bytes` may be written. Media: `available − reserve ≥ bytes`. Records: the write must leave at least the
 * floor. With no estimate the write is allowed and a quota error from the store is handled at write time. A rejection
 * carries the required bytes and the bytes available after the reserve.
 */
export async function evaluateStorageCapacity(port: Pick<StoragePort, "available">, bytes: number, options: CapacityOptions = {}): Promise<CapacityDecision> {
  const reserve = options.kind === "record" ? RECORD_FLOOR_BYTES : MEDIA_RESERVE_BYTES;
  let available = await port.available();
  if (available === null) return { allowed: true };
  if (available - reserve < bytes && options.evictCache) {
    await options.evictCache(bytes - (available - reserve));
    available = (await port.available()) ?? available;
  }
  return available - reserve >= bytes ? { allowed: true } : { allowed: false, required: bytes, available: Math.max(0, available - reserve) };
}

/** Sizes shown to the user: binary units with one decimal. */
export function formatBytes(bytes: number): string {
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1024, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toFixed(1)} ${units[unit]}`;
}
/** The one message every caller shows for a rejected write, and its actions. */
export function capacityMessage(name: string, decision: Extract<CapacityDecision, { allowed: false }>, trashBytes = 0): { text: string; actions: string[] } {
  return {
    text: `Not enough storage for ${name} (${formatBytes(decision.required)}). ${formatBytes(decision.available)} available.`,
    actions: [...(trashBytes > 0 ? [`Empty trash (${formatBytes(trashBytes)})`] : []), "Manage storage"],
  };
}
