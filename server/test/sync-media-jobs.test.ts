// Cross-device sync, host media jobs: the FFmpeg job queue (`media.proxy`, its thumbnail, `media.transcode`) and the
// wire-level transfer limit. The server app and the system's real ffmpeg/ffprobe run; devices are simulated
// (test/device-sim.ts). The source videos are made here with ffmpeg's own test pattern. The bandwidth test measures
// bytes on a real TCP proxy between the device and the host.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, connect, type AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { BLOB_CHUNK_BYTES, SIGNATURE_HEADERS, blobRoutes, requestCanonicalString } from "@jagentchill/protocol";
import { createHarness, type Harness } from "./harness.ts";
import { createMediaJobs } from "../src/sync/media-jobs.ts";
import { sha256Hex, support, type Paired } from "./support/sync.ts";
import { buildProject } from "./support/tools.ts";

let h: Harness, s: ReturnType<typeof support>, editor: Paired, phone: Paired, work: string;
const repoRoot = resolve(import.meta.dirname, "../..");
const runRoot = process.env.JAGENTCHILL_TEST_RUN_ROOT ? resolve(repoRoot, process.env.JAGENTCHILL_TEST_RUN_ROOT) : join(repoRoot, `.dev/run-w8r-desktop-green-${process.pid}`);
const firstPort = Number(process.env.JAGENTCHILL_PORT ?? 18955);
const proxyPort = Number(process.env.JAGENTCHILL_TEST_PROXY_PORT ?? firstPort + 4);
const make = (name: string, size: string, extra: string[] = []) => {
  const file = join(work, name);
  execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `testsrc2=size=${size}:rate=30`, "-f", "lavfi", "-i", "sine=frequency=440", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", ...extra, file]);
  return new Uint8Array(readFileSync(file));
};
const probe = (bytes: Uint8Array) => {
  const file = join(work, `probe-${randomBytes(4).toString("hex")}.mp4`);
  writeFileSync(file, bytes);
  const video = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-select_streams", "v:0", "-show_entries", "stream=width,height,codec_name,nb_frames,r_frame_rate", file]).toString()).streams[0];
  const pts = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "frame=pts_time", "-of", "csv=p=0", file]).toString().trim().split("\n").map((line) => parseFloat(line));
  return { ...video, pts };
};
before(async () => {
  work = join(runRoot, "sync-media-jobs-1/fixtures");
  mkdirSync(work, { recursive: true });
  process.env.JAGENTCHILL_PORT = String(firstPort); process.env.JAGENTCHILL_GATEWAY_PORT = String(firstPort + 1);
  h = await createHarness({ dataDir: join(runRoot, "sync-media-jobs-1"), listenPort: firstPort });
  s = support(h);
  editor = await h.pair("Laptop", "editor");
  phone = await h.pair("Phone", "editor");
});
after(async () => { await h.stop(); });

