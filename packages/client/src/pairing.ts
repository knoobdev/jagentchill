import {
  EMPTY_BODY_SHA256, PROTOCOL_VERSION, SIGNATURE_HEADERS, bytesToBase64Url, bytesToHex, enrolContext, handshakeTranscript, utf8,
  type AddressKind, type ErrorEnvelope, type PairingOffer, type Platform, type Role,
} from "@jagentchill/protocol";
import { HostError } from "./errors.ts";
import { verifyHostSignature, type DeviceSigner } from "./signer.ts";
import { randomBytes, sha256 } from "@jagentchill/client/crypto";

export type DeviceInfo = { deviceName: string; platform: Platform; appVersion: string; keyProtection: string };

/** One reachable address for a paired gateway. `origin` is HTTP(S), never a pairing URL. */
export type HostConnectionRecord = {
  id: string;
  kind: "local" | "direct" | "tailnet";
  origin: string;
  /** Original tailnet host:port; native clients route this through their embedded tsnet loopback proxy. */
  tailnetAddress?: string;
  label?: string;
  /** Optional second factor for a direct-network endpoint; kept only in this device's host store. */
  password?: string;
};

/** What the device keeps for a host after pairing. The six-digit code is never stored. */
export type HostRecord = {
  gatewayId: string;
  gatewayPublicKey: string;
  gatewayName: string;
  /** http(s) origin of the host, derived from the address that answered. */
  origin: string;
  /** Reachable addresses for this gateway. Old records are upgraded from `origin` on first read. */
  connections?: HostConnectionRecord[];
  /** The connection selected for ordinary requests; `origin` mirrors this for existing consumers. */
  preferredConnectionId?: string;
  role: Role;
  deviceToken: { value: string; expires_ms: number };
  /** Host clock minus device clock, learnt only from a host-signed timestamp. */
  verifiedClockOffset_ms: number;
};

const isLoopbackOrigin = (origin: string): boolean => {
  try { const hostname = new URL(origin).hostname.replace(/^\[|\]$/g, "").toLowerCase(); return hostname === "localhost" || hostname === "::1" || hostname.startsWith("127."); }
  catch { return false; }
};

const connectionId = (origin: string): string => `origin:${origin}`;

/** Converts today's one-origin record to the connection-list shape without changing its credentials or identity. */
export function migrateHostRecord(record: HostRecord): HostRecord {
  const connections = Array.isArray(record.connections) && record.connections.length
    ? record.connections.filter((connection) => typeof connection.id === "string" && typeof connection.origin === "string")
    : [{ id: connectionId(record.origin), kind: isLoopbackOrigin(record.origin) ? "local" as const : "direct" as const, origin: record.origin }];
  const preferred = connections.find((connection) => connection.id === record.preferredConnectionId) ?? connections[0];
  return { ...record, origin: preferred.origin, connections, preferredConnectionId: preferred.id };
}

/** Merge a newly learned address into the existing profile with the same gateway id. */
export function upsertHostConnectionInProfiles(profiles: HostRecord[], incoming: HostRecord): HostRecord[] {
  const next = migrateHostRecord(incoming);
  const index = profiles.findIndex((profile) => profile.gatewayId === next.gatewayId);
  if (index < 0) return [...profiles, next];
  const current = migrateHostRecord(profiles[index]!);
  const merged = new Map(current.connections!.map((connection) => [connection.id, connection]));
  for (const connection of next.connections!) merged.set(connection.id, connection);
  const preferred = next.connections!.find((connection) => connection.id === next.preferredConnectionId)!;
  const record = migrateHostRecord({ ...current, ...next, connections: [...merged.values()], preferredConnectionId: preferred.id, origin: preferred.origin });
  return profiles.map((profile, i) => i === index ? record : profile);
}

/** The desktop host record is validated by an older, strict bridge schema; keep its connection list in a sidecar key. */
export type HostConnectionStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  delete(key: string): Promise<unknown>;
};
const hostConnectionsKey = (gatewayId: string): string => `host-connections/${gatewayId}`;

/** Reads a desktop sidecar or migrates an old protected-store record without rewriting its credentials. */
export async function loadHostConnections(store: HostConnectionStore, record: HostRecord): Promise<HostRecord> {
  const raw = await store.get(hostConnectionsKey(record.gatewayId));
  if (raw) {
    try {
      const saved = JSON.parse(raw) as Pick<HostRecord, "connections" | "preferredConnectionId">;
      return migrateHostRecord({ ...record, ...saved });
    } catch { /* a malformed sidecar is replaced by the last valid legacy origin below */ }
  }
  const migrated = migrateHostRecord(record);
  await saveHostConnections(store, migrated);
  return migrated;
}

