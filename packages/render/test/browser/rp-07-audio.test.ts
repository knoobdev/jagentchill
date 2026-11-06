// Live audio output in headless Chromium: the transport follows the AudioContext clock and the mix is audible on the master bus.
import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { ffmpeg, hasFfmpeg, startHarness, type Harness } from "./harness.ts";

let harness: Harness;
const skip = hasFfmpeg() ? false : "ffmpeg is not installed";
before(async () => {
  if (skip) return;
  harness = await startHarness();
  // The mono source is copied to both channels at its own level: ffmpeg's default up-mix lowers it by 3 dB on some builds.
  ffmpeg(["-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000:duration=6", "-af", "pan=stereo|c0=c0|c1=c0", "-c:a", "aac", "-b:a", "128k", "-ac", "2", join(harness.media, "tone.m4a")]);
});
after(async () => { await harness?.close(); });

test("Audio clock as playback master — the playhead follows the AudioContext clock and the timeline mix is audible; Audio scheduler lookahead — Back-pressure on a long clip; Edit during playback; Playback rate, loop and reverse shuttle — Reverse shuttle is silent; Scrub audio", { skip }, async () => {
  const result = await harness.page.evaluate(async (origin) => {
    const { jc } = window;
    const doc = jc.project({ width: 64, height: 64 });
    doc.media.assets.push(jc.asset("tone", "audio", { duration: 720000, hasAudio: true }));
    // The tone starts at 0.5 s of the timeline.
    doc.scenes[0].tracks.audio = [jc.track("audio", "a0", [jc.element("audio", { id: "e1", startTime: 60000, duration: 600000, mediaId: "tone", sourceType: "upload", sourceDuration: 720000 })])];
    const opened = await jc.open(doc, { width: 64, height: 64 }, [{ assetId: "tone", original: `${origin}/media/tone.m4a` }]);
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    /** Peak and dominant frequency on the master bus right now. */
    const listen = () => {
      const analyser = opened.engine.audioAnalyser;
      if (!analyser) return { peak: 0, hertz: 0 };
      const data = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(data);
      let peak = 0, crossings = 0;
      for (let index = 1; index < data.length; index++) { peak = Math.max(peak, Math.abs(data[index])); if (data[index - 1] < 0 && data[index] >= 0) crossings++; }
      return { peak, hertz: (crossings * analyser.context.sampleRate) / data.length };
    };
    const mark = opened.events.length;
    await opened.port.command("transport.play", {});
    const wallStart = performance.now();
    await sleep(250);
    const early = listen();           // before 0.5 s of the timeline: silence
    const earlyPosition = opened.events.filter((event) => event.type === "transport.time").at(-1)?.payload;
    await sleep(900);
    const during = listen();          // inside the tone
    const ahead = opened.engine.audioScheduledAhead;
    const times = opened.events.slice(mark).filter((event) => event.type === "transport.time" && event.payload.playing).map((event) => event.payload);
    const wall = performance.now() - wallStart;
    // An edit during playback: the clip is turned down by 20 dB.
    await opened.port.command("scene.patch", { baseRevision: 1, revision: 2, patches: [{ op: "replace", path: "/scenes/@s1/tracks/audio/@a0/elements/@e1/volume", value: -20 }] });
    await sleep(400);
    const quieter = listen();
    // Reverse shuttle: the playhead moves backwards and nothing is audible.
    await opened.port.command("transport.setRate", { rate: -2 });
    await sleep(400);
    const reverse = listen();
    const reverseTimes = opened.events.filter((event) => event.type === "transport.time" && event.payload.playing).slice(-5).map((event) => event.payload);
    await opened.port.command("transport.pause", {});
    await opened.port.command("transport.setRate", { rate: 1 });
    const state = opened.events.filter((event) => event.type === "transport.state").map((event) => event.payload);
    // Scrubbing across the tone for one second.
    const before = opened.engine.snippets, scrubStart = performance.now();
    for (let step = 0; step < 40; step++) { await opened.port.command("transport.seek", { time: 120000 + step * 4000, mode: "scrub" }); await sleep(25); }
    const scrubMs = performance.now() - scrubStart;
    await sleep(200);
    const scrubbed = opened.engine.snippets - before;
    const playingAfterScrub = opened.events.filter((event) => event.type === "transport.state").at(-1)!.payload.playing;
    await opened.port.command("transport.setScrubAudio", { enabled: false });
    const off = opened.engine.snippets;
    for (let step = 0; step < 10; step++) { await opened.port.command("transport.seek", { time: 200000 + step * 4000, mode: "scrub" }); await sleep(25); }
    const silentScrub = opened.engine.snippets - off;
    await opened.port.command("transport.setScrubAudio", { enabled: true });
    const stepBefore = opened.engine.snippets;
    await opened.port.command("transport.seek", { time: 244000, mode: "exact", frameStep: true });
    await opened.port.command("transport.seek", { time: 248000, mode: "exact" });
    await sleep(100);
    return { early, earlyPosition, during, ahead, times, wall, quieter, reverse, reverseTimes, state, scrubbed, playingAfterScrub, silentScrub, scrubMs, steps: opened.engine.snippets - stepBefore };
  }, harness.origin);
  console.log(`live audio: peak ${result.during.peak.toFixed(3)} at ${Math.round(result.during.hertz)} Hz on the master bus; ${result.ahead.toFixed(2)} s scheduled ahead; ${result.times.length} time events in ${Math.round(result.wall)} ms`);
  assert.ok(result.times.length > 20 && result.times.every((event) => event.audioClock === true), "transport.time comes from the audio clock");
  assert.ok(result.state.some((entry) => entry.playing && entry.audioOutput === true));
  // The position advances at one second of timeline per second of wall time.
  const last = result.times.at(-1)!.time / 120000, expected = result.wall / 1000;
  assert.ok(Math.abs(last - expected) < 0.2, `position ${last.toFixed(2)} s after ${expected.toFixed(2)} s`);
  assert.ok(result.early.peak < 0.01, `silent before the clip starts (peak ${result.early.peak} at ${result.earlyPosition?.time})`);
  // ffmpeg's sine source has an amplitude of 1/8.
  assert.ok(result.during.peak > 0.09 && result.during.peak < 0.16, `the tone is audible at its own level (peak ${result.during.peak})`);
  assert.ok(Math.abs(result.during.hertz - 1000) < 60, `a 1 kHz tone (${result.during.hertz} Hz)`);
  assert.ok(result.ahead > 0.5 && result.ahead <= 2.3, `no more than the look-ahead is scheduled (${result.ahead} s)`);
  assert.ok(result.quieter.peak < result.during.peak * 0.2 && result.quieter.peak > result.during.peak * 0.05, `the new gain is audible: ${result.quieter.peak} after ${result.during.peak}`);
  assert.ok(result.reverse.peak < 0.01, `no audio in reverse (${result.reverse.peak})`);
  assert.ok(result.reverseTimes.length >= 2 && result.reverseTimes.at(-1)!.time < result.reverseTimes[0].time, "the playhead moves backwards");
  // At most one snippet every 50 ms, however fast the seeks arrive.
  assert.ok(result.scrubbed >= 10 && result.scrubbed <= Math.ceil(result.scrubMs / 50) + 1, `${result.scrubbed} snippets in ${Math.round(result.scrubMs)} ms of scrubbing`);
  assert.equal(result.playingAfterScrub, false, "scrub snippets do not start the transport");
  assert.equal(result.silentScrub, 0, "scrubbing is silent when scrub audio is off");
  assert.equal(result.steps, 1, "a frame step plays exactly one snippet; an exact seek plays none");
  assert.deepEqual(harness.errors, []);
});
