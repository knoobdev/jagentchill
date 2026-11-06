# OpenClaw plugin feasibility for JAgentChill connection security

- Source read: `.refs/openclaw` at `0816aa1b` (v2026.9.8). All paths below are relative to that clone.
- Specs checked against: `openspec/changes/build-jagentchill/specs/device-pairing-signing/spec.md`, `.../gateway-plugin-api/spec.md`, `design.md` D7.
- Method: static code reading only. Nothing was executed against a running Gateway. Items marked **needs spike** are conclusions inferred from the code path that should be confirmed with a real Gateway before the spec is frozen.
- Constraint assumed throughout: no edits to `src/`, `packages/*`, or existing bundled extensions. A new directory `extensions/jagentchill/` is treated as allowed.

## Verdict table

| # | Question | Verdict |
|---|---|---|
| 1 | Caller identity in plugin RPC | VERIFIED-YES |
| 2 | Plugin HTTP routes: public route + own signature verification | VERIFIED-YES (caller identity: none on `auth: "plugin"`) |
| 3 | Unpaired bootstrap without a secret in the offer | PARTIAL (WebSocket: NO; plugin HTTP enrolment: YES) |
| 4 | Approval and device management from the SDK | PARTIAL (list + approve + bootstrap tokens only) |
| 5 | Force-disconnect a device's sockets | PARTIAL (possible, but close code is fixed at 4001) |
| 6 | Plugin to client events | PARTIAL (only `plugin.<id>.<event>` names, operator-scope gated) |
| 7 | Connect-time hook / gate the connection | VERIFIED-NO (per-method gating is feasible) |
| 8 | Local auto-approval config | VERIFIED-YES for the key; PARTIAL for "force loopback through pairing" |
| 9 | Native device signature; Gateway proving its identity | VERIFIED-YES for device proof; VERIFIED-NO for Gateway identity proof |
| 10 | Plugin SQLite, blobs, secrets | PARTIAL (no sanctioned large-blob store; no secret vault) |
| 11 | Services, job queue, FFmpeg | PARTIAL (lifecycle yes; no host crash-restart; no sandbox) |
| 12 | Tools: per-agent restriction, approval hook, invoker identity | PARTIAL (agent/session yes; invoking device no) |

---

## 1. Caller identity in plugin RPC — VERIFIED-YES

Registration signature, `src/plugins/plugin-api.types.ts:254-263`:

```ts
registerGatewayMethod: (
  method: string,
  handler: GatewayRequestHandler,
  opts?: {
    scope?: OperatorScope;
    profileAccess?: "independent" | "required";
    sessionAccess?: GatewayMethodSessionAccess;
  },
) => void;
```

The plugin handler is wrapped but receives the real dispatch options unchanged except for `respond` (`src/plugins/registry-registrars-network.ts:39-65`, `const invoke = () => handler({ ...opts, respond })`).

Handler options, `src/gateway/server-methods/shared-types.ts:474-493, 534-553`:

```ts
export type GatewayRequestOptions = {
  req: RequestFrame;
  client: GatewayClient | null;
  respond: RespondFn;
  context: GatewayRequestContext;
  signal?: AbortSignal;
  hasCurrentClientAuthority?: () => boolean;
  ...
};
export type GatewayRequestHandlerOptions = Omit<GatewayRequestOptions, ...> & { params: Record<string, unknown>; ... };
export type GatewayRequestHandler = (opts: GatewayRequestHandlerOptions) => Promise<void> | void;
```

Caller identity, `src/gateway/server-methods/client-types.ts:41-120`:

```ts
export type GatewayClient = {
  connect: ConnectParams;          // client info, role, scopes, device {id, publicKey, signature, signedAt, nonce}
  invalidated?: boolean;
  connectionSignal?: AbortSignal;  // aborts when the transport is retired
  connId?: string;
  clientIp?: string;
  pairedClientId?: string;
  isDeviceTokenAuth?: boolean;
  internal?: { isLocalClient?: true; syntheticClient?: true; ... };
  ...
};
```

`ConnectParams` (`packages/gateway-protocol/src/schema/frames.ts:31-92`) carries `client {id, displayName, version, platform, deviceFamily, mode, instanceId}`, `role`, `scopes`, `device {id, publicKey, signature, signedAt, nonce}`, `auth`.

So a handler can read: device id (`client.connect.device?.id`), device public key, role, scopes, connection id (`client.connId`, a `randomUUID()` minted at socket open, `src/gateway/server/connection.ts:178`), client info, source IP.

The type is exported to plugins: `src/plugin-sdk/core.ts:190` and `src/plugin-sdk/gateway-runtime.ts:45` (`GatewayRequestHandlerOptions`).

Caveats that affect the spec:

- `client` can be `null`, and `client.connect.device` is optional. A device-less connection is legal (shared token from a local backend/CLI client, see section 8). The plugin must treat a missing `device` as `DEVICE_NOT_ATTESTED`.
- `scope` must be an OpenClaw `OperatorScope`. Custom scopes such as `jagentchill.projects.write` cannot be registered as the method scope. If `scope` is omitted the method defaults to `operator.admin` (`src/gateway/methods/descriptor.ts:59-76`, `scope: normalizedScope ?? ADMIN_SCOPE`).
- `client.connect.client.id` is a closed enum (`packages/gateway-protocol/src/client-info.ts:10-29`) and `ConnectParams` is a closed object. A JAgentChill client cannot send its own client id or extra connect fields; it has to present an existing id (for example `gateway-client` with mode `ui`).

