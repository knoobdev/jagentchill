## ADDED Requirements

### Requirement: Media asset model
Each project SHALL own a media library whose records are part of the project document: the synced asset record is an entry of `media.assets[]` as defined by `project-document.Media asset records` (name, type, kind, size, `lastModified_ms`, `contentHash`, dimensions, duration, `fps`, `hasAudio`, codecs, container, rotation, `folderId`, `tags`, `ephemeral`, `provenance` per `project-document.Asset provenance`, `derived`, `motionTracks`, `faces`, `created_ms`), and the per-device state of the same asset — `storage`, `externalPath`, `externalGrantId`, `externalSize`, `externalMtime_ms`, `canDecode`, `needsProbe`, `proxy`, `present` — is the entry `local.media[assetId]` of `project-document.Device-local section`. This capability owns the behaviour and restates no shape; there is no separate media-metadata store, and the thumbnail is a cache entry, not a field. Because asset records are document data, every library command (import, rename, tag, folder move, removal, relink of the content hash) is an undoable command that emits a state patch, is synced and travels in packages, while changes to the device-local entry (decode flags, proxy state, external path) create no undo step and no patch. `fps`, `hasAudio`, the codecs and the device-local `canDecode` MUST be persisted so they survive a reload without re-probing. An asset with `needsProbe: true` (set by `project-storage.Schema 32 migration` for assets that came from OpenCut classic) is probed once on first load per `media-library.Media probing`; while `hasAudio` is undefined the asset is treated as having audio. Assets flagged `ephemeral` (temporary assets created by tools) are never shown in the library and are removed when no element references them at project close. A media library is local to its project and needs no device role; the Gateway-backed sources of this spec state their role where they apply. [PORT M-025] [NEW]

#### Scenario: Probe results survive reload
- **WHEN** a 60 fps video with audio is imported and the project is closed and reopened
- **THEN** the asset reports 60 fps and `hasAudio = true` without the file being probed again

#### Scenario: Ephemeral asset hidden
- **WHEN** a tool creates an ephemeral asset
- **THEN** the library grid, list, search and counts do not include it

#### Scenario: Classic asset before its probe completes
- **WHEN** a migrated classic video asset with `needsProbe: true` and no `hasAudio` value is placed on the timeline before its probe finishes
- **THEN** the clip is treated as having audio, and the stored value replaces the assumption when the probe completes

### Requirement: Import pipeline
Every import path SHALL feed one pipeline that processes files sequentially in the given order: (1) detect type; (2) compute the sha256 content hash — when the project already holds an asset with the same hash the existing asset is reused, no quota is consumed and the toast reports "{name} is already in this project"; (3) evaluate quota per `project-storage.Quota evaluation` (skipped for external references and for bytes already stored on the device under the same hash, which are linked by reference count); (4) probe; (5) generate the thumbnail; (6) add the asset optimistically to the library and persist it, rolling back and showing the quota message when persistence fails; (7) schedule background jobs for waveform summary, filmstrip and, when applicable, proxy. A failure of one file never aborts the remaining files. Hashing, probing and thumbnail generation run off the UI thread on web and desktop. [PORT M-001, M-006] [CAPCUT CC-015] [NEW]

#### Scenario: Batch with one failure
- **WHEN** five files are imported and the third is unsupported
- **THEN** four assets are added in order and the third is reported as unsupported

#### Scenario: Duplicate content when storage is short
- **WHEN** a 2 GiB file whose bytes equal an existing asset of the project is imported while only 100 MiB are available
- **THEN** no new asset is created, no storage is consumed, no quota message is shown and the existing asset is highlighted

#### Scenario: Persistence rollback
- **WHEN** writing the media file fails after the asset was added optimistically
- **THEN** the asset disappears from the library, no partial file remains and the quota message is shown

### Requirement: File picker import
The "Import" button in the Media tab and the action `media.import` (registered in `keyboard-shortcuts.Action registry`) SHALL open the platform file picker with multiple selection accepting `image/*`, `video/*` and `audio/*` plus the supported extensions. On desktop the picker offers the modes "Link to original files" and "Copy into project" per `media-library.External file references`; the preselected mode follows the preference "Reference files in place" of `settings-preferences.Project library location` (factory value on, which preselects linking). Files reachable through operating-system document providers (cloud-drive folders mounted on desktop, iOS Files providers, Android Storage Access Framework providers) are importable through this picker with no Gateway; importing from a Google Drive or Dropbox account without such a provider uses `media-library.Cloud drive connectors`. [PORT M-001] [CAPCUT CC-015, CC-022] [NEW]

#### Scenario: Multiple files
- **WHEN** the user selects 3 videos and 2 images in the picker
- **THEN** 5 assets appear in the library in the picker's order

#### Scenario: Picker cancelled
- **WHEN** the picker is dismissed without a selection
- **THEN** nothing changes and no toast is shown

#### Scenario: File from a document provider
- **WHEN** the user picks a video from a cloud-drive provider in the mobile system picker
- **THEN** the file is downloaded by the operating system and imported as a managed asset

### Requirement: Cloud drive connectors
With a connected Gateway that advertises the feature flag `connectors`, the Media tab's Import menu SHALL offer "Google Drive" and "Dropbox", backed by the connectors `google-drive` and `dropbox` of `server-api.Connectors` (registry, OAuth authorization-code flow with PKCE, callback route). JAgentChill ships no OAuth client of its own: an `admin` device (scopes `jagentchill.config.write` and `jagentchill.secrets.manage`) enters the user-supplied OAuth client id and client secret on the page of `settings-preferences.Host connectors settings` (the secret is stored as a host secret and never returned to clients) and completes the sign-in once; access is requested read-only (`drive.readonly` for Google Drive, `files.content.read` and `files.metadata.read` for Dropbox). Until that is done the menu items open a sheet "Set up {connector} on {host}" with a link to that page (shown as explanatory text only on `editor` and `viewer` devices). A connected account can be browsed by any device with scope `jagentchill.media.write` (`editor`, `admin`): a browser lists folders and files 50 per page with name, type icon, size, modified date and thumbnail where the service provides one, filters to supported media types, supports search by name and multi-selection of up to 100 files, and shows the account's e-mail address with "Disconnect" for `admin` devices. "Import (N)" starts one Gateway job of kind `connector.transfer` per file: the Gateway downloads the file from the service into the blob store (bytes never pass through a third party other than the service itself), and the client then receives it as a managed asset through the content-addressed transfer of `cross-device-sync.Chunked resumable download`, entering `media-library.Import pipeline` at the hashing step; provenance is `{source: "connector", connector, fileId, path, account}`. Each file shows progress, is cancellable, and resumes after a dropped connection; a file larger than the Gateway's free quota is refused before download with the quota message. Errors map to messages: expired or revoked authorisation → "Reconnect {connector} in Settings"; service rate limit → automatic retry by the job queue and "{connector} is busy — retrying"; file removed → "{name} is no longer available". The connector hosts are listed in the egress table of `security-privacy.Network egress control`. Without a Gateway, or when the flag is absent, the items are shown disabled with "Connect a host to import from {connector}". [CAPCUT CC-022] [NEW]

#### Scenario: Import from Drive
- **WHEN** an `editor` device browses a connected Google Drive account, selects 2 videos and chooses "Import (2)"
- **THEN** two `connector.transfer` jobs run with per-file progress and both videos appear in the project library with connector provenance

#### Scenario: Not configured
- **WHEN** no OAuth client is stored for Dropbox and an `editor` device chooses "Dropbox"
- **THEN** the set-up sheet states that an admin must configure the connector on the host, and nothing is downloaded

