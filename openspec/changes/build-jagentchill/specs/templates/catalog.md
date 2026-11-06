# templates — normative catalogue

This file is normative for `templates` (cited by the requirements "Template gallery" and "Bundled templates are original content"). Everything listed is authored for JAgentChill. Ids are stable. Bundled templates live in `packages/content/templates/<id>/` (`manifest.json`, `project.json`, `thumbnail.jpg`, `preview.mp4`); the build check compares each manifest with its row here and renders the previews.

Cross-catalogue ids used below: text templates and text animations — `text-and-titles/catalog.md`; transitions — `transitions.Bundled transition library`; music — the catalogue of `audio-editing.Bundled sound pack`. The build fails when a referenced id does not exist there.

## 1. Demo media set (12)

Demo media exists only to render the previews and thumbnails of bundled templates. Each item is a procedural scene defined in `packages/content/demo/<id>.json` (shapes, colours, motion and a fixed random seed) and rendered deterministically at build time by `scripts/render-demo-media` with the engine, at the canvas size of the template that uses it. Licence: CC0-1.0, author "JAgentChill project"; the directory has one row in the asset provenance file. No photograph, footage or third-party artwork is used.

| # | id | Kind | Length | Content |
|---|---|---|---|---|
| 1 | `demo-gradient-warm` | video | 6 s loop | linear gradient `#ff9500` → `#ff2d92` whose angle turns from 0° to 90° |
| 2 | `demo-gradient-cool` | video | 6 s loop | linear gradient `#009dff` → `#af52de` whose angle turns from 90° to 180° |
| 3 | `demo-gradient-green` | video | 6 s loop | radial gradient `#d4ff3b` → `#34c759` whose centre drifts from left to right |
| 4 | `demo-circles` | video | 6 s loop | 12 soft-edged circles in `#ffd400`, `#ff9500`, `#ff2d92` drifting upward on `#111111` |
| 5 | `demo-stripes` | video | 4 s loop | diagonal stripes `#ffd400` / `#111111`, 8 % of the long side wide, scrolling at 45° |
| 6 | `demo-grid` | video | 6 s loop | perspective grid of `#1e6bff` lines on `#050510` moving toward the viewer |
| 7 | `demo-waves` | video | 6 s loop | three sine bands `#009dff`, `#1e6bff`, `#001a4d` scrolling horizontally at different speeds |
| 8 | `demo-blobs` | video | 8 s loop | four blurred blobs `#ff3b30`, `#ff9500`, `#ffcc00`, `#af52de` orbiting the centre on `#1a1a1a` |
| 9 | `demo-sunrise` | video | 8 s | a `#ffcc00` disc rising over three horizon bands `#ff9500`, `#c0392b`, `#2c1a4d` |
| 10 | `demo-skyline` | video | 8 s loop | three parallax layers of rectangles (`#2c2c2e`, `#48484a`, `#636366`) scrolling left under a `#0a84ff` → `#5ac8fa` sky |
| 11 | `demo-confetti` | video | 5 s loop | 80 small rectangles in six hues falling and rotating on `#ffffff` |
| 12 | `demo-paper` | image | — | off-white `#f5f0e6` field with procedural paper grain (value noise, amplitude 3 %) |

## 2. Bundled project templates (12)

All templates use 30 fps. "Slots" lists, per slot index, the accepted type, the timeline duration and whether it is required (R) or not (O); every slot is on the main track unless stated. "Texts" lists each editable text as label «sample text» → the text template (id from `text-and-titles/catalog.md` section 5) whose look it uses, its time range, and `maxLength`. Music is one audio slot starting at 0 s, trimmed to the template duration with a 1 s fade-out; "replaceable" as stated. Transitions are named by id with their duration; cuts not listed are hard cuts. "Demo" lists the demo media used per slot for the preview, in slot order.

