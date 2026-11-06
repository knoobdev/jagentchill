import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { SKILL_LIMITS, type SkillSourceKind } from "@jagentchill/protocol";
import { ProtocolError } from "../errors.ts";
import { copySkill, parseSkillMd } from "./folder.ts";

export type StoredSource = { id: string; kind: SkillSourceKind; label: string; enabled: boolean; url?: string; ref?: string; subPath?: string; path?: string };
/**
 * The kinds of source this server reads. The skill registry the removed agent engine searched for the server (ClawHub)
 * is no longer offered: a stored source of that kind is ignored, and one cannot be added.
 */
export const OFFERED_SOURCE_KINDS: readonly SkillSourceKind[] = ["git", "local"];
export const isOfferedSource = (source: { kind: SkillSourceKind }) => OFFERED_SOURCE_KINDS.includes(source.kind);
export const DEFAULT_SOURCES: StoredSource[] = [
  { id: "anthropic-skills", kind: "git", label: "Anthropic skills", enabled: false, url: "https://github.com/anthropics/skills" },
  { id: "openai-skills", kind: "git", label: "OpenAI skills", enabled: false, url: "https://github.com/openai/skills" },
];

/** One skill a source offers. `path` is where its folder is inside the source. */
export type SourceItem = { name: string; description: string; version?: string; revision?: string; author?: string; path: string; reference: string };
export type Listing = { items: SourceItem[]; revision?: string; fetched_ms: number };
export type GitRunner = (args: string[], opts: { cwd?: string; timeoutMs: number }) => Promise<{ code: number; stdout: string; stderr: string }>;

/** The host's git with prompts off and no credential helper: a repository that needs a login fails instead of asking. */
export const runGit: GitRunner = (args, opts) => new Promise((resolve) => {
  execFile("git", ["-c", "credential.helper=", "-c", "core.askPass=", ...args], {
    cwd: opts.cwd, timeout: opts.timeoutMs, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "echo" },
  }, (error, stdout, stderr) => resolve({ code: error ? (typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : 1) : 0, stdout: String(stdout), stderr: String(stderr) }));
});

export function fetchFailed(sourceId: string, cause: string): ProtocolError {
  return new ProtocolError("skill/source-fetch-failed", "The source could not be read.", { retryable: true, details: { sourceId, cause: cause.replace(/\/\/[^/@\s]+@/g, "//").slice(0, 300) } });
}

export type SourceReaderDeps = { cacheDir: string; git: GitRunner; now: () => number };

