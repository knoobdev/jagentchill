import type { Environment, OsPlatform } from "./os.ts";
import { z } from "zod";
import {
  GATEWAY_ID_PATTERN, base64UrlToBytes, handshakeTranscript, requestCanonicalString,
} from "@jagentchill/protocol";

export const SIGN_REFUSED = "SIGN_REFUSED";
/** The one answer of the signer to anything that is not a structured input it knows. Nothing was signed. */
export class SignRefused extends Error {
  readonly code = SIGN_REFUSED;
  constructor(reason: string) {
    super(reason);
  }
}

export const ROTATE_TAG = "JAGENTCHILL-ROTATE-V1";
/** The five-line statement both the old and the new key sign when a device replaces its key. */
export const rotationStatement = (f: { gatewayId: string; oldDeviceId: string; newDevicePublicKey: string; ts: number }): string =>
  [ROTATE_TAG, f.gatewayId, f.oldDeviceId, f.newDevicePublicKey, String(f.ts)].join("\n");

const base64UrlOf = (bytes: number) => z.string().max(64).refine((value) => base64UrlToBytes(value)?.length === bytes);
const gatewayId = z.string().regex(GATEWAY_ID_PATTERN);
const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

const handshakeFields = z.object({
  // The caller may name the role, but only its own.
  role: z.literal("device").optional(),
  context: z.string().regex(/^(connect|enrol:[A-Za-z0-9_-]{22})$/),
  gatewayNonce: base64UrlOf(32), deviceNonce: base64UrlOf(32), ts: timestamp, gatewayId,
  protocolVersion: z.number().int().positive().max(65535),
}).strict();
const requestFields = z.object({
  gatewayId, method: z.string().regex(/^[A-Za-z]{3,7}$/),
  // Exactly as sent: a path with its query, no scheme, no host and no control character.
  target: z.string().min(1).max(4096).regex(/^\/[\x21-\x7e]*$/),
  bodySha256: z.string().regex(/^[0-9a-f]{64}$/), ts: timestamp, nonce: base64UrlOf(16),
}).strict();
const rotateFields = z.object({ gatewayId }).strict();

export const signInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("handshake"), fields: handshakeFields }).strict(),
  z.object({ kind: z.literal("request"), fields: requestFields }).strict(),
  z.object({ kind: z.literal("rotate"), fields: rotateFields }).strict(),
]);
export type SignInput = z.infer<typeof signInputSchema>;

export type SignerContext = {
  deviceId: string;
  devicePublicKey: string;
  /** The host registry of this device. */
  isKnownGateway(gatewayId: string): boolean;
  /** The host of the offer being enrolled right now, when there is one. */
  enrollingGatewayId(): string | null;
};

/** The routes a device signs for before it is paired: the last steps of enrolment, and nothing else. */
const ENROLMENT_TARGET = /^\/jagentchill\/v1\/pair\/(verify|status)(\?[\x21-\x7e]*)?$/;

export type SigningPlan =
  | { kind: "handshake" | "request"; text: string }
  /** The caller gave only the host: the key pair, the time and the statement are made by the signer after a person confirmed. */
  | { kind: "rotate"; gatewayId: string };

/**
 * Turns structured input into the canonical string to sign, or refuses. The signer never signs a string or bytes a
 * caller supplied: it builds the text here from typed fields, for a host this device knows.
 */
export function planSigning(input: unknown, context: SignerContext): SigningPlan {
  const parsed = signInputSchema.safeParse(input);
  if (!parsed.success) throw new SignRefused("The signer accepts only { kind, fields } of kind handshake, request or rotate.");
  const { kind, fields } = parsed.data;
  const known = context.isKnownGateway(fields.gatewayId), enrolling = context.enrollingGatewayId() === fields.gatewayId;
  if (kind === "handshake") {
    const enrolment = fields.context !== "connect";
    // An enrolment transcript is signed for the offer being enrolled; a connection transcript for a paired host.
    if (enrolment ? !enrolling : !known) throw new SignRefused("The host is not one this device is paired with or is pairing with.");
    const { role: _role, ...rest } = fields;
    return { kind, text: handshakeTranscript({ ...rest, role: "device", deviceId: context.deviceId, devicePublicKey: context.devicePublicKey }) };
  }
  if (kind === "request") {
    if (!known && !(enrolling && ENROLMENT_TARGET.test(fields.target))) throw new SignRefused("The host is not in this device's host registry.");
    return { kind, text: requestCanonicalString(fields) };
  }
  if (!known) throw new SignRefused("The host is not in this device's host registry.");
  return { kind, gatewayId: fields.gatewayId };
}

export type KeyStore = { available: boolean; platform: OsPlatform; linuxBackend?: string };
/**
 * Whether the OS secret store may hold the device key. Electron's `basic_text` backend on Linux uses a fixed key and
 * protects nothing, so it counts as no store at all.
 */
export function secretStoreAvailable(store: KeyStore): boolean {
  if (!store.available) return false;
  return store.platform !== "linux" || (store.linuxBackend !== "basic_text" && store.linuxBackend !== "unknown" && store.linuxBackend !== undefined);
}
/** The sentence of the `KEY_STORAGE_UNAVAILABLE` dialog that names the missing store. */
export const missingStoreMessage = (platform: OsPlatform): string =>
  platform === "darwin" ? "The login keychain is not available"
    : platform === "win32" ? "Windows data protection is not available for this account"
      : "No keyring is running on this computer (GNOME Keyring or KWallet)";
export const KEY_STORAGE_CHOICES = ["Try again", "Store the key in a protected file", "Cancel"] as const;
export const KEY_FILE_CONFIRMATION = "The key will be protected only by this account's file permissions";
