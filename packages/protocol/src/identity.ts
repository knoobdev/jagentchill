import { bytesToHex } from "./encoding.ts";

export const PROTOCOL_VERSION = 1;
export const MIN_PROTOCOL_VERSION = 1;

export const DEVICE_ID_PATTERN = /^[0-9a-f]{64}$/;
export const GATEWAY_ID_PATTERN = /^[0-9a-f]{32}$/;

/** `deviceId` is the full SHA-256 of the raw 32-byte Ed25519 public key, in lowercase hex. */
export function deviceIdFromKeyDigest(sha256OfRawPublicKey: Uint8Array): string {
  return bytesToHex(sha256OfRawPublicKey);
}

/** `gatewayId` is the first 32 hex characters of the same digest — deliberately a different shape from `deviceId`. */
export function gatewayIdFromKeyDigest(sha256OfRawPublicKey: Uint8Array): string {
  return bytesToHex(sha256OfRawPublicKey).slice(0, 32);
}
