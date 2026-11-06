import { pcm16OfFloat } from "@jagentchill/editor-core";

export const SPEECH_RATE = 16_000;
export const canDecodeSpeech = typeof OfflineAudioContext !== "undefined";
/**
 * The sound of a media file as 16-bit mono at 16 kHz (what speech recognition takes): the browser decodes and
 * resamples it, the channels are averaged. `null` when it cannot be decoded or the file has no sound.
 */
export async function decodeSpeech(url: string): Promise<Int16Array | null> {
  try {
    const bytes = await (await fetch(url)).arrayBuffer();
    const buffer = await new OfflineAudioContext(1, SPEECH_RATE, SPEECH_RATE).decodeAudioData(bytes);
    if (!buffer.length || !buffer.numberOfChannels) return null;
    const mono = new Float32Array(buffer.length);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) { const data = buffer.getChannelData(channel); for (let index = 0; index < data.length; index++) mono[index] += data[index] / buffer.numberOfChannels; }
    return pcm16OfFloat(mono);
  } catch { return null; }
}
