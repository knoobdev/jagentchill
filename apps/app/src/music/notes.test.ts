import assert from "node:assert/strict";
import { test } from "node:test";
import { CHIP_LABELS, DOWN_LINES, MORE_MUSIC, expectStarterMusic, expectedStarterMusic, ncsCredit, ncsRelease, settleStarterMusic } from "./notes.ts";
import { vi } from "../locale/vi.ts";
import { ja } from "../locale/ja.ts";

test("W7 more music — a file NAMED as an NCS release is recognised and gets NCS's credit form; any other name is left alone", () => {
  assert.deepEqual(ncsRelease("Tone Maker - Test Tone [NCS Release].mp3"), { artist: "Tone Maker", title: "Test Tone" });
  assert.deepEqual(ncsRelease("Tone_Maker_-_Test_Tone_(NCS_Release).wav"), { artist: "Tone Maker", title: "Test Tone" });
  assert.deepEqual(ncsRelease("NCS - Tone Maker - Test Tone.m4a"), { artist: "Tone Maker", title: "Test Tone" });
  assert.deepEqual(ncsRelease("Test Tone [NCS Release].mp3"), { artist: "", title: "Test Tone" });
  for (const name of ["holiday.mp3", "voice memo 12.m4a", "sync-test.wav", "Incs - demo.mp3"]) assert.equal(ncsRelease(name), null, name);
  assert.equal(ncsCredit({ artist: "Tone Maker", title: "Test Tone" }), "Song: Tone Maker - Test Tone [NCS Release]\nMusic provided by NoCopyrightSounds");
  assert.equal(ncsCredit({ artist: "", title: "Test Tone" }), "Song: Test Tone [NCS Release]\nMusic provided by NoCopyrightSounds");
});

test("W7 more music — the two sources are named with their rule in one line and the page that opens in the person's browser; the shelf has a line for every reason it cannot be shown and a label for every chip", () => {
  assert.deepEqual(MORE_MUSIC.map((source) => [source.id, source.line, source.url]), [["pixabay", "Pixabay: free, no credit needed.", "https://pixabay.com/music/"], ["ncs", "NCS: free for your videos, credit required.", "https://ncs.io/"]]);
  for (const reason of ["no_host", "offline", "rate_limited", "provider_error", "not_connected"] as const) assert.match(DOWN_LINES[reason], /Your own files still work\.$/, reason);
  assert.equal(Object.keys(CHIP_LABELS).length, 10);
});

test("W7 music — the required Openverse notice is translated in Vietnamese and Japanese and the no-host line tells the person to connect", () => {
  const notice = "Made using Openverse — not endorsed or certified by Openverse.";
  assert.notEqual(vi[notice], notice);
  assert.notEqual(ja[notice], notice);
  assert.match(DOWN_LINES.no_host, /Connect to a host/);
});

test("W7 remote music — the note that a starter's project still waits for its music is kept per project until the track is placed; without storage nothing breaks", () => {
  assert.equal(expectedStarterMusic("p1"), null);
  expectStarterMusic("p1", "vlog-day");
  const held = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => held.get(key) ?? null, setItem: (key: string, value: string) => void held.set(key, value), removeItem: (key: string) => void held.delete(key) } });
  try {
    expectStarterMusic("p1", "vlog-day");
    assert.deepEqual([expectedStarterMusic("p1"), expectedStarterMusic("p2")], ["vlog-day", null]);
    settleStarterMusic("p1");
    assert.equal(expectedStarterMusic("p1"), null);
  } finally { delete (globalThis as { localStorage?: unknown }).localStorage; }
});
