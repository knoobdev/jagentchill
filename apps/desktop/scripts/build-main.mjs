// Bundles the main process and the preload script. Electron's own module is the only thing left outside the bundles.
import { build } from "esbuild";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "dist"), { recursive: true });
const common = { bundle: true, platform: "node", format: "cjs", target: "node24", external: ["electron"], sourcemap: "linked", logLevel: "warning", legalComments: "none" };
await build({ ...common, entryPoints: [join(root, "src/entry.ts")], outfile: join(root, "dist/entry.cjs") });
await build({ ...common, entryPoints: [join(root, "src/main.ts")], outfile: join(root, "dist/main.cjs") });
await build({ ...common, entryPoints: [join(root, "src/render-host-main.ts")], outfile: join(root, "dist/render-host-main.cjs") });
await build({ ...common, entryPoints: [join(root, "src/render-host-preload.ts")], outfile: join(root, "dist/render-host-preload.cjs") });
const renderHost = join(root, "dist/render-host");
mkdirSync(renderHost, { recursive: true });
await build({ entryPoints: [join(root, "src/render-host-page.ts")], outfile: join(renderHost, "page.js"), bundle: true, format: "esm", platform: "browser", target: "chrome130", logLevel: "warning" });
copyFileSync(join(root, "../../packages/render-wasm/pkg/opencut_wasm_bg.wasm"), join(renderHost, "opencut_wasm_bg.wasm"));
writeFileSync(join(renderHost, "index.html"), `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; connect-src app: blob: data: jagentchill-media:; media-src blob: data: jagentchill-media:; img-src app: blob: data:; worker-src blob: app:; font-src app: data:; object-src 'none'; base-uri 'none'"><div id="surface" style="width:1920px;height:1080px"></div><script type="module" src="app://jagentchill/page.js"></script>`);
// The preload script runs sandboxed: it may require `electron` and nothing else.
await build({ ...common, entryPoints: [join(root, "src/preload.ts")], outfile: join(root, "dist/preload.cjs") });
console.log("built desktop entry, app main, render host and preloads");
