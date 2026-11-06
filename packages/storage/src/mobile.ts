import { StorageError, toStorageError } from "./errors.ts";
import { createStoragePort, type StoragePort } from "./port.ts";
import { chunksOf, collect, createSha256, STREAM_CHUNK_BYTES, type ByteSource } from "./hash.ts";
import type { FileEntry, FileStore, RecordStore } from "./primitives.ts";

/** The SQL the mobile store needs from the app-private SQLite database. */
export interface SqlDriver {
  run(sql: string, params?: (string | number | null)[]): Promise<void>;
  all<Row>(sql: string, params?: (string | number | null)[]): Promise<Row[]>;
}
/** The file operations the mobile store needs from the app's documents directory. */
export interface FileDriver {
  write(path: string, bytes: Uint8Array): Promise<void>;
  read(path: string): Promise<Uint8Array>;
  remove(path: string, recursive: boolean): Promise<void>;
  move(from: string, to: string): Promise<void>;
  list(prefix: string): Promise<FileEntry[]>;
  freeBytes(): Promise<number | null>;
  /** Appends to a file, creating it; a driver without it receives streamed files in one piece. */
  append?(path: string, bytes: Uint8Array): Promise<void>;
  /** The bytes `[position, position + length)`; a driver without it serves ranges from a whole read. */
  readRange?(path: string, position: number, length: number): Promise<Uint8Array>;
  info?(path: string): Promise<FileEntry | undefined>;
}

/** Random access to a picked native file, used to hash it without materializing the whole file in JS memory. */
export type MobileFileReader = { size: number; read(start: number, end: number): Promise<Uint8Array> };
export async function hashMobileFile(reader: MobileFileReader, options: { chunkSize?: number; signal?: AbortSignal; onProgress?(bytes: number, total: number): void } = {}): Promise<string> {
  const chunkSize = options.chunkSize ?? STREAM_CHUNK_BYTES;
  if (!Number.isSafeInteger(reader.size) || reader.size < 0 || !Number.isSafeInteger(chunkSize) || chunkSize < 1) throw new RangeError("Invalid file size or read chunk size.");
  const hash = createSha256();
  for (let start = 0; start < reader.size; start += chunkSize) {
    if (options.signal?.aborted) throw new Error("File hashing was cancelled.");
    const end = Math.min(reader.size, start + chunkSize), bytes = await reader.read(start, end);
    if (bytes.length !== end - start) throw new Error(`Picked file returned ${bytes.length} bytes for range ${start}-${end}.`);
    hash.update(bytes);
    options.onProgress?.(end, reader.size);
  }
  return hash.digestHex();
}

/** Records as rows of one table of the app-private database: `(store, key)` → JSON text. */
export async function sqlRecords(sql: SqlDriver): Promise<RecordStore> {
  await sql.run("CREATE TABLE IF NOT EXISTS records (store TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (store, key))");
  const guard = async <T>(run: () => Promise<T>): Promise<T> => { try { return await run(); } catch (error) { throw toStorageError(error); } };
  return {
    get: (store, key) => guard(async () => {
      const rows = await sql.all<{ value: string }>("SELECT value FROM records WHERE store = ? AND key = ?", [store, key]);
      return rows.length ? JSON.parse(rows[0].value) as unknown : undefined;
    }),
    // One statement: the row holds the previous or the new value, never a mixture.
    put: (store, key, value) => guard(() => sql.run("INSERT INTO records (store, key, value) VALUES (?, ?, ?) ON CONFLICT (store, key) DO UPDATE SET value = excluded.value", [store, key, JSON.stringify(value)])),
    delete: (store, key) => guard(() => sql.run("DELETE FROM records WHERE store = ? AND key = ?", [store, key])),
    keys: (store, prefix = "") => guard(async () => (await sql.all<{ key: string }>("SELECT key FROM records WHERE store = ? ORDER BY key", [store])).map((row) => row.key).filter((key) => key.startsWith(prefix))),
  };
}

export function driverFiles(driver: FileDriver): FileStore {
  const guard = async <T>(run: () => Promise<T>): Promise<T> => { try { return await run(); } catch (error) { throw toStorageError(error); } };
  const quiet = async (run: () => Promise<void>) => { try { await run(); } catch (error) { if (toStorageError(error).kind !== "NotFound") throw toStorageError(error); } };
  return {
    // Written beside the target and renamed, so the path never names a truncated file.
    write: (path, bytes) => guard(async () => { const temporary = `${path}.writing`; await driver.write(temporary, bytes); await driver.move(temporary, path); }),
    read: (path) => guard(() => driver.read(path)),
    writeStream: (path, source) => guard(async () => {
      const temporary = `${path}.writing`;
      let written = 0;
      if (!driver.append) { const bytes = await collect(source); await driver.write(temporary, bytes); written = bytes.length; }
      else {
        try { await driver.write(temporary, new Uint8Array()); for await (const chunk of source as ByteSource) { await driver.append(temporary, chunk); written += chunk.length; } }
        catch (error) { await driver.remove(temporary, false).catch(() => undefined); throw error; }
      }
      await driver.move(temporary, path);
      return written;
    }),
    readStream: async function* (path, range = {}) {
      try {
        if (!driver.readRange || !driver.info) { const bytes = await driver.read(path); yield* chunksOf(bytes.subarray(range.start ?? 0, range.end ?? bytes.length)); return; }
        const info = await driver.info(path);
        if (!info) throw new StorageError("NotFound", `no file at ${path}`);
        const end = Math.min(range.end ?? info.size, info.size);
        for (let offset = range.start ?? 0; offset < end; offset += STREAM_CHUNK_BYTES) yield await driver.readRange(path, offset, Math.min(STREAM_CHUNK_BYTES, end - offset));
      } catch (error) { throw toStorageError(error); }
    },
    stat: (path) => guard(async () => {
      if (driver.info) return driver.info(path);
      const parent = path.slice(0, path.lastIndexOf("/"));
      return (await driver.list(parent)).find((entry) => entry.path === path);
    }),
    remove: (path) => quiet(() => driver.remove(path, false)),
    removeTree: (prefix) => quiet(() => driver.remove(prefix, true)),
    move: (from, to) => guard(() => driver.move(from, to)),
    list: (prefix) => guard(() => driver.list(prefix)),
    available: () => driver.freeBytes().catch(() => null),
  };
}

