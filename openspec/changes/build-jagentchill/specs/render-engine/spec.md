## ADDED Requirements

### Requirement: Package boundaries and dependency direction
The engine SHALL be split into three packages with a one-way dependency direction. `packages/editor-core` MUST be pure TypeScript with no DOM, WebGPU, WebCodecs, Web Audio or wasm imports and MUST run unmodified in a browser and in Hermes. `packages/render` MUST own the scene builder, resolve pass, FrameDescriptor builder, texture sync, media decode, caches, text/graphic/mask rasterisation, audio scheduling, audio mixdown and the export frame loop, and MUST depend on `editor-core` types and on `render-wasm`. `packages/render-wasm` MUST own the Rust crates `time`, `bridge`, `gpu`, `compositor`, `effects`, `masks` and `color` compiled to wasm32, and MUST NOT import any TypeScript package. `editor-core` MUST NOT import `render` or `render-wasm`; a CI dependency check MUST fail the build on any violating import. Application UI code MUST reach the engine only through the `EngineSurface` port. [NEW] [PORT R-001, R-007]

#### Scenario: Forbidden import is rejected
- **WHEN** a source file under `packages/editor-core` imports a module from `packages/render` or references `document`, `window`, `AudioContext`, `VideoDecoder` or `GPUDevice`
- **THEN** the dependency-boundary check exits with a non-zero status
- **AND** the report names the file and the forbidden symbol

#### Scenario: editor-core runs without a browser
- **WHEN** the `editor-core` unit test suite is executed in a JavaScript runtime that has no DOM and no WebAssembly support
- **THEN** every test passes without a missing-global error

### Requirement: Pure TypeScript time maths with wasm parity
`editor-core` SHALL implement the full time API in pure TypeScript using exact integer arithmetic: `mediaTimeFromSeconds`, `mediaTimeToSeconds`, `mediaTimeFromFrame`, `mediaTimeToFrame`, `roundToFrame`, `floorToFrame`, `isFrameAligned`, `lastFrameTime`, `snappedSeekTime`, `mediaTimeAdd`, `mediaTimeSub`, `mediaTimeMin`, `mediaTimeMax`, `mediaTimeClamp`, `guessTimecodeFormat`, `formatTimecode`, `parseTimecode`, and the retime functions `sourceTimeAt`, `clipTimeAt` and `retimedDuration` whose maths is defined by `speed-retime.Retime data model` and `speed-retime.Speed curve model`. The Rust `time` crate SHALL export the same functions through the wasm bridge, and the engine MUST call the TypeScript implementation on the app side and the Rust implementation inside wasm with no third implementation anywhere. Both implementations MUST return identical results for one shared vector file `packages/editor-core/fixtures/time-vectors.json` containing at least 2 000 base cases (every preset frame rate, negative values, zero, values up to 24 hours = 10 368 000 000 ticks, and rationals with numerator or denominator 1 000 000 evaluated at 24 hours) and at least 500 retime cases (the six curve presets of `speed-retime.Speed curve presets`, constant rates 0.1, 2 and 100, reverse, a 10 s source and a 1 h source). A lint rule MUST fail the build when the `/` operator is applied to a tick value outside the time module of `editor-core`. [NEW] [PORT R-002]

#### Scenario: Shared vectors agree
- **WHEN** the shared time vector file is run against the TypeScript implementation and against the wasm implementation
- **THEN** every case returns the expected value in both implementations
- **AND** no case differs between the two implementations

#### Scenario: Non-integer tick input is rejected
- **WHEN** a `MediaTime` is constructed from the value 1000.5
- **THEN** construction throws an error with code `time/non-integer-ticks`

#### Scenario: Retime mapping agrees across implementations
- **WHEN** `sourceTimeAt` is evaluated for a 1 h source with a curve preset at 1 000 clip times in TypeScript and in wasm
- **THEN** all 1 000 results are equal integers in both implementations

#### Scenario: Division on ticks outside the time module
- **WHEN** a file under `packages/render` contains `duration / 2` where `duration` is typed `MediaTime`
- **THEN** the lint step exits non-zero naming the file and line

### Requirement: Integer tick time base
All media times handled by the engine SHALL be integers in ticks at 120 000 ticks per second (`TICKS_PER_SECOND = 120000`). Conversion from seconds MUST round half away from zero. Floating-point seconds MUST appear only at the boundary with WebCodecs, Web Audio and container muxers, and MUST be derived from ticks at the point of use and never accumulated across frames. [PORT R-002, ST-011]

#### Scenario: One hour is exact
- **WHEN** 3 600 seconds is converted to media time
- **THEN** the result is exactly 432 000 000 ticks

#### Scenario: No accumulated drift over a long timeline
- **WHEN** frame 215 784 of a 59.94 fps project (one hour) is converted to media time
- **THEN** the result is exactly 215 784 × 2 002 = 431 999 568 ticks, computed by a single integer multiplication
- **AND** the value does not depend on how many frames were stepped to reach it

### Requirement: Frame-rate rationals and frame snapping
Frame rates SHALL be rationals `{numerator, denominator}` of positive integers, reduced by their greatest common divisor when loaded and stored reduced, with `numerator ≤ 1 000 000` and `denominator ≤ 1 000 000`; a rational outside these bounds MUST be rejected with `time/invalid-frame-rate`. The engine MUST support the presets 23.976 (24000/1001), 24, 25, 29.97 (30000/1001), 30, 48, 50, 59.94 (60000/1001), 60 and 120, whose frame durations are respectively 5 005, 5 000, 4 800, 4 004, 4 000, 2 500, 2 400, 2 002, 2 000 and 1 000 ticks. The time of frame `n` MUST be computed in TypeScript and in Rust by the same decomposition: `q = floor(n / numerator)`, `r = n mod numerator`, `ticks = q × (120000 × denominator) + roundHalfAway(r × 120000 × denominator / numerator)`, where `roundHalfAway(a / b) = floor((2a + b) / (2b))` for non-negative operands. Every intermediate MUST be exact: TypeScript uses `BigInt` for a product that can reach 2^53 and Rust uses `i128` for the same product; a result whose magnitude exceeds 2^53 − 1 MUST be rejected with `time/out-of-range`. `roundToFrame` snaps to the nearest frame boundary (ties away from zero), `floorToFrame` snaps down, `lastFrameTime(duration)` returns the start of the final frame fully contained in `duration` (0 when the duration is shorter than one frame), and `snappedSeekTime` clamps to `[0, lastFrameTime]` then floors to a frame. Every time the engine renders or reports as a frame time MUST be frame-aligned for the active scene frame rate. [PORT R-002] [NEW]

#### Scenario: Snap between frames at 30 fps
- **WHEN** `roundToFrame` is called with 5 999 ticks at 30 fps
- **THEN** the result is 4 000 ticks
- **AND** `roundToFrame` with 6 000 ticks returns 8 000 ticks

#### Scenario: Seek beyond the end
- **WHEN** `snappedSeekTime` is called with 1 000 000 ticks on a scene whose duration is 600 000 ticks at 30 fps
- **THEN** the result is 596 000 ticks

#### Scenario: Uneven rational does not drift
- **WHEN** frame times are computed for frames 0 to 100 000 at the rational 7/1 (exact frame duration 17 142.857… ticks)
- **THEN** each frame time equals `floor(n / 7) × 120000 + roundHalfAway((n mod 7) × 120000 / 7)` and differs from the exact rational value by at most 0.5 tick for every `n`

#### Scenario: Large denominator at 24 hours
- **WHEN** the frame index whose time is nearest to 24 hours is converted at the rational 29 970 000/1 000 000 (stored reduced as 2997/100)
- **THEN** the TypeScript and Rust results are the same integer
- **AND** no intermediate value was rounded by a floating-point multiplication

#### Scenario: Rational out of bounds
- **WHEN** a frame rate with numerator 2 000 003 and denominator 1 (already reduced) is loaded
- **THEN** it is rejected with `time/invalid-frame-rate`

### Requirement: Timecode formatting and parsing
The engine time API SHALL format and parse the timecode formats `MM:SS`, `HH:MM:SS`, `HH:MM:SS:CS` (centiseconds, the default) and `HH:MM:SS:FF` (frames at the given frame rate). `guessTimecodeFormat` MUST return the format matching the number of colon-separated fields. Parsing MUST reject a frame field greater than or equal to the rounded frame rate and return `null` for malformed input instead of throwing. [PORT R-002]

#### Scenario: Frame timecode round trip
- **WHEN** 364 000 ticks is formatted as `HH:MM:SS:FF` at 30 fps
- **THEN** the result is `00:00:03:01`
- **AND** parsing `00:00:03:01` at 30 fps returns 364 000 ticks

#### Scenario: Invalid frame field
- **WHEN** `00:00:01:30` is parsed as `HH:MM:SS:FF` at 30 fps
- **THEN** the result is `null`

### Requirement: EngineSurface message envelope
The `EngineSurface` port SHALL exchange messages of the form `{v: 1, id: string, type: string, payload: object}`. `id` MUST be unique per sender for the lifetime of the surface. A command that expects a result MUST be answered by exactly one message `{v: 1, id, type: "reply", replyTo: <command id>, ok: boolean, payload?, error?: {code: string, message: string}}` within 10 000 ms, except `export.start` and `still.render`, which reply when accepted and report results through events. Messages MUST be JSON-serialisable (no functions, no class instances). Binary data MUST travel outside the JSON envelope: on same-thread surfaces as a transferable `ArrayBuffer`; on the mobile surface from app to engine as a resource URL on the engine origin, and from engine to app through the path defined in "Mobile binary return path"; on the render host through the frame pipe defined in "Render host protocol". An unknown `type` MUST produce a reply with `ok: false` and error code `surface/unknown-command`; a message with `v` other than 1 MUST produce `surface/unsupported-version`. Message schemas MUST be defined as Zod schemas in `packages/protocol` and validated on receipt on both sides. The same command and event set MUST be used by the three surface variants (same-thread, mobile native view, render host); a variant-specific restriction is stated in that variant's requirement. [NEW]

#### Scenario: Unknown command
- **WHEN** the app sends `{v: 1, id: "a1", type: "scene.explode", payload: {}}`
- **THEN** the engine replies with `replyTo: "a1"`, `ok: false` and `error.code` equal to `surface/unknown-command`
- **AND** engine state is unchanged

#### Scenario: Reply timeout
- **WHEN** a command other than `export.start` or `still.render` receives no reply within 10 000 ms
- **THEN** the app-side port rejects the pending call with code `surface/timeout`
- **AND** emits a diagnostic of severity `error` with the command type

#### Scenario: Binary payload inside JSON is refused
- **WHEN** a `still.done` event schema is validated with a base64 image string in its payload on a same-thread surface
- **THEN** validation fails with `surface/invalid-payload`

