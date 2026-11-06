## ADDED Requirements

### Requirement: Token source and theming contract
The design system SHALL live in `packages/ui` and expose every visual value as a named token registered with react-native-unistyles under exactly two themes, `light` and `dark`. This capability is the only owner of visual tokens: the token tables of this spec (`Colour tokens`, `Editor colour tokens`, `Workflow canvas tokens`, `Terminal tokens`, `Data-visualisation tokens`, and the typography, spacing, radius, elevation, motion, icon and control tables) are the complete registry, and no other capability defines a colour, radius, spacing, shadow or duration value — it names tokens. Components MUST read colours, sizes, radii, shadows and durations only from tokens; a literal hex colour, pixel size or millisecond value inside a component style is a lint error, with the single exception of user-chosen content colours (text colour, shape fill, per-clip background). The theme preference is one of `system`, `light`, `dark` (default `system`); `system` follows the OS appearance and switches within 200 ms of an OS change without reload.

The token source also feeds the normative UI design file required by `design-system.Normative UI design file`. No name, logo, wordmark or icon of any reference product is included in the package. [PORT SH-005] [JAD] [NEW]

#### Scenario: System theme follows the OS
- **WHEN** the preference is `system` and the OS switches from light to dark appearance
- **THEN** every mounted surface re-renders with the `dark` token values within 200 ms
- **AND** no screen reloads and no scroll position, selection or open overlay is lost

#### Scenario: Explicit theme overrides the OS
- **WHEN** the user selects `light` while the OS is in dark appearance
- **THEN** the app renders with `light` tokens and keeps doing so after restart
- **AND** the Electron window chrome, the mobile status bar style and the web `theme-color` meta use the `light` `bg/app` value

#### Scenario: Hard-coded value is rejected
- **WHEN** a component style in `packages/ui`, `packages/archify` (the workflow canvas of `workflow-diagram.Archify fork package`) or `apps/app` contains a literal colour such as `#2F6FEB` or `#FFFFFF`
- **THEN** the lint gate fails and names the file and line

### Requirement: Normative UI design file
The repository SHALL contain the normative UI design file `docs/design/jagentchill-ui.html` (design D14, decision B10): one self-contained static HTML file — no network request, no script fetched at run time, fonts and images inlined or referenced from `docs/design/assets/` — that is the visual source of truth for implementers. It is **built from the tokens**: `pnpm jagentchill:design:build` generates its CSS custom properties from the token export of `design-system.Token source and theming contract` and renders its frames from the component catalogue's static markup, so every colour, size, radius, type, elevation and motion value in the file is a token value, in a light and a dark variant. The file is committed; it uses no name, logo or asset of any reference product.

**Frames.** A frame is one screen state at one viewport, identified as `<frameId>@<viewport>/<theme>`. Viewports: `desktop` (1,440×900, regular density), `desktop-min` (960×600, regular density; required for the frames marked †), `tablet` (1,180×820, compact-touch density), `phone` (390×844, compact-touch density). Every frame exists in `light` and `dark`. **Every route of `app-shell-navigation.Route map` SHALL have at least one frame at `desktop` and one at `phone`** (routes that never appear on a form factor are exempt only as the table says), and the list below names the frames that must exist per route; a route with several rows has all of them.

| Route | Required frames (each at `desktop` and `phone`, light and dark, unless noted) |
|---|---|
| shell (every route) | `shell.sidebar` † (seven primary rows, More closed, secondary list ≥ 240 px), `shell.sidebar.more-open`, `shell.sidebar.more-popover` †, `shell.host-switcher`, `shell.drawer.menu` and `shell.drawer.section` (`phone`), `shell.app-menu` (`desktop`, Windows and Linux chrome) and `shell.window-chrome` (`desktop`: macOS, Windows, Linux), `shell.command-palette`, `shell.cheat-sheet`, `shell.requires-host-sheet`, `shell.tablet` (`tablet`: pinned sidebar with 44 px rows) |
| `/welcome` | `welcome.intro`, `welcome.language`, `welcome.host` (desktop variant with the built-in host; phone variant with the host sentence), `welcome.provider` (three access methods), `welcome.openh264-dialog` (`desktop`), `welcome.key-storage-dialog` |
| `/pair/start`, `/pair/scan`, `/pair/link`, `/pair/tailnet`, `/pair/verify` | `pair.start`, `pair.scan`, `pair.link` (with the web sentence variant), `pair.tailnet` (interactive and auth key), `pair.verify.code`, `pair.verify.paired`, `pair.offer-expired` |
| `/home` | `home.default` †, `home.no-host`, `home.checklist.provider-open`, `home.mentions`, `home.mobile-grid` (`phone`) |
| `/projects`, `/projects/folder/[folderId]`, `/projects/trash` | `projects.grid`, `projects.list`, `projects.empty`, `projects.folder`, `projects.trash`, `projects.bulk` |
| `/editor/[projectId]` | `editor.four-region` †, `editor.agent-panel.docked`, `editor.agent-panel.overlay`, `editor.medium` (800 px wide), `editor.inspector` (one frame per inspector tab group: video, audio, text, captions, colour, effects, mask, speed, keyframes), `editor.timeline.states` (clip states of `design-system.Timeline atoms`), `editor.multicam-viewer`, `editor.export-dialog`, `editor.loading`, `editor.not-found`, `editor.read-only`; `phone`: `mobile-editor.root`, `mobile-editor.clip-strip`, `mobile-editor.tool-sheet`, `mobile-editor.export-sheet`, `mobile-editor.agent-sheet`; `tablet`: `mobile-editor.tablet` |
| `/scripts`, `/scripts/[scriptId]`, `/scripts/[scriptId]/review`, `/h/[hostId]/scripts/[scriptId]` | `scripts.list`, `script.editor.structured`, `script.editor.text`, `script.compare`, `script.review`, `script.resolving` |
| `/library`, `/library/[category]`, `/library/[category]/[itemId]` | `library.category` (one per category of `app-shell-navigation.Library screen`), `library.item`, `library.empty` |
| `/exports`, `/exports/[tab]` | `exports.queue`, `exports.history` (with a job selected), `exports.links`, `exports.links.requires-host` |
| `/devices`, `/devices/[deviceId]` | `devices.list`, `devices.offer-sheet` (QR variant and the "This computer only" link-and-code variant), `devices.detail`, `devices.pending-request` |
| `/notifications` | `notifications.inbox` (popover at `desktop`, full screen at `phone`), `notifications.empty`, `notifications.toast-stack`, `notifications.lock-screen` (`phone`: fixed titles per push class) |
| `/settings`, `/settings/[section]` | one frame per Personal page of `settings-preferences.Settings navigation structure`: `settings.preferences` (with the Accessibility card), `settings.editing`, `settings.performance`, `settings.storage`, `settings.shortcuts` (list, recording, conflict), `settings.notifications`, `settings.connections` (Network access at each level; the key-file notice), `settings.privacy`, `settings.updates`, `settings.about` |
| `/settings/host/[hostId]`, `/settings/host/[hostId]/[section]`, `/settings/host/[hostId]/[section]/[itemId]` | `host.landing` and one frame per Host page: `host.general` (encoder table), `host.web-access`, `host.sessions`, `host.agents`, `host.teams` and `host.team-editor`, `host.runtimes.providers` (a vendor card with the three access methods, an expiring account), `host.runtimes.sign-in` (browser, device code, phone hand-off), `host.runtimes.cli`, `host.runtimes.endpoints`, `host.runtimes.media`, `host.runtimes.matrix`, `host.model-routing`, `host.skills`, `host.knowledge`, `host.secrets` (with the add sheet), `host.usage`, `host.workspaces`, `host.terminal`, `host.connectors`, `host.storage`, `host.updates`, `host.diagnostics`; and `host.read-only` (a page as seen by an `editor`) |
| `/changelog`, `/changelog/[version]` | `changelog.list`, `changelog.version`, `shell.whats-new-card` |
| `/h/[hostId]/sessions`, `/h/[hostId]/sessions/import`, `/h/[hostId]/sessions/[sessionId]` | `sessions.list`, `sessions.import`, `session.split` †, `session.roster-docked`, `session.medium-overlay`, `session.mobile.chat` and `session.mobile.workspace` (`phone`), `session.model-browser` (models listed per access method), `session.share-control`, `session.approval-card`, `session.proposal-card`, one frame per workspace tab (Timeline preview, Changes, Worklog, Diagram, Assets, Files, Terminal, Agents) |
| `/h/[hostId]/workflows`, `/h/[hostId]/workflows/[workflowId]`, `/h/[hostId]/workflows/runs/[runId]` | `workflows.list`, `workflow.canvas.edit` (palette, ports), `workflow.canvas.agent-build`, `workflow.canvas.proposal-diff`, `workflow.outline`, `workflow.run.setup`, `workflow.run.running`, `workflow.run.needs-you`, `workflow.run.summary` (skipped nodes listed) |
| `/h/[hostId]/film`, `/h/[hostId]/film/hub`, `/h/[hostId]/film/hub/[folderId]`, `/h/[hostId]/film/[filmId]`, `/h/[hostId]/film/[filmId]/direction`, `/h/[hostId]/film/[filmId]/episode/[episodeId]/[stage]` | `film.list`, `film.hub`, `film.direction`, and one frame per stage: `film.story`, `film.script`, `film.assets`, `film.storyboard`, `film.video`, `film.voice`, `film.sound`, `film.timeline` |
| `/h/[hostId]/agents`, `/h/[hostId]/agents/runs/[runId]` | `agents.roster`, `agents.runs`, `agents.teams`, `agents.run-panel`, `agents.run-stalled` |
| `/h/[hostId]/workspaces`, `/h/[hostId]/workspaces/new`, `/h/[hostId]/workspaces/open`, `/h/[hostId]/workspaces/[workspaceId]` | `workspaces.index`, `workspaces.new`, `workspaces.open`, `workspace.files`, `workspace.diff`, `workspace.terminal`, `workspace.terminal.mobile-key-row` (`phone`) |
| `/h/[hostId]/automations`, `/h/[hostId]/automations/new`, `/h/[hostId]/automations/[automationId]` | `automations.list`, `automation.editor` (schedule with the time and weekday fields), `automation.detail` (run history with sparkline) |
| `/h/[hostId]/skills`, `/h/[hostId]/skills/[skillId]` | `skills.installed`, `skills.browse`, `skill.detail` |
| `/h/[hostId]/usage`, `/h/[hostId]/usage/[tab]` | `usage.overview`, `usage.providers`, `usage.projects`, `usage.sessions`, `usage.plan` (plan windows of a signed-in account) |
| `/_catalogue` | `catalogue.components` — every component of `design-system.Component state coverage and catalogue` in every state, at `desktop`, `tablet` and `phone` |
| `/+not-found` and route errors | `not-found`, `host-not-paired`, `role-not-permitted` |

Every list screen additionally has the frames `<screen>.empty`, `<screen>.loading`, `<screen>.error`, `<screen>.offline` and, for host-scoped screens, `<screen>.requires-host`. The file opens on an index that lists the frames by route, lets the reader switch theme and viewport, and carries, for each frame, the `capability.Requirement` names it illustrates.

**Gate.** `pnpm jagentchill:check:design` (a step of `diagnostics-quality.Verify gate`) SHALL fail when: (1) a route of `app-shell-navigation.Route map` has no frame at `desktop` or at `phone` in both themes, or a frame id of the table above is missing; (2) the committed file differs from the output of `pnpm jagentchill:design:build`; (3) a colour, size, radius or duration in the file is not a token value, or a token name or value in it differs from the token export; (4) a `capability.Requirement` named by a frame does not resolve; (5) the file makes a network request when opened; (6) a frame's rendered text/background or control/background pair is below the thresholds of `design-system.Contrast pair matrix`. A route added to the route map without a frame therefore fails the build. [NEW]

#### Scenario: Every route has a frame
- **WHEN** `pnpm jagentchill:check:design` compares the frames of the file with `app-shell-navigation.Route map`
- **THEN** each route has at least one frame at `desktop` and one at `phone`, in light and in dark, or the check fails naming the route

#### Scenario: New route without a frame
- **WHEN** a row is added to the route map and no frame is added to the design file
- **THEN** the check fails and names the route

#### Scenario: Design file drift
- **WHEN** a token value is changed in the token source and `docs/design/jagentchill-ui.html` is not regenerated
- **THEN** the check fails and names the token whose value differs

#### Scenario: Minimum-window frame
- **WHEN** the frame `shell.sidebar@desktop-min/light` is measured
- **THEN** the secondary list is at least 240 px tall with the seven primary rows, the More row and the footer visible

#### Scenario: Both themes pass contrast
- **WHEN** the check measures the frames `home.default@desktop/dark` and `editor.timeline.states@desktop/light`
- **THEN** every text and control pair meets the thresholds of the contrast matrix

### Requirement: Colour tokens
The system SHALL define exactly the following semantic colour tokens with these values. The values keep the reference visual language (white and near-black surfaces, one blue accent, hairline separation) and are fixed so that every pairing listed in `design-system.Contrast pair matrix` meets WCAG 2.2 AA.

| Token | Light | Dark |
|---|---|---|
| `bg/app` | #FFFFFF | #1B1B1B |
| `bg/sidebar` | #F7F7F7 | #141414 |
| `bg/subtle` (selected row, chip, secondary button) | #EFEFEF | #2A2A2A |
| `bg/hover` | #F3F3F3 | #232323 |
| `bg/elevated` (popover, modal, sheet, card on sidebar) | #FFFFFF | #242424 |
| `bg/inset` (read-only field fill, code, editor gutter) | #FAFAFA | #161616 |
| `bg/canvas` (area around the preview frame) | #EDEDED | #0F0F0F |
| `bg/scrim` | rgba(0,0,0,0.40) | rgba(0,0,0,0.60) |
| `border/hairline` (separators and card outlines; never the only boundary of a control) | #E8E8E8 | #2E2E2E |
| `border/strong` (emphasised separator, locked-track hatch) | #D4D4D4 | #3D3D3D |
| `border/control` (boundary of inputs, selects, checkboxes, radios, the switch-off track, the slider track, outline buttons) | #808080 | #808080 |
| `text/primary` | #1A1A1A | #EDEDED |
| `text/secondary` | #6B6B6B | #9A9A9A |
| `text/placeholder` (placeholder text of fields) | #6F6F6F | #909090 |
| `text/tertiary` (disabled text and purely decorative glyphs only) | #A3A3A3 | #6A6A6A |
| `text/on-accent` (label and glyph on an `accent` fill) | #FFFFFF | #0B1B3A |
| `text/on-danger` (label on a `danger` fill) | #FFFFFF | #3A0D09 |
| `text/on-strong` | #FFFFFF | #1A1A1A |
| `accent` (primary button fill, switch on, checked fill, unread dot, focus ring, progress fill, icons) | #2F6FEB | #4C8DFF |
| `accent/hover` | #2560D4 | #6A9FFF |
| `accent/pressed` | #1E52B8 | #86B1FF |
| `accent/text` (links, token-chip text, selected-chip text, info status text) | #245FD6 | #8FB6FF |
| `accent/subtle` (token chip fill, selected card tint) | #E8F0FE | #1C2B4A |
| `strong` (send, create, primary-strong button fill; tooltip and toast fill) | #1A1A1A | #EDEDED |
| `strong/hover` | #333333 | #FFFFFF |
| `success` (icon, dot, fill) | #1B914D | #3DBE7A |
| `success/text` | #15733F | #3DBE7A |
| `success/subtle` | #E6F6EA | #173524 |
| `danger` (destructive button fill, invalid border, icon, dot) | #D93025 | #F26D63 |
| `danger/hover` | #B8261D | #F58A82 |
| `danger/text` (error messages, destructive menu items, failed status text) | #B8261D | #F58A82 |
| `danger/subtle` | #FDECEC | #3A1D1D |
| `warning` (fill of bars and of dots that sit next to a label) | #E8890C | #F0A23B |
| `warning/icon` (a warning icon or marker that stands alone) | #B06500 | #F0A23B |
| `warning/text` | #8F5300 | #F0A23B |
| `warning/subtle` | #FDF3E3 | #3A2A12 |
| `purple` (completed/merged state icon, dot, fill) | #7C4DDB | #A98BEF |
| `purple/text` | #5B34B0 | #A98BEF |
| `purple/subtle` | #F1EBFC | #2A2140 |
| `control/thumb` (switch and slider thumb) | #FFFFFF | #FFFFFF |
| `avatar/text` (initials and persona glyph on an avatar fill) | #FFFFFF | #FFFFFF |
| `avatar/bg/1` | #2D6DEB | #2D6DEB |
| `avatar/bg/2` | #0D818D | #0D818D |
| `avatar/bg/3` | #B65B0B | #B65B0B |
| `avatar/bg/4` | #7C4DDB | #7C4DDB |
| `avatar/bg/5` | #1A8648 | #1A8648 |
| `avatar/bg/6` | #C2447A | #C2447A |
| `avatar/bg/7` | #A85F00 | #A85F00 |
| `avatar/bg/8` | #5F6B7A | #5F6B7A |
| `diff/added` (added line background) | #E6F6EA | #173524 |
| `diff/removed` (removed line background) | #FDECEC | #3A1D1D |
| `diff/added-strong` (changed characters inside an added line) | #BDE9C9 | #1F5A38 |
| `diff/removed-strong` (changed characters inside a removed line) | #F8C9C5 | #6A2A28 |
| `diff/gutter-added` (the "+" mark and gutter bar) | #15733F | #3DBE7A |
| `diff/gutter-removed` (the "−" mark and gutter bar) | #B8261D | #F26D63 |

