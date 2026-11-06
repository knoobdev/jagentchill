# JAgentDesk reference (for mirroring in JAgentChill)

Source: `/Users/ngocchanh/Project/private/organisations/hdc/jagentdesk` at root version `0.9.46` (`package.json`), read on 2026-10-05.
All paths below are relative to that repo unless absolute. Quotes are verbatim, trimmed with `...`.

Evidence labels used in this document:

- No label — I opened the file and read the code or config quoted. This is the default; section 2 is entirely at this level.
- **(doc)** — taken from a `docs/` or `public-docs/` page; the implementing code was not opened.
- **(listing)** — I saw the file or directory name in a listing but did not open it; the one-line purpose is inferred from the name.
- **UNVERIFIED** — a claim I could not confirm. Each occurrence is tagged inline and collected in section 9.

Two background research agents were started for sections 3–7, but their reports never reached this document. Sections 1 and 3–8 were instead written from a direct, narrower read of the code, so they are less deep than section 2: more items carry the (doc) and (listing) labels.

> **Read this first — the docs disagree with the code about the connection model.**
> `public-docs/security.md` and `CLAUDE.md` still describe an E2E-encrypted **relay** (`packages/relay`, NaCl `box`, XSalsa20-Poly1305). That package does not exist in `packages/`. The implemented model is **Tailscale (embedded tsnet) transport + Ed25519 challenge-signed hello + six-digit pairing code**, as stated in `SECURITY.md`, `docs/architecture.md` ("Remote access no longer uses a relay ... the relay's E2EE box layer was removed"), and the code under `packages/server/src/server/pairing/`. Mirror the code, not `public-docs/security.md`.

---

## 1. Monorepo layout, tech stack, versions

### 1.1 Layout

npm workspaces (root `package.json`, `"workspaces"` in build order), all packages at version `0.9.46`, license `AGPL-3.0-or-later`:

| Package | Name | Role |
| --- | --- | --- |
| `packages/protocol` | `@jagentdesk/protocol` | Zod wire schemas, binary frame codecs, shared types. Depends on nothing internal. |
| `packages/client` | `@jagentdesk/client` | Daemon WebSocket client (`daemon-client.ts`, 10,219 lines) + SDK facade. |
| `packages/server` | `@jagentdesk/server` | The daemon: WS API, agent manager, providers, pairing, MCP, schedules, speech, plugins. Includes Go `go/tsnet-bridge`. |
| `packages/app` | `@jagentdesk/app` | Expo app: iOS, Android, web, and the renderer loaded by Electron. Includes native module `modules/jagentdesk-tailscale`. |
| `packages/desktop` | `@jagentdesk/desktop` | Electron main/preload; spawns and supervises the daemon. |
| `packages/cli` | `@jagentdesk/cli` | Commander CLI, bin `jagentdesk`. |
| `packages/plugin` | `@jagentdesk/plugin` | Plugin SDK (client + server entries). |
| `packages/highlight` | `@jagentdesk/highlight` | Syntax highlighting (Lezer). |
| `packages/expo-two-way-audio` | `@jagentdesk/expo-two-way-audio` | Native audio module for realtime voice. |
| `packages/website` | `@jagentdesk/website` | Marketing/docs site (Vite + TanStack Router + Cloudflare Workers). |

Other top-level: `docs/` (45 internal docs), `public-docs/`, `openspec/` (`config.yaml`, one change `port-jagentdesk`), `orc/k8s/` (see 4.1), `skills/` (5 bundled Agent Skills), `plugin-examples/` (14), `patches/` (patch-package), `scripts/`, `docker/`, `nix/`, `fastlane/metadata`, `.github/workflows/release.yml`.

`CLAUDE.md` lists `packages/relay` — it does not exist (see 7.4).

### 1.2 Versions (from each `package.json`)

| Area | Library @ version |
| --- | --- |
| Runtime | Node `22.20.0`, Java 21, Rust 1.85.1 (`.tool-versions`); Go required to build the tsnet bridge |
| Language | TypeScript `^5.9.3`; typecheck via `tsgo` (`@typescript/native-preview 7.0.0-dev.20260423.1`) |
| Mobile/web UI | `expo ^54.0.18`, `react-native 0.81.5`, `react 19.1.0`, `react-dom 19.1.0`, `react-native-web ~0.21.0`, `expo-router ~6.0.13`, New Architecture on (`newArchEnabled: true`) |
| Styling | `react-native-unistyles ^3.2.4` |
| Motion/gesture | `react-native-reanimated ~4.3.1` (root override `4.3.1`), `react-native-worklets 0.8.3`, `react-native-gesture-handler ~2.28.0`, `react-native-keyboard-controller ^1.19.2`, `@gorhom/bottom-sheet ^5.2.14` |
| State | `zustand ^5.0.9`, `@tanstack/react-query ^5.90.11`, `@react-native-async-storage/async-storage 2.2.0` |
| i18n | `i18next ^26.3.0`, `react-i18next ^17.0.8` |
| Icons | `lucide-react-native ^0.546.0` |
| Terminal / editor | `@xterm/xterm ^6.1.0-beta.213`, `@codemirror/view 6.43.6`, `node-pty 1.2.0-beta.11` |
| Desktop | `electron 41.2.0`, `electron-builder 26.8.1` |
| Daemon | `ws ^8.14.2`, `express ^4.18.2`, `pino ^10.2.0`, `bcryptjs ^3.0.3`, `qrcode ^1.5.4`, `zod ^4.4.3` |
| Agents | `@anthropic-ai/claude-agent-sdk ^0.3.220`, `@agentclientprotocol/sdk ^0.17.1` (server; plugin SDK uses `^1.4.0`), `@modelcontextprotocol/sdk ^1.20.1`, `openai ^6.44.0` |
| Speech | `sherpa-onnx-node 1.12.28` (local STT/TTS/VAD), OpenAI STT/TTS |
| Protocol | `zod ^4.4.3`, `zod-aot 0.20.4`, `semver` |
| CLI | `commander ^12.0.0`, `@clack/prompts`, `chalk` |
| Test | `vitest ^4.1.6`, `playwright ^1.56.1` / `@playwright/test`, Maestro flows in `packages/app/maestro` |
| Lint/format | `oxlint 1.61.0` (+ `oxlint-tsgolint`), `oxfmt 0.46.0` (100 cols, double quotes, trailing commas — `.oxfmtrc.json`), `knip ^5.82.1`, `lefthook ^2.1.6` (pre-commit: format check, lint, typecheck) |
| Website | `vite ^7.3.3`, `@tanstack/react-router ^1.170.16`, `wrangler` |

No Sentry/PostHog/analytics dependency in any `package.json`; `CONTRIBUTING.md`: "Do not add hosted relay, public release, telemetry, or project-community dependencies."

### 1.3 Build and release

- **Web**: `expo export --platform web` -> `packages/app/dist`. `scripts/build-daemon-web-ui.mjs` copies it (gzip + brotli precompressed) to `packages/server/dist/server/web-ui`, served by the daemon when started with `--web-ui` (`features.webUi` in config). `deploy:web` also targets Cloudflare Pages.
- **Desktop**: root `build:desktop` = build deps -> `JAGENTDESK_WEB_PLATFORM=electron expo export --platform web` -> `tsc` main -> `electron-builder --config electron-builder.yml`. `electron-builder.yml`: `appId: sh.jagentdesk.desktop`, protocol scheme `jagentdesk`; mac `dmg` + `zip`, `hardenedRuntime: true`, `notarize: true`; linux `AppImage`, `deb`, `rpm`, `tar.gz`; win `nsis` + `zip` for x64 and arm64; `publish: { provider: github, owner: knoobdev, repo: jagentdesk }`. `extraResources` ships the Expo export (`app-dist`), the `tailnet-bridge` binary, the CLI shim, and `skills/`. Native add-ons are `asarUnpack`ed.
- **Desktop auto-update**: `electron-updater` is not a dependency and I found no `autoUpdater` usage in `packages/desktop/src`; the only "auto-update" there is for installed skills (`integrations/skills`). App self-update is therefore **UNVERIFIED / apparently absent** despite `publish: github`.
- **Mobile**: `packages/app/eas.json` profiles `development`, `development-simulator`, `production`, `production-apk`, `production-ipa`, `production-simulator` driven by `APP_VARIANT`; `app.config.js` slug `jagentdesk-mobile`, scheme `jagentdesk`, variant-specific name/package id. Local builds via `expo prebuild` + `expo run:*`. No `expo-updates` dependency (no OTA). F-Droid support: `plugins/with-fdroid-autolinking.js`, `src/fdroid`, `scripts/sync-fdroid-changelogs.mjs`.
- **CI**: single workflow `.github/workflows/release.yml` on tag push / manual: jobs `validate`, `create-release`, `desktop` (matrix), `mobile-android` (APK), `mobile-ios-ipa` (unsigned, macos-15).
- **Other**: `docker/` (base image + compose example), `nix/` (package + module), `flake.nix`.

---

## 2. The cross-device connection (most important)

### 2.1 Topology

There is no peer-to-peer link between the phone and the desktop UI. Everything is **client -> daemon**:

```
 Mobile app (Expo)            Desktop app (Electron renderer)        CLI
   |  embedded tsnet node        |  unix socket / named pipe           |  ws://127.0.0.1:6767/ws or IPC socket
   |  (Go bridge, loopback       |  to its managed daemon              |
   |   proxy 127.0.0.1:<rand>)   |  (+ tailnet proxy 127.0.0.1:55750   |
   |                             |   to reach OTHER daemons)           |
   +---------- WireGuard (tailnet) ---------+                          |
                                            v                          v
                              Daemon (Node.js)  ws path /ws  — one WebSocket server, two ingress paths:
                                - direct  : HTTP server on 127.0.0.1:6767 (or unix socket / pipe)
                                - tailnet : Go `tsnet-bridge` child -> raw TCP -> loopback ingress -> same WS server
```

- Daemon = the single authority. `packages/server/src/server/websocket-server.ts` owns the WS server (`path: "/ws"`), sessions, and the pairing gate.
- Tailnet ingress: `packages/server/src/server/tsnet-listener.ts` spawns `packages/server/go/tsnet-bridge` (Go, `tsnet.Server`), which joins the tailnet, listens on the daemon port, and forwards raw TCP to a loopback ingress. Sockets arrive tagged `transport: "tailnet"`. The address is advertised only after the bridge prints `TSNET_READY <dnsName>`.
- Mobile: native Expo module `packages/app/modules/jagentdesk-tailscale` (Swift + Kotlin wrappers over one Go bridge built with `gomobile bind`). Its README: "The JavaScript client connects to the bridge's loopback proxy while the bridge dials the daemon through the tailnet." (`bridge.go`: `net.Listen("tcp", "127.0.0.1:0")` then `b.server.Dial(ctx, "tcp", target)`.)
- Plain browser web cannot own a tailnet node: `WebTailscaleLoginAdapter` returns `{ kind: "connected" }` and assumes OS-level Tailscale (`packages/app/src/tailscale/adapter.ts`).
- **Relay: none.** Transport confidentiality on the remote path comes from WireGuard only. On the direct path there is **no application-layer encryption** (plain `ws://`, optional `wss://` via `useTls`).

### 2.2 Transport and envelope

WebSocket, JSON text frames plus binary frames for terminal and file transfer. Top-level envelope (`packages/protocol/src/messages.ts:8825-8836`):

```ts
export const WSInboundMessageSchema = z.discriminatedUnion("type", [
  WSPingMessageSchema,
  WSHelloMessageSchema,
  WSRecordingStateMessageSchema,
  WSSessionInboundSchema,
]);

export const WSOutboundMessageSchema = z.discriminatedUnion("type", [
  WSPongMessageSchema,
  WSChallengeMessageSchema,
  WSSessionOutboundSchema,
]);
```

`session` wraps the rich RPC/event unions: `{ type: "session", message: SessionInboundMessage | SessionOutboundMessage }` (`SessionInboundMessageSchema` at `messages.ts:3999`, `SessionOutboundMessageSchema` at `messages.ts:7776`; `messages.ts` is 8,897 lines).

**There is no per-message signature, MAC, sequence number, or nonce in the envelope.** Authentication is per-connection (at hello); integrity/confidentiality of subsequent frames is delegated to the transport (WireGuard, TLS, or loopback). `packages/server/src/utils/encrypted-frame-size.ts` still computes NaCl overhead ("24-byte NaCl nonce plus the 16-byte Poly1305 tag") but this is leftover sizing arithmetic from the removed relay, not active encryption — no NaCl/box library is imported anywhere in `server/src`, `client/src`, `app/src`, `cli/src`, `desktop/src`.

### 2.3 Keys and identities

