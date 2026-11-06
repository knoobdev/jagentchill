// The web side of the mobile surface and of the render host: bridge sizing, the playhead clock, the sink stream,
// the stdio framing. The native view module and the Electron host process are not part of this package; their
// peers are stood in for by the receiver classes below, which implement the same wire rules.
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEngineCommand, parseEngineEvent, RENDER_HOST_COMMANDS } from "@jagentchill/protocol";
import {
  BridgeLatencyMonitor, bufferedDigest, EngineDispatcher, EngineFailure, EngineSurfacePort, EnvelopeReader, encodedBytes, enginePath, fitBridgeCommand, FramePipe,
  frameEnvelope, fromBase64, isEngineNavigation, missingCapabilities, audioEncodeConstraint, parseRecordHeader, PlayheadExtrapolator, rawMixBytes, recordHeader,
  RestartBudget, SinkReceiver, SinkSender, singleRange, SINK_BASE64_RAW_BYTES, videoFrameBytes, POOL_BUDGETS,
} from "../src/index.ts";

const fps30 = { numerator: 30, denominator: 1 };

test("Mobile WebView surface bridge — Oversized snapshot goes by reference; Oversized patch falls back to a snapshot; Unmapped path; Range request for media; Foreign navigation is blocked", () => {
  const stored: unknown[] = [];
  const context = { engineOrigin: "https://engine.jagentchill.localhost", storeSnapshot: (document: unknown) => { stored.push(document); return `snap${stored.length}`; }, currentDocument: () => ({ document: { scenes: [], big: "y".repeat(10) }, activeSceneId: "s1" }) };
  const small = { v: 1 as const, id: "a1", type: "transport.seek", payload: { time: 0, mode: "exact" } };
  assert.equal(fitBridgeCommand(small, context), small);
  const document = { scenes: [{ id: "s1" }], filler: "x".repeat(400_000) };
  const set = { v: 1 as const, id: "a2", type: "scene.set", payload: { revision: 7, activeSceneId: "s1", document } };
  assert.ok(encodedBytes(set) > 262_144);
  const byReference = fitBridgeCommand(set, context);
  assert.deepEqual(byReference.payload, { revision: 7, activeSceneId: "s1", snapshotUrl: "https://engine.jagentchill.localhost/snapshot/snap1" });
  assert.equal(stored[0], document);
  assert.ok(encodedBytes(byReference) <= 262_144);
  assert.equal(parseEngineCommand(byReference).ok, true, "the engine accepts scene.set by reference");
  const patch = { v: 1 as const, id: "a3", type: "scene.patch", payload: { baseRevision: 7, revision: 8, patches: [{ op: "add", path: "/x", value: "z".repeat(300_000) }] } };
  const replaced = fitBridgeCommand(patch, context);
  assert.equal(replaced.type, "scene.set");
  assert.equal(replaced.payload.snapshotUrl, "https://engine.jagentchill.localhost/snapshot/snap2");
  // Paths of the local origin, single-range requests and navigation.
  assert.equal(enginePath.media("a1", "proxy"), "/media/a1/proxy");
  assert.equal(enginePath.derived("ab".repeat(32)), `/derived/${"ab".repeat(32)}`);
  assert.deepEqual(singleRange("bytes=1048576-2097151", 10_000_000), { status: 206, start: 1_048_576, end: 2_097_151, length: 1_048_576, contentRange: "bytes 1048576-2097151/10000000" });
  assert.equal(singleRange("bytes=0-1,5-9", 100), null, "one range only");
  assert.equal(singleRange("bytes=200-", 100), null);
  assert.equal(isEngineNavigation("https://example.com", "android"), false);
  assert.equal(isEngineNavigation("https://engine.jagentchill.localhost/index.html", "android"), true);
  assert.equal(isEngineNavigation("jagentchill-engine://app/index.html", "ios"), true);
  assert.equal(isEngineNavigation("https://engine.jagentchill.localhost.evil.example/", "android"), false);
});

