# OpenCut inventory (for the JAgentChill port spec)

Source inspected: `/Users/ngocchanh/Project/private/organisations/hdc/jagentchill/.refs/opencut`
Remote: `https://github.com/opencut-app/opencut.git`, HEAD `e668010` (2026-09-24, "ci(media): add the workflow that builds FFmpeg for every platform"), shallow clone.
Inventory date: 2026-10-05. Every file in the clone (130 files outside `.git`) was read, except the bodies of the 56 generated shadcn UI files, `Cargo.lock` (only grepped) and binary/SVG assets.

All paths below are relative to the clone root unless they start with `classic:`.

---

## 0. BLOCKING FINDING: this clone does not contain the editor

The cloned repository is the **ground-up rewrite** of OpenCut, and at this commit it is a skeleton. It contains no timeline, no media library, no preview, no export, no storage, no auth, no database, no keyboard shortcuts, no i18n and no data model.

Evidence:

- `README.md:19-28`: "OpenCut is being rewritten from the ground up ... You can still find the previous version at opencut-app/opencut-classic, which is the one to reach for today. opencut.app still runs the classic version."
- `apps/web/src/routes/editor.tsx:5-11`: the editor route renders only `<h1>Editor</h1><p>Coming soon.</p>`.
- `apps/web/src/routes/index.tsx:5-10`: the home route renders only `hello world!`.
- `apps/desktop/README.md:5-6`: "Very early. Right now this is just a window that opens."
- `apps/desktop/src/panels/*.rs`: each of the four panels renders only its own name as a centred string.
- `apps/api/src/index.ts`: three demo routes (`/`, `/health`, `/echo`).
- `crates/media/`: contains only `setup/setup.ts` and `setup/ffmpeg.json`; there is no `Cargo.toml`, no Rust source, and the crate is commented out of the workspace (`Cargo.toml:5`).

The CapCut-like feature set the port spec needs lives in **`opencut-app/opencut-classic`** (archived, MIT, default branch `main`, HEAD `cf5e79e919144200294fb9fed22a222592a0aeea`, last push 2026-05-17, 1,335 files; metadata and file listing obtained from the GitHub API on 2026-10-05). That repository is **not cloned locally and its file contents were not read for this document**.

Consequence for this document:

- Sections 1 to 5 describe what is actually in the local clone, with citations.
- The only local evidence of the real editor features is `changelog/0.1.0.md`, `0.2.0.md`, `0.3.0.md`. These describe the classic app (they cite paths such as `src/lib/ripple/` and `rust/crates/time` that do not exist in this clone). Everything taken from them is tagged **CHANGELOG-ONLY** and is **UNVERIFIED against code**.
- Appendix A gives the directory map of `opencut-classic` (listing only) so the follow-up inventory can be targeted.
- A spec for "every OpenCut feature" **cannot be written from this document**. To get there: clone `opencut-app/opencut-classic` into `.refs/` and rerun this inventory against it.

Tags used: **VERIFIED** (read in local code), **CHANGELOG-ONLY** (claimed in local changelog, code absent locally), **STUB** (placeholder in local code), **ROADMAP** (README statement of intent, no code), **UNVERIFIED** (could not be checked).

---

## 1. Repo architecture (local clone)

### 1.1 Workspace and build tooling

| Item | Detail | Source |
|---|---|---|
| Task runner | moon 2.3.3; projects globbed from `apps/*` and `crates/*`, plus root as project `root` | `.prototools:3`, `.moon/workspace.yml` |
| Toolchain pinning | proto; bun 1.3.11, rust 1.97.0 | `.prototools` |
| JS package manager | bun; installs refuse packages younger than 7 days (`minimumReleaseAge = 604800`) | `.moon/toolchains.yml`, `bunfig.toml` |
| Cargo workspace | resolver 3, edition 2024, version 0.1.0, license MIT; only member is `apps/desktop` (`crates/*` commented out); workspace dep `gpui = "0.2.2"` | `Cargo.toml` |
| Root task | `upload-logos`: uploads `brand/marks/*.svg` to the R2 bucket named by `R2_BUCKET` in `.env.local` using wrangler | `moon.yml`, `.env.example` |
| CI | `moon ci` on ubuntu, windows, macos for pushes and PRs to `main` (markdown-only changes ignored) | `.github/workflows/bun-ci.yml` |
| CI (media) | manual workflow building FFmpeg for 6 platforms and publishing a prerelease `ffmpeg-<version>-<build>` | `.github/workflows/media-deps.yml` |
| Editor config | Biome for TS/TSX formatting, Prettier elsewhere | `.vscode/settings.json` |
| Lint guidance | Ultracite/Biome rule list; contains leftover Next.js rules although the app is no longer Next.js | `.github/copilot-instructions.md:306-311` |
| Contribution policy | PRs not accepted except critical bug fixes | `README.md:64-66`, `.github/pull_request_template.md` |

There is no root `package.json`; each JS app has its own.

### 1.2 `apps/web` (`@opencut/web`)

Scaffolded with create-tanstack-app (file router, cloudflare and shadcn add-ons; `apps/web/.cta.json`).

