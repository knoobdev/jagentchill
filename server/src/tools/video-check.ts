import { z } from "zod";
import { spawnSync } from "node:child_process";
import { applyPatch, timeline } from "@jagentchill/editor-core";
import { defineTool, fail, type ToolContext } from "./kit.ts";

type Box = { x: number; y: number; width: number; height: number };
type Finding = { kind: string; severity: "error" | "warning"; elementId?: string; clipId?: string; trackId?: string; times: number[]; box?: Box; message: string; imageIndex?: number; renderTime?: number };
const TICKS_PER_SECOND = 120_000;
const MAX_SAMPLES = 24;
const end = (item: { startTime: number; duration: number }) => item.startTime + item.duration;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const text = (e: timeline.El) => e.type === "text" ? String(e.content ?? "") : e.type === "caption" ? String(e.text ?? "") : "";

function samples(scene: timeline.Sc, duration: number): number[] {
  const points = new Set<number>([0, Math.max(0, duration - 1)]);
  for (let t = TICKS_PER_SECOND; t < duration; t += TICKS_PER_SECOND) points.add(t);
  for (const track of timeline.tracksOfScene(scene)) for (const item of track.elements) {
    if (item.startTime < duration) points.add(item.startTime);
    if (end(item) > 0 && end(item) <= duration) points.add(end(item) - 1);
  }
  for (const track of timeline.tracksOfScene(scene)) {
    const elements = new Map(track.elements.map((item) => [item.id, item]));
    for (const transition of track.transitions as Array<{ kind?: string; fromElementId?: string; toElementId?: string; duration?: number }>) {
      if (transition.kind !== "transition" || !transition.duration) continue;
      const from = elements.get(String(transition.fromElementId)), to = elements.get(String(transition.toElementId));
      if (!from || !to) continue;
      const center = to.startTime;
      for (const edge of [center - Math.ceil(transition.duration / 2), center + Math.floor(transition.duration / 2)]) if (edge >= 0 && edge < duration) points.add(edge);
    }
  }
  const sorted = [...points].filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length <= MAX_SAMPLES) return sorted;
  // Keep event boundaries first, then fill remaining slots evenly from the grid.
  const events = new Set<number>([0]);
  for (const track of timeline.tracksOfScene(scene)) for (const item of track.elements) {
    if (item.startTime < duration) events.add(item.startTime);
    if (end(item) > 0 && end(item) <= duration) events.add(end(item) - 1);
  }
  for (const track of timeline.tracksOfScene(scene)) {
    const elements = new Map(track.elements.map((item) => [item.id, item]));
    for (const transition of track.transitions as Array<{ kind?: string; fromElementId?: string; toElementId?: string; duration?: number }>) {
      if (transition.kind !== "transition" || !transition.duration) continue;
      const to = elements.get(String(transition.toElementId));
      if (!to) continue;
      const center = to.startTime;
      for (const edge of [center - Math.ceil(transition.duration / 2), center + Math.floor(transition.duration / 2)]) if (edge >= 0 && edge < duration) events.add(edge);
    }
  }
  const required = [...events].sort((a, b) => a - b).slice(0, MAX_SAMPLES);
  for (const at of sorted) if (required.length < MAX_SAMPLES && !events.has(at)) required.push(at);
  return [...new Set(required)].sort((a, b) => a - b);
}

function boxOf(item: timeline.El, canvas: { width: number; height: number }, track: timeline.Tr): Box {
  const transform = (item as any).transform ?? { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0 };
  let width = canvas.width, height = canvas.height;
  if (item.type === "text" || item.type === "caption") {
    const size = Number((item as any).fontSize ?? (track as any).caption?.style?.fontSize ?? 48);
    const content = text(item);
    const naturalWidth = Math.max(size, [...content].length * size * 0.62);
    const configured = (item as any).box as { mode?: string; width?: number } | undefined;
    const maxWidth = configured?.width ? canvas.width * configured.width / 100 : canvas.width;
    width = configured?.mode === "fixed" ? maxWidth : Math.min(naturalWidth, maxWidth);
    const lines = Math.max(1, Math.ceil(naturalWidth / Math.max(1, width)));
    height = lines * size * Number((item as any).lineHeight ?? 1.2);
  } else if (item.type === "graphic" || item.type === "sticker") {
    width = Number((item as any).intrinsicWidth ?? 256);
    height = Number((item as any).intrinsicHeight ?? 256);
  } else if (item.type === "image" || item.type === "video") {
    const asset = (item as any).mediaId;
    const meta = (item as any)._assetMeta as { width?: number; height?: number } | undefined;
    if (meta?.width && meta?.height) { width = meta.width; height = meta.height; }
    else { width = canvas.width; height = canvas.height; }
    void asset;
  }
  const sx = Math.abs(Number(transform.scale?.x ?? 1)), sy = Math.abs(Number(transform.scale?.y ?? 1));
  width *= sx; height *= sy;
  const radians = Number(transform.rotation ?? 0) * Math.PI / 180;
  const aabbW = Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians));
  const aabbH = Math.abs(height * Math.cos(radians)) + Math.abs(width * Math.sin(radians));
  return { x: canvas.width / 2 + Number(transform.position?.x ?? 0) - aabbW / 2, y: canvas.height / 2 + Number(transform.position?.y ?? 0) - aabbH / 2, width: aabbW, height: aabbH };
}
const intersects = (a: Box, b: Box) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const luminance = (hex: string) => {
  const rgb = hex.match(/[0-9a-f]{2}/gi)?.slice(0, 3).map((v) => parseInt(v, 16) / 255) ?? [1, 1, 1];
  const linear = rgb.map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
};