#### Scenario: Authorisation revoked
- **WHEN** the user revoked the app's access in their Google account and an import is started
- **THEN** the job fails with "Reconnect Google Drive in Settings" and no asset is created

#### Scenario: No Gateway
- **WHEN** no Gateway is connected
- **THEN** both menu items are disabled with the explanation that a connected Gateway is required

#### Scenario: Secret never reaches the client
- **WHEN** any device reads the connector configuration
- **THEN** the response contains the client id and whether a secret is set, and never the secret or an access token

### Requirement: Drag-and-drop import into the library
On desktop and web, dragging files from the operating system over the Media panel SHALL show the drop zone "Drag and drop videos, photos, and audio files here" and importing on drop; folders dropped are traversed recursively and create matching library folders (depth capped at 4; deeper files are placed in the level-4 folder). Drags that originate from the timeline or from the library itself are ignored by this drop zone. An empty library shows the same drop zone as its clickable empty state (click opens the file picker); while processing, the zone reads "Processing your files (N %)" with a progress bar. [PORT M-002, M-024] [CAPCUT CC-016]

#### Scenario: Drop files
- **WHEN** two audio files are dropped on the Media panel
- **THEN** both are imported and the panel leaves the drag-over state

#### Scenario: Internal drag ignored
- **WHEN** a timeline clip is dragged over the Media panel
- **THEN** the import drop zone is not shown

#### Scenario: Empty library
- **WHEN** the project has no assets
- **THEN** the drop zone is shown as the panel content and clicking it opens the file picker

### Requirement: Paste import
A paste event outside typable fields SHALL import clipboard files and images with a media MIME type and insert each at the playhead by the click-to-add rule of `timeline-editing.Placement strategies` (visual media into the main track with `mainInsert` while the magnet is on, otherwise `firstAvailable`; audio to an audio track) as one undo step, with duration equal to the asset duration or the default image duration preference for images. A pasted bitmap without a file name is named "Pasted image {n}.png". With an editor clipboard entry present the event is handled by `timeline-editing.Clipboard` first. Paste inside a typable field is never intercepted. [PORT M-004] [CAPCUT CC-025]

#### Scenario: Paste a screenshot
- **WHEN** a screenshot is on the system clipboard, the editor clipboard is empty and the user pastes with the timeline focused
- **THEN** an image asset "Pasted image 1.png" is added and an image clip of the default image duration is inserted

#### Scenario: Paste inside a text field
- **WHEN** the paste happens while the project-name field has focus
- **THEN** no asset is imported

### Requirement: URL import
"Import from URL" SHALL accept an `http` or `https` URL (1–2048 characters) pointing to a media file. On web the file is fetched directly when the server allows cross-origin requests and otherwise through a connected Gateway (scope `jagentchill.media.write`); on desktop and mobile it is fetched by the app. The response MUST have a supported media content type or extension; the declared or received size is checked against quota before and during download; downloads show progress, support Cancel, time out after 30 s without received bytes, and follow at most 5 redirects. The asset records the source URL in its provenance (`source: "url"`). Failures show "Download from {host} failed: {reason}" and leave no partial file. Private-network and metadata addresses are refused per `security-privacy.Outbound request hardening`. [NEW]

#### Scenario: Direct download
- **WHEN** the user enters a URL of an MP4 served with permissive CORS
- **THEN** the file is downloaded with progress and added as a video asset whose provenance records the URL

#### Scenario: Not a media file
- **WHEN** the URL returns `text/html`
- **THEN** no asset is created and the message "The link does not point to a supported media file" is shown

#### Scenario: Web without CORS and without Gateway
- **WHEN** the server blocks cross-origin requests and no Gateway is connected
- **THEN** the message states that a connected Gateway is required to import this link

#### Scenario: Stalled download
- **WHEN** no bytes arrive for 30 s during a download
- **THEN** the download is aborted, the partial file is removed and the failure message names the host

### Requirement: Recording
The Media tab SHALL offer "Record" with three sources: Camera (video with microphone), Screen (desktop and web: display, window or tab capture with a system-audio toggle where the platform supports it and a microphone toggle) and Voice (microphone only; timeline-synchronised voiceover is defined in `audio-editing.Voiceover recording`). Recording requests the platform permission on first use per `security-privacy.OS permission requests`; a denied permission shows an explanation with a button to open system settings and creates nothing. The recorder shows elapsed time, input level meter, device selectors, Pause/Resume and Stop; a 3 s countdown precedes screen and camera recording. Paused time is not recorded: the asset's duration equals the sum of the recorded segments, and audio and video stay aligned within 40 ms across a pause. Data is written to storage incrementally at least every 2 s so that an interrupted recording keeps what was captured; available storage is checked every 5 s and recording stops automatically with a notice when free space after the 50 MiB reserve falls below 100 MiB. On Stop the recording becomes a managed asset named "Camera/Screen/Voice recording {yyyy-MM-dd HH.mm.ss}" with provenance `recorded`. Screen recording is unavailable on mobile and the option is omitted there. [CAPCUT CC-026] [NEW]

#### Scenario: Camera recording
- **WHEN** the user records 10 s from the camera and presses Stop
- **THEN** a video asset of 10 s (±0.2 s) with audio appears in the library

#### Scenario: Pause and resume
- **WHEN** the user records 4 s, pauses for 10 s, resumes for 6 s and stops
- **THEN** the asset lasts 10 s (±0.2 s) and a clap recorded after the resume has its audio peak within 40 ms of its video frame

#### Scenario: Permission denied
- **WHEN** the microphone permission is denied
- **THEN** no recording starts and a message explains how to grant the permission

#### Scenario: Interrupted recording
- **WHEN** the app is terminated 20 s into a recording and restarted
- **THEN** the project library offers "Recovered recording" containing at least the first 18 s

#### Scenario: Storage runs out
- **WHEN** free space after the reserve falls to 90 MiB during a recording
- **THEN** recording stops within 5 s, the captured part is kept as an asset and a notice states that storage ran low

### Requirement: Mobile photo library import
On mobile, importing SHALL open a photo-library picker with tabs Videos, Photos and Albums, multi-selection in which each selected item shows a numbered badge reflecting pick order, a preview on long-press, and an "Add (N)" button that is disabled while N = 0. Items are imported in badge order. Limited-library permission states are honoured, with a "Select more photos" entry when access is limited; a denied permission shows an explanation and a button to open system settings. Items stored in the device's cloud photo library are downloaded with per-item progress before import. HEVC videos are imported in their original format; HEIC/HEIF images are imported with their original plus the mezzanine image that the native import module produces at import time on iOS and on Android alike (`media-library.Undecodable media handling`). When the picker is opened by "New project" it additionally shows "Blank project" per `projects.Create project`. [CAPCUT CC-017] [NEW]

#### Scenario: Ordered pick
- **WHEN** the user taps item C, then A, then B and confirms
- **THEN** the badges read 1, 2, 3 on C, A, B and the assets are imported in the order C, A, B

#### Scenario: Limited access
- **WHEN** the app has limited photo access
- **THEN** only the permitted items are shown together with a "Select more photos" entry

