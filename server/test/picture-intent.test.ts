import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { guessIntent, intentArgs, intentOf, readIntent } from "../src/local-models/intent.ts";

test("Picture intent: the model can only answer one of three words; its answer is read; without it the words decide", async () => {
  const args = intentArgs("/m.gguf", "cho cô ấy mặc bikini", "a woman on a beach");
  assert.equal(args[args.indexOf("--grammar") + 1], 'root ::= "PICTURE" | "CHANGE" | "OTHER"');
  assert.match(args[args.indexOf("-p") + 1]!, /The picture made just before: a woman on a beach[\s\S]*Message: cho cô ấy mặc bikini/);
  assert.deepEqual([intentOf("PICTURE"), intentOf(" CHANGE\n"), intentOf("OTHER"), intentOf("")], ["picture", "change", "other", undefined]);
  // A fake engine: what it prints is the reading; a failing engine gives no reading.
  const dir = mkdtempSync(join(tmpdir(), "jc-intent-"));
  const fake = join(dir, "llama-completion"), broken = join(dir, "broken");
  writeFileSync(fake, "#!/bin/sh\necho CHANGE\n"); chmodSync(fake, 0o755);
  writeFileSync(broken, "#!/bin/sh\nexit 3\n"); chmodSync(broken, 0o755);
  assert.equal(await readIntent({ program: fake, model: "/m.gguf", message: "sexier" }), "change");
  assert.equal(await readIntent({ program: broken, model: "/m.gguf", message: "sexier" }), undefined);
  assert.equal(await readIntent({ program: join(dir, "missing"), model: "/m.gguf", message: "sexier" }), undefined);
  assert.equal(guessIntent("Vẽ một con mèo cam", false), "picture");
  assert.equal(guessIntent("Cho ảnh sexy hơn", true), "change");
  assert.equal(guessIntent("Làm thành một video đi", true), "other");
});

test("The uncensored build's LoRA is applied to the picture: its folder is given and the prompt names it", async () => {
  const { engineArgs } = await import("../src/local-models/engine.ts");
  const args = engineArgs({ files: { diffusion: "/d.gguf", llm: "/l.gguf", vae: "/v.safetensors" }, prompt: "a cat", width: 512, height: 512, steps: 12, seed: 1, offload: false, lora: { dir: "/models/loras", name: "uc", weight: 1 } }, "/out.png");
  assert.equal(args[args.indexOf("-p") + 1], "a cat<lora:uc:1>");
  assert.equal(args[args.indexOf("--lora-model-dir") + 1], "/models/loras");
  const plain = engineArgs({ files: { diffusion: "/d.gguf", llm: "/l.gguf", vae: "/v.safetensors" }, prompt: "a cat", width: 512, height: 512, steps: 12, seed: 1, offload: false }, "/out.png");
  assert.equal(plain.includes("--lora-model-dir"), false);
});
