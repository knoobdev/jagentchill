## ADDED Requirements

### Requirement: Identity model without accounts
JAgentChill SHALL have no user accounts, passwords, email sign-in or login screen. The identity of a client SHALL be its device key pair, and a client is trusted by a Gateway only after the pairing defined in this capability. The editor SHALL remain fully usable on a device that is paired with no Gateway; only features that need a Gateway (the table "Features that require a host" of capability `app-shell-navigation`) SHALL prompt for pairing. One client SHALL be able to hold pairings with up to 8 Gateways and SHALL keep them in a local host registry keyed by `gatewayId`, each entry holding `{ gatewayId, gatewayPublicKey, name, addresses[], preferredAddress, lastLanNetworkId?, role, verifiedClockOffset_ms, pairedAt_ms }`. In user-facing text a paired Gateway is called a "host"; "Gateway" is used in diagnostics and technical text only. [PORT N-011] [NEW]

#### Scenario: Editing without a host
- **WHEN** a user opens the app on a device with no paired Gateway and creates a project
- **THEN** the editor works and no sign-in or pairing prompt blocks it

#### Scenario: Host-dependent feature on an unpaired device
- **WHEN** the same user opens the chat agent
- **THEN** an empty state titled "Connect a host" is shown with the actions "Scan QR code", "Paste link" and "Enter code"
- **AND** no account form is shown

#### Scenario: Ninth host
- **WHEN** a device with 8 stored pairings accepts another offer
- **THEN** pairing is refused locally with the message keyed `PAIRING_HOST_LIMIT` and a link to the host list

### Requirement: Gateway identity key
On first start the server SHALL generate an Ed25519 key pair for the Gateway using the operating system CSPRNG and SHALL persist it; the key SHALL NOT change across restarts or updates. `gatewayPublicKey` on the wire SHALL be the base64url (no padding) encoding of the raw 32-byte public key, and `gatewayId` SHALL be the first 32 lowercase hexadecimal characters of the SHA-256 digest of those 32 bytes; this is deliberately a different format from `deviceId` (64 hexadecimal characters). The private key SHALL be stored as the owner-only secret file `GATEWAY_IDENTITY_KEY` of `security-privacy.Host secret storage` and SHALL never be sent to any client, logged, or included in a backup that does not include secrets. OpenClaw gives a client no proof of Gateway identity, so this key is the only Gateway authenticator of the product. Replacing the Gateway key (CLI `jagentchill rekey --yes`) SHALL delete every device record, close every channel P connection with code 4403, abort every agent turn that a device started, and cancel the live offer. [NEW]

#### Scenario: Stable identity
- **WHEN** the Gateway restarts
- **THEN** `GET /jagentchill/v1/health` reports the same `gatewayId` as before the restart

#### Scenario: Identifier derivation
- **WHEN** a client computes SHA-256 over the decoded `gatewayPublicKey` from an offer
- **THEN** the first 32 hex characters equal the offer's `gatewayId`

#### Scenario: Rekey
- **WHEN** the operator runs `jagentchill rekey --yes`
- **THEN** a new `gatewayId` is reported, every device record is removed, every channel P connection is closed with code 4403, and each client shows the host as "Pairing required"

### Requirement: Device key generation
Each client installation SHALL generate one Ed25519 key pair on first need, using the platform CSPRNG, and SHALL use that same key for every Gateway it pairs with; it holds a second key pair only while a rotation is pending for hosts that were unreachable (`device-pairing-signing.Device key rotation`). The key is used for exactly three things: the handshake transcript, the per-request HTTP signature and the rotation statement; a device never performs an OpenClaw `connect` and never holds an OpenClaw credential (design D7). `devicePublicKey` on the wire SHALL be base64url (no padding) of the raw 32-byte public key; signatures SHALL be base64url (no padding) of the raw 64-byte Ed25519 signature (pure Ed25519, no pre-hash). `deviceId` SHALL be the full 64-character lowercase hexadecimal SHA-256 of the raw 32-byte public key. The private key SHALL never be transmitted, exported, logged, written to a diagnostics bundle or synced. Key generation SHALL complete in 500 ms or less on the reference phones of `diagnostics-quality.Reference devices`. [JAD] [NEW]

#### Scenario: Key created once
- **WHEN** a device pairs with a first and then a second Gateway
- **THEN** both pairings use the same `devicePublicKey` and the same `deviceId`

#### Scenario: Identifier mismatch rejected
- **WHEN** a request presents a `deviceId` that is not the SHA-256 of the presented `devicePublicKey`
- **THEN** the Gateway rejects it with `DEVICE_ID_MISMATCH`

#### Scenario: Private key absent from diagnostics
- **WHEN** a diagnostics bundle is produced on a paired device
- **THEN** a byte search of the bundle finds neither the private key nor any device token

#### Scenario: Generation time on the reference phones
- **WHEN** the key is generated on the reference iPhone and on the reference Android phone
- **THEN** generation completes in 500 ms or less on each

#### Scenario: No OpenClaw credential on a device
- **WHEN** the protected storage of a paired phone, a paired desktop app and a paired browser is enumerated
- **THEN** it holds the device key and one device token per host, and no OpenClaw device token, shared Gateway token or setup code

### Requirement: Per-platform device key storage
The device private key SHALL be stored as follows, and the record of every device SHALL carry `keyProtection` with the value named for its case. **iOS/iPadOS** (`keychain`): a Curve25519 signing key generated with CryptoKit, stored as a Keychain generic-password item with accessibility `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, not synchronised to iCloud (the Secure Enclave has no Ed25519). **Android 13 or newer** (`keystore`): an Android Keystore Ed25519 key, non-exportable, hardware-backed when the device offers it. **Android 12** (`keystore-wrapped`): a key generated in native code and stored encrypted with a Keystore AES-256-GCM key, decrypted only inside the native module; both Android forms are excluded from cloud backup. **Desktop** (`os-store`): generated and held only in the Electron main process, encrypted at rest with Electron `safeStorage` — Keychain on macOS, DPAPI bound to the signed-in Windows user on Windows, the Secret Service (GNOME Keyring or KWallet) on Linux — and written to the app's user-data directory with file mode `0600` on macOS and Linux and an access-control list restricted to the current user on Windows; the renderer SHALL receive only the public key. **Web** (`webcrypto`): `device-pairing-signing.Web client key handling`. On mobile, the native module `JagentchillCrypto` SHALL expose `getPublicKey()`, `sign(kind, fields)`, `sha256File(path)` and `sha256Bytes(bytes)`, and private key bytes SHALL never enter the JavaScript heap. **Desktop without an OS secret store** (`file`): the store counts as unavailable when `safeStorage.isEncryptionAvailable()` is false and, on Linux, also when `safeStorage.getSelectedStorageBackend()` is `basic_text` or `unknown` (no keyring is running — common on minimal window managers, containers and remote sessions); on macOS and Windows this happens only when the OS store is damaged or blocked by policy. In that case the app SHALL NOT create a key silently: it SHALL show the dialog keyed `KEY_STORAGE_UNAVAILABLE`, which names the missing store for the platform ("No keyring is running on this computer (GNOME Keyring or KWallet)" on Linux; "Windows data protection is not available for this account" on Windows; "The login keychain is not available" on macOS) and offers "Try again" (after the user fixed the store), "Store the key in a protected file" and "Cancel". Only after the user chose "Store the key in a protected file" and confirmed the sentence "The key will be protected only by this account's file permissions" SHALL the main process write the key to `<userData>/identity/device.key` (mode `0600` in a `0700` directory on macOS and Linux; an ACL for the current user only on Windows), mark the installation `keyProtection: "file"`, and show a persistent notice "Device key stored in a file" in connection settings with the action "Move the key to the system store", which re-wraps the key (same key, same pairings) once a store is available. The same rule and the same strings apply to the device token. A key file SHALL never be written without that confirmation, on any platform, and never with wider permissions. The Gateway shows `keyProtection` per device in the device list and the security audit collector reports devices with `file` as `info`. [NEW]

#### Scenario: Desktop renderer cannot read the key
- **WHEN** renderer code enumerates every IPC channel and storage API available to it
- **THEN** it can obtain the public key and structured signatures, and no channel returns private key bytes

#### Scenario: Linux without a keyring
- **WHEN** the desktop app runs on Linux with no Secret Service and the user starts pairing
- **THEN** the dialog `KEY_STORAGE_UNAVAILABLE` names GNOME Keyring and KWallet, no key file exists yet, and "Cancel" leaves the local editor usable

#### Scenario: Confirmed file storage on Linux
- **WHEN** the user chooses "Store the key in a protected file" and confirms
- **THEN** `<userData>/identity/device.key` exists with mode `0600`, pairing continues, the host's device list shows "Key stored in a file" for this device, and connection settings show the persistent notice

#### Scenario: Windows uses the user's data protection
- **WHEN** the desktop app creates its key on Windows 10 or Windows 11
- **THEN** the stored blob is DPAPI ciphertext for the signed-in user, and copying the user-data directory to another Windows account yields a blob that cannot be decrypted there

#### Scenario: Moving the key to the system store
- **WHEN** a keyring becomes available and the user chooses "Move the key to the system store"
- **THEN** the key file is deleted after the wrapped copy was verified, `deviceId` is unchanged, every pairing keeps working, and the device list shows `os-store`

#### Scenario: Device restore from backup
- **WHEN** an iOS or Android device is restored from a cloud backup onto new hardware
- **THEN** the private key is absent, the app generates a new key, and each stored host shows "Pairing required"

#### Scenario: Android 12 key wrapping
- **WHEN** the app's private storage on an Android 12 device is dumped
- **THEN** the stored key blob is AES-256-GCM ciphertext and the raw private key is not present

### Requirement: Structured signing interface
On every platform the signer (native module, Electron main process, or the web signing module) SHALL accept only structured input `{ kind, fields }` with `kind` one of `handshake`, `request` and `rotate`, SHALL build the canonical string itself from the typed fields (`device-pairing-signing.Signed handshake transcript`, `device-pairing-signing.Per-request HTTP signature` and `device-pairing-signing.Device key rotation` respectively), and SHALL refuse anything else with `SIGN_REFUSED`. No interface SHALL sign a caller-supplied string or byte array. For `kind: "request"` the signer SHALL refuse a `gatewayId` that is not in the host registry, and for `kind: "handshake"` a `role` other than `device` or a `gatewayId` that is neither in the host registry nor the `gatewayId` of the offer being enrolled. `kind: "rotate"` takes `{ gatewayId }` and NO public key from the caller: the signer generates the new key pair inside the protected store (once per rotation; the same pending key is reused for every host), builds the rotation statement itself and returns only `{ newDevicePublicKey, ts, signatureByOldKey, signatureByNewKey }`; a caller cannot obtain the old key's signature over a key it chose. On desktop and mobile, `rotate` SHALL additionally require a user-presence confirmation raised by the main process or native module (a native dialog "Replace this device's key?"), which renderer or JavaScript code cannot answer. [NEW]

#### Scenario: Arbitrary string refused
- **WHEN** renderer script asks the desktop bridge to sign the string `hello`
- **THEN** the bridge answers `SIGN_REFUSED` and no signature is produced

#### Scenario: Request for an unknown Gateway
- **WHEN** code asks for a `request` signature naming a `gatewayId` absent from the host registry
- **THEN** the signer answers `SIGN_REFUSED`

#### Scenario: Gateway-role transcript refused
- **WHEN** code asks for a `handshake` signature with `role` `gateway`
- **THEN** the signer answers `SIGN_REFUSED`

#### Scenario: Rotation to a caller-chosen key refused
- **WHEN** compromised renderer script calls the signer with `{ kind: "rotate", fields: { gatewayId, newDevicePublicKey: <attacker key> } }`
- **THEN** the extra field is rejected with `SIGN_REFUSED`, and no signature over the attacker's key exists

#### Scenario: Rotation needs a person
- **WHEN** script asks for a `rotate` signature on the desktop app while nobody answers the native dialog
- **THEN** no key pair is generated and the call ends with `SIGN_REFUSED` after the dialog is dismissed or 60 seconds pass

### Requirement: Web client key handling
In a browser, the client SHALL create the device key with WebCrypto `generateKey` for algorithm `Ed25519` with `extractable: false` and SHALL store the resulting `CryptoKey` objects and the device tokens in IndexedDB database `jagentchill-identity`, bound to the page origin. Non-extractable is not non-usable: any script running on the same origin can open that database and sign with the key. The design therefore rests on origin isolation (decision A2): the web app SHALL be served only from an origin that serves nothing but the app's own static files and the `/jagentchill/` routes — the product listener of `server-api.Product listeners and path restriction`, the loopback origin of a profiled Gateway on which `server-api.Web origin isolation` holds (the server's listener serves nothing but the product paths; no Control UI, no canvas host documents and no HTML of an OpenClaw plugin share the origin), or an operator's static origin of `updates-distribution.Web origins` (c); the contract test `origin-exclusive` of that requirement is the evidence, and the app shell SHALL refuse to create or use a key when its start-up check `GET /jagentchill/v1/health` reports `originExclusive: false`, showing "This address also serves other pages. Open JAgentChill from its own address." The client SHALL call `navigator.storage.persist()` before pairing. The web client runs only in a secure context (`updates-distribution.Web origins`); when the browser lacks WebCrypto Ed25519 or the page is not a secure context, pairing SHALL be unavailable with the message keyed `WEBCRYPTO_UNSUPPORTED`, and no JavaScript-held extractable key SHALL be used as a substitute. When persistent storage is not granted, or the session is a private-browsing session, the pairing sheet SHALL show the warning "This browser can forget this device; you will then need to pair again". If the stored key is missing on a subsequent visit, the client SHALL treat every stored host as "Pairing required" and SHALL NOT reuse a stored device token. A browser gives script no way to pin a certificate, therefore a web client SHALL use only loopback `ws`/`http` addresses or `wss`/`https` addresses whose certificate the browser trusts, SHALL ignore `tlsSha256` pins, and SHALL report an offer that has no such address as `GATEWAY_UNREACHABLE` with reason `web_requires_trusted_tls`. A page served over `https` SHALL use only `wss` addresses. Which hosts a browser can reach is stated in `device-pairing-signing.Web clients and the tailnet`. Key rotation is not offered on web (`device-pairing-signing.Device key rotation`): the remedy for a browser that forgot its key, or whose storage is not persistent, is a new pairing. [NEW]

#### Scenario: Non-extractable key
- **WHEN** page script calls `crypto.subtle.exportKey` on the stored private key
- **THEN** the call rejects with `InvalidAccessError`

#### Scenario: Unsupported browser
- **WHEN** the web app runs in a browser whose WebCrypto rejects `Ed25519`
- **THEN** the pairing entry points show `WEBCRYPTO_UNSUPPORTED` with the list of supported browsers, and the local editor still works

#### Scenario: Site data cleared
- **WHEN** the user clears site data and reopens the app
- **THEN** a new key is generated on the next pairing and the previous device record on the Gateway shows as offline until an admin revokes it

#### Scenario: Offer with pinned addresses only
- **WHEN** a web client receives an offer whose only non-loopback address is `wss://192.168.1.20:18790` with a `tlsSha256` pin for the host's self-signed certificate
- **THEN** the pairing sheet shows `GATEWAY_UNREACHABLE` with the explanation "This browser needs a trusted HTTPS address for this host" and a link to the remote web access help

