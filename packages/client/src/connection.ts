import {
  CONNECT_CONTEXT, MIN_PROTOCOL_VERSION, PROTOCOL_VERSION, bytesToBase64Url, handshakeTranscript, utf8,
  type AddressKind, type ErrorEnvelope, type Role, type Scope,
} from "@jagentchill/protocol";
import { HostError } from "./errors.ts";
import type { HostRecord } from "./pairing.ts";
import { verifyHostSignature, type DeviceSigner } from "./signer.ts";
import { randomBytes } from "@jagentchill/client/crypto";

const CLOCK_TOLERANCE_MS = 120_000;
const STORED_OFFSET_TOLERANCE_MS = 5_000;

export type ReadyInfo = {
  connId: string;
  role: Role;
  scopes: Scope[];
  features: Record<string, unknown>;
  serverTime_ms: number;
  transport: AddressKind;
  resumed: boolean;
  /** The name this device is paired under on the host. */
  deviceName?: string;
  /** The highest schema of each synced kind the host understands. */
  maxSchemaVersion?: { project: number; script: number; workflow: number };
};

export type HostEvent = { event: string; stream: string; seq: number; ts_ms: number; payload: any };

export type ConnectOptions = {
  host: HostRecord;
  signer: DeviceSigner;
  clientInstanceId: string;
  /** Called when the host rotated the device token; the new value must be stored before any request is sent. */
  onTokenRotated(token: HostRecord["deviceToken"]): void | Promise<void>;
  onEvent?(event: HostEvent): void;
  onClose?(code: number, reason: string): void;
  /** Injected for platforms whose WebSocket is not the global one. */
  WebSocketImpl?: typeof WebSocket;
  /** Authenticated desktop tsnet route; the secret is sent only in the WebSocket subprotocol handshake. */
  tailnetProxy?: { origin: string; secret: string };
  /** Stop a stalled route so the caller can try another saved connection. */
  connectionTimeoutMs?: number;
};

/** Authentication protocols for the preferred direct route; the password is not put in a URL or a channel frame. */
export function websocketProtocols(host: HostRecord): string[] {
  const connection = host.connections?.find((item) => item.id === host.preferredConnectionId);
  return connection?.password ? [`jagentchill.password.${bytesToBase64Url(utf8(connection.password))}`] : [];
}

export type HostConnection = {
  ready: ReadyInfo;
  call<T = unknown>(method: string, params?: unknown): Promise<T>;
  /** Subscribes to events; returns the function that removes the listener. */
  on(listener: (event: HostEvent) => void): () => void;
  close(): void;
};

/**
 * Opens the product channel to a paired host: hello → challenge → prove → ready. The host is authenticated first —
 * the token and every later frame are sent only after its signature verified over this exchange's fresh nonce.
 */