## 2. Caller identity in plugin HTTP routes — VERIFIED-YES for public routes and own verification

Types, `src/plugins/plugin-registration.types.ts:48-75`:

```ts
export type OpenClawPluginHttpRouteAuth = "gateway" | "plugin";
export type OpenClawPluginHttpRouteMatch = "exact" | "prefix";
export type OpenClawPluginHttpRouteHandler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void;
export type OpenClawPluginHttpRouteUpgradeHandler = (req: IncomingMessage, socket: Duplex, head: Buffer) => Promise<boolean | void> | boolean | void;
export type OpenClawPluginHttpRouteParams = {
  path: string;
  handler: OpenClawPluginHttpRouteHandler;
  handleUpgrade?: OpenClawPluginHttpRouteUpgradeHandler;
  auth: OpenClawPluginHttpRouteAuth;
  match?: OpenClawPluginHttpRouteMatch;
  gatewayRuntimeScopeSurface?: "write-default" | "trusted-operator";
  nodeCapability?: { surface: string; ttlMs?: number };
  replaceExisting?: boolean;
};
```

Auth modes:

- `auth: "gateway"`: the Gateway authenticates first (shared token/password, trusted proxy). Enforced in `src/gateway/server/plugins-http.ts:260-264` (`plugin http route blocked without gateway auth`).
- `auth: "plugin"`: the Gateway does no authentication. Gateway auth is enforced only when a matched route is `auth: "gateway"` or the path is under a protected prefix (`src/gateway/server/plugins-http/route-auth.ts:13-17, 38-55`). The only protected prefix is `/api/channels` (`src/gateway/security-path.ts:98`). `/jagentchill/v1/*` is therefore reachable unauthenticated.

What the handler sees: the raw Node `IncomingMessage` and `ServerResponse`. Nothing about a Gateway caller is supplied for `auth: "plugin"`; the runtime scope set is empty (`src/gateway/server/plugins-http.ts:157-164`, `params.route.auth !== "gateway" ? [] : ...`). The plugin reads headers and the raw body stream itself, so hashing the body while it is received and verifying an Ed25519 signature is possible.

Registration rules to respect (`src/plugins/registry-registrars-network.ts:167-226`): `auth` is mandatory; a route that overlaps another route with a different auth mode is rejected. Mixing `auth: "plugin"` and `auth: "gateway"` under the same prefix will fail registration.

WebSocket upgrade on a plugin route is supported (`handleUpgrade`, dispatched in `src/gateway/server/plugins-http.ts:390-456`).

Not verified: whether core applies body-size limits, CORS, or Host-header checks before a plugin handler runs. Assume the plugin must implement all of `HTTP request limits and browser access` itself.

## 3. Unpaired bootstrap — PARTIAL

### What the native path really is

Setup code payload, `src/pairing/setup-code.ts:43-49`, encoded as base64url JSON (`:401-403`):

```ts
type PairingSetupPayload = {
  url: string;
  urls?: string[];
  bootstrapToken: string;
  expiresAtMs?: number;
  tlsFingerprint?: string;
};
```

- The setup code **contains a bearer secret** (`bootstrapToken`, 32 random bytes base64url, `src/infra/pairing-token.ts`).
- TTL: 10 minutes (`DEVICE_BOOTSTRAP_TOKEN_TTL_MS = 10 * 60 * 1000`, `src/infra/device-bootstrap.worker-types.ts:5`).
- On first use the token is bound to the presenting `deviceId` + public key; a different device presenting it afterwards is refused (`src/infra/device-bootstrap.worker-kernel.ts:413-441`).
- What it authorises: a bounded role/scope profile. For generic issuance the operator scopes are limited to `operator.approvals`, `operator.questions`, `operator.read`, `operator.talk.secrets`, `operator.write` (`src/shared/device-bootstrap-profile.ts:28-34`). `operator.admin` and `operator.pairing` are not grantable through a generic bootstrap token.
- The RPC `device.pair.setupCode` requires `operator.admin` (`src/gateway/methods/core-descriptors.ts:261-267`).

### Can a device with no credential reach the WebSocket? NO

In `src/gateway/server/ws-connection/connect-auth.ts`, credentials are evaluated before pairing. With `gateway.auth.mode` `token` or `password`, a connect that presents only a device signature (no shared token, no bootstrap token, no device token) ends at `:384-391`:

```ts
if (!authOk) { ... rejectUnauthorized(authResult); return undefined; }
```

which sends an error and closes with 1008 (`:217-233`). No pairing request is created. `NOT_PAIRED` (the "pairing required" outcome) is only reached after auth succeeds (`src/gateway/server/ws-connection/connect-device-pairing.ts:109-110`, `:226-239`).

Auth modes are `"none" | "token" | "password" | "trusted-proxy"` (`src/config/types.gateway.ts:51`). Only `mode: "none"` lets an unknown device reach the pairing lane without a secret, and that also opens every core method to anyone who can reach the port, so it is not an acceptable run profile.

Also: the first frame on a socket must be `connect` (`src/gateway/server/ws-connection/message-handler.ts:261-271`), and plugin methods are only dispatched after `hello-ok`. So `jagentchill.handshake.challenge` cannot be called by an unpaired device.

### Can a plugin mint a bootstrap token? YES

`openclaw/plugin-sdk/device-bootstrap` (`src/plugin-sdk/device-bootstrap.ts:4-23`) exports `issueDeviceBootstrapToken`:

```ts
export async function issueDeviceBootstrapToken(params?: {
  assertCurrent?: () => void;
  baseDir?: string;
  profile?: DeviceBootstrapProfileInput;
  roles?: readonly string[];
  scopes?: readonly string[];
}): Promise<{ token: string; expiresAtMs: number }>;
```

