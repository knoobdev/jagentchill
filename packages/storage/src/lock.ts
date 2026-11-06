import { systemClock, type Clock } from "./autosave.ts";
import type { StoragePort } from "./port.ts";
import { storageString, type StorageLocale } from "./strings.ts";

/** The owner renews its lock this often; a lock without a heartbeat for longer than the expiry is free. */
export const PROJECT_LOCK_HEARTBEAT_MS = 10_000, PROJECT_LOCK_EXPIRY_MS = 30_000;
type LockRecord = { owner: string; heartbeat_ms: number; requestedBy?: string };
export type ProjectLockRole = "owner" | "reader";
export type ProjectLockView = { role: ProjectLockRole; readOnly: boolean; banner: { text: string; action: { id: "take-over"; label: string } } | null };
/** Wakes the other windows of the profile at once (a `BroadcastChannel`); without one they notice at their next check. */
export type LockSignal = { post(message: { projectId: string }): void; listen(handler: (message: { projectId: string }) => void): () => void };

export type ProjectLockOptions = {
  port: StoragePort; projectId: string;
  /** This editor instance (a window or tab). */
  instanceId: string;
  clock?: Clock; locale?: StorageLocale; signal?: LockSignal;
  /** The owner is asked to give up ownership: it flushes its pending save before the lock moves. */
  onRelinquish?: () => Promise<void>;
  onChange?: (view: ProjectLockView) => void;
};

/**
 * The device-local write lock of a project: only one editor instance writes a given project on a device. A second
 * window opens it read-only with the banner "This project is open in another window" and "Take over". It is
 * independent of the cross-device edit lease.
 */
export function openProjectLock(options: ProjectLockOptions) {
  const { port, projectId, instanceId } = options, clock = options.clock ?? systemClock, key = `lock-${projectId}`;
  let role: ProjectLockRole = "reader", timer: unknown = null, closed = false, unlisten: (() => void) | null = null;
  const read = () => port.getSession<LockRecord>(key);
  const expired = (record: LockRecord) => clock.now() - record.heartbeat_ms > PROJECT_LOCK_EXPIRY_MS;
  const view = (): ProjectLockView => ({
    role, readOnly: role !== "owner",
    banner: role === "owner" ? null : { text: storageString("openInAnotherWindow", {}, options.locale), action: { id: "take-over", label: storageString("takeOver", {}, options.locale) } },
  });
  const setRole = (next: ProjectLockRole) => { if (next !== role) { role = next; options.onChange?.(view()); } };
  const plan = (ms: number) => { if (timer !== null) clock.clearTimeout(timer); timer = closed ? null : clock.setTimeout(() => { timer = null; void check().catch(() => undefined); }, Math.max(1, ms)); };

  async function claim(): Promise<boolean> {
    await port.putSession(key, { owner: instanceId, heartbeat_ms: clock.now() } satisfies LockRecord);
    // Two instances may have written at the same moment: the one whose record is there afterwards owns the project.
    return (await read())?.owner === instanceId;
  }
  async function check(): Promise<void> {
    if (closed) return;
    const record = await read();
    if (role === "owner") {
      if (record && record.owner !== instanceId) { setRole("reader"); plan(PROJECT_LOCK_HEARTBEAT_MS); return; }
      if (record?.requestedBy && record.requestedBy !== instanceId) {
        // "Take over": the pending save is flushed, then the ownership moves and this instance becomes read-only.
        await options.onRelinquish?.().catch(() => undefined);
        await port.putSession(key, { owner: record.requestedBy, heartbeat_ms: clock.now() } satisfies LockRecord);
        setRole("reader");
        options.signal?.post({ projectId });
        plan(PROJECT_LOCK_HEARTBEAT_MS);
        return;
      }
      await port.putSession(key, { owner: instanceId, heartbeat_ms: clock.now() } satisfies LockRecord);
      plan(PROJECT_LOCK_HEARTBEAT_MS);
      return;
    }
    if (!record || expired(record) || record.owner === instanceId) { setRole((await claim()) ? "owner" : "reader"); plan(PROJECT_LOCK_HEARTBEAT_MS); return; }
    // The owner is alive: look again the moment its lock would expire without another heartbeat.
    plan(Math.min(PROJECT_LOCK_HEARTBEAT_MS, record.heartbeat_ms + PROJECT_LOCK_EXPIRY_MS - clock.now() + 1));
  }

  return {
    get view(): ProjectLockView { return view(); },
    /** Opens the project in this instance: as its writer when nobody else is, read-only otherwise. */
    async acquire(): Promise<ProjectLockView> {
      unlisten = options.signal?.listen((message) => { if (message.projectId === projectId) void check().catch(() => undefined); }) ?? null;
      await check();
      return view();
    },
    /** "Take over": asks the owner for the ownership and resolves once this instance writes (at the latest when the owner's lock expires). */
    async takeOver(): Promise<ProjectLockView> {
      if (role === "owner") return view();
      const record = await read();
      if (record && !expired(record) && record.owner !== instanceId) {
        await port.putSession(key, { ...record, requestedBy: instanceId });
        options.signal?.post({ projectId });
      }
      await check();
      return view();
    },
    /** Re-reads the lock now (a signal arrived, the window regained focus). */
    check,
    /** The project was closed in this instance. */
    async release(): Promise<void> {
      closed = true;
      if (timer !== null) { clock.clearTimeout(timer); timer = null; }
      unlisten?.();
      if (role === "owner" && (await read())?.owner === instanceId) await port.deleteSession(key);
      role = "reader";
    },
  };
}
export type ProjectLock = ReturnType<typeof openProjectLock>;