/** Writes only connection metadata to the sidecar; the protected legacy host record keeps identity and token fields. */
export const saveHostConnections = (store: HostConnectionStore, host: HostRecord): Promise<unknown> =>
  store.set(hostConnectionsKey(host.gatewayId), JSON.stringify({ connections: migrateHostRecord(host).connections, preferredConnectionId: migrateHostRecord(host).preferredConnectionId }));

export const deleteHostConnections = (store: HostConnectionStore, gatewayId: string): Promise<unknown> => store.delete(hostConnectionsKey(gatewayId));

const randomBase64Url = (bytes: number) => bytesToBase64Url(randomBytes(bytes));

async function sha256Hex(body: string | undefined): Promise<string> {
  if (body === undefined) return EMPTY_BODY_SHA256;
  return bytesToHex(await sha256(utf8(body)));
}

/** Headers of a per-request signature for `method target` on host `gatewayId`. */
export async function signedHeaders(
  signer: DeviceSigner, gatewayId: string, method: string, target: string, body: string | undefined, clockOffset_ms: number,
): Promise<Record<string, string>> {
  const ts = Date.now() + clockOffset_ms;
  const nonce = randomBase64Url(16);
  const signature = await signer.signRequest({ gatewayId, method, target, bodySha256: await sha256Hex(body), ts, nonce });
  return {
    [SIGNATURE_HEADERS.device]: signer.deviceId,
    [SIGNATURE_HEADERS.timestamp]: String(ts),
    [SIGNATURE_HEADERS.nonce]: nonce,
    [SIGNATURE_HEADERS.signature]: signature,
  };
}

/** One relayed enrolment response: the HTTP status and the body already parsed as JSON (or `null`). */
export type EnrolmentReply = { status: number; body: unknown };

/**
 * The transport of the enrolment flow. Every call of `beginEnrolment` and of the returned `Enrolment` goes through it.
 * The default posts with the global `fetch` from the renderer; the desktop shell injects one that relays to its main
 * process, because the renderer's CSP does not reach a host that is not paired yet.
 */
export type EnrolmentPost = (path: string, body: unknown) => Promise<EnrolmentReply>;

const readReply = <T>(reply: EnrolmentReply): T => {
  const body = reply.body as (T & { error?: ErrorEnvelope }) | null;
  if (reply.status < 200 || reply.status >= 300 || !body) {
    if (body?.error) throw HostError.from(body.error);
    throw new HostError("UNAVAILABLE", `The host answered HTTP ${reply.status}.`, { retryable: true });
  }
  return body;
};

const PAIR_BASE = "/jagentchill/v1/pair";
const VERIFY_PATH = `${PAIR_BASE}/verify`;

/** The default transport: the same requests as before, but the verify step is signed here before it is sent. */
const fetchPost = (origin: string, signer: DeviceSigner, gatewayId: string, offset_ms: () => number, before?: (path: string, body: unknown) => void): EnrolmentPost => async (path, body) => {
  const text = JSON.stringify(body);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (path === VERIFY_PATH) {
    Object.assign(headers, await signedHeaders(signer, gatewayId, "POST", path, text, offset_ms()));
    // Signing takes time: the attempt may have been cancelled meanwhile. Asked again at the last moment before
    // anything leaves the device (throws when the request must not be sent).
    before?.(path, body);
  }
  const response = await fetch(origin + path, { method: "POST", headers, body: text });
  return { status: response.status, body: await response.json().catch(() => null) as unknown };
};

/**
 * True when an enrolment step failed because the address did not answer: the web path's global `fetch` throws a
 * `TypeError`, the desktop shell's relay rejects with the typed `ENROLMENT_REQUEST_FAILED`/`ENROLMENT_TIMEOUT`.
 * Both mean the same thing to the caller — try the next address — while every other error is final.
 */
export function addressUnreachable(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const code = (error as { code?: unknown } | null)?.code;
  return code === "ENROLMENT_REQUEST_FAILED" || code === "ENROLMENT_TIMEOUT";
}