| Key / id | Algorithm | Generated by | Stored at | Used for |
| --- | --- | --- | --- | --- |
| Daemon keypair | **X25519** (raw 32-byte, base64) | `loadOrCreateDaemonKeyPair` — `server/src/server/daemon-keypair.ts` | `$JAGENTDESK_HOME/daemon-keypair.json` `{ v: 2, publicKeyB64, secretKeyB64 }`, written with `writePrivateFileAtomicSync` (private file) | Only the **public** half is used: embedded in the pairing offer and compared for equality at device registration. The secret key is never used for signing or ECDH in current code (no reference to it outside the keypair module). It is a legacy relay artifact acting as a daemon identity token. |
| Device keypair (mobile) | **Ed25519** | Go bridge, `ed25519.GenerateKey(rand.Reader)` — `app/modules/jagentdesk-tailscale/go/tailscale-bridge/bridge.go:164-180` | File `jagentdesk-device-ed25519.key` (raw 64-byte private key, mode `0600`) inside the tsnet state dir in the app's private application-support directory. **Not** in iOS Keychain / Android Keystore. | Signs the daemon's challenge nonce. Private key never crosses into JS: JS calls `signNonce(nonce)` on the native module. |
| Device keypair (desktop) | Ed25519 | Electron **main** process, `getDesktopDeviceKeyPair()` — `packages/desktop/src/daemon/daemon-manager.ts:183-240` | `$JAGENTDESK_HOME/desktop-device-keypair.json` `{ v: 1, publicKeyB64, secretKeyB64 }`, mode `0600` | Same. Renderer only gets the public key and asks main to sign via IPC `desktop_tailscale_sign_nonce`. |
| Device keypair (CLI) | Ed25519 | `loadOrCreateCliDeviceKeypair` — `packages/cli/src/utils/client.ts:77-95` | `$JAGENTDESK_HOME/cli-device-keypair.json` `{ publicKeyB64, privateKeyPem }`, mode `0600` | Same; answers the challenge when the daemon enforces local pairing. |
| `serverId` | opaque id | `getOrCreateServerId` — `server/src/server/server-id.ts` | under `$JAGENTDESK_HOME` | Stable host identity; key of the app's host registry. |
| `clientId` | `cid_<uuid>` | `packages/app/src/utils/client-id.ts` | AsyncStorage `@jagentdesk:client-id-v1` | **Session resume key** (not an auth credential). |
| Paired-device record | — | daemon | `$JAGENTDESK_HOME/paired-devices.json` `{ v: 1, devices: [...] }` | Trust store. |
| Daemon password (optional) | bcrypt cost 12 | user | hash in `$JAGENTDESK_HOME/config.json` | Bearer gate on HTTP + WS upgrade. |

Device-key wire contract (`server/src/server/pairing/device-signature-crypto.ts:10-16`):

```ts
/**
 * Ed25519 primitives for per-device pairing keys.
 *
 * Wire contract: public keys are base64-encoded raw 32 bytes, signatures are
 * base64-encoded raw 64 bytes. This is distinct from the daemon's own X25519
 * keypair (`daemon-keypair-crypto.ts`) — that one stays untouched.
 */
```

Signing and verifying (same file):

```ts
export function signNonce(key: DeviceKeyPair, nonce: string): string {
  ...
  const signature = sign(null, Buffer.from(nonce, "utf8"), privateKey);
  return signature.toString("base64");
}

export function verifyNonceSignature(publicKeyB64: string, nonce: string, signatureB64: string): boolean {
  try {
    const rawKey = Buffer.from(publicKeyB64, "base64");
    requireKeyBytes(rawKey, "public");
    const signature = Buffer.from(signatureB64, "base64");
    if (signature.byteLength !== SIGNATURE_LENGTH_BYTES) {
      return false;
    }
    const publicKey = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, rawKey]), format: "der", type: "spki" });
    return verify(null, Buffer.from(nonce, "utf8"), publicKey, signature);
  } catch {
    return false;
  }
}
```

Uses `node:crypto` only (no third-party crypto dependency). Public-key comparison is constant-time (`samePublicKeyB64` -> `timingSafeEqual`).

Trust store (`server/src/server/pairing/paired-devices.ts`):

```ts
export interface PairedDevice {
  deviceId: string;
  devicePublicKeyB64: string;
  deviceName?: string;
  pairedAtMs: number;
}

export interface PairedDeviceStore {
  list(): PairedDevice[];
  getByPublicKey(publicKeyB64: string): PairedDevice | null;
  getById(deviceId: string): PairedDevice | null;
  isPaired(publicKeyB64: string): boolean;
  register(input: { devicePublicKeyB64: string; deviceName?: string }): PairedDevice;
  revokeById(deviceId: string): boolean;
  revokeByPublicKey(publicKeyB64: string): boolean;
}
```

### 2.4 The pairing offer (QR / link)

Schema (`packages/protocol/src/connection-offer.ts`):

```ts
export const TailnetConnectionOfferSchema = z.object({
  v: z.literal(3),
  serverId: z.string().min(1),
  daemonPublicKeyB64: z.string().min(1),
  tailnetAddress: z.string().min(1),
  useTls: z.boolean().optional(),
});
```

Encoding (`server/src/server/connection-offer.ts`): `JSON.stringify(offer)` -> base64url -> `${appBaseUrl}/#offer=<base64url>`, default `appBaseUrl = "jagentdesk://app"` (`server/src/server/pairing-offer.ts:39`). The offer lives in the URL **fragment** so it is not sent to any web server. It carries no secret — only address + daemon public key + serverId. If the daemon has no tailnet address the offer is `{ tailnetEnabled: false, url: null, qr: null }` (no QR is produced for local-only daemons).

Delivery surfaces:

- Desktop: Settings -> Host -> "Pair a device" — `packages/app/src/desktop/components/pair-device-section.tsx` calls `client.getDaemonPairingOffer({ forceRefresh })` (RPC `daemon.get_pairing_offer.request`), renders the QR with the `qrcode` package, offers "copy link", lists pending requests with their six-digit code + countdown (`pairing-countdown.ts`) and a decline button (`client.pairingDeviceCancel`).
- CLI: `jagentdesk daemon pair` — `packages/cli/src/commands/daemon/pair.ts` prints link + terminal QR (`server/src/server/pairing-qr.ts`).
- Mobile intake: `packages/app/src/app/pair-start.tsx` (choose scan or paste; "Continue with Local" hidden on native), `pair-scan.tsx` (`expo-camera` `CameraView`, accepts any payload containing `#offer=`), `pair-link.tsx` (paste), `tailscale-login.tsx` (join tailnet: interactive login URL or auth key), `pair-verify.tsx` (six-digit entry). The offer is persisted across the Tailscale login detour in AsyncStorage `@jagentdesk:pending-pairing-offer:v1` (`packages/app/src/pairing/pending-pairing-offer.ts`).

### 2.5 Handshake messages

```ts
// Daemon → client, tailnet transport only. The daemon issues a single-use
// nonce the client must echo back (signed) in its `hello` message.
export const WSChallengeMessageSchema = z.object({
  type: z.literal("challenge"),
  nonce: z.string().min(1),
});

export const WSHelloMessageSchema = z.object({
  type: z.literal("hello"),
  clientId: z.string().min(1),
  clientType: z.enum(["mobile", "browser", "cli", "mcp"]),
  protocolVersion: z.number().int(),
  appVersion: z.string().optional(),
  capabilities: z.object({ voice: ..., pushNotifications: ..., [CLIENT_CAPS.*]: ... }).passthrough().optional(),
  // Signed-hello client contract (tailnet transport):
  // - `nonce` is the single-use nonce the daemon issued in the `challenge`
  //   message, echoed back verbatim.
  // - `signature` is base64 (standard, not URL-safe) of the raw 64-byte
  //   Ed25519 signature over the UTF-8 bytes of the nonce string.
  // - `devicePublicKeyB64` is base64 of the raw 32-byte Ed25519 public key of
  //   the paired device.
  nonce: z.string().min(1).optional(),
  signature: z.string().min(1).optional(),
  devicePublicKeyB64: z.string().min(1).optional(),
});
```

Pairing RPCs (`messages.ts:1448-1530`, responses `5638-5697`):

```ts
export const PairingDeviceIdentifyRequestSchema = z.object({
  type: z.literal("pairing.device.identify.request"),
  requestId: z.string(),
  deviceName: z.string().min(1).max(200).optional(),
  devicePublicKeyB64: z.string().min(1).optional(),
});

export const PairingDeviceRegisterRequestSchema = z.object({
  type: z.literal("pairing.device.register.request"),
  requestId: z.string(),
  daemonPublicKeyB64: z.string().min(1),
  devicePublicKeyB64: z.string().min(1),
  deviceName: z.string().optional(),
  pairingCode: z.string().regex(/^\d{6}$/).optional(),
});

export const PairingDeviceRequestedMessageSchema = z.object({
  type: z.literal("pairing.device.requested"),
  payload: z.object({
    requestId: z.string().min(1),
    pairingCode: z.string().regex(/^\d{6}$/),
    expiresAtMs: z.number().int().positive(),
    /** Connection metadata is informational only; it never grants access. */
    deviceName: z.string().min(1).optional(),
    devicePublicKeyB64: z.string().min(1).optional(),
    connectionId: z.string().min(1).optional(),
    remoteAddress: z.string().min(1).optional(),
    transport: z.literal("tailnet").optional(),
  }),
});
```

Plus `pairing.device.register.response { requestId, ok, deviceId?, error? }`, `pairing.device.completed`, `pairing.device.cancelled`, `pairing.device.cancel.request/response`, `pairing.device.revoke.request/response`, `pairing.device.list.request/response`, `daemon.get_pairing_offer.request/response`.

Client-side config that drives the handshake (`packages/client/src/daemon-client.ts:478-520`):

```ts
export interface DeviceSigningConfig {
  /** base64 (standard) of the raw 32-byte Ed25519 public key of the paired device. */
  devicePublicKeyB64: string;
  /** Returns base64 (standard) of the raw 64-byte Ed25519 signature over the UTF-8 bytes of `nonce`. */
  signNonce(nonce: string): string | Promise<string>;
}

export interface PairingRegistrationConfig {
  /** The daemon's public key read from the pairing offer; must match the daemon's own key. */
  daemonPublicKeyB64: string;
  deviceName?: string;
  /** Human-entered six-digit code displayed by the daemon during pairing. */
  pairingCode?: string;
  /** Resolves when the user enters the code shown by the daemon. */
  pairingCodeProvider?: () => Promise<string>;
}
```

### 2.6 First-time pairing — step-by-step, as implemented

Actors: **D** = daemon, **K** = already-trusted desktop UI session, **M** = new mobile device.

1. **Daemon bootstrap** (`server/src/server/bootstrap.ts:631-664`): load/create daemon X25519 keypair; open `paired-devices.json`; if env `JAGENTDESK_DESKTOP_DEVICE_PUBLIC_KEY` holds a 32-byte key not yet paired, register it as `"JAgentDesk Desktop"` (the desktop is the sole trust bootstrap — Electron main passes only the public key via env, `daemon-manager.ts:992`); create `NonceChallengeManager` and `PairingCodeManager`; start the tsnet listener.
2. **Offer**: K calls `daemon.get_pairing_offer.request`; D returns `{ url, qr, tailnetEnabled }`. K renders QR / link.
3. **Intake**: M scans or pastes the link, parses it with `ConnectionOfferSchema`, saves it as pending. If the device is not on the tailnet, M routes to `/tailscale-login?returnTo=pair-verify` and joins via the embedded tsnet node (interactive URL or auth key). The Go bridge creates the Ed25519 device key on first start.
4. **Dial**: M asks the native bridge for a loopback proxy to `offer.tailnetAddress` and opens `ws://127.0.0.1:<port>/ws` with `expectChallenge: true`, `deviceSigning`, and `pairingRegistration { daemonPublicKeyB64, deviceName, pairingCodeProvider }` (`pair-verify.tsx:171-196`, timeouts 5 min).
5. **Upgrade checks** (D, `verifyWsUpgrade` + `attachAuthenticatedSocket`): reject if shutting down (503); `Host` header must pass the hostname allowlist (DNS-rebinding guard, else 403); `Origin` must be absent, allow-listed, `*`, or same-origin (else 403); if a daemon password is set, the WS subprotocol `jagentdesk.bearer.<password>` must bcrypt-match (else close `4401`).
6. **Challenge** (D, `attachSocket`): tailnet sockets always require a signed hello (`requiresSignedHello`). D issues `nonce = base64url(randomBytes(32))`, TTL 30 s, max 4096 outstanding (`pairing/nonce-challenge.ts`), stores it on the pending connection, assigns `pairingRequestId = randomUUID()`, sends `{ type: "challenge", nonce }`, and arms a hello timeout of **5 minutes** (`TAILNET_PAIRING_HELLO_TIMEOUT_MS`; 15 s for non-pairing sockets). If pairing deps are not wired, a tailnet socket is closed immediately with `4401 "Tailnet connections require pairing"`.
7. **Identify (pre-hello, unauthenticated hint)**: M's client, on `challenge`, sends `session{ pairing.device.identify.request { deviceName, devicePublicKeyB64 } }` (`sendPairingDeviceIdentityPreHello`). D issues a per-connection six-digit code (`randomInt(100000, 1000000)`, TTL 5 min, `pairing/pairing-code.ts`), remembers one pending request (**one active pairing request per daemon**; a different device is rejected with `4408 "Another device pairing is already in progress"`; the same device key replaces its previous socket), and **broadcasts `pairing.device.requested`** via `broadcast()`, which targets every already-authenticated session of kind `"trusted"` (pending/unauthenticated sockets and share guests never receive it; note this includes other already-paired tailnet devices, not only the desktop). Pending requests are replayed on later connect to **direct-transport** sessions only (`replayPendingPairingRequests` returns early for `transport === "tailnet"`).
8. **Out-of-band confirmation**: K shows the code + device name + countdown. The human reads the code on the desktop and types it on M. K may decline (`pairing.device.cancel.request` -> D sends `pairing.device.cancelled` to M and closes with `4408`).
9. **Register (pre-hello)**: M sends `session{ pairing.device.register.request { daemonPublicKeyB64, devicePublicKeyB64, deviceName, pairingCode } }`. In `pair-verify.tsx` the code entry replaces the waiting socket with a fresh one that carries the code directly. D (`handlePairingRegisterPreHello`) checks, fail-closed, in order:
   - pairing is configured;
   - `request.daemonPublicKeyB64 === this.pairing.daemonPublicKeyB64` (proves M holds the offer);
   - `pairingCodeManager.verifyForRequest(code, expectedCodeOfThisConnection)` — regex `^\d{6}$`, not expired, `timingSafeEqual`;
   - then `devices.register(...)` (idempotent: an already-known public key reuses the existing record), replies `pairing.device.register.response { ok: true, deviceId }`, and broadcasts `pairing.device.completed` to trusted sessions.
