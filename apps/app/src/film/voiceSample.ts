/** A voice sample from this device: picking a recording, or recording one. A phone build has neither yet (see voiceSample.web.ts). */
export const CAN_PICK_SAMPLE = false;
export const CAN_RECORD_SAMPLE = false;
export const pickSample = (): Promise<(Blob & { name?: string }) | null> => Promise.resolve(null);
export type SampleRecording = { /** Ends the recording and answers it as a WAV file. */ stop(): Promise<Blob & { name?: string }>; /** Ends it and keeps nothing. */ cancel(): void };
export const recordSample = (_maxBytes: number, _onFull: () => void): Promise<SampleRecording> => Promise.reject(new Error("Recording is not available on this device."));
