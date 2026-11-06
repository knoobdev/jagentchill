// Bundles JAgentChill Server with its production dependencies into one ES module the bundled Node runs:
// <out>/jagentchill-server.mjs. The server drives the agent CLIs itself; nothing else runs beside it.
import { build } from "esbuild";
import { cpSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const out = resolve(process.argv[2] ?? join(repo, ".dev/build/desktop-stage/server"));
await build({
  entryPoints: [join(repo, "server/src/main.ts")], outfile: join(out, "lib/app/jagentchill-server.mjs"), bundle: true, platform: "node", format: "esm", target: "node24",
  // CommonJS dependencies (ws) expect `require`.
  banner: { js: "import { createRequire as __jcRequire } from 'node:module'; const require = __jcRequire(import.meta.url);" },
  logLevel: "warning", legalComments: "none",
});
// The server reads its data tables and the bundled skills two levels above its own file, as in the repository.
cpSync(join(repo, "server/data"), join(out, "data"), { recursive: true });
if (existsSync(join(repo, "skills"))) cpSync(join(repo, "skills"), join(out, "skills"), { recursive: true });
console.log(`built ${join(out, "lib/app/jagentchill-server.mjs")}`);