/** The mobile store: records in the app-private SQLite database, files in the app's documents directory. */
export async function openMobileStorage(sql: SqlDriver, files: FileDriver): Promise<StoragePort> {
  return createStoragePort("mobile", await sqlRecords(sql), driverFiles(files));
}

/** The part of an `expo-sqlite` database the driver uses. */
export type ExpoSqliteDatabase = { runAsync(sql: string, params: (string | number | null)[]): Promise<unknown>; getAllAsync<Row>(sql: string, params: (string | number | null)[]): Promise<Row[]> };
export const expoSqlDriver = (database: ExpoSqliteDatabase): SqlDriver => ({
  run: async (sql, params = []) => { await database.runAsync(sql, params); },
  all: (sql, params = []) => database.getAllAsync(sql, params),
});

/** The part of `expo-file-system` (legacy API) the driver uses. */
export type ExpoFileSystem = {
  documentDirectory: string | null;
  writeAsStringAsync(uri: string, contents: string, options: { encoding: "base64" }): Promise<void>;
  readAsStringAsync(uri: string, options: { encoding: "base64"; position?: number; length?: number }): Promise<string>;
  deleteAsync(uri: string, options: { idempotent: boolean }): Promise<void>;
  moveAsync(options: { from: string; to: string }): Promise<void>;
  makeDirectoryAsync(uri: string, options: { intermediates: boolean }): Promise<void>;
  readDirectoryAsync(uri: string): Promise<string[]>;
  getInfoAsync(uri: string): Promise<{ exists: boolean; isDirectory?: boolean; size?: number; modificationTime?: number }>;
  getFreeDiskStorageAsync(): Promise<number>;
};
const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index], b = bytes[index + 1], c = bytes[index + 2];
    out += BASE64[a >> 2] + BASE64[((a & 3) << 4) | ((b ?? 0) >> 4)] + (b === undefined ? "=" : BASE64[((b & 15) << 2) | ((c ?? 0) >> 6)]) + (c === undefined ? "=" : BASE64[c & 63]);
  }
  return out;
}
export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, ""), out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  for (let index = 0, at = 0; index < clean.length; index += 4) {
    const [a, b, c, d] = [0, 1, 2, 3].map((offset) => BASE64.indexOf(clean[index + offset] ?? "A"));
    out[at++] = (a << 2) | (b >> 4);
    if (index + 2 < clean.length) out[at++] = ((b & 15) << 4) | (c >> 2);
    if (index + 3 < clean.length) out[at++] = ((c & 3) << 6) | d;
  }
  return out;
}
/** Files under `<documents>/jagentchill/` through `expo-file-system`. */
export function expoFileDriver(fileSystem: ExpoFileSystem, folder = "jagentchill"): FileDriver {
  if (!fileSystem.documentDirectory) throw new StorageError("Unavailable", "the app has no documents directory");
  const root = `${fileSystem.documentDirectory}${folder}/`;
  const uri = (path: string) => root + path;
  const parent = (path: string) => uri(path).slice(0, uri(path).lastIndexOf("/"));
  async function walk(path: string, out: FileEntry[]): Promise<void> {
    const info = await fileSystem.getInfoAsync(uri(path));
    if (!info.exists) return;
    if (!info.isDirectory) { out.push({ path, size: info.size ?? 0, modified_ms: Math.round((info.modificationTime ?? 0) * 1000) }); return; }
    for (const name of await fileSystem.readDirectoryAsync(uri(path))) await walk(`${path}/${name}`, out);
  }
  return {
    write: async (path, bytes) => { await fileSystem.makeDirectoryAsync(parent(path), { intermediates: true }); await fileSystem.writeAsStringAsync(uri(path), toBase64(bytes), { encoding: "base64" }); },
    read: async (path) => {
      if (!(await fileSystem.getInfoAsync(uri(path))).exists) throw new StorageError("NotFound", `no file at ${path}`);
      return fromBase64(await fileSystem.readAsStringAsync(uri(path), { encoding: "base64" }));
    },
    remove: (path) => fileSystem.deleteAsync(uri(path), { idempotent: true }),
    move: async (from, to) => { await fileSystem.makeDirectoryAsync(parent(to), { intermediates: true }); await fileSystem.moveAsync({ from: uri(from), to: uri(to) }); },
    list: async (prefix) => { const out: FileEntry[] = []; await walk(prefix, out); return out; },
    freeBytes: () => fileSystem.getFreeDiskStorageAsync(),
    readRange: async (path, position, length) => fromBase64(await fileSystem.readAsStringAsync(uri(path), { encoding: "base64", position, length })),
    info: async (path) => { const info = await fileSystem.getInfoAsync(uri(path)); return info.exists && !info.isDirectory ? { path, size: info.size ?? 0, modified_ms: Math.round((info.modificationTime ?? 0) * 1000) } : undefined; },
  };
}
