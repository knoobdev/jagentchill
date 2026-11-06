import { execFileSync } from "node:child_process";
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import type { DeviceSigner } from "@jagentchill/client";
import { signedHeaders, verifyHostSignature } from "@jagentchill/client";
import { SignRefused, missingStoreMessage, planSigning, rotationStatement, secretStoreAvailable } from "@jagentchill/desktop-core";
import { PROTOCOL_VERSION, decodeOffer, enrolContext, handshakeTranscript, hostRecordSchema, type DesktopHostRecord } from "@jagentchill/protocol";

/** The steps of the enrolment flow the renderer may relay through the bridge; nothing else reaches the host. */
export const ENROLMENT_STEPS = ["challenge", "prove", "verify"] as const;
export type EnrolmentStep = (typeof ENROLMENT_STEPS)[number];
const ENROLMENT_STEP_SET = new Set<string>(ENROLMENT_STEPS);
const MAX_ENROLMENT_BODY_BYTES = 65_536;
const ENROLMENT_TIMEOUT_MS = 15_000;
const HOSTNAME_PATTERN = /^(\[[0-9a-f:]+\]|[a-z0-9]([a-z0-9.-]*[a-z0-9])?)$/i;

/** A refusal the renderer's client SDK can act on: a code and a message, never a stack. */
const enrolmentError = (code: string, message: string) => Object.assign(new Error(message), { code });

/**
 * `originOf(address.url)` (ws→http, wss→https) after the checks the bridge requires: a plain http(s) host, no
 * credentials, a real hostname and a port in range. `null` when the offer address may not be tried.
 */
function addressOrigin(url: string): string | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  const protocol = parsed.protocol === "ws:" ? "http:" : parsed.protocol === "wss:" ? "https:" : parsed.protocol;
  if (protocol !== "http:" && protocol !== "https:") return null;
  if (parsed.username !== "" || parsed.password !== "") return null;
  if (!HOSTNAME_PATTERN.test(parsed.hostname)) return null;
  const port = parsed.port === "" ? (protocol === "https:" ? 443 : 80) : Number(parsed.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
  return `${protocol}//${parsed.host}`;
}

/** What Electron's `safeStorage` offers; injected so that the store's rules are the same code in the app and under test. */
export type SafeStorage = {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend?(): string;
  encryptString(text: string): Buffer;
  decryptString(data: Buffer): string;
  decryptStringAsync?(data: Buffer): Promise<{ result: string; shouldReEncrypt?: boolean }>;
};
export type KeyProtection = "os-store" | "file";
export class KeyStorageUnavailable extends Error {
  readonly code = "KEY_STORAGE_UNAVAILABLE";
  constructor(platform: NodeJS.Platform) {
    super(missingStoreMessage(platform));
  }
}

type KeyFile = { v: 1; protection: KeyProtection; data: string; pending?: string };
type StoreFile = { v: 1; protection: KeyProtection; values: Record<string, string> };

const rawPublic = (key: KeyObject): Buffer => {
  const der = createPublicKey(key).export({ type: "spki", format: "der" });
  return der.subarray(der.length - 32);
};

/**
 * The device's identity on desktop. The private key is generated here, in the main process, and never leaves it: it
 * is written to an owner-only file, and
 * the renderer gets the public key and signatures over structured input. The same store holds the device tokens.
 */
