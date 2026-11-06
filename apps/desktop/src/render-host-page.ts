import { createEngineSurface } from "../../../packages/render/src/index.ts";
declare global { interface Window { renderHostBridge: { onCommand(listener: (command: any) => void): void; onShutdown(listener: () => void): void; send(channel: string, value: unknown): void } } }

const host = document.getElementById("surface")!;
const surface = createEngineSurface(host, { wasmUrl: new URL("./opencut_wasm_bg.wasm", import.meta.url), validate: true, renderHost: true, surface: "render-host" });
let initialized = false;
let helloSent = false;
let eventCounter = 0;

surface.port.onAny((event) => {
  const transfer = event.transfer;
  const payload = event.payload as Record<string, unknown>;
  if (event.type === "engine.ready" && !helloSent) {
    helloSent = true;
    const ready = payload as unknown as { backend: string; software: boolean; engineVersion: string; protocolVersion: number; encoders: unknown; audioEncoders: unknown; maxTextureSize: number };
    if (ready.backend === "none") { window.renderHostBridge.send("render-host:message", { envelope: { v: 1, id: "no-backend", type: "host.no-backend" } }); return; }
    window.renderHostBridge.send("render-host:message", { envelope: { v: 1, id: "hello", type: "hello", payload: { engineVersion: ready.engineVersion, protocolVersion: ready.protocolVersion, backend: ready.backend, software: ready.software, encoders: ready.encoders, audioEncoders: ready.audioEncoders, maxTextureSize: ready.maxTextureSize } } });
  }
  if ((event.type === "still.done" || event.type === "export.chunk") && transfer?.[0]) {
    const bytes = new Uint8Array(transfer[0]);
    window.renderHostBridge.send("render-host:message", { binary: bytes, envelope: { v: 1, id: "e" + (++eventCounter), type: event.type, payload } });
  }
  else window.renderHostBridge.send("render-host:message", { envelope: { v: 1, id: "e" + (++eventCounter), type: event.type, payload } });
});

window.renderHostBridge.onCommand((command: { v: number; id: string; type: string; payload: object }) => {
  if (command.type === "engine.init") initialized = true;
  void surface.port.raw(command as { id: string; type: string } & Record<string, unknown>).then((payload) => {
    window.renderHostBridge.send("render-host:message", { envelope: { v: 1, id: `r-${command.id}`, type: "reply", replyTo: command.id, ok: true, ...(payload === undefined ? {} : { payload }) } });
  }, (error: any) => {
    window.renderHostBridge.send("render-host:message", { envelope: { v: 1, id: `r-${command.id}`, type: "reply", replyTo: command.id, ok: false, error: { code: error.code ?? "surface/invalid-payload", message: error.message ?? String(error), ...(error.details ? { details: error.details } : {}) } } });
  });
});

void surface.port.command("engine.init", { width: 1920, height: 1080, devicePixelRatio: 1, platform: "host", memoryClass: "host", locale: "en", allowSoftware: true }).then(() => { initialized = true; }).catch((error) => {
  console.error(`[render-host] engine init failed: ${String(error)}`);
});
window.renderHostBridge.onShutdown(async () => {
  if (initialized) await surface.port.command("engine.dispose", {}).catch(() => undefined);
  window.renderHostBridge.send("render-host:message", { envelope: { v: 1, id: "shutdown", type: "host.exit" } });
});
