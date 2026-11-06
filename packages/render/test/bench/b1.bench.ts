// The engine benchmark harness: builds benchmark scene B1 (catalog.md) from synthetic 1080p30 H.264 fixtures, runs
// it in headless Chromium and measures every engine budget. It prints what it measured, writes the numbers to
// `test/bench/results/b1.json`, and exits non-zero naming each exceeded budget.
//
//   node test/bench/b1.bench.ts [--seconds 10]
//
// Deviations from catalog.md, stated in the output: both texts are set in the test font (no Tinos fixture), the
// media is generated here with ffmpeg, and playback is measured over `--seconds` (default 10) instead of 60.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ffmpeg, hasFfmpeg, startHarness } from "../browser/harness.ts";

const BUDGETS = { previewP95Ms: 33.3, droppedPercent: 2, singleLayerP95Ms: 16.6, seekNearP95Ms: 250, seekRandomP95Ms: 500, scrubP95Ms: 100, patchMs: 50, exportSpeed: 1.0 };
const secondsFlag = process.argv.indexOf("--seconds");
const seconds = secondsFlag > 0 ? Number(process.argv[secondsFlag + 1]) : 10;

if (!hasFfmpeg()) { console.error("ffmpeg is required to generate the B1 fixtures"); process.exit(2); }
const harness = await startHarness();
try {
  for (const [name, source] of [["main", "testsrc2"], ["over1", "smptehdbars"], ["over2", "rgbtestsrc"]]) {
    ffmpeg(["-f", "lavfi", "-i", `${source}=s=1920x1080:r=30:d=${seconds + 2}`, "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${seconds + 2}`,
      "-c:v", "libx264", "-profile:v", "high", "-b:v", "8M", "-g", "60", "-bf", "0", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ac", "2", "-shortest", join(harness.media, `${name}.mp4`)]);
  }
  const result = await harness.page.evaluate(async ({ origin, seconds }) => {
    const { jc } = window;
    const ticks = seconds * 120000;
    const lutId = "user:" + "e".repeat(64);
    const sources = ["main", "over1", "over2"].map((name) => ({ assetId: name, original: `${origin}/media/${name}.mp4` }));
    const scene = (single: boolean) => {
      const doc = jc.project({ width: 1920, height: 1080 });
      for (const source of sources) doc.media.assets.push(jc.asset(source.assetId, "video", { width: 1920, height: 1080, duration: ticks + 240000, hasAudio: true }));
      const video = (id: string, mediaId: string, fields: Record<string, unknown> = {}) => jc.element("video", { id, startTime: 0, duration: ticks, mediaId, sourceDuration: ticks + 240000, isSourceAudioEnabled: id === "m", ...fields });
      doc.scenes[0].tracks.main.elements.push(video("m", "main"));
      if (single) return doc;
      const text = (id: string, y: number, fields: Record<string, unknown>) => jc.element("text", { id, startTime: 0, duration: ticks, content: "Benchmark scene B1", fontFamily: "Arial", color: "#ffffff", transform: { position: { x: 0, y }, scale: { x: 1, y: 1 }, rotation: 0 }, ...fields });
      doc.scenes[0].tracks.overlay = [
        // overlay[0], topmost: an adjustment element spanning the scene with a 33-point LUT at intensity 100.
        jc.track("adjustment", "adj", [jc.element("adjustment", { id: "lut", startTime: 0, duration: ticks, adjustments: { lut: { enabled: true, lutId, intensity: 100 } } })]),
        jc.track("text", "t1", [text("ta", -380, { fontSize: 64 / 12, stroke: { enabled: true, color: "#000000", width: 6, position: "outside" } })]),
        jc.track("text", "t2", [text("tb", 380, { fontSize: 48 / 12, shadow: { enabled: true, color: "#000000", opacity: 80, blur: 10, distance: 5, angle: -45 } })]),
        jc.track("video", "o3", [video("b", "over1", { opacity: 0.8, blendMode: "screen", transform: { position: { x: 400, y: -150 }, scale: { x: 0.4, y: 0.4 }, rotation: 0 } })]),
        jc.track("video", "o4", [video("c", "over2", { transform: { position: { x: -300, y: 100 }, scale: { x: 0.6, y: 0.6 }, rotation: 0 }, effects: [{ id: "fx", type: "blur", kind: "effect", enabled: true, params: { intensity: 40 } }], masks: [{ id: "k", type: "ellipse", enabled: true, combine: "add", params: { width: 0.9, height: 0.9, feather: 40 } }] })]),
      ];
      return doc;
    };
    // A 33-point table with a mild warm grade.
    const lines = ["LUT_3D_SIZE 33"];
    for (let b = 0; b < 33; b++) for (let g = 0; g < 33; g++) for (let r = 0; r < 33; r++) lines.push([Math.min(1, (r / 32) * 1.05), g / 32, (b / 32) * 0.92].map((value) => value.toFixed(6)).join(" "));
    const derived = [{ key: lutId, kind: "lut" as const, url: URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/plain" })), sha256: "e".repeat(64) }];
    const fonts = [{ fontId: "arimo", family: "Arimo", url: `${origin}/fixtures/fonts/Arimo-Regular.ttf` }];
    const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * 0.95) - 1)] ?? 0;
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const play = async (single: boolean, quality: "auto" | "full") => {
      const opened = await jc.open(scene(single), { width: 1920, height: 1080 }, sources, async (port) => { await port.command("fonts.setSources", { fonts }); await port.command("derived.setSources", { entries: derived }); });
      await opened.engine.whenFontsSettled();
      await opened.frameAt(0);
      await opened.engine.whenLutsSettled();
      await opened.port.command("view.setQuality", { quality });
      await opened.frameAt(0);
      const mark = opened.events.length, droppedBefore = opened.engine.counters.droppedFrames;
      await opened.port.command("transport.play", {});
      await sleep(seconds * 1000 - 500);
      await opened.port.command("transport.pause", {});
      const events = opened.events.slice(mark);
      const frames = events.filter((event) => event.type === "frame.ready" && !event.payload.exact).map((event) => event.payload.renderMs);
      const quality_ = events.filter((event) => event.type === "transport.state").map((event) => event.payload.effectiveQuality).at(-2);
      // Dropped frames are the frames the transport clock passed without presenting them, as the engine counts them.
      const dropped = opened.engine.counters.droppedFrames - droppedBefore;
      const times = events.filter((event) => event.type === "transport.time" && event.payload.playing).map((event) => event.payload.time);
      const span = times.length > 1 ? (times[times.length - 1] - times[0]) / 4000 + 1 : frames.length;
      // Where the clock skipped frames, and how slow the slowest frames were: the evidence for the dropped-frame budget.
      const gaps = times.flatMap((time, index) => (index > 0 && time - times[index - 1] > 4000 ? [{ at: Math.round(time / 4000), skipped: (time - times[index - 1]) / 4000 - 1 }] : []));
      const slowest = [...frames].sort((a, b) => b - a).slice(0, 8).map((value) => Math.round(value));
      return { opened, gaps, slowest, p95: p95(frames), frames: frames.length, dropped, clockFrames: span, droppedPercent: (Math.max(dropped, span - frames.length, 0) / Math.max(1, span)) * 100, quality: quality_, audioClock: events.some((event) => event.type === "transport.time" && event.payload.audioClock) };
    };
    const single = await play(true, "full");
    await single.opened.port.command("engine.dispose", {});
    const b1 = await play(false, "auto");
    const opened = b1.opened;
    const seek = async (time: number, mode: "exact" | "scrub") => {
      const mark = opened.events.length, started = performance.now();
      await opened.port.command("transport.seek", { time, mode });
      await opened.waitFor("frame.ready", mark, 60_000);
      return performance.now() - started;
    };
    const frameTicks = 4000, lastFrame = Math.floor(ticks / frameTicks) - 1;
    const near: number[] = [], random: number[] = [], scrub: number[] = [];
    let at = 30;
    for (let index = 0; index < 12; index++) { at = Math.min(lastFrame, at + 7 + (index % 5) * 9); near.push(await seek(at * frameTicks, "exact")); }
    let seed = 12345;
    const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return Math.floor((seed / 4294967296) * lastFrame); };
    for (let index = 0; index < 12; index++) random.push(await seek(next() * frameTicks, "exact"));
    for (let index = 0; index < 12; index++) scrub.push(await seek(next() * frameTicks, "scrub"));
    // Scene patch to frame, paused on an exactly decoded frame (the scrub seeks above left nearby frames on screen).
    await seek(45 * frameTicks, "exact");
    await sleep(300);
    // Scene patch to frame, paused.
    const patches: number[] = [];
    // Where the time of each patch frame went, as the engine recorded it.
    const patchSpans: Record<string, unknown>[] = [];
    for (let index = 0; index < 5; index++) {
      const mark = opened.events.length, started = performance.now();
      await opened.port.command("scene.patch", { baseRevision: 1 + index, revision: 2 + index, patches: [{ op: "replace", path: "/scenes/@s1/tracks/overlay/@o3/elements/@b/opacity", value: 0.5 + index * 0.05 }] });
      await opened.waitFor("frame.ready", mark, 60_000);
      patches.push(performance.now() - started);
      const spans = (opened.engine as any).lastFrameSpans;
      patchSpans.push({ build: Math.round(spans.build), sync: Math.round(spans.sync), render: Math.round(spans.render), drawn: Math.round(spans.drawn), textures: Object.fromEntries(Object.entries(spans.textures).map(([id, ms]) => [id.slice(0, 24), Math.round(ms as number)])) });
    }
    // On-device 1080p30 H.264 export of the first three seconds of the scene.
    let bytes = 0;
    opened.port.on("export.chunk", (payload) => { bytes = Math.max(bytes, (payload.position ?? 0) + payload.bytes); });
    const exportSeconds = Math.min(3, seconds);
    const mark = opened.events.length, started = performance.now();
    await opened.port.command("export.start", { exportId: "b1", width: 1920, height: 1080, frameRate: { numerator: 30, denominator: 1 }, container: "mp4", range: { start: 0, end: exportSeconds * 120000 }, video: { codec: "avc", bitrate: 8_000_000 }, audio: { codec: "aac", sampleRate: 48000, channels: 2 } });
    const done = await Promise.race([opened.waitFor("export.done", mark, 600_000), opened.waitFor("export.failed", mark, 600_000).then((failure) => { throw new Error(JSON.stringify(failure)); })]);
    const exportMs = performance.now() - started;
    const ready = opened.ready();
    return {
      backend: ready.backend, software: ready.software, seconds,
      singleLayer: { p95: single.p95, frames: single.frames, droppedPercent: single.droppedPercent },
      preview: { p95: b1.p95, frames: b1.frames, droppedPercent: b1.droppedPercent, countedDropped: b1.dropped, quality: b1.quality, audioClock: b1.audioClock, gaps: b1.gaps, slowest: b1.slowest },
      patchSamples: patches.map((value) => Math.round(value)), patchSpans,
      seekNearP95: p95(near), seekRandomP95: p95(random), scrubP95: p95(scrub), patchP95: p95(patches),
      export: { frames: done.frameCount, bytes, ms: exportMs, speed: (exportSeconds * 1000) / exportMs },
    };
  }, { origin: harness.origin, seconds });

  const rows: [string, number, string, boolean][] = [
    ["B1 preview p95 frame render (ms, auto quality)", result.preview.p95, `≤ ${BUDGETS.previewP95Ms}`, result.preview.p95 <= BUDGETS.previewP95Ms],
    ["B1 dropped frames (%)", result.preview.droppedPercent, `≤ ${BUDGETS.droppedPercent}`, result.preview.droppedPercent <= BUDGETS.droppedPercent],
    ["single 1080p layer p95 (ms, full quality)", result.singleLayer.p95, `≤ ${BUDGETS.singleLayerP95Ms}`, result.singleLayer.p95 <= BUDGETS.singleLayerP95Ms],
    ["exact seek within 2 s, p95 (ms)", result.seekNearP95, `≤ ${BUDGETS.seekNearP95Ms}`, result.seekNearP95 <= BUDGETS.seekNearP95Ms],
    ["exact random seek, p95 (ms)", result.seekRandomP95, `≤ ${BUDGETS.seekRandomP95Ms}`, result.seekRandomP95 <= BUDGETS.seekRandomP95Ms],
    ["scrub first frame, p95 (ms)", result.scrubP95, `≤ ${BUDGETS.scrubP95Ms}`, result.scrubP95 <= BUDGETS.scrubP95Ms],
    ["scene patch to frame, p95 (ms)", result.patchP95, `≤ ${BUDGETS.patchMs}`, result.patchP95 <= BUDGETS.patchMs],
    ["1080p30 H.264 export (× real time)", result.export.speed, `≥ ${BUDGETS.exportSpeed}`, result.export.speed >= BUDGETS.exportSpeed],
  ];
  console.log(`B1 on ${result.backend}${result.software ? " (software rasteriser)" : ""}, ${result.seconds} s of playback (catalogue: 60 s); texts use the test font`);
  console.log(`preview: ${result.preview.frames} frames presented, quality ended at ${result.preview.quality}, audio clock ${result.preview.audioClock}; single layer: ${result.singleLayer.frames} frames; export: ${result.export.frames} frames, ${result.export.bytes} bytes in ${Math.round(result.export.ms)} ms`);
  console.log(`dropped at frames ${JSON.stringify(result.preview.gaps)}; slowest frames (ms) ${JSON.stringify(result.preview.slowest)}; patch samples (ms) ${JSON.stringify(result.patchSamples)}`);
  console.log(`patch frame spans (ms): ${JSON.stringify(result.patchSpans.slice(0, 2))}`);
  for (const [name, value, budget, pass] of rows) console.log(`${pass ? "pass" : "FAIL"}  ${name}: ${value.toFixed(2)} (budget ${budget})`);
  mkdirSync(join(import.meta.dirname, "results"), { recursive: true });
  writeFileSync(join(import.meta.dirname, "results/b1.json"), `${JSON.stringify({ measured: result, budgets: BUDGETS, exceeded: rows.filter((row) => !row[3]).map((row) => row[0]) }, null, 2)}\n`);
  const exceeded = rows.filter((row) => !row[3]);
  if (exceeded.length > 0) { console.error(`exceeded budgets: ${exceeded.map((row) => row[0]).join("; ")}`); process.exitCode = 1; }
} finally {
  await harness.close();
}