/**
 * Enrols with the first address of `origins` that answers. `attempt` starts the flow for one origin (the desktop shell
 * records that origin in its main process first). An unreachable address lets the next one be tried; any other failure
 * is thrown at once. When no address answers, the typed `GATEWAY_UNREACHABLE` error is thrown — never the transport's
 * own `TypeError`, which carries no code and would surface as a generic failure.
 */
export async function beginEnrolmentAtFirstAddress(
  offer: PairingOffer, origins: string[], attempt: (origin: string) => Promise<Enrolment>,
): Promise<Enrolment> {
  for (const origin of origins) {
    try { return await attempt(origin); } catch (error) { if (!addressUnreachable(error)) throw error; }
  }
  throw new HostError("GATEWAY_UNREACHABLE", "The host did not answer.", { retryable: true });
}

/** `ws://host:port/jagentchill/v1/ws` → `http://host:port`. */
export function originOfAddress(url: string): string {
  const parsed = new URL(url);
  return `${parsed.protocol === "wss:" ? "https:" : "http:"}//${parsed.host}`;
}

/** Keeps the host's active offer identity and expiry while using the direct address that the person just probed. */
export function offerAtDirectOrigin(offer: PairingOffer, origin: string): PairingOffer {
  const address = new URL(origin);
  const protocol = address.protocol === "https:" ? "wss:" : "ws:";
  return { ...offer, addresses: [{ kind: "lan" satisfies AddressKind, url: `${protocol}//${address.host}/jagentchill/v1/ws` }] };
}

export type Enrolment = {
  requestId: string;
  /** First 8 hex characters of the device key fingerprint, shown as "Enter the code shown next to <fingerprint>". */
  fingerprint: string;
  expires_ms: number;
  attemptsRemaining: number;
  /** Sends the code the user read on a trusted device. Resolves with the host record on success. */
  submitCode(code: string): Promise<HostRecord>;
  cancel(): Promise<void>;
};

/**
 * Starts enrolment with the host of `offer` at `origin`: asks for a challenge, authenticates the host BEFORE sending
 * anything further, then proves possession of the device key. The verification code comes afterwards from the user.
 * `relay` replaces the default `fetch` transport (the desktop shell relays the calls through its main process).
 */
export async function beginEnrolment(
  offer: PairingOffer, origin: string, signer: DeviceSigner, info: DeviceInfo, relay?: EnrolmentPost,
  /**
   * `onRequest` is called once the host has a request for this device and has proved who it is — before the proof is
   * sent — with the way to cancel that request. Throwing from it stops the enrolment there.
   * `before` is called before EVERY request of the flow, on the default transport and on an injected one alike;
   * throwing from it means the request is not sent.
   */
  hooks?: { onRequest?(cancel: () => Promise<void>): void; before?(path: string, body: unknown): void },
): Promise<Enrolment> {
  if (Date.now() > offer.expires_ms) throw new HostError("OFFER_EXPIRED", "The pairing offer has expired.");
  // The verify signature uses the offset learnt from the challenge; until then it is unknown.
  let verifiedClockOffset_ms = 0;
  const transport: EnrolmentPost = relay ?? fetchPost(origin, signer, offer.gatewayId, () => verifiedClockOffset_ms, (path, body) => hooks?.before?.(path, body));
  const post: EnrolmentPost = async (path, body) => { hooks?.before?.(path, body); return transport(path, body); };
  const deviceNonce = randomBase64Url(32);
  const sentAt = Date.now();
  const challenge = readReply<{ requestId: string; gatewayNonce: string; ts: number; gatewayId: string; gatewaySignature: string }>(
    await post(`${PAIR_BASE}/challenge`, {
      offerId: offer.offerId, deviceId: signer.deviceId, devicePublicKey: signer.devicePublicKey, deviceNonce,
      deviceName: info.deviceName, platform: info.platform, appVersion: info.appVersion, protocolVersion: PROTOCOL_VERSION,
      keyProtection: info.keyProtection,
    }),
  );
  const fields = {
    context: enrolContext(offer.offerId), gatewayNonce: challenge.gatewayNonce, deviceNonce, ts: challenge.ts,
    gatewayId: offer.gatewayId, protocolVersion: PROTOCOL_VERSION,
  };
  if (challenge.gatewayId !== offer.gatewayId) throw new HostError("GATEWAY_MISMATCH", "This is not the host of the offer.");
  const hostTranscript = handshakeTranscript({ ...fields, role: "gateway", deviceId: signer.deviceId, devicePublicKey: signer.devicePublicKey });
  if (!challenge.gatewaySignature || !(await verifyHostSignature(offer.gatewayPublicKey, hostTranscript, challenge.gatewaySignature))) {
    throw new HostError("GATEWAY_SIGNATURE_INVALID", "This is not the host you are pairing with.");
  }
  verifiedClockOffset_ms = challenge.ts - Math.round((sentAt + Date.now()) / 2);
  const verify = async <T>(payload: unknown): Promise<T> => readReply<T>(await post(VERIFY_PATH, payload));
  const cancel = async (): Promise<void> => { await verify({ requestId: challenge.requestId, action: "cancel" }); };
  hooks?.onRequest?.(cancel);
  const proved = readReply<{ expires_ms: number; attemptsRemaining: number }>(
    await post(`${PAIR_BASE}/prove`, { requestId: challenge.requestId, signature: await signer.signHandshake(fields) }),
  );

  return {
    requestId: challenge.requestId,
    fingerprint: signer.deviceId.slice(0, 8),
    expires_ms: proved.expires_ms,
    attemptsRemaining: proved.attemptsRemaining,
    async submitCode(code) {
      const result = await verify<{ role: Role; gatewayName: string; deviceToken: { value: string; expires_ms: number } }>({ requestId: challenge.requestId, code });
      return {
        gatewayId: offer.gatewayId, gatewayPublicKey: offer.gatewayPublicKey, gatewayName: result.gatewayName, origin,
        role: result.role, deviceToken: result.deviceToken, verifiedClockOffset_ms,
      };
    },
    cancel,
  };
}