(`src/infra/device-bootstrap.ts:60-95`). Also `revokeDeviceBootstrapToken`, `clearDeviceBootstrapTokens`, `resolvePairingGatewayUrl`.

### Can the offer avoid a long-lived secret? YES, and it can avoid any secret, with this design

Best alternative requiring no core edits:

1. The offer stays secret-free as specified.
2. Enrolment runs entirely on the plugin's public HTTP routes (`auth: "plugin"`): challenge, transcript proof with mutual Gateway signature, six-digit code. All of that is plugin code.
3. When the code is verified, the plugin calls `issueDeviceBootstrapToken({ roles: ["operator"], scopes: [...] })` and returns the token in the `verify` response. The token is short-lived (10 min), is delivered only after the Gateway signature was verified by the device, and binds to the device key on first use.
4. The device opens the WebSocket with `auth.bootstrapToken` and the native device signature.
5. For a non-mobile, non-Control-UI client the native lane is manual: the silent bootstrap lane requires `role === "node"` with `client.mode === "node"` and a matching mobile client id, or the Control UI (`src/gateway/server/ws-connection/connect-pairing-approval-plan.ts:185-196, 260-263`; `connect-device-metadata.ts:62-74, 124-140`). So the first connect creates a pending request and is closed with `NOT_PAIRED`.
6. The plugin finds the pending request with `listDevicePairing()` and approves it with `approveDevicePairing(requestId, { callerScopes })`. The device reconnects and receives `hello-ok` with `auth.deviceToken`.

Step 5-6 is **needs spike**: there is no plugin hook for "pairing requested", so the plugin has to poll `listDevicePairing()` after issuing the token, and the reconnect-after-approval behaviour for a `gateway-client` id with a bootstrap token was not exercised.

## 4. Approval and device management from a plugin — PARTIAL

Everything `openclaw/plugin-sdk/device-bootstrap` exports (`src/plugin-sdk/device-bootstrap.ts`):

```ts
approveDevicePairing(requestId: string, baseDir?: string): Promise<ApproveDevicePairingResult>;
approveDevicePairing(requestId: string, options: DevicePairingApprovalOptions, baseDir?: string): Promise<ApproveDevicePairingResult>;
listDevicePairing(baseDir?: string)            // pending + paired records
issueDeviceBootstrapToken(params?)             // see section 3
revokeDeviceBootstrapToken(...)
clearDeviceBootstrapTokens(...)
resolvePairingGatewayUrl(...)
BOOTSTRAP_HANDOFF_OPERATOR_SCOPES, PAIRING_SETUP_BOOTSTRAP_PROFILE, normalizeDeviceBootstrapProfile
```

```ts
export type DevicePairingApprovalOptions = {
  callerScopes?: readonly string[];
  accessMetadata?: DevicePairingAccessMetadata;
  approvedVia?: "owner" | "silent" | "trusted-cidr" | "trusted-proxy" | "ssh-verified";
  isApprovalCurrent?: (state: { pending; existing }) => boolean;
  autoApproveNewDeviceScopes?: readonly string[];
};
export type ApproveDevicePairingResult =
  | { status: "approved"; requestId: string; device: PairedDevice; nodePairingGenerationChanged?: true }
  | DevicePairingForbiddenResult
  | null;
```

(`src/infra/device-pairing-approval.ts:66-79`, `src/infra/device-pairing-core.types.ts:86-114`.)

NOT exported by any `src/plugin-sdk/*` module (a grep across `src/plugin-sdk` and `src/plugins/runtime` finds only the two names above): `rejectDevicePairing`, `removePairedDevice`, `getPairedDevice`, `requestDevicePairing`, `rotateDeviceToken`, `revokeDeviceToken`, `updatePairedDeviceMetadata`. They exist in core (`src/infra/device-pairing.ts:86, 94, 113, 126`; `src/infra/device-pairing-tokens.ts:64-91`) but importing them from a plugin would break the "documented SDK only" rule.

Alternative with no core edits: call the core Gateway methods in process. They exist with scope `operator.pairing` (`src/gateway/methods/core-descriptors.ts:254-260`): `device.pair.list`, `device.pair.approve`, `device.pair.reject`, `device.pair.remove`, `device.pair.rename`, `device.token.rotate`, `device.token.revoke`. Two bridges:

- `api.runtime.gateway.request(method, params, { scopes })` (`src/plugins/runtime/types.ts:138-146`). Only for bundled or trusted-official plugins (`src/gateway/server-plugins.ts:73-97`; `src/gateway/server-plugin-subagent-runtime.ts:128-142`). A plugin living in the fork's `extensions/` tree is discovered with origin `bundled`.
- `dispatchGatewayMethod` from `openclaw/plugin-sdk/gateway-method-runtime` (`src/plugin-sdk/gateway-method-runtime.ts:24-51`). Requires manifest `contracts.gatewayMethodDispatch: ["authenticated-request"]`, runs as the calling client and still checks that client's scopes, so the calling device would need `operator.pairing`.

**Needs spike**: confirm `runtime.gateway.request("device.pair.remove", ...)` passes the device-management authorisation in `src/gateway/server-methods/devices.ts` when called with a synthetic plugin client.

## 5. Force-disconnect — PARTIAL

The request context handed to every handler includes (`src/gateway/server-methods/shared-types.ts:359-365`):

