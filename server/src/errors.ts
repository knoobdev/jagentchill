import type { ErrorCode, ErrorEnvelope } from "@jagentchill/protocol";

/** An error that crosses the wire as the RPC error envelope. */
export class ProtocolError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, opts: { httpStatus?: number; retryable?: boolean; details?: Record<string, unknown> } = {}) {
    super(message);
    this.code = code;
    this.httpStatus = opts.httpStatus ?? 400;
    this.retryable = opts.retryable ?? false;
    this.details = opts.details;
  }

  envelope(): ErrorEnvelope {
    return { code: this.code, message: this.message, retryable: this.retryable, ...(this.details ? { details: this.details } : {}) };
  }
}