test("Mobile WebView surface bridge — Insecure context; Engine capability probe — Runtime without WebCodecs; Runtime without audio WebCodecs; Capability constraints — Audio encode fallback order", () => {
  const full = { WebAssembly: {}, VideoDecoder: {}, AudioDecoder: {}, isSecureContext: true, Worker: {} } as never;
  assert.deepEqual(missingCapabilities(full), []);
  assert.deepEqual(missingCapabilities({ ...(full as object), isSecureContext: false } as never), ["secure-context"]);
  assert.deepEqual(missingCapabilities({ ...(full as object), VideoDecoder: undefined } as never), ["video-decoder"]);
  assert.deepEqual(missingCapabilities({ ...(full as object), AudioDecoder: undefined } as never), ["audio-decoder"]);
  assert.deepEqual(missingCapabilities({} as never), ["wasm", "video-decoder", "audio-decoder", "secure-context", "worker"]);
  assert.equal(parseEngineEvent({ v: 1, id: "e1", type: "engine.error", payload: { code: "engine/unsupported-runtime", message: "x", fatal: true, missing: ["secure-context"] } }).ok, true);
  assert.equal(audioEncodeConstraint({ aac: true, opus: true, flac: false }), "aac");
  assert.equal(audioEncodeConstraint({ aac: false, opus: true, flac: false }), "opus");
  assert.equal(audioEncodeConstraint({ aac: false, opus: false, flac: false }), "pcm-mov");
  assert.equal(audioEncodeConstraint({ aac: false, opus: false, flac: false }, false), "gateway-only");
  // The pools of each memory class fit under its ceiling; the mobile pools total 416 MiB.
  const mib = 1024 * 1024;
  assert.equal((POOL_BUDGETS.mobile.video + POOL_BUDGETS.mobile.textures + POOL_BUDGETS.mobile.images + POOL_BUDGETS.mobile.text) / mib, 416);
  assert.deepEqual([POOL_BUDGETS.desktop.ceiling / mib, POOL_BUDGETS.web.ceiling / mib, POOL_BUDGETS.mobile.ceiling / mib, POOL_BUDGETS.host.ceiling / mib], [2048, 1536, 600, 2048]);
});

test("Engine error codes — Unlisted code is rejected in tests", () => {
  const bad = parseEngineEvent({ v: 1, id: "e1", type: "engine.error", payload: { code: "engine/unknown-thing", message: "x", fatal: false } });
  assert.equal(bad.ok, false);
  assert.match(!bad.ok ? bad.message : "", /code/);
  assert.equal(parseEngineEvent({ v: 1, id: "e2", type: "diagnostic", payload: { id: "scene/not-a-thing", severity: "caution", message: "x" } }).ok, false);
  assert.equal(parseEngineEvent({ v: 1, id: "e3", type: "diagnostic", payload: { id: "shader/unsupported", severity: "caution", message: "x" } }).ok, true);
});

