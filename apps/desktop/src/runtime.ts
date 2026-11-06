import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { nodeVersionSupported } from "@jagentchill/desktop-core";

export type HostRuntime = {
  /** A real Node executable. Never Electron's own: the agent CLIs and their shell tooling misbehave under it. */
  node: string;
  serverEntry: string;
  ffmpeg: string | null;
  ffprobe: string | null;
  /** The app's own executable, which is the render host. */
  renderHost: string;
  /** The local image engine the macOS app ships (stable-diffusion.cpp for macOS 14+); null when absent. */
  sdEngine?: string | null;
};
export type RuntimeCheck = { ok: true; runtime: HostRuntime; warnings: string[] } | { ok: false; missing: string[] };

const executable = (path: string): boolean => {
  try { accessSync(path, process.platform === "win32" ? constants.F_OK : constants.X_OK); return true; } catch { return false; }
};
const onPath = (name: string, env: NodeJS.ProcessEnv): string | null => {
  const names = process.platform === "win32" ? [`${name}.exe`, `${name}.cmd`] : [name];
  for (const directory of (env.PATH ?? "").split(delimiter).filter(Boolean)) for (const file of names) if (executable(join(directory, file))) return join(directory, file);
  return null;
};

/**
 * Where the host's runtime lies. A packaged app carries all of it in its resources; a development run uses the
 * repository's server and a Node from `JAGENTCHILL_NODE_PATH` or the PATH.
 */
export function locateRuntime(input: { packaged: boolean; resourcesPath: string; repoRoot: string; execPath: string; env: NodeJS.ProcessEnv }): RuntimeCheck {
  const exe = process.platform === "win32" ? ".exe" : "";
  const candidate: { node: string | null; serverEntry: string; ffmpeg: string | null; ffprobe: string | null } = input.packaged
    ? {
      node: join(input.resourcesPath, "node", process.platform === "win32" ? "node.exe" : join("bin", "node")),
      serverEntry: join(input.resourcesPath, "server", "lib", "app", "jagentchill-server.mjs"),
      ffmpeg: join(input.resourcesPath, "ffmpeg", `ffmpeg${exe}`),
      ffprobe: join(input.resourcesPath, "ffmpeg", `ffprobe${exe}`),
    }
    : {
      node: input.env.JAGENTCHILL_NODE_PATH ?? onPath("node", input.env),
      serverEntry: join(input.repoRoot, "server", "src", "main.ts"),
      ffmpeg: onPath("ffmpeg", input.env),
      ffprobe: onPath("ffprobe", input.env),
    };
  const missing: string[] = [];
  if (!candidate.node || !executable(candidate.node) || candidate.node === input.execPath) missing.push("node");
  else {
    try {
      const version = execFileSync(candidate.node, ["--version"], { encoding: "utf8", timeout: 10_000, env: { ...input.env, ELECTRON_RUN_AS_NODE: undefined } as NodeJS.ProcessEnv });
      if (!nodeVersionSupported(version)) missing.push(`node (${version.trim()} is not >=24.16)`);
    } catch { missing.push("node"); }
  }
  if (!existsSync(candidate.serverEntry)) missing.push("server");
  if (missing.length) return { ok: false, missing };
  const ffmpeg = candidate.ffmpeg && executable(candidate.ffmpeg) ? candidate.ffmpeg : null;
  const ffprobe = candidate.ffprobe && executable(candidate.ffprobe) ? candidate.ffprobe : null;
  const sdCandidate = input.packaged ? join(input.resourcesPath, "sd-engine", "sd-cli") : join(input.repoRoot, ".dev", "build", "sd-engine", "master-975-95b3090", "sd-cli");
  const sdEngine = process.platform === "darwin" && executable(sdCandidate) ? sdCandidate : null;
  return {
    ok: true, warnings: ffmpeg && ffprobe ? [] : ["ffmpeg_missing"],
    runtime: { node: candidate.node!, serverEntry: candidate.serverEntry, ffmpeg, ffprobe, renderHost: input.execPath, sdEngine },
  };
}
