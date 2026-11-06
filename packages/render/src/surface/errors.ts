import type { EngineError, EngineErrorCode } from "@jagentchill/protocol";

/** A failure of the engine or of the surface, carrying one code of the closed set. */
export class EngineFailure extends Error {
  readonly code: EngineErrorCode;
  readonly details?: Record<string, unknown>;
  constructor(code: EngineErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "EngineFailure";
    this.code = code;
    this.details = details;
  }
  toJSON(): EngineError {
    return { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) };
  }
}

/** Whether schema validation runs: always in development and test builds, never in a production build. */
export const validationDefault = (): boolean => (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.NODE_ENV !== "production";
