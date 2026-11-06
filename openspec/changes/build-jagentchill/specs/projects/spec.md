## ADDED Requirements

### Requirement: Projects list
The app SHALL provide a Projects screen listing every local project that is not in the trash, loaded once per app session from `project-storage` and kept current by change notifications (this index is defined here and is the exception to the generic table pattern of `app-shell-navigation.Lists for primary sections`). While loading, a skeleton of 24 placeholder cards (grid) or rows (list) is shown. Each project is available offline with no Gateway connection, and local projects need no device role. A project whose document has `template.locked: true` (`project-document.Template mode model`) is listed with the badge "Template draft" and opens in the template editor of `templates.Use a template` instead of the full editor. A project whose stored record fails validation is listed with an "Unreadable" badge and offers only Info, Export package and Delete. The header shows a breadcrumb ("Home / All projects" or the folder path), the view toggle, a search field, sort controls and a "New project" button (label "New" below 640 px width). [PORT P-001, P-002] [CAPCUT CC-002]

#### Scenario: Loading state
- **WHEN** the Projects screen opens before the project list has loaded
- **THEN** 24 skeleton placeholders are shown and are replaced by the projects when loading completes

#### Scenario: Offline
- **WHEN** the device has no network and no Gateway connection
- **THEN** all local projects are listed and can be opened

#### Scenario: Unreadable record
- **WHEN** a stored project record has no metadata
- **THEN** it is listed with the "Unreadable" badge and its card cannot be opened in the editor

#### Scenario: Template draft badge
- **WHEN** a project created from a template is left before "Edit in full editor" was chosen
- **THEN** its card shows "Template draft", and after "Edit in full editor" sets `template.locked` to false the badge is gone

### Requirement: Create project
This requirement is the single place that defines new-project defaults; every other spec references it. "New project" SHALL create a project named "New project" with one scene "Main scene" (`isMain`), `schemaVersion` equal to the current schema version, `canvasSizeMode: "preset"`, `lastCustomCanvasSize: null`, `originalCanvasSize: null`, in the currently viewed folder; it is saved immediately and opened in the editor. Canvas size, frame rate and background come from the three "New project" preferences of `settings-preferences.Editing default preferences`, whose value lists are exactly the presets of `projects.Canvas size presets and custom size` and the rates of `projects.Frame rate`, each with the additional value "Match first clip", which is the factory value of the canvas and frame-rate preferences. While a preference is "Match first clip" or unset, the project starts at the factory defaults — canvas 1920 × 1080 on desktop, web and tablets and 1080 × 1920 on phones, frame rate 30/1 — and `projects.Canvas and frame rate adoption from first media` is armed for that property; a fixed preference value is applied as given and counts as explicitly chosen, which disarms adoption for that property. The factory background is `{kind: "color", color: "#000000"}`. When the save fails, the toast "Failed to create project" is shown, the user stays on the Projects screen and no partial record remains. A "New project" menu additionally offers "From template…" (opens the template browser of `templates.Template gallery`), "From script…" (`script-studio.Draft timeline from a script`) and "Import…" (see `projects.Project package import`). On mobile, "New project" first opens the ordered picker of `media-library.Mobile photo library import` with the primary action "Add (N)" (disabled while N = 0) and the secondary action "Blank project"; "Add (N)" creates the project and inserts the picked items into the main track in pick order with the `mainInsert` strategy of `timeline-editing.Placement strategies`, and "Blank project" creates an empty project. JAgentChill MUST NOT append any ending clip, watermark or branding element to a project or its export. [PORT P-003, S-015] [CAPCUT CC-001, CC-014]

#### Scenario: Factory defaults on desktop
- **WHEN** a project is created on desktop with untouched preferences
- **THEN** the editor opens a project named "New project" with a 1920 × 1080 canvas, 30 fps, black background and an empty main track

#### Scenario: Blank project on a phone
- **WHEN** the user chooses "Blank project" in the picker on a phone with untouched preferences
- **THEN** an empty project with a 1080 × 1920 canvas at 30 fps opens

#### Scenario: Picked items on a phone
- **WHEN** the user picks a 1920 × 1080 video and then a photo and taps "Add (2)" with untouched preferences
- **THEN** the project's canvas is 1920 × 1080 (adopted from the first item) and the main track holds the video followed by the photo with no gap

#### Scenario: Fixed preference disarms adoption
- **WHEN** the "New project" canvas preference is 1:1 and the first inserted clip is 1920 × 1080
- **THEN** the canvas stays 1080 × 1080

#### Scenario: Save failure
- **WHEN** storage rejects the initial save
- **THEN** the toast "Failed to create project" is shown and the project list is unchanged

#### Scenario: No ending clip
- **WHEN** a new project with one clip is exported
- **THEN** the export duration equals the clip duration and contains no added element

### Requirement: Open and exit project
Activating a project card or row SHALL open the editor for that project: the editor shows "Loading project…" with a progress bar while it pauses autosave, runs pending migrations for that project, loads the project, initialises scenes, loads media metadata, loads fonts used by elements, generates a thumbnail when none exists, and resumes autosave. The editor header menu item "Back to projects" (mobile: the close button) shows "Exiting project…", regenerates the thumbnail, flushes any pending save, closes the project and returns to the Projects screen; the control is disabled while exiting, and when the flush cannot complete the leave-without-saving dialog of `project-storage.Autosave failure and storage-full handling` is shown instead of exiting. A project that is edit-locked by another device opens read-only with a banner naming the device per `cross-device-sync.Single-writer edit lease`; a device with the `viewer` role always opens Gateway-synced projects read-only. `app-shell-navigation.Editor loading, missing-project and error screens` hosts these screens and uses the wording defined here. [PORT P-004, P-027, P-029, P-034]

#### Scenario: Exit flushes the save
- **WHEN** the user edits a clip and chooses "Back to projects" 100 ms afterwards
- **THEN** the edit is present when the project is reopened and the project card shows a thumbnail reflecting the edit

#### Scenario: Double exit
- **WHEN** "Back to projects" is activated while "Exiting project…" is shown
- **THEN** the second activation has no effect

#### Scenario: Viewer device
- **WHEN** a device with the `viewer` role opens a synced project
- **THEN** the editor is read-only and every editing control is disabled with the tooltip "Your role on this host is view-only"

### Requirement: Project not found and load errors
Opening an id that does not exist in storage SHALL show a screen titled "Project not found" with the body "This project does not exist on this device" and the actions "Back to projects", "Create new project" (which creates a project named "Untitled Project" with the defaults of `projects.Create project` and opens it) and, when a Gateway is connected, "Look for it on {host}", which performs the lookup of `cross-device-sync.Opening a synced project on another device` and opens the project when found or shows "Not on {host} either" when it is not. The app MUST NOT silently create a project. Any other load failure shows an error screen with the error message and the actions "Retry", "Back to projects" and "Copy details"; when a version snapshot exists for the project the screen additionally offers "Restore latest snapshot" per `project-storage.Version snapshots`. [PORT P-032, P-033] [NEW]

