/**
 * What a platform provides. The storage port is implemented once on top of these two primitives, so its behaviour —
 * reference counting, cascading deletion, retention — is the same code on web, desktop and mobile.
 */
export interface RecordStore {
  /** A stored value, or `undefined`. */
  get(store: string, key: string): Promise<unknown | undefined>;
  /** Atomic per key: a reader sees the previous or the new value, never a mixture. */
  put(store: string, key: string, value: unknown): Promise<void>;
  delete(store: string, key: string): Promise<void>;
  keys(store: string, prefix?: string): Promise<string[]>;
}
import type { ByteSource } from "./hash.ts";

export type FileEntry = { path: string; size: number; modified_ms: number };
export interface FileStore {
  /** Written under a temporary name and renamed on completion: a crash never leaves a truncated file under the path. */
  write(path: string, bytes: Uint8Array): Promise<void>;
  read(path: string): Promise<Uint8Array>;
  /** Like `write`, from pieces: the file is never held in memory. Resolves to the number of bytes written. */
  writeStream(path: string, source: ByteSource): Promise<number>;
  /** The bytes `[start, end)` of a file, in pieces. */
  readStream(path: string, range?: { start?: number; end?: number }): AsyncIterable<Uint8Array>;
  /** Size and modified time of one file, or `undefined` when it does not exist. */
  stat(path: string): Promise<FileEntry | undefined>;
  remove(path: string): Promise<void>;
  /** Removes a directory and everything in it, including the directory itself. */
  removeTree(prefix: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  /** Files under a prefix, recursively. */
  list(prefix: string): Promise<FileEntry[]>;
  /** Free bytes of the volume (quota − usage on web), or `null` when the platform gives no estimate. */
  available(): Promise<number | null>;
}

/** Durable stores: every datum has its home here. */
export const DURABLE_STORES = ["projects", "snapshots", "backups", "journal", "library", "scripts", "templates", "workflow-cache", "session"] as const;
/** Derived stores: rebuilt from the durable ones when missing or stale; never the only home of any datum. */
export const INDEX_STORES = ["index:projects", "index:media", "index:hashes", "index:grants", "index:cache"] as const;
export type StoreName = (typeof DURABLE_STORES)[number] | (typeof INDEX_STORES)[number];
