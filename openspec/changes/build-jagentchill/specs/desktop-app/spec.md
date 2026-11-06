## ADDED Requirements

### Requirement: Electron shell and renderer loading
The desktop app SHALL be an Electron application in `apps/desktop` for macOS (arm64 and x64), Windows (x64 and arm64) and Linux (x64 and arm64). It replaces classic's stub desktop window with a complete shell. The renderer SHALL be the web export of `apps/app` built with the Electron platform flag, bundled inside the app package and served to the window through the custom privileged scheme `app://jagentchill/` (registered as standard, secure, with fetch and stream support); the renderer's origin is exactly `app://jagentchill`, which is the origin the Gateway's CORS allow-list names (`server-api.HTTP request limits and browser access`). The app SHALL never load its UI from a remote URL or from `file://`. The renderer detects the shell through the preload-exposed bridge and uses `.electron` platform files for desktop-only behaviour. The main window SHALL be shown within 3 s of process start on the reference desktop of `diagnostics-quality.Performance budgets`, SHALL show the UI before the Gateway is ready, and SHALL have the editor, renderer (WebGPU with WebGL2 fallback) and WebCodecs behaviour of the web build. The same executable has a second mode, `--render-host`, defined by `desktop-app.Render host process mode` and `render-engine.Render host`. [PORT D-001] [JAD] [NEW]

#### Scenario: First window
- **WHEN** the user launches the installed app
- **THEN** one main window opens showing the JAgentChill shell loaded from `app://jagentchill/`
- **AND** the editor is usable for local projects while the Gateway is still starting

#### Scenario: Window within three seconds
- **WHEN** the app is launched cold on the reference desktop
- **THEN** the main window is visible within 3 s of process start

#### Scenario: No remote UI
- **WHEN** the network is disconnected at launch
- **THEN** the UI loads fully from the bundle

#### Scenario: Unknown path in the app scheme
- **WHEN** the renderer requests `app://jagentchill/../../etc/passwd` or any path that resolves outside the bundled export
- **THEN** the scheme handler returns 404 and reads nothing outside the bundle directory

### Requirement: Renderer security configuration
Every `BrowserWindow`, including the hidden window of the render-host mode, SHALL be created with `contextIsolation: true`, `nodeIntegration: false`, `nodeIntegrationInWorker: false`, `nodeIntegrationInSubFrames: false`, `sandbox: true`, `webSecurity: true`, `allowRunningInsecureContent: false`, `webviewTag: false` and no `enableRemoteModule`. Electron fuses SHALL be set at packaging time so that `RunAsNode`, `EnableNodeOptionsEnvironmentVariable` and `EnableNodeCliInspectArguments` are disabled and `OnlyLoadAppFromAsar`, `EnableEmbeddedAsarIntegrityValidation` and `EnableCookieEncryption` are enabled. The embedded-ASAR integrity fuse is enforced by Electron on macOS and Windows only; on Linux the fuse is set but has no effect, and the integrity control is the package signature and update-file checksum of `updates-distribution.Desktop code signing and notarisation` (signed `.deb`/`.rpm` repositories and the signed AppImage update manifest) plus a startup check in which the main process compares the SHA-256 of `app.asar` with the value compiled into the executable and refuses to start ("The installation is damaged — reinstall JAgentChill") on a mismatch, so that the three desktop systems each have an integrity control. Because `RunAsNode` is disabled, the Gateway is never run with the Electron executable (`desktop-app.Gateway process supervision`). [JAD] [NEW]

#### Scenario: Window flags
- **WHEN** the test harness inspects the web preferences of every window the app creates
- **THEN** each has the flag values listed above

#### Scenario: Packaged fuses
- **WHEN** the release pipeline reads the fuses of the packaged executable on each OS
- **THEN** `RunAsNode`, `EnableNodeOptionsEnvironmentVariable` and `EnableNodeCliInspectArguments` read disabled and `OnlyLoadAppFromAsar`, `EnableEmbeddedAsarIntegrityValidation` and `EnableCookieEncryption` read enabled, or the release fails

#### Scenario: Modified archive on Linux
- **WHEN** `app.asar` of an installed Linux package is modified and the app is started
- **THEN** the startup checksum comparison fails and the app shows "The installation is damaged — reinstall JAgentChill" without loading the archive

#### Scenario: Run-as-node is refused
- **WHEN** the packaged executable is started with `ELECTRON_RUN_AS_NODE=1` and a script path
- **THEN** it does not execute the script as Node

### Requirement: Renderer content security policy and navigation
The app SHALL apply to `app://` responses the single Content-Security-Policy defined by `security-privacy.Desktop and embedded web hardening`; this capability implements it and defines no policy text of its own. The main process sets `connect-src` dynamically to exactly: `app:`, `blob:`, `data:`, the privileged schemes `jagentchill-gw:` and `jagentchill-file:`, the loopback address of the built-in host's server (never the Gateway port), the addresses of paired hosts, and the hosts of the "External hosts" table of `security-privacy.Network egress control` that are enabled on this device; it is recomputed within 1 s when a host is paired or forgotten or an egress switch changes. Navigation of a window to any origin other than `app://jagentchill` SHALL be cancelled; `window.open` and link activations to `https:` and `mailto:` URLs open in the system browser after URL validation, and every other scheme is refused and logged at warning level. [JAD] [NEW]

#### Scenario: Navigation attempt
- **WHEN** renderer code sets `location.href` to `https://example.com`
- **THEN** the navigation is cancelled and the window stays on `app://jagentchill`

#### Scenario: Blocked connection
- **WHEN** renderer code calls `fetch("https://example.com/x")` and that host is not in the enabled egress table
- **THEN** the request is blocked by `connect-src` and a CSP violation is logged

#### Scenario: Newly paired host
- **WHEN** the device pairs with a host at a tailnet address
- **THEN** connections from the renderer to that address succeed within 1 s of pairing, without a reload

#### Scenario: External link
- **WHEN** the user activates an `https:` link in the release notes
- **THEN** it opens in the system browser and no new app window is created

#### Scenario: Refused scheme
- **WHEN** content attempts to open a `file:` or `javascript:` URL
- **THEN** nothing opens and the attempt is logged at warning level

### Requirement: Renderer permissions and developer tools
Permission requests from the renderer SHALL be denied by default and granted only for `media` (camera and microphone, after the OS prompt), `clipboard-read`, `clipboard-sanitized-write`, `fullscreen`, `pointerLock`, `notifications` and `display-capture` (eyedropper and screen recording, user-initiated only). Developer tools SHALL be available only from the Help menu item "Toggle developer tools" (registry action `help.devtools`, reachable from the system menu bar on macOS and from the application menu button on Windows and Linux) and are disabled entirely when the app is launched with the enterprise policy flag `disableDevTools`. [JAD] [NEW]

#### Scenario: Denied permission
- **WHEN** the renderer requests the `geolocation` permission
- **THEN** the request is denied without a prompt

#### Scenario: Granted permission
- **WHEN** the user starts a voiceover recording for the first time
- **THEN** the OS microphone prompt is shown and, once allowed, the `media` request is granted

#### Scenario: Developer tools disabled by policy
- **WHEN** the app is launched with `disableDevTools`
- **THEN** "Toggle developer tools" is absent and the devtools keyboard combinations open nothing

### Requirement: Preload bridge and IPC allowlist
The preload script SHALL expose one frozen object `window.jagentchillDesktop` through `contextBridge` with a fixed, versioned set of methods grouped as: `app` (version, platform, paths for display, relaunch, quit); `window` (minimise, maximise, close, fullscreen, new window, state events, the window-control layout and measured inset of `desktop-app.Windows and window state`); `gateway` (status subscription, start, stop, restart, run doctor, open logs, get and set network access, restore this computer as admin); `tailnet` (the five methods of `desktop-app.Desktop tailnet proxy helper`); `library` (the project library operations of `desktop-app.Project library folder bridge`); `files` (open dialog, save dialog, reveal in file manager, read a user-chosen file as a stream, write an export stream to a user-chosen path, relink, create and revoke external-file grants); `device` (get public key and `keyProtection`; sign structured input of kind `handshake`, `request` or `key-rotation` with typed fields, as defined by `device-pairing-signing.Structured signing interface` — any other input is refused with `SIGN_REFUSED`; the private key never leaves the main process, per `device-pairing-signing.Per-platform device key storage`); `secureStore` (get, set, delete values through Electron `safeStorage`, or through the confirmed protected-file store of `desktop-app.Desktop secure storage and paths`); `notifications`; `updates`; `menu` (the menu model, enabled and checked state sync, and invocation of an item by id — used by the application menu button on Windows and Linux); and `deepLinks` (subscription). No generic `ipcRenderer`, `send`, `invoke`, `require`, `process` or Node object is exposed. The main process SHALL validate every IPC call: the sender frame's URL must be `app://jagentchill`, and arguments are parsed with Zod schemas from `packages/protocol`; a failed check rejects the call with a typed error and logs it. File access through the bridge is limited to the project library folder, the configured export folder, and paths the user selected in a native dialog, dropped onto the window or opened through a file association. [JAD] [NEW]

#### Scenario: Unknown channel
- **WHEN** renderer code attempts to call an IPC channel that is not in the allowlist
- **THEN** the call is rejected and no main-process handler runs

#### Scenario: Path outside granted locations
- **WHEN** the renderer asks the bridge to read `/etc/hosts` without the user having selected it
- **THEN** the call is rejected with a permission error

#### Scenario: Signing without key exposure
- **WHEN** the renderer requests a signature for a `handshake` input
- **THEN** it receives the signature and public key only, and the private key bytes are never present in renderer memory

#### Scenario: Free-form signing is refused
- **WHEN** the renderer asks the bridge to sign an arbitrary byte string
- **THEN** the call fails with `SIGN_REFUSED` and nothing is signed

