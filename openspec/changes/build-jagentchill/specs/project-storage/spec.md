## ADDED Requirements

### Requirement: Storage port and per-platform stores
All client persistence SHALL go through a `StoragePort` interface implemented once per platform, so that `editor-core` and UI code never call a storage technology directly. The three implementations are: **web** — records (projects — each holding its media asset records per `project-storage.Stored record layout` — folders, snapshots, backups, saved sounds, scripts, cached workflow documents) in IndexedDB, and media files, thumbnails, covers and caches in the Origin Private File System (OPFS); **desktop** — a user-visible project library folder on disk reached only through the Electron preload bridge (`desktop-app.Project library folder bridge`), with plain files as the only durable records and a purely derived SQLite index, as defined in `project-storage.Desktop project library folder` (IndexedDB and OPFS are not used for project data on desktop); **iOS and Android** — records in an app-private SQLite database, media files, thumbnails and covers in the app's documents directory and caches in the app's caches directory. The port exposes the same operations and the same error types (`NotFound`, `QuotaExceeded`, `Corrupt`, `Unavailable`) on every platform, implements content-hash reference counting itself on every platform (it does not depend on hard links), and one shared conformance test suite MUST pass against all three implementations. The desktop renderer never receives general file-system access: every bridge operation is on the allow-list of `desktop-app.Preload bridge and IPC allowlist` and takes project ids, asset ids or grant ids, never arbitrary paths. Host-side storage is JAgentChill Server's own (`server-api.Host data store`: its SQLite database and blob directory under `<dataDir>/`, separate from the OpenClaw Gateway's state directory `<dataDir>/gateway-state/`) and is reached only through the server's API. Local storage needs no device role: the roles of `device-pairing-signing` apply only to host resources. [PORT ST-001, ST-002, ST-003] [NEW]

#### Scenario: Same behaviour on every platform
- **WHEN** the StoragePort conformance suite runs against the IndexedDB + OPFS, the desktop library-folder and the SQLite + file-system implementations
- **THEN** every test passes on all three

#### Scenario: Web layout
- **WHEN** a project with one media asset is saved on web
- **THEN** the project record and the asset metadata are in IndexedDB and the asset bytes are an OPFS file

#### Scenario: Desktop layout
- **WHEN** a project with one media asset is saved on desktop with the default library location
- **THEN** `<library>/<projectId>/project.json` and one file under `<library>/<projectId>/media/` exist, `library.sqlite` has one row for the project, and neither IndexedDB nor OPFS holds project data

#### Scenario: Storage unavailable on web
- **WHEN** the browser provides no IndexedDB or no OPFS (for example a private mode that disables them)
- **THEN** the app shows a blocking screen "Storage is not available in this browser mode" and creates no project

