import { ENGINE_PROTOCOL_VERSION, type EngineConstraints, type EngineReady } from "@jagentchill/protocol";

export const ENGINE_VERSION = "0.1.0";
type Scope = typeof globalThis & { VideoDecoder?: typeof VideoDecoder; VideoEncoder?: typeof VideoEncoder; AudioDecoder?: typeof AudioDecoder; AudioEncoder?: typeof AudioEncoder };

const VIDEO_CODECS = { avc: "avc1.640028", hevc: "hvc1.1.6.L123.B0", vp9: "vp09.00.40.08", av1: "av01.0.08M.08" } as const;

/** Capabilities the engine cannot run without, by the name `engine/unsupported-runtime` reports them under. */
export function missingCapabilities(scope: Scope = globalThis): ("wasm" | "video-decoder" | "audio-decoder" | "secure-context" | "worker")[] {
  const missing: ReturnType<typeof missingCapabilities> = [];
  if (typeof scope.WebAssembly === "undefined") missing.push("wasm");
  if (typeof scope.VideoDecoder === "undefined") missing.push("video-decoder");
  if (typeof scope.AudioDecoder === "undefined") missing.push("audio-decoder");
  if ((scope as { isSecureContext?: boolean }).isSecureContext !== true) missing.push("secure-context");
  if (typeof (scope as { Worker?: unknown }).Worker === "undefined") missing.push("worker");
  return missing;
}

async function supported(test: () => Promise<{ supported?: boolean }>): Promise<boolean> {
  try { return (await test()).supported === true; } catch { return false; }
}

/** First available of AAC, Opus, PCM in MOV; else the host is the only place audio can be encoded. */
export function audioEncodeConstraint(encoders: { aac: boolean; opus: boolean; flac: boolean }, pcm = true): EngineConstraints["audioEncode"] {
  return encoders.aac ? "aac" : encoders.opus ? "opus" : pcm ? "pcm-mov" : "gateway-only";
}

/**
 * The fast probe set of the ready handshake: values that are synchronous or answered by `isConfigSupported`.
 * No timing measurement, decode or encode run happens here.
 */
export async function probeRuntime(scope: Scope, given: { backend: EngineReady["backend"]; software: boolean; maxTextureSize: number; memoryClass: EngineReady["memoryClass"]; surface: EngineReady["surface"] }): Promise<EngineReady> {
  const decoders = {} as EngineReady["decoders"], encoders = {} as EngineReady["encoders"];
  for (const [name, codec] of Object.entries(VIDEO_CODECS) as [keyof typeof VIDEO_CODECS, string][]) {
    decoders[name] = { supported: scope.VideoDecoder ? await supported(() => scope.VideoDecoder!.isConfigSupported({ codec, codedWidth: 1920, codedHeight: 1080 })) : false };
    const config = { codec, width: 1920, height: 1080, framerate: 30 };
    const any = scope.VideoEncoder ? await supported(() => scope.VideoEncoder!.isConfigSupported(config)) : false;
    const hardware = any && scope.VideoEncoder ? await supported(() => scope.VideoEncoder!.isConfigSupported({ ...config, hardwareAcceleration: "prefer-hardware" })) : false;
    encoders[name] = { supported: any, hardware };
  }
  const audio = (codec: string) => (scope.AudioEncoder ? supported(() => scope.AudioEncoder!.isConfigSupported({ codec, sampleRate: 48_000, numberOfChannels: 2 })) : Promise.resolve(false));
  const audioEncoders = { aac: await audio("mp4a.40.2"), opus: await audio("opus"), flac: await audio("flac") };
  const anyVideoEncoder = Object.values(encoders).some((entry) => entry.supported);
  const constraints: EngineConstraints = {
    calibrated: given.surface === "render-host", proxyEditing: "optional", hevcDecode: decoders.hevc.supported, onDeviceVideoExport: anyVideoEncoder,
    audioEncode: audioEncodeConstraint(audioEncoders), cachePoolScale: 1, binarySink: "direct", timeEventsPerSecond: 30,
  };
  return {
    backend: given.backend, software: given.software, maxTextureSize: given.maxTextureSize, secureContext: (scope as { isSecureContext?: boolean }).isSecureContext === true,
    decoders, encoders,
    audioDecoder: scope.AudioDecoder ? await supported(() => scope.AudioDecoder!.isConfigSupported({ codec: "mp4a.40.2", sampleRate: 48_000, numberOfChannels: 2 })) : false,
    audioEncoders, audioOutput: typeof (scope as { AudioContext?: unknown }).AudioContext !== "undefined",
    offscreenCanvas: typeof (scope as { OffscreenCanvas?: unknown }).OffscreenCanvas !== "undefined",
    fileSystemAccess: typeof (scope as { showSaveFilePicker?: unknown }).showSaveFilePicker === "function",
    memoryClass: given.memoryClass, surface: given.surface, constraints, engineVersion: ENGINE_VERSION, protocolVersion: ENGINE_PROTOCOL_VERSION,
  };
}

/** Pool budgets in bytes (video frames / GPU textures / images and stickers / text and graphics) per memory class. */
const MIB = 1024 * 1024;
export const POOL_BUDGETS: Record<EngineReady["memoryClass"], { video: number; textures: number; images: number; text: number; ceiling: number }> = {
  desktop: { video: 512 * MIB, textures: 768 * MIB, images: 256 * MIB, text: 128 * MIB, ceiling: 2048 * MIB },
  host: { video: 512 * MIB, textures: 768 * MIB, images: 256 * MIB, text: 128 * MIB, ceiling: 2048 * MIB },
  web: { video: 384 * MIB, textures: 512 * MIB, images: 192 * MIB, text: 128 * MIB, ceiling: 1536 * MIB },
  mobile: { video: 128 * MIB, textures: 192 * MIB, images: 64 * MIB, text: 32 * MIB, ceiling: 600 * MIB },
};
