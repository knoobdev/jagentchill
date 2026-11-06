## ADDED Requirements

### Requirement: Global shell layout
On medium and wide form factors (`design-system.Breakpoints and layout constants`: viewport ≥ 720 px) the app SHALL render a two-column shell: a sidebar at the inline-start edge (240 px by default, `bg/sidebar`, 1 px `border/hairline` inline-end edge) and a main column made of a 48 px top bar above the content region (`bg/app`). At 960×600, the minimum window of `desktop-app.Windows and window state`, every region of the shell is usable and the sidebar's secondary list keeps at least 240 px of height (`app-shell-navigation.Primary navigation`). The content region shows either a centred column (home, lists, settings pages), a split view (session: chat | workspace) or a full-bleed screen (editor, workflow canvas, workspace, script editor). The shell uses only the tokens and components of `design-system` and carries only JAgentChill's own name and mark. The shell SHALL stay mounted while the content region navigates, so that sidebar scroll position, list expansion and drafts survive navigation. The editor screen (`/editor/[projectId]`) SHALL hide the sidebar by default and use the full window; the sidebar can be shown over it with the action `view.sidebar.toggle`. This capability owns the frame of every screen (regions, sizes, persistence, routes); the content of each region is owned by the capability named in `app-shell-navigation.Route map`. [NEW]

#### Scenario: Desktop shell regions
- **WHEN** the app opens at 1440×900 on the Sessions screen
- **THEN** a 240 px sidebar, a 48 px top bar and the content region are visible, separated by 1 px hairlines and no shadows

#### Scenario: Shell persists across navigation
- **WHEN** the user scrolls the sidebar list, opens a session and then opens Automations
- **THEN** the sidebar is not re-mounted and its scroll position is unchanged

#### Scenario: Editor uses the full window
- **WHEN** the user opens a project in the editor at 1440 px width
- **THEN** the sidebar is hidden and the editor's regions span the window

