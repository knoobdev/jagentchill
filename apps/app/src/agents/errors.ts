import type { HostError } from "@jagentchill/client";
import { messageFor } from "../messages";

/** Codes whose message is written by the host for the person in front of the screen: the reason a runtime, a provider or a route gives. */
const HOST_WORDED = /^(runtime\/|NO_ROUTE$|RATE_LIMITED$|CONFLICT$|INVALID_PARAMS$|UNAVAILABLE$|VALIDATION_FAILED$|ROLE_|CAPABILITY_MISMATCH$|FORK_ANCHOR_GONE$|REWIND_NOT_ACKNOWLEDGED$|AGENT_CLASS_DENIED$|QUOTA_EXCEEDED$|BUDGET_EXCEEDED$|NOT_FOUND$)/;
export const codeOf = (error: unknown): string => (error as Partial<HostError> | undefined)?.code ?? "";
export const detailsOf = (error: unknown): Record<string, any> => ((error as Partial<HostError> | undefined)?.details ?? {}) as Record<string, any>;
/** The sentence shown for a failed call: the host's own reason where it gives one, else the text of the code. */
export function reasonOf(error: unknown): string {
  const code = codeOf(error);
  const message = (error as { message?: string } | undefined)?.message;
  if (code === "SCOPE_DENIED" && message && /admin/i.test(message)) return message;
  return HOST_WORDED.test(code) && message ? message : messageFor(error);
}