| # | id | Name | Category | Canvas | Duration | Slots | Music | Theme colours |
|---|---|---|---|---|---|---|---|---|
| 1 | `vlog-day` | Day in my life | Vlog | 1080×1920 (9:16) | 15 s | 6 | `mus-happy-01`, replaceable | `#ffd400`, `#111111` |
| 2 | `vlog-travel` | Travel recap | Vlog | 1920×1080 (16:9) | 20 s | 7 | `mus-chill-03`, replaceable | `#ffffff`, `#009dff` |
| 3 | `promo-product` | Product spotlight | Promo | 1080×1080 (1:1) | 12 s | 4 | `mus-corporate-01`, replaceable | `#1e6bff`, `#ffffff`, `#ff3b30` |
| 4 | `promo-sale` | Flash sale | Promo | 1080×1920 (9:16) | 10 s | 3 | `mus-upbeat-03`, replaceable | `#ffcc00`, `#ff2d92`, `#111111` |
| 5 | `slideshow-memories` | Memories | Slideshow | 1920×1080 (16:9) | 24 s | 8 | `mus-cinematic-01`, replaceable | `#ffffff`, `#ffd400` |
| 6 | `slideshow-story` | Photo story | Slideshow | 1080×1350 (4:5) | 15 s | 5 | `mus-lofi-02`, replaceable | `#fff8e7`, `#ffd400` |
| 7 | `intro-channel` | Channel intro | Intro and outro | 1920×1080 (16:9) | 6 s | 1 | `mus-upbeat-01`, replaceable | `#ff2d92`, `#ffffff` |
| 8 | `outro-end-screen` | End screen | Intro and outro | 1920×1080 (16:9) | 8 s | 2 | `mus-chill-01`, replaceable | `#ff2d92`, `#ffd400`, `#111111` |
| 9 | `short-hook` | Hook and reveal | Social short | 1080×1920 (9:16) | 9 s | 3 | `mus-dramatic-05`, replaceable | `#ffffff`, `#ff3b30` |
| 10 | `short-top-three` | Top three | Social short | 1080×1920 (9:16) | 12 s | 3 | `mus-upbeat-05`, replaceable | `#1e6bff`, `#ffffff` |
| 11 | `quote-card` | Quote of the day | Quote | 1080×1080 (1:1) | 8 s | 1 | `mus-ambient-01`, replaceable | `#ffd400`, `#ffffff` |
| 12 | `event-countdown` | Event countdown | Other | 1920×1080 (16:9) | 10 s | 2 | `mus-cinematic-04`, replaceable | `#1e6bff`, `#ffffff` |

Aspect ratios: 9:16 — 1, 4, 9, 10; 16:9 — 2, 5, 7, 8, 12; 1:1 — 3, 11; 4:5 — 6.

### Structure of each template