- Framework: TanStack Start + TanStack Router (`latest`), React ^19.2.0, Vite ^8.0.0, TypeScript ^6.0.2 (`apps/web/package.json`).
- Styling: Tailwind CSS ^4.1.18 via `@tailwindcss/vite`, `tw-animate-css`, shadcn ^4.7.0 with style `base-mira`, base colour neutral, icon library hugeicons (`apps/web/components.json`).
- UI primitives: `@base-ui/react` ^1.4.1, `radix-ui` ^1.4.3, `cmdk`, `vaul`, `sonner`, `embla-carousel-react`, `react-resizable-panels` ^4.11.0, `recharts` 3.8.0, `react-day-picker`, `input-otp`, `lucide-react`, `@hugeicons/react`.
- Forms and validation: `react-hook-form` ^7.75.0, `zod` ^4.4.3, `@hookform/resolvers`.
- Theming dependency: `next-themes` ^0.4.6 (no theme toggle is wired in any route).
- Testing: vitest ^4.1.5, jsdom, Testing Library. **No test files exist.**
- State management: **none** (no zustand, redux, jotai or similar in dependencies).
- Rendering engine, wasm, storage, auth, DB: **none**.
- Deployment: Cloudflare Workers through `@cloudflare/vite-plugin`; worker name `opencut-web`, custom domain `new.opencut.app`, `nodejs_compat` (`apps/web/wrangler.jsonc`, `apps/web/vite.config.ts`).
- Scripts: `dev` (vite on port 5173), `build`, `preview`, `test`, `deploy`.
- Path aliases: `#/*` and `@/*` both map to `./src/*` (`apps/web/tsconfig.json`).

Source files:

| Path | Content |
|---|---|
| `apps/web/src/routes/__root.tsx` | HTML shell, `lang="en"`, title "OpenCut rewrite \| beta.opencut.app", Google Fonts preconnect and Playfair Display stylesheet, `TooltipProvider`, TanStack devtools mounted unconditionally |
| `apps/web/src/routes/index.tsx` | `/` renders "hello world!" |
| `apps/web/src/routes/editor.tsx` | `/editor` renders "Editor / Coming soon." (STUB) |
| `apps/web/src/router.tsx` | router with scroll restoration, `defaultPreload: 'intent'` |
| `apps/web/src/routeTree.gen.ts` | generated; exactly two routes |
| `apps/web/src/styles.css` | design tokens (oklch) for light and `.dark`; Inter Variable body font, Playfair Display headings; radius 0.625rem |
| `apps/web/src/hooks/use-mobile.ts` | `useIsMobile()`, breakpoint 768px |
| `apps/web/src/lib/utils.ts` | `cn()` (clsx + tailwind-merge) |
| `apps/web/src/components/ui/*.tsx` | 56 generated shadcn components (list in 2.2). Only `tooltip.tsx` is imported by application code |
| `apps/web/public/manifest.json` | unmodified template ("Create TanStack App Sample"); references `logo192.png` and `logo512.png`, which are not in the repo |

Inconsistency to note: the page title says `beta.opencut.app` while the deployed route and README say `new.opencut.app`.

### 1.3 `apps/api` (`@opencut/api`)

- Elysia (`latest`) with `CloudflareAdapter`, deployed as Cloudflare Worker `opencut-api`, compatibility date 2025-06-01 (`apps/api/package.json`, `apps/api/wrangler.jsonc`).
- Dev server on port 8787 (`README.md:60`).
- Entire source is `apps/api/src/index.ts` (15 lines). Routes in section 2.3.
- No database, no auth, no bindings (no D1, KV, R2 or secrets declared).

### 1.4 `apps/desktop` (`opencut-desktop`)

- Rust binary using GPUI 0.2.2 (`apps/desktop/Cargo.toml`, `Cargo.lock:2055`). It is a native GPUI app, not Tauri or Electron.
- Transitive versions from `Cargo.lock` (704 packages): blade-graphics 0.7.1, cosmic-text 0.14.2, taffy 0.9.0, resvg 0.45.1, smol 2.0.2, metal 0.29.0, ash 0.38.0.
- Platform backends per `apps/desktop/README.md:20-25`: Metal on macOS, Win32 + DirectWrite on Windows, Vulkan (Blade) with Wayland or X11 on Linux.
- Tasks: `dev` (`cargo run`), `check`, `build` (`cargo build --release`, output `target/release/opencut-desktop`) (`apps/desktop/moon.yml`).
- Source: `main.rs`, `shell.rs`, `theme.rs`, `panels/{browser,inspector,preview,timeline}.rs`, `components/{badge,button,context_menu,label,resizable,separator}.rs`.
- Tests: 3 unit tests in `theme.rs:183-221`, 1 in `components/resizable.rs:160-169`.

### 1.5 `crates/media` (not a crate yet)

- Only `crates/media/setup/setup.ts` and `crates/media/setup/ffmpeg.json`.
- Referenced but absent from the clone: `build.rs` (`setup.ts:2`), `crates/media/setup/pin.ts` (`media-deps.yml:5`), a `media:setup` moon task (`setup.ts:5`; there is no `crates/media/moon.yml`), and any `Cargo.toml`.
- Intended role per comments: the Rust crate that decodes media with FFmpeg (`setup.ts:1`, `media-deps.yml:3`).
- FFmpeg pin: 8.1.3, LGPL-2.1-or-later, source tarball with SHA-256; prebuilt entries for windows-x86_64, windows-aarch64, linux-x86_64, linux-aarch64, all pointing at BtbN `lgpl-shared` builds. **No macOS entry**, so on macOS the script falls through to a source build (`setup.ts:198-199`).

### 1.6 Other top-level content

- `brand/marks/`: `icon.svg`, `logo-dark.svg`, `logo-light.svg`, `symbol-dark.svg`, `symbol-light.svg`.
- `changelog/`: `0.1.0.md`, `0.2.0.md`, `0.3.0.md` (YAML front matter only; describes the classic app).
- `.github/`: code of conduct, security policy (`security@opencut.app`), support, issue templates.
- `.gitignore` ignores `docs/`.

---

## 2. Feature inventory

### 2.1 Requested areas: status in the local clone

