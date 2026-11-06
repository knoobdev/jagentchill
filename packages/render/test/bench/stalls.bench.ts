// Where playback stalls come from: plays scene B1's three video layers and, for every slow frame, prints where its
// time went (scene build, each texture's decode, submission, GPU completion), next to the gaps of the app's thread
// and the time the audio scheduler spent mixing.
//
//   JC_GPU=1 node test/bench/stalls.bench.ts [--seconds 10]
import { join } from "node:path";
import { ffmpeg, hasFfmpeg, startHarness } from "../browser/harness.ts";

const secondsFlag = process.argv.indexOf("--seconds");
const seconds = secondsFlag > 0 ? Number(process.argv[secondsFlag + 1]) : 10;
if (!hasFfmpeg()) { console.error("ffmpeg is required"); process.exit(2); }
const harness = await startHarness();
try {
  for (const [name, source] of [["main", "testsrc2"], ["over1", "smptehdbars"], ["over2", "rgbtestsrc"]]) {
    ffmpeg(["-f", "lavfi", "-i", `${source}=s=1920x1080:r=30:d=${seconds + 2}`, "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${seconds + 2}`,
      "-c:v", "libx264", "-profile:v", "high", "-b:v", "8M", "-g", "60", "-bf", "0", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ac", "2", "-shortest", join(harness.media, `${name}.mp4`)]);
  }
  // `--without mask,blur,lut,text` leaves parts of the scene out, to see what each costs.
  const withoutFlag = process.argv.indexOf("--without");
  const without = withoutFlag > 0 ? process.argv[withoutFlag + 1].split(",") : [];
  const result = await harness.page.evaluate(async ({ origin, seconds, without }) => {
    const { jc } = window;
    const ticks = seconds * 120000;
    const sources = ["main", "over1", "over2"].map((name) => ({ assetId: name, original: `${origin}/media/${name}.mp4` }));
    const doc = jc.project({ width: 1920, height: 1080 });
    for (const source of sources) doc.media.assets.push(jc.asset(source.assetId, "video", { width: 1920, height: 1080, duration: ticks + 240000, hasAudio: true }));
    const video = (id: string, mediaId: string, fields: Record<string, unknown> = {}) => jc.element("video", { id, startTime: 0, duration: ticks, mediaId, sourceDuration: ticks + 240000, isSourceAudioEnabled: id === "m", ...fields });
    doc.scenes[0].tracks.main.elements.push(video("m", "main"));
    const lutId = "user:" + "e".repeat(64);
    const text = (id: string, y: number, fields: Record<string, unknown>) => jc.element("text", { id, startTime: 0, duration: ticks, content: "Benchmark scene B1", fontFamily: "Arial", color: "#ffffff", transform: { position: { x: 0, y }, scale: { x: 1, y: 1 }, rotation: 0 }, ...fields });
    doc.scenes[0].tracks.overlay = [
      jc.track("adjustment", "adj", [jc.element("adjustment", { id: "lut", startTime: 0, duration: ticks, adjustments: { lut: { enabled: true, lutId, intensity: 100 } } })]),
      jc.track("text", "t1", [text("ta", -380, { fontSize: 64 / 12, stroke: { enabled: true, color: "#000000", width: 6, position: "outside" } })]),
      jc.track("text", "t2", [text("tb", 380, { fontSize: 48 / 12, shadow: { enabled: true, color: "#000000", opacity: 80, blur: 10, distance: 5, angle: -45 } })]),
      jc.track("video", "o3", [video("b", "over1", { opacity: 0.8, blendMode: "screen", transform: { position: { x: 400, y: -150 }, scale: { x: 0.4, y: 0.4 }, rotation: 0 } })]),
      jc.track("video", "o4", [video("c", "over2", { transform: { position: { x: -300, y: 100 }, scale: { x: 0.6, y: 0.6 }, rotation: 0 }, effects: without.includes("blur") ? [] : [{ id: "fx", type: "blur", kind: "effect", enabled: true, params: { intensity: 40 } }], masks: without.includes("mask") ? [] : [{ id: "k", type: "ellipse", enabled: true, combine: "add", params: { width: 0.9, height: 0.9, feather: 20 } }] })]),
    ].filter((track: any) => !(without.includes("lut") && track.type === "adjustment") && !(without.includes("text") && track.type === "text"));
    const lines = ["LUT_3D_SIZE 33"];
    for (let b = 0; b < 33; b++) for (let g = 0; g < 33; g++) for (let r = 0; r < 33; r++) lines.push([Math.min(1, (r / 32) * 1.05), g / 32, (b / 32) * 0.92].map((value) => value.toFixed(6)).join(" "));
    const derived = [{ key: lutId, kind: "lut" as const, url: URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/plain" })), sha256: "e".repeat(64) }];
    const fonts = [{ fontId: "arimo", family: "Arimo", url: `${origin}/fixtures/fonts/Arimo-Regular.ttf` }];
    const opened = await jc.open(doc, { width: 1920, height: 1080 }, sources, async (port) => { await port.command("fonts.setSources", { fonts }); await port.command("derived.setSources", { entries: derived }); });
    const engine = opened.engine as any;
    await engine.whenFontsSettled();
    await opened.frameAt(0);
    await engine.whenLutsSettled();
    await opened.port.command("view.setQuality", { quality: "auto" });
    await opened.frameAt(0);
    // Every frame's spans, as the engine recorded them; the gaps between two timer ticks of this thread; the mixer's time.
    const frames: { at: number; ms: number; spans: any }[] = [];
    let uploads = engine.counters.textureUpload;
    opened.port.on("frame.ready", (payload) => { const now = engine.counters.textureUpload; frames.push({ at: performance.now(), ms: payload.renderMs, spans: { ...engine.lastFrameSpans, uploads: now - uploads, size: engine.renderSize?.width } }); uploads = now; });
    const gaps: { at: number; ms: number }[] = [];
    let last = performance.now(), watching = true;
    const watch = () => { const now = performance.now(); if (now - last > 40) gaps.push({ at: now, ms: now - last }); last = now; if (watching) setTimeout(watch, 4); };
    watch();
    const mixes: { at: number; ms: number }[] = [];
    const pump = engine.audio.pump.bind(engine.audio);
    engine.audio.pump = async (...args: unknown[]) => { const at = performance.now(); try { return await pump(...args); } finally { if (performance.now() - at > 8) mixes.push({ at, ms: performance.now() - at }); } };
    const dropped = engine.counters.droppedFrames, start = performance.now();
    await opened.port.command("transport.play", {});
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000 - 500));
    await opened.port.command("transport.pause", {});
    watching = false;
    const round = (value: number) => Math.round(value * 10) / 10;
    const slow = frames.filter((frame) => frame.ms > 45).map((frame) => ({ at: Math.round(frame.at - start), ms: round(frame.ms), build: round(frame.spans.build), sync: round(frame.spans.sync), render: round(frame.spans.render), drawn: round(frame.spans.drawn), uploads: frame.spans.uploads, width: frame.spans.size, textures: Object.fromEntries(Object.entries(frame.spans.textures).map(([id, ms]) => [id, round(ms as number)])) }));
    const sorted = frames.map((frame) => frame.ms).sort((a, b) => a - b);
    return { quality: opened.events.filter((event) => event.type === "transport.state").map((event) => event.payload.effectiveQuality), backend: opened.ready().backend, frames: frames.length, dropped: engine.counters.droppedFrames - dropped, p50: sorted[sorted.length >> 1], p95: sorted[Math.floor(sorted.length * 0.95)], slow, gaps: gaps.map((gap) => ({ at: Math.round(gap.at - start), ms: Math.round(gap.ms) })), mixes: mixes.map((mix) => ({ at: Math.round(mix.at - start), ms: Math.round(mix.ms) })) };
  }, { origin: harness.origin, seconds, without });
  console.log(`${without.length ? `without ${without.join(", ")} — ` : ""}${result.backend}: ${result.frames} frames, ${result.dropped} dropped (${((result.dropped / (result.frames + result.dropped)) * 100).toFixed(2)} %), render p50 ${result.p50.toFixed(1)} ms, p95 ${result.p95.toFixed(1)} ms`);
  console.log(`quality: ${JSON.stringify((result as any).quality)}`);
  console.log(`slow frames: ${JSON.stringify(result.slow)}`);
  console.log(`thread gaps over 40 ms: ${JSON.stringify(result.gaps)}`);
  console.log(`audio pumps over 8 ms: ${JSON.stringify(result.mixes)}`);
} finally {
  await harness.close();
}
