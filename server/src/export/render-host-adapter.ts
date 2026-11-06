import type { RemoteCapabilities } from "../../../packages/app-core/src/export/remote.ts";
import { outputFrameRate, outputSize, rateValue, videoBitrateMbps, type ExportSettings } from "../../../packages/app-core/src/export/settings.ts";
import type { RenderHostManager } from "../render-host/manager.ts";
import type { BlobStore } from "../sync/blobs.ts";
import type { RemoteExportRenderer } from "./service.ts";

/** Bridges the durable device export queue to the same Electron engine used for still rendering. */
export function createRenderHostRemoteExportRenderer(input: { renderHost: RenderHostManager; blobs: () => BlobStore }): RemoteExportRenderer {
  const { renderHost } = input;
  return {
    kind: "render-host",
    available: () => renderHost.canStart(),
    capabilities: async () => {
      const state = await renderHost.probe();
      if (state.state !== "ready" || !state.hello) throw new Error("RENDERER_UNAVAILABLE: render host capabilities are not known");
      return renderHost.remoteCapabilities(state.hello) as RemoteCapabilities;
    },
    async start(job: { jobId: string; projectId: string; revision: number; document: Record<string, any>; settings: Record<string, any>; request: Record<string, any>; outputPath: string; progress(value: { stage: string; framesDone: number; frameCount: number; encodedBytes: number }): void }) {
      const document = job.document, settings = job.settings as ExportSettings;
      if (settings.type !== "video" || settings.container !== "mp4") throw new Error("The render host remote exporter currently supports MP4 video exports.");
      const resolution = outputSize(settings, document.settings.canvasSize), frameRate = outputFrameRate(settings, document.settings.fps);
      const codec = ({ h264: "avc", hevc: "hevc", vp9: "vp9", av1: "av1" } as Record<string, string>)[settings.videoCodec];
      if (!codec) throw new Error(`Unsupported remote video codec: ${settings.videoCodec}`);
      if (settings.includeAudio && settings.audioCodec === "pcm") throw new Error("PCM audio is not supported in an MP4 remote export.");
      const mediaSources = (document.media?.assets ?? []).flatMap((asset: any) => {
        if (!asset.contentHash) return [];
        const blob = input.blobs().locate(asset.contentHash);
        return [{ assetId: asset.id, original: `jagentchill-media://blob/${encodeURIComponent(asset.id)}?path=${encodeURIComponent(blob.path)}&mime=${encodeURIComponent(blob.mime)}` }];
      });
      await renderHost.exportStart({
        exportId: job.jobId, document, revision: job.revision, sceneId: job.request.sceneId, mediaSources, outputPath: job.outputPath,
        request: {
          width: resolution.width, height: resolution.height, frameRate, container: "mp4",
          video: { codec, bitrate: Math.round(videoBitrateMbps(settings, resolution, rateValue(frameRate)) * 1_000_000), ...(settings.hardwareAcceleration === "auto" ? {} : { hardwareAcceleration: settings.hardwareAcceleration === "prefer-hardware" ? "prefer-hardware" : "prefer-software" }) },
          ...(settings.includeAudio ? { audio: { codec: settings.audioCodec, sampleRate: settings.sampleRate, channels: settings.channels, bitrate: settings.audioBitrateKbps * 1000 } } : {}),
          ...(job.request.range ? { range: { start: job.request.range.start, end: job.request.range.end } } : {}), includeCaptions: settings.burnCaptions, allowFontFallback: true,
        },
        progress: (value) => job.progress({ stage: value.stage, framesDone: value.framesDone, frameCount: value.frameCount, encodedBytes: value.bytesDone ?? 0 }),
      });
    },
    cancel: (jobId) => renderHost.exportCancel(jobId),
  };
}
