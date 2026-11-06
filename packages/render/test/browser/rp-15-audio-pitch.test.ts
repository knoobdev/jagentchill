// Live audio output in headless Chromium: "Keep pitch" and the pitch shift are heard on the master bus as the export mixes them (the wasm WSOLA stretch inside the live scheduler).
import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { ffmpeg, hasFfmpeg, startHarness, type Harness } from "./harness.ts";

let harness: Harness;
const skip = hasFfmpeg() ? false : "ffmpeg is not installed";
before(async () => {
  if (skip) return;
  harness = await startHarness();
  ffmpeg(["-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000:duration=12", "-af", "pan=stereo|c0=c0|c1=c0", "-c:a", "aac", "-b:a", "128k", "-ac", "2", join(harness.media, "tone12.m4a")]);
});
after(async () => { await harness?.close(); });

test("Pitch preservation — the setting applies identically in preview and export: live playback at 2× keeps 1 kHz with Keep pitch on and plays 2 kHz with it off; Audio pitch shift — +12 semitones is heard live; the export mix of the same document measures the same", { skip }, async () => {
  const result = await harness.page.evaluate(async (origin) => {
    const { jc } = window;
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const run = async (fields: Record<string, unknown>) => {
      const doc = jc.project({ width: 64, height: 64 });
      doc.media.assets.push(jc.asset("tone", "audio", { duration: 1440000, hasAudio: true }));
      doc.scenes[0].tracks.audio = [jc.track("audio", "a0", [jc.element("audio", { id: "e1", startTime: 0, duration: 600000, mediaId: "tone", sourceType: "upload", sourceDuration: 1440000, ...fields })])];
      const opened = await jc.open(doc, { width: 64, height: 64 }, [{ assetId: "tone", original: `${origin}/media/tone12.m4a` }]);
      await opened.port.command("transport.play", {});
      await sleep(900);
      const analyser = opened.engine.audioAnalyser!;
      const data = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(data);
      let peak = 0, crossings = 0;
      for (let index = 1; index < data.length; index++) { peak = Math.max(peak, Math.abs(data[index])); if (data[index - 1] < 0 && data[index] >= 0) crossings++; }
      await opened.port.command("transport.pause", {});
      // The export mix of the same clips, through the engine's own source reader.
      const engine = opened.engine as any;
      const mixed = await jc.mixdown({ clips: jc.collectMixClips(doc as never, "s1"), read: engine.audioReader().read, start: 60000, end: 180000 });
      let exported = 0;
      for (let index = 1; index < mixed[0].length; index++) if (mixed[0][index - 1] < 0 && mixed[0][index] >= 0) exported++;
      return { peak, hertz: (crossings * analyser.context.sampleRate) / data.length, exported: exported / (mixed[0].length / 48000), errors: opened.events.filter((event) => event.type === "engine.error").map((event) => event.payload.code) };
    };
    return { kept: await run({ retime: { rate: 2 }, maintainPitch: true }), followed: await run({ retime: { rate: 2 }, maintainPitch: false }), shifted: await run({ pitch: { semitones: 12, cents: 0 } }) };
  }, harness.origin);
  for (const [name, expected] of [["kept", 1000], ["followed", 2000], ["shifted", 2000]] as const) {
    const measured = result[name];
    assert.deepEqual(measured.errors, [], name);
    assert.ok(measured.peak > 0.08, `${name} is audible: ${measured.peak}`);
    assert.ok(Math.abs(measured.hertz / expected - 1) < 0.04, `${name} live: ${measured.hertz} Hz, expected ${expected}`);
    assert.ok(Math.abs(measured.exported / expected - 1) < 0.02, `${name} exported: ${measured.exported} Hz, expected ${expected}`);
  }
});
