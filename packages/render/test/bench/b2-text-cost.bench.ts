// Cost at 1920 × 1080 of the text and sticker paths that rasterise per frame. `JC_GPU=1 node test/bench/b2-text-cost.bench.ts`
import { startHarness } from "../browser/harness.ts";

const harness = await startHarness();
try {
  const result = await harness.page.evaluate(async (origin) => {
    const { jc } = window;
    const fonts = [{ fontId: "arimo-400", family: "Arimo", url: `${origin}/fixtures/fonts/Arimo-Regular.ttf`, weight: 400 }, { fontId: "emoji", family: "Noto Color Emoji", url: `${origin}/assets/fonts/NotoColorEmoji-Regular.ttf`, weight: 400 }];
    const SECOND = 120000;
    const run = async (name: string, overlay: unknown[]) => {
      const doc = jc.project({ width: 1920, height: 1080 });
      doc.scenes[0].tracks.overlay = overlay as never;
      const opened = await jc.open(doc, { width: 1920, height: 1080 }, [], (port) => port.command("fonts.setSources", { fonts }));
      await opened.engine.whenFontsSettled();
      await opened.frameAt(0);
      const times: number[] = [];
      for (let frame = 1; frame <= 40; frame++) times.push((await opened.frameAt(frame * 4000)).frame.renderMs);
      await opened.port.command("engine.dispose", {});
      times.sort((a, b) => a - b);
      return { name, backend: opened.ready().backend, software: opened.ready().software, mean: times.reduce((sum, value) => sum + value, 0) / times.length, p95: times[Math.floor(times.length * 0.95)] };
    };
    const text = (fields: Record<string, unknown>) => [jc.track("text", "t0", [jc.element("text", { id: "t", startTime: 0, duration: 4 * SECOND, content: "The quick brown fox jumps\nover the lazy dog", fontFamily: "Arial", fontSize: 12, stroke: { enabled: true, color: "#000000", width: 6, position: "outside" }, shadow: { enabled: true, color: "#000000", opacity: 80, blur: 10, distance: 5, angle: -45 }, ...fields })])];
    const stroke = (index: number) => ({ id: `s${index}`, points: Array.from({ length: 40 }, (_, at) => [-800 + at * 40, Math.sin(at / 3 + index) * 300]), width: 12, color: "#ffffff", brush: index % 2 ? "marker" : "pen" });
    return [
      await run("static text (cached)", text({})),
      await run("text, block animation (loop-pulse)", text({ textAnimation: { loop: { id: "loop-pulse", period: SECOND, strength: 100 } } })),
      await run("text, character animation (loop-wave, rasterised per frame)", text({ textAnimation: { loop: { id: "loop-wave", period: SECOND, strength: 100 } } })),
      await run("text, curve 180 + character animation", text({ curve: 180, textAnimation: { loop: { id: "loop-jitter", period: SECOND, strength: 100 } } })),
      await run("text, in-blur (block, GPU blur)", text({ textAnimation: { in: { id: "in-blur", duration: 4 * SECOND, strength: 100 } } })),
      await run("emoji text 😀×8", text({ content: "😀😀😀😀😀😀😀😀" })),
      await run("drawing, 20 strokes of 40 points (cached)", [jc.track("graphic", "g0", [jc.element("graphic", { id: "d", startTime: 0, duration: 4 * SECOND, definitionId: "drawing", params: { colorOverride: "" }, intrinsicWidth: 1700, intrinsicHeight: 700, strokes: Array.from({ length: 20 }, (_, index) => stroke(index)) })])]),
    ];
  }, harness.origin);
  for (const row of result) console.log(`${row.name}: mean ${row.mean.toFixed(2)} ms, p95 ${row.p95.toFixed(2)} ms (${row.backend}${row.software ? ", software" : ""})`);
} finally {
  await harness.close();
}
