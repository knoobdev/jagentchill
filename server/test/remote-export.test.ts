import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdirSync } from "node:fs";
import { Readable, Writable } from "node:stream";
import test from "node:test";
import { resolve } from "node:path";
import { requestCanonicalString, SIGNATURE_HEADERS } from "@jagentchill/protocol";
import { openDatabase } from "../src/store/database.ts";
import { createBlobStore } from "../src/sync/blobs.ts";
import { createRemoteExportService, remoteExportFeatures, type RemoteExportRenderer } from "../src/export/service.ts";
import { generateEd25519, signText } from "../src/crypto.ts";
import { NonceCache, RequestAuthenticator } from "../src/channel/request-auth.ts";

const DATA = process.env.JAGENTCHILL_TEST_DATA_DIR ? resolve(import.meta.dirname, "../../", process.env.JAGENTCHILL_TEST_DATA_DIR) : new URL("../../.dev/run-w10h3-remote-export-1/", import.meta.url).pathname;
const ffmpeg = process.env.JAGENTCHILL_FFMPEG ?? "/usr/local/bin/ffmpeg";

test("remote export creates, publishes progress, stores a real MP4 and serves signed ranges", async () => {
  mkdirSync(DATA, { recursive: true });
  const db = openDatabase(":memory:"), now = () => Date.now();
  const blobs = createBlobStore({ db, dir: `${DATA}blobs`, now, quotaBytes: () => 1_000_000_000, refCount: () => 0 });
  const document = { metadata: { name: "RPC fixture" } };
  const documents = { row: () => ({ head: 3 }), head: () => document } as any;
  const key = generateEd25519(), publicKey = key.publicKeyRaw.toString("base64url"), deviceRecord = { deviceId: "device-test", state: "active", devicePublicKey: publicKey };
  const deviceRegistry = { get: () => deviceRecord, assertTokenNotLapsed() {}, scopesOf: () => ["jagentchill.export.run"], touch() {} } as any;
  const auth = new RequestAuthenticator({ gatewayId: "gateway-test", devices: deviceRegistry, nonces: new NonceCache(now), now });
  let releaseRender!: () => void;
  const renderGate = new Promise<void>((resolve) => { releaseRender = resolve; });
  const renderer: RemoteExportRenderer = {
    kind: "test-fake",
    available: () => true,
    capabilities: () => ({ encoders: Object.fromEntries(["h264", "hevc", "vp9", "av1", "aac", "opus"].map((name) => [name, { state: "available" }])), containers: ["mp4"], proRes: false }) as any,
    async start(input) {
      await renderGate;
      input.progress({ stage: "rendering", framesDone: 1, frameCount: 5, encodedBytes: 0 });
      const child = spawn(ffmpeg, ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=red:s=64x64:r=10", "-t", "0.5", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-f", "mp4", input.outputPath], { env: { ...process.env, JAGENTCHILL_FFMPEG: ffmpeg }, stdio: "ignore" });
      const [code] = await once(child, "close"); assert.equal(code, 0);
      input.progress({ stage: "finalising", framesDone: 5, frameCount: 5, encodedBytes: 1000 });
    },
    cancel() {},
  };
  assert.deepEqual(remoteExportFeatures(), {});
  assert.deepEqual(remoteExportFeatures({ kind: "render-host", available: () => false }), {});
  assert.deepEqual(remoteExportFeatures(renderer), {}, "an available test fake never enables a production feature flag");
  assert.deepEqual(remoteExportFeatures({ kind: "render-host", available: () => true }), { "remote-export": true });
  const events: any[] = [];
  const connection = { deviceId: "device-test", role: () => "admin", send: (_event: string, _stream: string, payload: unknown) => events.push(payload) } as any;
  const service = createRemoteExportService({ db, now, dataDir: DATA, blobs, documents, auth, renderer, jobs: {
    subscribe: (_jobId, subscriber) => { assert.equal(subscriber, connection); }, unsubscribe: () => undefined,
    publish: (_jobId, _event, payload) => events.push(payload),
  } });
  const created = await service.methods.get("jagentchill.export.create")!.handle({ projectId: "project-fixture", revision: 3, settings: {}, idempotencyKey: "remote-export-fixture-1" }, connection) as any;
  service.methods.get("jagentchill.export.subscribe")!.handle({ jobId: created.jobId }, connection);
  releaseRender();
  let job: any;
  const deadline = Date.now() + 20_000;
  do {
    await new Promise((resolve) => setTimeout(resolve, 30));
    job = service.methods.get("jagentchill.export.get")!.handle({ jobId: created.jobId }, connection);
  } while (job.state !== "succeeded" && job.state !== "failed" && Date.now() < deadline);
  assert.equal(job.state, "succeeded");
  assert.ok(events.some((event) => event.stage === "rendering" && event.framesDone === 1), "progress event was published");
  assert.ok(events.some((event) => event.stage === "finalising" && event.framesDone === 5), "finalising event was published");
  const full = blobs.read(job.output.sha256);
  assert.equal(full.subarray(4, 8).toString(), "ftyp", "output is a real MP4 container");
  assert.ok(full.length > 1000, `MP4 length=${full.length}`);

  const target = `/jagentchill/v1/exports/${created.jobId}/file`, ts = now(), nonce = randomBytes(16).toString("base64url");
  const unsigned = Object.assign(Readable.from([]), { method: "GET", headers: { range: "bytes=0-63" } });
  await assert.rejects(service.route(unsigned as any, new Writable({ write(_chunk, _encoding, callback) { callback(); } }) as any, target), (error: any) => error.code === "SIGNATURE_MISSING");
  const signature = signText(key.privateKey, requestCanonicalString({ gatewayId: "gateway-test", method: "GET", target, bodySha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", ts, nonce }));
  const req = Object.assign(Readable.from([]), { method: "GET", headers: { range: "bytes=0-63", [SIGNATURE_HEADERS.device]: "device-test", [SIGNATURE_HEADERS.timestamp]: String(ts), [SIGNATURE_HEADERS.nonce]: nonce, [SIGNATURE_HEADERS.signature]: signature } });
  class Response extends Writable {
    statusCode = 0; headers: Record<string, string> = {}; parts: Buffer[] = [];
    writeHead(status: number, headers: Record<string, string>) { this.statusCode = status; this.headers = headers; return this; }
    _write(chunk: Buffer, _encoding: string, callback: (error?: Error | null) => void) { this.parts.push(Buffer.from(chunk)); callback(); }
  }
  const response = new Response();
  assert.equal(await service.route(req as any, response as any, target), true);
  await once(response, "finish");
  const ranged = Buffer.concat(response.parts);
  assert.equal(response.statusCode, 206);
  assert.equal(response.headers["content-range"], `bytes 0-63/${full.length}`);
  assert.deepEqual(ranged, full.subarray(0, 64));
  assert.equal(blobs.usage(0, 0).breakdown.exports, full.length);
  console.log(`remote export fixture: mp4=${full.length} bytes sha256=${job.output.sha256}; range=${ranged.length} bytes; exports storage=${blobs.usage(0, 0).breakdown.exports} bytes`);
  await service.close();
  db.close();
});
