// Real signed chunk-upload protocol check for P1. This starts only the local test host (never the Gateway process).
// Usage: JAGENTCHILL_PORT=18990 JAGENTCHILL_GATEWAY_PORT=18991 node apps/app/e2e/native-media-upload-host.mjs --port 18990 --data-dir .dev/run-w10p1-phone-import-1/data
import assert from "node:assert/strict";
import { createHash, sign } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createHarness } from "../../../server/test/harness.ts";
import { BLOB_CHUNK_BYTES, blobRoutes, requestCanonicalString } from "@jagentchill/protocol";
import { uploadBlob, blobStatus, signedRequest } from "@jagentchill/client";

const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
const port = Number(arg("--port")), dataDir = arg("--data-dir");
if (port < 18990 || port > 18994 || Number(process.env.JAGENTCHILL_PORT) !== port || Number(process.env.JAGENTCHILL_GATEWAY_PORT) !== port + 1 || !dataDir?.startsWith(".dev/run-w10p1-phone-import-") || !arg("--port")) throw new Error("Pass a P1 port, matching environment ports, and a fresh P1 data directory.");
mkdirSync(dataDir.slice(0, dataDir.lastIndexOf("/")), { recursive: true });
const host = await createHarness({ listenPort: port, dataDir, allowedOrigins: ["http://localhost:8089"] });
try {
  const paired = await host.pair("P1 upload test", "admin", "ios"), device = paired.device;
  const signer = {
    deviceId: device.deviceId, devicePublicKey: device.devicePublicKey,
    signHandshake: async () => { throw new Error("Handshake signing is unused in the HTTP blob test."); },
    signRequest: async (fields) => device.sign(requestCanonicalString(fields)),
  };
  const record = { gatewayId: paired.offer.gatewayId, origin: host.base, gatewayName: "P1 test host", role: "admin", gatewayPublicKey: paired.offer.gatewayPublicKey, deviceToken: { value: device.token, expires_ms: Date.now() + 60_000 }, verifiedClockOffset_ms: 0 };
  const total = 9 * 1024 * 1024 + 37, expected = new Uint8Array(total), hash = createHash("sha256");
  for (let offset = 0; offset < total; offset += 1024 * 1024) {
    const end = Math.min(total, offset + 1024 * 1024);
    for (let index = offset; index < end; index++) expected[index] = (index * 31 + 17) & 255;
    hash.update(expected.subarray(offset, end));
  }
  const sha256 = hash.digest("hex"), progress = [];
  const init = await signedRequest({ host: record, signer }, "POST", blobRoutes.init(sha256), new TextEncoder().encode(JSON.stringify({ size: total, mime: "video/mp4", name: "phone-test.mp4", chunkSize: BLOB_CHUNK_BYTES, purpose: "media" })), { "content-type": "application/json" });
  assert.equal(init.status, 200);
  const first = await signedRequest({ host: record, signer }, "PUT", blobRoutes.chunk(sha256, 0), expected.slice(0, BLOB_CHUNK_BYTES), { "content-type": "application/octet-stream" });
  assert.equal(first.status, 200);
  const result = await uploadBlob({ host: record, signer }, { sha256, size: total, mime: "video/mp4", name: "phone-test.mp4", purpose: "media", read: async (start, end) => expected.slice(start, end) }, { onProgress: (value) => progress.push(value.bytes) });
  assert.deepEqual(result, { uploaded: true, chunksSent: 2, chunksSkipped: 1 });
  assert.equal((await blobStatus({ host: record, signer }, sha256)).state, "complete");
  const partial = await signedRequest({ host: record, signer }, "GET", blobRoutes.bytes(sha256), undefined, { range: "bytes=4194304-4194403" });
  assert.equal(partial.status, 206);
  assert.deepEqual(new Uint8Array(await partial.arrayBuffer()), expected.slice(4 * 1024 * 1024, 4 * 1024 * 1024 + 100));
  const resumed = await uploadBlob({ host: record, signer }, { sha256, size: total, mime: "video/mp4", name: "phone-test.mp4", purpose: "media", read: async (start, end) => expected.slice(start, end) });
  assert.deepEqual(resumed, { uploaded: false, chunksSent: 0, chunksSkipped: 0 });
  assert.equal(progress.at(-1), total);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jpWQAAAAASUVORK5CYII=", "base64"), pngHash = createHash("sha256").update(png).digest("hex");
  await uploadBlob({ host: record, signer }, { sha256: pngHash, size: png.length, mime: "image/png", name: "host-picture.png", purpose: "media", read: async (start, end) => new Uint8Array(png.subarray(start, end)) });
  const facts = await paired.call("jagentchill.media.probe", { sha256: pngHash });
  assert.equal(facts.image, true);
  await paired.call("jagentchill.blob.variant.request", { sha256: pngHash, variant: "thumb" });
  let variantStatus;
  for (let attempt = 0; attempt < 30; attempt++) {
    variantStatus = await blobStatus({ host: record, signer }, pngHash);
    if (variantStatus.variants.thumb) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(variantStatus.variants.thumb, "host produced the thumbnail variant");
  const picture = await signedRequest({ host: record, signer }, "GET", blobRoutes.variant(pngHash, "thumb"), undefined, { range: `bytes=0-${variantStatus.variants.thumb.size - 1}` });
  assert.equal(picture.status, 206);
  assert.deepEqual(new Uint8Array(await picture.arrayBuffer()).slice(0, 2), new Uint8Array([255, 216]));
  console.log(JSON.stringify({ test: "P1 signed chunk upload and host thumbnail over real HTTP host", port, size: total, chunksSent: result.chunksSent, chunksSkipped: result.chunksSkipped, resumeAlreadyComplete: resumed.uploaded === false, rangeStatus: partial.status, progressEvents: progress.length, probeImage: facts.image, thumbBytes: variantStatus.variants.thumb.size, thumbRangeStatus: picture.status }));
} finally { host.stop(); }