1. **`vlog-day`** — Slots: 1 video 3 s R; 2 video 2 s R; 3 video 2 s R; 4 any 2 s O; 5 video 3 s R; 6 any 3 s O. Transitions: `cross-dissolve` 0.5 s at cut 1–2; `whip-pan` 0.4 s (direction left) at cuts 2–3 and 4–5. Texts: Title «A day in my life» → `title-outline`, 0–3 s, 30; Closing line «See you tomorrow» → `subtitle-plain`, 12–15 s, 40. Tags: vlog, daily, vertical. Demo: `demo-gradient-warm`, `demo-circles`, `demo-stripes`, `demo-blobs`, `demo-waves`, `demo-sunrise`.
2. **`vlog-travel`** — Slots: 1 video 4 s R; 2 video 3 s R; 3 any 2 s R; 4 any 2 s O; 5 video 3 s R; 6 any 3 s O; 7 video 3 s R. Transitions: `push` 0.5 s (direction left) at every cut. Texts: Title «Somewhere new» → `title-stack` (main title), 0–4 s, 30; Subtitle «Three days, one city» → `title-stack` (subtitle), 0–4 s, 40; Place «City, Country» → `lower-third-minimal` (first line), 4–8 s, 40; Date «June 2026» → `lower-third-minimal` (second line), 4–8 s, 30. Tags: travel, trip, recap. Demo: `demo-sunrise`, `demo-skyline`, `demo-waves`, `demo-gradient-cool`, `demo-grid`, `demo-gradient-green`, `demo-blobs`.
3. **`promo-product`** — Slots: 1 any 3 s R; 2 any 3 s R; 3 any 3 s O; 4 any 3 s R. Transitions: `zoom-in` 0.4 s at every cut. Every slot has scale keyframes 1.00 → 1.06 over its duration (linear). Texts: Product name «Product name» → `title-clean`, 0–3 s, 30; Tagline «One line about why it is great» → `subtitle-boxed`, 3–9 s, 50; Price «$19» → `callout-tag`, 9–12 s, 8. Tags: product, promo, square. Demo: `demo-paper`, `demo-gradient-cool`, `demo-circles`, `demo-gradient-warm`.
4. **`promo-sale`** — Slots: 1 any 3 s R; 2 any 3 s R; 3 any 4 s O. Transitions: `flash` 0.3 s at cut 1–2; `color-bars` 0.5 s (direction up) at cut 2–3. Texts: Headline «FLASH SALE» → `title-outline`, 0–3 s, 20; Offer «50% off today» → `callout-warning`, 3–6 s, 24; Call to action «Shop now» → `social-follow`, 6–10 s, 20. Tags: sale, promo, offer. Demo: `demo-stripes`, `demo-confetti`, `demo-gradient-warm`.
5. **`slideshow-memories`** — Slots: 1–8 image 3 s each; 1–4 R, 5–8 O. Transitions: `cross-dissolve` 1.0 s at every cut. Every slot has scale keyframes 1.00 → 1.08 over its duration (linear). Texts: Title «Our memories» → `title-cinema`, 0–6 s, 30; Date «2026» → `title-clean` at position (0, 36) with `fontSize` 5, 18–24 s, 30. Tags: photos, memories, slideshow. Demo: `demo-paper`, `demo-sunrise`, `demo-gradient-warm`, `demo-waves`, `demo-gradient-green`, `demo-blobs`, `demo-gradient-cool`, `demo-skyline` (the first frame of each video item is used for image slots).
6. **`slideshow-story`** — Slots: 1–5 image 3 s each; 1–3 R, 4–5 O. Transitions: `slide` 0.5 s (direction up) at every cut. Texts: Caption «A little story» → `quote-classic` (quote line), 0–6 s, 60; Author «— You» → `quote-classic` (author line), 0–6 s, 30. Tags: photos, story, portrait. Demo: `demo-paper`, `demo-gradient-warm`, `demo-circles`, `demo-gradient-green`, `demo-sunrise`.
7. **`intro-channel`** — Slots: 1 any 6 s O (background, full canvas, with a full-canvas rectangle `#00000080` above it). Texts: Channel name «Your channel» → `title-neon`, 0–6 s, 20; Tagline «New videos every week» → `subtitle-plain`, 2–6 s, 40. Tags: intro, opener. Demo: `demo-grid`.
8. **`outro-end-screen`** — Slots: 1 video 8 s O on an overlay track, scale 0.42, position (−24, 6); 2 video 8 s O on an overlay track, scale 0.42, position (24, 6); the main track holds a full-canvas rectangle `#111111` for 8 s. Texts: Thanks «Thanks for watching» → `title-clean` at position (0, −36), 0–8 s, 30; Next «Watch next» → `callout-arrow` at position (0, 34), 1–8 s, 20; Follow «Subscribe» → `social-follow` at position (0, 44), 2–8 s, 20. Tags: outro, end screen. Demo: `demo-skyline`, `demo-waves`.
9. **`short-hook`** — Slots: 1 video 2 s R; 2 video 3 s R; 3 video 4 s R. Transitions: `glitch-cut` 0.3 s at cut 1–2; `zoom-in` 0.4 s at cut 2–3. Texts: Hook «Wait for it…» → `title-typed`, 0–2 s, 24; Reveal «Here it is» → `quote-bold`, 5–9 s, 24. Tags: hook, reveal, short. Demo: `demo-blobs`, `demo-grid`, `demo-confetti`.
10. **`short-top-three`** — Slots: 1 video 4 s R; 2 video 4 s R; 3 video 4 s R. Transitions: `swipe-up` 0.4 s at every cut. Texts: Title «Top 3» → `title-outline`, 0–2 s, 16; Item 1 «First thing» → `callout-step` (number "1"), 0–4 s, 24; Item 2 «Second thing» → `callout-step` (number "2"), 4–8 s, 24; Item 3 «Third thing» → `callout-step` (number "3"), 8–12 s, 24. Tags: list, top, short. Demo: `demo-gradient-cool`, `demo-gradient-green`, `demo-gradient-warm`.
11. **`quote-card`** — Slots: 1 any 8 s O (background, full canvas, with a full-canvas rectangle `#00000066` above it). Texts: Quote «Quote text goes here, two lines at most.» → `quote-classic` (quote line), 0–8 s, 120; Author «— Author» → `quote-classic` (author line), 0–8 s, 40. Tags: quote, square. Demo: `demo-paper`.
12. **`event-countdown`** — Slots: 1 video 5 s R; 2 video 5 s O. Transitions: `dip-to-black` 0.5 s at cut 1–2. Texts: Event «Event name» → `title-stack` (main title; the instance keeps the main title and the accent bar S1 only), 0–5 s, 30; Date «Saturday, 8 pm» → `lower-third-pill`, 5–10 s, 30. Not editable: `social-countdown` from 7 s to 10 s (the digits 3, 2, 1 are the design itself, not sample wording). Tags: event, countdown, announcement. Demo: `demo-skyline`, `demo-confetti`.

Where a text is marked with a part in parentheses (for example "main title"), the template instantiates the text template group, exposes that text as editable under the given label, and REMOVES from the instance every other text element of the group that is not exposed by another entry of the same template; shape elements of the group stay. No bundled template therefore contains a text element that is both non-editable and equal to a sample text of `text-and-titles/catalog.md` (the build check of the requirement "Bundled templates are original content"); the only non-editable texts are the design glyphs named here: the digits of `social-countdown` in template 12, the step digits of `callout-step` in template 10 and the opening quotation mark of `quote-classic` in templates 6 and 11. Consequences per template: 2 `vlog-travel` — `title-stack` exposes both of its texts (Title, Subtitle) and `lower-third-minimal` exposes both of its lines (Place, Date); 5 `slideshow-memories` — the Date uses `title-clean`, a single-text template, so no second line exists; 6 and 11 — `quote-classic` exposes the quote and author lines, and its decorative opening quotation mark T1 is kept as a design glyph; 10 `short-top-three` — each `callout-step` instance exposes its step title and keeps its digit, which the template sets to "1", "2", "3"; 12 `event-countdown` — `title-stack` keeps the main title and the bar, and its subtitle text T2 is removed.

Previews: `preview.mp4` of every template is its full duration (6–24 s here), 720 px on the long side, at most 12 MB, as the requirement "Template data model" states. Theme colours: each theme colour of the table is bound (`colorBindings`) to the text fills, bubble colours and shape fills of that template that use the same value.
