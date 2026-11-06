import { createHash, createPublicKey, generateKeyPairSync, sign, timingSafeEqual, verify, type KeyObject } from "node:crypto";
import { base64UrlToBytes } from "@jagentchill/protocol";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export const sha256 = (data: Uint8Array | string): Buffer => createHash("sha256").update(data).digest();
export const sha256Hex = (data: Uint8Array | string): string => createHash("sha256").update(data).digest("hex");

/** Raw 32-byte Ed25519 public key of a key object. */
export function rawPublicKey(key: KeyObject): Buffer {
  const der = (key.type === "private" ? createPublicKey(key) : key).export({ type: "spki", format: "der" });
  return der.subarray(der.length - 32);
}

export function generateEd25519(): { privateKey: KeyObject; publicKeyRaw: Buffer } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { privateKey, publicKeyRaw: rawPublicKey(publicKey) };
}

export function signText(privateKey: KeyObject, text: string): string {
  return sign(null, Buffer.from(text, "utf8"), privateKey).toString("base64url");
}

/** Verifies a base64url Ed25519 signature made by the raw public key given in base64url; false on any malformed input. */
export function verifyText(publicKeyBase64Url: string, text: string, signatureBase64Url: string): boolean {
  const raw = base64UrlToBytes(publicKeyBase64Url);
  const signature = base64UrlToBytes(signatureBase64Url);
  if (raw?.length !== 32 || signature?.length !== 64) return false;
  try {
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: "der", type: "spki" });
    return verify(null, Buffer.from(text, "utf8"), key, signature);
  } catch {
    return false;
  }
}

export function constantTimeEqual(a: string, b: string): boolean {
  const left = sha256(a);
  const right = sha256(b);
  return timingSafeEqual(left, right);
}
