import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ENGINE_CODE_PREFIXES, ENGINE_COMMAND_TYPES, ENGINE_DIAGNOSTIC_IDS, ENGINE_ERROR_CODES, ENGINE_EVENT_TYPES, parseEngineCommand, parseEngineEvent,
} from "@jagentchill/protocol";
import { EngineDispatcher } from "../src/surface/dispatcher.ts";
import { EngineFailure } from "../src/surface/errors.ts";
import { EngineSurfacePort } from "../src/surface/port.ts";

/** A port and a dispatcher joined in process, as on the same-thread surface. */
function pair(handlers: ConstructorParameters<typeof EngineDispatcher>[0]["handlers"], portOptions: Partial<ConstructorParameters<typeof EngineSurfacePort>[0]> = {}) {
  const wire: unknown[] = [];
  const dispatcher: EngineDispatcher = new EngineDispatcher({ handlers, post: (message, transfer) => { wire.push(message); port.receive(message, transfer); }, validate: true });
  const port: EngineSurfacePort = new EngineSurfacePort({ send: (message, transfer) => { wire.push(message); void dispatcher.receive(message, transfer); }, validate: true, ...portOptions });
  return { port, dispatcher, wire };
}

test("EngineSurface message envelope — Unknown command", async () => {
  const state = { seeks: 0, handled: [] as string[] };
  const { port, wire } = pair({ "transport.seek": () => { state.seeks++; state.handled.push("transport.seek"); } });
  const before = JSON.stringify(state);
  await assert.rejects(port.raw({ v: 1, id: "a1", type: "scene.explode", payload: {} }), (error: unknown) => error instanceof EngineFailure && error.code === "surface/unknown-command");
  const reply = wire.at(-1) as Record<string, unknown>;
  assert.equal(reply.type, "reply");
  assert.equal(reply.replyTo, "a1");
  assert.equal(reply.ok, false);
  assert.equal((reply.error as { code: string }).code, "surface/unknown-command");
  assert.equal(wire.filter((message) => (message as { replyTo?: string }).replyTo === "a1").length, 1, "exactly one reply");
  assert.equal(JSON.stringify(state), before, "engine state is unchanged");
});

test("EngineSurface message envelope — a version other than 1 is refused with surface/unsupported-version", async () => {
  const { port } = pair({ "transport.pause": () => undefined });
  await assert.rejects(port.raw({ v: 2, id: "b1", type: "transport.pause", payload: {} }), (error: unknown) => error instanceof EngineFailure && error.code === "surface/unsupported-version");
  assert.equal(await port.command("transport.pause", {}), undefined);
});

test("EngineSurface message envelope — Reply timeout", async () => {
  const timers: { callback: () => void; ms: number }[] = [];
  const diagnostics: { id: string; severity: string; details?: Record<string, unknown> }[] = [];
  // The handler never settles: no reply is ever sent.
  const { port } = pair({ "transport.pause": () => new Promise(() => undefined), "still.render": () => new Promise(() => undefined), "export.start": () => new Promise(() => undefined) }, {
    setTimer: (callback, ms) => { timers.push({ callback, ms }); return timers.length; }, clearTimer: () => undefined,
  });
  port.on("diagnostic", (payload) => diagnostics.push(payload));
  const pending = port.command("transport.pause", {});
  // `export.start` and `still.render` reply when accepted and have no deadline.
  void port.command("still.render", { requestId: "s1", time: 0 }).catch(() => undefined);
  void port.command("export.start", { exportId: "x1", width: 1920, height: 1080, frameRate: { numerator: 30, denominator: 1 }, container: "mp4" }).catch(() => undefined);
  assert.deepEqual(timers.map((timer) => timer.ms), [10_000], "one 10 000 ms deadline, for the command that expects a result");
  timers[0].callback();
  await assert.rejects(pending, (error: unknown) => error instanceof EngineFailure && error.code === "surface/timeout");
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].severity, "error");
  assert.equal(diagnostics[0].id, "surface/timeout");
  assert.equal(diagnostics[0].details?.command, "transport.pause");
  assert.equal(port.inFlight, 2, "the two untimed commands are still waiting");
});

