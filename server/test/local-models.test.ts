// TEST DOUBLES: the model files and the engine archive come from a local HTTP server (`support/local-models.ts`: random
// bytes with their real SHA-256, a ZIP holding `fixtures/fake-sd-cli.mjs`); the engine is that fake, which writes a real
// PNG; hardware readings are made-up computers (`fakeProbe`) except where a test reads this machine. No real model,
// engine or provider is downloaded or called. Everything else — downloads, hashing, unpacking, the generation job,
// the blob store, ffprobe, the project import — is the server's real code.
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { LOCAL_IMAGE_PROVIDER_ID, LOCAL_MODELS_CHANGED, type LocalHardware, type LocalModelsView } from "@jagentchill/protocol";
import { readHardware, verdictsOf } from "../src/local-models/hardware.ts";
import { hardLimitOf } from "../src/local-models/hard-limits.ts";
import { QWEN_IMAGE_MANIFEST, engineKey, filesOf } from "../src/local-models/manifest.ts";
import { sizeOf } from "../src/local-models/engine.ts";
import { unzip } from "../src/local-models/unzip.ts";
import { createHarness, type Harness } from "./harness.ts";
import { fakeProbe, makeZip, startModelFixture, type Fixture } from "./support/local-models.ts";

const open: Array<{ close(): unknown }> = [];
afterEach(async () => {
  for (const entry of open.splice(0).reverse()) { try { await entry.close(); } catch { /* already closed */ } }
  if (process.env.FAKE_SD_LOG) { rmSync(process.env.FAKE_SD_LOG, { force: true }); delete process.env.FAKE_SD_LOG; }
});
const GIB = 1_073_741_824;
const reading = async (probe: Parameters<typeof fakeProbe>[0]): Promise<LocalHardware> => readHardware("/models", fakeProbe(probe), 1);
const verdicts = async (probe: Parameters<typeof fakeProbe>[0], onDisk: (id: string) => boolean = () => false) => verdictsOf(await reading(probe), QWEN_IMAGE_MANIFEST, onDisk);
const pick = (rows: Awaited<ReturnType<typeof verdicts>>, variant: string, quant: string) => rows.find((row) => row.variant === variant && row.quant === quant)!;

// ---- hardware check: fake readings → verdicts ----
test("Hardware check: a Mac with 36 GB of unified memory runs every quant well, and the 8-bit is recommended", async () => {
  const rows = await verdicts({ totalGiB: 36 });
  assert.deepEqual(rows.filter((row) => row.variant === "standard").map((row) => row.verdict), ["well", "well", "well", "well"]);
  assert.equal(rows.find((row) => row.variant === "standard" && row.recommended)?.quant, "q8");
  const q4 = pick(rows, "standard", "q4");
  // The 4-bit picture model, the text encoder and the decoder, plus the working memory of one picture.
  assert.equal(q4.needs.memoryBytes, 4_197_494_816 + 5_027_784_800 + 675_509_688 + 3 * GIB);
  assert.equal(q4.downloadBytes, 36_488_395 + 4_197_494_816 + 5_027_784_800 + 675_509_688);
  assert.deepEqual(q4.reasons[0], { text: "Unified memory: {have} — this needs about {need}", params: { have: "38.7 GB", need: "13.1 GB" } });
});

test("Hardware check: a 16 GB Mac runs slowly (parts moved in turn) and the smallest quant is recommended; an 8 GB Mac has not enough memory", async () => {
  const sixteen = await verdicts({ totalGiB: 16, availableGiB: 6 });
  assert.deepEqual(sixteen.filter((row) => row.variant === "standard").map((row) => row.verdict), ["slow", "slow", "slow", "memory"]);
  assert.equal(sixteen.find((row) => row.variant === "standard" && row.recommended)?.quant, "q4");
  assert.ok(pick(sixteen, "standard", "q4").reasons.some((reason) => reason.text.startsWith("Parts of the model are kept in main memory")));
  assert.ok(pick(sixteen, "standard", "q4").reasons.some((reason) => reason.text.includes("close other apps")), "6 GB free now is said");
  const eight = await verdicts({ totalGiB: 8 });
  assert.deepEqual(eight.map((row) => row.verdict), Array(8).fill("memory"));
  assert.equal(eight.some((row) => row.recommended), false);
});

