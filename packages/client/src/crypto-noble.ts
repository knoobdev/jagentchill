import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha2";
import type { CryptoPort, DeviceKeyPair } from "./crypto.ts";

export type NativeDeviceKeyPair = { privateKey: Uint8Array; publicKey: Uint8Array };
export function nobleCryptoPort(random: (size: number) => Uint8Array, uuid: () => string): CryptoPort {
  return {
    randomBytes: random,
    randomUUID: uuid,
    async sha256(bytes) { return sha256(bytes); },
    async generateDeviceKey() {
      const privateKey = random(32);
      return { privateKey, publicKey: ed25519.getPublicKey(privateKey) } as unknown as DeviceKeyPair;
    },
    async publicKeyBytes(key) { return (key as unknown as NativeDeviceKeyPair).publicKey; },
    async signBytes(key, bytes) { return ed25519.sign(bytes, (key as unknown as NativeDeviceKeyPair).privateKey); },
    async verifyBytes(publicKey, bytes, signature) {
      try { return ed25519.verify(signature, bytes, publicKey); } catch { return false; }
    },
    async importDeviceKey(privateKey, publicKey) {
      const seed = privateKey.length === 32 ? privateKey : privateKey.slice(-32);
      if (seed.length !== 32 || publicKey.length !== 32 || !ed25519.getPublicKey(seed).every((byte, index) => byte === publicKey[index])) {
        throw new Error("Stored Ed25519 key is invalid.");
      }
      return { privateKey: seed, publicKey } as unknown as DeviceKeyPair;
    },
  };
}
