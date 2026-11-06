import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";

export const LOG_FILE_BYTES = 10 * 1024 * 1024;
export const LOG_FILES = 5;

/**
 * A rotating log: `name.log` is the current file; at 10 MiB it becomes `name.1.log` and the older ones move up, five
 * files in all. The last lines are kept in memory for the record of an exit.
 */
export function createRotatingLog(file: string, opts: { maxBytes?: number; files?: number; keepLines?: number } = {}) {
  const maxBytes = opts.maxBytes ?? LOG_FILE_BYTES, files = opts.files ?? LOG_FILES, keep = opts.keepLines ?? 100;
  const numbered = (index: number) => (index === 0 ? file : file.replace(/(\.[^./\\]+)?$/, (extension) => `.${index}${extension}`));
  mkdirSync(dirname(file), { recursive: true });
  let size = existsSync(file) ? statSync(file).size : 0;
  let tail: string[] = [];
  let partial = "";
  const rotate = () => {
    rmSync(numbered(files - 1), { force: true });
    for (let index = files - 2; index >= 0; index--) if (existsSync(numbered(index))) renameSync(numbered(index), numbered(index + 1));
    size = 0;
  };
  return {
    file,
    write(chunk: string | Uint8Array): void {
      const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      const bytes = Buffer.byteLength(text);
      if (size > 0 && size + bytes > maxBytes) rotate();
      appendFileSync(file, text);
      size += bytes;
      const lines = (partial + text).split("\n");
      partial = lines.pop() ?? "";
      if (lines.length) tail = [...tail, ...lines].slice(-keep);
    },
    line(text: string): void { this.write(`${new Date().toISOString()} ${text}\n`); },
    /** The last complete lines written, oldest first. */
    lastLines: (): string[] => [...tail],
    paths: (): string[] => Array.from({ length: files }, (_unused, index) => numbered(index)),
  };
}
export type RotatingLog = ReturnType<typeof createRotatingLog>;
