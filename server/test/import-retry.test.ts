import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { test } from "node:test";
import { join } from "node:path";
import { downloadToFile, type Download, type ImportNet } from "../src/tools/import.ts";
import { toolWorld } from "./support/tools.ts";

const wav = (() => {
  const bytes = Buffer.alloc(44 + 8000);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVE", 8);
  bytes.write("fmt ", 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(8000, 40);
  return bytes;
})();

test("URL media import retries transient upstream failures, follows redirects and rejects partial bodies", async () => {
  const w17 = process.env.JAGENTCHILL_SUITE_W17 === "1", port = Number(process.env.W12_FIXTURE_PORT ?? (w17 ? 19118 : 19103));
  if (w17) assert.match(process.env.W17_TEST_RUN_DIR ?? "", /^\.dev\/run-w17a-suites-green-\d+$/, "W17 fixture data must use an owned run directory");
  assert.equal(port, w17 ? 19118 : 19103, `fixture HTTP server must use the ${w17 ? "W17" : "W12-E"} assigned range`);
  let retryCalls = 0;
  const fixture = createServer((req, res) => {
    if (req.url === "/not-found") { res.writeHead(404).end(); return; }
    if (req.url === "/retry") {
      retryCalls += 1;
      if (retryCalls === 1) { res.writeHead(500).end(); return; }
    }
    if (req.url === "/redirect") { res.writeHead(302, { location: "/good" }).end(); return; }
    if (req.url === "/slow") { res.writeHead(200, { "content-type": "audio/wav", "content-length": wav.length }); res.write(wav.subarray(0, 20)); setTimeout(() => res.destroy(), 30); return; }
    if (req.url === "/truncated") { res.writeHead(200, { "content-type": "audio/wav", "content-length": wav.length + 9 }).end(wav); return; }
    if (req.url === "/wrong-type") { res.writeHead(200, { "content-type": "text/plain", "content-length": wav.length }).end(wav); return; }
    res.writeHead(200, { "content-type": "audio/wav", "content-length": wav.length }).end(wav);
  });
  await new Promise<void>((resolve, reject) => { fixture.once("error", reject); fixture.listen(port, "127.0.0.1", resolve); });
  const requests: string[] = [];
  const net: ImportNet = {
    resolve: async () => ["93.184.216.34"],
    download: async (url, _address) => new Promise<Download>((resolve, reject) => {
      requests.push(url.pathname);
      const sent = httpRequest({ host: "127.0.0.1", port, path: url.pathname, method: "GET" }, (response) => {
        const length = Number(response.headers["content-length"]);
        resolve({ status: response.statusCode ?? 0, ...(typeof response.headers.location === "string" ? { location: response.headers.location } : {}), ...(Number.isFinite(length) ? { contentLength: length } : {}), ...(typeof response.headers["content-type"] === "string" ? { mime: response.headers["content-type"] } : {}), body: response, cancel: () => response.destroy() });
      });
      sent.once("error", reject); sent.end();
    }),
  };
  const out = w17 ? join(process.env.W7_TEST_DATA_DIR!, "imports") : join(process.cwd(), ".dev/run-w12e-stream-format-media-6/imports");
  mkdirSync(out, { recursive: true });
  try {
    const recovered = await downloadToFile(net, new URL("https://fixture.example.com/retry"), "93.184.216.34", out);
    assert.deepEqual([retryCalls, recovered.size, recovered.mime, requests.slice(0, 2)], [2, wav.length, "audio/wav", ["/retry", "/retry"]]);
    const redirected = await downloadToFile(net, new URL("https://fixture.example.com/redirect"), "93.184.216.34", out);
    assert.deepEqual([redirected.finalUrl.pathname, requests.slice(-2)], ["/good", ["/redirect", "/good"]]);
    const wrongType = await downloadToFile(net, new URL("https://fixture.example.com/wrong-type"), "93.184.216.34", out);
    assert.equal(wrongType.mime, "text/plain", "the importer records upstream MIME while the media probe decides whether bytes are usable");
    const before404 = requests.length;
    await assert.rejects(downloadToFile(net, new URL("https://fixture.example.com/not-found"), "93.184.216.34", out), /answered 404/);
    assert.equal(requests.length - before404, 1, "a permanent 404 is not retried");
    const beforeSlow = requests.length;
    await assert.rejects(downloadToFile(net, new URL("https://fixture.example.com/slow"), "93.184.216.34", out), (error: unknown) => error instanceof Error && error.name === "ToolFailure");
    assert.equal(requests.length - beforeSlow, 3, "a stalled body is retried three times with bounded backoff");
    const beforeTruncated = requests.length;
    await assert.rejects(downloadToFile(net, new URL("https://fixture.example.com/truncated"), "93.184.216.34", out), (error: unknown) => error instanceof Error && error.name === "ToolFailure");
    assert.equal(requests.length - beforeTruncated, 3, "partial responses are retried with bounded backoff");
    const world = await toolWorld({ empty: true, mode: "auto", harness: { ...(process.env.W7_TEST_DATA_DIR ? { dataDir: process.env.W7_TEST_DATA_DIR, listenPort: Number(process.env.JAGENTCHILL_PORT) } : {}), extra: { toolTimings: { net } } as never } });
    try {
      const beforeAssets = world.head().media.assets.length;
      const result = await world.call("jc_media_import", { idempotencyKey: randomUUID(), source: { kind: "url", url: "https://fixture.example.com/not-found" } });
      assert.deepEqual([result.ok, result.error?.code, world.head().media.assets.length], [false, "NOT_FOUND", beforeAssets], "the actual model tool receives the failed download and creates no reusable asset id");
    } finally { world.close(); }
  } finally { await new Promise<void>((resolve) => fixture.close(() => resolve())); }
});