For every area below, the local repo was searched and the code is absent unless a row says otherwise.

| Area | Local code | Changelog claims (classic) |
|---|---|---|
| Projects (create, list, duplicate, delete, rename, thumbnails, settings) | NOT PRESENT | thumbnails, canvas size, background (2.4) |
| Media library | NOT PRESENT | clipboard paste import, grid cards, multi-select (2.4) |
| Timeline | STUB label only (`apps/desktop/src/panels/timeline.rs`) | extensive (2.4) |
| Preview / canvas | STUB label only (`apps/desktop/src/panels/preview.rs`) | extensive (2.4) |
| Text | NOT PRESENT | fonts, typography, background (2.4) |
| Stickers / shapes / graphics | NOT PRESENT | flags and shapes (2.4) |
| Audio | NOT PRESENT | volume, waveforms (2.4) |
| Effects, filters, masks, blend modes | NOT PRESENT | blur, masks, blend modes (2.4) |
| Transitions | NOT PRESENT | not mentioned anywhere locally |
| Keyframes / easing | NOT PRESENT | keyframes, graph editor (2.4) |
| Captions / transcription | NOT PRESENT | auto captions, transcript import (2.4) |
| Speed | NOT PRESENT | speed with maintain pitch (2.4) |
| Colour / adjustments | NOT PRESENT | not mentioned anywhere locally |
| Properties panel | STUB label only (`apps/desktop/src/panels/inspector.rs`) | extensive (2.4) |
| Export | NOT PRESENT | MP4 with audio (2.4) |
| Keyboard shortcuts and rebinding | NOT PRESENT. No keymap, no key handlers. The desktop context-menu item has a display-only `shortcut` string field (`context_menu.rs:21,51-60`) | Ctrl+Z, Escape, Shift, Ctrl modifiers mentioned (2.4). The full default binding list is UNVERIFIED |
| Settings | NOT PRESENT | settings panel with Background tab (2.4) |
| i18n / languages | NOT PRESENT. `<html lang="en">` hard-coded (`__root.tsx:52`); `direction.tsx` exists as an unused UI primitive | none |
| Auth / accounts | NOT PRESENT | none |
| Backend API | 3 demo routes (2.3) | none |
| DB schema | NOT PRESENT | none (classic has `apps/web/migrations` and `src/db`, see Appendix A) |
| Storage / persistence / migrations | NOT PRESENT | storage migrations v9 to v25, persistent-storage request (2.4) |
| Desktop app | Shell window with four placeholder panels (2.2) | "no features yet" (`changelog/0.3.0.md:110`) |
| AI features | NOT PRESENT | auto transcription only (2.4) |
| Onboarding | NOT PRESENT | none |
| Feedback | NOT PRESENT | none (classic has `src/feedback`, see Appendix A) |
| Media library "Browser" panel | STUB label only (`apps/desktop/src/panels/browser.rs`) | n/a |

### 2.2 VERIFIED: what the local code actually does

**Desktop window and shell**

- Opens one window titled "OpenCut", maximised, with a restore size of 960x600 centred (`apps/desktop/src/main.rs:35-44`).
- Layout: column; top row takes 2/3 height with Browser (1/4 width, right border, sidebar colours), Preview (1/2 width), Inspector (1/4 width, left border, card colours); Timeline takes the bottom 1/3 (`apps/desktop/src/shell.rs:31-47`, `panels/*.rs`). The split is fixed: `ResizablePanelGroup` is not used by the shell.
- Panels are entities created once so they keep state across renders (`shell.rs:6-8,17-24`).
- Theme follows the OS appearance and the window refreshes when appearance changes (`main.rs:47-50`, `theme.rs:50-59,144-148`). Light and dark palettes mirror the web oklch tokens, with an oklch to sRGB conversion (`theme.rs:61-181`). There is no manual theme switch.
- WSL workaround: when running under WSL with both `DISPLAY` and `WAYLAND_DISPLAY` set, `WAYLAND_DISPLAY` is removed before GPUI starts, because GPUI 0.2.2 needs `xdg_wm_base` v2+ and WSLg offers v1 (`main.rs:14-32`).

**Desktop component library (defined, not used by any panel)**

- `Button`: variants Default, Outline, Secondary, Ghost, Destructive, Link; sizes Default, XSmall, Small, Large and four icon sizes (heights 20/24/28/32 px); disabled state; full-width; focus ring; click handler that stops propagation (`components/button.rs`).
- `Badge`: variants Default, Secondary, Outline, Destructive (`components/badge.rs`).
- `Label`: normal, muted, disabled (`components/label.rs`).
- `Separator`: horizontal or vertical, 1px (`components/separator.rs`).
- `ResizablePanelGroup`: two panes, horizontal or vertical; drag the 5px handle to resize; fraction clamped to `[min, 1 - min]` with default minimum 0.1 (settable up to 0.49) and default split 0.5; double-click the handle resets to the initial fraction (`components/resizable.rs:18-89,122-127`).
- `ContextMenu`: opens at the pointer on right mouse button; entries with label, optional shortcut text, optional check mark, disabled state, destructive variant, select handler; label rows and separators; closes on outside mouse down or after activation; kept inside the window with an 8px margin; scrolls when taller than the viewport (`components/context_menu.rs`).

**Web app**