#### Scenario: Unknown id
- **WHEN** the editor route is opened with an id that is not in storage
- **THEN** the "Project not found" screen is shown and the number of stored projects is unchanged

#### Scenario: Create from the not-found screen
- **WHEN** the user chooses "Create new project" on that screen
- **THEN** a project named "Untitled Project" is created and opened

#### Scenario: Lookup on the host
- **WHEN** a Gateway named "Studio Mac" is connected, the project exists there and the user chooses "Look for it on Studio Mac"
- **THEN** the project is downloaded and opened

#### Scenario: No host connected
- **WHEN** no Gateway is connected
- **THEN** the screen shows only "Back to projects" and "Create new project"

#### Scenario: Load failure with retry
- **WHEN** loading fails with a storage read error and the user chooses Retry after the cause is resolved
- **THEN** the project loads normally

### Requirement: Project search
The search field (placeholder "Search…") SHALL filter the displayed projects live, on every keystroke, by case-insensitive, diacritic-insensitive substring match on the project name, across the current folder and all its subfolders. The query is not persisted. Clearing the field restores the full list. Selection entries for projects hidden by the filter are removed from the selection. [PORT P-005]

#### Scenario: Case-insensitive match
- **WHEN** projects "Holiday Reel" and "Promo" exist and the user types "reel"
- **THEN** only "Holiday Reel" is shown

#### Scenario: Hidden selections are dropped
- **WHEN** "Promo" is selected and the user types "reel"
- **THEN** the selection count is 0

### Requirement: Project sorting
Projects SHALL be sortable by Created, Modified, Name or Duration with a separate ascending/descending toggle; default Modified descending. Name comparison is locale-aware and case-insensitive with numeric collation ("Clip 2" before "Clip 10"); ties are broken by Modified descending. Folders are always listed before projects, sorted by name. [PORT P-006, P-007]

#### Scenario: Name sort
- **WHEN** projects "beta", "Alpha" and "Clip 10", "Clip 2" are sorted by Name ascending
- **THEN** the order is Alpha, beta, Clip 2, Clip 10

#### Scenario: Toggle order
- **WHEN** the sort is Duration ascending and the user activates the order toggle
- **THEN** the longest project is listed first

### Requirement: Project views and view persistence
The Projects screen SHALL offer a grid view (1, 2, 3 or 4 columns at widths < 640, ≥ 640, ≥ 1024, ≥ 1280 px; phones: 2 columns) and a list view; default grid. A grid card shows a 16:9 cover or thumbnail (placeholder icon when none; a transparent background is drawn as a checkerboard), a duration badge (`MM:SS`, `H:MM:SS` at ≥ 1 h), the name clamped to 2 lines, "Created {date}" formatted per locale, and the origin chips of `projects.Project links to scripts, workflows and films`; the selection checkbox and the "…" menu appear on hover or focus (always visible on touch). A list row shows checkbox, 40 px thumbnail, name, duration ("—" when 0), modified date and created date. View mode, sort key and sort order are persisted as UI preferences and restored on next launch. [PORT P-008, P-009, P-010, P-011]

#### Scenario: Persisted view
- **WHEN** the user switches to list view sorted by Name ascending and restarts the app
- **THEN** the Projects screen opens in list view sorted by Name ascending

#### Scenario: Duration badge
- **WHEN** a project lasts 3723 s
- **THEN** its badge reads "1:02:03"

### Requirement: Project multi-selection
Each card and row SHALL have a checkbox; Shift-click selects the range from the last selected anchor to the clicked item (in displayed order) and merges it into the selection; a header "Select all" checkbox selects all displayed projects and shows the indeterminate state when some but not all displayed projects are selected. On touch, a long-press with the timing of `mobile-editor.Touch gesture constants` on a card enters selection mode. The cancel action or "Cancel" clears the selection. [PORT P-012, P-013, P-014]

#### Scenario: Range selection
- **WHEN** the user checks the 2nd project and Shift-clicks the 5th
- **THEN** projects 2 through 5 are selected

#### Scenario: Indeterminate
- **WHEN** 2 of 6 displayed projects are selected
- **THEN** the Select all checkbox is indeterminate, and activating it selects all 6

### Requirement: Bulk actions
While at least one project is selected, a bulk bar SHALL offer Duplicate, Move to folder, "Export video…", Export packages and Delete (a "…" dropdown below 640 px). "Export video…" is enabled for 2–20 selected projects and opens the preset picker of `export-share.Batch export`; with more than 20 selected it is disabled with the tooltip "Select at most 20 projects", and with one selected it is disabled with the tooltip "Select at least 2 projects". Every other action applies to every selected project, shows a progress toast "Processing N of M", reports per-item failures by name, and clears the selection when finished. [PORT P-015, P-016] [NEW]

#### Scenario: Bulk duplicate
- **WHEN** three projects are selected and Duplicate is chosen
- **THEN** three new projects exist, named by the duplicate naming rule, and the selection is empty

#### Scenario: Partial failure
- **WHEN** one of three duplicates fails for lack of storage
- **THEN** two duplicates exist and a toast names the project that failed with the quota message of `project-storage.Quota evaluation`

#### Scenario: Batch export bound
- **WHEN** 21 projects are selected
- **THEN** "Export video…" is disabled with the tooltip "Select at most 20 projects"

### Requirement: Per-project menu
Each project SHALL offer, through its "…" button and its context menu (secondary click or long-press), the items Open, Rename, Duplicate, Move to folder, Info, Edit cover, Export package, "Copy media into library" (desktop app only, shown when the project has at least one linked external file; behaviour in `media-library.External file references`), "Sync with {host}…" / "Stop syncing" (shown when a Gateway is paired; see `projects.Per-project sync entry points`), Delete. The "…" button is hidden while more than one project is selected; the context menu acts on the clicked item only. The menu is keyboard-operable and opens with the context-menu key on a focused card. [PORT P-017]

#### Scenario: Context menu target
- **WHEN** three projects are selected and the user right-clicks a fourth and chooses Rename
- **THEN** the rename dialog is for the fourth project

#### Scenario: No Gateway paired
- **WHEN** no Gateway is paired
- **THEN** the menu contains no sync item

#### Scenario: Copy media into library entry
- **WHEN** the menu is opened on desktop for a project with 3 linked external files, and for a project whose media is all managed
- **THEN** the first menu contains "Copy media into library" and the second does not

