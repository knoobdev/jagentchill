import {
  base64UrlToBytes, bytesToBase64Url, deviceIdFromKeyDigest, handshakeTranscript, requestCanonicalString, utf8,
  type HandshakeTranscriptFields, type RequestSignatureFields,
} from "@jagentchill/protocol";
import { generateDeviceKey as generatePlatformDeviceKey, publicKeyBytes, sha256, signBytes, verifyBytes, type DeviceKeyPair } from "@jagentchill/client/crypto";

/**
 * The device's signing interface. It accepts structured input only and builds the canonical string itself; nothing
 * signs a caller-supplied string. Each platform provides one: WebCrypto here, the keychain-backed native module on
 * mobile, the main process on desktop.
 */
export type DeviceSigner = {
  readonly deviceId: string;
  /** base64url of the raw 32-byte Ed25519 public key. */
  readonly devicePublicKey: string;
  signHandshake(fields: Omit<HandshakeTranscriptFields, "role" | "deviceId" | "devicePublicKey">): Promise<string>;
  signRequest(fields: RequestSignatureFields): Promise<string>;
};

export type StoredDeviceKey = DeviceKeyPair;

/** Generates a non-extractable Ed25519 key pair; the caller persists the two CryptoKey objects (IndexedDB on the web). */
export async function generateDeviceKey(): Promise<StoredDeviceKey> {
  return await generatePlatformDeviceKey();
}

export async function createWebCryptoSigner(key: StoredDeviceKey): Promise<DeviceSigner> {
  const raw = await publicKeyBytes(key);
  const deviceId = deviceIdFromKeyDigest(await sha256(raw));
  const devicePublicKey = bytesToBase64Url(raw);
  const sign = async (text: string) => bytesToBase64Url(await signBytes(key, utf8(text)));
  return {
    deviceId,
    devicePublicKey,
    signHandshake: (fields) => sign(handshakeTranscript({ ...fields, role: "device", deviceId, devicePublicKey })),
    signRequest: (fields) => sign(requestCanonicalString(fields)),
  };
}

/** Verifies the host's signature over a handshake transcript with the host public key from the offer or the registry. */
export async function verifyHostSignature(gatewayPublicKey: string, transcript: string, signature: string): Promise<boolean> {
  const raw = base64UrlToBytes(gatewayPublicKey);
  const sig = base64UrlToBytes(signature);
  if (raw?.length !== 32 || sig?.length !== 64) return false;
  try {
    return await verifyBytes(raw, utf8(transcript), sig);
  } catch {
    return false;
  }
}