#### Scenario: Mixed content avoided
- **WHEN** an offer lists a `tailnet` entry `ws://jagentchill-ab12cd.tailnet.ts.net:18910` and a `tailnet` entry `wss://jagentchill-ab12cd.tailnet.ts.net` and the page origin is `https`
- **THEN** the client attempts only the `wss` address

#### Scenario: Origin shared with other pages
- **WHEN** the app shell is loaded from an origin whose health answer carries `originExclusive: false`
- **THEN** no key is generated or used, pairing is unavailable with the sentence above, and the local editor still works

### Requirement: Pairing offer format
A pairing offer SHALL be the URL `jagentchill://pair#offer=<payload>` where `<payload>` is base64url (no padding) of the UTF-8 JSON object with exactly these fields: `v` (integer, value `1`), `offerId` (base64url of 16 CSPRNG bytes), `gatewayId` (32 lowercase hex characters), `gatewayPublicKey` (base64url raw 32 bytes), `addresses` (array of 1 to 8 objects `{ kind, url, tlsSha256? }` where `kind` is `loopback`, `lan` or `tailnet` as defined by `device-pairing-signing.Address kinds and selection order`, `url` has scheme `ws` or `wss` and at most 255 characters, and `tlsSha256` is the 64-hex SHA-256 of the DER certificate for a pinned `wss` URL), and `expires_ms` (Unix UTC milliseconds). `offerId` is not a credential: it admits a device to ask for pairing and nothing else. The offer SHALL contain no secret, token, verification code or device information, SHALL NOT be or embed OpenClaw's setup code (which carries a bearer credential), and SHALL live in the URL fragment so that it is never sent to a web server. The same payload is accepted by the web app as `https://<origin>/jagentchill/app/#/pair/link?offer=<payload>` — the form shown as the "link" at the "This computer only" level, where the `jagentchill://` scheme cannot reach a browser tab. The whole URL SHALL be at most 1 024 characters. An offer SHALL expire 600 000 ms after creation. At most 1 offer SHALL be live per Gateway: creating a new offer cancels the previous one and its pending requests. An offer can carry a preset role, stored on the Gateway against `offerId` and not in the payload. [JAD] [NEW]

#### Scenario: Offer round trip
- **WHEN** a client decodes a freshly created offer
- **THEN** it obtains exactly the six fields above, `v` is 1, and `expires_ms` is 600 000 ms after the Gateway's creation time

#### Scenario: Offer carries no secret
- **WHEN** an offer is created while a pairing request with a verification code is pending
- **THEN** the decoded offer contains neither the code nor any token or credential field

#### Scenario: Malformed offer
- **WHEN** a client receives a payload that is not valid base64url JSON or lacks a required field
- **THEN** it shows the message keyed `OFFER_INVALID` and makes no network connection

#### Scenario: Unknown version
- **WHEN** the decoded offer has `v` 2
- **THEN** the client shows `OFFER_VERSION_UNSUPPORTED` with an "Update the app" action and makes no network connection

#### Scenario: Superseded offer
- **WHEN** an admin creates a second offer while a device is half-way through enrolment on the first
- **THEN** that device's next enrolment call answers `OFFER_EXPIRED` and its pending request is cancelled

### Requirement: Offer addresses and reachability
The Gateway SHALL build `addresses` only from listeners that are actually serving, each entry carrying its kind (`device-pairing-signing.Address kinds and selection order`); every non-loopback entry names a product listener of `server-api.Product listeners and path restriction`, never the Gateway's native port, which stays bound to loopback at every level. The entries are: a `loopback` entry `ws://127.0.0.1:<gateway port>` only in offers requested over loopback; one `lan` entry per LAN interface of the LAN listener, always `wss` with the `tlsSha256` pin of the listener's certificate (there is no plaintext LAN option); a `tailnet` entry `ws://<node>.<tailnet>.ts.net:18910` only after the tailnet listener of `server-api.Tailnet ingress bridge` reported ready with its tailnet name, plus a second `tailnet` entry `wss://<node>.<tailnet>.ts.net` when the bridge holds a browser-trusted certificate for that name; and, when an admin installed a browser-trusted certificate for the LAN listener (`server-api.Product listeners and path restriction`), the `lan` entry carries that certificate's host name and still its `tlsSha256`. Which listeners serve is decided by the "Network access" setting of capability `desktop-app` (three levels: "This computer only" — the default; "Tailnet"; "Local network (encrypted)"), which maps to the host configuration keys `tailnet.enabled` and `lan.enabled`, and on a headless Gateway by `jagentchill tailnet up` and `jagentchill lan up`; the levels and the commands are the same on macOS, Windows and Linux hosts. The Gateway SHALL never advertise a globally routable address. What the offer sheet shows per level:

| Level | Sheet content | Who can pair |
|---|---|---|
| "This computer only" | heading "Pair a browser on this computer"; the copyable web link and the short code with their countdown; NO QR code; below them "To pair a phone or another computer, open Network access" (button) | a browser on the same computer (the desktop app itself is trusted by `device-pairing-signing.Trust bootstrap for the first device`) |
| "Tailnet", bridge ready | QR code, link, short code | phones and desktop apps anywhere on the tailnet through their embedded node; browsers on a computer that runs Tailscale, when the bridge has a `ts.net` certificate |
| "Tailnet", bridge not ready (not signed in, starting, failed) | the bridge state with its action ("Sign in to Tailscale", "Retry") instead of a QR code that would contain no reachable address; the same-computer link and short code stay available | a browser on the same computer |
| "Local network (encrypted)" | QR code, link, short code, and the sentence "Browsers on other computers need a trusted certificate — see Web access" unless such a certificate is installed | phones and desktop apps on the same network (pinned certificate); browsers on other computers only with an installed browser-trusted certificate |

`jagentchill.pairing.offer.create` SHALL succeed at every level for a requester on loopback. [JAD] [NEW]

#### Scenario: Tailnet address only after the bridge is ready
- **WHEN** an admin selects "Tailnet" and the bridge is still waiting for Tailscale sign-in
- **THEN** no offer contains a `tailnet` entry and the pairing screen shows "Sign in to Tailscale"
- **AND** once the bridge reports ready, a new offer contains a `tailnet` entry with the bridge's tailnet name and port 18910

#### Scenario: Browser on the same computer at the default level
- **WHEN** an admin opens "Pair a device" on a desktop whose Network access is "This computer only"
- **THEN** the sheet shows "Pair a browser on this computer" with the copyable link `http://127.0.0.1:<port>/jagentchill/app/#/pair/link?offer=…`, the short code and the countdown, shows no QR code, and offers "Open Network access" for other devices
- **AND** a browser on that computer that opens the link reaches the code entry step and pairs with the six-digit code

#### Scenario: Encrypted LAN entry
- **WHEN** the level is "Local network (encrypted)"
- **THEN** the offer contains a `lan` entry with a `wss` URL on the LAN listener's port and its `tlsSha256`, and no entry names the Gateway's native port on a non-loopback address

#### Scenario: Public interface
- **WHEN** the host has a globally routable address
- **THEN** that address is absent from the offer and `jagentchill doctor` reports `warn bind: public interface not advertised`

#### Scenario: No plaintext LAN
- **WHEN** the contract suite builds offers at every level on macOS, Windows and Linux hosts
- **THEN** no offer contains a `ws` URL of kind `lan`

### Requirement: Address kinds and selection order
Every Gateway address, in offers and in the client's host registry, SHALL carry a `kind` from the named set `loopback`, `lan`, `tailnet`; the kind decides only how the byte stream is established (directly, directly with TLS and pin, or through a tailnet node), and the handshake, tokens, signing and revocation of this capability are identical on every kind. The set is an extension point: a client SHALL ignore address entries whose kind it does not know, so that a further kind can be added without changing the handshake or the offer version. A host can have two `tailnet` entries: app clients (macOS, Windows, Linux, iOS, Android) SHALL use only the `ws` entry, dialled through their own tailnet node, and SHALL ignore the `wss` entry; web clients SHALL use only the `wss` entry. The priority order on every platform is `loopback`, then `lan`, then `tailnet`, whatever the order in the offer, and attempts are raced, not queued: the client starts the highest-priority candidate at once and each next candidate 300 ms after the previous one while no candidate has completed the channel P handshake; when a candidate completes the handshake the client waits a settle window of at most 1 000 ms (ending early when every higher-priority candidate has failed) for a higher-priority candidate still in flight, then keeps the highest-priority completed connection, closes the others before sending any `req`, and stores the winner as `preferredAddress`. Each attempt has a 5-second timeout of its own, so the worst case to "no address answers" is 5 seconds plus the stagger, not 5 seconds per address. On a reconnect `preferredAddress` is started first and the others follow with the same stagger. A `tailnet` candidate needs a tailnet path: the embedded node on mobile (`device-pairing-signing.Embedded tailnet node on mobile`), the tailnet proxy on desktop (`device-pairing-signing.Desktop tailnet proxy`), or the machine's own network stack on web (`device-pairing-signing.Web clients and the tailnet`); the client SHALL start that node in parallel with the first attempt whenever the device is not on the network (same SSID or same gateway MAC, as remembered locally) on which a `lan` address of this host last completed a handshake, and otherwise only when the `tailnet` candidate's turn comes. When the network changes, the client SHALL re-run the selection within 2 seconds, so that a phone leaving the local network moves from `lan` to `tailnet` without user action. The WireGuard encryption of a tailnet path does not authenticate the Gateway or the device to the product and SHALL NOT replace any step of the handshake. [JAD] [NEW]

#### Scenario: LAN preferred over tailnet
- **WHEN** a phone on the same network as the host has both a `lan` and a `tailnet` address for it and both complete the handshake within the settle window
- **THEN** it keeps the `lan` connection, closes the `tailnet` one without sending a request on it, and stores the `lan` address as `preferredAddress`

#### Scenario: Away from home with a stale preference
- **WHEN** a phone whose `preferredAddress` is a `lan` address cold-starts on a mobile network with its tailnet node signed in
- **THEN** the node is started together with the first attempt, the `tailnet` attempt begins 300 ms after the `lan` attempt, and the connection is `ready` over `tailnet` in 3 seconds or less on the reference phones without waiting for the `lan` attempt to time out

#### Scenario: Leaving the local network
- **WHEN** the phone leaves the Wi-Fi network while connected through `lan`
- **THEN** within 2 seconds of the network change it starts connecting through the `tailnet` address and completes a fresh handshake there

#### Scenario: Unknown address kind
- **WHEN** an offer contains an entry with `kind` `relay` beside a `tailnet` entry
- **THEN** the client ignores the unknown entry, pairs through the `tailnet` entry, and reports no error

#### Scenario: App client ignores the web tailnet entry
- **WHEN** a desktop app holds both `ws://<node>.<tailnet>.ts.net:18910` and `wss://<node>.<tailnet>.ts.net` for a host
- **THEN** it dials only the `ws` entry through its tailnet proxy

#### Scenario: Same handshake on every kind
- **WHEN** the conformance suite runs the channel P handshake over a `loopback`, a `lan` and a `tailnet` address
- **THEN** the frames exchanged and the checks applied are identical on all three

### Requirement: Embedded tailnet node on mobile
The mobile app SHALL contain its own tailnet node so that a phone or tablet reaches a Gateway over a tailnet without the Tailscale app being installed, on iOS/iPadOS and on Android alike: one Go bridge built on `tsnet`, wrapped by the native module `JagentchillTailnet` with a Swift wrapper on iOS/iPadOS and a Kotlin wrapper on Android that expose the same interface and behave identically — `getStatus()` → `{ state: "stopped" | "needs-login" | "starting" | "running" | "expired" | "error", tailnetName?, nodeName?, keyExpiry_ms?, error? }`, `startLogin({ mode: "interactive" | "authKey", authKey? })` → `{ loginUrl? }`, `logout()`, `openProxy(target)` → `{ port, proxySecret }` and `closeProxy(port)`. `openProxy` SHALL listen on `127.0.0.1` on a random port and forward to `target` (a `tailnet` address from an offer or the host registry) through the node. A loopback listener cannot tell which process connects to it on either mobile operating system, so the proxy authenticates its client instead: `proxySecret` is 32 CSPRNG bytes (base64url) returned only to the caller of `openProxy`, kept in memory, and the proxy SHALL close, without forwarding a byte, any connection whose first HTTP request (including the WebSocket upgrade request) lacks the header `X-JAgentChill-Proxy-Secret` with that value; the header is removed before forwarding. The JavaScript client and the native transport dial `ws://127.0.0.1:<port>` and `http://127.0.0.1:<port>` with the header. The node's state directory SHALL be inside the app's private storage, excluded from device backup; the node SHALL start as decided by `device-pairing-signing.Address kinds and selection order` and SHALL stop 60 seconds after the last proxy closed. The node's machine key is a Tailscale credential, separate from the device key of this capability, which stays in the platform key store (`device-pairing-signing.Per-platform device key storage`). When the node's key expires or the user logs out, hosts reachable only over `tailnet` show "Tailnet sign-in required" with the action "Sign in to Tailscale"; hosts reachable over `lan` keep working. Embedding the node in the two store builds is gated by the client part of spike S20 (`diagnostics-quality.Gating spikes`), run on both reference phones. The embedded node is an owner requirement (the transport of JAgentDesk), so a failed S20 does not change the product by itself: its record is `result: fail, status: awaiting-owner` and the gated tasks stay blocked until the owner signs it off. The fallback the owner can approve is specified here so that it is ready: the embedded node is removed from BOTH the iOS and the Android build so that the two behave alike; a `tailnet` address is then dialled through the operating system's Tailscale client; the "Sign in to Tailscale" step is replaced on both by the screen "Open Tailscale" (text "Install Tailscale on this device and sign in to the same tailnet as your host", actions "Open Tailscale" and "I have signed in"); `getStatus()` reports `state: "external"`; and every other step of pairing, the address order and the security checks are unchanged. [JAD] [NEW]

#### Scenario: Phone without the Tailscale app
- **WHEN** a phone that has no VPN app installed pairs with a host whose only reachable address is `tailnet`, after signing the embedded node in
- **THEN** the handshake completes through `ws://127.0.0.1:<port>` and the phone's OS shows no system VPN as active

#### Scenario: Same behaviour on iOS and Android
- **WHEN** the module's contract test runs on the iOS simulator and on the Android emulator
- **THEN** `getStatus`, `startLogin`, `logout`, `openProxy` and `closeProxy` return the same shapes and state sequence on both

#### Scenario: Another app connects to the proxy port
- **WHEN** another app on the phone opens a connection to the proxy's loopback port and sends a WebSocket upgrade without `X-JAgentChill-Proxy-Secret`
- **THEN** the connection is closed and no byte reaches the tailnet, on iOS and on Android