### Requirement: Type detection and supported formats
Type detection SHALL use, in order: the MIME type prefix (`image/`, `video/`, `audio/`); the file extension; container signature sniffing of the first 4 KiB. Anything unrecognised produces the toast "Unsupported file type: {name}" and is not imported. Supported containers: MP4, MOV, M4V, WebM, MKV, 3GP (video); MP3, WAV, M4A, AAC, OGG, Opus, FLAC (audio); JPEG, PNG, WebP, GIF (animated GIF is imported as video), AVIF, BMP, SVG, and HEIC/HEIF through the conversion of `media-library.Undecodable media handling` (image). Supported codecs: H.264, HEVC, VP8, VP9, AV1, ProRes (decoded only on the Gateway, through the `mezzanine` variant of `media-library.Proxy media`); AAC, MP3, Opus, Vorbis, FLAC, PCM, ALAC. An SVG delivered with an empty MIME type whose content starts with `<svg` (after optional XML prolog and whitespace) is treated as `image/svg+xml`, on import and on load. Scripts and external references inside SVG are never executed or fetched; SVGs are rasterised in a sandboxed image context per `security-privacy.Untrusted file and pack handling`. [PORT M-005, M-026] [NEW]

#### Scenario: Unsupported type
- **WHEN** a `.docx` file is imported
- **THEN** the toast "Unsupported file type: {name}" is shown and no asset is created

#### Scenario: Missing MIME type
- **WHEN** a file named `clip.mkv` arrives with an empty MIME type
- **THEN** it is detected as video by extension and imported

#### Scenario: SVG without MIME
- **WHEN** an SVG file with an empty MIME type is imported and the project is reloaded
- **THEN** the asset displays as an image both before and after reload

#### Scenario: SVG with a script
- **WHEN** an SVG containing a `<script>` element and an external image reference is imported
- **THEN** the script does not run, no network request is made and the asset shows the rasterised picture

### Requirement: Media probing
Probing SHALL read for video: duration, display width and height (after rotation metadata), frame rate (average packet rate over the first 100 packets, matched to a standard rate (24000/1001, 24, 25, 30000/1001, 30, 48, 50, 60000/1001, 60, 120) within 0.01 fps, otherwise stored as `round(fps × 1000) / 1000` reduced by the greatest common divisor — this is the single rule for turning a frame-rate number into a rational, used also by `project-storage.Migration chain` and the classic mapping of `project-document`), `hasAudio`, video and audio codec, container, rotation and `canDecode` (WebCodecs decoder support on this device); for audio: duration, sample rate, channel count and codec, read from the container and not from an audio element; for images: width, height and whether an alpha channel is present. Durations are stored in ticks. A file that cannot be probed at all (corrupt or truncated) is rejected with "Unable to read {name}". Probing a file of any size reads only headers and index data and MUST complete within 5 s for a local file; on timeout the file is rejected with the same message. [PORT M-007, M-012]

#### Scenario: Probe a phone video
- **WHEN** a 1080 × 1920 (rotated 90°) 29.97 fps HEVC video with AAC audio is imported
- **THEN** the asset reports width 1080, height 1920, fps 30000/1001, `hasAudio = true`, video codec HEVC

#### Scenario: Corrupt file
- **WHEN** a truncated MP4 without an index is imported
- **THEN** it is rejected with "Unable to read {name}"

#### Scenario: Non-standard frame rate
- **WHEN** a screen recording averages 57.3334 packets per second
- **THEN** its `fps` is stored as `{numerator: 57333, denominator: 1000}`

### Requirement: Undecodable media handling
A video whose codec the device cannot decode SHALL still be imported with `canDecode = false`, the toast "Can't preview {name}", and a warning badge on its card. Resolution order for making it usable: (1) when a Gateway with the `remote-render` feature is connected, a host transcode to a proxy is offered and started on confirmation (`media-library.Proxy media`), after which preview uses the proxy; (2) otherwise the asset info shows guidance naming the codec and suggesting conversion to H.264 MP4. For HEVC the guidance additionally names the platforms where HEVC decodes natively. Clips of an undecodable asset without a proxy render the placeholder of `render-engine.Missing or undecodable media` in the player and block local export with a message naming the asset; export on the Gateway is offered per `export-share.Gateway export hand-off`. **Still images (HEIC/HEIF).** The engine decodes images inside Chromium on desktop, web and Android and inside WebKit on iOS, and only WebKit decodes HEIC, so a HEIC/HEIF image is never handed to the engine as such: on import the original is kept and a decodable `mezzanine` image is produced — PNG when the image has alpha, otherwise JPEG at quality 0.95, full resolution, orientation applied, the first image of a sequence or burst — by the first available producer: (1) on iOS and on Android the native import module (both operating systems decode HEIF natively); (2) on desktop (macOS, Windows, Linux) and web the Gateway job `media.transcode`, which the desktop app's built-in host always provides; (3) with no producer (a browser with no connected host) the file is NOT imported and the toast reads "HEIC photos need a host to convert them. Convert {name} to JPEG or PNG, or connect a host." The mezzanine is stored with the media, synced, packaged and exported like the video mezzanine, is what every surface and the render host render from, and is recorded in `local.media[assetId].present.mezzanine`; a device that receives a HEIC asset without its mezzanine and cannot produce one shows the offline placeholder with the same guidance. HEVC video keeps the rules above. [PORT M-008]

#### Scenario: HEVC on a browser without HEVC support, no Gateway
- **WHEN** an HEVC file is imported
- **THEN** the asset is added with a warning badge, the toast "Can't preview {name}" is shown and the asset info shows the HEVC guidance

#### Scenario: Gateway proxy
- **WHEN** a Gateway is connected and the user accepts the transcode offer
- **THEN** a proxy job runs and, when it succeeds, the clip previews normally and the warning badge is replaced by a "Proxy" badge

#### Scenario: Export blocked
- **WHEN** a project contains a clip of an undecodable asset without proxy and the user starts a local export
- **THEN** the export does not start and the message names the asset

#### Scenario: iPhone photo sent to a desktop
- **WHEN** a HEIC photo is sent from an iPhone to a project open on a Windows desktop through "Send from phone"
- **THEN** the phone's import module has produced the JPEG mezzanine, both files arrive, and the photo renders on the desktop and in a host export

#### Scenario: HEIF picked on Android
- **WHEN** a HEIF photo is picked in the Android photo picker
- **THEN** the native import module produces the mezzanine and the image shows in the preview WebView

#### Scenario: HEIC dropped on the web app without a host
- **WHEN** a HEIC file is dropped on the web app with no connected Gateway
- **THEN** it is not imported and the toast names the file and suggests converting to JPEG or PNG or connecting a host

### Requirement: Thumbnails
The pipeline SHALL create one thumbnail per visual asset: for video the frame at `min(1 s, duration / 2)`; for images the image itself; both scaled to fit within 1280 × 720 preserving aspect ratio and encoded as JPEG quality 0.8 (PNG when the image has alpha). Audio assets have no thumbnail and show a waveform glyph placeholder with the duration. A thumbnail that cannot be generated (undecodable video) falls back to a type icon and is retried when a proxy becomes available. Thumbnails are stored in the thumbnail store of `project-storage.Stored record layout`, not as data URLs. [PORT M-009, M-010, M-011] [NEW]

#### Scenario: Large image
- **WHEN** a 6000 × 4000 image is imported
- **THEN** its stored thumbnail is 1080 × 720

#### Scenario: Short video
- **WHEN** a 0.6 s video is imported
- **THEN** its thumbnail is the frame at 0.3 s

