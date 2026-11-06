## ADDED Requirements

### Requirement: Settings navigation structure
Opening Settings SHALL replace the app sidebar with a settings navigation column (240 px) headed by "← Back to app" and a "Search settings" field, listing two groups. This table is the only definition of the settings tree; the page id is the `[section]` value of the routes `/settings/[section]` and `/settings/host/[hostId]/[section]` (`app-shell-navigation.Route map`). Every page defines only its settings surface here; the behaviour behind each setting is owned by the capability in the last column.

| Group | Page (id) | Requirement in this capability | Behaviour owner |
|---|---|---|---|
| Personal | Preferences (`preferences`) | Appearance preferences; Accessibility preferences; Language and region preferences; Composer and agent personal preferences | `i18n-accessibility`, `chat-agent` |
| Personal | Editing defaults (`editing`) | Editing default preferences | `projects`, `timeline-editing`, `project-storage`, `workflow-diagram`, `export-share` |
| Personal | Performance (`performance`) | Performance preferences | `render-engine`, `media-library` |
| Personal | Storage (`storage`) | Personal storage page; Project library location | `project-storage` |
| Personal | Keyboard shortcuts (`shortcuts`) | Keyboard shortcuts page entry | `keyboard-shortcuts` |
| Personal | Notifications (`notifications`) | Notification preferences entry | `notifications` |
| Personal | Connections (`connections`) | Connections and devices page | `device-pairing-signing`, `desktop-app`, `cross-device-sync` |
| Personal | Privacy (`privacy`) | Privacy page | `security-privacy` |
| Personal | Updates (`updates`) | App updates settings | `updates-distribution` |
| Personal | About (`about`) | About page | `updates-distribution`, `diagnostics-quality` |
| Host | General (`general`) | Host general settings | `server-api`, `device-pairing-signing` |
| Host | Web access (`web-access`) | Host web access settings | `server-api`, `updates-distribution` |
| Host | Sessions (`sessions`) | Host sessions settings | `chat-agent` |
| Host | Agents (`agents`) | Host agents policy settings | `multi-agent-orchestration`, `agent-runtimes` |
| Host | Teams (`teams`) | Host teams settings entry | `multi-agent-orchestration` |
| Host | Runtimes & providers (`runtimes`) | Providers and model routing entry points; Provider access methods and accounts | `agent-runtimes`, `generation-providers`, `usage-tracking` |
| Host | Model routing (ORC) (`model-routing`) | Providers and model routing entry points | `orc-model-routing` |
| Host | Skills (`skills`) | Host skills settings | `skills` |
| Host | Knowledge (`knowledge`) | Host knowledge settings | this capability |
| Host | Secrets (`secrets`) | Host secrets settings | `security-privacy` |
| Host | Usage and limits (`usage`) | Host usage and limits settings | `usage-tracking`, `generation-providers` |
| Host | Workspaces (`workspaces`) | Host workspaces settings | `workspaces-terminal` |
| Host | Terminal (`terminal`) | Host terminal settings | `workspaces-terminal` |
| Host | Connectors (`connectors`) | Host connectors settings | `server-api`, `media-library`, `export-share` |
| Host | Storage (`storage`) | Host storage settings | `server-api` |
| Host | Updates (`updates`) | Host updates settings | `updates-distribution` |
| Host | Diagnostics (`diagnostics`) | Host diagnostics settings | `diagnostics-quality` |

The Host group is titled "Host <host name>" and is shown for the active host. Each row has a 14 px icon and label; a page added by the installed release carries a "New" badge until first opened. "← Back to app" and the action `app.settings.close` (run by Escape through `app.escape`, when no overlay is open and no field is being edited; `keyboard-shortcuts.Default bindings for windows and the desktop application`) return to the route the user came from. Every page that another capability refers to as "Personal ▸ <page>" or "Host ▸ <page>" is a row of this table; a CI test scans every capability spec for those two forms and fails on a page name that is not in the table. On compact form factors the navigation is a list screen and each page is a pushed screen with a back button. The Host group is replaced by a single row "Connect a host to manage host settings" when no host is connected.

Host pages SHALL be gated by the JAgentChill scopes of `device-pairing-signing.Device roles and scopes`, checked by the server on channel P — a device holds a role and `jagentchill.*` scopes only, never a scope of the underlying Gateway, and every host setting is read and written through the server's `jagentchill.*` methods: a page is readable with `jagentchill.config.read` (every role); its controls are editable with `jagentchill.config.write` (role `admin`), except Secrets, which needs `jagentchill.secrets.manage`, the terminal switch and workspace script settings, which need `jagentchill.host.exec`, and device management, which lives at `/devices` and needs `jagentchill.devices.manage`. A device without the write scope sees the page read-only with the callout "Managed by the host admin" and no add, edit or delete control. No phrase such as "operator scope" or "admin scope" is used. There is no "Advanced" page: other capabilities' references to host diagnostics resolve to Host ▸ Diagnostics, and client-only diagnostics to Personal ▸ About. [NEW]

#### Scenario: Enter and leave settings
- **WHEN** the user opens Settings from the Sessions screen and then activates "← Back to app"
- **THEN** the settings navigation replaces the sidebar while in Settings, and the Sessions screen is restored afterwards

#### Scenario: Tree content
- **WHEN** an `admin` device opens Settings while connected to a host
- **THEN** the Personal group lists the ten pages and the Host group the seventeen pages of the table, in that order

#### Scenario: No host
- **WHEN** Settings is opened in local-only mode
- **THEN** the Personal group is fully usable, including Updates and About, and the Host group shows the single "Connect a host…" row

#### Scenario: Editor role on a host page
- **WHEN** an `editor` device (which lacks `jagentchill.config.write`) opens Host ▸ Runtimes & providers
- **THEN** the page is read-only, shows "Managed by the host admin" and offers no add, edit or delete control

#### Scenario: Secrets need their own scope
- **WHEN** a device without `jagentchill.secrets.manage` opens Host ▸ Secrets
- **THEN** secret names are listed read-only and "Add secret" is absent

### Requirement: Settings page pattern
Every settings page SHALL use one pattern: a breadcrumb in the top bar; a centred column 560 px wide (760 px for pages with tables or charts); a `type/h1` title with a `text/secondary` subtitle; then `design-system.Cards and grouped setting cards` grouped under `type/title-sm` section headings. A row's control SHALL apply its change immediately (there is no page-level Save button): the row shows a pending indicator while a host write is in flight, a check for 1 s on success, and on failure reverts to the previous value within 200 ms with an error toast. Free-text fields SHALL save on blur or Enter and validate before saving. A setting that needs a relaunch SHALL say so in its description and raise a "Relaunch to apply" banner with a "Relaunch now" action. Each page SHALL have a ⋯ menu with "Reset this page to defaults" (confirmation required; undo available from the toast for 8 s); the reset never deletes records (secrets, teams, endpoints, knowledge notes, workspaces), only scalar settings. Host pages SHALL load with skeleton rows, show the error state with "Retry" on failure, and update within 2 s when another device changes the same setting. A page whose content is owned by another capability embeds that capability's screen inside this frame. [NEW]

#### Scenario: Immediate apply
- **WHEN** the user changes the theme select to Dark
- **THEN** the theme changes within 200 ms and no Save button is involved

#### Scenario: Host write failure
- **WHEN** a host setting change is rejected by the server
- **THEN** the control returns to its previous value within 200 ms and a toast states the reason

#### Scenario: Concurrent change from another device
- **WHEN** another paired device changes a host setting while this page is open
- **THEN** the row shows the new value within 2 s without reloading the page

#### Scenario: Reset page
- **WHEN** the user confirms "Reset this page to defaults" and then chooses "Undo" within 8 s
- **THEN** all values on the page return to what they were before the reset

#### Scenario: Reset keeps records
- **WHEN** the admin resets Host ▸ Secrets to defaults
- **THEN** no secret is deleted

### Requirement: Settings search
The "Search settings" field SHALL search page titles, row labels, row descriptions and declared keywords across all pages in the active locale, case-insensitive and diacritic-insensitive, returning results grouped by page. With the full index of every page loaded, results SHALL appear within 100 ms of a keystroke on the reference desktop of `diagnostics-quality.Performance budgets`. Selecting a result opens the page, scrolls the row into view and highlights it with an `accent/subtle` background for 2 s. Every row is also reachable from `keyboard-shortcuts.Command palette`. An empty result shows "No settings match "<query>"". Rows of host pages are searchable only while a host is connected. [NEW]

#### Scenario: Find a row
- **WHEN** the user types "proxy"
- **THEN** results include "Proxy media" on the Performance page, and selecting it opens that page with the row highlighted

#### Scenario: Search latency
- **WHEN** the user types one character on the reference desktop with every page indexed
- **THEN** the grouped results are shown within 100 ms

#### Scenario: No match
- **WHEN** the query matches nothing
- **THEN** the no-match message is shown and the navigation list remains available after clearing the field

### Requirement: Appearance preferences
The Preferences page SHALL contain an **Appearance** card with: Theme (System, Light, Dark; default System); UI scale (80%–150% in 10% steps, default 100%; desktop app and web; in the desktop app the minimum window size grows with the scale and the control stops at the largest value the display can hold, per `desktop-app.Windows and window state`, so scaling never switches the desktop app to the phone layout; actions `app.ui-scale.in`, `app.ui-scale.out`, `app.ui-scale.reset`); Timeline clip colours (By type, By track; default By type); and Show tooltips with shortcut hints (default on). "Reduce motion" is not a row of this card: it exists once, in the Accessibility card (`settings-preferences.Accessibility preferences`). Changes apply immediately to every open window. [PORT SH-005] [NEW]

#### Scenario: Theme options
- **WHEN** the user opens the Theme select
- **THEN** exactly System, Light and Dark are offered, and System is selected on a new installation

#### Scenario: UI scale
- **WHEN** the user sets UI scale to 120%
- **THEN** all shell text and controls render 1.2× larger in every window and the value persists across restarts

### Requirement: Accessibility preferences
The Preferences page SHALL contain an **Accessibility** card with exactly the rows that `i18n-accessibility.Accessibility preferences and conformance target` names, stored per device (`jagentchill.prefs.accessibility.*`) and applied to every open window within 500 ms; their effects are defined by `i18n-accessibility` and `design-system`, and this requirement owns only the rows:

| Row | Values | Default | Effect defined by |
|---|---|---|---|
| Reduce motion | System, On, Off | System | `i18n-accessibility.Reduced motion and flashing`, `design-system.Motion tokens` |
| Increase contrast | System, On, Off | System | `i18n-accessibility.Colour contrast`, `design-system.Contrast pair matrix` |
| Always show focus rings | on / off | off | `i18n-accessibility.Focus visibility and management` |
| Underline links | on / off | off | `design-system.Button` (`link` variant) |
| Announce agent output automatically | on / off | on | `i18n-accessibility.Live regions and status messages` |
| Hover previews auto-play | on / off | on | the library tiles of the owning capabilities; off means previews play only on activation |
| Minimum toast duration | 4 s, 8 s, 15 s, Until dismissed | 4 s | `i18n-accessibility.Timing, session and error tolerance`, `design-system.Toast with undo` |

