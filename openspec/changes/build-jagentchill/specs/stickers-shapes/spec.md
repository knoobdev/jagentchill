## ADDED Requirements

### Requirement: Stickers panel and categories
The Stickers asset tab (desktop and web) and the Stickers sheet opened by `mobile-editor.Captions, Stickers, Templates and AI tools groups` (mobile; this capability contributes the panel content only) SHALL show a search field and the category tabs, in this order: All, Emoji, Arrows, Labels, Social, Celebration, Nature, Objects, Frames, Hand-drawn, Flags, Shapes, My stickers, Generated. The eight tabs Arrows to Hand-drawn are the categories of the bundled starter pack (`stickers-shapes.Starter sticker pack`). When the brand kit has logos, a "Brand" row SHALL be shown at the top of All (`templates.Brand kit`). The selected category SHALL be persisted per device. Items SHALL be shown in a grid (desktop and web: auto-fill columns of 72 px; mobile: 5 columns on phones, 8 on tablets) with each item's name as tooltip and accessible label; every tile SHALL be drawn from the real sticker asset, never from a stand-in image. Bundled content SHALL consist only of the starter pack, the emoji font glyphs, the flag set and the shape definitions listed by this capability; no third-party sticker library, brand logo set or remote sticker catalogue SHALL be bundled or fetched. The same panel without a project is shown at `/library/stickers` (`app-shell-navigation.Library screen`). [PORT G-001, G-018] [CAPCUT CC-186, CC-192]

#### Scenario: Tabs
- **WHEN** the Stickers tab is opened for the first time
- **THEN** the 14 tabs are shown in the stated order with All active

#### Scenario: Category remembered
- **WHEN** the user switches to Flags and reloads the app
- **THEN** Flags is the active category

#### Scenario: No network for bundled content
- **WHEN** the device is offline and no host is connected
- **THEN** Emoji, the eight starter categories, Flags and Shapes list all their items and any of them can be added to the timeline

### Requirement: Sticker provider registry
Sticker sources SHALL be providers registered in a registry by `{key, definition}` where the definition implements `search`, `browse` and `resolveUrl`. The built-in providers `starter`, `emoji`, `flags`, `shapes`, `user` (imported stickers) and `generated` SHALL be registered at editor start-up before the panel can render; registering a key twice SHALL be rejected with an error in development builds and ignored with a diagnostic log entry in production builds. Looking up an unknown provider SHALL return "not found" without throwing. A unit test SHALL assert that after start-up the registry contains exactly the six built-in keys and that each provider's `browse` returns without error. (OpenCut classic passes `(id, provider)` to a registry that expects `{key, definition}`; that defect SHALL NOT be reproduced.) Sticker ids stored by OpenCut classic under the provider `icons`, and ids under `emoji` whose value is not a code-point sequence of `stickers-shapes.Emoji stickers`, belong to libraries that are not shipped: such elements SHALL be kept unchanged, shown in the missing-sticker state, and counted in a notice shown once when the project is loaded, "{n} stickers from a removed library are unavailable", with a "Replace" action that selects the first of them. [PORT G-018] [NEW]

#### Scenario: Providers registered
- **WHEN** the editor has started
- **THEN** `starter`, `emoji`, `flags`, `shapes`, `user` and `generated` are resolvable from the registry and no other key is

#### Scenario: Unknown provider
- **WHEN** a project contains a sticker with id `logos:acme`
- **THEN** the editor opens without an exception and the element shows the missing-sticker state

#### Scenario: Classic icon library
- **WHEN** a classic project with three stickers whose ids start with `icons:` is opened
- **THEN** the three elements are kept with their ids, show the missing-sticker state, and the notice reads "3 stickers from a removed library are unavailable"

### Requirement: Sticker identifiers
A sticker SHALL be identified by `provider:value` (for example `flags:US`, `shapes:star`, `starter:arrow-right`, `emoji:1f600`, `user:<sha256>`, `generated:<sha256>`). Both parts SHALL be non-empty; an id without a provider or value SHALL be rejected when an element is created. Only the first colon separates the two parts; any further colons belong to the value. [PORT G-001]

#### Scenario: Valid id
- **WHEN** a sticker element is created with `stickerId = "flags:JP"`
- **THEN** it resolves to the bundled flag of Japan

#### Scenario: Invalid id
- **WHEN** code attempts to create a sticker element with `stickerId = "flags:"`
- **THEN** creation fails with a validation error and no element is added

