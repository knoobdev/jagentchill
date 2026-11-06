import { RUNTIME_ERROR_CODES } from "./agent-runtimes.ts";
import { ORC_ERROR_CODES } from "./orc.ts";
import { SYNC_ERROR_CODES } from "./sync.ts";
import { SKILL_ERROR_CODES } from "./skills.ts";
import type { ToolErrorCode } from "./tools.ts";
import type { WorkflowErrorCode } from "./workflow.ts";
import type { MultiAgentErrorCode } from "./agent-team.ts";

/** General error codes of the RPC error envelope. */
export const GENERAL_ERROR_CODES = [
  "INVALID_PARAMS", "PAYLOAD_TOO_LARGE", "NOT_FOUND", "ALREADY_EXISTS", "CONFLICT", "IDEMPOTENCY_CONFLICT", "SCOPE_DENIED",
  "PERMISSION_DENIED", "DEVICE_NOT_ATTESTED", "DEVICE_REVOKED", "RATE_LIMITED", "QUOTA_EXCEEDED", "UNSUPPORTED_FEATURE",
  "PROTOCOL_UNSUPPORTED", "UNAVAILABLE", "TIMEOUT", "CANCELLED", "INTERNAL", "NO_PROJECT_BOUND", "BUDGET_EXCEEDED",
  "APPROVAL_TIMEOUT", "NO_ROUTE", "EGRESS_BLOCKED", "RENDERER_UNAVAILABLE", "FFMPEG_UNAVAILABLE",
] as const;

/** Closed set of pairing and signing codes. */
export const PAIRING_ERROR_CODES = [
  "OFFER_INVALID", "OFFER_EXPIRED", "OFFER_VERSION_UNSUPPORTED", "GATEWAY_UNREACHABLE", "GATEWAY_MISMATCH",
  "GATEWAY_SIGNATURE_INVALID", "CHALLENGE_UNKNOWN", "CHALLENGE_EXPIRED", "DEVICE_ID_MISMATCH", "DEVICE_SIGNATURE_INVALID",
  "DEVICE_UNKNOWN", "PAIRING_LIMIT", "PAIRING_CANCELLED", "PAIRING_HOST_LIMIT", "CODE_INVALID", "CODE_EXPIRED",
  "CODE_ATTEMPTS_EXCEEDED", "SIGN_REFUSED", "TOKEN_INVALID", "TOKEN_EXPIRED", "SIGNATURE_MISSING", "SIGNATURE_INVALID",
  "CLOCK_SKEW", "NONCE_REPLAYED", "LAST_ADMIN", "KEY_STORAGE_UNAVAILABLE", "WEBCRYPTO_UNSUPPORTED",
] as const;

/** Codes of the agent relay. */
export const AGENT_ERROR_CODES = [
  "GATEWAY_UNAVAILABLE", "AGENT_CLASS_DENIED", "SESSION_UNBOUND", "FORK_ANCHOR_GONE", "REWIND_NOT_ACKNOWLEDGED",
] as const;

export type ErrorCode =
  | (typeof GENERAL_ERROR_CODES)[number]
  | (typeof PAIRING_ERROR_CODES)[number]
  | (typeof AGENT_ERROR_CODES)[number]
  | (typeof RUNTIME_ERROR_CODES)[number]
  | (typeof ORC_ERROR_CODES)[number]
  | (typeof SYNC_ERROR_CODES)[number]
  | (typeof SKILL_ERROR_CODES)[number]
  | ToolErrorCode
  | WorkflowErrorCode
  | MultiAgentErrorCode;

export type ErrorEnvelope = { code: ErrorCode; message: string; retryable: boolean; details?: Record<string, unknown> };

/** Close codes of the product channel. */
export const CLOSE_CODES = {
  badFrame: 4400,
  unauthenticated: 4401,
  revoked: 4403,
  handshakeTimeout: 4408,
  protocolUnsupported: 4426,
  limit: 4429,
} as const;
