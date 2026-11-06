// Renders a real frame with the wasm compositor in headless Chromium and checks the pixels it produced.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright";

const root = join(import.meta.dirname, "../..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm" };

async function renderIn(query, launchOptions = {}) {
  const server = createServer(async (req, res) => {
    const path = normalize(new URL(req.url, "http://x").pathname);
    const file = path === "/" ? join(root, "test/browser/index.html") : join(root, path);
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch(launchOptions);
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    const logs = [];
    page.on("console", (message) => { if (message.type() === "error") logs.push(message.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/${query}`);
    const result = await page.evaluate(() => window.result);
    assert.ok(result.ok, `${result.error}\n${logs.join("\n")}`);
    assert.deepEqual(errors, []);
    return result.value;
  } finally {
    await browser.close();
    server.close();
  }
}

const near = (actual, expected, label) => actual.forEach((channel, index) =>
  assert.ok(Math.abs(channel - expected[index]) <= 2, `${label}: got ${actual}, expected ${expected}`));

function check(value) {
  assert.equal(value.ticksPerSecond, 120_000);
  assert.deepEqual(value.size, [320, 180]);
  near(value.redOnly, [255, 0, 0, 255], "red only");
  near(value.blueOverRed, [128, 0, 128, 255], "blue 50 % over red");
  near(value.blueOverBlack, [0, 0, 128, 255], "blue 50 % over black");
  near(value.background, [0, 0, 0, 255], "background");
  near(value.green, [0, 255, 0, 255], "pixels uploaded as bytes");
  near(value.presented, [128, 0, 128, 255], "what the canvas shows");
  assert.equal(value.backends[0], value.backends[1], "both calls resolve to the same backend name");
  assert.match(value.invalid, /^descriptor\/invalid/);
  near(value.afterInvalid, [255, 0, 0, 255], "the surface still shows the previously rendered frame");
  assert.deepEqual(value.blendModes, ["normal", "darken", "multiply", "color-burn", "lighten", "screen", "plus-lighter", "color-dodge", "overlay",
    "soft-light", "hard-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"]);
  for (const shader of ["blend", "chroma-key", "gaussian-blur", "layer", "mask-combine", "cross-dissolve"]) assert.ok(value.shaders.includes(shader), shader);
  assert.deepEqual(value.report.stages, ["source", "transform", "opacity", "blend", "source", "transform", "opacity", "blend", "source", "transform", "opacity", "blend"]);
}

test("the compositor renders layers with opacity over the clear colour, reads the pixels back and refuses an invalid descriptor", async () => {
  const value = await renderIn("");
  console.log("backend", JSON.stringify(value.info), "stats", JSON.stringify(value.stats));
  check(value);
});

test("the same frame renders on the WebGL2 backend when it is forced", async () => {
  const value = await renderIn("?backend=webgl2");
  assert.equal(value.info.backend, "webgl2");
  check(value);
});
