import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
type Wasm = typeof import("@jagentchill/render-wasm");
let loaded: Promise<Wasm> | undefined;

/** The wasm package instantiated in Node. Only its GPU-free exports (time maths, hashes, registries) work here. */
export function loadWasm(): Promise<Wasm> {
  return loaded ??= (async () => {
    const entry = require.resolve("@jagentchill/render-wasm");
    const wasm = await import(entry) as Wasm;
    wasm.initSync({ module: await readFile(join(dirname(entry), "opencut_wasm_bg.wasm")) });
    return wasm;
  })();
}

export const repositoryRoot = join(import.meta.dirname, "../../../..");
