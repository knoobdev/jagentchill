import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { copyFileSync, createReadStream, createWriteStream, mkdirSync, openSync, readSync, closeSync, realpathSync, rmSync, statSync } from "node:fs";
import { request } from "node:https";
import { isIP } from "node:net";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { BLOB_CHUNK_BYTES, MEDIA_IMPORT_MAX_BYTES, MEDIA_IMPORT_MAX_REDIRECTS } from "@jagentchill/protocol";
import type { BlobStore } from "../sync/blobs.ts";
import { ToolFailure } from "./kit.ts";

/** One response of a download: its status, where it redirects to, and its body as it arrives. */
export type Download = { status: number; location?: string; contentLength?: number; /** The Content-Range of an answer to a Range request. */ contentRange?: string; mime?: string; body: AsyncIterable<Uint8Array>; cancel(): void };
/** The network as `jc_media_import` uses it; a test names a host and serves its bytes without leaving the process. */
export type ImportNet = {
  resolve(host: string): Promise<string[]>;
  /** A GET of `url` sent to `address` (the address that was checked, so that a second lookup cannot name another one). */
  download(url: URL, address: string, /** Request headers besides the standing ones (a Range). */ headers?: Record<string, string>): Promise<Download>;
};

/**
 * The bytes of an address written as text: 4 for IPv4, 16 for IPv6, `null` for anything that is not exactly one address.
 * Every spelling of the same address gives the same bytes (upper case, zero-padded groups, `::` anywhere, a dotted
 * tail), so the ranges below are judged on the bytes and never on how the text looks. An IPv4 part with a leading zero
 * is refused rather than guessed at (some resolvers read it as octal), and so is an address with a zone id.
 */
export function addressBytes(text: string): Uint8Array | null {
  const dotted = (part: string): number[] | null => {
    const pieces = part.split(".");
    if (pieces.length !== 4) return null;
    const bytes: number[] = [];
    for (const piece of pieces) {
      if (piece.length < 1 || piece.length > 3 || (piece.length > 1 && piece[0] === "0")) return null;
      for (const char of piece) if (char < "0" || char > "9") return null;
      const value = Number(piece);
      if (value > 255) return null;
      bytes.push(value);
    }
    return bytes;
  };
  if (!text.includes(":")) { const bytes = dotted(text); return bytes ? Uint8Array.from(bytes) : null; }
  const groups = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [], pieces = part.split(":");
    for (let index = 0; index < pieces.length; index++) {
      const piece = pieces[index];
      if (piece.includes(".")) {
        // A dotted IPv4 tail stands for the last two groups, and only there.
        const tail = index === pieces.length - 1 ? dotted(piece) : null;
        if (!tail) return null;
        out.push((tail[0] << 8) | tail[1], (tail[2] << 8) | tail[3]);
        continue;
      }
      if (piece.length < 1 || piece.length > 4) return null;
      for (const char of piece) if (!"0123456789abcdefABCDEF".includes(char)) return null;
      out.push(Number.parseInt(piece, 16));
    }
    return out;
  };
  const gap = text.indexOf("::");
  let all: number[];
  if (gap < 0) {
    const whole = groups(text);
    if (!whole || whole.length !== 8) return null;
    all = whole;
  } else {
    if (text.indexOf("::", gap + 1) >= 0) return null;
    const head = groups(text.slice(0, gap)), tail = groups(text.slice(gap + 2));
    // `::` stands for at least one group of zeros.
    if (!head || !tail || head.length + tail.length > 7) return null;
    // The dotted form may only end the address, so it cannot be in the part before `::`.
    if (text.slice(0, gap).includes(".")) return null;
    all = [...head, ...new Array<number>(8 - head.length - tail.length).fill(0), ...tail];
  }
  const bytes = new Uint8Array(16);
  all.forEach((group, index) => { bytes[index * 2] = group >> 8; bytes[index * 2 + 1] = group & 255; });
  return bytes;
}

/** True when the first `bits` bits of `bytes` are those of `prefix`. */
const within = (bytes: Uint8Array, prefix: readonly number[], bits: number): boolean => {
  for (let bit = 0; bit < bits; bit += 8) {
    const mask = bits - bit >= 8 ? 255 : (255 << (8 - (bits - bit))) & 255;
    if ((bytes[bit >> 3] & mask) !== ((prefix[bit >> 3] ?? 0) & mask)) return false;
  }
  return true;
};

