import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { WebSocket } from "ws";
import {
  CONNECT_CONTEXT, EMPTY_BODY_SHA256, SIGNATURE_HEADERS, enrolContext, handshakeTranscript, requestCanonicalString,
  type PairingOffer,
} from "@jagentchill/protocol";
import { verifyText } from "../src/crypto.ts";

/** A device as the tests need it: an Ed25519 key and the client side of enrolment and of the product channel. */
export class DeviceSim {
  readonly privateKey: KeyObject;
  readonly devicePublicKey: string;
  readonly deviceId: string;
  token: string | undefined;
  readonly name: string;
  private readonly base: string;

  constructor(base: string, name = "Test phone") {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const der = publicKey.export({ type: "spki", format: "der" });
    const raw = der.subarray(der.length - 32);
    this.privateKey = privateKey;
    this.devicePublicKey = raw.toString("base64url");
    this.deviceId = createHash("sha256").update(raw).digest("hex");
    this.base = base;
    this.name = name;
  }

  sign(text: string, key: KeyObject = this.privateKey): string {
    return sign(null, Buffer.from(text, "utf8"), key).toString("base64url");
  }

  signedHeaders(gatewayId: string, method: string, target: string, body: string | undefined, over: Partial<{ ts: number; nonce: string }> = {}) {
    const ts = over.ts ?? Date.now();
    const nonce = over.nonce ?? randomBytes(16).toString("base64url");
    const bodySha256 = body === undefined ? EMPTY_BODY_SHA256 : createHash("sha256").update(body).digest("hex");
    return {
      [SIGNATURE_HEADERS.device]: this.deviceId,
      [SIGNATURE_HEADERS.timestamp]: String(ts),
      [SIGNATURE_HEADERS.nonce]: nonce,
      [SIGNATURE_HEADERS.signature]: this.sign(requestCanonicalString({ gatewayId, method, target, bodySha256, ts, nonce })),
    };
  }

  async post(path: string, body: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(this.base + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    const text = await res.text();
    try { return { status: res.status, body: JSON.parse(text) as any }; }
    catch { throw new Error(`POST ${path} returned non-JSON (${res.status}, ${text.length} bytes).`); }
  }

  /** challenge + gateway verification + prove. Returns the request id. */
  async enrolUntilProved(offer: PairingOffer): Promise<string> {
    const deviceNonce = randomBytes(32).toString("base64url");
    const challenge = await this.post("/jagentchill/v1/pair/challenge", {
      offerId: offer.offerId, deviceId: this.deviceId, devicePublicKey: this.devicePublicKey, deviceNonce,
      deviceName: this.name, platform: "ios", appVersion: "0.0.0", protocolVersion: 1, keyProtection: "keychain",
    });
    if (challenge.status !== 200) throw new Error(`challenge ${challenge.status} ${challenge.body.error?.code}`);
    const fields = {
      context: enrolContext(offer.offerId), gatewayNonce: challenge.body.gatewayNonce, deviceNonce, ts: challenge.body.ts,
      gatewayId: offer.gatewayId, deviceId: this.deviceId, devicePublicKey: this.devicePublicKey, protocolVersion: 1,
    };
    if (!verifyText(offer.gatewayPublicKey, handshakeTranscript({ ...fields, role: "gateway" }), challenge.body.gatewaySignature)) {
      throw new Error("GATEWAY_SIGNATURE_INVALID");
    }
    const prove = await this.post("/jagentchill/v1/pair/prove", {
      requestId: challenge.body.requestId, signature: this.sign(handshakeTranscript({ ...fields, role: "device" })),
    });
    if (prove.status !== 200) throw new Error(`prove ${prove.status} ${prove.body.error?.code}`);
    return challenge.body.requestId;
  }

  async verify(offer: PairingOffer, requestId: string, code: string, signed = true) {
    const body = { requestId, code };
    const target = "/jagentchill/v1/pair/verify";
    const result = await this.post(target, body, signed ? this.signedHeaders(offer.gatewayId, "POST", target, JSON.stringify(body)) : {});
    if (result.status === 200) this.token = result.body.deviceToken.value;
    return result;
  }

  /** Opens the product channel and runs hello → challenge → prove. Resolves with the socket and the first frame after prove, or the close. */
  connect(offer: PairingOffer, over: Partial<{ token: string; signWith: KeyObject; signBareNonce: boolean; skipHandshake: boolean; clientInstanceId: string }> = {}) {
    const ws = new WebSocket(this.base.replace("http", "ws") + "/jagentchill/v1/ws");
    const deviceNonce = randomBytes(32).toString("base64url");
    const frames: any[] = [];
    const waiters: Array<(frame: any) => void> = [];
    const closed = new Promise<{ code: number; reason: string }>((resolve) => ws.on("close", (code, reason) => resolve({ code, reason: reason.toString() })));
    ws.on("message", (data) => {
      const frame = JSON.parse(data.toString());
      const waiter = waiters.shift();
      if (waiter) waiter(frame);
      else frames.push(frame);
    });
    const next = () => new Promise<any>((resolve) => (frames.length ? resolve(frames.shift()) : waiters.push(resolve)));
    const send = (frame: unknown) => ws.send(JSON.stringify(frame));
    let id = 0;
    const call = async (method: string, params?: unknown) => {
      const requestId = `r${++id}`;
      send({ t: "req", id: requestId, method, params });
      for (;;) {
        const frame = await next();
        if (frame.t === "res" && frame.id === requestId) return frame;
        frames.push(frame);
        await new Promise((r) => setImmediate(r));
      }
    };
    const outcome = new Promise<{ ready?: any; close?: { code: number; reason: string } }>((resolve) => {
      closed.then((close) => resolve({ close }));
      ws.on("open", async () => {
        if (over.skipHandshake) return send({ t: "req", id: "x", method: "jagentchill.device.list" });
        send({ t: "hello", deviceId: this.deviceId, deviceNonce, protocolVersion: 1, minProtocolVersion: 1, capabilities: [], clientInstanceId: over.clientInstanceId ?? "sim" });
        const challenge = await next();
        const fields = {
          context: CONNECT_CONTEXT, gatewayNonce: challenge.gatewayNonce, deviceNonce, ts: challenge.ts,
          gatewayId: offer.gatewayId, deviceId: this.deviceId, devicePublicKey: this.devicePublicKey, protocolVersion: 1,
        };
        const gatewayOk = verifyText(offer.gatewayPublicKey, handshakeTranscript({ ...fields, role: "gateway" }), challenge.gatewaySignature);
        const text = over.signBareNonce ? challenge.gatewayNonce : handshakeTranscript({ ...fields, role: "device" });
        send({ t: "prove", signature: this.sign(text, over.signWith), deviceToken: over.token ?? this.token ?? "" });
        const frame = await next();
        if (frame.t === "ready") {
          if (frame.deviceToken) this.token = frame.deviceToken.value;
          resolve({ ready: { ...frame, gatewayOk } });
        }
      });
    });
    return { ws, outcome, closed, next, call };
  }
}