### Requirement: Gateway process supervision
The desktop app SHALL run the built-in host by starting **JAgentChill Server** as a child process when the user enables "Run the built-in host on this computer" (default on after the welcome flow selects it), identically on macOS, Windows and Linux; it SHALL NOT start, configure, watch or stop the OpenClaw Gateway itself — the server supervises the Gateway as its own child (`server-api.Gateway supervision and lifecycle`), and the title of this requirement names the whole built-in host. The main process SHALL spawn the bundled server entry (`jagentchill serve --data-dir <dir> --port <port>`) with an argument array, using the real Node runtime (≥ 24.16) shipped inside the app resources — never Electron's own executable (`process.execPath`), under which OpenClaw's shell tooling misbehaves and which the server would hand on to the Gateway — with the environment variables `JAGENTCHILL_RENDER_HOST_PATH` set to the app's own executable path, `JAGENTCHILL_BOOTSTRAP_DEVICE_PUBLIC_KEY` set to this computer's device public key (`device-pairing-signing.Trust bootstrap for the first device`), `JAGENTCHILL_GATEWAY_PORT` and `JAGENTCHILL_OPENCLAW_ROOT` (the built Gateway inside the app resources), and with the data directory `<userData>/host/`. The four OpenClaw embedding switches (`OPENCLAW_SKIP_CHANNELS`, `OPENCLAW_NO_RESPAWN`, `OPENCLAW_DISABLE_BONJOUR`, `OPENCLAW_EXEC_SHELL_SNAPSHOT`), the Gateway token, the Gateway state directory, the Gateway bind and every key of the Gateway configuration are set by the server, not by the app (`platform-skeleton.Gateway run profile`); the desktop app writes nothing into the Gateway configuration and never learns the Gateway token. The built Gateway SHALL be installed intact in the app resources (not flattened or bundled into one file) and unmodified from the pinned OpenClaw tag. The app treats the server as a replaceable runtime: it talks to it only over channel P of `device-pairing-signing` (the WebSocket `/jagentchill/v1/ws` and the server's HTTP routes under `/jagentchill/v1/`), as a signed device with a JAgentChill role; it never opens OpenClaw's native WebSocket or the Gateway port, never calls the agent tool endpoint, holds no OpenClaw token or scope, and never reads or writes the server's database, its secrets or anything under the Gateway state directory. The single exception is the first-device bootstrap file `<dataDir>/bootstrap/<deviceId>.json` (owner-only), which the app reads once and deletes as described in `desktop-app.Gateway readiness detection`. The server's stdout and stderr are captured to a rotating log (10 MiB per file, 5 files) in the app's log directory; the Gateway's own output is logged by the server. The app's supervisor exposes a state machine to the renderer: `stopped`, `starting`, `ready`, `degraded`, `restarting`, `doctor`, `failed`, `stopping`; `failed` and `degraded` carry a machine-readable `reason`. The first five and `stopping` describe the server process and the app's channel P connection to it; the Gateway's own state (`starting`, `ready`, `restarting`, `config_invalid`, `crash_loop`, `stopped`) is read from `jagentchill.settings.host.get` and its change event and is mapped as follows: Gateway `ready` adds nothing; `starting` or `restarting` → `degraded` with reason `gateway_starting`, or `doctor` when the Gateway's last exit code was 78; `crash_loop` → `degraded` with reason `gateway_crash_loop`; `config_invalid` → `degraded` with reason `gateway_config_invalid`. While the Gateway is not ready the app stays connected, and the editor, sync, media and jobs that need no agent keep working.

The supervisor SHALL NOT spawn the server while this computer has no device key. When the OS secret store is unavailable and the user has not yet chosen the protected-file store (`desktop-app.Desktop secure storage and paths`), the state is `failed` with reason `key_storage_unavailable`, the welcome step and Personal ▸ Connections show the `KEY_STORAGE_UNAVAILABLE` dialog's three choices ("Try again", "Store the key in a protected file", "Cancel"), and the app works in local-only mode until one succeeds; after it succeeds the supervisor starts the server without a relaunch. [JAD] [NEW]

#### Scenario: Start
- **WHEN** the built-in host is enabled and the app launches
- **THEN** the supervisor state goes `stopped` → `starting`, exactly one child of the app runs the bundled Node with the server entry and the four `JAGENTCHILL_*` variables, and the Gateway process is a child of that server, not of the app

#### Scenario: Built-in host disabled
- **WHEN** the built-in host setting is off
- **THEN** neither a server nor a Gateway process is spawned and the app works in local-only mode or with remote hosts

#### Scenario: Channels are off
- **WHEN** the built-in host is ready
- **THEN** no messaging channel plugin of OpenClaw is running in its Gateway

#### Scenario: Server and Gateway stay on loopback
- **WHEN** the network access level is "Tailnet" or "Local network (encrypted)" and the listening sockets of the server and Gateway processes are listed
- **THEN** the server's own port and the Gateway port are bound to `127.0.0.1` only

#### Scenario: App does not touch host data
- **WHEN** the app runs for a full session with the built-in host
- **THEN** no file under `<userData>/host/` is opened by the Electron main or renderer process, other than the one bootstrap file read and deleted at the first start, and no connection from an Electron process to the Gateway port exists

#### Scenario: Electron is never the Node runtime of the host
- **WHEN** the command lines of the server process and of the Gateway process are inspected on macOS, Windows and Linux
- **THEN** both run the bundled Node executable and neither runs the Electron executable

#### Scenario: Gateway down while the server is up
- **WHEN** the server reports Gateway state `crash_loop`
- **THEN** the supervisor state is `degraded` with reason `gateway_crash_loop`, the connection chip stays "Connected", editing and sync keep working, and agent chat shows "Agents are unavailable on this host"

#### Scenario: No secret store on first run
- **WHEN** the welcome flow's "Start the built-in host on this computer" is chosen on a Linux session with no keyring, or on a Windows or macOS account whose secret store is unavailable
- **THEN** no server is spawned, the state is `failed` with reason `key_storage_unavailable`, the three choices are offered, and after the user confirms "Store the key in a protected file" the server starts and the state reaches `ready`

### Requirement: Gateway readiness detection
Readiness SHALL be established only by protocol, with the app's own device identity: the supervisor opens channel P (`GET /jagentchill/v1/ws`) to the server's chosen loopback port and completes the signed handshake of `device-pairing-signing.Reconnect handshake`; the built-in host is `ready` when channel P has reached its `ready` frame, which attests the host's identity key (`gatewayId`), and the server reports its Gateway `ready`. The app makes no OpenClaw `connect` and has no channel to the Gateway: whether the Gateway is ready is known only from the server (`jagentchill.settings.host.get`, health reason `core_call_unavailable`), which itself establishes it by protocol (`server-api.Gateway supervision and lifecycle`). Log output is never parsed for readiness. On the first run, before this desktop is a paired device, the supervisor performs the desktop-started path of `device-pairing-signing.Trust bootstrap for the first device`: the server, seeing `JAGENTCHILL_BOOTSTRAP_DEVICE_PUBLIC_KEY` and no admin record, registers this computer as `admin` with `localSupervisor: true` and writes the device token to `<dataDir>/bootstrap/<deviceId>.json`; the supervisor waits up to 30 s for that file, reads it once, stores the token through `desktop-app.Desktop secure storage and paths`, deletes the file (and treats a file it cannot delete as a failed start), and then connects on channel P as above. When the host already has device records and none is this computer's key, no bootstrap file appears; the state becomes `degraded` with the reason "This computer is not a device of its own host" and the action "Restore this computer as admin" of `desktop-app.Host status surface`. The built-in host is always reached over the `loopback` address kind, never through the tailnet proxy or the LAN listener. The supervisor retries the P connection every 250 ms for the first 5 s and every 1 s afterwards; if the channel P `ready` frame is not reached within 60 s of spawn the attempt counts as a failed start of the server, the child is stopped and the crash-restart policy applies; a Gateway that is not yet ready does not delay the `ready` frame and is shown through the mapping of `desktop-app.Gateway process supervision`. On `ready` the supervisor verifies that the server's `protocolVersion` is compatible with the app per `updates-distribution.Protocol version negotiation`; an incompatible version sets the state to `degraded` with the reason shown to the user. The server's `GET /jagentchill/v1/health` reporting `degraded`, or reporting `ok` with a non-empty `reasons` list (a missing FFmpeg or render host is reported that way, with reason `ffmpeg_missing` or `render_host_unavailable`, per `server-api.Health route`), also sets the supervisor state to `degraded` with the health reasons, and the app stays usable. The desktop app's connection to the built-in host is a signed device connection like any other; there is no unsigned loopback exception (`device-pairing-signing.Loopback connections are not exempt`). [JAD] [NEW]

#### Scenario: Ready by handshake
- **WHEN** channel P reaches `ready`
- **THEN** the connection chip shows "Connected", and the state becomes `ready` as soon as the server also reports its Gateway ready

#### Scenario: Handshake never completes
- **WHEN** channel P has not reached `ready` within 60 s of spawn
- **THEN** the attempt is recorded as a failed start and a restart is scheduled per the restart policy

#### Scenario: Degraded health
- **WHEN** channel P is up and the health route reports the reason `render_host_unavailable`
- **THEN** the supervisor state is `degraded`, the status surface names the reason and editing and agent chat keep working

#### Scenario: First run
- **WHEN** the app starts the built-in host for the first time on a new installation
- **THEN** the trust bootstrap completes without user interaction, the bootstrap file no longer exists and the state reaches `ready`

#### Scenario: Device key lost
- **WHEN** the built-in host has device records and none matches this computer's key
- **THEN** the state is `degraded`, no bootstrap file is read, and "Restore this computer as admin" is offered

### Requirement: First-run OpenH264 acceptance dialog
The desktop app SHALL offer the OpenH264 download of decision A4 once, during host setup and never at export time, identically on macOS, Windows and Linux. The first time the built-in host reaches `ready` on an installation, the app reads `jagentchill.settings.encoders.get`; when `h264.state` is `download_required` (no working hardware H.264 encoder and no OpenH264 library) it shows a modal dialog titled "H.264 export on this computer" with the body "This computer has no hardware H.264 encoder. JAgentChill can download the OpenH264 Video Codec provided by Cisco Systems, Inc. to export H.264 on this host. Without it, exports on this host use VP9 or AV1, which need no download." — the notice text and the link to Cisco's licence page as required by `server-api.Host encoder policy and codec table` — and the buttons "Download" (primary) and "Not now". "Download" calls `jagentchill.settings.encoders.install { encoder: "openh264", accept: true }` (role `admin`, which the built-in host's own computer holds) and shows a progress row; success closes the dialog with the toast "H.264 export is ready"; failure (including `egress_blocked` in offline mode) shows the reason with "Retry" and "Not now". "Not now" records the choice per installation so the dialog is not shown again automatically; it stays re-openable from Host ▸ Diagnostics ("Download OpenH264…") and from the encoder table of `settings-preferences.Host general settings`. When `h264.state` is already `available` the dialog is never shown. The dialog is not shown inside the welcome flow's own steps: it follows them. No export, proxy or automation ever opens this dialog or waits for it — a job whose codec is unavailable fails fast with `export/codec-unavailable` and its alternatives, as `export-share` defines. For a headless host the same acceptance is given by the host CLI command or `JAGENTCHILL_ACCEPT_OPENH264=1`, and the desktop app connected to such a host as a remote admin offers the same "Download OpenH264…" action in Host ▸ Diagnostics. [NEW]

#### Scenario: No hardware encoder on first run
- **WHEN** the built-in host reaches `ready` for the first time on a Linux computer with no hardware H.264 encoder
- **THEN** the dialog is shown with "Download" and "Not now", and after "Download" completes the encoder table reports `h264.state: "available"`

#### Scenario: Hardware encoder present
- **WHEN** the built-in host reaches `ready` for the first time on a Mac with VideoToolbox
- **THEN** no dialog is shown

#### Scenario: Declined
- **WHEN** the user chooses "Not now" and afterwards exports H.264 on the host
- **THEN** no dialog appears at export time, the job fails fast with `export/codec-unavailable` listing VP9 and AV1, and "Download OpenH264…" remains available in Host ▸ Diagnostics

#### Scenario: Same dialog on the three desktop systems
- **WHEN** the condition holds on macOS, Windows and Linux
- **THEN** the same dialog with the same text and buttons is shown on each

### Requirement: Gateway port selection
The supervisor SHALL choose two loopback ports for the built-in host and pass them to the server (`--port`, `JAGENTCHILL_GATEWAY_PORT`): the server's own port, which is the only port of the host any client uses, and the Gateway port, which only the server uses. Both are bound to `127.0.0.1` only, at every level of `desktop-app.Network access setting` — the first by the server, the second by the Gateway that the server starts. The server port is the port configured in Personal ▸ Connections ▸ Built-in host (default 18910); if it cannot be bound, the next free port in the range configured-port+1 … configured-port+20, probing in ascending order; the Gateway port is the next free port after the chosen server port in the same range; if the range does not hold two free ports, the state becomes `failed` with the message "No free port between <a> and <b>". The chosen ports are persisted and tried first at the next start. The supervisor never attaches to a server or Gateway process it did not spawn: a port in use is skipped even when a JAgentChill Server or an OpenClaw Gateway answers on it. The server port is shown on the Host ▸ General settings page and both ports in diagnostics. A change of these ports never affects other devices: they reach the host only through the product listeners (`server-api.Product listeners and path restriction`), whose own ports (`lan.port`, default 18790, and the tailnet listener's port) are server settings shown on the Network access card; when the configured `lan.port` is busy the LAN listener reports `failed` with the port named and the card offers "Change port". [NEW]