test("EngineSurface message envelope — Binary payload inside JSON is refused", () => {
  const base64 = Buffer.alloc(4096, 7).toString("base64");
  const still = { requestId: "s1", width: 320, height: 180, format: "png", bytes: 4096 };
  for (const payload of [{ ...still, base64 }, { ...still, data: base64 }, { ...still, resource: base64 }, { ...still, resource: `data:image/png;base64,${base64}` }]) {
    const parsed = parseEngineEvent({ v: 1, id: "e1", type: "still.done", payload });
    assert.equal(parsed.ok, false);
    assert.equal(!parsed.ok && parsed.code, "surface/invalid-payload");
  }
  assert.equal(parseEngineEvent({ v: 1, id: "e1", type: "still.done", payload: { ...still, resource: "blob:https://app/0f3a" } }).ok, true);
  // A message is plain JSON: no function, no class instance, no typed array.
  for (const payload of [{ time: 0, mode: "exact", extra: () => 1 }, { time: 0, mode: "exact", at: new Date(0) }, { time: 0, mode: "exact", bytes: new Uint8Array(4) }]) {
    const parsed = parseEngineCommand({ v: 1, id: "c1", type: "transport.seek", payload });
    assert.equal(!parsed.ok && parsed.code, "surface/invalid-payload");
  }
  // `sink.chunk` is the one event that carries base64, capped at 262 144 bytes.
  assert.equal(parseEngineEvent({ v: 1, id: "e2", type: "sink.chunk", payload: { streamId: "s", seq: 0, base64 } }).ok, true);
  assert.equal(parseEngineEvent({ v: 1, id: "e3", type: "sink.chunk", payload: { streamId: "s", seq: 0, base64: "A".repeat(262_145) } }).ok, false);
});

test("EngineSurface message envelope — a command is answered by exactly one reply carrying its id, and a transferable rides beside the JSON", async () => {
  const seen: (ArrayBuffer[] | undefined)[] = [];
  const { port, dispatcher, wire } = pair({ "sink.ack": (_payload, transfer) => { seen.push(transfer); return { stored: true }; }, "transport.seek": () => { throw new EngineFailure("engine/no-gpu", "no backend"); } });
  const buffer = new ArrayBuffer(8);
  assert.deepEqual(await port.command("sink.ack", { streamId: "s1", seq: 0, bytes: 8 }, [buffer]), { stored: true });
  assert.equal(seen[0]?.[0], buffer);
  await assert.rejects(port.command("transport.seek", { time: 0, mode: "exact" }), (error: unknown) => error instanceof EngineFailure && error.code === "engine/no-gpu");
  await assert.rejects(port.command("transport.seek", { time: 1000.25, mode: "exact" }), (error: unknown) => error instanceof EngineFailure && error.code === "surface/invalid-payload");
  const ids = wire.map((message) => (message as { id: string }).id);
  assert.equal(new Set(ids.filter((value) => value.startsWith("a"))).size, 3, "ids are unique per sender");
  const transfers: ArrayBuffer[][] = [];
  port.on("export.chunk", (_payload, transfer) => { transfers.push(transfer ?? []); });
  dispatcher.emit("export.chunk", { streamId: "s1", seq: 0, bytes: 8 }, [buffer]);
  assert.equal(transfers[0][0], buffer);
});

test("EngineSurface message envelope — the command and event sets are the ones of the specification, and every code has a listed prefix", () => {
  assert.deepEqual(ENGINE_COMMAND_TYPES, [
    "engine.init", "engine.dispose", "scene.set", "scene.patch", "scene.setActive", "media.setSources", "derived.setSources", "fonts.setSources",
    "transport.seek", "transport.play", "transport.pause", "transport.setRate", "transport.setLoop", "transport.setVolume", "transport.setMuted",
    "transport.setScrubAudio", "view.resize", "view.setQuality", "view.setVisible", "preview.setOverride", "preview.clearOverride", "still.render",
    "thumbnails.request", "thumbnails.cancel", "layout.query", "layout.sampleSource", "export.start", "export.pause", "export.resume", "export.cancel",
    "sink.ack", "perf.setEnabled", "memory.trim",
  ]);
  assert.deepEqual(ENGINE_EVENT_TYPES, [
    "engine.ready", "engine.constraintsChanged", "engine.error", "engine.backendChanged", "frame.ready", "transport.state", "transport.time",
    "transport.ended", "media.status", "still.done", "still.failed", "thumbnails.ready", "export.progress", "export.chunk", "export.done", "export.failed",
    "sink.chunk", "sink.closed", "perf.sample", "memory.pressure", "diagnostic",
  ]);
  for (const value of [...ENGINE_ERROR_CODES, ...ENGINE_DIAGNOSTIC_IDS]) {
    assert.ok(value.startsWith("derived/") || ENGINE_CODE_PREFIXES.some((prefix) => value.startsWith(prefix)), value);
  }
});
