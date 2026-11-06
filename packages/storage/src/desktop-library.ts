import { createHash, randomBytes } from "node:crypto";
import { accessSync, constants, existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, statfs } from "node:fs/promises";
import { hostname as osHostname } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { readFileRange, writeFileAtomic, writeStreamAtomic } from "./desktop-fs.ts";
import type { Hasher } from "./hash.ts";
import { formatBytes } from "./quota.ts";
import { storageString, type StorageLocale } from "./strings.ts";

/** SHA-256 through the platform on desktop: the same digest as the portable one, at native speed. */
export const nodeSha256 = (): Hasher => { const hash = createHash("sha256"); return { update: (bytes) => { hash.update(bytes); }, digestHex: () => hash.digest("hex") }; };
export async function hashFile(path: string): Promise<string> {
  const hasher = nodeSha256();
  for await (const chunk of readFileRange(path)) hasher.update(chunk);
  return hasher.digestHex();
}

// ───────────────────────────── library.lock ─────────────────────────────

export const LIBRARY_LOCK = "library.lock";
export const LOCK_HEARTBEAT_MS = 10_000, LOCK_EXPIRY_MS = 30_000;
export type LibraryLock = { host: string; pid: number; started_ms: number; heartbeat_ms: number };
export type LockEnvironment = { host?: string; pid?: number; now?: () => number; isProcessAlive?: (pid: number) => boolean };
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch (error) { return (error as { code?: string }).code === "EPERM"; } };
export function readLibraryLock(library: string): LibraryLock | null {
  try {
    const lock = JSON.parse(readFileSync(join(library, LIBRARY_LOCK), "utf8")) as LibraryLock;
    return typeof lock?.host === "string" && typeof lock.pid === "number" && typeof lock.heartbeat_ms === "number" ? lock : null;
  } catch { return null; }
}
/**
 * Whether another running instance holds the library. On this machine that is a live process (the app itself is
 * single-instance); on another machine — a network volume — it is a lock whose heartbeat has not expired.
 */
export function libraryLockHolder(library: string, environment: LockEnvironment = {}): LibraryLock | null {
  const lock = readLibraryLock(library);
  if (!lock) return null;
  const host = environment.host ?? osHostname(), pid = environment.pid ?? process.pid, now = (environment.now ?? Date.now)();
  if (lock.host === host) return lock.pid !== pid && (environment.isProcessAlive ?? alive)(lock.pid) ? lock : null;
  return now - lock.heartbeat_ms <= LOCK_EXPIRY_MS ? lock : null;
}
/** Takes the single-writer lock of the running app instance and keeps its heartbeat; `release` removes it. */
export async function acquireLibraryLock(library: string, environment: LockEnvironment = {}): Promise<{ beat(): Promise<void>; release(): void }> {
  const host = environment.host ?? osHostname(), pid = environment.pid ?? process.pid, now = environment.now ?? Date.now, started_ms = now();
  const write = () => writeFileAtomic(join(library, LIBRARY_LOCK), JSON.stringify({ host, pid, started_ms, heartbeat_ms: now() } satisfies LibraryLock));
  await write();
  const timer = setInterval(() => { void write().catch(() => undefined); }, LOCK_HEARTBEAT_MS);
  timer.unref?.();
  return {
    beat: write,
    release() {
      clearInterval(timer);
      const current = readLibraryLock(library);
      if (current && current.host === host && current.pid === pid) rmSync(join(library, LIBRARY_LOCK), { force: true });
    },
  };
}

// ───────────────────────────── library location ─────────────────────────────

export type LibraryLocationAction = { id: "retry" | "locate" | "create" | "quit"; label: string; enabled: boolean };
export type LibraryLocation =
  | { status: "ok"; path: string }
  /** First run: nothing was ever stored at the default location, which is simply created. */
  | { status: "new"; path: string }
  | { status: "missing"; path: string; message: string; actions: LibraryLocationAction[] };
