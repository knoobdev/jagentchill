import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const moduleDir = path.join(root, "server/go/tsnet-bridge");
const value = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const goos = value("goos") ?? process.platform;
const goarch = value("goarch") ?? process.arch;
const output = path.resolve(value("output") ?? path.join(root, ".dev/build/jagentchill-tsnet-bridge"));
mkdirSync(path.dirname(output), { recursive: true });
const result = spawnSync("go", ["build", "-trimpath", "-o", output, "."], {
  cwd: moduleDir, stdio: "inherit",
  env: { ...process.env, CGO_ENABLED: "0", GOOS: goos, GOARCH: goarch },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
