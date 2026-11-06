// Reads the fuses of a packaged executable and fails unless they are the release values.
//   node scripts/check-fuses.mjs <path to JAgentChill.app | JAgentChill.exe | jagentchill> [--allow-inspect]
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { FuseV1Options, getCurrentFuseWire } = require("@electron/fuses");
const target = process.argv[2];
if (!target) throw new Error("usage: check-fuses.mjs <packaged app>");
const wire = await getCurrentFuseWire(target);
const want = { RunAsNode: false, EnableNodeOptionsEnvironmentVariable: process.argv.includes("--allow-inspect"), EnableNodeCliInspectArguments: process.argv.includes("--allow-inspect"), OnlyLoadAppFromAsar: true, EnableEmbeddedAsarIntegrityValidation: true, EnableCookieEncryption: true };
let bad = 0;
for (const [name, expected] of Object.entries(want)) {
  const enabled = wire[FuseV1Options[name]] === 49; // '1'
  const ok = enabled === expected;
  if (!ok) bad++;
  console.log(`${ok ? "✔" : "✖"} ${name}: ${enabled ? "enabled" : "disabled"}`);
}
process.exit(bad ? 1 : 0);
