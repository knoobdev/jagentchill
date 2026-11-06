## ADDED Requirements

### Requirement: Mask data model
The stored shape of a mask entry — `masks[]` of up to 8 entries `{id, type, enabled, combine, params, tracking?}`, the 10 types, every `params` key with its stored unit, range and default, and the freeform path points — is defined only by `project-document.Mask fields` (catalogue §7.5); this capability restates no field shape and owns the meaning of each parameter, the UI and the commands. The parameter tables of this capability give DISPLAYED units; where the stored unit differs it is the one of that requirement: `centerX` and `centerY` are stored as fractions −1…1 of the element's half size and displayed as −100…100 %; `scale` is stored as 0.01–5 and displayed as 1–500 %; `feather` is stored 0–1000 and displayed 0–100 %; colours are stored as lowercase hex. This capability owns the meaning of each combine mode as a set operation; the per-pixel compositing maths of several masks is defined only by `render-engine.Multi-mask compositing with feather`. A project migrated from OpenCut classic keeps its single mask as `masks[0]` with the values given by `project-document.Classic v31 mapping` (`enabled: true`, `combine: "add"`, `params.opacity: 100`, rectangle `params.cornerRadius: 0`, star `params.points: 5` and `params.innerRatio: 0.45`). Masks SHALL be copied by split (both parts), duplicate, copy/paste and compound-clip creation, each copy receiving new mask ids (animation paths `masks.<maskId>.params.<key>` are rewritten to the new ids; pen point ids are kept). Agents write masks through `jc_mask_set {type, combine, enabled, params}` with the stored names, units and ranges. [PORT K-021, N-016] [NEW]

#### Scenario: Migrated classic mask
- **WHEN** a classic project whose video element has one rectangle mask is opened
- **THEN** the element has `masks.length = 1`, the mask renders identically, its `combine` is `add`, its `params.opacity` is 100 and its `params.cornerRadius` is 0

#### Scenario: Migrated ellipse has no corner radius
- **WHEN** a classic project whose image element has one ellipse mask is opened
- **THEN** the mask's params contain no `cornerRadius` key

#### Scenario: Limit of eight
- **WHEN** an element has 8 masks
- **THEN** the "Add mask" button is disabled with the tooltip "Maximum of 8 masks per clip", and a `jc_mask_set` call that would add a ninth fails with `OUT_OF_RANGE` (`agent-editing-tools.Validation`)

#### Scenario: Stored and displayed units
- **WHEN** the user types 50 % into Position X and 150 % into Scale of a rectangle mask
- **THEN** the mask stores `params.centerX = 0.5` and `params.scale = 1.5`

### Requirement: Maskable element types
Masks SHALL be available on exactly these element types: video (including freeze elements), image, graphic, sticker, compound and adjustment (where the mask limits the adjusted area). Text, caption, effect (effect or filter kind) and audio elements SHALL NOT take masks; `timeline-editing.Track types and element compatibility` and `render-engine.Scene node types` use this set. The mask controls live in the inspector locations named by `preview-canvas.Inspector structure per element type`: the "Mask" sub-tab of the Video, Image and Sticker tabs, the "Mask" tab of a graphic, and the "Parameters" tab of an adjustment layer; they SHALL be shown only for maskable elements. Mobile entry: the "Mask" item of `mobile-editor.Video clip tool strip`. Mask coordinates SHALL be in the element's own space, so a mask moves, scales and rotates with its element. [PORT K-022] [NEW]

#### Scenario: Mask follows the element
- **WHEN** an element with an ellipse mask is moved 100 px right and rotated 30°
- **THEN** the visible ellipse moves and rotates with the element and its stored mask params are unchanged

#### Scenario: Text element
- **WHEN** a text element is selected
- **THEN** no Mask sub-tab is shown

#### Scenario: Sticker element
- **WHEN** a sticker element is selected
- **THEN** its Sticker tab offers the Mask sub-tab and a mask added there clips the sticker

### Requirement: Base mask parameters
Every mask SHALL have these params:

| Param | Range, step | Default | Notes |
|---|---|---|---|
| `feather` | 0–1000, step 1 | 0 | displayed as 0–100% (stored ÷ 10); keyframable |
| `strokeWidth` | 0–100 px on the reference canvas (× pixel scale factor), step 1 | 0 | keyframable |
| `strokeColor` | colour | `#ffffff` | keyframable |
| `strokeAlign` | inside / center / outside | center | shown for box-like masks only |
| `inverted` | boolean | false | header toggle; not keyframable |
| `opacity` | 0–100%, step 1 | 100 | scales the mask's coverage; keyframable |

[PORT K-011, K-012, K-013] [CAPCUT CC-144, CC-145] [NEW]

#### Scenario: Feather display mapping
- **WHEN** the user sets Feather to 35% in the panel
- **THEN** the stored `feather` is 350

#### Scenario: Defaults
- **WHEN** a new mask of any type is added
- **THEN** its feather is 0, stroke width 0, stroke colour `#ffffff`, `inverted` false and opacity 100

### Requirement: Box-like masks
The rectangle, ellipse, heart, diamond and star masks SHALL share the params `centerX` and `centerY` (displayed −100…100% of the element's half size, stored −1…1, default 0), `width` and `height` (fractions of the element's short side, minimum 0.01, no maximum, default 0.6, displayed as percent with a minimum of 1%), `rotation` (0–360°, step 1, default 0) and `scale` (displayed 1–500%, stored 0.01–5, default 100%); all are keyframable. A new box-like mask SHALL be a square of 60% of the element's short side centred on the element. The rectangle mask SHALL additionally have `cornerRadius` 0–100% (default 0), where 100% is half of the shorter side. The ellipse mask SHALL be a circle when width equals height. The diamond mask SHALL be the rhombus through the midpoints of the box's sides. The heart mask SHALL be the closed path of four cubic bezier segments given below in box coordinates (x right, y down, box = −0.5…0.5 on both axes), scaled about the box centre so that its tight bounds equal the box:

| Segment | Start | Control 1 | Control 2 | End |
|---|---|---|---|---|
| 1 (bottom tip to left side) | (0, 0.5) | (−0.20, 0.30) | (−0.50, 0.10) | (−0.50, −0.15) |
| 2 (left lobe) | (−0.50, −0.15) | (−0.50, −0.60) | (−0.05, −0.60) | (0, −0.25) |
| 3 (right lobe) | (0, −0.25) | (0.05, −0.60) | (0.50, −0.60) | (0.50, −0.15) |
| 4 (right side to bottom tip) | (0.50, −0.15) | (0.50, 0.10) | (0.20, 0.30) | (0, 0.5) |

[PORT K-003, K-004, K-005, K-006, K-010] [CAPCUT CC-138, CC-139, CC-140, CC-143, CC-146]

#### Scenario: Default rectangle
- **WHEN** a rectangle mask is added to a 1920×1080 element
- **THEN** the visible area is a 648×648 px square centred on the element

