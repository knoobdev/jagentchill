# OpenCut classic inventory (for the JAgentChill port spec)

Source inspected: `/Users/ngocchanh/Project/private/organisations/hdc/jagentchill/.refs/opencut-classic`
Repo: `opencut-app/opencut-classic` (archived), HEAD `cf5e79e919144200294fb9fed22a222592a0aeea` (2026-05-17, "docs: readme").
Inventory date: 2026-10-05. Code was read, nothing was built or run. Size: about 96,000 lines of TS/TSX/Rust/WGSL across `apps/web/src` (≈88k), `rust/` (≈4.8k) and `apps/desktop` (41).

Companion document: `docs/research/opencut-inventory.md` (the rewrite skeleton). Section 5 below gives a verdict for every changelog-derived line of that document.

Paths are relative to the classic repo root. In sections 2.A to 2.D, `W/` (or a bare `timeline/…`, `commands/…` path in 2.A) means `apps/web/src/`.

Tags: **VERIFIED** (read in code), **PARTIAL** (exists but incomplete or unreachable), **STUB** (placeholder), **NOT FOUND** (searched for, absent), **UNVERIFIED** (not read or not confirmed), **BUG?** (probable defect seen by reading; not executed).

---

## 0. Headline findings

1. **Classic is the real editor.** It is a Next.js 16 web app with a TypeScript editor core, a Rust/wgpu compositor compiled to WASM, mediabunny (WebCodecs) for decode and encode, and browser-local storage (IndexedDB + OPFS). There is no server-side project storage.
2. **Storage schema is at v31**, not v25 as the changelog said (31 migrations, section 2.F).
3. **Things a "CapCut-like" spec would expect that do not exist in classic:** transitions (tab is a "coming soon" stub), filters and colour adjustments (Adjustment tab is a stub), any effect other than Blur, audio fades, track lock, track reorder, track rename, cut (only copy/paste), loop playback, playback rate, export range / resolution / fps pickers, GIF or audio-only export, media folders, media search, i18n, login UI, cloud sync, generative AI, text shadow/outline, text auto-wrap, crop, speed ramps, reverse, freeze frame (disabled button), subtitle export, multiple masks per element.
4. **Reachability gaps:** layout guides are implemented but the toolbar trigger is commented out; create-scene and rename-scene commands have no UI; the 1,920-font picker is wired only to the text mask, while a text element's font family is a plain text input; the transcription model picker does not exist (model fixed to `whisper-small`); keybinding import/export exists in the store with no UI.
5. **Probable defects at HEAD (read, not executed).** A port should re-implement these, not copy them:
   - `services/storage/migrations/runner.ts:41-45,98` calls `new IndexedDBAdapter("video-editor-projects","projects",1)` and `projectsAdapter.set(projectId, project)` positionally, while the adapter takes object params (`indexeddb-adapter.ts:8-21,52-58`). As written the migration runner would open the wrong database and write nothing useful.
   - `stickers/providers/index.ts:22` calls `stickersRegistry.register(provider.id, provider)` against a `register({key, definition})` signature (`params/registry.ts:49-57`).
   - `actions/keybindings/persistence.ts:2,4` imports `isShortcutKey` and `isActionWithOptionalArgs`, which no module exports. The file is referenced only by its test.
   - `sounds/use-sound-search.ts:58-65` calls store setters with the wrong argument shapes (pagination).
   - `app/api/sounds/search/route.ts:159-166` never reads `commercial_only` from the request.
   - `media/audio.ts:425-428` leaves library-sound timings in ticks where media clips are converted to seconds (live playback scheduling).
   - Keyframe paste uses the absolute playhead time as element-local time (`commands/timeline/clipboard/paste-keyframes.ts:41-47`).
   - `drizzle.config.ts` points at `./src/lib/db/schema.ts` and `content-collections.ts` at `src/lib/changelog/entries`; both directories moved to `src/db` and `src/changelog`. The SQL migration creates a `waitlist` table and no `feedback` table, the reverse of the current schema.
   These suggest HEAD was mid-refactor (object-params lint rule, `src/lib` flattening). Whether HEAD type-checks or builds is UNVERIFIED.
6. **Docs are stale.** `docs/actions.md`, `docs/keyframes.md`, `docs/effects-renderer.md`, `docs/countries-search.md` and `rust/wasm/README.md` describe older paths or APIs. Trust the code.

---

## 1. Repo architecture

### 1.1 Workspace and tooling

| Item | Detail | Source |
|---|---|---|
| JS workspace | bun 1.2.18 workspaces `apps/*`, `packages/*` (no `packages/` dir exists) | `package.json` |
| Task runner | Turborepo ^2.8.20: `build`, `dev`, `preview`, `deploy`, `lint`, `format`, `check-types` | `turbo.json` |
| Root scripts | `build:wasm` (`wasm-pack build rust/wasm --target bundler --out-dir pkg`), `dev:wasm` (cargo-watch), `publish:wasm` (npm publish `rust/wasm/pkg`), `dev:web`, `build:web`, `deploy:web`, `generate:fonts`, `lint:web`, `test` (`bun test`); `build:tools`/`dev:tools` reference a non-existent `@opencut/tools` | `package.json` |
| Cargo workspace | resolver 2; members `apps/desktop`, `rust/crates/{time,bridge,effects,gpu,masks,compositor}`, `rust/wasm` | `Cargo.toml` |
| Lint / format | ESLint 9 flat config (typescript-eslint, react, react-hooks, jsx-a11y, next) with a custom rule `opencut/prefer-object-params`; Prettier 3; Biome config (tabs, width 80) | `eslint.config.mjs`, `eslint/rules/prefer-object-params.mjs`, `biome.json` |
| TypeScript | root ^6.0.2; `apps/web` ^5.8.3; path alias `@/*` → `apps/web/src/*` | `package.json`, `apps/web/tsconfig.json` |
| CI | "Bun CI" on ubuntu/windows/macos: add wasm32 target, wasm-pack build, `bun install`, `bun run build` in `apps/web`; test step is `echo "No tests implemented yet"` | `.github/workflows/bun-ci.yml` |
| Tests | bun:test files exist under `__tests__` (migrations, keybindings, fps, retime, placement, masks snap, params, animation, stickers, math, update-pipeline); not run by CI | `apps/web/src/**/__tests__` |
| Docker | `docker-compose.yml`: postgres:17, redis:7, `hiett/serverless-redis-http`, `web` (port 3100); `apps/web/Dockerfile` builds Next standalone on `oven/bun:alpine` | `docker-compose.yml`, `apps/web/Dockerfile` |
| Deploy | Cloudflare Workers via OpenNext (`@opennextjs/cloudflare` ^1.18.0), worker name `opencut`, `nodejs_compat` | `apps/web/wrangler.jsonc`, `apps/web/open-next.config.ts` |
| Contribution policy | feature PRs not accepted; repo archived | `.github/CONTRIBUTING.md:3-11`, `README.md:1-5` |

### 1.2 `apps/web` (`@opencut/web` 0.1.0)

| Concern | Choice and version | Source |
|---|---|---|
| Framework | Next.js 16.1.3 (App Router, Turbopack dev, `output: "standalone"`, `removeConsole` in prod), React ^19 | `apps/web/package.json`, `next.config.ts` |
| State | zustand ^5.0.2 for UI stores (persisted to localStorage); editor domain state in a singleton `EditorCore` with 12 managers and subscribe/notify, read via `useEditor` | `src/core/index.ts`, `src/editor/use-editor.ts` |
| Rendering | `opencut-wasm` ^0.2.10 (published npm build of `rust/wasm`: wgpu 29.0.1, WebGPU with WebGL2 fallback); Canvas2D for text, masks, graphics rasterisation | `rust/`, `src/services/renderer` |
| Media I/O | mediabunny ^1.29.1 (demux, WebCodecs decode, encode, mux) | `src/media/mediabunny.ts`, `src/services/renderer/scene-exporter.ts` |
| Audio | Web Audio API; soundtouchjs ^0.3.0 (pitch-preserving retime); wavesurfer.js ^7.9.8 is a dependency but unused | `src/core/managers/audio-manager.ts`, `src/retime/audio-stretch.ts` |
| Transcription | `@huggingface/transformers` ^3.8.1 in a Web Worker (Whisper ONNX) | `src/services/transcription/worker.ts` |
| Storage | IndexedDB (projects, media metadata, saved sounds) + OPFS (media files) + localStorage (UI prefs) | `src/services/storage` |
| Auth | better-auth ^1.2.7 (root lists ^1.4.15), email+password enabled server-side, **no UI** | `src/auth/server.ts` |
| DB | PostgreSQL via drizzle-orm ^0.44.2 + `postgres` ^3.4.5; drizzle-kit ^0.31.4 | `src/db`, `drizzle.config.ts` |
| Rate limiting | `@upstash/ratelimit` ^2.0.6 + `@upstash/redis` ^1.35.4 | `src/auth/rate-limit.ts` |
| Bot protection | `botid` ^1.5.11 (Vercel BotID) | `next.config.ts`, `src/app/layout.tsx:8,31` |
| UI kit | Tailwind CSS ^4.2.1, shadcn "new-york", Radix primitives, lucide-react, `@hugeicons/react`, react-icons, cmdk, sonner ^1.7.1, motion ^12, react-resizable-panels ^2.1.7, react-window ^2.2.7, `@hello-pangea/dnd`, next-themes | `apps/web/package.json`, `components.json` |
| Colour | culori ^4.0.2 | `src/utils/color.ts`, `src/params/index.ts` |
| Content | content-collections (changelog markdown), react-markdown + rehype (blog HTML), `feed` (RSS) | `content-collections.ts`, `src/blog` |
| Validation | zod 4.3.6 (env, API input) | `src/env/web.ts` |
| Misc | nanoid, eventemitter3, use-deep-compare-effect, react-hook-form | `apps/web/package.json` |
| Dev-only | `@napi-rs/canvas` + sharp for the font sprite generator | `apps/web/scripts/generate-font-sprites.ts` |

Source layout (`apps/web/src`, by domain folder): `actions` (action registry, keybindings), `animation` (keyframe model, interpolation), `app` (routes), `auth`, `background`, `blog`, `canvas`, `changelog`, `clipboard`, `commands` (undoable commands), `components` (shell, panels, ui kit), `core` (EditorCore + managers), `data/colors`, `db`, `diagnostics`, `editor` (UI stores), `effects`, `env`, `export`, `feedback`, `fonts`, `fps`, `gradients`, `graphics`, `guides`, `hooks`, `masks`, `media`, `panels`, `params`, `preview`, `project`, `rendering`, `retime`, `ripple`, `selection`, `services` (renderer, storage, transcription, video-cache, waveform-cache), `site`, `sounds`, `speed`, `stickers`, `subtitles`, `text`, `timeline`, `transcription`, `types`, `utils`, `wasm`.

`EditorCore` managers (`src/core/index.ts:18-71`): `timeline`, `command`, `playback`, `scenes`, `project`, `media`, `renderer`, `save`, `audio`, `selection`, `clipboard`, `diagnostics`. The constructor registers default effects and masks, binds a reactor that prunes empty overlay/audio tracks after every command, and starts autosave.

### 1.3 `rust/`

| Crate | Role | Key deps |
|---|---|---|
| `rust/crates/time` | `MediaTime(i64)` ticks at 120,000/s, `FrameRate {numerator, denominator}`, frame rounding, timecode format/parse | tsify-next 0.5, wasm-bindgen 0.2.115 |
| `rust/crates/bridge` | `#[export]` proc-macro generating camelCase wasm-bindgen exports with a single options struct | syn 2.0.117, quote 1.0.45 |
| `rust/crates/gpu` | wgpu device/context, WebGPU detection with WebGL2 fallback, texture import, blit shaders | wgpu 29.0.1, bytemuck 1.25.0, thiserror 2.0.18 |
| `rust/crates/compositor` | frame descriptor, layer/mask/blend shaders, 17 blend modes, texture pool and store | wgpu |
| `rust/crates/effects` | effect pass pipeline; one shader, `gaussian-blur` | wgpu |
| `rust/crates/masks` | jump-flooding SDF and feather | wgpu |
| `rust/wasm` (`opencut-wasm` 0.2.10) | JS bindings: gpu, compositor, effects, masks, perf, time | wasm-bindgen 0.2.116, web-sys 0.3.93, serde-wasm-bindgen 0.6.5 |

Details and API list: section 2.C.4.

### 1.4 `apps/desktop` (`opencut-desktop` 0.1.0)

STUB. GPUI 0.2.2 binary named `opencut` that opens one 1280×720 window with the centred text "OpenCut" on `#0f0f0f` (`apps/desktop/src/main.rs:1-41`, `apps/desktop/Cargo.toml`). It does not depend on any `rust/` crate. `apps/desktop/script/setup{,.ps1}` install native build dependencies only. `script/setup-rust{,.ps1}` install rustup and wasm-pack.

### 1.5 Other content

- `docs/`: `actions.md`, `keyframes.md`, `effects-renderer.md`, `countries-search.md` (all partly stale).
- `notes/primitives-vs-domains.md`: architecture note, no features.
- `AGENTS.md`: business logic is migrating into `rust/`; apps are UI shells.
- `apps/web/public/`: `flags/` (271 SVG), `fonts/` (font-atlas.json + 15 AVIF sprite chunks), `shapes/` (6 legacy SVG), `logos/opencut` and `logos/others` (fal, vercel), `icons/`, `open-graph/`, `effects/preview.jpg`, `platform-guides/tiktok-blueprint.png`, `landing-page-dark.png`, `manifest.json`, `_headers`.

---

## 2. Feature inventory

Sections 2.A to 2.D are the four area sweeps, included in full with their own citations and tags. Sections 2.E to 2.H were read directly for this document.

### 2.A Timeline, selection, commands, clipboard, scenes, playback

All paths are relative to repo root, prefixed `apps/web/src/`. `MediaTime` is integer ticks (`TICKS_PER_SECOND`, defined in `@/wasm`, outside this slice).

#### 1. Data model and track rules

- **Scene track shape** is `{ overlay: OverlayTrack[], main: VideoTrack, audio: AudioTrack[] }`. Display order top to bottom is always `[...overlay, main, ...audio]`. `timeline/types.ts:76-80`, `timeline/components/index.tsx:130-135`
- **Track types**: `"video" | "text" | "audio" | "graphic" | "effect"`. Video tracks carry `muted` and `hidden`; text, graphic and effect carry `hidden` only; audio carries `muted` only. `timeline/types.ts:29-72`
- **Element to track mapping** is strict: audio→audio, text→text, sticker→graphic, graphic→graphic, effect→effect, video→video, image→video. `timeline/placement/compatibility.ts:3-11`
- **Element types**: audio (upload with `mediaId`, or library with `sourceUrl`), video, image, text, sticker, graphic, effect. Common fields are `id, name, duration, startTime, trimStart, trimEnd, sourceDuration?, animations?, params`. `timeline/types.ts:87-173`
- **Capability sets**: maskable is video, image, graphic; retimable is video, audio; visual (hideable, can hold effects) is video, image, text, sticker, graphic. `timeline/types.ts:181-201`, `timeline/element-utils.ts:37-73`
- **Capabilities**: only audio and video tracks can be muted; every track except audio can be hidden. `timeline/track-capabilities.ts:10-20`
- **Default track names**: "Video track", "Text track", "Audio track", "Graphic track", "Effect track"; the main track is named "Main Track". `timeline/tracks.ts:3-9`, `timeline/placement/main-track.ts:4`
- **Track rename**: NOT FOUND. `name` is only used in an aria-label.
- **Track lock**: NOT FOUND (no `locked` field or UI anywhere in the slice).
- **Track reorder**: NOT FOUND (no command or drag handler).
- **Transitions**: NOT FOUND. **Markers other than bookmarks**: NOT FOUND.
- **Total duration** is the max element end across all tracks of the active scene. `timeline/index.ts:14-33`
- **Project duration** uses the main scene only. `timeline/scenes.ts:89-100`

#### 2. Placement, insert index, overlap, main track

- **Overlap rule**: half-open intervals, `start < otherEnd && end > otherStart`. Touching edges are allowed. `timeline/placement/overlap.ts:8-27`
- **Placement strategies**: `explicit`, `firstAvailable`, `preferIndex`, `aboveSource`, `alwaysNew`. `timeline/placement/types.ts:14-25`
  - `explicit`: returns null if the track is missing or the wrong type. It does not check overlap. `placement/resolve.ts:147-166`
  - `firstAvailable`: first same-type track in display order with no overlap (the main track counts for video and image); otherwise a new track at the "highest" index. `placement/resolve.ts:168-188`
  - `preferIndex`: uses the hovered track if compatible and free. Otherwise a new track above or below, chosen by hover half, or by vertical drag direction when the hovered track is an incompatible type. `placement/resolve.ts:190-226`
  - `aboveSource`: the track directly above the source if same type and free; else first available; else new at highest. `placement/resolve.ts:228-271`
- **New-track insert index**:
  - Default: audio goes after the last audio track, effect goes to index 0 (top), others go to `overlay.length` (directly above main).
  - Highest: audio goes to `overlay.length + 1` (first audio slot), others go to 0.
  - `placement/insert-index.ts:3-33`
- **Section constraints**: non-audio tracks can never be inserted below main (clamped to directly above main). Audio tracks can never go above main (forced to `mainIndex + 1`). `placement/insert-index.ts:60-87`, `placement/apply.ts:78-112`
- **Main-track start rule (the only "magnet")**: on the main track, if it has no other elements, or the requested start is at or before the earliest other element's start, the start is forced to 0. `placement/main-track.ts:27-55`
  - The same rule runs for any `startTime` patch, which also clamps negative starts to 0 on every track. `timeline/update-pipeline.ts:97-132`
  - It is also enforced for group moves (`timeline/group-move/resolve-move.ts:372-407`) and paste (`commands/timeline/clipboard/paste.ts:102-125`).
- **Main-track gap closing**: NOT FOUND. Deleting or moving does not close gaps unless ripple is on.
- **Edge quirk**: the overlap test uses the unadjusted start, then the start is snapped to 0. The adjusted position is not re-checked for overlap. `placement/resolve.ts:35-49`
- **Auto-prune empty tracks**: after every `execute` and `redo`, a reactor removes every empty overlay and audio track. Main is never removed. `core/index.ts:49-67`, `core/managers/commands.ts:29,84`
  - Consequence: a standalone `AddTrackCommand` (`timeline.addTrack`) is immediately pruned. Tracks only persist when created together with an element.
  - There is no "add track" button anywhere in the slice.
- **Insert element** (`InsertElementCommand`, `commands/timeline/element/insert-element.ts`):
  - Validates `mediaId`, `sourceUrl`, `stickerId`, a registered graphic `definitionId`, non-empty text content, and `effectType` (lines 157-203).
  - Auto mode uses `firstAvailable`; an optional `insertIndex` overrides the new-track index (lines 228-287).
  - Selects the inserted element (lines 115-124).
  - First-ever element being video or image sets the project `canvasSize` (and `originalCanvasSize` if unset) to the asset dimensions, and `fps` to the video's fps, with `pushHistory: false` (lines 65-111).
- **Default new-element duration** is 5 seconds for text, sticker, graphic, effect and media without a duration. `timeline/creation.ts:3-17`
- **Default text element**: "Default text", fontSize 15, Arial, white, centred, lineHeight 1.2, background padding 30 × 42. `timeline/defaults.ts:31-64`
- **Video defaults** are `isSourceAudioEnabled: true, hidden: false, sourceDuration = duration`. Sticker name is derived from the id. `timeline/element-utils.ts:146-245`

#### 3. Selection

- **State** holds `selectedElements`, `selectedKeyframes` plus an anchor, and `selectedMaskPoints`. Setting elements clears keyframes and mask points. `core/managers/selection-manager.ts:65-71`
- **Active selection kind** priority is mask-points, then keyframes, then elements. `clearMostSpecificSelection` peels one level. `selection-manager.ts:38-49,129-144`
- **Click** on an element selects only it. A plain click on the sole selected element just clears keyframe selection. `timeline/controllers/element-interaction-controller.ts:402-430`
- **Cmd, Ctrl or Shift click** toggles the element in the selection, on mousedown. Shift does not do a range select for elements. `element-interaction-controller.ts:375-377`, `timeline/hooks/element/use-element-selection.ts:110-123`
- **Right-click** on an unselected element selects it first; right-click on a selected one keeps the multi-selection. `element-interaction-controller.ts:362-368`
- **Box select** starts on empty track area, the tracks container background, or the gutter below the tracks.
  - Activates after more than 5 px of movement.
  - Additive with Shift, Ctrl or Cmd; otherwise replaces.
  - Hit test is rectangle intersection against element time-rects using the base track height (expanded keyframe lanes are ignored).
  - `selection/hooks/use-box-select.ts:150`, `timeline/components/index.tsx:339-371`, `timeline/components/selection-hit-testing.ts:78-135`
- **Click on empty area or ruler** clears selection and seeks. It counts as a click only if movement is ≤ 5 px and duration ≤ 500 ms, and not while box-selecting. Clicking the track-labels column clears selection without seeking. `timeline/controllers/seek-controller.ts:66-78,150-171`
- **Select all** selects every element in the active scene. **Escape** (`cancel-interaction`) cancels an in-flight gesture first, otherwise deselects one level. `actions/use-editor-actions.ts:375-412`
- **Selected-track highlight**: rows and labels with any selected element get `bg-accent/50`. `timeline/components/theme.ts:22`, `components/index.tsx:660-664,811-814`
- **Selection scope**: one global active scope; activating another clears the previous one. `selection/scope.ts:9-30`

#### 4. Move (single and group drag)

- **Drag threshold** is 5 px (`TIMELINE_DRAG_THRESHOLD_PX`). `timeline/components/interaction.ts:1`
- If the pointer is released back within 5 px of the origin, the drag is cancelled. `element-interaction-controller.ts:693-702`
- **Group**: dragging a selected element moves the whole selection. Each member keeps its time offset from the anchor. `timeline/group-move/build-group.ts:41-72`
- **Time** is mouse time minus click offset, clamped to ≥ 0, rounded to a frame, then snapped. `element-interaction-controller.ts:170-194`
- **Snap** tests every member's start and end against other elements' edges, the playhead, and other elements' keyframes. Group members are excluded. The closest hit wins. Bookmarks are NOT a snap source for element moves. `timeline/group-move/snap.ts:30-99`
- **Shift held** disables snapping. `element-interaction-controller.ts:462`
- **Existing-track target**:
  - The anchor goes to the hovered track.
  - Other members are assigned to the nearest unused compatible-type track above or below, preserving vertical order. `group-move/resolve-move.ts:216-341`
  - The move is rejected if members would overlap each other or stationary elements. `resolve-move.ts:412-474`
- **Fallback to new tracks**: if the existing-track move is invalid, or the drop target is a new-track zone, one new track is created per member as a contiguous block. `element-interaction-controller.ts:262-286`, `resolve-move.ts:123-200`
  - A mixed audio and non-audio group cannot move to new tracks (returns null, no move). `resolve-move.ts:147-155`
- **Clamp**: no member may start before 0. `resolve-move.ts:354-370`
- **Commit**: `MoveElementCommand` creates planned tracks, validates type compatibility (throws on mismatch), moves the elements, and selects them at their new refs. `commands/timeline/element/move-elements.ts:36-123`
- **Visuals while dragging**:
  - Dragged elements follow the mouse horizontally via `left`, and vertically via `translate3d`. `timeline/components/timeline-element.tsx:256-279,388-391`
  - The source track row is rendered last. `components/index.tsx:787-803`
  - A 2 px primary horizontal drop line shows only for new-track drops. `element-interaction-controller.ts:523-526`, `timeline/components/drag-line.tsx`
- **No live preview of the move in the scene**; the commit happens on mouseup only.
- **Edge auto-scroll** (element drag, bookmark drag, playhead scrub): within 100 px of the left or right viewport edge, scrolls up to 15 px per frame, scaled linearly by proximity. Horizontal only. `timeline/hooks/use-edge-auto-scroll.ts:19-20,55-75`
  - Vertical auto-scroll: NOT FOUND.

#### 5. Trim / resize (single and group)

- **Handles**: 8 px wide (`w-2`) left and right, shown only on selected elements. `timeline-element.tsx:606-655`
- **Group resize**: dragging a handle on a selected element resizes all selected elements by the same delta. `timeline/controllers/resize-controller.ts:219-229`
- **Minimum duration** is one frame (`TICKS_PER_SECOND × fps.den / fps.num`). `timeline/group-resize/compute-resize.ts:36-38`
- **Left-side bounds**: cannot pass the left neighbour's end or time 0. With a `sourceDuration`, cannot extend past `trimStart = 0`. `compute-resize.ts:161-199`
- **Right-side bounds**: cannot pass the right neighbour's start. With a `sourceDuration`, cannot extend past the source end (retime-aware). `compute-resize.ts:201-240`
- **Unbounded extension**: elements without `sourceDuration` (text, sticker, graphic, effect, image) extend freely up to the neighbour. `compute-resize.ts:178-180,221-223`
- **Frame snap**: the delta is snapped to a frame exactly once, then re-clamped. Source bounds beat frame alignment. `compute-resize.ts:81-102`
- **Patch**: left changes `trimStart`, `startTime` and `duration`; right changes `trimEnd` and `duration`. Retimed clips convert clip delta to source delta. `compute-resize.ts:116-159,242-264`
- **Snap sources**: element edges, playhead, keyframes (not bookmarks). Shift disables. `resize-controller.ts:266-323`
- **Live preview** goes through the `previewElements` overlay. On mouseup the preview is discarded and one `UpdateElementsCommand` is committed if anything changed. `resize-controller.ts:348-362`, `timeline/hooks/use-timeline-resize.ts:41-56`
- **Duration change truncates keyframes** past the new end, with a boundary key. `update-pipeline.ts:85-96`, `animation/keyframes.ts:887-903`
- **Left-trim quirk**: keyframes are stored relative to element start and are not shifted on left-trim (the enforce rule only clamps to duration). `update-pipeline.ts:85-96`
- **Retime** (speed change via `updateElementRetime`): rate is clamped and duration recomputed from the visible source span. `update-pipeline.ts:36-81`

#### 6. Split

- **Three variants**, all at the playhead. Targets are the selected elements, or if none, every element strictly under the playhead. `actions/use-editor-actions.ts:220-298`, `element-utils.ts:364-386`
  - `split`: keeps both halves.
  - `split-left` (toolbar "Split left"): `retainSide: "right"`, i.e. deletes the left part.
  - `split-right` (toolbar "Split right"): `retainSide: "left"`, i.e. deletes the right part.
- **No-op** if the split time is at or outside the element's edges. `commands/timeline/element/split-elements.ts:75-80`
- **Result**:
  - The left half keeps its id, with `trimEnd += rightSourceSpan`.
  - The right half gets a new id, `startTime = splitTime`, `trimStart += leftSourceSpan`.
  - Names are suffixed " (left)" and " (right)".
  - Retime-aware; the source split point is rounded once. `split-elements.ts:82-186`
- **Animations** are split at the local time, with boundary keyframes on both halves. `split-elements.ts:115-119`, `animation/keyframes.ts:1231-1290`
- **Selection after split** is the right-side elements. `split-elements.ts:202-204`
- **Split-left with ripple on** seeks the playhead to the first right element's new start. `use-editor-actions.ts:264-271`

#### 7. Ripple editing

- **Toggle**: toolbar button "Ripple editing", persisted in localStorage `timeline-store`, default off. Synced to `CommandManager.isRippleEnabled`. `timeline/timeline-store.ts:27-33,49-55`, `components/providers/editor-provider.tsx:137`
- **Mechanism** is generic, not per-command: tracks are diffed before and after each `execute` and `redo`. `core/managers/commands.ts:22-27,127-153`
- **Vacated intervals**, per track:
  - an element removed entirely (not moved to another track);
  - an element whose end moved earlier, giving `[newEnd, oldEnd]`.
- New-id elements on the same track are subtracted from the vacated set. `ripple/diff.ts:103-141`
- **Shift**: for each freed interval, elements with `startTime >= interval.end` move left by its length. Processed right to left. `ripple/diff.ts:144-165`, `ripple/apply.ts:62-74`, `ripple/shift.ts`
- **Scope**: same track only. No cross-track sync, no insert-ripple (push right).
- **Not covered**: left-trim (start moved later) is not a vacated interval. `ripple/diff.ts:117-123`
- **Not rippled**: `commitPreview` pushes and `pushHistory: false` updates. `commands.ts:39-45`
- **Undo of ripple** is implicit: the originating command restores its pre-execute snapshot.

#### 8. Snapping

- **Toggle**: toolbar "Auto snapping", persisted, default on. `timeline-store.ts:21-25`
- **Shift** temporarily disables it in every gesture.
- **Threshold** is 10 px, converted to ticks at the current zoom. `timeline/snapping/threshold.ts:4-15`
- **Snap point types**: `element-start`, `element-end`, `playhead`, `bookmark`, `keyframe`. `timeline/snapping/types.ts:3-8`
- **Sources per gesture**:

| Gesture | Element edges | Playhead | Bookmarks | Keyframes | Citation |
|---|---|---|---|---|---|
| Element move | yes | yes | no | yes | `group-move/snap.ts:33-43` |
| Resize | yes | yes | no | yes | `resize-controller.ts:284-294` |
| Playhead scrub | yes | n/a | yes | yes | `timeline/controllers/playhead-controller.ts:258-271` |
| Bookmark drag | yes | yes | yes (others) | yes | `timeline/bookmarks/hooks/use-bookmark-drag.ts:105-112` |

- **Playhead scrub quirk**: it ignores the `snappingEnabled` toggle; only Shift disables it. `playhead-controller.ts:255`
- **Keyframe drag**: frame rounding only, no snap points. `timeline/controllers/keyframe-drag-controller.ts:326-332`
- **Indicator**: a 2 px vertical line (`bg-primary/40`) spanning the timeline height, shown during element drag, bookmark drag or resize. The playhead handle turns solid when snapping to the playhead. `timeline/components/snap-indicator.tsx`, `components/index.tsx:406-409,583-585`

#### 9. Clipboard, duplicate, delete

- **Clipboard is in-memory only**, one entry of type `elements` or `keyframes`. No system clipboard. `core/managers/clipboard-manager.ts:11-53`, `clipboard/types.ts:36-52`
- **Cut**: NOT FOUND (no cut action or command).
- **Copy priority**: keyframes if any are selected, else elements. `clipboard/handlers/index.ts:17-35`
- **Paste elements**:
  - At the playhead, preserving relative offsets from the earliest copied element.
  - Grouped by source track, placed with `aboveSource`.
  - New ids and regenerated keyframe ids. Pasted elements become selected.
  - `commands/timeline/clipboard/paste.ts:49-151,182-216`
- **Copy keyframes** works only when all selected keyframes belong to one element. It stores value, interpolation, curve handles, and offset from the earliest. `clipboard/handlers/keyframes.ts:14-35,115-158`
- **Paste keyframes** goes into the first selected element, clamped to `[0, duration]`. `commands/timeline/clipboard/paste-keyframes.ts:21-85`
  - PARTIAL/QUIRK: `time` is the absolute playhead time and is used as element-local time without subtracting the element's `startTime`. `clipboard-manager.ts:73`, `paste-keyframes.ts:41-47`
- **Duplicate** always creates one new track per source track at the "highest" index. Same start time, name suffixed " (copy)", new keyframe ids, duplicates selected. `commands/timeline/element/duplicate-elements.ts:34-101,116-135`
- **Delete** removes the selection and clears it. Dispatch by selection kind: mask points, then keyframes, then elements. `commands/timeline/element/delete-elements.ts:37-64`, `use-editor-actions.ts:300-335`
- **Hide / mute selected elements**: if any target is visible or unmuted, all are hidden or muted; otherwise all are shown or unmuted. `core/managers/timeline-manager.ts:809-863`

#### 10. Drag and drop into the timeline

- **Internal drags** use MIME `application/x-timeline-drag`, with the payload held in `TimelineDragSource` because `getData` is unreadable during dragover. `timeline/drag-source.ts:3-27`
- **Payload types**: media (image, video, audio), text, sticker, graphic, effect. `timeline/drag.ts:9-42`
- **Internal asset drop**:
  - Start time is the mouse X converted to time, frame-rounded.
  - Track is resolved by `preferIndex` on the hovered track.
  - Outside all tracks: a new track above (`mouseY < 0`) or below.
  - `timeline/components/drop-target.ts:103-255`, `timeline/controllers/drag-drop-controller.ts:189-234`
- **New-track drop** is a `BatchCommand[AddTrack, InsertElement]`, so it is one undo step. `drag-drop-controller.ts:328-343`
- **Effect drop**:
  - On a visual element: adds a clip effect, and the target element is dimmed to 50 %. `drag-drop-controller.ts:464-471`, `timeline-element.tsx:551-553`
  - Otherwise: creates an effect element, always on the first existing effect track if any (ignoring the hovered track). `drag-drop-controller.ts:473-490`
