import { chmodSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { base64UrlToBytes, bytesToBase64Url, deviceIdFromKeyDigest, type Platform } from "@jagentchill/protocol";
import { sha256 } from "../crypto.ts";
import { ProtocolError } from "../errors.ts";
import { audit, transaction } from "../store/database.ts";
import type { DeviceRecord, DeviceRegistry, IssuedToken } from "./registry.ts";

export const BOOTSTRAP_KEY_ENV = "JAGENTCHILL_BOOTSTRAP_DEVICE_PUBLIC_KEY";
export const BOOTSTRAP_PROTECTION_ENV = "JAGENTCHILL_BOOTSTRAP_KEY_PROTECTION";
export const LOCAL_DEVICE_NAME = "This computer";

export type BootstrapOutcome =
  | { state: "registered"; device: DeviceRecord; file: string }
  /** No variable, or the variable names the key of the computer that already is this host's device. */
  | { state: "unchanged" }
  /** An admin exists and the variable names another key: nothing is created. */
  | { state: "ignored"; deviceId: string }
  | { state: "invalid" };

const hostPlatform = (platform: NodeJS.Platform): Platform => (platform === "darwin" ? "macos" : platform === "win32" ? "windows" : "linux");

function deviceIdOf(publicKey: string): string | null {
  const raw = base64UrlToBytes(publicKey);
  // The canonical encoding only: a second spelling of the same key must not become a second record.
  return raw?.length === 32 && bytesToBase64Url(raw) === publicKey ? deviceIdFromKeyDigest(sha256(raw)) : null;
}

/** The token goes to the desktop app through a file only this OS user can read; the app reads it once and deletes it. */
function writeBootstrapFile(dataDir: string, deviceId: string, token: IssuedToken): string {
  const directory = join(dataDir, "bootstrap");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const file = join(directory, `${deviceId}.json`);
  const temp = `${file}.tmp`;
  writeFileSync(temp, JSON.stringify({ deviceToken: token }), { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, file);
  return file;
}

/**
 * The desktop-started trust bootstrap: with no admin record, the key the desktop app passed in the environment becomes
 * the admin device "This computer", flagged as the supervisor of this server. With an admin record the variable
 * changes nothing. Being connected over loopback creates no trust by itself — the app still signs every connection.
 */
export function bootstrapFirstDevice(opts: {
  devices: DeviceRegistry;
  dataDir: string;
  publicKey: string | undefined;
  keyProtection?: string;
  platform?: NodeJS.Platform;
  log?: (level: "info" | "warn", event: string, details: Record<string, unknown>) => void;
}): BootstrapOutcome {
  if (!opts.publicKey) return { state: "unchanged" };
  const deviceId = deviceIdOf(opts.publicKey);
  if (!deviceId) {
    opts.log?.("warn", "bootstrap_key_invalid", {});
    return { state: "invalid" };
  }
  if (opts.devices.hasAdmin()) {
    if (opts.devices.get(deviceId)?.state === "active") return { state: "unchanged" };
    opts.log?.("warn", "bootstrap_key_ignored", { deviceId });
    return { state: "ignored", deviceId };
  }
  const { device, token } = opts.devices.pair({
    deviceId, devicePublicKey: opts.publicKey, name: LOCAL_DEVICE_NAME, platform: hostPlatform(opts.platform ?? process.platform), role: "admin",
    keyProtection: opts.keyProtection === "file" ? "file" : "os-store", localSupervisor: true, pairedBy: "bootstrap",
  });
  const file = writeBootstrapFile(opts.dataDir, deviceId, token);
  opts.log?.("info", "bootstrap_device_registered", { deviceId });
  return { state: "registered", device, file };
}

/**
 * `jagentchill devices add-admin --public-key <key> --local-supervisor`: the recovery for a desktop whose key was lost.
 * The new key becomes an admin; with the flag, it becomes the one supervisor record and older records lose the flag.
 */
export function restoreLocalAdmin(opts: {
  devices: DeviceRegistry; db: DatabaseSync; dataDir: string; publicKey: string; localSupervisor: boolean; keyProtection?: string;
  platform?: NodeJS.Platform; now: () => number;
}): { device: DeviceRecord; file: string } {
  const deviceId = deviceIdOf(opts.publicKey);
  if (!deviceId) throw new ProtocolError("INVALID_PARAMS", "The public key is not a base64url Ed25519 key.");
  const existing = opts.devices.get(deviceId);
  const { token } = opts.devices.pair({
    deviceId, devicePublicKey: opts.publicKey, name: existing?.name ?? LOCAL_DEVICE_NAME, platform: existing?.platform ?? hostPlatform(opts.platform ?? process.platform),
    role: "admin", keyProtection: opts.keyProtection === "file" ? "file" : "os-store", localSupervisor: opts.localSupervisor, pairedBy: "host-cli",
  });
  transaction(opts.db, () => {
    // An active record keeps its role when paired again: the recovery sets role and flag explicitly.
    opts.db.prepare("UPDATE devices SET role = 'admin', local_supervisor = ? WHERE device_id = ?").run(opts.localSupervisor ? 1 : 0, deviceId);
    if (opts.localSupervisor) opts.db.prepare("UPDATE devices SET local_supervisor = 0 WHERE device_id <> ?").run(deviceId);
    audit(opts.db, opts.now(), "host-cli", "device.admin_restored", { deviceId, localSupervisor: opts.localSupervisor });
  });
  return { device: opts.devices.get(deviceId)!, file: writeBootstrapFile(opts.dataDir, deviceId, token) };
}