### Requirement: Rename project
Rename SHALL be available from the "Rename project" dialog (field "New name", Enter or the Rename button confirms) and inline in the editor header (click the name; Enter or blur saves; Escape reverts). In both paths the name is trimmed, MUST be 1–120 characters, and an empty result keeps the previous name (dialog: the Rename button is disabled). Rename updates the modified timestamp, shows a toast on failure, and duplicate names are allowed. The same name is shown in project settings. [PORT P-018, P-028] [CAPCUT CC-004]

#### Scenario: Inline rename
- **WHEN** the user clicks the project name in the editor header, types "  Launch video  " and presses Enter
- **THEN** the project is named "Launch video" in the header and in the Projects list

#### Scenario: Empty rename
- **WHEN** the dialog field is cleared
- **THEN** the Rename button is disabled

#### Scenario: Length bound
- **WHEN** the user pastes a 150-character name
- **THEN** the field holds the first 120 characters

### Requirement: Duplicate project
Duplicate SHALL create a full copy with a new id, new created and modified timestamps, the same thumbnail and cover, in the same folder, and copies of all media assets under the new project id by reference to the same content-addressed bytes (reference counting is provided by `project-storage.Stored record layout` on every platform, so no bytes are copied). Naming: strip an existing leading `(N) ` prefix to obtain the base name; the new name is `(N) base` where N is the highest existing number for that base plus 1, or 1 when none exists; N increments within a batch. A missing source produces the toast "Project(s) not found". The duplicate does not copy version snapshots, is not synced until the user enables sync for it, and keeps the `filmLink`, `workflowLink` and `scriptLinks` of the source. [PORT P-021, P-022]

#### Scenario: First and second duplicate
- **WHEN** "Trip" is duplicated twice
- **THEN** the copies are named "(1) Trip" and "(2) Trip"

#### Scenario: Duplicate of a duplicate
- **WHEN** "(2) Trip" is duplicated while "(1) Trip" and "(2) Trip" exist
- **THEN** the copy is named "(3) Trip"

#### Scenario: Media independence
- **WHEN** a media asset is removed from the duplicate
- **THEN** the original project still has the asset and plays it

### Requirement: Project info
The Info dialog SHALL show: name, duration (`0:00` when empty), canvas size and frame rate, created and modified date-times, number of scenes, number of media assets, storage used by the project's media and caches (binary units with one decimal), storage location (desktop: the project's folder path inside the library with "Reveal in file manager"; other platforms: "App storage"), schema version, sync state ("On this device only", "Synced with {host}", "Sync paused", per `cross-device-sync.Sync status and activity`), the links of `projects.Project links to scripts, workflows and films`, and the full project id with a copy button. It has a single "Close" button. [PORT P-020] [CAPCUT CC-005]

#### Scenario: Info content
- **WHEN** Info is opened for a 90 s project with 4 assets totalling 350 MiB
- **THEN** the dialog shows duration "1:30", "4 media assets" and "350.0 MiB"

#### Scenario: Desktop path
- **WHEN** Info is opened on desktop
- **THEN** the storage location shows the path `<library>/<projectId>` and "Reveal in file manager" opens that folder

### Requirement: Delete project with enforced confirmation
Delete SHALL move projects to the trash after a confirmation dialog titled "Move '{name}' to trash?" or "Move N projects to trash?" stating that items are kept for 30 days. Permanent deletion (from the trash, "Empty trash", or automatic expiry) removes the project record, all its media files, thumbnails, caches and version snapshots. Manual permanent deletion requires a dialog titled "Delete '{name}' permanently?" / "Delete N projects permanently?" in which the destructive button stays disabled until the user types `DELETE` (exact, case-sensitive) into the confirmation field. Deleting the currently open project closes it first. Failures are reported in a toast naming the project and leave the project intact. Deleting a synced project follows `cross-device-sync.Deletion, trash and removal from the Gateway` and requires the `editor` or `admin` role (scope `jagentchill.projects.write`); a `viewer` device is offered only "Remove from this device". [PORT P-019, P-023] [CAPCUT CC-004]

#### Scenario: Confirmation is enforced
- **WHEN** the permanent-delete dialog is open and the field contains "delete"
- **THEN** the "Delete permanently" button is disabled
- **AND** it becomes enabled when the field contains exactly "DELETE"

#### Scenario: Media removed
- **WHEN** a project with 3 media files not shared with any other project is permanently deleted
- **THEN** its record, its 3 media files and its caches no longer exist in storage and the reported storage usage decreases accordingly

#### Scenario: Move to trash
- **WHEN** the user confirms "Move 'Trip' to trash?"
- **THEN** "Trip" disappears from the Projects list and appears in the Trash view

### Requirement: Trash
The Projects screen SHALL provide a Trash view that is the one trash of the product. Entries are typed `{kind: "project" | "template" | "script" | "workflow-run" | "film" | "film-panel-asset", id, name, deleted_ms, originalLocation}`; the client-side kinds (`project`, `template`, `script`) are stored per `project-storage.Trash retention storage` (a trashed project carries the device-local `local.trash` of `project-document.Device-local section`, so trashing a project on one device neither changes the synced document nor trashes it on another device) and are available offline, and the host-side kinds (`workflow-run`, `film`, `film-panel-asset`) are stored on the Gateway per `cross-device-sync.Gateway space` and are listed only while that Gateway is connected. The view has a kind filter (All and one chip per kind present) and lists name, kind icon, thumbnail, deletion date and days remaining. Actions: Restore (returns the item to its original location — for a project its original folder, or the root when that folder no longer exists), Delete permanently (confirmation per `projects.Delete project with enforced confirmation`), Empty trash (all kinds the device is allowed to delete). Restoring or deleting host-side kinds requires scope `jagentchill.projects.write` (`editor` or `admin`); a `viewer` device sees them without actions. Trashed items cannot be opened, are excluded from search, and still count toward storage usage (shown in the Trash header). An item is deleted permanently and automatically 30 days after it was trashed; expiry of client-side kinds is evaluated at app start and every 6 hours while the app runs, and of host-side kinds by the Gateway. Each owning spec names the `kind` it sends here. [NEW]

#### Scenario: Restore
- **WHEN** "Trip" is restored from the trash
- **THEN** it is listed in its original folder with all media intact

#### Scenario: Expiry at start
- **WHEN** the app starts and a project was trashed 31 days earlier
- **THEN** the project and its media are permanently removed without a prompt

#### Scenario: Expiry while running
- **WHEN** the app has run for 6 hours (fake clock) and a project passed 30 days in the trash during that time
- **THEN** the project is permanently removed at the 6-hour evaluation without a restart

