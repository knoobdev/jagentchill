import { Engine, type EngineOptions } from "../engine/engine.ts";
import { EngineDispatcher } from "./dispatcher.ts";
import { EngineSurfacePort } from "./port.ts";

export type EngineSurfaceOptions = {
  wasmUrl?: string | URL; validate?: boolean;
  surface?: import("@jagentchill/protocol").EngineReady["surface"];
  renderHost?: boolean;
  /** Creates the export session's worker from the bundled `@jagentchill/render/export-worker` script; without it an export renders on the preview's compositor. */
  exportWorker?: () => Worker;
  /** URL of the bundled decode-probe clip (`packages/render/assets/probe/decode-1080p30.mp4`); without it only the encode probe runs. */
  probeClipUrl?: string;
};
export type EngineSurface = { port: EngineSurfacePort; engine: Engine };

/**
 * The same-thread surface of web and desktop: the engine runs in the realm of the app, mounts its canvas in the
 * host element, and commands and events are in-process calls carrying the same envelopes as the other variants.
 */
export function createEngineSurface(host: HTMLElement | undefined, options: EngineSurfaceOptions = {}): EngineSurface {
  const engineOptions: EngineOptions = { host, wasmUrl: options.wasmUrl, exportWorker: options.exportWorker, probeClipUrl: options.probeClipUrl, surface: options.surface ?? "same-thread", emit: (type, payload, transfer) => dispatcher.emit(type, payload, transfer) };
  const engine = new Engine(engineOptions);
  const dispatcher: EngineDispatcher = new EngineDispatcher({ handlers: engine.handlers, validate: options.validate, renderHost: options.renderHost, post: (message, transfer) => port.receive(message, transfer) });
  const port: EngineSurfacePort = new EngineSurfacePort({ validate: options.validate, send: (message, transfer) => { void dispatcher.receive(message, transfer); } });
  return { port, engine };
}
