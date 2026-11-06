import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

/**
 * The PATH the person's own terminal has. An app opened from Finder or the Dock gets only the system directories, so
 * the host would not find the CLIs installed for the person (Claude Code, Codex, OpenCode, ffmpeg, …). The login shell
 * is asked once; the usual per-user and package-manager directories are the fallback when it does not answer.
 */
let cached: Promise<string> | undefined;

export function mergePaths(...lists: string[]): string {
  const seen = new Set<string>();
  for (const list of lists) for (const entry of list.split(delimiter)) if (entry && !seen.has(entry)) seen.add(entry);
  return [...seen].join(delimiter);
}

export function userPath(base: string = process.env.PATH ?? "", platform: NodeJS.Platform = process.platform): Promise<string> {
  if (platform === "win32") return Promise.resolve(base);
  cached ??= new Promise<string>((resolve) => {
    const home = homedir();
    const fallback = [join(home, ".local", "bin"), join(home, "bin"), "/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin"].join(delimiter);
    const shell = process.env.SHELL || (platform === "darwin" ? "/bin/zsh" : "/bin/bash");
    execFile(shell, ["-ilc", 'printf "__JAGENTCHILL_PATH__%s__END__" "$PATH"'], { timeout: 8000, env: { ...process.env, TERM: "dumb" } }, (_error, stdout) => {
      const found = /__JAGENTCHILL_PATH__(.*?)__END__/s.exec(String(stdout ?? ""))?.[1] ?? "";
      resolve(mergePaths(found, base, fallback));
    });
  });
  return cached;
}
