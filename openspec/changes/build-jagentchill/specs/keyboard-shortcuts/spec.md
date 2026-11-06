## ADDED Requirements

### Requirement: Action registry
Every user-invocable command SHALL be declared once in an action registry with: a stable id made of dot-separated segments that matches `^[a-z][a-z0-9-]*(\.[a-z0-9][a-zA-Z0-9-]*)+$` — the first segment lower-case kebab-case, the following segments kebab-case or, where the registering capability spells them so, camel-case (for example `timeline.split`, `canvas.zoom-fit`, `terminal.focus.leave`, `agents.openTab`, `view.performanceOverlay`); a localised title; a category (`playback`, `navigation`, `editing`, `selection`, `timeline`, `player`, `tools`, `history`, `project`, `application`, `chat`, `agents`, `workflow`, `workspace`, `file`, `diff`, `review`, `terminal`, `script`, `film`); exactly one context from `keyboard-shortcuts.Shortcut contexts and precedence`; a flag `bindable` (false for actions that need arguments, for example `assets-panel.show`, which takes a tab id of `app-shell-navigation.Editor asset panel tabs`); zero or more default key bindings per platform family; an `isEnabled` predicate; and the flag `allowInText` (default false; true only for the actions listed in rule 5 of `keyboard-shortcuts.Dispatch and suppression rules`, which are allowed to fire while the user is typing). Keyboard shortcuts, toolbar buttons, menu items, native desktop menu items, the command palette and agent tools all invoke actions through the registry's `invoke(actionId, args, trigger)` function, where `trigger` is one of `keypress`, `mouseclick`, `menu`, `palette`, `agent`. Multiple handlers can subscribe to one action and all run in registration order. Invoking a disabled action is a no-op that returns `false` and shows no error.

This capability is the only place in the product where a default key binding is stated. Every other capability names action ids only; the binding tables of this capability list every bindable action id that another capability registers — a row per id, with "unbound" where the action has no default key — and a CI test SHALL fail when a registered bindable action is missing from these tables or a table row names an id no capability registers, when an action id written in any capability spec is absent from these tables, when two default bindings collide within one context on one platform family (macOS and iOS/iPadOS; Windows, Linux, ChromeOS and Android; and the web variants of each), and when a default binding of a family is in that family's **reserved set** — the combinations the operating system, the common desktop environments or the browser keep for themselves, listed in `keyboard-shortcuts.Rebinding by recording` — so that no default is a key the app never receives. Classic action ids (`split-selected`, `paste-copied`, `cancel-interaction` and the rest of the classic set) are mapped to the current ids by the migration of `keyboard-shortcuts.Persistence and migration of bindings`. No capability names an action by a classic spelling; an id written without a namespace (in an imported classic preset or by a caller of `registry.invoke`) is such a classic spelling and SHALL resolve to exactly one registry id through the same mapping table, whose entries include: `toggle-source-audio` → `audio.extract.toggle`, `toggle-elements-muted-selected` → `audio.mute.toggle`, `add-beat-marker` → `audio.beat.add`, `add-audio-crossfade` → `audio.crossfade.add`, and `remove-media-assets` → `media.remove-assets` (not bindable, because it acts on the library selection passed as an argument). `registry.invoke` accepts either spelling, and the shortcut settings, the cheat sheet and exported presets always show the registry id. [PORT KB-020, U-007] [NEW]

#### Scenario: One action, many triggers
- **WHEN** the user presses the binding of `timeline.split`, clicks the Split toolbar button, and chooses Split in the command palette on three identical timelines
- **THEN** each produces the same timeline result and one undo step

#### Scenario: Disabled action
- **WHEN** the binding of `timeline.split` is pressed while no element is under the playhead and nothing is selected
- **THEN** nothing changes, no undo step is recorded and no error is shown

#### Scenario: Non-bindable action
- **WHEN** the shortcut settings list is rendered
- **THEN** actions with `bindable: false` (for example `media.remove-assets` and `assets-panel.show`) are not listed

#### Scenario: Classic spelling resolves
- **WHEN** a toolbar button invokes `toggle-source-audio`
- **THEN** the action `audio.extract.toggle` runs once, and the tooltip shows the binding of `audio.extract.toggle`

#### Scenario: Default collision is rejected in CI
- **WHEN** a change gives two actions of the `editor` context the same default combination on macOS
- **THEN** the binding-table CI test fails and names both action ids

#### Scenario: Default on a reserved key is rejected in CI
- **WHEN** a change gives an action the default `Ctrl+Alt+Left` on Windows / Linux, which common Linux desktops use for workspace switching
- **THEN** the binding-table CI test fails and names the action and the reserved combination