### Requirement: Flag stickers
The `flags` provider SHALL offer 271 SVG flags, resolved locally by lower-cased code, each with a name and code; every flag code that OpenCut classic resolves under `flags:<code>` SHALL keep resolving. The flag files SHALL NOT be copied from OpenCut classic, whose flag set has no stated origin or licence: they SHALL come from the open-source set `lipis/flag-icons` (MIT) at a pinned version, and any classic code that set lacks SHALL be drawn for this project and released as CC0-1.0. The country and region data file (names, codes, regions) SHALL be authored for this project. The set, its upstream URL, version, licence and copyright line SHALL have a row in the asset provenance file required by `platform-skeleton.Licence and third-party notices`, and the build SHALL fail when that row is missing or when a code of the classic list has no file. Flags SHALL be listed alphabetically by name. [PORT G-002]

#### Scenario: Count
- **WHEN** the Flags tab is opened with an empty search
- **THEN** 271 items are available by scrolling

#### Scenario: Classic codes resolve
- **WHEN** the build check iterates over the 271 flag codes of the classic list
- **THEN** each code resolves to a bundled SVG file

#### Scenario: Provenance gate
- **WHEN** the flag set has no row in the asset provenance file
- **THEN** the licence check fails naming the flags directory

#### Scenario: Vector quality
- **WHEN** a flag sticker is scaled to 800 % on the canvas
- **THEN** its edges are rendered from the vector source without pixelation

### Requirement: Flag search
Flag search SHALL match, case-insensitively: a substring of the country or territory name; a substring of the code; an exact region id or alias; or one of the group names `europe`, `asia`, `africa`, `america`. The 19 regions (id, aliases in parentheses) SHALL be: `northern-africa` (north-africa), `eastern-africa` (east-africa), `middle-africa` (central-africa), `southern-africa`, `western-africa` (west-africa), `caribbean`, `central-america`, `south-america`, `northern-america` (north-america), `central-asia`, `eastern-asia` (east-asia), `south-eastern-asia` (southeast-asia), `southern-asia` (south-asia), `western-asia` (middle-east), `eastern-europe` (east-europe), `northern-europe` (north-europe), `southern-europe` (south-europe), `western-europe` (west-europe) and `oceania` (pacific). Each flag belongs to exactly one region. Groups: `africa` = the five African regions; `america` = caribbean, central-america, south-america and northern-america; `asia` = the five Asian regions; `europe` = the four European regions. When the query equals a region id, alias or group, the Flags tab SHALL show a banner naming that region or group above the results. [PORT G-003]

#### Scenario: Name substring
- **WHEN** the user types "land" in the Flags tab
- **THEN** results include Finland, Iceland, Ireland and Thailand

#### Scenario: Group
- **WHEN** the user types "europe"
- **THEN** only flags of the four European regions are listed and a banner reads "Europe"

#### Scenario: Region alias
- **WHEN** the user types "middle-east"
- **THEN** only flags of the region `western-asia` are listed and a banner reads "Western Asia"

#### Scenario: Every flag has one region
- **WHEN** the unit test loads the country data
- **THEN** each of the 271 flags has exactly one of the 19 region ids

#### Scenario: No match
- **WHEN** the user types "zzzz"
- **THEN** the empty state "No stickers found for "zzzz"" is shown with a Clear search button

### Requirement: Emoji stickers
The `emoji` provider SHALL offer every fully-qualified emoji sequence of the Unicode emoji data file that ships with the bundled Noto Color Emoji font (`text-and-titles.Bundled fonts`), except the groups Flags and Component, as stickers identified by `emoji:<code points>` where the value is the sequence's code points in lower-case hexadecimal joined by `-` (for example `emoji:1f600`, `emoji:1f44d-1f3fd`). The Emoji tab SHALL show the eight sub-groups Smileys and emotion, People and body, Animals and nature, Food and drink, Travel and places, Activities, Objects, Symbols. Names and search keywords SHALL come from the Unicode CLDR annotations for English, Vietnamese and Japanese, bundled with the app at the version pinned with the font. An emoji sticker SHALL be drawn by the engine from the bundled colour font — its colour layers, through the engine's own text path of `render-engine.Engine-side text shaping and layout`, never a platform emoji font or the platform's text drawing — at the resolution implied by its scale, with an intrinsic size of 512×512; it needs no network. Colour emoji has a bitmap fallback (decision E5): the app also ships one pre-rendered 512×512 px image per emoji id, generated at build time from the same font, and on a platform where the colour-font path fails spike S6 row 12 (`mobile-editor.WebView capability spike matrix`) emoji stickers and emoji inside text are drawn from those bitmaps (scaled with the sticker's sampling rule) at the positions the engine's layout gives; the sticker id, the stored element and the look at scale ≤ 1 are the same on every platform — iOS, Android, web, macOS, Windows, Linux and the host. The emoji manifest generated at build time SHALL list every id, and the build SHALL fail when an id has no glyph in the bundled font or no fallback bitmap. [CAPCUT CC-186] [NEW]

