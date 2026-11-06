import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { FILTER_ROWS } from "@jagentchill/content";
import { EFFECT_DEFINITIONS, TRANSITION_DEFINITIONS } from "@jagentchill/editor-core";
import { bakeAll, LUT_DIRECTORY, staleTables } from "../../../scripts/bake-luts.ts";
import { cubicBezier, EFFECT_PASS_SHADERS, effectPasses, paramUniforms, TRANSITION_EASING, transitionShader } from "../src/frame/library.ts";
import { applyRecipe, bakeRecipe, cubeText, filterCube, filterRecipe, parseRecipe } from "../src/frame/recipe.ts";
import { goldenCoverage } from "../scripts/golden-coverage.ts";

const library = join(import.meta.dirname, "../../render-wasm/crates/effects/src/library");
/** `shader id → uniform names` as the sections of a library file declare them. */
function declared(file: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const line of readFileSync(join(library, file), "utf8").split("\n")) {
    const match = /^\/\/# ([a-z0-9-]+) \|(.*)$/.exec(line);
    if (match) out.set(match[1], match[2].trim().split(/\s+/).filter(Boolean).map((entry) => entry.split(":")[0]));
  }
  return out;
}
const timing = { seconds: 1, frame: 30, progress: 0.5, scale: 1, matte: true };

test("Shader registry and extended shader set — Catalogue entry without a shader: every catalogue id has a shader and every parameter a uniform", () => {
  const effects = declared("effects.wgsl"), transitions = declared("transitions.wgsl");
  const problems: string[] = [];
  for (const definition of TRANSITION_DEFINITIONS) {
    const uniforms = transitions.get(definition.type);
    if (!uniforms) { problems.push(`transition ${definition.type} has no shader`); continue; }
    for (const param of definition.params) if (!uniforms.includes(param.key)) problems.push(`transition ${definition.type}: parameter ${param.key} has no uniform`);
    for (const name of uniforms) if (!definition.params.some((param) => param.key === name)) problems.push(`transition ${definition.type}: uniform ${name} has no parameter`);
  }
  for (const definition of EFFECT_DEFINITIONS) {
    const entry = { id: "e", type: definition.type, kind: "effect", enabled: true, params: Object.fromEntries(definition.params.map((param) => [param.key, param.type === "number" ? Math.max(Number(param.default), 1) : param.default])) };
    const passes = effectPasses({}, entry, 0, timing);
    if (passes.length === 0) problems.push(`effect ${definition.type} builds no pass`);
    for (const pass of passes) {
      if (pass.shader === "gaussian-blur") continue;
      const uniforms = effects.get(pass.shader);
      if (!uniforms) { problems.push(`effect ${definition.type}: shader ${pass.shader} is not in the registry`); continue; }
      for (const name of Object.keys(pass.uniforms)) if (!["u_time", "u_frame", "u_progress"].includes(name) && !uniforms.includes(name.slice(2))) problems.push(`effect ${definition.type}: ${pass.shader} declares no uniform ${name}`);
      if (EFFECT_PASS_SHADERS[definition.type] && !EFFECT_PASS_SHADERS[definition.type].includes(pass.shader)) problems.push(`effect ${definition.type}: pass ${pass.shader} is not listed`);
    }
    // A single-pass effect hands every parameter of its row to its shader.
    if (passes.length === 1 && passes[0].shader === definition.type) for (const param of definition.params) if (!effects.get(definition.type)!.includes(param.key)) problems.push(`effect ${definition.type}: parameter ${param.key} has no uniform`);
  }
  assert.deepEqual(problems, []);
  // The same check names a catalogue entry whose shader is absent.
  assert.equal(effects.has("vhs-glitch"), false);
});

test("Golden-frame determinism — Catalogue completeness gate: every transition, effect, filter and mask type has its golden cases", () => {
  assert.deepEqual(goldenCoverage(), []);
});