### Requirement: Filmstrip thumbnails
For each video asset the app SHALL generate, in the background and on demand, a filmstrip cache: frames 90 px high (aspect preserved) sampled at a base interval of 1 s, plus sparser levels at 2, 5, 10, 30 and 60 s derived from the base level, and on-demand denser frames at 0.5 s and at single-frame intervals for the visible range when the zoom makes a tile narrower than 0.5 s. Timeline clips choose the densest available level whose interval is ≥ the tile's time width. Generation is prioritised for the visible timeline range, limited to 2 concurrent decodes, paused during playback and export, and stored in the cache store managed by `project-storage.Cache management`. A missing filmstrip never blocks editing. [NEW]

#### Scenario: Visible range first
- **WHEN** a 2-hour video is added to the timeline and the viewport shows minutes 60–62
- **THEN** filmstrip frames for minutes 60–62 appear before frames of any other range

#### Scenario: Cache reuse
- **WHEN** the project is reopened
- **THEN** previously generated filmstrip frames are displayed without decoding the video

### Requirement: Waveform summaries
This requirement owns the stored waveform summary; drawing, the placeholder shown while computing and the failure presentation are owned by `audio-editing.Waveform rendering`. For each asset with audio the app SHALL compute, in the background, a waveform summary: min/max peak pairs of the mono mix at 100 pairs per second, 8-bit, with downsampled levels at factors 4, 16 and 64. Summaries are keyed by content hash (library sounds that are not project assets are keyed by the SHA-256 of their URL), stored in the cache store, shared by all clips of the asset, and removed when the asset is removed. Computation reports progress 0–1 and a terminal state `ready` or `failed` to the renderer; a failure logs a diagnostic and never blocks playback. Computation runs off the UI thread and causes no main-thread task longer than 50 ms. [NEW]

#### Scenario: Summary shared by clips
- **WHEN** an audio asset is used by three clips
- **THEN** exactly one waveform summary is computed and all three clips draw from it

#### Scenario: Long file
- **WHEN** a 3-hour audio file is imported
- **THEN** no main-thread task longer than 50 ms is caused by the computation and progress values are reported at least once per second until `ready`

#### Scenario: Summary format
- **WHEN** a 10 s mono sine at full scale is summarised
- **THEN** the base level holds 1 000 min/max pairs and the factor-4 level holds 250

### Requirement: Import progress and feedback
During an import the app SHALL show a toast "Uploading media asset(s)…" (the label is localised; on native platforms it reads "Importing media…") with overall percentage `round(completed / total × 100)` and a Cancel action that stops after the current file; on completion: "{name} has been uploaded" for one asset, "{n} media assets have been uploaded" for several, or "No media assets were uploaded" when none succeeded, followed by one line per failure with its reason. The UI yields between files so the first progress frame is painted before processing begins. [PORT M-013]

#### Scenario: Several files
- **WHEN** 4 files import successfully
- **THEN** the progress passes through 25, 50, 75 and 100 % and the final toast reads "4 media assets have been uploaded"

#### Scenario: Cancel
- **WHEN** the user cancels while file 2 of 5 is processing
- **THEN** files 1 and 2 are in the library and files 3–5 are not imported

### Requirement: Library views, sorting and persistence
The Media tab SHALL show a header with view toggle, sort menu, filter menu, search field, "New folder" and "Import". Views: grid (auto-fill columns of minimum 112 px) and list (compact rows with name, type, duration, resolution, size, date added). Sort keys: Name, Type, Duration, File size, Date added; choosing the active key flips ascending/descending and a new key starts ascending; default Name ascending; folders are always listed first. Grid cards show the thumbnail, a duration badge for video and audio, and the name; names longer than 22 characters are displayed as the first 16 characters, "…" and the last 3 characters before the extension, with the full name in the tooltip and accessible name. View mode and sort are persisted as UI preferences. [PORT M-014, M-015, M-016, M-017, M-027]

#### Scenario: Flip sort order
- **WHEN** the sort is Name ascending and the user chooses Name again
- **THEN** the sort is Name descending

#### Scenario: Truncated name
- **WHEN** an asset is named "very-long-recording-name-final-v2.mp4"
- **THEN** its card label reads "very-long-record…-v2" with the full name in the tooltip

#### Scenario: Persistence
- **WHEN** the user selects list view sorted by File size and reopens the app
- **THEN** the Media tab shows list view sorted by File size

### Requirement: Library folders
The library SHALL support folders (bins) nested up to 4 levels, per project. Folder names are trimmed, 1–80 characters and unique among siblings. Actions: New folder, Rename, Move assets or folders by drag-and-drop onto a folder or breadcrumb, "Move to…" dialog, Delete folder (moves its assets to the parent folder after confirmation; it never deletes assets). The panel shows a breadcrumb for the current folder. Folders are the entries of `media.folders` in the project document (`project-document.Library folders and LUT records`), and an asset's folder is its `folderId`; folder changes are undoable commands that emit state patches, are synced and are carried in packages. [PORT N-009] [NEW]

#### Scenario: Move into a folder
- **WHEN** three selected assets are dragged onto the folder "B-roll"
- **THEN** they are listed inside "B-roll" and their timeline clips are unaffected

#### Scenario: Delete folder keeps assets
- **WHEN** a folder with 5 assets is deleted and confirmed
- **THEN** the 5 assets are listed in the parent folder

#### Scenario: Depth limit
- **WHEN** the user tries to create a folder inside a level-4 folder
- **THEN** "New folder" is disabled with the tooltip "Folders can be nested up to 4 levels"

### Requirement: Library search and filters
The search field SHALL filter live (debounced 150 ms) by case-insensitive, diacritic-insensitive match on asset name, folder name, tags, provenance prompt text, and — for assets that have them — transcript text and content labels. Searching spans all folders and shows each hit's folder path. Filters, combinable with search: type (Video, Image, Audio), usage (Used, Unused), source (Imported, Recorded, Stock, AI-generated, Connector, Slate), status (Offline, Has proxy, Can't preview). An active filter shows a count chip and "Clear filters". Content labels (objects, scenes, people count) are produced by the "Index media for search" action, which is the entry point of `ai-editing-tools.Smart search of media` (it owns the labelling job, its accuracy target and its cost and consent rules) and requires a connected Gateway with a `vision` role configured in `orc-model-routing` and scope `jagentchill.generation.run`; transcript text comes from `captions-subtitles.Transcript panel`. An asset whose labelling failed has no labels, is marked "Not indexed" in its Info panel with "Retry", and is still found by the other fields. No results shows "No media found" with "Clear search". [PORT N-009] [CAPCUT CC-024] [NEW]

#### Scenario: Search by name across folders
- **WHEN** the user types "beach" and an asset "Beach-01.mp4" is in a subfolder
- **THEN** the asset is listed with its folder path

#### Scenario: Search by spoken words
- **WHEN** an asset has a transcript containing "welcome back" and the user searches "welcome back"
- **THEN** the asset is listed

#### Scenario: Filter unused
- **WHEN** the filter Unused is active
- **THEN** only assets referenced by no element in any scene are listed

#### Scenario: Indexing without Gateway
- **WHEN** "Index media for search" is invoked with no Gateway connected
- **THEN** the action is disabled with the explanation that a connected Gateway is required

#### Scenario: Labelling failed
- **WHEN** indexing fails for the asset "Beach-01.mp4"
- **THEN** searching "beach" still lists it by name and its Info panel shows "Not indexed" with "Retry"

