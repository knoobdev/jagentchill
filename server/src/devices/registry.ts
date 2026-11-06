import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { ROLE_SCOPES, base64UrlToBytes, bytesToBase64Url, deviceIdFromKeyDigest, type AddressKind, type Platform, type Role, type Scope } from "@jagentchill/protocol";
import { sha256, sha256Hex, verifyText } from "../crypto.ts";
import { ProtocolError } from "../errors.ts";
import { audit, transaction } from "../store/database.ts";

const DAY_MS = 86_400_000;
export const TOKEN_VALIDITY_MS = 30 * DAY_MS;
export const TOKEN_ROTATE_BEFORE_MS = 7 * DAY_MS;
export const TOKEN_RENEWAL_PERIOD_MS = 90 * DAY_MS;
export const PREVIOUS_TOKEN_GRACE_MS = 60_000;

export type DeviceRecord = {
  deviceId: string;
  devicePublicKey: string;
  name: string;
  platform: Platform;
  role: Role;
  state: "active" | "revoked";
  keyProtection: string;
  localSupervisor: boolean;
  paired_ms: number;
  pairedBy: string;
  lastSeen_ms: number;
  lastTransport: AddressKind | null;
};

export type IssuedToken = { value: string; expires_ms: number };

type DeviceRow = {
  device_id: string; public_key: string; name: string; platform: string; role: string; state: string;
  key_protection: string; local_supervisor: number; paired_ms: number; paired_by: string; last_seen_ms: number; last_transport: AddressKind | null;
};
type TokenRow = { digest: string; slot: "current" | "previous"; expires_ms: number; invalid_after_ms: number | null };

const toRecord = (row: DeviceRow): DeviceRecord => ({
  deviceId: row.device_id, devicePublicKey: row.public_key, name: row.name, platform: row.platform as Platform,
  role: row.role as Role, state: row.state as DeviceRecord["state"], keyProtection: row.key_protection,
  localSupervisor: row.local_supervisor === 1, paired_ms: row.paired_ms, pairedBy: row.paired_by, lastSeen_ms: row.last_seen_ms,
  lastTransport: row.last_transport ?? null,
});

/** Device records and device tokens. The record here is the whole of pairing: nothing is written anywhere else. */
export class DeviceRegistry {
  private readonly db: DatabaseSync;
  private readonly now: () => number;

  constructor(db: DatabaseSync, now: () => number) {
    this.db = db;
    this.now = now;
  }

  get(deviceId: string): DeviceRecord | undefined {
    const row = this.db.prepare("SELECT * FROM devices WHERE device_id = ?").get(deviceId) as DeviceRow | undefined;
    return row && toRecord(row);
  }

  list(): DeviceRecord[] {
    return (this.db.prepare("SELECT * FROM devices ORDER BY paired_ms").all() as DeviceRow[]).map(toRecord);
  }

  hasAdmin(): boolean {
    return this.db.prepare("SELECT 1 FROM devices WHERE role = 'admin' AND state = 'active' LIMIT 1").get() !== undefined;
  }

  scopesOf(deviceId: string): readonly Scope[] {
    const device = this.get(deviceId);
    return device?.state === "active" ? ROLE_SCOPES[device.role] : [];
  }

  /** Creates the record and its first token in one transaction. An already paired key keeps its record and its role. */
  pair(input: Omit<DeviceRecord, "state" | "paired_ms" | "lastSeen_ms" | "lastTransport">): { device: DeviceRecord; token: IssuedToken } {
    const now = this.now();
    return transaction(this.db, () => {
      const existing = this.get(input.deviceId);
      if (existing?.state === "active") {
        this.db.prepare("UPDATE devices SET last_seen_ms = ? WHERE device_id = ?").run(now, input.deviceId);
      } else {
        this.db.prepare(
          `INSERT INTO devices (device_id, public_key, name, platform, role, state, key_protection, local_supervisor, paired_ms, paired_by, last_seen_ms)
           VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)
           ON CONFLICT (device_id) DO UPDATE SET name = excluded.name, platform = excluded.platform, role = excluded.role,
             state = 'active', key_protection = excluded.key_protection, local_supervisor = excluded.local_supervisor,
             paired_ms = excluded.paired_ms, paired_by = excluded.paired_by, last_seen_ms = excluded.last_seen_ms`,
        ).run(input.deviceId, input.devicePublicKey, input.name, input.platform, input.role, input.keyProtection,
          input.localSupervisor ? 1 : 0, now, input.pairedBy, now);
      }
      const token = this.replaceToken(input.deviceId, now);
      audit(this.db, now, input.pairedBy, "device.paired", { deviceId: input.deviceId, role: existing?.state === "active" ? existing.role : input.role });
      return { device: this.get(input.deviceId)!, token };
    });
  }

