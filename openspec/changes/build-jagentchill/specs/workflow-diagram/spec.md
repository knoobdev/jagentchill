## ADDED Requirements

### Requirement: Archify fork package
The workflow graph SHALL be drawn by one renderer, the `WorkflowCanvas` component exported by `packages/archify`, a fork of archify (MIT, upstream `https://github.com/tt-a1i/archify`) extended into an editable canvas (design D12) and used on iOS, Android, web and the Electron desktop app. The package layout is: `upstream/` — the archify tree imported as a git subtree from the pinned upstream commit recorded in `packages/archify/UPSTREAM.md` (commit hash, commit date, upstream version; the initial pin is commit `594f6087358610bd16e64e5602976020871b6bff`, archify 3.0.1); `src/` — code written by the product (free-position layout, scene, router adapter, interaction, camera, bridge, run overlay, platform adapters); and `PATCHES.md` — the patch inventory, one row per file under `upstream/` that differs from the pinned commit, with its path, the reason, whether the change is offered upstream, and the test that covers it. The repository MUST define a git remote named `archify-upstream` for the upstream URL, separate from the OpenClaw remote of `platform-skeleton.Fork baseline and remotes`. The upstream-sync procedure is documented in `docs/product/ARCHIFY-SYNC.md` and has exactly these steps: fetch `archify-upstream`; `git subtree pull` the chosen commit into `upstream/`; resolve conflicts, which can arise only in files listed in `PATCHES.md`; regenerate the generated artefacts (`upstream/archify/assets/template.html` and the fork's standalone template through `upstream/scripts/generate-viewer.mjs`, the schema validators through `upstream/archify/scripts/generate-validators.mjs`); run upstream's own test suite (`npm test` in `upstream/archify`), the fork's tests, the `archify-projection` gate of "Archify HTML export on the host" and the golden-image suite; and update `UPSTREAM.md`, `PATCHES.md` and the packaged `VERSION` file in the same change. A sync is performed before each minor release of the app and whenever upstream publishes a security fix. The CI gate `archify-fork-inventory` MUST fail when the set of files under `upstream/` that differ from the pinned commit is not exactly the set listed in `PATCHES.md`, or when the commit in `UPSTREAM.md` is not reachable from `archify-upstream`. Licence: `THIRD_PARTY_NOTICES.md` carries archify's MIT notice with both upstream copyright lines ("Copyright (c) 2026 tt-a1i (Archify)" and "Copyright (c) 2025 Cocoon AI"), the SIL OFL 1.1 notice of the JetBrains Mono subsets that archify's viewer template embeds, and a statement that the fork is a modified version, per `platform-skeleton.Licence and third-party notices`; upstream's own `LICENSE` and `THIRD_PARTY_NOTICES.md` stay unmodified inside `upstream/`. Archify's catalogue of third-party brand marks (`upstream/archify/renderers/shared/generated-brand-marks.mjs`, whose marks carry individual licences that upstream's notices list, among them CC-BY-SA and CC-BY-NC-SA) MUST NOT be part of any shipped bundle: the canvas build and the archify CLI packaged with the server use an empty catalogue, and the `brand` field of an archify node is never drawn. The package MUST NOT depend on, import or vendor any other third-party graph, diagram, node-editor or graph-layout library (for example React Flow / xyflow, JointJS, GoJS, Cytoscape, mxGraph, D3 force or hierarchy layouts, dagre, elkjs, Mermaid): archify's runtime has no dependencies of its own, the canvas bundle adds only `packages/workflow` (pure rule functions) and `packages/protocol`, and graph layout comes from `agent-workflows.Deterministic auto-layout`. A dependency gate in CI fails when the package's resolved dependency tree contains a package from the denied list kept in `packages/archify/denied-dependencies.json`. The canvas bundle, its stylesheet and all fonts are served from the app bundle (never from an external host). Chrome around the scene (toolbar, palette, inspector, menus, dialogs, sheets) is built from `design-system` components and is not part of the fork. OpenClaw provides no graph canvas and none of its UI is reused: the renderer runs on the client and needs nothing from OpenClaw. The package is built in JAgentChill's own pnpm workspace (design D1); nothing of it is built inside, or placed in, `gateway/openclaw/`. Renderer-specific text is confined to the **rendering architecture group** of this specification — "Archify fork package", "Archify module reuse map", "Runtime hosting on each platform", "Environment-neutral compile core", "Free-position layout mode", "Host message protocol", "Intents and confirmed state", "Theme mapping and fonts", "Incremental rendering pipeline", "Scene layers, culling and virtualisation", "Level of detail by zoom", "Text rendering", "Hit-testing", "Performance budgets and load shedding", "Animation implementation in the renderer", "Renderer load failure and process loss", "Oversized documents and upstream schema mismatch", "Renderer spike S19 and fallback renderer", "Interactive HTML export from the fork", "Archify HTML export on the host", "Image export, copy and print", "Motion export to WebM", "Test hooks and deterministic rendering" and "Golden-image tests of the canvas" — so that every other requirement of this capability, and every requirement of every other capability, states observable behaviour only and holds unchanged for the fallback renderer of "Renderer spike S19 and fallback renderer". [NEW]

#### Scenario: Same component on every platform
- **WHEN** the workflow fixture `wf-200` is opened on web, Electron, an iPhone and an Android phone
- **THEN** each platform mounts `WorkflowCanvas` from `packages/archify`
- **AND** every node's rectangle in canvas coordinates is identical on all four within 0.5 px at 100 % zoom

#### Scenario: Denied dependency
- **WHEN** a change adds `dagre` to the dependencies of `packages/archify`
- **THEN** the dependency gate fails and names the package and the denied-list entry

#### Scenario: Patch inventory out of date
- **WHEN** a change edits `upstream/archify/renderers/shared/geometry.mjs` without a row for that file in `PATCHES.md`
- **THEN** the gate `archify-fork-inventory` fails and names the file

#### Scenario: No external fetch for the renderer
- **WHEN** a canvas is mounted for the first time on web with the network panel recording
- **THEN** the canvas bundle, its stylesheet and every font are requested only from the app's own origin

#### Scenario: Brand marks are not shipped
- **WHEN** the release bundles of the app and of JAgentChill Server are scanned for the path data of archify's brand-mark catalogue
- **THEN** none is found, and an imported archify node that carries a `brand` field is drawn without a mark

#### Scenario: Requirements outside the group are renderer-independent
- **WHEN** the spec lint of the CI gate scans every requirement of this capability outside the rendering architecture group, and every other capability spec, for the renderer terms listed in `packages/archify/renderer-terms.json` (the names of the hosting surface, document object model, style and animation interfaces the renderer uses)
- **THEN** it finds none

### Requirement: Archify module reuse map
The fork SHALL classify every archify module it touches into one of three classes, recorded in `PATCHES.md` and enforced by `archify-fork-inventory`; paths below are relative to `packages/archify/upstream/` and line numbers refer to the initial pin.

**Reused unchanged — loaded by the canvas runtime:** `archify/renderers/shared/spatial-grid.mjs` (`createSpatialGrid`); `archify/renderers/shared/utils.mjs` (`textUnits`, `esc`, `renderDefinitions`, `renderSemanticSigil`, `applyTemplate`); `archify/renderers/shared/i18n.mjs`; `archify/renderers/shared/text-fit.mjs`; `archify/renderers/shared/route-quality.mjs` (`shortestOrthogonalGridRoute`); `archify/renderers/shared/legend.mjs`; `archify/renderers/shared/validator.mjs` and `generated-validators.mjs` with `archify/schemas/*.json` (the upstream schema check); `archify/assets/JetBrainsMono-OFL.txt`; and, only inside the standalone template of "Interactive HTML export from the fork", the viewer fragments `viewer/node-finder.js`, `viewer/node-outline.js`, `viewer/focus.js`, `viewer/reader-layout.js`, `viewer/viewer-chrome-layout.js` and `viewer/export-cleanup.js`.

**Reused unchanged — host-only, never in the canvas bundle:** the CLI (`archify/bin/archify.mjs`, `finalize.mjs`, `preview.mjs`, `visual-check.mjs`, `open-artifact.mjs`, `delivery-update.mjs`, `recover-output.mjs`); `archify/renderers/shared/atomic-output.mjs`, `output-path.mjs`, `path-semantics.mjs`, `repository-evidence.mjs`, `repository-location.mjs`, `sidecar-path.mjs`; `archify/renderers/workflow/render-workflow.mjs`; `archify/migrations/workflow-v2.mjs`; the four other typed renderers (`architecture`, `sequence`, `dataflow`, `lifecycle`) and `archify/delta/`. The viewer fragments `viewer/guided-views.js`, `viewer/semantic-lens.js`, `viewer/semantic-radar.js` and `viewer/route-probe.js` stay in the tree unchanged and are not assembled into the fork's template.

**Modified in place (each a `PATCHES.md` row):**

| File | Change |
|---|---|
| `archify/renderers/shared/diagnostics.mjs` | the module-level `node:fs` and `node:path` imports (lines 1–2), the `process.env` read (line 4) and the `SharedArrayBuffer` allocated when the module loads (line 111) move to a Node-only entry; the pure record and throw functions stay |
| `archify/renderers/shared/geometry.mjs` | the `process.env.ARCHIFY_QUALITY_PROFILE` read (line 1263) becomes an injected option; no geometry function changes |
| `archify/renderers/shared/portable-path.mjs` | `Buffer.byteLength` (line 194) is replaced by a `TextEncoder` byte count |
| `archify/renderers/shared/cli.mjs` | the pure SVG attribute helpers (`validateCrossCollectionContracts` 377, `svgRootAttrs` 382, `svgAccessibleText` 397, `animateAttr` 402, `focusNodeAttrs` 414, `focusNodeTitle` 438, `focusEdgeAttrs` 444) move to a new neutral module `svg-attrs.mjs` and are re-exported; the file-reading and file-writing functions stay Node-only |
| `archify/renderers/shared/brand-marks.mjs`, `generated-brand-marks.mjs` | the network capture code (`node:dns`, `node:http`, `node:https`, `node:net`, lines 2–5) stays host-only; shipped copies carry an empty catalogue |
| `archify/renderers/workflow/workflow-compiler.mjs` | imports re-pointed to the neutral modules; `compileWorkflow` (line 4911) and its lane × column output stay byte-identical for upstream documents |
| `viewer/motion-governor.js` | bound to one canvas instance instead of the page (upstream reads `document.querySelector('.diagram-container svg')` and a page-global `Archify`); the `localStorage` key `archify-motion` (line 7) is removed; still/live is driven by the host preference; motion owners gain `drag`, `replay`, `build` and `run` |
| `viewer/intent-trace.js` | bound to one canvas instance; the overlay-clone technique (`traceGeometry`, line 65, with `pathLength="1"`) is generalised to edge flow, draw-on and hover focus |
| `viewer/export.js` | `serializeSvg` (228), `rasterize` (552) and `recordWebm` (792) take scope, scale, theme, background and run-status options and return bytes to the caller instead of starting a download |
| `viewer/viewer.css` | the theme variable blocks (lines 5–90) are generated from design tokens; the presets `signal-flow`, `blueprint` and `editorial` are not included; the still-mode rules (lines 665–721) cover the fork's animations |
| `viewer/template.source.html`, `scripts/generate-viewer.mjs` | a second assembly target produces the fork's standalone template with the fork's fragment list |

**Replaced by new code:** `viewer/viewer-camera.js` is not used by the canvas — upstream clamps scale to 1–3 in steps of 0.25 (line 236), pans only above scale 1 (line 476), has no wheel or pinch input and assumes a fixed `viewBox`; the fork's camera keeps the `Archify.view` interface (`zoomIn`, `zoomOut`, `reset`, `reveal`, `centerAt`, `logicalViewport`, `sync`, `state`) so the reused fragments keep working.

**New, under `src/`:** `core/free-layout` (rectangle table from stored positions), `core/text-measure` with a generated font-metrics table, `core/router` (free-position routing on the shared geometry), `core/ports`, `core/node-types`, `scene/scene` (retained scene, element reuse, culling, level of detail), `scene/static-svg` (string emitter for exports and thumbnails), `interaction/pointer`, `interaction/keyboard`, `interaction/snapping`, `interaction/connect`, `camera/camera`, `run/overlay`, `run/replay`, `bridge/protocol`, `bridge/web` (the component for web and desktop), `bridge/native` (the component around the native view on iOS and Android), `export/standalone`, and `testing/test-bridge`. Nothing in `src/` duplicates a function that an unchanged or modified upstream module already exports. [NEW]

#### Scenario: Unchanged module stays unchanged
- **WHEN** `upstream/archify/renderers/shared/spatial-grid.mjs` is compared with the pinned commit
- **THEN** the files are byte-identical and `PATCHES.md` has no row for it

#### Scenario: Upstream output preserved by the patches
- **WHEN** upstream's golden test (`node test/golden.mjs` in `upstream/archify`) runs against the patched tree
- **THEN** every upstream example renders byte-identical output to the pinned commit

#### Scenario: Camera interface kept for reused fragments
- **WHEN** a result is chosen in the node finder of an exported interactive HTML file
- **THEN** the fork's camera reveals the node through `Archify.view.reveal`, without `viewer/viewer-camera.js` being present in the file

### Requirement: Runtime hosting on each platform
The renderer SHALL be SVG in the DOM: each canvas instance owns one container element holding one scene `<svg>` root, a separate minimap `<svg>` and the inline text fields; it uses no raster drawing surface, no WebGL and no WebAssembly. **Web and desktop (Electron):** `WorkflowCanvas` is a React DOM component that mounts the canvas runtime directly in the app's document, without an iframe, inside a shadow root so that archify-derived class names and style rules neither leak into nor are affected by the app; several instances can live in one document because every fork module is bound to its instance root. **iOS and Android:** the canvas runs inside a WebView hosted by a product-owned Expo native view module `JagentchillCanvasView` in `apps/app`, whose native interface — props (including `interactive`), methods, events, the binary sink and the local origins (Android `https://canvas.jagentchill.localhost/`, iOS `jagentchill-canvas://app/`) — is owned by `mobile-editor.Canvas view native module` and is not restated here (design D4; the stock `react-native-webview` package is not used). This requirement owns what runs inside it: the module loads only the bundled canvas page (page, script bundle, stylesheet and fonts from the app bundle), navigation to any other origin is blocked, and the page's content security policy allows scripts, styles and fonts only from the canvas origin and images only from that origin and from the resources the app registered through the module's resource map. **Touch ownership:** unlike the engine view, which ignores pointer input, the canvas WebView receives and handles every touch that lands on it — pan, pinch, tap, double-tap, long-press and drag are recognised inside the canvas page from pointer events; the page sets `touch-action: none` on the scene, disables page zoom, text selection, the long-press callout and overscroll bounce everywhere except inside an open inline text field; and the React Native layer installs no gesture recogniser over the scene. The exception is non-interactive use: in `miniature` mode and for thumbnails `JagentchillCanvasView` is mounted with `interactive: false` (user interaction disabled on the native view) on both iOS and Android, so every touch passes to the parent and a scrolling list scrolls normally over it, and the tap-to-expand target is a React Native pressable laid over the view. React Native chrome placed around or above the WebView (top bar, floating buttons, bottom sheets) takes its own touches, and the system back gesture stays with the system. Haptics are requested by the canvas with a `haptic` event and played natively. **Keyboard:** while the scene has focus, key events are handled inside the canvas runtime against the binding table the app supplies with `setPreferences` (read from `keyboard-shortcuts.Active binding lookup`); actions the canvas does not perform itself are forwarded as `uiRequest {kind: "action"}`. **Start-up and pooling:** the canvas MUST emit `ready` within 1,500 ms of mounting on the reference desktop and within 2,500 ms of creating the native view on the reference phones (`diagnostics-quality.Reference devices`), and within 400 ms when a warm pooled WebView is reused; on phones and tablets at most 2 canvas WebViews are alive at once (one interactive canvas and one shared instance for miniatures and thumbnails), and the shared instance is released after 30 s in the background. All document, run, selection, viewport and undo state is held by the app outside the canvas runtime, so losing the runtime loses nothing ("Renderer load failure and process loss"). On the web the runtimes are the browsers measured by spike S19 (Chromium-based, Safari and Firefox); desktop is the Electron shell on macOS, Windows and Linux with identical behaviour. The canvas runtime needs only SVG rendering, pointer events, CSS custom properties, the Web Animations API and ES2020 modules; it does not depend on any capability probed by `mobile-editor.WebView capability spike matrix`, and its minimum OS versions are those of design D4. [NEW]

#### Scenario: Mounted in the app document on web
- **WHEN** the workflow route is opened on web
- **THEN** the scene `<svg>` is inside a shadow root of the app's own document and no iframe is created

#### Scenario: Touches are handled by the canvas on a phone
- **WHEN** the user pinches on the scene of an Android phone
- **THEN** the canvas zoom changes about the pinch midpoint, the page itself does not zoom, and no React Native gesture handler receives the touches

#### Scenario: Navigation is blocked
- **WHEN** script inside the canvas page attempts to navigate to an external URL
- **THEN** the navigation is refused and the canvas keeps running

#### Scenario: Two canvases in one document
- **WHEN** the chat widget and the Diagram tab are mounted in the same web document
- **THEN** each instance has its own scene root, camera and motion state, and pausing motion in one does not pause the other

#### Scenario: Warm start on a phone
- **WHEN** a workflow is opened on the reference Android phone while a pooled canvas WebView exists
- **THEN** `ready` is received within 400 ms

### Requirement: Environment-neutral compile core
The fork SHALL expose an entry `packages/archify/core` that is environment-neutral — it runs unchanged in Chromium, WebKit and Node — and contains: upstream schema validation (`validateSchema`), the lane × column compiler (`compileWorkflow`), the shared geometry, routing, text-fit and legend modules, and the fork's free-position layout, router, text measurement and static SVG emitter. No module reachable from `core` imports a `node:` module, references `process`, `Buffer`, `__dirname` or `require`, or touches `SharedArrayBuffer`, `Atomics`, `localStorage`, `document` or `window` when it loads. As read on the pinned commit, `workflow-compiler.mjs` reaches Node APIs only through four imports, each neutralised as listed in "Archify module reuse map": `shared/cli.mjs` (`node:crypto`, `node:fs`, `node:path`), `shared/diagnostics.mjs` (`node:fs`, `node:path`, `process.env`, a `SharedArrayBuffer` at load), `shared/brand-marks.mjs` (`node:crypto`, `node:dns`, `node:http`, `node:https`, `node:net`) and `shared/validator.mjs` → `generated-validators.mjs` → `portable-path.mjs` (`Buffer`); `shared/geometry.mjs` reads `process.env` in one function. Everything else stays **host-only** behind the entry `packages/archify/node` and is never part of the canvas bundle: the CLI and its commands, atomic file publication, output-path and path-semantics resolution, repository evidence (which spawns `git`), brand capture (network), the `preview` loopback server, and `finalize`, `browser-check` and `visual-check`, which need a Chrome binary (`ARCHIFY_CHROME`) and which the product never invokes. The CI gate `archify-core-neutral` MUST (1) bundle `core` for a browser target with every Node built-in unresolvable and fail on any unresolved import; (2) run the core unit tests in headless Chromium and headless WebKit; and (3) assert that for every upstream workflow example the `receipt` returned by `compileWorkflow` (node rectangles, edge points and label rectangles) is equal in Node, Chromium and WebKit. `compileWorkflow` is used by the product only to check documents in upstream's lane × column form ("Archify HTML export on the host", "Renderer spike S19 and fallback renderer"); it is never called on the editing path ("Incremental rendering pipeline"). [NEW]

#### Scenario: Node built-in reaches the core
- **WHEN** a change makes a module reachable from `core` import `node:fs`
- **THEN** the gate `archify-core-neutral` fails and names the importing module

#### Scenario: Same receipt in three runtimes
- **WHEN** `compileWorkflow` runs on `upstream/archify/examples/agent-tool-call.workflow.json` in Node, headless Chromium and headless WebKit
- **THEN** the three receipts are equal

#### Scenario: Core loads without shared memory
- **WHEN** `core` is imported in a page that is not cross-origin isolated, where `SharedArrayBuffer` is undefined
- **THEN** the import succeeds and `compileWorkflow` returns a result

