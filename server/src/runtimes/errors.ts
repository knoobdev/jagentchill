import type { ErrorCode } from "@jagentchill/protocol";

export type TurnError = { code: ErrorCode; message: string; retryable: boolean; details?: Record<string, unknown> };

/** `models.probe` status as a domain error code. */
export const PROBE_ERROR: Record<string, ErrorCode | undefined> = {
  auth: "runtime/auth-failed", rate_limit: "runtime/rate-limited", billing: "runtime/billing", timeout: "TIMEOUT", no_model: "runtime/model-unavailable",
  format: "UNAVAILABLE", unknown: "UNAVAILABLE",
};
/** `models.list` `unavailableReason` as a domain error code. */
export const UNAVAILABLE_REASON_ERROR: Record<string, ErrorCode | undefined> = {
  "missing-auth": "runtime/signed-out", "auth-failed": "runtime/auth-failed", cooldown: "runtime/rate-limited", "unsupported-runtime": "runtime/unsupported-capability",
};

/**
 * Maps the text of a failed turn onto the closed set of runtime codes. The raw text is not the message: it goes under
 * "Details" on the device, after redaction, and an unrecognised failure is reported as such.
 */
export function classifyTurnError(raw: string, runtimeLabel: string): TurnError {
  const text = raw.toLowerCase();
  const exit = /exit(?:ed)?(?: with)?(?: code)? (\d+)/.exec(text)?.[1];
  if (/enoent|command not found|spawn .* failed|failed to start|exited before/.test(text) || (exit && /before|launch|start/.test(text))) {
    return { code: "runtime/launch-failed", message: `${runtimeLabel} failed to start${exit ? ` (exit ${exit})` : ""}`, retryable: false, ...(exit ? { details: { exitCode: Number(exit) } } : {}) };
  }
  // A refusal of the REQUEST under the provider's content rules: asking another model the same thing is not the answer
  // to it. It is read BEFORE the status-code rules: such a refusal often comes as a 403, which is not a sign-in failure.
  if (/content.?(policy|filter|management|moderation)|safety (system|filter|policy)|was flagged|moderation|violates? (our|the) (usage )?polic/.test(text)) return { code: "CONTENT_BLOCKED", message: "The provider refused this request under its content policy.", retryable: false };
  if (/rate.?limit|too many requests|\b429\b|overloaded/.test(text)) {
    const seconds = /(?:retry|try again)(?:-after| after| in)?:? ?(\d+) ?(?:s|sec)/.exec(text)?.[1];
    return { code: "runtime/rate-limited", message: "The provider is limiting requests. Try again shortly.", retryable: true, details: { retryAfter_ms: seconds ? Number(seconds) * 1000 : 60_000 } };
  }
  if (/insufficient.?(quota|credit|balance)|billing|payment required|\b402\b|no remaining credit/.test(text)) {
    return { code: "runtime/billing", message: "The account has no remaining credit or quota", retryable: false };
  }
  if (/unauthori[sz]ed|invalid.?api.?key|incorrect api key|authentication|\b401\b|\b403\b|not logged in|login required|token (?:has )?expired/.test(text)) {
    return { code: "runtime/auth-failed", message: `Sign in to ${runtimeLabel} again`, retryable: false };
  }
  if (/context.?(length|window)|maximum context|too many tokens|prompt is too long/.test(text)) {
    return { code: "runtime/context-overflow", message: "The conversation is too long for this model. Compact it or start a new session.", retryable: false };
  }
  if (/model.{0,40}(not found|does not exist|not available|unknown)|no such model|\b404\b/.test(text)) {
    return { code: "runtime/model-unavailable", message: "This model is no longer available. Choose another model.", retryable: false };
  }
  if (/timed? ?out|etimedout/.test(text)) return { code: "TIMEOUT", message: "The provider did not answer in time.", retryable: true };
  return { code: "UNAVAILABLE", message: "The provider returned an unexpected error", retryable: false };
}

export type TurnFailureClass = "rate_limited" | "quota_exhausted" | "auth_error" | "invalid_request" | "model_unavailable" | "timeout" | "content_blocked" | "unknown";
const CLASS_OF_CODE: Record<string, TurnFailureClass | undefined> = {
  "runtime/rate-limited": "rate_limited", "runtime/billing": "quota_exhausted", "runtime/auth-failed": "auth_error", "runtime/signed-out": "auth_error", "runtime/context-overflow": "invalid_request",
  "runtime/model-unavailable": "model_unavailable", "runtime/launch-failed": "model_unavailable", TIMEOUT: "timeout", CONTENT_BLOCKED: "content_blocked", UNAVAILABLE: "unknown",
};
/**
 * The failure class of a failed turn, as the fallback rules of Model routing name classes (`fallbackOn`). From the
 * CODE `classifyTurnError` gave the failure when the caller was handed it; else from the sentence it gave — the only
 * thing a caller of `runs.turn` gets today. KEEP the sentences IN STEP with the ones above (`test/captions.test.ts`
 * checks each of them).
 */
export function turnFailureClass(message: string, code?: string): TurnFailureClass {
  const known = code ? CLASS_OF_CODE[code] : undefined;
  if (known) return known;
  if (/is limiting requests/.test(message)) return "rate_limited";
  if (/no remaining credit or quota/.test(message)) return "quota_exhausted";
  if (/^Sign in to .+ again$/.test(message)) return "auth_error";
  if (/too long for this model/.test(message)) return "invalid_request";
  if (/no longer available|failed to start/.test(message)) return "model_unavailable";
  if (/did not answer in time/.test(message)) return "timeout";
  if (/refused this request under its content policy/.test(message)) return "content_blocked";
  return "unknown";
}