/** Reads what a source offers and fetches one skill of it. Listing reads `SKILL.md` front matter only. */
export function createSourceReader(deps: SourceReaderDeps) {
  const frontMatter = (text: string, fallbackName: string) => {
    const parsed = parseSkillMd(text);
    return { name: parsed?.name ?? fallbackName, description: parsed?.description ?? "", ...(parsed?.version ? { version: parsed.version } : {}) };
  };

  function listLocal(source: StoredSource): Listing {
    const root = source.path!;
    if (!existsSync(root) || !statSync(root).isDirectory()) throw fetchFailed(source.id, "The folder does not exist on the host");
    const items: SourceItem[] = [];
    for (const name of readdirSync(root).sort()) {
      const file = join(root, name, "SKILL.md");
      if (!existsSync(file)) continue;
      // Only the head of the file is read: the front matter is all a listing needs.
      const head = readHead(file);
      items.push({ ...frontMatter(head, name), name, path: join(root, name), reference: join(root, name) });
    }
    return { items, fetched_ms: deps.now() };
  }

  const repoDir = (source: StoredSource) => join(deps.cacheDir, source.id);
  async function git(source: StoredSource, args: string[], cwd?: string, timeoutMs: number = SKILL_LIMITS.listingTimeoutMs): Promise<string> {
    const result = await deps.git(args, { cwd, timeoutMs });
    if (result.code !== 0) throw fetchFailed(source.id, result.stderr.trim() || `git ${args[0]} failed`);
    return result.stdout;
  }
  /** A shallow clone without file contents; `revision` moves it to a branch, tag or commit of the remote. */
  async function syncRepo(source: StoredSource, revision?: string): Promise<string> {
    const dir = repoDir(source);
    if (!existsSync(join(dir, ".git"))) {
      mkdirSync(dirname(dir), { recursive: true });
      await git(source, ["clone", "--depth", "1", "--filter=blob:none", "--no-checkout", ...(source.ref && !revision ? ["--branch", source.ref] : []), source.url!, dir], undefined, 120_000);
    }
    const wanted = revision ?? source.ref;
    await git(source, ["fetch", "--depth", "1", "--filter=blob:none", "origin", wanted ?? "HEAD"], dir, 120_000);
    return (await git(source, ["rev-parse", "FETCH_HEAD"], dir)).trim();
  }
  async function listGit(source: StoredSource): Promise<Listing> {
    const dir = repoDir(source);
    const revision = await syncRepo(source);
    const prefix = source.subPath ? `${source.subPath.replace(/^\/+|\/+$/g, "")}/` : "";
    const paths = (await git(source, ["ls-tree", "-r", "--name-only", revision], dir)).split("\n")
      .filter((path) => path.startsWith(prefix) && /(^|\/)SKILL\.md$/.test(path) && path.slice(prefix.length).split("/").length <= 3);
    const items: SourceItem[] = [];
    for (const path of paths) {
      const folder = path.replace(/\/?SKILL\.md$/, "");
      const name = folder.split("/").pop() || source.id;
      items.push({ ...frontMatter(await git(source, ["show", `${revision}:${path}`], dir), name), name, revision, path: folder, reference: `${source.url}@${revision.slice(0, 12)}${folder ? `:${folder}` : ""}` });
    }
    return { items, revision, fetched_ms: deps.now() };
  }

  return {
    async list(source: StoredSource): Promise<Listing> {
      if (source.kind === "local") return listLocal(source);
      if (source.kind === "git") return listGit(source);
      throw new ProtocolError("UNSUPPORTED_FEATURE", "Skills cannot be listed from this source.");
    },
    /** The current revision of one skill at its source, without fetching its content. */
    async revisionOf(source: StoredSource, item: SourceItem): Promise<string | undefined> {
      if (source.kind === "git") return syncRepo(source);
      return item.revision;
    },
    /** Writes the skill's folder to `target`. For a git source the files of that folder are read at the resolved commit. */
    async fetch(source: StoredSource, item: SourceItem, target: string, revision?: string): Promise<{ revision?: string }> {
      if (source.kind === "local") {
        if (!existsSync(join(item.path, "SKILL.md"))) throw fetchFailed(source.id, "The skill folder is no longer at the source");
        copySkill(item.path, target);
        return {};
      }
      if (source.kind !== "git") throw new ProtocolError("UNSUPPORTED_FEATURE", "Skills cannot be fetched from this source.");
      const dir = repoDir(source);
      const commit = await syncRepo(source, revision);
      const prefix = item.path ? `${item.path}/` : "";
      const listing = (await git(source, ["ls-tree", "-r", "-z", commit, ...(item.path ? [item.path] : [])], dir)).split("\0").filter(Boolean);
      let total = 0;
      for (const line of listing) {
        const entry = /^(\d+) (\w+) ([0-9a-f]+)\t(.+)$/.exec(line);
        if (!entry || entry[2] !== "blob") continue;
        const rel = entry[4].slice(prefix.length);
        if (rel.split("/").some((part) => part === ".." || part === "")) throw new ProtocolError("skill/invalid", "Unsafe path in archive", { details: { reason: "Unsafe path in archive" } });
        const data = await new Promise<Buffer>((resolve, reject) => execFile("git", ["cat-file", "blob", entry[3]], { cwd: dir, encoding: "buffer", maxBuffer: SKILL_LIMITS.folderBytes + 1024, timeout: 120_000 }, (error, stdout) => (error ? reject(fetchFailed(source.id, error.message)) : resolve(stdout))));
        total += data.length;
        if (total > SKILL_LIMITS.folderBytes) throw new ProtocolError("skill/too-large", "This skill is larger than 20 MiB.", { details: { limit: "20 MiB" } });
        mkdirSync(dirname(join(target, rel)), { recursive: true });
        writeFileSync(join(target, rel), data, { mode: entry[1] === "100755" ? 0o755 : 0o644 });
      }
      if (!existsSync(join(target, "SKILL.md"))) throw fetchFailed(source.id, "The skill folder is no longer at the source");
      return { revision: commit };
    },
  };
}

/** The front matter of a `SKILL.md`, without the instructions that follow it. */
function readHead(file: string): string {
  const text = readFileSync(file, "utf8").slice(0, 64 * 1024);
  const end = text.indexOf("\n---", 4);
  return end < 0 ? text.slice(0, 8192) : text.slice(0, end + 5);
}

