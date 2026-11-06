import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** The shell's own small settings file (`<userData>/desktop.json`): window state, ports, the library location. Never a secret. */
export function createSettings(file: string) {
  let document: Record<string, unknown> = {};
  try { if (existsSync(file)) document = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>; } catch { document = {}; }
  return {
    get<T>(key: string): T | undefined { return document[key] as T | undefined; },
    set(key: string, value: unknown): void {
      document = { ...document, [key]: value };
      mkdirSync(dirname(file), { recursive: true });
      const temp = `${file}.tmp`;
      writeFileSync(temp, JSON.stringify(document, null, 2));
      renameSync(temp, file);
    },
  };
}
export type Settings = ReturnType<typeof createSettings>;
