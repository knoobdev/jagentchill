// Preload for the "editor-core runs without a browser" check: a runtime with no DOM and no WebAssembly.
for (const name of ["document", "window", "navigator", "AudioContext", "VideoDecoder", "GPUDevice"]) {
  if (name in globalThis) Reflect.deleteProperty(globalThis, name);
}
Reflect.deleteProperty(globalThis, "WebAssembly");
if (typeof globalThis.WebAssembly !== "undefined" || typeof globalThis.document !== "undefined") throw new Error("the runtime still has a browser global");