- **Media dropped onto an element** ("replace media source"): STUB, returns without action. `drag-drop-controller.ts:435-438`
- **Context-menu "Replace media"** is permanently `disabled`. `timeline-element.tsx:493-498`
- **OS file drop**:
  - Files are processed and added as assets sequentially, with a toast.
  - Each is inserted at the **playhead time**, not the mouse X.
  - If the timeline is completely empty and the file is not audio, it goes onto the main track.
  - `drag-drop-controller.ts:493-582`, `drop-target.ts:120-124`
- The drop line is hidden when hovering a target element. `components/index.tsx:461-466`

#### 11. Zoom, scroll, layout

- **Constants**: base 50 px/s at zoom 1; `TIMELINE_ZOOM_MIN = 0.1` (hook default only); `TIMELINE_ZOOM_MAX = 100`. `timeline/scale.ts`
- **Effective minimum zoom is dynamic**: content fits in 25 % of the container width. Formula is `containerWidth × 0.25 / (max(durationSec, 1) × 50)`, capped at 100. `timeline/zoom-utils.ts:7-26`
- **Zoom-to-fit button or action**: NOT FOUND. The minimum zoom is the only fit behaviour.
- **Buttons** multiply or divide by 1.7. `interaction.ts:3`, `timeline/components/timeline-toolbar.tsx:62-68`
- **Slider** is 0–1 with step 0.005, mapped exponentially as `min × (max/min)^pos`. `zoom-utils.ts:63-90`, `timeline-toolbar.tsx:311-320`
- **Wheel**:
  - Ctrl or Cmd + wheel zooms. The per-frame delta is capped at ±30, factor `exp(-delta/300)`, batched by rAF. Browser zoom is prevented.
  - Shift + wheel, or dominant deltaX, scrolls horizontally, capped at 40 px per event.
  - Plain wheel scrolls vertically.
  - `components/index.tsx:234-294`, `interaction.ts:2`
- **Zoom anchor**:
  - At slider position ≥ 0.15, zoom keeps the playhead at the same viewport offset.
  - Below 0.15 there is no anchoring.
  - Crossing back down restores the scroll position saved when crossing up.
  - `interaction.ts:4`, `timeline/controllers/zoom-controller.ts:145-215`
- **Right padding** is 75 % of the container at minimum zoom, easing to 15 % by 20 % zoom-percent. `zoom-utils.ts:7-47`
- **Persisted view state** is `{zoomLevel, scrollLeft, playheadTime}` per project. Scroll saves are debounced 300 ms. State is restored on mount. `zoom-controller.ts:217-274`, `timeline/defaults.ts:66-70`
- **Initial vertical scroll** goes to the bottom (main and audio tracks visible). `timeline/hooks/use-initial-scroll-bottom.ts:24-41`
- **Scroll sync**: the tracks viewport is the master; the ruler and bookmarks row follow `scrollLeft`, labels follow `scrollTop`. `components/index.tsx:221-230`
  - `timeline/hooks/use-scroll-sync.ts` exists but is not imported by `components/index.tsx`. Use elsewhere is UNVERIFIED.
- **Layout constants** (`timeline/components/layout.ts:3-20`):

| Item | Size |
|---|---|
| Track height: video | 65 px |
| Track height: audio | 50 px |
| Track height: text / graphic / effect | 25 px |
| Track gap | 6 px |
| Labels column width | 112 px |
| Ruler height | 22 px |
| Bookmark row height | 16 px |
| Keyframe lane height | 20 px |
| Keyframe diamond hit size | 14 px |
| Scrollbar | 12 px |
| Content top padding | 2 px |

- The tracks area height is capped at 800 px. `components/index.tsx:91`
- **Pixel snapping**: positions are rounded to the device-pixel grid; indicator lines are 2 px. `timeline/pixel-utils.ts:4,48-57`

#### 12. Ruler and time display

- **Ticks**: frame intervals `[1,2,3,5,10,15]` with ≥ 18 px spacing. `timeline/ruler-utils.ts:10-32`
- **Labels**: frame intervals `[2,3,5,10,15]` with ≥ 120 px spacing. `ruler-utils.ts:10-32`
- **Second multipliers** are `[1,2,3,5,10,15,30,60,120,300,600,900,1800,3600]`, with a 60 s fallback. Ticks are forced to divide the label interval. `ruler-utils.ts:10-32,97-175`
- **Label format**: `MM:SS` on second boundaries (`H:MM:SS` at ≥ 1 h), otherwise `{n}f`. `ruler-utils.ts:198-257`
- **Virtualised**: only ticks in the viewport plus a buffer of `max(200, 15 %)` px are rendered. `timeline/components/timeline-ruler.tsx:56-98`
- **Editable timecode**: click (or Enter/Space) to edit, default format `HH:MM:SS:FF`. Enter or blur applies, Escape cancels. Invalid input shows an error style. The value is frame-snapped and clamped to the duration. `components/editable-timecode.tsx:29,57-102`

#### 13. Playhead, seek, playback

- **Playhead** is a 2 px primary line with a 12 px round handle (`cursor-col-resize`). `timeline/components/timeline-playhead.tsx:115-132`
- **Keyboard**: ArrowLeft and ArrowRight on the focused playhead step one frame, clamped to `[0, duration]`. `timeline-playhead.tsx:79-104`
- **Scrub**:
  - Dragging the handle or mousedown on the ruler starts scrubbing (`isScrubbing = true`).
  - Time is clamped to `[0, duration]` and frame-snapped.
  - No element snap on the initial ruler click; snap applies while moving.
  - On mouseup, view state is saved.
  - `playhead-controller.ts:129-158,232-317`
- **Click-to-seek** on the ruler, bookmark row, empty track area or gutter. `seek-controller.ts:173-209`
- **Seek actions** (`use-editor-actions.ts:88-218`):
  - seek ±1 s by default
  - jump ±5 s by default
  - frame step ±1 frame
  - goto-start, goto-end
  - stop (pause and seek to 0)
- **PlaybackManager** (`core/managers/playback-manager.ts`):
  - `play()` is a no-op if the duration is 0. If at or past the end, it restarts from 0 (42-55).
  - Time advances by wall clock via rAF, rounded to a frame (213-239).
  - **End of timeline**: pauses and sets time to exactly the duration (226-233).
  - `seek` clamps to `[0, duration]` (71-79, 241-244).
  - Volume is 0–1. `setVolume(0)` sets muted. Mute and unmute restore the previous volume (81-112).
  - When timeline edits shorten the duration, the time is re-clamped, and playback pauses if at the end (154-176).
- **Loop playback**: NOT FOUND. **Playback rate / J-K-L shuttle**: NOT FOUND (only per-clip retime exists).
- STUB: `dispatchSeekEvent` and `dispatchUpdateEvent` have empty bodies. `playback-manager.ts:246-256`
- **Auto-follow** during playback (not scrubbing): if the playhead leaves the viewport, scroll to centre it. `playhead-controller.ts:183-213`

#### 14. Bookmarks

- **Model** is `{time, note?, color?, duration?}` per scene, identified by exact frame-rounded time. `timeline/types.ts:12-17`, `timeline/bookmarks/utils.ts:5-13,109-116`
- **Toggle** at the playhead via toolbar button or action: adds a bookmark (sorted) or removes the existing one at that frame. The button shows active when the playhead is on a bookmark. `bookmarks/utils.ts:39-54`, `timeline-toolbar.tsx:203-212`
- **Row** sits under the ruler.
  - Marker is 12 × 15 px, default colour `#009dff`.
  - A translucent range bar is drawn when the duration is wider than 2 px.
  - `timeline/bookmarks/components/bookmarks.tsx:37-42,148-157`, `theme.ts:23`
- **Single click** seeks to the bookmark. **Double-click** opens the popover. Enter or Space seeks. `bookmarks.tsx:161-175`
- **Popover** (`bookmarks.tsx:315-441`):
  - Note text input.
  - Colour picker, with reset-to-default.
  - Duration in seconds: step 0.1, min 0, max is the timeline duration minus the bookmark time.
  - Delete button.
  - Every keystroke in the note is its own undoable command.
- **Drag**: 5 px threshold, frame-rounded, clamped to the duration, snapping as in section 8, edge auto-scroll. Commits `MoveBookmarkCommand` on mouseup. `use-bookmark-drag.ts:145-246`
- **Collision check when moving onto another bookmark's time**: NOT FOUND. `bookmarks/utils.ts:89-107`
- **Preview overlay** "Show bookmark notes" is visible by default. It is a top-left HUD listing notes of bookmarks active at the current time (`time ∈ [start, start + duration]`). `timeline/bookmarks/preview-overlay-source.tsx:10-86`, `bookmarks/utils.ts:130-145`
- **Bookmark context menu**: NOT FOUND (popover only).
- All five bookmark operations are undoable via scene-array snapshots. `commands/scene/*-bookmark.ts`

#### 15. Track header and context menus

- **Track label column** shows, per track: a mute icon (audio and video tracks), a visibility icon (non-audio tracks), and a type icon. Icons turn red (`text-destructive`) when off. `components/index.tsx:673-701,906-935`
- **Track context menu** (right-click on a track row), `components/index.tsx:838-882`:
  - "Paste elements"
  - "Mute track" / "Unmute track" — shown on all tracks, a no-op where unsupported
  - "Hide track" / "Show track" — same
  - "Delete track" — hidden for the main track
- **Element context menu**, `timeline-element.tsx:425-508`:
  - Split
  - Copy
  - Duplicate (single selection only)
  - Mute / Unmute (audio-capable elements whose media has audio)
  - Extract audio / Recover audio (single selected video)
  - Hide / Show (visual elements)
  - Expand keyframes / Collapse keyframes (only if the element has keyframes)
  - Reveal media (single selection with `mediaId`)
  - Replace media (disabled)
  - separator
  - "Delete N elements" / "Delete text" / "Delete clip"
  - Shortcut hints are shown at the right.
- **Empty-area context menu**: NOT FOUND separately; right-click anywhere in a track row gives the track menu.
- **Keyframe context menu**: NOT FOUND.

#### 16. Toolbar (complete list)

- **Left**, `timeline-toolbar.tsx:145-242`:
  - Split element
  - Split left
  - Split right
  - Extract / Recover audio (disabled unless one eligible video is selected)
  - Duplicate element
  - Freeze frame — STUB, disabled, tooltip "Freeze frame (coming soon)" (186-191)
  - Delete element
  - Add / Remove bookmark
  - Graph editor (disabled with a reason tooltip unless a valid keyframe selection exists)
- **Centre**: scene split-button showing the current scene name, plus a layers icon that opens the Scenes sheet. `timeline-toolbar.tsx:248-265`
- **Right**: Auto snapping toggle, Ripple editing toggle, zoom-out button, zoom slider, zoom-in button. `timeline-toolbar.tsx:286-327`

#### 17. Element rendering

- **Colours**: text `#5DBAA0`, audio `#8F5DBA`, graphic `#BA5D7A`, effect `#5d93ba`, video and image transparent (thumbnail). `timeline/components/theme.ts:12-19`
- **Video / image**: a single thumbnail tiled with `repeat-x`. Tile width is track height × 16/9. Not a per-time filmstrip. `timeline-element.tsx:1084-1134`
  - A top header shows the media name over a gradient.
  - A wand button appears if the clip has effects; it selects the clip and opens the Effects tab.
- **Audio**: name header plus a canvas waveform.
  - 1 px bars with a 1 px gap, colour `rgba(255,255,255,0.7)`.
  - A "burn" colour `rgba(255,110,20,0.9)` is defined; the clipping logic was UNVERIFIED.
  - Gain-aware via 200 gain samples; trim- and retime-aware; draws only the visible portion.
  - `timeline/components/audio-waveform.tsx:18-22`, `timeline-element.tsx:981-1052`
- **Audio volume line**:
  - A horizontal line with a 14 px hit area, dragged vertically.
  - Range −60 to +20 dB, step 0.1, mapped on a power-2 linear-gain curve.
  - Tooltip shows "x.x dB". Live preview, then `commitPreview`.
  - Selects the element on pointer down.
  - Hidden when volume has keyframes.
  - `timeline/components/audio-volume-line.tsx:22-50,226-228`, `timeline/audio-display.ts:4-41`, `timeline/audio-constants.ts`
  - Rendered for audio elements only; video clips on video tracks show no waveform or volume line. `timeline-element.tsx:1176-1180`
- **Text** shows its content. **Effect** shows a wand icon and name. **Sticker / graphic** show a 16 px preview and name. `timeline-element.tsx:904-979`
- **Selected**: 1.5 px primary ring and resize handles. `timeline-element.tsx:94,565-570`
- **Hidden element**: 50 % opacity. **Muted element style**: NOT FOUND (only the menu label changes). `timeline-element.tsx:551-553,593`
- **Empty track** shows a dashed placeholder border. `timeline/components/timeline-track.tsx:80-81`
- **Fade handles, clip speed badge**: NOT FOUND.

#### 18. Keyframes in the timeline

- **Inline diamonds**: only on selected elements at least 40 px wide. Keyframes at the same time merge into one diamond. Filled primary when selected, white otherwise. `timeline-element.tsx:93,141-186,727-734`
- **Expanded lanes**:
  - Toggled per element via the context menu. Not persisted.
  - One 20 px lane per animated property path.
  - Group order: transform and opacity, then volume and colour, then `background.*`, then `params.*`, then `effects.*`.
  - Labels are shown in the track-label column.
  - Track height grows by the tallest expanded element.
  - `timeline-store.ts:35-54`, `timeline/components/expanded-layout.ts:18-117`
- **Click** a keyframe: seeks to it (frame-snapped) and selects it. Cmd or Ctrl toggles. Shift selects a range from the anchor (with Cmd or Ctrl, additive) in time-then-path order. `keyframe-drag-controller.ts:164-213`, `timeline/hooks/element/use-keyframe-selection.ts:115-216`
- **Drag**: 5 px threshold, moves all selected keyframes by a frame-rounded delta, each clamped to `[0, element.duration]`. Commits a `RetimeKeyframeCommand` (batched if multiple). Horizontal only. `keyframe-drag-controller.ts:264-355`
- **Box select** in lanes, with a 14 px diamond hit box. Additive with Ctrl or Cmd (default of `useBoxSelect`). A plain click on empty lane clears keyframe selection. `timeline/hooks/element/use-keyframe-box-select.ts:109-208`, `use-box-select.ts:91-93`
- **Add / upsert**: `UpsertKeyframeCommand` clamps time to `[0, duration]`. The property must resolve to a keyframable param. The add-keyframe UI lives in the properties panel (outside this slice). `commands/timeline/element/keyframes/upsert-keyframe.ts:65-89`
- **Remove**: if the channel becomes empty, the value at the playhead is written to the base param. `commands/timeline/element/keyframes/remove-keyframe.ts:29-47`, `timeline-manager.ts:537-585`
- **Animatable built-in paths**: `transform.positionX/positionY/scaleX/scaleY/rotate`, `opacity`, `volume`, `color`, `background.color/paddingX/paddingY/offsetX/offsetY/cornerRadius`. `animation/types.ts:4-19`
  - Plus `params.<key>` (graphic) and `effects.<id>.params.<key>`.
  - Gated by `param.keyframable !== false`. `timeline/animation-targets.ts:59-61,177-210`
  - Scale X and Y are grouped as `transform.scale`. `animation/types.ts:26-28`
- **Interpolation**: `"linear" | "hold" | "bezier"` (discrete values: hold only). Segment types are `step | linear | bezier`. Tangent modes are `auto | aligned | broken | flat`. Extrapolation is `hold | linear`. `animation/types.ts:48-56`
- Effect-param keyframe commands accept only `linear` and `hold`. `timeline-manager.ts:663`

#### 19. Graph editor

- **Popover** opens from the toolbar. It is enabled only when the selection resolves to an editable segment. Otherwise the tooltip gives the reason (`timeline/components/graph-editor/session.ts:254-537`):
  - "Select a keyframe to edit its curve."
  - "Selected keyframes must be on the same element."
  - "Select at most two adjacent keyframes per property."
  - "Select a keyframe that has an outgoing segment."
  - "Selected keyframes must be adjacent on each property."
  - "Hold segments have a fixed value - easing has no effect here."
  - "Cannot edit a segment where both keyframes are at the same time."
  - "Selected properties do not share a graph-editable channel."
- **Scope**: edits the easing of one segment (keyframe to next) as a normalised cubic bezier. With multiple properties it applies to all. A component switcher appears for multi-component properties. `session.ts:592-610`, `graph-editor/popover.tsx:91-111`
- **Not a full value/time curve editor**. Multi-key graph editing: NOT FOUND.
- **Bezier graph** (`graph-editor/bezier-graph.tsx:10-21,117-148`):
  - 140 × 94 SVG with two draggable handles.
  - X is clamped to 0–1, Y to −0.5–1.5.
  - Y snaps to 0 or 1 within 0.06, unless Shift is held.
  - Live preview via `previewElements`; committed on pointer-up.
- **Linear detection**: `[0,0,1,1]` is stored as a `linear` segment with handles removed; anything else as `bezier` with handles. `session.ts:612-668`
- **Built-in presets**: Smooth `[0.25,0.1,0.25,1]`, Ease out `[0,0,0.2,1]`, Ease in `[0.8,0,1,1]`, In out `[0.4,0,0.2,1]`, Pop `[0.175,0.885,0.32,1.275]`, Linear `[0,0,1,1]`. Active-preset match tolerance is 0.02. `graph-editor/easing-presets.ts:3-19`
- **Custom presets**: the "Saved" tab has a "Save" tile that stores the current curve as "Custom N" in localStorage key `graph-editor-presets`. Delete on hover. Synced across tabs via the `storage` event. `graph-editor/custom-presets-store.ts:8,82-101`
- **Rename custom preset**: NOT FOUND.
- Escape or closing the popover discards the preview. `graph-editor/use-controller.ts:67-89`

#### 20. Scenes

- **Model** is `{id, name, isMain, tracks, bookmarks, createdAt, updatedAt}`. A main scene named "Main scene" is auto-created if missing. `timeline/scenes.ts:11-47`
- **Scenes sheet** (`components/editor/scenes-view.tsx:35-172`):
  - Lists scenes; click switches.
  - "Select" mode multi-selects for delete, with a confirm dialog.
  - Delete is disabled if the main scene is selected.
- **Create scene and rename scene**: PARTIAL. `CreateSceneCommand`, `RenameSceneCommand` and the manager methods exist, but no UI caller was found. `commands/scene/create-scene.ts`, `commands/scene/rename-scene.ts`, `core/managers/scenes-manager.ts:33-85`
- **Delete**: the main scene cannot be deleted. If the active scene is deleted, the editor falls back to main. `timeline/scenes.ts:49-72`, `commands/scene/delete-scene.ts`
- The dialog says "cannot be undone", but the command does implement undo.
- **Switch scene** is not a command, so it is not undoable. It updates `project.currentSceneId`. `scenes-manager.ts:87-111`
- **Nested scenes as clips, scene reorder, scene duplicate**: NOT FOUND.

#### 21. Source audio separation

- **Extract audio** (single selected video whose media has audio):
  - Creates an upload-audio element with the same media, start, duration, trims and retime.
  - Copies `volume` and `muted` params, and clones volume keyframes.
  - Places it on the first available audio track, or a new one.
  - Sets `isSourceAudioEnabled = false` on the video.
  - `timeline/audio-separation/index.ts:75-107`, `commands/timeline/element/toggle-source-audio-separation.ts:64-110`
- **Recover audio** only re-enables the flag on the video. It does not delete the previously extracted audio element. `toggle-source-audio-separation.ts:52-62`
- **Linking between video and extracted audio**: NOT FOUND.

#### 22. Command system and undo/redo

- **`Command`** has abstract `execute()` returning an optional selection patch. Default `undo()` throws. `redo()` defaults to `execute()`. `commands/base-command.ts:21-31`
- **`BatchCommand`** executes in order and undoes in reverse; the last selection result wins. `commands/batch-command.ts`
- **History** is two unbounded arrays (`history`, `redoStack`). Any new command clears redo. `core/managers/commands.ts:15-16,35`
- **History limit**: NOT FOUND.
- `clear()` exists, but no caller was found in `apps/web/src` (history appears to persist across project switches — UNVERIFIED outside this slice).
- **Undo strategy**: nearly all timeline commands snapshot the whole `SceneTracks` (or the scenes array) at execute and restore it on undo.
- **Selection on undo** is restored only for commands that returned a selection override. `commands.ts:51-67`
- **`execute` vs `push`**: `push` records an already-applied change with no ripple and no reactors. It is used by `commitPreview` through `TracksSnapshotCommand`. `commands.ts:39-45`, `timeline-manager.ts:744-760`
- **Preview overlay**: `previewElements` merges per-element patches into `previewTracks` (render-only). `commitPreview` turns it into one undo step. `discardPreview` drops it. Any `updateTracks` clears it. `timeline-manager.ts:706-797,929-934`
- **`PreviewTracker`** class: defined but unused. `commands/preview-tracker.ts`
- **Not undoable**: selection changes, scene switch, playback and seek, zoom and scroll, snapping and ripple toggles, lane expansion, custom presets, `pushHistory: false` updates, and the auto canvas-size and fps change on first insert.
- **Track mute / hide** are undoable commands. On unsupported tracks they push a no-op history entry. `commands/timeline/track/toggle-track-mute.ts`, `toggle-track-visibility.ts`
- **Remove track** only filters overlay and audio. `commands/timeline/track/remove-track.ts:15-19`
- **Other commands** (existence only; bodies not read): clip effects (add, remove, toggle, reorder, update params), masks (remove, toggle inverted, insert and delete freeform points), effect-param keyframes (upsert, remove), media (add, remove), project settings. `RemoveMediaAssetCommand` also deletes timeline elements that use the asset. `commands/media/remove-media-asset.ts:46-61`

#### Files in the slice NOT read (or only partially)

- `timeline/components/audio-waveform.tsx` — only lines 18-140 skimmed; drawing and burn logic UNVERIFIED.
- `timeline/components/graph-editor/session.ts` — messages and patch builders read; channel and component resolution (≈ lines 105-420) not read.
- `timeline/components/timeline-element.tsx` lines 1-92, `components/index.tsx` lines 1-59, `timeline-toolbar.tsx` lines 1-29 (imports only).
- `timeline/hooks/use-scroll-sync.ts` — read, but call sites not checked.
- `animation/keyframes.ts` — only upsert, remove, retime, clamp and split entry points; channel split internals and `updateScalarKeyframeCurve` not read.
- `animation/interpolation.ts` — only `normalizeScalarChannel`.
- Not read in `animation/`: `bezier.ts`, `curve-bridge.ts`, `graph-channels.ts`, `keyframe-query.ts`, `resolve.ts`, `values.ts`, `channel-data.ts`, `effect-param-channel.ts`, `graphic-param-channel.ts`, `index.ts`, `transform.ts`, tests.
- `selection/selectable-surface.tsx`, `selectable-item.tsx`, `context.tsx`, `attributes.ts`, `index.ts` (generic list selection, not used by the timeline code I read).
- `commands/timeline/element/effects/*`, `masks/*`, `keyframes/upsert-effect-param-keyframe.ts`, `keyframes/remove-effect-param-keyframe.ts`, `commands/media/add-media-asset.ts`, `commands/project/update-project-settings.ts` — class existence only.
- `core/managers/scenes-manager.ts` lines 76-84.
- All `__tests__` (`timeline/__tests__/update-pipeline.test.ts`, `timeline/placement/__tests__/resolve.test.ts`).
- Read outside the slice because it defines the timeline action semantics: `actions/use-editor-actions.ts:30-508`. Keybinding definitions were not read.

### 2.B Preview, canvas, masks, graphics, stickers, text, fonts, effects, params

Path shorthand: `W/` = `apps/web/src/`. Everything below comes from reading the code; nothing was run. Files I only partly read are listed at the end.

#### 1. Preview surface and render loop
- The compositor's output canvas is mounted directly into the preview and sized to the scene rect. The CSS background is the project colour, or transparent when the background type is `blur`. `W/preview/components/index.tsx:170-183,311-324`
- The scene tree is rebuilt (deep-compare) when tracks, media assets, background or canvas size change, with `isPreview: true`. `index.tsx:105-119`
- A RAF loop renders only when the frame index or the tree changes. Render time is `min(currentTime, lastFrameTime)`, and re-entry is blocked while a render is pending. `index.tsx:185-214`
- GPU-unsupported notice: when `!isGpuAvailable()` a banner reads "For the best experience, open OpenCut in Chrome." It has a dismiss button, and dismissal is component state only (not persisted). `W/app/editor/[project_id]/page.tsx:60-79`, `W/components/providers/editor-provider.tsx:41-42`

#### 2. Zoom, pan, fit
- Zoom is relative to fit, where fit = `min(vw/cw, vh/ch)`. Constants: `PREVIEW_ZOOM = {min: 0.25, max: 16, step: 1.25}`; presets `[25, 50, 75, 100, 150, 200]`. `W/preview/zoom.ts:1-7`, `preview-viewport.tsx:167-196`
- Presets are absolute percentages of native canvas pixels (`percent/100/fitScale`), clamped to min/max. `preview-viewport.tsx:333-339`
- The label shows "Fit" when zoom ≈ 1 (epsilon 0.001), otherwise `round(scale*100)%`. `toolbar.tsx:101-132`, `preview-viewport.tsx:24,495,505`
- Ctrl/Cmd + wheel zooms: delta is capped at ±30 per frame, factor is `exp(-delta/300)`, RAF-batched. Zoom is about the current view centre, not the cursor. `index.tsx:237-256`, `preview-viewport.tsx:257-263`
- Plain wheel pans on both axes, only when zoom > 1. Line and page delta modes are normalised (×16, ×container size). `index.tsx:38-56,258-280`
- Middle-mouse drag pans, only when zoom > 1, with a `grabbing` cursor. `preview-viewport.tsx:23,395-464`
- The pan centre is clamped so the canvas always covers the viewport, and re-centres when the canvas fits. `preview-viewport.tsx:107-165,476-488`
- `fitToScreen` resets zoom to 1 and centres. Zoom and pan also reset whenever the canvas size changes. `preview-viewport.tsx:300-306,466-474`
- `zoomIn`, `zoomOut` (×/÷1.25) and `setActualSize` exist on the viewport context; where they are bound is UNVERIFIED (keybinding slice). `preview-viewport.tsx:308-331`

#### 3. Fullscreen
- Uses the native Fullscreen API on the whole preview panel (canvas plus toolbar). It toggles via `document.fullscreenElement`, and the context menu portals into that container. `W/hooks/use-fullscreen.ts`, `index.tsx:72`, `context-menu.tsx:54`

#### 4. Toolbar controls
- Left: editable current timecode in `HH:MM:SS:FF` (seeks on change), then `/` and total duration. `toolbar.tsx:62-99`
- Centre: play/pause button, which calls `invokeAction("toggle-play")`. `toolbar.tsx:134-146`
- Right: zoom select (Fit, separator, six presets), a separator, and the fullscreen button. `toolbar.tsx:38-57`
- **STUB**: the guides popover trigger is commented out with the note `v0.4.0`, so there is no UI to pick a guide. `toolbar.tsx:41-53`

#### 5. Preview context menu
- Items in order: "Fit to screen", separator, "Full screen", "Save snapshot", "Copy snapshot". Snapshot failures show a toast. `context-menu.tsx:31-67`
- After a separator, one checkbox per overlay control. The only one is "Show bookmark notes" (id `bookmark-notes`, default visible). `context-menu.tsx:68-82`, `W/timeline/bookmarks/preview-overlay-source.tsx:10-14`
- There are no element-level items (delete, duplicate, order): NOT FOUND.

#### 6. Overlay system and bookmark hook
- Overlay instances have a mount (`hud` with four corner anchors and an order, `scene`, or `viewport`), a plane (`under-interaction` or `over-interaction`), a z-index and pointer-events. `W/preview/overlays.ts:3-44`, `overlay-layer.tsx:10-197`
- Visibility is `overlays[id] ?? defaultVisible ?? true`. `overlays.ts:66-74`
- Sources are merged in the editor page: the guide overlay (scene mount, under-interaction) and bookmark notes. `page.tsx:98-125`, `W/guides/preview-overlay.tsx`
- Bookmark notes render as a top-left HUD stack for bookmarks active at the playhead with a non-empty note. Each has a 3px left border in the bookmark colour (or primary). `preview-overlay-source.tsx:16-86`
- Preview store: persisted under `preview-settings` v6 with `activeGuide`, `overlays`, `gridConfig`. The migration resets overlays and maps the legacy `layoutGuide.platform`. `W/preview/preview-store.ts:49-103`

#### 7. Guides
- Registry: `grid`, `tiktok`, `ig-reels`, `yt-shorts`, `spotlight`. Only one guide is active at a time; choosing it again turns it off. `W/guides/registry.tsx`, `preview-store.ts:55-59`
- Grid: rows and columns each 1–24, default 3×3, drawn as 1px white/35 lines. Options are two scrubbable number fields with reset. `W/guides/grid.ts:1-4`, `W/guides/definitions/grid.tsx:80-105`
- TikTok: a static SVG UI mock-up with viewBox 1080×1920, stretched to the scene. `W/guides/definitions/tiktok-layout.tsx`, `platforms.tsx:47-50`
- **STUB**: Reels, Shorts and Spotlight have `renderOverlay: () => null`; only the Brandfetch logo is defined. `platforms.tsx:30-46,51-65`
- **STUB**: the custom guide has an "Add guide line" button with no handler, a null overlay, and is commented out of the registry. `W/guides/definitions/custom.tsx:6-23`
- **PARTIAL**: the popover (3-column picker plus animated options) is fully implemented but unreachable. `guide-popover.tsx:15-59`

#### 8. Selection and hit-testing
- Candidates are elements live at the playhead (`start ≤ t < start+duration`), excluding hidden elements, hidden tracks, and audio/effect elements. `W/preview/element-bounds.ts:120-121,248-309`
- Z-order: `overlay[0]` is topmost, the main track is bottom. Within a track, later `startTime` (then id) is on top. `element-bounds.ts:260-279`, `W/preview/hit-test.ts:46`
- The hit shape is the rotated bounding rectangle; there is no alpha or pixel test. `hit-test.ts:4-33`
- Bounds per type:
  - Video/image: contain-fit of the source size × scale.
  - Sticker: intrinsic size, fallback 200.
  - Graphic: 512×512.
  - Text: the measured glyph block unioned with the background rect.
  - Effect spill and mask clipping are excluded by policy. `element-bounds.ts:103-199`
- Click (no drag): selects the topmost hit only; empty space clears the selection. There is no shift/ctrl multi-select in the preview. `preview-interaction-controller.ts:416-432`
- Drag: threshold 0.5 canvas units. It prefers an already-selected element under the pointer, otherwise the topmost hit, which then becomes the selection. If the target is in a multi-selection, all selected visual elements move by the same delta. `preview-interaction-controller.ts:33,165-205,478-526`
- Only the primary button acts. Pointer-cancel discards the preview; a registered canceller aborts the drag. `:338,403-404`, `use-preview-interaction.ts:74-77`
- Canvas selection, drag and double-click are all disabled while text is being edited or in mask mode. `:305,336-337`

#### 9. Move, scale, rotate handles
- Handles show only for exactly one selected, currently visible, visual element. `transform-handle-controller.ts:197-213`, `transform-handles.tsx:47-50`
- Sizes: handle 10px, hit area 18px, edge handle 6×14, rotate icon radius 10, outline white at 75%. `handle-primitives.tsx:7-12,243-252`
- Four corner handles scale uniformly about the centre (distance ratio applied to both `scaleX` and `scaleY`). `transform-handle-controller.ts:580-638`
- Three edge handles (right, left, bottom; there is no top) scale one axis symmetrically about the centre. `element-bounds.ts:204`, `:640-734`
- Scale is clamped to |s| ≥ 0.01 with sign preserved, so dragging an edge through the centre gives a negative scale. That is the only flip mechanism. `preview-snap.ts:8`, `:167-172`
- Starting a scale drag removes existing scale keyframes: both channels for corners, the dragged axis for edges. `:215-279,632-634`
- The rotate handle sits 24px above top-centre (`ROTATION_HANDLE_OFFSET`). Rotation is the angle delta about the bounds centre. `element-bounds.ts:201`, `:736-770`
- Cursors follow the handle angle in 45° buckets. `handle-primitives.tsx:14-20`
- **Shift only disables snapping** for move, scale, rotate and mask drags. There is no axis-lock or aspect modifier. `W/hooks/use-shift-key.ts`, controller `:546,601,680,751`

#### 10. Snapping
- Threshold is 8 screen px, converted to canvas units by the zoom scale. `preview-snap.ts:9`, `preview-coords.ts:90-100`
- Targets are **canvas centre and canvas edges only**. Snapping to other elements is NOT FOUND. `preview-snap.ts:82-87,120-121`
- Move: the element centre or either AABB edge (rotation-aware) snaps per axis, closest candidate wins. `:89-181`
- Corner scale: any AABB edge snaps to the canvas left/centre/right or top/centre/bottom. Edge scale snaps per axis with a preference for the dragged edge. `:189-365,374-517`
- Rotation snaps to multiples of 90° within ±5°. `:6-7,524-539`
- Guides are 1px white/70 full-viewport lines. `snap-guides.tsx:25-45`

