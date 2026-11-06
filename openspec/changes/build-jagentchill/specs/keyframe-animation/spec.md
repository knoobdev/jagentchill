## ADDED Requirements

### Requirement: Animatable property paths
The set of animatable property paths, the channel shape of each path, the element types each applies to and the nine lane groups are defined only by `project-document.Animatable property paths` (catalogue §11.2); this capability restates no path table and owns how those paths are presented and edited. A path is the dotted path of the stored field relative to the element (`transform.position.x`, `transform.scale.y`, `transform.rotation`, `opacity`, `effects.<effectId>.params.<key>`, `masks.<maskId>.params.<key>`, `masks.<maskId>.params.path`, `adjustments.hsl.<band>.<hue|saturation|lightness>`, `retouch.faces.<faceKey>.<key>`, `relight.intensity`), so every path maps to exactly one stored field and no translation rule exists. Lane and list order: lanes, the Curves view channel list and every keyframe list SHALL follow the group order 1–9 of that requirement (1 transform and opacity; 2 volume and pan; 3 text; 4 graphic params; 5 effects and motion blur; 6 masks; 7 colour; 8 keying, cutout stroke and crop; 9 retouch and relight) and, inside a group, the catalogue's row order; `timeline-editing.Keyframe display in the timeline` uses this order. `transform.scale.x` and `transform.scale.y` SHALL be presented as one grouped property labelled Scale (`transform.scale`: one toggle, one diamond, one lane) while stored as two channels; a key written through the grouped property is written to both channels at the same tick. A param is additionally gated by `keyframable !== false` in its definition (`timeline-editing.Element parameter registry`; effect and graphic params). A path that is not animatable on the element SHALL be rejected by the upsert command with no change (`INVALID_PARAMS`, reason "not keyframable"; a document carrying such a path fails validation with `document/animation-path-invalid`). [PORT A-001, A-002, A-003, A-004, A-005] [CAPCUT CC-091, CC-092]

#### Scenario: Keyframe on a transform property
- **WHEN** the user adds a keyframe on Position X at local 1 s with value 200
- **THEN** the element's animations contain a channel `transform.position.x` with one key at 120 000 ticks and value 200

#### Scenario: Scale is grouped
- **WHEN** the user adds a keyframe on Scale
- **THEN** keys are written to both `transform.scale.x` and `transform.scale.y` at the same time and one diamond is shown

#### Scenario: Non-keyframable param rejected
- **WHEN** a command tries to upsert a keyframe on `blendMode`
- **THEN** the command makes no change and returns the error `INVALID_PARAMS` with reason "not keyframable" to the caller

#### Scenario: Path equals the stored field
- **WHEN** an element stores `transform {position {x: 10, y: 20}, scale {x: 1, y: 1}, rotation: 0}` and the user keyframes Rotation
- **THEN** the channel path is `transform.rotation`, and no path named `transform.rotate`, `transform.positionX` or `transform.scaleX` exists anywhere in the document

#### Scenario: Retouch value is animatable
- **WHEN** the user adds a keyframe on Smooth skin with "Apply to all faces" on
- **THEN** the element's `animations` contain the path `retouch.faces.all.smoothSkin`, shown in lane group 9

### Requirement: Keyframe data model
Keyframes SHALL be stored per element in the single store `animations`, a map from property path to channel, as defined by `project-document.Animation store`; the four channel shapes (scalar, discrete, colour, path) and every key field are defined only by `project-document.Channel and keyframe shapes` and are not restated here. This requirement defines how commands write that data. Keys in a channel are sorted by time with at most one key per tick; upserting at an occupied tick SHALL replace the value and keep the key id. Upsert times SHALL be clamped to `[0, duration]` and snapped to the project frame grid. New keys are created with `segmentToNext: "linear"` and `tangentMode: "auto"`; the stored word for a hold segment is `step`, shown to users as "Hold", and tools accept `hold` as an input alias. A channel SHALL hold at most 1 000 keys; an upsert that would create key 1 001 SHALL be rejected with the message "Keyframe limit reached (1000 per property)" and, for agent tools, the error `INVALID_PARAMS`. A key at `time = duration` SHALL be retained (it becomes reachable when the element is extended, and it shapes the last segment) but is never itself sampled, because frames are sampled at `0 ≤ clipTime < duration`. Removing the last key of a channel removes the path from `animations` (`Removing the last keyframe`).

