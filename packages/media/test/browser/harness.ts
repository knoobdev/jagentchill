import { inlineMediaEngine, workerMediaEngine, type MediaEngine } from "/media/src/browser/index.ts";
import { probeImageBytes } from "/media/src/image-probe.ts";
import { selectProxyProducer } from "/media/src/proxy.ts";

/** Page side of the browser tests: loads a generated fixture and runs the real engine on it, inline or in the worker. */
const inline = inlineMediaEngine();
const worker = workerMediaEngine(new Worker("/media/src/browser/worker.ts", { type: "module" }));
const engineOf = (where: "inline" | "worker"): MediaEngine => (where === "worker" ? worker : inline);
const load = async (name: string, mimeType = ""): Promise<File> => new File([await (await fetch(`/fixtures/${name}`)).arrayBuffer()], name, { type: mimeType });

/** Decodes an encoded picture and reports its size and a few pixels. */
async function inspect(bytes: Uint8Array, mimeType: string, points: [number, number][] = []) {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mimeType }));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext("2d")!;
  context.drawImage(bitmap, 0, 0);
  return { width: bitmap.width, height: bitmap.height, pixels: points.map(([x, y]) => [...context.getImageData(Math.floor(x * (bitmap.width - 1)), Math.floor(y * (bitmap.height - 1)), 1, 1).data]) };
}
const api = {
  async probe(name: string, mimeType: string, where: "inline" | "worker") {
    const file = await load(name, mimeType);
    try { return { ok: true, ...(await engineOf(where).probe(file, name, mimeType)) }; }
    catch (error) { return { ok: false, name: (error as Error).name, message: (error as Error).message }; }
  },
  async hash(name: string, where: "inline" | "worker") {
    return engineOf(where).hash(await load(name));
  },
  async thumbnail(name: string, mimeType: string, where: "inline" | "worker", points: [number, number][] = []) {
    const file = await load(name, mimeType), probed = await engineOf(where).probe(file, name, mimeType);
    const thumbnail = await engineOf(where).thumbnail(file, probed!.probe);
    if (!thumbnail) return null;
    const signature = [...thumbnail.bytes.slice(0, 4)];
    return { mimeType: thumbnail.mimeType, width: thumbnail.width, height: thumbnail.height, bytes: thumbnail.bytes.length, signature, decoded: await inspect(thumbnail.bytes, thumbnail.mimeType, points) };
  },
  /** The decoded frame at an exact time, as the thumbnail would show it, for comparing against the thumbnail. */
  async frameAt(name: string, seconds: number, points: [number, number][]) {
    const [frame] = await inline.filmstrip(await load(name), [Math.round(seconds * 120_000)]);
    return inspect(frame.bytes!, "image/jpeg", points);
  },
  async filmstrip(name: string, times: number[], where: "inline" | "worker") {
    const frames = await engineOf(where).filmstrip(await load(name), times);
    return Promise.all(frames.map(async (frame) => ({ time: frame.time, width: frame.width, height: frame.height, decoded: frame.bytes ? await inspect(frame.bytes, "image/jpeg") : null })));
  },
  async waveform(name: string, where: "inline" | "worker") {
    const progress: number[] = [];
    let longest = 0;
    // Long tasks on this thread while the worker computes: the UI thread must stay free.
    const observer = new PerformanceObserver((list) => { for (const entry of list.getEntries()) longest = Math.max(longest, entry.duration); });
    observer.observe({ entryTypes: ["longtask"] });
    const summary = await engineOf(where).waveform(await load(name), (fraction) => progress.push(fraction));
    await new Promise((resolve) => setTimeout(resolve, 50));
    observer.disconnect();
    const base = summary.levels[0].pairs;
    let min = 0, max = 0;
    for (let i = 0; i < base.length; i += 2) { min = Math.min(min, base[i]); max = Math.max(max, base[i + 1]); }
    return { sampleRate: summary.sampleRate, totalSamples: summary.totalSamples, levels: summary.levels.map((level) => ({ factor: level.factor, pairs: level.pairs.length / 2 })), min, max, progress, longestMainThreadTask: longest };
  },
  async decodeTest(name: string) {
    const file = await load(name), probed = await inline.probe(file, name);
    return inline.decodeTest(file, probed!.probe);
  },
  encoderSupport: () => inline.encoderSupport(),
  async proxy(name: string, where: "inline" | "worker") {
    const file = await load(name), probed = (await inline.probe(file, name))!.probe, encoders = await inline.encoderSupport();
    const producer = selectProxyProducer({ encoders, sourceDecodes: probed.canDecode === true, hostConnected: false });
    if (producer.producer !== "device") return { producer };
    const progress: number[] = [];
    const proxy = await engineOf(where).proxy(file, { width: probed.width!, height: probed.height!, fps: probed.fps!, hasAudio: probed.hasAudio }, producer.form, (fraction) => progress.push(fraction));
    const reprobed = await inline.probe(new File([proxy.bytes], `proxy.${proxy.form}`), `proxy.${proxy.form}`);
    return { producer, form: proxy.form, size: proxy.size, sha256: proxy.sha256, width: proxy.width, height: proxy.height, progress: progress.length, reprobed: reprobed!.probe };
  },
  async svg(name: string) {
    (window as unknown as { __svgScriptRan?: boolean }).__svgScriptRan = false;
    const file = await load(name, ""), probed = await worker.probe(file, name, "");
    const thumbnail = await worker.thumbnail(file, probed!.probe);
    await new Promise((resolve) => setTimeout(resolve, 200));
    return { detected: probed!.detected, probe: probed!.probe, thumbnail: thumbnail && { mimeType: thumbnail.mimeType, width: thumbnail.width, height: thumbnail.height, decoded: await inspect(thumbnail.bytes, thumbnail.mimeType, [[0.5, 0.5]]) }, scriptRan: (window as unknown as { __svgScriptRan?: boolean }).__svgScriptRan };
  },
  async headerMatchesDecoder(name: string) {
    const file = await load(name), header = probeImageBytes(new Uint8Array(await file.arrayBuffer())), bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { header, decoded: { width: bitmap.width, height: bitmap.height } };
  },
  capabilities: () => ({ videoDecoder: typeof VideoDecoder === "function", videoEncoder: typeof VideoEncoder === "function", imageDecoder: typeof (globalThis as { ImageDecoder?: unknown }).ImageDecoder === "function", userAgent: navigator.userAgent }),
};
(window as unknown as { media: typeof api }).media = api;
(window as unknown as { mediaReady: boolean }).mediaReady = true;