  /** Issues a new current token; the value it replaces stays valid as `previous` until the new one has been presented. */
  private replaceToken(deviceId: string, now: number): IssuedToken {
    this.db.prepare("DELETE FROM device_tokens WHERE device_id = ? AND slot = 'previous'").run(deviceId);
    this.db.prepare("UPDATE device_tokens SET slot = 'previous', invalid_after_ms = NULL WHERE device_id = ? AND slot = 'current'").run(deviceId);
    return this.insertCurrentToken(deviceId, now);
  }

  private insertCurrentToken(deviceId: string, now: number): IssuedToken {
    const value = randomBytes(32).toString("base64url");
    const expires_ms = now + TOKEN_VALIDITY_MS;
    this.db.prepare("INSERT INTO device_tokens (device_id, digest, slot, expires_ms, issued_ms) VALUES (?, ?, 'current', ?, ?)")
      .run(deviceId, sha256Hex(value), expires_ms, now);
    return { value, expires_ms };
  }

  rotateToken(deviceId: string, actor: string): void {
    const now = this.now();
    transaction(this.db, () => {
      // Forces rotation at the next handshake: the device still presents its current value once.
      this.db.prepare("UPDATE device_tokens SET expires_ms = MIN(expires_ms, ?) WHERE device_id = ? AND slot = 'current'")
        .run(now + TOKEN_ROTATE_BEFORE_MS - 1, deviceId);
      audit(this.db, now, actor, "device.token.rotate", { deviceId });
    });
  }

  /**
   * Checks the token presented in a handshake that already proved possession of the device key.
   * Returns a replacement to send in `ready` when rotation is due.
   */
  checkToken(deviceId: string, presented: string): { replacement?: IssuedToken } {
    const now = this.now();
    const digest = sha256Hex(presented);
    return transaction(this.db, () => {
      const rows = this.db.prepare("SELECT digest, slot, expires_ms, invalid_after_ms FROM device_tokens WHERE device_id = ?").all(deviceId) as TokenRow[];
      const row = rows.find((candidate) => candidate.digest === digest);
      if (!row) throw new ProtocolError("TOKEN_INVALID", "The device token was not issued to this device.", { httpStatus: 401 });
      if (row.slot === "previous") {
        if (row.invalid_after_ms !== null) {
          if (now > row.invalid_after_ms) throw new ProtocolError("TOKEN_INVALID", "The device token has been replaced.", { httpStatus: 401 });
          return {};
        }
        // The `ready` frame that carried the replacement was lost: issue a fresh one, this value stays usable.
        this.db.prepare("DELETE FROM device_tokens WHERE device_id = ? AND slot = 'current'").run(deviceId);
        return { replacement: this.insertCurrentToken(deviceId, now) };
      }
      // Presenting the current value starts the 60 s grace of the value it replaced.
      this.db.prepare("UPDATE device_tokens SET invalid_after_ms = ? WHERE device_id = ? AND slot = 'previous' AND invalid_after_ms IS NULL")
        .run(now + PREVIOUS_TOKEN_GRACE_MS, deviceId);
      if (now > row.expires_ms + TOKEN_RENEWAL_PERIOD_MS) {
        throw new ProtocolError("TOKEN_EXPIRED", "The device token expired more than 90 days ago; pair this device again.", { httpStatus: 401 });
      }
      if (row.expires_ms - now < TOKEN_ROTATE_BEFORE_MS) return { replacement: this.replaceToken(deviceId, now) };
      return {};
    });
  }

  /** For signed HTTP requests, which carry no token: the device must still hold a token inside the renewal period. */
  assertTokenNotLapsed(deviceId: string): void {
    const row = this.db.prepare("SELECT expires_ms FROM device_tokens WHERE device_id = ? AND slot = 'current'").get(deviceId) as { expires_ms: number } | undefined;
    if (!row || this.now() > row.expires_ms + TOKEN_RENEWAL_PERIOD_MS) {
      throw new ProtocolError("TOKEN_EXPIRED", "The device token expired more than 90 days ago; pair this device again.", { httpStatus: 401 });
    }
  }

  touch(deviceId: string): void {
    this.db.prepare("UPDATE devices SET last_seen_ms = ? WHERE device_id = ?").run(this.now(), deviceId);
  }

  recordTransport(deviceId: string, transport: AddressKind): void {
    this.db.prepare("UPDATE devices SET last_seen_ms = ?, last_transport = ? WHERE device_id = ?").run(this.now(), transport, deviceId);
  }

  setRole(deviceId: string, role: Role, actor: string): DeviceRecord {
    return transaction(this.db, () => {
      const device = this.requireActive(deviceId);
      if (device.role === "admin" && role !== "admin") this.assertNotLastAdmin(deviceId);
      this.db.prepare("UPDATE devices SET role = ? WHERE device_id = ?").run(role, deviceId);
      audit(this.db, this.now(), actor, "device.role.set", { deviceId, from: device.role, to: role });
      return this.get(deviceId)!;
    });
  }