### Requirement: Desktop project library folder
On desktop the project library SHALL be one folder, by default `~/Movies/JAgentChill` on macOS, `%USERPROFILE%\Videos\JAgentChill` on Windows and `$XDG_VIDEOS_DIR/JAgentChill` (falling back to `~/Videos/JAgentChill`) on Linux, with this layout, in which every durable record is a file and the SQLite index is purely derived (`project-document.Per-project files and rebuildable index`): one directory per project `<projectId>/` holding `project.json` (the canonical project document — including its media asset records, library folders, tags and provenance — plus the `local` section with the project's folder id, trash state, view state and, per asset, storage kind, external path, size, modified time, decode flags and proxy state), `media/<assetId>.<ext>` (managed media), `thumbnails/`, `cover.jpg` or `cover.png`, `snapshots/<snapshotId>.json` and `backups/<sourceVersion>-<time_ms>.json` (with `<…>.report.json` beside a migration backup); the library-wide files `folders.json` (the project-folder tree), `scripts/<scriptId>.json` (one file per script with its versions and its own `trash` field), `saved-sounds.json`, `luts/<lutId>.cube` with `luts.json`, `brand-kits.json`, `styles.json` and `templates/<templateId>/` (user templates, each with its own `trash` field in its manifest); `library.lock` (single-writer lock of the running app instance); and `library.sqlite`, which holds ONLY data derivable from those files — the project list (id, name, duration, modified time, folder id, trash state, cover hash, schema versions), per-project asset rows copied from `project.json`, content-hash reference counts, external-file grants and search indexes — and is never the only home of any datum. Caches live outside the library in the operating system's cache directory for the app. Every file is written to a temporary name in the same directory, flushed to disk and renamed, so no reader ever sees a partial file. The files are the source of truth and `project.json` is self-sufficient for its project: when `library.sqlite` is missing, unreadable, fails its integrity check, or is older than any `project.json` or library-wide file, the index is rebuilt by scanning the project directories and the library-wide files — reference counts are recomputed from the `media.assets` of every `project.json`; an external-file grant is re-created for each `local.media[…].externalPath` of a project in this library after the path is re-validated by size and modified time (a path that fails is offline with "Relink…", per `media-library.Offline media and relink`); nothing is prompted. A rebuild of a library of 1 000 projects MUST finish within 10 s on the reference desktop and shows "Rebuilding library index…" while it runs. A project directory copied into the library by the user appears in the Projects list after the scan with all of its assets known; when its id collides with an existing project it is listed as a copy under a new id. The location is changed from `settings-preferences.Project library location`: moving copies every file to the new folder, verifies each copied file by size and SHA-256, switches the app to the new folder, and only then deletes the old copy; a failure or cancellation at any point leaves the old library in use and removes the partial copy. A destination that is not empty, is inside the current library, or has less free space than the library size plus 50 MiB is refused with a message naming the reason. When the library folder is unreachable at start (for example an unplugged drive), the app shows a blocking dialog "Project library not found at {path}" with "Retry", "Locate library…", "Create a new library here" (enabled only when the path is writable) and "Quit", writes nothing until one is chosen, and shows no project as deleted. On one machine the app is single-instance (`desktop-app.Single instance`); a library whose `library.lock` belongs to a live process on another machine (a network volume) opens read-only with the banner "This library is open on another computer". [NEW]

#### Scenario: Move the library
- **WHEN** the user moves a 12 GiB library to an empty folder on another volume with 20 GiB free
- **THEN** every file exists at the destination with matching SHA-256, the Projects list is unchanged, and the old folder no longer contains the library

#### Scenario: Move interrupted
- **WHEN** the destination volume is removed while 40 % of the files are copied
- **THEN** the app keeps using the old library, reports "The library was not moved" with the reason, and every project still opens

#### Scenario: Library drive missing
- **WHEN** the library is on an external drive that is not connected at start
- **THEN** the blocking dialog is shown, "Create a new library here" is disabled, and no new empty library is created at that path

#### Scenario: Index rebuilt
- **WHEN** `library.sqlite` is deleted while the app is closed and the app is started
- **THEN** the Projects list shows every project that has a valid `project.json`, with the same names, folders and trash state as before
- **AND** opening any of them shows every asset with its name, tags, library folder and provenance, managed media is online, external media whose file is unchanged on disk is online without a prompt, and scripts, saved sounds, user LUTs and brand kits are listed as before

#### Scenario: External file changed while the index was lost
- **WHEN** the index is rebuilt and an external file recorded in `local.media` now has a different size
- **THEN** no grant is created for it, the asset is offline with "Relink…", and every other asset is unaffected

#### Scenario: Project directory copied in
- **WHEN** the user copies a project directory from another library into this one while the app is closed
- **THEN** after start the project is listed, its clips resolve to their asset records from its own `project.json`, and its managed media plays

#### Scenario: Nothing durable lives only in the index
- **WHEN** the conformance suite deletes `library.sqlite` after every mutating operation of the storage port and rebuilds it
- **THEN** every read operation returns the same result as before the deletion

### Requirement: Stored record layout
The stores SHALL hold: `projects` — one record per project id that is the canonical project document of `project-document.Document envelope` (which contains the media asset records `media.assets`, the library folders `media.folders` and `media.luts`) plus its device-local `local` section (`project-document.Device-local section`: current scene, timeline view state, project folder id, trash state, and per asset the storage kind, external path, grant id, decode flags and proxy state); `folders` (the project-folder tree, a library-wide record); media files addressed by `<projectId>/<assetId>` with a content-hash index and a reference count per hash, so identical bytes are stored once per device and are removed when the count reaches zero; `snapshots` and `backups` (per project); `saved-sounds` (global, key `user-sounds`: `{sounds[], lastModified_ms}`, each sound carrying `savedAt_ms`; this store, not the preferences port, holds saved sounds for `audio-editing.Saved sounds`); `scripts` and `workflow-cache` as defined in `project-storage.Document kinds in the client store`; the library-wide user LUT library, brand kits and saved styles named by `project-document.Per-project files and rebuildable index`; `thumbnails` and `covers` as blobs or files. There is NO separate `media-metadata` store on any platform at schema 32: an asset record exists only inside its project's document, so asset rename, tags, folders, relink and removal are ordinary document changes that produce state patches, are undoable, are synced and travel in packages. Trash state is not a separate store: a trashed project carries `local.trash`, and a trashed script or template carries the `trash` field of its own record (`project-storage.Trash retention storage`). Thumbnails and covers MUST NOT be embedded in a project record as data URLs. Runtime-only data (decoded audio buffers, object URLs, preview-layer patches, selection, undo history) is never persisted. Every index over these stores (the project list ordered by modified time descending, per-project asset rows, content-hash reference counts, search indexes) is derived from the records and is rebuilt from them when missing or older than a record; records without metadata are returned flagged unreadable instead of being dropped. [PORT ST-001, ST-003, ST-004] [NEW]

#### Scenario: Runtime data is stripped
- **WHEN** a project with a decoded audio buffer and a selection is saved
- **THEN** the stored record contains neither, and reloading yields the same canonical document

#### Scenario: Saved sounds are global
- **WHEN** a sound is saved in one project and another project is opened
- **THEN** the sound is listed in the second project's saved sounds

#### Scenario: Shared bytes on every platform
- **WHEN** the same 100 MiB file is imported into two projects on one device
- **THEN** its bytes are stored once with reference count 2, on web, desktop and mobile alike, and deleting one project leaves the file readable from the other

#### Scenario: Asset record lives in the project document
- **WHEN** an asset is renamed in the media library
- **THEN** the change is a `replace` patch at `/media/assets/@<assetId>/name` of the project document, one undo step, and no record outside the project record changes

#### Scenario: Local section is saved with the record but not hashed
- **WHEN** the user scrolls the timeline of a synced project and the record is saved
- **THEN** `local.timelineViewState.scrollLeft` is stored in the same record, the document hash is unchanged and no state patch is emitted

### Requirement: Document kinds in the client store
The `StoragePort` SHALL store three document kinds with the same atomic-write, quota and conformance rules: `project` (the video project, defined in this spec), `script` (script documents and their versions; the data model, autosave triggers and sync are owned by `script-studio.Local-first storage, sync and offline use`, which uses the autosave timings and failure handling of `project-storage.Autosave` and `project-storage.Autosave failure and storage-full handling`), and `workflow` (a read-only cache of the last fetched workflow document for the 50 most recently opened workflows per device, evicted least-recently-opened first; workflows are authored on the server per `agent-workflows.Storage, RPC surface and Gateway dependency`). Scripts are listed in Settings storage usage under "Scripts" and the workflow cache under "Caches". Deleting a script follows the typed trash of `projects.Trash` (kind `script`). [NEW]

#### Scenario: Script survives without a host
- **WHEN** a script is edited on a device with no host and the app is restarted
- **THEN** the script opens with the edit present

#### Scenario: Workflow cache bound
- **WHEN** a 51st workflow is opened on a device
- **THEN** the cache holds 50 workflow documents and the least recently opened one is no longer cached

### Requirement: Time base and timestamp conventions
Every persisted media time SHALL be an integer number of ticks at 120000 ticks per second; the loader rounds any non-integer time found in stored data to the nearest integer tick (half away from zero) and normalises a marker stored as a bare number to `{time}`. Frame rates are stored as `{numerator, denominator}` reduced by their greatest common divisor, each at most 1 000 000; frame-to-tick conversion is never done by the storage package and follows `render-engine.Frame-rate rationals and frame snapping`. Wall-clock timestamps written by schema 32 and above are Unix UTC milliseconds in fields suffixed `_ms`; no ISO-string timestamp exists at schema 32: the v31→v32 step converts the classic ISO strings and removes them, and the pre-migration backup keeps the originals (`project-document.Time values and timestamps`). [PORT ST-011]

#### Scenario: Non-integer tick repaired
- **WHEN** a stored element has `startTime` 4000.4
- **THEN** the loaded element has `startTime` 4000

#### Scenario: Millisecond timestamps
- **WHEN** a project is saved at schema 32
- **THEN** its metadata contains `created_ms` and `updated_ms` as integers

#### Scenario: Rational is reduced
- **WHEN** a stored frame rate is `{numerator: 60000, denominator: 2000}`
- **THEN** the loaded frame rate is `{numerator: 30, denominator: 1}`

### Requirement: Schema versioning
Each project record SHALL carry an integer `schemaVersion`; the first JAgentChill schema is 32 and the current version is a single constant in the storage package. Version detection for records without the field: an explicit numeric `version` (classic) is used; else 1 when a non-empty `scenes` array exists; else 0. Migrations from schema 32 upward (33 and above) are additive: they never delete, rename or repurpose persisted fields, and superseded fields are kept (`project-document.Evolution rules`). The v31→v32 step is NOT additive: it converts the classic shape into the typed schema-32 document, and its non-additive changes are exactly the eight listed in `project-document.Classic values without a counterpart` (removal of the flat `params` map, `fontWeight` type, `textDecoration` replacement, `bookmarks` → `markers`, ISO dates → `_ms`, `effectType` → `effects[0].type`, data-URL thumbnails moved out, `currentSceneId` and `timelineViewState` moved under `local`); the pre-migration backup keeps the original bytes. `minReaderSchemaVersion` (the lowest app schema that is able to read and write the record without loss) is computed by the writer on every save per `project-document.Minimum reader version`; it is 32 for every schema-32 document. A record whose `schemaVersion` is greater than the app's current version and whose `minReaderSchemaVersion` is at most the app's current version opens read-write: the app preserves every field it does not know byte-for-value on save and leaves `schemaVersion` unchanged. A record whose `minReaderSchemaVersion` is greater than the app's current version is read-only to this app: it is never modified and never opened in the editor; it is listed with the badge "Needs newer app" and offers only Info, Export package and Delete. Schema skew between a device and a host (the server's `maxSchemaVersion`, the confirmation before a schema-raising push) is defined in `cross-device-sync.Schema version skew`. [PORT ST-006] [NEW]

#### Scenario: Legacy detection
- **WHEN** a record has no version field and a non-empty `scenes` array
- **THEN** it is treated as version 1

#### Scenario: Newer additive project keeps unknown fields
- **WHEN** an app at schema 32 opens a record with `schemaVersion` 33, `minReaderSchemaVersion` 32 and an element field the app does not know, edits another element and saves
- **THEN** the saved record still has `schemaVersion` 33 and the unknown field with its original value

