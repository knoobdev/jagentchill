import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { test } from "node:test";
import {
  AbortedError, PICKER_ACCEPT, Sha256, bytesSource, detectMediaType, hashSource, looksLikeSvg, message, repairMimeType, sha256Hex, sha256OfText, sniffFormat,
} from "../src/index.ts";
import { fixture } from "./support/fixtures.ts";

const head = (name: string) => fixture(name).subarray(0, 4096);

test("Unsupported type: a .docx file is not detected and produces the toast \"Unsupported file type: {name}\"", () => {
  assert.equal(detectMediaType({ name: "notes.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", head: head("notes.docx") }), null);
  assert.equal(detectMediaType({ name: "notes.docx", mimeType: "", head: head("notes.docx") }), null);
  assert.equal(message("media.unsupported-type", { name: "notes.docx" }).text, "Unsupported file type: notes.docx");
});

test("Missing MIME type: clip.mkv with an empty MIME type is detected as video by extension", () => {
  const detected = detectMediaType({ name: "clip.mkv", mimeType: "" });
  assert.deepEqual(detected, { type: "video", format: "mkv", mimeType: "video/x-matroska", needsMezzanine: false });
});

test("SVG without MIME: an SVG delivered with an empty MIME type is treated as image/svg+xml on import and on load", () => {
  const svg = fixture("scripted.svg");
  // On import, with a name that says nothing: the content decides.
  assert.deepEqual(detectMediaType({ name: "drawing", mimeType: "", head: svg }), { type: "image", format: "svg", mimeType: "image/svg+xml", needsMezzanine: false });
  // On load, the stored blob has no type: the MIME type is repaired again.
  assert.equal(repairMimeType({ name: "drawing.svg", mimeType: "", head: svg }), "image/svg+xml");
  assert.equal(repairMimeType({ name: "drawing", mimeType: "", head: svg }), "image/svg+xml");
  assert.equal(looksLikeSvg(new TextEncoder().encode("﻿<?xml version='1.0'?>\n<!-- c -->\n<!DOCTYPE svg>\n  <svg xmlns='http://www.w3.org/2000/svg'/>")), true);
  assert.equal(looksLikeSvg(new TextEncoder().encode("<html><svg/></html>")), false);
});

test("detection order is MIME prefix, then extension, then the signature of the first 4 KiB", () => {
  assert.equal(detectMediaType({ name: "x.bin", mimeType: "video/mp4" })?.type, "video");
  assert.equal(detectMediaType({ name: "song.FLAC", mimeType: "" })?.format, "flac");
  // No MIME type and no extension: the real bytes of every generated file identify it.
  const expected: Record<string, [string, string]> = {
    "h264-aac.mp4": ["video", "mp4"], "vp9-opus.webm": ["video", "webm"], "sine-10s.wav": ["audio", "wav"], "tone.mp3": ["audio", "mp3"], "alpha.png": ["image", "png"],
    "plain.jpg": ["image", "jpeg"], "anim.gif": ["image", "gif"], "picture.webp": ["image", "webp"], "picture.bmp": ["image", "bmp"], "scripted.svg": ["image", "svg"],
  };
  for (const [name, [type, format]] of Object.entries(expected)) {
    const detected = detectMediaType({ name: "unnamed", mimeType: "", head: head(name) });
    assert.deepEqual([detected?.type, detected?.format], [type, format], name);
  }
  assert.equal(sniffFormat(Uint8Array.from([0, 0, 0, 24, ...Buffer.from("ftypheic"), 0, 0, 0, 0, ...Buffer.from("mif1heic")])), "heic");
  assert.equal(detectMediaType({ name: "IMG_1.HEIC", mimeType: "" })?.needsMezzanine, true);
  assert.equal(sniffFormat(Uint8Array.from([0, 0, 0, 20, ...Buffer.from("ftypqt  "), 0, 0, 0, 0, ...Buffer.from("qt  ")])), "mov");
  assert.equal(detectMediaType({ name: "text.txt", mimeType: "text/plain", head: new TextEncoder().encode("hello") }), null);
});

test("the file picker accepts image/*, video/* and audio/* plus the supported extensions", () => {
  const accept = PICKER_ACCEPT.split(",");
  for (const entry of ["image/*", "video/*", "audio/*", ".mp4", ".mov", ".m4v", ".webm", ".mkv", ".3gp", ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".flac", ".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".bmp", ".svg", ".heic", ".heif"]) assert.ok(accept.includes(entry), entry);
});

test("SHA-256 matches the platform digest for every length around the block boundaries and in any chunking", () => {
  assert.equal(sha256Hex(new Uint8Array(0)), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(sha256Hex(new TextEncoder().encode("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  for (const length of [1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000, 65_537]) {
    const bytes = new Uint8Array(randomBytes(length)), expected = createHash("sha256").update(bytes).digest("hex");
    assert.equal(sha256Hex(bytes), expected, `length ${length}`);
    const pieces = new Sha256();
    for (let offset = 0; offset < length; offset += 37) pieces.update(bytes.subarray(offset, offset + 37));
    assert.equal(pieces.digest(), expected, `chunked ${length}`);
  }
  assert.equal(sha256OfText("https://example.org/a.mp3"), createHash("sha256").update("https://example.org/a.mp3").digest("hex"));
});

test("a file is hashed chunk by chunk with progress, and can be aborted", async () => {
  const bytes = fixture("h264-aac.mp4"), progress: number[] = [];
  assert.equal(await hashSource(bytesSource(bytes), { chunkBytes: 10_000, onProgress: (fraction) => progress.push(fraction) }), createHash("sha256").update(bytes).digest("hex"));
  assert.equal(progress.length, Math.ceil(bytes.length / 10_000));
  assert.equal(progress.at(-1), 1);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(hashSource(bytesSource(bytes), { signal: controller.signal }), AbortedError);
});