#### Scenario: Rounded rectangle
- **WHEN** `cornerRadius` is 100% on a 400×200 px rectangle mask
- **THEN** the mask is a capsule with 100 px corner radii

#### Scenario: Minimum size
- **WHEN** the user types 0 into Width
- **THEN** the stored width is 0.01 (1%)

#### Scenario: Heart shape
- **WHEN** a default heart mask is added to a 1080×1080 element
- **THEN** the mask is mirror-symmetric about the vertical centre line, its bounds are the 648×648 px box, its bottom tip is at the bottom-centre of the box, and the pixel at the top-centre of the box is outside the mask (the notch)

### Requirement: Star mask
The star mask SHALL have, in addition to the box-like params, `points` (3–12, step 1, default 5, not keyframable) and `innerRatio` (0.1–0.95, step 0.01, default 0.45, keyframable), producing a star with `2 × points` vertices whose first outer vertex points up. [PORT K-007] [CAPCUT CC-141] [NEW]

#### Scenario: Classic-compatible default
- **WHEN** a star mask is added with defaults
- **THEN** it has 5 points (10 vertices) and an inner ratio of 0.45

#### Scenario: Points range
- **WHEN** the user types 20 into Points
- **THEN** the stored value is 12

### Requirement: Split mask
The split mask SHALL divide the element along an infinite straight line defined by `centerX`, `centerY` (displayed −100…100%, stored −1…1, default 0) and `rotation` (0–360°, default 0), keeping the side in the direction of the line's normal. It has no size. Feather SHALL be a linear gradient across the line, centred on it, with the width defined in `Mask feather`. Dragging the line's position on canvas SHALL be clamped so the anchor stays inside the element's box. All three params are keyframable. [PORT K-001, K-010] [CAPCUT CC-136]

#### Scenario: Horizontal split
- **WHEN** a split mask with rotation 0 and centre (0, 0) is added
- **THEN** exactly one half of the element is visible, divided by a straight line through its centre

#### Scenario: Inverted split
- **WHEN** the mask is inverted
- **THEN** the other half is visible

#### Scenario: Position clamp
- **WHEN** the user drags the line anchor beyond the element's edge
- **THEN** the displayed `centerX` and `centerY` stay within −100…100 % (stored −1…1)