#### Scenario: Typed entries
- **WHEN** a template and a script are trashed
- **THEN** the Trash view lists both with their kind icons and the filter offers "Templates" and "Scripts"

#### Scenario: Host kinds offline
- **WHEN** no Gateway is connected
- **THEN** no `film` or `workflow-run` entries are listed and the view states "Connect to {host} to see items deleted there" when a Gateway is paired

#### Scenario: Empty trash state
- **WHEN** the trash holds no items
- **THEN** the Trash view shows "Trash is empty" and "Empty trash" is disabled

### Requirement: Project folders
Projects SHALL be organisable in folders nested up to 4 levels. Folder names are trimmed, 1–80 characters, unique among siblings (case-insensitive; a clash shows "A folder with this name already exists"). Actions: New folder, Rename, Move (folder or projects, by drag-and-drop onto a folder or breadcrumb segment, or the "Move to folder" dialog with a folder tree), Delete folder. Deleting a folder moves all contained projects (recursively) to the trash after a confirmation "Delete folder '{name}' and move N projects to trash?" and removes the folder structure; a trashed project remembers its folder id, and restoring it after the folder was deleted places it in the root. A folder cannot be moved into itself or its descendants. Folder cards show the folder name and project count (trashed projects are not counted). Folders are a device-local organisation: they are stored in the folder tree of `project-storage.Stored record layout` and are synced as library items per `cross-device-sync.Library item sync`. [NEW]

#### Scenario: Move by drag
- **WHEN** two selected projects are dragged onto the folder "Clients"
- **THEN** both are listed inside "Clients" and no longer in the previous location

#### Scenario: Depth limit
- **WHEN** the user attempts to create a folder inside a level-4 folder
- **THEN** "New folder" is disabled with the tooltip "Folders can be nested up to 4 levels"

#### Scenario: Delete folder
- **WHEN** a folder holding 3 projects is deleted and confirmed
- **THEN** the folder is gone and the 3 projects are in the trash

#### Scenario: Restore after folder deletion
- **WHEN** one of those 3 projects is restored
- **THEN** it is listed in the root

#### Scenario: Move into a descendant
- **WHEN** folder "A" is dragged onto its own subfolder "A/B"
- **THEN** the drop is refused and the tree is unchanged

### Requirement: Projects empty states
With no projects and no folders in the root, the screen SHALL show "No projects yet" with a "Create your first project" button and an "Import project" button. A search with no matches shows "No results found" with a "Clear search" button. An empty folder shows "This folder is empty" with "New project". [PORT P-024, P-025]

#### Scenario: Clear search
- **WHEN** a search has no matches and the user activates "Clear search"
- **THEN** the search field is empty and all projects are listed

### Requirement: Project thumbnail
The app SHALL render a thumbnail for each project from frame 0 of the main scene, including the canvas background and empty timelines (an empty project yields the background alone; a transparent background yields a transparent PNG), scaled to at most 640 px on the long side and stored as a JPEG (quality 0.8; PNG when the background is transparent) in the thumbnail store of `project-storage.Stored record layout`. The thumbnail is generated on load when absent and regenerated on every exit from the project and when the app moves to the background on mobile. When a cover exists (see `projects.Cover editor`), the cover is shown instead of the thumbnail in every project list. [PORT P-026, P-027] [NEW]

#### Scenario: Empty project
- **WHEN** an empty project with a blue background is exited
- **THEN** its card shows a solid blue 16:9 thumbnail

#### Scenario: Thumbnail size
- **WHEN** a 3840 × 2160 project is exited
- **THEN** the stored thumbnail is 640 × 360

### Requirement: Autosave and unsaved-work protection
Every change to project data SHALL be saved automatically per `project-storage.Autosave` (800 ms debounce) with no manual save action required. The editor header shows one save indicator, owned here and referenced by `app-shell-navigation.Top bar` and `mobile-editor.Top bar`, with exactly five states: "Saving…", "Saved", "Save failed — Retry" (activating it retries the save), "Offline changes" (a synced project has unpushed patches) and "Read-only — locked by {device}". When the failure is a full storage the indicator reads "Storage full — not saved" and the blocking dialog and banner of `project-storage.Autosave failure and storage-full handling` apply. On web, a `beforeunload` prompt is raised while a save is pending, in flight or failed. On desktop, closing the window or quitting flushes the pending save before the window closes, waiting up to 5 s and showing "Saving…" during the wait; when the flush fails the leave-without-saving dialog is shown. On mobile, moving to the background flushes the pending save. [PORT P-030, P-031] [CAPCUT CC-003]

#### Scenario: Web unload during a pending save
- **WHEN** the user closes the browser tab 200 ms after an edit
- **THEN** the browser's leave-page prompt is shown

#### Scenario: Desktop quit
- **WHEN** the user quits the desktop app 200 ms after an edit and reopens the project
- **THEN** the edit is present

#### Scenario: Save failure indicator
- **WHEN** a save fails three retries with a storage read-write error
- **THEN** the indicator shows "Save failed — Retry" and activating it retries the save

#### Scenario: Storage full
- **WHEN** a save fails because storage is full
- **THEN** the indicator reads "Storage full — not saved" and the storage-full dialog is shown

#### Scenario: Locked by another device
- **WHEN** a synced project is opened while the device "Studio Mac" holds the edit lease
- **THEN** the indicator reads "Read-only — locked by Studio Mac"

### Requirement: Project settings surface
The editor SHALL expose project settings in one modal dialog 640 px wide (full-screen sheet on phones) with two tabs, "Project info" and "Background", opened by "Modify" in the inspector Details view shown when nothing is selected (`preview-canvas.Inspector empty state and project details`), by "Project settings…" in the editor header menu, and on mobile by the root toolbar entries "Aspect ratio" and "Background" of `mobile-editor.Root toolbar`, each opening the matching part as a bottom sheet. There is no project Settings tab in the asset panel. "Project info" contains: name (editable per `projects.Rename project`), storage location (desktop: path, read-only with "Reveal in file manager"; elsewhere "App storage"), aspect ratio and resolution, frame rate, the switch "Use proxies for preview" of `media-library.Proxy media`, and the sync control of `projects.Per-project sync entry points`. "Background" edits the project default background (`projects.Background colour and gradient`, `projects.Background blur and image`, `projects.Transparent background`); a selected clip's own background is edited in the inspector per `timeline-editing.Per-clip canvas background`. Every settings change is an undoable command; live previews (colour picker drag, slider drag) use non-history updates and commit one undo step on release. Audio sample rate is not a project setting; it is an export setting of `export-share.Audio settings for video export`. [PORT S-001, S-014] [CAPCUT CC-005]

