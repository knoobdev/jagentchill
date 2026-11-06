import { spawn, type SpawnOptions } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import type { ProcessLike } from "./types.ts";

export type RpcProcess = {
  child: ProcessLike;
  request(method: string, params?: unknown): Promise<unknown>;
  notify(method: string, params?: unknown): void;
  close(): Promise<void>;
  stderr(): string;
  onNotification(listener: (method: string, params: any) => void): () => void;
  onRequest(listener: (method: string, params: any, id: string | number) => Promise<unknown>): () => void;
};
export function spawnRpc(command: string, args: string[], opts: SpawnOptions = {}): RpcProcess {
  const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], ...opts }) as ProcessLike;
  let stderrText = "", closed = false;
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (e: Error) => void }>();
  const notifications = new Set<(method: string, params: any) => void>();
  const requests = new Set<(method: string, params: any, id: string | number) => Promise<unknown>>();
  createInterface({ input: child.stdout! }).on("line", (line) => {
    let msg: any; try { msg = JSON.parse(line); } catch { return; }
    if (msg.id !== undefined && msg.method) {
      void Promise.all([...requests].map((fn) => fn(msg.method, msg.params, msg.id))).then((answers) => {
        const value = answers.find((v) => v !== undefined);
        child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id: msg.id, ...(value === undefined ? { error: { code: -32601, message: "Unsupported request" } } : { result: value }) })}\n`);
      }); return;
    }
    if (msg.id !== undefined) {
      const slot = pending.get(String(msg.id)); if (!slot) return; pending.delete(String(msg.id));
      msg.error ? slot.reject(new Error(msg.error.message ?? "RPC error")) : slot.resolve(msg.result); return;
    }
    if (msg.method) for (const fn of notifications) fn(msg.method, msg.params);
  });
  child.stderr?.on("data", (chunk: Buffer) => { stderrText = (stderrText + chunk.toString()).slice(-8192); });
  child.once("exit", (code, signal) => { closed = true; for (const slot of pending.values()) slot.reject(new Error(`RPC child exited ${code ?? signal}`)); pending.clear(); });
  const write = (record: unknown) => { if (closed || !child.stdin?.writable) throw new Error("RPC process is closed"); child.stdin.write(`${JSON.stringify(record)}\n`); };
  return {
    child,
    request(method, params) { const id = randomUUID(); return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); try { write({ jsonrpc: "2.0", id, method, params }); } catch (e) { pending.delete(id); reject(e); } }); },
    notify(method, params) { write({ jsonrpc: "2.0", method, params }); },
    async close() { if (!closed) child.kill("SIGTERM"); await new Promise<void>((resolve) => closed ? resolve() : child.once("exit", () => resolve())); },
    stderr: () => stderrText,
    onNotification(fn) { notifications.add(fn); return () => notifications.delete(fn); },
    onRequest(fn) { requests.add(fn); return () => requests.delete(fn); },
  };
}
