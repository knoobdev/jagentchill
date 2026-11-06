import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, rmSync, statSync, utimesSync } from "node:fs";
import { mkdir, open, readdir, readFile, rename, rm, stat, statfs, unlink } from "node:fs/promises";
import { hostname as osHostname } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { StorageError, toStorageError } from "./errors.ts";
import { createStoragePort, type StoragePort } from "./port.ts";
import {
  acquireLibraryLock, externalFileUrl, GRANT_ID, grantLedger, hashFile, libraryLockHolder, moveLibrary, newGrantId, nodeSha256, serveExternalFile,
  type ExternalGrant, type ExternalReference, type ExternalResponse, type LockEnvironment, type MoveOptions, type MoveResult,
} from "./desktop-library.ts";
import { storageString } from "./strings.ts";
import { defaultLibraryFolder, filePackageSink, fileZipSource, readFileRange, writeFileAtomic, writeStreamAtomic } from "./desktop-fs.ts";
import type { FileEntry, FileStore, RecordStore } from "./primitives.ts";

export { defaultLibraryFolder, filePackageSink, fileZipSource, readFileRange, writeFileAtomic, writeStreamAtomic };
export * from "./desktop-library.ts";

const INDEX_FILE = "library.sqlite";
/** Where each durable record store lives in the library folder. Every durable record is a plain file. */
function recordPath(library: string, cache: string, store: string, key: string): string {
  const [first, second] = [key.slice(0, key.indexOf("/")), key.slice(key.indexOf("/") + 1)];
  switch (store) {
    case "projects": return join(library, key, "project.json");
    case "snapshots": return join(library, first, "snapshots", `${second}.json`);
    case "backups": return join(library, first, "backups", `${second}.json`);
    // A script's pending patches lie beside the scripts; a project's in its own directory.
    case "journal": return key.startsWith("script.") ? join(library, "scripts", "journal", `${key.slice(7)}.json`) : join(library, key, "journal.json");
    case "library": return join(library, `${key}.json`);
    case "scripts": return join(library, "scripts", `${key}.json`);
    case "templates": return join(library, "templates", key, "manifest.json");
    case "session": return join(library, `session-${key}.json`);
    // The workflow cache is derived data: it lives in the operating system's cache directory, outside the library.
    case "workflow-cache": return join(cache, "workflows", `${key}.json`);
    default: throw new StorageError("Unavailable", `unknown store "${store}"`);
  }
}
const names = async (directory: string): Promise<string[]> => { try { return await readdir(directory); } catch { return []; } };
const jsonNames = async (directory: string) => (await names(directory)).filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -5));

/**
 * Records of the desktop library: plain files in the documented layout for everything durable, and `library.sqlite`
 * for the derived indexes only. A missing or unreadable index file is recreated empty; the port then rebuilds it.
 */