/** A path is writable when its nearest existing ancestor is a writable directory on a mounted volume. */
export function canCreateLibraryAt(path: string): boolean {
  let current = resolve(path);
  for (;;) {
    if (existsSync(current)) {
      try { if (!statSync(current).isDirectory()) return false; accessSync(current, constants.W_OK); return true; } catch { return false; }
    }
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}
/**
 * Looks at the library location at start without writing anything. A library that was in use before and cannot be
 * reached (an unplugged drive) yields the blocking dialog "Project library not found at {path}"; no project is shown
 * as deleted and no empty library is created until the user chooses.
 */
export function inspectLibraryLocation(path: string, options: { usedBefore: boolean; locale?: StorageLocale }): LibraryLocation {
  let reachable = false;
  try { reachable = statSync(path).isDirectory(); } catch { reachable = false; }
  if (reachable) return { status: "ok", path };
  if (!options.usedBefore) return { status: "new", path };
  const text = (key: Parameters<typeof storageString>[0]) => storageString(key, {}, options.locale);
  return {
    status: "missing", path, message: storageString("libraryNotFound", { path }, options.locale),
    actions: [
      { id: "retry", label: text("retry"), enabled: true }, { id: "locate", label: text("locateLibrary"), enabled: true },
      { id: "create", label: text("createLibraryHere"), enabled: canCreateLibraryAt(path) }, { id: "quit", label: text("quit"), enabled: true },
    ],
  };
}

// ───────────────────────────── external-file grants ─────────────────────────────

/** A grant: an unguessable 128-bit id mapped to exactly one absolute path. */
export type ExternalGrant = { grantId: string; path: string; projectId: string; assetId: string };
/** What `local.media[assetId]` records of an external reference; the durable home of the reference is `project.json`. */
export type ExternalReference = { externalPath: string; externalSize: number; externalMtime_ms: number; externalGrantId: string };
export const newGrantId = (): string => randomBytes(16).toString("hex");
export const GRANT_ID = /^[0-9a-f]{32}$/;
export const EXTERNAL_SCHEME = "jagentchill-file";
export const externalFileUrl = (grant: Pick<ExternalGrant, "grantId" | "path">): string => `${EXTERNAL_SCHEME}://${grant.grantId}/${encodeURIComponent(basename(grant.path))}`;

/**
 * The record of which paths the user has selected on this machine (a system dialog, a drop). It lives with the app's
 * machine-local data, never in the library: a `project.json` that arrives from elsewhere cannot add to it.
 */
export function grantLedger(file: string) {
  const read = async (): Promise<Record<string, string>> => { try { return JSON.parse(await readFile(file, "utf8")) as Record<string, string>; } catch { return {}; } };
  return {
    async add(grantId: string, path: string): Promise<void> { await writeFileAtomic(file, JSON.stringify({ ...(await read()), [grantId]: path })); },
    async remove(grantId: string): Promise<void> { const all = await read(); if (grantId in all) { delete all[grantId]; await writeFileAtomic(file, JSON.stringify(all)); } },
    async has(grantId: string, path: string): Promise<boolean> { return (await read())[grantId] === path; },
  };
}

export type ExternalResponse = { status: 200 | 206 | 404 | 416; headers: Record<string, string>; body: AsyncIterable<Uint8Array> | null };
const nothing = (status: 404 | 416, headers: Record<string, string> = {}): ExternalResponse => ({ status, headers, body: null });
/**
 * Answers a request of the privileged scheme `jagentchill-file://<grantId>/<name>`: the granted file, whole or the
 * requested byte range. An unknown grant id, or a name other than the granted file's, is answered 404.
 */
export async function serveExternalFile(resolveGrant: (grantId: string) => Promise<ExternalGrant | undefined> | ExternalGrant | undefined, request: { url: string; range?: string | null }): Promise<ExternalResponse> {
  const match = /^jagentchill-file:\/\/([0-9a-f]{32})\/([^/?#]+)$/.exec(request.url);
  if (!match) return nothing(404);
  const grant = await resolveGrant(match[1]);
  let name: string;
  try { name = decodeURIComponent(match[2]); } catch { return nothing(404); }
  if (!grant || name !== basename(grant.path)) return nothing(404);
  let size: number;
  try { const info = await stat(grant.path); if (!info.isFile()) return nothing(404); size = info.size; } catch { return nothing(404); }
  const base = { "accept-ranges": "bytes" };
  if (!request.range) return { status: 200, headers: { ...base, "content-length": String(size) }, body: readFileRange(grant.path) };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.range.trim());
  if (!range || (range[1] === "" && range[2] === "")) return nothing(416, { "content-range": `bytes */${size}` });
  // "bytes=-n" is the final n bytes; "bytes=a-" runs to the end.
  const start = range[1] === "" ? Math.max(0, size - Number(range[2])) : Number(range[1]);
  const end = range[1] === "" || range[2] === "" ? size - 1 : Math.min(size - 1, Number(range[2]));
  if (start >= size || start > end) return nothing(416, { "content-range": `bytes */${size}` });
  return { status: 206, headers: { ...base, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) }, body: readFileRange(grant.path, { start, end: end + 1 }) };
}

// ───────────────────────────── moving the library ─────────────────────────────

/** Free space a destination must have beyond the size of the library. */
export const MOVE_HEADROOM_BYTES = 50 * 1024 * 1024;
export type MoveResult = { moved: true; library: string; files: number; bytes: number } | { moved: false; message: string; reason: string; code: "not-empty" | "inside-library" | "no-space" | "cancelled" | "copy-failed" | "verify-failed" | "switch-failed" };
export type MoveOptions = {
  from: string; to: string;
  /** Switches the app to the new folder (persists the setting, reopens the store). The old copy is deleted only after it resolves. */
  switchTo: (library: string) => Promise<void>;
  onProgress?: (progress: { file: string; copiedFiles: number; totalFiles: number; copiedBytes: number; totalBytes: number }) => void;
  signal?: { aborted: boolean };
  locale?: StorageLocale;
  /** Test seams: the destination volume's free bytes, and the copy of one file. */
  freeBytes?: (path: string) => Promise<number>;
  copyFile?: (source: string, destination: string) => Promise<void>;
};
async function walk(root: string, directory = root, out: { path: string; size: number }[] = []): Promise<{ path: string; size: number }[]> {
  for (const name of await readdir(directory)) {
    const full = join(directory, name), info = await stat(full);
    if (info.isDirectory()) await walk(root, full, out);
    // The lock belongs to the running instance and the temporary files to writes in flight: neither is library data.
    else if (!(directory === root && name === LIBRARY_LOCK) && !name.endsWith(".tmp")) out.push({ path: relative(root, full), size: info.size });
  }
  return out;
}
const volumeFree = async (path: string): Promise<number> => { let current = resolve(path); while (!existsSync(current)) current = dirname(current); const info = await statfs(current); return Number(info.bavail) * Number(info.bsize); };
const isInside = (child: string, parent: string): boolean => { const rel = relative(resolve(parent), resolve(child)); return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep) && !/^[A-Za-z]:/.test(rel)); };

