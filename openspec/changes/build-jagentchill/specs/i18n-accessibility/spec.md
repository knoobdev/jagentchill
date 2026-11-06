## ADDED Requirements

### Requirement: Supported locales and resources
The app SHALL ship complete UI translations for English (`en`), Vietnamese (`vi`) and Japanese (`ja`), using i18next with react-i18next and resources stored as typed modules under `apps/app/src/i18n/resources/<locale>/`, split into namespaces by product surface (`common`, `shell`, `editor`, `timeline`, `inspector`, `media`, `export`, `chat`, `agents`, `workflow`, `canvas`, `script`, `film`, `automations`, `workspace`, `terminal`, `skills`, `usage`, `settings`, `notifications`, `pairing`, `shortcuts`, `errors`). English is the source locale and the fallback. Every user-visible string in the app, the desktop shell (native menus, dialogs, tray, notifications) and Gateway-originated UI text (notification titles, error messages, job labels) comes from a resource key; a literal user-visible string in component code is a lint error. A CI parity test fails when any locale lacks a key present in `en`, has an extra key, or differs in interpolation variables or plural forms. Adding a locale requires only a new resource folder and an entry in the locale registry. [PORT N-010] [JAD]

#### Scenario: Key parity gate
- **WHEN** a key exists in `en/editor` and is missing in `ja/editor`
- **THEN** the parity test fails and names the key and locale

#### Scenario: Interpolation mismatch
- **WHEN** the English string uses `{{count}}` and `{{name}}` and the Vietnamese string omits `{{name}}`
- **THEN** the parity test fails

#### Scenario: Literal string in code
- **WHEN** a component renders the literal text "Export" instead of a translation key
- **THEN** the lint gate fails

### Requirement: Language selection
The language preference SHALL be `system` or one of the supported locale codes (default `system`). With `system`, the app picks the first of the OS's preferred languages that matches a supported locale by language code (so `vi-VN` selects `vi`, `ja-JP` selects `ja`, `en-GB` selects `en`), and falls back to `en` when none matches. Changing the language applies to all mounted screens, the desktop native menus, the tray menu and the document `lang` attribute within 500 ms without restarting and without losing navigation state, drafts or the open project. The chosen language is stored per device and is sent to the Gateway as the device locale so that host-originated notifications are rendered by the client in that language. [PORT N-010] [CAPCUT CC-279] [JAD]

#### Scenario: System language is Vietnamese
- **WHEN** the OS preferred language is `vi-VN` and the preference is `system`
- **THEN** the UI is shown in Vietnamese

#### Scenario: Unsupported system language
- **WHEN** the OS preferred languages are `fr-FR` and `de-DE` only
- **THEN** the UI is shown in English

#### Scenario: Live switch
- **WHEN** the user changes the language to Japanese while a project is open in the editor
- **THEN** all labels, tooltips and the desktop menu bar switch to Japanese within 500 ms and the project, selection and playhead are unchanged

### Requirement: Untranslated content
The app SHALL NOT translate or alter: user-authored content (project, track, clip, session, film and character names; text elements; captions; prompts), agent and model output, file names and paths, identifiers, log lines, code, timecodes, and proper names of providers and models. Text direction and language of such content are detected per element for rendering (`dir="auto"`), independent of the UI language. Translation of captions or scripts is a product feature specified by `captions-subtitles.Translate captions` and `script-studio.Multilingual scripts and translation hand-off`, not a function of the UI locale. Terminal output, file contents and workflow node names are user content in this sense. [JAD] [NEW]

#### Scenario: Agent output stays as produced
- **WHEN** the UI language is Japanese and the agent replies in English
- **THEN** the reply is shown in English exactly as produced, while the surrounding controls are Japanese

#### Scenario: Mixed-direction content
- **WHEN** a session title is written in Arabic and the UI is English
- **THEN** the title renders right-to-left within its row and the row layout stays left-to-right

### Requirement: Plurals, interpolation and grammar
Strings with counts SHALL use ICU-style plural categories resolved per locale (`one`/`other` for English; `other` only for Vietnamese and Japanese), never string concatenation or English-only "(s)" suffixes. Sentences are translated as whole strings with named placeholders so that word order can differ per locale; a string is never assembled from translated fragments. Placeholders that carry UI elements (links, bold text, token chips, keycaps) use tagged interpolation so that their position can move within the sentence. Lists are joined with `Intl.ListFormat`. Vietnamese strings keep their diacritics in every capitalised form produced by the UI (for example upper-cased section captions). [NEW]

#### Scenario: English plural
- **WHEN** 1 clip and then 3 clips are selected with the UI in English
- **THEN** the header reads "1 element selected" and then "3 elements selected"

#### Scenario: Japanese has no plural form
- **WHEN** 3 clips are selected with the UI in Japanese
- **THEN** the header uses the single Japanese form with the number 3 and no English plural marker