test("Hardware check: an NVIDIA card is read from nvidia-smi — 12 GB runs well (the text encoder leaves the card), 8 GB runs slowly", async () => {
  const twelve = await reading({ platform: "linux", arch: "x64", totalGiB: 32, nvidia: { name: "NVIDIA GeForce RTX 4070", totalMiB: 12282, freeMiB: 11800 } });
  assert.deepEqual(twelve.gpu, { kind: "nvidia", name: "NVIDIA GeForce RTX 4070", vramBytes: 12282 * 1_048_576, vramFreeBytes: 11800 * 1_048_576, driver: "560.94" });
  const rows = verdictsOf(twelve, QWEN_IMAGE_MANIFEST, () => false);
  assert.deepEqual(rows.filter((row) => row.variant === "uncensored").map((row) => row.verdict), ["well", "well", "well", "well"]);
  assert.equal(pick(rows, "standard", "q4").needs.vramBytes, 5_027_784_800 + 675_509_688 + 3 * GIB);
  assert.equal(engineKey("linux", "x64", true), "linux-x64-vulkan");
  assert.equal(pick(rows, "standard", "q4").downloadBytes, 36_612_523 + 4_197_494_816 + 5_027_784_800 + 675_509_688, "the Vulkan build is the one downloaded on Linux with an NVIDIA card");
  const eight = await verdicts({ platform: "win32", arch: "x64", totalGiB: 32, nvidia: { name: "NVIDIA GeForce RTX 3060 Ti", totalMiB: 8192, freeMiB: 7000 } });
  assert.deepEqual(eight.filter((row) => row.variant === "standard").map((row) => row.verdict), ["slow", "slow", "slow", "slow"]);
  assert.equal(pick(eight, "standard", "q4").downloadBytes, 343_630_973 + 563_452_046 + 4_197_494_816 + 5_027_784_800 + 675_509_688, "Windows + NVIDIA: the CUDA build and its runtime");
});

test("Hardware check: no graphics processor runs slowly on the processor; not enough disk; no engine build for the computer", async () => {
  const cpu = await verdicts({ platform: "linux", arch: "x64", totalGiB: 32, cpu: "AMD Ryzen 9" });
  assert.deepEqual(cpu.filter((row) => row.variant === "standard").map((row) => row.verdict), ["slow", "slow", "slow", "slow"]);
  assert.ok(pick(cpu, "standard", "q4").reasons[0]!.text.startsWith("No supported graphics processor"));
  const disk = await verdicts({ totalGiB: 64, freeDiskBytes: 5e9 });
  assert.equal(pick(disk, "standard", "q4").verdict, "disk");
  assert.deepEqual(pick(disk, "standard", "q4").reasons.at(-1), { text: "Free disk: {have} — the download needs {need}", params: { have: "5.0 GB", need: "11.0 GB" } });
  const arm = await verdicts({ platform: "linux", arch: "arm64", totalGiB: 64 });
  assert.deepEqual([...new Set(arm.map((row) => row.verdict))], ["unsupported"]);
  // An Intel Mac gets the universal macOS build and runs on the processor.
  const intel = await verdicts({ platform: "darwin", arch: "x64", totalGiB: 32, cpu: "Intel Core i9" });
  assert.equal(pick(intel, "standard", "q4").verdict, "slow");
});

test("Hardware check: files another variant already downloaded are not counted again", async () => {
  const shared = new Set(["llm-qwen3vl-8b-q4km", "vae-qwen-image-2.1", ...filesOf(QWEN_IMAGE_MANIFEST, "standard", "q4", "darwin").filter((file) => file.role === "engine").map((file) => file.id)]);
  const rows = await verdicts({ totalGiB: 36 }, (id) => shared.has(id));
  assert.equal(pick(rows, "uncensored", "q4").remainingBytes, 4_604_558_112);
  assert.equal(pick(rows, "uncensored", "q4").downloadBytes, 36_488_395 + 4_604_558_112 + 5_027_784_800 + 675_509_688);
});

test("Hardware check of this machine reads real numbers (nothing is downloaded)", async () => {
  const { systemProbe } = await import("../src/local-models/hardware.ts");
  const hardware = await readHardware(tmpdir(), systemProbe, Date.now());
  assert.ok(hardware.memory.totalBytes > GIB && hardware.disk.freeBytes > 0 && hardware.cpu.cores > 0);
  if (process.platform === "darwin" && process.arch === "arm64") assert.equal(hardware.gpu.kind, "apple");
});

// ---- hard limits ----
test("Hard limits: sexual content involving minors and sexual content of identifiable real people are refused; everything else is allowed", () => {
  for (const prompt of ["nude teen girl on a beach", "sexy schoolgirl in uniform", "naked 15 year old", "erotic photo, she is 16yo", "khỏa thân bé gái", "ヌード 少女", "lewd loli"]) assert.equal(hardLimitOf({ prompt })?.rule, "minor", prompt);
  for (const prompt of ["nude photo of a famous actress", "deepfake porn of my ex", "naked celebrity at the Oscars", "sexy picture of my coworker", "ảnh khỏa thân diễn viên"]) assert.equal(hardLimitOf({ prompt })?.rule, "real_person", prompt);
  assert.equal(hardLimitOf({ prompt: "an erotic painting of a woman", references: 1 })?.rule, "real_person", "sexual content drawn from a reference picture is of a real person");
  for (const prompt of ["a nude adult woman reclining, oil painting", "explicit erotic art of two adults", "a child flying a kite in a park", "portrait of a famous actress on the red carpet", "a kidney bean sexy font logo", "Sussex countryside at dawn", "a teenage mutant turtle comic, action"]) assert.equal(hardLimitOf({ prompt }), undefined, prompt);
});