#### 11. In-place text editing
- Double-click when the topmost hit is a text element opens a `contentEditable` overlay at the element's position, scale and rotation, with all text selected. `preview-interaction-controller.ts:304-327`, `text-edit-overlay.tsx:34-43,109-118`
- The overlay text is transparent (the canvas renders the glyphs). The caret takes the text colour, and the background and padding are mirrored. `text-edit-overlay.tsx:127-147`
- Each input previews `params.content = innerText`. Enter inserts a newline (`whitespace-pre`). Escape or blur commits; there is no cancel-without-commit. `:45-64,149`
- Starting playback commits the edit. `preview-interaction-controller.ts:470-476`
- Quirk: the overlay uses the X display scale for both axes. `text-edit-overlay.tsx:115`

#### 12. Masks
- Mask mode is active when the properties tab for the element type is `masks`. Mask handles then replace transform handles. `preview-interaction-overlay.tsx:28-30,95-99`
- **PARTIAL**: one mask per element. The add button is disabled, with the tooltip "Only one mask is supported right now…". `W/masks/components/masks-tab.tsx:259-279`
- Add menu: hovering an item live-previews the default mask, clicking commits. `masks-tab.tsx:184-236,288-300`
- Header buttons: invert toggle (`params.inverted`) and remove; both are undoable commands. `masks-tab.tsx:340-369`, `W/commands/timeline/element/masks/toggle-mask-inverted.ts:7-27`, `remove-mask.ts:6-16`
- Registered types (menu order): Split, Cinematic Bars, Rectangle, Ellipse, Heart, Diamond, Star, Text, Pen tool. `W/masks/builtin/definitions/index.ts:41-78`

Base params on every mask (`W/masks/registry.ts:30-58`, `W/masks/feather.ts:1`, `box-like.ts:97-105`):

| Param | Range | Default | Notes |
|---|---|---|---|
| `feather` | 0–1000, step 1 | 0 | shown as 0–100% (`masks-tab.tsx:783-790`) |
| `strokeWidth` | 0–100, step 1 | 0 | |
| `strokeColor` | colour | `#ffffff` | |
| `strokeAlign` | inside / center / outside | center | select shown only for box-like masks |
| `inverted` | boolean | false | header button only |

Box-like params for rectangle, ellipse, heart, diamond, star, cinematic bars (`W/masks/builtin/box-like.ts:29-95`):

| Param | Display range | Stored default |
|---|---|---|
| `centerX`, `centerY` | −100…100 (% of element, ×100) | 0 |
| `width`, `height` | min 1%, no max | 0.6 |
| `rotation` | 0–360, step 1 | 0 |
| `scale` | 1–500% | 1 (no UI for box-like; only shown for uniform masks) |

- Defaults: a square of 60% of the element's short side. `box-like.ts:122-146`, `W/masks/dimensions.ts:1-2`
- Cinematic bars: height-only, width forced to at least the element width (default = diagonal), height 0.6. `cinematic-bars.ts:15-36,103`
- Star mask: fixed 5 points (10 vertices), inner ratio 0.45. `star.ts:12-13`
- Split: `centerX`/`centerY` −100…100, rotation 0–360, no size. Feather is a linear gradient across the line, and dragging the position is clamped to the canvas. `split.ts:131-143,185-190,238-268`
- Text mask params: content (default "Mask"), font family (Arial), fontSize 5–300 (default 15), letter spacing −100…500 step 1, line height 0.1–10 step 0.1 (default 1.2), position, rotation, scale. Alignment is fixed to centre. `text.ts:39-87,345-368`, `masks-tab.tsx:645-663,688-734`
- Text mask is inactive when the content is blank. Bold, italic and decoration fields exist in the params but have no UI. `text.ts:370-372`
- Mask stroke rendering: box-like masks offset the path by ±width/2 for inside/outside. Text and pen tool stroke then composite `destination-in` or `destination-out`. `box-like.ts:107-120`, `text.ts:398-441`, `freeform/definition.ts:456-500`

Handle interactions:
- Outline or line body drag moves the mask. Split and box masks get a rotate icon and a feather icon, both offset 20 screen px. `W/masks/handle-positions.ts:14-15,99-142,197-227`
- The feather handle slides out by `feather × 0.11`; dragging changes feather by `projection / 0.11`, clamped 0–1000. `W/masks/param-update.ts:16-25`
- Width-height masks: four corners (uniform) plus left, right and bottom edges. Height-only: top and bottom. Uniform (text): one bottom-right scale handle. `handle-positions.ts:229-395`
- Size is clamped to a minimum of 0.01. `box-like.ts:237-287`
- Quirk: box-mask rotation uses `atan2` of the drag delta vector rather than the angle about the pivot. Text, pen and split use a proper pivot angle. `box-like.ts:220-224` vs `text.ts:159-178`
- Mask snapping targets the **element's own box** (centre and edges), not the canvas. Rotation snaps at 90° ±5°. Shift disables. `W/masks/snap.ts:102-108,141-143`, `W/masks/use-mask-handles.ts:558-567`

Pen tool (freeform):
- Until the path is closed, the canvas shows a pen cursor and each click appends a straight anchor. The first click sets the mask centre. `use-mask-handles.ts:208-210,459-506`, `freeform/definition.ts:505-574`
- Clicking the first anchor with at least 3 points closes the path. Other handle clicks are ignored while creating. `use-mask-handles.ts:357-389`
- The mask is not applied until closed. `definition.ts:426-428`
- Once closed: anchors are 7px circles and draggable. Shift-click toggles a multi-point selection without dragging. `mask-handles.tsx:19,260-273`, `use-mask-handles.ts:257-301,420-430`
- Clicking a segment (12px invisible hit stroke) inserts a point at the closest t (clamped 0.001–0.999) and selects it. Dragging a segment 4px or more moves the whole mask instead. `definition.ts:124-146`, `use-mask-handles.ts:43,397-418,510-528,600-617`, `W/masks/freeform/path.ts:534-597`
- Rotate and feather handles appear on the path's bounding box. There is no on-canvas scale handle (`showScaleHandle: false`); scale is the numeric field only. `definition.ts:149-163`
- Deleting selected points is a command. The path stays closed only if at least 3 points remain, otherwise it returns to creation mode. The key binding that triggers it is UNVERIFIED. `delete-custom-mask-points.ts:11-35`, `path.ts:75-83`
- **PARTIAL**: points carry bezier tangents (`inX/inY/outX/outY`) and insertion uses de Casteljau splitting, but every created point has zero tangents and no tangent handle exists. In practice paths are polygons. `path.ts:3-11`, `definition.ts:526-557`

#### 13. Graphics (shapes)
- Four definitions: Rectangle, Ellipse, Polygon, Star, rendered on a 512×512 source. `W/graphics/definitions/index.ts:7-12`, `W/graphics/types.ts:3`

| Param | Applies to | Range | Default |
|---|---|---|---|
| `fill` | all | colour | `#ffffff` |
| `stroke` | all | colour | `#000000` |
| `strokeWidth` | all | 0–64, step 1 | 0 |
| `strokeAlign` | all | inside / center / outside | center |
| `cornerRadius` | rectangle, polygon | 0–50 (50 = fully round) | 0 |
| `sides` | polygon | 3–12 | 5 |
| `points` | star | 3–12 | 5 |
| `depth` | star | 1–99 (inner radius %) | 45 |

  Citations: `rectangle.ts:14-50`, `ellipse.ts:13-39`, `polygon.ts:20-66`, `star.ts:15-61`, `shared.ts:5-16`.
- Stroke alignment: inside clips and doubles the width; outside uses a temp canvas with `destination-out`. `W/graphics/stroke.ts:40-102`
- Graphic tab: a shape section plus a collapsible Stroke section. The +/− button sets `strokeWidth` to 0 or back to the last value (default 2). Every param has a keyframe toggle. `W/graphics/components/graphic-tab.tsx:30,56-81,111-144,226-237`

#### 14. Stickers
- Tabs: All, Flags, Shapes. Logos is commented out (`v0.4.0`) and its provider returns empty results (**STUB**). `W/stickers/categories.ts:1-7`, `providers/logos.ts:20-31`
- ID scheme is `provider:value` (e.g. `flags:US`, `shapes:star`). It must have a non-empty provider and value or it throws. `W/stickers/sticker-id.ts:1-34`
- Flags: 271 SVGs in `apps/web/public/flags`, resolved as `/flags/{code-lowercase}.svg`. `providers/flags.ts:13-24`
- Flag search: case-insensitive substring on name or code, or an exact region id/alias (19 regions), or a group (`europe`, `asia`, `africa`, `america`). `flags.ts:64-124`, `countries-data.ts:1-28`
- A region banner shows only on the Flags tab. `W/stickers/components/assets-view.tsx:197-205`
- `docs/countries-search.md` describes `apps/web/public/countries.json`, but that file is absent; the data lives in `countries-data.ts`. The doc's `languages` and `flag_colors` fields are not searched. `flags.ts:119-123`
- Shapes: one item per registered graphic, searched by name or keywords. Legacy ids (square, circle, triangle, hexagon, diamond, star) still resolve. `providers/shapes.ts:20-63,120-136`
- Browse "All": a "Recently used" row (12 shown, 50 stored, "Clear" button) plus one row per provider (12 items, "See all" switches tab). `W/stickers/index.ts:17,229-286`, `stickers-store.ts:16`
- Search "All": one section per provider, limit 100 split across providers. Per-tab search shows "{total} results". `index.ts:162-207`, `assets-view.tsx:203-213`
- Search runs on every keystroke with no debounce. `assets-view.tsx:60-63`
- Persistence: `stickers-settings` v1 stores `selectedCategory` and `recentStickers`, sanitised against known providers and de-duplicated. `stickers-store.ts:32-58,205-236`
- Adding by click:
  - A shape becomes a **graphic** element.
  - Anything else becomes a sticker element with intrinsic size from the image's natural size (fallback 200).
  - The element is inserted at the playhead with `placement: auto`, pushed to recents, and a failure shows a toast. `assets-view.tsx:348-387`, `index.ts:288-305`
- Adding by drag: the payload type is `graphic` or `sticker`. `assets-view.tsx:418-431`
- **Probable bug (not executed)**: `registerDefaultStickerProviders` calls `stickersRegistry.register(provider.id, provider)`, but `DefinitionRegistry.register` takes `{key, definition}`. As written no provider would register and lookups would throw. `providers/index.ts:22` vs `W/params/registry.ts:49-57`

#### 15. Text
- One preset, "Default text", added at the playhead (5 s default duration) by click or drag. `W/text/components/assets-view.tsx:11-44`, `W/timeline/creation.ts:3-5`
- Rendered font size is `fontSize × canvasHeight / 90`. Background padding scales by `fontSize / 15`. `W/text/primitives.ts:81-88`, `W/text/typography.ts:9`
- Lines break on `\n` only. Auto-wrap or a text box width is NOT FOUND. `primitives.ts:116`
- Decoration thickness is 7% of font size; strike-through sits at 0.35 of (ascent − descent). `W/text/layout.ts:22-23,204-226`
- Background is a rounded rect; corner radius 0–100 maps to a fraction of half the shorter side. `primitives.ts:162-197`, `W/text/background.ts:1-2`
- Text shadow, text stroke/outline on text elements, font weights beyond normal/bold, and justify alignment are NOT FOUND in the param registry. Stroke exists only for the text mask. `W/params/registry.ts:176-327`, `primitives.ts:215-241`
- The text properties tab UI is outside this slice: UNVERIFIED.

Text element params (`params/registry.ts:176-327`, defaults `W/timeline/defaults.ts:18-63`):

| Key | Type / range | Default | Keyframable |
|---|---|---|---|
| `content` | text | "Default text" | no |
| `fontFamily` | font | Arial | no |
| `fontSize` | number, min 1, step 1, no max | 15 | yes |
| `color` | colour | `#ffffff` | yes |
| `textAlign` | left / center / right | center | no |
| `fontWeight` | normal / bold | normal | no |
| `fontStyle` | normal / italic | normal | no |
| `textDecoration` | none / underline / line-through | none | no |
| `letterSpacing` | min −100, step 0.1 | 0 | yes |
| `lineHeight` | min 0.1, step 0.1 | 1.2 | yes |
| `background.enabled` | boolean | false | no |
| `background.color` | colour | `#000000` | yes |
| `background.cornerRadius` | 0–100, step 1 | 0 | yes |
| `background.paddingX` / `paddingY` | min 0, step 1 | 30 / 42 | yes |
| `background.offsetX` / `offsetY` | min −100000, step 1 | 0 / 0 | yes |

The five non-toggle background params depend on `background.enabled = true`.

#### 16. Fonts
- Atlas: `public/fonts/font-atlas.json` holds 1920 Google families (Fontsource list filtered to google, latin subset, weight 400). Entry shape is `{x, y, w, ch, s[]}`. `apps/web/scripts/generate-font-sprites.ts:63-80`, `W/fonts/types.ts:14-24`
- Sprite generation: 24px font, 40px rows, 1200px-wide canvas, chunks up to 800px tall, AVIF quality 80, files `font-chunk-{n}.avif`. `generate-font-sprites.ts:20-26,243-245`
- The atlas is fetched lazily on first open, chunk images are preloaded, and the error state has a Retry button. `W/fonts/google-fonts.ts:27-53`, `W/fonts/use-font-atlas.ts:20-45`
- Picker: 288px popover with autofocused search (case-insensitive substring). The list is virtualised: row 40, max height 288, overscan 15. Names are atlas families plus system fonts, sorted. `W/components/ui/font-picker.tsx:29-33,52-61,169-183`
- Google font rows are previewed as a CSS mask of the sprite at scale 0.8; system fonts render as live text. `font-picker.tsx:189-207,248-254`
- Selecting a Google font injects a `css2?family=…:wght@400;700&display=swap` link and awaits `document.fonts.load` before the callback. Load failures are ignored. `google-fonts.ts:55-79`, `font-picker.tsx:63-76`
- System fonts are a hard-coded set of nine: Arial, Helvetica, Times New Roman, Courier New, Verdana, Georgia, monospace, sans-serif, serif. `W/fonts/system-fonts.ts:1-11`
- **STUB**: the tabs "All fonts / My fonts / Favorites" only change the placeholder text; they do not filter. `font-picker.tsx:21-25,52-56,85-86`
- Local Font Access API (`queryLocalFonts`) and custom font upload are NOT FOUND (grep across `src`).

#### 17. Gradients, background, canvas and colour presets
- Parser accepts `linear-gradient`, `repeating-linear-gradient`, `radial-gradient`, `repeating-radial-gradient`, with optional vendor prefixes. `W/gradients/parser.ts:5-9,90-95`
- Linear orientation: `to <side|corner>` or `deg` angles. Radial: circle/ellipse, extent keywords, `at` position. Lengths: px, %, em, calc. `parser.ts:96-106`
- Colours: hex, named, rgb(a), hsl(a), `var()`. `parser.ts:44-51`
- Conic gradients are NOT FOUND.
- Canvas renderer: comma-separated layers are painted in reverse order, and a non-gradient segment is a solid fill. Ellipses use a scaled radial gradient. `W/gradients/canvas.ts:55-109,190-233`
- I found no repeat logic for the `repeating-*` types in `canvas.ts` (grep only): UNVERIFIED/PARTIAL.
- Canvas presets: 1920×1080, 1080×1920, 1080×1080, 1440×1080; default 1920×1080. `W/canvas/sizes.ts:3-10`
- Background: default colour `#000000`. Blur presets Light 100, Medium 200, Heavy 500, while `DEFAULT_BACKGROUND_BLUR_INTENSITY = 10`. `W/background/color.ts:1`, `W/background/blur.ts:1-10`
- Colour presets: about 242 solid swatches, 11 Syntax UI gradients, and roughly 22 Pattern Craft gradients (count estimated from line count). `W/data/colors/solid.ts:1-244`, `syntax-ui.tsx:3-30`, `pattern-craft.ts:3-69`
- These presets are consumed by `components/editor/panels/assets/views/settings/background.tsx`, which is outside this slice: UNVERIFIED.

#### 18. Effects
- **Exactly one effect exists: Blur** (`type: "blur"`, keywords blur/soft/defocus). `W/effects/definitions/index.ts:4`, `blur.ts:68-82`
- Its one param is `intensity`: 0–100, step 1, default 15. `blur.ts:72-82`
- Sigma is `intensity/5 × (width/1920 or height/1080)`, rendered as separable H+V passes with up to 8 iterations. `blur.ts:5-8,10-61,102-108`
- Clip effects are an ordered array on any visual element; a new effect is appended, enabled, with default params. `W/effects/index.ts:31-47`, `add-effect.ts:7-17`
- Commands, each undoable by restoring a tracks snapshot: add, remove, toggle `enabled`, reorder (splice from→to), update params. `W/commands/timeline/element/effects/*.ts`
- Effects tab: list items are HTML5-draggable to reorder, with a 2px primary drop indicator. Each has an eye toggle (disabled items dim to 50%) and a delete button. Params preview live and commit. `W/effects/components/effects-tab.tsx:112-141,163-196,260-277,292-304`
- Empty state: "No effects" with an "Open effects" button that switches the assets panel tab. `effects-tab.tsx:206-231`
- Effects asset view: a grid of live-rendered preview canvases. Dragging carries `type: "effect"` and the target element types; the drop handling is in the timeline slice (UNVERIFIED). `W/effects/components/assets-view.tsx:22-54,75-90`
- Standalone effect element: clicking an effect inserts an effect element at the playhead on an auto-placed `effect` track. Its tab shows params only (no toggle or remove). It has no registry params and no preview bounds. `assets-view.tsx:59-70`, `effects-tab.tsx:30-69`, `params/registry.ts:352`
- NOT FOUND: any other effects or filters, colour adjustments (brightness, contrast, saturation, LUT), transitions, chroma key, crop, a flip control, text or element drop shadow.

#### 19. Param registry
- Param types: `number` (min, optional max, step, `displayMultiplier`, `unit: "percent"`, `shortLabel`), `boolean`, `color`, `select`, `text`, `font`. Common fields: `group` (only "stroke"), `keyframable`, `dependencies`. `W/params/index.ts:175-241`
- Keyframe channels: numbers interpolate linearly; boolean, select, text and font hold. Colours animate as linear-RGB r/g/b/a with shared easing and serialise to hex or hex8. `params/index.ts:57-173`
- `coerceParamValue` snaps to step then clamps; a select must match an option. `params/index.ts:309-342`
- Which element gets what: video = visual + audio; image, sticker, graphic = visual; text = text + visual; audio = audio; effect = none. `params/registry.ts:334-352`

Visual params (`params/registry.ts:96-155`):

| Key | Range | Default |
|---|---|---|
| `transform.positionX` / `positionY` | min −100000, step 1 | 0 |
| `transform.scaleX` / `scaleY` | min 0.01, step 0.01 | 1 |
| `transform.rotate` | −360…360, step 1 | 0 |
| `opacity` | 0–1, step 0.01 | 1 |
| `blendMode` | 17 options, not keyframable | normal |

- Blend modes: normal, darken, multiply, color-burn, lighten, screen, plus-lighter, color-dodge, overlay, soft-light, hard-light, difference, exclusion, hue, saturation, color, luminosity. `params/registry.ts:76-94`
- Audio params: `volume` (dB range from `VOLUME_DB_MIN/MAX`, step 0.01, default 0) and `muted` (boolean). `params/registry.ts:157-174`

#### 20. Colour picker
- Trigger: a swatch over a checkerboard plus an inline uppercase hex input. Values are hex without `#`, optionally with alpha. `W/components/ui/color-picker.tsx:486-523`
- Enter or blur commits; an invalid entry is ignored. Pasting any text containing a colour extracts it and keeps the current alpha unless the pasted value has its own. `color-picker.tsx:438-484`
- Popover: a saturation/value square, a hue slider and an opacity slider. `onChange` fires during a drag and `onChangeEnd` on mouse-up; outside-click dismissal is suppressed while dragging. `color-picker.tsx:84-152,287-289,320-370`
- Hue is preserved for greys through an internal hue state. `color-picker.tsx:76-78,113-121`
- Format select: HEX, RGB, HSL, HSV, with a text input parsed per format. `color-picker.tsx:215-241,373-401`
- Eyedropper button appears only when `window.EyeDropper` exists; the pick keeps the current alpha. `color-picker.tsx:70-71,154-166,302-311`
- **STUB**: the header "Custom / Saved" select has no handler and there are no saved colours. `color-picker.tsx:292-300`

#### 21. Number field
- With `allowExpressions` (default true) the input is `type="text"` with decimal input mode. `W/components/ui/number-field.tsx:127,210-211`
- Expression evaluation is not in this component. It happens in `use-property-draft.ts:58` via `evaluateMathExpression`, which supports `+ - * / ( )` and decimals through a recursive-descent parser and rejects any other characters. `W/utils/math.ts:101-116`
- Focus or first click selects all. Enter and Escape blur. A focus lock is active while editing. `number-field.tsx:160-165,216-236`
- Scrubbing: dragging the icon or label uses pointer lock, and the first move event is discarded. Sensitivity is 1 unit/px, or 0.5 for `slow`. `number-field.tsx:13-16,167-204`
- Optional piecewise `scrubRanges` (pixels per unit per range) and `scrubClamp`. `onScrubEnd` fires on release. `number-field.tsx:46-98`
- Optional suffix text positioned after the value by a ghost measurement (6px gap), and a reset button shown when `onReset` is set and the value is not default. `number-field.tsx:11,146-158,302-313`

#### Files in the slice not (fully) read
- `W/stickers/providers/countries-data.ts`: header (regions, groups, type) only.
- `W/masks/__tests__/snap.test.ts`, `W/params/__tests__/channel-layout.test.ts`: not read.
- `W/masks/builtin/definitions/heart.ts`, `star.ts`: grep only (features and constants, not path maths).
- `W/masks/builtin/definitions/split.ts`: renderer body (lines ~275–397) not read.
- `W/masks/freeform/path.ts`: lines 1–84 and 534–600 only; the rest by function list.
- `W/text/measure-element.ts`: grep outline only.
- `W/gradients/parser.ts`, `W/gradients/canvas.ts`: types, tokens and layer/radial drawing only. Stop-offset and angle maths not read.
- `W/guides/definitions/tiktok-layout.tsx`: first ~40 lines (static SVG).
- `apps/web/scripts/generate-font-sprites.ts`: constants and grep outline only.
- `W/data/colors/solid.ts`, `pattern-craft.ts`: partial.
- `W/guides/registry.tsx`, `preview-overlay.tsx`, `W/hooks/use-fullscreen.ts`, `use-shift-key.ts`: read with blank and import lines stripped, so they are cited at file level without line numbers.

### 2.C Media, audio, renderer, Rust/wasm, export, speed, sounds, captions, desktop

Path prefix: `W/` = `apps/web/src/`. Line numbers are from the files as read. Nothing was created or modified.

#### 1. Media import and library

- **Type detection** is by MIME prefix only (`image/`, `video/`, `audio/`); anything else gets the toast "Unsupported file type: {name}". There is no extension allow-list. `W/media/media-utils.ts:14-32`, `W/media/processing.ts:99-104`
- **File picker** uses `accept: "image/*,video/*,audio/*"` with `multiple: true`. `W/components/editor/panels/assets/views/assets.tsx:119-123`
- **Size limit**: no fixed cap. Each file is checked against the browser storage quota via `storageService.canStoreFile`; failure toasts "Not enough browser storage for {name}" with file size vs available bytes. `processing.ts:106-118`, `W/services/storage/service.ts:105-115`. The 50 MB headroom constant is at `W/services/storage/quota.ts:5`; the evaluation logic is UNVERIFIED.
- **Video probe** (mediabunny `Input` + `ALL_FORMATS` + `BlobSource`) reads duration, display width/height, fps (`computePacketStats(100).averagePacketRate`, then `Math.round`), `hasAudio`, codec and `canDecode`. `W/media/mediabunny.ts:25-79`, `processing.ts:136-143`
- **Undecodable codec**: the asset is still imported, with the toast "Can't preview {name}". HEVC gets a "convert to H.264 MP4 or try Safari" message. `processing.ts:12-22,146-152`
- **Thumbnails**:
  - Video uses the frame at t=1 s via `VideoSampleSink.getSample(1)`. `mediabunny.ts:48-63`
  - Images are drawn from an `Image` element. `processing.ts:42-83`
  - Both are capped at 1280×720 (aspect preserved) and stored as a JPEG data URL at quality 0.8. `W/media/thumbnail.ts:1-2,55`
  - Audio has no thumbnail.
- **Audio duration** comes from an `<audio>` element's `loadedmetadata`. `processing.ts:197-219`
- **Progress** is a per-file percentage `round(completed/total*100)`, with a `setTimeout(0)` yield between files. `processing.ts:180-186`
- **Upload toast**: "Uploading media asset(s)..." → "{name} has been uploaded" / "{n} media assets have been uploaded" / "No media assets were uploaded". It waits two animation frames before starting. `W/media/upload-toast.ts:12-48`
- **Drag-and-drop hook** uses a drag counter, ignores drags started by the timeline, and takes only the first file when `multiple` is false. `W/media/use-file-upload.ts:20-87`
- **Paste**:
  - Ignored in typable elements.
  - Clipboard files with a media MIME are imported and each inserted at the playhead (`placement: auto`, audio → audio track, otherwise video track) as one `BatchCommand`.
  - Duration is the asset duration, or `DEFAULT_NEW_ELEMENT_DURATION` for images.
  - With no media files it falls through to `editor.clipboard.paste()`.
  - `W/media/use-paste-media.ts:42-110`
- **MediaManager**:
  - Add is optimistic, then persisted; on failure it rolls back and shows a quota toast. `W/core/managers/media-manager.ts:17-51`
  - Remove goes through an undoable `RemoveMediaAssetCommand` (batched). `:57-85`
  - `clearAllAssets` clears the video and waveform caches and revokes URLs. `:132-147`
- **FPS ratchet**: importing a video with higher fps than the project raises the project fps. `media-manager.ts:34`, `W/core/managers/project-manager.ts:504-519`, `W/fps/utils.ts:86-104`
- **Asset removal** revokes object URLs and clears the per-asset video sink and waveform summary. `W/commands/media/remove-media-asset.ts:46-59`
- **Sort and view mode** exist in the media panel: sort by name/type/duration/size, grid/list toggle. `assets.tsx:151-184,534-602` (outside this slice, only grepped).
- NOT FOUND: media folders/bins, media search (no match in `assets.tsx`), proxy media, cloud upload, relink.

#### 2. Video frame cache and decoding

- One singleton `VideoCache`, keyed by `mediaId`. Each entry holds a mediabunny `Input` plus `CanvasSink(videoTrack, { poolSize: 3, fit: "contain" })`. Init throws if there is no video track or `!canDecode`. `W/services/video-cache/service.ts:258-301,337`
- **State per media**: `currentFrame`, one prefetched `nextFrame`, an async iterator and `lastTime`. There is no multi-frame LRU and no memory cap. `:9-18`
- **Resolve strategy** (`:57-100`):
  1. Promote `nextFrame` if its timestamp ≤ t.
  2. Reuse `currentFrame` if `timestamp ≤ t < timestamp + duration`.
  3. If t is within `[lastTime, lastTime + 2.0 s)`, iterate forward (tolerance +0.05 s; abort if a frame is more than 1.0 s past the target).
  4. Otherwise hard seek: `iterator.return()` then `sink.canvases(t)`.
- **Concurrency**: requests are serialised per media through a promise chain plus a generation counter. A superseded request returns the stale `currentFrame` instead of decoding. `:40-54`
- Decoding is WebCodecs via mediabunny on the main thread. There are no workers and no `<video>` element.
- Source time is `trimStart + clipTime × rate`, rounded to integer ticks, then converted to seconds. `W/services/renderer/resolve.ts:199-209`
- **Images**: module-level promise cache keyed `url::maxSize`, never evicted; preview downsizes to max 2048 px on the long side. `W/services/renderer/nodes/image-node.ts:18-69`, `W/services/renderer/scene-builder.ts:21,102-104`
- **Stickers**: cached per id, fetched at 200×200. `W/services/renderer/nodes/sticker-node.ts:20-54`

#### 3. Scene builder, node tree and frame descriptor (TypeScript)

- **`buildScene`** produces `RootNode{duration}` with flat children. `scene-builder.ts:226-273`
  - Track order is `[...overlay, main]` reversed (bottom to top). Hidden tracks and elements are skipped. Elements sort by `startTime`, then id. `:23-31,237-242`
  - Audio tracks produce no nodes.
- **Background**:
  - `blur` adds one `BlurBackgroundNode` per main-track video/image (default intensity constant).
  - `color` adds a `ColorNode` unless the colour is `"transparent"`; CSS gradients are drawn via `drawCssBackground`.
  - The frame clear colour is always opaque black `[0,0,0,1]`.
  - `scene-builder.ts:251-267`, `W/services/renderer/compositor/frame-descriptor.ts:58-60,102-108`
- **Node types**: Video, Image, Text, Sticker, Graphic, Color, BlurBackground, EffectLayer. `scene-builder.ts:50-161`
  - Masks are passed for video, image and graphic only. Sticker and text nodes get none.
- **Resolve pass** (async, per frame): visibility is `0 ≤ clipTime < duration`. Transform, opacity, effect params, text colour and background colour are animated. `resolve.ts:132-185,316-376`
  - Effect resolution for visual nodes is the contain-fitted element size. For text and effect layers it is the canvas size.
- **Blur background** is a cover-fit backdrop plus Gaussian passes. Sigma is `intensity/5 × (res/1920 or res/1080)`. `resolve.ts:397-408`, `W/effects/definitions/blur.ts:57-61`
- **Gaussian pass builder**: H+V pairs; iterations = `min(8, ceil(σ²/40²))`; per-pass step = `max(1, σ/10)`. `blur.ts:5-55`
- **Frame descriptor** is `{width, height, clear:{color}, items[]}`. `W/services/renderer/compositor/types.ts:4-42`
  - `layer` item: `{textureId, transform{centerX, centerY, width, height, rotationDegrees, flipX, flipY}, opacity, blendMode, effectPassGroups: EffectPass[][], mask: {textureId, feather, inverted} | null}`.
  - `sceneEffect` item: `{effectPassGroups}`.
- **Transform**: contain-fit × scaleX/scaleY; negative scale becomes a flip; centre is canvas centre + position. `frame-descriptor.ts:327-356`
- **Text** is rasterised by Canvas2D into a full-canvas texture, hashed by `JSON.stringify({params, resolved})`. `:296-315`
- **Graphics** are rasterised to a `DEFAULT_GRAPHIC_SOURCE_SIZE` square and cached by params. `W/services/renderer/nodes/graphic-node.ts:35-66`
- **Masks**: only `masks[0]` is honoured. `frame-descriptor.ts:388`
  - The mask is drawn in element space by Canvas2D (`fillPath` / `drawOpaque` / `drawWithFeather`), then transformed into a full-canvas texture.
  - `drawWithFeather` masks send `feather = 0` so the GPU skips JFA. `:400-408`
  - A stroke becomes a separate normal-blend layer above. `:471-523`
- **Effect-layer elements** become `sceneEffect`, applied to everything composited beneath. `:123-131`
- **Texture sync** (`W/services/renderer/compositor/wasm-compositor.ts:72-182`):
  - `external` textures are cached by source object identity and size.
  - `rendered` textures are cached by `contentHash`, with a persistent `OffscreenCanvas` per id.
  - Ids absent from the current frame are released.
  - Non-Offscreen sources are copied into a new `OffscreenCanvas` on every upload. `:200-227`
- **BlendMode list** in TS (`W/rendering/index.ts:13-30`) matches the Rust enum exactly.

#### 4. Rust / wasm

- **Workspace members**: `apps/desktop`, `rust/crates/{time, bridge, effects, gpu, masks, compositor}`, `rust/wasm`. `Cargo.toml:1-11`
- **Dependency versions**:

| Crate | Key dependencies | Source |
|---|---|---|
| `opencut-wasm` 0.2.10 (edition 2024) | wasm-bindgen 0.2.116, js-sys 0.3.93, web-sys 0.3.93, serde 1.0.228, serde-wasm-bindgen 0.6.5, wasm-bindgen-futures 0.4.66, console_error_panic_hook 0.1.7, num-traits 0.2.19 | `rust/wasm/Cargo.toml` |
| gpu / effects / masks | wgpu 29.0.1, bytemuck 1.25.0, thiserror 2.0.18; the gpu `wasm` feature enables `wgpu/webgl` | `rust/crates/gpu/Cargo.toml:17` |
| time | tsify-next 0.5, wasm-bindgen 0.2.115 | `rust/crates/time/Cargo.toml` |
| bridge | syn 2.0.117, quote 1.0.45 | `rust/crates/bridge/Cargo.toml` |

