import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  DEVICE_ID_PATTERN, MIN_PROTOCOL_VERSION, OFFER_TTL_MS, PLATFORMS, PROTOCOL_VERSION, ROLES, base64UrlToBytes,
  deviceIdFromKeyDigest, enrolContext, handshakeTranscript, type OfferAddress, type PairingOffer, type Platform, type Role,
} from "@jagentchill/protocol";
import { constantTimeEqual, sha256, verifyText } from "../crypto.ts";
import type { DeviceRegistry, IssuedToken } from "../devices/registry.ts";
import { ProtocolError } from "../errors.ts";
import type { HostIdentity } from "../identity/host-identity.ts";
import type { ChallengeBook } from "./challenges.ts";

export const CODE_TTL_MS = 300_000;
export const CODE_MAX_ATTEMPTS = 5;
const MAX_PENDING_PER_OFFER = 3;

const base64UrlOf = (byteLength: number) => z.string().refine((value) => base64UrlToBytes(value)?.length === byteLength);

export const challengeBodySchema = z.object({
  offerId: base64UrlOf(16),
  deviceId: z.string().regex(DEVICE_ID_PATTERN),
  devicePublicKey: base64UrlOf(32),
  deviceNonce: base64UrlOf(32),
  deviceName: z.string().trim().min(1).max(64),
  platform: z.enum(PLATFORMS),
  appVersion: z.string().min(1).max(32),
  protocolVersion: z.number().int().positive(),
  keyProtection: z.string().min(1).max(32),
}).strict();
export type ChallengeBody = z.infer<typeof challengeBodySchema>;

export type EnrolmentState = "challenged" | "proved" | "paired" | "declined" | "cancelled" | "expired" | "locked";

export type PairingRequest = {
  requestId: string;
  offerId: string;
  deviceId: string;
  devicePublicKey: string;
  deviceName: string;
  platform: Platform;
  appVersion: string;
  keyProtection: string;
  sourceAddress: string;
  transport: OfferAddress["kind"];
  role: Role;
  state: EnrolmentState;
  created_ms: number;
  expires_ms: number;
};

type Enrolment = PairingRequest & {
  deviceNonce: string;
  gatewayNonce: string;
  protocolVersion: number;
  code?: string;
  attemptsRemaining: number;
};

type LiveOffer = { offer: PairingOffer; rolePreset: Role; firstDeviceIsAdmin: boolean };

export type EnrolmentListener = {
  /** Targeted delivery only: the code goes to trusted displays, never to the enrolling device. */
  requested?: (request: PairingRequest, code: string) => void;
  completed?: (request: PairingRequest) => void;
  ended?: (request: PairingRequest) => void;
};

/** Enrolment state machine `challenged → proved → paired`, with the terminal states declined, cancelled, expired, locked. */
export class EnrolmentService {
  private live: LiveOffer | undefined;
  private readonly requests = new Map<string, Enrolment>();
  private readonly host: HostIdentity;
  private readonly devices: DeviceRegistry;
  private readonly challenges: ChallengeBook;
  private readonly now: () => number;
  private readonly listeners = new Set<EnrolmentListener>();

  constructor(deps: { host: HostIdentity; devices: DeviceRegistry; challenges: ChallengeBook; now: () => number }) {
    this.host = deps.host;
    this.devices = deps.devices;
    this.challenges = deps.challenges;
    this.now = deps.now;
  }

  /** Registers a trusted display; returns the function that removes it. */
  listen(listener: EnrolmentListener): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private emit<K extends keyof EnrolmentListener>(kind: K, ...args: Parameters<NonNullable<EnrolmentListener[K]>>): void {
    for (const listener of this.listeners) (listener[kind] as ((...a: unknown[]) => void) | undefined)?.(...args);
  }

  /** Creates the live offer; an earlier offer and every request made on it are cancelled. */
  createOffer(addresses: OfferAddress[], opts: { rolePreset?: Role; firstDeviceIsAdmin?: boolean } = {}): PairingOffer {
    this.cancelOpenRequests();
    const offer: PairingOffer = {
      v: 1,
      offerId: randomBytes(16).toString("base64url"),
      gatewayId: this.host.gatewayId,
      gatewayPublicKey: this.host.gatewayPublicKey,
      addresses,
      expires_ms: this.now() + OFFER_TTL_MS,
    };
    this.live = { offer, rolePreset: opts.rolePreset ?? "editor", firstDeviceIsAdmin: opts.firstDeviceIsAdmin ?? false };
    return offer;
  }

