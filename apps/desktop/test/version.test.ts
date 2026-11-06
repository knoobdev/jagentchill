import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repo = resolve(import.meta.dirname, "../../..");
const json = (path: string) => JSON.parse(readFileSync(join(repo, path), "utf8"));
const version: string = json("apps/desktop/package.json").version;

test("one version: the app's own manifests carry the version of apps/desktop/package.json", () => {
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(json("apps/app/package.json").version, version);
  assert.equal(json("apps/app/app.json").expo.version, version);
});

test("finishing a web export writes the build record, the licence list and the worker's file list; a desktop export ships no worker", () => {
  const out = mkdtempSync(join(tmpdir(), "jc-export-"));
  try {
    mkdirSync(join(out, "_expo/static/js/web"), { recursive: true });
    writeFileSync(join(out, "index.html"), "<!doctype html><html><head><meta charset=\"utf-8\" /></head><body><script src=\"/_expo/static/js/web/entry-0123456789abcdef0123456789abcdef.js\"></script></body></html>");
    writeFileSync(join(out, "_expo/static/js/web/entry-0123456789abcdef0123456789abcdef.js"), "console.log(1)");
    writeFileSync(join(out, "_expo/static/js/web/entry-0123456789abcdef0123456789abcdef.js.map"), "{}");
    writeFileSync(join(out, "metadata.json"), "{}");
    const finish = (...flags: string[]) => spawnSync(process.execPath, [join(repo, "apps/app/scripts/finish-web-export.mjs"), out, ...flags], { encoding: "utf8" });
    const first = finish();
    assert.equal(first.status, 0, first.stderr);
    const build = JSON.parse(readFileSync(join(out, "build.json"), "utf8"));
    assert.equal(build.version, version);
    assert.match(build.buildId, /^[0-9a-f]{12}$/);
    assert.ok(Math.abs(build.builtAt_ms - Date.now()) < 120_000);
    const worker = readFileSync(join(out, "sw.js"), "utf8");
    const written = JSON.parse(/const BUILD = (\{.*?\});/.exec(worker)![1]);
    assert.equal(written.id, build.buildId);
    // The page names its build, once: it is what the page tags its workers' files with.
    const metas = () => readFileSync(join(out, "index.html"), "utf8").match(/<meta name="jagentchill-build" content="([0-9a-f]+)">/g) ?? [];
    assert.deepEqual(metas(), [`<meta name="jagentchill-build" content="${build.buildId}">`]);
    assert.deepEqual(written.files, ["_expo/static/js/web/entry-0123456789abcdef0123456789abcdef.js", "index.html", "licences.json", "build.json"]);
    const licences = JSON.parse(readFileSync(join(out, "licences.json"), "utf8")).packages as { name: string; version: string; licence: string }[];
    assert.ok(licences.length > 100);
    for (const name of ["react", "expo", "react-native-web"]) assert.ok(licences.some((entry) => entry.name === name && entry.licence), `${name} is listed`);
    assert.ok(licences.every((entry) => !entry.name.startsWith("@jagentchill/")));
    // The id names the content: the same files give the same id, a changed file a new one.
    assert.equal(finish().status, 0);
    assert.equal(JSON.parse(readFileSync(join(out, "build.json"), "utf8")).buildId, build.buildId);
    assert.deepEqual(metas(), [`<meta name="jagentchill-build" content="${build.buildId}">`], "finishing twice writes it once and keeps the id");
    writeFileSync(join(out, "_expo/static/js/web/entry-0123456789abcdef0123456789abcdef.js"), "console.log(2)");
    assert.equal(finish().status, 0);
    assert.notEqual(JSON.parse(readFileSync(join(out, "build.json"), "utf8")).buildId, build.buildId);
    assert.equal(finish("--desktop").status, 0);
    assert.equal(existsSync(join(out, "sw.js")), false);
    assert.equal(existsSync(join(out, "build.json")), true);
  } finally { rmSync(out, { recursive: true }); }
});
