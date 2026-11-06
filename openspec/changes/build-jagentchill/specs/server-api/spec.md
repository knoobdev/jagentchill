## ADDED Requirements

### Requirement: Server identity and startup
JAgentChill SHALL run as its own server process, **JAgentChill Server** (directory `server/`, package `@jagentchill/server`), and SHALL NOT be a plugin or an extension of OpenClaw: no JAgentChill file is loaded by, copied into or registered with the Gateway, and the Gateway's `plugins.allow` names only OpenClaw's own provider, runtime and memory plugins (`platform-skeleton.Gateway run profile`). The server owns the product channel (channel P), pairing and signing, projects, sync, the job queue, workflows, film, ORC, generation providers, the host data store and the agent tool endpoint; it supervises the OpenClaw Gateway as a child process and is that Gateway's only client (`server-api.Gateway supervision and lifecycle`, `server-api.Gateway link`). The server SHALL serve clients on its own HTTP and WebSocket listener, bound to `127.0.0.1:<server.port>` (default 18910) and to no other address (other addresses are served only by `server-api.Product listeners and path restriction`); the client route paths are `/jagentchill/v1/*` and `/jagentchill/app/*`. The server SHALL start with zero configuration (every key of `server-api.Server configuration` has a default, and an absent `<dataDir>/config.json` is created with defaults), SHALL answer `GET /jagentchill/v1/health` within 2 000 ms of process start on the reference desktop host of `diagnostics-quality.Reference devices` — before the Gateway is ready, with status `starting` — and SHALL refuse to start, exiting with code 78 and one log line naming the key, when the configuration file holds an unknown key or an invalid value. The server SHALL use OpenClaw only through (a) the Gateway protocol over the gateway link, (b) the documented `openclaw` executable of the pinned tag, for supervision and `openclaw doctor`, and (c) the Gateway configuration it writes; it SHALL NOT import OpenClaw's plugin SDK or any source file of `gateway/openclaw/`, the published `@openclaw/gateway-client` package being the only OpenClaw code it loads. [NEW]

#### Scenario: Server starts with defaults
- **WHEN** the server starts on an empty data directory
- **THEN** `<dataDir>/config.json` exists with default values, `GET /jagentchill/v1/health` answers within 2 000 ms
- **AND** it returns HTTP 200 with `status` `ok` once the services and the gateway link are up

#### Scenario: Health before the Gateway is ready
- **WHEN** `GET /jagentchill/v1/health` is requested 1 second after process start, while the Gateway child is still starting
- **THEN** the response is HTTP 503 with `status` `starting` and `reasons` containing `core_call_unavailable`

#### Scenario: Unknown config key
- **WHEN** `<dataDir>/config.json` contains a key that the `ServerConfig` schema does not define
- **THEN** the server exits with code 78 before opening any listener and its log names the key

#### Scenario: Nothing of JAgentChill is loaded by the Gateway
- **WHEN** the gateway contract suite lists the servers loaded by the supervised Gateway on the pinned tag
- **THEN** none has an id that starts with `jagentchill`, and the `gateway/openclaw/` tree is identical to the pinned tag

#### Scenario: No OpenClaw code in the server
- **WHEN** `pnpm jagentchill:lint` scans `server/` and `packages/`
- **THEN** rule `gateway-boundary` fails for any import that resolves into `gateway/openclaw/` or to `openclaw/plugin-sdk/*`, and passes for `@openclaw/gateway-client`

### Requirement: Single client channel
The product SHALL use exactly one channel between a client and a host (design D7, decision A1): **channel P** (the product channel), owned and served by the server. It consists of the WebSocket `GET /jagentchill/v1/ws` (`server-api.Channel P WebSocket endpoint`) and the HTTP routes under `/jagentchill/v1/` (`server-api.Signed HTTP route surface`), and it carries everything: RPC, events, media bytes, sync, jobs, pairing, settings, every admin proxy, and all agent session traffic — session create, list, describe, patch, send, steer, abort, history and subscribe, stream events, approvals and questions — which the server relays to the Gateway over its gateway link (`server-api.Agent session relay`). A client SHALL NOT open OpenClaw's native Gateway socket, SHALL NOT call a core method, and holds no OpenClaw scope or token (`device-pairing-signing.Device roles and scopes`); the words "channel G", "agent transport" and "relay transport" name nothing in the product, because the relay is simply how agent traffic travels. No `jagentchill.*` method or event exists on the Gateway: the only thing of JAgentChill the Gateway knows is the MCP entry of `server-api.Agent tool endpoint and session binding`; the `jagentchill.hostcli.<verb>` methods exist only on the local admin endpoint of `server-api.Host command-line surface`; and no product event SHALL travel through the Gateway, whose broadcasts are untargeted. [NEW]

#### Scenario: Product RPC is not a Gateway method
- **WHEN** the host's own `openclaw` CLI sends a request frame with method `jagentchill.job.list` on the native port
- **THEN** the core answers that the method is unknown
- **AND** the same method succeeds for a paired device on channel P

#### Scenario: Nothing of the product is registered in the Gateway
- **WHEN** the gateway contract suite lists the methods of the supervised Gateway and reads its configuration
- **THEN** no method name starts with `jagentchill.`, and the only JAgentChill entry in the configuration is `mcp.servers.jagentchill`

#### Scenario: Client code has one transport
- **WHEN** `pnpm jagentchill:lint` scans the client packages
- **THEN** rule `single-channel` fails for any import of an OpenClaw gateway client, any use of a core method name as a wire method, and any WebSocket URL that does not end in `/jagentchill/v1/ws`

#### Scenario: Agent turn on channel P
- **WHEN** an `editor` device sends `jagentchill.chat.send` for a creative session it can act in
- **THEN** the server performs the Gateway `chat.send` over its gateway link and the device receives the turn as `jagentchill.chat.stream` events on the same connection

### Requirement: Channel P WebSocket endpoint
The server SHALL serve `GET /jagentchill/v1/ws` on its own listener and SHALL itself perform the Origin check, the Host check of `server-api.HTTP request limits and browser access` and the signed handshake of `device-pairing-signing.Channel P handshake`; no OpenClaw credential, Gateway token or Gateway identity plays any part on this route. The connection's `transport` and peer address come from `server-api.Product listeners and path restriction` (a request without forwarded-for attribution is `loopback`). An upgrade whose `Origin` header is present and not in the CORS allow-list SHALL be refused with HTTP 403 before the upgrade. One device SHALL hold at most 8 concurrent channel P connections; the ninth SHALL be closed with code 4429. A connection is identified by a server-generated `connId` (UUID) returned in the `ready` frame. The WebSocket is available on every server, so this route never answers HTTP 426; the transport of `server-api.SSE and signed HTTP fallback` exists beside it for network paths that do not carry an upgrade. [NEW]

#### Scenario: Upgrade and handshake
- **WHEN** a paired device opens `ws://127.0.0.1:18910/jagentchill/v1/ws` and completes the handshake frames
- **THEN** it receives a `ready` frame carrying `connId`, `role`, `scopes` and `features`

#### Scenario: Gateway bearer token does not open channel P
- **WHEN** a client opens the WebSocket with a valid OpenClaw Gateway bearer token in the `Authorization` header and sends a `req` frame before any handshake frame
- **THEN** the connection is closed with code 4401 and no handler runs

#### Scenario: Ninth connection of one device
- **WHEN** a device with 8 open channel P connections completes a ninth handshake
- **THEN** the ninth connection is closed with code 4429 and the first 8 stay open

#### Scenario: Disallowed browser origin
- **WHEN** a page at `https://example.org` attempts the upgrade
- **THEN** the response is HTTP 403 and no WebSocket is established

### Requirement: Channel P frame envelope
Channel P frames SHALL be UTF-8 JSON text frames of at most 1 048 576 bytes, each an object with a discriminator `t`. The frame types SHALL be exactly: handshake frames `hello` (client), `challenge` (Gateway), `prove` (client) and `ready` (Gateway), whose cryptographic content is defined by `device-pairing-signing.Channel P handshake`; `req` `{ t: "req", id, method, params, idempotencyKey? }` (client); `res` `{ t: "res", id, ok: true, result }` or `{ t: "res", id, ok: false, error }` with `error` per `server-api.RPC error envelope` (Gateway); `evt` `{ t: "evt", event, stream, seq, ts_ms, payload }` (Gateway); `ping` and `pong` (either side). The handshake frame fields SHALL be: `hello { deviceId, deviceNonce, protocolVersion, minProtocolVersion, capabilities[], clientInstanceId, resume?: { streams: { <stream>: lastSeq } } }`; `challenge { gatewayNonce, ts, gatewayId, protocolVersion, minProtocolVersion, gatewaySignature }`; `prove { signature, deviceToken }`; `ready { connId, role, scopes[], features{}, serverTime_ms, maxSchemaVersion: { project, script, workflow }, transport: "loopback" | "lan" | "tailnet", resumed, deviceToken?: { value, expires_ms } }`. `ready` has no field for an OpenClaw credential or a transport choice. `id` is a client-chosen string of 1 to 64 characters unique among that connection's in-flight requests; at most 64 requests SHALL be in flight per connection, and a further request SHALL be answered `RATE_LIMITED`. A frame that is not valid JSON, exceeds the size limit, has an unknown `t`, or is a `req` before `ready` SHALL close the connection with code 4400 (4401 for a `req` before `ready`). Binary frames SHALL be accepted only as defined in `server-api.Binary terminal frames`; any other binary frame closes the connection with code 4400. Bulk bytes other than terminal streams SHALL travel over the HTTP routes. [NEW]

#### Scenario: Request and response correlation
- **WHEN** a client sends `{ "t": "req", "id": "a1", "method": "jagentchill.job.get", "params": { "jobId": "J" } }` after `ready`
- **THEN** it receives exactly one `res` frame with `id` `a1`

#### Scenario: Oversized frame
- **WHEN** a client sends a text frame of 1 048 577 bytes
- **THEN** the connection is closed with code 4400

#### Scenario: Sixty-fifth concurrent request
- **WHEN** a connection has 64 requests in flight and sends another
- **THEN** that request is answered with `ok: false` and `error.code` `RATE_LIMITED`, and the 64 in-flight requests complete normally

#### Scenario: Unknown frame type
- **WHEN** a client sends `{ "t": "subscribeAll" }`
- **THEN** the connection is closed with code 4400

