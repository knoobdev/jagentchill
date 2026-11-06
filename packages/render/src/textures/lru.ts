/** A least-recently-used cache bounded by bytes. Evicted values are handed to `dispose` (closing bitmaps and frames). */
export class ByteLru<V> {
  private readonly entries = new Map<string, { value: V; bytes: number }>();
  private used = 0;
  private limit: number;
  private readonly dispose: (value: V) => void;
  constructor(limit: number, dispose: (value: V) => void = () => undefined) {
    this.limit = limit;
    this.dispose = dispose;
  }
  get bytes(): number { return this.used; }
  get size(): number { return this.entries.size; }
  get budget(): number { return this.limit; }
  has(key: string): boolean { return this.entries.has(key); }
  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    // Re-inserting moves the key to the most recent end.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }
  /** Stores a value and evicts least-recently-used entries until the cache fits; `keep` names keys that stay. */
  set(key: string, value: V, bytes: number, keep: ReadonlySet<string> = new Set()): void {
    this.delete(key);
    this.entries.set(key, { value, bytes });
    this.used += bytes;
    this.trim(keep.has(key) ? keep : new Set([...keep, key]));
  }
  delete(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.entries.delete(key);
    this.used -= entry.bytes;
    this.dispose(entry.value);
    return true;
  }
  /** Removes every entry whose key satisfies the test (an asset was removed). */
  deleteWhere(test: (key: string) => boolean): void {
    for (const key of [...this.entries.keys()]) if (test(key)) this.delete(key);
  }
  setLimit(limit: number, keep: ReadonlySet<string> = new Set()): void {
    this.limit = limit;
    this.trim(keep);
  }
  trim(keep: ReadonlySet<string> = new Set()): void {
    for (const key of [...this.entries.keys()]) {
      if (this.used <= this.limit) break;
      if (!keep.has(key)) this.delete(key);
    }
  }
  clear(keep: ReadonlySet<string> = new Set()): void {
    for (const key of [...this.entries.keys()]) if (!keep.has(key)) this.delete(key);
  }
}