- **`bridge`** is the `#[export]` proc-macro. It emits a camelCase `wasm_bindgen` name, enforces a single options struct per function, and exports consts as getter functions. `rust/crates/bridge/src/bridge.rs:16-61`
- **JS API**:
  - GPU: `initializeGpu()` (async, idempotent, installs a panic hook that writes `window.__wasmPanic`). `rust/wasm/src/gpu.rs:22-63`
  - Compositor: `initCompositor(w,h)`, `resizeCompositor(w,h)`, `getCompositorCanvas()`, `uploadTexture({id, source: OffscreenCanvas, width, height})`, `releaseTexture(id)`, `renderFrame(frameDescriptor)`. `rust/wasm/src/compositor.rs:27-219`
  - Perf: `getLastFrameProfile()`. `rust/wasm/src/perf.rs:32`
  - Standalone: `applyEffectPasses({source, width, height, passes})` and `applyMaskFeather({mask, width, height, feather})`, both returning an `OffscreenCanvas`. `rust/wasm/src/effects.rs:35`, `rust/wasm/src/masks.rs:19`
  - Time: `TICKS_PER_SECOND()` (=120000), `mediaTimeFromSeconds`, `mediaTimeToSeconds`, `mediaTimeFromFrame`, `mediaTimeToFrame`, `roundToFrame`, `floorToFrame`, `isFrameAligned`, `lastFrameTime`, `snappedSeekTime`, `mediaTimeAdd/Sub/Min/Max/Clamp`, `guessTimecodeFormat`, `formatTimecode`, `parseTimecode`. `rust/crates/time/src/media_time.rs:10,153-361`, `rust/crates/time/src/timecode.rs:60-208`
- **Time model**: `MediaTime(i64)` ticks at 120 000 per second.
  - `FrameRate {numerator, denominator}` has presets 23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120.
  - `ticks_per_frame` returns `None` for rates that do not divide evenly. `rust/crates/time/src/frame_rate.rs:14-94`
  - Timecode formats are `MM:SS`, `HH:MM:SS`, `HH:MM:SS:CS` (default) and `HH:MM:SS:FF`. `timecode.rs:17-26,87`
- **Backend selection**: WebGPU first (`new_instance_with_webgpu_detection`), then a WebGL2 fallback bound to a hidden 1×1 canvas. `rust/crates/gpu/src/context.rs:200-259,284-285`
  - Adapter request uses `HighPerformance`; limits are `downlevel_webgl2_defaults().using_resolution`.
  - Texture format is `Bgra8Unorm` on WebGPU and `Rgba8Unorm` on GL. `:66-70`
  - Present mode is Fifo. `:433`
  - `supports_surface_rendering()` is the `UNRESTRICTED_EXTERNAL_TEXTURE_COPIES` flag. `:165-168,363`
- **Texture import**: WebGPU uses `copy_external_image_to_texture` (sRGB, non-premultiplied). The GL path does `getImageData` plus `write_texture`, a CPU readback per upload. `context.rs:514-576`
- **Output canvas**: on GL the compositor reuses the GL-bound canvas; on WebGPU it creates a fresh `<canvas>`. `rust/wasm/src/compositor.rs:34-44`
  - WebGPU renders straight to the surface; GL composites to a texture and then presents. `:184-216`
- **Compositor algorithm** (`rust/crates/compositor/src/compositor.rs:344-483`):
  1. Start from a cleared scene texture.
  2. For each layer, draw the source into a full-frame texture with `layer.wgsl` (inverse rotation, UV bounds discard, flips, `alpha × opacity`).
  3. Apply effect pass groups.
  4. Apply the mask: JFA feather if `feather > 0`, else copy; then `mask.wgsl` multiplies layer alpha by mask `.a` (or `1 − a` when inverted).
  5. Blend onto the scene with `blend.wgsl` into a new texture.
  6. `SceneEffect` items run effect groups on the whole scene.
  7. Finally blit to the surface.
- **Blend enum** (serde kebab-case, shader codes 0–16): `Normal, Darken, Multiply, ColorBurn, Lighten, Screen, PlusLighter, ColorDodge, Overlay, SoftLight, HardLight, Difference, Exclusion, Hue, Saturation, Color, Luminosity`. `rust/crates/compositor/src/blend_mode.rs:5-46`
  - Luma weights are (0.3, 0.59, 0.11); compositing is non-premultiplied source-over. `rust/crates/compositor/src/shaders/blend.wgsl:23-25,136-139`
- **Texture pool**: keyed by `(w,h)`, recycled at frame start, never freed. `rust/crates/compositor/src/texture_pool.rs:14-35`
  - Effect and JFA passes allocate fresh textures every frame, not pooled. `rust/crates/effects/src/pipeline.rs:188-189`, `rust/crates/masks/src/sdf.rs:167-168`, `rust/crates/masks/src/feather.rs:197`
- **Effects crate**: exactly one shader, `"gaussian-blur"`. `pipeline.rs:10,134-135`
  - It is a 61-tap kernel (−30..30) with weight `exp(−p²/2σ²)`. `rust/crates/effects/src/shaders/gaussian_blur.wgsl:25-33`
  - Uniforms are `u_sigma`, `u_step`, `u_direction`; any other uniform is an `UnsupportedUniform` error. `pipeline.rs:271-283`
- **JFA feather**:
  - Init seeds pixels where mask `.r` is above 0.5 (or below, for the inverted run), with coordinates encoded 16-bit in RGBA8. `rust/crates/masks/src/shaders/jfa_init.wgsl:26-34`
  - `ceil(log2(max(w,h)))` ping-pong steps over a 3×3 neighbourhood, run twice (inside and outside). `sdf.rs:155,183-210`
  - Output alpha is `smoothstep(−feather/2, +feather/2, d_out − d_in)`. `rust/crates/masks/src/shaders/jfa_distance.wgsl:46-47`
- **Stale docs**:
  - `docs/effects-renderer.md:5-7,65-69` references `apps/web/src/lib/effects/…` and `rust/crates/gpu/src/shader_registry.rs`. Neither exists; the shader map lives in `effects/src/pipeline.rs`.
  - `rust/wasm/README.md:14-17` shows positional call signatures that do not match the options-struct API.
- **TS wrappers**: `gpuRenderer.applyEffect` and `applyMaskFeather` return the input unchanged when the GPU is unavailable. `W/services/renderer/gpu-renderer.ts:42-44,65-67`
  - `applyEffect` is used only for 160×160 effect thumbnails from `/effects/preview.jpg`. `W/services/renderer/effect-preview.ts:7-8,67-74`
  - `W/services/renderer/mask-feather.ts` has no callers in the grep (apparently dead).
- **Degraded mode**: `initializeGpu` failure sets `renderer.isDegraded` and the editor shows a banner. `W/components/providers/editor-provider.tsx:41-42`, `W/app/editor/[project_id]/page.tsx:61-63`
  - PARTIAL: there is no Canvas2D compositing fallback. `initCompositor` errors without a GPU runtime. `rust/wasm/src/gpu.rs:70-73`

#### 5. Preview, snapshot and thumbnail

- `RenderTreeController` rebuilds the scene (with `isPreview: true`) on deep changes to tracks, assets, background or size, and stores it in `RendererManager`. `W/preview/components/index.tsx:95-120`
- A rAF loop renders only when the frame index or tree identity changes, and skips while a render is in flight. `:185-214`
- The wasm canvas is mounted directly in the DOM. `:170-183`
- The preview resolution comes from `usePreviewSize` (UNVERIFIED).
- **Snapshot**: renders at `min(playhead, lastFrameTime)` at project canvas size to PNG. Filename is `{projectName sanitised}-{HH-MM-SS-CS}.png`. It can be downloaded or copied to the clipboard (with a `ClipboardItem` support check). `W/core/managers/renderer-manager.ts:42-139`
- **Project thumbnail on exit**: renders t=0 at canvas size to a PNG data URL. `project-manager.ts:651-684`

#### 6. Export

- **Options**:
  - Format: `mp4` or `webm`.
  - Quality: `low | medium | high | very_high`.
  - `includeAudio`.
  - `fps` is optional in the type, but the UI always passes the project fps.
  - Defaults: mp4 / high / audio on.
  - `W/export/index.ts:4-21`, `W/export/defaults.ts:3-7`, `W/components/editor/export-button.tsx:117-124`
- **UI**: a popover with collapsible Format, Quality and Audio sections, a progress bar with percentage, and Cancel. The error view offers Copy and Retry. Closing the popover cancels the export. `export-button.tsx:52-58,163-284,292-335`
- **Resolution** is always the project `canvasSize`; there are no resolution or fps selectors. `renderer-manager.ts:166-167`
- **Encoder** is mediabunny `Output` with `Mp4OutputFormat` or `WebMOutputFormat`, a `BufferTarget` (whole file in memory), and a `CanvasSource` on the wasm compositor canvas, which sits on WebCodecs. `W/services/renderer/scene-exporter.ts:94-107`
  - Video codec is `avc` (mp4) or `vp9` (webm).
  - Bitrate is mediabunny `QUALITY_LOW/MEDIUM/HIGH/VERY_HIGH`.
  - There is no video-codec support check.
- **Audio** is `aac` (mp4) or `opus` (webm). `scene-exporter.ts:110-135`
  - AAC falls back to Opus if `AudioEncoder.isConfigSupported({codec: "mp4a.40.2", bitrate: 192000})` is false.
  - The audio bitrate reuses the same quality constant as video.
  - The whole `AudioBuffer` is added before any video frame.
- **Frame loop**: `ticksPerFrame = round(120000 × den/num)`, `frameCount = floor(duration/ticksPerFrame)`. `scene-exporter.ts:89-150`
  - Each frame awaits `renderer.render` and then `videoSource.add(t, 1/fps)`. This is sequential and not real-time.
  - Progress is `i/frameCount`.
- **Progress mapping**: with audio, 0.05 is reported at audio start and video maps to `0.05 + p × 0.95`. `renderer-manager.ts:171,197-202`
- **Cancel**: a flag polled every 100 ms calls `exporter.cancel()`; the loop then runs `output.cancel()` and returns `{cancelled: true}`. `renderer-manager.ts:204-220`, `scene-exporter.ts:138-142`
- **Output file** is `{projectName}.mp4` or `.webm` (name not sanitised), MIME `video/mp4` or `video/webm`, delivered by anchor download. `export-button.tsx:132-136`, `W/export/mime-types.ts`
- **Empty project** returns the error "Project is empty". `renderer-manager.ts:161-164`
- Export builds the scene without `isPreview`, so images are full resolution, and it shares the singleton `wasmCompositor` with the preview. `renderer-manager.ts:179-185`, `wasm-compositor.ts:185`
- NOT FOUND: GIF, audio-only, image-sequence, export range (in/out), resolution scaling, custom bitrate, hardware-acceleration option, File System Access streaming, background or worker export.

#### 7. Audio mixdown and mastering (TypeScript only)

- **Collection order** is overlay → main → audio tracks. Muted tracks and muted elements are skipped. Video audio requires `hasAudio !== false` and source audio not separated. `W/media/audio.ts:94-122`, `W/timeline/audio-separation/index.ts:57-73`
- **Decode**:
  - Audio assets use `decodeAudioData`.
  - Video audio uses mediabunny `AudioBufferSink`, max 2 channels, resampled through an `OfflineAudioContext`. `audio.ts:248-339`
  - Library sounds use the stored `buffer` or refetch `sourceUrl`. `:233-241`
- **Mixdown** (`createTimelineAudioBuffer`, `audio.ts:625-686,814-867`):
  - Stereo at 44 100 Hz (`EXPORT_SAMPLE_RATE`), buffer created from a live `AudioContext`.
  - A hand-written JS loop does per-sample linear interpolation, with `sourceTime = trimStart + clipTime × rate`, and sums additively.
  - Gain is evaluated per sample when volume is keyframed, otherwise constant.
  - The mix itself is not an `OfflineAudioContext` graph.
- **Pitch-preserved retime** in export pre-renders through `renderRetimedBuffer`. `audio.ts:660-672`
- **Mastering**: skipped if peak ≤ 0.98. `W/media/audio-mastering.ts:1-6,55-103`
  - Otherwise an `OfflineAudioContext` runs a `DynamicsCompressor` (threshold −1 dB, knee 0, ratio 20, attack 1 ms, release 120 ms), then gain 0.98, then a hard clamp to ±0.98.
- **`extractTimelineAudio`** (used for transcription) produces a 16-bit PCM stereo WAV at 44.1 kHz. An empty timeline gives 0.1 s of silence. Coarse progress is 10/90/100. `mediabunny.ts:81-131,154-192`
- NOT FOUND: fades and crossfades (`hasFade` is only a header gradient, `W/timeline/components/timeline-element.tsx:1139-1153`), audio effects/EQ/noise reduction/ducking, pan, per-track volume, loudness normalisation, metering.

#### 8. Audio playback scheduling

- A single `AudioContext` feeds a mastering chain. The chain's input gain node is the master volume. `W/core/managers/audio-manager.ts:123-140`
- It reacts to play/pause, volume, seek, and timeline or media changes. Any change disposes sinks and caches and restarts playback. `:76-121`
- Scrubbing stops audio; there is no scrub audio. `:97-101`
- **Scheduler**: 2 s lookahead, 500 ms `setInterval`. It starts each unmuted clip intersecting the window once per session. `:30-31,182-211`
- **Streaming path** (default): mediabunny `AudioBufferSink.buffers(sourceStart)`, one `AudioBufferSourceNode` per decoded chunk, `playbackRate = rate` (pitch shifts), constant clip gain. `:268-292`
  - Back-pressure: when more than 1 s ahead, it polls every 100 ms. `:340-344,419-441`
- **Drift recovery** (`:299-331`):
  - A late chunk starts immediately with an offset.
  - A chunk that is entirely late is dropped.
  - After 5 consecutive drops, `playbackLatencyCompensationSeconds` is set to `min(0.25, offset + 0.01)` and the iterator restarts from the current time.
- **Prepared-buffer path** applies when volume is keyframed, pitch is maintained, or `retime.mode === "curve"` (vestigial; no curve mode exists). `:457-475`
  - It decodes the whole source, pre-renders the retimed clip, and plays it as one node with `linearRampToValueAtTime` gain automation sampled every 1/60 s. `:477-518`, `W/timeline/audio-state.ts:5,91-133`
  - Buffers are cached by a JSON key. `audio-manager.ts:520-534`
- **Clock**: `PlaybackManager` advances from `performance.now()`, rounded to frames, on rAF. Audio uses `AudioContext.currentTime`. Nothing re-syncs the two clocks. `W/core/managers/playback-manager.ts:213-239`
- Playback auto-pauses at the end; play from the end restarts at 0. Master volume is clamped 0..1, and mute remembers the previous volume. `:42-55,81-112`
- STUB: `dispatchSeekEvent` and `dispatchUpdateEvent` are empty. `playback-manager.ts:246-256`
- Likely bug: `fetchLibraryAudioClip` leaves `startTime`, `duration` and `trim` in ticks while media clips are converted to seconds, so library sounds are mis-scheduled in live playback. `audio.ts:425-428` vs `:476-479`

#### 9. Clip volume, waveform and source-audio separation

- **Volume** is stored in dB at `params.volume`, clamped to −60..+20 (`W/timeline/audio-constants.ts`). Gain is `10^(dB/20)`; muted elements or tracks give 0; volume is keyframeable. `audio-state.ts:12-75`
  - The `defaultVolume` value is UNVERIFIED.
- **Volume line**: a draggable horizontal line with 0.1 dB steps, a tooltip "{x} dB", preview then commit, and a curve exponent of 2 in linear-gain space. `W/timeline/components/audio-volume-line.tsx:24,52-271`, `W/timeline/audio-display.ts:4-41`
  - It is hidden when volume has keyframes.
  - It is rendered only for audio elements. `timeline-element.tsx:1036,1049`
- **Waveform**:
  - Source summary is peak per 128-sample bucket, cached per source key (`media:{id}` / `library:{url}`). `W/media/waveform-summary.ts:7,59-86`, `W/services/waveform-cache/service.ts`
  - Bars are 1 px with a 1 px gap. Only the visible region is drawn, DPR-aware, and it is retime- and trim-aware.
  - Height is `((dB+40)/40)^1.5` with a −40 dB floor. `audio-display.ts:5-6,52-64`
  - Bars are scaled by 200 gain samples, and an orange cap marks output above 1.0. `W/timeline/components/audio-waveform.tsx:18-22,219-269`
  - Load failures are silent.
  - Max-RMS helpers over a 20 ms window exist, but the component uses peaks. `waveform-summary.ts:6,178-233`
  - `wavesurfer.js` is in `package.json` but unused in `src`.
- **Extract / recover audio**: toggles `isSourceAudioEnabled` on the video and creates an upload-type audio element. It copies timing, trim, volume, muted, retime and volume keyframes, and places it on the first available audio track. `audio-separation/index.ts:14-133`, `W/commands/timeline/element/toggle-source-audio-separation.ts:60-95`

#### 10. Speed and retime

- `RetimeConfig` is `{rate, maintainPitch}`; constant rate only. Range is 0.01–5, default 1; invalid values fall back to 1. `W/retime/rate.ts:1-25`
- **UI**: a number field with 0.01 steps and an "x" suffix (scrub sensitivity 160 px/unit below 1×, 48 px/unit above), plus a "Change pitch" switch that is the inverse of `maintainPitch`. `W/speed/components/speed-tab.tsx:31,119-150`
  - Retime is removed entirely when rate = 1 and pitch is not maintained. `:56`
- **Pitch preservation**: `soundtouchjs` `PitchShifter` (buffer 4096, `tempo = rate`, `pitch = 1`) inside an `OfflineAudioContext`, after resampling. Otherwise linear-interpolation resampling. `W/retime/audio-stretch.ts:70-182`
- STUB: `splitRetimeAtClipTime` and `adjustRetimeForTrimChange` are identity functions; `getEffectiveRateAt` ignores `clipTime`. `W/retime/split.ts:14-34`, `W/retime/resolve.ts:28-35`
- NOT FOUND: speed presets (`W/retime/presets.ts` only builds a constant retime), speed ramps/curves, reverse, freeze frame, frame blending.

#### 11. Sounds

- **Provider** is Freesound `https://freesound.org/apiv2/search/text/` with `token = FREESOUND_API_KEY`, proxied by `GET /api/sounds/search`. `W/app/api/sounds/search/route.ts:199-218`
- **Query params** (`route.ts:6-16`):

| Param | Constraint | Default |
|---|---|---|
| `q` | ≤ 500 chars | none |
| `type` | `songs` or `effects` | effects |
| `page` | 1–1000 | 1 |
| `page_size` | 1–150 | 20 |
| `sort` | `downloads`, `rating`, `created`, `score` | downloads |
| `min_rating` | 0–5 | 3 |
| `commercial_only` | boolean | true |

- `type=songs` returns 501 "coming soon" (STUB). `route.ts:188-197`
- **Effects filters**: `duration:[* TO 30.0]`, `avg_rating:[min TO *]`, a tag OR-list (sound-effect, sfx, foley, ambient, nature, mechanical, electronic, impact, whoosh, explosion), and a licence filter `("Attribution" OR "Creative Commons 0" OR "Attribution Noncommercial" OR "Attribution Commercial")`. `route.ts:96-119`
- Bug: `commercial_only` is never read from the request, so it is always true and the UI toggle has no server effect. The "commercial" list also includes "Attribution Noncommercial". `route.ts:159-166`
- **Rate limit**: Upstash sliding window, 100 requests per minute per `x-forwarded-for`, returning 429. `W/auth/rate-limit.ts:10-20`
- **UI**: tabs "Sound effects" and "Saved". `W/sounds/components/assets-view.tsx:38-63`
  - Initial load fetches the top 50 by downloads. `:127`
  - Search is debounced 300 ms. `W/sounds/use-sound-search.ts:92-125`
  - Infinite scroll, restored scroll position.
  - Preview plays `preview-hq-mp3` (falling back to lq) through an `HTMLAudioElement`, one at a time. `assets-view.tsx:199-224`
- Bug: `loadMore` calls store setters with the wrong argument shapes (`appendSearchResults(data.results)`, `setTotalCount(data.count)`), so pagination likely fails. `use-sound-search.ts:58-65` vs `W/sounds/sounds-store.ts:107-115`
- **Saved sounds**: heart toggle, persisted via `storageService` (backend UNVERIFIED), with "Clear all" behind a confirm dialog. `sounds-store.ts:125-207`
- **Add to timeline**: fetch the preview MP3, decode it, and insert a library audio element at the playhead on an auto-placed audio track. `sounds-store.ts:209-251`
  - The full-quality `downloadUrl` is never used.

#### 12. Subtitles and transcription

- **Import** accepts `.srt` and `.ass` (by extension). `W/subtitles/components/assets-view.tsx:281`, `W/subtitles/parse.ts:15-22`
- **SRT**: blocks split on blank lines; the index line is optional; timestamps are `HH:MM:SS[,.]mmm`; text is multi-line. Malformed or non-positive-duration cues are counted as skipped. Markup tags are not stripped. `W/subtitles/srt.ts:3-77`
- **ASS honoured** (`W/subtitles/ass.ts`):
  - `PlayResX/Y` (default 384×288). `:7-8`
  - Styles: Fontname, Fontsize (as a ratio of PlayResY), PrimaryColour (`&HAABBGGRR`), Bold, Italic, Underline/StrikeOut, Spacing, Alignment 1–9 (numpad), MarginL/R/V. `:359-437`
  - BackColour becomes a text background only when BorderStyle = 3.
  - `\N`, `\n` and `\h` are converted; all `{...}` override tags are stripped.
- **ASS ignored, with warnings**: outline, shadow, angle, scale, event Effect, non-Dialogue events, missing styles. `ass.ts:229-257,439-449`
  - Karaoke, positioning and layers are not supported.
- **Caption elements**: a new text track at index 0, one text element per cue named "Caption N", in a single undoable batch. `W/subtitles/insert.ts:21-37`
  - Defaults: Arial, bold, size 5, white, centred, bottom-aligned with a 5 % margin, word-wrapped to 80 % of canvas width, background off. `W/subtitles/build-subtitle-text-element.ts:19-21,148-168`
- **Transcription**: `@huggingface/transformers` ^3.8.1 in a module Web Worker, fully client-side. `pipeline("automatic-speech-recognition", …, {dtype: "q4", device: "auto"})`. `W/services/transcription/worker.ts:60-62`
  - Models are `onnx-community/whisper-{tiny, small, medium, large-v3-turbo}`, default `whisper-small`. `W/transcription/models.ts:6-34`
  - PARTIAL: there is no model picker; the UI never passes `modelId`. `assets-view.tsx:135-139`
  - Audio is the timeline WAV re-decoded to 16 kHz mono. `W/transcription/audio.ts:1`, `audio.ts:62-87`
  - Chunking is 30 s with a 5 s stride; timestamps are segment-level. `worker.ts:137-142`
  - Languages are auto plus en, es, it, fr, de, pt, ru, ja, zh. `W/transcription/languages.ts`
  - Progress reports the model download percentage only. The `transcribe-progress` message is never emitted (PARTIAL).
  - `cancel()` exists but has no UI and only sets a flag. `W/services/transcription/service.ts:83-85`, `worker.ts:48-51`
- **Caption grouping**: 3 words per caption, minimum 0.8 s, timing spread by words per second within a segment, with starts pushed so captions never overlap. `W/transcription/caption.ts:7-48`, `W/transcription/caption-defaults.ts`
- **Diagnostic**: `transcription.no_audio` disables the Generate button. `W/transcription/diagnostics.ts:11-24`
- NOT FOUND: subtitle export (SRT/VTT), VTT import, word-level highlight, translation.

#### 13. Diagnostics and perf

- `DiagnosticsManager` is a registry of `{id, scope, severity: caution|error, message, check(editor)}`. Only one diagnostic is registered. `W/core/managers/diagnostics-manager.ts`, `W/core/index.ts:47`
- **Render perf** is enabled by `window.__renderPerf = true`. `W/diagnostics/render-perf.ts:26,40-42`
  - TS spans: `resolve`, `buildFrame`, `syncTextures`, `renderFrame`, `drawImage`.
  - Wasm spans: `wasm.deserialize`, `wasm.surfaceConfigure`, `wasm.renderFrameToSurface`, `wasm.compositeToTexture`, `wasm.presentToSurface`.
  - Counters: `textureCacheHit`, `textureUpload`, `textureUploadPixels`, `frameItems`, `frameTextures`.
  - Every 60 frames it prints a `console.table` with mean, p50, p95 and max.
  - PARTIAL: `onRenderPerfFrameComplete()` is called only in `renderToCanvas` (snapshot and thumbnail), not in `render()`, which the preview loop and export use. Summaries therefore never flush during normal playback. `W/services/renderer/canvas-renderer.ts:53-74,103`

#### 14. Desktop

- STUB: a GPUI 0.2.2 app that opens a 1280×720 window showing the text "OpenCut". It has no dependency on the `rust/` crates. `apps/desktop/src/main.rs:1-41`, `apps/desktop/Cargo.toml`
- The setup scripts only install native dependencies (apt/dnf/pacman/Xcode CLT).

#### Pipeline narrative

**Preview.** Project state (scene tracks, media assets, settings) lives in TypeScript managers. On any deep change, `buildScene` (TS) creates a flat `RootNode` tree: optional background nodes, then elements from bottom to top. A rAF loop calls `CanvasRenderer.render(tree, time)`, which runs four stages:

1. `resolveRenderTree` (TS, async) evaluates keyframes, fetches decoded video frames from `VideoCache` (mediabunny/WebCodecs `CanvasSink`), loads images and stickers, measures text, and resolves effect passes.
2. `buildFrameDescriptor` (TS) flattens the tree into a JSON `FrameDescriptor` plus a list of textures. Textures are either external sources or Canvas2D-rasterised content (text, masks, colour, backdrop) with content hashes.
3. `wasmCompositor.syncTextures` uploads changed textures via `uploadTexture`.
4. `renderFrame` (Rust/wasm, wgpu) deserialises the descriptor and composites layer by layer (transform → effects → mask/JFA feather → blend shader) onto a surface canvas that is mounted directly in the DOM.

Rust/wasm owns the GPU device, WGSL shaders, texture store and pool, blend/mask/blur/JFA, and integer time maths. TypeScript owns scene logic, animation, decoding, text and mask rasterisation, and all audio.

**Export.** `RendererManager.exportProject` first mixes audio (JS loop plus optional limiter), then builds a full-resolution scene. `SceneExporter` loops over frames sequentially, rendering through the same wasm compositor and feeding its canvas to mediabunny `CanvasSource` (WebCodecs H.264 or VP9). Audio goes through `AudioBufferSource` (AAC, or Opus as fallback or for WebM). The result is muxed into an in-memory MP4 or WebM and downloaded as `{projectName}.{ext}`.

**Live audio** is separate from the export mix: Web Audio nodes scheduled with a 2 s lookahead off the `AudioContext` clock, with late-buffer latency compensation, while the visual playhead runs off `performance.now()`.

#### Not read or only partly read

- `apps/web/src/retime/__tests__/*`
- `rust/crates/time/src/media_time.rs` after line 362 and `timecode.rs` after line 208 (test modules)
- `rust/crates/masks/src/sdf.rs` lines 77–149 (pipeline setup, skimmed by grep only)
- `apps/desktop/script/setup` and `setup.ps1` (grep skim)
- `Cargo.lock` and the generated `opencut_wasm.d.ts`
- Adjacent files read only as excerpts or greps: `preview/components/index.tsx`, `timeline/components/timeline-element.tsx`, `components/editor/panels/assets/views/assets.tsx`, `core/managers/project-manager.ts`, `services/storage/quota.ts` and `service.ts`, `fps/utils.ts`, `commands/media/*`, `commands/timeline/element/toggle-source-audio-separation.ts`, `app/editor/[project_id]/page.tsx`
- Not opened: `usePreviewSize`, `effects/index.ts`, mask definitions, text measure, `timeline/defaults.ts`, `timeline/controllers/drag-drop-controller.ts`

### 2.D Editor shell, projects, assets panel, properties panel, feedback, changelog, site

Path prefix `W/` = `apps/web/src/`. Line numbers come from the files as read. Nothing was created or modified.

#### 1. Projects page (`/projects`)

- **Load**: calls `loadAllProjects()` once if not initialised; shows a 24-card skeleton grid while loading. `W/app/projects/page.tsx:100-104,114-115,919-923`
- **Overlays mounted**: MigrationDialog, StoragePersistenceDialog, ChangelogNotification. `page.tsx:108-110`
- **Header**: breadcrumb "Home / All projects", grid/list toggle (desktop in header, mobile in toolbar), search input, "New project" button ("New" on mobile). `page.tsx:140-193,282-298,519-527`
- **Create**: `createNewProject({name:"New project"})` then navigates to `/editor/{id}`. Only the empty-state button wraps this in a try/catch toast "Failed to create project". `page.tsx:511-516,956-968`
- **Search**: live, case-insensitive substring match on project name only; placeholder "Search...". Not persisted. `page.tsx:333-339`, `W/core/managers/project-manager.ts:554-556`
- **Sort**: keys Created / Modified / Name / Duration (checkbox dropdown) plus a separate asc/desc arrow. Default is `updatedAt` desc. Name comparison is raw `<`/`>`, so it is case-sensitive. `page.tsx:195-200,252-278,471-505`, `W/app/projects/store.ts:63-64`, `project-manager.ts:563-575`
- **View modes**: grid (1/2/3/4 columns by breakpoint) and list. Default grid. `page.tsx:84-87,119-124`
- **Persistence**: localStorage key `projects-view-mode` stores `viewMode`, `sortKey`, `sortOrder` only. `store.ts:124-129`
- **Grid card**: 16:9 thumbnail or placeholder icon, duration badge (MM:SS, or HH:MM:SS at ≥1h), name clamped to 2 lines, "Created {date}". Checkbox and "…" menu appear on hover. `page.tsx:70-82,580-615,696-722`
- **List row**: checkbox, 40px thumbnail, name, duration ("—" if none), created date. `page.tsx:617-683`
- **Open**: clicking a card or row links to `/editor/{id}`. `page.tsx:667,692`
- **Multi-select**:
  - Per-item checkbox; shift+click selects the range from the last selected anchor and merges it into the selection. `page.tsx:566-578`, `store.ts:93-121`
  - "Select all" checkbox with an indeterminate state, over the currently displayed ids. `page.tsx:214-248`
  - Selection is not cleared when the search changes; the all/indeterminate state compares counts only.
- **Bulk actions** (shown when ≥1 selected): Duplicate and Delete (icon buttons; a "…" dropdown below `sm`). Selection clears afterwards. `page.tsx:300,346-359,393-468`
- **Per-item menu** ("…" dropdown and right-click context menu): Rename, Duplicate, Info, Delete. The "…" button is hidden when more than one project is selected; the context menu always acts on the clicked item only. `page.tsx:671,713,763-803,897-914`
- **Rename dialog**: "Rename project", field "New name", Enter or Rename confirms. No trim or empty validation in this path. `W/project/components/rename-project-dialog.tsx:25-67`
- **Delete dialog**: title "Delete '{name}'?" or "Delete N projects?", destructive warning about permanent deletion "and all associated files". `W/project/components/delete-project-dialog.tsx:38-78`
  - **STUB**: the `Type "DELETE" to confirm` input is uncontrolled and never checked; the "Delete project" button always works. `delete-project-dialog.tsx:61-79`
- **Info dialog**: Duration ("0:00" if 0), Created, Modified, Project ID (first 8 characters); Close and Done buttons both just close. `W/project/components/project-info-dialog.tsx:38-76`
- **Empty states**:
  - No projects: "No projects yet" plus "Create your first project". `page.tsx:996-1015`
  - Search with no hits: `No results found` plus "Clear search". `page.tsx:970-993`
- **Limits**: no project-count or name-length limit found.
- **NOT FOUND**: project folders, templates, import/export of project files, cloud sync, pagination, trash/undo-delete.

#### 2. Project manager and save manager

- **New project defaults**: `W/core/managers/project-manager.ts:83-106`
  - One scene, "Main scene" (`isMain`).
  - fps 30/1 (`W/fps/defaults.ts:3`).
  - Canvas 1920×1080 (`W/canvas/sizes.ts:10`), `canvasSizeMode:"preset"`, `lastCustomCanvasSize:null`, `originalCanvasSize:null`.
  - Background colour `#000000` (`W/background/color.ts:1`).
  - Saved immediately; toast "Failed to save new project" on error. `project-manager.ts:117-125`
- **Load sequence**: pause autosave → run storage migrations → clear assets and scenes → load project → init scenes → load media → load fonts used by elements → generate thumbnail if missing and save → resume autosave. `project-manager.ts:128-187`
- **Thumbnail**: renders the active scene at time 0 at full canvas size, stored as a PNG data URL in metadata. `project-manager.ts:650-686`
  - Generated on load only if absent, and regenerated on every "Exit project" (`prepareExit` then flush). `project-manager.ts:169-178,534-545`
- **Autosave**: `W/core/managers/save-manager.ts:17,27-37,59-111`
  - 800 ms debounce, triggered by scenes or timeline change notifications.
  - Skipped while loading or migrating; coalesces saves that arrive during an in-flight save.
  - `saveCurrentProject` recomputes duration and `updatedAt`. `project-manager.ts:189-210`
  - UNVERIFIED: whether `SaveManager.start()` is called and whether settings-only changes mark dirty (`W/core/index.ts` and `W/commands/project` not read).