export function connectHost(opts: ConnectOptions): Promise<HostConnection> {
  const Impl = opts.WebSocketImpl ?? WebSocket;
  const routeOrigin = opts.tailnetProxy?.origin ?? opts.host.origin;
  const url = routeOrigin.replace(/^http/, "ws").replace(/\/$/, "") + "/jagentchill/v1/ws";
  const protocols = websocketProtocols(opts.host);
  if (opts.tailnetProxy) protocols.push(`jagentchill.proxy.${opts.tailnetProxy.secret}`);
  const ws = new Impl(url, protocols);
  const deviceNonce = bytesToBase64Url(randomBytes(32));
  const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
  const listeners = new Set<(event: HostEvent) => void>();
  if (opts.onEvent) listeners.add(opts.onEvent);
  let nextId = 0;
  let stage: "challenge" | "ready-wait" | "ready" = "challenge";

  return new Promise<HostConnection>((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const clearConnectionTimeout = () => { if (timeout) clearTimeout(timeout); timeout = undefined; };
    const fail = (error: HostError) => {
      if (!settled) {
        settled = true;
        clearConnectionTimeout();
        reject(error);
      }
      ws.close();
    };
    const send = (frame: unknown) => ws.send(JSON.stringify(frame));

    ws.onopen = () => {
      send({
        t: "hello", deviceId: opts.signer.deviceId, deviceNonce, protocolVersion: PROTOCOL_VERSION,
        minProtocolVersion: MIN_PROTOCOL_VERSION, capabilities: [], clientInstanceId: opts.clientInstanceId,
      });
    };
    ws.onerror = () => fail(new HostError("GATEWAY_UNREACHABLE", "The host did not answer.", { retryable: true, details: { reason: "no_address_answered" } }));
    ws.onclose = (event) => {
      clearConnectionTimeout();
      const error = new HostError(settled ? "CONNECTION_CLOSED" : closeCode(event.reason), `Connection closed (${event.code} ${event.reason}).`, { retryable: event.code !== 4403 });
      if (!settled) {
        settled = true;
        reject(error);
      }
      for (const waiter of pending.values()) waiter.reject(error);
      pending.clear();
      opts.onClose?.(event.code, event.reason);
    };

    ws.onmessage = (message) => {
      void handle(JSON.parse(String(message.data))).catch((err) => fail(err instanceof HostError ? err : new HostError("INTERNAL", String(err))));
    };

    async function handle(frame: any): Promise<void> {
      if (frame.t === "ping") return send({ t: "pong" });
      if (stage === "challenge" && frame.t === "challenge") {
        if (frame.gatewayId !== opts.host.gatewayId) throw new HostError("GATEWAY_MISMATCH", "A different host answered at this address.");
        const fields = {
          context: CONNECT_CONTEXT, gatewayNonce: frame.gatewayNonce, deviceNonce, ts: frame.ts,
          gatewayId: opts.host.gatewayId, protocolVersion: PROTOCOL_VERSION,
        };
        const hostTranscript = handshakeTranscript({ ...fields, role: "gateway", deviceId: opts.signer.deviceId, devicePublicKey: opts.signer.devicePublicKey });
        if (!frame.gatewaySignature || !(await verifyHostSignature(opts.host.gatewayPublicKey, hostTranscript, frame.gatewaySignature))) {
          throw new HostError("GATEWAY_SIGNATURE_INVALID", "This is not the host you paired with.");
        }
        // A host-signed time far from this device's clock is accepted only when it matches the offset learnt before.
        const offset = frame.ts - Date.now();
        if (Math.abs(offset) > CLOCK_TOLERANCE_MS && Math.abs(offset - opts.host.verifiedClockOffset_ms) > STORED_OFFSET_TOLERANCE_MS) {
          throw new HostError("CLOCK_SKEW", "This device's clock differs from the host.", { details: { offset_ms: offset } });
        }
        stage = "ready-wait";
        send({ t: "prove", signature: await opts.signer.signHandshake(fields), deviceToken: opts.host.deviceToken.value });
        return;
      }
      if (stage === "ready-wait" && frame.t === "ready") {
        // The rotated token is stored before the first request of this connection.
        if (frame.deviceToken) await opts.onTokenRotated(frame.deviceToken);
        stage = "ready";
        settled = true;
        clearConnectionTimeout();
        resolve({
          ready: {
            connId: frame.connId, role: frame.role, scopes: frame.scopes, features: frame.features,
            serverTime_ms: frame.serverTime_ms, transport: frame.transport, resumed: frame.resumed,
            ...(typeof frame.deviceName === "string" ? { deviceName: frame.deviceName } : {}), ...(frame.maxSchemaVersion ? { maxSchemaVersion: frame.maxSchemaVersion } : {}),
          },
          call<T>(method: string, params?: unknown): Promise<T> {
            const id = `c${++nextId}`;
            return new Promise<T>((res, rej) => {
              // A call on a channel that is closing fails like one whose answer never came.
              if (ws.readyState !== 1) return rej(new HostError("CONNECTION_CLOSED", "The connection is closed.", { retryable: true }));
              pending.set(id, { resolve: res as (value: unknown) => void, reject: rej });
              send({ t: "req", id, method, params });
            });
          },
          on(listener) {
            listeners.add(listener);
            return () => void listeners.delete(listener);
          },
          close: () => ws.close(1000),
        });
        return;
      }
      if (frame.t === "res") {
        const waiter = pending.get(frame.id);
        if (!waiter) return;
        pending.delete(frame.id);
        if (frame.ok) waiter.resolve(frame.result);
        else waiter.reject(HostError.from(frame.error as ErrorEnvelope));
        return;
      }
      if (frame.t === "evt") {
        for (const listener of listeners) listener(frame as HostEvent);
      }
    }

    if (Number.isFinite(opts.connectionTimeoutMs) && opts.connectionTimeoutMs! > 0) {
      timeout = setTimeout(() => fail(new HostError("GATEWAY_UNREACHABLE", "The host did not answer in time.", { retryable: true, details: { reason: "connection_timeout" } })), opts.connectionTimeoutMs);
    }
  });
}

/** Tries saved routes in order; only retryable failures may advance to another address. */
export async function connectHostWithFallback(routes: readonly ConnectOptions[]): Promise<HostConnection> {
  let lastError: unknown;
  for (const route of routes) {
    let active = false;
    try {
      const connection = await connectHost({
        ...route,
        onClose: (code, reason) => { if (active) route.onClose?.(code, reason); },
      });
      active = true;
      return connection;
    } catch (error) {
      lastError = error;
      if (!(error as { retryable?: unknown } | null)?.retryable) throw error;
    }
  }
  throw lastError ?? new HostError("GATEWAY_UNREACHABLE", "The host did not answer.", { retryable: true, details: { reason: "no_address_answered" } });
}

function closeCode(reason: string): HostError["code"] {
  const code = reason.split(":")[0];
  return (code || "GATEWAY_UNREACHABLE") as HostError["code"];
}
