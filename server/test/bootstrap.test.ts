import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { PairingOffer } from "@jagentchill/protocol";
import { createServerApp, type HostStatus } from "../src/app.ts";
import { parseCommandLine, runAddAdmin } from "../src/cli.ts";
import { bootstrapFirstDevice } from "../src/devices/bootstrap.ts";
import { DeviceSim } from "./device-sim.ts";

async function start(over: Partial<Parameters<typeof createServerApp>[0]> = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "jagentchill-bootstrap-"));
  const app = createServerApp({ dataDir, localAdminToken: "local-admin-token", ...over });
  await new Promise<void>((resolve) => app.http.listen(0, "127.0.0.1", resolve));
  const port = (app.http.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  // What a client knows of the host: its public identity. Nothing here is an offer a device could enrol with.
  const identity = { gatewayId: app.host.gatewayId, gatewayPublicKey: app.host.gatewayPublicKey } as PairingOffer;
  const sockets: Array<{ terminate(): void }> = [];
  return {
    app, dataDir, base, port, identity, sockets,
    close: () => {
      for (const socket of sockets) socket.terminate();
      app.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
const readToken = (file: string) => (JSON.parse(readFileSync(file, "utf8")) as { deviceToken: { value: string; expires_ms: number } }).deviceToken;

test("Desktop first run: the key in the environment becomes the one admin device, flagged as local supervisor, and still signs every connection", async () => {
  const host = await start();
  try {
    const desktop = new DeviceSim(host.base, "desktop");
    const logs: string[] = [];
    const outcome = bootstrapFirstDevice({ devices: host.app.devices, dataDir: host.dataDir, publicKey: desktop.devicePublicKey, platform: "darwin", log: (_level, event) => logs.push(event) });
    assert.equal(outcome.state, "registered");
    const records = host.app.devices.list();
    assert.equal(records.length, 1);
    assert.deepEqual(
      { role: records[0].role, localSupervisor: records[0].localSupervisor, key: records[0].devicePublicKey, name: records[0].name, platform: records[0].platform, keyProtection: records[0].keyProtection },
      { role: "admin", localSupervisor: true, key: desktop.devicePublicKey, name: "This computer", platform: "macos", keyProtection: "os-store" },
    );
    // The file is owner-only and holds the device token and nothing else.
    const file = join(host.dataDir, "bootstrap", `${desktop.deviceId}.json`);
    assert.equal(outcome.state === "registered" && outcome.file, file);
    if (process.platform !== "win32") {
      assert.equal(statSync(file).mode & 0o777, 0o600);
      assert.equal(statSync(join(host.dataDir, "bootstrap")).mode & 0o777, 0o700);
    }
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(file, "utf8"))), ["deviceToken"]);
    const token = readToken(file);
    assert.match(token.value, /^[A-Za-z0-9_-]{43}$/);

    // No pairing code was involved, and loopback alone is not trust: the handshake is signed like any other.
    assert.equal(host.app.pairing.pending().length, 0);
    desktop.token = token.value;
    const session = desktop.connect(host.identity);
    host.sockets.push(session.ws);
    const ready = (await session.outcome).ready;
    assert.equal(ready.role, "admin");
    assert.equal(ready.gatewayOk, true);
    const unsigned = new DeviceSim(host.base, "other");
    unsigned.token = token.value;
    const refused = unsigned.connect(host.identity);
    host.sockets.push(refused.ws);
    assert.ok((await refused.outcome).close, "a different key with the stolen token is refused");
    const bare = desktop.connect(host.identity, { signBareNonce: true });
    host.sockets.push(bare.ws);
    assert.ok((await bare.outcome).close, "a signature that is not over the transcript is refused");
  } finally { host.close(); }
});