#### Scenario: Add an emoji
- **WHEN** the user opens Emoji, Smileys and emotion and clicks the grinning face
- **THEN** a sticker element with `stickerId = "emoji:1f600"` and intrinsic size 512×512 is added at the playhead

#### Scenario: Search in Vietnamese
- **WHEN** the app language is Vietnamese and the user types the CLDR Vietnamese keyword of an emoji
- **THEN** that emoji is listed

#### Scenario: Manifest matches the font
- **WHEN** the build check runs
- **THEN** every id of the emoji manifest resolves to a glyph of the bundled font and no id belongs to the Flags or Component group

#### Scenario: Same glyph on every platform
- **WHEN** a project with `emoji:1f600` is rendered on iOS, Android, desktop and the host
- **THEN** all four render the bundled font's glyph, not a platform emoji

### Requirement: Starter sticker pack
The `starter` provider SHALL offer exactly the 128 stickers enumerated in `stickers-shapes/catalog.md` (normative: id, title, category, type, duration for animated items, licence and source path): 16 in each of the eight categories Arrows, Labels, Social, Celebration, Nature, Objects, Frames and Hand-drawn, of which 4 per category (32 in total) are animated. Every item SHALL be authored for this project and dedicated to the public domain under CC0-1.0, with a manifest entry `{id, title, category, type, duration?, licence, source, keywords {en[], vi[], ja[]}}`; the build SHALL fail when an item lacks a licence or a source, when a catalogue id has no file, or when a file has no catalogue row. Static items SHALL be SVG files with a 512×512 viewBox that pass the SVG sanitiser of `stickers-shapes.Imported stickers`; animated items SHALL be animated WebP files of 512×512 px at 24 frames per second, at most 300 kB each, whose last frame continues into the first. No item SHALL contain a brand mark, a logo, or the name or interface artwork of a third-party product or service. The pack SHALL ship in the app bundle and work with no network and no host. [CAPCUT CC-186, CC-187] [NEW]

#### Scenario: Exactly 128 offline
- **WHEN** the eight starter category tabs are opened on a fresh install with no network
- **THEN** each lists exactly 16 items, 4 of them animated, and the ids equal the catalogue ids in catalogue order

#### Scenario: Add an animated starter sticker
- **WHEN** the user clicks `starter:confetti-fall`
- **THEN** an animated sticker element is added whose default duration is 5 s and whose animation loops every 2.0 s

#### Scenario: Licence gate
- **WHEN** a starter file has no manifest entry
- **THEN** the build check fails naming the file

#### Scenario: Size limit
- **WHEN** an animated starter file is 310 kB
- **THEN** the build check fails naming the file

### Requirement: Shape items
The `shapes` provider SHALL list exactly six items — Rectangle, Ellipse, Polygon, Star, Line, Arrow — one per shape definition of `project-document.Graphic element`, searched by name and keywords. The seventh graphic definition, `drawing`, is NOT a shape item: a drawing is created only by the Draw tool of `stickers-shapes.Freehand drawing`. The legacy ids `square`, `circle`, `triangle`, `hexagon`, `diamond` and `star` SHALL still resolve (square → rectangle; circle → ellipse; triangle → polygon with 3 sides; hexagon → polygon with 6 sides; diamond → polygon with 4 sides; star → star). Adding a shape item SHALL create a `graphic` element, not a sticker element. [PORT G-004] [CAPCUT CC-192]

#### Scenario: Add a shape
- **WHEN** the user clicks the Star item
- **THEN** a graphic element with `definitionId = "star"` is added

#### Scenario: Legacy id
- **WHEN** a classic project references `shapes:hexagon`
- **THEN** it resolves to a polygon with 6 sides

### Requirement: Browse view and "See all"
With an empty search, the All tab SHALL show a "Recently used" row followed by one row per provider that has items, each showing up to 12 items and a "See all" button that switches to that provider's tab. A provider with no items (for example My stickers before any import) SHALL show its empty state inside its own tab and no row in All. [PORT G-007]

#### Scenario: See all
- **WHEN** the user clicks "See all" on the Flags row
- **THEN** the Flags tab becomes active and lists all flags

#### Scenario: Empty provider
- **WHEN** no sticker has been imported
- **THEN** the All tab has no My stickers row and the My stickers tab shows "Import images to use them as stickers" with an Import button

### Requirement: Recently used stickers
Adding a sticker or shape SHALL push its id to the front of the recents list (de-duplicated). The list SHALL store up to 50 ids per device and show the first 12 in the "Recently used" row with a "Clear" button that empties the list. Ids whose provider is unknown or whose item no longer exists SHALL be dropped when the list is loaded. [PORT G-005, G-006]

#### Scenario: Recents order
- **WHEN** the user adds stickers A, B and then A again
- **THEN** the row shows A then B

#### Scenario: Clear
- **WHEN** the user clicks Clear
- **THEN** the "Recently used" row disappears and stays empty after reload

