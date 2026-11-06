import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import * as time from "@jagentchill/editor-core";
import { lintTickDivision } from "../scripts/lint-tick-division.ts";
import { loadWasm, repositoryRoot } from "./support/wasm.ts";

type Case = { op: string; args: Record<string, any>; expect?: unknown; error?: string };
const vectors = JSON.parse(readFileSync(join(repositoryRoot, "packages/editor-core/fixtures/time-vectors.json"), "utf8")) as { base: Case[]; retime: Case[] };

/** One entry per operation of the vector file: how the TypeScript API is called for it. */
const TYPESCRIPT: Record<string, (args: any) => unknown> = {
  mediaTime: ({ value }) => time.mediaTime(value),
  mediaTimeFromSeconds: ({ seconds }) => time.mediaTimeFromSeconds(seconds),
  mediaTimeToSeconds: (args) => time.mediaTimeToSeconds(args.time),
  mediaTimeFromFrame: ({ frame, rate }) => time.mediaTimeFromFrame(frame, rate),
  mediaTimeToFrame: (args) => time.mediaTimeToFrame(args.time, args.rate),
  roundToFrame: (args) => time.roundToFrame(args.time, args.rate),
  floorToFrame: (args) => time.floorToFrame(args.time, args.rate),
  isFrameAligned: (args) => time.floorToFrame(args.time, args.rate) === args.time,
  lastFrameTime: ({ duration, rate }) => time.lastFrameTime(duration, rate),
  snappedSeekTime: (args) => time.snappedSeekTime(args.time, args.duration, args.rate),
  mediaTimeAdd: ({ lhs, rhs }) => time.mediaTimeAdd(lhs, rhs),
  mediaTimeSub: ({ lhs, rhs }) => time.mediaTimeSub(lhs, rhs),
  mediaTimeMin: ({ lhs, rhs }) => time.mediaTimeMin(lhs, rhs),
  mediaTimeMax: ({ lhs, rhs }) => time.mediaTimeMax(lhs, rhs),
  mediaTimeClamp: (args) => time.mediaTimeClamp(args.time, args.min, args.max),
  guessTimecodeFormat: ({ timeCode }) => time.guessTimecodeFormat(timeCode),
  formatTimecode: (args) => time.formatTimecode(args.time, args.format, args.rate),
  parseTimecode: ({ timeCode, format, rate }) => time.parseTimecode(timeCode, format, rate),
  retimedDuration: ({ sourceSpan, retime, rate }) => time.retimedDuration(sourceSpan, retime, rate),
  sourceTimeAt: ({ element, clipTime }) => time.sourceTimeAt(element, clipTime),
  clipTimeAt: ({ element, sourceTime }) => time.clipTimeAt(element, sourceTime),
};

const outcome = (run: () => unknown): { value?: unknown; error?: string } => {
  try {
    const value = run();
    return { value: value === undefined ? null : value };
  } catch (error) {
    // The TypeScript API throws a `TimeError`; the wasm bridge throws the code itself.
    return { error: typeof error === "string" ? error : (error as { code?: string }).code ?? String(error) };
  }
};
const expected = (entry: Case) => (entry.error ? { error: entry.error } : { value: entry.expect });

test("Pure TypeScript time maths with wasm parity — Shared vectors agree", async () => {
  const wasm = await loadWasm() as unknown as Record<string, (args: unknown) => unknown>;
  const all = [...vectors.base, ...vectors.retime];
  assert.ok(vectors.base.length >= 2000, `${vectors.base.length} base cases`);
  assert.ok(vectors.retime.length >= 500, `${vectors.retime.length} retime cases`);
  let differing = 0;
  for (const entry of all) {
    const fromTypeScript = outcome(() => TYPESCRIPT[entry.op](entry.args));
    const fromWasm = outcome(() => wasm[entry.op](entry.args));
    assert.deepEqual(fromTypeScript, expected(entry), `TypeScript ${entry.op} ${JSON.stringify(entry.args)}`);
    assert.deepEqual(fromWasm, expected(entry), `wasm ${entry.op} ${JSON.stringify(entry.args)}`);
    if (JSON.stringify(fromTypeScript) !== JSON.stringify(fromWasm)) differing++;
  }
  assert.equal(differing, 0, "no case differs between the two implementations");
});

