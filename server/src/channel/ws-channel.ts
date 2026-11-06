import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { z } from "zod";
import {
  CLOSE_CODES, CONNECT_CONTEXT, DEVICE_ID_PATTERN, HANDSHAKE_DEADLINE_MS, MAX_SCHEMA_VERSION, MIN_PROTOCOL_VERSION, PROTOCOL_VERSION,
  base64UrlToBytes, handshakeTranscript, type AddressKind, type Role, type Scope,
} from "@jagentchill/protocol";
import { verifyText } from "../crypto.ts";
import type { DeviceRegistry } from "../devices/registry.ts";
import { ProtocolError } from "../errors.ts";
import type { HostIdentity } from "../identity/host-identity.ts";
import type { ChallengeBook } from "../pairing/challenges.ts";

const MAX_FRAME_BYTES = 1_048_576;
const MAX_CONNECTIONS_PER_DEVICE = 8;
const MAX_IN_FLIGHT = 64;

const helloSchema = z.object({
  t: z.literal("hello"),
  deviceId: z.string().regex(DEVICE_ID_PATTERN),
  deviceNonce: z.string().refine((value) => base64UrlToBytes(value)?.length === 32),
  protocolVersion: z.number().int().positive(),
  minProtocolVersion: z.number().int().positive(),
  capabilities: z.array(z.string().max(64)).max(64),
  clientInstanceId: z.string().min(1).max(64),
  resume: z.object({ streams: z.record(z.number().int().nonnegative()) }).optional(),
});
const proveSchema = z.object({ t: z.literal("prove"), signature: z.string().max(128), deviceToken: z.string().max(128) });
const reqSchema = z.object({
  t: z.literal("req"),
  id: z.string().min(1).max(64),
  method: z.string().min(1).max(128),
  params: z.unknown().optional(),
  idempotencyKey: z.string().min(1).max(128).optional(),
});

export type Connection = {
  connId: string;
  deviceId: string;
  /** The app instance of this connection: a reconnect of the same instance keeps what the old connection held. */
  clientInstanceId: string;
  transport: AddressKind;
  /** Role and scopes are read from the current record on every call, never cached from `ready`. */
  role(): Role | undefined;
  scopes(): readonly Scope[];
  send(event: string, stream: string, payload: unknown): void;
  close(code: number, reason: string): void;
};

export type RpcMethod = {
  scope: Scope;
  handle(params: unknown, connection: Connection): unknown | Promise<unknown>;
};

export type ChannelDeps = {
  host: HostIdentity;
  devices: DeviceRegistry;
  challenges: ChallengeBook;
  now: () => number;
  methods: Map<string, RpcMethod>;
  /** Origin and Host checks; returns the transport tag of the listener the request arrived on, or null to refuse. */
  admit(request: IncomingMessage): AddressKind | null;
  onClose?: (connection: Connection) => void;
  onPresenceChange?: (deviceId: string, online: boolean, transport: AddressKind) => void;
  /** The highest schema of each synced kind this host understands; advertised in `ready`. */
  maxSchemaVersion?: { project: number; script: number; workflow: number };
  /** Features are advertised only when the associated host capability is currently available. */
  features?: () => Record<string, boolean>;
};

type Live = Connection & { socket: WebSocket; seq: Map<string, number> };