#### Scenario: Stale id
- **WHEN** a recent id refers to an imported sticker that was deleted
- **THEN** it is not shown

### Requirement: Sticker search
Typing in the search field SHALL search after a debounce of 150 ms. In the All tab, results SHALL be grouped in one section per provider with a combined limit of 100 items split evenly across providers that have matches. In a provider tab, results SHALL show "{total} results" and list every match. `user` and `generated` stickers SHALL be searched by name and tags. An empty result SHALL show the empty state with a Clear search button. Search SHALL work offline for all built-in providers. [PORT G-008] [CAPCUT CC-186] [NEW]

#### Scenario: Cross-provider search
- **WHEN** the user types "star" in the All tab
- **THEN** the Shapes section contains Star and other sections contain their matches, with at most 100 items in total

#### Scenario: Debounce
- **WHEN** the user types five characters within 100 ms
- **THEN** exactly one search is executed

### Requirement: Add a sticker by click
Clicking (tapping) an item SHALL insert an element at the playhead with strategy `firstAvailable` of `timeline-editing.Placement strategies`, with the default sticker and graphic duration preference of `settings-preferences.Editing default preferences` (initial value 5 s = 600 000 ticks; animated stickers follow `stickers-shapes.Animated stickers`), centred on the canvas, select it, and push it to recents, as one undo step. A sticker whose image cannot be loaded SHALL NOT be inserted and SHALL show the toast "Sticker was not added". Agents add stickers and shapes through the tools `jc_sticker_add` and `jc_shape_add` listed in `agent-editing-tools.Tool naming and families`, with the same placement and defaults. [PORT G-009] [CAPCUT CC-190]

#### Scenario: Insert at playhead
- **WHEN** the default duration preference is 5 s and the user clicks a flag with the playhead at 4 s
- **THEN** a sticker element exists from 4 s to 9 s on a graphic track and is selected

#### Scenario: Load failure
- **WHEN** the sticker image fails to decode
- **THEN** no element is added and the error toast is shown

### Requirement: Add a sticker by drag
On desktop and web, items SHALL be draggable onto the timeline (payload type `sticker` or `graphic`; placement by `timeline-editing.Drag and drop from the library`, snapping by `timeline-editing.Snapping`) and onto the preview canvas (inserted at the playhead with its centre at the drop point). On mobile, items are added by tap only. [PORT G-010]

#### Scenario: Drop on the timeline
- **WHEN** the user drops a sticker on an overlay track at 12 s
- **THEN** the element starts at 12 s on that track

#### Scenario: Drop on the canvas
- **WHEN** the user drops a shape on the canvas at (−300, 150)
- **THEN** a graphic element is added at the playhead with position (−300, 150)

### Requirement: Sticker intrinsic size and initial scale
When a sticker element is created, `intrinsicWidth` and `intrinsicHeight` SHALL be captured from the image's natural size (SVG: its viewBox size; fallback 200×200 when the size cannot be determined). The initial scale SHALL be chosen so that the sticker's longer side equals 25 % of the canvas's shorter side. Bounds and hit-testing SHALL use intrinsic size × scale. [PORT G-011] [NEW]

#### Scenario: Initial size
- **WHEN** a 512×256 sticker is added to a 1080×1920 project
- **THEN** its intrinsic size is 512×256 and its initial scale is 0.527 so that its width on canvas is 270 px

#### Scenario: Unknown size
- **WHEN** an SVG without width, height or viewBox is added
- **THEN** its intrinsic size is 200×200

### Requirement: Sticker transform, timing and inspector
Sticker elements SHALL support the visual parameters and canvas interactions owned by `preview-canvas` (`preview-canvas.Basic tab fields`, `preview-canvas.Move elements on the canvas`, `preview-canvas.Scale with handles`, `preview-canvas.Rotate with the handle`, `preview-canvas.Flip, mirror and quarter-turn rotation`, `preview-canvas.Layer order controls`), masks (`masks-blending-keying.Maskable element types`), and trim, move, split and duplicate on the timeline; a static sticker SHALL be extendable to any duration. The inspector tabs of a sticker and of a shape are defined only by `preview-canvas.Inspector structure per element type` (sticker: Sticker with the sub-tabs Basic, Mask and Effects, then Animation and Tracking; shape: Shape with the sub-tabs Shape, Basic, Mask and Effects, then Animation and Tracking); this capability contributes, in Sticker ▸ Basic, a "Replace" button and — for animated stickers — the playback controls of `stickers-shapes.Animated stickers`, and the Shape sub-tab. "Replace" SHALL swap the sticker image while keeping transform, timing, masks, effects and animations. Mobile entry: see `mobile-editor.Text group, text clip and sticker strips`. [CAPCUT CC-190] [NEW]

