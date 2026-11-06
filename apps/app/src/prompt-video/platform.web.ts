import { pickFiles } from "../platform/store";

/** The file picker, the size of a picture and sound, in a browser window (the desktop app is one too). */
export const CAN_PICK_PICTURES = true;
export const CAN_PLAY_SOUND = true;
export const pickPicture = async (): Promise<(Blob & { name?: string }) | null> => (await pickFiles("image/png,image/jpeg,image/webp", false))[0] ?? null;
export function imageSize(file: Blob): Promise<{ width?: number; height?: number }> {
  return new Promise((resolve) => {
    const uri = URL.createObjectURL(file), image = new Image();
    const done = (size: { width?: number; height?: number }) => { URL.revokeObjectURL(uri); resolve(size); };
    image.onload = () => done(image.naturalWidth && image.naturalHeight ? { width: image.naturalWidth, height: image.naturalHeight } : {});
    image.onerror = () => done({});
    image.src = uri;
  });
}
export type Sound = { play(fromSeconds: number): void; stop(): void };
/** One recording of the preview: started at a point of itself, stopped when the preview pauses or moves on. */
export function soundOf(uri: string): Sound | null {
  if (typeof Audio === "undefined") return null;
  const audio = new Audio(uri);
  audio.preload = "auto";
  return {
    play(fromSeconds) { try { audio.currentTime = Math.max(0, fromSeconds); } catch { /* not loaded yet: it starts at its beginning */ } void audio.play().catch(() => undefined); },
    stop() { audio.pause(); },
  };
}
