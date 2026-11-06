// Test support for skills. The server reads the skill folders itself (its managed root and the folder of the skills
// this product ships); there is no agent engine to stand in for, so these are only helpers that write folders and run git.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The managed root of a server on `dataDir`: where it installs, authors and forks skills. */
export const managedSkillsDir = (dataDir: string): string => join(dataDir, "skills", "managed");

export function writeSkill(root: string, name: string, description: string, body = "Follow these steps.\n", files: Record<string, string> = {}): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}`);
  for (const [path, content] of Object.entries(files)) { mkdirSync(join(dir, path, ".."), { recursive: true }); writeFileSync(join(dir, path), content); }
  return dir;
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "init.defaultBranch=main", "-c", "commit.gpgsign=false", "-c", "protocol.file.allow=always", ...args], { cwd, encoding: "utf8" }).trim();
}