### Requirement: Library selection
Assets SHALL support multi-selection: click selects one; Ctrl/Cmd-click toggles; Shift-click selects the range from the anchor; a marquee drag on empty panel area selects intersecting items (additive with Shift/Ctrl/Cmd); the select-all action selects all displayed items when the panel has focus; the cancel action clears. On touch, a long-press with the timing of `mobile-editor.Touch gesture constants` enters selection mode with checkboxes. Arrow keys move focus, Space toggles selection, and the activate key adds the focused asset to the timeline. The library is one of the selection scopes of `timeline-editing.Click selection`: selecting assets clears the timeline selection and the reverse, and Delete, Copy and Select all act on the library only while it is the active scope. [PORT M-018]

#### Scenario: Range select
- **WHEN** the first asset is selected and the user Shift-clicks the fourth
- **THEN** assets 1–4 are selected

#### Scenario: Marquee
- **WHEN** the user drags a marquee over three cards
- **THEN** those three assets are selected

#### Scenario: Scope switch
- **WHEN** two timeline clips are selected and the user clicks an asset in the library
- **THEN** the asset is selected, the timeline selection is empty and Delete targets the asset

### Requirement: Add to timeline from the library
Each asset SHALL offer a "+" button (on hover or focus; always visible on touch) and double-click, both of which add it by the click-to-add rule of `timeline-editing.Placement strategies`: with the main track magnet on, video and image assets are inserted into the main track at the cut nearest the playhead (`mainInsert`), rippling the clips after it; with the magnet off or Free layer on, they are placed at the playhead with `firstAvailable`; audio assets always go to an audio track at the playhead with `firstAvailable`. The duration equals the asset duration, or the default image duration preference of `settings-preferences.Editing default preferences` for images. With several assets selected, "+" on one of them inserts all selected assets one after another in displayed order as one undo step. An asset becomes an overlay only through the Overlay action (asset context menu "Add as overlay", which places it on an overlay video track at the playhead with `firstAvailable` among overlay tracks; on mobile the Overlay group of `mobile-editor.Overlay group`) or by dragging it onto an overlay track. Dragging an asset to the timeline shows a floating 80 px preview following the pointer (the native drag ghost is hidden) and drops per `timeline-editing.Drag and drop from the library`; non-audio media can also be dropped onto clips for replacement per `timeline-editing.Replace media`. Offline and undecodable-without-proxy assets can be added and render per their status. [PORT M-021, M-022] [CAPCUT CC-018]

#### Scenario: Plus button with the magnet on
- **WHEN** the magnet is on, the main track holds clips 0–6 s and 6–10 s, the playhead is at 4 s and the user presses "+" on a 10 s video asset
- **THEN** the new clip occupies 6–16 s on the main track, the second clip moves to 16–20 s, no overlay track is created, and one undo restores the previous state

#### Scenario: Plus button with the magnet off
- **WHEN** the magnet is off, the playhead is at 4 s inside a main-track clip and the user presses "+" on a 10 s video asset
- **THEN** a 10 s clip starts at 4 s on a new overlay video track directly above the main track (strategy `mainFirst` of `timeline-editing.Placement strategies`), or on the existing overlay video track nearest the main track when that track is free from 4 s to 14 s

#### Scenario: Add as overlay
- **WHEN** the magnet is on and the user chooses "Add as overlay" for an image with the playhead at 4 s
- **THEN** an image clip starts at 4 s on an overlay video track and the main track is unchanged

#### Scenario: Add several
- **WHEN** three video assets are selected and "+" is pressed on one of them with the magnet on
- **THEN** three clips are inserted back to back into the main track at the nearest cut and one undo removes all three

### Requirement: Reveal media and usage indicator
The action `reveal-media {assetId}` ("Reveal media" on a timeline element) SHALL switch the left panel to the Media tab, open the asset's folder, clear search and filters that would hide it, select it as the only library selection, scroll it into view and highlight it for 2 s; when the asset is no longer in the project it shows the toast "Media not found in this project" and changes nothing. Every asset SHALL show a usage indicator: a badge with the number of timeline elements across all scenes that reference it (no badge when 0); the asset context menu offers "Select clips in timeline", which selects the referencing elements in the active scene and moves the playhead to the earliest of them. [PORT M-023] [NEW]

#### Scenario: Reveal
- **WHEN** Reveal media is invoked on a clip whose asset is inside a collapsed folder while a search is active
- **THEN** the search is cleared, the folder is opened and the asset is selected and highlighted

#### Scenario: Asset gone
- **WHEN** `reveal-media` is invoked with the id of an asset that was removed
- **THEN** the toast "Media not found in this project" is shown and the panel does not change

#### Scenario: Usage count
- **WHEN** an asset is used by 2 clips in the main scene and 1 clip in another scene
- **THEN** its badge reads 3

### Requirement: Asset info and rename
The asset context menu SHALL offer "Info", opening a panel with: preview (playable for video and audio), name, type, container and codecs, resolution, frame rate, duration, sample rate and channels, file size, date added, storage mode and path (external assets), proxy status, usage count, content hash (first 12 characters with copy), tags (editable, up to 20 tags of 1–32 characters) and provenance. "Rename" (context menu, the rename action, or in the Info panel) changes the display name only (trimmed, 1–200 characters, empty reverts); elements that still carry the asset's previous name as their own name are renamed with it; rename is undoable. [NEW]

#### Scenario: Rename propagates to default-named clips
- **WHEN** asset "IMG_0042.mov" used by a clip also named "IMG_0042.mov" is renamed to "Interview A"
- **THEN** the asset and that clip are both named "Interview A", and a clip the user had renamed to "Intro" keeps its name

#### Scenario: Info for an image
- **WHEN** Info is opened for a PNG
- **THEN** the panel shows resolution and file size and omits frame rate, duration and audio fields

#### Scenario: Tag limit
- **WHEN** an asset has 20 tags
- **THEN** the tag field accepts no further tag and shows "Up to 20 tags"

### Requirement: Remove assets with cascade
"Delete" / "Delete N items" in the asset context menu (acting on the selection when the clicked item is in it), the delete action with the library as the active selection scope, and the action `media.remove-assets` SHALL remove the assets and every timeline element in every scene that references them (including the linked audio of extracted clips, and any project or per-clip background of kind `image` that references them, which reverts to `#000000` rendering per `projects.Background blur and image`) as one undoable command. When any targeted asset is in use, a confirmation states "N assets are used by M clips. Deleting them also removes those clips."; unused assets are deleted without confirmation. Undo restores the assets, their folder placement and all removed elements. The media bytes, thumbnail, proxy and caches of a removed asset are retained while the removal is still in the undo history and are purged when that history entry is discarded or the project is closed; purging decrements the content reference count, revokes object URLs and clears the decoder and waveform caches for the asset. [PORT M-019, M-020]

#### Scenario: Cascade and undo
- **WHEN** an asset used by 3 clips is deleted and confirmed, then undo is invoked
- **THEN** after deletion the 3 clips are gone, and after undo the asset and the 3 clips are back at their original positions and play

#### Scenario: Unused asset
- **WHEN** an unused asset is deleted
- **THEN** no confirmation is shown and the asset is removed

#### Scenario: Storage is released
- **WHEN** a project is closed after deleting an asset whose bytes no other project uses
- **THEN** the asset's bytes no longer count toward storage usage

### Requirement: Export original files
The asset context menu SHALL offer "Export original files" for one or more selected assets: on desktop a folder chooser is shown and the original bytes are written with their original file names (suffix " (n)" on name collisions); on web each file is saved through the file-save dialog or download; on mobile the system share sheet is opened with the files. Offline assets are skipped and reported. Proxies are never exported by this action. [PORT M-028] [NEW]