function inspect(ctx: ToolContext, document: ToolContext["doc"], scene: timeline.Sc, times: number[]): Finding[] {
  const canvas = document.settings.canvasSize, findings: Finding[] = [];
  const active = timeline.tracksOfScene(scene).flatMap((track) => track.elements.map((item) => ({ track, item })))
    .filter(({ item, track }) => !item.hidden && !track.hidden && item.duration > 0);
  const add = (finding: Finding) => findings.push(finding);
  // Main-track gaps are timeline geometry and can be found without decoding media.
  let at = 0;
  for (const item of [...scene.tracks.main.elements].sort((a, b) => a.startTime - b.startTime)) {
    if (item.startTime > at) add({ kind: "empty_gap", severity: "warning", clipId: item.id, trackId: scene.tracks.main.id, times: [at / TICKS_PER_SECOND], message: `Main track is empty for ${((item.startTime - at) / TICKS_PER_SECOND).toFixed(2)} s.` });
    at = Math.max(at, end(item));
  }
  for (const { item, track } of active) {
    const mediaId = (item as any).mediaId as string | undefined;
    if (mediaId && ctx.mediaAvailability(mediaId) === "unavailable") add({ kind: "missing_media", severity: "error", elementId: item.id, clipId: item.id, trackId: track.id, times: [item.startTime / TICKS_PER_SECOND], message: "This clip references media that is unavailable on the device." });
    const box = boxOf(item, canvas, track), x2 = box.x + box.width, y2 = box.y + box.height;
    if (box.x < 0 || box.y < 0 || x2 > canvas.width || y2 > canvas.height) add({ kind: "off_canvas", severity: "warning", elementId: item.id, clipId: item.id, trackId: track.id, times: times.filter((time) => time >= item.startTime && time < end(item)).map((time) => time / TICKS_PER_SECOND).slice(0, 6), box, message: "This visible element extends beyond the canvas edge." });
    const content = text(item);
    if (content && (box.width > canvas.width || box.height > canvas.height)) add({ kind: "text_overflow", severity: "error", elementId: item.id, clipId: item.id, trackId: track.id, times: times.filter((time) => time >= item.startTime && time < end(item)).map((time) => time / TICKS_PER_SECOND).slice(0, 6), box, message: "Text is wider or taller than its estimated text box." });
    if (item.type === "caption") {
      const ratio = canvas.width / canvas.height;
      // Portrait platforms reserve the bottom 30% for controls and top 8% for platform UI.
      const top = ratio < 0.75 ? canvas.height * 0.08 : canvas.height * 0.05;
      const bottom = ratio < 0.75 ? canvas.height * 0.70 : canvas.height * 0.90;
      if (box.y < top || box.y + box.height > bottom) add({ kind: "caption_safe_zone", severity: "warning", elementId: item.id, clipId: item.id, trackId: track.id, times: times.filter((time) => time >= item.startTime && time < end(item)).map((time) => time / TICKS_PER_SECOND).slice(0, 6), box, message: "Caption is outside the defined platform safe zone." });
    }
  }
  // Text coverage and contrast checks are static estimates; time intersections bound the report to visible frames.
  const ordered = [...active].reverse();
  for (const { item, track } of ordered) {
    if (!text(item)) continue;
    const box = boxOf(item, canvas, track), liveTimes = times.filter((time) => time >= item.startTime && time < end(item));
    const covering = active.find(({ item: above, track: upper }) => upper.id !== track.id && above.startTime <= item.startTime && end(above) >= end(item) && boxOf(above, canvas, upper).width > 0 && intersects(box, boxOf(above, canvas, upper)));
    if (covering && liveTimes.length) add({ kind: "covered", severity: "warning", elementId: item.id, clipId: item.id, trackId: track.id, times: liveTimes.slice(0, 6).map((time) => time / TICKS_PER_SECOND), box, message: `Text overlaps higher track element ${covering.item.id}.` });
    const color = String((item as any).color ?? (track as any).caption?.style?.color ?? "#ffffff");
    const background = String((item as any).background?.color ?? "#000000");
    const a = luminance(color), b = luminance(background), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const threshold = Number((item as any).fontSize ?? 0) >= 24 ? 3 : 4.5;
    if (ratio < threshold && liveTimes.length) add({ kind: "low_contrast", severity: "warning", elementId: item.id, clipId: item.id, trackId: track.id, times: liveTimes.slice(0, 6).map((time) => time / TICKS_PER_SECOND), box, message: `Estimated text contrast is ${ratio.toFixed(2)}:1; WCAG AA requires ${threshold}:1.` });
  }
  return findings;
}