#### Scenario: Undo a frame-rate change
- **WHEN** the frame rate is changed from 30 to 60 and undo is invoked
- **THEN** the frame rate is 30

#### Scenario: One step per colour drag
- **WHEN** the user drags inside the background colour picker and releases
- **THEN** the background shows the final colour and exactly one undo step was added

#### Scenario: Entry from the inspector
- **WHEN** nothing is selected and the user chooses "Modify" in the inspector Details view
- **THEN** the project settings dialog opens on the "Project info" tab

### Requirement: Canvas size presets and custom size
The aspect-ratio control SHALL offer these presets: 16:9 (1920 × 1080), 9:16 (1080 × 1920), 1:1 (1080 × 1080), 4:3 (1440 × 1080), 3:4 (1080 × 1440), 4:5 (1080 × 1350), 2:1 (2160 × 1080), 2.35:1 (2538 × 1080), 1.85:1 (1998 × 1080), 21:9 (2520 × 1080), "Original" (the size adopted from the first media per `projects.Canvas and frame rate adoption from first media`, shown when `originalCanvasSize` is set), and "Custom" with width and height fields accepting integers from 16 to 7680, rounded to the nearest even number, with width × height ≤ 33 177 600 (7680 × 4320). A resolution selector scales the current ratio to a short side of 480, 720, 1080, 1440 or 2160 px. The last custom size is remembered in `lastCustomCanvasSize` and restored when Custom is reselected. Changing the canvas size keeps every element's scale relative to its contain-fit and multiplies element positions by `newWidth/oldWidth` and `newHeight/oldHeight`, in the same undo step. This list is the only preset list of the product; `settings-preferences` and `export-share` reference it. [PORT S-004, S-005, S-006] [CAPCUT CC-006, CC-007] [NEW]

#### Scenario: Switch to portrait
- **WHEN** a 1920 × 1080 project with one centred full-frame clip is switched to 9:16
- **THEN** the canvas is 1080 × 1920 and the clip is contain-fitted and centred, with the background visible above and below it

#### Scenario: Custom size remembered
- **WHEN** the user sets Custom 1000 × 500, selects 1:1, then selects Custom again
- **THEN** the canvas is 1000 × 500

#### Scenario: Out-of-range custom value
- **WHEN** the user enters width 9000
- **THEN** the field shows the validation message "Width must be between 16 and 7680" and the canvas is unchanged

#### Scenario: Odd value
- **WHEN** the user enters height 1081
- **THEN** the canvas height becomes 1082

#### Scenario: Ultra-wide preset
- **WHEN** 21:9 is selected
- **THEN** the canvas is 2520 × 1080

### Requirement: Frame rate
Project frame rate SHALL be a rational `{numerator, denominator}`. The selector offers ten rates: 23.976 (24000/1001), 24, 25, 29.97 (30000/1001), 30, 48, 50, 59.94 (60000/1001), 60 and 120 fps; factory default 30/1. A stored rate not in the list is displayed as its decimal value with two fraction digits and stays selectable. Changing the frame rate re-rounds element times, marker times, range points, transition durations and keyframe times to the new frame grid in the same undo step, without ever creating an overlap or an element shorter than one frame. Per track, in start order: `start = roundToFrame(start)`, raised to the previous element's new end when it would be smaller; `end = max(start + one frame, roundToFrame(end))`; an element pushed right by this rule pushes the following ones as needed, and attached and linked elements follow per `timeline-editing.Linkage`. Where no push is needed a time moves by at most half a new frame; a pushed element moves by at most one new frame per one-frame element before it. Marker times that collide after rounding keep the earlier marker on that frame and move the other one to the next free frame. The result MUST pass `project-document.Document validator`. [PORT S-002, S-003] [NEW]

#### Scenario: NTSC rate
- **WHEN** 29.97 is selected
- **THEN** the project stores numerator 30000 and denominator 1001

#### Scenario: 48 fps
- **WHEN** 48 is selected
- **THEN** the project stores numerator 48 and denominator 1

#### Scenario: Regrid on change
- **WHEN** a 60 fps project with a clip starting at frame 1 (2000 ticks) is changed to 30 fps
- **THEN** the clip start is 4000 ticks (half rounds away from zero) and undo restores 2000 ticks at 60 fps

#### Scenario: One-frame clips do not collide
- **WHEN** a 60 fps project holds three adjacent one-frame clips at ticks 0, 2 000 and 4 000 and the frame rate is changed to 30 fps
- **THEN** the clips are at 0–4 000, 4 000–8 000 and 8 000–12 000 ticks, none overlaps another, and one undo restores the 60 fps times

### Requirement: Canvas and frame rate adoption from first media
Adoption SHALL run only for a property that is armed, and "armed" is stored in the document: `settings.adoptCanvasFromFirstMedia` and `settings.adoptFrameRateFromFirstMedia` (`project-document.Project settings`) are written `true` by `projects.Create project` when the corresponding "New project" preference is "Match first clip" or unset, and are set to `false` — in the same undo step — by the adoption itself and by any explicit change of that property by the user or a tool. When the first element ever inserted into such a project is a video or image, the insert sets `canvasSize` and `originalCanvasSize` to the asset's exact display dimensions (after rotation metadata, rounded to even numbers, clamped to the custom-size limits; never rounded to a preset) and, for video, sets the frame rate to the nearest rate of `projects.Frame rate` to the asset's frame rate; these changes are part of the insert's undo step. When a video with a higher frame rate than the project is imported into the library and the frame rate is still armed, the project frame rate is raised to the nearest listed rate not above the asset's rate and a toast "Project frame rate changed to {fps} fps" with an "Undo" action is shown. Neither rule runs after the user has explicitly chosen a canvas size or frame rate, and an explicit choice disarms only the property that was chosen. [PORT S-007, S-008] [NEW]

#### Scenario: Portrait phone clip first
- **WHEN** a 1080 × 1920, 60 fps video is the first element inserted into a new project with untouched preferences
- **THEN** the canvas is 1080 × 1920, the frame rate is 60 fps, and one undo removes the clip and restores 1920 × 1080 at 30 fps

#### Scenario: Exact size, not a preset
- **WHEN** a 1000 × 562 image is the first element inserted
- **THEN** the canvas is 1000 × 562

#### Scenario: 48 fps source
- **WHEN** a 48 fps video is the first element inserted
- **THEN** the project frame rate is 48/1

#### Scenario: Explicit setting wins
- **WHEN** the user has set the frame rate to 24 fps and then imports a 60 fps video
- **THEN** the project frame rate stays 24 fps and no toast is shown