```ts
disconnectClientsForDevice?: (deviceId: string, opts?: { role?: string }) => void;
invalidateClientsForDevice?: (deviceId: string, opts?: { role?: string; reason?: string }) => void;
hasConnectedClientsForDevice?: (deviceId: string) => boolean;
```

Implementation, `src/gateway/server-request-context.ts:431-467`: `invalidateClientsForDevice` marks each matching client `invalidated = true` (buffered requests then fail authorisation); `disconnectClientsForDevice` closes each matching socket with a hard-coded close:

```ts
invalidateGatewayPolicyClient(gatewayClient, { reason: "device-removed", code: 4001, message: "device removed" });
```

So a plugin RPC handler can close a device's sockets through `opts.context.disconnectClientsForDevice?.(deviceId)`. Limits:

- The close code is always **4001** with reason `device removed`. A plugin cannot send 4403 / `DEVICE_REVOKED`, nor 4401, 4408, 4426.
- The functions are optional on the type and live on the request context, so they are only reachable inside an RPC handler. A service or an `auth: "plugin"` HTTP handler has no context.
- No bundled extension calls these today (grep of `extensions/` finds no use), so this is reading core internals through a typed but undocumented surface.

Upstream behaviour when a device is removed or a token revoked, `src/gateway/server-methods/devices.ts:413-456, 494-605`: `device.pair.remove` calls `removePairedDevice`, then `invalidateClientsForDevice(..., { reason: "device-pair-removed" })`, responds, and then `disconnectClientsForDevice(deviceId)` in a microtask. `device.token.rotate` and `device.token.revoke` do the same per role. So calling the core method (section 4) gives removal plus socket close in one step, from any plugin context, still with code 4001.

## 6. Plugin to client events — PARTIAL

There are two APIs, and both are constrained by one rule in `src/gateway/server-broadcast-scopes.ts:163-195`:

```ts
const required = EVENT_SCOPE_GUARDS[event];
const pluginScope = explicitPluginScope || (!required && event.startsWith("plugin.") ? WRITE_SCOPE : undefined);
if (pluginScope) { return role === "operator" && operatorScopeSatisfied(pluginScope, scopes); }
if (!required) { return false; }
```

An event whose name is not in the core table and does not start with `plugin.` is delivered to **nobody**. Event names like `jagentchill.job.updated` cannot be delivered.

API A, sanctioned, from a service (`src/plugins/gateway-events.ts:27-38, 55-71`; exposed as `ctx.gatewayEvents` in `OpenClawPluginServiceContext`, `src/plugins/plugin-registration.types.ts:395`):

```ts
export type OpenClawPluginGatewayEvents = {
  emit: (event: string, payload: PluginJsonValue, opts: { scope: "operator.read" | "operator.write" | "operator.admin" }) => void;
  onSessionsChanged: (handler: (event: OpenClawPluginSessionsChangedEvent) => void) => () => void;
};
```

- `event` must match `/^[a-z][a-z0-9_-]*$/` (no dots) and is sent as `plugin.<pluginId>.<event>`.
- It is a **broadcast** to every operator connection holding the scope. No targeting by connection, device or session.
- Used this way by `extensions/workboard/src/change-events.ts:38` (`gatewayEvents.emit("changed", change, { scope: "operator.read" })`).

API B, targeted, from an RPC handler (`src/gateway/server-methods/shared-types.ts:335-337`; `src/gateway/server-broadcast-types.ts`):

```ts
broadcast: (event: string, payload: unknown, opts?: GatewayBroadcastOpts) => void;
broadcastToConnIds: (event: string, payload: unknown, connIds: ReadonlySet<string>, opts?: GatewayBroadcastOpts) => void;
getClientConnIds?: (filter?: (client: GatewayClient) => boolean) => ReadonlySet<string>;
```

`broadcastToConnIds("plugin.jagentchill.job_updated", payload, connIds)` targets specific connections. Because no explicit plugin scope is passed on this path, recipients must be operator-role with `operator.write`. These functions are closures, so a handler can capture them for later use by a service; that is reliance on an undocumented surface and no bundled extension does it. **Needs spike.**

Wire format (`packages/gateway-protocol/src/schema/frames.ts:205-212`):

```json
{ "type": "event", "event": "plugin.jagentchill.job_updated", "payload": { ... }, "seq": 123 }
```

`seq` is the Gateway's own frame sequence, not a per-stream sequence; the plugin's per-stream `seq` must live inside `payload`.

Other real options:

- `api.agent.events.emitAgentEvent(...)` / `registerAgentEventSubscription(...)` for run-scoped agent events (`src/plugins/plugin-api.types.ts:161-166`).
- `context.nodeSendToSession(sessionKey, event, payload)` for node-role subscribers of a session.
- SSE or a WebSocket on a plugin HTTP route (`handleUpgrade`), authenticated by the plugin's own signature scheme. This is the only option that gives per-device targeting, custom close codes and custom event names without touching core internals.

## 7. Connect-time hooks — VERIFIED-NO

The full hook list is `src/plugins/hook-types.ts:115-158`. Gateway-related entries are only `gateway_start`, `gateway_stop`, `cron_reconciled`, `cron_changed`, `session_start`, `session_end`. There is no connect, hello, disconnect or auth hook. Internal hook families are `command | session | agent | gateway | message` with `gateway:startup` and shutdown actions only.

`registerGatewayAccessPolicy` (`src/plugins/gateway-access-policy.types.ts`) looks related but is not: it adds a requirement for authenticated **persons** (user profiles with emails / roles), receives no device or connection data, and cannot run a challenge.

Per-method gating on a plugin-held flag is feasible:

