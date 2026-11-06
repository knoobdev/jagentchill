/** What the run screens of "One prompt → video" need from a browser window; a phone has none of it (see platform.web.ts). */
export const CAN_PICK_PICTURES = false;
export const CAN_PLAY_SOUND = false;
export const pickPicture = (): Promise<(Blob & { name?: string }) | null> => Promise.resolve(null);
export const imageSize = (_file: Blob): Promise<{ width?: number; height?: number }> => Promise.resolve({});
export type Sound = { play(fromSeconds: number): void; stop(): void };
export const soundOf = (_uri: string): Sound | null => null;