### Requirement: Binary terminal frames
Channel P SHALL carry terminal streams as binary frames when, and only when, the client listed the capability `terminal-binary` in `hello` and the Gateway advertises the feature `terminal`; base64 in JSON (`jagentchill.terminal.data` events and `jagentchill.terminal.input` requests of `workspaces-terminal.Terminal stream encoding and back-pressure`) SHALL remain available on every connection and is the only form on the SSE fallback transport. A binary frame SHALL be: byte 0 version (`0x01`); byte 1 kind (`0x01` output, `0x02` snapshot, `0x03` restore, `0x10` input); bytes 2–3 the big-endian length `n` of the terminal id; `n` bytes of the terminal id in UTF-8 (1 to 64 bytes); 4 bytes big-endian `seq` (for kind `0x10`: the client's `inputSeq`); then at most 65 536 payload bytes copied without decoding. A binary frame for a terminal the connection is not attached to, with an unknown version or kind, or with a payload above the limit SHALL close the connection with code 4400. Kinds `0x01`–`0x03` are sent only by the Gateway and `0x10` only by the client. Sequence numbering, attach, back-pressure and limits are those of `workspaces-terminal.Terminal stream encoding and back-pressure`; a terminal uses one encoding per connection, chosen at attach. [NEW]

#### Scenario: Binary output on a capable connection
- **WHEN** a client that sent `capabilities: ["terminal-binary"]` attaches to terminal `T` with `encoding: "binary"` and the shell prints 3 bytes that are not valid UTF-8
- **THEN** the client receives one binary frame of kind `0x01` whose payload is exactly those 3 bytes

#### Scenario: Fallback encoding
- **WHEN** a client that did not list `terminal-binary` attaches to the same terminal
- **THEN** it receives `jagentchill.terminal.data` events with `dataB64` and no binary frame

#### Scenario: Binary frame for an unattached terminal
- **WHEN** a client sends a kind `0x10` frame naming a terminal it has not attached to
- **THEN** the connection is closed with code 4400 and nothing is written to any PTY

### Requirement: Channel P close codes
The server SHALL close channel P connections only with these codes, and no specification SHALL name another code on channel P: 4400 protocol error; 4401 handshake failed (bad signature, bad token, unknown device, request before `ready`); 4403 device revoked or Gateway rekeyed; 4408 handshake not completed within 10 000 ms of the upgrade; 4426 protocol version unsupported; 4429 rate or connection limit; 1001 going away (server shutdown). The close reason string SHALL be the error code of the cause (for example `DEVICE_REVOKED`); for 4426 it is `PROTOCOL_UNSUPPORTED:client` or `PROTOCOL_UNSUPPORTED:gateway`, naming the side that is too old (the envelope has no error frame before `ready`). These are the only close codes a client ever sees: no client is connected to OpenClaw's own socket, so no specification SHALL name a core close code as client-visible. [NEW]

#### Scenario: Handshake timeout
- **WHEN** a client upgrades and sends nothing for 10 000 ms
- **THEN** the connection is closed with code 4408

#### Scenario: Server shutdown
- **WHEN** the server process receives a termination signal with 3 channel P connections open
- **THEN** each is closed with code 1001 within 2 seconds

#### Scenario: Revoked device
- **WHEN** an admin revokes a device that has an open channel P connection
- **THEN** that connection is closed with code 4403 and reason `DEVICE_REVOKED`

#### Scenario: Gateway child restarts
- **WHEN** the supervised Gateway process exits and is restarted while 3 channel P connections are open
- **THEN** none of the 3 connections is closed, and agent methods on them answer `GATEWAY_UNAVAILABLE` until the gateway link is ready again

### Requirement: Channel P liveness
Either side SHALL send `{ "t": "ping" }` when it has sent no frame for 15 000 ms, and the receiver SHALL answer `{ "t": "pong" }` within 5 000 ms. A side that has received no frame of any kind for 45 000 ms SHALL close the connection (Gateway: code 1001; client: local close followed by the reconnect policy of `device-pairing-signing.Connection liveness and backoff`). Liveness frames carry no payload and are not rate limited. Presence is a separate mechanism (`cross-device-sync.Presence`). [NEW]

#### Scenario: Idle connection stays open
- **WHEN** a connection exchanges no request for 10 minutes while both sides answer pings
- **THEN** the connection remains open

#### Scenario: Silent peer
- **WHEN** the client stops sending any frame, including `pong`, for 45 000 ms
- **THEN** the Gateway closes the connection and releases its subscriptions

### Requirement: SSE and signed HTTP fallback
Beside the WebSocket, the server SHALL always provide channel P over three HTTP surfaces carrying the same envelope objects, for a client whose network path does not carry a WebSocket upgrade (for example a browser behind an intercepting proxy): the handshake over `POST /jagentchill/v1/handshake/hello` (body = the `hello` object, response = the `challenge` object) and `POST /jagentchill/v1/handshake/prove` (body = the `prove` object plus `gatewayNonce`, response = the `ready` object; no extra token is issued, because the event and RPC requests below are individually signed and name the connection); events over `GET /jagentchill/v1/events?conn=<connId>` as a `text/event-stream` in which each `data:` line is one `evt` object and a comment line is sent every 15 000 ms; RPC over `POST /jagentchill/v1/rpc` whose body is one `req` object and whose response body is the matching `res` object. `events` and `rpc` SHALL carry the per-request signature of `device-pairing-signing.Per-request HTTP signature` and the header `X-JAgentChill-Conn: <connId>`; the two handshake routes are unsigned by nature and are listed in `server-api.Unsigned route exceptions`. A fallback connection ends when its event stream has been closed for 45 000 ms or the device is revoked; an event stream of a revoked device is ended with a final event `{ t: "evt", event: "jagentchill.device.revoked" }` followed by closure, and every further request receives HTTP 403 `DEVICE_REVOKED`. The fallback has no binary frames. Agent session traffic uses the same `rpc` and `events` surfaces as everything else. A client SHALL attempt the WebSocket first and SHALL switch to the fallback, for the address in use, only after the upgrade failed 2 consecutive times for a reason other than a channel P close code while `GET /jagentchill/v1/health` on the same address succeeded; it attempts the WebSocket again at its next reconnect. The health field `transport` names the transport the server prefers and is `ws` on every server (`sse` remains a legal value of the schema); both transports SHALL pass the same conformance suite. [NEW]

#### Scenario: Client falls back when upgrades are refused
- **WHEN** an intermediary answers the WebSocket upgrade with HTTP 502 twice while `GET /jagentchill/v1/health` on the same address succeeds
- **THEN** the client completes the two handshake posts, uses `events` and `rpc` for that connection, and attempts the WebSocket again at its next reconnect

#### Scenario: RPC over the fallback
- **WHEN** a client completes the two handshake posts and sends a signed `POST /jagentchill/v1/rpc` with a `req` object for `jagentchill.job.list`
- **THEN** the HTTP response body is the `res` object with the same `id`

#### Scenario: Unsigned event stream request
- **WHEN** `GET /jagentchill/v1/events?conn=<connId>` is requested without signature headers
- **THEN** the response is HTTP 401 `SIGNATURE_MISSING` and no event is sent

#### Scenario: Revocation on the fallback
- **WHEN** a device connected through the fallback is revoked
- **THEN** its event stream ends within 2 seconds and its next `rpc` post receives HTTP 403 `DEVICE_REVOKED`

### Requirement: Native Gateway port isolation
The Gateway's native port (OpenClaw's HTTP server and OpenClaw's own WebSocket) SHALL be bound to loopback at every Network access level and on every host platform (macOS, Windows, Linux, container) — the server starts the Gateway with `--bind loopback` on `server.gatewayPort` — and SHALL be used by exactly two parties: the server, over its gateway link (`server-api.Gateway link`), and the host's own `openclaw` command line when the host operator runs it. The same isolation applies to the server's agent tool endpoint `/agent-tools/mcp`, which serves only the Gateway on loopback (`server-api.Agent tool endpoint and session binding`): neither the Gateway port nor the tool endpoint SHALL ever be reachable through the tailnet listener or the LAN listener. The server SHALL report health reason `run_profile_violation`, refuse to start any product listener and refuse enrolment while the Gateway's bind address is not loopback. No device is ever admitted to the native socket: the server never issues a bootstrap token, never approves an OpenClaw device pairing for a client device, creates no OpenClaw pairing other than its own link identity, never sends the Gateway token or its link identity to a client (`server-api.Gateway secrets`), and keeps no role-to-OpenClaw-scope mapping; a pending OpenClaw pairing request that appears on the host (someone used OpenClaw's own tooling) is never approved by the server and is listed by the doctor as `warn pairing: unknown pending OpenClaw request`. Remote peers reach the host only through `server-api.Product listeners and path restriction`, whose only upstream is the server's loopback port, so the core methods that OpenClaw scopes cannot separate by role (`chat.send` into any session, `exec.approval.resolve`, `tools.invoke`, `fs.listDir`, `sessions.files.get`, `config.get`, `logs.tail`, `terminal.*`) are unreachable from any device of any role. A person who uses the host account's `openclaw` CLI acts with the host operator's authority (`security-privacy.Trust model`), outside the device role model. [NEW]

#### Scenario: Native socket from a paired device
- **WHEN** a paired `admin` phone, from the LAN or the tailnet, attempts OpenClaw's native WebSocket `connect` at the host's addresses
- **THEN** no listener accepts it on a non-loopback address, and the product listeners answer HTTP 404 for the native socket path

#### Scenario: Core method from an editor
- **WHEN** an `editor` device sends `{ "t": "req", "method": "chat.send" }` or `exec.approval.resolve` on channel P
- **THEN** the response error code is `NOT_FOUND` with `details.reason` `unknown_method` and no core call is made

#### Scenario: Foreign pending pairing request
- **WHEN** an OpenClaw pairing request is pending on the host
- **THEN** the server does not approve it and the doctor lists it as `warn`

#### Scenario: Gateway bound to a network interface
- **WHEN** an operator edits the Gateway configuration so that the Gateway listens on `0.0.0.0`
- **THEN** health lists `run_profile_violation`, the product listeners are stopped, enrolment answers HTTP 503, and the doctor names the bind setting

#### Scenario: Tool endpoint and Gateway port from the network
- **WHEN** a tailnet peer and a LAN peer request `/agent-tools/mcp` through a product listener, with and without a bearer value, and try to connect to the Gateway port on the host's non-loopback addresses
- **THEN** the listener answers HTTP 404 itself for the tool endpoint path, the server's tool endpoint receives no request, and nothing accepts a connection on the Gateway port

### Requirement: Product listeners and path restriction
Every non-loopback way into a host SHALL be a **product listener**: an HTTP-aware reverse proxy run by the ingress helper (one Go binary, sources in `server/go/tsnet-bridge/`, shipped for macOS, Windows and Linux on arm64 and x64, spawned with an argument array and supervised by the server with restarts at 1 s, 5 s and 30 s). There are two listeners, each off by default: the **tailnet listener** (`server-api.Tailnet ingress bridge`) and the **LAN listener** of this requirement; neither exposes the Gateway's native port or the agent tool endpoint (`server-api.Native Gateway port isolation`). Both behave identically:

1. **Path restriction.** Only requests whose path, after normalisation (percent-decoding once, removal of dot segments, rejection of encoded slashes and of a path that changes under a second decoding), starts with `/jagentchill/` are forwarded — the channel P WebSocket upgrade, the server's HTTP routes and the static web app — and they are forwarded to the server's loopback port, the listener's only upstream. Every other request, including `/`, `/agent-tools/mcp`, OpenClaw's native WebSocket path, the Control UI, canvas host documents, OpenAI-compatible endpoints and the routes of OpenClaw's own plugins, is answered by the listener itself with HTTP 404 and an empty body and reaches neither the server nor the Gateway. Methods are limited to `GET`, `HEAD`, `POST`, `PUT`, `DELETE`, `OPTIONS`; `CONNECT` and HTTP/2 cleartext upgrade are refused.
2. **Peer attribution.** The listener removes from every inbound request the headers `X-Forwarded-For`, `X-Forwarded-Proto`, `X-Forwarded-Host`, `Forwarded`, `X-Real-IP` and every header starting `X-JAgentChill-Bridge-` or `X-JAgentChill-Peer-`, then adds `X-Forwarded-For: <peer address>`, `X-Forwarded-Proto`, `X-JAgentChill-Peer-Transport: lan | tailnet`, `X-JAgentChill-Peer-Node: <tailnet node name>` (tailnet only) and `X-JAgentChill-Bridge-Secret: <secret>`, where the secret is 32 CSPRNG bytes generated by the server at every helper start and passed over the helper's control pipe (never on a command line or in an environment variable). The server trusts the peer headers only when the secret matches in constant time; a request that carries peer headers with a wrong or missing secret is refused with HTTP 403 and audited as `ingress.forged_peer` (at most 1 record per minute). For a WebSocket the attribution of the upgrade request applies to the whole connection.
3. **What the server sees.** Forwarded requests arrive at the server from loopback but always with `X-Forwarded-For` and the bridge secret; the server treats a request as coming from a local client only when it has no forwarded-for attribution at all. The Gateway receives no client request by any path, so its own classification of local and remote callers never applies to a device; `gateway.auth.rateLimit.exemptLoopback` stays `false` in the run profile all the same (`platform-skeleton.Gateway run profile`).
4. **Rate-limit buckets.** Every per-source-address limit of this capability and of `device-pairing-signing.Pairing abuse limits` is keyed by the attributed peer address, so two peers behind one listener never share a bucket and the helper's loopback address is never a key.
5. **Limits of the helper.** Request header block at most 32 KiB; bodies streamed without buffering, with the limits of `server-api.HTTP request limits and browser access` enforced by the server; idle timeout 60 s for HTTP and none for an upgraded WebSocket (liveness is `server-api.Channel P liveness`); at most 512 concurrent connections per listener and 32 per peer address (HTTP 503 beyond).

**LAN listener.** Enabled by host configuration `lan.enabled` (the "Local network (encrypted)" level of `desktop-app.Network access setting`; `jagentchill lan up | down | status` on any host). It listens with TLS 1.3 only on `lan.port` (default 18790) on the private (RFC 1918, unique-local, link-local) addresses of the host's interfaces and never on a globally routable address. Its default certificate is generated by the server on first enablement — ECDSA P-256, self-signed, subject alternative names = the host name and the LAN addresses, valid 825 days, renewed 30 days before expiry and when the address set changes — with the private key stored as the secret `LAN_TLS_KEY` and the certificate under `<dataDir>/tls/`; its SHA-256 is the `tlsSha256` pin that native apps verify (`security-privacy.Transport protection`), and a renewed certificate is announced to paired devices in `jagentchill.settings.host.changed` over an already authenticated connection so that pins roll without re-pairing. For browsers on other computers (decision B2) an admin can install a browser-trusted certificate: `jagentchill.settings.lan.certificate.set { certificatePem, secretName }` (scope `jagentchill.config.write`; the key was written first through the secret route) or `jagentchill lan cert --cert <file> --key <file>`; the server validates that the key matches, that the chain is unexpired and names a host name, serves it instead of the self-signed one, keeps publishing its `tlsSha256`, and adds `https://<name>:<port>` to the allowed origins. `jagentchill.settings.lan.get` (scope `jagentchill.config.read`) returns `{ state: "disabled" | "starting" | "ready" | "failed", addresses[], port, tlsSha256, certificate: { kind: "self-signed" | "installed", subject, notAfter_ms }, error? }`. A selected listener that is not `ready` is reported by health with reason `lan_listener_down` without making the status `degraded`. The server SHALL refuse to start any listener while the run profile is violated. Enabling, disabling and certificate changes are audited. Peer attribution and path restriction are gated by spike S20 (`diagnostics-quality.Gating spikes`). [JAD] [NEW]

#### Scenario: Only product paths are forwarded
- **WHEN** a machine on the LAN or the tailnet requests `/`, `/__openclaw__/canvas/documents/x/index.html`, `/v1/chat/completions` and the native WebSocket path through a product listener
- **THEN** each answer is HTTP 404 with an empty body produced by the listener, and neither the server's nor the Gateway's access log has an entry for them

#### Scenario: Path tricks
- **WHEN** a request for `/jagentchill/../v1/models`, `/jagentchill/%2e%2e/` or `/jagentchill%2f..%2f` arrives
- **THEN** the listener answers HTTP 404 and forwards nothing

#### Scenario: Forged peer header
- **WHEN** a tailnet peer sends `X-Forwarded-For: 127.0.0.1` and `X-JAgentChill-Bridge-Secret: guess` on a pairing request
- **THEN** both headers are removed and replaced by the listener, the pairing request card shows the peer's real tailnet address, and its rate-limit bucket is its own address

#### Scenario: Local process bypasses the listener with peer headers
- **WHEN** a process on the host sends a request straight to the server's loopback port with `X-JAgentChill-Peer-Transport: tailnet` and no valid secret
- **THEN** the server answers HTTP 403 and writes `ingress.forged_peer`

#### Scenario: Forwarded request is not a local client
- **WHEN** a tailnet peer requests a server route that is reserved for local clients (for example `jagentchill.diagnostics.shutdown.prepare` as the local supervisor)
- **THEN** the call is refused, because the request carries forwarded-for attribution

#### Scenario: LAN listener certificate and pin
- **WHEN** an admin selects "Local network (encrypted)" on a macOS, a Windows and a Linux host
- **THEN** on each, `jagentchill.settings.lan.get` reports `ready` with a `tlsSha256`, a TLS 1.2 client hello is refused, and the server port 18910 and the Gateway port are closed on every non-loopback address

#### Scenario: Installed certificate for browsers
- **WHEN** an admin installs a browser-trusted certificate for `studio.example.lan`
- **THEN** the listener serves it, `https://studio.example.lan:18790` is an allowed origin, and native apps keep connecting with the new pin after the `jagentchill.settings.host.changed` announcement

#### Scenario: Same behaviour of the six helper binaries
- **WHEN** the listener cases (start, ready, path restriction, peer attribution, crash restart) run for the macOS, Windows and Linux binaries on arm64 and x64
- **THEN** all six pass the same assertions


### Requirement: Web origin isolation
The origin that serves the web app SHALL serve nothing else that can run script (decision A2), because any script on that origin can use the browser's device key (`device-pairing-signing.Web client key handling`). (1) The web app is served only by the server — on its loopback port and through the product listeners — and the server's listener has no path other than `/jagentchill/` and the loopback-only `/agent-tools/mcp`, which answers MCP JSON to the Gateway and nothing to a browser. The Gateway, its Control UI, its canvas host, its OpenAI-compatible endpoints and every route of an OpenClaw plugin live on the Gateway port, a different origin from which the app is never served and which no product listener forwards. (2) As defence in depth the run profile keeps `gateway.controlUi.enabled` `false` and keeps `canvas` out of `plugins.allow` — no capability needs OpenClaw's canvas host, because inline widgets, diagrams and previews in chat are rendered by the app from typed data (`chat-agent`, `workflow-diagram`), never by loading an agent-written document. (3) The server's routes return script-capable content only under `/jagentchill/app/` (the static app, with the Content-Security-Policy of `security-privacy.Desktop and embedded web hardening`); every other server response is sent with `Content-Type` from a fixed table, `X-Content-Type-Options: nosniff` and, for user-supplied bytes (blobs, media, workspace files, exports, share downloads), `Content-Disposition: attachment` unless the type is in the inert list (`image/png`, `image/jpeg`, `image/webp`, `image/gif`, `video/*`, `audio/*`) and `Content-Security-Policy: sandbox; default-src 'none'`, so that an uploaded HTML or SVG file can never execute on the app's origin. (4) `GET /jagentchill/v1/health` reports `originExclusive: true | false` for the origin the request arrived on; a server whose route table satisfies (1) and (3) reports `true` on every origin it serves, and a web client that does not read `true` from the origin it was loaded from SHALL refuse to create or use a device key. The contract test `origin-exclusive` SHALL crawl every route of the server's listener, on loopback and through each product listener, and fail when a path outside `/jagentchill/app/` answers with a script-capable content type without the sandbox policy. An operator who re-enables the Control UI on the Gateway by hand gets the doctor finding `warn web-origin: the OpenClaw Control UI is enabled on the Gateway port` and the run-profile handling of `platform-skeleton.Run profile application`; the app's origin is unaffected. [NEW]

#### Scenario: Canvas document cannot reach the device key
- **WHEN** an agent writes an HTML document and a browser paired on `http://127.0.0.1:18910` requests OpenClaw's canvas host path for it on that origin
- **THEN** the response is HTTP 404, because the server's listener has no such path, and OpenClaw's canvas plugin is not loaded on a profiled Gateway

#### Scenario: Uploaded SVG is inert
- **WHEN** a browser opens the blob URL of an uploaded SVG that contains a script
- **THEN** the response carries `Content-Disposition: attachment` and the sandbox policy, and the script does not run on the app's origin

#### Scenario: Control UI re-enabled by the operator
- **WHEN** `gateway.controlUi.enabled` is set to `true` by hand in the Gateway configuration
- **THEN** the Control UI answers only on the Gateway's loopback port, health on the app's origin still reports `originExclusive: true`, no product listener forwards the Control UI path, and the doctor lists the `web-origin` finding

#### Scenario: Origin crawl
- **WHEN** the contract test `origin-exclusive` runs against the server's listener and both product listeners
- **THEN** no path outside `/jagentchill/app/` returns `text/html`, JavaScript or SVG without the sandbox policy

### Requirement: Gateway calls over the link
Everything the server does in the Gateway on behalf of a device or of itself — agent session methods, approvals, admin configuration, run-profile writes — SHALL go through one module, `coreCall(method, params, { onBehalfOf })`, built on the gateway link (`server-api.Gateway link`), and no other code path SHALL send a Gateway request. A core call is a Gateway protocol request over the loopback link, never a function call inside the Gateway's process, and the server loads no OpenClaw code other than the gateway client. The module (1) accepts only methods in the constant `CORE_METHODS`, the union of the core methods named by `server-api.Agent session relay`, `server-api.Approval and question resolution`, `server-api.Narrow admin proxies` and their delegates, plus `tools.invoke`, `tts.convert` and `tts.speak` used by capability `generation-providers` for OpenClaw's own bundled media providers (spike S28), each with the one OpenClaw scope it needs out of the four the link holds; (2) is called only after the caller's device, scope and session checks passed, and records `onBehalfOf` (`{ deviceId, connId } | { principal }`) for audit and for cancellation at revocation; (3) never takes a method name, scope or raw parameter object from client input. Because the server is an ordinary Gateway client, a core call behaves the same from every server context — a channel P message handler, an HTTP route handler, a service timer, a job worker. While the gateway link is not established (`server-api.Gateway supervision and lifecycle`) every core call fails at once with `GATEWAY_UNAVAILABLE` (`retryable: true`, `details.reason` one of `starting`, `restarting`, `crash_loop`, `config_invalid`, `stopped`, `link_refused`), nothing is queued on behalf of a device, and a call in flight when the link drops fails with the same code; server-initiated calls that must not be lost (run-profile application, restoring the subscriptions of running sessions, approval reconciliation) are re-issued by their owners when the link reports ready. A method flagged `coreCall: true` in the protocol package is one whose handler needs the Gateway; clients use the flag to disable those features while health lists `core_call_unavailable`. A core call has a 30 000 ms timeout (`TIMEOUT`, retryable) except stream subscriptions. Whether the Gateway accepts each method that needs `operator.admin` from the link is gated by spike S12 (`server-api.Narrow admin proxies`). [NEW]

#### Scenario: Core call from a message handler and from a timer
- **WHEN** the contract test opens channel P, waits 60 s and sends a method flagged `coreCall`, and the run-profile check fires from a service timer with no request in flight
- **THEN** both complete over the gateway link with the same result shape

#### Scenario: Method outside the list
- **WHEN** server code calls `coreCall("config.set", …)`, which `CORE_METHODS` does not contain
- **THEN** the call throws before anything is sent on the link and the contract test `core-methods` names the method

#### Scenario: Gateway not running
- **WHEN** the Gateway child is restarting and a device calls `jagentchill.chat.send` and then `jagentchill.sync.project.list`
- **THEN** the first answers `GATEWAY_UNAVAILABLE` with `details.reason` `restarting` and `retryable` true, and the second succeeds

#### Scenario: Link drops during a call
- **WHEN** the gateway link closes while a `sessions.patch` core call is in flight
- **THEN** the device's request answers `GATEWAY_UNAVAILABLE` within 1 second and is not retried by the server

### Requirement: Gateway supervision and lifecycle
The server SHALL start, watch and stop the OpenClaw Gateway as its child process, in the way `docs/gateway/embedding.md` of the pinned tag describes, and SHALL be its only supervisor: the desktop app, the container entry point and a service manager start the server and never the Gateway (`desktop-app.Gateway process supervision`). **Start.** After writing the Gateway configuration `<dataDir>/gateway-state/openclaw.json` (`gateway.mode: "local"`, `gateway.auth.mode: "token"`, the run profile of `platform-skeleton.Gateway run profile`, and `mcp.servers.jagentchill`), the server SHALL spawn, with an argument array and a real Node runtime — the one it runs on or the one shipped with the distribution, never Electron's `process.execPath` — `<openclawRoot>/openclaw.mjs gateway --bind loopback --port <server.gatewayPort>`, with `OPENCLAW_STATE_DIR` and `OPENCLAW_CONFIG_PATH` pointing into `gateway-state/`, `OPENCLAW_SKIP_CHANNELS=1`, `OPENCLAW_NO_RESPAWN=1`, `OPENCLAW_DISABLE_BONJOUR=1` and `OPENCLAW_EXEC_SHELL_SNAPSHOT=0`, on top of the stripped environment of `security-privacy.Environment stripping for child processes` — the Gateway token is given to the Gateway in its owner-only configuration file and never in its environment, because the processes the Gateway starts inherit that environment; the child's output is consumed from the moment of the spawn into `<dataDir>/logs/gateway.log`. `openclawRoot` is the built Gateway of the pinned tag shipped with the distribution (`updates-distribution`), or `gateway/openclaw/` in a development checkout. Exactly one Gateway child SHALL exist per data directory. The Gateway SHALL be started as the leader of its own process group (on Windows: in its own job object), so that the agent CLIs and every other process it starts can be ended with it and none of them belongs to the server's group; its pid is recorded in an owner-only pid file in `run/` at the spawn and removed when the group is gone. A Gateway left behind by a server that was killed keeps its port and its state directory (measured: `docs/decisions/0002-own-server-gateway-sidecar.md` row 14), therefore at every server start, before a new child is spawned, the server SHALL read the pid file and, when that group is still alive and its leader's command line is the Gateway entry of this data directory, kill the whole group (`SIGKILL`; `taskkill /T /F` on Windows) and wait until the Gateway port is free; a pid that belongs to another program is never signalled. The server always waits for a child and its group to be gone before it spawns a replacement. **Readiness.** The Gateway is `ready` when the gateway link received `hello-ok` (`server-api.Gateway link`), never because of a log line; a `connect` answered `UNAVAILABLE` with `details.reason: "startup-sidecars"` is retried after its `retryAfterMs`; a Gateway that is not ready 60 000 ms after the spawn is terminated and counted as a failed start. **Invalid configuration.** A start that exits with code 78 makes the server run `openclaw doctor --fix --yes --non-interactive` exactly once with the same state and configuration environment and, when that exits 0, retry the start exactly once; a second exit with code 78 puts the supervisor in state `config_invalid`, with no further automatic start. **Restart.** Any other unexpected exit, a readiness timeout, or a link that stays down for 30 000 ms while the child lives (the child is then terminated) is followed by a restart after 1 s, 5 s and 30 s; a Gateway that stayed ready for 300 s resets the count; after the third consecutive failure the supervisor stays in state `crash_loop` until `jagentchill.diagnostics.service.restart { service: "gateway" }`, `jagentchill gateway restart` or a server restart. A `shutdown` event from the Gateway with a numeric `restartExpectedMs`, followed by close code 1012, is a planned restart inside the same process: the child is kept, the link reconnects, and it counts as a failure only when the link is still not ready `restartExpectedMs` + 30 000 ms after the event; a `shutdown` event without `restartExpectedMs` that the server did not ask for is handled as an unexpected exit once the child has exited. **States.** `starting`, `ready`, `restarting`, `config_invalid`, `crash_loop`, `stopped`, reported in `jagentchill.settings.host.get` as `gateway { state, since_ms, restarts, lastExit?: { code, signal }, pid? }` and announced with `jagentchill.settings.host.changed` (`pid`, the leader of the Gateway's process group, is included only for the device record flagged `localSupervisor` over loopback, which needs it to end a Gateway whose server died, `desktop-app.Gateway shutdown and app quit`; no other device receives it); while the state is not `ready`, health lists `core_call_unavailable`, with `gateway_crash_loop` or `gateway_config_invalid` beside it in those two states (`server-api.Health route`). **The server stays up.** Whatever the Gateway's state, the server keeps serving pairing, the handshake, sync, projects, media, blobs, exports, settings, secrets, local and provider jobs and its own PTY terminals; every method flagged `coreCall` and every agent feature answers `GATEWAY_UNAVAILABLE` (`server-api.Gateway calls over the link`); turns that were running are closed as `turn_failed` (`server-api.Agent stream events and gap recovery`); no channel P connection is closed because of the Gateway. On every return to `ready` the server re-applies the run profile (`platform-skeleton.Run profile application`), aborts over the link (`chat.abort`) every run that it closed as `turn_failed` while the link was down and that the Gateway still runs — the link can drop while the Gateway process lives, and a run the server no longer tracks must not go on calling tools —, restores its session subscriptions, denies the approvals the Gateway still lists as pending (`server-api.Approval and question resolution`) and announces the state. **Stop.** A Gateway that is asked to stop while agent turns run keeps draining them for minutes (measured: 325 s, decision 0002 row 14), so a stop is never left to the Gateway alone. On server shutdown, and on every restart of the child the server itself decides, the server SHALL: (1) close every running turn in its own store as `turn_failed` with `UNAVAILABLE` and mark every pending runtime-raised approval `expired` — nothing is allowed by a stop; (2) stop the link; (3) send `SIGTERM` to the Gateway (on Windows `taskkill /T`), wait at most 8 000 ms for its exit; (4) then, whether or not it exited, kill the whole process group with `SIGKILL` (`taskkill /T /F` on Windows), because an agent CLI can outlive the Gateway that started it; (5) remove the pid file. The Gateway stop is started at the beginning of the server's shutdown, in parallel with the stop of the other services, and is the last thing the server waits for (`server-api.Service lifecycle`); the server process exits only after the group is gone, so that no Gateway and no agent process outlives its server and no port stays bound. A server that is killed without running this sequence leaves the group behind until the next start reaps it by the pid file; a supervisor that kills the server (`desktop-app.Gateway shutdown and app quit`) therefore ends the Gateway group itself. Supervision as a process group is proven on macOS; on Windows and Linux it is asserted by the gateway contract suite, which runs on each host operating system (`server-api.OpenClaw surface dependencies and fallbacks`). [NEW]

#### Scenario: Start and readiness
- **WHEN** the server starts on an empty data directory
- **THEN** it writes the Gateway configuration, spawns one Gateway child bound to `127.0.0.1:<server.gatewayPort>`, and reports `gateway.state` `ready` when the link received `hello-ok`
- **AND** no socket of the host listens for the Gateway on a non-loopback address

#### Scenario: Invalid Gateway configuration
- **WHEN** the Gateway child exits with code 78 at start
- **THEN** the server runs `openclaw doctor --fix --yes --non-interactive` once and starts the Gateway once more
- **AND** when that start also exits with code 78, the state is `config_invalid`, health lists `gateway_config_invalid`, and no third start is attempted

#### Scenario: Crash loop
- **WHEN** the Gateway child exits unexpectedly 3 consecutive times
- **THEN** restarts happened after 1 s, 5 s and 30 s, the state is `crash_loop`, and health lists `core_call_unavailable` and `gateway_crash_loop`
- **AND** `jagentchill.chat.send` answers `GATEWAY_UNAVAILABLE` with `details.reason` `crash_loop`, while `jagentchill.sync.ops.push`, a blob upload and a `media.proxy` job succeed

#### Scenario: Planned restart announced by the Gateway
- **WHEN** the Gateway sends a `shutdown` event with `restartExpectedMs` 2 000 and closes the link with code 1012
- **THEN** the server spawns no new child, the link is ready again within 32 seconds, and `gateway.restarts` is unchanged

#### Scenario: Clean stop
- **WHEN** the server receives `SIGTERM` while the Gateway is ready
- **THEN** within 10 seconds the Gateway child has exited, the server has exited, and nothing listens on `server.port` or `server.gatewayPort`

#### Scenario: Gateway left behind by a killed server
- **WHEN** the server process is killed with `SIGKILL` and started again
- **THEN** the Gateway process group recorded in the pid file in `run/` is killed, with the agent CLIs it started, before a new child is spawned, the new Gateway binds the same port, the link is established, and exactly one Gateway process uses the data directory

#### Scenario: Stop while an agent turn runs
- **WHEN** the server receives `SIGTERM` while a turn of a CLI runtime is running a command
- **THEN** within 10 seconds no process of the Gateway's group remains (the Gateway, the agent CLI and the command), nothing listens on `server.port` or `server.gatewayPort`, the pid file is gone, and at the next start the turn's timeline ends with `turn_failed` and `UNAVAILABLE`

#### Scenario: Pid file names another program
- **WHEN** the pid recorded in the pid file was reused by a process that is not the Gateway of this data directory
- **THEN** the server signals nothing, removes the pid file and starts a new Gateway

#### Scenario: Link drops while the Gateway keeps running
- **WHEN** the gateway link is cut for 40 seconds while the Gateway process lives and a turn with a pending host-command approval is running
- **THEN** the turn is closed as `turn_failed` with `UNAVAILABLE` and its approval as `expired` when the link is lost, and when the link is ready again the server aborts that run and denies the approval the Gateway still holds, so that the command never runs

#### Scenario: Manual restart after a crash loop
- **WHEN** an admin device calls `jagentchill.diagnostics.service.restart { service: "gateway" }` in state `crash_loop` and the Gateway then starts
- **THEN** the state returns to `ready`, health no longer lists the Gateway reasons, and agent methods work again without any client reconnecting

### Requirement: Gateway link
The server SHALL talk to the Gateway through exactly one connection per server process, the **gateway link**: OpenClaw's reference client library `@openclaw/gateway-client`, connected to `ws://127.0.0.1:<server.gatewayPort>` with protocol version 4 only (`minProtocol` and `maxProtocol` both 4), client mode `backend`, role `operator`, the Gateway token and the server's Ed25519 link identity (`server-api.Gateway secrets`), requesting exactly the scopes `operator.read`, `operator.write`, `operator.admin` and `operator.approvals`, and declaring exactly the client capabilities `caps: ["approvals", "exec-approvals", "plugin-approvals"]`. The capabilities are a security condition and not a formality: a link that does not declare them is not counted by the Gateway as an approval reviewer, and the Gateway then denies every approval request by itself without emitting any event (measured: `docs/decisions/0002-own-server-gateway-sidecar.md` row 15), so no approval would ever reach a device. The link is established when `hello-ok` arrives granting all four scopes; before the server reports the Gateway `ready` it SHALL additionally have applied the host-command approval policy of `platform-skeleton.Gateway run profile` (item 18) and re-attached its approval and tool-call listeners, so that no turn can start on a link that cannot see approvals. A `hello-ok` with fewer scopes, or an answer that asks for a pairing approval (which a loopback connection with the token does not get on the pinned tag), is state `link_refused`: the server SHALL NOT approve its own pairing or widen its scopes by editing Gateway state, reports `core_call_unavailable`, and the doctor names the cause. The version of `@openclaw/gateway-client` the server is built with SHALL equal the pinned OpenClaw tag in `gateway/OPENCLAW_VERSION`; a mismatch fails the gateway contract suite, and a server that finds at `hello-ok` a Gateway of another version than its client library stops the supervisor in state `config_invalid` with `lastError` `version_mismatch`. The link reconnects by the client library's policy with delays between 1 s and 30 s. The server consumes Gateway events only from the link and never forwards one unmapped (`server-api.Agent stream events and gap recovery`); every request on the link goes through `coreCall` (`server-api.Gateway calls over the link`). Nothing of the link is ever exposed to a device: no RPC result, event, health field, log line or diagnostics bundle carries the token, the link identity or the granted scopes, and no channel P method takes a Gateway method name. **Gateway contract suite.** `pnpm jagentchill:test:gateway-contract` SHALL run against the built Gateway of the pinned tag, supervised by the real supervisor, and assert: the start, readiness, exit-code-78 and `shutdown`/1012 behaviour of `server-api.Gateway supervision and lifecycle`; `hello-ok` on protocol 4 with the four scopes and no manual pairing step; that every method of `CORE_METHODS` exists and accepts the parameter shape the server sends; that every Gateway event the server consumes is emitted with the fields the server reads; a configuration change at run time with `config.get` and `config.patch { raw, baseHash }`; one agent turn started by the server that calls a server tool and whose `agent` tool events carry `sessionKey`, `toolCallId` and `name`; a host command of a `guarded` session that raises an approval request on the link (carrying `sessionKey`, `toolCallId`, the command and `allowedDecisions`) when the link declares the three approval capabilities, is run after `approval.resolve { id, kind, decision: "allow-once" }` and is not run after `deny`, and the same command being denied without any event on a link that omits the capabilities; a session created with `permissionMode: "read-only"` refusing a host command; stopping the Gateway during a running turn leaving no process of its group and no bound port; MCP discovery of the agent tool endpoint (`openclaw mcp probe jagentchill --json` lists every catalogue tool by its base name behind the runtime's prefix, with no diagnostic); that no plugin with an id starting `jagentchill` is loaded; and that the gateway-client version equals `gateway/OPENCLAW_VERSION`. Raising the OpenClaw pin consists of changing `gateway/OPENCLAW_VERSION`, pulling and building the Gateway, and passing this suite (`platform-skeleton`, design D1). [NEW]

#### Scenario: Link established with the four scopes
- **WHEN** the server links to a freshly started Gateway on the pinned tag
- **THEN** `hello-ok` arrives without a pairing approval step, and `models.list`, `config.get`, `tools.catalog`, `sessions.list` and `agents.list` answer over the link

#### Scenario: Fewer scopes granted
- **WHEN** the Gateway answers `hello-ok` without `operator.approvals`
- **THEN** the link state is `link_refused`, health lists `core_call_unavailable`, no Gateway state file is edited by the server, and the doctor names the missing scope

#### Scenario: Link without the approval capabilities
- **WHEN** the gateway contract suite connects a link that omits `caps` and a `guarded` session runs a host command outside the allowlist
- **THEN** no approval event arrives on that link and the command does not run; with the three capabilities declared the same command raises an approval request that the server answers

#### Scenario: Client library and Gateway differ
- **WHEN** the gateway contract suite runs with a `@openclaw/gateway-client` version that differs from `gateway/OPENCLAW_VERSION`
- **THEN** the suite fails and names both versions

#### Scenario: Link is invisible to devices
- **WHEN** the conformance run records every channel P result, event, health response and diagnostics bundle of an `admin` device
- **THEN** none contains the Gateway token, the link identity's keys, the string `operator.` or the Gateway port

### Requirement: Gateway secrets
The server SHALL generate by itself, at first start, and SHALL never accept from a client or an RPC: (a) the **Gateway token** — 32 CSPRNG bytes in base64url, file `<dataDir>/secrets/gateway-token`, the shared token of the supervised Gateway; (b) the **link identity** — an Ed25519 key pair, file `<dataDir>/secrets/gateway-device.json`, used only to sign the Gateway's `connect` challenge on the gateway link; (c) the **tool endpoint secret** — 32 CSPRNG bytes in base64url, file `<dataDir>/secrets/tool-endpoint`, the bearer value of the agent tool endpoint. Each file SHALL be owner-only (POSIX mode `0600`; on Windows an ACL for the current user only), written atomically, and covered by the permission check of `server-api.Host data store`. None of the three SHALL ever be sent to any client or placed in a pairing offer, a `ready` frame, an RPC result, an event, a log line, an audit record, a diagnostics bundle or a backup, and none is listed, written or deleted through `server-api.Secret write and read surface`. They reach the Gateway only as follows: the token as `gateway.auth.token` in the owner-only Gateway configuration file, and never in the Gateway child's environment; the tool endpoint secret in `mcp.servers.jagentchill.headers` of that file, through a file SecretRef where the pinned Gateway accepts one in that field and otherwise as the literal value — these two are the only JAgentChill secrets the Gateway configuration file is allowed to hold. They are distinct from the product's Gateway identity key (the key behind `gatewayId`, `device-pairing-signing`), which signs handshakes towards devices and is never presented to OpenClaw, and the Gateway token is accepted by no route of the server. No process — the Gateway child, FFmpeg, the render host, the ingress helper, the server's own PTY terminals, and whatever the Gateway starts — SHALL have any of the three in its environment (`security-privacy.Environment stripping for child processes`). `jagentchill gateway restart --rotate-secrets` and a restore generate a new token and a new tool endpoint secret, rewrite the Gateway configuration and restart the Gateway; no client notices beyond the `GATEWAY_UNAVAILABLE` window. [NEW]

#### Scenario: First start generates the secrets
- **WHEN** the server starts on an empty data directory on macOS, Windows and Linux
- **THEN** `secrets/gateway-token`, `secrets/gateway-device.json` and `secrets/tool-endpoint` exist, readable by the owner only

#### Scenario: No client ever receives them
- **WHEN** the conformance run records every byte the server sends to an `admin` device, including `jagentchill.secret.list`, `jagentchill.settings.host.get`, health and the diagnostics bundle
- **THEN** none of the three values, and no private key of the link identity, occurs in the recording

#### Scenario: Gateway token on a product route
- **WHEN** a request to a signed route or to the channel P WebSocket carries the Gateway token as a bearer value and no device signature
- **THEN** the response is HTTP 401 `SIGNATURE_MISSING` (or close code 4401 on the socket) and no handler runs

#### Scenario: Rotation
- **WHEN** the operator runs `jagentchill gateway restart --rotate-secrets`
- **THEN** the token and tool endpoint secret files hold new values, the Gateway restarts and links with them, a request to `/agent-tools/mcp` with the old bearer value answers HTTP 401, and an audit record with actor `host-cli` exists that contains neither value

### Requirement: Agent session relay
The server SHALL relay all agent session traffic between devices and the Gateway (decision A1). The client-facing methods and events are the typed `jagentchill.session.*` and `jagentchill.chat.*` surface owned by `chat-agent.Session and chat RPC surface` and its delegates; there is no generic pass-through method and `jagentchill.session.relay` does not exist. This requirement fixes what every such method does on the host. For each call the server SHALL, in order and before any core call: (1) authenticate the device (`server-api.Device attestation gate and scope enforcement`); (2) check the method's JAgentChill scope; (3) check `server-api.Session ownership and visibility` for the named session; (4) apply the class and runtime policy of `agent-runtimes.Runtime policy enforcement on the host`; then (5) call the core through `server-api.Gateway calls over the link`. A refused call changes nothing. The relay operations and their core methods are exactly:

| Operation | Gateway method called over the link | Scope and gate |
|---|---|---|
| create | `sessions.create`, always with an explicit `permissionMode` out of OpenClaw's `read-only`, `guarded`, `workspace`, `full`, because a Gateway session created without one runs host commands unasked (measured: `docs/decisions/0002-own-server-gateway-sidecar.md` row 13): `read-only` for every creative-class session whatever its product mode (the product mode of a creative session is enforced on `jc_*` tools at the tool endpoint), and for a workspace-class session the value that `agent-runtimes.Runtime modes catalogue` maps from the requested product mode — `read-only` for Ask and Plan, `guarded` for Edit (the default), `workspace` for Auto; `full` is never a creation value and is reached only through the unattended grant; a create or patch whose resolved `permissionMode` is absent is refused by the server with `INTERNAL` before the link is used — (session key `agent:<agentId>:jc:<uuid>`; the server writes the session record with owner, class, access and project binding in the same transaction; the record holds no credential and nothing the model has to carry, because tool calls are bound to the session by `server-api.Agent tool endpoint and session binding`) | `jagentchill.agent.use`; a workspace-class agent or runtime additionally needs role `admin`, or role `editor` while `agents.allowWorkspaceAgentsForEditors` is on |
| list, describe | server store, refreshed from `sessions.list` / `sessions.describe` | `jagentchill.projects.read`; rows filtered by the read rule |
| patch (model, runtime, thinking level, permission mode, tool overrides, title) | `sessions.patch` | act rule; an unattended permission mode needs `jagentchill.config.write`; a patch that would change the class is refused with `AGENT_CLASS_DENIED` |
| send, steer, follow-up | `chat.send` (`sessions.send` for queue modes) | act rule; the server records the run initiator first (`server-api.Run initiator attribution and host-execution gating`) |
| abort | `chat.abort` / `sessions.abort` | act rule |
| history | `chat.history`, normalised into timeline rows | read rule |
| subscribe, unsubscribe | one Gateway subscription per session on the link, fanned out by the server | read rule, re-checked on every delivery |
| fork, rewind, compact, delete, import | `sessions.fork`, `sessions.rewind`, `sessions.compact`, `sessions.delete`, the import calls of capability `agent-runtimes` | act rule; methods the core reserves for its administrator scope depend on spike S12 |
| files, diff, artifacts of a session | `sessions.files.*`, `sessions.diff`, `artifacts.*` | read rule for reads and `jagentchill.host.exec` for writes outside the session's working directory (`workspaces-terminal.Role and permission matrix`) |
| approvals, plans, questions | `server-api.Approval and question resolution` | resolver rule |

A Gateway session for which the server has no record (created on the host with the `openclaw` command) is not listed and not addressable on channel P. The OpenClaw scopes used on these calls are those of the server's own link identity, fixed per method in `CORE_METHODS`, and are never derived from or granted to a device. While the gateway link is down, list, describe and the timeline fetch answer from the server's store and every other operation of the table answers `GATEWAY_UNAVAILABLE`. Limits: at most `limits.maxConcurrentTurns` running turns per host (owner `chat-agent`); 600 relay calls per device per minute inside the RPC limit. Fidelity of the relay — text deltas, tool start/update/end events, usage, approvals, questions, and the session lifecycle, for each runtime — is gated by spike S21 (`diagnostics-quality.Gating spikes`): a runtime for which a required item cannot be relayed over the link is not offered (it reports `status: "unavailable"` with `runtime/relay-unsupported`, `agent-runtimes.Error mapping`), and an item recorded as degraded is published in the capability matrix. [NEW]

#### Scenario: Call order
- **WHEN** a `viewer` device calls `jagentchill.chat.send` for a session it can read
- **THEN** the call fails at step 2 with `SCOPE_DENIED` and `details.requiredScope` `jagentchill.agent.use`, and the contract test observes no core call

#### Scenario: Editor sends into an admin's workspace session
- **WHEN** an `editor` device calls `jagentchill.chat.send` naming a workspace-class session owned by an `admin` device, with `agents.allowWorkspaceAgentsForEditors` on or off
- **THEN** the call fails at step 3 with `NOT_FOUND` and no turn starts

#### Scenario: Session created outside the server
- **WHEN** the operator creates a session with the host's `openclaw` command and a device calls `jagentchill.session.get` with that key
- **THEN** the response error code is `NOT_FOUND`

#### Scenario: Runtime that cannot be relayed
- **WHEN** the S21 record of a CLI runtime says tool events cannot be observed on the gateway link
- **THEN** that runtime's snapshot is `unavailable` with `runtime/relay-unsupported` and creating a session on it is refused

#### Scenario: No pass-through
- **WHEN** the contract test inspects every schema of the `session` and `chat` domains
- **THEN** none has a parameter that names a core method, an OpenClaw scope or a raw core parameter object

#### Scenario: No session without a permission mode
- **WHEN** the server creates a creative-class session in product mode `edit`, a workspace-class session in `edit` and a workspace-class session in `ask`
- **THEN** the three `sessions.create` calls carry `permissionMode` `read-only`, `guarded` and `read-only`, and the contract test `session-permission-mode` fails for any code path that sends `sessions.create` without the field

### Requirement: Session ownership and visibility
Every agent session SHALL have a server record `{ sessionKey, ownerDeviceId, ownerState: "active" | "orphaned", agentClass: "creative" | "workspace", access: "host" | "private", projectId?, workspaceId?, origin: "device" | "automation" | "workflow" | "agent", created_ms }`, and the server SHALL evaluate the rules below against the caller's CURRENT device record on every relay call, every stream delivery and every approval answer — never a value cached at subscribe time. `ownerDeviceId` is the creating device; for a session created by an automation, a workflow or an agent it is the owner of the origin (the device that enabled the automation, started the run, or owns the root of the agent tree). `access` defaults to `private` for every session; the owner or an `admin` can set a creative-class session to `host` with `jagentchill.session.access.set`, and a workspace-class session is always `private` (decisions D1 and E7).

| Caller | Read (list row, describe, history, stream, files, diff, artifacts, approvals list) | Act (send, steer, abort, patch, fork, rewind, delete, bind) |
|---|---|---|
| owner | yes | yes, with `jagentchill.agent.use` (a workspace-class session additionally needs the owner to be `admin`, or `editor` while `agents.allowWorkspaceAgentsForEditors` is on — turning the setting off freezes an editor's workspace sessions: read stays, act is refused) |
| `admin`, not owner | yes | yes |
| `editor`, not owner | creative-class with `access: "host"` only | creative-class with `access: "host"` only; never another owner's workspace-class session, whatever the setting |
| `viewer`, not owner (a viewer owns no session) | creative-class with `access: "host"` only: transcript and project artifacts; never a workspace-class session, its transcript, files, diff, terminal output, runtime configuration or logs | never |

A session the caller cannot read is absent from lists and answers `NOT_FOUND` when named (never `SCOPE_DENIED`, so its existence is not disclosed); a session the caller can read and cannot act in answers `SCOPE_DENIED` with `details.requiredRole` or `details.reason: "not_owner"`. The delegated methods of this requirement are `jagentchill.session.access.get { sessionKey }` (read rule) and `jagentchill.session.access.set { sessionKey, access?, ownerDeviceId? }` — the owner or an `admin` can switch a creative-class session between `host` and `private`; only an `admin` can assign a new owner, which is how an `orphaned` session (its owner was revoked, `device-pairing-signing.Revocation`) is taken over; an orphaned session is readable and assignable by `admin` devices only and no turn can be started in it until it has an owner. Changes are audited as `session.access.changed`, announced with `jagentchill.session.updated`, and end within 1 second the stream subscriptions of devices that lost read access. Host viewers of other data follow the same boundary: `viewer` devices get no host logs (`GET /diagnostics/bundle` needs `jagentchill.config.write`), no secret hints, and no workspace file content of external workspaces (`workspaces-terminal.Role and permission matrix`). Child agents inherit the record of their tree root (`multi-agent-orchestration.Ownership checks along the tree`). [NEW]

#### Scenario: Editor cannot prompt another owner's workspace session
- **WHEN** admin A created a workspace-class session and editor E, with "Allow workspace agents for editors" on, lists sessions and then calls `jagentchill.chat.send` with A's session key
- **THEN** the session is absent from E's list and the call answers `NOT_FOUND`

#### Scenario: Viewer reads a shared creative session only
- **WHEN** a `viewer` opens a creative-class session with `access: "host"` and then requests the history of a workspace-class session and of a `private` creative session
- **THEN** the first succeeds read-only and the other two answer `NOT_FOUND`

#### Scenario: Access removed during a stream
- **WHEN** the owner switches a session to `private` while an `editor` is subscribed to its stream
- **THEN** within 1 second the editor's subscription ends, no further `jagentchill.chat.stream` event of that session reaches it, and the session disappears from its list

#### Scenario: Orphaned session
- **WHEN** the owner device of a session is revoked
- **THEN** the session has `ownerState: "orphaned"`, an `admin` can read it and assign it with `jagentchill.session.access.set`, and an `editor` receives `NOT_FOUND`

#### Scenario: Setting turned off
- **WHEN** an admin turns "Allow workspace agents for editors" off while editor E owns a workspace-class session with a running turn
- **THEN** E can still read the session, E's next send or approval answer is refused with `SCOPE_DENIED`, and the running turn's pending host-execution approvals wait for an `admin`


### Requirement: Agent stream events and gap recovery
The server SHALL consume the Gateway's events of a session over the gateway link (`agent`, `session.message`, `chat`, `session.tool`, session lifecycle, approval and question events; observed in a real turn so far are `session.message`, `agent` — whose items of `kind: "tool"` carry the tool calls — and `chat` ending with `state: "final"`, and the others are asserted by the gateway contract suite) through one subscription per session, kept while at least one device is subscribed or a turn runs, and SHALL deliver them to devices only as the targeted channel P event `jagentchill.chat.stream` on stream `chat:<sessionId>`, whose payload shapes are owned by `chat-agent.Stream event envelope with seq and epoch`. This requirement fixes the transport guarantees the server gives: (1) **Persist before send** — every canonical timeline row change (message, reasoning, tool call start, tool call update, tool call end with status and result summary, proposal, plan, sub-agent activity, error) is written to the server's timeline store with the next `seq` of that session before it is sent, so the store is always at least as new as any device; `seq` increases by exactly 1 per row change within an `epoch`. (2) **Order** — events of one session are sent to one connection in `seq` order; text deltas of a row are sent in `deltaIndex` order and never after the row change that supersedes them. (3) **Coalescing and back-pressure** — text deltas are coalesced to at most one event per row per 50 ms; when a connection's send buffer exceeds 1 048 576 bytes the server drops that connection's pending text deltas only (the device catches up from the next row update) and never drops a row change, a terminal turn event, an approval or a question. (4) **Gap recovery** — a device that sees a `seq` gap, a new `epoch`, or reconnects calls the pull method `jagentchill.chat.timeline.fetch`, whose one parameter shape is owned by capability `chat-agent` — `{ sessionId, direction: "after" | "before" | "tail", cursor?: { epoch, seq }, limit }` with at most 200 rows per call (`chat-agent.Stream gap recovery`, `chat-agent.Initial load and history paging`; a cursor with an unknown `epoch` returns the timeline from the start with the new `epoch`) —, applies the rows, and only then applies newer events; `ready.resumed` with the per-stream `seq` (`device-pairing-signing.Session resume`) tells it whether a fetch is needed. (5) **Tool events** — a tool call is one row whose updates carry `{ toolCallId, name, label, state: "running" | "waiting_approval" | "succeeded" | "failed" | "denied", startedAt_ms, endedAt_ms?, inputSummary, resultSummary?, errorCode? }`; inputs and results are summarised to at most 4 096 bytes each in the stream and available in full through the timeline fetch for devices that can read the session. (6) **Usage** — the turn's usage (`inputTokens`, `outputTokens`, cache read and write tokens, cost when the runtime reports it, model and runtime) is delivered as `usage_updated` at least at turn end and recorded by `usage-tracking.Capture from Gateway events with reconciliation`. (7) **Turn end is never lost** — exactly one of `turn_completed`, `turn_failed`, `turn_cancelled` is persisted and delivered for every `turn_started`, including after a restart or crash of the Gateway or of the server, when the server closes interrupted turns as `turn_failed` with `UNAVAILABLE`. A core event the server cannot map is logged once per kind as `relay.unmapped_event` and never forwarded raw. Which of these items each runtime supports is measured by spike S21 and published in the capability matrix. [NEW]

#### Scenario: Gap after a reconnect
- **WHEN** a device last applied `seq` 41 of a session, reconnects after 20 seconds and receives `seq` 47
- **THEN** it calls `jagentchill.chat.timeline.fetch` with `direction: "after"` and a cursor at `seq` 41, applies rows 42 to 46, then applies 47, and its timeline equals the host's

#### Scenario: Slow connection during a long answer
- **WHEN** a phone on a slow link falls 2 MiB behind while an answer streams
- **THEN** its pending text deltas are dropped, the next `row_updated` carries the accumulated text, and the turn's tool rows and `turn_completed` are all delivered

#### Scenario: Tool call lifecycle
- **WHEN** an agent calls a `jc_*` tool that needs an approval and then succeeds
- **THEN** subscribers see one tool row move through `running`, `waiting_approval`, `running` and `succeeded` with increasing `seq`

#### Scenario: Gateway restart mid-turn
- **WHEN** the Gateway restarts while a turn is streaming
- **THEN** after restart the timeline holds `turn_failed` with `UNAVAILABLE` for that run, and a reconnecting device receives it through the fetch

#### Scenario: Subscriber loses read access
- **WHEN** a device's role changes so that it can no longer read a session it is subscribed to
- **THEN** no event of that session is sent to it after the change, and its fetch answers `NOT_FOUND`


### Requirement: Approval and question resolution
Every approval, plan sign-off and question that an agent turn raises SHALL be held and resolved by the server; no device ever calls a core approval method and the server is the only holder of `operator.approvals`, so the server always knows which device answered and can restrict who is allowed to (design D7, D25). **Sources.** (a) Server-raised: a `jc_*` tool call that needs approval (`agent-editing-tools.Approval for out-of-project effects`, cost guard, skill writes, publishing, terminal and script tools) is answered by the server's tool endpoint, before any effect, with the tool error `APPROVAL_PENDING:<requestId>`, and a relay operation that enters an unattended mode raises the same kind of request from its handler; the server stores the request keyed by the SHA-256 of `(sessionKey, toolName, canonical JSON of the parameters)`, and an `allow` lets the agent's identical retried call pass exactly once within 1 800 000 ms. (b) Runtime-raised: the native approval and question requests of the Gateway and of CLI and ACP runtimes arrive as events on the gateway link — only on a link that declares the approval capabilities of `server-api.Gateway link` — as `plugin.approval.requested` or `exec.approval.requested`, each with an `id`, a `request` object (`sessionKey`, `toolCallId`, the tool name, the command or detail) and the list `allowedDecisions`, and end with the matching `.resolved` event. Which of the two names a request has depends on the runtime and not on its content: the native tool approvals of the Claude Code runtime (`claude-cli`), host commands included, arrive as `plugin.approval.requested` (measured: `docs/decisions/0002-own-server-gateway-sidecar.md` rows 15 and 16), and the `exec.approval.*` kind of the embedded runtime is expected and not yet observed (spike S21). The server treats both alike, keeps the kind (`plugin` | `exec`) with the request, and answers every one with the single Gateway method `approval.resolve { id, kind, decision }` (and `question.resolve` for the question flow; the Gateway's pending-approval list for reconciliation after a restart), all members of `CORE_METHODS`. The only decisions the server ever sends are `allow-once` and `deny`: it never sends a standing decision (an `allow-always` would write into the Gateway's allowlist, which the server keeps empty, `platform-skeleton.Gateway run profile`), a request whose `allowedDecisions` lacks `allow-once` can only be denied, and a product decision `allow-session` on a kind that permits it is kept as a server-side rule and sent as `allow-once` each time. A request that names a session the server has no record of, or whose event lacks a `sessionKey`, is denied by the server at once and audited — no device is entitled to answer it. The server answers only after the resolver rule below passed, and while the link is down a resolve of a runtime-raised request answers `GATEWAY_UNAVAILABLE`; a link that is lost, or a Gateway or server that stops, ends every pending runtime-raised request as `expired` with resolver `{ kind: "system", reason: "gateway_restart" }` — the Gateway has discarded it together with its run — and `permission_resolved` with that state reaches every reader, so that no card stays answerable for a request that no longer exists. **Record.** `{ requestId, sessionKey, runId, source, kind, toolLabel, detail, requiredScope, adminOnly, state: "pending" | "allowed" | "denied" | "expired", resolver?: { kind: "device", deviceId } | { kind: "agent", sessionId } | { kind: "policy", id } | { kind: "system", reason }, decision?, reason?, created_ms, decided_ms?, expires_ms }`. **Resolver rule**, checked by the server before anything is released: the answering device must be able to act in the session (`server-api.Session ownership and visibility`) AND hold the scope of the request kind:

| Kind | Scope needed to answer |
|---|---|
| `out-of-project` | `jagentchill.agent.use` and `jagentchill.projects.write` |
| `cost` | `jagentchill.generation.run` |
| `publish` | `jagentchill.export.run` |
| `host-exec` — commands, terminal keys, workspace script start and stop, git mutations, file writes outside the working directory, and every runtime-raised native approval of a workspace-class session | `jagentchill.host.exec` (role `admin` only; `adminOnly: true`) |
| `skill-write`, `unattended` | `jagentchill.config.write` (role `admin` only; `adminOnly: true`) |
| `plan`, `question` | `jagentchill.agent.use` |

Client methods are those of capability `chat-agent` (`jagentchill.chat.approval.list`, `jagentchill.chat.approval.resolve`, `jagentchill.chat.plan.resolve`, `jagentchill.chat.question.answer`); events are the `permission_*`, `plan_*` and `question_*` items of the session stream, and a request is additionally announced to devices that satisfy the resolver rule as the notification kind named by its owner. A resolve from a device that fails the rule answers `SCOPE_DENIED` (with `details.requiredScope`) and leaves the request pending; a second answer answers `ALREADY_RESOLVED`; the first valid answer wins across devices and `permission_resolved` reaches every reader within 1 second with the resolver's device name. The resolver and decision are written to the audit record of the tool call (`approval.resolved`). An agent or policy can resolve only where `multi-agent-orchestration.Common approval policy` allows it, and never a kind marked `adminOnly`. Sign-offs of the common approval policy of capability `multi-agent-orchestration` (results, proposals, plans, escalated reviews) are not rows of the kind table: they are server-owned records answered with `jagentchill.orc.signoff.resolve` under that capability's own resolver rule, and they never release a `host-exec` request, which stays admin-only in every tree. Unanswered requests expire after the timeout of their owner (1 800 000 ms for approvals) with `APPROVAL_TIMEOUT`, resolver `{ kind: "system", reason: "timeout" }`; the server itself denies a runtime-raised request with resolver `{ kind: "system", reason: "BUDGET_EXCEEDED" }` when a hard-stop budget of the session is exhausted (`usage-tracking.Budgets hook`), and that denial is shown on the card as "Budget reached"; revocation or demotion of the only eligible device re-announces the request to the remaining eligible devices and never auto-allows. After a restart of the Gateway or of the server, pending server-raised requests are restored from the store (their run was closed as `turn_failed`, so a restored request whose run no longer exists is closed as `expired`), and runtime-raised ones were already closed as `expired` when the link was lost; when the link is ready again the server reads the Gateway's pending-approval list and denies every entry it finds there, since none can belong to a run the server still tracks. No restart, of either process, ever turns a pending request into an allowed one. [NEW]

#### Scenario: Editor answers a host-execution approval
- **WHEN** a workspace-class session shows a command approval and an `editor` device that can read the session calls `jagentchill.chat.approval.resolve` with `allow-once`
- **THEN** the response is `SCOPE_DENIED` with `details.requiredScope` `jagentchill.host.exec`, the request stays pending, the command does not run, and the card on that device reads "Waiting for an admin device"

#### Scenario: Admin answers and is recorded
- **WHEN** an `admin` phone allows the same request
- **THEN** the server answers the runtime over the gateway link, the command runs, `permission_resolved` names the phone, and the audit record of the tool call holds `resolver.deviceId` of the phone

#### Scenario: Server-raised approval and retry
- **WHEN** a creative agent calls a tool that needs a cost approval, a device with `jagentchill.generation.run` allows it, and the agent retries the identical call
- **THEN** the first call was answered by the tool endpoint with `APPROVAL_PENDING:<requestId>`, the retry passes once, and a third identical call needs a new approval

#### Scenario: Two devices answer
- **WHEN** two admin devices answer the same request 100 ms apart with different decisions
- **THEN** the first is applied and the second receives `ALREADY_RESOLVED`

#### Scenario: Core approval method is not a client method
- **WHEN** any device sends `approval.resolve`, `plugin.approval.resolve` or `exec.approval.resolve` as a channel P method
- **THEN** the response error code is `NOT_FOUND` with `details.reason` `unknown_method`

#### Scenario: Restart with a pending approval
- **WHEN** the Gateway restarts while a host-execution approval is pending
- **THEN** the request is closed as `expired` with resolver `{ kind: "system", reason: "gateway_restart" }`, every device that showed its card receives `permission_resolved` within 1 second of the link loss, the command never runs, and a resolve sent afterwards answers `ALREADY_RESOLVED`

#### Scenario: Native approval of the Claude Code runtime
- **WHEN** a `guarded` workspace session on `claude-cli` wants to run a host command outside the allowlist and an `admin` device allows it once, and then a second command is denied
- **THEN** the server received `plugin.approval.requested` for both, sent `approval.resolve` with `kind` `plugin` and `allow-once` for the first and `deny` for the second, the first command ran and the second did not, and both audit records name the admin device

#### Scenario: Approval for a session the server does not know
- **WHEN** an approval request arrives on the link for a session key that has no server record
- **THEN** the server answers it with `deny` at once, no device receives a card, and an audit record is written

#### Scenario: No standing decision reaches the Gateway
- **WHEN** the contract test records every `approval.resolve` the server sends during the approval cases
- **THEN** every `decision` is `allow-once` or `deny`, and the Gateway's exec allowlist is still empty afterwards


### Requirement: Run initiator attribution and host-execution gating
A tool call reaches the server's tool endpoint on an MCP connection that the server has bound to its session (`server-api.Agent tool endpoint and session binding`), and the Gateway's tool-call and approval events carry `agentId`, `sessionKey`, `sessionId` and `runId`; neither carries a device or connection identity, so the server SHALL keep the attribution itself. Before every turn it starts through the relay it records `{ runId, sessionKey, initiator: { kind: "device", deviceId } | { kind: "automation", id } | { kind: "workflow", runId } | { kind: "agent", sessionId }, permitted: { hostExec: boolean } }`, where `permitted.hostExec` is true only when the session is workspace-class and the initiator was allowed to act in it at that instant under `server-api.Session ownership and visibility` (for a non-device initiator: the owner device of the origin, and for unattended runs the admin pre-approval of `security-privacy.Unattended operation safeguards`). The server has no hook inside the Gateway; it SHALL enforce the rules below, for every agent class and whatever the permission mode, at the two places where it meets a tool call — its own tool endpoint for `jc_*` tools, and, for OpenClaw's native tools, the Gateway tool policy and agent configuration that only the server writes together with the Gateway's approval requests and tool-call events that only the server receives: (1) on a creative-class session, every native tool for command execution, processes, the native `terminal` tool, native file tools, browser control, node invocation, web fetch and search is absent from the agent's tool policy (`security-privacy.Agent tool sandbox`); as a second line the server denies every native approval request raised by a creative-class session (reason `creative_agent`) and, when a tool-call event of such a tool appears for a creative-class session, aborts the run (`chat.abort`), closes the turn as `turn_failed` with `SCOPE_DENIED` and writes an audit record. One exception keeps the product's own tools usable: an approval request whose tool is one of the server's own `jc_*` tools (the tool name, after removal of the runtime's prefix, is in the tool manifest and the MCP server is `jagentchill`) is not a native approval — where a runtime raises one for such a call in a given permission mode, the server answers it `allow-once` by itself, for every agent class, when the session has a server record, because the call then arrives at the tool endpoint, which is where class, mode, approval and budget are enforced for `jc_*` tools; whether and in which permission modes each runtime raises such a request is recorded per runtime by spike S21, and the resolver of these answers is `{ kind: "system", reason: "own_tool" }`; (2) on a workspace-class session, the server writes the host-command approval policy of `platform-skeleton.Gateway run profile` (item 18: `security: "allowlist"`, `ask: "on-miss"`, `askFallback: "deny"`, with an allowlist the server keeps empty) so that every exec, process, `terminal` and file-write call of a `guarded` session raises a Gateway approval request instead of being refused or run silently, denies with `SCOPE_DENIED` every such request whose `runId` has no record with `permitted.hostExec: true`, and refuses at the tool endpoint every `jc_terminal_*` and `jc_workspace_script_*` call of such a run — this covers a session or turn that did not come through the relay; (3) calls that need a person are turned into approvals (`server-api.Approval and question resolution`); (4) the protected paths of `security-privacy.Workspace agent safeguards` are always blocked: at the tool endpoint for `jc_*` tools, and for native tools by denying an approval request whose command or path touches one and by the tool policy the server writes. A session that the server finds on a workspace runtime without a server record is never driven by a device, is listed by the security audit collector as `warn unmanaged-session`, and its tool calls fall under rule (2). A runtime whose native tool calls raise no approval request and no tool-call event that the server can see on the link (`nativeToolCoverage: false` in the capability matrix of `agent-runtimes.Published capability matrix`) cannot be held to rules (2) and (3): such a runtime SHALL be offered for workspace-class sessions only to `admin` owners, its sessions are never readable or drivable by an `editor`, and its creation dialog states "This runtime runs its own tools without host approval prompts". Whether `runId` attribution, denial and abort hold on each runtime is part of spike S21. [NEW]

#### Scenario: Turn without a permitted initiator
- **WHEN** a turn of a workspace-class session is started by something other than the relay and the agent calls an exec tool
- **THEN** the server denies the Gateway approval request of that call with `SCOPE_DENIED`, the command does not run, and an audit record names the session and run

#### Scenario: Creative agent and the core terminal tool
- **WHEN** a creative agent's tool policy was changed by hand so that the native `terminal` tool is offered, and the agent calls it
- **THEN** the server denies the approval request of the call or, when the Gateway raises none, aborts the run on the tool-call event; the turn ends `turn_failed` with `SCOPE_DENIED` and reason `creative_agent`, and the next run-profile check restores the policy

#### Scenario: Runtime asks before calling one of the server's own tools
- **WHEN** a creative-class session on a runtime whose S21 record says it raises an approval request for MCP tools in `read-only` calls `jc_clip_split`
- **THEN** the server answers that request `allow-once` with resolver `{ kind: "system", reason: "own_tool" }`, no card is shown for it, the call reaches the tool endpoint and is checked there, and a native tool request of the same session is still denied with reason `creative_agent`

#### Scenario: Job created by a tool names the device
- **WHEN** `jc_generate_image` enqueues a job in a turn that device D started
- **THEN** the job's `createdBy` is `{ kind: "agent", id: <sessionId> }` and its record carries device D from the run record

#### Scenario: Runtime without native tool coverage
- **WHEN** an `editor` with the workspace-agent setting on asks for a session on a runtime whose matrix cell is `nativeToolCoverage: false`
- **THEN** the request is refused with `SCOPE_DENIED` and `details.requiredRole` `admin`

### Requirement: RPC naming and schema ownership
Every JAgentChill RPC SHALL be a channel P `req` frame whose `method` is `jagentchill.<domain>.<verb…>` with no direction suffix, where `<domain>` is one of this closed list: `pairing`, `device`, `sync`, `blob`, `job`, `agent`, `session`, `chat`, `proposal`, `tool`, `orc`, `provider` (including the sub-namespaces `provider.auth`, `provider.endpoint`, `provider.preset`, `provider.override`, `provider.consent`, `provider.budget`), `runtime`, `usage`, `skill`, `script`, `workflow` (including `workflow.archify.project`, `workflow.archify.import`, `workflow.archify.render`, `workflow.archify.record`), `film`, `export`, `share`, `automation`, `connector`, `workspace` (including `workspace.git.*`, `workspace.script.*` and `workspace.config.*`; there is no `git` domain), `fs`, `terminal`, `settings`, `secret`, `notification`, `comment`, `presence`, `diagnostics`, `ai`, `trash`. The domain `hostcli` exists only on the server's local admin endpoint, for the server's own command line `jagentchill` (`server-api.Host command-line surface`); it is not a channel P domain and not a Gateway method. The list has 33 domains (there is no `render` domain: frames and thumbnails of the render host are produced only by server-internal jobs of kind `render.frame`, which no device starts through an RPC of its own); which requirement defines the methods of each is stated in `server-api.RPC domain ownership`. Deleted spellings that SHALL NOT appear in any schema: `providers.*`, `automations.*`, `sessions.*`, `proposals.*`, `tools.*`, `jobs.*`, `audit.*`, `sounds.*`, `git.*` (git methods and events are `jagentchill.workspace.git.*`), `prefs.*` (device preferences are local storage keys, not RPCs), `dictation.*` (the method is `jagentchill.chat.dictation.start`), `handshake.*`, `session.relay` and `session.relay.event` (there is no generic relay method), `device.gBootstrap.*`, `approval.*` as a domain (approval methods are `jagentchill.chat.approval.*`), `export.remote.start` (the method is `jagentchill.export.create`), `settings.host.update` (the method is `jagentchill.settings.host.patch`) and `runtime.refresh` (the method is `jagentchill.runtime.snapshot.refresh`). For each RPC, `packages/protocol` SHALL export two Zod schemas identified as `<method>.request` (the `params`) and `<method>.response` (the `result`), together with the method's required scope, an `idempotent` flag, an `adminProxy` flag and a `coreCall` flag (the method needs the Gateway and answers `GATEWAY_UNAVAILABLE` while the gateway link is down, `server-api.Gateway calls over the link`); `.request` and `.response` denote message direction only. Types used by client and server SHALL be inferred from these schemas; hand-written duplicate types are forbidden. Wire schemas SHALL NOT use `.transform()`, `.catch()` or `.preprocess()`. The contract test derives the allowed domain set from the protocol package constant `RPC_DOMAINS`, which SHALL equal the list above. Secret values are never RPC parameters (`server-api.Secret write and read surface`). [JAD] [NEW]

#### Scenario: Every method has both schemas
- **WHEN** the protocol test enumerates the methods handled by the server on channel P
- **THEN** each method name has an exported `.request` schema and an exported `.response` schema, a declared scope and an `idempotent` flag
- **AND** no schema exists for a method that is not handled

#### Scenario: Method outside the domain list
- **WHEN** server code adds a handler named `jagentchill.projects.list`
- **THEN** the contract test `rpc-namespace` fails with `unknown domain: projects`

#### Scenario: Direction suffix in a method name
- **WHEN** a client sends method `jagentchill.job.list.request`
- **THEN** the response error code is `NOT_FOUND` with `details.reason` `unknown_method`

### Requirement: RPC domain ownership
Every domain of `server-api.RPC naming and schema ownership` SHALL have exactly one owning capability, and the methods of a domain SHALL be exactly those named by the requirements listed for it below; a method handled by the server that none of those requirements names SHALL fail the contract test `rpc-ownership`. A capability that needs a method in a domain it does not own SHALL have it added by the owner. Sub-namespaces listed with a second owner are delegated: the delegate defines the methods under that prefix and nothing else in the domain.

| Domain | Owner and defining requirements |
|---|---|
| `pairing`, `device` | `device-pairing-signing.Pairing and device RPC surface` |
| `sync`, `blob`, `trash`, `comment`, `presence` | `cross-device-sync.Sync RPC surface` |
| `job` | `server-api.Job RPCs and events` |
| `settings` | `server-api.Server configuration` (`settings.host.*`), `server-api.Host storage accounting and cleanup` (`settings.storage.get`), `server-api.Host backup and restore` (`settings.backup.create`), `server-api.Tailnet ingress bridge` (`settings.tailnet.*`), `server-api.Product listeners and path restriction` (`settings.lan.get`, `settings.lan.certificate.set`), `server-api.Host encoder policy and codec table` (`settings.encoders.get`, `settings.encoders.install`) |
| `secret` | `server-api.Secret write and read surface` |
| `connector` | `server-api.Connectors` |
| `diagnostics` | `server-api.Audit log` (`diagnostics.audit.list`), `server-api.Service lifecycle` (`diagnostics.service.restart`, `diagnostics.shutdown.prepare`), `diagnostics-quality.Host doctor report` (`diagnostics.report`) |
| `session` | `chat-agent.Session and chat RPC surface` (the typed session methods; host behaviour of each fixed by `server-api.Agent session relay`); delegated: `session.bind` to `server-api.Agent tools and provider registration`, `session.access.*` to `server-api.Session ownership and visibility`, `session.control.*`, `session.runtime.*`, `session.handover.*`, `session.queue.*`, `session.import.*` and `session.unattended.*` to `agent-runtimes.Runtime and provider administration RPC surface`, `session.skills.*` to `skills.Skill RPC surface` |
| `chat` | `chat-agent.Session and chat RPC surface` (including `chat.approval.*`, `chat.plan.resolve` and `chat.question.answer`, whose resolver rule and host behaviour are fixed by `server-api.Approval and question resolution`) |
| `proposal` | `agent-editing-tools.Proposal visual diff` (`proposal.get {proposalId}`), `agent-editing-tools.Proposal acceptance and rejection` (`proposal.resolve`), `agent-editing-tools.Proposal revert` (`proposal.revert {proposalId, force?}`) |
| `tool` | `agent-editing-tools.Tool registration and manifest` |
| `agent` | `multi-agent-orchestration.Agent RPC surface and events` (including `agent.list {scope?: "host"}` of `multi-agent-orchestration.Host-wide Agents screen` and `agent.policy.set {preset, confirm?}` of `multi-agent-orchestration.Policy preset admin setting`); delegated: `agent.persona.*` (`list`, `get`, `duplicate`, `update`, `reset`, `delete`) to `chat-agent.Persona list and editor` |
| `orc` | `multi-agent-orchestration.Agent RPC surface and events` (teams, runs, brief, approval policy); delegated to `orc-model-routing.ORC RPC surface`, which names every method and the defining requirement of each: `orc.config.*`, `orc.restore.*`, `orc.test.*`, `orc.brief.*`, `orc.override.*` and `orc.readiness.*` (events `jagentchill.orc.config.changed` and `jagentchill.orc.test.updated`) |
| `provider` | `generation-providers.Provider RPC surface` (list, connect, key, model, voice, estimate, `provider.budget.*`, `provider.consent.*` with `list`, `grant`, `revoke` and `check`, subscribe, unsubscribe); delegated: `provider.auth.*`, `provider.endpoint.*`, `provider.preset.*` (`provider.preset.list {kind?, capability?}`), `provider.override.*`, `provider.routing.*` and `provider.pin.*` to `agent-runtimes.Runtime and provider administration RPC surface` |
| `runtime` | `agent-runtimes.Runtime and provider administration RPC surface` |
| `usage` | `usage-tracking.Usage RPC surface` |
| `skill` | `skills.Skill RPC surface` |
| `script` | `script-studio.Host replica, RPC surface and events` |
| `workflow` | `agent-workflows.Storage, RPC surface and Gateway dependency`; delegated: `workflow.archify.render` to `workflow-diagram.Archify HTML export on the host` and `workflow.archify.record` to `workflow-diagram.Motion export to WebM` |
| `film` | `film-production.Film storage, permissions and Gateway dependency` (32 methods; event `jagentchill.film.updated` on streams `film:<filmId>` and `film:hub`) |
| `export` | `export-share.Remote export contract` |
| `share` | `export-share.Share link through the Gateway` |
| `automation` | `automations.Automation record and storage` (`automation.run` by `automations.Trigger now`) |
| `workspace`, `fs`, `terminal` | `workspaces-terminal.OpenClaw reuse, channel P domains and spike gates`, `workspaces-terminal.Terminal RPC surface and size ownership` |
| `notification` | `notifications.Notification RPC surface` |
| `ai` | `ai-editing-tools.AI RPC surface` (`ai.analysis.create`, `ai.generation.create`) |

Every domain that delivers events SHALL expose `jagentchill.<domain>.subscribe` and `jagentchill.<domain>.unsubscribe` (or, for a delegated sub-namespace with its own stream, `jagentchill.<domain>.<sub>.subscribe`), defined by the same owner. [NEW]

#### Scenario: Every domain has an owner
- **WHEN** the contract test compares `RPC_DOMAINS` with the rows of this table
- **THEN** each of the 33 domains appears in exactly one row

#### Scenario: Method outside the owner's list
- **WHEN** server code adds a handler `jagentchill.film.render` that `film-production.Film storage, permissions and Gateway dependency` does not name
- **THEN** the contract test `rpc-ownership` fails and names the method

#### Scenario: Git method under the workspace domain
- **WHEN** a client subscribes to repository status
- **THEN** it calls `jagentchill.workspace.git.subscribe` and receives `jagentchill.workspace.git.updated`, and no method or event whose second segment is `git` exists

### Requirement: Request validation
The server SHALL validate the `params` of every incoming RPC against its `.request` schema before any handler logic runs, and SHALL validate every outgoing `result` against its `.response` schema in test and development builds. Unknown properties in `params` SHALL be ignored, not rejected. A request whose frame exceeds the envelope limit is handled by `server-api.Channel P frame envelope`; a request whose serialised `params` alone exceed 524 288 bytes SHALL be rejected with `PAYLOAD_TOO_LARGE`. [NEW]

#### Scenario: Missing required field
- **WHEN** a client calls `jagentchill.job.get` with `params` `{}`
- **THEN** the response has `ok: false`, `error.code` `INVALID_PARAMS`, and `error.details.issues[0].path` equal to `["jobId"]`
- **AND** no handler side effect occurs

#### Scenario: Extra field from a newer client
- **WHEN** a client sends a valid request with one additional unknown property
- **THEN** the request succeeds and the unknown property is ignored

#### Scenario: Oversized params
- **WHEN** `params` serialises to 524 289 bytes
- **THEN** the response error code is `PAYLOAD_TOO_LARGE`

### Requirement: RPC error envelope
A failed RPC SHALL respond with `ok: false` and `error` `{ code, message, retryable, details? }` where `code` is a string from the registry exported by the protocol package, `message` is an English sentence for logs (clients display localised text keyed by `code`), and `retryable` is a boolean. HTTP routes SHALL use the same object as JSON body `{ "error": { … } }`. The general codes (upper snake case) SHALL be exactly: `INVALID_PARAMS`, `PAYLOAD_TOO_LARGE`, `NOT_FOUND`, `ALREADY_EXISTS`, `CONFLICT`, `IDEMPOTENCY_CONFLICT`, `SCOPE_DENIED` (the device lacks the scope or role; `details.requiredScope` or `details.requiredRole`), `PERMISSION_DENIED` (a person declined an approval or a consent; never used for scopes), `DEVICE_NOT_ATTESTED`, `DEVICE_REVOKED`, `RATE_LIMITED` (`details.retryAfter_ms`), `QUOTA_EXCEEDED`, `UNSUPPORTED_FEATURE`, `PROTOCOL_UNSUPPORTED`, `UNAVAILABLE`, `GATEWAY_UNAVAILABLE` (the supervised OpenClaw Gateway is not ready or the gateway link is down; `retryable: true`, `details.reason`; only for methods flagged `coreCall` and for agent tools), `SESSION_UNBOUND` (an agent tool call that the server cannot bind to exactly one agent session; `retryable: true`, `details.reason` `no_session` or `ambiguous`; tool results only), `TIMEOUT`, `CANCELLED`, `INTERNAL`, `NO_PROJECT_BOUND`, `BUDGET_EXCEEDED`, `APPROVAL_TIMEOUT`, `NO_ROUTE`, `EGRESS_BLOCKED`, `RENDERER_UNAVAILABLE`, `FFMPEG_UNAVAILABLE`. Deleted spellings that SHALL NOT be emitted: `FORBIDDEN`, `INVALID_REQUEST`, `NO_PROJECT_CONTEXT`, `INTERRUPTED`, `PROVIDER_KEY_MISSING`, `PROVIDER_UNAVAILABLE`, `HOST_NOT_ALLOWED` as an RPC code, `BOOTSTRAP_EXPIRED`, `TEMPLATE_LOCKED`, `ENCODER_UNAVAILABLE`, `retryAfterMs`, and lower-case forms of general codes. Domain codes are defined once each, in the following requirements, and the registry references them by name:

| Code family | Defined in |
|---|---|
| pairing and signing codes (`OFFER_*`, `CHALLENGE_*`, `CODE_*`, `PAIRING_*`, `SIGNATURE_MISSING`, `SIGNATURE_INVALID`, `DEVICE_SIGNATURE_INVALID`, `GATEWAY_SIGNATURE_INVALID`, `GATEWAY_MISMATCH`, `GATEWAY_UNREACHABLE`, `DEVICE_UNKNOWN`, `DEVICE_ID_MISMATCH`, `NONCE_REPLAYED`, `CLOCK_SKEW`, `TOKEN_EXPIRED`, `TOKEN_INVALID`, `LAST_ADMIN`, `SIGN_REFUSED`, `KEY_STORAGE_UNAVAILABLE`, `WEBCRYPTO_UNSUPPORTED`) | `device-pairing-signing.Pairing and signing error codes` |
| sync and blob codes (`LEASE_HELD`, `LEASE_NOT_HELD`, `REVISION_CONFLICT`, `SNAPSHOT_REQUIRED`, `PATCH_INVALID`, `PROJECT_NOT_SYNCED`, `SCRIPT_NOT_SYNCED`, `PROJECT_IN_TRASH`, `PROJECT_PURGED`, `SCHEMA_TOO_NEW`, `BLOB_*`, `CHUNK_OUT_OF_RANGE`, `VARIANT_UNAVAILABLE`, `TAKEOVER_*`) | `cross-device-sync.Sync error codes` |
| `export/<kebab>` (including `export/codec-unavailable`, raised by `server-api.Host encoder policy and codec table`) | `export-share.Export error codes` |
| `document/<kebab>` (project-document validation and patch codes; `document/template-locked` and `document/patch-invalid` travel as `details.documentCode` of `CONFLICT` and `PATCH_INVALID` on sync methods) | `project-document.Validation error codes` |
| `engine/<kebab>`, `surface/<kebab>`, `scene/<kebab>`, `descriptor/<kebab>`, `time/<kebab>`, `media/<kebab>` | `render-engine.Engine error codes` |
| `ai/<kebab>` | `ai-editing-tools.AI error codes` |
| `runtime/<kebab>` (including `runtime/relay-unsupported`) | `agent-runtimes.Error mapping` |
| `workspace/<kebab>`, `fs/<kebab>`, `git/<kebab>`, `terminal/<kebab>` (`terminal/disabled` is the code whenever terminals are off) | `workspaces-terminal.Workspace, file, git and terminal error codes` |
| `canvas/<kebab>` (raised by clients only) | `workflow-diagram.Canvas error codes` |
| `skill/<kebab>` | `skills.Skill error codes` |
| `WORKFLOW_*` | `agent-workflows.Workflow error codes` |
| `AGENT_*`, `TEAM_*`, `HANDOFF_*`, `ROOM_*`, `BOARD_*`, `BRIEF_NEEDS_CLARIFICATION`, `LOOP_NOT_FOUND`, `HEARTBEAT_NOT_OWNED`, `WRITER_HELD` | `multi-agent-orchestration.Multi-agent error codes` |
| `SCRIPT_*` other than `SCRIPT_NOT_SYNCED` | `script-studio.Script error codes` |
| `FILM_*` | `film-production.Film error codes` |
| tool codes (`PROJECT_NOT_FOUND`, `SCENE_NOT_FOUND`, `TRACK_NOT_FOUND`, `TRACK_LOCKED`, `TRACK_KIND_MISMATCH`, `ELEMENT_NOT_FOUND`, `ASSET_NOT_FOUND`, `ASSET_NOT_READY`, `LIBRARY_ITEM_NOT_FOUND`, `JOB_NOT_FOUND`, `OVERLAP_NOT_ALLOWED`, `OUT_OF_RANGE`, `SOURCE_EXHAUSTED`, `UNSUPPORTED_FOR_ELEMENT`, `RESULT_TOO_LARGE`, `LEASE_UNAVAILABLE`, `DEVICE_REQUIRED`, `TOOL_NOT_AVAILABLE`, `PROPOSAL_*`, `PLAN_NOT_APPROVED`, `MODE_READ_ONLY`, `PROVIDER_ERROR`, `CONTENT_BLOCKED`) | `agent-editing-tools.Error codes` (provider classes in `details.class` by `generation-providers.Error and content-safety mapping`) |
| session codes (`FORK_ANCHOR_GONE`, `FORK_ANCHOR_CHANGED`, `REWIND_NOT_ACKNOWLEDGED`, `TAG_LIMIT_EXCEEDED`, `ALREADY_RESOLVED`) | `chat-agent.Session fork`, `chat-agent.Session rewind`, `chat-agent.Session record and metadata`, `chat-agent.Agent questions` |
| ORC configuration codes (`VALIDATION_FAILED`, `ROLE_PROTECTED`, `ROLE_IN_USE`, `CAPABILITY_MISMATCH`) | `orc-model-routing.Configuration validation` |
| step warning identifiers of the one-prompt template (`VOICEOVER_DURATION_DRIFT`, `VOICE_SHARED_BY_SPEAKERS`, `VOICE_SAMPLE_UNUSED`, `SUBJECT_REFERENCE_MISSING`, `CAPTIONS_APPROXIMATE_TIMING`, `CAPTIONS_TRANSLATION_UNAVAILABLE`, `CAPTIONS_UNAVAILABLE`, `MUSIC_UNAVAILABLE`, `SFX_UNAVAILABLE`, `REVIEW_DURATION_OUT_OF_RANGE`, `REVIEW_FRAMES_UNAVAILABLE`); they accompany a completed or skipped step in `warnings[]` and are never the `code` of an error envelope | `prompt-to-video-workflow.Automated review against the brief` and the step contracts it names |

The registry is closed: a code family absent from the general list and from this table SHALL NOT be emitted on channel P, on an HTTP route or in a tool result. Warning identifiers that accompany a successful result and non-failing engine diagnostic ids are not error codes; the step warnings of capability `prompt-to-video-workflow` are listed in the last row of the table only so that the contract test can tell them from an unregistered code, and a handler that returns one of them as `error.code` fails that test. An unexpected exception SHALL map to `INTERNAL` with a `details.incidentId` (UUID) that also appears in the server log, and SHALL NOT include a stack trace, file path or secret in the response. A contract test SHALL fail when server code emits a code absent from the registry. [NEW]

#### Scenario: Unknown resource
- **WHEN** `jagentchill.job.get` is called with a `jobId` that does not exist
- **THEN** `error.code` is `NOT_FOUND` and `error.retryable` is `false`

#### Scenario: Handler throws
- **WHEN** a handler throws an untyped exception
- **THEN** the response `error.code` is `INTERNAL` with a `details.incidentId`
- **AND** the server log has an `error` entry carrying the same `incidentId` and the stack trace
- **AND** the response contains no stack trace

#### Scenario: Scope failure uses one code
- **WHEN** a `viewer` device calls a method that requires `jagentchill.config.write`
- **THEN** `error.code` is `SCOPE_DENIED` with `details.requiredScope` `jagentchill.config.write`

#### Scenario: Unregistered code
- **WHEN** a handler returns an error with code `FORBIDDEN`
- **THEN** the contract test `error-registry` fails and names the code and the handler

#### Scenario: Domain family resolves to its owner
- **WHEN** the contract test reads the registry entry of `FILM_LIMIT_EXCEEDED`, `ai/no-route` and `ROLE_IN_USE`
- **THEN** each entry names the owning capability of the table above and carries a localisation key

#### Scenario: Gateway down is not a generic failure
- **WHEN** a device calls a method flagged `coreCall` while the Gateway is in a crash loop
- **THEN** `error.code` is `GATEWAY_UNAVAILABLE`, `error.retryable` is `true` and `details.reason` is `crash_loop`, and the code is neither `UNAVAILABLE` nor `INTERNAL`

### Requirement: JAgentChill scope registry
The server SHALL recognise exactly 13 JAgentChill scopes, all internal to the server and never OpenClaw scopes (no device holds an OpenClaw scope at all): `jagentchill.projects.read`, `jagentchill.projects.write`, `jagentchill.media.read`, `jagentchill.media.write`, `jagentchill.agent.use`, `jagentchill.generation.run`, `jagentchill.export.run`, `jagentchill.comments.write`, `jagentchill.config.read`, `jagentchill.config.write`, `jagentchill.devices.manage`, `jagentchill.secrets.manage` and `jagentchill.host.exec`. Which role holds which scope is defined only in `device-pairing-signing.Device roles and scopes`. Every method and signed route SHALL declare exactly one required scope according to this use table, and no specification SHALL use the phrases "admin scope", "operator scope", "write scope" or "read scope":

| Action class | Scope |
|---|---|
| Read projects, scripts, workflows, films, runs, jobs, agents, versions, comments | `jagentchill.projects.read` |
| Create, edit, delete a project, script, film, workflow definition, automation, named version; sync push, lease, trash | `jagentchill.projects.write` |
| Download blobs and media variants | `jagentchill.media.read` |
| Upload blobs, library items | `jagentchill.media.write` |
| Start, steer or stop an agent turn; select runtime, model, mode; answer plans and questions; multi-agent actions — always together with the session rule of `server-api.Session ownership and visibility` | `jagentchill.agent.use` |
| Any costed generation, workflow run, film step, approval of a cost card | `jagentchill.generation.run` |
| Exports, share links, publishing through a connector | `jagentchill.export.run` |
| Review comments | `jagentchill.comments.write` |
| Read host settings, usage, diagnostics report, network activity (never host logs, the diagnostics bundle or secret hints) | `jagentchill.config.read` |
| Host settings, ORC, teams, provider and endpoint configuration, budgets, host paths, automation pre-approvals, connectors, skills install, agent policy, unattended-mode grant, network listeners, encoder install, host diagnostics bundle and logs | `jagentchill.config.write` |
| Devices, pairing offers and requests, audit log, forced lease takeover, permanent deletion from the host trash | `jagentchill.devices.manage` |
| Secret write and delete; reading the `last4` hint of a secret | `jagentchill.secrets.manage` |
| Terminal open, input, kill and profiles; workspace scripts and setup; git mutations; repository trust; file writes outside a workspace directory; answering a host-execution approval of an agent (`server-api.Approval and question resolution`) | `jagentchill.host.exec` |

`jagentchill.host.exec` SHALL be held by role `admin` only and SHALL NOT be implied by `jagentchill.config.write`. [NEW]

#### Scenario: Scope list is closed
- **WHEN** the contract test collects the scopes declared by all methods and routes
- **THEN** each is one of the 13 scopes above

#### Scenario: Terminal needs host execution scope
- **WHEN** the scope of `jagentchill.terminal.open` is read from the protocol package
- **THEN** it is `jagentchill.host.exec`

#### Scenario: Config write does not open a terminal
- **WHEN** a test device record is given `jagentchill.config.write` without `jagentchill.host.exec` and calls `jagentchill.terminal.open`
- **THEN** the response error code is `SCOPE_DENIED` with `details.requiredScope` `jagentchill.host.exec`

### Requirement: Device attestation gate and scope enforcement
Every channel P `req` frame and every signed HTTP request SHALL be served only for a device that is present in the server's device table, is not revoked, and has completed the handshake on that connection (`req`) or presented a valid per-request signature (HTTP). A `req` before `ready` closes the connection (`server-api.Channel P frame envelope`). The server SHALL evaluate the method's or route's declared scope against the device's current record on every call (not a value cached at `ready`), and a call from a device lacking it SHALL be refused with `SCOPE_DENIED` and `details.requiredScope`. When a device's role changes, the server SHALL send `jagentchill.device.updated` to that device's connections with the new `role` and `scopes` within 1 second. Methods that name an agent session additionally pass `server-api.Session ownership and visibility` in the same gate. The gate has exactly one caller without a device identity: the host CLI methods of `server-api.Host command-line surface`. A caller that is authenticated to OpenClaw (shared token, bearer token, loopback) and has no device record SHALL receive nothing from the server beyond the unsigned exceptions. [NEW]

#### Scenario: Viewer attempts a write
- **WHEN** a device with role `viewer` calls `jagentchill.sync.ops.push`
- **THEN** the response error code is `SCOPE_DENIED` and `details.requiredScope` is `jagentchill.projects.write`

#### Scenario: Scope removed during a connection
- **WHEN** an admin changes a connected device from `editor` to `viewer`
- **THEN** that device receives `jagentchill.device.updated` within 1 second
- **AND** its next write call is refused with `SCOPE_DENIED`

#### Scenario: Shared token holder on loopback
- **WHEN** a process on the Gateway host sends a signed-route request with the shared Gateway token and no signature headers
- **THEN** the response is HTTP 401 `SIGNATURE_MISSING`

### Requirement: Idempotency of side-effecting RPCs
Every RPC that creates a resource, starts a job, or spends provider credit SHALL be marked `idempotent: true` in the protocol package and SHALL require an `idempotencyKey` string of 16 to 64 characters. The server SHALL store the key with the result for 24 hours; a repeated call with the same key, method and calling device SHALL return the stored result without repeating the side effect, and a repeated key with different `params` SHALL be refused with `IDEMPOTENCY_CONFLICT`. The contract test SHALL assert that every method whose handler inserts a row or enqueues a job is marked. [NEW]

#### Scenario: Retry after a dropped response
- **WHEN** a client calls `jagentchill.export.create` twice with the same `idempotencyKey` and identical `params` within 24 hours
- **THEN** both responses carry the same `jobId`
- **AND** exactly one job exists

#### Scenario: Key reuse with different parameters
- **WHEN** the second call uses the same key with a different `projectId`
- **THEN** the response error code is `IDEMPOTENCY_CONFLICT`

#### Scenario: Missing key
- **WHEN** a job-starting RPC is called without `idempotencyKey`
- **THEN** the response error code is `INVALID_PARAMS`

#### Scenario: Key after expiry
- **WHEN** the same key is used 24 hours and 1 minute after the first call
- **THEN** the call is treated as new and a second resource is created

### Requirement: List pagination
Every list RPC SHALL accept `limit` (integer 1 to 200, default 50) and `cursor` (opaque string) and SHALL return `items` and `nextCursor` (string or `null`). Ordering SHALL be stable (declared per method; default newest first by `created_ms`, ties broken by id). A cursor SHALL remain valid for at least 10 minutes; an unusable cursor SHALL yield `INVALID_PARAMS` with `details.reason` `cursor_expired`. [NEW]

#### Scenario: Paging through 120 jobs
- **WHEN** a client lists jobs with `limit` 50 and follows `nextCursor` until it is `null`
- **THEN** it receives pages of 50, 50 and 20 items with no item repeated or skipped

#### Scenario: Limit out of range
- **WHEN** `limit` is 201
- **THEN** the response error code is `INVALID_PARAMS`

#### Scenario: Empty collection
- **WHEN** no items exist
- **THEN** the response is `{ items: [], nextCursor: null }` with `ok: true`

### Requirement: Event delivery
The server SHALL deliver events only as `evt` frames on channel P, named `jagentchill.<domain>.<event>` with `<domain>` from the closed list of `server-api.RPC naming and schema ownership`, whose `payload` validates against a schema exported by the protocol package. An event SHALL be sent only to connections that (a) completed the handshake, (b) belong to a device that currently holds the scope of the underlying resource and, for a session stream, can currently read the session (`server-api.Session ownership and visibility`), both re-checked at every delivery, and (c) subscribed to the event's `stream` with the subscribe method of its domain (`server-api.RPC domain ownership`; ended by the matching unsubscribe method or by the connection closing). The `seq` field is per stream, starts at 1 and increases by 1 per event. Events are not replayed: every stream SHALL have a pull RPC that returns state since a cursor, and a client that observes a `seq` gap or reconnects SHALL call it; `hello.resume` only lets the Gateway answer in `ready` whether each named stream advanced. Progress events for one job SHALL be coalesced to at most 4 per second, and an event that reports a terminal state SHALL never be dropped. Events that carry sensitive values (pairing verification codes, login hand-off URLs) SHALL be sent only to connections of devices holding the scope named by their owning requirement. A notification can be limited to named devices (`targetDeviceIds` of `notifications.Notification model`), in which case `jagentchill.notification.created` is sent to those devices only. The registered event names SHALL be the protocol package constant `EVENT_NAMES`, which SHALL equal exactly this closed list (42 names): `jagentchill.job.updated`; `jagentchill.pairing.requested`, `.pairing.completed`; `jagentchill.device.revoked`, `.device.updated`; `jagentchill.sync.ops`, `.sync.lease`, `.sync.snapshot`, `.sync.applyRemote`; `jagentchill.presence.changed`; `jagentchill.comment.changed`; `jagentchill.notification.created`, `.notification.updated`; `jagentchill.settings.host.changed`; `jagentchill.session.updated`; `jagentchill.chat.stream` (the only carrier of agent turn, tool, usage, approval, plan and question events, `server-api.Agent stream events and gap recovery`); `jagentchill.proposal.updated`; `jagentchill.provider.changed`; `jagentchill.runtime.updated`; `jagentchill.orc.config.changed`, `.orc.run.updated`; `jagentchill.agent.updated`, `.agent.room.message`, `.agent.board.updated`; `jagentchill.usage.updated`; `jagentchill.skill.changed`; `jagentchill.workflow.updated`, `.workflow.ops`, `.workflow.build`, `.workflow.proposal`, `.workflow.run.timeline`; `jagentchill.script.updated`; `jagentchill.film.updated`; `jagentchill.automation.changed`; `jagentchill.terminal.data`, `.terminal.exit`, `.terminal.updated`; `jagentchill.workspace.updated`, `.workspace.setup.progress`, `.workspace.script.updated`, `.workspace.git.updated`; `jagentchill.fs.changed`. Payload and stream of each event are defined by the owner of its domain. `jagentchill.export.updated`, `jagentchill.export.progress` and `jagentchill.git.updated` do not exist: exports report through `jagentchill.job.updated` and repository changes through `jagentchill.workspace.git.updated`. [NEW]

#### Scenario: Unsubscribed connection receives nothing
- **WHEN** a job changes state and connection A subscribed to stream `job` while connection B did not
- **THEN** only connection A receives `jagentchill.job.updated`

#### Scenario: Gap after reconnect
- **WHEN** a client last saw `seq` 41 on a stream, reconnects, resubscribes and receives `seq` 47
- **THEN** the client calls the stream's pull RPC with its last cursor and applies the missing state before applying `seq` 47

#### Scenario: Progress flood
- **WHEN** a job reports progress 50 times in one second and then succeeds
- **THEN** a subscriber receives no more than 4 progress events for that second
- **AND** receives the `succeeded` event

#### Scenario: Verification code is not sent to an editor
- **WHEN** a pairing request is created while an `admin` device and an `editor` device are both connected and subscribed to stream `pairing`
- **THEN** only the `admin` device's connections receive `jagentchill.pairing.requested`

#### Scenario: Unregistered event name
- **WHEN** server code emits `jagentchill.jobs.updated`
- **THEN** the contract test `event-registry` fails and names the event

### Requirement: Signed HTTP route surface
The server SHALL serve its HTTP routes on its own listener, SHALL receive no caller identity from anything in front of it (a product listener supplies a peer address, never an identity), and SHALL itself authenticate every route in the table below by verifying `device-pairing-signing.Per-request HTTP signature` and then the route's scope. No route SHALL accept a credential in a query string, and no ticket or pre-signed URL mechanism exists. This table, together with `server-api.Unsigned route exceptions`, is the complete and closed route list; all paths are under `/jagentchill/v1/`:

| Method and path | Purpose (owner) | Scope |
|---|---|---|
| `POST /blobs/{sha256}/init`, `PUT /blobs/{sha256}/chunks/{index}`, `POST /blobs/{sha256}/complete`, `POST /blobs/{sha256}/link` | blob upload and local linking (`cross-device-sync`) | `jagentchill.media.write` |
| `GET /blobs/{sha256}/status`, `GET` or `HEAD /blobs/{sha256}`, `GET` or `HEAD /blobs/{sha256}/variants/{variant}` | blob status and download (`cross-device-sync`) | `jagentchill.media.read` |
| `GET /media/{kind}/{id}/{variant}` | film, workflow, script and export artifacts and thumbnails (`server-api.Authenticated media delivery`) | `jagentchill.media.read` |
| `GET /exports/{jobId}/file` | remote export download (`export-share.Gateway export download`) | `jagentchill.export.run` |
| `GET /fs/{workspaceId}/content?path=<percent-encoded relative path>` | workspace file content (`workspaces-terminal.Upload and download between device and host`); files of a workspace-class session follow `server-api.Session ownership and visibility` | `jagentchill.projects.read` |
| `PUT /secrets/{name}`, `DELETE /secrets/{name}` | secret write and delete (`server-api.Secret write and read surface`) | `jagentchill.secrets.manage` |
| `GET /sounds/search`, `GET /sounds/{id}/preview` | sound search and preview proxy (`server-api.Sound search proxy`) | `jagentchill.media.read` |
| `GET /diagnostics/bundle` | host diagnostics archive with host logs (`diagnostics-quality.Diagnostics bundle`) | `jagentchill.config.write` |
| `GET /events`, `POST /rpc` | fallback transport (`server-api.SSE and signed HTTP fallback`) | per event and method |

`GET /jagentchill/v1/ws` is authenticated by the handshake frames instead of a per-request signature. Download routes (`/blobs`, `/media`, `/exports`, `/fs`, `/sounds/{id}/preview`) SHALL honour single-range `Range` requests with HTTP 206 and SHALL send `Accept-Ranges: bytes`, `ETag` and `Content-Length`; a multi-range request receives HTTP 416. The contract test SHALL assert that the set of registered routes equals this table plus the exception table. [NEW]

#### Scenario: Unsigned request to a protected route
- **WHEN** `GET /jagentchill/v1/blobs/<sha256>` is requested without signature headers
- **THEN** the response is HTTP 401 with JSON body `{ "error": { "code": "SIGNATURE_MISSING" } }`
- **AND** no blob bytes are returned

#### Scenario: Ranged download
- **WHEN** a signed request carries `Range: bytes=4194304-8388607` for a 20 MiB blob
- **THEN** the response is HTTP 206 with `Content-Range: bytes 4194304-8388607/20971520` and a 4 194 304-byte body

#### Scenario: Gateway bearer token alone is insufficient
- **WHEN** a request to a protected route carries a valid OpenClaw Gateway bearer token and no JAgentChill signature headers
- **THEN** the response is HTTP 401 `SIGNATURE_MISSING`

#### Scenario: Route requested during startup
- **WHEN** a signed route is requested before the server's services are ready
- **THEN** the response is HTTP 503 with `Retry-After: 1`

#### Scenario: Credential in the query string
- **WHEN** a request for `/jagentchill/v1/exports/<jobId>/file?token=abc` arrives without signature headers
- **THEN** the response is HTTP 401 `SIGNATURE_MISSING` and the query parameter is ignored

#### Scenario: Route table drift
- **WHEN** server code registers `GET /jagentchill/v1/tickets`
- **THEN** the contract test `route-table` fails and names the route

### Requirement: Unsigned route exceptions
The routes without a device signature SHALL be exactly the following closed list, each with its own authenticator and rate limit, and each SHALL return no project, media, device or secret data beyond what the row states:

| Method and path | Authenticator | Enabled when | Limit per real peer address (`server-api.Product listeners and path restriction`) |
|---|---|---|---|
| `GET /jagentchill/v1/health` | none (`server-api.Health route`) | always | 60 per minute |
| `POST /jagentchill/v1/pair/resolve`, `POST /jagentchill/v1/pair/challenge`, `POST /jagentchill/v1/pair/prove`, `POST /jagentchill/v1/pair/verify`, `GET /jagentchill/v1/pair/status` | a live `offerId`, then signatures by the enrolling key (`device-pairing-signing.Enrolment over public server routes`) | an offer is live | `device-pairing-signing.Pairing abuse limits` |
| `POST /jagentchill/v1/handshake/hello`, `POST /jagentchill/v1/handshake/prove` | the handshake itself | always (they open the fallback transport) | 30 per minute |
| `GET /jagentchill/v1/share/{token}`, `GET /jagentchill/v1/share/{token}/file` | random 32-byte token, expiry and passcode when set (`export-share.Share link through the Gateway`) | `http.shareLinks.enabled` is true (default false) | 120 per minute; 10 wrong passcodes per token then HTTP 429 for 15 minutes |
| `POST /jagentchill/v1/hooks/{triggerId}` | per-trigger HMAC in `X-JAgentChill-Webhook-Signature: t=<unix ms>,v1=<hex HMAC-SHA256>` with `X-JAgentChill-Webhook-Delivery`, skew ±300 000 ms (webhook-only value; `automations.Webhook trigger`) | `http.webhooks.enabled` is true (default false) and the trigger is enabled | 60 per minute per trigger |
| `GET /jagentchill/v1/connectors/{connectorId}/callback` | single-use `state` plus PKCE, valid 600 000 ms (`server-api.Connectors`) | `connectors.enabled` is true and a connect flow is pending | 30 per minute |
| `GET /jagentchill/app/*` | none; static files only (`updates-distribution.Web build delivery`) | `http.serveWebApp` is true (default true) | 600 per minute |

A request to a disabled exception route SHALL receive HTTP 404 with no body detail. The server's listener has exactly one path outside `/jagentchill/`: the agent tool endpoint `/agent-tools/mcp`, which is not a client route, is authenticated by the tool endpoint secret and answers only the Gateway on loopback (`server-api.Agent tool endpoint and session binding`); every other path answers HTTP 404. Enabling or disabling `http.shareLinks.enabled` and `http.webhooks.enabled` requires `jagentchill.config.write`, is audited, and each enabled public route class is reported by `jagentchill doctor` as `warn`. These routes are inbound exceptions and are listed as such beside the outbound table of `security-privacy.Network egress control`. The webhook signature header name SHALL NOT be `X-JAgentChill-Signature`, which is reserved for device signatures. [NEW]

#### Scenario: Share links off by default
- **WHEN** a server runs with default configuration and `GET /jagentchill/v1/share/<token>` is requested
- **THEN** the response is HTTP 404

#### Scenario: Webhook with a device-signature header name
- **WHEN** a webhook sender puts its HMAC in `X-JAgentChill-Signature`
- **THEN** the response is HTTP 401 and the trigger does not fire

#### Scenario: Exception list is closed
- **WHEN** the contract test requests every registered route without signature headers
- **THEN** only the routes in this table answer with a status other than 401

#### Scenario: Health flood
- **WHEN** one address requests `/jagentchill/v1/health` 61 times in a minute
- **THEN** the 61st response is HTTP 429 with a `Retry-After` header

#### Scenario: Path outside the product prefix
- **WHEN** `GET /`, `GET /v1/models` and `POST /jagentchill/v1/internal/tick` are requested on the server's loopback port
- **THEN** each answers HTTP 404 with an empty body

### Requirement: HTTP request limits and browser access
Body limits, CORS and Host checks SHALL be implemented by the server's own handlers (nothing in front of the server enforces them). Request bodies SHALL be limited to 4 194 304 bytes for chunk uploads, 65 536 bytes for JSON bodies and 32 768 bytes for secret writes; larger bodies SHALL receive HTTP 413 `PAYLOAD_TOO_LARGE` before the body is fully read. Routes SHALL answer CORS preflight only for origins in the allow-list: `app://jagentchill` (the desktop renderer), the host's own origins (the loopback origin and the origins of its product listeners, from which `/jagentchill/app/` is served), loopback origins (`http://localhost:<port>`, `http://127.0.0.1:<port>`), and origins listed in `http.allowedOrigins`; `jagentchill://` is a deep-link scheme and is never an origin. Allowed request headers SHALL include the four signature headers, `X-JAgentChill-Conn`, `Content-Type` and `Range`; exposed response headers SHALL include `ETag`, `Content-Range`, `Accept-Ranges` and `Retry-After`. A request whose `Host` header is not loopback, not an address or name the host advertises in offers or serves on a product listener, and not in `http.allowedHosts` SHALL be refused with HTTP 403 and body code `SCOPE_DENIED` with `details.reason` `host_not_allowed`; a browser request refused for its `Origin` carries `details.reason` `origin_not_allowed`, which clients show as the `GATEWAY_UNREACHABLE` reason of the same name (`device-pairing-signing.Web clients and the tailnet`). Because a host admits only its own origins, loopback origins and `http.allowedOrigins`, a web app served elsewhere (a static deployment, or another host) connects only after an admin added its origin; Host ▸ Web access lists and edits the entries. [JAD] [NEW]

#### Scenario: Oversized chunk
- **WHEN** a chunk upload body is 4 194 305 bytes
- **THEN** the response is HTTP 413 and nothing is stored

#### Scenario: Desktop renderer origin
- **WHEN** the desktop renderer at origin `app://jagentchill` sends a preflight for a blob route
- **THEN** the response carries `Access-Control-Allow-Origin: app://jagentchill`

#### Scenario: Disallowed origin
- **WHEN** a browser page at `https://example.org` sends a preflight for a blob route
- **THEN** the response carries no `Access-Control-Allow-Origin` header

#### Scenario: DNS rebinding attempt
- **WHEN** a request arrives with `Host: attacker.example:18910`
- **THEN** the response is HTTP 403 with `details.reason` `host_not_allowed`

### Requirement: Authenticated media delivery
Every byte a client fetches from the Gateway (`/blobs`, `/media`, `/exports`, `/fs`, sound previews) SHALL be requested with the per-request signature; there are no query credentials and no tickets. The signature SHALL be attached per platform as follows. **Web**: a service worker scoped to the app intercepts `GET` and `HEAD` requests (including `Range` requests issued by `<img>`, `<video>`, `<audio>` and downloads) addressed to a paired Gateway and signs them with the non-extractable device key. **Desktop**: the main process serves the privileged scheme `jagentchill-gw://<gatewayId>/<path>` to the renderer and signs the outgoing request, enforcing the TLS pin of the address in use. **Mobile** (iOS and Android alike): the native modules `JagentchillTransport` and `JagentchillEngineView` sign requests issued by React Native and by the engine surface. The same three mechanisms serve images in chat and agent text, film and workflow thumbnails, export files and workspace file content; a spec that shows Gateway bytes cites this requirement instead of defining a fetch path. `GET /jagentchill/v1/media/{kind}/{id}/{variant}` SHALL serve Gateway-held artifacts with `kind` one of `film-asset`, `film-panel`, `workflow-artifact`, `script-artifact`, `export`, `generated`, `skill-archive`, `usage-export`, `diagram` and `variant` one of `thumb` (JPEG or WebP, longest side 320 px), `preview` (for video and audio the proxy format of `media-library.Proxy media`; for images a WebP or JPEG whose longest side is 1 440 px), `original` and `mezzanine`; a variant that does not exist yet SHALL answer HTTP 404 `VARIANT_UNAVAILABLE` with `details.jobId` when a job that will produce it is queued. Responses SHALL carry `Cache-Control: private, max-age=31536000, immutable` for content-addressed bodies and `Content-Disposition: attachment` only when the request has `?download=1`. [NEW]

#### Scenario: Image element on web
- **WHEN** the web app renders `<img>` with a Gateway `thumb` URL for a film panel
- **THEN** the service worker adds the four signature headers and the image loads
- **AND** the same URL requested from another browser profile without the device key receives HTTP 401

#### Scenario: Video seek on desktop
- **WHEN** a `<video>` element in the desktop renderer seeks within `jagentchill-gw://<gatewayId>/jagentchill/v1/media/film-panel/<id>/preview`
- **THEN** the main process issues a signed `Range` request and the element receives HTTP 206

#### Scenario: Variant not ready
- **WHEN** a client requests the `preview` variant of an artifact whose proxy job is queued
- **THEN** the response is HTTP 404 `VARIANT_UNAVAILABLE` with `details.jobId`

#### Scenario: Viewer downloads a thumbnail
- **WHEN** a `viewer` device requests a `thumb` variant with a valid signature
- **THEN** the response is HTTP 200

### Requirement: Health route
`GET /jagentchill/v1/health` SHALL require no authentication and SHALL return within 200 ms HTTP 200 with JSON `{ "status": "ok", "gatewayId", "protocolVersion", "minProtocolVersion", "serverVersion", "openclawVersion", "transport": "ws" | "sse", "originExclusive": true | false, "time_ms" }` when every service is running, and HTTP 503 with `{ "status": "starting" | "degraded", "reasons": [...] }` plus the same identity fields otherwise. `reasons` SHALL use the closed set `db_unavailable`, `blob_store_unavailable`, `queue_stopped`, `ffmpeg_missing`, `render_host_unavailable`, `run_profile_violation`, `service_stopped`, `tailnet_bridge_down`, `lan_listener_down`, `core_call_unavailable`, `gateway_crash_loop`, `gateway_config_invalid`. `ffmpeg_missing`, `render_host_unavailable`, `tailnet_bridge_down` and `lan_listener_down` alone SHALL NOT make the status `degraded` for RPC purposes: they are reported in `reasons` with HTTP 200 and switch off the dependent feature flags. The reason for a missing or failing render host is spelled `render_host_unavailable` everywhere (the error code of the same condition is `RENDERER_UNAVAILABLE`); `renderer_unavailable` is not a reason. When a restart is needed to apply the run profile the body additionally carries `restartRequired: true` (`platform-skeleton.Run profile application`). `originExclusive` is defined by `server-api.Web origin isolation`; `core_call_unavailable` is reported whenever the gateway link is not established, and `gateway_crash_loop` or `gateway_config_invalid` beside it once the supervisor stopped restarting the Gateway (`server-api.Gateway supervision and lifecycle`); with these reasons the status is `degraded`, every method flagged `coreCall` answers `GATEWAY_UNAVAILABLE`, and every other domain keeps working. `openclawVersion` is the pinned tag the server was built for and tells a client nothing else about the Gateway. The response SHALL contain no device, project or user data. `time_ms` is informational and SHALL NOT be used by clients to correct their clock (`device-pairing-signing.Clock-skew window`). [PORT W-003] [NEW]

#### Scenario: Healthy host
- **WHEN** the route is requested on a running server whose Gateway is ready, with FFmpeg and the render host available
- **THEN** the response is HTTP 200, `status` is `ok` and `reasons` is absent or empty

#### Scenario: FFmpeg absent
- **WHEN** no FFmpeg binary satisfying `server-api.FFmpeg worker` is found
- **THEN** the response is HTTP 200 with `reasons` containing `ffmpeg_missing`
- **AND** RPCs that do not need FFmpeg continue to work and the features `remote-export` and `host-analysis` are false

#### Scenario: Database unavailable
- **WHEN** the host database cannot be opened
- **THEN** the response is HTTP 503 with `status` `degraded` and `reasons` containing `db_unavailable`

#### Scenario: Gateway in a crash loop
- **WHEN** the supervised Gateway has failed to start 3 consecutive times
- **THEN** the response is HTTP 503 with `status` `degraded` and `reasons` containing `core_call_unavailable` and `gateway_crash_loop`
- **AND** `jagentchill.sync.project.list` and a `media.proxy` job still succeed

### Requirement: Sound search proxy
`GET /jagentchill/v1/sounds/search` SHALL be the only sound-search endpoint (no RPC exists) and SHALL proxy the Freesound text search API using the operator's Freesound API key held as the secret `FREESOUND_API_KEY`, so that the key never reaches a client. It SHALL accept `q` (0 to 500 characters), `type` (`effects` or `music`, default `effects`; `songs` is accepted as an alias of `music`), `page` (1 to 1 000, default 1), `page_size` (1 to 150, default 20), `sort` (`relevance`, `downloads`, `rating`, `created`; default `downloads` when `q` is empty and `relevance` otherwise), `min_rating` (0 to 5, default 3), `min_duration_s` and `max_duration_s` (0 to 3 600) and `commercial_only` (boolean, default `true`). This route owns the per-type filters, applied by the proxy so that a client cannot widen them: `effects` — duration at most 30 s and at least one of the tags `sound-effect`, `sfx`, `foley`, `ambient`, `nature`, `mechanical`, `electronic`, `impact`, `whoosh`, `explosion`; `music` — duration 30 to 600 s and at least one of the tags `music`, `song`, `loop`, `soundtrack`, `instrumental`; a `min_duration_s` or `max_duration_s` from the client can only narrow these bounds. A `sort` value outside the list (for example `score`) answers `INVALID_PARAMS`; "Best match" in the client is `sort=relevance`. The licence rule is that of `audio-editing.Sound licence filter`. Each result SHALL include `id`, `name`, `duration_ms`, `licence`, `author`, `previewPath` (a `/jagentchill/v1/sounds/{id}/preview` path), `sourceUrl`, `tags`, `downloads`, `rating`. `GET /jagentchill/v1/sounds/{id}/preview` SHALL stream the preview audio through the Gateway so that clients never contact Freesound. Search responses SHALL be cached in memory for 300 seconds keyed by the normalised query. Errors use the standard envelope: `INVALID_PARAMS`; `RATE_LIMITED`; `UNAVAILABLE` with `details.reason` `freesound_key_missing` (HTTP 503) when no key is stored; `UNAVAILABLE` with `details.upstreamStatus` and `retryable: true` (HTTP 502) when Freesound answers 5xx or does not answer within 10 seconds; `EGRESS_BLOCKED` when the Freesound row of `security-privacy.Network egress control` is disabled. The bundled sound pack of `audio-editing.Bundled sound pack` works without this route and without a Gateway. This route is the only path to Freesound and serves sound only: stock video and stock images are never proxied here — they are searched through endpoint records created from `stock-source` presets with the template `stock-search` (`agent-runtimes.Endpoint presets`, `generation-providers.Media request templates`), each with the key the admin entered for that endpoint, and an endpoint record is never created for Freesound. [PORT W-002] [NEW]

#### Scenario: Successful search
- **WHEN** a signed request asks for `q=rain&page_size=20` and a Freesound key is stored
- **THEN** the response is HTTP 200 with at most 20 results, each carrying `licence`, `author` and a `previewPath`
- **AND** the response body does not contain the API key or a Freesound preview URL

#### Scenario: No key configured
- **WHEN** no Freesound key is stored
- **THEN** the response is HTTP 503 with code `UNAVAILABLE` and `details.reason` `freesound_key_missing`
- **AND** the client shows the localised message for that reason with a link to the secrets settings

#### Scenario: Upstream failure
- **WHEN** Freesound responds with a 5xx status or does not answer within 10 seconds
- **THEN** the response is HTTP 502 with code `UNAVAILABLE`, `details.upstreamStatus` and `retryable` true

#### Scenario: Non-commercial licence filtered
- **WHEN** `commercial_only` is true and Freesound returns a CC-BY-NC result
- **THEN** that result is absent from the response

#### Scenario: Preview is proxied
- **WHEN** a client plays a search result
- **THEN** the audio bytes are fetched from `GET /jagentchill/v1/sounds/{id}/preview` on the paired Gateway and a network capture of the client shows no connection to a Freesound host

### Requirement: Rate limiting
The server SHALL enforce in-process sliding-window limits keyed by `deviceId` (or, for unsigned routes, by the real peer address — the attributed address of `server-api.Product listeners and path restriction` for requests that came through a listener, so peers behind one listener never share a bucket), with no external store: 600 RPC calls per minute per device; 30 mutating admin-proxy calls per minute per device; 600 agent relay calls per minute per device (inside the RPC limit); 100 requests per minute per device on `GET /sounds/search` and on every other route that proxies an external service; the per-address limits of `server-api.Unsigned route exceptions`; and the pairing limits of `device-pairing-signing.Pairing abuse limits`. Blob chunk transfers are limited only by the nonce capacity of `device-pairing-signing.Nonce replay cache`. An over-limit call SHALL receive `RATE_LIMITED` (HTTP 429 with a `Retry-After` header in whole seconds on HTTP routes; `error.details.retryAfter_ms` on RPC). All limits SHALL be configurable under `limits.<name>` as a multiplier between 0.1 and 10 of the default; tool-call limits of `agent-editing-tools.Rate guard` use the same key space and range. [PORT W-006] [NEW]

#### Scenario: Limit reached on the sound proxy
- **WHEN** one device sends 101 sound-search requests within 60 seconds
- **THEN** the 101st response is HTTP 429 with code `RATE_LIMITED` and a `Retry-After` value between 1 and 60

#### Scenario: Window slides
- **WHEN** the same device waits the `Retry-After` interval and retries
- **THEN** the request succeeds

#### Scenario: Limits are per device
- **WHEN** device A is rate limited
- **THEN** device B's requests in the same minute succeed

#### Scenario: Multiplier out of range
- **WHEN** an admin patches `limits.rpc` to 11
- **THEN** the response error code is `INVALID_PARAMS`

### Requirement: Secret write and read surface
Secret values SHALL reach the Gateway only in the body of the signed route `PUT /jagentchill/v1/secrets/{name}` (JSON `{ value, scope }`, scope `jagentchill.secrets.manage`) and SHALL never be RPC parameters, query parameters, event payloads or log fields. `name` SHALL match `^[A-Z][A-Z0-9_]{0,63}$` (provider keys are named `PROVIDER_<ID>_API_KEY`), `value` SHALL be 1 to 16 384 bytes, and `scope` SHALL be `host` or `project:<projectId>`. `DELETE /jagentchill/v1/secrets/{name}` removes a secret and answers `CONFLICT` with `details.usedBy[]` while a provider, endpoint, connector or webhook trigger references it, unless `?force=1` is set. `jagentchill.secret.list` (scope `jagentchill.config.read`) and every other read SHALL return only `{ name, scope, set, last4?, updated_ms }`, with `last4` present only when the value has 12 or more characters AND the caller holds `jagentchill.secrets.manage`; a `viewer` or `editor` sees which secrets are set and nothing of their value. A secret is referenced from OpenClaw configuration only through a file SecretRef in a field the core treats as sensitive (`apiKey`, `headers`); the server SHALL never write a secret of this surface, or a URL that embeds one (a query-string key, user-info), into the Gateway configuration `openclaw.json` — `models.providers.<id>.baseUrl` is a plain string there — and an endpoint whose secret must travel in the query string is called only by the server's own endpoint client (`security-privacy.Host secret storage`, `agent-runtimes.Shared endpoint record`). Methods that need a secret take `secretNames[]` of secrets already written (for example `jagentchill.provider.connect { providerId, fields, secretNames[] }`). Storage of the value is defined by `security-privacy.Host secret storage`. The Gateway token, the link identity and the tool endpoint secret are not secrets of this surface: they have no name, are never listed, written or deleted through it, and are governed by `server-api.Gateway secrets`. [NEW]

#### Scenario: Write then list
- **WHEN** an admin writes `PROVIDER_FAL_API_KEY` with a 40-character value and then calls `jagentchill.secret.list`
- **THEN** the list contains `{ name: "PROVIDER_FAL_API_KEY", scope: "host", set: true, last4, updated_ms }` and no response contains the full value

#### Scenario: Viewer lists secrets
- **WHEN** a `viewer` device calls `jagentchill.secret.list`
- **THEN** each entry has `name`, `scope`, `set` and `updated_ms` and none has `last4`

#### Scenario: Short value has no hint
- **WHEN** a secret with an 8-character value is listed
- **THEN** its entry has no `last4` field

#### Scenario: Editor attempts to write a secret
- **WHEN** an `editor` device sends a signed `PUT` to a secret route
- **THEN** the response is HTTP 403 `SCOPE_DENIED` with `details.requiredScope` `jagentchill.secrets.manage`

#### Scenario: Invalid name
- **WHEN** the path name is `providers.fal.apiKey`
- **THEN** the response is HTTP 400 `INVALID_PARAMS`

#### Scenario: Delete a secret in use
- **WHEN** an admin deletes a secret referenced by an enabled provider without `force`
- **THEN** the response is HTTP 409 `CONFLICT` with `details.usedBy` naming the provider

### Requirement: Host data store
The server SHALL keep all host-side product data beneath its data directory `<dataDir>` — the value of `--data-dir`, else of `JAGENTCHILL_DATA_DIR`, else the per-user default (`~/Library/Application Support/JAgentChill` on macOS, `%APPDATA%\JAgentChill` on Windows, `${XDG_DATA_HOME:-~/.local/share}/jagentchill` on Linux, `/data` in the container image) — created with owner-only permissions (POSIX mode `0700` for directories and `0600` for files; on Windows an ACL granting access to the current user only), with exactly these children: `config.json` (`server-api.Server configuration`); `jagentchill.sqlite` (the server database — which holds, among the records of every capability, the ORC document of `orc-model-routing.ORC configuration store`, never stored in the Gateway configuration —; WAL journal mode, `foreign_keys` on, opened with Node's built-in `node:sqlite` in a worker thread so that no database call runs on the server's main thread); `blobs/` (content-addressed media and artifact files as plain files, written to a temporary name and renamed); `workspaces/<projectId>/` (the default project workspace directory, created on the first agent session bound to the project and deleted with the project); `bootstrap/` (one-time credential files of `device-pairing-signing.Trust bootstrap for the first device`); `exports/<projectId>/` (remote export outputs); `secrets/` (`security-privacy.Host secret storage` and `server-api.Gateway secrets`); `gateway-state/` (the state directory and configuration file of the supervised Gateway, `server-api.Gateway supervision and lifecycle`); `run/` (the local admin endpoint, the server's pid file and the Gateway child's pid file); `tailnet/` (tailnet node state); `tls/` (the LAN listener certificate); `encoders/` (the OpenH264 library when installed); `backups/`; `logs/`. The bootstrap file holds the first device's device token only. Media SHALL be stored as plain files and streamed, never as database rows or whole-buffer entries, so that an original of several gibibytes is never held in memory. There SHALL be no user, session-login, account or verification tables and no Postgres or Redis dependency: identity is the paired device (`device-pairing-signing.Identity model without accounts`). Data under this directory SHALL be read and written only through server code; clients reach it only through the RPCs and routes of this capability, and the Gateway and its agents reach it only through the agent tool endpoint. Under `gateway-state/` the server SHALL write only the Gateway configuration file, and only while the Gateway is stopped; a running Gateway's configuration is changed on the link with `config.get` followed by `config.patch { raw, baseHash }` (a stale `baseHash` is re-read and retried, never forced), and OpenClaw's sessions, transcripts, credentials, tables and caches are never read or modified as files — they are reached only through Gateway methods, as `docs/gateway/embedding.md` of the pinned tag requires. [PORT W-004, W-005] [NEW]

#### Scenario: First start creates the store
- **WHEN** the server starts on an empty data directory
- **THEN** it creates `config.json`, `jagentchill.sqlite`, `blobs/`, `secrets/` and `gateway-state/` with owner-only permissions
- **AND** the database `user_version` equals the newest schema version

#### Scenario: No account tables
- **WHEN** the database schema is inspected
- **THEN** it contains no table named `users`, `accounts`, `logins` or `verifications`

#### Scenario: Wrong permissions detected
- **WHEN** the data directory is group- or world-readable (macOS, Linux) or its ACL grants access to another account (Windows) at startup
- **THEN** the server tightens the permissions to owner-only and logs a `warn` entry `state_permissions_repaired`

#### Scenario: Large blob is a file
- **WHEN** a 3 GiB original is uploaded
- **THEN** it is stored as one file under `blobs/`, no database row holds its bytes, and the server's resident memory grows by less than 64 MiB during the upload

#### Scenario: Database calls stay off the main thread
- **WHEN** a 2-second database write runs
- **THEN** the server's event loop delay measured during it stays below 50 ms

#### Scenario: Gateway state is not read as files
- **WHEN** `pnpm jagentchill:lint` scans `server/`
- **THEN** rule `gateway-boundary` fails for any file access below `gateway-state/` other than writing the Gateway configuration file in the supervisor module

### Requirement: Host schema migrations
The host database schema SHALL be versioned with an integer `user_version`. Migrations SHALL be forward-only, applied in order inside one transaction each at server start. Before applying any migration the server SHALL copy the database to `backups/pre-migration-v<old>-<time_ms>.sqlite` and SHALL keep the 5 most recent such copies. When the database version is newer than the server supports, the server SHALL NOT open it for writing, SHALL report health `degraded` with reason `db_unavailable`, and SHALL answer RPCs with `UNAVAILABLE` and `details.reason` `db_newer_than_server`. [NEW]

#### Scenario: Upgrade across three versions
- **WHEN** a server supporting schema version 9 starts on a database at version 6
- **THEN** a backup `pre-migration-v6-*.sqlite` exists
- **AND** migrations 7, 8 and 9 run in order and `user_version` is 9

#### Scenario: Migration fails midway
- **WHEN** migration 8 throws
- **THEN** its transaction is rolled back, `user_version` remains 7, the server reports `degraded`, and the backup file is intact

#### Scenario: Downgraded server
- **WHEN** a server supporting version 9 starts on a database at version 11
- **THEN** no write occurs and RPCs return `UNAVAILABLE` with reason `db_newer_than_server`

### Requirement: Background job queue
The server SHALL own the single durable job queue of the product (design D11), stored in the host database and run by a server-internal service; no other capability SHALL define a second queue, task table or status vocabulary for background work. Job kinds SHALL be exactly: `generation.image`, `generation.video`, `generation.tts`, `generation.voice-design`, `generation.music`, `generation.sfx`, `generation.lipsync`, `generation.transcription`, `generation.translation`; `workflow.run`; `team.run`; `script.run`; `film.step`; `export.remote`; `export.sequence`; `render.frame`; `workflow.record`; `media.proxy`; `media.transcode`; `media.transcribe`; `media.concat`; `ai.analysis`; `connector.transfer`. A job SHALL have `jobId` (UUID), `kind`, `state` (`queued`, `running`, `succeeded`, `failed`, `cancelled`), `progress` (0.0 to 1.0), `attempt`, `maxAttempts`, `priority`, `createdBy` (`{ kind: "device" | "agent" | "automation" | "host-cli", id }`; for a job started by a tool the device is the initiator of the run, `server-api.Run initiator attribution and host-execution gating`), `projectId?`, `targetType?`, `targetId?`, `batchId?`, `filmEpisodeId?`, `filmStage?` (set on every job that works for a film episode, with the stage id of `film-production.Film pipeline template`, so that jobs and their ledger entries can be listed per episode and stage), `providerTaskId?`, `heartbeat_ms`, `created_ms`, `started_ms`, `finished_ms`, `error` (envelope of `server-api.RPC error envelope`) and `result`. Legal transitions SHALL be `queued → running`, `running → succeeded | failed | cancelled | queued` (retry or recovery) and `queued → cancelled`; terminal states never change, and there is no `paused` state (host exports are cancel-only). A running job's worker SHALL update `heartbeat_ms` every 15 000 ms; a running job whose heartbeat is older than 90 000 ms is stalled and is treated as a failed attempt with code `TIMEOUT`. **Local kinds** (`media.*`, `export.*`, `render.frame`, `workflow.record`, `ai.analysis`) SHALL be retried by the queue on a `retryable` error with delays of 5 s, 30 s and 120 s up to `maxAttempts` 3. **Provider kinds** (`generation.*`) and orchestration kinds (`workflow.run`, `team.run`, `script.run`, `film.step`, `connector.transfer`) SHALL have `maxAttempts` 1 in the queue: the queue never re-queues them, because provider-attempt retries, route fallback and budgets are owned by `generation-providers.Retry policy` (three attempts per route — the initial one, then one after 2 s and one after 8 s — then a 30 s wait before the first attempt on the next route in the order of `orc-model-routing.Route resolution and fallback`). Kind `workflow.record` is the WebM recording of a workflow canvas on the render host, started by `jagentchill.workflow.archify.record` (`workflow-diagram.Motion export to WebM`). Kind `film.step` covers every film job (single-item and batch generation bookkeeping, assembly, archive building); stage-level film actions are `workflow.run` jobs of the film template. Jobs of one batch share `batchId`, and `targetType` with `targetId` name the entity a job produces for (for example a film panel), so that owners can list and revert a batch. Finished jobs SHALL be retained 30 days. [NEW]

#### Scenario: Happy path
- **WHEN** a `media.proxy` job is enqueued and its worker completes
- **THEN** subscribers observe states `queued`, `running`, `succeeded` in that order with non-decreasing `progress` ending at 1.0

#### Scenario: Local job retries then fails
- **WHEN** a `media.transcode` worker fails with a retryable error on every attempt
- **THEN** the job runs 3 times with waits of 5 s and 30 s between attempts and ends in `failed` with `attempt` 3

#### Scenario: Provider job is not re-queued by the queue
- **WHEN** a `generation.video` job's provider call fails after the provider-attempt policy of `generation-providers` is exhausted
- **THEN** the job ends `failed` with `attempt` 1 and the queue schedules no retry

#### Scenario: Illegal transition rejected
- **WHEN** code attempts to move a `succeeded` job to `running`
- **THEN** the store throws and the job row is unchanged

#### Scenario: Stalled job
- **WHEN** a running job writes no heartbeat for 90 000 ms
- **THEN** its attempt fails with `TIMEOUT` and, for a local kind with attempts left, it is re-queued

#### Scenario: Unknown kind
- **WHEN** code enqueues a job of kind `film.task`
- **THEN** the store rejects it and the contract test `job-kinds` names the kind

### Requirement: Job concurrency limits
The queue SHALL run at most `queue.maxConcurrent` local-kind jobs at once (default 4, range 1 to 32) and at most `queue.ffmpegWorkers` jobs that hold an FFmpeg or render-host process (default `max(1, floor(cpuCount / 2))` capped at 4, range 1 to 8). `queue.maxConcurrent` SHALL NOT apply to provider and orchestration kinds, whose admission is the minimum of the per-provider-per-capability limit of `generation-providers.Concurrency and rate limits`, the role limit of capability `orc-model-routing` and the per-run limit of the owning capability; the key `queue.perProvider` does not exist. Jobs SHALL start in descending `priority`, then FIFO within a priority; a job blocked only by a provider limit SHALL NOT block jobs of other providers or local jobs. Limit changes SHALL take effect within 2 seconds without a server restart. [NEW]

#### Scenario: Local cap
- **WHEN** 6 `media.proxy` jobs are queued with `queue.maxConcurrent` 4
- **THEN** exactly 4 are `running` and 2 are `queued`

#### Scenario: Provider jobs are not counted against the local cap
- **WHEN** 4 local jobs are running and a `generation.image` job is enqueued whose provider limit has room
- **THEN** the generation job starts without waiting for a local job to finish

#### Scenario: Limit raised at runtime
- **WHEN** an admin raises `queue.maxConcurrent` from 4 to 5
- **THEN** a fifth queued local job starts within 2 seconds without a server restart

#### Scenario: Render host counts as an FFmpeg worker
- **WHEN** `queue.ffmpegWorkers` is 2, one `export.remote` job is rendering and one `media.proxy` job is transcoding
- **THEN** a second `export.remote` job stays `queued` until one of them finishes

### Requirement: Job cancellation and restart recovery
`jagentchill.job.cancel` SHALL move a `queued` job to `cancelled` immediately and SHALL signal a `running` job's worker, which MUST stop and report within 5 seconds; a worker still running after 5 seconds SHALL be force-terminated (process tree) and the job marked `cancelled`. Partial output files of a cancelled or failed job SHALL be deleted within 60 seconds. This requirement is the single owner of restart recovery for every job kind. At server start, every job found in `running` SHALL be handled as follows: a local kind is re-queued, counted against `maxAttempts`, and an `export.remote` or `export.sequence` job restarts from frame 0 and ends `failed` with `export/host-restarted` when attempts are exhausted; a provider kind that holds a `providerTaskId` resumes polling that task and submits nothing; a provider kind without a `providerTaskId` is marked `recovery: "unknown"`, the server queries the provider by idempotency key when the provider supports it, and otherwise waits 600 000 ms and then re-submits exactly once; an orchestration kind is resumed by its owning engine from its durable run record (`agent-workflows`, `multi-agent-orchestration`, `script-studio`, `film-production`). The queue SHALL stop starting jobs and persist progress within 10 seconds of the start of the server's shutdown sequence (`server-api.Service lifecycle`): a termination signal to the server, `jagentchill.diagnostics.shutdown.prepare`, or `jagentchill stop`. A stop, crash or restart of the Gateway child alone does not stop the queue: local kinds and provider kinds keep running, and an orchestration kind (`workflow.run`, `script.run`, `film.step`, team runs, loops and automation runs) follows one rule that its owning engine applies and does not vary: **a step that needs the Gateway — one that is running an agent turn when the link drops, or one that becomes due while the link is down — is parked with the wait reason `waiting_gateway`; it keeps its inputs, its place in the run and its slot, consumes none of the run's or the automation's time limits while parked, and is started again (an interrupted turn is sent again as a new turn with the same step input) within 5 s of the gateway link being ready; a step parked for 600 000 ms without the link becoming ready fails with `GATEWAY_UNAVAILABLE` (`retryable: true`, `details.reason` as the supervisor reports it) and from there follows the step's own failure handling; steps of the same run that do not need the Gateway keep running throughout.** A device request that needs the Gateway is never parked: it answers `GATEWAY_UNAVAILABLE` at once (`server-api.Gateway calls over the link`). [NEW]

#### Scenario: Cancel a running export
- **WHEN** `jagentchill.job.cancel` is called for a running `export.remote` job
- **THEN** the job state is `cancelled` within 5 seconds, the FFmpeg and render-host processes have exited, and the partial output file is removed within 60 seconds

#### Scenario: Server restart during generation with a task id
- **WHEN** the server restarts while a `generation.video` job holds `providerTaskId` `t-123`
- **THEN** the job resumes polling `t-123` and no second provider request is submitted

#### Scenario: Server restart during generation without a task id
- **WHEN** the server restarts while a `generation.image` job has no `providerTaskId` and the provider has no idempotency lookup
- **THEN** the job shows `recovery: "unknown"` for 600 000 ms and is then re-submitted once

#### Scenario: Export interrupted three times
- **WHEN** an `export.remote` job is interrupted by a server restart on each of its 3 attempts
- **THEN** it ends `failed` with code `export/host-restarted`

#### Scenario: Cancel a finished job
- **WHEN** cancel is called on a `succeeded` job
- **THEN** the response error code is `CONFLICT` and the job is unchanged

#### Scenario: Gateway child restarts during a local job
- **WHEN** the supervised Gateway crashes and is restarted while a `media.proxy` job and an `export.remote` job run
- **THEN** both jobs continue without a new attempt and end `succeeded`

#### Scenario: Orchestration step during a Gateway restart
- **WHEN** a `workflow.run` job has one `agent` node mid-turn and one `generate` node running, and the Gateway child restarts and is ready again after 40 s
- **THEN** the agent step is parked with wait reason `waiting_gateway`, the generate step finishes meanwhile, and the agent step starts a new turn with the same input within 5 s of the link being ready

#### Scenario: Gateway does not come back
- **WHEN** a step has been parked with `waiting_gateway` for 600 000 ms while the supervisor is in `crash_loop`
- **THEN** the step fails with `GATEWAY_UNAVAILABLE`, `details.reason` `crash_loop`, and the run applies that step's failure handling

### Requirement: Job RPCs and events
The server SHALL expose `jagentchill.job.list` (filters `kind`, `state`, `projectId`, `createdBy`, `batchId`, `targetType` with `targetId`, `filmEpisodeId`, `filmStage`; paginated), `jagentchill.job.get`, `jagentchill.job.cancel`, `jagentchill.job.retry` (only for `failed` or `cancelled`; resets `attempt` to 1 on the same `jobId`), `jagentchill.job.subscribe` and `jagentchill.job.unsubscribe`, and SHALL emit `jagentchill.job.updated` on stream `job` with the full job record on every state change and on coalesced progress. There SHALL be no pause or resume method for host jobs. Reading jobs requires `jagentchill.projects.read`; cancel and retry require the scope that was needed to create the job. `jagentchill.job.list` is the pull RPC of stream `job`. [NEW]

#### Scenario: Filter by project and state
- **WHEN** a client lists jobs with `projectId` P and `state` `running`
- **THEN** only running jobs attached to project P are returned

#### Scenario: Retry a failed job
- **WHEN** `jagentchill.job.retry` is called on a `failed` job
- **THEN** the job returns to `queued` with `attempt` 1 and subscribers receive `jagentchill.job.updated`

#### Scenario: Retry a running job
- **WHEN** retry is called on a `running` job
- **THEN** the response error code is `CONFLICT`

#### Scenario: Viewer cancels an export
- **WHEN** a `viewer` device calls `jagentchill.job.cancel` on an `export.remote` job
- **THEN** the response error code is `SCOPE_DENIED` with `details.requiredScope` `jagentchill.export.run`

### Requirement: FFmpeg worker
Host-side encoding, proxy generation, transcoding and concatenation SHALL invoke FFmpeg and FFprobe as separate child processes; the server SHALL NOT link FFmpeg libraries, and FFmpeg alone never composes frames (`server-api.Render host supervision and health`). The binary SHALL be resolved in this order: `ffmpeg.path`, the binaries bundled with the desktop app or the headless image (the primary LGPL build, and `ffmpeg-openh264` only while the verified OpenH264 library is installed, `server-api.Host encoder policy and codec table`), then `ffmpeg` and `ffprobe` found on the host `PATH`. At service start the server SHALL run `-version` and `-encoders`, accept only version 6.1 or newer, and record the usable encoder set; a binary from `ffmpeg.path` or the host is accepted whatever its licence configuration, because the LGPL-only rule applies to the binary JAgentChill distributes and is enforced at build time (`updates-distribution.Desktop packaging targets`). When no acceptable binary exists, FFmpeg-dependent jobs SHALL fail immediately with `FFMPEG_UNAVAILABLE` and `details.reason` (`missing`, `too_old`). The encoder preference per codec and the per-codec availability reported to clients are those of `export-share.Encoder availability and licensing` (HEVC is offered only when the recorded set contains a hardware HEVC encoder; no software HEVC encoder is distributed); `jagentchill.settings.host.get` SHALL return the codec table. A job whose codec is not `available` fails with `export/codec-unavailable` before any process starts. Arguments SHALL be passed as an argument array (never through a shell); inputs SHALL be files inside the server's data directory, linked-blob paths recorded by `cross-device-sync.Local blob linking`, the stdin pipe fed by the render host, or a second input file holding the mixed audio of the same job; outputs SHALL be written inside the server's data directory; delivering a finished file to another host folder (an automation's destination) is a copy made afterwards by the owner of that feature, not an FFmpeg output path. Progress SHALL be parsed from `-progress pipe:1` and mirrored into the job heartbeat. The child environment SHALL contain no secret and no variable matching the deny patterns of `security-privacy.Environment stripping for child processes`. [NEW]

#### Scenario: User-supplied GPL build accepted
- **WHEN** `ffmpeg.path` points at a version 7.0 build configured with `--enable-gpl`
- **THEN** the binary is accepted and `encoders` lists `libx264`

#### Scenario: Old binary
- **WHEN** the only FFmpeg found is version 5.1
- **THEN** an `export.remote` job fails with `FFMPEG_UNAVAILABLE`, `details.reason` `too_old`, and health `reasons` contains `ffmpeg_missing`

#### Scenario: Progress reported
- **WHEN** a 60-second export runs
- **THEN** `jagentchill.job.updated` events carry `progress` values that increase monotonically and reach 1.0 at success

#### Scenario: Stalled process
- **WHEN** FFmpeg emits no progress for 90 000 ms
- **THEN** the process tree is terminated and the attempt fails with `TIMEOUT`

#### Scenario: Output path outside the data directory
- **WHEN** a job requests an output path outside `<dataDir>/`
- **THEN** the job fails with `INVALID_PARAMS` before any process starts

### Requirement: Render host supervision and health
Every composition of frames on the Gateway (remote export, agent frame rendering when no client surface is focused, unattended automation renders, effect-bearing thumbnails and proxies) SHALL use the single render host of design D11b: the JAgentChill Electron binary started as a child process with `--render-host` (no window), which runs the same engine surface as clients; the engine command protocol and frame format are owned by `render-engine.Render host` and `render-engine.Render host protocol`, and the executable mode by `desktop-app.Render host process mode`. The server owns its lifecycle: the executable is resolved from `renderHost.path`, then the desktop app's own executable (passed by the desktop app, when it starts the server, in `JAGENTCHILL_RENDER_HOST_PATH`), then the binary shipped in the headless distribution (`updates-distribution.Headless Gateway distribution and update`); the server spawns it with an argument array, with outbound networking disabled, with the stripped environment of `security-privacy.Environment stripping for child processes`, and talks to it only over stdio pipes (fd 3: length-prefixed JSON commands and replies; fd 4: raw frames, which the server forwards to FFmpeg stdin). One render-host process SHALL exist per running `export.remote` or `export.sequence` job, each counted against `queue.ffmpegWorkers`; `render.frame` and `workflow.record` jobs share one on-demand render-host process (started on first use, exiting after 60 s idle, counted as one worker); clients are never used as renderers for host jobs. At service start, and every 300 seconds while idle, the server SHALL run a probe (spawn, expect a `hello` reply within 10 000 ms carrying `engineVersion`, `backend` in `webgpu | webgl2` and `software: boolean` — software rasterisation is reported as `{ backend: "webgl2", software: true }`, which the render host always accepts, unlike a client engine (`render-engine.GPU backend selection and WebGL2 fallback`) — then exit); a failed probe sets health reason `render_host_unavailable`, and a render host that can create no graphics context at all, not even in software, writes no `hello` and is recorded as unhealthy with the detail `no-backend` (`render-engine.Behaviour without a GPU backend`), which `jagentchill.settings.host.get` shows beside the render host state. A render host that exits or stops replying for 30 000 ms during a job fails that attempt with `RENDERER_UNAVAILABLE` (retryable); the job is re-queued from frame 0 by the queue's retry policy while attempts remain (this requirement, not `render-engine`, owns crash handling, re-queue and probe cadence); three consecutive failed probes are retried at 1 s, 5 s and 30 s and then every 300 seconds. The Gateway SHALL advertise the feature `remote-render` only while the last probe passed, and `remote-export` whenever it passed and FFmpeg is present — whatever the H.264 state; which codecs a job can use is the codec table of `server-api.Host encoder policy and codec table`. When the render host is unavailable, every dependent tool and RPC SHALL answer `RENDERER_UNAVAILABLE`, export steps of workflows, films and automations end `skipped` with reason `no_renderer` as defined by their owners, and the project stays openable. [NEW]

#### Scenario: Healthy render host
- **WHEN** the server is started by the desktop app
- **THEN** the probe passes, `features["remote-render"]` is true and `jagentchill.settings.host.get` reports the render host `backend` and `software`

#### Scenario: No render host on a bare server install
- **WHEN** the server runs on a host that has neither `renderHost.path` nor a bundled binary
- **THEN** health `reasons` contains `render_host_unavailable`, `features["remote-render"]` and `features["remote-export"]` are false
- **AND** `jagentchill.export.create` answers `RENDERER_UNAVAILABLE`

#### Scenario: Render host crashes during an export
- **WHEN** the render-host process exits while an `export.remote` job is at 40 %
- **THEN** the attempt fails with `RENDERER_UNAVAILABLE`, the FFmpeg process is terminated, the partial file is deleted and the job is re-queued from frame 0 while attempts remain

#### Scenario: Render host has no network
- **WHEN** engine code inside the render host attempts an HTTP request to an external host
- **THEN** the request fails and no outbound connection leaves the host

### Requirement: Host encoder policy and codec table
Host encoding SHALL never block on a licence or on a prompt (decision A4, design D11). (1) **Always available**: the FFmpeg the product distributes (LGPL build) contains libvpx (VP9), SVT-AV1 (AV1), libopus and the native AAC encoder, so every host with FFmpeg can encode VP9 or AV1 video with Opus audio in WebM or MP4. (2) **H.264** is `available` when a working hardware encoder exists (VideoToolbox on macOS; Media Foundation, NVENC, Quick Sync or AMF on Windows; VA-API, NVENC or Quick Sync on Linux; each verified at service start by encoding 10 frames) OR the OpenH264 library has been installed; otherwise its state is `download_required`. (3) **OpenH264** is never compiled into a distributed binary and never fetched at export time. It is fetched from Cisco's official binary host only as a host-setup action after an admin accepted the notice "OpenH264 Video Codec provided by Cisco Systems, Inc.": the desktop first-run dialog (macOS, Windows and Linux alike; "Download" / "Not now", re-openable from Host ▸ Diagnostics), `jagentchill.settings.encoders.install { encoder: "openh264", accept: true }` (scope `jagentchill.config.write`), `jagentchill encoders install openh264 --accept` on any host, or the environment variable `JAGENTCHILL_ACCEPT_OPENH264=1` at start of a headless or container host. The server verifies the download against the SHA-256 pinned in the release manifest, stores it under `<dataDir>/encoders/`, and loads it through a second distributed FFmpeg build (`ffmpeg-openh264`, linked against the shared library and resolved only when the library file is present and verified; the primary build has no such dependency and starts without it). The download host is a row of `security-privacy.Network egress control`; when egress is blocked the state stays `download_required` with `details.reason: "egress_blocked"`. (4) **HEVC** is offered only with a verified hardware encoder. (5) **Codec table**: `jagentchill.settings.encoders.get` (scope `jagentchill.config.read`) and `jagentchill.settings.host.get` return `encoders: { h264, hevc, vp9, av1, aac, opus }`, each `{ state: "available" | "download_required" | "unavailable", encoder?, hardware: boolean, reason? }`, re-announced with `jagentchill.settings.host.changed`; `export-share.Encoder availability and licensing` presents it and owns per-codec quality settings. (6) **Fail fast**: an export, proxy or transcode job whose requested codec is not `available` fails at creation, or at start when the state changed in between, with `export/codec-unavailable` and `details { requested, available[], downloadRequired[] }`, and is never left `queued` waiting for a download or a person; a caller can pass an ordered `codecPreference[]` (automations and workflow export steps do), and the first available entry is used and reported in the job result. (7) **Defaults**: proxies and mezzanines use H.264 when available, else VP9; the default host export container and codecs are H.264 + AAC in MP4 when H.264 is available, else VP9 + Opus in WebM — never Opus in MP4 as a silent default. (8) The feature `remote-export` is advertised whenever the render host is healthy and FFmpeg is present, whatever the H.264 state. The split-binary loading of OpenH264 is verified per platform and architecture by the packaging test `ffmpeg-openh264-split` of `updates-distribution.Desktop packaging targets`; on a platform where it does not pass, H.264 is hardware-only and the table says so. [NEW]

#### Scenario: Container without a hardware encoder
- **WHEN** the headless image starts with default settings on a machine without a GPU
- **THEN** `features["remote-export"]` is true, the table reads `h264: download_required`, `vp9: available`, `av1: available`, and an export with no codec stated completes as VP9 + Opus in WebM

#### Scenario: H.264 requested while unavailable
- **WHEN** `jagentchill.export.create` asks for H.264 on that host
- **THEN** the call fails at once with `export/codec-unavailable`, `details.available` lists `vp9` and `av1`, `details.downloadRequired` lists `h264`, and no job is queued

#### Scenario: Unattended export with a preference list
- **WHEN** an automation's export instruction carries `codecPreference: ["h264", "vp9"]` on the same host at 03:00
- **THEN** the job runs with VP9, its result records `codec: "vp9"` and `preferenceSkipped: ["h264"]`, and nothing waits for a person

#### Scenario: Accepting OpenH264 on each platform
- **WHEN** an admin accepts the first-run dialog on macOS, Windows and Linux hosts without a hardware H.264 encoder, or a container starts with `JAGENTCHILL_ACCEPT_OPENH264=1`
- **THEN** the library is downloaded once, verified, the table reads `h264: available` with `hardware: false`, and an audit record `encoder.installed` exists

#### Scenario: Tampered download
- **WHEN** the downloaded library's SHA-256 differs from the manifest
- **THEN** the file is deleted, the state stays `download_required` with `reason: "verification_failed"`, and the primary FFmpeg keeps working

### Requirement: Tailnet ingress bridge
The server SHALL own a tailnet ingress for the host, modelled on JAgentDesk's embedded Tailscale: the ingress helper of `server-api.Product listeners and path restriction` run with an embedded `tsnet` node that joins the user's tailnet as its own machine. It is a path-restricted reverse proxy, never a raw TCP forwarder: it listens inside the tailnet node on port 18910 (plain HTTP and WebSocket; the WireGuard tunnel encrypts the path) and, when the tailnet issues browser-trusted certificates for node names, additionally with TLS on port 443 for its `ts.net` name so that browsers have a trusted `wss` address; on both it applies rules 1 to 5 of the product listeners, with the peer address and node name taken from the tailnet node's own `WhoIs` answer for the connection. The tailnet address SHALL be advertised, and placed in pairing offers, only after the helper reported ready with its DNS name. State: node state directory `<dataDir>/tailnet/` (owner-only); node name `tailnet.nodeName` (default `jagentchill-<first 6 hex of gatewayId>`); states `disabled`, `needs-login`, `starting`, `ready`, `expired`, `failed`, reported by `jagentchill.settings.tailnet.get` (scope `jagentchill.config.read`) with `dnsName`, `tailnetName`, `keyExpiry_ms`, `httpsName?` and `error?`. Enable and disable is the "Tailnet" level of the desktop "Network access" setting (host configuration `tailnet.enabled`) and `jagentchill tailnet up | down | status | logout` on any host; sign-in uses `jagentchill.settings.tailnet.login { mode: "interactive" | "authKey", secretName? }` (scope `jagentchill.config.write`), which returns the login URL only to the calling device, or reads an auth key previously written as a secret and deletes that secret after use; `jagentchill.settings.tailnet.logout` stops the node and deletes its state. A node key that expired sets state `expired`, removes `tailnet` entries from new offers, and raises the notification kind `host.tailnet_expired` of `notifications.Notification event catalogue` to devices holding `jagentchill.config.write`. The run profile sets `gateway.tailscale.mode: "off"` and `gateway.auth.allowTailscale: false`, so OpenClaw's own Tailscale integration never serves the Gateway, and the server SHALL never enable a public funnel. The bridge's only external hosts are the Tailscale coordination and relay servers listed in `security-privacy.Network egress control`; there is no relay or rendezvous server of the product. Bridge state changes, sign-in and sign-out are audited; a bridge that is selected and not `ready` is reported by health with reason `tailnet_bridge_down` without making the status `degraded`. The Gateway part of spike S20 gates this requirement; it has no automatic fallback (a raw forwarder is not acceptable): a failed record is `awaiting-owner` and remote access stays limited to the LAN listener until the owner decides. [JAD] [NEW]

#### Scenario: Ready before advertising
- **WHEN** an admin enables the tailnet level and completes sign-in
- **THEN** the state moves `needs-login`, `starting`, `ready`, and only then does `jagentchill.pairing.offer.create` return an offer with a `tailnet` address

#### Scenario: Connection attributed to its tailnet peer
- **WHEN** a paired phone connects through the bridge
- **THEN** its channel P connection record has `transport` `tailnet`, the phone's tailnet address and node name, and a desktop renderer connected at the same time has `transport` `loopback`

#### Scenario: Tailnet member probes the Gateway
- **WHEN** an unpaired machine of the tailnet requests `/`, the Control UI path and the native WebSocket on the host's tailnet address
- **THEN** every answer is HTTP 404 from the bridge, only `/jagentchill/` paths reach the server, and nothing reaches the Gateway

#### Scenario: Bridge crash
- **WHEN** the bridge process is killed
- **THEN** it is restarted after 1 second with a new bridge secret, connections through it are dropped and reconnect, and health lists `tailnet_bridge_down` until the ready line is seen again

#### Scenario: Run profile violated
- **WHEN** `gateway.auth.mode` is `none` and an admin enables the tailnet level
- **THEN** the bridge is not started and the setting shows "Fix the host security profile first" with the doctor finding

#### Scenario: Headless enablement
- **WHEN** the operator runs `jagentchill tailnet up` on a headless host and opens the printed login URL
- **THEN** `jagentchill tailnet status --json` reports `ready` with the DNS name, and an audit record with actor `host-cli` exists

#### Scenario: Logout
- **WHEN** an admin signs the host out of Tailscale
- **THEN** the bridge exits, the node state directory is empty, new offers contain no `tailnet` address, and devices connected over `lan` stay connected

### Requirement: Server configuration
All host configuration SHALL live in the server's own configuration file `<dataDir>/config.json` (owner-only, replaced atomically), validated at every start and on every patch by the strict Zod schema `ServerConfig` exported by `packages/protocol`; nothing of it lives in the Gateway configuration. The key table is (owner in parentheses where another capability defines the semantics):

| Key | Default | Range | Applied |
|---|---|---|---|
| `server.port` (the server's loopback listener), `server.gatewayPort` (the supervised Gateway's loopback port, `server-api.Gateway supervision and lifecycle`) | 18910; 18911 | 1024–65535, different from each other and from `lan.port` | restart |
| `queue.maxConcurrent` | 4 | 1–32 | live |
| `queue.ffmpegWorkers` | `max(1, floor(cpuCount / 2))`, cap 4 | 1–8 | live |
| `limits.<rateLimitName>` (the rate limits of `server-api.Rate limiting`) | 1.0 | 0.1–10 | live |
| `limits.maxConcurrentTurns` (capability `chat-agent`), `limits.maxConcurrentPeersPerLead` (`multi-agent-orchestration.Team model`) | owner-defined | positive integer | live |
| `http.allowedOrigins`, `http.allowedHosts` | `[]` | ≤ 32 entries each | live |
| `http.serveWebApp` | true | boolean | restart |
| `http.shareLinks.enabled`, `http.webhooks.enabled` | false | boolean | live |
| `ffmpeg.path`, `renderHost.path` | unset | absolute path | service reload |
| `storage.quotaBytes` | 107 374 182 400 | ≥ 1 073 741 824 | live |
| `storage.exportRetentionDays` | 30 | 1–90, or `"forever"` | live |
| `storage.generatedRetentionDays` | 90 | 1–365, or `"forever"` | live |
| `storage.exportQuotaBytes` | 21 474 836 480 | ≥ 1 073 741 824 | live |
| `storage.trashRetentionDays` | 30 | fixed | — |
| `storage.lowSpaceWarnBytes` | 5 368 709 120 | 1–100 GiB | live |
| `audit.agentRetentionDays` | 90 | 7–730 | live |
| `tailnet.enabled`, `tailnet.nodeName` (`server-api.Tailnet ingress bridge`) | false; `jagentchill-<6 hex>` | boolean; 1–63 DNS-label characters | live |
| `lan.enabled`, `lan.port` (`server-api.Product listeners and path restriction`) | false; 18790 | boolean; 1024–65535 | live |
| `encoders.codecPreference` (default order used when a job states none, `server-api.Host encoder policy and codec table`) | `["h264", "vp9", "av1"]` | permutation of the three | live |
| `network.offlineMode`, `network.hosts.*`, `network.contentHostBaseUrl` (`security-privacy.Network egress control`) | false; per row; the publisher's content host | boolean; per row; an `https` base URL | live |
| `terminal.enabled` (`workspaces-terminal.Terminal enablement and host-shell warning`) | false | boolean | live |
| `terminal.idleTimeoutMinutes`, `terminal.maxLifetimeHours`, `terminal.scrollbackLines`, `terminal.shellIntegration`, `workspaces.*` (capability `workspaces-terminal`) | owner-defined | — | live |
| `agents.allowWorkspaceAgentsForEditors` (`security-privacy.Agent classes`) | false | boolean | live |
| `agents.callPolicy` (`multi-agent-orchestration.Who-can-call-whom policy presets`), `agents.limits` (including the loop-guard ceilings of `multi-agent-orchestration.Loop prevention`: turns per tree, default 200, range 20–2,000, and running minutes per tree, default 240, range 10–1,440), `agents.tools.enabled`, `agents.autonomous.enabled` (capability `multi-agent-orchestration`) | owner-defined | — | live |
| `push.enabled`, `connectors.enabled` | false | boolean | live |
| `updates.checkEnabled` (`updates-distribution`) | true | boolean | live |
| `logging.level` (`diagnostics-quality.Structured logging`) | `info` | `error`, `warn`, `info`, `debug` | live |
| `orc` (`orc-model-routing.ORC configuration store`; `orc.approval.default`, `orc.approval.minimum` and `orc.teams.enabled` by `multi-agent-orchestration.Common approval policy`; `orc.parkedTimeoutHours`, default 72, range 1–720, by `multi-agent-orchestration.Team limits`) | owner-defined | — | live |
| `budgets` including `budgets.maxSelfServiceUsd` (`generation-providers.Budgets with hard stop`) | owner-defined | — | live |
| `runtimes`, `endpoints` (capability `agent-runtimes`), `skills.*` (capability `skills`), `usage.*` (capability `usage-tracking`), `workflow.*` (capability `agent-workflows`) | owner-defined | — | live |
| `scripts.review.requireDifferentModel` (`script-studio.Approval policy and precedence`; shown by `settings-preferences`) | false | boolean | live |
| `library.peopleGrouping` (grouping of faces in smart search on this host, `security-privacy.Biometric grouping is opt-in`; turning it off deletes the stored groups) | false | boolean | live |

The top-level groups of this table (`server`, `queue`, `limits`, `http`, `ffmpeg`, `renderHost`, `storage`, `audit`, `tailnet`, `lan`, `encoders`, `network`, `terminal`, `workspaces`, `agents`, `orc`, `budgets`, `runtimes`, `endpoints`, `skills`, `usage`, `workflow`, `scripts`, `library`, `push`, `connectors`, `updates`, `logging`) are closed and the schema is strict at every level: a key it does not define makes the server refuse to start and name the key (`server-api.Server identity and startup`) and makes a patch fail with `INVALID_PARAMS`, and a capability that needs a key adds it inside its own group. For supervisors and tests the environment variables `JAGENTCHILL_DATA_DIR`, `JAGENTCHILL_PORT`, `JAGENTCHILL_GATEWAY_PORT` and `JAGENTCHILL_OPENCLAW_ROOT` (the built Gateway to supervise) override the data directory, the two ports and the bundled Gateway location for one process and are never written to the file. Keys are written without a prefix everywhere: `<path>` of this table, never `config.<path>`. The only spelling of the editors' workspace-agent switch is `agents.allowWorkspaceAgentsForEditors`. There is no `pairing` group and no plaintext-LAN key: a LAN connection is always TLS (design D7.6). Fixed constants that are not configurable: offer lifetime 600 000 ms, lease duration 30 000 ms, proxy format. Clients SHALL read configuration with `jagentchill.settings.host.get` (scope `jagentchill.config.read`; secret values never included; the response also carries `serverVersion`, `openclawVersion`, the Gateway supervision state `gateway { state, since_ms, restarts, lastExit? }`, the codec table `encoders{}`, render host state, listener states and `placement: "desktop" | "container" | "headless"`) and change it with `jagentchill.settings.host.patch` (scope `jagentchill.config.write`), which SHALL validate the merged result, persist it by an atomic replace of `config.json`, apply keys marked `live` without a server restart, return `restartRequired: true` for keys marked `restart`, write an audit record of the changed keys, and emit `jagentchill.settings.host.changed`. A patch SHALL NOT be able to change any key of the run profile of `platform-skeleton.Gateway run profile` or any other key of the Gateway configuration: that file is written only by the server itself (`server-api.Gateway supervision and lifecycle`, `platform-skeleton.Run profile application`, the admin proxies). [NEW]

#### Scenario: Valid patch applied live
- **WHEN** an admin patches `queue.maxConcurrent` to 6
- **THEN** the response is `ok` with `restartRequired: false` and all subscribed clients holding `jagentchill.config.read` receive `jagentchill.settings.host.changed` within 1 second

#### Scenario: Invalid value
- **WHEN** an admin patches `queue.maxConcurrent` to 0
- **THEN** the response error code is `INVALID_PARAMS` and the stored configuration is unchanged

#### Scenario: Non-admin patch
- **WHEN** a device with role `editor` calls `jagentchill.settings.host.patch`
- **THEN** the response error code is `SCOPE_DENIED`

#### Scenario: Restart-only key
- **WHEN** an admin patches `http.serveWebApp` to false
- **THEN** the response has `restartRequired: true` and the static route keeps serving until the server restarts

#### Scenario: Patch touching the run profile
- **WHEN** a patch names `gateway.nodes.pairing.autoApproveLocal`
- **THEN** the response error code is `INVALID_PARAMS` and neither `config.json` nor the Gateway configuration is written

### Requirement: Host storage accounting and cleanup
The server SHALL expose `jagentchill.settings.storage.get` (scope `jagentchill.config.read`) returning `quotaBytes`, `usedBytes`, `freeDiskBytes`, `linkedBytes` and a breakdown in bytes for `projects`, `media`, `proxies`, `exports`, `generated`, `workspaces`, `trash` and `backups`, computed within 2 seconds for a store of 100 000 blobs. The quota applies only to blob, export and artifact writes; operations, snapshots, comments, settings and audit records SHALL always be accepted, and bytes of linked blobs (`cross-device-sync.Local blob linking`) are outside the quota. A blob, export or artifact write that would take `usedBytes` above `quotaBytes`, exports above `storage.exportQuotaBytes`, or that starts while the data volume has less than 1 073 741 824 bytes free SHALL be refused with `QUOTA_EXCEEDED` (HTTP 507 on routes) and `details { reason: "quota" | "export_quota" | "disk", availableBytes }`. When usage reaches 90 % of the quota or free disk space falls below `storage.lowSpaceWarnBytes`, the server SHALL raise the notification kind `storage.low_space` of `notifications.Notification event catalogue` to devices holding `jagentchill.config.read`, at most once per 24 hours, and a write refused with `QUOTA_EXCEEDED` SHALL raise the kind `storage.quota_exceeded` to the same devices, at most once per hour per reason. A background sweep SHALL run every 6 hours and at start: it SHALL delete blobs referenced by no project, version, snapshot, export, artifact, library item, trash entry or pending upload for more than 24 hours; purge trash entries older than 30 days; purge export files older than `storage.exportRetentionDays` (never when `"forever"`) and, when exports exceed `storage.exportQuotaBytes`, the oldest exports first; delete generated assets that no project, film, script, workflow run or library item has referenced for `storage.generatedRetentionDays` (never when `"forever"`); and delete incomplete uploads idle for more than 7 days. The doctor report of `diagnostics-quality.Host doctor report` SHALL use the same thresholds. [NEW]

#### Scenario: Orphan blob collected
- **WHEN** a blob has had no reference for 25 hours and the sweep runs
- **THEN** the blob file is deleted and `usedBytes` drops by its size

#### Scenario: Referenced blob kept
- **WHEN** a blob is referenced only by a project in the trash that is 10 days old
- **THEN** the sweep keeps the blob

#### Scenario: Quota reached
- **WHEN** an upload `init` for a 2 GiB blob arrives with 1 GiB of quota left
- **THEN** the response is HTTP 507 with code `QUOTA_EXCEEDED`, `details.reason` `quota` and `details.availableBytes`

#### Scenario: Disk nearly full
- **WHEN** the data volume has 800 MiB free and a blob upload starts
- **THEN** the response is HTTP 507 `QUOTA_EXCEEDED` with `details.reason` `disk`
- **AND** a `jagentchill.sync.ops.push` in the same minute succeeds

#### Scenario: Low-space notice
- **WHEN** usage crosses 90 % of the quota
- **THEN** one `storage.low_space` notification is raised and no second one within 24 hours

### Requirement: Host backup and restore
`jagentchill.settings.backup.create` (scope `jagentchill.config.write`) SHALL produce a consistent backup consisting of a SQLite online-backup copy of the database plus a manifest of blob hashes, the skills lock file and usage data, written to `backups/manual-<time_ms>/`, and SHALL include blob contents when `includeBlobs` is true. The CLI command `jagentchill restore <path>` SHALL restore a backup only while the server is stopped, SHALL verify every restored blob's SHA-256, and SHALL refuse a backup whose schema version is newer than the server supports. Secrets and the product's Gateway identity key (the key behind `gatewayId`) SHALL be excluded from backups unless `includeSecrets` is true, in which case the backup's secret archive SHALL be encrypted with AES-256-GCM under a key derived by scrypt (N = 2^15, r = 8, p = 1, 16-byte random salt) from a passphrase of 12 or more characters. Including secrets is possible only on the host: `jagentchill backup --include-secrets` asks for the passphrase at an interactive prompt (or reads it from the file named by `--passphrase-file`, which must be owner-only); the RPC `jagentchill.settings.backup.create` SHALL reject `includeSecrets: true` with `UNSUPPORTED_FEATURE` and `details.hostCommand`, because a passphrase is a secret and secrets are never RPC parameters and no route carries it. The Gateway token, the link identity and the tool endpoint secret (`server-api.Gateway secrets`) and the directory `gateway-state/` are never part of a backup made by this requirement, with or without `includeSecrets`; a restored host generates new Gateway secrets at its next start. [NEW]

#### Scenario: Backup while jobs run
- **WHEN** a backup is created while two jobs are running
- **THEN** the backup database opens cleanly with `PRAGMA integrity_check` returning `ok`

#### Scenario: Round trip
- **WHEN** a backup with `includeBlobs` true is restored onto an empty data directory and the server starts
- **THEN** every project, version and blob of the source is present and paired devices reconnect without pairing again when secrets were included

#### Scenario: Corrupt blob in a backup
- **WHEN** a restore finds a blob whose hash does not match its name
- **THEN** the restore stops, restores nothing further, reports the blob hash, and leaves the previous data directory in place

#### Scenario: Short passphrase
- **WHEN** `jagentchill backup --include-secrets` is given a passphrase of 8 characters
- **THEN** the command exits non-zero with "Passphrase must be at least 12 characters" and writes nothing

#### Scenario: Secrets requested over RPC
- **WHEN** an admin device calls `jagentchill.settings.backup.create { includeSecrets: true }`
- **THEN** the response error code is `UNSUPPORTED_FEATURE` with `details.hostCommand` `jagentchill backup --include-secrets`

### Requirement: Host command-line surface
The server SHALL ship its own command line, `jagentchill` (the `bin` of `@jagentchill/server`); JAgentChill adds no command to the `openclaw` CLI. It provides: `jagentchill serve [--data-dir <path>] [--port <n>]` (runs the server in the foreground; the entry used by the desktop app, the container image and service managers), `status`, `stop`, `gateway status | restart [--rotate-secrets] | logs`, `pair` (prints the pairing offer as link, short code and terminal QR, then lists incoming requests with their verification codes until interrupted), `devices list | revoke <deviceId> | role <deviceId> <role> | add-admin --public-key <key> [--local-supervisor]`, `rekey --yes`, `doctor [--fix]`, `backup [--include-blobs] [--include-secrets]`, `restore <path>`, `erase --yes`, `tailnet up | down | status | logout`, `lan up | down | status | cert --cert <file> --key <file>`, `encoders list | install openh264 --accept | remove openh264`, `workspace list | add <path> | remove <id> | trust <id> | script list|start|stop <workspaceId> [name]` (`workspaces-terminal.Scripts with logs`), `terminal enable [--acknowledge] | disable | list | kill <terminalId> | activity` (`activity` is the command a shell or a CLI agent's own hook runs to report terminal activity, `workspaces-terminal`), `hooks list | enable <triggerId> | disable <triggerId>` and `hooks <agent> <event>` (the command that an installed CLI agent's hook configuration calls to report its lifecycle events to the server, `workspaces-terminal`). Every command other than `serve` runs in a separate process, so every command that needs live server state SHALL call the running server through its **local admin endpoint**: a Unix domain socket `<dataDir>/run/admin.sock` with mode `0600` inside a `0700` directory on macOS and Linux, and a named pipe `\\.\pipe\jagentchill-admin-<first 8 hex of gatewayId>` whose ACL grants the current user only on Windows. Requests are JSON lines `{ id, method, params }` with a method `jagentchill.hostcli.<verb>` (for example `jagentchill.hostcli.pair.watch`, `jagentchill.hostcli.device.revoke`, `jagentchill.hostcli.terminal.activity`, `jagentchill.hostcli.terminal.set`, `jagentchill.hostcli.gateway.restart`). These methods exist only on the local admin endpoint — not on channel P, not on an HTTP route, not on the Gateway — and are the only callers without a device identity; the endpoint SHALL accept a connection only when the peer's user id equals the server's own (peer credentials of the socket; the pipe ACL on Windows), is not reachable through any network listener, and refuses any other caller before reading a request. Audit records of these calls carry actor `host-cli`. `devices revoke` SHALL go through the same revocation path as `device-pairing-signing.Revocation` so that live sockets close; it SHALL NOT write the store directly. `restore` and `erase` SHALL refuse to run while the server is running (the pid file names a live server process, or the admin endpoint answers). Every command SHALL support `--json` and SHALL exit non-zero on failure. The host OS account that can run these commands is equivalent to role `admin` (`security-privacy.Trust model`). The `openclaw` executable of the pinned Gateway stays usable by the host operator against `<dataDir>/gateway-state/` for OpenClaw's own diagnostics; it is not part of the product surface, and the product names an `openclaw` command only in the `details.hostCommand` values of `server-api.Narrow admin proxies`. [NEW]

#### Scenario: Headless first pairing
- **WHEN** the operator runs `jagentchill pair` on a headless host with no paired device
- **THEN** the terminal shows the offer link, the short code and a QR code
- **AND** when a device requests pairing, the terminal prints the device name, the first 8 hex characters of its key fingerprint and the six-digit verification code

#### Scenario: Host CLI method from a paired device
- **WHEN** a paired `admin` device sends method `jagentchill.hostcli.device.revoke` on channel P
- **THEN** the response error code is `NOT_FOUND` with `details.reason` `unknown_method`, nothing is revoked, and no network listener of the host offers the method

#### Scenario: Revoke from the CLI closes sockets
- **WHEN** the operator runs `jagentchill devices revoke <deviceId>` while that device is connected
- **THEN** the device's channel P connection closes with code 4403 within 2 seconds and the audit record names actor `host-cli`

#### Scenario: Doctor finds local auto-approval enabled
- **WHEN** `gateway.nodes.pairing.autoApproveLocal` is not `false`
- **THEN** `jagentchill doctor` prints `fail pairing-policy: local auto-approval must be disabled` and exits non-zero

#### Scenario: Machine-readable output
- **WHEN** `jagentchill devices list --json` is run
- **THEN** stdout is a single JSON document with a `devices` array and nothing else

#### Scenario: Enable the terminal without a client
- **WHEN** the operator runs `jagentchill terminal enable` on a headless host and confirms the printed warning
- **THEN** `terminal.enabled` becomes true and an audit record with actor `host-cli` is written

#### Scenario: Another account on the host
- **WHEN** a process running as a different OS user connects to the local admin endpoint
- **THEN** the connection is refused before any request is read, and no method runs

#### Scenario: Command while the server is stopped
- **WHEN** the operator runs `jagentchill devices list` while no server runs on the data directory
- **THEN** the command exits non-zero with "JAgentChill Server is not running" and reads no store file directly

### Requirement: Audit log
The server SHALL keep one audit table with `category` `security` or `agent`. A `security` record SHALL be appended for each of: pairing offer created; pairing requested, verified, declined, expired or locked out; device renamed, role changed, revoked, key rotated; device token rotated; secret created, replaced or deleted (name only); host configuration patched (changed keys only); public route class enabled or disabled; share link created or revoked; webhook delivery accepted, and webhook delivery refused (at most 1 record per trigger per minute); connector configured, connected or disconnected; edit lease force-taken; backup created; restore or erase performed; Gateway rekeyed; every state-changing admin-proxy call (action, target, outcome); terminal enabled, disabled, opened and killed; tailnet bridge enabled, disabled, signed in, signed out and expired; LAN listener enabled, disabled and its certificate changed; forged peer attribution refused (at most 1 record per minute); encoder installed or removed; session access or owner changed; every approval, plan and question resolution with its resolver (`approval.resolved`); a tool call blocked for lack of a permitted initiator; repository trust granted or revoked; workspace configuration written through the server; unattended mode granted or revoked; who-can-call-whom preset changed (old and new value; selecting the preset `all` additionally records the admin's confirmation); "Allow workspace agents for editors" changed; budget raised; approval policy default or minimum changed; skill installed, updated, removed or enabled; skill source changed; signature verification failure (at most 1 record per device per minute). `agent` records are the tool-call records whose shape is owned by `agent-editing-tools.Audit log`. `action` is a dotted name `<area>.<verb>` from the protocol package constant `AUDIT_ACTIONS`, to which each owner adds the actions its requirements name (for example `terminal.opened`, `skill.install`, `workspace.config.trusted`); a contract test fails for an action absent from it. Domain-specific audit views (for example `jagentchill.script.audit.list` of capability `script-studio`) are filtered reads of their own records and do not replace this table. A record SHALL contain `id`, `time_ms`, `category`, `actor` (`{ kind: "device", deviceId } | { kind: "agent", sessionId } | { kind: "host-cli" } | { kind: "automation", id }`), `action`, `targetId`, `sourceAddress` and `outcome`, and SHALL NOT contain secret values, tokens, verification codes, signatures, file contents or terminal bytes. `security` records SHALL be retained 180 days (fixed) and `agent` records `audit.agentRetentionDays` (default 90, range 7 to 730). The single read method is `jagentchill.diagnostics.audit.list` (scope `jagentchill.devices.manage`; paginated; filters `category`, `action`, `actor`, time range). [NEW]

#### Scenario: Revocation is recorded
- **WHEN** an admin revokes device D
- **THEN** an audit record exists with `category` `security`, `action` `device.revoked`, `targetId` D and the admin's device as actor

#### Scenario: Secret value never stored
- **WHEN** an admin replaces the secret `PROVIDER_FAL_API_KEY`
- **THEN** the audit record contains the secret name and does not contain any substring of the secret value

#### Scenario: Editor cannot read the audit log
- **WHEN** an `editor` device calls `jagentchill.diagnostics.audit.list`
- **THEN** the response error code is `SCOPE_DENIED`

#### Scenario: Retention by category
- **WHEN** the sweep runs with a `security` record 181 days old and an `agent` record 91 days old at default settings
- **THEN** both records are deleted, and a `security` record 100 days old is kept

### Requirement: Service lifecycle
The server's services (database worker, queue, sync rendezvous, cleanup sweep, nonce cache, lease timer, render-host supervisor, ingress helper supervisor (tailnet and LAN listeners), gateway supervisor and gateway link, agent tool endpoint, agent relay (Gateway subscriptions, approval store), workflow scheduler, automation scheduler, terminal worker) SHALL start in dependency order after the database is open — the client listener and the services that need no agent first, the Gateway child in parallel with them — and SHALL stop in reverse order on server shutdown within 10 seconds, persisting queue and lease state first; the stop of the Gateway child — which alone can take its full 8 000 ms grace — is started at the beginning of the shutdown, in parallel with the other services, and is the last thing waited for (`server-api.Gateway supervision and lifecycle`). The server SHALL supervise its services itself: a service that throws during start SHALL leave the server running with the reason reported by `server-api.Health route`, and unrelated RPC domains SHALL keep working; a service that crashes while running SHALL be restarted by the server with delays of 1 s, 5 s and 30 s, and after the third consecutive failure SHALL stay stopped, with health reason `service_stopped`, until the server restarts or a device holding `jagentchill.config.write` calls `jagentchill.diagnostics.service.restart { service }` (the Gateway child is the service `gateway`, whose stopped state is reported as `gateway_crash_loop` or `gateway_config_invalid`). A service that runs for 300 seconds without crashing resets its failure count. For a server started by the desktop app the stop sequence is the same on macOS, Windows and Linux and does not depend on an operating-system signal: the desktop app first calls `jagentchill.diagnostics.shutdown.prepare {}` on channel P (accepted only from the device record flagged `localSupervisor`, over loopback, scope `jagentchill.config.write`), on which the server stops starting jobs, persists queue and lease state, stops render hosts, FFmpeg processes, terminals, the ingress helper and the Gateway child, checkpoints the database and answers `{ safe: true }` within 10 000 ms (or `{ safe: false, running[] }` at the limit); the desktop app then terminates the server's process tree (`SIGTERM` then `SIGKILL` after 5 s on macOS and Linux; `taskkill /T /F` on Windows). [NEW]

#### Scenario: Graceful shutdown
- **WHEN** the server receives a termination signal while 2 jobs run
- **THEN** within 10 seconds both jobs are persisted in a recoverable state, the database is closed with its write-ahead log checkpointed, and the Gateway child has exited

#### Scenario: Prepared shutdown on Windows
- **WHEN** the desktop app on Windows quits while an export runs
- **THEN** `jagentchill.diagnostics.shutdown.prepare` answers within 10 seconds with the job persisted as recoverable, and only then is the process tree terminated

#### Scenario: Shutdown prepare from another device
- **WHEN** an `admin` phone calls `jagentchill.diagnostics.shutdown.prepare`
- **THEN** the response error code is `SCOPE_DENIED` and nothing stops

#### Scenario: Queue fails to start
- **WHEN** the queue service throws at start
- **THEN** health reports `degraded` with `queue_stopped`
- **AND** `jagentchill.sync.project.list` still succeeds

#### Scenario: Repeated crash
- **WHEN** a service crashes 3 consecutive times
- **THEN** restarts occurred after 1 s, 5 s and 30 s, it is not restarted a fourth time, and an `error` log entry `service_stopped` is written

#### Scenario: Manual restart
- **WHEN** an admin calls `jagentchill.diagnostics.service.restart` for the stopped service and it starts
- **THEN** health no longer lists `service_stopped`

### Requirement: Agent tools and provider registration
The server SHALL offer every agent-callable tool through its agent tool endpoint (`server-api.Agent tool endpoint and session binding`) and through no other mechanism; the catalogue of tool names is the index of `agent-editing-tools.Tool naming and families`, and the schema of each family lives in the capability that owns its domain. Tool names SHALL match `^jc_[a-z]+(_[a-z0-9]+)+$` and be at most 48 characters; no tool name starts with `jagentchill_`. Specifications and code name a tool by this base name only: the prefix under which an agent sees it is added by its runtime, differs between runtimes, is stated once in `agent-editing-tools.Tool naming and families`, and SHALL NOT be hard-coded anywhere else — the tool endpoint and its session binding compare base names after removing the runtime's prefix. A tool call carries no device or connection identity, therefore: a tool takes no session, device or other caller-identity parameter; it resolves its session from the binding of the MCP connection the call arrived on, its project from the session record written by the relay at session creation (`server-api.Session ownership and visibility`; `jagentchill.session.bind { sessionKey, projectId }`, act rule plus `jagentchill.projects.read` on the project, changes the bound project afterwards) and its initiating device from the run record of `server-api.Run initiator attribution and host-execution gating`, and a tool invoked in a session without a binding SHALL return a tool error with code `NO_PROJECT_BOUND` and perform no change; per-agent availability SHALL be implemented by the per-agent `tools.allow` list that the server writes into the Gateway configuration (`platform-skeleton.Gateway run profile`) and, independently of it, by the tool endpoint refusing a call from a session whose agent is outside the tool's class (`SCOPE_DENIED` with `details.reason` `agent_class`; `security-privacy.Agent classes`); and `createdBy` of a job started by a tool SHALL be `{ kind: "agent", id: sessionId }` with the initiating `deviceId` of the run recorded beside it. Provider registration is owned by `generation-providers.Provider adapter contract`: generation providers run inside the server and implement the adapter contract of `packages/provider-kit`, and JAgentChill registers no provider with the Gateway. LLM runtimes and models are OpenClaw's own, served by its bundled provider plugins that `plugins.allow` enables. The server defines no vendor of its own: media, speech and stock capabilities come from the shared endpoint record and presets of `agent-runtimes.Shared endpoint record`, called by the server's endpoint client, and where a capability is served by one of OpenClaw's bundled provider plugins the server reaches it through a Gateway method listed in `CORE_METHODS`. [NEW]

#### Scenario: Tool name convention
- **WHEN** the contract test lists the tools of the agent tool endpoint with MCP `tools/list` and the Gateway's view of them with `tools.catalog`
- **THEN** every tool name matches `^jc_[a-z]+(_[a-z0-9]+)+$`, is at most 48 characters, appears in the catalogue index, and is shown by the Gateway under the same base name behind the runtime's prefix

#### Scenario: Tool called without a bound project
- **WHEN** an agent session that is not bound to a project calls `jc_clip_split`
- **THEN** the tool result is an error with code `NO_PROJECT_BOUND` and no project is modified

#### Scenario: Creative agent does not see workspace tools
- **WHEN** the effective tools of a creative agent are listed, and a creative-class session calls `jc_terminal_create` all the same
- **THEN** no terminal, exec or file tool outside `jc_workspace_*` is present in the list, and the call is refused by the tool endpoint with `SCOPE_DENIED` and `details.reason` `agent_class`

#### Scenario: Job started by a tool
- **WHEN** `jc_generate_image` enqueues a job in a turn started by device D
- **THEN** the job's `createdBy` is `{ kind: "agent", id: <sessionId> }` and its record carries device D

### Requirement: Agent tool endpoint and session binding
The server SHALL serve JAgentChill's agent tools to the Gateway as a Model Context Protocol server over Streamable HTTP at `/agent-tools/mcp` on its loopback listener, and SHALL register it by writing `mcp.servers.jagentchill` `{ url: "http://127.0.0.1:<server.port>/agent-tools/mcp", transport: "streamable-http", headers: { Authorization: "Bearer <tool endpoint secret>" } }` into the Gateway configuration before the Gateway starts; that entry is the only thing of JAgentChill the Gateway is configured with (where spike S8 shows a harness needs it, the same entry carries that harness's projection sub-key, such as `mcp.servers.jagentchill.codex` for Codex threads, `agent-runtimes.Published capability matrix`; it names the same URL and secret and no other server). The endpoint SHALL serve a request only when (a) it arrived on the loopback listener with no forwarded-for attribution, (b) its `Host` header is `127.0.0.1:<server.port>` or `localhost:<server.port>`, (c) it carries no `Origin` header, so that no browser page can use it, and (d) its bearer value equals the tool endpoint secret of `server-api.Gateway secrets`, compared in constant time; a request failing (a), (b) or (c) receives HTTP 404 and one failing (d) HTTP 401, both with an empty body and at most 1 audit record per minute. The path is outside `/jagentchill/`, so no product listener forwards it (`server-api.Native Gateway port isolation`). Request bodies are limited to 1 048 576 bytes; at most 256 MCP sessions are open — every agent session holds one, so the bound is above what `chat-agent.Concurrent session limits` and `multi-agent-orchestration.Tree limits` allow to run at once —, one idle for 600 000 ms is closed, and when the bound is reached the longest-idle session with no call in flight is closed to admit the new one; an agent session whose MCP session the server closed opens a new one and is bound again by its next reported call (the re-initialisation by the Gateway's MCP client is part of spike S23). **Session binding.** The Gateway's MCP client sends no session identity, and nothing the model says SHALL take part in identifying the caller: no `jc_*` tool has a session, handle, device or other caller-identity parameter, and no value is placed in a session's context for that purpose (context injected through the Gateway does not reliably reach the model). Binding is event-based. Every agent session holds its own MCP connection to the endpoint, and the Gateway reports every tool call on the server's link as an `agent` event with `stream: "item"`, `kind: "tool"`, a `phase` (`start`, `end`), a `toolCallId`, the tool `name` and the `sessionKey`. The server SHALL keep the reported calls of `jc_*` tools (base name after removal of the runtime's prefix) that have started and not ended, for at most 120 000 ms each, and for each incoming MCP tool call SHALL, in order and before any effect: (1) **bind** — when the MCP connection is not yet bound, find the reported, unclaimed calls of that tool whose sessions are not bound to another connection: exactly one session → the connection is bound to it for its lifetime; none within 3 000 ms → tool error `SESSION_UNBOUND` with `details.reason` `no_session`; more than one session → `SESSION_UNBOUND` with `details.reason` `ambiguous` (both `retryable: true`; the agent's retry is a new reported call, which usually resolves the ambiguity); (2) **admit** — a call on a bound connection is served only when a reported, unclaimed call of that tool exists for the bound session, which it then claims (one reported call admits one MCP call, and its `toolCallId` is recorded with the call); a call the Gateway did not report within 3 000 ms is not served and answers `SESSION_UNBOUND` with `no_session`; (3) check that the bound session has a live server record whose owner is not revoked — a session the server does not know (created with the host's `openclaw` command) is never served and answers `SESSION_UNBOUND` with `no_session`, and a session whose owner is revoked answers `SCOPE_DENIED`; (4) apply, from the session and run records, the checks a pre-tool hook would have applied — agent class, permission mode, ownership, role and team shape (`multi-agent-orchestration`), rate limits (`agent-editing-tools.Rate guard`), budgets (an exhausted hard-stop budget refuses the call with `BUDGET_EXCEEDED`, `usage-tracking.Budgets hook`), approvals (`server-api.Approval and question resolution`) and `server-api.Run initiator attribution and host-execution gating`; (5) only then run the tool. A binding is forgotten when its MCP connection closes; a session key is bound to at most one connection at a time. Streamable HTTP gives the server no reliable signal that the Gateway's side of a connection is gone, so two rules keep a stale binding from locking a session out of its tools: (i) when the gateway link is lost or the Gateway child exits, the server SHALL close every MCP session of the endpoint and discard every binding and every reported call — the Gateway that held those connections is gone; (ii) when a call arrives on an unbound connection and the only reported, unclaimed call of that tool belongs to a session bound to another connection on which no call is in flight, the binding moves to the new connection, the older MCP session is closed by the server, and the move is logged with both connection ids (a runtime that starts a new process for a turn opens a new connection); a move is never made while the older connection has a call in flight, and such a call answers `SESSION_UNBOUND` with `ambiguous`. In both cases a call is still served only against a call the Gateway reported for that session; every `SESSION_UNBOUND` answer is logged with the tool and the candidate session keys, and more than 5 in 60 s raise one audit record. While the gateway link is down no call can be reported, and a tool call answers the tool error `GATEWAY_UNAVAILABLE`. Binding is gated per runtime by spike S23 (`diagnostics-quality.Gating spikes`), which passed on `claude-cli` and is open on the embedded runtime, Codex, Gemini and ACP targets: a runtime on which sessions do not hold their own MCP connection, or whose tool calls are not reported in time, is not offered for `jc_*` tools (its snapshot reports `runtime/relay-unsupported` for creative-class sessions, `agent-runtimes.Error mapping`). [NEW]

#### Scenario: Gateway discovers the tools
- **WHEN** the gateway contract suite runs `openclaw mcp probe jagentchill --json` against the supervised Gateway
- **THEN** the answer lists every tool of the catalogue, each by its base name `jc_<name>` behind the runtime's prefix, and reports no diagnostic

#### Scenario: Wrong bearer value
- **WHEN** a process on the host posts an MCP `tools/call` to `/agent-tools/mcp` with a guessed bearer value
- **THEN** the response is HTTP 401 with an empty body and no tool runs

#### Scenario: Browser page on the host
- **WHEN** a web page open on the host sends a request with an `Origin` header to `http://127.0.0.1:18910/agent-tools/mcp`
- **THEN** the response is HTTP 404 and carries no CORS header

#### Scenario: Call the Gateway did not report
- **WHEN** a process on the host that holds the tool endpoint secret posts an MCP `tools/call` for `jc_clip_split` while no agent session has reported such a call
- **THEN** after 3 000 ms the tool result is an error with code `SESSION_UNBOUND` and `details.reason` `no_session`, and no project is modified

#### Scenario: Two sessions call the same tool at once
- **WHEN** sessions A and B each call the same `jc_*` tool at the same instant on connections that are both already bound, for two rounds
- **THEN** each of the 4 calls runs for the session of its own connection, and each job or change is attributed to the device that started that session's turn

#### Scenario: Ambiguous first call
- **WHEN** two sessions whose connections are not yet bound start a call of the same tool within the same moment
- **THEN** both calls answer `SESSION_UNBOUND` with `details.reason` `ambiguous` and nothing is done, and the retried calls bind each connection to its own session

#### Scenario: No caller identity in a tool schema
- **WHEN** the contract test reads the input schema of every tool listed by the endpoint
- **THEN** none has a parameter for a session, a handle, a device or a caller, and a call that supplies such a field is refused with `INVALID_PARAMS` like any other unknown property (`agent-editing-tools.Tool registration and manifest`), so that it can never be mistaken for an identity

#### Scenario: Gateway restart drops the bindings
- **WHEN** the Gateway child is restarted while 3 agent sessions hold bound MCP connections, and each session calls a `jc_*` tool in its next turn on a new connection
- **THEN** the 3 old MCP sessions were closed and their bindings discarded at the link loss, each new connection is bound to its own session by its first reported call, and no call answers `SESSION_UNBOUND`

#### Scenario: Runtime opens a new connection for a session
- **WHEN** a session whose older MCP connection is idle and still open calls a `jc_*` tool on a new connection, and the Gateway reports that call
- **THEN** the binding moves to the new connection, the older MCP session is closed, the call is served for that session, and the log names both connection ids

#### Scenario: Runtime on which binding fails
- **WHEN** the S23 record of a runtime says its sessions share one MCP connection or its tool calls are reported after the call
- **THEN** that runtime is not offered for sessions that use `jc_*` tools, and its snapshot says so with `runtime/relay-unsupported`

### Requirement: Feature flag registry
The `ready` frame SHALL carry `features`, a map from flag name to boolean, and the registry of flag names SHALL be the protocol package constant `FEATURE_FLAGS`, equal to this closed list:

| Flag | True when |
|---|---|
| `remote-render` | the render host probe passed (`server-api.Render host supervision and health`) |
| `remote-export` | `remote-render` is true and FFmpeg is present (codec availability is the codec table of `server-api.Host encoder policy and codec table`, not a flag) |
| `host-analysis` | FFmpeg is available, the host analysis models of `ai-editing-tools.Model manifest` are installed, and the host inference runtime loaded and passed its 1-second self-test at start (`ai-editing-tools.Inference runtime`); `ai.analysis` jobs run in a supervised child process of the server, so a model crash fails the job and not the server, and accept the tool ids and parameters of `ai-editing-tools.AI RPC surface` (among them `cutout.image` and `cutout.video` with `params.mode` `click` or `custom` and `params.attach: false`, and `smart-search` with `params.query`) |
| `share-links` | `http.shareLinks.enabled` is true |
| `webhooks` | `http.webhooks.enabled` is true |
| `push` | `push.enabled` is true and the push row of `security-privacy.Network egress control` is enabled |
| `connectors` | `connectors.enabled` is true |
| `multi-agent` | the multi-agent store and the tool endpoint checks are active |
| `terminal` | `terminal.enabled` is true and a terminal backend is available |
| `workflows` | the workflow scheduler service is running |
| `scripts` | the script store is available |

A change of a flag while connections are open SHALL be announced with `jagentchill.settings.host.changed` carrying the new `features`. A method whose feature is false SHALL answer `UNSUPPORTED_FEATURE` with `details.feature` (terminal methods answer `terminal/disabled`). How clients gate on flags and how the list evolves is defined by `updates-distribution.Feature flags and additive wire evolution`. [NEW]

#### Scenario: Flags in the ready frame
- **WHEN** a device completes the handshake on a server started by the desktop app with default configuration
- **THEN** `features` contains exactly the 11 flags above, with `terminal`, `share-links`, `webhooks`, `push` and `connectors` false

#### Scenario: Flag turns on at runtime
- **WHEN** an admin enables the terminal
- **THEN** connected clients receive `jagentchill.settings.host.changed` with `features.terminal` true within 1 second

#### Scenario: Method behind a false flag
- **WHEN** a client calls `jagentchill.connector.list` while `connectors` is false
- **THEN** the response error code is `UNSUPPORTED_FEATURE` with `details.feature` `connectors`

### Requirement: Narrow admin proxies
No device ever holds an OpenClaw scope of any kind (`device-pairing-signing.Device roles and scopes`). Every core capability that needs the core's administrator scope SHALL be reachable only through a server method on channel P marked `adminProxy: true`, which (1) is narrow — one purpose, typed parameters validated with the shared schemas, never a method name, scope or raw configuration path taken from client input; (2) checks the calling device's record, role and JAgentChill scope in the handler (and, for a method that names a session, `server-api.Session ownership and visibility`); (3) only then calls the core through `server-api.Gateway calls over the link`; (4) writes a `security` audit record for every state change; and (5) is rate limited to 30 mutating calls per device per minute. The proxy families and their owners are: `jagentchill.provider.auth.*`, `.provider.endpoint.*`, `.provider.preset.*`, `.provider.override.*`, `.provider.routing.*`, `.provider.pin.*`, `jagentchill.runtime.*` and `jagentchill.session.unattended.set` (`agent-runtimes.Admin proxy and Gateway reuse`); `jagentchill.terminal.*`, `jagentchill.fs.*`, `jagentchill.workspace.*` (`workspaces-terminal.OpenClaw reuse, channel P domains and spike gates`); `jagentchill.skill.*` (capability `skills`); agent, team and policy configuration under `jagentchill.agent.*` and `jagentchill.orc.*` (`multi-agent-orchestration.Agent RPC surface and events`); and the session methods the core reserves for its administrator (`sessions.rewind`, `sessions.compact`), reached through `server-api.Agent session relay`. Device removal, role change and token rotation are NOT proxies: they are operations on the server's own store with no core call. Whether the Gateway accepts each administrator method from the server's link, which holds `operator.admin`, is gated per method by spike S12; for a method on which S12 fails, the admin-proxy mutation SHALL answer `UNSUPPORTED_FEATURE` with `details.hostCommand` (the equivalent `jagentchill` or `openclaw` command, which the UI shows) unless its owning requirement names a server-built fallback, and read-only proxies keep working. While the gateway link is down every admin proxy that needs a core call answers `GATEWAY_UNAVAILABLE`. [NEW]

#### Scenario: Editor calls an admin proxy
- **WHEN** an `editor` device calls `jagentchill.provider.auth.setApiKey`
- **THEN** the response error code is `SCOPE_DENIED` and no core method is called

#### Scenario: No pass-through
- **WHEN** the contract test inspects every schema marked `adminProxy`
- **THEN** none has a parameter that names a core method, an OpenClaw scope or a free-form configuration path

#### Scenario: Audit of a proxied change
- **WHEN** an admin connects a provider through the proxy
- **THEN** a `security` audit record names the action, the provider id, the admin's device and the outcome, and contains no key material

#### Scenario: Administrator method refused on the link
- **WHEN** the S12 result of a method is `fail` and an admin calls the proxy mutation that needs it and has no server-built fallback
- **THEN** the response error code is `UNSUPPORTED_FEATURE` with `details.hostCommand`

#### Scenario: Mutation flood
- **WHEN** one admin device sends 31 mutating admin-proxy calls in a minute
- **THEN** the 31st receives `RATE_LIMITED` with `details.retryAfter_ms`

### Requirement: Connectors
The server SHALL own the registry of external-account connectors, which run on the Gateway with OAuth client credentials supplied by the operator (the product ships no client id or secret): `google-drive` and `dropbox` (import, consumed by capability `media-library`) and `youtube` and `tiktok` (publishing, consumed by capability `export-share`). The methods SHALL be `jagentchill.connector.list` (scope `jagentchill.config.read`; per connector `{ connectorId, kind: "import" | "publish", configured, connected, accountLabel?, clientIdSet, grantedScopes[] }` and never a client secret or token), `jagentchill.connector.configure { connectorId, clientId, secretNames[] }`, `jagentchill.connector.connect.begin { connectorId }` → `{ authorizeUrl, state, expires_ms }`, `jagentchill.connector.disconnect` (all three scope `jagentchill.config.write`), `jagentchill.connector.status` (scope `jagentchill.config.read`), `jagentchill.connector.browse { connectorId, folderId?, query?, cursor? }` and `jagentchill.connector.import { connectorId, fileIds[] (1 to 100), idempotencyKey }` (both scope `jagentchill.media.write`; behaviour owned by `media-library.Cloud drive connectors`), and `jagentchill.connector.publish { connectorId, source, fields, idempotencyKey }` (scope `jagentchill.export.run`; fields and behaviour owned by `export-share.Publishing connectors`). Client id and secret are entered on the page of `settings-preferences.Host connectors settings`. The authorization-code flow SHALL use PKCE (S256) and a single-use random `state` of 32 bytes valid for 600 000 ms; the provider redirects to `GET /jagentchill/v1/connectors/{connectorId}/callback`, whose redirect URI SHALL be a loopback URL of the host or an HTTPS origin of one of its product listeners (the callback path is under `/jagentchill/`, so the listeners forward it); the callback exchanges the code on the Gateway, stores access and refresh tokens as secrets (`CONNECTOR_<ID>_ACCESS_TOKEN`, `CONNECTOR_<ID>_REFRESH_TOKEN`), and answers with a static page "You can close this window". Tokens SHALL never be sent to a client. `connect.begin` returns the authorize URL only to the calling device, which opens it in the system browser on desktop, an in-app browser tab on iOS and Android and a new tab on web; on a headless host reached only from a phone the redirect lands on the listener origin, so no browser on the host is needed. Imports and publications run as jobs of kind `connector.transfer`, one per file. Connector hosts are rows of `security-privacy.Network egress control`, and every connector method answers `UNSUPPORTED_FEATURE` while the feature `connectors` is false. [NEW]

#### Scenario: Connect a storage account
- **WHEN** an admin configures `google-drive` with a client id and a stored client secret, begins the flow and completes consent in a browser
- **THEN** `jagentchill.connector.status` reports `connected: true` with the account label, and no response or event contains a token

#### Scenario: Replayed callback
- **WHEN** the callback URL of a completed flow is requested a second time
- **THEN** the response is HTTP 400 and no token is changed

#### Scenario: Expired state
- **WHEN** the provider redirects 11 minutes after `connect.begin`
- **THEN** the callback answers HTTP 400 with a page that says the request expired, and the connector stays disconnected

#### Scenario: Connectors disabled
- **WHEN** `connectors.enabled` is false and a client calls `jagentchill.connector.connect.begin`
- **THEN** the response error code is `UNSUPPORTED_FEATURE`

### Requirement: OpenClaw surface dependencies and fallbacks
Every behaviour of this capability that rests on an OpenClaw surface SHALL either be asserted by the gateway contract suite of `server-api.Gateway link` (surfaces already proven by execution, `docs/decisions/0002-own-server-gateway-sidecar.md`) or name its gating spike of `diagnostics-quality.Gating spikes` and its fallback, as follows; the result of each spike SHALL be compiled into the server as a constant read by the code paths below:

| Surface | Proof or spike | When it fails |
|---|---|---|
| Supervising the pristine Gateway as a child (own state directory, server-generated token in the configuration file, loopback bind, readiness by `hello-ok`, clean stop) | proven; gateway contract suite | the suite fails and the OpenClaw pin is not raised |
| Exit code 78 with the one doctor run, and the `shutdown` event with `restartExpectedMs` before close code 1012 | taken from `docs/gateway/embedding.md` of the pinned tag and not yet observed in a run; gateway contract suite | the suite fails and the OpenClaw pin is not raised; an exit code 78 the doctor does not repair ends in `config_invalid`, and an unannounced close is handled as an unexpected exit |
| Gateway link: `@openclaw/gateway-client`, protocol 4, token plus the server's link identity, scopes `operator.read`, `operator.write`, `operator.admin`, `operator.approvals`, no manual pairing step | proven; gateway contract suite | the suite fails and the OpenClaw pin is not raised |
| MCP discovery of the agent tool endpoint through `mcp.servers.jagentchill`, a real agent turn started by the server (`sessions.create`, `chat.send`) that calls a server tool, and changing the Gateway configuration at run time (`config.get`, then `config.patch { raw, baseHash }`) | proven; gateway contract suite | the suite fails and the OpenClaw pin is not raised |
| Session binding of agent tools, per runtime: each agent session holds its own MCP connection, and the Gateway reports each of its tool calls on the link (`agent` event, `stream: "item"`, `kind: "tool"`, `phase`, with `sessionKey`, `toolCallId`, `name`) in time for the server to bind the connection and admit the call | S23 (passed on `claude-cli`; open on the embedded runtime, Codex, Gemini and ACP targets) | a runtime on which binding fails is not offered for `jc_*` tools (`server-api.Agent tool endpoint and session binding`) |
| Methods that need the Gateway's administrator scope, called over the link, per method | S12 | `server-api.Narrow admin proxies` fallback |
| Approvals of host commands over the link: the three approval capabilities on `connect`, the policy `security: "allowlist"`, `ask: "on-miss"`, `askFallback: "deny"` written with `config.patch` and `exec.approvals.set`, the `plugin.approval.requested` event with `sessionKey`, `toolCallId` and `allowedDecisions`, and `approval.resolve { id, kind, decision }` with `allow-once` and `deny` | proven on `claude-cli` (decision 0002 rows 15 and 16); gateway contract suite. Every other runtime, and the `exec.approval.*` kind: S21 | the suite fails and the OpenClaw pin is not raised; a runtime that fails S21 is not offered |
| `permissionMode` on `sessions.create`: a session without one runs host commands unasked; `read-only` refuses them; `guarded` asks under the policy above | proven on `claude-cli` (decision 0002 row 13); gateway contract suite. `workspace` and `full`, and every mode on every other runtime: S8 | a mode whose measured effect is weaker than `agent-runtimes.Runtime modes catalogue` states is published `supported: false` for that runtime and is not selectable |
| Ending the Gateway as a process group (`SIGTERM`, `SIGKILL` of the group after 8 000 ms) and reaping a left-over group by the pid file at the next start | proven on macOS (decision 0002 row 14); gateway contract suite on macOS, Windows and Linux | on a host operating system where the suite fails the server is not released for that system |
| Protected paths against native file tools: `tools.fs.workspaceOnly`, and for a CLI or ACP runtime its own read and write tools, keep a session in a non-unattended mode from reading `<dataDir>/secrets/` and `<dataDir>/gateway-state/` | S21 (per runtime) | the runtime is offered for workspace-class sessions only to `admin` owners, with the statement of `security-privacy.Workspace agent safeguards` in its creation dialog |
| The server's own PTY worker on each host operating system | S15 | on a host system where it fails the feature `terminal` is not advertised (`workspaces-terminal.Terminal backend and worker process`); OpenClaw's `terminal.*` is never an alternative |
| Product listeners: path restriction and peer attribution in front of the server; tailnet node inside the helper | S20 (Gateway part) | no automatic fallback; record `awaiting-owner`; until the owner decides, the failing listener is not offered and the level is hidden with the reason (`server-api.Product listeners and path restriction`, `server-api.Tailnet ingress bridge`) |
| Relaying agent session events and approvals over the link with full fidelity (text deltas, tool events, usage, approvals, questions, run attribution, denial and abort of tool calls), per runtime | S21 | that runtime is not offered (`runtime/relay-unsupported`); degraded items are published in the capability matrix (`server-api.Agent session relay`) |

S1 (a device connecting to the native socket with a bootstrap token) is withdrawn: no device connects to the native socket. S2, S3, S4 and S5 (in-process core calls, WebSocket upgrade on a plugin route, bundled-plugin metadata, loading an external plugin) are withdrawn together with the plugin architecture — JAgentChill is not a plugin of OpenClaw — and no constant, route or fallback exists for them. Spikes S18 (workflow report-back into a busy chat session, `agent-workflows.Workflow started from a chat session`), S19 (the workflow canvas renderer, capability `workflow-diagram`) and the client part of S20 (`device-pairing-signing.Embedded tailnet node on mobile`) gate other capabilities and add no surface here. No fallback SHALL require an edit to any file of `gateway/openclaw/`. `packages/protocol` SHALL NOT differ between spike outcomes. [NEW]

#### Scenario: Spike constants are recorded
- **WHEN** the contract suite reads the server's compiled spike results
- **THEN** each of S12 (per method), S15, S20, S21 (per runtime) and S23 (per runtime) has value `pass` or `fail`, no constant exists for S1 to S5, and a matching decision record exists under `docs/decisions/`

#### Scenario: Fallback without Gateway edits
- **WHEN** the server is built with S12 set to `fail` and S23 set to `fail` for one CLI runtime
- **THEN** the upstream guard of `platform-skeleton.Read-only upstream guard` passes, the pairing conformance suite passes on both transports, that runtime is not offered for `jc_*` tools, and a chat turn on a runtime that passed S23 completes with its tool calls bound to its session

#### Scenario: Gateway unavailable
- **WHEN** the supervised Gateway is in a crash loop
- **THEN** health lists `core_call_unavailable` and `gateway_crash_loop`, chat shows "Agents are unavailable on this host" with the doctor finding, and project sync and export still work

#### Scenario: Pin raised without passing the suite
- **WHEN** `gateway/OPENCLAW_VERSION` is changed and a method of `CORE_METHODS` no longer exists on the new tag
- **THEN** the gateway contract suite fails and names the method, and the merge is blocked