/** IPv4 ranges that are not the public internet (RFC 6890 and the multicast / reserved space above 224). */
const BLOCKED_V4: readonly (readonly [readonly number[], number])[] = [
  [[0], 8], [[10], 8], [[100, 64], 10], [[127], 8], [[169, 254], 16], [[172, 16], 12], [[192, 0, 0], 24], [[192, 0, 2], 24],
  [[192, 88, 99], 24], [[192, 168], 16], [[198, 18], 15], [[198, 51, 100], 24], [[203, 0, 113], 24], [[224], 4], [[240], 4],
];
/** Parts of the IPv6 global unicast space (2000::/3) that are not public hosts: protocol assignments with Teredo, documentation, 6to4. */
const BLOCKED_V6: readonly (readonly [readonly number[], number])[] = [
  [[0x20, 0x01, 0x00, 0x00], 23], [[0x20, 0x01, 0x0d, 0xb8], 32], [[0x20, 0x02], 16], [[0x3f, 0xff, 0x00], 20],
];
const MAPPED_V4 = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff];

const blockedBytes = (bytes: Uint8Array): boolean => {
  if (bytes.length === 4) return BLOCKED_V4.some(([prefix, bits]) => within(bytes, prefix, bits));
  // An IPv4 address carried in IPv6 (`::ffff:a.b.c.d`, however it is written) is judged as that IPv4 address.
  if (within(bytes, MAPPED_V4, 96)) return blockedBytes(bytes.subarray(12));
  // Everything else outside global unicast is refused as a whole: unspecified, loopback, IPv4-compatible and
  // IPv4-translated forms, NAT64 (64:ff9b::/96 and 64:ff9b:1::/48), discard, unique local, link-local, site-local, multicast.
  if (!within(bytes, [0x20], 3)) return true;
  return BLOCKED_V6.some(([prefix, bits]) => within(bytes, prefix, bits));
};

/**
 * Addresses a URL import never reaches: loopback, private, link-local, carrier NAT, multicast, unspecified, reserved
 * and documentation ranges, and every IPv6 form of them. Text that is not one plain address is refused.
 */
export function isBlockedAddress(address: string): boolean {
  const bytes = addressBytes(address);
  return bytes === null || blockedBytes(bytes);
}

/** The one spelling of an address that is connected to: what was judged, written from its bytes (an IPv4-mapped address as IPv4). */
export function canonicalAddress(address: string): string | null {
  const bytes = addressBytes(address);
  if (bytes === null) return null;
  if (bytes.length === 4) return bytes.join(".");
  if (within(bytes, MAPPED_V4, 96)) return bytes.subarray(12).join(".");
  const groups: string[] = [];
  for (let index = 0; index < 16; index += 2) groups.push(((bytes[index] << 8) | bytes[index + 1]).toString(16));
  return groups.join(":");
}

/**
 * The lookup of a download: it answers with the one address that was checked, whatever name is asked. Node asks for
 * ALL addresses when it chooses the address family itself (`options.all`) and then wants a list; answering that with a
 * single address fails the request with "Invalid IP address: undefined".
 */
export const pinned = (address: string) => (_host: string, options: unknown, done: unknown): void => {
  const family = isIP(address), all = typeof options === "object" && options !== null && (options as { all?: boolean }).all === true;
  if (all) (done as (error: null, addresses: { address: string; family: number }[]) => void)(null, [{ address, family }]);
  else (done as (error: null, address: string, family: number) => void)(null, address, family);
};

export const systemNet: ImportNet = {
  resolve: async (host) => (isIP(host) ? [host] : (await lookup(host, { all: true })).map((entry) => entry.address)),
  download: (url, address, headers) => new Promise((resolve, reject) => {
    const sent = request(url, { method: "GET", headers: { ...headers, accept: "*/*", "user-agent": "JAgentChill" }, timeout: 30_000, lookup: pinned(address) }, (response) => {
      const length = Number(response.headers["content-length"]);
      resolve({
        status: response.statusCode ?? 0, ...(typeof response.headers.location === "string" ? { location: response.headers.location } : {}), ...(Number.isFinite(length) ? { contentLength: length } : {}), ...(typeof response.headers["content-range"] === "string" ? { contentRange: response.headers["content-range"] } : {}),
        ...(typeof response.headers["content-type"] === "string" ? { mime: response.headers["content-type"].split(";")[0].trim() } : {}), body: response, cancel: () => response.destroy(),
      });
    });
    sent.on("timeout", () => sent.destroy(new Error("the server did not answer in time")));
    sent.on("error", reject);
    sent.end();
  }),
};