#### Scenario: Newer incompatible project
- **WHEN** a record has `minReaderSchemaVersion` one greater than the app's current version
- **THEN** the record is left byte-identical, the project cannot be opened and its card shows "Needs newer app"

### Requirement: Migration chain
The storage package SHALL contain the ordered chain of pure transformer functions v0→v1 through v30→v31 with the behaviour of OpenCut classic, plus v31→v32 (`project-storage.Schema 32 migration`) and every subsequent step, each with frozen copies of the defaults of its era and each covered by unit tests using fixtures of the source version. The classic steps are: v0→v1 add `scenes` with one "Main scene" and `currentSceneId`; v1→v2 build `metadata` and `settings` from flat fields (era defaults fps 30, canvas 1920 × 1080, background `#000000`, blur intensity 10), load tracks from the legacy per-scene timeline data, convert "media" tracks to video tracks, transform legacy text and audio tracks to their typed forms, apply legacy project bookmarks to the main scene; v2→v3 add `metadata.duration`; v3→v4 normalise text `fontWeight` (`normal`→"400", `bold`→"700", numeric 100–900 kept, anything else →"400"); v4→v5 provider-prefixed sticker ids (`icons`, `emoji`, `flags`, `shapes`; an id without a known prefix is assigned the provider whose catalogue contains it, and an id found in no catalogue is left unchanged — its presentation is defined in `stickers-shapes.Missing sticker state`); v5→v6 bookmark numbers → `{time}`; v6→v7 text `backgroundColor` → `background {color, cornerRadius 0, paddingX 8, paddingY 4, offsetX 0, offsetY 0}`; v7→v8 `sourceDuration = trimStart + duration + trimEnd` for video and audio; v8→v9 `background.enabled` (true unless colour is `transparent`); v9→v10 version bump; v10→v11 `transform.scale` → `scaleX`/`scaleY` including animation channels; v11→v12 merge position x/y channels into a vector channel; v12→v13 mask `feather`, `inverted`, stroke fields into `mask.params` (`strokeColor` `#ffffff`, `strokeWidth` 0); v13→v14 split-mask anchor as explicit x/y; v14→v15 sticker `intrinsicWidth`/`intrinsicHeight` = 200; v15→v16 `sticker` tracks → `graphic` tracks; v16→v17 mask `strokeAlign: "center"`; v17→v18 volume linear gain → dB clamped −60…+20, missing → 0 dB; v18→v19 `canvasSizeMode: "preset"`, `lastCustomCanvasSize: null`; v19→v20 `isSourceAudioEnabled: true`; v20→v21, only for a background of type `blur`: `blurIntensity × 5` when the stored value is a finite number, otherwise 50 (the 50 is not scaled); v21→v22 animations to bindings plus per-component channels, colours as linear-RGB components; v22→v23 all times seconds → integer ticks and `fps` number → rational by the single rule of `media-library.Media probing` (a standard rate matched within 0.01, otherwise `round(fps × 1000) / 1000` reduced); v23→v24 scene `tracks` array → `{overlay, main, audio}`; v24→v25 position vector binding → `positionX`/`positionY`; v25→v26 repair scenes corrupted by the previous step; v26→v27 custom mask `path` JSON string → typed point array; v27→v28 round every media time to integer ticks; v28→v29 copy built-in element fields into `params` keeping the sources; v29→v30 flatten animation bindings and channels into a map keyed by property path; v30→v31 mask type `custom` → `freeform`. Unlike the classic v24→v25 step, no step leaves a scene's tracks in a non-`{overlay, main, audio}` shape. [PORT ST-006] [NEW]

#### Scenario: Full chain from v1
- **WHEN** a v1 fixture project with legacy timeline data including a legacy text track is migrated
- **THEN** the result validates against the schema-32 Zod schema, all times are integer ticks, the text track is a typed `text` track and its tracks have the `{overlay, main, audio}` shape

#### Scenario: Volume conversion
- **WHEN** a v17 element has linear volume 0.5
- **THEN** after v17→v18 its volume is −6.02 dB (±0.01)

#### Scenario: Unknown sticker id
- **WHEN** a v4 sticker id has no known prefix and is in no bundled catalogue
- **THEN** after v4→v5 the id is unchanged and the migration of the project succeeds

#### Scenario: Blur background at v20
- **WHEN** v20 projects with a `blur` background store `blurIntensity` 10, no `blurIntensity`, and `NaN`
- **THEN** after the v20→v21 step they store 50, 50 and 50 (10 × 5; the unscaled default; the unscaled default), and a project whose background type is `color` is unchanged by that step

### Requirement: Schema 32 migration
The v31→v32 step SHALL implement exactly the mapping of `project-document.Classic v31 mapping` (tables `catalog.md` §13.1–§13.6 of `project-document`) and the outcomes of `project-document.Classic values without a counterpart` (§13.7); this requirement owns only the mechanics and restates no field. The step is one pure function `migrateV31toV32(record, mediaRecords, {now_ms, newId})` in the storage package: `record` is the classic v31 project record, `mediaRecords` are the classic media-metadata records of that project (joined by project id from the classic store or bundle), and `newId` is the id source (a seeded generator in tests, so that output is reproducible). It applies, in this order:

| Order | Stage | Mapping applied |
|---|---|---|
| 1 | Envelope and metadata | §13.1: `format`, `schemaVersion: 32`, `minReaderSchemaVersion: 32`, ISO dates → `_ms`, data-URL thumbnail → thumbnail store |
| 2 | Settings | §13.1: background `type` → `kind`; adoption flags; `useProxies`; `colorPipeline`; the blur background value multiplied by the classic-canvas factor `k` |
| 3 | Scenes and tracks | §13.1: `kind`, `compoundBackground`; classic `bookmarks` → `markers` with new ids; track `locked`, `pinned`, `transitions: []`, and `solo`, `volume`, `pan`, `ducking` by track type |
| 4 | Element common fields | §13.2 |
| 5 | Classic `params` map → typed fields | §13.3 and §13.4: every key of the flat `element.params` map is converted to its typed field, reading `params` first, then the stale pre-v29 top-level copy, then the default; the `params` map is then removed from every element except graphics, where it keeps only the definition's keys |
| 6 | Classic effect elements and clip effects | §13.4: `{type: "effect", effectType, params}` → an effect element with one `effects[]` entry `{id: newId(), type: effectType, kind: "effect", enabled: true, params}` and `target: "beneath"`; `kind: "effect"` added to every clip effect entry; `blur` intensities multiplied by `k` |
| 7 | Negative scale → `flip` | §13.3 flip rows, evaluated on `params["transform.scaleX"]` / `["transform.scaleY"]` (else the stale top-level copy) and on the animation channel of the same path |
| 8 | Masks and animations | §13.5: mask defaults; animation paths renamed to the schema-32 paths (`transform.positionX` → `transform.position.x`, …, effect-element `params.<key>` → `effects.<newId>.params.<key>`); leftover `animations.bindings` / `animations.channels` removed |
| 9 | Media | §13.6: each classic media-metadata record becomes one entry of `media.assets[]` plus `local.media[id]`; `fps` by the rule of `media-library.Media probing`; data-URL `thumbnailUrl` → thumbnail store |
| 10 | Device-local data | §13.1: `currentSceneId` and `timelineViewState` move under `local`; `local.folderId: null`, `local.trash: null` |
| 11 | Repair and report | the result is run through `project-document.Document validator` in `mode: "load"`; every repair of `project-document.Load-time repair` and every dropped value of §13.7 is written to the migration report `{path, classicKey, reason}` |
| 12 | Strict validation | the repaired result MUST pass the validator in strict mode; otherwise the step fails and `project-storage.Migration runner` leaves the stored record unchanged |

