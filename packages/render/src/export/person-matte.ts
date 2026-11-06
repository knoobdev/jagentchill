import { BufferTarget, Mp4OutputFormat, Output, VideoSample, VideoSampleSource, WebMOutputFormat } from "mediabunny";
import { mediaTimeToSeconds } from "@jagentchill/editor-core";

/**
 * The producer side of the person matte of body effects (`render-engine.Body-effect matte inputs and frame
 * history`). The segmentation model, its job and its cache belong to `ai-editing-tools.Person matte for body
 * effects`; what the engine fixes is the artefact that job hands over and how it is delivered:
 *
 * - **Entry.** `derived.setSources` entry `{key: "<assetId>:person", kind: "person-matte", url, sha256}`
 *   (`personMatteEntry`). One entry per source asset: every clip of the asset and every body effect on it use it.
 * - **Still.** For an image asset, an image file (PNG) whose red channel is the matte: 255 the person, 0 the rest.
 * - **Video.** For a video asset, a video file whose luma is the matte, in the time base of the SOURCE: the frame
 *   shown at source time `t` is the matte of the source frame at `t`, because the engine decodes both in lock-step
 *   at the same source time. It covers the analysed source range; before the range the first matte frame holds.
 * - **Size.** Any size of the source's aspect (the model's own output, 256 × 256 for `seg-person`, is enough): the
 *   engine carries the matte through the layer's crop, flip and transform and upsamples it along the picture's
 *   edges (joint bilateral).
 *
 * `createPersonMatteWriter` writes the video form from per-frame coverage, so that a producer needs no muxer.
 */

export const PERSON_MATTE_KIND = "person-matte" as const;
/** The key of an asset's person matte in `derived.setSources`. */
export const personMatteKey = (assetId: string): string => `${assetId}:person`;
/** The key the engine accepted before the spec fixed it; still read. */
export const legacyPersonMatteKey = (assetId: string): string => `person-matte:${assetId}`;
export const personMatteEntry = (assetId: string, url: string, sha256: string): { key: string; kind: typeof PERSON_MATTE_KIND; url: string; sha256: string } => ({ key: personMatteKey(assetId), kind: PERSON_MATTE_KIND, url, sha256 });

export type PersonMatteWriter = {
  /** Adds the matte of the source frame at `sourceTime` (ticks): `coverage` holds `width × height` values, 255 the person. Times must not decrease. */
  add(coverage: Uint8Array, sourceTime: number): Promise<void>;
  /** The finished file and its MIME type. */
  finish(): Promise<{ data: Uint8Array; mimeType: string }>;
};

/**
 * Writes a matte track: `width × height` (even sides) at the source's frame rate, VP9 in WebM where the device
 * encodes it, H.264 in MP4 otherwise. The bitrate is set for a picture of two flat levels and a soft edge.
 */
export async function createPersonMatteWriter(options: { width: number; height: number; frameRate: { numerator: number; denominator: number } }): Promise<PersonMatteWriter> {
  const { width, height } = options;
  if (width < 2 || height < 2 || width % 2 !== 0 || height % 2 !== 0) throw new Error("a matte track has even sides of at least 2 px");
  const Encoder = (globalThis as { VideoEncoder?: typeof VideoEncoder }).VideoEncoder;
  const can = async (codec: string) => Encoder !== undefined && (await Encoder.isConfigSupported({ codec, width, height }).catch(() => ({ supported: false }))).supported === true;
  const webm = await can("vp09.00.10.08");
  if (!webm && !(await can("avc1.42001f"))) throw new Error("this device has no encoder for a matte track");
  const target = new BufferTarget();
  const output = new Output({ format: webm ? new WebMOutputFormat() : new Mp4OutputFormat({ fastStart: "in-memory" }), target });
  const frameSeconds = options.frameRate.denominator / options.frameRate.numerator;
  const source = new VideoSampleSource({ codec: webm ? "vp9" : "avc", bitrate: Math.max(150_000, Math.round(width * height * 3)), keyFrameInterval: 1 });
  output.addVideoTrack(source, { frameRate: 1 / frameSeconds });
  await output.start();
  const rgba = new Uint8Array(width * height * 4).fill(255);
  let first = true, last = -1;
  return {
    async add(coverage, sourceTime) {
      if (coverage.length !== width * height) throw new Error("coverage holds width × height values");
      if (sourceTime < last) throw new Error("matte frames are added in source order");
      last = sourceTime;
      for (let index = 0; index < coverage.length; index++) { const value = coverage[index]; rgba[index * 4] = value; rgba[index * 4 + 1] = value; rgba[index * 4 + 2] = value; }
      // The track starts at source time 0: a range that starts later holds its first frame from there.
      const seconds = first ? 0 : mediaTimeToSeconds(sourceTime);
      const duration = first ? mediaTimeToSeconds(sourceTime) + frameSeconds : frameSeconds;
      first = false;
      const sample = new VideoSample(rgba, { format: "RGBA", codedWidth: width, codedHeight: height, timestamp: seconds, duration, colorSpace: { primaries: "bt709", transfer: "iec61966-2-1", matrix: "rgb", fullRange: true } });
      try { await source.add(sample); } finally { sample.close(); }
    },
    async finish() {
      await output.finalize();
      return { data: new Uint8Array(target.buffer!), mimeType: webm ? "video/webm" : "video/mp4" };
    },
  };
}

/** The still form: a PNG whose red, green and blue are the coverage. */
export async function personMatteStill(coverage: Uint8Array, width: number, height: number): Promise<Blob> {
  if (coverage.length !== width * height) throw new Error("coverage holds width × height values");
  const canvas = new OffscreenCanvas(width, height), image = new ImageData(width, height);
  for (let index = 0; index < coverage.length; index++) image.data.set([coverage[index], coverage[index], coverage[index], 255], index * 4);
  canvas.getContext("2d")!.putImageData(image, 0, 0);
  return canvas.convertToBlob({ type: "image/png" });
}

type Scanned = { scenes: { tracks: { main: { elements: unknown[] }; overlay: { elements: unknown[] }[] } }[] };
/**
 * The asset ids whose person matte a document needs: every video or image element with an enabled effect that
 * `requires` it. `requiresMatte` is the effect registry's answer for an effect type.
 */
export function personMatteAssets(document: Scanned, requiresMatte: (effectType: string) => boolean): string[] {
  const ids = new Set<string>();
  for (const scene of document.scenes) {
    for (const track of [scene.tracks.main, ...scene.tracks.overlay]) {
      for (const element of track.elements as { type?: string; mediaId?: string; freeze?: { mediaId?: string }; effects?: { type: string; kind?: string; enabled?: boolean }[] }[]) {
        if ((element.type !== "video" && element.type !== "image") || !element.effects?.some((effect) => effect.enabled !== false && effect.kind !== "filter" && requiresMatte(effect.type))) continue;
        const assetId = element.type === "video" ? element.freeze?.mediaId ?? element.mediaId : element.mediaId;
        if (assetId) ids.add(assetId);
      }
    }
  }
  return [...ids];
}