test("Bootstrap variable set on an initialised Gateway: no record is created and bootstrap_key_ignored is logged at warn", async () => {
  const host = await start();
  try {
    const first = new DeviceSim(host.base), second = new DeviceSim(host.base);
    bootstrapFirstDevice({ devices: host.app.devices, dataDir: host.dataDir, publicKey: first.devicePublicKey });
    const logs: Array<{ level: string; event: string }> = [];
    const outcome = bootstrapFirstDevice({ devices: host.app.devices, dataDir: host.dataDir, publicKey: second.devicePublicKey, log: (level, event) => logs.push({ level, event }) });
    assert.equal(outcome.state, "ignored");
    assert.deepEqual(logs, [{ level: "warn", event: "bootstrap_key_ignored" }]);
    assert.equal(host.app.devices.get(second.deviceId), undefined);
    assert.deepEqual(readdirSync(join(host.dataDir, "bootstrap")), [`${first.deviceId}.json`]);
    // The same key at a later start changes nothing and writes no new token.
    rmSync(join(host.dataDir, "bootstrap", `${first.deviceId}.json`));
    assert.equal(bootstrapFirstDevice({ devices: host.app.devices, dataDir: host.dataDir, publicKey: first.devicePublicKey }).state, "unchanged");
    assert.deepEqual(readdirSync(join(host.dataDir, "bootstrap")), []);
    // No variable, or one that is not a key: nothing happens.
    assert.equal(bootstrapFirstDevice({ devices: host.app.devices, dataDir: host.dataDir, publicKey: undefined }).state, "unchanged");
  } finally { host.close(); }
});

test("a bootstrap key that is not a canonical Ed25519 public key registers nothing", async () => {
  const host = await start();
  try {
    for (const publicKey of ["hello", "A".repeat(42), `${"A".repeat(43)}=`]) {
      assert.equal(bootstrapFirstDevice({ devices: host.app.devices, dataDir: host.dataDir, publicKey }).state, "invalid");
    }
    assert.equal(host.app.devices.list().length, 0);
    assert.equal(existsSync(join(host.dataDir, "bootstrap")), false);
  } finally { host.close(); }
});

test("Restore this computer as admin: the new key is an admin carrying localSupervisor, the old record loses the flag, and the audit names host-cli", async () => {
  const host = await start();
  try {
    const lost = new DeviceSim(host.base), fresh = new DeviceSim(host.base);
    bootstrapFirstDevice({ devices: host.app.devices, dataDir: host.dataDir, publicKey: lost.devicePublicKey });
    // The endpoint exists for the host CLI on this machine only: no token, a wrong token or a browser gets 404.
    const target = `${host.base}/jagentchill/v1/local-admin/devices/add-admin`;
    const body = JSON.stringify({ publicKey: fresh.devicePublicKey, localSupervisor: true });
    for (const headers of [{}, { authorization: "Bearer wrong" }, { authorization: "Bearer local-admin-token", origin: host.base }] as Record<string, string>[]) {
      assert.equal((await fetch(target, { method: "POST", headers: { "content-type": "application/json", ...headers }, body })).status, 404);
    }
    assert.equal(host.app.devices.get(fresh.deviceId), undefined);

    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync(join(host.dataDir, "run"), { recursive: true });
    writeFileSync(join(host.dataDir, "run", "server.json"), JSON.stringify({ pid: process.pid, port: host.port }));
    writeFileSync(join(host.dataDir, "secrets", "local-admin"), "local-admin-token");
    const command = parseCommandLine(["devices", "add-admin", "--public-key", fresh.devicePublicKey, "--local-supervisor"]);
    assert.equal(await runAddAdmin(host.dataDir, command), 0);

    const restored = host.app.devices.get(fresh.deviceId)!;
    assert.deepEqual({ role: restored.role, localSupervisor: restored.localSupervisor }, { role: "admin", localSupervisor: true });
    assert.equal(host.app.devices.get(lost.deviceId)!.localSupervisor, false);
    const audit = host.app.db.prepare("SELECT actor, details FROM audit WHERE action = 'device.admin_restored'").all() as Array<{ actor: string; details: string }>;
    assert.deepEqual(audit.map((row) => row.actor), ["host-cli"]);
    assert.equal(JSON.parse(audit[0].details).deviceId, fresh.deviceId);
    // The restored computer connects with the token of its own bootstrap file.
    fresh.token = readToken(join(host.dataDir, "bootstrap", `${fresh.deviceId}.json`)).value;
    const session = fresh.connect(host.identity);
    host.sockets.push(session.ws);
    assert.equal((await session.outcome).ready.role, "admin");
  } finally { host.close(); }
});

