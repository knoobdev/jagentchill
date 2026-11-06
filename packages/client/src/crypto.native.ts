import * as ExpoCrypto from "expo-crypto";
import type { CryptoPort } from "./crypto.ts";
import { nobleCryptoPort } from "./crypto-noble.ts";

const port: CryptoPort = nobleCryptoPort((size) => {
  const bytes = new Uint8Array(size);
  ExpoCrypto.getRandomValues(bytes);
  return bytes;
}, () => ExpoCrypto.randomUUID());
export type { CryptoPort, DeviceKeyPair, StoredDeviceKey } from "./crypto.ts";
export const { randomBytes, randomUUID, sha256, generateDeviceKey, publicKeyBytes, signBytes, verifyBytes, importDeviceKey } = port;