/** Thrown to the caller of a flow that was ended or replaced while it was starting; it never concerns the person. */
export class EnrolmentSuperseded extends Error {}

/** An enrolment of a flow: `live()` is false once the flow was ended or replaced; `over()` says the host no longer waits (it refused for good). */
export type FlowEnrolment = Enrolment & { live(): boolean; over(): void };

/**
 * One enrolment at a time for a device, from the first request to its end — what a pairing screen needs and the
 * desktop's main process requires (it knows a single enrolment). `begin(origin)` and `end()` tell the shell that an
 * enrolment with that address starts and that it is over (no-ops in a browser); `relay` is the shell's transport,
 * absent on web and mobile, where the client posts with `fetch`. Every rule below holds on BOTH transports: the gate
 * (`mayPost`) sits in front of every request of `beginEnrolment`, whichever transport carries it.
 *
 * States of an attempt, what may still be sent in each, and who cancels the host's request:
 *
 *  idle        nothing exists. `start` → starting.
 *  starting    waits for the flow before it to end, loads the signer, tells the shell (`begin`), sends `challenge`.
 *              May be sent: challenge. The host has no request yet (or its answer is not here): nothing to cancel.
 *              Ended here → the attempt goes on only until the challenge is answered; then → challenged, where the
 *              request is cancelled and the proof is NOT sent. Challenge failed → next address, or failed.
 *  challenged  the host answered and proved who it is; the request id is known and `cancel` exists from this moment.
 *              May be sent: prove. Ended here (or found ended on arrival) → cancel is sent by the end, prove is not.
 *  proved      prove was sent, its answer is awaited. May be sent: nothing more by the start.
 *              Ended here → cancel. The answer is lost or an error → the start itself cancels the request (the host
 *              may well have accepted the proof), then tries the next address or fails.
 *  awaiting    the code step. May be sent: verify with a code, or cancel. Ended here → cancel.
 *              The host refuses for good (attempts, expiry, cancelled there) → the screen says `over()`: no cancel.
 *  verified    the host accepted the code: it no longer waits. Ended → no cancel, release only.
 *  cancelled   the end of any state above: the host is told first (one cancel, when a request exists and the host
 *              still waits), THEN the shell is released, once. After the end only that cancel may be sent; after
 *              the release nothing — a late `prove` or `verify` is refused before it leaves, on either transport.
 *  failed      the start threw: any request that exists was cancelled by the start, the shell is released, and the
 *              error goes to the caller.
 *
 * Asking to end twice (Cancel, the dialog's close, leaving the screen, a newer start) sends one cancel and releases
 * once. A start waits for the end of the flow before it, so two enrolments never overlap in the shell.
 */
