import { HostError } from "./errors.ts";
import { signedHeaders, type HostRecord } from "./pairing.ts";
import type { DeviceSigner } from "./signer.ts";

/**
 * Fetches an export the host prepared (the archive of a skill, a usage CSV) over the signed route. The host names it
 * by the SHA-256 of its bytes; there is no public link to it.
 */
export async function downloadHostExport(host: HostRecord, signer: DeviceSigner, kind: "skills" | "usage", sha256: string): Promise<Blob> {
  const target = `/jagentchill/v1/${kind}/exports/${sha256}`;
  const response = await fetch(host.origin + target, { headers: await signedHeaders(signer, host.gatewayId, "GET", target, undefined, host.verifiedClockOffset_ms) });
  if (!response.ok) throw new HostError(response.status === 404 ? "NOT_FOUND" : "UNAVAILABLE", `The host answered HTTP ${response.status}.`, { retryable: response.status !== 404 });
  return response.blob();
}
