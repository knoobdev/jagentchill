import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { checkBoundaries } from "../scripts/check-boundaries.ts";
import { repositoryRoot } from "./support/wasm.ts";

const script = join(import.meta.dirname, "../scripts/check-boundaries.ts");

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "jc-boundaries-"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(root, name, ".."), { recursive: true });
    writeFileSync(join(root, name), text);
  }
  return root;
}

test("Package boundaries — Forbidden import is rejected", () => {
  const root = fixture({
    "packages/editor-core/package.json": JSON.stringify({ name: "@jagentchill/editor-core", dependencies: {} }),
    "packages/editor-core/src/imports-render.ts": "import { buildScene } from \"../../render/src/index.ts\";\nexport const built = buildScene;\n",
    "packages/editor-core/src/imports-package.ts": "export const load = () => import(\"@jagentchill/render-wasm\");\n",
    "packages/editor-core/src/uses-dom.ts": [
      "export const title = () => document.title;",
      "export const wide = () => window.innerWidth;",
      "export const audio = () => new AudioContext();",
      "export const decoder = (init: unknown) => new VideoDecoder(init as never);",
      "export let device: GPUDevice | undefined;",
      "",
    ].join("\n"),
    // A local called `document` is the project document, not the DOM.
    "packages/editor-core/src/fine.ts": "export function name(document: { metadata: { name: string } }): string { const window = 3; return document.metadata.name + window; }\nexport const read = (value: { document: number }) => value.document;\n",
    "packages/render/src/index.ts": "export const buildScene = 1;\n",
  });
  try {
    const run = spawnSync(process.execPath, [script, "--root", root], { encoding: "utf8" });
    assert.notEqual(run.status, 0, "the check exits with a non-zero status");
    for (const [file, symbol] of [
      ["imports-render.ts", "../../render/src/index.ts"], ["imports-package.ts", "@jagentchill/render-wasm"], ["uses-dom.ts", "document"], ["uses-dom.ts", "window"],
      ["uses-dom.ts", "AudioContext"], ["uses-dom.ts", "VideoDecoder"], ["uses-dom.ts", "GPUDevice"],
    ]) {
      assert.ok(run.stderr.split("\n").some((line) => line.includes(`packages/editor-core/src/${file}`) && line.includes(`"${symbol}"`)), `the report names ${file} and ${symbol}:\n${run.stderr}`);
    }
    assert.ok(!run.stderr.includes("fine.ts"), "locals named like a global are not reported");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Package boundaries — the repository itself holds: editor-core is pure, render-wasm imports no TypeScript package, UI code uses the port", () => {
  assert.deepEqual(checkBoundaries(repositoryRoot), []);
});

test("Package boundaries — UI code that reaches past the EngineSurface port is rejected", () => {
  const root = fixture({
    "apps/app/src/preview.tsx": "import { createEngineSurface, buildScene } from \"@jagentchill/render\";\nimport { renderFrame } from \"@jagentchill/render-wasm\";\nexport const all = [createEngineSurface, buildScene, renderFrame];\n",
  });
  try {
    const symbols = checkBoundaries(root).map((violation) => violation.symbol);
    assert.deepEqual(symbols.sort(), ["@jagentchill/render-wasm", "buildScene"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Package boundaries — editor-core runs without a browser", async () => {
  // Node strips TypeScript with a wasm module, so a runtime without WebAssembly cannot load `.ts`: the suite is
  // first compiled to plain JavaScript, one bundle per test file, and those bundles run in a runtime whose DOM
  // globals and WebAssembly have been removed.
  const core = join(repositoryRoot, "packages/editor-core");
  const tests = readdirSync(join(core, "test")).filter((name) => name.endsWith(".test.ts"));
  const out = mkdtempSync(join(tmpdir(), "jc-no-browser-"));
  try {
    for (const name of tests) {
      await build({
        entryPoints: [join(core, "test", name)], outfile: join(out, name.replace(/\.ts$/, ".mjs")), bundle: true, platform: "node", format: "esm", logLevel: "silent",
        define: { "import.meta.url": JSON.stringify(pathToFileURL(join(core, "test", name)).href) },
      });
    }
    const env = { ...process.env, NODE_OPTIONS: `--import=${join(import.meta.dirname, "support/no-browser.mjs")}` };
    delete (env as Record<string, string | undefined>).NODE_TEST_CONTEXT;
    const probe = spawnSync(process.execPath, ["-e", "console.log(typeof WebAssembly, typeof document, typeof window)"], { env, encoding: "utf8" });
    assert.equal(probe.stdout.trim(), "undefined undefined undefined");
    const suite = () => spawnSync(process.execPath, ["--test", "--test-concurrency=1", "*.test.mjs"], { cwd: out, env, encoding: "utf8" });
    let run = suite();
    // The suite holds wall-clock budgets of its own (validation within 5 ms, …) that can miss while the browser
    // tests of this package load the machine. A run that failed without any missing-global error is repeated once.
    if (run.status !== 0 && !/is not defined|ERR_WEBASSEMBLY/.test(run.stdout + run.stderr)) run = suite();
    assert.equal(run.status, 0, run.stdout.slice(-4000) + run.stderr.slice(-2000));
    const passed = Number(/^ℹ pass (\d+)$/m.exec(run.stdout)?.[1] ?? /# pass (\d+)/.exec(run.stdout)?.[1]);
    assert.ok(passed > 200, `every editor-core test ran (${passed} passed)`);
    assert.match(run.stdout, /^ℹ fail 0$/m);
    assert.ok(!/is not defined|ERR_WEBASSEMBLY/.test(run.stdout + run.stderr), "no missing-global error");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("Package boundaries — editor-core compiles for Hermes (the bytecode compiler accepts the bundle; running it needs a device or a Hermes VM)", async () => {
  // Only the Hermes compiler ships with the toolchain. It proves that the syntax and the built-ins the module
  // uses at parse time (BigInt literals included) are accepted; execution on Hermes is a device check.
  const store = join(repositoryRoot, "node_modules/.pnpm");
  const compiler = readdirSync(store).filter((name) => name.startsWith("hermes-compiler@")).map((name) => join(store, name, "node_modules/hermes-compiler/hermesc", process.platform === "darwin" ? "osx-bin" : "linux64-bin", "hermesc"))[0];
  if (!compiler) return;
  const out = mkdtempSync(join(tmpdir(), "jc-hermes-"));
  try {
    await build({ entryPoints: [join(repositoryRoot, "packages/editor-core/src/index.ts")], outfile: join(out, "core.js"), bundle: true, format: "iife", target: "es2020", logLevel: "silent" });
    const run = spawnSync(compiler, ["-emit-binary", "-out", join(out, "core.hbc"), join(out, "core.js")], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr.slice(0, 2000));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