#### Scenario: Node key expired
- **WHEN** the node's key expired while the phone is away from the host's network
- **THEN** the host shows "Tailnet sign-in required" with "Sign in to Tailscale", and after sign-in the client reconnects without a new pairing

#### Scenario: Node stops when unused
- **WHEN** the last connection through the node closed 60 seconds ago
- **THEN** `getStatus()` reports `stopped` and the node holds no network socket

#### Scenario: Spike S20 failed on one mobile operating system
- **WHEN** the S20 record says the embedded node fails on Android and passes on iOS
- **THEN** the record is `awaiting-owner` and the policy job blocks the gated tasks
- **AND** only after the record carries `owner-approved` do both store builds ship without the embedded node and show the "Open Tailscale" screen, with the same handshake and six-digit code on both

### Requirement: Desktop tailnet proxy
The desktop app SHALL reach Gateways other than its own over a tailnet through a tailnet proxy run by the Electron main process on macOS, Windows and Linux alike: the same Go bridge, shipped as a signed helper binary for each desktop platform and architecture, started on demand in client mode with its state in the app's user-data directory, offering the same operations as the mobile module (`getStatus`, `startLogin`, `logout`, `openProxy` → `{ port, proxySecret }`, `closeProxy`) to the main process only, with the same `X-JAgentChill-Proxy-Secret` rule; the main process adds the header itself and the renderer reaches the proxy only through typed IPC, never receiving the port or the secret. The desktop's own host is always reached over `loopback` and never through the proxy. The proxy SHALL be used whether or not the computer also runs the operating system's Tailscale client, so that behaviour is the same on the three desktop platforms; its node is distinct from the Gateway-side node of `server-api.Tailnet ingress bridge`. Login, expiry and logout behave as in `device-pairing-signing.Tailnet login step`. [JAD] [NEW]

#### Scenario: Desktop pairs with a second Gateway
- **WHEN** a desktop app scans or pastes the offer of a Gateway on another machine whose reachable address is `tailnet`
- **THEN** after the tailnet sign-in the main process opens a loopback proxy, the handshake completes through it, and the desktop's own Gateway connection stays on `loopback`

#### Scenario: Same result on three desktop platforms
- **WHEN** the desktop end-to-end case `pair-remote-tailnet` runs on macOS, Windows and Linux
- **THEN** it passes on all three with the same steps

#### Scenario: Renderer cannot use the proxy directly
- **WHEN** renderer script tries to open a WebSocket to the proxy's loopback port
- **THEN** the connection is refused by the Content-Security-Policy, and a connection made by another local process without the proxy secret is closed without a forwarded byte

### Requirement: Tailnet login step
Joining a tailnet SHALL be a step of the client's pairing and reconnect flows on mobile and desktop, in the order used by JAgentDesk: the first screen captures the pairing offer (scan, paste, deep link or short code; routes `/pair/start`, `/pair/scan` and `/pair/link` of `app-shell-navigation.Pairing flow routes`); then, only when the selected reachable address of the offer is of kind `tailnet` and the client's tailnet node is not `running`, the "Sign in to Tailscale" screen, which is the route `/pair/tailnet`; then the handshake and the six-digit code. The offer SHALL be kept across the sign-in detour (including the app being suspended or restarted) for as long as it is unexpired, and an offer that expired during sign-in leads to "Ask for a new code on the trusted device" with the node left signed in. The sign-in screen SHALL offer two methods: **interactive** — the node returns a login URL, which the app opens in the system browser (mobile: in-app browser tab) and also shows as a QR code and copyable link, polling `getStatus()` once per second until `running` or a 10-minute timeout; and **auth key** — a field for a Tailscale auth key, passed once to the node and never stored, logged or sent to the Gateway. Before showing the sign-in screen, the client SHALL race the offer's `loopback` and `lan` addresses as in `device-pairing-signing.Address kinds and selection order`; when one completes the handshake, the sign-in screen is skipped and the notice "Connected on the local network. Sign in to Tailscale to reach this host from elsewhere" is shown in the host's detail view. The screen SHALL state "Tailscale connects this device privately to your host. JAgentChill has no relay server. Tailscale's coordination and relay servers see connection metadata, not your content". "Sign out of Tailscale" SHALL be available in connection settings, SHALL stop the node and delete its state, and SHALL leave pairings intact. [JAD] [NEW]

#### Scenario: Flow order with a tailnet-only offer
- **WHEN** a phone whose node is not signed in scans an offer whose only reachable address is `tailnet`
- **THEN** the screens appear in the order offer capture, "Sign in to Tailscale", "Verifying host", code entry, "Paired"

#### Scenario: Reachable on the local network
- **WHEN** the same phone is on the host's Wi-Fi and the offer also has a `lan` address that answers
- **THEN** no Tailscale screen is shown, pairing completes over `lan`, and the host detail view shows the notice about signing in for remote access

#### Scenario: Auth key
- **WHEN** the user pastes a valid auth key and confirms
- **THEN** the node reaches `running` without opening a browser, and a search of app storage and logs finds no copy of the key

#### Scenario: Offer survives the detour
- **WHEN** the app is suspended for 3 minutes while the user signs in through the browser
- **THEN** on return the flow continues with the same offer at "Verifying host"

#### Scenario: Sign-in abandoned
- **WHEN** the user closes the browser without signing in and 10 minutes pass
- **THEN** the screen shows "Sign-in was not completed" with "Try again" and "Use an auth key", and no pairing request was created on the Gateway

### Requirement: Web clients and the tailnet
A browser cannot own a tailnet node, cannot pin a certificate, and runs only in a secure context; a phone or a browser can never be the host (proposal Non-goals). A browser SHALL therefore reach a host in exactly three ways (decision B2), and the web app SHALL say so in the same words on every screen that offers pairing:

| Where the browser runs | Address used | Condition |
|---|---|---|
| On the same computer as the host | `loopback` (`http://127.0.0.1:<port>` / `ws`) | none; works at every Network access level, including "This computer only" |
| On another computer of the tailnet | the `wss` `tailnet` entry `https://<node>.<tailnet>.ts.net` | that computer runs the operating system's Tailscale client signed in to the same tailnet, and the host's bridge obtained a browser-trusted `ts.net` certificate (HTTPS certificates enabled for the tailnet) |
| On another computer of the local network | a `lan` entry whose certificate the browser trusts | an admin installed a browser-trusted certificate for the LAN listener (`server-api.Product listeners and path restriction`), or the operator runs a reverse proxy listed in `http.allowedOrigins`; the listener's default pinned self-signed certificate is for the native apps only |

The web pairing sheet SHALL state exactly: "A browser can connect to a host only on this computer or through a trusted HTTPS address. On another computer, use the desktop app, or turn on Tailnet with HTTPS certificates on the host and Tailscale on this computer." When an offer has no address a browser can use, or none answers, the sheet SHALL show `GATEWAY_UNREACHABLE` with reason `web_requires_trusted_tls`, `no_address_answered` or `origin_not_allowed` and that sentence. `origin_not_allowed` is the case of a web app loaded from one origin connecting to a host that does not list it: a host admits only its own origin, loopback origins and `http.allowedOrigins`, so a static deployment (`updates-distribution.Web origins` (c)) or the app served by host A can connect to host B only after an admin of B added the origin; the client detects it from the HTTP 403 of the upgrade or of the preflight and shows "This host does not accept connections from <origin>. Ask its admin to add it under Host ▸ Web access." Security is not reduced on web: the same handshake with mutual authentication, the same six-digit code, a non-extractable device key and the same per-request signatures apply. [JAD] [NEW]

#### Scenario: Browser on the host's computer at the default level
- **WHEN** a browser on the host computer opens `http://127.0.0.1:18910/jagentchill/app/` while Network access is "This computer only" and uses the link or short code of the offer sheet
- **THEN** pairing completes over `loopback` with the six-digit code

#### Scenario: Browser on a machine with Tailscale
- **WHEN** a browser on a laptop that runs Tailscale on the same tailnet opens the host's `https://<node>.<tailnet>.ts.net/jagentchill/app/` and pastes an offer
- **THEN** pairing completes over the `wss` tailnet address with the six-digit code and a non-extractable device key

#### Scenario: Browser on the LAN without a trusted certificate
- **WHEN** a browser on a second computer of the same network uses an offer whose `lan` entry has only the pinned self-signed certificate
- **THEN** the sheet shows the sentence above and `GATEWAY_UNREACHABLE` with reason `web_requires_trusted_tls`, and no certificate warning page is opened by the app

#### Scenario: Browser on the LAN with an installed certificate
- **WHEN** an admin installed a browser-trusted certificate for `studio.example.lan` on the LAN listener and a browser on another computer opens `https://studio.example.lan:18790/jagentchill/app/`
- **THEN** the app loads in a secure context and pairing completes over that `wss` address

#### Scenario: Static deployment not allowed by the host
- **WHEN** the web app served from `https://edit.example.org` tries to connect to a host whose `http.allowedOrigins` does not contain that origin
- **THEN** the sheet shows `GATEWAY_UNREACHABLE` with reason `origin_not_allowed` and the sentence naming the origin

#### Scenario: No unsigned shortcut
- **WHEN** a web client connects over the tailnet
- **THEN** the Gateway requires the `hello`, `challenge`, `prove`, `ready` exchange and refuses a `req` frame before `ready`

### Requirement: Offer presentation and intake
A trusted client with scope `jagentchill.devices.manage` (and the host CLI) SHALL obtain an offer with `jagentchill.pairing.offer.create { role? }` and present it — in the app, on the offer sheet of the Devices screen, whose route is `/devices?pair=1` (`app-shell-navigation.Pairing flow routes`) — in up to three forms: a QR code (error-correction level M, rendered at 240 px or larger with a 4-module quiet zone, dark modules on a white field in both themes), a copyable link, and a short code of 8 characters from the Crockford base32 alphabet displayed as `XXXX-XXXX` beside the Gateway fingerprint (the first 16 hex characters of `gatewayId`, grouped in fours). Which forms are shown follows the level table of `device-pairing-signing.Offer addresses and reachability`: at "This computer only" (and whenever the offer holds no non-loopback address) the sheet shows the web link and the short code and NO QR code, because only a browser on this computer can use it; otherwise all three, with the `jagentchill://pair` link. The presentation SHALL show the remaining lifetime as a mm:ss countdown and a "New offer" action. A new device SHALL accept an offer by camera scan (mobile), by pasted link (all platforms), by opening the `jagentchill://pair` deep link (mobile and desktop; registration owned by `app-shell-navigation.Deep links and file types`) or the web link (browser), or by entering a Gateway address plus the short code, in which case it SHALL fetch the offer with `POST /jagentchill/v1/pair/resolve { shortCode }` → `{ offer }` and SHALL require the user to confirm that the fingerprint shown on the new device matches the one shown beside the short code before continuing. In the web app served by a Gateway, the address field of "Enter code" SHALL be pre-filled with the page origin. Short-code resolution SHALL be case-insensitive and SHALL ignore the hyphen. [CAPCUT CC-266] [JAD] [NEW]

#### Scenario: Scan on mobile
- **WHEN** a user scans the QR code with the mobile app's scanner
- **THEN** the app decodes the offer and opens the pairing sheet showing the host name and fingerprint within 1 second

#### Scenario: Camera permission denied
- **WHEN** the user denies camera access
- **THEN** the scanner screen shows the "Paste link" and "Enter code" actions and an "Open Settings" button, and no camera frame is requested again automatically

#### Scenario: Short code with fingerprint confirmation
- **WHEN** a user enters a Gateway address and the short code on a desktop client
- **THEN** the client displays the 16-character fingerprint and proceeds only after the user chooses "Fingerprints match"

#### Scenario: Short code in a browser on the host computer
- **WHEN** the web app at `http://127.0.0.1:18910/jagentchill/app/` opens "Enter code" at the "This computer only" level
- **THEN** the address field already holds `http://127.0.0.1:18910`, and entering the short code and confirming the fingerprint leads to the six-digit code step

#### Scenario: Offer regenerated
- **WHEN** the admin chooses "New offer"
- **THEN** the previous link, QR code and short code are refused with `OFFER_EXPIRED`

#### Scenario: Keyboard access on desktop
- **WHEN** the pairing section has focus on desktop or web
- **THEN** Tab reaches "Copy link", "New offer" and each pending request's "Decline", and Enter or Space activates the focused control

### Requirement: Offer validation by the new device
Before opening any connection, a new device SHALL verify that the offer's `v` is supported, that `gatewayId` equals the first 32 hex characters of SHA-256 of the decoded `gatewayPublicKey`, that `addresses` is non-empty with allowed schemes, and that `expires_ms` is greater than the device clock time. The Gateway SHALL independently refuse every enrolment call that names an `offerId` that is not the live offer, or is past its `expires_ms`, with `OFFER_EXPIRED` (HTTP 410). A device whose clock is ahead so that a valid offer appears expired SHALL show `OFFER_EXPIRED` together with the device's current time and the hint "Check this device's date and time". [NEW]

#### Scenario: Tampered public key
- **WHEN** an offer's `gatewayPublicKey` does not hash to its `gatewayId`
- **THEN** the device shows `OFFER_INVALID` and opens no connection

#### Scenario: Expired on the Gateway
- **WHEN** a device with a slow clock uses an offer 30 seconds after its `expires_ms`
- **THEN** the Gateway answers `OFFER_EXPIRED` (HTTP 410) and creates no pairing request

#### Scenario: No live offer
- **WHEN** a machine that can reach a product listener calls `POST /jagentchill/v1/pair/challenge` with a random `offerId`
- **THEN** the response is HTTP 410 `OFFER_EXPIRED` and nothing is shown to any trusted device

### Requirement: Enrolment over public server routes
Enrolment SHALL run only on the server's public HTTP routes — a device never reaches OpenClaw's own socket, and enrolment works whatever the state of the supervised Gateway (`server-api.Gateway supervision and lifecycle`) — in this order, as the state machine `challenged → proved → paired` with the terminal states `declined`, `cancelled`, `expired` and `locked`: (1) `POST /jagentchill/v1/pair/challenge { offerId, deviceId, devicePublicKey, deviceNonce, deviceName, platform, appVersion, protocolVersion, keyProtection }` → `{ requestId, gatewayNonce, ts, gatewayId, protocolVersion, gatewaySignature }`, state `challenged`; the device verifies `gatewaySignature` (`device-pairing-signing.Mutual authentication of the Gateway`) before sending anything further; (2) `POST /jagentchill/v1/pair/prove { requestId, signature }` where `signature` is the device signature over the transcript → `{ expires_ms, attemptsRemaining }`, state `proved`, and the pending pairing request becomes visible to trusted devices; (3) `POST /jagentchill/v1/pair/verify { requestId, code }`, carrying the per-request signature headers made by the enrolling key, → on success state `paired` and the response `{ role, gatewayName, deviceToken: { value, expires_ms } }`; the same route with `{ requestId, action: "cancel" }` cancels the request; (4) `GET /jagentchill/v1/pair/status?requestId=<id>`, signed by the enrolling key, → `{ state, attemptsRemaining, expires_ms }`, polled at most once per second while the code step is shown, so that the device learns of a decline, an expiry or `paired`. `paired` is final: there is no second step, no OpenClaw pairing request, no token other than the device token, and the device is fully usable — including agent sessions, which the server relays over its gateway link (`server-api.Agent session relay`) — as soon as its first channel P handshake completes. No token SHALL be returned before `paired`. The enrolment routes are unsigned exceptions listed in `server-api.Unsigned route exceptions`; `verify` and `status` are authenticated by the enrolling key held in the pending request. [NEW]