- Stable connection id: `client.connId` (UUID per socket; also returned to the client in `hello-ok.server.connId`).
- Disconnect notification: `client.connectionSignal` (`AbortSignal`, set at `src/gateway/server/connection.ts:569`); add an `abort` listener to drop the attested entry. `client.invalidated` and `context.isConnectionActive?.(connId)` are available as checks.
- The plugin keeps `Map<connId, { deviceId, attestedAt }>`, sets it in `jagentchill.handshake.prove`, and every other handler refuses with `DEVICE_NOT_ATTESTED` when the entry is missing.

What this cannot do: block core methods (`sessions.*`, `chat.*`, `agent`) on that socket. A connection that is OpenClaw-authenticated but not JAgentChill-attested can still use every core method its operator scopes allow. D9 routes chat through those core methods, so the plugin handshake does not protect chat.

## 8. Local auto-approval — key VERIFIED-YES; forcing loopback through pairing PARTIAL

Key: `gateway.nodes.pairing.autoApproveLocal`, boolean, default `true` (`src/config/zod-schema.gateway.ts:566-573`: "Silently approve trusted local device pairing and access upgrades. Set false to require explicit approval; metadata refreshes remain automatic. Default: true."). Sibling keys: `autoApproveCidrs` (default unset) and `sshVerify` (default enabled, node role only).

Effect, `src/gateway/server/ws-connection/handshake-auth-helpers.ts:77-125`: with `autoApproveLocal === false`, silent approval is refused for `not-paired`, `role-upgrade` and `scope-upgrade`; `metadata-upgrade` stays automatic for local first-party clients.

Why loopback still cannot be fully forced through device pairing at the OpenClaw layer:

- Device identity is optional. A local `gateway-client` in `backend` mode with the shared token (or `auth.mode: "none"`) skips pairing altogether (`shouldSkipLocalBackendSelfPairing`, same file `:209-231`), and device-less shared-secret connects are admitted by `evaluateMissingDeviceIdentity` (`connect-auth.ts:266-323`).
- The CLI on the host connects this way.

So the spec's scenario "process on the host connects with the shared Gateway token and no JAgentChill handshake" is real, and the defence has to be in the plugin (refuse when `client.connect.device` is absent or the connection is not attested). The `doctor` check on `autoApproveLocal` is valid as written.

## 9. Native device signature — device proof VERIFIED-YES; Gateway identity proof VERIFIED-NO

Canonical payload builder, `packages/gateway-client/src/device-auth.ts`:

```ts
// v3
["v3", deviceId, clientId, clientMode, role, scopes.join(","), String(signedAtMs), token ?? "", nonce, platform, deviceFamily].join("|")
// v2 (fallback)
["v2", deviceId, clientId, clientMode, role, scopes.join(","), String(signedAtMs), token ?? "", nonce].join("|")
```

- The signed bytes are the UTF-8 of that pipe-joined string. `platform` and `deviceFamily` are trimmed and ASCII-lowercased.
- `token` is `auth.token ?? auth.deviceToken ?? auth.bootstrapToken ?? null` (`handshake-auth-helpers.ts:249-256`), so the presented credential is bound into the signature.
- `deviceId` is the **full 64-hex SHA-256** of the raw 32-byte public key (`src/infra/device-identity.ts:90-101`).

Server checks, `src/gateway/server/ws-connection/connect-device-proof.ts:13, 58-90`:

- `deriveDeviceIdFromPublicKey(publicKey) === device.id`, else `device-id-mismatch`.
- `|now - signedAt| <= 2 min` (`DEVICE_SIGNATURE_SKEW_MS`), else `device-signature-stale`.
- `device.nonce === connectNonce`, where `connectNonce` is a `randomUUID()` generated per socket and sent in the `connect.challenge` event `{ nonce, ts, capabilities }` (`src/gateway/server/connection.ts:339-349`). Replay protection comes from the nonce being bound to one socket; there is no separate nonce cache.
- Signature verifies as v3, then v2.

Gateway proving itself: `hello-ok` (`frames.ts:94-135`) carries `server { version, buildId, bootId, connId }` and no signature or public key. A search of `src/gateway/server` and `packages/gateway-protocol/src` for a server-side signature or Gateway public key finds nothing. The only server authentication is TLS certificate pinning: the setup code may carry `tlsFingerprint` and the client transport compares the SHA-256 certificate fingerprint (`packages/gateway-client/src/websocket-transport.ts:97-121`). Over plain `ws://` there is no Gateway authentication at all.

Consequence: the mutual-authentication requirement must be implemented by the plugin (its own Ed25519 key, signature returned from a plugin HTTP route or plugin RPC). It cannot protect the native `connect` exchange, during which the device has already sent its bootstrap or device token to whoever answered.

## 10. Plugin storage — PARTIAL

Sanctioned, documented (`docs/plugins/sdk-runtime/state-and-system.md`; types at `src/plugins/runtime/types-core.ts:514-528`):

```ts
api.runtime.state.resolveStateDir(env)
api.runtime.state.openKeyedStore<T>(options): PluginStateKeyedStore<T>   // JSON values, 1 MiB each, per-namespace limits/TTL
api.runtime.state.openBlobStore<TMetadata>(options): PluginBlobStore<TMetadata>
```

Blob store fuses (`src/plugin-state/plugin-blob-store.sqlite.ts:28-30`): 100 MiB per entry, **512 MiB per plugin**, 50 000 rows per plugin, whole-buffer `Uint8Array` API (no streaming). This cannot hold a 100 GiB media store or 4 MiB resumable chunk uploads at scale.