#### Scenario: Extend duration
- **WHEN** the user trims the end of a static sticker from 5 s to 60 s
- **THEN** the sticker is shown for 60 s

#### Scenario: Replace
- **WHEN** the user replaces a flag sticker with another flag
- **THEN** position, scale, rotation, duration and animations are unchanged

#### Scenario: Mask on a sticker
- **WHEN** a sticker is selected
- **THEN** the inspector offers the Mask sub-tab and adding an ellipse mask clips the sticker

### Requirement: Shape parameter table
Graphic elements other than drawings SHALL be rendered from vector definitions on a 512×512 source; a drawing (`definitionId: "drawing"`) is rendered from its strokes at its intrinsic size (`stickers-shapes.Freehand drawing`). The parameters are the keys of the element's `params` map (`project-document.Graphic element`, the only `params` map on an element; animation paths `params.<key>`), all keyframable except the selects and toggles:

| Param | Applies to | Range | Step | Default |
|---|---|---|---|---|
| `fill` | rectangle, ellipse, polygon, star, arrow | colour with alpha | — | `#ffffff` |
| `stroke` | all | colour with alpha | — | `#000000` (line: `#ffffff`) |
| `strokeWidth` | all | 0–64 (line: 1–64) | 1 | 0 (line: 8) |
| `strokeAlign` | rectangle, ellipse, polygon, star, arrow | inside / center / outside | — | center |
| `cornerRadius` | rectangle, polygon | 0–50 (50 = fully round) | 1 | 0 |
| `sides` | polygon | 3–12 | 1 | 5 |
| `points` | star | 3–12 | 1 | 5 |
| `depth` | star | 1–99 (inner radius as % of outer) | 1 | 45 |
| `lineCap` | line | butt / round / square | — | round |
| `dash` | line | 0–200 (dash and gap length; 0 = solid) | 1 | 0 |
| `headSize` | arrow | 10–90 (% of shape height) | 1 | 40 |
| `shaftWidth` | arrow | 5–90 (% of shape height) | 1 | 30 |
| `doubleHeaded` | arrow | boolean | — | false |
| `colorOverride` | drawing | colour with alpha, or none (`""`) | — | none |

Shapes SHALL be resized non-uniformly with the edge handles and Scale X / Scale Y; corner radius and stroke width SHALL NOT be distorted by non-uniform scale (they are applied after the shape geometry is scaled). [PORT G-012, G-013, G-014, G-015, G-016] [NEW]

#### Scenario: Rounded rectangle
- **WHEN** a rectangle's `cornerRadius` is 50
- **THEN** its short sides are semicircles

#### Scenario: Polygon limits
- **WHEN** the user types 20 in Sides
- **THEN** the value becomes 12

#### Scenario: Star depth
- **WHEN** a star has `points = 5` and `depth = 45`
- **THEN** it has 10 vertices with the inner vertices at 45 % of the outer radius

#### Scenario: Stretch without distortion
- **WHEN** a rectangle with `cornerRadius = 20` and `strokeWidth = 8` is scaled to scaleX 3, scaleY 1
- **THEN** the corners remain circular arcs and the stroke is 8 units thick on every side

### Requirement: Shape stroke
The Shape inspector tab SHALL have a shape section with the definition's parameters and a collapsible Stroke section whose header toggle sets `strokeWidth` to 0 or back to the last non-zero width (2 when there is none). `strokeAlign` SHALL render as: center — stroke straddles the outline; inside — stroke lies entirely within the outline; outside — stroke lies entirely beyond the outline; all three with the fill unaffected. [PORT G-016]

#### Scenario: Toggle stroke
- **WHEN** a shape with `strokeWidth = 6` has its stroke toggled off and on
- **THEN** `strokeWidth` is 0 and then 6 again

#### Scenario: Inside alignment
- **WHEN** `strokeAlign` is inside with width 10
- **THEN** the outer boundary of the shape equals the unstroked outline

### Requirement: Shape parameters are keyframable
Every numeric and colour shape parameter SHALL have a keyframe toggle in the Shape sub-tab and SHALL animate through `keyframe-animation.Interpolation types` (colours per `keyframe-animation.Colour interpolation in linear RGB`). The integer parameters `sides` and `points` SHALL interpolate as scalars according to the segment type, and the resolved value SHALL be rounded to the nearest integer, halves away from zero, before the shape is built. [PORT G-017]

#### Scenario: Animate corner radius
- **WHEN** `cornerRadius` has keyframes 0 at 0 s and 50 at 2 s
- **THEN** at 1 s the corner radius is 25

#### Scenario: Integer parameter rounds down
- **WHEN** `sides` has linear keyframes 3 at 0 s and 6 at 3 s
- **THEN** at 1.4 s the resolved value is 4.4 and the polygon has 4 sides