export function libraryRecords(library: string, cache: string): RecordStore & { indexWasMissing: boolean; close(): void; reopen(): void; dropIndex(): void } {
  mkdirSync(library, { recursive: true });
  const indexPath = join(library, INDEX_FILE);
  let indexWasMissing = !existsSync(indexPath);
  const openIndex = (): DatabaseSync => {
    const create = (): DatabaseSync => { const database = new DatabaseSync(indexPath); database.exec("CREATE TABLE IF NOT EXISTS entries (store TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (store, key))"); return database; };
    try {
      const database = create();
      const check = database.prepare("PRAGMA integrity_check").get() as { integrity_check?: string } | undefined;
      if (check?.integrity_check !== "ok") throw new Error("integrity check failed");
      return database;
    } catch {
      // The index holds nothing that the files do not: an unreadable one is simply replaced.
      rmSync(indexPath, { force: true });
      indexWasMissing = true;
      return create();
    }
  };
  let index = openIndex();
  const guard = async <T>(run: () => Promise<T> | T): Promise<T> => { try { return await run(); } catch (error) { throw toStorageError(error); } };
  const isIndex = (store: string) => store.startsWith("index:");
  return {
    get indexWasMissing() { return indexWasMissing; },
    get: (store, key) => guard(async () => {
      if (isIndex(store)) { const row = index.prepare("SELECT value FROM entries WHERE store = ? AND key = ?").get(store, key) as { value: string } | undefined; return row ? JSON.parse(row.value) as unknown : undefined; }
      let text: string;
      try { text = await readFile(recordPath(library, cache, store, key), "utf8"); } catch (error) { if ((error as { code?: string }).code === "ENOENT") return undefined; throw error; }
      // A project record is stored as its exact bytes; every other record is JSON.
      return store === "projects" ? text : JSON.parse(text) as unknown;
    }),
    put: (store, key, value) => guard(async () => {
      if (isIndex(store)) { index.prepare("INSERT INTO entries (store, key, value) VALUES (?, ?, ?) ON CONFLICT (store, key) DO UPDATE SET value = excluded.value").run(store, key, JSON.stringify(value)); return; }
      await writeFileAtomic(recordPath(library, cache, store, key), store === "projects" ? String(value) : JSON.stringify(value));
    }),
    delete: (store, key) => guard(async () => {
      if (isIndex(store)) { index.prepare("DELETE FROM entries WHERE store = ? AND key = ?").run(store, key); return; }
      await rm(recordPath(library, cache, store, key), { force: true });
    }),
    keys: (store, prefix = "") => guard(async () => {
      let keys: string[];
      if (isIndex(store)) keys = (index.prepare("SELECT key FROM entries WHERE store = ? ORDER BY key").all(store) as { key: string }[]).map((row) => row.key);
      else if (store === "projects" || store === "journal") {
        const file = store === "projects" ? "project.json" : "journal.json";
        keys = (await names(library)).filter((name) => existsSync(join(library, name, file)));
        if (store === "journal") keys.push(...(await jsonNames(join(library, "scripts", "journal"))).map((name) => `script.${name}`));
      } else if (store === "snapshots" || store === "backups") {
        keys = [];
        for (const project of await names(library)) for (const name of await jsonNames(join(library, project, store))) keys.push(`${project}/${name}`);
      } else if (store === "templates") keys = (await names(join(library, "templates"))).filter((name) => existsSync(join(library, "templates", name, "manifest.json")));
      else if (store === "library") keys = (await jsonNames(library)).filter((name) => !name.startsWith("session-"));
      else if (store === "session") keys = (await jsonNames(library)).filter((name) => name.startsWith("session-")).map((name) => name.slice(8));
      else keys = await jsonNames(dirname(recordPath(library, cache, store, "x")));
      return keys.filter((key) => key.startsWith(prefix)).sort();
    }),
    close: () => index.close(),
    reopen: () => { index = openIndex(); },
    /** Test and repair hook: discards the index file, as if it had been deleted while the app was closed. */
    dropIndex: () => { index.close(); rmSync(indexPath, { force: true }); indexWasMissing = true; index = openIndex(); },
  };
}

/** Files of the desktop library. `projects/<id>/…` is `<library>/<id>/…`; everything else is cache, outside the library. */
export function libraryFiles(library: string, cache: string): FileStore {
  const resolve = (path: string) => (path.startsWith("projects/") ? join(library, path.slice(9)) : path.startsWith("library/") ? join(library, path.slice(8)) : path === "cache" || path.startsWith("cache/") ? join(cache, path.slice(6)) : join(cache, path));
  const guard = async <T>(run: () => Promise<T>): Promise<T> => { try { return await run(); } catch (error) { throw toStorageError(error); } };
  async function walk(directory: string, logical: string, out: FileEntry[]): Promise<void> {
    for (const name of await names(directory)) {
      const info = await stat(join(directory, name));
      if (info.isDirectory()) await walk(join(directory, name), `${logical}/${name}`, out);
      else if (!name.endsWith(".tmp")) out.push({ path: `${logical}/${name}`, size: info.size, modified_ms: Math.round(info.mtimeMs) });
    }
  }
  return {
    write: (path, bytes) => guard(() => writeFileAtomic(resolve(path), bytes)),
    read: (path) => guard(async () => new Uint8Array(await readFile(resolve(path)))),
    writeStream: (path, source) => guard(() => writeStreamAtomic(resolve(path), source)),
    readStream: async function* (path, range) { try { yield* readFileRange(resolve(path), range); } catch (error) { throw toStorageError(error); } },
    stat: (path) => guard(async () => { try { const info = await stat(resolve(path)); return { path, size: info.size, modified_ms: Math.round(info.mtimeMs) }; } catch (error) { if ((error as { code?: string }).code === "ENOENT") return undefined; throw error; } }),
    remove: (path) => guard(() => rm(resolve(path), { force: true })),
    removeTree: (prefix) => guard(() => rm(resolve(prefix), { recursive: true, force: true })),
    move: (from, to) => guard(async () => { await mkdir(dirname(resolve(to)), { recursive: true }); await rename(resolve(from), resolve(to)); }),
    list: (prefix) => guard(async () => { const out: FileEntry[] = []; await walk(resolve(prefix), prefix.replace(/\/$/, ""), out); return out; }),
    available: async () => { try { const info = await statfs(library); return Number(info.bavail) * Number(info.bsize); } catch { return null; } },
  };
}

