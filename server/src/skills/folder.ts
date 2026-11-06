import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { crc32 } from "node:zlib";
import { SKILL_LIMITS, SKILL_NAME_PATTERN, type SkillCard, type SkillFile, type SkillLesson } from "@jagentchill/protocol";
import { ProtocolError } from "../errors.ts";

/** The file the server leaves in every folder it installs or authors. It is not part of the content hash or of an export. */
export const MARKER = ".jagentchill-skill.json";
const SCRIPT_EXTENSIONS = new Set([".sh", ".bash", ".zsh", ".ps1", ".bat", ".cmd", ".py", ".js", ".mjs", ".ts", ".rb", ".pl"]);
const OS_METADATA = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);
/** Files an export never carries. */
export const EXPORT_EXCLUDED = [/^\.env/, /\.pem$/, /\.key$/, /^id_rsa/, /^credentials/, /^secrets/];
const LESSONS_HEADING = "## Lessons";

export type FrontMatter = { name?: string; description?: string; version?: string; body: string; raw: string };

/** Reads the front matter of a `SKILL.md`: flat `key: value` lines, values plain or quoted. Returns `null` when it has none. */
export function parseSkillMd(text: string): FrontMatter | null {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) return null;
  const fields: Record<string, string> = {};
  const lines = match[1].split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const pair = /^([A-Za-z][\w-]*):[ \t]*(.*)$/.exec(lines[index]);
    if (!pair) continue;
    let value = pair[2].trim();
    // A folded or literal block: the indented lines that follow belong to the value.
    if (/^[>|][+-]?$/.test(value) || value === "") {
      const parts: string[] = [];
      while (index + 1 < lines.length && /^[ \t]+\S/.test(lines[index + 1])) parts.push(lines[++index].trim());
      value = parts.join(" ");
    } else if (/^".*"$/.test(value)) {
      try { value = JSON.parse(value) as string; } catch { value = value.slice(1, -1); }
    } else if (/^'.*'$/.test(value)) value = value.slice(1, -1).replace(/''/g, "'");
    fields[pair[1]] = value;
  }
  return { name: fields.name, description: fields.description, version: fields.version, body: text.slice(match[0].length), raw: text };
}

const quote = (value: string) => (/^[\w .,()/+-]+$/.test(value) && !/^[\d-]/.test(value) && !/: /.test(value) ? value : JSON.stringify(value));
export function buildSkillMd(input: { name: string; description: string; version?: string; body: string }): string {
  return `---\nname: ${input.name}\ndescription: ${quote(input.description)}\n${input.version ? `version: ${quote(input.version)}\n` : ""}---\n\n${input.body.replace(/^\s+/, "").replace(/\s*$/, "")}\n`;
}
/** The same file under another name: only the `name` line of the front matter changes. */
export function renameSkillMd(text: string, name: string): string {
  return text.replace(/^(﻿?---\r?\n[\s\S]*?)^name:.*$/m, (_all, head: string) => `${head}name: ${name}`);
}