- Two routes, `/` and `/editor`, both placeholders (`apps/web/src/routes/`).
- Design tokens for light and dark (`apps/web/src/styles.css:51-118`); dark is defined under `.dark` but nothing applies that class.
- shadcn components present in `apps/web/src/components/ui/` (56): accordion, alert-dialog, alert, aspect-ratio, avatar, badge, breadcrumb, button-group, button, calendar, card, carousel, chart, checkbox, collapsible, combobox, command, context-menu, dialog, direction, drawer, dropdown-menu, empty, field, form, hover-card, input-group, input-otp, input, item, kbd, label, menubar, native-select, navigation-menu, pagination, popover, progress, radio-group, resizable, scroll-area, select, separator, sheet, sidebar, skeleton, slider, sonner, spinner, switch, table, tabs, textarea, toggle-group, toggle, tooltip. Their bodies were not reviewed; they are generic kit components, not editor features.
- `useIsMobile()` hook at a 768px breakpoint (`apps/web/src/hooks/use-mobile.ts`), unused.

**FFmpeg provisioning (`crates/media/setup/setup.ts`)**

- Installs the pinned FFmpeg into `.cache/media/ffmpeg-<version>-<os>-<arch>`; idempotent through a `.complete` stamp that encodes the prebuilt SHA-256, or the source SHA-256 plus a hash of the configure flags (`setup.ts:201-212`).
- Downloads are SHA-256 verified (`setup.ts:57-67`).
- Builds in a `.partial` staging directory and renames into place, so an interrupted run never looks complete (`setup.ts:214-227`).
- Chooses a source build when `--from-source` is passed, when cross-compiling, or when no prebuilt exists for the platform (`setup.ts:199`).
- Configure flags: `--enable-shared --disable-static --disable-programs --disable-doc --disable-avdevice --disable-avfilter --disable-network --disable-autodetect` (`setup.ts:89-98`). So the intended media layer uses libavcodec/libavformat/libavutil/libswscale/libswresample only, with no filters, devices or network protocols.
- Windows builds cross-compile from Linux with llvm-mingw and use w32threads; macOS targets 11.0+ with `@rpath` install names; Linux builds only natively; x86_64 without nasm disables assembly (`setup.ts:101-136`).
- Writes `COPYING.LGPLv2.1`, `LICENSE.md` and a `BUILD.md` recipe next to the libraries (`setup.ts:163-180`).

### 2.3 Backend API routes (VERIFIED, complete list)

`apps/api/src/index.ts`:

| Method | Path | Behaviour |
|---|---|---|
| GET | `/` | returns `{ status: "ok" }` |
| GET | `/health` | returns `{ healthy: true, timestamp: <ISO string> }` |
| POST | `/echo` | body validated as `{ message: string }`; returns the body |

No auth, no database, no schema.

### 2.4 CHANGELOG-ONLY features (describe opencut-classic; UNVERIFIED against code)

Each line is a user-facing claim from the local changelog. Paths, behaviours and edge rules behind them could not be checked.

**From `changelog/0.1.0.md` (2026-02-23, "Editor foundation")**

- Properties panel number inputs accept math expressions and click-drag scrubbing (l.10).
- Properties panel sections: transform, blending, typography, spacing, background; text elements have position, scale, rotation (l.12).
- Colour picker with eyedropper, opacity and multiple colour formats (l.14).
- Bookmarks with notes, colour labels and optional duration (l.16).
- Move, scale and rotate elements directly in the preview (l.18).
- Blend modes (Multiply, Screen, Overlay, "etc"), text elements only at that version (l.20). The full mode list is UNVERIFIED.
- Paste images, video or audio from the clipboard into the editor (l.22).
- Hold Shift while moving or resizing to disable snapping temporarily (l.24).
- Over 1,000 fonts; faster font loading (l.26-28).
- Asset panel tabs share one layout (l.30).
- Multi-line text, line height, letter spacing (l.32).
- Dark theme (l.34).
- Drag-and-drop additions are undoable (l.36).

**From `changelog/0.2.0.md` (2026-03-01, "Motion & effects")**

- Keyframe animation of element properties (l.10).
- Effects system: effects per clip or as standalone timeline elements; first effect is Blur (l.12).
- Changelog page on the site (l.14).
- Ripple editing mode (l.16).
- Drag-selection is confined to the intended track (l.18).
- Audio scheduler recovers from timing slips (l.20).
- Dropping a clip that creates a track is one undo step (Ctrl+Z) (l.22).
- New text has no background by default (l.26).
- Dashed selection outline in preview (l.28).
- Small visual gap between adjacent clips (l.30).
- Trim handles sit outside the clip (l.32).
- Dragged clips render above others (l.34).
- Undo of trim-from-start restores position and length (l.36).
- Clip stays selected after resize, after moving to another track, and when the mouse is released over empty space (l.38, 44, 46).
- Escape deselects (l.40).
- Resize stops at the next clip's edge; no overlap on a track (l.42).

**From `changelog/0.3.0.md` (2026-04-15, "Masks, animation & more")**

