import { base64UrlToBytes, bytesToBase64Url } from "@jagentchill/protocol";
import { createWebCryptoSigner, generateDeviceKey, importDeviceKey, type DeviceSigner, type HostRecord } from "@jagentchill/client";

/** The string-only API implemented by Expo SecureStore and by the test fixture. */
export type ProtectedStorage = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};

const KEY = "jagentchill.identity.device-key.v1";
const HOST_PREFIX = "jagentchill.identity.host.v1.";
const PENDING_OFFER = "jagentchill.identity.pending-offer.v1";

const bytesToBase64 = (bytes: Uint8Array): string => bytesToBase64Url(bytes).replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(bytes.length / 3) * 4, "=");
const base64ToBytes = (value: string): Uint8Array => {
  const decoded = base64UrlToBytes(value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
  if (!decoded) throw new Error("Stored device key is not valid base64.");
  return decoded;
};
/** Native identity persistence: SecureStore encrypts records with iOS Keychain / Android Keystore-backed storage. */
export function createNativeIdentityStore(storage: ProtectedStorage) {
  async function loadSigner(): Promise<DeviceSigner> {
    const stored = await storage.getItemAsync(KEY);
    let privateBytes: Uint8Array, publicBytes: Uint8Array;
    if (stored) {
      const value = JSON.parse(stored) as { privateKey: string; publicKey: string };
      privateBytes = base64ToBytes(value.privateKey);
      publicBytes = base64ToBytes(value.publicKey);
    } else {
      const pair = await generateDeviceKey();
      privateBytes = pair.privateKey as unknown as Uint8Array;
      publicBytes = pair.publicKey as unknown as Uint8Array;
      await storage.setItemAsync(KEY, JSON.stringify({ privateKey: bytesToBase64(privateBytes), publicKey: bytesToBase64(publicBytes) }));
    }
    return createWebCryptoSigner(await importDeviceKey(privateBytes, publicBytes));
  }
  async function hostIds(): Promise<string[]> {
    const value = await storage.getItemAsync(`${HOST_PREFIX}index`);
    return value ? JSON.parse(value) as string[] : [];
  }
  return {
    loadSigner,
    async listHosts(): Promise<HostRecord[]> {
      const items = await Promise.all((await hostIds()).map(async (id) => {
        const value = await storage.getItemAsync(`${HOST_PREFIX}${id}`);
        return value ? JSON.parse(value) as HostRecord : null;
      }));
      return items.filter((item): item is HostRecord => !!item);
    },
    async getHost(gatewayId: string): Promise<HostRecord | undefined> {
      const value = await storage.getItemAsync(`${HOST_PREFIX}${gatewayId}`);
      return value ? JSON.parse(value) as HostRecord : undefined;
    },
    async saveHost(host: HostRecord): Promise<void> {
      const index = await hostIds();
      if (!index.includes(host.gatewayId)) await storage.setItemAsync(`${HOST_PREFIX}index`, JSON.stringify([...index, host.gatewayId]));
      await storage.setItemAsync(`${HOST_PREFIX}${host.gatewayId}`, JSON.stringify(host));
    },
    async removeHost(gatewayId: string): Promise<void> {
      await storage.setItemAsync(`${HOST_PREFIX}index`, JSON.stringify((await hostIds()).filter((id) => id !== gatewayId)));
      await storage.deleteItemAsync(`${HOST_PREFIX}${gatewayId}`);
    },
    savePendingOffer(offer: string): Promise<void> { return storage.setItemAsync(PENDING_OFFER, offer); },
    loadPendingOffer(): Promise<string | null> { return storage.getItemAsync(PENDING_OFFER); },
    clearPendingOffer(): Promise<void> { return storage.deleteItemAsync(PENDING_OFFER); },
  };
}