### Requirement: Background colour and gradient
A canvas background SHALL be one value of the union of `project-document.Canvas background union` (kinds `color`, `gradient`, `blur`, `image`, `transparent`; colours stored as lowercase `#rrggbb`), which this capability does not restate; this capability owns what each kind means and how it is edited. The union is used for the project default (`settings.background`) and for the per-clip override owned by `timeline-editing.Per-clip canvas background`; the project default is what renders wherever no main-track clip with its own background covers the frame, in the scene being presented — the main scene, or whichever scene is open in the editor. A scene rendered as the source of a compound clip draws no background at all unless its `compoundBackground` is `"own"` (`project-document.Compound background rule`), so a compound clip built from overlay elements never hides what lies beneath it. The Background editor (the project settings "Background" tab, and the same panel in the inspector for a selected clip) offers: a "Colors" section with the 24 solid swatches of `catalog.md` §1 and a custom colour picker (live preview while dragging, one undo step on release); a "Gradients" section with the 16 presets of `catalog.md` §2; a "Patterns" section with the 16 presets of `catalog.md` §3; and a gradient editor (linear or radial, 2–8 stops, angle 0–360° in 1° steps) that writes a `gradient` value. `catalog.md` next to this spec is normative for the ids, names and values; the lists are JAgentChill-authored and no OpenCut classic preset file is ported. Which gradient strings are valid and how they rasterise (linear, radial, repeating and layered forms, units, unsupported forms rendering `#000000` with a diagnostic) is defined in `render-engine.Background gradient parsing`; a stored string is never rewritten. Every swatch and preset MUST render in the export within the preview-versus-export tolerance of `render-engine.Golden-frame determinism` (maximum per-channel difference 1). [PORT S-009, S-010, S-011, S-012] [CAPCUT CC-008, CC-011]

#### Scenario: Solid colour
- **WHEN** the swatch `sw-red` is chosen as project default in a project whose clip does not cover the canvas
- **THEN** the uncovered canvas area is `#E5383B` in preview and in the exported file

#### Scenario: Gradient
- **WHEN** a linear gradient from `#000000` to `#FFFFFF` at 90° is applied
- **THEN** the left edge of the canvas renders black and the right edge white

#### Scenario: Catalogue counts
- **WHEN** the Background editor is opened
- **THEN** it lists 24 solid swatches, 16 gradients and 16 patterns with the ids of `catalog.md`

#### Scenario: Every preset matches between preview and export
- **WHEN** each of the 56 catalogue entries is applied in turn to an empty 1920 × 1080 project and frame 0 is rendered in the preview at full quality and in an export
- **THEN** for every entry the two frames differ by at most 1 per channel

#### Scenario: Project default applies to every presented scene
- **WHEN** the project default background is changed while scene 2 is active
- **THEN** the main scene shows the same background wherever no clip override applies

#### Scenario: Compound source has no background of its own
- **WHEN** the project default background is `#000000` and a compound clip made of a title and a sticker sits above a main-track video
- **THEN** the video is visible around the title and sticker; the black default is drawn only behind the main track of the presented scene