test("Transport clock across the mobile bridge — Smooth timeline at 60 Hz from 30 events per second; Correction never steps backwards; Bridge stalls", () => {
  const clock = new PlayheadExtrapolator(fps30);
  // Events every 33.3 ms of a 30 fps project; the display refreshes every 16.7 ms.
  const engineAt = (ms: number) => Math.floor((ms * 120) / 4000) * 4000;
  let within = 0, frames = 0, previous = -1, advancedWhenIndexAdvanced = 0, indexAdvanced = 0;
  for (let display = 0; display < 600; display++) {
    // Display frames fall between the frame boundaries of the project, as on a real device.
    const now = display * (1000 / 60) + 5;
    // The last event that has arrived, 4 ms late.
    const eventAt = Math.floor((now - 4) / (1000 / 30)) * (1000 / 30);
    if (eventAt >= 0) clock.receive({ time: engineAt(eventAt), rate: 1, playing: true, hostMono_ms: eventAt }, eventAt + 4);
    const shown = clock.at(now);
    assert.ok(shown >= previous, "never backwards during forward playback");
    if (engineAt(now) !== engineAt(now - 1000 / 60)) { indexAdvanced++; if (shown !== previous) advancedWhenIndexAdvanced++; }
    if (Math.abs(shown - engineAt(now)) <= 4000) within++;
    frames++;
    previous = shown;
  }
  assert.ok(within / frames >= 0.95, `${within} of ${frames} display frames within one frame duration`);
  assert.ok(advancedWhenIndexAdvanced / indexAdvanced >= 0.95, "the playhead changes on the display frames in which the frame index advanced");
  // A correction 20 ms behind the extrapolated playhead holds the position until the extrapolation passes it.
  const held = new PlayheadExtrapolator(fps30);
  held.receive({ time: 0, rate: 1, playing: true, hostMono_ms: 0 }, 0);
  assert.equal(held.at(200), 24_000);
  held.receive({ time: 21_600, rate: 1, playing: true, hostMono_ms: 200 }, 200);
  assert.equal(held.at(200), 24_000, "held");
  assert.equal(held.at(216), 24_000, "still held");
  assert.equal(held.at(240), 24_000);
  assert.equal(held.at(270), 28_000, "the extrapolation from the new event has passed it");
  // No event for 500 ms: the playhead stops, and resumes from the next event.
  const stalled = new PlayheadExtrapolator(fps30);
  stalled.receive({ time: 0, rate: 1, playing: true, hostMono_ms: 0 }, 0);
  assert.equal(stalled.at(499), 56_000);
  const frozen = stalled.at(700);
  assert.equal(stalled.at(5000), frozen, "the playhead no longer advances");
  assert.equal(stalled.advancing(700), false);
  stalled.receive({ time: 600_000, rate: 1, playing: true, hostMono_ms: 5000 }, 5000);
  assert.equal(stalled.at(5010), 600_000);
  // An event with playing false stops the extrapolation at its time.
  stalled.receive({ time: 604_000, rate: 1, playing: false, hostMono_ms: 5100 }, 5100);
  assert.equal(stalled.at(9000), 604_000);
});

test("Deferred capability probes — Slow bridge lowers the event rate; Mobile engine restart budget — Restart loop", () => {
  const monitor = new BridgeLatencyMonitor();
  let change;
  for (let index = 0; index < 1000; index++) change = monitor.record(index % 10 === 0 ? 11 : 3) ?? change;
  assert.equal(change, 15, "a rolling 95th percentile of 11 ms lowers the rate");
  change = undefined;
  for (let index = 0; index < 1999; index++) change = monitor.record(4) ?? change;
  assert.equal(monitor.rate, 30, "back to 30 after a further 1 000 messages at or below 6 ms");
  const budget = new RestartBudget();
  assert.deepEqual([budget.record(0), budget.record(20_000), budget.record(59_000)], ["restart", "restart", "loop"]);
  const spaced = new RestartBudget();
  assert.deepEqual([spaced.record(0), spaced.record(40_000), spaced.record(70_000), spaced.record(101_000)], ["restart", "restart", "restart", "restart"]);
});