const blocked = (url: URL, reason: string): never => { throw new ToolFailure("EGRESS_BLOCKED", `The address ${url.origin} cannot be imported from: ${reason}. Only public https addresses are accepted.`, { url: url.origin, reason }); };
/** The https URL of an import, or the failure the spec names for what it is instead. */
export function importUrl(text: string): URL {
  let url: URL;
  try { url = new URL(text); } catch { throw new ToolFailure("INVALID_PARAMS", "source.url is not a URL. Send an absolute https address.", { field: "source.url" }); }
  if (url.protocol !== "https:") throw new ToolFailure("INVALID_PARAMS", "source.url must be an https address; other schemes are not imported.", { field: "source.url", allowed: ["https"] });
  if (url.username || url.password) throw new ToolFailure("INVALID_PARAMS", "source.url must not carry a user name or password.", { field: "source.url" });
  return url;
}
/** Refuses a URL whose host is, or resolves to, an address inside this machine or its networks; returns the address to connect to. */
export async function vetAddress(net: ImportNet, url: URL): Promise<string> {
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (host === "" || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) blocked(url, "it names this machine or its local network");
  // An address written out needs no lookup: it is judged as it stands. Text that only looks like one (a zone id, an
  // octal part) is refused here and never handed to the resolver, which might read it differently.
  if (isIP(host) || host.includes(":") || host.includes("%") || /^[0-9.]+$/.test(host)) return isBlockedAddress(host) ? blocked(url, "it is a private, loopback or link-local address") : canonicalAddress(host)!;
  let addresses: string[];
  try { addresses = await net.resolve(host); } catch { throw new ToolFailure("NOT_FOUND", `The host ${host} could not be found. Check the address.`, { url: url.origin }); }
  if (addresses.length === 0) throw new ToolFailure("NOT_FOUND", `The host ${host} could not be found. Check the address.`, { url: url.origin });
  if (addresses.some(isBlockedAddress)) blocked(url, "it resolves to a private, loopback or link-local address");
  // The connection goes to the bytes that were judged, not to the resolver's text.
  return canonicalAddress(addresses[0])!;
}

/**
 * Downloads a public https URL to a file of the server's own temporary directory: at most three redirects (each one
 * checked like the first address), at most 5 GiB, hashed as it arrives. Nothing is requested from a refused address.
 */