test("LUT bake procedure — Deterministic output; Recipe edited without re-baking; Committed table differs from its recipe; Wheel recipe is reproducible; a recipe may not use the spatial sliders", () => {
  const first = bakeAll(), second = bakeAll();
  assert.equal(first.size, 39);
  for (const [id, text] of first) {
    assert.equal(second.get(id), text, id);
    assert.equal(readFileSync(join(LUT_DIRECTORY, `${id}.cube`), "utf8"), text, `${id}.cube is the committed bake`);
    assert.equal(filterCube(id), text, "the engine samples the same table");
    const lines = text.split("\n");
    assert.deepEqual([lines[0], lines[1], lines[2], lines.length, text.includes("\r")], ["LUT_3D_SIZE 33", "DOMAIN_MIN 0 0 0", "DOMAIN_MAX 1 1 1", 3 + 35937 + 1, false]);
    assert.ok(lines.slice(3, -1).every((line) => /^\d\.\d{6} \d\.\d{6} \d\.\d{6}$/.test(line)), `${id}: six decimals`);
  }
  assert.deepEqual(staleTables(), []);
  // A recipe row edited without re-baking is named.
  const edited = FILTER_ROWS.map((row) => (row.id === "golden-hour" ? { ...row, recipe: row.recipe.replace("temperature 30", "temperature 31") } : row));
  assert.deepEqual(staleTables(LUT_DIRECTORY, edited), ["golden-hour"]);
  // A committed file that was changed by hand is named too.
  const copy = mkdtempSync(join(tmpdir(), "jc-luts-"));
  for (const [id, text] of first) writeFileSync(join(copy, `${id}.cube`), id === "mono" ? text.replace("0.000000", "0.000001") : text);
  assert.deepEqual(staleTables(copy), ["mono"]);
  // The lattice point (0.5, 0.5, 0.5) of `sepia`, from its catalogue recipe: B{saturation −100, contrast 6}; W{shadows: 35°, 0.20, 0; midtones: 35°, 0.30, 0; highlights: 45°, 0.18, 0}.
  const sepia = applyRecipe([0.5, 0.5, 0.5], filterRecipe("sepia")!);
  const entry = first.get("sepia")!.split("\n")[3 + 16 + 33 * 16 + 1089 * 16];
  assert.equal(entry, sepia.map((value) => value.toFixed(6)).join(" "));
  // Worked by hand: saturation and contrast leave mid-grey at 0.5; per channel the wheels give
  // clamp(gain (0.5 + lift × 0.5))^(1 / gamma) with lift = 0.25 a k, gamma = gain = 2^(a k).
  const k = (angle: number) => [0, -120, 120].map((offset) => Math.cos(((angle + offset) * Math.PI) / 180));
  const byHand = [0, 1, 2].map((channel) => Math.min(Math.max(2 ** (0.18 * k(45)[channel]) * (0.5 + 0.25 * 0.2 * k(35)[channel] * 0.5), 0), 1) ** (1 / 2 ** (0.3 * k(35)[channel])));
  assert.deepEqual(sepia.map((value) => value.toFixed(6)), byHand.map((value) => value.toFixed(6)));
  assert.throws(() => parseRecipe("B{sharpness 10}"), /not a basic slider a filter may use/);
  assert.throws(() => bakeAll([{ id: "bad", recipe: "B{grain 5}" }]), /^Error: bad:/);
  // Mono at intensity 100 on (200, 40, 90): R = G = B.
  const mono = applyRecipe([200 / 255, 40 / 255, 90 / 255], filterRecipe("mono")!);
  assert.ok(Math.abs(mono[0] - mono[1]) < 1e-12 && Math.abs(mono[1] - mono[2]) < 1e-12);
  assert.equal(cubeText(bakeRecipe({}, 2), 2), "LUT_3D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n0.000000 0.000000 0.000000\n1.000000 0.000000 0.000000\n0.000000 1.000000 0.000000\n1.000000 1.000000 0.000000\n0.000000 0.000000 1.000000\n1.000000 0.000000 1.000000\n0.000000 1.000000 1.000000\n1.000000 1.000000 1.000000\n");
});

