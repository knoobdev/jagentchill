import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { base64UrlToBytes } from "@jagentchill/protocol";

export const DIRECT_PASSWORD_PROTOCOL_PREFIX = "jagentchill.password.";

/** Salted verifier; the clear password is never written to host configuration or logs. */
export function hashDirectPassword(password: string): string {
  const salt = randomBytes(16);
  const digest = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString("hex")}$${digest.toString("hex")}`;
}

export function verifyDirectPassword(password: string, encodedHash: string | undefined): boolean {
  if (!encodedHash) return false;
  const [algorithm, saltHex, digestHex, extra] = encodedHash.split("$");
  if (algorithm !== "scrypt" || !saltHex || !digestHex || extra !== undefined || !/^[0-9a-f]{32}$/.test(saltHex) || !/^[0-9a-f]{64}$/.test(digestHex)) return false;
  const expected = Buffer.from(digestHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

/** Reads a base64url password token from the WebSocket subprotocol list. */
export function directPasswordFromProtocols(value: string | string[] | undefined): string | null {
  const header = Array.isArray(value) ? value.join(",") : value;
  if (!header) return null;
  for (const protocol of header.split(",")) {
    const trimmed = protocol.trim();
    if (!trimmed.startsWith(DIRECT_PASSWORD_PROTOCOL_PREFIX)) continue;
    const encoded = trimmed.slice(DIRECT_PASSWORD_PROTOCOL_PREFIX.length);
    const bytes = base64UrlToBytes(encoded);
    if (bytes) {
      try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
      catch { return null; }
    }
  }
  return null;
}
