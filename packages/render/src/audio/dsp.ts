// Stages 6–8 and 13 of the audio chain and the loudness measurement are pure maths the editor shares (the Audio
// panel measures a clip with them): they live in `editor-core`, and the engine reads them through this module.
export {
  Biquad, peaking, shelf, highPass, eqSections, Compressor, ClipChain, VoiceDetector, Ducker, measureLoudness, truePeakDb, normalizeGainDb, EQ_PRESET_BANDS,
  type EqBands, type CompressorSettings, type ClipProcessing, type DuckingSettings, type Loudness,
} from "@jagentchill/editor-core";