test("Scenario: Proxy generated on the server — a 1080p original uploaded without a proxy gets its preview from a media.proxy job; Scenario: Frame alignment", async () => {
  assert.equal(h.app.sync.mediaJobs.available(), true, "ffmpeg and ffprobe are configured through the required host environment variables");
  const original = make("hd.mp4", "1920x1080"), sha256 = await s.upload(editor, original, { mime: "video/mp4", name: "hd.mp4" });
  // The job was queued when the upload completed; a device that asks meanwhile is told to wait for that job.
  for (let waited = 0; !h.app.sync.mediaJobs.job(sha256, "preview") && waited < 200; waited++) await new Promise((resolve) => setTimeout(resolve, 20));
  const job = h.app.sync.mediaJobs.job(sha256, "preview")!;
  assert.deepEqual([job.kind, ["queued", "running", "succeeded"].includes(job.state)], ["media.proxy", true]);
  const following = await phone.call("jagentchill.media.job.subscribe", { jobId: job.jobId });
  assert.equal(following.job.jobId, job.jobId);
  if (h.app.sync.mediaJobs.active(sha256, "preview")) {
    const waiting = await s.send(phone, "GET", blobRoutes.variant(sha256, "preview"));
    assert.deepEqual([waiting.status, waiting.body.error.code, waiting.body.error.details.jobId, waiting.body.error.retryable], [404, "VARIANT_UNAVAILABLE", job.jobId, true]);
    assert.deepEqual(await phone.call("jagentchill.blob.variant.request", { sha256, variant: "preview" }), { state: "queued", jobId: job.jobId });
  }
  await h.app.sync.mediaJobs.idle();
  assert.equal(h.app.sync.mediaJobs.job(sha256, "preview")!.state, "succeeded", h.app.sync.mediaJobs.job(sha256, "preview")!.error);
  const followed = await phone.call("jagentchill.media.job.get", { jobId: job.jobId });
  assert.deepEqual([followed.state, followed.progress], ["succeeded", 1]);
  assert.ok(phone.events.some((entry) => entry.event === "jagentchill.media.job.updated" && entry.payload.jobId === job.jobId && entry.payload.state === "succeeded"));
  console.log("H1 item 4 job evidence:", JSON.stringify({ jobId: followed.jobId, state: followed.state, progress: followed.progress, event: "jagentchill.media.job.updated" }));
  const restoredJobs = createMediaJobs({ db: h.app.db, blobs: h.app.sync.blobs, dir: join(work, "restored-jobs"), now: Date.now, env: () => ({ JAGENTCHILL_FFMPEG: "/usr/local/bin/ffmpeg", JAGENTCHILL_FFPROBE: "/usr/local/bin/ffprobe" }) });
  assert.deepEqual([restoredJobs.get(job.jobId)?.state, restoredJobs.get(job.jobId)?.progress], ["succeeded", 1]);
  await restoredJobs.close();
  const status = (await s.send(phone, "GET", blobRoutes.status(sha256))).body;
  assert.deepEqual(Object.keys(status.variants).sort(), ["preview", "thumb"]);
  const preview = await s.send(phone, "GET", blobRoutes.variant(sha256, "preview"));
  assert.equal(sha256Hex(preview.body), status.variants.preview.sha256, "the variant is verified against the sha256 of status");
  const made = probe(preview.body), source = probe(original);
  assert.deepEqual([made.codec_name, made.width, made.height], ["h264", 1280, 720]);
  // Source timestamps are preserved: the same number of frames at the same times, so a cut at a frame boundary on the proxy is the same source frame.
  assert.equal(made.pts.length, source.pts.length);
  for (let index = 0; index < source.pts.length; index++) assert.ok(Math.abs(made.pts[index] - source.pts[index]) < 0.001, `frame ${index}: ${made.pts[index]} vs ${source.pts[index]}`);
  const thumb = await s.send(phone, "GET", blobRoutes.variant(sha256, "thumb"));
  assert.deepEqual([thumb.status, thumb.headers.get("content-type"), thumb.body[0], thumb.body[1]], [200, "image/jpeg", 0xff, 0xd8]);
  const waveformRequest = await phone.call("jagentchill.blob.variant.request", { sha256, variant: "waveform" });
  assert.equal(waveformRequest.state, "queued");
  await h.app.sync.mediaJobs.idle();
  const waveformResponse = await s.send(phone, "GET", blobRoutes.variant(sha256, "waveform"));
  const waveform = waveformResponse.body as { sampleRate: number; duration_s: number; peaks: number[] };
  assert.deepEqual([waveform.sampleRate, waveform.duration_s, waveform.peaks.length], [1000, 2, 256]);
  assert.ok(waveform.peaks.some((peak: number) => peak > 0.01), "waveform contains decoded signal peaks");
  const filmstripRequest = await phone.call("jagentchill.blob.variant.request", { sha256, variant: "filmstrip" });
  assert.equal(filmstripRequest.state, "queued");
  await h.app.sync.mediaJobs.idle();
  const sprite = await s.send(phone, "GET", blobRoutes.variant(sha256, "filmstrip"));
  assert.deepEqual([sprite.status, sprite.headers.get("content-type"), sprite.body[0], sprite.body[1]], [200, "image/jpeg", 0xff, 0xd8]);
  const filmstripTimes = await s.send(phone, "GET", blobRoutes.variant(sha256, "filmstripdata"));
  assert.equal(filmstripTimes.status, 200, JSON.stringify(filmstripTimes.body));
  assert.deepEqual((filmstripTimes.body as { frameTimes_s: number[] }).frameTimes_s, [0, 1]);
  console.log("H1 item 3 variant evidence:", JSON.stringify({ spriteBytes: sprite.body.length, spriteMime: sprite.headers.get("content-type"), frameTimes_s: filmstripTimes.body.frameTimes_s, waveformBuckets: waveform.peaks.length, waveformPeaksAbove0_01: waveform.peaks.filter((peak: number) => peak > 0.01).length, sampleRate: waveform.sampleRate, duration_s: waveform.duration_s }));
  assert.deepEqual(await phone.call("jagentchill.blob.variant.request", { sha256, variant: "preview" }), { state: "ready", ...status.variants.preview });
  assert.deepEqual((await phone.call("jagentchill.blob.get", { sha256 })).variants.sort(), ["filmstrip", "filmstripdata", "original", "preview", "thumb", "waveform"]);
  // A portrait source is fitted to 720×1280.
  const portrait = await s.upload(editor, make("portrait.mp4", "1080x1920"), { mime: "video/mp4", name: "portrait.mp4" });
  for (let waited = 0; !h.app.sync.mediaJobs.job(portrait, "preview") && waited < 200; waited++) await new Promise((resolve) => setTimeout(resolve, 20));
  await h.app.sync.mediaJobs.idle();
  const tall = probe((await s.send(phone, "GET", blobRoutes.variant(portrait, "preview"))).body);
  assert.deepEqual([tall.width, tall.height], [720, 1280]);
});