Own SQLite tables: `openclaw/plugin-sdk/sqlite-runtime` exports `openSqliteWorkerStore`, `runSqliteWorkerStoreWrite`, `openNodeSqliteDatabase`, `runSqliteImmediateTransaction`, Kysely helpers. It is described in its own header as "Narrow SQLite schema, path, and transaction helpers for first-party runtime" and in the docs as an internal facade for bundled and official plugins. Precedent: `extensions/logbook/src/store.ts:32-45` opens `path.join(dataDir, "logbook.sqlite")` through `openSqliteWorkerStore` and keeps image files in a sibling `frames/` directory. Repo policy (`AGENTS.md`) says database access runs in worker threads, not on the Gateway main thread, and that write transactions are synchronous.

Large blobs: no sanctioned API. Plain files in a plugin-owned directory under the state dir (`ctx.stateDir` in a service, or `resolveStateDir`) is the working pattern (logbook), and `AGENTS.md` allows files for "named user artifacts, imports/exports, attachments".

`registerStorageProvider` is not plugin storage. It registers a transport for a kind of storage **location** (`src/storage/types.ts`: `putObject / getObject / statObject / listObjects / deleteObject`), consumed by core features. Not relevant to the host data store.

Secrets: there is no plugin secret vault and no OS keychain integration on the Gateway side (no match for keychain/keytar/safeStorage in `src/secrets`). Available:

- `openclaw/plugin-sdk/secret-file-runtime`: `writePrivateSecretFileAtomic`, `readSecretFileSync`, `tryReadSecretFileSync`, `PRIVATE_SECRET_DIR_MODE`, `PRIVATE_SECRET_FILE_MODE` (owner-only files, atomic write).
- `openclaw/plugin-sdk/secret-ref-runtime` and `secret-input`: SecretRef in config (`resolveSecretRefValues`, `coerceSecretRef`, `buildSecretInputSchema`), for operator-configured values resolved by core providers.

## 11. Services, job queue, FFmpeg — PARTIAL

Service contract, `src/plugins/plugin-registration.types.ts:363-440`:

```ts
export type OpenClawPluginService = {
  apiVersion?: 1;
  id: string;
  reload?: { configPrefixes: readonly string[] };
  start: (ctx: OpenClawPluginServiceContext) => void | Promise<void>;
  stop?: (ctx: OpenClawPluginServiceContext) => void | Promise<void>;
};
export type OpenClawPluginServiceContext = {
  config: OpenClawConfig;
  workspaceDir?: string;
  stateDir: string;
  logger: PluginLogger;
  serviceHealth?: { reportFailure: (error: unknown) => void; clearFailure: () => void };
  scheduler?: PluginServiceSchedulerV1;   // required in apiVersion 2
  getCron?: () => ...;
  invokeNode?: ...; openNodeDuplex?: ...;
  gatewayEvents?: OpenClawPluginGatewayEvents;
  ...
};
```

Lifecycle as implemented in `src/plugins/services.ts`:

- `start` is called at Gateway start; a throw is logged, reported to `serviceHealth`, and the service's `stop` is run for cleanup (`:658-681`). The plugin stays loaded.
- There is **no host crash-restart or backoff**. Once `start` has returned, the host does not supervise the service. The 1 s / 5 s / 30 s restart policy in the spec must be implemented inside the plugin.
- `reload.configPrefixes` restarts the service when those config paths change. Replacement stop/start is bounded by `PLUGIN_SERVICE_REPLACEMENT_STOP_TIMEOUT_MS = 5_000` (`:40`).
- `stop` runs on shutdown in reverse order. The overall Gateway shutdown budget is in `gateway-shutdown-budget.mjs`; the per-service share at shutdown was not traced.
- Restart recovery is entirely the plugin's job: nothing is persisted for a service by the host. A queue table in the plugin's SQLite plus a scan at `start` is the way.
- Suspension: no plugin hook for `gateway.suspend.prepare` was found in `hook-types.ts`, `plugin-registration.types.ts` or `services.ts`. `gateway_start` receives an `abortSignal` documented as "aborts at drain to stop producers" (`src/plugins/hook-gateway.types.ts:9-10`), and `gateway_stop` exists. The spec's "within 10 seconds of `gateway.suspend.prepare`" has no verified trigger.

External processes: native plugins run in the Gateway process with no sandbox (`docs/plugins/admin-http-rpc.md:102`: "This is not a sandbox ... trusted plugins still run in the Gateway process"). Bundled extensions import `node:child_process` directly (`extensions/facetime/src/audio-pump.ts:1`, `extensions/imessage/src/client.ts:1`). SDK helpers: `openclaw/plugin-sdk/process-runtime` (`runCommandWithTimeout`, `runExec`, `runCommandBuffered`, `killProcessTree`, `signalProcessTree`, `WorkerTaskPool`), `api.runtime.system.runCommandWithTimeout`, and `openclaw/plugin-sdk/media-ffmpeg` (`resolveFfmpegBin`). No restriction on spawning FFmpeg was found.

## 12. Tools — PARTIAL

Registration (`src/plugins/plugin-api.types.ts:224-227`, `src/plugins/tool-types.ts:101-112`):

```ts
registerTool: (tool: AnyAgentTool | OpenClawPluginToolFactory | OpenClawPluginToolFactory<2>, opts?: { name?: string; names?: string[]; optional?: boolean }) => void;
type OpenClawPluginToolFactory = (ctx: OpenClawPluginToolContext) => AnyAgentTool | AnyAgentTool[] | null | undefined;
```

