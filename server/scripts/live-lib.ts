// Shared by the live scripts: pairing a simulated device with a running server and calling the product channel.
import { readFileSync } from "node:fs";
import { decodeOffer, type PairingOffer } from "@jagentchill/protocol";
import { DeviceSim } from "../test/device-sim.ts";

// No working default: 18910 is where a person's own server listens, and a script that forgot the variable must not
// reach it. Port 9 has no listener, so such a script fails at its first call instead.
export const BASE = `http://127.0.0.1:${process.env.JAGENTCHILL_PORT ?? 9}`;

export type Rpc = {
  device: DeviceSim;
  offer: PairingOffer;
  role: string;
  /** Resolves with the result, or throws the error envelope. */
  call<T = any>(method: string, params?: unknown): Promise<T>;
  /** The error envelope of a call that must fail; throws when it succeeds. */
  refused(method: string, params?: unknown): Promise<{ code: string; message: string; details?: any }>;
  on(listener: (event: string, payload: any) => void): () => void;
  /** Every frame this device received, as text, for scanning. */
  received: string[];
  sent: string[];
  close(): void;
};

/** Opens the product channel of a device that is already paired. */
export async function open(device: DeviceSim, offer: PairingOffer): Promise<Rpc> {
  const conn = device.connect(offer);
  const ready = (await conn.outcome).ready;
  if (!ready) throw new Error("the device was not admitted");
  const pending = new Map<string, { resolve(value: any): void; reject(error: any): void }>();
  const listeners = new Set<(event: string, payload: any) => void>();
  const received: string[] = [];
  const sent: string[] = [];
  let id = 0;
  conn.ws.on("message", (data) => {
    const text = data.toString();
    received.push(text);
    const frame = JSON.parse(text);
    if (frame.t === "res") {
      const waiter = pending.get(frame.id);
      pending.delete(frame.id);
      if (frame.ok) waiter?.resolve(frame.result);
      else waiter?.reject(frame.error);
    } else if (frame.t === "evt") {
      for (const listener of listeners) listener(frame.event, frame.payload);
    }
  });
  const call = <T,>(method: string, params?: unknown) => new Promise<T>((resolve, reject) => {
    const requestId = `q${++id}`;
    pending.set(requestId, { resolve, reject });
    const text = JSON.stringify({ t: "req", id: requestId, method, params });
    sent.push(text);
    conn.ws.send(text);
  });
  return {
    device, offer, role: ready.role, call, received, sent,
    refused: (method, params) => call(method, params).then(() => { throw new Error(`${method} was expected to be refused`); }, (error) => {
      if (error instanceof Error) throw error;
      return error;
    }),
    on: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    close: () => conn.ws.close(),
  };
}

/** Pairs the first device (admin) with the offer the server printed, reading the six-digit code from its log. */
export async function pairAdmin(offerUrl: string, logFile: string, name = "Live admin"): Promise<Rpc> {
  const decoded = decodeOffer(offerUrl);
  if (!decoded.ok) throw new Error(decoded.code);
  const device = new DeviceSim(BASE, name);
  const requestId = await device.enrolUntilProved(decoded.offer);
  await new Promise((r) => setTimeout(r, 300));
  const line = readFileSync(logFile, "utf8").split("\n").filter((l) => l.includes(`${device.deviceId.slice(0, 8)})`)).pop() ?? "";
  await device.verify(decoded.offer, requestId, /code (\d{6})/.exec(line)![1]);
  return open(device, decoded.offer);
}

/** Pairs a second device with an offer the admin creates; the admin device reads the code from its pairing event. */
export async function pairWith(admin: Rpc, role: "editor" | "viewer" | "admin", name: string): Promise<Rpc> {
  const created = await admin.call<{ url: string }>("jagentchill.pairing.offer.create", { role });
  const decoded = decodeOffer(created.url);
  if (!decoded.ok) throw new Error(decoded.code);
  const device = new DeviceSim(BASE, name);
  const code = new Promise<string>((resolve) => {
    const off = admin.on((event, payload) => {
      if (event === "jagentchill.pairing.requested" && payload.request.deviceId === device.deviceId) {
        off();
        resolve(payload.code);
      }
    });
  });
  const requestId = await device.enrolUntilProved(decoded.offer);
  await device.verify(decoded.offer, requestId, await code);
  return open(device, decoded.offer);
}

/** Sends a secret value over the signed HTTP route; it never travels in a channel frame. */
export async function putSecret(rpc: Rpc, name: string, value: string): Promise<{ status: number; body: any }> {
  const target = `/jagentchill/v1/secrets/${name}`;
  const res = await fetch(BASE + target, { method: "PUT", headers: { "content-type": "text/plain", ...rpc.device.signedHeaders(rpc.offer.gatewayId, "PUT", target, value) }, body: value });
  return { status: res.status, body: await res.json() };
}

/** Sends one message and resolves with the final text of the turn (or the error text). */
export async function turn(rpc: Rpc, sessionKey: string, message: string, timeoutMs = 180_000): Promise<{ state: string; text: string; send: any }> {
  await rpc.call("jagentchill.chat.subscribe", { sessionKey });
  let expectedRunId: string | undefined;
  let settled = false;
  let finish!: (value: { state: string; text: string }) => void;
  const queued: any[] = [];
  const finished = new Promise<{ state: string; text: string }>((resolve) => { finish = resolve; });
  const off = rpc.on((event, payload) => {
    if (event !== "jagentchill.chat.stream" || payload.sessionKey !== sessionKey || !["final", "error", "aborted"].includes(payload.state)) return;
    if (!expectedRunId) { queued.push(payload); return; }
    if (payload.runId !== expectedRunId) return;
    settled = true;
    off();
    clearTimeout(timer);
    const content = payload.message?.content;
    finish({ state: payload.state, text: Array.isArray(content) ? content.map((part: any) => part.text ?? "").join("") : String(payload.errorMessage ?? "") });
  });
  const timer = setTimeout(() => { if (!settled) { settled = true; off(); finish({ state: "timeout", text: "" }); } }, timeoutMs);
  const send = await rpc.call("jagentchill.chat.send", { sessionKey, message });
  expectedRunId = typeof send?.runId === "string" ? send.runId : undefined;
  const match = queued.find((payload) => !expectedRunId || payload.runId === expectedRunId);
  if (match && !settled) {
    settled = true;
    off();
    clearTimeout(timer);
    const content = match.message?.content;
    finish({ state: match.state, text: Array.isArray(content) ? content.map((part: any) => part.text ?? "").join("") : String(match.errorMessage ?? "") });
  }
  return { ...(await finished), send };
}

export const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