- Brand page with downloadable assets; also from the header logo context menu (l.10).
- Changelog link in the footer; sponsor logos invert in dark mode (l.12-14).
- Media asset grid cards sized to thumbnails (l.16).
- Playback performance and audio stutter fixes (l.18).
- Project thumbnails generate for empty timelines and reflect background colour or gradient (l.20).
- Clicking a selected element collapses the selection to it (l.22).
- Shift or Ctrl with drag-select adds to the selection; Shift/Ctrl+click multi-select (l.28).
- Track rows highlight when they contain a selected element (l.30).
- Clicking empty space below tracks seeks the playhead (l.32).
- Timeline vertical scroll anywhere in the panel; header stays fixed (l.34).
- Separate width and height scale (l.36).
- System fonts alongside Google Fonts in the font picker (l.38).
- MP4 export with audio, including on Firefox (l.40).
- Requests persistent browser storage so projects survive low disk space (l.42).
- Tabbed properties panel (l.44).
- Volume control for audio and video elements (l.46).
- Speed control for video and audio with a maintain-pitch option (l.48).
- RMS-based audio waveforms, rendered only for the visible range (l.50).
- Timeline opens scrolled to the bottom so the main track is visible (l.52).
- Snap guides in preview, including centre snap for full-canvas elements (l.54).
- Rotation handle clipped to the preview area and kept at a fixed gap (l.56, 88).
- Blur at 0% leaves the image unchanged when a blurred background is active (l.58).
- Masks on video and image layers: split, rectangle, ellipse, star, heart, diamond, cinematic bars; position, size, rotation, feather, stroke; handles in preview (l.62).
- Redesigned settings panel (l.64).
- Canvas background: blur, solid colour or gradient, in a Background tab of settings (l.66).
- Custom canvas width and height in addition to presets (l.70).
- Preview zoom and panning (l.72).
- Stickers panel with country flags and shapes (l.74).
- Multi-select in the assets panel, for example to delete several (l.76).
- Auto-generated captions (l.78).
- Import a transcript file to generate captions (l.80).
- Graph editor for keyframe curves with bezier handles (l.82).
- Text handles stay put while typing (l.84).
- Multiple selected clips move and resize together (l.86).
- Position X and Y animate independently (l.90).
- Copy and paste keyframes between elements (l.92).
- "Expand keyframes" clip context action shows one lane per animated property (l.94).
- Notice when the browser lacks GPU-accelerated rendering (l.96).
- Technical: diff-based ripple (`src/lib/ripple/`, `RippleAdjustment`) (l.98).
- Technical: `MediaTime` integer ticks at 120,000 per second; `FrameRate` rational; frame snapping and timecode in Rust via WASM (l.100).
- Technical: `SceneTracks` with `overlay`, `main` (single `VideoTrack`) and `audio` (l.102).
- Technical: Rust/wgpu compositor compiled to WASM replacing WebGL; crates compositor, effects, masks (JFA feathering), gpu, time; bindings in `rust/wasm/` (l.104).
- Technical: deploy to Cloudflare Workers via OpenNext (l.108).
- Technical: storage migrations v9 through v25 (l.112).

Not mentioned in any local file, therefore status unknown: transitions, colour adjustments, filters other than blur, sounds library, fades, audio separation, export settings (codec, quality, resolution, fps, cancel), shortcut rebinding, i18n, auth, onboarding, feedback, project duplicate/rename, media folders/sort/search, track mute/hide/lock, split, copy/paste/duplicate of clips, timeline zoom, fullscreen.

### 2.5 ROADMAP items for the rewrite (README only, no code)

`README.md:21-26`:

- Editor API. ROADMAP.
- First-class third-party plugins (plugin-first architecture). ROADMAP.
- Desktop, mobile and browser from one codebase with a Rust core. PARTIAL: desktop and web shells exist as stubs; no shared core, no mobile app.
- MCP server for AI agents. ROADMAP.
- Headless mode for automation and batch rendering. ROADMAP.
- Scripting tab in the editor. ROADMAP.

---

## 3. Data model

**No project, scene, track, element, keyframe, effect or media-asset types exist in the local clone.** There is nothing to copy verbatim for those.

The only domain-adjacent definitions present locally:

```ts
// crates/media/setup/setup.ts:29-30
type Download = { url: string; sha256: string };
type Platform = { os: "windows" | "macos" | "linux"; arch: "x86_64" | "aarch64" };
```

```rust
// apps/desktop/src/theme.rs:40-44 (SemanticColors has 31 Hsla tokens, theme.rs:6-38)
pub struct Theme {
    pub colors: SemanticColors,
    pub radius: Rems,
}
```

```rust
// apps/desktop/src/components/context_menu.rs:18-29
pub(crate) enum ContextMenuItem {
    Entry {
        label: SharedString,
        shortcut: Option<SharedString>,
        checked: Option<bool>,
        disabled: bool,
        variant: ContextMenuItemVariant,
        on_select: SelectHandler,
    },
    Label(SharedString),
    Separator,
}
```

```rust
// apps/desktop/src/components/resizable.rs:22-29
pub(crate) struct ResizablePanelGroup {
    orientation: Orientation,
    first: AnyView,
    second: AnyView,
    initial_fraction: f32,
    fraction: f32,
    minimum_fraction: f32,
}
```

Data-model facts stated in prose by the changelog about classic (CHANGELOG-ONLY, shapes not available verbatim):

- `MediaTime`: integer tick count, 120,000 ticks per second. 23.976 fps = 5,005 ticks/frame, 29.97 = 4,004, 30 = 4,000 (`changelog/0.3.0.md:100`).
- `FrameRate`: rational `{numerator, denominator}` (same line).
- `SceneTracks`: `{ overlay, main, audio }` where `main` is a single `VideoTrack` (`changelog/0.3.0.md:102`).
- `RippleAdjustment`: explicit adjustment values produced by diffing track snapshots as interval sets (`changelog/0.3.0.md:98`).
- Bookmarks carry note, colour and optional duration (`changelog/0.1.0.md:16`).
- Storage schema version reached v25 (`changelog/0.3.0.md:112`).

---

## 4. Rendering and export pipeline

**Local clone: none.** There is no compositor, no decoder binding, no encoder, no wasm module and no export code. `wgpu` does not appear in `Cargo.lock`.

What the local repo does establish about the rewrite's intended pipeline:

- Decoding is planned through a Rust `media` crate linking shared LGPL FFmpeg 8.1.3 (`crates/media/setup/setup.ts:1-3`, `.github/workflows/media-deps.yml:3-6`).
- FFmpeg is built without avfilter, avdevice, network and without external-library autodetection (`setup.ts:89-98`). No GPL or nonfree components are enabled, so encoders such as libx264 are not part of this build. Which encoders the rewrite will use for export is UNVERIFIED.
- The desktop UI renders with GPUI (Metal, Vulkan via Blade, or Win32), which is UI rendering, not video compositing.