### Requirement: Sidebar header and host switcher
The sidebar's top row SHALL show the active host's avatar (20 px rounded square with initial), the host name truncated to one line and a chevron, and at the inline-end side a search icon button (opens `keyboard-shortcuts.Command palette`) and a collapse icon button. Activating the host name opens the host switcher popover containing: a card for the active host (name, connection state pill, Gateway version, this device's role — `admin`, `editor` or `viewer` — and the buttons "Host settings" and "Pair a device", which opens `/devices?pair=1`); a list of all hosts this device is paired with, each with avatar, name, the connection path label of `device-pairing-signing.Connection path indicator` ("This computer", "Local network" or "Tailnet"; every path is encrypted or loopback — there is no unencrypted network path) and the connection state of `device-pairing-signing.Connection liveness and backoff` (the six labels defined there, shown as a status dot plus text; a tailnet-only host whose tailnet node is signed out shows "Tailnet sign-in required" with "Sign in to Tailscale", which opens `/pair/tailnet`), with a check on the active one; an entry "This device only" that works without any Gateway; "Add a host…", which opens `/pair/start` (`app-shell-navigation.Pairing flow routes`); and "Disconnect from <host>" for the active host. There is no account, sign-in or log-out: identity is the paired device (`device-pairing-signing.Identity model without accounts`). Switching host changes a host-scoped route to the same section's index under the new host, closes host-scoped overlays, and keeps local routes unchanged. The last active host SHALL be restored on launch. The user-facing word for a Gateway is "host" on every shell surface ("Connect a host", "Requires a host", and the remote export target "Host: <name>" of `export-share`); "Gateway" appears only in diagnostics and developer-facing text. [PORT N-011] [JAD] [NEW]

#### Scenario: Switch host
- **WHEN** the user is on Sessions of host A and selects host B in the switcher
- **THEN** the route becomes `/h/<B>/sessions`, the sidebar secondary list shows host B's sessions and the check mark moves to host B

#### Scenario: Local-only mode
- **WHEN** the user selects "This device only"
- **THEN** every route marked "no" in the "Needs host" column of `app-shell-navigation.Route map` remains usable
- **AND** host-scoped destinations show the requires-host state of `design-system.Empty, error and offline states`

#### Scenario: Host offline
- **WHEN** the active host becomes unreachable
- **THEN** its state reads "Offline — retrying in N s" with "Retry now", host-scoped screens show the banner "Host offline — reconnecting…" over their last cached list (read-only), and local editing is unaffected

#### Scenario: No hosts paired
- **WHEN** the device has never paired with a host
- **THEN** the header shows "This device" and the switcher lists only "This device only" and "Add a host…"

### Requirement: Primary navigation
Below the header the sidebar SHALL list the destinations of the product, and this requirement is the only definition of primary navigation. There are **seven primary destinations**, always visible, followed by one **"More" group** holding six further destinations (decision B9). Each row is 28 px tall (44 px at compact-touch density, `design-system.Control size tokens and density rules`) with a 14 px icon and a label in `type/body`.

| # | Group | Label | Route opened | Needs host | Action id |
|---|---|---|---|---|---|
| 1 | primary | Home | `/home` with the composer focused | no | `nav.go.home` |
| 2 | primary | Projects | `/projects` | no | `nav.go.projects` |
| 3 | primary | Sessions | `/h/[hostId]/sessions` | yes | `nav.go.sessions` |
| 4 | primary | Workflows | `/h/[hostId]/workflows` | yes | `nav.go.workflows` |
| 5 | primary | Film Studio | `/h/[hostId]/film` | yes | `nav.go.film` |
| 6 | primary | Library | `/library` | no | `nav.go.library` |
| 7 | primary | Scripts | `/scripts` | no | `nav.go.scripts` |
| 8 | More | Agents | `/h/[hostId]/agents` | yes | `nav.go.agents` |
| 9 | More | Automations | `/h/[hostId]/automations` | yes | `nav.go.automations` |
| 10 | More | Workspaces | `/h/[hostId]/workspaces` | yes | `nav.go.workspaces` |
| 11 | More | Skills | `/h/[hostId]/skills` | yes | `nav.go.skills` |
| 12 | More | Usage | `/h/[hostId]/usage` | yes | `nav.go.usage` |
| 13 | More | Devices | `/devices` | no | `nav.go.devices` |

**The "More" group.** Row 8 of the sidebar is the "More" row (a `design-system.Disclosure` header with a chevron, action `nav.more.toggle`), collapsed by default; its open state is persisted per device. When open **inline**, its six rows are listed under it. Inline opening is used only when it leaves the secondary list at least 240 px: the sidebar body (window height minus the 48 px header and the footer) must be at least 660 px at regular density (7 × 28 + 28 + 6 × 28 + 240 + 28 for the list header); when it is smaller — including the 960×600 minimum window — activating "More" opens the same six rows as a popover menu anchored to the row instead, and an inline-open group is re-presented as that popover when the window shrinks. While the group is closed (or presented as a popover) and the current section is one of its six, the More row reads "More · <section label>" and is rendered selected; the row shows the sum of the count badges of its six destinations. Digit shortcuts follow the table order (digit n is row n for the seven primary destinations; `keyboard-shortcuts.Default bindings for project, application, session and lists`).

**Height budget.** The secondary list (`app-shell-navigation.Sidebar secondary list`) SHALL always keep at least 240 px of height. At the 960×600 minimum window and regular density the fixed parts are: header 48, seven rows 196, the More row 28 and the footer 44 — 316 px — which leaves 284 px for the secondary list; the promo card of `app-shell-navigation.Sidebar footer` is hidden whenever showing it would reduce the secondary list below 240 px. At compact-touch density on a pinned sidebar (tablets) the same rule is evaluated with 44 px rows. On compact form factors the navigation and the list are the two segments of the drawer (`app-shell-navigation.Mobile drawer and top bar`), so each has the full drawer height.

The row of the current section is rendered selected per `design-system.List rows and secondary list` and exposes `aria-current="page"`. Default key bindings for the `nav.go.*` actions are defined only in `keyboard-shortcuts`. The shell also registers, in `keyboard-shortcuts.Action registry`, the application-level actions its menus and buttons invoke: `app.settings` (opens `/settings`), `app.fullscreen`, `palette.open`, `help.shortcuts`, `project.new` (`projects.Create project`), `project.open` (opens `/projects`, or the native open dialog in the desktop app), `project.close` (the exit of `projects.Open and exit project`), `session.new` (opens `/home` with the target Chat), `script.new`, `nav.back`, `nav.forward`, `nav.more.toggle`, `nav.go.exports`, `nav.go.notifications`, `nav.go.trash`, `view.sidebar.toggle`, `view.focus-mode`, `view.focus-mode.exit`, `app.settings.close`, `app.escape`, `view.next-region`, `view.previous-region`, `editor.inspector.toggle`, `editor.agent-panel.toggle`, `editor.layout.apply`, `session.workspace.toggle`, `app.theme.system`, `app.theme.light`, `app.theme.dark`, `help.starter-tips`, `help.whats-new`, `help.feedback`, `help.diagnostics` and the non-bindable `assets-panel.show`; their default keys are stated only in `keyboard-shortcuts`. Destinations that need a host SHALL stay visible and enabled without one, carry the link badge of `design-system.Button` (`requiresHost`) and lead to the requires-host state. Every destination is visible to every device role; what a role can do inside a destination is decided by the owning capability (for example `workspaces-terminal.Workspaces index and start tiles` disables tiles a role cannot use). Rows are reachable by Tab as one roving-focus list (Up/Down move, Enter or Space activates; Right opens and Left closes the More group).

Sessions, Workflows, Film Studio, Scripts, Agents, Workspaces and Automations SHALL show a count badge when the count is above zero. The count of a section is: the number of unresolved `requiresAction` notifications (`notifications.Badges and counts`) that this device receives and whose subject belongs to that section, plus the number of failed runs of that section whose row has not been opened since the failure. A failed run stops counting when its row is opened on any device paired with the host. [NEW]

#### Scenario: Selected destination
- **WHEN** the current route is any Film Studio screen
- **THEN** the "Film Studio" row is selected and exposes `aria-current="page"`

#### Scenario: Order and groups
- **WHEN** the sidebar renders on a paired desktop
- **THEN** it lists Home, Projects, Sessions, Workflows, Film Studio, Library and Scripts in that order, followed by the "More" row, whose group holds Agents, Automations, Workspaces, Skills, Usage and Devices in that order

#### Scenario: Minimum window keeps the list
- **WHEN** the desktop window is 960×600 with the More group closed
- **THEN** the seven primary rows, the More row, the footer and at least 240 px of secondary list are visible without scrolling the navigation, and no promo card is shown if it would not fit

#### Scenario: More at the minimum window
- **WHEN** the user activates "More" in a 960×600 window
- **THEN** the six destinations open as a popover menu anchored to the row and the secondary list keeps its height

#### Scenario: More inline on a tall window
- **WHEN** the user activates "More" in a 1440×900 window
- **THEN** the six rows open inline under the More row, the secondary list still has at least 240 px, and the open state is restored at the next launch

#### Scenario: Current section inside a closed More group
- **WHEN** the current route is `/h/abc/skills` and the More group is closed
- **THEN** the More row reads "More · Skills" and is rendered selected

#### Scenario: Attention badge
- **WHEN** two sessions have pending tool approvals
- **THEN** the Sessions row shows a badge "2"
- **AND** the badge disappears when both approvals are resolved from any device

#### Scenario: Failed run stops counting when opened
- **WHEN** a workflow run failed, the Workflows badge shows "1" and the user opens that run
- **THEN** the badge is removed on every connected device within 2 s

#### Scenario: Destination without a host
- **WHEN** the user activates "Skills" in local-only mode
- **THEN** the requires-host state is shown with "Connect a host" and no list

### Requirement: Sidebar secondary list
Under the primary navigation the sidebar SHALL show a secondary list for the current section — the product's main index — with a header (section name plus icon buttons search, "+" create, ⋯ list options) and, except where the table says otherwise, groups with captions in `type/caption`: **Pinned**, user folders in the order the user arranged them, and **Recent** (most recently updated first, 30 items, with "Show more" loading 30 at a time). The list scrolls inside its own region and is never shorter than 240 px (`app-shell-navigation.Primary navigation`). The rows of each section are owned as follows; this requirement owns only the list frame.

| Section | Rows | Row content and status owned by |
|---|---|---|
| Projects | local and synced projects | `projects.Projects list` |
| Scripts | scripts | `script-studio.Scripts list` |
| Home | the Sessions list of the active host when a host is connected, otherwise the Projects list (the header names the list shown) | as for Sessions or Projects |
| Library | the seven library categories of `app-shell-navigation.Library screen`, as plain rows with item counts — no Pinned, folder or Recent groups and no "+" | this capability |
| Sessions | agent sessions | `chat-agent.Session list in the sidebar` |
| Workflows | workflows, then recent runs | `agent-workflows.Workflows list screen` |
| Film Studio | films | `film-production.Film list and creation` |
| Agents | sessions that currently have more than one agent, then recent team runs | `multi-agent-orchestration.Host-wide Agents screen` |
| Workspaces | folders and their workspaces | `workspaces-terminal.Sidebar workspace list with status, pin, rename and labels` |
| Automations | automations | `automations.Automations index` |
| Skills | installed skill families | `skills.Skills screen — Installed` |
| Usage | none (the secondary list is hidden) | — |
| Devices | this device, then paired devices | `device-pairing-signing.Device list management` |
| Exports, Notifications, Settings, Changelog, Trash, the pairing routes, the welcome flow and the not-found screen | the list of the last visited section of this table (these screens have no list of their own); with no previous section, the Home rule | as for that section |

Each row is a `design-system.List rows and secondary list` row with a title and a meta line. Unless the owning requirement defines its own meta line, the meta line shows, in priority order: an attention status in `warning/text` ("Needs approval", "Awaiting review", "Conflict"), a running status in `text/secondary` with an animated dot ("Working", "Rendering 42%", "Syncing"), a failed status in `danger/text` ("Failed"), a result-ready status in `success/text` ("Export ready", "Result ready"), a finished status in `purple/text` ("Completed", "Exported", "Merged"), or else the relative time of the last update — the tones of `design-system.Avatar, badge and status pill`, each preceded by that tone's icon so the status does not rest on colour. A session row additionally shows a lock glyph with the accessible text "Private" while the session is not shared with the host (`chat-agent.Session share control`). Rows with unseen updates show the 6 px `accent` dot. Empty lists show "No <items> yet". Search filters the list by title within 100 ms of a keystroke for up to 1,000 loaded rows. Row ⋯ and context menus provide Pin or Unpin, Move to folder ▸ (with "New folder"), Rename, and the section's own actions. Rows can be dragged onto folders and into Pinned on desktop and web; the same moves are available from the row menu on every platform. [NEW]

#### Scenario: Status meta line priority
- **WHEN** a session is running and also has a pending approval
- **THEN** its meta line reads "Needs approval" in `warning/text`

#### Scenario: Ready status
- **WHEN** a workflow run finishes with an exported video
- **THEN** its row meta reads "Export ready" in `success/text` and shows the unread dot until the user opens it

#### Scenario: Empty section
- **WHEN** the host has no sessions
- **THEN** the secondary list shows "No sessions yet" under the header and the "+" button remains available

#### Scenario: Pinning
- **WHEN** the user chooses "Pin" on a Recent row
- **THEN** the row moves to the Pinned group, keeps that position across restarts and, for host-scoped items, on other devices paired with the same host

#### Scenario: Usage has no secondary list
- **WHEN** the current section is Usage
- **THEN** the sidebar shows the primary navigation only

#### Scenario: Home shows an index
- **WHEN** the current route is `/home` with a host connected
- **THEN** the secondary list shows the host's sessions under the header "Sessions", and in local-only mode it shows the projects under "Projects"

#### Scenario: Library list has no groups
- **WHEN** the current section is Library
- **THEN** the secondary list shows exactly the seven category rows and no Pinned, folder or Recent caption

#### Scenario: Completed is purple
- **WHEN** a session's last run completed with nothing waiting
- **THEN** its meta line reads "Completed" in `purple/text` with the double-check icon

### Requirement: Sidebar footer
The sidebar footer SHALL show, at the inline-start side, a connection chip for the active host whose label is one of the connection states of `device-pairing-signing.Connection liveness and backoff` or "Local only" when "This device only" is selected (activating it opens `/devices`), and, at the inline-end side, four icon buttons: **Exports** (opens `/exports`; shows a badge with the number of queued and running export jobs on this device and on the active host), **Settings** (opens `/settings`), **Notifications** (unread count badge; opens `notifications.Notification inbox`) and **Help** (menu: Keyboard shortcuts, Starter tips, What's new — opens `/changelog`, Send feedback — opens the form of `diagnostics-quality.Local feedback capture`, About — opens `/settings/about`). In the desktop app the chip's popover additionally shows the supervisor detail of `desktop-app.Host status surface`.

Above the footer one dismissible promo card SHALL appear at a time, chosen by this priority among the cards that are eligible:
1. "Update ready — Restart" (desktop, when `updates-distribution.Desktop automatic update` reports a downloaded update); action restarts and installs.
2. "Install the desktop app" (web build running on a desktop OS, only when the build-time value `JAGENTCHILL_DOWNLOAD_URL` of `updates-distribution.Release artifacts and integrity` is set); action opens that URL in a new tab.
3. "Pair your phone" (desktop app on macOS, Windows or Linux with a running built-in host and no paired mobile device); action opens `/devices?pair=1`, whose offer sheet leads to `desktop-app.Network access setting` ("Open Network access") while the host is reachable on this computer only.

A promo card is shown only while the secondary list keeps at least 240 px (`app-shell-navigation.Primary navigation`); when it does not fit it is not shown and stays eligible. Each card has a title, one action and a ×; dismissal is remembered per card id and device for 30 days, except the update card, which returns at the next launch. [PORT SH-004] [NEW]

#### Scenario: Promo dismissal
- **WHEN** the user dismisses "Pair your phone"
- **THEN** the card is not shown again on that device for 30 days

#### Scenario: Promo priority
- **WHEN** "Update ready" and "Pair your phone" are both eligible
- **THEN** only "Update ready — Restart" is shown

#### Scenario: Download URL not configured
- **WHEN** the web build was made without `JAGENTCHILL_DOWNLOAD_URL`
- **THEN** "Install the desktop app" is never shown

#### Scenario: Notification badge
- **WHEN** three notifications are unread
- **THEN** the Notifications icon button shows a badge "3" and its accessible name is "Notifications, 3 unread"

#### Scenario: Exports badge
- **WHEN** one export is running on this device and one is queued on the active host
- **THEN** the Exports button shows a badge "2" and opens `/exports` on the Queue tab

### Requirement: Sidebar collapse, resize and persistence
The sidebar SHALL collapse to zero width through its collapse button, the top-bar panel toggle and the action `view.sidebar.toggle`, with a `motion/slow` (240 ms) slide; while collapsed, a panel-toggle button appears at the inline-start side of the top bar and, on desktop and web, at regular density moving the pointer to within 8 px of the inline-start window edge for 300 ms shows the sidebar as a temporary overlay; the pointer can move onto the overlay, which stays while the pointer or keyboard focus is inside it, hides 300 ms after both have left and closes on Escape (the hover rule of `design-system.Tooltip`). At compact-touch density there is no hover reveal: the top-bar panel toggle is the way to show the sidebar. The sidebar's inline-end edge is a splitter allowing widths from 200 to 360 px; double-click resets to 240. Collapsed state, width, expanded folders and the selected section are persisted per device and per window. In the desktop app the header row leaves a 78 px inset for macOS traffic lights, and the top bar leaves, on Windows and Linux, the window-control inset measured at run time by `desktop-app.Windows and window state` (native caption buttons on Windows; app-drawn buttons on Linux, on the side and in the set the desktop's button layout prescribes); the top bar outside its controls drags the window on the three systems. [JAD] [NEW]

#### Scenario: Collapse and restore
- **WHEN** the user collapses the sidebar and restarts the app
- **THEN** the sidebar is collapsed after restart and the top-bar toggle restores it to its previous width

#### Scenario: Resize limits
- **WHEN** the user drags the sidebar edge to 150 px
- **THEN** the width stops at 200 px

### Requirement: Top bar
The top bar SHALL contain, from inline-start to inline-end: in the desktop app on Windows and Linux, the application menu button of `design-system.Application menu button` (on every screen, including the editor, the welcome flow and the pairing routes; it carries the whole menu of `desktop-app.Native application menu`, which macOS shows in the system menu bar; absent on macOS, web and mobile); the panel toggle (only when the sidebar is collapsed); back and forward buttons (desktop app on macOS, Windows and Linux; they invoke `nav.back` and `nav.forward` and are disabled at the ends of the window's history); a `design-system.Breadcrumb` or title area; tag chips for the current item — for a session, first the access chip "Private" or "Shared with host", which opens `chat-agent.Session share control` (sessions are private by default) — and at the inline-end side the screen's actions, a ⋯ menu and, in split views, the workspace-panel toggle. The title is editable in place where the item is renamable: click or the action `list.rename` enters editing, Enter or blur saves the trimmed value, an empty value reverts, Escape reverts; titles are limited to 120 characters. Breadcrumbs collapse as `design-system.Breadcrumb` defines. The contents of a screen's actions and ⋯ menu are owned by the screen's owning capability (for a session: `chat-agent.Session menu`).

In the editor the top bar SHALL show (after the application menu button on Windows and Linux) the editor menu button of `app-shell-navigation.Editor header menu`, the project name with the save-state indicator of `projects.Autosave and unsaved-work protection` (its five states are defined only there), undo and redo buttons, toggle buttons for the asset panel, inspector and timeline, the agent panel toggle (`app-shell-navigation.Editor agent panel`), an export-activity indicator that opens `/exports` while an export of this project is queued or running, a "Shortcuts" button, and the Export button as the single `primary` action. On compact form factors the shell top bar is 56 px and shows a drawer button, the title and ⋯ only (a session's access chip moves into the ⋯ menu); the compact editor uses the 44 px bar of `mobile-editor.Top bar` instead. [PORT SH-004] [CAPCUT CC-282] [NEW]

#### Scenario: Inline rename
- **WHEN** the user clicks a session title, types a new name and presses Enter
- **THEN** the title is saved trimmed and the sidebar row updates

#### Scenario: Empty rename reverts
- **WHEN** the user clears the title and blurs the field
- **THEN** the previous title is restored and nothing is saved

#### Scenario: Title length limit
- **WHEN** the user pastes 300 characters into a title field
- **THEN** the field holds the first 120 characters

#### Scenario: Save state in the editor
- **WHEN** an edit is made in the editor
- **THEN** the top bar shows the states of `projects.Autosave and unsaved-work protection` in sequence ("Saving…", then "Saved")

#### Scenario: Application menu on Windows and Linux
- **WHEN** the desktop app shows the Sessions screen on Windows or Linux
- **THEN** the application menu button is the first control of the top bar and opens File, Edit, Clip, Playback, View, Go, Host, Window and Help

#### Scenario: No application menu button on macOS
- **WHEN** the desktop app runs on macOS
- **THEN** the top bar has no application menu button and the system menu bar carries the menu

#### Scenario: Back button
- **WHEN** the user opens a session from the Sessions list and activates the top bar's back button
- **THEN** `nav.back` returns to the Sessions list and the forward button becomes enabled

#### Scenario: Private by default
- **WHEN** a new session opens
- **THEN** its top bar shows the chip "Private", and activating it opens the share control

### Requirement: Editor header menu
The editor menu button (JAgentChill mark at the top inline-start corner of the editor, after the application menu button on Windows and Linux) SHALL open, on every platform, a menu with: Back to projects (runs the exit of `projects.Open and exit project`; disabled while the exit is in progress); Rename project…; Duplicate project; Project settings… (opens the dialog of `projects.Project settings surface`); Edit cover… (opens `projects.Cover editor`); separator; Import media…; Export…; Exports (opens `/exports`); Save version; Version history…; separator; Open script / New script for this project (`script-studio.Entry points`); Run workflow on this project… (`agent-workflows.Entry points`); separator; Keyboard shortcuts (opens `keyboard-shortcuts.Shortcut cheat-sheet dialog`); Send feedback… (`diagnostics-quality.Local feedback capture`); Layout ▸ (see `app-shell-navigation.Editor layout presets and panel collapse`); Theme ▸ (System, Light, Dark); separator; Move to trash… (`danger` text, with the confirmation of `projects.Delete project with enforced confirmation`). Classic's external community link is not included. In the desktop app the same commands also exist in the application menu of `desktop-app.Native application menu` (system menu bar on macOS, application menu button on Windows and Linux). Items that need a host stay enabled, carry the link badge (`requiresHost` of `design-system.Button`) and open the requires-host sheet when none is connected. [PORT SH-004, SH-005] [NEW]

#### Scenario: Exit project
- **WHEN** the user chooses "Back to projects" with unsaved changes pending
- **THEN** the exit of `projects.Open and exit project` runs and the Projects screen opens showing the updated thumbnail and time

#### Scenario: Rename from the menu
- **WHEN** the user chooses "Rename project…", enters a name and confirms
- **THEN** the top bar and the project list show the new name

#### Scenario: Theme from the editor
- **WHEN** the user picks Theme ▸ Dark
- **THEN** the app switches to the dark theme within 200 ms and the preference in `settings-preferences.Appearance preferences` reads Dark

#### Scenario: Cover entry on desktop
- **WHEN** the user chooses "Edit cover…" in the desktop editor
- **THEN** the cover editor of `projects.Cover editor` opens for the open project

#### Scenario: Host item without a host
- **WHEN** no host is connected and the user chooses "Run workflow on this project…" by keyboard
- **THEN** the item is focusable and enabled, shows the link badge, and opens the requires-host sheet

### Requirement: Home screen
The Home screen (`/home`) SHALL show a vertically centred column, 460 px maximum width, containing in order: the JAgentChill mark at 40% opacity; a `type/display` heading "What do you want to make?"; the composer card; the context row; a row of quick-start tiles; the getting-started checklist while not dismissed; and a "Recent projects" strip of up to 8 project cards with thumbnail, name and relative time, ending with "View all" (opens `/projects`). The quick-start tiles and their destinations are:

| Tile | Result | Needs host |
|---|---|---|
| New blank project | creates a project per `projects.Create project` and opens `/editor/[projectId]` | no |
| Import media | opens the OS file picker and, for the picked files, creates a project by the same rule as dropping files on Projects (`app-shell-navigation.Global drag and drop of files`) | no |
| Write a script | creates a script and opens `/scripts/[scriptId]` (`script-studio.Entry points`) | no |
| Use a template | opens `/library/templates` | no |
| Prompt to video | sets the composer target to Video and focuses the composer | yes |
| New film | opens the "New film" dialog of `film-production.Film list and creation` | yes |

A tile that needs a host is enabled, is shown with the link badge and opens the requires-host sheet when none is connected, on every platform. When content exceeds the viewport height the column scrolls and is top-aligned with 48 px top padding. [NEW]

#### Scenario: First launch with no data
- **WHEN** Home opens with no projects and no host
- **THEN** the heading, composer (in its no-host state), quick-start tiles and the getting-started checklist are shown and the "Recent projects" strip is omitted

#### Scenario: Blank project without a host
- **WHEN** the user activates "New blank project" in local-only mode
- **THEN** a project is created per `projects.Create project` and the editor opens

#### Scenario: Import media tile
- **WHEN** the user activates "Import media" and picks two video files
- **THEN** one new project containing both files in the picked order is created and the editor opens

#### Scenario: Host tile without a host
- **WHEN** the user activates "New film" in local-only mode
- **THEN** the requires-host sheet with "Connect a host" is shown and no film is created

### Requirement: Home composer
The Home composer SHALL be the `design-system.Composer primitive` hosting the composer of `chat-agent.Composer layout and controls`. This requirement owns only its placement on Home and where sending navigates; composer behaviour — the target pill, modes, control row, message length limit and counter, placeholders, keyboard behaviour, drafts and dictation — is owned by `chat-agent` (`chat-agent.Composer targets`, `chat-agent.Composer modes`, `chat-agent.Composer control row`, `chat-agent.Composer drafts`, `chat-agent.Composer keyboard behaviour`) and is not restated here.

Two selectors exist and are never merged: the **target** of `chat-agent.Composer targets` — `session` (label "Chat", default), `video` (label "Video"), `film` (label "Film") — and the **mode** of `chat-agent.Composer modes` — Ask, Plan, Edit (default), Auto. Video and Film are targets, never modes, and no other value is a mode. Sending navigates by target, on the active host:

| Target | Result of sending | Route opened | Owner of what is created |
|---|---|---|---|
| `session` | a session in the selected mode | `/h/[hostId]/sessions/[sessionId]` | `chat-agent.Session creation from the home composer` |
| `video` | a draft run of the prompt-to-video template; nothing billable starts | `/h/[hostId]/workflows/runs/[runId]`, which shows the run setup form (inputs, cost and time estimate, Start) while the run is `draft` | `chat-agent.Composer targets`, `agent-workflows.Run view` |
| `film` | a film whose episode 1 source is the message | `/h/[hostId]/film/[filmId]/episode/[episodeId]/story` | `chat-agent.Composer targets`, `film-production.Film list and creation` |

The send button's split chevron offers "Send and stay here", which creates the item without navigating and shows a toast with "Open". When no host is connected the composer shows a banner inside the card "Connect a host to use the agent" with a "Connect" button (opens `/pair/start`), the textarea remains editable (the draft is kept) and the send button is disabled. [NEW]

#### Scenario: Start a session
- **WHEN** a host is connected, the target is Chat, the mode is Edit and the user types a request and sends it
- **THEN** a session in mode `edit` is created and the route changes to `/h/[hostId]/sessions/[sessionId]` with the message as the first user message

#### Scenario: Mode list
- **WHEN** the user opens the mode selector on Home with the target Chat
- **THEN** exactly Ask, Plan, Edit and Auto are offered, Edit is selected on a new installation, and Video and Film are not in the list

#### Scenario: Video target
- **WHEN** the target is Video and the user sends a prompt
- **THEN** `/h/[hostId]/workflows/runs/[runId]` opens showing the run setup form of the draft run
- **AND** no generation job exists until the user confirms the estimate there

#### Scenario: Film target
- **WHEN** the target is Film and the user sends a 900-character story
- **THEN** the route `/h/[hostId]/film/[filmId]/episode/[episodeId]/story` opens for the created film

#### Scenario: Send and stay
- **WHEN** the user chooses "Send and stay here" with the target Chat
- **THEN** the session is created, Home stays in the foreground with an empty composer, and a toast offers "Open"

#### Scenario: No host
- **WHEN** no host is connected
- **THEN** the banner with "Connect" is shown, the send button is disabled, and activating "Connect" opens `/pair/start`

#### Scenario: Send failure
- **WHEN** creating the session, run or film fails
- **THEN** the composer keeps the draft and attachments, and an error toast with "Retry" is shown

### Requirement: Composer context row
Under the Home composer a 12 px `text/secondary` row SHALL show three selectors separated by "·": **Project** ("No project" or the chosen project name; opens a searchable project picker with "New project"), **Host** (active host name; opens the host switcher) and **Model** (the model chosen for the next session together with the **access method** that serves it, from the model browser of `chat-agent.Model browser`; a link "Manage models" opens `/settings/host/[hostId]/model-routing`). A provider is used in three ways of equal standing (decision E11) and the selector always names which one is in use, after the model name: "<vendor> account" for an OAuth sign-in directly with the provider (for example "Claude Sonnet · Anthropic account"), "API key" for a key or a custom or proxy endpoint (for example "GPT · OpenAI API key", "Claude Sonnet · OpenRouter"), and the CLI's name for an installed agent CLI (for example "Claude Sonnet · Claude Code CLI"). Where one vendor is connected by more than one method, the model browser lists the model once per method and the user switches method there; the three methods are presented in that fixed order with equal weight, and no surface of the shell describes providers as CLI-only. The selections apply to the next message sent from this composer and are stored with the draft. When the chosen project's edit lease is held by another device (`cross-device-sync.Single-writer edit lease`) the row shows a warning icon with the tooltip "Open on <device> — agent changes will be sent to that device". [NEW]

#### Scenario: Choose a project
- **WHEN** the user picks "Summer trip" in the Project selector and sends a message with target Chat
- **THEN** the created session is bound to that project (`chat-agent.Session project binding`) and its workspace opens the Timeline preview tab

#### Scenario: No model route configured
- **WHEN** the host has no usable model route
- **THEN** the Model selector reads "Set up models" in `warning/text` and opens `/settings/host/[hostId]/runtimes`, whose first choices are "Sign in with a provider account", "Enter an API key" and "Use an installed CLI"

#### Scenario: Access method is named
- **WHEN** the next session will use a Claude model through an Anthropic account sign-in
- **THEN** the Model selector reads the model name followed by "Anthropic account", and choosing the same model under "Claude Code CLI" in the model browser changes the suffix to "Claude Code CLI"

#### Scenario: Project open elsewhere
- **WHEN** the chosen project's lease is held by the device "Studio Mac"
- **THEN** the row shows the warning icon with "Open on Studio Mac — agent changes will be sent to that device"

### Requirement: Composer attachments
On Home the composer SHALL accept attachments from its "+" menu, by paste and by drag and drop onto the composer or anywhere on the Home column. The accepted types, per-message count, size limits, upload transport, chip states and rejection messages are those of `chat-agent.Attachment types` and `chat-agent.Attachment limits and upload`; this requirement adds only the Home drop target: while a drag carrying files is over the window, the composer shows a dashed `accent` drop outline with "Drop to attach", and a drop anywhere on the Home column attaches to the composer. On mobile the "+" menu additionally offers "Photo library" and "Camera". [NEW]

#### Scenario: Drop on the Home column
- **WHEN** the user drops an image on the Home heading, outside the composer card
- **THEN** an attachment chip for the image appears in the composer and its upload starts

#### Scenario: Limits come from the owner
- **WHEN** the user drops more files than `chat-agent.Attachment limits and upload` allows per message
- **THEN** the excess files are rejected with the message defined there and the accepted files are kept

### Requirement: Composer mentions
Typing `@` at the start of a word in the Home composer SHALL open the mention popover of `chat-agent.At-mentions`, which owns the categories, search, paging, insertion, limits and the behaviour of deleted entities. This requirement owns only the presentation on Home: the popover is anchored to the caret and opens upward when fewer than 280 px remain below it; on compact form factors it is a bottom sheet above the keyboard; categories that need a host are omitted in local-only mode. [NEW]

#### Scenario: Popover placement
- **WHEN** the composer sits 120 px above the bottom of the window and the user types `@`
- **THEN** the popover opens above the caret and stays inside the viewport

#### Scenario: Local-only mode
- **WHEN** no host is connected and the user types `@`
- **THEN** only the categories that exist without a host (Projects, Media, Scripts, Templates) are listed

### Requirement: Getting-started checklist
Home SHALL show a "Get started" card until dismissed: a title, "n of 6", a thin progress bar, a × button, and six rows — "Create or open a project", "Import media", "Export a video", "Connect a host", "Connect a model provider", "Make a video from a prompt". The row "Connect a model provider" expands, when open and a host is connected, to three choices of equal standing in this order (decision E11), each opening the matching start of `/settings/host/[hostId]/runtimes` (`agent-runtimes.Runtimes settings screen`): **"Sign in with <vendor>"** — one button per vendor whose bundled manifest offers a sign-in (browser OAuth, device code or setup token; for example Anthropic, OpenAI, Google and GitHub Copilot), starting `agent-runtimes.OAuth login through the admin proxy` with the hand-off of `agent-runtimes.Login hand-off per platform`, so the sign-in can be started and completed from the desktop app, the web app or a phone; **"Enter an API key"** — for a vendor (Anthropic, OpenAI, Google, OpenRouter and the other providers of `agent-runtimes.Direct provider list`) or a custom or proxy endpoint (`agent-runtimes.API key entry and validation`); **"Use an installed CLI"** — the agent CLIs detected on the host (Claude Code, Codex CLI, Gemini CLI, GitHub Copilot CLI and the ACP catalogue, `agent-runtimes.CLI detection by binary and version`). The vendor lists come from the host (`jagentchill.provider.auth.list`), never from a list compiled into the shell. A device whose role is not `admin` sees the row with "Ask an admin of this host to connect a provider". A completed row shows a filled `accent` check and its label in `accent`; an open row shows an empty circle and navigates to the place where the step is done. Completion is derived from real state (a project exists; a project has at least one media asset; an export has completed; a host is paired; the active host has at least one provider connected by any of the three access methods — an OAuth sign-in, an API key or endpoint, or an installed CLI — with readiness "ready"; a workflow run has succeeded), never from clicks. A "Show starter tips" disclosure expands exactly five example prompts; choosing one fills the composer with its text and sets the target shown below. Their texts are locale resources:

| Key | English text | Target |
|---|---|---|
| `shell.starter.1` | Make a 30-second vertical recap of my last project with captions and upbeat music | Video |
| `shell.starter.2` | Cut the silences and filler words from the open project and add subtitles | Chat |
| `shell.starter.3` | Write a 60-second script about a morning coffee routine and build a draft timeline from it | Chat |
| `shell.starter.4` | Turn this short story into a three-scene film with one narrator | Film |
| `shell.starter.5` | Build a workflow that makes a weekly highlight video from new clips in my library | Chat |

Dismissing asks nothing and can be reversed from Help ▸ "Starter tips". When all six are complete the card shows "All set" and removes itself at the next launch. [NEW]

#### Scenario: Derived completion
- **WHEN** the user imports a first media file into a project
- **THEN** "Import media" becomes checked and the counter increases by one without further action

#### Scenario: Starter prompt
- **WHEN** the user expands "Show starter tips" and chooses the fourth prompt
- **THEN** exactly five prompts were listed, the composer contains the text of `shell.starter.4` and the target is Film

#### Scenario: Dismiss and restore
- **WHEN** the user closes the card with × and then chooses Help ▸ "Starter tips"
- **THEN** the card is shown again with its current progress

#### Scenario: Three ways to connect a provider
- **WHEN** an admin opens the row "Connect a model provider" with a host connected
- **THEN** it offers "Sign in with <vendor>" buttons, "Enter an API key" and "Use an installed CLI", in that order and with equal weight

#### Scenario: Sign-in started from a phone
- **WHEN** an admin taps "Sign in with Anthropic" in the checklist on a phone
- **THEN** the sign-in of `agent-runtimes.Login hand-off per platform` opens on the phone, and when it completes the row becomes checked on every device of the host

#### Scenario: OAuth alone completes the step
- **WHEN** the host has one provider connected by OAuth sign-in and no CLI and no API key
- **THEN** the row "Connect a model provider" is checked

### Requirement: First-run welcome
On the first launch on a device the app SHALL show a welcome flow at `/welcome`, replacing classic's onboarding dialog, with these steps:

1. **Introduction** — the product in two sentences with "Get started".
2. **Language and theme** — preselected from the OS.
3. **Host** — "Connect a host" (opens `/pair/start`), "Use this device only", and on the desktop app (macOS, Windows and Linux) "Start the built-in host on this computer" (preselected). On iOS, Android and the web app the step states, in one sentence, what a host is for and how to get one: "Agents, workflows, Film Studio, automations and sync run on a host — the JAgentChill desktop app on a Mac, Windows or Linux computer, or the JAgentChill container on your own server. A phone or a browser cannot be the host; editing works without one." In the web app served by a host (the page origin is a Gateway's product listener or loopback address), "Connect a host" pre-fills the host address of `/pair/start` ▸ "Enter a short code" with the page origin, so a browser on the same computer pairs with the short code or link shown by that host at the "This computer only" level.
4. **Model provider** — shown only when step 3 ended with a connected host on which this device is `admin` (always the case for the built-in host). It presents the three ways to use a provider with equal standing, in this order (decision E11): **"Sign in with <vendor>"** (one button per vendor that offers a sign-in — browser OAuth, device code or setup token — for example Anthropic, OpenAI, Google, GitHub Copilot; `agent-runtimes.OAuth login through the admin proxy`, `agent-runtimes.Login hand-off per platform`), **"Enter an API key"** (a vendor key or a custom or proxy endpoint; `agent-runtimes.API key entry and validation`) and **"Use an installed CLI"** (the agent CLIs found on the host with their sign-in state; `agent-runtimes.CLI detection by binary and version`, `agent-runtimes.Login and health check`). Completing any one marks the step done and shows the connected method with its account or key label; "Skip for now" continues without a provider, and the getting-started checklist keeps the item open. The vendor list is read from the host.

On the desktop app the first-run OpenH264 dialog of `desktop-app.First-run OpenH264 acceptance dialog` and, when the OS secret store is unavailable, the `KEY_STORAGE_UNAVAILABLE` dialog of `desktop-app.Desktop secure storage and paths` appear after the step that triggers them and never replace a step. Each step has Back and Next; the flow can be closed at any step, which applies the choices made so far, marks the flow as seen and opens Home. The flow SHALL never be shown again on that device after being seen, and is reachable again from `/settings/about` ▸ "Show welcome". [PORT SH-007] [NEW]

#### Scenario: Complete the flow on desktop
- **WHEN** the user finishes step 3 with the built-in host option selected on macOS, Windows or Linux
- **THEN** the Gateway is started per `desktop-app.Gateway process supervision`, step 4 offers the three ways to connect a provider, and after it Home opens and the welcome flow is marked seen

#### Scenario: Sign in with a provider account during welcome
- **WHEN** the user chooses "Sign in with OpenAI" in step 4 and completes the sign-in in the browser
- **THEN** the step shows OpenAI as connected by account sign-in with the account label, and the Home composer's Model selector offers that provider's models marked "OpenAI account"

#### Scenario: Phone explains the host
- **WHEN** the flow reaches step 3 on an iPhone or an Android phone
- **THEN** the sentence stating that a phone or a browser cannot be the host is shown with "Connect a host" and "Use this device only", and no "Start the built-in host" option exists

#### Scenario: Browser on the host's own computer
- **WHEN** the web app is opened at the built-in host's loopback address and the user chooses "Connect a host"
- **THEN** `/pair/start` opens with the host address pre-filled with the page origin

#### Scenario: Close early
- **WHEN** the user closes the flow on step 2 after choosing Vietnamese
- **THEN** the UI language is Vietnamese, Home opens in local-only mode and the flow does not reappear at the next launch

### Requirement: Session split view
A session screen SHALL render a horizontal split on wide form factors: the chat pane at the inline-start side (default 40% of the content width, minimum 320 px, maximum 60%) and the workspace pane at the inline-end side (minimum 360 px), separated by a `design-system.Resizable panels and splitters` splitter. The workspace-panel toggle in the top bar (action `session.workspace.toggle`) collapses the workspace so that chat fills the width with its message column centred at up to 720 px. On medium form factors the workspace pane overlays the chat as an inline-end-anchored panel 420 px wide instead of sitting beside it. On compact form factors the split becomes the segmented single pane of `app-shell-navigation.Mobile single-pane session`. Split ratio and collapsed state are persisted per session per device. When `multi-agent-orchestration.Agents tab and roster` docks its roster, the 264 px roster column sits between the two panes and the chat pane's maximum becomes 50%. The roster docks only when the content width (window width minus the sidebar when it is shown) is at least 944 px — chat 320 + roster 264 + workspace 360; below that "Dock roster" is unavailable, its row shows the visible reason "Needs a wider window", and a roster that is docked when the content narrows below 944 px returns to the Agents tab and docks again when the width returns. When the sidebar is what makes the content too narrow, the workspace pane yields first: panes give way in the order workspace (down to 360 px), then chat (down to 320 px), then the dock. This requirement owns only these frame numbers; everything inside the chat pane (timeline, composer, placeholders, scroll-to-bottom, Stop) and inside the workspace pane (tab strip, panel types, tab limit, new-tab page) is owned by `chat-agent.Session split view` and `chat-agent.Workspace tab strip and new-tab page`, and the session's ⋯ menu by `chat-agent.Session menu`. The same frame is used by `agent-workflows.Run view`. [NEW]

#### Scenario: Resize the split
- **WHEN** the user drags the splitter to give the chat pane 55% and reopens the session on the same device
- **THEN** the chat pane is 55% wide

#### Scenario: Minimum widths
- **WHEN** the window is 1000 px wide and the user drags the splitter toward the inline-start edge
- **THEN** the chat pane stops at 320 px

#### Scenario: Maximum chat width
- **WHEN** the user drags the splitter toward the inline-end edge at 1600 px width
- **THEN** the chat pane stops at 60% of the content width

#### Scenario: Medium overlay
- **WHEN** the window is 800 px wide and the user opens the workspace
- **THEN** the workspace is a 420 px panel over the chat, anchored to the inline-end edge

#### Scenario: Collapse workspace
- **WHEN** the user toggles the workspace panel off
- **THEN** the chat pane fills the content region with its message column centred at up to 720 px

#### Scenario: Roster needs width
- **WHEN** the content width is 900 px
- **THEN** "Dock roster" is unavailable with "Needs a wider window", and the roster is shown in the Agents tab

#### Scenario: Docked roster on a narrowing window
- **WHEN** the roster is docked and the window is narrowed until the content width is 930 px
- **THEN** the roster returns to the Agents tab, and widening the window above 944 px docks it again

### Requirement: Focus mode
Focus mode (action `view.focus-mode`) SHALL hide the sidebar and the top bar's secondary controls and, in a session, collapse the workspace pane so that only the chat column and composer remain; in the editor it hides the asset panel, the inspector and the agent panel and leaves the player and timeline; in a workspace it hides the explorer. It is toggled by the action (from the session ⋯ menu, the editor's Layout menu, the command palette or its binding in `keyboard-shortcuts`), shows a 2 s hint "Press Esc to exit focus mode" on entry, and exits with the same action or with Escape. Escape is not handled by this requirement directly: it reaches focus mode through the registry actions of `keyboard-shortcuts` — the last step of `editor.cancel` in the editor and `app.escape` (which runs `view.focus-mode.exit`) elsewhere — which run only when no overlay is open, no drag is in flight, nothing is selected (editor) and no text field has focus, so the key is rebindable and listed in the cheat sheet. The pre-focus layout SHALL be restored exactly on exit. Focus mode is per window and is not persisted across restarts. [NEW]

#### Scenario: Enter and exit in a session
- **WHEN** the user toggles focus mode in a session with the sidebar open and the workspace at 60%
- **THEN** only the chat column and composer are visible
- **AND** toggling again restores the sidebar and the 60% workspace

#### Scenario: Editor focus mode
- **WHEN** the user chooses Layout ▸ Focus mode in the editor with the inspector at 30%
- **THEN** only the player and timeline are visible, and Escape with nothing else active restores the asset panel and the 30% inspector

#### Scenario: Escape goes to the text field first
- **WHEN** focus mode is on and the composer has focus and the user presses Escape
- **THEN** the composer loses focus and focus mode stays on

### Requirement: Editor four-region layout
On wide form factors the editor SHALL render four resizable regions: the asset panel at the top inline-start, the player at the top centre, the inspector at the top inline-end, and the timeline with its toolbar across the bottom. Sizes are percentages of the editor area with these defaults and limits: top group 50% of the height (minimum 30%, maximum 85%); timeline 50% (minimum 15%, maximum 70%); asset panel 25% of the width (minimum 15%, maximum 40%); player 50% (minimum 30%, no maximum); inspector 25% (minimum 15%, maximum 40%). The asset panel and the inspector additionally never render narrower than 280 px: where 15% of the editor width is less than 280 px the splitter stops at 280 px. These percentages are the only sizing rule for the inspector and asset panel. Splitters follow `design-system.Resizable panels and splitters`. Sizes are persisted per device under the preferences key `jagentchill.editor.panels` (versioned); classic `panel-sizes` version 2 values and the legacy `toolsPanel` / `previewPanel` / `propertiesPanel` keys are migrated when they arrive through `projects.OpenCut classic data import`. The content of the regions is owned by `media-library`, `preview-canvas.Player toolbar layout`, `preview-canvas.Inspector structure per element type` and `timeline-editing.Timeline scrolling and layout`; this requirement owns only the frame. A fifth, collapsible region is defined by `app-shell-navigation.Editor agent panel`; while it is docked open, the percentages of this requirement apply to the editor width **minus the agent panel's width**. On medium form factors (web and desktop only) the editor shows the player above the timeline (top group 55% of the height) with the asset panel, the inspector and the agent panel closed by default and opened as the overlays of `app-shell-navigation.Compact and medium breakpoint rules`. Which editor a device gets is decided only by `app-shell-navigation.Mobile editor shell integration`. [PORT SH-001, SH-002] [CAPCUT CC-282]

#### Scenario: Default layout
- **WHEN** a project opens for the first time on a device at 1440×900
- **THEN** the top group and the timeline each take 50% of the editor height and the asset panel, player and inspector take 25%, 50% and 25% of the width

#### Scenario: Sizes persist
- **WHEN** the user enlarges the timeline to 60% and reopens the project
- **THEN** the timeline is 60% tall

#### Scenario: Percentage limit
- **WHEN** the user drags the inspector splitter to make it wider than 40%
- **THEN** the inspector stops at 40%

#### Scenario: Pixel floor on a narrow wide window
- **WHEN** the editor is 1000 px wide and the user drags the inspector splitter to shrink it
- **THEN** the inspector stops at 280 px (not at 150 px)

### Requirement: Editor layout presets and panel collapse
The editor SHALL provide layout presets from the Layout menu: **Default** (as above), **Media** (asset panel 40%, inspector collapsed), **Edit** (timeline 60% of the height), **Color and effects** (inspector 40%, asset panel 20%), **Vertical video** (player on the right at 30% width with the asset panel and inspector stacked on the left) and **Reset layout**, which restores Default sizes. The asset panel, the inspector and the timeline can each be collapsed and restored from the Layout menu, from toggle buttons in the editor top bar and by pressing Enter on their splitter; the player cannot be collapsed. Player fullscreen hides all other regions. The chosen preset and collapsed states persist per device. [PORT SH-001, SH-002] [NEW]

#### Scenario: Reset layout
- **WHEN** the user has resized all panels and chooses "Reset layout"
- **THEN** all four regions return to the default sizes and no panel is collapsed

#### Scenario: Collapse the inspector
- **WHEN** the user collapses the inspector
- **THEN** the player takes the freed width and the inspector toggle restores it to its previous size

### Requirement: Editor asset panel tabs
The asset panel SHALL show a vertical icon tab bar (48 px wide, 20 px icons with 11 px labels below, tooltips, scroll fades when the tabs exceed the height) with exactly these thirteen tabs in this order, on desktop and web alike. This table is the only definition of the tab ids and labels; the content of each tab is owned by the capability in the last column.

| # | Tab id | Label | Content owner |
|---|---|---|---|
| 1 | `media` | Media | `media-library.Library views, sorting and persistence` |
| 2 | `audio` | Audio | `audio-editing.Sounds library panel` |
| 3 | `text` | Text | `text-and-titles` |
| 4 | `stickers` | Stickers | `stickers-shapes` (stickers and shapes) |
| 5 | `effects` | Effects | `visual-effects-filters` |
| 6 | `transitions` | Transitions | `transitions` |
| 7 | `captions` | Captions | `captions-subtitles.Captions panel` |
| 8 | `transcript` | Transcript | `captions-subtitles.Transcript panel` |
| 9 | `filters` | Filters | `visual-effects-filters` |
| 10 | `adjustment` | Adjustment | `color-adjustment` |
| 11 | `templates` | Templates | `templates.Template gallery` |
| 12 | `ai` | AI | `ai-editing-tools.AI tools catalogue and entry points` |
| 13 | `brand-kit` | Brand kit | `templates.Brand kit` |

Every tab SHALL be functional; none shows sample content. There is no "Settings" tab: project settings are the dialog of `projects.Project settings surface`. The active tab is persisted per project and restored when the project reopens; a new project starts on Media. The tab bar is a `tablist` with vertical orientation: Up/Down move between tabs. Other parts of the app switch the tab through the action `assets-panel.show` with a tab id (for example the inspector's "Open effects" empty-state button). [PORT SH-003] [CAPCUT CC-283, CC-290]

#### Scenario: Tab order and count
- **WHEN** the editor opens on desktop or web
- **THEN** the tab bar shows the thirteen tabs in the listed order, with AI between Templates and Brand kit

#### Scenario: Active tab restored
- **WHEN** the user leaves a project with the Transitions tab active and reopens it
- **THEN** the Transitions tab is active

#### Scenario: Programmatic switch
- **WHEN** the user activates "Open effects" in the inspector's empty effects list
- **THEN** the asset panel expands if collapsed and shows the Effects tab

#### Scenario: Unknown tab id
- **WHEN** `assets-panel.show` is invoked with a tab id that is not in the table
- **THEN** the action returns `false` and the active tab is unchanged

### Requirement: Editor inspector frame
The inspector region SHALL host the tab strip and panels defined by `preview-canvas.Inspector structure per element type` (the only table of tabs per selection) and, with nothing selected, `preview-canvas.Inspector empty state and project details`. This requirement owns only the frame: the region's size (`app-shell-navigation.Editor four-region layout`), a header line that reads the selected element's type and name or "<n> elements selected" for a multi-selection, a tab strip row of 36 px, a scrolling body, and these persistence rules — the last active tab is remembered per element type per device, and the collapsed state of each collapsible section is persisted per device by section key. On medium form factors the inspector is the 320 px overlay of `app-shell-navigation.Compact and medium breakpoint rules`. [PORT SH-001] [CAPCUT CC-284, CC-291]

#### Scenario: Tabs come from the owner
- **WHEN** a video clip with audio is selected
- **THEN** the inspector shows exactly the tabs that `preview-canvas.Inspector structure per element type` lists for a video clip

#### Scenario: Last tab per type
- **WHEN** the user opens the Speed tab for a video clip, selects a text element, then selects another video clip
- **THEN** the Speed tab is active for the second video clip

#### Scenario: Multi-selection header
- **WHEN** three clips are selected
- **THEN** the header reads "3 elements selected"

### Requirement: Editor timeline toolbar frame
The timeline region SHALL have a 36 px icon toolbar above the tracks whose items, groups and order are defined only by `timeline-editing.Timeline toolbar`. This requirement owns the frame: every tool is a `design-system.Icon button and toggle button` with a tooltip showing its name and current key hint, invokes a registry action, and is disabled when its action is not applicable; when the toolbar is narrower than its content, tools of the left group after "Delete" move into an overflow "⋯" menu, one at a time from the inline-end side of that group, while the centre and right groups never overflow. Track header geometry and toggles are owned by `timeline-editing.Track header column and row dimensions`. [CAPCUT CC-285] [PORT SH-001]

#### Scenario: Overflow
- **WHEN** the timeline region is 700 px wide
- **THEN** the left-group tools after Delete that no longer fit are reachable from the "⋯" menu in their original order, and the centre and right groups remain visible

#### Scenario: Disabled tool
- **WHEN** an audio clip is selected
- **THEN** the tools whose actions report `isEnabled` false are rendered disabled with a reason tooltip and do not respond to activation

### Requirement: Editor loading, missing-project and error screens
The route `/editor/[projectId]` SHALL render, inside the editor frame, the states owned by `projects`: the loading state, the not-found screen and the load-error screen of `projects.Project not found and load errors`, the exit state of `projects.Open and exit project`, and the read-only banner of `cross-device-sync.Lease takeover and transfer` when another device holds the edit lease. The compatibility-renderer banner is owned by `preview-canvas.Degraded graphics notice`. This requirement adds only the routing rules: an unknown project id never creates a project silently; the not-found and error screens keep the shell top bar so that "Back to projects" and the drawer remain reachable; and the route's document title is "Project not found — JAgentChill" or "<project name> — JAgentChill". [PORT SH-001, SH-006] [NEW]

#### Scenario: Unknown project id
- **WHEN** the user opens a deep link to a project id that is not present on the device
- **THEN** the not-found screen of `projects.Project not found and load errors` is shown and no project is created

#### Scenario: Load failure keeps navigation
- **WHEN** project loading fails
- **THEN** the error screen of `projects.Project not found and load errors` is shown inside the shell and the top bar's back control still opens `/projects`

### Requirement: Compact and medium breakpoint rules
The shell SHALL adapt its **layout** by the form factors of `design-system.Breakpoints and layout constants` (compact, medium, wide — the thresholds are stated only there) as follows; **sizes** (row heights, hit targets, type scale, always-visible row controls) follow density, not form factor (`design-system.Control size tokens and density rules`), so a tablet in a wide window gets the wide layout with compact-touch sizes. **Compact**: the sidebar is a drawer; split views become single-pane with a segmented switch; popovers and menus become bottom sheets; modals become full-height sheets; tables become stacked rows; settings navigation becomes pushed list screens; the editor is chosen by `app-shell-navigation.Mobile editor shell integration`. **Medium**: the sidebar is pinned but starts collapsed; the session workspace pane overlays the chat; the editor shows asset panel, inspector and agent panel as overlays toggled from the top bar, each 320 px wide (agent panel 420 px), over a player-plus-timeline layout. **Wide**: the full layouts above. The form factor is recomputed on resize and orientation change without losing navigation state, selection, drafts or the open project; an overlay open during the change is re-presented in the new form (for example a popover becomes a bottom sheet). There is no blocking "desktop only" gate at any width: classic's narrow-screen gate is replaced by these layouts. The 600 dp threshold of `mobile-editor.Tablet layout` selects the tablet editor layout only and is not a shell breakpoint. [PORT SH-006] [JAD] [NEW]

#### Scenario: Resize across the compact boundary
- **WHEN** a browser window showing a session is resized from 1000 px to 600 px
- **THEN** the sidebar becomes a drawer and the split becomes a single pane with the Chat segment selected, and the composer draft is preserved

#### Scenario: No gate on narrow screens
- **WHEN** the editor route is opened on a 390 px wide device
- **THEN** the mobile editor layout is shown with no "desktop only" screen

#### Scenario: Medium editor
- **WHEN** the editor is 800 px wide
- **THEN** player and timeline are visible and the asset panel opens as a 320 px overlay from its top-bar toggle

#### Scenario: Below the medium threshold is compact
- **WHEN** the viewport is 650 px wide on any screen
- **THEN** the shell uses the compact rules (drawer, single pane)

#### Scenario: Tablet in landscape
- **WHEN** the app runs on a tablet whose window is 1,180 px wide
- **THEN** the shell uses the wide layout (pinned sidebar, split session view) with 44 px rows and always-visible row controls

### Requirement: Mobile drawer and top bar
On compact form factors the sidebar SHALL be the `design-system.Drawer` (86% of the screen width, maximum 320 px), attached to the inline-start edge. It has the sidebar header at the top, the sidebar footer at the bottom, and between them a segmented header with two segments, each using the full height between header and footer: **"Menu"** — the primary navigation with the More group always open inline (thirteen rows; it scrolls when the screen is short) — and **"<section name>"** — the secondary list of the current section (`app-shell-navigation.Sidebar secondary list`). The drawer opens on the section segment, so the session or project list is visible at once; choosing a destination in "Menu" navigates, switches the drawer to that section's list and leaves it open for one more tap, and choosing a row of the list navigates and closes the drawer. Rows are 44 px tall. No promo card is shown in the drawer; eligible promo cards appear as a row at the top of Home.

Opening and closing use one rule on iOS and Android, defined toward the inline-start edge so that it mirrors in right-to-left layouts: the drawer opens from the top-bar drawer button, and by a horizontal drag toward the inline-end that starts on the top bar or on a root screen's content **more than 24 px inside the inline-start screen edge** — never from the screen-edge zone, which belongs to the operating system's back gesture on Android and iOS — and only on screens where no horizontal gesture owns the content (it is off in the editor, on the workflow canvas, in terminals and over horizontally scrolling rows). It closes by tapping the scrim, by a drag toward the inline-start edge, by choosing a list row, with Escape on a hardware keyboard, and by the system back action. The system back action (Android back button or gesture; iOS edge-swipe and header back button) behaves the same on both systems: it closes the drawer if open; otherwise it navigates back one screen; at a root screen with the drawer closed, Android back leaves the app as the platform prescribes and the iOS edge-swipe does nothing. The top bar is 56 px and shows the drawer button, the title and the ⋯ button. All screens respect safe-area insets. [NEW]

#### Scenario: Open and close the drawer
- **WHEN** the user taps the drawer button on the Sessions list
- **THEN** the drawer slides in within 240 ms showing the Sessions list segment, and tapping the scrim closes it

#### Scenario: Edge zone belongs to the system
- **WHEN** the user swipes from the very edge of the screen on an Android phone with gesture navigation, at a root screen with the drawer closed
- **THEN** the system back gesture runs and the drawer does not open
- **AND** a drag that starts 40 px inside the inline-start edge opens the drawer on Android and on iOS alike

#### Scenario: Navigation from the Menu segment
- **WHEN** the user switches to "Menu" and taps "Projects"
- **THEN** the Projects screen is shown behind the drawer and the drawer shows the Projects list segment

#### Scenario: Short phone
- **WHEN** the drawer opens on a phone 568 pt tall
- **THEN** the section list uses the whole height between the drawer header and footer, and the thirteen destinations are reachable in the "Menu" segment by scrolling

#### Scenario: Right-to-left
- **WHEN** the layout direction is right-to-left
- **THEN** the drawer is attached to the right edge, opens by a drag toward the left that starts more than 24 px inside the right edge, and closes by a drag toward the right

### Requirement: Mobile single-pane session
On compact form factors a session SHALL show one pane at a time with a segmented control "Chat | Workspace" under the top bar; the Workspace segment shows the workspace tabs as a horizontally scrolling strip above the selected panel. The composer docks above the keyboard and the bottom safe area in the Chat segment and stays visible while the keyboard is open. The selected segment is remembered per session. When a new approval request or question arrives while Workspace is selected, the Chat segment shows a `warning` dot with the accessible text "needs your input" and a toast "The agent needs your input" with the action "View". Horizontal swipes on the pane content do not switch segments, so that gestures inside panels (timeline scrubbing, diagram panning) are not intercepted. [NEW]

#### Scenario: Switch segments
- **WHEN** the user taps "Workspace"
- **THEN** the workspace tab strip and selected panel replace the chat, and tapping "Chat" returns to the same scroll position

#### Scenario: Approval while in Workspace
- **WHEN** an approval request arrives while Workspace is selected
- **THEN** the Chat segment shows a `warning` dot and the toast's "View" action switches to Chat and scrolls to the request

### Requirement: Mobile home with project grid
On compact form factors Home SHALL show, from the top: the top bar with the drawer button, the host chip and the Notifications button; a "New project" tile and the quick-start tiles of `app-shell-navigation.Home screen` in one horizontally scrolling row; a segmented control "Projects | Templates"; under Projects a grid of project cards (2 columns below the `sm` breakpoint of `design-system.Breakpoints and layout constants`, 4 columns from `sm` up; thumbnail, name, duration, updated time) that reopen their project on tap and offer the long-press actions of `projects.Per-project menu`, and under Templates the browser of `templates.Template gallery`; and the composer docked at the bottom above the safe area, collapsed to one line until focused. This requirement is the only definition of the mobile Home layout. "New project" opens the ordered media picker and creates the project exactly as `projects.Create project` defines for mobile (primary action "Add (N)", disabled at N = 0; secondary action "Blank project"; canvas and frame rate per `projects.Canvas and frame rate adoption from first media`). With no projects the grid area shows the first-use empty state of `projects.Projects empty states`. [CAPCUT CC-286] [NEW]

#### Scenario: New project from the picker
- **WHEN** the user taps "New project", selects three clips in order and taps "Add (3)"
- **THEN** the mobile editor opens with the three clips on the main track in the selected order

#### Scenario: Nothing picked
- **WHEN** the picker is open with no item selected
- **THEN** "Add (0)" is disabled and "Blank project" creates an empty project per `projects.Create project`

#### Scenario: Templates segment
- **WHEN** the user switches to "Templates"
- **THEN** the template gallery is shown and the Projects grid is hidden, and the choice is remembered at the next visit

#### Scenario: Wider compact window
- **WHEN** Home is shown at a compact width at or above the `sm` breakpoint
- **THEN** the project grid has 4 columns

### Requirement: Mobile editor shell integration
This requirement SHALL be the only rule that decides which editor a device shows. **On iOS and Android** the editor route SHALL always present the editor owned by `mobile-editor`, whatever the shell's form factor: its phone layout (`mobile-editor.Portrait screen structure`) when the shortest side of the window is under 600 dp and its tablet layout (`mobile-editor.Tablet layout`) otherwise — an iPad or Android tablet in landscape therefore gets the tablet editor, not the four-region desktop layout. **On web and desktop** the editor is the four-region layout of `app-shell-navigation.Editor four-region layout` on wide form factors, its medium arrangement on medium ones, and the `mobile-editor` phone layout on compact ones, where the touch gestures have these pointer equivalents: wheel = scroll-seek of the timeline, `Mod`+wheel = zoom, press-and-hold for 400 ms = long press, and drag = drag.

Wherever the `mobile-editor` layouts are shown, the shell defines no toolbar item, strip, sheet size or export sheet of its own: screen structure, top bar (`mobile-editor.Top bar`), bottom toolbars (`mobile-editor.Two-level bottom toolbar`, `mobile-editor.Root toolbar` and the clip strips) and tool sheets (`mobile-editor.Tool sheets never cover the preview`) are owned there. The shell contributes only navigation rules: the system back action (Android back, iOS edge swipe; Escape or the browser back on web) is delivered to `mobile-editor` while a sub-toolbar, tool sheet or dialog is open and closes exactly one level; at the root level it runs the exit of `projects.Open and exit project` after the pending save is flushed; the drawer drag is disabled on the editor route; and the agent chat opens from the top bar's "Agent" button as a full-height sheet containing the pane of `app-shell-navigation.Editor agent panel`. [CAPCUT CC-287, CC-288, CC-289] [NEW]

#### Scenario: System back inside a tool sheet
- **WHEN** a tool sheet is open over a clip strip and the user performs the system back gesture
- **THEN** the sheet closes, the clip strip is shown and the project stays open

#### Scenario: System back at the root
- **WHEN** the root toolbar is shown, nothing is open and the user performs the system back gesture
- **THEN** the pending save is flushed and `/projects` (or Home, when the editor was opened from Home) is shown

#### Scenario: Tablet in landscape gets the tablet editor
- **WHEN** a project is opened on an iPad or an Android tablet 1,180 dp wide
- **THEN** the tablet layout of `mobile-editor` is shown, not the four-region layout

#### Scenario: Narrow browser window
- **WHEN** the editor is open in a desktop browser window narrowed to a compact width
- **THEN** the `mobile-editor` phone layout is shown and the wheel scroll-seeks the timeline

#### Scenario: Agent sheet without a host
- **WHEN** the user taps "Agent" with no host connected
- **THEN** a full-height sheet shows the requires-host state with "Connect a host"

### Requirement: Route map
The app SHALL use expo-router with exactly the routes of this table, which is the only route list in the product: every screen defined by any capability has a row, and every row names the requirement that owns the screen's content. Host-scoped routes carry the host id in their two leading segments, the literal `h` and then `[hostId]` (there is no route that ends at the host id); routes with "no" in "Needs host" work without a Gateway. Panels, sheets, dialogs and workspace tabs are not routes; a `?query` listed in a row selects a tab, item or position inside that screen.

| Route | Screen | Content owner | Needs host |
|---|---|---|---|
| `/` | startup routing | `app-shell-navigation.Startup routing and restore` | no |
| `/welcome` | first-run welcome | `app-shell-navigation.First-run welcome` | no |
| `/pair/start`, `/pair/scan`, `/pair/link` (`?offer=<payload>` on web), `/pair/tailnet`, `/pair/verify` | pairing flow on the new device: "Add a host", scan, paste or link, "Sign in to Tailscale", then connecting, host verification, code entry and "Paired" (frame and order: `app-shell-navigation.Pairing flow routes`) | `device-pairing-signing.Pairing flow on the new device`, `device-pairing-signing.Tailnet login step` | no |
| `/home` | Home with composer | `app-shell-navigation.Home screen` | no (sending needs one) |
| `/projects`, `/projects/folder/[folderId]`, `/projects/trash` | projects list, folder, trash | `projects.Projects list`, `projects.Project folders`, `projects.Trash` | no |
| `/editor/[projectId]` (`?scene=`, `?time=`) | editor | `app-shell-navigation.Editor four-region layout`; compact: `mobile-editor.Portrait screen structure` | no |
| `/scripts` | scripts list | `script-studio.Scripts list` | no |
| `/scripts/[scriptId]` (`?version=`, `?scene=`) | script editor | `script-studio.Editor layout` | no |
| `/scripts/[scriptId]/review` (`?review=`) | script review | `script-studio.Review screen` | no (agent review needs one) |
| `/h/[hostId]/scripts/[scriptId]` (`?version=`, `?scene=`, `?review=`) | host-qualified link to a synced script: resolves the script on that host (downloading it when it is not on the device) and then shows `/scripts/[scriptId]` or its review | `script-studio.Entry points` | yes |
| `/library`, `/library/[category]`, `/library/[category]/[itemId]` | Library, category, item detail | `app-shell-navigation.Library screen` | no |
| `/exports`, `/exports/[tab]` (tab ∈ `queue`, `history`, `links`; `?job=<jobId>` selects a job on `queue` or `history`) | export queue, export history, share links | `app-shell-navigation.Exports screen` | no (`links` needs one) |
| `/devices` (`?pair=1` opens "Pair a device") | this device, paired hosts with their connection path, devices of the active host, and the offer sheet for pairing another device | `device-pairing-signing.Device list management`, `device-pairing-signing.Offer presentation and intake`, `device-pairing-signing.Connection path indicator` | no (remote lists need one) |
| `/devices/[deviceId]` | device detail (role, token, fingerprint, revoke) | `device-pairing-signing.Device list management` | yes |
| `/notifications` | notification inbox (full screen on compact) | `notifications.Notification inbox` | no |
| `/settings`, `/settings/[section]` | personal settings | `settings-preferences.Settings navigation structure` | no |
| `/settings/host/[hostId]`, `/settings/host/[hostId]/[section]`, `/settings/host/[hostId]/[section]/[itemId]` | host settings, page, sub-page | `settings-preferences.Settings navigation structure` | yes |
| `/changelog`, `/changelog/[version]` | release notes | `updates-distribution.Release notes view` | no |
| `/h/[hostId]/sessions` | session list | `chat-agent.Session list in the sidebar`, `chat-agent.Session search and filters` | yes |
| `/h/[hostId]/sessions/import` | import a CLI session | `agent-runtimes.Session import from a CLI's native history` | yes |
| `/h/[hostId]/sessions/[sessionId]` (`?tab=`, `?agent=`, `?item=`) | session split view | `chat-agent.Session split view` | yes |
| `/h/[hostId]/workflows` (`?tab=workflows\|runs\|templates`) | workflows list | `agent-workflows.Workflows list screen` | yes |
| `/h/[hostId]/workflows/[workflowId]` (`?node=`) | workflow canvas editor | `workflow-diagram.Hosting in the Workflows screens and automations` | yes |
| `/h/[hostId]/workflows/runs/[runId]` (`?node=`) | run setup form while `draft`, then run view | `agent-workflows.Run view` | yes |
| `/h/[hostId]/film` | Film Studio list | `film-production.Film list and creation` | yes |
| `/h/[hostId]/film/hub`, `/h/[hostId]/film/hub/[folderId]` | asset hub | `film-production.Asset hub shared across films` | yes |
| `/h/[hostId]/film/[filmId]` | film (redirects to the last episode and stage) | `film-production.Studio navigation and stage tabs` | yes |
| `/h/[hostId]/film/[filmId]/direction` | creative direction and style bible of the film | `film-production.Creative direction and style bible` | yes |
| `/h/[hostId]/film/[filmId]/episode/[episodeId]/[stage]` (stage ∈ `story`, `script`, `assets`, `storyboard`, `video`, `voice`, `sound`, `timeline`) | film stage | `film-production.Studio navigation and stage tabs` | yes |
| `/h/[hostId]/agents` (`?tab=roster\|runs\|teams`) | host-wide agents: roster across sessions, team runs, teams (frame: `app-shell-navigation.Agents screen`) | `multi-agent-orchestration.Host-wide Agents screen` | yes |
| `/h/[hostId]/agents/runs/[runId]` | team run | `multi-agent-orchestration.Team run panel` | yes |
| `/h/[hostId]/workspaces`, `/h/[hostId]/workspaces/new`, `/h/[hostId]/workspaces/open` | workspaces index, new workspace, open a folder | `workspaces-terminal.Workspaces index and start tiles`, `workspaces-terminal.New workspace screen` | yes |
| `/h/[hostId]/workspaces/[workspaceId]` (`?file=`, `?terminal=`) | workspace screen | `workspaces-terminal.Workspace screen layout` | yes |
| `/h/[hostId]/automations`, `/h/[hostId]/automations/new`, `/h/[hostId]/automations/[automationId]` | automations index, editor, detail with run history | `automations.Automations index`, `automations.Automation editor`, `automations.Automation detail and run history` | yes |
| `/h/[hostId]/skills` (`?tab=installed\|browse`) | Skills | `skills.Skills screen — Installed`, `skills.Skills screen — Browse` | yes |
| `/h/[hostId]/skills/[skillId]` | skill detail | `skills.Skill detail` | yes |
| `/h/[hostId]/usage`, `/h/[hostId]/usage/[tab]` (tab ∈ `overview`, `providers`, `projects`, `sessions`, `plan`) | Usage | `usage-tracking.Usage screen — Overview` and the three sibling requirements | yes |
| `/_catalogue` | component catalogue, development and test builds only | `design-system.Component state coverage and catalogue` | no |
| `/+not-found` | not-found screen | this requirement | no |

The valid values of the `?tab=` query of a session are the workspace tab ids of `chat-agent.Workspace tab strip and new-tab page`. Redirects: `/settings/usage` opens `/h/[hostId]/usage` for the active host (the Usage screen has exactly one route, and with no active host the redirect lands on the requires-host state); `/h/[hostId]/film/[filmId]/episode/[episodeId]` opens that episode's last visited stage (default `story`). The valid values of `[section]` are the page ids of `settings-preferences.Settings navigation structure`, and of `[category]` those of `app-shell-navigation.Library screen`.

Unknown routes show the not-found screen with "Go home". Host-scoped routes whose host is not paired show "This host is not paired on this device" with "Pair" and "Go home". A host-scoped route opened by a device whose role is not permitted to open it shows "Your role on this host cannot open this screen" with "Go home". Each route sets a document title of the form "<item or screen> — JAgentChill" on web and desktop. Browser back and forward, the Android system back gesture or button, the iOS edge-swipe back gesture and header back button, and the desktop back/forward buttons and the actions `nav.back` / `nav.forward` (the same on macOS, Windows and Linux) traverse route history; overlays are not history entries except full-height sheets on compact form factors. A CI test SHALL compare this table with the router's file tree and fail on any route present in one and absent from the other, and a second CI test SHALL scan every capability spec for route strings and fail on one that matches no row of this table and on a row whose content owner is not an existing requirement. [JAD] [NEW]

#### Scenario: Unknown route
- **WHEN** the user opens `/does-not-exist`
- **THEN** the not-found screen with "Go home" is shown inside the shell

#### Scenario: Host-scoped route without that host
- **WHEN** a link to `/h/abc/sessions/123` is opened on a device not paired with host `abc`
- **THEN** the screen states that the host is not paired and offers "Pair" and "Go home"

#### Scenario: Route table matches the router
- **WHEN** a route file is added to the app without a row in this table
- **THEN** the route-map CI test fails and names the route

#### Scenario: Usage redirect
- **WHEN** the user opens `/settings/usage` while host `abc` is active
- **THEN** `/h/abc/usage` is shown

#### Scenario: Film stage route
- **WHEN** the user opens `/h/abc/film/f1/episode/e2/storyboard`
- **THEN** the Storyboard stage of episode `e2` is shown and reloading the page shows the same stage

#### Scenario: Back closes a compact sheet
- **WHEN** a full-height sheet is open on a phone and the user performs the system back gesture
- **THEN** the sheet closes and the underlying screen stays

### Requirement: Deep links and file types
A deep link SHALL be the scheme `jagentchill://` followed by a route path of `app-shell-navigation.Route map` without its leading slash, including the query parameters listed there, on every platform: for example `jagentchill://h/<hostId>/sessions/<sessionId>`, `jagentchill://h/<hostId>/workflows/runs/<runId>?node=<nodeId>`, `jagentchill://h/<hostId>/workspaces/<workspaceId>`, `jagentchill://editor/<projectId>`, `jagentchill://scripts/<scriptId>?review=<reviewId>`, `jagentchill://h/<hostId>/scripts/<scriptId>` (the form emitted for a synced script, so that a device paired with several hosts can resolve it), `jagentchill://exports/history?job=<jobId>`, `jagentchill://settings/<section>` and `jagentchill://notifications`. The one form that is not a route is `jagentchill://pair#offer=<payload>`, which opens `/pair/link` with the offer of `device-pairing-signing.Pairing offer format` and continues through `app-shell-navigation.Pairing flow routes`; its web equivalent, for a browser that cannot open the custom scheme, is `https://<origin>/jagentchill/app/#/pair/link?offer=<payload>` (the offer stays in the URL fragment and is never sent to a server). No other link form exists; other capabilities build links only from route paths. Parsing is strict: path parameters match `^[A-Za-z0-9_-]{1,64}$`, sections, categories, tabs and stages are members of their closed sets, the whole link is at most 4,096 characters, and anything else shows the toast "This link is not valid" with no navigation. A link never performs a state-changing action by itself: it only navigates, and pairing links always show the confirmation and verification steps. Links received while a blocking modal is open, or before startup routing has finished, are queued in arrival order (at most 10; further ones are dropped) and handled afterwards.

OS registration: the desktop app registers the scheme per `desktop-app.Deep links`; the iOS and Android apps register the scheme in the Expo app configuration (`scheme: "jagentchill"`) and handle the same forms; the web app accepts the same paths as URLs under its own origin.

The app SHALL open these file types, routing each to its owner: `.jagentchill` (MIME `application/vnd.jagentchill.project+zip`) → `projects.Project package import`; `.jctpl` and `.jcpack` → `templates.Import a package`; `.jcworkflow` (MIME `application/vnd.jagentchill.workflow+json`) → the import of `agent-workflows`; `.jcscript` (MIME `application/vnd.jagentchill.script+json`) and `.fountain` → `script-studio.Import`; `.jckeys` (MIME `application/vnd.jagentchill.keys+json`) → `keyboard-shortcuts.Import and export of presets`. Every product file type has one final extension, so that it can be registered on macOS, Windows and Linux alike; the earlier compound names `*.jcworkflow.json`, `*.jcscript.json` and `*.jckeys.json` are still accepted by the in-app file pickers, by drag and drop and by the mobile document picker, recognised by content, and are never registered with an operating system. On desktop the OS association is `desktop-app.File associations` (macOS, Windows, and Linux including the AppImage); on iOS the app declares the same types as exported document types and on Android as intent filters by MIME type and extension, so the files open from the Files app, the share sheet and the document picker; on web they arrive through the file picker and drag and drop. [JAD] [NEW]

#### Scenario: Session link on a phone
- **WHEN** a paired phone opens `jagentchill://h/abc/sessions/s_1`
- **THEN** the app shows the session `s_1` of host `abc`

#### Scenario: Malformed link
- **WHEN** the OS opens `jagentchill://editor/../../x`
- **THEN** no navigation occurs and the toast "This link is not valid" is shown

#### Scenario: Link during a blocking modal
- **WHEN** a link arrives while a blocking confirmation is open
- **THEN** the link is handled after the modal closes and the modal's state is unchanged

#### Scenario: Link cannot act
- **WHEN** a link to a workflow run is opened
- **THEN** the run view is shown and no run is started, cancelled or approved by opening the link

#### Scenario: Script file
- **WHEN** the user opens a `.fountain` file with the app
- **THEN** the import preview of `script-studio.Import` is shown

#### Scenario: Workflow file on every platform
- **WHEN** the user opens `intro.jcworkflow` from the file manager on macOS, Windows or Linux, from the Files app on iOS or Android, or drops it on the web app
- **THEN** the workflow import of `agent-workflows` is shown

#### Scenario: Earlier compound name
- **WHEN** the user picks `intro.jcworkflow.json` in the in-app file picker
- **THEN** it is recognised by its content and imported the same way

#### Scenario: Web pairing link
- **WHEN** a browser opens `https://<origin>/jagentchill/app/#/pair/link?offer=<payload>`
- **THEN** `/pair/link` shows the offer review and the payload was not part of any request to the server

### Requirement: Pairing flow routes
The pairing flow of a new device SHALL be a linear stack of routes. What each screen shows, its states, texts, timings and error codes are owned by `device-pairing-signing.Pairing flow on the new device`, `device-pairing-signing.Offer presentation and intake` and `device-pairing-signing.Tailnet login step`; this requirement owns only the routes, their order and the navigation between them, which SHALL be identical on iOS and Android, identical on macOS, Windows and Linux, and the same on web except where the table says otherwise.

| Step | Route | Screen | Present on |
|---|---|---|---|
| 1 | `/pair/start` | "Add a host": "Scan QR code", "Paste a link" and "Enter a short code" (host address plus the 8-character code; in a web app served by a host the address is pre-filled with the page origin) | every platform |
| 1 | `/pair/scan` | camera scanner for the offer QR code | iOS and Android always; desktop and web when a camera is available |
| 1 | `/pair/link` | offer review: host name, Gateway fingerprint and the offered addresses with their kind (`loopback`, `lan`, `tailnet`); reached by scan, paste, short-code resolution, the deep link `jagentchill://pair#offer=<payload>` or, on web, `#/pair/link?offer=<payload>` | every platform |
| 2 | `/pair/tailnet` | "Sign in to Tailscale" (interactive sign-in and auth key); under the spike S20 fallback of `device-pairing-signing.Embedded tailnet node on mobile` the same route shows that requirement's "Open Tailscale" screen on iOS and Android alike | iOS, Android and the desktop app; never on web |
| 3 | `/pair/verify` | "Connecting to host", "Verifying host", code entry ("Enter the code shown next to <fingerprint>") and "Paired" | every platform |

The order SHALL be fixed: "Add a host" (capture the offer), then "Sign in to Tailscale", then code entry. Step 2 is entered only under the conditions of `device-pairing-signing.Tailnet login step` (the offer's reachable address is of kind `tailnet` and this device's tailnet node is not `running`) and is skipped otherwise; the step indicator shows three steps when step 2 applies and two when it does not. `/pair/verify` cannot be opened without a captured, unexpired offer: opening it directly redirects to `/pair/start`. `/pair/tailnet` opens without an offer only as the sign-in screen for an already paired host that is reachable over the tailnet alone (the reconnect case of `device-pairing-signing.Tailnet login step`, entered from "Sign in to Tailscale" on that host's row), and then returns to the route it was opened from once the node is `running`; with neither an offer nor such a host it redirects to `/pair/start`. On web, `/pair/tailnet` redirects to `/pair/link`, which shows the sentence of `device-pairing-signing.Web clients and the tailnet` when the offer needs a tailnet path the browser's machine does not have.

Navigation rules: Back on `/pair/tailnet` returns to `/pair/link` and keeps the offer; Back or "Cancel" on `/pair/verify` before "Paired" asks "Cancel pairing?" and, when confirmed, cancels the request on the host and returns to `/pair/start`; the interactive sign-in opens the login URL in an in-app browser tab on iOS and Android and in the system browser on desktop, and when the tailnet node reports `running` the app continues to `/pair/verify` without a further tap; "Done" on "Paired" returns to the route the flow was opened from with the new host active. The captured offer is persisted by the owner for as long as it is unexpired, so `app-shell-navigation.Startup routing and restore` reopens the flow at the step it had reached after the app was suspended or restarted during sign-in; an offer that expired meanwhile opens `/pair/start` with "Ask for a new code on the trusted device". The flow is opened by "Add a host…" in the host switcher, "Connect" in the Home composer, "Connect a host" in every requires-host state, step 3 of the welcome flow, Personal ▸ Connections, and a pairing deep link (which opens `/pair/link`).

On the trusted device, pairing is not a route of this stack: "Pair a device" opens the offer sheet of `device-pairing-signing.Offer presentation and intake` on `/devices` (`/devices?pair=1`), which, while the host is reachable on this computer only, shows the heading "Pair a browser on this computer" with the link and the short code (no QR code) and leads to `desktop-app.Network access setting` ("To pair a phone or another computer, open Network access"). A browser on another computer can reach a host only over the tailnet with its browser-trusted certificate, or over the local network when an admin installed a browser-trusted certificate (`settings-preferences.Host web access settings`); `/pair/link` on web shows the sentence of `device-pairing-signing.Web clients and the tailnet` when the offer has no address a browser can use. The tailnet node used by step 2 is the native module `JagentchillTailnet` on iOS and Android (`mobile-editor.Native modules and app registration`) and the helper of `desktop-app.Desktop tailnet proxy helper` on desktop; "Sign out of Tailscale" is on Personal ▸ Connections (`settings-preferences.Connections and devices page`). [JAD] [NEW]

#### Scenario: Phone away from the host's network
- **WHEN** a phone that is not signed in to a tailnet scans an offer whose only reachable address is of kind `tailnet`
- **THEN** the routes shown are `/pair/scan`, `/pair/link`, `/pair/tailnet` and `/pair/verify` in that order, and the step indicator shows three steps

#### Scenario: Same order on iOS and Android
- **WHEN** the same offer is scanned on an iPhone and on an Android phone in the same network situation
- **THEN** both show the same routes, screens and step indicator in the same order

#### Scenario: Host answers on the local network
- **WHEN** the offer also has a `lan` address that answers
- **THEN** `/pair/tailnet` is skipped, the indicator shows two steps, and `/pair/verify` follows `/pair/link`

#### Scenario: App restarted during sign-in
- **WHEN** the operating system ends the app while the Tailscale login page is open and the user returns after 2 minutes with the offer still valid
- **THEN** the app reopens on `/pair/tailnet`, and when the node is `running` it continues to `/pair/verify`

#### Scenario: Offer expired during sign-in
- **WHEN** the offer expires before sign-in completes
- **THEN** `/pair/start` is shown with "Ask for a new code on the trusted device" and the device stays signed in to the tailnet

#### Scenario: Direct open without an offer
- **WHEN** the user opens `/pair/verify` with no captured offer
- **THEN** the app shows `/pair/start`

#### Scenario: Web has no sign-in step
- **WHEN** the web app opens `/pair/tailnet`
- **THEN** `/pair/link` is shown, with the sentence explaining that a browser cannot join a tailnet by itself when the offer needs one

#### Scenario: Trusted side
- **WHEN** an admin chooses "Pair a device" in the host switcher while Network access is "This computer only"
- **THEN** `/devices?pair=1` opens the offer sheet with "Pair a browser on this computer", the link and the short code without a QR code, and "Open Network access" for phones and other computers

#### Scenario: Browser on the same computer at the default level
- **WHEN** the web app is opened at the host's loopback address, the user chooses "Enter a short code" and types the code shown by the desktop app
- **THEN** the address is already filled with the page origin, the flow continues to `/pair/verify` and the browser is paired over loopback with the six-digit code

### Requirement: Startup routing and restore
At launch the `/` route SHALL decide the first screen in this order: an incoming deep link or file-open request, if any; `/welcome` when the welcome flow has not been seen; the step reached in an unfinished pairing flow whose offer is still unexpired (`app-shell-navigation.Pairing flow routes`); the last visited route of this window when it is still valid (its project, session, script or host still exists); otherwise `/home`. While local state loads, a splash with the JAgentChill mark is shown; local state SHALL finish loading within 1,500 ms on the reference desktop of `diagnostics-quality.Performance budgets` with 1,000 projects in the index, and the splash is removed within 300 ms after it has loaded. Cached list data is painted before the host connection is up and marked stale until refreshed. Screens that show project or host data are not rendered before the device identity and preferences have loaded. If the restored route's target has been deleted, the app opens the parent list and shows a toast naming what is missing. [JAD] [NEW]

#### Scenario: Restore last route
- **WHEN** the user quits while viewing a session and relaunches
- **THEN** the same session is shown with cached content first and live content after the host connects

#### Scenario: Restored target deleted
- **WHEN** the last route was a project that was deleted on another device
- **THEN** the Projects list opens and a toast says the project no longer exists

#### Scenario: Deep link has priority
- **WHEN** the app is launched by a `jagentchill://` link to a project
- **THEN** that project opens instead of the last visited route

#### Scenario: Splash timing
- **WHEN** the app starts on the reference desktop with 1,000 projects in the local index
- **THEN** local state has loaded within 1,500 ms and the splash is gone within a further 300 ms

### Requirement: Lists for primary sections
The index screen of a primary section SHALL follow one frame unless its owning requirement in `app-shell-navigation.Route map` defines its own: a `type/h1` heading with a one-line description, a toolbar (search, filter chips with "+ Add filter", sort select, view toggle where a grid applies, and one `strong` create button), and the list as a `design-system.Table` on medium and wide form factors or stacked rows on compact ones. Lists load 50 items at a time with infinite scrolling, show skeleton rows while loading, the first-use empty state with the create action when empty, the no-results state when filters match nothing, and the error state with "Retry" on failure. Multi-selection enables the bulk actions the owner defines. Two sections are explicit exceptions to the table layout: **Projects**, whose index (grid of cards, its own loading and bulk bar) is defined by `projects.Projects list`, `projects.Project views and view persistence` and `projects.Bulk actions`; and **Devices**, whose list content, order and actions are defined by `device-pairing-signing.Device list management` (the Settings pages only link to `/devices`). [NEW]

#### Scenario: Filter chips
- **WHEN** the user adds the filter "Status is Failed" on Sessions
- **THEN** a chip "Status is Failed ×" appears, only failed sessions are listed, and removing the chip restores the full list

#### Scenario: Load failure
- **WHEN** the list request fails
- **THEN** the error state with "Retry" is shown and the toolbar remains usable

#### Scenario: Projects uses its own index
- **WHEN** the user opens `/projects` on a wide form factor
- **THEN** the grid of `projects.Projects list` is shown, not a table

### Requirement: Global drag and drop of files
Dragging files from the OS over the app window SHALL show a drop target appropriate to the screen: in the editor, the asset panel highlights with "Drop to import" (`media-library.Drag-and-drop import into the library`) and the timeline accepts the drop defined by `timeline-editing.Operating-system file drop`; on Home and in a session, the composer shows "Drop to attach"; on Projects, a full-content overlay reads "Drop to create a project from these files" for media files and "Drop to import project" for `.jagentchill` packages; on Scripts, "Drop to import script" for `.fountain`, `.jcscript`, `.txt` and `.docx` files; on Workflows, "Drop to import workflow" for `.jcworkflow` files; in a workspace, the explorer accepts the upload of `workspaces-terminal`. A drop of media files on Projects creates one project containing the files in drop order and opens the editor. Dropping outside any target does nothing and the browser's default file navigation is always prevented. Unsupported files are reported per file by toast naming the file and the reason. On the desktop app, files dropped on the application icon — the Dock icon on macOS, the taskbar icon on Windows, and the launcher or dock icon on Linux desktops that support dropping onto it — are routed as described in `desktop-app.Drag-in from the operating system`. On mobile, files arrive through the OS share sheet and document picker and are routed by the same rules. [NEW]

#### Scenario: Drop on Projects
- **WHEN** the user drops two video files on the Projects screen
- **THEN** a new project is created containing both files in drop order and the editor opens

#### Scenario: Stray drop
- **WHEN** the user drops a file onto the top bar
- **THEN** nothing is imported and the window does not navigate to the file

#### Scenario: Unsupported file
- **WHEN** the user drops an `.exe` file on the Projects screen
- **THEN** a toast names the file and "Unsupported file type" and no project is created

### Requirement: What's new card
After the app updates to a release that has a release-notes entry, the shell SHALL show the "What's new" card of `updates-distribution.Release notes view`, which owns the card's content, data shape, seen-version rule and the release-notes screens. The shell owns only placement and routes: the card sits at the bottom inline-start corner of the content region on medium and wide form factors (288 px wide, `elevation/1`) or as a row at the top of Home on compact ones; its button "See what's new" opens `/changelog/[version]`; `/changelog` and `/changelog/[version]` render the release-notes view; and `/settings/about` ▸ "Release notes" opens `/changelog`. Release notes ship inside the app bundle; displaying them makes no network request. [PORT SH-008] [NEW]

#### Scenario: After an update
- **WHEN** the app is updated from 1.2.0 to 1.3.0 and 1.3.0 has a release-notes entry
- **THEN** the card is shown once in the placement for the current form factor, and its button opens `/changelog/1.3.0`

#### Scenario: Fresh install
- **WHEN** the app is launched for the first time on a device
- **THEN** no "What's new" card is shown

### Requirement: Shell state persistence
The shell SHALL persist per device, in the preferences store of `project-storage.UI preference storage`: theme, language, sidebar width and collapsed state, expanded folders, last active host, last route per window, split ratios per session, editor panel sizes and layout preset, editor agent panel width and collapsed state, inspector section states, dismissed cards and checklist state. State keys are namespaced `jagentchill.*`, schema-validated on read and versioned; an entry that fails validation is discarded and its default applied without blocking startup. Classic UI preferences (`panel-sizes`, `assets-panel`, `projects-view-mode`, `preview-settings`, `timeline-store`, theme) are migrated once when they arrive in the `local-storage.json` of a classic bundle through `projects.OpenCut classic data import`, or in place when the app is served from the classic origin; `hasSeenOnboarding` and `last-seen-version` are ignored. Pinned items, folders and tags of host-scoped entities are stored on the host and are the same on every paired device. [PORT SH-002] [JAD] [NEW]

#### Scenario: Invalid stored entry
- **WHEN** the stored editor panel sizes fail validation at startup
- **THEN** default sizes are used, the invalid entry is removed and the app starts normally

#### Scenario: Host-scoped organisation syncs
- **WHEN** the user pins a session on the desktop
- **THEN** the same session appears under Pinned on the paired phone within 2 s while both are connected

#### Scenario: Classic panel sizes from a bundle
- **WHEN** a classic bundle whose `local-storage.json` holds `panel-sizes` version 2 is imported
- **THEN** the editor panels use those sizes, clamped to the limits of `app-shell-navigation.Editor four-region layout`

### Requirement: Editor agent panel
The editor SHALL have a fifth, collapsible region, the agent panel, docked at the inline-end side of the inspector: collapsed by default; 360 px wide when open, resizable from 320 px to 40% of the editor width; a 420 px overlay on medium form factors, and a full-height sheet on compact ones, opened by the "Agent" button of `mobile-editor.Top bar`. The docked panel takes its width from the editor, and the percentages and the 280 px floors of `app-shell-navigation.Editor four-region layout` then apply to the remaining width; it opens docked only when that remaining width is at least 860 px (280 px asset panel + 300 px player + 280 px inspector), and otherwise opens as the 420 px overlay even on a wide form factor, returning to docked when the window is widened. While the panel is docked, a resize that would push the remaining width below 860 px stops there. It is toggled by the top bar's agent toggle and the action `editor.agent-panel.toggle`. The panel contains the chat pane of `chat-agent.Session split view` for the most recent session bound to the open project (`chat-agent.Session project binding`), or the new-session composer when no session is bound, with a header holding a session switcher (sessions bound to this project, newest first, plus "New session") and "Open in session view" (navigates to `/h/[hostId]/sessions/[sessionId]`). Proposal cards shown in this panel preview on the editor's own player and timeline (`chat-agent.Proposal cards`). Without a connected host the panel shows the requires-host state. Width and collapsed state persist per device. [NEW]

#### Scenario: Open the panel
- **WHEN** the user toggles the agent panel in a project that has one bound session, at 1600 px width
- **THEN** a 360 px panel opens at the inline-end side of the inspector showing that session's chat and composer

#### Scenario: No bound session
- **WHEN** the panel is opened in a project with no session
- **THEN** the new-session composer is shown, and sending a message creates a session bound to this project without leaving the editor

#### Scenario: Width limits
- **WHEN** the user drags the panel's splitter to 200 px
- **THEN** the panel stops at 320 px

#### Scenario: Narrow wide window
- **WHEN** the editor is 1,100 px wide and the user opens the agent panel
- **THEN** the remaining width would be 740 px, below 860 px, so the panel opens as a 420 px overlay and the three top regions keep their sizes

#### Scenario: No host
- **WHEN** the panel is opened in local-only mode
- **THEN** it shows "Requires a host" with "Connect a host" and no composer

### Requirement: Library screen
The Library (`/library`) SHALL be a device-wide browser of reusable items with a category rail and a content area. This table is the only definition of the categories; each category renders the owning capability's browser in "library scope" (items of this device and, when connected, of the active host's library sync — `cross-device-sync.Library item sync`), with that owner's import, rename, delete and empty state.

| Category id | Label | Content owner |
|---|---|---|
| `templates` | Templates | `templates.Template gallery`, `templates.Manage personal templates` |
| `packs` | Preset packs | `templates.Preset packs` |
| `fonts` | Fonts | `text-and-titles` (imported fonts) |
| `luts` | LUTs | `color-adjustment` (LUT library) |
| `sounds` | Saved sounds | `audio-editing.Saved sounds` |
| `stickers` | Stickers | `stickers-shapes` (imported stickers) |
| `brand-kits` | Brand kits | `templates.Brand kit` |

Project media is not a Library category: media belongs to a project and is browsed in the editor's Media tab. `/library` opens the last visited category (default `templates`); `/library/[category]/[itemId]` shows an item's detail (for a template: preview and "Use template"). An "Import…" button in the header accepts `.jctpl`, `.jcpack`, font, `.cube` and sticker files and routes each to its owner. On compact form factors the rail becomes a horizontally scrolling chip row. The Library works without a host. [NEW]

#### Scenario: Categories
- **WHEN** the user opens `/library`
- **THEN** the rail lists exactly Templates, Preset packs, Fonts, LUTs, Saved sounds, Stickers and Brand kits in that order

#### Scenario: Use a template
- **WHEN** the user opens `/library/templates`, chooses a template and activates "Use template"
- **THEN** the flow of `templates.Use a template` starts

#### Scenario: Empty category
- **WHEN** no LUT has been imported
- **THEN** the LUTs category shows its owner's first-use empty state with an import action

#### Scenario: Unknown category
- **WHEN** the user opens `/library/unknown`
- **THEN** the not-found screen is shown

### Requirement: Exports screen
The route `/exports` SHALL show a screen with three tabs, each rendering content owned by `export-share`: **Queue** (`/exports/queue`, default; `export-share.Export queue` — on-device jobs of this device and, when connected, Gateway export jobs of the active host), **History** (`/exports/history`; `export-share.Export history`) and **Links** (`/exports/links`; the share links of `export-share.Share link through the Gateway`, showing the requires-host state without a host). The screen is opened from the sidebar footer's Exports button, the editor top bar's export-activity indicator, the editor header menu, and export notifications. A job row opens the completion or failure view of `export-share.Completion view and desktop share targets`. Queue and History work without a host. [NEW]

#### Scenario: Open from the footer
- **WHEN** the user activates the Exports button while one export is running
- **THEN** `/exports/queue` opens and lists that job with its progress

#### Scenario: Links without a host
- **WHEN** the user opens `/exports/links` in local-only mode
- **THEN** the requires-host state is shown and the Queue and History tabs remain usable

#### Scenario: History entry
- **WHEN** the user activates a succeeded job on the History tab
- **THEN** the completion view for that job opens

### Requirement: Agents screen
The route `/h/[hostId]/agents` SHALL show a host-wide oversight screen with three tabs: **Roster** (default) — every session of the host that currently has more than one agent, each as a collapsible group showing the agent tree rows of `multi-agent-orchestration.Agents tab and roster` with a host-wide "Needs you" section on top; **Team runs** — team runs of the host, newest first, with Team name, status, stage, elapsed time and cost, each opening `/h/[hostId]/agents/runs/[runId]` (the panel of `multi-agent-orchestration.Team run panel` at full width, with a link to its session); **Teams** — the Teams of the host with, on `admin` devices, "Edit" opening that team's editor at `/settings/host/[hostId]/teams/[teamId]` (the list of Teams is `/settings/host/[hostId]/teams`). Activating an agent row opens its session at `/h/[hostId]/sessions/[sessionId]?tab=agents&agent=<agentId>`. Row content, statuses, intervene actions, role gating and empty states are owned by `multi-agent-orchestration.Host-wide Agents screen`; this requirement owns the screen frame, tabs and routes. Lists follow `app-shell-navigation.Lists for primary sections`. With no multi-agent session the Roster tab shows "No agent teams are running" with "Start a session". [NEW]

#### Scenario: Roster across sessions
- **WHEN** two sessions each have a lead and two peers
- **THEN** the Roster tab shows two groups with three agent rows each and the pending approvals of both under "Needs you"

#### Scenario: Open a team run
- **WHEN** the user activates a row on the Team runs tab
- **THEN** `/h/[hostId]/agents/runs/[runId]` shows that run's brief, members, assignments and result

#### Scenario: Empty roster
- **WHEN** no session has more than one agent
- **THEN** the Roster tab shows "No agent teams are running" with "Start a session"

### Requirement: Features that require a host
The shell SHALL treat exactly the following as requiring a connected host; every other feature works on the device alone. This table is the source for the link badge on every platform and the requires-host state of screens. A host is the JAgentChill desktop app on macOS, Windows or Linux, or the headless Gateway on the user's own server; a phone, a tablet or a browser cannot be a host, and there is no vendor-hosted service.

| Feature | Owner |
|---|---|
| Agent chat, sessions, team mode, agents | `chat-agent`, `multi-agent-orchestration` |
| Workflows and prompt-to-video | `agent-workflows`, `prompt-to-video-workflow` |
| Film Studio | `film-production` |
| Automations | `automations` |
| Workspaces, host files and terminal | `workspaces-terminal` |
| Skills management, Usage | `skills`, `usage-tracking` |
| Agent drafting and agent review of scripts (authoring by hand is local) | `script-studio` |
| Project and library sync, review comments, presence | `cross-device-sync` |
| AI tools that run on a provider or on the host (tools that run on the device — including standard and custom cutout on phones — are not in this table) | `ai-editing-tools.Execution location per tool` |
| Online sound search | `audio-editing.Sound search proxy` |
| Export on the host, share links, publishing connectors | `export-share` |
| Push notifications | `notifications.Mobile push delivery` |
| Drive and Dropbox import | `media-library` |

A control for a host feature SHALL remain visible **and enabled** without a host, with one rule on web, desktop (macOS, Windows, Linux) and mobile (iOS, Android): it carries the link badge and the accessible text "requires a host" (the `requiresHost` prop of `design-system.Button`, which buttons, icon buttons, menu rows, list rows and tiles share), it is focusable by keyboard, and activating it by pointer, touch or keyboard opens the requires-host sheet — an `AdaptiveSheet` naming the feature, reading "Requires a host", with the one-sentence explanation of what a host is and the actions "Connect a host" (opens `/pair/start`) and "Not now". No host-gated control is rendered disabled for lack of a host, and no requirement of any capability states "disabled with the tooltip 'Requires a host'". [NEW]

#### Scenario: Local feature without a host
- **WHEN** no host is connected and the user edits, adds captions on device and exports on device
- **THEN** every step completes with no requires-host prompt

#### Scenario: Host feature without a host
- **WHEN** no host is connected and the user chooses "Export on host" in the export dialog
- **THEN** the option is enabled and shows the link badge, and activating it — by click, tap or keyboard — opens the requires-host sheet with "Connect a host" without starting an export

#### Scenario: Same on phone and desktop
- **WHEN** the same host-gated tool is shown in the mobile editor and in the desktop inspector with no host connected
- **THEN** both show the link badge, both are enabled, and both open the requires-host sheet