Restricting to specific agents: there is no `agents` option on `registerTool`. Two mechanisms:

- A factory may return `null`/`undefined` based on `ctx.agentId`, so the tool is simply not built for other agents.
- `optional: true` tools are hidden until allow-listed through `tools.allow` (`docs/plugins/building-plugins.md:272-338`), which can be set per agent in config.

What a tool knows about its invoker, `src/plugins/tool-types.ts:22-93`: `agentId`, `sessionKey`, `sessionId`, `workspaceDir`, `agentDir`, `toolBindings` ("out-of-band plugin-owned bindings attached by the current run initiator"), `messageChannel`, `requesterSenderId`, `senderIsOwner`, `deliveryContext`, `sandboxed`, `assertInvocationCurrent`. There is **no device id and no connection id**. For a turn started by a JAgentChill device over `chat.send`, the tool cannot learn which device started it from this context. The plugin can map `sessionKey` to a project (and to the device that bound it) in its own tables; `NO_PROJECT_CONTEXT` is implementable from `sessionKey`.

Approval hook: `api.on("before_tool_call", handler)` may return (`src/plugins/hook-before-tool-call-result.ts:16-29`):

```ts
{ block?: boolean; blockReason?: string;
  requireApproval?: { title: string; description: string; scope?: ApprovalScope; severity?: "info" | "warning" | "critical";
                      timeoutMs?: number; timeoutReason?: string; allowedDecisions?: Array<"allow-once" | "allow-always" | "deny">;
                      pluginId?: string; onResolution?: (decision) => Promise<void> | void } }
```

with context `PluginHookToolContext { agentId, sessionKey, sessionId, runId, toolName, toolCallId, requester?: { channel, accountId, senderId, senderIsOwner, roleIds } }` (`src/plugins/hook-types.ts:552-587`). Approval prompts reach clients as `plugin.approval.requested` / `plugin.approval.resolved`, gated on `operator.approvals`. Also available: `registerTrustedToolPolicy` and `registerToolMetadata`.

---

## Required spec changes

### device-pairing-signing

1. **Reconnect handshake / Challenge issuance / Signed handshake transcript.** State that the JAgentChill handshake runs *after* the native OpenClaw `connect` has succeeded, as plugin RPCs, because there is no connect-time hook (section 7) and plugin methods are unreachable before `hello-ok` (section 3). Remove the implication that an unattested socket is unusable: it can still call core methods. Add an explicit statement of which core methods the device's OpenClaw scopes allow and that those are outside the JAgentChill attestation gate.

2. **Device token issuance (scenario "Stolen token without the key").** "The connection is closed with code 4401" cannot be implemented: the plugin can only close through `disconnectClientsForDevice`, which always uses 4001 `device removed` (section 5). Change to "every `jagentchill.*` call returns `DEVICE_NOT_ATTESTED`", or move attested traffic onto a plugin-owned WebSocket route.

3. **Pairing and signing error codes.** WebSocket close codes 4401, 4403, 4408 and 4426 cannot be emitted on the Gateway socket. Either (a) replace them with: OpenClaw closes with 4001 and the client learns the reason from the last RPC error or a `plugin.jagentchill.*` event sent just before the close, or (b) define a plugin-owned WebSocket (`registerHttpRoute` with `handleUpgrade`, `auth: "plugin"`) where the plugin controls close codes. `Connection liveness and backoff` ("closes with code 4403 → Revoked") and `Revocation` and `Gateway identity key` (rekey closes with 4403) must follow the same decision.

4. **Revocation.** Implement as: plugin marks its record revoked, then calls core `device.pair.remove` in process (`api.runtime.gateway.request`, bundled plugin) which removes the OpenClaw pairing, invalidates and closes the sockets with 4001. "Abort its in-flight HTTP transfers" is plugin work on its own routes. State that `removePairedDevice` / `revokeDeviceToken` / `rotateDeviceToken` are not SDK exports (section 4).

5. **Trust bootstrap / Pairing request creation / Approval.** Rewrite the enrolment to the flow in section 3: enrolment over public plugin HTTP routes; on code verification the plugin mints a 10-minute OpenClaw bootstrap token with `issueDeviceBootstrapToken` and returns it in the `verify` response; the device connects natively with it; the plugin approves the resulting pending OpenClaw request with `approveDevicePairing`. "Atomically create the device record and approve the corresponding OpenClaw device pairing" is not achievable as one transaction: the OpenClaw request does not exist until the device connects. Specify the two-step state (`code_verified` → `openclaw_paired`) and its failure handling (bootstrap token expiry, device never connects).

6. **Pairing offer format.** Keep "no secret in the offer". Add that the offer must not reuse OpenClaw's setup code, which embeds a bearer `bootstrapToken` (section 3). Note that OpenClaw operator scopes available through the bootstrap token are limited to `operator.read`, `operator.write`, `operator.approvals`, `operator.questions`, `operator.talk.secrets`; no JAgentChill device can obtain `operator.admin` or `operator.pairing` this way.

7. **Device key generation.** "`deviceId` SHALL be the OpenClaw device fingerprint" is correct but must say it is the full 64-character lowercase hex SHA-256 of the raw public key (section 9). `Gateway identity key` uses a 32-hex prefix for `gatewayId`; keep the two formats explicitly different or align them.

8. **Device roles and scopes.** "The device SHALL request from OpenClaw only the operator scopes its role needs" needs a concrete mapping (for example viewer → `operator.read`; editor and admin → `operator.read` + `operator.write` + `operator.approvals`). JAgentChill scopes (`jagentchill.*`) are plugin-internal and are never OpenClaw scopes.