  cancelOffer(): void {
    this.cancelOpenRequests();
    this.live = undefined;
  }

  private cancelOpenRequests(): void {
    for (const request of this.requests.values()) {
      if (request.state === "challenged" || request.state === "proved") this.end(request, "cancelled");
    }
  }

  challenge(body: ChallengeBody, peer: { address: string; transport: OfferAddress["kind"] }) {
    const live = this.live;
    if (!live || live.offer.offerId !== body.offerId || this.now() > live.offer.expires_ms) {
      throw new ProtocolError("OFFER_EXPIRED", "The pairing offer is no longer valid.", { httpStatus: 410 });
    }
    if (deviceIdFromKeyDigest(sha256(base64UrlToBytes(body.devicePublicKey)!)) !== body.deviceId) {
      throw new ProtocolError("DEVICE_ID_MISMATCH", "deviceId does not match the device public key.", { httpStatus: 400 });
    }
    if (body.protocolVersion < MIN_PROTOCOL_VERSION) {
      throw new ProtocolError("PROTOCOL_UNSUPPORTED", "The app is too old for this host.", { httpStatus: 426, details: { side: "client" } });
    }
    const open = [...this.requests.values()].filter((r) => r.offerId === body.offerId && (r.state === "challenged" || r.state === "proved"));
    const own = open.find((r) => r.deviceId === body.deviceId);
    if (own) this.end(own, "cancelled");
    else if (open.length >= MAX_PENDING_PER_OFFER) {
      throw new ProtocolError("PAIRING_LIMIT", "Too many pairing requests are pending for this offer.", { httpStatus: 429, retryable: true });
    }
    const requestId = randomUUID();
    const { gatewayNonce, ts } = this.challenges.issue(`enrol:${requestId}`);
    const enrolment: Enrolment = {
      requestId, offerId: body.offerId, deviceId: body.deviceId, devicePublicKey: body.devicePublicKey,
      deviceName: body.deviceName, platform: body.platform, appVersion: body.appVersion, keyProtection: body.keyProtection,
      sourceAddress: peer.address, transport: peer.transport,
      role: live.firstDeviceIsAdmin && !this.devices.hasAdmin() ? "admin" : live.rolePreset,
      state: "challenged", created_ms: ts, expires_ms: ts + CODE_TTL_MS,
      deviceNonce: body.deviceNonce, gatewayNonce, protocolVersion: body.protocolVersion, attemptsRemaining: CODE_MAX_ATTEMPTS,
    };
    this.requests.set(requestId, enrolment);
    const gatewaySignature = this.host.sign(handshakeTranscript({ ...this.transcriptFields(enrolment, ts), role: "gateway" }));
    return { requestId, gatewayNonce, ts, gatewayId: this.host.gatewayId, protocolVersion: PROTOCOL_VERSION, gatewaySignature };
  }

  private transcriptFields(e: Enrolment, ts: number) {
    return {
      context: enrolContext(e.offerId), gatewayNonce: e.gatewayNonce, deviceNonce: e.deviceNonce, ts,
      gatewayId: this.host.gatewayId, deviceId: e.deviceId, devicePublicKey: e.devicePublicKey, protocolVersion: e.protocolVersion,
    };
  }

  prove(requestId: string, signature: string) {
    const enrolment = this.requests.get(requestId);
    // An unknown request and a bad signature are indistinguishable on the enrolment routes.
    if (!enrolment || enrolment.state !== "challenged") {
      throw new ProtocolError("DEVICE_SIGNATURE_INVALID", "The device proof was not accepted.", { httpStatus: 401 });
    }
    const { ts } = this.challenges.consume(`enrol:${requestId}`, enrolment.gatewayNonce);
    const transcript = handshakeTranscript({ ...this.transcriptFields(enrolment, ts), role: "device" });
    if (!verifyText(enrolment.devicePublicKey, transcript, signature)) {
      this.end(enrolment, "cancelled");
      throw new ProtocolError("DEVICE_SIGNATURE_INVALID", "The device proof was not accepted.", { httpStatus: 401 });
    }
    const now = this.now();
    enrolment.state = "proved";
    enrolment.created_ms = now;
    enrolment.expires_ms = now + CODE_TTL_MS;
    enrolment.code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    this.emit("requested", this.publicView(enrolment), enrolment.code);
    return { expires_ms: enrolment.expires_ms, attemptsRemaining: enrolment.attemptsRemaining };
  }

