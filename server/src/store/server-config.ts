import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * The server's own configuration file (`<dataDir>/config.json`): runtimes, endpoints and the host's settings. It never
 * holds a secret value.
 */
export class ServerConfigFile {
  private readonly file: string;
  private document: Record<string, unknown>;

  constructor(file: string) {
    this.file = file;
    this.document = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>) : {};
  }

  get<T>(key: string): T | undefined {
    return this.document[key] as T | undefined;
  }

  /** Replaces one top-level key and writes the file atomically, owner-only. */
  set(key: string, value: unknown): void {
    this.document = { ...this.document, [key]: value };
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify(this.document, null, 2), { mode: 0o600 });
    renameSync(temp, this.file);
  }
}