#### Scenario: Integer parameter rounds half up
- **WHEN** `sides` has linear keyframes 3 at 0 s and 6 at 3 s
- **THEN** at 1.5 s the resolved value is 4.5 and the polygon has 5 sides

### Requirement: Imported stickers
The My stickers tab SHALL provide "Import" accepting PNG, JPEG, WebP, HEIC/HEIF (decoded on every platform — by the platform where it has a decoder, by the bundled decoder elsewhere, as `media-library.Undecodable media handling` defines for image import — and stored as PNG), SVG, GIF, APNG and animated WebP files of up to 20 MB each, several at once: file picker on every platform, drag-and-drop on desktop and web, the photo library picker on mobile ("Use a photo as a sticker"). Each file SHALL be stored in the device sticker library under provider `user`, keyed by SHA-256 (importing the same file twice yields one item), with an editable name (default: file name without extension) and tags. SVG files SHALL be sanitised (scripts, event handlers, external references and `foreignObject` removed) before storage, as required by `security-privacy.Untrusted file and pack handling`. A project that uses an imported sticker SHALL reference a project media asset holding the file, so that the sticker is included in sync, template packages and exports from other devices. Items SHALL have a context menu with Rename, Edit tags and Delete; deleting a library item SHALL NOT affect elements already placed in projects. The library syncs between the user's devices through `cross-device-sync.Library item sync`, and the same list is shown at `/library/stickers`. [CAPCUT CC-189] [NEW]

#### Scenario: Import a PNG
- **WHEN** the user imports `logo.png`
- **THEN** an item named "logo" appears in My stickers and clicking it adds a sticker element

#### Scenario: Duplicate import
- **WHEN** the same file is imported twice
- **THEN** My stickers contains it once

#### Scenario: Unsafe SVG
- **WHEN** an SVG containing a `<script>` element is imported
- **THEN** the stored sticker contains no script and renders its shapes

#### Scenario: Oversized file
- **WHEN** a 35 MB GIF is selected
- **THEN** it is rejected with "Stickers can be up to 20 MB"

### Requirement: Sticker packs
Stickers are distributed in packs. The app SHALL bundle exactly one pack, "Starter" (`stickers-shapes.Starter sticker pack`), which cannot be removed or exported. Users SHALL be able to import further packs as `.jcpack` files whose items have `kind: "sticker"`, through `templates.Import a package` (which owns the package format, validation and limits); the stickers of an imported pack SHALL appear in My stickers under a group named after the pack, stored under provider `user` and keyed by SHA-256 like other imported stickers, with the pack's `author` and `license` shown in the group header. A pack group SHALL offer "Remove pack", which deletes its library items after confirmation and leaves elements already placed in projects untouched. Selecting stickers in My stickers and choosing "Export as pack" SHALL write a `.jcpack` through `templates.Export a package`. [NEW]

#### Scenario: Import a sticker pack
- **WHEN** a `.jcpack` with 12 sticker items named "Doodles" is imported
- **THEN** My stickers shows a group "Doodles" with 12 items and its author and licence

#### Scenario: Remove a pack
- **WHEN** the user removes the pack "Doodles" while one of its stickers is used in the open project
- **THEN** the group disappears from My stickers and the sticker in the project still renders

#### Scenario: Starter pack is fixed
- **WHEN** the user opens the menu of a starter category
- **THEN** no "Remove pack" or "Export as pack" action is offered

### Requirement: Animated stickers
GIF, APNG and animated WebP stickers (imported, generated or from the starter pack) SHALL play their frames in the preview and in exports with their own frame timing, frame-accurately for any playhead time (seeking shows the frame for `elementLocalTime × playbackSpeed modulo animationDuration`). Parameters: `loop` (boolean, default true; when false the last frame holds after one pass) and `playbackSpeed` (0.1–4, step 0.1, default 1). The default duration of an animated sticker SHALL be the greater of the default sticker duration preference and one full pass. Animated items SHALL animate in the panel on hover (always on mobile when visible, limited to 12 concurrently animating tiles). [CAPCUT CC-187] [NEW]

#### Scenario: Looping
- **WHEN** a 2 s animated sticker lasts 5 s on the timeline with loop on and speed 1
- **THEN** it plays two and a half passes and the frame shown at element time 4.5 s is the frame at 0.5 s of the animation

#### Scenario: Loop off
- **WHEN** the same sticker has loop off
- **THEN** from element time 2 s on the last frame of the animation is shown

#### Scenario: Export matches preview
- **WHEN** the project is exported
- **THEN** each exported frame shows the same animation frame as the preview at that time

