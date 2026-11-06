// The download of a URL import is sent to the address that was CHECKED (never looked up a second time): its request
// carries a lookup that answers with that one address. Node asks a custom lookup for ALL addresses (`options.all`,
// because it picks the address family itself) and then wants a list — a lookup that answers with a single address
// fails every connection with "Invalid IP address: undefined", which a person saw as "the editor could not download
// the picture" on every URL import. This test opens a real connection through that lookup, as the https request does.
import assert from "node:assert/strict";
import { connect, createServer } from "node:net";
import { test } from "node:test";
import { pinned } from "../src/tools/import.ts";

const reach = (port: number, lookup: unknown) => new Promise<string>((resolve, reject) => {
  // A name no resolver knows: only the pinned address can answer.
  const socket = connect({ host: "pictures.invalid", port, lookup: lookup as never });
  socket.once("connect", () => { const peer = socket.remoteAddress ?? ""; socket.destroy(); resolve(peer); });
  socket.once("error", reject);
});

test("URL import: a connection through the pinned lookup reaches the checked address, however Node asks (one address or all)", async () => {
  const server = createServer((socket) => socket.end());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  try {
    assert.equal(await reach(port, pinned("127.0.0.1")), "127.0.0.1");
    // The lookup as it was before: one address whatever is asked — the defect, kept here so the test shows what it guards.
    const single = (_host: string, _options: unknown, done: (error: null, address: string, family: number) => void) => done(null, "127.0.0.1", 4);
    await assert.rejects(reach(port, single), /Invalid IP address/);
  } finally { await new Promise((resolve) => server.close(resolve)); }
  // Both forms, asked directly.
  const answers: unknown[] = [];
  pinned("2001:db8::1")("x", { all: true }, (...args: unknown[]) => answers.push(args));
  pinned("203.0.113.7")("x", { family: 0 }, (...args: unknown[]) => answers.push(args));
  assert.deepEqual(answers, [[null, [{ address: "2001:db8::1", family: 6 }]], [null, "203.0.113.7", 4]]);
});