// ---- unzip ----
test("Unzip: entries are unpacked with their permissions, and a name outside the folder is refused", async () => {
  const dir = join(tmpdir(), `w24a-unzip-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  writeFileSync(`${dir}.zip`, makeZip([{ name: "bin/sd-cli", data: Buffer.from("#!/bin/sh\necho hi\n"), mode: 0o755 }, { name: "README.txt", data: Buffer.alloc(50_000, 7) }]));
  assert.deepEqual((await unzip(`${dir}.zip`, dir)).sort(), ["README.txt", "bin/sd-cli"]);
  assert.equal(readFileSync(join(dir, "README.txt")).length, 50_000);
  if (process.platform !== "win32") assert.ok((await import("node:fs")).statSync(join(dir, "bin/sd-cli")).mode & 0o100);
  writeFileSync(`${dir}-evil.zip`, makeZip([{ name: "../evil.txt", data: Buffer.from("x") }]));
  await assert.rejects(unzip(`${dir}-evil.zip`, dir), /outside its folder/);
  rmSync(dir, { recursive: true, force: true }); rmSync(`${dir}.zip`); rmSync(`${dir}-evil.zip`);
});

test("Picture sizes: about one megapixel at 1024 px, sides multiples of 32, smaller with the host's setting", () => {
  assert.deepEqual(sizeOf("1:1", 1024), { width: 1024, height: 1024 });
  assert.deepEqual(sizeOf("16:9", 1024), { width: 1344, height: 768 });
  assert.deepEqual(sizeOf("16:9", 768), { width: 1024, height: 576 });
  assert.deepEqual(sizeOf("1:1", 512), { width: 512, height: 512 });
  assert.deepEqual(sizeOf("3:4", 512), { width: 448, height: 608 });
});

// ---- downloads and generation on a server ----
async function world(opts: { probe?: Parameters<typeof fakeProbe>[0]; dataDir?: string; fixture?: Fixture; bundledEngine?: string } = {}) {
  const fixture = opts.fixture ?? await startModelFixture();
  if (!opts.fixture) open.push(fixture);
  const h = await createHarness({ ...(opts.dataDir ? { dataDir: opts.dataDir } : {}), extra: { localModels: { ...(opts.bundledEngine ? { bundledEngine: opts.bundledEngine } : {}), manifest: fixture.manifest, probe: fakeProbe(opts.probe ?? { totalGiB: 36 }), timings: { retryDelaysMs: [20, 40, 80], stallMs: 2000, changedMs: 10 } } } });
  open.push(h);
  const admin = await h.pair("Studio Mac", "admin");
  const get = async (): Promise<LocalModelsView> => (await admin.call("jagentchill.localModels.get", {})).view;
  const until = async (test: (view: LocalModelsView) => boolean, what: string, ms = 15_000): Promise<LocalModelsView> => {
    const end = Date.now() + ms;
    for (;;) { const view = await get(); if (test(view)) return view; if (Date.now() > end) throw new Error(`timed out waiting for ${what}: ${JSON.stringify(view.installs)}`); await new Promise((resolve) => setTimeout(resolve, 25)); }
  };
  const install = (variant = "standard") => (view: LocalModelsView) => view.installs.find((entry) => entry.variant === variant);
  return { h, admin, fixture, get, until, install };
}
const folderOf = (h: Harness) => join(h.dataDir, "models");

test("Download: the hardware check comes first, every file is downloaded, verified by hash and the engine unpacked; the model is ready and its state survives a restart", async () => {
  const w = await world();
  const before = await w.get();
  assert.equal(before.folder, folderOf(w.h));
  assert.deepEqual([before.installs, before.verdicts.length, before.hardware?.gpu.kind, before.engine.build?.label], [[], 8, "apple", "Test engine (darwin)"]);
  const started = await w.admin.call("jagentchill.localModels.download", { variant: "standard", quant: "q4" });
  assert.equal(started.view.installs[0].state, "downloading");
  const ready = await w.until((view) => w.install()(view)?.state === "installed", "installed");
  const done = w.install()(ready)!;
  assert.deepEqual([done.quant, done.modelId, done.bytesDone === done.bytesTotal, done.files.map((file) => file.state)], ["q4", "qwen-image-2.1", true, ["done", "done", "done", "done"]]);
  assert.ok(existsSync(join(folderOf(w.h), "engine/test/darwin/bin/sd-cli")), "the engine archive was unpacked");
  assert.ok(w.admin.events.some((event: { event: string; payload: any }) => event.event === LOCAL_MODELS_CHANGED && event.payload.view.installs.length === 1), "screens are told of the download");
  assert.ok(existsSync(join(folderOf(w.h), "qwen-image-2.1/standard/q4.gguf")) && !existsSync(join(folderOf(w.h), "qwen-image-2.1/standard/q4.gguf.part")));
  assert.equal(w.fixture.requests.filter((request) => request.path === "/standard-q8.gguf").length, 0, "only the chosen quant is downloaded");
  // The generation catalogue: the provider is connected, its Standard model on, the Uncensored one not installed.
  const providers = (await w.admin.call("jagentchill.provider.list", {})).providers;
  const local = providers.find((provider: any) => provider.id === LOCAL_IMAGE_PROVIDER_ID);
  assert.deepEqual([local.label, local.source, local.connection, local.health, local.limits.maxConcurrent.image, local.sendingNote, local.sends], ["Local · Qwen-Image-2.1", "local", "connected", "ready", 1, "Nothing is sent anywhere: pictures are made on this computer", []]);
  const models = (await w.admin.call("jagentchill.provider.model.list", { providerId: LOCAL_IMAGE_PROVIDER_ID })).models;
  assert.deepEqual(models.map((model: any) => [model.id, model.enabled, model.pricing.kind]), [["qwen-image-2.1", true, "free"], ["qwen-image-2.1-uncensored", false, "free"]]);
  // A restart: the install is still there, ready.
  const dataDir = w.h.dataDir;
  await w.h.stop?.();
  const again = await world({ dataDir, fixture: w.fixture });
  assert.equal(w.install()(await again.get())?.state, "installed");
  assert.equal((await again.admin.call("jagentchill.provider.list", {})).providers.find((provider: any) => provider.id === LOCAL_IMAGE_PROVIDER_ID).connection, "connected");
});

test("Download over a flaky network: a broken connection is resumed with a Range request; a server that ignores the range starts the file over", async () => {
  const w = await world();
  w.fixture.faults.cutAfter = { "/llm.gguf": 100_000 };
  await w.admin.call("jagentchill.localModels.download", { variant: "standard", quant: "q4" });
  await w.until((view) => w.install()(view)?.state === "installed", "installed after a cut");
  const llm = w.fixture.requests.filter((request) => request.path === "/llm.gguf");
  assert.equal(llm.length, 2);
  assert.match(llm[1]!.range ?? "", /^bytes=\d+-$/, "the second request asks for the rest only");
  assert.ok(Number(/=(\d+)-/.exec(llm[1]!.range!)![1]) > 0);
  // Ignored range: the same file comes whole and is written from the start — and still matches its hash.
  w.fixture.faults.cutAfter = { "/uncensored-q4.gguf": 50_000 };
  w.fixture.faults.ignoreRange = true;
  await w.admin.call("jagentchill.localModels.download", { variant: "uncensored", quant: "q4" });
  await w.until((view) => w.install("uncensored")(view)?.state === "installed", "installed with a server that ignores ranges");
  assert.equal(w.fixture.requests.filter((request) => request.path === "/llm.gguf").length, 2, "the text encoder both variants use is downloaded once");
});

test("Download: a file whose hash does not match is downloaded again once, and a second mismatch fails the download without keeping the file", async () => {
  const w = await world();
  w.fixture.faults.corrupt = new Set(["/vae.safetensors"]);
  await w.admin.call("jagentchill.localModels.download", { variant: "standard", quant: "q4" });
  await w.until((view) => w.install()(view)?.state === "installed", "installed after one damaged copy");
  assert.equal(w.fixture.requests.filter((request) => request.path === "/vae.safetensors").length, 2);
  await w.admin.call("jagentchill.localModels.remove", { variant: "standard" });
  // Damaged twice: failed, said in product words; nothing of it is kept.
  w.fixture.faults.corruptTimes = { "/vae.safetensors": 2 };
  await w.admin.call("jagentchill.localModels.download", { variant: "standard", quant: "q4" });
  const failed = await w.until((view) => w.install()(view)?.state === "failed", "failed");
  assert.deepEqual(w.install()(failed)!.error, { code: "hash_mismatch", message: "A downloaded file is damaged (its checksum does not match). It was removed. Press Resume to download it again." });
  assert.ok(!existsSync(join(folderOf(w.h), "qwen-image-2.1/shared/vae.safetensors")) && !existsSync(join(folderOf(w.h), "qwen-image-2.1/shared/vae.safetensors.part")));
  w.fixture.faults.corrupt = new Set();
  await w.admin.call("jagentchill.localModels.resume", { variant: "standard" });
  await w.until((view) => w.install()(view)?.state === "installed", "installed after Resume");
});

test("Download: pause keeps the partial file, resume continues it from where it stopped — also after the host restarted; cancel deletes what it brought", async () => {
  const w = await world();
  w.fixture.faults.slow = new Set(["/llm.gguf"]);
  await w.admin.call("jagentchill.localModels.download", { variant: "standard", quant: "q4" });
  await w.until((view) => (w.install()(view)?.files.find((file) => file.id === "llm")?.doneBytes ?? 0) > 20_000, "the text encoder half way");
  await w.admin.call("jagentchill.localModels.pause", { variant: "standard" });
  const paused = await w.until((view) => w.install()(view)?.state === "paused", "paused");
  const part = w.install()(paused)!.files.find((file) => file.id === "llm")!.doneBytes;
  assert.ok(part > 0 && existsSync(join(folderOf(w.h), "qwen-image-2.1/shared/llm.gguf.part")));
  // The host restarts while paused: the partial file and the state are still there.
  const dataDir = w.h.dataDir;
  await w.h.stop?.();
  w.fixture.faults.slow = new Set();
  const again = await world({ dataDir, fixture: w.fixture });
  assert.equal(w.install()(await again.get())?.state, "paused");
  await again.admin.call("jagentchill.localModels.resume", { variant: "standard" });
  await again.until((view) => w.install()(view)?.state === "installed", "installed after resume");
  assert.match(w.fixture.requests.filter((request) => request.path === "/llm.gguf").at(-1)!.range ?? "", /^bytes=\d+-$/);
  // Cancel: the Uncensored download stops and its picture model (only it uses) goes; the shared files stay for Standard.
  w.fixture.faults.slow = new Set(["/uncensored-q4.gguf"]);
  await again.admin.call("jagentchill.localModels.download", { variant: "uncensored", quant: "q4" });
  await again.until((view) => (w.install("uncensored")(view)?.bytesDone ?? 0) > 0, "uncensored started");
  await again.admin.call("jagentchill.localModels.cancel", { variant: "uncensored" });
  const after = await again.get();
  assert.equal(w.install("uncensored")(after), undefined);
  assert.ok(!readdirSync(join(again.h.dataDir, "models/qwen-image-2.1")).includes("uncensored") || readdirSync(join(again.h.dataDir, "models/qwen-image-2.1/uncensored")).length === 0);
  assert.ok(existsSync(join(again.h.dataDir, "models/qwen-image-2.1/shared/llm.gguf")));
});

test("Verify and remove: a damaged file is found by Verify; Remove deletes only what no other variant uses; a quant switch keeps the old one serving until the new one is ready", async () => {
  const w = await world();
  await w.admin.call("jagentchill.localModels.download", { variant: "standard", quant: "q4" });
  await w.until((view) => w.install()(view)?.state === "installed", "standard installed");
  await w.admin.call("jagentchill.localModels.download", { variant: "uncensored", quant: "q4" });
  await w.until((view) => w.install("uncensored")(view)?.state === "installed", "uncensored installed");
  assert.equal((await w.admin.call("jagentchill.localModels.verify", { variant: "standard" })).ok, true);
  writeFileSync(join(folderOf(w.h), "qwen-image-2.1/standard/q4.gguf"), Buffer.alloc(10));
  const verified = await w.admin.call("jagentchill.localModels.verify", { variant: "standard" });
  assert.deepEqual([verified.ok, verified.damaged, w.install()(verified.view)?.state, w.install()(verified.view)?.error?.code], [false, ["Picture model (Q4)"], "failed", "hash_mismatch"]);
  await w.admin.call("jagentchill.localModels.resume", { variant: "standard" });
  await w.until((view) => w.install()(view)?.state === "installed", "standard installed again");
  // Switch Standard to 8-bit: the 4-bit keeps serving while the 8-bit downloads, then it is removed.
  w.fixture.faults.slow = new Set(["/standard-q8.gguf"]);
  await w.admin.call("jagentchill.localModels.download", { variant: "standard", quant: "q8" });
  await w.until((view) => w.install()(view)?.quant === "q8" && w.install()(view)?.state === "downloading", "q8 downloading");
  assert.equal(w.h.app.localModels.adapter.ready!("qwen-image-2.1"), true, "the installed 4-bit still serves");
  w.fixture.faults.slow = new Set();
  await w.until((view) => w.install()(view)?.state === "installed" && w.install()(view)?.quant === "q8", "q8 installed", 30_000);
  assert.ok(!existsSync(join(folderOf(w.h), "qwen-image-2.1/standard/q4.gguf")) && existsSync(join(folderOf(w.h), "qwen-image-2.1/standard/q8.gguf")));
  // Remove Uncensored: its picture model goes; the shared files stay for Standard. Remove Standard: everything goes.
  await w.admin.call("jagentchill.localModels.remove", { variant: "uncensored" });
  assert.ok(!existsSync(join(folderOf(w.h), "qwen-image-2.1/uncensored/q4.gguf")) && existsSync(join(folderOf(w.h), "qwen-image-2.1/shared/llm.gguf")) && existsSync(join(folderOf(w.h), "engine/test/darwin/bin/sd-cli")));
  await w.admin.call("jagentchill.localModels.remove", { variant: "standard" });
  assert.ok(!existsSync(join(folderOf(w.h), "qwen-image-2.1/shared/llm.gguf")) && !existsSync(join(folderOf(w.h), "engine/test/darwin")));
  assert.equal((await w.admin.call("jagentchill.provider.list", {})).providers.find((provider: any) => provider.id === LOCAL_IMAGE_PROVIDER_ID).connection, "not_connected");
});

test("Download is refused before it starts when the check says it cannot run: not enough memory, not enough disk", async () => {
  const small = await world({ probe: { totalGiB: 1 } });
  const refused = await small.admin.fail("jagentchill.localModels.download", { variant: "standard", quant: "q8" });
  assert.deepEqual([refused.code, refused.details.reason], ["UNAVAILABLE", "memory"]);
  const full = await world({ probe: { totalGiB: 36, freeDiskBytes: 100_000 } });
  assert.equal((await full.admin.fail("jagentchill.localModels.download", { variant: "standard", quant: "q4" })).details.reason, "disk");
  assert.equal(small.fixture.requests.length + full.fixture.requests.length, 0, "nothing was downloaded");
  // A viewer may read the check, not download.
  const viewer = await full.h.pair("Phone", "viewer");
  assert.equal((await viewer.call("jagentchill.localModels.get", {})).view.verdicts.length, 8);
  assert.equal((await viewer.fail("jagentchill.localModels.download", { variant: "standard", quant: "q4" })).code, "SCOPE_DENIED");
});

// ---- generation on the host: the provider, ORC, a full job ----
const LOCAL = LOCAL_IMAGE_PROVIDER_ID, STANDARD = "qwen-image-2.1";
/** Each call of the fake engine (its argv), from the log it appends to. */
function engineLog(): { file: string; calls(): string[][] } {
  const file = join(tmpdir(), `w24a-engine-${process.pid}-${Math.random().toString(36).slice(2)}.log`);
  process.env.FAKE_SD_LOG = file;
  return { file, calls: () => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]) : []) };
}
const flagOf = (argv: string[], name: string) => argv[argv.indexOf(name) + 1];
async function installed(w: Awaited<ReturnType<typeof world>>, variant = "standard") {
  await w.admin.call("jagentchill.localModels.download", { variant, quant: "q4" });
  await w.until((view) => w.install(variant)(view)?.state === "installed", `${variant} installed`);
}

test("Local provider before any download: listed, not connected, its models off; a request for it has no route and nothing runs", async () => {
  const w = await world();
  const listed = (await w.admin.call("jagentchill.provider.list", {})).providers;
  assert.deepEqual(listed.map((provider: any) => [provider.id, provider.connection]), [["openrouter", "not_connected"], [LOCAL, "not_connected"]]);
  assert.equal((await w.admin.call("jagentchill.provider.list", {})).capabilities.find((entry: any) => entry.capability === "image").available, false);
  assert.equal((await w.admin.fail("jagentchill.generation.create", { capability: "image", provider: LOCAL, model: STANDARD, params: { prompt: "a lighthouse" } })).code, "NO_ROUTE");
});

test("A person's picture on the local model: the engine runs on the host with the request's size, seed and steps, one job at a time; the picture is stored with model, prompt and seed; free, nothing asked", async () => {
  const w = await world(), log = engineLog();
  await installed(w);
  // On Apple graphics the default picture is the small one (1024 px took more than 25 min on an M1 Pro); this test asks for the large one.
  assert.equal((await w.get()).settings.maxSide, 512);
  await w.admin.call("jagentchill.localModels.settings.set", { maxSide: 1024 });
  assert.equal((await w.admin.call("jagentchill.provider.list", {})).capabilities.find((entry: any) => entry.capability === "image").available, true);
  const first = (await w.admin.call("jagentchill.generation.create", { capability: "image", provider: LOCAL, model: STANDARD, params: { prompt: "a lighthouse at dusk", aspectRatio: "16:9", seed: 7 } })).job;
  const second = (await w.admin.call("jagentchill.generation.create", { capability: "image", provider: LOCAL, model: STANDARD, params: { prompt: "a fishing boat", quality: "low" } })).job;
  assert.deepEqual([first.estimateUsd, second.state, second.queuePosition], [0, "queued", 1], "free, and the second waits for the first");
  const done = await w.h.app.generation.settled(first.jobId), other = await w.h.app.generation.settled(second.jobId);
  assert.deepEqual([done.state, done.actualUsd, done.results.length, other.state], ["succeeded", 0, 1, "succeeded"]);
  const picture = done.results[0];
  assert.deepEqual([picture.kind, picture.mime, picture.width, picture.height], ["image", "image/png", 1344, 768]);
  assert.deepEqual([picture.provenance.provider, picture.provenance.model, picture.provenance.prompt, picture.provenance.seed, picture.provenance.cost], [LOCAL, STANDARD, "a lighthouse at dusk", 7, { amount: 0, currency: "USD" }]);
  assert.equal(typeof other.results[0].provenance.seed, "number", "a seed the request did not name is the one the engine was given, recorded");
  assert.equal(w.h.app.sync.blobs.status(picture.blobId).state, "complete");
  const [argv, argvLow] = log.calls();
  assert.deepEqual([flagOf(argv!, "-W"), flagOf(argv!, "-H"), flagOf(argv!, "-s"), flagOf(argv!, "--steps"), flagOf(argv!, "-p"), argv!.includes("--offload-to-cpu")], ["1344", "768", "7", "20", "a lighthouse at dusk", false]);
  assert.ok(flagOf(argv!, "--diffusion-model")!.endsWith("qwen-image-2.1/standard/q4.gguf") && flagOf(argv!, "--llm")!.endsWith("shared/llm.gguf") && flagOf(argv!, "--vae")!.endsWith("shared/vae.safetensors"));
  assert.equal(flagOf(argvLow!, "--steps"), "12", "quality low: fewer steps");
  // The host's picture size setting: 768 px.
  await w.admin.call("jagentchill.localModels.settings.set", { maxSide: 768 });
  const small = await w.h.app.generation.settled((await w.admin.call("jagentchill.generation.create", { capability: "image", provider: LOCAL, model: STANDARD, params: { prompt: "a gull", aspectRatio: "1:1" } })).job.jobId);
  assert.deepEqual([small.results[0].width, small.results[0].height], [768, 768]);
  const rows = w.h.app.generation.ledgerRows().filter((row) => row.provider === LOCAL);
  assert.deepEqual([rows.length, rows.every((row) => row.actual_usd === 0 && row.outcome === "succeeded")], [3, true]);
  rmSync(log.file, { force: true });
});

test("Local failures in product words: out of memory says to choose a smaller quant or picture size and is not retried; a hard limit refuses before the engine starts; cancel stops the engine", async () => {
  const w = await world(), log = engineLog();
  await installed(w);
  const oom = await w.h.app.generation.settled((await w.admin.call("jagentchill.generation.create", { capability: "image", provider: LOCAL, model: STANDARD, params: { prompt: "FAKE_OOM a castle" } })).job.jobId);
  assert.deepEqual([oom.state, oom.error?.class, oom.error?.message, oom.attempts.length], ["failed", "out_of_memory", "This computer ran out of memory for this picture. Choose a smaller quant or picture size under Settings, Providers, Generation, Local models", 1]);
  assert.match(String(oom.error?.details?.providerMessage), /out of memory/);
  const engineRuns = log.calls().length;
  const refused = await w.h.app.generation.settled((await w.admin.call("jagentchill.generation.create", { capability: "image", provider: LOCAL, model: STANDARD, params: { prompt: "nude schoolgirl" } })).job.jobId);
  assert.deepEqual([refused.state, refused.error?.class, refused.error?.details?.rule, log.calls().length], ["failed", "content_blocked", "minor", engineRuns], "refused silently: no question, the engine never started");
  const slow = (await w.admin.call("jagentchill.generation.create", { capability: "image", provider: LOCAL, model: STANDARD, params: { prompt: "FAKE_SLOW a meadow" } })).job;
  for (let i = 0; i < 100 && log.calls().length === engineRuns; i++) await new Promise((resolve) => setTimeout(resolve, 20));
  const cancelled = (await w.admin.call("jagentchill.job.cancel", { jobId: slow.jobId })).job;
  assert.equal(cancelled.state, "cancelled");
  assert.ok(!cancelled.warnings.includes("The provider can still bill this request"));
  rmSync(log.file, { force: true });
});

test("The engine runner: a time limit stops a picture that takes too long, said as such", async () => {
  const { runEngine } = await import("../src/local-models/engine.ts");
  const dir = join(tmpdir(), `w24a-engine-${process.pid}`), program = join(dir, "bin", "sd-cli");
  await unzip(await (async () => { const zip = `${dir}.zip`; writeFileSync(zip, makeZip([{ name: "bin/sd-cli", data: readFileSync(join(import.meta.dirname, "fixtures", "fake-sd-cli.mjs")), mode: 0o755 }])); return zip; })(), dir);
  const job = { program, files: { diffusion: "d", llm: "l", vae: "v" }, negativePrompt: "blur", width: 256, height: 256, steps: 3, seed: 1, offload: true, workDir: join(dir, "work"), progress: () => undefined };
  await assert.rejects(runEngine({ ...job, prompt: "FAKE_SLOW", timeoutMs: 400, signal: new AbortController().signal }), (error: any) => error.class === "timeout" && /time limit/.test(error.message));
  const steps: number[] = [];
  const png = await runEngine({ ...job, prompt: "a cat", timeoutMs: 10_000, signal: new AbortController().signal, progress: (fraction) => steps.push(fraction) });
  assert.deepEqual([png[0], png[1], png[2], png[3]], [0x89, 0x50, 0x4e, 0x47]);
  assert.ok(steps.at(-1)! > 0.9 && steps.length >= 3, "progress follows the sampler's steps");
  rmSync(dir, { recursive: true, force: true }); rmSync(`${dir}.zip`, { force: true });
});

test("ORC: a profile of the Image role names the local model; a request that names no model runs on it; while the model is not downloaded the profile cannot serve", async () => {
  const w = await world(), log = engineLog();
  const state = await w.admin.call("jagentchill.orc.config.get", {});
  const role = { image: { enabled: true, profiles: [{ id: "local", label: "On this computer", provider: LOCAL, model: STANDARD, params: { quality: "low" }, enabled: true }], defaultProfileId: "local", routes: { default: { primary: { profileId: "local" }, fallbacks: [] } }, limits: {} } };
  const checked = await w.admin.call("jagentchill.orc.config.validate", { config: { ...state.config, roles: role } });
  assert.ok(!checked.issues.some((issue: any) => issue.level === "error"), JSON.stringify(checked.issues));
  assert.ok(checked.issues.some((issue: any) => issue.code === "unverified"), "not downloaded yet: said, not an error");
  await w.admin.call("jagentchill.orc.config.update", { expectedRevision: state.revision, patch: { roles: role } });
  const none = await w.admin.fail("jagentchill.generation.create", { capability: "image", params: { prompt: "a harbour" } });
  assert.deepEqual([none.code, none.details.reason], ["NO_ROUTE", "orc_route_unusable"]);
  await installed(w);
  const job = await w.h.app.generation.settled((await w.admin.call("jagentchill.generation.create", { capability: "image", params: { prompt: "a harbour" } })).job.jobId);
  assert.deepEqual([job.state, job.provider, job.model, job.params.quality], ["succeeded", LOCAL, STANDARD, "low"], "the role's profile decides, with its options");
  assert.equal(flagOf(log.calls().at(-1)!, "--steps"), "12");
  rmSync(log.file, { force: true });
});

test("Generated outputs become media assets: an agent's jc_generate_image runs on the local model and the picture is imported into the project with model, prompt and seed", async () => {
  const fixture = await startModelFixture();
  open.push(fixture);
  const { toolWorld } = await import("./support/tools.ts");
  const w = await toolWorld({ harness: { extra: { localModels: { manifest: fixture.manifest, probe: fakeProbe({ totalGiB: 36 }), timings: { retryDelaysMs: [20], stallMs: 2000, changedMs: 10 } } } } });
  open.push(w.h);
  engineLog();
  await w.admin.call("jagentchill.localModels.download", { variant: "standard", quant: "q4" });
  for (let i = 0; i < 300; i++) { const view = (await w.admin.call("jagentchill.localModels.get", {})).view as LocalModelsView; if (view.installs[0]?.state === "installed") break; await new Promise((resolve) => setTimeout(resolve, 25)); }
  // A picture made on this computer takes minutes: the call answers at once (no runtime's tool-call limit can cut it),
  // and the picture arrives in the media library by itself.
  const made = await w.ok("jc_generate_image", { prompt: "a red kite over the sea", aspectRatio: "1:1" });
  assert.deepEqual([made.data.state, made.data.costUsd, made.data.model, made.data.provider], ["making", 0, STANDARD, LOCAL]);
  // Asked how it is going, the agent reads the job's real state: percent, time so far, queue — and only its own session's jobs.
  const status = await w.ok("jc_generation_status", { jobId: made.data.jobId });
  assert.ok(["queued", "running", "succeeded"].includes(status.data.state), status.data.state);
  assert.deepEqual([status.data.jobId, status.data.capability, typeof status.data.percent, typeof status.data.elapsedSeconds], [made.data.jobId, "image", "number", "number"]);
  assert.equal((await w.fails("jc_generation_status", { jobId: "job_not_this_session" })).code, "NOT_FOUND");
  let asset: any;
  for (let i = 0; i < 300 && !asset; i++) { asset = (w.head().media.assets as any[]).find((entry) => entry.provenance?.jobId === made.data.jobId); if (!asset) await new Promise((resolve) => setTimeout(resolve, 20)); }
  assert.ok(asset, "the picture was added to the media library");
  const finished = await w.ok("jc_generation_status", { jobId: made.data.jobId });
  assert.deepEqual([finished.data.state, finished.data.percent], ["succeeded", 100]);
  assert.deepEqual((await w.ok("jc_generation_status", {})).data.jobs, []);
  // 512 px: the default picture on Apple graphics (the fake probe is an Apple Mac).
  assert.equal(asset.width, 512);
  assert.deepEqual([asset.type, asset.provenance.source, asset.provenance.provider, asset.provenance.model, asset.provenance.prompt, typeof asset.provenance.seed, asset.provenance.jobId], ["image", "ai", LOCAL, STANDARD, "a red kite over the sea", "number", made.data.jobId]);
  // The composer's switch "make pictures on this computer" is a session feature value; it accepts on/off only, and an
  // agent's picture of that session goes to the local model.
  assert.equal((await w.admin.call("jagentchill.session.control.set", { sessionKey: w.sessionKey, features: { local_image: true } })).applied.featureValues.local_image, true);
  const switched = await w.ok("jc_generate_image", { prompt: "a paper boat", aspectRatio: "1:1" });
  assert.equal(switched.data.provider, LOCAL);
  assert.equal((await w.admin.fail("jagentchill.session.control.set", { sessionKey: w.sessionKey, features: { local_image: "yes" } })).code, "INVALID_PARAMS");
  rmSync(process.env.FAKE_SD_LOG!, { force: true });
});


// The published macOS engine is built for macOS 26 and does not start on macOS 14 (seen on the owner's Mac, 2026-10-19):
// the macOS app ships its own build, and then only the model files are downloaded.
test("An engine the app ships: no engine file is downloaded, the model is ready and runs on the shipped program", async () => {
  const shipped = join(mkdtempSync(join(tmpdir(), "jc-sd-")), "sd-cli");
  writeFileSync(shipped, "#!/bin/sh\nexit 0\n"); chmodSync(shipped, 0o755);
  const w = await world({ bundledEngine: shipped });
  const before = await w.get();
  assert.deepEqual(before.engine.build, { label: "Included with the app", bytes: 0 });
  await w.admin.call("jagentchill.localModels.download", { variant: "standard", quant: "q4" });
  const ready = await w.until((view) => w.install()(view)?.state === "installed", "installed");
  assert.equal(w.install()(ready)!.files.length, 3, "the picture model, the text encoder and the decoder; no engine archive");
  assert.equal(w.fixture.requests.filter((request) => /engine|sd-/i.test(request.path)).length, 0, "nothing of the engine was requested");
  assert.equal((await w.admin.call("jagentchill.provider.list", {})).providers.find((provider: any) => provider.id === LOCAL_IMAGE_PROVIDER_ID).connection, "connected");
});
