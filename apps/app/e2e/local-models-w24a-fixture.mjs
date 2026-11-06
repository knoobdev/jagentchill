// W24a e2e TEST DOUBLE: serves the "model files" of the local picture model from 127.0.0.1 (random bytes with their real
// SHA-256, and a ZIP that holds the fake engine `server/test/fixtures/fake-sd-cli.mjs`) and writes the manifest the
// server is started with (`JAGENTCHILL_LOCAL_MODELS_MANIFEST`). The text encoder and the 8-bit picture model trickle
// (a few KB a second) so a download can be seen in progress and paused. Nothing real is downloaded.
// Usage: node apps/app/e2e/local-models-w24a-fixture.mjs <manifest-out.json>   (runs until it is stopped)
import { writeFileSync } from "node:fs";
import { startModelFixture } from "../../../server/test/support/local-models.ts";

const fixture = await startModelFixture();
fixture.faults.slow = new Set(["/llm.gguf", "/standard-q8.gguf", "/standard-q4.gguf"]);
writeFileSync(process.argv[2], JSON.stringify(fixture.manifest, null, 2));
console.log(`fixture ${fixture.url} manifest ${process.argv[2]}`);
setInterval(() => { console.log(`requests ${fixture.requests.map((request) => `${request.path}${request.range ? ` ${request.range}` : ""}`).join(", ")}`); }, 5000).unref?.();
process.stdin.resume();