test("Mobile binary return path — Back-pressure; Stream integrity; Out-of-order chunk; Base64 fallback; Idle stream in the foreground", async () => {
  const file = new Uint8Array(10 * 1024 * 1024 + 123).map((_, index) => (index * 31 + (index >> 8)) & 0xff);
  const slices = function* () { for (let offset = 0; offset < file.length; offset += 4 * 1024 * 1024) yield file.subarray(offset, offset + 4 * 1024 * 1024); };
  // The native side appends, then acknowledges late.
  const run = async (binary: boolean, refuseAt = -1) => {
    const destination: number[] = [];
    let discarded = false, closed: { totalBytes: number; sha256: string } | undefined;
    const receiver = new SinkReceiver({ append: (bytes) => { for (const byte of bytes) destination.push(byte); }, discard: () => { discarded = true; }, now_ms: 0 });
    const sizes: number[] = [];
    let binaryCalls = 0;
    const deliver = (seq: number, bytes: Uint8Array) => { sizes.push(bytes.length); const ack = receiver.chunk(seq, bytes, 0); setTimeout(() => sender.ack(ack.seq), 3); };
    const sender: SinkSender = new SinkSender("st1", {
      ...(binary ? { binary: async (_stream, seq, bytes) => { if (binaryCalls++ === refuseAt) return false; deliver(seq, bytes.slice()); return true; } } : {}),
      base64: (_stream, seq, base64) => { assert.ok(base64.length <= 262_144); deliver(seq, fromBase64(base64)); },
      closed: (_stream, totalBytes, sha256) => { closed = { totalBytes, sha256 }; },
    });
    const result = await sender.sendAll(slices(), bufferedDigest());
    receiver.close(closed!.totalBytes, closed!.sha256);
    return { destination, discarded, result, sizes, maxInFlight: sender.maxInFlight, receiver };
  };
  const port = await run(true);
  assert.deepEqual(port.sizes, [4 * 1024 * 1024, 4 * 1024 * 1024, 2 * 1024 * 1024 + 123], "chunks of at most 4 MiB numbered from 0");
  assert.ok(port.maxInFlight <= 2, `never more than 2 unacknowledged chunks (${port.maxInFlight})`);
  assert.equal(port.result.totalBytes, file.length);
  assert.equal(Buffer.compare(Buffer.from(port.destination), Buffer.from(file)), 0, "the byte count and hash computed by the receiving side equal those of sink.closed");
  // Without the platform feature every chunk is a sink.chunk event of at most 262 144 encoded bytes.
  const base64 = await run(false);
  assert.ok(base64.sizes.every((size) => size <= SINK_BASE64_RAW_BYTES) && base64.sizes.length > 40);
  assert.ok(base64.maxInFlight <= 2);
  assert.equal(Buffer.compare(Buffer.from(base64.destination), Buffer.from(file)), 0);
  // A refused chunk switches the stream to base64 and the stream still closes with a verified hash.
  const refused = await run(true, 1);
  assert.equal(refused.sizes[0], 4 * 1024 * 1024);
  assert.ok(refused.sizes.slice(1).every((size) => size <= SINK_BASE64_RAW_BYTES));
  assert.equal(Buffer.compare(Buffer.from(refused.destination), Buffer.from(file)), 0);
  // Out of order: chunk 5 after chunk 3.
  let deleted = false;
  const strict = new SinkReceiver({ append: () => undefined, discard: () => { deleted = true; }, now_ms: 0 });
  for (const seq of [0, 1, 2, 3]) strict.chunk(seq, new Uint8Array(4), 0);
  assert.throws(() => strict.chunk(5, new Uint8Array(4), 0), (error: unknown) => error instanceof EngineFailure && error.code === "engine/sink-sequence");
  assert.equal(deleted, true, "the partial destination file is deleted");
  // A mismatching close fails the copy.
  let dropped = false;
  const mismatch = new SinkReceiver({ append: () => undefined, discard: () => { dropped = true; }, now_ms: 0 });
  mismatch.chunk(0, new Uint8Array([1, 2, 3]), 0);
  assert.throws(() => mismatch.close(3, "00".repeat(32)), (error: unknown) => error instanceof EngineFailure && error.code === "export/write-failed");
  assert.equal(dropped, true);
  // Idle for 30 s in the foreground; the timer is suspended in the background.
  let timedOut = false;
  const idle = new SinkReceiver({ append: () => undefined, discard: () => { timedOut = true; }, now_ms: 0 });
  idle.tick(25_000, true);
  idle.tick(100_000, false);
  idle.tick(120_000, true);
  assert.equal(timedOut, false, "the time in the background does not count");
  assert.throws(() => idle.tick(130_001, true), (error: unknown) => error instanceof EngineFailure && error.code === "engine/sink-timeout");
  assert.equal(timedOut, true);
});