/** The lessons of a `SKILL.md`: the bullets under its `## Lessons` section, in order. */
export function readLessons(body: string): SkillLesson[] {
  const start = body.lastIndexOf(`\n${LESSONS_HEADING}`);
  if (start < 0 && !body.startsWith(LESSONS_HEADING)) return [];
  const section = body.slice(start < 0 ? 0 : start + 1).split(/\r?\n/).slice(1);
  const lessons: SkillLesson[] = [];
  for (const line of section) {
    if (/^#{1,6} /.test(line)) break;
    const bullet = /^- (?:\((\d{4}-\d{2}-\d{2})\) )?(.+)$/.exec(line.trim());
    if (bullet) lessons.push({ lessonId: createHash("sha256").update(`${lessons.length}:${bullet[2]}`).digest("hex").slice(0, 12), date: bullet[1] ?? "", text: bullet[2] });
  }
  return lessons;
}
/** The text with its `## Lessons` section replaced by these lessons (removed when there are none). */
export function writeLessons(text: string, lessons: Array<{ text: string; date: string }>): string {
  const start = text.lastIndexOf(`\n${LESSONS_HEADING}`);
  const head = (start < 0 ? text : text.slice(0, start)).replace(/\s*$/, "");
  if (!lessons.length) return `${head}\n`;
  return `${head}\n\n${LESSONS_HEADING}\n\n${lessons.map((lesson) => `- ${lesson.date ? `(${lesson.date}) ` : ""}${lesson.text}`).join("\n")}\n`;
}

export type FolderScan = { files: SkillFile[]; fileCount: number; sizeBytes: number; hasScripts: boolean; contentHash: string };

function invalid(reason: string): ProtocolError {
  return new ProtocolError("skill/invalid", reason, { details: { reason } });
}

/**
 * Walks a skill folder. Refuses what an install must never carry: a link that leaves the folder, a device or a socket,
 * more files or bytes than a skill may have. The hash covers the sorted relative paths and the digest of every file.
 */
export function scanFolder(dir: string): FolderScan {
  const root = realpathSync(dir);
  const files: SkillFile[] = [];
  let sizeBytes = 0;
  const digest = createHash("sha256");
  const walk = (current: string) => {
    for (const name of readdirSync(current).sort()) {
      if (name === ".git" || name === MARKER || OS_METADATA.has(name)) continue;
      const path = join(current, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) {
        const target = realpathSync(path);
        if (target !== root && !target.startsWith(root + sep)) throw invalid("A link in this skill points outside its folder");
        continue;
      }
      if (stat.isDirectory()) { walk(path); continue; }
      if (!stat.isFile()) throw invalid("Unsupported file type in this skill");
      const rel = relative(root, path).split(sep).join("/");
      sizeBytes += stat.size;
      if (files.length + 1 > SKILL_LIMITS.folderFiles) throw new ProtocolError("skill/too-large", "This skill has more than 2,000 files.", { details: { limit: "2000 files" } });
      if (sizeBytes > SKILL_LIMITS.folderBytes) throw new ProtocolError("skill/too-large", "This skill is larger than 20 MiB.", { details: { limit: "20 MiB" } });
      const script = (stat.mode & 0o111) !== 0 || SCRIPT_EXTENSIONS.has(/\.[^.]+$/.exec(name)?.[0].toLowerCase() ?? "");
      files.push({ path: rel, sizeBytes: stat.size, script });
      digest.update(`${rel}\0${createHash("sha256").update(readFileSync(path)).digest("hex")}\n`);
    }
  };
  walk(root);
  return { files, fileCount: files.length, sizeBytes, hasScripts: files.some((file) => file.script), contentHash: digest.digest("hex") };
}

export type SkillFolder = FolderScan & { dir: string; folderName: string; name: string; description: string; version?: string; status: "ok" | "invalid"; invalidReason?: string; markdown: string };

/** What a folder is as a skill. A folder that breaks a rule of the skill model is returned as `invalid` with the reason. */
export function readSkillFolder(dir: string): SkillFolder {
  const folderName = dir.split(sep).filter(Boolean).pop() ?? "";
  const scan = scanFolder(dir);
  const file = join(dir, "SKILL.md");
  const base = { ...scan, dir, folderName, name: folderName, description: "", markdown: "" };
  if (!existsSync(file)) return { ...base, status: "invalid", invalidReason: "SKILL.md is missing" };
  if (lstatSync(file).size > SKILL_LIMITS.skillMdBytes) return { ...base, status: "invalid", invalidReason: "SKILL.md is larger than 256 KiB" };
  const markdown = readFileSync(file, "utf8");
  const parsed = parseSkillMd(markdown);
  if (!parsed) return { ...base, markdown, status: "invalid", invalidReason: "SKILL.md has no readable front matter" };
  const found = { ...base, markdown, name: parsed.name ?? folderName, description: parsed.description ?? "", ...(parsed.version ? { version: parsed.version } : {}) };
  const reason = !parsed.name || !SKILL_NAME_PATTERN.test(parsed.name) || parsed.name.length > SKILL_LIMITS.name ? "The name in SKILL.md is not a valid skill name"
    : parsed.name !== folderName ? "The name in SKILL.md must match the folder name"
    : !parsed.description ? "SKILL.md has no description"
    : parsed.description.length > SKILL_LIMITS.description ? "The description is longer than 1,024 characters" : undefined;
  return reason ? { ...found, status: "invalid", invalidReason: reason } : { ...found, status: "ok" };
}

export function cardOf(folder: SkillFolder): SkillCard {
  const parsed = parseSkillMd(folder.markdown);
  return {
    name: folder.name, description: folder.description, ...(folder.version ? { version: folder.version } : {}), markdown: folder.markdown,
    // Scripts lead the list: they are what a person decides about.
    files: [...folder.files].sort((a, b) => Number(b.script) - Number(a.script) || a.path.localeCompare(b.path)),
    hasScripts: folder.hasScripts, fileCount: folder.fileCount, sizeBytes: folder.sizeBytes, contentHash: folder.contentHash, lessons: readLessons(parsed?.body ?? ""),
  };
}

/** Copies a skill folder without `.git`, OS metadata and the server's marker. */
export function copySkill(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true, filter: (source) => { const name = source.split(sep).pop() ?? ""; return name !== ".git" && name !== MARKER && !OS_METADATA.has(name); } });
}

/** Puts a prepared folder in place of `target` in one rename; the folder it replaces, when there is one, is moved to `keepAt`. */
export function swapInto(staged: string, target: string, keepAt?: string): void {
  mkdirSync(dirname(target), { recursive: true });
  if (existsSync(target)) {
    if (!keepAt) throw new Error("the target exists");
    mkdirSync(dirname(keepAt), { recursive: true });
    rmSync(keepAt, { recursive: true, force: true });
    renameSync(target, keepAt);
  }
  renameSync(staged, target);
}

export function writeJsonAtomic(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(temp, file);
}

/** True when `path` is `root` or lies inside it, comparing resolved paths. */
export function isInside(path: string, root: string): boolean {
  const real = (value: string) => { try { return realpathSync(value); } catch { return resolve(value); } };
  const a = real(path), b = real(root);
  return a === b || a.startsWith(b + sep);
}

/** A `.zip` of the folder with one top-level directory `<name>/`, stored without compression. */
export function zipFolder(dir: string, name: string, exclude: (relativePath: string) => boolean = () => false): { bytes: Buffer; excluded: string[] } {
  const scan = scanFolder(dir);
  const local: Buffer[] = [], central: Buffer[] = [], excluded: string[] = [];
  let offset = 0;
  for (const file of scan.files) {
    if (exclude(file.path)) { excluded.push(file.path); continue; }
    const data = readFileSync(join(dir, file.path));
    const path = Buffer.from(`${name}/${file.path}`, "utf8");
    const checksum = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6); header.writeUInt16LE(0, 8);
    header.writeUInt32LE(0x00210000, 10); header.writeUInt32LE(checksum, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(path.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(0x0314, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x0800, 8); entry.writeUInt16LE(0, 10);
    entry.writeUInt32LE(0x00210000, 12); entry.writeUInt32LE(checksum, 16); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(path.length, 28);
    entry.writeUInt32LE((file.script ? 0o100755 : 0o100644) * 65536, 38); entry.writeUInt32LE(offset, 42);
    local.push(header, path, data);
    central.push(entry, path);
    offset += header.length + path.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return { bytes: Buffer.concat([...local, directory, end]), excluded };
}