The step changes nothing that the mapping does not name, creates no field that is not in `project-document.Canonical field list`, and for the same inputs and id source produces a byte-identical canonical document on every platform. The migration report is stored with the pre-migration backup (`project-storage.Backup before migration`), which keeps the original bytes of everything the step replaces or drops. `contentHash` and the device-local `canDecode` and `needsProbe` values are filled lazily: on first load of each asset one background job computes the SHA-256, runs `media-library.Media probing` and persists the result by non-history updates, clearing `needsProbe`.

Tests (all required, run in CI on the reference runtime): (a) one fixture test per row of §13.1–§13.7; (b) a **round-trip test on real classic fixtures** — project and media-metadata records exported from the OpenCut classic app at the commit pinned in `THIRD_PARTY_NOTICES.md` (not hand-written JSON), together covering every classic element type, a standalone blur effect element, a clip blur effect, every classic mask type including freeform, a keyframe channel on every classic animation path, a negative static scale, an all-negative and a mixed-sign scale channel, bookmarks, colour, gradient and blur backgrounds, library audio with `sourceUrl`, text with background and each `textDecoration` value, and 16:9, 9:16 and 1:1 canvases: each fixture is migrated, MUST validate in strict mode, and a test-only inverse projection `toClassicView(document)` that rebuilds the classic `params` map and classic animation paths from the typed fields MUST equal the fixture for every key that §13 maps without a value change, while every key that §13 changes (flip, `fontWeight`, `textDecoration`, blur × `k`, dates) MUST equal the value the table prescribes; (c) for each of those fixtures, frames rendered from the migrated document at three committed times MUST match reference frames rendered by the classic renderer within the tolerance of `render-engine.Golden-frame determinism` (blur fixtures on non-16:9 canvases: SSIM ≥ 0.95, because the classic anisotropic blur is not reproduced); (d) determinism — migrating the same fixture twice with the same id seed yields identical bytes. [PORT ST-006] [NEW]

#### Scenario: Classic params map becomes typed fields
- **WHEN** a v31 video element has `params = {"transform.positionX": 120, "transform.scaleX": 1.5, "transform.rotate": 30, "opacity": 0.8, "volume": -6}` and a stale top-level `opacity: 1`
- **THEN** after migration it has `transform.position.x = 120`, `transform.scale.x = 1.5`, `transform.rotation = 30`, `opacity = 0.8`, `volume = -6`, and no `params` key

#### Scenario: Classic effect element validates and renders the same
- **WHEN** a v31 project with a standalone effect element `{type: "effect", effectType: "blur", params: {intensity: 15}}` on a 1920 × 1080 canvas is migrated
- **THEN** the element has `effects = [{id: <new>, type: "blur", kind: "effect", enabled: true, params: {intensity: 15}}]`, `target = "beneath"`, no `effectType` and no element `params`; the document passes strict validation; and its rendered frame matches the classic reference frame within the golden tolerance

#### Scenario: Negative static scale becomes a flip
- **WHEN** a v31 element has `params["transform.scaleX"] = −1.5` with no scale animation
- **THEN** after migration it has `transform.scale.x = 1.5` and `flip.horizontal = true`, and its rendered frame differs from the classic rendering by no more than the golden tolerance of `render-engine.Golden-frame determinism`

#### Scenario: Mixed-sign scale animation is tolerated
- **WHEN** a v31 element has `transform.scaleX` keys 1 at 0 s and −1 at 2 s
- **THEN** after migration the channel is on the path `transform.scale.x` with unchanged key values, `flip.horizontal = false`, the document validates, and the element renders mirrored after the zero crossing

#### Scenario: Bookmarks become markers
- **WHEN** a v31 scene has `bookmarks = [{time: 360000, note: "cut"}, {time: 120000}]`
- **THEN** after migration the scene has no `bookmarks` key and `markers = [{id, time: 120000, color: 1}, {id, time: 360000, note: "cut", color: 1}]` with two new ids

#### Scenario: Renamed track is pinned
- **WHEN** a v31 overlay track is named "B-roll"
- **THEN** after migration it has `pinned = true`, while a track still named "Video track" has `pinned = false`, and both have `transitions = []`, `solo = false`, `volume = 0` and `pan = 0`

#### Scenario: Font weight and decoration
- **WHEN** v31 text elements store `fontWeight` "bold", "300" and "heavy", and one stores `textDecoration: "line-through"`
- **THEN** after migration they store 700, 300 and 400, and that element has `strikethrough = true`, `underline = false` and no `textDecoration`

#### Scenario: Media records enter the document
- **WHEN** a v31 project has two media-metadata records, one with a `thumbnailUrl` data URL
- **THEN** after migration `media.assets` has two entries sorted by id, `local.media` has two entries with `storage = "managed"`, one thumbnail blob exists, no data URL remains in the record, and the pre-migration backup still contains the original records

#### Scenario: Classic asset is re-probed once
- **WHEN** a migrated video asset without `hasAudio` and `fps` is first loaded
- **THEN** it is probed once, `hasAudio`, `fps`, codecs and `contentHash` are persisted, `local.media[id].needsProbe` is cleared, and a second load does not probe it

#### Scenario: Round trip on a real classic fixture
- **WHEN** the committed classic fixture "all-element-types" is migrated and `toClassicView` is applied to the result
- **THEN** every `params` value and animation channel of the fixture that §13 maps unchanged is equal in the rebuilt view, the migration report lists only the outcomes of §13.7, and the document passes strict validation

#### Scenario: Step fails closed
- **WHEN** a v31 record cannot be brought to a strictly valid document (for example `scenes` is not an array)
- **THEN** the step fails, the stored record is unchanged, and the project is marked "Migration failed" per `project-storage.Migration runner`

### Requirement: Migration runner
The runner SHALL open the stores through the `StoragePort` using its typed, named-parameter operations (the classic defect of positional adapter calls that addressed the wrong database and wrote nothing MUST NOT be reproduced; a test asserts that after a run each migrated record is readable from the `projects` store under its id at the target version). It runs on first storage access after app start for every project below the current version and again on project load for that project. Per project: back up (see `project-storage.Backup before migration`), apply each step in order in memory, validate the final result with `project-document.Document validator` in strict mode (the v31→v32 step has already applied and reported load-time repairs, `project-storage.Schema 32 migration`), and write once atomically, storing the migration report beside the backup; when the report is not empty the first open shows the notice of `project-document.Classic values without a counterpart`; a step returning `skipped` stops that project's chain and leaves the record unchanged. A failure in one project (thrown error or validation failure) leaves that project's stored record unchanged, marks it "Migration failed" with the failing step and error text available in Info, and does not stop the other projects. The run is idempotent and resumable: re-running after an interruption migrates only projects still below the current version. Autosave is paused for a project while it is migrating. [PORT ST-006] [NEW]

#### Scenario: Migrated record is written to the right store
- **WHEN** the runner migrates a v31 project with id `p1`
- **THEN** reading `p1` from the `projects` store returns the project at the current version

#### Scenario: Failure isolation
- **WHEN** three projects need migration and the second throws in step v21→v22
- **THEN** the first and third are at the current version, the second is byte-identical to its pre-run record and is marked "Migration failed" at step v21→v22

#### Scenario: Interrupted run
- **WHEN** the app is terminated after one of five projects was migrated and is restarted
- **THEN** the remaining four are migrated and the first is not processed again

### Requirement: Migration progress dialog
While the runner is processing, the app SHALL show a modal dialog "Updating your projects" with the current project name, "N of M", a progress bar, and no dismiss control; it stays visible for at least 1000 ms to avoid flicker and closes automatically. When any project failed, a summary lists the failed projects with "Copy details" and "Restore backup" per project. When no project needs migration the dialog is never shown. [PORT ST-007]