#### Scenario: Movable placeholder
- **WHEN** the string "Overridden in {{context}} by {{action}}" is rendered in Japanese
- **THEN** the placeholders appear in the order required by the Japanese translation

### Requirement: Locale-aware formatting
Numbers, percentages, currency, dates, times, relative times, durations, file sizes and lists SHALL be formatted with `Intl` APIs using the region format preference (default: the UI locale's region or the OS region). Rules: relative time for events under 7 days old ("5 minutes ago", "5 phút trước", "5分前") and absolute date beyond that; absolute dates in the locale's medium style with the user's 12/24-hour preference; file sizes in binary units with one decimal (KB, MB, GB meaning 1024-based) and a locale decimal separator; currency amounts in US dollars — the only currency of the product (`generation-providers.Budgets with hard stop`) — formatted for the region with 2 decimals, prefixed "≈" when estimated; durations as `m:ss` under one hour and `h:mm:ss` beyond in lists, and as words ("4.2 s", "1 min 20 s") in sentences. Timecodes and frame numbers in the editor are locale-independent: digits 0–9, `:` separators and `.` before milliseconds, per the timecode display preference. Numeric input fields accept both `.` and the locale's decimal separator and display the locale's separator, except in expression-capable number fields, which accept and display `.` only. All timestamps exchanged with the Gateway are Unix UTC milliseconds and are converted to the device time zone only for display. [NEW]

#### Scenario: Vietnamese number format
- **WHEN** the region format is `vi-VN` and a file is 1,536,000 bytes
- **THEN** its size is shown as "1,5 MB"

#### Scenario: Timecode is locale-independent
- **WHEN** the region format uses a comma as decimal separator
- **THEN** the editor timecode still reads `00:00:01.500` in milliseconds mode

#### Scenario: Relative versus absolute time
- **WHEN** a session was updated 3 hours ago and another 10 days ago
- **THEN** the first shows a relative time and the second an absolute date, each in the UI language

#### Scenario: Time zone conversion
- **WHEN** the host is in UTC and the device in UTC+7
- **THEN** an event stored as a UTC millisecond timestamp is displayed in the device's local time

### Requirement: Text expansion and CJK layout resilience
Layouts SHALL tolerate translated text up to 40% longer than English and CJK text without spaces: labels in buttons, tabs, menu rows and table headers never clip silently — they wrap where the component allows more than one line, or truncate with an ellipsis and expose the full text through a tooltip and the accessible name. Fixed-width controls are forbidden for text content; minimum widths are used instead. Line breaking uses the platform's rules for Japanese (no break before closing punctuation or small kana) and for Vietnamese (breaks at spaces only). Fonts follow `design-system.Typography tokens`, with the Japanese stack selected when the UI language is `ja` so that Han characters use Japanese glyph forms; on Linux desktops and in the web build, where no Japanese face is guaranteed, the bundled Noto Sans JP subset of that requirement is used, so the behaviour is the same on macOS, Windows, Linux, web, iOS and Android. A pseudo-locale `en-XA` (accented characters, text lengthened by 40%, bracketed) is available in development and test builds, and visual tests of the catalogue and the main screens run under it; any clipped or overlapping text fails the test. [NEW]

#### Scenario: Long label in a button
- **WHEN** the pseudo-locale lengthens a toolbar button label by 40%
- **THEN** the button grows to fit or the label truncates with an ellipsis and a tooltip, and no text overlaps a neighbouring control

#### Scenario: Japanese glyph forms
- **WHEN** the UI language is `ja`
- **THEN** Han characters render with a Japanese face rather than a Chinese-variant system font on every platform, including a Linux desktop with no Japanese system font, where the bundled subset is used and no missing-glyph box appears

### Requirement: Right-to-left readiness
Although no right-to-left locale ships, the UI SHALL be RTL-ready: all layout uses logical properties (`start`/`end`, `marginInlineStart`, `paddingInlineEnd`, row direction from the layout direction) and never physical left/right for inline-axis layout; directional icons (back, forward, chevrons, disclosure) mirror with the direction; the sidebar, drawers and side sheets attach to the inline-start or inline-end edge, and every gesture that opens or closes them is defined toward the inline-start or inline-end edge, never toward "left" or "right" (`app-shell-navigation.Mobile drawer and top bar`). The following are explicitly not mirrored in RTL: the timeline (time always increases to the right), the player, media transport controls, timecodes, waveforms, graph editors, sliders that represent time, and code blocks. A development pseudo-locale `ar-XB` forces RTL; a CI visual test runs the shell screens under it and fails on any element laid out with physical-direction styles outside the non-mirrored list. A lint rule rejects physical inline-direction style properties in shell components. [NEW]

#### Scenario: Shell mirrors under the RTL pseudo-locale
- **WHEN** the app runs under `ar-XB`
- **THEN** the sidebar is on the right, back chevrons point right, and text aligns to the right edge

#### Scenario: Timeline is not mirrored
- **WHEN** the editor runs under `ar-XB`
- **THEN** the timeline ruler still increases from left to right and the play button glyph is unchanged

### Requirement: Text input and IME support
Every text input, including the composer, inspector text fields and on-canvas text editing, SHALL support IME composition for Japanese and Vietnamese (Telex, VNI) input: during composition, Enter, Escape, Tab, arrow keys and all shortcuts apply to the IME only; the composing text is shown inline with the platform's composition underline; a field's value is committed, validated or sent only after `compositionend`; and character counters count the committed text in Unicode grapheme clusters, so that a Vietnamese letter with combining marks or an emoji sequence counts as one. Search and filtering are case-insensitive, diacritic-insensitive for Latin scripts (so "da nang" matches "Đà Nẵng") and width-insensitive for Japanese (full-width and half-width forms match; hiragana and katakana match each other). Sorting of names uses `Intl.Collator` for the UI locale with numeric ordering ("Clip 2" before "Clip 10"). [NEW]

#### Scenario: Confirming a Japanese candidate
- **WHEN** the user presses Enter to confirm a kana-kanji conversion in the composer
- **THEN** the conversion is confirmed and the message is not sent

#### Scenario: Vietnamese Telex in on-canvas text
- **WHEN** the user types "Vieejt" with Telex while editing a text element on the canvas
- **THEN** the element shows "Việt" and no editor shortcut fires for the typed letters

#### Scenario: Modified keys while typing
- **WHEN** the user presses Mod+B and then Mod+Shift+Left while the caret is in the editor agent panel's composer
- **THEN** no clip is split or nudged, because `keyboard-shortcuts.Dispatch and suppression rules` lets only text commands and the listed `allowInText` actions fire in a typable element

#### Scenario: AltGr characters
- **WHEN** a user with a German layout on Windows or Linux types AltGr+7 in the script editor, or a user with a Polish layout types AltGr+A in the composer
- **THEN** "{" or "ą" is inserted and no shortcut fires

#### Scenario: Grapheme counting
- **WHEN** the user types "ế" as a base letter with two combining marks into a field with a 40-character limit
- **THEN** the counter increases by 1

#### Scenario: Numeric sort
- **WHEN** media named "Clip 10", "Clip 2" and "Clip 1" are sorted by name
- **THEN** the order is Clip 1, Clip 2, Clip 10

### Requirement: Keyboard operability
All functionality SHALL be operable with a keyboard alone on desktop (macOS, Windows, Linux) and web and with a hardware keyboard on iOS, iPadOS and Android phones and tablets (key events reach the app through the native module named in `keyboard-shortcuts.Platform coverage of shortcuts`), without requiring specific timing. Tab and Shift+Tab move through interactive elements in visual reading order; composite widgets (toolbars, tab lists, menus, trees, grids, the sidebar lists, the timeline, the preview, the workflow canvas scene) are single tab stops with arrow-key navigation inside (roving tabindex). No keyboard trap exists: focus can always leave a component with Tab or Shift+Tab — including the preview and the workflow canvas, which never bind Tab — except inside modal overlays, which trap focus until closed, and inside a terminal, which is left with the escape actions `terminal.focus.leave`, `terminal.focus.next-pane` and `terminal.focus.previous-pane` (`workspaces-terminal.Terminal accessibility`). Because those three actions are the only non-pointer way out of a terminal, their default bindings on every OS and in every browser are combinations that neither the operating system, common Linux desktops nor the browser reserve (`keyboard-shortcuts.Default bindings for terminals`), they cannot be left unbound, and the terminal's status line names the current binding of `terminal.focus.leave`. Every pointer gesture has a keyboard equivalent: drag-and-drop reordering offers "Move up/down/to…" commands in the item's menu; splitters resize with arrow keys; sliders and number fields adjust with arrow keys; context menus open with Shift+F10 or the Menu key; hover-only controls also appear on focus and are permanently visible at compact-touch density (`design-system.Control size tokens and density rules`). A control that needs a host is enabled and focusable and opens the requires-host sheet (`design-system.Button`, `app-shell-navigation.Features that require a host`); it is never a disabled control whose reason is only in a tooltip. A "Skip to content" link is the first focusable element on web and desktop, and the actions `view.next-region` and `view.previous-region` cycle focus among the main regions (sidebar, top bar, content; in the editor: asset panel, player, inspector, timeline, agent panel when open; in a workspace: panes and explorer; in the script editor: navigator, script, inspector). Key bindings for every action named in this capability are defined only in `keyboard-shortcuts`. [NEW]

#### Scenario: Reorder without a pointer
- **WHEN** a keyboard user opens a sidebar row's menu and chooses "Move to folder ▸ Clients"
- **THEN** the row moves to that folder exactly as a drag would

#### Scenario: Region cycling in the editor
- **WHEN** focus is in the asset panel and the user invokes `view.next-region` three times
- **THEN** focus moves to the player, then the inspector, then the timeline

#### Scenario: Tab leaves the preview
- **WHEN** the preview has focus with an element selected and the user presses Tab
- **THEN** focus moves to the next region and is not trapped

#### Scenario: Leaving a terminal
- **WHEN** a terminal has focus and the user invokes `terminal.focus.leave`
- **THEN** focus moves to the terminal's tab

#### Scenario: Hover-only control
- **WHEN** a list row receives keyboard focus
- **THEN** its ⋯ button becomes visible and reachable with Tab

#### Scenario: Terminal escape on a stock Linux desktop
- **WHEN** a terminal has focus on a GNOME desktop with default system shortcuts and the user presses the default binding of `terminal.focus.leave`
- **THEN** the key reaches the app and focus moves to the terminal's tab

### Requirement: Keyboard access to the timeline and player
The timeline SHALL be a single tab stop exposing a two-dimensional keyboard model whose key bindings are defined only in `keyboard-shortcuts` and whose timeline behaviour is defined in `timeline-editing.Timeline accessibility and keyboard operation`: with focus in the timeline the user can move focus between tracks and between clips on a track (`selection.previous-clip`, `selection.next-clip`), toggle playback, open the focused clip's inspector tab with Enter, open its context menu with Shift+F10, and run the editing actions on the selection. Operations that are drag-based with a pointer SHALL have command equivalents reachable from the clip's context menu and the command palette: "Move to time…" (timecode field), "Move to track…", "Trim start to playhead", "Trim end to playhead", "Set duration…", "Add transition…". In the player, a selected element can be moved, scaled and rotated through the inspector's number fields, and while the preview has focus the `preview` context of `keyboard-shortcuts.Default bindings for timeline view and player` applies: the arrow keys nudge the selected element by 1 canvas px and Shift+arrow by 10 canvas px, `preview.select-previous` and `preview.select-next` cycle the selection, and Tab leaves the region (`preview-canvas.Preview keyboard access and accessibility`). Focus position in the timeline is shown by the focus ring on the clip or track header. [NEW]

#### Scenario: Move a clip by command
- **WHEN** a keyboard user focuses a clip, opens its context menu, chooses "Move to time…" and enters 00:00:10:00
- **THEN** the clip starts at 10 s subject to the same placement rules as a drag, in one undo step

#### Scenario: Trim by command
- **WHEN** the playhead is inside the focused clip and the user runs "Trim end to playhead"
- **THEN** the clip ends at the playhead

#### Scenario: Nudge in the player
- **WHEN** the preview has focus, an element is selected and the user presses Right five times within 500 ms
- **THEN** the element moves 5 canvas px to the right, the playhead does not move and one undo step is recorded

### Requirement: Keyboard and outline alternative for the workflow canvas
The workflow canvas is exposed to assistive technology as one composite element, whatever renderer draws it, so its accessibility SHALL be provided by two parallel structures owned by `workflow-diagram`, which this capability requires and does not redefine: full keyboard operation of the canvas — spatial focus movement, port and edge navigation, connecting ports, adding, moving and resizing without a pointer — per `workflow-diagram.Keyboard operation of the canvas`, with bindings from `keyboard-shortcuts.Default bindings for the workflow canvas`; and the outline view of `workflow-diagram.Outline view and screen-reader support`, a tree of the same nodes, groups and connections that exposes every node's name, type, status and connections to assistive technology and from which every canvas operation that changes the document can be performed. Contrast, colour independence and target sizes on the canvas follow `workflow-diagram.Contrast, colour independence and target sizes`, and run animations follow `workflow-diagram.Reduced-motion equivalents`. In run views the step list of `agent-workflows.Run view` mirrors the canvas for keyboard and screen-reader users. The release gate of `i18n-accessibility.Accessibility preferences and conformance target` includes building and running a three-node workflow using only the keyboard and a screen reader. [NEW]

#### Scenario: Build a workflow without a pointer
- **WHEN** a keyboard-only user adds two nodes with `canvas.quick-add`, connects them with `canvas.connect` and renames one with `canvas.rename`
- **THEN** the workflow document contains the two nodes, the edge and the new name, and no pointer event was needed

#### Scenario: Outline is equivalent
- **WHEN** a screen-reader user toggles the outline with `canvas.toggle-outline`
- **THEN** every node of the canvas is a tree item announcing its name, type, status and connections, and deleting an item in the outline deletes the node on the canvas

#### Scenario: Run status without the canvas
- **WHEN** a screen-reader user opens a running workflow's step list
- **THEN** each step's status change is announced through a polite live region without the user focusing the canvas

### Requirement: Focus visibility and management
Every focusable element SHALL show a visible focus indicator when focused by keyboard: a 2 px `accent` ring with a 2 px offset (inset where an offset would be clipped), with at least 3:1 contrast against adjacent colours in both themes. Focus is never placed on a hidden or disabled element. Opening an overlay moves focus into it (to the first field, or the least destructive action for confirmations); closing it returns focus to the element that opened it, or to the nearest logical element if that one no longer exists. After a route change focus moves to the new screen's main heading (which is programmatically focusable) and the screen title is announced. Deleting a focused item moves focus to the next item, or the previous one if it was last, or the list's empty-state action. Focus is not moved by background updates such as incoming messages or list refreshes. [NEW]

#### Scenario: Focus returns to the opener
- **WHEN** a modal opened from the "Add secret" button is closed
- **THEN** focus is on the "Add secret" button

#### Scenario: Delete the focused row
- **WHEN** the user deletes the focused third row of a five-row list
- **THEN** focus moves to the row that is now third

#### Scenario: Streaming does not steal focus
- **WHEN** agent output streams into the chat while the user is typing in the composer
- **THEN** focus and the caret stay in the composer

### Requirement: Screen reader semantics
The app SHALL expose correct roles, names, states and relationships to VoiceOver (macOS, iOS), TalkBack (Android), NVDA and JAWS (Windows) and Orca (Linux): landmarks for sidebar (`navigation`), top bar (`banner`), content (`main`) and the editor regions (labelled `region`s); headings with exactly one level-1 heading per screen and no skipped level; an accessible name for every control (icon-only controls from their label key, never from the icon file name); states such as selected, expanded, pressed, checked, busy, disabled and invalid; error messages associated with their fields; and tables, trees, tabs, menus, dialogs and comboboxes following the WAI-ARIA authoring patterns on web and the equivalent `accessibilityRole` / `accessibilityState` / `accessibilityActions` on native. Custom gestures on native are exposed as accessibility actions; a timeline clip offers exactly this list on every platform, and `mobile-editor.Mobile accessibility` references it: "Select", "Split at playhead", "Trim start to playhead", "Trim end to playhead", "Move backward in time", "Move forward in time", "Duplicate", "Delete". The reading order of the mobile editor's regions is the one listed in `mobile-editor.Mobile accessibility`. Decorative images and icons are hidden from assistive technology; thumbnails carry the item's name. An automated accessibility scan (axe-core for web and desktop routes in end-to-end tests; platform accessibility linters for native) runs in CI and fails on any violation of serious or critical impact. [NEW]

#### Scenario: Icon button name
- **WHEN** a screen reader focuses the timeline's snapping toggle
- **THEN** it announces "Auto snapping, toggle button, pressed" (in the UI language)

#### Scenario: Field error association
- **WHEN** a secret name fails validation
- **THEN** the screen reader announces the error text when the field is focused and the field is reported as invalid

#### Scenario: Automated scan gate
- **WHEN** an end-to-end run finds a serious axe violation on the Settings route
- **THEN** the CI gate fails and reports the rule and element

### Requirement: Accessible timeline and preview descriptions
Each timeline clip SHALL have an accessible name composed of its type, name, track, start time and duration, plus notable states — for example "Video clip, Beach.mp4, track V1, starts at 3.1 seconds, 4.2 seconds long, muted, 2 keyframes" — produced from localised templates. Track headers announce the track name, type, position ("track 2 of 5") and hidden, locked and muted states. The playhead position is exposed as a slider with a value text of the current timecode and total duration. The player region has a name and announces, on request through the command "Describe frame composition" (and through the screen reader's read-current-item gesture), the list of visible elements at the playhead in stacking order with their names and types. Markers, transitions and keyframes are reachable items with names ("Marker, red, at 12 seconds, Chorus"). Operations performed by keyboard or assistive actions announce their outcome ("Split. 2 clips.") through a polite live region. [NEW]

#### Scenario: Clip name
- **WHEN** a screen reader focuses a muted 4.2 s video clip named Beach.mp4 starting at 3.1 s on track V1
- **THEN** it announces the clip's type, name, track, start, duration and muted state

#### Scenario: Operation feedback
- **WHEN** the user splits a clip with the keyboard while a screen reader is running
- **THEN** "Split. 2 clips." is announced without moving focus

#### Scenario: Playhead as a slider
- **WHEN** the playhead control is focused and the user presses Right
- **THEN** the playhead advances one frame and the new timecode is announced

### Requirement: Live regions and status messages
Status changes SHALL be conveyed to assistive technology without moving focus: toasts and non-urgent status ("Saved", "Copied", "12 imported, 3 skipped") through a polite live region; errors, connection loss and requests that need a decision through an assertive live region; long-running progress announced at start, at each 25% step and on completion, and never more often than every 5 s. Streaming agent output is announced in completed sentences or blocks, at most once every 3 s, with a user command "Read latest response" to hear the full last message; token-by-token updates are not announced. Loading states set `aria-busy` on their region and announce "Loading" only when loading exceeds 1 s. [NEW]

#### Scenario: Progress announcements
- **WHEN** an export runs from 0% to 100% over two minutes
- **THEN** the screen reader hears the start, 25%, 50%, 75% and completion, and no other progress announcements

#### Scenario: Streaming output
- **WHEN** the agent streams a 200-word answer
- **THEN** announcements occur per completed sentence or block no more often than every 3 s, not per token

### Requirement: Colour contrast
Text and images of text SHALL have a contrast ratio of at least 4.5:1 against their background, at every size (the large-text relaxation of WCAG is not used, so one threshold covers all type tokens); user-interface component boundaries, icons that convey meaning, focus indicators and state indicators have at least 3:1 against adjacent colours; this holds in both themes for every token pairing the design system permits. The permitted pairings, their thresholds and their computed ratios are exactly the matrix of `design-system.Contrast pair matrix`; this capability and `design-system` therefore name the same pairs, and the contrast test of that requirement (`pnpm jagentchill:check:contrast`) is the gate. In particular: link and status text use the `/text` tokens and never a fill token; labels on `accent`, `danger` and `strong` fills use `text/on-accent`, `text/on-danger` and `text/on-strong`; the boundary of inputs, checkboxes, radios, switch tracks and slider tracks is `border/control`; placeholder text uses `text/placeholder`; `text/tertiary` is restricted to disabled content and decoration, which are exempt. Text over clip fills is drawn in `clip/label` directly on the fill (each clip fill gives at least 4.5:1) and, wherever a filmstrip, thumbnail, video or waveform lies under the text, on the mandatory `clip/label-scrim` pill, which gives at least 4.5:1 over any frame. The canvas and terminal palettes have their own gates in `design-system.Workflow canvas tokens` and `design-system.Terminal tokens`. Wherever the system reports `forced-colors: active` — Windows contrast themes, Linux desktop environments that impose a forced palette, and any browser with forced colours — the app honours the system high-contrast palette: borders and focus rings use system colours, custom backgrounds on controls are dropped, and state is indicated by borders, icons or text rather than fill. Where the system reports a preference for more contrast without a forced palette — "Increase contrast" on macOS, iOS and iPadOS, high-contrast text on Android, high-contrast themes on Linux — the preference below at "System" follows it. An app preference "Increase contrast" (System, On, Off; default System) switches `border/hairline` to `border/control`, `text/secondary` and `text/placeholder` to `text/primary`, adds the selected-row bar and the switch check glyph of `design-system`, and removes translucent fills; the contrast test runs for this mapping too. [NEW]

#### Scenario: Token pair gate
- **WHEN** a token change makes `text/secondary` on `bg/canvas` fall below 4.5:1 in either theme
- **THEN** the contrast test fails and names the pair, the theme and the ratio

#### Scenario: The two specs name the same pairs
- **WHEN** the contrast test loads its pair list
- **THEN** the list is generated from `design-system.Contrast pair matrix` and contains no pair defined elsewhere

#### Scenario: Primary button in the dark theme
- **WHEN** a primary button renders in the dark theme
- **THEN** its label reaches at least 4.5:1 on the `accent` fill (5.33:1 with the token values of `design-system.Colour tokens`)

#### Scenario: Forced colours
- **WHEN** a system forced-colours palette is active (for example a Windows contrast theme)
- **THEN** buttons, inputs and the selected sidebar row are distinguishable by system-colour borders and the focus ring uses the system highlight colour

#### Scenario: System asks for more contrast
- **WHEN** "Increase contrast" is turned on in the system settings of a Mac, an iPhone or an Android phone and the app preference is "System"
- **THEN** the app's increased-contrast mode is active on that device

#### Scenario: Label over a thumbnail
- **WHEN** a clip label is drawn over a bright filmstrip
- **THEN** the label sits on the `clip/label-scrim` pill and reaches at least 4.5:1 contrast

### Requirement: Colour independence
Information SHALL NOT be conveyed by colour alone. Status pills carry text and a tone-specific icon (`design-system.Avatar, badge and status pill`); the unread dot is accompanied by an accessible "unread" label and bold title weight; diff additions and deletions carry "+" and "−" gutter marks; clip types are distinguished by icon and label in addition to fill; selected state is shown by outline or check mark in addition to tint; invalid fields carry an icon and message; chart series are distinguishable by pattern or direct labels and have a table alternative; marker colours are paired with their colour names; workflow node types, ports and run states carry an icon or label in addition to their `wf/*` colour. The catalogue visual test SHALL additionally run under simulated protanopia, deuteranopia and tritanopia filters and assert, by comparing rendered shapes and text and not hue, that status pills of different tones, diff added and removed lines, selected and unselected rows and cards, and clips of different types remain distinguishable. [NEW]

#### Scenario: Unread row without colour
- **WHEN** the UI is viewed in greyscale
- **THEN** an unread row is still distinguishable by its bold title and dot shape, and a screen reader announces "unread"

#### Scenario: Colour-vision simulation gate
- **WHEN** a change makes the failed and succeeded status pills differ only by hue
- **THEN** the catalogue test under the deuteranopia filter fails and names the two pills

#### Scenario: Chart alternative
- **WHEN** a screen-reader user reaches the usage chart
- **THEN** a "View as table" control exposes the same data as a table

### Requirement: Reduced motion and flashing
When the OS reduce-motion setting is on, or the app preference is On, the app SHALL remove sliding, scaling, parallax and auto-scrolling animations, replace them with fades of at most 120 ms or instant changes, stop shimmer on skeletons and animated status dots, and disable smooth auto-scroll of the timeline during playback (page mode is used). Essential motion — video playback, the moving playhead, progress bars — continues. No UI element flashes more than 3 times per second. Auto-playing previews of effects, transitions and templates in the asset panel play only on hover or focus, loop for at most 5 s unless hovered, and do not auto-play at all under reduced motion, showing a static poster with a play control instead. [NEW]

#### Scenario: Reduced motion on
- **WHEN** reduce motion is on and the user opens the drawer on a phone
- **THEN** the drawer appears with a fade and no slide

#### Scenario: Effect previews under reduced motion
- **WHEN** reduce motion is on and the user hovers an effect thumbnail
- **THEN** the preview stays static until the user activates its play control

### Requirement: Text scaling and zoom
The UI SHALL keep all content and functions when text is enlarged: on web and desktop at browser or app zoom up to 200% (and UI scale up to 150%) without loss of content or function and without horizontal scrolling of pages at widths of 1280 px and above — in a browser the shell reflows to the medium or compact layout as the effective viewport narrows under browser zoom; in the desktop app the UI scale raises the minimum window size in proportion (`desktop-app.Windows and window state`), so the effective viewport of the desktop app never falls below 960 px and the desktop app never lands in the phone editor layout because of scaling; on iOS and Android, text follows the OS font-size setting (Dynamic Type, font scale) up to 200% in the shell, lists, chat, settings and sheets, while dense editor surfaces (timeline labels, ruler, toolbar captions) cap their scaling at 130% and remain fully available through accessible names. Text containers grow in height rather than truncating when scaled; rows have minimum heights, not fixed heights. Pinch-zoom of the page is not disabled on web outside the editor canvas and timeline, where pinch is the zoom gesture for those surfaces. [NEW]

#### Scenario: 200% zoom on web
- **WHEN** the browser zoom is 200% at a 1440 px window
- **THEN** the shell shows the compact or medium layout with all functions reachable and no clipped text

#### Scenario: Large OS font on a phone
- **WHEN** the OS font scale is 200%
- **THEN** settings rows grow taller with fully visible labels, and timeline clip labels are scaled by at most 130%

### Requirement: Touch target size and gesture alternatives
At compact-touch density (`design-system.Control size tokens and density rules`) every interactive element SHALL have a hit area of at least 44×44 pt on iOS and 44×44 dp on Android — one value on both systems, on phones and tablets, equal to `control/touch` and above the 24×24 CSS px that WCAG 2.2 AA (2.5.8) requires — including trim handles, keyframe diamonds, transition handles and track toggles (using expanded invisible hit areas where the glyph is smaller). Spacing rule: a target smaller than 44 in one dimension keeps at least 8 px between its hit area and the next one; contiguous full-size targets — list and menu rows, segments of a segmented control, toolbar buttons, tab-strip tabs — need no gap, because each already offers a 44 px extent. At regular density (fine pointer) every pointer target is at least 24×24 px or has 24 px of spacing to its neighbours. No capability states a different touch-target size; `mobile-editor.Touch gesture constants` uses the same 44 on both systems. Every multi-finger or path-based gesture has a single-pointer alternative: pinch-zoom of the timeline and player has + and − buttons; long-press-drag reordering has "Move" commands; swipe actions on rows have menu equivalents; canvas pinch and two-finger pan have toolbar zoom controls and the minimap; the drawer's drag has the top-bar button. Undo and redo on touch are buttons; no multi-finger tap gesture is used for them. Drag operations can be cancelled by dragging back to the origin or outside the drop area, and actions fire on pointer-up, not pointer-down, except for scrubbing and transport holds. Device-motion gestures are not used. [NEW]

#### Scenario: Small glyph, large target
- **WHEN** a keyframe diamond 12 px wide is rendered on a phone
- **THEN** tapping within 22 pt of its centre selects it, unless a nearer keyframe exists

#### Scenario: Same target on both mobile systems
- **WHEN** the same toolbar renders on an iPhone and on an Android phone
- **THEN** each button's hit area is 44×44 pt and 44×44 dp respectively and adjacent buttons touch without a gap

#### Scenario: Contiguous rows need no gap
- **WHEN** a menu renders at compact-touch density
- **THEN** its rows are 44 px tall and adjacent, and the target-size test passes

#### Scenario: Zoom without pinch
- **WHEN** a user cannot perform a pinch gesture
- **THEN** the timeline zoom + and − buttons provide the same zoom range

### Requirement: Media accessibility in the product UI
Videos and audio played inside the product UI (previews of templates and effects, generated clips in chat cards, tutorial media in starter tips) SHALL have visible play/pause controls, never auto-play with sound, expose their duration and name, and support keyboard control (Space play/pause, Left/Right seek 5 s, M mute) when focused. Generated videos in chat and workflow cards show their transcript or source prompt as text beside the player. Images in chat cards and library grids carry text alternatives from their name, prompt or description. Captions the user creates for their own videos are specified by `captions-subtitles`; the editor makes creating them reachable from the main toolbar on every platform. [NEW]

#### Scenario: No auto-play with sound
- **WHEN** a generated clip card appears in the chat
- **THEN** it does not play until activated, or plays muted with a visible unmute control when the user has hover previews enabled

#### Scenario: Image alternative
- **WHEN** a screen reader focuses a generated panel image in a film storyboard
- **THEN** it announces the panel number and its description text

### Requirement: Timing, session and error tolerance
No interaction SHALL depend on a time limit the user cannot extend, except security-driven limits (the validity of the pairing verification code defined by `device-pairing-signing.Six-digit verification code`, the edit lease of `cross-device-sync.Single-writer edit lease` and the approval prompt timeout of `generation-providers`), which show a visible countdown, announce when 60 s remain and can be restarted by requesting a new code or re-acquiring the lease without losing entered data. Toasts with actions stay at least 8 s (longer when the "Minimum toast duration" preference says so) and their actions remain available in the notification inbox. Content shown on hover or focus (tooltips, hover cards, the sidebar hover-reveal) is dismissable with Escape without moving focus, hoverable — the pointer can move onto it without it closing — and persistent until dismissed, per `design-system.Tooltip`. Destructive actions are reversible by undo or require confirmation. Error messages come from the `errors` namespace keyed by error code (`design-system.Empty, error and offline states`), name the problem and one way to resolve it, are not conveyed by colour or icon alone, and preserve the user's input. Form submission failures move focus to the first invalid field and present a summary when more than one field is invalid. [NEW]

#### Scenario: Pairing code countdown
- **WHEN** 60 s remain on a pairing verification code
- **THEN** the countdown is visible, the remaining time is announced to assistive technology and "Get a new code" is available

#### Scenario: Multi-field error
- **WHEN** a form is submitted with two invalid fields
- **THEN** a summary lists both, focus moves to the first invalid field and the valid fields keep their values

### Requirement: Accessibility preferences and conformance target
The Preferences page SHALL group accessibility settings in an **Accessibility** card, whose rows, defaults and storage are defined once by `settings-preferences.Accessibility preferences` and whose effects are defined here: Reduce motion (System, On, Off; default System), Increase contrast (System, On, Off; default System), Always show focus rings (default off; shows focus rings for pointer focus too), Underline links (default off), Announce agent output automatically (default on), Hover previews auto-play (default on), and Minimum toast duration (4, 8, 15 s, or Until dismissed; default 4 s for plain toasts). "Reduce motion" exists only in this card. The product's conformance target is WCAG 2.2 level AA for the shell, settings, chat, lists, the script editor, the workspace file and diff panels and all non-canvas editor controls on web and desktop, and the same WCAG 2.2 AA criteria applied to the native apps on iOS and Android, on phones and tablets. Drawn surfaces meet AA through parallel accessible structures: the player, timeline rendering and graph editor through `i18n-accessibility.Accessible timeline and preview descriptions` and `i18n-accessibility.Keyboard access to the timeline and player`; the workflow canvas through `i18n-accessibility.Keyboard and outline alternative for the workflow canvas`; and the terminal through `workspaces-terminal.Terminal accessibility`. A manual screen-reader pass covering create project, import, split, add text, export, pair a device, send a chat message, approve a request, write and submit a script for review, and build and run a three-node workflow, on VoiceOver (macOS and iOS), TalkBack (Android), NVDA (Windows) and Orca (Linux), is part of the release gate defined by `diagnostics-quality.Verify gate`. [NEW]

#### Scenario: Toast duration preference
- **WHEN** the minimum toast duration is "Until dismissed"
- **THEN** toasts remain until the user dismisses them or activates their action

#### Scenario: Release gate
- **WHEN** the screen-reader pass finds that export cannot be completed with VoiceOver
- **THEN** the release gate fails until the flow is completable

#### Scenario: Canvas flow in the gate
- **WHEN** the screen-reader pass cannot connect two workflow nodes with NVDA and the keyboard
- **THEN** the release gate fails
