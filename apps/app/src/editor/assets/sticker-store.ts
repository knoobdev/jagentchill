import { preference } from "@jagentchill/app-core";

/** One imported sticker of a project: the media asset that holds its file, by content hash. */
export type UserSticker = { assetId: string; sha256: string; name: string; width: number; height: number; animated: boolean };
export const STICKER_CATEGORIES = ["all", "emoji", "shapes", "user"] as const;
export type StickerCategory = (typeof STICKER_CATEGORIES)[number];
export type StickerSettings = { version: 1; category: string; recents: string[]; user: Record<string, UserSticker[]> };
/** `stickers-settings`: the selected category, the recents and the imported stickers of each project, kept per device. */
export const STICKER_SETTINGS = preference<StickerSettings>("stickers-settings", { version: 1, category: "all", recents: [], user: {} }, (value): value is StickerSettings => {
  const settings = value as StickerSettings | null;
  return settings !== null && typeof settings === "object" && typeof settings.category === "string" && Array.isArray(settings.recents) && settings.recents.every((entry) => typeof entry === "string") && settings.user !== null && typeof settings.user === "object";
});
/** The stored category, or All when it is not a tab of this build. */
export const categoryOf = (settings: StickerSettings): StickerCategory => ((STICKER_CATEGORIES as readonly string[]).includes(settings.category) ? (settings.category as StickerCategory) : "all");
export const STICKER_MAX_BYTES = 20 * 1024 * 1024;
export const STICKER_ACCEPT = ".png,.jpg,.jpeg,.webp,.gif,.apng,.svg";