10. **Signed hello**: M computes `signature = Ed25519(deviceSecret, utf8(nonce))` in native code and sends `hello { clientId, clientType: "mobile", protocolVersion: 1, appVersion, capabilities, nonce, signature, devicePublicKeyB64 }` (`sendSignedHello`).
11. **Verify** (D, `verifyTailnetSignedHello` + `pairing/signed-hello.ts`), in order:
    - `message.nonce === pending.challengeNonce` — the response must be bound to the nonce issued on **this exact socket** (comment: "it must not let a valid signature for another socket's challenge authorize this connection");
    - `challenges.consume(nonce)` — single use, not expired -> else `"unknown or expired nonce"`;
    - `devices.getByPublicKey(devicePublicKeyB64) !== null` -> else `"device is not paired"`;
    - `verifyNonceSignature(...)` -> else `"signature verification failed"`.
    Any failure closes with `4401 "Authorization failed"`.
12. **Post-auth hello checks** (`handleHello`): `protocolVersion === 1` else close `4003`; non-empty `clientId` else `4002`; reserved prefixes `plugin:` / `hub:` rejected for network sockets (`4002`).
13. **Session**: D creates (or resumes, keyed by `clientId`) a session and sends `session{ status { status: "server_info", serverId, hostname, version, capabilities, features } }`. There is no separate welcome message.
14. **Persist on M** (`pair-verify.tsx:238-260`): close the pairing socket, `setConnectionMode("tailscale")`, `upsertConnectionFromOffer(offer)` -> host registry in AsyncStorage `@jagentdesk:daemon-registry`. Comment: "The code is a one-time enrollment proof, not a host connection secret. Store only the offer metadata; reconnects authenticate with the persisted device key and never replay the six-digit proof."

Stored host shape (`packages/app/src/types/host-connection.ts`):

```ts
export interface TailnetHostConnection {
  id: string;
  type: "tailnet";
  tailnetAddress: string; // host:port on the tailnet, e.g. "100.x.y.z:6768" or a MagicDNS name
  useTls?: boolean;
  daemonPublicKeyB64: string;
  pairingCode?: string;
}

export type HostConnection =
  | DirectTcpHostConnection      // { id, type: "directTcp", endpoint, useTls, password? }
  | DirectSocketHostConnection   // { id, type: "directSocket", path }
  | DirectPipeHostConnection     // { id, type: "directPipe", path }
  | TailnetHostConnection;

export interface HostProfile {
  serverId: string;
  label: string;
  appearance: HostAppearance;
  lifecycle: HostLifecycle;
  connections: HostConnection[];
  preferredConnectionId: string | null;
  createdAt: string;
  updatedAt: string;
}
```

### 2.7 Every later connection (reconnect / resume)

1. `HostRuntimeController` (`packages/app/src/runtime/host-runtime.ts:577-620`) builds a `DaemonClient` per candidate connection. For `tailnet`: `expectChallenge: true` + `deviceSigning` only — comment: "Runtime reconnects use the already-held device key only. They must not create a fresh pending Pair a device request".
2. Socket opens -> client waits for `challenge` (`CHALLENGE_WAIT_FALLBACK_MS = 10_000`). On tailnet a timeout **refuses** to send an unsigned hello (`"Tailnet challenge timed out; refusing unsigned hello"`, close 1008). Only direct/loopback clients may set `unsignedHelloFallbackOnChallengeTimeout` (CLI uses 750 ms) to stay compatible with a daemon whose local gate is off.
3. Fresh nonce -> signed hello -> steps 11–13 above. A new nonce per socket is the replay protection: a captured hello is useless on another socket (nonce mismatch) and on the same nonce (consumed, 30 s TTL).
4. **Session resume**: sessions are keyed by `clientId` in `externalSessionsByKey`. When the last socket of a session closes, the daemon keeps the session for `EXTERNAL_SESSION_DISCONNECT_GRACE_MS = 90_000` before cleanup; a hello with the same `clientId` within that window re-attaches (`resumeExistingExternalSession`), refreshes capabilities, and re-sends `server_info`. Multiple sockets (tabs, direct + tailnet) may share one `clientId`.
5. **Client backoff** (`daemon-client.ts`): `delay = min(1500 * 2^attempt, 30000)` ms; connect timeout 15 s; app-level JSON `ping`/`pong` every 10 s, 2 consecutive liveness failures force a reconnect; `forceReconnect()` on app resume because OS suspension freezes timers. On disconnect all pending RPC waiters and the send queue are rejected (`DaemonConnectionError`); session RPC default timeout 60 s.
6. **State catch-up after resume** is not a transport feature: the app refetches via `fetch_agent_timeline_request` using seq cursors (section 3).
7. **Connection selection**: the controller probes candidate connections (`PROBE_TICK_MS = 2_000`, steady `10_000`, backoff max `30_000`), filtered by a persisted connection mode `local | tailscale` (AsyncStorage `@jagentdesk:connection-mode:v4`). Native defaults to no mode (must pair); web defaults to `local`.

### 2.8 Local (direct) connections

- Default bind `127.0.0.1:6767` (dev `6768`), or unix socket / Windows named pipe. The Electron renderer reaches its managed daemon through a local transport factory (`createDesktopLocalDaemonTransportFactory`), i.e. socket/pipe, not TCP.
- By default direct connections send a **plain unsigned hello**; trust = OS boundary (loopback bind, `0600` socket) + optional bcrypt password.
- `JAGENTDESK_REQUIRE_LOCAL_PAIRING=1` extends the same challenge + signed-hello gate to direct sockets (`requireSignedHelloForDirect`, ADR-0010). It is **off by default** because there is no automatic trust path for the CLI key yet (`docs/plans/active/local-requires-device-pairing.md`, status items 5 and 6 open). In-process plugin sockets are always exempt.

### 2.9 Authorization, trust and revocation

- Listing and revoking: `pairing.device.list.request` / `pairing.device.revoke.request { deviceId }` -> `PairedDeviceStore.revokeById` (`server/src/server/session/daemon/daemon-session.ts:410-470`).
- **Gap worth fixing in a sibling project:** revoke only removes the record. I found no code that closes live sockets of the revoked device (`identity.deviceId` is recorded at `websocket-server.ts:2077` but only used for logging). A revoked device stays connected until its socket drops, then fails the next signed hello.
- No key rotation, no expiry on paired devices, no per-device scopes: every paired device is a full-trust operator. `docs/permissions.md` describes a principals/grants model (`daemon.read`, `workspace.write`, `access.manage`, ...) — the permission names exist in `messages.ts` (`DAEMON_PERMISSIONS`) and are used for Hub relationships; whether paired devices are restricted by them is **UNVERIFIED**.
- The daemon does not authenticate itself to the client cryptographically. The client trusts (a) the tailnet address from the offer and WireGuard node identity, and (b) the `serverId` it expects. `daemonPublicKeyB64` is checked by the daemon (client proves it saw the offer), not the other way around.
- Scoped guest access exists separately: "session share" (ADR-0019) — a guest token validated by a scoped `ShareServer`, a session limited to an RPC-type allowlist and one `agentId` (`server/src/server/session-share/guest-scopes.ts`); guests skip device pairing.

### 2.10 Close codes and limits

| Code | Meaning | Source |
| --- | --- | --- |
| 4001 | hello timeout (15 s, or 5 min while pairing) | `websocket-server.ts:557-563` |
| 4002 | invalid hello / session message before hello / reserved clientId | `:564` |
| 4003 | incompatible `protocolVersion` (must be `1`) | `:565,569` |
| 4401 | daemon auth failed (password, unpaired device, bad signature, nonce mismatch) | `:134` |
| 4408 | pairing cancelled / replaced / another pairing in progress | `:566` |
| 1001 | server shutting down | `:568` |

Other limits: 8 MiB outbound high-water mark per socket, 4 MiB terminal soft backpressure, file downloads in 256 KiB chunks (`docs/architecture.md`).

### 2.11 Security properties, stated plainly

| Property | Remote (tailnet) | Local (direct) |
| --- | --- | --- |
| Confidentiality / integrity in transit | WireGuard (Tailscale) | none at app layer; loopback or optional TLS |
| Network reachability control | tailnet membership | bind address + Host/Origin allowlists |
| Device authentication | Ed25519 signature over a fresh per-socket nonce, key must be in `paired-devices.json` | none by default; same gate behind env flag |
| Enrollment proof | offer (daemon pubkey) + six-digit code shown on trusted desktop, 5 min TTL, one pending request at a time | n/a (desktop key auto-registered via env) |
| Replay | nonce single-use, 30 s TTL, bound to socket | n/a |
| Per-message signing / E2EE | **no** | **no** |
| Daemon -> client authentication | implicit (tailnet node identity) | implicit (loopback) |
| Revocation | remove record; live sockets not dropped | — |

Known weak points to decide on when mirroring: device private keys are plain files (not hardware-backed); the six-digit code has no attempt limiter — a wrong code just returns `"Invalid or expired 6-digit pairing code"` and the socket stays open for retries (grep for attempt/rate-limit/lockout in `pairing/*.ts` and `websocket-server.ts` finds nothing); the only bounds are one pending request at a time, the 5-minute expiry, and tailnet membership; AsyncStorage host registry and replica cache are unencrypted (`docs/architecture.md` says so explicitly).

### 2.12 Direct answers to the spec questions

- **What is in the QR / link?** `jagentdesk://app/#offer=<base64url(JSON)>` where JSON = `{ v: 3, serverId, daemonPublicKeyB64, tailnetAddress, useTls? }`. No secret, no code, no expiry. The QR encodes the same URL.
- **What is the code?** Six decimal digits, generated by the daemon per pending connection, shown only on already-trusted clients, typed by the human on the new device. TTL 5 minutes. It is not in the QR.
- **Exactly what bytes are signed, and by whom?** Only the **new/returning device** signs. Message = the UTF-8 bytes of the daemon's nonce string (base64url text of 32 random bytes). Algorithm = pure Ed25519 (`sign(null, ...)`, no prehash, no context/domain-separation string, no timestamp, no serverId, no clientId in the signed payload). The daemon signs nothing. `SECURITY.md` says "The daemon signs and verifies the pairing transcript" — the code only verifies the device's nonce signature; there is no transcript signature (doc/code mismatch).
- **Nonce / timestamp / replay**: no timestamps anywhere. Replay protection = server-issued nonce, single-use (`consume`), 30 s TTL, compared against the nonce stored on that socket.
- **Token issuance / rotation**: none. No session token, refresh token, or JWT is issued to paired devices. The long-lived credential is the device's Ed25519 private key; each connection re-proves possession. There is no key rotation or expiry. The only bearer tokens in the system are the optional daemon password (WS subprotocol `jagentdesk.bearer.<password>`, HTTP `Authorization: Bearer`), share-guest tokens (2.14), and Hub credentials (not read).
- **Revocation / unpair**: daemon side `pairing.device.revoke.request` (2.9). Client side, removing the host deletes the `HostProfile` from AsyncStorage; I did not find a call that also revokes the device on the daemon when a host is removed (**UNVERIFIED** either way).

### 2.13 How the web client connects

A plain browser has no tailnet node and no device key: `WebTailscaleLoginAdapter.getDeviceSigningMaterial()` returns `null` unless running inside Electron, and `getStatus()` returns `{ kind: "connected" }` (`packages/app/src/tailscale/adapter.ts`). Consequences:

- The browser build can only use a **`directTcp`** connection (`ws://host:port/ws`, optional `useTls`, optional `password`) — typically same-origin to a daemon started with `--web-ui` (`public-docs/web-ui.md`: "The browser renderer connects to the same daemon origin"). Auth = Host/Origin allowlists + optional password; unsigned hello.
- It cannot complete the tailnet signed hello: with no signer the client closes with `"Tailnet challenge received but device signing is not configured"`.
- For remote browser use the doc recommends Tailscale Serve or another private path plus a daemon password. Such traffic reaches the daemon's normal HTTP listener, so it is classified `transport: "direct"` and the pairing gate does not apply unless `JAGENTDESK_REQUIRE_LOCAL_PAIRING` is on (in which case a browser cannot connect at all, having no key).
- Runtime default connection mode on web is `"local"` (`host-runtime.ts:487`).

For a web-first product this is the main gap to design around: JAgentDesk has no browser-held device key (no WebCrypto keypair, no IndexedDB key storage).

### 2.14 Session-share guest path (separate trust model, works from any browser)

Code: `packages/server/src/server/session-share/{service,share-server,tunnel-manager,guest-scopes,guest-page}.ts`; schemas `messages.ts:2963-3100`; opt-in via `daemon.sessionSharing.enabled` in `config.json` (default off).

