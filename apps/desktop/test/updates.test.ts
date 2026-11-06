import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { test, type TestContext } from "node:test";
import { createManualUpdater, type ManualUpdate } from "../src/updates.ts";

/** A release feed on this computer: the feed file of a macOS release and its package, served over real HTTP. */
async function feed(t: TestContext, options: { version: string; corrupt?: boolean }) {
  const dmg = randomBytes(300_000);
  const name = `JAgentChill-${options.version}-universal.dmg`;
  const yml = `version: ${options.version}\nfiles:\n  - url: ${name}\n    sha512: ${createHash("sha512").update(dmg).digest("base64")}\n    size: ${dmg.length}\npath: ${name}\nsha512: ${createHash("sha512").update(dmg).digest("base64")}\nreleaseDate: '2026-10-08T00:00:00.000Z'\n`;
  const requests: IncomingMessage[] = [];
  const server = createServer((request, response) => {
    requests.push(request);
    const path = new URL(request.url!, "http://x").pathname;
    if (path === "/feed/latest-mac.yml") return void response.writeHead(200, { "content-type": "text/yaml" }).end(yml);
    if (path === `/feed/${name}`) {
      // A damaged copy: the same length, one byte different.
      const body = options.corrupt ? Buffer.from(dmg) : dmg;
      if (options.corrupt) body[1000] ^= 0xff;
      return void response.writeHead(200, { "content-type": "application/octet-stream", "content-length": String(body.length) }).end(body);
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const dir = mkdtempSync(join(tmpdir(), "jc-updates-"));
  t.after(() => { server.close(); rmSync(dir, { recursive: true }); });
  const states: ManualUpdate[] = [], log: string[] = [];
  const address = server.address() as { port: number };
  const updater = (currentVersion: string, feedUrl = `http://127.0.0.1:${address.port}/feed`) =>
    createManualUpdater({ feedUrl, platform: "darwin", arch: "arm64", currentVersion, dir: join(dir, "updates"), onState: (next) => states.push(next), log: (line) => log.push(line) });
  return { dmg, name, dir: join(dir, "updates"), states, log, requests, updater, port: address.port };
}

test("Update found: a newer version in the feed is downloaded, verified against the feed's SHA-512 and kept for the person to open", async (t) => {
  const fixture = await feed(t, { version: "0.1.0" });
  const updater = fixture.updater("0.0.0");
  assert.deepEqual(await updater.check(), { status: "available", version: "0.1.0" });
  assert.equal(existsSync(fixture.dir), false, "nothing is downloaded before it is asked for");
  const result = await updater.download();
  assert.deepEqual(result, { status: "downloaded", version: "0.1.0", file: join(fixture.dir, fixture.name) });
  assert.ok(readFileSync(join(fixture.dir, fixture.name)).equals(fixture.dmg));
  assert.deepEqual(readdirSync(fixture.dir), [fixture.name]);
  assert.ok(fixture.states.some((state) => state.status === "downloading" && state.progress > 0), "progress is reported while downloading");
  // The next check finds the verified package and does not fetch it again.
  const before = fixture.requests.length;
  assert.equal((await updater.check()).status, "downloaded");
  assert.equal(fixture.requests.length, before + 1);
});

test("Manual check with no update: the same version in the feed is Up to date, and an older one is too", async (t) => {
  const fixture = await feed(t, { version: "0.1.0" });
  assert.deepEqual(await fixture.updater("0.1.0").check(), { status: "up-to-date" });
  assert.deepEqual(await fixture.updater("0.2.0").check(), { status: "up-to-date" });
  assert.equal((await fixture.updater("0.1.0").download()).status, "error");
  assert.equal(existsSync(fixture.dir), false);
});

test("Tampered download: a file whose hash does not match the feed is deleted, nothing is kept, and update_verification_failed is logged", async (t) => {
  const fixture = await feed(t, { version: "0.1.0", corrupt: true });
  const updater = fixture.updater("0.0.0");
  assert.equal((await updater.check()).status, "available");
  const result = await updater.download();
  assert.equal(result.status, "error");
  assert.equal(result.status === "error" && result.reason, "verification");
  assert.deepEqual(readdirSync(fixture.dir), [], "neither the package nor its partial file is left");
  assert.equal(fixture.log.length, 1);
  assert.match(fixture.log[0], /^update_verification_failed version=0\.1\.0 /);
  // The next check retries from the start.
  assert.equal((await updater.check()).status, "available");
});

test("Offline / Check fails: a feed that cannot be reached is an error with its reason, and nothing throws", async (t) => {
  const fixture = await feed(t, { version: "0.1.0" });
  const unreachable = await fixture.updater("0.0.0", "http://127.0.0.1:9/feed").check();
  assert.equal(unreachable.status === "error" && unreachable.reason, "unreachable");
  const missing = await fixture.updater("0.0.0", `http://127.0.0.1:${fixture.port}/nothing`).check();
  assert.equal(missing.status === "error" && missing.reason, "unreachable");
  const refused = await fixture.updater("0.0.0", "http://updates.example.com/feed").check();
  assert.equal(refused.status === "error" && refused.reason, "feed", "a feed that is neither HTTPS nor on this computer is not asked");
});

test("Desktop request contents: a check asks for the feed path with a random cache-busting value and carries no identifier", async (t) => {
  const fixture = await feed(t, { version: "0.1.0" });
  const updater = fixture.updater("0.0.0");
  await updater.check();
  await updater.check();
  const [first, second] = fixture.requests.map((request) => new URL(request.url!, "http://x"));
  assert.equal(first.pathname, "/feed/latest-mac.yml");
  assert.deepEqual([...first.searchParams.keys()], ["noCache"]);
  assert.match(first.searchParams.get("noCache")!, /^[0-9a-f]{16}$/);
  assert.notEqual(first.searchParams.get("noCache"), second.searchParams.get("noCache"));
  const allowed = new Set(["host", "connection", "accept", "accept-language", "accept-encoding", "sec-fetch-mode", "user-agent", "cache-control", "pragma"]);
  for (const request of fixture.requests) assert.deepEqual(Object.keys(request.headers).filter((name) => !allowed.has(name)), []);
  assert.doesNotMatch(String(fixture.requests[0].headers["user-agent"]), /jagentchill/i);
});

test("Download fails on disk: a folder that cannot be made is a download error, nothing throws, and the same download works once the folder can be made", async (t) => {
  const fixture = await feed(t, { version: "0.1.0" });
  // A file stands where the folder of downloads should be made.
  const blocker = join(fixture.dir, "..", "blocked");
  writeFileSync(blocker, "not a folder");
  const states: ManualUpdate[] = [], log: string[] = [];
  const updater = createManualUpdater({ feedUrl: `http://127.0.0.1:${fixture.port}/feed`, platform: "darwin", arch: "arm64", currentVersion: "0.0.0", dir: join(blocker, "updates"), onState: (next) => states.push(next), log: (line) => log.push(line) });
  assert.equal((await updater.check()).status, "available");
  const result = await updater.download();
  assert.equal(result.status === "error" && result.reason, "download");
  assert.deepEqual(states.at(-1), result, "the screen is told");
  assert.match(log.at(-1)!, /^update_download_failed version=0\.1\.0 /);
  // "Try again" is the same call: it works when the cause is gone.
  rmSync(blocker);
  assert.equal((await updater.download()).status, "downloaded");
  assert.ok(readFileSync(join(blocker, "updates", fixture.name)).equals(fixture.dmg));
});

test("Download fails on disk: a folder that cannot be written to is a download error — the write stream's failure does not escape — and trying again works", { skip: process.getuid?.() === 0 || process.platform === "win32" }, async (t) => {
  const fixture = await feed(t, { version: "0.1.0" });
  const updater = fixture.updater("0.0.0");
  mkdirSync(fixture.dir, { recursive: true });
  chmodSync(fixture.dir, 0o555);
  assert.equal((await updater.check()).status, "available");
  const result = await updater.download();
  assert.equal(result.status === "error" && result.reason, "download");
  assert.match(result.status === "error" ? result.error : "", /EACCES|EPERM/);
  chmodSync(fixture.dir, 0o755);
  assert.deepEqual(readdirSync(fixture.dir), []);
  assert.equal((await updater.download()).status, "downloaded");
  assert.deepEqual(readdirSync(fixture.dir), [fixture.name]);
});

test("Download fails on disk: a write that fails part-way (disk full) is a download error and the partial file is removed", async (t) => {
  const fixture = await feed(t, { version: "0.1.0" });
  const states: ManualUpdate[] = [];
  let opened = "";
  // The real file is created, then the stream refuses the second write the way a full disk does.
  const full = (path: string) => {
    opened = path;
    writeFileSync(path, "");
    let writes = 0;
    return new Writable({ highWaterMark: 1024, write(_chunk, _encoding, done) { done(++writes > 1 ? Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" }) : null); } });
  };
  const updater = createManualUpdater({ feedUrl: `http://127.0.0.1:${fixture.port}/feed`, platform: "darwin", arch: "arm64", currentVersion: "0.0.0", dir: fixture.dir, onState: (next) => states.push(next), log: () => undefined, open: full });
  assert.equal((await updater.check()).status, "available");
  const result = await updater.download();
  assert.equal(result.status === "error" && result.reason, "download");
  assert.match(result.status === "error" ? result.error : "", /ENOSPC/);
  assert.equal(opened, join(fixture.dir, `${fixture.name}.part`));
  assert.deepEqual(readdirSync(fixture.dir), [], "the partial file is gone");
  assert.equal(states.filter((state) => state.status === "downloaded").length, 0);
});

test("Download fails on disk while the response has stalled: the stream's failure ends the download at once, the response is cancelled and the partial file is removed", async (t) => {
  const fixture = await feed(t, { version: "0.1.0" });
  const states: ManualUpdate[] = [];
  let cancelled = false, aborted = false;
  // The feed is the real one; the package answer sends its first piece and then nothing more, for ever.
  const stalling = ((input: string | URL | Request, init?: RequestInit) => {
    if (!String(input).endsWith(".dmg")) return fetch(input, init);
    init?.signal?.addEventListener("abort", () => { aborted = true; });
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(fixture.dmg.subarray(0, 4096)); }, cancel() { cancelled = true; } });
    return Promise.resolve(new Response(body, { status: 200, headers: { "content-length": String(fixture.dmg.length) } }));
  }) as typeof fetch;
  // The real file is created; a moment after the first piece was written the device fails.
  let part = "";
  const failing = (path: string) => {
    part = path;
    writeFileSync(path, "");
    const out = new Writable({ write(_chunk, _encoding, done) { done(); setTimeout(() => out.destroy(Object.assign(new Error("EIO: i/o error, write"), { code: "EIO" })), 20); } });
    return out;
  };
  const updater = createManualUpdater({ feedUrl: `http://127.0.0.1:${fixture.port}/feed`, platform: "darwin", arch: "arm64", currentVersion: "0.0.0", dir: fixture.dir, onState: (next) => states.push(next), log: () => undefined, fetch: stalling, open: failing });
  assert.equal((await updater.check()).status, "available");
  let timer: NodeJS.Timeout | undefined;
  const result = await Promise.race([updater.download(), new Promise<"pending">((late) => { timer = setTimeout(() => late("pending"), 3000); })]);
  clearTimeout(timer);
  assert.notEqual(result, "pending", "the download does not stay pending behind the stalled response");
  assert.equal(result !== "pending" && result.status === "error" && result.reason, "download");
  assert.match(result !== "pending" && result.status === "error" ? result.error : "", /EIO/);
  assert.equal(existsSync(part), false, "the partial file is gone");
  assert.deepEqual(readdirSync(fixture.dir), []);
  assert.ok(cancelled || aborted, "the response was given up");
  assert.deepEqual(states.at(-1), result, "the screen is told");
});