/**
 * Moves the library: copies every file to the new folder, verifies each copy by size and SHA-256, switches the app
 * to the new folder, and only then deletes the old copy. A failure or a cancellation at any point leaves the old
 * library in use and removes the partial copy.
 */
export async function moveLibrary(options: MoveOptions): Promise<MoveResult> {
  const { from, to, locale } = options;
  const refuse = (code: Extract<MoveResult, { moved: false }>["code"], reason: string): MoveResult => ({ moved: false, message: storageString("libraryNotMoved", {}, locale), reason, code });
  if (isInside(to, from)) return refuse("inside-library", storageString("moveInsideLibrary", {}, locale));
  let existing: string[] = [];
  try { existing = await readdir(to); } catch { existing = []; }
  if (existing.length > 0) return refuse("not-empty", storageString("moveNotEmpty", {}, locale));
  const files = await walk(from), totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const free = await (options.freeBytes ?? volumeFree)(to);
  if (free < totalBytes + MOVE_HEADROOM_BYTES) return refuse("no-space", storageString("moveNoSpace", { required: formatBytes(totalBytes + MOVE_HEADROOM_BYTES), available: formatBytes(free) }, locale));

  const created = !existsSync(to);
  // Whatever was written goes when the move does not complete; the folder itself only when this move created it.
  const undo = async () => { if (created) await rm(to, { recursive: true, force: true }).catch(() => undefined); else for (const name of await readdir(to).catch(() => [] as string[])) await rm(join(to, name), { recursive: true, force: true }).catch(() => undefined); };
  const copy = options.copyFile ?? (async (source: string, destination: string) => { await writeStreamAtomic(destination, readFileRange(source)); });
  let copiedBytes = 0;
  try {
    await mkdir(to, { recursive: true });
    for (const [index, file] of files.entries()) {
      if (options.signal?.aborted) { await undo(); return refuse("cancelled", storageString("moveCancelled", {}, locale)); }
      const source = join(from, file.path), destination = join(to, file.path);
      await mkdir(dirname(destination), { recursive: true });
      await copy(source, destination);
      copiedBytes += file.size;
      options.onProgress?.({ file: file.path, copiedFiles: index + 1, totalFiles: files.length, copiedBytes, totalBytes });
    }
  } catch (error) {
    await undo();
    return refuse("copy-failed", storageString("moveCopyFailed", { detail: error instanceof Error ? error.message : String(error) }, locale));
  }
  for (const file of files) {
    if (options.signal?.aborted) { await undo(); return refuse("cancelled", storageString("moveCancelled", {}, locale)); }
    try {
      const copied = await stat(join(to, file.path));
      if (copied.size !== file.size || (await hashFile(join(to, file.path))) !== (await hashFile(join(from, file.path)))) { await undo(); return refuse("verify-failed", storageString("moveVerifyFailed", { detail: file.path }, locale)); }
    } catch (error) {
      await undo();
      return refuse("verify-failed", storageString("moveVerifyFailed", { detail: `${file.path}: ${error instanceof Error ? error.message : String(error)}` }, locale));
    }
  }
  try { await options.switchTo(to); } catch (error) {
    await undo();
    return refuse("switch-failed", error instanceof Error ? error.message : String(error));
  }
  await rm(from, { recursive: true, force: true });
  return { moved: true, library: to, files: files.length, bytes: totalBytes };
}
