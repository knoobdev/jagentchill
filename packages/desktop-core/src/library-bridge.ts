/**
 * The renderer reaches the project library with ids, never with paths. Each operation of the storage port is listed
 * here with the kind of every argument; a call whose method is not listed, or whose argument could name a location
 * outside the library, is rejected before the store sees it.
 */
type Kind =
  | "id" /** one path segment: a project, asset, snapshot or document id */
  | "name" /** a file name inside the library: safe segments separated by `/` */
  | "prefix" /** like `name`, may be empty or end with `/` */
  | "token" /** a short lower-case word: a blob kind, a document kind, a library record */
  | "text" | "bytes" | "json" | "number" | "options" | "snapshot" | "cacheKey" | "cacheKeys" | "category" | "upload";

export const LIBRARY_METHODS: Readonly<Record<string, readonly Kind[]>> = {
  listProjects: [], readProjectText: ["id"], readProject: ["id"], writeProjectText: ["id", "text"], hasProject: ["id"], deleteProject: ["id"],
  writeMedia: ["id", "id", "bytes", "options"], readMedia: ["id", "id"], hasMedia: ["id", "id"], removeMedia: ["id", "id"], listMedia: ["id"],
  writeMediaStream: ["id", "id", "upload", "options"], mediaInfo: ["id", "id"], listMediaFiles: [], discardMediaFile: ["id", "id"], listProjectFiles: ["id"], mediaReferences: ["id"],
  putSnapshot: ["id", "snapshot"], listSnapshots: ["id"], readSnapshot: ["id", "id"], deleteSnapshot: ["id", "id"],
  putBackup: ["id", "json"], listBackups: ["id"], readBackup: ["id", "id"], deleteBackup: ["id", "id"],
  appendJournal: ["id", "json"], readJournal: ["id"], truncateJournal: ["id", "number"], clearJournal: ["id"],
  putBlob: ["token", "id", "id", "bytes"], getBlob: ["token", "id", "id"], deleteBlob: ["token", "id", "id"],
  readLibrary: ["token"], writeLibrary: ["token", "json"], writeLibraryFile: ["name", "bytes"], readLibraryFile: ["name"], deleteLibraryFile: ["name"], listLibraryFiles: ["prefix"],
  putDocument: ["token", "id", "json"], getDocument: ["token", "id"], peekDocument: ["token", "id"], listDocuments: ["token"], deleteDocument: ["token", "id"],
  getSession: ["id"], putSession: ["id", "json"], deleteSession: ["id"],
  available: [], rebuildIndexes: [],
  "cache.put": ["cacheKey", "bytes", "options"], "cache.putStream": ["cacheKey", "upload", "options"], "cache.get": ["cacheKey"], "cache.has": ["cacheKey"],
  "cache.hold": ["cacheKeys"], "cache.evict": ["number"], "cache.enforceBudget": [], "cache.clear": ["category"], "cache.releaseProject": ["id"], "cache.usage": [],
  "cache.budget": [], "cache.setBudget": ["number"], "cache.evictable": [], "cache.rebuild": [],
  // Desktop only: external references, served through grants.
  externalStatus: ["id", "id"],
};
/** Reads in pieces: the method, its id arguments, and a byte range given separately. */
export const LIBRARY_RANGE_METHODS: Readonly<Record<string, readonly Kind[]>> = { readMediaStream: ["id", "id"], "cache.stream": ["cacheKey"] };

const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,127}$/;
export const isSafeSegment = (value: unknown): value is string => typeof value === "string" && SEGMENT.test(value) && !value.includes("..") && !value.endsWith(".");
const isName = (value: unknown, allowPrefix: boolean): boolean => {
  if (typeof value !== "string" || value.length > 512) return false;
  if (allowPrefix && value === "") return true;
  const parts = (allowPrefix ? value.replace(/\/$/, "") : value).split("/");
  return parts.length <= 8 && parts.every(isSafeSegment);
};
const isPlain = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Uint8Array);
const isCacheKey = (value: unknown): boolean => isPlain(value) && /^[a-z-]{1,24}$/.test(String(value.kind)) && isSafeSegment(value.contentHash) && (value.variant === undefined || isSafeSegment(value.variant))
  && Object.keys(value).every((key) => key === "kind" || key === "contentHash" || key === "variant");
/** Structured data without functions, bounded in depth; what a project record or a journal entry is. */
function isJson(value: unknown, depth = 0): boolean {
  if (depth > 64) return false;
  if (value === null || value === undefined || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((entry) => isJson(entry, depth + 1));
  if (isPlain(value)) return Object.values(value).every((entry) => isJson(entry, depth + 1));
  return false;
}
function accepts(kind: Kind, value: unknown): boolean {
  switch (kind) {
    case "id": return isSafeSegment(value);
    case "name": return isName(value, false);
    case "prefix": return isName(value, true);
    case "token": return typeof value === "string" && /^[a-z][a-z-]{0,31}$/.test(value);
    case "text": return typeof value === "string";
    case "bytes": return value instanceof Uint8Array;
    case "number": return typeof value === "number" && Number.isFinite(value) && value >= 0;
    case "json": return isJson(value);
    // The extension and the hash of a media write end up in a file name.
    case "options": return value === undefined || (isPlain(value) && isJson(value) && Object.entries(value).every(([key, entry]) => (key !== "extension" && key !== "contentHash" && key !== "projectId") || entry === undefined || isSafeSegment(entry)));
    case "snapshot": return isPlain(value) && isSafeSegment(value.id) && isJson(value) && (value.thumbnail === undefined || isSafeSegment(value.thumbnail));
    case "cacheKey": return isCacheKey(value);
    case "cacheKeys": return Array.isArray(value) && value.length <= 4096 && value.every(isCacheKey);
    case "category": return value === undefined || (typeof value === "string" && /^[A-Za-z ]{1,40}$/.test(value));
    case "upload": return isPlain(value) && typeof value.upload === "string" && /^[0-9a-f]{32}$/.test(value.upload) && Object.keys(value).length === 1;
  }
}

export type LibraryCallCheck = { ok: true } | { ok: false; code: "LIBRARY_METHOD_UNKNOWN" | "LIBRARY_ARGUMENT_REJECTED"; message: string };
/** Whether a call of the library bridge may reach the store. */
export function checkLibraryCall(method: string, args: readonly unknown[], table: Readonly<Record<string, readonly Kind[]>> = LIBRARY_METHODS): LibraryCallCheck {
  if (!Object.hasOwn(table, method)) return { ok: false, code: "LIBRARY_METHOD_UNKNOWN", message: `"${method.slice(0, 48)}" is not an operation of the project library` };
  const kinds = table[method];
  if (args.length > kinds.length) return { ok: false, code: "LIBRARY_ARGUMENT_REJECTED", message: `${method} takes ${kinds.length} argument(s)` };
  for (const [index, kind] of kinds.entries()) {
    if (!accepts(kind, args[index])) return { ok: false, code: "LIBRARY_ARGUMENT_REJECTED", message: `argument ${index + 1} of ${method} is not a valid ${kind}` };
  }
  return { ok: true };
}

export type LibraryStatus =
  | { state: "opening" }
  | { state: "ready"; path: string; readOnly: boolean; banner: string | null; rebuilding: string | null; indexRebuilt: boolean }
  /** The folder is missing or cannot be written: nothing is shown as deleted and nothing is changed until the user chooses. */
  | { state: "blocked"; path: string; message: string; reason: string; actions: { id: "retry" | "locate" | "create" | "quit"; label: string; enabled: boolean }[] };
