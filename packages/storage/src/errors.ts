/** The error types every store reports, on every platform. */
export type StorageErrorKind = "NotFound" | "QuotaExceeded" | "Corrupt" | "Unavailable";
export class StorageError extends Error {
  readonly kind: StorageErrorKind;
  readonly details?: Record<string, unknown>;
  constructor(kind: StorageErrorKind, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "StorageError";
    this.kind = kind;
    this.details = details;
  }
}
export const isStorageError = (error: unknown, kind?: StorageErrorKind): error is StorageError => error instanceof StorageError && (kind === undefined || error.kind === kind);

/** Maps what a platform store throws to the port's error types. */
export function toStorageError(error: unknown, fallback: StorageErrorKind = "Unavailable"): StorageError {
  if (error instanceof StorageError) return error;
  const name = (error as { name?: string; code?: string } | null)?.name ?? "", code = (error as { code?: string } | null)?.code ?? "";
  const message = error instanceof Error ? error.message : String(error);
  if (name === "QuotaExceededError" || code === "ENOSPC" || code === "EDQUOT" || /SQLITE_FULL|database or disk is full/i.test(message)) return new StorageError("QuotaExceeded", message);
  if (name === "NotFoundError" || code === "ENOENT") return new StorageError("NotFound", message);
  return new StorageError(fallback, message);
}
