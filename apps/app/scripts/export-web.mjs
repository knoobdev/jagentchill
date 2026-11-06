// The production web build for a browser: `expo export`, then the step that makes it work offline and know its version
// (scripts/finish-web-export.mjs). Usage: node scripts/export-web.mjs <output-dir> [--no-worker]
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (!process.argv[2]) { console.error("usage: node scripts/export-web.mjs <output-dir>"); process.exit(1); }
const out = resolve(process.argv[2]);
const run = (command, args) => spawnSync(command, args, { cwd: app, stdio: "inherit", shell: process.platform === "win32" }).status ?? 1;
const exported = run("npx", ["expo", "export", "--platform", "web", "--output-dir", out]);
process.exit(exported || run(process.execPath, [join(app, "scripts/finish-web-export.mjs"), out, ...process.argv.slice(3)]));
