import { deleteHostConnections, loadHostConnections, migrateHostRecord, saveHostConnections, upsertHostConnectionInProfiles, type DeviceSigner, type HostRecord } from "@jagentchill/client";
import { requireDesktop, type BridgeReply } from "./platform/desktop.ts";

/**
 * Device identity in the desktop shell. The key lives in the Electron main process, protected by the OS secret store;
 * this file holds no key material. Signing sends typed fields — the main process builds the text it signs — and the
 * host registry (with the device tokens) is kept by the main process in the same protected store.
 */
export class KeyStorageUnavailable extends Error {
  readonly code = "KEY_STORAGE_UNAVAILABLE";
}
class BridgeRefusal extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;
  constructor(error: { code: string; message: string; details?: Record<string, unknown> }) {
    super(error.message);
    this.code = error.code;
    this.details = error.details;
  }
}
function unwrap<T>(reply: BridgeReply<T>): T {
  if ("value" in reply) return reply.value;
  if (reply.error.code === "KEY_STORAGE_UNAVAILABLE") throw new KeyStorageUnavailable(reply.error.message);
  throw new BridgeRefusal(reply.error);
}

let cached: Promise<DeviceSigner> | undefined;
let protection = "os-store";

export function loadSigner(): Promise<DeviceSigner> {
  cached ??= (async () => {
    const bridge = requireDesktop();
    const info = unwrap(await bridge.device.getPublicKey());
    protection = info.keyProtection;
    const sign = async (kind: "handshake" | "request", fields: unknown) => unwrap(await bridge.device.sign({ kind, fields })).signature;
    return { deviceId: info.deviceId, devicePublicKey: info.devicePublicKey, signHandshake: (fields) => sign("handshake", fields), signRequest: (fields) => sign("request", fields) };
  })();
  cached.catch(() => (cached = undefined));
  return cached;
}

const keyOf = (gatewayId: string) => `host/${gatewayId}`;
const PENDING_OFFER = "identity/pending-offer";
export async function listHosts(): Promise<HostRecord[]> {
  const store = requireDesktop().secureStore;
  const records = await Promise.all((await store.keys("host/")).map(async (key) => { try { return JSON.parse((await store.get(key)) ?? "null") as HostRecord | null; } catch { return null; } }));
  const migrated = await Promise.all(records.filter((record): record is HostRecord => record !== null).map((record) => loadHostConnections(store, record)));
  // This computer's own host comes first.
  return migrated.sort((a, b) => Number((b as { builtIn?: boolean }).builtIn ?? false) - Number((a as { builtIn?: boolean }).builtIn ?? false));
}
export const getHost = async (gatewayId: string): Promise<HostRecord | undefined> => (await listHosts()).find((host) => host.gatewayId === gatewayId);
export async function saveHost(host: HostRecord): Promise<unknown> {
  const store = requireDesktop().secureStore;
  let record = host;
  const pendingKey = `pending-direct/${host.gatewayId}`;
  const pendingRaw = await store.get(pendingKey);
  if (pendingRaw) {
    try {
      const pending = JSON.parse(pendingRaw) as { origin?: string; password?: string };
      if (pending.origin === host.origin && pending.password) {
        record = { ...host, connections: [{ id: `origin:${pending.origin}`, kind: "direct", origin: pending.origin, password: pending.password }], preferredConnectionId: `origin:${pending.origin}` };
      }
    } catch { /* malformed pending data is discarded after a valid host record is saved */ }
    await store.delete(pendingKey);
  }
  const existing = (await listHosts()).find((record) => record.gatewayId === host.gatewayId);
  // A record that carries a connection list IS the list: saving it must be able to drop a connection (an old address
  // of a host, one the person removed). Only a record without a list (the older one-address shape) is merged into what
  // is already known, so that such a save cannot lose connections.
  const migrated = record.connections?.length || !existing ? migrateHostRecord(record) : upsertHostConnectionInProfiles([existing], record)[0]!;
  const { connections: _connections, preferredConnectionId: _preferred, ...legacyRecord } = migrated;
  await store.set(keyOf(host.gatewayId), JSON.stringify(legacyRecord));
  return saveHostConnections(store, migrated);
}
export async function removeHost(gatewayId: string): Promise<unknown> {
  const store = requireDesktop().secureStore;
  await store.delete(keyOf(gatewayId));
  return deleteHostConnections(store, gatewayId);
}
export const savePendingOffer = async (offer: string): Promise<void> => requireDesktop().secureStore.set(PENDING_OFFER, offer);
export const loadPendingOffer = async (): Promise<string | null> => requireDesktop().secureStore.get(PENDING_OFFER);
export const clearPendingOffer = async (): Promise<void> => requireDesktop().secureStore.delete(PENDING_OFFER);

export function devicePlatform(): "web" | "ios" | "android" | "macos" | "windows" | "linux" {
  const platform = requireDesktop().app.platform;
  return platform === "darwin" ? "macos" : platform === "win32" ? "windows" : "linux";
}
/** How this device's key is protected, as the host's device list shows it. */
export const keyProtection = (): string => protection;
export const defaultDeviceName = (): string => "This computer";
/** Pairing starts: the main process signs enrolment transcripts for the host of this offer, and for no other host. */
export const beginPairing = (offer: string, origin: string, proxy?: { port: number; secret: string }): Promise<unknown> => requireDesktop().device.beginEnrolment(offer, origin, proxy);
export const endPairing = (): Promise<unknown> => requireDesktop().device.endEnrolment();
/** One enrolment HTTP step, relayed by the main process: the renderer never picks the origin. */
export async function postEnrolment(step: string, json: string): Promise<{ status: number; body: unknown }> {
  // The bridge returns the outcome as data: an Error thrown across `contextBridge` loses its own `.code`, so the
  // typed refusal is rebuilt here from the envelope instead.
  const reply = await requireDesktop().device.enrolmentPost(step, json);
  if (reply.ok) return { status: reply.status, body: reply.body };
  // A relay that could not reach the address must look like the web path's own `fetch` failure (a `TypeError`), so the
  // caller tries the next address; every other refusal keeps its code (ENROLMENT_INACTIVE, ENROLMENT_BODY_TOO_LARGE…).
  if (reply.code === "ENROLMENT_REQUEST_FAILED" || reply.code === "ENROLMENT_TIMEOUT") throw new TypeError(reply.message);
  throw Object.assign(new Error(reply.message), { code: reply.code });
}