What the changelog says about classic (CHANGELOG-ONLY):

- Compositing: Rust/wgpu compositor compiled to WASM; effects and masks in Rust; mask feathering by jump flooding (`changelog/0.3.0.md:104`).
- Time arithmetic, frame snapping and timecode formatting: Rust via WASM (`changelog/0.3.0.md:100`).
- TypeScript consumes the wasm through `src/lib/wasm/` (`changelog/0.3.0.md:104`).
- Export produces MP4 with audio in the browser (`changelog/0.3.0.md:40`). The encoder (WebCodecs, a muxer library, or other), codec options and the Rust/TS split for encoding are UNVERIFIED.
- Audio playback uses a scheduler (`changelog/0.2.0.md:20`); speed changes offer pitch preservation (`changelog/0.3.0.md:48`).

---

## 5. Licence and attribution

- **OpenCut (this repo): MIT**, "Copyright 2026 OpenCut" (`LICENSE`; `Cargo.toml:11`). Obligation when copying or porting substantial portions: keep the copyright notice and the permission notice in copies.
- **opencut-classic**: GitHub API reports SPDX `MIT`. Its `LICENSE` text and copyright line were not read. UNVERIFIED beyond the SPDX id.
- **FFmpeg 8.1.3: LGPL-2.1-or-later**, shared libraries (`crates/media/setup/ffmpeg.json:3`). If JAgentChill ships these builds: link dynamically, ship the licence texts and the build recipe, and allow the user to replace the libraries. The setup script already writes `COPYING.LGPLv2.1`, `LICENSE.md` and `BUILD.md` beside the libraries for this purpose (`setup.ts:139-141,163-180`).
- **Brand assets** (`brand/marks/*.svg`, name "OpenCut"): no file in the clone grants trademark or brand-reuse rights. Do not reuse the name or marks in JAgentChill. Whether the MIT grant is meant to cover the SVG files is UNVERIFIED.
- **Fonts loaded by the web shell**: Inter Variable via `@fontsource-variable/inter`; Playfair Display from Google Fonts (`styles.css:4,9-10`, `__root.tsx:37-40`). Their licences were not checked here.
- **Third-party UI code**: shadcn-generated components, Base UI, Radix, hugeicons, lucide. Licences not checked here; verify before copying the generated files.
- **GPUI 0.2.2** and the 704 crates in `Cargo.lock`: licences not audited.
- Sponsor mention in README (fal.ai) creates no obligation for a port.

---

## 6. PORT-CHECKLIST

Three groups. Only group L is verified in local code. Group C is the feature list the port actually cares about, and it is incomplete and unverified until `opencut-classic` is inventoried.

### L: VERIFIED in the local clone

- [ ] L-01 Desktop: single main window titled "OpenCut"
- [ ] L-02 Desktop: window opens maximised, restore size 960x600 centred
- [ ] L-03 Desktop: four-panel shell layout (Browser, Preview, Inspector top row at 2/3 height; Timeline bottom 1/3)
- [ ] L-04 Desktop: Browser panel placeholder (1/4 width)
- [ ] L-05 Desktop: Preview panel placeholder (1/2 width)
- [ ] L-06 Desktop: Inspector panel placeholder (1/4 width)
- [ ] L-07 Desktop: Timeline panel placeholder
- [ ] L-08 Desktop: panels persist as entities across renders
- [ ] L-09 Desktop: light/dark theme follows OS appearance
- [ ] L-10 Desktop: live refresh when OS appearance changes
- [ ] L-11 Desktop: semantic colour token set (31 tokens) shared with web palette
- [ ] L-12 Desktop: oklch to sRGB colour conversion
- [ ] L-13 Desktop: WSL/WSLg Wayland fallback to X11
- [ ] L-14 Desktop component: Button with 6 variants
- [ ] L-15 Desktop component: Button with 8 sizes including icon sizes
- [ ] L-16 Desktop component: Button disabled, full-width, focus ring
- [ ] L-17 Desktop component: Badge with 4 variants
- [ ] L-18 Desktop component: Label (normal, muted, disabled)
- [ ] L-19 Desktop component: Separator (horizontal, vertical)
- [ ] L-20 Desktop component: two-pane resizable group, horizontal or vertical
- [ ] L-21 Desktop component: resize by dragging handle, clamped to minimum fraction
- [ ] L-22 Desktop component: double-click handle resets split
- [ ] L-23 Desktop component: context menu opens on right click at pointer
- [ ] L-24 Desktop component: context menu entry with shortcut hint text
- [ ] L-25 Desktop component: context menu checkable entry
- [ ] L-26 Desktop component: context menu disabled entry
- [ ] L-27 Desktop component: context menu destructive entry
- [ ] L-28 Desktop component: context menu label rows and separators
- [ ] L-29 Desktop component: context menu closes on outside click and after selection
- [ ] L-30 Desktop component: context menu stays within window and scrolls when tall
- [ ] L-31 Web: route `/` placeholder
- [ ] L-32 Web: route `/editor` placeholder ("Coming soon")
- [ ] L-33 Web: SSR document shell with head metadata and favicon
- [ ] L-34 Web: light and dark design tokens (dark not switchable yet)
- [ ] L-35 Web: Inter body font and Playfair Display heading font
- [ ] L-36 Web: shadcn UI kit of 56 components available
- [ ] L-37 Web: global tooltip provider
- [ ] L-38 Web: `useIsMobile` hook (768px)
- [ ] L-39 Web: route preloading on intent and scroll restoration
- [ ] L-40 Web: Cloudflare Workers deployment
- [ ] L-41 API: `GET /` status
- [ ] L-42 API: `GET /health` with timestamp
- [ ] L-43 API: `POST /echo` with body validation
- [ ] L-44 API: Cloudflare Workers deployment
- [ ] L-45 Media setup: pinned FFmpeg version with checksums
- [ ] L-46 Media setup: prebuilt install for Windows and Linux (x86_64, aarch64)
- [ ] L-47 Media setup: build from source, including macOS and cross builds
- [ ] L-48 Media setup: idempotent install with stamp file
- [ ] L-49 Media setup: atomic staging directory
- [ ] L-50 Media setup: LGPL licence and build recipe shipped with libraries
- [ ] L-51 CI: `moon ci` on Linux, Windows, macOS
- [ ] L-52 CI: manual FFmpeg build and prerelease publication for 6 platforms
- [ ] L-53 Tooling: brand logo upload to R2