export function createIdentity(deps: {
  directory: string; safeStorage: SafeStorage; platform?: NodeJS.Platform;
  /** The native "Replace this device's key?" dialog; resolves `false` when dismissed or after 60 s. */
  confirmRotation?: () => Promise<boolean>;
  /** The clock, injectable so that expiry rules can be tested. */
  now?: () => number;
  /** How long one relayed enrolment call may take; injectable so the timeout rule can be tested fast. */
  enrolmentTimeout_ms?: number;
  log?: (text: string) => void;
}) {
  const platform = deps.platform ?? process.platform;
  const now = deps.now ?? Date.now;
  const enrolmentTimeout_ms = deps.enrolmentTimeout_ms ?? ENROLMENT_TIMEOUT_MS;
  const keyPath = join(deps.directory, "device.key"), storePath = join(deps.directory, "secure-store.json");
  let privateKey: KeyObject | null = null;
  let protection: KeyProtection | null = null;
  /**
   * The one enrolment in progress. The object itself is its identity: a relayed call belongs to the enrolment it
   * started under and is dropped when that one has ended or been replaced (`calls` are its requests in flight).
   */
  let enrolling: { offerId: string; gatewayId: string; gatewayPublicKey: string; origin: string; proxy?: { port: number; secret: string; target: string }; expires_ms: number; clockOffset_ms: number; calls: Set<AbortController> } | null = null;
  const endEnrolling = (): void => { const ended = enrolling; enrolling = null; if (ended) for (const call of ended.calls) call.abort(); };
  let rotationConfirmedUntil = 0;
  const listeners = new Set<() => void>();

  const storeAvailable = () => secretStoreAvailable({
    available: deps.safeStorage.isEncryptionAvailable(), platform,
    linuxBackend: platform === "linux" ? deps.safeStorage.getSelectedStorageBackend?.() : undefined,
  });
  /** Owner-only: mode 0600 in a 0700 directory; on Windows an access-control list for the current user alone. */
  const writeOwnerOnly = (file: string, text: string) => {
    mkdirSync(deps.directory, { recursive: true, mode: 0o700 });
    const temp = `${file}.tmp`;
    writeFileSync(temp, text, { mode: 0o600 });
    if (platform === "win32") {
      for (const path of [deps.directory, temp]) execFileSync("icacls", [path, "/inheritance:r", "/grant:r", `${userInfo().username}:(F)`], { windowsHide: true, stdio: "ignore" });
    } else {
      chmodSync(deps.directory, 0o700);
      chmodSync(temp, 0o600);
    }
    renameSync(temp, file);
  };
  const wrap = (text: string, how: KeyProtection): string => (how === "os-store" ? deps.safeStorage.encryptString(text).toString("base64") : Buffer.from(text, "utf8").toString("base64"));
  const unwrap = (data: string, how: KeyProtection): string => (how === "os-store" ? deps.safeStorage.decryptString(Buffer.from(data, "base64")) : Buffer.from(data, "base64").toString("utf8"));
  const readJson = <T>(file: string): T | null => { try { return JSON.parse(readFileSync(file, "utf8")) as T; } catch { return null; } };

  function load(): boolean {
    if (privateKey) return true;
    const file = readJson<KeyFile>(keyPath);
    if (!file) return false;
    // safeStorage.decryptString can block on an unsigned macOS build while a Keychain prompt is waiting. Never read
    // a legacy OS-store key on the startup path. Preserve its ciphertext and start with a new owner-only identity;
    // the old pairing is treated as disconnected and can be established again by the user.
    if (file.protection === "os-store") {
      let suffix = "", index = 1;
      while (existsSync(`${keyPath}.keychain-locked${suffix}`) || existsSync(`${storePath}.keychain-locked${suffix}`)) suffix = `-${index++}`;
      const legacyPath = `${keyPath}.keychain-locked${suffix}`;
      renameSync(keyPath, legacyPath);
      if (existsSync(storePath)) renameSync(storePath, `${storePath}.keychain-locked${suffix}`);
      return false;
    }
    const keyText = unwrap(file.data, file.protection);
    privateKey = createPrivateKey(keyText);
    protection = file.protection;
    return true;
  }
  function quarantinedKeyPath(): string | null {
    for (const suffix of ["", ...Array.from({ length: 100 }, (_, index) => `-${index + 1}`)]) {
      const candidate = suffix ? `${keyPath}.keychain-locked${suffix}` : `${keyPath}.keychain-locked`;
      if (existsSync(candidate)) return candidate;
    }
    return null;
  }
  function quarantinedStorePath(): string | null {
    const key = quarantinedKeyPath();
    if (!key) return null;
    const suffix = key.slice(`${keyPath}.keychain-locked`.length);
    const candidate = `${storePath}.keychain-locked${suffix}`;
    return existsSync(candidate) ? candidate : null;
  }
  function create(how: KeyProtection): void {
    const pair = generateKeyPairSync("ed25519");
    writeOwnerOnly(keyPath, JSON.stringify({ v: 1, protection: how, data: wrap(pair.privateKey.export({ type: "pkcs8", format: "pem" }) as string, how) } satisfies KeyFile));
    privateKey = pair.privateKey;
    protection = how;
    deps.log?.(`device key created (${how})`);
  }
  /** The key is created on first use in the owner-only identity directory; startup never calls into the OS store. */
  function ensureKey(): KeyObject {
    if (load()) return privateKey!;
    create("file");
    return privateKey!;
  }

  const values = (): StoreFile => {
    const stored = readJson<StoreFile>(storePath);
    if (stored && protection && stored.protection !== protection) return { v: 1, protection, values: {} };
    return stored ?? { v: 1, protection: protection ?? "file", values: {} };
  };
  const saveValues = (file: StoreFile) => { writeOwnerOnly(storePath, JSON.stringify(file)); for (const listener of listeners) listener(); };
  const store = {
    get(key: string): string | null {
      const file = values(), data = file.values[key];
      if (data === undefined) return null;
      if (file.protection === "os-store" && protection !== "os-store") return null;
      return unwrap(data, file.protection);
    },
    set(key: string, value: string): void {
      ensureKey();
      const file = values();
      if (key.startsWith("host/")) {
        // A host record is what the signer trusts as "a host of this device": it is checked before it is kept.
        const record = hostRecordSchema.parse(JSON.parse(value));
        if (key !== `host/${record.gatewayId}`) throw new Error("host record key does not name its host");
      }
      saveValues({ v: 1, protection: protection!, values: { ...file.values, [key]: wrap(value, protection!) } });
    },
    delete(key: string): void {
      const file = values();
      if (!(key in file.values)) return;
      const { [key]: _removed, ...rest } = file.values;
      saveValues({ ...file, values: rest });
    },
    keys: (prefix: string): string[] => Object.keys(values().values).filter((key) => key.startsWith(prefix)).sort(),
  };
  const hosts = (): DesktopHostRecord[] => store.keys("host/").flatMap((key) => {
    try { return [hostRecordSchema.parse(JSON.parse(store.get(key) ?? ""))]; } catch { return []; }
  });
  const publicInfo = () => {
    const raw = rawPublic(ensureKey());
    return { deviceId: createHash("sha256").update(raw).digest("hex"), devicePublicKey: raw.toString("base64url"), keyProtection: protection! };
  };
  const signText = (key: KeyObject, text: string): string => sign(null, Buffer.from(text, "utf8"), key).toString("base64url");

  /** Signs structured input, or refuses with `SIGN_REFUSED`. There is no way to make this sign a caller's string. */
  async function signStructured(input: unknown): Promise<{ signature: string } | { newDevicePublicKey: string; ts: number; signatureByOldKey: string; signatureByNewKey: string }> {
    const key = ensureKey(), info = publicInfo();
    const known = hosts();
    const plan = planSigning(input, {
      deviceId: info.deviceId, devicePublicKey: info.devicePublicKey,
      isKnownGateway: (gatewayId) => known.some((host) => host.gatewayId === gatewayId),
      enrollingGatewayId: () => (enrolling && now() < enrolling.expires_ms ? enrolling.gatewayId : null),
    });
    if (plan.kind !== "rotate") return { signature: signText(key, plan.text) };
    // A person answers the main process's own dialog; no script can.
    // One confirmation covers one rotation: the same pending key is then signed for every host in turn.
    if (Date.now() > rotationConfirmedUntil) {
      if (!(await (deps.confirmRotation?.() ?? Promise.resolve(false)))) throw new SignRefused("The key replacement was not confirmed.");
      rotationConfirmedUntil = Date.now() + 300_000;
    }
    const file = readJson<KeyFile>(keyPath)!;
    // One pending key per rotation, reused for every host.
    let pending = file.pending ? createPrivateKey(unwrap(file.pending, file.protection)) : null;
    if (!pending) {
      pending = generateKeyPairSync("ed25519").privateKey;
      writeOwnerOnly(keyPath, JSON.stringify({ ...file, pending: wrap(pending.export({ type: "pkcs8", format: "pem" }) as string, file.protection) } satisfies KeyFile));
    }
    const host = known.find((entry) => entry.gatewayId === plan.gatewayId)!;
    const ts = Math.round(Date.now() + host.verifiedClockOffset_ms), newDevicePublicKey = rawPublic(pending).toString("base64url");
    const statement = rotationStatement({ gatewayId: plan.gatewayId, oldDeviceId: info.deviceId, newDevicePublicKey, ts });
    return { newDevicePublicKey, ts, signatureByOldKey: signText(key, statement), signatureByNewKey: signText(pending, statement) };
  }

  /** The signer `packages/client` uses inside the main process (the supervisor's own connection, and the relay below). */
  const signer = (): DeviceSigner => {
    const info = publicInfo();
    const one = async (input: unknown) => ((await signStructured(input)) as { signature: string }).signature;
    return {
      deviceId: info.deviceId, devicePublicKey: info.devicePublicKey,
      signHandshake: (fields) => one({ kind: "handshake", fields }),
      signRequest: (fields) => one({ kind: "request", fields }),
    };
  };

  return {
    keyPath,
    /** `null` until a key exists. */
    get keyProtection(): KeyProtection | null { return protection ?? readJson<KeyFile>(keyPath)?.protection ?? null; },
    hasKey: (): boolean => existsSync(keyPath),
    storeAvailable,
    ensureKey: (): void => { ensureKey(); },
    /**
     * Attempts one explicit, background recovery of the prior OS-store identity. Callers must run this only after
     * the window and host have started: safeStorage is synchronous and may wait for the operating system.
     * The encrypted source is retained even after success so a failed file write never destroys the only old copy.
     */
    async tryMigrateLegacy(): Promise<boolean> {
      const legacyPath = quarantinedKeyPath();
      if (!legacyPath) return false;
      const legacy = readJson<KeyFile>(legacyPath);
      if (!legacy || legacy.protection !== "os-store") return false;
      const decrypt = async (data: string): Promise<string> => deps.safeStorage.decryptStringAsync
        ? (await deps.safeStorage.decryptStringAsync(Buffer.from(data, "base64"))).result
        : deps.safeStorage.decryptString(Buffer.from(data, "base64"));
      const keyText = await decrypt(legacy.data);
      const restoredKey = createPrivateKey(keyText);
      const oldStore = readJson<StoreFile>(quarantinedStorePath() ?? "");
      const restoredValues: Record<string, string> = {};
      if (oldStore?.protection === "os-store") {
        for (const [name, data] of Object.entries(oldStore.values)) restoredValues[name] = Buffer.from(await decrypt(data), "utf8").toString("base64");
      }
      const currentStore = readJson<StoreFile>(storePath);
      if (currentStore?.protection === "file") Object.assign(restoredValues, currentStore.values);
      writeOwnerOnly(keyPath, JSON.stringify({ v: 1, protection: "file", data: Buffer.from(keyText, "utf8").toString("base64") } satisfies KeyFile));
      privateKey = restoredKey;
      protection = "file";
      if (oldStore?.protection === "os-store" || currentStore?.protection === "file") writeOwnerOnly(storePath, JSON.stringify({ v: 1, protection: "file", values: restoredValues } satisfies StoreFile));
      for (const listener of listeners) listener();
      deps.log?.("legacy device identity migrated to owner-only files");
      return true;
    },
    hasQuarantinedLegacy: (): boolean => quarantinedKeyPath() !== null,
    publicInfo,
    /** Retained for older UI callers; a new identity already uses the owner-only file fallback. */
    createInFile(confirmed: boolean): void {
      if (!confirmed) throw new Error("the protected-file store needs the user's confirmation");
      if (!load()) create("file");
    },
    /** "Move the key to the system store": the same key and the same pairings, re-wrapped; the plain file content is replaced only after the wrapped copy decrypts. */
    moveToStore(): void {
      const key = ensureKey();
      if (protection !== "file") return;
      if (!storeAvailable()) throw new KeyStorageUnavailable(platform);
      const pem = key.export({ type: "pkcs8", format: "pem" }) as string, wrapped = wrap(pem, "os-store");
      if (unwrap(wrapped, "os-store") !== pem) throw new Error("the system store did not return the key it was given");
      const plain = values();
      const moved: Record<string, string> = {};
      for (const [name, data] of Object.entries(plain.values)) moved[name] = wrap(unwrap(data, plain.protection), "os-store");
      writeOwnerOnly(keyPath, JSON.stringify({ v: 1, protection: "os-store", data: wrapped } satisfies KeyFile));
      protection = "os-store";
      saveValues({ v: 1, protection: "os-store", values: moved });
    },
    sign: signStructured,
    /** Every host has accepted the new key: it becomes this device's key and the old one is gone. */
    promotePending(): { deviceId: string; devicePublicKey: string } {
      const file = readJson<KeyFile>(keyPath);
      if (!file?.pending) throw new Error("no key replacement is in progress");
      writeOwnerOnly(keyPath, JSON.stringify({ v: 1, protection: file.protection, data: file.pending } satisfies KeyFile));
      privateKey = createPrivateKey(unwrap(file.pending, file.protection));
      rotationConfirmedUntil = 0;
      deps.log?.("device key replaced");
      const info = publicInfo();
      return { deviceId: info.deviceId, devicePublicKey: info.devicePublicKey };
    },
    /** The rotation was abandoned before any host accepted it: the pending key is discarded. */
    discardPending(): void {
      const file = readJson<KeyFile>(keyPath);
      rotationConfirmedUntil = 0;
      if (file?.pending) writeOwnerOnly(keyPath, JSON.stringify({ v: 1, protection: file.protection, data: file.data } satisfies KeyFile));
    },
    /** The signer `packages/client` uses inside the main process (the supervisor's own connection). */
    signer,
    /**
     * The renderer is pairing with `origin`, one of the offer's addresses: enrolment transcripts for that host may be
     * signed for ten minutes, and only the relay below may talk to it.
     */
    beginEnrolment(offerText: string, origin: string, proxy?: { port: number; secret: string }): { gatewayId: string } {
      const decoded = decodeOffer(offerText);
      if (!decoded.ok) throw Object.assign(new Error("The pairing offer is not valid."), { code: decoded.code });
      const allowed = decoded.offer.addresses.map((address) => addressOrigin(address.url)).filter((value): value is string => value !== null);
      if (!allowed.includes(origin)) throw enrolmentError("ENROLMENT_ORIGIN_REFUSED", "That address is not one of the offer's addresses.");
      let proxyRoute: { port: number; secret: string; target: string } | undefined;
      if (proxy) {
        const address = decoded.offer.addresses.find((item) => addressOrigin(item.url) === origin && item.kind === "tailnet");
        let parsed: URL | undefined;
        try { parsed = address ? new URL(address.url) : undefined; } catch { parsed = undefined; }
        if (!parsed || !Number.isInteger(proxy.port) || proxy.port < 1 || proxy.port > 65_535 || !/^[A-Za-z0-9_-]{40,}$/.test(proxy.secret)) {
          throw enrolmentError("ENROLMENT_PROXY_REFUSED", "That tailnet proxy is not valid for this offer.");
        }
        proxyRoute = { port: proxy.port, secret: proxy.secret, target: parsed.host };
      }
      // A new enrolment replaces the one before it: what that one still has in flight is dropped.
      endEnrolling();
      enrolling = { offerId: decoded.offer.offerId, gatewayId: decoded.offer.gatewayId, gatewayPublicKey: decoded.offer.gatewayPublicKey, origin, ...(proxyRoute ? { proxy: proxyRoute } : {}), expires_ms: Math.min(decoded.offer.expires_ms, now() + 600_000), clockOffset_ms: 0, calls: new Set() };
      return { gatewayId: decoded.offer.gatewayId };
    },
    endEnrolment(): void { endEnrolling(); },
    /**
     * Relays one enrolment HTTP call to the host of the active offer. Only the three steps of the flow are allowed, the
     * origin comes from the offer (never from the renderer), and the request is bounded in time and size. The `verify`
     * step is signed here, with the enrolling key, because the renderer cannot carry signature headers across the bridge.
     */
    async enrolmentPost(step: string, json: string): Promise<{ status: number; body: unknown }> {
      const active = enrolling;
      const inactive = () => enrolmentError("ENROLMENT_INACTIVE", "No pairing is in progress.");
      // Whether this call still belongs to the enrolment in progress: asked again after every wait, because the
      // enrolment can end, expire or be replaced by one with another host while this call signs or waits for an answer.
      const mine = (): boolean => enrolling === active && active !== null && now() < active.expires_ms;
      if (!active || !mine()) { if (enrolling === active) endEnrolling(); throw inactive(); }
      if (!ENROLMENT_STEP_SET.has(step)) throw enrolmentError("ENROLMENT_STEP_REFUSED", "That enrolment step is not allowed.");
      const target = `/jagentchill/v1/pair/${step}`;
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (active.proxy) headers["X-JAgentChill-Tailnet-Proxy"] = active.proxy.secret;
      if (step === "verify") Object.assign(headers, await signedHeaders(signer(), active.gatewayId, "POST", target, json, active.clockOffset_ms));
      // Signing took time: nothing is sent for an enrolment that is over, least of all to the host of the one before.
      if (!mine()) throw inactive();
      const controller = new AbortController();
      active.calls.add(controller);
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, enrolmentTimeout_ms);
      const sentAt = now();
      try {
        const url = active.proxy
          ? `http://127.0.0.1:${active.proxy.port}/_jagentchill/tailnet/${encodeURIComponent(active.proxy.target)}${target}`
          : `${active.origin}${target}`;
        const response = await fetch(url, { method: "POST", headers, body: json, redirect: "error", credentials: "omit", signal: controller.signal });
        // Read incrementally and stop the reader the moment the answer passes the cap: a host cannot make this process
        // buffer an unbounded body (an `arrayBuffer()` first would).
        const reader = response.body?.getReader() ?? null;
        const decoder = new TextDecoder();
        let text = "", total = 0;
        if (reader) {
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              total += value.byteLength;
              if (total > MAX_ENROLMENT_BODY_BYTES) {
                await reader.cancel();
                throw enrolmentError("ENROLMENT_BODY_TOO_LARGE", "The host's answer is too large.");
              }
              text += decoder.decode(value, { stream: true });
            }
          } finally { reader.releaseLock(); }
          text += decoder.decode();
        }
        let body: unknown = null;
        try { body = text === "" ? null : JSON.parse(text); } catch { body = null; }
        const receivedAt = now();
        // The answer of an enrolment that ended meanwhile goes nowhere.
        if (!mine()) throw inactive();
        // The challenge carries the host's clock, and the later verify signature must be timely by it. The clock is
        // taken only from an answer the host of the offer signed: its fresh transcript over both nonces, this
        // device's key and that very `ts`, checked with the public key the offer carries. An unsigned or forged
        // answer changes nothing.
        if (step === "challenge" && response.status >= 200 && response.status < 300) {
          const asked = (() => { try { return JSON.parse(json) as { deviceNonce?: unknown }; } catch { return {}; } })();
          const answer = (body ?? {}) as { ts?: unknown; gatewayNonce?: unknown; gatewayId?: unknown; gatewaySignature?: unknown };
          if (typeof answer.ts === "number" && typeof answer.gatewayNonce === "string" && typeof answer.gatewaySignature === "string" && typeof asked.deviceNonce === "string" && answer.gatewayId === active.gatewayId) {
            const info = publicInfo();
            const transcript = handshakeTranscript({
              role: "gateway", context: enrolContext(active.offerId), gatewayNonce: answer.gatewayNonce, deviceNonce: asked.deviceNonce, ts: answer.ts,
              gatewayId: active.gatewayId, protocolVersion: PROTOCOL_VERSION, deviceId: info.deviceId, devicePublicKey: info.devicePublicKey,
            });
            const signed = await verifyHostSignature(active.gatewayPublicKey, transcript, answer.gatewaySignature).catch(() => false);
            if (signed && mine()) active.clockOffset_ms = answer.ts - Math.round((sentAt + receivedAt) / 2);
          }
        }
        return { status: response.status, body };
      } catch (error) {
        // An enrolment that ended or was replaced dropped this call (its request was aborted): that is the answer,
        // whatever the transport reports.
        if (!mine()) throw inactive();
        // The timeout is checked first: an aborted fetch throws an `AbortError` whose numeric `code` (20) is truthy, so
        // an "rethrow anything with a code" rule would leak it and bypass ENROLMENT_TIMEOUT. Only the relay's own
        // refusals (the body limit) keep their code; every other fetch failure means the address did not answer.
        if (timedOut) throw enrolmentError("ENROLMENT_TIMEOUT", "The host did not answer in time.");
        if ((error as { code?: unknown }).code === "ENROLMENT_BODY_TOO_LARGE") throw error;
        throw enrolmentError("ENROLMENT_REQUEST_FAILED", "The host could not be reached.");
      } finally { clearTimeout(timer); active.calls.delete(controller); }
    },
    store, hosts,
    saveHost: (record: DesktopHostRecord): void => store.set(`host/${record.gatewayId}`, JSON.stringify(record)),
    onChange(listener: () => void): () => void { listeners.add(listener); return () => void listeners.delete(listener); },
    /** Personal ▸ Privacy ▸ "Erase device data…" */
    erase(): void { rmSync(keyPath, { force: true }); rmSync(storePath, { force: true }); privateKey = null; protection = null; },
  };
}
export type Identity = ReturnType<typeof createIdentity>;