- **Unsaved guard**: `beforeunload` prompt when a save is pending or in flight. `W/components/providers/editor-provider.tsx:140-149`
- **Duplicate naming**: `project-manager.ts:365-446`
  - Strips an existing `^\((\d+)\)\s+` prefix to get the base name.
  - New name is `(N) base`, where N is the highest existing number for that base + 1, or 1 if none; increments within a batch.
  - New UUID, new `createdAt`/`updatedAt`; the thumbnail is carried over.
  - All media assets are copied to the new project id. `project-manager.ts:454-469`
  - Missing source shows toast "Project(s) not found". `project-manager.ts:383-396`
- **Delete**: removes project and project media in parallel; clears the active project if it was deleted. Errors are only logged. `project-manager.ts:276-308`
- **Rename**: loads, updates name and `updatedAt`, saves; toasts on failure. `project-manager.ts:318-358`
- **Settings update**: goes through an undoable `UpdateProjectSettingsCommand`; `pushHistory:false` is used for live previews. `project-manager.ts:486-502`
- **FPS ratchet**: importing media can raise project fps. `project-manager.ts:504-519` (logic in `W/fps/utils`, not read)
- **Timeline view state** (zoom, scroll, playhead) is persisted per project. `project-manager.ts:610-622`, `W/project/types.ts:38-42`
- **Dead code**: `invalidProjectIds` API has no UI. `project-manager.ts:580-592`

#### 3. Editor page and shell

- **Composition**: MobileGate → EditorProvider → DegradedRendererBanner, EditorHeader, layout, Onboarding, MigrationDialog, ChangelogNotification. `W/app/editor/[project_id]/page.tsx:43-56`
- **Mobile gate**: `W/components/editor/mobile-gate.tsx:10,21-23,29-67`
  - Shown when `window.innerWidth < 1024` and localStorage `mobile-acknowledged` is not `"true"`.
  - Screen "Desktop only (for now)" with "Go back" (`router.back()`), "Take a look anyway" (sets the key), and a "Roadmap" link.
  - Checked once on mount; no resize listener.
- **Loading**: spinner "Loading project..."; initialises the GPU renderer first and sets degraded mode if the GPU is unavailable. `editor-provider.tsx:38-48,100-108`
- **Not found**: if the error message contains "not found" or "does not exist", it silently creates "Untitled Project" and `router.replace`s to it. No 404 screen. `editor-provider.tsx:52-66`
- **Other errors**: full-screen red text with the message (or a captured `window.__wasmPanic`). No retry or back button. `editor-provider.tsx:67-97`
- **Exiting**: spinner "Exiting project..." when the active project becomes null. `editor-provider.tsx:111-119`
- **Degraded banner**: "For the best experience, open OpenCut in Chrome." Dismissible per page load, not persisted. `page.tsx:60-79`
- **Paste**: global paste imports clipboard media, otherwise performs an editor clipboard paste; ignored in typable fields. `page.tsx:82`, `W/media/use-paste-media.ts:42-68`
- **Panel layout** (`react-resizable-panels`, sizes in %): `page.tsx:129-207`

| Panel | Default | Min | Max |
|---|---|---|---|
| Main content (top, vertical group) | 50 | 30 | 85 |
| Timeline (bottom) | 50 | 15 | 70 |
| Assets ("tools", left) | 25 | 15 | 40 |
| Preview (centre) | 50 | 30 | none |
| Properties (right) | 25 | 15 | 40 |

- **Panel persistence**: defaults in `W/panels/layout.ts:1-9`; localStorage key `panel-sizes`, version 2, with a migration from legacy `toolsPanel`/`previewPanel`/`propertiesPanel` keys. `W/editor/panel-store.ts:43-90`
  - `resetPanels` exists but has no UI. `panel-store.ts:40`
  - NOT FOUND: layout presets, panel collapse/hide.
- **Editor store**: holds `canvasPresets`; `initializeApp` is a no-op STUB. `W/editor/editor-store.ts:14-23`
- **Cancel interaction**: a global registry of cancellers; the `cancel-interaction` action cancels active drags, otherwise deselects all. `W/editor/cancel-interaction.ts:5-24`, `W/actions/use-editor-actions.ts:395-401`
- **Menu preview**: hover-preview in dropdowns is discarded on pointer-leave or close unless committed; used by the Masks add menu. `W/editor/use-menu-preview.ts:8-25`

##### Editor header (`W/components/editor/editor-header.tsx`)

- **Left, logo dropdown** (`:124-151`). Every item:
  1. Exit project: regenerates the thumbnail, flushes the save, closes the project, goes to `/projects`; disabled while exiting. `:55-68`
  2. Shortcuts: opens ShortcutsDialog.
  3. Separator.
  4. Discord: external link.
- **PARTIAL**: RenameProjectDialog and DeleteProjectDialog are mounted, but no menu item ever opens them. `:153-164`
- **Inline project name**: click to edit; Enter or blur saves (trimmed; empty reverts); Escape reverts. `:182-229`
- **Right**: "Send feedback" popover, Export button, theme toggle. `:37-41`
- **NOT FOUND**: File/Edit/View menus, undo/redo buttons, save indicator, user/account menu, share button.

##### Export popover (UI only) (`W/components/editor/export-button.tsx`)

- Gradient "Export" button, disabled without an active project. `:66-73`
- Three collapsed sections (`:166-252`):
  - Format: "MP4 (H.264) - Better compatibility" or "WebM (VP9) - Smaller file size".
  - Quality: Low / Medium / High ("Recommended") / Very high.
  - Audio: "Include audio in export" checkbox.
- Defaults come from `DEFAULT_EXPORT_OPTIONS` (values UNVERIFIED). fps is always the project fps. `:104-122`
- While exporting: title "Exporting project", percentage, progress bar, Cancel. `:264-283`
- Closing the popover cancels the export. `:52-57`
- Success downloads `{projectName}.{ext}` and closes. `:131-139`
- Failure: "Export failed" with the message, Copy (1 s tick), Retry. `:292-334`
- NOT FOUND in UI: resolution, fps or bitrate pickers, range export, audio-only, GIF.

##### Onboarding (`W/components/editor/onboarding.tsx`)

- Three-step dialog; localStorage key `hasSeenOnboarding` (JSON boolean). `:13-16`
  1. "Welcome to OpenCut Beta! 🎉"
  2. "⚠️ This is a super early beta!" with a roadmap link.
  3. "🦋 Have fun testing!" with a Discord link and Finish.
- Closing at any step marks it seen. `:24-26,83`

##### Scenes sheet (`W/components/editor/scenes-view.tsx`)

- Opened from the timeline toolbar. `W/timeline/components/timeline-toolbar.tsx:257`
- Lists scenes; click switches scene; the current one shows a check. `:35-46,143-166`
- "Select" mode multi-selects for delete; Delete is disabled if the main scene is selected; confirm dialog "Delete Scenes … cannot be undone". `:88-134,196-214`
- NOT FOUND in this file: create, rename or reorder scene.

#### 4. Assets panel (left)

Vertical icon tab bar with tooltips and scroll fades. `W/components/editor/panels/assets/tabbar.tsx:54-89`. The active tab is not persisted and resets to Media. `assets-panel-store.tsx:102,117-121`

| # | Tab | Status | Source |
|---|---|---|---|
| 1 | Media | Enabled | `W/components/editor/panels/assets/index.tsx:18` |
| 2 | Sounds | Enabled (internals not read) | `index.tsx:19` |
| 3 | Text | Enabled (internals not read) | `index.tsx:20` |
| 4 | Stickers | Enabled (internals not read) | `index.tsx:21` |
| 5 | Effects | Enabled (internals not read) | `index.tsx:22` |
| 6 | Transitions | **STUB**: "Transitions view coming soon..." | `index.tsx:23-27` |
| 7 | Captions | Enabled (internals not read) | `index.tsx:28` |
| 8 | Adjustment | **STUB**: "Adjustment view coming soon..." | `index.tsx:29-33` |
| 9 | Settings | Enabled | `index.tsx:34` |

NOT FOUND: Filters tab, AI tab, Templates tab.

##### Media view (`W/components/editor/panels/assets/views/assets.tsx`)

- Header "Assets" with a view toggle, sort dropdown and "Import" button. `:194-206,525-617`
- **Import**: file picker or drag-drop onto the panel; accepts `image/*,video/*,audio/*`, multiple. Shows an upload toast and progress. `:80-123`
- **Empty or drag-over state**: a clickable drop zone, "Drag and drop videos, photos, and audio files here", or "Processing your files (N%)" with a bar. `:211-217`, `drag-overlay.tsx:42-57`
- **View modes**: grid (7rem auto-fill columns) or list (compact rows). `:356-363`
- **Sort**: Name / Type / Duration / File size; clicking the active key flips asc/desc, a new key starts asc. Default name asc. `:140-185,569-596`
- **Persistence**: localStorage key `assets-panel` stores view mode and sort. `assets-panel-store.tsx:108-121`
- **Filter**: only hides `ephemeral` assets. `:152`
- **Previews**: image thumbnail; video thumbnail with duration badge (grid only); audio placeholder with duration; "Unknown" fallback. `:437-506`
- **Multi-select**: via `SelectableSurface`/`SelectableItem`; marquee and modifier behaviour live in `W/selection` (UNVERIFIED). `:219-231`
- **Reveal**: `requestRevealMedia` switches to Media and highlights an asset. `assets-panel-store.tsx:105-106`
- **Context menu**: `:326-336`
  - "Export clips": **STUB**, no handler. `:327`
  - "Delete" or "Delete N items" (acts on the selection if the item is in it); invokes action `remove-media-assets`. `:134-137,319-321`
- **Add to timeline**: hover "+" inserts at the playhead with auto placement; duration is the asset duration or `DEFAULT_NEW_ELEMENT_DURATION`. `:256-277`, `draggable-item.tsx:120-125`
- **Drag to timeline**: HTML5 drag with a hidden native ghost and a custom 80px floating preview. Non-audio media carries `targetElementTypes` so it can be dropped onto maskable elements. `draggable-item.tsx:76-93,168-197`, `assets.tsx:284-292`
- **Card label**: names longer than 8 characters are shown as first 16 + "..." + last 3. `draggable-item.tsx:134-136`
- **NOT FOUND**: asset search, type filter, folders/bins, rename asset, asset info, replace media, "used in timeline" indicator.

##### Settings view (`W/components/editor/panels/assets/views/settings/index.tsx`)

Two sub-tabs, "Project info" and "Background". `:224-227`

- **Project info**:
  - Name: read-only. `:233-239`
  - Frame rate: select of 24 / 25 / 30 / 60 / 120 fps. The displayed value is the rounded current fps. `:244-260`, `W/fps/presets.ts:1-7`
  - Aspect ratio (collapsible): `:273-314`
    - Presets 16:9 (1920×1080), 9:16 (1080×1920), 1:1 (1080×1080), 4:3 (1440×1080). `W/canvas/sizes.ts:3-8`
    - "Custom": width and height number fields, positive integers, rounded. Restores `lastCustomCanvasSize` when reselected. `:62-71,128-207`
  - All changes are undoable.
- **Background** (`settings/background.tsx`):
  - Blur section (open by default): Light = 100, Medium = 200, Heavy = 500, each with a live preview canvas. `W/background/blur.ts:4-8`, `background.tsx:244-270`
  - Three collapsed sections: "Colors" (solid swatches plus a custom colour picker with live preview and commit-on-release), "Pattern craft", "Syntax UI" (gradients). `:182-186,272-305`
  - Swatch data in `W/data/colors/*` not read.
  - NOT FOUND: image/video background, blur intensity slider.

#### 5. Properties panel (right)

- **Nothing selected**: "It's empty here / Click an element on the timeline to edit its properties". `W/components/editor/panels/properties/empty-view.tsx:13-16`
- **More than one selected**: only the text "{N} elements selected.0" (stray "0"). No multi-edit: PARTIAL. `properties/index.tsx:33-39`
- **One selected**: vertical icon tab strip plus content. The active tab is remembered per element type in memory only. `index.tsx:56-60`, `stores/properties-store.ts:10-15`
- `isTransformScaleLocked` exists in the store with no consumer anywhere: STUB. `properties-store.ts:16-18`

##### Tabs per element type (`W/components/editor/panels/properties/registry.tsx:223-354`)

| Element | Tabs in order (default in bold) |
|---|---|
| text | **Text**, Transform, Blending |
| video | **Transform**, Audio (hidden if the asset has `hasAudio === false`), Speed, Blending, Masks, Effects |
| image | **Transform**, Blending, Masks, Effects |
| sticker | **Transform**, Blending, Effects |
| graphic | **Graphic**, Transform, Blending, Masks, Effects |
| audio | **Audio**, Speed |
| effect | **Effects** (standalone) |

##### Fields per tab (definitions in `W/params/registry.ts`)

| Tab | Field | Control | Range / options | Keyframable |
|---|---|---|---|---|
| Transform | Position X, Position Y | number | min −100000, step 1 (`:98-112`) | yes |
| Transform | Scale X, Scale Y | number | min 0.01, step 0.01, default 1 (`:114-128`) | yes |
| Transform | Rotate | number | −360..360, step 1 (`:130-137`) | yes |
| Blending | Opacity | number | 0..1, step 0.01 (`:139-146`) | yes |
| Blending | Blend Mode | select | 17 modes: Normal, Darken, Multiply, Color Burn, Lighten, Screen, Plus Lighter, Color Dodge, Overlay, Soft Light, Hard Light, Difference, Exclusion, Hue, Saturation, Color, Luminosity (`:76-94`) | no |
| Audio | Volume | number (dB) | −60..20, step 0.01, default 0 (`:159-166`, `W/timeline/audio-constants.ts:1-2`) | yes |
| Audio | Muted | switch | default off (`:168-173`) | no |
| Text | Content | textarea | default "Default text" | no |
| Text | Font Family | plain text input | default Arial | no |
| Text | Font Size | number | min 1, step 1, default 15 | yes |
| Text | Color | colour picker | default #ffffff | yes |
| Text | Text Align | select | Left / Center / Right | no |
| Text | Font Weight | select | Normal / Bold | no |
| Text | Font Style | select | Normal / Italic | no |
| Text | Text Decoration | select | None / Underline / Line Through | no |
| Text | Letter Spacing | number | min −100, step 0.1, default 0 | yes |
| Text | Line Height | number | min 0.1, step 0.1, default 1.2 | yes |
| Text | Background Enabled | switch | default off | no |
| Text (only when background enabled) | Background Color | colour | default #000000 | yes |
| Text (same) | Background Radius | number | 0..100 | yes |
| Text (same) | Background Padding X / Y | number | min 0; defaults 30 / 42 | yes |
| Text (same) | Background Offset X / Y | number | min −100000 | yes |
| Speed | Speed | number, suffix "x" | 0.01..5, step 0.01, default 1; reset button | no |
| Speed | Change pitch | switch | inverse of `maintainPitch` | no |
| Graphic | per-definition shape params | generic param fields | from `graphicsRegistry` (UNVERIFIED) | yes |
| Graphic | "Stroke" section | +/− toggle plus stroke params | toggle sets `strokeWidth` to 0 or the last width (default 2) | yes |
| Masks | see below | | | |
| Effects | see below | | | |

Citations for the Text rows: `W/params/registry.ts:176-327`, defaults `W/timeline/defaults.ts:18-29`. Speed: `W/speed/components/speed-tab.tsx:118-150`, `W/retime/rate.ts:1-3`. Graphic: `W/graphics/components/graphic-tab.tsx:30,56-81,112-189`.

- **Font Family is PARTIAL**: the `font` param type renders a plain text input here, not the FontPicker. `W/components/editor/panels/properties/components/property-param-field.tsx:149-157`. Where `components/ui/font-picker.tsx` is used is UNVERIFIED.
- **Masks tab** (skimmed only): `W/masks/components/masks-tab.tsx:256-299,340-369,435-640,688-734`
  - "Add mask" dropdown with hover preview. Only one mask per element: the button is disabled with a tooltip once one exists.
  - Per mask: invert toggle, remove.
  - Fields: Position (x/y), Size (w/h) or Height/Width, Scale, Rotation, Feather, Stroke (width plus a select).
  - Text mask: Content, Font, Size, Spacing.
- **Effects tab (clip)**: `W/effects/components/effects-tab.tsx:148-200,206-229,258-304`
  - List of applied effects, each with an enable/disable eye, delete, drag-to-reorder, and its params as generic fields without keyframe toggles.
  - Empty state "No effects" with "Open effects", which switches the assets panel to Effects.
- **Effects tab (standalone effect element)**: a single "Effect" section with params only. `effects-tab.tsx:56-68`

##### Common field behaviour

- **Number field**: `property-param-field.tsx:174-222`
  - Type, or click-drag scrub (slow sensitivity).
  - Snaps to step and clamps to min/max.
  - Reset-to-default button.
- **Draft editing**: live preview while typing; commit on blur. Math expressions (`+ * /` or a non-leading `-`) are evaluated on blur. `hooks/use-property-draft.ts:4-10,42-67`
- **Keyframe toggle** (diamond before the label): `components/keyframe-toggle.tsx:17-30`, `components/element-params-tab.tsx:101-109`, `hooks/use-keyframed-param-property.ts:72-143`
  - Adds or removes a keyframe at the playhead.
  - Disabled when the playhead is outside the element.
  - If the property already has keyframes, edits write a keyframe at the playhead instead of the base value.
- **Sections**: collapsible state is cached in memory per `sectionKey`, not persisted. `W/components/section.tsx:8,42-65`

#### 6. Feedback

- "Send feedback" popover in the editor header. `W/feedback/components/feedback-popover.tsx:97-106,168-206`
  - Textarea "Thoughts, bugs, ideas...".
  - Send is disabled when empty or submitting; Cancel shows only while empty.
- Draft persists under key `feedback-draft`. `:24,160`
- On success: toast "Feedback sent", form reset, popover closes. `:75-80`
- History view (clock icon plus count): the last 20 sent messages from localStorage `feedback-history`, with relative timestamps. `:25-26,131-155,216-229`
- API: POST `/api/feedback` with `{message}`, 1–5000 characters; rate limited (429 "Too many requests"); 400 on invalid input; 201 `{entry}`. Anonymous, no auth. `W/app/api/feedback/route.ts:6-30`, `W/feedback/types.ts:1`

#### 7. Changelog

- **Notification card** (bottom-left, 288px): title, version, summary, dismiss, "See full changelog". `W/changelog/components/changelog-notification.tsx:11,28-45,51-84`
  - Shown when localStorage `last-seen-version` is missing or older than the latest published release.
  - The key is written as soon as the card is shown.
  - PARTIAL: `TODO(v0.4)` says first-time visitors should be recorded silently, but they currently get the card. `:34-36`
  - Mounted on the projects and editor pages. It is imported but not rendered in `W/app/layout.tsx:5`.
- **`/changelog`**: timeline list of published releases, newest first. Sections are Features, Improvements, Fixes, Breaking Changes, and a collapsible "Technical details". `W/app/changelog/page.tsx:40-65`, `W/changelog/utils.ts:12-22,72-78`
- **`/changelog/[version]`**: detail page with "All releases", a Copy-markdown button, and Older/Newer navigation; static params. `W/app/changelog/[version]/page.tsx:18-98`
  - `copy-markdown-button.tsx` was only partly read (UNVERIFIED beyond line 37).
- **Risk**: `apps/web/content-collections.ts:6` points at `src/lib/changelog/entries`, but the entries live in `src/changelog/entries` and `src/lib` does not exist. The collection may build empty; build not run, so UNVERIFIED.
- **Entries**:
  - 0.1.0 (2026-02-23) "Editor foundation".
  - 0.2.0 (2026-03-01) "Motion & effects".
  - 0.3.0 (2026-04-15) "Masks, animation & more".
- **`0.4.0.md` is an unpublished draft**: front-matter `version: "0.3.0"`, `date: "2026-03-04"`, `published: false`, title "Title", description "Description", no summary. `W/changelog/entries/0.4.0.md:2-6`. Its six changes in full:
  1. new: layout guides are back and expanded: a grid guide plus TikTok, Instagram Reels, YouTube Shorts and Snapchat Spotlight (previously TikTok only).
  2. new: two new mask types, text and custom (pen tool with bezier curves); both support feather, invert and stroke.
  3. fixed: preview panning keeps working while the Masks tab is open.
  4. new: audio clips have a draggable horizontal volume line; same dB always means the same position across clips.
  5. improved: waveforms show the actual audio shape; bars peaking above 0 dBFS get a coloured tip.
  6. fixed: trimming or cutting audio no longer compresses or mis-offsets the waveform.

#### 8. Site pages

- **Root layout**: `W/app/layout.tsx:12-61`
  - Inter font; next-themes with `attribute="class"`, `defaultTheme="system"`.
  - Sonner toaster and TooltipProvider.
  - BotId client.
  - Databuddy analytics script (disabled in development).
  - react-scan in development only.
  - `lang="en"`.
- **Metadata**: title "OpenCut"; description "A simple but powerful video editor that gets the job done. In your browser."; OG/Twitter images, icons, manifest. `W/app/metadata.ts:4-85`, `W/site/brand.ts:1-13`
- **Themes**: light `:root`, `.dark`, and a `.panel` scope with slightly different tokens (and `.dark .panel`). Primary `hsl(200,90%,52%)`. Custom `xs` breakpoint at 30rem; custom font sizes, radii and scrollbar utilities. `W/app/globals.css:10-116,148-165,243-282`
- **Theme toggle**: flips dark ↔ light. With theme "system" a click sets dark. No "system" option in the UI. `W/components/theme-toggle.tsx:28`
- **Landing** (`/`): Header, Hero ("The open source / Video editor" with draggable trim handles around the text, minimum separation 60px), CTA "Try early beta" → `/projects`, Footer. `W/app/page.tsx:13-20`, `W/components/landing/hero.tsx:20-36`, `handlebars.tsx:13-16`
- **Header**: `W/components/header.tsx:32-49,55-96,110-193`
  - Logo → `/`, with a right-click menu: Copy SVG, Download SVG, Brand assets.
  - Nav: Roadmap, Contributors, Sponsors, Blog.
  - GitHub "40k+" button (hard-coded), "Projects" button, theme toggle.
  - Mobile: full-screen blurred menu.
- **Footer**: tagline, GitHub/X/Discord links; Resources (Roadmap, Changelog, Blog, Privacy, Terms of use); Company (Contributors, Sponsors, Brand, About → GitHub README). `W/components/footer.tsx:18-31`, `W/site/social.ts:1-5`
- **Blog**: Marble CMS. `W/blog/query.ts:16-18,49-56,64-81,119-132`
  - `NEXT_PUBLIC_MARBLE_API_URL` (default `https://api.marblecms.com`) and `MARBLE_WORKSPACE_KEY` (a hard-coded default key is present).
  - Returns empty lists on failure or placeholder keys.
  - `/blog` lists title and description; "No posts yet" fallback. `W/app/blog/page.tsx:21-22`
  - `/blog/[slug]`: date, title, cover, sanitised HTML with heading anchors; static params; `notFound` if missing. `W/app/blog/[slug]/page.tsx:58-80`
  - `W/blog/types.ts` not read.
- **Contributors**: GitHub contributors API (100 per page, 10-minute revalidate, users only); top 2 featured; totals; "External tools" (Marble, Databuddy); contribute CTA. `W/app/contributors/page.tsx:30-93`, `W/site/external-tools.ts:10-24`
- **Roadmap**: four static items (Start: Completed; Core UI: Completed; Essential functionality: In progress; Native app: Not started); last updated "February 25, 2026". `W/app/roadmap/page.tsx:8,23-60`
- **Sponsors**: Fal.ai and Vercel cards. `W/site/sponsors.ts:9-24`
- **Brand**: Symbol and Lockup SVGs (dark/light) on checkerboards, copy-SVG on hover, "Download all" (staggered 200 ms), usage guidelines. `W/app/brand/page.tsx:47-106,130-142,172-208`
- **Privacy / Terms**: static pages with a quick-summary accordion (skimmed). `W/app/privacy/page.tsx:27-188`, `W/app/terms/page.tsx:27-203`
  - Privacy states "OpenCut does not currently offer user accounts, login, or Google sign-in."
  - Terms has an "AI Features" section: auto captions run on-device.
- **RSS**: `/rss.xml` from blog posts, cached for one day. `W/app/rss.xml/route.ts:5-45`
- **Robots**: disallows `/_next/`, `/projects/`, `/editor/`. `W/app/robots.ts:5-11`
- **Sitemap**: home, contributors, roadmap, privacy, terms, blog, posts, and `/why-not-capcut`. `W/app/sitemap.ts:16-59`
  - The `/why-not-capcut` page is NOT FOUND in `app/`.
  - Changelog, sponsors and brand are missing from the sitemap.

#### 9. Storage persistence, quota, hooks, platform

- **Persistence request**: `W/services/storage/use-storage-persistence.ts:5-43`, `components/storage-persistence-dialog.tsx:21-36`
  - Runs on the projects page if `navigator.storage.persist` exists, storage is not already persisted, and localStorage `opencut-storage-persist-dismissed` is not `"true"`.
  - Firefox: shows the dialog "Don't lose your projects" with "Not now" (sets the key) and "Allow".
  - Other browsers: silently calls `persist()`.
- **Quota**: `W/services/storage/quota.ts:5,45-126`
  - Reserves 50 MB of headroom.
  - `evaluateStorageCapacity` allows the write if no estimate is available.
  - Error text: "Not enough browser storage to save a {size} file."
  - Consumed by the storage service and media processing (not read).
- **StorageProvider**: toast "Storage not fully supported. Some features may not work." if IndexedDB or OPFS is missing. The provider is defined but not mounted anywhere: dead code. `W/components/storage-provider.tsx:48-54`
- **Browser support checks**: only the GPU-availability banner and the storage toast above. `utils/browser.ts` has only `downloadBlob`, `findScrollParent`, `isTypableDOMElement`; `utils/platform.ts` has ⌘/Ctrl and ⌥/Alt labels via `navigator.platform`. `W/utils/browser.ts:1-48`, `W/utils/platform.ts:1-11`
  - NOT FOUND: an unsupported-browser blocking screen, a WebCodecs check in this slice.
- **Hooks** (`W/hooks/*`): `useFocusLock`, `useFullscreen`, `useInfiniteScroll` (threshold 200px), `useIsMobile` (<768px), `useRafLoop`, `useResizeObserver`, `useContainerSize`, `useShiftKey`, `useCommittedRef`.
- **`useLocalStorage`**: JSON, reads after mount. `W/services/storage/use-local-storage.ts:19-42`

##### localStorage keys in this slice

`projects-view-mode`, `panel-sizes`, `assets-panel`, `mobile-acknowledged`, `hasSeenOnboarding`, `feedback-draft`, `feedback-history`, `last-seen-version`, `opencut-storage-persist-dismissed`, plus the next-themes key.

#### 10. Repo-wide searches

- **i18n**: NOT FOUND. No next-intl, i18next or similar; all strings are hard-coded English. The only hit is `locale: "en_US"` in OG metadata. `W/app/metadata.ts:13`
- **Auth UI**: NOT FOUND. No login or signup pages and no user menu. `W/auth/client.ts:4` exports better-auth `signIn`/`signUp`/`useSession` with no consumers; `W/app/api/auth/[...all]/route.ts` exists (not read).
- **AI features**: no fal, OpenAI or generative calls. Fal.ai appears only as a sponsor. The only AI is on-device transcription via `@huggingface/transformers` (`apps/web/package.json:24`, `W/services/transcription/worker.ts`), which is outside this slice.
- **"coming soon" / disabled**:
  - Transitions and Adjustment tabs (above).
  - "Freeze frame (coming soon)", disabled. `W/timeline/components/timeline-toolbar.tsx:188-189`
  - "Song search functionality is coming soon". `W/app/api/sounds/search/route.ts:193`
  - Add-mask disabled once one mask exists. `W/masks/components/masks-tab.tsx:269`
  - "Undo not implemented for this command" base throw. `W/commands/base-command.ts:25`
- **TODO**: only the changelog-notification one.
- **NOT FOUND overall**: media folders, project templates, cloud sync or collaboration, AI tools panel, transitions, filters tab, adjustment layer.

#### 11. Docs (brief)

- **`.github/CONTRIBUTING.md`**: feature PRs are not accepted (issue first); stack is Bun, Docker (Postgres + Redis), Better Auth secret and Upstash env vars. It says to avoid preview and export work because of a planned preview refactor, which is stale given the Rust/wgpu compositor described in the 0.3.0 changelog.
- **`docs/actions.md`**: actions are the trigger layer (define → handler via `useActionHandler` → optional arg types); UI should call `invokeAction`, not `editor.*`; new default shortcuts need a keybinding migration. Its paths (`src/lib/actions`, `src/stores`, `src/hooks/actions`) are stale; the code is now at `W/actions/*`.
- **`notes/primitives-vs-domains.md`**: an architecture note about moving primitives like `Transform` out of domain folders. No user-facing content.
- **`AGENTS.md`**: logic is migrating into `rust/`; apps are UI shells.

#### Files in the slice not read (or only skimmed)

- `W/masks/components/masks-tab.tsx`: grep-skimmed for labels plus lines 240-330 only.
- `W/changelog/components/copy-markdown-button.tsx`: lines 1-37 only.
- `W/components/landing/handlebars.tsx`: constants and grep only.
- `W/app/privacy/page.tsx`, `W/app/terms/page.tsx`: headings and text skim.
- `W/blog/types.ts`
- `W/app/api/auth/[...all]/route.ts`, `W/app/api/health/route.ts`, `W/app/api/sounds/search/route.ts`
- `W/components/editable-timecode.tsx`, `W/components/ui/*` (including `number-field`, `color-picker`, `font-picker`, `form`), `W/components/icons/*`
- `W/params/index.ts`, `W/data/colors/*`, `W/fps/utils.ts`, `W/commands/project/*`, `W/core/index.ts`, `W/export/defaults.ts`, `W/selection/*`, `W/actions/components/shortcuts-dialog.tsx`
- `W/media/use-file-upload.ts`, `W/media/upload-toast.ts`, `W/media/processing.ts`
- Assets-view components for sounds, text, stickers, effects and captions
- `W/services/storage/service.ts` (only `isFullySupported`), the adapters, and the migrations
- `docs/countries-search.md`, `docs/effects-renderer.md`, `docs/keyframes.md`

### 2.E Keyboard shortcuts and rebinding

#### Action catalogue and defaults

All from `apps/web/src/actions/definitions.ts:26-178`. "ctrl" means Cmd on Apple devices and Ctrl elsewhere (`actions/keybinding.ts:3-6`, `actions/keybindings-store.ts:262`).

| Action id | Description | Category | Default keys |
|---|---|---|---|
| `toggle-play` | Play/Pause | playback | `space`, `k` |
| `stop-playback` | Stop playback (pause, seek to 0) | playback | none |
| `seek-forward` | Seek forward 1 second | playback | `l` |
| `seek-backward` | Seek backward 1 second | playback | `j` |
| `frame-step-forward` | Frame step forward | navigation | `right` |
| `frame-step-backward` | Frame step backward | navigation | `left` |
| `jump-forward` | Jump forward 5 seconds | navigation | `shift+right` |
| `jump-backward` | Jump backward 5 seconds | navigation | `shift+left` |
| `goto-start` | Go to timeline start | navigation | `home`, `enter` |
| `goto-end` | Go to timeline end | navigation | `end` |
| `split` | Split elements at playhead | editing | `s` |
| `split-left` | Split and remove left | editing | `q` |
| `split-right` | Split and remove right | editing | `w` |
| `delete-selected` | Delete current selection | editing | `backspace`, `delete` |
| `copy-selected` | Copy selected elements | editing | `ctrl+c` |
| `paste-copied` | Paste elements at playhead | editing | `ctrl+v` |
| `toggle-snapping` | Toggle snapping | editing | `n` |
| `toggle-ripple-editing` | Toggle ripple editing | editing | none |
| `toggle-source-audio` | Extract or recover source audio | editing | none |
| `select-all` | Select all elements | selection | `ctrl+a` |
| `deselect-all` | Deselect all elements | selection | none |
| `duplicate-selected` | Duplicate selected element | selection | `ctrl+d` |
| `toggle-elements-muted-selected` | Mute/unmute selected elements | selection | none |
| `toggle-elements-visibility-selected` | Show/hide selected elements | selection | none |
| `cancel-interaction` | Cancel current interaction (then deselect one level) | controls | `escape` |
| `toggle-bookmark` | Toggle bookmark at playhead | timeline | none |
| `undo` | Undo | history | `ctrl+z` |
| `redo` | Redo | history | `ctrl+shift+z`, `ctrl+y` |
| `remove-media-asset` | Remove media asset (args `projectId`, `assetId`) | assets | none (not bindable, needs args) |
| `remove-media-assets` | Remove media assets (args `projectId`, `assetIds`) | assets | none (not bindable, needs args) |

Handler semantics are in `actions/use-editor-actions.ts:30-520` (seek clamps to `[0, duration]`; frame step is `round(120000 × den / num)` ticks; split targets the selection or everything under the playhead; delete dispatches on mask points → keyframes → elements).

