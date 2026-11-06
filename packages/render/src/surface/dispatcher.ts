import {
  ENGINE_COMMAND_SCHEMAS, ENGINE_ERROR_CODES, ENGINE_EVENT_SCHEMAS, RENDER_HOST_COMMANDS, RENDER_HOST_SILENT_EVENTS, parseEngineCommand,
  type EngineCommandParsed, type EngineCommandType, type EngineError, type EngineEventPayload, type EngineEventType,
} from "@jagentchill/protocol";
import { EngineFailure, validationDefault } from "./errors.ts";

export type CommandHandlers = { [T in EngineCommandType]?: (payload: EngineCommandParsed<T>, transfer?: ArrayBuffer[]) => unknown | Promise<unknown> };

export type DispatcherOptions = {
  /** Hands a reply or an event envelope to the app side of the surface. */
  post: (message: unknown, transfer?: ArrayBuffer[]) => void;
  handlers: CommandHandlers;
  validate?: boolean;
  /** The render host accepts a reduced command set and emits no transport events. */
  renderHost?: boolean;
};

/**
 * The engine side of an `EngineSurface`: validates each incoming envelope, runs its handler and answers with exactly
 * one reply. A message it cannot accept never reaches a handler, so engine state is untouched by it.
 */
export class EngineDispatcher {
  private readonly options: DispatcherOptions;
  private readonly validate: boolean;
  private counter = 0;

  constructor(options: DispatcherOptions) {
    this.options = options;
    this.validate = options.validate ?? validationDefault();
  }

  async receive(message: unknown, transfer?: ArrayBuffer[]): Promise<void> {
    const replyTo = typeof (message as { id?: unknown } | null)?.id === "string" ? (message as { id: string }).id : "";
    let type: EngineCommandType, payload: unknown;
    if (this.validate) {
      const parsed = parseEngineCommand(message);
      if (!parsed.ok) { this.reply(parsed.id ?? replyTo, { code: parsed.code, message: parsed.message }); return; }
      ({ type, payload } = parsed);
    } else {
      // Production same-thread calls skip the payload schemas; the version and the command set are still checked.
      const envelope = message as { v?: unknown; type?: unknown; payload?: unknown };
      if (envelope.v !== 1) { this.reply(replyTo, { code: "surface/unsupported-version", message: `protocol version ${String(envelope.v)} is not supported` }); return; }
      if (typeof envelope.type !== "string" || !Object.hasOwn(ENGINE_COMMAND_SCHEMAS, envelope.type)) {
        this.reply(replyTo, { code: "surface/unknown-command", message: `unknown command "${String(envelope.type)}"` });
        return;
      }
      type = envelope.type as EngineCommandType;
      payload = envelope.payload ?? {};
    }
    if (this.options.renderHost && !RENDER_HOST_COMMANDS.includes(type)) {
      this.reply(replyTo, { code: "surface/unsupported-on-host", message: `${type} is not available on the render host` });
      return;
    }
    const handler = this.options.handlers[type] as ((payload: unknown, transfer?: ArrayBuffer[]) => unknown) | undefined;
    if (!handler) { this.reply(replyTo, { code: "surface/unknown-command", message: `${type} has no handler on this surface` }); return; }
    try {
      this.reply(replyTo, undefined, await handler(payload, transfer));
    } catch (error) {
      if (error instanceof EngineFailure) { this.reply(replyTo, error.toJSON()); return; }
      // The time API throws its code on an error object; the wasm bridge throws strings that begin with one.
      const text = typeof error === "string" ? error : String((error as { code?: unknown } | null)?.code ?? (error as Error)?.message ?? error);
      const code = ENGINE_ERROR_CODES.find((known) => text.startsWith(known));
      if (code) { this.reply(replyTo, { code, message: typeof error === "string" ? error : (error as Error).message }); return; }
      if (typeof WebAssembly !== "undefined" && error instanceof WebAssembly.RuntimeError) { this.reply(replyTo, { code: "engine/wasm-panic", message: error.message }); return; }
      // Anything else is a defect: the command still gets its one reply, and the error stays visible.
      this.reply(replyTo, { code: "surface/invalid-payload", message: `${type} failed: ${text}` });
      throw error;
    }
  }

  private reply(replyTo: string, error?: EngineError, payload?: unknown): void {
    const base = { v: 1 as const, id: `r${++this.counter}`, type: "reply" as const, replyTo };
    this.options.post(error ? { ...base, ok: false, error } : { ...base, ok: true, ...(payload === undefined ? {} : { payload }) });
  }

  /** Emits an event. In development and test builds an event outside its schema is a programming error. */
  emit<T extends EngineEventType>(type: T, payload: EngineEventPayload<T>, transfer?: ArrayBuffer[]): void {
    if (this.options.renderHost && RENDER_HOST_SILENT_EVENTS.includes(type)) return;
    let body: unknown = payload;
    if (this.validate) {
      const parsed = ENGINE_EVENT_SCHEMAS[type].safeParse(payload);
      if (!parsed.success) throw new Error(`event ${type} does not match its schema: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
      body = parsed.data;
    }
    this.options.post({ v: 1, id: `e${++this.counter}`, type, payload: body }, transfer);
  }
}