### C: CHANGELOG-ONLY (classic; UNVERIFIED against code)

- [ ] C-01 Properties: number inputs accept math expressions
- [ ] C-02 Properties: click-drag scrubbing on number inputs
- [ ] C-03 Properties: transform section (position, scale, rotation)
- [ ] C-04 Properties: blending section
- [ ] C-05 Properties: typography section
- [ ] C-06 Properties: spacing section
- [ ] C-07 Properties: background section for text
- [ ] C-08 Properties: tabbed layout
- [ ] C-09 Properties: separate width and height scale
- [ ] C-10 Colour picker: eyedropper
- [ ] C-11 Colour picker: opacity
- [ ] C-12 Colour picker: multiple colour formats
- [ ] C-13 Bookmarks: notes
- [ ] C-14 Bookmarks: colour labels
- [ ] C-15 Bookmarks: optional duration
- [ ] C-16 Preview: move elements directly
- [ ] C-17 Preview: scale elements directly
- [ ] C-18 Preview: rotate elements directly, rotation handle
- [ ] C-19 Preview: dashed selection outline
- [ ] C-20 Preview: snap guides including centre snap
- [ ] C-21 Preview: Shift disables snapping while moving or resizing
- [ ] C-22 Preview: zoom
- [ ] C-23 Preview: pan when zoomed
- [ ] C-24 Preview: mask handles
- [ ] C-25 Preview: notice when GPU rendering is unsupported
- [ ] C-26 Blend modes (Multiply, Screen, Overlay, others)
- [ ] C-27 Media: paste image, video or audio from clipboard
- [ ] C-28 Media: asset grid with thumbnails
- [ ] C-29 Media: multi-select assets and bulk delete
- [ ] C-30 Asset panel: tabs with a shared layout
- [ ] C-31 Text: 1,000+ Google fonts
- [ ] C-32 Text: system fonts in the picker
- [ ] C-33 Text: multi-line
- [ ] C-34 Text: line height
- [ ] C-35 Text: letter spacing
- [ ] C-36 Text: optional background, none by default
- [ ] C-37 Theme: dark theme
- [ ] C-38 Undo/redo, including drag-and-drop additions
- [ ] C-39 Undo: clip drop plus auto-created track is one step
- [ ] C-40 Undo: trim-from-start restores position and length
- [ ] C-41 Keyframes: animate element properties
- [ ] C-42 Keyframes: independent position X and Y
- [ ] C-43 Keyframes: copy and paste between elements
- [ ] C-44 Keyframes: graph editor with bezier handles
- [ ] C-45 Keyframes: expand per-property lanes on a clip ("Expand keyframes")
- [ ] C-46 Effects: per-clip effects
- [ ] C-47 Effects: standalone effect elements on the timeline
- [ ] C-48 Effects: Blur
- [ ] C-49 Timeline: ripple editing mode
- [ ] C-50 Timeline: drag (marquee) selection confined to intended tracks
- [ ] C-51 Timeline: Shift/Ctrl+click multi-select
- [ ] C-52 Timeline: Shift/Ctrl with marquee adds to selection
- [ ] C-53 Timeline: clicking a selected element collapses the selection
- [ ] C-54 Timeline: Escape deselects
- [ ] C-55 Timeline: multiple selected clips move together
- [ ] C-56 Timeline: multiple selected clips resize together
- [ ] C-57 Timeline: trim handles outside the clip
- [ ] C-58 Timeline: resize stops at the neighbouring clip (no overlap)
- [ ] C-59 Timeline: move clips between tracks, selection kept
- [ ] C-60 Timeline: dropping a clip can create a track
- [ ] C-61 Timeline: dragged clip renders on top
- [ ] C-62 Timeline: gap between adjacent clips
- [ ] C-63 Timeline: track row highlight for selection
- [ ] C-64 Timeline: click empty area to seek
- [ ] C-65 Timeline: vertical scroll with fixed header
- [ ] C-66 Timeline: opens scrolled to the main track
- [ ] C-67 Timeline: track model with overlay tracks, one main video track, audio tracks
- [ ] C-68 Timeline: track labels column
- [ ] C-69 Audio: volume for audio and video elements
- [ ] C-70 Audio: RMS waveforms, visible-range rendering
- [ ] C-71 Audio: playback scheduler resilient to timing slips
- [ ] C-72 Speed: clip speed for video and audio
- [ ] C-73 Speed: maintain pitch
- [ ] C-74 Masks: split
- [ ] C-75 Masks: rectangle
- [ ] C-76 Masks: ellipse
- [ ] C-77 Masks: star
- [ ] C-78 Masks: heart
- [ ] C-79 Masks: diamond
- [ ] C-80 Masks: cinematic bars
- [ ] C-81 Masks: position, size, rotation
- [ ] C-82 Masks: feather
- [ ] C-83 Masks: stroke
- [ ] C-84 Canvas: preset sizes
- [ ] C-85 Canvas: custom width and height
- [ ] C-86 Canvas background: blur
- [ ] C-87 Canvas background: solid colour
- [ ] C-88 Canvas background: gradient
- [ ] C-89 Settings panel with Background tab
- [ ] C-90 Stickers: country flags
- [ ] C-91 Stickers: shapes
- [ ] C-92 Captions: auto transcription
- [ ] C-93 Captions: import transcript file
- [ ] C-94 Export: MP4 with audio, cross-browser
- [ ] C-95 Projects: thumbnails, including empty timelines
- [ ] C-96 Storage: request persistent browser storage
- [ ] C-97 Storage: versioned schema migrations (through v25)
- [ ] C-98 Time: integer tick time base (120,000/s) and rational frame rates
- [ ] C-99 Time: frame snapping and timecode formatting
- [ ] C-100 Rendering: GPU compositor (Rust/wgpu in WASM)
- [ ] C-101 Site: changelog page
- [ ] C-102 Site: brand page with downloadable assets
- [ ] C-103 Site: header logo context menu for brand assets
- [ ] C-104 Site: footer with changelog link, sponsor logos
- [ ] C-105 Desktop (classic): GPUI app scaffold with no features