#### Scenario: Default port busy
- **WHEN** port 18910 is in use by another program
- **THEN** the server starts on 18911, the Gateway on the next free port after it, and those ports are used first at the next launch

#### Scenario: Range exhausted
- **WHEN** fewer than 2 of the 21 ports in the range are free
- **THEN** the state is `failed`, the message names the range and Diagnostics offers "Change port"

#### Scenario: Foreign host on the port
- **WHEN** a JAgentChill Server or an OpenClaw Gateway not started by this app is already listening on a port of the range
- **THEN** the supervisor does not connect to it and selects the next free port

### Requirement: Network access setting
The desktop app SHALL provide the setting "Network access" for the built-in Gateway (design D2, D7.10; decisions A1, B2), shown in Personal ▸ Connections ▸ Built-in host (`settings-preferences.Connections and devices page`), with three levels that behave identically on macOS, Windows and Linux. At every level the server's own port and the Gateway's native port stay bound to `127.0.0.1`, and the Gateway port is used only by the server over its gateway link and by the host's own `openclaw` CLI; the levels only turn the two **product listeners** of `server-api.Product listeners and path restriction` on or off. Those listeners forward nothing but `/jagentchill/…` paths (channel P, the server's HTTP routes and the static web app) and forward them to the server only, so no level exposes the Gateway port, OpenClaw's native WebSocket, the Control UI, a route of an OpenClaw plugin or the server's agent tool endpoint to the tailnet or the LAN.

| Level | Product listeners | Reachable by other devices through | What the desktop app does |
|---|---|---|---|
| This computer only (default) | none | nothing; only clients on this computer connect, over loopback (the desktop app, and a browser on this computer at `http://127.0.0.1:<port>/jagentchill/app/`) | sets `tailnet.enabled: false` and `lan.enabled: false` |
| Tailnet | tailnet listener (`server-api.Tailnet ingress bridge`): an embedded tailnet node run by the server's ingress helper | addresses of kind `tailnet` — `ws` inside the tunnel for the native apps, and an `https`/`wss` address with the tailnet's browser-trusted `ts.net` certificate for browsers when the tailnet issues certificates | sets `tailnet.enabled: true`, which makes the server start the listener; `false` stops it |
| Local network (encrypted) | LAN listener: TLS 1.3 on `lan.port` (default 18790) on the private addresses of this computer's interfaces, never on a globally routable address | addresses of kind `lan`: `wss`/`https` with the listener's certificate, whose SHA-256 the pairing offer carries as `tlsSha256` and the native apps pin. **Browsers on other computers cannot use this level** unless an admin has installed a browser-trusted certificate for the host (Host ▸ Web access, `settings-preferences.Host web access settings`); the row says so | sets `lan.enabled: true`; `false` stops the listener |

The levels are cumulative choices of one select: "Tailnet" and "Local network (encrypted)" can also be on together through the two switches shown under the select when either is on ("Also allow the local network", "Also allow the tailnet"). The desktop app applies a level only by calling `jagentchill.settings.host.patch` on channel P with the keys `tailnet.enabled` and `lan.enabled`; it writes no bind address and no TLS key into the Gateway configuration, and **no level change restarts the server or the Gateway or interrupts a job**. The server — never the desktop app — starts, supervises and stops the ingress helper and owns the LAN certificate (generation, renewal when the address set changes, pin roll-over to paired devices), so multi-homed computers, address changes by DHCP and IPv6 unique-local addresses are handled there; the card lists the addresses and port from `jagentchill.settings.lan.get` and refreshes them on the host-settings change event. Both levels SHALL be selectable on every desktop OS whether or not the operating system's Tailscale client is installed or running, because the tailnet node is embedded in the helper; no tailnet interface of the computer is detected, required or used. There is no unencrypted LAN mode: the product has no plaintext-LAN switch or configuration key.

While "Tailnet" is selected the card SHALL show the listener state from `jagentchill.settings.tailnet.get`, refreshed on the host-settings change event and at least every 5 s while the card is visible: `needs-login` ("Sign in to Tailscale" button), `starting` (spinner), `ready` (the tailnet name, the node's DNS name with a copy button, the key expiry date, and the `https` name when present), `expired` ("Tailnet sign-in expired" with "Sign in again"), `failed` (the error text with "Retry"). "Sign in to Tailscale" opens a sign-in window with the two methods of `device-pairing-signing.Tailnet login step`: **interactive** — the app calls `jagentchill.settings.tailnet.login { mode: "interactive" }`, opens the returned login URL in the system browser, shows the same URL as a QR code and a copyable link, and polls the state once per second until `ready` or a 10-minute timeout; **auth key** — a masked field whose value the app writes as a host secret through `PUT /jagentchill/v1/secrets/{name}` and then passes by name in `jagentchill.settings.tailnet.login { mode: "authKey", secretName }` (the server deletes that secret after use; the key is never stored by the app, logged or shown again). "Sign out of Tailscale" (confirmation stating how many paired devices reach this host only over the tailnet) calls `jagentchill.settings.tailnet.logout`. While "Local network (encrypted)" is selected the card shows the LAN listener state (`starting`, `ready` with its addresses, port and certificate fingerprint and kind — self-signed or installed — or `failed` with the error and "Retry"). When the server refuses to start a listener because the run profile is violated, the card shows the refusal reason and "Run repair".

Changing the level SHALL show a confirmation naming the addresses that will be reachable and, when lowering the level, the number of paired devices that will lose access; it requires role `admin` on the built-in host. No public funnel or router port is opened and nothing listens on a globally routable address. Pairing a phone or another computer requires a level other than "This computer only": the pairing screen and the "Pair your phone" promo lead to this setting ("Open Network access"), and `device-pairing-signing.Offer addresses and reachability` builds offer addresses from the listeners that are `ready` — a `tailnet` address only once the tailnet listener is `ready`, a `lan` address only once the LAN listener is `ready`. At "This computer only" the pairing sheet still works for a browser on this computer: it shows the heading "Pair a browser on this computer", the link and the short code (no QR), followed by "To pair a phone or another computer, open Network access" (decision B2). After enabling a listener the app verifies through `jagentchill.settings.lan.get` / `jagentchill.settings.tailnet.get` that it reached `ready` within 30 s; otherwise the level select returns to the previous value and the failure is reported with the listener's error. Every change of level, sign-in and sign-out is recorded in the host audit log with actor, old level and new level. [JAD] [NEW]

#### Scenario: Default level
- **WHEN** the built-in host starts on a new installation
- **THEN** the Gateway listens on `127.0.0.1` only, no product listener is running and a pairing offer contains only a `loopback` address, shown as link and short code without a QR code

#### Scenario: Enable tailnet access without Tailscale installed
- **WHEN** the admin selects "Tailnet" on a computer that has no Tailscale client installed and confirms
- **THEN** the Gateway is not restarted, the card shows "Sign in to Tailscale", and after the interactive sign-in completes the listener state is `ready` with its DNS name

#### Scenario: Offer after the listener is ready
- **WHEN** the level is "Tailnet" and the tailnet listener is `ready`
- **THEN** a pairing offer contains an address of kind `tailnet`, the native Gateway port still listens on `127.0.0.1` only, and the audit log records the level change and the sign-in

#### Scenario: Listener not signed in
- **WHEN** the level is "Tailnet" and the listener state is `needs-login`
- **THEN** the pairing screen shows the state with "Sign in to Tailscale" instead of a QR code

#### Scenario: Auth key sign-in
- **WHEN** the admin pastes a Tailscale auth key and confirms
- **THEN** the listener reaches `ready`, the temporary secret no longer exists on Host ▸ Secrets, and the key appears in no log

#### Scenario: Same behaviour on the three desktop systems
- **WHEN** each level is enabled on macOS, on Windows and on Linux
- **THEN** each reaches `ready` through the same steps and shows the same states and labels

#### Scenario: Encrypted local network without a restart
- **WHEN** the admin selects "Local network (encrypted)" and confirms while an export job runs on the host
- **THEN** the Gateway is not restarted, the job continues, the LAN listener reaches `ready`, and the pairing offer carries a `wss` address of kind `lan` with the certificate's `tlsSha256`

#### Scenario: Only product paths are reachable from the LAN
- **WHEN** another computer on the LAN requests `/` or OpenClaw's native WebSocket path on the LAN listener's port
- **THEN** the answer is HTTP 404 from the listener and nothing reaches the Gateway

#### Scenario: Browser on another computer
- **WHEN** the level is "Local network (encrypted)" with the self-signed certificate
- **THEN** the row states "Browsers on other computers cannot use this level" and links to Host ▸ Web access

#### Scenario: Lowering the level
- **WHEN** two phones are paired over the tailnet and the admin selects "This computer only"
- **THEN** the confirmation states that 2 devices will lose access, and after confirming the listener is stopped and the host is reachable on loopback only

#### Scenario: Listener fails to start
- **WHEN** the LAN listener does not reach `ready` within 30 s because `lan.port` is in use
- **THEN** the select returns to the previous level, the error names the port and "Change port" is offered

### Requirement: Desktop tailnet proxy helper
The desktop app SHALL host the tailnet proxy of `device-pairing-signing.Desktop tailnet proxy`, through which this computer reaches Gateways other than its own supervised one over a tailnet, identically on macOS, Windows and Linux. The proxy is the product's Go tailnet bridge built in client mode and shipped inside the app package as one signed helper executable per package: a universal binary (arm64 and x64) in the macOS package, and the binary of the package's architecture in the Windows (x64, arm64) and Linux (x64, arm64) packages, unpacked from the archive like the other executables. The Electron main process SHALL spawn it on demand with an argument array (never through a shell), keep its node state in `<userData>/tailnet-client/` (owner-only: mode `0700` on macOS and Linux, an access-control list restricted to the current user on Windows; excluded from the diagnostics bundle), and stop it 60 seconds after the last proxy closed. It SHALL be used whether or not the operating system's Tailscale client is installed or running, its node is distinct from the Gateway-side node of `server-api.Tailnet ingress bridge`, and the desktop's own supervised Gateway is always reached over `loopback` and never through it.

The main process SHALL offer the helper to the renderer only through the typed preload group `tailnet` (`desktop-app.Preload bridge and IPC allowlist`):

| Method | Result |
|---|---|
| `tailnet.getStatus()` | `{ state: "stopped" \| "needs-login" \| "starting" \| "running" \| "expired" \| "error", tailnetName?, nodeName?, keyExpiry_ms?, error? }` and a subscription to changes |
| `tailnet.startLogin({ mode: "interactive" \| "authKey", authKey? })` | `{ loginUrl? }`; an auth key is passed once to the helper over its control pipe and is never stored, logged or sent to a Gateway |
| `tailnet.logout()` | stops the node and deletes its state; pairings are kept |
| `tailnet.openProxy({ gatewayId })` | `{ proxyId }` and a message port that carries the frames of the channel P WebSocket to that host's selected `tailnet` address |
| `tailnet.closeProxy({ proxyId })` | closes that connection |

The loopback port on which the helper listens SHALL never be given to the renderer and SHALL NOT appear in the renderer's `connect-src`: WebSocket connections to a host whose selected address kind is `tailnet` are opened by the main process through the helper and bridged frame by frame to the renderer over the message port, and HTTP requests to such a host go through `desktop-app.Authenticated Gateway media scheme`. The helper SHALL listen on `127.0.0.1` on a random port and accept a connection only when its first bytes carry the per-launch random secret the main process gave it over its control pipe; any other connection is closed without a reply. `openProxy` SHALL be refused for a `gatewayId` that is not paired or whose selected address is not of kind `tailnet`. The handshake, pinning, device signature and tokens of `device-pairing-signing` apply unchanged on top of the proxied byte stream.

Sign-in, expiry and sign-out follow `device-pairing-signing.Tailnet login step`: the "Sign in to Tailscale" step of the pairing flow and "Sign in to Tailscale" / "Sign out of Tailscale" in Personal ▸ Connections open one sign-in window (interactive: the login URL opened in the system browser, shown as a QR code and copyable link, status polled once per second for up to 10 minutes; auth key: a masked field). A helper that exits unexpectedly is restarted after 1 s, 5 s and 30 s; after three failures within 5 minutes hosts reachable only over the tailnet show "Tailnet unavailable" with "Retry" and "Open logs", and hosts reachable over `loopback` or `lan` are unaffected. A missing or unverifiable helper executable SHALL be reported at startup as a non-blocking warning. [JAD] [NEW]

#### Scenario: Reach a remote host over the tailnet
- **WHEN** this computer is paired with a host whose only reachable address is of kind `tailnet` and the helper is `running`
- **THEN** channel P to that host is established through `tailnet.openProxy`, the connection chip reads "Connected" with the path "Tailnet", and the renderer's `connect-src` contains no loopback port of the helper

#### Scenario: No operating-system Tailscale client
- **WHEN** the computer has no Tailscale client installed and the user signs the app in to a tailnet
- **THEN** the helper reaches `running` and the remote host connects

#### Scenario: Foreign process on the loopback port
- **WHEN** another local process connects to the helper's loopback port without the per-launch secret
- **THEN** the connection is closed and nothing is forwarded to the tailnet

#### Scenario: Sign out keeps pairings
- **WHEN** the user chooses "Sign out of Tailscale"
- **THEN** the helper stops, `<userData>/tailnet-client/` is deleted, the host stays in the host list and shows "Tailnet sign-in required" with "Sign in to Tailscale"

#### Scenario: Key expired
- **WHEN** the client node's key expires while a tailnet-only host is in use
- **THEN** that host shows "Tailnet sign-in required", and a host that is also reachable over `lan` keeps working on the local network

#### Scenario: Idle stop
- **WHEN** the last proxy has been closed for 60 seconds
- **THEN** the helper process is no longer running

### Requirement: Render host process mode
The packaged executable SHALL support the launch argument `--render-host`, which turns the process into the render host of design D11b. What the render host does, its pipe protocol, its health probe, restart policy and job accounting are owned by `render-engine.Render host` and `render-engine.Render host protocol`; this requirement defines only how the Electron application behaves in that mode. In `--render-host` mode the process: creates no visible window, tray icon, menu, updater or deep-link handler; neither takes nor checks the single-instance lock, so it runs beside the app and beside other render hosts; loads the engine bundle from the packaged `app://jagentchill` export in one hidden window created with the flags of `desktop-app.Renderer security configuration`, with the Chromium sandbox on, GPU acceleration when the machine has it and Chromium's software rasteriser otherwise; attaches file descriptors 3 and 4 to the engine as the command and binary pipes of `render-engine.Render host protocol`; blocks every network request (its `connect-src` is `app:`, `blob:`, `data:` and the host-local media scheme of `render-engine.Render host`, and the session's web request filter cancels anything else); writes nothing to the app's user-data directory except its own log file; and exits with status 0 after `engine.dispose` or within 2,000 ms of its command pipe closing, and with a non-zero status on an engine failure. The render host is spawned and supervised by JAgentChill Server, not by the desktop supervisor: the supervisor's only part is to pass the executable path in `JAGENTCHILL_RENDER_HOST_PATH` (`desktop-app.Gateway process supervision`), which is the "desktop app's own executable" step of the resolution order in `render-engine.Render host`. When the app stops the built-in host, the prepared shutdown and process-tree termination of `desktop-app.Gateway shutdown and app quit` cover render-host children, so none outlives the server's shutdown. [NEW]