### Requirement: AI-generated stickers
The Generated tab SHALL contain a prompt field (1–500 characters), a style select (the styles of the routed image model as listed by `generation-providers.Capability metadata`) and a Generate button producing up to 4 candidate stickers with transparent background per request as a job of kind `generation.image` in the host job queue. It needs a host with an `image` route configured (`orc-model-routing.Routes with primary and ordered fallbacks`) and a device with the scope `jagentchill.generation.run`; otherwise the tab SHALL show the requires-host state of `ai-editing-tools.Offline and no-provider behaviour` with a link to the provider settings, and Generate SHALL be disabled. Consent, the cost estimate shown before the request, approval thresholds and budgets are owned by `generation-providers.Data leaving the machine`, `generation-providers.Cost estimate` and `generation-providers.Budgets with hard stop`. Each candidate SHALL have Add (inserts it as a sticker and saves it under provider `generated`) and Discard. Background removal for providers that cannot output transparency SHALL use `ai-editing-tools.Background removal for images`. Failures and cancelled jobs SHALL leave no item. Saved generated stickers SHALL be listed in the Generated tab with the prompt as tooltip, SHALL carry the provenance of `ai-editing-tools.Generated asset provenance`, and SHALL be managed like imported stickers. [CAPCUT CC-188] [NEW]

#### Scenario: Generate and add
- **WHEN** the user enters "smiling sun, flat style" and presses Generate while connected
- **THEN** up to 4 candidates appear and pressing Add on one inserts a sticker with a transparent background at the playhead

#### Scenario: No host
- **WHEN** no host is connected
- **THEN** the Generate button is disabled and the requires-host state is shown

#### Scenario: Budget reached
- **WHEN** the request would exceed a hard-stop budget
- **THEN** no job is created and the budget message of `generation-providers.Budgets with hard stop` is shown

#### Scenario: Provider error
- **WHEN** the provider rejects the request
- **THEN** the error message from the job is shown with a Retry button and no item is saved

### Requirement: Sticker and shape animation and tracking
Sticker and graphic elements SHALL support the In, Out and Combo clip animations of `keyframe-animation.Clip animation model` (library: `keyframe-animation.Bundled clip animation library`; there is no Loop group for stickers and shapes — the looping Combo animations cover it) and keyframes through the Animation tab. The Tracking tab SHALL bind the element to a tracked subject with exactly the binding model, controls, loss rule, strings and accuracy tolerance of `text-and-titles.Text tracking`: a non-destructive `tracking {targetElementId, trackId, followPosition, followScale, followRotation, offset}` binding on the element, resolved live, with "Remove tracking" and "Convert to keyframes"; for stickers and shapes `followScale` and `followRotation` default to true. [CAPCUT CC-191] [NEW]

#### Scenario: In animation on a sticker
- **WHEN** the user applies an In clip animation of 0.5 s to a sticker
- **THEN** the animation plays during the sticker's first 0.5 s and the sticker is at rest afterwards

#### Scenario: No Loop group
- **WHEN** the Animation tab of a sticker is opened
- **THEN** it shows the groups In, Out and Combo and no Loop group

#### Scenario: Sticker follows a subject
- **WHEN** a sticker is bound to a tracked face
- **THEN** the sticker keeps its offset from the face throughout the tracked range and has no position keyframes

#### Scenario: Target lost
- **WHEN** tracking confidence stays below 0.3 for more than 0.5 s
- **THEN** the Tracking tab shows "Target lost at {timecode}" with "Adjust region and continue"

