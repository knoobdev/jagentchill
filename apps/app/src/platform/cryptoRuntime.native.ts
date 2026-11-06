import * as ExpoCrypto from "expo-crypto";

// Hermes does not expose Web Crypto's random source by default. The editor core uses
// crypto.getRandomValues for UUIDs, so provide Expo's secure native implementation.
type RuntimeCrypto = { getRandomValues?: (bytes: Uint8Array) => Uint8Array; randomUUID?: () => string };
const global = globalThis as unknown as { crypto?: RuntimeCrypto };
const runtime: RuntimeCrypto = global.crypto ?? {};
if (!runtime.getRandomValues) {
  Object.defineProperty(runtime, "getRandomValues", {
    configurable: true,
    value: (bytes: Uint8Array): Uint8Array => ExpoCrypto.getRandomValues(bytes),
  });
}
if (!runtime.randomUUID) {
  Object.defineProperty(runtime, "randomUUID", { configurable: true, value: () => ExpoCrypto.randomUUID() });
}
if (!global.crypto) {
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: runtime });
}