NOT FOUND as actions: cut, zoom in/out (timeline or preview), fit, fullscreen, export, save, new project, open shortcuts dialog, nudge element, select next/previous, add text, toggle panels.

#### Key grammar

- Modifiers: `ctrl`, `alt`, `shift`, `ctrl+shift`, `alt+shift`, `ctrl+alt`, `ctrl+alt+shift` (`actions/keybinding.ts:7-14`).
- Keys: `a`–`z`, `0`–`9`, `up`, `down`, `left`, `right`, `/`, `?`, `.`, `enter`, `tab`, `space`, `escape`, `esc`, `backspace`, `delete`, `home`, `end` (`keybinding.ts:16-27`). Function keys, `-`, `=`, `[`, `]`, `,` and others cannot be bound.
- Letters and digits are read from `KeyboardEvent.code` (physical position), so AZERTY and similar layouts keep QWERTY positions (`keybindings-store.ts:233-258`).

#### Dispatch rules (`actions/use-keybindings.ts:12-87`)

- One capture-phase `keydown` listener on `document`.
- Shortcuts are suppressed while any overlay is open (`overlayDepth > 0`, registered via `components/ui/use-overlay-open-change.ts`), while a project is loading, and while a shortcut is being recorded.
- In a typable element: Escape blurs it; every other binding is ignored. Single-key and Shift-only combos return no binding at all when the event target is typable (`keybindings-store.ts:205-226`).
- `paste-copied` only fires (and prevents default) when the in-memory editor clipboard has an entry; otherwise the native paste event proceeds and the media-paste handler runs (`use-keybindings.ts:46-51`, `media/use-paste-media.ts`).
- `seek-*` are invoked with 1 s and `jump-*` with 5 s.
- Multiple handlers per action are allowed; all run (`actions/registry.ts:13-66`). Handlers bind through `useActionHandler` (`actions/use-action-handler.ts`). UI buttons call `invokeAction(action, args, "mouseclick")`.

#### Rebinding UI (`actions/components/shortcuts-dialog.tsx`)

- Opened from the editor header logo menu → "Shortcuts".
- Lists bound actions grouped by category, sorted by category then description; keys shown with platform labels (⌘/Ctrl, ⌥/Alt, arrows) (`actions/use-keyboard-shortcuts-help.ts:20-76`).
- Click any key chip → recording mode ("Press any key combination..."); the next valid key combination becomes the binding. Clicking elsewhere cancels.
- Conflict: if the key is bound to a different action, a toast `Key "x" is already bound to "y"` is shown and the change is rejected (no swap).
- On success **all** existing keys of that action are removed and replaced by the single new key (so `space`/`k` collapses to one key).
- "Reset to default" restores every default.
- PARTIAL: the list is built from the current key→action map, so actions with no binding (the nine "none" rows above, or any action whose key was removed) never appear and cannot be given a shortcut through the UI.
- PARTIAL: `importKeybindings` / `exportKeybindings` exist in the store with no UI (`keybindings-store.ts:135-155`).
- NOT FOUND: adding a second key to an action, removing a binding from the UI, shortcut search, chords/sequences.

#### Persistence and migrations

- zustand `persist`, localStorage key `opencut-keybindings`, version 7; persisted shape `{ keybindings: Record<key, action>, isCustomized: boolean }` (`keybindings-store.ts:171-198`).
- Migrations (`actions/keybindings/migrations/*.ts`):
  - v2→v3: rename actions `split-selected` → `split`, `split-selected-left` → `split-left`, `split-selected-right` → `split-right`.
  - v3→v4: rename `paste-selected` → `paste-copied`.
  - v4→v5: bind `escape` → `deselect-all` if `escape` is unbound.
  - v5→v6: `escape: deselect-all` → `cancel-interaction`.
  - v6→v7: rename `split-element` → `split`.
- BUG?: `actions/keybindings/persistence.ts` (strict import parser and lossy decoder) imports two helpers that do not exist; only its test references it.
- `docs/actions.md` rule: adding a new default shortcut requires a keybinding migration, because persisted maps replace defaults wholesale.

#### Hard-coded keys and modifiers (not rebindable)

| Where | Behaviour | Source |
|---|---|---|
| Timeline wheel | Ctrl/Cmd + wheel zooms; Shift + wheel scrolls horizontally | `timeline/components/index.tsx:242,267`, `timeline/controllers/zoom-controller.ts:109-111` |
| Preview wheel | Ctrl/Cmd + wheel zooms; plain wheel pans when zoomed | `preview/components/index.tsx:237` |
| Timeline elements | Cmd/Ctrl/Shift + click toggles selection | `timeline/controllers/element-interaction-controller.ts:375,418` |
| Box select | Shift/Ctrl/Cmd makes it additive | `timeline/components/index.tsx:349`, `selection/hooks/use-box-select.ts:93` |
| Keyframes | Cmd/Ctrl toggles; Shift selects a range | `timeline/controllers/keyframe-drag-controller.ts:149-211` |
| Any drag (timeline, preview, mask, bezier) | Shift disables snapping | `hooks/use-shift-key.ts` and controllers |
| Playhead handle (focused) | ArrowLeft/ArrowRight step one frame | `timeline/components/timeline-playhead.tsx:91` |
| Timecode field | Enter applies, Escape cancels | `components/editable-timecode.tsx:81-85` |
| Project name (header) | Enter saves, Escape reverts | `components/editor/editor-header.tsx:218-221` |
| Number field | Enter/Escape blur | `components/ui/number-field.tsx:233` |
| Text edit overlay | Enter newline, Escape commits | `preview/components/text-edit-overlay.tsx` |
| Mask points | Shift-click toggles point selection | `masks/use-mask-handles.ts:423-425` |
| Media/project lists | Shift-click range, Ctrl/Cmd toggle | `selection/selectable-surface.tsx:109-111`, `app/projects/page.tsx:566-578` |
| Bookmark marker | Enter/Space seeks | `timeline/bookmarks/components/bookmarks.tsx:431` |

### 2.F Storage, persistence, migrations, project versioning

#### What is stored where

| Store | Technology | Name / key | Content | Source |
|---|---|---|---|---|
| Projects | IndexedDB | DB `video-editor-projects`, object store `projects`, keyPath `id`, version 1 | one `SerializedProject` per project (metadata, scenes with tracks and bookmarks, `currentSceneId`, settings, `version`, `timelineViewState`); the thumbnail is a PNG data URL inside metadata | `services/storage/service.ts:63-78,134-170` |
| Media metadata | IndexedDB | DB `video-editor-media-{projectId}`, store `media-metadata` | `MediaAssetData` per asset (id, name, type, size, lastModified, width, height, duration, thumbnailUrl data URL, ephemeral) | `service.ts:93-103,292-311` |
| Media files | OPFS | directory `media-files-{projectId}`, file name = asset id | the original `File` bytes | `service.ts:100`, `services/storage/opfs-adapter.ts` |
| Saved sounds | IndexedDB | DB `video-editor-saved-sounds`, store `saved-sounds`, key `user-sounds` | `{ sounds: SavedSound[], lastModified }` (global, not per project) | `service.ts:74-78,447-520` |
| Legacy | IndexedDB | `video-editor-meta` (deleted on first migration run), `video-editor-timelines-*` (read and deleted by v1→v2) | pre-v2 data | `migrations/runner.ts:30-39`, `migrations/v1-to-v2.ts` |
| UI prefs | localStorage | see table below | zustand persisted stores and flags | various |

Notes:
- `saveMediaAsset` writes the OPFS file first, then metadata; on failure it removes the file and maps quota errors to `StorageQuotaExceededError` (`service.ts:281-330`). `fps` and `hasAudio` are in the `MediaAssetData` type but are not written by `saveMediaAsset` (`service.ts:292-303`), so they do not survive a reload unless re-probed (UNVERIFIED where they are re-derived).
- `loadMediaAsset` creates an object URL; an image with an empty MIME whose text starts with `<svg` is re-wrapped as `image/svg+xml` (`service.ts:346-362`).
- Audio elements' decoded `buffer` is stripped before saving (`service.ts:121-132`).
- `loadProject` normalises bookmarks (numbers become `{time}`) and rounds times to integer ticks (`service.ts:27-52,196-222`). Malformed entries (no metadata) are skipped with a console warning.
- Project list order: `updatedAt` descending (`service.ts:236-239,275-277`).
- `deleteProject` removes the project record; media is cleared separately by `deleteProjectMedia` (`service.ts:279-281,412-424`). The per-project media IndexedDB database itself is emptied, not deleted.
- Capacity check: `navigator.storage.estimate()`, minus a 50 MB reserve; if no estimate is available the write is allowed (`services/storage/quota.ts:5,45-126`).
- Persistence request: `navigator.storage.persist()` silently on non-Firefox; Firefox gets a dialog first; dismissal stored in `opencut-storage-persist-dismissed` (`services/storage/use-storage-persistence.ts`).
- Support check: `isFullySupported()` = IndexedDB and OPFS (`service.ts:530-540`); the provider that would toast about it is not mounted (2.D section 9).
- Clipboard is in-memory only. Undo history is in-memory only and is never persisted.
- NOT FOUND: project export/import file format, cloud sync, backup, cross-device transfer, storage usage UI, garbage collection of orphaned media.

localStorage keys:

| Key | Content | Source |
|---|---|---|
| `opencut-keybindings` (v7) | keybindings map, `isCustomized` | `actions/keybindings-store.ts:172` |
| `timeline-store` | `snappingEnabled`, `rippleEditingEnabled` | `timeline/timeline-store.ts:49-55` |
| `preview-settings` (v6) | `activeGuide`, `overlays`, `gridConfig` | `preview/preview-store.ts:49-103` |
| `panel-sizes` (v2) | resizable panel sizes | `editor/panel-store.ts:43-90` |
| `assets-panel` | media view mode and sort | `components/editor/panels/assets/assets-panel-store.tsx:108-121` |
| `projects-view-mode` | projects view mode, sort key, order | `app/projects/store.ts:124-129` |
| `stickers-settings` (v1) | selected category, recent stickers | `stickers/stickers-store.ts:205-236` |
| `graph-editor-presets` | custom easing presets | `timeline/components/graph-editor/custom-presets-store.ts:8` |
| `hasSeenOnboarding` | onboarding seen flag | `components/editor/onboarding.tsx:13-16` |
| `mobile-acknowledged` | mobile gate dismissed | `components/editor/mobile-gate.tsx:10` |
| `last-seen-version` | changelog notification | `changelog/components/changelog-notification.tsx` |
| `feedback-draft`, `feedback-history` | feedback text and last 20 sent | `feedback/components/feedback-popover.tsx:24-26` |
| `opencut-storage-persist-dismissed` | Firefox persistence dialog dismissed | `services/storage/use-storage-persistence.ts:5` |
| next-themes key | theme | `app/layout.tsx` |

#### Project versioning