/** The product channel: the only channel between a client and a host. */
export function createProductChannel(deps: ChannelDeps) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  const connections = new Map<string, Live>();
  const socketsByTransport = new Map<AddressKind, Set<WebSocket>>();
  const lastTransportByDevice = new Map<string, AddressKind>();
  let shuttingDown = false;

  const connectionsOf = (deviceId: string) => [...connections.values()].filter((c) => c.deviceId === deviceId);

  function handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const transport = deps.admit(request);
    if (!transport) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => accept(ws, transport));
  }

  /** The loopback tsnet ingress has already established its transport out of band. */
  function attachExternalSocket(ws: WebSocket, transport: AddressKind): void {
    accept(ws, transport);
  }

  function accept(ws: WebSocket, transport: AddressKind): void {
    if (shuttingDown) { ws.close(1001, "HOST_SHUTTING_DOWN"); return; }
    const transportSockets = socketsByTransport.get(transport) ?? new Set<WebSocket>();
    transportSockets.add(ws);
    socketsByTransport.set(transport, transportSockets);
    const binding = `conn:${randomUUID()}`;
    let stage: "hello" | "prove" | "ready" = "hello";
    let hello: z.infer<typeof helloSchema> | undefined;
    let challenge: { gatewayNonce: string; ts: number } | undefined;
    let live: Live | undefined;
    let inFlight = 0;

    const deadline = setTimeout(() => ws.close(CLOSE_CODES.handshakeTimeout, "HANDSHAKE_TIMEOUT"), HANDSHAKE_DEADLINE_MS);
    const send = (frame: unknown) => ws.send(JSON.stringify(frame));
    const fail = (err: unknown) => {
      if (err instanceof ProtocolError) {
        const code = err.code === "DEVICE_REVOKED" ? CLOSE_CODES.revoked
          : err.code === "PROTOCOL_UNSUPPORTED" ? CLOSE_CODES.protocolUnsupported
          : err.code === "RATE_LIMITED" ? CLOSE_CODES.limit
          : CLOSE_CODES.unauthenticated;
        const reason = err.code === "PROTOCOL_UNSUPPORTED" ? `PROTOCOL_UNSUPPORTED:${String(err.details?.side ?? "client")}` : err.code;
        ws.close(code, reason);
      } else {
        ws.close(CLOSE_CODES.badFrame, "BAD_FRAME");
      }
    };

    ws.on("close", () => {
      transportSockets.delete(ws);
      if (transportSockets.size === 0) socketsByTransport.delete(transport);
      clearTimeout(deadline);
      if (challenge) deps.challenges.discard(challenge.gatewayNonce);
      if (live && !shuttingDown) {
        connections.delete(live.connId);
        deps.onClose?.(live);
        if (!connectionsOf(live.deviceId).length) deps.onPresenceChange?.(live.deviceId, false, lastTransportByDevice.get(live.deviceId) ?? live.transport);
      } else if (live) {
        connections.delete(live.connId);
      }
    });
    ws.on("error", () => ws.terminate());

    ws.on("message", (data: RawData, isBinary: boolean) => {
      if (isBinary) return ws.close(CLOSE_CODES.badFrame, "BAD_FRAME");
      let frame: { t?: unknown };
      try {
        frame = JSON.parse(data.toString("utf8"));
      } catch {
        return ws.close(CLOSE_CODES.badFrame, "BAD_FRAME");
      }
      if (typeof frame !== "object" || frame === null || typeof frame.t !== "string") return ws.close(CLOSE_CODES.badFrame, "BAD_FRAME");
      if (frame.t === "ping") return send({ t: "pong" });
      if (frame.t === "pong") return;

      try {
        if (stage === "hello") {
          if (frame.t === "req") return ws.close(CLOSE_CODES.unauthenticated, "HANDSHAKE_REQUIRED");
          hello = helloSchema.parse(frame);
          if (hello.minProtocolVersion > PROTOCOL_VERSION) {
            throw new ProtocolError("PROTOCOL_UNSUPPORTED", "The host is too old for this app.", { details: { side: "gateway" } });
          }
          if (hello.protocolVersion < MIN_PROTOCOL_VERSION) {
            throw new ProtocolError("PROTOCOL_UNSUPPORTED", "The app is too old for this host.", { details: { side: "client" } });
          }
          challenge = deps.challenges.issue(binding);
          // The host authenticates itself first: the device sends nothing further until this signature verified.
          // The device key in the transcript is the one on record; an unknown device gets a signature over an empty key,
          // which it cannot use, and is refused at `prove` without learning whether it is known.
          const known = deps.devices.get(hello.deviceId);
          const gatewaySignature = deps.host.sign(handshakeTranscript({
            role: "gateway", context: CONNECT_CONTEXT, gatewayNonce: challenge.gatewayNonce, deviceNonce: hello.deviceNonce,
            ts: challenge.ts, gatewayId: deps.host.gatewayId, deviceId: hello.deviceId,
            devicePublicKey: known?.devicePublicKey ?? "", protocolVersion: hello.protocolVersion,
          }));
          send({
            t: "challenge", gatewayNonce: challenge.gatewayNonce, ts: challenge.ts, gatewayId: deps.host.gatewayId,
            protocolVersion: PROTOCOL_VERSION, minProtocolVersion: MIN_PROTOCOL_VERSION, gatewaySignature,
          });
          stage = "prove";
          return;
        }

        if (stage === "prove") {
          if (frame.t === "req") return ws.close(CLOSE_CODES.unauthenticated, "HANDSHAKE_REQUIRED");
          const prove = proveSchema.parse(frame);
          // The transcript is rebuilt from server state only, never from a value the client repeats.
          const gatewayNonce = challenge!.gatewayNonce;
          const { ts } = deps.challenges.consume(binding, gatewayNonce);
          challenge = undefined;
          const device = deps.devices.get(hello!.deviceId);
          const transcript = handshakeTranscript({
            role: "device", context: CONNECT_CONTEXT, gatewayNonce, deviceNonce: hello!.deviceNonce, ts,
            gatewayId: deps.host.gatewayId, deviceId: hello!.deviceId, devicePublicKey: device?.devicePublicKey ?? "",
            protocolVersion: hello!.protocolVersion,
          });
          if (!device || !verifyText(device.devicePublicKey, transcript, prove.signature)) {
            throw new ProtocolError(device ? "DEVICE_SIGNATURE_INVALID" : "DEVICE_UNKNOWN", "The device proof was not accepted.");
          }
          if (device.state !== "active") throw new ProtocolError("DEVICE_REVOKED", "The device is revoked.");
          const { replacement } = deps.devices.checkToken(device.deviceId, prove.deviceToken);
          if (connectionsOf(device.deviceId).length >= MAX_CONNECTIONS_PER_DEVICE) {
            throw new ProtocolError("RATE_LIMITED", "Too many connections for this device.");
          }
          deps.devices.touch(device.deviceId);
          deps.devices.recordTransport(device.deviceId, transport);
          clearTimeout(deadline);
          const connId = randomUUID();
          const seq = new Map<string, number>();
          live = {
            connId, deviceId: device.deviceId, clientInstanceId: hello!.clientInstanceId, transport, socket: ws, seq,
            role: () => {
              const current = deps.devices.get(device.deviceId);
              return current?.state === "active" ? current.role : undefined;
            },
            scopes: () => deps.devices.scopesOf(device.deviceId),
            send: (event, stream, payload) => {
              const next = (seq.get(stream) ?? 0) + 1;
              seq.set(stream, next);
              send({ t: "evt", event, stream, seq: next, ts_ms: deps.now(), payload });
            },
            close: (code, reason) => ws.close(code, reason),
          };
          connections.set(connId, live);
          lastTransportByDevice.set(device.deviceId, transport);
          stage = "ready";
          send({
            t: "ready", connId, role: device.role, deviceName: device.name, scopes: live.scopes(), features: deps.features?.() ?? {}, serverTime_ms: deps.now(),
            maxSchemaVersion: deps.maxSchemaVersion ?? MAX_SCHEMA_VERSION, transport, resumed: false,
            ...(replacement ? { deviceToken: replacement } : {}),
          });
          deps.onPresenceChange?.(device.deviceId, true, transport);
          return;
        }
      } catch (err) {
        return fail(err instanceof z.ZodError ? undefined : err);
      }

      if (frame.t !== "req") return ws.close(CLOSE_CODES.badFrame, "BAD_FRAME");
      const parsed = reqSchema.safeParse(frame);
      if (!parsed.success) return ws.close(CLOSE_CODES.badFrame, "BAD_FRAME");
      const request = parsed.data;
      const respondError = (error: ProtocolError) => send({ t: "res", id: request.id, ok: false, error: error.envelope() });
      if (inFlight >= MAX_IN_FLIGHT) {
        return respondError(new ProtocolError("RATE_LIMITED", "Too many requests in flight.", { retryable: true, details: { retryAfter_ms: 250 } }));
      }
      const method = deps.methods.get(request.method);
      if (!method) return respondError(new ProtocolError("NOT_FOUND", `Unknown method ${request.method}.`, { details: { reason: "unknown_method" } }));
      const connection = live!;
      if (connection.role() === undefined) return ws.close(CLOSE_CODES.revoked, "DEVICE_REVOKED");
      if (!connection.scopes().includes(method.scope)) {
        return respondError(new ProtocolError("SCOPE_DENIED", "The device lacks the required scope.", { details: { requiredScope: method.scope } }));
      }
      inFlight += 1;
      Promise.resolve()
        .then(() => method.handle(request.params, connection))
        .then(
          (result) => send({ t: "res", id: request.id, ok: true, result: result ?? null }),
          (err) => respondError(err instanceof ProtocolError ? err : new ProtocolError("INTERNAL", "Internal error.", { retryable: true })),
        )
        .finally(() => {
          inFlight -= 1;
        });
    });
  }

  /** Closes every connection of a device, e.g. on revocation. */
  function closeDevice(deviceId: string, code: number, reason: string): void {
    for (const connection of connectionsOf(deviceId)) connection.close(code, reason);
  }

  function closeTransport(transport: AddressKind, code: number, reason: string): void {
    for (const socket of socketsByTransport.get(transport) ?? []) socket.close(code, reason);
  }

  function closeAll(): void {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const sockets of socketsByTransport.values()) for (const socket of sockets) socket.terminate();
    connections.clear();
    socketsByTransport.clear();
  }

  /** Targeted delivery to the connections of devices that hold a scope. */
  function sendToScope(scope: Scope, event: string, stream: string, payload: unknown, filter?: (connection: Connection) => boolean): void {
    for (const connection of connections.values()) {
      if (connection.scopes().includes(scope) && (!filter || filter(connection))) connection.send(event, stream, payload);
    }
  }

  return {
    handleUpgrade, attachExternalSocket, closeDevice, closeTransport, closeAll, sendToScope,
    connectionCount: () => connections.size,
    isOnline: (deviceId: string) => connectionsOf(deviceId).length > 0,
    lastTransportOf: (deviceId: string): AddressKind | undefined => lastTransportByDevice.get(deviceId),
  };
}