test("Scenario: Small source — a 1280×720 H.264 source gets no proxy and the original serves as the editing media", async () => {
  const sha256 = await s.upload(editor, make("small.mp4", "1280x720"), { mime: "video/mp4", name: "small.mp4" });
  for (let waited = 0; !h.app.sync.mediaJobs.job(sha256, "thumb") && waited < 200; waited++) await new Promise((resolve) => setTimeout(resolve, 20));
  await h.app.sync.mediaJobs.idle();
  assert.equal(h.app.sync.mediaJobs.job(sha256, "preview"), undefined);
  assert.deepEqual(await phone.call("jagentchill.blob.variant.request", { sha256, variant: "preview" }), { state: "not-needed", reason: "small-source" });
  assert.deepEqual(Object.keys((await s.send(phone, "GET", blobRoutes.status(sha256))).body.variants), ["thumb"]);
  const missing = await s.send(phone, "GET", blobRoutes.variant(sha256, "preview"));
  assert.deepEqual([missing.status, missing.body.error.code, missing.body.error.details], [404, "VARIANT_UNAVAILABLE", undefined]);
  // Bytes that are not media are left alone.
  const other = await s.upload(editor, randomBytes(5000), { name: "notes.bin" });
  await h.app.sync.mediaJobs.idle();
  assert.deepEqual((await s.send(phone, "GET", blobRoutes.status(other))).body.variants, {});
});

test("Scenario: Original the host cannot decode — a media.transcode job creates the mezzanine variant at source size", async () => {
  const original = make("hevc-like.mp4", "854x480"), sha256 = await s.upload(editor, original, { mime: "video/mp4", name: "source.mp4" });
  const asked = await phone.call("jagentchill.blob.variant.request", { sha256, variant: "mezzanine" });
  assert.equal(asked.state, "queued");
  assert.equal(h.app.sync.mediaJobs.job(sha256, "mezzanine")!.kind, "media.transcode");
  await h.app.sync.mediaJobs.idle();
  const made = probe((await s.send(phone, "GET", blobRoutes.variant(sha256, "mezzanine"))).body);
  assert.deepEqual([made.codec_name, made.width, made.height], ["h264", 854, 480]);
});

test("a host without FFmpeg answers FFMPEG_UNAVAILABLE and produces nothing", async () => {
  const secondPort = firstPort + 2;
  process.env.JAGENTCHILL_PORT = String(secondPort); process.env.JAGENTCHILL_GATEWAY_PORT = String(secondPort + 1);
  const bare = await createHarness({ dataDir: join(runRoot, "sync-media-jobs-2"), listenPort: secondPort, sync: { media: { env: () => ({ PATH: "/nonexistent" }) } } });
  try {
    const t = support(bare), device = await bare.pair("Laptop", "editor");
    assert.equal(bare.app.sync.mediaJobs.available(), false);
    const hostStatus = await device.call("jagentchill.settings.host.get", {});
    assert.deepEqual([hostStatus.mediaTools.available, hostStatus.mediaTools.reason], [false, "Media tools missing: ffmpeg and ffprobe are required. Install them on PATH or package both binaries in the desktop release."]);
    console.log("H1 item 1 host status evidence:", JSON.stringify(hostStatus.mediaTools));
    const sha256 = await t.upload(device, make("nofmpeg.mp4", "1920x1080"), { mime: "video/mp4", name: "x.mp4" });
    const refused = await device.fail("jagentchill.blob.variant.request", { sha256, variant: "preview" });
    assert.equal(refused.code, "FFMPEG_UNAVAILABLE");
    assert.deepEqual((await t.send(device, "GET", blobRoutes.status(sha256))).body.variants, {});
  } finally { await bare.stop(); process.env.JAGENTCHILL_PORT = String(firstPort); process.env.JAGENTCHILL_GATEWAY_PORT = String(firstPort + 1); }
});