- `TProject.version` is an integer; `CURRENT_PROJECT_VERSION = 31` (`services/storage/migrations/index.ts:36`).
- Version detection for legacy records: explicit `version` number; else 1 if a non-empty `scenes` array exists; else 0 (`migrations/runner.ts:127-143`).
- Runner: on first storage access (`ensureMigrations`, `service.ts:80-91`) and on project load (`core/managers/project-manager.ts:128-187`), every stored project is walked through the ordered chain until it reaches the target version, saving after each step. A transformer may return `skipped` (stops that project's chain). A progress callback drives the `MigrationDialog`, which stays visible at least 1,000 ms (`runner.ts:21,104-112`, `project/components/migration-dialog.tsx`).
- Policy for new migrations (`migrations/AGENTS.md`): additive only; never delete, rename or replace persisted data; old fields are kept for future down-migrations. Older transformers (v7, v11, v12, v13, v24, v25) do delete fields, so the policy applies from roughly v28 on.
- Transformers are pure functions in `migrations/transformers/vN-to-vM.ts` with frozen copies of era defaults; class wrappers in `migrations/vN-to-vM.ts`. Tests exist for 0→1, 1→2, 2→3, 3→4, 4→5, 5→6, 8→9, 15→16, 16→17, 18→19, 19→20, 20→21, 21→22, 22→23, 26→27, 27→28, 28→29, 29→30, 30→31.
- BUG? at HEAD: the runner's adapter calls are positional (headline finding 5).

#### Every migration

All under `apps/web/src/services/storage/migrations/transformers/`.

| Step | What it does | Evidence |
|---|---|---|
| v0→v1 | Adds a `scenes` array with one "Main scene" (`isMain`, empty tracks and bookmarks), sets `currentSceneId`, `version: 1` | `v0-to-v1.ts` |
| v1→v2 | Builds `metadata` and `settings` objects from flat project fields (defaults fps 30, canvas 1920×1080, background `#000000`, blur intensity 10); loads tracks from the legacy per-scene timeline DB; converts "media" tracks to video tracks and transforms text and audio tracks; applies legacy project bookmarks to the main scene; then deletes the legacy timeline DBs | `v1-to-v2.ts:4-8,128-160,268-546,589-622`, `../v1-to-v2.ts` |
| v2→v3 | Adds `metadata.duration` = max element end in the main scene | `v2-to-v3.ts` |
| v3→v4 | Normalises text `fontWeight` (`normal`→`"400"`, `bold`→`"700"`, numeric 100–900 kept). Detail of the fallback is UNVERIFIED | `v3-to-v4.ts:4-20` |
| v4→v5 | Migrates sticker elements to the provider-prefixed id scheme (known providers `icons`, `emoji`, `flags`, `shapes`). Exact mapping UNVERIFIED | `v4-to-v5.ts:4-9` |
| v5→v6 | Bookmarks: bare numbers become `{ time }` objects | `v5-to-v6.ts` |
| v6→v7 | Text `backgroundColor` → `background { color, cornerRadius 0, paddingX 8, paddingY 4, offsetX 0, offsetY 0 }` | `v6-to-v7.ts` |
| v7→v8 | Adds `sourceDuration = trimStart + duration + trimEnd` to video and audio elements | `v7-to-v8.ts` |
| v8→v9 | Adds `background.enabled` to text (true unless colour is `transparent`) | `v8-to-v9.ts` |
| v9→v10 | Version bump only | `v9-to-v10.ts` |
| v10→v11 | `transform.scale` → `scaleX` + `scaleY`; splits the `transform.scale` animation channel into two | `v10-to-v11.ts:66-113` |
| v11→v12 | Merges `transform.position.x`/`.y` channels into one vector channel `transform.position` (interpolating the missing axis at each key time) | `v11-to-v12.ts:66-143` |
| v12→v13 | Masks: moves `feather`, `inverted`, `stroke.color`, `stroke.width` into `mask.params` (`strokeColor` default `#ffffff`, `strokeWidth` 0) | `v12-to-v13.ts:77-102` |
| v13→v14 | Split mask: converts position-along-normal to an explicit x/y anchor | `v13-to-v14.ts:77-85` |
| v14→v15 | Stickers: backfills `intrinsicWidth`/`intrinsicHeight` = 200 | `v14-to-v15.ts:5,28-69` |
| v15→v16 | Renames `sticker` tracks to `graphic` tracks | `v15-to-v16.ts`, test |
| v16→v17 | Masks: backfills `strokeAlign: "center"` | `v16-to-v17.ts`, test |
| v17→v18 | Volume: linear gain → dB, clamped −60..+20; missing → 0 dB (video and audio) | `v17-to-v18.ts:5-6,30-113` |
| v18→v19 | Settings: adds `canvasSizeMode: "preset"`, `lastCustomCanvasSize: null` | `v18-to-v19.ts:26-46` |
| v19→v20 | Video: backfills `isSourceAudioEnabled: true` | `v19-to-v20.ts:71-87` |
| v20→v21 | Blur background intensity × 5 (legacy default 50 when missing) | `v20-to-v21.ts:5-6`, test |
| v21→v22 | Animations: legacy channels → bindings plus per-component channels; colour channels become linear-RGB r/g/b/a components; vectors split into components | `v21-to-v22.ts:5,175-435`, test |
| v22→v23 | All time values seconds → integer ticks (120,000/s): metadata duration, timeline view state, element timing, keyframes, curve handles, bookmarks; `fps` number → `FrameRate {numerator, denominator}` (standard rates matched within 0.01, otherwise denominator 1,000,000) | `v22-to-v23.ts:5-19,50-322`, test |
| v23→v24 | Scene `tracks` array → `{ overlay, main, audio }`; main is the video track flagged `isMain` or the first video track, or a new empty "Main"; removes `isMain` from tracks | `v23-to-v24.ts:48-122` |
| v24→v25 | Animations: `transform.position` vector2 binding → `transform.positionX` and `transform.positionY` number bindings | `v24-to-v25.ts:84-140` |
| v25→v26 | Repairs scenes whose tracks were corrupted by v24→v25 (flat array spread into a numeric-keyed object); rebuilds `{overlay, main, audio}` | `v25-to-v26.ts:48-120` |
| v26→v27 | Custom mask `path`: JSON string → typed point array | `v26-to-v27.ts:14-45,139`, test |
| v27→v28 | Rounds every persisted media-time float back to integer ticks | `v27-to-v28.ts:203-223`, test |
| v28→v29 | Copies built-in element fields (transform, opacity, blend mode, volume, text fields) into `params` without deleting the sources | `v28-to-v29.ts:78-207`, test |
| v29→v30 | Flattens animation `bindings` + `channels` into a map keyed by property path | `v29-to-v30.ts:89-135`, test |
| v30→v31 | Renames mask type `custom` → `freeform` (params unchanged) | `v30-to-v31.ts:89-95`, test |

### 2.G Backend: API routes, DB schema, auth, env

#### Routes (`apps/web/src/app/api`)

| Method | Path | Behaviour | Source |
|---|---|---|---|
| GET, POST | `/api/auth/[...all]` | better-auth handler (`toNextJsHandler(auth)`) | `app/api/auth/[...all]/route.ts` |
| POST | `/api/feedback` | rate limited (429); body `{ message }` 1–5000 chars (400 with field errors); inserts into `feedback`; 201 `{ entry: { id, message, createdAt } }`; anonymous | `app/api/feedback/route.ts`, `feedback/queries.ts`, `feedback/types.ts:1` |
| GET | `/api/health` | `200 "OK"` | `app/api/health/route.ts` |
| GET | `/api/sounds/search` | Freesound proxy; params and filters in 2.C.11; rate limited | `app/api/sounds/search/route.ts` |
| GET | `/rss.xml` | RSS from blog posts | `app/rss.xml/route.ts` |

There are no project, media, user-data or render routes. Editing, storage and export are entirely client-side.

#### Rate limiting

Upstash sliding window, 100 requests per minute, keyed by `x-forwarded-for` (falls back to `"anonymous"`), prefix `rate-limit`, analytics on (`auth/rate-limit.ts`). Used by feedback and sounds search. better-auth has its own rate limit stored in the same Redis (`auth/server.ts:26-37`).

#### Auth

- Server: better-auth with the drizzle adapter (`provider: "pg"`, `usePlural: true`), `emailAndPassword.enabled: true`, `user.deleteUser.enabled: true`, `appName: "OpenCut"`, `trustedOrigins: [NEXT_PUBLIC_SITE_URL]` (`auth/server.ts`).
- Client: `signIn`, `signUp`, `useSession` exported and **never imported** (`auth/client.ts`). No login, signup or account pages. The schema comment says "we don't have any auth flows currently" (`db/schema.ts:6-7`). The privacy page states there are no accounts.
- Verdict: auth is infrastructure only. PARTIAL (server wired, no product feature uses it).

#### DB schema (`apps/web/src/db/schema.ts`, PostgreSQL)

| Table | Columns | RLS |
|---|---|---|
| `users` | `id` text PK; `name` text not null; `email` text not null unique; `email_verified` boolean not null default false; `image` text; `created_at`, `updated_at` timestamp not null | enabled |
| `sessions` | `id` text PK; `expires_at` timestamp not null; `token` text not null unique; `created_at`, `updated_at` not null; `ip_address`, `user_agent` text; `user_id` text not null → `users.id` on delete cascade | enabled |
| `accounts` | `id` text PK; `account_id`, `provider_id` text not null; `user_id` → `users.id` cascade; `access_token`, `refresh_token`, `id_token` text; `access_token_expires_at`, `refresh_token_expires_at` timestamp; `scope`, `password` text; `created_at`, `updated_at` not null | enabled |
| `verifications` | `id` text PK; `identifier`, `value` text not null; `expires_at` not null; `created_at`, `updated_at` | enabled |
| `feedback` | `id` text PK; `message` text not null; `created_at` timestamp not null | not enabled |

Drift: the only SQL migration, `apps/web/migrations/0000_brainy_saracen.sql`, creates `accounts`, `sessions`, `users`, `verifications` and a `waitlist` table (`id`, `email` unique, `created_at`), and has no `feedback` table. `drizzle.config.ts` points at a schema path that no longer exists. A deployment would need `db:push` or a regenerated migration.

#### Environment variables (`apps/web/src/env/web.ts`, `.env.example`, `turbo.json`)

| Variable | Use |
|---|---|
| `NODE_ENV` | development / production / test |
| `NEXT_PUBLIC_SITE_URL` | site URL, auth base URL (default `http://localhost:3000`) |
| `NEXT_PUBLIC_MARBLE_API_URL` | Marble CMS API (blog) |
| `MARBLE_WORKSPACE_KEY` | Marble workspace key |
| `DATABASE_URL` | Postgres (`postgres://` or `postgresql://`) |
| `BETTER_AUTH_SECRET` | better-auth secret |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST (local: serverless-redis-http on :8079, token `example_token`) |
| `FREESOUND_CLIENT_ID`, `FREESOUND_API_KEY` | Freesound API (only the API key is used as `token`) |
| `ANALYZE`, `NEXT_RUNTIME` | optional |

All are validated by zod at import of `env/web.ts`; the app will not boot without them, even though the editor itself needs none of them.

### 2.H Cross-cutting: what is absent, partial or stubbed

Consolidated register (details and citations are in the sections named).

| Item | Status | Where |
|---|---|---|
| Transitions | STUB tab "coming soon"; no model, no renderer | 2.D §4 |
| Adjustment / colour correction / filters / LUT | STUB tab; nothing else | 2.D §4, 2.B §18 |
| Effects other than Blur | NOT FOUND | 2.B §18, 2.C §4 |
| Audio fades, crossfades, audio effects, pan, per-track volume | NOT FOUND | 2.C §7 |
| Track lock, track reorder, track rename, manual add-track button | NOT FOUND | 2.A §1–2 |
| Cut (clipboard) | NOT FOUND | 2.A §9 |
| Loop playback, playback rate / shuttle | NOT FOUND | 2.A §13 |
| Freeze frame | STUB (disabled toolbar button) | 2.A §16 |
| Replace media (drop onto clip, context menu) | STUB | 2.A §10 |
| Speed ramps, reverse, speed presets | NOT FOUND; retime split helpers are identity stubs | 2.C §10 |
| Multiple masks per element | PARTIAL (one mask; only `masks[0]` rendered) | 2.B §12, 2.C §3 |
| Freeform mask bezier tangents | PARTIAL (data only, no handles) | 2.B §12 |
| Layout guides (grid, TikTok, Reels, Shorts, Spotlight, custom) | PARTIAL: grid and TikTok implemented; other platforms and custom are stubs; picker unreachable | 2.B §7 |
| Sticker "Logos" provider | STUB | 2.B §14 |
| Font picker tabs (My fonts, Favorites) | STUB | 2.B §16 |
| Font picker for text elements | PARTIAL (plain text input; picker only in text mask) | 2.D §5 |
| Colour picker "Saved" colours | STUB | 2.B §20 |
| Scenes: create, rename | PARTIAL (commands exist, no UI) | 2.A §20 |
| Songs search (Freesound) | STUB (501) | 2.C §11 |
| Transcription model picker, cancel, progress | PARTIAL | 2.C §12 |
| Export resolution/fps/range/bitrate, GIF, audio-only | NOT FOUND | 2.C §6 |
| GPU-less fallback renderer | PARTIAL (banner only, no Canvas2D compositor) | 2.C §4 |
| Media: folders, search, rename, "Export clips" | NOT FOUND / STUB menu item | 2.D §4 |
| Properties multi-edit | PARTIAL (count text only) | 2.D §5 |
| Delete-project "type DELETE" confirm | STUB (input not checked) | 2.D §1 |
| Editor header rename/delete dialogs | PARTIAL (mounted, never opened) | 2.D §3 |
| Keybinding import/export, binding unbound actions | PARTIAL | 2.E |
| Auth / accounts | PARTIAL (server only) | 2.G |
| i18n | NOT FOUND (English only; transcription languages are data, not UI locale) | 2.D §10 |
| AI | only on-device Whisper captions; no generative features | 2.C §12, 2.D §10 |
| Desktop app | STUB window | 1.4 |
| Undo history limit / persistence | NOT FOUND (unbounded, in-memory) | 2.A §22 |
| Render-perf summaries in normal playback | PARTIAL | 2.C §13 |

---

## 3. Data model (verbatim, trimmed)

### 3.1 Project (`apps/web/src/project/types.ts`)

```ts
export type TBackground =
	| { type: "color"; color: string }
	| { type: "blur"; blurIntensity: number };

export interface TCanvasSize { width: number; height: number }

export interface TProjectMetadata {
	id: string;
	name: string;
	thumbnail?: string;
	duration: MediaTime;
	createdAt: Date;
	updatedAt: Date;
}

export interface TProjectSettings {
	fps: FrameRate;                       // { numerator, denominator } from opencut-wasm
	canvasSize: TCanvasSize;
	canvasSizeMode?: "preset" | "custom";
	lastCustomCanvasSize?: TCanvasSize | null;
	originalCanvasSize?: TCanvasSize | null;
	background: TBackground;
}

export interface TTimelineViewState {
	zoomLevel: number;
	scrollLeft: number;
	playheadTime: MediaTime;
}

export interface TProject {
	metadata: TProjectMetadata;
	scenes: TScene[];
	currentSceneId: string;
	settings: TProjectSettings;
	version: number;
	timelineViewState?: TTimelineViewState;
}

export type TProjectSortKey = "createdAt" | "updatedAt" | "name" | "duration";
export type TSortOrder = "asc" | "desc";
```

`background.color` may hold a CSS gradient string (2.B §17, 2.C §3). Serialized form swaps `Date` for ISO strings (`services/storage/types.ts:31-48`).

### 3.2 Time (`apps/web/src/wasm/media-time.ts`, `rust/crates/time`)

```ts
/** Integer-tick time. Mirrors `MediaTime(i64)` in rust/crates/time/src/media_time.rs. */
export type MediaTime = number & { readonly __mediaTime: unique symbol };
export const TICKS_PER_SECOND = _TICKS_PER_SECOND();   // 120_000
// constructors: mediaTime({ticks}) (must be integer), roundMediaTime({time}) (half away from zero),
// mediaTimeFromSeconds({seconds}); ZERO_MEDIA_TIME
```

### 3.3 Scene, tracks, elements (`apps/web/src/timeline/types.ts`)

```ts
export type ElementRef = { trackId: string; elementId: string };

export interface Bookmark {
	time: MediaTime;
	note?: string;
	color?: string;
	duration?: MediaTime;
}

export interface TScene {
	id: string;
	name: string;
	isMain: boolean;
	tracks: SceneTracks;
	bookmarks: Bookmark[];
	createdAt: Date;
	updatedAt: Date;
}

export type TrackType = "video" | "text" | "audio" | "graphic" | "effect";

interface BaseTrack { id: string; name: string }

export interface VideoTrack extends BaseTrack {
	type: "video";
	elements: (VideoElement | ImageElement)[];
	muted: boolean;
	hidden: boolean;
}
export interface TextTrack extends BaseTrack { type: "text"; elements: TextElement[]; hidden: boolean }
export interface AudioTrack extends BaseTrack { type: "audio"; elements: AudioElement[]; muted: boolean }
export interface GraphicTrack extends BaseTrack {
	type: "graphic";
	elements: (StickerElement | GraphicElement)[];
	hidden: boolean;
}
export interface EffectTrack extends BaseTrack { type: "effect"; elements: EffectElement[]; hidden: boolean }

export type TimelineTrack = VideoTrack | TextTrack | AudioTrack | GraphicTrack | EffectTrack;
export type OverlayTrack = VideoTrack | TextTrack | GraphicTrack | EffectTrack;

export interface SceneTracks {
	overlay: OverlayTrack[];
	main: VideoTrack;
	audio: AudioTrack[];
}

export interface RetimeConfig {
	rate: number;
	maintainPitch?: boolean;
}

interface BaseTimelineElement {
	id: string;
	name: string;
	duration: MediaTime;
	startTime: MediaTime;
	trimStart: MediaTime;
	trimEnd: MediaTime;
	sourceDuration?: MediaTime;
	animations?: ElementAnimations;
	params: ParamValues;
}

interface BaseAudioElement extends BaseTimelineElement {
	type: "audio";
	buffer?: AudioBuffer;          // runtime only, stripped on save
	retime?: RetimeConfig;
}
export interface UploadAudioElement extends BaseAudioElement { sourceType: "upload"; mediaId: string }
export interface LibraryAudioElement extends BaseAudioElement { sourceType: "library"; sourceUrl: string }
export type AudioElement = UploadAudioElement | LibraryAudioElement;

export interface VideoElement extends BaseTimelineElement {
	type: "video";
	mediaId: string;
	isSourceAudioEnabled?: boolean;
	hidden?: boolean;
	retime?: RetimeConfig;
	effects?: Effect[];
	masks?: Mask[];
}
export interface ImageElement extends BaseTimelineElement {
	type: "image";
	mediaId: string;
	hidden?: boolean;
	effects?: Effect[];
	masks?: Mask[];
}
export interface TextElement extends BaseTimelineElement {
	type: "text";
	hidden?: boolean;
	effects?: Effect[];
}
export interface StickerElement extends BaseTimelineElement {
	type: "sticker";
	stickerId: string;             // "provider:value"
	intrinsicWidth?: number;
	intrinsicHeight?: number;
	hidden?: boolean;
	effects?: Effect[];
}
export interface GraphicElement extends BaseTimelineElement {
	type: "graphic";
	definitionId: string;
	hidden?: boolean;
	effects?: Effect[];
	masks?: Mask[];
}
export interface EffectElement extends BaseTimelineElement {
	type: "effect";
	effectType: string;
}

export type TimelineElement =
	| AudioElement | VideoElement | ImageElement | TextElement
	| StickerElement | GraphicElement | EffectElement;

export const MASKABLE_ELEMENT_TYPES = elementTypes("video", "image", "graphic");
export const RETIMABLE_ELEMENT_TYPES = elementTypes("video", "audio");
export const VISUAL_ELEMENT_TYPES = elementTypes("video", "image", "text", "sticker", "graphic");

export type ElementUpdatePatch = { params?: Partial<ParamValues> };
```

All per-element properties (transform, opacity, blend mode, volume, muted, text styling) live in the flat `params` map with dotted keys. Since migration v28→v29 the legacy top-level fields may still be present in stored data but `params` is authoritative.

### 3.4 Params (`apps/web/src/params/index.ts`, `apps/web/src/params/registry.ts`)

```ts
export type ParamValue = number | string | boolean;
export type ParamValues = Record<string, ParamValue>;
export type ParamGroup = "stroke";

interface BaseParamDefinition<TKey extends string = string> {
	key: TKey;
	label: string;
	group?: ParamGroup;
	keyframable?: boolean;
	dependencies?: Array<{ param: string; equals: ParamValue }>;
}
export interface NumberParamDefinition<TKey extends string = string> extends BaseParamDefinition<TKey> {
	type: "number";
	default: number;
	min: number;
	max?: number;
	step: number;
	displayMultiplier?: number;   // display = stored * displayMultiplier
	unit?: "percent";
	shortLabel?: string;
}
export interface BooleanParamDefinition ... { type: "boolean"; default: boolean }
export interface ColorParamDefinition   ... { type: "color";   default: string }
export interface SelectParamDefinition  ... { type: "select";  default: string; options: Array<{ value: string; label: string }> }
export interface TextParamDefinition    ... { type: "text";    default: string }
export interface FontParamDefinition    ... { type: "font";    default: string }

export interface LinearRgba { r: number; g: number; b: number; a: number }
```

Element param keys and defaults (`params/registry.ts:96-352`, `timeline/defaults.ts`):

- Visual (video, image, text, sticker, graphic): `transform.positionX` 0, `transform.positionY` 0, `transform.scaleX` 1, `transform.scaleY` 1, `transform.rotate` 0 (−360..360), `opacity` 1 (0..1), `blendMode` `"normal"`.
- Audio (video, audio): `volume` 0 dB (−60..20), `muted` false.
- Text: `content` "Default text", `fontFamily` "Arial", `fontSize` 15, `color` "#ffffff", `textAlign` "center", `fontWeight` "normal", `fontStyle` "normal", `textDecoration` "none", `letterSpacing` 0, `lineHeight` 1.2, `background.enabled` false, `background.color` "#000000", `background.cornerRadius` 0, `background.paddingX` 30, `background.paddingY` 42, `background.offsetX` 0, `background.offsetY` 0.
- Graphic: per-definition params (2.B §13). Effect element: none in the registry; effect params live on the effect definition.

```ts
// apps/web/src/rendering/index.ts
export interface Transform {
	scaleX: number;
	scaleY: number;
	position: { x: number; y: number };
	rotate: number;
}
export type BlendMode =
	| "normal" | "darken" | "multiply" | "color-burn" | "lighten" | "screen"
	| "plus-lighter" | "color-dodge" | "overlay" | "soft-light" | "hard-light"
	| "difference" | "exclusion" | "hue" | "saturation" | "color" | "luminosity";
```

### 3.5 Animation and keyframes (`apps/web/src/animation/types.ts`)

```ts
export const ANIMATION_PROPERTY_PATHS = [
	"transform.positionX", "transform.positionY",
	"transform.scaleX", "transform.scaleY", "transform.rotate",
	"opacity", "volume", "color",
	"background.color", "background.paddingX", "background.paddingY",
	"background.offsetX", "background.offsetY", "background.cornerRadius",
] as const;

export type GraphicParamPath = `params.${string}`;
export type EffectParamPath = `effects.${string}.params.${string}`;
export type AnimationPath = string;

export const ANIMATION_PROPERTY_GROUPS = {
	"transform.scale": ["transform.scaleX", "transform.scaleY"],
} as const;

export type ContinuousKeyframeInterpolation = "linear" | "hold" | "bezier";
export type DiscreteKeyframeInterpolation = "hold";
export type ScalarSegmentType = "step" | "linear" | "bezier";
export type TangentMode = "auto" | "aligned" | "broken" | "flat";
export type ChannelExtrapolationMode = "hold" | "linear";

export interface CurveHandle { dt: MediaTime; dv: number }

interface BaseAnimationKeyframe<TValue extends ParamValue> {
	id: string;
	time: MediaTime;               // relative to element start time
	value: TValue;
}
export interface ScalarAnimationKey extends BaseAnimationKeyframe<number> {
	leftHandle?: CurveHandle;
	rightHandle?: CurveHandle;
	segmentToNext: ScalarSegmentType;
	tangentMode: TangentMode;
}
export type DiscreteAnimationKey = BaseAnimationKeyframe<DiscreteValue>;   // boolean | string

export interface ScalarChannel {
	keys: ScalarAnimationKey[];
	extrapolation?: { before: ChannelExtrapolationMode; after: ChannelExtrapolationMode };
}
export interface DiscreteChannel { keys: DiscreteAnimationKey[] }

export type CompositeChannelData = Record<string, AnimationChannel | undefined>;  // e.g. colour: r,g,b,a
export type ChannelData = AnimationChannel | CompositeChannelData;

export interface ElementAnimations {
	[propertyPath: AnimationPath]: ChannelData | undefined;
}

export type NormalizedCubicBezier = [number, number, number, number];

export interface SelectedKeyframeRef {
	trackId: string;
	elementId: string;
	propertyPath: AnimationPath;
	keyframeId: string;
}
```

Colours animate as a composite channel of linear-RGB components with shared easing and serialise back to hex / hex8 (`params/index.ts:57-173`).

### 3.6 Effects (`apps/web/src/effects/types.ts`)

```ts
export interface Effect {
	id: string;
	type: string;
	params: ParamValues;
	enabled: boolean;
}
export type EffectUniformValue = number | number[];
export interface EffectPass { shader: string; uniforms: Record<string, EffectUniformValue> }
export interface EffectPassTemplate {
	shader: string;
	uniforms(params: { effectParams: ParamValues; width: number; height: number }): Record<string, EffectUniformValue>;
}
export interface EffectRendererConfig {
	passes: EffectPassTemplate[];
	buildPasses?: (params: { effectParams: ParamValues; width: number; height: number }) => EffectPass[];
}
export interface EffectDefinition {
	type: string;
	name: string;
	keywords: string[];
	params: ParamDefinition[];
	renderer: EffectRendererConfig;
}
```

### 3.7 Masks (`apps/web/src/masks/types.ts`, `apps/web/src/masks/freeform/path.ts`)

```ts
export type BuiltinMaskType =
	| "split" | "cinematic-bars" | "rectangle" | "ellipse"
	| "heart" | "diamond" | "star" | "text";
export type MaskType = BuiltinMaskType | "freeform";

export interface BaseMaskParams {
	feather: number;
	inverted: boolean;
	strokeColor: string;
	strokeWidth: number;
	strokeAlign: "inside" | "center" | "outside";
}
export interface SplitMaskParams extends BaseMaskParams { centerX: number; centerY: number; rotation: number }
export interface RectangleMaskParams extends BaseMaskParams {
	centerX: number; centerY: number; width: number; height: number; rotation: number; scale: number;
}
export interface TextMaskParams extends BaseMaskParams {
	content: string; fontSize: number; fontFamily: string;
	fontWeight: TextFontWeight; fontStyle: TextFontStyle; textDecoration: TextDecoration;
	letterSpacing: number; lineHeight: number;
	centerX: number; centerY: number; rotation: number; scale: number;
}
export interface FreeformPathMaskParams extends BaseMaskParams {
	path: FreeformPathPoint[];
	closed: boolean;
	centerX: number; centerY: number; rotation: number; scale: number;
}
export interface FreeformPathPoint {
	id: string; x: number; y: number; inX: number; inY: number; outX: number; outY: number;
}

// each mask: { id: string; type: <MaskType>; params: <matching params> }
// cinematic-bars, rectangle, ellipse, heart, diamond, star all use RectangleMaskParams
export type Mask = BuiltinShapeMask | FreeformPathMask;

export interface MaskFeatures {
	hasPosition: boolean;
	hasRotation: boolean;
	sizeMode: "none" | "uniform" | "width-height" | "height-only" | "width-only";
}
```

### 3.8 Media asset (`apps/web/src/services/storage/types.ts`, `apps/web/src/media/types.ts`)

```ts
export type MediaType = "image" | "video" | "audio";

export interface MediaAssetData {
	id: string;
	name: string;
	type: MediaType;
	size: number;
	lastModified: number;
	width?: number;
	height?: number;
	duration?: number;          // seconds
	fps?: number;
	hasAudio?: boolean;
	ephemeral?: boolean;
	thumbnailUrl?: string;      // JPEG data URL
}

export interface MediaAsset extends Omit<MediaAssetData, "size" | "lastModified"> {
	file: File;
	url?: string;               // object URL
}
```

### 3.9 Other domain types

```ts
// text (apps/web/src/text/primitives.ts, background.ts)
export type TextAlign = "left" | "center" | "right";
export type TextFontWeight = "normal" | "bold";
export type TextFontStyle = "normal" | "italic";
export type TextDecoration = "none" | "underline" | "line-through";
export interface TextBackground {
	enabled: boolean; color: string;
	cornerRadius?: number; paddingX?: number; paddingY?: number; offsetX?: number; offsetY?: number;
}

// graphics (apps/web/src/graphics/types.ts)
export const DEFAULT_GRAPHIC_SOURCE_SIZE = 512;
export interface GraphicDefinition {
	id: string; name: string; keywords: string[]; params: ParamDefinition[];
	render(context: GraphicRenderContext): void;
}

// stickers (apps/web/src/stickers/types.ts)
export interface StickerItem { id: string; provider: string; name: string; previewUrl: string; metadata: Record<string, unknown> }
export interface StickerProvider { id: string; search(...): Promise<StickerSearchResult>; browse(...): Promise<StickerBrowseResult>; resolveUrl(...): string }

// sounds (apps/web/src/sounds/types.ts)
export interface SavedSound {
	id: number; name: string; username: string; previewUrl?: string; downloadUrl?: string;
	duration: number; tags: string[]; license: string; savedAt: string;
}

// captions (apps/web/src/transcription/types.ts)
export interface CaptionChunk { text: string; startTime: number; duration: number }
export type TranscriptionModelId = "whisper-tiny" | "whisper-small" | "whisper-medium" | "whisper-large-v3-turbo";

// export (apps/web/src/export/index.ts)
export const EXPORT_QUALITY_VALUES = ["low", "medium", "high", "very_high"] as const;
export const EXPORT_FORMAT_VALUES = ["mp4", "webm"] as const;
export interface ExportOptions { format: ExportFormat; quality: ExportQuality; fps?: FrameRate; includeAudio?: boolean }
export interface ExportResult { success: boolean; buffer?: ArrayBuffer; error?: string; cancelled?: boolean }

// selection (apps/web/src/selection/editor-selection.ts)
export interface EditorSelectionSnapshot {
	selectedElements: ElementRef[];
	selectedKeyframes: SelectedKeyframeRef[];
	keyframeSelectionAnchor: SelectedKeyframeRef | null;
	selectedMaskPoints: SelectedMaskPointSelection | null;   // { trackId, elementId, maskId, pointIds }
}

// clipboard (apps/web/src/clipboard/types.ts)
export interface ElementsClipboardEntry { type: "elements"; items: { trackId; trackType; element: CreateTimelineElement }[] }
export interface KeyframesClipboardEntry { type: "keyframes"; sourceElement: ElementRef; items: KeyframeClipboardItem[] }
```

---

## 4. Rendering and export pipeline; actions and commands architecture

The full pipeline narrative with citations is at the end of section 2.C ("Pipeline narrative") and in 2.C §2–§8. Summary of the split:

| Stage | Language | Where |
|---|---|---|
| Project/scene state, animation resolve, placement, ripple | TypeScript | `core/managers`, `animation`, `timeline`, `ripple` |
| Scene tree build (`buildScene`), per-frame resolve | TypeScript | `services/renderer/scene-builder.ts`, `resolve.ts` |
| Video decode (WebCodecs through mediabunny `CanvasSink`), frame cache | TypeScript | `services/video-cache/service.ts` |
| Text, mask shape, graphic, gradient rasterisation | TypeScript, Canvas2D | `text`, `masks`, `graphics`, `gradients` |
| Frame descriptor (layers, transforms, blend, effect passes, mask refs) | TypeScript → JSON | `services/renderer/compositor/frame-descriptor.ts` |
| Texture upload, compositing, blend modes, Gaussian blur, JFA mask feather, present | Rust/wasm (wgpu, WGSL) | `rust/crates/{gpu,compositor,effects,masks}`, `rust/wasm` |
| Integer time, frame snapping, timecode | Rust/wasm | `rust/crates/time` |
| Encode and mux (H.264+AAC MP4, VP9+Opus WebM) | TypeScript, mediabunny on WebCodecs | `services/renderer/scene-exporter.ts` |
| Audio mixdown, limiter, live scheduling, pitch-preserving retime | TypeScript, Web Audio, soundtouchjs | `media/audio.ts`, `media/audio-mastering.ts`, `core/managers/audio-manager.ts`, `retime/audio-stretch.ts` |
| Transcription | TypeScript worker, transformers.js (ONNX) | `services/transcription` |

Export in one paragraph: `RendererManager.exportProject` mixes the timeline audio to a stereo 44.1 kHz buffer (with a limiter if the peak exceeds 0.98), builds a full-resolution scene, then `SceneExporter` renders frame by frame through the same wasm compositor and feeds its canvas to a mediabunny `CanvasSource`; the result is muxed into an in-memory buffer and downloaded as `{projectName}.mp4|.webm`. Resolution is the project canvas, fps is the project fps, quality maps to mediabunny bitrate presets, cancel is polled every 100 ms.

### Actions (trigger layer)

- `ACTIONS` in `actions/definitions.ts` is the single catalogue (id, description, category, optional args). Types derive from it (`actions/types.ts`).
- `invokeAction(action, args?, trigger?)` dispatches to every handler registered with `bindAction` (`actions/registry.ts`). `useActionHandler(action, handler, isActive)` binds for a component's lifetime (`actions/use-action-handler.ts`). `useEditorActions` registers all editor handlers once (`actions/use-editor-actions.ts`).
- Keyboard: `useKeybindingsListener` maps a key string to an action and calls `invokeAction(..., "keypress")`. Buttons and menus call `invokeAction(..., "mouseclick")`. Convention from `docs/actions.md`: UI goes through actions, not `editor.*`, when an action exists.

### Commands (mutation and undo layer)

- `Command` (`commands/base-command.ts`): `execute(): CommandResult | undefined`, `undo()` (default throws), `redo()` (default re-executes). A `CommandResult` may carry a selection patch.
- `BatchCommand` runs children in order and undoes in reverse (`commands/batch-command.ts`).
- `CommandManager` (`core/managers/commands.ts`): `execute` (run, apply ripple if enabled, apply selection override, run reactors, push to history, clear redo), `push` (record an already-applied change), `undo`, `redo`, `canUndo`, `canRedo`, `clear`, `registerReactor`. History and redo stack are unbounded in-memory arrays.
- Ripple is implemented generically in the manager: diff tracks before and after each command and shift later elements on the same track (`ripple/diff.ts`, `ripple/apply.ts`).
- Reactor registered by `EditorCore`: remove empty overlay and audio tracks after every command.
- Most timeline commands snapshot `SceneTracks` at execute and restore on undo. Interactive gestures use a render-only preview overlay (`timeline-manager.previewElements` → `commitPreview` / `discardPreview`), so one drag is one undo step.
- Command inventory (`apps/web/src/commands`): media `add-media-asset`, `remove-media-asset`; project `update-project-settings`; scene `create-scene`, `delete-scene`, `rename-scene`, `toggle-bookmark`, `update-bookmark`, `move-bookmark`, `remove-bookmark`; timeline clipboard `paste`, `paste-keyframes`; element `insert-element`, `delete-elements`, `duplicate-elements`, `move-elements`, `split-elements`, `update-elements`, `toggle-source-audio-separation`; effects `add-effect`, `remove-effect`, `reorder-effect`, `toggle-effect`, `update-effect-params`; keyframes `upsert-keyframe`, `remove-keyframe`, `retime-keyframe`, `update-scalar-keyframe-curve`, `upsert-effect-param-keyframe`, `remove-effect-param-keyframe`; masks `remove-mask`, `toggle-mask-inverted`, `insert-custom-mask-point`, `delete-custom-mask-points`; track `add-track`, `remove-track`, `toggle-track-mute`, `toggle-track-visibility`; plus `tracks-snapshot` and the unused `preview-tracker`.

---

## 5. Verdict for each changelog-derived line of `opencut-inventory.md`

The classic repo carries the same changelog (`apps/web/src/changelog/entries/0.1.0.md`, `0.2.0.md`, `0.3.0.md`; 0.3.0 is byte-identical to the rewrite's copy apart from a trailing newline) plus an unpublished draft `0.4.0.md`. Paths below are under `apps/web/src/` unless they start with `rust/` or `apps/`.

| Id | Claim | Verdict | Evidence |
|---|---|---|---|
| C-01 | Number inputs accept math expressions | VERIFIED | `utils/math.ts:101-116`, `components/editor/panels/properties/hooks/use-property-draft.ts:58` |
| C-02 | Click-drag scrubbing on number inputs | VERIFIED | `components/ui/number-field.tsx:167-204` |
| C-03 | Transform section (position, scale, rotation) | VERIFIED | `components/editor/panels/properties/registry.tsx:223-354`, `params/registry.ts:96-137` |
| C-04 | Blending section | VERIFIED | `params/registry.ts:139-155` |
| C-05 | Typography section | VERIFIED (font family is a plain text input: PARTIAL) | `params/registry.ts:176-262`, `components/editor/panels/properties/components/property-param-field.tsx:149-157` |
| C-06 | Spacing section | VERIFIED (letter spacing, line height) | `params/registry.ts:247-262` |
| C-07 | Background section for text | VERIFIED | `params/registry.ts:263-327` |
| C-08 | Tabbed properties layout | VERIFIED | `components/editor/panels/properties/index.tsx:56-60` |
| C-09 | Separate width and height scale | VERIFIED | `params/registry.ts:114-128`, `preview/controllers/transform-handle-controller.ts:640-734` |
| C-10 | Colour picker eyedropper | VERIFIED (only where `window.EyeDropper` exists) | `components/ui/color-picker.tsx:154-166` |
| C-11 | Colour picker opacity | VERIFIED | `components/ui/color-picker.tsx:320-370` |
| C-12 | Multiple colour formats | VERIFIED (HEX, RGB, HSL, HSV) | `utils/color.ts:3`, `components/ui/color-picker.tsx:215-241` |
| C-13 | Bookmark notes | VERIFIED | `timeline/bookmarks/components/bookmarks.tsx:315-441` |
| C-14 | Bookmark colour labels | VERIFIED | same |
| C-15 | Bookmark optional duration | VERIFIED | same |
| C-16 | Move elements in preview | VERIFIED | `preview/controllers/preview-interaction-controller.ts:478-526` |
| C-17 | Scale elements in preview | VERIFIED | `preview/controllers/transform-handle-controller.ts:580-734` |
| C-18 | Rotate in preview, rotation handle at fixed gap | VERIFIED for the handle and 24 px offset; "clipped to the preview area" UNVERIFIED | `preview/element-bounds.ts:201`, `transform-handle-controller.ts:736-770` |
| C-19 | Dashed selection outline | UNVERIFIED. An outline primitive with an optional `dashed` flag exists; only mask overlays were seen passing it | `preview/components/handle-primitives.tsx:208-250`, `preview/components/mask-handles.tsx:147` |
| C-20 | Snap guides including centre snap | VERIFIED (canvas centre and edges only; no element-to-element snap) | `preview/preview-snap.ts:82-181`, `preview/components/snap-guides.tsx` |
| C-21 | Shift disables snapping | VERIFIED | `hooks/use-shift-key.ts`, `transform-handle-controller.ts:546,601,680,751` |
| C-22 | Preview zoom | VERIFIED | `preview/zoom.ts`, `preview/components/preview-viewport.tsx:167-339` |
| C-23 | Preview pan when zoomed | VERIFIED | `preview/components/preview-viewport.tsx:395-464` |
| C-24 | Mask handles in preview | VERIFIED | `masks/handle-positions.ts`, `masks/use-mask-handles.ts`, `preview/components/mask-handles.tsx` |
| C-25 | Notice when GPU rendering unsupported | VERIFIED | `app/editor/[project_id]/page.tsx:60-79` |
| C-26 | Blend modes | VERIFIED: 17 modes, on every visual element (not text only) | `params/registry.ts:76-94`, `rust/crates/compositor/src/blend_mode.rs:5-46` |
| C-27 | Paste image/video/audio from clipboard | VERIFIED | `media/use-paste-media.ts:42-110` |
| C-28 | Asset grid with thumbnails | VERIFIED | `components/editor/panels/assets/views/assets.tsx:356-506` |
| C-29 | Multi-select assets and bulk delete | VERIFIED | `assets.tsx:134-137,219-231,319-336` |
| C-30 | Asset panel tabs share a layout | VERIFIED | `components/editor/panels/assets/views/base-panel.tsx`, `tabbar.tsx` |
| C-31 | 1,000+ Google fonts | VERIFIED as data and picker (1,920 families); PARTIAL in use: the picker is wired only to the text mask | `public/fonts/font-atlas.json`, `components/ui/font-picker.tsx`, `masks/components/masks-tab.tsx:698` |
| C-32 | System fonts in the picker | VERIFIED (a hard-coded list of nine names, no Local Font Access) | `fonts/system-fonts.ts:1-11` |
| C-33 | Multi-line text | VERIFIED (manual line breaks only) | `text/primitives.ts:116`, `preview/components/text-edit-overlay.tsx` |
| C-34 | Line height | VERIFIED | `params/registry.ts:255-262` |
| C-35 | Letter spacing | VERIFIED | `params/registry.ts:247-254` |
| C-36 | Text background optional, off by default | VERIFIED | `timeline/defaults.ts:21-29` |
| C-37 | Dark theme | VERIFIED | `app/globals.css`, `components/theme-toggle.tsx` |
| C-38 | Undo/redo incl. drag-and-drop additions | VERIFIED | `core/managers/commands.ts`, `timeline/controllers/drag-drop-controller.ts:328-343` |
| C-39 | Clip drop + auto-created track is one undo step | VERIFIED | `drag-drop-controller.ts:328-343` |
| C-40 | Undo of trim-from-start restores position and length | VERIFIED by design (snapshot undo); not executed | `timeline/controllers/resize-controller.ts:348-362`, `commands/timeline/tracks-snapshot.ts` |
| C-41 | Keyframe animation of element properties | VERIFIED | `animation/types.ts:4-19`, `commands/timeline/element/keyframes/*` |
| C-42 | Independent position X and Y | VERIFIED | `animation/types.ts:5-6`, migration v24→v25 |
| C-43 | Copy/paste keyframes between elements | VERIFIED with BUG? (paste time not element-relative) | `clipboard/handlers/keyframes.ts`, `commands/timeline/clipboard/paste-keyframes.ts:41-47` |
| C-44 | Graph editor with bezier handles | VERIFIED as a per-segment easing editor (not a full value/time curve editor) | `timeline/components/graph-editor/*` |
| C-45 | "Expand keyframes" per-property lanes | VERIFIED | `timeline/components/timeline-element.tsx:425-508`, `timeline/components/expanded-layout.ts` |
| C-46 | Per-clip effects | VERIFIED | `commands/timeline/element/effects/*`, `effects/components/effects-tab.tsx` |
| C-47 | Standalone effect elements | VERIFIED | `effects/components/assets-view.tsx:59-70`, `services/renderer/compositor/frame-descriptor.ts:123-131` |
| C-48 | Blur effect | VERIFIED (the only effect) | `effects/definitions/blur.ts`, `rust/crates/effects/src/shaders/gaussian_blur.wgsl` |
| C-49 | Ripple editing mode | VERIFIED | `ripple/diff.ts`, `core/managers/commands.ts:127-153` |
| C-50 | Drag-selection confined to intended track | VERIFIED that box select hit-tests element rects per track; the specific fix is UNVERIFIED | `timeline/components/selection-hit-testing.ts:78-135` |
| C-51 | Shift/Ctrl+click multi-select | VERIFIED | `timeline/controllers/element-interaction-controller.ts:375-377` |
| C-52 | Shift/Ctrl with marquee adds | VERIFIED | `timeline/components/index.tsx:339-371` |
| C-53 | Click selected element collapses selection | VERIFIED | `element-interaction-controller.ts:402-430` |
| C-54 | Escape deselects | VERIFIED | `actions/definitions.ts:165`, `actions/use-editor-actions.ts:395-412` |
| C-55 | Multiple selected clips move together | VERIFIED | `timeline/group-move/*` |
| C-56 | Multiple selected clips resize together | VERIFIED | `timeline/group-resize/compute-resize.ts`, `timeline/controllers/resize-controller.ts:219-229` |
| C-57 | Trim handles sit outside the clip | VERIFIED (handles offset `-left-1` / `-right-1`) | `timeline/components/timeline-element.tsx:606-655` |
| C-58 | Resize stops at neighbour, no overlap | VERIFIED | `timeline/group-resize/compute-resize.ts:161-240`, `timeline/placement/overlap.ts` |
| C-59 | Move between tracks, selection kept | VERIFIED | `commands/timeline/element/move-elements.ts:36-123` |
| C-60 | Dropping a clip can create a track | VERIFIED | `timeline/components/drop-target.ts`, `timeline/placement/*` |
| C-61 | Dragged clip renders above others | VERIFIED | `timeline/components/index.tsx:787-803` |
| C-62 | Small visual gap between adjacent clips | UNVERIFIED (not located) | n/a |
| C-63 | Track row highlight for selection | VERIFIED | `timeline/components/theme.ts:22`, `timeline/components/index.tsx:660-664,811-814` |
| C-64 | Click empty area to seek | VERIFIED | `timeline/controllers/seek-controller.ts:150-209` |
| C-65 | Vertical scroll anywhere, fixed header | VERIFIED | `timeline/components/index.tsx:221-294` |
| C-66 | Opens scrolled to the main track | VERIFIED | `timeline/hooks/use-initial-scroll-bottom.ts:24-41` |
| C-67 | Track model overlay / main / audio | VERIFIED | `timeline/types.ts:76-80` |
| C-68 | Track labels column | VERIFIED | `timeline/components/index.tsx:673-701,906-935` |
| C-69 | Volume for audio and video elements | VERIFIED (dB, −60..+20, keyframable) | `params/registry.ts:157-174`, `timeline/audio-state.ts:12-75` |
| C-70 | RMS-based waveforms, visible-range rendering | PARTIAL: visible-range rendering VERIFIED; the component draws per-bucket peaks, RMS helpers exist but are not the drawn measure | `media/waveform-summary.ts`, `timeline/components/audio-waveform.tsx:219-269` |
| C-71 | Audio scheduler resilient to timing slips | VERIFIED | `core/managers/audio-manager.ts:299-331` |
| C-72 | Clip speed for video and audio | VERIFIED (0.01–5×) | `retime/rate.ts`, `speed/components/speed-tab.tsx` |
| C-73 | Maintain pitch | VERIFIED | `retime/audio-stretch.ts:70-182` |
| C-74 | Mask: split | VERIFIED | `masks/builtin/definitions/split.ts` |
| C-75 | Mask: rectangle | VERIFIED | `masks/builtin/definitions/rectangle.ts` |
| C-76 | Mask: ellipse | VERIFIED | `masks/builtin/definitions/ellipse.ts` |
| C-77 | Mask: star | VERIFIED | `masks/builtin/definitions/star.ts` |
| C-78 | Mask: heart | VERIFIED | `masks/builtin/definitions/heart.ts` |
| C-79 | Mask: diamond | VERIFIED | `masks/builtin/definitions/diamond.ts` |
| C-80 | Mask: cinematic bars | VERIFIED | `masks/builtin/definitions/cinematic-bars.ts` |
| C-81 | Mask position, size, rotation | VERIFIED | `masks/builtin/box-like.ts:29-95` |
| C-82 | Mask feather | VERIFIED | `masks/registry.ts:30-58`, `rust/crates/masks/src/feather.rs` |
| C-83 | Mask stroke | VERIFIED | `masks/builtin/box-like.ts:107-120` |
| C-84 | Canvas preset sizes | VERIFIED (four) | `canvas/sizes.ts:3-8` |
| C-85 | Custom canvas width and height | VERIFIED | `components/editor/panels/assets/views/settings/index.tsx:128-207` |
| C-86 | Background blur | VERIFIED | `background/blur.ts`, `services/renderer/nodes/blur-background-node.ts` |
| C-87 | Background solid colour | VERIFIED | `components/editor/panels/assets/views/settings/background.tsx:272-305` |
| C-88 | Background gradient | VERIFIED | `gradients/parser.ts`, `gradients/canvas.ts`, `data/colors/*` |
| C-89 | Settings panel with Background tab | VERIFIED | `components/editor/panels/assets/views/settings/index.tsx:224-227` |
| C-90 | Stickers: country flags | VERIFIED | `stickers/providers/flags.ts`, `apps/web/public/flags` (271) |
| C-91 | Stickers: shapes | VERIFIED (inserted as graphic elements) | `stickers/providers/shapes.ts`, `graphics/definitions/*` |
| C-92 | Auto captions | VERIFIED | `services/transcription/*`, `transcription/caption.ts` |
| C-93 | Import transcript file for captions | VERIFIED (.srt, .ass) | `subtitles/parse.ts`, `subtitles/srt.ts`, `subtitles/ass.ts` |
| C-94 | MP4 export with audio, incl. Firefox | VERIFIED for MP4+audio with AAC→Opus fallback; Firefox behaviour not executed | `services/renderer/scene-exporter.ts:94-135` |
| C-95 | Project thumbnails incl. empty timelines | VERIFIED | `core/managers/project-manager.ts:650-686` |
| C-96 | Request persistent storage | VERIFIED | `services/storage/use-storage-persistence.ts` |
| C-97 | Versioned storage migrations (through v25) | VERIFIED, and now through v31 | `services/storage/migrations/index.ts` |
| C-98 | Integer ticks 120,000/s and rational frame rates | VERIFIED | `rust/crates/time/src/media_time.rs:10`, `rust/crates/time/src/frame_rate.rs` |
| C-99 | Frame snapping and timecode in Rust | VERIFIED | `rust/crates/time/src/timecode.rs`, `wasm/media-time.ts` |
| C-100 | Rust/wgpu compositor in WASM | VERIFIED | `rust/crates/compositor`, `rust/wasm/src/compositor.rs` |
| C-101 | Changelog page | VERIFIED (content-collections path risk noted in 0.5) | `app/changelog/page.tsx`, `app/changelog/[version]/page.tsx` |
| C-102 | Brand page with downloads | VERIFIED | `app/brand/page.tsx` |
| C-103 | Header logo context menu for brand assets | VERIFIED | `components/header.tsx:55-96` |
| C-104 | Footer changelog link, sponsor logos | VERIFIED for the footer link and sponsors page; dark-mode logo inversion UNVERIFIED | `components/footer.tsx:18-31`, `site/sponsors.ts` |
| C-105 | Desktop GPUI scaffold, no features | VERIFIED | `apps/desktop/src/main.rs` |

Technical changelog lines not numbered in the earlier checklist: diff-based ripple with `RippleAdjustment` VERIFIED at `ripple/diff.ts` (the changelog's `src/lib/ripple/` path is stale); Cloudflare Workers via OpenNext VERIFIED (`apps/web/wrangler.jsonc`).

Items the earlier document listed as "status unknown", now resolved: transitions NOT FOUND (stub tab); colour adjustments NOT FOUND (stub tab); filters other than blur NOT FOUND; sounds library VERIFIED (Freesound); fades NOT FOUND; audio separation VERIFIED; export settings VERIFIED (format, quality, include audio, cancel; no resolution/fps); shortcut rebinding VERIFIED; i18n NOT FOUND; auth PARTIAL (server only); onboarding VERIFIED; feedback VERIFIED; project duplicate/rename VERIFIED; media folders/search NOT FOUND, sort VERIFIED; track mute/hide VERIFIED, lock NOT FOUND; split VERIFIED; copy/paste/duplicate VERIFIED, cut NOT FOUND; timeline zoom VERIFIED; fullscreen VERIFIED.

---

## 6. Licence, attribution, third-party assets and services

### Licence of the code

- **MIT**, "Copyright 2025-2026 OpenCut" (`LICENSE`). Obligation when copying or porting substantial portions: include the copyright notice and the permission notice in all copies. A clean-room re-implementation from this inventory does not copy code, but keeping the notice in a `THIRD_PARTY_NOTICES` file is the safe course if any source, shader or data file is reused.
- **Brand**: the name "OpenCut" and the logo SVGs (`apps/web/public/logos/opencut`) have their own usage guidelines on the brand page (`apps/web/src/app/brand/page.tsx:172-208`, contact `brand@opencut.app`). Do not reuse the name or marks in JAgentChill.

### Bundled data and assets

| Asset | Origin and obligation | Source |
|---|---|---|
| 271 flag SVGs | origin and licence are not stated anywhere in the repo. UNVERIFIED; find the upstream set and its licence before shipping, or replace with a known-licence set | `apps/web/public/flags` |
| Country data (names, codes, regions) | hand-maintained TS file; no licence note | `apps/web/src/stickers/providers/countries-data.ts` |
| Font atlas and sprite images | generated from the Fontsource Google font list (1,920 families). Sprite previews render each family's name. Fonts themselves are loaded at runtime from Google Fonts; each family has its own licence (mostly OFL / Apache) | `apps/web/scripts/generate-font-sprites.ts`, `apps/web/public/fonts` |
| Gradient presets | "from Syntax UI (https://syntaxui.com/effects/gradients)" and "from Pattern Craft (https://patterncraft.fun/)" per file headers; licences not stated. UNVERIFIED | `apps/web/src/data/colors/syntax-ui.tsx`, `pattern-craft.ts` |
| TikTok layout guide | hand-drawn SVG mock-up plus `public/platform-guides/tiktok-blueprint.png`; platform trade dress, use with care | `apps/web/src/guides/definitions/tiktok-layout.tsx` |
| Platform logos in the guide picker | hot-linked from Brandfetch CDN | `apps/web/src/guides/definitions/platforms.tsx:14` |
| Sponsor logos (fal, Vercel) | third-party marks; not needed for a port | `apps/web/public/logos/others` |
| Effect preview image | `public/effects/preview.jpg`, origin not stated. UNVERIFIED | `apps/web/src/services/renderer/effect-preview.ts:7-8` |
| Icons | lucide-react (ISC), `@hugeicons/core-free-icons`, react-icons; check each licence | `apps/web/package.json` |

### External services

| Service | Used for | Endpoint | Keys |
|---|---|---|---|
| Freesound | sound-effects search and previews | `https://freesound.org/apiv2/search/text/` (server proxy `/api/sounds/search`); previews are Freesound-hosted MP3 URLs fetched by the browser | `FREESOUND_API_KEY` (sent as `token`), `FREESOUND_CLIENT_ID` (declared, unused). Each sound has its own CC licence (CC0, CC-BY, CC-BY-NC); the app stores `license` and `username` but shows no attribution in exports. A port must handle attribution and the NC case itself |
| Google Fonts | font files for text | `https://fonts.googleapis.com/css2?family=…:wght@400;700&display=swap` | none |
| Hugging Face Hub | Whisper ONNX model download for captions | models `onnx-community/whisper-tiny`, `-small`, `-medium`, `-large-v3-turbo`, fetched by transformers.js at runtime | none (public models; check each model card's licence) |
| Marble CMS | blog | `NEXT_PUBLIC_MARBLE_API_URL` (default `https://api.marblecms.com`) | `MARBLE_WORKSPACE_KEY` |
| Upstash Redis (REST) | rate limiting, better-auth rate-limit storage | `UPSTASH_REDIS_REST_URL` | `UPSTASH_REDIS_REST_TOKEN` |
| PostgreSQL | auth tables, feedback | `DATABASE_URL` | n/a |
| Vercel BotID | bot protection on client routes | `botid` package | Vercel platform |
| Databuddy | analytics script (off in development) | `https://cdn.databuddy.cc/databuddy.js` | client id in `app/layout.tsx` (not read) |
| GitHub API | contributors page | `https://api.github.com/repos/OpenCut-app/OpenCut/contributors?per_page=100` | none |
| Brandfetch CDN | platform logos in guides | `https://cdn.brandfetch.io/{domain}/w/64/h/64` | none |
| Cloudflare Workers | hosting (OpenNext) | n/a | deployment credentials |

### Notable library licences to carry

mediabunny (MPL-2.0 at the time of writing; UNVERIFIED here, check before bundling), soundtouchjs (LGPL-2.1; UNVERIFIED here, check; it affects how the pitch-preserving feature can be shipped), `@huggingface/transformers` (Apache-2.0), wgpu (MIT/Apache-2.0), better-auth (MIT), culori (MIT). None of these licences were read from the lockfile in this pass; treat this list as a to-verify list.

Browser capabilities the editor depends on: WebGPU or WebGL2, WebCodecs (decode and encode), OPFS, IndexedDB, OffscreenCanvas, Web Audio, Web Workers, optional EyeDropper, optional `navigator.storage.persist`, Pointer Lock (scrubbing), Fullscreen, async Clipboard (`ClipboardItem`).

---

## 7. PORT-CHECKLIST

One line per discrete feature. Tags in brackets mark items that classic only partly delivers, so the spec can decide whether to port as-is or complete them. Section references point back into this document.

### Projects

- [ ] P-001 Projects page listing all local projects
- [ ] P-002 Skeleton loading grid while projects load
- [ ] P-003 Create new project (default name "New project") and open it
- [ ] P-004 Open project by clicking card or row
- [ ] P-005 Project search by name (live, case-insensitive)
- [ ] P-006 Sort projects by created, modified, name, duration
- [ ] P-007 Sort order toggle ascending/descending
- [ ] P-008 Grid view of projects (responsive columns)
- [ ] P-009 List view of projects
- [ ] P-010 Persist projects view mode and sort
- [ ] P-011 Project card: thumbnail, duration badge, name, created date
- [ ] P-012 Project multi-select with checkboxes
- [ ] P-013 Shift-click range selection of projects
- [ ] P-014 Select-all checkbox with indeterminate state
- [ ] P-015 Bulk duplicate projects
- [ ] P-016 Bulk delete projects
- [ ] P-017 Per-project menu and context menu: Rename, Duplicate, Info, Delete
- [ ] P-018 Rename project dialog
- [ ] P-019 Delete project confirmation dialog [STUB: "type DELETE" input not enforced]
- [ ] P-020 Project info dialog (duration, created, modified, id)
- [ ] P-021 Duplicate naming rule "(N) base name"
- [ ] P-022 Duplicate copies all media assets to the new project
- [ ] P-023 Delete project removes its media files
- [ ] P-024 Empty state: no projects
- [ ] P-025 Empty state: no search results with "Clear search"
- [ ] P-026 Project thumbnail generated from frame 0 (incl. empty timelines and backgrounds)
- [ ] P-027 Thumbnail regenerated on exit
- [ ] P-028 Inline rename of project in editor header
- [ ] P-029 Exit project (flush save, back to projects)
- [ ] P-030 Autosave with 800 ms debounce
- [ ] P-031 Unsaved-changes prompt on page unload
- [ ] P-032 Unknown project id auto-creates "Untitled Project"
- [ ] P-033 Project load error screen
- [ ] P-034 Project loading and exiting spinners

### Project settings

- [ ] S-001 Settings tab with "Project info" and "Background" sub-tabs
- [ ] S-002 Frame rate select: 24, 25, 30, 60, 120 fps
- [ ] S-003 Rational frame-rate model (numerator/denominator)
- [ ] S-004 Canvas presets 16:9, 9:16, 1:1, 4:3
- [ ] S-005 Custom canvas width and height
- [ ] S-006 Remember last custom canvas size
- [ ] S-007 First inserted video/image sets canvas size and fps
- [ ] S-008 Importing higher-fps video raises project fps
- [ ] S-009 Background: solid colour swatches
- [ ] S-010 Background: custom colour picker with live preview
- [ ] S-011 Background: gradient presets (Pattern Craft, Syntax UI)
- [ ] S-012 Background: CSS gradient rendering (linear, radial, layered)
- [ ] S-013 Background: blur of main-track media (Light, Medium, Heavy)
- [ ] S-014 Project settings changes are undoable
- [ ] S-015 Default project: 1920×1080, 30 fps, black background

### Scenes

- [ ] SC-001 Multiple scenes per project with a main scene
- [ ] SC-002 Scenes sheet listing scenes
- [ ] SC-003 Switch active scene
- [ ] SC-004 Multi-select and delete scenes with confirmation
- [ ] SC-005 Main scene cannot be deleted
- [ ] SC-006 Deleting the active scene falls back to main
- [ ] SC-007 Create scene [PARTIAL: command only, no UI]
- [ ] SC-008 Rename scene [PARTIAL: command only, no UI]
- [ ] SC-009 Current scene name shown in timeline toolbar
- [ ] SC-010 Bookmarks are per scene

### Media library

- [ ] M-001 Import media via file picker (image, video, audio; multiple)
- [ ] M-002 Import by drag-and-drop onto the media panel
- [ ] M-003 Import by dropping OS files onto the timeline
- [ ] M-004 Import by pasting media from the clipboard
- [ ] M-005 Type detection by MIME prefix; unsupported-type toast
- [ ] M-006 Storage quota check before import with error toast
- [ ] M-007 Video probe: duration, dimensions, fps, has-audio, codec, decodability
- [ ] M-008 Undecodable video still imports with a warning (HEVC hint)
- [ ] M-009 Video thumbnail from the 1 s frame
- [ ] M-010 Image thumbnail
- [ ] M-011 Thumbnails capped at 1280×720 JPEG
- [ ] M-012 Audio duration probe
- [ ] M-013 Import progress percentage and upload toast
- [ ] M-014 Media grid view
- [ ] M-015 Media list view
- [ ] M-016 Sort media by name, type, duration, file size (asc/desc)
- [ ] M-017 Persist media view mode and sort
- [ ] M-018 Media multi-select (marquee, shift, ctrl)
- [ ] M-019 Delete media asset(s) via context menu
- [ ] M-020 Deleting an asset removes its timeline elements (undoable)
- [ ] M-021 Add asset to timeline with "+" button at playhead
- [ ] M-022 Drag asset to timeline with floating preview
- [ ] M-023 Reveal media in panel from a timeline clip
- [ ] M-024 Empty/drag-over drop zone state
- [ ] M-025 Hide ephemeral assets
- [ ] M-026 SVG image support (MIME repair on load)
- [ ] M-027 Asset name truncation in cards
- [ ] M-028 "Export clips" context item [STUB]

### Timeline structure

- [ ] T-001 Track types: video, text, audio, graphic, effect
- [ ] T-002 Scene track layout: overlay tracks, one main track, audio tracks
- [ ] T-003 Element types: video, image, text, sticker, graphic, effect, audio (upload and library)
- [ ] T-004 Strict element-to-track type mapping
- [ ] T-005 No-overlap rule within a track (touching allowed)
- [ ] T-006 Automatic track creation on insert
- [ ] T-007 New-track insert index rules (audio below main, others above, effects on top)
- [ ] T-008 Automatic removal of empty overlay and audio tracks
- [ ] T-009 Main track always exists
- [ ] T-010 Main-track first clip snaps to time 0
- [ ] T-011 Track labels column with type icon
- [ ] T-012 Track mute toggle (video, audio)
- [ ] T-013 Track hide toggle (non-audio)
- [ ] T-014 Track context menu: paste, mute, hide, delete track
- [ ] T-015 Delete track (not main)
- [ ] T-016 Track heights per type (65 / 50 / 25 px)
- [ ] T-017 Selected-track row highlight
- [ ] T-018 Empty track dashed placeholder
- [ ] T-019 Default element duration 5 s
- [ ] T-020 Total duration = max element end

### Timeline editing

- [ ] T-030 Select element by click
- [ ] T-031 Toggle selection with Cmd/Ctrl/Shift click
- [ ] T-032 Box (marquee) selection
- [ ] T-033 Additive box selection with modifiers
- [ ] T-034 Select all
- [ ] T-035 Deselect / cancel interaction with Escape (layered: gesture, mask points, keyframes, elements)
- [ ] T-036 Click empty area clears selection and seeks
- [ ] T-037 Drag to move element(s) with 5 px threshold
- [ ] T-038 Group move preserving relative offsets
- [ ] T-039 Move across tracks with compatible-track assignment
- [ ] T-040 Move to new track (drop line indicator)
- [ ] T-041 Move rejected on overlap
- [ ] T-042 Dragged clip rendered above others
- [ ] T-043 Edge auto-scroll while dragging
- [ ] T-044 Trim/resize from left and right handles
- [ ] T-045 Group resize of multiple selected clips
- [ ] T-046 Minimum clip duration one frame
- [ ] T-047 Trim limited by source duration
- [ ] T-048 Trim limited by neighbouring clips
- [ ] T-049 Free extension for non-source elements (text, image, sticker, graphic, effect)
- [ ] T-050 Live resize preview, single undo step
- [ ] T-051 Keyframes truncated when duration shrinks
- [ ] T-052 Split at playhead
- [ ] T-053 Split and remove left
- [ ] T-054 Split and remove right
- [ ] T-055 Split applies to selection or to all clips under the playhead
- [ ] T-056 Split preserves animation with boundary keyframes
- [ ] T-057 Split is retime-aware
- [ ] T-058 Ripple editing toggle (persisted)
- [ ] T-059 Ripple on delete and end-trim (same track)
- [ ] T-060 Snapping toggle (persisted)
- [ ] T-061 Snap to element edges
- [ ] T-062 Snap to playhead
- [ ] T-063 Snap to keyframes
- [ ] T-064 Snap to bookmarks (playhead scrub and bookmark drag)
- [ ] T-065 10 px snap threshold
- [ ] T-066 Shift temporarily disables snapping
- [ ] T-067 Snap indicator line
- [ ] T-068 Copy selected elements
- [ ] T-069 Paste elements at playhead preserving offsets
- [ ] T-070 Paste selects pasted elements
- [ ] T-071 Duplicate selected elements onto new tracks
- [ ] T-072 Delete selected elements
- [ ] T-073 Hide/show selected elements
- [ ] T-074 Mute/unmute selected elements
- [ ] T-075 Element context menu (split, copy, duplicate, mute, extract audio, hide, expand keyframes, reveal media, delete)
- [ ] T-076 Replace media [STUB]
- [ ] T-077 Freeze frame [STUB]
- [ ] T-078 Drag asset onto timeline at mouse time with track resolution
- [ ] T-079 Drop effect onto a clip to add a clip effect
- [ ] T-080 Drop effect on empty area to create an effect element
- [ ] T-081 OS file drop inserts at playhead; first visual on empty timeline goes to main
- [ ] T-082 Frame-accurate positioning (all times rounded to frames)
- [ ] T-083 Extract audio from video clip into an audio element
- [ ] T-084 Recover (re-enable) source audio on a video clip

### Timeline view

- [ ] T-090 Zoom in/out buttons (×1.7)
- [ ] T-091 Zoom slider (exponential)
- [ ] T-092 Ctrl/Cmd + wheel zoom
- [ ] T-093 Dynamic minimum zoom fitting content
- [ ] T-094 Playhead-anchored zoom
- [ ] T-095 Horizontal scroll with Shift + wheel
- [ ] T-096 Vertical scroll with fixed ruler
- [ ] T-097 Ruler, bookmarks row and labels scroll-synced
- [ ] T-098 Initial scroll to bottom (main track visible)
- [ ] T-099 Persist zoom, scroll and playhead per project
- [ ] T-100 Ruler ticks adapting to zoom (frames and seconds)
- [ ] T-101 Ruler labels MM:SS / H:MM:SS / frames
- [ ] T-102 Virtualised ruler ticks
- [ ] T-103 Playhead line and handle
- [ ] T-104 Drag playhead to scrub
- [ ] T-105 Click ruler to seek
- [ ] T-106 Playhead keyboard stepping when focused
- [ ] T-107 Auto-follow playhead during playback
- [ ] T-108 Timeline toolbar (split, split left/right, extract audio, duplicate, delete, bookmark, graph editor, scene, snapping, ripple, zoom)
- [ ] T-109 Device-pixel snapping of positions

### Timeline clip rendering

- [ ] T-120 Video/image clips show tiled thumbnail and name
- [ ] T-121 Effects badge on clips with effects (opens Effects tab)
- [ ] T-122 Audio clips show waveform
- [ ] T-123 Waveform reflects trim, retime and gain
- [ ] T-124 Waveform clipping indicator (orange tip)
- [ ] T-125 Waveform drawn only for the visible range
- [ ] T-126 Audio volume line draggable on clip
- [ ] T-127 Text clips show content
- [ ] T-128 Sticker/graphic clips show preview and name
- [ ] T-129 Effect clips show icon and name
- [ ] T-130 Type colours for clips
- [ ] T-131 Selected ring and handles
- [ ] T-132 Hidden clips dimmed

### Bookmarks

- [ ] B-001 Toggle bookmark at playhead
- [ ] B-002 Bookmark markers row under the ruler
- [ ] B-003 Click bookmark to seek
- [ ] B-004 Bookmark popover on double-click
- [ ] B-005 Bookmark note
- [ ] B-006 Bookmark colour
- [ ] B-007 Bookmark duration (range bar)
- [ ] B-008 Delete bookmark
- [ ] B-009 Drag bookmark with snapping
- [ ] B-010 Bookmark notes overlay in preview (toggle)
- [ ] B-011 Bookmark operations undoable

### Playback

- [ ] PB-001 Play/pause
- [ ] PB-002 Stop (pause and return to start)
- [ ] PB-003 Seek ±1 s
- [ ] PB-004 Jump ±5 s
- [ ] PB-005 Frame step forward/backward
- [ ] PB-006 Go to start / end
- [ ] PB-007 Auto-pause at end; play from end restarts
- [ ] PB-008 Master volume and mute (API)
- [ ] PB-009 Live audio playback scheduler with lookahead
- [ ] PB-010 Audio drift recovery
- [ ] PB-011 Editable timecode field (HH:MM:SS:FF)
- [ ] PB-012 Total duration display

### Preview / canvas

- [ ] V-001 GPU-composited preview canvas
- [ ] V-002 Render only on frame or scene change
- [ ] V-003 Preview zoom presets (25–200 %) and Fit
- [ ] V-004 Ctrl/Cmd + wheel zoom in preview
- [ ] V-005 Pan with wheel and middle-mouse drag when zoomed
- [ ] V-006 Fit to screen
- [ ] V-007 Fullscreen preview
- [ ] V-008 Preview toolbar: timecode, duration, play/pause, zoom, fullscreen
- [ ] V-009 Preview context menu: fit, fullscreen, save snapshot, copy snapshot, overlay toggles
- [ ] V-010 Save snapshot as PNG
- [ ] V-011 Copy snapshot to clipboard
- [ ] V-012 Click to select topmost element
- [ ] V-013 Drag to move element(s) on canvas
- [ ] V-014 Corner handles: uniform scale
- [ ] V-015 Edge handles: single-axis scale
- [ ] V-016 Rotation handle
- [ ] V-017 Negative scale flips
- [ ] V-018 Snap to canvas centre and edges with guides
- [ ] V-019 Rotation snap at 90° steps
- [ ] V-020 Shift disables snapping
- [ ] V-021 Double-click text to edit in place
- [ ] V-022 Text edit commits on blur/Escape/playback
- [ ] V-023 Overlay system (HUD, scene, viewport mounts)
- [ ] V-024 GPU-unavailable banner
- [ ] V-025 Layout guide: grid with rows/columns [PARTIAL: picker unreachable]
- [ ] V-026 Layout guide: TikTok UI overlay [PARTIAL: picker unreachable]
- [ ] V-027 Layout guides: Instagram Reels, YouTube Shorts, Snapchat Spotlight [STUB]
- [ ] V-028 Custom guide lines [STUB]
- [ ] V-029 Persist preview settings (guide, overlays, grid)

### Properties panel

- [ ] PR-001 Empty state when nothing selected
- [ ] PR-002 Multi-selection message [PARTIAL: no multi-edit]
- [ ] PR-003 Per-element-type tab sets (text, video, image, sticker, graphic, audio, effect)
- [ ] PR-004 Transform tab: position X/Y
- [ ] PR-005 Transform tab: scale X/Y
- [ ] PR-006 Transform tab: rotation
- [ ] PR-007 Blending tab: opacity
- [ ] PR-008 Blending tab: 17 blend modes
- [ ] PR-009 Audio tab: volume in dB
- [ ] PR-010 Audio tab: muted
- [ ] PR-011 Audio tab hidden for video without audio
- [ ] PR-012 Speed tab: rate 0.01–5×
- [ ] PR-013 Speed tab: change/maintain pitch
- [ ] PR-014 Number field typing with step snap and clamp
- [ ] PR-015 Number field scrubbing (pointer lock)
- [ ] PR-016 Math expressions in number fields
- [ ] PR-017 Reset-to-default button per field
- [ ] PR-018 Live preview while editing, commit on blur
- [ ] PR-019 Keyframe toggle per keyframable field
- [ ] PR-020 Editing a keyframed property writes a keyframe at the playhead
- [ ] PR-021 Collapsible sections
- [ ] PR-022 Dependent fields shown only when enabled (text background)

### Text

- [ ] TX-001 Add default text element (click or drag)
- [ ] TX-002 Text content (multi-line)
- [ ] TX-003 Font family [PARTIAL: plain input on text elements]
- [ ] TX-004 Font size
- [ ] TX-005 Text colour (animatable)
- [ ] TX-006 Alignment left/center/right
- [ ] TX-007 Bold
- [ ] TX-008 Italic
- [ ] TX-009 Underline / line-through
- [ ] TX-010 Letter spacing
- [ ] TX-011 Line height
- [ ] TX-012 Background on/off
- [ ] TX-013 Background colour
- [ ] TX-014 Background corner radius
- [ ] TX-015 Background padding X/Y
- [ ] TX-016 Background offset X/Y
- [ ] TX-017 Font size scales with canvas height
- [ ] TX-018 Google font loading on demand and on project load
- [ ] TX-019 Font picker with search, virtualised list, sprite previews
- [ ] TX-020 System font list
- [ ] TX-021 Font atlas / sprite generator script
- [ ] TX-022 Font picker tabs My fonts / Favorites [STUB]

### Stickers and graphics

- [ ] G-001 Stickers panel with categories All, Flags, Shapes
- [ ] G-002 Flag stickers (271)
- [ ] G-003 Flag search by name, code, region, continent
- [ ] G-004 Shape items backed by graphic definitions
- [ ] G-005 Recently used stickers (persisted)
- [ ] G-006 Clear recents
- [ ] G-007 "See all" per provider
- [ ] G-008 Sticker search across providers
- [ ] G-009 Add sticker by click at playhead
- [ ] G-010 Add sticker by drag
- [ ] G-011 Sticker intrinsic size captured at insert
- [ ] G-012 Graphic: rectangle (fill, stroke, corner radius)
- [ ] G-013 Graphic: ellipse
- [ ] G-014 Graphic: polygon (3–12 sides, corner radius)
- [ ] G-015 Graphic: star (points, depth)
- [ ] G-016 Graphic stroke width, colour, alignment
- [ ] G-017 Graphic params keyframable
- [ ] G-018 Logos sticker provider [STUB]

### Effects, blend, masks

- [ ] E-001 Effects panel with live previews
- [ ] E-002 Blur effect with intensity
- [ ] E-003 Add effect to a clip
- [ ] E-004 Effect as standalone timeline element affecting layers beneath
- [ ] E-005 Enable/disable clip effect
- [ ] E-006 Remove clip effect
- [ ] E-007 Reorder clip effects
- [ ] E-008 Edit effect params with live preview
- [ ] E-009 Effect params keyframable (linear/hold)
- [ ] E-010 Blend modes rendered on GPU (17)
- [ ] E-011 Opacity per element
- [ ] K-001 Mask: split
- [ ] K-002 Mask: cinematic bars
- [ ] K-003 Mask: rectangle
- [ ] K-004 Mask: ellipse
- [ ] K-005 Mask: heart
- [ ] K-006 Mask: diamond
- [ ] K-007 Mask: star
- [ ] K-008 Mask: text
- [ ] K-009 Mask: freeform pen tool (polygon) [PARTIAL: no bezier handles]
- [ ] K-010 Mask position, size, rotation, scale params
- [ ] K-011 Mask feather (GPU jump-flood)
- [ ] K-012 Mask invert
- [ ] K-013 Mask stroke width, colour, alignment
- [ ] K-014 Mask handles on canvas (move, resize, rotate, feather)
- [ ] K-015 Mask snapping to element box
- [ ] K-016 Pen tool: add points, close path
- [ ] K-017 Pen tool: insert point on segment
- [ ] K-018 Pen tool: select and delete points
- [ ] K-019 Add-mask menu with hover preview
- [ ] K-020 Remove mask
- [ ] K-021 One mask per element [PARTIAL: multiple not supported]
- [ ] K-022 Masks on video, image, graphic elements
- [ ] X-001 Transitions [STUB tab only]
- [ ] X-002 Adjustment / colour correction [STUB tab only]

### Keyframes and animation

- [ ] A-001 Keyframes on position X/Y, scale X/Y, rotation, opacity
- [ ] A-002 Keyframes on volume
- [ ] A-003 Keyframes on text colour and text background properties
- [ ] A-004 Keyframes on graphic params
- [ ] A-005 Keyframes on effect params
- [ ] A-006 Colour interpolation in linear RGB
- [ ] A-007 Interpolation types linear, hold, bezier
- [ ] A-008 Keyframe diamonds on selected clips
- [ ] A-009 Expand keyframes into per-property lanes
- [ ] A-010 Click keyframe to seek and select
- [ ] A-011 Multi-select keyframes (toggle, range)
- [ ] A-012 Box-select keyframes
- [ ] A-013 Drag keyframes in time
- [ ] A-014 Delete keyframes
- [ ] A-015 Copy/paste keyframes
- [ ] A-016 Removing the last keyframe writes the current value to the base
- [ ] A-017 Graph editor popover for segment easing
- [ ] A-018 Bezier handle editing with live preview
- [ ] A-019 Easing presets (Smooth, Ease out, Ease in, In out, Pop, Linear)
- [ ] A-020 Custom saved easing presets
- [ ] A-021 Scale drag in preview clears scale keyframes

### Audio

- [ ] AU-001 Audio tracks and audio elements
- [ ] AU-002 Clip volume −60..+20 dB
- [ ] AU-003 Clip mute and track mute
- [ ] AU-004 Video source audio playback
- [ ] AU-005 Peak-based waveform summaries with cache
- [ ] AU-006 Mixdown to stereo 44.1 kHz for export
- [ ] AU-007 Export limiter when peak exceeds 0.98
- [ ] AU-008 Sounds panel: Freesound sound effects search
- [ ] AU-009 Sounds: initial top-downloads list
- [ ] AU-010 Sounds: infinite scroll
- [ ] AU-011 Sounds: preview playback
- [ ] AU-012 Sounds: save/unsave favourites (persisted)
- [ ] AU-013 Sounds: Saved tab with clear all
- [ ] AU-014 Sounds: add to timeline as library audio
- [ ] AU-015 Songs search [STUB]

### Speed

- [ ] SP-001 Constant speed for video and audio clips
- [ ] SP-002 Duration recomputed from rate
- [ ] SP-003 Pitch-preserving time stretch
- [ ] SP-004 Speed applied in preview, waveform, trim, split and export

### Captions

- [ ] CP-001 Captions panel
- [ ] CP-002 Auto transcription on-device (Whisper via transformers.js worker)
- [ ] CP-003 Language selection (auto + 9 languages)
- [ ] CP-004 Model download progress
- [ ] CP-005 Captions grouped 3 words, minimum 0.8 s
- [ ] CP-006 Captions inserted as text elements on a new text track (one undo step)
- [ ] CP-007 Import SRT
- [ ] CP-008 Import ASS with basic style mapping
- [ ] CP-009 Caption default style (bold, bottom, wrapped)
- [ ] CP-010 "No audio" diagnostic disables generation
- [ ] CP-011 Transcription model choice [PARTIAL: fixed to small]

### Export

- [ ] EX-001 Export popover
- [ ] EX-002 Format MP4 (H.264 + AAC)
- [ ] EX-003 Format WebM (VP9 + Opus)
- [ ] EX-004 Quality low / medium / high / very high
- [ ] EX-005 Include-audio toggle
- [ ] EX-006 Export at project resolution and fps
- [ ] EX-007 Progress bar with percentage
- [ ] EX-008 Cancel export
- [ ] EX-009 Error view with copy and retry
- [ ] EX-010 AAC to Opus fallback
- [ ] EX-011 Download `{projectName}.{ext}`
- [ ] EX-012 Empty project error

### Undo, clipboard, commands

- [ ] U-001 Undo
- [ ] U-002 Redo
- [ ] U-003 Command pattern with batch commands
- [ ] U-004 Selection restored on undo where a command changed it
- [ ] U-005 Gesture preview then single committed step
- [ ] U-006 In-memory clipboard for elements and keyframes
- [ ] U-007 Action registry decoupling triggers from handlers

### Keyboard shortcuts

- [ ] KB-001 Space / K: play/pause
- [ ] KB-002 L: seek forward 1 s
- [ ] KB-003 J: seek backward 1 s
- [ ] KB-004 Right / Left: frame step
- [ ] KB-005 Shift+Right / Shift+Left: jump 5 s
- [ ] KB-006 Home / Enter: go to start
- [ ] KB-007 End: go to end
- [ ] KB-008 S: split
- [ ] KB-009 Q: split and remove left
- [ ] KB-010 W: split and remove right
- [ ] KB-011 Backspace / Delete: delete selection
- [ ] KB-012 Ctrl/Cmd+C: copy
- [ ] KB-013 Ctrl/Cmd+V: paste
- [ ] KB-014 N: toggle snapping
- [ ] KB-015 Ctrl/Cmd+A: select all
- [ ] KB-016 Escape: cancel interaction / deselect
- [ ] KB-017 Ctrl/Cmd+D: duplicate
- [ ] KB-018 Ctrl/Cmd+Z: undo
- [ ] KB-019 Ctrl/Cmd+Shift+Z / Ctrl+Y: redo
- [ ] KB-020 Unbound actions available for binding: stop, toggle ripple, toggle source audio, deselect all, mute selected, hide selected, toggle bookmark
- [ ] KB-021 Shortcuts dialog grouped by category
- [ ] KB-022 Rebind by recording a key combination
- [ ] KB-023 Conflict detection on rebind
- [ ] KB-024 Reset shortcuts to defaults
- [ ] KB-025 Persist custom shortcuts with versioned migrations
- [ ] KB-026 Shortcuts suppressed in text inputs and while overlays are open
- [ ] KB-027 Physical-key mapping for non-QWERTY layouts
- [ ] KB-028 Cmd on macOS, Ctrl elsewhere
- [ ] KB-029 Import/export keybindings [PARTIAL: no UI]

### Storage and persistence

- [ ] ST-001 Projects stored in IndexedDB
- [ ] ST-002 Media files stored in OPFS per project
- [ ] ST-003 Media metadata stored in IndexedDB per project
- [ ] ST-004 Saved sounds stored in IndexedDB
- [ ] ST-005 UI preferences in localStorage
- [ ] ST-006 Versioned project schema with ordered migrations (v0 to v31)
- [ ] ST-007 Migration progress dialog
- [ ] ST-008 Request persistent storage (dialog on Firefox)
- [ ] ST-009 Quota estimation with 50 MB reserve
- [ ] ST-010 Rollback on failed media save
- [ ] ST-011 Integer-tick time base (120,000/s)

### Editor shell

- [ ] SH-001 Four-panel resizable layout (assets, preview, properties, timeline)
- [ ] SH-002 Persist panel sizes
- [ ] SH-003 Assets panel vertical tab bar (Media, Sounds, Text, Stickers, Effects, Transitions, Captions, Adjustment, Settings)
- [ ] SH-004 Editor header: logo menu (Exit project, Shortcuts, Discord)
- [ ] SH-005 Theme toggle (light/dark)
- [ ] SH-006 Mobile gate for narrow screens
- [ ] SH-007 Onboarding dialog (3 steps)
- [ ] SH-008 Changelog notification card
- [ ] SH-009 Feedback popover with draft and history
- [ ] SH-010 Toast notifications
- [ ] SH-011 Colour picker (SV square, hue, alpha, formats, eyedropper, paste)
- [ ] SH-012 Diagnostics registry
- [ ] SH-013 Render performance instrumentation (opt-in)

### Rendering engine

- [ ] R-001 Scene tree builder from tracks
- [ ] R-002 Per-frame resolve of animated properties
- [ ] R-003 Video frame cache with sequential decode and seek
- [ ] R-004 Image and sticker caches
- [ ] R-005 Frame descriptor format
- [ ] R-006 Texture sync with content hashing
- [ ] R-007 wgpu compositor: transform, opacity, blend
- [ ] R-008 Effect pass pipeline (Gaussian blur)
- [ ] R-009 Mask compositing with JFA feather
- [ ] R-010 Scene-level effects
- [ ] R-011 WebGPU with WebGL2 fallback
- [ ] R-012 Contain-fit of media into canvas
- [ ] R-013 Blur background backdrop

### Backend and site

- [ ] W-001 POST /api/feedback with validation and rate limit
- [ ] W-002 GET /api/sounds/search Freesound proxy
- [ ] W-003 GET /api/health
- [ ] W-004 Auth endpoints (better-auth) [PARTIAL: no UI]
- [ ] W-005 Postgres schema: users, sessions, accounts, verifications, feedback
- [ ] W-006 Redis rate limiting (100/min per IP)
- [ ] W-007 Landing page
- [ ] W-008 Blog (CMS-backed) and RSS
- [ ] W-009 Changelog pages
- [ ] W-010 Roadmap page
- [ ] W-011 Contributors page
- [ ] W-012 Sponsors page
- [ ] W-013 Brand assets page
- [ ] W-014 Privacy and terms pages
- [ ] W-015 Sitemap, robots, web manifest, OG images
- [ ] W-016 Analytics and bot protection hooks

### Desktop

- [ ] D-001 Desktop app shell [STUB: empty window]

### Absent in classic (decide explicitly whether JAgentChill adds them)

- [ ] N-001 Transitions between clips
- [ ] N-002 Filters and colour adjustments
- [ ] N-003 Additional effects beyond blur
- [ ] N-004 Audio fades and crossfades
- [ ] N-005 Track lock, reorder, rename
- [ ] N-006 Cut to clipboard
- [ ] N-007 Loop playback and playback rate
- [ ] N-008 Export resolution, fps, range, bitrate, GIF, audio-only
- [ ] N-009 Media folders and search
- [ ] N-010 i18n
- [ ] N-011 Accounts / login UI and cloud sync
- [ ] N-012 Text shadow, outline, auto-wrap
- [ ] N-013 Crop and explicit flip controls
- [ ] N-014 Speed ramps, reverse, freeze frame
- [ ] N-015 Subtitle export
- [ ] N-016 Multiple masks per element
- [ ] N-017 Generative AI features
- [ ] N-018 Project file import/export

---

## Coverage notes

Read directly for this document: root and `apps/web` config, `actions/**`, `services/storage/**` (service, adapters, quota, runner, index; transformers v0, v2–v9 in full, the others by key functions, comments and test names), `db`, `auth`, `env`, API routes for auth, feedback and health, the core type files quoted in section 3, `core/index.ts`, `core/managers/commands.ts`, `commands/base-command.ts`, `commands/batch-command.ts`, `apps/desktop/src/main.rs`.

Not fully covered (also listed at the end of each sweep in 2.A to 2.D):

- `animation/` internals (interpolation maths, `keyframes.ts` beyond entry points, `resolve.ts`, `bezier.ts`).
- Mask path maths (`heart.ts`, `star.ts`, most of `freeform/path.ts`, split renderer body), `text/measure-element.ts`, gradient stop/angle maths.
- Bodies of the effects, masks and effect-keyframe commands, `add-media-asset.ts`, `update-project-settings.ts`.
- `components/ui/*` generic kit components other than colour picker, number field and font picker.
- Privacy and terms text, `blog/types.ts`, landing hero details.
- Migration transformers v3→v4 and v4→v5 detail; v1→v2 track transformation detail.
- All test files, `Cargo.lock`, `bun.lock`; third-party licence texts were not read.
- Nothing was built or executed, so every BUG? item and the build status of HEAD are unconfirmed.
