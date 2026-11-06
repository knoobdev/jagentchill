// Puts the Node runtime the packaged app ships into <repo>/.dev/build/desktop-runtime/<platform>-<arch>/node.
//   node scripts/fetch-node.mjs [--platform darwin|win32|linux] [--arch arm64|x64] [--version 24.17.0] [--from-local]
// The official archive is downloaded from nodejs.org and checked against the release's SHASUMS256.txt. `--from-local`
// copies the Node that runs this script instead (same platform and architecture only): for a local, unsigned build.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const arg = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : fallback; };
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const platform = arg("platform", process.platform), arch = arg("arch", process.arch), version = arg("version", process.versions.node);
const [major, minor] = version.split(".").map(Number);
if (!((major === 24 && minor >= 16) || (major === 26 && minor >= 1) || major > 26)) throw new Error(`Node ${version} is not >=24.16.0 <25 || >=26.1.0`);
const out = join(repo, ".dev/build/desktop-runtime", `${platform}-${arch}`, "node");
const binary = platform === "win32" ? join(out, "node.exe") : join(out, "bin", "node");
mkdirSync(dirname(binary), { recursive: true });

if (process.argv.includes("--from-local")) {
  if (platform !== process.platform || arch !== process.arch) throw new Error("--from-local copies this machine's Node: the platform and architecture must be this machine's");
  copyFileSync(process.execPath, binary);
  chmodSync(binary, 0o755);
} else {
  const name = platform === "win32" ? `node-v${version}-win-${arch}.zip` : `node-v${version}-${platform}-${arch}.tar.gz`;
  const base = `https://nodejs.org/dist/v${version}`;
  const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text();
  const expected = sums.split("\n").find((line) => line.endsWith(`  ${name}`))?.split(" ")[0];
  if (!expected) throw new Error(`${name} is not listed in SHASUMS256.txt`);
  const archive = Buffer.from(await (await fetch(`${base}/${name}`)).arrayBuffer());
  const actual = createHash("sha256").update(archive).digest("hex");
  if (actual !== expected) throw new Error(`checksum mismatch for ${name}: ${actual}`);
  const file = join(dirname(out), name);
  writeFileSync(file, archive);
  const inner = name.replace(/\.(tar\.gz|zip)$/, "");
  if (platform === "win32") execFileSync("tar", ["-xf", file, "-C", out, "--strip-components=1", `${inner}/node.exe`]);
  else execFileSync("tar", ["-xzf", file, "-C", out, "--strip-components=1", `${inner}/bin/node`, `${inner}/LICENSE`]);
}
if (!existsSync(binary)) throw new Error(`no Node binary at ${binary}`);
writeFileSync(join(out, "VERSION"), `${version}\n`);
console.log(`${binary} (Node ${version}, sha256 ${createHash("sha256").update(readFileSync(binary)).digest("hex").slice(0, 16)}…)`);