#### Scenario: No window in render-host mode
- **WHEN** the executable is started with `--render-host` and valid pipes
- **THEN** no window, no Dock entry (macOS), taskbar entry (Windows) or launcher entry (Linux) and no tray icon appears, and the process answers `engine.init` on its command pipe

#### Scenario: Runs beside the app
- **WHEN** the app is running and the server starts a render host for an export
- **THEN** the render host starts although the single-instance lock is held, and the app's windows are unaffected

#### Scenario: No network
- **WHEN** engine code in render-host mode attempts a request to an `https:` URL
- **THEN** the request is cancelled and logged

#### Scenario: Pipe closed
- **WHEN** the server closes the command pipe of an idle render host
- **THEN** the process exits within 2,000 ms

#### Scenario: Ends with the Gateway
- **WHEN** the user quits the app while a host export is running and chooses "Quit anyway"
- **THEN** after the Gateway shutdown sequence completes, neither the Gateway nor any render-host or FFmpeg child process remains

### Requirement: Project library folder bridge
On desktop, project storage SHALL be a user-visible, movable **project library folder** on disk (design D15), accessed by the renderer only through the `library` group of the preload bridge, which is the desktop implementation of the storage port of `project-storage.Storage port and per-platform stores`. The folder's layout, its `library.lock`, index rebuild and move procedure are owned by `project-storage.Desktop project library folder` (`<library>/library.sqlite` plus one directory per project); caches live under the OS cache directory, never in the library. The main process (or a utility process it owns) holds the SQLite connection and all file handles; the renderer receives no file-system path access and no Node API. The bridge provides: transactional index reads and writes; atomic writes of project and snapshot files (write to a temporary file in the same folder, fsync, rename), so that a failed write never replaces the last good file; streamed media read with byte ranges and streamed media write with SHA-256 verification; free-space query for the library volume (the quota of `project-storage.Quota evaluation` on desktop); change notification when files under the library are modified by another process; and the move operation used by `settings-preferences.Project library location` (copy, verify size and SHA-256, switch, delete). Media referenced in place outside the library is served to the renderer by the privileged scheme `jagentchill-file://<grantId>/<name>`: a grant is a random 128-bit id created only for a path the user selected, dropped or associated, is range-capable, read-only and valid until revoked or the project is closed. A library path that is missing or not writable at startup SHALL produce a blocking dialog with "Locate library…", "Create a new library here" and "Quit", and no project is shown as deleted. A second app instance cannot open the library (single instance); when `library.lock` is held by a live process on another machine (network volume) the library opens read-only with a banner. [NEW]

#### Scenario: Files on disk
- **WHEN** the user creates a project named "Trip" in the desktop app
- **THEN** `<library>/library.sqlite` has a row for it and `<library>/<projectId>/project.json` exists and is readable in the OS file manager

#### Scenario: Atomic save
- **WHEN** the volume becomes full while a project file is being saved
- **THEN** the previous `project.json` is intact, the temporary file is removed and the renderer receives a storage error

#### Scenario: Renderer has no path access
- **WHEN** renderer code asks the `library` bridge to read a file with a path outside the library
- **THEN** the call is rejected

#### Scenario: External reference
- **WHEN** a clip references a video in place at a path the user dropped
- **THEN** the renderer plays it from a `jagentchill-file://<grantId>/…` URL with range requests, and the URL stops working after the grant is revoked

#### Scenario: Library missing
- **WHEN** the library folder is on a drive that is not connected at launch
- **THEN** the dialog with "Locate library…", "Create a new library here" and "Quit" is shown and no project data is changed

### Requirement: Authenticated Gateway media scheme
The main process SHALL register the privileged scheme `jagentchill-gw://<gatewayId>/<path>` through which the renderer loads bytes from a paired Gateway — blobs, proxies, thumbnails, exports and workspace file content — in `<img>`, `<video>`, downloads and `fetch`. For each request the main process resolves `<gatewayId>` to a paired host, signs the request with the device key per `device-pairing-signing.Per-request HTTP signature` (including `Range` requests), connects by the host's selected address kind (`device-pairing-signing.Address kinds and selection order`) — directly for `loopback`, directly with the host's `tlsSha256` pin enforced for `lan`, and through the helper of `desktop-app.Desktop tailnet proxy helper` for `tailnet` — and streams the response; the rules for what is served are owned by `server-api.Authenticated media delivery`. No credential, token or signature SHALL appear in a URL visible to the renderer, and a request for a `gatewayId` that is not paired returns 404 without a network connection. [NEW]

#### Scenario: Signed range request
- **WHEN** a `<video>` element seeks in a proxy loaded from `jagentchill-gw://<gatewayId>/…`
- **THEN** the main process sends a signed request with the `Range` header and the element receives a 206 response

#### Scenario: Unpaired gateway id
- **WHEN** the renderer requests a `jagentchill-gw://` URL whose gateway id is not paired
- **THEN** it receives 404 and no outbound connection is made

#### Scenario: Pin mismatch
- **WHEN** the host's certificate does not match the stored `tlsSha256`
- **THEN** the request fails and no bytes from that connection reach the renderer

### Requirement: Gateway crash restart
Two processes can fail, and each is restarted by its own parent. **The server.** When the server child exits unexpectedly or the app's channel P connection to it is lost for more than 15 s while the process is alive (in which case the supervisor terminates the server's process tree and then the Gateway's process group by the forced-stop steps of `desktop-app.Gateway shutdown and app quit`), the supervisor SHALL set the state to `restarting` and respawn the server with exponential backoff of 1 s, 2 s, 4 s, 8 s and 16 s. After 5 failed restarts within a 5-minute window the state becomes `failed`, automatic restarts stop, and the user is shown a persistent banner "The built-in host stopped" with "Restart", "Run repair" and "Open logs". A server that stays connected for 2 minutes resets the failure counter. **The Gateway.** A crash of the Gateway child is handled by the server alone, with the restart policy of `server-api.Gateway supervision and lifecycle` (1 s, 5 s, 30 s, then `crash_loop`); the desktop supervisor SHALL NOT restart the server because the Gateway is down, and shows the Gateway's state through the mapping of `desktop-app.Gateway process supervision`; in `crash_loop` the banner "Agents are unavailable on this computer" offers "Restart agents" (`jagentchill.diagnostics.service.restart { service: "gateway" }`), "Run repair" and "Open logs". During `restarting` the editor remains fully usable, host-scoped screens show the reconnecting banner, and background jobs resume from the host queue after restart as defined by `server-api.Job cancellation and restart recovery`; during a Gateway restart nothing reconnects and only agent features pause. Each exit of the server is recorded with exit code, signal and the last 100 log lines in the diagnostics log, and each Gateway exit is read from the server's supervision state. When the supervisor state becomes `failed`, the app raises the device-local notification kind `host.stopped` of `notifications.Notification event catalogue`, once per transition into `failed`. [NEW]

#### Scenario: Single crash of the server
- **WHEN** the server child is killed while `ready`
- **THEN** the state becomes `restarting`, the Gateway group of the old server is killed by the supervisor or reaped by the new server from its pid file so that no Gateway process of the old server remains, a new server is spawned after 1 s and the state returns to `ready` once `desktop-app.Gateway readiness detection` succeeds