"Reduce motion" exists only here (it is not a row of the Appearance card). The card is present on web, desktop (macOS, Windows, Linux) and mobile (iOS, Android) with the same rows; "System" follows the operating system's setting on each. The rows are indexed by `settings-preferences.Settings search` under the keywords "accessibility", "a11y", "contrast", "motion", "focus", "screen reader". [NEW]

#### Scenario: Card rows
- **WHEN** the user opens Personal ▸ Preferences
- **THEN** the Accessibility card lists the seven rows of the table with their defaults, and the Appearance card has no "Reduce motion" row

#### Scenario: Increase contrast applies everywhere
- **WHEN** the user sets "Increase contrast" to On with two windows open
- **THEN** both windows use the increased-contrast mapping within 500 ms

#### Scenario: Search finds the card
- **WHEN** the user types "contrast" in "Search settings"
- **THEN** the "Increase contrast" row is listed under Preferences

### Requirement: Language and region preferences
The Preferences page SHALL contain a **Language and region** card with: Language (System, English, Tiếng Việt, 日本語; default System), applied without restart as defined by `i18n-accessibility.Language selection`; Region format (System or a locale chosen from a combobox) controlling number, date and time formatting; Time format (System, 12-hour, 24-hour); First day of week (System, Monday, Sunday, Saturday); and Timecode display (`HH:MM:SS:FF` frames, `HH:MM:SS.mmm` milliseconds, frame count, seconds; default `HH:MM:SS:FF`). [CAPCUT CC-279] [NEW]

#### Scenario: Change the UI language
- **WHEN** the user selects 日本語
- **THEN** every visible UI string switches to Japanese without a restart and the choice persists

#### Scenario: Timecode display
- **WHEN** the user selects the milliseconds format
- **THEN** the editor's timecode and ruler labels use `HH:MM:SS.mmm` in every open project

### Requirement: Composer and agent personal preferences
The Preferences page SHALL contain a **Composer** card with: "Send key inserts a newline" (default off on desktop and web, where the send key then sends and the newline key inserts a newline; turning it on swaps the actions `session.send` and `session.newline` of `chat-agent.Composer keyboard behaviour`; on iOS and Android the on-screen return key always inserts a newline and the row applies to a hardware keyboard only); "Default send" (Steer — default —, Interrupt, Queue: what the send key does while a turn is running, per `chat-agent.Steer, queue and interrupt while running`); Default mode for new sessions (Ask, Plan, Edit, Auto, or Last used; default Last used — the four modes of `chat-agent.Composer modes`; Auto is offered only when the host permits it for this device); Default target on Home (Chat, Video, Film, or Last used; default Last used — the targets of `chat-agent.Composer targets`); Dictation language (System or a language); "Show reasoning expanded" (default off; `chat-agent` reasoning rows render expanded when on); Show the getting-started checklist (button "Show again"); Confirm before closing a window with an unsent draft (default on); and the button "Reset composer preferences", which clears the remembered composer choices of `chat-agent.Remembered composer preferences` on this device after confirmation. The choices of access method (provider account, API key or endpoint, installed CLI), model, thinking, features and skills are remembered per device and per provider by `chat-agent` and are not rows of this page. Agent permissions, approval policies and model routing are host settings, not personal ones. [JAD] [NEW]

#### Scenario: Newline preference
- **WHEN** "Send key inserts a newline" is on and the user presses the binding that normally sends
- **THEN** a newline is inserted, and the binding that normally inserts a newline sends the message

#### Scenario: Mode options
- **WHEN** the user opens "Default mode for new sessions"
- **THEN** exactly Ask, Plan, Edit, Auto and Last used are offered, and Video and Film are not

#### Scenario: Default target
- **WHEN** "Default target on Home" is set to Video and the user opens Home
- **THEN** the composer's target selector shows Video

### Requirement: Editing default preferences
The Editing defaults page SHALL contain these cards. Values of the New project and Durations cards apply to projects and elements created afterwards and never alter existing ones.
- **New project** (consumed by `projects.Create project`): Canvas ("Match first clip" — default — or one preset from the list of `projects.Canvas size presets and custom size`, shown by reference with the same names and sizes, 21:9 being 2520×1080); Frame rate ("Match first clip" — default — or one rate from the list of `projects.Frame rate`); Background (Black `#000000` — default —, a colour, or Blur with intensity 200). "Match first clip" is the only value under which `projects.Canvas and frame rate adoption from first media` runs; any fixed value counts as explicitly chosen. With no media, "Match first clip" resolves to the factory defaults of `projects.Create project`.
- **Durations**: Default still-image duration (`editing.defaultImageDuration`, 0.1–60 s, default 5 s); Default text duration (`editing.defaultTextDuration`, 0.1–60 s, default 3 s); Default sticker and graphic duration (`editing.defaultStickerDuration`, 0.1–60 s, default 5 s; `stickers-shapes`); Default effect and adjustment duration (`editing.defaultEffectDuration`, 0.1–60 s, default 5 s; used for standalone effect, filter and adjustment-layer elements of `visual-effects-filters` and `color-adjustment`); Default freeze-frame duration (`editing.defaultFreezeDuration`, 0.1–60 s, default 3 s; `speed-retime.Freeze frame`); Default transition duration (0.1–5 s, default 0.5 s; `transitions.Transition duration limits`); Default audio fade (0–10 s, default 0 s). Every value is rounded to whole frames of the project when it is used; `timeline-editing.Placement strategies` reads these values and states the same factory defaults.
- **Timeline**: Main track magnet (default on), Auto snapping (default on), Linkage (default on), Ripple editing (default off), Free layer (`timeline.freeLayer`, default off) and Scroll timeline during playback (`timeline.autoFollow`: Page — default —, Smooth, Off). Turning Main track magnet on closes existing main-track gaps of the open project at once, as `timeline-editing.Magnetic main track` defines; there is no separate "close gaps" step. On iOS and Android the rows Main track magnet and Ripple editing are not shown, because on mobile the magnet follows Free layer and there is no separate ripple switch (`mobile-editor.More sheet`). Each row is the same stored preference as the corresponding timeline toolbar toggle — one value shown on two surfaces, not a start-up default — and its behaviour is defined only by `timeline-editing.Magnetic main track`, `timeline-editing.Free layer mode`, `timeline-editing.Snapping`, `timeline-editing.Linkage`, `timeline-editing.Ripple mode` and `timeline-editing.Playhead and seeking` (auto-follow modes).
- **Saving** (behaviour owned by `project-storage.Autosave` and `project-storage.Version snapshots`): Autosave (always on; shown as read-only text "Saves 0.8 s after each change"); Version snapshot interval (1, 5, 10, 30 minutes or Off; default 10 minutes); Automatic snapshots to keep (10–200 per project, default 20; manual snapshots are kept up to the fixed 50); Trash retention (read-only: 30 days).
- **Captions and audio**: Default caption language (System or a language), Default voiceover input device (desktop and web).
- **Workflow canvas**: "Mouse wheel zooms" (default off; per device; swaps the plain-wheel and `Mod`+wheel behaviours of the canvas, `workflow-diagram`; the same stored value as the canvas view-menu item).
- **Mobile export** (iOS and Android, identical on both): "Save to Photos automatically after export" (default on; `export-share`; when photo-library permission is denied the row shows "Photo access is off" with "Open system settings").
- **Touch** (iOS and Android, identical on both): Haptic feedback (default on; `mobile-editor.Haptics`).

Number fields reject values outside their ranges by clamping on commit. [CAPCUT CC-280, CC-281] [NEW]

#### Scenario: Default image duration
- **WHEN** the default still-image duration is set to 3 s and the user adds an image to a timeline
- **THEN** the image element is 3 s long

#### Scenario: Default text duration
- **WHEN** the preference is at its default and the user adds a text element
- **THEN** the element is 3 s (360 000 ticks) long

#### Scenario: Existing projects unaffected
- **WHEN** the default frame rate is changed from "Match first clip" to 60
- **THEN** existing projects keep their frame rate, and a project created afterwards is 60 fps and does not adopt the frame rate of its first clip

#### Scenario: One value, two surfaces
- **WHEN** the user turns Ripple editing on in this page
- **THEN** the timeline toolbar's Ripple editing toggle is on in the open editor, and it is still on after a restart

#### Scenario: Snapshot retention default
- **WHEN** a project has 25 automatic snapshots and the retention row is at its default
- **THEN** the 20 most recent automatic snapshots are kept

#### Scenario: Out-of-range duration
- **WHEN** the user types 120 into the still-image duration field
- **THEN** the committed value is 60

### Requirement: Performance preferences
The Performance page SHALL contain:
- **Hardware acceleration**: Hardware decoding (default on), Hardware encoding (default on), Render interface with GPU (desktop app on macOS, Windows and Linux, default on, needs relaunch), "Force WebGL2 rendering" (default off; every platform; takes effect immediately by re-initialising the engine, per `render-engine.GPU backend selection and WebGL2 fallback`), "Allow software rendering" (default off; web and the desktop app on macOS, Windows and Linux, where a software rasteriser exists; not shown on iOS and Android; when on, a machine without a GPU previews through software WebGL2 with the notice "Preview is rendered without a GPU and will be slow", per the same requirement), and a read-only capability table (GPU adapter, WebGPU or WebGL2 path in use, per-codec hardware decode and encode availability) from `desktop-app.Hardware acceleration and media capability flags` or `render-engine.Engine capability probe and ready handshake` on web and mobile. Turning hardware decoding or encoding off forces the software path where one exists and states the limitation where none exists.
- **Proxy media** (format and generation owned by `media-library.Proxy media`): Mode (Off, Automatic, Always; default Automatic on desktop and web, Always on mobile — the Automatic rule is the one defined there) and "Use proxies for preview" (default on), which can also be switched per project in the Project info section of the project settings dialog (`projects.Project settings surface`), under the same name. There is one proxy format; no resolution choice is offered.
- **Preview quality**: the default level for new editor sessions — Auto (default), Full, 1/2, 1/4 — whose meaning and automatic lowering rule are defined only by `render-engine.Preview resolution scaling`; this page states no trigger of its own.
- **Background work**: maximum concurrent media-processing jobs on this device (1–8, default 2), pause background processing on battery (mobile and laptops, default on).
- **Content downloads**: "Download additional fonts" (default off), which gates every font download of `text-and-titles.Font loading`, and "Download on-device models" (default off until the first model download is confirmed in its picker). Both use only the content host of `security-privacy.Network egress control`; the first use on a device shows the one-time consent naming that host, and the same two switches appear on Personal ▸ Privacy as one stored value shown on two surfaces.

Cache size, cache clearing and storage locations are on Personal ▸ Storage. [CAPCUT CC-275, CC-276, CC-277, CC-278] [NEW]

