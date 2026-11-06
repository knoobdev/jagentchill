// Run after wasm-bindgen: the generated glue keeps its instance in a module variable and refuses to create a second
// one. Panic recovery discards a trapped instance and makes a new one, so the glue gets the one function that forgets it.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dirname, "../pkg");
const glue = join(dir, "opencut_wasm.js"), types = join(dir, "opencut_wasm.d.ts");
let source = readFileSync(glue, "utf8");
if (!/\nlet wasm(?:;| =)/.test(source) && !/\nlet wasmModule, wasm;/.test(source) && !source.includes("wasm = instance.exports")) throw new Error("the glue no longer holds its instance in `wasm`");
if (!source.includes("export function discardInstance")) {
  source += `\n/** Forgets the instance: the next call of the init function creates a new one. Objects of the old instance must not be used again. */\nexport function discardInstance() { wasm = undefined; wasmModule = undefined; }\n`;
  writeFileSync(glue, source);
}
let declarations = readFileSync(types, "utf8");
if (!declarations.includes("discardInstance")) writeFileSync(types, `${declarations}\n/** Forgets the instance: the next call of the init function creates a new one. */\nexport function discardInstance(): void;\n`);
