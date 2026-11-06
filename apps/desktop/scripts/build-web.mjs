// Builds the web export the desktop shell loads, with the Electron platform flag (`*.electron.ts(x)` files win).
// Output: <repo>/.dev/build/web-desktop, or the directory given as the first argument.
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const out = resolve(process.argv[2] ?? join(repo, ".dev/build/web-desktop"));
const result = spawnSync("npx", ["expo", "export", "--platform", "web", "--output-dir", out], {
  cwd: join(repo, "apps/app"), stdio: "inherit", env: { ...process.env, JAGENTCHILL_TARGET: "electron" }, shell: process.platform === "win32",
});
if (result.status !== 0) process.exit(result.status ?? 1);
// The build's own record (version, build id, licence list). No service worker: the shell serves the export from its own scheme.
process.exit(spawnSync(process.execPath, [join(repo, "apps/app/scripts/finish-web-export.mjs"), out, "--desktop"], { stdio: "inherit" }).status ?? 1);
