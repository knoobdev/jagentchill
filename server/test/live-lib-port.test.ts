// The live scripts never reach a person's own server by default: without JAGENTCHILL_PORT their address is port 9
// (nothing listens there), and no script of server/scripts names 18910 as an address.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const scripts = new URL("../scripts/", import.meta.url).pathname;

test("w7 item 10: live-lib has no working default port — unset, it is port 9; set, it is that port — and no live script hardcodes 18910", () => {
  const baseWith = (env: Record<string, string | undefined>) => { const cleaned = { ...process.env, ...env }; for (const [key, value] of Object.entries(env)) if (value === undefined) delete cleaned[key]; return execFileSync(process.execPath, ["-e", `import(${JSON.stringify(`${scripts}live-lib.ts`)}).then((lib) => console.log(lib.BASE))`], { env: cleaned as NodeJS.ProcessEnv, encoding: "utf8" }).trim(); };
  assert.equal(baseWith({ JAGENTCHILL_PORT: undefined }), "http://127.0.0.1:9");
  assert.equal(baseWith({ JAGENTCHILL_PORT: "18940" }), "http://127.0.0.1:18940");
  const naming = readdirSync(scripts).filter((name) => /\.(ts|mjs)$/.test(name)).filter((name) => /(?:127\.0\.0\.1|localhost):18910|\?\?\s*"?18910/.test(readFileSync(`${scripts}${name}`, "utf8")));
  assert.deepEqual(naming, [], "scripts that name 18910 as an address or a default");
});