test("device media RPCs probe uploaded bytes and import them through the project lease", async () => {
  const original = make("device-import.mp4", "320x240");
  const sha256 = await s.upload(editor, original, { mime: "video/mp4", name: "device-import.mp4", purpose: "media" });
  const facts = await phone.call("jagentchill.media.probe", { sha256 });
  assert.deepEqual(facts, { video: true, audio: true, image: false, width: 320, height: 240, duration_s: 2, codec: "h264" });
  const project = buildProject({ empty: true, name: "Remote media" });
  const doc = await s.enable(editor, project.doc);
  const assetCount = s.headDocument(doc).media.assets.length;
  const lease = await phone.call("jagentchill.sync.lease.acquire", { doc });
  let appliedBatch: any;
  let resolveRemote!: () => void;
  const remoteApplied = new Promise<void>((resolve) => { resolveRemote = resolve; });
  const applyRemote = (data: Buffer) => {
    const frame = JSON.parse(data.toString());
    if (frame.t !== "evt" || frame.event !== "jagentchill.sync.applyRemote") return;
    appliedBatch = frame.payload;
    void phone.call("jagentchill.sync.ops.push", { doc, leaseId: lease.lease.leaseId, baseRevision: frame.payload.baseRevision, ops: [{ opId: randomUUID(), created_ms: Date.now(), commandType: "media.add", label: frame.payload.label, patches: frame.payload.patches, schemaVersion: 32 }] })
      .then(() => phone.call("jagentchill.sync.applyRemote.result", { batchId: frame.payload.batchId, result: "applied" }))
      .then(resolveRemote);
  };
  phone.ws.on("message", applyRemote);
  const imported = await editor.call("jagentchill.media.import", { projectId: doc.id, sha256, name: "Phone clip.mp4" });
  await remoteApplied;
  phone.ws.off("message", applyRemote);
  await phone.call("jagentchill.sync.lease.release", { doc, leaseId: lease.lease.leaseId });
  assert.deepEqual([imported.kind, imported.name, imported.state, imported.revision], ["video", "Phone clip.mp4", "ready", 2]);
  assert.equal(appliedBatch.doc.id, doc.id, "the host used the current remote editor lease");
  const importedAsset = s.headDocument(doc).media.assets.find((asset: { contentHash: string | null }) => asset.contentHash === sha256);
  assert.deepEqual([s.headDocument(doc).media.assets.length, importedAsset?.name], [assetCount + 1, "Phone clip.mp4"]);
  console.log("H1 item 2 device RPC evidence:", JSON.stringify({ probe: facts, imported: { kind: imported.kind, name: imported.name, state: imported.state, revision: imported.revision } }));
});

test("media job RPC retains the ffmpeg failure reason", async () => {
  const brokenFfmpeg = join(work, "ffmpeg-fails");
  writeFileSync(brokenFfmpeg, "#!/bin/sh\nexit 17\n"); chmodSync(brokenFfmpeg, 0o755);
  const previousFfmpeg = process.env.JAGENTCHILL_FFMPEG;
  process.env.JAGENTCHILL_FFMPEG = brokenFfmpeg;
  try {
    const sha256 = await s.upload(editor, make("failed-waveform.mp4", "320x240"), { mime: "video/mp4", name: "failed-waveform.mp4", purpose: "snapshot" });
    const requested = await phone.call("jagentchill.blob.variant.request", { sha256, variant: "waveform" });
    assert.equal(requested.state, "queued");
    await h.app.sync.mediaJobs.idle();
    const failed = await phone.call("jagentchill.media.job.get", { jobId: requested.jobId });
    assert.equal(failed.state, "failed");
    assert.match(failed.error, /ffmpeg exited 17/);
    console.log("H1 item 4 failure evidence:", JSON.stringify({ jobId: failed.jobId, state: failed.state, reason: failed.error }));
  } finally {
    if (previousFfmpeg === undefined) delete process.env.JAGENTCHILL_FFMPEG; else process.env.JAGENTCHILL_FFMPEG = previousFfmpeg;
  }
});