### Requirement: Platform modifier mapping
In all binding tables `Mod` SHALL mean Command (⌘) on macOS and iOS/iPadOS and Control on Windows, Linux, ChromeOS and Android; `Alt` means Option (⌥) on Apple platforms. The platform family is decided once at startup from the OS reported by the runtime (Electron `process.platform`, React Native `Platform.OS`, or the browser's user-agent data), not from the keyboard layout. Key labels shown anywhere in the UI use the platform's symbols as defined in `design-system.Keycap and shortcut hint`. [PORT KB-028]

#### Scenario: macOS
- **WHEN** the app runs on macOS and the user presses ⌘Z
- **THEN** Undo is invoked, and Ctrl+Z does not invoke Undo

#### Scenario: Windows
- **WHEN** the app runs on Windows and the user presses Ctrl+Z
- **THEN** Undo is invoked and the Undo menu item shows "Ctrl + Z"

### Requirement: Key grammar and physical-key mapping
A binding SHALL be a string of zero or more modifiers in the fixed order `ctrl` (meaning `Mod`), `meta` (the other of Control/Command on that platform), `alt`, `shift`, joined by `+`, followed by exactly one key. Supported keys: `a`–`z`, `0`–`9`, `f1`–`f12`, `up`, `down`, `left`, `right`, `enter`, `tab`, `space`, `escape`, `backspace`, `delete`, `home`, `end`, `pageup`, `pagedown`, and the punctuation keys `-`, `=`, `[`, `]`, `\`, `;`, `'`, `,`, `.`, `/`, `` ` ``. Letter, digit and punctuation keys are matched by physical position (`KeyboardEvent.code`, or the hardware key code on native), so a binding shown as `Q` fires from the key in the QWERTY Q position on AZERTY, QWERTZ, Dvorak and non-Latin layouts; named keys are matched by logical key. The key label displayed for a physical key is the character that key produces on the user's active layout where the platform exposes a layout map, and the QWERTY label otherwise. `esc` is accepted as an alias of `escape` on import. Chords (key sequences) are not supported; a binding is a single combination. [PORT KB-027] [NEW]

#### Scenario: AZERTY layout
- **WHEN** an AZERTY user presses the key in the QWERTY "Q" position (labelled "A")
- **THEN** `timeline.delete-left` ("Delete left of playhead") is invoked
- **AND** on browsers that expose a keyboard layout map the shortcut list shows the label "A" for that binding

#### Scenario: Punctuation and function keys are bindable
- **WHEN** the user records `F5` or `Mod+]` for an action
- **THEN** the binding is accepted and fires

#### Scenario: Modifier-only press
- **WHEN** the user presses only Shift while recording
- **THEN** recording continues and no binding is stored

### Requirement: Shortcut contexts and precedence
Each action SHALL belong to exactly one of these contexts, and a binding is active only while its context is active:

| Context | Active while | Kind |
|---|---|---|
| `global` | always | — |
| `list` | a navigable list, tree or grid of the shell has keyboard focus (Film Studio card grids are not `list` contexts: their keys are the `film.item.*` rows of the `film` context) | focus |
| `editor` | a video editor screen is the foreground screen | screen |
| `session` | a session view is the foreground screen, or focus is inside a session pane hosted by another screen (the editor agent panel, a film or run chat pane) | screen |
| `workspace` | a workspace screen is the foreground screen | screen |
| `film` | a Film Studio film screen is the foreground screen | screen |
| `preview` | focus is inside the editor's preview region and an element is selected | focus, inside `editor` |
| `canvas` | focus is inside a workflow canvas scene or its toolbar and no text field has focus | focus |
| `file` | focus is inside a file tree or a file editor of a workspace | focus, editable |
| `diff` | focus is inside a diff panel | focus |
| `review` | focus is inside a review surface (a script review, a proposal's change list, a diff review thread) | focus |
| `terminal` | a terminal has keyboard focus | focus, editable |
| `script` | focus is inside the script editor | focus, editable |
| `composer` | focus is inside a chat composer | focus, editable |

When one combination is bound in more than one active context, the binding of the most specific context wins, in this order: `terminal`; then the other focus contexts (`composer`, `preview`, `canvas`, `file`, `diff`, `review`, `script`, `list`); then the screen context of the foreground screen (`editor`, `session`, `workspace`, `film`), where the `session` context of a pane hosted by another screen ranks above that screen's own context while focus is inside the pane; then `global`. A binding of a more specific context shadows a less specific one only while its own action is enabled; when the more specific action is disabled the less specific action runs. Two actions in the same context SHALL NOT share a combination on the same platform family. While a terminal has focus, the app SHALL intercept only the bindings of the six `terminal`-context actions of `keyboard-shortcuts.Default bindings for terminals` — the three `terminal.focus.*` escape actions and the terminal's own copy, paste and find — and the binding of the command-palette action `palette.open`, plus combinations the operating system or browser reserves and never delivers to the app; every other key event, including every other `global`, screen-context and `workspace` binding, is delivered to the terminal program (`workspaces-terminal` owns this rule and this capability follows it). The shortcut settings UI shows the context of each action and marks a binding that is shadowed in a more specific context with the note "Overridden in <context> by <action>". [NEW]

#### Scenario: The foreground screen context decides
- **WHEN** a session is in the foreground and the user presses `Mod+Shift+\`, bound to both `session.workspace.toggle` (`session`) and — in the editor — `editor.inspector.toggle` (`editor`)
- **THEN** the session workspace pane toggles and no editor action runs

#### Scenario: Focus mode has its own key everywhere
- **WHEN** the user presses the binding of `view.focus-mode` in the editor, in a session and in a workspace
- **THEN** focus mode toggles in each, the player does not enter fullscreen and "Search in files" does not open

#### Scenario: Disabled foreground action lets the global action run
- **WHEN** a foreground-context action that shares a combination with a `global` action is disabled and the user presses that combination
- **THEN** the `global` action runs

#### Scenario: Global outside the editor
- **WHEN** the Projects screen is in the foreground and the user presses the binding of `app.settings`
- **THEN** Settings opens

#### Scenario: Canvas focus wins over the screen context
- **WHEN** a workflow canvas embedded in a session has focus and the user presses `Mod+F`
- **THEN** `canvas.find` runs and `chat.find` does not

#### Scenario: Terminal passes other keys through and keeps the palette
- **WHEN** a terminal has focus and the user presses `Mod+B`, which no `terminal` action binds, and then the binding of `palette.open`
- **THEN** the first key press is delivered to the terminal and no workspace, editor or global action fires, and the second opens the command palette and sends nothing to the terminal

### Requirement: Dispatch and suppression rules
Shortcuts SHALL be handled by a single capturing key-down listener per window — the renderer's dispatcher — which is the **only** handler of key presses while a window's content has focus: native menu items show hints but register no accelerator for them (`desktop-app.Native application menu`), so no key is consumed by a menu before the rules below have been applied. On iOS, iPadOS and Android the dispatcher receives hardware-key events from the native module of `keyboard-shortcuts.Platform coverage of shortcuts`. A matching binding invokes its action and prevents the default browser or OS handling. Shortcuts are suppressed:

1. while any overlay registered with the overlay stack (modal, sheet, menu, popover, command palette, the application menu) is open, except bindings declared by that overlay;
2. while a project is loading, migrating or exiting;
3. while a binding is being recorded;
4. while an IME composition is in progress, and for any key-down that is text entry through AltGr: an event whose `getModifierState("AltGraph")` is true, or whose Ctrl+Alt combination (how Windows and many X11 and Wayland layouts deliver AltGr) produces a printable character on the active layout while the event target is typable, is **never** a shortcut and is left to the text field — so "ą", "@", "{", "€" and "µ" can be typed on Polish, Spanish, German and other layouts in every editable surface;
5. when the event target is a typable element (input, textarea, contenteditable, on-canvas text editing, a native text input on mobile): Escape blurs the element; every single-key, Shift-only and Alt-only binding is ignored; the **text commands** always keep their text meaning and never run an action — `Mod+A/C/X/V/Z/Y`, `Mod+Shift+Z`, `Mod+B/I/U`, `Mod+Left/Right`, `Mod+Shift+Left/Right`, `Mod+Up/Down`, `Mod+Shift+Up/Down`, `Mod+Backspace`, `Mod+Delete`, `Alt+Left/Right`, `Alt+Shift+Left/Right`, `Alt+Backspace`, `Alt+Delete`, and on Windows and Linux `Ctrl+Home/End`; of the remaining bindings only three groups fire: (a) the bindings of that surface's own editable context (`script`, `file`, `terminal`, `composer`), which are evaluated first and fire with any modifier set; (b) `global`-context bindings that include `Mod`; and (c) screen-context actions flagged `allowInText`, which are exactly `chat.stop`, `chat.mode.cycle`, `chat.dictation.toggle`, `session.workspace.toggle`, `editor.agent-panel.toggle`, `editor.inspector.toggle`, `project.save-version`, `file.save` and `file.save-all`. Every other screen-context or focus-context binding — including every `editor` binding with `Mod`, such as `timeline.split`, `timeline.duplicate`, `timeline.group`, `transition.add-default`, `speed.panel.show`, `export.open` and the nudge actions — does nothing while the user is typing, wherever the text field is (the project-name field, an inspector field, on-canvas text, the editor agent panel's composer).

On mobile, an event consumed by a focused native text input is not forwarded to the dispatcher, which gives the same result as rule 5. Key repeat invokes only actions flagged `repeatable` (frame step, multi-frame step, nudge, zoom, volume step, canvas nudge and focus moves, script line moves); other actions fire once per physical press. `timeline.paste` runs only when the in-app editor clipboard holds an entry; otherwise the native paste event proceeds so that pasted media is imported. [PORT KB-026]

#### Scenario: Typing in a field
- **WHEN** focus is in the project-name input and the user types "s"
- **THEN** the letter is inserted and no timeline action fires

#### Scenario: Text selection keys do not move clips
- **WHEN** focus is in the project-name field with a clip selected and the user presses Mod+Shift+Left
- **THEN** text is selected to the start of the line and no clip is nudged

#### Scenario: Mod+B in the agent panel composer
- **WHEN** the caret is in the composer of the editor agent panel and the user presses Mod+B
- **THEN** no clip is split and `timeline.split` is not invoked

#### Scenario: An allowInText action still fires
- **WHEN** the caret is in the composer of a running session and the user presses the binding of `chat.stop`
- **THEN** the running agent is stopped

#### Scenario: AltGr in the script editor
- **WHEN** a user with a German layout on Windows presses AltGr+7 in a script line
- **THEN** "{" is inserted and the line kind does not change

#### Scenario: AltGr in the composer
- **WHEN** a user with a Polish layout on Linux presses AltGr+A in the composer
- **THEN** "ą" is inserted and `agents.openTab` does not run

#### Scenario: Overlay open
- **WHEN** the export dialog is open and the user presses Space
- **THEN** playback does not toggle

#### Scenario: Project loading
- **WHEN** a project is still loading and the user presses the binding of `timeline.split`
- **THEN** no action is invoked and nothing is queued for after the load

#### Scenario: Recording
- **WHEN** a binding slot is in recording mode and the user presses Space
- **THEN** Space becomes the candidate for that slot and playback does not toggle

#### Scenario: IME composition
- **WHEN** a Japanese IME composition is active in the composer and the user presses Enter to confirm the candidate
- **THEN** the composition is confirmed, the message is not sent and no shortcut fires

#### Scenario: Editable context binding
- **WHEN** the caret is in a script line and the user presses the binding of `script.move.up`, an Alt-only combination
- **THEN** the line moves up and no character is inserted

#### Scenario: Paste with empty editor clipboard
- **WHEN** the editor clipboard is empty, the system clipboard holds an image and the user presses Mod+V in the editor
- **THEN** the image is imported as media and no element paste occurs

#### Scenario: Held key
- **WHEN** the user holds Right for one second in the editor
- **THEN** the playhead keeps stepping frame by frame
- **AND** holding the binding of `timeline.split` for one second performs exactly one split

### Requirement: Default bindings for playback and navigation
The default preset SHALL bind the following in the `editor` context. In every binding table of this capability, "same" in the "Windows / Linux" cell means the binding is identical apart from the `Mod`/`Alt` mapping, and Android and ChromeOS use the Windows / Linux column and iOS/iPadOS the macOS column.

| Action id | Title | macOS | Windows / Linux |
|---|---|---|---|
| `playback.toggle` | Play / pause | Space | same |
| `playback.shuttle-reverse` | Shuttle reverse | J | same |
| `playback.shuttle-stop` | Shuttle stop (pause) | K | same |
| `playback.shuttle-forward` | Shuttle forward | L | same |
| `playback.frame-previous`, `playback.frame-next` | Previous frame / next frame | ← / → | same |
| `playback.frames-back-10`, `playback.frames-forward-10` | Step 10 frames back / forward | ⇧← / ⇧→ | Shift+Left / Shift+Right |
| `playback.jump-back`, `playback.jump-forward` | Jump 5 s back / forward | ⌥← / ⌥→ | Alt+Left / Alt+Right |
| `playback.cut-previous`, `playback.cut-next` | Previous cut point / next cut point | ↑ / ↓ | same |
| `playback.go-start` | Go to first frame | Home | same |
| `playback.go-end` | Go to last frame | End | same |
| `range.set-in`, `range.set-out` | Set in point / set out point (`timeline-editing.In/out range`) | I / O | same |
| `range.set-to-selection` | Set range to selected clips | ⇧X | Shift+X |
| `range.clear` | Clear range | ⌥X | Alt+X |
| `playback.loop.toggle` | Toggle loop playback | ⌘L | Ctrl+L |
| `playback.stop` | Stop playback (pause and go to start) | unbound | unbound |
| `playback.seek-back-1s`, `playback.seek-forward-1s` | Seek back 1 s / forward 1 s | unbound | unbound |

Frame step moves by `round(120000 × denominator / numerator)` ticks of the project frame rate; every seek clamps to `[0, duration]`. A cut point is any element start or end on any unlocked visible track. Shuttle speeds, shuttle audio and loop behaviour are defined by `preview-canvas.Playback rate and JKL shuttle` and `preview-canvas.Loop playback`. While the `preview` context is active the arrow keys run the nudge actions of `keyboard-shortcuts.Default bindings for timeline view and player` instead of frame steps. [PORT KB-001, KB-002, KB-003, KB-004, KB-005, KB-006, KB-007] [CAPCUT CC-272] [NEW]

#### Scenario: Shuttle keys invoke the shuttle actions
- **WHEN** playback is paused and the user presses L three times, then K
- **THEN** `playback.shuttle-forward` is invoked three times and `playback.shuttle-stop` once, and playback is paused at the current frame

#### Scenario: Frame step at 29.97 fps
- **WHEN** the project frame rate is 30000/1001 and the user presses →
- **THEN** the playhead advances by 4004 ticks

#### Scenario: Cut-point navigation
- **WHEN** clips end at 2.0 s and 5.0 s, the playhead is at 3.0 s and the user presses ↓
- **THEN** the playhead moves to 5.0 s

#### Scenario: Clamp at the end
- **WHEN** the playhead is 2 s before the end and the user presses Alt+Right
- **THEN** the playhead stops at the last frame

### Requirement: Default bindings for editing and history
The default preset SHALL bind the following in the `editor` context.

| Action id | Title | macOS | Windows / Linux |
|---|---|---|---|
| `timeline.split` | Split at playhead | ⌘B | Ctrl+B |
| `timeline.split-all` | Split all tracks at playhead | ⌘⇧B | Ctrl+Shift+B |
| `timeline.delete-left` | Delete left of playhead (split and remove left) | Q | same |
| `timeline.delete-right` | Delete right of playhead (split and remove right) | W | same |
| `timeline.delete` | Delete selection | Delete, Backspace | same |
| `timeline.ripple-delete` | Ripple delete selection | ⇧Delete | Shift+Delete |
| `timeline.copy` | Copy | ⌘C | Ctrl+C |
| `timeline.cut` | Cut | ⌘X | Ctrl+X |
| `timeline.paste` | Paste at playhead | ⌘V | Ctrl+V |
| `timeline.duplicate` | Duplicate | ⌘D | Ctrl+D |
| `edit.undo` | Undo | ⌘Z | Ctrl+Z |
| `edit.redo` | Redo | ⌘⇧Z, ⌘Y | Ctrl+Shift+Z, Ctrl+Y |
| `edit.copy-attributes` | Copy attributes (`color-adjustment.Copy and paste attributes`) | ⌘⌥C | Ctrl+Alt+C |
| `edit.paste-attributes` | Paste attributes… | ⌘⌥V | Ctrl+Alt+V |
| `timeline.group`, `timeline.ungroup` | Group / ungroup | ⌘G / ⌘⇧G | Ctrl+G / Ctrl+Shift+G |
| `timeline.compound.create`, `timeline.compound.dissolve` | Create compound clip / dissolve compound clip | ⌥G / ⌥⇧G | Alt+G / Alt+Shift+G |
| `timeline.compound.edit`, `timeline.compound.exit` | Edit the selected compound clip / leave the compound scene | unbound | unbound |
| `timeline.link`, `timeline.unlink` | Link video and audio / unlink | unbound | unbound |
| `audio.extract.toggle` | Extract audio / restore audio | ⌘⇧S | Ctrl+Shift+S |
| `timeline.activate.toggle` | Activate / deactivate selected clips | V | same |
| `timeline.toggle-hidden` | Hide / show selected clips | ⇧H | Shift+H |
| `audio.mute.toggle` | Mute / unmute selected clips | ⌘⇧M | Ctrl+Shift+M |
| `audio.volume-up`, `audio.volume-down` | Clip volume +0.1 dB / −0.1 dB | ⌘⇧. / ⌘⇧, | Ctrl+Shift+. / Ctrl+Shift+, |
| `audio.beat.add` | Add a beat marker at the playhead, also while playing (`audio-editing.Beat markers on audio`) | ⌥B | Alt+B |
| `audio.crossfade.add` | Add a crossfade at the audio cut nearest the playhead (`audio-editing`) | unbound | unbound |
| `speed.panel.show` | Show speed panel | ⌘R | Ctrl+R |
| `speed.curve.show` | Show curve speed | ⇧B | Shift+B |
| `keyframe.panel.toggle` | Show / hide keyframe panel | ⌥K | Alt+K |
| `keyframe.toggle` | Toggle keyframe at playhead for the focused property | ⌥⇧K | Alt+Shift+K |
| `keyframe.previous`, `keyframe.next` | Previous keyframe / next keyframe | ⌥[ / ⌥] | Alt+[ / Alt+] |
| `timeline.nudge-left`, `timeline.nudge-right` | Nudge selection 1 frame left / right | ⌘← / ⌘→ | Ctrl+Left / Ctrl+Right |
| `timeline.nudge-left-10`, `timeline.nudge-right-10` | Nudge selection 10 frames left / right | ⌘⇧← / ⌘⇧→ | Ctrl+Shift+Left / Ctrl+Shift+Right |
| `timeline.trim-start-to-playhead`, `timeline.trim-end-to-playhead` | Trim the selected element's start / end to the playhead | ⌥Q / ⌥W | Alt+Q / Alt+W |
| `timeline.move-track-up`, `timeline.move-track-down` | Move the selected element to the track above / below | ⌥↑ / ⌥↓ | Alt+Up / Alt+Down |
| `timeline.track.move-up`, `timeline.track.move-down` | Move the focused track up / down within its zone | ⌥⇧↑ / ⌥⇧↓ | Alt+Shift+Up / Alt+Shift+Down |
| `timeline.track.rename` | Rename the focused track | F2, Return | F2 |
| `timeline.track.add` | Add a track (opens the track-type menu) | unbound | unbound |
| `timeline.track.delete` | Delete the focused track | unbound | unbound |
| `timeline.track.hide.toggle`, `timeline.track.mute.toggle`, `timeline.track.solo.toggle` | Hide / mute / solo the focused track | unbound | unbound |
| `timeline.replace-media` | Replace the media of the selected clip… (`timeline-editing`) | unbound | unbound |
| `timeline.multicam.create`, `timeline.multicam.flatten` | Create a multi-camera clip from the selection / flatten the selected multi-camera clip | unbound | unbound |
| `timeline.multicam.switch-angle-1` … `timeline.multicam.switch-angle-8` | Switch the multi-camera clip under the playhead to angle 1 … 8 (cuts while playing); enabled only while a multi-camera clip is under the playhead or its viewer is open | 1 … 8 | same |
| `timeline.to-overlay`, `timeline.to-main` | Move the selected clip to an overlay track / to the main track | unbound | unbound |
| `timeline.split-scenes` | Split the selected clip at detected scene cuts | unbound | unbound |
| `timeline.scenes.open` | Open the Scenes sheet | unbound | unbound |
| `timeline.select-mode` | Enter multi-selection mode (touch) | unbound | unbound |
| `timeline.background.edit` | Edit the canvas background of the main-track clip under the playhead | unbound | unbound |
| `text.add` | Add text at playhead | T | same |
| `transition.add-default` | Add the default transition at the nearest cut | ⌘T | Ctrl+T (web: Alt+T) |
| `color.scopes.toggle` | Show / hide colour scopes | ⇧S | Shift+S |
| `color.compare-hold` | Compare with the original while held (`color-adjustment.Before and after compare`) | \ | same |
| `graph.fit` | Fit the keyframe graph to the visible keys (`keyframe-animation`) | ⇧F | Shift+F |
| `brush.size-decrease`, `brush.size-increase` | Cutout brush smaller / larger by 5 px (`masks-blending-keying.Custom cutout`) | ⇧[ / ⇧] | Shift+[ / Shift+] |
| `library.toggle-favourite` | Toggle favourite on the focused effect, filter or transition tile | F | same |
| `timeline.ripple.toggle` | Toggle ripple editing | unbound | unbound |
| `timeline.toggle-free-layer` | Toggle Free layer (`timeline-editing.Free layer mode`) | unbound | unbound |
| `timeline.freeze`, `timeline.reverse`, `preview.mirror`, `preview.rotate-90`, `preview.crop` | Freeze frame, Reverse, Mirror, Rotate 90°, Crop | unbound | unbound |

**Deviation from CC-272, recorded:** the benchmark's clip-volume keys are `Mod+.` / `Mod+,`; this product binds `Mod+Shift+.` / `Mod+Shift+,` because `Mod+,` is the platform Settings key on every desktop OS and `Mod+.` cycles the composer mode. The benchmark keys are available as a one-click option "Use CapCut volume keys" on the Timeline tab of the shortcut settings, which adds `Mod+.` and `Mod+,` to `audio.volume-up` and `audio.volume-down` in the `editor` context (in the active user preset) with `isEnabled` limited to "an audio-bearing clip is selected", so that they shadow Settings and mode cycling only in that state; every other row of the benchmark's shortcut section is bound as the benchmark states. There is no action that closes main-track gaps: turning the magnet on (`timeline.magnet.toggle`) closes existing gaps at once (`timeline-editing`), as in the benchmark.

`timeline.split` targets the selected elements under the playhead, or every element under the playhead on unlocked tracks when nothing is selected. `timeline.delete` acts on the innermost active selection in the order mask points, keyframes, elements. Classic's single-key `S` for split is not a default because `S` toggles the preview axis in the benchmark set; it is available in the "OpenCut classic" preset. `Mod+,` is not bound in the `editor` context, so `app.settings` works in the editor. `edit.undo` and `edit.redo` are registered once and are active in every context that has an undo history (the editor, the workflow canvas, the script editor, Film Studio per `film-production`), acting on the history of the focused surface. `color.compare-hold` is a hold action: it is active from key-down to key-up and does not repeat. `library.toggle-favourite`, `graph.fit` and the two brush actions are enabled only while their surface (a library tile, the graph editor, the cutout brush editor) has focus. [PORT KB-008, KB-009, KB-010, KB-011, KB-012, KB-013, KB-017, KB-018, KB-019, KB-020, N-006] [CAPCUT CC-272] [NEW]

#### Scenario: Split with selection
- **WHEN** two overlapping clips lie under the playhead, only one is selected and the user presses Mod+B
- **THEN** only the selected clip is split

#### Scenario: Split all tracks
- **WHEN** three unlocked tracks and one locked track have clips under the playhead and the user presses Mod+Shift+B
- **THEN** the three clips on unlocked tracks are split, the locked clip is untouched and one undo step is recorded

#### Scenario: Redo alternatives
- **WHEN** the user has undone one change and presses Ctrl+Y on Windows
- **THEN** the change is re-applied, exactly as with Ctrl+Shift+Z

#### Scenario: Delete priority
- **WHEN** a keyframe is selected inside a selected clip and the user presses Delete
- **THEN** the keyframe is removed and the clip remains

#### Scenario: Settings opens from the editor
- **WHEN** the editor is in the foreground with an audio clip selected and the user presses Mod+,
- **THEN** Settings opens and the clip volume is unchanged

#### Scenario: Volume step
- **WHEN** an audio clip at 0.0 dB is selected and the user presses Mod+Shift+, twice
- **THEN** the clip volume is −0.2 dB

#### Scenario: CapCut volume keys option
- **WHEN** the user turns on "Use CapCut volume keys", selects an audio clip in the editor and presses Mod+,
- **THEN** the clip volume decreases by 0.1 dB and Settings does not open; with no audio-bearing clip selected the same keys open Settings

#### Scenario: Multi-camera angle keys
- **WHEN** a multi-camera clip is under the playhead during playback and the user presses 3
- **THEN** `timeline.multicam.switch-angle-3` cuts to angle 3 at the playhead, and with no multi-camera clip under the playhead the key does nothing

### Requirement: Default bindings for selection and tools
The default preset SHALL bind the following in the `editor` context.

| Action id | Title | macOS | Windows / Linux |
|---|---|---|---|
| `tools.select` | Select tool | A | same |
| `tools.blade` | Split (blade) tool | B | same |
| `timeline.cursor.select-left`, `timeline.cursor.select-right` | Cursor mode: select everything to the left / to the right (`timeline-editing.Cursor modes`) | unbound | unbound |
| `selection.all` | Select all | ⌘A | Ctrl+A |
| `selection.none` | Deselect all | ⌘⇧A | Ctrl+Shift+A |
| `selection.previous-clip`, `selection.next-clip` | Select previous clip / next clip on the track | [ / ] | same |
| `editor.cancel` | Cancel current interaction, then deselect one level, then leave focus mode | Escape | same |
| `timeline.magnet.toggle` | Toggle main track magnet | P | same |
| `timeline.snapping.toggle` | Toggle auto snapping | N | same |
| `timeline.linkage.toggle` | Toggle linkage | ` | same |
| `timeline.preview-axis.toggle` | Toggle preview axis | S | same |
| `marker.toggle` | Add marker at playhead (toggle) | M | same |
| `marker.add-next-color` | Add marker with next colour | ⌥M | Alt+M |
| `marker.next`, `marker.previous` | Next marker / previous marker | ⇧M / ⌥⇧M | Shift+M / Alt+Shift+M |
| `timeline.marker.edit` | Edit the selected marker (note, colour, duration) | unbound | unbound |
| `timeline.marker.delete`, `timeline.marker.delete-all` | Delete the selected marker / delete all markers of the scene | unbound | unbound |
| `timeline.track-lock.toggle` | Lock / unlock track of selection | ⌘⇧L | Ctrl+Shift+L |

`editor.cancel` is the only `editor` action bound to Escape. It acts on the first of these that applies: it exits player fullscreen when fullscreen is active; else it cancels an active drag, trim, draw or text edit; else it clears the innermost selection level (mask points, then keyframes, then elements); else, when nothing is selected and focus mode is on, it leaves focus mode. Escape therefore has one owner per context: `editor.cancel` in the editor, and the one `global` action `app.escape` of `keyboard-shortcuts.Default bindings for windows and the desktop application` elsewhere; overlays close on Escape through the overlay stack before any of them. With the blade tool active a click on a clip splits it at the pointer position; `tools.select` returns to the select tool. The user-facing term is "marker"; the stored field name is defined by `timeline-editing.Markers`. [PORT KB-014, KB-015, KB-016, KB-020] [CAPCUT CC-272] [NEW]

#### Scenario: Escape during a drag
- **WHEN** the user is dragging a clip and presses Escape
- **THEN** the drag is cancelled, the clip returns to its origin, the selection is kept and no undo step is recorded

#### Scenario: Escape in fullscreen
- **WHEN** the player is fullscreen with two clips selected and the user presses Escape
- **THEN** fullscreen ends and both clips stay selected

#### Scenario: Escape with nothing active
- **WHEN** two clips are selected, no interaction is active, the player is not fullscreen and the user presses Escape
- **THEN** the selection is cleared

#### Scenario: Marker toggle
- **WHEN** the playhead sits exactly on an existing marker and the user presses M
- **THEN** that marker is removed

#### Scenario: Next clip
- **WHEN** a clip is selected and the user presses ]
- **THEN** the next clip on the same track becomes the only selected element and the timeline scrolls it into view

#### Scenario: Escape leaves focus mode last
- **WHEN** focus mode is on in the editor with two clips selected and the user presses Escape twice
- **THEN** the first press clears the selection and the second leaves focus mode

### Requirement: Default bindings for timeline view and player
The default preset SHALL bind the following.

| Action id | Title | Context | macOS | Windows / Linux |
|---|---|---|---|---|
| `timeline.zoom-in`, `timeline.zoom-out` | Timeline zoom in / out | editor | ⌘= / ⌘- | Ctrl+= / Ctrl+- |
| `timeline.zoom-fit` | Timeline zoom to fit | editor | ⇧Z | Shift+Z |
| `player.zoom-in`, `player.zoom-out` | Player zoom in / out | editor | ⌥⇧= / ⌥⇧- | Alt+Shift+= / Alt+Shift+- |
| `player.zoom-fit` | Player zoom to fit | editor | ⌥⇧Z | Alt+Shift+Z |
| `player.fullscreen` | Player fullscreen (the only `editor` use of this combination; `file.search-in-files` uses it in the `workspace` context) | editor | ⌘⇧F | Ctrl+Shift+F |
| `player.snapshot` | Save preview snapshot | editor | unbound | unbound |
| `player.copy-snapshot` | Copy the current frame to the clipboard | editor | unbound | unbound |
| `player.zoom-100` | Player actual size (100%) | editor | unbound | unbound |
| `player.guides.toggle` | Show / hide preview guides (`preview-canvas.Guides popover`) | editor | unbound | unbound |
| `player.multicam-viewer.toggle` | Show / hide the multi-camera angle viewer (`preview-canvas.Multi-camera angle viewer`) | editor | unbound | unbound |
| `preview.flip-vertical` | Flip the selected element vertically | editor | unbound | unbound |
| `preview.nudge-left`, `preview.nudge-right`, `preview.nudge-up`, `preview.nudge-down` | Move the selected element 1 canvas px | preview | ← / → / ↑ / ↓ | same |
| `preview.nudge-far-left`, `preview.nudge-far-right`, `preview.nudge-far-up`, `preview.nudge-far-down` | Move the selected element 10 canvas px | preview | ⇧← / ⇧→ / ⇧↑ / ⇧↓ | Shift+arrow |
| `preview.edit-text` | Edit the selected text or caption in place (`preview-canvas.In-place text editing`) | preview | Enter | same |
| `preview.select-previous`, `preview.select-next` | Select the previous / next element at the playhead | preview | [ / ] | same |

Player fullscreen is left with `editor.cancel` (Escape) or by invoking `player.fullscreen` again. In the `preview` context Tab and Shift+Tab are not bound and move focus out of the preview region; each burst of nudge presses within 500 ms forms one undo step.

The following pointer and modifier behaviours are fixed and are listed in the cheat sheet under "Mouse and modifiers" without a rebinding control: `Mod`+wheel zooms the timeline around the pointer; Shift+wheel and Alt+wheel scroll the timeline horizontally (a bare Alt press and release never opens or focuses the application menu on Windows and Linux, `design-system.Application menu button`, so Alt-modified gestures are safe); `Mod`+wheel over the player zooms the player and plain wheel pans it when zoomed; `Mod`/Shift+click toggles an element in the selection; Shift, `Mod` or Ctrl makes a box selection additive; `Mod`+click toggles a keyframe and Shift+click selects a keyframe range; Shift+click on a property in the keyframe panel adds a keyframe; holding Shift during a timeline drag or trim disables timeline snapping (`timeline-editing.Snapping`); holding `Mod` during any gesture in the player — element move, scale, rotate, crop, mask and pen-point drags — disables canvas snapping, while Shift constrains the gesture (`preview-canvas.Preview snapping`); a focused playhead handle steps one frame with ←/→; a focused marker seeks with Enter or Space. [PORT KB-020] [CAPCUT CC-272] [NEW]

#### Scenario: Zoom to fit
- **WHEN** the user presses Shift+Z on a 3-minute timeline
- **THEN** the whole timeline duration fits the visible track width with the playhead position unchanged

#### Scenario: Nudge in the preview
- **WHEN** the preview region has focus, an element is selected and the user presses → five times within 500 ms
- **THEN** the element moves 5 canvas px to the right, the playhead does not move and one undo step is recorded

#### Scenario: Arrows without preview focus
- **WHEN** the timeline has focus and the user presses →
- **THEN** the playhead advances one frame and no element moves

#### Scenario: Tab leaves the preview
- **WHEN** the preview region has focus and the user presses Tab
- **THEN** focus moves to the next region and the selection is unchanged

#### Scenario: Snap override in the player
- **WHEN** the user drags a mask point in the player while holding Mod
- **THEN** no alignment guides appear and the point does not snap

#### Scenario: Fixed gestures are not rebindable
- **WHEN** the user opens the cheat sheet
- **THEN** "Mod + scroll: zoom timeline" is listed under "Mouse and modifiers" with no edit control

### Requirement: Default bindings for project, application, session and lists
The default preset SHALL bind the following. The "Web" column gives the default in the web build where it differs.

| Action id | Title | Context | macOS | Windows / Linux | Web |
|---|---|---|---|---|---|
| `project.new` | New project | global | ⌘N | Ctrl+N | Alt+N |
| `project.open` | Open project… | global | ⌘O | Ctrl+O | — |
| `media.import` | Import media | editor | ⌘I | Ctrl+I | — |
| `project.save-version` | Save now (flush autosave and create a manual snapshot per `project-storage.Version snapshots`) | editor | ⌘S | Ctrl+S | — |
| `export.open` | Export | editor | ⌘E | Ctrl+E | — |
| `project.close` | Close project (return to Projects) | editor | ⌘W | Ctrl+W | unbound |
| `palette.open` | Command palette | global | ⌘K | Ctrl+K | — |
| `help.shortcuts` | Keyboard shortcut cheat sheet | global | ⌘/ | Ctrl+/ | — |
| `app.settings` | Settings | global | ⌘, | Ctrl+, | — |
| `view.sidebar.toggle` | Toggle sidebar | global | ⌘\ | Ctrl+\ | — |
| `view.focus-mode` | Focus mode | global | ⌘⇧Y | Ctrl+Shift+Y | — |
| `view.next-region`, `view.previous-region` | Move focus to the next / previous main region | global | F6 / ⇧F6 | F6 / Shift+F6 | — |
| `nav.go.home`, `nav.go.projects`, `nav.go.sessions`, `nav.go.workflows`, `nav.go.film`, `nav.go.library`, `nav.go.scripts` | Go to the seven primary destinations in sidebar order (`app-shell-navigation.Primary navigation`): Home, Projects, Sessions, Workflows, Film Studio, Library, Scripts — digit n is sidebar row n | global | ⌘1 … ⌘7 | Ctrl+1 … Ctrl+7 | Ctrl+Alt+1 … Ctrl+Alt+7 (macOS: ⌃1 … ⌃7) |
| `nav.go.agents`, `nav.go.automations` | Go to Agents, Automations — the first two rows of the "More" group | global | ⌘8, ⌘9 | Ctrl+8, Ctrl+9 | Ctrl+Alt+8, Ctrl+Alt+9 (macOS: ⌃8, ⌃9) |
| `nav.go.workspaces`, `nav.go.skills`, `nav.go.usage`, `nav.go.devices`, `nav.go.exports`, `nav.go.notifications`, `nav.go.trash` | Go to Workspaces, Skills, Usage, Devices, Exports, Notifications, Trash | global | unbound | unbound | — |
| `nav.more.toggle` | Expand / collapse the "More" group of the sidebar | global | unbound | unbound | — |
| `session.new` | New session | global | ⌘⌥N | Ctrl+Alt+N | — |
| `app.fullscreen` | App fullscreen | global | ⌃⌘F | F11 | browser's own key |
| `chat.focus-composer` | Focus the composer of the foreground screen (opens the editor agent panel when collapsed) | global | ⌘J | Ctrl+J | — |
| `view.performanceOverlay` | Show / hide the render performance overlay (`diagnostics-quality.Performance instrumentation`) | global | ⌘⇧P | Ctrl+Shift+P | unbound |
| `editor.inspector.toggle` | Toggle inspector | editor | ⌘⇧\ | Ctrl+Shift+\ | — |
| `editor.agent-panel.toggle` | Toggle the editor agent panel | editor | ⌘⇧J | Ctrl+Shift+J | — |
| `session.workspace.toggle` | Toggle the session workspace pane | session | ⌘⇧\ | Ctrl+Shift+\ | — |
| `chat.stop` | Stop the running agent | session | ⌘⇧Backspace | Ctrl+Shift+Backspace | — |
| `chat.mode.cycle` | Cycle composer mode | session | ⌘. | Ctrl+. | — |
| `chat.dictation.toggle` | Start / stop dictation | session | ⌘⇧D | Ctrl+Shift+D | — |
| `chat.find` | Find in chat | session | ⌘F | Ctrl+F | — |
| `chat.attach-frame` | Attach the current frame to the chat | session | ⌘⌥F | Ctrl+Alt+F | — |
| `chat.attach-range` | Attach the in/out range to the chat | session | ⌘⌥R | Ctrl+Alt+R | — |
| `session.tab.next`, `session.tab.previous` | Next / previous workspace tab | session | ⌃Tab / ⌃⇧Tab | Ctrl+Tab / Ctrl+Shift+Tab | Ctrl+Shift+] / Ctrl+Shift+[ (macOS: ⌃⇧] / ⌃⇧[) |
| `session.access.share`, `session.access.make-private` | Share this session with the host / make it private again (`chat-agent` session access; sessions are private by default) | session | unbound | unbound | — |
| `session.send` | Send the message | composer | Enter | Enter | — |
| `session.newline` | Insert a newline | composer | ⇧Enter | Shift+Enter | — |
| `session.send-alternate` | Alternate send (`chat-agent.Steer, queue and interrupt while running`) | composer | ⌘Enter | Ctrl+Enter | — |
| `session.recall-previous` | Load the previous user message into an empty composer | composer | ↑ | Up | — |
| `proposal.accept` | Accept the focused proposal card | session | ⌘Enter | Ctrl+Enter | — |
| `proposal.reject` | Reject the focused proposal card | session | ⌘Backspace | Ctrl+Backspace | — |
| `approval.allow-once` | Allow the focused permission request once | session | ⌥Enter | Alt+Enter | — |
| `approval.deny` | Deny the focused permission request | session | ⌥Backspace | Alt+Backspace | — |
| `worklog.previous`, `worklog.next` | Worklog: previous / next step | session | , / . | same | — |
| `worklog.live` | Worklog: return to Live | session | / | same | — |
| `agents.openTab` | Open the Agents tab of the session | session | ⌘⌥A | Ctrl+Alt+A | — |
| `agents.toggleRoster` | Dock / undock the agent roster | session | ⌘⌥O | Ctrl+Alt+O | — |
| `agents.nextNeedsYou` | Go to the next item that needs you | session | ⌘⌥U | Ctrl+Alt+U | — |
| `agents.stopFocused`, `agents.stopAll`, `team.toggleArmed` | Stop the focused agent / stop all agents of the session / arm or disarm Team mode | session | unbound | unbound | — |
| `film.stage.1`, `film.stage.2`, `film.stage.3`, `film.stage.4`, `film.stage.5`, `film.stage.6`, `film.stage.7`, `film.stage.8` | Open film stage 1 … 8 in the order of `film-production.Studio navigation and stage tabs` | film | ⌥1 … ⌥8 | Alt+1 … Alt+8 | — |
| `film.item.open` | Open the focused card | film | Enter | Enter | — |
| `film.item.play` | Play the focused card's media | film | Space | Space | — |
| `film.item.generate`, `film.item.regenerate` | Generate / regenerate the focused item | film | G / ⇧G | G / Shift+G | — |
| `film.item.delete` | Delete the focused item | film | ⌘Backspace | Delete | — |
| `film.panel.move-up`, `film.panel.move-down` | Move the focused storyboard panel up / down | film | ⌥↑ / ⌥↓ | Alt+Up / Alt+Down | — |
| `film.panel.undo-image`, `film.panel.redo-image` | Previous / next image version of the focused panel | film | ⌥Z / ⌥⇧Z | Alt+Z / Alt+Shift+Z | — |
| `list.open` | Open the focused item | list | Enter | Enter | — |
| `list.rename` | Rename the focused item (on Mac keyboards whose function row controls hardware, F2 is pressed with Fn; Return is not a second default here because Enter is `list.open`) | list | F2 | F2 | — |
| `list.delete` | Move the focused items to trash / delete | list | ⌘Backspace | Delete | — |
| `list.toggle-select` | Add the focused item to, or remove it from, the selection | list | Space | Space | — |

`Mod+Shift+F` is Player fullscreen in the `editor` context and "Search in files" in the `workspace` context (`keyboard-shortcuts.Default bindings for workspaces, files, diffs and review`) and has no `global` meaning. Focus mode has its own combination, `Mod+Shift+Y`, which no other action uses in any context on any platform family, so it works identically in the editor, a session and a workspace; the binding-table CI test asserts this uniqueness. The four `composer` actions fire inside the composer's text field because `composer` is an editable context; the personal preference "Send key inserts a newline" (`settings-preferences.Composer and agent personal preferences`) swaps the bindings of `session.send` and `session.newline`, on a touch keyboard the return key always inserts a newline, and `session.recall-previous` is enabled only while the input is empty. `proposal.*` and `approval.*` are enabled only while their card has focus, and the three `worklog.*` actions only while the Worklog tab has focus (`chat-agent`). `agents.*` and `team.toggleArmed` are registered by `multi-agent-orchestration`; the stop actions have no default key because they end running work. The `film.item.*` and `film.panel.*` actions are registered by `film-production.Keyboard and accessibility in the studio` and act on the focused card.

On the web build, combinations that browsers reserve and do not deliver to pages MUST NOT be offered as defaults. The browser-reserved set, per OS, is: on every OS `Mod+N`, `Mod+T`, `Mod+W`, `Mod+Shift+N`, `Mod+Shift+T`, `Mod+Shift+W`, `Mod+Q`, `Ctrl+Tab`, `Ctrl+Shift+Tab`, `Ctrl+PageUp`, `Ctrl+PageDown` and `F11`; on Windows and Linux additionally `Mod+1` … `Mod+9`, `Alt+Left`, `Alt+Right`, `Alt+Home`, `Ctrl+Shift+P` (private window in Firefox), `Ctrl+Shift+Delete`, `F5`/`Ctrl+R` (reload — delivered, but never used as a default) and `F12`; on macOS additionally `⌘1` … `⌘9`, `⌘⇧]`, `⌘⇧[`, `⌘⌥→`, `⌘⌥←` (next and previous browser tab), `⌘[`, `⌘]` (back and forward), `⌘L`, `⌘⇧P`, `⌘⌥I` and `⌘M`. Where a desktop default is in this set, the "Web" column and the web notes of the other tables give the replacement. The composer's remaining keys (the mention popover keys and closing a popover with Escape) are fixed behaviour of `chat-agent.Composer keyboard behaviour` and `chat-agent.At-mentions`; they are listed in the cheat sheet's "Composer" group without a rebinding control. [CAPCUT CC-272] [NEW]

#### Scenario: Reserved browser key on web
- **WHEN** the web build's shortcut list is shown on Windows
- **THEN** `project.new` shows Alt + N and `nav.go.projects` shows Ctrl + Alt + 2
- **AND** attempting to record Ctrl+T for any action is rejected with the message "This combination is reserved by the browser"

#### Scenario: Navigation digits
- **WHEN** the user presses Mod+2 from any screen with no overlay open
- **THEN** the Projects screen is shown

#### Scenario: Film stage keys
- **WHEN** a film screen is in the foreground and the user presses Alt+4
- **THEN** the fourth stage tab (Storyboard) opens and the global `nav.go.workflows` (Mod+4) is not invoked

#### Scenario: Send and newline in the composer
- **WHEN** the composer has focus with text and the user presses Shift+Enter and then Enter
- **THEN** `session.newline` inserts a line break and `session.send` sends the message, although both are keys without `Mod` in a text field

#### Scenario: Swapped send key
- **WHEN** "Send key inserts a newline" is on and the user presses Enter in the composer
- **THEN** a line break is inserted and the message is not sent

#### Scenario: Proposal card keys
- **WHEN** a pending proposal card has focus in a session and the user presses Mod+Enter
- **THEN** `proposal.accept` runs and no message is sent

#### Scenario: Focus mode in the editor
- **WHEN** the editor is in the foreground and the user presses Mod+Shift+Y and then Mod+Shift+F
- **THEN** focus mode toggles on the first press and the player enters fullscreen on the second

#### Scenario: List keys are the same on every platform
- **WHEN** a project card has focus on macOS, Windows or Linux and the user presses Enter, then F2
- **THEN** Enter opens the project, and on returning to the list F2 starts renaming the focused project

#### Scenario: Focus composer from the editor
- **WHEN** the editor is in the foreground with the agent panel collapsed and the user presses Mod+J
- **THEN** the agent panel opens and its composer has focus

#### Scenario: Workspace tabs on the desktop app
- **WHEN** a session with three workspace tabs is in the foreground in the desktop app and the user presses Ctrl+Tab
- **THEN** the next workspace tab is selected

#### Scenario: Web tab switching on macOS
- **WHEN** the web build runs in a browser on macOS and the shortcut list is shown
- **THEN** `session.tab.next` shows ⌃⇧] and neither ⌘⇧] nor ⌘⌥→ is a default of any action