1. A trusted client sends `session.share.create.request { agentId, capabilities?, requireHostApproval?, ... }`.
2. The daemon starts a per-share `ShareServer` on a loopback port and fronts it with a **Cloudflare quick tunnel**: spawns `cloudflared tunnel --url http://127.0.0.1:<port>` and scrapes the `https://<words>.trycloudflare.com` URL. If `cloudflared` is missing the RPC fails with code `cloudflared_missing`. Share id `share_<12 hex>`, TTL 60 minutes (`SHARE_TTL_MS`), in-memory only (dies with the daemon).
3. The guest opens the tunnel URL (served guest page) and connects to WS path `/guest`, asking to join with a label; device is parsed from the User-Agent.
4. Every connected host device sees the pending request; the host accepts with `session.share.respond.request { shareId, joinRequestId, accept }`. On accept **the daemon** mints a six-digit code (`randomInt(0, 1_000_000)` zero-padded), shown only to the host, valid 5 minutes (`CODE_TTL_MS`).
5. The host relays the code out of band; the guest enters it. Wrong codes are counted: `MAX_FAILED_ATTEMPTS = 5` then a `LOCKOUT_WINDOW_MS = 60_000` lockout, surfaced to the host as `failedAttempts` / `lockedUntil_ms`. (This is the attempt limiter the device-pairing path lacks.)
6. On success the daemon mints a guest token `gt_<48 hex>` (`randomBytes(24)`), held in memory, mapped to `{ shareId, agentId, member }`.
7. The guest app opens the scoped `/ws` on the same tunnel, presenting the token as the WS bearer subprotocol (`jagentdesk.bearer.<token>`). The socket is attached to the main WS server with a `guestGrant { agentId, scopes, workspaceCwd }`; its hello skips device pairing.
8. Enforcement: `guestScopesForCapabilities(caps)` yields an allowlist of RPC **type names**; it gates inbound requests and outbound frames, and every agent-scoped message is confined to the shared `agentId`. `files` and `terminal` capabilities are declared but intentionally not mapped to scopes yet.
9. Host controls: `session.share.set_options.request` (live capability changes), `session.share.kick.request { memberId }`, `session.share.stop.request` (deletes all tokens for the share, stops the tunnel).

```ts
export const SessionShareCapabilitiesSchema = z.object({
  chat: z.boolean(),
  files: z.boolean(),
  terminal: z.boolean(),
  modelMode: z.boolean(),
  readOnly: z.boolean().default(false),
  artifacts: z.boolean().default(false),
});

export const SessionShareRequestSchema = z.object({
  requestId: z.string(),
  label: z.string(),
  requestedAt_ms: z.number().int(),
  status: z.enum(["pending", "approved"]),
  code: z.string().nullable().optional(),
  device: z.string().optional(),
  failedAttempts: z.number().int().optional(),
  lockedUntil_ms: z.number().int().nullable().optional(),
  codeExpiresAt_ms: z.number().int().nullable().optional(),
});
```

Trust here = possession of the tunnel URL + host approval + six-digit code -> bearer token over Cloudflare TLS. Cloudflare terminates TLS, so this path is not end-to-end encrypted.

### 2.15 Protocol package (`packages/protocol`)

- `@jagentdesk/protocol` `0.9.46`, deps: `zod ^4.4.3`, `semver`; dev: `zod-aot 0.20.4` (ahead-of-time generated validators — `npm run generate:validators`, output in `src/generated/validation/`, see `docs/protocol-validation.md`). Subpath exports `./*` -> `dist/*.js`.
- Files: `messages.ts` (all WS schemas), `connection-offer.ts`, `host-connection-schema.ts`, `daemon-endpoints.ts`, `client-capabilities.ts`, `binary-frames/{terminal,file-transfer,demux}.ts`, `agent-types.ts`, `agent-lifecycle.ts`, `provider-config.ts`, `provider-manifest.ts`, `orchestration.ts`, `schedule/`, `loop/`, `chat/`, `skills.ts`, `plugin-config.ts`, `jagentdesk-config-schema.ts`, and domain folders (`browser-automation/`, `database/`, `docker/`, `cluster/`, `simulator/`, `proxy/`, `search/`, `agent-forum/`).
- Request/response convention (`docs/rpc-namespacing.md`): `domain.namespace.operation.request` pairs with `.response`; request params at top level, response data under `payload`, `requestId` in both; failures use `rpc_error { requestId, requestType, error }`. Older flat names (`fetch_agent_timeline_request`) still exist.
- Compatibility rules (`docs/protocol-compatibility.md`): new fields optional; never remove/narrow/require; wire schemas pure (no `.transform()`, `.catch()`, `.preprocess()`); use `z.discriminatedUnion`; feature gating once via `server_info.features.*`; client capabilities advertised in `hello.capabilities` (`CLIENT_CAPS` in `client-capabilities.ts`) and checked with `session.supports(...)`; every shim tagged `// COMPAT(name): added in vX, remove after <date>`.
- Binary terminal frame: 1-byte opcode (`Output 0x01`, `Input 0x02`, `Resize 0x03`, `Snapshot 0x04`, `Restore 0x05`), 1-byte slot, payload (`binary-frames/terminal.ts`).

---

## 3. Chat agent

### 3.1 Model

JAgentDesk does not call LLM APIs for chat. The daemon **wraps installed agent CLIs/SDKs** and normalizes them behind one interface; the app renders a normalized timeline. Credentials stay with the provider CLIs.

Built-in providers (`packages/protocol/src/provider-manifest.ts`, `AGENT_PROVIDER_DEFINITIONS`): `claude`, `codex`, `copilot`, `opencode`, `pi`, `omp` ("Oh My Pi"). Adapters in `packages/server/src/server/agent/providers/`: `claude/` (Anthropic Agent SDK), `codex-app-server-agent.ts`, `copilot-acp-agent.ts`, `opencode-agent.ts` + `opencode/`, `pi/`, `omp/`, plus ACP-based `acp-agent.ts`, `generic-acp-agent.ts`, `cursor-acp-agent.ts`, `kimi-acp-agent.ts`, `kiro-acp-agent.ts`, `trae-acp-agent.ts`, and `mock-slow-provider.ts`. Custom providers are added by config (4.2).

Provider contract (`packages/server/src/server/agent/agent-sdk-types.ts:749`, trimmed):

```ts
export interface AgentClient {
  readonly provider: AgentProvider;
  readonly capabilities: AgentCapabilityFlags;
  createSession(config: AgentSessionConfig, launchContext?: AgentLaunchContext, options?: AgentCreateSessionOptions): Promise<AgentSession>;
  resumeSession(handle: AgentPersistenceHandle, overrides?: Partial<AgentSessionConfig>, launchContext?: AgentLaunchContext, options?: AgentResumeSessionOptions): Promise<AgentSession>;
  fetchCatalog(options: FetchCatalogOptions, context?: ProviderRefreshContext): Promise<ProviderCatalog>;
  ...
  isAvailable(signal?: AbortSignal): Promise<boolean>;
  archiveNativeSession?(handle: AgentPersistenceHandle): Promise<void>;
  shutdown?(): Promise<void>;
}

export interface AgentSession {
  readonly provider: AgentProvider;
  readonly id: string | null;
  readonly capabilities: AgentCapabilityFlags;
  run(prompt: AgentPromptInput, options?: AgentRunOptions): Promise<AgentRunResult>;
  startTurn(prompt: AgentPromptInput, options?: AgentRunOptions): Promise<{ turnId: string }>;
  subscribe(callback: (event: AgentStreamEvent) => void): () => void;
  streamHistory(): AsyncGenerator<AgentStreamEvent>;
  getAvailableModes(): Promise<AgentMode[]>;
  setMode(modeId: string): Promise<void | AgentProviderNotice>;
  getPendingPermissions(): AgentPermissionRequest[];
  respondToPermission(requestId: string, response: AgentPermissionResponse): Promise<AgentPermissionResult | void>;
  describePersistence(): AgentPersistenceHandle | null;
  interrupt(): Promise<void>;
  close(): Promise<void>;
  setModel?(modelId: string | null): Promise<void>;
  setThinkingOption?(thinkingOptionId: string | null): Promise<void | AgentProviderNotice>;
  revertConversation?(input: { messageId: string }): Promise<void>;
  steerActiveTurn?(prompt: AgentPromptInput, options: SteerActiveTurnOptions): Promise<SteerResult>;
  ...
}

export interface AgentCapabilityFlags {
  [capability: string]: boolean | undefined;
  supportsStreaming: boolean;
  supportsSessionPersistence: boolean;
  supportsSessionListing?: boolean;
  supportsDynamicModes: boolean;
  supportsMcpServers: boolean;
  supportsNativeJAgentDeskTools?: boolean;
  supportsReasoningStream: boolean;
  supportsToolInvocations: boolean;
  supportsRewindConversation?: boolean;
  supportsRewindFiles?: boolean;
  supportsRewindBoth?: boolean;
}
```

### 3.2 Stream and timeline types (same file, `:383-452`)

```ts
export type AgentTimelineItem =
  | { type: "user_message"; text: string; messageId?: string; clientMessageId?: string }
  | { type: "assistant_message"; text: string; messageId?: string }
  | { type: "reasoning"; text: string }
  | ToolCallTimelineItem
  | { type: "todo"; items: AgentTaskItem[] }
  | { type: "error"; message: string }
  | CompactionTimelineItem;

export type AgentStreamEvent =
  | { type: "thread_started"; sessionId: string; provider: AgentProvider }
  | { type: "turn_started"; provider: AgentProvider; turnId?: string }
  | { type: "turn_completed"; provider: AgentProvider; usage?: AgentUsage; turnId?: string }
  | { type: "usage_updated"; provider: AgentProvider; usage: AgentUsage; turnId?: string }
  | { type: "mode_changed"; provider: AgentProvider; currentModeId: string | null; availableModes: AgentMode[] }
  | { type: "model_changed"; provider: AgentProvider; runtimeInfo: AgentRuntimeInfo }
  | { type: "thinking_option_changed"; provider: AgentProvider; thinkingOptionId: string | null }
  | { type: "turn_failed"; provider: AgentProvider; error: string; code?: string; diagnostic?: string; turnId?: string }
  | { type: "turn_canceled"; provider: AgentProvider; reason: string; turnId?: string }
  | { type: "timeline"; item: AgentTimelineItem; provider: AgentProvider; turnId?: string; timestamp?: string }
  | { type: "permission_requested"; provider: AgentProvider; request: AgentPermissionRequest; turnId?: string }
  | { type: "permission_resolved"; provider: AgentProvider; requestId: string; resolution: AgentPermissionResponse; turnId?: string }
  | { type: "attention_required"; provider: AgentProvider; reason: "finished" | "error" | "permission"; timestamp: string }
  | { type: "provider_subagent"; provider: AgentProvider; event: ...ProviderSubagentInputEvent };
```

Tool calls are a four-state lifecycle union (`ToolCallRunningTimelineItem | ...Completed... | ...Failed... | ...Canceled...`) carrying a normalized `ToolCallDetail` discriminated on `type` (`"shell" | "read" | "edit" | ...`; `:241`, remaining variants not copied here).

### 3.3 Session lifecycle on the wire (`packages/protocol/src/messages.ts`)

Lifecycle states: `initializing -> idle <-> running`, `error`, `closed` (`packages/protocol/src/agent-lifecycle.ts`, per `docs/architecture.md`).

```ts
const AgentSessionConfigSchema = z.object({          // :575
  provider: AgentProviderSchema,
  cwd: z.string(),
  modeId: z.string().optional(),
  model: z.string().optional(),
  thinkingOptionId: z.string().optional(),
  featureValues: z.record(z.string(), z.unknown()).optional(),
  title: ...,
  approvalPolicy: z.string().optional(),
  sandboxMode: z.string().optional(),
  networkAccess: z.boolean().optional(),
  webSearch: z.boolean().optional(),
  extra: z.object({ codex: ..., claude: ... }).partial().optional(),
  providerOptions: ProviderOptionsSchema.optional(),
  toolPolicy: ToolPolicySchema.optional(),
  systemPrompt: z.string().optional(),
  mcpServers: z.record(z.string(), McpServerConfigSchema).optional(),
});

export const CreateAgentRequestMessageSchema = z.object({   // :1760
  type: z.literal("create_agent_request"),
  config: AgentSessionConfigSchema,
  env: z.record(z.string(), z.string()).optional(),
  workspaceId: z.string().optional(),
  callerAgentId: z.string().optional(),
  worktreeName: z.string().optional(),
  initialPrompt: z.string().optional(),
  clientMessageId: z.string().optional(),
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  images: z.array(ImageAttachmentSchema).optional(),
  attachments: AgentAttachmentsSchema,
  git: GitSetupOptionsSchema.optional(),
  worktree: CreateAgentWorktreeTargetSchema.optional(),
  autoArchive: z.boolean().optional(),
  labels: z.record(z.string(), z.string()).default({}),
  requestId: z.string(),
});

export const SendAgentMessageRequestSchema = z.object({     // :1421
  type: z.literal("send_agent_message_request"),
  requestId: z.string(),
  agentId: z.string(),
  text: z.string(),
  messageId: z.string().optional(), // Client-provided ID for deduplication
  images: z.array(ImageAttachmentSchema).optional(),
  attachments: AgentAttachmentsSchema,
  activeTurnBehavior: ActiveTurnBehaviorSchema.optional(),
  skillIds: z.array(z.string()).optional(),
});
```

