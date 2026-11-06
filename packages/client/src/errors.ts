import type { ErrorCode, ErrorEnvelope } from "@jagentchill/protocol";

/** A failure the UI shows by `code`; `message` is English text for logs only. */
export class HostError extends Error {
  readonly code: ErrorCode | "CONNECTION_CLOSED";
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(code: HostError["code"], message: string, opts: { retryable?: boolean; details?: Record<string, unknown> } = {}) {
    super(message);
    this.code = code;
    this.retryable = opts.retryable ?? false;
    this.details = opts.details;
  }

  static from(envelope: ErrorEnvelope): HostError {
    return new HostError(envelope.code, envelope.message, { retryable: envelope.retryable, details: envelope.details });
  }
}