### Requirement: Freehand drawing
A Draw tool (the Draw tool of `mobile-editor.Text group, text clip and sticker strips` on mobile, a `canvasInteractive` sheet; a Draw button in the Stickers tab on desktop and web) SHALL enter drawing mode on the preview canvas with: brush size 1–200 canvas px (default 12), colour with alpha (default `#ffffff`), brush type Pen (hard edge) or Marker (50 % opacity, flat cap), an Eraser that removes whole strokes it touches, and Undo/Redo of individual strokes inside the mode. Each stroke SHALL be stored as a vector path with pressure-independent width: the sampled points are simplified with a tolerance of 1 canvas px (Ramer–Douglas–Peucker) and the path is a centripetal Catmull–Rom spline through the remaining points. The stored geometry is owned by `project-document.Freehand drawing geometry` and not restated: `strokes[] {id, points, width, color, brush}` with points in element-local px relative to the centre of the drawing's bounding box, `intrinsicWidth` / `intrinsicHeight` = the bounding box of all strokes expanded by half the largest stroke width, and `transform.position` = that box's centre on the canvas — so on Done the drawing appears exactly where it was drawn at scale 1, and adding or erasing strokes afterwards recomputes the box without moving existing strokes. Rendering: strokes are drawn in array order with round joins; a `pen` stroke has round caps and its own alpha; a `marker` stroke has flat caps and is composited as one group at 50 % of its colour's alpha, so a marker stroke that crosses itself does not darken at the crossing while two different marker strokes do build up; the drawing is rasterised at its displayed size capped at 4 096 px on the long side (`render-engine.Text and graphic rasterisation`), and its selection bounds are the intrinsic size × scale (`preview-canvas.Hit-testing candidates and order`). Done SHALL create one graphic element with `definitionId = "drawing"` containing all strokes, starting at the playhead with the default sticker and graphic duration preference, as one undo step; Cancel SHALL discard. A drawing with zero strokes SHALL create nothing. A drawing SHALL hold at most 2 000 strokes and 200 000 points; reaching a limit SHALL stop new strokes with the toast "Drawing is full". A drawing element SHALL support the visual parameters of `preview-canvas.Basic tab fields` and re-entering drawing mode by double-click (Edit drawing on mobile) to add or erase strokes. Its inspector is the row "Drawing (Drawing, Basic, Mask, Effects), Animation, Tracking" of `preview-canvas.Inspector structure per element type`; the Drawing sub-tab SHALL contain: the stroke count; "Colour override" (a switch plus colour with alpha, writing `params.colorOverride`, keyframable — when set, every stroke is drawn in that colour, marker strokes keeping their 50 % rule, and the stored `strokes[].color` values are untouched so turning it off restores them); and "Edit drawing". The shape parameters `fill`, `stroke`, `strokeWidth` and the others of `stickers-shapes.Shape parameter table` do not apply to a drawing and are not shown. Agents create and edit drawings through the sticker and shape tools of `agent-editing-tools`. While drawing mode is active, canvas selection and transform handles SHALL be disabled and playback SHALL be paused. [CAPCUT CC-185] [NEW]

#### Scenario: Draw and commit
- **WHEN** the user draws three strokes and presses Done
- **THEN** one drawing element with three strokes exists at the playhead and one undo removes it

#### Scenario: Smoothing
- **WHEN** the user draws a straight line sampled as 200 collinear points
- **THEN** the stored stroke has 2 points

#### Scenario: Erase
- **WHEN** the user touches the second stroke with the eraser
- **THEN** only the second stroke is removed

#### Scenario: Cancel
- **WHEN** the user presses Cancel after drawing
- **THEN** no element is created and the undo history is unchanged

#### Scenario: Drawing appears where it was drawn
- **WHEN** on a 1920×1080 canvas the user draws one pen stroke of width 12 from canvas point (200, 300) to (1100, 300) and presses Done
- **THEN** the element has `intrinsicWidth` 912 and `intrinsicHeight` 12, `transform.position` at the canvas point (650, 300), and the stroke renders from (200, 300) to (1100, 300)

#### Scenario: Marker crossing itself
- **WHEN** a marker stroke in `#ff0000` loops over itself
- **THEN** the crossing has the same 50 % alpha as the rest of the stroke

#### Scenario: Colour override
- **WHEN** a drawing with a white and a red stroke gets "Colour override" `#00ff00` and the override is then turned off
- **THEN** both strokes render green while it is on, and white and red again afterwards

#### Scenario: Drawing is not a shape item
- **WHEN** the Shapes tab is opened
- **THEN** it lists six items and none named Drawing

### Requirement: Missing sticker state
When a sticker element's provider is unknown or its asset cannot be resolved, the canvas SHALL show a dashed outline rectangle of the element's intrinsic size with a "missing" icon, the timeline bar SHALL show a warning badge, the inspector SHALL show "Sticker not available on this device" with the actions Replace and Remove, and the stored `stickerId` SHALL be preserved. Export SHALL skip the missing sticker and list it in `export-share.Export summary`. When the asset becomes available (for example after sync) the sticker SHALL render without user action. [NEW]

#### Scenario: Asset not yet synced
- **WHEN** a project using an imported sticker is opened before its file has synced
- **THEN** the missing state is shown and is replaced by the sticker when the file arrives

#### Scenario: Export with a missing sticker
- **WHEN** the project is exported while a sticker is missing
- **THEN** the export completes and its summary lists the missing sticker by name

### Requirement: Sticker settings persistence
The store `stickers-settings` (versioned, `project-storage.UI preference storage`) SHALL persist per device the selected category and the recents list. On load the selected category SHALL fall back to All when it is not a known tab, and the recents list SHALL be sanitised against known providers and de-duplicated. Imported and generated sticker libraries SHALL be persisted through `project-storage.Storage port and per-platform stores`, synced by `cross-device-sync.Library item sync` and included in backups. [PORT G-005] [NEW]

#### Scenario: Unknown stored category
- **WHEN** the stored category is `logos`
- **THEN** the panel opens on All without an error

#### Scenario: Library on a second device
- **WHEN** a second paired device has finished syncing
- **THEN** its My stickers tab lists the stickers imported on the first device