test("Transition rendering — the easings are the four cubic beziers; uniforms follow the catalogue parameter types", () => {
  assert.ok(Math.abs(cubicBezier(0.42, 0, 1, 1, 0.5) - 0.315) < 0.01);
  assert.ok(Math.abs(TRANSITION_EASING["ease-in-out"](0.5) - 0.5) < 1e-9 && TRANSITION_EASING["ease-out"](0.5) > 0.6 && TRANSITION_EASING.linear(0.3) === 0.3);
  for (const ease of Object.values(TRANSITION_EASING)) assert.deepEqual([ease(0), ease(1)], [0, 1]);
  const wipe = transitionShader("clock-wipe", { direction: "counter-clockwise", startAngle: 500 }, 0.5, { seconds: 0.5, frame: 15, scale: 1 });
  // A select goes as its option index; a stored value outside its range is clamped for evaluation; a missing one is the default.
  assert.deepEqual([wipe.uniforms.u_direction, wipe.uniforms.u_startAngle, wipe.uniforms.u_softness], [1, 360, 5]);
  assert.deepEqual(transitionShader("push", { direction: "up" }, 0.5, { seconds: 0, frame: 0, scale: 1 }).uniforms.u_direction, [0, -1]);
  assert.deepEqual(transitionShader("dip-to-color", { color: "#ff8000" }, 0.5, { seconds: 0, frame: 0, scale: 1 }).uniforms.u_color, [1, 128 / 255, 0]);
  // The Gaussian of a blur dissolve: sigma blur / 5 × s × sin(π p), absent at the end points.
  const blur = transitionShader("blur-dissolve", { blur: 50 }, 0.5, { seconds: 0, frame: 0, scale: 1 });
  assert.deepEqual(blur.postPasses.map((pass) => [pass.shader, pass.uniforms.u_sigma]), [["gaussian-blur", 10], ["gaussian-blur", 10]]);
  assert.deepEqual(transitionShader("blur-dissolve", { blur: 50 }, 0, { seconds: 0, frame: 0, scale: 1 }).postPasses, []);
  assert.deepEqual(transitionShader("made-up", { x: 1 }, 0.5, { seconds: 0, frame: 0, scale: 1 }), { shader: "made-up", uniforms: {}, postPasses: [] });
  assert.deepEqual(paramUniforms([{ key: "on", type: "boolean", default: false }], () => true), { u_on: 1 });
});

test("Keyframable effect parameters — Animate blur intensity; Bundled effect library — Blur sigma; Resolution-independent effect parameters — Portrait canvas; Square canvas; Element scale does not change the factor", () => {
  const key = (id: string, time: number, value: number) => ({ id, time, value, segmentToNext: "linear" });
  const element = { animations: { "effects.fx.params.intensity": { keys: [key("a", 0, 0), key("b", 240000, 100)] } } };
  const entry = { id: "fx", type: "blur", kind: "effect", enabled: true, params: { intensity: 15 } };
  // Linear from 0 at 0 s to 100 at 2 s: 50 at 1 s, sigma 50 / 5 = 10 px at scale 1, as horizontal and vertical passes.
  assert.deepEqual(effectPasses(element, entry, 120000, timing).map((pass) => [pass.uniforms.u_sigma, pass.uniforms.u_direction]), [[10, [1, 0]], [10, [0, 1]]]);
  // Intensity 15 is sigma 3 px on a 1920-long canvas, landscape or portrait, and 1.6875 px on 1080 × 1080.
  assert.equal(effectPasses({}, entry, 0, timing)[0].uniforms.u_sigma, 3);
  assert.equal(effectPasses({}, entry, 0, { ...timing, scale: 1080 / 1920 })[0].uniforms.u_sigma, 1.6875);
  // A body effect without its matte builds nothing; an unregistered type keeps its id for the compositor to report.
  assert.deepEqual(effectPasses({}, { id: "b", type: "body-glow", kind: "effect", params: {} }, 0, { ...timing, matte: false }), []);
  assert.deepEqual(effectPasses({}, { id: "u", type: "vendor-x", kind: "effect", params: { a: 1 } }, 0, timing), [{ shader: "vendor-x", uniforms: {} }]);
});