### Requirement: Mirror mask
The mirror mask SHALL keep a band between two parallel lines placed symmetrically about a centre line, defined by `centerX`, `centerY` (displayed −100…100%, stored −1…1, default 0), `rotation` (0–360°, default 0) and `size` (band thickness as a fraction of the element's short side, 0.01–5, default 0.4); all keyframable. Feather SHALL soften both edges equally. [CAPCUT CC-142] [NEW]

#### Scenario: Default mirror mask
- **WHEN** a mirror mask is added to a 1920×1080 element
- **THEN** a horizontal band 432 px high centred on the element is visible across its full width

#### Scenario: Rotated band
- **WHEN** rotation is 90°
- **THEN** the band is vertical

### Requirement: Cinematic bars mask
The cinematic bars mask (shown to users as "Filmstrip") SHALL keep a full-width band and hide the area above and below it: it is height-only, with `height` default 0.6, width forced to at least the element's diagonal so the band always spans the element at any rotation, plus `centerX`, `centerY` and `rotation`. [PORT K-002] [CAPCUT CC-137]

#### Scenario: Default bars
- **WHEN** the mask is added to a 1920×1080 element
- **THEN** a band 648 px high is visible and bars of 216 px are hidden at the top and bottom

#### Scenario: Only height handles
- **WHEN** the mask is selected on canvas
- **THEN** resize handles appear on the top and bottom edges only

### Requirement: Text mask
The text mask SHALL reveal the element through text glyphs. Params: `content` (default "Mask", multi-line by explicit line breaks only — the text never wraps automatically; at most 2 000 characters), `fontFamily` (default: the default family of `text-and-titles.Text parameter table`, chosen with `text-and-titles.Font picker`), `fontSize` 5–300 (default 15), which is the font's em height as a percentage of the element's short side, `fontWeight` normal/bold, `fontStyle` normal/italic, `textDecoration` none/underline/line-through, `letterSpacing` −100…500 step 1 in thousandths of an em (default 0), `lineHeight` 0.1–10 step 0.1 as a multiple of the font size (default 1.2), `centerX`, `centerY`, `rotation`, `scale` (displayed 1–500%, stored 0.01–5). The panel SHALL provide controls for every one of these, including bold, italic and decoration. Alignment SHALL be centred. When `content` is empty or whitespace the mask SHALL be inactive (the element renders unmasked) and its row SHALL show "Enter text to activate this mask". `fontSize`, `letterSpacing`, `lineHeight`, position, rotation and scale are keyframable. [PORT K-008, K-010] [NEW]

#### Scenario: Text reveals video
- **WHEN** a text mask with content "HELLO" is added to a video element
- **THEN** the video is visible only inside the glyphs of "HELLO"

#### Scenario: Font size unit
- **WHEN** a text mask with `fontSize` 15 is on a 1920×1080 element
- **THEN** its glyphs are laid out with an em height of 162 px (15 % of 1080)

#### Scenario: No automatic wrapping
- **WHEN** the content is one 60-character line wider than the element
- **THEN** the text stays on one line and the parts outside the element's box are not visible

#### Scenario: Blank content
- **WHEN** the content is cleared
- **THEN** the element renders unmasked and the row shows the stated hint

#### Scenario: Bold control
- **WHEN** the user toggles Bold in the mask panel
- **THEN** `fontWeight` becomes `bold` and the glyphs render bold

### Requirement: Pen tool path creation
Choosing "Pen tool" SHALL enter path creation: the preview shows a pen cursor, each click or tap appends an anchor point (the first click also sets the mask centre), and click-and-drag on desktop/web creates a smooth anchor whose tangent handles follow the drag. Clicking the first anchor when at least 3 points exist, or pressing Enter with at least 3 points, SHALL close the path. The mask SHALL NOT affect rendering until the path is closed; while open, the path is drawn as an outline with a rubber-band segment to the pointer. Escape SHALL remove the last point, and with no points left SHALL cancel creation and remove the mask. Backspace SHALL remove the last point. A path SHALL hold at most 256 points. On mobile, tapping adds points and a "Close path" button appears in the sheet once 3 points exist. Completing the path (from the first click to closing) SHALL be one undo step. [PORT K-009, K-016]

#### Scenario: Close a triangle
- **WHEN** the user clicks three positions and then clicks the first anchor
- **THEN** the path is closed and the element is visible only inside the triangle

#### Scenario: Open path does not mask
- **WHEN** only two points have been placed
- **THEN** the element renders unmasked and the outline is shown

#### Scenario: Cancel creation
- **WHEN** the user presses Escape until no points remain
- **THEN** the mask entry is removed and no undo step is recorded

### Requirement: Pen tool point editing
On a closed path, anchors SHALL be drawn as 7 px circles (16 px touch target on desktop/web, 32 px on mobile) and be draggable; Shift+click SHALL toggle an anchor in a multi-point selection, and dragging any selected anchor moves all selected anchors. Clicking a segment (12 px invisible hit stroke) SHALL insert a point at the closest position (parameter clamped to 0.001–0.999) using de Casteljau subdivision so the path shape is unchanged, and select it. Dragging a segment by 4 px or more SHALL move the whole mask. Delete or Backspace SHALL delete the selected points as one command; if fewer than 3 points remain the path SHALL reopen in creation mode. Rotate and feather handles SHALL appear on the path's bounding box, and a corner scale handle SHALL scale the path uniformly about its centre (`scale` 1–500%). All point edits SHALL preview live and commit one undo step. [PORT K-017, K-018, K-014] [NEW]

#### Scenario: Insert on a segment
- **WHEN** the user clicks the middle of a curved segment
- **THEN** a new selected anchor appears there and the rendered mask shape is unchanged within 0.5 px

#### Scenario: Delete to below three points
- **WHEN** a 3-point path has one point deleted
- **THEN** the path is open again, the element renders unmasked and the pen cursor is active

#### Scenario: Move several points
- **WHEN** two anchors are Shift-selected and one is dragged 20 px
- **THEN** both move by 20 px and one undo returns both

### Requirement: Pen tool bezier tangents
Each path point SHALL carry tangent handles `(inX, inY)` and `(outX, outY)` relative to the anchor, and the path SHALL be rendered as cubic bezier segments. A selected anchor SHALL show its two handles as 5 px squares joined to the anchor by lines. Dragging a handle SHALL move the opposite handle to stay collinear with equal length (smooth point); Alt/Option+drag SHALL move only that handle (corner point); double-clicking an anchor SHALL toggle between a corner with zero-length handles and a smooth point whose handles are one-third of the distance to each neighbour along the direction between the neighbours. On mobile, a "Curve / Corner" toggle in the sheet SHALL perform the same conversion and handles SHALL have 32 px touch targets. Handle edits SHALL preview live and commit one undo step. Paths from OpenCut classic (all tangents zero) SHALL load as polygons. [PORT K-009] [CAPCUT CC-148] [NEW]

#### Scenario: Convert a corner to smooth
- **WHEN** the user double-clicks a corner anchor of a square path
- **THEN** the anchor gains collinear handles and the two adjacent segments render as curves

#### Scenario: Break a tangent
- **WHEN** the user Alt+drags one handle
- **THEN** only that handle moves and the opposite handle is unchanged

#### Scenario: Classic polygon
- **WHEN** a classic project's freeform mask is loaded
- **THEN** every segment is straight and each anchor can be converted to smooth

### Requirement: Mask feather
The `feather` param means: the mask edge is softened symmetrically about the mask outline with a total transition width, in pixels on the reference canvas, equal to the stored value (so 1000 gives 1000 px), multiplied by the pixel scale factor of `visual-effects-filters.Resolution-independent effect parameters`; mask coverage is `smoothstep(−feather/2, +feather/2, d)` where `d` is the signed distance to the outline (positive inside); feather 0 gives an anti-aliased hard edge. Feather SHALL always be applied per mask, before masks are combined. The distance-field algorithm and the combination are implemented by `render-engine.Multi-mask compositing with feather`. [PORT K-011] [CAPCUT CC-144]

#### Scenario: Hard edge
- **WHEN** feather is 0
- **THEN** mask coverage goes from 0 to 1 within 1.5 px across the outline

#### Scenario: Soft edge
- **WHEN** feather is 250 and the canvas is 1920×1080
- **THEN** mask coverage is 0.5 on the outline and reaches 0 and 1 at 125 px outside and inside it respectively (±2 px)

#### Scenario: Two masks with different feather
- **WHEN** a rectangle mask with feather 0 and an ellipse mask with feather 200 are combined with `add`
- **THEN** the rectangle's edge is hard and the ellipse's edge is soft where each forms the outline of the union

### Requirement: Mask invert
Each mask row SHALL have an invert toggle bound to `inverted`, which complements that mask's coverage before combination. Toggling SHALL be one undoable command. [PORT K-012] [CAPCUT CC-145]

#### Scenario: Invert an ellipse
- **WHEN** an ellipse mask is inverted
- **THEN** the element is visible everywhere except inside the ellipse

### Requirement: Mask stroke
A mask with `strokeWidth > 0` SHALL draw a stroke of `strokeColor` along its outline as part of the element: the stroke is drawn into the layer's own texture after the masks are applied, so it lies above the masked content and is subject to the element's opacity and blend mode like the rest of the layer (it is never a separate layer; the stage position is defined by `render-engine.Per-layer stage order`). For box-like masks `strokeAlign` SHALL place the stroke inside, centred on or outside the outline; text, split, mirror and pen masks SHALL use a centred stroke. The stroke SHALL be anti-aliased, SHALL follow feather-less geometry (it is not feathered), and its width SHALL be multiplied by the pixel scale factor. With several masks, each enabled mask draws its own stroke. [PORT K-013] [NEW]

#### Scenario: Outside stroke
- **WHEN** a rectangle mask has stroke width 10 and align "outside" on a 1920×1080 canvas
- **THEN** a 10 px band of the stroke colour surrounds the visible rectangle and does not cover the masked content

#### Scenario: No stroke by default
- **WHEN** stroke width is 0
- **THEN** nothing is drawn along the outline

#### Scenario: Stroke follows element opacity and blend
- **WHEN** a masked element with a white 10 px stroke has opacity 50 % and blend mode Multiply over a mid-grey background
- **THEN** the stroke pixels are composited with Multiply at 50 % (they do not appear as opaque white)

### Requirement: Multiple masks and combine modes
The enabled masks of an element SHALL be combined in array order into one coverage per pixel that multiplies the element's alpha. Each mask contributes its own coverage `c = (opacity / 100) × (inverted ? 1 − m : m)`, where `m` is its feathered shape coverage; disabled masks contribute nothing and are omitted from the render data. Every enabled mask, including the first, is combined by its own `combine` mode into the accumulated coverage: `add` = union, `subtract` = the accumulated area minus this mask, `intersect` = only where both cover, `exclude` = where exactly one covers. The starting coverage before the first enabled mask follows `render-engine.Multi-mask compositing with feather`: nothing is covered when the first mask's `combine` is `add` or `exclude` (so the first mask shows its own shape), and everything is covered when it is `subtract` or `intersect` (so a first `subtract` mask cuts its shape out of the whole element and a first `intersect` mask shows its own shape). The exact per-pixel formulas (`max`, `acc × (1 − c)`, `min`, `|acc − c|`) are those of that requirement and are not redefined here; mask `opacity` is stored 0–100 and passed to the engine as 0–1. Each mask row SHALL have an enable toggle (eye), a combine select with the four modes, invert, duplicate and remove buttons, and rows SHALL be reorderable by drag (Alt+Up/Alt+Down from the keyboard). An element whose masks are all disabled SHALL render unmasked. Every one of these operations SHALL be one undoable command. [PORT K-021, N-016] [NEW]

#### Scenario: Add two shapes
- **WHEN** a rectangle mask and an ellipse mask with `combine: add` are enabled
- **THEN** the element is visible inside the union of both shapes

#### Scenario: Subtract
- **WHEN** the second mask's combine is `subtract`
- **THEN** the element is visible inside the rectangle except where the ellipse overlaps it

#### Scenario: Intersect
- **WHEN** the second mask's combine is `intersect`
- **THEN** the element is visible only where both shapes overlap

#### Scenario: Exclude
- **WHEN** the second mask's combine is `exclude` and both masks have feather 0 and opacity 100
- **THEN** the element is visible where exactly one of the two shapes covers and hidden where both or neither cover

#### Scenario: First mask subtracts
- **WHEN** an element's only enabled mask is an ellipse with `combine: subtract`, feather 0 and opacity 100
- **THEN** the element is visible everywhere except inside the ellipse

#### Scenario: Mask opacity
- **WHEN** a single ellipse mask has opacity 50
- **THEN** the element's alpha inside the ellipse is 50 % and outside it is 0

#### Scenario: All disabled
- **WHEN** both masks are disabled
- **THEN** the element renders fully visible

### Requirement: Add-mask menu
The Mask sub-tab SHALL have an "Add mask" menu listing, in order: Split, Mirror, Filmstrip, Rectangle, Ellipse, Heart, Diamond, Star, Text, Pen tool, each with an icon. On desktop/web, hovering or keyboard-focusing an item SHALL live-preview that mask with default params on the canvas without changing the project; clicking or pressing Enter SHALL commit it as one undo step and select the new mask. On mobile the Mask sheet (`Masks tab and mobile mask sheet`) SHALL show a tile strip "None" followed by the same ten types; tapping a tile adds that mask when the element has none, and otherwise replaces the selected mask's type while keeping its position, rotation, feather and invert; an "Add another mask" button adds a further mask. With no masks the sub-tab SHALL show "No masks" and the "Add mask" button. [PORT K-019] [NEW]

#### Scenario: Hover preview
- **WHEN** the user hovers "Heart" in the menu
- **THEN** the canvas shows the element through a default heart mask, and moving away restores the previous view with no undo step

#### Scenario: Commit
- **WHEN** the user clicks "Heart"
- **THEN** a heart mask is appended to `masks`, selected, and its handles are shown

### Requirement: Remove and reset masks
Each mask row SHALL have a remove button; removing a mask SHALL also remove its keyframe channels and be one undo step. The mobile "None" tile SHALL remove all masks of the element after a confirm when more than one exists. Each mask SHALL have "Reset", restoring its type's default params and removing its keyframes. [PORT K-020]

#### Scenario: Remove
- **WHEN** the user removes the only mask
- **THEN** the element renders unmasked, and undo restores the mask with the same id and params

#### Scenario: Remove with keyframes
- **WHEN** the removed mask had feather keyframes
- **THEN** the element's animations no longer contain paths beginning `masks.<that id>.`, and undo restores them

### Requirement: Mask handles on canvas
While the Mask sub-tab is the active inspector tab (desktop/web) or the Mask sheet is open (mobile), the preview SHALL show handles for the selected mask instead of the element's transform handles: the outline (or line) body drags to move; box-like and mirror masks show four corner handles (uniform resize) and edge handles (single-axis resize); height-only masks show top and bottom handles; text and pen masks show one corner scale handle; split, box-like, mirror, text and pen masks show a rotate handle and a feather handle each offset 20 screen px from the shape. Dragging the feather handle SHALL change feather by `projection ÷ 0.11`, clamped 0–1000. Rotation SHALL be computed for every mask type as the angle of the pointer about the mask's pivot (the classic box-mask quirk of using the drag-delta vector MUST NOT be reproduced). Size SHALL clamp at 0.01. A rectangle mask SHALL show a corner-radius handle inside its top-left corner. On mobile, one-finger drag moves, two-finger pinch scales and two-finger twist rotates the selected mask, and handles have 32 px touch targets. Each gesture SHALL preview live and commit one undo step; Escape cancels a drag. [PORT K-014] [CAPCUT CC-143] [NEW]

#### Scenario: Rotate about the pivot
- **WHEN** the user drags a rectangle mask's rotate handle so the pointer is at 45° from the mask centre relative to its start angle
- **THEN** the mask's rotation changes by 45°

#### Scenario: Feather handle
- **WHEN** the user drags the feather handle outward by 55 px of projected distance
- **THEN** feather increases by 500

#### Scenario: Leaving mask mode
- **WHEN** the user leaves the Mask sub-tab for the Basic sub-tab
- **THEN** the element's transform handles are shown and mask handles are hidden

### Requirement: Mask snapping
While dragging a mask, its centre and edges SHALL snap to the centre and edges of the element's own box within the canvas snap threshold of `preview-canvas.Preview snapping` (8 px), showing guide lines; rotation SHALL snap to multiples of 90° within ±5°. The modifiers SHALL be the same as for every other canvas gesture: holding `Mod` (Ctrl on Windows and Linux, Cmd on macOS) disables snapping for the gesture, and holding Shift constrains a mask move to the dominant axis and mask rotation to 15° steps. The same rule applies to pen-tool anchor drags. [PORT K-015]

#### Scenario: Snap to element centre
- **WHEN** a mask is dragged to within the snap threshold of the element's centre
- **THEN** `centerX` and `centerY` become 0 and centre guides are shown

#### Scenario: Mod disables
- **WHEN** Ctrl/Cmd is held during the drag
- **THEN** no snapping occurs and no guides are shown

#### Scenario: Shift constrains
- **WHEN** Shift is held while a mask is dragged 80 px right and 10 px down
- **THEN** only `centerX` changes

### Requirement: Mask keyframing
All keyframable mask params SHALL animate on paths `masks.<maskId>.params.<key>` with linear, hold and bezier interpolation per `keyframe-animation.Interpolation types`, each with a keyframe toggle in the Mask sub-tab; when a param has keyframes, on-canvas handle drags SHALL write keyframes at the playhead. A pen path SHALL be keyframable as a whole on `masks.<maskId>.params.path`, a path channel whose key shape, per-point interpolation, easing, 1 000-key limit, graph-editor presentation and paste rule are defined by `keyframe-animation.Keyframe data model` and `project-document.Channel and keyframe shapes`: each path keyframe stores every point's anchor and tangents, and the path interpolates point-by-point (matched by point id) with the segment's easing; inserting or deleting a point SHALL insert or delete it in every path keyframe, placing an inserted point on the interpolated curve of each keyframe. [CAPCUT CC-147] [NEW]

#### Scenario: Animated position
- **WHEN** an ellipse mask has `centerX` keys −0.5 at 0 s and 0.5 at 2 s (linear; displayed −50 % and 50 %)
- **THEN** at 1 s the mask is centred horizontally

#### Scenario: Path keyframes
- **WHEN** a pen path has path keyframes at 0 s and 1 s with one anchor moved 100 px between them
- **THEN** at 0.5 s that anchor is 50 px from its first position

#### Scenario: Insert a point on an animated path
- **WHEN** the user inserts a point at 0.5 s on a path with two path keyframes
- **THEN** both keyframes contain the new point and the shape at 0 s and 1 s is unchanged within 0.5 px

### Requirement: Mask tracking attachment
A mask SHALL be attachable to a motion track produced for the same element's source by `ai-editing-tools.Motion tracking`, which owns the analysis, the stored track (`motionTracks[]` of the asset) and the loss rule. Attaching is a LIVE BINDING, not a bake: "Attach to track…" in the mask row menu SHALL list the element's available tracks, and choosing one SHALL write `masks[].tracking {trackId, followPosition, followScale, followRotation, offset}` on the mask (`project-document.Mask fields`; `followPosition`, `followScale` and `followRotation` default to true) as one undo step, with `offset` set so that the mask does not jump at the playhead (offset = the mask's centre minus the tracked point at the playhead, in `centerX` / `centerY` units). No keyframe is written. While a binding exists the engine resolves the mask per frame as: centre = tracked point + `offset` (when `followPosition`), scale = the mask's `scale` × the track's scale relative to the frame where the binding was made (when `followScale`), rotation = the mask's `rotation` + the track's rotation relative to that frame (when `followRotation`), evaluated at the element's source time so the mask stays on the object through trim, split, retime and reverse; the mask's own `centerX`, `centerY`, `scale` and `rotation` (static or keyframed) remain the base values the binding is applied to. On frames outside the tracked range, or after the track's loss point, the mask holds the last tracked values. The row shows a "Tracking" chip with the three follow switches, "Detach" (removes the binding, keeps the mask where it is at the playhead, one undo step) and the explicit action "Convert to keyframes", which is the only path that writes keyframes: it bakes the bound motion into keys on `masks.<maskId>.params.centerX`, `.centerY`, `.scale` and `.rotation` (one key per tracked frame, thinned so that linear interpolation between kept keys deviates by no more than 0.5 px, and thinned further when needed to stay within the 1 000-key limit of `keyframe-animation.Keyframe data model`), removes the binding, and is one undo step. Deleting the track removes the binding as defined by `ai-editing-tools.Motion tracking`. With no tracks available the menu item SHALL be disabled with "Track an object on this clip first". The same model, loss rule and tolerance apply as for `text-and-titles.Text tracking`. [NEW]

#### Scenario: Mask follows a tracked object
- **WHEN** a rectangle mask is attached to a track of a moving object
- **THEN** the mask stores a `tracking` binding and no keyframes, and on every tracked frame the rendered mask centre is within 2 px of the tracked point plus the offset

#### Scenario: Convert to keyframes
- **WHEN** the user chooses "Convert to keyframes" on that mask
- **THEN** the binding is removed, keys exist on the mask's `centerX`, `centerY`, `scale` and `rotation` paths (at most 1 000 each), the rendered mask position deviates by at most 0.5 px from the bound motion on every tracked frame, and one undo restores the binding

#### Scenario: Binding survives a speed change
- **WHEN** the clip with the bound mask is set to 2×
- **THEN** the mask stays on the object on every frame with no re-tracking and no keyframe change

#### Scenario: No track
- **WHEN** the element has no motion track
- **THEN** "Attach to track…" is disabled with the stated tooltip

### Requirement: Opacity
Every visual element SHALL have `opacity`, stored 0–1 (`project-document.Opacity, blend mode, crop and flip`; displayed 0–100%, step 1%, default 100%), keyframable; an adjustment layer's `opacity` uses the same stored unit (`color-adjustment.Adjustment layers`); it is consumed by the `opacity` stage of `render-engine.Per-layer stage order` (element opacity × clip-animation opacity). The Opacity slider with a numeric field and a keyframe toggle SHALL be in the Blend section of the Basic tab (`preview-canvas.Basic tab fields`); mobile entry: the "Opacity" item of `mobile-editor.Video clip tool strip`, which opens a sheet with the slider. Edits SHALL preview live and commit one undo step. [PORT E-011] [CAPCUT CC-149]

#### Scenario: Half opacity
- **WHEN** an overlay with opacity 50% and blend mode Normal sits over the main track
- **THEN** each pixel is the average of the overlay and the layer beneath

#### Scenario: Zero opacity
- **WHEN** opacity is 0
- **THEN** the element is not visible and remains selectable in the timeline

#### Scenario: Range clamp
- **WHEN** the user types 150 into the Opacity field
- **THEN** the stored opacity is 1 (100 %)

### Requirement: Blend modes
Every visual element SHALL have a `blendMode` with exactly these 17 options: Normal, Darken, Multiply, Color Burn, Lighten, Screen, Plus Lighter, Color Dodge, Overlay, Soft Light, Hard Light, Difference, Exclusion, Hue, Saturation, Color, Luminosity (stored as `normal`, `darken`, `multiply`, `color-burn`, `lighten`, `screen`, `plus-lighter`, `color-dodge`, `overlay`, `soft-light`, `hard-light`, `difference`, `exclusion`, `hue`, `saturation`, `color`, `luminosity`). The default SHALL be `normal`; blend mode is not keyframable. The formula of each mode and the compositing rule are defined by `render-engine.Blend modes` (the `blend` stage); this capability defines the option set and its UI. On desktop/web the Blend section of the Basic tab (`preview-canvas.Basic tab fields`) SHALL show a select grouped as Normal / Darken group (Darken, Multiply, Color Burn) / Lighten group (Lighten, Screen, Plus Lighter, Color Dodge) / Contrast group (Overlay, Soft Light, Hard Light) / Difference group (Difference, Exclusion) / Component group (Hue, Saturation, Color, Luminosity), and hovering or arrow-keying through options SHALL preview without committing. Mobile entry: the "Blend" item of `mobile-editor.Video clip tool strip`, which opens a horizontally scrolling tile strip with a thumbnail per mode. An element on the bottom-most layer blends against the canvas background. [PORT E-010] [CAPCUT CC-150, CC-151]

#### Scenario: Multiply
- **WHEN** an opaque overlay pixel (0.5, 0.5, 0.5) with Multiply sits over (0.8, 0.4, 0.2)
- **THEN** the result is (0.4, 0.2, 0.1) within 1/255

#### Scenario: Screen
- **WHEN** the same overlay uses Screen
- **THEN** the result is (0.9, 0.7, 0.6) within 1/255

#### Scenario: Seventeen options
- **WHEN** the blend select is opened
- **THEN** it lists exactly the 17 modes named above in the six groups

#### Scenario: Hover does not commit
- **WHEN** the user hovers "Overlay" and closes the select without choosing
- **THEN** the element keeps its previous blend mode and no undo step is recorded

#### Scenario: Unknown stored mode
- **WHEN** a project stores `blendMode: "vivid-light"`
- **THEN** the element renders with `normal`, the select shows "Normal", and the stored value is preserved until the user picks a mode

### Requirement: Chroma key
Video and image elements SHALL have a `chromaKey` object `{enabled, color, strength, edge, shadow, spill}`, whose stored shape is `project-document.Chroma key and cutout fields`: `enabled` default false; `color` default `#00ff00` (stored lowercase); `strength` 0–100 (default 40) is the chroma-distance tolerance; `edge` 0–100 (default 10) is the softness of the transition between keyed and kept pixels; `shadow` 0–100 (default 0) keeps darker pixels of the key hue as semi-transparent shadow; `spill` 0–100 (default 50) desaturates remaining key-colour cast on kept pixels. All four numeric params are keyframable. These are the stored names and the names used by `jc_chroma_set`. The key function, the mapping of the four values to shader uniforms (`similarity = strength/100`, `smoothness = edge/100`, `shadow/100`, `spill/100`) and the stage position (`chroma-key`) are defined by `render-engine.Chroma key and matte stages` and `render-engine.Per-layer stage order`. The Chroma key section (in the Cutout sub-tab named by `preview-canvas.Inspector structure per element type`) SHALL provide: the enable switch, a colour swatch with picker, an eyedropper that samples the unkeyed source pixel under the pointer in the preview (the average of a 5×5 px area, read back through the engine command `layout.sampleSource`), the four sliders, a "Show matte" view toggle that displays the alpha as greyscale (view state only), and Reset. Mobile entry: see `mobile-editor.Video clip tool strip` (the chroma key control is reached from its "Remove BG" item); the sheet shows "Colour picker" (a draggable ring on the preview; the sheet is canvas-interactive), Strength, Edge, Shadow and Spill. Enabling with no colour picked SHALL use the default green. [CAPCUT CC-152, CC-153] [NEW]

#### Scenario: Key out a green screen
- **WHEN** chroma key is enabled with colour `#00ff00` and strength 40 on a clip with a uniform green background
- **THEN** background pixels have alpha 0 and the layer beneath is visible there

#### Scenario: Eyedropper
- **WHEN** the user picks a blue background pixel with the eyedropper
- **THEN** `color` becomes the averaged 5×5 sample and the blue background becomes transparent

#### Scenario: Strength zero
- **WHEN** strength is 0 and edge is 0
- **THEN** only pixels whose chroma equals the key colour exactly are removed

#### Scenario: Matte view
- **WHEN** "Show matte" is on
- **THEN** the preview shows white for kept and black for removed areas, and an export still renders the keyed picture

#### Scenario: Stored names and agent range
- **WHEN** `jc_chroma_set` is called with `{strength: 140, edge: 20}`
- **THEN** the call fails with `OUT_OF_RANGE` naming `strength` with `min` 0 and `max` 100 (`agent-editing-tools.Validation`) and nothing is stored; the same call with `{strength: 100, edge: 20}` stores `chromaKey.strength = 100` and `chromaKey.edge = 20`

### Requirement: Cutout model and auto cutout
This capability owns the cutout DATA on the element and its CONTROLS (auto cutout switch, edge controls, the custom-cutout brush editor, stroke and background); the matte and propagation MODELS and their JOBS are owned by `ai-editing-tools` (`ai-editing-tools.Background removal for images`, `ai-editing-tools.Background removal for video`, `ai-editing-tools.Interactive cutout and propagation`). Video and image elements SHALL have the `cutout` object of `project-document.Chroma key and cutout fields` — `{mode, matteAssetId?, inverted, feather, shift, stroke, background, disabled_ms?}` with `mode` `none` (default), `auto` or `custom`; sticker, text and other element types have no cutout. The matte is a derived asset (role `matte`) referenced by `matteAssetId`, delivered to the engine by `render-engine.Derived asset delivery to the engine` and consumed by the `matte` stage, whose order (matte, stroke, background) is `render-engine.Cutout background and stroke stage`. The edge controls are defined here and nowhere else: `inverted` (boolean, default false; "Invert" keeps the background and removes the subject), `feather` (0–100 px, step 1, default 2; softens the matte edge) and `shift` (−50…+50 px, step 1, default 0; negative shrinks the cut-out, positive grows it); `feather` and `shift` are in px on the 1920-px reference canvas of `visual-effects-filters.Resolution-independent effect parameters`, are applied by the engine as defined in `render-engine.Chroma key and matte stages`, are edited with the switch "Invert" and the sliders "Feather" and "Edge shift" of the Cutout sub-tab (and of the mobile cutout sheet), and each change is one undoable command that needs no new analysis. "Auto cutout" (Cutout sub-tab; mobile entry: the "Remove BG" item of `mobile-editor.Video clip tool strip`; agent tool `jc_cutout_set`) SHALL execute one undoable command that sets `mode: auto` and requests a matte from `ai-editing-tools.Background removal for video` or `ai-editing-tools.Background removal for images`, which own the model, the job, its progress and cancellation. The job result is applied as a non-history update of `matteAssetId`: it adds no undo step and does not clear the redo stack, and a result for an element that no longer exists, or whose `mode` is no longer `auto`, SHALL be discarded. Until the matte is complete the element SHALL render uncut for frames without a matte and show "Removing background {n}%"; a failed job SHALL leave `mode: auto` with a warning icon and Retry. Turning cutout off SHALL set `mode: none`, keep `matteAssetId` and write `disabled_ms`; turning it on again within 30 days reuses the matte at once and removes `disabled_ms`; after 30 days the reference is dropped by the non-history rule of `project-document.Chroma key and cutout fields` and re-enabling starts a new analysis. Trimming outward beyond the analysed range SHALL trigger analysis of the new frames. [CAPCUT CC-154] [NEW]

#### Scenario: Auto cutout applied
- **WHEN** auto cutout completes on a clip of a person
- **THEN** pixels outside the person are transparent and layers beneath show through

#### Scenario: In progress
- **WHEN** the matte is 50% complete and the playhead is on an unanalysed frame
- **THEN** that frame renders without cutout and the clip shows "Removing background 50%"

#### Scenario: One undo step
- **WHEN** the user enables auto cutout, the job completes 20 s after, and the user presses undo once
- **THEN** `cutout.mode` is `none` again and no further undo step related to the cutout exists

#### Scenario: Result for a deleted element
- **WHEN** the element is deleted while its matte job is running and the job then completes
- **THEN** the result is discarded and the history is unchanged

#### Scenario: Toggle off and on
- **WHEN** the user turns cutout off and on again within the same session
- **THEN** the cutout is restored immediately without a new analysis job

#### Scenario: Matte edge shift
- **WHEN** a cut-out person has `shift` −10 on a 1920×1080 canvas
- **THEN** the visible silhouette is 10 px smaller along its whole edge and no new matte job is started

#### Scenario: Invert
- **WHEN** the user turns "Invert" on for a cut-out person
- **THEN** `cutout.inverted` is true, the person is transparent and the former background is visible, with no new matte job

#### Scenario: Default edge softness
- **WHEN** auto cutout is enabled on a clip
- **THEN** `cutout.feather` is 2 and `cutout.shift` is 0

#### Scenario: Re-enabled after 31 days
- **WHEN** cutout was turned off 31 days ago and the user turns it on again
- **THEN** a new matte job starts, because the old matte reference was dropped

### Requirement: Custom cutout
"Custom cutout" SHALL open a brush editor over the preview for the selected video or image element. This capability owns the editor — its tools, strokes, undo and the resulting `cutout` data; the segmentation model, the propagation across a clip, their admission, their jobs and their acceptance are owned by `ai-editing-tools.Interactive cutout and propagation`, which this requirement calls and never re-defines. Tools: Smart brush (strokes mark regions to keep; each stroke is sent as prompt points to that requirement, which returns the object mask for the current frame), Smart eraser (the same, marking regions to remove), Brush (adds exactly the painted pixels to the matte) and Eraser (removes exactly the painted pixels from the matte). Brush and Eraser need no model and are available on every platform and with no host. Smart brush and Smart eraser are available where `ai-editing-tools.Interactive cutout and propagation` says the click model is admitted on the device (desktop macOS, Windows and Linux, and web, subject to admission) or a host with `host-analysis` is connected (every platform, including iOS and Android, where the model is not admitted on the device); otherwise the two smart tools are shown disabled with that requirement's message and the two exact tools stay usable. Brush size SHALL be 1–200 px on the reference canvas (default 40), with a size slider, the actions `brush.size-decrease` and `brush.size-increase` changing it by 5 px on desktop/web (default bindings defined only in `keyboard-shortcuts`), and a circular cursor showing the size. The editor SHALL have its own undo/redo for strokes, a "Show matte" toggle, Reset, Cancel and Done. Strokes are made on the current frame and live only in the editor session (they are not project data). On Done the element SHALL be set to `mode: custom` as one undo step in the project history, and the matte is produced by `ai-editing-tools.Interactive cutout and propagation`: for an image the edited frame's matte is stored at once; for a video the selection is propagated across the clip's visible source range by that requirement with a progress indicator, and frames not yet propagated render uncut. The matte arrives as a non-history update of `cutout.matteAssetId` as in `Cutout model and auto cutout`. Where propagation is unavailable (a video element on a device where the click model is not admitted and no host is connected), Done SHALL be disabled for video elements with that requirement's message, and the editor still works for image elements. Cancel SHALL discard all strokes. Touch: painting with one finger, two-finger pan/zoom; the sheet is canvas-interactive per `mobile-editor.Tool sheets never cover the preview`. [CAPCUT CC-155, CC-156] [NEW]

#### Scenario: Smart brush keeps an object
- **WHEN** on a device where the click model is admitted the user paints a short stroke on a cup with Smart brush on a video clip and presses Done
- **THEN** the whole cup remains visible on the edited frame, the element's `cutout.mode` is `custom`, and the propagation of `ai-editing-tools.Interactive cutout and propagation` runs for the clip's visible range

#### Scenario: Phone with a host
- **WHEN** the same is done on an iOS or Android phone paired with a host that advertises `host-analysis`
- **THEN** Smart brush is enabled, each stroke is answered by the host, and the propagation runs as a host job

#### Scenario: Phone without a host
- **WHEN** Custom cutout is opened for an image on an iOS or Android phone with no host
- **THEN** Smart brush and Smart eraser are disabled with the stated message, Brush and Eraser work, and Done stores the painted matte with `mode: custom`

#### Scenario: Brush is exact
- **WHEN** the user paints with Brush at size 40 on an empty matte
- **THEN** exactly the pixels under the 40 px stroke are kept

#### Scenario: Eraser is exact
- **WHEN** the user paints with Eraser at size 40
- **THEN** only pixels under the 40 px stroke are removed from the matte

#### Scenario: Cancel
- **WHEN** the user presses Cancel after several strokes
- **THEN** the element's cutout is unchanged and no project undo step is recorded

### Requirement: Cutout stroke
A cut-out element SHALL support `cutout.stroke {style, width, color, offset, opacity}` (stored shape: `project-document.Chroma key and cutout fields`) with `style` one of `none` (default), `solid`, `dashed`, `glow`, `offset-shadow`; `width` 0–100 px (default 8); `color` default `#ffffff`; `offset` 0–100 px (default 0); `opacity` 0–100% (default 100). Pixel values are on the reference canvas and are multiplied by the pixel scale factor of `visual-effects-filters.Resolution-independent effect parameters`. With `d` = distance outside the matte's 0.5 iso-line (after `inverted`, `feather` and `shift`), the styles mean: `solid` — a band covering `offset ≤ d ≤ offset + width`; `dashed` — the same band cut along the silhouette's arc length into dashes `3 × width` long separated by gaps `2 × width` long, starting at the topmost silhouette point; `glow` — alpha `exp(−(d − offset) / width)` for `offset ≤ d ≤ offset + 3 × width`, 0 beyond; `offset-shadow` — a hard-edged copy of the subject's silhouette filled with `color`, displaced by `offset` px to the right and `offset` px down and visible only outside the subject (`width` unused). The stroke is generated on the GPU from the matte's distance field for every frame, multiplied by `opacity`, inside the `matte` stage as defined by `render-engine.Cutout background and stroke stage` (descriptor field `layer.cutoutStroke`, shader `cutout-stroke`): it is composed with the subject BEFORE the colour chain, effects and masks, so a mask on the element clips the stroke together with the subject, the element's opacity and blend mode apply to it, and it is drawn above the replaced background of `Replace background after cutout`. Width, colour, offset and opacity are keyframable (`cutout.stroke.<key>`). [CAPCUT CC-157] [NEW]

#### Scenario: Solid outline
- **WHEN** style is `solid` with width 8 and colour white on a 1920×1080 canvas
- **THEN** an 8 px white band follows the subject's silhouette on every frame

#### Scenario: Dashed outline
- **WHEN** style is `dashed` with width 10
- **THEN** the band consists of dashes 30 px long separated by 20 px gaps measured along the silhouette

#### Scenario: Glow falloff
- **WHEN** style is `glow` with width 20 and offset 0
- **THEN** the stroke alpha is 1 at the silhouette, 0.368 ± 0.02 at 20 px outside it and 0 beyond 60 px

#### Scenario: Offset shadow
- **WHEN** style is `offset-shadow` with offset 20 on a 1920×1080 canvas
- **THEN** a copy of the silhouette in the stroke colour is visible displaced 20 px right and 20 px down (±1 px) behind the subject

#### Scenario: A mask clips the stroke
- **WHEN** a cut-out person with a solid 8 px stroke has a rectangle mask covering the left half of the element
- **THEN** the stroke is visible only inside the rectangle

#### Scenario: No cutout
- **WHEN** `cutout.mode` is `none`
- **THEN** the stroke controls are disabled with "Remove the background first"

### Requirement: Replace background after cutout
A cut-out element SHALL support `cutout.background {kind, color?, blurIntensity?, mediaId?}` (stored shape: `project-document.Chroma key and cutout fields`) with `kind` `none` (default, transparent), `color` (a colour, default `#000000`), `blur` (the element's own uncut picture blurred; `blurIntensity` 0–100, default 50, giving a Gaussian sigma of `blurIntensity / 5 ×` the pixel scale factor) or `media` (`mediaId` of an image or video asset of the project, cover-fitted to the element's box, looping when shorter than the element and muted). The background is drawn inside the element's box behind the subject and its stroke, moves, scales and rotates with the element, and is produced inside the `matte` stage by `render-engine.Cutout background and stroke stage` (descriptor field `layer.cutoutBackground`, shader `cutout-background`; the engine keeps the pre-matte picture for `blur`): the element's colour adjustments, filter, effects, masks, opacity and blend mode therefore apply to subject and background together. Choosing `media` SHALL open the media picker; a missing media asset SHALL render as `none` and show "Background media is missing" with Relink. With `cutout.mode: none` the background controls are disabled with "Remove the background first". Changes SHALL be undoable; none of the background values is keyframable. [CAPCUT CC-158] [NEW]

#### Scenario: Colour background
- **WHEN** `cutout.background` is `{kind: "color", color: "#0000ff"}`
- **THEN** the area around the subject inside the element's box is blue

#### Scenario: Blurred original
- **WHEN** the kind is `blur` with `blurIntensity` 50 on a 1920×1080 canvas
- **THEN** the subject is sharp over its own original picture blurred with sigma 10 px

#### Scenario: Video background shorter than the clip
- **WHEN** a 3 s video is used as background for an 8 s clip
- **THEN** the background loops and its audio is not heard

### Requirement: AI removal entry points
The clip context menu SHALL include "Remove object" and "Remove text", which open the flows of `ai-editing-tools.Object and text removal` with the selected clip preselected; mobile entry: the "Remove object" and "Remove text" items of `mobile-editor.Video clip tool strip`. This capability defines only the entry points and the result contract: the flows SHALL return a new media asset that replaces the clip's source non-destructively (the original remains in the media library and "Restore original" is offered in the clip menu), without changing the clip's masks, chroma key or cutout. Where that requirement states the flow needs a host and none is connected, the items SHALL open the notice "Connect a host to use AI removal". [CAPCUT CC-159, CC-160] [NEW]

#### Scenario: Hand-off
- **WHEN** the user chooses "Remove text" on a clip
- **THEN** the `ai-editing-tools.Object and text removal` flow opens for that clip

#### Scenario: Restore
- **WHEN** a result has replaced the clip's source and the user chooses "Restore original"
- **THEN** the clip uses its original media again as one undo step

#### Scenario: No host
- **WHEN** the flow needs a host, none is connected and the user chooses "Remove object"
- **THEN** the notice is shown and no job starts

### Requirement: Masks tab and mobile mask sheet
The Mask sub-tab (the Mask tab for a graphic; see `Maskable element types`) SHALL list the element's masks as collapsible rows in array order with the controls of `Multiple masks and combine modes`, and for the selected mask the fields: Position (X, Y), Size (W, H) or Height or Thickness as the type requires, Scale, Rotation, Corner radius (rectangle), Points and Inner ratio (star), text fields (text), Feather (0–100%), Opacity, Stroke (width, colour, alignment). Selecting a row SHALL select that mask on canvas and vice versa. Number fields SHALL behave as defined by `preview-canvas.Number field behaviour` (typing, scrubbing, expressions, step snapping, reset-to-default). On mobile the Mask sheet SHALL show the type tile strip, an Invert button, a Feather slider, and an "Adjust" entry opening the remaining fields; the mask is manipulated directly on the preview, so the sheet is canvas-interactive and has the ✓ / ✕ header of `mobile-editor.Tool sheets never cover the preview` (preview touches go to the mask, ✓ commits, ✕ discards the changes made since the sheet opened). Selection of mask points and masks SHALL be part of the editor selection state, and Escape SHALL deselect in the order: active gesture, mask points, keyframes, elements. [PORT K-010, K-014, K-019] [CAPCUT CC-143] [NEW]

#### Scenario: Select from the list
- **WHEN** the user clicks the second mask row
- **THEN** the second mask's handles are shown on canvas and its fields are shown in the sub-tab

#### Scenario: Escape order
- **WHEN** two pen points are selected and the user presses Escape
- **THEN** the points are deselected and the element stays selected

#### Scenario: Touching the preview does not close the mobile sheet
- **WHEN** the Mask sheet is open on a phone and the user drags on the preview
- **THEN** the selected mask moves and the sheet stays open

### Requirement: Mask and keying rendering limits and fallback
Masks, chroma key and cutout SHALL render with the same shaders in preview and export, within the tolerance of `render-engine.Golden-frame determinism`. Mask shapes SHALL be rasterised at render resolution, cached by a content hash of their params, and re-rasterised only when params change. With `backend: "none"` nothing renders (see `render-engine.Behaviour without a GPU backend`); mask, key and cutout parameters stay editable and are stored. With 8 feathered masks on one 1080p element, preview SHALL sustain at least 20 rendered frames per second on the reference desktop device of `diagnostics-quality.Performance budgets` and at least 15 on the reference phones (iOS and Android) at the `auto` preview quality of `render-engine.Preview resolution scaling`. All mask, blend, opacity, chroma-key and cutout mutations SHALL be undoable commands exposed to agents through `jc_mask_set`, `jc_chroma_set`, `jc_cutout_set` and `jc_clip_transform` (opacity, blend mode) of `agent-editing-tools.Tool naming and families`; every stored field of `masks[]` (including stroke and tracking) and of `cutout` (including `inverted`, `stroke` and `background`) SHALL be settable through those tools (see the agent-tool item under "Depends on" in `.refs/review/ledger2-C5.md`), and a value outside its range is refused with `OUT_OF_RANGE`. [PORT K-011, E-010] [NEW]

#### Scenario: Preview equals export
- **WHEN** a clip with two masks, chroma key and Multiply blend is exported
- **THEN** each exported frame matches the full-resolution preview frame within the preview-versus-export tolerance of `render-engine.Golden-frame determinism` (maximum per-channel difference of 1) before encoding

#### Scenario: Cached rasterisation
- **WHEN** playback runs over a clip whose mask params are static
- **THEN** the mask shape is rasterised once and reused for every frame

#### Scenario: Editing without a GPU
- **WHEN** the engine reported `backend: "none"` and the user adds an ellipse mask and sets feather to 30 %
- **THEN** the mask is stored with `feather: 300` and one undo step per edit is recorded, and no banner claims a reduced-quality mask render