const MUTATING = /^(write|delete|put|append|truncate|clear|remove|discard|rebuild)/;
/** A library that another computer has open is read here and never written. */
function readOnlyPort<T extends StoragePort>(port: T): T {
  const refuse = async () => { throw new StorageError("Unavailable", storageString("libraryOpenElsewhere"), { reason: "library-read-only" }); };
  return new Proxy(port, { get: (target, key, receiver) => (typeof key === "string" && MUTATING.test(key) ? refuse : Reflect.get(target, key, receiver)) });
}

export type DesktopStorage = StoragePort & {
  readonly library: string;
  /** The index was missing, unreadable, stale or failed its integrity check and has been rebuilt from the files. */
  readonly indexRebuilt: boolean;
  /** The library's lock belongs to a live process on another machine: nothing is written; the banner says why. */
  readonly readOnly: boolean;
  readonly banner: string | null;
  /** Discards `library.sqlite` and rebuilds it from the project directories and the library-wide files. */
  dropAndRebuildIndex(): Promise<void>;
  /**
   * Creates the grant for a file the user selected in a system dialog or dropped on the app. The caller stores the
   * returned reference under `local.media[assetId]`; nothing is copied into the library.
   */
  grantExternalFile(projectId: string, assetId: string, path: string): Promise<ExternalReference & { url: string }>;
  revokeGrant(grantId: string): Promise<void>;
  resolveGrant(grantId: string): Promise<ExternalGrant | undefined>;
  /** `offline` when no grant exists for the asset or its file no longer matches: the asset shows "Relink…". */
  externalStatus(projectId: string, assetId: string): Promise<"online" | "offline">;
  /** Answers a request of the scheme `jagentchill-file://<grantId>/<name>` (200, 206 for a byte range, 404). */
  serveExternalFile(request: { url: string; range?: string | null }): Promise<ExternalResponse>;
  /** Moves the library to another folder; on success the returned store is open on the new folder and this one is closed. */
  moveTo(destination: string, options?: Pick<MoveOptions, "onProgress" | "signal" | "locale" | "freeBytes" | "copyFile"> & { persist?: (library: string) => Promise<void> }): Promise<MoveResult & { storage?: DesktopStorage }>;
  close(): void;
};
export type DesktopOptions = {
  library: string; cache: string;
  lock?: LockEnvironment;
  /** "Rebuilding library index…" while a rebuild runs, `null` when it is done. */
  onStatus?: (message: string | null) => void;
  /** The id source for a copied-in project whose id collides with an existing one. */
  newId?: () => string;
};

/** A project directory whose record names another id is renamed to it; when that id is taken it becomes a copy under a new id. */
async function adoptCopiedDirectories(library: string, newId: () => string): Promise<void> {
  const directories = (await names(library)).filter((name) => existsSync(join(library, name, "project.json")));
  for (const directory of directories) {
    let record: { metadata?: { id?: unknown; name?: unknown } };
    try { record = JSON.parse(await readFile(join(library, directory, "project.json"), "utf8")) as typeof record; } catch { continue; }
    const id = record.metadata?.id;
    if (typeof id !== "string" || id === directory || !/^[A-Za-z0-9_-]+$/.test(id)) continue;
    if (!existsSync(join(library, id))) { await rename(join(library, directory), join(library, id)); continue; }
    const fresh = newId();
    record.metadata = { ...record.metadata, id: fresh };
    await writeFileAtomic(join(library, directory, "project.json"), JSON.stringify(record));
    await rename(join(library, directory), join(library, fresh));
  }
}

