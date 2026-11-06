import { randomBytes } from "node:crypto";
import { CHALLENGE_TTL_MS } from "@jagentchill/protocol";
import { ProtocolError } from "../errors.ts";

const MAX_OUTSTANDING = 4096;

type Challenge = { gatewayNonce: string; ts: number; binding: string };

/** Single-use challenges, each bound to the enrolment request or the connection it was issued for. */
export class ChallengeBook {
  private readonly byNonce = new Map<string, Challenge>();
  private readonly now: () => number;

  constructor(now: () => number) {
    this.now = now;
  }

  issue(binding: string): { gatewayNonce: string; ts: number } {
    const ts = this.now();
    if (this.byNonce.size >= MAX_OUTSTANDING) {
      for (const [nonce, challenge] of this.byNonce) {
        if (ts - challenge.ts > CHALLENGE_TTL_MS) this.byNonce.delete(nonce);
      }
      if (this.byNonce.size >= MAX_OUTSTANDING) {
        throw new ProtocolError("RATE_LIMITED", "Too many outstanding challenges.", {
          httpStatus: 429, retryable: true, details: { retryAfter_ms: CHALLENGE_TTL_MS },
        });
      }
    }
    const gatewayNonce = randomBytes(32).toString("base64url");
    this.byNonce.set(gatewayNonce, { gatewayNonce, ts, binding });
    return { gatewayNonce, ts };
  }

  /** Removes the challenge whatever the outcome, so a nonce can never be presented twice. */
  consume(binding: string, gatewayNonce: string): { ts: number } {
    const challenge = this.byNonce.get(gatewayNonce);
    if (!challenge || challenge.binding !== binding) {
      throw new ProtocolError("CHALLENGE_UNKNOWN", "The challenge is not outstanding for this exchange.", { httpStatus: 401 });
    }
    this.byNonce.delete(gatewayNonce);
    if (this.now() - challenge.ts > CHALLENGE_TTL_MS) {
      throw new ProtocolError("CHALLENGE_EXPIRED", "The challenge has expired.", { httpStatus: 401, retryable: true });
    }
    return { ts: challenge.ts };
  }

  discard(gatewayNonce: string): void {
    this.byNonce.delete(gatewayNonce);
  }
}
