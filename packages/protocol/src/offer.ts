import { z } from "zod";
import { base64UrlToBytes, bytesToBase64Url, utf8, utf8Decode } from "./encoding.ts";
import { GATEWAY_ID_PATTERN } from "./identity.ts";

export const OFFER_VERSION = 1;
export const OFFER_TTL_MS = 600_000;
export const OFFER_URL_MAX_LENGTH = 1024;
export const OFFER_URL_PREFIX = "jagentchill://pair#offer=";

const base64UrlOf = (byteLength: number) =>
  z.string().refine((value) => base64UrlToBytes(value)?.length === byteLength, `expected base64url of ${byteLength} bytes`);

export const addressKindSchema = z.enum(["loopback", "lan", "tailnet"]);
export type AddressKind = z.infer<typeof addressKindSchema>;

export const offerAddressSchema = z
  .object({
    kind: addressKindSchema,
    url: z.string().max(255).regex(/^wss?:\/\//),
    tlsSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  })
  .strict();
export type OfferAddress = z.infer<typeof offerAddressSchema>;

export const offerSchema = z
  .object({
    v: z.literal(OFFER_VERSION),
    offerId: base64UrlOf(16),
    gatewayId: z.string().regex(GATEWAY_ID_PATTERN),
    gatewayPublicKey: base64UrlOf(32),
    addresses: z.array(offerAddressSchema).min(1).max(8),
    expires_ms: z.number().int().nonnegative(),
  })
  .strict();
export type PairingOffer = z.infer<typeof offerSchema>;

export function encodeOfferPayload(offer: PairingOffer): string {
  return bytesToBase64Url(utf8(JSON.stringify(offerSchema.parse(offer))));
}

export function encodeOfferUrl(offer: PairingOffer): string {
  const url = OFFER_URL_PREFIX + encodeOfferPayload(offer);
  if (url.length > OFFER_URL_MAX_LENGTH) throw new Error("pairing offer URL exceeds 1024 characters");
  return url;
}

export type OfferDecodeResult =
  | { ok: true; offer: PairingOffer }
  | { ok: false; code: "OFFER_INVALID" | "OFFER_VERSION_UNSUPPORTED" };

/** Accepts the payload alone, the `jagentchill://` URL, or the web link form (`…#/pair/link?offer=<payload>`). */
export function decodeOffer(input: string): OfferDecodeResult {
  const match = /(?:^|[#?&])offer=([A-Za-z0-9_-]+)$/.exec(input);
  const payload = match ? match[1] : input;
  const bytes = base64UrlToBytes(payload);
  if (!bytes) return { ok: false, code: "OFFER_INVALID" };
  let json: unknown;
  try {
    json = JSON.parse(utf8Decode(bytes));
  } catch {
    return { ok: false, code: "OFFER_INVALID" };
  }
  if (typeof json === "object" && json !== null && "v" in json && Number.isInteger(json.v) && json.v !== OFFER_VERSION) {
    return { ok: false, code: "OFFER_VERSION_UNSUPPORTED" };
  }
  const parsed = offerSchema.safeParse(json);
  return parsed.success ? { ok: true, offer: parsed.data } : { ok: false, code: "OFFER_INVALID" };
}