#### Scenario: Automatic proxy
- **WHEN** proxy mode is Automatic and the user imports a clip that meets the Automatic rule of `media-library.Proxy media`
- **THEN** a proxy in the single proxy format is generated in the background and used for playback while export uses the original

#### Scenario: No proxy resolution row
- **WHEN** the Proxy media card is shown
- **THEN** it offers Mode and "Use proxies for preview" and no resolution select

#### Scenario: Preview quality
- **WHEN** preview quality is set to 1/2
- **THEN** the player renders at half the canvas resolution in each dimension and exports are unaffected

#### Scenario: Software decode
- **WHEN** Hardware decoding is turned off on a device that has a software H.264 decoder
- **THEN** subsequent playback uses the software path and the capability table shows "Software" for H.264 decode

### Requirement: Project library location
On the desktop app the Personal ▸ Storage page's **Storage locations** card SHALL show the Project library location — the user-visible folder that holds the project index and every project's files, as laid out by `project-storage.Desktop project library folder` and reached through `desktop-app.Project library folder bridge`; default per `desktop-app.Desktop secure storage and paths` — with the rows "Change…", "Reveal", "Default export folder" and "Reference files in place" (default on; `media-library.External file references`). A desktop install has exactly one project library (`project-storage.Desktop project library folder`): changing its location always moves it. "Change…" opens a native folder picker, verifies that the folder is writable, is not inside the current library and has free space of at least the library's size plus 1 GiB, and then asks for confirmation ("Move the library to <path>? <n> projects, <size>"); there is no option to keep old projects in the old folder. With "Reference files in place" on (the factory value on macOS, Windows and Linux alike), imported media stays where it is and the project stores a link, with the relink flow of `media-library.External file references`; each project offers the one-click "Copy media into library" (project settings ▸ Media, `media-library.External file references`), which makes that project self-contained. Moving shows a determinate progress dialog with Cancel; it copies, verifies sizes and SHA-256 of each file, switches the setting and only then deletes the old copies; a failure or cancel leaves the original location active and intact. The page also shows the cache location (OS cache directory, read-only with "Reveal"). On web the card states that data is stored in browser storage, shows usage and quota, and offers "Request persistent storage" (`project-storage.Persistent storage request`); on mobile it shows app storage usage. [CAPCUT CC-274] [NEW]

#### Scenario: Change location with move
- **WHEN** the user picks a new folder and confirms the move
- **THEN** projects and media are copied and verified, the setting switches to the new folder, the old copies are removed and no project remains listed from the old folder

#### Scenario: Move interrupted
- **WHEN** the move is cancelled at 40%
- **THEN** the original location remains active with all data intact and partial copies in the new folder are deleted

#### Scenario: Unwritable folder
- **WHEN** the chosen folder is read-only
- **THEN** the change is refused with "JAgentChill cannot write to this folder" and the setting is unchanged

#### Scenario: Not enough space
- **WHEN** the chosen folder's volume has 500 MiB free
- **THEN** the change is refused with a message stating how much free space the move needs

### Requirement: Personal storage page
Personal ▸ Storage (`/settings/storage`) SHALL show this device's storage, whose accounting, budgets and eviction are owned by `project-storage.Cache management`, `project-storage.Quota evaluation` and `project-storage.Trash retention storage`: usage by category (Projects, Scripts, Media, Proxies, Thumbnails and waveforms, Render cache, AI results, Downloaded fonts, Downloaded models, Trash) and by project (largest first, 50 per page); the Cache size limit (range and per-platform defaults exactly as defined by `project-storage.Cache management`: 256 MiB–100 GiB; default 10 GiB desktop, 2 GiB web, 1 GiB mobile); "Clear…" with a checkbox per cache category and the size each frees; the persistence status with "Request again" on web; downloaded on-device models with their sizes and Delete (`ai-editing-tools.On-device model management`, `captions-subtitles.Transcription model picker`); and the trash size with "Empty trash…". Clearing a cache category never deletes source media, projects or exports; cleared items are rebuilt on demand. Sizes refresh on open and on demand, with a "Calculating…" state for scans longer than 500 ms. [NEW]

#### Scenario: Cache limit default on web
- **WHEN** the page is opened in the web build on a new installation
- **THEN** the Cache size limit reads 2 GiB

#### Scenario: Clear cache
- **WHEN** the user clears the Proxies and Thumbnails categories
- **THEN** the displayed usage drops by the stated amounts, no project or source file is removed, and thumbnails regenerate when next shown

#### Scenario: Limit out of range
- **WHEN** the user types 100 MiB into the Cache size limit
- **THEN** the committed value is 256 MiB

#### Scenario: Delete a downloaded model
- **WHEN** the user deletes a downloaded transcription model
- **THEN** its size is freed, the model shows as "Not downloaded" in its picker and no project is changed

### Requirement: Keyboard shortcuts page entry
The Personal group SHALL include the Keyboard shortcuts page, whose content and behaviour are specified by `keyboard-shortcuts.Shortcut settings page`, `keyboard-shortcuts.Presets`, `keyboard-shortcuts.Rebinding by recording`, `keyboard-shortcuts.Reset shortcuts` and `keyboard-shortcuts.Import and export of presets`. The page follows the settings page pattern at 760 px width. [CAPCUT CC-273] [PORT KB-021]

#### Scenario: Reach the page
- **WHEN** the user opens Settings ▸ Keyboard shortcuts
- **THEN** the preset select, tabs and action list of the shortcut settings are shown

### Requirement: Notification preferences entry
The Personal group SHALL include the Notifications page, whose rows are specified by `notifications.Notification preferences`. [NEW]

#### Scenario: Reach the page
- **WHEN** the user opens Settings ▸ Notifications
- **THEN** per-category channel toggles, quiet hours and sound settings are shown

