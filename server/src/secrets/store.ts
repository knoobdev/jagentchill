import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { SECRET_NAME_PATTERN } from "@jagentchill/protocol";
import { ProtocolError } from "../errors.ts";

const MIN_VALUE_BYTES = 1;
const MAX_VALUE_BYTES = 16_384;

export type SecretInfo = { name: string; hint?: string; updated_ms: number };

/**
 * Host secrets: provider keys, header values and login answers. One owner-only JSON file that the server reads through
 * a file SecretRef provider, so a value is entered once and never copied into either configuration. Values leave this
 * class only towards the host itself (the server's own endpoint client); no method returns one to a
 * device.
 */
export class SecretStore {
  readonly file: string;
  private readonly now: () => number;
  private values: Record<string, string> = {};
  private meta: Record<string, number> = {};
  private readonly listeners = new Set<(name: string) => void>();

  constructor(file: string, now: () => number) {
    this.file = file;
    this.now = now;
    if (existsSync(file)) {
      chmodSync(file, 0o600);
      this.values = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
    }
    const metaFile = `${file}.meta`;
    if (existsSync(metaFile)) this.meta = JSON.parse(readFileSync(metaFile, "utf8")) as Record<string, number>;
  }

  static assertName(name: string): void {
    if (!SECRET_NAME_PATTERN.test(name)) throw new ProtocolError("INVALID_PARAMS", "A secret name is upper-case letters, digits and underscores, starting with a letter.");
  }

  /** A file reference that resolves to this secret. */
  ref(name: string): { source: "file"; provider: "jagentchill"; id: string } {
    return { source: "file", provider: "jagentchill", id: `/${name}` };
  }

  has(name: string): boolean {
    return Object.hasOwn(this.values, name);
  }

  /** Host-side read. Callers never put the result in a response, an event, an audit record or a log line. */
  read(name: string): string | undefined {
    return this.has(name) ? this.values[name] : undefined;
  }

  set(name: string, value: string): void {
    SecretStore.assertName(name);
    const trimmed = value.trim();
    const bytes = Buffer.byteLength(trimmed, "utf8");
    if (bytes < MIN_VALUE_BYTES) throw new ProtocolError("INVALID_PARAMS", "The secret value is empty.");
    if (bytes > MAX_VALUE_BYTES) throw new ProtocolError("PAYLOAD_TOO_LARGE", "The secret value is larger than 16 384 bytes.", { httpStatus: 413 });
    this.values = { ...this.values, [name]: trimmed };
    this.meta = { ...this.meta, [name]: this.now() };
    this.persist();
    for (const listener of this.listeners) listener(name);
  }

  delete(name: string): boolean {
    if (!this.has(name)) return false;
    const { [name]: _value, ...values } = this.values;
    const { [name]: _stamp, ...meta } = this.meta;
    this.values = values;
    this.meta = meta;
    this.persist();
    for (const listener of this.listeners) listener(name);
    return true;
  }

  /** Names with the last four characters of values of twelve characters or more; never a value. */
  list(): SecretInfo[] {
    return Object.keys(this.values).sort().map((name) => ({ name, ...(this.hint(name) ? { hint: this.hint(name) } : {}), updated_ms: this.meta[name] ?? 0 }));
  }

  hint(name: string): string | undefined {
    const value = this.read(name);
    return value && value.length >= 12 ? `••••${value.slice(-4)}` : undefined;
  }

  onChange(listener: (name: string) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** Every stored value, for redaction of text that is about to leave the host. */
  redact(text: string): string {
    let out = text;
    for (const value of Object.values(this.values)) if (value.length >= 8) out = out.split(value).join("[redacted]");
    return out;
  }

  // A secret file must never be hard-linked or readable by others, so every write replaces the inode.
  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    for (const [file, data] of [[this.file, this.values], [`${this.file}.meta`, this.meta]] as const) {
      const temp = `${file}.tmp`;
      writeFileSync(temp, JSON.stringify(data), { mode: 0o600 });
      renameSync(temp, file);
    }
  }
}