  /** The enrolling key that must have signed a `pair/verify` or `pair/status` request. */
  enrollingKey(requestId: string): { deviceId: string; devicePublicKey: string } | undefined {
    const enrolment = this.requests.get(requestId);
    return enrolment && { deviceId: enrolment.deviceId, devicePublicKey: enrolment.devicePublicKey };
  }

  verify(requestId: string, code: string): { role: Role; deviceToken: IssuedToken } {
    const enrolment = this.requireOpen(requestId);
    if (this.now() > enrolment.expires_ms) {
      this.end(enrolment, "expired");
      throw new ProtocolError("CODE_EXPIRED", "The verification code has expired.", { httpStatus: 410 });
    }
    if (!constantTimeEqual(code, enrolment.code!)) {
      enrolment.attemptsRemaining -= 1;
      if (enrolment.attemptsRemaining <= 0) {
        this.end(enrolment, "locked");
        throw new ProtocolError("CODE_ATTEMPTS_EXCEEDED", "Too many wrong codes; start pairing again.", { httpStatus: 429 });
      }
      throw new ProtocolError("CODE_INVALID", "The verification code is wrong.", {
        httpStatus: 401, retryable: true, details: { attemptsRemaining: enrolment.attemptsRemaining },
      });
    }
    const { device, token } = this.devices.pair({
      deviceId: enrolment.deviceId, devicePublicKey: enrolment.devicePublicKey, name: enrolment.deviceName,
      platform: enrolment.platform, role: enrolment.role, keyProtection: enrolment.keyProtection, localSupervisor: false,
      pairedBy: "pairing",
    });
    enrolment.state = "paired";
    enrolment.code = undefined;
    enrolment.role = device.role;
    this.emit("completed", this.publicView(enrolment));
    return { role: device.role, deviceToken: token };
  }

  status(requestId: string) {
    const enrolment = this.requests.get(requestId);
    if (!enrolment) throw new ProtocolError("NOT_FOUND", "No such pairing request.", { httpStatus: 404 });
    if ((enrolment.state === "challenged" || enrolment.state === "proved") && this.now() > enrolment.expires_ms) this.end(enrolment, "expired");
    return { state: enrolment.state, attemptsRemaining: enrolment.attemptsRemaining, expires_ms: enrolment.expires_ms };
  }

  /** Cancelled by the enrolling device. */
  cancel(requestId: string): void {
    this.end(this.requireOpen(requestId), "cancelled");
  }

  /** Declined by a trusted device. */
  decline(requestId: string): void {
    this.end(this.requireOpen(requestId), "declined");
  }

  setRole(requestId: string, role: Role): void {
    if (!ROLES.includes(role)) throw new ProtocolError("INVALID_PARAMS", "Unknown role.");
    this.requireOpen(requestId).role = role;
  }

  /** Pending requests with their codes, for trusted displays only. */
  pending(): Array<PairingRequest & { code: string }> {
    const now = this.now();
    return [...this.requests.values()]
      .filter((r) => r.state === "proved" && now <= r.expires_ms)
      .map((r) => ({ ...this.publicView(r), code: r.code! }));
  }

  private requireOpen(requestId: string): Enrolment {
    const enrolment = this.requests.get(requestId);
    if (!enrolment) throw new ProtocolError("NOT_FOUND", "No such pairing request.", { httpStatus: 404 });
    if (enrolment.state === "declined" || enrolment.state === "cancelled") {
      throw new ProtocolError("PAIRING_CANCELLED", "The pairing request was cancelled.", { httpStatus: 410 });
    }
    if (enrolment.state === "expired") throw new ProtocolError("CODE_EXPIRED", "The verification code has expired.", { httpStatus: 410 });
    if (enrolment.state === "locked") throw new ProtocolError("CODE_ATTEMPTS_EXCEEDED", "Too many wrong codes; start pairing again.", { httpStatus: 429 });
    if (enrolment.state !== "proved") throw new ProtocolError("CONFLICT", "The pairing request is not awaiting a code.", { httpStatus: 409 });
    return enrolment;
  }

  private end(enrolment: Enrolment, state: "declined" | "cancelled" | "expired" | "locked"): void {
    this.challenges.discard(enrolment.gatewayNonce);
    enrolment.state = state;
    enrolment.code = undefined;
    this.emit("ended", this.publicView(enrolment));
  }

  private publicView(e: Enrolment): PairingRequest {
    const { deviceNonce: _dn, gatewayNonce: _gn, protocolVersion: _pv, code: _code, attemptsRemaining: _ar, ...view } = e;
    return view;
  }
}