test("Pure TypeScript time maths with wasm parity — the vector file covers every operation, every preset rate, negatives, zero, 24 hours and the rational bounds", () => {
  const ops = new Set([...vectors.base, ...vectors.retime].map((entry) => entry.op));
  assert.deepEqual([...ops].sort(), Object.keys(TYPESCRIPT).sort());
  const rates = new Set(vectors.base.filter((entry) => entry.args.rate).map((entry) => `${entry.args.rate.numerator}/${entry.args.rate.denominator}`));
  for (const preset of ["24000/1001", "24/1", "25/1", "30000/1001", "30/1", "48/1", "50/1", "60000/1001", "60/1", "120/1", "1000000/1", "1/1000000"]) assert.ok(rates.has(preset), preset);
  const times = vectors.base.flatMap((entry) => (typeof entry.args.time === "number" ? [entry.args.time] : []));
  assert.ok(times.includes(0) && times.some((value) => value < 0) && times.includes(10_368_000_000));
  const retimes = vectors.retime.map((entry) => JSON.stringify(entry.args));
  for (const needle of ['"rate":0.1', '"rate":2', '"rate":100', '"reverse":true', '"sourceSpan":1200000', '"sourceSpan":432000000', '"rate":5.5']) {
    assert.ok(retimes.some((text) => text.includes(needle)), needle);
  }
  // The committed file is what the generator writes.
  const check = spawnSync(process.execPath, ["scripts/gen-time-vectors.ts", "--check"], { cwd: join(repositoryRoot, "packages/editor-core"), encoding: "utf8" });
  assert.equal(check.status, 0, check.stderr);
});

test("Pure TypeScript time maths with wasm parity — Non-integer tick input is rejected", async () => {
  assert.throws(() => time.mediaTime(1000.5), (error: unknown) => error instanceof time.TimeError && error.code === "time/non-integer-ticks");
  const wasm = await loadWasm();
  assert.throws(() => wasm.mediaTime({ value: 1000.5 }), (error: unknown) => error === "time/non-integer-ticks");
  assert.equal(time.mediaTime(1000), 1000);
});

test("Pure TypeScript time maths with wasm parity — Retime mapping agrees across implementations", async () => {
  const wasm = await loadWasm();
  const hero = [[0, 1], [0.2, 5], [0.4, 0.5], [0.6, 0.5], [0.8, 5], [1, 1]].map(([u, rate]) => ({ u, rate }));
  const rate = { numerator: 30, denominator: 1 };
  const sourceSpan = 432_000_000;
  const retime = { rate: 1, curve: hero };
  const duration = time.retimedDuration(sourceSpan, retime, rate);
  assert.equal(wasm.retimedDuration({ sourceSpan, retime, rate }), duration);
  const element = { sourceStart: 0, sourceSpan, duration, retime };
  for (let index = 0; index < 1000; index++) {
    const clipTime = time.floorToFrame(Math.floor((duration * index) / 1000), rate);
    const fromTypeScript = time.sourceTimeAt(element, clipTime);
    assert.ok(Number.isInteger(fromTypeScript));
    assert.equal(wasm.sourceTimeAt({ element, clipTime }), fromTypeScript, `clip time ${clipTime}`);
  }
});

test("Pure TypeScript time maths with wasm parity — Division on ticks outside the time module", () => {
  // The fixture sits inside the package so that it resolves `@jagentchill/editor-core` like any render source.
  const directory = join(import.meta.dirname, ".tmp-lint", "packages", "render", "src");
  mkdirSync(directory, { recursive: true });
  try {
    writeFileSync(join(directory, "half.ts"), [
      "import type { MediaTime } from \"@jagentchill/editor-core\";",
      "export function half(duration: MediaTime): number {",
      "  return duration / 2;",
      "}",
      "export const seconds = (frames: number): number => frames / 30;",
      "",
    ].join("\n"));
    assert.deepEqual(lintTickDivision([directory]).map(({ line, text }) => ({ line, text })), [{ line: 3, text: "duration / 2" }]);
    const run = spawnSync(process.execPath, [join(import.meta.dirname, "../scripts/lint-tick-division.ts"), directory], { encoding: "utf8" });
    assert.notEqual(run.status, 0, "the lint step exits non-zero");
    assert.match(run.stderr, /half\.ts:3:/, "the report names the file and line");
  } finally {
    rmSync(join(import.meta.dirname, ".tmp-lint"), { recursive: true, force: true });
  }
  assert.deepEqual(lintTickDivision([join(repositoryRoot, "packages/render/src"), join(repositoryRoot, "packages/editor-core/src")]), [], "the engine sources divide no tick value");
});