#### Scenario: Digit equals sidebar row
- **WHEN** the user presses Mod+6 in the desktop app
- **THEN** the Library screen, the sixth sidebar row, is shown

### Requirement: Default bindings for windows and the desktop application
The default preset SHALL register and bind the following actions, which carry the items of the application menu (`desktop-app.Native application menu`), the top bar's back and forward buttons and the tray menu; every menu item that is not an operating-system role is one of the actions of this capability's tables. "Desktop" in the Web column means the action is registered only in the desktop app; operating-system roles (Hide, Hide others, Minimise, Zoom, Bring all to front, Services, the window list) are not actions and are declared in `desktop-app.Native application menu`.

| Action id | Title | Context | macOS | Windows / Linux | Web |
|---|---|---|---|---|---|
| `window.new` | New window | global | ⌘⇧N | Ctrl+Shift+N | desktop |
| `window.close` | Close window | global | ⌘W, ⌘⇧W | Ctrl+W, Ctrl+Shift+W | desktop |
| `app.quit` | Quit JAgentChill | global | ⌘Q | Ctrl+Q | desktop |
| `nav.back`, `nav.forward` | Back / forward in the window's navigation history (also the top-bar buttons) | global | ⌘[ / ⌘] | Alt+Left / Alt+Right | the browser's own keys |
| `app.ui-scale.in`, `app.ui-scale.out`, `app.ui-scale.reset` | UI scale up / down by 10% / actual size | global | ⌘⌥= / ⌘⌥- / ⌘⌥0 | Ctrl+Alt+= / Ctrl+Alt+- / Ctrl+Alt+0 | desktop (the browser's zoom on web) |
| `help.devtools` | Toggle developer tools | global | ⌘⌥I | Ctrl+Shift+I | desktop |
| `app.escape` | Close Settings when a settings route is shown, otherwise leave focus mode (enabled only when one of the two applies and no overlay, drag or text focus has the key first) | global | Escape | same | — |
| `app.settings.close`, `view.focus-mode.exit` | Close Settings and return to the previous screen / leave focus mode — the two steps of `app.escape`, also invoked by "← Back to app" and by the focus-mode toggle | global | unbound | unbound | — |
| `project.open-recent` | Open a recent project (takes a project id; not bindable) | global | — | — | — |
| `project.clear-recent`, `project.import-package`, `project.export-package` | Clear the recent list / Import project… / Export project package… | global | unbound | unbound | — |
| `script.new` | New script | global | unbound | unbound | — |
| `app.check-updates`, `app.about` | Check for updates… / About | global | unbound | unbound | desktop |
| `app.theme.system`, `app.theme.light`, `app.theme.dark` | Theme: system / light / dark | global | unbound | unbound | — |
| `editor.layout.apply` | Apply an editor layout preset (takes a preset id of `app-shell-navigation.Editor layout presets and panel collapse`; not bindable) | editor | — | — | — |
| `supervisor.start`, `supervisor.stop`, `supervisor.restart`, `supervisor.open-logs` | Start / stop / restart the built-in host / Open logs folder | global | unbound | unbound | desktop |
| `app.settings.network-access`, `app.settings.host`, `devices.pair` | Network access… / Host settings… / Pair a device… | global | unbound | unbound | — |
| `help.starter-tips`, `help.whats-new`, `help.feedback`, `help.diagnostics` | Starter tips / What's new / Send feedback… / Diagnostics… | global | unbound | unbound | — |

`window.close` is the `global` meaning of `Mod+W`: in the `editor` context `project.close` shadows it and in the `workspace` context `workspace.tab.close` shadows it, exactly as the precedence rule provides, and `Mod+Shift+W` closes the window from the editor (in a workspace `workspace.pane.close` shadows that too, and the window is closed from the menu or the window button); `Alt+F4` on Windows and Linux is the operating system's own close key and needs no binding. `window.new` is shadowed by `workspace.new` and `script.scene.new` in their contexts. `nav.back` and `nav.forward` are shadowed in the `editor` context by `playback.jump-back` / `playback.jump-forward` on Windows and Linux (Alt+Left / Alt+Right) and in the `canvas` context by the nudge actions; they remain reachable there from the top-bar buttons, the Go menu and the mouse back and forward buttons, which always invoke them. `app.quit` on macOS and the destructive-by-nature host actions cannot be given single-key bindings. The `supervisor.*` actions are enabled only in the desktop app with the built-in host configured and, for the three that change it, role `admin`. `app.escape` is the only `global` action bound to Escape; it runs `app.settings.close` on a settings route and `view.focus-mode.exit` otherwise. [NEW]

#### Scenario: Close window outside the editor
- **WHEN** the Projects screen is in the foreground in the desktop app on Windows and the user presses Ctrl+W
- **THEN** `window.close` runs and the window closes

#### Scenario: Mod+W in the editor closes the project
- **WHEN** the editor is in the foreground and the user presses Mod+W
- **THEN** `project.close` runs, the app returns to Projects and the window stays open

#### Scenario: Back from the keyboard
- **WHEN** the user opened Settings from the Sessions screen and presses ⌘[ on macOS or Alt+Left on Windows or Linux
- **THEN** `nav.back` returns to the Sessions screen, as the top-bar back button does

#### Scenario: Every menu item has an action
- **WHEN** the menu-model test of `desktop-app.Native application menu` runs
- **THEN** each item that is not a declared operating-system role names an action id found in the tables of this capability

#### Scenario: Escape closes Settings
- **WHEN** a settings page is shown with no overlay open and focus outside a text field, and the user presses Escape
- **THEN** `app.escape` runs `app.settings.close`, which returns to the screen shown before Settings was opened

### Requirement: Default bindings for the workflow canvas
The default preset SHALL bind the following in the `canvas` context, one binding per action. The actions are registered by `workflow-diagram.Canvas keyboard shortcuts` and their behaviour is defined by `workflow-diagram.Keyboard operation of the canvas`; this table is the only definition of their default bindings.

| Action id | macOS | Windows / Linux |
|---|---|---|
| `canvas.tool-select` | V | same |
| `canvas.tool-hand` | H | same |
| `canvas.select-all` | ⌘A | Ctrl+A |
| `canvas.clear-selection` | Escape | same |
| `canvas.delete` | Backspace (⌫) | Delete |
| `canvas.delete-reconnect` | ⇧Backspace | Shift+Delete |
| `canvas.duplicate` | ⌘D | Ctrl+D |
| `canvas.copy` | ⌘C | Ctrl+C |
| `canvas.cut` | ⌘X | Ctrl+X |
| `canvas.paste` | ⌘V | Ctrl+V |
| `canvas.copy-image` | ⌘⇧C | Ctrl+Shift+C |
| `canvas.group` | ⌘G | Ctrl+G |
| `canvas.ungroup` | ⌘⇧G | Ctrl+Shift+G |
| `canvas.quick-add` | A | same |
| `canvas.toggle-palette` | P | same |
| `canvas.add-note` | N | same |
| `canvas.add-group` | F | same |
| `canvas.rename` | F2 | same |
| `canvas.open-details` | Enter | same |
| `canvas.toggle-collapse` | E | same |
| `canvas.toggle-enabled` | D | same |
| `canvas.zoom-in` | ⌘= | Ctrl+= |
| `canvas.zoom-out` | ⌘- | Ctrl+- |
| `canvas.zoom-100` | ⌘0 | Ctrl+0 |
| `canvas.zoom-fit` | ⇧1 | Shift+1 |
| `canvas.zoom-selection` | ⇧2 | Shift+2 |
| `canvas.toggle-minimap` | M | same |
| `canvas.toggle-grid` | ⌘' | Ctrl+' |
| `canvas.toggle-guides` | ⌘⇧' | Ctrl+Shift+' |
| `canvas.toggle-outline` | ⌘⇧O | Ctrl+Shift+O |
| `canvas.find` | ⌘F | Ctrl+F |
| `canvas.next-match` | G | same |
| `canvas.previous-match` | ⇧G | Shift+G |
| `canvas.auto-layout` | ⌘⇧L | Ctrl+Shift+L |
| `canvas.align-left` | ⌥A | Alt+A |
| `canvas.align-right` | ⌥D | Alt+D |
| `canvas.align-top` | ⌥W | Alt+W |
| `canvas.align-bottom` | ⌥S | Alt+S |
| `canvas.align-center` | ⌥H | Alt+H |
| `canvas.align-middle` | ⌥V | Alt+V |
| `canvas.distribute-horizontal` | ⌥⇧H | Alt+Shift+H |
| `canvas.distribute-vertical` | ⌥⇧V | Alt+Shift+V |
| `canvas.nudge-left`, `canvas.nudge-right`, `canvas.nudge-up`, `canvas.nudge-down` (20 units) | ⌥← / ⌥→ / ⌥↑ / ⌥↓ | Alt+arrow |
| `canvas.nudge-far-left`, `canvas.nudge-far-right`, `canvas.nudge-far-up`, `canvas.nudge-far-down` (100 units) | ⌥⇧← / ⌥⇧→ / ⌥⇧↑ / ⌥⇧↓ | Alt+Shift+arrow |
| `canvas.focus-left`, `canvas.focus-right`, `canvas.focus-up`, `canvas.focus-down` | ← / → / ↑ / ↓ | same |
| `canvas.extend-selection-left`, `canvas.extend-selection-right`, `canvas.extend-selection-up`, `canvas.extend-selection-down` | ⇧← / ⇧→ / ⇧↑ / ⇧↓ | Shift+arrow |
| `canvas.focus-upstream` | [ | same |
| `canvas.focus-downstream` | ] | same |
| `canvas.focus-first` | Home | same |
| `canvas.focus-last` | End | same |
| `canvas.focus-inputs` | I | same |
| `canvas.focus-outputs` | O | same |
| `canvas.connect` | C | same |
| `canvas.connect-to` | ⇧C | Shift+C |
| `canvas.toggle-follow` | ⇧F | Shift+F |
| `canvas.replay-step-back` | J | same |
| `canvas.replay-toggle` | K | same |
| `canvas.replay-step-forward` | L | same |
| `canvas.diff-previous` | ⌥[ | Alt+[ |
| `canvas.diff-next` | ⌥] | Alt+] |

`canvas.rename` (F2) and `canvas.open-details` (Enter) are distinct actions with distinct keys: Enter never starts a rename, and while the rename field or any other inline field is open no `canvas` binding fires and Enter commits that field. Holding Space selects the hand tool while held; this is a fixed gesture listed under "Mouse and modifiers". Undo and redo on the canvas use `edit.undo` and `edit.redo`, which are active in every context that has an undo history. Because the `canvas` context is more specific than any screen context, a canvas embedded in a session, a film screen or an automation uses these bindings while it has focus. [NEW]

#### Scenario: Rename and details do not collide
- **WHEN** a node has focus and the user presses Enter, closes the detail panel, then presses F2
- **THEN** Enter opened the node's detail panel and did not start renaming, and F2 opened the inline rename field

#### Scenario: Enter inside the rename field
- **WHEN** the inline rename field is open and the user presses Enter
- **THEN** the new name is committed and the detail panel does not open

#### Scenario: No collisions in the canvas table
- **WHEN** the binding-table CI test runs
- **THEN** every `canvas.*` action has exactly one default binding per platform family and no two share a combination

#### Scenario: Delete key per platform
- **WHEN** two nodes are selected on macOS and the user presses ⌫
- **THEN** both nodes are deleted in one undo step

### Requirement: Default bindings for workspaces, files, diffs and review
The default preset SHALL bind the following. The actions are registered by `workspaces-terminal` (keyboard access to workspaces), and the review actions also by `script-studio` and `chat-agent` for their review surfaces; this table is the only definition of their default bindings.

| Action id | Context | macOS | Windows / Linux | Web |
|---|---|---|---|---|
| `workspace.new` | workspace | ⌘⇧N | Ctrl+Shift+N | unbound |
| `workspace.open-folder` | workspace | ⌘⇧O | Ctrl+Shift+O | — |
| `workspace.switch` | workspace | ⌘; | Ctrl+; | — |
| `workspace.tab.next`, `workspace.tab.previous` | workspace | ⌃Tab / ⌃⇧Tab | Ctrl+Tab / Ctrl+Shift+Tab | Ctrl+Shift+] / Ctrl+Shift+[ (macOS: ⌃⇧] / ⌃⇧[) |
| `workspace.tab.close` | workspace | ⌘W | Ctrl+W | Alt+W |
| `workspace.tab.reopen-closed` | workspace | ⌘⇧T | Ctrl+Shift+T | Alt+Shift+T |
| `workspace.tab.move-left`, `workspace.tab.move-right` | workspace | ⌘⇧PageUp / ⌘⇧PageDown | Ctrl+Shift+PageUp / Ctrl+Shift+PageDown | Alt+Shift+PageUp / Alt+Shift+PageDown |
| `workspace.tab.keep-open` | workspace | ⌘⇧H | Ctrl+Shift+H | — |
| `workspace.tab.switcher` | workspace | ⌘E | Ctrl+E | — |
| `workspace.pane.split-right` | workspace | ⌘⌥\ | Ctrl+Alt+\ | — |
| `workspace.pane.split-down` | workspace | ⌘⌥- | Ctrl+Alt+- | — |
| `workspace.pane.focus-next`, `workspace.pane.focus-previous` | workspace | ⌘⌥→ / ⌘⌥← | Alt+Shift+Right / Alt+Shift+Left | macOS: ⌃⌥→ / ⌃⌥← |
| `workspace.pane.maximise` | workspace | ⌘⇧M | Ctrl+Shift+M | — |
| `workspace.pane.close` | workspace | ⌘⇧W | Ctrl+Shift+W | Alt+Shift+W |
| `workspace.explorer.toggle` | workspace | ⌘⇧\ | Ctrl+Shift+\ | — |
| `workspace.explorer.focus-files` | workspace | ⌘⇧E | Ctrl+Shift+E | — |
| `workspace.explorer.focus-changes` | workspace | ⌘⇧G | Ctrl+Shift+G | — |
| `workspace.explorer.focus-pull-request` | workspace | ⌘⇧R | Ctrl+Shift+R | — |
| `workspace.scripts.open` | workspace | ⌘⇧B | Ctrl+Shift+B | — |
| `workspace.git.commit`, `workspace.git.push`, `workspace.git.pull` | workspace | unbound | unbound | — |
| `file.quick-open` | workspace | ⌘P | Ctrl+P | — |
| `file.search-in-files` | workspace | ⌘⇧F | Ctrl+Shift+F | — |
| `file.save` | file | ⌘S | Ctrl+S | — |
| `file.save-all` | file | ⌘⌥S | Ctrl+Alt+S | — |
| `file.new` | file | unbound | unbound | — |
| `file.rename` | file | F2, Return | F2 | — |
| `file.delete` | file | ⌘Backspace | Delete | — |
| `diff.next-change`, `diff.previous-change` | diff | F7 / ⇧F7 | F7 / Shift+F7 | — |
| `diff.next-file`, `diff.previous-file` | diff | ⌥] / ⌥[ | Alt+] / Alt+[ | — |
| `diff.toggle-layout` | diff | ⌥L | Alt+L | — |
| `review.add-comment` | review | ⌘⌥M | Ctrl+Shift+; | — |
| `review.next-item`, `review.previous-item` | review | J / K | same | — |
| `review.accept-item` | review | ⌘Enter | Ctrl+Enter | — |
| `review.reject-item` | review | ⌘Backspace | Ctrl+Backspace | — |
| `review.submit` | review | ⌘⇧Enter | Ctrl+Shift+Enter | — |

Ctrl+Alt combinations are avoided as Windows / Linux defaults for actions used next to text (comments, pane focus), because Ctrl+Alt is how AltGr arrives on those systems; the two pane-split actions keep `Ctrl+Alt+\` and `Ctrl+Alt+-` and are protected by rule 4 of `keyboard-shortcuts.Dispatch and suppression rules`. `Ctrl+Alt+arrow` is never a default: GNOME, Cinnamon and XFCE use it for workspace switching and some Windows graphics drivers for screen rotation. `file.delete` and `file.rename` apply to the focused row of the file tree (on macOS Return is a second default for rename, the platform convention; F2 needs Fn on keyboards whose function row controls hardware); inside a file editor (a typable surface) F2 and Delete keep their text meaning. Actions that change files, git state or a review SHALL be disabled for device roles that lack the permission defined by the owning capability (`workspaces-terminal`, `script-studio.Roles and permissions`), so their bindings do nothing for those roles. The git actions have no default binding because they change repository state; they are reachable from the git split button and the command palette. [NEW]

#### Scenario: Quick open
- **WHEN** a workspace screen is in the foreground and the user presses Mod+P
- **THEN** `file.quick-open` opens the file-name search

#### Scenario: Search in files in a workspace
- **WHEN** a workspace screen is in the foreground, focus is not in a terminal and the user presses Mod+Shift+F
- **THEN** `file.search-in-files` runs, neither focus mode nor player fullscreen is invoked, and the shortcut settings show no override note for `view.focus-mode`

#### Scenario: Diff navigation
- **WHEN** a diff panel has focus on its first change and the user presses F7
- **THEN** the view scrolls to the second change and it is announced

#### Scenario: Reviewer keys
- **WHEN** a proposal's change list has focus on its first change and the user presses J, then Mod+Enter
- **THEN** the second change is focused and then accepted

#### Scenario: Viewer cannot save
- **WHEN** a `viewer` device has a file open and presses Mod+S
- **THEN** `file.save` is disabled, nothing is written and no error is shown

#### Scenario: Web replacement for close tab
- **WHEN** the web build's shortcut list is shown
- **THEN** `workspace.tab.close` shows Alt + W and Ctrl + W is not offered

### Requirement: Default bindings for terminals
The default preset SHALL bind the following. The actions are registered by `workspaces-terminal` (terminal tabs, shell integration and terminal accessibility); this table is the only definition of their default bindings. Per `keyboard-shortcuts.Shortcut contexts and precedence`, while a terminal has focus the app intercepts only the six actions of the `terminal` context below — the three escape actions and the terminal's own copy, paste and find — together with the binding of the global action `palette.open`, and delivers every other key to the terminal program. The remaining terminal actions belong to the `workspace` context: their bindings fire while a workspace screen is in the foreground and focus is outside a terminal, they act on the active terminal tab, and from inside a focused terminal they are reached through the terminal's toolbar and context menu or after `terminal.focus.leave`.

| Action id | Context | macOS | Windows / Linux |
|---|---|---|---|
| `terminal.focus.leave` | terminal | ⌘⌥↑ (web: ⌃⌥↑) | Alt+Shift+Up |
| `terminal.focus.next-pane` | terminal | ⌘⌥→ (web: ⌃⌥→) | Alt+Shift+Right |
| `terminal.focus.previous-pane` | terminal | ⌘⌥← (web: ⌃⌥←) | Alt+Shift+Left |
| `terminal.copy` | terminal | ⌘C | Ctrl+Shift+C |
| `terminal.paste` | terminal | ⌘V | Ctrl+Shift+V |
| `terminal.find` | terminal | ⌘F | Ctrl+Shift+F |
| `terminal.new` | workspace | ⌃⇧` | Ctrl+Shift+` |
| `terminal.clear` | workspace | ⌘⇧K | Ctrl+Shift+K |
| `terminal.split-right` | workspace | unbound | unbound |
| `terminal.history.toggle` | workspace | unbound | unbound |
| `terminal.command.previous`, `terminal.command.next` | workspace | unbound | unbound |
| `terminal.font.increase`, `terminal.font.decrease`, `terminal.font.reset` | workspace | unbound | unbound |
| `terminal.kill` | workspace | unbound | unbound |

The three `terminal.focus.*` actions are the escape actions: they SHALL always be bound (the shortcut settings refuse to leave any of them without a binding, with the message "A terminal needs a key to leave it"), and they are evaluated before any byte is sent to the terminal. Their defaults are chosen so that the key always reaches the app: `Alt+Shift+arrow` on Windows and Linux is not grabbed by Windows, GNOME, KDE Plasma, Cinnamon or XFCE in their default configurations (unlike `Ctrl+Alt+arrow`, which several of them use for workspace switching), `⌘⌥arrow` is free in the macOS desktop app, and in a browser on macOS — where `⌘⌥→/←` switch browser tabs — the defaults are `⌃⌥arrow`. Shell programs that use `Alt+Shift+arrow` themselves do not receive it; the terminal's status line shows the current binding of `terminal.focus.leave`, and a user can rebind the three actions to any non-reserved combination. On iOS, iPadOS and Android with a hardware keyboard the macOS and Windows / Linux columns apply respectively, and without a hardware keyboard the terminal's key row provides a "Leave" button (`workspaces-terminal`). A user who binds one of the `workspace`-context terminal actions gets that binding only outside a focused terminal; the shortcut settings state this on those rows ("Does not fire while a terminal has focus"), and no setting adds an action to the intercepted set. On Windows and Linux, `Ctrl+C` and `Ctrl+V` without Shift are delivered to the terminal program; on macOS, where the terminal's control characters use the Control key, ⌘C and ⌘V never reach the program. All terminal actions are disabled when terminals are turned off on the host (`workspaces-terminal.Terminal enablement and host-shell warning`) or the device role is not permitted to use them. [NEW]

#### Scenario: Leave a terminal by keyboard
- **WHEN** a terminal running a full-screen program has focus and the user presses the binding of `terminal.focus.leave`
- **THEN** focus moves to the terminal's tab and the program receives no bytes for that key press

#### Scenario: Interrupt still reaches the program
- **WHEN** a terminal has focus on Linux and the user presses Ctrl+C
- **THEN** the interrupt character is sent to the terminal and nothing is copied

#### Scenario: Escape actions cannot be unbound
- **WHEN** the user removes the only binding of `terminal.focus.next-pane` in the shortcut settings
- **THEN** the removal is refused with "A terminal needs a key to leave it"

#### Scenario: Palette key opens the palette from a terminal
- **WHEN** a terminal has focus and the user presses the binding of `palette.open`
- **THEN** the command palette opens, the terminal program receives no bytes for that key press, and closing the palette returns focus to the terminal

#### Scenario: The terminal context holds exactly six actions
- **WHEN** the binding-table CI test inspects the `terminal` context
- **THEN** it contains exactly `terminal.focus.leave`, `terminal.focus.next-pane`, `terminal.focus.previous-pane`, `terminal.copy`, `terminal.paste` and `terminal.find`

#### Scenario: Clear from outside the terminal
- **WHEN** a workspace is in the foreground, focus is in the file tree and the user presses the binding of `terminal.clear`
- **THEN** the active terminal tab is cleared, and pressing the same keys while the terminal has focus sends them to the terminal program instead

#### Scenario: Leaving a terminal on stock Ubuntu
- **WHEN** a terminal has focus in the desktop app on GNOME with default system shortcuts and the user presses Alt+Shift+Up
- **THEN** the desktop does not switch workspace, focus moves to the terminal's tab and the program receives no bytes

#### Scenario: Leaving a terminal in a browser on macOS
- **WHEN** a terminal has focus in the web build in a browser on macOS and the user presses ⌃⌥↑
- **THEN** focus moves to the terminal's tab and the browser does not change tab

### Requirement: Default bindings for the script editor
The default preset SHALL bind the following in the `script` context. The actions are registered by `script-studio.Formatting shortcuts and typing behaviour`; this table is the only definition of their default bindings. The typing rules of that requirement (Enter, Tab, Shift+Tab and Backspace changing the line kind) are fixed editor behaviour, are not registry actions and are listed in the cheat sheet under "Script typing" without a rebinding control.

| Action id | Title | macOS | Windows / Linux | Web |
|---|---|---|---|---|
| `script.line.kind.action` | Set line kind: action | ⌘⌥1 | Ctrl+Shift+1 | — |
| `script.line.kind.dialogue` | Set line kind: dialogue | ⌘⌥2 | Ctrl+Shift+2 | — |
| `script.line.kind.narration` | Set line kind: narration | ⌘⌥3 | Ctrl+Shift+3 | — |
| `script.line.kind.onScreenText` | Set line kind: on-screen text | ⌘⌥4 | Ctrl+Shift+4 | — |
| `script.line.kind.visualNote` | Set line kind: visual note | ⌘⌥5 | Ctrl+Shift+5 | — |
| `script.line.kind.soundNote` | Set line kind: sound note | ⌘⌥6 | Ctrl+Shift+6 | — |
| `script.line.kind.transition` | Set line kind: transition | ⌘⌥7 | Ctrl+Shift+7 | — |
| `script.scene.new` | New scene | ⌘⇧N | Ctrl+Shift+N | Alt+Shift+N |
| `script.beat.new` | New beat | ⌘⇧B | Ctrl+Shift+B | — |
| `script.shot.fromSelection` | Create shot from selection | ⌘⇧H | Ctrl+Shift+H | — |
| `script.move.up`, `script.move.down` | Move line or scene up / down | ⌥↑ / ⌥↓ | Alt+Up / Alt+Down | — |
| `script.mode.toggle` | Switch Structured / Text mode | ⌘⇧M | Ctrl+Shift+M | — |
| `script.navigator.toggle` | Show / hide the scene navigator | ⌘⌥\ | Ctrl+Alt+\ | — |
| `script.find` | Find and replace | ⌘F | Ctrl+F | — |
| `script.comment.add` | Add comment | ⌘⌥M | Ctrl+Shift+; | — |
| `script.version.save` | Save a named version | ⌘S | Ctrl+S | — |

The seven line-kind ids keep the camel-case final segment registered by `script-studio`, which the id pattern of `keyboard-shortcuts.Action registry` allows. On Windows and Linux the line-kind and comment defaults use `Ctrl+Shift`, not `Ctrl+Alt`, because Ctrl+Alt+digit is AltGr+digit on many layouts ("{", "[", "@", "#"); macOS keeps ⌘⌥ because Option alone, not ⌘⌥, types characters there. No `script` binding fires while an IME composition is active or for an AltGr key press (rule 4 of `keyboard-shortcuts.Dispatch and suppression rules`). [NEW]

#### Scenario: Change the line kind
- **WHEN** the caret is in an action line and the user presses ⌘⌥2 on macOS or Ctrl+Shift+2 on Windows or Linux
- **THEN** the line becomes a dialogue line and its text is unchanged

#### Scenario: Brace on a German layout
- **WHEN** a user with a German layout on Windows or Linux presses AltGr+7 in a script line
- **THEN** "{" is typed and the line does not become a transition line

#### Scenario: Move a line during composition
- **WHEN** a Vietnamese Telex composition is active and the user presses Alt+Up
- **THEN** the composition continues and the line does not move

#### Scenario: Save a version
- **WHEN** the script editor has focus and the user presses Mod+S
- **THEN** `script.version.save` runs and the editor's `project.save-version` is not invoked

### Requirement: OpenCut classic preset
The app SHALL ship a read-only preset named "OpenCut classic" that reproduces the classic bindings exactly: play/pause `Space` and `K`; seek forward 1 s `L`; seek backward 1 s `J`; frame step `→` / `←`; jump 5 s `Shift+→` / `Shift+←`; go to start `Home` and `Enter`; go to end `End`; split `S`; split and remove left `Q`; split and remove right `W`; delete `Backspace` and `Delete`; copy `Mod+C`; paste `Mod+V`; toggle snapping `N`; select all `Mod+A`; cancel interaction `Escape`; duplicate `Mod+D`; undo `Mod+Z`; redo `Mod+Shift+Z` and `Mod+Y`; with stop playback, toggle ripple editing, toggle source audio, deselect all, mute selected, hide selected and toggle bookmark unbound. All actions that classic lacks keep their default-preset bindings in this preset except where they collide with a classic binding, in which case the newer action is unbound (preview axis `S`, shuttle `J`/`K`/`L`, multi-frame step). In this preset `Enter` goes to the start only when focus is not on a focusable control. [PORT KB-001, KB-002, KB-003, KB-004, KB-005, KB-006, KB-007, KB-008, KB-009, KB-010, KB-011, KB-012, KB-013, KB-014, KB-015, KB-016, KB-017, KB-018, KB-019, KB-020]

#### Scenario: Classic split key
- **WHEN** the active preset is "OpenCut classic" and the user presses S with a clip under the playhead
- **THEN** the clip is split and the preview axis does not toggle

#### Scenario: Classic seek
- **WHEN** the active preset is "OpenCut classic" and the user presses L at 3.0 s
- **THEN** the playhead moves to 4.0 s and playback state is unchanged

#### Scenario: Enter on a focused button
- **WHEN** the active preset is "OpenCut classic", a toolbar button has keyboard focus and the user presses Enter
- **THEN** the button activates and the playhead does not move

### Requirement: Presets
The shortcut system SHALL provide five preset slots: slot 1 "JAgentChill" (the default bindings above, read-only), slot 2 "OpenCut classic" (read-only), and slots 3–5 as user presets, initially empty. Creating a user preset copies the currently active preset and asks for a name (1–40 characters, unique among presets). User presets can be renamed, duplicated into another empty slot, reset and deleted; the active preset is switched from a select at the top of the shortcut settings and takes effect immediately without restart. Editing a binding while a read-only preset is active first creates a user preset as a copy in the first empty slot (named "Custom", "Custom 2", "Custom 3") and applies the edit there; when all three user slots are occupied the edit is refused with a message asking the user to choose or delete a user preset. [CAPCUT CC-273] [NEW]

#### Scenario: First edit creates a preset
- **WHEN** the "JAgentChill" preset is active, slots 3–5 are empty and the user rebinds Split
- **THEN** a preset "Custom" is created in slot 3 as a copy of "JAgentChill" with the new Split binding and becomes active

#### Scenario: No free slot
- **WHEN** a read-only preset is active, slots 3–5 are all occupied and the user tries to rebind an action
- **THEN** the binding is not changed and a message asks the user to switch to or delete a user preset

#### Scenario: Switching presets
- **WHEN** the user switches from "Custom" to "OpenCut classic"
- **THEN** all bindings, menu hints and tooltips reflect the classic preset immediately

### Requirement: Shortcut settings page
Settings SHALL contain a "Keyboard shortcuts" page (see `settings-preferences.Keyboard shortcuts page entry`) that lists every bindable action — including actions with no binding — grouped under these tabs, sorted by category then title: **Timeline** (categories playback, navigation, editing, selection, timeline, tools, history), **Player** (player and the `preview` context), **Basic** (project, application), **Chat** (chat, session and agents categories, including the `composer` context), **Workflow canvas** (`canvas` context), **Workspace** (`workspace`, `file`, `diff`, `review` contexts), **Terminal**, **Script** and **Other** (film, lists). Each row shows the action title, its action id in `type/mono` as secondary text, its context, and its bindings as keycap chips, plus controls to add a binding (up to 3 per action), remove a binding and reset the action to the preset default. A search field filters by action title, action id or by key: typing text matches titles and ids; activating "Search by key" and pressing a combination lists the actions bound to it in every context. A filter select offers All, Customised, Unbound and Conflicting. The page is available on desktop and web always, and on iOS and Android phones and tablets when a hardware keyboard is attached (`isHardwareKeyboardAttached()` of `keyboard-shortcuts.Platform coverage of shortcuts`); without one the page shows an explanatory empty state. The Timeline tab carries the switch "Use CapCut volume keys" of `keyboard-shortcuts.Default bindings for editing and history`, and the Basic tab lists the window, application, host and help actions of `keyboard-shortcuts.Default bindings for windows and the desktop application`. Tabs whose actions the device's role cannot use (for example Terminal for a non-admin device) are still listed and their rows carry the note "Not available for your role on this host". [PORT KB-020, KB-021] [CAPCUT CC-273] [NEW]

#### Scenario: Unbound actions are listed
- **WHEN** the user opens the Timeline tab
- **THEN** "Toggle ripple editing" appears with no keycap and an "Add shortcut" control

#### Scenario: Search by key
- **WHEN** the user activates "Search by key" and presses Mod+B
- **THEN** only "Split at playhead" is listed

#### Scenario: Search by key across contexts
- **WHEN** the user activates "Search by key" and presses Mod+F
- **THEN** `chat.find`, `canvas.find` and `script.find` are listed on every platform, each with its context, together with `terminal.find` on macOS, where its default is ⌘F (on Windows and Linux its default is Ctrl+Shift+F, so it is listed for that combination instead)

#### Scenario: Remove a binding
- **WHEN** the user removes `Backspace` from "Delete selection"
- **THEN** `Delete` remains the only binding and Backspace no longer deletes the selection

#### Scenario: Phone without a keyboard
- **WHEN** the page is opened on a phone with no hardware keyboard connected
- **THEN** it shows "Connect a keyboard to view and customise shortcuts" and no list

### Requirement: Rebinding by recording
Activating a keycap chip or "Add shortcut" SHALL enter recording mode for that slot: the chip shows "Press keys…", all shortcut dispatch is suspended, and the next key-down that includes one non-modifier key in the supported grammar becomes the candidate. Escape pressed alone cancels recording; clicking outside the chip or blurring the window cancels; Backspace or Delete pressed alone during recording clears that binding slot. A candidate is rejected with an inline message when it is not in the grammar, when it is in the **reserved set** of the platform family — the same set the binding-table CI test forbids as a default: on web, the browser-reserved list of `keyboard-shortcuts.Default bindings for project, application, session and lists` for the OS the browser runs on, in addition to that OS's own set; on macOS `Cmd+Q`, `Cmd+H`, `Cmd+Option+H`, `Cmd+M`, `Cmd+Tab`, `Cmd+Space`, ``Cmd+` ``, `Ctrl+Left/Right/Up/Down` (Mission Control and Spaces), `Cmd+Shift+3/4/5` and `Ctrl+Cmd+Q`; on Windows `Alt+F4`, `Alt+Tab`, `Alt+Space`, `Alt+Esc`, `Ctrl+Alt+Delete`, `Ctrl+Shift+Esc`, `Ctrl+Alt+arrow` and every combination with the Windows key (the grammar's `meta` on Windows); on Linux `Alt+F4`, `Alt+Tab`, `Alt+Space`, `Alt+F1`, `Alt+F2`, `Ctrl+Alt+arrow`, `Ctrl+Alt+F1` … `Ctrl+Alt+F12`, `Ctrl+Alt+Delete`, `Ctrl+Alt+T`, `Ctrl+Alt+L` and every combination with the Super key; on iOS and iPadOS `Cmd+H`, `Cmd+Tab`, `Cmd+Space`, `Cmd+Shift+3/4`, the Globe key combinations and `Cmd+Option+D`; on Android and ChromeOS `Alt+Tab` and every combination with the Meta (Search or Launcher) key — each rejected with "This combination is reserved by the system" (or "… by the browser"), or when it is a single printable key or Shift+key for an action whose context is `global`. An accepted candidate replaces only the slot being edited; the action's other bindings are kept. To bind Escape, Backspace or Delete as a shortcut, the user holds the key for 1 s during recording. [PORT KB-022] [CAPCUT CC-273] [NEW]

#### Scenario: Record a new binding
- **WHEN** the user clicks the `Mod+B` chip of Split and presses Mod+Shift+K, which is unused
- **THEN** the chip shows the new combination, the old one no longer splits and the new one does

#### Scenario: Cancel recording
- **WHEN** recording is active and the user presses Escape
- **THEN** recording ends and the binding is unchanged

#### Scenario: Second binding is preserved
- **WHEN** "Play / pause" is bound to Space and K in a user preset and the user re-records the K chip as P
- **THEN** the action is bound to Space and P

#### Scenario: Reserved combination
- **WHEN** the user records Cmd+Q on macOS
- **THEN** the candidate is rejected with "This combination is reserved by the system"

#### Scenario: Windows key combination
- **WHEN** the user records Win+E on Windows
- **THEN** the candidate is rejected with "This combination is reserved by the system"

#### Scenario: Workspace-switching key on Linux
- **WHEN** the user records Ctrl+Alt+Left on Linux
- **THEN** the candidate is rejected with "This combination is reserved by the system"

### Requirement: Conflict detection and resolution
When a candidate combination is already bound to a different action in the same context on the current platform family, the system SHALL NOT apply it silently. It shows an inline conflict notice naming the other action — `"<keys>" is already used by "<action>"` — with three choices: "Reassign" (removes the combination from the other action and applies it here), "Swap" (offered only when the slot being edited already holds a binding; the other action receives that previous binding) and "Cancel". A candidate that is bound in a less specific context (per the order of `keyboard-shortcuts.Shortcut contexts and precedence`) is allowed and flagged as an override rather than a conflict, and the less specific action's row shows "Overridden in <context> by <action>". A candidate for a `global` or screen-context action that is already taken by a `terminal` escape action is allowed, with the note that it does not fire while a terminal has focus. Imported presets are checked with the same rules; conflicting entries are listed and the conflicting entries of lower-listed actions are dropped. The "Conflicting" filter of the settings page is empty at all times for the shipped presets and for presets edited through the UI. [PORT KB-023] [NEW]

#### Scenario: Reassign
- **WHEN** the user records Mod+D for "Split at playhead", which is bound to "Duplicate", and chooses "Reassign"
- **THEN** Split has Mod+D and Duplicate has no binding for that slot

#### Scenario: Swap
- **WHEN** Split holds Mod+B, Duplicate holds Mod+D, the user records Mod+D on the Split chip and chooses "Swap"
- **THEN** Split is bound to Mod+D and Duplicate to Mod+B

#### Scenario: Cancel
- **WHEN** the conflict notice is shown and the user chooses "Cancel"
- **THEN** both actions keep their previous bindings

#### Scenario: Cross-context override
- **WHEN** the user binds an `editor` action to a combination used by a `global` action
- **THEN** the binding is applied, and the global action's row shows "Overridden in editor by <action>"

#### Scenario: Shipped presets have no conflicts
- **WHEN** the "JAgentChill" preset is active on any platform family and the user selects the "Conflicting" filter
- **THEN** the list is empty

### Requirement: Reset shortcuts
The shortcut settings SHALL offer three reset scopes: per action ("Reset" on the row restores that action's bindings to the base read-only preset the user preset was copied from), per tab ("Reset tab") and per preset ("Reset preset" restores every action). Tab and preset resets require confirmation and can be undone from the resulting toast for 8 s. If restoring a default would collide with a customised binding on another action, the customised binding is removed and the affected actions are named in the confirmation. [PORT KB-024] [CAPCUT CC-273]

#### Scenario: Reset one action
- **WHEN** Split was rebound to Mod+K and the user activates "Reset" on its row
- **THEN** Split is bound to Mod+B again and other customisations are untouched

#### Scenario: Reset preset with undo
- **WHEN** the user confirms "Reset preset" and then activates "Undo" in the toast within 8 s
- **THEN** all customised bindings are restored exactly as before the reset

### Requirement: Import and export of presets
The shortcut settings SHALL export the active preset to a UTF-8 JSON file named `<preset-name>.jckeys` (single extension, MIME type `application/vnd.jagentchill.keys+json`, registered with each desktop OS by `desktop-app.File associations`) with the shape `{ "format": "jagentchill-keybindings", "version": 1, "name": string, "base": "jagentchill" | "opencut-classic", "platform": "mac" | "other", "bindings": { [actionId]: string[] } }`, and import such a file into a chosen user slot. Import validates the file with the shared Zod schema: unknown action ids are skipped and counted, bindings outside the grammar are skipped and counted, conflicts are resolved per `keyboard-shortcuts.Conflict detection and resolution`, and a summary dialog reports how many bindings were applied, skipped and dropped before the user confirms. Import through the in-app file picker and by drag and drop also accepts a file with the earlier name `*.jckeys.json`, recognised by its `format` field, and the OpenCut classic persisted shape `{ keybindings: Record<key, action>, isCustomized }` (versions 2–7), running the classic migrations first. Files larger than 256 KiB or not valid JSON are rejected with an error message and no state change. On mobile the file is shared and picked through the OS share sheet and document picker. [PORT KB-029] [NEW]

#### Scenario: Round trip
- **WHEN** the user exports a preset and imports the file into an empty slot on another device of the same platform family
- **THEN** the imported preset has identical bindings for every action

#### Scenario: Unknown actions skipped
- **WHEN** an imported file contains 3 action ids that the app does not know
- **THEN** the summary reports "3 skipped", the remaining bindings are applied after confirmation, and nothing is applied if the user cancels

#### Scenario: Classic file
- **WHEN** the user imports a classic v5 keybindings export in which `escape` maps to `deselect-all`
- **THEN** the imported preset binds Escape to "Cancel current interaction"

#### Scenario: Invalid file
- **WHEN** the user selects a file that is not valid JSON
- **THEN** an error "This file is not a valid shortcut preset" is shown and no preset changes

### Requirement: Persistence and migration of bindings
Shortcut state SHALL be persisted per device in the preferences store under the key `jagentchill.keybindings` as `{ version: number, activePresetId: string, presets: { [slotId]: { name, base, overrides: { [actionId]: string[] } } } }`, where `overrides` holds only the actions whose bindings differ from the base preset. Because only overrides are stored, a release that adds a default binding delivers it to users of customised presets unless it collides with one of their overrides in the same context, in which case the user's override wins and the new action stays unbound and is listed under the "Unbound" filter with a "New" badge. The stored `version` starts at 1; every change to action ids or to the stored shape ships an ordered migration, and migrations run before the first key event is handled. A classic store (`opencut-keybindings`, versions 2–7) is migrated when it arrives in the `local-storage.json` of a classic bundle through `projects.OpenCut classic data import`, or in place when the app is served from the classic origin: it is passed through the classic steps (rename `split-selected`, `split-selected-left`, `split-selected-right`, `split-element` to the current split ids; rename `paste-selected` to `paste-copied`; bind `escape` when unbound; map `escape: deselect-all` to `cancel-interaction`), its ids are mapped to the current action ids, and it is imported as a user preset based on "OpenCut classic" when `isCustomized` is true. A stored state that fails schema validation is backed up under `jagentchill.keybindings.corrupt-<timestamp_ms>`, the defaults are loaded and a toast informs the user. Writes are debounced by 300 ms and flushed on window close. [PORT KB-025] [NEW]

#### Scenario: New default reaches a customised preset
- **WHEN** a release adds a default binding for a new action and the user's preset does not use that combination in that context
- **THEN** the new action is bound to its default in the user's preset after the upgrade

#### Scenario: New default collides with an override
- **WHEN** the new default combination is already used by one of the user's overrides in the same context
- **THEN** the user's binding is kept, the new action is unbound and carries a "New" badge in the settings list

#### Scenario: Corrupt store
- **WHEN** the stored value fails validation at startup
- **THEN** it is copied to a `corrupt-<timestamp_ms>` key, defaults are active and a toast says shortcuts were reset

#### Scenario: Classic store from a bundle
- **WHEN** a classic bundle whose `local-storage.json` holds a v3 `opencut-keybindings` store with a customised `paste-selected` binding is imported
- **THEN** a user preset exists whose `timeline.paste` action carries that binding

### Requirement: Active binding lookup
The registry SHALL expose `getBindings(actionId)` returning the active preset's bindings for the current platform in display order, and a subscription that notifies on any change. Menus, tooltips, the command palette, the cheat sheet, the application menu button on Windows and Linux and the macOS menu bar all read their **displayed hints** from this lookup, so that displayed hints always equal the bindings that fire. A hint is display text only: the key press is handled by the renderer's dispatcher (`keyboard-shortcuts.Dispatch and suppression rules`), not by a menu accelerator, with the single exception of the macOS operating-system accelerators listed in `keyboard-shortcuts.Platform coverage of shortcuts`. On desktop the menu model is rebuilt within 500 ms of a binding change. [NEW]

#### Scenario: Native menu follows rebinding
- **WHEN** the user rebinds Export to Mod+Shift+E in the desktop app
- **THEN** the File ▸ Export… item — in the macOS menu bar and in the application menu button on Windows and Linux — shows the new hint within 500 ms and the old combination no longer triggers export

#### Scenario: Hint is not an accelerator
- **WHEN** a menu item shows the single-key hint Q and the user types "q" in a text field on macOS
- **THEN** the letter is typed and the menu item does not fire

### Requirement: Command palette
The app SHALL provide a command palette opened by `palette.open`, by the sidebar search icon and by the desktop menu. It is a 640 px wide modal positioned 15% from the top (a full-height sheet on compact form factors) with a search field and grouped results: Actions (every enabled registry action in an active context, with its key hint), Navigation (every screen in `app-shell-navigation.Route map` that the device's role can open), Projects, Scripts, Sessions, Workflows and films, Workspaces, Media in the open project, and Settings pages and individual settings rows. With an empty query it lists up to 5 recently used commands followed by suggested actions for the current context. Matching is fuzzy on title, action id and keywords, case-insensitive and diacritic-insensitive, ranks prefix matches first, and shows at most 8 results per group and 50 in total. Results from local sources SHALL update within 100 ms of a keystroke on the reference desktop of `diagnostics-quality.Performance budgets` with 1,000 projects, 5,000 media assets and the full action and settings index loaded. Host-backed sources (sessions, workflows, workspaces) appear when their request returns and show a loading row meanwhile, and are omitted with a "Connect a host to search sessions" hint when no host is connected. Typing `>` restricts results to Actions and `@` to entities. Keyboard: Up/Down move with wrap, Enter runs the highlighted result, `Mod`+Enter opens an entity in a new window on desktop, Escape closes, Tab moves into a result's secondary actions. Running an action closes the palette first and then invokes it with trigger `palette`. Disabled actions are shown greyed with the reason and cannot be run. [NEW]

#### Scenario: Run an action
- **WHEN** the user opens the palette in the editor, types "split" and presses Enter
- **THEN** the palette closes and `timeline.split` is invoked once

#### Scenario: Local results within budget
- **WHEN** the library holds 1,000 projects and 5,000 media assets on the reference desktop and the user types one character
- **THEN** the local groups show their results within 100 ms

#### Scenario: Diacritic-insensitive search
- **WHEN** a project is named "Đà Nẵng trip" and the user types "da nang"
- **THEN** that project appears under Projects

#### Scenario: No results
- **WHEN** the query matches nothing
- **THEN** the palette shows "No results for "<query>"" and Enter does nothing

#### Scenario: Offline host
- **WHEN** no host is connected and the user types a session title
- **THEN** local groups are searched and the Sessions group shows the hint "Connect a host to search sessions"

### Requirement: Shortcut cheat-sheet dialog
The app SHALL provide a cheat-sheet dialog opened by `help.shortcuts`, by pressing `?` outside typable elements, from the Help menu, from the editor header menu "Keyboard shortcuts", and from the Help button in the sidebar footer. It is a 640 px modal (full-height sheet on compact form factors) listing all actions that have a binding in the active preset, grouped by category in two columns with keycaps, plus the fixed groups "Mouse and modifiers", "Composer" and "Script typing"; it shows the name of the active preset, a search field that filters rows, and a "Customise…" button that opens the shortcut settings page. Rows of the contexts active on the current screen are listed first. The dialog is read-only. On touch devices without a hardware keyboard the dialog instead lists exactly these touch gestures, whose behaviour is owned by `mobile-editor` and `timeline-editing.Mobile timeline gestures`: pinch to zoom the timeline; long-press and drag to reorder clips; double-tap a text or caption to edit it; two-finger pinch and twist on a selected element to scale and rotate it. Undo and redo on touch are the transport-row buttons only; no multi-finger tap gesture exists. [PORT KB-021, SH-004] [NEW]

#### Scenario: Open with the question mark
- **WHEN** no typable element has focus and the user presses Shift+/
- **THEN** the cheat sheet opens

#### Scenario: Reflects the active preset
- **WHEN** the active preset is "OpenCut classic"
- **THEN** the cheat sheet header names that preset and "Split at playhead" shows S

#### Scenario: Customise entry
- **WHEN** the user activates "Customise…"
- **THEN** the dialog closes and the Keyboard shortcuts settings page opens

#### Scenario: Touch gesture list
- **WHEN** the cheat sheet is opened on a phone with no hardware keyboard
- **THEN** it lists the four touch gestures above and no two-finger or three-finger tap gesture

### Requirement: Platform coverage of shortcuts
All bindings SHALL work in the desktop app and the web build on macOS, Windows and Linux, and on iPadOS, iOS and Android (phones and tablets) when a hardware keyboard is attached, using the same action registry and the same dispatcher rules.

**Hardware keyboards on iOS and Android.** React Native delivers no hardware-key events, so the app ships the native module `JagentchillKeyboard` (an Expo module, the sixth product module of `mobile-editor.Native modules and app registration`, with one TypeScript interface on both systems): `onKeyDown` / `onKeyUp` events `{ code, key, modifiers: { ctrl, meta, alt, shift, altGraph }, repeat }`, where `code` is the physical key in the grammar of `keyboard-shortcuts.Key grammar and physical-key mapping` (derived from the HID usage on iOS via `pressesBegan`/`pressesEnded` and `UIKeyCommand`, and from the scan code on Android via `dispatchKeyEvent`); `isHardwareKeyboardAttached()` with the change event `onHardwareKeyboardChange`; and `publishShortcuts([{ title, combination, group }])`. An event consumed by a focused native text input is not forwarded (the equivalent of rule 5), and the module forwards nothing while the app is in the background. On operating systems that have a system shortcut overlay the bindings are published to it through `publishShortcuts` — on iOS and iPadOS the overlay shown by holding ⌘ (as `UIKeyCommand` entries with discoverability titles), on Android the system keyboard-shortcuts helper (`onProvideKeyboardShortcuts`) — listing the first 20 bound actions of the active contexts in registry order (most specific context first), with the same content on both, republished within 500 ms of a context or binding change. On-screen (software) keyboards never trigger shortcuts.

**Native accelerators in the desktop app.** The renderer dispatcher handles every key while a window's content has focus (`desktop-app.Native application menu`). Only on macOS, where the app keeps running with no window, a fixed set of actions is additionally registered as operating-system accelerators so that they work with no window focused: `app.quit`, `window.new`, `window.close`, `app.settings`, `app.fullscreen`, `project.new`, `project.open`, plus the roles Hide, Hide others and Minimise. They use the bindings of the tables in this capability (and follow rebinding), and while a window's content has focus the dispatcher still decides — the menu shortcuts are ignored there — so the suppression rules apply to them too. On Windows and Linux no accelerator is registered natively: with no window open the app is reached through the tray menu or by launching it again. [NEW]

#### Scenario: iPad with keyboard
- **WHEN** an iPad with a hardware keyboard has the editor open and the user presses ⌘B
- **THEN** the clip under the playhead is split

#### Scenario: iPad overlay content
- **WHEN** the user holds ⌘ on an iPad while the editor is in the foreground and 60 editor actions are bound
- **THEN** the system overlay lists the first 20 bound `editor` actions in registry order

#### Scenario: Android tablet with keyboard
- **WHEN** an Android tablet with a hardware keyboard has the editor open and the user presses Ctrl+B, then opens the system keyboard-shortcuts helper
- **THEN** the clip under the playhead is split, and the helper lists the same first 20 bound `editor` actions an iPad lists

#### Scenario: Phone with a hardware keyboard
- **WHEN** a hardware keyboard is attached to an iPhone or an Android phone
- **THEN** `isHardwareKeyboardAttached()` reports true on both, the shortcut settings page shows its list, and Space toggles playback in the editor

#### Scenario: Native text input keeps its keys
- **WHEN** a native text field has focus on an Android tablet and the user presses Ctrl+B on the hardware keyboard
- **THEN** the event is not forwarded and no clip is split

#### Scenario: Software keyboard
- **WHEN** the user types "q" on the on-screen keyboard into a text element on a phone
- **THEN** the character is inserted and `timeline.delete-left` does not fire

#### Scenario: Quit with no window on macOS
- **WHEN** the app runs on macOS with no window open and the user presses ⌘Q
- **THEN** `app.quit` runs through the operating-system accelerator