### Requirement: Background blur and image
The Background editor SHALL offer "Blur": the background is a blurred, cover-fitted copy of the main-track clip at each frame (the clip's own picture, so mixed portrait and landscape clips each get their own blur), with presets Light (100), Medium (200) and Heavy (500) each shown with a live preview tile, and an intensity slider 0–1000 (step 10); stored as `{kind: "blur", blurIntensity}`. Switching the kind to Blur from any other kind always sets `blurIntensity` to 200 (a background value keeps no memory of another kind, `project-document.Canvas background union`; an earlier blur value is brought back with Undo); the classic constant 10 is not used. Where no main-track media exists at a frame the blur background renders `#000000`. It SHALL also offer "Image": the user picks an image from the media library or imports one; it is stored as `{kind: "image", mediaId, fit}` with fit `cover` (default), `contain` or `stretch`; a missing image asset renders `#000000` and the editor shows "Background image is missing" with "Choose another". [PORT S-013] [CAPCUT CC-009, CC-010] [NEW]

#### Scenario: Blur preset
- **WHEN** "Medium" is chosen for a 16:9 project holding a 9:16 clip
- **THEN** the areas left and right of the clip show the blurred clip and `blurIntensity` is 200

#### Scenario: First switch to blur
- **WHEN** the kind is switched from colour to Blur for the first time in a project
- **THEN** `blurIntensity` is 200

#### Scenario: Image background
- **WHEN** an image is chosen as background with fit `cover`
- **THEN** the image fills the canvas behind all clips without letterboxing

#### Scenario: Image removed from the library
- **WHEN** the background image asset is deleted
- **THEN** the background renders black and the editor shows "Background image is missing"

### Requirement: Transparent background
The Background editor SHALL offer "None" as the first swatch, stored as `{kind: "transparent"}`. A transparent background is drawn as a 16 px two-tone checkerboard in the player, in the cover editor and on project cards, and is cleared to `[0, 0, 0, 0]` and composited with straight (non-premultiplied) alpha by the engine (`render-engine.Background nodes`, `render-engine.Compositor algorithm`). It is the precondition of alpha export in `export-share.Alpha and intermediate codec export`; exports without an alpha channel flatten transparent areas onto `#000000`, and the export dialog states "Transparent areas will be black in this format". The value is the kind `transparent` of `project-document.Canvas background union` and is available both as the project default and as a per-clip background; inside gradient strings the CSS keyword `transparent` is accepted and interpolated in premultiplied colour (`render-engine.Background gradient parsing`), so the catalogue patterns that fade to `transparent` do not darken. [NEW]

#### Scenario: Alpha export precondition
- **WHEN** the project default background is "None" and no main-track clip overrides it
- **THEN** the alpha export option of `export-share` is enabled and an exported frame with no clip has alpha 0 in every pixel

#### Scenario: Non-alpha export
- **WHEN** the same project is exported as H.264 MP4
- **THEN** uncovered areas are `#000000` and the dialog showed the flattening notice before export

#### Scenario: Checkerboard is not exported
- **WHEN** a snapshot of the player is saved from a transparent project
- **THEN** the PNG has alpha 0 in uncovered areas and contains no checkerboard

### Requirement: Cover editor
This requirement owns the project cover. Each project SHALL support a cover `{source: "frame" | "image", sceneId?, time?, mediaId?, crop?, texts[], image}` where `image` references the rendered cover in the cover store. The cover editor is opened from: the Projects menu item "Edit cover"; "Edit cover…" in the editor header menu; the "Cover" button of the main-track header on desktop and web (`timeline-editing.Track header column and row dimensions`); the cover entry before the main track on mobile (`mobile-editor.Mute-all and cover entries`); and the export dialog (`export-share.Cover embedding`). It lets the user pick a frame by scrubbing a filmstrip of the main scene (frame-accurate, with the current time shown as `HH:MM:SS:FF`), or upload or pick an image (cropped to the canvas ratio with a pan-and-zoom cropper, zoom 1×–8×), and add up to 5 text layers using the text styling of `text-and-titles.Text parameter table`, starting from scratch or from one of the 6 cover text layouts of `catalog.md` §4. Saving renders the cover at canvas resolution capped at 1920 px on the long side, as JPEG quality 0.9 (PNG when the project background is transparent), and stores it with the project; "Reset" removes the cover so the automatic thumbnail is used. The cover is used as the project card image and is offered to `export-share.Cover embedding` as the video poster image; it is never part of the timeline. Cover changes are saved with the project and are undoable while the editor is open. When the picked scene or media asset no longer exists the stored cover image is kept and the editor opens on frame 0 of the main scene. [CAPCUT CC-012, CC-013] [NEW]

#### Scenario: Pick a frame
- **WHEN** the user scrubs to 12 s in the cover editor and saves
- **THEN** the project card shows the frame at 12 s and the cover stores `source: "frame"` with that time

#### Scenario: Cover text
- **WHEN** the user applies the layout `cv-title-bottom`, types "Episode 1" and saves
- **THEN** the cover image contains the text in the layout's position and the timeline is unchanged

#### Scenario: Sixth text layer
- **WHEN** the cover has 5 text layers
- **THEN** "Add text" is disabled with the tooltip "A cover can have up to 5 texts"

#### Scenario: Size cap
- **WHEN** a cover is saved in a 3840 × 2160 project
- **THEN** the stored cover is 1920 × 1080

#### Scenario: Reset
- **WHEN** Reset is chosen
- **THEN** the project card shows the frame-0 thumbnail again

#### Scenario: Desktop entry from the timeline
- **WHEN** the user clicks "Cover" in the main-track header on desktop
- **THEN** the cover editor opens for the open project

### Requirement: Project links to scripts, workflows and films
A project document SHALL carry optional origin links: `filmLink {filmId, episodeId}` (created by `film-production.Assembly of an episode into a timeline project`), `workflowLink {runId}` (created by an `agent-workflows` run through its editor node or by `prompt-to-video-workflow.Assembly into a real editor timeline`) and `scriptLinks[] {scriptId}` (maintained by `script-studio.Two-way links between shots and timeline clips`; at most 20). Element-level links are owned by `timeline-editing.Element provenance link`. Links are part of the project document, survive rename, duplicate, package export and import, and sync; they are shown as chips "From film", "From workflow" and "From script" on the project card, in Project info and in the inspector Details view. Activating a chip opens the target (film studio, run view, script) when it exists on this device or on the connected Gateway; film and workflow targets need a connected Gateway, and without one the chip shows the tooltip "Connect to {host} to open". A link whose target was deleted shows "Source no longer available" and offers "Remove link". "Remove link" is an undoable command and never changes timeline content. The project itself stays fully editable and exportable without any of the targets. [NEW]

#### Scenario: Project created by a film assembly
- **WHEN** an episode is assembled into a project
- **THEN** the project card shows "From film" and activating it with the Gateway connected opens that episode in the film studio

#### Scenario: Offline
- **WHEN** the same project is opened with no Gateway connected
- **THEN** it opens and edits normally and the chip tooltip reads "Connect to {host} to open"

#### Scenario: Deleted script
- **WHEN** a linked script was permanently deleted
- **THEN** the chip reads "Source no longer available" and "Remove link" removes the entry from `scriptLinks` in one undo step

### Requirement: Per-project sync entry points
With a paired Gateway, each project SHALL expose the sync control of `cross-device-sync.Per-project sync enablement` in two places — "Sync with {host}…" / "Stop syncing" in the per-project menu, and a "Sync with {host}" switch on the "Project info" tab of project settings — and its state in `projects.Project info` and as a cloud badge on the project card (synced, syncing, paused, error). Enabling or disabling sync requires the `editor` or `admin` role (scope `jagentchill.projects.write`); on a `viewer` device the control is disabled with the tooltip "Your role on this host is view-only". Without a paired Gateway the control is not shown. The behaviour of sync itself is not defined here. [NEW]

#### Scenario: Enable from the menu
- **WHEN** an `editor` device chooses "Sync with Studio Mac…" on a local project and confirms
- **THEN** the card shows the syncing badge and then the synced badge when the first push completes

#### Scenario: Viewer
- **WHEN** a `viewer` device opens project settings of a synced project
- **THEN** the sync switch is disabled with the view-only tooltip

### Requirement: Project package export
"Export package" SHALL write a single `.jagentchill` file (MIME `application/vnd.jagentchill.project+zip`) following the common package rules of `project-storage.Package and file formats`: a ZIP (ZIP64 when larger than 4 GiB) containing `manifest.json` (`format: "jagentchill-project"`, `formatVersion: 1`, `schemaVersion`, `minReaderSchemaVersion`, app version, `exported_ms`, project id and name, and a media entry list with asset id, sha256, byte size, variant (`original` or `mezzanine`) and original file name), `project.json` (the canonical project document of `project-document.Canonical JSON serialisation`: it contains the asset records with their names, tags, library folders and provenance, the template state and the provenance links, and it has NO `local` section — no folder id, trash state, view state, external path or grant), `media/<sha256>` (original media bytes, stored without recompression), and `cover` and `thumbnail` images when present. An option "Include media" (default on) controls whether media bytes are written; with it off, assets are listed in the manifest as external. On desktop, externally referenced files are embedded when "Include media" is on. Image and video mezzanines of assets whose original the importing device is possibly unable to decode (HEIC/HEIF stills, `media-library.Undecodable media handling`) are included as `media/<sha256>` entries of variant `mezzanine`. Proxies, caches, snapshots, the undo history and UI preferences are never included. The file is written by streaming (File System Access or native file; browsers without it use a streamed download) so the peak additional memory stays below 256 MiB regardless of package size. A progress dialog shows percentage and Cancel; cancelling deletes the partial file. Offline assets are skipped and listed in a completion summary. Default file name: `<project name>.jagentchill` with characters illegal in file names replaced by `_`. [PORT N-018] [NEW]

#### Scenario: Round trip
- **WHEN** a project with 3 media assets is exported with media and the package is imported on another device
- **THEN** the imported project renders every frame within the preview-versus-export tolerance of `render-engine.Golden-frame determinism` and lists 3 online assets

#### Scenario: Cancel
- **WHEN** the user cancels at 40 %
- **THEN** no `.jagentchill` file remains at the destination

#### Scenario: Without media
- **WHEN** "Include media" is off
- **THEN** the package contains no `media/` entries and its manifest lists each asset as external

#### Scenario: Memory bound
- **WHEN** a project with 10 GiB of media is exported as a package on the reference desktop of `diagnostics-quality.Performance budgets`
- **THEN** the peak resident-memory increase of the app during the export is below 256 MiB

#### Scenario: Library metadata survives the round trip
- **WHEN** a project whose assets have tags, library folders and stock provenance is exported and imported on another device
- **THEN** every asset has the same name, tags, folder and provenance, and `project.json` in the package has no `local` key

### Requirement: Project package import
"Import…" (Projects screen, drag-and-drop of a `.jagentchill` file onto the Projects screen, the desktop file association of `desktop-app.File associations` and the mobile share/open-in target) SHALL validate the manifest and the archive per `project-storage.Package and file formats`, check quota for the total media size per `project-storage.Quota evaluation`, and always create a new project in the current folder with a new id — an existing project with the same id or name is never replaced, and when a project with the same name exists the duplicate naming rule of `projects.Duplicate project` applies. A package with a lower `schemaVersion` is migrated per `project-storage.Migration chain`; a package whose `minReaderSchemaVersion` is higher than the app's schema version is rejected with "This project was created with a newer version of JAgentChill. Update the app to open it." Media entries are verified against their sha256; a mismatching or missing entry is imported as an offline asset and reported in the summary. Corrupt archives are rejected with "The file is not a valid JAgentChill project" and leave no partial project. Import shows progress and supports Cancel, which removes everything written. Origin links are kept as stored. The imported document receives a fresh `local` section built on this device (folder = the current folder, every asset `storage: "managed"`, `present` set from the entries actually imported); a `local` key found in a package is ignored and never creates an external-file grant. [PORT N-018] [NEW]

#### Scenario: Newer schema
- **WHEN** a package whose `minReaderSchemaVersion` is greater than the app's current schema version is imported
- **THEN** the import is rejected with the update message and no project is created

#### Scenario: Same project imported twice
- **WHEN** the same package "Trip.jagentchill" is imported twice
- **THEN** two projects exist, "Trip" and "(1) Trip", with different ids

#### Scenario: Corrupt media entry
- **WHEN** one media entry fails its sha256 check
- **THEN** the project is imported, that asset is offline, and the summary names it

#### Scenario: Insufficient storage
- **WHEN** the package's media exceed the available storage after the 50 MiB reserve
- **THEN** the import is refused before any media is written and the quota message of `project-storage.Quota evaluation` states the required and available sizes

### Requirement: OpenCut classic data import
"Import…" → "From OpenCut" SHALL import OpenCut classic data from a classic data bundle: a ZIP with `classic-manifest.json` (`format: "opencut-classic-bundle"`, `formatVersion: 1`, origin, `exported_ms`), `projects.json` (records of the classic `video-editor-projects` store), `timelines/` (records of legacy `video-editor-timelines-*` stores when present), `media/<projectId>/metadata.json` and `media/<projectId>/<assetId>` files, `saved-sounds.json` (the `user-sounds` record) and `local-storage.json` containing exactly the keys `opencut-keybindings`, `timeline-store`, `preview-settings`, `panel-sizes`, `assets-panel`, `projects-view-mode`, `stickers-settings`, `graph-editor-presets` and the theme key. Because browser storage is bound to its origin, the bundle is produced on the classic origin by the user: the dialog shows three numbered steps — open the tab where OpenCut runs, open the browser console, paste the exporter — with a "Copy script" button that copies the self-contained script `docs/product/classic-export.js` (also offered as a bookmarklet link); the script only reads the classic stores and writes the ZIP through `showSaveFilePicker`, falling back to a streamed download. In-place detection is an additional path of the web build only: when the app's own origin contains a `video-editor-projects` IndexedDB database (a self-hosted deployment on the origin where classic ran), the Projects screen shows a banner "OpenCut projects found — Import"; desktop and mobile never share an origin with classic and offer only the bundle. In both paths each classic project of schema v0–v31 is copied (the classic stores are never modified or deleted) and ingested per `project-storage.Classic bundle ingestion`, and is listed with an "Imported" label until first opened. Projects that fail migration are skipped and listed in a summary with the failing step; the others are still imported. The exporter and import are covered by an end-to-end test that runs the script against a seeded classic build and imports the resulting bundle. [PORT ST-006] [NEW]

#### Scenario: Bundle with mixed versions
- **WHEN** a bundle containing a v12 project and a v31 project is imported
- **THEN** both appear in the Projects list at the current schema version with their media online

#### Scenario: Exporter round trip
- **WHEN** the copied script is run in the console of a seeded classic build holding 2 projects, 3 media files and 1 saved sound, and the downloaded ZIP is imported
- **THEN** 2 projects with 3 online assets and 1 saved sound exist in JAgentChill and the classic stores are unchanged

#### Scenario: Classic data untouched
- **WHEN** an in-place import completes on the web build
- **THEN** the `video-editor-projects` database and classic OPFS directories still contain their original records

#### Scenario: Desktop has no in-place path
- **WHEN** the Projects screen opens in the desktop app
- **THEN** no "OpenCut projects found" banner is shown and "From OpenCut" offers the bundle steps

#### Scenario: One project fails
- **WHEN** one of three classic projects has a record that a migration step cannot transform
- **THEN** two projects are imported and the summary names the third with the step at which it failed

### Requirement: Projects screen on mobile and keyboard access
On phones the Projects screen SHALL show a 2-column grid by default, a floating "New project" button, search and sort in a collapsible header, and actions in bottom sheets (no hover menus); on tablets the `/projects` screen uses the desktop layout, while the mobile home grid is owned by `app-shell-navigation.Mobile home with project grid`. On desktop and web every action SHALL be reachable by keyboard through actions registered in `keyboard-shortcuts.Action registry` in the `list` context — `list.open`, `list.toggle-select`, `list.rename`, `list.delete` (with the confirmation dialog) and arrow-key focus movement between cards — whose default bindings are stated only in `keyboard-shortcuts.Default bindings for project, application, session and lists`. The visual style follows `design-system`. [NEW]

#### Scenario: Keyboard open
- **WHEN** a project card has focus and the binding of `list.open` is pressed
- **THEN** the project opens in the editor

#### Scenario: Keyboard trash
- **WHEN** a project card has focus and the binding of `list.delete` is pressed
- **THEN** the "Move '{name}' to trash?" dialog opens with focus on Cancel

#### Scenario: Phone actions
- **WHEN** the user long-presses a project card on a phone
- **THEN** selection mode starts and the bulk actions are shown in a bottom bar