**Path channel.** The only path-valued channel is `masks.<maskId>.params.path` (a freeform mask's pen path). Its keys are `{id, time, value {points[]}, segmentToNext, easing}`: every key holds the complete point list, whose point ids equal the mask's point ids; between two keys each point's `x`, `y`, `inX`, `inY`, `outX`, `outY` is interpolated separately at the eased progress of the segment — `linear` uses the identity, `bezier` uses the key's normalised cubic bezier `easing [x1, y1, x2, y2]`, `step` holds the outgoing key. A path key has no tangent handles and no `tangentMode`. A path channel counts toward the 1 000-key limit like any channel. Inserting or deleting a pen point updates every key of the channel in the same command (`masks-blending-keying.Mask keyframing`). In the graph editor a path channel appears in the Easing view (its segment's bezier is edited there) and as a step row without a value axis in the Curves view. [PORT A-001, A-007] [NEW]

#### Scenario: Upsert at an occupied time
- **WHEN** a key exists at local 1 s with value 10 and the user sets the property to 25 with the playhead at local 1 s
- **THEN** the channel still has one key at 1 s, with the same id and value 25

#### Scenario: Time clamp
- **WHEN** a command upserts a key at local 12 s on an element lasting 10 s
- **THEN** the key is stored at exactly 10 s

#### Scenario: Key limit
- **WHEN** a channel already has 1 000 keys and a command upserts a key at an unoccupied tick
- **THEN** no key is added and the caller receives the stated message

#### Scenario: Key at the element end
- **WHEN** a 10 s element at 30 fps has opacity keys 1 at 9 s and 0 at 10 s (linear)
- **THEN** the last rendered frame (local 9 s + 29 frames) has opacity 1/30 ± 0.001 and the key at 10 s remains stored

#### Scenario: Path key shape
- **WHEN** the user adds a keyframe on a 4-point pen path at local 1 s
- **THEN** `animations["masks.<maskId>.params.path"]` holds one key with `time` 120 000, a `value.points` list of 4 points carrying the mask's point ids, `segmentToNext: "linear"` and no handles

#### Scenario: Path interpolation with easing
- **WHEN** a path channel has keys at 0 s and 2 s, the first with `segmentToNext: "bezier"` and `easing [0.42, 0, 1, 1]`, and one anchor moves 100 px between them
- **THEN** at 1 s that anchor has moved 31.5 ± 1 px

### Requirement: Interpolation types
Between two scalar keys the value SHALL be computed by the outgoing key's `segmentToNext`: `linear` (straight line), `step` (hold the outgoing value until the next key; shown to users as "Hold") or `bezier` (cubic curve defined by the outgoing key's `rightHandle` and the next key's `leftHandle`). Linear, hold and bezier SHALL be available on every scalar path, including effect, mask and adjustment params. Discrete channels SHALL support hold only, and path channels interpolate as defined in `Keyframe data model`. Before the first key the channel SHALL hold the first key's value unless `extrapolation.before` is `linear`, and after the last key it SHALL hold the last key's value unless `extrapolation.after` is `linear`; with `linear` the value continues along the boundary tangent (the slope of the adjacent segment at that key, or 0 for a single key) and is then clamped to the param's range. New keys SHALL be created with `segmentToNext: linear` and `tangentMode: auto`. Resolution SHALL be performed identically in preview and export, at the frame start time `clipTime = frameTime − startTime` (the evaluation rule of `render-engine.Resolve pass`); this capability is the owner of that evaluation time. Parameters whose registry definition is integer-valued (for example shape `sides` and `points`) interpolate as scalars and the resolved value is rounded to the nearest integer, half away from zero. [PORT A-007, E-009] [CAPCUT CC-094]

#### Scenario: Linear midpoint
- **WHEN** keys are 0 at 0 s and 100 at 2 s with a linear segment
- **THEN** the value at 1 s is 50

#### Scenario: Frame-start evaluation
- **WHEN** keys are 0 at 0 s and 1 at 1 s (linear) on a 30 fps project and frame 15 of the element is rendered
- **THEN** the resolved value is exactly 0.5 (the value at 60 000 ticks, not at the frame centre)

#### Scenario: Hold segment
- **WHEN** the first key's segment is Hold
- **THEN** the value is 0 at every time before 2 s and 100 at 2 s

#### Scenario: Hold extrapolation
- **WHEN** the last key is at 2 s with value 100 and the element lasts 5 s
- **THEN** the value at 4 s is 100

#### Scenario: Linear extrapolation
- **WHEN** Position X has keys 0 at 0 s and 100 at 2 s (linear), `extrapolation.after` is `linear` and the element lasts 5 s
- **THEN** the value at 4 s is 200

#### Scenario: Bezier on an effect param
- **WHEN** a bezier segment is set on `effects.<id>.params.intensity`
- **THEN** the segment is stored as `bezier` with both handles and resolves along the curve

#### Scenario: Integer parameter rounding
- **WHEN** a polygon's `sides` has keys 3 at 0 s and 6 at 3 s (linear)
- **THEN** the shape has 4 sides at 1.4 s (4.4 rounds to 4) and 5 sides at 1.5 s (4.5 rounds to 5)

### Requirement: Colour interpolation in linear RGB
Colour keyframes SHALL interpolate component-wise in linear-light RGB with alpha, with one shared easing per segment, the colour channel stores its four components in linear light (`project-document.Channel and keyframe shapes`), and the static field and the UI SHALL show lowercase hex (`#rrggbb`) or hex8 (`#rrggbbaa`). [PORT A-006, A-003]

#### Scenario: Red to green midpoint
- **WHEN** a text colour is keyframed from `#ff0000` to `#00ff00` linearly
- **THEN** at the midpoint the displayed colour is `#bcbc00` (±1 per channel), not `#808000`

### Requirement: Keyframe toggle in the properties panel
This requirement defines the behaviour of the keyframe toggle that the inspector shows on every keyframable field (the control is hosted by `preview-canvas.Keyframe toggle in the inspector`). The diamond toggle before a field's label SHALL have three states: hollow (no keyframes on the property), half-filled (property has keyframes, none at the playhead) and filled (a keyframe exists at the playhead). Clicking it SHALL add a keyframe at the playhead holding the current resolved value, or remove the keyframe at the playhead. The toggle SHALL be disabled with the tooltip "Move the playhead onto the clip to add a keyframe" when the playhead is outside the element's time range. When a property has keyframes, editing it by any means (field, slider, on-canvas handle, agent command) SHALL write a keyframe at the playhead instead of changing the base value. Each add, remove or edit SHALL be one undo step. The registry action that toggles a keyframe at the playhead for the focused property is `keyframe.toggle`, and `keyframe.next` and `keyframe.previous` move the playhead between keyframes (`keyboard-shortcuts.Action registry`). [PORT A-001] [CAPCUT CC-091]

#### Scenario: Add at playhead
- **WHEN** the playhead is at local 2 s and the user clicks the hollow diamond of Opacity (value 0.8)
- **THEN** a key at 2 s with value 0.8 is created and the diamond is filled

#### Scenario: Auto-keyframe on change
- **WHEN** Opacity already has keys and the user drags the opacity slider to 0.3 with the playhead at a time that has no key
- **THEN** a new key with value 0.3 is created at the playhead and the base value is unchanged

#### Scenario: Playhead outside the element
- **WHEN** the playhead is before the element's start
- **THEN** the toggle is disabled and shows the stated tooltip

### Requirement: On-canvas edits respect keyframes
Moving, scaling or rotating an element with the preview handles (gestures owned by `preview-canvas.Move elements on the canvas`, `preview-canvas.Scale with handles` and `preview-canvas.Rotate with the handle`) SHALL follow the same rule as field edits, and this requirement is the single definition of that rule: if the affected property has keyframes, the gesture writes or updates a keyframe at the playhead on that property (both position channels for a move, both scale channels for a corner drag, the dragged axis for an edge drag, `transform.rotation` for a rotate drag or a quarter-turn) and SHALL NOT delete or change any other keyframe; if the property has no keyframes, the gesture changes the base value and creates none. When the playhead is outside the element's time range the gesture SHALL change the base value and the toast "Move the playhead onto the clip to edit its keyframes" SHALL be shown once per session. This replaces OpenCut classic's behaviour of clearing scale keyframes when a scale drag starts. One gesture SHALL be one undo step, and repeated discrete edits are merged by the rule of `timeline-editing.Undo and redo`. [PORT A-021] [CAPCUT CC-091] [NEW]

#### Scenario: Scale drag on a keyframed element
- **WHEN** an element has scale keys at 0 s and 2 s and the user corner-drags it at local 1 s
- **THEN** a third key is created at 1 s on both scale channels and the keys at 0 s and 2 s are unchanged

#### Scenario: Scale drag without keyframes
- **WHEN** the element has no scale keys
- **THEN** the drag changes the base `transform.scale.x` and `transform.scale.y` and creates no keys

#### Scenario: Move drag on an element with position keys
- **WHEN** an element has `transform.position.x` and `transform.position.y` keys at 0 s and 4 s and the user drags it on the canvas at local 2 s
- **THEN** keys are written at 2 s on both position channels in one undo step and no scale, rotation or opacity key is created

#### Scenario: Quarter-turn on keyframed rotation
- **WHEN** rotation has a key of 30° at the playhead and the user invokes "Rotate 90°"
- **THEN** the key at the playhead becomes 120° and other rotation keys are unchanged

### Requirement: Mobile keyframe button
The keyframe button (diamond with a plus) placed in the mobile transport row by `mobile-editor.Transport row` SHALL behave as defined here; this requirement is its single behavioural definition. With an element selected and the playhead inside it, tapping SHALL add keyframes at the playhead for the property group currently being edited: with no tool sheet open the group is Transform (`transform.position.x`, `transform.position.y`, `transform.scale`, `transform.rotation` — opacity is not part of it); with a sheet open it is that sheet's group (Opacity → `opacity`; Volume → `volume`; Mask → the selected mask's keyframable params; Adjust → the selected slider; Effects → the open effect's keyframable params; Chroma key → its four sliders; Retouch → the selected slider of the selected face; Relight → its five numeric values). When keyframes of that group already exist at the playhead for every path of the group, the button SHALL show a minus and tapping SHALL remove them. Each tap SHALL be one batch command and one undo step, however many paths it writes. With no selection or the playhead outside the element the button SHALL be disabled. [CAPCUT CC-091, CC-092]

#### Scenario: Add transform keyframes on mobile
- **WHEN** a clip is selected, no tool sheet is open, and the user taps the keyframe button
- **THEN** keys are written at the playhead for position X, position Y, scale and rotation, no opacity key is written, and the button switches to its minus state
- **AND** one undo removes all of them

#### Scenario: Volume sheet open
- **WHEN** the Volume sheet is open and the user taps the keyframe button
- **THEN** only a `volume` key is written

#### Scenario: Opacity sheet open
- **WHEN** the Opacity sheet is open and the user taps the keyframe button
- **THEN** only an `opacity` key is written

#### Scenario: Disabled outside the element
- **WHEN** the playhead is after the selected element's end
- **THEN** the button is disabled

### Requirement: Removing the last keyframe
Removing a keyframe SHALL be an undoable command. When the removal empties the channel, the property's value resolved at the playhead immediately before removal SHALL be written to the base param and the channel SHALL be deleted. [PORT A-014, A-016]

#### Scenario: Last key removed
- **WHEN** a property has a single key with value 40 and base value 10, and the key is removed
- **THEN** the channel no longer exists and the base value is 40

#### Scenario: Undo restores the channel
- **WHEN** the user undoes that removal
- **THEN** the key and the previous base value 10 are restored

### Requirement: Keyframe diamonds on clips
A selected element at least 40 px wide on the timeline SHALL show a row of diamonds at its keyframe times; keyframes of different properties at the same tick SHALL merge into one diamond. A diamond SHALL be filled with the primary colour when any of its keyframes is selected and white otherwise, 10 px across on desktop/web with a 14 px hit box, and 12 px with a 32 px touch target on mobile. Unselected elements and elements narrower than 40 px SHALL show no diamonds. [PORT A-008]

#### Scenario: Merged diamond
- **WHEN** Position X and Opacity both have keys at local 1 s
- **THEN** one diamond is drawn at 1 s

#### Scenario: Narrow clip
- **WHEN** the selected clip is 30 px wide at the current zoom
- **THEN** no diamonds are drawn

### Requirement: Expanded keyframe lanes and keyframe panel
Each element SHALL have an "Expand keyframes" toggle in its context menu and in the timeline toolbar ("Show keyframes" / "Hide keyframes", acting on the selection). When expanded, one 20 px lane per animated property path SHALL be drawn beneath the element in the group order of `Animatable property paths`, with the property label in the track-label column and a keyframe toggle, previous and next buttons per lane. The track height SHALL grow by the lanes of its tallest expanded element. This requirement is the single definition of lane persistence: the expanded state SHALL be stored per device as `local.timelineViewState.expandedKeyframeElementIds[]` (`project-document.Device-local section`; presented by `timeline-editing.Timeline view state persistence`), so it survives reload on that device and is not synchronised, ids of elements that no longer exist SHALL be dropped on load, and toggling SHALL not create undo steps. Elements with no keyframes SHALL show the menu item disabled. On mobile, lanes SHALL not be shown; all keyframes appear as merged diamonds on the selected clip. The registry action that shows and hides the keyframe panel is `keyframe.panel.toggle`. [PORT A-009] [CAPCUT CC-093] [NEW]

#### Scenario: Expand
- **WHEN** an element has keys on Position X, Opacity and one effect param and the user expands it
- **THEN** three lanes appear in the order Position X, Opacity, effect param, each 20 px high, and the track grows by 60 px

#### Scenario: State survives reload
- **WHEN** the project is closed and reopened
- **THEN** the element is still expanded

#### Scenario: Deleted element is dropped
- **WHEN** an expanded element is deleted, the project is saved and reopened
- **THEN** `expandedKeyframeElementIds` no longer contains its id

### Requirement: Keyframe click selection
Clicking a keyframe diamond SHALL seek the playhead to that keyframe's time (frame-snapped) and select only it. Ctrl/Cmd+click SHALL toggle the keyframe in the selection without clearing others. Shift+click SHALL select the range from the anchor keyframe to the clicked one in time-then-path order; Shift+Ctrl/Cmd+click SHALL add that range to the selection. A plain click on an empty lane area SHALL clear the keyframe selection. Selecting elements SHALL clear the keyframe selection. Clicking a merged inline diamond SHALL select all keyframes merged in it. [PORT A-010, A-011]

#### Scenario: Click seeks and selects
- **WHEN** the user clicks a keyframe at local 1.5 s on an element starting at 4 s
- **THEN** the playhead moves to 5.5 s and only that keyframe is selected

#### Scenario: Range selection
- **WHEN** the anchor is the key at 1 s and the user Shift+clicks the key at 3 s in the same lane
- **THEN** all keys from 1 s to 3 s in time-then-path order are selected

#### Scenario: Toggle
- **WHEN** the user Ctrl/Cmd+clicks a selected keyframe
- **THEN** it is deselected and the others stay selected

### Requirement: Keyframe box selection
Dragging on empty lane area SHALL draw a selection rectangle that selects every keyframe whose 14 px hit box intersects it; with Ctrl/Cmd held the result SHALL be added to the existing selection. The drag SHALL start only after 5 px of movement. [PORT A-012]

#### Scenario: Box select across lanes
- **WHEN** the rectangle covers two keys in the Opacity lane and one in the Position X lane
- **THEN** those three keyframes are selected

#### Scenario: Additive
- **WHEN** one keyframe is selected and the user box-selects two others with Ctrl/Cmd held
- **THEN** three keyframes are selected

### Requirement: Drag keyframes in time
This requirement is the single definition of keyframe drag and its snapping. Dragging a selected keyframe horizontally past a 5 px threshold SHALL move all selected keyframes by the same frame-rounded delta, each clamped to `[0, element duration]`. The dragged (anchor) key SHALL snap, within the snap threshold of `timeline-editing.Snapping` (10 px on desktop/web, 12 pt on mobile), to: the playhead, markers, beat markers when "Snap to beats" is on, the owning element's start and end, and keyframes of other channels and of other elements; it SHALL never snap to a key in the moving selection. Holding Shift SHALL disable snapping for the gesture, and the Auto snapping toggle of `timeline-editing.Snapping` applies; with snapping off or bypassed the drag uses frame rounding only. A snap line SHALL be drawn at the snapped time. Vertical movement SHALL be ignored. A moved key landing on a tick occupied by an unselected key of the same channel SHALL replace that key. The move SHALL preview live and commit as one undo step (a batch when several keys move). Escape during the drag SHALL cancel it. On mobile the drag SHALL start after a 400 ms long-press on a diamond. [PORT A-013]

#### Scenario: Move two keys
- **WHEN** keys at 1 s and 2 s are selected and dragged right by 15 frames on a 30 fps project
- **THEN** they are at 1.5 s and 2.5 s, and one undo returns both

#### Scenario: Clamp at the element end
- **WHEN** a key at 9.8 s on a 10 s element is dragged right by 1 s
- **THEN** it stops at 10 s

#### Scenario: Snap to the playhead
- **WHEN** Auto snapping is on, the playhead is at local 3 s and the user drags a key to within 10 px of it
- **THEN** the key lands exactly on local 3 s and a snap line is shown

#### Scenario: Shift disables snapping
- **WHEN** the same drag is made with Shift held
- **THEN** the key lands on the frame nearest the pointer and no snap line is shown

#### Scenario: Selected keys are not snap targets
- **WHEN** two selected keys 4 frames apart are dragged together
- **THEN** neither snaps to the other and their spacing stays 4 frames

### Requirement: Delete keyframes
With keyframes selected, Delete/Backspace SHALL remove them (keyframes take precedence over elements, and mask points take precedence over keyframes, in the delete dispatch). The context menu of a keyframe SHALL offer "Delete keyframe", and each property's menu SHALL offer "Remove all keyframes", which applies `Removing the last keyframe` semantics using the value at the playhead. Deletion of several keyframes SHALL be one undo step. [PORT A-014] [CAPCUT CC-096]

#### Scenario: Delete selected keys
- **WHEN** three keyframes are selected and the user presses Delete
- **THEN** those three are removed, the element remains, and one undo restores them

#### Scenario: Remove all on a property
- **WHEN** the user chooses "Remove all keyframes" on Opacity while the resolved opacity at the playhead is 0.6
- **THEN** the channel is deleted and base opacity is 0.6

### Requirement: Keyframe navigation
The actions `keyframe.previous` and `keyframe.next` SHALL move the playhead to the nearest keyframe before or after the playhead on the selected element (across all its animated properties, or within one lane when invoked from that lane's buttons). They SHALL be available as buttons beside each keyframe toggle, as lane buttons, and as rebindable actions in `keyboard-shortcuts`. When there is no keyframe in that direction the action SHALL do nothing and the button SHALL be disabled. [CAPCUT CC-096] [NEW]

#### Scenario: Next keyframe
- **WHEN** the playhead is at local 0.5 s and keys exist at 1 s and 2 s
- **THEN** `keyframe.next` moves the playhead to the element start + 1 s

#### Scenario: No further keyframe
- **WHEN** the playhead is on the last keyframe
- **THEN** the next button is disabled

### Requirement: Copy and paste keyframes
This requirement is the single definition of keyframe copy, cut and paste; `timeline-editing.Clipboard` only dispatches to it (copy priority: keyframes, else elements). With keyframes selected, Copy SHALL place them on the clipboard as `{sourceElement, items[{path, time, value, handles?, segmentToNext, tangentMode?, easing?}]}`; Cut SHALL copy then delete as one undo step. Paste SHALL target every selected element, or the source element when none is selected. For each target the paste anchor in element-local time SHALL be `playhead − target.startTime`, clamped to `[0, target.duration]`; the earliest copied keyframe SHALL land on the anchor and the others SHALL keep their offsets from it. Keyframes that would land after the target's duration SHALL be dropped (not clamped). A path SHALL be pasted only if it resolves to a keyframable param on the target; `effects.<id>.…` and `masks.<id>.…` paths SHALL be remapped to the target's entry of the same type at the same occurrence index, and skipped when none exists; a path key (`masks.<id>.params.path`) is pasted only onto a freeform mask whose point ids equal the copied key's point ids (in practice the same mask or a duplicate that kept them) and is otherwise skipped and counted in the toast; `retouch.faces.<faceKey>.…` paths are pasted onto the same face key and skipped when the target has no such face. Pasting onto an occupied tick SHALL replace that key; keys beyond the 1 000-key limit of `Keyframe data model` SHALL be skipped. Paste SHALL be one undo step, SHALL select the pasted keyframes, and SHALL show a toast "{n} keyframes not pasted" when any were dropped or skipped. The classic defect of using the absolute playhead time as element-local time MUST NOT be reproduced. [PORT A-015] [NEW]

#### Scenario: Paste uses element-local time
- **WHEN** keys copied from local 0 s and 1 s are pasted onto an element starting at 10 s with the playhead at 12 s
- **THEN** the pasted keys are at local 2 s and 3 s (timeline 12 s and 13 s)

#### Scenario: Keys beyond the duration are dropped
- **WHEN** the same keys are pasted with the playhead 0.5 s before the end of the target
- **THEN** one key is pasted at `duration − 0.5 s`, the other is dropped and the toast reports 1 keyframe not pasted

#### Scenario: Paste onto several elements
- **WHEN** two keys are copied and pasted with three elements selected
- **THEN** each of the three elements receives both keys at its own local anchor, and one undo removes all six

#### Scenario: Incompatible path
- **WHEN** `volume` keyframes are pasted onto an image element
- **THEN** nothing is pasted and the toast reports them as not pasted

#### Scenario: Playhead outside the target
- **WHEN** the playhead is before the target's start
- **THEN** the anchor is local 0

#### Scenario: Cut
- **WHEN** three keyframes are selected and the user invokes Cut
- **THEN** the three keys are on the clipboard and removed from the element, and one undo restores them

#### Scenario: Path key onto a different pen mask
- **WHEN** a path keyframe is copied and pasted onto an element whose freeform mask has other point ids
- **THEN** nothing is pasted for that path and the toast reports 1 keyframe not pasted

### Requirement: Easing presets
The editor SHALL provide these built-in easing presets as normalised cubic beziers `[x1, y1, x2, y2]`, grouped as shown:

| Group | Preset | Bezier |
|---|---|---|
| Basic | Linear | 0, 0, 1, 1 |
| Basic | Smooth | 0.25, 0.1, 0.25, 1 |
| Basic | Pop | 0.175, 0.885, 0.32, 1.275 |
| In | Ease in | 0.8, 0, 1, 1 |
| In | Quad in | 0.55, 0.085, 0.68, 0.53 |
| In | Cubic in | 0.55, 0.055, 0.675, 0.19 |
| Out | Ease out | 0, 0, 0.2, 1 |
| Out | Quad out | 0.25, 0.46, 0.45, 0.94 |
| Out | Cubic out | 0.215, 0.61, 0.355, 1 |
| Ease | In out | 0.4, 0, 0.2, 1 |
| Ease | Quad in out | 0.455, 0.03, 0.515, 0.955 |
| Ease | Cubic in out | 0.645, 0.045, 0.355, 1 |
| Ease | Expo in out | 1, 0, 0, 1 |

Applying a preset to a segment whose bezier equals `[0, 0, 1, 1]` SHALL store it as `linear` with handles removed; any other value SHALL store `bezier` with handles. A preset tile SHALL be shown as active when the segment's bezier matches it within 0.02 on every component. [PORT A-019] [CAPCUT CC-094]

#### Scenario: Apply Ease out
- **WHEN** the user applies "Ease out" to a segment
- **THEN** the segment is `bezier` with normalised handles `[0, 0, 0.2, 1]` and the "Ease out" tile is active

#### Scenario: Linear is stored as linear
- **WHEN** the user applies "Linear"
- **THEN** the segment is stored as `linear` with no handles

### Requirement: Graph editor availability
The timeline toolbar SHALL have a "Graph editor" button. It SHALL be enabled when at least one keyframe is selected or an element with animated properties is selected. When disabled, or when the easing view cannot edit the current selection, the UI SHALL state the reason using these messages: "Select a keyframe to edit its curve."; "Selected keyframes must be on the same element."; "Select a keyframe that has an outgoing segment."; "Hold segments have a fixed value - easing has no effect here."; "Cannot edit a segment where both keyframes are at the same time."; "Selected properties do not share a graph-editable channel." The editor SHALL offer two views, Easing and Curves, remembered per user. [PORT A-017] [CAPCUT CC-095]

#### Scenario: Nothing selected
- **WHEN** nothing is selected
- **THEN** the button is disabled with the tooltip "Select a keyframe to edit its curve."

#### Scenario: Keys on two elements
- **WHEN** keyframes on two different elements are selected
- **THEN** the editor shows "Selected keyframes must be on the same element." and no curve

#### Scenario: Last key of a channel
- **WHEN** only the last keyframe of a property is selected and the Easing view is open
- **THEN** the view shows "Select a keyframe that has an outgoing segment."

### Requirement: Graph editor easing view
The Easing view SHALL edit the outgoing segment of each selected keyframe (scalar, colour and path channels alike; for a path key the bezier is its `easing`) as a normalised cubic bezier in a 140×94 px graph (desktop/web; full sheet width at the same aspect ratio on mobile) with two draggable handles. Handle X SHALL be clamped to 0–1 and Y to −0.5–1.5; Y SHALL snap to 0 or 1 within 0.06 unless Shift is held. When several selected segments exist (several properties, or several consecutive keys), the edit SHALL apply to all of them; for multi-component properties a component switcher SHALL choose which component's curve is displayed while the edit applies to all components. Dragging SHALL preview live through the render-only preview layer and commit one undo step on release. Escape or closing the editor during a drag SHALL discard the preview. The view SHALL show the preset tiles of `Easing presets` and a "Saved" tab (`Saved easing presets`). [PORT A-017, A-018] [CAPCUT CC-095]

#### Scenario: Drag a handle
- **WHEN** the user drags the first handle to (0.6, 0.0) and releases
- **THEN** the segment's normalised bezier starts with `0.6, 0` and one undo step is recorded

#### Scenario: Snap
- **WHEN** a handle is dragged to Y = 0.97 without Shift
- **THEN** its Y is stored as 1

#### Scenario: Escape discards
- **WHEN** the user presses Escape while dragging
- **THEN** the segment keeps its previous easing and no undo step is recorded

#### Scenario: Multiple properties
- **WHEN** keyframes of Position X and Opacity at the same time are selected and "Pop" is applied
- **THEN** both outgoing segments become the Pop bezier in one undo step

### Requirement: Graph editor curves view
The Curves view SHALL be a full value-over-time editor for all animated scalar channels of the selected element. On desktop/web it SHALL open as a panel docked above the timeline, 240 px high by default and resizable 160–480 px, sharing the timeline's horizontal zoom, scroll and playhead; on mobile it SHALL open as a bottom sheet 50% of the screen height showing one channel at a time with a channel picker. It SHALL provide: a channel list with visibility checkboxes and a colour per channel (channels of selected keyframes visible by default); a value axis with numeric labels that auto-fits visible keys with 10% padding on open and on the action `graph.fit` ("Fit" button; default binding defined only in `keyboard-shortcuts`); vertical zoom by Ctrl/Cmd+wheel or pinch and pan by middle-drag, Space+drag or two-finger drag; keys drawn as 8 px squares and tangent handles as 6 px circles for selected keys on bezier segments; click, Ctrl/Cmd+click, Shift+click and box selection of keys; dragging keys in time (frame-snapped, clamped to the element range, Shift constrains to one axis) and in value (clamped to the param's min/max and snapped to its step); double-click on a curve to insert a key at that time with the curve's value; Delete to remove selected keys; a key context menu to set the segment type (Linear, Hold, Bezier) and tangent mode; and a channel-list context menu with "Before first key: Hold / Linear" and "After last key: Hold / Linear", each writing the channel's `extrapolation` as one undoable `update curve` command. Every drag SHALL preview live and commit one undo step. Composite colour channels SHALL be shown as four curves (R, G, B, A) that move together in time. Discrete channels and the path channel SHALL be listed as step rows with draggable keys and no value axis; a path key's segment type is set from its context menu and its bezier in the Easing view. [PORT A-017, A-018] [CAPCUT CC-095] [NEW]

#### Scenario: Multi-key curve
- **WHEN** an element has four Opacity keys and the Curves view is opened
- **THEN** one continuous curve through all four keys is drawn against a value axis covering their range with 10% padding

#### Scenario: Drag a key in value
- **WHEN** the user drags an Opacity key upward beyond 1
- **THEN** its value stops at 1 and one undo step is recorded on release

#### Scenario: Insert a key on the curve
- **WHEN** the user double-clicks the Position X curve at local 1.2 s
- **THEN** a key is created at the nearest frame to 1.2 s with the curve's value there, and the curve shape on both sides is unchanged within 0.5% of the value range

#### Scenario: Set extrapolation
- **WHEN** the user chooses "After last key: Linear" on the Position X channel
- **THEN** the channel stores `extrapolation.after = "linear"`, the curve is drawn continuing along its last tangent to the element end, and one undo restores Hold

#### Scenario: Empty state
- **WHEN** the selected element has no animated properties
- **THEN** the view shows "No keyframes on this clip. Add a keyframe from the inspector."

### Requirement: Tangent handles and modes
In the Curves view a key's handles SHALL be editable by dragging, with `dt` clamped so that a handle never passes the neighbouring key in time (the curve stays a function of time). Tangent modes SHALL behave as follows: `auto` computes both handles from the neighbouring keys (Catmull-Rom slope, one-third of each segment length) and recomputes them when neighbours move; `flat` sets both slopes to 0; `aligned` keeps the two handles collinear while allowing different lengths; `broken` lets each handle move independently. Dragging a handle on an `auto` or `flat` key SHALL switch the key to `aligned`; Alt+drag SHALL switch it to `broken`. Converting a segment to Bezier SHALL create handles from the `auto` rule when none exist. [PORT A-018] [CAPCUT CC-095] [NEW]

#### Scenario: Aligned handles
- **WHEN** the user drags the right handle of an `aligned` key upward
- **THEN** the left handle rotates to remain collinear and keeps its length

#### Scenario: Break tangents
- **WHEN** the user Alt+drags the right handle
- **THEN** the key's mode becomes `broken` and the left handle does not move

#### Scenario: Handle cannot pass the next key
- **WHEN** the right handle is dragged to a time beyond the next key
- **THEN** its `dt` stops at the distance to the next key

### Requirement: Saved easing presets
The "Saved" tab SHALL have a "Save" tile that stores the current easing as "Custom N" (N = lowest unused positive integer). Saved presets SHALL be stored in user preferences on the device (`project-storage.UI preference storage`), updated live in every open editor window, and synchronised to paired devices through `cross-device-sync.Library item sync`. Each saved preset SHALL support apply, rename (inline, 1–40 characters, trimmed; an empty name is rejected and a duplicate name is auto-suffixed " (2)") and delete (hover button on desktop/web, long-press menu on mobile). At most 100 presets SHALL be stored; beyond that Save SHALL be disabled with the tooltip "Preset limit reached (100)". With none saved the tab SHALL show "Save a curve to reuse it here". When an OpenCut classic bundle is imported (`projects.OpenCut classic data import`), the entries of its `graph-editor-presets` key SHALL be added as saved presets with their names and bezier values, skipping entries whose four numbers are not finite or whose x values are outside 0–1, and stopping at the limit of 100. [PORT A-020] [NEW]

#### Scenario: Save and reuse
- **WHEN** the user saves the current curve and applies "Custom 1" to another segment
- **THEN** that segment's bezier equals the saved values

#### Scenario: Rename
- **WHEN** the user renames "Custom 1" to "Snap"
- **THEN** the tile is labelled "Snap" after reload, and saving a new preset names it "Custom 1"

#### Scenario: Empty name rejected
- **WHEN** the user clears the name and confirms
- **THEN** the previous name is kept

#### Scenario: Classic presets imported
- **WHEN** a classic bundle whose `graph-editor-presets` holds "Snappy" = [0.2, 0.9, 0.3, 1] and one entry with a non-numeric value is imported
- **THEN** "Snappy" is listed in the Saved tab with that bezier and the invalid entry is not added

### Requirement: Clip animation model
Video, image, sticker, graphic and compound elements SHALL support `clipAnimation {in?, out?, combo?}`, whose stored shape (each slot `{type, duration, strength}`, `combo` additionally `followsDuration`) is defined by `project-document.Motion blur and clip animation fields`. `combo` SHALL be mutually exclusive with `in` and `out`: setting a combo clears both, and setting an in or out clears the combo, in one undo step. `duration` is in ticks, frame-aligned, from 0.1 s to the smaller of 5.0 s and the element duration for in and out (default 0.5 s), with `in.duration + out.duration ≤ element duration`; for combo from 0.1 s to the element duration (default: the element duration; while `combo.followsDuration` is true it follows the element duration, and the first edit of the combo duration by the user sets it to false). `strength` is 0–100, default 100, and scales the animation's translation, scale deviation from 100 %, rotation and blur amounts linearly (0 = only the opacity and reveal components remain). In runs over `[0, in.duration]`, Out over `[duration − out.duration, duration]`, Combo over `[0, combo.duration]`. A clip animation SHALL NOT create or modify keyframes: it is an additional layer of transform, opacity, blur and reveal values evaluated at the frame start time from the tables of `Bundled clip animation library`, composed with the element's own (possibly keyframed) values as follows — translation is added, scale is multiplied, rotation is added, opacity is multiplied. Where each component is applied in the render order is defined only by `render-engine.Per-layer stage order`: the transform component in the `transform` stage (element transform × clip-animation transform), the opacity component in the `opacity` stage (element opacity × clip-animation opacity), and the blur and reveal components at the position that requirement assigns to clip-animation passes. Visual fades are clip animations; visual elements have no `fadeIn`/`fadeOut` fields. Text elements use the text animations of `text-and-titles.Text animations in, out and loop` instead, and stickers and shapes use In, Out and Combo of this requirement (there is no separate Loop group; the looping Combo animations are Swing, Pendulum, Bounce, Wobble, Shake and Zoom Pulse). [CAPCUT CC-087, CC-088, CC-089, CC-090] [NEW]

#### Scenario: In and Out together
- **WHEN** a 4 s clip has Fade In 0.5 s and Fade Out 1.0 s
- **THEN** opacity rises from 0 to 1 over the first 0.5 s, is 1 until 3.0 s and falls toward 0 over the last 1.0 s

#### Scenario: Combo replaces In and Out
- **WHEN** the user selects a Combo animation on that clip
- **THEN** the In and Out slots are cleared and one undo restores them

#### Scenario: Durations cannot overlap
- **WHEN** the clip lasts 1.0 s with In 0.6 s and the user sets Out to 0.8 s
- **THEN** Out is clamped to 0.4 s

#### Scenario: Trimming a clip shorter
- **WHEN** a clip with In 0.5 s and Out 0.5 s is trimmed to 0.6 s
- **THEN** both durations are scaled proportionally to 0.3 s in the same undo step as the trim

#### Scenario: Composes with keyframes
- **WHEN** an element has position keyframes and a Slide In Left animation
- **THEN** the slide offset is added to the keyframed position and the keyframes are unchanged

#### Scenario: Opacity multiplies
- **WHEN** an element with opacity 50 % has Fade In 1.0 s and local time is 0.5 s
- **THEN** the layer's opacity is 25 %

#### Scenario: Not available on text
- **WHEN** a text element is selected
- **THEN** the Animation tab shows the text animations of `text-and-titles.Text animations in, out and loop` and `jc_clip_animation` on that element fails with `INVALID_PARAMS`

### Requirement: Bundled clip animation library
The app SHALL ship exactly 44 clip animations — 16 In, 16 Out and 12 Combo — written for this project and available offline. Their ids and names are listed below; `catalog.md` next to this spec is normative for every animation's per-channel keyframe table `(u, value, easing)`, where `u` is the normalised position in the slot's duration, and for the units, the jitter function and the reveal definition.

| Group | Type id — Name |
|---|---|
| In (16) | `fade-in` — Fade In; `zoom-in` — Zoom In; `zoom-out-in` — Zoom Out; `slide-in-left` — Slide In Left; `slide-in-right` — Slide In Right; `slide-in-up` — Slide In Up; `slide-in-down` — Slide In Down; `spin-in` — Spin In; `swing-in` — Swing In; `bounce-in` — Bounce In; `drop-in` — Drop In; `pop-in` — Pop In; `blur-in` — Blur In; `flip-in` — Flip In; `wipe-in` — Wipe In; `shake-in` — Shake In |
| Out (16) | `fade-out` — Fade Out; `zoom-out` — Zoom Out; `zoom-in-out` — Zoom In; `slide-out-left` — Slide Out Left; `slide-out-right` — Slide Out Right; `slide-out-up` — Slide Out Up; `slide-out-down` — Slide Out Down; `spin-out` — Spin Out; `swing-out` — Swing Out; `bounce-out` — Bounce Out; `drop-out` — Drop Out; `pop-out` — Pop Out; `blur-out` — Blur Out; `flip-out` — Flip Out; `wipe-out` — Wipe Out; `shake-out` — Shake Out |
| Combo (12) | `zoom-pulse` — Zoom Pulse; `slide-through` — Slide Through; `spin-through` — Spin Through; `swing` — Swing; `pendulum` — Pendulum; `bounce` — Bounce; `wobble` — Wobble; `shake` — Shake; `flip-through` — Flip Through; `stretch` — Stretch; `drift-in` — Drift In; `drift-out` — Drift Out |

All In animations end, and all Out animations start, at the element's unmodified state (translation 0, scale 100 %, rotation 0°, opacity 1, blur 0, reveal 1). Every animation SHALL be rendered deterministically from element-local time and the element id only. A resolved channel value at any `u` SHALL equal the value interpolated from the catalogue table within 0.5 % of the channel's full range. [CAPCUT CC-087, CC-088, CC-089] [NEW]

#### Scenario: Slide In Left at half strength
- **WHEN** Slide In Left is applied with strength 50 on a 1920 px wide canvas
- **THEN** at local time 0 the element is offset 960 px to the left of its resting position and at `in.duration` the offset is 0

#### Scenario: Out mirrors In
- **WHEN** Fade Out 1.0 s is applied to a 3 s clip
- **THEN** opacity is 1 at 2.0 s and 0.5 at 2.5 s, and the last rendered frame has opacity below 0.04

#### Scenario: Looping combo
- **WHEN** Zoom Pulse runs for 3 s
- **THEN** the element reaches 115% scale three times, at 0.5 s, 1.5 s and 2.5 s

#### Scenario: Table-driven values
- **WHEN** each of the 44 animations is evaluated at `u` = 0, 0.5 and 1 with strength 100
- **THEN** every channel value equals the value given by its `catalog.md` table within 0.5 % of the channel's range

#### Scenario: Deterministic jitter
- **WHEN** Shake is rendered twice at the same local time on the same element
- **THEN** both frames are pixel-identical, and a second element with a different id shows a different jitter offset at that time

#### Scenario: Library counts
- **WHEN** the Animation panel is opened offline
- **THEN** the In, Out and Combo tabs list exactly 16, 16 and 12 animations respectively, each preceded by a "None" tile

### Requirement: Clip animation panel
For eligible elements the inspector (desktop/web) SHALL show the "Animation" tab named in `preview-canvas.Inspector structure per element type` with three sub-tabs In, Out and Combo, each a grid of tiles (animated thumbnail on hover, "None" first), a search field, a Duration slider with a numeric field in seconds (step 0.1 s) and a Strength slider (0–100). Selecting a tile SHALL apply it as one undo step and play the affected range once in the preview (In: the first `duration`; Out: the last `duration`; Combo: the combo range), then return the playhead to where it was. Mobile entry: the "Animations" item of `mobile-editor.Video clip tool strip` (and the sticker strip of `mobile-editor.Text group, text clip and sticker strips`); this capability defines the sheet content — the same three tabs, tiles and sliders — and the sheet follows the commit and discard rules of `mobile-editor.Tool sheets never cover the preview` (taps preview live; ✓ commits one undo step; ✕ discards). The Combo tab SHALL show a notice "Combo replaces In and Out" when either is set. With several eligible elements selected, the choice SHALL apply to all of them, each with its duration clamped to its own length. The tab SHALL also contain the "Motion styles" entry of `Camera-motion styles entry point` and the Motion blur control of `visual-effects-filters.Motion blur`. [CAPCUT CC-087, CC-088, CC-089, CC-090]

#### Scenario: Apply and auto-preview
- **WHEN** the user clicks "Bounce In" with the playhead at 7 s on a clip starting at 5 s
- **THEN** the preview plays 5.0 s to 5.5 s once and the playhead returns to 7 s

#### Scenario: None removes
- **WHEN** the user selects "None" on the In tab
- **THEN** the `in` slot is removed and Out is unchanged

#### Scenario: Duration slider limit
- **WHEN** the clip lasts 2 s and has Out 0.5 s
- **THEN** the In duration slider's maximum is 1.5 s

#### Scenario: Mobile discard
- **WHEN** the user taps "Spin In" in the mobile Animations sheet and then taps ✕
- **THEN** the clip's `clipAnimation` is as it was before the sheet opened and no undo step was recorded

### Requirement: Clip animation timeline affordance
A clip with an In animation SHALL show a translucent band with a right-pointing arrow over its first `in.duration`; with an Out animation, a band over its last `out.duration`; with a Combo, a band with a double arrow over `combo.duration`. Bands SHALL be 6 px high along the bottom edge of the clip. On desktop/web, dragging the inner edge of a band SHALL change that duration (frame-snapped, with a tooltip in seconds) as one undo step. Split SHALL keep `in` on the left part and `out` on the right part; a combo SHALL be kept on both parts with its duration clamped. [NEW]

#### Scenario: Drag the In band
- **WHEN** the user drags the right edge of the In band from 0.5 s to 1.2 s
- **THEN** `in.duration` is 1.2 s and the tooltip showed "1.2s"

#### Scenario: Split
- **WHEN** a clip with In and Out animations is split in the middle
- **THEN** the left part has only In and the right part has only Out

### Requirement: Camera-motion styles entry point
The Animation tab SHALL include a "Motion styles" entry that opens the flow of `ai-editing-tools.AI movement` (tool id `motion-style`) with the selected video or image clip preselected. That requirement is the single owner of AI movement: the style list (Zoom in, Zoom out, Push, Shake, Soft sway, Dynamic), the Intensity parameter, the analysis it runs, where it executes, its failure handling and the refusal when the target channels hold keyframes of the user. This capability defines only the entry point and the contract of the result so that it stays editable with the tools of this capability: the flow SHALL write ordinary keyframes on `transform.position.x`, `transform.position.y`, `transform.scale.x`, `transform.scale.y` and `transform.rotation` of the clip as one undo step, within the 1 000-key limit of `Keyframe data model`; it SHALL record the ids of the keys it wrote in the element's `aiMotion {style, intensity, keyIds[]}` (`project-document.Analysis-driven settings`), which is how a re-applied style replaces exactly its own keys; and it SHALL NOT use the `clipAnimation` slots. Commands of this capability keep that record true: deleting one of those keys removes its id from `aiMotion.keyIds` in the same command, moving or editing one keeps its id (the key stays a key of the tool), and removing all of them removes `aiMotion`. The same rule applies to `autoReframe.keyIds` written by `ai-editing-tools.Auto reframe`. The entry SHALL be disabled with the tooltip "Select one video or image clip" for any other selection. Mobile entry: "Animations ▸ Motion styles" in `mobile-editor.Video clip tool strip`. [CAPCUT CC-097] [NEW]

#### Scenario: Result is plain keyframes
- **WHEN** a motion style is applied to a clip
- **THEN** the clip has transform keyframes visible in the lanes and the Curves view, its `clipAnimation` is unchanged, and one undo removes all of them

#### Scenario: Result is editable
- **WHEN** a motion style was applied and the user drags one of the generated Position X keys in the Curves view
- **THEN** the key moves like any other keyframe and the edit is one undo step

#### Scenario: Wrong selection
- **WHEN** a text element or two clips are selected
- **THEN** the "Motion styles" entry is disabled with the stated tooltip

#### Scenario: Deleting a generated key updates the record
- **WHEN** a motion style wrote 6 keys and the user deletes one of them in the lanes
- **THEN** `aiMotion.keyIds` holds the 5 remaining ids, in the same undo step

### Requirement: Keyframe commands, undo and agent access
All keyframe and clip-animation mutations SHALL be undoable commands: upsert, remove, retime (move), update curve (segment type, handles, tangent mode, extrapolation), paste, set clip animation, clear clip animation. Batched gestures SHALL undo as one step. The same commands SHALL be exposed to agents through `jc_keyframe_set`, `jc_keyframe_remove`, `jc_keyframe_properties` and `jc_clip_animation` (`agent-editing-tools.Tool naming and families`): `jc_keyframe_set` accepts either `segmentToNext` with handles or a named preset of `Easing presets`, which it stores as that preset's bezier; `jc_clip_animation` takes `{slot: in|out|combo, type, duration, strength}` and is refused on text elements. Animations SHALL be saved with the project and copied by duplicate, copy/paste of elements and compound-clip creation. Keyframe time adjustments caused by other edits are defined by their owners: `timeline-editing.Trimming elements`, `timeline-editing.Split` and `speed-retime.Effect of retime on keyframes and animations`. [PORT A-013, A-014, A-015] [NEW]

#### Scenario: Undo a multi-key drag
- **WHEN** five keyframes are moved in one drag and the user presses undo once
- **THEN** all five return to their original times

#### Scenario: Duplicate copies animation
- **WHEN** an element with keyframes and an In animation is duplicated
- **THEN** the copy has the same channels (with new key ids) and the same `clipAnimation`

#### Scenario: Agent easing preset
- **WHEN** `jc_keyframe_set` writes a key with easing preset "Ease out"
- **THEN** the key's outgoing segment is stored as `bezier` with normalised handles `[0, 0, 0.2, 1]`