#### Scenario: Minimum display time
- **WHEN** a migration run completes in 120 ms
- **THEN** the dialog remains visible until 1000 ms have elapsed since it appeared

#### Scenario: Nothing to migrate
- **WHEN** every project is at the current version
- **THEN** no migration dialog appears

### Requirement: Backup before migration
Before writing a migrated project, the runner SHALL store a backup of the pre-migration record (the record bytes only; media files are not duplicated) labelled with the source version and time; on desktop it is the file `<library>/<projectId>/backups/<sourceVersion>-<time_ms>.json`. Backups are kept for 30 days or until 3 newer backups of the same project exist, whichever comes first, and are counted in storage usage. "Restore backup" replaces the project record with the backup and marks the project so the runner migrates it again on next load. When there is not enough storage for the backup after the reserve of `project-storage.Quota evaluation`, the project is not migrated and is reported as "Not enough storage to update this project". [NEW]

#### Scenario: Backup exists after migration
- **WHEN** a v20 project is migrated
- **THEN** a backup labelled v20 exists and equals the pre-migration record

#### Scenario: Restore
- **WHEN** "Restore backup" is chosen for a migrated project
- **THEN** the stored record equals the backup and is at version 20 until the runner processes it again

#### Scenario: No space for backup
- **WHEN** available storage after reserve is smaller than the record
- **THEN** the project remains at its old version and the storage message is shown

### Requirement: Autosave
The save manager SHALL start when a project finishes loading and mark the project dirty on every change notification from scenes, timeline, markers, project settings (including settings-only changes), cover, media library and folders. A dirty project is saved 800 ms after the last change (debounce). Changes that arrive while a save is in flight are coalesced into exactly one follow-up save started when the in-flight save completes. Saving is skipped while the project is loading or migrating. Each save recomputes `metadata.duration` and the modified timestamp, never includes preview-layer data, and is atomic: the new record is written beside the last good record and replaces it only after the write is acknowledged, so a reader sees either the previous or the new record, never a mixture, and a failed write never damages the last good record. `flush()` saves immediately and resolves when storage has acknowledged; it is called on exit, on app background, before snapshot, before package export and before sync upload. A save that fails for a reason other than `QuotaExceeded` retries after 2 s, 4 s and 8 s; after the third failed retry the save state is `failed` and the project stays dirty in memory. View-state-only changes (zoom, scroll, playhead, expanded keyframe lanes) are written with their own 300 ms debounce and do not update the modified timestamp. The save indicator and its strings are owned by `projects.Autosave and unsaved-work protection`. [PORT P-030] [CAPCUT CC-003]

#### Scenario: Debounce
- **WHEN** three edits occur at t = 0, 300 and 600 ms and no further edits follow
- **THEN** exactly one save starts at t = 1400 ms (±50 ms)

#### Scenario: Coalescing
- **WHEN** five edits arrive while a save is in flight
- **THEN** exactly one additional save runs after the in-flight save finishes and the stored record contains all five edits

#### Scenario: Settings-only change
- **WHEN** only the background colour is changed
- **THEN** the project is saved within 800 ms (+ save duration) and the colour is present after reload

#### Scenario: Scroll does not touch modified time
- **WHEN** the user only scrolls the timeline
- **THEN** the project's modified timestamp is unchanged

#### Scenario: Retry schedule
- **WHEN** a save fails with `Unavailable` at t = 0 and storage keeps failing (fake clock)
- **THEN** retries start at t = 2 s, 6 s and 14 s, and after the third retry fails the save state is `failed`, the stored record equals the last successfully saved record, and the in-memory project still holds the unsaved edits

### Requirement: Autosave failure and storage-full handling
A save that cannot be completed SHALL never overwrite or delete the last good copy and SHALL never discard the in-memory project. When a record save fails with `QuotaExceeded` (including a record save refused by the 5 MiB floor of `project-storage.Quota evaluation`): (1) the save manager evicts caches once per `project-storage.Cache management` and retries once; (2) when the retry fails, the editor shows a blocking error dialog "Storage is full — your recent changes are not saved" stating the time of the last successful save, with the actions "Free up space" (opens `settings-preferences.Personal storage page`), "Empty trash ({size})" (shown when the trash is non-empty), "Export project package" (see `projects.Project package export`, writing to a location the user picks) and "Keep editing"; (3) after "Keep editing" a non-dismissable banner with the same text and actions stays at the top of the editor until a save succeeds; (4) automatic snapshots are suspended, and the save is retried every 30 s and immediately after any deletion, trash emptying or cache clearing; (5) `flush()` rejects with `QuotaExceeded` after one attempt instead of waiting; (6) Exit project, window close, app quit and switching project ask "Leave without saving? Changes since {time} will be lost" with "Stay" (default) and "Leave"; on mobile, moving to the background keeps the in-memory project for as long as the process lives and posts no dialog. When the save state is `failed` for any other reason the same dialog rules (6) apply with the text "Changes are not saved". When a save succeeds again the banner is removed and automatic snapshots resume. [NEW]

#### Scenario: Save with 3 MiB available
- **WHEN** 3 MiB are available, no cache is evictable and a 2 MiB project record is saved
- **THEN** the blocking "Storage is full" dialog is shown, the stored record is byte-identical to the last good save, and the editor still shows the unsaved edits

#### Scenario: Exit while unsaved
- **WHEN** the save state is storage-full and the user chooses Exit project
- **THEN** the "Leave without saving?" dialog is shown, and choosing "Stay" keeps the project open with its unsaved edits

#### Scenario: Save resumes after the trash is emptied
- **WHEN** the banner is shown and the user chooses "Empty trash (3.0 GiB)"
- **THEN** a save starts immediately, succeeds, the banner disappears and automatic snapshots resume

#### Scenario: Flush rejects
- **WHEN** package export calls `flush()` while storage is full
- **THEN** `flush()` rejects with `QuotaExceeded` within one save attempt and the package export reports that unsaved changes are not included

### Requirement: State patch emission
Every committed change to a project document SHALL be emitted by the client as a state patch, not as a command: an ordered list of entries in exactly the format of `project-document.State patch format` (`{op: "add" | "remove" | "replace", path, value?, before?}`, with `@<id>` path segments for id-keyed arrays) over the canonical project document, together with `commandType` and `label` for display, the base revision and the resulting revision. The canonical document is the form of `project-document.Canonical JSON serialisation`: the document without its `local` section, so the current scene, view state, folder, trash state and per-device media state never appear in a patch (`project-document.Device-local data is never synced`); preview-layer data is not part of it either. Asset records are part of the document, so media-library commands (import, rename, tag, folder, relink of the synced part, removal) emit ordinary patches under `/media`. One undo step (including its ripple, magnet, linkage and pruning side effects) produces exactly one patch; undo and redo produce patches of their own. Numbers in a patch are serialised by the writer and copied by appliers; applying a patch never executes editor command logic. The patch is computed by `editor-core` from the document before and after the step and handed to the save manager, which (a) persists the new record per `project-storage.Autosave` and (b) appends the patch to a per-project pending-patch journal in the client store; the journal survives restarts, is consumed by `cross-device-sync.Operation log` and is truncated when the server acknowledges the revision. For a project that is not synced the journal is not kept. Applying the journal's patches in order to the base revision MUST yield a document byte-identical in canonical form to the saved record; when it does not, the client discards the journal and falls back to a full snapshot per `cross-device-sync.Revisions and snapshots`. The same emission applies to documents of kind `script`. [NEW]