### Requirement: EngineSurface commands from app to engine
The engine SHALL accept exactly these command types: `engine.init` (canvas size, device pixel ratio, platform, memory class, locale, `forceBackend?: "webgl2"`), `engine.dispose`, `scene.set` (`{revision, activeSceneId, document}` or `{revision, activeSceneId, snapshotUrl}`, per "Scene snapshot and revisioned patches"), `scene.patch` (`baseRevision`, `revision`, ordered patch list), `scene.setActive` (`{sceneId}`), `media.setSources` (asset id → original URL, proxy URL, mezzanine URL, probe metadata; the variant names are `original`, `proxy` and `mezzanine` everywhere), `derived.setSources` (`{entries[{key, kind, url, sha256}]}`, per "Derived asset delivery to the engine"), `fonts.setSources`, `transport.seek` (`time`, `mode: "scrub" | "exact"`), `transport.play` (`fromTime?`), `transport.pause`, `transport.setRate`, `transport.setLoop` (`enabled`, `inTime?`, `outTime?`), `transport.setVolume` (0..1), `transport.setMuted`, `transport.setScrubAudio`, `view.resize` (CSS size, device pixel ratio), `view.setQuality` (`"auto" | "full" | "half" | "quarter"`), `view.setVisible`, `preview.setOverride` (uncommitted element overrides from a gesture) and `preview.clearOverride`, `still.render`, `thumbnails.request`, `thumbnails.cancel`, `layout.query` (returns canvas-space bounding boxes of the given elements at a time), `layout.sampleSource` (`{elementId, x, y, size}` with `size` 1–15 odd, default 5; returns the mean sRGB colour of the `size × size` neighbourhood of the element's source frame at the current time, sampled after the `flip` stage and before the `chroma-key` stage), `export.start`, `export.pause`, `export.resume`, `export.cancel`, `sink.ack` (`{streamId, seq, bytes}`), `perf.setEnabled`, and `memory.trim`. Every `time` field MUST be an integer tick value. [NEW]

#### Scenario: Seek command renders the requested frame
- **WHEN** the app sends `transport.seek` with `time: 240000` and `mode: "exact"` on a 30 fps scene
- **THEN** the engine replies `ok: true`
- **AND** emits `frame.ready` with `time: 240000` and `exact: true`

#### Scenario: Non-integer time is rejected
- **WHEN** the app sends `transport.seek` with `time: 1000.25`
- **THEN** the engine replies `ok: false` with error code `surface/invalid-payload`

#### Scenario: Source sample for the chroma eyedropper
- **WHEN** `layout.sampleSource` is sent for a green-screen clip whose chroma key is enabled, at a point on the green background
- **THEN** the reply carries the unkeyed green colour of the source, not a transparent value

#### Scenario: Switching the presented scene
- **WHEN** the app sends `scene.setActive` with the id of a compound scene the user entered
- **THEN** the engine replies `ok: true` and the next `frame.ready` shows that scene as the root of the render, with no `scene.set` needed

### Requirement: EngineSurface events from engine to app
The engine SHALL emit exactly these event types: `engine.ready` (capability report), `engine.constraintsChanged` (`{constraints}`, the complete new object, emitted when a deferred probe or a runtime measurement of "Deferred capability probes" changes a value), `engine.error` (`code`, `message`, `fatal`), `engine.backendChanged`, `frame.ready` (`time`, `revision`, `exact`, `renderMs`), `transport.state` (`playing`, `rate`, `loop`, `reason?` — including `"reverse-keyframes"` of "Video decode and frame cache strategy" — `effectiveQuality?`, `audioOutput?`), `transport.time` (`{time, rate, playing, audioClock: boolean, hostMono_ms?}`), `transport.ended`, `media.status` (per asset: `ready | decoding | unsupported | missing`, using `original | proxy | mezzanine`), `still.done` and `still.failed`, `thumbnails.ready` (asset id, time, resource reference), `export.progress`, `export.chunk` (`{streamId, seq, bytes, position?}` describing a chunk delivered through the binary path), `export.done`, `export.failed`, `sink.chunk` (`{streamId, seq, base64}`; mobile surface only, the base64 fallback of "Mobile binary return path", at most 262 144 bytes encoded, and the only event that carries binary content inside JSON), `sink.closed` (`{streamId, totalBytes, sha256}`), `perf.sample`, `memory.pressure` and `diagnostic` (`id`, `severity: "caution" | "error"`, `message`, `elementId?`, `assetId?`). During playback `transport.time` MUST be emitted once per presented frame on same-thread surfaces, and on the mobile surface at the rate defined in "Transport clock across the mobile bridge". The render host emits no `transport.*` events. [NEW]

#### Scenario: Time events during playback on desktop
- **WHEN** a 60 fps scene plays for 2 seconds on a same-thread surface with no dropped frames
- **THEN** between 118 and 122 `transport.time` events are emitted
- **AND** each carries a frame-aligned `time` strictly greater than the previous one

#### Scenario: Time events on the mobile surface
- **WHEN** a 60 fps scene plays for 2 seconds on the mobile surface
- **THEN** between 56 and 64 `transport.time` events cross the bridge
- **AND** each carries `hostMono_ms`

### Requirement: Same-thread surface on web and desktop
On web and desktop the `EngineSurface` implementation SHALL run in the same JavaScript realm as the app, mount the compositor canvas directly in the DOM element supplied by the host, and deliver commands and events as in-process calls with the same schemas as the other surface variants (schema validation MUST stay enabled in development and test builds and MUST be disabled in production builds for same-thread calls). Video and audio decoding and export frame production MUST run in Web Workers so that a 16 ms main-thread task budget is not exceeded by decode work; compositor presentation runs on the thread that owns the preview canvas. The desktop app MUST use the identical surface implementation as the web build. Media URLs given to `media.setSources` MUST be range-capable and fetchable from workers: origin-private or blob URLs on web, `jagentchill-file://<grantId>/<name>` for external file references on desktop (served by the desktop main process as defined by `project-storage.External file references on desktop`), and the authenticated host media URLs of `server-api.Authenticated media delivery`; the engine MUST NOT read media through a sequential IPC stream. [NEW] [PORT R-001]

#### Scenario: Canvas is mounted in the host element
- **WHEN** `engine.init` completes on web
- **THEN** exactly one `<canvas>` element owned by the engine exists inside the host element
- **AND** no `<video>` element is created by the engine

#### Scenario: Decode work stays off the main thread
- **WHEN** a 1080p clip plays for 10 seconds on the reference desktop
- **THEN** no main-thread task attributed to demuxing or decoding exceeds 16 ms in the performance trace

#### Scenario: Random access into an external file on desktop
- **WHEN** a 6 GiB externally referenced file is seeked to its middle on desktop
- **THEN** the decoder worker issues a single-range request to a `jagentchill-file://` URL and receives status 206
- **AND** no more than 64 MiB of the file is read to present the frame

### Requirement: Mobile WebView surface bridge
On iOS and Android the engine SHALL run inside a product-owned native view module `JagentchillEngineView` (an Expo module; the stock `react-native-webview` package MUST NOT be used for the engine) that wraps a WebView owning the preview canvas, wasm, decode and audio; the timeline, toolbars and panels remain React Native. The engine page, wasm, fonts, scene snapshots and media MUST be served from a local origin that never reaches the network: on Android `https://engine.jagentchill.localhost/` answered entirely by `shouldInterceptRequest` (the host name is never resolved by DNS); on iOS `jagentchill-engine://app/` answered by a `WKURLSchemeHandler`. Paths: `/index.html` and bundle assets, `/media/<assetId>/<variant>` (`original`, `proxy`, `mezzanine`), `/derived/<sha256>` (mattes, analysis tracks, LUT files, sticker and background images, per "Derived asset delivery to the engine"), `/font/<fontId>`, `/snapshot/<snapshotId>`. Which file each path maps to is told to the native module by the app through the resource map of `mobile-editor.Engine view native module`, which owns the native module API; this requirement owns the wire semantics (origin, paths, range support, message size, sink protocol) and `mobile-editor` restates none of them. A path that is not in the resource map is answered 404. Both platforms MUST support single-range requests (status 206 with `Content-Range`) and MUST answer only requests originating from the engine WebView. At `engine.init` the engine MUST verify `isSecureContext === true`, that wasm instantiates and that a Worker starts; otherwise it emits `engine/unsupported-runtime`. Bytes of media held only on a paired host are fetched and signed by the native transport module as defined by `server-api.Authenticated media delivery` and served through the same local origin; the WebView itself MUST have no access to any non-local origin and navigation to any other origin MUST be cancelled. Commands and events cross the bridge as UTF-8 JSON strings, one envelope per message, with a maximum encoded size of 262 144 bytes; a `scene.set` larger than that MUST be delivered by reference (`{snapshotUrl}` under `/snapshot/`), and a `scene.patch` larger than that MUST be replaced by a `scene.set` by reference. Bridge round-trip latency for a `transport.seek` command (send to receipt in the WebView) MUST be 8 ms or less at the 95th percentile on the reference mobile devices of `diagnostics-quality.Performance budgets`. Touch gestures on the preview are captured by the React Native layer above the native view; the WebView itself MUST ignore pointer input. Because no touch ever reaches the WebView document, the native module MUST configure the WebView so that media and audio start without user activation: on iOS `WKWebViewConfiguration.mediaTypesRequiringUserActionForPlayback = []` and `allowsInlineMediaPlayback = true`; on Android `WebSettings.setMediaPlaybackRequiresUserGesture(false)`; on both the engine resumes its `AudioContext` when it receives the first `transport.play` command ("Mobile audio session"). [NEW]

#### Scenario: Oversized snapshot goes by reference
- **WHEN** the app needs to send a scene snapshot whose JSON encoding is 400 000 bytes
- **THEN** the native module stores the snapshot and the bridge sends `scene.set` with a `snapshotUrl` under `/snapshot/` on the engine origin
- **AND** the engine loads it and replies `ok: true` with the snapshot revision

#### Scenario: Foreign navigation is blocked
- **WHEN** content in the engine WebView attempts to navigate to `https://example.com`
- **THEN** the navigation is cancelled
- **AND** a diagnostic with id `surface/navigation-blocked` is emitted

#### Scenario: Range request for media on Android
- **WHEN** the decoder requests bytes 1 048 576–2 097 151 of `/media/<assetId>/original` on Android
- **THEN** the intercepted response has status 206, a `Content-Range` header for that range and exactly 1 048 576 body bytes
- **AND** no DNS query for `engine.jagentchill.localhost` leaves the device

#### Scenario: Range request for media on iOS
- **WHEN** the decoder requests bytes 1 048 576–2 097 151 of `jagentchill-engine://app/media/<assetId>/original` on iOS
- **THEN** the scheme handler answers with status 206, a `Content-Range` header for that range and exactly 1 048 576 body bytes

#### Scenario: Insecure context
- **WHEN** the engine page loads in a WebView where `isSecureContext` is `false`
- **THEN** `engine.error` is emitted with code `engine/unsupported-runtime`, `fatal: true` and `missing: ["secure-context"]`

#### Scenario: Seek latency across the bridge
- **WHEN** 1 000 `transport.seek` commands are sent on each reference mobile device
- **THEN** the 95th-percentile time from send to receipt in the WebView is 8 ms or less

#### Scenario: Oversized patch falls back to a snapshot
- **WHEN** a paste produces a `scene.patch` whose JSON encoding is 300 000 bytes on the mobile surface
- **THEN** the app sends `scene.set` with a `snapshotUrl` instead, and the engine reports the new revision

#### Scenario: Unmapped path
- **WHEN** the engine page requests `/derived/<sha256>` for a hash that is not in the resource map
- **THEN** the response is 404 on iOS and on Android and no file outside the map is read

### Requirement: Mobile binary return path
Binary results produced by the engine on mobile (iOS and Android) — a FINISHED export file, stills and thumbnails — SHALL leave the WebView through a sink stream identified by `streamId`, in chunks of at most 4 MiB numbered by `seq` from 0. The sink is append-only and carries no offsets, so it never carries a file that is still being muxed: on-device export output is first written and finalised inside the engine's own storage and only then copied out ("Mobile export path"). On Android a chunk is posted as an `ArrayBuffer` over a `WebMessagePort` (`WEB_MESSAGE_ARRAY_BUFFER` feature of the AndroidX WebKit library); on iOS a chunk is sent as `fetch(PUT jagentchill-engine://sink/<streamId>?seq=<n>)` whose body the scheme handler receives. When the platform feature is absent (`constraints.binarySink: "base64"`), or a chunk is refused, the engine MUST fall back to the event `sink.chunk {streamId, seq, base64}` of at most 262 144 bytes per message. The native side acknowledges every chunk with `sink.ack {streamId, seq, bytes}` after the bytes are durably appended; a chunk whose `seq` is missing, repeated or out of order MUST abort the stream with `engine/sink-sequence`, delete the partial destination file and fail the operation that owns the stream (an export copy-out fails with `export/write-failed`, keeping the finalised file inside the engine storage so that "Save again" can retry the copy without re-rendering); and the engine MUST keep at most 2 unacknowledged chunks in flight and MUST stop producing output while that limit is reached. A stream ends with `sink.closed {streamId, totalBytes, sha256}`, and the native side MUST verify both values before the destination file is finalised. A stream that receives no chunk for 30 s while the app is in the foreground MUST be aborted with `engine/sink-timeout` and its partial destination file deleted; the timer is suspended while the app is in the background. The destination of a stream (cache file for stills and thumbnails, the export destination for an export) is given by the app when it opens the sink through `mobile-editor.Engine view native module`, which owns that native API; thumbnails and stills are referenced to React Native by `file://` path. [NEW]

#### Scenario: Back-pressure
- **WHEN** the native side delays acknowledgements while a finished export is copied out on an iOS or an Android reference device
- **THEN** the engine has never more than 2 unacknowledged chunks outstanding
- **AND** memory held for the copy in the WebView stays below 16 MiB

#### Scenario: Stream integrity
- **WHEN** a 1 GiB export copy-out stream is closed
- **THEN** the byte count and SHA-256 computed by the native side equal the values in `sink.closed`
- **AND** a mismatch fails the copy with `export/write-failed`, deletes the partial destination file and keeps the finalised file in the engine storage

#### Scenario: Out-of-order chunk
- **WHEN** the native side receives chunk `seq: 5` of a stream after chunk `seq: 3`
- **THEN** the stream is aborted with `engine/sink-sequence` and the partial destination file is deleted

#### Scenario: Base64 fallback
- **WHEN** the platform binary path is unavailable (an Android WebView without `ArrayBuffer` message payloads, or an iOS scheme handler that refuses the `PUT` body)
- **THEN** chunks are delivered as `sink.chunk` events no larger than 262 144 bytes each and the stream still closes with a verified SHA-256

#### Scenario: Idle stream in the foreground
- **WHEN** a still stream receives no chunk for 30 s while the app is in the foreground
- **THEN** it is aborted with `engine/sink-timeout` and its partial file is deleted

#### Scenario: Thumbnail reaches the React Native timeline
- **WHEN** `thumbnails.request` asks for 20 filmstrip frames on a phone
- **THEN** each `thumbnails.ready` carries a `file://` path inside the app cache directory that React Native can load as an image

### Requirement: Mobile export path
On iOS and Android an on-device export SHALL be muxed inside the engine's own storage and only then delivered (decision B5 of `.refs/review/round2-decisions.md`); the rule is identical on both platforms. (1) **Write.** The muxer writes to one file in the origin-private file system of the engine origin through a synchronous access handle in the export worker, using positioned writes, so that a non-fragmented MP4 or MOV can have its `moov` box and `mdat` size written back; nothing is sent through the sink while frames are being encoded. (2) **Finalise and copy out.** When the last frame is muxed the file is finalised, its size and SHA-256 are computed, and it is streamed to the destination through "Mobile binary return path" in 4 MiB slices; `export.progress` reports `stage: "saving"` with bytes done and total during the copy; after `sink.closed` is verified the file inside the engine storage is deleted and `export.done` is emitted. A failed copy keeps the finalised file for 24 h so the copy can be retried without rendering again. (3) **Space.** The engine storage and the destination each need the full output size, so the pre-flight of `export-share.Pre-flight validation` requires free space of 2× the estimated size on mobile; when a positioned write fails for lack of space the export fails with `export/write-failed`, detail `storage-full`, and the partial file is deleted. (4) **Engine lifetime.** While an on-device export is `running` or `paused` the engine is NOT disposed, the 30 s background disposal of "Mobile engine restart budget" does not apply, and the sink idle timer does not run. (5) **Background.** An export keeps encoding only while the app is in the foreground or inside the background-execution window the operating system grants on request (the native module asks for it when the app leaves the foreground: a background task on iOS, a foreground service of type media processing on Android, which also shows the export notification of `mobile-editor.Export sheet`); when the window ends, or is refused, the export pauses after the current frame with encoders, muxer state and the partial file kept, and `export.progress` reports `stage: "paused", reason: "background"`. (6) **Return.** On return to the foreground the engine verifies the GPU device, the decoder sessions and the encoder session: lost decoders and a lost GPU device are re-created (the export session rebuilds its textures) and the export resumes at the next frame; a lost video encoder is re-created with the identical configuration and resumes with a key frame, and when the new encoder's decoder configuration differs from the one already written, or the content process was terminated, the export fails with `export/interrupted` (the user-facing "Retry" renders from frame 0) and the partial file is deleted. A user Pause of any length follows the same keep-everything rule. `export-share.Pause and resume export` owns the user-facing states and cites this requirement; `mobile-editor` owns the sheet and the notification. [NEW]

#### Scenario: Non-fragmented MP4 on a phone
- **WHEN** a 60 s 1080p H.264 export completes on a reference phone (iOS or Android)
- **THEN** the delivered file is a non-fragmented MP4 whose `moov` box was written by a positioned write inside the engine storage, its SHA-256 equals the value in `sink.closed`, and the engine-storage copy has been deleted

#### Scenario: 120 s in the background, everything survives
- **WHEN** the app is in the background for 120 s during an export and the operating system keeps the content process, the GPU device and the encoder alive
- **THEN** the export paused when the background window ended, resumes without user action on return, and the finished file plays without a discontinuity

#### Scenario: 120 s in the background, the encoder is gone
- **WHEN** the app returns after 120 s and the hardware encoder session is invalid while the engine process survived
- **THEN** the engine re-creates the encoder with the same configuration and resumes with a key frame; when the new decoder configuration differs from the one already written, the export fails with `export/interrupted` and the partial file is deleted

#### Scenario: User pause of 60 s
- **WHEN** the user pauses an export for 60 s in the foreground and resumes
- **THEN** no stream was aborted, the engine was not disposed, and the export continues from the next frame

#### Scenario: Copy-out fails
- **WHEN** the destination becomes unwritable while the finished file is being copied out
- **THEN** the export reports `export/write-failed`, the finalised file stays in the engine storage, and "Save again" delivers it without rendering again

#### Scenario: Storage fills during muxing
- **WHEN** a positioned write fails because the device is out of space at 70 %
- **THEN** the export fails with `export/write-failed` and detail `storage-full`, and the partial file is deleted

### Requirement: Transport clock across the mobile bridge
On the mobile surface the engine SHALL emit `transport.time {time, rate, playing, audioClock, hostMono_ms}` 30 times per second during playback (15 times per second when `constraints.timeEventsPerSecond` is 15), where `hostMono_ms` is the native monotonic clock read by the native view at the moment it forwards the event. The app-side port MUST extrapolate the playhead for every display frame as `time + (nowMono_ms − hostMono_ms) × rate`, converted to ticks and floored to a frame; it MUST correct to each new event, MUST NOT move the displayed playhead backwards during forward playback (a correction that would do so holds the playhead until the extrapolation catches up), and MUST stop extrapolating when an event with `playing: false` arrives or when no event has arrived for 500 ms. The extrapolated playhead MUST stay within one frame duration of the engine's audio-clock position at the 95th percentile. [NEW]

#### Scenario: Smooth timeline at 60 Hz from 30 events per second
- **WHEN** a 30 fps project plays for 10 s on a reference mobile device with a 60 Hz display
- **THEN** the React Native playhead position changes on every display frame in which the frame index advanced
- **AND** it differs from the engine position sampled at the same instant by at most one frame duration on 95 % of display frames

#### Scenario: Correction never steps backwards
- **WHEN** an event arrives whose `time` is 20 ms behind the extrapolated playhead during forward playback
- **THEN** the displayed playhead holds its position until the extrapolation from the new event passes it

#### Scenario: Bridge stalls
- **WHEN** no `transport.time` event arrives for 500 ms while the last event had `playing: true`
- **THEN** the app-side port stops advancing the playhead and resumes from the next event

### Requirement: Mobile engine restart budget
When the OS terminates the engine WebView content process, or a wasm panic occurs on the mobile surface, the native view SHALL recreate the WebView, and the app SHALL re-send `engine.init`, `media.setSources` and `scene.set` so that the frame at the last playhead is visible within 5 000 ms (3 000 ms to `engine.ready` plus 2 000 ms to the frame). The transport is restored paused; an in-flight gesture override is discarded; a running on-device export fails with `export/interrupted` and its partial file inside the engine storage is deleted. The handshake fails with `engine/init-timeout` when `engine.ready` has not arrived 8 000 ms after `engine.init`. Terminations and panics share one counter: 3 within 60 s stop automatic restarts and raise `engine/restart-loop` with `fatal: true`. When the app is backgrounded the app sends `memory.trim` immediately and disposes the engine after 30 s in the background, EXCEPT while an on-device export is `running` or `paused`: then the engine is not disposed and "Mobile export path" applies, on iOS and Android alike; returning to the foreground shows the playhead frame within 2 000 ms before disposal and within 5 000 ms after it. The user-facing screens and strings for these states are defined by `mobile-editor.Engine surface lifecycle`; no project data is lost because project state lives in `editor-core`. [NEW]

#### Scenario: WebView process is killed by the OS
- **WHEN** the OS terminates the engine WebView content process while the editor is open and paused at 12 s
- **THEN** the frame at 12 s is visible again within 5 000 ms without user action
- **AND** the transport is paused and the project document is unchanged

#### Scenario: Kill during an on-device export
- **WHEN** the content process is terminated while an on-device export is at 40 %
- **THEN** the export fails with `export/interrupted` and the partial output file is deleted

#### Scenario: Restart loop
- **WHEN** the content process is terminated 3 times within 60 s
- **THEN** no fourth automatic restart is attempted and `engine.error` carries `engine/restart-loop` with `fatal: true`

#### Scenario: Return from a long background stay
- **WHEN** the app returns to the foreground after 45 s in the background
- **THEN** the engine is re-created and the playhead frame is visible within 5 000 ms

#### Scenario: Export keeps the engine alive in the background
- **WHEN** the app is in the background for 120 s while an on-device export is paused at 40 %
- **THEN** the engine has not been disposed, and on return the export continues per "Mobile export path"

### Requirement: Engine capability probe and ready handshake
On `engine.init` the engine SHALL probe the runtime and emit `engine.ready` containing: `backend` (`"webgpu" | "webgl2" | "none"`), `maxTextureSize`, `secureContext: boolean`, `decoders` and `encoders` for video (per codec `avc`, `hevc`, `vp9`, `av1`, each `{supported, hardware?}` from `isConfigSupported` at 1920×1080 30 fps), `audioDecoder: boolean` (AAC-LC 48 kHz decodable through `AudioDecoder`), `audioEncoders {aac, opus, flac}` (booleans from `AudioEncoder.isConfigSupported`), `audioOutput: boolean`, `offscreenCanvas: boolean`, `fileSystemAccess: boolean`, `memoryClass` (`"desktop" | "web" | "mobile" | "host"`), `surface` (`"same-thread" | "mobile" | "render-host"`), `constraints` (see "Capability constraints from the WebView spike"), `engineVersion` and `protocolVersion`. `backend` is accompanied by `software: boolean` (true when the selected API runs on a software rasteriser; "GPU backend selection and WebGL2 fallback"). The handshake is the FAST probe set: it contains only values that are derivable synchronously, answered by `isConfigSupported`, or read from the device cache of "Deferred capability probes"; no timing measurement, no decode or encode run and no storage write happens before `engine.ready`. `engine.ready` MUST be emitted within 1 500 ms of `engine.init` on the reference desktop and within 3 000 ms on the reference mobile devices of `diagnostics-quality.Performance budgets` (iOS and Android), on a first run with an empty cache as well as on every following run. When any of WebAssembly, `VideoDecoder`, `AudioDecoder`, a secure context or Worker support is unavailable the engine MUST emit `engine.error` with code `engine/unsupported-runtime`, `fatal: true` and `missing[]` naming each absent capability (`wasm`, `video-decoder`, `audio-decoder`, `secure-context`, `worker`), and MUST NOT emit `engine.ready`. The minimum operating-system and WebView versions that make these capabilities present are defined by `updates-distribution.Mobile store distribution`; the user-facing state for an unsupported runtime is defined by `preview-canvas.Engine states`. [NEW]

#### Scenario: Ready report on a WebGPU desktop
- **WHEN** `engine.init` is sent on a desktop with WebGPU and H.264 hardware encoding
- **THEN** `engine.ready` is emitted within 1 500 ms with `backend: "webgpu"` and `encoders.avc.hardware: true`

#### Scenario: Runtime without WebCodecs
- **WHEN** `engine.init` is sent in a runtime where `VideoDecoder` is undefined
- **THEN** `engine.error` is emitted with code `engine/unsupported-runtime`, `fatal: true` and `missing` containing `video-decoder`
- **AND** timeline editing in `editor-core` remains usable

#### Scenario: Runtime without audio WebCodecs
- **WHEN** `engine.init` is sent in a WebView that has `VideoDecoder` but no `AudioDecoder`
- **THEN** `engine.error` is emitted with code `engine/unsupported-runtime` and `missing` containing `audio-decoder`
- **AND** no `engine.ready` is emitted

#### Scenario: Linux desktop without an AAC encoder
- **WHEN** `engine.init` is sent in a runtime whose `AudioEncoder` rejects `mp4a.40.2` and accepts Opus
- **THEN** `engine.ready` reports `audioEncoders.aac: false`, `audioEncoders.opus: true` and `constraints.audioEncode: "opus"`
- **AND** an `export.start` that requests AAC is refused with `engine/encoder-unavailable` naming Opus in WebM as the available alternative; Opus is never written into an MP4 that was requested with AAC

#### Scenario: First run on a phone stays inside the budget
- **WHEN** `engine.init` is sent on a reference phone (iOS or Android) whose probe cache is empty
- **THEN** `engine.ready` arrives within 3 000 ms with `constraints.calibrated: false` and the default constraint values, and the timing probes run afterwards per "Deferred capability probes"

### Requirement: Capability constraints from the WebView spike
The engine SHALL report a per-device `constraints` object in `engine.ready` — and again, complete, in `engine.constraintsChanged` whenever a value changes — and the app MUST obey it. The object is `{calibrated: boolean, proxyEditing: "optional" | "required", hevcDecode: boolean, onDeviceVideoExport: boolean, audioEncode: "aac" | "opus" | "pcm-mov" | "gateway-only", cachePoolScale: 1 | 0.5, binarySink: "port" | "scheme" | "base64" | "direct", timeEventsPerSecond: 30 | 15}`. It is the run-time form of the pass/fail matrix of design decision D4 (spike S6); the spike itself is run by engineers on the reference devices (iOS and Android) before any render task and recorded in `docs/decisions/`, and is NOT something a shipped app repeats at launch. Each row has one of three sources:

| S6 row | Constraint | Source at run time | Value when the row fails |
|---|---|---|---|
| 1 secure context on the local origin | — | handshake | `engine/unsupported-runtime` (blocking) |
| 2 WebGPU adapter | `backend` | handshake | `backend: "webgl2"` |
| 3 `VideoDecoder` H.264 1080p30 speed and seek | `proxyEditing` | deferred probe (default `"optional"`) | `"required"`: preview always decodes the 720p proxy |
| 4 HEVC 2160p decodable | `hevcDecode` | handshake (`isConfigSupported`) | `false`: such originals play from the proxy and export from the `mezzanine` variant, or are `unsupported` in `media.status` when no variant exists |
| 5 `AudioDecoder` AAC-LC 48 kHz | — | handshake | `engine/unsupported-runtime` (blocking) |
| 6 `VideoEncoder` H.264 1080p30 speed | `onDeviceVideoExport` | handshake for presence (`false` when no video encoder config is supported); deferred probe for speed (default `true`) | `false`: on-device video export is refused with `engine/encoder-unavailable`; export on a paired host is the video path |
| 7 audio encode | `audioEncode` | handshake (`AudioEncoder.isConfigSupported`) | first available of `"aac"`, `"opus"`, `"pcm-mov"`, else `"gateway-only"`; `"opus"` serves WebM, and MP4 only when the export request names Opus explicitly; an MP4 with PCM audio is never written and Opus is never substituted for a requested AAC |
| 8 engine memory | `cachePoolScale` | runtime measurement (default 1) | 0.5: every mobile pool of "Memory ceilings per platform" is halved and `proxyEditing` becomes `"required"` |
| 9 binary return path | `binarySink` | handshake (feature detection) | `"port"` on Android and `"scheme"` on iOS when the platform feature exists, else `"base64"`; `"direct"` on web, desktop and the render host, which have no sink |
| 10 bridge latency and event rate | `timeEventsPerSecond` | runtime measurement (default 30) | 15 |
| 11 audio session (iOS: audible with the mute switch on; Android: audio focus held and audio starts from a `transport.play` sent over the bridge with no touch inside the WebView) | — | spike only | blocking for release on the failing platform; no runtime flag |
| 12 bundled colour emoji font renders through the engine path of "Engine-side text shaping and layout" | — | spike only | not blocking for release (decision E5): on the failing platform the engine draws each emoji from the bundled pre-rendered 512 px bitmaps (`stickers-shapes.Emoji stickers`) at the position and size its text layout computed, so layout, line breaks and export are unchanged |
| 13 on-device inference (`seg-person` at ≥ 3 fps and `face-mesh` at ≥ 8 fps in the engine WebView, process alive after 10 minutes; `mobile-editor.WebView capability spike matrix`) | — | spike only | blocking for release on the failing platform until the model or the inference runtime passes (decision E3: the host is an accelerator, never a requirement, for what CapCut mobile does on device) |

`calibrated` is `false` until every deferred probe of "Deferred capability probes" has a cached result for the current device, OS version and WebView version. On web and desktop the same object is reported with rows 8–10 at their passing values. The three recorded fallbacks are WebGL2 rendering, proxy editing and export on the paired host. [NEW]

#### Scenario: Slow decoder forces proxy editing
- **WHEN** the deferred probe on a phone (iOS or Android) measures H.264 1080p30 decode at 0.7× real time
- **THEN** `engine.constraintsChanged` reports `constraints.proxyEditing: "required"`
- **AND** from then on preview decodes the proxy of every video asset regardless of the proxy preference

#### Scenario: No usable video encoder
- **WHEN** the deferred probe finds H.264 encoding at 0.3× real time
- **THEN** `engine.constraintsChanged` reports `constraints.onDeviceVideoExport: false`
- **AND** `export.start` for a video container replies `ok: false` with `engine/encoder-unavailable`

#### Scenario: Audio encode fallback order
- **WHEN** a device has no AAC encoder and no Opus encoder
- **THEN** `constraints.audioEncode` is `"pcm-mov"`
- **AND** an export requesting MP4 with audio is refused by the engine with `engine/encoder-unavailable` instead of writing PCM into MP4

#### Scenario: Web and desktop report the passing values
- **WHEN** `engine.init` is sent on the desktop app on macOS, Windows or Linux, or in a browser
- **THEN** `constraints.binarySink` is `"direct"`, `cachePoolScale` is 1 and `timeEventsPerSecond` is 30

### Requirement: Deferred capability probes
Capability measurements that take time SHALL run after `engine.ready`, never before it, and never while they would be visible to the user. **Deferred probes** (S6 rows 3 and 6): a decode probe (a bundled 2 s H.264 1080p30 clip decoded once and 20 seeks timed; fail when below 1× real time or seek p95 above 150 ms) and an encode probe (60 frames of 1080p encoded with `VideoEncoder`; fail when below 0.5× real time). They run in a worker at the lowest priority, at the earliest 500 ms after `engine.ready`, only while the transport is paused and no export, proxy or import job runs; they are aborted and rescheduled when playback, an export or a `memory.pressure` event starts; together they take at most 4 000 ms of running time and write nothing to user storage. Results are cached per device, OS version and WebView (or browser) version, and delivered with `engine.constraintsChanged`; until a result exists the defaults `proxyEditing: "optional"` and `onDeviceVideoExport: true` apply, and an on-device export started before the encode probe has run simply proceeds (its own measured speed then serves as the probe result). A cache entry for another OS or WebView version is discarded, which makes the next `engine.init` report `calibrated: false` and reschedule the probes — the handshake budget is unaffected. **Runtime measurements** (rows 8 and 10) use real work instead of a probe: `cachePoolScale` becomes 0.5, and stays so for that device and OS version, after the first content-process termination that follows a `memory.pressure` event within 10 s; `timeEventsPerSecond` becomes 15 when the 95th-percentile bridge latency over a rolling window of 1 000 messages exceeds 8 ms, and returns to 30 when it stays at or below 6 ms for a further 1 000 messages. No probe allocates a fixed memory block, holds memory for a fixed time or writes a test file. On web and desktop the deferred probes run under the same rules; on the render host they do not run and `calibrated` is `true`. [NEW]

#### Scenario: Probes do not delay the first frame
- **WHEN** a project is opened for the first time on a reference phone (iOS or Android)
- **THEN** `engine.ready` arrives within 3 000 ms and the first `frame.ready` is delayed by at most 100 ms compared with a warm cache
- **AND** `engine.constraintsChanged` with `calibrated: true` arrives afterwards, after at most 4 000 ms of probe running time

#### Scenario: Probe yields to playback
- **WHEN** the user presses play while the decode probe is running
- **THEN** the probe is aborted within 100 ms, playback starts within the budget of "Performance budgets", and the probe runs again when the transport is next paused for 500 ms

#### Scenario: Probe results are cached
- **WHEN** the engine is initialised a second time on the same device, OS version and WebView version
- **THEN** `engine.ready` carries `calibrated: true` with the cached values and no probe runs

#### Scenario: WebView update invalidates the cache
- **WHEN** Android System WebView is updated to a new version, or iOS is updated to a version with a different WebKit build
- **THEN** the next `engine.ready` still arrives within 3 000 ms, reports `calibrated: false` with the defaults, and the probes are scheduled again

#### Scenario: Memory kill halves the pools
- **WHEN** the content process is terminated 4 s after a `memory.pressure` event
- **THEN** the next `engine.ready` on that device reports `cachePoolScale: 0.5` and `proxyEditing: "required"`

#### Scenario: Slow bridge lowers the event rate
- **WHEN** the rolling 95th-percentile bridge latency reaches 11 ms
- **THEN** `engine.constraintsChanged` reports `timeEventsPerSecond: 15` and the app extrapolates the playhead between events

### Requirement: Scene snapshot and revisioned patches
The engine SHALL hold its own copy of the WHOLE canonical project document, not of one scene, because it renders other scenes (compound and multi-camera sources up to depth 8), the project settings (canvas size, frame rate, default background, `useProxies`) and asset metadata. `scene.set` carries `{revision, activeSceneId, document}` where `document` is the canonical form of `project-document.Canonical JSON serialisation` (every scene, `settings`, `media`, `template`; no `local` section and no preview-layer data), or `{revision, activeSceneId, snapshotUrl}` when the payload must go by reference. `activeSceneId` is the root scene of preview rendering and is device state (`local.currentSceneId`); `scene.setActive {sceneId}` changes it without resending the document, and stills, thumbnails and exports name their root scene in their own request (default: the main scene). `scene.patch` carries `{baseRevision, revision, patches[]}` where `patches[]` are exactly the entries of the emitted state patch in the format of `project-document.State patch format` (`{op, path, value?, before?}` with `@<id>` segments), rooted at `document`. `revision` is a surface-local counter that starts at 1 with each `scene.set`, increases by 1 with each accepted patch, and is independent of the sync revision of `project-storage.State patch emission`. A `scene.patch` whose `baseRevision` differs from the engine's current revision, or whose patch does not resolve (`document/patch-invalid`), MUST be rejected with error code `scene/revision-mismatch` or `scene/patch-invalid`, leaving the engine's copy unchanged, after which the app MUST send `scene.set`. The engine MUST rebuild only the scene nodes whose source element, track, asset or project setting changed, in the active scene and in every scene reachable from it through compound elements. Building is a pure function of this document, the active scene id, the sources given by `media.setSources`, `derived.setSources` and `fonts.setSources`, and the gesture overrides. Every `frame.ready` event MUST report the `revision` the frame was rendered from. A patch MUST be reflected in a rendered frame within 50 ms on the reference desktop and 100 ms on the reference mobile devices when paused. The render host receives the same `scene.set` payload once per job and no patches. [NEW] [PORT R-001]

#### Scenario: Patch applies and re-renders
- **WHEN** the engine is at revision 41, paused, and receives `scene.patch` with `baseRevision: 41`, `revision: 42` whose single entry replaces `/scenes/@s1/tracks/main/elements/@e9/opacity`
- **THEN** it replies `ok: true`
- **AND** emits `frame.ready` with `revision: 42` within 50 ms on the reference desktop

#### Scenario: Stale patch
- **WHEN** the engine is at revision 42 and receives `scene.patch` with `baseRevision: 40`
- **THEN** it replies `ok: false` with code `scene/revision-mismatch`
- **AND** the app responds by sending `scene.set` with the current document

#### Scenario: Edit inside a compound scene updates the parent frame
- **WHEN** the active scene shows a compound element and a patch changes a clip inside the referenced scene
- **THEN** the next `frame.ready` of the active scene shows the change, with no `scene.set`

#### Scenario: Project setting change
- **WHEN** a patch replaces `/settings/background`
- **THEN** only the background nodes are rebuilt and the next frame shows the new background

#### Scenario: Local data never reaches the engine
- **WHEN** the app builds the `scene.set` payload
- **THEN** it contains no `local` key, and scrolling or zooming the timeline sends no message to the engine

### Requirement: Derived asset delivery to the engine
Every file the engine needs besides the media variants and fonts SHALL be delivered by the command `derived.setSources {entries[{key, kind, url, sha256}]}`, a replace-all list like `media.setSources`, so that no stage depends on an input the surface cannot supply. `kind` and `key` are: `matte` — a cutout matte, key = the derived asset id of `cutout.matteAssetId` (a single-channel video for video sources, an image for stills); `person-matte` — the person matte used by body effects, key = `<assetId>:person` ("Body-effect matte inputs and frame history"); `stabilise`, `deflicker`, `retouch`, `relight`, `motion-track` — analysis tracks, key = `<assetId>:<kind>` (`motion-track`: `<assetId>:<trackId>`), in the binary track format of `ai-editing-tools`; `lut` — a `.cube` file, key = the LUT id of `media.luts` or of an element's `adjustments.lut`; `sticker` — a sticker bitmap or animation, key = the `stickerId`; `image` — a still used as a background or a cutout background, key = the asset id. `url` is: on web and desktop a blob, origin-private or `jagentchill-file://` URL the engine can fetch with range requests; on iOS and Android a path `/derived/<sha256>` of the local engine origin, mapped to a file through the resource map of `mobile-editor.Engine view native module`; on the render host a path of the host-local scheme limited to the blobs and caches of the job's project, sent by the server in the same command before `export.start`. The engine verifies nothing but the declared `sha256` as cache key: two entries with the same hash share one decoded resource. An input that a stage needs and that has no entry, or whose fetch fails, is reported once per key with the diagnostic `derived/unavailable {key, kind}`; preview then renders that stage as identity (the matte stages as defined in "Chroma key and matte stages"), and an export fails at start with `export/derived-unavailable` listing the keys, except for `sticker` and `image` inputs, which follow "Missing or undecodable media". Analysis tracks and mattes are fetched by range and decoded in lock-step with the source frame; LUT files are parsed once and cached by hash within the texture pool. [NEW]

#### Scenario: Matte reaches the engine on a phone
- **WHEN** a clip with `cutout.matteAssetId = "m1"` is shown on iOS or Android and the app has sent `derived.setSources` with `{key: "m1", kind: "matte", url: "/derived/<sha256>"}`
- **THEN** the engine fetches the matte from the local origin by range and the frame is cut out

#### Scenario: Imported LUT on the render host
- **WHEN** a remote export job renders a clip whose adjustment uses a user LUT
- **THEN** the server's `derived.setSources` lists the LUT with a host-local URL, and the exported frame equals the device preview within the tolerance of "Golden-frame determinism"

#### Scenario: Missing analysis track
- **WHEN** a clip has `stabilization.enabled` and no `stabilise` entry was delivered
- **THEN** preview renders the clip unstabilised with one `derived/unavailable` diagnostic, and `export.start` replies `ok: false` with `export/derived-unavailable` naming the key

#### Scenario: Same bytes, one resource
- **WHEN** two elements use LUT entries with the same `sha256`
- **THEN** the LUT texture is created once

### Requirement: Gesture preview overrides
The engine SHALL render uncommitted gesture state supplied through `preview.setOverride` (a map of element id to partial element values) on top of the committed scene without changing the scene revision, and MUST drop all overrides on `preview.clearOverride` or on the next `scene.set`/`scene.patch`. Overrides MUST NOT be included in export or still renders that specify `committedOnly: true`. [PORT U-005] [NEW]

#### Scenario: Drag preview
- **WHEN** the app sends `preview.setOverride` moving an element 100 px right while the scene revision is 10
- **THEN** the next `frame.ready` shows the element displaced and still reports `revision: 10`

#### Scenario: Override cleared by commit
- **WHEN** a `scene.patch` to revision 11 arrives while an override is active
- **THEN** the override map is emptied and the frame is rendered from revision 11 only

### Requirement: Scene build order
The scene builder SHALL produce a `RootNode {duration, frameRate, width, height, children[]}` with children ordered bottom to top as: background nodes, then elements of the main track, then elements of overlay tracks from `overlay[last]` up to `overlay[0]` (so `overlay[0]` is the topmost track). Within a track, elements MUST be ordered by `startTime` and then by element id. Hidden tracks, hidden elements and deactivated elements MUST be skipped. Audio tracks produce no visual nodes. `duration` equals the maximum element end time across all tracks, including audio tracks. Building MUST be a pure function of the scene snapshot, project settings and asset metadata: identical inputs MUST produce a structurally identical tree. Media of kind `slate` (the locally rendered stills of `script-studio.Draft timeline from a script`) are ordinary image assets to the builder. [PORT R-001]

#### Scenario: Overlay stacking
- **WHEN** a scene has a main track with clip M, `overlay[1]` with clip A and `overlay[0]` with clip B, all visible at time 0
- **THEN** the root children order is `[background…, M, A, B]`
- **AND** B is composited last

#### Scenario: Hidden track is skipped
- **WHEN** `overlay[0]` is hidden
- **THEN** no node is created for any element of `overlay[0]`
- **AND** the scene duration still includes those elements' end times

#### Scenario: Same snapshot builds the same tree
- **WHEN** one scene snapshot is built twice in separate engine instances
- **THEN** the two serialised trees are byte-identical

### Requirement: Scene node types
The scene builder SHALL support these node types: `Video`, `Image`, `Text`, `Caption`, `Sticker`, `Graphic`, `Color`, `GradientBackground`, `BlurBackground`, `ImageBackground`, `EffectLayer`, `AdjustmentLayer`, `Transition` and `Compound`. Element types map as: `video` → `Video` (a freeze element is a `video` element whose `freeze` field fixes the source time), `image` → `Image`, `text` → `Text`, `caption` → `Caption`, `sticker` → `Sticker`, `graphic` → `Graphic`, `compound` → `Compound`, `adjustment` → `AdjustmentLayer`, and `effect` → `EffectLayer` whether its single entry has `kind: "effect"` or `kind: "filter"` (there is no filter element type and no filter node type). Every visual node (`Video`, `Image`, `Text`, `Caption`, `Sticker`, `Graphic`, `Compound`) MUST carry transform, opacity, blend mode, clip effects, filter, colour adjustments, clip animation and analysis-track references where the element defines them; crop, flip, chroma key and matte apply to `Video`, `Image`, `Sticker` and `Compound`. Masks MUST be honoured on the maskable types defined by `masks-blending-keying.Maskable element types` — `Video`, `Image`, `Graphic`, `Sticker`, `Compound` and `AdjustmentLayer` nodes — and MUST be ignored on `Text` and `Caption` nodes with a diagnostic `mask/unsupported-element`. An element of a type the builder does not recognise MUST be skipped and reported with a `diagnostic` of severity `error` and id `scene/unknown-element-type`; it MUST NOT abort the build. [PORT R-001] [NEW]

#### Scenario: Every element type maps to a node
- **WHEN** a scene containing one element of each type (video, image, text, caption, sticker, graphic, effect, adjustment, compound) is built
- **THEN** the tree contains one node of the corresponding type per element

#### Scenario: Standalone filter is an effect layer
- **WHEN** an `effect` element whose only entry has `kind: "filter"` sits on an effect track above a video
- **THEN** one `EffectLayer` node is built for it and the filter applies to the composite beneath it

#### Scenario: Mask on a text element is ignored
- **WHEN** a scene snapshot contains a text element with one mask entry
- **THEN** the text renders unmasked
- **AND** one diagnostic `mask/unsupported-element` naming the element id is emitted

#### Scenario: Unknown element type
- **WHEN** a scene snapshot contains an element with `type: "hologram"`
- **THEN** the tree is built without that element
- **AND** one diagnostic with id `scene/unknown-element-type` naming the element id is emitted

### Requirement: Background nodes
The scene builder SHALL resolve the canvas background per frame, and ONLY for the scene being presented — the root scene of the render — or for a compound source whose scene has `compoundBackground: "own"` ("Compound clip nodes", `project-document.Compound background rule`): when the main-track element visible at the frame time (video, image or compound) has its own `background` (`project-document.Per-clip canvas background field`), that value is used; otherwise the project default `settings.background` is used, including in gaps of the root scene's main track. For a main-track compound element the resolved value is the compound element's own `background` or the project default, never a background from inside the referenced scene, and `blur` blurs the compound's texture. The parameter shapes are defined by `projects.Background colour and gradient`, `projects.Background blur and image` and `projects.Transparent background`; the engine renders them as: `color` — one `Color` node covering the canvas; `gradient` — one `GradientBackground` node rasterised to a canvas-size texture by the rules of "Background gradient parsing"; `blur` — one `BlurBackground` node, a cover-fit copy of the current frame of the main-track element at that time blurred with a Gaussian of sigma `intensity / 5 × s`, where `s` is the pixel scale factor of `visual-effects-filters.Resolution-independent effect parameters` (when no main-track element is visible the node renders `#000000`); `image` — one `ImageBackground` node cover-fitted to the canvas; `transparent` — no node. The frame clear colour MUST be opaque black `[0,0,0,1]` except when the resolved background is `transparent`, where it MUST be `[0,0,0,0]` for preview, stills and exports alike; an export without an alpha channel flattens the result onto black. Under a main-track transition window no separate background node is emitted: each of the transition's two input textures is first filled with that side's resolved background nodes and the clip is drawn over it, so the transition shader combines two full pictures ("Transition nodes"); this is the single definition, and `timeline-editing.Per-clip canvas background` cites it. An `image` background whose asset is missing or was removed renders `#000000`. [PORT R-001, R-013] [NEW]

#### Scenario: Blur background behind a portrait clip
- **WHEN** a 1080×1920 video is on the main track of a 1920×1080 project with background `blur` at intensity 40
- **THEN** the frame shows a cover-fit blurred copy of the same video frame filling the canvas with sigma 8 px
- **AND** the contain-fit sharp video is composited above it

#### Scenario: Per-clip background overrides the project default
- **WHEN** the project default background is `#000000`, main-track clip 1 has background `blur` and main-track clip 2 has no `background`
- **THEN** frames inside clip 1 show the blurred copy of clip 1 and frames inside clip 2 show black behind the clip

#### Scenario: Transparent background
- **WHEN** the resolved background is `transparent` and no element covers a pixel
- **THEN** that pixel has alpha 0 in the preview frame, in a PNG still and in an alpha export
- **AND** the same pixel is opaque black in an H.264 export

#### Scenario: Gap in the main track
- **WHEN** Free layer mode leaves a gap on the main track and the frame time falls inside the gap
- **THEN** the project default background is rendered

#### Scenario: Backgrounds travel with their clips through a slide
- **WHEN** two main-track clips with colour backgrounds `#ff0000` and `#0000ff` are joined by a slide transition and the frame at eased progress 0.5 is rendered
- **THEN** every pixel is either the outgoing picture over red or the incoming picture over blue, and no pixel is a blend of red and blue

### Requirement: Background gradient parsing
The engine SHALL parse a gradient background string with exactly this grammar: one or more comma-separated layers, each `linear-gradient(…)`, `radial-gradient(…)`, `repeating-linear-gradient(…)` or `repeating-radial-gradient(…)`, with an optional `-webkit-` or `-moz-` prefix that is ignored, or a plain colour (a solid layer). Linear direction is an angle in `deg`, `rad` or `turn`, or `to <side | corner>` (default `to bottom`). Radial shape is `circle` or `ellipse` with an extent keyword (`closest-side`, `closest-corner`, `farthest-side`, `farthest-corner`; default `farthest-corner`) and an optional `at <position>` (default centre). Lengths accept `px`, `%`, `em` (1 em = 16 px); `px` and `em` lengths are authored at a 1920-px canvas long side and multiplied by the pixel scale factor of `visual-effects-filters.Resolution-independent effect parameters` and `calc()` over `px` and `%` with `+` and `-`. Colours accept `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, CSS named colours, the keyword `transparent` (= `rgba(0, 0, 0, 0)`), `rgb()`, `rgba()`, `hsl()` and `hsla()`; colour stops interpolate in premultiplied sRGB, as CSS does, so a fade to `transparent` keeps the hue of the opaque stop and does not darken (for two opaque stops the result equals non-premultiplied interpolation). Repeating types MUST tile as CSS defines. Layers MUST be painted last to first, so the first layer is on top. `var()`, `conic-gradient` and any other function are unsupported: an unsupported or unparsable layer is skipped with a diagnostic `scene/background-layer-skipped`, and when no layer parses the background renders `#000000` with a diagnostic `scene/background-unparsable`. The stored string MUST never be rewritten by the engine. Rasterisation is at the render size and cached by a hash of the string and the size. [PORT R-013] [NEW]

#### Scenario: Two-stop linear gradient
- **WHEN** the background is `linear-gradient(90deg, #000000 0%, #ffffff 100%)` on a 1920×1080 canvas
- **THEN** the pixel column at x = 960 is RGB (128, 128, 128) within ±2 per channel and the columns at x = 0 and x = 1919 are within ±2 of black and white

#### Scenario: Layered gradient paint order
- **WHEN** the background is `radial-gradient(circle at 50% 50%, rgba(255,0,0,1) 0, rgba(255,0,0,0) 200px), linear-gradient(#0000ff, #0000ff)`
- **THEN** the canvas centre is red and a corner pixel is blue

#### Scenario: Repeating gradient tiles
- **WHEN** the background is `repeating-linear-gradient(90deg, #000 0px, #000 10px, #fff 10px, #fff 20px)` on a 1920-px-wide canvas
- **THEN** 96 black and 96 white vertical bands of 10 px are rendered

#### Scenario: Unsupported layer
- **WHEN** the background is `conic-gradient(red, blue), linear-gradient(#112233, #112233)`
- **THEN** the canvas is filled with `#112233`
- **AND** one diagnostic `scene/background-layer-skipped` is emitted and the stored string is unchanged

#### Scenario: Nothing parses
- **WHEN** the background string is `var(--brand)`
- **THEN** the background renders `#000000` with a diagnostic `scene/background-unparsable`

#### Scenario: Fade to transparent does not darken
- **WHEN** `linear-gradient(to right, #ff0000, transparent)` is rasterised over a white layer
- **THEN** the pixel at 50 % is `rgb(255, 128, 128)` ± 1 per channel, not a darker red

#### Scenario: Pixel lengths on a square canvas
- **WHEN** `radial-gradient(circle 192px at center, #ffffff, #000000)` is rasterised on a 1080 × 1080 canvas
- **THEN** the circle radius is 108 px (192 × 1080 / 1920), the same rule that `projects` catalogue §3 cites

### Requirement: Transition nodes
For two adjacent elements A (outgoing) and B (incoming) on the same track joined by a transition, the scene builder SHALL emit one `Transition` node active over the transition window. Inside the window the engine MUST render A and B each through its per-layer stage chain up to and including the `opacity` stage (the chain stops there; neither side's `blend` stage runs) into separate canvas-size textures, then combine them with the transition's shader using `progress = (t − windowStart) / windowDuration` mapped through the transition's easing, and composite the result as a single layer at the track's stacking position with the alpha handling and blend mode of "Transition alpha and blend rule". For a transition on the main track of the presented scene each input texture is first filled with that side's resolved background nodes ("Background nodes") and no separate background node is emitted under the window; on overlay tracks, and on the main track of a compound source without its own background, the inputs start transparent. Outside the window A and B render as ordinary nodes. Where A has no source material beyond its out point the engine MUST hold A's last frame, and where B has no source material before its in point it MUST hold B's first frame; each held side is reported once per transition with a diagnostic `scene/transition-held-frame` so that `export-share.Export summary` can list it. A transition whose shader id is missing from the registry MUST render as a linear cross-dissolve and emit a diagnostic `shader/unknown-transition`. Transition ids, parameters and eligibility are defined by `transitions.Bundled transition library`. [NEW] [PORT N-001]

#### Scenario: Midpoint of a cross-dissolve
- **WHEN** a 1 s cross-dissolve with linear easing between a solid red clip and a solid blue clip is rendered at the window midpoint
- **THEN** every pixel equals RGB (128, 0, 128) within ±2 per channel

#### Scenario: Frame before the window
- **WHEN** the frame immediately before `windowStart` is rendered
- **THEN** only A contributes to the track's layer and no transition shader runs

#### Scenario: No handle material
- **WHEN** A is trimmed to its exact source end and a 0.5 s transition is centred on the cut
- **THEN** A's final source frame is held for the part of the window after A's out point
- **AND** one diagnostic `scene/transition-held-frame` names the transition

#### Scenario: Unknown transition shader
- **WHEN** a transition references shader id `does-not-exist`
- **THEN** the window renders as a linear cross-dissolve and one diagnostic `shader/unknown-transition` is emitted

### Requirement: Transition alpha and blend rule
Transition shaders SHALL work on premultiplied colour, and the composite of a transition SHALL have one defined blend mode. (1) **Alpha.** The two inputs A and B are canvas-size textures with straight alpha; the engine premultiplies both on entry to the transition shader, every transition formula of `transitions.Bundled transition library` (for example `mix(A, B, p)`) is evaluated on premultiplied RGBA, and the result is un-premultiplied on exit (a pixel with result alpha 0 is written as `[0, 0, 0, 0]`). With that rule a cross-dissolve of a partly transparent overlay never darkens its edges. (2) **Colour fills.** A transition that passes through a colour (`dip to black`, `dip to white`, `dip to colour`, flashes) uses that colour with alpha `max(A.a, B.a)` at each pixel, so the fill covers exactly the area the two clips cover and never the rest of the canvas; on a main-track transition whose inputs carry their backgrounds the inputs are opaque and the fill is therefore full-frame. (3) **Opacity.** Each side's element opacity and clip-animation opacity are applied inside its own chain (the chain ends after the `opacity` stage); the transition item has no opacity of its own. (4) **Blend mode.** Neither side's `blend` stage runs inside the window; the transition result is composited onto the scene once, with A's `blendMode` while the eased progress is below 0.5 and with B's `blendMode` from 0.5 on (identical when the two are equal, which is the case for main-track clips with `normal`). Descriptor fields: `transition.blendModeFrom`, `transition.blendModeTo`, `transition.progress` (eased). (5) **Masks and effects** of each side are inside that side's chain and therefore transition with it. `transitions.Transition rendering` and the transitions catalogue "Conventions" own the per-transition formulas and cite this requirement. [NEW]

#### Scenario: Dissolve of a half-frame overlay does not darken
- **WHEN** two opaque white overlay clips that each cover only the left half of the canvas are cross-dissolved over a white main-track clip and the frame at progress 0.5 is rendered
- **THEN** every pixel of the frame is white (255 ± 1); no grey edge or grey area appears

#### Scenario: Dissolve from a clip to nothing
- **WHEN** A is an opaque red clip covering the canvas and B is fully transparent at a pixel, at progress 0.25
- **THEN** the transition result at that pixel is red with alpha 0.75, not a darkened red

#### Scenario: Dip to black on an overlay covers only the clips
- **WHEN** a "dip to black" joins two overlay clips that cover the centre quarter of the canvas, at the midpoint
- **THEN** the centre quarter is black and the rest of the canvas shows the layers beneath

#### Scenario: Blend mode switches at the midpoint
- **WHEN** an overlay pair has A in `screen` and B in `multiply`
- **THEN** frames with eased progress 0.49 composite the result with `screen` and frames with 0.5 composite it with `multiply`

#### Scenario: Equal blend modes
- **WHEN** both overlay clips use `screen`
- **THEN** the whole window composites with `screen` and the first and last frames of the window match the neighbouring frames outside it within the golden tolerance

### Requirement: Adjustment and effect layer nodes
`EffectLayer` and `AdjustmentLayer` nodes SHALL be emitted for effect elements and adjustment elements and translated into `sceneEffect` items that apply to the composite of everything stacked beneath them within the element's time range. An `AdjustmentLayer` carries the colour chain, an optional filter, optional masks and an opacity (0..1) that mixes between the unadjusted and adjusted scene, with the mask coverage multiplying that mix; an `EffectLayer` carries one entry — an effect with its animated parameters, or a filter with its intensity. Layers above the node MUST NOT be affected. Scene effects run on the canvas-size scene texture. [PORT R-010] [NEW]

#### Scenario: Adjustment layer affects only layers beneath
- **WHEN** an adjustment element with saturation −100 sits on `overlay[1]`, a video sits on the main track and a text element sits on `overlay[0]`
- **THEN** the video is rendered greyscale
- **AND** the text keeps its original colours

#### Scenario: Masked adjustment layer
- **WHEN** the same adjustment element has one rectangle mask covering the left half of the canvas with feather 0
- **THEN** the left half of the video is greyscale and the right half keeps its colours

#### Scenario: Outside the element time range
- **WHEN** the frame time is after the adjustment element's end
- **THEN** no `sceneEffect` item is emitted for it

### Requirement: Compound clip nodes
A `Compound` node SHALL reference another scene of the same project. The engine MUST render the referenced scene at the compound element's mapped source time into an offscreen texture of the project canvas size cleared to `[0, 0, 0, 0]`, then treat that texture as the node's source through the standard per-layer stage chain. A scene rendered as a compound source emits NO background node — neither the project default nor a per-clip `background` of its elements — unless the scene has `compoundBackground: "own"` (`project-document.Compound background rule`), in which case it emits background nodes as a root scene does but only at times covered by an element of its own main track, and stays transparent elsewhere. Every canvas-size target is subject to the texture limit of "Texture cache and upload rules". Audio of the referenced scene MUST be mixed into the parent at the compound element's gain. **Multi-camera.** When the compound element carries `multicam {angleId}` and its scene has `kind: "multicam"` (`project-document.Multi-camera definition`, `project-document.Multi-camera clip`), the engine MUST composite ONLY the track `angles[angleId].trackId` of that scene for picture and MUST take audio from exactly one angle track: the track of the scene's `audioAngleId`, or the element's own angle track when `audioFollowsVideo` is true; no other angle track is decoded for that element (decoder sessions of unused angles are not opened, except by the angle viewer's `thumbnails.request`). Where the selected angle track has no element at the mapped time the picture is transparent and the audio silent. A `multicam.angleId` that does not resolve renders transparent with the diagnostic `scene/multicam-angle`. Nesting depth MUST be limited to 8; a reference cycle or a depth above 8 MUST render the node as fully transparent and emit a diagnostic `scene/compound-cycle` or `scene/compound-depth`. [NEW]

#### Scenario: Compound renders its inner scene
- **WHEN** a compound element referencing scene S starts at 2 s with trim start 1 s and the frame time is 3 s
- **THEN** the node's source texture equals scene S rendered at 2 s

#### Scenario: Reference cycle
- **WHEN** scene S1 contains a compound referencing S2 and S2 contains a compound referencing S1
- **THEN** the cyclic node renders transparent
- **AND** a diagnostic `scene/compound-cycle` names both element ids

#### Scenario: Compound of overlay elements does not hide the main track
- **WHEN** a compound element whose scene holds only a title and a sticker (empty main track, `compoundBackground: "none"`) sits on an overlay track above a main-track video
- **THEN** the compound texture is transparent wherever the title and sticker do not draw, and the frame equals the frame rendered with the two elements placed directly in the parent scene, within the tolerance of "Golden-frame determinism"

#### Scenario: Own background only under main-track content
- **WHEN** a compound scene with `compoundBackground: "own"` has one main-track clip from 0 s to 2 s with a red colour background and the compound element lasts 4 s
- **THEN** the compound texture is red behind the clip from 0 s to 2 s and fully transparent from 2 s to 4 s

#### Scenario: Multi-camera part shows one angle and plays one sound
- **WHEN** a multi-camera part with `multicam.angleId` of angle 2 references a scene with three angle tracks, `audioAngleId` of angle 1 and `audioFollowsVideo: false`
- **THEN** the frame shows only angle 2, the audio is only angle 1, and no decoder session is open for angle 3

#### Scenario: Audio follows video
- **WHEN** the same scene has `audioFollowsVideo: true`
- **THEN** the part showing angle 2 plays the sound of angle 2

### Requirement: Empty template slot rendering
A video or image element that has no `mediaId` because it is an unfilled template slot (`project-document.Template mode model`, `filled: false`) SHALL render identically in preview playback, stills and every export, so that preview and export never differ and the timing of music and text is unchanged: the scene builder substitutes a HOLD frame — the last frame of the nearest earlier filled slot element on the same track, or, when no earlier one exists, the first frame of the nearest following filled slot element on the same track — drawn with the empty element's own transform, crop and effects for the element's whole time range; an unfilled slot on an overlay track renders nothing; when no slot of the track is filled the element renders nothing and the canvas background shows. The placeholder tile with the slot index is NOT rendered by the engine: it is an overlay drawn by the app while the slot is selected or the transport is paused on it (`templates.Slot semantics and locked structure`). The scene builder emits one diagnostic `scene/empty-slot {elementId, slotIndex}` per unfilled slot per session, which `export-share.Pre-flight validation` uses to list empty REQUIRED slots as blocking; empty optional slots are not listed. The same rule applies when a template scene is rendered as a compound source. [NEW]

#### Scenario: Optional slot left empty
- **WHEN** slot 4 of a template is optional and unfilled and slot 3 is filled
- **THEN** during slot 4's time range preview and export both show the last frame of slot 3 held, and the music and titles play at their unchanged times

#### Scenario: First slot empty
- **WHEN** slot 1 is unfilled and slot 2 is filled
- **THEN** slot 1's range shows the first frame of slot 2

#### Scenario: Preview equals export
- **WHEN** the frame in the middle of an unfilled slot is rendered in preview and by the render host
- **THEN** the two frames are equal within the preview-versus-export tolerance and neither contains a placeholder tile

### Requirement: Caption nodes
`Caption` nodes SHALL be rasterised by the same text rasteriser as `Text` nodes using the caption track style merged with per-caption overrides, and MUST support per-word state (`upcoming`, `active`, `spoken`) resolved from word timings at the frame time so that word-highlight styles render deterministically. When a render request sets `includeCaptions: false`, caption tracks MUST be omitted from the scene. [NEW]

#### Scenario: Active word at a frame time
- **WHEN** a caption with words timed [0–400 ms, 400–900 ms, 900–1500 ms] is rendered at 500 ms with a highlight style
- **THEN** the second word is drawn in the highlight colour and the first in the spoken colour

#### Scenario: Captions excluded
- **WHEN** a render is requested with `includeCaptions: false`
- **THEN** the frame contains no caption pixels

### Requirement: Resolve pass
For each frame the engine SHALL run an asynchronous resolve pass over the scene tree that: determines visibility as `0 ≤ clipTime < duration` where `clipTime = frameTime − startTime` and `frameTime` is the frame START time; evaluates every animated property (transform, opacity, colour and background properties of text, graphic parameters, effect, filter, adjustment, mask, chroma key and crop parameters, volume) at that `clipTime` using step, linear and bezier interpolation as defined by `keyframe-animation.Interpolation types`, with colours interpolated as defined by `keyframe-animation.Colour interpolation in linear RGB`; applies clip in, out and combo animations on top of keyframed values; obtains the decoded source frame for video nodes; loads images and stickers; measures and rasterises text; and expands effects into pass groups. A keyframe stored at `time = duration` is never sampled. Invisible nodes MUST NOT trigger decode, rasterisation or upload. [PORT R-002]

#### Scenario: Element not yet started
- **WHEN** the frame time is one tick before an element's `startTime`
- **THEN** the element resolves as invisible and no decode request is issued for it

#### Scenario: Keyframed opacity at the frame start
- **WHEN** an element has opacity keyframes 0 at clip time 0 and 1 at clip time 120 000 ticks with linear interpolation and the frame start is at clip time 30 000 ticks
- **THEN** the resolved opacity is exactly 0.25

#### Scenario: Colour interpolation in linear RGB
- **WHEN** a text colour is keyframed from `#000000` to `#ffffff` linearly and resolved at the midpoint
- **THEN** the resolved sRGB value is `#bcbcbc` (±1 per channel), not `#808080`

#### Scenario: Key at the element end
- **WHEN** an element of duration 120 000 ticks at 30 fps has a key at time 120 000
- **THEN** the last rendered frame samples clip time 116 000 and the key at 120 000 is not sampled on any frame

### Requirement: Source time mapping for retimed clips
The source time of a video or audio node SHALL be obtained from the time-API function `sourceTimeAt(element, clipTime)` and rounded to integer ticks; the mapping itself (constant rate, speed curve, reverse, freeze) is defined by `speed-retime.Retime data model`, `speed-retime.Speed curve model`, `speed-retime.Reverse` and `speed-retime.Freeze frame`, and the engine MUST NOT contain a second formula. The video frame presented MUST be the source frame whose presentation interval contains the source time when `retime.smooth` is `none`; a linear mix of the two neighbouring source frames weighted by the fractional position (shader `frame-blend`) when it is `blend`; and an optical-flow interpolated frame (shaders `optical-flow-estimate` and `optical-flow-warp`) when it is `flow` on the `webgpu` backend. On the `webgl2` backend, or when the capability check of `speed-retime.Smooth slow motion` fails, `flow` MUST render as `blend` and emit a diagnostic `engine/flow-fallback` once per element. The engine MUST use the same mapping for preview, export, thumbnails and audio. [PORT R-003] [NEW]

#### Scenario: Constant 2× speed
- **WHEN** a clip with `trimStart` 120 000 ticks and rate 2 is resolved at clip time 60 000 ticks
- **THEN** the requested source time is 240 000 ticks

#### Scenario: Reversed clip
- **WHEN** a reversed clip covering source range 0–600 000 ticks is resolved at clip time 0
- **THEN** the presented frame is the last source frame of the range

#### Scenario: Frozen clip
- **WHEN** a video element with `freeze.sourceTime` 360 000 ticks is resolved at any clip time
- **THEN** the requested source time is 360 000 ticks

#### Scenario: Flow on WebGL2
- **WHEN** a clip with `retime.smooth: "flow"` is rendered on the `webgl2` backend
- **THEN** the frame is produced by `frame-blend` and one diagnostic `engine/flow-fallback` is emitted for the element

### Requirement: Contain-fit, crop, flip and transform
A visual node's base rectangle SHALL be computed by: applying the element's `crop` (normalised `{left, top, right, bottom}` in source space, each 0–0.99 with `left + right ≤ 0.99` and `top + bottom ≤ 0.99`, as defined by `preview-canvas.Crop mode`) to obtain the cropped source size; contain-fitting the cropped size into the canvas with aspect preserved; multiplying by `transform.scale.x` and `transform.scale.y`; positioning the centre at canvas centre plus `transform.position`; and rotating by `transform.rotation` degrees about the centre (field names of `project-document.Transform`). A negative scale MUST be converted to a positive scale plus a flip on that axis, and the element's explicit `flip {horizontal, vertical}` flags MUST be combined with it by exclusive-or. The clip-animation transform (offset, scale, rotation) of `keyframe-animation.Clip animation model` is composed after the element transform: scale factors multiply, rotations add, offsets add in canvas space. Sticker and graphic nodes use their intrinsic size instead of contain-fit. A crop value outside the stated range in a snapshot MUST be clamped into range with a diagnostic `scene/crop-clamped`. [PORT R-012] [NEW]

#### Scenario: Contain-fit of a portrait video
- **WHEN** a 1080×1920 video with scale 1 is placed in a 1920×1080 canvas
- **THEN** its layer width is 607.5 px and height 1080 px, centred

#### Scenario: Crop then fit
- **WHEN** a 1920×1080 video is cropped with `left: 0.25, right: 0.25` in a 1920×1080 canvas
- **THEN** the cropped 960×1080 region is contain-fitted to 960×1080 centred, with no stretching

#### Scenario: Flip combined with negative scale
- **WHEN** an element has `scale.x: −1` and `flip.horizontal: true`
- **THEN** the layer is drawn with `flipX: false` and width scale 1

#### Scenario: Clip animation composes with the element transform
- **WHEN** an element at scale 0.5 has a clip-in animation whose scale is 1.2 at the frame time
- **THEN** the layer is drawn at scale 0.6

### Requirement: FrameDescriptor schema
The TypeScript side SHALL flatten each resolved frame into a JSON `FrameDescriptor` `{version: 3, width, height, clear: {color: [r,g,b,a]}, items[]}` and a list of textures. `items` MUST be one of: `layer` `{textureId, stabilise: {matrix: number[6], zoom} | null, crop: {left, top, right, bottom}, transform: {centerX, centerY, width, height, rotationDegrees, flipX, flipY}, key: {keyColor, similarity, smoothness, shadow, spill} | null, matte: {textureId, inverted, feather, shift} | null, cutoutBackground: {kind: "color" | "blur" | "texture", color?, sigma?, textureId?, fit?: "cover"} | null, cutoutStroke: {style: "solid" | "dashed" | "glow" | "offset-shadow", width, color, offset, opacity, dash: [on, off]} | null, personMatte: {textureId} | null, boxInverse: number[9], analysis: {deflicker?, retouch?, relight?} | null, color: ColorChain | null, filter: {lutTextureId | shader, intensity} | null, effectPassGroups: EffectPass[][], masks: [{textureId, feather, inverted, opacity, combine: "add" | "subtract" | "intersect" | "exclude"}], maskStroke: {textureId} | null, reveal: {shader, uniforms} | null, motionBlur: {samples, shutter, previous: Transform} | null, opacity, blendMode}`; `transition` `{from: LayerItem, to: LayerItem, shader, uniforms, progress, blendModeFrom, blendModeTo, fromBackground: Item[] | null, toBackground: Item[] | null}` (per "Transition alpha and blend rule"; a transition item has no opacity of its own, each side's opacity being applied inside its chain); `sceneEffect` `{effectPassGroups, color: ColorChain | null, filter, masks, opacity}`; and `group` `{items[], targetTextureId}` used for compound clips. `EffectPass` is `{shader: string, uniforms: Record<string, number | number[]>, textures?: Record<string, textureId>}`; `textures` binds named texture slots declared by the shader (for example `matte` for body effects, bound from `personMatte`), and a pass naming a slot the shader does not declare is `descriptor/invalid`. `boxInverse` is the row-major 3×3 matrix of "Effect coordinate frame". Disabled masks, disabled effects and identity stages MUST be omitted by the TypeScript side. All numeric fields MUST be finite; the wasm side MUST reject a descriptor with a non-finite number, an unknown item kind, an unknown `combine` value or an unknown `version` with error code `descriptor/invalid` and MUST leave the previous frame on the surface. [PORT R-005] [NEW]

#### Scenario: Minimal descriptor
- **WHEN** a frame with one visible image layer and no effects is built
- **THEN** the descriptor has exactly one `layer` item with empty `effectPassGroups`, empty `masks`, and `stabilise`, `key`, `matte`, `analysis`, `color`, `filter`, `maskStroke`, `reveal` and `motionBlur` equal to `null`

#### Scenario: Exclude mask is representable
- **WHEN** an element has two enabled masks, the second with `combine: "exclude"` and opacity 0.5
- **THEN** the layer item lists two masks and the second has `combine: "exclude"` and `opacity: 0.5`

#### Scenario: Invalid descriptor
- **WHEN** `renderFrame` receives a descriptor whose `opacity` is `NaN`
- **THEN** it returns an error with code `descriptor/invalid`
- **AND** the surface still shows the previously rendered frame

### Requirement: Wasm JavaScript API
The wasm package SHALL export, through the `bridge` export macro (camelCase names, one options object per function): `initializeGpu()` (async, idempotent, installs the panic hook), `initCompositor({width, height})`, `resizeCompositor({width, height})`, `getCompositorCanvas()`, `uploadTexture({id, source, width, height})` accepting `OffscreenCanvas`, `ImageBitmap`, `VideoFrame` and `HTMLCanvasElement` sources, `uploadTexturePixels({id, data, width, height})`, `uploadLut({id, data, size})`, `releaseTexture({id})`, `renderFrame({descriptor})`, `readPixels({x, y, width, height})` (RGBA8, top-left origin), `getLastFrameProfile()`, `getTextureStats()`, `listShaders()`, `applyEffectPasses({source, width, height, passes})`, `applyMaskFeather({mask, width, height, feather})`, `destroy()`, and the time functions listed in "Pure TypeScript time maths with wasm parity". Generated TypeScript declarations MUST be committed and checked in CI against the Rust sources so that the documented signatures and the exported signatures cannot diverge. [PORT R-007] [NEW]

#### Scenario: Idempotent GPU initialisation
- **WHEN** `initializeGpu()` is awaited twice
- **THEN** the second call resolves without creating a second device
- **AND** both calls resolve to the same backend name

#### Scenario: Declarations drift check
- **WHEN** a Rust export changes its options struct and the committed `.d.ts` is not regenerated
- **THEN** the CI declaration check fails

### Requirement: Texture cache and upload rules
The texture sync step SHALL upload a texture only when its cache key changes: `external` textures (decoded video frames, image bitmaps) are keyed by source object identity plus width and height; `rendered` textures (text, captions, graphics, masks, gradients, backdrops) are keyed by a content hash of their rasterisation inputs. Video frames MUST be uploaded directly from `VideoFrame` or `ImageBitmap` without an intermediate canvas copy on WebGPU; the WebGL2 path MUST use `texImage2D` from the source object and MUST NOT perform a `getImageData` readback. A texture not referenced by any frame for 120 consecutive rendered frames MUST be released, and textures MUST be released in least-recently-used order whenever GPU texture memory (computed as width × height × 4 bytes per texture) exceeds the GPU-texture pool of "Memory ceilings per platform". No source dimension is permitted to exceed `maxTextureSize`; larger sources MUST be downscaled before upload with aspect preserved. Every canvas-size render target (the scene target, layer textures, compound and transition targets, gradient and background textures) is allocated at `min(requested, maxTextureSize)` on its long side with the aspect preserved, and preview quality scaling is applied before that clamp. An on-device export or still whose OUTPUT long side exceeds `maxTextureSize` is refused at start with `engine/encoder-unavailable`, detail `texture-limit`, and the app offers the export on the host (`export-share.Gateway export hand-off`); the project canvas itself is allowed to be up to 7680 × 4320 (`projects.Canvas size presets and custom size`) on any device. [PORT R-006]

#### Scenario: Static frame causes no uploads
- **WHEN** the same paused frame is rendered twice with no scene change
- **THEN** the `textureUpload` counter is 0 for the second render

#### Scenario: Budget eviction
- **WHEN** uploads push GPU texture memory to 230 MiB on a mobile-class surface
- **THEN** least-recently-used textures are released until usage is at or below 192 MiB
- **AND** no texture referenced by the current frame is released

#### Scenario: Oversized image
- **WHEN** a 12 000×8 000 image is used on a device whose `maxTextureSize` is 8 192
- **THEN** it is uploaded at 8 192×5 461

#### Scenario: 8K canvas on a device limited to 4 096
- **WHEN** a 7680 × 4320 project is previewed on a device with `maxTextureSize` 4 096
- **THEN** every canvas-size target is 4 096 × 2 304 or smaller and the preview renders
- **AND** an on-device export at 7680 × 4320 is refused with `engine/encoder-unavailable` and detail `texture-limit`

### Requirement: Render-target pool
Intermediate render targets (layer textures, effect ping-pong targets, jump-flood targets, transition inputs, compound targets) SHALL be acquired from a pool keyed by `(width, height, format)` and returned at frame end. Effect and jump-flood passes MUST use pooled targets and MUST NOT allocate a new GPU texture per frame in steady state. Pool entries unused for 300 consecutive frames MUST be destroyed, and the whole pool MUST be cleared on `resizeCompositor`, on `memory.trim` and on device loss. [PORT R-007, R-008, R-009]

#### Scenario: Steady-state allocation count
- **WHEN** 300 consecutive frames of an unchanged scene with a blurred, feather-masked layer are rendered
- **THEN** the number of GPU texture creations after the first 5 frames is 0

#### Scenario: Pool cleared on resize
- **WHEN** the compositor is resized from 1920×1080 to 1280×720
- **THEN** every pooled 1920×1080 target is destroyed before the next frame is rendered

### Requirement: Compositor algorithm
The compositor SHALL render a `FrameDescriptor` as follows: (1) clear a scene texture to `clear.color`; (2) for each item in order: a `layer` is produced by the per-layer stage chain and blended onto the scene texture into a new scene texture; a `transition` renders both of its layers through the per-layer chain, combines them with the transition shader and blends the result; a `group` renders its child items into its own target and exposes it as a texture; a `sceneEffect` runs its colour chain, filter and effect groups on the whole scene texture and mixes by its opacity times its mask coverage; (3) present the final scene texture to the surface. Compositing MUST be straight-alpha (non-premultiplied) source-over with the blend function `B(Cb, Cs)` of "Blend modes": `αo = αs + αb × (1 − αs)` and `Co = (αs × (1 − αb) × Cs + αs × αb × B(Cb, Cs) + (1 − αs) × αb × Cb) / αo` (with `Co = 0` when `αo = 0`), where `αs` already includes the layer opacity. The same algorithm and shaders MUST be used for preview, stills, thumbnails, export and the render host. [PORT R-007, R-010]

#### Scenario: Two layers with opacity
- **WHEN** an opaque red layer covers the canvas and an opaque blue layer at opacity 0.5 with normal blend covers it
- **THEN** every pixel equals RGB (128, 0, 128) within ±2 per channel and alpha 255

#### Scenario: Scene effect ordering
- **WHEN** a descriptor contains `[layer A, sceneEffect blur, layer B]`
- **THEN** A is blurred and B is sharp in the output

#### Scenario: Alpha accumulates over a transparent clear
- **WHEN** the clear colour is `[0,0,0,0]` and one white layer at opacity 0.5 covers the canvas
- **THEN** every output pixel is RGBA (255, 255, 255, 128) within ±2 per channel

### Requirement: Per-layer stage order
This requirement is the single definition of the per-layer processing order; every other capability defines parameters only and cites these stage NAMES. Each layer SHALL be processed in exactly this order: `source` (decoded frame, image, rasterised content or group target) → `stabilise` (stabilisation matrix and crop zoom) → `crop` → `flip` → `transform` (element transform composed with the clip-animation transform, drawn into a canvas-size texture with inverse rotation and UV-bounds discard) → `chroma-key` → `matte` (cutout matte, then the cutout background and cutout stroke of "Cutout background and stroke stage") → `retouch` (the analysis-driven corrections of "Analysis-driven stages", in the order deflicker, retouch, makeup, reshape, eye contact, relight) → `color-chain` → `filter` (the single `effects[]` entry with `kind: "filter"`, wherever it sits in the array) → `effects` (entries with `kind: "effect"` in array order, each one pass group; then, when a clip animation of `keyframe-animation.Clip animation model` has a non-zero blur value at the frame time, one `gaussian-blur` pass group whose sigma in px is that value × the pixel scale factor, run after the element's last effect) → `masks` (combined mask coverage, then the clip-animation reveal coverage drawn by the `wipe-reveal` shader, then the mask stroke; the cutout stroke is NOT drawn here but in the `matte` stage, so masks clip it) → `motion-blur` → `opacity` (element opacity × clip-animation opacity) → `blend` (onto the scene). Stages after `transform` run on the canvas-size layer texture, and effect shaders address it through the element-box coordinates of "Effect coordinate frame"; pixel-valued effect parameters are scaled by the pixel scale factor of `visual-effects-filters.Resolution-independent effect parameters`. An implementation MUST produce output that equals this order within the preview-versus-export tolerance of "Golden-frame determinism"; merging adjacent pointwise stages into one shader pass is allowed under that condition. Disabled effects, filters at intensity 0, identity adjustments and absent optional stages MUST produce no pass. [PORT R-007, R-008, R-009] [NEW]

#### Scenario: Stage list is exposed
- **WHEN** `getLastFrameProfile()` is read after rendering a layer that uses every stage
- **THEN** it lists the executed stages by these names in this order: `source`, `stabilise`, `crop`, `flip`, `transform`, `chroma-key`, `matte`, `retouch`, `color-chain`, `filter`, `effects`, `masks`, `motion-blur`, `opacity`, `blend`

#### Scenario: Transform precedes effects
- **WHEN** a clip scaled to 50 % has a Gaussian blur effect whose sigma resolves to 20 px at the render size
- **THEN** the 10–90 % rise distance of the blurred edge measured on the canvas equals that of the same clip at scale 100 % within ±2 px

#### Scenario: Chroma key precedes colour adjustment
- **WHEN** a green-screen clip has chroma key on green and a hue adjustment of +120°
- **THEN** the green background is keyed out before the hue shift and the keyed area is transparent

#### Scenario: Filter position in the array does not matter
- **WHEN** an element's `effects` array is `[blur, filter F, glow]` and another identical element has `[filter F, blur, glow]`
- **THEN** both elements render identical pixels, with F applied before blur and glow

#### Scenario: Mask is applied after effects
- **WHEN** a layer has a blur effect and an ellipse mask with feather 0
- **THEN** the mask edge is sharp while the content inside the ellipse is blurred

#### Scenario: Opacity combines element and clip animation
- **WHEN** an element at opacity 0.5 is at the midpoint of a fade-in clip animation whose opacity is 0.5
- **THEN** the layer is blended at opacity 0.25

#### Scenario: Clip-animation blur runs after the element's effects
- **WHEN** an element with a glow effect is at the start of a `blur-in` clip animation at strength 100 on a 1920×1080 canvas
- **THEN** the frame profile lists the glow pass group followed by one `gaussian-blur` pass group with sigma 40 px inside the `effects` stage
- **AND** a mask on the same element still has a sharp edge

#### Scenario: Clip-animation reveal
- **WHEN** an element is at the midpoint of a `wipe-in` clip animation
- **THEN** the `masks` stage multiplies the layer alpha by the `wipe-reveal` coverage after the combined mask coverage and before any mask stroke

#### Scenario: Identity stages cost nothing
- **WHEN** a layer has an adjustment block with every value at its default and a disabled effect
- **THEN** the frame profile reports 0 colour passes and 0 effect passes for that layer

### Requirement: Effect coordinate frame
Because effects run after the `transform` stage on a canvas-size layer texture, every effect, filter and mask shader SHALL address the picture through one defined frame. For an effect on a clip (an entry of an element's `effects[]`, its filter, its colour-spatial pass and its body effects) the frame is the ELEMENT BOX: `uv = (0, 0)` at the top-left and `(1, 1)` at the bottom-right corner of the element's transformed box as placed on the canvas — after crop, flip, contain-fit, scale, position, rotation and the clip-animation transform — with the axes along the box edges, so the frame rotates and scales with the element. The engine passes to every effect pass the uniform `u_boxInverse: mat3` (descriptor field `layer.boxInverse`), which maps a canvas pixel coordinate (origin top-left, y down, in render-size px) to that `uv`, and `u_boxSize: vec2`, the box size in render-size px; these two join `u_resolution` as uniforms every shader receives. "Radius normalised to the half diagonal", "centre", grid origins and tile counts in the effect catalogues are evaluated in this frame, and lengths in px are render-size px along the box axes, scaled by the pixel scale factor. Sampling outside `uv ∈ [0, 1]²`: remap effects (tile, mirror, kaleidoscope, fisheye, lens distortion and every effect that reads a displaced coordinate) read transparent; blurs and other neighbourhood filters clamp to the edge texel; an effect MUST NOT write opaque pixels outside the box unless its catalogue row says it spills (glow, shadow, outline), in which case the layer texture already has the canvas as its extent. For a standalone effect or filter element (`AdjustmentLayer`, effect track) and for a `sceneEffect` item the frame is the CANVAS: `u_boxInverse` maps the whole canvas to `[0, 1]²` and `u_boxSize = u_resolution`. For the preview at reduced resolution the same frame applies, so an effect looks the same at every preview scale. `visual-effects-filters` catalogue "Conventions" owns the per-effect maths and cites this requirement for `uv`. [NEW]

#### Scenario: Vignette follows a scaled, rotated clip
- **WHEN** a clip at 50 % scale rotated 30° has a vignette effect
- **THEN** the darkening is centred on the clip's centre, bounded by its rotated box, and identical (after the inverse transform) to the vignette of the same clip at 100 % scale and 0°

#### Scenario: Tile effect counts tiles across the element
- **WHEN** a `tile` effect with 3 columns is applied to a clip at 50 % scale
- **THEN** three tiles span the clip's box, not the canvas

#### Scenario: Remap reads transparent outside the box
- **WHEN** a `mirror` effect samples a coordinate outside the element box
- **THEN** the sample is transparent and the layers beneath show through

#### Scenario: Standalone effect uses the canvas
- **WHEN** a vignette is applied as a standalone effect element
- **THEN** it is centred on the canvas centre whatever the clips beneath do

### Requirement: Shader registry and extended shader set
The `effects` crate SHALL hold a shader registry keyed by string id with a typed uniform declaration per shader (`f32`, `vec2`, `vec3`, `vec4`, `i32`, texture slot). The registry MUST contain a shader for every effect, filter and transition id shipped in `visual-effects-filters.Bundled effect library`, `visual-effects-filters.Bundled filter library` and `transitions.Bundled transition library`, plus the engine-owned shaders enumerated with their uniforms in the normative file `specs/render-engine/catalog.md` section "Engine-owned shaders": `gaussian-blur`, `chroma-key`, `matte`, `deflicker`, `retouch`, `makeup`, `reshape`, `eye-contact`, `relight`, `stabilise`, `color-chain`, `color-spatial`, `lut3d`, `frame-blend`, `optical-flow-estimate`, `optical-flow-warp`, `jump-flood`, `mask-combine`, `mask-stroke`, `cutout-background`, `cutout-stroke`, `wipe-reveal`, `motion-blur`, `blend` and `present`. A build-time check MUST fail when a catalogue entry references a shader id absent from the registry, declares a parameter with no uniform mapping, or when `catalog.md` and the registry disagree on an engine-owned shader's uniforms. `listShaders()` MUST return every id with its uniform declaration. At run time a pass naming an unknown shader or an undeclared uniform MUST be skipped (the layer renders without that pass) and reported once per shader id per session with a diagnostic `shader/unsupported`. Every shader MUST compile on both the WebGPU and WebGL2 backends, except `optical-flow-estimate` and `optical-flow-warp`, which are WebGPU-only; shaders using procedural noise MUST derive it from the function of "Deterministic hash" applied to pixel coordinate, frame index and a per-element seed and MUST NOT use wall-clock time. [PORT R-008] [NEW] [PORT N-003]

#### Scenario: Catalogue entry without a shader
- **WHEN** an effect catalogue entry references shader id `vhs-glitch` and the registry has no such shader
- **THEN** the build-time catalogue check fails naming `vhs-glitch`

#### Scenario: Engine-owned shaders are all present
- **WHEN** `listShaders()` is called on either backend
- **THEN** every id of the "Engine-owned shaders" section of `catalog.md` is returned with the uniforms listed there, the two optical-flow shaders being absent only on `webgl2`

#### Scenario: Unknown shader at run time
- **WHEN** a descriptor contains an effect pass with shader `does-not-exist`
- **THEN** the frame renders with that pass skipped
- **AND** exactly one diagnostic `shader/unsupported` for `does-not-exist` is emitted in the session

#### Scenario: Noise is frame-deterministic
- **WHEN** a film-grain effect is rendered twice at the same frame time
- **THEN** both outputs are byte-identical

### Requirement: Deterministic hash
The engine SHALL provide one integer hash used for every pseudo-random value in rendering — shader noise, the `rand(i)` of the effect and transition catalogues, the jitter of `keyframe-animation.Bundled clip animation library` and the per-character variation of `text-and-titles.Text animations in, out and loop` — so that a frame is a pure function of the scene snapshot and the frame time. The hash is the 32-bit PCG output function on unsigned 32-bit integers with wrapping arithmetic: `pcg(x)`: `s = x × 747796405 + 2891336453`; `w = ((s >> ((s >> 28) + 4)) xor s) × 277803737`; result `(w >> 22) xor w`. `hash(seed, i)` = `pcg(pcg(seed) + i)` and `hash(seed, i, j)` = `pcg(hash(seed, i) + j)`; the value mapped to 0…1 is `hash / 4294967296`. A seed derived from a string (an element id, an effect instance id) is the FNV-1a 32-bit hash of its UTF-8 bytes (offset basis 2166136261, prime 16777619). The function MUST be implemented once in `editor-core` (TypeScript), once in the Rust crates and once as a shader include for WGSL and GLSL ES 3.00, and the three MUST return identical integers for a shared vector file of at least 1 000 cases. Wall-clock time, `Math.random`, a platform random source and frame counters that depend on playback history MUST NOT feed any rendered value; the only time input is the frame index `floor(frameTime / frameDuration)` or the element-local time in ticks. [NEW]

#### Scenario: Known vector
- **WHEN** `hash(0, 0)` and `hash(123456789, 42)` are evaluated in TypeScript, in Rust and in a shader on both backends
- **THEN** each implementation returns the same two unsigned 32-bit integers as the shared vector file

#### Scenario: Jitter is repeatable
- **WHEN** a clip with the `shake` clip animation is rendered at the same frame time in two separate engine instances
- **THEN** the element offsets are identical in both renders

#### Scenario: Seeking does not change noise
- **WHEN** a film-grain frame at 5 s is rendered after playing from 0 s and again after seeking directly to 5 s
- **THEN** both outputs are byte-identical

### Requirement: Gaussian blur effect pass
The `gaussian-blur` shader SHALL be a separable 61-tap kernel (offsets −30..30) with weights `exp(−p² / 2σ²)` normalised to sum 1 and uniforms `u_sigma`, `u_step` and `u_direction`. The pass builder MUST emit `iterations = min(8, max(1, ceil(σ² / 40²)))` horizontal-then-vertical pairs, where σ is the larger of the two axis sigmas; because variances add, each pass uses the PER-PASS sigma `u_sigma = σ / sqrt(iterations)` (not σ) and the tap spacing `u_step = max(1, u_sigma / 10)`, so that the cascade has an effective sigma of σ; a sigma below 0.001 emits no pass. This is the classic builder (`effects/definitions/blur.ts`) ported exactly. The sigma in pixels at the render size is `intensity / 5 × s`, where `s` is the pixel scale factor defined by `visual-effects-filters.Resolution-independent effect parameters`; the factor depends only on the render canvas and never on the element's own scale, so the visual strength is independent of preview scaling. The same builder serves the blur background and the clip-animation blur. [PORT R-008]

#### Scenario: Preview scale invariance
- **WHEN** the same blurred scene is rendered at 1920×1080 and at 960×540 and the smaller frame is upscaled 2×
- **THEN** the two images have SSIM of at least 0.97

#### Scenario: Element scale does not change the blur
- **WHEN** the same clip with blur intensity 40 is rendered at element scale 1 and at element scale 0.5 on a 1920×1080 canvas
- **THEN** both renders use sigma 8 px

#### Scenario: Pass count and per-pass sigma for sigma 100
- **WHEN** passes are built for sigma 100
- **THEN** `iterations = ceil(10000 / 1600) = 7`, so 7 horizontal and 7 vertical passes are emitted, each with `u_sigma` 37.80 ± 0.01 (100 / √7) and `u_step` 3.78 ± 0.01

#### Scenario: Small sigma is one pair
- **WHEN** passes are built for sigma 8
- **THEN** one horizontal and one vertical pass are emitted with `u_sigma` 8 and `u_step` 1

#### Scenario: Maximum
- **WHEN** passes are built for sigma 200
- **THEN** `ceil(40000 / 1600) = 25` is capped at 8 iterations, each with `u_sigma` 70.71 ± 0.01 and `u_step` 7.07 ± 0.01

#### Scenario: Effective sigma is the requested sigma
- **WHEN** a main-track image of a black-to-white vertical step edge is rendered with a blur background of `blurIntensity` 500 on a 1920 × 1080 canvas (sigma 100 px)
- **THEN** the Gaussian sigma fitted to the blurred edge profile is 100 px ± 5 %

### Requirement: Colour adjustment pipeline order
This requirement is the single definition of the colour chain order; parameter names, ranges and defaults are defined by `color-adjustment.Adjustment data model`, `color-adjustment.Basic adjustment sliders`, `color-adjustment.HSL per colour band`, `color-adjustment.Curves`, `color-adjustment.Colour wheels` and `color-adjustment.LUT rendering`. The `color-chain` stage SHALL apply, evaluated in floating point with no intermediate 8-bit quantisation, in this fixed order: (1) LUT lookup with its intensity mix; (2) basic, in the order exposure, brightness, contrast, highlights, shadows, whites, blacks, temperature, tint, saturation, vibrance, hue; (3) colour wheels (lift, gamma, gain per channel, computed from the stored pucks and luminance values by "Colour wheel puck mapping"); (4) curves (master, red, green, blue as 256-entry lookup textures); (5) HSL per colour band (eight bands: red, orange, yellow, green, aqua, blue, purple, magenta); (6) the spatial pass (shader `color-spatial`), in the order sharpness, clarity, fade, vignette, grain, which runs as a second pass because it needs neighbouring pixels and coordinates. LUT interpolation MUST be tetrahedral for every cube size from 2 to 65 per edge accepted by `color-adjustment.LUT import`; LUTs are uploaded as 3D textures on WebGPU and as 2D-packed textures on WebGL2 with output equal within the golden tolerance. The same order applies to an element's own adjustments and to an `AdjustmentLayer`. Transfer conventions used by the chain, stated once here so that filter and LUT recipes bake identically everywhere: "linear" operations (exposure, temperature, tint) decode with the sRGB EOTF and re-encode with its inverse; the master curve is applied to R, G and B separately, before the channel curves; HSL band weights, hue, saturation and lightness are those of the HSL model computed from the display-referred sRGB value. A user LUT file reaches the engine through "Derived asset delivery to the engine" (`kind: "lut"`). [NEW] [PORT N-002]

#### Scenario: Identity LUT
- **WHEN** an identity 33-point LUT at intensity 100 is applied to a test chart
- **THEN** the output differs from the input by at most 1 per channel on every pixel

#### Scenario: LUT is applied before exposure
- **WHEN** a clip has a LUT that maps every input above 50 % luminance to white and exposure +1 stop, and the input is 30 % grey
- **THEN** the LUT leaves the pixel at 30 % grey and the output equals 30 % grey raised by one stop
- **AND** the output is not white

#### Scenario: HSL runs after curves
- **WHEN** a red-channel curve turns a neutral grey reddish and the HSL red band has saturation −100
- **THEN** the red, green and blue values of the output pixel are equal within ±2

#### Scenario: Small LUT
- **WHEN** a 2-point identity LUT is applied at intensity 100
- **THEN** the output differs from the input by at most 1 per channel

#### Scenario: No banding from chained stages
- **WHEN** a 0–255 horizontal gradient passes through contrast −50, curves and an HSL lightness change in one chain
- **THEN** the output contains at least 200 distinct grey levels

### Requirement: Colour wheel puck mapping
The engine SHALL convert the stored colour-wheel values of `project-document.Colour adjustments` — for each of `shadows`, `midtones`, `highlights` a puck `(x, y)` inside the unit disc and a `luminance` L of −100…100 — into per-channel lift, gamma and gain with exactly these formulas, which are the single definition used by the inspector preview, by baked filter and LUT recipes and by every surface: hue angle `θ = atan2(y, x)` with 0° = red on the positive x axis, angles increasing counter-clockwise with y pointing up (so 120° is green and 240° is blue); amount `a = min(1, sqrt(x² + y²))`; chroma vector `k = (cos θ, cos(θ − 120°), cos(θ + 120°))` for (R, G, B), which sums to 0 so that a puck move does not change neutral brightness to first order; for a centred puck (`a = 0`) `k` is not evaluated and the colour term is 0. Then per channel `c`: shadows `lift_c = 0.25 × (a_s × k_c + L_s / 100)`; midtones `gamma_c = 2^(a_m × k_c + L_m / 100)`; highlights `gain_c = 2^(a_h × k_c + L_h / 100)`. The transfer applied to each display-referred sRGB channel value `in` in 0…1 is `out = clamp(gain_c × (in + lift_c × (1 − in)), 0, 1)^(1 / gamma_c)`. Recipe notation `angle°, amount` used by the filter and LUT catalogues means `x = amount × cos(angle)`, `y = amount × sin(angle)`. The TypeScript side computes the nine values plus nothing else and passes them in `u_wheels`; the shader contains no trigonometry. With all three pucks centred and all luminance values 0 the step is the identity and produces no pass. `color-adjustment.Colour wheels` owns the control and its ranges and cites this requirement for the maths. [NEW]

#### Scenario: Centred pucks are the identity
- **WHEN** all three wheels have `x = 0`, `y = 0`, `luminance = 0`
- **THEN** lift is (0, 0, 0), gamma and gain are (1, 1, 1), and the colour chain emits no wheels step

#### Scenario: Highlights pushed fully to red
- **WHEN** the highlights puck is at `(1, 0)` with luminance 0
- **THEN** `gain` is (2, 0.7071, 0.7071) ± 0.0001, and a mid-grey input 0.5 becomes (1.0, 0.3536, 0.3536) ± 0.001

#### Scenario: Shadows luminance only
- **WHEN** the shadows wheel has a centred puck and luminance +40
- **THEN** `lift` is (0.1, 0.1, 0.1) and an input of 0 becomes 0.1 on every channel

#### Scenario: Midtones toward green
- **WHEN** the midtones puck is at amount 0.5, angle 120°
- **THEN** `gamma` is (2^−0.25, 2^0.5, 2^−0.25) = (0.8409, 1.4142, 0.8409) ± 0.0001

#### Scenario: Baked recipe equals the live wheel
- **WHEN** a filter recipe "highlights 30°, 0.2" is baked into a LUT and the same values are set on the wheel of an identical clip
- **THEN** the two frames are equal within the tolerance of "Golden-frame determinism"

### Requirement: Chroma key and matte stages
The `chroma-key` stage SHALL implement the parameters of `masks-blending-keying.Chroma key` (`color`, `strength`, `edge`, `shadow`, `spill`, each 0–100) with the uniform mapping `similarity = strength / 100`, `smoothness = edge / 100`, `shadow = shadow / 100`, `spill = spill / 100`. For each pixel, with `(Cb, Cr)` and luma `Y` computed with BT.709 coefficients from the non-linear sRGB value and `d = min(1, 2 × ‖(Cb, Cr) − (Cb_key, Cr_key)‖)`: `a = smoothstep(similarity, similarity + smoothness, d)` (a hard step at `d > similarity` when `smoothness = 0`); `alpha = a + shadow × (1 − Y) × (1 − a)`; the layer alpha is multiplied by `alpha`; and the pixel colour is moved toward its own luma by the factor `spill × (1 − smoothstep(similarity, similarity + 2 × smoothness + 0.1, d))` wherever `alpha > 0`. The `matte` stage SHALL multiply layer alpha by the red channel of a matte texture aligned to the source frame (`1 − value` when inverted), after applying the matte's `feather` and `shift` (edge offset, negative shrinks), both in px at a 1920-px long side multiplied by the pixel scale factor of `visual-effects-filters.Resolution-independent effect parameters`, defined by `masks-blending-keying.Cutout model and auto cutout`; the matte texture for a video comes from a per-frame matte track decoded in lock-step with the source frame at the same source time. The matte file reaches the engine through "Derived asset delivery to the engine" (`kind: "matte"`). What happens to the picture after the matte — the replaced background and the stroke — is defined by "Cutout background and stroke stage". When the matte frame for a source time is unavailable the layer MUST render unmatted in preview with a diagnostic `matte/unavailable` and MUST fail an export render with code `export/matte-unavailable`. [NEW]

#### Scenario: Key out pure green
- **WHEN** a frame that is pure `#00ff00` except for a red square is keyed on `#00ff00` with strength 40 and edge 10
- **THEN** green pixels have alpha 0 and the red square has alpha 255

#### Scenario: Soft edge midpoint
- **WHEN** a pixel's chroma distance is `d = similarity + smoothness / 2` with shadow 0
- **THEN** its alpha factor is 0.5 ± 0.02

#### Scenario: Strength zero
- **WHEN** strength is 0 and edge is 0
- **THEN** only pixels whose chroma equals the key colour exactly (`d = 0`) become transparent

#### Scenario: Matte lock-step
- **WHEN** a video with a cutout matte track is rendered at source time 2.5 s
- **THEN** the matte frame used is the one with the same source timestamp as the video frame

#### Scenario: Matte missing at export
- **WHEN** an export render reaches a frame whose matte sample does not exist
- **THEN** the render fails with `export/matte-unavailable` naming the element

### Requirement: Cutout background and stroke stage
The `matte` stage SHALL implement the whole cutout of `project-document.Chroma key and cutout fields` — matte, replaced background and stroke — in this fixed order on the layer texture: (1) keep the pre-matte texture `P` (the output of `chroma-key`); (2) multiply alpha by the matte coverage `m` (after `inverted`, `feather` and `shift`, "Chroma key and matte stages"), giving the subject `S`; (3) when `cutoutStroke` is present, build the stroke coverage from the matte edge with the `cutout-stroke` shader and composite it UNDER the subject for the styles `glow` and `offset-shadow` and OVER the subject's edge for `solid` and `dashed`; (4) when `cutoutBackground` is present, composite `S` (with its stroke) over the background `B`, drawn INSIDE the element's box only (pixels outside the box stay transparent): `kind: "color"` — `B` is the colour, opaque; `kind: "blur"` — `B` is `P` blurred with "Gaussian blur effect pass" at sigma `blurIntensity / 5 × s` px (`cutout.background.blurIntensity` 0–100, `s` the pixel scale factor), with `P`'s own alpha; `kind: "texture"` — `B` is the frame of the asset `cutout.background.mediaId` at the element's local time (a video loops; an image is static), cover-fitted to the element box, delivered as media (`media.setSources`) or, for an image, through "Derived asset delivery to the engine". With `cutout.background.kind: "none"` there is no background and the layer is the subject alone. Descriptor fields: `layer.cutoutBackground {kind, color?, sigma?, textureId?, fit}` and `layer.cutoutStroke {style, width, color, offset, opacity, dash}`; stroke `width` and `offset` are reference-canvas px multiplied by the pixel scale factor; `opacity` 0–1; `dash` is `[3 × width, 2 × width]` along the arc length of the matte contour for `dashed` and `[0, 0]` otherwise; for `offset-shadow` the scalar `offset` displaces the stroke coverage by `(offset, offset)` (down-right) and for `glow` `offset` is the distance from the matte edge at which the glow starts and `width` is its falloff length: the coverage at distance `d` outside the edge is `exp(−(d − offset) / width)` for `offset ≤ d ≤ offset + 3 × width` and 0 beyond, exactly as `masks-blending-keying.Cutout stroke` states — it is not a blur radius. Because the stroke and the background are produced inside the `matte` stage, every subsequent stage — colour chain, filter, effects, MASKS, motion blur, opacity — acts on the composed result, so a mask clips the stroke and the replaced background together with the subject. The cutout stage renders identically for a matte from auto cutout and from custom cutout; with no matte available it follows the missing-matte rule of "Chroma key and matte stages" and draws neither background nor stroke. The `cutout-background` and `cutout-stroke` shaders and their uniforms are listed in `catalog.md` section "Engine-owned shaders". `masks-blending-keying.Replace background after cutout` and `masks-blending-keying.Cutout stroke` own the parameters and cite this requirement for the rendering. [NEW] [CAPCUT CC-157, CC-158]

#### Scenario: Colour background stays inside the element box
- **WHEN** a cut-out clip scaled to 50 % has `cutout.background {kind: "color", color: "#00ff00"}`
- **THEN** the green fills the element's box behind the subject and every pixel outside the box shows the layers beneath

#### Scenario: Blur background uses the uncut picture
- **WHEN** a cut-out clip has `cutout.background {kind: "blur", blurIntensity: 50}` on a 1920 × 1080 canvas
- **THEN** behind the sharp subject the clip's own uncut picture is shown blurred with sigma 10 px

#### Scenario: Mask clips stroke and background
- **WHEN** a cut-out clip with a solid white stroke and a colour background also has a circular mask
- **THEN** nothing of the subject, the stroke or the background is visible outside the circle

#### Scenario: Stroke opacity and dashes
- **WHEN** `cutout.stroke` is `{style: "dashed", width: 10, opacity: 50}` on a 1920-px canvas
- **THEN** the contour is drawn in dashes of 30 px with 20 px gaps along its arc length at 50 % alpha

#### Scenario: No matte yet
- **WHEN** the matte for the current frame is unavailable in preview
- **THEN** the clip renders uncut with no background and no stroke, with the diagnostic `matte/unavailable`

### Requirement: Body-effect matte inputs and frame history
Effects that declare `requires: "person-matte"` in `visual-effects-filters.Bundled effect library` SHALL receive the person matte as a TEXTURE input of their passes: the resolve pass obtains, for the layer's source frame, the matte frame of the entry `kind: "person-matte"`, key `<assetId>:person` of "Derived asset delivery to the engine" (produced and cached by `ai-editing-tools.Person matte for body effects`, independent of the element's `cutout`), uploads it as an R8 texture aligned to the source frame, carries it through the `crop`, `flip` and `transform` stages with the layer so that it stays registered to the picture, and exposes it as `layer.personMatte {textureId}`; each pass of such an effect binds it through `EffectPass.textures.matte`. The matte is decoded in lock-step with the source frame at the same source time, exactly like the cutout matte, and upsampling to the layer texture is the joint bilateral upsampling specified by `visual-effects-filters.Body effects use the on-device person matte`. One person matte per layer is bound however many body effects the layer has. When the matte frame is unavailable: in preview the body effect's passes are skipped (the layer renders without that effect) with the diagnostic `matte/unavailable`; an export fails at start with `export/derived-unavailable`. **Frame history.** No stage and no effect pass receives a frame of another time: the resolve pass supplies exactly one decoded source frame per layer per rendered frame (two only for `retime.smooth` blending and for the motion-blur previous transform, which uses the same frame). The frame-history budget is therefore zero frames on every platform; an effect that needs earlier frames (trails, echoes, temporal accumulation) MUST NOT be registered, and the build-time check of "Shader registry and extended shader set" fails for a catalogue entry that declares `requires: "frame-history"` or a texture slot named `previous`. [NEW]

#### Scenario: Background blur keeps the person sharp
- **WHEN** a clip with the body effect `background-blur` and no cutout is rendered and its person matte is delivered
- **THEN** the pass receives the matte in its `matte` slot, pixels with matte 1 are unblurred and pixels with matte 0 are blurred

#### Scenario: Matte stays registered after a transform
- **WHEN** the same clip is cropped, flipped horizontally, scaled to 50 % and rotated 30°
- **THEN** the matte edge coincides with the person's edge within 1 px of the layer texture

#### Scenario: Two body effects share one matte
- **WHEN** a layer has `body-outline` and `background-mono`
- **THEN** the descriptor carries one `personMatte` and both pass groups bind the same texture id

#### Scenario: Effect that needs earlier frames is rejected at build time
- **WHEN** a catalogue entry declares `requires: "frame-history"`
- **THEN** the build-time registry check fails and names the entry

### Requirement: Multi-mask compositing with feather
This requirement is the single definition of mask compositing maths; mask types, parameters and the limit of 8 masks per element are defined by `masks-blending-keying.Mask data model` and `masks-blending-keying.Multiple masks and combine modes`. Each enabled mask shape is rasterised on the TypeScript side into a canvas-size single-channel texture in the space of the transformed layer, cached by content hash. On the GPU each mask with `feather > 0` MUST be feathered individually, before combination, by a jump-flood signed-distance pass (seed where mask red > 0.5, `ceil(log2(max(width, height)))` ping-pong steps over a 3×3 neighbourhood, run for inside and outside) with output `smoothstep(−feather / 2, +feather / 2, d_out − d_in)`; a mask with `feather = 0` is used as is. With `m` the feathered coverage, each mask contributes `c = opacity × (inverted ? 1 − m : m)`, where `opacity` is 0…1 in the descriptor (the stored 0–100 value of `masks-blending-keying.Base mask parameters` divided by 100). Masks are combined in list order into an accumulator `acc` whose initial value is 0 when the first mask's `combine` is `add` or `exclude` and 1 when it is `subtract` or `intersect`: `add` = `max(acc, c)`, `subtract` = `acc × (1 − c)`, `intersect` = `min(acc, c)`, `exclude` = `|acc − c|`. The combined coverage multiplies the layer alpha in the `masks` stage. A mask stroke MUST be drawn into the layer's own texture after the coverage is applied and before the `motion-blur`, `opacity` and `blend` stages, so that it inherits the element's opacity and blend mode. More than 8 masks in a descriptor layer MUST apply the first 8 and emit a diagnostic `mask/limit-exceeded`. The cutout stroke is not part of this stage: it is drawn in the `matte` stage ("Cutout background and stroke stage"), before mask coverage, so masks clip it. [PORT R-009] [PORT N-016]

#### Scenario: Single rectangle mask
- **WHEN** a full-canvas white layer has one centred rectangle mask covering 50 % of the width and height with feather 0
- **THEN** pixels inside the rectangle have alpha 255 and pixels outside have alpha 0

#### Scenario: Subtract combination
- **WHEN** a layer has a rectangle mask followed by an ellipse mask with `combine: "subtract"` positioned inside the rectangle
- **THEN** the layer is visible inside the rectangle except inside the ellipse

#### Scenario: Intersect uses the minimum
- **WHEN** two overlapping masks have coverages 0.5 and 0.5 at a pixel and the second has `combine: "intersect"`
- **THEN** the combined coverage at that pixel is 0.5, not 0.25

#### Scenario: Exclude combination
- **WHEN** two overlapping rectangle masks with feather 0 are combined and the second has `combine: "exclude"`
- **THEN** the layer is visible where exactly one of the rectangles covers and transparent where both or neither cover

#### Scenario: Mask opacity
- **WHEN** a single `add` mask has opacity 0.5 and feather 0
- **THEN** pixels inside the shape have alpha 128 ± 2 and pixels outside have alpha 0

#### Scenario: Feather width
- **WHEN** a mask edge has feather 40 px on a canvas rendered at a 1920-px long side
- **THEN** alpha rises monotonically from 0 to 255 across a band 40 px wide (±2 px) centred on the edge

#### Scenario: Stroke inherits opacity and blend
- **WHEN** a masked layer with a white 8 px mask stroke has opacity 0.5 and blend mode `multiply` over a mid-grey backdrop
- **THEN** the stroke pixels equal the backdrop multiplied by white at 50 % opacity (unchanged mid-grey within ±2), not opaque white

#### Scenario: Ninth mask
- **WHEN** a descriptor layer lists 9 masks
- **THEN** the first 8 are applied and a diagnostic `mask/limit-exceeded` is emitted

### Requirement: Blend modes
The compositor SHALL implement 17 blend modes with these kebab-case ids and shader codes 0–16 in order: `normal`, `darken`, `multiply`, `color-burn`, `lighten`, `screen`, `plus-lighter`, `color-dodge`, `overlay`, `soft-light`, `hard-light`, `difference`, `exclusion`, `hue`, `saturation`, `color`, `luminosity`. The blend function `B(Cb, Cs)` of each mode is the formula in the 17-row table of the normative file `specs/render-engine/catalog.md` section "Blend formulas" (the formulas of W3C Compositing and Blending Level 1, with `plus-lighter = min(1, Cb + Cs)`). The TypeScript enum and the Rust enum MUST be generated from one list. The non-separable modes (`hue`, `saturation`, `color`, `luminosity`) MUST use luma weights (0.3, 0.59, 0.11). Blending is computed on gamma-encoded sRGB values with the straight-alpha compositing of "Compositor algorithm". An unknown blend id MUST fall back to `normal` with a diagnostic `blend/unknown`. The user-facing list and grouping are defined by `masks-blending-keying.Blend modes`. [PORT R-007]

#### Scenario: Multiply
- **WHEN** an opaque layer of RGB (128, 128, 128) is blended with `multiply` over an opaque backdrop of RGB (200, 100, 50)
- **THEN** the result is RGB (100, 50, 25) within ±2 per channel

#### Scenario: Screen
- **WHEN** an opaque layer of RGB (128, 128, 128) is blended with `screen` over RGB (200, 100, 50)
- **THEN** the result is RGB (228, 178, 153) within ±2 per channel

#### Scenario: Every mode matches its formula
- **WHEN** each of the 17 modes blends the opaque source colours (255, 128, 0), (64, 64, 64) and (10, 200, 250) over the opaque backdrops (200, 100, 50) and (30, 30, 220)
- **THEN** every one of the 102 results equals the value computed from that mode's formula in `catalog.md` within ±2 per channel

#### Scenario: Enum parity
- **WHEN** the blend-mode parity test compares the TypeScript list with the Rust enum
- **THEN** both contain the same 17 ids in the same order

#### Scenario: Unknown blend id
- **WHEN** a descriptor layer has `blendMode: "linear-light"`
- **THEN** it is composited with `normal` and one diagnostic `blend/unknown` is emitted

### Requirement: Analysis-driven stages
The engine SHALL consume per-clip analysis tracks produced by `ai-editing-tools`: a stabilisation track (one 2×3 affine matrix plus a uniform crop zoom per source frame, applied in the `stabilise` stage), and — applied in the `retouch` stage in this order — a deflicker track (a 4×4 grid of luminance gains per source frame, bilinearly interpolated across the frame), a retouch track (per source frame: up to 5 faces with landmark sets and optional body pose points, driving skin, makeup, reshape and eye-contact passes) and a relight track (per source frame: a single-channel depth map reference). The tracks reach the engine through "Derived asset delivery to the engine" (`kind` `stabilise`, `deflicker`, `retouch`, `relight`). Analysis data is addressed by source time, so it remains valid after trim, split, retime and reverse. When a frame has no analysis sample the stage MUST use the nearest sample within 2 source frames and otherwise run as identity. The tools, their parameters and their acceptance thresholds are defined by `ai-editing-tools.Video stabilisation`, `ai-editing-tools.Flicker removal`, `ai-editing-tools.Face retouch`, `ai-editing-tools.Eye contact correction` and `ai-editing-tools.Relight`. [NEW]

#### Scenario: Stabilisation survives a split
- **WHEN** a stabilised clip is split at 3 s
- **THEN** both resulting clips render with the same per-frame stabilisation transforms as before the split

#### Scenario: Missing sample
- **WHEN** a retouch track has no sample within 2 frames of the requested source frame
- **THEN** the retouch stage renders the frame unmodified

#### Scenario: Reversed clip keeps its analysis
- **WHEN** a clip with a relight track is reversed
- **THEN** each presented source frame uses the depth sample with the same source timestamp

### Requirement: GPU backend selection and WebGL2 fallback
`initializeGpu()` SHALL request a WebGPU adapter with power preference `high-performance` and, when no adapter or device is obtained, fall back to WebGL2 through wgpu's GL backend with limits `downlevel_webgl2_defaults` adjusted to the adapter's maximum texture resolution. WebGL2 is the only rendering fallback. **Software rasterisation has one definition for the client engine and the render host:** a backend is `software: true` when the selected API runs on a software rasteriser (Chromium's SwiftShader or an equivalent CPU adapter; WebGPU adapter info `isFallbackAdapter`, or a WebGL2 context that can only be created without `failIfMajorPerformanceCaveat`). The client engine (web, desktop on macOS, Windows and Linux, and the mobile surface) requests WebGPU with `forceFallbackAdapter: false` and WebGL2 with `failIfMajorPerformanceCaveat: true`, so a software context is refused and the result is `backend: "none"` ("Behaviour without a GPU backend") — UNLESS the preference "Allow software rendering" of `settings-preferences.Performance preferences` (default off; offered on web and desktop, where a software rasteriser exists; not offered on iOS and Android, whose WebViews have none) is on, in which case the engine accepts the software WebGL2 context and `engine.ready` reports `backend: "webgl2", software: true`; `preview-canvas.Degraded graphics notice` then reads "Preview is rendered without a GPU and will be slow", and the performance budgets of "Performance budgets" do not apply. The render host always accepts a software context and reports the same pair `{backend, software}`; there is no third backend value `software`. The surface format is `Bgra8Unorm` on WebGPU and `Rgba8Unorm` on WebGL2; present mode is Fifo. On WebGPU the compositor renders directly to the surface; on WebGL2 it composites to a texture and then presents. The `webgl2` backend has exactly one reduced feature: `retime.smooth: "flow"` renders as `blend` (see "Source time mapping for retimed clips"); every other stage, effect, filter, transition and mask MUST render on both backends and pass the golden-frame suite. The selected backend is reported in `engine.ready`. The preference "Force WebGL2 rendering" of `settings-preferences.Performance preferences` MUST take effect immediately: toggling it disposes the engine and re-initialises it with `forceBackend` set or cleared, restoring the scene and playhead within 2 000 ms on the reference desktop. [PORT R-011]

#### Scenario: WebGPU unavailable
- **WHEN** `navigator.gpu` is undefined and WebGL2 is available
- **THEN** `engine.ready` reports `backend: "webgl2"`
- **AND** preview, stills and export all function

#### Scenario: Forced WebGL2
- **WHEN** the user enables "Force WebGL2 rendering" on a WebGPU-capable device while a project is open
- **THEN** the engine re-initialises without a manual reload and `engine.ready` reports `backend: "webgl2"`
- **AND** the same frame is visible again within 2 000 ms

#### Scenario: Software context is refused by default
- **WHEN** `engine.init` runs on a desktop whose only WebGL2 context is software-rasterised, with "Allow software rendering" off
- **THEN** `engine.ready` reports `backend: "none"` and the no-GPU state applies, while the built-in render host on the same machine reports `backend: "webgl2", software: true` and can export

#### Scenario: Software rendering allowed by the user
- **WHEN** the same desktop has "Allow software rendering" on
- **THEN** `engine.ready` reports `backend: "webgl2", software: true`, frames are rendered, and the degraded-graphics notice is shown

### Requirement: Behaviour without a GPU backend
When neither WebGPU nor WebGL2 can be initialised under the rules of "GPU backend selection and WebGL2 fallback" — no hardware-accelerated context exists and either no software context exists or software rendering is not allowed on that surface — the engine SHALL report `backend: "none"` in `engine.ready`, and this is the one definition of the no-GPU state for every capability, for the client engine and the render host alike (a render host that can create no context at all, even in software, writes no `hello` and is unhealthy with reason `no-backend`; a client in that situation is in this state): nothing is rendered — no compositor is created, `frame.ready` is never emitted, and `still.render`, `layout.sampleSource` and on-device `export.start` reply `ok: false` with code `engine/no-gpu`. The engine MUST NOT contain a Canvas2D or other software compositing path, because it cannot reproduce shader output; no capability renders an approximation (no hard-edged masks, no unkeyed picture, no blended slow motion). Every element parameter (transform, masks, chroma key, cutout, effects, colour, retime) stays editable through `editor-core` and the inspector. When commanded, the transport clock, audio playback, `transport.time` events and filmstrip thumbnails decoded through WebCodecs MUST keep working, and waveform display and saving are unaffected; which transport controls the UI offers in this state is decided by `preview-canvas.Engine states`. Export on a paired host remains available as defined by `export-share.Gateway export hand-off`; on the desktop app this includes the built-in host's render host on the same computer, which renders in software when it must, and `preview-canvas.Engine states` offers "Export on this computer's host" in this state. After `desktop-app.Hardware acceleration and media capability flags` relaunches with GPU acceleration disabled, the client is in this state unless "Allow software rendering" is on. The user-facing notice, its "Try again" action (which sends `engine.dispose` followed by `engine.init`) and the controls disabled in this state are defined by `preview-canvas.Engine states`. [PORT R-011, V-024] [NEW]

#### Scenario: Degraded playback
- **WHEN** `transport.play` is sent in the no-GPU state on a timeline with audio
- **THEN** audio plays and `transport.time` advances
- **AND** no `frame.ready` event is emitted

#### Scenario: On-device export refused
- **WHEN** `export.start` is sent in the no-GPU state
- **THEN** the engine replies `ok: false` with code `engine/no-gpu`

#### Scenario: Parameters stay editable
- **WHEN** the user changes a mask feather and a chroma-key strength in the no-GPU state
- **THEN** both values are committed to the project as undoable commands
- **AND** no picture of any kind is drawn in the preview area

#### Scenario: Try again after the GPU returns
- **WHEN** the GPU becomes available and the app sends `engine.dispose` then `engine.init`
- **THEN** `engine.ready` reports `webgpu` or `webgl2` and the current frame is rendered

### Requirement: Colour management
The engine SHALL use 8-bit sRGB (BT.709 primaries, sRGB transfer) as its single working space; the whole pipeline is SDR. Decoded video MUST be converted to full-range sRGB RGB using the matrix and range signalled by the stream (BT.601 for SD sources with no signalling, BT.709 otherwise). Images with an embedded ICC profile MUST be converted to sRGB at decode. HDR sources (PQ or HLG transfer, BT.2020 primaries) MUST be tone-mapped to SDR sRGB at decode with a fixed BT.2390 EETF targeting 100 nits and flagged with a `diagnostic` of severity `caution` and id `color/hdr-tonemapped` once per asset. Encoded video output MUST be tagged BT.709 primaries, BT.709 transfer, BT.709 matrix, limited range. HDR output, wide-gamut output and 10-bit intermediates are outside the product (proposal Non-goals), and no engine command or export setting selects them. Alpha is straight (non-premultiplied) throughout. [NEW]

#### Scenario: Limited-range decode
- **WHEN** a BT.709 limited-range video frame of code value Y=235 (white) is decoded and rendered
- **THEN** the output pixel is RGB (255, 255, 255) within ±1

#### Scenario: HDR source
- **WHEN** an HLG BT.2020 clip is added to the timeline
- **THEN** it renders tone-mapped to SDR
- **AND** one `color/hdr-tonemapped` diagnostic is emitted for that asset

#### Scenario: Output tagging
- **WHEN** an exported MP4 is inspected
- **THEN** its video track signals colour primaries 1, transfer characteristics 1 and matrix coefficients 1 with limited range

#### Scenario: No HDR output setting exists
- **WHEN** `export.start` is sent with a transfer characteristic other than BT.709
- **THEN** the engine replies `ok: false` with `surface/invalid-payload`

### Requirement: Video decode and frame cache strategy
The engine SHALL decode video with WebCodecs through mediabunny, one decoder session per `(assetId, variant)` in a worker, with no `<video>` element. For a requested source time `t` the session MUST: (1) return a cached frame whose interval `[timestamp, timestamp + duration)` contains `t`; else (2) if `t` is within `[lastTime, lastTime + 2.0 s)` decode forward sequentially, accepting a frame within +0.05 s tolerance and aborting to a seek if a decoded frame is more than 1.0 s past `t`; else (3) seek to the keyframe at or before `t` and decode forward. During forward playback the session MUST prefetch up to 0.5 s of frames ahead of the playhead; during reverse playback it MUST stay inside the frame pool of "Bounded video frame cache memory": with `frameBytes = codedWidth × codedHeight × 4` and `N = floor(0.5 × pool / frameBytes)` (at least 2), the session decodes the group of pictures from its key frame in windows of `N` frames — it keeps the window that contains the target, discards earlier frames as it decodes past them, serves the window back to front, and re-decodes from the key frame to obtain the previous window. When `N < 4`, or the re-decode cannot keep the displayed rate at or above half the project frame rate for 1 s, the session presents only key frames (plus any frame already cached) and the engine reports `transport.state` with `reason: "reverse-keyframes"`; it returns to full reverse when the condition clears for 2 s. Reverse shuttle always uses the proxy variant (1 s key-frame interval) when one exists, and on iOS and Android always, creating no decoder session for the original. A whole group of pictures is never held when it does not fit `N`. Requests are serialised per session with a generation counter: in `scrub` mode a superseded request resolves with the nearest already-decoded frame; in `exact` mode and in export the exact frame MUST always be decoded and returned. The number of simultaneously open decoder sessions is limited to 8 on desktop, 6 on web and 3 on mobile; the least recently used session is closed first and reopened on demand. [PORT R-003]

#### Scenario: Sequential playback does not seek
- **WHEN** a clip plays forward for 5 s at 1× with no user seek
- **THEN** the decoder session performs exactly one keyframe seek at the start

#### Scenario: Scrub returns a nearby frame quickly
- **WHEN** 20 `transport.seek` commands in `scrub` mode arrive within 200 ms
- **THEN** intermediate requests resolve with already-decoded frames and only the final time is decoded exactly
- **AND** the last `frame.ready` has `exact: true` for the final time

#### Scenario: Decoder limit on mobile
- **WHEN** a fourth distinct video asset becomes visible on a mobile surface with 3 open sessions
- **THEN** the least recently used session is closed before the new one opens

#### Scenario: Reverse shuttle within the mobile pool
- **WHEN** a 720p proxy with a 1 s key-frame interval is shuttled in reverse on a phone with a 128 MiB frame pool (`frameBytes` 3 686 400, `N = 18`)
- **THEN** at most 18 decoded frames of that session are held at any time and the frame pool limit is never exceeded

#### Scenario: Long-GOP original on desktop
- **WHEN** a 2160p original with a 4 s key-frame interval and no proxy is shuttled in reverse on a desktop with a 512 MiB frame pool (`N = 8`)
- **THEN** frames are served in windows of 8, and when the re-decode cannot hold half the project frame rate the engine shows key frames only and `transport.state` carries `reason: "reverse-keyframes"`

### Requirement: Bounded video frame cache memory
Decoded frames held across all sessions (current, prefetched and reverse-GOP frames) SHALL be bounded by the video-frame pool of "Memory ceilings per platform", counted as `codedWidth × codedHeight × 4` per frame. On exceeding the budget the cache MUST close frames in this order: prefetched frames of sessions not visible at the playhead, reverse-GOP frames, then least-recently-used current frames, never closing a frame referenced by the frame being rendered. Every `VideoFrame` MUST be closed when evicted, when its asset is removed and on `engine.dispose`; a test MUST assert zero unclosed frames after dispose. On a `memory.pressure` signal from the platform the cache MUST drop to 50 % of its budget within 500 ms. [PORT R-003] [NEW]

#### Scenario: Budget holds with many 4K clips
- **WHEN** a timeline with six overlapping 4K clips is scrubbed for 60 s on desktop
- **THEN** the cache's reported byte usage never exceeds the desktop video-frame pool of 512 MiB

#### Scenario: Budget on mobile
- **WHEN** a timeline with three overlapping 1080p proxies is scrubbed for 60 s on a reference mobile device
- **THEN** the cache's reported byte usage never exceeds 128 MiB

#### Scenario: No leaked frames
- **WHEN** the engine is disposed after playback
- **THEN** the count of open `VideoFrame` objects owned by the engine is 0

### Requirement: Image and sticker caches with eviction
Decoded images SHALL be cached by `(assetId, maxLongSide)`: preview uses a long side of at most 2 048 px, export uses the full resolution capped at `maxTextureSize`. Vector stickers and SVG images MUST be rasterised at the displayed pixel size rounded up to the next power of two, between 128 and 2 048 px, and re-rasterised when the displayed size crosses a power-of-two boundary; animated stickers and animated images MUST be decoded per frame through `ImageDecoder` with their frame chosen by clip time modulo loop duration. The image and sticker caches MUST be least-recently-used within the image pool of "Memory ceilings per platform", and entries for a removed asset MUST be evicted immediately. A failed load MUST be retried at most 2 times with a 500 ms delay and then reported through `media.status` as `missing`. [PORT R-004]

#### Scenario: Preview downsizes a large photo
- **WHEN** a 6 000×4 000 photo is shown in preview
- **THEN** the cached bitmap is 2 048×1 365

#### Scenario: Sticker sharpness when scaled up
- **WHEN** a vector sticker displayed at 180 px is scaled to 700 px on canvas
- **THEN** it is re-rasterised at 1 024 px
- **AND** the rendered sticker has SSIM of at least 0.98 against a reference rasterised directly at 700 px

#### Scenario: Eviction
- **WHEN** the combined cache reaches 70 MiB on a mobile surface
- **THEN** least-recently-used entries are evicted until usage is at or below 64 MiB

#### Scenario: Load failure
- **WHEN** an image fails to load three times in a row
- **THEN** exactly 2 retries were made 500 ms apart and `media.status` reports the asset as `missing`

### Requirement: Text and graphic rasterisation
Text and caption nodes SHALL be laid out by "Engine-side text shaping and layout" and rasterised from its positioned glyph outlines (drawn as paths on an `OffscreenCanvas` in workers; no browser text call) into a texture sized to the text's bounding box plus effect padding (stroke width, shadow offset plus blur, glow radius), at the render resolution, and positioned by the layer transform; the texture is cached by a hash of all style parameters, resolved animated values, content, font identity and render scale. Graphics SHALL be rasterised into a square of `max(512, displayedLongSide rounded up to a power of two)` px capped at 2 048 px and cached by parameters, except a freehand drawing (`definitionId: "drawing"`, `project-document.Freehand drawing geometry`): it is rasterised from its `strokes[]` into a texture of its `intrinsicWidth × intrinsicHeight` multiplied by the displayed scale, capped at 4 096 px on the long side, with round caps and joins; `pen` strokes are drawn opaque in stroke order, each `marker` stroke is drawn opaque into its own group and composited at 50 % so that a stroke does not darken where it crosses itself, and `params.colorOverride`, when set, replaces every stroke colour. The rasterised text and graphic cache MUST be least-recently-used within the text pool of "Memory ceilings per platform". A font is "loaded" when the engine has fetched its bytes and parsed its tables (no `FontFace` registration is involved). A text node MUST NOT be rasterised before its font has loaded: in preview the engine waits up to 3 000 ms, then renders with the first family of the glyph fallback chain of `text-and-titles.Bundled fonts` and emits a diagnostic `font/fallback`, while loading continues for up to 15 000 ms in total and the text re-renders when the face arrives; in export it waits up to 15 000 ms and then fails with code `export/font-unavailable` unless the request sets `allowFontFallback: true`, in which case the fallback family is used and the font is reported in `export.done.fallbackFonts[]`. Text layout metrics returned by `layout.query` MUST equal the rasterised bounds within 1 px. Text parameters are defined by `text-and-titles.Text parameter table`. [PORT R-005, R-006] [NEW]

#### Scenario: Unchanged text is not re-rasterised
- **WHEN** a static text element is visible for 100 consecutive frames
- **THEN** it is rasterised once and uploaded once

#### Scenario: Font not yet loaded in preview
- **WHEN** a text element uses a font whose file takes 5 s to load
- **THEN** the text renders in the fallback family after 3 000 ms with a `font/fallback` diagnostic
- **AND** re-renders in the requested font once it loads

#### Scenario: Font missing at export
- **WHEN** an export starts and a used font cannot be loaded within 15 000 ms with `allowFontFallback` unset
- **THEN** the export fails with code `export/font-unavailable` naming the font family

#### Scenario: Export with font fallback allowed
- **WHEN** the same export runs with `allowFontFallback: true`
- **THEN** the text is rendered in the fallback family and `export.done.fallbackFonts` lists the missing family

#### Scenario: Drawing appears where it was drawn
- **WHEN** a drawing whose strokes span 900 × 400 element-local px is shown at scale 1 on a 1920 × 1080 canvas
- **THEN** it is rasterised into a 900 × 400 texture (not a square), and a marker stroke that crosses itself has uniform 50 % coverage at the crossing

### Requirement: Engine-side text shaping and layout
Text layout SHALL be computed by the engine itself from the bundled font files and SHALL NOT depend on the text machinery of the hosting browser engine: no `fillText`, `strokeText`, `measureText`, CSS layout or platform font fallback is used for timeline text, captions, text masks or emoji on any surface (web, desktop on macOS, Windows and Linux, the iOS and Android WebViews, the render host). (1) **Shaper.** The crate `packages/render-wasm` contains one shaper used by every surface: OpenType shaping compatible with HarfBuzz (ligatures, kerning, mark positioning, contextual forms, variable-font instancing), bidirectional reordering per UAX #9, line breaking per UAX #14 and grapheme clusters per UAX #29, reading only the font bytes of `text-and-titles.Bundled fonts` and of `fonts.setSources`. Fallback is resolved by the engine: for each cluster the first family of the element's chain (`fontFamily`, then the glyph fallback chain of `text-and-titles.Bundled fonts`, in that fixed order) whose `cmap` covers it. (2) **Output.** `layoutText(style, content, maxWidth)` returns `{lines[{runs[{fontId, direction, glyphs[{id, cluster, x, y, advance}]}], width, ascent, descent}], width, height}` with every coordinate in layout px quantised to 1/64 px; it is a pure function of its inputs, and for the same inputs the result is byte-identical on every platform. Line breaks, block width, alignment, justification, `letterSpacing` and `lineHeight` are all decided here. (3) **Rasterisation.** The engine extracts glyph outlines from the font tables (`glyf`, `CFF`, `CFF2`) in wasm and draws them as paths — fill, stroke, shadow and glow passes of `text-and-titles.Text parameter table` — through the Canvas2D PATH API (`Path2D` on an `OffscreenCanvas`), which is used only as a polygon rasteriser; differences between platforms are therefore limited to anti-aliasing and are covered by the text SSIM threshold of "Golden-frame determinism". Colour emoji come from the bundled COLR/CPAL (version 1) emoji font: the engine walks the colour paint graph and draws the layers as path fills with solid, linear, radial and sweep gradients; the platform emoji font is never used. (4) **Per-character features.** The unit of `letterSpacing`, of curved text placement (`curve`) and of `character`-unit text animations is the shaped grapheme cluster; inside a run of a cursive-joining script (Arabic, Syriac, N'Ko, Mongolian, Adlam and the others of Unicode `Joining_Type` D) the unit is the whole joined word, so joining and mark placement are never broken: such a word receives no internal letter spacing, sits on a curve as one rigid unit tangent at its centre, and animates as one unit. (5) **Queries.** `layout.query` returns bounds computed from this layout, and the canvas-side text editing overlay of `preview-canvas` places its caret from the same glyph positions. (6) **Gate.** A CI test renders the text golden cases (Latin, CJK, Arabic, Devanagari, Thai, emoji, mixed-direction, justified, letter-spaced, curved) on macOS, Windows, Linux, iOS, Android and the render host and requires the serialised layout (glyph ids, positions, line breaks) to be byte-identical on all six and the frames to have SSIM ≥ 0.98; spike S6 row 12 confirms that the colour-emoji path renders on both phone platforms; where it does not, the engine keeps the shaper's layout and draws each emoji cluster from the bundled 512 px bitmap of that emoji, scaled to the glyph's laid-out box (bitmap fallback of decision E5), on every surface including export. [NEW]

#### Scenario: Same line breaks on every platform
- **WHEN** a 300-character paragraph in "Arial" with `maxWidth` 800 px is laid out on macOS, Windows, Linux, iOS, Android and the render host
- **THEN** the six serialised layouts are byte-identical, so the line breaks and the block width are identical

#### Scenario: No browser text call
- **WHEN** the text golden cases are rendered with `CanvasRenderingContext2D.prototype.fillText`, `strokeText` and `measureText` replaced by functions that throw
- **THEN** every case still renders and passes

#### Scenario: Letter spacing in Arabic
- **WHEN** an Arabic sentence has `letterSpacing` 10
- **THEN** the extra space appears between words only and every word keeps its joined forms

#### Scenario: Character animation on a ligature
- **WHEN** a `character`-unit animation runs over the word "office" in a font with an "ffi" ligature
- **THEN** the ligature animates as one unit and no glyph is split

#### Scenario: Emoji does not use the platform font
- **WHEN** the text "Hi 👋" is rendered on iOS and on Android
- **THEN** the hand glyph on both is the bundled emoji design and the two frames have SSIM ≥ 0.98

#### Scenario: Fallback chosen by the engine
- **WHEN** a text in "Arial" contains a Thai word
- **THEN** the Thai clusters use the first bundled fallback family that covers them, the same family on every platform, even on a device whose system has its own Thai font

#### Scenario: Colour emoji bitmap fallback
- **WHEN** the S6 record says row 12 failed on Android and a text element contains "Hi 🎬" at 96 px
- **THEN** on Android the clapper is drawn from its bundled 512 px bitmap inside the glyph box the shaper computed, the line breaks equal those of every other platform, and the export shows the same result

### Requirement: Bundled fonts for layout parity
The engine SHALL lay out and rasterise text from bundled font files only, so that text layout is the same on every platform and on the render host. The font files, their licences and the mapping of the nine baseline font names (Arial, Helvetica, Times New Roman, Courier New, Verdana, Georgia, `sans-serif`, `serif`, `monospace`) to bundled open fonts are defined by `text-and-titles.Bundled fonts`; this requirement defines what the engine does with them on every surface variant (same-thread, mobile native view, render host): it loads the bytes of each needed bundled face from its own origin and hands them to the shaper of "Engine-side text shaping and layout" before the first text rasterisation; it never registers a face with the browser and never passes a family name to a browser text API, so that neither a font installed in the operating system nor the platform's generic-family mapping nor the platform's shaper is ever consulted for a baseline name or for the glyph fallback chain; and it treats any family that is neither bundled nor supplied through `fonts.setSources` as not loaded under the rules of "Text and graphic rasterisation". The font bytes used by a device and by the render host for the same project MUST be identical (same SHA-256 from the font manifest). The parity gate (byte-identical layout on macOS, Windows, Linux, iOS, Android and the render host, SSIM ≥ 0.98 for the frames) is the CI test of "Engine-side text shaping and layout"; there is no fallback strategy to decide if it fails, because the layout does not come from the platform. [NEW]

#### Scenario: Arial resolves to the bundled face everywhere
- **WHEN** a text element with family "Arial" is laid out on macOS, Windows, Linux, iOS, Android and the render host
- **THEN** the face used on every platform is the bundled face that `text-and-titles.Bundled fonts` maps Arial to
- **AND** the line breaks and the advance width of each line are equal across the six runs within 1 px at 1080-px canvas height

#### Scenario: Generic family
- **WHEN** a text element uses family `serif` on a device whose operating system maps `serif` to its own font
- **THEN** the bundled face mapped to `serif` is used and no operating-system font is queried

#### Scenario: Same font bytes on device and host
- **WHEN** the font manifest of a desktop client and of the render host of its paired host at the same product version are compared
- **THEN** every bundled font has the same SHA-256 on both

#### Scenario: Cross-platform text frame
- **WHEN** a golden case containing three lines of text in "Times New Roman" is rendered on a macOS device, on an iOS device, on an Android device and on the Linux render host
- **THEN** the serialised layouts are byte-identical and every pair of frames has SSIM of at least 0.98

### Requirement: Proxy playback switching
For each video asset `media.setSources` supplies an original and, when they exist, a proxy and a mezzanine in the formats defined by `media-library.Proxy media`. Preview SHALL decode the proxy when the proxy preference is on and a proxy exists, when the original is not present on the device, or when `constraints.proxyEditing` is `"required"`; otherwise it decodes the original. Stills, exports and `exact` renders requested with `source: "original"` MUST use the original — or the mezzanine when the runtime reports the original's codec as undecodable — and MUST fail with code `media/original-unavailable` when neither is present, never silently substituting the proxy. Variants are addressed by the same source time; the frame presented from a proxy or mezzanine for source time `t` MUST be the variant frame with the greatest presentation timestamp less than or equal to `t`. Switching variant during pause MUST re-render the current frame within 500 ms, and the scene MUST NOT shift in position or size by more than 1 px. `media.status` reports the variant in use per asset. [NEW]

#### Scenario: Proxy used on mobile without original
- **WHEN** a synced project is opened on a phone holding only the 720p proxy of a clip
- **THEN** preview plays from the proxy and `media.status` reports `using: "proxy"` for that asset

#### Scenario: Export refuses a silent proxy substitution
- **WHEN** an on-device export is rendered while the original and mezzanine of one clip are absent
- **THEN** the render fails with code `media/original-unavailable` naming the asset

#### Scenario: Frame correspondence for a decimated proxy
- **WHEN** a 120 fps original has a 60 fps proxy and source time `t` falls on the original's frame 7 (an odd frame)
- **THEN** the proxy frame presented is the one whose timestamp equals the original's frame 6

#### Scenario: Mezzanine for an undecodable original
- **WHEN** the render host cannot decode an HEVC original and a mezzanine exists
- **THEN** the export renders from the mezzanine and `media.status` reports `using: "mezzanine"`

#### Scenario: Variant switch keeps framing
- **WHEN** the proxy preference is toggled while paused on a frame
- **THEN** the frame re-renders within 500 ms with the clip at the same canvas position and size

### Requirement: Missing or undecodable media
When an asset's file is missing, its codec is not decodable on the device, or decoding fails, the engine SHALL report it through `media.status` (`missing` or `unsupported`) and a `diagnostic` naming the asset and elements. In preview the affected node MUST render a neutral tile filling the element's rectangle (fill and 2 px diagonal hatch in the colours of the `design-system` tokens `preview/offline-fill` and `preview/offline-hatch`, passed to the engine in `engine.init`; centred localised label "Media offline" or "Unsupported format") so the layout stays visible. In export and still renders with `source: "original"` the render MUST fail with code `media/unavailable` unless the request sets `allowMissingMedia: true`, in which case the node renders fully transparent. A decode error on a single frame MUST be retried once after a keyframe seek before the asset is marked failed. [NEW] [PORT R-003]

#### Scenario: Offline tile in preview
- **WHEN** a clip's media file has been deleted from disk and the playhead is over the clip
- **THEN** the preview shows the hatch tile with the label "Media offline" at the clip's rectangle

#### Scenario: Export with missing media allowed
- **WHEN** an export with `allowMissingMedia: true` renders a frame containing a missing clip
- **THEN** that clip contributes no pixels and the export continues

### Requirement: Preview render loop
While the surface is visible the engine SHALL run a frame loop driven by `requestAnimationFrame` that renders only when the frame index derived from the transport clock, the scene revision, the override map, the view size or the quality level has changed since the last rendered frame, and MUST skip a tick while a render is in flight. When a render completes after the playhead has advanced by more than one frame, the engine renders the newest frame and counts the skipped frames as dropped. When `view.setVisible(false)` is received or the page is hidden the loop MUST stop rendering while audio continues. A paused, unchanged scene MUST cause zero GPU draws. [PORT R-001, V-001, V-002]

#### Scenario: Idle when nothing changes
- **WHEN** the editor is paused for 5 s with no input
- **THEN** the `renderFrame` counter increases by 0

#### Scenario: Dropped frames are counted
- **WHEN** a frame takes 80 ms to render during 30 fps playback
- **THEN** the next rendered frame is the one for the current clock time
- **AND** the dropped-frame counter increases by 1 or 2

### Requirement: Preview resolution scaling
This requirement is the single definition of the preview quality levels and of the automatic downgrade rule; no other capability defines a trigger. The preview render size SHALL be `min(projectCanvas, viewportCssSize × devicePixelRatio × previewZoom)` rounded to even integers, multiplied by the quality factor: `full` = 1, `half` = 0.5, `quarter` = 0.25. In `auto` (the default on every platform) the engine starts at `full`, lowers one level when the mean render time of the last 30 played frames exceeds 1.25× the frame duration, and raises one level when it stays below 0.6× the frame duration for 120 consecutive played frames. Whenever playback is paused the engine MUST re-render the current frame at `full` within 150 ms of the pause or of the last seek. Each level change is reported in `perf.sample` and in `transport.state` as `effectiveQuality`, which drives the single "Reduced preview quality" chip of `preview-canvas.Preview quality` (shown whenever `auto` is below `full`). Scaling MUST NOT change layout: every element occupies the same normalised rectangle at every quality level within 1 px at the render resolution. Maximum preview render size is 3 840×2 160 on desktop and web and 1 920×1 080 on mobile. [NEW]

#### Scenario: Auto lowers quality under load
- **WHEN** 30 consecutive played frames of a 30 fps project average 45 ms render time at `full`
- **THEN** the quality level switches to `half`
- **AND** `transport.state` reports `effectiveQuality: "half"`

#### Scenario: Auto raises quality again
- **WHEN** 120 consecutive played frames at `half` each render in under 20 ms in a 30 fps project
- **THEN** the quality level switches to `full`

#### Scenario: Full quality when paused
- **WHEN** playback pauses while the level is `quarter`
- **THEN** the paused frame is re-rendered at `full` within 150 ms

#### Scenario: Small viewport
- **WHEN** a 3840×2160 project is previewed in a 640×360 CSS px viewport at device pixel ratio 2 and zoom 100 %
- **THEN** the render size is 1280×720

### Requirement: Still frame and thumbnail rendering
`still.render` SHALL render the committed scene at a given frame-aligned time and size (default project canvas size, any size from 16×16 to 4 096×4 096) with `source: "original" | "preview"`, and return PNG or JPEG bytes (JPEG quality 1–100, default 90) through `still.done`. The time MUST be clamped to `min(time, lastFrameTime)`. `thumbnails.request` SHALL decode source frames of an asset at a list of source times at a long side of 64–320 px, at lower priority than preview rendering (thumbnail work yields whenever a preview frame is pending), delivering each through `thumbnails.ready`; `thumbnails.cancel` MUST stop outstanding work for the given request id within 100 ms. A still of an empty scene MUST return the background only. PNG stills carry straight alpha, so a `transparent` background yields transparent pixels. [PORT R-001] [NEW]

#### Scenario: Still at end of timeline
- **WHEN** `still.render` is requested at a time equal to the scene duration
- **THEN** the returned image is the last frame of the scene

#### Scenario: Thumbnails yield to preview
- **WHEN** 200 thumbnails are requested while the B1 benchmark scene is playing
- **THEN** dropped frames during those 60 s stay at or below 2 % on the reference desktop and 5 % on the reference mobile devices
- **AND** thumbnails arrive progressively

#### Scenario: Cancelled thumbnails
- **WHEN** `thumbnails.cancel` is sent for a request with 150 thumbnails outstanding
- **THEN** no `thumbnails.ready` for that request is emitted after 100 ms

#### Scenario: Size out of range
- **WHEN** `still.render` is requested at 8 192×8 192
- **THEN** the engine replies `ok: false` with `surface/invalid-payload`

### Requirement: Audio clock as playback master
During playback the transport position SHALL be derived from the `AudioContext` clock: `position = startPosition + (audioContext.currentTime − startContextTime − outputLatency) × rate`. The visual playhead, the frame chosen for rendering and `transport.time` MUST all come from this single clock; `performance.now()` MUST NOT drive the playhead while an audio clock is running. The frame chosen for rendering is always `min(floorToFrame(position), lastFrameTime)`. When no audio output is available or the `AudioContext` cannot be resumed (autoplay policy before a user gesture, no output device), the engine MUST fall back to a monotonic clock, set `audioClock: false` in `transport.time`, and switch to the audio clock at the next play. When playback reaches the scene end with loop off, the transport pauses, the transport position is set to exactly the scene duration, `transport.time` reports that position and `transport.ended` is emitted; the rendered frame is the one at `lastFrameTime`. Play from a position at or past the scene duration restarts at 0 (or at the loop in-point when loop is on). The offset between audio and picture MUST be at most the larger of one frame duration and 40 ms. Master volume is clamped to 0..1 and mute restores the previous volume on unmute. [PORT PB-007, PB-008] [NEW]

#### Scenario: Audio and picture stay in sync
- **WHEN** a clip with a clap marker plays for 10 minutes without seeking on the reference desktop in a 30 fps project
- **THEN** the offset between the audible clap and the rendered clap frame is 40 ms or less at every measured point

#### Scenario: No audio device
- **WHEN** playback starts on a machine with no audio output device
- **THEN** the playhead advances in real time from the monotonic clock and `transport.time` carries `audioClock: false`

#### Scenario: End of timeline
- **WHEN** playback reaches the end of a 600 000-tick scene at 30 fps with loop off
- **THEN** playback pauses, the reported transport position is exactly 600 000 ticks and `transport.ended` is emitted
- **AND** the frame on screen is the one for 596 000 ticks, and the next play starts from 0

### Requirement: Audio scheduler lookahead
This requirement is the single definition of live audio scheduling timing. The live audio scheduler SHALL run every 200 ms and schedule every unmuted audio-bearing clip (audio elements, video source audio not separated, compound audio) that intersects the window `[position, position + 2.0 s)`, starting each clip at most once per playback session and within ±5 ms of its timeline start. Streaming clips are decoded through mediabunny `AudioBufferSink` and scheduled as one `AudioBufferSourceNode` per decoded chunk with back-pressure (decoding pauses, polling every 100 ms, while more than 1.0 s is scheduled ahead). Clips with keyframed volume, fades, pitch-preserved retime, speed curves, reverse or any processing stage of `audio-editing.Audio signal chain` other than gain and pan use a prepared buffer rendered ahead of time and cached by a key of asset id, trim, retime, processing parameters and gain envelope, with gain automation sampled every 1/60 s. All clip times, including library sound clips, MUST be converted from ticks to seconds at the scheduling boundary. Any change to play state, seek, timeline or media MUST stop and reschedule only the affected clips within 100 ms. Which clips are audible and their gains are defined by `audio-editing.Audio signal chain`; this requirement defines when they are scheduled. [PORT PB-009, AU-004] [NEW]

#### Scenario: Clip entering the window
- **WHEN** an audio clip starts 1.5 s after the playhead during playback
- **THEN** it is scheduled within the next scheduler tick and starts within ±5 ms of its timeline start time

#### Scenario: Library sound timing
- **WHEN** a library sound element with start time 240 000 ticks plays
- **THEN** it becomes audible at 2.000 s ±5 ms of timeline time

#### Scenario: Edit during playback
- **WHEN** a clip's volume is changed while it is playing
- **THEN** the new gain is audible within 100 ms and other clips play uninterrupted

#### Scenario: Back-pressure on a long clip
- **WHEN** a 30-minute audio clip starts playing
- **THEN** no more than 1.2 s of its audio is scheduled ahead of the playhead at any time

### Requirement: Audio drift and underrun handling
When a decoded chunk arrives after its scheduled start the scheduler SHALL start it immediately with an offset equal to the lateness; a chunk that is entirely in the past MUST be dropped. After 5 consecutive dropped chunks on a clip the scheduler MUST set a latency compensation of `min(0.25 s, lateness + 0.01 s)` and restart that clip's decode iterator from the current position. Because picture follows the audio clock, a stalled audio clock (context suspended or interrupted) MUST pause the transport and emit `transport.state` with `playing: false` and `reason: "audio-interrupted"`; the engine resumes only on an explicit play. Video rendering that falls behind MUST drop frames and never slow the audio. [PORT PB-010] [NEW]

#### Scenario: Late chunk
- **WHEN** a chunk arrives 30 ms after its scheduled start
- **THEN** it starts immediately at an offset of 30 ms into the chunk

#### Scenario: Repeated underrun
- **WHEN** 5 consecutive chunks of a clip are dropped as fully late
- **THEN** latency compensation of at most 0.25 s is applied and decoding restarts at the current position

#### Scenario: Audio interruption on mobile
- **WHEN** an incoming phone call suspends the audio context during playback
- **THEN** the transport pauses and reports reason `audio-interrupted`

### Requirement: Playback rate, loop and reverse shuttle
The transport SHALL support forward rates 0.25, 0.5, 1, 1.5, 2, 4 and 8 and reverse rates 1, 2, 4 and 8. Audio plays pitch-preserved at forward rates from 0.5 to 2 and is muted at every other rate and in reverse. With loop enabled the transport wraps from the loop out-point (default scene end) to the loop in-point (default 0) with a gap of at most one frame duration, rescheduling audio across the wrap. At rates where the picture cannot be rendered every frame the engine renders the newest frame per display refresh. The key handling of J/K/L and the persistence of the loop switch are defined by `preview-canvas.Playback rate and JKL shuttle` and `preview-canvas.Loop playback`; this requirement defines only what the transport does when commanded. [NEW] [PORT N-007]

#### Scenario: Double speed with audio
- **WHEN** playback runs at rate 2
- **THEN** the playhead advances 2 s of timeline per second of wall time and audio is audible at unchanged pitch

#### Scenario: Reverse shuttle
- **WHEN** playback runs at reverse rate 2
- **THEN** the playhead moves backwards at 2× and no audio is audible

#### Scenario: Loop a range
- **WHEN** loop is enabled with in-point 2 s and out-point 5 s and playback reaches 5 s on a continuous 1 kHz tone
- **THEN** playback continues from 2 s and the silent gap measured in the output is at most one frame duration

#### Scenario: Unsupported rate
- **WHEN** `transport.setRate` is sent with rate 3
- **THEN** the engine replies `ok: false` with `surface/invalid-payload` and the rate is unchanged

### Requirement: Scrub audio
This requirement is the single definition of scrub audio. When scrub audio is enabled (default on for desktop and web, off for mobile; persisted as a user preference) and the playhead is moved by `transport.seek` in `scrub` mode, the engine SHALL play a snippet of the mixed timeline audio at the new position: 80 ms long with 5 ms fade-in and fade-out, at most one snippet every 50 ms, at master volume. No snippet plays for `exact` seeks, keyboard frame steps excepted (a frame step plays one snippet of one frame duration). When scrub audio is disabled, scrubbing is silent. Scrub snippets MUST NOT start the transport. [NEW]

#### Scenario: Scrubbing over speech
- **WHEN** the user drags the playhead across a voice clip for 1 s
- **THEN** between 10 and 20 snippets are played
- **AND** `transport.state.playing` stays `false`

#### Scenario: Scrub audio disabled
- **WHEN** scrub audio is off and the user drags the playhead
- **THEN** no audio is output

#### Scenario: Frame step
- **WHEN** scrub audio is on and the user steps one frame forward in a 30 fps project
- **THEN** exactly one snippet of 33 ms ± 2 ms is played

### Requirement: Audio mixdown for export
The engine SHALL implement the offline mixdown as the execution of `audio-editing.Audio signal chain` and `audio-editing.Mixdown for export` (which define the sources collected, the stage order, gains and processing parameters) under these engine rules: the timeline or export range is rendered in blocks of at most 10 s so that memory use is independent of duration; the output sample rate and channel count are those of the export request (`export-share.Audio settings for video export`: 44 100 or 48 000 Hz, default 48 000; 2 or 1 channels) and there is no project-level sample rate; each source is resampled with a band-limited resampler and mapped through the same `sourceTimeAt` function as the picture; gain envelopes (clip volume in dB as `10^(dB/20)`, keyframes, fades) are evaluated per sample; processing state (resampler, time-stretch, equaliser, compressor, limiter) carries across block boundaries. The mixdown of a given snapshot MUST be sample-identical across runs on the same device and runtime, and its peak timing MUST match live playback within 5 ms. An empty timeline yields silence of the range duration. The mixdown reports progress per block and stops within 500 ms of `export.cancel`. [PORT AU-006] [NEW]

#### Scenario: One-hour mixdown memory
- **WHEN** a 60-minute timeline is mixed down
- **THEN** peak additional memory attributable to the mixdown stays below 128 MiB

#### Scenario: Muted track
- **WHEN** an audio track is muted
- **THEN** its clips contribute zero samples to the mixdown

#### Scenario: Gain keyframes
- **WHEN** a clip's volume is keyframed from −60 dB to 0 dB linearly over 2 s
- **THEN** the mixdown sample gain at 1 s equals `10^(−30/20)` within 1 %

#### Scenario: Deterministic repeat
- **WHEN** the same snapshot is mixed down twice at 48 000 Hz stereo on the same device
- **THEN** the two sample buffers are identical

#### Scenario: Block boundary is inaudible
- **WHEN** a continuous 440 Hz sine clip spans a 10 s block boundary
- **THEN** the output has no sample-to-sample step at the boundary larger than the step between any two adjacent samples elsewhere in the tone

### Requirement: Mastering limiter
The limiter's signal processing (which replaces classic AU-007: a true-peak limiter with ceiling 0.98, unity gain below the ceiling, a 48-sample look-ahead and a safety clamp at ±0.98; no fixed 0.98 gain) is defined only by `audio-editing.Mastering limiter`; the engine MUST NOT define competing constants. This requirement defines where the limiter runs: the engine SHALL run it as stage 17 of `audio-editing.Audio signal chain`, the final stage on the master bus, in the live output graph and in every block of the export mixdown alike, at the 48 000 Hz internal rate and before the single conversion to the export sample rate. The limiter is always in the path: neither the classic constant 0.98 gain nor the classic rule that skipped the limiter when the whole-mix peak was at or below 0.98 is ported, so the engine tracks no whole-mix peak, runs no second pass and writes no temporary whole-mix file, and live playback and export of the same snapshot have the same level. The limiter's 48-sample look-ahead delay is compensated in both paths so that audio stays aligned with picture: the export mixdown discards the first 48 output samples and flushes 48 samples after the last block, and the live graph adds 48 samples to the output latency used for audio–video synchronisation. Limiter state (oversampling filter history, look-ahead buffer, envelope detector and gain) MUST carry across mixdown block boundaries and MUST be reset at the start of every export and on every live seek or transport start. In the live graph the limiter runs in an `AudioWorklet` so that the same code produces the live and the offline result. The engine creates its `AudioContext` with `sampleRate: 48000` so that the live limiter runs at the internal rate; when the platform refuses that rate (the context reports another `sampleRate`), the live limiter runs at the context rate with its look-ahead scaled to 1 ms of samples at that rate, the mix is resampled once at the output, and the tolerance of the scenario "Quiet mix has the same level live and in export" becomes 0.1 dB for that device. [PORT AU-007] [NEW]

#### Scenario: Quiet mix has the same level live and in export
- **WHEN** a mix peaking at 0.5 is played live and exported
- **THEN** both outputs equal the mix at unity gain, sample for sample after delay compensation, and their levels differ by 0.0 dB within measurement accuracy of 0.01 dB

#### Scenario: Hot mix is limited
- **WHEN** two full-scale sine clips overlap in an export
- **THEN** no output sample exceeds ±0.98 and the true peak measured at 4× oversampling is at most 0.98 plus 0.1 dB
- **AND** there is no discontinuity at 10 s block boundaries

#### Scenario: Single pass
- **WHEN** a 60-minute export is mixed down
- **THEN** each block passes through the limiter once and no whole-mix temporary audio file is created by the limiter

### Requirement: Mobile audio session
On iOS and Android the native view module SHALL configure the audio session before the engine starts playback so that timeline audio is audible with the hardware mute switch on (playback category), routes to connected headphones or Bluetooth output, and pauses the transport on interruption (call, alarm, another app taking audio focus). The native module does this with the playback audio-session category on iOS and with an audio-focus request for media playback on Android; on iOS the engine page MUST additionally set `navigator.audioSession.type = "playback"` before creating its `AudioContext`, and on Android, where the WebView has no such property, the native audio-focus request alone is sufficient. The user's play tap happens in React Native and never reaches the WebView document, so the engine MUST NOT depend on user activation: the native module configures the WebView for playback without a user gesture (iOS `mediaTypesRequiringUserActionForPlayback = []` and `allowsInlineMediaPlayback = true`; Android `setMediaPlaybackRequiresUserGesture(false)`; "Mobile WebView surface bridge"), the engine resumes its `AudioContext` when it receives the first `transport.play` command, and, when resume fails, MUST emit `transport.state` with `audioOutput: false`. Spike S6 row 11 covers both platforms: audio starts from a `transport.play` sent over the bridge with no touch inside the WebView, is audible with the iOS mute switch on, and holds Android audio focus; a failure is blocking for release on the failing platform. Acceptance is on physical reference devices, not simulators. The app-level behaviour on interruptions is defined by `mobile-editor.Interruptions and audio session`. [NEW]

#### Scenario: Silent switch on iOS
- **WHEN** the hardware mute switch is on and the user presses play on a physical reference iPhone
- **THEN** timeline audio is audible

#### Scenario: Audio focus on Android
- **WHEN** another app takes audio focus during playback on a physical reference Android phone
- **THEN** the transport pauses and reports reason `audio-interrupted`

#### Scenario: Headphones unplugged
- **WHEN** headphones are disconnected during playback
- **THEN** playback pauses and does not continue on the loudspeaker without a new play gesture

#### Scenario: Audio context cannot resume
- **WHEN** the `AudioContext` fails to resume on the first `transport.play` command
- **THEN** `transport.state` carries `audioOutput: false`, and playback proceeds on the monotonic clock with `audioClock: false`

#### Scenario: Audio starts without a touch inside the WebView
- **WHEN** the user taps Play in the React Native toolbar on an iOS and on an Android reference device right after the editor opened
- **THEN** `transport.state` reports `audioOutput: true` and audio is heard, although no pointer event was ever delivered to the WebView document

### Requirement: Export render session
`export.start` SHALL create a render session isolated from the preview: it takes an immutable scene snapshot, uses its own compositor instance, caches and decoder sessions, and MUST NOT share GPU textures or render targets with the preview compositor. On web and desktop the session runs in a worker with an `OffscreenCanvas`; on mobile, where memory does not allow two compositors, the preview is suspended for the duration of an on-device export and resumed afterwards; on the render host the session is the whole process. The session renders frame `i` at time `rangeStart + frameTime(i)` for `i` in `0 … frameCount − 1` with `frameCount = floor(rangeDuration / frameDuration)` computed per index (no accumulated rounding), always with `exact` decoding, original (or mezzanine) media, `full` quality at the requested output size, and committed state only. It reports `export.progress` at least twice per second with `{stage, framesDone, frameCount}`, honours `export.pause` (stop after the current frame, release no resources) and `export.resume` on same-thread and mobile surfaces, and honours `export.cancel` (stop within 500 ms) on every surface. A request the device cannot satisfy is refused at start: `engine/no-gpu` without a backend, `engine/encoder-unavailable` when `constraints` rule out the requested video or audio codec. Encoded output leaves the session as a stream (File System Access or origin-private file on web, the desktop bridge on desktop, "Mobile export path" on mobile — muxed inside the engine storage with positioned writes, then copied out through the sink — the frame pipe on the render host) and is never held whole in memory. Settings, encoding, muxing, the pause-in-background rule on mobile and delivery are defined by `export-share`. [NEW] [PORT R-001]

#### Scenario: Editing during export does not change the output
- **WHEN** an export of a snapshot is running on desktop and the user deletes a clip in the editor
- **THEN** the exported file still contains the deleted clip as it was in the snapshot

#### Scenario: Frame count for a 10 s range at 29.97 fps
- **WHEN** a 1 200 000-tick range is exported at 30000/1001
- **THEN** exactly 299 frames are rendered, at times `i × 4004` ticks

#### Scenario: Cancel
- **WHEN** `export.cancel` is received mid-render
- **THEN** rendering stops within 500 ms and all session GPU resources are released

#### Scenario: Pause is refused on the render host
- **WHEN** `export.pause` is sent to a render host session
- **THEN** the reply is `ok: false` with `surface/unsupported-on-host`

### Requirement: Render host
The engine SHALL provide a third surface variant, the render host, which is the only way anything is rendered on a host (remote export, frame renders for agents, unattended automation and workflow exports, thumbnails and proxies that need effects): FFmpeg alone never produces picture. The render host is the JAgentChill Electron binary started with `--render-host` (no window), spawned and supervised by JAgentChill Server as its own child process (`server-api.Render host supervision and health`; it is a sibling of the OpenClaw Gateway child, is not started by the Gateway, and does not need the Gateway to be running), resolved in this order: `renderHost.path` → the desktop app's own executable when the server was started by the desktop app → the binary bundled in the headless and Docker distribution (`deploy/jagentchill/`); when none resolves, the render host is unavailable. It loads the same engine bundle as web and desktop, runs with GPU acceleration when the host has it and with software rasterisation otherwise (reported as `{backend, software}` per "GPU backend selection and WebGL2 fallback"), keeps the Chromium sandbox enabled, blocks every network request, and reads media only through a host-local range-capable scheme limited to the blobs of the job's project. One render-host process runs per running export, counted against `queue.ffmpegWorkers` of `server-api.Job concurrency limits`; `render.frame` jobs share one on-demand process that exits after 60 s idle. The render host also serves jobs of kind `workflow.record` (`workflow-diagram.Motion export to WebM`, started by `jagentchill.workflow.archify.record`): for such a job the same executable loads the canvas page built from `packages/archify` instead of the engine bundle, under the same sandbox, network block and supervision, records the WebM file into the job's private directory, and shares the on-demand process slot of `render.frame` jobs; no other page is ever loaded. A render-host exit during a job fails that attempt with `RENDERER_UNAVAILABLE` (retryable) and deletes the partial output; a render stream cannot be resumed mid-file, so the job is re-queued from frame 0 while attempts remain. Retry, re-queue, the 1 s / 5 s / 30 s cadence (which is the cadence of failed PROBES, not of restarts inside a job) and the unhealthy state are owned by `server-api.Render host supervision and health`; this requirement defines no restart rule of its own. Health is established by a probe (spawn, then the `hello` message of "Render host protocol" within 10 000 ms, then exit), run at service start and every 300 s while idle; the supervision, the health reason and the retry cadence of failed probes are owned by `server-api.Render host supervision and health`, and a render host that stops replying for 30 000 ms during a job fails that attempt with `RENDERER_UNAVAILABLE`. The server advertises feature flag `remote-render` only while the probe passes, and `remote-export` whenever `remote-render` holds: the host always has a royalty-free software encode path (VP9 and AV1 with Opus through the bundled FFmpeg), so the flag never depends on H.264; which codecs are available (H.264 when a hardware encoder exists or OpenH264 was installed during host setup; HEVC hardware only) is the per-codec table of `export-share.Encoder availability and licensing`, and a job whose requested codec is unavailable fails fast with `export/codec-unavailable` listing the alternatives (`updates-distribution.Feature flags and additive wire evolution`). Without a healthy render host every dependent tool and RPC fails with `RENDERER_UNAVAILABLE`, and a workflow, film or automation export step ends `skipped` with reason `no_renderer`, leaving the project openable. Paired clients are never used as renderers for host jobs. `jc_frame_render` resolves a renderer in the order: the engine surface of the client focused on the session → the render host → `RENDERER_UNAVAILABLE`. When the render host cannot decode an original it requests the `mezzanine` variant through a `media.transcode` job and renders from it. Gating spike, recorded in `docs/decisions/` before any host render task: a 1080p30 software-rasterised export of benchmark scene B1 in the container at 0.25× real time or faster, with the golden suite passing on that runtime. [NEW]

#### Scenario: Remote export uses the render host
- **WHEN** an `export.remote` job starts on a host with a healthy render host
- **THEN** exactly one `--render-host` process is spawned for the job and frames reach FFmpeg from that process
- **AND** no paired client receives a render request

#### Scenario: Resolution order
- **WHEN** `renderHost.path` is unset and the server was started by the desktop app
- **THEN** the server spawns the desktop app's own executable with `--render-host`

#### Scenario: Render host missing on a headless host
- **WHEN** no render-host binary resolves on a host that runs JAgentChill Server from its package alone, without the desktop app and without the headless distribution's bundled binary
- **THEN** the handshake `features` omit `remote-render` and `remote-export`
- **AND** `jc_frame_render` with no focused client fails with `RENDERER_UNAVAILABLE`

#### Scenario: Workflow export step without a renderer
- **WHEN** a workflow run reaches its export node on a host without a healthy render host
- **THEN** the step ends `skipped` with reason `no_renderer` and the assembled project opens in the editor

#### Scenario: Render host does not depend on the Gateway
- **WHEN** the supervised OpenClaw Gateway is in a crash loop and a paired device starts an `export.remote` job
- **THEN** the handshake `features` still contain `remote-render` and `remote-export`, and the job renders and completes

#### Scenario: Network is blocked
- **WHEN** the engine bundle inside the render host attempts to fetch `https://example.com`
- **THEN** the request is cancelled and a diagnostic `surface/navigation-blocked` is logged

#### Scenario: Software rasterisation
- **WHEN** the render host starts on a host with no GPU
- **THEN** `engine.ready` reports `surface: "render-host"` with a backend other than `none`, and the golden suite passes on that runtime

#### Scenario: Render host exits during a job
- **WHEN** the render-host process of a running export exits unexpectedly at 40 %
- **THEN** that attempt fails with `RENDERER_UNAVAILABLE`, the partial output file is deleted, and the job is re-queued from frame 0 while attempts remain, as `server-api.Render host supervision and health` defines

#### Scenario: Host without any H.264 encoder can still export
- **WHEN** a headless host with no hardware encoder and no OpenH264 has a healthy render host
- **THEN** `remote-export` is advertised, a VP9 + Opus WebM export completes, and an H.264 request fails at once with `export/codec-unavailable` listing VP9 and AV1

### Requirement: Render host protocol
The server and the render host SHALL communicate over stdio pipes only: file descriptor 3 carries `EngineSurface` envelopes in both directions, each framed as a 4-byte big-endian length followed by UTF-8 JSON of at most 1 048 576 bytes; file descriptor 4 carries binary records from the render host to the server, each a 16-byte header (magic `JCF1`, record kind `u8` — 1 video frame, 2 still, 3 thumbnail — three reserved bytes, sequence number `u32`, payload length `u32`, all big-endian) followed by the payload. Video frames are raw 8-bit RGBA with straight alpha at the export size, top row first; the server forwards the payloads unmodified to the FFmpeg process's standard input. The mixed audio is written by the render host as headerless raw 32-bit float little-endian interleaved PCM (`f32le`) into the job directory named in `export.start` and read by FFmpeg as a second input with the sample rate and channel count given on its command line; no RIFF/WAV container is used, so a mix of any length up to the 24 h scene limit is representable (a float stereo WAV would exceed the 4 GiB RIFF limit after 3 h 06 min). Immediately after start, before any command is read, the render host MUST write one envelope `{v: 1, id, type: "hello", payload: {engineVersion, protocolVersion, backend}}` on file descriptor 3, extended by `software: boolean`: `backend` is the API name `webgpu` or `webgl2`, and `software` is true when that API runs on Chromium's software rasteriser ("GPU backend selection and WebGL2 fallback"); a process that can obtain no rendering backend writes no `hello` and exits with status 3. `engine.ready`, sent in reply to `engine.init`, reports the same `backend` and `software` and `surface: "render-host"`. The render host MUST block on a full pipe and MUST NOT buffer more than 4 unwritten frames. The render host accepts only `engine.init`, `engine.dispose`, `scene.set`, `media.setSources`, `derived.setSources`, `fonts.setSources`, `still.render`, `thumbnails.request`, `thumbnails.cancel`, `export.start`, `export.cancel`, `perf.setEnabled` and `memory.trim`; any other command replies `surface/unsupported-on-host`. The process exits with status 0 after `engine.dispose` and within 2 000 ms of its command pipe closing. [NEW]

#### Scenario: Frame record
- **WHEN** a 1920×1080 export frame is written to file descriptor 4
- **THEN** the record is a 16-byte header with magic `JCF1`, kind 1 and payload length 8 294 400, followed by exactly that many bytes

#### Scenario: Hello on start
- **WHEN** the server spawns the render host on a host with no GPU
- **THEN** one `hello` envelope arrives on file descriptor 3 within 10 000 ms carrying `engineVersion`, `protocolVersion`, `backend: "webgl2"` and `software: true`

#### Scenario: No backend at all
- **WHEN** the render host starts in an environment where neither WebGPU nor WebGL2 can be created, even in software
- **THEN** no `hello` is written and the process exits with status 3

#### Scenario: Back-pressure from the encoder
- **WHEN** FFmpeg stops reading its standard input for 5 s
- **THEN** the render host holds at most 4 rendered frames in memory and resumes when the pipe drains

#### Scenario: Transport command on the host
- **WHEN** `transport.play` is sent to a render host
- **THEN** the reply is `ok: false` with `surface/unsupported-on-host`

#### Scenario: Orphan protection
- **WHEN** the server process dies and the command pipe closes
- **THEN** the render-host process exits within 2 000 ms

#### Scenario: Six-hour mix
- **WHEN** a 6 h stereo 48 kHz export mixes its audio on the render host
- **THEN** the audio file is 8 294 400 000 bytes of raw `f32le` and FFmpeg reads it to the end

### Requirement: Performance budgets
On the reference devices owned by `diagnostics-quality.Performance budgets` (recorded in `docs/product/PERF-BASELINE.md`; this spec names none) the engine SHALL meet these engine budgets with the benchmark scene "B1" defined in `specs/render-engine/catalog.md` (1080p30 project; three overlapping 1080p H.264 video layers, one with a blur effect and a feathered mask, one adjustment layer with a LUT, two text elements, one audio track): preview playback 95th-percentile frame render time of 33.3 ms or less at `auto` quality with at most 2 % dropped frames over 60 s on the reference desktop, and at most 5 % on the reference mobile devices using proxies; single 1080p H.264 layer playback at `full` with 95th-percentile render time of 16.6 ms or less on desktop; paused `exact` seek latency (command to `frame.ready`) 95th percentile of 250 ms within 2 s of the previous position and 500 ms for a random seek on desktop, 400 ms and 800 ms on mobile, for sources with keyframe intervals of 2 s or less; `scrub` seek first visible frame at the 95th percentile within 100 ms on desktop and 150 ms on mobile; scene patch to frame within 50 ms on desktop and 100 ms on mobile; on-device 1080p30 H.264 export of scene B1 at 1.0× real time or faster on desktop and 0.5× or faster on mobile. A benchmark harness MUST measure every budget, and it fails when any budget is exceeded; the regression-against-baseline rule and the CI schedule are defined by `diagnostics-quality.Performance budgets`. Product-level budgets (cold start, project open, timeline interaction, whole-app memory) are defined only there. [NEW]

#### Scenario: Preview frame budget on desktop
- **WHEN** the B1 scene plays for 60 s on the reference desktop
- **THEN** the 95th-percentile render time is 33.3 ms or less and dropped frames are at most 2 %

#### Scenario: Random seek latency on mobile
- **WHEN** 50 random `exact` seeks are issued on a reference mobile device
- **THEN** the 95th-percentile latency from command to `frame.ready` is 800 ms or less

#### Scenario: Scrub first frame
- **WHEN** 100 `scrub` seeks to random positions are issued on the reference desktop
- **THEN** the 95th-percentile time to the first visible frame is 100 ms or less

#### Scenario: Budget regression fails the harness
- **WHEN** a change raises the desktop 95th-percentile B1 render time to 40 ms
- **THEN** the benchmark harness exits non-zero naming the exceeded budget

### Requirement: Memory ceilings per platform
This requirement is the single definition of engine memory numbers. Total engine memory (JavaScript heap attributable to the engine, wasm linear memory, decoded frame cache, image, text and graphic caches, GPU textures and render targets) SHALL stay at or below 2 048 MiB on desktop and on the render host, 1 536 MiB on web and 600 MiB on mobile for any project. Pool budgets in MiB (video frames / GPU textures / images and stickers / text and graphics): desktop and render host 512 / 768 / 256 / 128; web 384 / 512 / 192 / 128; mobile 128 / 192 / 64 / 32, each multiplied by `constraints.cachePoolScale`. The engine MUST track each pool's bytes, expose them through `perf.sample`, and on reaching 90 % of the ceiling MUST emit `memory.pressure`, halve the video, image and text cache budgets, clear the render-target pool, lower the preview quality one level and close idle decoder sessions. On `memory.trim` (sent by the app when the OS reports low memory or the app is backgrounded) the engine MUST release all caches not needed for the current frame within 500 ms. Whole-app memory budgets are defined by `diagnostics-quality.Performance budgets`. [NEW]

#### Scenario: Ceiling on mobile
- **WHEN** a project with 40 clips of mixed 4K and 1080p media is scrubbed end to end on a reference mobile device
- **THEN** reported engine memory never exceeds 600 MiB
- **AND** the WebView content process is not terminated for memory

#### Scenario: Pools fit under the ceiling
- **WHEN** every mobile pool is filled to its budget
- **THEN** the pools total 416 MiB and reported engine memory stays at or below 600 MiB

#### Scenario: Pressure response
- **WHEN** reported engine memory reaches 1 844 MiB on desktop
- **THEN** `memory.pressure` is emitted, the video, image and text budgets are halved and the preview quality drops one level

#### Scenario: Trim on background
- **WHEN** the app is backgrounded and sends `memory.trim`
- **THEN** within 500 ms cache bytes drop to those required for the current frame only

### Requirement: Performance instrumentation
The engine SHALL include opt-in instrumentation, enabled by `perf.setEnabled(true)` from the diagnostics setting or the developer flag `__renderPerf`, recording per frame the TypeScript spans `resolve`, `buildFrame`, `syncTextures`, `renderFrame` and `present`; the wasm spans `wasm.deserialize`, `wasm.surfaceConfigure`, `wasm.renderFrameToSurface`, `wasm.compositeToTexture` and `wasm.presentToSurface`; decode spans `decode.seek` and `decode.frame`; and the counters `textureCacheHit`, `textureUpload`, `textureUploadPixels`, `frameItems`, `frameTextures`, `passes`, `droppedFrames`, `decoderSessions` and per-pool memory bytes. A summary with mean, p50, p95 and max per span MUST be flushed every 60 rendered frames from every render path (preview loop, stills and export), emitted as `perf.sample`, and shown in the diagnostics overlay. When disabled, instrumentation overhead MUST be below 1 % of frame time. Perf data MUST stay on the device and MUST NOT be sent to any remote endpoint. [PORT SH-013] [NEW]

#### Scenario: Summary during playback
- **WHEN** instrumentation is enabled and 120 frames are played
- **THEN** exactly 2 `perf.sample` summaries are emitted, each containing mean, p50, p95 and max for `renderFrame`

#### Scenario: Disabled by default
- **WHEN** the engine starts with default settings
- **THEN** no `perf.sample` event is emitted

### Requirement: Golden-frame determinism
Rendering SHALL be deterministic, and this requirement is the single definition of the two render tolerances. (a) Same device and backend: for a given scene snapshot, time, output size and source variant, two renders MUST produce byte-identical RGBA output, and a preview frame at `full` quality at project size MUST equal the pre-encode export frame for the same time with a maximum per-channel difference of 1 ("preview-versus-export tolerance"). (b) Golden tolerance: a rendered frame passes against its reference when at least 99.5 % of pixels differ by 2 or less per channel (of 255), no pixel differs by more than 16, and SSIM is 0.99 or greater; the same thresholds apply across the WebGPU and WebGL2 backends. Golden references are authoritative only on the CI runtime (Linux, software rasterisation), at 640×360, run under the protocol of `diagnostics-quality.Golden-frame tests with tolerance`. Across operating systems and between a device and the render host, frames that contain text MUST reach SSIM 0.98 or greater and frames without text MUST meet the golden tolerance. The suite MUST contain at least 150 hand-authored cases covering every node type, every colour stage, chroma key, single and combined masks in all four combine modes with and without feather, a mask stroke on a 50 %-opacity `multiply` layer, crop, flip, rotation, clip animations at start, middle and end, compound nesting, caption word states, per-clip and gradient backgrounds, and text with stroke, shadow and glow in the bundled baseline fonts of `text-and-titles.Bundled fonts`; and, generated from the catalogues, one case per effect id, one per filter id, three per transition id (progress 0.25, 0.5 and 0.75), one per blend mode and one per mask type. CI MUST fail when a catalogue id has no golden case, and a failing case MUST output the reference, the actual and a difference image. [NEW]

#### Scenario: Repeat render is identical
- **WHEN** the same golden case is rendered twice on the same backend
- **THEN** the two RGBA buffers are byte-identical

#### Scenario: Preview equals export
- **WHEN** a frame is rendered by the preview at `full` quality at project size and by an export session before encoding, on the same device and backend
- **THEN** no channel of any pixel differs by more than 1

#### Scenario: Cross-backend tolerance
- **WHEN** a golden case is rendered on WebGPU and on WebGL2 on the CI runtime
- **THEN** both pass against the same reference image within the golden tolerance

#### Scenario: Catalogue id without a golden case
- **WHEN** a new effect id is added to the effect catalogue without a golden case
- **THEN** the golden coverage check fails naming the id

#### Scenario: Regression produces artefacts
- **WHEN** a shader change makes a case differ by 10 per channel on 3 % of pixels
- **THEN** the suite fails and writes the reference, actual and difference images for that case

### Requirement: Wasm panic capture and recovery
`initializeGpu()` SHALL install a panic hook that records the panic message and location. When a wasm call panics the engine MUST emit `engine.error` with code `engine/wasm-panic`, the message, and `fatal: false`; discard the wasm instance; create a new instance; re-create the compositor at the current size; re-upload textures for the current frame; and re-render, all within 2 000 ms on web and desktop and without losing the scene snapshot, playhead or transport state. After 3 panics within 60 s on web and desktop the engine MUST stop retrying and emit `engine.error` with `fatal: true` and code `engine/wasm-panic-loop`; on the mobile surface panics follow "Mobile engine restart budget" and its shared counter instead. A panic during an export session fails that export with code `export/engine-panic` and does not affect the preview instance on web and desktop. Panic records are written to the local diagnostics log. The "engine stopped" state and its "Reload engine" action are defined by `preview-canvas.Engine states`. [NEW]

#### Scenario: Single panic recovers
- **WHEN** a wasm panic occurs while rendering a preview frame on desktop
- **THEN** `engine.error` with code `engine/wasm-panic` is emitted
- **AND** a correct frame for the current playhead is shown within 2 000 ms without user action

#### Scenario: Panic loop
- **WHEN** 3 panics occur within 60 s on web
- **THEN** the engine stops re-initialising and emits a fatal `engine/wasm-panic-loop`
- **AND** project editing in `editor-core` and saving continue to work

#### Scenario: Panic inside an export worker
- **WHEN** the export session's wasm instance panics on desktop
- **THEN** the export fails with `export/engine-panic` and the preview keeps rendering

### Requirement: GPU device-lost recovery
When the GPU device or WebGL context is lost the engine SHALL emit `engine.error` with code `engine/device-lost` and `fatal: false`, keep the last presented frame on the surface, clear every texture cache key and the render-target pool, request a new device on the same backend, re-create pipelines, re-upload the textures needed for the current frame and re-render within 2 000 ms. If re-creation fails 3 times on WebGPU the engine MUST fall back to WebGL2 and emit `engine.backendChanged`; if WebGL2 also fails it enters the state of "Behaviour without a GPU backend" and emits `engine.backendChanged` with `backend: "none"`. A device loss during an export session MUST retry the failed frame once after recovery and otherwise fail the export with code `export/device-lost`; frames already encoded stay valid. The "recovering" indicator shown while this runs is defined by `preview-canvas.Engine states`. [NEW] [PORT R-011]

#### Scenario: Context loss and restore
- **WHEN** the WebGL context is lost and restored while paused
- **THEN** the same frame is visible again within 2 000 ms and no texture cache hit refers to a destroyed texture

#### Scenario: Fallback after repeated loss
- **WHEN** WebGPU device creation fails 3 consecutive times after a loss
- **THEN** the engine switches to WebGL2 and emits `engine.backendChanged` with `backend: "webgl2"`

#### Scenario: Both backends fail
- **WHEN** WebGL2 initialisation also fails after the WebGPU fallback
- **THEN** `engine.backendChanged` carries `backend: "none"` and no further `frame.ready` is emitted

#### Scenario: Device loss during export
- **WHEN** the device is lost while export frame 500 is rendering and recovery succeeds
- **THEN** frame 500 is rendered again once and the export continues with frames 0–499 unchanged

### Requirement: Engine diagnostics surface
Every recoverable engine problem SHALL be reported as a `diagnostic` event `{id, severity, message, assetId?, elementId?}` with a stable id, and every failure as a reply or event carrying a code from this closed set of prefixes: `surface/`, `scene/`, `descriptor/`, `shader/`, `blend/`, `mask/`, `matte/`, `font/`, `media/`, `color/`, `engine/`, `export/`, `time/`. A given diagnostic id for a given element or asset MUST be emitted at most once per scene revision. Messages MUST be localisable through message ids resolved by the app and MUST NOT contain file paths outside the project or any media content. Engine diagnostics are appended to the registry defined by `diagnostics-quality.Diagnostics registry` with their last occurrence. [NEW]

#### Scenario: Diagnostic is not repeated every frame
- **WHEN** a clip with an unsupported shader pass is visible for 300 frames at one scene revision
- **THEN** exactly one `shader/unsupported` diagnostic is emitted for it

#### Scenario: Error code namespace
- **WHEN** any engine reply has `ok: false`
- **THEN** its `error.code` starts with one of the listed prefixes

#### Scenario: No media content in messages
- **WHEN** a `media/unavailable` diagnostic is emitted for an asset stored at an absolute path outside the project
- **THEN** the message names the asset by id and display name and contains no absolute path

### Requirement: Engine error codes
The engine SHALL use exactly these failure codes, registered by name in `server-api.RPC error envelope` as the `engine` domain set: `engine/unsupported-runtime`, `engine/init-timeout`, `engine/no-gpu`, `engine/device-lost`, `engine/wasm-panic`, `engine/wasm-panic-loop`, `engine/restart-loop`, `engine/encoder-unavailable`, `engine/sink-sequence`, `engine/sink-timeout`; `surface/unknown-command`, `surface/unsupported-version`, `surface/invalid-payload`, `surface/timeout`, `surface/unsupported-on-host`; `scene/revision-mismatch`, `scene/patch-invalid`; `descriptor/invalid`; `time/non-integer-ticks`, `time/invalid-frame-rate`, `time/out-of-range`; `media/unavailable`, `media/original-unavailable`. The engine additionally raises these codes owned by `export-share.Export error codes`: `export/font-unavailable`, `export/matte-unavailable`, `export/derived-unavailable`, `export/engine-panic`, `export/device-lost`, `export/interrupted`, `export/write-failed`. Diagnostic ids (non-failing) are: `scene/unknown-element-type`, `scene/compound-cycle`, `scene/compound-depth`, `scene/multicam-angle`, `scene/empty-slot`, `derived/unavailable`, `scene/crop-clamped`, `scene/background-layer-skipped`, `scene/background-unparsable`, `scene/transition-held-frame`, `shader/unsupported`, `shader/unknown-transition`, `blend/unknown`, `mask/limit-exceeded`, `mask/unsupported-element`, `matte/unavailable`, `font/fallback`, `color/hdr-tonemapped`, `engine/flow-fallback` and `surface/navigation-blocked`. A code or id outside these lists MUST fail the protocol schema validation in development and test builds. [NEW]

#### Scenario: Unlisted code is rejected in tests
- **WHEN** a test build emits `engine.error` with code `engine/unknown-thing`
- **THEN** schema validation fails and the test run reports the unlisted code

#### Scenario: Encoder unavailable
- **WHEN** `export.start` requests HEVC on a device whose probe reports no HEVC encoder
- **THEN** the reply is `ok: false` with `engine/encoder-unavailable`
