import { preference } from "@jagentchill/app-core";

const bool = (value: unknown): value is boolean => typeof value === "boolean";
const limit = (value: unknown): value is number | null => value === null || (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 100);
/** The per-device preferences of the Sync card, with the names and defaults the sync capability gives them. */
export const SYNC_PREFS = {
  /** "Sync new projects": on by default; it applies only while a host is paired. */
  newProjects: preference<boolean>("sync.newProjects", true, bool),
  /** "Download originals automatically": `null` follows the platform (on for desktop, off elsewhere). */
  originals: preference<boolean | null>("sync.downloadOriginals", null, (value): value is boolean | null => value === null || bool(value)),
  /** "Sync media over mobile data" (mobile only). */
  mobileData: preference<boolean>("sync.mobileData", false, bool),
  /** "Upload limit" / "Download limit": off (`null`), or 1 to 100 Mbit/s. */
  uploadLimit: preference<number | null>("sync.uploadLimit", null, limit),
  downloadLimit: preference<number | null>("sync.downloadLimit", null, limit),
  /** "Sync my library". */
  library: preference<boolean>("sync.library", true, bool),
  /** The name review comments are signed with; empty: the device name. */
  displayName: preference<string>("sync.commentName", "", (value): value is string => typeof value === "string" && value.length <= 80),
};
export const LIMIT_OPTIONS = [1, 2, 5, 10, 20, 50, 100] as const;
/** The library records "Sync my library" carries. */
export const SYNCED_LIBRARY = ["saved-sounds", "brand-kits", "styles", "luts"] as const;