test("Render host protocol — Frame record; Transport command on the host; Back-pressure from the encoder; Six-hour mix; Export render session — Pause is refused on the render host", async () => {
  const header = recordHeader("videoFrame", 7, videoFrameBytes(1920, 1080));
  assert.equal(header.length, 16);
  assert.deepEqual([...header.subarray(0, 8)], [0x4a, 0x43, 0x46, 0x31, 1, 0, 0, 0]);
  assert.deepEqual(parseRecordHeader(header), { kind: "videoFrame", sequence: 7, payloadLength: 8_294_400 });
  assert.equal(rawMixBytes(6 * 3600, 48_000, 2), 8_294_400_000);
  // Length-prefixed envelopes survive arbitrary chunking of the pipe.
  const hello = { v: 1, id: "h1", type: "hello", payload: { engineVersion: "0.1.0", protocolVersion: 1, backend: "webgl2", software: true } };
  const bytes = new Uint8Array([...frameEnvelope(hello), ...frameEnvelope({ v: 1, id: "c1", type: "engine.init", payload: {} })]);
  assert.deepEqual([...frameEnvelope(hello).subarray(0, 4)], [0, 0, 0, JSON.stringify(hello).length]);
  const reader = new EnvelopeReader();
  const seen = [...reader.push(bytes.subarray(0, 9)), ...reader.push(bytes.subarray(9, 60)), ...reader.push(bytes.subarray(60))];
  assert.deepEqual(seen.map((message) => (message as { type: string }).type), ["hello", "engine.init"]);
  assert.throws(() => frameEnvelope({ big: "x".repeat(1_048_577) }), RangeError);
  // The render host accepts a reduced command set.
  const replies: any[] = [];
  const dispatcher = new EngineDispatcher({ renderHost: true, validate: true, post: (message) => replies.push(message), handlers: { "transport.play": () => undefined, "export.pause": () => undefined, "memory.trim": () => "trimmed" } });
  await dispatcher.receive({ v: 1, id: "a1", type: "transport.play", payload: {} });
  await dispatcher.receive({ v: 1, id: "a2", type: "export.pause", payload: { exportId: "x" } });
  await dispatcher.receive({ v: 1, id: "a3", type: "memory.trim", payload: {} });
  assert.deepEqual(replies.map((reply) => reply.error?.code ?? reply.payload), ["surface/unsupported-on-host", "surface/unsupported-on-host", "trimmed"]);
  dispatcher.emit("transport.time", { time: 0, rate: 1, playing: false, audioClock: false });
  assert.equal(replies.length, 3, "the render host emits no transport events");
  assert.ok(!RENDER_HOST_COMMANDS.includes("transport.seek") && RENDER_HOST_COMMANDS.includes("export.cancel"));
  // A pipe that stops draining holds at most four frames.
  const release: (() => void)[] = [];
  const pipe = new FramePipe(() => new Promise<void>((resolve) => release.push(resolve)));
  let written = 0;
  const writing = (async () => { for (let frame = 0; frame < 10; frame++) { await pipe.write("videoFrame", new Uint8Array(16)); written++; } })();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(written, 4, "the fifth frame waits for the pipe");
  while (written < 10) { release.shift()?.(); await new Promise((resolve) => setTimeout(resolve, 1)); }
  await writing;
  assert.equal(pipe.maxQueued, 4);
});

test("Same-thread surface — schema validation can be switched off for production and the command set stays checked", async () => {
  const wire: any[] = [];
  const dispatcher: EngineDispatcher = new EngineDispatcher({ validate: false, handlers: { "transport.seek": (payload) => payload }, post: (message) => { wire.push(message); port.receive(message); } });
  const port: EngineSurfacePort = new EngineSurfacePort({ validate: false, send: (message) => { void dispatcher.receive(message); } });
  assert.deepEqual(await port.command("transport.seek", { time: 5, mode: "exact" }), { time: 5, mode: "exact" });
  await assert.rejects(port.raw({ v: 1, id: "q1", type: "nope", payload: {} }), (error: unknown) => error instanceof EngineFailure && error.code === "surface/unknown-command");
  await assert.rejects(port.raw({ v: 3, id: "q2", type: "transport.seek", payload: {} }), (error: unknown) => error instanceof EngineFailure && error.code === "surface/unsupported-version");
});