#### Scenario: Export two assets on desktop
- **WHEN** two assets are selected, "Export original files" is chosen and a folder is picked
- **THEN** the folder contains two files byte-identical to the imported originals

#### Scenario: Offline asset
- **WHEN** one of the selected assets is offline
- **THEN** the other files are exported and a notice names the skipped asset

### Requirement: External file references
On desktop, importing with "Link to original files" SHALL create assets with `storage: "external"` that record the grant id, absolute path, size, modified time and content hash, and read the file in place without copying, through the range-capable scheme and per-project grants of `project-storage.External file references on desktop`. External assets consume no managed storage and skip the quota check. At project load and when the app window regains focus, each external path is checked: a missing file, or a file whose size and modified time both differ and whose content hash differs, marks the asset offline. "Copy into project" on an external asset converts it to a managed asset after a quota check. Because linking is the factory default of the desktop app (the preference "Reference files in place" of `settings-preferences.Project library location`, on by default on macOS, Windows and Linux alike), every project that has at least one external asset SHALL offer the one-press action "Copy media into library" — in the Media tab's menu, in the offline banner of `media-library.Offline media and relink` and in `projects.Per-project menu` — which shows the number of files and their total size, checks free space on the library volume (total size plus 50 MiB) before starting, then copies every external asset of the project into the project's `media/` folder with a determinate progress dialog and Cancel, verifies each copy by SHA-256 and switches that asset to `storage: "managed"` only after its copy verified. Assets that are offline are skipped and listed at the end with "Relink…"; cancelling keeps the assets already converted and leaves the rest linked; clips, trims and edits are never changed; the conversion is not an undo step. Web and mobile always create managed assets, so the action does not exist there. [NEW]

#### Scenario: Linked import
- **WHEN** a 4 GiB file is imported in link mode
- **THEN** the asset is usable immediately after probing and the project's storage usage does not increase by 4 GiB

#### Scenario: File moved
- **WHEN** the linked file is moved in the file manager and the app regains focus
- **THEN** the asset and its clips show "Media offline"

#### Scenario: Convert to managed
- **WHEN** "Copy into project" is chosen for a 1 GiB external asset with 5 GiB available
- **THEN** the asset becomes managed, the project's storage usage grows by 1 GiB and its clips are unchanged

#### Scenario: Copy media into library
- **WHEN** a desktop project links 12 external files totalling 8 GiB, 20 GiB are free, and the user chooses "Copy media into library"
- **THEN** after the progress dialog completes all 12 assets are managed, each copy matches its source SHA-256, and the project plays with the original files' drive disconnected

#### Scenario: Not enough space
- **WHEN** the same action is chosen with 6 GiB free
- **THEN** nothing is copied and the message names the required and the available space

#### Scenario: One file is offline
- **WHEN** 1 of the 12 linked files is missing when the action runs
- **THEN** 11 assets become managed and the result lists the missing file with "Relink…"

### Requirement: Offline media and relink
An asset whose bytes are unavailable (missing external file, managed file missing or failing its hash, not yet downloaded from a paired device) SHALL be marked offline: its card shows an "Offline" badge, its clips render the placeholder of `render-engine.Missing or undecodable media` in the player and remain fully editable, and local export is blocked with a message listing offline assets. "Relink…" (asset menu and the offline banner shown at project open with the count of offline assets) lets the user pick a replacement file: when its content hash equals the stored hash it is relinked silently; when it differs, a dialog compares duration, resolution and frame rate and requires confirmation, after which clips keep their timings and clips longer than the new duration are trimmed to it. "Locate folder…" on desktop searches a chosen folder recursively (up to 50 000 files) for files matching the offline assets by name and size, then verifies by hash, and relinks all matches at once. When the asset exists on a paired device or the Gateway, "Download from {device}" is offered per `cross-device-sync.Originals for local export`. Relink is undoable. [NEW]

#### Scenario: Exact relink
- **WHEN** the user picks the moved original file for an offline asset
- **THEN** the asset is online, its clips play, and no confirmation dialog is shown

#### Scenario: Different file
- **WHEN** the picked file has a different hash and a shorter duration
- **THEN** the comparison dialog is shown and, after confirmation, clips exceeding the new duration are shortened to it

#### Scenario: Batch locate
- **WHEN** 12 assets are offline and the user chooses a folder containing 10 of the files
- **THEN** 10 assets are relinked and the banner reports 2 assets still offline

### Requirement: Proxy media
This requirement owns the one proxy format of the product; `cross-device-sync.Media variants and proxies`, `render-engine.Proxy playback switching` and `settings-preferences` reference it and offer no other resolution. A proxy SHALL be 8-bit 4:2:0 video in one of two accepted forms, chosen per decision A4 (H.264 when available, else VP9): **form `mp4`** — H.264 (profile High when `VideoEncoder.isConfigSupported` accepts it, else Main, else Constrained Baseline) with AAC-LC audio in MP4; **form `webm`** — VP9 profile 0 with Opus audio (96 kbit/s stereo) in WebM. Selection on the producing device: `mp4` when an H.264 encoder and an AAC encoder exist; else `webm` when a VP9 encoder and an Opus encoder exist; else the host job `media.proxy`, which applies the same order with the host's encoders (the host always has VP9 and Opus); else — no encoder on the device and no connected Gateway — no proxy is made, `local.media[assetId].proxy.state` is `"unavailable"`, the asset keeps playing from the original and its card shows "Proxy unavailable on this device". The chosen form is recorded in `local.media[assetId].proxy {videoCodec, audioCodec, container}` (`project-document.Device-local section`). A device that receives a proxy it cannot decode (for example a `webm` proxy on a phone without a VP9 decoder) requests the other form from the host when the host can produce it, and otherwise treats the asset as having no proxy. In both forms the picture is scaled to fit 1280 × 720 for landscape and square sources and 720 × 1280 for portrait sources, with even dimensions and never upscaled; every source frame and its presentation timestamp is preserved up to 60 fps, and a source above 60 fps is decimated by the smallest integer factor that brings it to 60 fps or below; video bitrate 4 Mbit/s at 30 fps or below, scaled linearly with frame rate to 8 Mbit/s at 60 fps; a keyframe every 1 s; `mp4` audio is AAC-LC 128 kbit/s stereo at the source sample rate (the `webm` form uses 80 % of the stated video bitrates). Frame correspondence: the proxy frame shown for source time t is the proxy frame with the greatest presentation timestamp ≤ t. Each proxy records `{size, sha256}` and is verified like an original when it is transferred between devices. A second variant, `mezzanine` (at the source resolution capped at 3840 × 2160, same timestamps: H.264 High at 40 Mbit/s when the host has an H.264 encoder, else VP9 at 30 Mbit/s; for HEIC/HEIF stills the image mezzanine of `media-library.Undecodable media handling`), is produced by the Gateway only for originals that the render host or the requesting device cannot decode and is used in place of the original for export. Proxies are created: automatically when a video's SHORT side after rotation exceeds 1080 px (so 1080 × 1920 portrait and 1920 × 1080 landscape footage are treated alike and neither is proxied for its size), its frame rate exceeds 60 fps, or the import decode test (decode 60 frames starting at 1 s, or the whole file when shorter) averages below the source frame rate; on request through "Create proxy" for any video; and for undecodable codecs through the Gateway. Generation runs on-device with WebCodecs where the source decodes and one of the two forms can be encoded, otherwise as a host job of kind `media.proxy` (FFmpeg worker of `server-api.FFmpeg worker`; scope `jagentchill.media.write`), with states queued, running (percentage), succeeded, failed and cancelled shown on the asset card; failed jobs offer Retry. The project setting "Use proxies for preview" (default on, in `projects.Project settings surface`) makes the player, filmstrip and thumbnails read the proxy; export always reads the original, or the mezzanine when the original is undecodable, and is routed per `export-share.Gateway export hand-off` when neither decodes locally. "Delete proxy" removes it. Proxies live in the cache store, are keyed by the original's content hash and are shared across projects. On mobile, assets received from a paired device arrive as proxies first per `cross-device-sync.Media sync policy by platform`. [NEW]

