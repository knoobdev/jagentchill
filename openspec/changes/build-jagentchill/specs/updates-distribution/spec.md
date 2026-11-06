## ADDED Requirements

### Requirement: Minimum operating system versions
This requirement owns the minimum platform versions of the product; no other capability states one. Desktop: macOS 12, Windows 10 version 1809, Linux with glibc 2.35. Mobile, as the working defaults of design D4 pending spike S6: iOS and iPadOS 26.0 (the first WebKit line with audio WebCodecs and WebGPU, to be confirmed inside the engine view), and Android 12 (API level 31) with an Android System WebView whose Chromium version is at least the value pinned in `docs/TOOLCHAIN.md` (working value 121). Web: a browser that provides a secure context with WebCrypto Ed25519, WebAssembly, WebCodecs `VideoDecoder` and `AudioDecoder`, and WebGPU or WebGL2; the app checks these capabilities at start and does not parse user-agent strings; the supported-browser list shown on the blocking screen and in the product documentation names the current Chromium-based browsers (Chrome, Edge), Safari and Firefox at the versions that pass that check, and marks a browser that failed spike S19 (`diagnostics-quality.Gating spikes`, `workflow-diagram.Renderer spike S19 and fallback renderer`) as "unsupported for canvas editing": in it the workflow canvas opens as the read-only outline view and every other part of the app works. The result of spike S6 (`diagnostics-quality.Gating spikes`; the matrix and its per-row consequences are in `mobile-editor.WebView capability spike matrix`), recorded in `docs/decisions/`, SHALL fix the final mobile values and the pinned Android System WebView version: a platform that fails a blocking row of the D4 matrix has its minimum raised to the first version that passes, and this requirement and the store metadata are updated in the same change. An Android device at or above API 31 whose System WebView is below the pinned version SHALL show a blocking screen "Update Android System WebView" with a button that opens its store page, and SHALL keep project browsing available. On iOS and iPadOS the engine's WebKit is part of the operating system, so the equivalent gate is the OS minimum itself: a device below it is not offered the app by the store, and a device that passes the minimum and still fails a capability check at start shows the blocking screen "Update iOS to use the editor" with a button that opens Software Update, likewise keeping project browsing available. On desktop the engine runs in the bundled Chromium, identical on macOS, Windows and Linux, so no such screen exists there. [NEW]

#### Scenario: Supported phone with an old WebView
- **WHEN** the app starts on Android 13 with System WebView 118 while the pinned minimum is 121
- **THEN** the editor shows "Update Android System WebView" with the store button and no project is opened in the engine

#### Scenario: iPhone failing a capability check
- **WHEN** the app starts on an iPhone at the minimum iOS version and `AudioDecoder` is absent in the engine view
- **THEN** the editor shows "Update iOS to use the editor" with the Software Update button and the project list stays usable

#### Scenario: Browser lacking a capability
- **WHEN** the web app starts in a browser without `AudioDecoder`
- **THEN** a blocking screen lists the missing capability and the supported browsers, and no user-agent string was inspected to decide it

#### Scenario: Spike raises a minimum
- **WHEN** the S6 record shows that row 5 of the matrix (AAC decode) fails on iOS 26.0 and passes on 26.1
- **THEN** the same pull request sets the iOS minimum to 26.1 here and in the app configuration

#### Scenario: Minimum stated elsewhere
- **WHEN** another capability's spec states an operating-system minimum as a number
- **THEN** `pnpm jagentchill:check:coverage` fails with `minimum OS stated outside updates-distribution`

#### Scenario: Browser unsupported for canvas editing
- **WHEN** the S19 record says `fail` for Safari and a user opens a workflow in Safari
- **THEN** the supported-browser list marks Safari "unsupported for canvas editing", the workflow opens in the read-only outline view, and the editor, chat and export work