Usage rules, binding on every component and every capability:
1. **Text never uses a fill token.** Link text, token-chip text, selected-chip text and info status text use `accent/text`; status text uses `success/text`, `warning/text`, `danger/text` and `purple/text`; `accent`, `success`, `danger`, `warning` and `purple` colour fills, borders, dots and icons only.
2. A label on an `accent` fill uses `text/on-accent`, on a `danger` fill `text/on-danger`, on a `strong` fill `text/on-strong`. No component states white or black literally.
3. `text/tertiary` is used only for the text of a disabled control and for decorative glyphs; it MUST NOT carry information (shortcut hints, counts, timestamps and placeholders use `text/secondary` or `text/placeholder`).
4. The visible boundary of an input, select, checkbox, radio, switch-off track, slider track and outline button is `border/control`. `border/hairline` and `border/strong` separate regions and are never the only thing that makes a control perceivable.
5. A warning icon that stands alone uses `warning/icon`; `warning` is used for the callout bar, for fills and for a dot that sits next to a text label.
6. Diff surfaces (file diffs, script version diffs, proposal diffs) use only the six `diff/*` tokens with `text/primary` text and always pair them with "+" and "−" gutter marks.
7. An avatar's fill is one of `avatar/bg/1` … `avatar/bg/8`, the same in both themes, with `avatar/text` initials. [NEW]

#### Scenario: Token values match in both themes
- **WHEN** the token snapshot test runs
- **THEN** every token in the table resolves to the listed light value under `light` and the listed dark value under `dark`
- **AND** no token is missing in either theme

#### Scenario: Status text uses the text-grade token
- **WHEN** a sidebar row renders the meta line "Export ready" in the light theme
- **THEN** its colour is `success/text` #15733F

#### Scenario: Primary button label in the dark theme
- **WHEN** a `primary` button renders in the dark theme
- **THEN** its fill is #4C8DFF and its label is `text/on-accent` #0B1B3A, a contrast ratio of 5.33:1

#### Scenario: Fill token used for text is rejected
- **WHEN** a component style sets a text colour to `accent`, `success`, `warning`, `danger` or `purple`
- **THEN** the lint gate fails and names the `/text` token to use

### Requirement: Editor colour tokens
The system SHALL define these editor-specific tokens, used by timeline, preview and inspector components. They are the only source of clip, timeline, marker, waveform and preview-placeholder colours; `timeline-editing`, `mobile-editor`, `audio-editing`, `preview-canvas` and `render-engine` name these tokens and state no hex value. Clip fills have one value for both themes: each gives `clip/label` at least 4.5:1 directly on the fill and at least 3:1 against the lane background of either theme.

| Token | Light | Dark |
|---|---|---|
| `clip/video` (video on the main track) | #2D6CEA | #2D6CEA |
| `clip/overlay` (video and image on overlay tracks) | #5566E8 | #5566E8 |
| `clip/image` | #8B53D9 | #8B53D9 |
| `clip/audio` | #258154 | #258154 |
| `clip/text` | #AD5F1A | #AD5F1A |
| `clip/sticker` (sticker and graphic/shape elements) | #CF346E | #CF346E |
| `clip/effect` | #B741B7 | #B741B7 |
| `clip/filter` (an `effect` element whose single entry is `kind: "filter"`) | #2F7D8A | #2F7D8A |
| `clip/adjustment` | #6B7280 | #6B7280 |
| `clip/caption` | #906D15 | #906D15 |
| `clip/compound` | #207F7F | #207F7F |
| `clip/label` (text, badges and keyframe outline on any clip fill) | #FFFFFF | #FFFFFF |
| `clip/label-scrim` (pill behind a clip label wherever the label lies over a filmstrip or waveform) | rgba(0,0,0,0.60) | rgba(0,0,0,0.60) |
| `bg/editor` (editor surface: the player stage on every platform, and the preview and timeline regions of the mobile editor, which are dark in both themes) | #161616 | #161616 |
| `timeline/track-bg` | #F7F7F7 | #202020 |
| `timeline/track-bg-alt` | #F1F1F1 | #1D1D1D |
| `timeline/ruler-text` | #6B6B6B | #9A9A9A |
| `timeline/playhead` | #1A1A1A | #FFFFFF |
| `timeline/selection` (selected clip outline, trim handles) | #1A1A1A | #FFFFFF |
| `timeline/snap` | #B06500 | #F0A23B |
| `timeline/range` (in/out range tint) | rgba(47,111,235,0.16) | rgba(76,141,255,0.22) |
| `keyframe/fill` | #2F6FEB | #4C8DFF |
| `preview/handle-fill` | #FFFFFF | #FFFFFF |
| `preview/handle-border` (1 px border of a preview handle) | #2F6FEB | #4C8DFF |
| `preview/guide` | #E8890C | #F0A23B |
| `waveform/fill` | rgba(255,255,255,0.85) | rgba(255,255,255,0.85) |
| `waveform/clip` (peaks above 0 dBFS, drawn as the tips of the waveform) | #B8261D | #B8261D |
| `waveform/beat` (beat-marker dots along the bottom of a waveform, `audio-editing.Beat markers on audio`) | #FFD60A | #FFD60A |
| `preview/offline-fill` (fill of the "Media offline" / "Unsupported format" tile, passed to the engine at `engine.init`) | #2A2A2A | #2A2A2A |
| `preview/offline-hatch` (2 px diagonal hatch of that tile) | #4A4A4A | #4A4A4A |
| `marker/1` (default marker colour) | #009DFF | #009DFF |
| `marker/2` | #34C759 | #34C759 |
| `marker/3` | #FFCC00 | #FFCC00 |
| `marker/4` | #FF9500 | #FF9500 |
| `marker/5` | #FF3B30 | #FF3B30 |
| `marker/6` | #AF52DE | #AF52DE |
| `marker/7` | #FF2D92 | #FF2D92 |
| `marker/8` | #8E8E93 | #8E8E93 |

The marker palette is exactly `marker/1` … `marker/8` in that order (the order "next colour" cycles through); the localised colour names are Blue, Green, Yellow, Orange, Red, Purple, Pink and Grey, and a marker stores the palette index, not a hex value. Marker colours are category colours chosen by the user: a marker flag always carries a 1 px `timeline/selection` outline so that its shape reaches 3:1 against the lane whatever its fill, and its accessible name includes the colour name. Opacity rules: a hidden (deactivated) clip renders its whole body at 50% opacity with its label and an "eye-off" badge at full opacity over `clip/label-scrim`; a muted clip keeps its fill and renders its waveform at 35% opacity with a "muted" badge at full opacity; a locked track renders a diagonal 45° hatch of `border/strong` at 8 px pitch over its lane together with the lock icon in its header; a lane or clip that would accept the current drag is outlined with 2 px `timeline/selection` (the drop highlight). With the preference "Timeline clip colours: By track" the same tokens are assigned by track index instead of clip type (cycling video, image, audio, text, sticker, effect, filter, caption). [NEW]

#### Scenario: Clip type decides the fill
- **WHEN** the timeline renders a main-track video clip, an audio clip and a caption clip in either theme
- **THEN** their fills are #2D6CEA, #258154 and #906D15 respectively and each label is `clip/label` #FFFFFF at a contrast of at least 4.7:1

#### Scenario: Label over a filmstrip
- **WHEN** a video clip shows a filmstrip whose first thumbnail is pure white
- **THEN** the label is drawn on a `clip/label-scrim` pill and reaches 5.74:1 against the composited pill

#### Scenario: Overlay clip colour
- **WHEN** a video clip sits on an overlay track in the light theme
- **THEN** its fill is `clip/overlay` #5566E8

#### Scenario: Muted and hidden are different
- **WHEN** one audio clip is muted and another clip is hidden
- **THEN** the muted clip's fill is at full opacity with its waveform at 35% and a "muted" badge, and the hidden clip's body is at 50% with an "eye-off" badge at full opacity

#### Scenario: Marker palette
- **WHEN** the user adds three markers with "next colour" starting from the default
- **THEN** their colours are `marker/1`, `marker/2` and `marker/3` in both themes, each flag outlined in `timeline/selection`

### Requirement: Contrast pair matrix
The token values of this capability SHALL satisfy WCAG 2.2 AA for every pairing a component is permitted to draw: at least 4.5:1 for text and at least 3:1 for control boundaries, state indicators, focus indicators and meaningful graphics, in the light and the dark theme. The permitted pairings are exactly the families below; a component MUST NOT draw a foreground token on a background token outside a listed family. The ratios shown are the lowest of each family, computed with the WCAG relative-luminance formula from the hex values of the token tables (alpha tokens composited first), and are the expected output of the contrast test.

| Family | Foreground tokens | Background tokens | Minimum | Lowest ratio, light | Lowest ratio, dark |
|---|---|---|---|---|---|
| Body text | `text/primary`, `text/secondary` | `bg/app`, `bg/sidebar`, `bg/subtle`, `bg/hover`, `bg/elevated`, `bg/inset`, `bg/canvas` | 4.5:1 | 4.55 (`text/secondary` on `bg/canvas`) | 5.10 (`text/secondary` on `bg/subtle`) |
| Link, token-chip and selected-chip text | `accent/text` | the seven surfaces and `accent/subtle` | 4.5:1 | 4.87 (on `bg/canvas`) | 6.90 (on `accent/subtle`) |
| Status text | `success/text`, `warning/text`, `danger/text`, `purple/text` | the seven surfaces and the tone's own `/subtle` fill | 4.5:1 | 5.04 (`success/text` on `bg/canvas`) | 5.21 (`purple/text` on `bg/subtle`) |
| Neutral text on tinted fills (pills, callouts) | `text/primary`, `text/secondary` | `accent/subtle`, `success/subtle`, `warning/subtle`, `danger/subtle`, `purple/subtle` | 4.5:1 | 4.58 (`text/secondary` on `purple/subtle`) | 4.75 (`text/secondary` on `success/subtle`) |
| Placeholder text | `text/placeholder` | `bg/app`, `bg/elevated`, `bg/inset`, `bg/sidebar` | 4.5:1 | 4.69 (on `bg/sidebar`) | 4.86 (on `bg/elevated`) |
| Primary button label | `text/on-accent` | `accent`, `accent/hover`, `accent/pressed` | 4.5:1 | 4.57 (on `accent`) | 5.33 (on `accent`) |
| Destructive button label | `text/on-danger` | `danger`, `danger/hover` | 4.5:1 | 4.77 (on `danger`) | 5.75 (on `danger`) |
| Strong button, tooltip and toast text and icons | `text/on-strong` | `strong`, `strong/hover` | 4.5:1 | 12.63 (on `strong/hover`) | 14.87 (on `strong`) |
| Control boundary | `border/control` | the seven surfaces | 3:1 | 3.37 (on `bg/canvas`) | 3.63 (on `bg/subtle`) |
| Switch and slider thumb | `control/thumb` | `border/control`, `accent` | 3:1 | 3.95 (on `border/control`) | 3.20 (on `accent`) |
| Focus ring, switch-on track, checked fill, unread dot, progress fill, selected-card border | `accent` | the seven surfaces | 3:1 | 3.90 (on `bg/canvas`) | 4.48 (on `bg/subtle`) |
| Accent icon on its tint | `accent` | `accent/subtle` | 3:1 | 3.99 | 4.39 |
| Meaningful status icon | `success`, `warning/icon`, `danger`, `purple` | the seven surfaces | 3:1 | 3.45 (`success` on `bg/canvas`) | 4.88 (`danger` on `bg/subtle`) |
| Invalid field border | `danger` | `bg/app`, `bg/elevated`, `bg/inset` | 3:1 | 4.57 (on `bg/inset`) | 5.28 (on `bg/elevated`) |
| Diff text | `text/primary` | `diff/added`, `diff/removed`, `diff/added-strong`, `diff/removed-strong` | 4.5:1 | 11.73 (on `diff/removed-strong`) | 6.96 (on `diff/added-strong`) |
| Diff gutter mark | `diff/gutter-added` on `diff/added`; `diff/gutter-removed` on `diff/removed` | — | 4.5:1 | 5.27 (added) | 5.20 (removed) |
| Clip label on clip fill | `clip/label` | the eleven `clip/*` fills | 4.5:1 | 4.72 (on `clip/video` and `clip/effect`) | 4.72 (same values in both themes) |
| Clip label on the scrim | `clip/label` | `clip/label-scrim` composited over a pure-white frame (worst case) | 4.5:1 | 5.74 | 5.74 |
| Clip fill against the lane | the eleven `clip/*` fills | `timeline/track-bg`, `timeline/track-bg-alt` | 3:1 | 4.17 (`clip/effect` on `timeline/track-bg-alt`) | 3.36 (`clip/image` on `timeline/track-bg`) |
| Keyframe outline and clip badges on clip fill | `clip/label` | the eleven `clip/*` fills | 3:1 | 4.72 | 4.72 |
| Waveform on clip fill | `waveform/fill` (composited) | `clip/audio`, `clip/video` | 3:1 | 3.87 (on `clip/video`) | 3.87 |
| Clipping tip on the waveform | `waveform/clip` | `waveform/fill` composited over `clip/audio`, `clip/video` | 3:1 | 5.16 | 5.16 |
| Beat marker on an audio-bearing clip | `waveform/beat` | `clip/audio`, `clip/video` | 3:1 | 3.35 (on `clip/video`) | 3.35 |
| Ruler text | `timeline/ruler-text` | `timeline/track-bg`, `timeline/track-bg-alt` | 4.5:1 | 4.72 (on `timeline/track-bg-alt`) | 5.79 (on `timeline/track-bg`) |
| Playhead, selection outline, marker outline, snap line | `timeline/playhead`, `timeline/selection`, `timeline/snap` | `timeline/track-bg`, `timeline/track-bg-alt` | 3:1 | 3.95 (`timeline/snap` on `timeline/track-bg-alt`) | 7.71 (`timeline/snap` on `timeline/track-bg`) |
| Preview handle and guide on the stage | `preview/handle-fill`, `preview/guide` | `bg/editor` | 3:1 | 6.91 (`preview/guide`) | 8.56 (`preview/guide`) |
| Preview handle border on its fill | `preview/handle-border` | `preview/handle-fill` | 3:1 | 4.57 | 3.20 |
| Avatar initials | `avatar/text` | `avatar/bg/1` … `avatar/bg/8` | 4.5:1 | 4.62 (on `avatar/bg/2` and `avatar/bg/5`) | 4.62 |
| Chart series | `chart/1` … `chart/8` | `bg/app`, `bg/elevated`, `bg/sidebar` | 3:1 | 3.26 (`chart/5` on `bg/sidebar`) | 4.85 (`chart/1` on `bg/elevated`) |
| Chart axis text | `chart/axis-text` | `bg/app`, `bg/elevated`, `bg/sidebar` | 4.5:1 | 4.97 (on `bg/sidebar`) | 5.52 (on `bg/elevated`) |

