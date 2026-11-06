/** The validation error codes of `catalog.md` §14. No other `document/…` code exists. */
export const DOCUMENT_ERROR_CODES = [
  "document/not-an-object", "document/unknown-format", "document/schema-too-old", "document/schema-too-new", "document/invalid-min-reader",
  "document/missing-field", "document/wrong-type", "document/out-of-range", "document/not-integer-ticks", "document/not-frame-aligned",
  "document/invalid-number", "document/invalid-rational", "document/invalid-color", "document/invalid-id", "document/duplicate-id",
  "document/field-not-allowed", "document/too-large", "document/limit-exceeded", "document/no-main-scene", "document/main-track-invalid",
  "document/track-zone-mismatch", "document/element-track-mismatch", "document/elements-overlap", "document/elements-unsorted",
  "document/time-out-of-bounds", "document/unknown-asset", "document/asset-type-mismatch", "document/unknown-scene", "document/compound-cycle",
  "document/compound-depth", "document/unknown-definition", "document/unknown-reference", "document/link-invalid", "document/group-invalid",
  "document/transition-ref-mismatch", "document/transition-not-adjacent", "document/animation-path-invalid", "document/animation-channel-invalid",
  "document/effects-limit", "document/masks-limit", "document/caption-overlap", "document/multicam-invalid", "document/template-invalid",
  "document/template-locked", "document/patch-invalid", "document/device-local-in-patch",
] as const;
export type DocumentErrorCode = (typeof DOCUMENT_ERROR_CODES)[number];

/** One finding of the validator. `path` is an id path of the state patch format. `message` is English, for logs. */
export type DocumentError = { code: DocumentErrorCode; path: string; message: string; details?: Record<string, unknown> };

const KNOWN = new Set<string>(DOCUMENT_ERROR_CODES);
export function documentError(code: string, path: string, message: string, details?: Record<string, unknown>): DocumentError {
  if (!KNOWN.has(code)) throw new Error(`"${code}" is not a document error code of catalog.md §14`);
  return { code: code as DocumentErrorCode, path, message, ...(details ? { details } : {}) };
}

/** Thrown by writers and appliers that reject a change as a whole. */
export class DocumentRejected extends Error {
  readonly errors: DocumentError[];
  constructor(errors: DocumentError[]) {
    super(errors.map((error) => `${error.code} at ${error.path || "/"}: ${error.message}`).join("; "));
    this.name = "DocumentRejected";
    this.errors = errors;
  }
  get code(): DocumentErrorCode { return this.errors[0].code; }
}

export type BoundaryError = { code: "INVALID_PARAMS" | "CONFLICT" | "PATCH_INVALID"; message: string; details: { documentErrors: Pick<DocumentError, "code" | "path" | "message">[] } };
/**
 * How document errors cross an RPC or tool boundary: `INVALID_PARAMS`, except a locked template (`CONFLICT`) and a
 * failed sync application (`PATCH_INVALID`), always with the `{code, path, message}` list.
 */
export function toBoundaryError(errors: DocumentError[], boundary: "rpc" | "tool" | "sync" = "rpc"): BoundaryError {
  const documentErrors = errors.map(({ code, path, message }) => ({ code, path, message }));
  const code = boundary === "sync" ? "PATCH_INVALID" : errors.some((error) => error.code === "document/template-locked") ? "CONFLICT" : "INVALID_PARAMS";
  return { code, message: errors[0]?.message ?? "the document change was rejected", details: { documentErrors } };
}