export function createEnrolmentFlows(deps: { begin(origin: string): Promise<unknown>; end(): Promise<unknown>; relay?: EnrolmentPost }) {
  type Flow = {
    /** Ended or replaced: only its cancel may still be sent. */
    stale: boolean;
    /** The shell was released: nothing may be sent. */
    released: boolean;
    /** The host is known not to wait for this request (verified, refused for good, or cancelled): no cancel is owed. */
    hostDone: boolean;
    /** The way to cancel the host's request; exists from `challenged` on, per address tried. */
    cancel?: () => Promise<void>;
    /** Resolves when the start has come to rest (it returned or threw). */
    settled: Promise<void>; settle(): void;
    finishing?: Promise<void>;
  };
  let current: Flow | null = null;
  let ending: Promise<void> | null = null;
  const quiet = () => undefined;
  const isCancel = (body: unknown): boolean => (body as { action?: unknown } | null)?.action === "cancel";

  /** The gate in front of every request of a flow, on any transport. */
  const mayPost = (flow: Flow, body: unknown): void => {
    if (flow.released || (flow.stale && !isCancel(body))) throw new EnrolmentSuperseded();
  };
  /** Tells the host its request is cancelled, once, when one exists and the host still waits. */
  const tellHost = (flow: Flow): Promise<void> => {
    const cancel = flow.cancel;
    if (flow.hostDone || !cancel) return Promise.resolve();
    flow.cancel = undefined;
    return cancel().then(() => { flow.hostDone = true; }, quiet);
  };

  function finish(flow: Flow): Promise<void> {
    if (flow.finishing) return flow.finishing;
    flow.stale = true;
    if (current === flow) current = null;
    // The request is known: cancel now, without waiting for whatever answer the start still expects. No request yet:
    // the start is on its way to one — it stops at `challenged` (or fails before), and the request that exists by
    // then is cancelled here.
    const told = flow.cancel || flow.hostDone ? tellHost(flow) : flow.settled.then(() => tellHost(flow));
    const done: Promise<void> = told.then(() => deps.end()).then(quiet, quiet).then(() => { flow.released = true; if (ending === done) ending = null; });
    flow.finishing = done;
    ending = done;
    return done;
  }

  return {
    /**
     * Starts an enrolment with the first address of `origins` that answers. `info` may be a function: it is read
     * after the signer is loaded (how the key is protected is only known then). Rejects with `EnrolmentSuperseded`
     * when the flow was ended meanwhile.
     */
    async start(offer: PairingOffer, origins: string[], loadSigner: () => Promise<DeviceSigner>, info: DeviceInfo | (() => DeviceInfo)): Promise<FlowEnrolment> {
      const before = current ? finish(current) : ending;
      let settle!: () => void;
      const flow: Flow = { stale: false, released: false, hostDone: false, settled: new Promise<void>((resolve) => (settle = resolve)), settle: () => settle() };
      current = flow;
      const check = () => { if (flow.stale) throw new EnrolmentSuperseded(); };
      try {
        if (before) await before;
        check();
        const signer = await loadSigner();
        check();
        const device = typeof info === "function" ? info() : info;
        const enrolment = await beginEnrolmentAtFirstAddress(offer, origins, async (origin) => {
          check();
          await deps.begin(origin);
          check();
          try {
            return await beginEnrolment(offer, origin, signer, device, deps.relay, {
              before: (_path, body) => mayPost(flow, body),
              // challenged: the request exists and can be cancelled from here on; an attempt that was ended stops before its proof.
              onRequest(cancel) { flow.hostDone = false; flow.cancel = cancel; check(); },
            });
          } catch (error) {
            // The start failed with a request on the host (the proof's answer was lost, or it was an error): the host
            // may be waiting for a code. It is told before the next address is tried or the shell is released. An
            // attempt that was ended leaves this to its end.
            if (!flow.stale) await tellHost(flow);
            throw error;
          }
        });
        check();
        return {
          ...enrolment,
          async submitCode(code) { mayPost(flow, { code }); const host = await enrolment.submitCode(code); flow.hostDone = true; return host; },
          cancel: () => finish(flow),
          live: () => !flow.stale,
          over: () => { flow.hostDone = true; },
        };
      } catch (error) {
        // failed: nothing of this attempt stays behind in the shell. One that was ended is being released by that end.
        if (!flow.stale) { flow.settle(); await finish(flow); }
        throw error;
      } finally { flow.settle(); }
    },
    /** Ends the flow in progress, if any. Resolves when the host was told and the shell released. */
    end: (): Promise<void> => (current ? finish(current) : ending ?? Promise.resolve()),
  };
}
