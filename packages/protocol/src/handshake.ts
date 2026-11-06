export const HANDSHAKE_TAG = "JAGENTCHILL-HANDSHAKE-V1";
export const CHALLENGE_TTL_MS = 30_000;
export const HANDSHAKE_DEADLINE_MS = 10_000;

export type HandshakeRole = "device" | "gateway";

export type HandshakeTranscriptFields = {
  role: HandshakeRole;
  /** `enrol:<offerId>` during enrolment, `connect` on the product channel. */
  context: string;
  gatewayNonce: string;
  deviceNonce: string;
  /** Host clock, Unix UTC milliseconds. */
  ts: number;
  gatewayId: string;
  deviceId: string;
  devicePublicKey: string;
  /** The device's protocol version. */
  protocolVersion: number;
};

export const enrolContext = (offerId: string): string => `enrol:${offerId}`;
export const CONNECT_CONTEXT = "connect";

/**
 * The ten-line transcript both sides sign, each with its own role line. Fields never contain a line feed: every one is
 * validated as base64url, hex, a decimal integer or one of the two context shapes before it reaches this function.
 */
export function handshakeTranscript(f: HandshakeTranscriptFields): string {
  const lines = [
    HANDSHAKE_TAG,
    f.role,
    f.context,
    f.gatewayNonce,
    f.deviceNonce,
    String(f.ts),
    f.gatewayId,
    f.deviceId,
    f.devicePublicKey,
    String(f.protocolVersion),
  ];
  for (const line of lines) {
    if (line.includes("\n") || line.includes("\r")) throw new Error("handshake field contains a line break");
  }
  return lines.join("\n");
}
