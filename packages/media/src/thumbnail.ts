import { TICKS_PER_SECOND } from "@jagentchill/protocol";

/** Thumbnails fit inside this box, aspect preserved. [PORT M-011: `thumbnailSize` of OpenCut classic `media/thumbnail.ts`] */
export const THUMBNAIL_MAX_WIDTH = 1280;
export const THUMBNAIL_MAX_HEIGHT = 720;
export const THUMBNAIL_JPEG_QUALITY = 0.8;

export function thumbnailSize({ width, height }: { width: number; height: number }): { width: number; height: number } {
  const aspectRatio = width / height;
  let targetWidth = width, targetHeight = height;
  if (targetWidth > THUMBNAIL_MAX_WIDTH) {
    targetWidth = THUMBNAIL_MAX_WIDTH;
    targetHeight = Math.round(targetWidth / aspectRatio);
  }
  if (targetHeight > THUMBNAIL_MAX_HEIGHT) {
    targetHeight = THUMBNAIL_MAX_HEIGHT;
    targetWidth = Math.round(targetHeight * aspectRatio);
  }
  return { width: Math.max(1, targetWidth), height: Math.max(1, targetHeight) };
}
/** The video frame a thumbnail shows: `min(1 s, duration / 2)`, in ticks. */
export const thumbnailTimeTicks = (durationTicks: number): number => Math.min(TICKS_PER_SECOND, Math.floor(durationTicks / 2));
/** JPEG at quality 0.8; PNG when the picture has alpha. */
export const thumbnailEncoding = (hasAlpha: boolean): { mimeType: "image/png" | "image/jpeg"; quality?: number; extension: "png" | "jpg" } =>
  hasAlpha ? { mimeType: "image/png", extension: "png" } : { mimeType: "image/jpeg", quality: THUMBNAIL_JPEG_QUALITY, extension: "jpg" };
/** Name of an asset's thumbnail in the thumbnail store of `project-storage.Stored record layout`. */
export const thumbnailName = (assetId: string, hasAlpha: boolean): string => `${assetId}.${thumbnailEncoding(hasAlpha).extension}`;

export type Thumbnail = { bytes: Uint8Array; mimeType: "image/png" | "image/jpeg"; width: number; height: number };
/** What an asset card shows in place of a picture: audio has a waveform glyph, an undecodable video its type icon. */
export function thumbnailFallback(asset: { type: "image" | "video" | "audio" }, hasThumbnail: boolean): "none" | "waveform-glyph" | "type-icon" {
  if (asset.type === "audio") return "waveform-glyph";
  return hasThumbnail ? "none" : "type-icon";
}