#### Scenario: Happy path states
- **WHEN** a new device runs challenge, prove and verify with the correct code
- **THEN** `pair/status` reports `challenged`, `proved` and `paired` in that order and the `verify` response carries `deviceToken` and no other credential

#### Scenario: Verify without a signature
- **WHEN** `POST /jagentchill/v1/pair/verify` arrives with the correct code and no signature headers
- **THEN** the response is HTTP 401 `SIGNATURE_MISSING`, no attempt is counted and no token is issued

#### Scenario: Prove before Gateway verification is possible
- **WHEN** an impostor answers `pair/challenge` with a `gatewaySignature` made by another key
- **THEN** the device stops, sends no `prove`, and shows `GATEWAY_SIGNATURE_INVALID`

#### Scenario: Only server routes are used
- **WHEN** network traffic of a full enrolment and the first agent turn of the new device is captured
- **THEN** it contains only requests to `/jagentchill/v1/pair/*` and the channel P connection, and no OpenClaw `connect` frame

#### Scenario: Agent chat directly after pairing
- **WHEN** an `editor` phone reaches `paired`, opens channel P and starts a chat with a creative agent
- **THEN** the turn runs without any further approval step on the host

### Requirement: Challenge issuance
For every enrolment and every channel P handshake the Gateway SHALL issue a challenge `{ gatewayNonce, ts }` where `gatewayNonce` is base64url (no padding) of 32 bytes from the CSPRNG and `ts` is the Gateway clock in Unix UTC milliseconds, and the device SHALL contribute `deviceNonce`, base64url (no padding) of 32 bytes from its own CSPRNG, generated fresh for that exchange. A challenge SHALL be bound to the enrolment request or the channel P connection it was issued for, SHALL be single-use, and SHALL expire 30 000 ms after `ts`. The Gateway SHALL hold at most 4 096 outstanding challenges and SHALL refuse further issuance with `RATE_LIMITED` until some expire. [JAD] [NEW]

#### Scenario: Challenge reuse
- **WHEN** a device completes a handshake and then submits a second proof using the same `gatewayNonce`
- **THEN** the Gateway answers `CHALLENGE_UNKNOWN`

#### Scenario: Challenge from another connection
- **WHEN** a valid signature over a `gatewayNonce` issued to connection A is presented on connection B
- **THEN** connection B is closed with code 4401 and reason `CHALLENGE_UNKNOWN`

#### Scenario: Expired challenge
- **WHEN** the proof arrives 31 seconds after the challenge `ts`
- **THEN** the Gateway answers `CHALLENGE_EXPIRED`

#### Scenario: Device nonce is fresh
- **WHEN** a device performs 3 handshakes
- **THEN** the 3 `deviceNonce` values differ

### Requirement: Signed handshake transcript
Both sides SHALL sign the handshake transcript, defined (design D7.3) as the UTF-8 bytes of these ten lines joined by a single line feed (`\n`) with no trailing line feed: `JAGENTCHILL-HANDSHAKE-V1`; `<role>` (`device` or `gateway`); `<context>` (`enrol:<offerId>` during enrolment, `connect` on channel P); `<gatewayNonce>`; `<deviceNonce>`; `<ts>` (Gateway clock, decimal milliseconds); `<gatewayId>`; `<deviceId>`; `<devicePublicKey>`; `<protocolVersion>` (decimal integer, the device's). Each side signs the variant carrying its own role line. The Gateway SHALL verify a device proof in this order and fail closed at the first failure: the challenge is outstanding for this request or connection (`CHALLENGE_UNKNOWN`) and unexpired (`CHALLENGE_EXPIRED`); `deviceId` matches the key (`DEVICE_ID_MISMATCH`); `protocolVersion` is in its supported range (`PROTOCOL_UNSUPPORTED`); the signature verifies over the reconstructed transcript (`DEVICE_SIGNATURE_INVALID`); for context `connect` the device is paired (`DEVICE_UNKNOWN`) and not revoked (`DEVICE_REVOKED`). A signature over the bare nonce, or over a transcript with another context, SHALL NOT be accepted. On the enrolment routes an unknown device and a bad signature SHALL both be reported as `DEVICE_SIGNATURE_INVALID`. [NEW]

#### Scenario: Valid proof from a paired device
- **WHEN** a paired device signs the ten-line `device` transcript built from the issued challenge, its own `deviceNonce` and its identifiers
- **THEN** the Gateway accepts the proof

#### Scenario: Bare-nonce signature
- **WHEN** a client signs only the `gatewayNonce` string
- **THEN** the Gateway answers `DEVICE_SIGNATURE_INVALID`

#### Scenario: Enrolment transcript replayed on connect
- **WHEN** a signature made over a transcript with context `enrol:<offerId>` is presented in a channel P `prove` frame
- **THEN** the Gateway answers `DEVICE_SIGNATURE_INVALID`

#### Scenario: Changed protocol version after signing
- **WHEN** the `protocolVersion` used by the Gateway to rebuild the transcript differs from the value that was signed
- **THEN** the Gateway answers `DEVICE_SIGNATURE_INVALID`

#### Scenario: Transcript line count
- **WHEN** the conformance case `transcript-shape` rebuilds the signed bytes of a captured handshake
- **THEN** they are exactly ten lines in the order above, with `context` third, `gatewayNonce` fourth and `deviceNonce` fifth

### Requirement: Mutual authentication of the Gateway
The Gateway SHALL sign the transcript with role line `gateway` using the Gateway private key and send `gatewaySignature` together with the challenge (in the `pair/challenge` response and in the channel P `challenge` frame), so that the device authenticates the Gateway before it sends its own proof, its device token, a verification code, or any project, media or chat data. The device SHALL verify `gatewaySignature` against the `gatewayPublicKey` it holds (from the offer at enrolment, from its host registry on every subsequent connection) over a transcript containing the `deviceNonce` it generated for this exchange, which makes a recorded Gateway response unusable for another exchange. On verification failure the device SHALL close the connection, SHALL NOT retry that address automatically, and SHALL show the message keyed `GATEWAY_SIGNATURE_INVALID` ("This is not the host you paired with"). The device SHALL also refuse a server that presents a different `gatewayId` than the one stored for that host (`GATEWAY_MISMATCH`). Because channel P is the only channel (design D7), nothing — no token, prompt, file or approval answer — is ever sent to an address on which this verification has not succeeded in the current connection. [NEW]

#### Scenario: Genuine Gateway
- **WHEN** the device verifies `gatewaySignature` over the `gateway` transcript with the stored public key
- **THEN** verification succeeds and the device sends its `prove` frame

#### Scenario: Impostor at the Gateway's address
- **WHEN** a different server answers at a stored address and returns a signature made with another key
- **THEN** the device closes the connection, sends no token, code or data, and shows `GATEWAY_SIGNATURE_INVALID`

#### Scenario: Replayed Gateway response
- **WHEN** an impostor replays a `challenge` frame recorded from an earlier handshake of the same device
- **THEN** verification fails because the transcript does not contain the device's new `deviceNonce`, and the device shows `GATEWAY_SIGNATURE_INVALID`

#### Scenario: Missing Gateway signature
- **WHEN** the `challenge` frame omits `gatewaySignature`
- **THEN** the device treats it as `GATEWAY_SIGNATURE_INVALID`

### Requirement: Channel P handshake
On every channel P connection the first four frames SHALL be, in order, `hello`, `challenge`, `prove` and `ready` with the fields of `server-api.Channel P frame envelope`, completed within 10 000 ms or the Gateway closes with code 4408. The Gateway answers `hello` with a `challenge` whose `gatewaySignature` covers the `gateway` transcript with context `connect`; the client verifies it, then sends `prove { signature, deviceToken }` where `signature` covers the `device` transcript and `deviceToken` is the device token. The Gateway SHALL then verify, in order: the transcript checks of `device-pairing-signing.Signed handshake transcript`; the token (`TOKEN_INVALID`, `TOKEN_EXPIRED` per `device-pairing-signing.Device token issuance`); the protocol range (`PROTOCOL_UNSUPPORTED`, close code 4426); and the connection count. Any failure closes the connection with code 4401 (4403 for `DEVICE_REVOKED`, 4426 for protocol, 4429 for limits) with the error code as close reason; for 4426 the reason is `PROTOCOL_UNSUPPORTED:client` or `PROTOCOL_UNSUPPORTED:gateway`, naming the side that is too old (`updates-distribution.Protocol version negotiation`). `ready` carries `connId`, `role`, `scopes[]`, `features{}`, `serverTime_ms`, `maxSchemaVersion { project, script, workflow }` (`cross-device-sync.Schema version skew`), `transport` (the connection path tag of `device-pairing-signing.Connection path indicator`) and a rotated `deviceToken` when due; it carries no OpenClaw credential and no transport choice, because agent traffic always uses this same connection. Before `ready` the client SHALL send no frame other than `hello`, `prove`, `ping` and `pong`. `hello.clientInstanceId` is the `cid_<uuid>` of `device-pairing-signing.Session resume`. On the fallback transport the same four objects travel over the handshake routes of `server-api.SSE and signed HTTP fallback`. [NEW]

#### Scenario: Complete handshake
- **WHEN** a paired device with a valid token opens channel P
- **THEN** the frames `hello`, `challenge`, `prove` and `ready` are exchanged in that order and `ready.role` equals the device's role

#### Scenario: Stolen token without the key
- **WHEN** an attacker presents a valid `deviceToken` in `prove` with a signature that does not verify
- **THEN** the connection is closed with code 4401 and reason `DEVICE_SIGNATURE_INVALID`, and no `req` frame is served

#### Scenario: Valid key without the token
- **WHEN** a client signs the transcript correctly and presents a token that was never issued to that device
- **THEN** the connection is closed with code 4401 and reason `TOKEN_INVALID`

#### Scenario: Slow client
- **WHEN** the client has not sent `prove` 10 000 ms after the upgrade
- **THEN** the connection is closed with code 4408

#### Scenario: Ready frame has no OpenClaw credential
- **WHEN** the `ready` frame of an `editor` device is captured
- **THEN** it has no field carrying an OpenClaw token, scope or bootstrap value, and `scopes[]` lists only `jagentchill.*` scopes

### Requirement: Pairing request creation
When an enrolling device reaches state `proved`, the Gateway SHALL create a pending pairing request `{ requestId (UUID), offerId, deviceId, devicePublicKey, deviceName (1 to 64 characters), platform (ios, android, macos, windows, linux, web), appVersion, keyProtection, sourceAddress, transport, peerNodeName?, role, state, created_ms, expires_ms }`, where `sourceAddress` is the real peer address — for a request that arrived through a product listener, the address attributed by `server-api.Product listeners and path restriction`, never the listener's own loopback address. The request and its verification code SHALL be delivered only as targeted delivery: by the channel P event `jagentchill.pairing.requested` on stream `pairing`, sent only to connections of devices that hold `jagentchill.devices.manage` and subscribed to that stream; by `jagentchill.pairing.request.list` (same scope; the pull RPC of the stream); and to a running host CLI `pair` command. No other frame, event, log line, notification body or push payload SHALL carry the code. At most 3 requests SHALL be pending per offer; a further request SHALL be refused with `PAIRING_LIMIT` (HTTP 429). A new request from a device key that already has a pending request SHALL replace the old one. Each trusted client SHALL show the request with device name, platform, source address and connection path, the first 8 hex characters of the device's key fingerprint, the verification code and a countdown. A created request is announced to devices holding `jagentchill.devices.manage` as the notification kind `pairing.request` of `notifications.Notification event catalogue` (which names the device and never the code), in addition to the event `jagentchill.pairing.requested`. [JAD] [NEW]

#### Scenario: Request appears on a trusted client
- **WHEN** a new phone reaches state `proved`
- **THEN** within 1 second every connected admin client shows the request with device name, platform, source address, 8-character fingerprint, verification code and countdown

#### Scenario: Editor does not see the code
- **WHEN** an `editor` device is connected while a request is pending
- **THEN** it receives no `jagentchill.pairing.requested` event and `jagentchill.pairing.request.list` answers `SCOPE_DENIED`

#### Scenario: Request through the tailnet shows the real peer
- **WHEN** a phone enrols through the tailnet listener
- **THEN** the request card shows the phone's tailnet address and node name with the path "Tailnet", not `127.0.0.1`

#### Scenario: Fourth concurrent request
- **WHEN** 3 requests are pending on the live offer and a fourth device asks to pair
- **THEN** the fourth receives `PAIRING_LIMIT` (HTTP 429) and the three existing requests are unaffected

#### Scenario: No trusted client online
- **WHEN** a request is created while no admin client is connected and no host CLI is running
- **THEN** the new device shows "Open JAgentChill on a trusted device, or run `jagentchill pair` on the host" and the request stays pending until it expires

### Requirement: Six-digit verification code
For each pairing request the Gateway SHALL generate a verification code of exactly 6 decimal digits drawn uniformly from 000000 to 999999 with the CSPRNG. The code SHALL be shown only on trusted clients holding `jagentchill.devices.manage` and on the host CLI, never on the new device and never in an offer, log, audit record, notification body, push payload or broadcast (delivery is targeted as defined by `device-pairing-signing.Pairing request creation`). The new device SHALL show the first 8 hex characters of its own key fingerprint with the text "Enter the code shown next to <fingerprint>", so that the user reads the code of the right request. The user types the code on the new device, which sends it with the signed `POST /jagentchill/v1/pair/verify` only after the Gateway signature has been verified. The code SHALL be valid for 300 000 ms from request creation. The Gateway SHALL compare codes with a constant-time comparison and SHALL allow at most 5 attempts per request: each wrong attempt returns `CODE_INVALID` with `details.attemptsRemaining`; the fifth wrong attempt cancels the request, returns `CODE_ATTEMPTS_EXCEEDED`, and no further attempt for that request is evaluated. A code submitted after expiry SHALL return `CODE_EXPIRED` and cancel the request. A cancelled or expired request SHALL require a completely new request with a new code. [JAD] [NEW]

#### Scenario: Correct code
- **WHEN** the user types the 6 digits shown on the trusted client within 5 minutes
- **THEN** the request reaches `paired`, and both the new device and the trusted clients show "Paired" within 2 seconds

#### Scenario: Wrong code with attempts left
- **WHEN** the user submits a wrong code on the second attempt
- **THEN** the response is `CODE_INVALID` with `attemptsRemaining` 3, and the entry field is cleared and shows "Incorrect code. 3 attempts left"

#### Scenario: Fifth wrong attempt
- **WHEN** a fifth wrong code is submitted
- **THEN** the response is `CODE_ATTEMPTS_EXCEEDED`, the request disappears from trusted clients, an audit record `pairing.locked_out` is written, and submitting the correct code afterwards returns `PAIRING_CANCELLED`

#### Scenario: Expiry
- **WHEN** the code is submitted 301 seconds after request creation
- **THEN** the response is `CODE_EXPIRED` and the new device offers "Start again"

#### Scenario: Code entry input rules
- **WHEN** the user pastes `12 34-56` into the code field
- **THEN** non-digit characters are stripped, the six boxes fill with `123456`, and submission happens automatically once six digits are present

#### Scenario: Fingerprint shown on both sides
- **WHEN** two phones are pairing at the same time
- **THEN** each phone shows its own 8-character fingerprint and each request card on the trusted client shows the matching fingerprint beside its code

### Requirement: Approval, role assignment and decline
The trusted client's request card SHALL show a role selector (`admin`, `editor`, `viewer`; default `editor`, or the role preset on the offer) which the admin can change until the code is verified, and a "Decline" action. Declining SHALL cancel the request, make the new device's next `pair/status` or `pair/verify` call answer `PAIRING_CANCELLED`, and write an audit record. On successful verification the server SHALL, in one transaction of its own store, create the device record `{ deviceId, devicePublicKey, name, platform, role, state: "active", keyProtection, localSupervisor: false, paired_ms, pairedBy, lastSeen_ms }` and the digest of the device token; that transaction is the whole of pairing — nothing is written to OpenClaw's pairing store and no OpenClaw scope is assigned. `jagentchill.pairing.completed` SHALL be sent to devices holding `jagentchill.devices.manage`. Registering an already paired public key SHALL reuse the existing record and SHALL NOT raise its role. After pairing, the Gateway's record is authoritative for the device name. [CAPCUT CC-267, CC-268] [JAD] [NEW]

#### Scenario: Decline
- **WHEN** the admin chooses "Decline" on a pending request
- **THEN** the new device shows "Pairing declined on the trusted device" within 2 seconds and the request cannot be completed with its code

#### Scenario: Invite with a preset role
- **WHEN** an admin creates an offer with role `viewer` and a device pairs through it without the admin changing the selector
- **THEN** the new device record has role `viewer`

#### Scenario: Re-pairing a known key
- **WHEN** a device already paired as `viewer` completes a new pairing request for which the selector says `admin`
- **THEN** the existing record is reused with role `viewer` and the admin sees the note "Already paired; change the role in the device list"

#### Scenario: Pairing leaves OpenClaw's pairing store untouched
- **WHEN** three devices have been paired and `openclaw devices list` is run on the host
- **THEN** none of the three appears there, and each of them can call `jagentchill.sync.project.list` on channel P

### Requirement: Trust bootstrap for the first device
A Gateway with no device record SHALL accept its first trusted device in exactly two ways. (a) **Desktop-started** (macOS, Windows and Linux alike): the desktop app SHALL pass its device public key to the JAgentChill Server process it starts through the environment variable `JAGENTCHILL_BOOTSTRAP_DEVICE_PUBLIC_KEY` (the server does not pass the variable on to the Gateway child or to any other child process); the server SHALL register that key as role `admin` named "This computer" with `localSupervisor: true` only when no admin record exists (and SHALL ignore the variable otherwise), SHALL issue its device token, and SHALL write it to the owner-only file `<dataDir>/bootstrap/<deviceId>.json` (mode `0600`; on Windows an ACL for the current user only), which the desktop app reads once and deletes. (b) **Headless**: the operator runs `jagentchill pair` on the host, which acts as the trusted display for the offer and the verification code; the first device paired this way SHALL receive role `admin`. Being connected over loopback SHALL NOT by itself create trust. The flag `localSupervisor` marks the device record of the desktop app that starts and stops this server on the same machine (the flag name is kept; the Gateway itself is supervised by the server) (it gates `cross-device-sync.Local blob linking` and the host shutdown call of `server-api.Service lifecycle`); it is set only by this bootstrap and by `devices add-admin --local-supervisor`, is carried to the new record by `device-pairing-signing.Device key rotation`, and is never settable through an RPC. When a desktop-started host has device records and none of them is this computer's key (for example after the app's key was lost), the desktop app SHALL offer "Restore this computer as admin" in host diagnostics, which runs `jagentchill devices add-admin --public-key <key> --local-supervisor` against its own running server through the local admin endpoint (`server-api.Host command-line surface`) and writes an audit record with actor `host-cli`; the flag is then cleared on any older record that carried it. [JAD] [NEW]