export async function downloadToFile(net: ImportNet, start: URL, firstAddress: string, dir: string): Promise<{ file: string; size: number; sha256: string; mime: string; finalUrl: URL }> {
  const attempts = 3;
  const wait = (attempt: number) => new Promise<void>((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
  const once = async (): Promise<{ file: string; size: number; sha256: string; mime: string; finalUrl: URL }> => {
    let url = start, address = firstAddress;
    for (let hop = 0; ; hop++) {
      let response: Download;
      try { response = await net.download(url, address); } catch (error) { throw new ToolFailure("TIMEOUT", `The download from ${url.origin} failed: ${error instanceof Error ? error.message : "no answer"}. Try again, or use another source.`, { url: url.origin, retryable: true }); }
      if (response.status >= 300 && response.status < 400 && response.location) {
        response.cancel();
        if (hop >= MEDIA_IMPORT_MAX_REDIRECTS) throw new ToolFailure("INVALID_PARAMS", `The address redirects more than ${MEDIA_IMPORT_MAX_REDIRECTS} times. Use the final address of the file.`, { field: "source.url", reason: "too_many_redirects" });
        const next = new URL(response.location, url);
        if (next.protocol !== "https:") { blocked(next, "it redirects to an address that is not https"); }
        address = await vetAddress(net, next);
        url = next;
        continue;
      }
      if ([408, 425, 429].includes(response.status) || response.status >= 500) {
        response.cancel();
        throw new ToolFailure("TIMEOUT", `The address answered ${response.status}; retrying the download may succeed.`, { url: url.origin, status: response.status, retryable: true });
      }
      if (response.status !== 200) { response.cancel(); throw new ToolFailure("NOT_FOUND", `The address answered ${response.status}, not a file. Check the URL.`, { status: response.status }); }
      const tooLarge = (size: number) => new ToolFailure("OUT_OF_RANGE", "The file is larger than 5 GiB, the most a URL import takes.", { field: "size", min: 1, max: MEDIA_IMPORT_MAX_BYTES, value: size });
      if (response.contentLength !== undefined && response.contentLength > MEDIA_IMPORT_MAX_BYTES) { response.cancel(); throw tooLarge(response.contentLength); }
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const file = join(dir, `import-${randomUUID()}`), out = createWriteStream(file, { mode: 0o600 }), hash = createHash("sha256");
      let size = 0;
      try {
        for await (const piece of response.body) {
          size += piece.length;
          if (size > MEDIA_IMPORT_MAX_BYTES) { response.cancel(); throw tooLarge(size); }
          hash.update(piece);
          if (!out.write(piece)) await new Promise<void>((resolve) => out.once("drain", () => resolve()));
        }
        await new Promise<void>((resolve, reject) => out.end((error?: Error | null) => (error ? reject(error) : resolve())));
      } catch (error) {
        out.destroy(); rmSync(file, { force: true });
        throw error instanceof ToolFailure ? error : new ToolFailure("TIMEOUT", `The download from ${url.origin} broke off. Try again.`, { url: url.origin, retryable: true });
      }
      if (response.contentLength !== undefined && size !== response.contentLength) {
        rmSync(file, { force: true });
        throw new ToolFailure("TIMEOUT", `The download from ${url.origin} ended at ${size} bytes; the server declared ${response.contentLength}. Try again.`, { url: url.origin, received: size, expected: response.contentLength, retryable: true });
      }
      if (size === 0) { rmSync(file, { force: true }); throw new ToolFailure("INVALID_PARAMS", "The address returned an empty file.", { field: "source.url" }); }
      return { file, size, sha256: hash.digest("hex"), mime: response.mime ?? "application/octet-stream", finalUrl: url };
    }
  };
  for (let attempt = 0; ; attempt++) {
    try { return await once(); }
    catch (error) {
      if (!(error instanceof ToolFailure) || error.code !== "TIMEOUT" || attempt >= attempts - 1) throw error;
      await wait(attempt);
    }
  }
}

/** Stores a downloaded file as a media blob of the host through the same chunked path a device's upload takes. */
export async function storeFile(blobs: BlobStore, downloaded: { file: string; size: number; sha256: string; mime: string }, name: string, deviceId: string): Promise<void> {
  try {
    const started = blobs.init(downloaded.sha256, { size: downloaded.size, mime: downloaded.mime, name, chunkSize: BLOB_CHUNK_BYTES, purpose: "media" }, deviceId);
    if (started.exists) return;
    const have = new Set(started.receivedChunks), handle = openSync(downloaded.file, "r"), buffer = Buffer.alloc(BLOB_CHUNK_BYTES);
    try {
      for (let index = 0; index * BLOB_CHUNK_BYTES < downloaded.size; index++) {
        if (have.has(index)) continue;
        const read = readSync(handle, buffer, 0, BLOB_CHUNK_BYTES, index * BLOB_CHUNK_BYTES);
        blobs.putChunk(downloaded.sha256, index, buffer.subarray(0, read));
      }
    } finally { closeSync(handle); }
    await blobs.complete(downloaded.sha256);
  } finally { rmSync(downloaded.file, { force: true }); }
}

const WORKSPACE_MIME: Record<string, string> = {
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".mkv": "video/x-matroska",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg", ".opus": "audio/ogg", ".flac": "audio/flac",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
};
/**
 * A file the agent made in its own work folder (a rendered MP4, a voice track): copied out of the folder and hashed, so
 * that it can be stored like a download. Only a regular file inside that folder is taken — a path that leaves it
 * (`..`, a link pointing out) is refused.
 */
export async function copyWorkspaceFile(workspace: string, path: string, dir: string): Promise<{ file: string; size: number; sha256: string; mime: string; name: string }> {
  let root: string, real: string;
  try { root = realpathSync(workspace); } catch { throw new ToolFailure("NOT_FOUND", `There is no file at "${path}" in your work folder.`, { field: "source.path" }); }
  try { real = realpathSync(isAbsolute(path) ? path : resolve(root, path)); } catch { throw new ToolFailure("NOT_FOUND", `There is no file at "${path}" in your work folder.`, { field: "source.path" }); }
  const inside = relative(root, real);
  if (!inside || inside.startsWith("..") || isAbsolute(inside)) throw new ToolFailure("INVALID_PARAMS", `"${path}" is outside your work folder. Make the file inside the work folder, then import it from there.`, { field: "source.path" });
  const stat = statSync(real);
  if (!stat.isFile()) throw new ToolFailure("INVALID_PARAMS", `"${path}" is not a file.`, { field: "source.path" });
  if (stat.size === 0) throw new ToolFailure("INVALID_PARAMS", `"${path}" is empty.`, { field: "source.path" });
  if (stat.size > MEDIA_IMPORT_MAX_BYTES) throw new ToolFailure("OUT_OF_RANGE", "The file is larger than 5 GiB, the most an import takes.", { field: "size", min: 1, max: MEDIA_IMPORT_MAX_BYTES, value: stat.size });
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `workspace-${randomUUID()}`);
  copyFileSync(real, file);
  const hash = createHash("sha256");
  await new Promise<void>((done, fail) => { createReadStream(file).on("data", (chunk) => hash.update(chunk)).on("end", () => done()).on("error", fail); });
  return { file, size: stat.size, sha256: hash.digest("hex"), mime: WORKSPACE_MIME[extname(real).toLowerCase()] ?? "application/octet-stream", name: real.split("/").pop() ?? "file" };
}
