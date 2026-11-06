// Local npm registry used only by the W13 fake installer e2e. The only package archive it serves
// contains w13-fake-cli.sh; this file must never proxy or fetch a vendor package.
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, chmodSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const [portText, runDirText, fakeCliText, mode = "good"] = process.argv.slice(2);
const port = Number(portText);
if (!port || !runDirText || !fakeCliText || !["good", "slow", "checksum", "archive", "version", "offline"].includes(mode)) throw new Error("usage: <port> <isolated-run-dir> <w13-fake-cli.sh> <mode>");
let activeMode = mode;
let downloadsStarted = 0, downloadsCancelled = 0;
const runDir = resolve(runDirText), fakeCli = resolve(fakeCliText), logFile = join(runDir, "fixture-registry.log");
const packageFor = (name) => name === "@anthropic-ai/claude-code" ? { name, binary: "claude" } : name === "@openai/codex" ? { name, binary: "codex" } : name === "@google/gemini-cli" ? { name, binary: "gemini" } : undefined;
function fakeArchive(spec) {
  const packageRoot = join(runDir, "fixture-package"), binDir = join(packageRoot, "package", "bin"), archive = join(runDir, "fake-cli.tgz");
  mkdirSync(binDir, { recursive: true, mode: 0o700 });
  // Canceling the slow download can leave this version's metadata in npm's local cache.
  // Keep the slow and success payloads byte-identical so the confirmed retry verifies cleanly.
  const version = `1.0.0-${activeMode === "slow" ? "good" : activeMode}`;
  writeFileSync(join(packageRoot, "package", "package.json"), JSON.stringify({ name: spec.name, version, bin: { [spec.binary]: `bin/${spec.binary}` } }));
  const binaryFile = join(binDir, spec.binary);
  if (activeMode === "version") writeFileSync(binaryFile, `#!/bin/sh\nif [ "\${1-}" = "--version" ]; then echo fake version failure >&2; exit 9; fi\nexec /bin/sh "${fakeCli}"\n`);
  else copyFileSync(fakeCli, binaryFile);
  chmodSync(binaryFile, 0o700);
  const packed = spawnSync("tar", ["-czf", archive, "-C", packageRoot, "package"], { encoding: "utf8" });
  if (packed.status !== 0) throw new Error(packed.stderr || "could not build fake package archive");
  const bytes = readFileSync(archive);
  const served = activeMode === "archive" ? Buffer.from("not a tar archive") : bytes;
  const integrity = activeMode === "checksum" ? "sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==" : `sha512-${createHash("sha512").update(served).digest("base64")}`;
  return { version, bytes: served, integrity };
}
const registry = createServer((request, response) => {
  appendFileSync(logFile, `${request.method} ${request.url}\n`);
  if (request.url === "/__state" && request.method === "GET") { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ mode: activeMode, downloadsStarted, downloadsCancelled })); return; }
  if (request.url === "/__mode" && request.method === "POST") {
    let body = ""; request.on("data", (chunk) => { body += chunk.toString(); });
    request.on("end", () => { try { const next = JSON.parse(body).mode; if (!["good", "slow", "checksum", "archive", "version", "offline"].includes(next)) throw new Error(); activeMode = next; response.writeHead(204).end(); } catch { response.writeHead(400).end(); } });
    return;
  }
  if (activeMode === "offline") { response.writeHead(503, { "content-type": "text/plain" }); response.end("fixture: network unavailable"); return; }
  const parsed = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  const requestedPackage = decodeURIComponent(parsed.pathname.slice(1));
  const spec = packageFor(requestedPackage);
  if (spec) {
    const built = fakeArchive(spec);
    const body = JSON.stringify({ name: spec.name, "dist-tags": { latest: built.version }, versions: { [built.version]: { name: spec.name, version: built.version, bin: { [spec.binary]: `bin/${spec.binary}` }, dist: { tarball: `http://127.0.0.1:${port}/fake-cli.tgz?package=${encodeURIComponent(spec.name)}`, integrity: built.integrity } } } });
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", "content-length": Buffer.byteLength(body) }); response.end(body); return;
  }
  if (parsed.pathname === "/fake-cli.tgz") {
    const archiveSpec = packageFor(parsed.searchParams.get("package") ?? "");
    if (!archiveSpec) { response.writeHead(404).end(); return; }
    const { bytes } = fakeArchive(archiveSpec);
    response.writeHead(200, { "content-type": "application/octet-stream", "cache-control": "no-store", ...(activeMode === "slow" ? {} : { "content-length": bytes.length }) });
    if (activeMode !== "slow") { response.end(bytes); return; }
    const split = Math.max(1, Math.floor(bytes.length / 3));
    let sent = split;
    let cancellationCounted = false;
    downloadsStarted++;
    response.write(bytes.subarray(0, split)); appendFileSync(logFile, `download-start ${split}/${bytes.length}\n`);
    const noteCancellation = () => {
      clearInterval(timer);
      if (!response.writableEnded && !cancellationCounted) { cancellationCounted = true; downloadsCancelled++; appendFileSync(logFile, "download-cancelled\n"); }
    };
    const timer = setInterval(() => {
      if (response.destroyed) { noteCancellation(); return; }
      if (sent >= bytes.length) { clearInterval(timer); response.end(); return; }
      const next = Math.min(bytes.length, sent + 16);
      response.write(bytes.subarray(sent, next));
      sent = next;
      if (sent >= bytes.length) { clearInterval(timer); response.end(); }
    }, 500);
    response.on("close", noteCancellation);
    return;
  }
  response.writeHead(404); response.end("not found");
});
registry.listen(port, "127.0.0.1", () => console.log(`W13 fake installer registry listening on 127.0.0.1:${port} (${activeMode}); package source is fixture-only`));
process.on("SIGTERM", () => registry.close(() => process.exit(0)));
