import { pickFiles } from "../platform/store";

/** A voice sample from a browser window (the desktop app is one too): a recording the person picks, or one made here with the microphone. */
export const CAN_PICK_SAMPLE = true;
export const CAN_RECORD_SAMPLE = typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function" && typeof MediaRecorder === "function";
/** The kinds of recording the host keeps as a voice sample (it reads the file's first bytes: a WAV, MP3, M4A, OGG or FLAC). */
export const pickSample = async (): Promise<(Blob & { name?: string }) | null> => (await pickFiles("audio/wav,audio/x-wav,audio/mpeg,audio/mp4,audio/x-m4a,audio/ogg,audio/flac,.wav,.mp3,.m4a,.ogg,.flac", false))[0] ?? null;
export type SampleRecording = { stop(): Promise<Blob & { name?: string }>; cancel(): void };

/** Decoded sound as a mono 16-bit WAV: what a browser records (WebM/Opus) is not a file every voice provider reads, a WAV is. */
function wavOf(buffer: AudioBuffer): Blob {
  const frames = buffer.length, rate = buffer.sampleRate, channels = buffer.numberOfChannels, out = new DataView(new ArrayBuffer(44 + frames * 2));
  const text = (at: number, value: string) => { for (let i = 0; i < value.length; i++) out.setUint8(at + i, value.charCodeAt(i)); };
  text(0, "RIFF"); out.setUint32(4, 36 + frames * 2, true); text(8, "WAVEfmt "); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, rate, true); out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true); text(36, "data"); out.setUint32(40, frames * 2, true);
  const data = Array.from({ length: channels }, (_unused, channel) => buffer.getChannelData(channel));
  for (let frame = 0; frame < frames; frame++) { let sum = 0; for (const channel of data) sum += channel[frame]; const value = Math.max(-1, Math.min(1, sum / channels)); out.setInt16(44 + frame * 2, Math.round(value * 32767), true); }
  return new Blob([out.buffer], { type: "audio/wav" });
}
/**
 * Records the microphone until `stop`. `maxBytes` is the most a sample may be (the host's limit, the provider's
 * documented one): the recording is ended by itself — `onFull` — before the WAV it becomes would pass it.
 */
export async function recordSample(maxBytes: number, onFull: () => void): Promise<SampleRecording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true }), recorder = new MediaRecorder(stream), pieces: Blob[] = [];
  const rate = stream.getAudioTracks()[0]?.getSettings().sampleRate ?? 48_000, longest = Math.max(1, Math.floor((maxBytes - 44) / (rate * 2)));
  recorder.ondataavailable = (event) => { if (event.data.size) pieces.push(event.data); };
  const ended = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
  const release = () => { for (const track of stream.getTracks()) track.stop(); };
  recorder.start();
  const timer = setTimeout(onFull, longest * 1000);
  return {
    async stop() {
      clearTimeout(timer);
      if (recorder.state !== "inactive") recorder.stop();
      await ended; release();
      const Context = (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Context) throw new Error("This browser cannot turn the recording into a WAV file.");
      const context = new Context();
      try { const wav = wavOf(await context.decodeAudioData(await new Blob(pieces, { type: recorder.mimeType }).arrayBuffer())); return Object.assign(wav, { name: "my-voice.wav" }); } finally { void context.close(); }
    },
    cancel() { clearTimeout(timer); if (recorder.state !== "inactive") recorder.stop(); release(); },
  };
}