  revoke(deviceId: string, actor: string): void {
    transaction(this.db, () => {
      const device = this.requireActive(deviceId);
      if (device.role === "admin") this.assertNotLastAdmin(deviceId);
      this.db.prepare("UPDATE devices SET state = 'revoked' WHERE device_id = ?").run(deviceId);
      this.db.prepare("DELETE FROM device_tokens WHERE device_id = ?").run(deviceId);
      audit(this.db, this.now(), actor, "device.revoked", { deviceId });
    });
  }

  /**
   * Replaces a device's key without a new pairing. The caller's connection was authenticated with the old key; both
   * keys signed the same statement, which names this host. The new record takes the role, the name and the supervisor
   * flag; the old one is revoked with its tokens. At most one rotation per device per 24 hours.
   */
  rotateKey(oldDeviceId: string, proof: { newDevicePublicKey: string; ts: number; signatureByOldKey: string; signatureByNewKey: string }, gatewayId: string, source: { transport: string }): { device: DeviceRecord; token: IssuedToken } {
    const now = this.now();
    const old = this.requireActive(oldDeviceId);
    if (old.platform === "web") throw new ProtocolError("UNSUPPORTED_FEATURE", "A browser's key is replaced by pairing again.");
    const raw = base64UrlToBytes(proof.newDevicePublicKey);
    if (raw?.length !== 32 || bytesToBase64Url(raw) !== proof.newDevicePublicKey) throw new ProtocolError("INVALID_PARAMS", "The new key is not an Ed25519 public key.");
    if (Math.abs(proof.ts - now) > 120_000) throw new ProtocolError("CLOCK_SKEW", "The rotation statement is not from now.", { httpStatus: 401 });
    const statement = ["JAGENTCHILL-ROTATE-V1", gatewayId, oldDeviceId, proof.newDevicePublicKey, String(proof.ts)].join("\n");
    // Only the holder of the old key can move the identity, and only to a key it holds.
    if (!verifyText(old.devicePublicKey, statement, proof.signatureByOldKey) || !verifyText(proof.newDevicePublicKey, statement, proof.signatureByNewKey)) {
      throw new ProtocolError("SIGNATURE_INVALID", "The rotation statement is not signed by both keys.", { httpStatus: 401 });
    }
    const newDeviceId = deviceIdFromKeyDigest(sha256(raw));
    return transaction(this.db, () => {
      if (this.get(newDeviceId) || this.db.prepare("SELECT 1 FROM devices WHERE public_key = ?").get(proof.newDevicePublicKey)) throw new ProtocolError("ALREADY_EXISTS", "The new key already belongs to a device.", { httpStatus: 409 });
      const recent = (this.db.prepare("SELECT details FROM audit WHERE action = 'device.key_rotated' AND ts_ms > ?").all(now - DAY_MS) as Array<{ details: string }>)
        .some((row) => { const details = JSON.parse(row.details) as { newDeviceId?: string; oldDeviceId?: string }; return details.newDeviceId === oldDeviceId || details.oldDeviceId === oldDeviceId; });
      if (recent) throw new ProtocolError("RATE_LIMITED", "This device's key was replaced less than 24 hours ago.", { httpStatus: 429, details: { retryAfter_ms: DAY_MS } });
      this.db.prepare(
        `INSERT INTO devices (device_id, public_key, name, platform, role, state, key_protection, local_supervisor, paired_ms, paired_by, last_seen_ms)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
      ).run(newDeviceId, proof.newDevicePublicKey, old.name, old.platform, old.role, old.keyProtection, old.localSupervisor ? 1 : 0, old.paired_ms, old.pairedBy, now);
      this.db.prepare("UPDATE devices SET state = 'revoked', local_supervisor = 0 WHERE device_id = ?").run(oldDeviceId);
      this.db.prepare("DELETE FROM device_tokens WHERE device_id = ?").run(oldDeviceId);
      const token = this.insertCurrentToken(newDeviceId, now);
      audit(this.db, now, `device:${oldDeviceId}`, "device.key_rotated", { oldDeviceId, newDeviceId, oldFingerprint: oldDeviceId.slice(0, 16), newFingerprint: newDeviceId.slice(0, 16), transport: source.transport });
      return { device: this.get(newDeviceId)!, token };
    });
  }

  private requireActive(deviceId: string): DeviceRecord {
    const device = this.get(deviceId);
    if (!device) throw new ProtocolError("DEVICE_UNKNOWN", "No such device.", { httpStatus: 404 });
    if (device.state !== "active") throw new ProtocolError("DEVICE_REVOKED", "The device is revoked.", { httpStatus: 403 });
    return device;
  }

  private assertNotLastAdmin(deviceId: string): void {
    const other = this.db.prepare("SELECT 1 FROM devices WHERE role = 'admin' AND state = 'active' AND device_id <> ? LIMIT 1").get(deviceId);
    if (!other) throw new ProtocolError("LAST_ADMIN", "The last admin device cannot be removed or demoted.", { httpStatus: 409 });
  }
}