### Requirement: Free-position layout mode
The fork SHALL add a second layout provider, `free`, next to archify's lane × column provider, and use it for every `agent-workflows.Workflow document`. In upstream every node carries `lane` and `col` (0–5), the compiler derives node rectangles from lane geometry (`createWorkflowLaneGeometry`, `measureWorkflowNodes`), and routing and label placement then consume only those measured rectangles `{x, y, width, height, cx, cy}`; the shared geometry is layout-agnostic. In `free` mode the rectangle table is built directly from each node's stored `position {x, y}` (top-left, on the 20-unit grid of `agent-workflows.Canvas geometry stored in the document`) and `size.width`, with the height computed from content per "Node anatomy"; one canvas unit is one SVG user unit. No lane, column band (upstream `phases`), column centre or lane-gap channel exists in this mode and none is drawn; the scene has no fixed `viewBox` (the camera transform of "Animation implementation in the renderer" replaces upstream's view-box growth). The fork never moves a node on its own: upstream's capacity repair and rank-gap feedback are not applied, and layout is **fail-open** — overlapping nodes, crossing edges and label collisions never prevent drawing, and upstream's blocking gates (clean-flow, crossing, label-clearance, `workflow/solver-budget-exhausted`) are not applied to free documents; their collectors are used only to decide what "Edge labels" hides. Routing and label clearance still come from archify's shared modules: obstacle queries through `createSpatialGrid` (160-unit cells, as upstream's `OBSTACLE_CELL`), intersection tests through `segmentIntersectsRect` and `segmentRectClearance`, obstacle-aware paths through `shortestOrthogonalGridRoute`, point clean-up through `normalizeRoutePoints`, corner rounding through `roundedPath`, label anchors through `labelPoint`, and label clearance through `collectLabelRouteClearance`. **Ports** are first-class elements, which upstream does not have (its edges end on side anchors spread by `automaticPortSpread`): every declared port is a `<g data-port-id data-port-node data-port-direction data-port-family>` inside its node group at the position "Ports" defines, edges start and end at port centres with fixed sides (outputs leave to the right, inputs enter from the left), and each edge element carries upstream's `data-edge-from`, `data-edge-to` and `data-edge-id` plus `data-edge-from-port` and `data-edge-to-port`. **Groups** (annotation frames) are drawn at the document's free `frame` rectangle — upstream groups are lane-bound column spans — and keep upstream's `data-graph-role="structural-frame"` and `data-composition-frame-kind="group"` hooks; **sticky notes** are a new element kind carrying `data-note-id`; neither is a routing obstacle. Node elements keep upstream's hooks so that reused modules and exports work unchanged: the attributes produced by `focusNodeAttrs` (`id="node-<id>"`, `data-node-id`, `data-node-label`, `data-node-kind` holding the archify base type of "Node type visual identities"), the mask-rectangle plus fill-rectangle pair, and the `data-detail` tiers `context` and `fine`. A document in upstream's lane × column form is never shown as lanes: it becomes a free-position workflow through "Archify import". [NEW]

#### Scenario: Stored position is honoured
- **WHEN** a document stores a node at position (−4,820, 9,340)
- **THEN** the node's rectangle in the scene starts at (−4,820, 9,340) and no lane or column frame is drawn

#### Scenario: Overlap does not block drawing
- **WHEN** two nodes overlap and an edge label collides with a third node
- **THEN** all nodes and edges are drawn, the colliding label is hidden per "Edge labels", and no error is raised

#### Scenario: Ports are elements
- **WHEN** a node with 2 inputs and 1 output is drawn
- **THEN** its group contains three port elements with `data-port-direction` `in`, `in` and `out`, and each connected edge carries the matching `data-edge-from-port` or `data-edge-to-port`

#### Scenario: Group frame is free
- **WHEN** a group's `frame` is `{x: 100, y: 60, width: 500, height: 380}`
- **THEN** the frame is drawn at exactly that rectangle

### Requirement: Host message protocol
The canvas SHALL be controlled only through a typed message protocol defined in `packages/archify/src/bridge/protocol` and validated with schemas from `packages/protocol`; archify has no host API (no message listener, no documented programmatic surface), so this protocol is new. The canvas runtime has no host connection of its own: it performs no RPC and opens no socket, and everything it shows arrives in commands. Envelope: `{v: 1, id, kind: "cmd" | "evt" | "ack", name, payload, replyTo?}`, at most 1 MiB of JSON per message. On web and desktop the same envelopes are passed in-process as objects, delivered in a microtask; on iOS and Android they are JSON strings through `post` and `onMessage` of "Runtime hosting on each platform", and binary results are returned in chunks of at most 4 MiB through the sink mechanism of `mobile-editor.Engine binary return path`. Commands are processed in the order sent; each is answered by an `ack` `{ok: true}` or `{ok: false, code}` within 1,000 ms; an unknown `name` or a payload that fails its schema is answered with `canvas/protocol-error` and changes nothing.

| Command (app → canvas) | Payload | Effect |
|---|---|---|
| `loadDocument` | `{document, seq, mode, editable, reasonChip?, focus?, viewport?}` | replaces the confirmed state and builds the scene |
| `applyOps` | `{ops[], seq, origin: "local" \| "remote" \| "agent" \| "undo" \| "revert", actor?, intentId?, animate}` | applies a batch of `agent-workflows.Graph operations` to the confirmed state |
| `rejectIntent` | `{intentId, code, message}` | discards the preview of that intent |
| `setSelection` | `{ids[], reveal}` | sets the selection |
| `setViewport` | `{x, y, zoom, animate}` or `{command: "fit" \| "selection" \| "centre" \| "reveal", ids?, animate}`, and `{insets}` | moves the camera; declares areas covered by panels and sheets |
| `setRunOverlay` | `{runId, overlay}`, `{runId, seq, changes[]}` or `{runId: null}` | loads, updates or clears run state; `overlay` holds the run status and one **aggregate per node and per edge** (the per-node aggregates of `jagentchill.workflow.run.get`, `agent-workflows.Live run events`: status, counts, progress, cost and the latest execution) — at most one entry per node and edge of the snapshot and at most 256 KiB, whatever the number of executions; per-execution detail stays in the app and is shown by the detail panel |
| `startReplay`, `controlReplay`, `stopReplay` | `{runId, snapshotDocument, entries[], speed, skipIdle}`; `{action: "play" \| "pause" \| "seek" \| "step" \| "speed" \| "skipIdle" \| "append", value}` | run replay |
| `export` | `{exportId, format: "png" \| "svg" \| "webm" \| "html" \| "thumbnail", options}` | starts an export |
| `setTheme` | `{theme: "light" \| "dark", tokens}` | applies token values |
| `setPreferences` | `{reducedMotion, gridStyle, guides, wheelZooms, locale, direction, bindings}` | device preferences |
| `setMode` | `{mode, editable, reasonChip?}` | switches the mode of "Canvas modes" |
| `setDecorations` | `{issues[]?, filter?, find?, diff?, compare?, collapsed[]?, follow?, thumbnails?}` | validation issues, filters, find matches, proposal diff, comparison, collapse, Follow, thumbnail URLs |
| `externalDrag` | `{stage: "move" \| "drop" \| "cancel", entity, screenPoint}` | a palette entry or entity dragged over the scene |
| `setVisible`, `dispose` | `{visible}`; `{}` | pauses or resumes all work; tears the instance down |

| Event (canvas → app) | Payload | Meaning |
|---|---|---|
| `ready` | `{protocol: 1, forkVersion, upstreamCommit, capabilities: {png, svg, webm, html}, limits}` | the runtime can accept commands |
| `intent` | `{intentId, gesture, baseSeq, ops[], selectionAfter?}` | the user finished a gesture that changes the document |
| `selectionChanged` | `{ids[], source: "pointer" \| "keyboard" \| "host"}` | selection changed |
| `viewportChanged` | `{x, y, zoom, final}` | at most 10 per second during a gesture or camera move, and once with `final: true` at its end |
| `uiRequest` | `{kind: "contextMenu" \| "quickAdd" \| "portPicker" \| "replaceConnection" \| "details" \| "tooltip" \| "action", target, anchorRect, data}` | the app shows the named chrome at `anchorRect` (screen coordinates) or runs the named action |
| `announce`, `haptic` | `{text, politeness}`; `{kind}` | screen-reader announcement; haptic to play |
| `replayPosition` | `{time_ms, entryIndex, playing}` | at most 10 per second |
| `exportProgress`, `exportResult` | `{exportId, fraction}`; `{exportId, ok, mime, bytes or streamId, code?}` | export feedback |
| `resyncRequested` | `{haveSeq}` | the canvas received `applyOps` whose `seq` is not its `seq` + 1; the app answers with `loadDocument` |
| `error` | `{code, message, fatal}` | a `canvas/*` code of "Canvas error codes" |

`seq` is the app's local sequence number of its confirmed document, increasing by 1 per applied batch; it is not the host revision. A command round trip (`post` to `ack`) for a message of at most 16 KiB MUST complete within 8 ms at the 95th percentile on the reference phones. The React components of `bridge/web` and `bridge/native` are thin adapters over this protocol and expose the same props on every platform, so hosts never use the protocol directly. Where another requirement of this capability says that the canvas fetches, subscribes to or submits something, the app-side workflow store of this capability does so and feeds the canvas runtime through these commands. [NEW]

#### Scenario: Load then apply
- **WHEN** the app sends `loadDocument` with `seq` 7 and then `applyOps` with `seq` 8 carrying one `node.move`
- **THEN** both are acknowledged in order and the node is drawn at its new position

#### Scenario: Sequence gap
- **WHEN** the canvas at `seq` 8 receives `applyOps` with `seq` 10
- **THEN** it changes nothing, emits `resyncRequested {haveSeq: 8}` and redraws from the `loadDocument` that follows

#### Scenario: Malformed command
- **WHEN** the app sends `setViewport` with `zoom: "big"`
- **THEN** the acknowledgement is `{ok: false, code: "canvas/protocol-error"}` and the viewport is unchanged

#### Scenario: Canvas has no network of its own
- **WHEN** a run is displayed with the network panel recording on web
- **THEN** the canvas runtime issues no request other than the image requests for thumbnail URLs supplied through `setDecorations`

### Requirement: Intents and confirmed state
The canvas SHALL emit intents and render confirmed state. It holds two layers: the **confirmed state** (the document at the last `seq`, the run overlay and the decorations, changed only by `loadDocument`, `applyOps`, `setRunOverlay` and `setDecorations`) and **previews** of gestures. During a gesture the canvas draws a preview locally — dragged items follow the pointer, a connection preview follows the pointer, feedback comes from the bundled pure functions `validateConnection` and `canApply` of `packages/workflow` — and sends nothing but `viewportChanged` and `selectionChanged`. At the end of a gesture that changes the document it emits exactly one `intent` with a new `intentId`, its `baseSeq` and the ordered batch of `agent-workflows.Graph operations` the gesture means, keeps the preview displayed in its end state, and MUST NOT change its confirmed state itself. The **optimistic-preview rule**: the app checks the batch with `canApply` against its own document; when it accepts, it applies the batch to its document at once, sends `applyOps {origin: "local", intentId}` before the host has answered, and submits the batch with `jagentchill.workflow.apply`; on that `applyOps` the canvas replaces the preview with confirmed state with no visible jump (an item already at its confirmed position is not animated again). When the host then refuses the batch, the app sends `applyOps {origin: "revert"}` with the inverse batch (or `loadDocument` after a conflict) and the canvas shows the reverted state within 160 ms of receiving it. When the app does not accept, it sends `rejectIntent` and the canvas retracts the preview in 160 ms and shows the returned message next to the item. When neither `applyOps` nor `rejectIntent` for an `intentId` arrives within 2,000 ms, the canvas discards the preview, shows confirmed state and emits `error {code: "canvas/bridge-timeout"}`. Batches from other devices, from agents and from undo or redo arrive as `applyOps` with the matching `origin` and are rendered per "Persistence, multi-device editing and offline behaviour", "Agent build choreography" and "Undo and redo"; an item the user is dragging keeps following the pointer while such a batch is applied. Viewport, selection, collapse and other device-local view state are not intents: the canvas reports them with events and the app persists them. The canvas keeps no undo history and no persistent storage of its own. [NEW]

#### Scenario: Drag confirmed
- **WHEN** the user drops three dragged nodes and the app accepts the intent
- **THEN** one `intent` with three `node.move` operations is emitted, the app answers with `applyOps {origin: "local"}` carrying the same `intentId`, and the nodes stay where they were dropped without a second animation

#### Scenario: Host refuses after the optimistic apply
- **WHEN** the host refuses the submitted batch with `WORKFLOW_REVISION_CONFLICT`
- **THEN** the app sends the revert, the canvas shows the nodes at their previous positions within 160 ms, and the app shows the toast with the code and message

#### Scenario: App rejects the intent
- **WHEN** `canApply` refuses a rename because the name is empty
- **THEN** the app sends `rejectIntent`, no `applyOps` is sent, and the inline field stays open in its invalid state with the returned message

#### Scenario: No answer
- **WHEN** an intent receives neither `applyOps` nor `rejectIntent` within 2,000 ms
- **THEN** the preview is discarded, the confirmed state is drawn and `canvas/bridge-timeout` is reported

#### Scenario: Canvas never applies its own gesture
- **WHEN** the bridge is paused in a test build and the user drops a dragged node
- **THEN** `getScene()` reports the node's confirmed rectangle unchanged while its preview rectangle is at the drop position

### Requirement: Semantics boundary with agent-workflows
The canvas SHALL own rendering, interaction and animation only. The document model (`agent-workflows.Workflow document`), the stored geometry fields and their ranges (`agent-workflows.Canvas geometry stored in the document`), port declarations and type compatibility (`agent-workflows.Ports and data types`), edge kinds (`agent-workflows.Typed edges`), validation (`agent-workflows.Validation rules`), limits (`agent-workflows.Size limits`), revisions (`agent-workflows.Versioning`), the layout function (`agent-workflows.Deterministic auto-layout`), the run engine and the agent authoring tools are owned by `agent-workflows`. Every change the canvas causes to a document is an ordered batch of operations from the closed set of `agent-workflows.Graph operations`: the canvas emits the batch as an intent and the app submits it with `jagentchill.workflow.apply` ("Intents and confirmed state"); one user gesture is exactly one batch, hence one revision and one undo step, and is the same batch an agent tool would emit for the same change. For immediate feedback the pure rule functions exported by `packages/workflow` are evaluated on the device — referred to in this specification as `validateConnection(source, target)` (type, mode, duplicate, self-edge and cycle rules, returning `ok` or an error code such as `WORKFLOW_TYPE_MISMATCH` with its localised message), `canApply(ops)` (the structural checks the host performs on a batch) and `validate(document)` (the issue list of `agent-workflows.Validation rules`) — and an accepted batch is applied optimistically; the host's answer is authoritative: when `jagentchill.workflow.apply` refuses a batch, the canvas shows the reverted state within 160 ms and the returned error code and message appear in a toast — for `WORKFLOW_REVISION_CONFLICT` only the operations named in `details.conflicts[]` are reverted and the per-item notice of "Persistence, multi-device editing and offline behaviour" replaces the toast. The canvas MUST NOT implement any validity rule of its own. A node type that the document schema accepts but that this specification does not list is drawn with the `unknown` identity of "Node type visual identities" and remains fully operable. [NEW]

#### Scenario: Validity comes from the semantics layer
- **WHEN** the user drags a connection from a `MusicTrack` output onto a `CaptionSet` input and `validateConnection` returns `WORKFLOW_TYPE_MISMATCH`
- **THEN** the canvas shows the invalid-connection feedback with the returned message and creates no edge

#### Scenario: One gesture is one batch
- **WHEN** the user drags five selected nodes and releases
- **THEN** one `jagentchill.workflow.apply` call carrying five `node.move` operations is sent and the revision increases by 1

#### Scenario: Host refuses an optimistic change
- **WHEN** the device check accepts an added edge but the host refuses the batch with `WORKFLOW_EDGE_DUPLICATE`
- **THEN** the edge disappears within 160 ms, a toast shows the code and message, and no undo step remains for it

### Requirement: Canvas layout data
The canvas SHALL read and write exactly the presentation fields defined by `agent-workflows.Canvas geometry stored in the document`: per node `position {x, y}` (integers on the 20-unit grid, top-left corner) and `size {width, height}`; per edge `route {style, waypoints[], labelT}`; `groups[]` `{id, label, colorIndex, nodeIds[], frame, collapsed}`; `notes[]` `{id, text, x, y, width, height}`; and the document `viewport`. One canvas unit equals one device-independent pixel at 100 % zoom. A node's drawn height is always its content height per "Node anatomy"; the canvas writes `size.width` on a width resize together with `size.height` equal to the content height clamped to 64–320, and ignores a stored `height` when drawing. Nodes are stacked in document order, with selected and dragged nodes drawn on top while they are selected or dragged. The canvas renders documents up to the limits of `agent-workflows.Size limits` (200 nodes, 400 edges, 50 groups, 100 notes) and, when an addition is refused with `WORKFLOW_LIMIT_EXCEEDED`, shows the toast "This workflow has reached the limit of <max> <items>". Everything else is device-local view state that MUST NOT be written to the document or synchronised: the device viewport, selection, hover, node collapse, tool, grid style, guide settings, panel sizes, minimap visibility, Follow, filters, find queries and replay position; of these, node collapse, grid style, guide settings, panel sizes and minimap visibility persist per device, and node collapse is stored per workflow for the 200 most recently opened workflows. Run state is never written to the document. [NEW]

#### Scenario: Run does not change the document
- **WHEN** a run executes from start to success while the canvas is open
- **THEN** the document's `revision` and `graphHash` are unchanged

#### Scenario: Moving a node changes geometry only
- **WHEN** the user moves a node
- **THEN** one `node.move` operation is applied, `revision` increases by 1 and `graphHash` is unchanged

#### Scenario: Limit reached
- **WHEN** a workflow holds 200 nodes and the user drags another node from the palette
- **THEN** no node is added and the toast "This workflow has reached the limit of 200 nodes" is shown

#### Scenario: Collapse is device-local
- **WHEN** the user collapses a node on device A
- **THEN** no operation is sent, the node stays collapsed on device A after reopening the workflow, and it is expanded on device B

### Requirement: Canvas design tokens
The canvas SHALL take every colour, radius, elevation, type style and duration from tokens registered in `packages/ui` under `design-system.Token source and theming contract`, in the `light` and `dark` themes. The canvas-specific tokens and their values are registered only by `design-system.Workflow canvas tokens`; this capability defines no token value and uses exactly these names: `wf/canvas-bg`, `wf/grid-minor`, `wf/grid-major`, `wf/node-bg`, `wf/edge-idle`; the node-type accents `wf/type/agent`, `wf/type/generate`, `wf/type/script`, `wf/type/editor`, `wf/type/tool`, `wf/type/gate`, `wf/type/flow`, `wf/type/trigger`, `wf/type/output`, `wf/type/unknown`; the port families `wf/port/text`, `wf/port/json`, `wf/port/image`, `wf/port/video`, `wf/port/audio`, `wf/port/project`, `wf/port/file`, `wf/port/scalar`, `wf/port/control`, `wf/port/any`; the group colours `wf/group/1` … `wf/group/8`; the durations `wf/motion/layout` (320 ms), `wf/motion/camera` (400 ms), `wf/motion/pulse` (1,600 ms); and the easing `wf/ease/in-out`. All other values come from existing tokens: `accent`, `accent/subtle`, `success`, `success/text`, `success/subtle`, `warning`, `warning/text`, `warning/subtle`, `danger`, `danger/subtle`, `purple`, `purple/subtle`, `text/*`, `border/*`, `bg/*`, `preview/guide`, `timeline/range`, `radius/*`, `elevation/*`, `type/*`, `icon/*`, `motion/fast` (120 ms), `motion/base` (160 ms), `motion/slow` (240 ms), the enter easing `cubic-bezier(0.2, 0, 0, 1)` and the exit easing `cubic-bezier(0.4, 0, 1, 1)`. No literal colour, radius, elevation or duration appears in canvas code or in the fork's stylesheets outside the generated mapping of "Theme mapping and fonts". The canvas follows the app theme and shows the other theme's values within 200 ms of a theme change without losing viewport, selection or animation state. [NEW]

#### Scenario: Theme switch keeps state
- **WHEN** the theme changes from light to dark while three nodes are selected at 150 % zoom
- **THEN** the canvas shows the dark token values within 200 ms with the same three nodes selected at the same viewport

#### Scenario: Literal colour rejected
- **WHEN** canvas code contains the literal `#7C4DDB`
- **THEN** the lint gate of `design-system.Token source and theming contract` fails

#### Scenario: Unregistered token name
- **WHEN** canvas code refers to a token `wf/type/review` that `design-system.Workflow canvas tokens` does not register
- **THEN** the token lint fails and names the token

### Requirement: Theme mapping and fonts
The fork SHALL replace archify's own palette and typography with design-system tokens. Upstream switches themes with a `data-theme` attribute on the page root and defines its palette as CSS custom properties in `viewer/viewer.css`; the fork keeps the variable names (so reused upstream rules and fragments keep working), sets `data-theme` on the instance root instead of the page, and generates the variable values from the token registry into `src/theme/token-map.generated.css` at build time — the only file allowed to hold resolved values. Mapping:

| archify variable | Token |
|---|---|
| `--bg` | `wf/canvas-bg` |
| `--canvas-dot` | `wf/grid-minor` |
| `--grid` | `wf/grid-major` |
| `--mask`, `--panel` | `wf/node-bg` |
| `--panel-border`, `--lane-stroke` | `border/hairline` |
| `--text` | `text/primary` |
| `--text-muted` | `text/secondary` |
| `--text-dim` (text that carries information) | `text/secondary` |
| `--text-faint` (decorative marks only, never text a user must read) | `text/tertiary` |
| `--arrow` | `wf/edge-idle` |
| `--arrow-emphasis` | `accent` |
| `--frontend-stroke` | `wf/type/trigger` |
| `--backend-stroke` | `wf/type/agent` |
| `--database-stroke` | `wf/type/output` |
| `--cloud-stroke` | `wf/type/generate` |
| `--security-stroke` | `wf/type/gate` |
| `--messagebus-stroke` | `wf/type/flow` |
| `--external-stroke` | `wf/type/tool` |
| each `--<kind>-fill` | the matching stroke token at 14 % opacity |

Because several JAgentChill node types share one archify base type, the in-app canvas colours a node from its own type token (`wf/type/*` per "Node type visual identities") through a per-type class; the seven kind variables above colour what reused upstream code draws (the node outline tones and the legend of the interactive export). The upstream presets `signal-flow`, `blueprint` and `editorial` are not part of the fork: there are exactly two themes, `light` and `dark`. Token values reach the runtime with `setTheme`, which sets the custom properties on the instance root; a theme change therefore rebuilds no element. **Fonts:** upstream embeds six JetBrains Mono variable WOFF2 subsets as data URIs in the style block `#archify-fonts` of its template and uses that family for all diagram text. In the app the canvas instead uses the faces of `design-system.Typography tokens` loaded from the app bundle — Inter for every text style, JetBrains Mono only for `type/mono`, Noto Sans JP for Japanese — and does not load the embedded subsets. Files that must be self-contained (the interactive HTML export and the SVG export) embed fonts as data URIs: upstream's JetBrains Mono subsets, kept as they are, plus an Inter variable subset (Latin, Latin Extended and Vietnamese, weights 400–600) of at most 400 KiB; Japanese is not embedded and uses the fallback stack of `design-system.Typography tokens`, as upstream does for code points outside its subsets. Each embedded font carries its SIL OFL notice in the font CSS, as upstream's template does. [NEW]

#### Scenario: Variables come from tokens
- **WHEN** the dark theme is applied
- **THEN** the computed value of `--bg` on the instance root equals the dark value of `wf/canvas-bg` and `--security-stroke` equals the dark value of `wf/type/gate`

#### Scenario: No preset
- **WHEN** a document imported from archify declares `meta.visual_preset: "editorial"`
- **THEN** the canvas draws it with the app's current theme and no preset styling

#### Scenario: App fonts in the app, embedded fonts in files
- **WHEN** a canvas is shown in the app and the same workflow is exported as interactive HTML
- **THEN** the app requests Inter from its own bundle and loads no data-URI font, and the exported file contains the Inter and JetBrains Mono subsets as data URIs and requests nothing when opened

### Requirement: Incremental rendering pipeline
Editing MUST NOT recompile or re-emit the whole document. Upstream's only entry, `compileWorkflow`, returns one SVG string for the whole document and takes about 600 ms for a 204-node, 368-edge document on a desktop-class machine (measured in Node on the pinned commit), so it and the static SVG emitter are never called on the editing path. The scene SHALL be retained: one scene record per node, port, edge, edge label, group and note, keyed by id, each owning one SVG group element that is created once and reused for the item's whole life; a full build happens only on `loadDocument`, and the scene root is never replaced afterwards. What each change recomputes:

| Change | Every animation frame during the gesture | Once at the end |
|---|---|---|
| Node or selection drag | the `transform` of the dragged groups; the path data of edges incident to a dragged node, as direct paths; the guide overlay | routes of computed edges whose bounding box intersects the old or new bounds of a moved node (spatial-index query), their label positions, and the moved items' index entries, within 50 ms |
| Connect or reconnect drag | the preview path; the snap-target class | on confirmation, one edge record and its route |
| Node resize | that node's width attributes and port positions; its incident edges as direct paths | as for a drag |
| Node added | — | that node's subtree; routes of computed edges whose bounding box intersects its rectangle inflated by 10 units |
| Node removed | — | its subtree and incident edges are removed after the exit animation; edges that had been routed around it are re-routed (each computed route records the ids of the obstacles it avoided) |
| Node content changed (`node.update`) | — | that node's text measurement and subtree; when its height changed, its incident edges and the routes intersecting its old or new rectangle |
| Edge route or label changed | the dragged handle or label | that edge only |
| Group or note changed | that element | nothing else (neither is an obstacle) |
| Pan or zoom | one `transform` on the scene root | the culled set, the level-of-detail attribute when a boundary was crossed, and text re-rasterisation |
| Run overlay change | — | attributes and classes of the affected node or edge only |
| `layout.apply` | interpolated transforms | all computed routes, in slices of at most 4 ms per frame, complete within 300 ms on the reference desktop and 600 ms on the reference phones |

Batching: pointer events are coalesced to the latest position per frame, and all element writes of a frame are issued in a single animation-frame callback. Geometry is always read from the scene model: between the start and the end of a gesture the runtime MUST NOT call `getBBox`, `getBoundingClientRect`, `getComputedTextLength` or `getComputedStyle`. Dirty tracking is a set of item ids per aspect (`geometry`, `content`, `route`, `state`); only dirty records touch their elements, and an element whose computed attributes are unchanged is not written. Text content is updated in place when the structure is unchanged; the subtree of a level-of-detail tier is built the first time that tier is displayed for that node; culled items keep their records and elements. Remote and agent batches are coalesced per frame, and a 200-operation batch is applied and painted within 100 ms on the reference desktop and 200 ms on the reference phones. Budgets on the `wf-200` fixture: script time per frame during a drag at the 95th percentile at most 6 ms on the reference desktop and 9 ms on the reference phones; element attribute writes per frame while one node is dragged at most 2 plus 2 per incident edge; no route search during a drag; and at most 8,000 displayed SVG elements at any zoom. These numbers are reported by `getFrameStats()` of "Test hooks and deterministic rendering" and are part of the benchmark suite of "Performance budgets and load shedding". [NEW]

#### Scenario: Drag touches only what moves
- **WHEN** a node with 6 incident edges is dragged for 2 s on `wf-200`
- **THEN** the frame statistics report at most 14 attribute writes per frame, zero route searches and zero layout reads during the drag

#### Scenario: Re-route after the drop is local
- **WHEN** that node is dropped
- **THEN** only computed edges whose bounding box intersects the node's old or new bounds are re-routed, within 50 ms, and every other edge element is untouched

#### Scenario: Elements are reused
- **WHEN** `applyOps` renames one node of `wf-200`
- **THEN** the scene root and the group elements of the other 199 nodes are the same element objects as before, and only the renamed node's text was written

#### Scenario: Adding a node builds one subtree
- **WHEN** a node is added to `wf-200`
- **THEN** exactly one node subtree is created and no existing node subtree is rebuilt

#### Scenario: No full compile while editing
- **WHEN** an editing session of 100 gestures runs in a test build
- **THEN** the test bridge reports zero calls of `compileWorkflow` and zero calls of the static SVG emitter

### Requirement: Scene layers, culling and virtualisation
The scene SHALL be drawn in this fixed order, bottom to top, as sibling layer groups of the scene root in document order: (1) background and grid, (2) groups, (3) sticky notes, (4) edges, (5) edge labels, (6) nodes in document order, with selected and dragged nodes last, (7) ports, (8) selection (selection rings, marquee, alignment guides, spacing hints, resize handles), (9) overlays (drag ghosts, connection preview, flow and trace clones, diff badges, pause-before markers, drop targets); (10) the minimap is a separate element in screen space. Layers 1–9 share the camera transform. The background grid is one tiled pattern element, not one element per mark. The canvas MUST maintain a spatial index of nodes, groups, notes and edge bounding boxes (archify's `createSpatialGrid` with 512-unit cells) and, at most once per frame when the viewport changes, hide every item whose bounds do not intersect the viewport inflated by 200 screen px on every side (`display: none` on its group, changed only for items that cross the boundary); hidden items are neither painted nor measured. The subtree of a node that has never been inside the inflated viewport is not built until it first is. Each node's content is built once and rebuilt only when the node's content, size, state or level-of-detail tier changes; pan and zoom change only the root transform. During a continuous zoom gesture the scene root is scaled as one composited layer and MUST be re-rasterised at the final zoom within 100 ms of the gesture ending. No React component is mounted per node or per edge: React (on web and desktop) owns only the container, and the scene's elements are managed by the fork's scene module. [NEW]

#### Scenario: Off-screen items are not drawn
- **WHEN** a 200-node workflow is viewed at 100 % in a 1,280 × 800 viewport showing 14 nodes
- **THEN** the test bridge reports as displayed at most the nodes and edges intersecting the viewport inflated by 200 px

#### Scenario: Selection draws above nodes
- **WHEN** a selected node overlaps an unselected node that comes after it in document order
- **THEN** the selected node and its selection ring are drawn above the other node

#### Scenario: Text sharpens after zooming
- **WHEN** the user pinches from 100 % to 250 % and lifts the fingers
- **THEN** node text is rendered at 250 % resolution within 100 ms

#### Scenario: Unseen nodes are not built
- **WHEN** `wf-200` is opened at 100 % with 14 nodes in view and the camera has not moved
- **THEN** the test bridge reports node subtrees only for nodes that intersect the inflated viewport

### Requirement: Level of detail by zoom
The canvas SHALL reduce detail as zoom decreases, in four levels with a hysteresis of 2 percentage points at each boundary and a 120 ms cross-fade between levels:

| Level | Zoom | Nodes | Ports | Edges |
|---|---|---|---|---|
| `full` | ≥ 60 % | all parts of "Node anatomy" | dots and labels | full stroke, arrowheads, labels |
| `compact` | 35 % – < 60 % | header (icon tile, title, status glyph) and footer status text only; body, chips, thumbnails hidden | dots only | stroke and arrowheads; labels hidden below 50 % |
| `block` | 15 % – < 35 % | rounded rectangle with type-colour icon tile and status glyph at a constant 16 screen px; title shown only when the node is at least 96 screen px wide | hidden | 1 screen px stroke, arrowheads hidden below 20 % |
| `dot` | < 15 % | solid rounded rectangle filled with the run-status colour, or the type colour when no run is loaded | hidden | 1 screen px polyline of 8 segments, 60 % opacity |

The levels are implemented with archify's reading-depth mechanism, extended from its three levels (`map`, `read`, `full`) to these four: one `data-detail-level` attribute on the instance container, `data-detail` tier attributes on the elements of each node, port and edge, and stylesheet rules that hide the tiers a level omits — so a level change is one attribute write, not a write per node. Constant screen-size parts (the 16 px glyph, 1 px strokes, minimum label sizes, selection and focus rings) use non-scaling strokes and an inverse-zoom custom property set once per zoom change. Status is still conveyed without colour at `block` level through the status glyph; at `dot` level the status filter and the outline view are the non-colour alternatives. Group labels are drawn at a constant minimum of 11 screen px at every level. Selection rings, the marquee and focus rings are drawn at every level with a constant 2 screen px stroke. [NEW]

#### Scenario: Compact level
- **WHEN** zoom is 50 %
- **THEN** thumbnails, body text and footer chips are hidden and each node shows its icon tile, title and status glyph

#### Scenario: Hysteresis
- **WHEN** zoom moves from 61 % to 59 % and back to 60 %
- **THEN** the level changes to `compact` only at 58 % or below and returns to `full` only at 62 % or above, so no change occurs in this sequence

#### Scenario: Dot level keeps selection visible
- **WHEN** zoom is 10 % and one node is selected
- **THEN** the node is a solid rectangle with a 2 screen px `accent` ring

#### Scenario: One write per level change
- **WHEN** zoom crosses from `full` to `compact` on `wf-200`
- **THEN** the frame statistics report one attribute write for the level change and no per-node write

### Requirement: Text rendering
All text in the scene SHALL be SVG text set in the bundled faces named by `design-system.Typography tokens` (Inter, JetBrains Mono, Noto Sans JP), with widths and line breaks computed by the fork and not by the browser, so that they are the same on every platform. Upstream measures text without a layout engine — `textUnits` counts one unit per character and two per full-width character, and `text-fit.mjs` multiplies by 0.6 of the font size, which is exact for JetBrains Mono — and never wraps; the fork keeps that rule for `type/mono` text and adds `core/text-measure`: advance-width tables for Inter (weights 400, 500, 600) generated at build time from the bundled font files, one em per East Asian wide character, and 0.6 em for any code point the tables do not cover. Line breaks are chosen by the fork (at spaces, after hyphens and between East Asian wide characters) and each line is emitted as its own text element, so the browser never re-breaks a line. Text that contains right-to-left characters is measured once per string with an off-screen 2D text measurement and cached; its widths are exempt from the cross-platform equality rule. Styles: node title `type/body-medium`; type caption, chips, edge labels and badges `type/caption`; body summary and port labels `type/meta`; ids, model names and costs `type/mono`; group label `type/body-medium`; note text `type/body`. Text is measured in canvas units at 100 % and scaled with the camera transform; it is never drawn below 6 screen px (it is hidden instead, per "Level of detail by zoom"). Overflow is truncated with an ellipsis: titles to 1 line, body summary to 3 lines, chips to 16 characters, edge labels to 24 characters; the full text is available in the tooltip, the outline view and the detail panel. Bidirectional and CJK text are shaped by the platform's text engine per line. The first paint of a scene waits for Inter and JetBrains Mono to be loaded; the Japanese face is loaded from the app bundle when the first CJK character is drawn, and because CJK advances are fixed, node geometry does not change when it arrives (glyphs appear within 500 ms on the reference desktop); a code point with no glyph in any bundled face is drawn with the platform fallback font. Measurements are cached (2,000 strings, least recently used evicted). [NEW]

#### Scenario: Identical line breaks
- **WHEN** a node whose body summary is the 180-character fixture string is rendered on web, on desktop, on iOS and on Android at 100 %
- **THEN** all four platforms break the text at the same characters and truncate at the same character on line 3

#### Scenario: Japanese title
- **WHEN** a node titled "絵コンテを作成する" is rendered on web for the first time in a session
- **THEN** the title shows Japanese glyphs within 500 ms and the node's rectangle is the same before and after the face loads

#### Scenario: Truncated title
- **WHEN** a title is wider than the header's text area
- **THEN** it ends with an ellipsis on one line and hovering the node for 500 ms shows the full title in a tooltip

### Requirement: Hit-testing
Pointer and touch positions SHALL be resolved against the spatial index in canvas space — not by the element the browser reports under the pointer and not by pixel read-back — so that hit areas are independent of zoom, of stroke width and of culling; pointer events are captured by one listener set on the scene root, never per node. Priority order: ports, resize handles, node header controls (collapse chevron, overflow button, badges), nodes (highest `z` first), edge endpoint handles of a selected edge, edge labels, edges, sticky notes, group title bar and group border, then the empty canvas. The interior of a group's frame counts as empty canvas unless the group is selected. Hit areas in screen px, independent of zoom:

| Target | Fine pointer | Touch |
|---|---|---|
| Port | circle of radius 12 | 44 × 44 |
| Resize handle | 8 × 8 around the edge or corner | 44 × 44 |
| Edge | within 6 of the path | within 16 of the path |
| Edge endpoint handle | radius 10 | 44 × 44 |
| Header control | 24 × 24 | 44 × 44 |
| Group border | within 6 | within 16 |

Where two ports' hit areas overlap, the port nearest the pointer wins. Distance to an edge is computed against the flattened route points held in the scene model. A hit test MUST complete within 0.5 ms at the 95th percentile on a 200-node, 400-edge workflow on the desktop reference device and within 1.5 ms on the mobile reference devices. [NEW]

#### Scenario: Port beats node
- **WHEN** the pointer is 10 screen px from a port's centre, over the node body
- **THEN** the port is the hit target and a drag starts a connection, not a node move

#### Scenario: Edge tolerance on touch
- **WHEN** a finger taps 14 screen px from an edge path with no node under it
- **THEN** the edge is selected

#### Scenario: Group interior is canvas
- **WHEN** the user drags from the interior of an unselected group on desktop
- **THEN** a marquee starts and the group does not move

### Requirement: Performance budgets and load shedding
On the reference devices that `diagnostics-quality.Reference devices` defines (this capability names no device of its own), with a workflow at the limits of `agent-workflows.Size limits` (200 nodes and 400 edges), the canvas SHALL meet the following as **targets that spike S19 confirms per target runtime** — they are acceptance numbers for the benchmark gate, not an unconditional promise for every device, and on a target for which the owner adopted a lower supported document size they apply at that size: 60 frames per second during pan, zoom, node drag, marquee and run animation, with frame time (the interval between presented animation frames) at the 95th percentile ≤ 16.7 ms and at the 99th percentile ≤ 33.3 ms, and dropped frames within the product budget of `diagnostics-quality.Performance budgets` (≤ 2 % on desktop, ≤ 5 % on mobile); pointer-to-pixel latency of a node drag at the 95th percentile ≤ 32 ms on desktop and ≤ 50 ms on mobile; time to first complete render after `loadDocument` ≤ 150 ms for 20 nodes and ≤ 400 ms (desktop) or ≤ 800 ms (mobile) for 200 nodes; auto-layout of the whole graph ≤ 150 ms (desktop) or ≤ 400 ms (mobile) without blocking a frame for more than 16.7 ms; edge re-routing after a drop ≤ 50 ms; memory attributable to one canvas instance with `wf-200` loaded ≤ 192 MiB on desktop and web (script heap and elements) and ≤ 200 MiB resident for the canvas WebView content process on mobile, with decoded output thumbnails limited to displayed nodes and to at most 48 MiB (desktop, web) or 24 MiB (mobile); and a canvas bundle (script and stylesheet, without fonts) of at most 450 KiB compressed. The drag-time script, write and element budgets are those of "Incremental rendering pipeline". On displays faster than 60 Hz the canvas follows the display rate up to 120 Hz and all animation is time-based. When the 95th-percentile frame time over a sliding 1 s window exceeds 20 ms, the canvas MUST shed load one step at a time, in this order, waiting 1 s between steps: (1) node shadows except on dragged nodes, and running-node glow, are turned off; (2) edge flow animation becomes a static stroke and particles are not drawn; (3) while a drag is active, edges incident to dragged nodes are drawn as straight port-to-port segments instead of curves and their labels are hidden until the drop; (4) output thumbnails are replaced by type icons; (5) each level-of-detail boundary is raised by one level (`compact` below 80 %, `block` below 60 %, `dot` below 35 %); (6) the culling margin is reduced from 200 screen px to 0 and the subtrees of culled items are detached from the document until they return; (7) the minimap refreshes at 2 Hz. Steps are restored in reverse order, one per 3 s, while the 95th-percentile frame time stays below 12 ms. Status glyphs, status text, selection, focus rings and hit-testing are never shed. While any step is active the toolbar shows a "Reduced detail" chip whose tooltip names the active steps. These measurements are part of the benchmark suite of `diagnostics-quality.Performance budgets` and a result more than 10 % worse than baseline fails that gate; the budgets are first confirmed by "Renderer spike S19 and fallback renderer". [NEW]

#### Scenario: Budget met at 200 nodes
- **WHEN** the benchmark pans and zooms the `wf-200` fixture for 10 s on the desktop reference device
- **THEN** the 95th-percentile frame time is at most 16.7 ms and dropped frames are at most 2 %

#### Scenario: First shedding step
- **WHEN** the 95th-percentile frame time stays above 20 ms for 1 s during a run animation
- **THEN** node shadows and running-node glow are turned off, edge flow animation continues, and the "Reduced detail" chip appears

#### Scenario: Straight previews while dragging
- **WHEN** shedding step 3 is active and the user drags a node with four edges
- **THEN** the four edges are straight segments without labels during the drag and return to their routed curves and labels within 50 ms of the drop

#### Scenario: Recovery
- **WHEN** two shedding steps are active and the 95th-percentile frame time stays below 12 ms for 6 s
- **THEN** both steps are restored in reverse order and the chip disappears

### Requirement: Animation implementation in the renderer
Every animation of this specification SHALL be implemented as a Web Animations API animation or a CSS keyframe animation created through the fork's motion governor (derived from archify's `viewer/motion-governor.js`), which keeps a registry of all running animations of its instance so that it can pause, seek and cancel them together; durations and easings are exactly those of "Editing animations", "Run-state animations", "Edge flow animation", "Camera follow" and "Agent build choreography", read from the token custom properties. Mapping:
- **Camera** (pan, zoom, viewport commands, Follow): one CSS `transform: translate(…) scale(…)` on the scene root, as upstream's camera applies, animated for commands and Follow and written directly for gestures.
- **Node enter, exit, lift, settle, inertia, layout moves, selection ring**: `transform` and `opacity` of the item's group. The resting `elevation/1` is a pre-drawn offset rectangle with no filter, so 200 nodes carry no filter; `elevation/3` is a `drop-shadow` filter applied only to lifted and dragged nodes.
- **Edge draw-on and retract**: the path gets `pathLength="1"` and its dash offset animates between 1 and 0 — the technique of archify's Intent Trace (`traceGeometry`).
- **Edge flow**: a clone of the edge path in the overlay layer, stripped of ids, markers and hit attributes as Intent Trace does, with an 8/8 dash pattern whose offset animates linearly; a change of speed changes the animation's playback rate without restarting it. **Particles** are positioned each frame from 32 pre-computed samples of the route held in the scene model, so no path-length query runs per frame.
- **Running pulse, approval pulse, progress ring and bar, success and failure feedback**: opacity, stroke-width and dash-offset animations of dedicated stroked elements; glows are stroked rectangles with animated opacity and width, never blur filters.
- **Level-of-detail change, hover, state change, counters, thumbnails**: opacity transitions on the `data-detail` tiers and on paired old and new elements.
- **Hover focus of "Dense graph legibility"**: archify's Intent Trace attributes (`data-intent-trace-match` on the related nodes and edges) drive the dimming rules.
**Ownership and caps:** the governor's `claim` and `release` arbitration is reused with the priority `drag` > `replay` > `build` > `run` > hover trace; a higher owner pauses the continuous animations of lower ones, and the caps of 40 edges and 24 nodes of "Animation clock and motion rules" are enforced there. **Visibility:** the governor suspends everything on `visibilitychange` (as upstream does) and on `setVisible {visible: false}`. **Reduced motion:** archify already has a mechanism — the governor treats motion as `still` when the reader paused it, when `prefers-reduced-motion: reduce` matches or when it is suspended, sets `data-motion="still"`, and stylesheet rules under that attribute remove animations and show completed static strokes; the fork keeps it, sets the attribute on the instance root, makes it `still` when the OS media query matches or when `setPreferences {reducedMotion: true}` was received, and implements each row of "Reduced-motion equivalents" as rules under `data-motion="still"` plus animations created with opacity only and at most 120 ms. **Clock:** animations run on the document timeline and are time-based; in test builds `freezeClock()` pauses every registered animation and `setClock(ms)` sets each one's current time. On iOS and Android the canvas runs in its own WebView process, so a busy application script thread does not delay it; on web and desktop the camera transform is composited independently of script, and scene animations show the time-correct state on the first frame after a stall with no catch-up playback. [NEW]

#### Scenario: Camera is one transform
- **WHEN** the user pans `wf-200` for 2 s
- **THEN** the frame statistics report one transform write on the scene root per frame and no write to any node or edge

#### Scenario: Flow speed changes without a restart
- **WHEN** a flowing edge's throughput changes from 0 to 2 items per second
- **THEN** its dashes speed up from 48 to 96 units per second without jumping back to their start position

#### Scenario: Reduced motion through the governor
- **WHEN** the app sends `setPreferences {reducedMotion: true}` while three edges are flowing
- **THEN** the instance root carries `data-motion="still"` on the next frame and the three edges are static 2-unit `accent` strokes

#### Scenario: Higher owner pauses lower ones
- **WHEN** the user starts dragging a node while a run animates 10 flowing edges
- **THEN** the drag follows the pointer every frame and the governor reports `drag` as the motion owner until the drop

#### Scenario: Seekable in tests
- **WHEN** a test freezes the clock and sets it to 120 ms during an edge draw-on
- **THEN** the edge is revealed to the position defined for 120 ms and two consecutive screenshots are identical

### Requirement: Renderer load failure and process loss
The canvas SHALL handle a renderer that cannot start or that stops. When the canvas runtime has not emitted `ready` within 10 s of mounting — because the bundle or page failed to load, a script error occurred during start-up, creating the WebView failed, or `ready` reported a `protocol` version the app does not support — the app MUST show the outline view of "Outline view and screen-reader support" in its place with a `warning` banner "The graphical canvas is unavailable on this device — showing the outline" and the actions "Retry" and "Copy details" (error code `canvas/init-failed`, with the failing step `load`, `script`, `view` or `protocol` and the user agent, no document content). Every edit, inspection and run action remains available through the outline view, which is built from `design-system` components outside the canvas runtime. When a running canvas stops — the operating system terminates the WebView content process (`onProcessGone`), a command is not acknowledged within 5 s, or an uncaught error escapes the canvas runtime on web or desktop — the app disposes the instance, creates a new one and resends `loadDocument`, the selection, the viewport, the run overlay and the decorations, so that the scene is back within 2,000 ms on the reference phones and 1,000 ms on the reference desktop with the same viewport, selection and undo history, all of which the app holds; a gesture in flight is discarded without an intent, and a toast "Canvas restarted" is shown. After 3 automatic restarts within 60 s the app stops restarting and falls back to the outline view with `canvas/process-gone`. On a low-memory signal the canvas releases decoded thumbnails and detached subtrees. No document data is lost in any of these cases. [NEW]

#### Scenario: Bundle fails to load
- **WHEN** the canvas bundle fails to load on web
- **THEN** the outline view is shown with the banner and "Retry", and adding, connecting and deleting nodes work from the outline

#### Scenario: Process terminated and restored
- **WHEN** the operating system terminates the canvas WebView process on a phone while 3 nodes are selected
- **THEN** within 2,000 ms the canvas is drawn again with the same 3 nodes selected at the same viewport and the undo history intact, and the toast "Canvas restarted" is shown

#### Scenario: Repeated failure
- **WHEN** the canvas process is lost three times within 60 s
- **THEN** no fourth restart is attempted and the outline view is shown with `canvas/process-gone` and "Retry"

#### Scenario: Retry succeeds
- **WHEN** the user activates "Retry" and the renderer emits `ready`
- **THEN** the graphical canvas replaces the outline view and the banner is removed

### Requirement: Oversized documents and upstream schema mismatch
The canvas SHALL stay usable when a document is larger than it is built for or when the upstream archify schema and the product disagree. **Size:** the canvas edits documents up to `agent-workflows.Size limits` (200 nodes, 400 edges, 50 groups, 100 notes) and reports these in `ready.limits` (lower node and edge numbers on a target runtime for which the owner adopted a smaller supported size, "Renderer spike S19 and fallback renderer"). A document that exceeds a limit (for example a run snapshot produced by a newer host) and has at most 1,000 nodes and 2,000 edges is drawn not editable, at no more than the `block` level of detail, without flow animation or thumbnails, with the chip "Large workflow — reduced detail, view only". A larger document, or one whose `loadDocument` message would exceed the protocol's 1 MiB limit, is not drawn: the app shows the outline view with the `warning` banner "This workflow is too large for the graphical canvas — showing the outline" (`canvas/document-too-large`); the outline is a virtualised list and has no such limit. **Upstream schema:** `canvas/upstream-schema-mismatch` is raised when (a) a part returned by `agent-workflows.Archify projection` fails the pinned upstream `workflow.schema.json` (checked on the device with upstream's generated validator), (b) the `VERSION` of the archify CLI packaged with the server differs from the `upstreamCommit` the canvas reports in `ready`, or (c) a file chosen for "Archify import" declares a `schema_version` outside the pinned schema's enumeration (1 and 2 at the initial pin). In cases (a) and (b) the entries of "Export for upstream archify" are disabled with the tooltip "Upstream archify export is unavailable in this build" and the mismatch is recorded as a product defect in `diagnostics-quality.Structured logging`; in case (c) the import is refused with "This file uses archify schema version <n>, which this app does not support". Editing, the interactive HTML export, PNG, SVG and the outline are unaffected by a schema mismatch. [NEW]

#### Scenario: Run snapshot above the editing limit
- **WHEN** a run snapshot with 260 nodes is opened
- **THEN** it is drawn not editable at the `block` level at most, with the chip "Large workflow — reduced detail, view only"

#### Scenario: Far too large
- **WHEN** a document with 1,500 nodes is opened
- **THEN** the outline view is shown with the banner and `canvas/document-too-large`, and every node is listed

#### Scenario: Projection fails the pinned schema
- **WHEN** the projected document carries a property the pinned `workflow.schema.json` does not allow
- **THEN** the upstream export fails with `canvas/upstream-schema-mismatch` naming the property path, no file is produced, and the interactive HTML export still works

#### Scenario: Newer upstream file
- **WHEN** the user imports an archify file with `schema_version: 3`
- **THEN** nothing is created and the message names version 3

### Requirement: Renderer spike S19 and fallback renderer
Spike S19 SHALL gate every task of the rendering architecture group, be executed before them, and be recorded as a decision record in `docs/decisions/` in the form required by `diagnostics-quality.Gating spikes`. It builds the smallest slice of the fork that can load the `wf-200` fixture (200 nodes, 400 edges, free positions), drag nodes and report frame statistics, and runs it in every **target runtime** — no platform is measured by proxy: (T1) the Chromium of the pinned Electron version on the reference desktops for macOS, Windows and Linux; (T2) `WKWebView` inside `JagentchillCanvasView` on the reference iPhone; (T3) Android System WebView inside `JagentchillCanvasView` on the reference Android phone; and, for the web build, (T4) the current stable Safari on the reference macOS desktop, (T5) the current stable Firefox on the reference desktop and (T6) the current stable Chrome on the reference desktop (`diagnostics-quality.Reference devices`; the browsers the web build supports are those of `updates-distribution`, and every engine on that list is a target). Criterion 6 applies to T2 and T3 only; every other criterion applies to all targets, with the desktop numbers for T1 and T4–T6 and the phone numbers for T2 and T3. Pass criteria — all must hold:

| # | Criterion | Pass when |
|---|---|---|
| 1 | Compiler and router portability | the `core` entry loads in every target runtime with no Node built-in; `compileWorkflow` returns receipts equal to Node's for every upstream workflow example; `shortestOrthogonalGridRoute` returns equal points for the 50 fixture edge pairs |
| 2 | Drag redraw | dragging one node with 6 incident edges, and dragging a 20-node selection, each for 10 s on `wf-200`: frame time ≤ 16.7 ms at the 95th percentile and ≤ 33.3 ms at the 99th, dropped frames ≤ 2 % (desktop) and ≤ 5 % (phones), with no shedding step active on desktop and at most steps 1 and 2 on phones |
| 3 | Pan and zoom | the same frame budget while panning and zooming `wf-200` for 10 s at 100 % and at 25 % |
| 4 | Start-up and first render | `ready` within 1,500 ms (desktop) and 2,500 ms cold (phones); first complete render of `wf-200` within 400 ms (desktop) and 800 ms (phones) |
| 5 | Memory | within the limits of "Performance budgets and load shedding" with `wf-200` loaded and a run animating |
| 6 | Touch gestures | on both phones, 20 scripted trials each of one-finger pan, pinch zoom (the point under the midpoint stays within 4 screen px), long-press drag of a node, tap-to-connect and an edge tap 14 px from the path: at least 19 of 20 succeed for every gesture; no page zoom, text-selection callout or overscroll bounce occurs; touch-to-pixel latency of a drag ≤ 50 ms at the 95th percentile |
| 7 | Text determinism | the 180-character fixture string breaks at the same characters in every target runtime |
| 8 | Image export | PNG at 2× and SVG export of `wf-200` complete in every target runtime within the limits of "Image export, copy and print" |

The spike also records, without affecting the result, whether each runtime can record WebM (this decides the route of "Motion export to WebM") and the measured bridge round-trip time. **When a criterion fails (decision A5): nothing is replaced automatically.** The record states `result: fail` with the target, the criterion and the measured numbers, and additionally reports two re-measurements on the failing target, both of which stay inside the fork: (m1) the same criteria with the shedding steps of "Performance budgets and load shedding" that the criterion permits made the default profile of that target; (m2) the largest document size, in steps of 50 nodes downward from 200 and never below 100 nodes (edges at twice the node count), at which all criteria pass on that target. The **owner** then decides, in a decision record under `docs/decisions/` with status `owner-approved`, between: (a) fixing the fork — which includes adopting m1 as that target's default profile or m2 as that target's supported document size, in which case the canvas on that target reports the lower numbers in `ready.limits`, a larger document is drawn by the oversized-document rule of "Oversized documents and upstream schema mismatch", and `agent-workflows.Size limits` is unchanged on the host; (b) a product renderer for the failing platform class only; (c) a product renderer on every platform. Until that record exists the job `jagentchill-policy` blocks every task of the rendering architecture group for the failing target, and no requirement of this capability is rewritten. A renderer under (b) or (c) is adopted only after its own gating record **S19b**: its slice passes criteria 2–8 in the same targets, and its record restates for that renderer the start-up, memory and bundle limits it will meet and lists every statement outside the rendering architecture group that changes (test ids, export paths, accessibility hooks); it sits behind the same `WorkflowCanvas` props, "Host message protocol" and intent model, the fork keeps producing "Interactive HTML export from the fork" and "Archify HTML export on the host", and the interaction and animation requirements of this capability stay as written. **Unsupported browsers:** a web browser engine that fails S19 (T4–T6) and for which the owner has not approved a remedy is listed as unsupported for canvas editing in `updates-distribution`: in it the Workflows routes show the read-only outline view of "Outline view and screen-reader support" with the banner "The graphical canvas is not supported in this browser — showing the outline" (`canvas/unsupported-runtime`), run control, approvals and every non-canvas screen keep working, and the desktop and mobile apps are offered. The job `jagentchill-policy` fails a pull request that completes a task of the group while the S19 record is absent. [NEW]

#### Scenario: Spike passes
- **WHEN** all criteria hold in every target runtime
- **THEN** the decision record states `result: pass` with the measured numbers per target and the tasks of the rendering architecture group are unblocked

#### Scenario: Drag budget missed on a phone
- **WHEN** the drag criterion measures 24 ms at the 95th percentile on the reference Android phone
- **THEN** the record states `result: fail` naming target T3 and criterion 2 together with the m1 and m2 re-measurements, no renderer is replaced, and the group stays blocked for that target until an `owner-approved` decision record chooses (a), (b) or (c)

#### Scenario: Firefox fails the pan criterion
- **WHEN** target T5 misses criterion 3 and the owner has not yet approved a remedy
- **THEN** Firefox is listed as unsupported for canvas editing, a workflow opened in it shows the read-only outline with the banner, and Safari, Chrome, the desktop apps and the mobile apps are unaffected

#### Scenario: Group work before the record
- **WHEN** a pull request completes a task of the rendering architecture group and no S19 record exists
- **THEN** `jagentchill-policy` fails

#### Scenario: Product renderer needs its own record
- **WHEN** the owner chooses (b) for phones and the product renderer's slice has no passing S19b record
- **THEN** `jagentchill-policy` fails a pull request that ships that renderer, and the fork renderer stays in use on every other platform

### Requirement: Infinite free-form canvas and background grid
The canvas SHALL be free-form and unbounded within the coordinate range of `agent-workflows.Canvas geometry stored in the document` (−1,000,000 to 1,000,000 on each axis): nodes, groups and notes are placed at any grid position, with no lanes, columns or cells, and items are allowed to overlap. The background is `wf/canvas-bg` with a grid in one of three styles chosen per device (default `dots`): `dots` (round dots of 1 screen px radius), `lines` (1 screen px lines) or `none`. The base grid step is the 20-unit placement grid of `agent-workflows.Canvas geometry stored in the document`, with a major mark every 5 steps (100 units) drawn in `wf/grid-major` and minor marks in `wf/grid-minor`. Density depends on zoom: whenever the on-screen distance between minor marks falls below 12 px the drawn step doubles (20, 40, 80, … units) and whenever it exceeds 48 px it halves, never below 20 units; the grid is not drawn below 20 % zoom. Grid marks are aligned to device pixels. The grid style only changes what is drawn: positions written by the canvas always lie on the 20-unit grid. When no node, group or note intersects the viewport and the document is not empty, a "Back to workflow" chip is shown at the bottom centre that runs zoom-to-fit. The canvas has no rulers and no persistent ruler guides; alignment is provided by "Drag and drop with snapping and alignment guides". [NEW]

#### Scenario: Grid density at low zoom
- **WHEN** zoom is 50 %
- **THEN** minor dots are drawn every 40 canvas units (20 screen px apart) and major dots every 200 units

#### Scenario: Free placement on the grid
- **WHEN** the user drops a node with its top-left corner at (−4,812, 9,334)
- **THEN** the node is stored at (−4,820, 9,340)

#### Scenario: Lost in empty space
- **WHEN** the user pans until no item is inside the viewport
- **THEN** the "Back to workflow" chip appears, and activating it fits the whole workflow in the viewport in 240 ms

### Requirement: Zoom range and steps
Zoom SHALL range from 10 % to 400 %. Stepped zoom (toolbar buttons, keyboard, menu) moves to the next value in the fixed list 10, 15, 25, 33, 50, 67, 75, 100, 125, 150, 200, 300, 400 %; continuous zoom (wheel, pinch) accepts any value in range, rounded to 0.1 % for display. Stepped zoom is centred on the viewport centre and animates in 160 ms with the enter easing; continuous zoom is centred on the pointer or the pinch midpoint so that the canvas point under it stays under it. The toolbar shows the current zoom as a percentage that opens a menu with "Zoom in", "Zoom out", "Zoom to fit", "Zoom to selection", "100 %", "50 %" and "200 %". At a limit the corresponding control is disabled and further input in that direction is ignored without rubber-banding. [NEW]

#### Scenario: Step up from an intermediate value
- **WHEN** zoom is 110 % and the user activates "Zoom in"
- **THEN** zoom animates to 125 % in 160 ms around the viewport centre

#### Scenario: Limits
- **WHEN** zoom is 400 % and the user keeps pinching outwards
- **THEN** zoom stays at 400 % and the "Zoom in" control is disabled

#### Scenario: Zoom about the pointer
- **WHEN** the user zooms with the wheel while the pointer is over a port
- **THEN** that port stays under the pointer within 1 screen px

### Requirement: Pan and zoom input
The viewport SHALL be controllable by every input class:

| Input | Pan | Zoom |
|---|---|---|
| Mouse | wheel = vertical, Shift + wheel = horizontal; drag with the middle button; hold Space and drag with the primary button; drag with the hand tool | `Mod` + wheel: factor 1.1 per wheel notch, about the pointer |
| Trackpad | two-finger scroll on both axes | pinch: factor `exp(−deltaY × 0.01)` per event, about the pointer |
| Touch | one-finger drag on empty canvas; two-finger drag | two-finger pinch about the midpoint; double-tap on empty canvas toggles between fit and 100 % centred on the tap |
| Keyboard | arrow keys 64 screen px, Shift + arrows 256 px, when no node has focus | the actions of "Canvas keyboard shortcuts" |
| On-screen | dragging the minimap viewport | toolbar − and + buttons, zoom menu, "Fit" button |

A per-device preference "Mouse wheel zooms" (default off) swaps the plain-wheel and `Mod` + wheel behaviours. A touch or trackpad pan released above 300 px/s continues with inertia, decelerating exponentially (velocity × 0.998 per ms) and stopping below 20 px/s; any new input stops it within one frame. Viewport changes are never recorded in the undo history and never written to the document. While a text field inside the canvas (rename, note, quick-add search) has focus, wheel and keys act on the field. [NEW]

#### Scenario: Space-drag pans
- **WHEN** the user holds Space and drags 200 px to the left with the primary button over a node
- **THEN** the viewport pans 200 px, the node is neither selected nor moved, and the cursor is the grab hand

#### Scenario: Touch inertia
- **WHEN** a one-finger pan is released at 1,200 px/s
- **THEN** the viewport keeps moving, slows exponentially and stops, and a touch during the glide stops it within one frame

#### Scenario: Wheel preference
- **WHEN** "Mouse wheel zooms" is on and the user turns the wheel one notch without a modifier
- **THEN** zoom changes by a factor of 1.1 about the pointer

### Requirement: Viewport commands
The canvas SHALL provide: **Zoom to fit** — the bounding box of all nodes, groups and notes fits the viewport with 48 screen px padding, capped at 100 % and floored at 10 %; **Zoom to selection** — the same for the selected items with 64 px padding, capped at 150 %, disabled when nothing is selected; **Centre on node** — the node's centre moves to the viewport centre, and zoom changes only when it is below 50 % (raised to 100 %); **Reveal** — used when focus moves to an item by keyboard, search, outline or filter: the viewport pans the minimum distance needed to bring the item fully inside the viewport with 32 px margin, without changing zoom unless the item is larger than the viewport. Each command animates the viewport in 240 ms with the enter easing; under reduced motion the viewport changes instantly. Regions covered by docked panels (palette, inspector, bottom sheet at its current height) are excluded from the viewport used for these computations. [NEW]

#### Scenario: Fit with the inspector open
- **WHEN** the 360 px inspector is open and the user runs "Zoom to fit"
- **THEN** the whole workflow is visible in the area to the left of the inspector with 48 px padding

#### Scenario: Centre on a node at low zoom
- **WHEN** zoom is 25 % and the user chooses "Go to target" on an edge
- **THEN** the viewport animates in 240 ms to 100 % with the target node centred

#### Scenario: Reveal moves minimally
- **WHEN** keyboard focus moves to a node that is 40 px beyond the right edge of the viewport
- **THEN** the viewport pans 72 px to the left and zoom is unchanged

### Requirement: Saved viewport
The canvas SHALL restore the viewport on open in this order: (1) the viewport last used for this workflow on this device, (2) the document's `viewport`, (3) zoom to fit. The device viewport is stored locally under the key `{hostId, workflowId}` 300 ms after the last change, for the 200 most recently opened workflows (least recently used evicted), and is never synchronised. The document's `viewport` is written with a `viewport.set` operation only by the toolbar action "Set as default view" (which requires an editable canvas, see "Canvas modes"), when a workflow is created, and after an auto-layout of the whole graph. Run views, the chat widget and other embedded instances follow the rules of "Canvas modes" and do not overwrite the device viewport of the editing view. [NEW]

#### Scenario: Device viewport restored
- **WHEN** the user leaves a workflow at 150 % zoom and reopens it on the same device
- **THEN** it opens at 150 % at the same position

#### Scenario: First open on another device
- **WHEN** the same workflow is opened on a second device for the first time
- **THEN** it opens at the document's `viewport`

#### Scenario: Viewer cannot set the default view
- **WHEN** a device with the `viewer` role opens the view menu
- **THEN** "Set as default view" is not rendered

### Requirement: Minimap
The canvas SHALL show a minimap on medium and wide form factors, 200 × 132 px, at the bottom-right with 12 px margin (plus the safe-area inset), `bg/elevated` at 92 % opacity with a 1 px `border/hairline` border, `radius/md` and `elevation/1`. It draws every group as a tinted rectangle, every node as a rectangle in its run-status colour (type colour when no run is loaded), no edges, and the viewport as a 1.5 px `accent` outline filled with `timeline/range`; the drawn extent is the union of the content bounds and the viewport plus 10 %. Clicking a point centres the viewport there in 160 ms; dragging the viewport rectangle pans continuously; the wheel over the minimap zooms about the viewport centre. It refreshes at up to 10 Hz during interaction and immediately when idle. It is toggled by a toolbar button and the action `canvas.toggle-minimap`; visibility persists per device. When all content fits inside the viewport the minimap collapses to a 28 × 28 px button and expands again when content leaves the viewport. On compact form factors the minimap is hidden by default and, when toggled on, is 144 × 96 px above the bottom controls. The minimap is not rendered in the `miniature` mode and is excluded from image export. [NEW]

#### Scenario: Navigate with the minimap
- **WHEN** the user clicks a point in the minimap
- **THEN** the viewport centres on the corresponding canvas position within 160 ms

#### Scenario: Everything visible
- **WHEN** the whole workflow fits inside the viewport
- **THEN** the minimap is collapsed to its 28 px button

#### Scenario: Compact default
- **WHEN** a workflow is opened at a viewport width of 390 px
- **THEN** no minimap is shown until the user toggles it on, and it then measures 144 × 96 px

### Requirement: Canvas toolbar
The canvas SHALL show a toolbar built from `design-system` controls: at the top of the canvas region on medium and wide form factors (36 px tall, `bg/app`, bottom hairline) and as a 56 px top bar on compact. Groups, left to right: tool selector (Select, Hand); Undo, Redo; Add node (opens the palette or quick-add), Add note, Add group; Auto-layout; Align and distribute menu (enabled with 2 or more nodes selected); zoom −, zoom percentage menu, zoom +, Fit; Follow toggle and status filter (when a run is loaded); view menu (grid style, alignment guides, minimap, legend, outline view, "Mouse wheel zooms", "Set as default view"); Export menu (Interactive HTML, PNG, SVG, Video (WebM), Copy as image, Print, Export for upstream archify ▸ HTML and JSON, Import archify diagram…). Controls that do not apply to the current mode of "Canvas modes" are not rendered; controls that apply but are currently unavailable are disabled with a tooltip stating the reason. On compact form factors the toolbar keeps Undo, Redo, zoom-to-fit, Follow, outline toggle and an overflow menu holding the remaining items. Every icon button has an accessible label and a tooltip with its current binding from `keyboard-shortcuts.Active binding lookup`. [NEW]

#### Scenario: Read-only mode hides editing controls
- **WHEN** the canvas is in `view` mode
- **THEN** Undo, Redo, Add node, Add note, Add group, Auto-layout and Align are not rendered and zoom, Fit, view and Export are

#### Scenario: Align needs two nodes
- **WHEN** one node is selected in `edit` mode
- **THEN** the Align and distribute menu is disabled with the tooltip "Select two or more nodes"

#### Scenario: Compact toolbar
- **WHEN** the canvas is shown at 390 px width in `edit` mode
- **THEN** the top bar shows Undo, Redo, Fit, the outline toggle and an overflow menu containing Auto-layout, grid options and Export

### Requirement: Node anatomy
An expanded node SHALL be a card with fill `wf/node-bg`, `radius/md` (8 px) corners, a 1 px `border/hairline` border and `elevation/1`, composed top to bottom of:
- **Header**, 40 px: a 20 × 20 px icon tile (`radius/xs`, filled with the node's type colour at 14 % opacity, holding a 14 px outline icon in the type colour) 10 px from the left edge; the title, which is the node's `name` (`type/body-medium`, `text/primary`, one line), 8 px after the tile; at the right, 10 px from the edge, a 16 px status glyph (only when a run is loaded), and on hover or selection a 24 px overflow button and the collapse chevron. The type name and the node's `description` are shown in the tooltip and the outline view.
- **Body**, present when the node has a summary: up to 3 lines of `type/meta` `text/secondary` text with 10 px horizontal padding, produced from the node's configuration by a per-type summary function in the canvas package (persona or role and the first prompt line for `agent`; member count and lead for `team`; generation kind and the first prompt line for `generate`; the first 3 operations or the instruction for `editor`; policy for `approval`; the condition for `branch`, `loop` and `wait`). The body's height is 40, 60 or 80 px for 1, 2 or 3 lines. A node that declares an output of type `ImageRef`, `VideoRef`, `MediaRef` or `ProjectRef` (or a list of one of them) reserves a 64 × 64 px thumbnail slot (`radius/sm`, `bg/inset`) at the right of the body from the moment it is created, so its height does not change when an output arrives; its body is then 80 px tall.
- **Port rows**, 20 px each, one row per index up to the larger of the input and output counts: the input label left-aligned 14 px from the left edge, the output label right-aligned 14 px from the right edge, both `type/meta` `text/secondary`, each truncated to half the node width minus 20 px.
- **Footer**, 28 px, separated by a hairline: at the left the run status text and duration (only when a run is loaded); at the right up to three chips (`type/caption`, `bg/subtle`, `radius/full`, 18 px tall): model or provider, runtime, and cost (estimated cost in design, actual cost in a run), each truncated to 16 characters.
Header, body and row heights are multiples of 20 so that every port centre lies 10 units below a grid line; two connected ports can therefore always be made level with both nodes on the grid. A node with no body and one port row measures 220 × 88, the default size of `agent-workflows.Canvas geometry stored in the document`. The card extends archify's node card: its mask and type-fill rectangle pair, its sigil slot (here the icon tile) and its label, sublabel and tag rows (here the title, the body summary and the footer chips), with the body in the detail tier `context` and the footer chips in the detail tier `fine` used by "Level of detail by zoom". [NEW]

#### Scenario: Agent node with two ports
- **WHEN** an agent node with a 2-line summary, 2 inputs and 1 output is drawn at 100 %
- **THEN** its height is 40 + 60 + 40 + 28 = 168 px and its width is 220 px

#### Scenario: Reserved thumbnail slot
- **WHEN** a generate node with a `VideoRef` output is created and has not run
- **THEN** its body shows a 64 × 64 px slot containing the type icon, and the node's height is the same after its output thumbnail loads

#### Scenario: Footer chips
- **WHEN** a node resolves to model `sonnet-large-latest-preview` on the built-in runtime with an estimated cost of 0.042 USD
- **THEN** the footer shows three chips, the model chip truncated to 16 characters with an ellipsis, and the cost chip reads "≈$0.04"

#### Scenario: Ports can be level
- **WHEN** a node with a 3-line body and a node with no body are placed at the same `y`
- **THEN** the vertical distance between their first ports is 80 units, a multiple of the grid step

### Requirement: Node type visual identities
Every node type SHALL have a distinct identity made of a type colour token, an icon from the icon set of `design-system.Icon tokens`, and a silhouette detail, so that types are distinguishable without colour. Each identity extends archify's visual vocabulary: the node is archify's node card (mask rectangle plus type-fill rectangle, sigil slot, label, sublabel and tag rows) of one of archify's seven base types — the same base type that `agent-workflows.Archify projection` assigns, recorded as the node's base kind (the attribute `data-node-kind` in exported files) — with the listed extension on top; the icon tile occupies archify's sigil slot.

| Node type | archify base type | Colour token | Icon | Extension (silhouette detail) |
|---|---|---|---|---|
| `agent` | `backend` | `wf/type/agent` | `bot` | plain card |
| `team` | `backend` | `wf/type/agent` | `users` | two card edges stacked 4 px and 8 px behind the bottom-right corner |
| `tool` | `external` | `wf/type/tool` | `wrench` | plain card |
| `generate` | `cloud` | `wf/type/generate` | `sparkles` (variant icons `image`, `video`, `mic`, `music`, `volume-2`) | thumbnail slot in the body |
| `script` | `backend` | `wf/type/script` | `file-text` | plain card with a folded top-right corner of 10 px |
| `editor` | `backend` | `wf/type/editor` | `clapperboard` | thumbnail slot in the body |
| `approval` | `security` | `wf/type/gate` | `shield-check` | 3 px `wf/type/gate` bar along the top edge |
| `human_input` | `frontend` | `wf/type/gate` | `message-circle-question` | 3 px `wf/type/gate` bar along the top edge, dashed 6/4 |
| `branch` | `messagebus` | `wf/type/flow` | `git-branch` | icon tile rotated 45° (diamond) |
| `loop` | `messagebus` | `wf/type/flow` | `repeat` | icon tile circular |
| `parallel` | `messagebus` | `wf/type/flow` | `git-fork` | 3 px `wf/type/flow` bar along the right edge |
| `join` | `messagebus` | `wf/type/flow` | `git-merge` | 3 px `wf/type/flow` bar along the left edge |
| `wait` | `messagebus` | `wf/type/flow` | `timer` | icon tile circular with a 1 px dashed outline |
| `subworkflow` | `backend` | `wf/type/tool` | `workflow` | double border (second 1 px border inset 3 px) |
| `trigger` | `frontend` | `wf/type/trigger` | `zap` | left corners with 20 px radius; no input side |
| `export` | `database` | `wf/type/output` | `file-output` | right corners with 20 px radius |
| `notify` | `frontend` | `wf/type/output` | `bell` | right corners with 20 px radius; icon tile circular |
| unlisted type | `external` | `wf/type/unknown` | `box` | plain card |

The type name (localised) is part of every node's tooltip and accessible name. `team` nodes show the member count as a chip in the footer; `subworkflow` nodes show an "Open" header control that opens the referenced workflow; `branch` nodes label each output port with its condition name; `loop` nodes show the iteration limit as a footer chip; `wait` nodes show the wait duration or condition as their summary. A legend listing all identities is available from the view menu (see "Run summary pill, legend and status filter"). [NEW]

#### Scenario: Distinguishable in greyscale
- **WHEN** the golden fixture with one node of each listed type is rendered and converted to greyscale
- **THEN** each node's icon and silhouette detail match the table and no two types share both icon and silhouette

#### Scenario: Trigger silhouette
- **WHEN** a trigger node is drawn
- **THEN** its left corners have a 20 px radius, it has no input ports and its icon tile shows `zap` in `wf/type/trigger`

#### Scenario: Base type matches the projection
- **WHEN** an `approval` node is drawn and the same workflow is projected with `agent-workflows.Archify projection`
- **THEN** the node group in the exported SVG has `data-node-kind="security"` and the projected archify node has `type: "security"`

#### Scenario: Subworkflow opens its target
- **WHEN** the user activates "Open" on a subworkflow node
- **THEN** the referenced workflow opens in the same canvas host with a breadcrumb back to the parent

### Requirement: Node sizes and resize rules
An expanded node SHALL default to 220 canvas units wide, within the 160–480 range of `agent-workflows.Canvas geometry stored in the document`; a collapsed node is 220 × 40. Width is changed by dragging the left or right edge handle of a single selected node on an editable canvas; it snaps to multiples of 20 units, the opposite edge stays on its grid line, and the change is one `node.resize` (plus a `node.move` when the left edge was dragged) in one batch. Height is always derived from content and cannot be dragged. Groups and notes are resizable from 8 handles (4 corners, 4 edges) within the limits of "Groups and sticky notes", also in steps of 20 units. Double-clicking an edge handle resets a node to 220. Resizing below the minimum or above the maximum stops at the limit. On touch devices resize handles appear only on a selected item and have the touch hit area of "Hit-testing". [NEW]

#### Scenario: Resize from the right edge
- **WHEN** the user drags the right edge handle of a 220-wide node 76 px to the right at 100 %
- **THEN** the node becomes 300 units wide (the multiple of 20 nearest to 296), its left edge does not move and one undo step is recorded

#### Scenario: Minimum width
- **WHEN** the user drags the right edge handle 200 px to the left
- **THEN** the node stops at 160 units wide

### Requirement: Node interaction states
A node SHALL show these interaction states, which combine with the run-status styles of "Node run-status styles":

| State | Rendering |
|---|---|
| default | 1 px `border/hairline`, `elevation/1` |
| hover (fine pointer) | 1 px `border/strong`; ports grow from 10 to 12 px; overflow button and collapse chevron appear; 120 ms |
| selected | 2 px `accent` ring drawn 2 px outside the node edge |
| multi-selected | the selected ring on every member, header tinted `accent/subtle`, and one dashed (4/3) 1 px `accent` bounding box around the whole selection with a count chip ("5 selected") at its top-left |
| keyboard focus | the selected ring plus a 1 px `text/primary` ring 5 px outside the node edge, shown only when focus arrived by keyboard |
| dragging | `elevation/3`, scale 1.02, opacity 96 %; connected edges follow every frame |
| invalid | 1.5 px `danger` border, a `triangle-alert` glyph overlaid on the icon tile, and an error-count badge (see "Node badges, metrics and thumbnails") |
| disabled | content at 50 % opacity under a 45° hatch of `border/strong` at 8 px pitch, a "Disabled" chip in the footer, and its edges drawn dashed 6/4 |
| drop target | 2 px `accent` border and `accent/subtle` fill tint while a compatible item is dragged over it |

The selection ring and the status border are separate strokes, so a selected failed node shows both. `invalid` reflects issues returned by `validate` for that node; `disabled` reflects the node's `disabled` field (`agent-workflows.Workflow document`). States are announced in the node's accessible name. [NEW]

#### Scenario: Selected and failed
- **WHEN** a node whose run status is `failed` is selected
- **THEN** it shows a 2 px `danger` border at its edge and a 2 px `accent` ring 2 px outside it

#### Scenario: Invalid node
- **WHEN** `validate` returns two error issues for a node
- **THEN** the node has a 1.5 px `danger` border, the alert glyph on its icon tile and a badge reading "2"

#### Scenario: Hover
- **WHEN** a fine pointer rests over a node
- **THEN** within 120 ms its border is `border/strong`, its ports are 12 px and the overflow button is visible

### Requirement: Node run-status styles
When a run is loaded each node SHALL show the status of `agent-workflows.Node state machine` with a border, a status glyph in the header and a status text in the footer together, never by colour alone:

| Status | Border | Glyph (16 px) | Footer text | Additional |
|---|---|---|---|---|
| `pending` | 1 px `border/hairline` | `circle` in `text/tertiary` | "Pending" (`text/secondary`) | — |
| `ready` | 1 px `border/strong` | `circle-dot` in `text/secondary` | "Ready"; when `blockedBy` is set (the seven values of `agent-workflows.Scheduler`) the text is by value: `slot` and `provider` "Queued", `waiting_gateway` "Waiting for the agent engine" (`text/secondary`), `lease` "Waiting: project or script in use" (`text/secondary`); `budget_exceeded` "Waiting: budget reached", `no_route` "Waiting: no model route", `provider_account` "Waiting: provider account" (`warning/text`); with `retryPending` the text is "Retrying (attempt <n>)" | for the three pause values the glyph is `pause` in `warning/text` and the border is 2 px `warning/text` |
| `running` | 2 px `accent` | progress ring in `accent` | "Running n %" or "Running" (`accent`) | pulse and progress per "Run-state animations"; 2 px `accent` progress bar along the header's bottom edge |
| `waiting_approval` | 2 px `warning/text` | `hand` in `warning/text` | by `waitingReason` (`warning/text`): `approval` "Needs approval", `input` "Needs input", `permission` "Needs permission", `consent` "Needs consent", `human_handoff` "Handed to you", `escalated` "Escalated", `candidate_choice` "Choose a result" | header tinted `warning/subtle` |
| `succeeded` | 1 px `success` | `check` in `success` | "Done" (`success/text`), plus a "Cached" chip when `cacheHit` | — |
| `failed` | 2 px `danger` | `x` in `danger` | "Failed" (`danger`) | header tinted `danger/subtle` |
| `skipped` | 1 px dashed (4/3) `text/tertiary` | `skip-forward` in `text/secondary` | "Skipped" (`text/secondary`); by `reason`: `no_route` "Skipped: no model", `no_renderer` "Skipped: no renderer", `already_done` "Already done", `error_skipped` "Skipped after an error" | whole node at 60 % opacity; for `no_route` the tooltip names the role and offers "Add a provider" |
| `cancelled` | 1 px `text/tertiary` | `ban` in `text/secondary` | "Cancelled" (`text/secondary`) | — |
| `stale` | 1 px dashed (4/3) `purple` | `refresh-cw` in `purple` | "Outdated" (`purple`) | — |

A node with several executions (loop iterations, fan-out items) shows the aggregate: `failed` when any execution failed, otherwise `waiting_approval` when any waits, otherwise `running` when any runs, otherwise `ready`, `pending`, or — when all are terminal — `succeeded` (all succeeded or skipped), `cancelled` or `stale`; the detail panel's iteration and item selectors — one per frame of the execution address `path` of `agent-workflows.Node state machine` — show individual executions. Provider data consent has one representation: the `waiting_approval` row with `consent` ("Needs consent"); there is no consent variant of `ready`. A status this table does not list is drawn with the `pending` style and its own localised name as the footer text. With no run loaded, nodes show no status glyph and no status text. Status text is localised; the spelling `cancelled` is used everywhere. [NEW]

#### Scenario: Running node
- **WHEN** a node's execution is `running` with progress 0.35
- **THEN** it has a 2 px `accent` border, a progress ring at 35 %, the footer text "Running 35 %" and a header progress bar filled to 35 %

#### Scenario: Node blocked by a missing route
- **WHEN** a generate node of an attended run is `ready` with `blockedBy: "no_route"` and the run is `paused` with `pauseReason: "no_route"`
- **THEN** the node has a 2 px `warning/text` border, the `pause` glyph and the footer text "Waiting: no model route"
- **AND** in the session Diagram tab the banner "Paused: no model route for <role>" offers "Open model routing" and "Resume"

#### Scenario: Node waiting for a provider slot
- **WHEN** a node is `ready` with `blockedBy: "provider"`
- **THEN** its footer text is "Queued" and it keeps the `ready` border and glyph

#### Scenario: Waiting for consent
- **WHEN** a generate node is `waiting_approval` with `waitingReason: "consent"`
- **THEN** it has a 2 px `warning/text` border, the `hand` glyph and the footer text "Needs consent"

#### Scenario: No run loaded
- **WHEN** a workflow definition is opened without a run
- **THEN** no node shows a status glyph, status text or progress

#### Scenario: Status not in the table
- **WHEN** the run stream reports a status `paused` for a node
- **THEN** the node is drawn with the `pending` style and the footer text "Paused"

### Requirement: Collapsed and expanded nodes
Every node SHALL be collapsible in every mode, as device-local view state (see "Canvas layout data"). A collapsed node is 220 × 40 canvas units and shows only the header (icon tile, title, status glyph, badges); its input ports are merged into one port mark at the left middle and its output ports into one at the right middle, each showing the port count in a 14 px badge when more than one port is merged, coloured `wf/port/any` when the merged ports differ in family and with the common family colour otherwise. Edges attach to the merged mark. Starting a connection from, or dropping one onto, a merged mark opens a port picker listing the underlying compatible ports (the connection is made directly when exactly one is compatible). Collapse is toggled by the header chevron, the action `canvas.toggle-collapse` and the context menu; "Collapse all" and "Expand all" are in the canvas context menu. Collapsing is not an undo step and sends no operation. The transition animates height and port positions in 160 ms with the enter easing. A collapsed group (the stored `collapsed` flag of a group) is specified in "Groups and sticky notes". [NEW]

#### Scenario: Collapse a node with three outputs
- **WHEN** the user collapses a node with 2 inputs of the same family and 3 outputs of different families
- **THEN** the node becomes 220 × 40, the left mark has the inputs' family colour with a badge "2", the right mark is `wf/port/any` with a badge "3", and all 5 edges attach to the two marks

#### Scenario: Connect to a collapsed node
- **WHEN** the user drops a text connection on the merged input mark of a collapsed node that has two compatible text inputs
- **THEN** a port picker lists the two inputs and the edge is created to the chosen one

#### Scenario: Collapse in a run view
- **WHEN** a viewer collapses a node in `run` mode
- **THEN** the node collapses on that device only and no operation is sent

### Requirement: Inline rename
In `edit` mode the user SHALL be able to rename a node, group or edge label in place: by double-clicking the title, by the action `canvas.rename` on the focused item, or from the context menu. A text field replaces the title at the same position and style with all text selected; Enter commits, Escape restores the previous title, and blur commits. The new title is validated through `canApply`; when it is rejected (for example a node name outside the 1–60 characters of `agent-workflows.Workflow document`) the field stays open in the invalid state of `design-system.Text input and textarea` with the returned message. A committed rename is one undo step. While the field is open the canvas does not handle canvas shortcuts, and zoom is kept so that the field's text is at least 12 screen px tall (the viewport zooms to 100 % centred on the node when it is smaller). On touch devices rename opens the same field with the on-screen keyboard, and the viewport pans so the field stays above the keyboard. [NEW]

#### Scenario: Rename and undo
- **WHEN** the user double-clicks a node title, types "Draft script" and presses Enter
- **THEN** the title changes and one undo restores the previous title

#### Scenario: Rejected title
- **WHEN** the user clears the title and presses Enter
- **THEN** the field stays open in the invalid state with the returned message and the document is unchanged

#### Scenario: Rename at low zoom
- **WHEN** the user presses the rename key on a focused node at 25 % zoom
- **THEN** the viewport animates to 100 % centred on the node before the field opens

### Requirement: Ports
Inputs SHALL be drawn on a node's left edge and outputs on its right edge, each centred on the edge at the middle of its port row, as a 10 px mark filled with the token of its family. The canvas maps the types of `agent-workflows.Ports and data types` to ten families:

| Family (token `wf/port/<family>`) | Types |
|---|---|
| `text` | `string`, `text`, `ScriptRef`, `CaptionSet` |
| `scalar` | `number`, `integer`, `boolean` |
| `json` | `json`, `Brief`, `ShotList`, `Shot`, `AssetPlan`, `ReviewReport`, `Handoff`, `Decision`, `FormResponse`, `RunRef` |
| `image` | `ImageRef` |
| `video` | `VideoRef` |
| `audio` | `AudioRef`, `VoiceTrack`, `MusicTrack`, `SfxSet` |
| `file` | `MediaRef`, `FileRef` |
| `project` | `ProjectRef` |
| `control` | the control ports of `agent-workflows.Typed edges` (`start`, `done`, `next`, named control outputs) |
| `any` | `any` and every type not listed here |

`list<T>` uses the family of `T`. Shape carries meaning without colour: data ports are circles; `control` ports are squares with 2 px corner radius; `any` ports are hollow rings (2 px stroke, `wf/node-bg` centre); list-typed ports add a second 1 px ring 2 px outside the mark; inputs in mode `collect` or `first` are capsules 10 px wide and 16 px tall; a node's `error` output is the last output row and its mark is `danger`. A connected port is filled; an unconnected required input with no default has a 1.5 px `danger` ring; an unconnected input that is not required is drawn at 60 % opacity. Hovering or focusing a port for 300 ms shows a tooltip "<port label> · <type>", plus "required", "collects up to 16" or "first available" where applicable and, in a run, a one-line preview of the value that passed through it (first 80 characters, or media kind and dimensions). Port rows show the port `label`; the type name is appended when the node is at least 320 units wide. [NEW]

#### Scenario: Shapes by family
- **WHEN** a node has a `text` input, a `start` control input and an `any` output
- **THEN** they are drawn as a filled circle in `wf/port/text`, a rounded square in `wf/port/control` and a hollow ring in `wf/port/any`

#### Scenario: Missing required input
- **WHEN** a required input has no incoming edge, no default and no template value
- **THEN** the port has a 1.5 px `danger` ring and the node is in the `invalid` state with the issue `WORKFLOW_INPUT_MISSING`

#### Scenario: Port tooltip in a run
- **WHEN** the pointer rests for 300 ms on an `ImageRef` output through which a 1,920 × 1,080 image passed
- **THEN** the tooltip reads "<port label> · ImageRef" and "Image 1920 × 1080"

#### Scenario: Collect input
- **WHEN** an input has mode `collect`
- **THEN** its mark is a 10 × 16 px capsule and its tooltip includes "collects up to 16"

### Requirement: Edge geometry and obstacle-aware routing
An edge SHALL be drawn from the centre of its source output port to the centre of its target input port, leaving the source horizontally to the right and entering the target horizontally from the left, according to its stored `route` (`agent-workflows.Canvas geometry stored in the document`).
- **`bezier` with no waypoints (the default)** — a smooth path computed by the canvas. The direct path is a single cubic Bézier with control points `(sx + d, sy)` and `(tx − d, ty)`, `d = clamp(0.5 × |tx − sx|, 40, 240)` canvas units. An edge whose target port lies less than 40 units to the right of its source port (a backward edge, typically `loop_back`) is routed around the union of the two nodes' bounds, below it by default and above it when the path above is shorter and unobstructed, with 20 units of clearance. Routing is obstacle-aware: the direct path is flattened to 24 segments and tested against every node rectangle inflated by 10 units that the spatial index returns for the path's bounds, excluding the edge's own two nodes; when it intersects one, the edge is routed by archify's orthogonal grid router (`shortestOrthogonalGridRoute`: a shortest-path search over the sparse grid spanned by the endpoint stubs and the sides of the inflated obstacles) with 10 units of clearance, endpoint stubs of 20 units, a bend penalty of 60 units, the obstacles limited to those intersecting the endpoints' bounding box inflated by 320 units (at most 80, nearest first) and at most 2,000 grid nodes; a route with at most 4 bends is drawn as straight segments joined by corner curves of 20 units radius (archify's `roundedPath`), and when the search returns no route or one with more than 4 bends the direct path is used. Groups and notes are not obstacles. These computed paths are derived, never stored: the same node rectangles give the same path on every platform, with points rounded to 0.5 units.
- **`orthogonal`** — right-angle segments with 8-unit rounded corners, through the stored waypoints when there are any and otherwise along the grid route described above.
- **`straight`** — straight segments from port to port through the stored waypoints, with no obstacle avoidance.
- **Waypoints (0–8)** — for any style, the path passes through every stored waypoint in order. On an editable canvas a selected edge shows an 8 px square handle at each waypoint and a 6 px ghost handle at the middle of each segment; dragging a ghost handle creates a waypoint, dragging a handle moves it (snapped to the 20-unit grid), double-clicking a handle removes it, and no ghost handle is shown when the edge already has 8 waypoints. The edge context menu offers "Route style ▸ Curved, Orthogonal, Straight" and "Reset route" (style `bezier`, no waypoints). Each change is one `edge.update` batch. When both nodes of an edge are moved in the same drag its waypoints move with them in the same batch; otherwise waypoints keep their positions.
While nodes are being dragged, computed edges attached to them follow every frame as direct paths and all other edges are unchanged; within 50 ms of the drop every computed edge whose bounds intersect the old or new bounds of a moved node is re-routed, cross-fading to the new path in 120 ms. [NEW]

#### Scenario: Direct path
- **WHEN** a source port at (220, 110) connects to a target port at (520, 190) with no node between them and no waypoints
- **THEN** the path is a single cubic with control points (370, 110) and (370, 190)

#### Scenario: Node in the way
- **WHEN** a third node lies on the direct path between two connected nodes
- **THEN** the edge passes around it keeping at least 10 units from its rectangle, with at most 4 bends

#### Scenario: Backward edge
- **WHEN** a `loop_back` edge runs from a node's output to a loop node 400 units to its left
- **THEN** the path leaves to the right, passes below both nodes with 20 units of clearance and enters the target from the left

#### Scenario: Add a waypoint
- **WHEN** the user drags the ghost handle of a selected edge to (403, 251)
- **THEN** a waypoint is stored at (400, 260), the path passes through it, and one undo removes it

#### Scenario: Router budget exceeded
- **WHEN** more than 80 node rectangles intersect the inflated bounding box of an obstructed edge's endpoints
- **THEN** the edge is drawn as its direct path and no error is raised

#### Scenario: Deterministic computed routes
- **WHEN** the same document is routed on web, iOS and Android
- **THEN** every computed path's points are equal to within 0.5 units

### Requirement: Edge appearance and states
An edge SHALL be stroked at 1.5 canvas units (never thinner than 1 screen px) with round caps. With no run loaded its colour is the family token of its source port; with a run loaded it takes the run colour of "Edge flow animation" and the ports keep their family colours. The arrowhead at the target end encodes what the edge carries: a filled triangle 8 units long and 7 wide for single values, an open chevron of the same size for `control` edges, and two filled triangles 4 units apart for list-typed values. The edge kinds of `agent-workflows.Typed edges` are drawn as: `data` — solid; `control` — solid in `wf/port/control`; `error` — dashed 6/4 in `danger`; `loop_back` — dotted 2/4. An edge of a disabled node is additionally drawn at 60 % opacity, and an edge named by a validation issue is `danger` with a 14 px `triangle-alert` badge at its midpoint. States: hover (fine pointer) — stroke 2.5 units and, after 500 ms, a tooltip "<source node> · <port> → <target node> · <port> (<type>)"; selected — stroke 2.5 units in `accent`, with a 10 px endpoint handle (`wf/node-bg` fill, 2 px `accent` stroke) at each end and the waypoint handles of "Edge geometry and obstacle-aware routing"; keyboard focus — the selected style plus a 1 px `text/primary` outline 3 px around the path. Selecting an edge shows its source, target, kind, type, label and, in a run, its state and the value preview in the detail panel. [NEW]

#### Scenario: Arrowhead for a list value
- **WHEN** an edge leaves an output of type `list<ImageRef>`
- **THEN** it is stroked in `wf/port/image` and ends in two filled triangles 4 units apart

#### Scenario: Selected edge
- **WHEN** the user clicks an edge
- **THEN** the edge is 2.5 units wide in `accent` with a handle at each end, and the detail panel shows its source and target ports

#### Scenario: Error edge
- **WHEN** an edge has kind `error`
- **THEN** it is drawn dashed 6/4 in `danger` with no run loaded

### Requirement: Edge labels
An edge with a `label` (0–40 characters, `agent-workflows.Typed edges`) SHALL show it in a pill centred at `route.labelT` of the path's length (default 0.5): `type/caption`, `text/secondary`, fill `wf/node-bg`, 1 px `border/hairline`, `radius/full`, padding 2 × 6 px, at most 24 characters followed by an ellipsis. Edges leaving a `branch` output with no label of their own show that output's case name. A label is hidden — and shown instead in the edge tooltip, the detail panel and the outline view — when zoom is below 50 %, when the path is shorter than the label width plus 40 units, or when the pill at `labelT` would come within 8 units of a node rectangle or another label. On an editable canvas a label is edited by double-clicking the pill or the edge (the inline field of "Inline rename") or from the edge context menu; clearing the text removes the label; dragging the pill slides it along the path and stores `labelT` rounded to 0.05. Each change is one `edge.update` batch. [NEW]

#### Scenario: Label too long for the edge
- **WHEN** an edge is 60 units long and its label is 72 units wide
- **THEN** the label is not drawn and the edge tooltip shows it

#### Scenario: Branch case name
- **WHEN** a branch node's output for the case "approved" is connected by an edge with an empty label
- **THEN** the edge shows "approved" at its midpoint

#### Scenario: Slide a label
- **WHEN** the user drags a label pill to 72 % of the path's length
- **THEN** `route.labelT` is stored as 0.7 and one undo restores 0.5

### Requirement: Connecting ports by dragging
On an editable canvas the user SHALL create an edge by dragging from a port to a port; what the connection means (edge kind, replacement, node creation, added inputs) is defined by `agent-workflows.Connecting ports`, and the canvas provides the gesture and its feedback. A drag of more than 4 px starting on an output or an input port starts a connection (direction is inferred, so a drag from an input searches for outputs). During the drag: a preview edge (1.5 units, dashed 6/4, in the source port's colour) follows the pointer; the per-port result `compatible | incompatible (reason code)` is obtained once from `packages/workflow` within 16 ms of the drag start for 200 nodes; compatible ports grow to 14 px with a 2 px `accent` ring; ports that are incompatible only because of `WORKFLOW_PORT_OCCUPIED` keep full opacity with a 2 px `warning/text` ring; all other incompatible ports are drawn at 30 % opacity and nodes with no compatible or replaceable port at 50 % opacity; within 24 screen px (32 on touch) of a compatible or replaceable port the preview end snaps to it and becomes solid; over any other incompatible port the preview turns `danger`, the cursor becomes `not-allowed`, and a tooltip next to the pointer shows the reason's message (for example "This connection would create a loop — use a Loop node") immediately. Releasing on a compatible port creates the edge (one batch); releasing on an occupied `single` input shows a popover "Replace connection" / "Cancel" at the port, with the existing edge drawn at 40 % opacity; releasing on a node body connects to that node's first compatible free input, or behaves as an invalid drop when there is none; while a connection is dragged over a node that accepts user-declared ports and has no compatible one, a drop zone "+ Add input" appears below its last input row and releasing there adds the port and the edge in one batch; releasing on another incompatible port or pressing Escape retracts the preview in 160 ms and changes nothing; releasing on empty canvas opens "Quick-add menu". The viewport auto-pans while the pointer is within 32 px of its edge, at a speed proportional to the depth, up to 800 px/s. [NEW]

#### Scenario: Valid connection
- **WHEN** the user drags from a `text` output and releases on a compatible input 20 px from its centre
- **THEN** the preview snaps to the port, an edge is created with the draw-on animation and one undo removes it

#### Scenario: Type mismatch
- **WHEN** the dragged connection hovers a port reported incompatible with `WORKFLOW_TYPE_MISMATCH`
- **THEN** the preview is `danger`, the cursor is `not-allowed`, the reason is shown next to the pointer, and releasing creates no edge

#### Scenario: Drag from an input
- **WHEN** the user drags from an unconnected input port
- **THEN** compatible output ports are highlighted and releasing on one creates an edge from that output to the input

#### Scenario: Replace an existing connection
- **WHEN** the user drops a connection on an occupied `single` input and chooses "Replace connection"
- **THEN** one batch removes the old edge and adds the new one, and one undo restores the old edge

#### Scenario: Add an input by dropping
- **WHEN** the user drags an `ImageRef` connection over a node that accepts user-declared ports and releases on "+ Add input"
- **THEN** the node gains an input, the edge is connected to it, and one undo removes both

### Requirement: Reconnecting an edge
In `edit` mode the user SHALL be able to move either end of an edge to another port: by dragging an endpoint handle of a selected edge, or by starting a drag within 16 screen px of an edge's end on an unselected edge. During the drag the moved end follows the pointer with the feedback of "Connecting ports by dragging", evaluated against the fixed end. Releasing on a compatible port re-attaches the edge, keeping its id and label (one undo step); releasing anywhere else, or pressing Escape, restores the edge in 160 ms. An edge is never deleted by a reconnect drag. On touch devices reconnect is offered as "Change source…" and "Change target…" in the edge's bottom sheet, which enter the tap-to-connect mode of "Touch gestures". [NEW]

#### Scenario: Move the target end
- **WHEN** the user drags the target handle of a selected edge onto a compatible input of another node
- **THEN** the edge keeps its id and label, now ends at the new port, and one undo restores the previous target

#### Scenario: Release on empty canvas
- **WHEN** the user releases the dragged end over empty canvas
- **THEN** the edge returns to its previous port within 160 ms and the document is unchanged

### Requirement: Inserting a node on an edge
In `edit` mode, dragging a single node that has no edges (from the palette or from the canvas) over an edge SHALL offer insertion: after the node's centre has stayed within 12 screen px of the edge for 150 ms, and when the node has an input compatible with the edge's source port and an output compatible with the edge's target port (both checked with `validateConnection`), the edge is drawn 3 units wide in `accent` with a 16 px "+" badge at its midpoint. Dropping then replaces the edge with two edges (source → node, node → target) as one undo step; the original label stays on the first new edge. Holding `Alt` suppresses insertion so that the node can be placed over an edge. The node is placed at the drop position (snapped); no other node is moved. The edge context menu item "Insert node…" opens the quick-add menu filtered to node types that satisfy both compatibility checks and inserts the chosen node at the edge's midpoint. [NEW]

#### Scenario: Insert by dropping
- **WHEN** the user drags a "translate" tool node from the palette, holds it over the edge script → voiceover for 150 ms and drops
- **THEN** the edge is replaced by script → translate and translate → voiceover, and one undo restores the single edge and removes the node

#### Scenario: Incompatible node
- **WHEN** the dragged node has no output compatible with the edge's target port
- **THEN** the edge is not highlighted and dropping places the node without changing the edge

#### Scenario: Suppress with Alt
- **WHEN** the user holds `Alt` while dropping a compatible node on an edge
- **THEN** the node is placed and the edge is unchanged

### Requirement: Dense graph legibility
The canvas SHALL keep dense graphs readable: (a) edges leaving the same output port share one trunk for their first 20 units before fanning out, and edges entering the same input port merge for their last 20 units; (b) parallel edges between the same two nodes are spaced 8 units apart; (c) computed edges that span more than one layer after an auto-layout run through the gaps between rows left by the 140-unit row pitch of `agent-workflows.Deterministic auto-layout`; (d) when more than 150 edges intersect the viewport, edges that are neither selected nor incident to a selected or hovered node are drawn at 45 % opacity; (e) when more than 60 edges intersect the viewport, hovering a node for 400 ms or selecting it draws its incident edges at 2.5 units and full opacity and all other edges at 25 % opacity, restored 120 ms after the hover ends. Run-state colours and the flow animation of `flowing` edges are never dimmed by (d) or (e). [NEW]

#### Scenario: Fan-out trunk
- **WHEN** one output port feeds five edges
- **THEN** the five paths coincide for their first 20 units and then diverge

#### Scenario: Focus on hover
- **WHEN** 80 edges are visible and the pointer rests on a node for 400 ms
- **THEN** that node's edges are drawn at 2.5 units and full opacity and the other edges at 25 % opacity

#### Scenario: Flowing edges stay prominent
- **WHEN** 200 edges are visible during a run and 3 of them are `flowing`
- **THEN** the 3 flowing edges are drawn at full opacity with the flow animation and the others at 45 % opacity

### Requirement: Node palette
In `edit` mode the canvas SHALL provide a node palette: a docked left panel 264 px wide on wide form factors (resizable 220–360 px, collapsible with `canvas.toggle-palette`, state persisted per device), an overlay panel of 264 px on medium, and a bottom sheet (snap points 50 % and 90 %) on compact. Contents, top to bottom: a search field; "Recently used" (the 8 entries most recently added on this device); and collapsible categories in this order — **Agents** (agent, team), **Create** (generate, script, editor), **Tools** (tool, subworkflow), **Flow** (branch, loop, parallel, join, wait), **People** (approval, human input, notify), **Start and finish** (trigger, export), **Annotations** (group, sticky note). Above the categories, when a template capability contributed palette presets for the open workflow (item 9 of `agent-workflows.Contract for template capabilities`), a category **From this template** lists them in the contributed order — for a workflow created from `tpl.one-prompt-video`: "Brief", "Shot list", "Asset plan", "Shots", "Voiceover", "Captions", "Music", "Sound effects", "Assemble" and "Review" — each drawn with the icon tile of the node type it inserts and inserted as that named node configuration with its ports, schema and default performer; a workflow whose template contributes none (for example `tpl.film-episode`) and a workflow created from blank show no such category, and presets take part in search and in "Recently used" like any other entry. Variants are listed under their type: generate → one entry per generation kind of `agent-workflows.Generate node`; agent → each persona available on the host; team → each team; tool → each tool permitted by `agent-workflows.Tool node`; subworkflow → each other workflow of the host. A row is 28 px (44 px on compact) with the type's icon tile, name and a one-line description. Search matches name, description and keywords case- and diacritic-insensitively, ranks prefix matches before word-start matches before other substring matches, returns within 50 ms for 500 entries, and shows "No results for "<query>"" when empty. An entry is added by dragging it onto the canvas (a ghost of the node at the current zoom, 80 % opacity, follows the pointer after 4 px of movement; dropping outside the canvas or pressing Escape cancels) or by click, tap or Enter, which places the node at the viewport centre, snapped, moved by (40, 40) units up to 10 times while it would overlap another node, and selects it. Entries the device is not allowed to create are disabled with the reason as tooltip: workspace-agent variants require the `admin` role, or the `editor` role when the host setting "Allow workspace agents for editors" is on (design D25). The palette is rendered only on an editable canvas (see "Canvas modes"). [NEW]

#### Scenario: Click to add
- **WHEN** the user clicks "Generate → Image" twice in a row
- **THEN** two nodes are created near the viewport centre, the second offset by (40, 40) units from the first, and the second is selected

#### Scenario: Template presets in the palette
- **WHEN** an `editor` opens the palette on a workflow created from `tpl.one-prompt-video`
- **THEN** the category "From this template" lists the ten presets from "Brief" to "Review" in that order above "Agents"
- **AND** adding "Voiceover" inserts a node with that preset's ports, schema and default performer

#### Scenario: No presets
- **WHEN** the palette is opened on a workflow created from blank
- **THEN** no "From this template" category is shown

#### Scenario: Search
- **WHEN** the user types "appr" in the palette search
- **THEN** "Approval" is the first result and pressing Enter adds it at the viewport centre

#### Scenario: Workspace agent not allowed
- **WHEN** an `editor` device opens the palette on a host where "Allow workspace agents for editors" is off
- **THEN** workspace-agent entries are disabled with the tooltip "Only an admin device can add workspace agents"

#### Scenario: Recently used
- **WHEN** the user has added "Script" and then "Branch"
- **THEN** "Recently used" lists Branch first and Script second

### Requirement: Quick-add menu
The canvas SHALL offer a quick-add menu at a canvas position: a popover 280 px wide with a focused search field and up to 8 visible rows (scrolling beyond), presented as a bottom sheet on compact form factors. It opens when a connection is dropped on empty canvas, when the user double-clicks empty canvas, through `canvas.quick-add` (at the pointer when it is over the canvas, otherwise at the viewport centre), and from "Insert node…" on an edge. When opened from a dragged connection it lists only node types and variants that have a port compatible with the dragged port, ordered: up to 3 compatible recently used entries, then catalogue order; each row names the port that will be connected ("→ prompt"). Choosing an entry creates the node so that the connecting port lies at the drop position, creates the edge, and records both as one undo step; the preview edge stays visible while the menu is open. Escape or an outside press closes the menu and removes the preview with no change. Keyboard: Down/Up move, Enter chooses, typing filters. When no node type is compatible the menu shows "No compatible nodes" and only the search field. [NEW]

#### Scenario: Drop a connection on empty canvas
- **WHEN** the user drags from a video output and releases on empty canvas
- **THEN** the quick-add menu lists only entries with a video-compatible input, and choosing "Editor" creates an editor node whose video input is at the release point, connected to the dragged output

#### Scenario: Cancel
- **WHEN** the quick-add menu is open after a dropped connection and the user presses Escape
- **THEN** the menu closes, the preview edge disappears and no undo step exists

#### Scenario: Double-click on empty canvas
- **WHEN** the user double-clicks empty canvas in `edit` mode
- **THEN** the quick-add menu opens at that point listing all entries the device is allowed to create

### Requirement: Drag and drop with snapping and alignment guides
On an editable canvas nodes, groups and notes SHALL be moved by dragging: a drag of more than 4 px on an item (a long-press on touch, see "Touch gestures") moves the whole selection, or the item alone when it is not selected (which also selects it). While dragged, items follow the pointer continuously; on release every position settles on the 20-unit grid required by `agent-workflows.Canvas geometry stored in the document`. Among the grid positions near the pointer the canvas prefers, per axis and in this priority, one that satisfies:
- **Straight-edge snap**: when a dragged node is connected to a node that is not being dragged and the pointer is within 8 screen px (12 on touch) of the height at which the connecting ports are level, that height is used and a 1 px `preview/guide` line is drawn along the edge.
- **Alignment guides**: the left, horizontal centre and right, and the top, vertical middle and bottom of the dragged bounding box are compared with those of the 64 nearest items that intersect the viewport inflated by 400 px; within the same tolerance, and when the aligned position is a grid position, the selection takes it and a 1 px `preview/guide` line is drawn through both items, extended 16 px beyond each.
- **Equal-spacing hints**: when the gap between the dragged item and its nearest neighbour in the same row or column would equal, within the same tolerance, the gap between two adjacent items of that row or column, that position is used and each equal gap shows a 1 px `preview/guide` segment with end ticks and the gap value in `type/caption`.
With no guide engaged the nearest grid position is used. Guides are toggled in the view menu and by `canvas.toggle-guides` (default on, persisted per device); holding `Mod` during a drag disables them for that drag; holding Shift constrains movement to the dominant axis. The viewport auto-pans as in "Connecting ports by dragging". A node dropped with its centre inside a group's frame becomes a member of that group, and a node dragged out leaves it, in the same batch as the move. Escape during a drag returns everything to its start position with no change. One drag is one batch of `node.move` (and `group.update`, `note.update`) operations, sent on release. Dragging a selection of 200 nodes MUST stay within the frame budget of "Performance budgets and load shedding". [NEW]

#### Scenario: Alignment guide
- **WHEN** the user drags a node until its left edge is 5 screen px from the left edge of a neighbour
- **THEN** the node takes the neighbour's `x` and a vertical guide is drawn through both nodes

#### Scenario: Straight edge
- **WHEN** a dragged node connected to a stationary upstream node comes within 8 screen px of the height at which their connecting ports are level
- **THEN** it takes that height and the connecting edge is a straight horizontal line

#### Scenario: Equal spacing
- **WHEN** nodes A and B are 80 units apart in a row and the user drags C to the right of B until its gap to B is within 8 screen px of 80 units
- **THEN** C is placed with an 80-unit gap and both gaps show a spacing segment labelled "80"

#### Scenario: Guides disabled
- **WHEN** the user holds `Mod` while dragging
- **THEN** no guide is drawn and the node settles on the grid position nearest the pointer

#### Scenario: Cancel a drag
- **WHEN** the user presses Escape while dragging three nodes
- **THEN** the three nodes return to their start positions and no batch is sent

### Requirement: Selection and marquee
The canvas SHALL support selecting nodes, edges, groups and notes in any combination. A click or tap selects the item and clears the previous selection; `Shift` + click or `Mod` + click toggles the item in the selection; a click on empty canvas or `canvas.clear-selection` clears it; `canvas.select-all` selects every node, group and note. With the Select tool on a fine pointer, dragging from empty canvas draws a marquee (1 px `accent` border, `timeline/range` fill) that selects every item it intersects; holding `Alt` selects only items it fully encloses; holding `Shift` adds to the existing selection; edges are included when both of their nodes are. The selection updates live during the marquee and the viewport auto-pans within 32 px of its edge. Selecting a group does not select its members, but moving, copying or deleting-with-contents a group includes them. Selection is device-local, is not synchronised, is not an undo step, and is restored by undo and redo to what it was when the undone change was made. The number of selected items is announced through a polite live region ("5 items selected"). In read-only modes single selection is available for inspection and multi-selection is available for image export and copy. [NEW]

#### Scenario: Marquee by intersection
- **WHEN** the user drags a marquee that fully contains two nodes and touches a third
- **THEN** all three are selected, and with `Alt` held only the two contained nodes are

#### Scenario: Toggle with Shift
- **WHEN** three nodes are selected and the user Shift-clicks one of them
- **THEN** that node leaves the selection and the other two stay selected

#### Scenario: Edge included with its nodes
- **WHEN** a marquee selects two nodes joined by an edge
- **THEN** the edge is part of the selection

### Requirement: Groups and sticky notes
The canvas SHALL draw and edit the two annotation objects of `agent-workflows.Canvas geometry stored in the document`, which have no effect on execution and no ports.
- **Groups** (annotation frames): a rectangle at the group's `frame` with `radius/lg` (12 px), filled with its colour at 8 % opacity, a 1 px border in its colour at 50 % opacity, and a 28 px title bar at the top-left with the `label` (0–60 characters, shown as "Group" when empty) in `type/body-medium` `text/primary`. `colorIndex` 1–8 resolves to the tokens `wf/group/1` … `wf/group/8`; new groups use index 1. A group is created by `canvas.add-group` followed by dragging a rectangle, or by `canvas.group`, which creates a group whose `nodeIds` are the selected nodes and whose frame is their bounding box plus 20 units of padding and the title bar, snapped outward to the grid. Membership is the stored `nodeIds`: a node belongs to at most one group and groups do not nest; the canvas updates membership when a node is dropped (see "Drag and drop with snapping and alignment guides"), using the group last in document order when frames overlap. Dragging a group by its title bar or border moves its members with it; resizing it (8 handles, minimum 160 × 100 units, steps of 20) does not move them and re-evaluates membership on release. `canvas.ungroup` removes the selected groups and keeps their nodes. Groups are drawn below edges and nodes.
- **Collapsed groups**: a group whose `collapsed` flag is set is drawn as one card of 240 × 60 units at the frame's top-left corner showing the label, a chip "<n> nodes" and, with a run loaded, an aggregate status glyph and "<done>/<n> done" (the aggregate is `failed` when any member failed, otherwise `waiting_approval` when any member waits, otherwise `running` when any member runs, otherwise `succeeded` when every member succeeded or was skipped, otherwise `pending`). Its members and the edges between them are not drawn; edges crossing the group's boundary attach to the card's left middle (incoming) or right middle (outgoing), merged per side with a count badge. The flag is toggled by the chevron in the title bar and by `canvas.toggle-collapse` on a selected group, as one undoable `group.update` on an editable canvas; on a canvas that is not editable the toggle changes only device-local view state. Revealing a member of a collapsed group reveals the card.
- **Sticky notes**: a rectangle with `radius/sm`, fill `warning/subtle`, a 1 px `border/hairline` border and no shadow, default 200 × 120 units, within the stored limits (width 120–800, height 60–800, steps of 20), holding up to 2,000 characters of plain text with line breaks in `type/body` `text/primary` with 8 px padding; text that does not fit is clipped with a 16 px fade and is complete in the outline view. A note is created by `canvas.add-note` (at the pointer or viewport centre) and edited by double-click or `canvas.rename`; Escape or a press outside ends editing and commits.
Creating, moving, resizing, recolouring, relabelling and deleting either object is one undoable batch of `group.*` or `note.*` operations and requires an editable canvas. [NEW]

#### Scenario: Group a selection
- **WHEN** the user selects four nodes and invokes `canvas.group`
- **THEN** a group whose `nodeIds` are those four nodes surrounds them with 20 units of padding below a 28-unit title bar, and dragging its title bar moves all four

#### Scenario: Membership is exclusive
- **WHEN** the user drags a node that belongs to group A and drops it with its centre inside group B
- **THEN** one batch moves the node and makes it a member of B only

#### Scenario: Collapsed group during a run
- **WHEN** a collapsed group has 5 members of which 3 succeeded and 1 is running
- **THEN** its card shows the running glyph and "3/5 done", and the edges entering the group attach to the card's left middle

#### Scenario: Ungroup
- **WHEN** the user invokes `canvas.ungroup` on a group containing three nodes
- **THEN** the group is removed, the three nodes keep their positions, and one undo restores the group

#### Scenario: Note length limit
- **WHEN** the user pastes 2,400 characters into a note
- **THEN** the note keeps the first 2,000 characters and shows the counter "2000/2000" in the invalid state for 1.5 s

### Requirement: Duplicate, copy, cut and paste
On an editable canvas the canvas SHALL support `canvas.duplicate`, `canvas.copy`, `canvas.cut` and `canvas.paste` on the selection, with the meaning defined by `agent-workflows.Editing semantics for the canvas`: the copied `jagentchill.workflow.fragment` JSON holds the selected nodes with their configuration, the selected groups and notes, and every edge whose two nodes are both selected; trigger nodes and run data are excluded; pasted items receive new ids. The canvas writes the fragment to the system clipboard as `text/plain` (and additionally in the web custom format `application/vnd.jagentchill.workflow-fragment+json` where the platform supports it), and on mobile also keeps it in an in-app clipboard. Paste places the fragment's top-left corner at the pointer when it is over the canvas and otherwise at the viewport centre, on the grid, offsets repeated pastes at the same place by (40, 40) units, selects the pasted items, plays the node-enter animation and is one batch and one undo step. Duplicate is copy and paste at an offset of (40, 40) units without touching the clipboard. Cut is copy followed by delete in one batch. Paste works across workflows and across paired hosts; references that do not resolve on the target are reported by validation (`WORKFLOW_REF_UNRESOLVED`), so the pasted node shows the `invalid` state with the missing reference named. A fragment never contains secret values (secrets are referenced by name only). A fragment the target refuses (schema, size or limits per `agent-workflows.Import and export file format` and `agent-workflows.Size limits`) is not pasted and the returned message is shown in a toast. Pasting plain text that is not a fragment creates a sticky note with the first 2,000 characters. Pasted nodes are subject to the same creation permissions as palette entries (see "Node palette"). When a selection containing the trigger is copied, a toast states "The trigger was not copied". [NEW]

#### Scenario: Duplicate keeps internal edges
- **WHEN** the user duplicates two connected nodes that also have an edge to a third, unselected node
- **THEN** two new nodes appear offset by (40, 40) units with one edge between them and no edge to the third node

#### Scenario: Paste into another workflow
- **WHEN** the user copies three nodes in workflow A and pastes in workflow B on a host where one referenced persona does not exist
- **THEN** three nodes with new ids are created and the node with the missing persona is `invalid` with a `WORKFLOW_REF_UNRESOLVED` issue naming the persona

#### Scenario: No secret values on the clipboard
- **WHEN** the user copies a tool node whose configuration references the secret `STOCK_API_KEY`
- **THEN** the clipboard text contains the name `STOCK_API_KEY` and no secret value

#### Scenario: Plain text becomes a note
- **WHEN** the clipboard holds the text "Check the pacing here" and the user pastes on the canvas
- **THEN** a sticky note containing that text is created at the pointer

### Requirement: Delete with edge handling
`canvas.delete` SHALL remove the selected nodes, edges, groups and notes on an editable canvas as one batch and one undo step, with the meaning of `agent-workflows.Editing semantics for the canvas`: deleting a node also deletes every edge attached to it and any group left without members; deleting a group keeps its members (the group context-menu item "Delete with contents" removes them too); deleting an edge leaves its nodes; the trigger node is never removed. `canvas.delete-reconnect` deletes the selected nodes and, for each deleted node that had exactly one incoming and one outgoing `data` edge whose remaining ports are compatible, adds a bridging edge from the upstream port to the downstream port in the same batch. When the selection contains the trigger, the other items are deleted, the trigger stays, and a toast states "The trigger cannot be deleted". Deleted items play the exit animation. When 5 or more nodes are deleted at once a toast "Deleted <n> nodes" with "Undo" is shown for 8 s. Nodes that become invalid because an input lost its edge show the `invalid` state immediately. [NEW]

#### Scenario: Node deletion removes its edges
- **WHEN** the user deletes a node with 2 incoming and 1 outgoing edge
- **THEN** the node and the 3 edges are removed and one undo restores all four

#### Scenario: Delete and reconnect
- **WHEN** the user invokes `canvas.delete-reconnect` on a node between A and B whose ports are compatible
- **THEN** the node is removed and an edge A → B is created in the same batch

#### Scenario: Trigger in the selection
- **WHEN** the selection contains the trigger and two other nodes and the user presses Delete
- **THEN** the two nodes are deleted, the trigger stays, and the toast "The trigger cannot be deleted" is shown

### Requirement: Align and distribute commands
On an editable canvas the canvas SHALL provide, for a selection of 2 or more nodes, groups or notes: align left, align horizontal centre, align right, align top, align vertical middle and align bottom, each relative to the selection's bounding box; and, for 3 or more, distribute horizontally and distribute vertically, which keep the two outermost items fixed and make the gaps between consecutive bounding boxes as equal as the 20-unit grid allows (gaps differ by at most 20 units, larger gaps first). Every resulting position lies on the grid. Each command is one batch and one undo step, animates the moved items in 160 ms with the enter easing, re-routes computed edges afterwards, and sends no batch when nothing moves. The commands are in the toolbar menu, the node context menu and the action registry. [NEW]

#### Scenario: Align left
- **WHEN** three nodes with left edges at x = 100, 140 and 180 are selected and the user invokes align left
- **THEN** all three have their left edge at x = 100 and one undo restores the previous positions

#### Scenario: Distribute horizontally
- **WHEN** three 220-wide nodes at x = 0, 300 and 1,000 are distributed horizontally
- **THEN** the middle node moves to x = 500 so both gaps are 280 units

#### Scenario: Already aligned
- **WHEN** align top is invoked on nodes that already share the same top
- **THEN** nothing moves and no undo step is recorded

### Requirement: Auto-layout
`canvas.auto-layout` SHALL arrange the selected nodes when 2 or more are selected, and otherwise the whole graph, using the layered left-to-right layout of `agent-workflows.Deterministic auto-layout` (the pure function in `packages/workflow`, run on the device; 300-unit layer pitch, 140-unit row pitch, 20-unit grid, groups re-framed around their members, routes reset) and applying its result as one `layout.apply` batch — one undo step. The canvas owns the presentation: nodes move to their new positions over `wf/motion/layout` (320 ms) with the enter easing while edges follow as direct paths and cross-fade to their routed paths in 120 ms at the end; notes keep their offset from the node whose centre was nearest before the layout, in the same batch; after a whole-graph layout the viewport animates to fit when any node ended outside it and the document's `viewport` is updated in the same batch. When the function returns the current positions no batch is sent and no undo step is recorded. Because routes are reset by the layout, the canvas asks for confirmation ("Auto-layout resets <n> custom edge routes") when any affected edge has waypoints or a non-default style. The time from invoking the action to the first animation frame is at most 150 ms on the desktop reference device and 400 ms on the mobile reference devices for 200 nodes and 400 edges. Nodes added without a position arrive already placed by the host under the same requirement. [NEW]

#### Scenario: Idempotent
- **WHEN** the user runs auto-layout twice in a row
- **THEN** the second run moves nothing, sends no batch and records no undo step

#### Scenario: Layer pitch
- **WHEN** a chain of three nodes is auto-laid out with the first at x = 0
- **THEN** their left edges are at x = 0, 300 and 600 and the transition takes 320 ms

#### Scenario: Selection only
- **WHEN** 5 of 40 nodes are selected and auto-layout runs
- **THEN** only the 5 selected nodes move

#### Scenario: Custom routes
- **WHEN** auto-layout is invoked while 3 edges have waypoints
- **THEN** a confirmation states that 3 custom edge routes will be reset, and cancelling changes nothing

### Requirement: Context menus
The canvas SHALL open a context menu (`design-system.Popover, dropdown menu and context menu`; a bottom sheet on compact) on right-click, the Menu key or Shift+F10 on the focused item, and long-press on touch, with these items:
- **Canvas**: Add node…, Add note, Add group, Paste, Select all, Auto-layout, Collapse all, Expand all, Zoom to fit, Grid ▸ (Dots, Lines, None), Alignment guides, Export ▸.
- **Node**: Open details, Rename, Duplicate, Copy, Cut, Delete, Delete and reconnect, Collapse or Expand, Disable or Enable, Group selection, Align ▸ and Distribute ▸ (multi-selection), Copy node ID; with a run loaded additionally the actions of "Run actions on the canvas".
- **Edge**: Insert node…, Edit label, Route style ▸ (Curved, Orthogonal, Straight), Reset route, Go to source, Go to target, Delete.
- **Group**: Rename, Colour ▸ (8 swatches), Collapse or Expand, Select contents, Auto-layout contents, Ungroup, Delete with contents.
- **Note**: Edit, Duplicate, Delete.
Right-clicking an unselected item selects it first; right-clicking a member of a multi-selection keeps the selection. Items that the current mode or role does not permit are not rendered; items that are permitted but currently inapplicable are disabled. Each item shows its current key binding. Destructive items use `danger` text. [NEW]

#### Scenario: Node menu in run mode for a viewer
- **WHEN** a `viewer` device opens the context menu of a failed node in `run` mode
- **THEN** the menu contains Open details, Collapse or Expand and Copy node ID, and contains no editing or run action

#### Scenario: Right-click keeps a multi-selection
- **WHEN** four nodes are selected and the user right-clicks one of them
- **THEN** all four stay selected and the menu offers Align ▸ and Distribute ▸

#### Scenario: Group colour
- **WHEN** the user chooses the third swatch in Colour ▸ of a group
- **THEN** the group's `colorIndex` is 3, it is drawn with `wf/group/3`, and one undo restores the previous colour

### Requirement: Undo and redo
The canvas SHALL expose the per-device, per-workflow undo history of `agent-workflows.Editing semantics for the canvas` (100 steps, inverse batches against the head), shared by the canvas, the outline view and the configuration panel. Viewport, selection, node collapse, palette and panel state are not steps. One gesture is one batch and one step: a drag, a resize, a paste, an auto-layout, an accepted proposal; consecutive nudges of the same selection within 500 ms are merged, and text edits are submitted 800 ms after the last change as one step. Undo and redo are invoked through the history actions of `keyboard-shortcuts.Default bindings for editing and history`, the toolbar buttons and the outline view; menu entries name the step ("Undo Move 3 nodes"). An undo shows its effect within 50 ms, restores the selection of that moment, animates moved items in 160 ms, and reveals the affected items when they are outside the viewport. Batches applied by other devices or by agents are rendered as they arrive and never enter this device's history. An undo refused with `WORKFLOW_UNDO_CONFLICT` is removed from the stack with the toast "This change can no longer be undone", and the remaining steps stay available. The history is not persisted across closing the workflow, and a new change after an undo discards the redo stack. [NEW]

#### Scenario: One step per drag
- **WHEN** the user drags five selected nodes and releases
- **THEN** exactly one undo step exists and undoing it returns all five to their previous positions as one new revision

#### Scenario: History limit
- **WHEN** the user performs 101 separate changes
- **THEN** 100 undo steps are available and the first change cannot be undone

#### Scenario: Undo conflict
- **WHEN** the user undoes a change to a node that an agent has since removed
- **THEN** that step is removed from the stack, the toast "This change can no longer be undone" is shown, and the next undo applies the step before it

### Requirement: Canvas keyboard shortcuts
The canvas SHALL register the following action ids in `keyboard-shortcuts.Action registry` under a context `canvas` and category `workflow`. This requirement lists action ids only: every default binding — exactly one per action id — is stated in `keyboard-shortcuts.Default bindings for the workflow canvas` and nowhere in this specification, and tooltips, context menus and the cheat sheet (`keyboard-shortcuts.Shortcut cheat-sheet dialog`) read the active binding through `keyboard-shortcuts.Active binding lookup`. The `canvas` context is active while keyboard focus is inside a canvas scene or its toolbar and no text field has focus, and takes precedence over the `editor`, `session`, `list` and `global` contexts (`keyboard-shortcuts.Shortcut contexts and precedence`). All bindings are rebindable. Undo and redo reuse the existing history actions and add no canvas action id.

| Group | Action ids |
|---|---|
| Tools | `canvas.tool-select`, `canvas.tool-hand` |
| Selection | `canvas.select-all`, `canvas.clear-selection`, `canvas.extend-selection-left`, `canvas.extend-selection-right`, `canvas.extend-selection-up`, `canvas.extend-selection-down` |
| Clipboard and deletion | `canvas.delete`, `canvas.delete-reconnect`, `canvas.duplicate`, `canvas.copy`, `canvas.cut`, `canvas.paste`, `canvas.copy-image` |
| Structure | `canvas.group`, `canvas.ungroup`, `canvas.add-note`, `canvas.add-group`, `canvas.quick-add`, `canvas.toggle-palette` |
| Node | `canvas.rename`, `canvas.open-details`, `canvas.toggle-collapse`, `canvas.toggle-enabled` |
| View | `canvas.zoom-in`, `canvas.zoom-out`, `canvas.zoom-100`, `canvas.zoom-fit`, `canvas.zoom-selection`, `canvas.toggle-minimap`, `canvas.toggle-grid`, `canvas.toggle-guides`, `canvas.toggle-outline`, `canvas.find`, `canvas.next-match`, `canvas.previous-match` |
| Arrange | `canvas.auto-layout`, `canvas.align-left`, `canvas.align-right`, `canvas.align-top`, `canvas.align-bottom`, `canvas.align-center`, `canvas.align-middle`, `canvas.distribute-horizontal`, `canvas.distribute-vertical` |
| Nudge (20 units) | `canvas.nudge-left`, `canvas.nudge-right`, `canvas.nudge-up`, `canvas.nudge-down` |
| Nudge (100 units) | `canvas.nudge-far-left`, `canvas.nudge-far-right`, `canvas.nudge-far-up`, `canvas.nudge-far-down` |
| Focus | `canvas.focus-left`, `canvas.focus-right`, `canvas.focus-up`, `canvas.focus-down`, `canvas.focus-downstream`, `canvas.focus-upstream`, `canvas.focus-first`, `canvas.focus-last`, `canvas.focus-inputs`, `canvas.focus-outputs` |
| Connect | `canvas.connect`, `canvas.connect-to` |
| Run | `canvas.toggle-follow`, `canvas.replay-toggle`, `canvas.replay-step-back`, `canvas.replay-step-forward` |
| Diff | `canvas.diff-next`, `canvas.diff-previous` |

The table holds 72 action ids. `canvas.rename` (inline rename of the focused item) and `canvas.open-details` (open the detail panel) are two separate actions and MUST have two different default bindings. The momentary hand tool while a key is held is a pointer modifier defined in "Pan and zoom input", not an action id. Actions that change the document are disabled (`isEnabled` false) on a canvas that is not editable (see "Canvas modes"). The bindings are active on desktop and web and on phones and tablets with a hardware keyboard (`keyboard-shortcuts.Platform coverage of shortcuts`). [NEW]

#### Scenario: Canvas context wins
- **WHEN** the canvas inside a session workspace has focus and the user presses the binding of `canvas.find`, which the chat find action also uses
- **THEN** the canvas find bar opens and the chat find bar does not

#### Scenario: Disabled in a run view
- **WHEN** a canvas in `run` mode has focus and the user presses the binding of `canvas.delete`
- **THEN** nothing is deleted and no error is shown

#### Scenario: Rebinding is reflected
- **WHEN** the user rebinds `canvas.auto-layout`
- **THEN** the toolbar tooltip and the context menu show the new binding and the old one no longer runs the action

#### Scenario: One binding per action
- **WHEN** the default preset is loaded
- **THEN** each of the 72 `canvas.*` action ids has exactly one default binding, no two of them share a binding within the `canvas` context, and `canvas.rename` and `canvas.open-details` have different bindings

### Requirement: Touch gestures
On touch input the canvas SHALL use these gestures (all targets at least 44 × 44 px):
- **Tap** an item: select it and open the node inspector as a bottom sheet at its 50 % snap point (draggable to full height; in landscape with a viewport height below 480 px it is a 320 px right panel instead). Tap empty canvas: clear the selection and close the sheet.
- **One-finger drag** on empty canvas pans; **two-finger drag** pans and **pinch** zooms about the midpoint, in every mode; **double-tap** on empty canvas toggles between fit and 100 %.
- **Long-press** (300 ms, movement under 8 px) on a node, group or note lifts it with a light haptic; moving then drags the selection with the snapping of "Drag and drop with snapping and alignment guides" (tolerance 12 px, a light haptic on each new snap, at most one per 100 ms); releasing without having moved opens the item's context menu as a bottom sheet. Long-press on an edge or on empty canvas opens its context menu.
- **Tap-to-connect**: tapping a port arms it (the port pulses and a banner reads "Tap a highlighted port to connect" with "Cancel"); compatible ports are highlighted and the rest dimmed as in "Connecting ports by dragging"; tapping a compatible port creates the edge; tapping empty canvas opens the quick-add sheet for that position; "Cancel", the back gesture or 30 s without input disarms. Dragging from a port after a 150 ms press also connects.
- **Add**: a floating "+" button (56 × 56 px, bottom-right, 16 px above the safe area and above any docked sheet) opens the palette sheet; choosing an entry places it at the viewport centre.
- **Multi-select**: a "Select" toggle in the toolbar turns one-finger drag into a marquee and taps into toggles; a bar then shows the count with Group, Duplicate, Align and Delete.
- Undo and redo are toolbar buttons.
Gestures that change the document are available only on an editable canvas. A second finger landing during a node drag cancels the drag and starts a pan/zoom. Every touch that lands on the scene is recognised by the canvas itself and not by the app's gesture layer, so the gestures above behave the same in every host ("Runtime hosting on each platform"); the haptics named here are requested by the canvas and played by the app. [NEW]

#### Scenario: Long-press and drag
- **WHEN** the user presses a node for 300 ms and then moves 120 px
- **THEN** a haptic fires at lift, the node follows the finger and its new position is one undo step

#### Scenario: Long-press without moving
- **WHEN** the user presses a node for 300 ms and lifts without moving
- **THEN** the node's context menu opens as a bottom sheet

#### Scenario: Tap-to-connect
- **WHEN** the user taps an output port and then taps a highlighted input port
- **THEN** an edge is created between them and the banner disappears

#### Scenario: Second finger cancels a drag
- **WHEN** a second finger touches the canvas while a node is being dragged
- **THEN** the node returns to its start position and the two fingers pan and zoom the viewport

#### Scenario: Pinch stays in the canvas
- **WHEN** the user pinches on the scene while the canvas is hosted in a scrolling screen
- **THEN** the canvas zooms about the pinch midpoint and the surrounding screen neither scrolls nor zooms

### Requirement: Dropping entities from outside the canvas
In `edit` mode on desktop and web the canvas SHALL accept drags that start outside it — from the sidebar lists, the Projects, Library and Workflows screens, the session Assets and Files tabs and chat attachment chips — carrying `application/vnd.jagentchill.entity+json` `{kind, id, hostId}`, and create the matching node at the drop position as one undo step: a project creates an `editor` node bound to that project; a script creates a `script` node bound to that script; an agent persona creates an `agent` node with that persona; a team creates a `team` node; a workflow creates a `subworkflow` node referencing it (refused with a tooltip when it is the open workflow or would create a reference cycle, as reported by `canApply`); a media asset dropped on a node's compatible input port (`ImageRef`, `VideoRef`, `AudioRef`, `MediaRef` or `FileRef` per `agent-workflows.Ports and data types`) sets that input's default to the asset, and dropped on empty canvas opens the quick-add menu at the drop point filtered to node types that have such an input, creating the chosen node with the asset set as that input's default. Files dragged from the operating system are first imported through `media-library` (import rules and limits are owned there) and then handled as media assets. While such a drag is over the canvas, a ghost of the resulting node follows the pointer and ports that accept the entity show the drop-target state; an entity that matches nothing shows the `not-allowed` cursor and a tooltip "This item cannot be added to a workflow". Entities from a different host than the workflow's are refused with "This item belongs to another host". On touch devices, where cross-view dragging is not available, the same result is reached by "Add to workflow…" in the entity's own menu, which places the node at the viewport centre of the chosen workflow. [NEW]

#### Scenario: Drop a project
- **WHEN** the user drags a project from the sidebar onto empty canvas
- **THEN** an `editor` node bound to that project is created at the drop point and selected

#### Scenario: Drop an image on a port
- **WHEN** the user drags an image asset onto a generate node's image-reference input
- **THEN** the input's default is that asset, the port is drawn filled, and one undo clears it

#### Scenario: Entity from another host
- **WHEN** the user drags a script that belongs to host B onto a workflow of host A
- **THEN** the cursor is `not-allowed`, the tooltip states the reason and nothing is created

### Requirement: Find on canvas
`canvas.find` SHALL open a find bar (280 px, top-right of the canvas; a full-width bar under the toolbar on compact) that searches node titles, type names, node ids, group labels, note text and edge labels case- and diacritic-insensitively as the user types, within 30 ms for 500 nodes. The bar shows "<i> of <n>"; Enter and Shift+Enter move to the next and previous match in reading order (left to right, then top to bottom) using the Reveal command, and the current match shows a 2 px `preview/guide` ring. While a query is active, non-matching nodes are drawn at 35 % opacity. Escape closes the bar, restores opacity and leaves focus on the last match. With no match the bar shows "No matches" and nothing is dimmed. Find is available in every mode except `miniature`. [NEW]

#### Scenario: Find and step
- **WHEN** the user types "voice" and three nodes match
- **THEN** the bar shows "1 of 3", the first match is revealed with a ring, and Enter moves to the second

#### Scenario: No match
- **WHEN** the query matches nothing
- **THEN** the bar shows "No matches" and no node is dimmed

### Requirement: Animation clock and motion rules
All canvas animation SHALL be driven by one time-based clock per canvas instance, so that the state of an animation depends only on elapsed time: after the application's script has been busy for 200 ms, the next presented frame shows every running animation at its time-correct position with no catch-up playback, and on phones and tablets the canvas runs in its own WebView process, so canvas animation does not wait for the application's script: while application code is busy for up to 200 ms, canvas animation frames continue within the frame budget that spike S19 measured for that target (how the renderer achieves this belongs to "Animation implementation in the renderer"). These are measured targets of the benchmark gate, stated per target runtime, not a promise for hardware below the reference devices. Rules that apply to every animation in this specification: durations and easings come from tokens (`motion/fast` 120 ms, `motion/base` 160 ms, `motion/slow` 240 ms, `wf/motion/layout` 320 ms, `wf/motion/camera` 400 ms, `wf/motion/pulse` 1,600 ms; enter easing `cubic-bezier(0.2, 0, 0, 1)`, exit easing `cubic-bezier(0.4, 0, 1, 1)`, `wf/ease/in-out`, and linear); no animation overshoots, bounces or springs past its end value; nothing flashes more than 3 times per second; an animation interrupted by a new target starts from its current value. The clock stops — and the canvas requests no frames — while the canvas is not visible (browser tab hidden, app in the background, another workspace tab selected, the chat widget scrolled out of view) and while nothing is animating and no gesture is active; on becoming visible the scene is drawn directly in its current state with no catch-up playback. At most 40 edges and 24 nodes animate continuously at once; beyond those caps the surplus items show the static style defined for reduced motion. In test builds the clock can be frozen and set to a given time through the test bridge. [NEW]

#### Scenario: Idle canvas draws nothing
- **WHEN** a canvas showing a design with no run has received no input for 2 s
- **THEN** the test bridge reports zero frames rendered during the following 5 s

#### Scenario: Hidden tab
- **WHEN** a run is animating and the browser tab becomes hidden
- **THEN** no animation frame is requested until the tab is visible again, at which point the current run state is drawn at once

#### Scenario: Application script stalls
- **WHEN** application script is busy for 200 ms while a running-node pulse is animating
- **THEN** the first frame presented afterwards shows the pulse at the position defined for the elapsed time, and no skipped portion is replayed

#### Scenario: Continuous animation cap
- **WHEN** 60 edges are `flowing` at the same time
- **THEN** 40 of them (those nearest the viewport centre) show the flow animation and the other 20 the static flowing style

### Requirement: Editing animations
Editing interactions SHALL animate as follows.

| Animation | Trigger | Motion | Duration and easing |
|---|---|---|---|
| Node enter | node, group or note created by the user, pasted or restored by undo | opacity 0 → 1 and scale 0.96 → 1 about the centre | 160 ms, enter easing |
| Node exit | item deleted or removed by undo | opacity → 0 and scale → 0.96; attached edges fade out | 120 ms, exit easing |
| Lift | drag starts | scale 1 → 1.02, `elevation/1` → `elevation/3`, opacity → 96 % | 120 ms, enter easing |
| Drag follow | pointer moves during a drag | item position equals pointer position plus the grab offset, with no smoothing or lag | every frame |
| Drag inertia | drag released above 300 px/s | the item continues along the release direction for `min(velocity × 0.08 s, 48 px)` | 180 ms, enter easing (decelerating) |
| Settle | after release (and after inertia) | the item moves to its snapped position while scale, elevation and opacity return to rest | 120 ms, enter easing |
| Snap feedback | a snap engages or releases | the guide or spacing hint appears at once and fades out when released | 0 ms in, 120 ms out |
| Edge draw-on | an edge is created | the stroke is revealed from source to target; the arrowhead fades in during the last 80 ms; a ring on the target port grows from 10 to 20 px while fading from 60 % to 0 % | 240 ms, enter easing |
| Edge exit | an edge is deleted | opacity → 0 | 120 ms, exit easing |
| Edge retract | a connection drag is cancelled or dropped on an invalid target | the preview shortens back to its origin port | 160 ms, exit easing |
| Re-route | edges re-routed after a drop | cross-fade from the old path to the new path | 120 ms, linear |
| Auto-layout | auto-layout, align, distribute, undo or redo of a move | items interpolate from old to new positions; edges follow as direct paths | `wf/motion/layout` for auto-layout, 160 ms for the others, enter easing |
| Selection ring | item selected or deselected | ring opacity 0 ↔ 1 while its offset grows 0 → 2 px | 120 ms, enter easing |
| Focus ring | keyboard focus moves | appears with no animation | 0 ms |
| Hover | pointer enters or leaves | border, port size and controls change | 120 ms, linear |
| Collapse and expand | node collapsed or expanded | height and port positions interpolate; hidden parts fade | 160 ms, enter easing |
| Level-of-detail change | zoom crosses a boundary | cross-fade between levels | 120 ms, linear |

An item released while it is still lifting completes the settle from its current values. Inertia never carries an item outside the viewport and never occurs when the release velocity is below 300 px/s. [NEW]

#### Scenario: Node enter
- **WHEN** the user adds a node from the palette
- **THEN** it fades from 0 to full opacity and scales from 0.96 to 1 in 160 ms

#### Scenario: Inertia and settle
- **WHEN** a node is released at 600 px/s
- **THEN** it travels a further 48 px in 180 ms, then moves to the nearest grid position in 120 ms, ending at rest elevation with no overshoot

#### Scenario: Slow release
- **WHEN** a node is released at 100 px/s
- **THEN** there is no inertia and the node settles to its snapped position in 120 ms

#### Scenario: Edge draw-on
- **WHEN** a connection is completed
- **THEN** the edge is revealed from its source to its target in 240 ms and the target port shows one expanding ring

### Requirement: Run-state animations
With a run loaded the canvas SHALL animate node state as follows.

| Animation | Trigger | Motion | Duration and easing |
|---|---|---|---|
| Running pulse | node is `running` | a glow outside the node border in `accent`, spreading 0 → 8 px while its opacity goes 35 % → 0 % | loop of `wf/motion/pulse` (1,600 ms), `wf/ease/in-out` |
| Progress ring, determinate | `progress` changes | the 16 px ring (2 px stroke, `accent` on an `accent/subtle` track) and the header progress bar sweep to the new value | 240 ms, linear |
| Progress ring, indeterminate | `running` with unknown progress | a 270° arc rotates; the header bar shows a 30 %-wide segment travelling left to right | 1,000 ms per turn, linear; bar loop 1,200 ms |
| Approval pulse | node is `waiting_approval` | border opacity 100 % ↔ 55 % | loop of 2,000 ms, `wf/ease/in-out` |
| State change | a node's status changes | border colour and header tint cross-fade; the old glyph scales 1 → 0.6 and fades out, then the new glyph scales 0.6 → 1 and fades in; the footer text cross-fades | 240 ms in total (120 ms out, 120 ms in), enter easing |
| Success feedback | node becomes `succeeded` | the check glyph is drawn on stroke by stroke, and one ring in `success` expands 0 → 12 px outside the node while fading 50 % → 0 % | glyph 240 ms, ring 400 ms, enter easing |
| Failure feedback | node becomes `failed` | the border opacity dips 100 % → 40 % → 100 % once and the header tint `danger/subtle` fades in | dip 400 ms, tint 240 ms, `wf/ease/in-out` |
| Counter change | a fan-out counter or cost value changes | the old value fades out and the new one fades in, with no movement | 120 ms, linear |
| Thumbnail arrival | an output thumbnail finishes loading | cross-fade from the type icon | 160 ms, linear |

On touch devices one success haptic is played when a run reaches `succeeded` and one error haptic when it reaches `failed`, only while the canvas is visible; no haptic is played per node. State changes that arrive while the canvas is not visible are not replayed when it becomes visible. [NEW]

#### Scenario: Status change to succeeded
- **WHEN** a running node becomes `succeeded`
- **THEN** the pulse stops, the border cross-fades to 1 px `success` within 240 ms, the check glyph is drawn on in 240 ms and one success ring expands and fades in 400 ms

#### Scenario: Determinate progress
- **WHEN** progress changes from 0.35 to 0.60
- **THEN** the ring and the header bar sweep from 35 % to 60 % in 240 ms and the footer reads "Running 60 %"

#### Scenario: Failure
- **WHEN** a node becomes `failed`
- **THEN** its border becomes 2 px `danger`, dips in opacity once over 400 ms and the header shows the `danger/subtle` tint; the node does not move

### Requirement: Edge flow animation
With a run loaded each edge SHALL be drawn in the state reported by `agent-workflows.Live run events`:

| Edge state | Rendering |
|---|---|
| `idle` | `wf/edge-idle`, solid |
| `flowing` | 2 units, `accent`, with dashes 8 units long and 8 apart moving from source to target |
| `delivered` | `success`, solid |
| `error` | `danger`, solid |
| `skipped` | `wf/edge-idle` at 40 % opacity, dotted 2/4 |

The dash speed of a `flowing` edge is tied to activity: `clamp(48 + 24 × r, 48, 192)` units per second, where `r` is the number of items per second carried by that edge's `edge.pulse` events over the last 5 s. Each `edge.pulse` event sends one particle — a 6-unit dot in the edge's colour, 8 units when `items` > 1 — from source to target in 600 ms with linear timing; pulses arriving while a particle is travelling on the same edge are merged into the next particle, so at most one particle starts per edge per 600 ms. Changes of edge state cross-fade in 240 ms. The caps and visibility rules of "Animation clock and motion rules" apply. [NEW]

#### Scenario: Flowing edge
- **WHEN** the edge from `script` to `shot_list` is reported `flowing`
- **THEN** it is `accent` with dashes moving towards `shot_list` at 48 units per second

#### Scenario: Speed follows throughput
- **WHEN** pulses carrying 10 items in total arrived on a flowing edge during the last 5 s
- **THEN** its dashes move at 96 units per second

#### Scenario: Pulse
- **WHEN** an `edge.pulse` event arrives for an edge
- **THEN** one particle travels that edge from source to target in 600 ms

#### Scenario: Skipped path
- **WHEN** a branch resolves and the edge of its untaken case is reported `skipped`
- **THEN** that edge is dotted at 40 % opacity

### Requirement: Camera follow
The canvas SHALL offer a Follow mode that keeps the active part of a run in view. Follow is on by default when a run that is `running` or `waiting_approval` is opened and when an agent is building the graph, and off otherwise; it is toggled by a toolbar chip and `canvas.toggle-follow`. While Follow is on, when a node becomes `running` or `waiting_approval` the viewport moves, over `wf/motion/camera` (400 ms) with `wf/ease/in-out`, as follows: with one active node, that node is centred and zoom is unchanged unless it is below 50 % (then raised to 100 %); with several active nodes, their bounding box is fitted with 64 px padding at a zoom clamped to 50 %–100 %, and when it does not fit at 50 % the most recently started node is centred instead. A move is skipped when every active node is already fully inside the viewport with a 32 px margin. Camera moves are coalesced to at most one per 1,200 ms, each targeting the latest state. Any manual pan, zoom, minimap interaction or node drag turns Follow off immediately and cancels a camera move in progress within one frame; the chip then reads "Follow" unselected and re-enabling it moves to the current active nodes at once. Selecting a node, opening the detail panel or collapsing a node does not turn Follow off. When the run ends Follow stays on and the viewport stays where it is. [NEW]

#### Scenario: Follow the active node
- **WHEN** Follow is on and `voiceover` becomes `running` outside the viewport
- **THEN** the viewport moves over 400 ms so that `voiceover` is centred

#### Scenario: User override
- **WHEN** the user pans during a camera move
- **THEN** the move stops within one frame, Follow turns off and the chip is shown unselected

#### Scenario: Already visible
- **WHEN** the next active node is fully inside the viewport with more than 32 px of margin
- **THEN** the viewport does not move

#### Scenario: Several active nodes
- **WHEN** three fan-out branches are running at once and their bounding box fits at 70 % zoom
- **THEN** the viewport fits the three nodes with 64 px padding at 70 %

### Requirement: Run replay scrubber
For a run in a terminal state (`succeeded`, `failed` or `cancelled`) the canvas SHALL offer "Replay", which plays the run back on the canvas from `agent-workflows.Replayable run timeline` (`jagentchill.workflow.run.timeline`) applied to the run's starting snapshot, without executing or charging anything. Replay shows a 44 px bar at the bottom of the canvas (above the safe area) with: play/pause, step to previous and next entry, a speed menu with exactly 1×, 2×, 4×, 8× and 16× (default 4×), a time label "m:ss / m:ss", a scrub track with `danger` ticks at failures, `warning` ticks at waits for a person and `purple` ticks at amendments, a "Skip idle time" toggle (default on: any span longer than 5 s with no entry is played in 1 s), and "Exit replay". During replay every node, edge, counter, cost and thumbnail shows its state at the replay time, and the graph itself is shown as it was before each amendment, with amended nodes and edges arriving with their enter animations; the animations of "Run-state animations" and "Edge flow animation" play with their durations divided by the speed (never below 40 ms), and the edge flow animation is replaced by the static flowing style at 16×; Follow is on by default; the detail panel shows the selected node's data up to the replay time; every action that changes the run or the document is disabled. Dragging the scrub handle shows the state at the handle's time, reconstructed within 100 ms for timelines of up to 10,000 entries (the canvas keeps a state snapshot every 500 entries); the timeline is fetched in pages of 2,000 entries, and a progress indicator on the track shows how much is loaded. Reaching the end pauses on the final state, which equals the state returned by `jagentchill.workflow.run.get`. Replay position is device-local. [NEW]

#### Scenario: Replay at 8×
- **WHEN** the user replays a run that lasted 4 minutes of activity at 8×
- **THEN** the replay takes 30 s of playback, nodes change state in the recorded order and the time label advances to "4:00"

#### Scenario: Scrub
- **WHEN** the user drags the scrub handle to 1:30 of a 3:00 run with 600 timeline entries
- **THEN** within 100 ms every node shows the status, progress and cost it had at 1:30

#### Scenario: Nothing is executed
- **WHEN** a replay plays to the end
- **THEN** no job is created, the run's cost is unchanged and node actions were disabled throughout

#### Scenario: Idle time skipped
- **WHEN** the run waited 12 minutes for an approval and "Skip idle time" is on
- **THEN** that wait is played in 1 s and marked by a `warning` tick on the track

#### Scenario: Amended run
- **WHEN** a run that was amended once at 2:10 is replayed from the start
- **THEN** the nodes added by the amendment are absent until 2:10 and then appear with the node-enter animation

### Requirement: Agent build choreography
When an agent authors or modifies a workflow through `agent-workflows.Workflow authoring tools`, the canvas SHALL show the graph being built. Between the `jagentchill.workflow.build` events `started` and `finished` of `agent-workflows.Document operation stream`, every operation of every `jagentchill.workflow.ops` event whose actor is an agent is queued and played in order, one visible step per operation: `node.add` with the node-enter animation, `edge.add` with the draw-on animation, `node.update` and `edge.update` with the state-change cross-fade, `node.move` and `layout.apply` with the move transition, removals with the exit animation; operations that draw nothing (`param.set`, `var.set`, `output.set`, `settings.update`, `meta.update`, `viewport.set`) take no time. Pacing: each step lasts 240 ms followed by an 80 ms gap (3.1 operations per second) while the queue holds 12 or fewer operations; while it holds more, step and gap durations are divided by `min(8, queueLength ÷ 12)`; when the queue exceeds 60 operations, or the projected time to drain it exceeds 5 s, all queued operations are shown at once — nodes fade in together in 160 ms, then edges in 160 ms — and stepwise playback resumes for operations that arrive afterwards. While a build is in progress or the queue is not empty a chip shows "Agent is building… <n> steps" with a "Skip to end" button that shows the stored document at once, and Follow is on, fitting the bounding box of everything built so far (zoom clamped to 50 %–100 %, at most one camera move per 600 ms). The user can edit while the agent builds (`agent-workflows.Agent-authored workflows from intent`): the first document-changing gesture during playback first shows every queued operation at once, so the user always edits the stored document, and agent operations that arrive afterwards continue to play. Playback is presentation only: the document already contains every queued operation, so closing the canvas, skipping or reconnecting never loses or reorders changes, a revision gap replaces the queue with the fetched document, and a canvas opened after `finished` shows the final graph without playback. When the build ends with `valid: false` the issues are shown on the nodes at once. Amendments made by an agent to a run in progress (`agent-workflows.Amending a running workflow`) are played the same way in the run view. The same choreography plays in the chat widget of "Inline widget in chat". Both agent classes of design D25 are presented the same way. [NEW]

#### Scenario: Steady pacing
- **WHEN** an agent applies 9 single-operation batches one per second
- **THEN** each node or edge appears with its 240 ms animation as its operation arrives

#### Scenario: Burst is sped up
- **WHEN** one batch of 36 operations arrives
- **THEN** playback runs with durations divided by 3 and slows back to normal as the queue falls to 12

#### Scenario: Very large burst
- **WHEN** 120 operations arrive within 1 s
- **THEN** all nodes fade in together in 160 ms, then all edges in 160 ms

#### Scenario: Skip to end
- **WHEN** the user presses "Skip to end" with 20 operations queued
- **THEN** the canvas shows the stored document at once and the chip disappears when the `finished` event arrives

#### Scenario: User edits during the build
- **WHEN** 15 operations are queued and the user starts dragging a node
- **THEN** the 15 queued operations are shown at once before the drag begins, and the drag is applied as its own batch

#### Scenario: A person edits while the agent builds
- **WHEN** the user renames a node during playback of an agent build that commits three batches per second
- **THEN** the queued operations are shown at once, the rename is submitted and applied by rebase although newer agent revisions exist, and no "Reload" notice appears because the agent did not change that node

### Requirement: Reduced-motion equivalents
When the OS reduce-motion setting or the app preference of `i18n-accessibility.Reduced motion and flashing` is on, the canvas SHALL replace every animation with the following non-animated equivalent; no translation, scale, pulse, travelling dash or camera glide remains, and the only permitted transition is an opacity change of at most 120 ms.

| Animation | Reduced-motion equivalent |
|---|---|
| Node enter, node exit, edge exit | opacity fade of 120 ms, no scale |
| Lift | elevation changes at once, no scale |
| Drag follow | unchanged (direct manipulation) |
| Drag inertia, settle | none; the item is placed at its snapped position on release |
| Snap feedback | unchanged (guides appear and disappear at once) |
| Edge draw-on, edge retract | the edge appears or disappears with a 120 ms fade |
| Re-route, level-of-detail change | instant swap |
| Auto-layout, align, distribute, undo and redo moves | items jump to their new positions |
| Selection ring, hover, collapse and expand | instant |
| Viewport commands, minimap navigation, stepped zoom | the viewport changes instantly |
| Pan inertia | none |
| Running pulse | a static 3 px halo in `accent/subtle` outside the 2 px `accent` border |
| Progress ring, determinate | the ring and bar show the new value at once |
| Progress ring, indeterminate | a static `loader` glyph and the footer text "Running"; the header bar is a static full-width `accent/subtle` bar |
| Approval pulse | static 2 px `warning/text` border |
| State change, counter change, thumbnail arrival | instant swap with a 120 ms opacity fade |
| Success and failure feedback | the final style appears at once; no ring, no dip |
| Edge flow | a static 2-unit `accent` stroke with no moving dashes; no particle (the edge shows its next state at once) |
| Camera follow | the viewport jumps to the target, at most once per 1,200 ms |
| Run replay | states change instantly at the recorded times; the scrub handle still advances |
| Agent build choreography | queued operations are applied in batches at most 10 times per second with a 120 ms fade; "Skip to end" remains |

Haptics follow the OS haptics setting, not the motion setting. The preference takes effect on the next frame, without reloading the canvas. [NEW]

#### Scenario: Running node under reduced motion
- **WHEN** reduce motion is on and a node is `running` with unknown progress
- **THEN** the node shows a static halo, a static `loader` glyph and "Running", and nothing on it moves

#### Scenario: Auto-layout under reduced motion
- **WHEN** reduce motion is on and the user runs auto-layout
- **THEN** nodes appear at their new positions in the next frame

#### Scenario: Flowing edge under reduced motion
- **WHEN** reduce motion is on and an edge is `flowing`
- **THEN** it is a static 2-unit `accent` stroke and no particle is drawn when a pulse arrives

### Requirement: Run overlay rendering and live updates
The canvas SHALL render run state as an overlay on the run's snapshot document (`agent-workflows.Versioning`), obtained with `jagentchill.workflow.run.get` (run record, edge states and one aggregate per node; individual executions are paged with `jagentchill.workflow.run.executions` only when the detail panel needs them) and kept current by the `jagentchill.workflow.updated` events of `agent-workflows.Live run events` on the stream `workflow.run:<runId>`; it requires a connected host and scope `jagentchill.projects.read`. It consumes the change kinds `run.status`, `node.status`, `node.progress`, `edge.state`, `edge.pulse`, `cost`, `approval` and `amended`, and from each execution (addressed by `nodeId` and `path`) uses `status`, `blockedBy`, `retryPending`, `waitingReason`, `reason`, `progress`, `attempt`, `costUsd`, `estimateUsd`, `route`, `cacheHit`, `started_ms`, `finished_ms`, `error` and `counts`. The canvas MUST show a change within 250 ms of its arrival, MUST fetch the run snapshot and replace its own state on a `seq` gap or after a reconnect (events are not replayed), MUST discard events for a run other than the one displayed, and on `amended` MUST fetch the amended snapshot and present its new operations as in "Agent build choreography". While the connection is down, timers and continuous animations are frozen and run actions are disabled; in hosts that do not show the reconnect banner of `agent-workflows.Run view`, the canvas shows a `warning` banner "Reconnecting… showing last known state" until the snapshot is fetched again. A `run.status` change to `paused` is drawn from its `pauseReason` (`agent-workflows.Run state machine`): in hosts that do not show the banner of `agent-workflows.Run view`, the canvas shows a `warning` banner above the toolbar with the reason and its action — `budget_exceeded` "Paused: budget reached" with "Raise budget" (shown on `admin` devices; others see "Ask an admin to raise the budget"), `no_route` "Paused: no model route for <role>" with "Open model routing", `provider_account` "Paused: <provider> account needs attention" with "Open provider settings", `user` "Paused" and `host_shutdown` "Paused: the host is restarting" — each followed by "Resume" for devices holding `jagentchill.generation.run`, and the banner's "Show" action reveals the node whose `blockedBy` has the same name; the canvas implements no pause rule of its own. These are the five `pauseReason` values; missing consent is not one of them and is drawn on its node. A run that is `waiting_approval` with `parked` shows "Parked: waiting for a person since <time>", and a reopened run shows "Reopened" beside its status. A workflow can be shown with any of its runs or with none; a run selector lists the runs newest first. Run state is never written to the workflow document. [NEW]

#### Scenario: Update applied
- **WHEN** a `node.status` change sets a node to `succeeded`
- **THEN** the node shows the succeeded style within 250 ms

#### Scenario: Sequence gap
- **WHEN** an event arrives with `seq` 41 after `seq` 38
- **THEN** the canvas fetches the run snapshot and renders it, ignoring the out-of-order event

#### Scenario: Connection lost
- **WHEN** the connection drops for 10 s during a run shown in the session Diagram tab
- **THEN** the banner is shown, timers and pulses are frozen, run actions are disabled, and after reconnect the snapshot is fetched again and the banner removed

#### Scenario: Run of an older revision
- **WHEN** the user selects a run that executed revision 12 while the workflow is at revision 15
- **THEN** the canvas shows the run's snapshot read-only with that run's overlay and a chip "Revision 12"

#### Scenario: Amendment arrives
- **WHEN** an `amended` change arrives for the displayed run
- **THEN** the canvas fetches the snapshot and the added node and edges appear with their enter animations

### Requirement: Node badges, metrics and thumbnails
A node SHALL display, when the values exist:
- **Duration** in the footer: elapsed time updating every 1 s while `running`, the final duration afterwards, formatted `m:ss` below one hour and `h:mm:ss` from one hour.
- **Cost** as the footer cost chip in USD: 2 decimals, "<$0.01" for positive values below 0.01, the prefix "≈" for an estimate in design mode.
- **Fan-out counter** as a footer chip "<succeeded>/<total>", with "<n> failed" in `danger` when `failed` > 0, and a second 2 px bar under the header progress bar showing succeeded (`success`), failed (`danger`) and running (`accent`) shares.
- **Retry badge** "×<n>" (`type/caption`, `bg/subtle`) at the header's right when `attempt` > 1.
- **Error-count badge**: a 16 px `danger` badge with the number of error issues (values above 9 read "9+") overlapping the top-right corner by 6 px; warnings use a `warning/text` badge when there are no errors.
- **Host-access badge**: nodes that use a workspace agent, a CLI or ACP runtime, or a team containing one (`agent-workflows.Roles, permissions and agent classes`) show a 14 px `shield-alert` glyph in `warning/text` after the title, with the tooltip "Runs with host access".
- **Output thumbnail** in the 64 × 64 px slot of `mediaOutput` nodes, cropped to fill, `radius/sm`, fetched as the `thumb` variant through `server-api.Authenticated media delivery` and held in the canvas thumbnail cache; fan-out nodes show the most recent item's thumbnail with a "+<n>" overlay. A thumbnail that fails to load leaves the type icon in the slot and surfaces no error on the canvas. Clicking the thumbnail opens the "Outputs" tab of the detail panel.
Values are formatted with `i18n-accessibility.Locale-aware formatting`. Badges and metrics follow "Level of detail by zoom". [NEW]

#### Scenario: Metrics after success
- **WHEN** a node succeeded in 73,400 ms with a cost of 0.1234 USD
- **THEN** its footer shows "1:13" and "$0.12"

#### Scenario: Fan-out counter
- **WHEN** a fan-out node has counts total 12, succeeded 7, failed 1, running 3
- **THEN** it shows "7/12", "1 failed" in `danger`, and a bar with 7/12 `success`, 1/12 `danger` and 3/12 `accent`

#### Scenario: Thumbnail fails
- **WHEN** a node's thumbnail request fails
- **THEN** the slot keeps the type icon and no toast or banner appears

#### Scenario: Retry badge
- **WHEN** a node's `attempt` is 3
- **THEN** the header shows "×3"

### Requirement: Node detail panel
Selecting a single node or edge and invoking `canvas.open-details` (also double-click, or a tap on touch) SHALL open the detail panel, whose frame is owned by this capability and whose node content is owned by `agent-workflows`: for a node on an editable canvas the sections of `agent-workflows.Node configuration panel and validation feedback`; for a node in a run the header, tabs and actions of `agent-workflows.Node detail panel` (individual executions are chosen by their execution address `path`, one selector per enclosing loop or fan-out, and loaded in pages from `jagentchill.workflow.run.executions`). Frame: a right panel 360 px wide on wide form factors (resizable 280–560 px, width persisted per device), a 360 px overlay panel on medium, and a bottom sheet with snap points 50 % and full height on compact (a 320 px right panel in landscape when the viewport height is below 480 px); `bg/app` with a hairline on its canvas side, a header row with the node's icon tile, title, a close button and — where both contents exist — a segmented control "Configure | Run"; the body scrolls and any action footer is pinned. For an edge the panel shows source and target (each a link that centres its node), ports, kind, type, label, route style and, in a run, state and the last delivered value preview. With several items selected it shows the count and the align, distribute, group and delete commands. With nothing selected the panel is closed. Escape closes the panel and returns focus to the canvas item. The panel never covers the selected node: when it opens, the viewport pans by the minimum amount that keeps the node visible. Selecting another item replaces the panel's content without closing it. Every host of "Canvas modes" uses this one panel. [NEW]

#### Scenario: Details of a succeeded script node
- **WHEN** the user opens the details of the `script` node of a finished run
- **THEN** the panel shows the content of `agent-workflows.Node detail panel` for that node in a 360 px right panel on a wide viewport

#### Scenario: Panel does not hide the node
- **WHEN** the selected node is under the area the panel will cover
- **THEN** the viewport pans just enough for the node to be fully visible beside the panel

#### Scenario: Edge details
- **WHEN** the user opens the details of an edge in a run
- **THEN** the panel shows source, target, kind, type, label, state and the last delivered value preview, and activating the source link centres the source node

#### Scenario: Compact sheet
- **WHEN** the user taps a node at 390 px viewport width
- **THEN** the panel opens as a bottom sheet at 50 % and can be dragged to full height

### Requirement: Run actions on the canvas
The canvas SHALL surface run actions without defining any: the node context menu, and a quick-action button on the node itself, offer exactly the actions that `agent-workflows.Node detail panel` lists for the node's status ("Cancel step", "Take over", "Retry", "Re-run with instruction", "Change model", "Skip", "Edit inputs", "Re-run", "Edit output", "Keep as is", "Raise budget", and the approval, form, hand-off and consent controls), invoke the same methods, and apply the same confirmations. The quick-action button is a 24 px-tall pill in the node's footer (replacing the chips while shown) that appears on nodes in `waiting_approval` ("Review"), `failed` ("Retry") and `stale` ("Re-run") at the `full` level of detail; "Review" opens the detail panel on the pending item, the others act directly. Role gates are those of `agent-workflows.Roles, permissions and agent classes` and are mirrored, not decided, by the canvas: actions that change a run require scope `jagentchill.generation.run`, so `viewer` devices see no quick-action button and no run action in any menu. An action in flight shows the loading state of `design-system.Button`; a refused action shows a toast with the error code and message of `server-api.RPC error envelope` (for example `BUDGET_EXCEEDED`, `APPROVAL_TIMEOUT`, `SCOPE_DENIED`, `CONFLICT`). A failed node's tooltip shows the error's message (at most 200 characters) and code as reported by the run state; the canvas invents no error codes. [NEW]

#### Scenario: Quick action on a failed node
- **WHEN** an `editor` device views a failed node at 100 % zoom
- **THEN** the node's footer shows a "Retry" pill, and activating it invokes the manual retry of `agent-workflows.Retry and fallback` with that panel's confirmation rule

#### Scenario: Viewer device
- **WHEN** a `viewer` device views a node in `waiting_approval`
- **THEN** no "Review" pill is rendered, the context menu holds no run action, and the footer text "Needs approval" is shown

#### Scenario: Refused action
- **WHEN** a re-run is refused with `CONFLICT` because a consumer of the node is running
- **THEN** a toast shows the code and message and the node's state is unchanged

### Requirement: Run summary pill, legend and status filter
With a run loaded, in hosts that do not show the header of `agent-workflows.Run view` (the session Diagram tab, the film studio, automations and a definition view with a run overlay), the canvas SHALL show a run summary pill: floating at the top centre of the canvas, 32 px tall, `bg/elevated`, `elevation/1`, `radius/full` (a full-width 44 px bar under the toolbar on compact), containing the run's status pill, "<done> of <total> nodes", elapsed time, actual cost and — when a run budget exists — "of <budget>" with a 2 px bar that turns `warning` at 80 %, followed by Pause or Resume and Cancel for devices holding `jagentchill.generation.run` (`agent-workflows.Pause, resume and cancel`), "Replay" for finished runs, and "Open run", which opens the run view. In every host the toolbar shows count chips for Running, Needs you and Failed (only when non-zero) and a status filter (All, Running, Needs you, Failed, Done): choosing a value or activating a chip draws nodes that do not match at 25 % opacity and edges not joining two matching nodes at 15 %; `canvas.next-match` and `canvas.previous-match` move focus through the matches in dispatch order using the Reveal command; a filter with no match shows "No <status> nodes"; the filter is cleared by choosing All or pressing Escape and is not persisted. A **legend** popover, opened from the view menu and available in every mode, lists every node type with its icon tile and name, every node status with its glyph and label, every port family with its mark and name, and the edge kinds and edge states; it is the reference for colour meaning and is fully keyboard-reachable. [NEW]

#### Scenario: Summary during a run in the Diagram tab
- **WHEN** a run has 5 of 12 nodes done, 2 running, 1 failed, 3:20 elapsed and 1.24 USD spent of a 5.00 USD budget
- **THEN** the pill reads "5 of 12 nodes", "3:20", "$1.24 of $5.00" and the toolbar shows chips "2 running" and "1 failed"

#### Scenario: No pill in the run view
- **WHEN** the same run is opened in the run view
- **THEN** the canvas shows no summary pill and the toolbar still shows the count chips and the status filter

#### Scenario: Show only failed
- **WHEN** the user activates the "1 failed" chip
- **THEN** the failed node stays at full opacity, all other nodes are at 25 %, and `canvas.next-match` focuses and reveals the failed node

#### Scenario: Legend
- **WHEN** the user opens the legend
- **THEN** it lists all node types, the nine node statuses, the ten port families, the four edge kinds and the five edge states with their marks and names

### Requirement: Run comparison
From the run selector the user SHALL be able to choose "Compare with…" and a second run of the same workflow. The canvas then shows the graph of the first run's revision with a delta badge under each node that differs: status as "<A> → <B>" when the statuses differ, duration difference as "+0:12" or "−0:05", and cost difference as "+$0.08" or "−$0.02" (`danger` when B is slower, costlier or failed where A succeeded, `success` for the reverse, `text/secondary` otherwise); nodes with any difference get a 1 px `purple` outline; nodes that exist in only one of the two revisions are drawn with the hatch of the `disabled` state and the label "Only in run A" or "Only in run B". A side table lists every node with both runs' status, duration and cost, sortable by each difference, and selecting a row focuses the node. A comparison bar above the canvas shows both runs' status, duration and cost and their differences. Comparison is read-only, device-local and exits through "Exit comparison" or Escape. Nodes are matched by node id. [NEW]

#### Scenario: Slower node
- **WHEN** run A took 1:10 on `voiceover` and run B took 1:22
- **THEN** `voiceover` shows "+0:12" in `danger` and a `purple` outline

#### Scenario: Node added between runs
- **WHEN** run B's revision contains a `translate` node that run A's does not
- **THEN** `translate` is drawn hatched with the label "Only in run B"

### Requirement: Editing while a run is active
The canvas SHALL apply the editing rules of `agent-workflows.Editing semantics for the canvas` and `agent-workflows.Amending a running workflow`, presenting them as follows. (1) **Definition view** (`edit` mode): all edits stay available while runs of the workflow are active, because each run executes its own snapshot; a banner states "Changes apply to the next run. Runs in progress keep their version." with a link to the active run; when the user loads a run overlay onto the definition and the definition has changed since that run started, nodes changed or added since then show a `purple` 6 px dot at the header's left with the tooltip "Edited since this run started" and show no run status. (2) **A `draft` run** has no graph of its own and no canvas: its route shows the run setup form with a collapsed read-only "Pipeline" canvas of the definition in `view` mode (`agent-workflows.Run setup form`), and "Open workflow" there leads to the definition view. (3) **Run view of a run that has started and is not finished** (including a reopened run): the graph is read-only until a device holding `jagentchill.generation.run` presses "Amend run"; in amend mode nodes whose every execution is `pending` or `ready` are editable and removable, new nodes and edges can be added (including edges from outputs of nodes in any state), and every other node shows a 12 px `lock` glyph in its header and refuses changes with the tooltip "This step has already started"; the user's changes are collected locally and drawn with the added, removed and changed styles of "Proposal diff mode"; an amendment bar shows the change count, the change in estimated cost, a required "Reason" field, "Apply amendment" and "Discard"; "Apply amendment" sends one `jagentchill.workflow.run.amend`, and a refusal (`WORKFLOW_AMEND_FORBIDDEN`, `WORKFLOW_LIMIT_EXCEEDED` when the amended snapshot would pass 200 nodes or 400 edges, cost approval) is shown in the bar with the offending node highlighted while the collected changes are kept. (4) **Run view of a finished run and built-in templates**: read-only (`WORKFLOW_READ_ONLY`), with a chip stating why and the action "Duplicate to edit" or "Edit workflow". In every read-only state selection, inspection, run actions, the status filter, comparison, replay, and device-local collapse, viewport and Follow stay available, and an attempted document-changing gesture highlights the reason chip for 600 ms. Geometry of a run snapshot is changed only as part of an amendment. [NEW]

#### Scenario: Read-only running run
- **WHEN** an `editor` device tries to drag a node in the run view of a running run without amend mode
- **THEN** the node does not move, no batch is sent and the chip "Run in progress — use Amend run to change upcoming steps" is highlighted for 600 ms

#### Scenario: Amend an upcoming step
- **WHEN** the user enters amend mode, inserts a tool node before a `pending` export node, enters a reason and presses "Apply amendment"
- **THEN** one `jagentchill.workflow.run.amend` is sent, the new node becomes part of the run's snapshot, and the source workflow is unchanged

#### Scenario: Started node is locked
- **WHEN** the user tries to delete a `succeeded` node in amend mode
- **THEN** nothing is collected and the tooltip "This step has already started" is shown

#### Scenario: Editing the definition during a run
- **WHEN** the user adds a node to a workflow that has a run in progress
- **THEN** the node is added to the definition, the banner is shown, and the run in progress does not execute the new node

#### Scenario: Collapse is allowed in a read-only view
- **WHEN** a viewer collapses three nodes in the run view of a finished run
- **THEN** they collapse on that device and neither the snapshot nor the workflow changes

### Requirement: Proposal diff mode
When a workflow has a pending proposal (`agent-workflows.Proposal and diff for agent edits`, delivered as `jagentchill.workflow.proposal` on the document stream and read with `jagentchill.workflow.proposal.get`), the canvas SHALL be able to present it in `diff` mode — opened by "Review on canvas" on the chat proposal card or by a "Review proposal" chip on the canvas — drawing the current graph and the proposed result together from the proposal's `diff`. The diff bar states why the change is a proposal, from the proposal's `reason`: `foreign` "The agent did not create this workflow", `protected` "Protected — changes need your approval", `plan` "Plan mode", `policy` "Changes approvals, triggers or budgets" and `untrusted` "The agent read external content before proposing this" (drawn with the `warning` tone and a list of the untrusted sources); a proposal is never shown as accepted automatically — in every session mode it stays pending until a device with `jagentchill.projects.write` decides. A workflow that an agent drafts in `plan` mode before it exists is not a proposal: it is a pending-plan draft drawn as an ordinary document with the chip "Plan — not approved yet" (`agent-workflows.Agent behaviour per session mode`), built with "Agent build choreography". The diff is drawn as follows:

| Item | Rendering |
|---|---|
| Added node | 2 px `success` border, header tint `success/subtle`, a 16 px "+" badge in `success` at the top-left corner |
| Removed node | drawn at its current position at 50 % opacity with a dashed (6/4) 1.5 px `danger` border, its title struck through, a "−" badge in `danger` |
| Changed node | 2 px `warning/text` border and a "~" badge in `warning/text`; the detail panel lists each entry of `fields[]` with its `before` and `after` values |
| Added edge | solid 2-unit `success` stroke with a "+" badge at its midpoint |
| Removed edge | dashed (6/4) `danger` stroke at 50 % opacity with a "−" badge |
| Geometry-only operations (moves, sizes, routes, groups, notes) | no badge; moved nodes show a dotted 1 px `accent` outline at their current position and are drawn at their proposed position |

Node identity in a diff, in "Run comparison" and in every enter or exit animation is the node id alone: a node whose `type` changed while its id is unchanged — in particular an `agent` node replaced by a `team` node with the same id, ports and output schema when a film stage is assigned to a Team (`agent-workflows.Built-in templates`) — is one Changed node whose `fields[]` contain `type`, redrawn in place with the new type's visual identity and keeping its position, size, edges and run history; it is never drawn as a removed node plus an added node. Added nodes without a position are drawn where the layout rule for unplaced nodes puts them. A diff bar above the canvas shows the proposal's title, the counts ("+3 nodes, −1 node, ~2 nodes, +4 edges, −1 edge"), the estimate change, previous/next item (`canvas.diff-previous`, `canvas.diff-next`, which reveal each item), and the list of the proposal's groups in the proposal's order, each with a checkbox, its label and its item count; hovering or focusing a group highlights its items on the canvas and dims the others to 35 %, and an item's badge opens a popover naming its group with the same checkbox. Groups are selected by default except groups that change approval policies, which are listed first with the label "Changes who approves" and are not pre-selected. Selecting a group also selects the groups it depends on, and clearing a group clears the groups that depend on it; each automatic change is named in a toast. The actions are "Accept" (all groups selected), "Accept selected" and "Reject", which call `jagentchill.workflow.proposal.resolve` with `accept`, `accept_partial` plus the selected `groupIds`, or `reject`; the accepted operations arrive as one revision and one undo step, and the canvas leaves `diff` mode; a refusal of the subset is shown in the bar with the returned message. A proposal with status `stale` shows "The workflow changed since this proposal was made" and offers only "Ask the agent to update it" and "Dismiss"; an `expired` proposal is shown read-only. When several proposals are pending (at most 3), a selector in the bar switches between them. Resolving requires scope `jagentchill.projects.write` (`editor` and `admin` devices); `viewer` devices see the diff read-only. Proposals from both agent classes of design D25 use this mode; a proposal that adds workspace-agent nodes can be accepted only by a device allowed to create them (see "Node palette"). [NEW]

#### Scenario: Review and accept everything
- **WHEN** an agent proposes adding two nodes and three edges and the user presses "Accept"
- **THEN** the two nodes and three edges are added as one revision and one undo step, and the canvas returns to `edit` mode

#### Scenario: Partial acceptance with a dependency
- **WHEN** the user clears every group and then selects the group that connects a new node, which depends on the group that adds it
- **THEN** the adding group is selected automatically, a toast names it, and "Accept selected" sends both group ids

#### Scenario: Policy change is not pre-selected
- **WHEN** a proposal contains a group that changes an approval node from `human` to `agent`
- **THEN** that group is listed first with "Changes who approves" and its checkbox is clear, as are the checkboxes of groups labelled "Changes when this runs" and "Changes spending limits"

#### Scenario: Changed node detail
- **WHEN** the user selects a node marked "~"
- **THEN** the detail panel lists each changed field with its previous and proposed value

#### Scenario: Stale proposal
- **WHEN** the proposal's status is `stale`
- **THEN** no accept action is offered and the bar offers "Ask the agent to update it" and "Dismiss"

#### Scenario: Viewer sees the diff read-only
- **WHEN** a `viewer` device opens the proposal
- **THEN** added, removed and changed items are highlighted and no accept or reject control is rendered

#### Scenario: Agent node replaced by a team node
- **WHEN** a run of `tpl.film-episode` whose `storyboard` stage is assigned to a Team is compared with a run in which it was performed by a single agent
- **THEN** the node `storyboard` is shown once, as a changed node with the `team` visual identity and the delta badges of "Run comparison", and no node is labelled "Only in run A" or "Only in run B" because of the substitution

#### Scenario: Proposal staged because of untrusted content
- **WHEN** a proposal with `reason: "untrusted"` is opened in `diff` mode by an `editor` device while the session is in `auto` mode
- **THEN** the diff bar shows "The agent read external content before proposing this" in the `warning` tone, the proposal is still pending, and nothing was applied

### Requirement: Interactive HTML export from the fork
"Export → Interactive HTML" SHALL produce one self-contained HTML file, built by the fork on the device with no host and no network, that shows the workflow as the canvas lays it out — free positions, sizes, routes, ports, groups and notes — in a read-only viewer; any role that can view the workflow can export it. The file is assembled by `src/export/standalone`: the fork's standalone template (produced by the second assembly target of `upstream/scripts/generate-viewer.mjs` from `viewer/template.source.html`, the fork's stylesheet with both themes resolved to literal token values, and the fragments for the fork camera, motion governor, intent trace, node finder, node outline, focus and export) with the scene emitted by `scene/static-svg` inserted through upstream's `applyTemplate`. Options: scope — whole workflow (default) or selection; initial theme — light or dark (default: current; the file contains both, offers upstream's theme toggle, and honours the query parameters `theme=light|dark` and `embed=1` as upstream's template does); "Include run status" (default on when a run is loaded) — every node carries its status glyph, status text, duration and cost and every edge its run state as static content, as of the export time, under a caption "Run <n> · <status> · as of <time>"; and animation `none` (default) or `trace`, which marks nodes and edges with upstream's `data-animate` steps in dispatch order so that upstream's finite trace plays under the reader's Live and Still switch. The file contains node names, localised type names, port labels and types, edge labels, group labels, note text and, when included, run status, durations and costs; it MUST NOT contain node configuration, prompts, parameter or variable values, secret names, output content, thumbnails, device or host identifiers, or any URL other than the SVG namespace and font licence texts. In the file the reader can pan and zoom (10 %–400 %), search nodes, list nodes in the outline, focus a node's neighbourhood, switch theme and export PNG and SVG; nothing can be edited and the file has no message bridge. The file makes no network request, embeds fonts per "Theme mapping and fonts", is at most 2 MiB for the `wf-200` fixture, and is produced within 1,000 ms on the reference desktop and 2,500 ms on the reference phones. It is named `<workflow-name>-interactive-<yyyyMMdd-HHmm>.html`, saved through the file dialog or download on desktop and web and handed to the share sheet on mobile. The file is not an archify document and upstream archify tooling is not expected to process it; the upstream-compatible path is "Archify HTML export on the host". [NEW]

#### Scenario: Export without a host
- **WHEN** a `viewer` device with no connected host exports a cached workflow as interactive HTML
- **THEN** one `.html` file is produced, and opening it in a browser with networking disabled shows every node at its stored position with its ports and edges

#### Scenario: Run status included
- **WHEN** "Include run status" is on for a finished run
- **THEN** each node in the file shows its status glyph, status text, duration and cost, and the caption names the run and the export time

#### Scenario: No configuration in the file
- **WHEN** a workflow whose agent node has a 400-character prompt and references the secret `STOCK_API_KEY` is exported
- **THEN** the file contains neither the prompt text nor the string `STOCK_API_KEY`

#### Scenario: Reader navigation
- **WHEN** the reader types a node name into the file's node finder and chooses the result
- **THEN** the view moves to that node and its neighbourhood is highlighted

### Requirement: Archify HTML export on the host
The Export menu group "Export for upstream archify" SHALL produce documents that unmodified upstream archify accepts, in two forms, both from the projection that `agent-workflows.Archify projection` defines (`jagentchill.workflow.archify.project`: the free-form graph layered deterministically by depth into lanes × columns 0–5, split into one or more linked parts — each a complete archify document — so that every part passes the real upstream validator, with node types mapped to archify's seven types); this capability adds no projection rule of its own and treats `{partCount, parts[]}` as given. **JSON** — "Export for upstream archify → JSON" returns each projected part as a file — `<workflow-name>.archify.json` for a single part, `<workflow-name>-part<i>.archify.json` otherwise (scope `jagentchill.projects.read`, connected host) — after checking every part on the device against the pinned upstream `workflow.schema.json` with upstream's generated validator and with `compileWorkflow` in the canvas runtime, which must return `ok: true`; the full `archify validate` (render and artifact check) runs on the host in the HTML path and in CI. **HTML** — "Export for upstream archify → HTML" produces upstream archify's self-contained HTML document through the rendering step this capability owns, exposed as `jagentchill.workflow.archify.render {workflowId | runId, quality: "standard" | "showcase" (default standard), animation: "none" | "trace" (default none), includeRunStatus (default false), idempotencyKey}` on channel P, requiring a connected host and scope `jagentchill.export.run`. On the host the server, for every part in index order: (1) obtains the projected document; (2) writes a derived copy in which `meta.output` is the portable relative name of the export file, `meta.animation` is the requested value and — when `includeRunStatus` is true — each node's `sublabel` is its localised type name (at most 24 characters) and its `tag` is "<status> · <duration> · <cost>" (at most 32 characters); the stored workflow and the projection are not modified; (3) runs `archify validate workflow <file> --json`; (4) runs `archify render workflow <file> <out.html> --quality <quality>`, writing the part's `meta.output` file name so that the link nodes between parts ("To part <k>" / "From part <k>", whose sublabel is the sibling file name) name real files. A failure of any part fails the whole export and no file is delivered. With `includeRunStatus` the added `sublabel` and `tag` are cut to the text-unit limits of the projection's label rule and the node `width` is recomputed by that rule, so the derived copy still validates. Both commands run as child processes spawned and supervised by the server in the same way as the worker of `server-api.FFmpeg worker`, using the Node runtime the server itself runs on, with no call to the OpenClaw Gateway (the export works while the Gateway is down), with an argument array (no shell, no interpolation of user text), the environment variable `ARCHIFY_UPDATE_CHECK_DISABLED=1`, a working directory private to the export and removed afterwards, no network access needed, and a timeout of 30 s per command and 300 s for the whole export; only `validate` and `render` are ever invoked (never `finalize`, `deliver`, `preview` or the browser checks, so no browser binary is required). The CLI is the fork's `upstream/archify` tree — the pinned upstream commit plus the patches of "Archify module reuse map", whose lane × column output is byte-identical to upstream's. The fork package `packages/archify` is its single location: the server consumes it as a workspace dependency, and its package build places the CLI entry, renderers, schemas and `assets/template.html` (with the empty brand-mark catalogue) and the file `VERSION` holding the pinned commit inside the server's build output; no second copy of archify is committed anywhere in the repository, and a CI check fails when the packaged `VERSION` differs from the commit recorded in the fork's `UPSTREAM.md`. Its MIT notice and the SIL OFL notice of its embedded JetBrains Mono font are listed in `THIRD_PARTY_NOTICES.md` per `platform-skeleton.Licence and third-party notices`. The result is stored as one artifact per part of the workflow or run, fetched through `server-api.Authenticated media delivery`. A single part is named `<workflow-name>-diagram-<yyyyMMdd-HHmm>.html`; several parts keep the projection's file names (`workflow-<id>-part<i>.html`) and are saved together — into a folder the user chooses on desktop (macOS, Windows, Linux), as consecutive downloads on web, and as one multi-item share on iOS and Android — after the dialog stated "This workflow is exported as <n> linked pages". The CI conformance gate `archify-projection` (a gate of `diagnostics-quality.CI gates`) MUST run the projection of `agent-workflows.Archify projection` and then `archify validate workflow <file>` on every part — with the fork's `upstream/archify` tree and also with the unpatched upstream tree fetched from `archify-upstream` at the pinned commit — on every built-in template of `agent-workflows.Built-in templates` and on the named regression fixtures that requirement lists (small chain, branching graph with cross-lane and error edges, loop-back edge, fan-out and join, nine nodes in one lane, eight nodes at one depth, and 80-, 120- and 200-node chains, layered graphs and dense graphs), require exit status 0 for each part, and assert that projecting the same fixture twice gives byte-identical output. The fixtures, their expected part counts and the measured checker receipt sizes are kept beside the gate in `packages/workflow/test/archify-projection/`. [NEW] [JAD JD-MA-022]

#### Scenario: Successful export
- **WHEN** an `editor` device exports a valid 12-node workflow with "Export for upstream archify → HTML"
- **THEN** one `.html` file is produced that opens in a browser with no network access and shows every node and edge of the workflow
- **AND** the workflow's `revision` and `graphHash` are unchanged

#### Scenario: Large workflow exported as linked pages
- **WHEN** a 200-node workflow whose projection has 18 parts is exported as HTML on a desktop
- **THEN** 18 files named `workflow-<id>-part1.html` … `-part18.html` are saved into the chosen folder, each validated before rendering, and every "To part <k>" node names the file of part `k`

#### Scenario: JSON accepted by unmodified upstream
- **WHEN** the exported `.archify.json` of a built-in template is given to `archify validate workflow` of the unpatched upstream tree at the pinned commit
- **THEN** it reports zero errors

#### Scenario: Include run status
- **WHEN** "Include run status" is on for a finished run
- **THEN** each node in the exported HTML carries a tag such as "Done · 1:13 · $0.12"

#### Scenario: Validation errors
- **WHEN** `archify validate` reports errors for the projected document
- **THEN** no file is produced, the call fails with `canvas/archify-invalid`, and the dialog lists up to 10 diagnostics with node or edge ids and the suggestion to export interactive HTML, PNG or SVG

#### Scenario: CLI unavailable or timed out
- **WHEN** a child process cannot start or exceeds 30 s
- **THEN** the process is terminated, the call fails with `canvas/archify-failed`, and the private working directory is removed

#### Scenario: No host or no scope
- **WHEN** the client is not connected to a host, or the device is a `viewer`
- **THEN** the HTML entry of "Export for upstream archify" is disabled with the tooltip "Requires a connected host" or is not rendered for the viewer, and interactive HTML, PNG and SVG export remain available

### Requirement: Archify import
The Workflows screen and the canvas Export menu SHALL offer "Import archify diagram…", which accepts one `.json` file of at most 4 MiB whose `diagram_type` is `workflow` and passes it to `jagentchill.workflow.archify.import` (`agent-workflows.Archify projection`), which creates a draft workflow with one trigger, grid-seeded positions (`x = 120 + col × 300`, `y = laneIndex × 160`) and unconfigured nodes. The canvas then opens the draft in `edit` mode at zoom-to-fit, plays the node-enter animation once for all nodes together (160 ms), and shows a dismissible `accent` banner "Imported <n> nodes and <m> edges from an archify diagram. <k> nodes need configuration." with "Show problems", which opens the problems list of `agent-workflows.Node configuration panel and validation feedback`. A file that is not JSON, is larger than 4 MiB, or has another `diagram_type` (architecture, sequence, dataflow, lifecycle) is refused before any call with `canvas/import-invalid` and a message naming the reason; a workflow file whose `schema_version` the pinned upstream schema does not list is refused per "Oversized documents and upstream schema mismatch"; errors returned by the import method are shown with their code and first 5 messages. Import requires a connected host and scope `jagentchill.projects.write`. [NEW]

#### Scenario: Import a workflow diagram
- **WHEN** an `editor` device imports an archify workflow document with 9 nodes in 3 lanes
- **THEN** a draft workflow opens with a trigger and 9 imported nodes at grid-seeded positions, fitted in the viewport, and the banner states how many nodes need configuration

#### Scenario: Wrong diagram type
- **WHEN** the chosen file has `diagram_type` "sequence"
- **THEN** nothing is created and the message "Only archify workflow diagrams can be imported" is shown with `canvas/import-invalid`

#### Scenario: Viewer
- **WHEN** a `viewer` device opens the Workflows screen
- **THEN** "Import archify diagram…" is not rendered

### Requirement: Image export, copy and print
The canvas SHALL export images of the graph on the device, with no host, for any role that can view the workflow, using the fork's exporter derived from archify's `viewer/export.js`: the scene is emitted for the chosen options, serialised to a standalone SVG document with resolved token values and embedded fonts (`serializeSvg`), and for raster formats drawn as an image into a 2D raster surface and encoded (`rasterize`). Because that raster path draws the serialised SVG as an image, scene content MUST consist of SVG primitives only and MUST NOT use `foreignObject`. PNG and SVG are produced inside the canvas runtime on every platform — on iOS and Android inside the canvas WebView, with the bytes returned through the binary sink of "Host message protocol".
- **PNG**: scale 1×, 2×, 3× or 4× (default 2×) of the graph at 100 % zoom; the longer side MUST NOT exceed 8,192 px on desktop and web and 4,096 px on mobile — a larger request is reduced to the largest allowed scale and the dialog states the applied scale (`canvas/export-too-large` when even 1× exceeds the limit, with the advice to export a selection).
- **SVG**: the serialised vector document itself, in the chosen theme, with text kept as text and the fonts of "Theme mapping and fonts" embedded as data URIs so that it renders the same without the app, and with each node group carrying `data-node-id`, each edge `data-edge-id` and each group `data-group-id`; rasterising the SVG at 2× and comparing it with the 2× PNG of the same options in the same runtime MUST differ in at most 1 % of pixels.
- **Options** for both: scope — whole workflow (default), selection only (enabled when something is selected; includes edges between selected nodes), or current viewport; theme — light or dark (default: current); background — `wf/canvas-bg` with the grid, `wf/canvas-bg` plain (default), or transparent; "Include run status" (default on when a run is loaded); padding of 48 px at 1× around the content. Exports are drawn at the `full` level of detail with all nodes in their current collapsed or expanded state, without selection rings, guides, minimap, toolbar, banners or any other view state (removed as upstream's export clean-up removes viewer state).
- **Files** are named `<workflow-name>-<yyyyMMdd-HHmm>.png` or `.svg`; desktop and web save through the file dialog or download, mobile uses the share sheet.
- **Copy as image** (`canvas.copy-image`): writes a 2× PNG of the selection, or of the whole workflow when nothing is selected, with a plain background to the system clipboard on desktop and web; where the platform cannot write images to the clipboard the PNG is downloaded instead and a toast says so (`canvas/clipboard-unavailable`); on mobile the image goes to the share sheet.
- **Print**: "Print…" renders the whole workflow in the light theme on a white background as vector output, scaled to fit one landscape page by default with the option "Actual size across pages" (100 % zoom, tiled with 10 mm overlap), with a header line of workflow name, revision or run number and date; it uses the system print dialog on desktop and web and the system print sheet on mobile.
- **Thumbnails**: `scene/static-svg` emits a document at the `block` level of detail for a requested box (default 320 × 180) for the template cards and lists of `agent-workflows.Workflows list screen`, cached by workflow id and revision; on desktop and web the thumbnail is shown as an SVG image within 50 ms on the desktop reference device, and on phones and tablets it is rasterised to PNG by the shared canvas instance of "Runtime hosting on each platform" within 150 ms.
An export of the 200-node fixture at 2× completes within 2 s on the desktop reference device and 5 s on the mobile reference devices, shows a progress indicator after 300 ms and is cancellable. [NEW]

#### Scenario: PNG at 2×
- **WHEN** the user exports the whole workflow, whose content measures 1,800 × 900 units, as PNG at 2×
- **THEN** the PNG is (1,800 + 96) × 2 = 3,792 px wide and (900 + 96) × 2 = 1,992 px high

#### Scenario: Size cap
- **WHEN** 4× would produce an image 10,000 px wide on desktop
- **THEN** the export uses the largest scale not exceeding 8,192 px and the dialog shows the applied scale

#### Scenario: Selection only with a transparent background
- **WHEN** three nodes are selected and the user exports PNG with scope "Selection" and a transparent background
- **THEN** the image contains only those three nodes and the edges between them on transparent pixels

#### Scenario: SVG ids and text
- **WHEN** the user exports SVG
- **THEN** every node group carries `data-node-id` equal to the node's id in the document, node titles are text elements, and the file requests nothing when opened

#### Scenario: PNG on a phone
- **WHEN** the user exports PNG at 2× on the reference iPhone
- **THEN** the image is produced inside the canvas WebView and the share sheet opens with the file

#### Scenario: Copy as image without clipboard support
- **WHEN** the browser cannot write images to the clipboard and the user invokes `canvas.copy-image`
- **THEN** the PNG is downloaded and a toast states that the image was saved instead

### Requirement: Motion export to WebM
"Export → Video (WebM)" SHALL record the workflow in motion as a WebM file using the fork's recorder derived from archify's `recordWebm`, which redraws the diagram's nodes, edges and travelling trace into a 2D raster surface and records that surface's stream. Content: for a finished run, the replay of "Run replay scrubber" from start to end with idle time skipped, at the lowest of the speeds 1×, 2×, 4×, 8× and 16× that keeps the video at or under 60 s (when 16× is still longer, activity time is compressed linearly to 60 s); for a definition or a run that has not finished, a trace of the graph in dispatch order at 0.4 s per node, at least 4 s and at most 30 s. Options: 1,280 × 720 (default) or 1,920 × 1,080; theme light or dark; the whole workflow fitted with 48 px padding; 30 frames per second; no audio. The codec is the first supported of VP9, VP8 and the browser default, in upstream's order; the file is at most 50 MiB and named `<workflow-name>-<yyyyMMdd-HHmm>.webm`. Where it runs:

| Platform | Route |
|---|---|
| Web and desktop where recording is supported | inside the canvas runtime, on the device, for any role that can view the workflow |
| Web where upstream's capability check fails (no media recorder, no WebM type, or no stream capture of a raster surface) | the entry is disabled with the tooltip "This browser cannot record video" |
| iOS and Android when `ready.capabilities.webm` is true | inside the canvas WebView, bytes returned through the binary sink |
| iOS and Android otherwise, with a connected host | on the render host: `jagentchill.workflow.archify.record {workflowId \| runId, options, idempotencyKey}` on channel P (scope `jagentchill.export.run`) creates a job of kind `workflow.record` (`server-api.Background job queue`) that loads the same canvas page in the render host of `render-engine.Render host`, records there, and stores the file as an artifact fetched through `server-api.Authenticated media delivery` |
| iOS and Android otherwise, with no host or no scope | the entry is disabled with the tooltip "Video export needs a connected host on this device" |

Whether each mobile runtime reports `webm: true` is recorded by spike S19. Recording takes at most 1.5 times the video's duration, shows progress from the first second, is cancellable, and a failure is reported as `canvas/export-failed`; under reduced motion the export still records motion, because the file is an explicit user request. [NEW]

#### Scenario: Replay recorded on desktop
- **WHEN** an `editor` exports a finished run with 4 minutes of activity as WebM on desktop
- **THEN** a `.webm` of 1,280 × 720 at 30 frames per second lasting 60 s at most is saved, showing node states changing in the recorded order

#### Scenario: Definition trace
- **WHEN** a 12-node definition with no run is exported as WebM
- **THEN** the video lasts 4.8 s and highlights the nodes in dispatch order

#### Scenario: Phone without recording support
- **WHEN** the canvas on an iPhone reported `webm: false` and a host is connected
- **THEN** the export runs on the render host and the share sheet opens with the downloaded file

#### Scenario: Phone without recording support and offline
- **WHEN** the canvas reported `webm: false` and no host is connected
- **THEN** the entry is disabled with the tooltip "Video export needs a connected host on this device"

### Requirement: Canvas modes
`WorkflowCanvas` SHALL run in exactly one of these modes, set by its host, and enable only the listed capabilities:

| Mode | Used for | Pan, zoom, select, inspect, find, outline, image export | Edit the document | Run actions | Special UI |
|---|---|---|---|---|---|
| `edit` | workflow definitions (including a pending-plan draft in its authoring session) | yes | yes, when editable | when a run overlay is loaded | palette, guides, problems badges |
| `view` | a definition opened by a `viewer`, a built-in template, a past revision, the "Pipeline" section of the run setup form | yes | no | no | reason chip |
| `run` | a run that has started | yes | only through amend mode | yes, by scope | Follow, status filter, summary pill |
| `replay` | playback of a finished run | yes | no | no | scrubber bar |
| `compare` | two runs side by side on one graph | yes | no | no | delta badges, comparison bar |
| `diff` | reviewing a proposal | yes | no (decisions only) | no | diff bar |
| `miniature` | chat widget, automation preview, cards | no (tap or click expands) | no | no | fit-to-box, no toolbar, no minimap |

A canvas is **editable** when all of these hold: the mode is `edit` (or `run` in amend mode); the device holds scope `jagentchill.projects.write` (`jagentchill.generation.run` for amend mode); a host is connected; the document is not read-only (`WORKFLOW_READ_ONLY`); and the document's `schemaVersion` is supported by the app. When a canvas is not editable, every document-changing control is absent or disabled, every document-changing gesture is ignored, and a chip names the reason: "View only" (role), "Offline — view only", "Built-in template — duplicate to edit", "Run in progress — use Amend run to change upcoming steps", "Run finished — duplicate to edit", "Revision <n> — restore to edit", "Plan — not approved yet" (a pending-plan draft opened outside its authoring session), "Not supported in this browser" (an unsupported runtime, "Renderer spike S19 and fallback renderer"), or "Update the app to edit this workflow". Hosts pass the workflow or run id, the mode and an initial focus target; they do not reimplement canvas behaviour. Several canvases can be mounted at once (for example the chat widget and the Diagram tab); each has its own viewport and view state, and all show the same document and run state. [NEW]

#### Scenario: Viewer opens a definition
- **WHEN** a `viewer` device opens a workflow
- **THEN** the canvas is in `view` mode with the chip "View only", no palette, and pan, zoom, selection, inspection, find and PNG export available

#### Scenario: Newer schema
- **WHEN** a document's `schemaVersion` is higher than the app supports
- **THEN** the canvas shows what it can draw read-only with the chip "Update the app to edit this workflow"

#### Scenario: Two canvases on one run
- **WHEN** the chat widget and the Diagram tab show the same run and a node succeeds
- **THEN** both show the succeeded style within 250 ms and each keeps its own viewport

### Requirement: Hosting in the Workflows screens and automations
The route `/h/[hostId]/workflows/[workflowId]` of `app-shell-navigation.Route map` SHALL host the canvas in `edit` mode (`view` for devices without `jagentchill.projects.write`) filling the content area, with the palette at the inline-start side, the detail panel at the inline-end side, the canvas toolbar above, and the host's own header (name, problems count, Run and the overflow menu of `agent-workflows.Workflows list screen`). The run view of `agent-workflows.Run view` at `/h/[hostId]/workflows/runs/[runId]` shows the run setup form while the run is `draft` (no run canvas; the form's "Pipeline" section hosts the definition in `view` mode) and hosts the same component in `run` mode once the run has started, switching to `replay` and `compare` on request. The run view's tab strip holds its own tabs plus up to 4 template tabs (`agent-workflows.Run view`; for example "Shots" and "Preview"): the canvas is one tab of that strip and keeps a usable area of at least 480 × 320 px on wide and medium form factors with all tabs present — the strip scrolls horizontally instead of wrapping, and the canvas toolbar never shares a row with it — while on the compact form factor the template tabs join the segmented control of `agent-workflows.Mobile presentation` and the canvas fills the area under it. Switching to a template tab and back keeps the canvas viewport, selection and run overlay without reloading the canvas runtime. Opening a `subworkflow` node's target pushes a breadcrumb ("Parent workflow › Sub-workflow") above the canvas and keeps the parent's viewport for the way back. Opening a deep link that names a node (`…/workflows/<workflowId>?node=<nodeId>` or `…/runs/<runId>?node=<nodeId>`) selects, centres and opens the details of that node; an unknown node id opens the canvas at its saved viewport with the toast "That step no longer exists". In Automations, the "Run workflow" instruction of `automations.Run-workflow instruction` shows the chosen workflow as a `miniature` of 320 × 180 px with "Open workflow", and each run row of `automations.Automation detail and run history` that started a workflow opens the run view; the entry points of `agent-workflows.Entry points` in the editor and Script studio open these same routes. Both routes require a connected host and otherwise follow "Persistence, multi-device editing and offline behaviour". [NEW]

#### Scenario: Definition route for an editor
- **WHEN** an `editor` device opens a workflow route on a wide viewport
- **THEN** the canvas is editable with the palette docked on the left and the detail panel closed until an item is selected

#### Scenario: Run view with four template tabs
- **WHEN** a run whose template contributes 4 tabs is opened on a medium form factor and the user switches to the fourth tab and back to the canvas
- **THEN** the tab strip scrolls horizontally on one row, the canvas area is at least 480 × 320 px, and the canvas shows the same viewport and selection as before without a loading state

#### Scenario: Deep link to a node
- **WHEN** a run link with `?node=voiceover` is opened
- **THEN** the canvas centres `voiceover`, selects it and opens its details

#### Scenario: Sub-workflow breadcrumb
- **WHEN** the user opens a sub-workflow from its node and then activates the parent in the breadcrumb
- **THEN** the parent canvas is shown at the viewport it had before

#### Scenario: Automation preview
- **WHEN** an automation's "Run workflow" instruction references a workflow
- **THEN** the instruction block shows a 320 × 180 px miniature of it and "Open workflow" opens its definition

### Requirement: Session workspace Diagram tab
The "Diagram" tab of the session workspace SHALL be owned by this capability and hosted by `chat-agent.Diagram tab`: it shows the canvas for the workflow or run bound to the session (`agent-workflows.Workflow started from a chat session`) — in `edit` mode for a workflow the session's agent is authoring or the user opened, in `run` mode for a run. Above the canvas toolbar a selector lists the session's workflows and runs newest first (shown when there is more than one), and a revision selector lists the retained revisions and named versions of the selected workflow (`agent-workflows.Versioning`), any of which opens read-only in `view` mode with "Restore". The run summary pill, Follow, the status filter, the detail panel, proposals in `diff` mode and the build choreography all work here as specified. When the session has no workflow or run, the tab shows the first-use empty state of `design-system.Empty, error and offline states` titled "No workflow in this session" with the primary action "Start a workflow" (inserts `/workflow ` into the session composer and focuses it) and the secondary action "Open a workflow…" (a picker of the host's workflows). The tab title shows a 6 px dot: `accent` while a run is running or an agent is building, `warning` when something waits for the user, `danger` when the run failed; the dot's meaning is in the tab's accessible name. On compact form factors the tab is one of the horizontally scrolling workspace tabs and the canvas follows "Compact and tablet presentation". [NEW] [JAD JD-MA-022]

#### Scenario: Empty state
- **WHEN** a session without any workflow or run opens the Diagram tab
- **THEN** "No workflow in this session" is shown with "Start a workflow" and "Open a workflow…", and activating the first inserts `/workflow ` in the composer and focuses it

#### Scenario: Agent builds beside the chat
- **WHEN** the session's agent starts authoring a workflow while the Diagram tab is open
- **THEN** the nodes and edges appear with the build choreography and the tab title shows an `accent` dot

#### Scenario: Attention dot
- **WHEN** the session's run has a node in `waiting_approval` and another tab is active
- **THEN** the Diagram tab title shows a `warning` dot and its accessible name ends with "needs your attention"

#### Scenario: Browse an earlier revision
- **WHEN** the user picks revision 7 in the revision selector of a workflow at revision 12
- **THEN** revision 7 is shown read-only with the chip "Revision 7 — restore to edit"

### Requirement: Inline widget in chat
When a session timeline item refers to a workflow or a run (an agent authoring a workflow, starting a run, or reporting on one; the client declares the Gateway capabilities `inline-widgets` and `tool-events`, design D9), the timeline SHALL show an inline widget: a card of the message width, at most 560 px wide and 240 px high, `radius/md`, 1 px `border/hairline`, with a 36 px header (workflow name; for a run the status pill, "<done> of <total>", elapsed time and actual cost; for an authoring turn "Building… <n> steps") and a canvas in `miniature` mode below it: the graph fitted to the card with 12 px padding, drawn at the level of detail that the fitted zoom selects, with live node and edge states, the animations of this specification and the build choreography. The miniature takes no pan, zoom or drag gestures, so the timeline scrolls normally over it (on iOS and Android the native canvas view is mounted non-interactive and a pressable over it takes the tap, "Runtime hosting on each platform"); clicking or tapping it, or its "Expand" button, opens the session's Diagram tab on the same workflow or run with the active node centred. An overflow menu offers "Open run", and for devices holding `jagentchill.generation.run` "Pause" or "Resume" and "Cancel". A session shows one widget per workflow and one per run: further references update the existing widget and scroll it into view. At most 3 miniatures in a timeline render live on desktop and web and at most 1 on phones and tablets; the others, and every miniature scrolled out of view, show a static bitmap of their last state, refreshed at most twice per second while their run changes. Widgets of finished runs keep showing the final state. Without a connected host a widget shows its last known bitmap with "Offline". [NEW] [JAD JD-MA-022]

#### Scenario: Widget appears when a run starts
- **WHEN** the agent starts a run in a session
- **THEN** one widget is appended to the timeline and updates live as nodes change status

#### Scenario: Expand
- **WHEN** the user clicks the widget
- **THEN** the Diagram tab opens on that run with the running node centred

#### Scenario: Scrolling over the widget
- **WHEN** the user scrolls the timeline with the pointer over a widget
- **THEN** the timeline scrolls and the miniature's view does not change

#### Scenario: Same run referenced again
- **WHEN** the agent reports on the same run a second time
- **THEN** no second widget is added and the existing widget is scrolled into view

#### Scenario: Live miniatures on a phone
- **WHEN** a session timeline on a phone shows widgets for two running runs
- **THEN** the widget nearest the viewport centre renders live and the other shows a bitmap refreshed at most twice per second

### Requirement: Film pipeline diagrams
The same component SHALL be embedded in Film Studio with no forked behaviour: `film-production.Film pipeline diagram view` hosts the canvas in `run` mode for an episode's pipeline run and in `edit` mode (or `view`, by role) for the pipeline's definition, which is a workflow like any other (`agent-workflows.Built-in templates`, `tpl.film-episode`). Each node's context menu and quick action additionally offer "Open stage", which opens the corresponding studio stage for that episode; per-panel and per-clip work appears as fan-out counters on one node, never as one node per item; the detail panel, Follow, the status filter, replay, comparison, image export, the interactive HTML export and the upstream archify export work as specified. The embedding obeys "Canvas modes" and inherits the roles of the device. [NEW]

#### Scenario: Episode pipeline
- **WHEN** the user opens the diagram of an episode whose panel-video node has produced 10 of 24 items
- **THEN** that node shows the counter "10/24" and its menu offers "Open stage", which opens the Video stage of that episode

#### Scenario: Same behaviour as any run
- **WHEN** a film pipeline run is opened from Film Studio and from the Workflows run list
- **THEN** both show the same canvas with the same node states and controls, apart from "Open stage"

### Requirement: Compact and tablet presentation
On compact form factors (`design-system.Breakpoints and layout constants`) the canvas SHALL fill the screen edge to edge under a 56 px top bar (see "Canvas toolbar"), with: the floating "+" button and zoom-to-fit button at the bottom-right, inset by the safe area plus 16 px; the palette, quick-add menu, context menus and detail panel as bottom sheets per `design-system.Side sheet and bottom sheet`; no minimap unless toggled on; the find bar and the diff, amendment, comparison and replay bars as full-width bars that stack above the bottom safe area; and an initial viewport, when none is saved, of 100 % zoom centred on the first node that is `running`, `waiting_approval` or `failed` in a run, or on the trigger in a definition. The scene is drawn under the system bars and into display cut-outs, while every control and bar stays inside the safe area; when a bottom sheet is open the usable viewport for Reveal, Follow and zoom-to-fit is the area above the sheet. Both orientations are supported and a rotation keeps the canvas point at the viewport centre fixed; in landscape with a viewport height below 480 px the detail panel is a 320 px panel on the inline-end side and the top bar is 48 px. On medium and wide form factors with touch input (tablets) the layout is the desktop layout — docked palette (collapsed by default on medium), right detail panel, minimap — with the touch gestures and 44 px targets of "Touch gestures"; a connected pointer or hardware keyboard enables hover states and the shortcuts of "Canvas keyboard shortcuts" at once. The on-screen keyboard never covers a focused inline field: the viewport pans so the field is at least 16 px above it. [NEW]

#### Scenario: Phone portrait
- **WHEN** a running run is opened at 390 × 844 px with no saved viewport
- **THEN** the canvas opens at 100 % centred on the running node, with the "+" button absent (run mode), no minimap and all controls inside the safe area

#### Scenario: Rotation
- **WHEN** the device rotates from portrait to landscape
- **THEN** the canvas point that was at the viewport centre is still at the centre and zoom is unchanged

#### Scenario: Tablet with a keyboard
- **WHEN** a hardware keyboard is connected to a tablet showing an editable canvas
- **THEN** `canvas.quick-add` and the other canvas shortcuts work without any setting being changed

### Requirement: Keyboard operation of the canvas
Every canvas function SHALL be operable from the keyboard with the actions of "Canvas keyboard shortcuts". The scene is one tab stop with a roving focus inside it; Tab and Shift+Tab move between the toolbar, the scene, the palette and the detail panel and are never trapped. Inside the scene:
- **Nodes**: the arrow actions move focus to the nearest node, group or note whose centre lies within the 90° sector in that direction (ties broken by distance, then document order) and select it; Shift + arrow extends the selection to that item; `canvas.focus-downstream` and `canvas.focus-upstream` move to the first node connected to the focused node's outputs or inputs in port order, and repeated presses of the opposite arrow pair (Up/Down) then cycle that node's siblings; `canvas.focus-first` and `canvas.focus-last` move to the trigger and to the last node in dispatch order. Every focus move uses the Reveal command and is announced.
- **Ports**: `canvas.focus-inputs` and `canvas.focus-outputs` move focus to the focused node's first input or output port; Up/Down move between the ports of that side, Left/Right return to the node (or cross to the other side), Enter on a connected port moves focus to its first edge.
- **Edges**: with an edge focused, Left and Right move to its source and target node, Up/Down cycle the edges of the same port, `canvas.rename` edits its label, `canvas.delete` removes it.
- **Connecting**: `canvas.connect` on a focused port starts a keyboard connection: the compatible ports form a list in reading order, Down/Up or the arrow actions move through them with the preview edge drawn to the current candidate and its name announced, Enter creates the edge, Escape cancels. `canvas.connect-to` opens a "Connect to…" dialog with a combobox of compatible targets formatted "<node> · <port> (<type>)", filterable by typing, which creates the same edge; on a node (not a port) it first asks for the source port. Ports that are occupied are offered with "Replace connection".
- **Adding**: `canvas.quick-add` with a node focused lists the node types compatible with that node's first unconnected output, places the chosen node one layer to the right (300 units) in the first free row, connects it and focuses it; with nothing focused it adds at the viewport centre.
- **Moving and sizing**: the nudge actions move the selection by 20 or 100 units; with a resize handle focused (reached with Tab from a selected node, group or note) the arrow keys resize in steps of 20 units.
- **Escape** cancels, in order: a gesture in progress, an open popover or inline field, an active filter or find, then the selection.
Keyboard focus is always visible per "Node interaction states" and `i18n-accessibility.Focus visibility and management`. [NEW]

#### Scenario: Spatial navigation
- **WHEN** a node has focus and the user presses the right arrow
- **THEN** focus and selection move to the nearest item whose centre lies within the 90° sector to the right, the viewport reveals it and its name is announced

#### Scenario: Connect from the keyboard
- **WHEN** the user focuses an output port, invokes `canvas.connect`, presses Down twice and then Enter
- **THEN** an edge is created from that port to the third compatible port in reading order, and each candidate was announced as it was reached

#### Scenario: Connect to… dialog
- **WHEN** the user invokes `canvas.connect-to` on an output port, types "voice" and presses Enter on "Voiceover · script (ScriptRef)"
- **THEN** the same edge is created as by dragging to that port

#### Scenario: Tab is not trapped
- **WHEN** the scene has focus and the user presses Tab
- **THEN** focus moves to the next region (the detail panel when open, otherwise the next focusable control after the canvas)

### Requirement: Outline view and screen-reader support
The canvas SHALL provide an outline view — a structured list that presents the same workflow for people who cannot or prefer not to use the graphical scene — toggled by `canvas.toggle-outline` and the toolbar, replacing the scene on compact and medium form factors and shown either in place of it or as a 320 px panel beside it on wide ones; the choice persists per device. It is built from `design-system` list components with the tree-grid pattern: one row per node in dispatch order (members of a group nested under a row for the group), each with name, localised type, status text, progress, duration, cost, "After: <upstream node names>", "Before: <downstream node names>" and the problem count; sections below list edges ("<source> · <port> → <target> · <port>", kind, label), groups and notes with their full text. The outline and the scene stay in sync in both directions: selecting a row selects and reveals the item on the canvas and the reverse, within 100 ms, and every document or run change appears in the outline within 250 ms. On an editable canvas each row has a menu and buttons for "Open details", "Rename", "Add step after…" (the keyboard quick-add), "Connect to…", "Disconnect…" (lists the row's edges), "Move to group…", "Disable" or "Enable", "Duplicate" and "Delete", and the toolbar keeps Undo, Redo and Auto-layout, so that every structural edit possible on the scene is possible in the outline and submits the same batches. In a run the rows show the quick actions of "Run actions on the canvas". In the run view of `agent-workflows.Run view`, whose step list already serves this purpose, the outline toggle moves focus to that step list instead of rendering a second list. Screen readers: the scene is exposed as a single element named "Workflow canvas, <n> steps, <m> connections" with the hint "Outline view available"; when a screen reader is running and the user has not chosen otherwise, the outline is shown on first open and the message "Showing the outline view" is announced; while the scene has focus, each focus move announces the item's accessible name — for a node "<name>, <type>, <status>, <progress> percent, <duration>, cost <cost>, <i> inputs, <o> outputs, <p> problems", for a port "<label>, <type>, input or output, connected to <names> or not connected", for an edge "Connection from <source> to <target>, <label>". Status changes are announced through a polite live region at most once every 5 s, combining changes ("3 steps finished"), while failures and steps that start waiting for the user are announced immediately. The outline works when the graphical renderer is unavailable (see "Renderer load failure and process loss") and for documents too large for the graphical canvas (see "Oversized documents and upstream schema mismatch"). [NEW] [JAD]

#### Scenario: Equivalent content
- **WHEN** the user switches to the outline for a running run
- **THEN** every node of the graph appears as one row with the same status, progress, duration and cost as on the scene

#### Scenario: Edit without the scene
- **WHEN** the user chooses "Connect to…" on the `script` row and selects "Translate · text (text)"
- **THEN** the same `edge.add` batch is submitted as by dragging on the scene, and the scene shows the new edge

#### Scenario: Selection sync
- **WHEN** the outline is shown beside the scene and the user selects a row
- **THEN** the node is selected and revealed on the scene within 100 ms

#### Scenario: Failure announced
- **WHEN** a node becomes `failed`
- **THEN** the live region announces "<name> failed" immediately, even when another announcement was made less than 5 s earlier

#### Scenario: Screen reader on first open
- **WHEN** a screen reader is running and the user opens a workflow for the first time
- **THEN** the outline is shown and "Showing the outline view" is announced

### Requirement: Contrast, colour independence and target sizes
The canvas SHALL meet `i18n-accessibility.Colour contrast`, `i18n-accessibility.Colour independence` and `i18n-accessibility.Touch target size and gesture alternatives` in both themes: all text drawn on nodes, chips, labels, notes and bars has a contrast ratio of at least 4.5:1 against its own background (status text therefore uses `success/text` and `warning/text`); status borders, status glyphs, ports, port rings, edges in every kind and state, selection and focus rings, guides, badges and diff outlines have at least 3:1 against both `wf/node-bg` and `wf/canvas-bg`; the resting 1 px `border/hairline` border of a node is decorative, since the node is identified by its header text and icon tile. Nothing is conveyed by colour alone: node type has an icon, a silhouette detail and a name; status has a glyph and text; port families have shapes and names in tooltips; edge kinds and states have dash patterns; diff items have "+", "−" and "~" badges; filters and find dim non-matches and also report counts. Dimmed items (25 %–50 % opacity) are never the only place where required information lives: the outline shows it at full contrast. Interactive targets are at least 24 × 24 px for fine pointers and 44 × 44 px for touch regardless of zoom, and every drag gesture (move, connect, resize, marquee, reconnect, slide a label) has the non-drag alternative given in "Keyboard operation of the canvas" or the outline. OS text scaling applies to the toolbar, panels, sheets and outline; text inside the scene is enlarged with zoom, up to 400 %. An automated check renders the golden fixtures in both themes and fails on any listed element below its ratio. [NEW]

#### Scenario: Status text contrast
- **WHEN** a succeeded node is rendered in the light theme
- **THEN** its footer text "Done" uses `success/text` and has a contrast ratio of at least 4.5:1 against `wf/node-bg`

#### Scenario: Greyscale
- **WHEN** a run with nodes in every status is rendered in greyscale
- **THEN** each status is identifiable by its glyph and footer text

#### Scenario: Touch targets at low zoom
- **WHEN** the canvas is at 25 % zoom on a touch device
- **THEN** a tap within 22 px of a node's centre still selects that node

### Requirement: Right-to-left and localisation
The graph SHALL always read left to right — inputs on a node's left edge, outputs on its right, layers increasing to the right, edges pointing right, auto-layout direction unchanged — in every locale and layout direction; the scene is on the non-mirrored list of `i18n-accessibility.Right-to-left readiness`. What does follow the layout direction: the palette (inline-start side), the detail panel (inline-end side), the minimap and zoom controls (inline-end, bottom), toolbars, bars, menus, and the alignment of text inside nodes, notes and labels (start-aligned, with bidirectional text shaped by the platform's text engine); in a right-to-left layout a node's icon tile is at the inline-start (right) end of its header and its status glyph at the inline-end, while port sides do not change. All canvas strings — node type names, statuses, tooltips, menus, toasts, banners, legend, accessible names — come from locale resources in `en`, `vi` and `ja` (`i18n-accessibility.Supported locales and resources`); user content (node names, descriptions, labels, notes) is never translated. Numbers, durations, costs (USD) and dates use `i18n-accessibility.Locale-aware formatting`. Layout tolerates text expansion of 40 % and CJK text (`i18n-accessibility.Text expansion and CJK layout resilience`): chips and labels truncate, the toolbar moves items into its overflow menu, and no string is clipped without an ellipsis. Keyboard shortcuts are bound by physical key per `keyboard-shortcuts.Key grammar and physical-key mapping`. [NEW]

#### Scenario: Right-to-left pseudo-locale
- **WHEN** the app runs under the pseudo-locale `ar-XB`
- **THEN** the palette is on the right, the detail panel on the left, and every node still has its inputs on the left and its outputs on the right

#### Scenario: Vietnamese statuses
- **WHEN** the locale is `vi`
- **THEN** footer status texts, tooltips and the legend are shown in Vietnamese and node names entered by the user are unchanged

#### Scenario: Long translation in a chip
- **WHEN** a localised runtime name is 40 % longer than the English one and exceeds 16 characters
- **THEN** the chip shows 16 characters with an ellipsis and the full name is in the tooltip

### Requirement: Persistence, multi-device editing and offline behaviour
The canvas SHALL have no save action: every completed gesture is submitted as one batch at the end of the gesture, and text edits 800 ms after the last change (`agent-workflows.Editing semantics for the canvas`); positions, sizes, routes, groups, notes and the default viewport therefore persist in the workflow document on the host, revisioned per `agent-workflows.Versioning`. A toolbar indicator shows "Saving…" while a batch is unacknowledged and "Saved" otherwise. Concurrency is the per-object rebase rule of `agent-workflows.Graph operations` and nothing else: a batch based on an older revision is rebased onto the head, geometry always merges, and a semantic operation conflicts only when the same node, edge or document section was changed after the batch's base; workflow documents are never placed under the single-writer edit lease of `cross-device-sync.Single-writer edit lease` (that lease governs video projects and scripts, including the projects that workflow nodes change), so the canvas never requests, renews, shows or takes over a lock; several devices and agents can edit one workflow at the same time — including a person editing while an agent builds at several batches per second — and a batch is refused (`WORKFLOW_REVISION_CONFLICT`) only for the objects listed in `details.conflicts[]`: the canvas reverts exactly those objects to the head's values within 160 ms, keeps every other change of the gesture by re-submitting the non-conflicting operations as a new batch, outlines each conflicting item in `warning/text` for 4 s, and shows per item a notice "<actor> changed this step while you were editing" with "Keep theirs" (default), "Apply mine anyway" (re-submits that operation on the head) and "Save as copy"; a text field that was being edited keeps the user's text in the field until one of the three is chosen, so nothing typed is lost. Every open canvas subscribes to `workflow.doc:<workflowId>` and presents batches from other actors within 250 ms of arrival: moved items animate to their new positions in 160 ms, added and removed items use the enter and exit animations, and each changed item is outlined in `accent/subtle` for 2 s with a chip naming the actor ("<device name>" or "<agent name>"); an item the local user is dragging keeps following the pointer and takes the position of whichever batch the host commits last. On a revision gap or reconnect the document is fetched and redrawn, keeping the viewport and the selection of items that still exist. Device-local view state is listed in "Canvas layout data" and is never synchronised. Offline (`agent-workflows.Storage, RPC surface and Gateway dependency`): the canvas keeps the last fetched document of the 50 most recently opened workflows per device in the client store of `project-storage`, and without a connected host shows it not editable with the chip "Offline — view only" and the banner "Connect to a host to use workflows"; pan, zoom, selection, inspection of stored configuration, find, the outline and image export keep working, while run state shows the last known values marked "as of <time>". When the connection drops during editing, the canvas becomes not editable within 1 s, keeps at most 20 unacknowledged batches in memory and re-sends them in order with their `idempotencyKey` if the connection returns within 60 s; otherwise it reverts them and shows the toast "<n> changes were not saved". [NEW]

#### Scenario: No save step
- **WHEN** the user moves a node, closes the app and opens the workflow on another device
- **THEN** the node is at its new position

#### Scenario: Two devices move different nodes
- **WHEN** device A moves node X while device B, based on an older revision, moves node Y
- **THEN** both moves are kept, and each device sees the other's node animate to its new position within 250 ms of the event arriving

#### Scenario: Edits of different nodes never conflict
- **WHEN** device B changes the prompt of node Y based on revision 8 while an agent has added nodes in revisions 9–14 without touching Y
- **THEN** B's batch is applied by rebase, no notice is shown, and B's canvas keeps the agent's nodes

#### Scenario: Semantic conflict on one node
- **WHEN** device B's batch renames node X and changes the prompt of node Y, and `WORKFLOW_REVISION_CONFLICT` names only Y in `details.conflicts[]`
- **THEN** the rename of X is re-submitted and kept, Y shows the head's value outlined in `warning/text`, B's typed prompt stays in the field, and the notice for Y offers "Keep theirs", "Apply mine anyway" and "Save as copy"

#### Scenario: Short disconnection
- **WHEN** the connection drops for 20 s right after the user renamed a node
- **THEN** the rename batch is re-sent on reconnect and is applied exactly once

#### Scenario: Opened offline
- **WHEN** a previously opened workflow is opened with no host connected
- **THEN** the cached document is shown with "Offline — view only", the palette is absent and PNG export works

### Requirement: Loading, empty and error states
The canvas SHALL present these states, each built from `design-system.Empty, error and offline states` and `design-system.Progress indicators and skeletons`, and MUST NOT draw sample or placeholder graphs:
- **Loading**: when the document is not available within 150 ms, the grid is drawn with a centred 24 px spinner and "Loading workflow…"; the scene appears in one paint when the document and fonts are ready, with no intermediate partial graph. A run overlay that arrives after the document fades in over 120 ms.
- **Empty, editable**: a centred empty state "Start your workflow" with the description "Add a step, or ask an agent to build the workflow for you." and the actions "Add a step" (opens the quick-add menu at the centre) and "Describe it to an agent" (focuses the session composer when hosted in a session, otherwise opens a new session with the Workflows composer of `agent-workflows.Workflows list screen`); the empty state disappears with the first node.
- **Empty, not editable**: "This workflow has no steps".
- **Load failure**: "Unable to load workflow" (or "Unable to load run") with "Retry" and "Copy details"; never another workflow's or run's data.
- **Not found or deleted**: "This workflow no longer exists" with "Back to Workflows"; a workflow in trash shows "This workflow is in Trash" with "Restore" for devices holding `jagentchill.projects.write`.
- **No host**: the requires-host state when nothing is cached, otherwise the offline rules of "Persistence, multi-device editing and offline behaviour".
- **Renderer failure**: per "Renderer load failure and process loss" and "Oversized documents and upstream schema mismatch".
- **Partial failures**: a thumbnail that fails leaves the type icon; a run state fetch that fails leaves the graph without overlay and shows a `warning` banner "Unable to load run status" with "Retry"; a failed image export shows a toast with its `canvas/*` code.
- **Reduced detail**: the chip of "Performance budgets and load shedding".
Banners stack at the top of the canvas region below the toolbar, at most two at once, the more severe first. [NEW]

#### Scenario: Slow load
- **WHEN** the document arrives after 600 ms
- **THEN** the spinner and "Loading workflow…" are shown from 150 ms until the scene appears in a single paint

#### Scenario: Empty editable workflow
- **WHEN** an `editor` device opens a workflow with no nodes
- **THEN** "Start your workflow" is shown with "Add a step" and "Describe it to an agent", and adding the first node removes it

#### Scenario: Run state fails to load
- **WHEN** the run snapshot request fails while the document loaded
- **THEN** the graph is shown without statuses and a banner offers "Retry"

#### Scenario: Deleted workflow
- **WHEN** a deep link opens a workflow that is in trash
- **THEN** "This workflow is in Trash" is shown, with "Restore" only on devices holding `jagentchill.projects.write`

### Requirement: Canvas error codes
The canvas SHALL use exactly these client-side error codes, in the `canvas/<kebab>` form, each with a localised message and included in "Copy details" and in the log categories of `diagnostics-quality.Structured logging`; all other errors shown on the canvas are the codes returned by `agent-workflows.Workflow error codes` and `server-api.RPC error envelope`, displayed unchanged.

| Code | Raised when |
|---|---|
| `canvas/init-failed` | the renderer did not report ready within 10 s of mounting |
| `canvas/process-gone` | the renderer stopped and was not restored after 3 restarts within 60 s |
| `canvas/bridge-timeout` | an intent received no answer within 2,000 ms |
| `canvas/protocol-error` | a command was unknown or failed its schema |
| `canvas/document-too-large` | a document exceeds what the graphical canvas draws |
| `canvas/unsupported-runtime` | the browser engine is listed as unsupported for the graphical canvas; the outline view is shown |
| `canvas/upstream-schema-mismatch` | the projection, the archify CLI packaged with the server or an imported file disagrees with the pinned upstream schema |
| `canvas/export-too-large` | an image export exceeds the pixel limit even at 1× |
| `canvas/export-failed` | an image, video or HTML export failed to encode or write |
| `canvas/clipboard-unavailable` | the platform cannot write an image or fragment to the clipboard |
| `canvas/import-invalid` | a file chosen for archify import is not an importable archify workflow document |
| `canvas/archify-invalid` | `archify validate` reported errors for the projected document (host) |
| `canvas/archify-failed` | an archify child process did not start, failed or timed out (host) |

The two host codes are returned in the error envelope of `jagentchill.workflow.archify.render` with `retryable` false for `canvas/archify-invalid` and true for `canvas/archify-failed`. No canvas error message contains document content, prompts or secret names. [NEW]

#### Scenario: Copy details
- **WHEN** the user activates "Copy details" on the renderer failure banner
- **THEN** the clipboard holds `canvas/init-failed`, the failing step, the platform and the time, and no document content

#### Scenario: Host error passes through unchanged
- **WHEN** an edit is refused with `WORKFLOW_LIMIT_EXCEEDED`
- **THEN** the toast shows that code and its message, not a `canvas/*` code

### Requirement: Test hooks and deterministic rendering
The canvas SHALL be testable end to end. Stable test ids: the container `wf-canvas`; chrome elements `wf-toolbar-<action>`, `wf-palette`, `wf-palette-item-<type>[-<variant>]`, `wf-quick-add`, `wf-detail-panel`, `wf-minimap`, `wf-outline`, `wf-outline-row-<nodeId>`, `wf-diff-bar`, `wf-replay-bar`, `wf-summary-pill`, `wf-banner-<kind>`, `wf-chip-<kind>`; and scene items `wf-node-<nodeId>`, `wf-port-<nodeId>-<portId>`, `wf-edge-<edgeId>`, `wf-group-<groupId>`, `wf-note-<noteId>`. On web and desktop the scene items are elements of the app's document and carry these ids as `data-testid`, so Playwright addresses them directly. On iOS and Android the scene lives inside the canvas WebView, so development and test builds (never release builds) add transparent native proxy views carrying the scene-item test ids over the visible items, so that Maestro can tap, drag and long-press them (`diagnostics-quality.End-to-end tests`). Development and test builds also provide a test bridge — `globalThis.__JC_WF_TEST__` on web and desktop and a native module that forwards to the canvas page on iOS and Android — with `getScene()` (every item's id, kind, confirmed and preview canvas rectangles, screen rectangle, displayed or culled, level of detail, interaction states, run status and accessible name), `hitTest(x, y)`, `getViewport()`, `getFrameStats()` (frames presented, frame-time percentiles, script time per frame, attribute writes per frame, layout reads, route searches, displayed element count, active shedding steps, motion owner, calls of `compileWorkflow`), `setClock(ms)` and `freezeClock()` for the animation clock, `pauseBridge()` and `resumeBridge()`, `whenIdle()` (resolves when no animation, layout, routing, pending intent or pending batch remains) and `getAnnouncements()`. Determinism: the layout function, edge routing, text measurement with the bundled font tables, hit-testing and the scene model are pure functions of the document, the run state, the viewport size, the theme, the locale and the clock, and produce identical results in every runtime the product uses (V8, JavaScriptCore and SpiderMonkey for the canvas runtime — the engines of the Chromium-based, WebKit and Gecko targets of spike S19 — and additionally Hermes for the functions of `packages/workflow`) — node rectangles equal, route points within 0.5 units, and scene rectangles on all platforms within 0.5 px at 100 % zoom. Canvas fixtures (`wf-empty`, `wf-20`, `wf-200`, `wf-types`, `wf-states`, `wf-run`, `wf-diff`, `wf-loop`) live with the fixtures of `diagnostics-quality.Test fixtures`. [NEW]

#### Scenario: Drag in an end-to-end test
- **WHEN** an end-to-end test drags `wf-node-script` by 200 px in a test build and awaits `whenIdle()`
- **THEN** `getScene()` reports the node 200 units to the right at 100 % zoom, on the grid

#### Scenario: Frozen clock
- **WHEN** a test freezes the clock and sets it to 800 ms during a running-node pulse
- **THEN** two consecutive screenshots are identical

#### Scenario: Bridge absent in release
- **WHEN** a release build is inspected
- **THEN** neither the test bridge nor the proxy views exist

#### Scenario: Cross-platform geometry
- **WHEN** `getScene()` is read for the `wf-200` fixture on web, iOS and Android at 100 % zoom
- **THEN** every node's screen rectangle agrees within 0.5 px

### Requirement: Golden-image tests of the canvas
The canvas SHALL be verified by golden-image tests that are a CI gate alongside `diagnostics-quality.Golden-frame tests with tolerance`. Each case renders a fixture with the animation clock frozen at a stated time, at 1,280 × 800 px at 1× and at 390 × 844 px at 2×, in the light and the dark theme, on the CI runtime (Linux, headless Chromium of the pinned Electron version with the bundled fonts), which is the only runtime whose goldens are authoritative. A case passes when at most 0.5 % of pixels differ from the golden by more than 2 (of 255) on any channel, no pixel differs by more than 16, and the structural similarity index is at least 0.99. The suite MUST contain at least one case for: every node type of "Node type visual identities", expanded and collapsed; every interaction state and every run status; every port family and shape; each level of detail; each edge kind, route style and run state, with labels and arrowheads; obstacle-aware and backward routing; groups (expanded, collapsed, each colour) and notes; selection, marquee, alignment guides and spacing hints; the connection preview in its valid, replace and invalid forms; `diff`, `compare` and `replay` modes; the minimap; the reduced-motion static styles; the empty, loading and error states; text in English, Vietnamese and Japanese; the right-to-left pseudo-locale; and the interactive HTML export opened in the CI runtime. Animation is covered by sampling each animation of "Editing animations", "Run-state animations" and "Edge flow animation" at its start, middle and end times with the frozen clock. Parity across platforms is checked separately on the reference devices: the same cases rendered in the Chromium-based runtimes (Android System WebView, the Electron desktop app on macOS, Windows and Linux, and Chromium-based browsers) agree with the CI golden with a structural similarity index of at least 0.98, and the cases rendered in WebKit (iOS, Safari) and Gecko (Firefox), whose glyph rasterisation differs, with at least 0.95, and geometry on every platform within 0.5 px per "Test hooks and deterministic rendering". On failure the job uploads the actual image, the golden and a difference image; goldens change only through the update command and the review rule of `diagnostics-quality.Golden-frame tests with tolerance`. [NEW]

#### Scenario: Within tolerance
- **WHEN** a change alters anti-aliasing so that 0.2 % of pixels differ by at most 3 of 255
- **THEN** the golden case passes

#### Scenario: Regression caught
- **WHEN** a change moves the status glyph by 2 px in every node
- **THEN** the affected cases fail and the job uploads the actual, golden and difference images

#### Scenario: Animation sampling
- **WHEN** the edge draw-on case is rendered with the clock at 0, 120 and 240 ms
- **THEN** the three images show the edge hidden, half revealed and fully revealed with its arrowhead, each matching its golden