Further families are tested by the requirements that own their tokens with the same thresholds: `wf/*` colours against `wf/node-bg` and `wf/canvas-bg` (`design-system.Workflow canvas tokens`) and the ANSI colours against `terminal/bg` (`design-system.Terminal tokens`). Exempt from the thresholds, as WCAG allows, and never used to carry information on their own: `text/tertiary` on any surface (disabled text and decoration), any control in the `disabled` state, `border/hairline` and `border/strong` separators, the `bg/hover` and `bg/subtle` state fills (hover is not a required indicator; the selected state additionally changes weight, icon colour or outline as each component states), marker fills (user-chosen category colours, always outlined) and user-chosen content colours.

The contrast test (`pnpm jagentchill:check:contrast`, part of `diagnostics-quality.Verify gate`) computes every pair of this matrix from the generated token export in both themes, fails naming the pair, the theme and the ratio when one is below its minimum, and fails when a component style draws a foreground/background token combination that is in no family. With the preference "Increase contrast" on (`i18n-accessibility.Accessibility preferences and conformance target`) `border/hairline` resolves to `border/control`, `text/secondary` and `text/placeholder` resolve to `text/primary`, and the test is run again for that mapping. [NEW]

#### Scenario: Every pair passes in both themes
- **WHEN** the contrast test runs on the token export
- **THEN** all pairs of the matrix reach their minimum in `light` and in `dark`, with the lowest text pair at 4.55:1 and the lowest non-text pair at 3.20:1

#### Scenario: A regression is caught
- **WHEN** a change sets dark `text/on-accent` to #FFFFFF
- **THEN** the test fails naming `text/on-accent` on `accent`, the dark theme and the ratio 3.20:1 against the 4.5:1 minimum

#### Scenario: Pair outside the matrix
- **WHEN** a component style draws `warning` text on `bg/app`
- **THEN** the test fails because that foreground/background combination belongs to no family

#### Scenario: Input boundary
- **WHEN** an empty input renders on `bg/subtle` in the dark theme
- **THEN** its boundary is `border/control` #808080 on #2A2A2A, a ratio of 3.63:1

### Requirement: Workflow canvas tokens
The system SHALL register the following `wf/*` tokens, used only by the workflow canvas of `workflow-diagram` (which owns the canvas, node anatomy, edges and animations and defines no token value of its own). `wf/type/*` colour the node-type accent of `workflow-diagram.Node type visual identities`, `wf/port/*` colour ports and typed edges by data family, and `wf/group/1` … `wf/group/8` are the eight group and sticky-note colours a user can pick.

| Token | Light | Dark | Use |
|---|---|---|---|
| `wf/canvas-bg` | #FAFAFA | #161616 | canvas background (same values as `bg/inset`) |
| `wf/grid-minor` | #E2E2E2 | #262626 | minor grid dots or lines |
| `wf/grid-major` | #CFCFCF | #333333 | major grid dots or lines |
| `wf/node-bg` | #FFFFFF | #242424 | node surface (same values as `bg/elevated`) |
| `wf/edge-idle` | #8A8A8A | #7A7A7A | edge with no type colour or run state |
| `wf/type/agent` | #7C4DDB | #A98BEF | agent, team |
| `wf/type/generate` | #C2447A | #EE7FAE | generate |
| `wf/type/script` | #C2610C | #F08A4B | script |
| `wf/type/editor` | #4F5BD5 | #8B95F5 | editor |
| `wf/type/tool` | #5F6B7A | #9AA5B4 | tool, subworkflow |
| `wf/type/gate` | #A85F00 | #F0A23B | approval, human input |
| `wf/type/flow` | #0E8C99 | #35C2CF | branch, loop, parallel, join, wait |
| `wf/type/trigger` | #1F9D55 | #3DBE7A | trigger |
| `wf/type/output` | #2A7FB8 | #5FB0E6 | export, notify |
| `wf/type/unknown` | #6B6B6B | #9A9A9A | unlisted node type |
| `wf/type/sub` | #5E7F12 | #A3C94A | sub-workflow step |
| `wf/type/wait` | #8A6A4F | #C9A88A | wait step |
| `wf/port/text` | #C2610C | #F08A4B | text ports |
| `wf/port/json` | #5F6B7A | #9AA5B4 | structured-data ports |
| `wf/port/image` | #8E5BD8 | #B79AF0 | image ports |
| `wf/port/video` | #4F5BD5 | #8B95F5 | video ports |
| `wf/port/audio` | #1F9D55 | #3DBE7A | audio ports |
| `wf/port/project` | #C2447A | #EE7FAE | editor-project ports |
| `wf/port/file` | #2A7FB8 | #5FB0E6 | file ports |
| `wf/port/scalar` | #0E8C99 | #35C2CF | number and boolean ports |
| `wf/port/control` | #1A1A1A | #EDEDED | control-flow ports |
| `wf/port/any` | #8A8A8A | #7A7A7A | untyped ports |
| `wf/group/1` | #6B7280 | #9AA5B4 | group colour 1 (default) |
| `wf/group/2` | #2F6FEB | #4C8DFF | group colour 2 |
| `wf/group/3` | #0E8C99 | #35C2CF | group colour 3 |
| `wf/group/4` | #1F9D55 | #3DBE7A | group colour 4 |
| `wf/group/5` | #A85F00 | #F0A23B | group colour 5 |
| `wf/group/6` | #C2610C | #F08A4B | group colour 6 |
| `wf/group/7` | #C2447A | #EE7FAE | group colour 7 |
| `wf/group/8` | #7C4DDB | #A98BEF | group colour 8 |
| `wf/motion/layout` | 320 ms | 320 ms | auto-layout and tidy transitions |
| `wf/motion/camera` | 400 ms | 400 ms | camera follow moves |
| `wf/motion/pulse` | 1,600 ms | 1,600 ms | running-node pulse period |
| `wf/ease/in-out` | cubic-bezier(0.4, 0, 0.2, 1) | same | camera moves and pulses |

Node run-status colours are not `wf/*` tokens: the canvas uses the status tones of `design-system.Avatar, badge and status pill` (`accent`, `success`, `warning`, `danger`, `purple` and their `/subtle` and `/text` variants). The three `wf/motion/*` durations and the one easing are the only canvas-specific motion values; all other canvas motion uses `design-system.Motion tokens`. A token contrast test MUST verify, in both themes, that every `wf/type/*`, `wf/port/*` and `wf/group/*` colour and `wf/edge-idle` has a contrast ratio of at least 3:1 against `wf/node-bg` and against `wf/canvas-bg`. Under reduced motion `wf/motion/layout` and `wf/motion/camera` resolve to 0 ms and the pulse is replaced by a static ring. [NEW]

#### Scenario: Token values match in both themes
- **WHEN** the token snapshot test runs
- **THEN** every `wf/*` token resolves to the listed light value under `light` and the listed dark value under `dark`

#### Scenario: Contrast of canvas colours
- **WHEN** the token contrast test runs
- **THEN** each `wf/type/*`, `wf/port/*`, `wf/group/*` colour and `wf/edge-idle` reaches at least 3:1 against `wf/node-bg` and against `wf/canvas-bg` in both themes, or the test fails naming the pair

#### Scenario: Reduced motion
- **WHEN** reduce motion is on and auto-layout runs
- **THEN** nodes take their new positions with no transition

### Requirement: Terminal tokens
The system SHALL register these `terminal/*` tokens — default foreground and background, cursor, selection and the 16 ANSI colours — used by the terminal surfaces of `workspaces-terminal` on every platform. Terminal text uses `type/mono`.

| Token | Light | Dark |
|---|---|---|
| `terminal/bg` | #FFFFFF | #161616 |
| `terminal/fg` | #1A1A1A | #EDEDED |
| `terminal/cursor` | #1A1A1A | #EDEDED |
| `terminal/cursor-text` | #FFFFFF | #161616 |
| `terminal/selection` | rgba(47,111,235,0.25) | rgba(76,141,255,0.35) |
| `terminal/ansi/black` | #1A1A1A | #2E2E2E |
| `terminal/ansi/red` | #B8261D | #F26D63 |
| `terminal/ansi/green` | #116A39 | #3DBE7A |
| `terminal/ansi/yellow` | #8F5300 | #F0A23B |
| `terminal/ansi/blue` | #1E52B8 | #4C8DFF |
| `terminal/ansi/magenta` | #8E35A8 | #C792EA |
| `terminal/ansi/cyan` | #0B6E7A | #35C2CF |
| `terminal/ansi/white` | #6B6B6B | #C8C8C8 |
| `terminal/ansi/bright-black` | #5A5A5A | #8A8A8A |
| `terminal/ansi/bright-red` | #D0271C | #F58A82 |
| `terminal/ansi/bright-green` | #177A43 | #6BD69B |
| `terminal/ansi/bright-yellow` | #A05A00 | #F5BC6A |
| `terminal/ansi/bright-blue` | #2560D4 | #6A9FFF |
| `terminal/ansi/bright-magenta` | #A445C0 | #D9B0F2 |
| `terminal/ansi/bright-cyan` | #0B7785 | #6FD8E2 |
| `terminal/ansi/bright-white` | #3D3D3D | #FFFFFF |

In the light theme `terminal/ansi/white` and `terminal/ansi/bright-white` are dark greys so that "white" text stays readable on the white background. Every ANSI token except `terminal/ansi/black` in the dark theme SHALL reach a contrast ratio of at least 4.5:1 against `terminal/bg` in its theme; run-time contrast adjustment for program-chosen pairs is owned by `workspaces-terminal.Terminal accessibility`. [NEW]

#### Scenario: Terminal follows the theme
- **WHEN** the theme changes from dark to light while a terminal is open
- **THEN** the terminal background becomes #FFFFFF, default text #1A1A1A and the 16 ANSI colours take their light values within 200 ms, without restarting the terminal session

#### Scenario: ANSI contrast gate
- **WHEN** the token contrast test runs
- **THEN** every ANSI token except dark `terminal/ansi/black` reaches 4.5:1 against `terminal/bg` in both themes, or the test fails naming the token

### Requirement: Data-visualisation tokens
The system SHALL register eight categorical chart colours `chart/1` … `chart/8`, used in that order for series in every chart (usage charts, board charts, share bars), plus `chart/grid` and `chart/axis-text`.

| Token | Light | Dark |
|---|---|---|
| `chart/1` | #2F6FEB | #4C8DFF |
| `chart/2` | #0E8C99 | #35C2CF |
| `chart/3` | #C2610C | #F08A4B |
| `chart/4` | #7C4DDB | #A98BEF |
| `chart/5` | #1F9D55 | #3DBE7A |
| `chart/6` | #C2447A | #EE7FAE |
| `chart/7` | #A85F00 | #F0A23B |
| `chart/8` | #5F6B7A | #9AA5B4 |
| `chart/grid` | #E8E8E8 | #2E2E2E |
| `chart/axis-text` | #6B6B6B | #9A9A9A |