test("shutdown.prepare is accepted only from the local supervisor device, and only that device learns the Gateway pid", async () => {
  let prepared = 0;
  const status: HostStatus = { gateway: { state: "ready", pid: 4242, restartCount: 0 }, serverVersion: "0.0.0", started_ms: 1, port: 1 };
  const host = await start({ hostStatus: () => status, prepareShutdown: async () => { prepared++; return { safe: true, running: [] }; } });
  try {
    const desktop = new DeviceSim(host.base, "desktop");
    const outcome = bootstrapFirstDevice({ devices: host.app.devices, dataDir: host.dataDir, publicKey: desktop.devicePublicKey });
    assert.equal(outcome.state, "registered");
    desktop.token = readToken(join(host.dataDir, "bootstrap", `${desktop.deviceId}.json`)).value;
    const supervisor = desktop.connect(host.identity);
    host.sockets.push(supervisor.ws);
    await supervisor.outcome;

    // A second admin, paired the ordinary way, is not the supervisor.
    const offer = host.app.pairing.createOffer([{ kind: "loopback", url: "ws://127.0.0.1/jagentchill/v1/ws" }], { rolePreset: "admin" });
    const phone = new DeviceSim(host.base, "phone");
    const requestId = await phone.enrolUntilProved(offer);
    await phone.verify(offer, requestId, host.app.pairing.pending().find((request) => request.requestId === requestId)!.code);
    const other = phone.connect(offer);
    host.sockets.push(other.ws);
    assert.equal((await other.outcome).ready.role, "admin");

    const seenByOther = await other.call("jagentchill.settings.host.get");
    assert.equal(seenByOther.ok, true);
    assert.equal(seenByOther.result.gateway.state, "ready");
    assert.equal(seenByOther.result.gateway.pid, undefined);
    const refused = await other.call("jagentchill.diagnostics.shutdown.prepare", {});
    assert.equal(refused.ok, false);
    assert.equal(refused.error.code, "PERMISSION_DENIED");
    assert.equal(prepared, 0);

    const seen = await supervisor.call("jagentchill.settings.host.get");
    assert.equal(seen.result.gateway.pid, 4242);
    assert.deepEqual(seen.result.network, { tailnet: { enabled: false, available: false }, lan: { enabled: false, available: false } });
    const accepted = await supervisor.call("jagentchill.diagnostics.shutdown.prepare", {});
    assert.deepEqual(accepted.result, { safe: true });
    assert.equal(prepared, 1);

  } finally { host.close(); }
});

test("the health route names the host's public identity and the renderer origin of the desktop app is allowed only when listed", async () => {
  const host = await start({ allowedOrigins: ["app://jagentchill"] });
  try {
    const health = await fetch(`${host.base}/jagentchill/v1/health`, { headers: { origin: "app://jagentchill" } });
    assert.equal(health.headers.get("access-control-allow-origin"), "app://jagentchill");
    const body = (await health.json()) as { gatewayId: string; gatewayPublicKey: string; protocolVersion: number };
    assert.deepEqual([body.gatewayId, body.gatewayPublicKey, body.protocolVersion], [host.app.host.gatewayId, host.app.host.gatewayPublicKey, 1]);
    assert.equal((await fetch(`${host.base}/jagentchill/v1/health`, { headers: { origin: "https://example.com" } })).status, 403);
  } finally { host.close(); }
});

test("the command line: serve with a data directory and a port, and devices add-admin", () => {
  assert.deepEqual(parseCommandLine([]), { name: "serve", localSupervisor: false });
  assert.deepEqual(parseCommandLine(["serve", "--data-dir", "/tmp/x", "--port", "18912"]), { name: "serve", localSupervisor: false, dataDir: "/tmp/x", port: 18912 });
  assert.deepEqual(parseCommandLine(["devices", "add-admin", "--public-key", "k", "--local-supervisor"]), { name: "devices add-admin", localSupervisor: true, publicKey: "k" });
  for (const args of [["serve", "--port", "0"], ["serve", "--port"], ["serve", "--nope"], ["devices", "add-admin"], ["launch"]]) assert.throws(() => parseCommandLine(args));
});

