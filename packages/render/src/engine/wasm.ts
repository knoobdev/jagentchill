type Wasm = typeof import("@jagentchill/render-wasm");
let loading: Promise<Wasm> | undefined;

/** The wasm module, instantiated once per realm. Text layout and time maths need it without any GPU. */
export function loadWasm(wasmUrl?: string | URL): Promise<Wasm> {
  return loading ??= (async () => {
    const wasm = await import("@jagentchill/render-wasm");
    await wasm.default(wasmUrl ? { module_or_path: wasmUrl } : undefined);
    return wasm;
  })();
}
/**
 * Discards the instance after a trap and creates a new one (`render-engine.Wasm panic capture and recovery`).
 * Everything that lived in the old instance (the compositor, its textures, the loaded fonts) is gone with it.
 */
export async function reloadWasm(wasmUrl?: string | URL): Promise<Wasm> {
  const wasm = await (loading ?? import("@jagentchill/render-wasm"));
  (wasm as unknown as { discardInstance(): void }).discardInstance();
  loading = undefined;
  return loadWasm(wasmUrl);
}
/** For runtimes that instantiate the module themselves (Node tests through `initSync`). */
export function provideWasm(wasm: Wasm): void { loading = Promise.resolve(wasm); }
export type { Wasm };
