import { randomUUID } from "node:crypto";
import {
  HOST_BATCH_WAIT_MS, HOST_PRINCIPAL_PATTERN, HOST_YIELD_MS, LEASE_DURATION_MS, LEASE_FLUSH_WAIT_MS, TAKEOVER_COOLDOWN_MS, TAKEOVER_COUNTDOWN_MS, docKey,
  type DocRef, type Lease, type LeaseEvent, type TakeoverRequest,
} from "@jagentchill/protocol";
import { ProtocolError } from "../errors.ts";

export type LeaseCaller = { deviceId: string; connId: string; clientInstanceId: string };
type Waiter<T> = { resolve(value: T): void; reject(error: Error): void };
type Pending = { requester: LeaseCaller; request: TakeoverRequest; waiter: Waiter<Lease> };
type Offer = { target: string; request: TakeoverRequest; waiter: Waiter<{ accepted: true; lease: Lease }> };
export type LeaseDeps = {
  now: () => number;
  deviceName: (deviceId: string) => string;
  /** The name of a host principal as a person may be shown it (an agent's own name, else what it is) — never the principal. */
  principalName?: (principal: string) => string;
  /** Who a holder is, as facts for a screen to word (`AuthorDisplay`). */
  display?: (holder: { kind: "device"; deviceId: string } | { kind: "host"; principal: string }) => import("@jagentchill/protocol").AuthorDisplay;
  /** Every lease change goes to the document's subscribers and to the connections named here. */
  emit: (event: LeaseEvent, connIds: string[]) => void;
  /** The lease left a device or a host principal: the operations since the last snapshot are folded into one. */
  onReleased: (doc: DocRef) => void;
  audit?: (actor: string, action: string, details: Record<string, unknown>) => void;
  /** Test only: how long a device's `acquire` waits for a running host batch. */
  hostYieldMs?: number;
  hostBatchWaitMs?: number;
};
const notHeld = () => new ProtocolError("LEASE_NOT_HELD", "This connection does not hold the edit lease.", { httpStatus: 409 });

/**
 * The single-writer edit lease of synced projects and scripts. Leases live in memory: after a restart of the server
 * every lease is free and the former holders learn it from their next heartbeat.
 */