#### Scenario: Automatic proxy for 4K
- **WHEN** a 3840 × 2160, 30 fps video is imported
- **THEN** a proxy job starts automatically, the card shows its progress, and on success the proxy is 1280 × 720 at 30 fps in the form this requirement selects (H.264 + AAC in MP4 where the device has both encoders) with a "Proxy" badge on the card

#### Scenario: Portrait source
- **WHEN** a 2160 × 3840 portrait video is proxied
- **THEN** the proxy is 720 × 1280

#### Scenario: 60 fps source keeps every frame
- **WHEN** a 60 fps source is proxied and the playhead rests on source frame 37
- **THEN** the proxy has the same frame count as the source and the frame shown is proxy frame 37

#### Scenario: 120 fps source
- **WHEN** a 120 fps source is proxied
- **THEN** the proxy is 60 fps holding every second source frame, and for a source time on an odd frame the proxy frame with the greatest timestamp not after it is shown

#### Scenario: Slow decode test
- **WHEN** a 1920 × 1080, 30 fps AV1 file decodes its 60 test frames at an average of 21 fps on this device
- **THEN** a proxy is created automatically

#### Scenario: Export uses the original
- **WHEN** a project using a proxied 4K clip is exported at 3840 × 2160
- **THEN** the exported frames are decoded from the original file

#### Scenario: Corrupted proxy from another device
- **WHEN** a proxy downloaded from the Gateway does not match its recorded SHA-256
- **THEN** it is discarded and downloaded again, and it is never used for preview

#### Scenario: Proxy job failure
- **WHEN** a proxy job fails
- **THEN** the card shows "Proxy failed" with Retry and the asset continues to preview from the original when it is decodable

#### Scenario: Portrait 1080p phone clip gets no automatic proxy
- **WHEN** a 1080 × 1920, 30 fps clip that passes the decode test is imported on iOS or Android
- **THEN** no proxy job is created and preview plays the original

#### Scenario: Portrait 4K clip is proxied
- **WHEN** a 2160 × 3840 clip is imported
- **THEN** a 720 × 1280 proxy is created automatically

#### Scenario: Linux desktop without an AAC encoder
- **WHEN** a 4K clip is imported on a Linux desktop whose runtime has an H.264 encoder and no AAC encoder
- **THEN** the proxy is produced in form `webm` (VP9 + Opus) on the device when a VP9 encoder exists, otherwise by the built-in host's `media.proxy` job, and `proxy.container` records the form

#### Scenario: No encoder and no host
- **WHEN** a 4K clip is imported in a browser with no video encoder and no connected Gateway
- **THEN** the asset has `proxy.state = "unavailable"`, plays from the original and its card shows "Proxy unavailable on this device"

### Requirement: Quota handling
Before storing each managed file the pipeline SHALL call `project-storage.Quota evaluation`; a rejected file produces that requirement's message "Not enough storage for {name} ({size}). {available} available." with its "Empty trash ({size})" and "Manage storage" actions, and the remaining files in the batch are still evaluated individually. A quota error raised by the store during the write is mapped to the same message and the partially written file is removed. The Media tab footer shows project media usage and available space in binary units, turning to the warning colour token when available space after the reserve is below 500 MiB. [PORT M-006] [NEW]

#### Scenario: One file too large
- **WHEN** a batch contains a 3 GiB file exceeding available storage and a 20 MiB file that fits
- **THEN** the 20 MiB file is imported and the message for the 3 GiB file states its size and the available space

#### Scenario: Trash offered
- **WHEN** an import is rejected for quota while the trash holds 3 GiB
- **THEN** the message offers "Empty trash (3.0 GiB)"

#### Scenario: Low-space warning
- **WHEN** available storage after reserve is 300 MiB
- **THEN** the footer shows the usage in the warning colour

### Requirement: Stock and provider-sourced media
The Media tab SHALL include a "Library" section listing stock video and images from the stock providers enabled in `generation-providers.Stock media providers`, with categories, keyword search, infinite scroll (page size 30), hover preview, and "+" / drag to use. Stock and bundled audio is not listed here: music and sound effects are browsed in `audio-editing.Sounds library panel`. Using an item downloads it into the project as a managed asset with provenance `{source: "stock", provider, itemId, author, licence, licenceUrl, sourceUrl}`; attribution-required licences are flagged in the asset info and collected in the project's credits list available to `export-share`. With no stock source enabled, the section shows "Connect a stock source in Settings" with a link that opens Host ▸ Runtimes & providers ▸ Endpoints filtered to the `stock-source` presets (`settings-preferences.Providers and model routing entry points`, `agent-runtimes.Endpoint presets`) on an `admin` device, and "Ask an admin to connect a stock source" on other devices; stock sources are endpoint records created from those presets with the admin's own key; provider or network errors show a retry state; requests that need a provider key are made through the connected Gateway (scope `jagentchill.media.write`; enabling a provider needs `admin`) and the section states that a Gateway is required when none is connected. JAgentChill bundles no stock video and no third-party editor's content; what is bundled is defined in `media-library.Bundled starter library`. [CAPCUT CC-019] [NEW]

#### Scenario: Use a stock clip
- **WHEN** the user presses "+" on a stock video result
- **THEN** the clip is downloaded with progress, added to the library with stock provenance and added to the timeline by the click-to-add rule

#### Scenario: No provider
- **WHEN** no stock provider is enabled
- **THEN** the Library section shows the connect message and no results

#### Scenario: Provider error
- **WHEN** the provider answers with an error while results are loading
- **THEN** the section shows "Couldn't load results" with "Retry" and keeps the results already listed

### Requirement: Bundled starter library
The app SHALL ship a starter library that works on every platform with no Gateway and no network: music and sound effects enumerated in the normative catalogue of `audio-editing.Bundled sound pack` (at least 40 music tracks in 8 moods and 120 sound effects in 12 categories), and stickers enumerated in the normative catalogue of `stickers-shapes.Starter sticker pack` (128 stickers in 8 categories, 32 of them animated). Every item is CC0-1.0 or authored by the project, and has a row `{id, title, category, licence, sourceUrl}` in its owner's catalogue and in `docs/product/ASSET-PROVENANCE.md` (the licence gate of `platform-skeleton.Licence and third-party notices` fails the build for an unlisted file). Starter items are part of the app bundle and are not counted in project storage until used. Using a starter item in a project adds it to that project's media library as a managed asset with provenance `{source: "bundled", itemId, licence, sourceUrl}` through `media-library.Import pipeline` (deduplicated by content hash, so using the same item in many projects stores it once per device); the asset then behaves as any imported asset, including package export and sync. The Media tab filter "Source" lists such assets under "Stock". No starter item is a placeholder: each plays or renders in full offline. [NEW]

#### Scenario: Offline first run
- **WHEN** the app is started for the first time with no network and no Gateway
- **THEN** the Sounds panel lists the bundled music and sound effects, the Stickers panel lists the bundled stickers, and each can be previewed

