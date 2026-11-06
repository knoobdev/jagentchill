import { SECRET_NAME_PATTERN, type ErrorEnvelope } from "@jagentchill/protocol";
import { HostError } from "./errors.ts";
import { signedHeaders, type HostRecord } from "./pairing.ts";
import type { DeviceSigner } from "./signer.ts";

export type HostSecretInfo = { name: string; hint?: string; updated_ms: number };

async function send<T>(host: HostRecord, signer: DeviceSigner, method: "GET" | "PUT" | "DELETE", target: string, body?: string): Promise<T> {
  const response = await fetch(host.origin + target, {
    method, body,
    headers: { ...(body === undefined ? {} : { "content-type": "text/plain" }), ...(await signedHeaders(signer, host.gatewayId, method, target, body, host.verifiedClockOffset_ms)) },
  });
  const json = (await response.json().catch(() => null)) as (T & { error?: ErrorEnvelope }) | null;
  if (!response.ok || !json) {
    if (json?.error) throw HostError.from(json.error);
    throw new HostError("UNAVAILABLE", `The host answered HTTP ${response.status}.`, { retryable: true });
  }
  return json;
}

const targetOf = (name: string): string => {
  if (!SECRET_NAME_PATTERN.test(name)) throw new HostError("INVALID_PARAMS", "A secret name is upper-case letters, digits and underscores, starting with a letter.");
  return `/jagentchill/v1/secrets/${name}`;
};

/**
 * Sends a secret value (a provider key, a header value, the pasted answer of a sign-in step) to the host over the
 * signed route. A value never travels in a channel frame, and the host never sends one back: the answer is the name
 * and, for a value of twelve characters or more, its last four. The caller clears its own copy afterwards.
 */
export const putHostSecret = async (host: HostRecord, signer: DeviceSigner, name: string, value: string): Promise<{ name: string; hint?: string }> =>
  send(host, signer, "PUT", targetOf(name), value);

export const deleteHostSecret = async (host: HostRecord, signer: DeviceSigner, name: string): Promise<{ name: string }> => send(host, signer, "DELETE", targetOf(name));

/** Names and hints of the host's secrets; never a value. */
export const listHostSecrets = async (host: HostRecord, signer: DeviceSigner): Promise<HostSecretInfo[]> =>
  (await send<{ secrets: HostSecretInfo[] }>(host, signer, "GET", "/jagentchill/v1/secrets")).secrets;