### Requirement: Connections and devices page
Personal ▸ Connections SHALL contain:
- **This device**: device name (inline edit, 1–64 characters; after pairing the host's record is authoritative, per `device-pairing-signing.Device list management`), device id and public-key fingerprint (read-only monospace with copy), platform and app version, **key protection** (read-only: "System key store" or "Protected file"), "Rotate device key…" (`device-pairing-signing.Device key rotation`; admins of each host are notified by `device.key_rotated`), and "Reset device identity…" (typed confirmation). When the operating system's key store is missing or fails — on macOS, Windows, Linux, iOS or Android alike — the key is stored in an owner-only file only after the user confirmed the `KEY_STORAGE_UNAVAILABLE` dialog of `device-pairing-signing.Per-platform device key storage` (the same rule and wording on every platform, decision D3); the card then shows the persistent notice callout "Device key stored in a file — protected only by this account's file permissions" with the action "Move the key to the system store", which is enabled once a store is available and keeps the key and every pairing.
- **Hosts**: every host this device is paired with — name, addresses with their kind (`loopback`, `lan`, `tailnet`), the path in use per `device-pairing-signing.Connection path indicator`, the connection state of `device-pairing-signing.Connection liveness and backoff`, last connected time, this device's role — with the actions Connect or Disconnect, Set as default, Rename locally and "Forget this host…", whose effect is defined only by `device-pairing-signing.Unpair from the client side`. "Add a host…" opens `/pair/start`. "Manage devices" opens `/devices`, the one place where paired devices and pending pairing requests are listed and revoked.
- **Built-in host** (desktop app on macOS, Windows and Linux): "Run the built-in host on this computer" switch, port field (1024–65535; the port of JAgentChill Server, default 18910, which is the only port clients use; the Gateway's native port is managed by the server, is always on loopback and is never a client-facing address), "Keep running in the tray" and "Launch at login" (both disabled with the visible reason "Your desktop has no system tray" on a Linux desktop without one, `desktop-app.Tray and background mode`), the current state from `desktop-app.Host status surface`, and **Network access** — a three-option select "This computer only" (default), "Tailnet", "Local network (encrypted)", with the two "Also allow…" switches — whose effect is defined only by `desktop-app.Network access setting`: every level keeps the Gateway's native port on loopback and only turns the host's product listeners on or off (`tailnet.enabled`, `lan.enabled`), without restarting the Gateway; the "Local network (encrypted)" row states "Browsers on other computers cannot use this level" with a link to Host ▸ Web access. While "Tailnet" is selected the card shows the listener state (Sign-in needed, Starting, Ready with the tailnet name, DNS name and key expiry, Sign-in expired, Failed) with "Sign in to Tailscale", "Sign in again", "Retry" and "Sign out of Tailscale"; while "Local network (encrypted)" is selected it shows the LAN listener's state, addresses, port (`lan.port`, editable) and certificate fingerprint. For a host that is not supervised by this desktop app the row is replaced by a read-only summary of its listening addresses and tailnet state with a link to the headless instructions.
- **Tailnet on this device** (the desktop app and the iOS and Android apps, with the same rows on each; absent on web): the state of this device's own embedded tailnet node — the helper of `desktop-app.Desktop tailnet proxy helper` on desktop, the module `JagentchillTailnet` of `mobile-editor.Native modules and app registration` on iOS and Android — shown as Signed out, Sign-in needed, Starting, Connected (tailnet name, node name, key expiry), Sign-in expired or Error; "Sign in to Tailscale" (opens `/pair/tailnet`); "Sign out of Tailscale", which stops the node, deletes its state and keeps every pairing (`device-pairing-signing.Tailnet login step`); and the fixed sentence of that requirement stating that the product has no relay server. This node is used only to reach paired hosts; it is separate from a host's tailnet listener. On web the card is replaced by the sentence of `device-pairing-signing.Web clients and the tailnet`.
- **Sync** (names, defaults and behaviour owned by `cross-device-sync.Per-project sync enablement`, `cross-device-sync.Media sync policy by platform` and `cross-device-sync.Library item sync`): "Sync new projects", "Download originals automatically", "Sync media over mobile data" (mobile only), "Upload limit", "Download limit", "Sync my library" and "Comment display name" (1–40 characters).

Pairing, verification, roles and revocation are specified by `device-pairing-signing`; this page is their personal settings surface. [JAD] [NEW]

#### Scenario: Rename this device
- **WHEN** the user renames the device to "Studio Mac"
- **THEN** the new name is stored locally and shown to connected hosts and other devices within 2 s

#### Scenario: Forget a host
- **WHEN** the user confirms "Forget this host…"
- **THEN** the steps of `device-pairing-signing.Unpair from the client side` run and the host disappears from the Hosts list

#### Scenario: Network access needed for pairing
- **WHEN** Network access is "This computer only" and the admin chooses "Pair a device" to pair a phone
- **THEN** the offer sheet on `/devices` shows "Pair a browser on this computer" with the link and short code and no QR code, and offers "Open Network access", which opens this card

#### Scenario: Sign out of the tailnet on a phone
- **WHEN** the user activates "Sign out of Tailscale" on an iPhone or an Android phone
- **THEN** the node stops, the Tailnet card reads "Signed out", every paired host stays in the Hosts list, and a host reachable only over the tailnet shows "Tailnet sign-in required"

#### Scenario: Tailnet card on web
- **WHEN** the page is opened in the web build
- **THEN** no sign-in control is shown and the sentence explaining that a browser cannot join a tailnet by itself is displayed

#### Scenario: Change the built-in host port
- **WHEN** the user enters a port that is in use
- **THEN** the field shows "Port in use" and the previous port stays active

#### Scenario: Sync rows on desktop
- **WHEN** the page is opened in the desktop app
- **THEN** the Sync card shows every row above except "Sync media over mobile data", with the defaults of `cross-device-sync`

### Requirement: Privacy page
Personal ▸ Privacy SHALL be the settings surface of `security-privacy`: **Network activity** — the "External hosts" table of `security-privacy.Network egress control` as it applies to this device and the active host (who connects, purpose, default, what is sent), each row with its enabling switch where one exists and the destination host name shown before enabling; **Content services** — the per-device opt-ins for outbound services this device contacts directly, each off until enabled: "Download additional fonts" and "Download on-device models" (the same stored values as on Personal ▸ Performance), both served by the one content host; the field "Content host URL" (an `https` base URL; default the publisher's static download host; a self-hosted mirror is set here, and an `admin` sets the host's own value in the content-host row of the Network activity table; every file is still verified against the SHA-256 pinned in the app manifest, so a mirror cannot substitute content); the first download on a device shows a one-time consent "Download from <content host>?"; and the OTA manifest host on iOS and Android; **Provider consents** — the "Always allow for <provider>" decisions of `security-privacy.Provider data disclosure and consent` with Revoke; **Push** — a read-only line stating whether push is enabled on this device and that a push carries only the notification kind and an opaque id, with a link to Personal ▸ Notifications; **Smart search** — "Group people in smart search" for this device's own library (default off; opt-in per library, decision B4; analysis runs on the device, and turning the switch off deletes the stored groups); **Offline mode** — a switch that blocks every outbound connection except paired hosts; and **Erase device data…**, which runs `security-privacy.Data erasure` after typed confirmation. The page never lists a host that the egress table does not contain. [NEW]

#### Scenario: Font download is off by default
- **WHEN** the page is opened on a new installation
- **THEN** "Download additional fonts" is off, the row names the host it would contact and no request has been made to that host

#### Scenario: Self-hosted content host
- **WHEN** the user sets "Content host URL" to their own mirror and downloads a catalogue font
- **THEN** the request goes only to that host, the file is accepted only when its SHA-256 equals the pinned value, and the Network activity list shows the mirror's host name

#### Scenario: Revoke a provider consent
- **WHEN** the user revokes "Always allow for <provider>"
- **THEN** the next job that would send project content to that provider shows the consent card again

#### Scenario: Offline mode
- **WHEN** Offline mode is on
- **THEN** update checks, content downloads and push registration are not attempted, and paired hosts stay connected

### Requirement: App updates settings
Personal ▸ Updates SHALL work without a host and show: the installed app version and build; "Check for updates automatically" (default on; the only request goes to the update feed of `updates-distribution.Update check privacy`); "Download updates automatically" (default on; shown in the desktop app wherever the installed package can update itself — the macOS app, the Windows installer build and the Linux AppImage; for a Linux `.deb` or `.rpm` install, or any install the app cannot replace, the row is replaced by the read-only line "Updates are installed by your package manager" and "Check now" reports the available version with the command or store to use); "Check now"; the state of the last check (Up to date, Update available <version>, Downloading <percent>, Ready to install, Failed with reason); and "Restart and install" when ready. There is exactly one release channel and no channel selector or pre-release label (`updates-distribution.Desktop automatic update`). On iOS and Android alike the page shows the store version and the over-the-air bundle version with "Check now"; on web it shows the build version and "Reload to update" when a newer build is cached. Mechanics are owned by `updates-distribution.Desktop automatic update`, `updates-distribution.Mobile over-the-air updates` and `updates-distribution.Web build delivery`. [NEW]

#### Scenario: Local-only desktop
- **WHEN** the desktop app has no host and the user opens Personal ▸ Updates
- **THEN** automatic check and "Check now" are available, and the page has no channel selector

#### Scenario: Manual check with no update
- **WHEN** the user activates "Check now" and no newer version exists
- **THEN** the state reads "Up to date" with the time of the check

#### Scenario: Check fails
- **WHEN** the update feed cannot be reached
- **THEN** the state reads "Failed" with the reason and "Check now" remains available

### Requirement: About page
Personal ▸ About SHALL show: app name, version, build and platform (`updates-distribution.Version display and compatibility status`); "Release notes" (opens `/changelog`); "Open-source licences" and the privacy notice (`security-privacy.In-app privacy and legal notices`); "Send feedback" (opens the form of `diagnostics-quality.Local feedback capture`); "Show welcome" (opens `/welcome`); and a **Diagnostics** section for this device, available without a host: client log level (Error, Warn, Info, Debug; Debug returns to Info after 60 minutes per `diagnostics-quality.Structured logging`), "Connection diagnostics" (`diagnostics-quality.Connection diagnostics screen`), "Show render performance overlay" (the action `view.performanceOverlay`), and "Export diagnostics bundle…" (`diagnostics-quality.Diagnostics bundle`). [NEW]

#### Scenario: Reachable without a host
- **WHEN** the app is in local-only mode
- **THEN** every row of the About page works, including "Export diagnostics bundle…"

#### Scenario: Debug level reverts
- **WHEN** the user sets the client log level to Debug
- **THEN** the row shows the time at which it returns to Info, and it reads Info again after 60 minutes

### Requirement: Host general settings
Host ▸ General SHALL show: Host name (inline edit, 1–60 characters; shown in the host switcher on every device); Gateway id and public-key fingerprint (read-only monospace with copy; the id and key of the host's product channel, held by the server); JAgentChill Server version (field `serverVersion` of `jagentchill.settings.host.get`; there is no `pluginVersion` field), the version of the supervised OpenClaw Gateway (`openclawVersion`) and protocol version (read-only); the **Agent engine** row, drawn from the Gateway supervision state `gateway { state, since_ms, restarts, lastExit?: { code, signal } }` of the same response and refreshed on `jagentchill.settings.host.changed` — "Running" (`ready`), "Starting" (`starting`), "Restarting" (`restarting`), "Stopped after repeated failures" (`crash_loop`), "Configuration problem" (`config_invalid`) or "Stopped" (`stopped`), each with "since <relative time>" from `since_ms`, the restart count when `restarts` is above 0 and, when `lastExit` is present, "Last exit: code <code>" or "Last exit: signal <signal>"; time zone (select; used for automations and usage periods); **Network access** — the host's exposure level and the addresses of its product listeners as a read-only summary ("This computer only", "Tailnet", "Local network (encrypted)" or both; the Gateway's native port is always on loopback and every non-loopback path is encrypted — there is no unencrypted mode), with "Change…" opening Personal ▸ Connections ▸ Built-in host on the desktop app that runs this host, and the headless instructions (`jagentchill tailnet up | down | status | logout` and `jagentchill lan up | down | status`, the server's own host CLI of `server-api.Host command-line surface`) otherwise; the **Tailnet** state of the host's tailnet listener from `jagentchill.settings.tailnet.get` (state, tailnet name, DNS name, `https` name, key expiry) with, for an `admin` device on any platform, "Sign in to Tailscale" (`jagentchill.settings.tailnet.login`, interactive or auth key as in `desktop-app.Network access setting`) and "Sign out of Tailscale" (`jagentchill.settings.tailnet.logout`), and the node name field `tailnet.nodeName` (1–63 DNS-label characters); a summary row "Web access" linking to Host ▸ Web access (`settings-preferences.Host web access settings`); an **Encoders** card showing the codec table of `server-api.Host encoder policy and codec table` — H.264, HEVC, VP9, AV1, AAC and Opus, each Available (with the encoder name and "hardware" or "software"), Download required or Unavailable (with the reason) — and, when H.264 is "Download required", the button "Download OpenH264…", which shows the Cisco notice and calls `jagentchill.settings.encoders.install` after acceptance (the same acceptance as `desktop-app.First-run OpenH264 acceptance dialog`; never asked at export time), plus the line "VP9 and AV1 export need no download"; a **Smart search** card with "Group people in smart search" (`library.peopleGrouping`, default off — grouping of faces is opt-in per library, decision B4; turning it on shows a confirmation naming what is analysed and that results stay on this host, and turning it off deletes the stored groups; the same switch for this device's own library is on Personal ▸ Privacy); an **Inbound exceptions** card with "Share links" (`http.shareLinks.enabled`, default off; `export-share.Share link through the Gateway`) and "Automation webhooks" (`http.webhooks.enabled`, default off; turning it on shows the acknowledgement "Anyone who can reach this host and knows a trigger's secret can start its automation" of `automations`), each stating that the route is not device-signed; "Push notifications for this host" (`push.enabled`, default off; `notifications.Mobile push delivery`); a warning callout when a product listener of the server listens on a globally routable address (`security-privacy.Gateway bind and exposure policy`); "Manage devices" (opens `/devices`); default project for new sessions (select or None); and a **Danger zone** card with "Export host configuration…" (the response of `jagentchill.settings.host.get` saved as JSON without secret values), "Revoke all devices…" (confirmed by typing the number of devices that will be revoked; effect per `device-pairing-signing.Revocation`) and "Reset host data…" (typed confirmation of the host name; runs `security-privacy.Data erasure` for the host). The server's data directory (`<dataDir>`, which also holds the Gateway's state directory) is shown read-only with "Copy path"; it is not changeable from the app. [NEW]

#### Scenario: Rename the host
- **WHEN** the admin renames the host
- **THEN** every connected device shows the new name in its host switcher within 2 s

#### Scenario: Revoke all devices
- **WHEN** the host has four other devices and the admin types "4" in "Revoke all devices…"
- **THEN** the four devices are revoked per `device-pairing-signing.Revocation` and must pair again

#### Scenario: Wrong count
- **WHEN** the admin types "3" while four devices would be revoked
- **THEN** the confirm button stays disabled

#### Scenario: Export configuration
- **WHEN** the admin exports the host configuration on a host with three secrets
- **THEN** the JSON file contains the settings and the three secret names and none of their values

#### Scenario: Agent engine row follows the supervision state
- **WHEN** `jagentchill.settings.host.get` returns `serverVersion` "1.4.0" and `gateway { state: "crash_loop", since_ms, restarts: 3, lastExit: { code: 1 } }`
- **THEN** Host ▸ General shows the server version 1.4.0 and the Agent engine row "Stopped after repeated failures", "3 restarts" and "Last exit: code 1"
- **AND** when `jagentchill.settings.host.changed` then reports `state: "ready"` the row reads "Running" within 2 s

### Requirement: Host web access settings
Host ▸ Web access SHALL be the settings surface for opening the web app of this host and for the origins the host accepts (`updates-distribution.Web origins`, `server-api.Product listeners and path restriction`, decisions A2 and B2). It contains:
- **Addresses** — every address at which the web app of this host can be opened, each with its kind, a reachability check (Reachable, Not reachable, Not a secure context) and a copy button: the loopback address (always; "This computer only"); the tailnet `https` name when the tailnet listener holds a browser-trusted certificate; the LAN `https` address when an installed browser-trusted certificate is served. A table states, per level of `desktop-app.Network access setting`, whether a browser on another computer can connect: This computer only — no; Tailnet — yes, with Tailscale on that computer and tailnet HTTPS certificates; Local network (encrypted) — only with an installed browser-trusted certificate (the self-signed certificate is for the native apps, which pin it).
- **LAN certificate** — the certificate served by the LAN listener from `jagentchill.settings.lan.get`: kind (Self-signed or Installed), subject, SHA-256 fingerprint with copy, expiry; "Install a certificate…" (a certificate file and its key: the key is written through the secret route and the certificate set with `jagentchill.settings.lan.certificate.set`; validation errors are shown inline — key mismatch, expired chain, no host name) and "Return to the self-signed certificate". Changing the certificate keeps paired native apps connected, because the new pin is announced over their authenticated connection.
- **Allowed origins** — the editable lists `http.allowedOrigins` and `http.allowedHosts` (at most 32 entries each; an origin is `scheme://host[:port]`), used when the web app is served from somewhere else (a static deployment or another host); a device refused for its origin is told to ask the admin to add it here.
- **Serving** — the switch "Serve the web app from this host" (`http.serveWebApp`, default on, applied at the next host restart). The web app is served from the server's static route `/jagentchill/app/*` on the product listener, which serves nothing else: the Gateway's own Control UI and canvas documents are not reachable from that origin or from any other address a client can use.

Reading needs `jagentchill.config.read`; every change needs `jagentchill.config.write` and is audited. [NEW]

#### Scenario: Which browsers can connect
- **WHEN** the level is "Local network (encrypted)" with the self-signed certificate
- **THEN** the table states that a browser on another computer cannot connect and offers "Install a certificate…"

#### Scenario: Install a certificate
- **WHEN** an admin installs a certificate whose key matches and whose chain is valid
- **THEN** the LAN address appears under Addresses as Reachable for browsers, the fingerprint row shows the new value, and paired phones stay connected

#### Scenario: Mismatched key
- **WHEN** the selected key does not match the certificate
- **THEN** the dialog shows "The key does not match the certificate" and nothing is changed

#### Scenario: Origin added for a static deployment
- **WHEN** an admin adds `https://studio.example.org` to the allowed origins
- **THEN** a web app served from that origin can open channel P to this host after pairing

### Requirement: Host sessions settings
Host ▸ Sessions SHALL contain a **Defaults** card — default agent mode for new sessions (Ask, Plan, Edit; default Edit; Auto is never a host default); "Always preview agent edits before applying" (default on); auto-archive idle sessions after (Never, 7, 30, 90 days; default 30); "Sessions running at the same time" (`limits.maxConcurrentTurns`, 1–16, default 4; `chat-agent.Concurrent session limits`); and a read-only line showing the Auto-mode session budget of `generation-providers.Budgets with hard stop` (default 5.00 USD) with a link to Host ▸ Usage and limits, where it is edited — and a **Sessions** table for administration with filter chips (Status, Mode, Access, Project, Created range — a `design-system.Date, time and weekday fields` DateRangeField —, Device), search, a Display select (Comfortable, Dense) and columns status, title with preview text, access ("Private" or "Shared with host"), tags, project chip, updated time and owner device avatar. Sessions are private by default (decision D1): the table lists only sessions the calling device is permitted to see — its own, those shared with the host, and, for an `admin`, every session's row with its title — and shows preview text and opens the transcript only for sessions the device is permitted to read; a row's ⋯ menu offers "Share with host" / "Make private" (`jagentchill.session.access.set`, `chat-agent.Session share control`) to the owner and to an `admin`, and sharing a workspace-class session is offered to `admin` devices only. The Defaults card has no "share new sessions" default: no setting makes new sessions host-shared. Rows open the session; bulk checkboxes enable Archive, Unarchive, Delete… and Add tags. The table follows `design-system.Table`. A row "Turn ratings" shows the number of stored ratings and the button "Export ratings…", which calls `jagentchill.chat.rating.export {}` (scope `jagentchill.config.read`) and saves the returned JSON file through the platform's save dialog or share sheet (`chat-agent.Turn rating`); ratings never leave the host otherwise. Approval behaviour is not a row of this page: the default approval policy is on Host ▸ Agents. Session semantics are specified by `chat-agent`. [NEW]

#### Scenario: Default mode options
- **WHEN** the admin opens "Default agent mode for new sessions"
- **THEN** exactly Ask, Plan and Edit are offered

#### Scenario: Auto-archive
- **WHEN** auto-archive is set to 7 days and a session has had no activity for 7 days
- **THEN** the session is archived on the host and leaves the Recent group on all devices

#### Scenario: Bulk archive
- **WHEN** the admin selects 5 sessions and chooses Archive
- **THEN** the 5 sessions are archived in one operation and a toast offers "Undo" for 8 s

#### Scenario: Filtered empty result
- **WHEN** the filters match no session
- **THEN** the table shows the no-results state with "Clear filters"

### Requirement: Host agents policy settings
Host ▸ Agents SHALL be the settings surface for agent policy (design D25). All agent traffic and every approval are relayed and resolved by the server on channel P, which knows the resolving device and its role; no device holds a Gateway scope, so the policies of this page are enforced on the host and not by client behaviour. Every control is editable only with `jagentchill.config.write` and is read-only with "Managed by the host admin" otherwise. It contains:
- **Who agents can call**: a three-option radio group "Same session tree" (default), "Team members", "Every agent on this host" (presets `tree`, `team`, `all`), defined by `multi-agent-orchestration.Who-can-call-whom policy presets` and applied by `multi-agent-orchestration.Policy preset admin setting`. Selecting "Every agent on this host" requires the admin confirmation defined there (it exposes other sessions' transcripts to agents) and writes an audit record.
- **Agent classes**: the one switch "Allow workspace agents for editors", bound to the host key `agents.allowWorkspaceAgentsForEditors` (default off; the only spelling of this key), whose behaviour is defined by `multi-agent-orchestration.Agent classes and creation privileges` and `security-privacy.Agent classes`; the row description states that creative agents use JAgentChill's own tools only and that workspace agents can read and write files and run commands on the host.
- **Unattended modes**: a read-only list of sessions currently in an unattended mode with "Turn off", and the switch "Allow unattended modes" (default off); granting, the warning badge and inheritance are defined by `agent-runtimes.Unattended modes and their warning` and `agent-runtimes.Unattended inheritance for agent-created agents`.
- **Approval policy**: the two host values of the `ApprovalPolicy` of `multi-agent-orchestration.Common approval policy`, read and written with `jagentchill.orc.approval.get` and `jagentchill.orc.approval.set` — **Default** (`orc.approval.default`): mode Human (initial value), Agent reviewer or Automatic, and for Agent reviewer the reviewer role, `threshold` (50–95, default 75), `criterionFloor` (0–90, default 50), `maxRounds` (0–5 revision rounds after the first review, default 2) and `remindAfter_ms` for human sign-offs (default 30 minutes); it is used by scripts, workflow approval nodes, team results and automations that set no policy of their own; and **Minimum** (`orc.approval.minimum`: Automatic — initial value, no floor —, Agent reviewer or Human), to which every resolved policy is raised. The precedence (run override, workflow node, subject, Team, host default, then the minimum) is defined only there and in `script-studio.Approval policy and precedence`. "Require a different model for script review" (`scripts.review.requireDifferentModel`, default off; when on, an agent review whose reviewer model equals the writer's escalates to a person with reason `same_model`, per `script-studio`). A read-only line states the unattended rule of `multi-agent-orchestration.Unattended behaviour of approvals`: a sign-off waits (parks) until a person decides, while cost, consent and tool-permission prompts fail their step after 30 minutes.
- **Personas**: a row "Agent personas" with the count of customised personas and "Manage…", which opens the persona list and editor of `chat-agent.Persona list and editor` (duplicate, edit, reset to default, delete; decision E8); this page defines no persona field.
- **Workspace sessions**: a read-only line stating the approval rule the server enforces — in a workspace session owned by an `editor` (possible only while "Allow workspace agents for editors" is on) that editor resolves file-edit and tool approvals, while host command execution and terminal-key approvals are resolved by `admin` devices only; an `editor` whose workspace permission is turned off keeps read access to the workspace sessions it owns.
- **Autonomous and loop ceilings**: the switch "Allow Autonomous runs" (`agents.autonomous.enabled`) and the per-run ceilings of `multi-agent-orchestration.Autonomous control` (2,000 turns, 12 hours, 50 USD), editable downwards only; and a line showing the Auto-mode session budget (default 5.00 USD, `generation-providers.Approval thresholds and spending caps`), which applies before those ceilings, with a link to Host ▸ Usage and limits where an admin edits it. The Autonomous start dialog of `multi-agent-orchestration.Autonomous control` shows that session budget and lets the user raise it for the session, up to the amount their role is allowed to set, before starting.

Every change writes an audit record of class `security` (`server-api.Audit log`). [NEW]

#### Scenario: Policy preset default
- **WHEN** an admin opens the page on a new host
- **THEN** "Same session tree" is selected, "Allow workspace agents for editors" is off (`agents.allowWorkspaceAgentsForEditors` is false), the default approval policy is Human and the minimum is Automatic

#### Scenario: Widest call policy needs confirmation
- **WHEN** the admin selects "Every agent on this host"
- **THEN** the confirmation of `multi-agent-orchestration.Policy preset admin setting` is shown, and only after confirming is the preset `all` applied and an audit record written

#### Scenario: Editor sees it read-only
- **WHEN** an `editor` device opens Host ▸ Agents
- **THEN** every control is disabled and the callout "Managed by the host admin" is shown

#### Scenario: Allow workspace agents for editors
- **WHEN** the admin turns the switch on
- **THEN** an audit record is written and, within 5 s, `editor` devices can select workspace-class runtimes as defined by `agent-runtimes.Who can configure and who can select`

#### Scenario: Default approval policy applies
- **WHEN** the default approval policy is Agent reviewer and a script has no policy of its own
- **THEN** submitting that script for review uses the Agent reviewer policy

#### Scenario: Minimum raises a weaker policy
- **WHEN** the minimum is Human and a workflow node asks for Automatic approval
- **THEN** that node waits for a person, and its approval record shows that the host minimum raised it

### Requirement: Host teams settings entry
Host ▸ Teams SHALL embed the page of `multi-agent-orchestration.Teams settings page` (Orchestration switches, the list of Teams and the Team editor at `/settings/host/[hostId]/teams/[teamId]`). This capability owns only its place in the settings tree and its scope gating. [NEW]

#### Scenario: Reach the page
- **WHEN** an admin opens Settings ▸ Host ▸ Teams
- **THEN** the Orchestration card and the list of Teams of `multi-agent-orchestration.Teams settings page` are shown

#### Scenario: Deep link to a team
- **WHEN** the user opens `/settings/host/abc/teams/t_1`
- **THEN** the Team editor for `t_1` is shown inside the settings frame

### Requirement: Providers and model routing entry points
Host ▸ Runtimes & providers and Host ▸ Model routing (ORC) SHALL be pages inside the settings tree whose content is owned by other capabilities. A provider is used in **three ways of equal standing** (decision E11) — an OAuth sign-in directly with the provider, an API key (including custom and proxy endpoints), and an installed agent CLI — and the page presents them with equal weight: no tab, heading, empty state or summary describes the product as using "CLI providers" only, and wherever a CLI runtime is named as a way to use a provider, account sign-in and API key are named beside it. **Runtimes & providers** has six tabs:

| Tab | Content owner |
|---|---|
| Providers (default) | `settings-preferences.Provider access methods and accounts` — one card per vendor listing every connected access method with its accounts |
| Sign-in & keys | `agent-runtimes.Direct provider list`, `agent-runtimes.OAuth login through the admin proxy`, `agent-runtimes.Login hand-off per platform`, `agent-runtimes.API key entry and validation`, `agent-runtimes.Multiple auth profiles with order and rotation`, `agent-runtimes.Auth profile health`, `agent-runtimes.Sign out and credential removal` |
| CLI runtimes | `agent-runtimes.Runtimes settings screen` (installed agent CLIs and their sign-in state, the ACP catalogue, custom profiles, runtime limits, and the host switch "Offer editor tools to ACP agents", default on) |
| Endpoints | `agent-runtimes.Shared endpoint record`, `agent-runtimes.Endpoint presets`, `agent-runtimes.Endpoint connection test`, `agent-runtimes.Base-URL override on bundled providers`, `agent-runtimes.Proxy profiles for CLI runtimes` (routers and proxies such as OpenRouter or a self-hosted router keep the CLI's full capability where the CLI supports it); stock media sources and media endpoints are added here too, from the vendor presets or the `custom` template, with the admin's own key |
| Media providers | `generation-providers.Providers settings page` — the built-in media providers **named by vendor** (decision E1) for image, video, speech, voice design, music, sound effects, lip-sync, transcription, translation and stock media, each needing only the user's key or sign-in, plus the bundled CC0 sound pack as a built-in `sfx` and `music` source that needs none |
| Capability matrix | `agent-runtimes.Published capability matrix` ("Compare access methods and runtimes") |

**Model routing (ORC)** embeds `orc-model-routing.ORC settings page`; a profile there names the access method it uses. The Host landing page (`/settings/host/[hostId]`) SHALL show summary rows that link into these pages: per vendor the connected access methods with a state pill (Ready, Sign-in expiring, Needs sign-in or key, Error); for CLI runtimes and for each media capability the count of configured entries and the worst state; for Endpoints the count and the worst health; and for Model routing the roles with their default profile and a warning count of roles without a usable route. When no provider is ready by any method, a callout on both pages and the Home composer's Model selector link to the Providers tab, whose empty state offers, in this order and with equal weight, "Sign in with a provider account", "Enter an API key" and "Use an installed CLI". Keys and tokens are entered only through the flows of the owning capabilities and never appear in a settings row. Session-level controls that depend on a spike are shown only when it passed: the "Allow fallback" toggle of `orc-model-routing.Per-run override` is hidden when spike S26 fails (fallback is then always on), as `diagnostics-quality.Gating spikes` records. [JAD] [NEW]

#### Scenario: Three access methods in the empty state
- **WHEN** an admin opens Host ▸ Runtimes & providers on a host with no provider connected
- **THEN** the Providers tab offers "Sign in with a provider account", "Enter an API key" and "Use an installed CLI" in that order, with the vendors read from the host

#### Scenario: Landing summary
- **WHEN** Anthropic is connected by account sign-in and by an API key, and the Codex CLI is installed and signed in
- **THEN** the Host landing page shows Anthropic with two access methods and OpenAI with "Codex CLI", each with its state pill

#### Scenario: Media providers are named by vendor
- **WHEN** the admin opens the Media providers tab on a fresh host
- **THEN** each capability lists its built-in vendors by name with "Add key" or "Sign in", and the bundled sound pack is listed as ready for sound effects and music

#### Scenario: Fallback toggle hidden
- **WHEN** spike S26 is recorded as failed for the pinned Gateway version
- **THEN** no "Allow fallback" toggle is shown anywhere and the session's fallback chain is always on

### Requirement: Provider access methods and accounts
The **Providers** tab of Host ▸ Runtimes & providers SHALL list one card per vendor (Anthropic, OpenAI, Google, GitHub Copilot, OpenRouter and every other provider and CLI vendor the host reports through `jagentchill.provider.auth.list` and the runtime snapshot of `agent-runtimes.Runtime snapshot`; vendors with nothing connected are collapsed under "More providers" with a search field). A vendor card shows the vendor name and three sections in a fixed order, each present whenever the vendor supports that method, so that every connected way of using the vendor is visible in one place:

| Section | Rows | Controls | Owner of behaviour |
|---|---|---|---|
| **Account sign-in** | one row per signed-in account (auth profile): account label (e-mail or organisation as the vendor reports it), plan name when known, health pill, expiry or "renews automatically", last used time | "Sign in with <vendor>" (adds an account; the sign-in choices the vendor's manifest offers — browser OAuth, device code, setup token), "Sign in again", "Sign out", drag handle to order accounts | `agent-runtimes.OAuth login through the admin proxy`, `agent-runtimes.Login hand-off per platform`, `agent-runtimes.Multiple auth profiles with order and rotation`, `agent-runtimes.Auth profile health`, `agent-runtimes.Sign out and credential removal` |
| **API keys and endpoints** | one row per key profile or endpoint: label, last 4 characters when the host returns them, base URL when it is not the vendor's own, health pill, last used time | "Add API key", "Replace", "Test", "Remove", drag handle to order | `agent-runtimes.API key entry and validation`, `agent-runtimes.Shared endpoint record`, `agent-runtimes.Endpoint health` |
| **Installed CLI** | one row per detected CLI of the vendor: CLI name and version, sign-in state as the CLI reports it, health pill, path | "Check again", "Diagnostics", the install hint when missing, "Sign in on the host" instructions when signed out | `agent-runtimes.CLI detection by binary and version`, `agent-runtimes.Login and health check`, `agent-runtimes.Install hints` |

Rules of the card: (1) **Rotation** — where a section has more than one row, a select "Use accounts" / "Use keys" offers "In order (fail over to the next)" and "Rotate", writing the order and rotation of `agent-runtimes.Multiple auth profiles with order and rotation`; a row skipped by rotation because it is unhealthy says so. (2) **Auth health** — each row's pill uses the tones of `design-system.Avatar, badge and status pill`: Ready (success), "Expires <relative time>" (warning, from 72 hours before an expiry that cannot be renewed silently), "Refresh failed" and "Sign-in required" (warning) with the primary action "Sign in again", "Rejected" (danger) for a refused key; the same states raise `provider.auth_expiring`, `provider.auth_refresh_failed` and `provider.auth_expired` (`notifications.Notification event catalogue`), and a row opened from such a notification is scrolled into view and highlighted. (3) **Plan and quota** — an account row whose vendor reports plan windows shows the nearest window as a thin bar with "<percent> used, resets <relative time>" and the link "Plan usage", which opens `/h/[hostId]/usage/plan` filtered to that account (`usage-tracking.Plan usage rendering`; consent per `usage-tracking.Plan usage consent and sources`); API-key rows link to "Usage" for that provider instead. (4) **Default method** — when a vendor has more than one ready method, a select "Prefer" (Account sign-in, API key, Installed CLI; default: the first ready one in that order) decides which method the model browser preselects for that vendor's models; every method stays selectable per session in `chat-agent.Model browser`, which names the method on each model. (5) **Capability note** — each section header carries a one-line capability summary from `agent-runtimes.Published capability matrix` (an account sign-in and an API key run on the built-in runtime with JAgentChill's tools, steering, modes, teams and workflows; a CLI shows what that CLI supports), with "Compare" opening the Capability matrix tab. (6) **Starting a sign-in from any device** — "Sign in with <vendor>" and "Sign in again" work from the desktop app, the web app and the iOS and Android apps: the hand-off of `agent-runtimes.Login hand-off per platform` opens the vendor's page on the device in use (or shows the device code and link), while the credential is stored on the host only (`agent-runtimes.Credential storage on the host only`). Every control needs role `admin` (`jagentchill.config.write`, and `jagentchill.secrets.manage` for keys); other roles see the cards read-only with "Managed by the host admin" and without account labels. No key, token or secret value is ever shown. [JAD] [NEW]

#### Scenario: One vendor, three methods
- **WHEN** the host has two Anthropic accounts signed in, one Anthropic API key and the Claude Code CLI installed
- **THEN** the Anthropic card shows two rows under Account sign-in, one under API keys and endpoints and one under Installed CLI, each with its health pill

#### Scenario: Second account and rotation
- **WHEN** an admin signs in a second OpenAI account and sets "Use accounts" to "Rotate"
- **THEN** both accounts are listed in the chosen order and new turns alternate between them, as `agent-runtimes.Multiple auth profiles with order and rotation` defines

#### Scenario: Sign-in expiring
- **WHEN** an account's sign-in will expire in 48 hours and cannot be renewed silently
- **THEN** its row shows "Expires in 2 days" in the warning tone with "Sign in again", and the `provider.auth_expiring` notification opens this row

#### Scenario: Refresh failed
- **WHEN** the refresh of an account's sign-in is rejected by the vendor
- **THEN** the row shows "Sign-in required", rotation skips it, and "Sign in again" completed on a phone returns the row to Ready on every device within 2 s

#### Scenario: Plan usage link
- **WHEN** an account row shows "62% used, resets in 3 hours" and the admin activates "Plan usage"
- **THEN** `/h/[hostId]/usage/plan` opens filtered to that account

#### Scenario: Editor sees no account details
- **WHEN** an `editor` device opens the Providers tab
- **THEN** the cards show which methods are ready, no account label or key hint is shown, and no control is editable

### Requirement: Host secrets settings
Host ▸ Secrets SHALL list secrets in a table with columns Name, Scope (Host, or a project), Used by (providers, endpoints, connectors, automations or skills that reference it), Updated, and a ⋯ menu (Replace value…, Delete…), with search and the buttons "Import…" (secondary; parses `.env`-style `NAME=value` lines pasted or loaded from a file, previewing names only) and "Add secret" (primary). "Add secret" opens a side sheet with: Scope segmented control (Host | Project, with a project picker), a notice callout stating that values are stored on the host, protected by file permissions, and are never shown again, Name (`^[A-Z][A-Z0-9_]{0,63}$`, unique per scope), Value (masked input with a reveal toggle effective only while typing, up to 16,384 bytes), and the primary button. The page reads the list shape `{name, scope, set, last4?, updated_ms}` and writes values only with the signed route `PUT /jagentchill/v1/secrets/{name}`; a secret value is never an RPC parameter. Secret values are write-only in the UI: after saving, no screen, API response or log returns the value; the last 4 characters are shown as a hint only when the host returns `last4`, which it does only for values of at least 12 characters. Deleting a secret that is in use names the dependants and requires typed confirmation. Storage and access control are owned by `security-privacy.Host secret storage`; request signing by `device-pairing-signing.Per-request HTTP signature`; every control needs `jagentchill.secrets.manage`. The empty state reads "No secrets yet" with "Add your first secret". [NEW]

#### Scenario: Add a secret
- **WHEN** the admin adds `FREESOUND_KEY` with a 32-character value
- **THEN** the table lists the name with scope Host and a 4-character hint, and the full value cannot be retrieved from any screen

#### Scenario: Short value has no hint
- **WHEN** the admin adds a secret whose value has 8 characters
- **THEN** the row shows no hint characters

#### Scenario: Invalid name
- **WHEN** the admin enters the name `my key`
- **THEN** the field shows the naming rule and the secret is not saved

#### Scenario: Duplicate name
- **WHEN** a secret with the same name already exists in the same scope
- **THEN** saving is refused with "A secret with this name already exists" and "Replace value…" is suggested

#### Scenario: Delete a secret in use
- **WHEN** the admin deletes a secret referenced by a provider
- **THEN** the confirmation names the provider, requires typing the secret name, and after deletion the provider shows that it needs a key

### Requirement: Host usage and limits settings
Host ▸ Usage and limits SHALL be the settings surface for usage and budgets. All amounts are in USD; there is no currency selector. It contains:
- **Usage**: a summary card (this month's total with its accuracy label, and the top three providers) with "Open Usage", which opens the Usage screen at `/h/[hostId]/usage` — the single place usage is viewed, owned by `usage-tracking.Usage screen — Overview` and its sibling requirements and fed by the single query of `usage-tracking.Unified usage query`. This page draws no chart or history table of its own.
- **Budgets** (owned by `generation-providers.Budgets with hard stop` and `generation-providers.Budget warnings`): one row per budget scope — global, provider, project, film, session, run, automation — each with `limitUsd` (an amount or None), the warning threshold `warnAt` (default 80 %) and the "Stop at the limit" switch (`hardStop`, default on); the per-call approval threshold in Edit mode (default 0.50 USD); the Auto-mode session budget (default 5.00 USD, 0–1,000 USD; it applies before the autonomous and loop per-run ceilings of Host ▸ Agents); "Largest budget an editor can set" (`budgets.maxSelfServiceUsd`, 0–10,000 USD, default 50.00: the ceiling for a session or run budget that a device holding `jagentchill.generation.run` without `jagentchill.config.write` creates; such a device can only create a budget up to this amount or lower an existing session or run budget — raising or removing a budget of any scope, and every budget of the scopes global, provider, project, film and automation, needs `jagentchill.config.write`, as `generation-providers.Budgets with hard stop` defines, and the row's help text says so); "Ask before spending more than" (0–100 USD, default 0 = always ask; this is the user-initiated confirmation amount, rule 6 of `generation-providers.Approval thresholds and spending caps`, and it is distinct from the per-call approval threshold of rule 2 above); "Allow unknown-cost models" (default off); and "Count plan-billed turns at list price toward budgets" (`usage.budgetPlanTurnsAtListPrice`, default off). There is no per-day generation count, no "Pause and ask / Stop" select and no control that bypasses a hard-stop budget: when one blocks work, only raising the budget lifts the block, and only a device with `jagentchill.config.write` can raise a global, provider, project, film or automation budget.
- **Plan usage**: the section of `usage-tracking.Plan usage section in settings`.
- **Retention**: usage retention in months and "Reset usage history…", defined by `usage-tracking.Retention and reset`.

Reaching a warning threshold or a limit raises the `usage.*` notifications of `notifications.Notification event catalogue`. Reading needs `jagentchill.config.read`; every change needs `jagentchill.config.write`. [NEW]

#### Scenario: USD only
- **WHEN** an admin opens the page
- **THEN** every amount is shown in USD and no currency control exists

#### Scenario: Budget row
- **WHEN** the admin sets the project budget of "Promo" to 10.00 USD with "Stop at the limit" on
- **THEN** the budget is stored with `limitUsd: 10`, `warnAt: 0.8`, `hardStop: true`, and enforcement follows `generation-providers.Budgets with hard stop`

#### Scenario: Open Usage
- **WHEN** the user activates "Open Usage"
- **THEN** `/h/[hostId]/usage` opens on the Overview tab

#### Scenario: Viewer
- **WHEN** a `viewer` device opens the page
- **THEN** the summary and budgets are readable and every control is disabled

### Requirement: Host skills settings
Host ▸ Skills SHALL be the settings surface of `skills`; installing, updating, removing, enabling, creating and training skills happen on the Skills screen (`/h/[hostId]/skills`, `skills.Skills screen — Installed`), to which the page links with "Open Skills". The page itself contains only host-wide skill settings: the sources list and defaults of `skills.Source management and defaults`; "Check for skill updates automatically" (`skills.autoCheckUpdates`, default on); the per-agent and per-runtime availability matrix "Available to" of `skills.Per-agent and per-runtime availability`; and the limits of `skills.Skill limits` shown read-only. Permissions follow `skills.Skill permissions`. [JAD] [NEW]

#### Scenario: Open Skills
- **WHEN** the user activates "Open Skills"
- **THEN** `/h/[hostId]/skills` opens on the Installed tab

#### Scenario: Automatic update check
- **WHEN** the admin turns off "Check for skill updates automatically"
- **THEN** the host stops its scheduled update checks and "Check for updates" on the Skills screen still works

#### Scenario: Non-admin
- **WHEN** an `editor` device opens Host ▸ Skills
- **THEN** sources and availability are shown read-only

### Requirement: Host knowledge settings
Host ▸ Knowledge SHALL manage notes that agents on this host use as standing guidance (style guides, brand rules, recurring preferences). The page lists notes in a table (name, trigger, scope, enabled, updated) with search and "Add knowledge". A note has: Name (1–80 characters), Trigger description (when the agent applies it, up to 300 characters; or "Always"), Content (Markdown, up to 10,000 characters), Scope (Host, or specific projects or films), and Enabled. Notes can be duplicated, exported and imported as Markdown files with front matter, and deleted with confirmation. Suggested notes produced by sessions (see `chat-agent`) appear under a "Suggestions" tab with Accept, Edit and Dismiss. Changes apply to sessions and runs started afterwards; a running session keeps the knowledge it started with. [NEW]

#### Scenario: Add a note
- **WHEN** the admin adds a note "Brand voice" with trigger "Always"
- **THEN** it is listed as enabled and is available to the next session started on the host

#### Scenario: Content too long
- **WHEN** the content exceeds 10,000 characters
- **THEN** the counter turns `danger` and saving is disabled until the content is within the limit

#### Scenario: Accept a suggestion
- **WHEN** the admin accepts a suggested note
- **THEN** it moves to the notes list as enabled and leaves the Suggestions tab

### Requirement: Host workspaces settings
Host ▸ Workspaces SHALL be the settings surface of `workspaces-terminal` for workspace-wide options: the registered folders (roots) with Add and Remove; "Archive workspaces after their pull request is merged" (`workspaces.autoArchiveAfterMerge`, default off); the metadata instructions `workspaces.metadataInstructions` (0–4,000 characters); the repository trust list (trusted workspace configuration hashes with Revoke); and the workspace limits shown read-only. Adding a root, changing trust and script settings need `jagentchill.host.exec`; the other rows need `jagentchill.config.write`. Each row's behaviour is defined by the owning requirement in `workspaces-terminal`; this page defines no workspace behaviour. [NEW]

#### Scenario: Auto-archive switch
- **WHEN** the admin turns on "Archive workspaces after their pull request is merged"
- **THEN** the setting `workspaces.autoArchiveAfterMerge` is true and an audit record `workspace.settings.changed` exists

#### Scenario: Editor cannot add a root
- **WHEN** an `editor` device opens the page
- **THEN** the folders are listed read-only and "Add" is absent

### Requirement: Host terminal settings
Host ▸ Terminal SHALL be the settings surface of the host terminal. Its first row is the switch "Enable the host terminal" (`terminal.enabled`, default off), which needs `jagentchill.host.exec`; turning it on shows the blocking acknowledgement dialog of `workspaces-terminal.Terminal enablement and host-shell warning` — the four statements and the checkbox are defined only there — and the switch stays off unless the dialog is confirmed. While the terminal is enabled the page shows the same four statements permanently, and: terminal profiles (`workspaces-terminal.Terminal profiles`); "Environment" (variables added to or removed from terminal sessions; secret-bearing variables of the server and of the Gateway are never inherited); "Running terminals" with Kill (`workspaces-terminal.Terminal limits, kill and restart behaviour`); "Enable terminal agent hooks" and agent access to terminals (`workspaces-terminal.Agent terminal tools`); and the limits read-only. Personal terminal preferences that are stored per device — "Copy on select", "Terminal bell", "Terminal scrollback", "Warn before multi-line paste", "Screen reader mode for terminals", "Preserve exact terminal colours", "Use web terminal renderer", font and size — are shown in a **This device** card on the same page and need no host scope. On the Docker distribution the page states the container user and that the shell runs inside the container. [NEW]

#### Scenario: Enabling needs the acknowledgement
- **WHEN** an admin turns the switch on and closes the dialog without ticking the checkbox
- **THEN** `terminal.enabled` stays false and no terminal can be opened

#### Scenario: Enabled
- **WHEN** the admin ticks the checkbox and confirms "Enable terminal"
- **THEN** the switch is on, an audit record `terminal.enabled` exists and the profiles, environment and running-terminals cards appear

#### Scenario: Non-admin
- **WHEN** an `editor` device opens Host ▸ Terminal
- **THEN** the switch is disabled with "Only admin devices can enable the terminal" and only the This device card is editable

### Requirement: Host connectors settings
Host ▸ Connectors SHALL list the connectors of `server-api` (connector registry) — `google-drive`, `dropbox` (import, used by `media-library`), `youtube`, `tiktok` (publish, used by `export-share.Publishing hand-off`) — each with its state (Not configured, Configured, Connected as <account label>, Error), "Configure" (enter the user's own OAuth client id; the client secret is written as a host secret), "Connect" (starts the OAuth flow whose redirect is the connector callback route), "Disconnect" and "Remove credentials". The page shows the exact redirect URL to register with the provider, with a copy button. Connector names are plain text labels; no third-party logo or brand colour is shown. The registry, the OAuth flow and the callback route are owned by `server-api.Connectors`. The page's first row is the host switch "Enable connectors" (`connectors.enabled`, default off), which makes the host advertise the feature flag `connectors`; while it is off the page shows only that switch and the list of connector hosts that enabling would allow. Changes need `jagentchill.config.write` and `jagentchill.secrets.manage`. [NEW]

#### Scenario: Configure and connect
- **WHEN** the admin enters an OAuth client id and secret for `google-drive` and completes the provider's consent
- **THEN** the row reads "Connected as <account label>" and the client secret is listed by name on Host ▸ Secrets

#### Scenario: Not configured
- **WHEN** a connector has no client credentials
- **THEN** "Connect" is disabled and the row shows the redirect URL to register

#### Scenario: Feature off
- **WHEN** "Enable connectors" is off
- **THEN** the page shows only that switch and the host list, no connector can be configured, and the import and publish entries of `media-library` and `export-share` show "Connectors are turned off on this host"

### Requirement: Host storage settings
Host ▸ Storage SHALL show, from `server-api.Host storage accounting and cleanup`: total size of the host's blob store and database with free space on its volume and the quota; a breakdown bar (synced project media, generated assets, proxies, exports, workflow and film artefacts, workspaces, trash); a table of projects and films by size with "Open" and "Clean up…"; retention settings — keep generated assets not used in any project (`storage.generatedRetentionDays`: 30, 90 — default —, 180 days, or Forever), keep host exports (`storage.exportRetentionDays`: 7, 30 — default —, 90 days, or Forever), the space reserved for host exports (`storage.exportQuotaBytes`, at least 1 GiB, default 20 GiB; the oldest exports are removed first when it is exceeded), trash retention (read-only: 30 days); low-space warning (`storage.lowSpaceWarnBytes`, 1–100 GiB, default 5 GiB); and the actions "Empty trash…" and "Remove unreferenced blobs…" (shows the count and size before confirming). The data location is shown read-only. Clean-up never removes blobs referenced by a project, film, workflow run or pending sync. Sizes refresh on open and on demand, with a "Calculating…" state for scans longer than 500 ms. The `storage.low_space` notification is raised by the host at 90 % of the quota or below the low-space warning value, per the owner. [NEW]

#### Scenario: Remove unreferenced blobs
- **WHEN** the admin confirms "Remove unreferenced blobs…"
- **THEN** only blobs with no reference are deleted, the freed size is reported in a toast and referenced media remains playable in all projects

#### Scenario: Low space
- **WHEN** free space on the host volume falls below the low-space warning value
- **THEN** the page shows a warning callout with "Clean up" and the `storage.low_space` notification exists

#### Scenario: Retention
- **WHEN** host export retention is 7 days and an export is 8 days old
- **THEN** the export file is removed from the host and its entry shows "Expired" with the option to export again

#### Scenario: Forever
- **WHEN** host export retention is set to Forever
- **THEN** no export is removed for age and the host quota still applies

### Requirement: Host updates settings
Host ▸ Updates SHALL show only what belongs to the host: the JAgentChill Server version, the version of the supervised OpenClaw Gateway (the pinned tag of `gateway/OPENCLAW_VERSION`), the protocol version, whether a newer host version is available (for a host run by the desktop app: "Updates with the desktop app", linking to Personal ▸ Updates; for a headless host: the update instructions of `updates-distribution.Headless Gateway distribution and update`), and a compatibility line stating whether each paired device's app version is compatible with the host's protocol version (`updates-distribution.Version display and compatibility status`). Automatic app update checks and "Check now" are on Personal ▸ Updates and work without a host. [NEW]

#### Scenario: Compatibility line
- **WHEN** one paired device runs an app whose protocol version the host no longer supports
- **THEN** the page names that device with "Update required"

#### Scenario: Desktop-supervised host
- **WHEN** the host is run by the desktop app
- **THEN** the page states that the host updates with the desktop app and links to Personal ▸ Updates

### Requirement: Host diagnostics settings
Host ▸ Diagnostics SHALL be the settings surface of `diagnostics-quality` for the active host and contain:
- **Host status** (desktop built-in host: the surface of `desktop-app.Host status surface`; other hosts: connection state, latency, protocol version, uptime), on every host the state of the OpenClaw Gateway that the server supervises (`server-api.Gateway supervision and lifecycle`; the same `gateway { state, since_ms, restarts, lastExit? }` values and labels as the Agent engine row of `settings-preferences.Host general settings`, with the health reason code; while it is not running the line adds "Agents are unavailable; editing, sync and export keep working") and, for the built-in host, "Restore this computer as admin" (`device-pairing-signing.Trust bootstrap for the first device`).
- **Health checks**: the entries of `diagnostics-quality.Diagnostics registry` — id, scope, severity (caution or error), message and current result — including renderer path, WebCodecs support, storage persistence and quota, FFmpeg and render-host availability on the host, the host encoder table with "Download OpenH264…" when H.264 needs it (`server-api.Host encoder policy and codec table`), provider reachability, clock skew against the host (warning above 120 s), pairing key storage, and project-level diagnostics of the open project. "Run checks" re-evaluates them; the host doctor report is `diagnostics-quality.Host doctor report`.
- **Logs**: host log level (Error, Warn, Info, Debug; default Info; Debug returns to Info after 60 minutes), a viewer of the last 500 lines with level filter and search, and "Open logs folder" on the desktop app that runs the host.
- **Activity**: the job and event inspector of `diagnostics-quality.Job and event inspector`.
- **Audit**: the audit log of `server-api.Audit log` with filters for class, actor, workspace and terminal; reading it needs `jagentchill.devices.manage`.
- **Export diagnostics bundle…**: `diagnostics-quality.Diagnostics bundle`.

Nothing on this page transmits data off the device or host; bundles are saved to a user-chosen location. Client-only diagnostics are on Personal ▸ About. [PORT SH-012, SH-013] [NEW]

#### Scenario: Supervised Gateway is down
- **WHEN** the Gateway child is in a crash loop and an admin opens Host ▸ Diagnostics
- **THEN** Host status shows "Stopped after repeated failures" with the reason code and "Agents are unavailable; editing, sync and export keep working", and the other settings pages stay editable

#### Scenario: Health check failure
- **WHEN** WebGPU is unavailable
- **THEN** the renderer check shows severity caution with the message that the compatibility renderer is in use

#### Scenario: Clock skew warning
- **WHEN** the device clock differs from the host clock by 130 s
- **THEN** the clock-skew check shows a warning, and at 100 s it shows none

#### Scenario: Audit needs its scope
- **WHEN** a device without `jagentchill.devices.manage` opens the page
- **THEN** the Audit section is absent

#### Scenario: Diagnostics bundle excludes secrets
- **WHEN** the admin exports a diagnostics bundle on a host with three secrets
- **THEN** the bundle contains the secrets' names only and none of their values, and no network request is made

### Requirement: Feedback
The feedback form SHALL be the one defined by `diagnostics-quality.Local feedback capture`, which owns its fields, limits, actions, draft, history and storage. This capability owns only its settings entry points: "Send feedback" on Personal ▸ About and on Host ▸ Diagnostics opens that form; the shell entry points are listed in `app-shell-navigation.Sidebar footer` and `app-shell-navigation.Editor header menu`. [PORT SH-009] [NEW]

#### Scenario: Open from About
- **WHEN** the user activates "Send feedback" on Personal ▸ About
- **THEN** the form of `diagnostics-quality.Local feedback capture` opens with any saved draft

#### Scenario: Works without a host
- **WHEN** no host is connected and the user opens the form from About
- **THEN** the form opens and its local actions are available

### Requirement: Preference storage, scope and sync
Personal settings SHALL be stored per device in the preferences store of `project-storage.UI preference storage` (`jagentchill.prefs.*` keys, schema-validated and versioned, with ordered migrations), take effect in all windows of the device within 500 ms, and are not synchronised between devices. An "Export preferences…" and "Import preferences…" pair on the Preferences page transfers personal settings (including shortcut presets and saved colours, excluding credentials, device identity and paths) as a JSON file; import shows a summary and applies only keys that validate. Host settings are stored in the server configuration file `<dataDir>/config.json` (`server-api.Server configuration`; a key the schema does not know makes the server refuse to start and name the key), read with `jagentchill.settings.host.get` (scope `jagentchill.config.read`) and written with `jagentchill.settings.host.patch` (scope `jagentchill.config.write`, or the stricter scope named on the page; keys and ranges are those of `server-api.Server configuration`), validated by the shared Zod schemas, applied atomically per change, and delivered to connected devices as the targeted channel-P event `jagentchill.settings.host.changed`. A write without the required scope fails with `SCOPE_DENIED`. Unknown keys from a newer app version are preserved on write. A preference whose stored value is invalid is replaced by its default and reported once in the diagnostics log. Classic preferences are migrated once per `app-shell-navigation.Shell state persistence`. [JAD] [NEW]

#### Scenario: Per-device scope
- **WHEN** the user sets the dark theme on the desktop
- **THEN** the paired phone keeps its own theme

#### Scenario: Import preferences
- **WHEN** the user imports a preferences file containing one unknown key and one invalid value
- **THEN** the summary reports 2 items skipped, valid keys are applied after confirmation and credentials are unaffected

#### Scenario: Host setting needs scope
- **WHEN** a device without `jagentchill.config.write` calls `jagentchill.settings.host.patch`
- **THEN** the server rejects it with `SCOPE_DENIED` and the value is unchanged

### Requirement: Settings on mobile and web
All Personal pages SHALL be available on every platform, with rows hidden only where the platform class has nothing to configure: "Render interface with GPU", Project library location, "Reference files in place", the Built-in host card with Network access, tray and launch-at-login appear only in the desktop app, and there identically on macOS, Windows and Linux; "Allow software rendering" appears on web and in the desktop app; "Request persistent storage" appears only on web; push rows, "Haptic feedback", "Save to Photos automatically after export" and "Sync media over mobile data" appear only on mobile, and there identically on iOS and Android; the key-protection row and its file-storage notice appear on every native platform (macOS, Windows, Linux, iOS, Android) and not on web, whose key is held by the browser; the "Tailnet on this device" card appears in the desktop app and the mobile apps and not on web. No row exists on only one desktop operating system or only one mobile operating system. Host pages are available on every platform when connected, read-only without the write scope; a provider sign-in can be started from any of them, including a phone (`settings-preferences.Provider access methods and accounts`). On tablets (medium or wide form factor at compact-touch density) the settings navigation column stays pinned and rows use the 44 px sizes of `design-system.Control size tokens and density rules`. On compact form factors grouped cards span the screen width with 16 px margins, tables become stacked rows, side sheets become full-height sheets and charts scroll horizontally with a fixed value axis. On mobile a "Disable ending card" row is not present because the product adds no ending card to exports. [NEW]

#### Scenario: Desktop-only rows on web
- **WHEN** the Storage page is opened in the web build
- **THEN** the Project library location and "Reference files in place" rows are absent and "Request persistent storage" is present

#### Scenario: Mobile data
- **WHEN** "Sync media over mobile data" is off and the phone is on mobile data
- **THEN** media transfers wait for an unmetered connection while project operations continue, as defined by `cross-device-sync.Media sync policy by platform`

#### Scenario: Secrets side sheet on a phone
- **WHEN** the admin taps "Add secret" on a phone
- **THEN** the form opens as a full-height sheet with the primary action pinned above the safe area