Other lifecycle RPCs seen: `resume_agent_request { handle, overrides }`, `import_agent_request`, `refresh_agent_request`, `cancel_agent_request`, `archive_agent_request`, `delete_agent_request`, `set_agent_mode_request { agentId, modeId }`, `set_agent_model_request { agentId, modelId }`, `wait_for_finish_request`, `agent.timeline.search.request`, `agent.timeline.list_prompts.request`, `agent.timeline.set_subscription.request`. Agent state the app renders is `AgentSnapshotPayloadSchema` (`:943`: `id, provider, cwd, workspaceId, model, status, activeTurn, capabilities, currentModeId, availableModes, pendingPermissions, persistence, lastUsage, title, labels, requiresAttention, attentionReason, archivedAt, ...`).

Persistence: `$JAGENTDESK_HOME/agents/{cwd-with-dashes}/{agent-id}.json` (`agent/agent-storage.ts`, per `docs/architecture.md`); provider-native history (e.g. `~/.claude/projects/...jsonl`) is the durable transcript and is replayed through `streamHistory()` on resume.

### 3.4 Streaming and sync

```ts
export const AgentStreamMessageSchema = z.object({          // :4953
  type: z.literal("agent_stream"),
  payload: z.object({
    agentId: z.string(),
    event: AgentStreamEventPayloadSchema,
    timestamp: z.string(),
    // Present for timeline events. Maps 1:1 to canonical in-memory timeline rows.
    seq: z.number().int().nonnegative().optional(),
    epoch: z.string().optional(),
  }),
});

export const AgentTimelineCursorSchema = z.object({ epoch: z.string(), seq: z.number().int().nonnegative() });

export const FetchAgentTimelineRequestMessageSchema = z.object({   // :1876
  type: z.literal("fetch_agent_timeline_request"),
  agentId: z.string(),
  requestId: z.string(),
  direction: z.enum(["tail", "before", "after"]).optional(),
  cursor: AgentTimelineCursorSchema.optional(),
  limit: z.number().int().nonnegative().optional(),
  projection: z.enum(["projected", "canonical"]).optional(),
  mergeWindow: z.boolean().optional(),
});
```

The response (`:5309`) carries `epoch, reset, staleCursor, gap, window{minSeq,maxSeq,nextSeq}, startCursor, endCursor, hasOlder, hasNewer, entries[]`, each entry `{ provider, item, timestamp, seqStart, seqEnd, sourceSeqRanges, collapsed: ("assistant_merge"|"reasoning_merge"|"tool_lifecycle")[] }`.

Rules (`docs/timeline-sync.md`): live `agent_stream` is for immediacy; `fetch_agent_timeline_request` is authoritative; on a sequence gap the app fetches `direction: "after"` page by page until `hasNewer: false`; opening an agent fetches one bounded tail page, older history loads on scroll; shell tool output is capped at 64 KiB before entering either path; presence heartbeats (`client_heartbeat { deviceType, focusedAgentId, lastActivityAt, appVisible }`) drive notification routing only, never delivery. Capable clients receive streams only for agents they subscribe to (`CLIENT_CAPS.selectiveAgentTimeline`). Text coalescing/paced reveal: `docs/agent-stream-performance.md` (doc, not read), server `agent-stream-coalescer.ts`, app `agent-stream/text-reveal.ts` (listing).

App side: `packages/app/src/timeline/` (`session-stream-reducers.ts`, `timeline-sync-plan.ts`, `timeline-fetch-policy.ts`, `viewed-timeline-sync.ts`), `packages/app/src/agent-stream/` (`view.tsx`, `strategy-web.tsx` / `strategy-native.tsx`, `web-virtualization.ts`, `history-window.ts`, `chat-find/`, `chat-outline/`), `components/message.tsx`, `tool-calls/presentation.ts` (listing for all but `view.tsx` reference).

### 3.5 Permissions and modes

```ts
export type AgentPermissionRequestKind = "tool" | "plan" | "question" | "mode" | "other";

export interface AgentPermissionRequest {
  id: string;
  provider: AgentProvider;
  name: string;
  kind: AgentPermissionRequestKind;
  title?: string;
  description?: string;
  input?: AgentMetadata;
  detail?: ToolCallDetail;
  suggestions?: AgentPermissionUpdate[];
  actions?: AgentPermissionAction[];   // { id, label, behavior: "allow" | "deny", variant?, intent? }
  metadata?: AgentMetadata;
}

export type AgentPermissionResponse =
  | { behavior: "allow"; selectedActionId?: string; updatedInput?: AgentMetadata; updatedPermissions?: AgentPermissionUpdate[] }
  | { behavior: "deny"; selectedActionId?: string; message?: string; interrupt?: boolean };
```

Wire: daemon -> `agent_permission_request { agentId, request }`; client -> `agent_permission_response { agentId, requestId, response }`; daemon -> `agent_permission_resolved { agentId, requestId, resolution }` to all clients (so any device can answer and the others clear). Pending requests are also in `AgentSnapshot.pendingPermissions`.

UI: permission cards are rendered inside the stream (`agent-stream/view.tsx`, wired through `contexts/session-context.tsx`); `components/plan-card.tsx` (plan approval), `components/question-form-card.tsx` (ask-user questions). CLI: `jagentdesk permit allow/deny/ls`.

Modes are provider-specific (`provider-manifest.ts`): Claude `plan` / `default` ("Always Ask") / `acceptEdits` / `auto` / `bypassPermissions`; Codex `auto` ("Default Permissions") / `auto-review` / `full-access`; Copilot ACP `#agent` / `#plan` / `allow-all`; OpenCode `build` / `plan`; OMP `full` / `write` / `ask`; ACP providers report modes at runtime. `AgentMode { id, label, description?, icon?, colorTier?, isUnattended? }`. Composer controls: `packages/app/src/composer/agent-controls/` (`mode-control.tsx`, `model-sheet.tsx`, `skills-control.tsx`, `session-share-control.tsx`, `autonomous-control.tsx`, `team-mode-control.tsx`).

### 3.6 Attachments

`AgentAttachmentSchema` (`:1242`) is a discriminated union: forge change request, forge issue, GitHub PR, GitHub issue, text, review (diff comments), uploaded file. Images go separately as `images: ImageAttachment[]`. Provider input blocks: `{ type: "text" } | { type: "image"; data; mimeType } | AgentAttachment`. App: `packages/app/src/composer/` (`index.tsx`, `input/`, `attachments/`, `draft/`, `submission/`, `clipboard-image.ts`) and `packages/app/src/attachments/` (local file store, GC retention, drag sources, native/web splits). Upload/download use the binary file-transfer frames. `docs/architecture.md` rule: composer internals stay in `composer/`.

### 3.7 Voice

- **Dictation (STT into the composer)**: client streams PCM chunks `dictation_stream_start { dictationId, format }` -> `dictation_stream_chunk { dictationId, seq, audio(base64), format }` -> `dictation_stream_finish { dictationId, finalSeq }`; daemon answers with ack / partial / final / error messages. App: `dictation/dictation-stream-sender.ts`, `components/dictation-controls.tsx`, `hooks/use-audio-recorder.{web,native}.ts`.
- **Voice mode (realtime conversation)**: `set_voice_mode { enabled, agentId? }`, `voice_audio_chunk { audio, format, isLast }`, outbound `audio_output`, `transcription_result`, `assistant_chunk`. A hidden agent session of a configured provider does the reasoning; tools reach it via an MCP stdio bridge (`public-docs/voice.md`). App: `voice/voice-runtime.ts`, `voice/audio-engine.{web,native}.ts`, `components/realtime-voice-overlay.tsx`, native `packages/expo-two-way-audio`.
- **Speech providers** (`packages/server/src/server/speech/providers/`): `local` (sherpa-onnx; defaults `parakeet-tdt-0.6b-v2-int8` STT, `kokoro-en-v0_19` TTS, Silero VAD; models downloaded to `$JAGENTDESK_HOME/models/local-speech`) and `openai`. Config schema in 4.3.

### 3.8 Other agent surfaces

Chat rooms (`server/chat/`, CLI `jagentdesk chat ...`), agent forum (`server/agent-forum/`, app `screens/agent-forum-*.tsx`), loops (`server/loop-service.ts`), provider subagents (`agent/provider-subagents/`, app `panels/provider-subagent-panel.tsx`), rewind (`agent/rewind/`), session import (`import-sessions.ts`), structured generation for titles/commit messages (`structured-generation-providers.ts`). All (listing) except where quoted above.

### 3.9 How the app talks to agents

`HostRuntimeController` (`packages/app/src/runtime/host-runtime.ts`) owns one `DaemonClient` per saved host -> `SessionProvider` (`contexts/session-context.tsx`, mounted per host in `app/_layout.tsx:283`) wires client events into the Zustand `stores/session-store.ts` -> components select via `stores/session-store-hooks`. Requests go through typed methods on `DaemonClient` which validate with the protocol schemas and correlate by `requestId`. `runtime/replica-cache` paints the last focused agent from AsyncStorage before the socket is up (non-authoritative, 1 MiB budget).

---

## 4. "ORC" and provider / profile / model configuration

### 4.1 What "ORC" is in this repo

Two different things carry the name:

- **`orc/` folder** — not product code. It contains only `orc/k8s/`: story briefs (`story-*.md`), a parity matrix, and probe/verify/screenshot scripts (`audit-kube.ts`, `e2e-daemon-rpc.ts`, `shot-*.ts`, `verify-k8s-e2e.sh`) from an orchestrated build of the Kubernetes feature. It is a working directory of the owner's orchestration process.
- **Orchestration feature** — the product's Supervisor/Lead/Peer control plane with **per-role provider/model profiles**. This is what a spec saying "ORC config like JAgentDesk" should mirror. Code: `packages/protocol/src/orchestration.ts`, `packages/server/src/server/orchestration/{runtime,task-brief}.ts`, app `screens/settings/orchestration-page.tsx`, `screens/workspace/orchestration-workspace-panel.tsx`, `orchestration-agents-column.tsx`, `hooks/use-orchestration.ts`, `orchestration/start-objective.ts`. Doc: `docs/orchestration.md` (Vietnamese), `public-docs/orchestration*.md` (not read).

Flow (`docs/orchestration.md`): human request -> `orchestration.task.prepare.request` -> Task Brief (`ready` or `needs_clarification`) -> one Supervisor -> `orchestration.bootstrap_lead` -> exactly one Lead -> `orchestration.create_peer` per bounded assignment -> Peer `orchestration.handback` -> Lead `resolve_dissent` / `accept_result` -> Supervisor reports. Role-scoped tools: Supervisor only `bootstrap_lead`; Lead `create_peer`, `resolve_dissent`, `accept_result`; Peer only `handback`. Generic `create_agent` is refused for callers inside an orchestration run. Runtime state: `$JAGENTDESK_HOME/orchestration/runtime.json`. Agents are traced by labels `jagentdesk.orchestration.{role,workspace-id,brief-id,route,profile-id}`.

### 4.2 Orchestration config schema (stored at `config.json` -> `daemon.orchestration`)

```ts
export const BUILTIN_ORCHESTRATION_ROLES = ["supervisor", "lead", "peer"] as const;

export const OrchestrationRouteCategorySchema = z.enum([
  "planning", "impl", "impl_deep", "search", "research", "audit", "ui",
]);

export const OrchestrationProfileSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).optional(),
  provider: z.string().min(1),
  model: z.string().min(1),
  thinkingOptionId: z.string().min(1),
  modeId: z.string().min(1).optional(),
  enabled: z.boolean().default(true),
});

export const OrchestrationRoleConfigSchema = z.object({
  enabled: z.boolean().default(true),
  label: z.string().min(1).optional(),
  instructions: z.string().optional(),
  profiles: z.array(OrchestrationProfileSchema).min(1),
  defaultProfileId: z.string().min(1),
});

export const OrchestrationRouteTargetSchema = z.object({
  role: OrchestrationRoleSchema,
  profileId: z.string().min(1),
  /** Optional per-route override, for example search uses Luna Low. */
  thinkingOptionId: z.string().min(1).optional(),
});

export const OrchestrationRouteSchema = z.object({
  primary: OrchestrationRouteTargetSchema,
  fallbacks: z.array(OrchestrationRouteTargetSchema).default([]),
  guardProviderPrefix: z.string().min(1).optional(),
  instructions: z.string().optional(),
});

export const OrchestrationConfigSchema = z.object({
  enabled: z.boolean().default(true),
  autoPrepareBrief: z.boolean().default(true),
  askWhenAmbiguous: z.boolean().default(true),
  limits: z.object({ maxPeersPerLead: z.number().int().min(1).max(12).default(3) }).default({ maxPeersPerLead: 3 }),
  roles: z.object({
      supervisor: OrchestrationRoleConfigSchema,
      lead: OrchestrationRoleConfigSchema,
      peer: OrchestrationRoleConfigSchema,
    }).catchall(OrchestrationRoleConfigSchema),      // custom roles allowed
  routes: z.object({ planning: OrchestrationRouteSchema, impl: ..., impl_deep: ..., search: ..., research: ..., audit: ..., ui: ... }),
});
```

So: **role -> list of profiles (provider + model + thinking option + optional mode) with a default**, and **semantic route -> primary target + ordered fallbacks**. Updates use `OrchestrationConfigPatchSchema` (all-optional, plus `removeRoleIds`). Defaults (`createDefaultOrchestrationConfig`): supervisor and lead default to a Codex profile; peer profiles are an OpenCode/DeepSeek profile, a Codex profile and a `gemini-ui` profile; e.g. `impl` -> `peer-deepseek-flash` with fallback `peer-codex-luna`, `search` -> `peer-codex-luna` with `thinkingOptionId: "low"`.

Task brief and handback:

