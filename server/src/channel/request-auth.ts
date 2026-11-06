import {
  CLOCK_SKEW_WINDOW_MS, NONCE_LIMIT_PER_DEVICE, NONCE_RETENTION_MS, REQUEST_NONCE_BYTES, SIGNATURE_HEADERS,
  base64UrlToBytes, requestCanonicalString, type Scope,
} from "@jagentchill/protocol";
import { sha256Hex, verifyText } from "../crypto.ts";
import type { DeviceRegistry } from "../devices/registry.ts";
import { ProtocolError } from "../errors.ts";

export type SignedRequest = {
  method: string;
  /** Request target exactly as received, including the query string. */
  target: string;
  headers: Record<string, string | string[] | undefined>;
  body: Uint8Array;
};

/** Accepted request nonces per device, kept longer than the full span of the clock-skew window. */
export class NonceCache {
  private readonly byDevice = new Map<string, Map<string, number>>();
  private readonly now: () => number;

  constructor(now: () => number) {
    this.now = now;
  }

  /** Records the nonce; throws when it was already used. */
  use(deviceId: string, nonce: string): void {
    const now = this.now();
    let nonces = this.byDevice.get(deviceId);
    if (!nonces) this.byDevice.set(deviceId, (nonces = new Map()));
    if (nonces.has(nonce) && now - nonces.get(nonce)! <= NONCE_RETENTION_MS) {
      throw new ProtocolError("NONCE_REPLAYED", "The request nonce was already used.", { httpStatus: 401 });
    }
    if (nonces.size >= NONCE_LIMIT_PER_DEVICE) {
      // Insertion order is time order, so expired entries are at the front.
      for (const [seen, at] of nonces) {
        if (now - at <= NONCE_RETENTION_MS) break;
        nonces.delete(seen);
      }
      if (nonces.size >= NONCE_LIMIT_PER_DEVICE) {
        throw new ProtocolError("RATE_LIMITED", "Too many signed requests.", { httpStatus: 429, retryable: true, details: { retryAfter_ms: 1000 } });
      }
    }
    nonces.set(nonce, now);
  }
}

const header = (headers: SignedRequest["headers"], name: string): string | undefined => {
  const value = headers[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

export class RequestAuthenticator {
  private readonly gatewayId: string;
  private readonly devices: DeviceRegistry;
  private readonly nonces: NonceCache;
  private readonly now: () => number;
  private readonly startedAt: number;

  constructor(deps: { gatewayId: string; devices: DeviceRegistry; nonces: NonceCache; now: () => number }) {
    this.gatewayId = deps.gatewayId;
    this.devices = deps.devices;
    this.nonces = deps.nonces;
    this.now = deps.now;
    this.startedAt = deps.now();
  }

  /** Verifies a signed request of a paired device and returns its device id. */
  authenticate(request: SignedRequest, requiredScope: Scope): string {
    const parts = this.readHeaders(request);
    const device = this.devices.get(parts.deviceId);
    if (!device) throw new ProtocolError("DEVICE_UNKNOWN", "The device is not paired with this host.", { httpStatus: 401 });
    if (device.state !== "active") throw new ProtocolError("DEVICE_REVOKED", "The device is revoked.", { httpStatus: 403 });
    this.devices.assertTokenNotLapsed(device.deviceId);
    this.verify(request, parts, device.devicePublicKey);
    if (!this.devices.scopesOf(device.deviceId).includes(requiredScope)) {
      throw new ProtocolError("SCOPE_DENIED", "The device lacks the required scope.", { httpStatus: 403, details: { requiredScope } });
    }
    this.devices.touch(device.deviceId);
    return device.deviceId;
  }

  /** Verifies a request signed by a key that is not paired yet (the enrolment routes). */
  authenticateEnrolling(request: SignedRequest, expected: { deviceId: string; devicePublicKey: string }): void {
    const parts = this.readHeaders(request);
    if (parts.deviceId !== expected.deviceId) throw new ProtocolError("SIGNATURE_INVALID", "The request signature is not valid.", { httpStatus: 401 });
    this.verify(request, parts, expected.devicePublicKey);
  }

  private readHeaders(request: SignedRequest) {
    const deviceId = header(request.headers, SIGNATURE_HEADERS.device);
    const timestamp = header(request.headers, SIGNATURE_HEADERS.timestamp);
    const nonce = header(request.headers, SIGNATURE_HEADERS.nonce);
    const signature = header(request.headers, SIGNATURE_HEADERS.signature);
    if (!deviceId || !timestamp || !nonce || !signature) {
      throw new ProtocolError("SIGNATURE_MISSING", "The request is not signed.", { httpStatus: 401 });
    }
    return { deviceId, timestamp, nonce, signature };
  }

  private verify(request: SignedRequest, parts: { deviceId: string; timestamp: string; nonce: string; signature: string }, publicKey: string): void {
    const now = this.now();
    const ts = /^\d{1,16}$/.test(parts.timestamp) ? Number(parts.timestamp) : NaN;
    // A request older than this process could have been accepted before the restart with a nonce that was not persisted.
    if (!Number.isFinite(ts) || Math.abs(now - ts) > CLOCK_SKEW_WINDOW_MS || ts < this.startedAt) {
      throw new ProtocolError("CLOCK_SKEW", "The request timestamp is outside the accepted window.", { httpStatus: 401, retryable: true });
    }
    if (base64UrlToBytes(parts.nonce)?.length !== REQUEST_NONCE_BYTES) {
      throw new ProtocolError("SIGNATURE_INVALID", "The request signature is not valid.", { httpStatus: 401 });
    }
    const canonical = requestCanonicalString({
      gatewayId: this.gatewayId, method: request.method, target: request.target, bodySha256: sha256Hex(request.body), ts, nonce: parts.nonce,
    });
    // The signature is checked before the nonce is recorded, so an attacker cannot burn nonces for a device.
    if (!verifyText(publicKey, canonical, parts.signature)) {
      // A replay with a changed method or body must still report the replay when the nonce is known.
      throw new ProtocolError("SIGNATURE_INVALID", "The request signature is not valid.", { httpStatus: 401 });
    }
    this.nonces.use(parts.deviceId, parts.nonce);
  }
}