test("Rotation keeps the role: the new key gets the role, the name and the supervisor flag; the old key and its token are refused afterwards; a second rotation inside 24 hours is rate limited", async () => {
  const { generateKeyPairSync, sign, createHash } = await import("node:crypto");
  let restarted = 0;
  const host = await start({ restartService: async () => { restarted++; } });
  try {
    const desktop = new DeviceSim(host.base, "desktop");
    bootstrapFirstDevice({ devices: host.app.devices, dataDir: host.dataDir, publicKey: desktop.devicePublicKey });
    desktop.token = readToken(join(host.dataDir, "bootstrap", `${desktop.deviceId}.json`)).value;
    const oldToken = desktop.token;
    const session = desktop.connect(host.identity);
    host.sockets.push(session.ws);
    await session.outcome;

    const fresh = generateKeyPairSync("ed25519");
    const der = fresh.publicKey.export({ type: "spki", format: "der" }), raw = der.subarray(der.length - 32);
    const newDevicePublicKey = raw.toString("base64url"), newDeviceId = createHash("sha256").update(raw).digest("hex");
    const proofFor = (publicKey: string, ts = Date.now(), signer = fresh.privateKey) => {
      const statement = ["JAGENTCHILL-ROTATE-V1", host.app.host.gatewayId, desktop.deviceId, publicKey, String(ts)].join("\n");
      return { newDevicePublicKey: publicKey, ts, signatureByOldKey: desktop.sign(statement), signatureByNewKey: sign(null, Buffer.from(statement), signer).toString("base64url") };
    };
    // A key the caller does not hold, a stale statement and a statement for another host are refused.
    const attacker = generateKeyPairSync("ed25519");
    const attackerDer = attacker.publicKey.export({ type: "spki", format: "der" });
    const stolen = await session.call("jagentchill.device.key.rotate", proofFor(attackerDer.subarray(attackerDer.length - 32).toString("base64url")));
    assert.equal(stolen.ok, false);
    assert.equal((await session.call("jagentchill.device.key.rotate", proofFor(newDevicePublicKey, Date.now() - 600_000))).error.code, "CLOCK_SKEW");
    assert.equal(host.app.devices.list().length, 1);

    const rotated = await session.call("jagentchill.device.key.rotate", proofFor(newDevicePublicKey));
    assert.equal(rotated.ok, true, JSON.stringify(rotated.error));
    assert.equal(rotated.result.deviceId, newDeviceId);
    const record = host.app.devices.get(newDeviceId)!;
    assert.deepEqual([record.role, record.localSupervisor, record.name, record.state], ["admin", true, "This computer", "active"]);
    assert.deepEqual([host.app.devices.get(desktop.deviceId)!.state, host.app.devices.get(desktop.deviceId)!.localSupervisor], ["revoked", false]);
    const audit = host.app.db.prepare("SELECT details FROM audit WHERE action = 'device.key_rotated'").all() as Array<{ details: string }>;
    assert.deepEqual([audit.length, JSON.parse(audit[0].details).newDeviceId], [1, newDeviceId]);
    // The old connection is ended and the old key cannot come back, with the old token or without.
    assert.equal((await session.closed).code, 4403);
    desktop.token = oldToken;
    const again = desktop.connect(host.identity);
    host.sockets.push(again.ws);
    assert.ok((await again.outcome).close, "the old key is refused");

    // The new key connects with its token and is the supervisor: it may restart the Gateway and prepare the shutdown.
    const next = new DeviceSim(host.base, "desktop");
    Object.assign(next, { privateKey: fresh.privateKey, devicePublicKey: newDevicePublicKey, deviceId: newDeviceId, token: rotated.result.deviceToken.value });
    const live = next.connect(host.identity);
    host.sockets.push(live.ws);
    assert.equal((await live.outcome).ready.role, "admin");
    assert.equal((await live.call("jagentchill.diagnostics.service.restart", { service: "gateway" })).ok, true);
    assert.equal(restarted, 1);
    assert.equal((await live.call("jagentchill.diagnostics.service.restart", { service: "server" })).error.code, "INVALID_PARAMS");
    // At most one rotation per device per 24 hours.
    const second = generateKeyPairSync("ed25519");
    const secondDer = second.publicKey.export({ type: "spki", format: "der" }), secondKey = secondDer.subarray(secondDer.length - 32).toString("base64url"), ts = Date.now();
    const statement = ["JAGENTCHILL-ROTATE-V1", host.app.host.gatewayId, newDeviceId, secondKey, String(ts)].join("\n");
    const limited = await live.call("jagentchill.device.key.rotate", { newDevicePublicKey: secondKey, ts, signatureByOldKey: sign(null, Buffer.from(statement), fresh.privateKey).toString("base64url"), signatureByNewKey: sign(null, Buffer.from(statement), second.privateKey).toString("base64url") });
    assert.equal(limited.error.code, "RATE_LIMITED");
  } finally { host.close(); }
});