#### Scenario: Use a starter track
- **WHEN** a bundled music track is added to the timeline
- **THEN** the project's media library gains one audio asset with provenance `source: "bundled"` and its licence, and the clip plays offline

#### Scenario: Same item in two projects
- **WHEN** the same bundled track is used in two projects on one device
- **THEN** its bytes are stored once and both projects play it

### Requirement: AI-generated asset provenance
Assets produced by generation features (`generation-providers.Generated outputs become media assets`, `agent-workflows`, `prompt-to-video-workflow`, `film-production`, `ai-editing-tools.Generated asset provenance`) SHALL enter the library as managed assets in an automatically maintained folder "AI generated", with provenance `{source: "ai", provider, model, role, prompt, negativePrompt?, seed?, referenceAssetIds[], jobId, cost?, created_ms}`, an "AI" badge on the card, and the filter source "AI-generated". The Info panel shows the provenance and offers "Copy prompt" and "Regenerate" (which opens the originating tool pre-filled; needs a connected Gateway and scope `jagentchill.generation.run`). Provenance is preserved through duplicate, package export/import and cross-project paste, and is the input of the export provenance metadata and AI label owned by `export-share`. [CAPCUT CC-020] [NEW]

#### Scenario: Generated image arrives
- **WHEN** an image generation job succeeds for the open project
- **THEN** the image appears in "AI generated" with the AI badge and its Info panel shows provider, model and prompt

#### Scenario: Provenance survives package round trip
- **WHEN** the project is exported as a package and imported
- **THEN** the asset's provenance fields are unchanged

### Requirement: Slate media
The library SHALL support assets of `type: "image"` flagged `kind: "slate"`: placeholder stills rendered locally by the client, with no Gateway, for the draft timelines of `script-studio.Draft timeline from a script` (which owns the slate layout and text). A slate is a PNG at the project canvas size capped at 1920 px on the long side, stored as a managed asset in an automatically maintained folder "Slates" with provenance `{source: "slate", scriptId, sceneId, shotId?, versionId}`; rendering the same shot of the same script version again reuses the existing asset by content hash. Slate assets show a "Slate" badge, are listed by the source filter "Slate", are excluded from the "Unused" filter's clean-up suggestions while their script link exists, and are otherwise ordinary image assets: they can be placed, trimmed, exported and packaged. "Replace" on a slate clip with real footage or generated media follows `timeline-editing.Replace media` and keeps the clip's `scriptLink`; when no element references a slate any more it stays in the "Slates" folder until the user deletes it. An export that still contains slate clips lists the pre-flight item "{n} placeholder shots are still in the timeline" per `export-share.Pre-flight validation` and proceeds when the user chooses "Export anyway". [NEW]

#### Scenario: Draft timeline creates slates offline
- **WHEN** a draft timeline is created from a 12-shot script with no Gateway connected
- **THEN** 12 image assets with `kind: "slate"` exist in the "Slates" folder and each shot's clip references one

#### Scenario: Replace keeps the link
- **WHEN** a slate clip is replaced with a video asset
- **THEN** the clip shows the video, keeps its `scriptLink`, and the slate asset remains in the library with usage count 0

#### Scenario: Re-render is deduplicated
- **WHEN** the same script version is turned into a draft timeline twice in one project
- **THEN** the library holds one slate asset per shot

### Requirement: Import from paired devices
With a connected Gateway, the Media tab SHALL offer "From devices": (1) browse and import assets from the media libraries of the user's other projects synced through the Gateway and from paired devices per `cross-device-sync.Content-addressed media blobs`; (2) "Send from phone": on desktop and web a QR code and short code are shown that open the JAgentChill mobile app's send screen for this project — an already paired phone with scope `jagentchill.media.write` sends the picked photos and videos directly; an unpaired phone first completes pairing per `device-pairing-signing` and no media is accepted before pairing is approved; a `viewer` phone is refused with "Your role on this host is view-only". The code carries no secret: it holds only the project id and the Gateway id. Transfers are content-addressed, resumable in 4 MiB chunks, show per-file progress on both devices and land as managed assets (originals on desktop and web) with provenance `source: "device"`. Without a Gateway the entry is shown disabled with the explanation "Connect a host to import from your devices". [CAPCUT CC-021, CC-023] [NEW]

#### Scenario: Send from a paired phone
- **WHEN** a paired phone scans the code and sends 3 videos
- **THEN** the 3 videos appear in the desktop project's library with progress during transfer

#### Scenario: Interrupted transfer
- **WHEN** the connection drops at 60 % of a file and returns
- **THEN** the transfer resumes from the last completed 4 MiB chunk and completes

#### Scenario: Unpaired phone
- **WHEN** an unpaired phone scans the code
- **THEN** it is taken through pairing and no file is accepted until the pairing is approved

### Requirement: Media library scope and the global Library screen
A media library SHALL belong to exactly one project: the Media tab lists only the open project's assets, and there is no device-wide media browser. The global Library screen is owned by `app-shell-navigation.Library screen`, and project media is not one of its categories; its Saved sounds and Stickers categories are owned by `audio-editing.Saved sounds` and `stickers-shapes`, and the bundled starter content of `media-library.Bundled starter library` is browsed in the Sounds and Stickers panels. Media is reused across projects without a shared browser: copying clips between projects carries their assets (`timeline-editing.Clipboard`), "From devices" lists assets of other synced projects (`media-library.Import from paired devices`), re-importing the same file is deduplicated by content hash on the device (`project-storage.Stored record layout`), and duplicating a project shares its bytes. Deleting an asset in one project never affects another project that uses the same bytes. [NEW]

#### Scenario: No Media category
- **WHEN** the user opens the global Library screen
- **THEN** its category rail contains no Media entry

#### Scenario: Libraries are separate
- **WHEN** a file is imported into project A and project B is opened
- **THEN** project B's Media tab does not list the file

#### Scenario: Reuse does not duplicate bytes
- **WHEN** the same 1 GiB file is then imported into project B
- **THEN** device storage usage grows by less than 1 MiB, and deleting the asset in project A leaves project B's clip playing

### Requirement: Media library on mobile
On mobile the media library SHALL be presented as a bottom sheet or full-screen picker with tabs Device (photo library), Project (this project's library with search, filters and folders) and Library (stock and connectors). It is reached from the entry points owned by `mobile-editor` — the main-track "+" of `mobile-editor.Add-clip button`, the Overlay group of `mobile-editor.Overlay group` and the root toolbar "Media" entry — and what a pick does depends on the entry: from the main-track "+" the picked visual items are inserted into the main track with `mainInsert` in pick order; from the Overlay group they are added as overlay clips at the playhead; from "Media" they are only added to the project library. Items are added by tap; multi-pick uses numbered badges. Asset actions (Info, Rename, Relink, Delete, Export original files) are offered from a long-press action sheet. Screen recording, drag-and-drop from the operating system and external file references are not offered on mobile. [NEW]

#### Scenario: Add overlay from project library
- **WHEN** the user opens Overlay → Add overlay, switches to the Project tab and taps an image
- **THEN** the image is added as an overlay clip at the playhead and the main track is unchanged

#### Scenario: Main-track plus
- **WHEN** the user taps the main-track "+" with the playhead in the second half of the first clip and picks videos B then A
- **THEN** B then A are inserted after the first clip on the main track and the clips after them shift right

#### Scenario: Long-press actions
- **WHEN** the user long-presses an asset in the Project tab
- **THEN** an action sheet offers Info, Rename, Relink, Export original files and Delete