### R: ROADMAP (rewrite; no code)

- [ ] R-01 Editor API
- [ ] R-02 Third-party plugin system
- [ ] R-03 Shared Rust core across desktop, mobile, browser
- [ ] R-04 Mobile app
- [ ] R-05 MCP server for AI agents
- [ ] R-06 Headless mode and batch rendering
- [ ] R-07 In-editor scripting tab

Totals: L = 53, C = 105, R = 7, overall 165 lines. Of these, only the 53 L lines are code-verified, and none of them is a video-editing feature.

---

## Appendix A: directory map of `opencut-app/opencut-classic` (listing only, contents not read)

Obtained from the GitHub tree API on 2026-10-05 at commit `cf5e79e919144200294fb9fed22a222592a0aeea`. Numbers are file counts aggregated at up to four path segments. This is where the follow-up inventory should look; nothing here has been opened.

| Path (prefix `classic:`) | Files | Likely area (inferred from name only) |
|---|---|---|
| `apps/web/src/timeline` | 120 | timeline |
| `apps/web/src/services` | 141 | services (unknown split) |
| `apps/web/src/components` | 99 | UI |
| `apps/web/src/commands` | 63 | command/undo system |
| `apps/web/src/app` | 46 | routes (framework UNVERIFIED) |
| `apps/web/src/masks` | 30 | masks |
| `apps/web/src/preview` | 27 | preview |
| `apps/web/src/actions` | 24 | actions/shortcuts |
| `apps/web/src/animation` | 18 | keyframes |
| `apps/web/src/stickers` | 18 | stickers |
| `apps/web/src/selection` | 14 | selection |
| `apps/web/src/core` | 14 | editor core |
| `apps/web/src/graphics` | 13 | graphics/shapes |
| `apps/web/src/media` | 11 | media |
| `apps/web/src/utils` | 11 | utilities |
| `apps/web/src/guides` | 10 | guides |
| `apps/web/src/changelog` | 10 | changelog |
| `apps/web/src/effects` | 9 | effects |
| `apps/web/src/retime` | 9 | retiming |
| `apps/web/src/hooks` | 9 | hooks |
| `apps/web/src/subtitles` | 8 | subtitles |
| `apps/web/src/transcription` | 8 | transcription |
| `apps/web/src/text` | 7 | text |
| `apps/web/src/clipboard` | 6 | clipboard |
| `apps/web/src/project` | 6 | projects |
| `apps/web/src/editor`, `feedback`, `fps`, `sounds` | 5 each | editor, feedback, fps, sounds |
| `apps/web/src/data`, `fonts`, `params`, `ripple`, `site` | 4 each | |
| `apps/web/src/auth`, `export`, `gradients` | 3 each | auth, export, gradients |
| `apps/web/src/background`, `blog`, `db`, `diagnostics`, `rendering`, `speed`, `types`, `wasm` | 2 each | |
| `apps/web/src/canvas`, `env`, `panels` | 1 each | |
| `apps/web/src` (files directly inside) | 48 | |
| `apps/web/migrations` (+ `meta`) | 4 | DB migrations |
| `apps/web/public/flags` | 271 | flag stickers |
| `apps/web/public/icons`, `fonts`, `logos`, `shapes`, `effects`, `open-graph`, `platform-guides` | 22, 16, 13, 6, 1, 3, 1 | static assets |
| `apps/desktop` (+ `script`, `src`) | 7 | desktop scaffold |
| `rust/crates/compositor` | 12 | compositor |
| `rust/crates/masks` | 9 | masks |
| `rust/crates/effects` | 7 | effects |
| `rust/crates/gpu` | 7 | GPU context |
| `rust/crates/time` | 6 | time |
| `rust/crates/bridge` | 3 | bridge |
| `rust/wasm` (+ `src`) | 9 | wasm bindings |
| `docs`, `notes`, `eslint`, `script` | 4, 1, 4, 2 | |

The names `auth`, `db`, `migrations`, `feedback`, `sounds`, `subtitles`, `transcription`, `export`, `retime` and `actions` indicate that the areas reported as "NOT PRESENT" in section 2.1 do exist in classic. Their behaviour is UNVERIFIED until that repository is read.