type RenderedFrame = { time: number; mime: string; dataBase64: string; width: number; height: number };
function cropPng(frame: RenderedFrame, box: Box, canvas: { width: number; height: number }): string | undefined {
  const ffmpeg = process.env.JAGENTCHILL_FFMPEG || "ffmpeg";
  const input = Buffer.from(frame.dataBase64, "base64");
  const sx = frame.width / canvas.width, sy = frame.height / canvas.height;
  const left = clamp(Math.floor(box.x * sx), 0, frame.width - 1), top = clamp(Math.floor(box.y * sy), 0, frame.height - 1);
  const right = clamp(Math.ceil((box.x + box.width) * sx), left + 1, frame.width), bottom = clamp(Math.ceil((box.y + box.height) * sy), top + 1, frame.height);
  const result = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-vf", `crop=${right - left}:${bottom - top}:${left}:${top}:exact=1`, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"], { input, maxBuffer: 8 * 1024 * 1024, timeout: 4000 });
  return result.status === 0 && result.stdout.length > 0 ? result.stdout.toString("base64") : undefined;
}
function renderedBackground(frame: RenderedFrame, box: Box, canvas: { width: number; height: number }): [number, number, number] | undefined {
  const sx = frame.width / canvas.width, sy = frame.height / canvas.height;
  const left = clamp(Math.floor(box.x * sx), 0, frame.width - 1), top = clamp(Math.floor(box.y * sy), 0, frame.height - 1);
  const right = clamp(Math.ceil((box.x + box.width) * sx), left + 1, frame.width), bottom = clamp(Math.ceil((box.y + box.height) * sy), top + 1, frame.height);
  const result = spawnSync(process.env.JAGENTCHILL_FFMPEG || "ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-vf", `crop=${right - left}:${bottom - top}:${left}:${top}:exact=1`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { input: Buffer.from(frame.dataBase64, "base64"), maxBuffer: 16 * 1024 * 1024, timeout: 4000 });
  if (result.status !== 0 || result.stdout.length !== (right - left) * (bottom - top) * 3) return undefined;
  // JPEG edges may differ by a few levels, so group rendered pixels into 16-level bins before choosing the
  // dominant background. This uses the composited frame, rather than the project's background-color field.
  const counts = new Map<number, number>();
  for (let i = 0; i < result.stdout.length; i += 3) {
    const key = (result.stdout[i]! >> 4) << 8 | (result.stdout[i + 1]! >> 4) << 4 | result.stdout[i + 2]! >> 4;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let dominant = 0, count = -1;
  for (const [key, n] of counts) if (n > count) { dominant = key; count = n; }
  return [((dominant >> 8) & 15) * 16 + 8, ((dominant >> 4) & 15) * 16 + 8, (dominant & 15) * 16 + 8];
}
function luminanceRgb(rgb: [number, number, number]): number {
  const linear = rgb.map((v) => { const n = v / 255; return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

export const VIDEO_CHECK_TOOLS = [defineTool({
  name: "jc_video_check", family: "frame", readOnly: true, needsProject: true, kind: "read",
  description: "Inspect a scene or time range before handing back a video. Samples a 1 s grid and clip edges (up to 24 points), checks layout, captions, gaps and media, measures text contrast from rendered pixels when available, and returns JSON findings with times, canvas pixel boxes and cropped PNGs.",
  shape: { sceneId: z.string().min(1).max(64).optional(), range: z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).strict().optional() },
  async handle(ctx, args) {
    const proposal = ctx.host.proposalPatches(ctx.session);
    const document = proposal ? applyPatch(ctx.doc, proposal.patches as never) : ctx.doc;
    const scene = (document.scenes.find((entry) => entry.id === (args.sceneId ?? ctx.activeSceneId())) as unknown as timeline.Sc | undefined)
      ?? fail("SCENE_NOT_FOUND", `No scene has the id "${args.sceneId}".`, { sceneId: args.sceneId });
    // Scene duration follows the main track. Overlays can extend past it (or be the only content), so include every
    // track when sampling; otherwise the common title-only project was incorrectly reported as clean at time zero.
    const duration = Math.max(timeline.sceneDurationOf(scene), ...timeline.tracksOfScene(scene).flatMap((track) => track.elements.map(end)), 0);
    if (args.range && args.range.end <= args.range.start) fail("INVALID_PARAMS", "range.end must be later than range.start.", { field: "range" });
    const times = samples(scene, duration).filter((time) => !args.range || (time >= args.range.start && time < args.range.end));
    const budget = ctx.host.frameBudget(ctx.session, times.length);
    const findings = inspect(ctx, document, scene, times);
    const rendered: RenderedFrame[] = [];
    let renderUnavailable = false;
    // Keep each request on the same four-frame path used by jc_frame_render. The frame renderer is the source of
    // truth for crops; if no editor device/render host is available, the geometry-only findings remain explicit.
    for (let offset = 0; offset < times.length; offset += 4) {
      const batch = times.slice(offset, offset + 4);
      const result = await ctx.host.renderFrames(ctx.session, ctx.projectId, {
        sceneId: scene.id, times: batch, width: 768, overlays: [], layout: "separate", baseRevision: ctx.revision,
      });
      if (!result) { renderUnavailable = true; break; }
      rendered.push(...result.frames.map((frame) => ({ time: frame.time, mime: frame.mime, dataBase64: frame.dataBase64, width: frame.width, height: frame.height })));
    }
    if (rendered.length > 0) {
      for (const track of timeline.tracksOfScene(scene)) for (const item of track.elements) {
        if (!text(item) || item.hidden || track.hidden) continue;
        const liveTimes = times.filter((time) => time >= item.startTime && time < end(item));
        if (!liveTimes.length) continue;
        const box = boxOf(item, document.settings.canvasSize, track), at = liveTimes[0]!;
        const frame = rendered.reduce((best, candidate) => Math.abs(candidate.time - at) < Math.abs(best.time - at) ? candidate : best, rendered[0]!);
        const foreground = String((item as any).color ?? (track as any).caption?.style?.color ?? "#ffffff").match(/[0-9a-f]{2}/gi)?.slice(0, 3).map((v) => parseInt(v, 16)) as [number, number, number] | undefined;
        const background = renderedBackground(frame, box, document.settings.canvasSize);
        if (!foreground || !background) continue;
        const a = luminanceRgb(foreground), b = luminanceRgb(background), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        const threshold = Number((item as any).fontSize ?? 0) >= 24 ? 3 : 4.5;
        const prior = findings.findIndex((finding) => finding.kind === "low_contrast" && finding.elementId === item.id);
        if (ratio < threshold) {
          const measured: Finding = { kind: "low_contrast", severity: "warning", elementId: item.id, clipId: item.id, trackId: track.id, times: liveTimes.slice(0, 6).map((time) => time / TICKS_PER_SECOND), box, message: `Rendered-pixel text contrast is ${ratio.toFixed(2)}:1; WCAG AA requires ${threshold}:1.` };
          if (prior >= 0) findings[prior] = measured; else findings.push(measured);
        } else if (prior >= 0) findings.splice(prior, 1);
      }
    }
    const images: { mime: string; dataBase64: string }[] = [];
    const attached = new Set<string>();
    for (const finding of findings) {
      if (!finding.box) continue;
      const key = `${finding.kind}|${finding.elementId ?? finding.clipId ?? "scene"}`;
      if (attached.has(key)) continue;
      const at = (finding.times[0] ?? 0) * TICKS_PER_SECOND;
      const frame = rendered.reduce<RenderedFrame | undefined>((best, candidate) => !best || Math.abs(candidate.time - at) < Math.abs(best.time - at) ? candidate : best, undefined);
      const crop = frame && cropPng(frame, finding.box, document.settings.canvasSize);
      if (crop) { finding.imageIndex = images.length; finding.renderTime = frame!.time / TICKS_PER_SECOND; images.push({ mime: "image/png", dataBase64: crop }); attached.add(key); }
    }
    const limitations = [
      ...(renderUnavailable ? ["frame renderer was unavailable; visual checks used project geometry"] : []),
      ...(proposal ? ["rendered crops show the synced revision; geometry includes this session's open proposal"] : []),
      ...(rendered.length ? ["rendered-pixel contrast is sampled from each text box; clipping and layer coverage still use project geometry"] : ["contrast and layer coverage use project geometry because no rendered pixels were available"]),
      "audio clipping peaks require decoded audio samples, which the tool interface does not expose",
    ];
    return { data: { sceneId: scene.id, sampledTimes: times.map((time) => time / TICKS_PER_SECOND), sampleCount: times.length, budget, findings, limitations }, images };
  },
})];
