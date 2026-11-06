/** Browser crypto boundary. React Native resolves the same import to crypto.native.ts. */
export type DeviceKeyPair = { privateKey: CryptoKey; publicKey: CryptoKey };
export type StoredDeviceKey = DeviceKeyPair;
export type CryptoPort = {
  randomBytes(size: number): Uint8Array;
  randomUUID(): string;
  sha256(bytes: Uint8Array): Promise<Uint8Array>;
  generateDeviceKey(): Promise<DeviceKeyPair>;
  publicKeyBytes(key: DeviceKeyPair): Promise<Uint8Array>;
  signBytes(key: DeviceKeyPair, bytes: Uint8Array): Promise<Uint8Array>;
  verifyBytes(publicKey: Uint8Array, bytes: Uint8Array, signature: Uint8Array): Promise<boolean>;
  importDeviceKey(privateKey: Uint8Array, publicKey: Uint8Array): Promise<DeviceKeyPair>;
};
let override: CryptoPort | undefined;
/** Test seam for proving the same client code with WebCrypto unavailable. Apps use the platform file resolver. */
export function setCryptoPortForTests(port: CryptoPort | undefined): void { override = port; }

export function randomBytes(size: number): Uint8Array {
  if (override) return override.randomBytes(size);
  return globalThis.crypto.getRandomValues(new Uint8Array(size));
}
export function randomUUID(): string {
  if (override) return override.randomUUID();
  return globalThis.crypto.randomUUID();
}
export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  if (override) return override.sha256(bytes);
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource));
}
export async function generateDeviceKey(): Promise<DeviceKeyPair> {
  if (override) return override.generateDeviceKey();
  return await globalThis.crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]) as CryptoKeyPair;
}
export async function publicKeyBytes(key: DeviceKeyPair): Promise<Uint8Array> {
  if (override) return override.publicKeyBytes(key);
  return new Uint8Array(await globalThis.crypto.subtle.exportKey("raw", key.publicKey));
}
export async function signBytes(key: DeviceKeyPair, bytes: Uint8Array): Promise<Uint8Array> {
  if (override) return override.signBytes(key, bytes);
  return new Uint8Array(await globalThis.crypto.subtle.sign({ name: "Ed25519" }, key.privateKey, bytes as BufferSource));
}
export async function verifyBytes(publicKey: Uint8Array, bytes: Uint8Array, signature: Uint8Array): Promise<boolean> {
  if (override) return override.verifyBytes(publicKey, bytes, signature);
  const key = await globalThis.crypto.subtle.importKey("raw", publicKey as BufferSource, { name: "Ed25519" }, false, ["verify"]);
  return globalThis.crypto.subtle.verify({ name: "Ed25519" }, key, signature as BufferSource, bytes as BufferSource);
}
export async function importDeviceKey(privateKey: Uint8Array, publicKey: Uint8Array): Promise<DeviceKeyPair> {
  if (override) return override.importDeviceKey(privateKey, publicKey);
  const privateCryptoKey = await globalThis.crypto.subtle.importKey("pkcs8", privateKey as BufferSource, { name: "Ed25519" }, false, ["sign"]);
  const publicCryptoKey = await globalThis.crypto.subtle.importKey("raw", publicKey as BufferSource, { name: "Ed25519" }, false, ["verify"]);
  return { privateKey: privateCryptoKey, publicKey: publicCryptoKey };
}