#### Scenario: Single crash of the Gateway
- **WHEN** the Gateway process is killed while the built-in host is `ready`
- **THEN** the server process is not restarted, the app's channel P connection stays open, the state is `degraded` with reason `gateway_starting` until the server reports the Gateway ready again, and an export job running at that moment continues

#### Scenario: Crash loop
- **WHEN** the server child exits within seconds of each start five times in five minutes
- **THEN** no sixth automatic start occurs, the state is `failed` and the banner with "Restart", "Run repair" and "Open logs" is shown

#### Scenario: Editor unaffected
- **WHEN** the built-in host is `restarting` while the user edits a local project
- **THEN** editing, playback and autosave continue without interruption

### Requirement: Exit code 78 doctor path
Exit code 78 (configuration failure) can come from two processes. **The Gateway.** The repair is performed by the server, not by the desktop app (`server-api.Gateway supervision and lifecycle`): the server runs `openclaw doctor --fix --yes --non-interactive` once and starts the Gateway again exactly once. The desktop supervisor SHALL show state `doctor` while the server reports the Gateway starting after an exit with code 78; if that start reaches `ready`, the incident is recorded and a toast "The host configuration was repaired" is shown. If the server reports `config_invalid`, the state is `degraded` with reason `gateway_config_invalid`, the message "Host configuration repair failed" and the actions "Open logs", "Run repair again" (`jagentchill.diagnostics.service.restart { service: "gateway" }`, which repeats the doctor path) and "Reset host configuration…" (which, after typed confirmation, stops the built-in host, moves `<userData>/host/gateway-state/` to a timestamped backup folder and starts the host again so that the server writes a fresh Gateway configuration; paired devices, projects, media and host settings are kept, because they live in the server's own store, while agent sessions, their transcripts and provider sign-ins held by the Gateway are gone, which the dialog states). Exit code 78 of the Gateway does not count toward any crash-restart counter. **The server.** A server child that exits with code 78 found an unknown or invalid key in its own `config.json` (`server-api.Server identity and startup`): the supervisor SHALL NOT restart it automatically, sets the state to `failed` with reason `server_config_invalid` and the key named by the server, and offers "Open logs", "Open configuration folder" and "Retry". The "Run repair" action in Diagnostics runs `jagentchill doctor --fix` through the running server, or on the stopped host when the server is not running. [JAD] [NEW]

#### Scenario: Repair succeeds
- **WHEN** the Gateway exits with code 78 and the server's doctor run exits 0
- **THEN** the Gateway is started once more by the server, the state passes through `doctor` to `ready`, and a toast reports the repair

#### Scenario: Repair fails
- **WHEN** the Gateway exits with code 78 again after the doctor run
- **THEN** no further automatic Gateway start occurs, the server keeps running, the state is `degraded` with reason `gateway_config_invalid` and the three actions are offered

#### Scenario: Reset configuration
- **WHEN** the user confirms "Reset host configuration…" by typing the shown word
- **THEN** the previous `gateway-state/` directory is renamed to a backup folder with a timestamp, the host starts with a fresh Gateway configuration, and every paired device reconnects without pairing again

#### Scenario: Invalid server configuration
- **WHEN** the server child exits with code 78 naming the key `queue.maxConcurent`
- **THEN** the state is `failed` with reason `server_config_invalid`, the message names that key, and no restart happens until the user chooses "Retry"

### Requirement: Gateway shutdown and app quit
On app quit, on disabling the built-in host and before applying an update the supervisor SHALL stop the built-in host — the server, which in turn stops the Gateway — with one sequence that is the same on macOS, Windows and Linux: (1) set state `stopping`; (2) call `jagentchill.diagnostics.shutdown.prepare {}` on channel P (accepted only from the device record flagged `localSupervisor`, `server-api.Service lifecycle`), on which the server stops starting jobs, persists queue and lease state, stops render hosts, FFmpeg processes, terminals, the ingress helper and its Gateway child, checkpoints its database and answers `{ safe: true }` — or `{ safe: false, running[] }` at its 10,000 ms limit; (3) terminate the server's process tree: `SIGTERM`, then `SIGKILL` after 5 s, on macOS and Linux; `taskkill /PID <pid> /T /F` on Windows, where no graceful signal can be delivered to a windowless child process; (4) end the Gateway's process group if it is still alive. The Gateway is NOT part of the server's process group: the server starts it as the leader of a group of its own, so that the agent CLIs it starts can be ended with it (`server-api.Gateway supervision and lifecycle`), and a server that is killed leaves that group running, holding its port and its state directory (measured: `docs/decisions/0002-own-server-gateway-sidecar.md` row 14). After a successful step 2 the server has already ended the group and step 4 finds nothing. After a skipped or unsafe step 2, or a server that had to be killed, the supervisor ends the group itself: it knows the Gateway's pid from `gateway.pid` of `jagentchill.settings.host.get` and its change event — a field the server sends only to the device record flagged `localSupervisor` — which it keeps in its own pid file beside the server's pid; it verifies that the process with that pid runs the bundled Node with the Gateway entry of the app resources, sends `SIGKILL` to that process group (`taskkill /PID <pid> /T /F` on Windows), and waits until no process of the group remains (it opens no connection to the Gateway port). This is the only thing the app ever does to the Gateway, and it reads no file under the Gateway state directory for it. Because job state is made durable in step 2, the forced termination on Windows loses nothing that the signal path keeps on macOS and Linux. When channel P is not connected (the server is hung or still starting) step 2 is skipped after a 2 s connection attempt and step 3 runs. The sequence includes the Gateway child and any render-host and FFmpeg children of the server.

If host jobs (generation, workflow, remote export) are running, quitting first shows a dialog "<n> tasks are still running on this computer" with three choices: the keep-running choice — labelled "Keep running in the background" where a tray is available (the window closes, the app stays in the tray and the built-in host continues) and "Keep the host running — reopen JAgentChill from the launcher" where no tray is available (`desktop-app.Tray and background mode`; the process stays without a window and the next launch opens one through `desktop-app.Single instance`); "Quit anyway" (jobs are interrupted and resume or fail per `server-api.Job cancellation and restart recovery` at next start); and "Cancel". The same dialog is shown when the last window is closed on Windows or Linux while jobs run and "Keep running in the tray" is off. An on-device export in progress triggers a separate confirmation before any window close. No orphan server, Gateway, render-host, FFmpeg or ingress-helper process remains after the app exits; at launch the supervisor terminates any leftover server and any leftover Gateway group recorded in its pid file whose executable path matches the bundled runtime, and the server additionally reaps a leftover Gateway group recorded in its own pid file before it spawns a new one (`server-api.Gateway supervision and lifecycle`). [NEW]

#### Scenario: Clean quit
- **WHEN** the user quits with no jobs running on macOS, Windows or Linux
- **THEN** `jagentchill.diagnostics.shutdown.prepare` answers `{ safe: true }`, the process tree is terminated and no child process remains within 10 s

#### Scenario: Prepared stop on Windows
- **WHEN** the user chooses "Quit anyway" on Windows while a generation job runs
- **THEN** the job was persisted as recoverable by the prepare call before `taskkill` ran, and it resumes or fails by the restart-recovery rules at the next start, exactly as on macOS and Linux

#### Scenario: Quit with running jobs
- **WHEN** two generation jobs are running and the user chooses Quit
- **THEN** the dialog names 2 tasks, and choosing "Keep running in the background" closes the window while the tray icon, the server and its Gateway remain

#### Scenario: Quit with running jobs and no tray
- **WHEN** two jobs are running on a Linux desktop without a system tray and the user chooses Quit
- **THEN** the first choice reads "Keep the host running — reopen JAgentChill from the launcher", and choosing it leaves the app process and the built-in host running with no window

#### Scenario: Server does not answer
- **WHEN** the server is hung and channel P cannot be connected within 2 s
- **THEN** the server's process tree is terminated without the prepare call, the supervisor then kills the Gateway's process group by its recorded pid, and within 10 s neither a Gateway nor an agent CLI process of the built-in host remains

#### Scenario: Stale child at launch
- **WHEN** the previous run crashed leaving a server child, with its Gateway, recorded in the pid files
- **THEN** both processes are terminated before a new server is spawned

### Requirement: Host status surface
The desktop app SHALL surface the supervisor state in three places: the popover of the sidebar footer connection chip, the tray menu, and the Host ▸ Diagnostics settings page, which shows state, pid, port, network access level, the state of each enabled product listener (the tailnet listener with its DNS name and key expiry, the LAN listener with its addresses, port and certificate fingerprint), the host encoder table of `server-api.Host encoder policy and codec table` with "Download OpenH264…" when H.264 is `download_required`, this computer's `keyProtection`, the state of the desktop tailnet proxy helper, the connection path of `device-pairing-signing.Connection path indicator` ("This computer" for the built-in host), uptime, server version, the pinned OpenClaw version of the Gateway, the Gateway's supervision state with its restart count and last exit, protocol version, health reasons when `degraded`, last exit (code, signal, time), restart count in the last hour, and the actions Start, Stop, Restart, Run repair, Open logs folder, Copy diagnostics and "Restore this computer as admin" (runs the host CLI recovery of `device-pairing-signing.Trust bootstrap for the first device` through the local admin endpoint of the built-in host after typed confirmation, and is audit-logged). State changes SHALL be pushed to all windows within 500 ms. Each supervisor state has a fixed label used only in these three places: Stopped, Starting…, Running, Running with problems, Restarting…, Repairing configuration…, Failed, Stopping…. The connection chip itself shows only the connection states of `device-pairing-signing.Connection liveness and backoff` together with the path label of `device-pairing-signing.Connection path indicator`, the same words as on web and mobile and on macOS, Windows and Linux alike. [NEW]

#### Scenario: Live status
- **WHEN** the built-in host transitions from `starting` to `ready`
- **THEN** every open window's connection chip changes to "Connected" within 500 ms and its popover reads "Running"

#### Scenario: Manual restart
- **WHEN** the user activates "Restart" on the Diagnostics page
- **THEN** the server and its Gateway stop gracefully, start again and the page shows the new pid and an uptime counting from zero

#### Scenario: Same words on every platform
- **WHEN** the built-in host's server is down and reconnection is being retried
- **THEN** the desktop chip reads "Offline — retrying in N s", the same label a paired phone shows, and the popover adds the supervisor label "Restarting…"

### Requirement: Windows and window state
The app SHALL support multiple windows: one main window plus additional windows opened by "New window" (`window.new`), by `Mod`+Enter on a palette result, or by "Open in new window" in a project, session or workflow context menu. A project can be open for editing in only one window per device; a second attempt focuses the window that already has it. Each window has a default size of 1440×900 centred on the active display and a minimum size of 960×600 **multiplied by the UI scale** of `settings-preferences.Appearance preferences` (960×600 at 100%, 1,440×900 at 150%), so that the effective viewport of the desktop app is never below 960×600 CSS px and never falls into the compact form factor; when a display's work area is smaller than that minimum the UI scale control stops at the largest value that fits. A window remembers position, size, maximised and fullscreen state and its last route; a remembered position that is no longer on any connected display is reset to centred on the primary display.

Window chrome per OS — none has a native menu bar inside the window, and all three keep the operating system's own window management:

| OS | Title bar | Window controls | Application menu |
|---|---|---|---|
| macOS | hidden title bar with a draggable top region | native traffic lights, inset 78 px at the inline-start | system menu bar |
| Windows | `titleBarStyle: "hidden"` with the title-bar overlay: the top bar of the app is the draggable title bar | **native** caption buttons drawn by the system in the overlay (minimise, maximise/restore, close), so the Windows 11 snap-layout flyout, the system menu on Alt+Space and the caption buttons' high-contrast rendering are kept; the overlay's colours are set to `bg/app` and `text/primary` of the active theme | app-drawn application menu button in the top bar (`design-system.Application menu button`) |
| Linux | frameless window; the top bar of the app is the draggable title bar, and a double-click or middle-click on it follows the desktop's title-bar action setting | **app-drawn** buttons whose set and side follow the desktop's button-layout setting (read from the `org.gnome.desktop.wm.preferences button-layout` setting or the XDG portal's equivalent, re-read on change; default "minimise, maximise, close" at the inline-end when it cannot be read); edge and corner resizing and the window manager's tiling and snapping work as for any window | app-drawn application menu button in the top bar |

The width reserved in the top bar for window controls is measured at run time and exposed to the renderer through the `window` bridge group — the overlay's `titlebar-area` rectangle on Windows, the measured width and side of the app-drawn group on Linux, the fixed 78 px on macOS — and is the inset of `design-system.Breakpoints and layout constants`. Closing the last window on macOS keeps the app running; on Windows and Linux it quits the app unless "Keep running in the tray" is on (`desktop-app.Tray and background mode`) or host jobs are running, in which case the dialog of `desktop-app.Gateway shutdown and app quit` is shown. Player fullscreen uses the window's HTML fullscreen; app fullscreen uses native fullscreen. The background colour of a new window equals the active theme's `bg/app` so that no white flash occurs. [JAD] [NEW]

#### Scenario: Restore window state
- **WHEN** the user moves and resizes the main window, quits and relaunches
- **THEN** the window opens at the same position and size

#### Scenario: Display removed
- **WHEN** the window was last on an external display that is no longer connected
- **THEN** the window opens centred on the primary display at the remembered size clamped to that display

#### Scenario: Same project twice
- **WHEN** a project is open in window A and the user opens it from window B
- **THEN** window A is focused and window B stays on its current screen

#### Scenario: Minimum size
- **WHEN** the user tries to resize a window below 960×600 at UI scale 100%
- **THEN** the window stops at 960×600

#### Scenario: Minimum size follows the UI scale
- **WHEN** the UI scale is 150%
- **THEN** the window cannot be made smaller than 1,440×900 physical points, the effective viewport is at least 960 px wide and the editor keeps its four-region layout

#### Scenario: Snap layouts on Windows
- **WHEN** the pointer rests on the maximise button on Windows 11
- **THEN** the system snap-layout flyout appears, because the caption buttons are the native ones

#### Scenario: Button layout on Linux
- **WHEN** the desktop's button layout places Close alone at the inline-start side
- **THEN** the app draws one Close button at the inline-start of the top bar and reserves no inset at the inline-end

### Requirement: Single instance
The app SHALL hold a single-instance lock per OS user. Launching a second instance — by icon, by opening an associated file, or by a `jagentchill://` link — exits the second process immediately after forwarding its arguments to the first instance, which focuses its most recently used window (restoring it if minimised or hidden in the tray) and handles the file or link. Exactly one server child, with its one Gateway child, exists per OS user. A process started with `--render-host` neither takes nor checks this lock (`desktop-app.Render host process mode`). [NEW]

#### Scenario: Second launch
- **WHEN** the app is running and the user launches it again
- **THEN** no second process stays alive and the existing window is brought to the front

#### Scenario: Link while running
- **WHEN** the app is running minimised and the OS opens a `jagentchill://editor/<id>` link
- **THEN** the existing instance is restored and shows that project

### Requirement: Native application menu
The app SHALL define **one menu model** (localised, built in the main process from the action registry) and present it natively per OS: on **macOS** as the system menu bar; on **Windows and Linux**, where the window has no native menu bar (`desktop-app.Windows and window state`), through the app-drawn application menu button of `design-system.Application menu button`, which `app-shell-navigation.Top bar` places in the global top bar of every screen, including the editor. The items, their order, their enabled and checked state and their shortcut hints are identical on the three systems, except for the placement differences stated in the list. Every item is either a registry action of `keyboard-shortcuts.Action registry`, invoked with trigger `menu`, or one of the operating-system roles named below; no item exists without one of the two.

- **JAgentChill** (macOS only): About (`app.about`), Check for updates… (`app.check-updates`), Settings… (`app.settings`), Services (role), Hide and Hide others (roles), Quit (`app.quit`).
- **File**: New project (`project.new`), New window (`window.new`), New session (`session.new`), New script (`script.new`), Open project… (`project.open`), Open recent ▸ (10 entries, each invoking `project.open-recent` with the project id; Clear = `project.clear-recent`), Import media… (`media.import`), Import project… (`project.import-package`), Save version (`project.save-version`), Export… (`export.open`), Exports (`nav.go.exports`), Export project package… (`project.export-package`), Close project (`project.close`), Close window (`window.close`); on Windows and Linux also Settings… (`app.settings`) and Quit (`app.quit`).
- **Edit**: Undo, Redo, Cut, Copy, Paste, Duplicate, Delete, Select all, Deselect all, Find… (command palette) — the `edit.*`, `timeline.*`, `selection.*` and `palette.open` actions of the registry.
- **Clip**: Split, Split all tracks, Delete left, Delete right, Group, Ungroup, Create compound clip, Dissolve compound clip, Create multi-camera clip, Flatten multi-camera clip, Replace media…, Extract audio, Freeze frame, Reverse, Speed…, Activate/deactivate — `timeline.*` actions.
- **Playback**: Play/pause, Shuttle reverse, Shuttle stop, Shuttle forward, Previous frame, Next frame, Go to start, Go to end, Set in point, Set out point, Clear range, Loop — `playback.*` actions.
- **View**: Toggle sidebar, Toggle inspector, Toggle agent panel, Layout ▸ (`editor.layout.apply` with the preset id), Zoom timeline in/out/to fit, Zoom player in/out/to fit, Player fullscreen, Focus mode, Theme ▸ (`app.theme.system`, `.light`, `.dark`), Enter full screen (`app.fullscreen`), Actual size / Zoom in / Zoom out (`app.ui-scale.reset`, `.in`, `.out`; UI scale 80%–150% in 10% steps).
- **Go**: one item per destination of `app-shell-navigation.Primary navigation` in its order — the seven primary destinations, a separator, then the six destinations of the "More" group — each its `nav.go.<destination>` action, then Back (`nav.back`) and Forward (`nav.forward`).
- **Host**: status line (disabled item), Start built-in host / Stop built-in host (`supervisor.start`, `supervisor.stop`), Restart (`supervisor.restart`), Network access… (`app.settings.network-access`), Pair a device… (`devices.pair`), Devices (`nav.go.devices`), Host settings… (`app.settings.host`), Open logs folder (`supervisor.open-logs`).
- **Window**: Minimise and Zoom (roles), list of open windows (role), Bring all to front (role, macOS).
- **Help**: Keyboard shortcuts (`help.shortcuts`), Starter tips (`help.starter-tips`), What's new (`help.whats-new`), Send feedback… (`help.feedback`), Diagnostics… (`help.diagnostics`), Toggle developer tools (`help.devtools`), and on Windows and Linux Check for updates… (`app.check-updates`) and About (`app.about`).

**Who handles keys.** The renderer's key dispatcher (`keyboard-shortcuts.Dispatch and suppression rules`) is the only handler of key presses while a window's web contents has focus; a menu item shows the hint returned by `keyboard-shortcuts.Active binding lookup` but does not register it as an accelerator: on macOS every item is created with its accelerator as display text and the main process calls `webContents.setIgnoreMenuShortcuts(true)` whenever a window's web contents gains focus (and `false` when it loses it); on Windows and Linux there is no native menu to register accelerators, and the app-drawn menu shows hints only. No accelerator is defined in this capability. Real native accelerators exist only for what the operating system must own when no web contents has focus — on macOS: Quit, Hide, Hide others, Minimise, Close window, New window, Settings…, Enter full screen, New project and Open project… (so that they work with no window open); their key combinations are read from the binding tables of `keyboard-shortcuts`, and when the user rebinds one the menu is rebuilt within 200 ms. On Windows and Linux the same actions are reachable with no window open from the tray menu or by launching the app.

Menu items SHALL be enabled or disabled from the renderer's action `isEnabled` state, synchronised within 200 ms of a change of screen, selection or focus; items for editor actions are disabled when no editor is in the foreground; host items follow the supervisor state. Standard text-editing roles (cut, copy, paste, select all, undo, redo) act on the focused text field when one is focused and on the foreground screen's history otherwise. A CI test builds the menu model and fails when an item has neither a registered action id nor a declared role, and when the model rendered for macOS and the model rendered for the application menu button differ in anything but the placement differences listed above. [JAD] [NEW]

#### Scenario: Menu invokes the action
- **WHEN** the user chooses Clip ▸ Split with a clip under the playhead
- **THEN** `timeline.split` runs with trigger `menu`, exactly as its shortcut would

#### Scenario: Same menu on Windows and Linux
- **WHEN** the user opens the application menu button on Windows or Linux
- **THEN** it lists File, Edit, Clip, Playback, View, Go, Host, Window and Help with the same items, enabled state and hints as the macOS menu bar, and Help ▸ Toggle developer tools and Check for updates… are reachable

#### Scenario: Single-key hint does not fire while typing
- **WHEN** focus is in the project-name input on macOS and the user types the letter that is the hint of Clip ▸ Delete left
- **THEN** the letter is typed, the menu item does not fire, and the timeline is unchanged

#### Scenario: Disabled outside the editor
- **WHEN** the Sessions screen is in the foreground
- **THEN** all Clip menu items and Playback items are disabled

#### Scenario: Enabled state follows the selection
- **WHEN** the user selects a clip in the editor
- **THEN** Clip ▸ Group and the other selection-dependent items are enabled within 200 ms

#### Scenario: Text field has focus
- **WHEN** focus is in the project-name input and the user chooses Edit ▸ Undo
- **THEN** the text change is undone and the timeline history is untouched

#### Scenario: Open recent
- **WHEN** the user opens three projects in sequence
- **THEN** File ▸ Open recent lists them most recent first

#### Scenario: Go menu matches the sidebar
- **WHEN** the Go menu is opened
- **THEN** it lists the seven primary destinations in sidebar order, then the six destinations of the "More" group, then Back and Forward

#### Scenario: Item without an action fails the build
- **WHEN** an item is added to the menu model with an id that is not in the action registry and is not a declared role
- **THEN** the menu-model test fails naming the item

### Requirement: File associations
The installers SHALL register the app as the default handler for project package files with the extension `.jagentchill` (MIME type `application/vnd.jagentchill.project+zip`, with a document icon), and as an "Open with" handler for the product's other file types — `.jctpl`, `.jcpack`, `.jcworkflow`, `.jcscript`, `.jckeys` and `.fountain` — each routed to its owning import per `app-shell-navigation.Deep links and file types`. Every product file type has a single final extension, because Windows and macOS associate by the last extension only; `.jcworkflow`, `.jcscript` and `.jckeys` contain UTF-8 JSON (MIME types `application/vnd.jagentchill.workflow+json`, `application/vnd.jagentchill.script+json`, `application/vnd.jagentchill.keys+json`). Files with the earlier compound names (`*.jcworkflow.json`, `*.jcscript.json`, `*.jckeys.json`) are still accepted by the in-app file pickers and by drag and drop, recognised by content, but `.json` is never registered with the OS. Registration per OS: **macOS** — `CFBundleDocumentTypes` and exported UTIs in the app bundle; **Windows** — per-user registry classes (`HKCU\Software\Classes`) written by the installer and re-checked at launch, with `OpenWithProgids` for the non-default types; **Linux** — a `.desktop` entry with `MimeType=` and a shared-mime-info package: installed system-wide by the `.deb` and `.rpm` packages, and written per user by the app itself for the AppImage (`desktop-app.Deep links`). The app additionally appears in the OS "Open with" list — without becoming the default handler — for video (`.mp4`, `.mov`, `.m4v`, `.webm`, `.mkv`), audio (`.mp3`, `.wav`, `.m4a`, `.aac`, `.ogg`, `.flac`), image (`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`) and subtitle (`.srt`, `.vtt`, `.ass`) files. Opening a `.jagentchill` file runs `projects.Project package import`, which owns the summary, validation and the rule for an id that already exists (the package is always imported as a new project with the duplicate-naming rule; nothing is replaced), and then opens the project. Opening media files through "Open with" asks "Create a new project" or, when a project is open in the focused window, "Add to <project>". Files received before the UI is ready are queued (at most 50; further ones are reported as skipped) and handled after startup routing. A file that cannot be read produces an error dialog naming the file and the reason, and nothing is imported. No handler is registered for any other extension; in particular the app never becomes an "Open with" candidate for `.json` files. [PORT N-018] [NEW]

#### Scenario: Double-click a project package
- **WHEN** the user double-clicks `trip.jagentchill` in the file manager while the app is closed
- **THEN** the app launches, shows the import summary of `projects.Project package import`, and after "Import" opens the project in the editor

#### Scenario: Existing project id
- **WHEN** the package's project id already exists on the device
- **THEN** a new project is created with the duplicate-naming rule of `projects` and the existing project is unchanged

#### Scenario: Corrupt package
- **WHEN** the package fails validation
- **THEN** an error dialog names the file and the reason and no project is created or modified

#### Scenario: Open a video with the app
- **WHEN** the user chooses "Open with JAgentChill" on a `.mp4` file and no project is open
- **THEN** a new project containing that file is created and opened after confirmation

#### Scenario: Old extension is not registered
- **WHEN** the installer has run
- **THEN** no association exists for `.jchill`, `.jchill-keys.json` or `.json` on macOS, Windows or Linux

#### Scenario: Workflow file on each desktop system
- **WHEN** the user double-clicks `intro.jcworkflow` on macOS, Windows or Linux (any of `.deb`, `.rpm` or AppImage)
- **THEN** the app is offered in "Open with" and opening it runs the workflow import

### Requirement: Deep links
The app SHALL register the URL scheme `jagentchill://` with the OS on install and at each launch. The link forms, their mapping to routes, the strict parsing rules and the rule that a link only navigates are owned by `app-shell-navigation.Deep links and file types`; the desktop app defines no link form of its own. The desktop app's part is: OS registration (macOS `CFBundleURLTypes`; Windows per-user registry protocol handler; Linux `.desktop` entry with `x-scheme-handler/jagentchill`, installed by the `.deb` and `.rpm` packages); **self-registration for the Linux AppImage**, which has no install step: at first launch and whenever the AppImage's path differs from the registered one, the app writes `~/.local/share/applications/jagentchill.desktop` (with `Exec=` pointing at the AppImage, `MimeType=` listing the scheme handler and the product MIME types), the MIME package `~/.local/share/mime/packages/jagentchill.xml` and the icons under `~/.local/share/icons/hicolor/`, then runs `update-desktop-database` and `update-mime-database` on those per-user directories (a missing tool is logged and reported on Personal ▸ About as "File and link handling is not registered" with "Retry"); these files are removed by Personal ▸ Privacy ▸ "Erase device data…" and listed there; receiving links through the `open-url` event on macOS and the forwarded second-instance arguments on Windows and Linux (`desktop-app.Single instance`); rejecting, in the main process and before anything reaches the renderer, any URL longer than 4,096 characters or whose scheme is not exactly `jagentchill`; delivering accepted links to the renderer through the `deepLinks` bridge subscription in arrival order; focusing or restoring the most recently used window before delivery; and holding links that arrive before the renderer has subscribed (at most 10). [JAD] [NEW]

#### Scenario: Project link
- **WHEN** the OS opens `jagentchill://editor/p_123` and that project exists
- **THEN** the app focuses and shows the editor for that project

#### Scenario: Oversized link
- **WHEN** the OS opens a `jagentchill://` URL of 5,000 characters
- **THEN** the main process drops it, the renderer receives nothing and a warning is logged

#### Scenario: Link while starting
- **WHEN** the OS launches the app with a link
- **THEN** the link is held until the renderer subscribes and is then handled by startup routing

#### Scenario: Pairing link needs confirmation
- **WHEN** the OS opens a pairing link
- **THEN** the pairing screen of `device-pairing-signing.Pairing flow on the new device` shows the host name and addresses from the offer and nothing is trusted until the user proceeds and verification completes

#### Scenario: AppImage registers itself
- **WHEN** the AppImage is launched for the first time and then a browser opens a `jagentchill://pair#offer=…` link
- **THEN** the per-user `.desktop` entry and MIME package exist, the link is delivered to the running app and the pairing screen opens

#### Scenario: AppImage moved
- **WHEN** the user moves the AppImage to another folder and launches it
- **THEN** the `.desktop` entry's `Exec=` path is rewritten to the new location

### Requirement: Drag-in from the operating system
The desktop app SHALL accept files and folders dragged from the OS file manager onto any window, following `app-shell-navigation.Global drag and drop of files`, and files dropped on the app's icon (the Dock on macOS, the taskbar or a shortcut on Windows, the launcher on Linux) or passed as launch arguments, which are treated like "Open with". For dropped files the renderer receives a handle to the original path through the preload bridge so that, on desktop, media is referenced in place without copying when the preference "Reference files in place" is on (default on) and copied into the project library when it is off, as defined by `media-library.External file references`, served to the renderer through the grants of `desktop-app.Project library folder bridge`. Dropped folders are expanded recursively up to 5 levels and 2,000 files; hidden files and unsupported types are skipped, and a summary toast states how many files were imported and how many skipped. Dragging media out of the app is supported for exported files and library media: dragging an item from the Exports screen (`/exports`) or the media panel to the file manager copies the underlying file. [NEW]

#### Scenario: Drop a folder
- **WHEN** the user drops a folder containing 12 videos and 3 text files onto the asset panel
- **THEN** 12 media assets are imported and a toast reports "12 imported, 3 skipped"

#### Scenario: Reference in place
- **WHEN** "Reference files in place" is on and the user drops a 4 GB video
- **THEN** the asset appears without the file being copied and the project stores the original path

#### Scenario: Drag out an export
- **WHEN** the user drags a finished export from the Exports screen to the desktop
- **THEN** a copy of the exported file is created there

### Requirement: Tray and background mode
The app SHALL show a tray icon (menu-bar extra on macOS, notification-area icon on Windows, status-notifier item on Linux) whenever the built-in host is enabled or "Keep running in the tray" is on and a tray is available. **Tray availability**: always on macOS and Windows; on Linux a tray is available exactly when a `org.kde.StatusNotifierWatcher` is registered on the session bus with a registered host, checked at start and re-checked whenever the name's owner changes (stock GNOME without an indicator extension has none, although the tray object can be created without error). The icon has three states: idle, busy (jobs running) and attention (a task needs the user or the host failed). Its menu contains: a status line ("Host running — 2 tasks"), Open JAgentChill, New project, up to 5 running tasks with progress (activating one opens it), Pair a device…, Pause all host tasks / Resume, Start/Stop built-in host, Settings…, Quit — each the registry action of the same name in `desktop-app.Native application menu`.

With "Keep running in the tray" on (default off on macOS, where closing the window already keeps the app alive; default on for Windows and for Linux with a tray when the built-in host is enabled), closing the last window hides the app to the tray; the first time this happens a notification explains it. **Without a tray** (Linux only): the rows "Keep running in the tray" and "Launch at login" are disabled with the visible description "Your desktop has no system tray" and a link to instructions; "Keep running in the tray" is treated as off; closing the last window quits the app, or shows the dialog of `desktop-app.Gateway shutdown and app quit` when host jobs are running, whose keep-running choice leaves a windowless process that the next launch from the launcher re-attaches to through `desktop-app.Single instance`; while such a windowless process runs, a persistent OS notification "JAgentChill is running in the background — <n> tasks" with the actions "Open" and "Quit" is its visible surface, so the process is never invisible. When a tray appears or disappears while the app runs, the rows and the icon follow within 5 s.

"Launch at login" (default off) starts the app hidden in the tray at login, with the built-in host if enabled, registered per OS: a login item through the system login-items API on macOS; a value under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` on Windows; the file `~/.config/autostart/jagentchill.desktop` on Linux (pointing at the installed binary or the AppImage path, rewritten when that path changes) — each launching with the argument `--hidden`. Turning the setting off removes the registration. A `--hidden` launch on a desktop without a tray opens a minimised window instead of no window. [NEW]

#### Scenario: Close to tray
- **WHEN** "Keep running in the tray" is on and the user closes the last window on Windows
- **THEN** the app keeps running, the tray icon remains and the Gateway stays `ready`

#### Scenario: Attention state
- **WHEN** an agent requests approval while no window is open
- **THEN** the tray icon shows the attention state and its menu lists the request, which opens the session when activated

#### Scenario: Launch at login
- **WHEN** "Launch at login" is on and the user logs in on macOS, Windows or a Linux desktop with a tray
- **THEN** the app starts without opening a window, the tray icon is present and the built-in host starts if enabled

#### Scenario: Linux desktop without a tray
- **WHEN** the app runs on a GNOME session with no status-notifier host
- **THEN** "Keep running in the tray" and "Launch at login" are disabled with "Your desktop has no system tray", and closing the last window with no jobs running quits the app

#### Scenario: Background without a tray
- **WHEN** the user keeps the host running from the quit dialog on a desktop without a tray
- **THEN** a persistent notification with "Open" and "Quit" is shown, and launching the app again opens a window attached to the running process

### Requirement: Native dialogs and file system integration
The app SHALL use native dialogs for opening files and folders, choosing export destinations and choosing the project library folder, remembering the last used directory per dialog purpose. Export writes stream directly to the chosen path through the bridge without holding the whole file in memory, writing to a temporary file `<name>.part` in the destination folder and renaming it on success; on failure or cancel the partial file is deleted. "Reveal in file manager" is available for exports, media assets and the logs folder. Before overwriting an existing file the native dialog's own confirmation is used. If the destination volume has less free space than the estimated output size plus 500 MiB, the export dialog warns before starting; if the volume fills during export, the export fails with "Not enough disk space", the partial file is removed and the project is unchanged. Media referenced in place whose file has moved shows as offline with a "Relink…" action that opens a native picker and can relink sibling files found in the same folder. [NEW]

#### Scenario: Export to disk
- **WHEN** the user exports to `~/Movies/out.mp4`
- **THEN** `out.mp4.part` grows during export, and on completion it is renamed to `out.mp4`

#### Scenario: Cancel export
- **WHEN** the user cancels during export
- **THEN** the `.part` file is deleted and no `out.mp4` is created

#### Scenario: Disk full
- **WHEN** the destination volume runs out of space during export
- **THEN** the export stops with "Not enough disk space", the partial file is removed and the queue item shows Failed with "Retry"

### Requirement: Hardware acceleration and media capability flags
The desktop app SHALL run Chromium with GPU acceleration on by default and pass exactly the command-line switches recorded for the pinned Electron major in `docs/product/TOOLCHAIN.md`; the working set is:

| OS | Switches |
|---|---|
| macOS | none (Metal back end; WebGPU and VideoToolbox decode and encode are on by default) |
| Windows | none (D3D11/D3D12 back end; WebGPU and Media Foundation hardware codecs are on by default) |
| Linux | `--enable-features=Vulkan,VaapiVideoDecodeLinuxGL,VaapiVideoEncoder` and `--enable-unsafe-webgpu`; the VA-API features are passed only when a VA-API driver is detected |

A switch is added to or removed from this table only together with a `TOOLCHAIN.md` change, and a CI test compares the switches the packaged app passes with that file. At startup the app SHALL probe and record: WebGPU adapter availability and name, WebGL2 availability, hardware decode support for H.264, HEVC, VP9 and AV1, and hardware encode support for H.264, HEVC, VP9 and AV1 at 1080p and 4K. The results are shown on the Personal ▸ Performance page (`settings-preferences.Performance preferences`) and used by `render-engine.Engine capability probe and ready handshake` and `export-share.Video codecs with capability detection and fallback` to choose paths. The preference "Render interface with GPU" (default on) maps to Electron hardware acceleration; turning it off requires a relaunch, which the app offers immediately. If the GPU process crashes 3 times within 60 s the app relaunches once with GPU acceleration disabled, shows a banner explaining the fallback and offers "Try GPU again". After such a relaunch, and whenever "Render interface with GPU" is off, the client engine has no GPU back end: `preview-canvas.Engine states` shows its "no GPU" state with the action "Export on this computer's host" (the built-in host's render host, which always allows software rendering), unless the preference "Allow software rendering" of `settings-preferences.Performance preferences` is on, in which case the engine reports `backend: "webgl2"` with `software: true` and the degraded-graphics notice is shown. Power-save blocking is requested while an on-device export or a host render is running and released when it ends, so that the computer does not sleep mid-export. [CAPCUT CC-275] [NEW]

#### Scenario: Capability report
- **WHEN** the user opens Personal ▸ Performance
- **THEN** the page lists the GPU adapter and, per codec, whether hardware decode and encode are available

#### Scenario: Switch set matches the toolchain file
- **WHEN** the CI test reads the switches passed by the packaged Linux app
- **THEN** they equal the Linux entry of `docs/product/TOOLCHAIN.md`, or the test fails

#### Scenario: Disable GPU interface rendering
- **WHEN** the user turns off "Render interface with GPU"
- **THEN** a prompt offers "Relaunch now" or "Not now", and after relaunch the app runs with hardware acceleration disabled

#### Scenario: GPU crash loop
- **WHEN** the GPU process crashes three times within 60 s
- **THEN** the app relaunches with GPU acceleration disabled and shows the fallback banner

#### Scenario: Sleep blocked during export
- **WHEN** an export is running
- **THEN** the OS is prevented from idle-sleeping until the export finishes, fails or is cancelled

### Requirement: Desktop notifications and attention
The desktop app SHALL deliver OS notifications through Electron's notification API for the kinds of `notifications.Notification event catalogue` under the rules of `notifications.Delivery channels` and `notifications.Attention routing by presence`, set the Dock badge (macOS) or taskbar overlay and badge count (Windows, Linux where supported) to the unread attention count, and request user attention (Dock bounce once on macOS, taskbar flash on Windows, the urgency hint on Linux) when an item needs a decision while no app window is focused. Activating a notification focuses the app and navigates to the related item; action buttons on notifications are provided on platforms that support them. On every OS that asks for notification permission (macOS always; Windows and Linux where the system or desktop environment gates notifications per app) the request is made the first time a notification is due, not at first launch, and a denied or disabled permission is shown on Personal ▸ Notifications with "Open system settings". [JAD] [NEW]

#### Scenario: Click-through
- **WHEN** the user clicks an "Export finished" OS notification
- **THEN** the app window is focused and `/exports/history?job=<jobId>` is shown with that job selected

#### Scenario: Badge count
- **WHEN** two approvals are pending and unread
- **THEN** the Dock or taskbar badge shows 2 and clears to none when both are resolved

### Requirement: Desktop secure storage and paths
The desktop app SHALL keep the device private key in the main process, encrypted with Electron `safeStorage` in a file readable only by the OS user (mode 0600 on macOS and Linux, an access-control list restricted to the current user on Windows), as required by `device-pairing-signing.Per-platform device key storage`, together with the device tokens of paired hosts and their `tlsSha256` pins; The OS secret store counts as available only when `safeStorage.isEncryptionAvailable()` is true and, on Linux, `safeStorage.getSelectedStorageBackend()` is neither `basic_text` nor `unknown` (Electron's `basic_text` backend uses a fixed key and protects nothing). When the store is unavailable — a Linux session without a keyring, a damaged or policy-blocked keychain on macOS, unavailable data protection on Windows — the app SHALL NOT create or store a key silently and SHALL NOT block the user either (decision D3): it shows the `KEY_STORAGE_UNAVAILABLE` dialog of `device-pairing-signing.Per-platform device key storage`, with the same wording on the three systems apart from the store's name, offering "Try again", "Store the key in a protected file" and "Cancel"; only after the user chooses the file and confirms the sentence "The key will be protected only by this account's file permissions" are the key, the device tokens and the pins written to `<userData>/identity/` with owner-only permissions (`keyProtection: "file"`). Personal ▸ Connections then shows the persistent notice "Device key stored in a file" with "Move the key to the system store", which re-wraps the same key once a store is available. The dialog is raised at the first moment a key is needed — starting the built-in host (`desktop-app.Gateway process supervision`) or pairing with a host — and "Cancel" leaves the app in local-only mode with the editor fully usable. Paths: user data under the OS application-data directory (`~/Library/Application Support/JAgentChill`, `%APPDATA%\JAgentChill`, `$XDG_CONFIG_HOME/JAgentChill`); logs under the OS log location; caches (thumbnails, waveforms, proxies, render cache, downloaded models) under the OS cache location, never in the project library; the Gateway state directory under user data; and the default project library at `~/Movies/JAgentChill` (macOS), `%USERPROFILE%\Videos\JAgentChill` (Windows) or `$XDG_VIDEOS_DIR/JAgentChill` falling back to `~/Videos/JAgentChill` (Linux), movable per `settings-preferences.Project library location`. Uninstalling the app SHALL NOT delete the project library on any OS; user data other than the library is removed only on the user's explicit choice — the Windows uninstaller asks, and on macOS and Linux, where removing the app or package leaves user data in place, Personal ▸ Privacy ▸ "Erase device data…" (`settings-preferences.Privacy page`) removes it after typed confirmation. [NEW]

#### Scenario: No keyring on Linux
- **WHEN** the secret store is unavailable (no keyring, or the `basic_text` backend is selected) and the built-in host is about to start
- **THEN** the `KEY_STORAGE_UNAVAILABLE` dialog is shown, no key file exists yet, and "Cancel" leaves the editor usable in local-only mode

#### Scenario: Confirmed file storage
- **WHEN** the user chooses "Store the key in a protected file" and confirms, on macOS, Windows or Linux
- **THEN** the key is written with owner-only permissions, the built-in host starts, and Personal ▸ Connections shows "Device key stored in a file" with "Move the key to the system store"

#### Scenario: Default library location
- **WHEN** the app runs for the first time on macOS
- **THEN** the project library location shown in settings is `~/Movies/JAgentChill`

#### Scenario: Uninstall keeps projects
- **WHEN** the app is uninstalled on any desktop OS and the user has not chosen to remove user data
- **THEN** the project library folder and its projects are intact

### Requirement: Desktop packaging contents
The packaged app SHALL contain: the Electron shell (which is also the render host, `desktop-app.Render host process mode`); the web export; one Node runtime (≥ 24.16), which runs both JAgentChill Server and the Gateway; JAgentChill Server (`@jagentchill/server` with its `jagentchill` command and its production dependencies, including `@openclaw/gateway-client` at the pinned version); the built OpenClaw Gateway of the pinned tag, installed intact and unmodified, with no JAgentChill file inside it; the JAgentChill skills; an LGPL build of FFmpeg and FFprobe invoked only as external processes (with libvpx, SVT-AV1 and libopus, and the second build `ffmpeg-openh264` of `server-api.Host encoder policy and codec table`; the OpenH264 library itself is never in the package); the tailnet helper executable of `desktop-app.Desktop tailnet proxy helper`, and, beside the server, the ingress helper executable of `server-api.Product listeners and path restriction`, both code-signed with the app; on macOS, where the package is one universal `.dmg`, every bundled executable — Node, FFmpeg, FFprobe, the tailnet helper and the ingress helper — is a universal binary (arm64 and x64), and on Windows and Linux each package carries the executables of its own architecture; the Noto Sans JP subset of `design-system.Typography tokens` in the Linux packages; the archify CLI of the fork package `packages/archify`, packaged with the server at the commit pinned by `workflow-diagram.Archify fork package`; bundled fonts; and `THIRD_PARTY_NOTICES.md` together with OpenClaw's unmodified licence and notices files, both reachable from Personal ▸ About ▸ "Open-source licences". Native add-ons and executables are unpacked from the archive. The package formats, signing, notarisation and update behaviour are owned by `updates-distribution.Desktop packaging targets` and `updates-distribution.Desktop code signing and notarisation`. The app SHALL check at startup that the bundled Node, the server entry, the Gateway's `openclaw.mjs` entry and FFmpeg exist and are executable; a missing Node, server or Gateway runtime yields a blocking dialog "The installation is incomplete — reinstall JAgentChill", and a missing FFmpeg yields a non-blocking warning and the supervisor state `degraded`, with host export and host proxy generation disabled; a missing tailnet helper or ingress helper executable yields a non-blocking warning, and the "Tailnet" and "Local network (encrypted)" levels and tailnet-only hosts show "Unavailable — reinstall JAgentChill". [JAD] [NEW]

#### Scenario: Licences reachable
- **WHEN** the user opens Personal ▸ About ▸ "Open-source licences"
- **THEN** the notices including OpenClaw, OpenCut classic, archify, its embedded font and FFmpeg are displayed

#### Scenario: FFmpeg missing
- **WHEN** the bundled FFmpeg binary is absent at startup
- **THEN** the app starts, a warning explains that host export and proxy generation are unavailable, the supervisor state is `degraded` and on-device export still works

#### Scenario: Gateway runtime missing
- **WHEN** the bundled Node runtime is absent at startup
- **THEN** the blocking dialog is shown and no Gateway start is attempted

### Requirement: Desktop accessibility and input integration
The desktop app SHALL keep Chromium's accessibility tree enabled for assistive technologies (VoiceOver, NVDA, JAWS, Orca), honour the OS reduce-motion, high-contrast and accent-independent settings as defined in `i18n-accessibility.Reduced motion and flashing` and `i18n-accessibility.Colour contrast`, support the keyboard media keys (the play/pause media key toggles playback when an editor window is focused and nothing else is playing media), support trackpad pinch to zoom the timeline or the player under the pointer and two-finger horizontal scroll to scroll the timeline, and support pen and touch input on touch-screen computers (on macOS, Windows and Linux alike) at compact-touch density when the primary pointer is coarse (`design-system.Control size tokens and density rules`; the form factor still follows the window width). Spell checking in text fields uses the OS dictionaries for the active UI language and is off for monospace and code fields. [NEW]

#### Scenario: Trackpad pinch on the timeline
- **WHEN** the user pinches on the timeline with a trackpad
- **THEN** the timeline zooms around the pointer position

#### Scenario: Media key
- **WHEN** an editor window is focused and the user presses the keyboard's play/pause media key
- **THEN** editor playback toggles