```ts
export const OrchestrationTaskBriefSchema = z.object({
  id: z.string().min(1),
  rawRequest: z.string(),
  objective: z.string().min(1),
  context: z.string().optional(),
  constraints: z.array(z.string()),
  acceptedDecisions: z.array(z.string()),
  requestedOutcome: z.string().min(1),
  acceptanceCriteria: z.array(z.string()).min(1),
  validationPlan: z.array(z.string()).min(1),
  openQuestions: z.array(z.string()),
  routeCategory: OrchestrationRouteCategorySchema,
  selectedRoute: OrchestrationRouteTargetSchema,
  normalizedPrompt: z.string().min(1),
  status: OrchestrationTaskStatusSchema,          // "ready" | "needs_clarification"
  createdAtMs: z.number().int().nonnegative(),
});

export const OrchestrationHandbackSchema = z.object({
  whatChangedOrInspected: z.string().trim().min(1).max(12000),
  evidence: z.string().trim().min(1).max(12000),
  remainingUncertainty: z.string().trim().min(1).max(12000),
  counterevidence: z.string().trim().min(1).max(12000),
  requestedResolution: ..., currentDirection: ..., claim: ..., risk: ...   // optional
});
// dissent outcomes: "RESOLVED_BY_LEAD" | "NEEDS_MORE_EVIDENCE" | "ESCALATED_TO_HUMAN"
```

RPCs: `orchestration.config.get.request/response`, `orchestration.config.update.request/response { config }`, `orchestration.task.prepare.request { rawRequest, workspaceId?, cwd?, routeCategory? }` -> `{ brief }`.