### Requirement: Desktop packaging targets
The desktop app SHALL be packaged for the desktop minimums of `updates-distribution.Minimum operating system versions`: macOS as a universal (arm64 + x64) `.dmg` and `.zip`; Windows as an NSIS installer for x64 and arm64 (per-user install, no administrator rights required); Linux as an AppImage, a `.deb` and an `.rpm` for x64 and arm64. Each package SHALL bundle: the web export of the app; one Node runtime satisfying `>=24.16.0 <25 || >=26.1.0`, used to run JAgentChill Server and, by the server, the Gateway (never Electron's own executable as Node); JAgentChill Server (`@jagentchill/server` with its `jagentchill` command, its production dependencies and `@openclaw/gateway-client` at exactly the pinned version); the OpenClaw Gateway built from the pinned tag of `gateway/OPENCLAW_VERSION`, installed intact and unmodified — its file list and file hashes equal those of a build of the pristine tag on the same platform, and it contains no JAgentChill file, plugin or patch (`platform-skeleton.Allowed upstream patch list`) — together with OpenClaw's own licence and notices files; FFmpeg and FFprobe as LGPL builds for the target platform (checked at build time: no `--enable-gpl`, no `--enable-nonfree`) in the two variants of `server-api.Host encoder policy and codec table` — the primary build with libvpx, SVT-AV1, libopus, native AAC and the platform's hardware encoder interfaces (VideoToolbox on macOS; Media Foundation, NVENC, Quick Sync and AMF on Windows; VA-API, NVENC and Quick Sync on Linux), which starts with no optional library present, and `ffmpeg-openh264`, linked against the shared OpenH264 library and used only after that library was installed by an admin; the OpenH264 library itself is never inside a package (no software HEVC encoder is included; HEVC on a host comes only from a hardware encoder); the ingress helper binary (tailnet and LAN listeners) and the desktop tailnet proxy helper for that platform and architecture; and nothing extra for the render host, because the render host is the app's own Electron executable started with `--render-host`. Every package SHALL register, by the mechanism of its platform (macOS `Info.plist` URL types and document types; Windows per-user registry classes written by the installer; Linux `.desktop` entry with `x-scheme-handler` and a shared-mime-info package, installed by the `.deb` and `.rpm` packages and written per user by the AppImage at first launch and whenever its path changes, as owned by `desktop-app.Deep links`), the `jagentchill://` URL scheme and the file types of `app-shell-navigation.Deep links and file types`, and SHALL remove them on uninstall (for the AppImage: through "Erase device data"). The packaging job SHALL run, for each of the nine platform and architecture packages and in a clean virtual machine or container without a GPU, the test `ffmpeg-openh264-split`: the primary FFmpeg starts and encodes VP9 and AV1 with no OpenH264 library present; `ffmpeg-openh264` is not resolved until the library file is placed; with a test copy of the library placed it encodes H.264; and removing the library returns the codec table to `download_required` without breaking the primary build. The first-run dialog that offers the OpenH264 download is the same on macOS, Windows and Linux and is never shown at export time. [NEW]

#### Scenario: Fresh install on each platform
- **WHEN** the package is installed on a clean supported machine with no Node, FFmpeg, Tailscale or OpenClaw present
- **THEN** on macOS, on Windows and on Linux the app launches, its server and the Gateway the server supervises start, health reports `ok` with the features `remote-render` and `remote-export` true, and a local export completes
- **AND** on a machine with no hardware H.264 encoder the codec table reads `h264: download_required` until an admin accepts the OpenH264 notice, while a host export in VP9 + Opus (WebM) completes at once

#### Scenario: Unsupported OS version
- **WHEN** the installer runs on macOS 11 or Windows 10 version 1803, or the AppImage, `.deb` or `.rpm` is started on a Linux system with glibc 2.31
- **THEN** it stops with a message naming the minimum supported version and installs or starts nothing

#### Scenario: Deep link after install
- **WHEN** a `jagentchill://pair` link is opened in a browser on macOS, Windows and Linux after installing the package for that platform
- **THEN** the desktop app comes to the front on the pairing screen on each of the three

#### Scenario: Bundled runtime is a real Node
- **WHEN** the server process started by the app and the Gateway process started by the server are inspected
- **THEN** the executable of each is the bundled Node binary and not the Electron binary

#### Scenario: Bundled Gateway is pristine
- **WHEN** the file list and hashes of the bundled Gateway are compared with a build of the pinned tag made from a fresh pull on the same platform
- **THEN** there is no added, removed or changed file, and no file of JAgentChill — no plugin directory, no `docs/research/`, `docs/stories/` or `openspec/` file — is inside it

### Requirement: Desktop code signing and notarisation
macOS builds SHALL be signed with a Developer ID Application certificate with the hardened runtime enabled, notarised and stapled; Windows builds SHALL be Authenticode-signed with SHA-256 and timestamped; Linux artifacts SHALL be accompanied by a detached signature and a SHA-256 checksum file. Every nested executable (Node, both FFmpeg builds, FFprobe, the ingress helper and the proxy helper, native modules) SHALL be signed. The release workflow SHALL fail when any artifact is unsigned or notarisation is rejected, and signing credentials SHALL exist only as CI secrets. [NEW]

#### Scenario: Gatekeeper
- **WHEN** the `.dmg` is downloaded with a browser on macOS and the app is opened
- **THEN** it launches without an "unidentified developer" or "damaged" dialog, and `spctl --assess` reports `accepted`

#### Scenario: SmartScreen and Linux verification
- **WHEN** the Windows installer is downloaded with a browser and run, and the Linux `.deb` is checked against its detached signature and checksum file
- **THEN** Windows shows the publisher name from the Authenticode signature with no "unknown publisher" block, and the Linux signature and checksum verify

#### Scenario: Unsigned nested binary
- **WHEN** the bundled ingress helper binary is not signed
- **THEN** the release workflow fails at the verification step and publishes nothing

### Requirement: Desktop automatic update
The desktop app SHALL use `electron-updater` against the feed URL fixed at build time. It SHALL check 30 seconds after launch and every 6 hours while running, and on "Check for updates" in the app menu and the Updates page of personal settings (which needs no host). A newer version SHALL be downloaded in the background with differential download where the platform supports it, verified against the publisher signature and the feed's SHA-512, and then announced with a non-modal banner "Version X is ready" offering "Restart to update" and "Remind me in 4 hours". The app SHALL never restart by itself while a project has unsaved operations, an export or job is running on this computer, a terminal is open, or a recording is in progress; in those cases the update SHALL install on the next quit. Settings SHALL offer "Check for updates automatically" and "Automatically download updates" (both default on). There is exactly one release channel: every published build is a complete release, and no channel selector, no "Stable" / "Preview" choice and no pre-release label exists in the product or in its settings. This flow is the same on macOS, on Windows and for the Linux AppImage; for Linux `.deb` and `.rpm` installs, and on any of the three systems wherever the install location is not writable, the banner SHALL instead link to the download. The notification kinds are those of `notifications.Notification event catalogue`: `update.available` is raised on that device when a newer version is found while "Automatically download updates" is off, and `update.ready` when a downloaded update is ready to install; both are device-local. [NEW]

#### Scenario: Update found and applied
- **WHEN** a newer version is published and the app has been running for 6 hours
- **THEN** it downloads in the background, the banner appears, and "Restart to update" relaunches into the new version with open projects restored

#### Scenario: Export in progress
- **WHEN** the user chooses "Restart to update" while an export is running
- **THEN** a dialog offers "Update when the export finishes" and "Cancel", and no restart happens during the export

#### Scenario: Tampered download
- **WHEN** the downloaded file's signature or hash does not verify
- **THEN** the file is deleted, no install occurs, a local log entry `update_verification_failed` is written, and the next scheduled check retries

#### Scenario: Offline
- **WHEN** the update check cannot reach the feed
- **THEN** no error dialog is shown, the Updates page shows "Unable to check for updates" with the time of the last successful check, and the next check runs on schedule

#### Scenario: Automatic download disabled
- **WHEN** "Automatically download updates" is off and a newer version exists
- **THEN** the banner reads "Version X is available" with a "Download" action and nothing is downloaded before the user chooses it

#### Scenario: No channel control
- **WHEN** the Updates page is inspected
- **THEN** it has no channel selector and no build is labelled as a pre-release

### Requirement: Desktop update rollback
Before installing an update the app SHALL keep the previous version's package. Readiness is decided by the main process: a launch is "ready" when the main window was shown and the host supervisor of `desktop-app.Gateway process supervision` reached state `ready` or `degraded` within 60 seconds. The main process SHALL keep a persisted counter of consecutive unready launches of the current version; on the launch after 2 unready ones it SHALL show, before creating the main window, a native dialog "Version X did not start correctly. Go back to version Y?" whose confirmation reinstalls the kept package and pauses automatic download of version X. User data SHALL be forward-migrated only after the new version reached the ready state, with the pre-migration backups defined in `server-api.Host schema migrations` and `project-storage.Backup before migration`. [NEW]

#### Scenario: Broken update
- **WHEN** a new version fails to become ready on two consecutive launches
- **THEN** the third launch shows the native rollback dialog before any window, and confirming it restores the previous version with all projects opening unchanged

#### Scenario: Skipped version not re-offered
- **WHEN** the user rolled back from version X
- **THEN** version X is not downloaded again automatically, and the Updates page shows "Version X was skipped" with "Try again"

#### Scenario: Degraded host counts as ready
- **WHEN** the new version shows its window and the built-in host is `degraded` because FFmpeg is missing or because its Gateway is still starting
- **THEN** the launch counts as ready and no rollback is offered

### Requirement: Gateway update with the desktop app
JAgentChill Server, the OpenClaw Gateway it supervises, the Node runtime, the render host, both FFmpeg builds and the ingress helper SHALL be versioned and shipped inside the desktop package and SHALL be updated only by updating the desktop app. Before quitting for an update the app SHALL stop the built-in host (the server, which stops its Gateway) by the prepared-shutdown sequence of `server-api.Service lifecycle` (`jagentchill.diagnostics.shutdown.prepare`, up to 10 seconds, then process-tree termination), identical on macOS, Windows and Linux, during which the server persists its queue and leases (`server-api.Job cancellation and restart recovery`). An installed OpenH264 library lives in the server's data directory and survives the update, as do the server's data, its secrets and the Gateway state directory; it is re-verified against the new release manifest and re-downloaded only when the pinned version changed and the acceptance is still recorded. On relaunch the app SHALL start the new server, which migrates its own data, starts the new Gateway and itself runs `openclaw doctor --fix --yes --non-interactive` once when the Gateway exits with code 78 (`server-api.Gateway supervision and lifecycle`); the app treats the host as ready only when `GET /jagentchill/v1/health` answers, the app's own channel P reached `ready` and the server reports its Gateway ready (readiness detection is owned by `desktop-app.Gateway process supervision`). Running jobs SHALL resume after the update per the same recovery requirement. [NEW]

#### Scenario: Update with a queued job
- **WHEN** the app updates while a generation job is polling a provider
- **THEN** after relaunch the job continues polling the same remote task and completes

#### Scenario: Config migration needed
- **WHEN** the new Gateway exits with code 78 on first start
- **THEN** the server runs the doctor fix once and restarts the Gateway, and the app shows "Finishing update…" until the host is ready

#### Scenario: Gateway fails to start after update
- **WHEN** the server does not start, or reports its Gateway `config_invalid` after the doctor fix and one retry
- **THEN** the app shows "The host on this computer failed to start" with "View log", "Retry" and the rollback offer; local editing remains available

### Requirement: Headless Gateway distribution and update
For operators running a host without the desktop app, each release SHALL publish (a) a container image built from `deploy/` that contains JAgentChill Server, the built and unmodified OpenClaw Gateway of the pinned tag, one Node runtime for both, the render host (the same Electron binary with its system libraries, started with `--render-host` on the headless display platform, as required for the flags `remote-render` and `remote-export`), both LGPL FFmpeg builds and FFprobe (the primary build encodes VP9, AV1 and Opus with no further download), the ingress helper, `bash`, `git`, `git-lfs` and `openssh-client`, starts with `jagentchill serve` as its entry point (the server then starts the Gateway with the run-profile environment; the image never starts the Gateway directly), runs as an unprivileged user (uid 1000), sets `JAGENTCHILL_CONTAINER=1`, honours `JAGENTCHILL_ACCEPT_OPENH264=1` (the operator's acceptance of the OpenH264 notice, upon which the library is fetched once at start; without it H.264 stays `download_required` and nothing is fetched), is published for linux/amd64 and linux/arm64, and declares the volumes `/data` (the server's data directory, with the Gateway state inside it) and `/workspace`; and (b) a host archive `jagentchill-host-<version>-<os>-<arch>` for macOS, Windows and Linux on arm64 and x64, containing the same server, built Gateway, Node runtime, FFmpeg builds and ingress helper, with the `jagentchill` command as its entry. No distribution asks the operator to install OpenClaw separately, and none installs anything into an existing OpenClaw. A host-archive install has no render host unless the operator sets `renderHost.path`, and therefore advertises `remote-render` and `remote-export` as false. `docs/HEADLESS.md` SHALL document install, run profile, first pairing with `jagentchill pair`, tailnet enablement with `jagentchill tailnet up`, LAN enablement with `jagentchill lan up` (the container publishes only the LAN listener port, never the server's loopback port and never the Gateway's native port), encoder setup with `jagentchill encoders install openh264 --accept`, backup and update, with the same commands for a host run from the archive on macOS, Windows or Linux. Updating SHALL consist of stopping the server (`jagentchill stop`, which stops its Gateway), replacing the image or the archive, and starting it; the server SHALL migrate its data on start and start the new Gateway on the kept state directory. `jagentchill.settings.host.get` SHALL report `serverVersion`, `openclawVersion` and `latestKnownVersion` (populated only when update checks are enabled), and devices holding `jagentchill.config.write` SHALL see "Host update available" with a link to the steps, raised as the notification kind `host.update_available` of `notifications.Notification event catalogue`; clients SHALL never update a headless host themselves. [NEW]

#### Scenario: Container update
- **WHEN** the operator replaces the container image with a newer release using the same `/data` volume
- **THEN** the server migrates its database on start, starts the new Gateway, health is `ok`, and paired devices reconnect without pairing again

#### Scenario: Image can export
- **WHEN** the released image is started with default settings
- **THEN** the render host probe passes (on a machine without a GPU as `{ backend: "webgl2", software: true }`), `remote-export` is true, the codec table reads `vp9` and `av1` `available` and `h264` `download_required`, and an export job with no codec stated completes as VP9 + Opus in WebM

#### Scenario: Image with OpenH264 accepted
- **WHEN** the image is started with `JAGENTCHILL_ACCEPT_OPENH264=1` and the download host is reachable
- **THEN** `h264` becomes `available` without any prompt, and with the host unreachable it stays `download_required` with reason `egress_blocked` while VP9 export keeps working

#### Scenario: Archive install without a render host
- **WHEN** the host archive is installed on a machine and no `renderHost.path` is set
- **THEN** `remote-export` is false and clients show "This host cannot export" on the remote export option

#### Scenario: Admin sees the notice
- **WHEN** a newer host release exists and update checks are enabled
- **THEN** admin clients show "Host update available" and other clients show nothing

#### Scenario: Image starts the server, not the Gateway
- **WHEN** the released image is started and its process tree is listed
- **THEN** the entry process is JAgentChill Server, the Gateway is its child bound to loopback, and only the LAN listener port is published when that level is enabled

### Requirement: Mobile store distribution
The mobile app SHALL be distributed as a signed App Store build and a signed Google Play build (Android App Bundle) for the mobile minimums of `updates-distribution.Minimum operating system versions`, plus a signed APK attached to each release. Build numbers SHALL increase monotonically. Native builds SHALL be produced by CI with EAS build profiles `development`, `preview` and `production` (build-profile names of the tooling, not release channels of the product). The app's `runtimeVersion` SHALL change whenever native code or native dependencies change, including the native modules `JagentchillEngineView`, `JagentchillCrypto`, `JagentchillTransport` and `JagentchillTailnet`. The build SHALL register the `jagentchill://` URL scheme and the file types of `app-shell-navigation.Deep links and file types` on both platforms (iOS: `CFBundleURLTypes` and document types; Android: intent filters), and SHALL declare: the camera, microphone, photo-library, notification and local-network usage descriptions; on iOS the transport-security exception for local networking only, and on Android a network security configuration that permits cleartext only to loopback, because tailnet traffic is dialled through the embedded node's loopback proxy and LAN traffic is always `wss` with a pinned certificate (there is no plaintext LAN option); and, as build-time prerequisites, the publisher's push credentials (APNs and FCM), used only when a user enables push, with the push token as the only identifier sent. [NEW]

#### Scenario: Production build
- **WHEN** the release workflow runs for a tag
- **THEN** it produces an `.ipa` and an `.aab` signed with the production credentials and a signed `.apk`, each with a build number higher than the previous release

#### Scenario: Unsupported OS
- **WHEN** a device runs Android 11, or an iPhone runs an iOS version below the minimum
- **THEN** neither store offers the app, and sideloading the APK on the Android device fails with the OS minimum-version message

#### Scenario: Pairing link on both mobile platforms
- **WHEN** a `jagentchill://pair` link is opened on an iPhone and on an Android phone with the app installed
- **THEN** the app opens on "Add a host" with the offer filled in on both

#### Scenario: Cleartext limited to loopback
- **WHEN** app code on Android or iOS attempts `http://192.168.1.20:18910/` through the platform HTTP stack
- **THEN** the request is blocked by the platform's transport policy

### Requirement: Mobile over-the-air updates
JavaScript and asset updates for mobile SHALL be delivered with `expo-updates` from static, pre-generated manifests on the publisher's own feed host at `<feed>/ota/<runtimeVersion>/<platform>/` (no hosted update service), signed with the project's code-signing certificate and accepted only when the signature verifies and the update's `runtimeVersion` equals the installed binary's. The request SHALL carry only these protocol headers — protocol version, platform, runtime version, current update id — and no per-install, device or account identifier; a network test in the release workflow SHALL assert this, and when the library cannot be configured to omit an install identifier, over-the-air delivery SHALL be disabled in the build and mobile updates ship through the stores only. The app SHALL check on cold start and when returning to the foreground at most once per hour, download in the background, and apply the update on the next cold start; it SHALL NOT reload while a project is open. If an update fails to render its first screen within 10 seconds of start, or the app crashes within 10 seconds of start, the app SHALL roll back to the previous update or the embedded bundle and SHALL not retry that update id. A change that needs new native code SHALL be shipped only as a store build, and the app SHALL show "Update from the store to get the latest version" when the Gateway requires a newer protocol than any update for its runtime provides. [NEW]

#### Scenario: OTA applied on next start
- **WHEN** an update is published and the app is brought to the foreground
- **THEN** the update downloads in the background and is active after the next cold start, without interrupting the open project

#### Scenario: Bad signature
- **WHEN** an update manifest fails signature verification
- **THEN** it is discarded and the running bundle is unchanged

#### Scenario: Crash on launch after update
- **WHEN** a newly applied update crashes 4 seconds after start
- **THEN** the next launch runs the previous bundle and the failed update id is not downloaded again

#### Scenario: Runtime mismatch
- **WHEN** the published update targets a different `runtimeVersion`
- **THEN** the app ignores it

#### Scenario: Request headers
- **WHEN** an update check from the mobile app is captured
- **THEN** it contains the four listed protocol headers and no header or query parameter that identifies the installation

### Requirement: Web origins
The web app SHALL run only in a secure context, on an origin that serves no other script-bearing content (`server-api.Web origin isolation`), and the supported origins SHALL be exactly: (a) `http://localhost:<port>` or `http://127.0.0.1:<port>` served by JAgentChill Server on the same machine; (b) an `https` origin with a browser-trusted certificate that fronts a host — the tailnet name of the host (`https://<node>.<tailnet>.ts.net`, served by the tailnet listener when the tailnet issues certificates), the LAN listener once an admin installed a browser-trusted certificate for it (`server-api.Product listeners and path restriction`), or a reverse-proxy origin the operator added to `http.allowedOrigins` and `http.allowedHosts`; (c) a static `https` origin on which the operator deployed the release artifact `jagentchill-web-<version>.zip`, from which the app edits locally and connects to hosts over `wss` addresses with browser-trusted certificates, after an admin of each host added that origin to its `http.allowedOrigins` (a host admits only its own origins, loopback origins and that list; otherwise the app shows `GATEWAY_UNREACHABLE` with reason `origin_not_allowed`, `device-pairing-signing.Web clients and the tailnet`). There is no vendor-hosted instance of the web app, and a browser can never be the host (proposal Non-goals): agent, workflow, film, generation and sync features need a host running the desktop app (macOS, Windows or Linux) or a headless Gateway. A request for `/jagentchill/app/` that reaches the server over plain HTTP with a non-loopback `Host` SHALL be answered with a static page "Open this host over HTTPS or on this computer" that names the HTTPS address when one exists and links to `docs/REMOTE-WEB.md`; the app shell itself, loaded in a non-secure context by any other means, SHALL show the same blocking message and start no editor code. Host settings SHALL have a "Web access" card that lists `http.allowedOrigins` (editable with `jagentchill.config.write`) and, per Network access level, whether a browser can connect and by which address, each usable address with a reachability check:

| Level | Browser on this computer | Browser on another computer |
|---|---|---|
| "This computer only" | yes — `http://127.0.0.1:<port>/jagentchill/app/`; pairs with the link or short code of the offer sheet | no |
| "Tailnet" | yes | yes when the computer runs Tailscale on the same tailnet AND the tailnet issues HTTPS certificates (`https://<node>.<tailnet>.ts.net`); otherwise "Turn on HTTPS certificates for your tailnet" with a link to the help page |
| "Local network (encrypted)" | yes | only with an installed browser-trusted certificate; otherwise the row reads "Browsers on other computers cannot use this level. Use the desktop app, or install a trusted certificate." (the pinned self-signed certificate is for the native apps) |

The card and its sentences are the same on macOS, Windows and Linux hosts and in every client. [NEW]

#### Scenario: Localhost
- **WHEN** a browser on the Gateway's machine opens `http://127.0.0.1:18910/jagentchill/app/`
- **THEN** the app loads, `isSecureContext` is true and pairing is available at the default Network access level

#### Scenario: Plain HTTP on a LAN address
- **WHEN** a browser requests `/jagentchill/app/` over plain HTTP with a LAN `Host`
- **THEN** the response is the static page "Open this host over HTTPS or on this computer" and no application script is served

#### Scenario: Tailnet HTTPS name
- **WHEN** the tailnet level is enabled with certificates and a browser on a tailnet machine opens the host's `https://<node>.<tailnet>.ts.net/jagentchill/app/`
- **THEN** the app loads in a secure context and the "Web access" card lists that address as reachable

#### Scenario: LAN level without a trusted certificate
- **WHEN** the level is "Local network (encrypted)" with the default certificate
- **THEN** the "Web access" card shows the sentence about browsers on other computers, and the offer sheet repeats it

#### Scenario: Static deployment
- **WHEN** the operator serves the web zip from their own `https` static host
- **THEN** local editing works with no host, pairing offers only `wss` addresses with trusted certificates as usable, and a host that has not listed the origin yields `origin_not_allowed` with the sentence naming the origin

### Requirement: Web build delivery
The web build SHALL be a static export served at the origins of `updates-distribution.Web origins`; the server SHALL serve it at `/jagentchill/app/` when `http.serveWebApp` is true (default true) through the static route listed in `server-api.Unsigned route exceptions`, which carries no user data, with hashed asset file names cached for 1 year (`Cache-Control: public, max-age=31536000, immutable`) and `index.html` served `no-cache` with the Content-Security-Policy of `security-privacy.Desktop and embedded web hardening`. The export SHALL include a web app manifest (name, short name, icons at 192 px and 512 px, `display: standalone`, theme and background colours from capability `design-system`), SHALL be installable as a PWA, SHALL send `X-Robots-Tag: noindex` and a `robots.txt` disallowing all crawling, and SHALL NOT include a sitemap or Open Graph marketing images. A service worker SHALL precache the app shell and wasm so the editor opens with no network after the first visit, and SHALL sign media requests as defined in `server-api.Authenticated media delivery`. The service worker SHALL check for a new version every 60 minutes and on navigation; when one is found the app SHALL show "A new version is available — Reload" and SHALL activate it only on reload, never while a project has unsaved operations. [PORT W-015] [NEW]

#### Scenario: Served by the host
- **WHEN** a browser opens `/jagentchill/app/` on a supported origin of the host
- **THEN** the app loads and `index.html` has `Cache-Control: no-cache`

#### Scenario: Offline reopen
- **WHEN** the web app was opened once and the browser is offline
- **THEN** the app shell loads and local projects open

#### Scenario: New deployment
- **WHEN** a new version is deployed while a tab is open
- **THEN** at the next 60-minute check or navigation the tab shows the reload notice, and the old version keeps working until the user reloads

#### Scenario: Crawler directives
- **WHEN** `/robots.txt` is requested
- **THEN** the body is `User-agent: *` followed by `Disallow: /`

### Requirement: Protocol version negotiation
`packages/protocol` SHALL export integer constants `PROTOCOL_VERSION` (starting at 1) and `MIN_PEER_PROTOCOL_VERSION`, defined as `max(1, PROTOCOL_VERSION − 2)`. The client SHALL send its `protocolVersion` and `minProtocolVersion` in the channel P `hello` frame and the Gateway SHALL answer with its own pair in `challenge` (`device-pairing-signing.Channel P handshake`); the connection's effective version SHALL be the lower of the two `protocolVersion` values, and when that value is below either side's minimum the Gateway SHALL close channel P with code 4426 and the close reason `PROTOCOL_UNSUPPORTED:client` or `PROTOCOL_UNSUPPORTED:gateway`, naming the side that is too old — the envelope has no error frame before `ready`, so the side travels in the close reason (on the fallback transport: in `error.details.side` of the HTTP 426 answer of the handshake route) and is also derivable from `GET /jagentchill/v1/health`, which reports the Gateway's pair so that a client can show the right message before connecting; a client that detects the mismatch from `challenge` closes by itself. `PROTOCOL_VERSION` SHALL be incremented only for a change that cannot be expressed additively. Channel P is the only wire protocol between a client and a host: clients do not speak OpenClaw's own wire protocol, so there is nothing else to negotiate; the server's in-process use of the core is pinned by the locked upstream tag and its contract tests (`diagnostics-quality.Gateway contract tests`). [JAD] [NEW]

#### Scenario: Older client, newer Gateway within range
- **WHEN** a client at protocol 3 with minimum 1 connects to a Gateway at protocol 5 with minimum 3
- **THEN** the connection runs at protocol 3

#### Scenario: Client too old
- **WHEN** a client at protocol 2 connects to a Gateway whose minimum is 3
- **THEN** channel P closes with 4426 and reason `PROTOCOL_UNSUPPORTED:client`, and the client shows "Update JAgentChill on this device" with the platform's update action
- **AND** local projects stay editable and synced projects show "Update required to sync"

#### Scenario: Gateway too old
- **WHEN** a client whose minimum is 4 connects to a Gateway at protocol 3
- **THEN** the client shows "Update the host" naming the host, and local editing remains available

#### Scenario: Minimum derivation
- **WHEN** `PROTOCOL_VERSION` is 6
- **THEN** `MIN_PEER_PROTOCOL_VERSION` is 4

### Requirement: Feature flags and additive wire evolution
The channel P `ready` frame SHALL include `features`, a map of flag names to booleans advertised by the Gateway, and the client SHALL send `capabilities`, a list of capability names it supports, in `hello` (client capabilities include `terminal-binary`; a client declares no OpenClaw capability, because it never speaks to the core). The registry of record for flag names and for the condition under which each is true is `server-api.Feature flag registry`; the list is `remote-render`, `remote-export`, `host-analysis`, `share-links`, `webhooks`, `push`, `connectors`, `multi-agent`, `terminal`, `workflows`, `scripts`, and a contract test asserts that the protocol constant `FEATURE_FLAGS` equals it. Each side SHALL gate optional behaviour on these values in one module, never on version strings: a client SHALL hide or disable the entry points of a feature whose flag is false or absent, with the reason from health where one exists, and SHALL send no method of that feature. Codec availability is not a flag: clients read the codec table of `server-api.Host encoder policy and codec table`. Every field added to an existing wire schema SHALL be optional; fields SHALL never be removed, renamed, narrowed or made required; enum values SHALL only be added, and receivers SHALL treat unknown enum values, unknown flags, unknown events and unknown address kinds as a defined `unknown` case without throwing. Every compatibility shim SHALL carry a comment `// COMPAT(<name>): added in v<version>, remove after <YYYY-MM-DD>`. A protocol compatibility test SHALL replay recorded fixtures of every previous supported protocol version's messages against the current schemas. [JAD] [NEW]

#### Scenario: Feature absent on an older Gateway
- **WHEN** a client connects to a Gateway whose `features` lacks `scripts`
- **THEN** the Scripts destinations show the requires-update state and no `jagentchill.script.*` method is sent

#### Scenario: Feature off on this host
- **WHEN** `features.terminal` is false
- **THEN** the Terminal tab shows "The terminal is turned off on this host" with, for an admin, the action to enable it

#### Scenario: Required field added by mistake
- **WHEN** a pull request adds a required field to an existing request schema
- **THEN** the protocol compatibility test fails because a recorded older fixture no longer validates

#### Scenario: Unknown enum value
- **WHEN** a client receives a job `kind` it does not know
- **THEN** it renders the job with a generic label and does not crash

#### Scenario: Flag list drift
- **WHEN** the protocol constant gains a flag that the registry requirement does not list
- **THEN** the contract test `feature-flags` fails and names the flag

### Requirement: Version display and compatibility status
The About page SHALL show the app version, build number, JAgentChill protocol version, and, for each paired host, its server version, OpenClaw version, protocol version, channel P transport (`ws` or `sse`), connection path and a compatibility status of "Compatible", "Update this device" or "Update the host". The same values SHALL be included in the diagnostics bundle. A "Copy version info" action SHALL copy them as plain text. Host ▸ Updates SHALL show only the host's versions and compatibility; app update settings live on the personal Updates page and need no host. [NEW]

#### Scenario: Copy version info
- **WHEN** the user chooses "Copy version info"
- **THEN** the clipboard holds one line per item listed above and no secret

#### Scenario: Host offline
- **WHEN** a paired host is unreachable
- **THEN** its row shows the last known versions with "Last seen <relative time>"

### Requirement: Release notes view
This requirement owns release-note content, data shape and card behaviour; the routes `/changelog` and `/changelog/[version]` that render it are owned by capability `app-shell-navigation`. Each release SHALL bundle its release notes as structured entries `{ version, date, title, summary, sections: { features[], improvements[], fixes[], breaking[], technical[] } }` localised in `en`, `vi` and `ja`. After the first launch of a new version the app SHALL show one dismissible "What's new in X" card on Home (bottom-left on desktop and web, 288 px wide; a full-width card above the project list on mobile) with the title, summary and the button "See what's new", which opens `/changelog/[version]`, and SHALL record the version as seen when the card is dismissed or the notes are opened. A first-ever install SHALL record the current version as seen silently and SHALL show no card. `/changelog` SHALL list all bundled versions newest first; a version view SHALL show its sections with `technical` collapsed under "Technical details", older/newer navigation and a "Copy as Markdown" button; About → "Release notes" links to `/changelog`. No release notes SHALL be fetched from a website. The first run of a version that has release notes raises the device-local notification kind `changelog.new_version` of `notifications.Notification event catalogue`, once per version. [PORT W-009] [NEW]

#### Scenario: Card after an update
- **WHEN** the app is updated from 1.2.0 to 1.3.0 and launched
- **THEN** the card for 1.3.0 appears once, and after dismissal it does not appear on subsequent launches

#### Scenario: First install
- **WHEN** the app is launched for the first time
- **THEN** no card is shown and the stored last-seen version equals the installed version

#### Scenario: Several versions skipped
- **WHEN** the user updates from 1.1.0 directly to 1.3.0
- **THEN** the card shows 1.3.0 and `/changelog` marks 1.3.0 and 1.2.0 as "New"

#### Scenario: Copy as Markdown
- **WHEN** the user chooses "Copy as Markdown" on the 1.3.0 view
- **THEN** the clipboard holds the version's title, date and sections as Markdown headings and lists

### Requirement: Update check privacy
Update checks SHALL request only static feed files and SHALL carry no device, installation or Gateway identifier and no usage data. Permitted request content is: on desktop, the feed path and a random cache-busting query value generated per request; on mobile, the four protocol headers of `updates-distribution.Mobile over-the-air updates`. "Check for updates automatically" (default on) governs every client and the Gateway's version notice; when off, nothing SHALL contact the feed except on an explicit "Check for updates". The feed host and the over-the-air path are rows of `security-privacy.Network egress control` and appear in the network activity view. [NEW]

#### Scenario: Checks disabled
- **WHEN** automatic checks are off and the app runs for 24 hours
- **THEN** no request to the feed host is made

#### Scenario: Desktop request contents
- **WHEN** a desktop update check is captured
- **THEN** the only query parameter is a random value that differs between two checks, and no header identifies the installation

### Requirement: Release artifacts and integrity
The release workflow SHALL run only on a version tag `jagentchill-v<semver>`, SHALL require the full gate of `diagnostics-quality.CI gates` to pass on the tagged commit, and SHALL publish for each artifact a SHA-256 checksum and a CycloneDX bill of materials, together with the update feed files, the over-the-air manifests, the web artifact `jagentchill-web-<version>.zip`, the container image, the host archives, the content bundle `jagentchill-content-<version>.zip` (every font and model file of the content manifest with its SHA-256, laid out as the content host serves it, for operators who mirror it per `security-privacy.Network egress control`) and the release notes. App version, server version and protocol package version SHALL be set from the tag. `THIRD_PARTY_NOTICES.md` and `THIRD_PARTY_NOTICES.md` SHALL be included in every package. The build-time value `JAGENTCHILL_DOWNLOAD_URL` names the page from which installers are downloaded; in-app prompts that point to a download (install the desktop app, link-to-download updates) use it and are not shown when it is unset. A release SHALL be reproducible from its tag: rebuilding the web export from the tag SHALL yield byte-identical JavaScript and wasm assets. The release workflow SHALL also enforce the size budgets that other capabilities set for shipped content and fail the release when one is exceeded, naming the artifact and the measured size: the bundled sound pack is at most 90 MB in every desktop package and at most 24 MB inside the iOS and Android app bundles (`audio-editing.Bundled sound pack`), and the host inference runtime `onnxruntime-node` adds at most 120 MB per desktop or server platform (`ai-editing-tools.Inference runtime`); every such component has its entry in `THIRD_PARTY_NOTICES.md` (`platform-skeleton.Licence and third-party notices`). For every desktop target (macOS arm64 and x64, Windows x64 and arm64, Linux x64 and arm64) the release workflow SHALL run the job `jagentchill-expected-encoders`, which starts the packaged app and the packaged server on that target and compares the encoders they report with the per-target table of `export-share.Encoder availability and licensing` (software H.264 in the desktop runtime per decision E13, VP9, AV1, AAC, Opus; hardware encoders where the runner has them); a missing expected encoder fails the release, and the release is also blocked until `docs/decisions/` holds the licence decision for the runtime's software H.264 encoder that the same requirement names. [NEW]

#### Scenario: Gate failure blocks release
- **WHEN** a tag is pushed on a commit whose golden-frame gate fails
- **THEN** no artifact and no feed file is published

#### Scenario: Version consistency
- **WHEN** the artifacts of tag `jagentchill-v1.4.0` are inspected
- **THEN** the desktop app, the mobile app, the web build, the container image and the server all report version 1.4.0

#### Scenario: Reproducible web assets
- **WHEN** the web export is rebuilt from the tag on a second CI runner
- **THEN** the SHA-256 of every `.js` and `.wasm` asset matches the published build

#### Scenario: No download URL
- **WHEN** the app was built without `JAGENTCHILL_DOWNLOAD_URL`
- **THEN** the "Install the desktop app" promo card is not shown

#### Scenario: Size budget exceeded
- **WHEN** the Android app bundle of a tagged build contains 27 MB of sound-pack files
- **THEN** the release workflow fails and names the sound pack, the 24 MB budget and the measured size

#### Scenario: Expected encoder missing on one target
- **WHEN** the packaged Linux arm64 app of a tagged build reports no software H.264 encoder while the table expects one
- **THEN** the job `jagentchill-expected-encoders` fails for that target and no artifact of the release is published

### Requirement: Upstream version bump discipline
A release SHALL be built on exactly the OpenClaw tag recorded in `gateway/OPENCLAW_VERSION` and `gateway/openclaw.lock.json`, and SHALL ship the Gateway built from that tag unmodified. Moving to a newer OpenClaw tag SHALL go through `platform-skeleton.Upstream merge procedure`, SHALL be a commit separate from product changes, and SHALL be mentioned in the release notes under "Improvements" with the old and new OpenClaw versions. The release workflow SHALL fail when the server's `@openclaw/gateway-client` version does not equal the pinned tag's version, when the packaged Gateway differs from a pristine build of the pinned tag, when the gateway contract suite of `diagnostics-quality.Gateway contract tests` did not pass on the tagged commit, or when a row of the capability matrix predates the pinned tag (`diagnostics-quality.Runtime contract tests and capability matrix`). [NEW]

#### Scenario: Client library mismatch
- **WHEN** `gateway/OPENCLAW_VERSION` is `v2026.10.2` and the server still pins `@openclaw/gateway-client` `2026.9.8`
- **THEN** the release workflow fails with `gateway client does not match the OpenClaw pin`

#### Scenario: Notes mention the bump
- **WHEN** a release includes a newer OpenClaw pin
- **THEN** its release notes contain an Improvements entry naming both OpenClaw versions