#### Scenario: One step, one patch
- **WHEN** a ripple delete removes one clip and shifts two others
- **THEN** exactly one patch is emitted containing the removal and both `startTime` replacements, with `commandType` and a display label

#### Scenario: Patch application is engine-independent
- **WHEN** the same patch sequence is applied to the same base document in V8, JavaScriptCore and Hermes
- **THEN** the three canonical documents are byte-identical

#### Scenario: Journal survives a restart
- **WHEN** a synced project is edited offline three times and the app is restarted
- **THEN** the pending-patch journal holds three patches and replaying them on the base revision equals the saved record

#### Scenario: View state is not patched
- **WHEN** the user only zooms and scrolls the timeline
- **THEN** no patch is emitted

### Requirement: Version snapshots
The app SHALL keep version snapshots of each project record (media bytes are referenced, not copied): one automatic snapshot when a project is opened and has changed since its last snapshot, one at the snapshot interval while the project has been saved since the last snapshot, one on Exit project, and manual snapshots through "Save version" with a label of 0–80 characters. The interval is the preference "Version snapshot interval" of `settings-preferences.Editing default preferences`: 1, 5, 10 (default) or 30 minutes, or Off (no interval snapshots). Retention: the most recent 20 automatic snapshots per project (preference "Automatic snapshots to keep", 10–200) and up to 50 manual snapshots per project (creating the 51st requires deleting one). There is one "Version history" panel: it lists local snapshots with time, label, kind, duration and thumbnail and offers Preview (opens read-only), Restore, Duplicate as new project, Rename and Delete; for a synced project "Save version" additionally creates a host named version with the same label per `cross-device-sync.Named versions`, and named versions created on other devices are listed in the same panel with a device badge. Restore first takes an automatic snapshot of the current state, then replaces the project record and reloads the editor with an empty undo history; restoring a synced project requires the edit lease and is recorded as a new revision per `cross-device-sync.Single-writer edit lease`. Media assets referenced by any retained snapshot are not purged from storage while that snapshot exists; assets missing from the current library are restored to it on Restore. Automatic snapshots are suspended while the save state is storage-full (`project-storage.Autosave failure and storage-full handling`). The registry action `project.save-version` ("Save now") flushes autosave and creates a manual snapshot as defined here (`keyboard-shortcuts.Action registry`). [NEW]

#### Scenario: Periodic snapshot
- **WHEN** a project is edited continuously for 25 minutes with the default interval
- **THEN** at least 2 automatic snapshots were created during that time

#### Scenario: Interval off
- **WHEN** the interval preference is Off and a project is edited for 25 minutes without leaving it
- **THEN** no interval snapshot is created and the snapshot taken on Exit project still is

#### Scenario: Restore is reversible
- **WHEN** the user restores a snapshot from yesterday
- **THEN** the project equals that snapshot and the version history contains a new automatic snapshot of the state just before the restore

#### Scenario: Automatic retention
- **WHEN** a 21st automatic snapshot is created with the default retention
- **THEN** the oldest automatic snapshot is deleted and manual snapshots are untouched

#### Scenario: Restore without the lease
- **WHEN** a synced project is open read-only because another device holds the edit lease
- **THEN** Restore is disabled with the tooltip naming the device that holds the lease

### Requirement: Crash recovery
The app SHALL write a session marker `{projectId, opened_ms, clean: false}` when a project opens and set `clean: true` on Exit project or orderly app shutdown. On app start, a marker with `clean: false` causes the Projects screen to show "JAgentChill closed unexpectedly — Reopen '{name}'" with Reopen and Dismiss. Reopening loads the last autosaved record; when that record fails schema validation or cannot be read, the app offers the most recent snapshot or migration backup ("Restore latest version from {time}") and never opens a partially written record. When the last save succeeded, at most the edits of the last 800 ms plus one in-flight save are lost; when the save state was `failed` or storage-full at the time of the crash, everything since the last successful save is lost and the reopen prompt states that time. No undo history is recovered. Interrupted recordings and imports are recovered per `media-library.Recording` and leave no orphan files: at start the app deletes media files that no asset record of any project's `media.assets` (nor any retained snapshot) references and that are older than 24 hours. [NEW]

#### Scenario: Unexpected termination
- **WHEN** the app process is killed 5 s after the last edit and restarted
- **THEN** the reopen prompt is shown and the reopened project contains that edit

#### Scenario: Corrupt latest record
- **WHEN** the stored record fails validation on reopen
- **THEN** the app offers to restore the latest snapshot and opens it on confirmation

#### Scenario: Crash while storage was full
- **WHEN** the app is killed while the storage-full banner was shown and the last successful save was at 10:02
- **THEN** the reopen prompt reads that changes after 10:02 were not saved and the reopened project equals the 10:02 record

#### Scenario: Orphan cleanup
- **WHEN** a media file that no project's `media.assets` references is 25 hours old at app start
- **THEN** the file is deleted