#### Scenario: Desktop first run
- **WHEN** the desktop app starts its Gateway for the first time
- **THEN** exactly one device record exists, with role `admin` and `localSupervisor: true`, whose public key equals the desktop app's key
- **AND** the bootstrap file holds only the device token and no longer exists after the app has read it
- **AND** the desktop still performs the signed handshake on every connection

#### Scenario: Bootstrap variable set on an initialised Gateway
- **WHEN** the Gateway starts with the variable naming a different key while an admin record exists
- **THEN** no record is created for that key and a `warn` log entry `bootstrap_key_ignored` is written

#### Scenario: Headless first device
- **WHEN** the first device pairs through the host CLI
- **THEN** its record has role `admin` regardless of any requested role

#### Scenario: Restore this computer as admin
- **WHEN** the desktop app's key was regenerated and the user confirms "Restore this computer as admin"
- **THEN** the server holds a new `admin` record for the new key carrying `localSupervisor: true`, the old record no longer carries the flag, and an audit record `device.admin_restored` with actor `host-cli` exists

### Requirement: Device roles and scopes
Each device record SHALL have exactly one role, mapped to the JAgentChill scopes of `server-api.JAgentChill scope registry` as follows. `admin`: all 13 scopes. `editor`: `jagentchill.projects.read`, `jagentchill.projects.write`, `jagentchill.media.read`, `jagentchill.media.write`, `jagentchill.agent.use`, `jagentchill.generation.run`, `jagentchill.export.run`, `jagentchill.comments.write`, `jagentchill.config.read`. `viewer`: `jagentchill.projects.read`, `jagentchill.media.read`, `jagentchill.comments.write`, `jagentchill.config.read`. The scopes held by `admin` only are `jagentchill.config.write`, `jagentchill.devices.manage`, `jagentchill.secrets.manage` and `jagentchill.host.exec`. In product terms (design D25): a `viewer` only views and comments; an `editor` uses the editor, chats with creative agents, runs workflows and exports; an `admin` additionally uses terminals and workspace agents, answers host-execution approvals, configures providers, secrets and skills, and manages devices. **A role maps to JAgentChill scopes and to nothing else**: no device of any role — including the desktop's own — is ever given an OpenClaw operator scope, an OpenClaw device token, a bootstrap token or the shared Gateway token, and there is no role-to-OpenClaw-scope table; `jagentchill.*` scopes are internal to the server and are never OpenClaw scopes. Everything a device does, including agent chat and approvals, is a channel P call that the server checks against (1) the role's scope, (2) for agent sessions the ownership and visibility rule of `server-api.Session ownership and visibility`, and (3) for approvals the resolver rule of `server-api.Approval and question resolution`, before the server calls the Gateway over its gateway link. The server SHALL evaluate scopes on every RPC and every signed HTTP request against the current record, not a value cached at `ready`. A role change (`jagentchill.device.role.set`, scope `jagentchill.devices.manage`) is entirely server-side and takes effect at once: the record is updated in one transaction; `jagentchill.device.updated` with the new `role` and `scopes` is sent to that device's connections within 1 second; the device's next call is evaluated under the new role; its subscriptions to streams it is no longer allowed to read (other owners' session streams, `pairing`, `device`) are ended within 1 second; and, on a demotion, approvals waiting only for that device as resolver are re-routed by the resolver rule. There is no core credential to rotate and no fallback path. Client UI SHALL hide or disable controls whose scope the device lacks and SHALL show the tooltip "Your role on this host does not allow this". Host settings pages and notification categories are gated by: read → `jagentchill.config.read`; change → `jagentchill.config.write`; secrets → `jagentchill.secrets.manage`; devices and pairing → `jagentchill.devices.manage`; terminal → `jagentchill.host.exec`. [CAPCUT CC-268, CC-270] [NEW]

#### Scenario: Viewer downloads media
- **WHEN** a `viewer` device requests a blob with a valid signature
- **THEN** the download succeeds

#### Scenario: Viewer uploads media
- **WHEN** the same device calls blob `init`
- **THEN** the response is HTTP 403 `SCOPE_DENIED` with `requiredScope` `jagentchill.media.write`

#### Scenario: Editor opens device management
- **WHEN** an `editor` opens `/devices`
- **THEN** the device list is shown read-only with only this device's own "Rename" and "Forget this host" actions enabled

#### Scenario: Editor cannot open a terminal
- **WHEN** an `editor` device calls `jagentchill.terminal.open`
- **THEN** the response error code is `SCOPE_DENIED` with `details.requiredScope` `jagentchill.host.exec`

#### Scenario: Demotion takes effect at once
- **WHEN** an admin changes a device from `editor` to `viewer` while that device is streaming a chat turn it started
- **THEN** within 1 second the device receives `jagentchill.device.updated`, its next `jagentchill.chat.send` answers `SCOPE_DENIED` with `details.requiredScope` `jagentchill.agent.use`, and no call other than to the server's own store was needed

#### Scenario: No device holds an OpenClaw scope
- **WHEN** the conformance case `no-openclaw-credential` inspects the server store, OpenClaw's pairing store and every frame sent to an `admin`, an `editor` and a `viewer` device during pairing and one chat turn
- **THEN** no device has an OpenClaw pairing, token or scope, and no frame contains one

### Requirement: Device token issuance
The server SHALL issue a **device token** when the verification code is accepted (state `paired`): 32 CSPRNG bytes encoded base64url, bound to the device's public key, valid for 30 days (`expires_ms` returned with it). The Gateway SHALL store only the SHA-256 digest of the token. The client SHALL store it in the same protected storage as the device key (web: IndexedDB database `jagentchill-identity`). The token SHALL be presented only in the channel P `prove` frame (and in the fallback `handshake/prove` body); signed HTTP requests carry no token. A token SHALL never be sufficient by itself: every connection SHALL also complete the signed handshake with the bound key, and a token presented with a handshake from a different key SHALL be refused with `TOKEN_INVALID`. The lifetime numbers are those of design D7.5: validity 30 days, rotation when fewer than 7 days remain (`device-pairing-signing.Device token rotation`), and an expired token that is the last one issued to the device SHALL be accepted together with a valid signature for up to 90 days after its expiry and replaced in `ready`; after that, or when the presented value was never the device's current or previous token, the handshake fails with `TOKEN_EXPIRED` or `TOKEN_INVALID` and the device needs a new pairing. Signed HTTP requests from a device whose current token expired more than 90 days ago SHALL be refused with `TOKEN_EXPIRED`. It is the only credential a device ever holds for a host; a device holds no OpenClaw token. The six-digit code SHALL never be stored or replayed by the client after enrolment. [JAD] [NEW]

#### Scenario: Token issued at verification
- **WHEN** the verification code is accepted
- **THEN** the response carries `deviceToken.value` and `expires_ms` 30 days ahead, and the Gateway database contains the token's digest and not the token

#### Scenario: Token with another key
- **WHEN** device B presents device A's valid token with B's correct signature
- **THEN** the connection is closed with code 4401 and reason `TOKEN_INVALID`

#### Scenario: Expired token within the renewal period
- **WHEN** a paired, unrevoked device connects with its last token, expired 10 days ago, and a valid signature
- **THEN** `ready` carries a new `deviceToken` and the connection proceeds without a new verification code

#### Scenario: Device absent for a long time
- **WHEN** a device connects with a token that expired 91 days ago
- **THEN** the connection is closed with code 4401 and reason `TOKEN_EXPIRED`, and the client shows "Pairing required"

### Requirement: Device token rotation
The Gateway SHALL rotate the device token by sending a new `deviceToken { value, expires_ms }` in `ready` when fewer than 7 days of validity remain, when the presented token is expired within the renewal period, and after an admin chose "Rotate token" for that device in the device list (`jagentchill.device.token.rotate`, scope `jagentchill.devices.manage`, or any device for itself). The previous value SHALL remain valid until the new value has been presented once and for 60 000 ms after that, and SHALL then be rejected with `TOKEN_INVALID`; this makes a rotation whose `ready` frame was lost harmless. A client SHALL store a received token before sending its first `req` on that connection. The device token is the only token a device holds for a host, so rotating it rotates everything. [NEW]

#### Scenario: Scheduled rotation
- **WHEN** a client connects with a token that has 6 days left
- **THEN** `ready` carries a new token, the client stores it, and presents it on the next connection

#### Scenario: Old token after the grace period
- **WHEN** the previous token is presented 61 seconds after the new one was first presented
- **THEN** the connection is closed with code 4401 and reason `TOKEN_INVALID`

#### Scenario: Rotation interrupted
- **WHEN** the connection drops after the Gateway rotated and before the client stored the new token
- **THEN** the client's old token is accepted on the next connection, and that `ready` carries a new token again

### Requirement: Reconnect handshake
Every connection after enrolment, including every reconnect, SHALL follow this sequence: (1) select the address by `device-pairing-signing.Address kinds and selection order` (starting the embedded tailnet node or the desktop tailnet proxy for a `tailnet` candidate) and apply the transport rules of `security-privacy.Transport protection`, including the `tlsSha256` pin for a `lan` address on desktop and mobile; (2) open channel P and complete `device-pairing-signing.Channel P handshake` with a fresh `gatewayNonce` and a fresh `deviceNonce`; (3) resubscribe or resume streams (`device-pairing-signing.Session resume`), including the agent session streams of `server-api.Agent stream events and gap recovery`. There is no second connection to open: a client SHALL NOT open OpenClaw's native WebSocket, SHALL NOT send anything to an address on which the Gateway signature has not been verified in the current connection attempt, SHALL NOT create a pairing request or send a verification code on reconnect, and SHALL NOT accept an unsigned fallback. The client SHALL wait up to 10 000 ms for the `challenge` frame and SHALL abort the connection if none arrives. [JAD] [NEW]

#### Scenario: Reconnect uses new nonces
- **WHEN** a device reconnects 3 times
- **THEN** the three transcripts contain three different `gatewayNonce` values and three different `deviceNonce` values, and none creates a pairing request

#### Scenario: One connection carries everything
- **WHEN** a client connects to a stored host, opens a project and runs a chat turn
- **THEN** a network capture shows one WebSocket to `/jagentchill/v1/ws` plus signed HTTP requests under `/jagentchill/v1/`, and no other connection to the host

#### Scenario: Challenge never arrives
- **WHEN** the server sends no `challenge` within 10 seconds
- **THEN** the client closes the socket, sends no token, project, media or chat data, and schedules a retry by the backoff in `device-pairing-signing.Connection liveness and backoff`

#### Scenario: Connection lost during a turn
- **WHEN** channel P closes while a chat turn is streaming
- **THEN** the client shows the connection state "Connecting…", the turn keeps running on the host, and after the reconnect the client recovers the missed stream items by the gap rule of `server-api.Agent stream events and gap recovery`

### Requirement: Connection liveness and backoff
A client SHALL reconnect after an unexpected close with delay `min(1500 × 2^attempt, 30000)` ms multiplied by a random factor between 0.8 and 1.2, with `attempt` reset to 0 after a connection that stayed `ready` for 30 seconds. The connect timeout SHALL be 15 000 ms. Liveness on channel P follows `server-api.Channel P liveness` (ping after 15 000 ms of silence, close after 45 000 ms). The client SHALL force an immediate reconnect check when the app returns to the foreground and when the network interface changes. On disconnect every pending RPC SHALL be rejected with `UNAVAILABLE` (retryable). The client SHALL map close codes as: 4403 → "Revoked", no automatic retry; 4426 → "Update required" (reason `PROTOCOL_UNSUPPORTED:client` → "Update JAgentChill on this device"; `PROTOCOL_UNSUPPORTED:gateway` → "Update the host"), no automatic retry; 4401 with reason `TOKEN_EXPIRED`, `TOKEN_INVALID` or `DEVICE_UNKNOWN` → "Pairing required", no automatic retry; 4429 → retry after 60 seconds; every other close → backoff. The client SHALL NOT retry automatically after `GATEWAY_SIGNATURE_INVALID` or `GATEWAY_MISMATCH`. The UI SHALL show the connection state as exactly one of "Connected", "Connecting…", "Offline — retrying in N s" (with a "Retry now" action), "Pairing required", "Revoked", "Update required", or "Local only" (no host paired); other capabilities reference these labels and add none. A clock difference above 120 000 ms is shown as a persistent notice, not as a state. [JAD]

#### Scenario: Backoff sequence
- **WHEN** the Gateway is unreachable for 5 consecutive attempts
- **THEN** the nominal delays before attempts are 1.5 s, 3 s, 6 s, 12 s and 24 s, each within ±20 %, and subsequent delays do not exceed 36 s

#### Scenario: App resumes from background
- **WHEN** a mobile app returns to the foreground after 10 minutes suspended
- **THEN** it verifies liveness within 1 second and reconnects if the socket is dead, without waiting for a backoff timer

#### Scenario: Revoked device does not loop
- **WHEN** a channel P connection closes with code 4403
- **THEN** the client stops reconnecting to that host and shows "Revoked"

#### Scenario: Protocol too old
- **WHEN** a channel P connection closes with code 4426
- **THEN** the client shows "Update required" and does not reconnect automatically

### Requirement: Connection path indicator
Wherever the connection state of a host is shown (sidebar host chip, host list, `/devices`, connection diagnostics), the client SHALL also show the path in use as one of "This computer" (`loopback`), "Local network" (`lan`) or "Tailnet" (`tailnet`), with an icon and text. The Gateway SHALL tag every channel P connection and signed request with `transport` in `loopback`, `lan`, `tailnet`, taken from the listener it arrived through and the peer attribution of `server-api.Product listeners and path restriction` (never guessed from a port number), SHALL return it in `ready.transport`, and SHALL show it per device in the device list and in pairing request cards beside the real source address (for `tailnet`: the peer's tailnet node name). A path change during a session SHALL update the indicator within 2 seconds and SHALL be recorded in the client's connection history. [JAD] [NEW]

#### Scenario: Path shown on the client
- **WHEN** a phone is connected through its embedded tailnet node
- **THEN** the host chip reads "Connected" with the path "Tailnet"

#### Scenario: Path shown to the admin
- **WHEN** a pairing request arrives through the tailnet listener
- **THEN** the request card on the trusted device shows transport "Tailnet" and the peer's tailnet node name

#### Scenario: Path change
- **WHEN** a laptop moves from the host's Wi-Fi to a mobile hotspot and reconnects through the tailnet proxy
- **THEN** the indicator changes from "Local network" to "Tailnet" within 2 seconds of the reconnect

### Requirement: Session resume
The Gateway SHALL keep a disconnected connection's subscriptions and stream cursors for a grace period of 90 000 ms keyed by `deviceId` and the client-generated `clientInstanceId` (`cid_<uuid>`, not a credential, sent in `hello`). A reconnect with the same `clientInstanceId` within the grace period that completes the handshake SHALL have its subscriptions restored — including its agent session stream subscriptions, re-checked against `server-api.Session ownership and visibility` at resume time — and `ready` SHALL carry `resumed: true` with, for each stream named in `hello.resume.streams`, the current `seq`; the client pulls only streams whose `seq` advanced. Otherwise `ready` carries `resumed: false` and the client SHALL resubscribe and refetch by cursor. Edit lease expiry is governed solely by `cross-device-sync.Single-writer edit lease` and is not extended by the grace period. Several connections of one device (for example two browser tabs, each with its own `clientInstanceId`) SHALL be allowed up to the limit of 8 in `server-api.Channel P WebSocket endpoint` and SHALL share the device's scopes. [JAD] [NEW]

#### Scenario: Resume within the grace period
- **WHEN** a device reconnects 20 seconds after a drop with the same `clientInstanceId`
- **THEN** `ready` has `resumed: true` and the client pulls only the streams whose `seq` advanced

#### Scenario: Resume after the grace period
- **WHEN** the device reconnects after 91 seconds
- **THEN** `ready` has `resumed: false` and the client resubscribes to every stream

#### Scenario: Another device's instance id
- **WHEN** device B presents a `clientInstanceId` belonging to device A
- **THEN** no state of device A is attached and B receives `resumed: false`

### Requirement: Per-request HTTP signature
Every signed HTTP request SHALL carry four headers: `X-JAgentChill-Device` (`deviceId`), `X-JAgentChill-Timestamp` (Unix UTC milliseconds, decimal), `X-JAgentChill-Nonce` (base64url, no padding, of 16 CSPRNG bytes) and `X-JAgentChill-Signature` (base64url of the Ed25519 signature). The signed canonical string SHALL be the UTF-8 bytes of these seven lines joined by `\n` with no trailing line feed: `JAGENTCHILL-REQUEST-V1`; `<gatewayId>` (of the Gateway the request is meant for); `<METHOD>` (upper case); `<path+query>` (the request target exactly as sent, including the query string, without scheme or host); `<bodyHash>` (lowercase hex SHA-256 of the exact request body bytes; the digest of the empty string for a request without a body); `<ts>`; `<nonce>`. Including `gatewayId` makes a request signed for one Gateway invalid on every other Gateway the same device key is paired with. The Gateway SHALL verify in order: all four headers present (`SIGNATURE_MISSING`, HTTP 401); device known (`DEVICE_UNKNOWN`, 401) and not revoked (`DEVICE_REVOKED`, 403); device token record not expired beyond the renewal period (`TOKEN_EXPIRED`, 401); timestamp within the window (`CLOCK_SKEW`, 401); nonce unused (`NONCE_REPLAYED`, 401); body hash equal to the hash of the received body and signature valid over a canonical string built with its own `gatewayId` (`SIGNATURE_INVALID`, 401); scope held (`SCOPE_DENIED`, 403). The body SHALL be hashed while it is received and the handler's side effects SHALL be committed only after the signature is verified. On mobile, body hashing uses `JagentchillCrypto.sha256File` or `sha256Bytes`, never a JavaScript implementation. The unsigned exceptions are the closed list of `server-api.Unsigned route exceptions`. [NEW]

#### Scenario: Valid signed download
- **WHEN** a paired device sends `GET /jagentchill/v1/blobs/<hash>` with a correct signature over the seven-line string using the empty-body hash
- **THEN** the response is HTTP 200 or 206

#### Scenario: Body altered in transit
- **WHEN** a chunk upload's body differs by one byte from the body whose hash was signed
- **THEN** the response is HTTP 401 `SIGNATURE_INVALID` and no chunk is stored

#### Scenario: Query string altered
- **WHEN** the query string of a signed request is changed after signing
- **THEN** the response is HTTP 401 `SIGNATURE_INVALID`

#### Scenario: Cross-Gateway replay
- **WHEN** a request signed for Gateway A is forwarded unchanged within 120 seconds to Gateway B, with which the same device is also paired
- **THEN** Gateway B answers HTTP 401 `SIGNATURE_INVALID`

#### Scenario: Signature reused for another method
- **WHEN** headers captured from a `GET` are replayed on a `PUT` to the same path
- **THEN** the response is HTTP 401 (`NONCE_REPLAYED` if the nonce was already consumed, otherwise `SIGNATURE_INVALID`)

### Requirement: Clock-skew window
The Gateway SHALL accept a signed HTTP request only when `|gatewayNow_ms − ts| ≤ 120 000`. A client SHALL learn its clock offset to a Gateway only from a Gateway-signed `ts`: the `ts` of a handshake transcript whose `gatewaySignature` verified over this exchange's fresh `deviceNonce`. No response header carries server time for this purpose, and `health.time_ms` SHALL NOT be used. At enrolment (context `enrol:`) the device stores `verifiedClockOffset_ms = ts − deviceNow`. On a `connect` handshake the device SHALL reject a `challenge` whose `ts` differs from its own clock by more than 120 000 ms unless `ts − deviceNow` equals the stored offset within ±5 000 ms; on rejection it shows the notice "This device's clock differs from the host by N minutes" (N rounded to the nearest minute) with the actions "Open date and time settings" and "Use the host's time", the second of which stores the new offset and reconnects. Every signed request SHALL use `ts = deviceNow + verifiedClockOffset_ms`. On `CLOCK_SKEW` from a signed route the client SHALL re-run the channel P handshake once to refresh the offset and retry the request exactly once with a new nonce. [NEW]

#### Scenario: Inside the window
- **WHEN** a request's timestamp is 119 000 ms behind the Gateway clock
- **THEN** the request is accepted

#### Scenario: Outside the window
- **WHEN** a request's timestamp is 121 000 ms ahead
- **THEN** the response is HTTP 401 `CLOCK_SKEW` and carries no server-time header

#### Scenario: Slow device clock with a stored offset
- **WHEN** a device whose clock is 5 minutes slow, and whose stored offset is +300 000 ms, sends signed requests
- **THEN** the requests are accepted and the notice shows a 5-minute difference

#### Scenario: Unauthenticated time is ignored
- **WHEN** a server at the Gateway's address answers a signed request with `CLOCK_SKEW` and a header claiming a time one hour ahead
- **THEN** the client does not change its offset from that response and signs no request for that time

### Requirement: Nonce replay cache
The Gateway SHALL record every accepted request nonce per device and SHALL reject a repeated `(deviceId, nonce)` pair with `NONCE_REPLAYED`. Entries SHALL be retained for 250 000 ms (longer than the full 240 000 ms span of the skew window) and limited to 100 000 live entries per device; a device exceeding that limit SHALL receive `RATE_LIMITED` until entries expire. The in-memory set is authoritative and SHALL be persisted in batches at most every 1 000 ms; after a restart the Gateway SHALL reject with `CLOCK_SKEW` any request whose `ts` is earlier than its own start time, which closes the replay window for the unpersisted last second (clients retry with a fresh `ts`). A nonce that is not 16 decoded bytes SHALL be rejected with `SIGNATURE_INVALID`. [NEW]

#### Scenario: Immediate replay
- **WHEN** an identical signed request is sent twice
- **THEN** the first succeeds and the second receives HTTP 401 `NONCE_REPLAYED`

#### Scenario: Replay across a restart
- **WHEN** a captured request is replayed 20 seconds after it was accepted and the Gateway restarted in between
- **THEN** the response is HTTP 401 (`NONCE_REPLAYED` or `CLOCK_SKEW`) and the handler does not run

#### Scenario: Replay after the window
- **WHEN** a captured request is replayed 6 minutes after it was signed
- **THEN** the response is `CLOCK_SKEW`

#### Scenario: Fast local transfer is not throttled
- **WHEN** the desktop app uploads to its own Gateway at 400 MiB/s in 4 MiB chunks for 5 minutes
- **THEN** no request receives `RATE_LIMITED` from the nonce limit

### Requirement: Loopback connections are not exempt
A request or connection whose source address is loopback, a Unix socket or a named pipe SHALL be subject to exactly the same handshake, token, scope, session-ownership and per-request signature rules as a remote one (design D7.9). OpenClaw relaxes several checks for loopback peers and admits device-less local clients that hold the shared Gateway token, so the defence is in the server and in the topology: (1) the server SHALL refuse every caller that has no record in its own device table (it does not read OpenClaw approval metadata), with two exceptions that are not client surfaces — the local admin endpoint of `server-api.Host command-line surface`, an owner-only socket or pipe that carries only `jagentchill.hostcli.*` methods, and the agent tool endpoint of `server-api.Agent tool endpoint and session binding`, which serves only the Gateway; (2) the Gateway's native port is bound to loopback at every Network access level and nothing on a network can reach it — remote peers arrive only through the product listeners, which forward `/jagentchill/` paths and mark every forwarded request as forwarded, so a remote peer is never classified as a local client by the server (`server-api.Product listeners and path restriction`); (3) the run profile SHALL set `gateway.nodes.pairing.autoApproveLocal` to `false`, `gateway.auth.mode` to `"token"` with a token that never leaves the host, and `gateway.auth.rateLimit.exemptLoopback` to `false` (`platform-skeleton.Gateway run profile`), and the server SHALL report health reason `run_profile_violation` when any of them differs. The only processes that use the native port are the server (over its gateway link) and the host's own `openclaw` CLI. The desktop app's own renderer SHALL connect to the server the app started through the signed handshake using the key held by the main process. The shared Gateway token SHALL never be sent to any client, including the desktop renderer. [NEW]

#### Scenario: Unsigned local client
- **WHEN** a process on the Gateway host opens `ws://127.0.0.1:18910/jagentchill/v1/ws` with the shared Gateway token and sends a `req` frame
- **THEN** the connection is closed with code 4401 and every protected route returns HTTP 401 to that process

#### Scenario: Local HTTP request without signature
- **WHEN** `curl http://127.0.0.1:18910/jagentchill/v1/exports/<jobId>/file` is run on the host
- **THEN** the response is HTTP 401 `SIGNATURE_MISSING`

#### Scenario: Auto-approval left enabled
- **WHEN** the Gateway configuration has local auto-approval enabled
- **THEN** `GET /jagentchill/v1/health` lists `run_profile_violation` and `jagentchill doctor` fails the `pairing-policy` check

#### Scenario: Device known only to OpenClaw
- **WHEN** a device is paired in OpenClaw's own store by the operator's CLI and has no JAgentChill device record
- **THEN** its channel P handshake is closed with code 4401 and reason `DEVICE_UNKNOWN`

#### Scenario: Native port from the network
- **WHEN** a machine on the LAN or the tailnet connects to the host's address on the Gateway's native port, at each Network access level
- **THEN** the connection is refused, because the port listens on loopback only

### Requirement: Revocation
`jagentchill.device.revoke` (scope `jagentchill.devices.manage`, or any device for its own record) and the host CLI SHALL revoke a device entirely inside the server (design D7.8) — a device has no OpenClaw pairing, so nothing has to be removed from the Gateway, and no step of revocation can fail on a core call or wait for the Gateway: revocation completes while the Gateway is down. In one transaction of the server's own store the server SHALL mark the record revoked and delete its token digests, its push token and its pending pairing state; from that instant, and completed within 2 seconds: (1) every channel P frame and every signed route refuses the device with `DEVICE_REVOKED`; (2) its channel P connections are closed with code 4403 and reason `DEVICE_REVOKED` and its fallback event streams are ended; (3) its in-flight HTTP transfers are aborted; (4) every relayed call the server is making to the Gateway on the device's behalf is abandoned — the result is discarded and never delivered — and every agent stream subscription of the device is removed; (5) every agent turn the device started that is still running is aborted over the gateway link (and, while the link is down, as soon as it is ready again, the turn being closed for every device at once), unless another non-revoked device owns the session and the turn was not started by the revoked device; (6) approvals and questions waiting for an answer in sessions whose only permitted resolver was the revoked device are re-routed by `server-api.Approval and question resolution`, and an answer the device sent that is still being processed is discarded; (7) any edit lease it holds is released (`cross-device-sync.Single-writer edit lease`); (8) sessions it owned stay on the host with owner state `orphaned`, readable and assignable only by an `admin` (`server-api.Session ownership and visibility`). The server SHALL emit `jagentchill.device.revoked` to devices holding `jagentchill.devices.manage` and raise the notification kind `device.revoked` of capability `notifications` to the remaining admin devices. Every subsequent request signed by the revoked key SHALL be refused with `DEVICE_REVOKED`; re-admission SHALL require a full new pairing with a new verification code. (9) every queue job the device started and that has not finished (generation, export, transfer, workflow run, team run) SHALL be cancelled with reason `device_revoked` through `server-api.Job cancellation and restart recovery`; jobs started by other devices, by automations owned by other devices, and host batches not started by the revoked device are unaffected. The last remaining `admin` device SHALL NOT be revocable or demotable through RPC (`LAST_ADMIN`); the host CLI is exempt. [NEW]

#### Scenario: Live sockets dropped
- **WHEN** an admin revokes a phone that has an open channel P connection with a streaming chat turn it started and a blob download in progress
- **THEN** within 2 seconds channel P closes with code 4403, the download connection is aborted, the turn is aborted on the host, and the phone shows "Revoked"

#### Scenario: Revoked key retries
- **WHEN** the revoked phone attempts the channel P handshake again
- **THEN** the connection is closed with code 4403 and reason `DEVICE_REVOKED`

#### Scenario: Revocation needs no core call
- **WHEN** the conformance case `revocation-server-only` revokes a device while the Gateway is stopped and every core call fails
- **THEN** the device is still refused on every frame and route within 2 seconds and health lists no orphan reason

#### Scenario: Pending approval answer from a revoked device
- **WHEN** an `admin` phone is revoked 200 ms after it sent "Allow" for a host-execution approval that has not been applied yet
- **THEN** the answer is discarded, the command does not run, and the approval is offered to the remaining admin devices

#### Scenario: Revoking the only admin
- **WHEN** the sole admin tries to revoke or demote its own device
- **THEN** the response is `LAST_ADMIN` and the UI explains "Pair or promote another admin device first"

#### Scenario: Lease released
- **WHEN** the revoked device held the edit lease of a project
- **THEN** the lease is free within 2 seconds and another editor can acquire it

### Requirement: Client behaviour after revocation
When a client learns that it was revoked (close code 4403 or `DEVICE_REVOKED` on a route), it SHALL keep every local project and media file; convert every project synced with that host to "On this device only", folding any offline branch into the local state; cancel queued and running transfers to that host; delete cached host-only data (session transcripts, job lists, host settings) and the device token for that host; keep the host registry entry marked "Revoked" until the user removes it; and show once "This device was removed from <host name>". It SHALL NOT delete the device key. [NEW]

#### Scenario: Revoked with offline changes
- **WHEN** a phone holding "Offline changes (4)" on a synced project is revoked
- **THEN** the project stays openable with the 4 changes applied, shows "On this device only", and no upload is attempted

#### Scenario: Cached host data removed
- **WHEN** revocation is processed on a client
- **THEN** the cached session list of that host is empty and the device key is still present

### Requirement: Unpair from the client side
A client SHALL offer "Forget this host" for each stored host (the same label on every platform). When the host is reachable the client SHALL call `jagentchill.device.revoke` for its own `deviceId` and then apply `device-pairing-signing.Client behaviour after revocation` and delete the host entry; when unreachable it SHALL delete the local items and show "The host still lists this device; remove it from the device list when it is reachable". Local projects and media SHALL be kept. The device key SHALL be kept unless the user also chooses "Reset device identity", which SHALL delete the key and mark all stored hosts "Pairing required". [NEW]

#### Scenario: Forget while online
- **WHEN** the user confirms "Forget this host" with the host connected
- **THEN** the host's device list no longer shows the device as active and the client's host list no longer contains the host
- **AND** local projects still open

#### Scenario: Forget while offline
- **WHEN** the host is unreachable
- **THEN** the local entry and tokens are removed and the notice about the remaining host-side record is shown

### Requirement: Device key rotation
A paired desktop or mobile device SHALL be able to replace its key without a new pairing through `jagentchill.device.key.rotate { newDevicePublicKey, ts, signatureByOldKey, signatureByNewKey }` on a `ready` channel P connection that was authenticated with the OLD key. Both signatures cover the rotation statement, the UTF-8 string of five lines `JAGENTCHILL-ROTATE-V1`, `<gatewayId>`, `<oldDeviceId>`, `<newDevicePublicKey>`, `<ts>` (within ±120 000 ms of the Gateway clock); the Gateway SHALL verify `signatureByOldKey` with the public key of the calling record (so only the holder of the old private key can move the identity), `signatureByNewKey` with `newDevicePublicKey` (proof of possession), that the new key is not already a device record, and that the statement names this Gateway. The four values come only from the signer's `rotate` kind (`device-pairing-signing.Structured signing interface`), which generates the new key inside the protected store after a user-presence confirmation and accepts no key from its caller; application code cannot rotate to a key it chose. On success the server SHALL, in one transaction, create the record for the new `deviceId` with the same role, name and `localSupervisor` flag, revoke the old record by the steps of `device-pairing-signing.Revocation` except that sessions, leases and subscriptions of the old record are re-attached to the new one, and issue a new device token for the new key; it SHALL write the `security` audit record `device.key_rotated` with both fingerprints, the source address and the connection path, and raise the notification kind `device.key_rotated` to every `admin` device (the rotating device included), whose card offers "Revoke this device" — so a rotation nobody asked for is visible to a person within the notification delivery time. At most 1 rotation per device per 24 hours SHALL be accepted (`RATE_LIMITED` otherwise). The action "Rotate device key" SHALL be offered per installation on desktop (macOS, Windows, Linux) and mobile (iOS, Android), and SHALL rotate against each reachable host in turn with the same pending new key; hosts that were unreachable keep the old key until they are reachable, during which the client holds two key pairs, and the old key is deleted only when no stored host still uses it or the user forgot those hosts. On web, rotation is not offered: a browser's key cannot be protected by a user-presence prompt outside page script, so the remedy for non-persistent storage is a new pairing, and `jagentchill.device.key.rotate` from a record whose `platform` is `web` is refused with `UNSUPPORTED_FEATURE`. [NEW]

#### Scenario: Rotation keeps the role
- **WHEN** an `editor` phone rotates its key
- **THEN** the new record has role `editor` and the same name, the old `deviceId` is refused with `DEVICE_REVOKED`, the session the phone owned is still owned by it, and no verification code was needed

#### Scenario: Missing old-key signature
- **WHEN** the request carries a valid `signatureByNewKey` and an invalid `signatureByOldKey`
- **THEN** the response is `DEVICE_SIGNATURE_INVALID` and no record changes

#### Scenario: Old-key signature from another device
- **WHEN** device B calls `jagentchill.device.key.rotate` with a statement signed by device A's old key
- **THEN** the response is `DEVICE_SIGNATURE_INVALID`, because the statement's `oldDeviceId` and signature must match the calling record

#### Scenario: Admins are told
- **WHEN** a rotation succeeds
- **THEN** every admin device receives the `device.key_rotated` notification naming the device and the path it came from, and the audit log holds `device.key_rotated` with the old and new fingerprints

#### Scenario: Rotation from a browser
- **WHEN** a web client calls `jagentchill.device.key.rotate`
- **THEN** the response error code is `UNSUPPORTED_FEATURE` and the web connection settings show "Pair this browser again" instead of "Rotate device key"

#### Scenario: Host unreachable during rotation
- **WHEN** a laptop paired with hosts A and B rotates while B is offline
- **THEN** A uses the new key at once, the laptop keeps both keys, and B is rotated with the same new key on its next successful connection

### Requirement: Device list management
The screen at route `/devices` (route owned by capability `app-shell-navigation`; content owned here; settings pages link to it) SHALL list every device record of the connected host with: name, platform icon, role, connection state (green dot "Online", grey dot "Offline"), last seen (relative time, absolute time on hover or long-press), paired date, last source address and connection path, key fingerprint (first 16 hex characters of `deviceId`, grouped in fours), the key protection ("System store", "Hardware keystore", "Browser" or "Key stored in a file", from `keyProtection` of `device-pairing-signing.Per-platform device key storage`), the "This computer's app" tag on the record flagged `localSupervisor` and a "This device" badge on the client's own row. The list SHALL be sorted with this device first, then online devices, then by `lastSeen_ms` descending, and SHALL update within 1 second of a device connecting, disconnecting, pairing or being revoked. A device not seen for 90 days SHALL carry an "Inactive" badge. Admin actions per row SHALL be: Rename (1 to 64 characters, trimmed, duplicates allowed), Change role, Rotate token, Revoke (confirmation dialog naming the device and stating that it disconnects immediately); list-level actions SHALL be "Pair a device" and "Revoke all other devices" (confirmation requires typing the count of devices). While the list loads a skeleton of 3 rows SHALL be shown; a load failure SHALL show the error with "Retry". Selecting a row SHALL open the device detail at route `/devices/[deviceId]` (a side panel at the `wide` breakpoint, a full screen otherwise), which shows every field of the row in full, the complete key fingerprint with "Copy", app version, platform, the connection path of each open connection (`device-pairing-signing.Connection path indicator`), whether the device registered for push, the last 20 `security` audit records whose target is that device (admin devices only), and the same actions as the row; an unknown `deviceId` shows "This device is no longer paired" with a link back to `/devices`. Settings pages never embed a second device list: they link to `/devices`. The data comes from `jagentchill.device.list` and `jagentchill.device.get` (`device-pairing-signing.Pairing and device RPC surface`). [CAPCUT CC-267, CC-268] [NEW]

#### Scenario: Rename
- **WHEN** an admin renames a device to "Studio iPad"
- **THEN** the new name appears on all connected admin clients within 1 second and in the audit log

#### Scenario: Invalid name
- **WHEN** the name is empty after trimming or longer than 64 characters
- **THEN** the Save action is disabled and the field shows "Name must be 1–64 characters"

#### Scenario: Change role
- **WHEN** an admin changes a device from `viewer` to `editor` and confirms
- **THEN** the row shows `editor` within 1 second and that device's editing controls become enabled without reconnecting channel P

#### Scenario: Inactive badge
- **WHEN** a device's `lastSeen_ms` is 91 days old
- **THEN** its row carries the "Inactive" badge

#### Scenario: Revoke all others
- **WHEN** an admin with 4 other devices types `4` and confirms "Revoke all other devices"
- **THEN** the 4 devices are revoked, their channel P connections closed within 2 seconds, and the list shows only this device

#### Scenario: Only this device
- **WHEN** the host has one device
- **THEN** the list shows that row and the empty-state text "No other devices are paired" with a "Pair a device" button

### Requirement: Device list platform behaviour
On desktop and web at the `medium` and `wide` breakpoints of capability `design-system` the device list SHALL be a table with a trailing actions menu per row, fully operable by keyboard: arrow keys move between rows, Enter opens the row's action menu, Escape closes it, and every action has an accessible name including the device name. On mobile and at the `compact` breakpoint each device SHALL be a card; tapping a card opens a bottom sheet with the same actions, with Revoke styled as destructive and placed last. Pending pairing requests SHALL appear above the list on every platform as cards showing the six-digit code in a monospaced face at 28 px or larger with digits grouped 3 + 3, the 8-character device fingerprint, the countdown, the role selector and "Decline". Visual styling follows the tokens of capability `design-system`. [NEW]

#### Scenario: Keyboard revoke on desktop
- **WHEN** a keyboard user focuses a row, presses Enter, moves to "Revoke" and presses Enter
- **THEN** the confirmation dialog opens with focus on "Cancel", and Escape closes it without revoking

#### Scenario: Mobile action sheet
- **WHEN** a user taps a device card on a phone
- **THEN** a bottom sheet lists Rename, Change role, Rotate token and Revoke, in that order

#### Scenario: Code legibility
- **WHEN** a pairing request is pending
- **THEN** the code is rendered as two groups of three digits and is exposed to screen readers as six separate digits

### Requirement: Pairing and device RPC surface
The channel P methods and events of the domains `pairing` and `device` (`server-api.RPC domain ownership`) SHALL be exactly those listed in this requirement; enrolment itself uses the public routes of `device-pairing-signing.Enrolment over public server routes` and is not an RPC. Methods of domain `pairing`, all with scope `jagentchill.devices.manage`: `jagentchill.pairing.offer.create { role? }` → the offer of `device-pairing-signing.Pairing offer format` with its short code and web link; `jagentchill.pairing.offer.cancel { offerId }`; `jagentchill.pairing.request.list` (the pull RPC of stream `pairing`); `jagentchill.pairing.request.setRole { requestId, role }`; `jagentchill.pairing.request.decline { requestId }`; `jagentchill.pairing.subscribe` and `jagentchill.pairing.unsubscribe`. Methods of domain `device`: `jagentchill.device.list` and `jagentchill.device.get { deviceId }` (scope `jagentchill.devices.manage` for all devices; any device is allowed to read its own record, which is also how a client learns its current role), `jagentchill.device.rename { deviceId, name }`, `jagentchill.device.role.set { deviceId, role }`, `jagentchill.device.token.rotate { deviceId }`, `jagentchill.device.revoke { deviceId }` and `jagentchill.device.revokeOthers { confirmCount }` (scope `jagentchill.devices.manage`; rename, token rotation and revoke are also allowed to a device for its own record), `jagentchill.device.key.rotate` (the calling device only, `device-pairing-signing.Device key rotation`), and `jagentchill.device.subscribe` and `jagentchill.device.unsubscribe` (stream `device`; pull RPC `jagentchill.device.list`). Events: `jagentchill.pairing.requested` and `jagentchill.pairing.completed` on stream `pairing`; `jagentchill.device.updated` (to the device concerned on every connection without subscription, and to subscribers holding `jagentchill.devices.manage`) and `jagentchill.device.revoked` on stream `device`. State-changing methods are audited (`server-api.Audit log`), `offer.create` and `revokeOthers` require an `idempotencyKey`, and none of these methods takes or returns a token, key or verification code other than the fields named by the requirements above. No method of these domains issues, approves or returns an OpenClaw credential. No other method SHALL exist in these two domains. [NEW]

#### Scenario: Editor lists devices
- **WHEN** an `editor` device calls `jagentchill.device.list`
- **THEN** the response error code is `SCOPE_DENIED` with `details.requiredScope` `jagentchill.devices.manage`
- **AND** `jagentchill.device.get` for its own `deviceId` succeeds and returns its role and scopes

#### Scenario: Role preset changed before verification
- **WHEN** an admin calls `jagentchill.pairing.request.setRole` with `viewer` on a pending request and the code is then verified
- **THEN** the device record is created with role `viewer`

#### Scenario: Revoke all other devices
- **WHEN** an admin with 4 other paired devices calls `jagentchill.device.revokeOthers { confirmCount: 4 }`
- **THEN** the 4 devices are revoked through the steps of `device-pairing-signing.Revocation` and the caller stays paired
- **AND** a call with `confirmCount` 3 is refused with `INVALID_PARAMS` and revokes nothing

#### Scenario: Method outside the list
- **WHEN** server code adds a handler `jagentchill.device.setScopes`
- **THEN** the contract test `rpc-ownership` fails and names the method

### Requirement: Pairing flow on the new device
The new device's pairing flow SHALL progress through these states with a visible step indicator, identically on iOS, Android, macOS, Windows, Linux and web except where stated: "Add a host" (capture the offer by scan, paste, deep link, web link or short code); "Sign in to Tailscale" (mobile and desktop only, and only under the conditions of `device-pairing-signing.Tailnet login step`); "Connecting to host" (spinner; address attempts raced as in `device-pairing-signing.Address kinds and selection order`); "Verifying host" (challenge and Gateway signature); "Enter the code shown next to <fingerprint>" (six input boxes, numeric keypad on mobile, remaining time mm:ss, attempts remaining after an error); "Paired" (host name, assigned role, connection path, "Done"). "Paired" is the end of the flow: every feature the role allows, including agent chat, works from the first connection with no further step. A "Cancel" action SHALL be available in every state before "Paired" and SHALL cancel the request on the Gateway when one exists. Every failure SHALL show the localised message for its error code, the code itself in small text, and either "Try again" (retryable) or "Start again" (requires a new offer). The offer SHALL be kept across an app restart or the Tailscale sign-in detour for as long as it is unexpired. [JAD] [NEW]

#### Scenario: Happy path timing
- **WHEN** a phone whose tailnet node is running scans a valid offer and the user types the correct code
- **THEN** excluding typing time, the flow reaches "Paired" in 5 seconds or less

#### Scenario: Cancel mid-flow
- **WHEN** the user taps "Cancel" on the code entry step
- **THEN** the request disappears from the trusted clients within 1 second

#### Scenario: Host unreachable
- **WHEN** no address in the offer answers
- **THEN** within 6 seconds the flow shows the message keyed `GATEWAY_UNREACHABLE` listing the address kinds tried, with "Try again" and, on mobile and desktop when a `tailnet` address exists and the node is not running, "Sign in to Tailscale"

#### Scenario: Chat right after pairing
- **WHEN** an `editor` device taps "Done" on "Paired" and opens the chat
- **THEN** the composer is enabled and no "agent connection" state is shown anywhere

### Requirement: Pairing abuse limits
The enrolment routes SHALL be limited per real peer address — the source address of a direct loopback connection, or the peer address attributed by the product listener for a request that arrived from the LAN or the tailnet (`server-api.Product listeners and path restriction`); the listener's own loopback address is never a rate-limit key, so one remote peer cannot exhaust a limit for the others — to 10 challenge requests and 5 short-code resolutions per 10 minutes; after 3 pairing requests from one peer address have ended in `CODE_ATTEMPTS_EXCEEDED` within 1 hour, that address SHALL be refused with `RATE_LIMITED` for 1 hour. After 10 failed short-code resolutions in total against the live offer, short-code resolution SHALL be disabled for that offer while its QR code and link stay valid. Exceeding a limit SHALL return HTTP 429 with `Retry-After`. Every lockout SHALL be written to the audit log and raised as the notification kind `pairing.lockout` of capability `notifications` (devices holding `jagentchill.devices.manage` only) with the text "Repeated failed pairing attempts from <address>". [NEW]

#### Scenario: Challenge flood
- **WHEN** one address sends 11 challenge requests in 10 minutes
- **THEN** the 11th receives HTTP 429 `RATE_LIMITED`

#### Scenario: Repeated lockouts
- **WHEN** three requests from one address each exhaust their 5 attempts within an hour
- **THEN** further enrolment from that address is refused for 1 hour and admin devices receive the `pairing.lockout` notification

#### Scenario: One tailnet peer cannot lock out the others
- **WHEN** tailnet peer A exhausts the challenge limit through the tailnet listener and tailnet peer B then starts an enrolment
- **THEN** A receives HTTP 429 and B's challenge succeeds, because the limits are keyed by each peer's own tailnet address

#### Scenario: Short code guessing
- **WHEN** 10 wrong short codes have been submitted against the live offer
- **THEN** the correct short code is refused with `RATE_LIMITED`, and the same offer's QR code still starts an enrolment

### Requirement: Remote access without public exposure
Remote access to a Gateway SHALL work as in JAgentDesk today: every client connects straight to the host, there is no relay or rendezvous server operated for or by the product, and reachability beyond the local network comes from tailnet nodes embedded in the product — the Gateway-side tailnet listener (`server-api.Tailnet ingress bridge`), the embedded node in the mobile app (iOS and Android) and the tailnet proxy in the desktop app (macOS, Windows, Linux) — joined to the user's own tailnet. The only third party on that path is the user's Tailscale coordination and relay (DERP) service, which carries WireGuard-encrypted traffic and is a row of `security-privacy.Network egress control`. The Gateway's native port SHALL listen on loopback only, always; the tailnet and LAN levels are explicit choices of an admin on the host (`device-pairing-signing.Offer addresses and reachability`) and expose only the product listeners, which forward only `/jagentchill/` paths. The server SHALL NOT open router ports, start a public tunnel or a public funnel, or register with any other relay; push notifications, when an admin enabled them, remain the documented exception for notification delivery only. A phone or desktop app SHALL NOT need the Tailscale app or the operating system's VPN to be installed or active (the only exception is the owner-approved S20 fallback of `device-pairing-signing.Embedded tailnet node on mobile`, which applies to iOS and Android together); a browser does (`device-pairing-signing.Web clients and the tailnet`). The application-layer authentication of design D7 (mutual Ed25519 authentication, six-digit code, device token, per-request signatures, revocation) SHALL apply unchanged on tailnet paths: membership of the tailnet grants reachability of the `/jagentchill/` paths only. [JAD] [NEW]

#### Scenario: Default serving
- **WHEN** a Gateway is started with the default configuration
- **THEN** it serves only loopback, no product listener and no tailnet bridge process runs, and no offer contains a non-loopback address

#### Scenario: No relay of our own
- **WHEN** pairing and one hour of use over a tailnet path are captured at the network level with push disabled
- **THEN** the Gateway host and the clients connect only to each other, to Tailscale coordination and DERP hosts, and to hosts enabled in the egress table

#### Scenario: Tailnet member without pairing
- **WHEN** another machine on the same tailnet, which is not a paired device, opens the host's tailnet address
- **THEN** it can reach only the unsigned exception routes under `/jagentchill/`, receives HTTP 404 for every other path including `/` and the native Gateway WebSocket, and cannot complete the channel P handshake

### Requirement: Pairing and signing error codes
The protocol package SHALL export this closed set of pairing and signing codes, referenced by the registry of `server-api.RPC error envelope`, with one localised message each in `en`, `vi` and `ja`: `OFFER_INVALID`, `OFFER_EXPIRED`, `OFFER_VERSION_UNSUPPORTED`, `GATEWAY_UNREACHABLE`, `GATEWAY_MISMATCH`, `GATEWAY_SIGNATURE_INVALID`, `CHALLENGE_UNKNOWN`, `CHALLENGE_EXPIRED`, `DEVICE_ID_MISMATCH`, `DEVICE_SIGNATURE_INVALID`, `DEVICE_UNKNOWN`, `PAIRING_LIMIT`, `PAIRING_CANCELLED`, `PAIRING_HOST_LIMIT`, `CODE_INVALID`, `CODE_EXPIRED`, `CODE_ATTEMPTS_EXCEEDED`, `SIGN_REFUSED`, `TOKEN_INVALID`, `TOKEN_EXPIRED`, `SIGNATURE_MISSING`, `SIGNATURE_INVALID`, `CLOCK_SKEW`, `NONCE_REPLAYED`, `LAST_ADMIN`, `KEY_STORAGE_UNAVAILABLE`, `WEBCRYPTO_UNSUPPORTED` (27 codes; `BOOTSTRAP_EXPIRED` does not exist). The general codes `DEVICE_REVOKED`, `DEVICE_NOT_ATTESTED`, `SCOPE_DENIED`, `PROTOCOL_UNSUPPORTED`, `UNSUPPORTED_FEATURE` and `RATE_LIMITED` are those of the registry. WebSocket close codes are only those of `server-api.Channel P close codes`; a client never sees a close code of OpenClaw's own socket. `GATEWAY_UNREACHABLE` carries `details.reason` in `no_address_answered`, `tls_pin_mismatch`, `web_requires_trusted_tls`, `origin_not_allowed`, `tailnet_login_required`, `tailnet_key_expired`. [JAD] [NEW]

#### Scenario: Every code is localised
- **WHEN** the locale parity test runs
- **THEN** each code in the set, and each `GATEWAY_UNREACHABLE` reason, has a non-empty message in `en`, `vi` and `ja`

#### Scenario: Unknown code from a newer Gateway
- **WHEN** a client receives an error code it does not know
- **THEN** it shows the generic message "Something went wrong (CODE)" with the raw code and offers "Try again" only when `retryable` is true

#### Scenario: Close code mapping
- **WHEN** a channel P socket closes with 4426 and reason `PROTOCOL_UNSUPPORTED:client`
- **THEN** the client shows "Update required" with the device-update action and does not reconnect automatically

### Requirement: Pairing protocol conformance tests
The repository SHALL contain an automated protocol test suite that runs a real JAgentChill Server supervising a real Gateway of the pinned tag, and a scripted client, and asserts every scenario of this capability that is expressible at the protocol level, including the named cases: `transcript-shape` (ten lines in the stated order), `bare-nonce-signature`, `cross-connection-challenge`, `gateway-impersonation`, `gateway-signature-replay` (recorded `challenge` frame), `code-attempt-limit` (fifth wrong code cancels the request), `code-not-broadcast` (an `editor` connection receives no code), `request-nonce-replay`, `request-cross-gateway-replay` (seven-line canonical string with `gatewayId`), `skew-boundary` (±120 000 ms accepted, ±120 001 ms rejected), `token-without-signature`, `token-renewal-window` (expired 89 days accepted with a signature, 91 days refused), `loopback-unsigned-refused`, `no-openclaw-credential` (no device has an OpenClaw pairing, token or scope after pairing and a chat turn), `single-connection` (a full session uses only `/jagentchill/` paths), `revocation-server-only` (revocation completes with the Gateway stopped and every core call failing), `revocation-aborts-relay` (a relayed turn of the revoked device is aborted and its pending approval answer discarded), `role-change-immediate`, `key-rotation-old-key-required`, `key-rotation-caller-key-refused`, `peer-attributed-rate-limit` (two peers behind one product listener have separate limits) and `native-port-loopback-only`. The suite SHALL run on the WebSocket transport and on the fallback transport, SHALL run in CI as part of `diagnostics-quality.CI gates`, and SHALL not use mocked cryptography. [NEW]

#### Scenario: Suite runs against a real Gateway
- **WHEN** `pnpm jagentchill:test:pairing` is executed
- **THEN** it starts a Gateway on an ephemeral port with a scratch state directory, runs all cases on both transports, and exits 0 only when every case passes

#### Scenario: Regression in attempt limiting
- **WHEN** the attempt limit is changed so a sixth attempt is evaluated
- **THEN** the case `code-attempt-limit` fails and the CI gate blocks the merge

#### Scenario: Regression that hands a device a core credential
- **WHEN** server code is changed to create an OpenClaw pairing for a device
- **THEN** the case `no-openclaw-credential` fails

### Requirement: Connection path tests on every platform
The connection behaviour of this capability SHALL be verified on all six client targets — macOS, Windows, Linux (desktop app), iOS, Android (mobile app) and web — and on Gateways running on macOS, Windows and Linux, with these named end-to-end cases: `pair-loopback` (desktop with its own Gateway), `pair-web-same-computer` (a browser on the host computer at the "This computer only" level, by link and by short code, in Chromium, Firefox and Safari where the host OS offers them), `pair-lan-encrypted`, `pair-web-lan-trusted-cert`, `web-lan-pinned-cert-refused`, `pair-remote-tailnet` (interactive sign-in is replaced in CI by an auth key for a test tailnet or a self-hosted coordination server; evidence from it is labelled as produced on a test tailnet), `tailnet-skip-on-lan`, `path-fallback-lan-to-tailnet`, `address-race-stale-lan` (the timing scenario of `device-pairing-signing.Address kinds and selection order`), `tailnet-key-expired`, `web-needs-os-tailnet`, `tailnet-member-unpaired-refused`, `tailnet-non-product-path-404`, `proxy-secret-required` (mobile node and desktop proxy), `key-storage-file-fallback` (Linux without a keyring; Windows and macOS with the store made unavailable) and `revocation-on-tailnet-path`. No requirement of this capability SHALL hold on only one desktop or one mobile operating system: a behaviour that is implemented per platform (key storage, tailnet module wrappers, helper binaries) names its equivalent for each of the others, and the cases above assert the same observable result on each. The product listener's own cases (start, ready, re-auth, logout, crash restart, path restriction, peer attribution) run for the six shipped binaries (macOS, Windows, Linux × arm64, x64). [JAD] [NEW]

#### Scenario: Matrix run
- **WHEN** the nightly connection matrix runs
- **THEN** each named case reports a result for every client target it applies to, and a missing target is a failure

#### Scenario: Unpaired tailnet member
- **WHEN** the case `tailnet-member-unpaired-refused` runs
- **THEN** a tailnet peer without a device record gets HTTP 401 on a signed route and close code 4401 on channel P

#### Scenario: One-platform behaviour detected
- **WHEN** the tailnet module contract test passes on Android and is absent for iOS
- **THEN** the matrix job fails with `missing platform: ios`
