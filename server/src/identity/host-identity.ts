import { createPrivateKey, type KeyObject } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { bytesToBase64Url, gatewayIdFromKeyDigest } from "@jagentchill/protocol";
import { generateEd25519, rawPublicKey, sha256, signText } from "../crypto.ts";

export type HostIdentity = {
  /** First 32 hex characters of SHA-256 over the raw public key. */
  gatewayId: string;
  /** base64url of the raw 32-byte public key. */
  gatewayPublicKey: string;
  sign(text: string): string;
};

function fromPrivateKey(privateKey: KeyObject): HostIdentity {
  const raw = rawPublicKey(privateKey);
  return {
    gatewayId: gatewayIdFromKeyDigest(sha256(raw)),
    gatewayPublicKey: bytesToBase64Url(raw),
    sign: (text) => signText(privateKey, text),
  };
}

/**
 * The host's Ed25519 identity: the only authenticator a client has for this host. Created on first start, kept in an
 * owner-only secret file, never sent to a client and never changed by a restart or an update.
 */
export function loadOrCreateHostIdentity(file: string): HostIdentity {
  if (existsSync(file)) return fromPrivateKey(createPrivateKey(readFileSync(file, "utf8")));
  const { privateKey } = generateEd25519();
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600, flag: "wx" });
  chmodSync(file, 0o600);
  return fromPrivateKey(privateKey);
}