export function createLeaseManager(deps: LeaseDeps) {
  const { now } = deps;
  const leases = new Map<string, Lease>(), requests = new Map<string, Pending>(), offers = new Map<string, Offer>(), cooldowns = new Map<string, number>();
  /** Host batches of one document run one at a time, in arrival order. */
  const hostTail = new Map<string, Promise<void>>(), hostDone = new Map<string, Promise<void>>();

  function free(doc: DocRef, reason: LeaseEvent["reason"], previous?: Lease): void {
    leases.delete(docKey(doc));
    deps.onReleased(doc);
    deps.emit({ doc, lease: null, reason, ...(previous?.holder.kind === "device" ? { previousHolderDeviceId: previous.holder.deviceId } : {}) }, previous?.holder.kind === "device" ? [previous.holder.connId] : []);
  }
  /** The lease of a document, or null. A lease whose time passed without a heartbeat is free from that moment. */
  function current(doc: DocRef): Lease | null {
    const lease = leases.get(docKey(doc));
    if (!lease) return null;
    if (lease.expires_ms > now()) return lease;
    const pending = requests.get(docKey(doc));
    if (pending) { handOver(doc, pending, lease, "handed-over"); return leases.get(docKey(doc)) ?? null; }
    free(doc, "expired", lease);
    return null;
  }
  function grant(doc: DocRef, holder: Lease["holder"], reason: LeaseEvent["reason"], previous?: Lease | null): Lease {
    const acquired_ms = now();
    const lease: Lease = { leaseId: randomUUID(), doc, holder, holderName: holder.kind === "device" ? deps.deviceName(holder.deviceId) : deps.principalName?.(holder.principal) ?? holder.principal, ...(deps.display ? { holderDisplay: deps.display(holder) } : {}), acquired_ms, expires_ms: acquired_ms + LEASE_DURATION_MS };
    leases.set(docKey(doc), lease);
    const before = previous?.holder.kind === "device" ? previous.holder : undefined;
    deps.emit({ doc, lease, reason, ...(before ? { previousHolderDeviceId: before.deviceId } : {}) }, [...(holder.kind === "device" ? [holder.connId] : []), ...(before ? [before.connId] : [])]);
    return lease;
  }
  function handOver(doc: DocRef, pending: Pending, previous: Lease | null, reason: LeaseEvent["reason"]): void {
    requests.delete(docKey(doc));
    if (previous) deps.onReleased(doc);
    pending.waiter.resolve(grant(doc, { kind: "device", ...pending.requester }, reason, previous));
  }
  const held = (lease: Lease, caller: LeaseCaller) => new ProtocolError("LEASE_HELD", "Another writer holds the edit lease.", {
    httpStatus: 409,
    details: {
      holderName: lease.holderName, holderKind: lease.holder.kind, ...(lease.holder.kind === "device" ? { holderDeviceId: lease.holder.deviceId } : { principal: lease.holder.principal }),
      acquired_ms: lease.acquired_ms, expires_ms: lease.expires_ms, sameDevice: lease.holder.kind === "device" && lease.holder.deviceId === caller.deviceId,
    },
  });
  /** Devices waiting for a host batch to end; a queued host batch lets them go first. */
  const devicesWaiting = new Map<string, number>();
  /** A device never gets `LEASE_HELD` because of a host batch: it waits for the batch to be committed. */
  async function waitForHost(doc: DocRef): Promise<void> {
    const key = docKey(doc);
    if (leases.get(key)?.holder.kind !== "host") return;
    const deadline = Date.now() + (deps.hostYieldMs ?? HOST_YIELD_MS);
    devicesWaiting.set(key, (devicesWaiting.get(key) ?? 0) + 1);
    try {
      while (leases.get(key)?.holder.kind === "host" && Date.now() < deadline) {
        await within(hostDone.get(key) ?? Promise.resolve(), Math.max(1, deadline - Date.now()));
      }
      // A batch that did not finish in time loses the lease to the device; its commit is then refused.
      if (leases.get(key)?.holder.kind === "host") leases.delete(key);
    } finally {
      // Counted until the caller has been granted the lease, which happens before the next timer runs.
      setTimeout(() => {
        const left = (devicesWaiting.get(key) ?? 1) - 1;
        if (left > 0) devicesWaiting.set(key, left); else devicesWaiting.delete(key);
      }, 0);
    }
  }

  return {
    current,
    async acquire(doc: DocRef, caller: LeaseCaller): Promise<Lease> {
      await waitForHost(doc);
      const lease = current(doc);
      if (!lease) return grant(doc, { kind: "device", ...caller }, "acquired");
      if (lease.holder.kind === "device" && lease.holder.deviceId === caller.deviceId && lease.holder.clientInstanceId === caller.clientInstanceId) {
        // The same app instance on a new connection: the lease follows it.
        lease.holder = { ...lease.holder, connId: caller.connId };
        lease.expires_ms = now() + LEASE_DURATION_MS;
        deps.emit({ doc, lease, reason: "renewed" }, [caller.connId]);
        return lease;
      }
      throw held(lease, caller);
    },
    /** Push, heartbeat, snapshot commit and version restore are accepted only from the connection that holds the lease. */
    assertHolder(doc: DocRef, leaseId: string, connId: string): Lease {
      const lease = current(doc);
      if (!lease || lease.leaseId !== leaseId || lease.holder.kind !== "device" || lease.holder.connId !== connId) throw notHeld();
      return lease;
    },
    heartbeat(doc: DocRef, leaseId: string, connId: string): Lease {
      const lease = this.assertHolder(doc, leaseId, connId);
      lease.expires_ms = now() + LEASE_DURATION_MS;
      return lease;
    },
    release(doc: DocRef, leaseId: string, connId: string): void {
      const lease = leases.get(docKey(doc));
      // Releasing a lease that is already gone is not an error: the holder only wanted it gone.
      if (!lease || lease.leaseId !== leaseId || lease.holder.kind !== "device" || lease.holder.connId !== connId) return;
      const pending = requests.get(docKey(doc));
      if (pending) handOver(doc, pending, lease, "handed-over");
      else free(doc, "released", lease);
    },
    /** "Request to edit": answered when the holder hands over, declines, or stays silent past the countdown. */
    async requestTakeover(doc: DocRef, caller: LeaseCaller): Promise<Lease> {
      const cooldownKey = `${docKey(doc)}|${caller.deviceId}`, until = cooldowns.get(cooldownKey) ?? 0;
      if (until > now()) throw new ProtocolError("TAKEOVER_COOLDOWN", "The holder declined a moment ago.", { httpStatus: 429, retryable: true, details: { retryAfter_ms: until - now() } });
      await waitForHost(doc);
      const lease = current(doc);
      if (!lease) return grant(doc, { kind: "device", ...caller }, "acquired");
      if (lease.holder.kind !== "device" || lease.holder.deviceId === caller.deviceId || requests.has(docKey(doc))) throw held(lease, caller);
      const request: TakeoverRequest = { deviceId: caller.deviceId, deviceName: deps.deviceName(caller.deviceId), requested_ms: now(), deadline_ms: now() + TAKEOVER_COUNTDOWN_MS, kind: "takeover" };
      const holderConn = lease.holder.connId;
      return new Promise<Lease>((resolve, reject) => {
        requests.set(docKey(doc), { requester: caller, request, waiter: { resolve, reject } });
        deps.emit({ doc, lease, reason: "requested", request }, [holderConn]);
      });
    },
    /** The holder's answer to a request, or a transfer target's answer to an offer. */
    answer(doc: DocRef, caller: LeaseCaller, accept: boolean): { lease: Lease | null } {
      const key = docKey(doc), offer = offers.get(key), lease = current(doc);
      if (offer && offer.target === caller.deviceId) {
        offers.delete(key);
        if (!accept || !lease) {
          offer.waiter.reject(new ProtocolError("TAKEOVER_DECLINED", "The device did not accept the transfer.", { httpStatus: 409, details: { deviceName: deps.deviceName(caller.deviceId), reason: "declined" } }));
          deps.emit({ doc, lease, reason: "offer-ended" }, lease?.holder.kind === "device" ? [lease.holder.connId, caller.connId] : [caller.connId]);
          return { lease };
        }
        deps.onReleased(doc);
        const next = grant(doc, { kind: "device", ...caller }, "transferred", lease);
        offer.waiter.resolve({ accepted: true, lease: next });
        return { lease: next };
      }
      const pending = requests.get(key);
      if (!pending) return { lease };
      if (!lease || lease.holder.kind !== "device" || lease.holder.connId !== caller.connId) throw notHeld();
      if (accept) { handOver(doc, pending, lease, "handed-over"); return { lease: leases.get(key) ?? null }; }
      requests.delete(key);
      cooldowns.set(`${key}|${pending.requester.deviceId}`, now() + TAKEOVER_COOLDOWN_MS);
      pending.waiter.reject(new ProtocolError("TAKEOVER_DECLINED", "The holder keeps editing.", { httpStatus: 409, details: { holderName: lease.holderName, holderDeviceId: lease.holder.deviceId } }));
      deps.emit({ doc, lease, reason: "declined" }, [pending.requester.connId]);
      return { lease };
    },
    /** "Transfer editing to…": the lease moves when the chosen device accepts within 30 seconds; otherwise the holder keeps it. */
    transfer(doc: DocRef, leaseHolder: LeaseCaller, toDeviceId: string, targetConnIds: string[]): Promise<{ accepted: true; lease: Lease }> {
      const lease = current(doc);
      if (!lease || lease.holder.kind !== "device" || lease.holder.connId !== leaseHolder.connId) return Promise.reject(notHeld());
      if (targetConnIds.length === 0 || toDeviceId === leaseHolder.deviceId) return Promise.reject(new ProtocolError("TAKEOVER_DECLINED", "The device is not connected.", { httpStatus: 409, details: { deviceName: deps.deviceName(toDeviceId), reason: "offline" } }));
      const request: TakeoverRequest = { deviceId: leaseHolder.deviceId, deviceName: deps.deviceName(leaseHolder.deviceId), requested_ms: now(), deadline_ms: now() + TAKEOVER_COUNTDOWN_MS, kind: "transfer" };
      return new Promise((resolve, reject) => {
        offers.get(docKey(doc))?.waiter.reject(new ProtocolError("CANCELLED", "Replaced by a newer transfer."));
        offers.set(docKey(doc), { target: toDeviceId, request, waiter: { resolve, reject } });
        deps.emit({ doc, lease, reason: "offered", request }, targetConnIds);
      });
    },
    /** "Take over now" of an admin: immediate; the previous holder keeps its unpushed work as an offline branch. */
    forceTake(doc: DocRef, caller: LeaseCaller): Lease {
      const previous = current(doc), pending = requests.get(docKey(doc));
      if (pending) { requests.delete(docKey(doc)); pending.waiter.reject(held(previous!, pending.requester)); }
      if (previous) deps.onReleased(doc);
      const lease = grant(doc, { kind: "device", ...caller }, "forced", previous);
      deps.audit?.(`device:${caller.deviceId}`, "sync.lease.forceTake", { doc, previousHolder: previous?.holder ?? null });
      return lease;
    },
    host: {
      /**
       * A host principal takes the lease for one batch. It is granted only when no device holds it; behind another
       * host batch it waits its turn, for at most 30 seconds. `null`: a device holds the lease — the batch is the
       * device's to apply.
       */
      async begin(doc: DocRef, principal: string): Promise<{ lease: Lease; valid(): boolean; end(): void } | null> {
        if (!HOST_PRINCIPAL_PATTERN.test(principal)) throw new ProtocolError("INVALID_PARAMS", "A host principal is agent:<id>, run:<id>, film:<id> or automation:<id>.");
        const key = docKey(doc), before = hostTail.get(key) ?? Promise.resolve();
        let finish!: () => void;
        const mine = new Promise<void>((resolve) => { finish = resolve; });
        const chain = before.then(() => mine);
        hostTail.set(key, chain);
        const timedOut = await within(before, deps.hostBatchWaitMs ?? HOST_BATCH_WAIT_MS);
        // A device that asked while the previous batch ran is granted the lease before the next batch starts.
        for (let turn = 0; devicesWaiting.has(key) && turn < 200; turn++) await new Promise((resolve) => setTimeout(resolve, 5));
        const occupied = current(doc);
        if (timedOut && occupied?.holder.kind === "host") { finish(); throw held(occupied, { deviceId: "", connId: "", clientInstanceId: "" }); }
        if (occupied?.holder.kind === "device") { finish(); return null; }
        const lease = grant(doc, { kind: "host", principal }, "acquired");
        hostDone.set(key, mine);
        return {
          lease,
          valid: () => leases.get(key)?.leaseId === lease.leaseId,
          end: () => {
            if (leases.get(key)?.leaseId === lease.leaseId) free(doc, "released", lease);
            if (hostDone.get(key) === mine) hostDone.delete(key);
            if (hostTail.get(key) === chain) hostTail.delete(key);
            finish();
          },
        };
      },
    },
    /** A connection went away: what it was waiting for is cancelled. Its lease stays until it expires or is re-bound. */
    dropConnection(connId: string): void {
      for (const [key, pending] of requests) if (pending.requester.connId === connId) { requests.delete(key); pending.waiter.reject(new ProtocolError("CANCELLED", "The connection closed.")); }
    },
    /** The device was revoked: its leases are free at once. */
    dropDevice(deviceId: string): void {
      for (const lease of [...leases.values()]) if (lease.holder.kind === "device" && lease.holder.deviceId === deviceId) free(lease.doc, "expired", lease);
    },
    /** A document left the host (trash, purge): nobody edits it any more. */
    dropDocument(doc: DocRef): void {
      const lease = leases.get(docKey(doc));
      if (lease) { leases.delete(docKey(doc)); deps.emit({ doc, lease: null, reason: "released" }, lease.holder.kind === "device" ? [lease.holder.connId] : []); }
    },
    /** Time-driven changes: expired leases, countdowns that ended without an answer. Runs every second. */
    sweep(): void {
      for (const lease of [...leases.values()]) current(lease.doc);
      for (const [key, pending] of [...requests]) {
        const lease = leases.get(key) ?? null;
        // No answer by the end of the countdown plus the time a flush may take: the lease moves by itself.
        if (!lease || now() >= pending.request.deadline_ms + LEASE_FLUSH_WAIT_MS) handOver(pending.request.kind === "takeover" ? (lease?.doc ?? parse(key)) : parse(key), pending, lease, "handed-over");
      }
      for (const [key, offer] of [...offers]) {
        if (now() < offer.request.deadline_ms) continue;
        offers.delete(key);
        const lease = leases.get(key) ?? null;
        offer.waiter.reject(new ProtocolError("TAKEOVER_DECLINED", "The device did not accept the transfer.", { httpStatus: 409, details: { deviceName: deps.deviceName(offer.target), reason: "timeout" } }));
        deps.emit({ doc: parse(key), lease, reason: "offer-ended" }, lease?.holder.kind === "device" ? [lease.holder.connId] : []);
      }
      for (const [key, until] of cooldowns) if (until <= now()) cooldowns.delete(key);
    },
  };
}
/** Waits for a promise for at most `ms`; true when the time ran out first. The timer never outlives the wait. */
async function within(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = await Promise.race([promise.then(() => false, () => false), new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(true), ms); })]);
  clearTimeout(timer);
  return timedOut;
}
const parse = (key: string): DocRef => ({ kind: key.slice(0, key.indexOf(":")) as DocRef["kind"], id: key.slice(key.indexOf(":") + 1) });
export type LeaseManager = ReturnType<typeof createLeaseManager>;
