import assert from "node:assert/strict";
import { test } from "node:test";
import { KEY_FILE_CONFIRMATION, KEY_STORAGE_CHOICES, SIGN_REFUSED, SignRefused, missingStoreMessage, planSigning, rotationStatement, secretStoreAvailable, type SignerContext } from "../src/index.ts";

const b64 = (bytes: number) => Buffer.alloc(bytes, 7).toString("base64url");
const KNOWN = "a".repeat(32), OFFERED = "b".repeat(32), OTHER = "c".repeat(32);
const context: SignerContext = { deviceId: "d".repeat(64), devicePublicKey: b64(32), isKnownGateway: (id) => id === KNOWN, enrollingGatewayId: () => OFFERED };
const handshake = (over: Record<string, unknown> = {}) => ({ kind: "handshake", fields: { context: "connect", gatewayNonce: b64(32), deviceNonce: b64(32), ts: 1_700_000_000_000, gatewayId: KNOWN, protocolVersion: 1, ...over } });
const request = (over: Record<string, unknown> = {}) => ({ kind: "request", fields: { gatewayId: KNOWN, method: "GET", target: "/jagentchill/v1/secrets", bodySha256: "0".repeat(64), ts: 1, nonce: b64(16), ...over } });
const refused = (input: unknown) => assert.throws(() => planSigning(input, context), (error: unknown) => error instanceof SignRefused && error.code === SIGN_REFUSED);

test("Arbitrary string refused: the signer answers SIGN_REFUSED for a string, bytes, an unknown kind and a caller-supplied canonical text", () => {
  for (const input of ["hello", Buffer.from("hello"), new Uint8Array(4), null, undefined, 7, {}, { kind: "raw", fields: { text: "hello" } }, { kind: "handshake" }, { kind: "handshake", fields: "JAGENTCHILL-HANDSHAKE-V1\ndevice" }, { ...handshake(), text: "hello" }]) refused(input);
});

test("Signing without key exposure: a handshake input yields the ten-line transcript built from typed fields, with the device's own role, id and key", () => {
  const plan = planSigning(handshake(), context);
  assert.equal(plan.kind, "handshake");
  assert.deepEqual((plan as { text: string }).text.split("\n"), ["JAGENTCHILL-HANDSHAKE-V1", "device", "connect", b64(32), b64(32), "1700000000000", KNOWN, context.deviceId, context.devicePublicKey, "1"]);
  // The caller cannot place its own id or key in the transcript.
  refused(handshake({ deviceId: "e".repeat(64) }));
  refused(handshake({ devicePublicKey: b64(32) }));
});

test("Gateway-role transcript refused", () => {
  refused(handshake({ role: "gateway" }));
  assert.equal(planSigning(handshake({ role: "device" }), context).kind, "handshake");
});

test("Request for an unknown Gateway: a request signature naming a host outside the registry is refused", () => {
  refused(request({ gatewayId: OTHER }));
  assert.deepEqual((planSigning(request(), context) as { text: string }).text.split("\n"), ["JAGENTCHILL-REQUEST-V1", KNOWN, "GET", "/jagentchill/v1/secrets", "0".repeat(64), "1", b64(16)]);
});

test("a handshake is signed for a paired host or for the offer being enrolled, and for nothing else", () => {
  refused(handshake({ gatewayId: OTHER }));
  // A connection transcript for a host that is only being enrolled, and an enrolment transcript for another host.
  refused(handshake({ gatewayId: OFFERED }));
  refused(handshake({ gatewayId: KNOWN, context: `enrol:${b64(16)}` }));
  assert.equal(planSigning(handshake({ gatewayId: OFFERED, context: `enrol:${b64(16)}` }), context).kind, "handshake");
  // During enrolment the only routes signed for the offer's host are the last steps of pairing.
  assert.equal(planSigning(request({ gatewayId: OFFERED, method: "POST", target: "/jagentchill/v1/pair/verify" }), context).kind, "request");
  refused(request({ gatewayId: OFFERED, target: "/jagentchill/v1/secrets" }));
  // With no enrolment in progress the same transcript is refused.
  assert.throws(() => planSigning(handshake({ gatewayId: OFFERED, context: `enrol:${b64(16)}` }), { ...context, enrollingGatewayId: () => null }), SignRefused);
});

test("fields that could break the canonical lines are refused", () => {
  for (const over of [{ target: "/a\nb" }, { target: "relative" }, { target: "/a b" }, { method: "GET\n" }, { bodySha256: "xyz" }, { nonce: "short" }, { ts: -1 }, { ts: 1.5 }, { gatewayId: "nope" }]) refused(request(over));
  for (const over of [{ context: "connect\nx" }, { context: "enrol:short" }, { gatewayNonce: "x" }, { protocolVersion: 0 }]) refused(handshake(over));
});

test("Rotation to a caller-chosen key refused: rotate takes the host only", () => {
  refused({ kind: "rotate", fields: { gatewayId: KNOWN, newDevicePublicKey: b64(32) } });
  refused({ kind: "rotate", fields: { gatewayId: OTHER } });
  assert.deepEqual(planSigning({ kind: "rotate", fields: { gatewayId: KNOWN } }, context), { kind: "rotate", gatewayId: KNOWN });
  assert.equal(rotationStatement({ gatewayId: KNOWN, oldDeviceId: "d".repeat(64), newDevicePublicKey: "k", ts: 5 }), `JAGENTCHILL-ROTATE-V1\n${KNOWN}\n${"d".repeat(64)}\nk\n5`);
});

test("No keyring on Linux: the basic_text and unknown backends count as no secret store; macOS and Windows follow safeStorage", () => {
  assert.equal(secretStoreAvailable({ available: true, platform: "linux", linuxBackend: "basic_text" }), false);
  assert.equal(secretStoreAvailable({ available: true, platform: "linux", linuxBackend: "unknown" }), false);
  assert.equal(secretStoreAvailable({ available: true, platform: "linux", linuxBackend: "gnome_libsecret" }), true);
  assert.equal(secretStoreAvailable({ available: true, platform: "linux", linuxBackend: "kwallet6" }), true);
  assert.equal(secretStoreAvailable({ available: false, platform: "linux", linuxBackend: "gnome_libsecret" }), false);
  assert.equal(secretStoreAvailable({ available: true, platform: "darwin" }), true);
  assert.equal(secretStoreAvailable({ available: false, platform: "win32" }), false);
  assert.equal(missingStoreMessage("linux"), "No keyring is running on this computer (GNOME Keyring or KWallet)");
  assert.equal(missingStoreMessage("win32"), "Windows data protection is not available for this account");
  assert.equal(missingStoreMessage("darwin"), "The login keychain is not available");
  assert.deepEqual([...KEY_STORAGE_CHOICES], ["Try again", "Store the key in a protected file", "Cancel"]);
  assert.equal(KEY_FILE_CONFIRMATION, "The key will be protected only by this account's file permissions");
});