9. **Mutual authentication of the Gateway.** Add the limitation that OpenClaw gives no Gateway identity proof beyond TLS pinning, and that the native `connect` (which carries the device or bootstrap token) happens before the JAgentChill Gateway signature can be checked on that socket. Required mitigations: on reconnect, verify the Gateway through a plugin HTTP challenge route first, or require `wss` with the `tls-sha256` pin for any non-loopback address so the native token is never sent to an impostor.

10. **Loopback connections are not exempt.** Keep, and add the reason: OpenClaw admits device-less local clients with the shared token even when `autoApproveLocal` is `false` (section 8), so the plugin must refuse callers whose `client.connect.device` is absent. "The plugin SHALL ... refuse `jagentchill.*` calls from a device that OpenClaw approved silently" is implementable by checking the plugin's own device table, not by reading OpenClaw approval metadata.

11. **Session resume.** `clientId` cannot be a new connect field (closed schema). Carry it as `connect.client.instanceId` or as a parameter of `jagentchill.handshake.prove`.

12. **Pairing request creation ("emit to every attested connection whose device holds `jagentchill.devices.manage`").** Depends on the event decision in gateway-plugin-api item 2 below.

### gateway-plugin-api

1. **RPC naming / Device attestation gate and scope enforcement.** Add: every method is registered with an explicit OpenClaw `scope` (`operator.read` or `operator.write`), because the default is `operator.admin`; JAgentChill scope checks run inside the handler against the plugin's device table using `client.connect.device.id`; the attestation flag is a plugin map keyed by `client.connId` and cleared on `client.connectionSignal` abort.

2. **Event delivery.** "Gateway event frames named `jagentchill.<domain>.<event>`" is not deliverable (section 6). Change to one of:
   - names `plugin.jagentchill.<event>` where `<event>` matches `^[a-z][a-z0-9_-]*$` (for example `plugin.jagentchill.job_updated`), sent with `ctx.gatewayEvents.emit(event, payload, { scope })`. This is a broadcast to all operator connections with that OpenClaw scope: no per-subscription, per-device or per-JAgentChill-scope filtering, so payloads must be safe for every paired device (send ids and a `seq`, let clients pull details through scope-checked RPCs); or
   - targeted delivery with `context.broadcastToConnIds` (requires recipients to hold `operator.write`; undocumented surface; needs spike); or
   - a plugin-owned SSE / WebSocket route with the per-request signature.
   The per-stream `seq` must be a payload field; the frame-level `seq` belongs to the Gateway.

3. **Signed HTTP route surface.** Keep `auth: "plugin"` for all routes. Add that every route under `/jagentchill/v1/` must use the same auth mode because mixed-auth overlaps are rejected at registration, and that the Gateway supplies no caller identity on these routes. The scenario "Gateway bearer token alone is insufficient" holds by construction.

4. **HTTP request limits and browser access.** State that body limits, CORS and Host checks are implemented by the plugin handler; no core enforcement on plugin routes was verified.

5. **Host data store.** Replace "one SQLite database" wording with the concrete mechanism: a plugin-owned database file under `<stateDir>/jagentchill/` opened through `openclaw/plugin-sdk/sqlite-runtime` in a worker (the logbook pattern), with blobs as plain files in a sibling directory. Record that `api.runtime.state.openBlobStore` is capped at 512 MiB per plugin and cannot be the media store, and that `registerStorageProvider` is unrelated.

6. **Host secret storage (referenced from `security-privacy`).** There is no secret vault. Specify owner-only files written with `writePrivateSecretFileAtomic`, or SecretRef config values. The Gateway private key is stored the same way.

7. **Service lifecycle.** "A service that crashes while running SHALL be restarted with delays of 1 s, 5 s and 30 s" must be marked as plugin-implemented supervision; the host does not restart services. Report degraded state through `ctx.serviceHealth.reportFailure`.

8. **Job cancellation and restart recovery.** Replace the `gateway.suspend.prepare` trigger with what a plugin can observe (`gateway_stop` hook, service `stop`, the `gateway_start` abort signal), or mark it as unverified pending a spike.

9. **Agent tools and provider registration.** Add that tool context exposes `agentId` / `sessionKey` / `sessionId` but no device identity; per-agent restriction is done by a factory returning `null` for other agents or by `optional: true` plus `tools.allow`; `createdBy (deviceId)` for jobs started by a tool must be resolved from the plugin's own session-to-device binding.

10. **Host command-line surface.** `openclaw jagentchill devices revoke` runs outside a request context; it must go through a Gateway call (core `device.pair.remove`) to get live sockets closed, not a direct store write.

### design.md D7

- Point 3 and 5: note the layering (native connect first, JAgentChill transcript second) and that the native token is exposed before Gateway verification unless TLS pinning or an HTTP pre-check is used.
- Point 7: "ngắt ngay mọi socket" is achievable only with close code 4001 through core; custom codes need a plugin-owned socket.

### Spikes to run before freezing

1. Bootstrap-token connect with client id `gateway-client`, role `operator`: confirm pending request creation, `approveDevicePairing` from the plugin, reconnect, `hello-ok.auth.deviceToken`.
2. `api.runtime.gateway.request("device.pair.remove" | "device.token.rotate", ...)` from a bundled plugin: authorisation and socket close.
3. `ctx.gatewayEvents.emit` and `context.broadcastToConnIds` with a `plugin.jagentchill.*` event received by a non-Control-UI client.
4. Whether adding `extensions/jagentchill/` needs any generated bundled-plugin metadata refreshed in the fork's build.