UI (`docs/orchestration.md`): Host settings -> Orchestration (toggle feature, automatic brief, ask-when-ambiguous, fan-out limit, add several profiles per role, pick default, set each route's primary) = `screens/settings/orchestration-page.tsx`; Workspace -> Orchestration panel (enter request, see brief/status/route/acceptance, send to Supervisor, watch agents by role) = `screens/workspace/orchestration-workspace-panel.tsx`.

### 4.3 Provider / model configuration (`$JAGENTDESK_HOME/config.json`)

Schema: `PersistedConfigSchema` in `packages/server/src/server/persisted-config.ts:228` (strict objects). Relevant branches:

```ts
// agents.providers — packages/protocol/src/provider-config.ts
export const ProviderProfileModelSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  isDefault: z.boolean().optional(),
  thinkingOptions: z.array(ProviderProfileThinkingOptionSchema).optional(),  // { id, label, description?, isDefault? }
});

export const ProviderOverrideSchema = z.object({
  extends: z.string().optional(),            // builtin id or "acp"
  label: z.string().optional(),
  description: z.string().optional(),
  command: z.array(z.string().min(1)).min(1).optional(),
  env: z.record(z.string(), z.string()).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  models: z.array(ProviderProfileModelSchema).optional(),
  additionalModels: z.array(ProviderProfileModelSchema).optional(),
  disallowedTools: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  order: z.number().optional(),
});
// ProviderOverridesSchema = record(providerId -> ProviderOverride) with rules:
// id matches /^[a-z][a-z0-9-]*$/; custom ids must declare `extends` and `label`;
// `extends` in ["claude","codex","copilot","opencode","pi","omp","acp"]; `extends: "acp"` requires `command`.

// agents.metadataGeneration — which provider/model writes titles, branch names, commit messages
const StructuredGenerationProviderConfigSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1).optional(),
  thinkingOptionId: z.string().min(1).optional(),
}).strict();

// features — per-feature model selection
const FeatureDictationSchema = z.object({ enabled, stt: { provider: "openai"|"local", model, language, confidenceThreshold } }).strict();
const FeatureVoiceModeSchema = z.object({
  enabled,
  llm: { provider: z.string().optional(), model },
  stt: { provider, model, language },
  turnDetection: { provider },
  tts: { provider, model, voice: "alloy"|"echo"|"fable"|"onyx"|"nova"|"shimmer", speakerId, speed },
}).strict();

// providers — speech backends only
const ProvidersSchema = z.object({
  openai: { apiKey?, baseUrl?, stt?: { apiKey?, baseUrl? }, tts?: { apiKey?, baseUrl? } },
  local: { modelsDir? },
}).strict();
```

Top-level config keys: `version: 1`, `daemon { listen, hostnames, trustedProxies, mcp { enabled, injectIntoAgents }, browserTools, autorun, sessionSharing, git, autoArchiveAfterMerge, appendSystemPrompt, operatorContext, terminalProfiles, orchestration, cors, serviceProxy, auth }`, `app { baseUrl }`, `tailnet { host, stateDir, hostname }`, `providers`, `pluginsEnabled`, `plugins`, `worktrees`, `agents { providers, metadataGeneration }`, `features { dictation, voiceMode, webUi }`, `log`.

"Profile" in the provider sense = a custom provider id that `extends` a builtin with its own `env`/`models` (`docs/custom-providers.md`: Z.AI, Alibaba/Qwen, custom OpenAI-compatible Codex endpoint, multiple profiles for one provider, custom binary, disabling a provider, ACP providers). API keys for such profiles live in `env` inside `config.json` in plaintext.

Model discovery: each provider's `fetchCatalog()` returns `{ models, modes, defaultModeId }`; the registry merges config overrides; clients read it via `get_providers_snapshot_request { cwd? }` -> `entries: ProviderSnapshotEntry[]` (`{ provider, status: "ready"|"loading"|"error"|"unavailable", enabled, source: "builtin"|"custom", models, modes, label, defaultModeId, error }`), pushed updates `providers_snapshot_update`, `refresh_providers_snapshot_request`, `provider_diagnostic_request`, `provider.usage.list.request`. `AgentModelDefinition { provider, id, label, isDefault?, contextWindowMaxTokens?, thinkingOptions?, defaultThinkingOptionId?, aliases?, isSelectable? }`.

Per-agent selection: `AgentSessionConfig.{provider, model, thinkingOptionId, modeId, featureValues}` at create; later `set_agent_model_request`, `set_agent_mode_request`, thinking option and feature setters.

Project-level config: `jagentdesk.json` at a repo root (`packages/protocol/src/jagentdesk-config-schema.ts`): `worktree { setup, teardown, terminals, servicePorts }`, `scripts { <name>: { type, command, port } }`, `metadataGeneration { title|branchName|commitMessage|pullRequest: { instructions } }`.

UI: `screens/settings/providers-section.tsx` + `components/provider-settings-host.tsx`, `provider-catalog-list.tsx`, `provider-diagnostic-sheet.tsx`, `stores/provider-settings-store.ts`; model picking `components/combined-model-selector.tsx`, `components/model-browser.tsx`, `composer/agent-controls/model-sheet.tsx`; defaults `create-agent-preferences/`, `provider-selection/`; usage `provider-usage/` (all listing — component internals not read).

---

## 5. App UI structure

### 5.1 Navigation (Expo Router, `packages/app/src/app/`)

| Route file | Purpose (from name / `_layout.tsx` registration) |
| --- | --- |
| `_layout.tsx` (1,2xx lines) | Root providers + `Stack` |
| `index.tsx` | Startup routing / restore |
| `welcome.tsx` | Onboarding |
| `pair-start.tsx`, `pair-scan.tsx`, `pair-link.tsx`, `pair-verify.tsx`, `tailscale-login.tsx` | Pairing flow (section 2) |
| `new.tsx`, `open-project.tsx` | New workspace / open project |
| `sessions.tsx`, `shared-sessions.tsx`, `share.tsx` | Session list, shares, guest share screen |
| `schedules.tsx`, `agent-forum.tsx` | Schedules, forum |
| `settings/index.tsx`, `settings/[section].tsx` | App settings |
| `settings/hosts/[serverId]/index.tsx`, `/[hostSection].tsx`, `/projects/index.tsx`, `/projects/[projectId].tsx`, `/plugins/[pluginId]/[screenId].tsx` | Per-host settings |
| `h/[serverId]/_layout.tsx`, `index.tsx` | Host-scoped shell |
| `h/[serverId]/workspace/[workspaceId]/index.tsx` | **Main workspace screen** |
| `h/[serverId]/agent/[agentId].tsx` | Agent deep link |
| `h/[serverId]/{sessions,settings,skills,marketplace,insights,forge,docker,proxy,simulator,clusters,databases,open-project}.tsx`, `cluster/[clusterId].tsx`, `database/[databaseId].tsx` | Host tools |
| `h/[serverId]/plugin/[pluginId]/...` | Plugin-contributed screens |

Everything is host-scoped by `serverId`; `workspaceId` is an opaque id. `Stack.Protected` gates the non-pairing screens (`_layout.tsx:1061`). Rules for route ownership and startup restore: `docs/expo-router.md` (doc, not read; `CLAUDE.md` requires reading it before touching routing).

Provider nesting, outermost first (from `_layout.tsx:1153-1225`): `GestureHandlerRootView` -> `RootProviders` (`WindowChromeProvider` -> `KeyboardProvider` -> `KeyboardShiftProvider` -> `PortalProvider` -> `BottomSheetModalProvider`) -> `RuntimeProviders` (`HostRuntimeBootstrapProvider` -> `SidebarCalloutProvider` -> `ToastProvider`) -> `MobilePanelsProvider` -> `HorizontalScrollProvider` -> `VoiceProvider` -> `SidebarModelProvider` -> `CommandCenterProvider` -> per-host `SessionProvider`. Exact order between the middle layers is approximate (read from grep line order, not the full file) — **UNVERIFIED** in detail.

### 5.2 Screens (`packages/app/src/screens/`)

`workspace/workspace-screen.tsx` (tabs, panes, splits), `new-workspace-screen.tsx`, `open-project-screen.tsx`, `projects-screen.tsx`, `project-settings-screen.tsx`, `sessions-screen.tsx`, `shared-sessions-screen.tsx`, `share/guest-share-screen.tsx`, `schedules-screen.tsx`, `skills-screen.tsx`, `settings-screen.tsx`, `insights-screen.tsx`, `agent-forum-screen.tsx`, `forge-hub-screen.tsx`, `docker-screen.tsx`, `clusters-screen.tsx`, `cluster-workloads-screen.tsx`, `databases-screen.tsx`, `database-browse-screen.tsx`, `proxy-screen.tsx`, `sim-fleet-screen.tsx`, `startup-splash-screen.tsx`.

Settings sections (`screens/settings/`): `appearance/`, `host-page.tsx`, `host-tools-page.tsx`, `host-appearance-section.tsx`, `providers-section.tsx`, `orchestration-page.tsx`, `plugins-page.tsx`, `keyboard-shortcuts-section.tsx`, `editor-section.tsx`, `browser-tools-card.tsx`, `browser-fingerprint-profiles-card.tsx`, `autorun-card.tsx`, `session-share-card.tsx`, `session-shares-card.tsx`, `terminal-profile-edit-modal.tsx`; shared structure `settings-section.tsx`, `settings-group.tsx`, `styles/settings.ts`.

Panels inside a workspace (`packages/app/src/panels/`, registered in `register-panels.ts` / `panel-registry.ts`): `agent-panel`, `draft-panel`, `diff-panel`, `file-panel`, `terminal-panel`, `setup-panel`, `provider-subagent-panel`, `changes/`, `pull-request/`.

### 5.3 Desktop vs mobile vs web layout

Breakpoints (`styles/unistyles.ts`): `xs: 0, sm: 576, md: 720, lg: 992, xl: 1200`.

```ts
// packages/app/src/constants/layout.ts
export const HEADER_INNER_HEIGHT = 48;
export const HEADER_INNER_HEIGHT_MOBILE = 56;
export const WORKSPACE_SECONDARY_HEADER_HEIGHT = 36;
export const MAX_CONTENT_WIDTH = 820;
export const SETTINGS_DESKTOP_SIDEBAR_WIDTH = 320;
export const SETTINGS_DESKTOP_DETAIL_MIN_WIDTH = 400;
export const DESKTOP_TRAFFIC_LIGHT_WIDTH = 78;
export const DESKTOP_WINDOW_CONTROLS_WIDTH = 140;

export function useIsCompactFormFactor(): boolean {
  const { rt } = useUnistyles();
  return rt.breakpoint === "xs" || rt.breakpoint === "sm";
}

// SplitContainer relies on dnd-kit and DOM-backed accessibility helpers.
export function supportsDesktopPaneSplits(): boolean {
  return isWeb;
}
```

- **Compact (< 720 px)**: three mutually exclusive destinations — `agent-list` (left), `agent` (center), `file-explorer` (right) — one gesture-driven interaction, not two drawers (`docs/mobile-panels.md`, `packages/app/src/mobile-panels/`): `interface MobilePanelSelection { target: "agent-list" | "agent" | "file-explorer"; revision: number; }`; not persisted; a UI worklet owns motion.
- **Desktop width**: pinned left sidebar (`components/left-sidebar.tsx`, `components/sidebar/`), center workspace with a tab row (`workspace-desktop-tabs-row.tsx`) and split panes (web only), right explorer sidebar (`components/explorer-sidebar.tsx`: files / git diff / PR). Layout state in `stores/workspace-layout-store.ts` and `stores/panel-store` (Zustand `persist` -> AsyncStorage).
- **Electron**: same web bundle built with `JAGENTDESK_WEB_PLATFORM=electron`; `.electron.tsx` overrides; custom titlebar regions (traffic-light / window-control insets), `WindowChromeProvider`, multi-window, `<webview>` in-app browser, native menus (`packages/desktop/src/features/menu.ts`), IPC via `preload.ts` and `app/src/desktop/electron/invoke`.
- Gating rules: `CLAUDE.md` "Platform gating" (`isWeb`, `isNative`, `getIsElectron()`, `useIsCompactFormFactor()`; prefer `.web.ts` / `.native.ts` / `.electron.ts` files over runtime branches).

### 5.4 Theming and tokens (`packages/app/src/styles/theme.ts`, 1,112 lines)

```ts
export type ThemeName = "light" | "dark" | "zinc" | "midnight" | "claude" | "ghostty" | "pureBlack" | "clickup" | "clickupDark";
export const DEFAULT_THEME: ThemeName = "clickup";

export const SPACING = { 0: 0, 1: 4, 1.5: 6, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32, 12: 48, 16: 64, 20: 80, 24: 96, 32: 128 } as const;
export const FONT_SIZE = { xs: 12, code: 12, sm: 14, base: 16, lg: 18, xl: 20, "2xl": 22, "3xl": 26, "4xl": 34 } as const;
export const ICON_SIZE = { xs: 12, sm: 14, md: 16, lg: 20 } as const;
export const FONT_WEIGHT = { normal: "normal", medium: "500", semibold: "600", bold: "bold" } as const;
export const BORDER_RADIUS = { none: 0, sm: 2, base: 4, md: 6, lg: 8, xl: 12, "2xl": 16, full: 9999 } as const;
export const BORDER_WIDTH = { 0: 0, 1: 1, 2: 2 } as const;
```

Semantic color keys (light values): `surface0 #ffffff`, `surface1 #fafafa`, `surface2 #f4f4f5`, `surface3 #e4e4e7`, `surface4 #d4d4d8`, `surfaceSidebar #f4f4f5`, `surfaceWorkspace #ffffff`, `foreground #1a1a1e`, `foregroundMuted #71717a`, `foregroundExtraMuted #a1a1aa`, `border #e4e4e7`, `borderAccent #ececf1`, `accent #20744A`, `accentBright #239956`, `accentForeground #ffffff`, `destructive #b04138`, `success #20744A`, plus diff, status and terminal ANSI groups and a `chrome` group for the ClickUp shell (`CLICKUP_VIOLET = "#6149e7"`). Dark variants are built by `buildDarkSemanticColors`. Unistyles registers 9 themes + two plugin slots (`pluginLight`, `pluginDark`), `adaptiveThemes: true`. Theme usage: `StyleSheet.create((theme) => ({ ... theme.colors.surface0, theme.spacing[4], theme.fontSize.base, theme.borderRadius.lg }))`.

Rules:
- `docs/unistyles.md`: **`useUnistyles()` is banned in new code** (re-renders on every runtime change); use `StyleSheet.create((theme) => ...)`, static constants, or `withUnistyles(Component)`. (Existing `useIsCompactFormFactor` still calls it.)
- `docs/design.md`: hierarchy by weight and color, not size; one accent CTA per surface; `<Button>` variants `default | secondary | outline | ghost | destructive`, sizes `xs` 28 px / `sm` 32 px / `md`,`lg` 44 px shared with `<SegmentedControl>` via `control-geometry.ts`; destructive color only inside the confirm dialog; cards group rows with one border; a `<Pressable>` wrapping `<Text>` as a button is forbidden.
- `docs/themes.md`: default ClickUp theme; only `auto` follows system appearance; plugin themes write into the reserved slots.

### 5.5 Component library

No third-party UI kit. Primitives in `packages/app/src/components/ui/`: `button`, `alert`, `switch`, `segmented-control`, `select-field`, `form-field`, `text-input/`, `combobox` (+ trigger/options/keyboard), `autocomplete`, `dropdown-menu`, `context-menu`, `menu/` (engine: anchor, geometry, navigation, item), `floating`, `floating-panel-portal`, `tooltip`, `status-badge`, `skeleton`, `loading-spinner`, `scroll-view`, `scrollable-code-surface`, `shortcut`, `external-link`, `isolated-bottom-sheet-modal/`. Headers in `components/headers/` (`screen-header`, `screen-title`, `back-header`, `page-header`, `menu-header`). Modal pattern `components/adaptive-modal-sheet.tsx` (sheet on compact, modal on desktop), `utils/confirm-dialog.ts`. Icons: `lucide-react-native`; file icons from the Material icon theme (`docs/file-icons.md`). Forms: non-React form model + form kit, schedule form is the golden example (`docs/forms.md`, doc not read). Hover and floating-panel patterns: `docs/hover.md`, `docs/floating-panels.md` (docs not read).

### 5.6 State

Zustand stores in `packages/app/src/stores/`: `session-store` (agents/timelines per host), `panel-store`, `workspace-layout-store`, `draft-store/`, `navigation-active-workspace-store/`, `sidebar-*-store`, `keyboard-shortcuts-store`, `provider-settings-store`, `skills-store`, `download-store`, `create-flow-store`, `workspace-setup-store`, `pair-device-modal-store`, plus per-tool chat stores. Server-derived request data uses TanStack Query (git status/diff keys in `git/query-keys.ts`). Persistence = AsyncStorage (`@jagentdesk:*` keys); no secure-store usage found for app secrets (the direct-connection `password` is stored in the AsyncStorage host registry).

---

## 6. Other reusable subsystems

| Subsystem | Code | Storage / schema | Notes |
| --- | --- | --- | --- |
| **Projects / workspaces / worktrees** | `server/src/server/{project-directory-service,jagentdesk-worktree-service,workspace-git-service}.ts`, app `workspace/`, `projects/`, `add-project-flow/` | `$JAGENTDESK_HOME/projects/{projects,workspaces}.json`; ids `prj_<16 hex>`; `docs/data-model.md` | Workspace = `cwd` + optional backing `worktreeRoot`; `jagentdesk.json` `worktree.setup/teardown` run on create/archive. |
| **Schedules** | `protocol/src/schedule/{types,rpc-schemas,cadence,cron-expression}.ts`, `server/src/server/schedule/{service,store,cron}.ts`, app `screens/schedules-screen.tsx`, `schedules/` | `$JAGENTDESK_HOME/schedules/` | Schema below. CLI `jagentdesk schedule ...`; heartbeats and loops are siblings (`loop-service.ts`, `$JAGENTDESK_HOME/loops/`). |
| **Skills** | `protocol/src/native-skills.ts`, `server/src/server/skills-native/`, app `screens/skills-screen.tsx`, `skills/`; bundled `skills/` (`jagentdesk`, `-advisor`, `-committee`, `-handoff`, `-loop`) | Standard `<name>/SKILL.md` folders in provider dirs (`.agents/skills`, `.claude/skills`, ...) | Not prompt-injected: installed where each provider CLI looks; sources: directory, GitHub tree, npm, provider marketplace (`docs/skills.md`). |
| **Plugins** | SDK `packages/plugin` (`/client`, `/client/ui`, `/client/react-native`, `/client/host`, `/server`, `/server/provider`, `/server/acp`), daemon `server/src/server/plugins`, app `plugins/`; 14 examples in `plugin-examples/` | `config.json` `plugins`, `pluginsEnabled`; settings in `$JAGENTDESK_HOME/plugin-settings` | Split client/server entries (`index.client.tsx`, `index.server.ts`); contributes themes, buttons, timeline items, providers, settings screens, routes (`docs/plugins.md`, `public-docs/plugins/`). |
| **MCP server / tool catalog** | `server/src/server/agent/tools/{jagentdesk-tools,forum-tools,types}.ts`, adapter `agent/mcp-server.ts` | HTTP route `/mcp/agents` (random per run, injected into agents); `daemon.mcp { enabled, injectIntoAgents }` | Transport-neutral catalog; native-tool providers get it directly, others via MCP. Tool families visible on a running daemon: agents (`create_agent`, `send_agent_prompt`, `list_agents`, `respond_to_permission`, `set_agent_mode`), workspaces, terminals, schedules/heartbeats, skills, browser automation (`browser_*`), simulators (`sim_*`), docker, kubectl, SQL, forge, forum, proxy. |
| **Notifications** | `server/src/server/push/{push-service,token-store,notifications}.ts`, `protocol/src/agent-attention-notification.ts`, `server/src/server/agent-attention-policy.ts`, app `data/push-router.ts`, desktop `features/notifications.ts` | `$JAGENTDESK_HOME/push-tokens.json` | Expo Push Service (`https://exp.host/--/api/v2/push/send`, batches of 100, invalid tokens removed). `PushPayload { title, body, data? }`. Routing uses client heartbeats (focused agent / visibility). |
| **Settings** | daemon `persisted-config.ts`, `daemon-config-store.ts`; app `screens/settings/*`; desktop `packages/desktop/src/settings/desktop-settings.ts`, `window-state.ts` | `config.json` (daemon), AsyncStorage (app), desktop settings file | Daemon config is mutable over RPC and has a generated JSON schema (`generate:config-schema`). |
| **i18n** | `packages/app/src/i18n/{init,locales,provider,sync-language}.ts`, `resources/*.ts` | Setting `"system" | <locale>` | i18next + react-i18next. Code has 9 locales (`ar, en, es, fr, ja, pt-BR, ru, vi, zh-CN`); `docs/i18n.md` lists 8 (no `vi`). Keys grouped by product surface; parity test `resources.test.ts`. Do not translate agent/daemon output. |
| **Updates / version drift** | protocol-compat rules (2.15), `server_info.features`, `daemon-version.ts` | — | App and daemon ship separately; capability gating, not version checks. Desktop app self-update: not found (1.3). |
| **Logging / diagnostics** | `server/src/server/logger.ts` (pino), app `diagnostics/{app,desktop}-diagnostic-report.ts`, desktop `diagnostics/app-logs.ts`, RPC `diagnostics.request` | `$JAGENTDESK_HOME/daemon.log`; `log { console {level, format}, file { level, path, rotate { maxSize, maxFiles } } }` | Levels `trace..fatal`, formats `pretty | json`. No telemetry/analytics SDK. Runtime metrics counters in the WS server and client (`daemon-client-runtime-metrics.ts`). |
| **Terminal** | `server/src/terminal/`, binary frames, app `terminal/`, `panels/terminal-panel.tsx` | — | xterm.js + node-pty; last-interacting-client-wins sizing; `docs/terminal-performance.md`. |
| **Files / git / forge** | `server/src/server/{file-explorer,file-download,file-upload,checkout,workspace-git-service}`, app `file-explorer/`, `git/`, `review/` | — | Viewing files and diffs; `openspec/config.yaml` states "NO in-app editor" as a product delta, though `messages.file-editing.test.ts` and `file.entry.*` RPCs exist (state of editing **UNVERIFIED**). |
| **Session share** | 2.14 | in-memory | Cloudflare quick tunnel + guest scopes. |
| **Service proxy** | `server/src/server/{service-proxy,script-proxy}.ts`, `docs/service-proxy.md` | `daemon.serviceProxy` | Exposes workspace scripts at URLs. |
| **Agentic browser, simulators, docker, kubernetes, databases, HTTP proxy (Burp-like), Hub** | `server/src/server/{browser-tools,simulator,docker,cluster,database,proxy,hub}`, matching app screens | — | Dev-tool surfaces; (listing). Not relevant to a video editor except as examples of host-tool pages. |
| **Security docs** | `SECURITY.md` (current), `public-docs/security.md` (stale relay model), `docs/permissions.md`, `docs/plans/active/local-requires-device-pairing.md` | — | See section 2. |

Schedule schema (`packages/protocol/src/schedule/types.ts`):

```ts
export const ScheduleCadenceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("every"), everyMs: z.number().int().positive() }),
  z.object({ type: z.literal("cron"), expression: z.string().trim().min(1), timezone: z.string().trim().min(1).optional() }),
]);

export const ScheduleTargetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("agent"), agentId: z.guid() }),
  z.object({ type: z.literal("new-agent"), config: z.object({ provider, cwd, modeId?, model?, thinkingOptionId?, archiveOnFinish?, isolation?: "local" | "worktree", ... }) }),
]);

export const StoredScheduleSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  prompt: z.string().min(1),
  cadence: ScheduleCadenceSchema,
  target: ScheduleTargetSchema,
  status: ScheduleStatusSchema,                 // "active" | "paused" | "completed"
  createdAt: z.string(), updatedAt: z.string(),
  nextRunAt: z.string().nullable(), lastRunAt: z.string().nullable(), pausedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  maxRuns: z.number().int().positive().nullable(),
  runs: z.array(ScheduleRunSchema),             // { id, scheduledFor, startedAt, endedAt, status: "running"|"succeeded"|"failed", agentId, output, error }
});
```

RPCs: `schedule.{create,list,inspect,logs,pause,resume,delete,run_once,update}` request/response pairs (`rpc-schemas.ts`; exact type strings not copied).

---

## 7. Conventions a sibling project should follow

### 7.1 Process (`CLAUDE.md`)

- `docs/` is the source of truth; skim it before non-trivial work. Doc rules: integrate rather than append, don't document logic, one fact in one doc, delete obsolete sections, plain second-person voice, banned filler words.
- Always run `npm run typecheck` and `npm run lint` after a change; `npm run format` before committing; use the npm scripts, never the tool binaries directly.
- Never run a full test suite locally; run the one file: `npx vitest run <file> --bail=1`. Full suites run in CI.
- Rebuild owning workspace packages (`npm run build:client`, `npm run build:server`) before diagnosing cross-package type errors; never duplicate types to silence stale declarations.
- Never restart the main daemon (port 6767) without permission; dev uses a checkout-local home `.dev/jagentdesk-home` on 6768.
- Never add auth checks to tests.

### 7.2 Protocol

- Backward-compatible forever, features gated once (2.15). New RPCs dotted with `.request` / `.response`. Tag every shim `// COMPAT(name): added in vX, remove after <date>`. PRs touching `packages/protocol` must state why old app/new daemon and new app/old daemon still work (`docs/protocol-compatibility.md`).
- `openspec/config.yaml`: timestamps are Unix UTC milliseconds with an `_ms` suffix (newer schemas follow it, e.g. `expiresAt_ms`; older ones use ISO strings and `...AtMs`); any security- or protocol-affecting change needs an ADR; no mock data, no placeholder names, no "done" without evidence.

### 7.3 Code (`docs/coding-standards.md`)

- Zero complexity budget, YAGNI, no drive-by cleanups; functional over OO; `function` declarations; `interface` over `type`; no re-export-only `index.ts` barrels.
- Validate at boundaries, trust types inside; every `?.` / `??` past the boundary is suspect; no "just in case" `try/catch`.
- No `any`, no `as` casts, no `@ts-ignore`; types are `z.infer` of the schema, never hand-written twins; discriminated unions over optional-field bags; object params for 3+ args or any boolean.
- Typed error classes; fail explicitly, never silently substitute; every fallible user action has pending, success and failure UI.
- No nested ternaries; max 3 nesting levels; a directory is a module; filenames ending `-utils`, `-helpers`, `-manager` are a smell.
- Comments explain why; no dividers, no commented-out code, no `TODO: implement` stubs.

### 7.4 Testing (`docs/testing.md`, `CONTRIBUTING.md`)

- TDD in vertical slices (one test, one implementation).
- Deterministic: no conditional or weak assertions (`toBeTruthy`, `toBeDefined`), no timing reliance; flaky tests are fixed, never deleted.
- Real dependencies over mocks; mocking is an explicit decision. RPC-backed UI gets a Playwright test with a real browser and daemon; failure tests assert what the user sees.
- `Alert.alert()` is a no-op on React Native Web — use rendered app UI for errors.
- Pairing/transport changes must be exercised on the desktop request UI and the mobile flow with a real Tailscale connection, with recorded evidence.
- Test layout: unit `*.test.ts` beside source; `*.e2e.test.ts`, `*.real.e2e.test.ts` (real providers), `*.local.e2e.test.ts`; app Playwright in `packages/app/e2e`, Maestro in `packages/app/maestro`, desktop Playwright in `packages/desktop/e2e`.

### 7.5 Data (`docs/data-model.md`)

File-based JSON under `$JAGENTDESK_HOME`, Zod-validated, atomic temp-file + rename, no migration framework (optional fields with defaults). Store methods own atomicity ("maps cleanly to one SQL statement or one SQL transaction").

### 7.6 Doc/code mismatches found (do not copy these)

| Doc says | Code says |
| --- | --- |
| `CLAUDE.md`, `public-docs/security.md`: relay package, NaCl box E2EE | No `packages/relay`; Tailscale + Ed25519 signed hello (section 2) |
| `CLAUDE.md`, `packages/server/CLAUDE.md`: "Format with Biome" | `oxfmt` / `oxlint` (`package.json`, `.oxfmtrc.json`) |
| `CLAUDE.md` doc table links `docs/release.md`, `docs/menus.md`, `docs/explorer-sidebar.md`, `docs/file-observation.md`, `public-docs/hub/security.md` | The first four do not exist in `docs/` (the Hub page was not checked) |
| `SECURITY.md`: "The daemon signs and verifies the pairing transcript" | Daemon only verifies a device signature over the nonce; it signs nothing |
| `tsnet-listener.ts` option comment: daemon "Public Ed25519 key" | Daemon key is X25519 (`daemon-keypair-crypto.ts`) |
| `WSChallengeMessageSchema` comment: "tailnet transport only" | Also issued on direct sockets when `JAGENTDESK_REQUIRE_LOCAL_PAIRING` is set |
| `docs/architecture.md` handshake: no `challenge`, no signed fields | Present in `messages.ts` |
| `docs/i18n.md`: 8 locales | 9 (`vi` added) |
| `docs/unistyles.md`: `useUnistyles()` banned | `useIsCompactFormFactor` uses it |
| `CLAUDE.md` gating rule "NEVER use `onPointerEnter`/`onPointerLeave`" | Same file's doc table describes `docs/hover.md` as "plain View + onPointerEnter/Leave" (internally inconsistent; hover doc not read) |
| `packages/app/src/utils/client-id.ts`: legacy and current storage keys | Both constants are the same string `@jagentdesk:client-id-v1` (rename artifact) |

The repo is a rebrand/port of an upstream project ("Paseo": `paseo-rebrand.ts`, `docs/plans/active/paseo-fix-port-v0.3.0.md`, "Upstream v0.7.2" comments); many stale docs are upstream leftovers.

---

## 8. Reuse map for a video editor (JAgentChill)

| JAgentDesk module | Reuse | What must change |
| --- | --- | --- |
| `packages/protocol` — envelope (`hello`/`challenge`/`ping`/`session`), `rpc_error`, RPC naming, `CLIENT_CAPS` + `server_info.features` gating, zod-aot validators | **Copy the skeleton** | Delete the ~300 agent/dev-tool messages; add project/timeline/asset/render messages. Keep compat rules and COMPAT tagging from day one. |
| `packages/protocol/src/connection-offer.ts`, pairing RPC schemas | **Copy** | Rename scheme; decide offer contents if not Tailscale-only (e.g. LAN address, relay URL). Consider adding expiry to the offer. |
| `server/src/server/pairing/*` (device-signature-crypto, nonce-challenge, paired-devices, pairing-code, signed-hello) | **Copy nearly verbatim** (about 450 lines, `node:crypto` only) | Add: attempt limit on the code (port `MAX_FAILED_ATTEMPTS`/lockout from session-share), drop live sockets on revoke, sign a transcript (nonce + serverId + device key) instead of the bare nonce, daemon-to-client authentication, per-device scopes. |
| `server/src/server/websocket-server.ts` connection gate (upgrade checks, pending connections, hello, resume by `clientId`, grace window, lease, 8 MiB backpressure) | **Adapt** | 3,969-line file tangled with agent features; extract the connection layer rather than copy whole. |
| `tsnet-listener.ts` + `go/tsnet-bridge`, `app/modules/jagentdesk-tailscale` (Go bridge, Swift/Kotlin wrappers), `app/src/tailscale/*` | **Copy if Tailscale is kept** | Requires users to have a tailnet. Video proxies/thumbnails over the loopback TCP proxy need throughput testing. Web has no tailnet path (2.13) — a web-first editor needs a browser key (WebCrypto Ed25519 in IndexedDB) and a non-Tailscale transport or relay. Move mobile key to Keychain/Keystore. |
| `packages/client` `DaemonClient` (connect, challenge/sign, reconnect backoff, liveness, request correlation, send queue) | **Adapt** | Strip the agent-specific methods (10k lines); keep transport, handshake, reconnect, `sendRequest`. |
| Binary frames (`binary-frames/file-transfer.ts`, `demux.ts`) | **Adapt** | Reuse for uploads/downloads; media needs range requests / chunk resume and probably an HTTP path for large files rather than WS frames. |
| App shell: Expo Router host-scoped routes, `HostRuntimeController`, `SessionProvider`, host registry, connection probing, replica cache | **Adapt** | Replace agent/workspace domain with project/timeline domain; keep host model if the editor has a render daemon. |
| Pairing UI: `pair-start/scan/link/verify.tsx`, `tailscale-login.tsx`, `desktop/components/pair-device-section.tsx`, `pairing-countdown.ts` | **Copy** | Rebrand strings; add a device list / revoke screen if missing. |
| Design system: `styles/theme.ts` tokens, `styles/unistyles.ts`, `components/ui/*`, `components/headers/*`, `adaptive-modal-sheet`, menu engine, `styles/settings.ts`, `docs/design.md` | **Copy** | Pick the brand palette; add editor-specific primitives (timeline track, scrubber, clip, inspector, transport controls) that do not exist here. |
| Layout: breakpoints, `useIsCompactFormFactor`, `mobile-panels/` (three-destination gesture model), `workspace-layout-store`, split panes, tabs | **Adapt** | Three-panel model maps to media bin / preview+timeline / inspector. Split panes are web-only (dnd-kit); timeline gestures on native need new worklet work. |
| Platform gating conventions (`.web`/`.native`/`.electron` files, `constants/platform`) | **Copy** | None. |
| `packages/desktop` (Electron main, preload sandbox, daemon supervision, multi-window, menus, window state, `electron-builder.yml`) | **Adapt** | Remove browser/webview features; add GPU/codec flags, file associations, ffmpeg or native render binaries in `extraResources`; add an auto-updater (none here). |
| Chat agent stack: `AgentClient`/`AgentSession`, `AgentManager`, timeline store + seq/epoch sync, permission flow, composer, stream view | **Copy for the assistant panel** | Tools become editor operations (cut, trim, caption, render) instead of shell/edit; `ToolCallDetail` needs editor variants; `cwd` semantics become a project directory. Providers still require CLIs installed on the daemon host — decide whether a hosted-API provider is needed for mobile/web-only users. |
| Orchestration (roles -> profiles -> routes), `OrchestrationConfigSchema`, settings page | **Copy schema + UI pattern** | Rename route categories for editing work (e.g. script, cut, captions, color, audio, review); keep `profiles[]` + `defaultProfileId` + `primary`/`fallbacks`. |
| Provider config (`ProviderOverrideSchema`, snapshot RPCs, providers settings, model picker) | **Copy** | Store secrets outside plaintext `config.json`. |
| Tool catalog + MCP adapter (`agent/tools/`, `mcp-server.ts`) | **Adapt** | Same transport-neutral pattern; new catalog of editor tools. |
| Schedules, loops | **Adapt** | Becomes render queue / batch jobs; cadence + run log schema reusable. |
| Skills, plugins | **Copy later** | Plugin SDK is large; skills are cheap (folders the provider CLIs already read). |
| Push (`push-service`, token store, attention policy) | **Copy** | Events become "render finished", "agent needs approval". |
| i18n, settings sections, diagnostics report, pino logging config | **Copy** | Add `vi` to docs; translate from the start. |
| Voice (dictation + sherpa/OpenAI speech, `expo-two-way-audio`) | **Adapt** | Local STT is directly useful for captions/transcripts, beyond dictation. |
| Session share (`session-share/*`) | **Adapt** | Becomes review links for a cut; note Cloudflare terminates TLS and files/terminal scopes are unfinished. |
| File-based JSON stores with Zod + atomic writes | **Adapt** | Fine for config/devices/schedules; a timeline with many clips and undo history probably needs SQLite or an op log. |
| Dev-tool surfaces (terminal, git/forge, docker, k8s, databases, simulators, HTTP proxy, agentic browser, Hub) | **Do not copy** | Irrelevant. |
| Tooling: npm workspaces, oxlint/oxfmt, tsgo, vitest, Playwright, Maestro, lefthook, knip, release workflow, EAS profiles | **Copy** | Add CI beyond release-on-tag (none here for PRs). |

Missing in JAgentDesk and needed by a video editor (nothing to mirror): media pipeline (decode, proxy generation, thumbnails, waveform), timeline data model and rendering engine, real-time preview, export/render, large-asset sync between devices, collaborative edit/conflict model, browser-side device keys, app auto-update.

---

## 9. UNVERIFIED and not-read list

- Whether paired devices are restricted by `DAEMON_PERMISSIONS` grants (`docs/permissions.md` model) or are all full-trust; authorization module `server/src/server/authorization` not read.
- Whether removing a host in the app revokes the device on the daemon.
- Desktop app self-update: no `electron-updater` / `autoUpdater` found; behaviour of `publish: github` at runtime unconfirmed.
- Exact nesting order of middle providers in `app/_layout.tsx`.
- Hub (`server/src/server/hub`, `jagentdesk hub login/connect`) identities and credentials — described only in `public-docs/security.md`, which is partly stale.
- Docs referenced but not read: `docs/expo-router.md`, `docs/forms.md`, `docs/hover.md`, `docs/floating-panels.md`, `docs/agent-stream-performance.md`, `docs/agent-lifecycle.md`, `docs/qa.md`, `docs/glossary.md`, `docs/protocol-validation.md`, `docs/providers.md`, `public-docs/orchestration*.md`, `public-docs/plugins/`, `public-docs/mcp.md`, `README.md` body.
- Everything marked (listing): purpose inferred from file names — includes most app component internals (permission cards, model picker, providers settings, orchestration pages), `server/orchestration/runtime.ts`, `agent-manager.ts`, `agent-storage.ts`, schedules service, plugin runtime, push routing policy, chat/forum/loops.
- Remaining `ToolCallDetail` variants beyond `shell`, `read`, `edit`; exact `schedule.*` RPC type strings; dictation/voice outbound message fields.
- `/guest` pairing-channel message shapes in session share (only server-side constants and flow comments were read).
- Whether in-app file editing is enabled (`openspec/config.yaml` says no editor; file-entry RPCs exist).
- Throughput of the mobile tsnet loopback proxy for large binary payloads (not measured anywhere I read).
- Go sources (`server/go/tsnet-bridge/main.go`, mobile `bridge.go`) were grepped, not read in full; Swift/Kotlin wrappers only grepped. Device-key file location on iOS/Android is from the Go code and module README, not from the wrappers' path setup.