/**
 * The desktop store: a user-visible project library folder in which every durable record is a file, with a purely
 * derived SQLite index. Runs in the Electron main process; the renderer reaches it through the preload bridge with
 * project ids, asset ids and grant ids, never paths.
 */
export async function openDesktopStorage(options: DesktopOptions): Promise<DesktopStorage> {
  const { library, cache } = options;
  mkdirSync(library, { recursive: true });
  const holder = libraryLockHolder(library, options.lock);
  const foreign = holder !== null && holder.host !== (options.lock?.host ?? osHostname());
  const lock = holder ? null : await acquireLibraryLock(library, options.lock);
  const readOnly = holder !== null;
  const indexPath = join(library, INDEX_FILE);
  // The index is stale when any durable file is newer than it, or when the project directories are not the ones it lists.
  let stale = false;
  if (existsSync(indexPath)) {
    const indexTime = statSync(indexPath).mtimeMs;
    const newer = (path: string) => { try { return statSync(path).mtimeMs > indexTime + 1; } catch { return false; } };
    const entries = await names(library);
    stale = entries.some((name) => (name.endsWith(".json") && !name.startsWith("session-") && newer(join(library, name))) || newer(join(library, name, "project.json")))
      || (await names(join(library, "scripts"))).some((name) => newer(join(library, "scripts", name)));
  }
  const records = libraryRecords(library, cache);
  const files = libraryFiles(library, cache);
  const ledger = grantLedger(join(cache, "external-grants.json"));
  const grantKey = (projectId: string, assetId: string) => `${projectId}/${assetId}`;
  const grants = async (): Promise<ExternalGrant[]> => Promise.all((await records.keys("index:grants")).map(async (key) => (await records.get("index:grants", key)) as ExternalGrant));
  const matches = async (path: string, size: unknown, mtime: unknown): Promise<boolean> => { try { const info = await stat(path); return info.isFile() && info.size === size && Math.round(info.mtimeMs) === mtime; } catch { return false; } };

  /** Re-creates the grant table from the `local.media` entries of every `project.json`. Nothing is prompted. */
  const rebuildGrants = async (): Promise<void> => {
    for (const key of await records.keys("index:grants")) await records.delete("index:grants", key);
    for (const projectId of await records.keys("projects")) {
      let record: { media?: { assets?: { id?: string; contentHash?: string }[] }; local?: { media?: Record<string, Partial<ExternalReference> & { storage?: string }> } };
      try { record = JSON.parse(String(await records.get("projects", projectId))) as typeof record; } catch { continue; }
      for (const [assetId, entry] of Object.entries(record.local?.media ?? {})) {
        if (!entry || entry.storage !== "external" || typeof entry.externalPath !== "string" || typeof entry.externalGrantId !== "string" || !GRANT_ID.test(entry.externalGrantId)) continue;
        // A path that no longer has the recorded size and modified time gets no grant: the asset is offline.
        if (!(await matches(entry.externalPath, entry.externalSize, entry.externalMtime_ms))) continue;
        if (!(await ledger.has(entry.externalGrantId, entry.externalPath))) {
          // The user never selected this path on this machine (a directory copied in from elsewhere): it is granted
          // only when the file is the asset — its content hash equals the asset's.
          const contentHash = record.media?.assets?.find((asset) => asset.id === assetId)?.contentHash;
          if (typeof contentHash !== "string" || (await hashFile(entry.externalPath).catch(() => "")) !== contentHash) continue;
          await ledger.add(entry.externalGrantId, entry.externalPath);
        }
        await records.put("index:grants", grantKey(projectId, assetId), { grantId: entry.externalGrantId, path: entry.externalPath, projectId, assetId } satisfies ExternalGrant);
      }
    }
  };
  const port = createStoragePort("desktop", records, files, { hasher: nodeSha256, onRebuild: rebuildGrants });
  const listed = new Set(await records.keys("index:projects"));
  const present = (await names(library)).filter((name) => existsSync(join(library, name, "project.json")));
  const indexRebuilt = !readOnly && (records.indexWasMissing || stale || present.length !== listed.size || present.some((name) => !listed.has(name)));
  const rebuild = async () => {
    options.onStatus?.(storageString("rebuildingIndex"));
    try { await adoptCopiedDirectories(library, options.newId ?? (() => randomBytes(16).toString("hex"))); await port.rebuildIndexes(); } finally { options.onStatus?.(null); }
  };
  if (indexRebuilt) await rebuild();

  let closed = false;
  const self: DesktopStorage = Object.assign(readOnly ? readOnlyPort(port) : port, {
    library, indexRebuilt, readOnly, banner: foreign ? storageString("libraryOpenElsewhere") : null,
    dropAndRebuildIndex: async () => { records.dropIndex(); await rebuild(); },
    grantExternalFile: async (projectId: string, assetId: string, path: string) => {
      const absolute = resolvePath(path), info = await stat(absolute).catch((error) => { throw toStorageError(error); });
      if (!info.isFile()) throw new StorageError("NotFound", `"${absolute}" is not a file`);
      const grant: ExternalGrant = { grantId: newGrantId(), path: absolute, projectId, assetId };
      await ledger.add(grant.grantId, absolute);
      await records.put("index:grants", grantKey(projectId, assetId), grant);
      return { externalPath: absolute, externalSize: info.size, externalMtime_ms: Math.round(info.mtimeMs), externalGrantId: grant.grantId, url: externalFileUrl(grant) };
    },
    resolveGrant: async (grantId: string) => (GRANT_ID.test(grantId) ? (await grants()).find((grant) => grant.grantId === grantId) : undefined),
    revokeGrant: async (grantId: string) => {
      for (const grant of await grants()) if (grant.grantId === grantId) await records.delete("index:grants", grantKey(grant.projectId, grant.assetId));
      await ledger.remove(grantId);
    },
    externalStatus: async (projectId: string, assetId: string): Promise<"online" | "offline"> => {
      const grant = (await records.get("index:grants", grantKey(projectId, assetId))) as ExternalGrant | undefined;
      if (!grant) return "offline";
      const local = ((await port.readProject(projectId)).local as { media?: Record<string, Partial<ExternalReference>> } | undefined)?.media?.[assetId];
      return local?.externalGrantId === grant.grantId && local.externalPath === grant.path && (await matches(grant.path, local.externalSize, local.externalMtime_ms)) ? "online" : "offline";
    },
    serveExternalFile: (request: { url: string; range?: string | null }) => serveExternalFile((grantId) => self.resolveGrant(grantId), request),
    moveTo: async (destination: string, moveOptions: Parameters<DesktopStorage["moveTo"]>[1] = {}) => {
      if (readOnly) return { moved: false as const, message: storageString("libraryNotMoved", {}, moveOptions.locale), reason: storageString("libraryOpenElsewhere", {}, moveOptions.locale), code: "switch-failed" as const };
      let next: DesktopStorage | undefined;
      // Nothing may be written to the old library while its files are copied.
      records.close();
      const result = await moveLibrary({
        from: library, to: destination, onProgress: moveOptions.onProgress, signal: moveOptions.signal, locale: moveOptions.locale, freeBytes: moveOptions.freeBytes, copyFile: moveOptions.copyFile,
        switchTo: async (moved) => { next = await openDesktopStorage({ ...options, library: moved }); await moveOptions.persist?.(moved); },
      });
      if (!result.moved) { next?.close(); records.reopen(); return result; }
      closed = true;
      // The old folder is gone: its lock must not be written again.
      lock?.release();
      return { ...result, storage: next };
    },
    close: () => {
      if (closed) return;
      closed = true;
      records.close();
      // An orderly shutdown leaves the index newer than every file it was derived from.
      if (!readOnly) { const now = new Date(); try { utimesSync(indexPath, now, now); } catch { /* the index is rebuilt on the next start */ } }
      lock?.release();
    },
  });
  return self;
}