The package provides four chart primitives built on these tokens. Three are full charts — vertical bar (plain and stacked), horizontal bar, and line — each with a legend, axis labels in `type/caption`, a hover and keyboard-focus tooltip listing every series value at that position, and a "View as table" control exposing the same data. The fourth is the **Sparkline**: a single-series line or bar strip 16–32 px tall and 48–160 px wide with no axes, legend or tooltip, drawn in `chart/1` (or the status tone's fill token the caller names) with a 1.5 px stroke; it is never the only carrier of its data — the caller supplies an accessible summary string (for example "Runs per day, last 14 days: lowest 0, highest 9, latest 4") exposed as the image's accessible name, and the adjacent text shows the latest value. Every `chart/*` colour reaches at least 3:1 against `bg/app`, `bg/elevated` and `bg/sidebar` in its theme (`design-system.Contrast pair matrix`). A chart with more than eight series groups the smallest into "Other" (`chart/8`). Series are distinguished by a direct label or pattern in addition to colour, per `i18n-accessibility.Colour independence`. An empty chart shows the caller's empty message centred in the plot area and no axes. [NEW]

#### Scenario: Series order
- **WHEN** a stacked bar chart has the series Agent and Generation
- **THEN** Agent uses `chart/1` and Generation uses `chart/2` in both themes

#### Scenario: More than eight series
- **WHEN** a chart receives eleven series
- **THEN** seven are drawn individually and the four smallest are summed as "Other" in `chart/8`

#### Scenario: Table alternative
- **WHEN** the user activates "View as table" on a chart
- **THEN** a table with one row per data point and one column per series shows the same values

#### Scenario: Sparkline has a text equivalent
- **WHEN** a screen reader focuses an automation row whose run history is drawn as a Sparkline
- **THEN** it reads the summary string supplied by the caller, and the row shows the latest value as text next to the Sparkline

### Requirement: Typography tokens
The UI typeface SHALL be Inter (bundled, SIL OFL) with fallback `system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif`; Japanese text uses `"Noto Sans JP", "Hiragino Sans", "Yu Gothic UI"` ahead of the generic fallbacks. Because no Japanese face is guaranteed on Linux or in every browser, a Noto Sans JP subset (the JIS X 0208 repertoire, weights 400 and 600, SIL OFL, listed in `THIRD_PARTY_NOTICES.md`) SHALL be bundled in the Linux desktop packages and in the web build; it is loaded only when the UI language is `ja` or a rendered string contains kana or Han characters, and weight 500 text falls back to 600 in that face. macOS, Windows, iOS and Android use their system Japanese face. The monospace typeface is JetBrains Mono (bundled, SIL OFL) with fallback `ui-monospace, Menlo, Consolas, monospace`. Weights in use are 400, 500 and 600 only. The scale is:

| Token | Regular density (px size / line-height / weight) | Compact-touch density (see `design-system.Control size tokens and density rules`) |
|---|---|---|
| `type/caption` (badges, ruler, kbd) | 11 / 16 / 500 | 12 / 16 / 500 |
| `type/meta` | 12 / 16 / 400 | 13 / 18 / 400 |
| `type/body` | 13 / 19 / 400 | 15 / 22 / 400 |
| `type/body-medium` (labels, row titles) | 13 / 19 / 500 | 15 / 22 / 500 |
| `type/title-sm` (modal title, card title) | 14 / 20 / 600 | 16 / 22 / 600 |
| `type/title-md` (section heading) | 16 / 22 / 600 | 18 / 24 / 600 |
| `type/h1` (page heading) | 20 / 28 / 600 | 22 / 28 / 600 |
| `type/display` (home heading) | 28 / 34 / 600 | 28 / 34 / 600 |
| `type/mono` (ids, paths, code, timecode) | 12 / 18 / 400 | 13 / 20 / 400 |

Letter spacing is 0 for all tokens. Timecodes and numeric table cells use tabular figures. Hierarchy is expressed with weight and colour before size. [NEW] [JAD]

#### Scenario: Body text metrics on desktop
- **WHEN** a paragraph renders with `type/body` at a viewport 1280 px wide
- **THEN** its computed font size is 13 px, line height 19 px and weight 400

#### Scenario: Compact-touch density on a phone
- **WHEN** the same paragraph renders at a viewport 390 px wide
- **THEN** its computed font size is 15 px and line height 22 px

#### Scenario: Compact-touch density on a tablet
- **WHEN** the same paragraph renders on a tablet 1,024 px wide whose primary pointer is coarse
- **THEN** its computed font size is 15 px and line height 22 px although the form factor is wide

#### Scenario: Japanese text on Linux
- **WHEN** the UI language is `ja` on a Linux desktop with no Japanese system font installed
- **THEN** kana and Han characters render in the bundled Noto Sans JP subset with Japanese glyph forms and no missing-glyph boxes

#### Scenario: Timecode does not jitter
- **WHEN** a timecode advances from 00:00:01:11 to 00:00:01:12
- **THEN** the rendered text width is unchanged because tabular figures are used

### Requirement: Spacing, radius and border tokens
Spacing SHALL use a 4 px grid with the tokens `space/0`=0, `space/0.5`=2, `space/1`=4, `space/1.5`=6, `space/2`=8, `space/3`=12, `space/4`=16, `space/5`=20, `space/6`=24, `space/8`=32, `space/10`=40, `space/12`=48, `space/16`=64. Radius tokens are `radius/none`=0, `radius/xs`=4 (timeline clips, inner chips, checkbox), `radius/sm`=6 (rows, buttons, inputs), `radius/md`=8 (cards, popovers, tooltips, toasts on desktop), `radius/lg`=12 (composer, modals), `radius/xl`=16 (bottom-sheet top corners), `radius/full`=9999 (pills, avatars of people, switches). Border widths are 1 px (hairline) and 2 px (focus ring, selected card). Card row padding is 12 px horizontal by 10 px vertical. [NEW]

#### Scenario: Card and composer radii
- **WHEN** a grouped setting card and the home composer render
- **THEN** the card has an 8 px corner radius and the composer a 12 px corner radius, each with a 1 px `border/hairline` border

#### Scenario: Off-grid spacing is rejected
- **WHEN** a style uses a margin or padding value that is not one of the spacing tokens
- **THEN** the lint gate fails

### Requirement: Elevation tokens
Surfaces SHALL be separated by hairline borders first; shadows are applied only to the composer, popovers, dropdowns, tooltips, modals, sheets and toasts. Tokens: `elevation/0` = none; `elevation/1` (composer, floating cards) = `0 1px 2px rgba(0,0,0,0.04), 0 2px 8px rgba(0,0,0,0.06)`; `elevation/2` (popover, dropdown, tooltip, toast) = `0 4px 16px rgba(0,0,0,0.12)`; `elevation/3` (modal, side sheet, bottom sheet) = `0 12px 40px rgba(0,0,0,0.20)`. In the dark theme the same offsets use alpha 0.40, 0.50 and 0.60 respectively and every elevated surface additionally carries a 1 px `border/hairline` border. Stacking order tokens: `z/base`=0, `z/sticky`=100, `z/drawer`=200, `z/popover`=300, `z/modal`=400, `z/toast`=500, `z/tooltip`=600. [NEW]

#### Scenario: Cards do not cast shadows
- **WHEN** a grouped setting card renders on `bg/app`
- **THEN** it has a 1 px border and no shadow

#### Scenario: Toast above modal
- **WHEN** a toast is shown while a modal is open
- **THEN** the toast renders above the modal and its scrim

### Requirement: Motion tokens
Motion SHALL use `motion/fast` = 120 ms (hover, press, fade of tooltips and menus), `motion/base` = 160 ms (popover, modal, toast enter, tab indicator), `motion/slow` = 240 ms (drawer, side sheet, bottom sheet, panel collapse). Enter easing is `cubic-bezier(0.2, 0, 0, 1)`; exit easing is `cubic-bezier(0.4, 0, 1, 1)` and exit duration is 120 ms for every overlay. Translations are at most 8 px for popovers and modals; drawers and sheets translate their full size. No spring overshoot or bounce is used. When the OS "reduce motion" setting or the app preference "Reduce motion" is on, all translations and scales are removed and only opacity changes of at most 120 ms remain. [NEW]

#### Scenario: Popover enter
- **WHEN** a dropdown opens
- **THEN** it fades from opacity 0 to 1 and translates 4 px toward its final position in 160 ms with the enter easing

#### Scenario: Reduced motion
- **WHEN** reduce motion is on and a bottom sheet opens
- **THEN** the sheet appears with an opacity fade of at most 120 ms and no slide

### Requirement: Icon tokens
Icons SHALL come from one outline icon set (lucide, ISC licence) drawn with a 1.5 px stroke at every size, plus project-owned icons for editor tools that the set lacks, drawn on the same 24 px grid with the same stroke. Sizes: `icon/xs`=12, `icon/sm`=14 (sidebar nav, inline meta), `icon/md`=16 (buttons, menus, toolbars), `icon/lg`=20 (editor asset tab bar), `icon/toolbar-touch`=22 (glyphs of the mobile editor toolbars), `icon/xl`=24. Icon colour defaults to the adjacent text colour. Every icon-only control has an accessible label and a tooltip. The app logo and mark are original to JAgentChill. [NEW]

#### Scenario: Sidebar nav icon
- **WHEN** a primary navigation row renders on desktop
- **THEN** its icon is 14 px with 1.5 px stroke and its label is 13 px

#### Scenario: Icon-only button is labelled
- **WHEN** a screen reader focuses the timeline "Split" icon button
- **THEN** it announces "Split, button" in the active locale

### Requirement: Control size tokens and density rules
Interactive controls SHALL use the heights `control/xs`=24, `control/sm`=28, `control/md`=32, `control/lg`=40 and `control/touch`=44 px. Two independent axes decide how a screen is drawn, and every requirement of every capability names the axis it means:

- **Form factor** — `compact`, `medium` or `wide`, decided only by viewport width (`design-system.Breakpoints and layout constants`). It decides **layout and presentation**: drawer or pinned sidebar, bottom sheet or popover, stacked or split panes, full-height sheet or centred modal.
- **Density** — `regular` or `compact-touch`. Density is `compact-touch` when the form factor is compact **or** the primary pointer is coarse (`pointer: coarse` on web and Electron; always on iOS and Android unless a mouse or trackpad is the last used pointer for 10 s, in which case hover states are enabled but density does not change); otherwise it is `regular`. It decides **sizes and affordances**: control heights, type scale (`design-system.Typography tokens`), hit targets and whether hover-revealed controls are permanently visible. Density is re-evaluated when the primary pointer changes (for example a touch laptop switching input) and applies within 200 ms without reload.

At regular density the defaults are: list and menu rows 28, buttons and inputs 32, inspector fields 28, toolbar icon buttons 28×28, tab strip 36, top bar 48. At compact-touch density the defaults are: list and menu rows 44, buttons and inputs 44, toolbar icon buttons 44×44, tab strip 44, shell top bar 56, the compact editor top bar 44 (`control/editor-bar-compact`=44, used by `mobile-editor.Top bar`), and every hit target is at least 44×44 px even where the visible glyph is smaller (the one target size of `i18n-accessibility.Touch target size and gesture alternatives`, the same on iOS and Android). At compact-touch density every control that regular density reveals on hover or focus (a row's ⋯ button, a tab's ×, a field's clear button, a card's quick actions) is always visible, tooltips are replaced by the long-press label of `design-system.Tooltip`, and the sidebar's hover-reveal strip is replaced by its toggle button.

The four combinations are all supported and are named as follows: **desktop** (wide or medium, regular) — desktop apps and browsers with a mouse; **phone** (compact, compact-touch) — phones and narrow windows; **tablet** (medium or wide, compact-touch) — iPad, Android tablets and touch laptops in touch use: the layout of the medium or wide form factor (pinned sidebar where the form factor allows, popovers, split panes) drawn with compact-touch sizes, so popover and menu rows are 44 px and the sidebar rows are 44 px; **narrow desktop** (compact, with a fine pointer) — a narrow browser window: compact layout, compact-touch sizes. In every requirement "at compact-touch density" states a size or affordance and "on compact form factors" states a presentation; no requirement uses the bare word "compact" for a size. Button, input, select and segmented control of the same size token share one geometry so they align when placed in a row. [JAD] [NEW]

#### Scenario: Aligned controls
- **WHEN** a `md` button, a `md` input and a `md` segmented control sit in one row on desktop
- **THEN** all three are 32 px tall and their text baselines align

#### Scenario: Touch density hit target
- **WHEN** an icon button with a 16 px glyph renders on a 390 px wide touch device
- **THEN** its pressable area is at least 44×44 px

#### Scenario: Tablet keeps the wide layout with touch sizes
- **WHEN** the app runs on a tablet 1,180 px wide with a coarse primary pointer
- **THEN** the sidebar is pinned (wide form factor), its rows are 44 px tall (compact-touch density) and a dropdown opens as a popover with 44 px rows, not as a bottom sheet

#### Scenario: Hover-revealed control on touch
- **WHEN** a session row renders at compact-touch density
- **THEN** its ⋯ button is visible without hover or focus

#### Scenario: Pointer change on a touch laptop
- **WHEN** a user on a 1,440 px wide touch laptop stops using the mouse and touches the screen
- **THEN** density becomes compact-touch within 200 ms and the form factor stays wide

### Requirement: Breakpoints and layout constants
This requirement is the only definition of breakpoints and form factors; other capabilities say "compact", "medium" or "wide" and state no pixel threshold of their own (the 600 dp tablet-editor threshold of `mobile-editor.Tablet layout` selects an editor layout and is not a breakpoint). Breakpoints SHALL be `xs`=0, `sm`=576, `md`=720, `lg`=992, `xl`=1200 px (viewport width in CSS px / dp). "Compact" means `xs` or `sm` (< 720 px); "medium" means `md` (720–991 px); "wide" means `lg` or `xl` (≥ 992 px). Form factor decides layout only; sizes follow density (`design-system.Control size tokens and density rules`). Layout constants: sidebar width 240 (user-resizable 200–360), top bar 48 (56 at compact-touch density), workspace secondary header 36, centred content column 460 max for composer screens, 560 for settings pages, 760 for wide settings pages and tables, 820 maximum for long-form content, settings navigation column 240, side sheet 400, modal widths 360 / 480 / 640, popover maximum 320 (400 for the `wide` popover variant), macOS traffic-light inset 78. The inline-end or inline-start inset reserved for window controls on Windows and Linux is not a constant: it is the measured width reported by `desktop-app.Windows and window state` at run time (CSS environment variables of the title-bar overlay on Windows, the measured width of the app-drawn control group on Linux). Settings, modal and sheet widths are deliberately wider relative to the sidebar than in the reference visual language, so that Vietnamese and Japanese strings at +40% length fit their controls without truncation (`i18n-accessibility.Text expansion and CJK layout resilience`). [JAD] [NEW]

#### Scenario: Compact detection
- **WHEN** the viewport is 719 px wide
- **THEN** the form factor is compact and the sidebar is presented as a drawer

#### Scenario: Wide detection
- **WHEN** the viewport is 992 px wide
- **THEN** the form factor is wide and the pinned sidebar plus split panes are available

#### Scenario: Window-control inset is measured
- **WHEN** the desktop app runs on a Linux desktop whose window buttons are at the inline-start side and show only Close
- **THEN** the top bar reserves the measured width of that one button at the inline-start side and nothing at the inline-end side

### Requirement: Button
The Button component SHALL provide variants `primary` (fill `accent`, text `text/on-accent`), `strong` (fill `strong`, text `text/on-strong`; used for send and create actions), `secondary` (fill `bg/subtle`, text `text/primary`), `outline` (1 px `border/control`, transparent fill, text `text/primary`), `ghost` (transparent fill, text `text/primary`, `bg/hover` on hover), `link` (no fill, text `accent/text`, underlined on hover and focus, and always underlined when the preference "Underline links" is on) and `destructive` (fill `danger`, text `text/on-danger`, hover fill `danger/hover`); sizes `xs` 24, `sm` 28, `md` 32, `lg` 40 (every size is 44 px tall at compact-touch density) with horizontal padding 8 / 10 / 12 / 16 px and radius 6; optional leading or trailing icon with a 6 px gap; a `loading` state that shows a 14 px spinner in place of the leading icon, keeps the width and blocks activation; a `disabled` state at 40% opacity that is not focusable by pointer and reports `aria-disabled`. States: rest, hover (fill one step darker: `accent/hover`, `strong/hover`, `bg/hover`), pressed (`accent/pressed` or 8% black overlay), focus-visible (2 px `accent` ring with 2 px offset), loading, disabled. A split button pairs a main action with a 24 px chevron segment that opens a menu, separated by a 1 px divider. A surface shows at most one `primary` or `strong` button. The `destructive` variant appears only inside confirmation dialogs; menus use `danger/text` instead. A plain pressable text wrapper is not permitted in place of Button.

**Host-gated controls.** Button, IconButton, a menu row, a ListRow and a Card tile accept the prop `requiresHost`. With the prop set and no host connected the control stays **enabled and focusable**, shows the 12 px link badge (a chain-link glyph in `text/secondary`) at its inline-end, appends "requires a host" to its accessible name, and on activation calls the requires-host handler of `app-shell-navigation.Features that require a host` instead of its own action. With a host connected the badge is absent. A host-gated control is never rendered in the `disabled` state for lack of a host; `disabled` keeps its meaning "not available in the current state of this screen", and a disabled control that needs explaining carries a visible reason next to it or in its row description, because a disabled control shows no tooltip to keyboard users. [JAD] [NEW]

#### Scenario: Loading blocks double submit
- **WHEN** the user activates a `primary` button whose action is pending
- **THEN** the button shows a spinner, keeps its width and ignores further activation until the action settles

#### Scenario: Keyboard focus ring
- **WHEN** a button receives focus through the Tab key
- **THEN** a 2 px `accent` ring is drawn 2 px outside its edge
- **AND** the ring is not drawn when focus results from a pointer press

#### Scenario: Disabled button
- **WHEN** a button is disabled
- **THEN** it renders at 40% opacity, does not respond to press, Enter or Space, and exposes its disabled state to assistive technology

#### Scenario: Host-gated button without a host
- **WHEN** a button with `requiresHost` is focused by keyboard while no host is connected and the user presses Enter
- **THEN** the button is enabled, shows the link badge, is announced with "requires a host", and the requires-host sheet opens

#### Scenario: Destructive button in the dark theme
- **WHEN** a `destructive` button renders in the dark theme
- **THEN** its fill is `danger` #F26D63 and its label is `text/on-danger` #3A0D09, a contrast ratio of 5.75:1

### Requirement: Icon button and toggle button
The IconButton SHALL be square at the control height (24, 28, 32 or 44 px), radius 6, with variants `ghost` (default) and `outline`, and the same state set as Button. A ToggleButton is an IconButton or Button with a pressed state: fill `bg/subtle` and icon `text/primary` when on (or `accent/subtle` fill with `accent` icon for the `accent` tone), exposes `aria-pressed`. Every IconButton shows a tooltip containing its label and, where bound, its keyboard shortcut (at compact-touch density the long-press label of `design-system.Tooltip`), and accepts `requiresHost` (`design-system.Button`). [NEW]

#### Scenario: Toggle reflects state
- **WHEN** the timeline "Auto snapping" toggle is on
- **THEN** it renders with `bg/subtle` fill and reports `aria-pressed="true"`

#### Scenario: Tooltip shows the binding
- **WHEN** the pointer rests on the "Split" icon button for 500 ms
- **THEN** a tooltip "Split" appears with the key hint "⌘B" on macOS and "Ctrl+B" on Windows and Linux

### Requirement: Text input and textarea
The Input component SHALL render a single-line field with height per size token, radius 6, fill `bg/app`, 1 px `border/control`, horizontal padding 10 px, text `type/body` in `text/primary`, placeholder `text/placeholder`; optional leading icon, trailing icon, clear button (shown when non-empty and focused or hovered), prefix and suffix text, and character counter. States: rest, hover (`text/primary` border), focus (2 px `accent` border), invalid (2 px `danger` border, a 14 px error icon and a 12 px `danger/text` message below, so the state does not rest on colour), disabled (40% opacity), read-only (fill `bg/inset`, no caret change). The Textarea auto-grows from a minimum of 2 lines to a maximum given by the caller (default 8 lines) and then scrolls. A FormField wraps a control with a label (`type/body-medium`), optional description (`type/meta`, `text/secondary`) and error message, and links them for assistive technology. Validation messages appear on blur or submit, not on every keystroke, and clear as soon as the value becomes valid. [NEW]

#### Scenario: Invalid field
- **WHEN** a required input is blurred while empty
- **THEN** its border becomes 2 px `danger`, an error icon and a `danger/text` message appear below it and the message is announced by screen readers

#### Scenario: Textarea growth limit
- **WHEN** the user types a ninth line in a textarea with the default limit
- **THEN** the textarea stays 8 lines tall and scrolls vertically

#### Scenario: Clear button
- **WHEN** a search input contains text and the user activates its clear button
- **THEN** the value becomes empty, focus stays in the input and the change handler fires once

### Requirement: Search field
The SearchField SHALL be an Input with a leading 14 px search icon, a clear button that is shown whenever the value is non-empty, the role `searchbox` with an accessible name supplied by the caller, and a `debounce` prop (default 200 ms) after which the change handler fires; Enter fires it immediately and Escape clears a non-empty value (a second Escape is left to the surrounding surface). It accepts a trailing slot for a shortcut hint or a filter button, a `loading` state (the search icon becomes a 14 px spinner after 300 ms) and a result-count string that is announced through a polite live region ("12 results", "No results"). In a toolbar on compact form factors it collapses to an icon button that expands to the full width of the bar when activated. It is the only search input of the product: the sidebar search row, table toolbars, pickers, the command palette, the settings search and library searches use it. [NEW]

#### Scenario: Debounced search
- **WHEN** the user types "intro" at 60 ms per character
- **THEN** the change handler fires once, 200 ms after the last character

#### Scenario: Escape clears first
- **WHEN** a SearchField inside a popover contains "intro" and the user presses Escape twice
- **THEN** the first press clears the field and keeps the popover open, and the second closes the popover

#### Scenario: Result count is announced
- **WHEN** a search returns no rows
- **THEN** a screen reader announces "No results" without moving focus

### Requirement: Date, time and weekday fields
The package SHALL provide four controls for dates and times; no capability builds its own calendar, range picker or time input.

- **DateField** — an Input showing a date in the locale's short format (`i18n-accessibility.Locale-aware formatting`) with a calendar icon button; typing accepts the locale format and ISO `YYYY-MM-DD`; the button opens a calendar popover (a month grid with the first day of week of the locale, previous/next month buttons, a month and year select, "Today"); `min`, `max` and a `disabledDate` predicate are supported. Keyboard in the grid: arrows move by day and week, Page Up/Down by month, Shift+Page Up/Down by year, Home/End to the start and end of the week, Enter selects, Escape closes. The grid uses the `grid` role with each day's full date as its accessible name.
- **DateRangeField** — two linked date values (start, end) shown as one field "start – end", opening a popover with a preset list at the inline-start (the caller supplies presets; the default list is Today, Yesterday, Last 7 days, Last 30 days, This month, Last month, Custom) and a two-month calendar in which the first activation sets the start and the second the end (an end before the start swaps them); "Apply" commits and "Clear" removes the range when the caller allows an empty range. A `maxSpanDays` prop rejects longer ranges with the invalid state and the message "Choose at most <n> days".
- **TimeField** — hours and minutes (and seconds when `withSeconds`) as separate spin segments in the 12- or 24-hour form of the "Time format" preference, each segment changed by typing or Up/Down, with Left/Right moving between segments and an AM/PM segment in 12-hour form; values are local wall-clock times with no zone, and the caller shows the time zone next to the field.
- **WeekdayPicker** — seven toggle buttons in the locale's week order, labelled with the locale's narrow weekday name and carrying the full name as accessible name, with single- or multi-select mode and the presets "Every day", "Weekdays" and "Weekends" as chips above when `withPresets`.

All four have the size tokens, boundary, states and FormField integration of `design-system.Text input and textarea`. On compact form factors the calendar and range popovers are bottom sheets (the range sheet shows one month and the presets as a horizontally scrolling chip row), and on iOS and Android DateField and TimeField open the system date and time pickers when the caller sets `preferNative`. [NEW]

#### Scenario: Typed date in the locale format
- **WHEN** the UI language is `vi` and the user types "05/10/2026" into a DateField and presses Enter
- **THEN** the value is 5 October 2026

#### Scenario: Range with a preset
- **WHEN** the user opens a DateRangeField and activates "Last 7 days"
- **THEN** the range is the seven local days ending today and the field shows both dates in the locale's short format

#### Scenario: Range too long
- **WHEN** a DateRangeField with `maxSpanDays` 366 receives a start and end 400 days apart
- **THEN** it shows the invalid state with "Choose at most 366 days" and does not commit

#### Scenario: Time field in 12-hour form
- **WHEN** the "Time format" preference is 12-hour and the value is 22:00
- **THEN** the field shows "10:00 PM" and pressing Up on the hour segment gives "11:00 PM"

#### Scenario: Week order follows the locale
- **WHEN** the WeekdayPicker renders with first day of week Monday
- **THEN** the buttons are ordered Monday to Sunday and each is announced with its full weekday name and pressed state

### Requirement: Breadcrumb
The Breadcrumb SHALL render a navigation landmark labelled "Breadcrumb" containing up to five segments separated by a 12 px chevron: each ancestor segment is a `link`-variant control in `text/secondary` (underlined on hover and focus), the last segment is the current page in `text/primary` with `aria-current="page"` and is not a link; a segment accepts a 14 px leading icon, and becomes an inline-rename field when the caller marks it editable. Segments are truncated in the middle at 24 characters with the full text as tooltip. When the segments do not fit, the middle ones collapse into a "…" button that opens a menu listing them; on compact form factors only the parent segment is shown, as a back control "‹ <parent>". The separator direction mirrors in right-to-left layouts. [NEW]

#### Scenario: Collapsed middle segments
- **WHEN** a breadcrumb of five segments is rendered in a 320 px wide bar
- **THEN** it shows the first segment, a "…" button and the current page, and the "…" menu lists the three hidden segments in order

#### Scenario: Current page is not a link
- **WHEN** a screen reader reads the breadcrumb "Settings › Host › Secrets"
- **THEN** "Secrets" is announced as the current page and is not activatable

### Requirement: QR code view
The QRCode component SHALL draw a QR symbol from a string with error-correction level M (level Q when the caller sets `logo`), black #000000 modules on a white #FFFFFF tile **in both themes** (the two values are the fixed tokens `qr/module` and `qr/tile`; the tile is not themed, because inverted or tinted symbols fail to scan), a quiet zone of 4 modules on every side inside the tile, radius 8 on the tile, and a rendered size of at least 160×160 px (default 220, maximum 320) with each module at least 3 device pixels; a payload that cannot be drawn at 320 px with 3-pixel modules is refused with the error state "This code is too long to show — use the link instead". The component always renders, next to or below the symbol, the same payload in a non-visual-only form supplied by the caller: a copyable link, a short code, or both; its accessible name is "QR code" followed by the caller's description, and it exposes no part of the payload to assistive technology except through those controls. States: ready, loading (skeleton tile), expired (the symbol is replaced by an overlay "Expired" with a "New code" action, so an expired symbol can no longer be scanned) and error. The symbol is drawn locally; no network request is made. [NEW]

#### Scenario: Same symbol in the dark theme
- **WHEN** a pairing QR code renders in the dark theme
- **THEN** its tile is #FFFFFF with #000000 modules and a 4-module quiet zone, and it is at least 160 px wide

#### Scenario: Text alternative
- **WHEN** a user who cannot scan focuses the pairing sheet
- **THEN** the link and the short code are reachable by keyboard next to the symbol and can be copied

#### Scenario: Expired code cannot be scanned
- **WHEN** the caller marks the code expired
- **THEN** the symbol is no longer drawn and the overlay offers "New code"

### Requirement: Markdown view and code block
The MarkdownView SHALL render CommonMark with GitHub-flavoured tables, task lists, strikethrough and autolinks into native text (no HTML passthrough: raw HTML in the source is shown as text), with: headings mapped to `type/h1`, `type/title-md` and `type/title-sm` (levels 4–6 use `type/body-medium`) and exposed with their heading level; paragraphs in `type/body`; links in `accent/text`, underlined, opened through `app-shell-navigation.Deep links and file types` for product links and through the system browser after the external-link rule of `security-privacy` for others; inline code in `type/mono` on `bg/inset`; block quotes with a 3 px `border/strong` bar; lists with 16 px indentation; tables rendered with the Table header and hairline styles and horizontal scrolling inside the view; images only from sources the caller's resolver accepts, with their alt text, a maximum height of 320 px and a placeholder tile when blocked. A `streaming` prop renders incomplete input without layout jumps: an unterminated code fence is shown as an open CodeBlock and an unterminated table as text until its header row is complete. Text is selectable on every platform.

The CodeBlock SHALL render a fenced block in `type/mono` on `bg/inset` with a 1 px `border/hairline` border and radius 8, a header row with the language label and a "Copy" button (which reports "Copied" for 2 s) plus an optional caller action (for example "Apply" or "Open in terminal"), syntax colours taken from the ANSI tokens of `design-system.Terminal tokens` (keyword = blue, string = green, number = yellow, comment = bright-black, type = cyan, error = red — pairs that already meet 4.5:1 on `terminal/bg`; a CodeBlock therefore uses `terminal/bg` as its fill when highlighting is on), horizontal scrolling for long lines with an optional "Wrap" toggle, line numbers when `showLineNumbers`, and a collapsed state for blocks longer than 30 lines ("Show all <n> lines"). Highlighting runs for the languages bundled with the package and falls back to plain text for others; blocks longer than 2,000 lines are never highlighted. [NEW]

#### Scenario: Raw HTML is inert
- **WHEN** the source contains `<img src=x onerror=alert(1)>`
- **THEN** the text is shown literally and nothing is loaded or executed

#### Scenario: Streaming code fence
- **WHEN** a streaming message has delivered an opening fence and three lines without the closing fence
- **THEN** the three lines are shown inside a CodeBlock, and the lines that follow are appended without the block being re-created

#### Scenario: Copy code
- **WHEN** the user activates "Copy" on a CodeBlock
- **THEN** the clipboard holds the block's text without line numbers and the button reads "Copied" for 2 s

#### Scenario: Long block is collapsed
- **WHEN** a CodeBlock has 120 lines
- **THEN** 30 lines are shown with the control "Show all 120 lines"

### Requirement: Select and combobox
The Select component SHALL render its trigger with the geometry, fill and 1 px `border/control` boundary of `design-system.Text input and textarea`, show the chosen option label with a 14 px chevron and open a listbox popover aligned to the trigger, at least as wide as the trigger and at most 320 px, with 28 px rows (44 px at compact-touch density), a check mark on the selected row, optional option icon and description, option groups with 11 px captions, and disabled options. The Combobox adds a text field that filters options case-insensitively and diacritic-insensitively as the user types, highlights the first match, supports async option sources with a loading row and an error row with "Retry", supports multi-select (chosen values shown as removable chips), and an optional "Create "<query>"" row. Lists longer than 50 options are virtualised. Keyboard: Down/Up move, Home/End jump, Enter selects, Escape closes without change, typing in a closed Select jumps to the first matching option. On compact form factors both open as a bottom sheet with the search field pinned at the top. [JAD] [NEW]

#### Scenario: Type-ahead filter
- **WHEN** the user types "viet" in a language combobox
- **THEN** the list shows "Tiếng Việt (Vietnamese)" with the first match highlighted
- **AND** pressing Enter selects it and closes the list

#### Scenario: Empty result
- **WHEN** no option matches the query and creation is not enabled
- **THEN** the list shows a single non-interactive row "No results"

#### Scenario: Async source failure
- **WHEN** the option source request fails
- **THEN** the list shows the error row with a "Retry" action and the previous selection is unchanged

### Requirement: Segmented control, tabs and tab strip
The SegmentedControl SHALL present 2–5 mutually exclusive options in a `bg/subtle` track with radius 6 and 2 px inner padding; the selected segment is `bg/elevated` with `elevation/1`, a 1 px `border/control` outline and `type/body-medium` in `text/primary` (unselected segments use `text/secondary`), so the selected state does not rest on the fill difference alone; the selection indicator slides in 160 ms. Tabs come in two variants: `underline` (36 px tall strip, 44 px at compact-touch density, labels in `type/body`, selected tab `text/primary` with a 2 px `text/primary` underline, others `text/secondary`, optional count badge) and `pill` (28 px pills, 44 px hit height at compact-touch density; selected `bg/subtle` with `text/primary` in weight 500 and a 1 px `border/control` outline, others `text/secondary`). The workspace TabStrip adds closable tabs (× shown on hover, on focus or when selected, and always at compact-touch density), a "+" new-tab button, drag reordering on desktop and web, overflow scrolling with edge fade of 24 px, and a middle-click close. Keyboard: Left/Right move between tabs, Home/End jump, Enter or Space selects when activation is manual; roles are `tablist`, `tab`, `tabpanel`. On compact form factors every tab strip scrolls horizontally and never wraps. [NEW]

#### Scenario: Arrow key navigation
- **WHEN** focus is on the first tab and the user presses Right
- **THEN** focus and selection move to the second tab and its panel becomes visible

#### Scenario: Overflowing tab strip
- **WHEN** a workspace has more tabs than fit the strip width
- **THEN** the strip scrolls horizontally, shows a 24 px fade on the clipped edge and keeps the selected tab scrolled into view

### Requirement: Switch, checkbox and radio
The Switch SHALL be 32×18 px (44×26 at compact-touch density) with a 14 px (22 px) thumb, track `border/control` when off and `accent` when on, thumb `control/thumb`, transition 120 ms; the thumb position (inline-start = off, inline-end = on) carries the state independently of colour, and with the preference "Increase contrast" on the on-track additionally shows a 10 px check glyph in `text/on-accent`. The Checkbox is 16×16 px (20×20 at compact-touch density), radius 4, fill `bg/app`, 1.5 px `border/control`; checked and indeterminate states fill `accent` with a glyph in `text/on-accent`. The Radio is a 16 px (20 px) circle with a 1.5 px `border/control` ring, which becomes a 1.5 px `accent` ring with a 6 px (8 px) `accent` dot when selected. All three support rest, hover, focus-visible, disabled and invalid states, have a 28 px (44 px at compact-touch density) hit area including their label, and toggle with Space. A switch applies its change immediately; when the change is persisted remotely and fails, the switch returns to its prior state and an error toast is shown. [NEW]

#### Scenario: Remote failure reverts the switch
- **WHEN** the user turns on a host setting switch and the Gateway rejects the update
- **THEN** the switch returns to off within 200 ms of the error and a toast states the reason

#### Scenario: Indeterminate checkbox
- **WHEN** 2 of 5 rows in a table are selected
- **THEN** the header checkbox shows the indeterminate glyph and activating it selects all 5

### Requirement: Slider
The Slider SHALL render a 4 px track (`border/control`, filled part `accent`) with a 14 px thumb (20 px at compact-touch density, inside a 44×44 px hit area) filled `control/thumb` with a 1.5 px `border/control` ring (2 px `accent` while focused or dragged) and support: min, max, step, default value with a tick mark, double-click or double-tap to reset to default, a centre-origin mode for bipolar ranges (fill grows from the default tick), an optional paired NumberField showing the same value, and a range mode with two thumbs. Keyboard: Left/Down and Right/Up change by one step, Shift+arrow by 10 steps, Page Up/Down by 10% of the range, Home/End to min/max. Dragging emits live change events at most once per animation frame and one commit event on release, so the consumer records a single undo step per gesture. [NEW]

#### Scenario: One undo step per drag
- **WHEN** the user drags an opacity slider from 100 to 40 and releases
- **THEN** exactly one commit event fires with value 40 and intermediate values were delivered only as live previews

#### Scenario: Reset to default
- **WHEN** the user double-clicks the thumb of a slider whose default is 0
- **THEN** the value becomes 0 and one commit event fires

### Requirement: Number field with scrubbing and expressions
The NumberField SHALL accept typed numeric input, clamp to its min and max, snap to its step, and show an optional unit suffix placed 6 px after the value and an optional reset button that appears only when the value differs from the default. Focus or first click selects the whole value; Enter commits and blurs; Escape restores the value held before editing and blurs; Up/Down change by one step, Shift+Up/Down by 10 steps, Alt+Up/Down by 0.1 step. Dragging the field's label or icon horizontally scrubs the value using pointer lock on desktop and web, discarding the first move event, at 1 unit per pixel by default, 0.5 unit per pixel in `slow` mode, 0.1× while Alt is held and 10× while Shift is held; piecewise scrub ranges (pixels per unit per value range) and a scrub clamp are supported; one commit event fires on release. On touch devices scrubbing is a horizontal drag on the label without pointer lock. On blur or Enter, input containing `+`, `-` (non-leading), `*`, `/`, parentheses and decimals is evaluated by a recursive-descent parser; any other character, division by zero or an unparsable expression leaves the previous value in place and marks the field invalid for 1.5 s. A "mixed" state shows an em dash placeholder when a multi-selection has differing values, and typing a value applies it to all. [PORT SH-011] [NEW]

#### Scenario: Expression evaluation
- **WHEN** the user types `1920/2+10` into a Position X field and presses Enter
- **THEN** the value becomes 970 and one commit event fires

#### Scenario: Invalid expression
- **WHEN** the user types `12px` and blurs the field
- **THEN** the field reverts to its previous value and shows the invalid state for 1.5 s

#### Scenario: Scrub with modifier
- **WHEN** the user drags the label 50 px to the right while holding Shift on a field with step 1
- **THEN** the value increases by 500, clamped to the field maximum, and a single commit event fires on release

#### Scenario: Clamp
- **WHEN** the user types 500 into a field whose range is −360..360
- **THEN** the committed value is 360

### Requirement: Colour picker
The ColorPicker SHALL have a trigger made of a swatch drawn over a checkerboard plus an inline uppercase hex input, and a popover containing: a saturation/value square, a hue slider, an opacity slider (0–100%), a format select (HEX, RGB, HSL, HSV) with a text input parsed per format, an eyedropper button, a "Custom | Saved" switch, a row of the 12 most recently used colours, and a reset-to-default button when a default is supplied. Hex values are accepted with or without `#`, in 3, 4, 6 or 8 digits. Enter or blur commits; invalid input is ignored and the previous value restored. Pasting any text that contains a colour extracts it and keeps the current alpha unless the pasted value carries its own. The hue is preserved while the colour is a grey. Change events fire during drags and one commit event fires on release; dismissal by outside press is suppressed while dragging. The "Saved" view lists up to 48 colours saved by the user per device (add current, remove, reorder), persisted in preferences, and the brand colours of the active project where the project defines them. The eyedropper uses the EyeDropper API on browsers that provide it and the Electron screen capture path on desktop; where neither exists (including mobile) the button is hidden and an in-preview sampler ("Pick from preview") is offered instead; a picked colour keeps the current alpha. On compact form factors the popover is a bottom sheet. [PORT SH-011] [NEW]

#### Scenario: Paste a colour
- **WHEN** the current colour is #FF000080 and the user pastes the text "brand colour: #00ff00"
- **THEN** the colour becomes #00FF0080

#### Scenario: Grey keeps its hue
- **WHEN** the user drags saturation to 0 on a colour with hue 210° and then raises saturation again
- **THEN** the colour returns to hue 210°

#### Scenario: Eyedropper unavailable
- **WHEN** the picker opens on a platform without the EyeDropper API and outside Electron
- **THEN** the eyedropper button is not rendered and "Pick from preview" is available

#### Scenario: Saved colours persist
- **WHEN** the user saves #2F6FEB in the Saved view and restarts the app
- **THEN** #2F6FEB appears in the Saved view

### Requirement: Chips, tags and token chips
The Chip SHALL be a pill (radius full) 20 px tall (`sm`) or 24 px (`md`), with a hit area of at least 44×44 px at compact-touch density for interactive chips and for the remove ×, with `type/meta` text in `text/primary`, fill `bg/subtle`, optional leading icon or 14 px thumbnail, optional remove ×, and an interactive variant (hover `bg/hover`, selected `accent/subtle` with `accent/text` text and a leading 12 px check glyph). A Tag is a non-interactive chip used for labels. A FilterChip shows "<field> is <value> ×" and an "+ Add filter" trigger. A TokenChip is an inline chip with fill `accent/subtle` and `accent/text` text used inside sentences (trigger conditions, @-mentions in the composer); it is treated as one character for caret movement and deletion, shows the entity icon and name truncated at 24 characters, and opens its entity on click. An AttachmentChip shows a 20×20 thumbnail or file-type icon, file name truncated in the middle, size, upload progress as a 2 px bottom bar, an error state (`danger` border, error icon and a "Retry" control) and a remove ×. [NEW]

#### Scenario: Token chip deletion
- **WHEN** the caret is immediately after an @-mention token chip and the user presses Backspace
- **THEN** the whole chip is removed in one keystroke

#### Scenario: Attachment upload failure
- **WHEN** an attachment upload fails
- **THEN** its chip shows the `danger` border and a retry control, and the message cannot be sent until the chip is retried successfully or removed

### Requirement: List rows and secondary list
The ListRow SHALL be 28 px tall at regular density for single-line rows and 44 px for two-line rows (title `type/body` truncated to one line, meta line `type/meta` `text/secondary`), radius 6, horizontal padding 8 px, with optional leading icon or avatar, trailing accessory (shortcut hint, count, chevron, 6 px `accent` unread dot, ⋯ button shown on hover or focus and always visible at compact-touch density), states rest, hover (`bg/hover`), selected (`bg/subtle` with the title in weight 500 `text/primary`, its icon in `text/primary`, and `aria-current` or `aria-selected`; with the preference "Increase contrast" on, also a 2 px `text/primary` bar at the inline-start edge), focus-visible, disabled and dragging (60% opacity). A row accepts `requiresHost` (`design-system.Button`). Group captions are 11 px `text/secondary` with 12 px top spacing. The meta line supports a status tone: `success/text`, `warning/text`, `danger/text`, `accent/text`, `purple/text` or the default `text/secondary`, matching the tones of `design-system.Avatar, badge and status pill`. Long lists are virtualised above 100 rows. A row supports a context menu on right-click and long-press. At compact-touch density single-line rows are 44 px and two-line rows 56 px. [NEW]

#### Scenario: Unread indicator
- **WHEN** a session row has unread agent output
- **THEN** a 6 px `accent` dot renders at the right edge and the row's accessible name ends with "unread"

#### Scenario: Truncation
- **WHEN** a row title exceeds the available width
- **THEN** it is truncated with an ellipsis on one line and the full title is available as a tooltip after 500 ms hover

### Requirement: Cards and grouped setting cards
The Card SHALL be a `bg/app` surface with 1 px `border/hairline`, radius 8 and no shadow. Variants: plain, interactive (hover `bg/hover`, focus ring), selected (2 px `accent` border), media card (thumbnail with 16:9, 9:16 or 1:1 frame, title, meta, optional play overlay and status pill) and embedded chat cards. The GroupedSettingCard is one bordered card containing rows separated by hairlines; each row has a label (`type/body-medium`), an optional description (`type/meta`, `text/secondary`, up to 3 lines) and one control aligned right: select, switch, button, inline-edit chip with a pencil icon, read-only monospace value with a copy button, or a chevron for a sub-page. Row padding is 12×10 px and minimum row height 44 px. On compact form factors the control wraps below the label when the row is narrower than 360 px. The landing variant lists sections with a 28 px icon tile, title, description and chevron. An interactive Card accepts `requiresHost` (`design-system.Button`). [NEW]

#### Scenario: Inline edit chip
- **WHEN** the user activates the pencil on a "Host name" row, types a new name and presses Enter
- **THEN** the row shows a pending state, saves the value, and on success shows the new name
- **AND** pressing Escape instead restores the previous name without saving

#### Scenario: Copy read-only id
- **WHEN** the user activates the copy button of a monospace id row
- **THEN** the id is written to the clipboard and a toast "Copied" appears for 2 s

### Requirement: Table
The Table SHALL render a header row (`bg/sidebar`, `type/meta` `text/secondary`, 32 px) and body rows of 36 px (dense) or 44 px (default) separated by hairlines, with: column sorting (ascending, descending, none) announced via `aria-sort`, resizable columns on desktop, a sticky header, row selection checkboxes with a bulk-action bar that replaces the toolbar while a selection exists, a row ⋯ menu, an optional toolbar (search field at left, secondary and primary buttons at right), pagination or infinite scrolling with a 200 px threshold, a loading state of 6 skeleton rows, an error state with "Retry", and a centred empty state. On compact form factors each row becomes a stacked card showing the first column as title and the remaining columns as label–value lines. [NEW]

#### Scenario: Empty table
- **WHEN** a secrets table has no rows and no search query
- **THEN** it shows the centred empty state with the title "No secrets yet", a one-line description and the primary "Add secret" button

#### Scenario: Empty search result
- **WHEN** a search query matches no rows
- **THEN** the table shows "No results for "<query>"" with a "Clear search" action instead of the first-use empty state

#### Scenario: Bulk selection
- **WHEN** the user selects 3 rows
- **THEN** the toolbar is replaced by a bar reading "3 selected" with the available bulk actions and a "Clear" control

### Requirement: Tree
The Tree SHALL render hierarchical rows of 28 px with 16 px indentation per level, a disclosure chevron for parents, optional icon, label, trailing meta and ⋯ menu; supports single and multi selection (Ctrl/Cmd toggles, Shift selects a range), lazy loading of children with an inline spinner row, drag and drop to move nodes with a 2 px `accent` insertion line or a highlighted drop target, inline rename (F2 or double-click; Enter saves, Escape reverts), and virtualisation above 200 visible rows. Keyboard follows the WAI-ARIA tree pattern: Up/Down move, Right expands or moves to the first child, Left collapses or moves to the parent, Home/End jump, `*` expands all siblings, typing jumps to the next label that starts with the typed characters. [NEW]

#### Scenario: Keyboard expand and collapse
- **WHEN** focus is on a collapsed folder and the user presses Right, then Left
- **THEN** the folder expands, then collapses, and focus stays on the folder

#### Scenario: Invalid drop
- **WHEN** the user drags a folder onto one of its own descendants
- **THEN** no drop indicator is shown and releasing leaves the tree unchanged

### Requirement: Disclosure
The Disclosure SHALL be a header button with a 14 px chevron (pointing to the inline-end when closed, down when open), a title in `type/body-medium`, an optional count or summary at the inline-end, and a content region that is mounted when first opened; the header exposes `aria-expanded` and controls the region, toggles with Enter and Space, and animates the region's height in `motion/base` (no animation under reduced motion). An Accordion groups disclosures with hairline separators and a `single` mode in which opening one closes the others. Open state is controlled by the caller, which decides whether it persists. It is used for collapsible navigation groups, advanced sections of forms, collapsed tool calls and reasoning in chat, and inspector sections. [NEW]

#### Scenario: Keyboard toggle
- **WHEN** focus is on a closed disclosure header and the user presses Space
- **THEN** the region opens, `aria-expanded` becomes true and focus stays on the header

#### Scenario: Single-mode accordion
- **WHEN** a second section of a `single` accordion is opened
- **THEN** the first section closes

### Requirement: Tooltip
The Tooltip SHALL appear after 500 ms of hover or immediately on keyboard focus; it stays while the pointer is over the trigger **or over the tooltip itself** (the pointer can travel from one to the other across the 6 px gap without closing it) and while the trigger has focus, and disappears 100 ms after the pointer has left both, on Escape (without moving focus), on scroll or on press. It uses fill `strong` with `text/on-strong` text in both themes, `type/meta`, radius 6, padding 4×8 px, maximum width 240 px, 6 px offset from the anchor, automatic flipping to stay within the viewport, and an optional key hint rendered as keycaps. Once one tooltip has shown, moving to an adjacent trigger within 300 ms shows the next tooltip without delay. At compact-touch density tooltips are not shown on touch; long-press on an icon-only control shows its label for 1.5 s instead (or for the "Minimum toast duration" of `i18n-accessibility.Timing, session and error tolerance` when that is longer). The same hover rule applies to every hover-opened surface of the product, including the sidebar hover-reveal overlay of `app-shell-navigation.Sidebar collapse, resize and persistence`. Tooltip content is never the only place where essential information lives. [NEW]

#### Scenario: Delay and flip
- **WHEN** the pointer rests for 500 ms on a control at the top edge of the viewport
- **THEN** the tooltip appears below the control instead of above it

#### Scenario: Touch long-press
- **WHEN** the user long-presses an icon-only toolbar button on a phone
- **THEN** its label is shown for 1.5 s and the button action does not fire

#### Scenario: Pointer moves onto the tooltip
- **WHEN** a tooltip is showing and the pointer moves from the trigger onto the tooltip
- **THEN** the tooltip stays visible, and it closes 100 ms after the pointer leaves both

#### Scenario: Escape dismisses without moving focus
- **WHEN** a tooltip is showing for a focused button and the user presses Escape
- **THEN** the tooltip closes and focus stays on the button

### Requirement: Popover, dropdown menu and context menu
Popovers and menus SHALL use `bg/elevated`, radius 8, `elevation/2`, 4 px inner padding, a minimum width of 180 px and maximum of 320 px (a `wide` variant with a maximum of 400 px exists for list surfaces such as `notifications.Notification inbox`), and position relative to their anchor with 4 px offset, flipping and shifting to remain 8 px inside the viewport. Menu rows are 28 px (44 px at compact-touch density) with optional leading icon, label, trailing shortcut hint (`text/secondary`), check mark for selected items, switch rows, a ▸ indicator for submenus, group captions and 1 px separators with 4 px vertical margin; destructive items use `danger/text`; a row accepts `requiresHost` (`design-system.Button`). A disabled row stays focusable by arrow keys and is announced as unavailable. Submenus open on hover after 150 ms or on Right/Enter, close on Left, and stay open while the pointer travels diagonally toward them. Keyboard: Down/Up move with wrap, Home/End jump, typing focuses the next matching item, Enter or Space activates, Escape closes one level, Tab closes all. Menus trap focus, restore focus to the trigger on close and close on outside press. A context menu opens on right-click, on the Menu key or Shift+F10, and on long-press of 500 ms on touch. A menu item supports a hover-preview callback whose effect is discarded on pointer leave or close unless the item is committed. On compact form factors every popover and menu is presented as a bottom sheet and submenus push a second page with a back button; on medium and wide form factors at compact-touch density (tablets) they stay popovers with 44 px rows and submenus open on tap. [PORT SH-001] [NEW]

#### Scenario: Submenu by keyboard
- **WHEN** focus is on a row with ▸ and the user presses Right
- **THEN** the submenu opens with its first item focused, and pressing Left closes it and returns focus to the parent row

#### Scenario: Viewport collision
- **WHEN** a menu is opened from a trigger 20 px above the bottom of the window
- **THEN** it opens above the trigger and stays at least 8 px inside the viewport

#### Scenario: Hover preview is discarded
- **WHEN** the pointer hovers a menu item that previews a mask shape and then leaves the menu without clicking
- **THEN** the preview is removed and no undo step is recorded

#### Scenario: Compact presentation
- **WHEN** the same menu is opened on a 390 px wide device
- **THEN** it is shown as a bottom sheet with 44 px rows

#### Scenario: Tablet presentation
- **WHEN** the same menu is opened on a 1,024 px wide tablet with a coarse pointer
- **THEN** it is shown as a popover anchored to its trigger with 44 px rows

### Requirement: Modal dialog
The Modal SHALL be centred over `bg/scrim`, `bg/elevated`, radius 12, `elevation/3`, widths 360 (confirm), 480 (form) or 640 (complex), maximum height 85% of the viewport with an internally scrolling body, a header with title `type/title-sm` and optional `text/secondary` subtitle and a × button at the top right, and a footer with right-aligned actions (ghost "Cancel" then one primary action). It traps focus, places initial focus on the first field or on the least destructive action for confirmations, closes on Escape and on scrim press unless marked `blocking` or holding unsaved input (in which case a discard confirmation is shown), restores focus to the opener, locks background scroll and marks the rest of the app inert. Provided variants: confirm, destructive confirm (primary action is the `destructive` button; items that delete more than 10 objects or delete irreversibly require typing the object name or the word shown), form, list picker with search and checkboxes (primary label reflects the count, e.g. "Add 3 clips"), tag picker with search and "Create", tabbed detail with key–value table, and progress (non-dismissible while a non-cancellable step runs). Only one modal is visible at a time; a second request stacks and is shown after the first closes, except confirmations raised by the open modal, which overlay it. On compact form factors modals are full-height sheets with the title bar pinned and actions pinned above the safe area. [JAD] [NEW]

#### Scenario: Focus management
- **WHEN** a modal opens from a button and the user presses Tab repeatedly
- **THEN** focus cycles only among the modal's controls
- **AND** when the modal closes focus returns to the button

#### Scenario: Unsaved input guard
- **WHEN** the user has typed into a form modal and presses Escape
- **THEN** a confirmation "Discard changes?" is shown, and choosing "Keep editing" returns to the form with the input intact

#### Scenario: Destructive confirmation
- **WHEN** the user confirms permanent deletion of a project
- **THEN** the primary action is a `destructive` button labelled with the verb and object, initial focus is on "Cancel", and Enter does not delete

### Requirement: Side sheet and bottom sheet
The SideSheet SHALL slide in from the inline-end edge at 400 px wide (full width on compact form factors), full height, `bg/elevated`, `elevation/3`, with a header (title, ×), scrolling body and pinned footer; it is modal by default (scrim, focus trap, Escape closes with the unsaved-input guard) and has a non-modal variant that leaves the page interactive. The BottomSheet has 16 px top corner radius, a 36×4 px grab handle, snap points (content height, 50%, 90% of the viewport), drag-to-dismiss past 30% of its height or with a downward fling above 800 px/s, a scrim for modal sheets, keyboard avoidance that keeps the focused field visible, and safe-area padding. An AdaptiveSheet helper renders a Modal or popover on medium and wide form factors and a BottomSheet on compact ones from one definition. A non-modal BottomSheet variant (centred title, confirm ✓ at the inline-end side, no scrim) is provided for editor tool panels on mobile; its height, its header controls (Reset or ✕, ✓ or ⌄), its commit and discard rules and its `canvasPassive` / `canvasInteractive` flag are defined only by `mobile-editor.Tool sheets never cover the preview`, and its touch targets by `mobile-editor.Touch gesture constants`; this capability fixes none of them. [JAD] [NEW]

#### Scenario: Drag to dismiss
- **WHEN** the user drags a bottom sheet downward by more than 30% of its height and releases
- **THEN** the sheet closes in 240 ms and focus returns to the opener

#### Scenario: Keyboard avoidance
- **WHEN** a text field inside a bottom sheet is focused and the on-screen keyboard opens
- **THEN** the sheet moves so that the field and the primary action remain visible above the keyboard

#### Scenario: Adaptive presentation
- **WHEN** the same AdaptiveSheet definition is opened at 1280 px and at 390 px width
- **THEN** it renders as a centred modal at 1280 px and as a bottom sheet at 390 px

#### Scenario: Non-modal tool sheet
- **WHEN** a non-modal tool sheet is open on a phone
- **THEN** no scrim is drawn and the preview above it still responds to touch

### Requirement: Drawer
The Drawer SHALL be a modal panel that slides in from the inline-start edge over `bg/scrim`, `bg/sidebar` fill, `elevation/3`, width 86% of the viewport up to a maximum of 320 px, full height with safe-area padding, entering in `motion/slow` (an opacity fade of at most 120 ms under reduced motion). It traps focus, places initial focus on its first control, marks the page behind it inert, closes on scrim press, on Escape, on the system back action and on a drag toward the inline-start edge of more than 30% of its width or a fling above 800 px/s, and restores focus to its opener. It supports a pinned header, a scrolling body, a pinned footer and an optional segmented header that switches between two bodies while keeping each body's scroll position. Opening by drag is offered only through the `dragOpenZone` the caller defines; the component never claims a screen-edge zone reserved by the operating system (`app-shell-navigation.Mobile drawer and top bar`). [NEW]

#### Scenario: Drawer traps focus and restores it
- **WHEN** the drawer is opened from the top-bar button and then closed with Escape
- **THEN** focus cycled only inside the drawer while it was open and returns to the top-bar button

#### Scenario: Right-to-left
- **WHEN** the layout direction is right-to-left
- **THEN** the drawer enters from the right edge and closes by a drag toward the right

### Requirement: Application menu button
The AppMenu component SHALL present the application menu of the desktop app inside the window on Windows and Linux, where the window has no native menu bar (`desktop-app.Native application menu`); it is not rendered on macOS (system menu bar), in browsers or on mobile. It is an IconButton with a "☰" glyph and the accessible name "Application menu", placed by `app-shell-navigation.Top bar` at the inline-start of the global top bar on every screen. Activating it opens a Menu whose top-level rows are the menus of the shared menu model in order (File, Edit, View, …, Help), each a submenu row; the rows, their order, their enabled and checked state and their shortcut hints come from the same menu model the macOS menu bar is built from, so the two never differ. At widths of 1,200 px and above (`xl`) the caller can set `expanded`, which draws the top-level titles as a horizontal menu bar (role `menubar`, 28 px tall, `type/body`) in place of the single button; below that width it is always the single button.

Keyboard: F10 opens the menu with the first row focused; Alt+<mnemonic letter> opens the corresponding top-level menu directly (mnemonics are the underlined letters of the menu model, shown underlined only while Alt is held); a bare press and release of Alt does nothing, so Alt-modified pointer gestures and shortcuts never move focus into the menu; inside the menu the rules of `design-system.Popover, dropdown menu and context menu` apply, with Left/Right moving between top-level menus. Every row is a registry action of `keyboard-shortcuts.Action registry` or an operating-system role declared by `desktop-app.Native application menu`. [NEW]

#### Scenario: Menu opens from the keyboard
- **WHEN** the user presses Alt+F on Windows while no overlay is open
- **THEN** the application menu opens with the File submenu expanded and its first item focused

#### Scenario: Bare Alt does nothing
- **WHEN** the user holds Alt, scrolls the timeline with the wheel and releases Alt
- **THEN** focus does not move and no menu opens

#### Scenario: Not rendered on macOS
- **WHEN** the desktop app runs on macOS
- **THEN** no application menu button is drawn in the top bar and the system menu bar carries the same menu model

### Requirement: Toast with undo
Toasts SHALL appear at the bottom right on medium and wide form factors (16 px from the edges) and at the bottom centre above the safe area and any docked toolbar on compact ones, as an inverse pill (fill `strong`, text and icons `text/on-strong`, in both themes), radius 8, `elevation/2`, minimum width 240 px, maximum 420 px, with a leading status icon drawn in `text/on-strong` and distinguished by shape (check for success, "i" for info, triangle for warning, cross for error), a message of at most 2 lines, an optional action link (for example "Undo" or "View") and a × button. Default durations are 4 s for plain toasts, 8 s for toasts with an action (each raised to the "Minimum toast duration" preference of `i18n-accessibility.Timing, session and error tolerance` when that is longer) and no automatic dismissal for errors that require a decision or for progress toasts. Hovering or focusing a toast pauses its timer. At most 3 toasts are visible; additional ones queue; identical messages within 2 s are merged with a count. A progress toast shows a determinate or indeterminate bar and updates in place to its final state. The "Undo" action invokes the supplied revert and replaces the toast with a confirmation for 2 s; if the revert fails an error toast states so. Toasts are announced through a polite live region, errors through an assertive one, and every toast's action remains reachable in `notifications.Notification inbox` after the toast disappears when the caller marks it as persistent. Swiping a toast horizontally dismisses it on touch devices. [PORT SH-010] [NEW]

#### Scenario: Undo from a toast
- **WHEN** the user deletes a project and activates "Undo" in the resulting toast within 8 s
- **THEN** the project is restored and the toast is replaced by "Restored" for 2 s

#### Scenario: Timer pauses on hover
- **WHEN** the pointer rests on a toast
- **THEN** the toast does not dismiss until the pointer leaves, after which the remaining time resumes

#### Scenario: Queueing
- **WHEN** five toasts are raised within one second
- **THEN** three are visible and the other two appear as earlier ones dismiss

### Requirement: Callouts and banners
The Callout SHALL be a block with a 3 px left bar, a tinted fill, an icon, body text and optional actions, in tones info (bar `accent`, fill `accent/subtle`), success (bar `success`, fill `success/subtle`), warning (bar `warning`, fill `warning/subtle`) and danger (bar `danger`, fill `danger/subtle`); the body text is `text/primary`, the icon uses the tone's `/text` token and has a different shape per tone, and links inside use `accent/text` with an underline. A Banner is a full-width strip at the top of a region, 36 px tall, with the same tones, one message, up to two actions and an optional dismiss ×; dismissal is remembered per banner id according to the caller's policy (per session or permanently). Banners are used for connection loss, degraded renderer, read-only project lock and update readiness. [NEW]

#### Scenario: Warning callout
- **WHEN** a settings page renders a warning callout
- **THEN** it shows a 3 px `warning` left bar, `warning/subtle` fill and its text meets the contrast rule in `i18n-accessibility.Colour contrast`

#### Scenario: Persistent dismissal
- **WHEN** the user dismisses a banner whose policy is permanent and restarts the app
- **THEN** the banner is not shown again

### Requirement: Progress indicators and skeletons
The system SHALL provide: a linear ProgressBar (4 px, radius full, track `bg/subtle`, fill `accent`; determinate with value 0–100 and indeterminate with a 1.2 s loop), a 2 px thin variant for cards and chips, a circular Spinner (12, 14, 16, 24 px; 0.8 s rotation), a StatusRing (16 px ring showing percentage or state), and a Stepper showing "n of m" with a thin bar or named stages with the current stage filled and completed stages checked. Determinate bars expose `role="progressbar"` with current value and a text label. A Skeleton is a `bg/subtle` block with a 1.4 s shimmer (static under reduced motion) shaped like the content it replaces; skeletons are shown only when loading has lasted 150 ms and are replaced without layout shift. An operation that has run for 1 s without completing SHALL show a progress indicator; an operation that has run for 10 s SHALL show a determinate bar or a step label, and a cancel control where cancellation is possible. [NEW]

#### Scenario: Fast load shows no skeleton
- **WHEN** a list loads in 100 ms
- **THEN** no skeleton is rendered

#### Scenario: Progress appears after one second
- **WHEN** an operation has been running for 1 s
- **THEN** a progress indicator is visible, and none was shown at 500 ms

#### Scenario: Long operation is cancellable
- **WHEN** a proxy generation task has run for more than 10 s
- **THEN** its progress UI shows a percentage and a "Cancel" control

### Requirement: Empty, error and offline states
The EmptyState component SHALL present a 32 px outline icon, a title (`type/title-sm`), a one- or two-line description (`text/secondary`) and up to two actions, centred in its region with a maximum width of 320 px. Four distinct states are provided and MUST NOT be conflated: **first-use empty** (explains what the area is for and offers the creating action); **no-results** (names the active query or filter and offers to clear it); **error** (offers "Retry" and "Copy details"; its message is the localised string of the `errors` namespace keyed by the error code — `server-api.RPC error envelope` codes and the domain codes — with the fallback "Something went wrong (<code>)" for a code without a string; raw exception text, stack traces and untranslated server messages are never shown); and **requires host** (shown by any screen or sheet that needs a connected host when none is connected: it names the feature, reads "Requires a host", and offers "Connect a host", which opens the pairing flow). The user-facing word is "host" in all four. No screen renders sample or placeholder data in place of real content. [NEW]

#### Scenario: Requires-host state
- **WHEN** the user opens Workflows with no host connected
- **THEN** the content area shows the requires-host state with a "Connect a host" action and no list

#### Scenario: Error message comes from the code
- **WHEN** a list request fails with the code `RATE_LIMITED`
- **THEN** the error state shows the `errors` string for `RATE_LIMITED` in the UI language and no raw exception text

#### Scenario: Unknown code
- **WHEN** a request fails with a code that has no string
- **THEN** the message reads "Something went wrong (<code>)" with the code inserted

#### Scenario: Error state details
- **WHEN** a list request fails and the user activates "Copy details"
- **THEN** the clipboard contains the error code, message, request name and timestamp, and no secret values

### Requirement: Avatar, badge and status pill
The Avatar SHALL be a circle for people and agents and a rounded square (radius 6) for hosts and projects, in sizes 16, 20, 24, 32 and 40 px, showing an image, a persona glyph or up to two initials in `avatar/text` on a deterministic fill chosen from `avatar/bg/1` … `avatar/bg/8` by hashing the entity id (the fills are the same in both themes and each gives the initials at least 4.5:1). The Badge is a 16 px pill (`type/caption`) for counts (values above 99 render "99+"; a neutral count is `bg/subtle` with `text/primary`, an attention count is `accent` with `text/on-accent`) and for the labels "New" (`success/subtle` fill, `success/text`) and "Built-in" (`bg/subtle`, `text/secondary`); no other badge label is defined by this capability. The dot badge is 6 px `accent`. The StatusPill is a 20 px pill with a 6 px leading dot or icon and a label, in six tones:

| Tone | Fill | Label and dot or icon colour | Dot or icon |
|---|---|---|---|
| neutral | `bg/subtle` | `text/secondary` | hollow dot |
| info | `accent/subtle` | `accent/text` | filled dot, animated while active |
| warning | `warning/subtle` | `warning/text` | triangle |
| success | `success/subtle` | `success/text` | check |
| danger | `danger/subtle` | `danger/text` | cross |
| purple | `purple/subtle` | `purple/text` | double check |

Every status shown anywhere in the product — jobs, sessions, agents, workflow nodes and runs, team runs, scripts, exports, hosts, devices, runtimes, skills, connections — maps to one tone by the table below, which is closed; owning capabilities supply only the label and the enum value.

| Tone | States that use it |
|---|---|
| neutral | queued, pending, ready to run, paused, cancelled, skipped, idle, draft, archived, stopped, disabled, unknown, parked, offline, signed out, not installed |
| info | running, working, starting, creating, syncing, rendering, connecting, repairing, updating |
| warning | needs approval, waiting for approval, needs input, waiting for a person, awaiting review, changes requested, stale, stalled, degraded, timed out, interrupted, blocked, outdated, orphaned, expired, pairing required, update required, sign-in required |
| success | succeeded, result ready, approved, connected, installed, up to date |
| danger | failed, error, rejected, revoked, lost |
| purple | completed, exported, merged |

"Ready" is never used bare: a thing waiting to be started is "ready to run" (neutral) and a thing whose result can be collected is "result ready" (success; for example the sidebar meta line "Export ready"). A finished session, run, script review or export record shown as history is "completed" / "exported" / "merged" (purple). A status value that an owning capability defines and that is not listed here is added to this table in the same change; a contract test enumerates every status enum of `packages/protocol` (job, session, agent, node, run, team run, script review, export, device, connection, supervisor, runtime, skill and automation status enums) and fails when a value has no tone in the generated mapping `statusTone`. A reason that a status carries is not a status and does not change the pill's tone: a skip reason (`no_route`, `no_renderer`, `branch_not_taken` and the others of `agent-workflows.Node state machine`) is shown as secondary text beside the neutral "skipped" pill; `retryPending` and a `blockedBy` value — including `waiting_gateway`, "Waiting for the agent engine" — are secondary text beside "ready to run"; a wait or pause reason (`stalled`, `waiting_gateway`, `budget_exceeded`) is secondary text beside the pill of its status; and an end reason (`parked_timeout`, `device_revoked`, `gateway_unavailable`, `time_limit`) is secondary text beside "cancelled" (neutral) or "failed" (danger). The one exception is drawn on the workflow canvas, where `workflow-diagram.Node run-status styles` gives the three pause values of `blockedBy` the warning colour on the node footer. An attempt that was interrupted is an entry of a node's attempt history, labelled "Interrupted" in `text/secondary`, and is not a node status. Status is never conveyed by colour alone: every pill has a text label or an accessible name, and the six tones use different dot or icon shapes. [NEW]

#### Scenario: Deterministic avatar
- **WHEN** the same host id renders an initials avatar on two devices
- **THEN** both show the same `avatar/bg/n` fill with `avatar/text` initials

#### Scenario: Count overflow
- **WHEN** an unread count is 128
- **THEN** the badge reads "99+" and its accessible label reads "128 unread"

#### Scenario: Workflow node waiting for approval
- **WHEN** a workflow node is `waiting_approval`
- **THEN** its pill uses the warning tone with a triangle and the label supplied by `agent-workflows`

#### Scenario: Timed-out run
- **WHEN** a team run has status `timed_out`
- **THEN** its pill uses the warning tone (`warning/subtle` fill, `warning/text` label)

#### Scenario: Unmapped status fails the build
- **WHEN** a capability adds the value `quarantined` to a status enum of the protocol package without adding it to the tone mapping
- **THEN** the contract test fails naming the enum and the value

#### Scenario: Tones differ without colour
- **WHEN** a failed pill and a succeeded pill are viewed in greyscale
- **THEN** they are distinguishable by their cross and check icons and by their labels

#### Scenario: Reason does not change the tone
- **WHEN** a workflow node is `skipped` with reason `no_route`, another is `ready` with `blockedBy: "waiting_gateway"`, and a team run is `cancelled` with `endReason: "parked_timeout"`
- **THEN** the three pills use the neutral tone with the labels supplied by their owners, and each reason is shown as secondary text beside the pill

### Requirement: Keycap and shortcut hint
The Kbd component SHALL render a key or key combination as keycaps (`type/caption` in `text/primary`, `bg/subtle`, 1 px `border/hairline`, radius 4, 18 px tall, minimum 18 px wide) using platform labels: ⌘ ⌥ ⇧ ⌃ on macOS and iOS, "Ctrl", "Alt", "Shift" elsewhere, arrows as ← → ↑ ↓, and named keys localised. Chords are shown with a thin space between keycaps on macOS and " + " elsewhere. Shortcut hints in menus and tooltips read live from `keyboard-shortcuts.Active binding lookup` so that a rebound action shows its current binding, and show nothing when the action is unbound. [NEW]

#### Scenario: Rebound action updates the hint
- **WHEN** the user rebinds "Split" from Ctrl+B to Ctrl+K on Windows
- **THEN** the Split tooltip and menu item show "Ctrl + K" without restarting

#### Scenario: Unbound action
- **WHEN** an action has no binding
- **THEN** its menu row shows no key hint

### Requirement: Composer primitive
The Composer component SHALL be a card with radius 12, 1 px `border/hairline`, `elevation/1`, minimum width 320 px and maximum 460 px in centred layouts (full pane width when docked), containing: a banner slot at the top inside the same card (used for the no-host banner); a textarea that grows from 2 to 10 lines; an attachment-chip row; a control row at the bottom inline-start side (an optional target pill at the leading end, a mode pill select with icon and chevron, a "+" attach button, and further pills supplied by the caller — model, thinking, features, skills, Team mode, Autonomous — which collapse into a settings-sliders overflow button when the row is narrower than its content); and a bottom inline-end group (microphone icon button, circular 28 px send button that is `bg/subtle` with `text/tertiary` glyph when disabled and `strong` with `text/on-strong` glyph when enabled, with a split chevron for send options). While a run is active the send button becomes a stop button (square glyph). Focus draws a 2 px `border/control` border, not the accent ring. A pill for an unattended mode shows a `warning/icon` marker and the word of the mode. This capability owns only the component's anatomy and states; which pills exist, their options and all composer behaviour are owned by `chat-agent.Composer layout and controls`, and the Home placement by `app-shell-navigation.Home composer`. [NEW]

#### Scenario: Send button state
- **WHEN** the textarea is empty and no attachment is present
- **THEN** the send button is disabled with `bg/subtle` fill
- **AND** typing one non-whitespace character makes it `strong` and enabled

#### Scenario: Stop replaces send
- **WHEN** a run is active in the session the composer belongs to
- **THEN** the send button shows the stop glyph and its accessible name is "Stop"

#### Scenario: Control row overflow
- **WHEN** the composer is 320 px wide and the caller supplies six pills
- **THEN** the mode pill and "+" stay visible and the pills that do not fit are reachable from the overflow button

### Requirement: Resizable panels and splitters
The PanelGroup component SHALL lay out panels horizontally or vertically with draggable splitters that have a 1 px visible hairline and an 8 px hit area (16 px on touch), show `accent` at 2 px on hover, drag and keyboard focus, and enforce each panel's minimum and maximum size in percent or pixels. Splitters are focusable; Left/Right or Up/Down move by 1% and Shift+arrow by 5%; Home/End move to the minimum and maximum; Enter toggles collapse of the adjacent collapsible panel; double-click resets the splitter to the layout default. Sizes are reported on release for persistence. Collapsed panels leave a 0 px footprint and are restored by their toggle control to the size held before collapse. [PORT SH-001, SH-002] [NEW]

#### Scenario: Limits enforced
- **WHEN** the user drags a splitter beyond a panel's minimum
- **THEN** the panel stays at its minimum and the splitter stops

#### Scenario: Keyboard resize
- **WHEN** a splitter has focus and the user presses Shift+Right twice
- **THEN** the left panel grows by 10% of the group, within its limits

#### Scenario: Double-click reset
- **WHEN** the user double-clicks a splitter
- **THEN** the two adjacent panels return to their default sizes

### Requirement: Timeline atoms
The design system SHALL provide the following timeline primitives, styled only with tokens, for use by `timeline-editing` and `mobile-editor`. Ownership is split: this requirement owns appearance (colour tokens, stroke widths, opacity, shapes, states); `timeline-editing.Track header column and row dimensions`, `timeline-editing.Ruler and timecode`, `timeline-editing.Playhead and seeking` and `timeline-editing.Markers` own the geometry that behaviour depends on (row heights, row gap, header width, ruler and marker-row heights, marker flag size, playhead line and handle size) on desktop and web; `mobile-editor.Touch gesture constants` owns every touch dimension and threshold (trim-handle width and hit target, transition-slot size, long-press, snap and auto-scroll values), and the mobile lane heights are those of `timeline-editing.Track header column and row dimensions`. The atoms take those dimensions as inputs and state none of them here.
- **Ruler**: major ticks 8 px, minor ticks 4 px, labels `type/caption` `timeline/ruler-text`, tick spacing never below 6 px.
- **Playhead**: line and handle in `timeline/playhead`.
- **Track header**: name (inline-renamable) and icon toggles hide, lock, mute with `icon/md` glyphs.
- **Clip**: radius 4, fill by `clip/*` token, 4 px inset label (`type/caption`, `clip/label`) drawn directly on the fill where the clip shows a flat fill and on a `clip/label-scrim` pill (radius 4, 2×4 px padding) wherever a filmstrip or waveform lies under it — the pill is mandatory in both themes, and every badge of the clip follows the same rule; states rest, hover (1 px `timeline/selection` at 50%), selected (2 px `timeline/selection` outline plus trim handles in `timeline/selection`), dragging (80% opacity, `elevation/2`), hidden (50% opacity), muted (waveform at 35% opacity), locked (hatch), offline media (diagonal `danger` stripe and a warning icon in `clip/label` on a `clip/label-scrim` pill), and badges for speed, duration, mute, link, keyframes and effects (14 px, inline-end aligned); a group marker (a 2 px `timeline/selection` bar along the top edge of every member of a group, at 60% opacity when the group is not selected); a provenance chip (16 px pill at the inline-start of the label row with a glyph for script, workflow or film origin, opaque `bg/elevated` with `text/secondary`, per `timeline-editing.Element provenance link`); and the transient "Trim adjusted" tag (a `type/caption` pill in `warning/subtle` with `warning/text`, anchored to the trimmed edge for 2 s and removed without animation under reduced motion).
- **Filmstrip and waveform**: thumbnails fill the clip height; waveform uses `waveform/fill` with `waveform/clip` tips, is drawn at 35% opacity while the clip or its track is muted (the one muted-waveform opacity, exposed to callers as the atom prop `muted`), and shows beat markers as 6 px dots in `waveform/beat`.
- **Keyframe diamond**: 8 px (12 px selected) `keyframe/fill` with a 1 px `clip/label` outline at all times (2 px when selected), so it reaches 3:1 on every clip fill.
- **Marker**: a flag filled with the marker's `marker/n` token and outlined with 1 px `timeline/selection`, and a 1 px line of the marker colour through the tracks.
- **Snap line**: 1 px `timeline/snap` across all tracks.
- **Transition handle**: a rounded square between adjacent clips showing a transition glyph when set and a "+" when empty.
- **Range bar**: `timeline/range` tint between in and out points with 2 px edge lines.
- **Drop indicator**: 2 px `accent` line for new-track insertion, `accent/subtle` ghost for placement, and the 2 px `timeline/selection` drop highlight on the receiving lane or clip (for example a sound dragged from the library, or media dropped onto a clip to replace it).
- **Zoom slider**: 96 px track in `border/control` with − and + buttons.
- **Transport**: play/pause at `control/md` (`control/touch` at compact-touch density), timecode in `type/mono`.

Acceptance is by catalogue: each atom has a catalogue entry in every listed state, in both themes, at the desktop dimensions of `timeline-editing` and the touch dimensions of `mobile-editor`. [NEW]

#### Scenario: Selected clip affordances
- **WHEN** a clip is selected on desktop
- **THEN** it shows a 2 px `timeline/selection` outline and two trim handles in `timeline/selection`

#### Scenario: Dimensions come from the owners
- **WHEN** the catalogue renders the timeline atoms for desktop
- **THEN** row, ruler, marker and playhead sizes equal the values of the `timeline-editing` requirements named above, and no size constant for them exists in `packages/ui`

#### Scenario: Offline media clip
- **WHEN** a clip's source media is missing
- **THEN** the clip shows the `danger` stripe and a warning icon and its accessible name includes "media offline"

#### Scenario: Clip label contrast gate
- **WHEN** the contrast test of `design-system.Contrast pair matrix` runs
- **THEN** `clip/label` reaches at least 4.5:1 on each of the eleven clip fills and on `clip/label-scrim` composited over a white frame, or the test fails naming the pair

#### Scenario: Catalogue snapshot
- **WHEN** the visual-regression test renders every timeline atom in every listed state
- **THEN** each snapshot differs from its baseline by at most 0.1% of pixels, or the gate fails naming the atom and state

### Requirement: Component state coverage and catalogue
Every component in `packages/ui` SHALL implement and document the states rest, hover, pressed, focus-visible, disabled and, where applicable, selected, loading, invalid and read-only, in both themes and both densities. The package SHALL contain every shared component named by any capability: Button, IconButton, ToggleButton, Input, Textarea, FormField, SearchField, Select, Combobox, SegmentedControl, Tabs, TabStrip, Switch, Checkbox, Radio, Slider, NumberField, ColorPicker, DateField, DateRangeField, TimeField, WeekdayPicker, Chip, Tag, FilterChip, TokenChip, AttachmentChip, ListRow, Card, GroupedSettingCard, Table, Tree, Disclosure, Breadcrumb, Tooltip, Popover, Menu, ContextMenu, AppMenu, Modal, SideSheet, BottomSheet, AdaptiveSheet, Drawer, Toast, Callout, Banner, ProgressBar, Spinner, StatusRing, Stepper, Skeleton, EmptyState, Avatar, Badge, StatusPill, Kbd, QRCode, MarkdownView, CodeBlock, Composer, PanelGroup, the timeline atoms and the four chart primitives (vertical bar, horizontal bar, line, Sparkline). Surfaces that are owned by a feature capability and built from tokens only — the workflow canvas and its nodes (`workflow-diagram`), the terminal emulator and the diff panel (`workspaces-terminal`), the script editor (`script-studio`) — are not components of this package; this capability supplies their tokens. A capability that needs a shared component that is not in this list adds it here first; a lint rule fails when `apps/app` defines a component whose name equals or ends with one of the listed names.

The package ships a component catalogue screen at the route `/_catalogue` (included in development and test builds, excluded from release builds; registered in `app-shell-navigation.Route map`) that renders every component in every state, and visual-regression snapshots of that catalogue are a CI gate with a pixel-difference threshold of 0.1%. Snapshots are taken in light and dark for three combinations of form factor and density (`design-system.Control size tokens and density rules`): 1,280 px wide with a fine pointer (desktop), 390 px wide with a coarse pointer (phone), and 1,024 px wide with a coarse pointer (tablet). Components are implemented once for React Native and react-native-web; platform-specific files (`.web`, `.native`, `.electron`) are used instead of runtime platform branches where implementations differ. [JAD] [NEW]

#### Scenario: Visual regression gate
- **WHEN** a change alters the rendering of the Button by more than 0.1% of pixels in any snapshot
- **THEN** the CI gate fails until the snapshot is reviewed and updated

#### Scenario: Catalogue excluded from release
- **WHEN** a release build is opened at `/_catalogue`
- **THEN** the not-found screen is shown

#### Scenario: Every listed component is in the catalogue
- **WHEN** the catalogue completeness test runs
- **THEN** each component of the list above has at least one catalogue entry per applicable state, or the test fails naming the component

#### Scenario: Tablet combination is rendered
- **WHEN** the visual-regression job runs
- **THEN** it produces snapshots at 1,024 px with a coarse pointer in both themes, in which menu rows are 44 px tall and the ⋯ button of a ListRow is visible without hover
