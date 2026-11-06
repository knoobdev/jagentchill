import type { HostError } from "@jagentchill/client";

/** English text for the error codes the first screens can meet. Clients show text keyed by code, never the log message. */
const TEXT: Record<string, string> = {
  OFFER_INVALID: "This is not a valid pairing link.",
  OFFER_EXPIRED: "This pairing link has expired. Create a new one on the host.",
  OFFER_VERSION_UNSUPPORTED: "This pairing link needs a newer version of the app.",
  GATEWAY_UNREACHABLE: "The host could not be reached over this connection. Check that Tailscale is connected on both devices, then try again.",
  UNAVAILABLE: "The host answered without a pairing response. Check that it is online and try again.",
  GATEWAY_MISMATCH: "A different host answered at this address.",
  GATEWAY_SIGNATURE_INVALID: "This is not the host you paired with.",
  CODE_INVALID: "That code is not right.",
  CODE_EXPIRED: "The code has expired. Start pairing again.",
  CODE_ATTEMPTS_EXCEEDED: "Too many wrong codes. Start pairing again.",
  PAIRING_CANCELLED: "Pairing was cancelled on the host.",
  ENROLMENT_INACTIVE: "This pairing attempt has ended. Start pairing again.",
  PAIRING_LIMIT: "Too many devices are waiting to pair. Try again shortly.",
  DEVICE_REVOKED: "This device was removed from the host.",
  DEVICE_UNKNOWN: "Pairing required.",
  TOKEN_INVALID: "Pairing required.",
  TOKEN_EXPIRED: "Pairing required.",
  CLOCK_SKEW: "This device's clock differs from the host.",
  KEY_STORAGE_UNAVAILABLE: "Protected key storage is not available on this device.",
  GATEWAY_UNAVAILABLE: "The agent engine on the host is not running.",
  SCOPE_DENIED: "This device is not allowed to do that.",
  CONNECTION_CLOSED: "The connection to the host was lost.",
};

export function messageFor(error: unknown, t?: (key: string) => string): string {
  const localize = (text: string) => t?.(text) ?? text;
  const code = (error as Partial<HostError> | undefined)?.code;
  if (error instanceof Error && /subtle|ed25519|signing key/i.test(error.message)) return localize("This build cannot sign the pairing request. Update the app and try again.");
  if (error instanceof Error && /json|unexpected end/i.test(error.message)) return localize("The host did not return a pairing response. Check that it is reachable over Tailscale and try again.");
  if (code === "CODE_INVALID") {
    const left = (error as HostError).details?.attemptsRemaining;
    if (typeof left === "number") return `That code is not right. ${left} ${left === 1 ? "attempt" : "attempts"} left.`;
  }
  if (code && TEXT[code]) return localize(TEXT[code]);
  if (error instanceof Error && error.message.trim() && error.message.length < 160) return localize(`Pairing failed: ${error.message}`);
  return localize("Pairing failed. Check the connection and try again.");
}