test("Scenario: Bandwidth limit — with an upload limit of 5 Mbit/s the bytes measured on the wire over any 10-second window stay at or below 5.5 Mbit/s", { timeout: 120_000 }, async () => {
  // A TCP proxy between the device and the host counts every byte that travels towards the host, in 100 ms buckets.
  const hostPort = Number(new URL(h.base).port), buckets: number[] = [], started = Date.now();
  const proxy = createServer((client) => {
    const upstream = connect(hostPort, "127.0.0.1");
    client.on("data", (data) => { const at = Math.floor((Date.now() - started) / 100); buckets[at] = (buckets[at] ?? 0) + data.length; if (!upstream.write(data)) { client.pause(); upstream.once("drain", () => client.resume()); } });
    upstream.on("data", (data) => client.write(data));
    for (const [a, b] of [[client, upstream], [upstream, client]] as const) { a.on("close", () => b.destroy()); a.on("error", () => b.destroy()); }
  });
  await new Promise<void>((resolve, reject) => { proxy.once("error", reject); proxy.listen(proxyPort, "127.0.0.1", resolve); });
  const via = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
  try {
    const LIMIT = 5_000_000, bytes = randomBytes(3 * BLOB_CHUNK_BYTES), sha256 = sha256Hex(bytes);
    const send = async (method: string, target: string, body: Uint8Array, headers: Record<string, string> = {}) => {
      const ts = Date.now(), nonce = randomBytes(16).toString("base64url");
      const signature = editor.device.sign(requestCanonicalString({ gatewayId: editor.offer.gatewayId, method, target, bodySha256: sha256Hex(body), ts, nonce }));
      return fetch(via + target, { method, body: body as never, headers: { ...headers, [SIGNATURE_HEADERS.device]: editor.device.deviceId, [SIGNATURE_HEADERS.timestamp]: String(ts), [SIGNATURE_HEADERS.nonce]: nonce, [SIGNATURE_HEADERS.signature]: signature } });
    };
    assert.equal((await send("POST", blobRoutes.init(sha256), Buffer.from(JSON.stringify({ size: bytes.length, mime: "application/octet-stream", name: "limited.bin", chunkSize: BLOB_CHUNK_BYTES })))).status, 200);
    const begun = Date.now();
    // One chunk at a time, each with the limit the device asks the host to keep.
    for (let index = 0; index < 3; index++) assert.equal((await send("PUT", blobRoutes.chunk(sha256, index), bytes.subarray(index * BLOB_CHUNK_BYTES, (index + 1) * BLOB_CHUNK_BYTES), { "x-jagentchill-rate": String(LIMIT) })).status, 200);
    const seconds = (Date.now() - begun) / 1000;
    assert.equal((await send("POST", blobRoutes.complete(sha256), Buffer.from("{}"))).status, 200);
    let worst = 0;
    for (let from = 0; from < buckets.length; from++) { let sum = 0; for (let at = from; at < Math.min(buckets.length, from + 100); at++) sum += buckets[at] ?? 0; worst = Math.max(worst, (sum * 8) / 10); }
    const average = (bytes.length * 8) / seconds;
    console.log(`  upload limit 5 Mbit/s: ${(bytes.length / 2 ** 20).toFixed(0)} MiB in ${seconds.toFixed(1)} s, average ${(average / 1e6).toFixed(2)} Mbit/s, worst 10-second window ${(worst / 1e6).toFixed(2)} Mbit/s`);
    assert.ok(worst <= 5_500_000, `worst 10-second window was ${worst} bit/s`);
    assert.ok(average > 3_500_000 && average <= 5_000_000, "the limit is used, not undershot by much");

    // The download limit is kept the same way: the host writes no faster than asked.
    const down = Date.now();
    const response = await fetch(h.base + blobRoutes.bytes(sha256), { headers: { range: `bytes=0-${2 * 2 ** 20 - 1}`, "x-jagentchill-rate": "4000000", ...(() => { const ts = Date.now(), nonce = randomBytes(16).toString("base64url"); return { [SIGNATURE_HEADERS.device]: phone.device.deviceId, [SIGNATURE_HEADERS.timestamp]: String(ts), [SIGNATURE_HEADERS.nonce]: nonce, [SIGNATURE_HEADERS.signature]: phone.device.sign(requestCanonicalString({ gatewayId: phone.offer.gatewayId, method: "GET", target: blobRoutes.bytes(sha256), bodySha256: sha256Hex(new Uint8Array()), ts, nonce })) }; })() } });
    const got = new Uint8Array(await response.arrayBuffer()), took = (Date.now() - down) / 1000;
    console.log(`  download limit 4 Mbit/s: 2 MiB in ${took.toFixed(1)} s = ${((got.length * 8) / took / 1e6).toFixed(2)} Mbit/s`);
    assert.equal(got.length, 2 * 2 ** 20);
    assert.ok((got.length * 8) / took <= 4_400_000 && took > 3.5);
  } finally { proxy.close(); }
});
