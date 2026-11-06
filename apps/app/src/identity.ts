import { Platform } from "react-native";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { createWebCryptoSigner, generateDeviceKey, type DeviceSigner, type HostRecord, type StoredDeviceKey } from "@jagentchill/client";
import { createNativeIdentityStore } from "./identityNative";
import { nativeDeviceDisplayName } from "./pairing/device-name";

/**
 * Device identity and the host registry on the web and in the desktop shell: a non-extractable Ed25519 key and the
 * host records live in IndexedDB database `jagentchill-identity`. Native apps keep the signing key, host records,
 * and rotated device tokens in Expo SecureStore (iOS Keychain / Android Keystore-backed encrypted storage).
 */
const DB_NAME = "jagentchill-identity";
const PENDING_OFFER = "jagentchill.identity.pending-offer.v1";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("keys");
      request.result.createObjectStore("hosts", { keyPath: "gatewayId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(store: "keys" | "hosts", mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const request = work(db.transaction(store, mode).objectStore(store));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

export class KeyStorageUnavailable extends Error {
  readonly code = "KEY_STORAGE_UNAVAILABLE";
}

let cached: Promise<DeviceSigner> | undefined;
const nativeIdentity = createNativeIdentityStore(SecureStore);

export function loadSigner(): Promise<DeviceSigner> {
  cached ??= (async () => {
    if (Platform.OS !== "web") return nativeIdentity.loadSigner();
    if (typeof indexedDB === "undefined" || !globalThis.crypto?.subtle) throw new KeyStorageUnavailable("This build has no protected key storage on this platform yet.");
    let key = await run<StoredDeviceKey | undefined>("keys", "readonly", (store) => store.get("device"));
    if (!key) {
      key = await generateDeviceKey();
      await run("keys", "readwrite", (store) => store.put(key, "device"));
    }
    return createWebCryptoSigner(key);
  })();
  cached.catch(() => (cached = undefined));
  return cached;
}

export const listHosts = async (): Promise<HostRecord[]> => {
  if (Platform.OS !== "web") return nativeIdentity.listHosts();
  return run<HostRecord[]>("hosts", "readonly", (store) => store.getAll());
};
export const getHost = async (gatewayId: string): Promise<HostRecord | undefined> => {
  if (Platform.OS !== "web") return nativeIdentity.getHost(gatewayId);
  return run<HostRecord | undefined>("hosts", "readonly", (store) => store.get(gatewayId));
};
export const saveHost = async (host: HostRecord): Promise<unknown> => {
  if (Platform.OS !== "web") return nativeIdentity.saveHost(host);
  return run("hosts", "readwrite", (store) => store.put(host));
};
export const removeHost = async (gatewayId: string): Promise<unknown> => {
  if (Platform.OS !== "web") return nativeIdentity.removeHost(gatewayId);
  return run("hosts", "readwrite", (store) => store.delete(gatewayId));
};
export const savePendingOffer = async (offer: string): Promise<void> => {
  if (Platform.OS !== "web") return nativeIdentity.savePendingOffer(offer);
  localStorage.setItem(PENDING_OFFER, offer);
};
export const loadPendingOffer = async (): Promise<string | null> => Platform.OS !== "web"
  ? nativeIdentity.loadPendingOffer()
  : localStorage.getItem(PENDING_OFFER);
export const clearPendingOffer = async (): Promise<void> => {
  if (Platform.OS !== "web") return nativeIdentity.clearPendingOffer();
  localStorage.removeItem(PENDING_OFFER);
};

export function devicePlatform(): "web" | "ios" | "android" | "macos" | "windows" | "linux" {
  return Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : "web";
}
/** How this device's key is protected, as the host's device list shows it. */
export const keyProtection = (): string => Platform.OS === "web" ? "webcrypto" : "secure-store";
export const defaultDeviceName = (): string => Platform.OS === "web" ? "This browser"
  : Platform.OS === "ios" || Platform.OS === "android"
    ? nativeDeviceDisplayName(Platform.OS, Constants.deviceName, (Platform.constants as { Model?: string }).Model)
    : "This computer";
/** The desktop shell tells its signer which host is being paired; a browser's signer needs no such step. */
export const beginPairing = (_offer: string, _origin: string, _proxy?: { port: number; secret: string }): Promise<unknown> => Promise.resolve();
export const endPairing = (): Promise<unknown> => Promise.resolve();
/** Enrolment calls are relayed only through the desktop shell's main process; a browser posts them with `fetch`. */
export const postEnrolment = (_step: string, _json: string): Promise<{ status: number; body: unknown }> =>
  Promise.reject(new Error("the desktop bridge is not available"));
