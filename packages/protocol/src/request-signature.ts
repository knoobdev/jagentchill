export const REQUEST_TAG = "JAGENTCHILL-REQUEST-V1";
export const CLOCK_SKEW_WINDOW_MS = 120_000;
export const NONCE_RETENTION_MS = 250_000;
export const NONCE_LIMIT_PER_DEVICE = 100_000;
export const REQUEST_NONCE_BYTES = 16;

export const SIGNATURE_HEADERS = {
  device: "x-jagentchill-device",
  timestamp: "x-jagentchill-timestamp",
  nonce: "x-jagentchill-nonce",
  signature: "x-jagentchill-signature",
} as const;

/** Lowercase hex SHA-256 of the empty string: the body hash of a request without a body. */
export const EMPTY_BODY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export type RequestSignatureFields = {
  /** The host the request is meant for; a request signed for one host is invalid on every other. */
  gatewayId: string;
  method: string;
  /** Request target exactly as sent, including the query string, without scheme or host. */
  target: string;
  /** Lowercase hex SHA-256 of the exact body bytes. */
  bodySha256: string;
  ts: number;
  nonce: string;
};

export function requestCanonicalString(f: RequestSignatureFields): string {
  const lines = [REQUEST_TAG, f.gatewayId, f.method.toUpperCase(), f.target, f.bodySha256, String(f.ts), f.nonce];
  for (const line of lines) {
    if (line.includes("\n") || line.includes("\r")) throw new Error("request field contains a line break");
  }
  return lines.join("\n");
}
