import {
  ENGINE_COMMAND_SCHEMAS, ENGINE_EVENT_SCHEMAS, ENGINE_REPLY_TIMEOUT_MS, ENGINE_UNTIMED_COMMANDS, isJsonSerialisable, parseEngineEvent, parseEngineReply,
  type EngineCommandPayload, type EngineCommandType, type EngineEventType,
} from "@jagentchill/protocol";
import type { z } from "zod";
import { EngineFailure, validationDefault } from "./errors.ts";

export type EngineEvent<T extends EngineEventType = EngineEventType> = { type: T; payload: z.output<(typeof ENGINE_EVENT_SCHEMAS)[T]>; transfer?: ArrayBuffer[] };
type Listener<T extends EngineEventType> = (payload: z.output<(typeof ENGINE_EVENT_SCHEMAS)[T]>, transfer?: ArrayBuffer[]) => void;
type Pending = { type: EngineCommandType; resolve: (payload: unknown) => void; reject: (error: Error) => void; timer: unknown };

export type PortOptions = {
  /** Hands a command envelope to the engine side of the surface. */
  send: (message: unknown, transfer?: ArrayBuffer[]) => void;
  /** Schema validation of what is sent and received; on in development and test builds. */
  validate?: boolean;
  /** Prefix that keeps ids unique when several ports share a transport. */
  idPrefix?: string;
  timeoutMs?: number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
};

/**
 * The app side of an `EngineSurface`: sends commands, matches each with its single reply, and delivers events.
 * The same class serves the same-thread surface, the mobile bridge and the render-host pipe; only `send` differs.
 */
export class EngineSurfacePort {
  private readonly options: PortOptions;
  private readonly validate: boolean;
  private readonly pending = new Map<string, Pending>();
  private readonly listeners = new Map<string, Set<Listener<EngineEventType>>>();
  private readonly anyListeners = new Set<(event: EngineEvent) => void>();
  private counter = 0;
  private closed = false;

  constructor(options: PortOptions) {
    this.options = options;
    this.validate = options.validate ?? validationDefault();
  }

  /** Sends a command and resolves with the payload of its reply. */
  command<T extends EngineCommandType>(type: T, payload: EngineCommandPayload<T>, transfer?: ArrayBuffer[]): Promise<unknown> {
    if (this.closed) return Promise.reject(new EngineFailure("surface/invalid-payload", "the surface is closed"));
    // Outgoing messages are checked for plain JSON only: whether the type and payload are acceptable is the
    // engine's answer to give, as a reply.
    if (this.validate && !isJsonSerialisable(payload)) {
      return Promise.reject(new EngineFailure("surface/invalid-payload", `${type}: a message is plain JSON data`));
    }
    const id = `${this.options.idPrefix ?? "a"}${++this.counter}`;
    return new Promise((resolve, reject) => {
      const entry: Pending = { type, resolve, reject, timer: undefined };
      if (!ENGINE_UNTIMED_COMMANDS.includes(type)) {
        const setTimer = this.options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
        entry.timer = setTimer(() => this.expire(id), this.options.timeoutMs ?? ENGINE_REPLY_TIMEOUT_MS);
      }
      this.pending.set(id, entry);
      try {
        this.options.send({ v: 1, id, type, payload }, transfer);
      } catch (error) {
        this.settle(id);
        reject(error as Error);
      }
    });
  }

  /** Sends a message exactly as given; used by tests and by the bridge for messages built elsewhere. */
  raw(message: { id: string; type: string } & Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.pending.set(message.id, { type: message.type as EngineCommandType, resolve, reject, timer: undefined });
      this.options.send(message);
    });
  }

  on<T extends EngineEventType>(type: T, listener: Listener<T>): () => void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, set = new Set());
    set.add(listener as Listener<EngineEventType>);
    return () => { set.delete(listener as Listener<EngineEventType>); };
  }
  onAny(listener: (event: EngineEvent) => void): () => void {
    this.anyListeners.add(listener);
    return () => { this.anyListeners.delete(listener); };
  }

  /** Called by the transport with every message that arrives from the engine. */
  receive(message: unknown, transfer?: ArrayBuffer[]): void {
    if ((message as { type?: unknown } | null)?.type === "reply") { this.receiveReply(message); return; }
    let type: EngineEventType, payload: unknown;
    if (this.validate) {
      const parsed = parseEngineEvent(message);
      if (!parsed.ok) throw new EngineFailure(parsed.code, parsed.message);
      ({ type, payload } = parsed);
    } else {
      ({ type, payload } = message as { type: EngineEventType; payload: unknown });
      if (!Object.hasOwn(ENGINE_EVENT_SCHEMAS, type)) return;
    }
    this.deliver(type, payload, transfer);
  }

  private deliver(type: EngineEventType, payload: unknown, transfer?: ArrayBuffer[]): void {
    for (const listener of this.listeners.get(type) ?? []) listener(payload as never, transfer);
    for (const listener of this.anyListeners) listener({ type, payload: payload as never, transfer });
  }

  private receiveReply(message: unknown): void {
    let reply = message as { replyTo: string; ok: boolean; payload?: unknown; error?: { code: string; message: string; details?: Record<string, unknown> } };
    if (this.validate) {
      const parsed = parseEngineReply(message);
      if (!parsed.ok) throw new EngineFailure(parsed.code, parsed.message);
      reply = parsed.reply;
    }
    const entry = this.settle(reply.replyTo);
    // A reply nobody waits for is one that arrived after its deadline; exactly one outcome per command.
    if (!entry) return;
    if (reply.ok) entry.resolve(reply.payload);
    else entry.reject(new EngineFailure(reply.error!.code as never, reply.error!.message, reply.error!.details));
  }

  private settle(id: string): Pending | undefined {
    const entry = this.pending.get(id);
    if (!entry) return undefined;
    this.pending.delete(id);
    if (entry.timer !== undefined) (this.options.clearTimer ?? ((timer) => clearTimeout(timer as never)))(entry.timer);
    return entry;
  }

  private expire(id: string): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    const message = `${entry.type} received no reply within ${this.options.timeoutMs ?? ENGINE_REPLY_TIMEOUT_MS} ms`;
    entry.reject(new EngineFailure("surface/timeout", message, { command: entry.type }));
    this.deliver("diagnostic", { id: "surface/timeout", severity: "error", message, details: { command: entry.type } });
  }

  /** Number of commands still waiting for their reply. */
  get inFlight(): number { return this.pending.size; }

  /** Rejects everything in flight; the surface is gone. */
  close(reason = "the surface was closed"): void {
    this.closed = true;
    for (const id of [...this.pending.keys()]) this.settle(id)?.reject(new EngineFailure("surface/timeout", reason));
  }
}

/** The commands of the surface, for callers that enumerate them. */
export const COMMAND_TYPES = Object.keys(ENGINE_COMMAND_SCHEMAS) as EngineCommandType[];
