/** Browser-only: the sound of a media file as speech samples. Native builds have no decoder here, and the tools that need it say so. */
export const SPEECH_RATE = 16_000;
/** The sound of a media file as 16-bit mono at 16 kHz; `null` when the platform cannot decode it or the file has no sound. */
export function decodeSpeech(_url: string): Promise<Int16Array | null> { return Promise.resolve(null); }
export const canDecodeSpeech = false;
