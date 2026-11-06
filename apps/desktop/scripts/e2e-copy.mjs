// Makes the copy of a local build that the Playwright checks drive: identical, except that the fuse
// EnableNodeCliInspectArguments and EnableNodeOptionsEnvironmentVariable are left ON — Playwright attaches to the main
// process through `--inspect` and loads its hook with `-r`, which the release fuses forbid. Never ship this copy. Usage: node scripts/e2e-copy.mjs <JAgentChill.app> <copy.app>
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { FuseV1Options, FuseVersion, flipFuses } = require("@electron/fuses");
const [from, to] = process.argv.slice(2);
if (process.platform !== "darwin") throw new Error("this helper clones a macOS app bundle");
if (existsSync(to)) throw new Error(`${to} exists`);
execFileSync("cp", ["-cR", from, to]);
await flipFuses(to, { version: FuseVersion.V1, resetAdHocDarwinSignature: true, [FuseV1Options.EnableNodeCliInspectArguments]: true, [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: true });
console.log(`e2e copy at ${to}`);