### Requirement: Persistent storage request
On web, the app SHALL request durable storage on the Projects screen when `navigator.storage.persist` exists and storage is not already persisted: browsers that grant without a prompt are asked silently; browsers that show a permission prompt first get the dialog "Don't lose your projects" explaining why, with "Allow" (calls `persist()`) and "Not now" (records the dismissal as a UI preference and suppresses the dialog for 30 days). When `navigator.storage.persisted()` is false after the request, the Projects screen shows a banner "This browser can delete your projects. Install the app or turn on sync" with the actions "Install" (the browser's install prompt, shown where the browser offers one), "Sync with a host" (opens pairing per `device-pairing-signing`) and "Hide for 7 days"; the banner cannot be hidden for longer than 7 days at a time, and `settings-preferences.Personal storage page` shows "The browser can clear this storage" with a "Request again" button. Desktop (library folder) and mobile (app-private storage) are durable and make no request. [PORT ST-008] [NEW]

#### Scenario: Prompting browser
- **WHEN** the Projects screen opens in a browser that prompts for persistence, with non-persisted storage and no recorded dismissal
- **THEN** the "Don't lose your projects" dialog is shown and choosing Allow triggers the browser permission prompt

#### Scenario: Dismissed
- **WHEN** the user chose "Not now" 5 days ago
- **THEN** the dialog is not shown

#### Scenario: Silent grant
- **WHEN** the browser grants persistence without a prompt
- **THEN** no dialog and no banner are shown and storage is reported as persisted

#### Scenario: Not persisted
- **WHEN** the browser reports `persisted() = false` after the request
- **THEN** the banner is shown, and 8 days after "Hide for 7 days" it is shown again

### Requirement: Quota evaluation
`evaluateStorageCapacity(bytes)` SHALL allow a media write when `available − reserve ≥ bytes`, where the reserve is 50 MiB (52 428 800 bytes) and `available` is quota − usage from `navigator.storage.estimate()` on web, the free space of the library volume on desktop, and the free space of the app's storage volume on mobile; the reserve is never consumed by media writes. When no estimate is obtainable the write is allowed and any quota error from the store is handled at write time. Before rejecting, evictable cache is released per `project-storage.Cache management`. A rejection returns the required bytes and the available bytes after the reserve, and every caller shows the one message "Not enough storage for {name} ({size}). {available} available." with the actions "Empty trash ({size})" (shown when the trash is non-empty) and "Manage storage" (opens `settings-preferences.Personal storage page`). Project record saves, snapshots and backups are evaluated against the same reserve but are allowed to use it down to a floor of 5 MiB so that editing work is still saved when media space is exhausted; below the floor the record save takes the storage-full path of `project-storage.Autosave failure and storage-full handling`. External references on desktop are not evaluated. Sizes shown to the user use binary units (KiB, MiB, GiB) with one decimal. [PORT ST-009]

#### Scenario: Inside the reserve
- **WHEN** 120 MiB are available, no cache is evictable and a 100 MiB file "a.mov" is evaluated
- **THEN** the write is rejected with the message "Not enough storage for a.mov (100.0 MiB). 70.0 MiB available."

#### Scenario: No estimate
- **WHEN** the platform provides no storage estimate
- **THEN** the evaluation allows the write

#### Scenario: Record save under pressure
- **WHEN** 30 MiB are available and a 2 MiB project record is saved
- **THEN** the save succeeds

#### Scenario: Record save at the floor
- **WHEN** 6 MiB are available, no cache is evictable and a 2 MiB project record is saved
- **THEN** the save is refused because it would leave less than 5 MiB, and the storage-full dialog is shown

#### Scenario: Offer to empty the trash
- **WHEN** an import is rejected for quota and the trash holds 3 GiB
- **THEN** the message offers "Empty trash (3.0 GiB)"

### Requirement: Atomic media writes with rollback
Saving a media asset SHALL write the file first and the asset record (an entry of the project's `media.assets` plus its `local.media` entry, saved with the project record) second; when either step fails the file is removed, no asset record remains, and a store quota error is surfaced as `QuotaExceeded`. Files are written to a temporary name and renamed on completion so a crash never leaves a truncated file under the asset's name. Deleting a project permanently removes its record, its media metadata, its media files (decrementing shared-content reference counts), thumbnails, cover, snapshots, backups, pending-patch journal, external-file grants and per-project caches, and deletes the per-project containers themselves (the IndexedDB rows and OPFS directory on web, the `<library>/<projectId>/` directory on desktop, the SQLite rows and directory on mobile) instead of leaving them empty. [PORT ST-010, P-023]

#### Scenario: Metadata failure
- **WHEN** the file write succeeds and the metadata write fails
- **THEN** the file is removed and the asset is not listed after reload

#### Scenario: Project deletion leaves nothing
- **WHEN** a project is permanently deleted
- **THEN** no object-store rows, OPFS directory, library sub-directory or SQLite rows keyed by that project id remain

### Requirement: External file references on desktop
On desktop, assets with `storage: "external"` SHALL be read in place without copying, through the privileged, range-capable scheme `jagentchill-file://<grantId>/<name>` served by the main process as defined in `desktop-app.Project library folder bridge`. A grant is an unguessable 128-bit id created when the user selects a file in a system dialog or drops it on the app, mapped to exactly one absolute path, held in the grant table of the library index (derived data), revocable, and removed with the project. The durable record of an external reference is `local.media[assetId]` in `project.json` (`externalPath`, `externalSize`, `externalMtime_ms`, `externalGrantId`); when the index is rebuilt, a grant with the recorded id is re-created for each such path of a project in the user's own library whose size and modified time still match, exactly as `project-storage.Desktop project library folder` defines, and a `project.json` that arrives from outside the library (a package, a synced snapshot, a copied directory whose `local` names a path the user never selected on this machine) never creates a grant: `local` is not part of packages or sync, and for a copied directory the path is granted only when it validates by size and modified time AND the file's content hash equals the asset's `contentHash`. The renderer never receives the path's file handle or general file-system access; a URL with an unknown grant id, or a request for a path other than the granted one, is answered 404. The reference stores path, size and modified time under `local.media`, and the content hash in the asset record. Project packages and cross-device sync treat external assets by content hash, embedding or uploading the bytes when required; when the server runs on the same machine the bytes are linked instead of uploaded per `cross-device-sync.Local blob linking`. Availability checks follow `media-library.External file references`. Web and mobile have no external references. [NEW]

#### Scenario: Path outside the allow-list
- **WHEN** a project record references an external path for which no grant exists (for example a tampered record)
- **THEN** the scheme answers 404 and the asset is shown offline

#### Scenario: Linked file is not copied
- **WHEN** a 4 GiB file is added as an external asset
- **THEN** the library folder grows by less than 1 MiB

#### Scenario: Seek inside a large linked file
- **WHEN** the decoder requests the byte range of a keyframe at 3 GiB into the linked file
- **THEN** the scheme answers 206 with exactly that range

#### Scenario: Copied project directory cannot point at an arbitrary file
- **WHEN** a project directory copied into the library names `externalPath = /etc/hosts` for an asset whose `contentHash` is that of a video
- **THEN** no grant is created, the asset is offline with "Relink…", and the file is never read beyond the hash check

### Requirement: UI preference storage
App-level UI preferences SHALL be stored through a preferences port (web and desktop: localStorage of the app origin; mobile: the platform key-value store) as versioned JSON entries with per-key migrations, read synchronously before first paint where the platform allows. Preferences include: projects view mode, sort key and order; media view mode and sort; panel sizes; the timeline toggles `timeline.snapping`, `timeline.ripple`, `timeline.magnet`, `timeline.linkage`, `timeline.previewAxis`, `timeline.freeLayer` and `timeline.autoFollow`; preview settings (guides, overlays, grid); sticker settings (category, recents); saved easing presets; dismissal flags (persistence dialog and banner, onboarding); theme. Each timeline toggle is one stored value shown on two surfaces — the timeline toolbar and `settings-preferences.Editing default preferences` — and there is no separate start-up default that resets it. Preferences are never stored inside project records and are not part of project packages. A corrupt or unparsable entry is replaced by its defaults without blocking startup. [PORT ST-005]

#### Scenario: Toggle survives restart
- **WHEN** ripple editing is switched on and the app is restarted
- **THEN** ripple editing is on

#### Scenario: One value, two surfaces
- **WHEN** Auto snapping is switched off in the timeline toolbar
- **THEN** the same row in the editing preferences shows it off without a restart

#### Scenario: Corrupt entry
- **WHEN** the stored panel-sizes entry is not valid JSON
- **THEN** the app starts with default panel sizes and overwrites the entry

### Requirement: Cache management
Derived data — filmstrip frames, waveform summaries, proxies, render cache, font atlases, stock previews, AI tool results (analysis tracks, person mattes used by body effects), synthesised slow-motion frames of `speed-retime.Smooth slow motion`, reverse-playback caches and derived audio — SHALL live in one cache store separate from project data (desktop: the operating system's cache directory for the app), keyed by content hash, and MUST be reproducible from originals. The cache has one budget (default 10 GiB on desktop, 2 GiB on web, 1 GiB on mobile; user-adjustable from 256 MiB to 100 GiB on `settings-preferences.Personal storage page`) enforced by least-recently-used eviction that runs when the budget is exceeded and before any media write or record save that would otherwise fail the quota evaluation; entries in use by the open project's visible range and by running jobs are not evicted. No other capability defines a separate cache budget. The storage page shows usage by category (Projects, Media, Scripts, Proxies, Thumbnails and filmstrips, Waveforms, Render cache, AI results, Snapshots and backups, Trash) and per project, with "Clear" per cache category and "Clear all caches"; clearing never removes originals, project records, snapshots or backups. On mobile the operating system is allowed to purge the cache directory and the app regenerates entries on demand. Derived assets that the document references by id (`kind: "derived"`: cutout mattes, vocal stems; `project-document.Media asset records`) are project media, not cache entries, and are never evicted; image and video mezzanines are stored with the media (`media-library.Undecodable media handling`). [NEW]

#### Scenario: Clear proxies
- **WHEN** the user clears the Proxies category
- **THEN** proxy usage is 0, all projects still open, and proxies are regenerated per `media-library.Proxy media` rules when needed

#### Scenario: Eviction before rejecting an import
- **WHEN** an import needs 800 MiB, 300 MiB are available after reserve and 2 GiB of evictable cache exist
- **THEN** cache entries are evicted and the import succeeds

#### Scenario: Budget enforcement
- **WHEN** the cache reaches 2 GiB + 1 byte on web with the default budget
- **THEN** least-recently-used entries are evicted until usage is at or below 2 GiB

#### Scenario: Entries in use survive
- **WHEN** eviction runs while a proxy is being played in the open project
- **THEN** that proxy is not evicted

### Requirement: Trash retention storage
A trashed item of a client-side kind of `projects.Trash` (`project`, `template`, `script`) SHALL keep its record, media, snapshots and cover intact with its trash state `{kind, deleted_ms, originalFolderId?}` — for a project the device-local field `local.trash` of `project-document.Device-local section` (trashing a project on one device changes no canonical document and emits no patch; removal from the server is `cross-device-sync.Deletion, trash and removal from the Gateway`), for a script or template the `trash` field of its own record; its caches are released immediately. Host-side kinds (`workflow-run`, `film`, `film-panel-asset`) are stored in the server trash per `cross-device-sync.Gateway space` and are only listed by the client. Expiry 30 days (2 592 000 000 ms) after `deleted_ms` is evaluated per `projects.Trash` and performs the full deletion of `project-storage.Atomic media writes with rollback`. Trashed items count toward storage usage under "Trash". [NEW]

#### Scenario: Caches released on trash
- **WHEN** a project with 1 GiB of proxies is moved to trash and no other project uses those proxies
- **THEN** cache usage decreases by 1 GiB while the project's media usage is unchanged

#### Scenario: Trashed project is intact
- **WHEN** a project with 2 snapshots is trashed and restored 29 days afterwards
- **THEN** its record, media and both snapshots are present

### Requirement: Storage integrity and concurrency
Only one editor instance SHALL write a given project on a device: opening a project that is open in another window or tab of the same profile opens it read-only with the banner "This project is open in another window" and a "Take over" button that transfers write ownership (the other instance becomes read-only after flushing). Ownership uses a lock with a 10 s heartbeat that expires after 30 s without heartbeat. Every project load runs `project-document.Document validator` in `mode: "load"` after migration; what is repaired, cleared or dropped, in which order, the notice text and when the repair is persisted are exactly those of `project-document.Load-time repair` (this requirement defines no drop rule of its own), while structural errors that cannot be repaired fail the load per `projects.Project not found and load errors`. A malformed `local` section is reset to defaults and never fails a load. This device-local lock is independent of the cross-device edit lease of `cross-device-sync.Single-writer edit lease`. [NEW]

#### Scenario: Second tab
- **WHEN** a project open in tab A is opened in tab B
- **THEN** tab B is read-only with the banner, and edits in tab A continue to save

#### Scenario: Take over
- **WHEN** "Take over" is pressed in tab B
- **THEN** tab A flushes its pending save and becomes read-only, and tab B becomes editable

#### Scenario: Owner killed
- **WHEN** tab A is killed without releasing the lock
- **THEN** tab B gains write ownership no more than 30 s after tab A's last heartbeat

#### Scenario: One bad element
- **WHEN** a record contains one element with an unknown type
- **THEN** the project opens without that element and the notice "1 items were skipped while loading" is shown

### Requirement: Package and file formats
JAgentChill SHALL use exactly these product file formats, each written and read by the owning requirement and registered with the operating system per `desktop-app.File associations` and `app-shell-navigation.Deep links and file types`:

| Extension | Content | Container | Owner |
|---|---|---|---|
| `.jagentchill` | project package (MIME `application/vnd.jagentchill.project+zip`) | ZIP (ZIP64 above 4 GiB) | `projects.Project package export` / `projects.Project package import` |
| `.jctpl` | template package | ZIP | `templates.Template and pack package format` |
| `.jcpack` | preset pack (LUTs, fonts, stickers, templates, presets) | ZIP | `templates.Template and pack package format` |
| `.jcscript` | script document with versions | UTF-8 JSON | `script-studio.Export` / `script-studio.Import` |
| `.jcworkflow` | workflow definition | UTF-8 JSON | `agent-workflows.Import and export file format` |
| `.jckeys` | shortcut preset | UTF-8 JSON | `keyboard-shortcuts.Import and export of presets` |

The three JSON formats have one final extension each; a file with the earlier compound name (`*.jcscript.json`, `*.jcworkflow.json`, `*.jckeys.json`) is accepted on import only, recognised by its content, and is never written. Common rules for every format: a top-level `format` identifier and integer `formatVersion`; a file with a higher `formatVersion` than the app supports is refused with "This file was created with a newer version of JAgentChill. Update the app to open it."; ZIP packages carry `manifest.json` listing every entry with byte size and SHA-256, entries are verified on read, entry names are relative paths without `..`, absolute paths, drive letters or symbolic links (a violating archive is refused as a whole per `security-privacy.Untrusted file and pack handling`), the uncompressed total is checked against `project-storage.Quota evaluation` before anything is written, and reading and writing are streamed so that peak additional memory stays below 256 MiB for any package size; a cancelled or failed import removes everything it wrote. No other extension is produced by the product for these contents. [PORT N-018] [NEW]

#### Scenario: Path traversal entry
- **WHEN** a `.jagentchill` archive contains an entry named `../../evil`
- **THEN** the import is refused, nothing is written and the message "The file is not a valid JAgentChill project" is shown

#### Scenario: Newer format version
- **WHEN** a `.jcscript` with `formatVersion` greater than the app supports is opened
- **THEN** it is refused with the update message and no script is created

#### Scenario: Large package memory bound
- **WHEN** a 10 GiB `.jagentchill` package is imported on the reference desktop of `diagnostics-quality.Performance budgets`
- **THEN** the peak resident-memory increase of the app during the import is below 256 MiB

### Requirement: Classic bundle ingestion
The storage package SHALL ingest the OpenCut classic data bundle defined in `projects.OpenCut classic data import` without ever writing to classic stores: for each entry of `projects.json` it detects the version per `project-storage.Schema versioning`, joins legacy per-scene timeline records from `timelines/` when present, and feeds the record to the chain of `project-storage.Migration chain` up to the current schema under a new project id (the classic id is kept in `metadata.importedFrom {source: "opencut-classic", id}`); media files from `media/<projectId>/` are written as managed assets through `project-storage.Atomic media writes with rollback` after the quota evaluation of the bundle's total media size, with their classic media-metadata records passed to the v31→v32 step, which converts them into `media.assets` and `local.media` per `project-storage.Schema 32 migration`; `saved-sounds.json` is merged into the `saved-sounds` store (entries with an id already present are skipped); `local-storage.json` keys are handed to their owners — `opencut-keybindings` to `keyboard-shortcuts.Persistence and migration of bindings`, `graph-editor-presets` to `keyframe-animation.Saved easing presets`, and `timeline-store`, `preview-settings`, `panel-sizes`, `assets-panel`, `projects-view-mode`, `stickers-settings` and the theme to `project-storage.UI preference storage` through per-key migrations — and every other key is ignored. A project whose chain fails is skipped with the failing step recorded; the others are still ingested. A media entry missing from the bundle yields an offline asset. Ingestion is transactional per project: a failure or cancellation removes that project's partially written record and media. [PORT ST-006] [NEW]

#### Scenario: Mixed versions
- **WHEN** a bundle containing a v12 project and a v31 project is ingested
- **THEN** both exist at the current schema version with new ids and their media online

#### Scenario: Missing media entry
- **WHEN** a bundle's project references an asset whose file is not in the bundle
- **THEN** the project is ingested and that asset is offline

#### Scenario: Unknown local-storage key
- **WHEN** `local-storage.json` contains `hasSeenOnboarding`
- **THEN** the key is ignored and ingestion succeeds
