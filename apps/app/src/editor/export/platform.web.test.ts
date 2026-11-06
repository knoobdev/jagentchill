import assert from "node:assert/strict";
import { test } from "node:test";
import { openOutput } from "./platform.web.ts";

test("This device output — abort interrupts a pending write without waiting for the export chain", async () => {
  let startWrite!: () => void, aborts = 0, removes = 0;
  const writeStarted = new Promise<void>((resolve) => { startWrite = resolve; });
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const writable = {
    write: async () => { startWrite(); return new Promise<void>(() => undefined); },
    close: async () => undefined,
    abort: async () => { aborts++; },
  };
  const directory = {
    getFileHandle: async () => ({ createWritable: async () => writable }),
    removeEntry: async () => { removes++; },
  };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { storage: { getDirectory: async () => ({ getDirectoryHandle: async () => directory }) } } });
  try {
    const output = await openOutput({ privateName: "cancel-test.mp4" });
    void output.write(new Uint8Array([1, 2, 3]), 0);
    await writeStarted;
    const result = await Promise.race([
      output.abort().then(() => "aborted" as const),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 2_000)),
    ]);
    assert.equal(result, "aborted", "Cancel must not wait for an unresolved write promise");
    assert.equal(aborts, 1);
    assert.equal(removes, 1);
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});
